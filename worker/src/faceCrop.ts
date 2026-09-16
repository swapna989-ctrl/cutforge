import "@tensorflow/tfjs-backend-cpu";
import * as tf from "@tensorflow/tfjs-core";
import * as faceDetection from "@tensorflow-models/face-detection";
import jpeg from "jpeg-js";
import ffmpegPath from "ffmpeg-static";
import { spawn } from "node:child_process";

/**
 * Loaded once per worker process, on first use, and reused for every clip afterward — model
 * loading (a real network fetch to tfhub.dev, then building the TFJS graph) costs real seconds,
 * which is fine to pay once at process warm-up but not once per clip. The CPU backend is
 * deliberately plain-JS rather than WASM/GPU: this only ever runs on 5 small still frames per
 * clip, not video, so raw inference speed doesn't matter here — what matters is that a pure-JS
 * backend has zero native compilation anywhere in the chain, unlike tfjs-node or the `canvas`
 * package that most face-detection Node setups otherwise need.
 */
let detectorPromise: Promise<faceDetection.FaceDetector> | null = null;

function getDetector(): Promise<faceDetection.FaceDetector> {
  if (!detectorPromise) {
    detectorPromise = tf.setBackend("cpu").then(() =>
      faceDetection.createDetector(faceDetection.SupportedModels.MediaPipeFaceDetector, {
        runtime: "tfjs",
        modelType: "short", // "short" = faces within ~2m of camera — matches talking-head/vlog content, this product's real use case.
        maxFaces: 1,
      })
    );
  }
  return detectorPromise;
}

/** Extracts one frame at `timestampSeconds` as a small JPEG buffer — a single compressed still
 *  image, not raw video, kept deliberately cheap since this runs 5x per clip. */
function extractSampleFrameJpeg(inputPath: string, timestampSeconds: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const args = ["-ss", String(timestampSeconds), "-i", inputPath, "-frames:v", "1", "-q:v", "4", "-f", "mjpeg", "pipe:1"];
    const proc = spawn(ffmpegPath as string, args);
    const chunks: Buffer[] = [];
    let stderr = "";
    proc.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on("close", (code) => {
      if (code === 0 && chunks.length > 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg frame extraction at ${timestampSeconds}s failed (exit ${code})\n${stderr.slice(-1000)}`));
    });
    proc.on("error", reject);
  });
}

/** jpeg-js decodes to RGBA — face-detection needs 3 channels, so the alpha byte is dropped here
 *  rather than asking the model to cope with an unexpected 4th channel. */
function jpegToRgbTensor(buffer: Buffer): tf.Tensor3D {
  const decoded = jpeg.decode(buffer, { useTArray: true });
  const rgb = new Uint8Array(decoded.width * decoded.height * 3);
  for (let i = 0, j = 0; i < decoded.data.length; i += 4, j += 3) {
    rgb[j] = decoded.data[i];
    rgb[j + 1] = decoded.data[i + 1];
    rgb[j + 2] = decoded.data[i + 2];
  }
  return tf.tensor3d(rgb, [decoded.height, decoded.width, 3], "int32");
}

export type FaceCenterFraction = { x: number; y: number };

/**
 * Samples 5 evenly-spaced frames across the clip, runs face detection on each, and returns the
 * median detected face center as a FRACTION (0-1) of frame width/height — a fraction rather than
 * absolute pixels is what lets this be reused directly against the actual output resolution
 * later, which is normally different from (larger than) these small detection frames. Returns
 * null when no face was found in any sample — screen recordings, animations, or any other
 * non-person content — so the caller can fall back to today's plain center crop rather than
 * guessing at a crop position with no real signal behind it.
 */
export async function detectFaceCenterFraction(clipPath: string, durationSeconds: number): Promise<FaceCenterFraction | null> {
  const detector = await getDetector();
  const sampleFractions = [0.1, 0.3, 0.5, 0.7, 0.9];
  const centers: FaceCenterFraction[] = [];

  for (const f of sampleFractions) {
    const timestamp = Math.min(durationSeconds * f, Math.max(0, durationSeconds - 0.1));
    let tensor: tf.Tensor3D | null = null;
    try {
      const jpegBuffer = await extractSampleFrameJpeg(clipPath, timestamp);
      tensor = jpegToRgbTensor(jpegBuffer);
      const faces = await detector.estimateFaces(tensor);
      if (faces.length > 0) {
        const { box } = faces[0];
        const frameWidth = tensor.shape[1];
        const frameHeight = tensor.shape[0];
        centers.push({
          x: (box.xMin + box.xMax) / 2 / frameWidth,
          y: (box.yMin + box.yMax) / 2 / frameHeight,
        });
      }
    } catch (err) {
      // One bad sample (e.g. a timestamp that lands exactly on a decode error) shouldn't sink
      // the whole clip's face-crop — it just contributes one fewer data point to the median.
      console.error(`[faceCrop] sample at ${timestamp.toFixed(2)}s failed:`, err instanceof Error ? err.message : err);
    } finally {
      tensor?.dispose();
    }
  }

  if (centers.length === 0) return null;

  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  };
  return { x: median(centers.map((c) => c.x)), y: median(centers.map((c) => c.y)) };
}
