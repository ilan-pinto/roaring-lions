// "What it adds": the Stores' pure model for one unit card's panel (GH-1076, spec 2026-11-07 §1.2).
//
// Pure and English-free. It returns discriminated values, as `Honest` does, and the screen turns each into a
// `t()` sentence. Every predicate reads `unitTypeFromJson(json)` (the sim's own resolution of defaults) or a
// JSON field; no unit id is spelled anywhere in this file (a test greps the source for every KDF id).
// Nothing here reads the wallet, the DOM, or a clock.
import { applyUpgrades, readPath, type UpgradableUnit, type UpgradeTracks } from '@lions/data';
import {
  isBoughtOnly,
  loanedPlacements,
  loanedReinforcements,
  resolveUpgrades,
  unitTypeFromJson,
  type LedgerData,
  type MissionJson,
  type UnitType,
  type UnitTypeJson,
  type UnlockGate,
} from '@lions/sim';
import { VERSUS_HELD_UNITS } from '../net/versus-roster';
import { isMountCarrier, roleBucket } from './role';
import { coinPrice } from './stores-model';

/** A copy of `mission.ts`'s private `HEAVY_COLLATERAL` (32768 / 65536). The precedent is `PROJ_SPEED` in
 *  `units/missiles.ts`: a copy, pinned to the source text by a test, rather than a sim export. */
export const APP_HEAVY_COLLATERAL = 0.5;

/** A unit's JSON as this model reads it: the sim's resolution input plus the fields the shell adds. */
export type UnitJson = UnitTypeJson & {
  readonly unlock?: { readonly roe_rating_min?: number; readonly stars_min?: number; readonly after_mission?: string; readonly price?: number };
  readonly upgrades?: UpgradeTracks;
  readonly mobility: UnitTypeJson['mobility'] & { readonly can_crush?: boolean };
};

/** Spec §1.2 B, in priority order: the panel shows the first four that hold. */
export const ADDS_TAGS = [
  'heal', 'rescue', 'evacuate', 'transport', 'markTunnel', 'markTarget', 'indirect', 'area', 'coverIgnore',
  'beam', 'structure', 'demolish', 'construct', 'smoke', 'garrison', 'thermal', 'crush', 'engagesAir', 'flies',
] as const;
export type AddsTag = (typeof ADDS_TAGS)[number];

export type WeakTag =
  | { kind: 'soft' }
  | { kind: 'unarmed' }
  | { kind: 'minRange'; n: number }
  | { kind: 'needsSpotter'; sight: number; range: number }
  | { kind: 'groundBound' }
  | { kind: 'conduct' };

export interface AddsInput {
  /** The candidate. */
  readonly unit: UnitJson;
  /** Every KDF unit. */
  readonly kdf: readonly UnitJson[];
  /** For names and roles in Hurt by. */
  readonly enemies: readonly UnitJson[];
  /** `accountView`'s open set minus the wounded type. */
  readonly open: ReadonlySet<string>;
  readonly ownedTiers: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly ledger: LedgerData;
  readonly missions: readonly MissionJson[];
  /** `data/campaign/world.json`'s mission ids. */
  readonly worldMissionIds: readonly string[];
  /** `data/doctrines/kdf.json`'s menu. */
  readonly versusMenu: ReadonlySet<string>;
  /** The generated threat table (WP2), injected. */
  readonly threats: Readonly<Record<string, readonly string[]>>;
  /** Why a Store special is refused in a versus room, or null (R0.8). Never a copied list. */
  readonly refusal: (id: string) => string | null;
}

export interface CompareRow {
  readonly stat: 'range' | 'armourFront' | 'hp' | 'speed' | 'sight';
  readonly mine: number;
  readonly theirs: number | null;
}

export type GapLine =
  | { kind: 'firstRole'; role: string }
  | { kind: 'newTags'; tags: readonly AddsTag[] }
  | { kind: 'reach'; n: number; d: number }
  | { kind: 'plusOne'; role: string; name: string };

export type WhereLine =
  | { kind: 'dock'; n: number }
  | { kind: 'fieldedAs'; base: string; mission: string }
  | { kind: 'loaned'; n: number }
  | { kind: 'versus' }
  | { kind: 'brigadeRoom' }
  | { kind: 'campaignOnly' }
  | { kind: 'coinsSinglePlayer' };

export interface UnitAdds {
  readonly role: { role: string; bucket: string };
  readonly brings: { shown: readonly { tag: AddsTag; n?: number }[]; more: readonly AddsTag[] };
  readonly watch: { shown: readonly WeakTag[]; more: readonly WeakTag[] };
  readonly hurtBy: null | { groups: readonly { role: string; names: readonly string[] }[]; moreGroups: number; shrugs: readonly string[] };
  readonly compare: { against: string | null; rows: readonly CompareRow[] };
  readonly gap: readonly GapLine[];
  readonly where: readonly WhereLine[];
  readonly upgrades: null | { tracks: readonly string[]; tiers: number; credits: number; coins: number };
}

const SHOWN = 4;
const MAX_HURT_GROUPS = 3;
const MAX_GAP_LINES = 3;

const typeOf = (j: UnitJson): UnitType => unitTypeFromJson(j);
const bucketOf = (j: UnitJson, t: UnitType): string => roleBucket({ ...t, role: j.role });

/** Applies a unit's owned tiers, as the Garage reads "the unit as it stands". */
function asOwned(j: UnitJson, tiers: Readonly<Record<string, Readonly<Record<string, number>>>>): UnitJson {
  return applyUpgrades(j as unknown as UpgradableUnit, tiers[j.id] ?? {}) as unknown as UnitJson;
}

const maxRange = (j: UnitJson): number => (j.weapons ?? []).reduce((m, w) => Math.max(m, w.range_tiles), 0);

/** Which block B tags hold on `j`, in `ADDS_TAGS` order. */
function bringTags(j: UnitJson): AddsTag[] {
  const t = typeOf(j);
  const w = j.weapons ?? [];
  const holds: Record<AddsTag, boolean> = {
    heal: (j.aura?.area ?? []).some((a) => (a.heal_per_s ?? 0) > 0),
    rescue: j.rescue !== undefined,
    evacuate: t.canCarry?.includes('wounded') ?? false,
    transport: isMountCarrier(t),
    markTunnel: t.canMarkTunnel,
    markTarget: t.canMarkTarget,
    indirect: t.weapons.some((s) => s.isIndirect),
    area: t.weapons.some((s) => s.splash > 0 || s.submunitions !== null),
    coverIgnore: t.weapons.some((s) => s.coverIgnore > 0),
    beam: w.some((x) => x.beam !== undefined),
    structure: w.some((x) => x.can_target?.includes('structure') ?? false),
    demolish: t.canDemolish,
    construct: t.canConstruct || t.canRepair,
    smoke: t.canSmoke,
    garrison: t.canGarrison,
    thermal: t.thermal,
    crush: j.mobility.can_crush === true,
    engagesAir: t.weapons.some((s) => s.canTargetAir),
    flies: t.isAir,
  };
  return ADDS_TAGS.filter((tag) => holds[tag]);
}

/** Block C, in spec order. */
function weakTags(j: UnitJson): WeakTag[] {
  const t = typeOf(j);
  const w = j.weapons ?? [];
  const out: WeakTag[] = [];
  if (t.isSoft) out.push({ kind: 'soft' });
  if (w.length === 0) out.push({ kind: 'unarmed' });
  const minRange = w.reduce((m, x) => Math.max(m, x.min_range_tiles ?? 0), 0);
  if (minRange > 0) out.push({ kind: 'minRange', n: minRange });
  const range = maxRange(j);
  if (w.length > 0 && j.sensors.sight_tiles < range) out.push({ kind: 'needsSpotter', sight: j.sensors.sight_tiles, range });
  if (t.wheeled && !t.isAir) out.push({ kind: 'groundBound' });
  if (w.some((x) => (x.collateral_risk ?? 0) >= APP_HEAVY_COLLATERAL)) out.push({ kind: 'conduct' });
  return out;
}

/** The authored `unlock` mapped to the sim's gate (the same mapping `main.ts`'s `kdfUnlockGate` makes). */
function gateOfJson(j: UnitJson, bought: boolean): UnlockGate | undefined {
  const raw = j.unlock;
  if (raw === undefined) return undefined;
  return { roeMin: raw.roe_rating_min, starsMin: raw.stars_min, afterMission: raw.after_mission, price: raw.price, bought };
}

function compareRows(mine: UnitJson, theirs: UnitJson | null): CompareRow[] {
  const read = (j: UnitJson, stat: CompareRow['stat']): number => {
    switch (stat) {
      case 'range': return maxRange(j);
      case 'armourFront': return readPath(j as unknown as UpgradableUnit, 'hull.armor.front') ?? 0;
      case 'hp': return readPath(j as unknown as UpgradableUnit, 'hull.hp') ?? 0;
      case 'speed': return readPath(j as unknown as UpgradableUnit, 'mobility.speed_tiles_s') ?? 0;
      case 'sight': return readPath(j as unknown as UpgradableUnit, 'sensors.sight_tiles') ?? 0;
    }
  };
  const stats: CompareRow['stat'][] = ['range', 'armourFront', 'hp', 'speed', 'sight'];
  return stats.map((stat) => ({ stat, mine: read(mine, stat), theirs: theirs === null ? null : read(theirs, stat) }));
}

export function unitAdds(input: AddsInput): UnitAdds {
  const { unit } = input;
  const type = typeOf(unit);
  const bucket = bucketOf(unit, type);
  const role = unit.role ?? '';

  // B. Brings
  const tags = bringTags(unit);
  const brings = {
    shown: tags.slice(0, SHOWN).map((tag) => (tag === 'transport' ? { tag, n: type.transportSlots } : { tag })),
    more: tags.slice(SHOWN),
  };

  // C. Watch for, and Hurt by
  const weak = weakTags(unit);
  const watch = { shown: weak.slice(0, SHOWN), more: weak.slice(SHOWN) };
  let hurtBy: UnitAdds['hurtBy'] = null;
  if (!type.isSoft) {
    const armed = input.enemies.filter((e) => (e.weapons ?? []).length > 0 && e.role !== 'wounded');
    const hurts = new Set(input.threats[unit.id] ?? []);
    const byRole = new Map<string, string[]>();
    for (const e of [...armed].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      if (!hurts.has(e.id)) continue;
      const r = e.role ?? '';
      byRole.set(r, [...(byRole.get(r) ?? []), e.name ?? e.id]);
    }
    const groups = [...byRole.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([r, names]) => ({ role: r, names }));
    hurtBy = {
      groups: groups.slice(0, MAX_HURT_GROUPS),
      moreGroups: Math.max(0, groups.length - MAX_HURT_GROUPS),
      shrugs: armed.filter((e) => !hurts.has(e.id)).map((e) => e.name ?? e.id),
    };
  }

  // D. Against your closest unit: same role, then same bucket, then nobody; ties by |dLogistics| then id.
  const others = input.kdf.filter((k) => k.id !== unit.id && input.open.has(k.id));
  const dist = (k: UnitJson): number => Math.abs((k.cost?.logistics ?? 0) - (unit.cost?.logistics ?? 0));
  const pick = (pool: readonly UnitJson[]): UnitJson | null =>
    [...pool].sort((a, b) => dist(a) - dist(b) || (a.id < b.id ? -1 : 1))[0] ?? null;
  const closest = pick(others.filter((k) => k.role === unit.role)) ?? pick(others.filter((k) => bucketOf(k, typeOf(k)) === bucket));
  const compare = {
    against: closest === null ? null : (closest.name ?? closest.id),
    rows: compareRows(asOwned(unit, input.ownedTiers), closest === null ? null : asOwned(closest, input.ownedTiers)),
  };

  // E. The gap it fills, over the open set (never the catalogue).
  const openUnits = others;
  const gap: GapLine[] = [];
  if (!openUnits.some((k) => k.role === unit.role)) gap.push({ kind: 'firstRole', role });
  const have = new Set<AddsTag>(openUnits.flatMap(bringTags));
  const fresh = tags.filter((tag) => !have.has(tag));
  if (fresh.length > 0) gap.push({ kind: 'newTags', tags: fresh });
  const mineRange = maxRange(asOwned(unit, input.ownedTiers));
  const bestOpen = openUnits.reduce((m, k) => Math.max(m, maxRange(asOwned(k, input.ownedTiers))), 0);
  if (mineRange > bestOpen) gap.push({ kind: 'reach', n: mineRange, d: mineRange - bestOpen });
  if (gap.length === 0 && closest !== null) gap.push({ kind: 'plusOne', role, name: closest.name ?? closest.id });

  // F. Where you can use it
  const where: WhereLine[] = [];
  const world = new Set(input.worldMissionIds);
  const dock = input.missions.filter((m) => world.has(m.id) && m.resources !== undefined).length;
  if (dock > 0) where.push({ kind: 'dock', n: dock });
  for (const m of input.missions) {
    for (const p of m.starting_force ?? []) {
      if (p.upgrades_to === unit.id) where.push({ kind: 'fieldedAs', base: p.unit, mission: m.id });
    }
  }
  const byId = new Map<string, UnitJson>([...input.kdf, unit].map((k) => [k.id, k]));
  const gateOf = (id: string): UnlockGate | undefined => {
    const k = byId.get(id);
    return k === undefined ? undefined : gateOfJson(k, input.open.has(id));
  };
  let loaned = 0;
  for (const m of input.missions) {
    const force = resolveUpgrades(m, input.ledger, gateOf).starting_force ?? [];
    const lentForce = loanedPlacements(m, input.ledger, gateOf).some((i) => force[i]?.unit === unit.id);
    const lentTrigger = [...loanedReinforcements(m, input.ledger, gateOf)].some((key) => {
      const [ti, ui] = key.split(':').map(Number);
      return m.triggers?.[ti]?.do.units?.[ui]?.unit === unit.id;
    });
    if (lentForce || lentTrigger) loaned++;
  }
  if (loaned > 0) where.push({ kind: 'loaned', n: loaned });
  const gate = gateOfJson(unit, false);
  const brigadeRoom = gate !== undefined && isBoughtOnly(gate) && input.refusal(unit.id) === null;
  const versus = input.versusMenu.has(unit.id) && !VERSUS_HELD_UNITS.has(unit.id);
  if (brigadeRoom) where.push({ kind: 'brigadeRoom' });
  if (versus) where.push({ kind: 'versus' });
  if (!brigadeRoom && !versus) where.push({ kind: 'campaignOnly' });
  if (unit.unlock?.price !== undefined) where.push({ kind: 'coinsSinglePlayer' });

  // G. Upgrades it can take. The coin total is the SUM of each tier's own coin price, never coinPrice(sum).
  const tracks = Object.keys(unit.upgrades ?? {});
  let upgrades: UnitAdds['upgrades'] = null;
  if (tracks.length > 0) {
    let tiers = 0;
    let credits = 0;
    let coins = 0;
    for (const name of tracks) {
      for (const tier of unit.upgrades?.[name]?.tiers ?? []) {
        tiers++;
        credits += tier.price;
        coins += coinPrice(tier.price);
      }
    }
    upgrades = { tracks, tiers, credits, coins };
  }

  return { role: { role, bucket }, brings, watch, hurtBy, compare, gap: gap.slice(0, MAX_GAP_LINES), where, upgrades };
}
