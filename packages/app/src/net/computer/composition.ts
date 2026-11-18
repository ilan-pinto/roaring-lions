/**
 * What a unit type IS, to a seat deciding what to build against what it has seen (GH-1391 slice 2). Every class is read off the shipped unit data and no
 * number is written here: the two thresholds are derived from the data itself, so a unit added tomorrow classes itself.
 *
 *   - An ANTI-ARMOUR WEAPON is one of the four kinds that exist to defeat a hull (`atgm`, `apfsds`, `heat`, `rpg`) that can target the ground.
 *   - `SOFT_PENETRATION_CEILING` is the best front-plate penetration any OTHER weapon in the data has (demolition charges, a satchel placed by hand,
 *     are not a gun and are left out). A hull whose front armour is above it can be hurt only by an anti-armour weapon: that is ARMOUR.
 *   - `air` is the authored air domain. Everything else that carries a weapon is `soft` (infantry, teams, artillery, trucks). A unit that carries none
 *     (a drone that only looks, a dozer, a medic's carrier) is `none`: it does not count toward what the enemy fields.
 */
import { units } from '@lions/data';

interface UnitRow {
  role?: string;
  cost?: { logistics?: number };
  hull?: { armor?: { front?: number } };
  mobility?: { speed_tiles_s?: number; domain?: string };
  weapons?: readonly { type: string; penetration: number; can_target?: readonly string[] }[];
  rescue?: unknown;
}
const rows = units as unknown as Record<string, UnitRow | undefined>;

const ANTI_ARMOUR_TYPES: readonly string[] = ['atgm', 'apfsds', 'heat', 'rpg'];
const NOT_A_GUN: readonly string[] = ['demolition'];

export type UnitClass = 'armour' | 'air' | 'soft' | 'none';

/** The best penetration of any weapon that is neither anti-armour nor a placed charge: armour above it needs an anti-armour weapon. */
export const SOFT_PENETRATION_CEILING: number = (() => {
  let best = 0;
  for (const u of Object.values(rows)) {
    for (const w of u?.weapons ?? []) if (!ANTI_ARMOUR_TYPES.includes(w.type) && !NOT_A_GUN.includes(w.type)) best = Math.max(best, w.penetration);
  }
  return best;
})();

export const frontArmourOf = (id: string): number => rows[id]?.hull?.armor?.front ?? 0;

/** The strongest anti-armour penetration a unit type has against the ground, or 0 if it has none. */
export function antiArmourPenetrationOf(id: string): number {
  let best = 0;
  for (const w of rows[id]?.weapons ?? []) {
    if (ANTI_ARMOUR_TYPES.includes(w.type) && (w.can_target ?? []).includes('ground')) best = Math.max(best, w.penetration);
  }
  return best;
}

export function classOf(id: string): UnitClass {
  const u = rows[id];
  if (u === undefined || (u.weapons?.length ?? 0) === 0 || u.rescue !== undefined) return 'none';
  if (u.mobility?.domain === 'air') return 'air';
  return frontArmourOf(id) > SOFT_PENETRATION_CEILING ? 'armour' : 'soft';
}

export const roleOf = (id: string): string => rows[id]?.role ?? '';
export const costOf = (id: string): number => rows[id]?.cost?.logistics ?? 0;
export const speedOf = (id: string): number => rows[id]?.mobility?.speed_tiles_s ?? 0;
