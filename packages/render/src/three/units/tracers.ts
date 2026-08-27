/**
 * Task B3.12: the tracer model, extracted pure from Pixi's `renderer.ts` so a
 * three.js caller can reuse it instead of growing a second one. Three pieces
 * of `renderer.ts` together make up "tracers" there, and all three are
 * ported here:
 *
 *  - The shape (`renderer.ts:95-102`, private `interface Tracer`): a line
 *    from a shooter's position to its target's, tagged by side, fading out
 *    over a fixed lifetime.
 *  - The spawn (`renderer.ts:763-770`, inside `onEvents`'s `fire` case):
 *    pushed with `ttl: 9` on every `fire` event, aimed at the target unit's
 *    interpolated position or, for a shot at a building (`target: -1` with a
 *    `structure` set), the structure's centre.
 *  - The step + draw (`renderer.ts:2596-2601`, inside `frame()`): every
 *    render frame, `--t.ttl` on each tracer and drop it once that reaches
 *    zero; alpha is `t.ttl / 9`, i.e. linear fade-to-nothing over the
 *    lifetime.
 *
 * ## `ttl` is expressed in seconds here, not frames
 *
 * Pixi's `--t.ttl` decrements by exactly 1 per `frame()` **call**, not per
 * unit of elapsed time -- `frame()`'s own `dtMs` is read for firing-timer,
 * recoil and flinch decay (`renderer.ts:1880-1888`) and for
 * `particles.step()`, but never for the tracer countdown. That makes Pixi's
 * tracers the one transient-VFX lifetime in the renderer that is tied to
 * display refresh rate rather than wall-clock time -- 9 frames at the
 * renderer's nominal 60 Hz (`main.ts`'s `lastFrameMs` starts at `1000 / 60`,
 * and `?renderer=three` targets the same refresh rate) is 150 ms, so
 * `TRACER_LIFETIME_S` below is `9 / 60`.
 *
 * `stepTracers` takes real elapsed seconds (matching every other `step(dt)`
 * in this codebase -- `ParticleSystem.step`, `entityFrame`'s frame advance)
 * rather than a frame-count, and at the nominal 60 Hz frame time
 * (`dt = 1 / 60`) it decrements `ttl` by exactly `1 / 60` per call --
 * the same fraction of the total lifetime Pixi's `--ttl` removes per call at
 * that frame rate. `tracerAlpha` divides by the same `TRACER_LIFETIME_S`, so
 * the fade curve (linear 1 -> 0 over the lifetime) matches Pixi's
 * `t.ttl / 9` exactly, just expressed in seconds instead of a frame count.
 * This is a deliberate, minimal generalisation -- not a behaviour change
 * Pixi exhibits, since `renderer.ts` is untouched and keeps its own inline
 * frame-counted copy -- made so a fresh pure module doesn't bake in a
 * refresh-rate coupling nothing else here has.
 *
 * Pure data in, pure data out: no three.js, no Pixi, no DOM. A caller (a
 * later task) owns storage, calls `spawnTracer` on a `fire` event and
 * `stepTracers` once a render frame, and reads `tracerAlpha` plus each
 * tracer's own `sx/sy/tx/ty/side` to draw a line.
 */

/** One tracer: a fading line from a shooter's position to its target's,
 *  tagged by side for colour lookup (mirrors `renderer.ts:95-102`). */
export interface TracerModel {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  /** Seconds remaining. Starts at `TRACER_LIFETIME_S`; a tracer is live
   *  while this is `> 0`. See this module's top comment for why seconds,
   *  not the frame-count `renderer.ts` uses. */
  ttl: number;
  side: number;
}

/** 9 frames at the renderer's nominal 60 Hz, matching `renderer.ts`'s
 *  `ttl: 9` / `alpha: t.ttl / 9` (`:764`, `:2601`). See this module's top
 *  comment. */
export const TRACER_LIFETIME_S = 9 / 60;

/** Creates a tracer at full lifetime. Mirrors the object literal pushed at
 *  `renderer.ts:763-770`. */
export function spawnTracer(sx: number, sy: number, tx: number, ty: number, side: number): TracerModel {
  return { sx, sy, tx, ty, ttl: TRACER_LIFETIME_S, side };
}

/**
 * Ages every tracer by `dt` seconds and drops the ones that have expired.
 * Mirrors `renderer.ts:2596`'s `this.tracers = this.tracers.filter((t) =>
 * --t.ttl > 0)` -- decrement first, keep only what is still `> 0` after --
 * except pure: the input array and its elements are never mutated, a fresh
 * array (and fresh expired-tracer objects) is returned instead, since a
 * "read path with no graphics library named in it" should not also require
 * its caller to own mutable aliasing rules.
 */
export function stepTracers(tracers: readonly TracerModel[], dt: number): TracerModel[] {
  const next: TracerModel[] = [];
  for (const t of tracers) {
    const ttl = t.ttl - dt;
    if (ttl > 0) next.push({ ...t, ttl });
  }
  return next;
}

/** Linear fade-to-nothing over the tracer's lifetime. Mirrors
 *  `renderer.ts:2601`'s `alpha: t.ttl / 9`. */
export function tracerAlpha(t: TracerModel): number {
  return t.ttl / TRACER_LIFETIME_S;
}
