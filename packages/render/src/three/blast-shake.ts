/**
 * Screen shake and hit-stop, as two pure presentation models -- no `THREE`
 * import, no renderer, no browser. The same pure/impure split
 * `units/mesh-death.ts` already uses for its fade curve: the decision logic
 * lives here, exercised in milliseconds, and Task 7 wires it into
 * `ThreeRenderer` in four lines.
 *
 * R-J -- hit-stop lives inside `ThreeRenderer.frame()`, not at the
 * `main.ts` boundary the original brief proposed, because `packages/app` is
 * Lane A's file and `frame()` already owns a frame-time clamp
 * (`frameDtMs`, `ThreeRenderer.ts:4400`) at exactly this point: this is a
 * second clamp beside the first. `stepHitStop`'s caller is expected to hold
 * the previous interpolation `alpha` and pass `0` downstream for `dtMs`
 * while `frozen` is true -- it PAUSES INTERPOLATION only. The sim keeps
 * ticking in `main.ts` underneath, unaware any of this exists (invariant 4:
 * nothing here writes sim state and nothing here is read by the sim), so on
 * release a unit resumes from whatever the sim has reached in the meantime.
 * At the schema's own 70 ms ceiling that is under a tenth of a tile of
 * catch-up at infantry speed (0.9 tiles/s move -> 0.063 tiles in 70 ms) --
 * a claim Task 7's acceptance drive checks against the real clamp rather
 * than assuming it from this comment.
 *
 * R-K -- shake is applied in `threeCamera()` only (`ThreeRenderer.ts:4386`),
 * on a COPY of the shared `Camera`, never on `this.camera` itself. That
 * object is `packages/app`'s own and is written every frame for panning and
 * edge-pan; writing a shake into it would fight those writes and leak
 * presentation state back across the seam. Offsetting the copy means
 * `worldToScreen`/`screenToWorld` never shake, so a click during a shake
 * still lands on the tile the player aimed at.
 *
 * R-R -- a Grad salvo is up to twenty rounds inside two seconds. Summing
 * twenty overlapping shakes or queueing twenty hit-stops would play the
 * engagement in slow motion, so both models take the MAX of their live
 * sources, never the sum: `shakeOffsetPx` picks the single strongest live
 * shake at the sampled instant (not a per-axis sum of all of them), and
 * `requestHitStop` takes `Math.max(remaining, ms)` rather than extending or
 * queueing. Taking the max also keeps a multi-source shake inside the
 * schema's own `amplitude_px` ceiling of 24 with no second clamp anywhere
 * to enforce it.
 *
 * The null decision (asked of this task by the Task 2 reviewer): `blastShake`
 * returns `null` when the emitter never declared a `screen_shake.amplitude_px`
 * to scale. `pushShake` accepts `ScaledShake | null` and treats `null` as a
 * silent no-op -- it contributes nothing to the state, exactly as if it had
 * not been called. This lets Task 7 write `pushShake(state, blastShake(em,
 * power), wx, wy)` directly at every dispatch site without a null check of
 * its own; the alternative (rejecting `null` at this boundary and pushing the
 * check onto every caller) would duplicate the same guard at every call site
 * for no behavioural difference. `blastHitStopMs` never returns `null` --
 * it returns `0` when there is nothing to add -- and `requestHitStop`
 * already refuses anything `<= 0`, so the same "nothing means no-op" rule
 * holds for hit-stop without needing an explicit null case.
 *
 * Both models are plain data transformations: `initShakeState`/`pushShake`/
 * `stepShake` thread an immutable `ShakeState` the same way a reducer would,
 * and `HitStopState` is one scalar. Neither allocates on the frames where
 * nothing is live -- `stepShake` short-circuits on an empty `live` array --
 * so the steady-state (no active blast) frame costs nothing beyond the
 * early-return check.
 */
import type { ScaledShake } from './blast-spec';

/**
 * 26 Hz: the shake has to be visible at 60 fps and unresolvable as
 * individual frames -- under about 15 Hz it reads as a slide, over about 35
 * it aliases into a shimmer at this frame rate. This is a PRESENTATION
 * clock, wall time rather than ticks, and cannot touch the sim (invariant
 * 1's other half: the renderer interpolates, the sim never reads a frame
 * clock back).
 */
export const SHAKE_FREQUENCY_HZ = 26;

/**
 * The jolt direction: a fixed 45 degree pair, applied to every live shake
 * regardless of where it originated. A per-shake direction (e.g. away from
 * the blast) would need the camera's own facing to resolve into screen
 * space, which this module deliberately does not know about; a FIXED screen
 * axis reads as a jolt along the screen's own diagonal rather than a wobble,
 * and is what makes multiple overlapping shakes combine as one number
 * (see R-R above) instead of fighting over a direction.
 */
const SHAKE_DIR_X = Math.cos(Math.PI / 4);
const SHAKE_DIR_Y = Math.sin(Math.PI / 4);

/** One shake source, still alive, with its own age since `pushShake`. */
export interface LiveShake {
  readonly amplitudePx: number;
  readonly durationMs: number;
  readonly falloffTiles: number;
  readonly wx: number;
  readonly wy: number;
  readonly ageMs: number;
}

export interface ShakeState {
  readonly live: readonly LiveShake[];
}

export function initShakeState(): ShakeState {
  return { live: [] };
}

/**
 * Adds a shake source at world tile position `(wx, wy)`. `shake === null`
 * (see the null decision above) or a non-positive amplitude/duration is a
 * silent no-op -- the state comes back unchanged, contributing nothing.
 */
export function pushShake(s: ShakeState, shake: ScaledShake | null, wx: number, wy: number): ShakeState {
  if (shake === null || shake.amplitudePx <= 0 || shake.durationMs <= 0) return s;
  const next: LiveShake = {
    amplitudePx: shake.amplitudePx,
    durationMs: shake.durationMs,
    falloffTiles: shake.falloffTiles,
    wx,
    wy,
    ageMs: 0,
  };
  return { live: [...s.live, next] };
}

/**
 * Ages every live shake by `dtMs` and drops any that have reached their own
 * `durationMs` -- retirement, not a caller-visible zero: a fully-decayed
 * shake is not kept around at zero strength. Short-circuits (no allocation)
 * when nothing is live, which is the steady-state frame.
 */
export function stepShake(s: ShakeState, dtMs: number): ShakeState {
  if (s.live.length === 0) return s;
  const live: LiveShake[] = [];
  for (const shake of s.live) {
    const ageMs = shake.ageMs + dtMs;
    if (ageMs < shake.durationMs) live.push({ ...shake, ageMs });
  }
  return { live };
}

/**
 * The camera offset, in pixels, at `(camX, camY)` (the same world tile-space
 * `(wx, wy)` was pushed in). Per live shake: amplitude x distance-falloff x
 * age-decay x `sin(2*pi*SHAKE_FREQUENCY_HZ*ageSeconds)`, both falloff and
 * decay linear to zero (see the constant's own doc comment for why linear --
 * this is a "still shaking, yes/no" judgement, not a brightness curve).
 * R-R: overlapping shakes combine by MAX magnitude at the sampled instant,
 * never by summing their offsets, and the fixed 45 degree direction (see
 * `SHAKE_DIR_X`/`SHAKE_DIR_Y`) is what makes "the single strongest value" and
 * "the vector sum" the same question to answer.
 */
export function shakeOffsetPx(s: ShakeState, camX: number, camY: number): { dx: number; dy: number } {
  let strongest = 0;
  for (const shake of s.live) {
    if (shake.falloffTiles <= 0) continue;
    const dist = Math.hypot(shake.wx - camX, shake.wy - camY);
    const falloff = Math.max(0, 1 - dist / shake.falloffTiles);
    if (falloff <= 0) continue;
    const decay = Math.max(0, 1 - shake.ageMs / shake.durationMs);
    const ageSeconds = shake.ageMs / 1000;
    const oscillation = Math.sin(2 * Math.PI * SHAKE_FREQUENCY_HZ * ageSeconds);
    const value = shake.amplitudePx * falloff * decay * oscillation;
    if (Math.abs(value) > Math.abs(strongest)) strongest = value;
  }
  return { dx: strongest * SHAKE_DIR_X, dy: strongest * SHAKE_DIR_Y };
}

/** How much presentation time is being withheld, as one scalar. */
export interface HitStopState {
  remainingMs: number;
}

/**
 * Asks for `ms` of hit-stop. Refuses anything `<= 0` (a silent no-op, the
 * same rule `pushShake` follows for a null shake). Otherwise takes
 * `Math.max(remaining, ms)` -- R-R: a salvo's later, shorter requests never
 * extend a freeze already running, and a longer one is allowed to win.
 */
export function requestHitStop(s: HitStopState, ms: number): HitStopState {
  if (ms <= 0) return s;
  return { remainingMs: Math.max(s.remainingMs, ms) };
}

/**
 * Drains the remaining freeze by `dtMs`, floored at 0, and reports whether
 * the frame just stepped should still be held (`frozen`). Neither allocates
 * a pool nor branches on history -- one scalar in, one scalar and one
 * boolean out.
 */
export function stepHitStop(s: HitStopState, dtMs: number): { state: HitStopState; frozen: boolean } {
  const remainingMs = Math.max(0, s.remainingMs - dtMs);
  return { state: { remainingMs }, frozen: remainingMs > 0 };
}
