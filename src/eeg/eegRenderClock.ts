export const EEG_RENDER_FRAME_INTERVAL_MS = 33;

export function shouldRenderEegFrame(
  nowMs: number,
  lastRenderedAtMs: number | null,
  frameIntervalMs: number = EEG_RENDER_FRAME_INTERVAL_MS,
) {
  return lastRenderedAtMs === null || nowMs - lastRenderedAtMs >= frameIntervalMs;
}
