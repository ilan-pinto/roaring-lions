/**
 * Animation playback. Pure functions over numbers — no Pixi, no sim state,
 * no side effects — so the timing rules are testable on their own.
 *
 * Renderer-only by construction: nothing here reads or writes sim state, so
 * none of it can affect determinism (invariant 4).
 */

/** The fixed sim tick rate (invariant 1). Measured speed derives from a
 *  per-tick position delta, so this is load-bearing, not decorative. */
export const SIM_HZ = 20;

/**
 * Ground distance covered by one full gait cycle.
 *
 * This is what ties the feet to the terrain: a unit crossing STRIDE_TILES
 * completes exactly one cycle doing it, at any speed, so nothing slides.
 * 0.5 is chosen so infantry at their data speed of 0.9 tiles/s land on the
 * 7.2 frames/s the old hardcoded counter produced at 60 fps — foot troops
 * look unchanged, everything else becomes correct.
 */
export const STRIDE_TILES = 0.5;

/** Walk frames per second for a unit actually moving at `tilesPerSec`. */
export function walkFps(tilesPerSec: number, walkFrames: number): number {
  if (walkFrames <= 0 || tilesPerSec <= 0) return 0;
  return (tilesPerSec / STRIDE_TILES) * walkFrames;
}

/**
 * Deterministic per-entity phase offset, in frames.
 *
 * Without this a squad ordered to move steps in perfect unison, which reads
 * as clockwork rather than troops. The golden-ratio conjugate spreads
 * consecutive ids far apart, and units spawn in consecutive blocks, so that
 * is exactly the case that needs spreading.
 */
export function phaseOffset(entityId: number, walkFrames: number): number {
  if (walkFrames <= 0) return 0;
  const frac = (entityId * 0.6180339887498949) % 1;
  return frac * walkFrames;
}

/**
 * Advance a phase counter by elapsed time and wrap it into the cycle.
 *
 * Replaces a fixed per-rendered-frame increment, which made playback speed a
 * function of display refresh rate. A stopped unit (`fps` 0) holds its phase
 * rather than resetting, so gait resumes mid-stride instead of restarting
 * every unit on the same foot.
 */
export function advancePhase(
  phase: number,
  fps: number,
  dtSeconds: number,
  walkFrames: number
): number {
  if (walkFrames <= 0) return 0;
  const next = phase + fps * dtSeconds;
  const wrapped = next % walkFrames;
  return wrapped < 0 ? wrapped + walkFrames : wrapped;
}


/** Idle frames the cigarette beats land on, tied to `teams.smoke_pose`.
 *
 * `smoke_pose` drives the hand with a triangle wave, so the reach peaks at the
 * midpoint of the loop. The exhale trails the drag by two frames because that is
 * what it does. Both are indices into the idle clip, so they move if the frame
 * count in teams.py moves.
 */
export const SMOKE_EMBER_FRAME = 5;
export const SMOKE_EXHALE_FRAME = 7;

/**
 * Which ambient emitter, if any, this frame of the idle clip should fire.
 *
 * Pure, and extracted from the render loop deliberately: the loop only advances
 * under requestAnimationFrame, which does not run when the page is hidden, so the
 * behaviour cannot be checked by driving the browser. A pure decision can be
 * tested directly, and that is where the logic can actually go wrong -- the
 * edge-detect on the frame index, not the spawning.
 *
 * Fires only on the frame the clip *enters*, never while it sits there, or an
 * idling squad would emit once per rendered frame.
 */
export function ambientCue(
  clip: string,
  frames: number,
  prevFrame: number,
  frame: number
): 'ember' | 'smoke' | null {
  if (clip !== 'idle' || frames <= 1 || frame === prevFrame) return null;
  if (frame === SMOKE_EMBER_FRAME) return 'ember';
  if (frame === SMOKE_EXHALE_FRAME) return 'smoke';
  return null;
}
