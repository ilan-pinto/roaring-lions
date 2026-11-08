/**
 * The campaign world as data, and how far a ledger has walked it (GH-1075 A0).
 * Pure: `@lions/sim` and nothing else. Moved out of `app/src/campaign.ts`, which
 * re-exports every name here, so no caller changes.
 */
import type { LedgerData, UnlockGate } from '@lions/sim';

export interface WorldTown {
  id: string;
  name: string;
  /** Position in the campaign art's viewBox space, not in tiles. */
  at: readonly [number, number];
  missions: readonly string[];
  /** Town-level gate (GH-912 G1); absent = open whenever its region is. */
  unlock?: UnlockGate;
}

export interface WorldRegion {
  id: string;
  name: string;
  faction: string;
  doctrine: string;
  blurb?: string;
  unlock?: UnlockGate;
  towns: readonly WorldTown[];
}

export interface ParsedWorld {
  id: string;
  name: string;
  /** Path under assets/, e.g. "campaign/sahar_basin.svg". */
  art: string;
  regions: readonly WorldRegion[];
  /** The story constant (spec 2026-09-10 §4.4): how many people the enemy took on the
   *  first morning. Absent means the world declares no account of the taken at all --
   *  distinct from zero, which would mean nobody was. */
  taken?: number;
}

interface TownJson {
  id: string;
  name: string;
  at: number[];
  missions: string[];
  unlock?: { after_mission?: string; roe_rating_min?: number };
}

interface RegionJson {
  id: string;
  name: string;
  faction: string;
  doctrine: string;
  blurb?: string;
  unlock?: { after_mission?: string; roe_rating_min?: number };
  towns: TownJson[];
}

interface WorldJson {
  id: string;
  name: string;
  art: string;
  taken?: number;
  regions: RegionJson[];
}

/** Read world.json into the runtime shape, mapping the authoring spelling of `unlock`
 *  (`after_mission`, `roe_rating_min`) onto the runtime's (`afterMission`, `roeMin`) --
 *  the same mapping main.ts already does for units. */
export function parseWorld(json: unknown): ParsedWorld {
  const gateOf = (u?: { after_mission?: string; roe_rating_min?: number }): UnlockGate | undefined => {
    const g: UnlockGate = {};
    if (u?.after_mission !== undefined) g.afterMission = u.after_mission;
    if (u?.roe_rating_min !== undefined) g.roeMin = u.roe_rating_min;
    return Object.keys(g).length > 0 ? g : undefined;
  };
  const w = json as WorldJson;
  if (!w || !Array.isArray(w.regions)) throw new Error('world: expected an object with a regions array');
  const world: ParsedWorld = {
    id: w.id,
    name: w.name,
    art: w.art,
    regions: w.regions.map((r) => {
      const unlock = gateOf(r.unlock);
      const region: WorldRegion = {
        id: r.id,
        name: r.name,
        faction: r.faction,
        doctrine: r.doctrine,
        towns: r.towns.map((t) => {
          const town: WorldTown = {
            id: t.id,
            name: t.name,
            at: [t.at[0] ?? 0, t.at[1] ?? 0] as const,
            missions: [...t.missions],
          };
          const g = gateOf(t.unlock);
          if (g) town.unlock = g;
          return town;
        }),
      };
      if (r.blurb !== undefined) region.blurb = r.blurb;
      if (unlock) region.unlock = unlock;
      return region;
    }),
  };
  if (typeof w.taken === 'number') world.taken = w.taken;
  return world;
}

const completed = (ledger: LedgerData | undefined): ReadonlySet<string> => {
  const done = ledger?.['campaign.completed_missions'];
  return new Set(Array.isArray(done) ? done : []);
};


export function townProgress(town: WorldTown, ledger: LedgerData | undefined): { done: number; total: number } {
  const done = completed(ledger);
  return { done: town.missions.filter((m) => done.has(m)).length, total: town.missions.length };
}

/** Every mission `world.json` names, in order. */
export function worldMissionIds(world: ParsedWorld): string[] {
  return world.regions.flatMap((r) => r.towns.flatMap((t) => [...t.missions]));
}
