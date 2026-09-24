/**
 * The scene host's decisions, with no DOM in them: which path a menu visit
 * takes (spec §3.4), what each lifecycle event does from each state (spec §5),
 * and the parallax arithmetic (spec §3.5).
 *
 * `ui/scene-host.ts` is the thin executor over this file. Everything a leak
 * could hide in -- a view that arrives after nobody wants it, a deadline that
 * lands after the reveal, a failure the host caused itself by aborting -- is a
 * row of `hostStep`'s table here, with a test, rather than a branch buried in
 * promise callbacks there.
 */
import type { RendererChoice } from '../renderer-choice';

/** Mount to reveal, past which the plate stays for good and the load is
 *  aborted (spec §3.3 (8), §10): ~3x the 20 Mbit/s reveal, ~9x CI's
 *  rasteriser. */
export const HOST_DEADLINE_MS = 15000;
/** The canvas fading in over the poster. theme.css's `--dur-host-reveal` is
 *  the same duration, and a test pins the two together. */
export const CROSSFADE_MS = 400;
/** The parallax easing's time constant (spec §3.5, a proposal judged on
 *  motion). */
export const PARALLAX_TAU_MS = 700;
/** A column wider than this share of the viewport leaves no flanks worth
 *  drawing: the host is `off`. */
export const NARROW_COLUMN_SHARE = 0.7;
/** How long the live path's work may wait for an idle moment after the menu
 *  paints (spec §3.3 (1)). */
export const IDLE_START_TIMEOUT_MS = 500;
/** Parallax offsets closer than this to their target are settled, and the
 *  easing loop stops. */
export const PARALLAX_SETTLE_EPS = 0.001;

/** The same 100 ms clamp every other clock here uses. */
const MAX_FRAME_MS = 100;

export interface HostInputs {
  readonly renderer: RendererChoice;
  readonly reducedMotion: boolean;
  readonly saveData: boolean;
  /** `window.innerWidth`, CSS px. */
  readonly viewportWidth: number;
  /** The menu column's rendered width, CSS px. */
  readonly columnWidth: number;
  /** The throwaway-canvas probe. A function, so it runs only when every
   *  cheaper reason has passed. */
  readonly webgl2: () => boolean;
}

/** Why a host shows the plate: the four decided at mount, and the two the
 *  live path can end in. */
export type PlateReason = 'pixi' | 'reduced-motion' | 'save-data' | 'no-webgl2' | 'load-failed' | 'deadline';

export type HostPath =
  | { readonly path: 'live' }
  | { readonly path: 'plate'; readonly reason: PlateReason }
  | { readonly path: 'off'; readonly reason: 'narrow' };

/**
 * Spec §3.4, in its order. Narrow comes first because on a phone there is no
 * picture to choose between. The WebGL2 probe comes LAST, so a Pixi,
 * reduced-motion or save-data player never creates even a throwaway context --
 * the campaign board's rule.
 */
export function hostPath(i: HostInputs): HostPath {
  // `!(w > 0)` rather than `w <= 0`: a NaN width is narrow too, never live.
  if (!(i.viewportWidth > 0) || i.columnWidth / i.viewportWidth > NARROW_COLUMN_SHARE) {
    return { path: 'off', reason: 'narrow' };
  }
  if (i.renderer === 'pixi') return { path: 'plate', reason: 'pixi' };
  if (i.reducedMotion) return { path: 'plate', reason: 'reduced-motion' };
  if (i.saveData) return { path: 'plate', reason: 'save-data' };
  if (!i.webgl2()) return { path: 'plate', reason: 'no-webgl2' };
  return { path: 'live' };
}

/** `pending` is the poster while the live path loads; `plate` is the poster
 *  for good. `off` draws nothing. `disposed` is after the menu was left. */
export type HostState = 'pending' | 'live' | 'plate' | 'off' | 'disposed';

export type HostEvent =
  /** The door resolved with a view. */
  | { readonly type: 'ready' }
  /** The door, the dynamic import or the world build failed. */
  | { readonly type: 'failed' }
  /** `HOST_DEADLINE_MS` passed. */
  | { readonly type: 'deadline' }
  /** The menu was left. */
  | { readonly type: 'dispose' };

export type HostEffect =
  /** Show the live canvas; the poster leaves after the crossfade. */
  | 'reveal'
  /** Stay on the poster, for good, with the step's `reason`. */
  | 'keep-plate'
  /** Say why, once, in the console. */
  | 'warn'
  /** Abort the door's load. */
  | 'abort'
  /** Dispose the view: the one this `ready` delivered, or the one held. */
  | 'dispose-view';

export interface HostStep {
  readonly state: HostState;
  readonly effects: readonly HostEffect[];
  /** Set on the two transitions into `plate`. */
  readonly reason?: PlateReason;
}

const stay = (state: HostState): HostStep => ({ state, effects: [] });

/** Spec §5, row by row, and every other cell too. Pure. */
export function hostStep(state: HostState, event: HostEvent): HostStep {
  if (event.type === 'dispose') {
    return state === 'disposed' ? stay(state) : { state: 'disposed', effects: ['abort', 'dispose-view'] };
  }
  if (state === 'pending') {
    if (event.type === 'ready') return { state: 'live', effects: ['reveal'] };
    if (event.type === 'failed') return { state: 'plate', effects: ['keep-plate', 'warn'], reason: 'load-failed' };
    return { state: 'plate', effects: ['keep-plate', 'abort', 'warn'], reason: 'deadline' };
  }
  // The leak rows: outside `pending`, a view that arrives is one nobody wants,
  // and it is destroyed the moment it arrives or it holds ~0.5 GB (spec M14).
  // `plate` and `disposed` are the two a path reaches (a view landing after
  // the deadline or the leave); `live` and `off` are unreachable today (the
  // door settles once, and `off` never starts a load) and dispose it anyway,
  // so a stranded view is impossible rather than merely unlikely.
  if (event.type === 'ready') return { state, effects: ['dispose-view'] };
  // Anything else outside `pending` is late news -- of an abort the host
  // itself caused (a deadline or a leave), which already said what it had
  // to, or a deadline after the reveal, which `live` ignores.
  return stay(state);
}

/**
 * Where the picture should sit for a pointer at `(px, py)` in a `vw` x `vh`
 * viewport: unitless, in [-1, 1] per axis, and AGAINST the pointer -- the
 * scene is seen through the column like a window. A zero-sized viewport reads
 * centre.
 */
export function parallaxTarget(px: number, py: number, vw: number, vh: number): { x: number; y: number } {
  const axis = (p: number, size: number): number => {
    if (!(size > 0)) return 0;
    // `+ 0` turns a `-0` (a centred pointer) into `0`.
    return Math.min(1, Math.max(-1, 1 - (2 * p) / size)) + 0;
  };
  return { x: axis(px, vw), y: axis(py, vh) };
}

/**
 * Exponential approach from `cur` toward `tgt` over `dtMs`, with time
 * constant `tauMs`. `dtMs` is clamped to 100 ms, so a tab that slept does not
 * jump the picture across the bleed in one frame, and negative time is none.
 * Never overshoots.
 */
export function easeToward(cur: number, tgt: number, dtMs: number, tauMs: number): number {
  const dt = Math.min(MAX_FRAME_MS, dtMs);
  if (!(dt > 0)) return cur;
  if (!(tauMs > 0)) return tgt;
  return tgt + (cur - tgt) * Math.exp(-dt / tauMs);
}
