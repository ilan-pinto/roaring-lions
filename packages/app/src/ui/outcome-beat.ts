// packages/app/src/ui/outcome-beat.ts
/**
 * The held beat around the victory/defeat moment (PA-07, lead ruling 9 Oct
 * on PR 485: "B with A's band"). `outcome-moment.ts` draws the letterbox and
 * the verdict band; this file holds what the battlefield does underneath
 * it, as pure functions `main.ts` applies once per frame:
 *
 *  - Presentation time eases to 0.25x (`beatPose().timeScale`), which
 *    `main.ts` multiplies into the frame's `dtMs` for the renderer alone.
 *    The sim is NOT slowed and NOT ticked: the mission has already ended,
 *    and `main.ts` holds the tick accumulator for the whole beat
 *    (invariants 1 and 4: nothing here reaches the sim).
 *  - The camera eases to the deciding ground (`beatFocus`) over 1.8 s and
 *    zooms in 35% (`beatCamera`).
 *  - The HUD steps back (`hideForBeat`), and stays back under the report.
 *
 * Reduced motion: no camera ease and no time slow (`beatPose(_, true)`).
 * The moment itself cuts straight to the band (`data-beat="cut"`) and keeps
 * its full hold, as `outcome-moment.ts`'s rule 1 already requires.
 */
import type { OutcomeMoment } from './outcome-moment';

/** Presentation time at the bottom of the ease. */
export const BEAT_SLOW = 0.25;
/** How long time takes to ease down to `BEAT_SLOW`. */
export const BEAT_SLOW_IN_MS = 300;
/** How long the camera takes to reach the deciding ground. */
export const BEAT_CAMERA_MS = 1800;
/** How much closer the camera ends up (+35%). */
export const BEAT_ZOOM = 0.35;
/** `main.ts`'s own zoom clamp (0.35-2.5): the beat never zooms past it. */
const ZOOM_MAX = 2.5;

const clamp01 = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x);
const easeOut = (x: number): number => 1 - Math.pow(1 - x, 3);
const easeInOut = (x: number): number => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

export interface BeatPose {
  /** Multiplies the frame's presentation `dtMs`; never the tick. */
  readonly timeScale: number;
  /** 0 = where the camera was when the mission ended, 1 = the focus. */
  readonly camera: number;
}

export function beatPose(elapsedMs: number, reduced: boolean): BeatPose {
  if (reduced) return { timeScale: 1, camera: 0 };
  return {
    timeScale: 1 - (1 - BEAT_SLOW) * easeOut(clamp01(elapsedMs / BEAT_SLOW_IN_MS)),
    camera: easeInOut(clamp01(elapsedMs / BEAT_CAMERA_MS)),
  };
}

export interface BeatCamera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export function beatCamera(from: BeatCamera, focus: { x: number; y: number }, mix: number): BeatCamera {
  return {
    x: from.x + (focus.x - from.x) * mix,
    y: from.y + (focus.y - from.y) * mix,
    zoom: Math.min(ZOOM_MAX, from.zoom * (1 + BEAT_ZOOM * mix)),
  };
}

export interface BeatFocusInput {
  readonly result: 'victory' | 'defeat';
  /** The mission's objectives with their final status; `target` is the
   *  authored zone name (mission JSON), where there is one. */
  readonly objectives: readonly { type: string; primary: boolean; status: string; target?: string }[];
  readonly zones: Readonly<Record<string, readonly [number, number, number, number]>>;
  /** Living civilians, in tiles. */
  readonly civilians: readonly { x: number; y: number }[];
  /** Living side-0 units, in tiles. */
  readonly force: readonly { x: number; y: number }[];
}

const centreOf = (z: readonly [number, number, number, number]): { x: number; y: number } => ({
  x: z[0] + z[2] / 2,
  y: z[1] + z[3] / 2,
});
const inside = (p: { x: number; y: number }, z: readonly [number, number, number, number]): boolean =>
  p.x >= z[0] && p.x < z[0] + z[2] && p.y >= z[1] && p.y < z[1] + z[3];

/**
 * Where the beat looks, or null to leave the camera where the player had it.
 *
 * - Victory: the zone of the last completed primary that names one (First
 *   Light: the compound the families reached); else the living force.
 * - Defeat: the failed primary's zone; for a lost evacuation, the civilian
 *   still outside that zone who came nearest to it (the family that did not
 *   make it); else the living force, if any.
 */
export function beatFocus(i: BeatFocusInput): { x: number; y: number } | null {
  const want = i.result === 'victory' ? 'complete' : 'failed';
  const decided = i.objectives.filter((o) => o.primary && o.status === want && o.target !== undefined && i.zones[o.target] !== undefined);
  const o = decided[decided.length - 1];
  if (o?.target !== undefined) {
    const zone = i.zones[o.target];
    if (zone !== undefined) {
      const c = centreOf(zone);
      if (i.result === 'defeat' && o.type === 'evacuate_before') {
        let best: { x: number; y: number } | null = null;
        let bestD = Infinity;
        for (const p of i.civilians) {
          if (inside(p, zone)) continue;
          const d = Math.hypot(p.x - c.x, p.y - c.y);
          if (d < bestD) {
            bestD = d;
            best = p;
          }
        }
        if (best !== null) return { x: best.x, y: best.y };
      }
      return c;
    }
  }
  if (i.force.length === 0) return null;
  let x = 0;
  let y = 0;
  for (const p of i.force) {
    x += p.x;
    y += p.y;
  }
  return { x: x / i.force.length, y: y / i.force.length };
}

/**
 * The beat hands over to the report: once, when the moment's hold runs out
 * or the player skips it -- and never on a battlefield already torn down
 * (`isDisposed`), the same guard `main.ts`'s deferred blocks use.
 */
export function beatThenReport(moment: OutcomeMoment, isDisposed: () => boolean, report: () => void): void {
  void moment.done.then(() => {
    if (isDisposed()) return;
    report();
  });
}

/**
 * Steps the HUD back for the beat: every child of `body` present NOW, except
 * `keep` (the stage, the moment) and non-visual nodes, takes
 * `.rl-beat-hidden`, and `body[data-outcome-beat]` is set so the report that
 * follows can arrive the beat's way (theme.css). Anything mounted later --
 * the report, a dialog -- is untouched. Returns an idempotent undo for the
 * battlefield's disposer: the HUD stays back under the report until then.
 */
export function hideForBeat(body: HTMLElement, keep: readonly Element[]): () => void {
  const hidden: HTMLElement[] = [];
  for (const k of Array.from(body.children)) {
    if (!(k instanceof HTMLElement) || keep.includes(k)) continue;
    if (k.tagName === 'SCRIPT' || k.tagName === 'AUDIO' || k.tagName === 'STYLE') continue;
    k.classList.add('rl-beat-hidden');
    hidden.push(k);
  }
  body.dataset.outcomeBeat = '1';
  let undone = false;
  return () => {
    if (undone) return;
    undone = true;
    for (const k of hidden) k.classList.remove('rl-beat-hidden');
    delete body.dataset.outcomeBeat;
  };
}
