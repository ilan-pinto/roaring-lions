// resolveDoctrine / applyDoctrine -- the doctrine picks' pure pre-pass (GH-1383 slice 1; design
// docs/superpowers/specs/2026-11-17-doctrines-design.md §2.2-2.3).
//
// A pick (data/doctrines/picks/<id>.json; the player word is "doctrine", the code word "pick", the
// lead's Q1) extends its faction's base doctrine (data/doctrines/<faction>.json, unchanged) with a
// closed list of four ops (the lead's Q5): take units off the camp menu, put units on it, set the
// population cap, set a unit's price. No stat patch, no purse op, no build-time or population op.
//
// The order a world will run it in (slice 2, `doctrine-prepass.ts`): doctrine FIRST, kit second,
//   fielded(u) = applyUpgrades(applyDoctrine(u, resolved), tiers)
// so a tier's cumulative delta is over the doctrine's unit. In v1 the two touch disjoint fields
// (`cost.logistics` against UPGRADE_PATHS) and commute exactly.
//
// Nothing calls either function yet: slice 1 is data and gates. Leaf package rule (CLAUDE.md):
// this module imports nothing but types.
import type { DoctrineJson } from './versus';

/** A seat faction a doctrine serves. */
export type DoctrineFaction = 'kdf' | 'sarim';

/** The four v1 operations, in their canonical order (P3): menu_remove, menu_add, set_pop_cap, then set_price by unit id. */
export type DoctrineOp =
  | { readonly op: 'menu_remove'; readonly units: readonly string[] }
  | { readonly op: 'menu_add'; readonly units: readonly string[] }
  | { readonly op: 'set_pop_cap'; readonly value: number }
  | { readonly op: 'set_price'; readonly unit: string; readonly logistics: number };

/** data/doctrines/picks/<id>.json, against data/schemas/doctrine_pick.schema.json. */
export interface DoctrinePickJson {
  readonly id: string;
  readonly extends: DoctrineFaction;
  /** en.json keys, never text (P10). */
  readonly label: string;
  readonly blurb: string;
  readonly gives_up: string;
  /** The doctrine-gated formation's id (the lead's Q4). Its file is slice 5's. */
  readonly signature: { readonly formation: string };
  readonly status: 'proposed' | 'probed' | 'ruled';
  readonly ops: readonly DoctrineOp[];
}

/** A base doctrine with its pick (or none) applied. */
export interface ResolvedDoctrine {
  /** The pick's id; null for the base, unpicked. */
  readonly id: string | null;
  readonly faction: DoctrineFaction;
  /** Base order, removals dropped, additions appended in op order. */
  readonly menu: readonly string[];
  readonly popCap: number | null;
  /** Always the base's in v1 (no purse op), so G3 Q7's 8/5 ratio holds for every pairing. */
  readonly logisticsStart: number;
  /** Unit id -> the logistics this doctrine charges for it. Only the units a `set_price` names. */
  readonly prices: Readonly<Record<string, number>>;
  readonly signature: string | null;
}

/** What `applyDoctrine` needs of a unit. */
export interface DoctrinableUnit {
  readonly id: string;
  readonly cost: { readonly logistics: number };
}

const NO_PRICES: Readonly<Record<string, number>> = Object.freeze({});

/**
 * The base doctrine with `pick` applied. `pick === null` is the base, unpicked, and returns the
 * base's OWN menu array, by reference. Throws on a pick that does not fit its base (another faction,
 * a removal not on the menu, an addition already on it, a price for a unit off the resolved menu):
 * `pnpm validate:data` (P1-P10) refuses those in data, so a throw here is a pick no gate has read.
 */
export function resolveDoctrine(base: DoctrineJson, pick: DoctrinePickJson | null): ResolvedDoctrine {
  const head = {
    faction: base.faction,
    logisticsStart: base.budget.logistics_start,
  };
  if (pick === null) {
    return { ...head, id: null, menu: base.menu, popCap: base.pop_cap ?? null, prices: NO_PRICES, signature: null };
  }
  if (pick.extends !== base.id) throw new Error(`doctrine pick "${pick.id}" extends "${pick.extends}", not "${base.id}"`);
  let menu: string[] = [...base.menu];
  let popCap: number | null = base.pop_cap ?? null;
  const prices: Record<string, number> = {};
  for (const op of pick.ops) {
    switch (op.op) {
      case 'menu_remove':
        for (const u of op.units) {
          if (!menu.includes(u)) throw new Error(`doctrine pick "${pick.id}": menu_remove "${u}" is not on the ${base.id} menu`);
        }
        menu = menu.filter((u) => !op.units.includes(u));
        break;
      case 'menu_add':
        for (const u of op.units) {
          if (menu.includes(u)) throw new Error(`doctrine pick "${pick.id}": menu_add "${u}" is already on the menu`);
          menu.push(u);
        }
        break;
      case 'set_pop_cap':
        popCap = op.value;
        break;
      case 'set_price':
        if (!menu.includes(op.unit)) throw new Error(`doctrine pick "${pick.id}": set_price "${op.unit}" is not on the resolved menu`);
        prices[op.unit] = op.logistics;
        break;
      default: {
        const never: never = op;
        throw new Error(`doctrine pick "${pick.id}": unknown op ${JSON.stringify(never)}`);
      }
    }
  }
  return { ...head, id: pick.id, menu, popCap, prices, signature: pick.signature.formation };
}

/**
 * The unit as this doctrine fields it: `cost.logistics` from a `set_price`, nothing else. A unit no
 * op names is returned ITSELF, by reference (the identity a no-doctrine world's hashes depend on).
 */
export function applyDoctrine<T extends DoctrinableUnit>(unit: T, resolved: ResolvedDoctrine): T {
  const logistics = Object.hasOwn(resolved.prices, unit.id) ? resolved.prices[unit.id] : undefined;
  if (logistics === undefined || logistics === unit.cost.logistics) return unit;
  return { ...unit, cost: { ...unit.cost, logistics } };
}
