/**
 * `stanceOf(i)`: is this unit standing, dropping to a knee, kneeling or
 * rising? The one adapter the renderer reads the kneel through.
 *
 * The sim owns the answer once PR #402 (halt-to-fire) lands: `state.brace`
 * (BRACE_NONE 0, DROPPING 1, KNEELING 2, RISING 3) and `state.braceTicks`,
 * the ticks LEFT in a drop or a rise -- 4 each (`KNEEL_DROP_TICKS`,
 * `KNEEL_RISE_TICKS`, read from the sim when it exports them), shorter when
 * a transition is interrupted, so the clip is driven by ticks left, never by
 * a clock of its own. This branch
 * does not depend on #402: the field is feature-detected, and without it
 * the stance is inferred from what the renderer already sees -- a unit that
 * is stationary and has fired recently kneels; one that moves stands.
 *
 * Presentation only (invariant 4): nothing here writes sim state.
 */
import * as simModule from '@lions/sim';
import type { Stance } from './squad-motion';

export const BRACE_NONE = 0;
export const BRACE_DROPPING = 1;
export const BRACE_KNEELING = 2;
export const BRACE_RISING = 3;
/** The drop and rise length when the sim does not say: 4 ticks, 0.2 s (the
 *  lead's ruling on #402, 5 Oct). */
export const BRACE_TRANSITION_TICKS_DEFAULT = 4;

function exportedTicks(name: string): number {
  // Feature-detected rather than imported by name: this branch must build
  // before #402 lands, and a retune of the sim constant must need no
  // re-export of the clips -- they are scrubbed by fraction, so only this
  // number has to be right.
  const v = (simModule as Record<string, unknown>)[name];
  return typeof v === 'number' && v > 0 ? v : BRACE_TRANSITION_TICKS_DEFAULT;
}

/** Ticks in the sim's drop and in its rise (`KNEEL_DROP_TICKS`,
 *  `KNEEL_RISE_TICKS` from `@lions/sim` when it exports them). */
export const KNEEL_DROP_TICKS_RT = exportedTicks('KNEEL_DROP_TICKS');
export const KNEEL_RISE_TICKS_RT = exportedTicks('KNEEL_RISE_TICKS');
/** Fallback only: a stationary unit stays down this long after its last shot. */
export const FALLBACK_KNEEL_HOLD_S = 3;

export interface StanceSource {
  /** `sim.state` -- read for `brace`/`braceTicks` when the sim has them. */
  readonly state: object;
}

export interface StanceReading {
  readonly stance: Stance;
  /** 0..1 through a drop or a rise (`dropping`/`rising` only). */
  readonly progress: number;
  /** True when the sim said so; false when this was inferred. */
  readonly fromSim: boolean;
}

interface BraceArrays {
  brace?: Uint8Array;
  braceTicks?: Int32Array;
}

/** Whether this sim carries #402's stance arrays. */
export function simHasBrace(src: StanceSource): boolean {
  const s = src.state as BraceArrays;
  return s.brace instanceof Uint8Array && s.braceTicks instanceof Int32Array;
}

/**
 * The stance of unit `i`. `alpha` is the frame's interpolation between the
 * last two ticks, so a 4-tick drop advances smoothly at 60 fps. The fallback
 * reads `speed` (tiles/s) and `sinceShotS` (seconds since this unit last
 * fired; Infinity if never), and keeps its own previous answer in `prev`.
 */
export function stanceOf(
  src: StanceSource,
  i: number,
  alpha: number,
  fallback: { speed: number; sinceShotS: number; prevDepth: number }
): StanceReading {
  const s = src.state as BraceArrays;
  if (s.brace instanceof Uint8Array && s.braceTicks instanceof Int32Array) {
    const b = s.brace[i];
    // Time remaining is braceTicks x 50 ms; through the transition is that
    // over the sim's own length for it.
    const total = b === BRACE_RISING ? KNEEL_RISE_TICKS_RT : KNEEL_DROP_TICKS_RT;
    const left = Math.max(0, s.braceTicks[i] - alpha);
    const progress = Math.min(1, Math.max(0, 1 - left / total));
    if (b === BRACE_DROPPING) return { stance: 'dropping', progress, fromSim: true };
    if (b === BRACE_KNEELING) return { stance: 'kneeling', progress: 1, fromSim: true };
    if (b === BRACE_RISING) return { stance: 'rising', progress, fromSim: true };
    return { stance: 'none', progress: 0, fromSim: true };
  }
  const wantDown = fallback.speed === 0 && fallback.sinceShotS < FALLBACK_KNEEL_HOLD_S;
  if (wantDown) {
    return fallback.prevDepth >= 1
      ? { stance: 'kneeling', progress: 1, fromSim: false }
      : { stance: 'dropping', progress: fallback.prevDepth, fromSim: false };
  }
  return fallback.prevDepth > 0
    ? { stance: 'rising', progress: 1 - fallback.prevDepth, fromSim: false }
    : { stance: 'none', progress: 0, fromSim: false };
}
