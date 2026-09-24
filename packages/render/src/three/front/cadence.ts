/**
 * The scene host's frame cadence: when the menu's diorama draws, and when it
 * stops trying to animate at all (spec §3.3 (5), §10).
 *
 * Pure and three-free on purpose, so its test runs without a GPU, a DOM or a
 * three import, and so the two numbers a review argues about -- the cap and
 * the hold rule -- sit in one short file rather than inside a frame loop.
 *
 * Why a cap at all: the host is a backdrop, not a battle. Measured on the
 * reference machine (spec M11), an uncapped loop asked for 60 fps managed
 * only 20.8-21.8 at `high` because the GPU was the bound, while a cap of 30
 * held 28.8-30.3 at ~6 ms of `frame()` CPU -- the cap costs nothing that was
 * being delivered and gives the rest back to the menu.
 *
 * Why a HOLD: some machines cannot afford even that. CI's rasteriser,
 * SwiftShader, took ~920 ms a frame (M12) against Metal's 33 ms (M11), and a
 * menu repainting once a second makes every click wait behind a frame. The
 * two populations sit a factor of ~28 apart, so the rule does not need to be
 * clever: after the first draw, take HOLD_SAMPLES draw intervals, and if
 * their MEDIAN exceeds HOLD_FACTOR periods, stop the loop and keep the last
 * frame. The median rather than the mean, so one long frame -- a GC pause, a
 * late texture upload, the tab losing focus once -- cannot hold a machine
 * that is otherwise keeping up.
 */

/** Frames per second the host draws at (spec §10). */
export const HOST_FPS_CAP = 30;
/** Draw intervals the hold rule reads before it decides (spec §10). */
export const HOLD_SAMPLES = 3;
/** A median interval longer than this many periods holds the frame: 83 ms at
 *  the cap of 30 (spec §10). */
export const HOLD_FACTOR = 2.5;

/** rAF timestamps land a hair either side of the display period. Without
 *  this slack, a 60 Hz display whose tick arrives at 33.2 ms against a
 *  33.3 ms period waits for the NEXT tick and draws at 20 fps, not 30. */
const RAF_SLACK_MS = 1;

/** The three answers the hold rule can give. `undecided` until it has read
 *  HOLD_SAMPLES intervals. */
export type MotionVerdict = 'animate' | 'hold' | 'undecided';

/**
 * Whether a frame is due at `nowMs`, the last one having been drawn at
 * `lastDrawMs` (both on the rAF clock). A cap of 0 or less means uncapped:
 * every call draws. `lastDrawMs` of `-Infinity` -- nothing drawn yet --
 * always draws.
 */
export function drawDue(nowMs: number, lastDrawMs: number, capFps: number): boolean {
  return capFps <= 0 || nowMs - lastDrawMs >= 1000 / capFps - RAF_SLACK_MS;
}

/**
 * The hold rule. Reads only the FIRST `HOLD_SAMPLES` of `intervalsMs` -- the
 * decision is made once, early, and later frames do not re-open it -- and
 * compares their median against `HOLD_FACTOR` periods of `capFps`.
 *
 * An uncapped loop (`capFps <= 0`) has no period to be late against, so it
 * never holds; the host always runs with a cap (`HOST_FPS_CAP` by default).
 */
export function motionVerdict(intervalsMs: readonly number[], capFps: number): MotionVerdict {
  if (intervalsMs.length < HOLD_SAMPLES) return 'undecided';
  if (capFps <= 0) return 'animate';
  return median(intervalsMs.slice(0, HOLD_SAMPLES)) > (HOLD_FACTOR * 1000) / capFps ? 'hold' : 'animate';
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
