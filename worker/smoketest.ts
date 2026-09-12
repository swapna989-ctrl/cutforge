import { detectSilences, getDuration, cutSilences } from "./src/ffmpeg.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const input = "C:/Users/K SWAPNA KUMARI/AppData/Local/Temp/cftest/test.mp4";

const duration = await getDuration(input);
console.log("duration:", duration);

const silences = await detectSilences(input);
console.log("silences:", silences);

const tmp = await mkdtemp(join(tmpdir(), "cf-smoke-"));
const outPath = join(tmp, "trimmed.mp4");
await cutSilences(input, silences, duration, outPath, tmp);

const trimmedDuration = await getDuration(outPath);
console.log("trimmed duration:", trimmedDuration, "(expect ~4s, down from ~6s)");

await rm(tmp, { recursive: true, force: true });
console.log("OK");
