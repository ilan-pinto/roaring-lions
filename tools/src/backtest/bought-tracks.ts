// GH-1144: every upgrade track of the nine bought-only units, exercised ONE TRACK AT A TIME.
//
// `pnpm playtest`'s max-tier replay (`maxTierProbes`) patches the KDF units a plain winning run FIELDS, and of the nine units GH-1077 made
// upgradable (air_medevac_heli, at_nlos_team, inf_grenadier, inf_medic_squad, mbt_lavi_camo, spg_cluster, spg_long_range, ugv_recon_dog,
// veh_ambulance) a scripted plan fields only the medic squad (it is loaned into every campaign mission but the tutorial). The other eight were
// never on a plan's roster, so no track of theirs ran in the playtest, and a broken one (a howitzer at 35,000 hp, a dog whose sensors read x6)
// left it green. Two checks close that, both in `playtest.ts`:
//
//   1. the DRILL gate (this file): each track of each unit baked ALONE at its top tier, against the unit at base tier on the same seeds, in the
//      drill that track bears on (`special-units-probes.ts` probe 12: armour -> seconds survived against one fixed attacker, sensors -> the tick
//      a standing target is identified at 6, 10 and 14 tiles, firepower -> damage dealt). A track must buy something its drill can see; a tie is
//      a miss. su:probes prints the same numbers as a REPORT; this gate fails the playtest.
//   2. the MISSION replays (in `playtest.ts`): the unit built and fielded in a host mission at base tier, with each track alone at max, and with all
//      tracks at max, the mission's plan unchanged: it must still be a VICTORY at no fewer stars.
//
// A named exemption carries its own demotion assertion: when the exempt check starts to pass, the gate fails until the exemption is deleted.
import { applyUpgrades, type UpgradableUnit } from '@lions/data';
import type { UnitTypeJson } from '@lions/sim';
import { NINE, SIGHT_RANGES, fireDrill, stagedUnit, trackRow, type TrackRow } from './special-units-probes';

export const TRACKS = ['armour', 'sensors', 'firepower'] as const;
export type Track = (typeof TRACKS)[number];
export const DRILL_SEEDS = 30;
const EPS = 0.005;

/** The unit's top tier on `track` alone; every other track stays at base. */
export function aloneAtMax(json: UnitTypeJson, track: string): UnitTypeJson {
  const unit = json as unknown as UpgradableUnit & UnitTypeJson;
  const block = unit.upgrades?.[track];
  if (!block) throw new Error(`bought-tracks: ${(json as { id?: string }).id} carries no ${track} track`);
  return applyUpgrades(unit, { [track]: block.tiers.length }) as UnitTypeJson;
}

/** The tracks a unit carries, in `TRACKS` order. */
export function tracksOf(json: UnitTypeJson): Track[] {
  const block = (json as unknown as UpgradableUnit).upgrades ?? {};
  return TRACKS.filter((t) => t in block);
}

/** Tracks whose drill reads a tie against the fixed attacker, by `${unit}.${track}`, each with the reason it is accepted (GH-1144, 30 seeds:
 *  86.6 s, 86.6 s and 87.0 s at base AND at max tier against a Kornet, because a penetration costs a share of max hp, GH-560). The lead's call. */
export const EXEMPT: Readonly<Record<string, string>> = {
  'spg_cluster.armour': 'a penetration costs a share of max hp (GH-560): the added hp/armour changes nothing against an atgm_cell',
  'spg_long_range.armour': 'a penetration costs a share of max hp (GH-560): the added hp/armour changes nothing against an atgm_cell',
  'veh_ambulance.armour': 'a penetration costs a share of max hp (GH-560): the added hp/armour changes nothing against an atgm_cell',
};

export interface TrackCheck {
  id: string;
  track: Track;
  /** The drill the track bears on. */
  drill: 'survival' | 'identification' | 'damage';
  /** The track bought something the drill can see. */
  gains: boolean;
  detail: string;
}

/** The drill reading for one track: `row` is `trackRow(id, base, aloneAtMax(base, track))`. */
export function checkOf(row: TrackRow, track: Track): TrackCheck {
  const id = row.id;
  if (track === 'armour') {
    return {
      id,
      track,
      drill: 'survival',
      gains: row.armour.max > row.armour.base + EPS,
      detail: `survives ${row.armour.base.toFixed(1)} s -> ${row.armour.max.toFixed(1)} s against ${row.attacker}`,
    };
  }
  if (track === 'sensors') {
    const earlier = SIGHT_RANGES.filter((rg) => row.sight[rg].max < row.sight[rg].base);
    return {
      id,
      track,
      drill: 'identification',
      gains: earlier.length > 0,
      detail: earlier.length > 0 ? `identifies the target sooner at ${earlier.map((x) => `${x}t`).join(', ')}` : 'identifies it no sooner at 6, 10 or 14 tiles',
    };
  }
  throw new Error('bought-tracks: checkOf reads armour and sensors; firepower has fireCheck');
}

/** The tile distance of the firepower drill: inside the EFFECTIVE range of every weapon the track patches (a grenade launcher with a 5.5 tile
 *  effective range reads a tie against a dummy 8 tiles off, which is the drill's reach and not the track), never more than the default 8. */
export function fireDistance(json: UnitTypeJson): number {
  const block = (json as unknown as UpgradableUnit).upgrades?.firepower;
  const weapons = (json.weapons ?? []) as { effective_range_tiles?: number; range_tiles: number }[];
  const touched = new Set<number>();
  for (const tier of block?.tiers ?? []) {
    for (const key of Object.keys(tier.patch)) {
      const m = /^weapons\[(\d+)\]/.exec(key);
      if (m) touched.add(Number(m[1]));
    }
  }
  const reach = [...touched].map((i) => weapons[i]?.effective_range_tiles ?? weapons[i]?.range_tiles ?? 8);
  return reach.length === 0 ? 8 : Math.max(2, Math.min(8, Math.floor(Math.min(...reach))));
}

/** The firepower track alone, in the fire drill at `fireDistance`: mean damage dealt to a standing 30,000 hp dummy in 20 s. */
export function fireCheck(id: string, base: UnitTypeJson, seeds = DRILL_SEEDS): TrackCheck {
  const alone = aloneAtMax(base, 'firepower');
  const dist = fireDistance(base);
  const seedList = Array.from({ length: seeds }, (_, s) => 98000 + s);
  const mean = (j: UnitTypeJson) => seedList.reduce((sum, sd) => sum + fireDrill(j, sd, dist), 0) / seedList.length;
  const a = mean(base);
  const b = mean(alone);
  return {
    id,
    track: 'firepower',
    drill: 'damage',
    gains: b > a + EPS,
    detail: `deals ${a.toFixed(1)} -> ${b.toFixed(1)} damage to a dummy ${dist} tiles off`,
  };
}

/** Every track of every unit of `ids`, baked alone at its top tier, read in its own drill. */
export function trackChecks(ids: readonly string[] = NINE, seeds = DRILL_SEEDS): TrackCheck[] {
  const out: TrackCheck[] = [];
  for (const id of ids) {
    const base = stagedUnit(id);
    for (const track of tracksOf(base)) out.push(track === 'firepower' ? fireCheck(id, base, seeds) : checkOf(trackRow(id, base, aloneAtMax(base, track), seeds), track));
  }
  return out;
}

export interface Verdict {
  check: TrackCheck;
  /** `ok`: the track gains; `exempt`: it ties and is named in `exempt`; `fail`: it ties and is not; `stale`: it gains but is still named. */
  state: 'ok' | 'exempt' | 'fail' | 'stale';
}

/** Judge `checks` against the named exemptions. A tie fails unless named, and a name whose check now gains fails until it is deleted. */
export function judge(checks: readonly TrackCheck[], exempt: Readonly<Record<string, string>> = EXEMPT): Verdict[] {
  return checks.map((check) => {
    const named = `${check.id}.${check.track}` in exempt;
    if (check.gains) return { check, state: named ? 'stale' : 'ok' };
    return { check, state: named ? 'exempt' : 'fail' };
  });
}

/** Exemptions that name no check at all (a unit or track renamed or removed): a dead entry reads as a covered gap. */
export function orphanExemptions(checks: readonly TrackCheck[], exempt: Readonly<Record<string, string>> = EXEMPT): string[] {
  const known = new Set(checks.map((c) => `${c.id}.${c.track}`));
  return Object.keys(exempt).filter((k) => !known.has(k));
}
