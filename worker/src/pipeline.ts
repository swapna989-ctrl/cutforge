import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { downloadToFile, uploadFromFile } from "./r2.js";
import { detectSilences, getDuration, cutSilences, extractAudio, finalizeVideo } from "./ffmpeg.js";
import { transcribeToSrt } from "./transcribe.js";
import { updateJob, type ProjectRow } from "./supabase.js";

export async function processJob(job: ProjectRow): Promise<void> {
  const tmpDir = await mkdtemp(join(tmpdir(), "cutforge-"));
  const sourcePath = join(tmpDir, "source.mp4");
  const trimmedPath = join(tmpDir, "trimmed.mp4");
  const audioPath = join(tmpDir, "audio.mp3");
  const srtPath = join(tmpDir, "captions.srt");
  const finalPath = join(tmpDir, "final.mp4");

  try {
    if (!job.source_key) throw new Error("Job has no source_key");

    await updateJob(job.id, { status_message: "Downloading your clip…", progress: 10 });
    await downloadToFile(job.source_key, sourcePath);

    await updateJob(job.id, { status_message: "Detecting scene boundaries…", progress: 20 });
    const duration = await getDuration(sourcePath);
    const silences = await detectSilences(sourcePath);

    await updateJob(job.id, { status_message: "Removing dead air & filler pauses…", progress: 40 });
    await cutSilences(sourcePath, silences, duration, trimmedPath, tmpDir);

    await updateJob(job.id, { status_message: "Transcribing audio…", progress: 60 });
    await extractAudio(trimmedPath, audioPath);
    await transcribeToSrt(audioPath, srtPath);

    await updateJob(job.id, { status_message: "Generating captions…", progress: 80 });
    await finalizeVideo(trimmedPath, srtPath, job.watermark, finalPath);

    await updateJob(job.id, { status_message: "Uploading your master…", progress: 95 });
    const outputKey = `${job.user_id}/output/${randomUUID()}.mp4`;
    await uploadFromFile(finalPath, outputKey, "video/mp4");

    await updateJob(job.id, {
      pipeline_status: "ready",
      progress: 100,
      output_key: outputKey,
      status_message: "Master ready.",
    });
  } catch (err) {
    console.error(`Job ${job.id} failed:`, err);
    await updateJob(job.id, {
      pipeline_status: "failed",
      status_message: null,
      error_message: err instanceof Error ? err.message : String(err),
    }).catch((updateErr) => console.error("Also failed to record the failure:", updateErr));
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
