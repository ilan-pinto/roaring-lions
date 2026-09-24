// The kit's vocabulary (garage uplift §2 goal 4, §3.1, §3.2, §6).
//
// Veterancy is EARNED, per named unit, and it is stars and gold chevrons.
// Kit is BOUGHT, per type, and it is a steel plate. Nothing on this page may
// borrow a shape or a colour from the other register -- which is why the
// mark is a bevelled plate with bars, never a chevron or a star, and why its
// colour is `--kit` and never `--commend`.
//
// The glyphs are PLACEHOLDERS. The S3e symbol family is not drawn yet (G1,
// GH-165), and these four join its addendum (D8). Until the sheet is approved
// they live here, drawn to the family's properties (one viewBox,
// currentColor, a pixel of ink at 10 px, the chevron's 14:24 sweep on every
// diagonal); `KIT_SYMBOLS` is the one line the approved sheet replaces, and
// everything draws through `kitSymbolSvg` so nothing else changes when it does.
import { applyUpgrades, kitCounts, kitLevel, readPath, type KitLevel, type UpgradableUnit } from '@lions/data';
import { t } from '../i18n/t';
import { escapeHtml } from './escape-html';

export const KIT_TRACKS = ['armour', 'sensors', 'firepower'] as const;
export type KitTrack = (typeof KIT_TRACKS)[number];
export type KitSymbolId = 'kit' | KitTrack;

export function isKitTrack(name: string): name is KitTrack {
  return (KIT_TRACKS as readonly string[]).includes(name);
}

/** `mark.ts`'s chevron: 14 across for every 24 up. */
export const CHEVRON_SWEEP = 14 / 24;

export interface KitSymbolSheet {
  readonly viewBox: string;
  readonly track: Readonly<Record<KitTrack, string>>;
  readonly mark: (level: 1 | 2 | 3) => string;
}

const STROKE = 2.5;
/** The plate: upper corners bevelled 3.5 across over 6 down -- the chevron's sweep at this box's scale. */
const PLATE = 'M2 22 L2 8 L5.5 2 L18.5 2 L22 8 L22 22 Z';
/** Bar 1 at the bottom: a level is climbed, like the board's ladder. */
const BAR_Y = [16.5, 12, 7.5] as const;

const PLACEHOLDER_KIT_SYMBOLS: KitSymbolSheet = {
  viewBox: '0 0 24 24',
  mark: (level) =>
    `<path d="${PLATE}" fill="none" stroke="currentColor" stroke-width="${STROKE}"/>` +
    BAR_Y.slice(0, level)
      .map((y) => `<rect x="6.5" y="${y}" width="11" height="3" fill="currentColor"/>`)
      .join(''),
  track: {
    // A slab with a riveted panel cut out of it.
    armour: `<path d="M3 21 L3 10 L6.5 4 L17.5 4 L21 10 L21 21 Z M7 12 L7 17 L17 17 L17 12 Z" fill="currentColor" fill-rule="evenodd"/>`,
    // A lens: ring and pupil. No diagonal, so nothing to sweep.
    sensors: `<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="${STROKE}"/><circle cx="12" cy="12" r="3" fill="currentColor"/>`,
    // A round: body and a nose at the sweep.
    firepower: `<path d="M8.5 22 L8.5 9 L12 3 L15.5 9 L15.5 22 Z" fill="currentColor"/>`,
  },
};

/** THE line G1's approved sheet replaces (GH-165). */
export const KIT_SYMBOLS: KitSymbolSheet = PLACEHOLDER_KIT_SYMBOLS;

export function kitSymbolSvg(id: KitSymbolId, size: number, level: 1 | 2 | 3 = 1, className = ''): string {
  const cls = className ? ` class="${className}"` : '';
  const body = id === 'kit' ? KIT_SYMBOLS.mark(level) : KIT_SYMBOLS.track[id];
  return (
    `<svg${cls} width="${size}" height="${size}" viewBox="${KIT_SYMBOLS.viewBox}" ` +
    `aria-hidden="true" focusable="false">${body}</svg>`
  );
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
