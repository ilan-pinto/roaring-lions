// The kit's vocabulary (garage uplift §2 goal 4, §3.1, §3.2, §6).
//
// Veterancy is EARNED, per named unit, and it is stars and gold chevrons.
// Kit is BOUGHT, per type, and it is a steel plate. Nothing on this page may
// borrow a colour from the other register -- which is why every kit glyph is
// `--kit` and never `--commend`. The garage's own mark is a bevelled plate
// with bars; the sign on a unit's ICON is 1-3 six-pointed Stars of David, by
// the lead's G-P3 call (2026-09-27, "Steel Stars of David"), which overrode
// this header's old "never a star" rule for that one surface -- so steel,
// not shape, is what keeps it apart from veterancy's gold there.
//
// The stars on the icons are FINAL (the lead, 2026-10-09). The only other
// glyph here is the garage bay's own plate-with-bars mark (`kitPlateSvg`,
// drawn by `brigade.ts`'s bay plate); the three track heads are the approved
// hand-drawn emblems in `assets/ui/kit/` (`kit-emblems.ts`), and the old
// built-in track glyphs that backed them up are deleted.
import { applyUpgrades, kitCounts, kitLevel, readPath, type KitLevel, type UpgradableUnit } from '@lions/data';
import { t } from '../i18n/t';
import { escapeHtml } from './escape-html';

export const KIT_TRACKS = ['armour', 'sensors', 'firepower'] as const;
export type KitTrack = (typeof KIT_TRACKS)[number];

/** The plate: upper corners bevelled 3.5 across over 6 down -- the chevron's
 *  sweep (`mark.ts`'s `CHEVRON_SWEEP`) at this box's scale. */
const PLATE = 'M2 22 L2 8 L5.5 2 L18.5 2 L22 8 L22 22 Z';
const PLATE_STROKE = 2.5;
/** Bar 1 at the bottom: a level is climbed, like the board's ladder. */
const BAR_Y = [16.5, 12, 7.5] as const;

/** The garage bay's kit mark: a bevelled plate with `level` bars. */
export function kitPlateSvg(size: number, level: 1 | 2 | 3 = 1, className = ''): string {
  const cls = className ? ` class="${className}"` : '';
  const bars = BAR_Y.slice(0, level)
    .map((y) => `<rect x="6.5" y="${y}" width="11" height="3" fill="currentColor"/>`)
    .join('');
  return (
    `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
    `<path d="${PLATE}" fill="none" stroke="currentColor" stroke-width="${PLATE_STROKE}"/>${bars}</svg>`
  );
}

/** The two sizes the kit sign draws at, as DATA only -- which one a given
 *  icon gets is decided by `theme.css`'s selectors, never by a parameter here
 *  (see `kitIconSignHtml`). Each is the height of ONE STAR, tip to tip, in
 *  rem and in px at `--ui-scale` 1 (the px is written into the svg's own
 *  attributes as a floor; the stylesheet's rem rule wins, so the sign follows
 *  the UI scale). History: G-N2 FINAL (*"B, but 20 px on the chip"*) sized a
 *  square plate-and-bars mark, 20 px on the chip and 16 px elsewhere; G-P3
 *  made it stars inside that square (7.06 / 5.65 px each); the lead then
 *  judged those captures and asked for *"Bigger stars"* (2026-09-27) -- about
 *  10 px on the chip and 8 px on the card, the dock tile and the garage rail,
 *  the row growing LEFTWARD along the icon's top edge from the top-right
 *  corner. So the sign box is no longer square: its height is one star and
 *  its width is `kitSignAspect(level)` times that. */
export const KIT_ICON_SIGN = {
  chip: { rem: 0.625, px: 10 },
  small: { rem: 0.5, px: 8 },
} as const;

/** A Star of David, point up: the hexagram's twelve-vertex outline (tip,
 *  notch, tip ... clockwise from the top), one closed absolute M/L/Z path,
 *  tips on radius `r` and notches on `r / sqrt(3)` -- the same figure as two
 *  overlapping equilateral triangles, drawn as their filled union. Measured
 *  at the sign's sizes (G-P3, 2026-09-27): filled reads as a six-pointed star
 *  at 6-7 px, where the two stroked triangles and the even-odd (hollow
 *  centre) form both collapse into a ring. */
export function starOfDavidPath(cx: number, cy: number, r: number): string {
  const n = (v: number): string => String(Math.round(v * 1000) / 1000);
  const pts: string[] = [];
  for (let k = 0; k < 12; k++) {
    const rad = k % 2 === 0 ? r : r / Math.sqrt(3);
    const a = ((-90 + 30 * k) * Math.PI) / 180;
    pts.push(`${n(cx + rad * Math.cos(a))} ${n(cy + rad * Math.sin(a))}`);
  }
  return `M${pts.join(' L')} Z`;
}

/** The sign's stars in svg units: one star is `STAR_H` tall (a unit is a
 *  pixel on the chip at scale 1), `STAR_W` wide -- a point-up hexagram is
 *  sqrt(3)/2 as wide as it is tall -- and `STAR_GAP` apart, the 0.83 px gap
 *  the G-P3 captures had on the chip. */
const STAR_H = 10;
const STAR_R = STAR_H / 2;
const STAR_W = STAR_R * Math.sqrt(3);
const STAR_GAP = 5 / 6;

/** The sign's width over its height at `level`: `level` stars and the gaps
 *  between them, over one star's height. `theme.css` sets only the height;
 *  the svg's viewBox carries this ratio, and the K1 verdict reads it. */
export function kitSignAspect(level: 1 | 2 | 3): number {
  return (level * STAR_W + (level - 1) * STAR_GAP) / STAR_H;
}

/** `level` steel Stars of David in a row, the svg exactly as wide as the row
 *  and one star tall. Anchored top-right by `.rl-kit-icon`, so the corner
 *  star holds still and the row grows leftward as the count grows. */
function kitStarsSvg(level: 1 | 2 | 3, heightPx: number): string {
  const w = level * STAR_W + (level - 1) * STAR_GAP;
  const n = (v: number): string => String(Math.round(v * 1000) / 1000);
  let body = '';
  for (let i = 0; i < level; i++) {
    const cx = w - STAR_W / 2 - i * (STAR_W + STAR_GAP);
    body += `<path d="${starOfDavidPath(cx, STAR_R, STAR_R)}" fill="currentColor"/>`;
  }
  return (
    `<svg width="${n(heightPx * kitSignAspect(level))}" height="${heightPx}" viewBox="0 0 ${n(w)} ${STAR_H}" ` +
    `aria-hidden="true" focusable="false">${body}</svg>`
  );
}

/** The kit level on a unit's ICON: 1-3 steel Stars of David (G-P3, the
 *  lead, 2026-09-27: "Steel Stars of David" -- steel through `.rl-kit-mark`'s
 *  `--kit`, never gold, which is veterancy and credits, D3). The garage bay
 *  keeps its own bevelled mark (`kitPlateSvg`); this is the icon
 *  sign only. Nothing at level 0 -- an unkitted icon must not change by a
 *  byte (every gated golden frame boots a fresh account). The markup never
 *  names a surface or a size: the svg's own attributes are the smaller
 *  `small` size (CSS wins), and `theme.css` sizes the chip UP through a
 *  selector keyed on the chip's own art class (`hud.ts`'s `renderChips`,
 *  `rl-chip__art`), not on which caller happened to ask. A review round on
 *  Task 3's first pass had `kitIconSignHtml`/`withKitSign` take a `surface`
 *  argument instead; the controller reverted it (fix round 1): an omitted
 *  argument at the chip's own call site would have silently drawn it at the
 *  16 px the lead rejected there, where a selector cannot be forgotten per
 *  call site. */
export function kitIconSignHtml(level: KitLevel): string {
  if (level === 0) return '';
  return (
    `<span class="rl-kit-icon rl-kit-mark" data-kit="${level}" role="img" ` +
    `aria-label="${escapeHtml(kitLevelLabel(level))}">` +
    kitStarsSvg(level, KIT_ICON_SIGN.small.px) +
    `</span>`
  );
}

/** The same sign, drawn `aria-hidden` with no `role`/`aria-label` of its own --
 *  for a surface that already names the level to a screen reader some other
 *  way (the HUD card's own `kitPipsHtml`, the garage rail's pip columns), so
 *  the level is announced exactly once per surface rather than twice. The
 *  chip and the dock tile keep `kitIconSignHtml`: neither draws pips, so the
 *  sign is that surface's only announcement. */
export function kitIconSignDecorHtml(level: KitLevel): string {
  if (level === 0) return '';
  return (
    `<span class="rl-kit-icon rl-kit-mark" data-kit="${level}" aria-hidden="true">` +
    kitStarsSvg(level, KIT_ICON_SIGN.small.px) +
    `</span>`
  );
}

/** An icon that is a bare flex item (the chip's, the rail's) gets a host the
 *  sign can be absolute inside, sized by the art itself -- at L >= 1 only,
 *  so an unkitted icon's markup is returned untouched (plan 2b R-9). The
 *  icon comes first, immediately before the sign, on purpose: `theme.css`'s
 *  chip-size rule is an adjacent-sibling selector (`.rl-chip__art +
 *  .rl-kit-icon`) that depends on that exact order. */
export function withKitSign(iconHtml: string, level: KitLevel): string {
  return level === 0 ? iconHtml : `<span class="rl-kit-host">${iconHtml}${kitIconSignHtml(level)}</span>`;
}

export interface TrackPip {
  readonly track: KitTrack;
  readonly owned: number;
  readonly length: number;
}

export interface KitSummary {
  readonly level: KitLevel;
  /** Every tier on every track owned -- NOT the same as level 3 (R-11). */
  readonly maxed: boolean;
  readonly pips: readonly TrackPip[];
  /** Hit points the kit adds: applied minus base. 0 when either is unreadable. */
  readonly hpKit: number;
  /** Credits spent on this type's owned tiers, and the price of all of them. */
  readonly spent: number;
  readonly total: number;
}

function clampTier(v: number | undefined, len: number): number {
  return v !== undefined && Number.isFinite(v) ? Math.min(Math.max(Math.trunc(v), 0), len) : 0;
}

function hpKitOf(unit: UpgradableUnit, owned: Readonly<Record<string, number>>): number {
  const base = readPath(unit, 'hull.hp');
  if (base === undefined) return 0;
  try {
    const kitted = readPath(applyUpgrades(unit, owned), 'hull.hp');
    return kitted === undefined ? 0 : Math.round((kitted - base) * 100) / 100;
  } catch {
    // `applyUpgrades` refuses a patch path the JSON does not declare. The
    // garage already says so in the console when it draws the unit; a pip
    // strip must not be what takes a screen down.
    return 0;
  }
}

export function kitSummary(unit: UpgradableUnit, owned: Readonly<Record<string, number>>): KitSummary {
  const tracks = unit.upgrades ?? {};
  let spent = 0;
  let total = 0;
  for (const [name, track] of Object.entries(tracks)) {
    const n = clampTier(owned[name], track.tiers.length);
    track.tiers.forEach((tier, i) => {
      total += tier.price;
      if (i < n) spent += tier.price;
    });
  }
  const counts = kitCounts(unit, owned);
  return {
    level: kitLevel(unit, owned),
    maxed: counts.available > 0 && counts.owned === counts.available,
    pips: KIT_TRACKS.map((track) => {
      const length = tracks[track]?.tiers.length ?? 0;
      return { track, owned: clampTier(owned[track], length), length };
    }),
    hpKit: hpKitOf(unit, owned),
    spent,
    total,
  };
}

/** Three columns of 0.375rem squares, tier 1 at the bottom (the stylesheet's
 *  `column-reverse`). HTML rather than nodes: the HUD card is a string. */
export function kitPipsHtml(pips: readonly TrackPip[]): string {
  const said = pips
    .filter((p) => p.length > 0)
    .map((p) => t('kit.pips.track', { track: t(`garage.track.${p.track}`), n: p.owned, m: p.length }));
  const cols = pips
    .map(
      (p) =>
        `<span class="rl-kit-pips__col" data-track="${p.track}" data-len="${p.length}">` +
        Array.from({ length: p.length }, (_, i) => `<i class="rl-kit-pips__pip" data-on="${i < p.owned ? 1 : 0}"></i>`).join('') +
        `</span>`
    )
    .join('');
  return `<span class="rl-kit-pips" role="img" aria-label="${escapeHtml(t('kit.pips.aria', { tracks: said.join(', ') }))}">${cols}</span>`;
}

export function kitLevelLabel(level: 1 | 2 | 3): string {
  return t(`kit.level.${level}`);
}
