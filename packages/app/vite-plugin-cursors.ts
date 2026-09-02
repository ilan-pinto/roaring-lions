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
// `default` (one of the thirteen names) deliberately gets no rule -- it is
// the OS arrow. Shipping an empty SVG for it would HIDE the arrow rather than
// fall through to it.
//
// ---------------------------------------------------------------------------
// THE ART: "Tiberian heavy housing", chosen by the project lead from four
// drawn candidates (2026-09-03). Its organising idea, in the designer's own
// words:
//
//   "Every cursor is a piece of machined hardware: the same four chamfered
//    corner brackets form a heavy housing that never touches the hotspot, and
//    what changes between states is the payload bolted into the middle and
//    the colour of the plate."
//
// So there is exactly one shape primitive here -- `bracket`, parameterised by
// inset/arm/thickness/chamfer -- and every one of the 55 emitted images is
// that primitive four times (or three, see the badge below) plus a payload.
// The parameterisation is the point: 55 hand-written images would drift the
// moment anyone adjusted a bracket, and the four corners would stop being the
// same four corners.
//
// Three findings the designer made by rendering at true 32px and looking, so
// nobody re-derives them by reasoning:
//   - `blocked` drawn wholly in `dim` is nearly invisible on limestone ground
//     at 32px. Its housing stays `dim`; its broken bar is `ink`.
//   - `attack` had mid-edge crosshair ticks. At 32px they turned the tight
//     frame into a ring of dashes. Gone -- the brackets carry it alone.
//   - `smoke`'s billow read as a table lamp for two attempts before it became
//     a stepped plume over a canister. (`smoke` earns no rule today -- see
//     BareCursorName -- but the drawing survives in SMOKE_* for the day the
//     keyboard verb path is wired to the cursor.)
//
// THE BADGE IS THE FOURTH PLATE. `BADGE_CX/CY`/`BADGE_R` put the role badge
// exactly on the bottom-right bracket's own footprint, so on a badged key that
// bracket is OMITTED and the badge stands in its place -- it reads as the
// fourth corner plate rather than as a sticker stuck on top. Drawing the badge
// over the bracket, or moving it to a mid-edge gap, were both considered and
// rejected (the project lead's call). `demolish` takes this literally: its
// beacon sweep visits the badge like any other plate.
//
// ---------------------------------------------------------------------------
// Three of the thirteen names (`attack`, `charge`, `demolish`) additionally
// animate: each draws up to `ANIMATED_CURSORS[name].frames` distinct SVGs
// instead of one, emitted as extra rules keyed on a second attribute,
// `data-cursor-frame`, that main.ts's frame driver cycles on a plain JS timer
// -- see ANIMATED_CURSORS's own comment in cursor.ts for which names qualify,
// why, and for the one honest exception among them.
//
// Frame 0 of each is drawn by the *same* code path as every other cursor's
// single rule (`bodyFor` called with no frame argument, defaulting to 0), so
// only frames 1..N-1 are new, additive rules layered on top via the extra
// attribute selector. That makes the animation FAIL SAFE: a stale or absent
// `data-cursor-frame` (nothing has written it yet, or it is left over from a
// *different* animated cursor) simply falls back to this always-correct
// frame-0 rule rather than to nothing.
//
// "up to `frames`" because a frame that would redraw its own key's frame 0
// byte for byte emits no rule at all and leans on that same fallback -- see
// cursorRules' frame loop. `attack`'s midpoint is such a frame by design
// (rest, converge, rest, release); `demolish`'s sweep has no rest pose, so
// nothing of its four is elidable.

import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';
import {
  ANIMATED_CURSORS,
  cursorKey,
  type CursorAnimation,
  type CursorName,
  type UnbadgedName,
} from './src/input/cursor';
import { roleBadgeShapes, type RoleBucket } from './src/ui/role';

interface Palette {
  ramps: Record<string, { colors: string[] }>;
  reserved: Record<string, { colors: Record<string, string> }>;
}

// The eight drawn bare cursors (thirteen names in CursorName, minus
// 'default', 'mount', 'dismount', 'smoke' and 'charge' -- see BareCursorName
// and BADGED_VERBS below for why those five never get a rule of their own)
// all share one hotspot: dead centre, at half the canvas size on each axis.
// The housing is built so that nothing is ever drawn there -- the hotspot sits
// in the open middle of the frame, and the payload (where a state has one)
// stays clear of it too, so the cursor never covers what it is aiming at.
//
// Every path literal below is authored on this 32-unit grid; `bracketAt`'s
// mirror arithmetic and the payload coordinates both assume it, and
// vite-plugin-cursors.test.ts pins SIZE so that assumption cannot go stale
// silently.
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

function fillPath(colour: string, d: string): string {
  return `<path fill="${hex(colour)}" d="${d}"/>`;
}

function fillPathEvenOdd(colour: string, d: string): string {
  return `<path fill="${hex(colour)}" fill-rule="evenodd" d="${d}"/>`;
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
 *  vocabulary and the extra weight is what separates it from `support`, the
 *  other X-shaped state, at 32px. */
interface HousingOpts {
  /** Distance from the canvas edge to the bracket's outer corner. */
  inset?: number;
  /** How far each leg of the L runs from that corner. */
  arm?: number;
  /** How thick each leg is. */
  thickness?: number;
  /** How far the outer corner is cut back, giving the machined chamfer. */
  chamfer?: number;
  /** A corner to leave undrawn. Badged keys omit `br` so the role badge can
   *  stand in its place. */
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

/** move: a machined diamond ring, punched hollow by `fill-rule="evenodd"` so
 *  the hotspot at the exact centre stays open. */
const MOVE_RING = 'M16,9L23,16L16,23L9,16ZM16,12L20,16L16,20L12,16Z';

/** attack: the housing IS the reticle and it CLOSES on the target. Frame 0 is
 *  the rest inset every other state uses, 1 converges, 2 returns to rest (so
 *  it is byte-identical to 0 and cursorRules elides it), 3 opens a little past
 *  rest as a release before the loop wraps. */
const ATTACK_INSETS: readonly number[] = [3, 6, 3, 1];

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
 *  moved would be two animations at once, and the still core is the whole
 *  discriminator against `attack`, whose housing moves and which has no core
 *  at all.
 *
 *  This is NOT the drawn set's core, and the substitution is the one place
 *  this file departs from the art the project lead approved. The designer
 *  flagged their own split-block (a closed square with two diagonal crack
 *  ticks inside it) as the second of three things to check at true size, and
 *  it fails: rendered at 32px over `open-ground.png`'s real limestone the two
 *  ticks read as a diagonal double-headed arrow, i.e. as a resize handle,
 *  which is a cursor that means something else. Six replacements were drawn
 *  and photographed at 32px and 6x before this one -- a plain block (clean but
 *  generic, and it collides with `armour`'s own square badge on
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

/** The eight colours the set actually draws with, resolved from the palette.
 *
 *  `good` (scrub[0], #6B8A4A) is deliberately NOT here and is the one palette
 *  colour this set declines: olive sits about 30 RGB from `dim` and photographs
 *  as mud at 32px on limestone ground, and nothing in this vocabulary wanted a
 *  third neutral. `live` (vfx.tracer) carries the affirmative states instead.
 *  `paletteColors`' test asserts the omission rather than leaving it to this
 *  comment. */
interface CursorColors {
  ink: string;
  dim: string;
  bad: string;
  warn: string;
  hot: string;
  amber: string;
  info: string;
  live: string;
}

/** What a body needs to know beyond its colours. */
interface BodyOpts {
  /** Animation frame, 0 for every static state and for every frame-0 rule. */
  frame?: number;
  /** True when a role badge will be appended to this body, in which case the
   *  bottom-right bracket is omitted so the badge can be that plate. */
  badged?: boolean;
}

function moveBody(c: CursorColors, o: BodyOpts = {}): string {
  return fillPathEvenOdd(c.ink, housing({ omit: o.badged ? 'br' : undefined }) + MOVE_RING);
}

function attackBody(c: CursorColors, o: BodyOpts = {}): string {
  const inset = ATTACK_INSETS[o.frame ?? 0] ?? ATTACK_INSETS[0];
  return fillPath(c.bad, housing({ inset, omit: o.badged ? 'br' : undefined }));
}

function blockedBody(c: CursorColors): string {
  return fillPath(c.dim, housing()) + strokePath(c.ink, 4, 'M9,23L14,18M18,14L23,9');
}

function costlyBody(c: CursorColors): string {
  return fillPath(c.warn, housing()) + strokePath(c.warn, 2, 'M16,12L25,21H7Z');
}

function protectedBody(c: CursorColors): string {
  return (
    fillPath(c.bad, housing({ arm: 8, thickness: 4, chamfer: 4 })) +
    strokePath(c.bad, 4, 'M9,9L14,14M23,9L18,14M9,23L14,18M23,23L18,18')
  );
}

function supportBody(c: CursorColors): string {
  return fillPath(c.live, housing()) + strokePath(c.live, 2, 'M11,8L16,13L21,8M11,24L16,19L21,24');
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

/** mount, dismount and smoke draw no rule today -- see BareCursorName and
 *  BADGED_VERBS. Their bodies are kept (unlike the previous set, where they
 *  were deleted) because the housing makes them nearly free: each is the same
 *  four brackets plus one payload literal, and re-deriving three payloads that
 *  have already been drawn, rendered and looked at is the expensive half. They
 *  are not called, so they ship no bytes. Wire resolveKeyVerb's result into
 *  the cursor and they are three lines in `shapesFor`. */
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
function smokeBody(c: CursorColors): string {
  return (
    fillPath(c.info, housing() + 'M14,23H18V29H14Z') +
    strokePath(c.info, 2, 'M8,20V16H12V13H17V10H22V14H25V20')
  );
}
/** Referenced so the three unwired bodies above are not dead code the linter
 *  strips or a reader deletes. Exported for the test that renders every state
 *  the set draws, including the three that earn no rule yet. */
export const UNWIRED_BODIES: Readonly<Record<'mount' | 'dismount' | 'smoke', (c: CursorColors) => string>> = {
  mount: mountBody,
  dismount: dismountBody,
  smoke: smokeBody,
};

type BareCursorName = Exclude<CursorName, 'default' | 'mount' | 'dismount' | 'smoke' | 'charge'>;

/** The bare (unbadged) reticles that actually get a rule.
 *
 *  `mount`, `dismount` and `smoke` stay out for a wiring reason: the hover
 *  ticker feeds only `resolvePointer`, which never emits those intents --
 *  they come solely from the keyboard path (`resolveKeyVerb`), whose result
 *  never reaches the cursor. A rule for them would be dead bytes shipped on
 *  every page load (Important 1, final cursor-slice-3 review). They stay in
 *  `CursorName` and `winningVerb`'s rungs are untouched, so a later feature
 *  can still preview them -- only the generated rule is withheld.
 *
 *  `charge` stays out for a different, structural reason: `yahalom_squad` is
 *  the only unit with `canTunnelCharge` (BADGED_VERBS.charge below), so a
 *  charging group is always uniformly `soft` and the bare `charge` key can
 *  never compose -- it is always `charge-soft` (Minor 2, same review). */
function shapesFor(palette: Palette): Record<BareCursorName, string> {
  const c = paletteColors(palette);
  return {
    move: svg(moveBody(c)),
    attack: svg(attackBody(c)),
    blocked: svg(blockedBody(c)),
    costly: svg(costlyBody(c)),
    protected: svg(protectedBody(c)),
    support: svg(supportBody(c)),
    garrison: svg(garrisonBody(c)),
    demolish: svg(demolishBody(c)),
  };
}

/** The eight colours, read from the `ui` band `deriveUiBand` builds. Kept as a
 *  single function so no body reaches into the palette shape directly and a
 *  rename lands in exactly one place. */
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
    live: ui.live,
  };
}

// Where the role badge rides, and it is not a free choice: this is the
// bottom-right bracket's own footprint. `bracketAt('br', defaults)` spans
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
const BADGE_CX = 25.5;
const BADGE_CY = 25.5;
const BADGE_R = 4.5;

/** A small SVG mark riding the housing's bottom-right plate, shaped to match
 *  `ROLE_GLYPH`'s Unicode for the same bucket in `src/ui/role.ts` -- so the
 *  cursor's badge and the inspect card's glyph read as the same thing to a
 *  player who sees both at once. Drawn as paths rather than that Unicode
 *  text, because font availability inside a cursor image is not something
 *  to bet on. Kept to a few path commands each: this rides at roughly 10px
 *  on a 32px reticle, seen in motion.
 *
 *  The geometry itself lives in `role.ts` as `roleBadgeShapes`, and has since
 *  GH-153 gave it a third reader (the selection chip and the unit card). This
 *  wrapper is what stays here: the badge's PLACE on the reticle, and the fact
 *  that a cursor image inherits no colour so the hex has to be baked in. */
function badgeMark(bucket: RoleBucket, colour: string): string {
  return roleBadgeShapes(bucket, BADGE_CX, BADGE_CY, BADGE_R, hex(colour));
}

/** Which buckets can actually reach each verb -- from the roster. `move` and
 *  `attack` are reachable by all seven; `garrison`, `demolish` and `charge`
 *  are gated to the subset of buckets whose units can actually issue them.
 *  Typed over `Exclude<CursorName, UnbadgedName>` rather than
 *  `Exclude<CursorName, 'default'>` so `blocked`, `costly`, `protected` and
 *  `support` -- which describe the target or the mode, not the actor, and
 *  never earn a badge -- cannot even be added here by mistake; see
 *  `UNBADGED_NAMES` in cursor.ts, which this type derives from.
 *
 *  `mount`, `dismount` and `smoke` are real abilities units in
 *  data/units/kdf/ have (`canEmbark`, `transportSlots > 0`, `canSmoke`), but
 *  earn no entry here: the hover ticker feeds only `resolvePointer`, which
 *  never emits those intents, so a badge rule for them could never compose
 *  and would be dead bytes (Important 1, final cursor-slice-3 review).
 *  `winningVerb` still ranks them, for the day a keyboard-driven preview is
 *  wired in; only the generated rule is withheld.
 *
 *  A verb absent here keeps only its bare (unbadged) rule, except `charge`:
 *  `yahalom_squad` is the only unit with `canTunnelCharge`, so a charging
 *  group is always uniformly `soft` and the bare `charge` key can never
 *  compose (Minor 2, same review) -- `shapesFor`'s `BareCursorName` excludes
 *  it for that reason. Exported so a test can derive this table from the
 *  roster and assert the two never drift apart -- see the "BADGED_VERBS
 *  reachability is derived from the roster" describe in
 *  vite-plugin-cursors.test.ts. */
export const BADGED_VERBS: { [K in Exclude<CursorName, UnbadgedName>]?: RoleBucket[] } = {
  move: ['kamikaze', 'drone', 'gunship', 'sniper', 'transport', 'soft', 'armour'],
  attack: ['kamikaze', 'drone', 'gunship', 'sniper', 'transport', 'soft', 'armour'],
  garrison: ['soft', 'sniper'],
  demolish: ['soft', 'armour'],
  charge: ['soft'],
};

/** The same base body used for a verb's bare rule, so a badged rule is
 *  always exactly that body plus a badge mark -- never a second drawing that
 *  could drift from the first. The only difference a badge makes to the body
 *  itself is the omitted bottom-right bracket, and that is `BodyOpts.badged`,
 *  handled inside each body rather than by the caller.
 *
 *  `mount`, `dismount` and `smoke` fall to the default branch: they remain
 *  valid keys of the type (BADGED_VERBS is typed over the full
 *  `Exclude<CursorName, UnbadgedName>`) but never occur as actual entries, so
 *  this is never called for them.
 *
 *  Typed over the full `CursorName` (wider than `BADGED_VERBS`'s keys) so
 *  the frame-override loop in cursorRules below -- which walks
 *  ANIMATED_CURSORS, not BADGED_VERBS -- can call this without a cast; every
 *  existing caller already passes a `keyof typeof BADGED_VERBS`, a subtype,
 *  so this widening changes nothing for them. `frame` defaults to 0, which
 *  is what every pre-animation caller still implicitly asks for -- and only
 *  `attackBody`/`chargeBody`/`demolishBody` (the three ANIMATED_CURSORS
 *  names) read it at all, so a non-zero frame passed for any other name is
 *  simply ignored, not an error. */
function bodyFor(name: CursorName, palette: Palette, o: BodyOpts = {}): string {
  const c = paletteColors(palette);
  switch (name) {
    case 'move':
      return moveBody(c, o);
    case 'attack':
      return attackBody(c, o);
    case 'garrison':
      return garrisonBody(c, o);
    case 'demolish':
      return demolishBody(c, o);
    case 'charge':
      return chargeBody(c, o);
    default:
      return '';
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
    case 'move':
      return c.ink;
    case 'attack':
      return c.bad;
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

function ruleFor(key: string, markup: string): string {
  const encoded = encodeURIComponent(markup);
  return (
    `canvas[data-cursor='${key}'] { ` +
    `cursor: url("data:image/svg+xml,${encoded}") ${CENTER} ${CENTER}, auto; }`
  );
}

/** Same shape as ruleFor, plus the `data-cursor-frame` requirement -- more
 *  specific than ruleFor's single-attribute selector, so once main.ts's
 *  frame driver sets a matching frame index this wins; otherwise ruleFor's
 *  frame-0 rule for the same key still applies. */
function ruleForFrame(key: string, frame: number, markup: string): string {
  const encoded = encodeURIComponent(markup);
  return (
    `canvas[data-cursor='${key}'][data-cursor-frame='${frame}'] { ` +
    `cursor: url("data:image/svg+xml,${encoded}") ${CENTER} ${CENTER}, auto; }`
  );
}

/** The CSS text: one rule per drawn cursor name, each with an explicit
 *  hotspot so the pointer's true position matches where the shape aims, plus
 *  one further rule per reachable (verb, bucket) badge combination, plus
 *  (for the small set ANIMATED_CURSORS names) one further rule per
 *  additional frame 1..N-1, on top of every key that name already earned
 *  above -- bare, badged, or both. */
export function cursorRules(palette: Palette): string {
  const shapes = shapesFor(palette);
  const colors = paletteColors(palette);
  const rules: string[] = [];
  /** What each key's frame-0 rule already draws, keyed by cursor key. The
   *  frame loop below consults it to drop a frame that would redraw exactly
   *  this -- see its comment. */
  const frameZero = new Map<string, string>();

  for (const [name, markup] of Object.entries(shapes) as [BareCursorName, string][]) {
    const key = cursorKey(name, null);
    frameZero.set(key, markup);
    rules.push(ruleFor(key, markup));
  }

  for (const [name, buckets] of Object.entries(BADGED_VERBS) as [
    keyof typeof BADGED_VERBS,
    RoleBucket[],
  ][]) {
    const base = bodyFor(name, palette, { badged: true });
    const badgeColour = badgeColourFor(name, colors);
    for (const bucket of buckets) {
      const markup = svg(base + badgeMark(bucket, badgeColour));
      const key = cursorKey(name, bucket);
      frameZero.set(key, markup);
      rules.push(ruleFor(key, markup));
    }
  }

  // Frame overrides. bareNames records which ANIMATED_CURSORS entries also
  // drew a bare rule above (`attack` and `demolish` did; `charge` did not --
  // see BareCursorName's comment on why `charge` never gets one), so this
  // never has to hardcode which is which.
  //
  // A frame whose markup is byte-identical to its own key's frame-0 markup
  // emits NO rule. `attack`'s pulse deliberately returns to rest at its
  // midpoint (ATTACK_INSETS' "rest, converge, rest, release"), so frame 2 of
  // each of its eight keys would otherwise ship a second copy of an image the
  // frame-0 rule already draws at lower specificity. Dropping the rule changes
  // nothing on screen: with no `[data-cursor-frame='2']` selector to match,
  // the cascade falls through to exactly that frame-0 rule, which is the same
  // fail-safe the plugin's top comment already relies on for a stale or absent
  // attribute. main.ts's driver still counts 0..frames-1 and still writes '2';
  // it simply has no rule of its own to hit.
  //
  // `demolish` no longer benefits: its beacon visits a different plate on
  // every one of its four frames, so there is no rest pose to be identical to.
  // That is exactly why the test is CONTENT ("this markup equals frame 0's")
  // and never position ("skip frame 2") -- the art changed underneath this
  // loop and the loop needed no edit at all. A future retune that gives
  // demolish a rest frame will start eliding again on its own, and one that
  // makes attack's midpoint a real fifth shape will start emitting it.
  const bareNames = new Set<string>(Object.keys(shapes));
  for (const [name, anim] of Object.entries(ANIMATED_CURSORS) as [CursorName, CursorAnimation][]) {
    const buckets = (BADGED_VERBS as Partial<Record<CursorName, RoleBucket[]>>)[name] ?? [];
    const pushFrame = (key: string, frame: number, markup: string): void => {
      if (frameZero.get(key) === markup) return;
      rules.push(ruleForFrame(key, frame, markup));
    };
    for (let frame = 1; frame < anim.frames; frame++) {
      if (bareNames.has(name)) {
        pushFrame(cursorKey(name, null), frame, svg(bodyFor(name, palette, { frame })));
      }
      const badgedBase = bodyFor(name, palette, { frame, badged: true });
      const badgeColour = badgeColourFor(name, colors, { frame });
      for (const bucket of buckets) {
        pushFrame(cursorKey(name, bucket), frame, svg(badgedBase + badgeMark(bucket, badgeColour)));
      }
    }
  }

  return rules.join('\n');
}

// The real data/palette.json has no `ui` reserved band -- cursor colour is
// drawn entirely from bands that already exist, so a cursor and the HUD text
// it sits next to always agree on what "bad" looks like. Exported (not inlined
// into cursorsPlugin) so a test can run this exact translation against the
// real file on disk: cursorRules is tested as a pure function over an
// already-shaped Palette, and that shape never occurs on disk, only here -- so
// this is the one seam a rename or removal of any of the eight source values
// would otherwise slip past.
//
// Eight, not nine: `scrub[0]` (#6B8A4A, the palette's olive) is the one colour
// the chosen set declines, and it is declined on evidence -- it sits about 30
// RGB from `dim` and photographs as mud at 32px on limestone. Deriving it here
// would be an unused field that reads as an oversight.
export function deriveUiBand(raw: Palette): Palette {
  return {
    ...raw,
    reserved: {
      ...raw.reserved,
      ui: {
        colors: {
          ink: raw.ramps.limestone.colors[0],
          dim: raw.ramps.gunmetal.colors[1],
          amber: raw.ramps.dust.colors[0],
          info: raw.ramps.water.colors[0],
          bad: raw.reserved.team.colors.hostile,
          warn: raw.reserved.team.colors.neutral,
          hot: raw.reserved.vfx.colors.fire,
          live: raw.reserved.vfx.colors.tracer,
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
