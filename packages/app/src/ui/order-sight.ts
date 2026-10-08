// The stadia aim and the eight order surrounds -- G1's approved sheet, round 5
// ("Can you add more colors", the lead, 2026-09-28), ported verbatim from the
// scratch design sources `.superpowers/g1-symbols/r5/orders.ts` and
// `r5/NOTES.md`. Round 4's shapes, motion and periods are unchanged; round 5
// added colour by order family, every value a `data/palette.json` KEY. This
// module never reads that file itself -- colour is a caller-supplied
// `SightPaint` of already-resolved values (a cursor frame) or `currentColor`
// (a HUD mark, via `orderMarkBody`), which is what keeps this module pure and
// importable from `vite-plugin-cursors.ts` the way `mark.ts` and
// `kit-sign.ts` already are.
//
// "Derived from the chevron's sweep" (the family's round-1 rule) now applies
// only to the aim's own chevron -- an APP-6 frame dictates its own angles and
// wins over it everywhere else in the sheet (`symbol.ts`'s role frames).

import { CHEVRON_SWEEP } from './mark';
import type { OrderId } from './selection-model';

type P = [number, number];
const W = 2.5;
const H = W / 2;
/** The aim's chevron leans at the mark's own sweep (Q12) -- the one shape in
 *  this sheet with no APP-6 original of its own to dictate an angle instead. */
const S = CHEVRON_SWEEP;

const r = (v: number): number => Math.round(v * 100) / 100;
const poly = (pts: readonly P[]): string => 'M' + pts.map(([x, y]) => `${r(x)} ${r(y)}`).join(' L') + ' Z';
const fill = (d: string, op: number, col: string): string =>
  `<path d="${d}" fill="${col}"${op < 1 ? ` opacity="${r(Math.max(0, op))}"` : ''}/>`;
const fillEo = (d: string, op: number, col: string): string =>
  `<path d="${d}" fill="${col}" fill-rule="evenodd"${op < 1 ? ` opacity="${r(Math.max(0, op))}"` : ''}/>`;
const rect = (x0: number, y0: number, x1: number, y1: number): P[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];
const circle = (cx: number, cy: number, rad: number): string =>
  `M${r(cx - rad)} ${r(cy)} a${r(rad)} ${r(rad)} 0 1 0 ${r(2 * rad)} 0 a${r(rad)} ${r(rad)} 0 1 0 ${r(-2 * rad)} 0 Z`;
const clamp = (v: number, a = 0, b = 1): number => Math.max(a, Math.min(b, v));
const ease = (v: number): number => 1 - Math.pow(1 - clamp(v), 3);
function band(a: P, b: P, w = W): string {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy);
  const nx = (-dy / l) * (w / 2);
  const ny = (dx / l) * (w / 2);
  return poly([
    [a[0] + nx, a[1] + ny],
    [b[0] + nx, b[1] + ny],
    [b[0] - nx, b[1] - ny],
    [a[0] - nx, a[1] - ny],
  ]);
}
function stadiumD(x0: number, y0: number, x1: number, y1: number): string {
  const rr = (y1 - y0) / 2;
  return `M${r(x0 + rr)} ${r(y0)} H${r(x1 - rr)} A${r(rr)} ${r(rr)} 0 0 1 ${r(x1 - rr)} ${r(y1)} H${r(x0 + rr)} A${r(rr)} ${r(rr)} 0 0 1 ${r(x0 + rr)} ${r(y0)} Z`;
}
/** An open chevron, tip up: two arms leaning `S` off vertical, broken once at
 *  the mil marks, stopping short of the hotspot. */
function chevUp(cx: number, tipY: number, halfW: number): P[] {
  const h = halfW / S;
  const WD = (W * Math.hypot(7, 12)) / 12;
  return [
    [cx, tipY],
    [cx + halfW, tipY + h],
    [cx + halfW - WD, tipY + h],
    [cx, tipY + WD / S],
    [cx - halfW + WD, tipY + h],
    [cx - halfW, tipY + h],
  ];
}
/** An arrowhead pointing right, tip at `x`, centred on `cy`, half-height `h`. */
function headR(x: number, cy: number, h: number): P[] {
  return [
    [x, cy],
    [x - h * 1.1, cy - h],
    [x - h * 1.1, cy + h],
  ];
}

export type SightOrderId = 'move' | 'attackMove' | 'halt' | 'smoke' | 'load' | 'unload' | 'sweep' | 'strike';
export type OrderFamily = 'manoeuvre' | 'offensive' | 'control' | 'obscurant' | 'transport';

export interface OrderSightSpec {
  readonly family: OrderFamily;
  readonly main: string;
  readonly accent: string;
  readonly periodMs: number;
  /** `t` in [0,1); `phases[0]` is the Q14 rest pose (frame 0: reduced motion,
   *  the static HUD mark). */
  readonly phases: readonly number[];
}

/** `n` samples starting at the Q14 rest pose and stepping evenly through the
 *  cycle, so `phases[0]` is always the rest frame and the rest is never
 *  favoured to one side of the loop. */
function phasesFrom(rest: number, frames: number): readonly number[] {
  const step = 1 / frames;
  const out: number[] = [];
  for (let k = 0; k < frames; k++) out.push(Math.round(((rest + k * step) % 1) * 10000) / 10000);
  return Object.freeze(out);
}

/**
 * The sheet's one colour table (r5 `orders.ts`'s `COLOUR`, r5 `NOTES.md`'s
 * family table), plus the Q14 phase tables chosen for this port.
 *
 * Q14 rest poses (frame 0) and frame counts, as ruled: move 0.7/4,
 * attackMove 0.5/4, halt 0.4/6, smoke 0.6/4, load 0.5/4, unload 0.5/4,
 * sweep 0.5/4, strike 0.5/6. Every order but halt takes the plain
 * "step by 1/frames from the rest pose" table with no nudge needed. Two
 * dead zones were checked by hand: move's beat window is t in (0.62, 0.85),
 * and its rest pose 0.7 already sits inside it; strike's four impact
 * windows are wide enough (`born, born + 0.324`, four of them) that the
 * plain 1/6 table clears one without help (t=0.5 lands in the first).
 *
 * Halt alone needs a hand-picked table, for a reason the "one dead zone"
 * framing undersells: halt's `surround` is not just occasionally flat, it
 * is flat (`drop=1`, same y, same main colour) across the ENTIRE plateau
 * t in [0.3, 0.8) -- more than a third of the cycle -- so `0.4 + k/6` walks
 * two full steps (0.4, 0.5667) before leaving it, and adjacent frames 0 and
 * 1 render byte-identical. `phases[0] = 0.4` is fixed by Q14 (the rest
 * pose); the other five are chosen to each land in a different one of the
 * surround's other three regimes -- drop-in [0, 0.18), the stamp beat
 * [0.18, 0.3), and lift-off [0.8, 1) -- so no two adjacent samples,
 * including the wrap back to 0.4, share a regime. Falsified by hand: the
 * plain `phasesFrom(0.4, 6)` table (0.4, 0.5667, 0.7333, 0.9, 0.0667,
 * 0.2333) fails "no adjacent frames are identical" on frames 0 and 1,
 * both inside the plateau.
 */
const HALT_PHASES: readonly number[] = Object.freeze([0.4, 0.85, 0.95, 0.05, 0.15, 0.25]);

// The transport oval was `grass.0`, a ramp palette.json declares "not curated
// for sprite art" (register VR-06). `limestone.1` is the curated entry at the
// same lightness (the oval is a pale container outline, so it keeps its value
// and loses only the green cast); it sits beside obscurant's `limestone.0`.
export const ORDER_SIGHT: Readonly<Record<SightOrderId, OrderSightSpec>> = {
  move: { family: 'manoeuvre', main: 'vfx.interceptor', accent: 'vfx.white_hot', periodMs: 1200, phases: phasesFrom(0.7, 4) },
  attackMove: { family: 'offensive', main: 'team.hostile_text', accent: 'vfx.fire', periodMs: 900, phases: phasesFrom(0.5, 4) },
  halt: { family: 'control', main: 'team.neutral', accent: 'vfx.white_hot', periodMs: 1300, phases: HALT_PHASES },
  smoke: { family: 'obscurant', main: 'limestone.0', accent: 'gunmetal.1', periodMs: 1600, phases: phasesFrom(0.6, 4) },
  load: { family: 'transport', main: 'vfx.tracer', accent: 'limestone.1', periodMs: 1100, phases: phasesFrom(0.5, 4) },
  unload: { family: 'transport', main: 'vfx.tracer', accent: 'limestone.1', periodMs: 1100, phases: phasesFrom(0.5, 4) },
  sweep: { family: 'manoeuvre', main: 'vfx.interceptor', accent: 'water.0', periodMs: 1800, phases: phasesFrom(0.5, 4) },
  strike: { family: 'offensive', main: 'team.hostile_text', accent: 'vfx.fire', periodMs: 1600, phases: phasesFrom(0.5, 6) },
};

/** The three keys `ORDER_SIGHT` does not carry per order: the aim's own
 *  colour, the cursor halo, and the warm "something happens now" core every
 *  order's beat shares (r5 `NOTES.md`'s "warm accents only on the beat"). */
export const SIGHT_KEYS = { aim: 'gunmetal.0', halo: 'shadow.0', hot: 'vfx.white_hot' } as const;

export const SIGHT_BOX = 24;
export const HOTSPOT = { x: 12, y: 12 } as const;

/** Resolved colours for one frame: `aim` and `hot` are `SIGHT_KEYS`, `main`
 *  and `accent` are that order's own. A caller resolving a cursor frame
 *  passes real colours; `orderMarkBody` passes one ink four times. */
export interface SightPaint {
  aim: string;
  main: string;
  accent: string;
  hot: string;
}

/** The stadia aim: two broken stadia arms plus the mark's own open chevron,
 *  tip up, as the aim point. `p.aim` (light steel, `gunmetal.0` in a resolved
 *  frame) draws the outer arm segments and the chevron, so the aim point
 *  never changes colour across orders; the two INNER segments -- the mil
 *  marks either side of the hotspot -- take `p.main`, keying the sight to
 *  its order's family. */
export function aimBody(p: Pick<SightPaint, 'aim' | 'main'>): string {
  return (
    fill(
      [rect(0.5, 12 - H, 3.2, 12 + H), rect(20.8, 12 - H, 23.5, 12 + H)].map(poly).join(' ') + ' ' + poly(chevUp(12, 14.5, 4.5)),
      1,
      p.aim
    ) + fill([rect(4.7, 12 - H, 7.5, 12 + H), rect(16.5, 12 - H, 19.3, 12 + H)].map(poly).join(' '), 1, p.main)
  );
}

function surroundMove(t: number, p: SightPaint): string {
  const e = ease(t / 0.7);
  const x1 = 5 + 12 * e;
  const op = t < 0.85 ? 1 : 1 - (t - 0.85) / 0.15;
  const shaft = poly(rect(1, 2, x1, 2 + W)) + ' ' + poly(rect(1, 6, x1, 6 + W));
  const tip = x1 + 5;
  const head = band([x1 - 0.6, 0.2], [tip, 4.9]) + ' ' + band([x1 - 0.6, 9.3], [tip, 4.9]);
  const arrived = t > 0.62 && t < 0.85; // the head re-forms at the far end: a white-hot beat
  return fill(shaft, op, p.main) + fill(head, op, arrived ? p.accent : p.main);
}

function surroundAttackMove(t: number, p: SightPaint): string {
  const e = t < 0.55 ? ease(t / 0.55) : 1 - ease((t - 0.55) / 0.45) * 0.55;
  const tip = 13 + 10 * e;
  const thrust = e > 0.9; // full thrust: the head flashes fire-orange
  return fill(poly(rect(1, 4.9 - H, tip - 5, 4.9 + H)), 1, p.main) + fill(poly(headR(tip, 4.9, 4.4)), 1, thrust ? p.accent : p.main);
}

function surroundHalt(t: number, p: SightPaint): string {
  const drop = t < 0.18 ? ease(t / 0.18) : t < 0.8 ? 1 : 1 - ((t - 0.8) / 0.2) * 0.8;
  const y = -6 + 13 * drop; // bar top
  const op = t < 0.8 ? 1 : 1 - (t - 0.8) / 0.2;
  const stamp = t >= 0.18 && t < 0.3; // the bar hits: one white-hot beat, then the family colour
  return fill(poly(rect(4, y, 20, y + W)), op, stamp ? p.accent : p.main) + fill(poly(rect(12 - H, y - 7, 12 + H, y)), op, p.main);
}

function surroundSmoke(t: number, p: SightPaint): string {
  let out = '';
  for (let k = 0; k < 4; k++) {
    const born = k * 0.14;
    const age = clamp((t - born) / 0.35);
    if (t < born) continue;
    const fade = t < 0.75 ? 1 : 1 - (t - 0.75) / 0.25;
    out += fill(circle(3.5 + k * 5.7, 5.5, 1.3 + 1.6 * age), fade * clamp(age * 3), p.main);
  }
  return out + fill(poly(rect(1, 8.2, 23, 8.2 + 1.2)), 0.85, p.accent); // the screen's trace line
}

function surroundLoad(t: number, p: SightPaint): string {
  const u = ease(t / 0.75);
  const tip = 2 + 12.5 * u;
  const op = t < 0.75 ? 1 : 1 - (t - 0.75) / 0.25;
  const oval = fillEo(stadiumD(12.5, 0.5, 23.5, 9) + ' ' + stadiumD(12.5 + W, 0.5 + W, 23.5 - W, 9 - W), 1, p.accent);
  const clipX = 14; // the head is swallowed once it crosses the oval wall
  const head =
    tip <= clipX
      ? fill(poly(headR(tip, 4.75, 3.2)), op, p.main)
      : fill(poly(headR(clipX, 4.75, 3.2 * (1 - (tip - clipX) / 2))), op, p.main);
  return oval + head;
}

function surroundUnload(t: number, p: SightPaint): string {
  const u = ease(t / 0.8);
  const tip = 11 + 12 * u;
  const op = t < 0.8 ? 1 - 0.25 * u : 0.75 * (1 - (t - 0.8) / 0.2); // r5: fades to 0.75, not 0.5
  const oval = fillEo(stadiumD(0.5, 0.5, 11.5, 9) + ' ' + stadiumD(0.5 + W, 0.5 + W, 11.5 - W, 9 - W), 1, p.accent);
  return oval + fill(poly(headR(tip, 4.75, 3.2)), op, p.main);
}

function surroundSweep(t: number, p: SightPaint): string {
  let out = '';
  const ang = (tt: number) => -90 + 55 * Math.sin(2 * Math.PI * tt);
  for (let k = 0; k < 4; k++) {
    const a = (ang(t - k * 0.03) * Math.PI) / 180;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    out += fill(
      band([12 + ca * 5, 12 + sa * 5], [12 + ca * 11.5, 12 + sa * 11.5]),
      k === 0 ? 1 : 0.6 - k * 0.12,
      k === 0 ? p.main : p.accent
    );
  }
  for (const d of [-145, -35]) {
    const a = (d * Math.PI) / 180;
    out += fill(band([12 + Math.cos(a) * 9.8, 12 + Math.sin(a) * 9.8], [12 + Math.cos(a) * 11.8, 12 + Math.sin(a) * 11.8]), 0.9, p.accent);
  }
  return out;
}

function surroundStrike(t: number, p: SightPaint): string {
  const draw = ease(t / 0.3);
  const ang = 359.9 * draw;
  const a1 = ((ang - 90) * Math.PI) / 180;
  const ro = 11.8;
  const ri = ro - W; // 9.3 -- well clear of the hotspot
  const large = ang > 180 ? 1 : 0;
  const arc = `M12 ${r(12 - ro)} A${ro} ${ro} 0 ${large} 1 ${r(12 + ro * Math.cos(a1))} ${r(12 + ro * Math.sin(a1))} L${r(12 + ri * Math.cos(a1))} ${r(12 + ri * Math.sin(a1))} A${ri} ${ri} 0 ${large} 0 12 ${r(12 - ri)} Z`;
  const op = t < 0.85 ? 1 : 1 - (t - 0.85) / 0.15;
  let out = fill(arc, op, p.main);
  const hits: readonly P[] = [
    [7.5, 6],
    [16.8, 17.5],
    [16.5, 6.5],
    [6.5, 17.8],
  ];
  hits.forEach(([x, y], k) => {
    const born = 0.32 + k * 0.12;
    const age = (t - born) / 0.18;
    if (age < 0 || age > 1.8) return;
    // an impact: a white-hot core on its first beat, then the family's accent
    out += fill(circle(x, y, 0.8 + 1.6 * clamp(age)), clamp(1.8 - age), age < 0.35 ? p.hot : p.accent);
  });
  return out;
}

const SURROUND: Readonly<Record<SightOrderId, (t: number, p: SightPaint) => string>> = {
  move: surroundMove,
  attackMove: surroundAttackMove,
  halt: surroundHalt,
  smoke: surroundSmoke,
  load: surroundLoad,
  unload: surroundUnload,
  sweep: surroundSweep,
  strike: surroundStrike,
};

export function surroundBody(id: SightOrderId, t: number, p: SightPaint): string {
  return SURROUND[id](t, p);
}

/** The aim plus that order's surround at `t = phases[frame]` (wrapping),
 *  the cursor's per-frame body. */
export function sightFrame(id: SightOrderId, frame: number, p: SightPaint): string {
  const phases = ORDER_SIGHT[id].phases;
  const t = phases[((frame % phases.length) + phases.length) % phases.length];
  return aimBody(p) + surroundBody(id, t, p);
}

/** Q6: the HUD's static order mark is the surround at the rest phase, with no
 *  aim, in one ink (`currentColor` by default) rather than a resolved
 *  `SightPaint` -- there is no cursor frame to key colours off outside the
 *  game canvas. */
export function orderMarkBody(id: SightOrderId, ink = 'currentColor'): string {
  return surroundBody(id, ORDER_SIGHT[id].phases[0], { aim: ink, main: ink, accent: ink, hot: ink });
}

/**
 * Each order's static HUD mark bounds, `[x0, y0, x1, y1]` in the 24-box --
 * `orderMarkBody(id)` (the rest-phase surround, no aim) and nothing else.
 *
 * Fix round 1 of S3e Task 2: every surround lives in the top half of the box
 * the aim was drawn in, so on the full 24-box the HUD mark rode high and
 * small. `symbol.ts`'s `symbolSvg` crops an order's viewBox to these bounds
 * (plus a uniform margin). The cursor (Task 4) never reads this: its hotspot
 * is (12, 12) in the full box.
 *
 * Data, not a runtime measurement: measured once with Chromium's `getBBox()`
 * on each rest body (move [1, -0.76, 22.8, 10.28], attackMove [1, 0.5, 22.99,
 * 9.3], halt [4, 0, 20, 9.5], smoke [0.6, 2.6, 23, 9.4], load [10.55, 0.5,
 * 23.5, 9], unload [0.5, 0.5, 22.37, 9], sweep [1.62, 0.46, 22.38, 8.26],
 * strike [0.19, 0.2, 23.79, 23.8]) and rounded OUTWARD to the quarter unit.
 * A change to a surround's rest pose must re-measure it; `symbol.test.ts`
 * holds every polygon vertex of the rest body inside the crop.
 */
export const ORDER_MARK_BOUNDS: Readonly<Record<SightOrderId, readonly [number, number, number, number]>> = {
  move: [1, -1, 23, 10.5],
  attackMove: [1, 0.5, 23, 9.5],
  halt: [4, 0, 20, 9.5],
  smoke: [0.5, 2.5, 23, 9.5],
  load: [10.5, 0.5, 23.5, 9],
  unload: [0.5, 0.5, 22.5, 9],
  sweep: [1.5, 0.25, 22.5, 8.5],
  strike: [0, 0, 24, 24],
};

// Compile-time check: every order the selection row can arm is drawn here.
// `OrderId` (selection-model.ts's own order-id union) must stay a subset of
// `SightOrderId` -- a type-only import, so this module pulls in none of that
// file's runtime (which calls `t()`) and stays pure.
type _OrderIdsDrawn = OrderId extends SightOrderId ? true : never;
export const _orderIdsDrawn: _OrderIdsDrawn = true;
