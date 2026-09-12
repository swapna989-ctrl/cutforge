// ffmpeg-static and ffprobe-static are plain CJS packages whose bundled .d.ts files don't
// resolve cleanly under NodeNext module resolution — these ambient declarations sidestep that.
declare module "ffmpeg-static" {
  const ffmpegPath: string | null;
  export default ffmpegPath;
}

declare module "ffprobe-static" {
  const ffprobe: { path: string };
  export default ffprobe;
}
