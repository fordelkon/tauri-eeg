/**
 * ~15 Hz is enough for the sweep-page display: the cursor advances sub-pixel
 * amounts per frame at typical page widths, and halving the 33 ms cadence
 * halves uPlot redraw work. Data itself keeps arriving at 20 Hz — frames in
 * between just skip (see useRealtimeEeg's sequence probe).
 */
export const EEG_RENDER_FRAME_INTERVAL_MS = 66;

export function shouldRenderEegFrame(
  nowMs: number,
  lastRenderedAtMs: number | null,
  frameIntervalMs: number = EEG_RENDER_FRAME_INTERVAL_MS,
) {
  return lastRenderedAtMs === null || nowMs - lastRenderedAtMs >= frameIntervalMs;
}
