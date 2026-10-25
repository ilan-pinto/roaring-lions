/**
 * E6 (GH-274) chunk C: what a laser carrier's beam LOOKS like, as pure numbers.
 * Spec 2026-10-24 (e6-art) section 6.2; the lead approved the look verbatim:
 *
 *   "a white-hot core with an ember sheath and a heat shimmer at the target. It narrows and
 *    brightens while it locks on, pulses with sparks on a hit, and snaps off with vent puffs on
 *    the truck when it overheats. Heat shows only on the unit card, not in the world."
 *
 * Pure and `three`-free, like `swarm-layout.ts`: `beam-batch.ts` draws what this decides, and
 * nothing here reads or writes the sim. The inputs are exactly what the sim gives a renderer -
 * `Sim.beamState(entity, slot)` (target, dwell, locked) and the `beam` event's two phases.
 *
 * ## The state table (spec 6.2), and which function line answers each row
 *
 * | sim state                                     | the look                                        |
 * |-----------------------------------------------|-------------------------------------------------|
 * | no target, not locked                         | a BREAK: the beam fades over 80 ms; the lens    |
 * |                                               | glow over 150 ms                                |
 * | target held (lasing)                          | fade-in, and the DWELL focuses it: sheath 6 -> 3 |
 * |                                               | px, alpha 0.35 -> 0.85, target glow 0.06 -> 0.12 |
 * |                                               | tile, shimmer 0.4 -> 1.0                        |
 * | `struck` event                                | a 120 ms pulse: core x2, sheath x1.6, glow x1.8 |
 * | `lockout` event, or `locked`                  | a SNAP: no beam, no lens glow, this frame       |
 * | heat                                          | NOTHING in the world (the unit card shows it)   |
 *
 * A break and a lockout are different roads on purpose: a lockout is a forced shutdown and snaps,
 * a break is a target lost to smoke, a wall or a switch and fades. The sim emits no reason for a
 * break, so none is drawn.
 *
 * ## The clock
 *
 * Every envelope runs on the SIM clock (`presentationSimMs`), the sway/decal rule: a frozen
 * capture repeats, a paused game holds its pulse, and a zero-time repaint changes nothing. The
 * `struck` pulse is stamped with its EVENT's own time (`tick * 50`) rather than aged from the
 * frame it was noticed on, so a harness that steps many ticks and paints once still sees a pulse
 * struck on the last tick. The first frame a beam is seen seeds its fade-in from how long the sim
 * says the dwell has run, so a capture taken some ticks into a lock never photographs a beam
 * that has not faded in yet.
 */
import { TILE_W } from '../../project';

/** Core ribbon, screen pixels (spec 6.1). */
export const BEAM_CORE_PX = 1.2;
/** Sheath ribbon at zero dwell and at full dwell, screen pixels. */
export const BEAM_SHEATH_PX_UNFOCUSED = 6;
export const BEAM_SHEATH_PX_FOCUSED = 3;
/** Sheath alpha at zero and at full dwell. */
export const BEAM_SHEATH_ALPHA_UNFOCUSED = 0.35;
export const BEAM_SHEATH_ALPHA_FOCUSED = 0.85;
/** Target glow radius at zero and at full dwell, tiles. */
export const BEAM_TARGET_GLOW_UNFOCUSED_TILES = 0.06;
export const BEAM_TARGET_GLOW_FOCUSED_TILES = 0.12;
/** The lens glow at the muzzle, tiles. */
export const BEAM_LENS_GLOW_TILES = 0.18;

/** A beam coming up. Spec 6.2 says "fade-in" without a number; 80 ms mirrors the break's. */
export const BEAM_FADE_IN_MS = 80;
/** A break (target lost, no lockout): the beam fades over this long. */
export const BEAM_BREAK_FADE_MS = 80;
/** The lens glow's fade when the beam is gone and the carrier is not locked out. */
export const BEAM_LENS_FADE_MS = 150;
/** A `struck` pulse: how long, and the factor on each part at its peak. */
export const BEAM_STRUCK_PULSE_MS = 120;
export const BEAM_PULSE_CORE = 2;
export const BEAM_PULSE_SHEATH = 1.6;
export const BEAM_PULSE_GLOW = 1.8;
/** The heat shimmer at the target: amplitude `0.4 + 0.6 d`, spiking to 1 on a strike. */
export const BEAM_SHIMMER_BASE = 0.4;
export const BEAM_SHIMMER_FOCUS_GAIN = 0.6;

/** Milliseconds a sim tick spans (20 Hz). Restated, as `swarm-layout.ts` restates the swarm's. */
export const BEAM_MS_PER_TICK = 50;

/**
 * Screen pixels per world unit at zoom 1: the dimetric camera frames `vp.width / (TILE_W * zoom *
 * sqrt 2)` view units across `vp.width` pixels, so a view unit is `TILE_W * zoom * sqrt 2 / 2` px
 * (`silhouette.ts`'s `SILHOUETTE_PX_PER_WORLD_UNIT`, the same derivation; a test pins them equal).
 */
export const BEAM_PX_PER_WORLD_UNIT = (TILE_W * Math.SQRT2) / 2;

/** A width held constant in SCREEN pixels, as world units, at `zoom` (clamped 0.35-2.5 by the app). */
export function beamPxToWorld(px: number, zoom: number): number {
  return px / (BEAM_PX_PER_WORLD_UNIT * Math.max(zoom, 1e-3));
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * The dwell as a 0..1 focus. `Sim.beamState` reads the dwell AS THE NEXT TICK WILL SEE IT, one
 * tick ahead of what a frame at `alpha = 0` presents, so the displayed dwell is `dwell - 1 +
 * alpha` (positions interpolate the same way). A dwell of 0 - the beam has not locked on yet, or
 * a strike just reset it - is 0, never `-1 + alpha`.
 */
export function beamFocus(dwell: number, alpha: number, dwellTicks: number): number {
  if (dwell <= 0 || dwellTicks <= 0) return 0;
  return clamp01((dwell - 1 + alpha) / dwellTicks);
}

/** Per-slot state the envelopes carry between frames. */
export interface BeamLookState {
  /** False until the first frame this slot was looked at. */
  seen: boolean;
  /** The ribbons' envelope, 0..1. */
  env: number;
  /** The lens glow's envelope, 0..1. */
  lens: number;
  /** The last focus the beam had, held while it fades (the sim reads dwell 0 once it breaks). */
  focus: number;
  /** The sim time (ms) of the last frame. */
  lastMs: number;
  /** The sim time (ms) of the last `struck` event; -Infinity for none. */
  struckAtMs: number;
}

export function newBeamLookState(): BeamLookState {
  return { seen: false, env: 0, lens: 0, focus: 0, lastMs: 0, struckAtMs: Number.NEGATIVE_INFINITY };
}

/** What the sim says about one beam slot this frame, plus the events that arrived for it. */
export interface BeamLookInput {
  /** `beamState.target`: the held target, -1 for none. */
  target: number;
  /** `beamState.dwell`, in ticks. */
  dwell: number;
  /** `beamState.locked`: inside a lockout. */
  locked: boolean;
  /** The weapon's `beam.dwellTicks`, read from the unit type. */
  dwellTicks: number;
  /** The frame's interpolation fraction. */
  alpha: number;
  /** `presentationSimMs` of this frame. */
  nowMs: number;
  /** The sim time of a `struck` event that arrived since the last frame, or null. */
  struckAtMs: number | null;
  /** A `lockout` event arrived since the last frame. */
  lockout: boolean;
}

/** The look of one beam this frame. Every width is a screen-pixel width unless it says tiles. */
export interface BeamLook {
  /** Draw the ribbons (core and sheath) and the target glow. */
  ribbon: boolean;
  /** Draw the lens glow at the muzzle. */
  lens: boolean;
  corePx: number;
  coreAlpha: number;
  sheathPx: number;
  sheathAlpha: number;
  targetGlowTiles: number;
  targetGlowAlpha: number;
  lensGlowTiles: number;
  lensGlowAlpha: number;
  /** The heat shimmer's amplitude at the target, 0..1; 0 when there is no beam. */
  shimmerAmp: number;
  /** The 0..1 dwell focus the sheath is drawn at. */
  focus: number;
  /** The strike pulse, 1 at the strike and 0 once it is over. */
  pulse: number;
}

export function newBeamLook(): BeamLook {
  return {
    ribbon: false, lens: false, corePx: 0, coreAlpha: 0, sheathPx: 0, sheathAlpha: 0,
    targetGlowTiles: 0, targetGlowAlpha: 0, lensGlowTiles: 0, lensGlowAlpha: 0, shimmerAmp: 0, focus: 0, pulse: 0,
  };
}

/**
 * Advances `state` by one frame and writes the look into `out`.
 *
 * Order matters in exactly one place: a lockout (the event, or `locked`) wins over everything
 * else that arrived with it, a `struck` on the very tick the heat ran out included - the beam
 * dies and the pulse with it.
 */
export function stepBeamLook(state: BeamLookState, input: BeamLookInput, out: BeamLook): BeamLook {
  const snapped = input.locked || input.lockout;
  const lasing = input.target >= 0 && !snapped;

  if (input.struckAtMs !== null && input.struckAtMs > state.struckAtMs) state.struckAtMs = input.struckAtMs;

  const focusNow = lasing ? beamFocus(input.dwell, input.alpha, input.dwellTicks) : state.focus;

  if (!state.seen) {
    state.seen = true;
    // How long the sim says the dwell has run, in ms; a lock several ticks old is fully faded in.
    const ranMs = lasing && input.dwell > 0 ? (input.dwell - 1 + input.alpha) * BEAM_MS_PER_TICK : 0;
    state.env = lasing ? clamp01(ranMs / BEAM_FADE_IN_MS) : 0;
    state.lens = state.env;
  } else {
    const dt = Math.max(0, input.nowMs - state.lastMs);
    if (lasing) {
      state.env = Math.min(1, state.env + dt / BEAM_FADE_IN_MS);
      state.lens = Math.max(state.lens, state.env);
    } else if (!snapped) {
      // A break: the target was lost with no lockout, so it fades rather than snaps.
      state.env = Math.max(0, state.env - dt / BEAM_BREAK_FADE_MS);
      state.lens = Math.max(0, state.lens - dt / BEAM_LENS_FADE_MS);
    }
  }
  if (snapped) {
    // A forced shutdown (the lockout road, and the only one): no fade, no lens glow, no pulse.
    state.env = 0;
    state.lens = 0;
    state.struckAtMs = Number.NEGATIVE_INFINITY;
  }
  state.lastMs = input.nowMs;
  state.focus = focusNow;

  const pulse = clamp01(1 - Math.max(0, input.nowMs - state.struckAtMs) / BEAM_STRUCK_PULSE_MS);
  const env = state.env;
  const focus = state.focus;

  out.ribbon = env > 0;
  out.lens = state.lens > 0;
  out.focus = focus;
  out.pulse = pulse;
  out.corePx = BEAM_CORE_PX * lerp(1, BEAM_PULSE_CORE, pulse);
  out.coreAlpha = env;
  out.sheathPx = lerp(BEAM_SHEATH_PX_UNFOCUSED, BEAM_SHEATH_PX_FOCUSED, focus) * lerp(1, BEAM_PULSE_SHEATH, pulse);
  out.sheathAlpha = clamp01(lerp(BEAM_SHEATH_ALPHA_UNFOCUSED, BEAM_SHEATH_ALPHA_FOCUSED, focus) * env);
  out.targetGlowTiles =
    lerp(BEAM_TARGET_GLOW_UNFOCUSED_TILES, BEAM_TARGET_GLOW_FOCUSED_TILES, focus) * lerp(1, BEAM_PULSE_GLOW, pulse);
  out.targetGlowAlpha = env;
  out.lensGlowTiles = BEAM_LENS_GLOW_TILES;
  out.lensGlowAlpha = state.lens;
  out.shimmerAmp = env * lerp(BEAM_SHIMMER_BASE + BEAM_SHIMMER_FOCUS_GAIN * focus, 1, pulse);
  return out;
}
