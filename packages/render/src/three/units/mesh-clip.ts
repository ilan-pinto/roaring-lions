/**
 * Clip switching for anything that owns a `THREE.AnimationMixer` -- the one
 * shared implementation behind BOTH mesh classes that animate.
 *
 * Extracted from `mesh-unit.ts`, where this lived while infantry was the
 * only animated class. It moved when vehicles gained a mixer of their own:
 * a `SkinnedMesh` figure and a rigid hull animate through the identical
 * three.js machinery (`AnimationAction.stop`/`reset`/`play`, `setLoop`,
 * `clampWhenFinished`), and a second copy of that machinery is exactly the
 * shape this project has already been bitten by -- behaviour living in two
 * places, so neither copy can be broken alone and no test on either is
 * falsifiable. One function, two callers.
 *
 * Deliberately typed against `ClipPlayer` rather than `MeshUnitEntity`: this
 * code touches `actions` and `currentClip` and NOTHING else -- not the
 * mixer, not the root, not a skeleton. Narrowing the parameter to what is
 * actually read is what lets a `VehicleMeshEntity` (no skin, no bones,
 * possibly no mixer at all) pass through unchanged.
 *
 * ## Why the ramp is owned rather than `AnimationAction.fadeIn`
 *
 * Read from three.js's source, `fadeIn(d)` is `_scheduleFading(d, 0, 1)`,
 * which sets the interpolant's first sample to weight ZERO at `mixer.time`;
 * and `PropertyMixer.apply` mixes the accumulated pose toward the binding's
 * ORIGINAL (bind-pose) value by `1 - cumulativeWeight`. A clip re-selected
 * while still fading out would therefore drop the summed weight below 1 for
 * a few frames and blend a Meshy biped toward its T-pose. Gate 1 pins the
 * sum at exactly 1 across a re-selection, which is exactly what an owned
 * ramp -- one that always restarts every live weight from its CURRENT
 * effective value -- can guarantee and three.js's own scheduled fade cannot.
 */
import * as THREE from 'three';
import type { ClipName } from '../../sheet';
import { meshClipOrFallback } from './mesh-anim';

/** Design D1: one blend window for every transition that is not a cut. */
export const MESH_CLIP_FADE_SECONDS = 0.15;

/** `scaleSignature`'s answer for a clip whose scale is not constant --
 *  incomparable with anything, so every transition touching it is a cut. */
export const SCALE_ANIMATED = 'animated';

/** One weight ramp in flight: `from` at `t = 0`, `to` at
 *  `t = MESH_CLIP_FADE_SECONDS`, linear between. */
export interface ClipFade {
  from: number;
  to: number;
  t: number;
}

/**
 * The animation state `applyMeshClip` reads and writes. `MeshUnitEntity`
 * (infantry) and `VehicleMeshEntity` both satisfy it structurally.
 *
 * `clipScale` is computed ONCE per template at load (`clipScaleSignatures`)
 * and carried by reference; `fades` is per entity and usually empty. An
 * EMPTY `actions` map is a legitimate state (a vehicle GLB with no
 * animations) and leaves `applyMeshClip` a no-op -- see its `!next` guard.
 */
export interface ClipPlayer {
  readonly actions: ReadonlyMap<ClipName, THREE.AnimationAction>;
  currentClip: ClipName | null;
  readonly clipScale: ReadonlyMap<ClipName, string | null>;
  readonly fades: Map<ClipName, ClipFade>;
}

/**
 * Design D2's per-clip key. `null` when the clip keys no `.scale` track;
 * otherwise the sorted `trackName=value` list of its scale tracks, each of
 * which must be constant over the clip -- `SCALE_ANIMATED` if any is not.
 * Two clips with equal signatures show the same geometry set, so blending
 * between them cannot interpolate a scale swap.
 */
export function scaleSignature(clip: THREE.AnimationClip): string | null {
  const parts: string[] = [];
  for (const track of clip.tracks) {
    if (!track.name.endsWith('.scale')) continue;
    const v = track.values;
    const stride = track.times.length > 0 ? v.length / track.times.length : v.length;
    for (let i = stride; i < v.length; i++) {
      if (Math.abs(v[i] - v[i % stride]) > 1e-6) return SCALE_ANIMATED;
    }
    parts.push(`${track.name}=${v[0].toFixed(3)}`);
  }
  return parts.length === 0 ? null : parts.sort().join(';');
}

/** `scaleSignature` for every clip of a template, keyed like its clips. */
export function clipScaleSignatures(
  clips: ReadonlyMap<ClipName, THREE.AnimationClip>
): ReadonlyMap<ClipName, string | null> {
  const out = new Map<ClipName, string | null>();
  for (const [name, clip] of clips) out.set(name, scaleSignature(clip));
  return out;
}

/**
 * Whether switching from a clip with signature `from` to one with `to` must
 * be a hard cut. `undefined` means "no previous clip" (a fresh entity), and
 * that is a cut too: there is nothing to blend from.
 */
export function transitionIsCut(from: string | null | undefined, to: string | null | undefined): boolean {
  if (from === undefined || to === undefined) return true;
  if (from === SCALE_ANIMATED || to === SCALE_ANIMATED) return true;
  return from !== to;
}

function setLoop(action: THREE.AnimationAction, once: boolean): void {
  if (once) {
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
  } else {
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = false;
  }
}

/**
 * Switches `player` to `desired`, falling back through `meshClipOrFallback`.
 * A no-op when the resolved clip is already `currentClip`.
 *
 * Two shapes. A CUT (`opts.cut`, or a first clip, or a scale-signature
 * change -- `transitionIsCut`) is the old behaviour verbatim: stop every
 * other action, `reset().play()` the new one at weight 1. A BLEND starts a
 * `ClipFade` on every action that carries weight -- each from its CURRENT
 * effective weight, all restarted together so their sum stays 1 -- and one
 * on the incoming action toward 1. A re-selected action that is still
 * fading out keeps its own clip time (no `reset()`); anything else is
 * reset. The ramps advance in `advanceMeshClipFades`, which every mixer
 * site calls right before `mixer.update`.
 *
 * "Carries weight" is `isScheduled()`, not `isRunning()`: a `LoopOnce` +
 * `clampWhenFinished` action that has reached its end (`down`, `wreck`) goes
 * `paused = true` and `isRunning() === false`, but `PropertyMixer.apply`
 * keeps blending its frozen last frame at its last `effectiveWeight` until
 * `.stop()` is called -- weight is independent of `paused`. `isScheduled()`
 * (`mixer._isActiveAction(this)`) is true for both the running and the
 * paused-and-held case, so a finished one-shot that is still the current
 * clip gets its `{ from, to: 0 }` fade instead of being silently skipped and
 * left contributing forever.
 *
 * `opts.once` keeps its meaning (`LoopOnce` + `clampWhenFinished`), and is
 * set explicitly either way so a clip once played one-shot cannot inherit
 * that setting when re-selected as a loop.
 */
export function applyMeshClip(
  player: ClipPlayer,
  desired: ClipName,
  opts?: { once?: boolean; cut?: boolean }
): void {
  const available = new Set(player.actions.keys());
  const resolved = meshClipOrFallback(available, desired);
  if (player.currentClip === resolved) return;
  const next = player.actions.get(resolved);
  if (!next) return; // No idle clip either -- nothing to play (a vehicle GLB with no animations).

  const previous = player.currentClip;
  const cut =
    opts?.cut === true ||
    previous === null ||
    transitionIsCut(player.clipScale.get(previous), player.clipScale.get(resolved));
  setLoop(next, opts?.once === true);

  if (cut) {
    for (const [name, action] of player.actions) {
      if (name !== resolved) action.stop();
    }
    player.fades.clear();
    next.reset().setEffectiveWeight(1).play();
    player.currentClip = resolved;
    return;
  }

  for (const [name, action] of player.actions) {
    if (name === resolved) continue;
    if (!action.isScheduled() && !player.fades.has(name)) continue;
    const w = action.getEffectiveWeight();
    if (w <= 0) {
      action.stop();
      player.fades.delete(name);
      continue;
    }
    player.fades.set(name, { from: w, to: 0, t: 0 });
  }
  // M1: `isRunning()`, not `isScheduled()` -- a paused-but-still-scheduled
  // once-action (a finished `down`/`wreck` still holding its last frame,
  // `isRunning() === false` per `AnimationAction.js`) re-selected mid-fade-out
  // would otherwise be treated as "not resuming", reset to t=0 and started
  // from weight 0 -- dropping the summed weight below 1 for a few frames
  // (blending a Meshy biped toward its own T-pose) rather than resuming from
  // whatever weight the fade-out loop above just gave it. `isScheduled()`
  // (`mixer._isActiveAction(this)`) is true for both the running and the
  // paused-and-held case, matching the identical reasoning this function's
  // own top comment already applies to the OTHER actions in the fade-out
  // loop. Not reachable by any shipped clip today (every once-clip that could
  // be re-selected mid-fade is also a cut by `transitionIsCut`'s scale-change
  // rule) -- closed anyway, since a future blend-eligible once-clip would hit
  // it silently.
  const resuming = next.isScheduled();
  const startWeight = resuming ? next.getEffectiveWeight() : 0;
  if (!resuming || next.paused) next.reset();
  next.setEffectiveWeight(startWeight);
  next.play();
  player.fades.set(resolved, { from: startWeight, to: 1, t: 0 });
  player.currentClip = resolved;
}

/**
 * Advances every in-flight ramp by `dtSeconds` and writes the weights. An
 * action that reaches 0 is stopped; a fade that reaches its end is dropped.
 * Cheap when nothing is fading (one size check), which is nearly always.
 */
export function advanceMeshClipFades(player: ClipPlayer, dtSeconds: number): void {
  if (player.fades.size === 0) return;
  for (const [name, fade] of player.fades) {
    const action = player.actions.get(name);
    if (!action) {
      player.fades.delete(name);
      continue;
    }
    fade.t = Math.min(MESH_CLIP_FADE_SECONDS, fade.t + dtSeconds);
    const p = fade.t / MESH_CLIP_FADE_SECONDS;
    action.setEffectiveWeight(fade.from + (fade.to - fade.from) * p);
    if (fade.t >= MESH_CLIP_FADE_SECONDS) {
      player.fades.delete(name);
      if (fade.to === 0) action.stop();
    }
  }
}
