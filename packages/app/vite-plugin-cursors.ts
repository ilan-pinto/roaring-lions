// Draws the cursor states as inline SVG data URIs and injects them as CSS.
//
// Cursor art needs colour, and `pnpm validate:ui` rejects a hex or rgb()
// literal anywhere under packages/app/src with no allowlist. This file sits
// outside that scan root -- exactly where vite-plugin-palette.ts sits -- so it
// is the one place cursor colour can live at all. It injects a <style> block
// through transformIndexHtml (which Vite runs in both dev and build) instead
// of emitting a stylesheet, for the same reason vite-plugin-palette.ts does:
// a stylesheet would still need index.html to reference it, and one literal
// there is all it takes for the palette gate to become a rule with an
// exception.
//
// `default` (one of the fifteen names) deliberately gets no rule -- it is
// the OS arrow. Shipping an empty SVG for it would HIDE the arrow rather than
// fall through to it.
//
// Two drawn vocabularies live here, and which one a name gets is a ruling,
// not a taste.
//
// ---------------------------------------------------------------------------
// THE ORDER SIGHTS: G1's approved sheet (round 4's shapes and motion, round
// 5's family colours, the lead, 2026-09-28). `move`, `advance`, `sweep`,
// `strike` and `smoke` draw the chevron stadia aim with that order's APP-6
// tactical graphic animated around it (`src/ui/order-sight.ts`, the one
// drawn source the HUD's static order marks come from too). Each is drawn on
// the sheet's 24-unit box and scaled onto the 32 px cursor canvas, so the
// aim's hotspot (12, 12) lands on the same pixel the housing's centre does.
// Every sight frame carries a dark `shadow.0` halo BAKED IN AS GEOMETRY --
// each ink path re-emitted beneath the ink with a round-joined stroke --
// because a CSS cursor image takes no `filter` (r4's drop-shadow does not
// survive into `cursor: url()`). `load`, `unload` and `halt` are drawn too
// but earn no rule: see UNWIRED_BODIES.
//
// ---------------------------------------------------------------------------
// THE HOUSING: "Tiberian heavy housing", chosen by the project lead from four
// drawn candidates (2026-09-03), and kept for the six states G1 drew nothing
// for -- garrison, demolish, charge, blocked, costly, protected (Q1). Its
// organising idea, in the designer's own words:
//
//   "Every cursor is a piece of machined hardware: the same four chamfered
//    corner brackets form a heavy housing that never touches the hotspot, and
//    what changes between states is the payload bolted into the middle and
//    the colour of the plate."
//
// So there is exactly one shape primitive for them -- `bracket`,
// parameterised by inset/arm/thickness/chamfer -- and every housing image is
// that primitive four times (or three, see the badge below) plus a payload.
//
// Two findings the designer made by rendering at true 32px and looking, so
// nobody re-derives them by reasoning:
//   - `blocked` drawn wholly in `dim` is nearly invisible on limestone ground
//     at 32px. Its housing stays `dim`; its broken bar is `ink`.
//   - `mount`/`dismount`'s payloads were redrawn until they read at 32px;
//     they ship no rule (see UNWIRED_BODIES) but the drawings are kept.
//
// THE BADGE IS THE FOURTH PLATE. `BADGE_CX/CY`/`BADGE_R` put the role badge
// exactly on the bottom-right bracket's own footprint, so on a badged housing
// key that bracket is OMITTED and the badge stands in its place -- it reads as
// the fourth corner plate rather than as a sticker stuck on top. `demolish`
// takes this literally: its beacon sweep visits the badge like any other
// plate. On a SIGHT the badge rides the bottom-right quadrant the graticule
// leaves empty, in aim steel (Q8). Either way the mark itself is the G1
// sheet's APP-6 role mark (`src/ui/symbol.ts`), never a second drawing.
//
// ---------------------------------------------------------------------------
// Seven names (`ANIMATED_CURSORS` in cursor.ts) additionally animate: each
// draws up to `frames` distinct SVGs instead of one, emitted as extra rules
// keyed on a second attribute, `data-cursor-frame`, that main.ts's frame
// driver cycles on a plain JS timer -- see ANIMATED_CURSORS's own comment for
// which names qualify and why.
//
// Frame 0 of each is drawn by the *same* code path as every other cursor's
// single rule, so only frames 1..N-1 are new, additive rules layered on top
// via the extra attribute selector. That makes the animation FAIL SAFE: a
// stale or absent `data-cursor-frame` (nothing has written it yet, or it is
// left over from a *different* animated cursor) simply falls back to this
// always-correct frame-0 rule rather than to nothing.
//
// "up to `frames`" because a frame that would redraw its own key's frame 0
// byte for byte emits no rule at all and leans on that same fallback -- see
// cursorRules' frame loop.
//
// ---------------------------------------------------------------------------
// COLOUR VISION. `team.*` colours follow the player's colour-vision setting,
// which `settings.ts` writes as `:root[data-cvd]`. A cursor image cannot read
// a custom property, so the plugin draws every image once per variant and
// emits, after the default sheet, only the rules whose markup differs under
// that variant, prefixed `:root[data-cvd='<v>'] ` -- see cursorRules for the
// one specificity trap that makes "only the differing rules" subtler than it
// sounds.

import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';
import {
  ANIMATED_CURSORS,
  SIGHT_OF,
  cursorKey,
  type CursorName,
  type UnbadgedName,
} from './src/input/cursor';
import { HOTSPOT, ORDER_SIGHT, SIGHT_BOX, SIGHT_KEYS, sightFrame, type SightOrderId, type SightPaint } from './src/ui/order-sight';
import type { RoleBucket } from './src/ui/role';
import { symbolBody } from './src/ui/symbol';

interface PaletteBand {
  colors: Record<string, string>;
  /** Only `team` carries these: colour-vision alternates of `colors`. */
  variants?: Record<string, Record<string, string>>;
}

interface Palette {
  ramps: Record<string, { colors: string[] }>;
  reserved: Record<string, PaletteBand>;
}

// The eleven drawn bare cursors (fifteen names in CursorName, minus
// 'default', 'mount', 'dismount' and 'charge' -- see BareCursorName and
// BADGED_VERBS below for why those never get a rule of their own) all share
// one hotspot: dead centre, at half the canvas size on each axis. Nothing is
// ever drawn there -- the housing's hotspot sits in the open middle of the
// frame, and the sight's is the gap between the aim's mil marks and the tip
// of its chevron -- so the cursor never covers what it is aiming at.
//
// Every housing path literal below is authored on this 32-unit grid;
// `bracketAt`'s mirror arithmetic and the payload coordinates both assume it,
// and vite-plugin-cursors.test.ts pins SIZE so that assumption cannot go
// stale silently. The sights are authored on SIGHT_BOX (24) and scaled by
// their viewBox, which puts HOTSPOT (12, 12) on CENTER too.
export const SIZE = 32;
export const CENTER = SIZE / 2;

/** Lowercased so the encoded output is deterministic regardless of how the
 *  source palette capitalises its hex strings. */
function hex(color: string): string {
  return color.toLowerCase();
}

function svg(body: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" ` +
    `viewBox="0 0 ${SIZE} ${SIZE}">${body}</svg>`
  );
}

/** A sight: the G1 sheet's 24-unit box, drawn at the same 32 px as the
 *  housing, so HOTSPOT (12, 12) x 32/24 is CENTER (16, 16). */
function svgSight(body: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" ` +
    `viewBox="0 0 ${SIGHT_BOX} ${SIGHT_BOX}">${body}</svg>`
  );
}

/** One palette key (`'gunmetal.0'`, `'vfx.fire'`, `'team.hostile_text'`)
 *  resolved to its hex under a colour-vision variant.
 *
 *  `team.*` mirrors `@lions/data`'s `teamColorsFor` exactly (Q9): `'default'`
 *  reads `team.colors`, any other variant its `team.variants` entry, and a
 *  variant the palette has not grown falls back to the default set. Mirrored
 *  rather than imported because `@lions/data` in the Vite config would pull
 *  every map JSON into config load and stop this plugin re-reading
 *  palette.json on edit; the parity test in vite-plugin-cursors.test.ts is
 *  what keeps the two from parting. Everything else is variant-blind: a ramp
 *  step, or a reserved band's named colour.
 *
 *  Throws on an unknown key rather than returning a stand-in: this runs at
 *  build time, and a magenta cursor is a worse way to learn about a rename. */
export function resolveKey(palette: Palette, variant: string, key: string): string {
  const dot = key.indexOf('.');
  const band = key.slice(0, dot);
  const name = key.slice(dot + 1);
  let found: string | undefined;
  if (band === 'team') {
    const team = palette.reserved.team;
    const set = (variant === 'default' ? team.colors : team.variants?.[variant]) ?? team.colors;
    found = set[name];
  } else if (band in palette.ramps) {
    found = palette.ramps[band].colors[Number(name)];
  } else if (band in palette.reserved) {
    found = palette.reserved[band].colors[name];
  }
  if (found === undefined) throw new Error(`vite-plugin-cursors: no palette colour for '${key}'`);
  return found;
}

function fillPath(colour: string, d: string): string {
  return `<path fill="${hex(colour)}" d="${d}"/>`;
}

function strokePath(colour: string, width: number, d: string): string {
  return `<path fill="none" stroke="${hex(colour)}" stroke-width="${width}" d="${d}"/>`;
}

// ---------------------------------------------------------------------------
// The housing
// ---------------------------------------------------------------------------

/** The four corners, in the order the geometry generator emits them. NOT the
 *  order the demolish beacon visits them -- see BEACON_SWEEP. */
const CORNERS = ['tl', 'tr', 'bl', 'br'] as const;
type Corner = (typeof CORNERS)[number];

/** How a housing is shaped. Every state uses the defaults except `protected`,
 *  which is drawn heavier on purpose -- it is the strongest "no" in the
 *  vocabulary, and the extra weight is what set it apart from the X-shaped
 *  `support` housing it shipped beside until the sights replaced it. */
interface HousingOpts {
  /** Distance from the canvas edge to the bracket's outer corner. */
  inset?: number;
  /** How far each leg of the L runs from that corner. */
  arm?: number;
  /** How thick each leg is. */
  thickness?: number;
  /** How far the outer corner is cut back, giving the machined chamfer. */
  chamfer?: number;
  /** A corner to leave undrawn. Badged housing keys omit `br` so the role
   *  badge can stand in its place. */
  omit?: Corner;
}

/** One chamfered corner bracket as an SVG subpath.
 *
 *  This is THE shape primitive of the whole set -- four of these are the
 *  housing, and every state is that housing plus a payload. The four corners
 *  are written out rather than derived by transform because an SVG path in a
 *  data URI cannot carry a transform for free (a `<g transform>` costs more
 *  bytes than the mirrored digits do, on a sheet where every byte ships on
 *  every page load), and because the mirrored literals are what the
 *  designer's own generator emitted and the project lead approved. */
function bracketAt(corner: Corner, o: Required<Omit<HousingOpts, 'omit'>>): string {
  const i = o.inset;
  const a = i + o.arm;
  const t = i + o.thickness;
  const c = i + o.chamfer;
  const m = SIZE - i;
  const ma = SIZE - a;
  const mt = SIZE - t;
  const mc = SIZE - c;
  switch (corner) {
    case 'tl':
      return `M${i},${t}L${c},${i}H${a}V${t}H${t}V${a}H${i}Z`;
    case 'tr':
      return `M${m},${t}L${mc},${i}H${ma}V${t}H${mt}V${a}H${m}Z`;
    case 'bl':
      return `M${i},${mt}L${c},${m}H${a}V${mt}H${t}V${ma}H${i}Z`;
    case 'br':
      return `M${m},${mt}L${mc},${m}H${ma}V${mt}H${mt}V${ma}H${m}Z`;
  }
}

function housingOpts(o: HousingOpts): Required<Omit<HousingOpts, 'omit'>> {
  return { inset: o.inset ?? 3, arm: o.arm ?? 7, thickness: o.thickness ?? 3, chamfer: o.chamfer ?? 3 };
}

/** All four brackets (minus `omit`) as one path's worth of subpaths. */
function housing(o: HousingOpts = {}): string {
  const shape = housingOpts(o);
  return CORNERS.filter((c) => c !== o.omit)
    .map((c) => bracketAt(c, shape))
    .join('');
}

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

/** demolish: a static split block, and a bone-white beacon that rotates over
 *  the corner plates -- a hazard light on a machine that is working here.
 *
 *  CLOCKWISE, which is why this is its own table rather than CORNERS: the
 *  generator emits corners in reading order (tl, tr, bl, br), and stepping a
 *  beacon through that order jumps diagonally from tr to bl, which at 300ms
 *  reads as a flicker rather than as rotation. The designer's brief says
 *  "sweeps the four corner plates clockwise"; this is that sentence. */
const BEACON_SWEEP: readonly Corner[] = ['tl', 'tr', 'br', 'bl'];

/** demolish's core: a block whose top-right quadrant is gone -- a structure
 *  with a corner already taken out of it. Pinned as a constant because it must
 *  be byte-identical on every frame: the beacon moving over a core that also
 *  moved would be two animations at once.
 *
 *  This is NOT the drawn set's core, and the substitution is the one place
 *  this file departs from the art the project lead approved. The designer
 *  flagged their own split-block (a closed square with two diagonal crack
 *  ticks inside it) as the second of three things to check at true size, and
 *  it fails: rendered at 32px over `open-ground.png`'s real limestone the two
 *  ticks read as a diagonal double-headed arrow, i.e. as a resize handle,
 *  which is a cursor that means something else. Six replacements were drawn
 *  and photographed at 32px and 6x before this one -- a plain block (clean but
 *  generic, and it collided with the pre-S3e square `armour` badge on
 *  `demolish-armour`), a jagged-topped ruin and its filled twin (both read as
 *  a flame), a zigzag crack (mush inside a 10px box), and a block split into
 *  two vertical halves (the media pause glyph). The corner bite is legible at
 *  both sizes, cannot be read as an arrow, and is an L -- the same shape the
 *  four plates are, which is why it sits in this housing and a flame did
 *  not. */
const DEMOLISH_CORE = 'M11,21V11H16V16H21V21Z';

/** charge: a satchel buried under the ground line, and a fuse running up to
 *  the right. The spark crawls DOWN the fuse toward the satchel, four steps --
 *  the animation is the sim's `tunnelChargeTicks` timer made visible. */
const CHARGE_SPARKS: readonly string[] = [
  'M24,14H27V17H24Z',
  'M23,15H26V18H23Z',
  'M22,16H25V19H22Z',
  'M21,17H24V20H21Z',
];

// ---------------------------------------------------------------------------
// The states
// ---------------------------------------------------------------------------

/** The seven colours the housing draws with, resolved from the palette.
 *
 *  `good` (scrub[0], #6B8A4A) is deliberately NOT here and is the one palette
 *  colour this set declines: olive sits about 30 RGB from `dim` and photographs
 *  as mud at 32px on limestone ground, and nothing in this vocabulary wanted a
 *  third neutral. `paletteColors`' test asserts the omission rather than
 *  leaving it to this comment. (`live`, vfx.tracer, used to be an eighth: it
 *  drew only the `support` housing, which the strike and sweep sights
 *  replaced.) */
interface CursorColors {
  ink: string;
  dim: string;
  bad: string;
  warn: string;
  hot: string;
  amber: string;
  info: string;
}

/** What a housing body needs to know beyond its colours. */
interface BodyOpts {
  /** Animation frame, 0 for every static state and for every frame-0 rule. */
  frame?: number;
  /** True when a role badge will be appended to this body, in which case the
   *  bottom-right bracket is omitted so the badge can be that plate. */
  badged?: boolean;
}

function blockedBody(c: CursorColors): string {
  return fillPath(c.dim, housing()) + strokePath(c.ink, 4, 'M9,23L14,18M18,14L23,9');
}

function costlyBody(c: CursorColors): string {
  return fillPath(c.warn, housing()) + strokePath(c.warn, 2, 'M16,12L25,21H7Z');
}

/** Where the pinned mark sits: its 24-box scaled to 18 px and laid over
 *  x/y 7..25 -- `costly`'s payload span -- so the box centre (12, 12) lands
 *  on CENTER. That centre is the empty gap between the mark's ground bar and
 *  its chevron, so the hotspot pixel is never painted, and the mark's corners
 *  clear every bracket leg (the legs stop at 6 from each edge; the mark
 *  starts at 8.5). */
const PINNED_MARK = { x: 7, y: 7, scale: 0.75 } as const;

/** pinned (GH-262): every unit the order would move is pinned, so the click
 *  is accepted and nobody goes. The standard housing in `hot` -- vfx.fire,
 *  the colour the HUD's `--hot` and the pinned mark on the chip, card and
 *  strip already use -- with the G-PIN mark A ("pressed flat",
 *  `symbolBody('pinned')`) inside, baked to the same hex because a cursor
 *  image has no `currentColor` to inherit. One drawing, never a second. */
function pinnedBody(c: CursorColors): string {
  return (
    fillPath(c.hot, housing()) +
    `<g transform="translate(${PINNED_MARK.x} ${PINNED_MARK.y}) scale(${PINNED_MARK.scale})">` +
    symbolBody('pinned').replaceAll('currentColor', hex(c.hot)) +
    '</g>'
  );
}

function protectedBody(c: CursorColors): string {
  return (
    fillPath(c.bad, housing({ arm: 8, thickness: 4, chamfer: 4 })) +
    strokePath(c.bad, 4, 'M9,9L14,14M23,9L18,14M9,23L14,18M23,23L18,18')
  );
}

function garrisonBody(c: CursorColors, o: BodyOpts = {}): string {
  return (
    fillPath(c.info, housing({ omit: o.badged ? 'br' : undefined })) +
    strokePath(c.info, 2, 'M10,23V13H22V23M12,28L16,24L20,28')
  );
}

/** Which corner the beacon lights on this frame -- exported through
 *  `demolishBeaconLitsBadge` below so `badgeColourFor` can light the badge on
 *  the frame the sweep reaches it. */
function demolishLit(frame: number): Corner {
  return BEACON_SWEEP[frame % BEACON_SWEEP.length];
}

/** True on the one frame in four where the beacon is over the badge's plate,
 *  and only on a badged key -- on a bare key `br` is a real bracket and lights
 *  like any other. */
function demolishBeaconLitsBadge(o: BodyOpts): boolean {
  return o.badged === true && demolishLit(o.frame ?? 0) === 'br';
}

function demolishBody(c: CursorColors, o: BodyOpts = {}): string {
  const lit = demolishLit(o.frame ?? 0);
  const shape = housingOpts({});
  const drawn = CORNERS.filter((corner) => !(o.badged && corner === 'br'));
  const rest = drawn.filter((corner) => corner !== lit);
  const beacon = drawn.filter((corner) => corner === lit);
  return (
    fillPath(c.hot, rest.map((corner) => bracketAt(corner, shape)).join('')) +
    (beacon.length > 0 ? fillPath(c.ink, bracketAt(beacon[0], shape)) : '') +
    strokePath(c.hot, 2, DEMOLISH_CORE)
  );
}

function chargeBody(c: CursorColors, o: BodyOpts = {}): string {
  const spark = CHARGE_SPARKS[o.frame ?? 0] ?? CHARGE_SPARKS[0];
  return (
    fillPath(c.bad, housing({ omit: o.badged ? 'br' : undefined }) + 'M12,20H20V25H12Z') +
    strokePath(c.bad, 2, 'M9,18H23M20,20L25,15') +
    fillPath(c.warn, spark)
  );
}

/** mount and dismount draw no rule today -- see BareCursorName and
 *  BADGED_VERBS. Their bodies are kept because the housing makes them nearly
 *  free: each is the same four brackets plus one payload literal, and
 *  re-deriving payloads that have already been drawn, rendered and looked at
 *  is the expensive half. They are not called by any rule, so they ship no
 *  bytes. */
function mountBody(c: CursorColors): string {
  return (
    fillPath(c.amber, housing() + 'M9,9H23V12H9Z') +
    strokePath(c.amber, 2, 'M10,24L16,18L22,24')
  );
}
function dismountBody(c: CursorColors): string {
  return (
    fillPath(c.amber, housing() + 'M9,20H23V23H9Z') +
    strokePath(c.amber, 2, 'M10,8L16,14L22,8')
  );
}

// ---------------------------------------------------------------------------
// The sights
// ---------------------------------------------------------------------------

/** The halo's stroke width in the sheet's 24-unit box (r4's `shadow.0`
 *  outline, about 1 px either side of the ink at 32 px). */
const HALO_WIDTH = 1.5;

/** Where the role badge rides a sight: the bottom-right quadrant, which the
 *  stadia graticule leaves empty (r4), at 9/24 of the box. */
const SIGHT_BADGE = { x: 15, y: 15, scale: 0.375 } as const;

/** Every `<path>` in `ink`, re-emitted as its own dark outline: `fill` and a
 *  round-joined `stroke` both set to `halo`, the path's `d`, `fill-rule` and
 *  `opacity` untouched. Drawn BENEATH the ink, all of it before any of the
 *  ink, so an outline never covers a neighbouring shape -- the same result
 *  r4's CSS `drop-shadow` filter gave, which a cursor image cannot carry.
 *  `width` is in the caller's own units (a badge scaled by 0.375 needs 4 to
 *  match the sight's 1.5). */
function haloOf(ink: string, halo: string, width: number): string {
  return ink.replace(
    /<path ([^>]*?)fill="[^"]*"/g,
    (_m, before: string) =>
      `<path ${before}fill="${halo}" stroke="${halo}" stroke-width="${width}" stroke-linejoin="round"`
  );
}

/** The role mark from the G1 sheet (`symbolBody`, unframed -- the ≤10 px
 *  form) with its `currentColor` baked to one hex. A cursor image has no
 *  `color` to inherit, so the ink must be written into the markup; the sheet
 *  only takes an ink for order marks, so the substitution happens here. */
function roleMark(bucket: RoleBucket, colour: string): string {
  return symbolBody(bucket).replaceAll('currentColor', hex(colour));
}

/** One sight's paint for one variant: the aim, the order's family main and
 *  accent, and the shared warm beat, each a palette key resolved to hex. */
function sightPaint(palette: Palette, variant: string, id: SightOrderId): SightPaint {
  const spec = ORDER_SIGHT[id];
  return {
    aim: hex(resolveKey(palette, variant, SIGHT_KEYS.aim)),
    main: hex(resolveKey(palette, variant, spec.main)),
    accent: hex(resolveKey(palette, variant, spec.accent)),
    hot: hex(resolveKey(palette, variant, SIGHT_KEYS.hot)),
  };
}

/** One frame of a sight as a whole cursor image: the halo, then the aim and
 *  surround (`sightFrame`, the same function the HUD's static mark comes
 *  from), then -- on a badged key -- the role mark in aim steel (Q8). The
 *  badge is haloed like the rest, at the width that survives its scale. */
function sightBody(id: SightOrderId, frame: number, palette: Palette, variant: string, badge: RoleBucket | null): string {
  const paint = sightPaint(palette, variant, id);
  const halo = hex(resolveKey(palette, variant, SIGHT_KEYS.halo));
  const ink = sightFrame(id, frame, paint);
  const place = (body: string): string =>
    `<g transform="translate(${SIGHT_BADGE.x} ${SIGHT_BADGE.y}) scale(${SIGHT_BADGE.scale})">${body}</g>`;
  const mark = badge ? roleMark(badge, paint.aim) : '';
  return svgSight(
    haloOf(ink, halo, HALO_WIDTH) +
      (mark ? place(haloOf(mark, halo, HALO_WIDTH / SIGHT_BADGE.scale)) : '') +
      ink +
      (mark ? place(mark) : '')
  );
}

/** Drawn, tested, and shipped by nothing. `mount`/`dismount` keep their
 *  housing drawings; `load`, `unload` and `halt` are approved sights (Q2)
 *  with no hover path to reach them -- halt is instant, and load/unload come
 *  only from the keyboard path (`resolveKeyVerb`), whose result never reaches
 *  the cursor. A rule for any of them would be dead bytes on every page
 *  load. Exported for the test that renders every state the set draws,
 *  including these five. Wire one into the hover ticker and it is a line in
 *  `SIGHT_OF` (cursor.ts) or `BareCursorName` here. */
export const UNWIRED_BODIES: Readonly<
  Record<'mount' | 'dismount' | 'load' | 'unload' | 'halt', (palette: Palette) => string>
> = {
  mount: (p) => mountBody(paletteColors(p)),
  dismount: (p) => dismountBody(paletteColors(p)),
  load: (p) => sightBody('load', 0, p, 'default', null),
  unload: (p) => sightBody('unload', 0, p, 'default', null),
  halt: (p) => sightBody('halt', 0, p, 'default', null),
};

type BareCursorName = Exclude<CursorName, 'default' | 'mount' | 'dismount' | 'charge'>;

/** The bare (unbadged) cursors that actually get a rule, in emission order.
 *
 *  `mount` and `dismount` stay out for a wiring reason: the hover ticker
 *  feeds only `resolvePointer`, which never emits those intents -- they come
 *  solely from the keyboard path (`resolveKeyVerb`), whose result never
 *  reaches the cursor (Important 1, final cursor-slice-3 review). `smoke`
 *  used to share that reason; it now reaches the cursor through the
 *  `armedSmoke` hint (Q2) and draws its sight.
 *
 *  `charge` stays out for a different, structural reason: `yahalom_squad` is
 *  the only unit with `canTunnelCharge` (BADGED_VERBS.charge below), so a
 *  charging group is always uniformly `soft` and the bare `charge` key can
 *  never compose -- it is always `charge-soft` (Minor 2, same review). */
const BARE_NAMES: readonly BareCursorName[] = [
  'move',
  'advance',
  'sweep',
  'strike',
  'smoke',
  'blocked',
  'costly',
  'protected',
  'garrison',
  'demolish',
  'pinned',
];

/** The seven housing colours, read from the `ui` band `deriveUiBand` builds.
 *  Kept as a single function so no body reaches into the palette shape
 *  directly and a rename lands in exactly one place. */
export function paletteColors(palette: Palette): CursorColors {
  const ui = palette.reserved.ui.colors;
  return {
    ink: ui.ink,
    dim: ui.dim,
    bad: ui.bad,
    warn: ui.warn,
    hot: ui.hot,
    amber: ui.amber,
    info: ui.info,
  };
}

// Where the role badge rides a HOUSING, and it is not a free choice: this is
// the bottom-right bracket's own footprint. `bracketAt('br', defaults)` spans
// x22-29, y22-29 -- centre 25.5, half-extent 3.5 -- and a badge inscribed in
// r=4.5 there covers 21-30, i.e. the plate plus a hair. That coincidence is
// the design: the badged key omits that bracket (see `BodyOpts.badged`) and
// the badge becomes the plate.
//
// It also has to be measured rather than eyeballed, because two payloads reach
// into that corner. Centred at the previous 24,24 the badge box was 19.5-28.5
// and `garrison`'s portal wall (x21-23, y13-23) cut through the top-left of
// every garrison badge, welding the mark to the portal; `demolish`'s core
// (outer corner 22,22) bit into it too. At 25.5 the portal clears the nearest
// badge geometry by 0.7px and the core by construction. Rendered both ways at
// 6x and at true 32px over real limestone ground before choosing.
//
// The mark is the G1 sheet's 24-unit APP-6 role mark, so it is placed with
// the same translate-and-scale a sight's badge uses: the box's corner at
// (CX - R, CY - R), scaled to 2R / 24.
const BADGE_CX = 25.5;
const BADGE_CY = 25.5;
const BADGE_R = 4.5;

/** The role mark on the housing's bottom-right plate -- see BADGE_CX/CY/R. */
function badgeMark(bucket: RoleBucket, colour: string): string {
  return (
    `<g transform="translate(${BADGE_CX - BADGE_R} ${BADGE_CY - BADGE_R}) scale(${(2 * BADGE_R) / SIGHT_BOX})">` +
    roleMark(bucket, colour) +
    '</g>'
  );
}

/** Which buckets can actually reach each verb -- from the roster. `move` and
 *  `advance` are reachable by all seven; `garrison`, `demolish` and `charge`
 *  are gated to the subset of buckets whose units can actually issue them.
 *  Typed over `Exclude<CursorName, UnbadgedName>` rather than
 *  `Exclude<CursorName, 'default'>` so `blocked`, `costly`, `protected`,
 *  `sweep` and `strike` -- which describe the target or the mode, not the
 *  actor, and never earn a badge -- cannot even be added here by mistake;
 *  see `UNBADGED_NAMES` in cursor.ts, which this type derives from.
 *
 *  `mount`, `dismount` and `smoke` are real abilities units in
 *  data/units/kdf/ have (`canEmbark`, `transportSlots > 0`, `canSmoke`), but
 *  earn no entry here. mount and dismount: the hover ticker feeds only
 *  `resolvePointer`, which never emits those intents, so a badge rule for
 *  them could never compose and would be dead bytes (Important 1, final
 *  cursor-slice-3 review). smoke: its cursor is the ARMED smoke order (the
 *  `armedSmoke` hint), and no intent the hover resolves ever names itself
 *  `smoke` for `badgeFor` to find, so it is only ever bare.
 *
 *  A verb absent here keeps only its bare (unbadged) rule, except `charge`:
 *  `yahalom_squad` is the only unit with `canTunnelCharge`, so a charging
 *  group is always uniformly `soft` and the bare `charge` key can never
 *  compose (Minor 2, same review) -- `BareCursorName` excludes it for that
 *  reason. Exported so a test can derive this table from the roster and
 *  assert the two never drift apart -- see the "BADGED_VERBS reachability is
 *  derived from the roster" describe in vite-plugin-cursors.test.ts. */
export const BADGED_VERBS: { [K in Exclude<CursorName, UnbadgedName>]?: RoleBucket[] } = {
  move: ['kamikaze', 'drone', 'gunship', 'sniper', 'transport', 'soft', 'armour'],
  advance: ['kamikaze', 'drone', 'gunship', 'sniper', 'transport', 'soft', 'armour'],
  garrison: ['soft', 'sniper'],
  demolish: ['soft', 'armour'],
  charge: ['soft'],
};

/** One housing state's body, the same for its bare rule and every badged
 *  rule -- so a badged rule is always exactly that body plus a badge mark,
 *  never a second drawing that could drift from the first. The only
 *  difference a badge makes to the body itself is the omitted bottom-right
 *  bracket, and that is `BodyOpts.badged`, handled inside each body. `frame`
 *  is read by `demolishBody` and `chargeBody` alone (the two animated housing
 *  states); every other body ignores it. */
function housingBody(name: CursorName, c: CursorColors, o: BodyOpts = {}): string {
  switch (name) {
    case 'blocked':
      return blockedBody(c);
    case 'costly':
      return costlyBody(c);
    case 'pinned':
      return pinnedBody(c);
    case 'protected':
      return protectedBody(c);
    case 'garrison':
      return garrisonBody(c, o);
    case 'demolish':
      return demolishBody(c, o);
    case 'charge':
      return chargeBody(c, o);
    default:
      throw new Error(`vite-plugin-cursors: '${name}' has no housing body`);
  }
}

/** The badge is a plate of the housing, so it is drawn in the housing's own
 *  colour -- a contrasting badge would read as one plate painted differently,
 *  which is precisely what `demolish`'s beacon means, and two things cannot
 *  mean it at once.
 *
 *  `demolish` is therefore the one state whose badge colour moves: on the one
 *  frame in four where the beacon reaches the bottom-right plate, the badge IS
 *  that plate and lights bone-white with it. Without this the sweep would go
 *  dark for a quarter of every cycle on exactly the badged keys, which is the
 *  "a timer tick that changes nothing" defect the frame tests exist to catch,
 *  wearing a costume. */
function badgeColourFor(name: CursorName, c: CursorColors, o: BodyOpts = {}): string {
  switch (name) {
    case 'garrison':
      return c.info;
    case 'charge':
      return c.bad;
    case 'demolish':
      return demolishBeaconLitsBadge({ ...o, badged: true }) ? c.ink : c.hot;
    default:
      return c.ink;
  }
}

/** The whole cursor image for one key at one frame under one variant: a
 *  sight for the five `SIGHT_OF` names, the housing (plus its plate badge)
 *  for the rest. */
function imageFor(name: CursorName, badge: RoleBucket | null, frame: number, palette: Palette, variant: string): string {
  const sight = SIGHT_OF[name];
  if (sight) return sightBody(sight, frame, palette, variant, badge);
  const c = paletteColors(deriveUiBand(palette, variant));
  const o: BodyOpts = { frame, badged: badge !== null };
  return svg(housingBody(name, c, o) + (badge ? badgeMark(badge, badgeColourFor(name, c, o)) : ''));
}

/**
 * Every cursor key the sheet draws, with its image per frame, under one
 * colour-vision variant: `images.get(key)[k]` is exactly what the browser
 * must show for that key at `data-cursor-frame` k with `data-cvd` = variant.
 * A static key has one frame; an animated one `ANIMATED_CURSORS[name].frames`.
 * Bare keys first (in BARE_NAMES order), then the badged keys by verb.
 *
 * This is the direct answer `cursorRules` compiles into CSS, exported so a
 * test can hold the compiled cascade against it for every variant, key and
 * frame.
 */
export function cursorImages(palette: Palette, variant = 'default'): Map<string, readonly string[]> {
  const images = new Map<string, readonly string[]>();
  const add = (name: CursorName, badge: RoleBucket | null): void => {
    const frames = ANIMATED_CURSORS[name]?.frames ?? 1;
    images.set(
      cursorKey(name, badge),
      Array.from({ length: frames }, (_, frame) => imageFor(name, badge, frame, palette, variant))
    );
  };
  for (const name of BARE_NAMES) add(name, null);
  for (const [name, buckets] of Object.entries(BADGED_VERBS) as [keyof typeof BADGED_VERBS, RoleBucket[]][]) {
    for (const bucket of buckets) add(name, bucket);
  }
  return images;
}

/** Where a sight's hotspot lands on the 32 px canvas: order-sight's own
 *  HOTSPOT, authored on the 24-box, scaled by the sight's viewBox. Derived
 *  rather than assumed equal to CENTER, so moving the aim's hotspot moves the
 *  emitted one with it -- and the tests, which pin 16 16, go red. */
export const SIGHT_HOTSPOT = {
  x: (HOTSPOT.x * SIZE) / SIGHT_BOX,
  y: (HOTSPOT.y * SIZE) / SIGHT_BOX,
} as const;

/** The hotspot for one cursor key: the sight's for the five `SIGHT_OF`
 *  names (bare or badged), the housing's dead centre for the rest. */
function hotspotFor(key: string): { x: number; y: number } {
  const name = key.split('-')[0] as CursorName;
  return SIGHT_OF[name] ? SIGHT_HOTSPOT : { x: CENTER, y: CENTER };
}

/**
 * An SVG as the body of a `data:` URI inside a double-quoted CSS `url("")`.
 *
 * Lighter than `encodeURIComponent`, which escapes every space, quote,
 * slash and equals sign to three bytes: attribute quotes become single
 * quotes (legal SVG, and harmless inside the CSS string's double quotes),
 * and only `%`, `#`, `<` and `>` are percent-encoded. `#` is the one that
 * matters most -- a raw one ends the URI at the fragment and the cursor
 * silently becomes the OS arrow; `%` would otherwise read as an escape; `<`
 * and `>` are encoded for the parsers that are strict about them. Nothing in
 * the drawn markup contains a single quote of its own, a backslash or a
 * newline, so this is a lossless round trip (`decodeSvgUri`). Measured on
 * the full sheet: 344 KB -> 247 KB raw, 9.5 -> 7.9 KB gzip, pixels identical.
 */
export function encodeSvgUri(markup: string): string {
  return markup.replaceAll('"', "'").replace(/[%#<>]/g, (c) => encodeURIComponent(c));
}

/** The inverse of `encodeSvgUri`, for tests and tools. */
export function decodeSvgUri(body: string): string {
  return decodeURIComponent(body).replaceAll("'", '"');
}

/** One rule: a selector list and the image it draws, at that key's hotspot.
 *  One rule per line, which the tests rely on. */
function rule(key: string, selectors: readonly string[], markup: string): string {
  const h = hotspotFor(key);
  return `${selectors.join(', ')} { cursor: url("data:image/svg+xml,${encodeSvgUri(markup)}") ${h.x} ${h.y}, auto; }`;
}

/** The selector for one key, at one frame (null: the frame-0 rule, which
 *  names no frame at all -- the fail-safe), under one variant (null: the
 *  default sheet, which names no `data-cvd` at all). */
function selectorFor(key: string, frame: number | null, variant: string | null): string {
  const cvd = variant === null ? '' : `:root[data-cvd='${variant}'] `;
  const f = frame === null ? '' : `[data-cursor-frame='${frame}']`;
  return `${cvd}canvas[data-cursor='${key}']${f}`;
}

/** The CSS text the plugin injects.
 *
 *  First the DEFAULT sheet: per key, one frame-0 rule (selector names only
 *  `data-cursor`, specificity 0,1,1) and one rule per further frame whose
 *  image differs from frame 0 (`[data-cursor-frame]` added, 0,2,1). A frame
 *  that would redraw frame 0 byte for byte emits NO rule: with no selector to
 *  match, the cascade falls through to the frame-0 rule, which draws exactly
 *  that -- the same fail-safe a stale or absent attribute already relies on.
 *  The test is CONTENT, never position, so a retune that gives a cycle a rest
 *  frame starts eliding on its own and one that removes it stops.
 *
 *  Then, per colour-vision variant in `reserved.team.variants`, only what
 *  that variant draws differently, prefixed `:root[data-cvd='<v>'] `. The
 *  trap: that prefix adds 0,2,0, so a variant's FRAME-0 rule (0,3,1) outranks
 *  the default's frame-k rules (0,2,1). A variant that overrode frame 0 and
 *  nothing else would therefore freeze the cursor on frame 0 under that
 *  setting. So each variant frame k >= 1 is judged against what would
 *  otherwise WIN there -- the variant's own frame 0 once that rule exists,
 *  the default's frame k (or its frame 0) when it does not -- and emitted
 *  (0,4,1) whenever that is not already the right image. Variants whose
 *  markup is byte-identical for a rule share it as one selector list
 *  (deuteranopia and protanopia share every team hex); a key no variant
 *  changes emits nothing beyond the default sheet.
 */
export function cursorRules(palette: Palette): string {
  const defaults = cursorImages(palette, 'default');
  const frameZero: string[] = [];
  const later: string[] = [];
  for (const [key, frames] of defaults) {
    frameZero.push(rule(key, [selectorFor(key, null, null)], frames[0]));
    frames.forEach((markup, frame) => {
      if (frame > 0 && markup !== frames[0]) later.push(rule(key, [selectorFor(key, frame, null)], markup));
    });
  }

  /** (key, frame, markup) -> the variants that need that exact rule, in
   *  first-seen order, so identical rules merge into one selector list. */
  const overrides = new Map<string, { key: string; frame: number | null; markup: string; variants: string[] }>();
  const need = (variant: string, key: string, frame: number | null, markup: string): void => {
    const id = `${key}\u0000${frame ?? ''}\u0000${markup}`;
    const entry = overrides.get(id) ?? { key, frame, markup, variants: [] };
    entry.variants.push(variant);
    overrides.set(id, entry);
  };
  for (const variant of Object.keys(palette.reserved.team?.variants ?? {})) {
    for (const [key, frames] of cursorImages(palette, variant)) {
      const base = defaults.get(key);
      if (!base) throw new Error(`vite-plugin-cursors: '${key}' drawn under ${variant} but not by default`);
      const ownZero = frames[0] !== base[0];
      if (ownZero) need(variant, key, null, frames[0]);
      frames.forEach((markup, frame) => {
        if (frame === 0) return;
        const wouldWin = ownZero ? frames[0] : base[frame];
        if (markup !== wouldWin) need(variant, key, frame, markup);
      });
    }
  }
  const variantRules = [...overrides.values()].map(({ key, frame, markup, variants }) =>
    rule(
      key,
      variants.map((v) => selectorFor(key, frame, v)),
      markup
    )
  );

  return [...frameZero, ...later, ...variantRules].join('\n');
}

// The real data/palette.json has no `ui` reserved band -- the housing's
// colour is drawn entirely from bands that already exist, so a cursor and
// the HUD text it sits next to always agree on what "bad" looks like.
// Exported (not inlined into cursorsPlugin) so a test can run this exact
// translation against the real file on disk: that shape never occurs on
// disk, only here -- so this is the one seam a rename or removal of any of
// the seven source values would otherwise slip past.
//
// Every value goes through `resolveKey`, so `bad` (team.hostile) and `warn`
// (team.neutral) follow the colour-vision `variant` the same way the sights'
// team colours do (Q9) -- before S3e they were hard-wired to the default hex.
// Re-deriving over an already-derived palette is harmless: the source bands
// survive the spread, and `ui` is simply rebuilt.
//
// Seven, not eight: `scrub[0]` (#6B8A4A, the palette's olive) is the one
// colour the chosen set declines, and it is declined on evidence -- it sits
// about 30 RGB from `dim` and photographs as mud at 32px on limestone.
// Deriving it here would be an unused field that reads as an oversight.
export function deriveUiBand(raw: Palette, variant = 'default'): Palette {
  const k = (key: string): string => resolveKey(raw, variant, key);
  return {
    ...raw,
    reserved: {
      ...raw.reserved,
      ui: {
        colors: {
          ink: k('limestone.0'),
          dim: k('gunmetal.1'),
          amber: k('dust.0'),
          info: k('water.0'),
          bad: k('team.hostile'),
          warn: k('team.neutral'),
          hot: k('vfx.fire'),
        },
      },
    },
  };
}

/** Reads and shapes the palette exactly as `cursorsPlugin` does at request
 *  time -- factored out so a test can point it at the real data/palette.json. */
export function resolvePalette(paletteUrl: URL): Palette {
  const raw = JSON.parse(readFileSync(paletteUrl, 'utf8')) as Palette;
  return deriveUiBand(raw);
}

export function cursorsPlugin(paletteUrl: URL): Plugin {
  const path = paletteUrl.pathname;

  return {
    name: 'lions-cursors',

    configureServer(server) {
      server.watcher.add(path);
      server.watcher.on('change', (file) => {
        if (file === path) server.ws.send({ type: 'full-reload' });
      });
    },

    transformIndexHtml() {
      return [
        {
          tag: 'style',
          attrs: { 'data-cursor-rules': 'data/palette.json' },
          children: cursorRules(resolvePalette(paletteUrl)),
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}
