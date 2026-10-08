// The G1 approved symbol sheet as code: the seven APP-6-derived role marks
// (round 2, "change to war-related symbols" / "change them to fit war
// theme"), the eight order graphics (round 5's stadia aim and animated
// surrounds -- see `order-sight.ts`), and four utility marks. Ported
// verbatim from the scratch design source `.superpowers/g1-symbols/glyphs.ts`
// -- geometry and numbers unchanged, `K()`/hex removed since this sheet draws
// in `currentColor` only.
//
// Rules kept from the design rounds: filled shapes only (a ring is an
// even-odd fill, never a stroke), one weight `W` on a shared 24x24 box, and a
// NATO/APP-6 frame dictates its own angles rather than the mark's chevron
// sweep -- that sweep belongs to `order-sight.ts`'s aim alone (Q12), which
// has no APP-6 original to borrow angles from.
import type { RoleBucket } from './role';
import { escapeHtml } from './escape-html';
import { ORDER_MARK_BOUNDS, orderMarkBody, type SightOrderId } from './order-sight';

export const VIEWBOX = '0 0 24 24';
export const W = 2.5;

type P = [number, number];
const r = (v: number): number => Math.round(v * 100) / 100;
const poly = (pts: readonly P[]): string => 'M' + pts.map(([x, y]) => `${r(x)} ${r(y)}`).join(' L') + ' Z';
const path = (d: string, eo = false): string => `<path d="${d}" fill="currentColor"${eo ? ' fill-rule="evenodd"' : ''}/>`;
const rect = (x0: number, y0: number, x1: number, y1: number): P[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];
/** A straight band of weight `w` from `a` to `b` (butt ends). */
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
const circle = (cx: number, cy: number, rad: number): string =>
  `M${r(cx - rad)} ${r(cy)} a${r(rad)} ${r(rad)} 0 1 0 ${r(2 * rad)} 0 a${r(rad)} ${r(rad)} 0 1 0 ${r(-2 * rad)} 0 Z`;
const ring = (cx: number, cy: number, rad: number): string => path(circle(cx, cy, rad) + ' ' + circle(cx, cy, rad - W), true);
function stadiumD(x0: number, y0: number, x1: number, y1: number): string {
  const rr = (y1 - y0) / 2;
  return `M${r(x0 + rr)} ${r(y0)} H${r(x1 - rr)} A${r(rr)} ${r(rr)} 0 0 1 ${r(x1 - rr)} ${r(y1)} H${r(x0 + rr)} A${r(rr)} ${r(rr)} 0 0 1 ${r(x0 + rr)} ${r(y0)} Z`;
}
/** The track oval: APP-6's armour mark. */
const stadiumRing = (x0: number, y0: number, x1: number, y1: number): string =>
  path(stadiumD(x0, y0, x1, y1) + ' ' + stadiumD(x0 + W, y0 + W, x1 - W, y1 - W), true);
const rectRing = (x0: number, y0: number, x1: number, y1: number): string =>
  path(poly(rect(x0, y0, x1, y1)) + ' ' + poly(rect(x0 + W, y0 + W, x1 - W, y1 - W)), true);

// ---- frames (APP-6 friendly) ----
/** Friendly land unit: the 3:2 rectangle. */
const LAND_FRAME = rectRing(1, 4, 23, 20);
interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
const B = (x0: number, y0: number, x1: number, y1: number): Box => ({ x0, y0, x1, y1 });
const LAND_IN = B(3.5, 6.5, 20.5, 17.5);
/** Friendly air: the dome, open at the bottom. */
const AIR_FRAME = path(`M1 21 A11 17 0 0 1 23 21 L${23 - W} 21 A${11 - W} ${17 - W} 0 0 0 ${1 + W} 21 Z`);
const AIR_IN = B(6.5, 10, 17.5, 19);

const cross = (b: Box): string => band([b.x0, b.y0], [b.x1, b.y1]) + ' ' + band([b.x0, b.y1], [b.x1, b.y0]);
const infantry = (b: Box): string => path(cross(b));
const armour = (b: Box): string => stadiumRing(b.x0, b.y0, b.x1, b.y1);
const mech = (b: Box, oval: Box): string => armour(oval) + infantry(b);
function reticle(cx: number, cy: number, reach: number, gap: number): string {
  const h = W / 2;
  return path(
    [
      rect(cx - h, cy - reach, cx + h, cy - gap),
      rect(cx - h, cy + gap, cx + h, cy + reach),
      rect(cx - reach, cy - h, cx - gap, cy + h),
      rect(cx + gap, cy - h, cx + reach, cy + h),
    ]
      .map(poly)
      .join(' ')
  );
}
/** APP-6 unmanned aircraft: the broad gull-wing chevron. */
function uav(b: Box, t: number): string {
  const cx = (b.x0 + b.x1) / 2;
  return path(
    poly([
      [cx, b.y0],
      [b.x1, b.y1 - t],
      [b.x1, b.y1],
      [cx, b.y0 + t],
      [b.x0, b.y1],
      [b.x0, b.y1 - t],
    ])
  );
}
/** APP-6 rotary wing: the bow-tie. */
function rotary(b: Box): string {
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  return (
    path(
      poly([
        [b.x0, b.y0],
        [cx, cy],
        [b.x0, b.y1],
      ])
    ) +
    ' ' +
    path(
      poly([
        [b.x1, b.y0],
        [cx, cy],
        [b.x1, b.y1],
      ])
    )
  );
}
/** A munition diving nose-down: finned tail, body, pointed nose. */
function munition(b: Box): string {
  const cx = (b.x0 + b.x1) / 2;
  const bw = (b.x1 - b.x0) * 0.2;
  const fin = (b.x1 - b.x0) / 2;
  const h = b.y1 - b.y0;
  const yb = b.y0 + h * 0.18;
  const yn = b.y0 + h * 0.66;
  const fh = h * 0.26;
  return path(
    poly([
      [cx - bw, b.y0 + h * 0.05],
      [cx + bw, b.y0 + h * 0.05],
      [cx + bw, yn],
      [cx, b.y1],
      [cx - bw, yn],
    ]) +
      ' ' +
      poly([
        [cx - fin, b.y0],
        [cx - bw, yb],
        [cx - bw, yb + fh],
        [cx - fin, b.y0 + fh],
      ]) +
      ' ' +
      poly([
        [cx + fin, b.y0],
        [cx + bw, yb],
        [cx + bw, yb + fh],
        [cx + fin, b.y0 + fh],
      ])
  );
}

/** A compass rose: north pointer over a partial-turn arc arrow. */
function rotate(cw: boolean): string {
  const cx = 12;
  const cy = 13.5;
  const ro = 9;
  const ri = ro - W;
  const rad = (a: number) => (a * Math.PI) / 180;
  const pt = (rr: number, a: number): P => [cx + rr * Math.cos(rad(a)), cy + rr * Math.sin(rad(a))];
  // arc from a0 to a1 (screen angles, y down), leaving the top open for the N tick
  const a0 = cw ? -60 : -120;
  const a1 = cw ? 170 : 10;
  const s = cw ? 1 : 0;
  const span = cw ? a1 - a0 : a0 + 360 - a1;
  const large = span > 180 ? 1 : 0;
  const [o0, o1, i1, i0] = [pt(ro, a0), pt(ro, a1), pt(ri, a1), pt(ri, a0)];
  const d = `M${r(o0[0])} ${r(o0[1])} A${ro} ${ro} 0 ${large} ${s} ${r(o1[0])} ${r(o1[1])} L${r(i1[0])} ${r(i1[1])} A${ri} ${ri} 0 ${large} ${1 - s} ${r(i0[0])} ${r(i0[1])} Z`;
  // arrowhead at a1, pointing along the direction of travel
  const m = pt(ro - W / 2, a1);
  const dir = cw ? 1 : -1;
  const t: P = [-Math.sin(rad(a1)) * dir, Math.cos(rad(a1)) * dir];
  const n: P = [Math.cos(rad(a1)), Math.sin(rad(a1))];
  const head = poly([
    [m[0] + t[0] * 5.5, m[1] + t[1] * 5.5],
    [m[0] + n[0] * 4.2, m[1] + n[1] * 4.2],
    [m[0] - n[0] * 4.2, m[1] - n[1] * 4.2],
  ]);
  return (
    path(d) +
    path(head) +
    path(
      poly([
        [12, 0.5],
        [15, 6.5],
        [9, 6.5],
      ])
    )
  );
}

// ---- GH-261: the Military set (lead's pick, 29 Sep) ----
// Ported from `.superpowers/dingbats-mock/gen.mjs`, numbers unchanged. The
// mock drew a left-pointing mark as its right-pointing twin under a mirror
// transform; here the reflection is baked into the coordinates (`mx`), so the
// sheet never ships a `<g transform>` and every mark stays one fill on the box.
/** Reflect a point across the box's vertical centre line. */
const mx = ([x, y]: P): P => [24 - x, y];
const fill = (pts: readonly P[]): string => path(poly(pts));
const box = (x0: number, y0: number, x1: number, y1: number): string => fill(rect(x0, y0, x1, y1));
const bar = (a: P, b: P): string => path(band(a, b));
const xMark = (x0: number, y0: number, x1: number, y1: number): string => bar([x0, y0], [x1, y1]) + bar([x0, y1], [x1, y0]);
const maybe = (flip: boolean) => (p: P): P => (flip ? mx(p) : p);

/** Phase-line pager: the bar the step lands on, and the triangle stepping to it. */
function pagerMark(flip: boolean): string {
  const m = maybe(flip);
  return fill([m([2.5, 3]), m([5, 3]), m([5, 21]), m([2.5, 21])]) + fill([m([8, 3]), m([21, 12]), m([8, 21])]);
}
/** The supporting-attack arrow: shaft and an open barbed head. */
function supportArrow(flip: boolean): string {
  const m = maybe(flip);
  return bar(m([2, 12]), m([19, 12])) + bar(m([21.2, 12]), m([13.2, 4.4])) + bar(m([21.2, 12]), m([13.2, 19.6]));
}
/** APP-6 signals: the lightning bolt. */
const BOLT = fill([
  [15, 1.5],
  [5, 13.5],
  [10.5, 13.5],
  [8, 22.5],
  [19, 9.5],
  [13.2, 9.5],
]);
/** The dashed "planned" frame: APP-6's anticipated status on the land frame. */
const DASHED_FRAME =
  box(1, 4, 6.5, 6.5) +
  box(9, 4, 15, 6.5) +
  box(17.5, 4, 23, 6.5) +
  box(1, 17.5, 6.5, 20) +
  box(9, 17.5, 15, 20) +
  box(17.5, 17.5, 23, 20) +
  box(1, 8.5, 3.5, 11) +
  box(1, 13, 3.5, 15.5) +
  box(20.5, 8.5, 23, 11) +
  box(20.5, 13, 23, 15.5);
/** A solid frame with the tick knocked out of it (even-odd). */
const FRAMED_TICK = path(
  poly(rect(1, 4, 23, 20)) +
    ' ' +
    poly([
      [6.5, 12],
      [8.5, 10],
      [10.5, 12],
      [15.5, 7.2],
      [17.5, 9.2],
      [10.5, 16.2],
    ]),
  true
);
/** An n-point star, alternating outer and inner radius, first point up. */
function starMark(cx: number, cy: number, ro: number, ri: number, n: number): string {
  const pts: P[] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = (Math.PI * i) / n - Math.PI / 2;
    const rr = i % 2 ? ri : ro;
    pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
  }
  return fill(pts);
}
/** The axis-of-advance arrow (shaft + solid head) the line of departure crosses. */
const ADVANCE_ARROW = bar([2, 12], [16, 12]) + fill([
  [14.5, 5],
  [23, 12],
  [14.5, 19],
]);

/** The GH-261 marks: the dingbats no G1 round drew, each replacing the
 *  character named beside it. */
export type DingbatId =
  | 'pause' // ▮▮
  | 'pagePrev' // ◂
  | 'pageNext' // ▸
  | 'audioOn' // 🔊 and the menu's audio toggle
  | 'audioOff' // 🔇
  | 'objectiveOpen' // ☐
  | 'objectiveDone' // ☑
  | 'objectiveFailed' // ☒
  | 'back' // ←
  | 'next' // →
  | 'leave' // ⌂
  | 'heavy' // ⚠
  | 'broken'; // ⚑
export type UtilityId = 'logistics' | 'intel' | 'rotateCcw' | 'rotateCw' | DingbatId;
/** A unit-status mark, drawn on the chip/card/strip/cursor rather than on an
 *  order or a role. `pinned` is candidate A, "pressed flat", which the lead
 *  picked at G-PIN (28 Sep); `immobilised` and `gunOut` are the two vehicle
 *  damage marks the lead approved with pass C2/C4 (7 Oct, D5). */
export type StatusId = 'pinned' | 'immobilised' | 'gunOut';
export type SymbolId = RoleBucket | SightOrderId | UtilityId | StatusId;

const ROLE_IDS: readonly RoleBucket[] = ['kamikaze', 'drone', 'gunship', 'sniper', 'transport', 'soft', 'armour'];
const ORDER_IDS: readonly SightOrderId[] = ['move', 'attackMove', 'halt', 'smoke', 'load', 'unload', 'sweep', 'strike'];
export const DINGBAT_IDS: readonly DingbatId[] = [
  'pause',
  'pagePrev',
  'pageNext',
  'audioOn',
  'audioOff',
  'objectiveOpen',
  'objectiveDone',
  'objectiveFailed',
  'back',
  'next',
  'leave',
  'heavy',
  'broken',
];
const UTILITY_IDS: readonly UtilityId[] = ['logistics', 'intel', 'rotateCcw', 'rotateCw', ...DINGBAT_IDS];
const STATUS_IDS: readonly StatusId[] = ['pinned', 'immobilised', 'gunOut'];

/** Seven roles, eight orders, four utility marks, three status marks: the
 *  twenty the sheet G1 approved (round 2's roles and utility marks, round 5's
 *  orders) plus the pinned mark the lead picked at G-PIN and the two damage
 *  marks of pass C2/C4 -- and the thirteen GH-261 marks, thirty-five in all. */
export const SYMBOL_IDS: readonly SymbolId[] = [...ROLE_IDS, ...ORDER_IDS, ...UTILITY_IDS, ...STATUS_IDS];

interface RoleGlyph {
  body: string; // unframed (the 10 px form)
  framed: string; // APP-6 framed form
}

const ROLE_GLYPHS: Readonly<Record<RoleBucket, RoleGlyph>> = {
  soft: { body: infantry(B(3.5, 4.5, 20.5, 19.5)), framed: LAND_FRAME + infantry(LAND_IN) },
  armour: { body: armour(B(1.5, 6, 22.5, 18)), framed: LAND_FRAME + armour(B(5, 8.5, 19, 15.5)) },
  transport: { body: mech(B(3, 4, 21, 20), B(1.5, 7, 22.5, 17)), framed: LAND_FRAME + mech(LAND_IN, B(5, 8.5, 19, 15.5)) },
  sniper: { body: ring(12, 12, 8.5) + reticle(12, 12, 11.5, 3.5), framed: LAND_FRAME + reticle(12, 12, 7, 2.2) },
  drone: { body: uav(B(1, 6, 23, 18), 4.5), framed: AIR_FRAME + uav(B(5.5, 11, 18.5, 18.5), 3.2) },
  gunship: { body: rotary(B(1.5, 5, 22.5, 19)), framed: AIR_FRAME + rotary(AIR_IN) },
  kamikaze: { body: munition(B(4, 1, 20, 23)), framed: AIR_FRAME + munition(B(7, 8, 17, 20)) },
};

/** A fire mission's own utility salvo icon is drawn by `strike`'s order
 *  graphic now (`order-sight.ts`); these four are what is left of the
 *  design source's `utility` group once the two orders it also names
 *  (`sweep`, `strike`) move there. `logistics` alone kept a framed form
 *  (the APP-6 supply bar) in the source -- `symbolBody` honours it. */
interface UtilityGlyph {
  body: string;
  framed?: string;
}

const UTILITY_GLYPHS: Readonly<Record<UtilityId, UtilityGlyph>> = {
  logistics: {
    body: path([rect(1.5, 13, 10.75, 22), rect(13.25, 13, 22.5, 22), rect(7.4, 2.5, 16.6, 10.5)].map(poly).join(' ')),
    framed: LAND_FRAME + path(poly(rect(3.5, 13.5, 20.5, 17.5))),
  },
  intel: { body: path('M1 12 Q12 0 23 12 Q12 24 1 12 Z M5 12 Q12 5.6 19 12 Q12 18.4 5 12 Z', true) + path(circle(12, 12, 3)) },
  rotateCcw: { body: rotate(false) },
  rotateCw: { body: rotate(true) },
  // GH-261, each the lead's Military-set pick (29 Sep).
  /** Pause bars in the unit frame (B). */
  pause: { body: LAND_FRAME + box(7.5, 8.5, 10.5, 15.5) + box(13.5, 8.5, 16.5, 15.5) },
  /** Phase-line arrows (B). */
  pagePrev: { body: pagerMark(true) },
  pageNext: { body: pagerMark(false) },
  /** APP-6 signals bolt (B); struck through for radio silence. */
  audioOn: { body: BOLT },
  audioOff: { body: BOLT + bar([2.5, 21.5], [21.5, 2.5]) },
  /** Dashed planned frame, solid frame with tick, framed X (B). */
  objectiveOpen: { body: DASHED_FRAME },
  objectiveDone: { body: FRAMED_TICK },
  objectiveFailed: { body: LAND_FRAME + xMark(8, 8.5, 16, 15.5) },
  /** The open-barbed supporting-attack arrow (B). */
  back: { body: supportArrow(true) },
  next: { body: supportArrow(false) },
  /** Line of departure: the advance arrow across a phase-line bar (A). */
  leave: { body: box(9, 3, 11.5, 21) + ADVANCE_ARROW },
  /** Danger close: a ring around an eight-point burst (B). */
  heavy: { body: ring(12, 12, 10.75) + starMark(12, 12, 6.3, 2.6, 8) },
  /** The notched control-measure flag on its staff (A). */
  broken: {
    body:
      box(4, 2, 6.5, 22.5) +
      fill([
        [6.5, 3],
        [21, 3],
        [17, 6.2],
        [21, 9.2],
        [17, 12.2],
        [6.5, 12.2],
      ]),
  },
};

function isRoleBucket(id: SymbolId): id is RoleBucket {
  return (ROLE_IDS as readonly string[]).includes(id);
}
function isOrderId(id: SymbolId): id is SightOrderId {
  return (ORDER_IDS as readonly string[]).includes(id);
}
function isStatusId(id: SymbolId): id is StatusId {
  return (STATUS_IDS as readonly string[]).includes(id);
}

// ---------------------------------------------------------------------------
// The status marks.
//
// A unit under enough incoming fire to pin stops moving at anything near
// full speed and stops shooting back. `pinned` is "pressed flat" -- the
// shape the lead picked at G-PIN (28 Sep) over two alternatives (a squashed
// infantry cross, three incoming strikes), which were deleted with the
// ruling. On the shared 24 box, W thick, filled only, `currentColor` only:
// no stroke and no `--mark-edge` halo baked in -- the halo is a CSS
// placement rule on `.rl-pin-mark` in theme.css.

/** "Pressed flat": a ground bar over a wide, shallow down-chevron -- apex
 *  (12, 20), shoulders (2, 9) and (22, 9), W thick. It is the strip's old
 *  `▼` dingbat drawn properly, so it keeps the reading players learned from
 *  it. */
const STATUS_GLYPHS: Readonly<Record<StatusId, string>> = {
  pinned: path(poly(rect(2, 3, 22, 3 + W))) + ' ' + path(band([2, 9], [12, 20]) + ' ' + band([22, 9], [12, 20])),
  /** Immobilised (pass C2/C4, D5): a road wheel, struck through. */
  immobilised: ring(12, 12, 9) + bar([3.2, 20.8], [20.8, 3.2]),
  /** Gun out (pass C2/C4, D5): a barrel broken in two, the muzzle half
   *  dropped, over its breech block. */
  gunOut:
    box(2, 9, 11, 13) +
    fill([
      [13.2, 11.4],
      [22.6, 15.6],
      [21.4, 18.4],
      [12, 14.2],
    ]) +
    box(2, 14.5, 7, 19),
};

/**
 * One symbol's fill markup (no `<svg>` wrapper) -- `currentColor` only, no
 * `<svg>`/viewBox/stroke of its own.
 *
 * A role honours `opts.framed` (the APP-6 frame around it); an order
 * (`orderMarkBody`, Q6) and a utility mark ignore it and always draw the same
 * body, except `logistics`, which kept its own framed form from the design
 * source. `opts.ink` reaches only an order's `orderMarkBody` -- role and
 * utility bodies are pre-baked to `currentColor` from the approved sheet.
 */
export function symbolBody(id: SymbolId, opts?: { framed?: boolean; ink?: string }): string {
  if (isRoleBucket(id)) {
    const g = ROLE_GLYPHS[id];
    return opts?.framed ? g.framed : g.body;
  }
  if (isOrderId(id)) {
    return orderMarkBody(id, opts?.ink);
  }
  if (isStatusId(id)) {
    return STATUS_GLYPHS[id];
  }
  const g = UTILITY_GLYPHS[id];
  return opts?.framed && g.framed ? g.framed : g.body;
}

/** The uniform margin (24-box units) an order mark's crop keeps around its
 *  surround, so an edge never lands on the last pixel of the glyph box. */
export const ORDER_MARK_MARGIN = 0.75;

/** An order's HUD viewBox: `ORDER_MARK_BOUNDS[id]` plus the margin on every
 *  side, as `[x, y, w, h]`. Pure, so the crop is data and never a DOM read. */
export function orderMarkViewBox(id: SightOrderId): [number, number, number, number] {
  const [x0, y0, x1, y1] = ORDER_MARK_BOUNDS[id];
  const m = ORDER_MARK_MARGIN;
  return [r(x0 - m), r(y0 - m), r(x1 - x0 + 2 * m), r(y1 - y0 + 2 * m)];
}

/**
 * The symbol as a standalone inline SVG: `<svg class="rl-sym ..."
 * data-symbol="<id>" width height viewBox aria-hidden="true"
 * focusable="false">`.
 *
 * Roles and utility marks draw on the shared 24-box at `size` square. An
 * ORDER is the HUD's static mark (Q6: the surround at rest, no aim) and is
 * cropped to its own surround (`orderMarkViewBox`, fix round 1): `size` is
 * its height, its width follows the crop's aspect ratio, and it carries
 * `rl-sym--order` so theme.css sizes it 1em TALL with the width following.
 * The cursor never comes through here -- it keeps the full box, since its
 * hotspot is (12, 12) in it.
 */
export function symbolSvg(id: SymbolId, size: number, opts?: { framed?: boolean; className?: string }): string {
  const order = isOrderId(id);
  const cls = ['rl-sym', order ? 'rl-sym--order' : undefined, opts?.className].filter((c): c is string => Boolean(c)).join(' ');
  let box = VIEWBOX;
  let width = size;
  if (isOrderId(id)) {
    const [x, y, w, h] = orderMarkViewBox(id);
    box = `${x} ${y} ${w} ${h}`;
    width = r((size * w) / h);
  }
  return (
    `<svg class="${cls}" data-symbol="${id}" width="${width}" height="${size}" viewBox="${box}" ` +
    `aria-hidden="true" focusable="false">${symbolBody(id, { framed: opts?.framed })}</svg>`
  );
}

/**
 * A mark beside catalogue text, as HTML: `<svg> text` (or `text <svg>` with
 * `after`). GH-261's rule for i18n: a catalogue string never carries the mark
 * -- it cannot hold SVG -- so the call site draws it beside the words. The
 * text is escaped here; the caller sets the result as `innerHTML`.
 */
export function symbolLabel(id: SymbolId, text: string, opts?: { after?: boolean; size?: number }): string {
  const mark = symbolSvg(id, opts?.size ?? 14);
  return opts?.after ? `${escapeHtml(text)} ${mark}` : `${mark} ${escapeHtml(text)}`;
}
