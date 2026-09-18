// What a rung of the garage's upgrade board actually DOES, in the unit's own
// numbers.
//
// The brigade screen used to sell a tier as "tier 2 · 300" and a row of pips:
// a price and a position, with nothing anywhere on the screen saying what the
// 300 buys. This is that missing half, and the one rule it lives by is that
// the numbers it prints are the numbers `applyUpgrades` will hand the sim
// once the tier is bought -- not an approximation of them, and not a second
// reading of the same JSON through a parser of its own. Both halves read the
// SAME whitelist (`UPGRADE_PATHS`) and the SAME segment parser (`readPath`,
// exported from `@lions/data`'s `upgrades.ts` for exactly this), and
// `upgrade-benefit.test.ts` sweeps every shipped unit, track and tier
// asserting the two agree, against a hand-written oracle that imports neither.
//
// Two things about the arithmetic are easy to get backwards, and both cost a
// wrong number on screen rather than a crash:
//
//   1. A tier's `patch` is the cumulative delta over BASE, not over the tier
//      below it (`upgrades.ts`'s own header says so). So tier N's BEFORE is
//      `base + tiers[N-2].patch[path]`, not `base`, and reading every tier
//      against the base makes every rung above the first overstate its gain
//      by the whole of the rung below. That is this module's falsification.
//   2. A path the tier patches but the unit does not declare produces NO
//      line, rather than a line reading from 0. `applyUpgrades` throws on
//      that case (it is a schema violation upstream); a shop screen must not
//      take a mission down, so it stays quiet instead.
import { readPath, type UpgradableUnit } from '@lions/data';
import { t } from '../i18n/t';

/** How a stat is written, which is not the same as what it is measured in:
 *  `hp`, `armour` and `points` all print as bare integers today and are kept
 *  apart because the stat panel formats and SCALES them separately (a bar for
 *  hit points and a bar for millimetres of armour cannot share a maximum). */
export type BenefitUnitKind = 'hp' | 'armour' | 'tiles' | 'percent' | 'ratio' | 'points';

export interface BenefitLine {
  path: string;
  label: string;
  before: number;
  after: number;
  unit: BenefitUnitKind;
}

/**
 * The whitelist's paths, `weapons[i]` generalised to `weapons[]`, mapped to a
 * catalogue KEY and a unit. Keys rather than English, resolved through `t()`
 * on every call: these strings reach the DOM, so they are chrome, and a table
 * of literals here would be nine strings the pseudo-locale pass cannot see
 * and a translator cannot reach. Resolving at call time (never at module
 * load) is the same rule `role.ts`'s `ROLE_LABEL` getters follow, and for the
 * same reason -- `main.ts` sets the catalogue after this module is imported.
 */
const LABELS: Readonly<Record<string, { key: string; unit: BenefitUnitKind }>> = {
  'hull.hp': { key: 'garage.stat.hp', unit: 'hp' },
  'hull.armor.front': { key: 'garage.stat.armourFront', unit: 'armour' },
  'hull.armor.side': { key: 'garage.stat.armourSide', unit: 'armour' },
  'hull.armor.rear': { key: 'garage.stat.armourRear', unit: 'armour' },
  'hull.suppression_resistance': { key: 'garage.stat.suppression', unit: 'percent' },
  'sensors.optics': { key: 'garage.stat.optics', unit: 'ratio' },
  'sensors.sight_tiles': { key: 'garage.stat.sight', unit: 'tiles' },
  'weapons[].accuracy': { key: 'garage.stat.accuracy', unit: 'percent' },
  'weapons[].penetration': { key: 'garage.stat.penetration', unit: 'points' },
};

/** `weapons[0].accuracy` -> `weapons[].accuracy`, so one table row covers
 *  every weapon index a unit might patch. */
function generalise(path: string): string {
  return path.replace(/\[\d+\]/g, '[]');
}

/** Two decimals, because these are floats out of JSON: `0.62 + 0.04` is
 *  `0.66000000000000003`, and a shop that prints that has lost the player.
 *  Applied to both ends, so `before` and `after` are comparable to each
 *  other and to the applied unit at every path the schema allows (the
 *  coarsest is `sensors.optics` at two decimals; nothing authored is finer). */
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** The stat metadata for a whitelisted path, or null for one this table has
 *  not caught up with -- a new whitelist entry shipped without a label here
 *  drops its line rather than printing a raw path at a player. */
export function benefitLabel(path: string): { label: string; unit: BenefitUnitKind } | null {
  const meta = LABELS[generalise(path)];
  return meta === undefined ? null : { label: t(meta.key), unit: meta.unit };
}

/**
 * What tier `tier` of `track` changes, as one line per patched path, in the
 * order the tier's own patch declares them.
 *
 * Empty -- never a throw -- for an unknown track, a tier outside the track's
 * own range, or a unit with no upgrades at all: this is a screen, and every
 * one of those is reachable from data that shrank after a purchase.
 */
export function upgradeBenefits(unit: UpgradableUnit, track: string, tier: number): BenefitLine[] {
  const tiers = unit.upgrades?.[track]?.tiers;
  if (tiers === undefined || tier < 1 || tier > tiers.length) return [];
  const patch = tiers[tier - 1].patch;
  // Tier 1 reads against the base; every tier above it against the tier below,
  // which is the base plus THAT tier's own cumulative delta.
  const below = tier >= 2 ? tiers[tier - 2].patch : undefined;

  const out: BenefitLine[] = [];
  for (const [path, delta] of Object.entries(patch)) {
    const meta = benefitLabel(path);
    if (meta === null) continue;
    const base = readPath(unit, path);
    if (base === undefined) continue;
    out.push({
      path,
      label: meta.label,
      before: round2(base + (below?.[path] ?? 0)),
      after: round2(base + delta),
      unit: meta.unit,
    });
  }
  return out;
}

/** A percent-shaped stat as whole percent: `0.62` -> `62`. */
export function asPercent(v: number): number {
  return Math.round(v * 100);
}

/**
 * A ratio's change as a signed percentage of ITSELF, not of one.
 *
 * `sensors.optics` multiplies detection strength linearly (`sim.ts`:
 * `strength = optics * signature / d²`), so a `+0.1` patch on a base of 1.2
 * is a 8% gain in detection and not a 10% one. Printing the raw delta as a
 * percent would overstate every optics rung on every unit whose base optics
 * is not exactly 1.0 -- which is most of them.
 *
 * A base of zero has no relative reading at all; that stat falls back to the
 * delta itself, which is what the ratio would be against a base of one.
 */
function signedRatioPercent(b: BenefitLine): string {
  const n = b.before === 0 ? Math.round((b.after - b.before) * 100) : Math.round((b.after / b.before - 1) * 100);
  return n >= 0 ? `+${n}` : `${n}`;
}

/** One rung's line as the player reads it: `Front armour 120 → 134`,
 *  `Sight 9 → 10 tiles`, `Accuracy 62% → 66%`, `Optics +10%`. */
export function formatBenefit(b: BenefitLine): string {
  switch (b.unit) {
    case 'percent':
      return t('garage.benefit.percent', { label: b.label, before: asPercent(b.before), after: asPercent(b.after) });
    case 'tiles':
      return t('garage.benefit.tiles', { label: b.label, before: b.before, after: b.after });
    case 'ratio':
      return t('garage.benefit.ratio', { label: b.label, delta: signedRatioPercent(b) });
    case 'hp':
    case 'armour':
    case 'points':
      return t('garage.benefit.plain', { label: b.label, before: b.before, after: b.after });
  }
}
