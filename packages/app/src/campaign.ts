/**
 * The campaign world, and what a ledger implies about it.
 *
 * All of it lives in `app` because it needs `LedgerData` and `unlockReason` from
 * `@lions/sim`, and `@lions/data` is a leaf that imports nothing. Splitting it so the
 * parser could sit in `data` would mean declaring the unlock type twice, once per package,
 * as a verbatim copy -- trading a layering nicety for duplicated types. `@lions/data`
 * therefore exports only the raw JSON, exactly as it already does for missions.
 *
 * Nothing here is persisted. A region's status is *derived* from
 * `campaign.completed_missions`, which the ledger already writes, so the map cannot
 * disagree with what was actually played and there is no second save file to migrate.
 */
import { unlockReason, type LedgerData, type UnlockGate } from '@lions/sim';

export interface WorldTown {
  id: string;
  name: string;
  /** Position in the campaign art's viewBox space, not in tiles. */
  at: readonly [number, number];
  missions: readonly string[];
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
}

export type RegionStatus = 'live' | 'complete' | 'locked';

export interface RegionProgress {
  status: RegionStatus;
  done: number;
  total: number;
  /** Player-facing sentence when locked, else null. */
  lockedBecause: string | null;
}

interface TownJson {
  id: string;
  name: string;
  at: number[];
  missions: string[];
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
  regions: RegionJson[];
}

/** Read world.json into the runtime shape, mapping the authoring spelling of `unlock`
 *  (`after_mission`, `roe_rating_min`) onto the runtime's (`afterMission`, `roeMin`) --
 *  the same mapping main.ts already does for units. */
export function parseWorld(json: unknown): ParsedWorld {
  const w = json as WorldJson;
  if (!w || !Array.isArray(w.regions)) throw new Error('world: expected an object with a regions array');
  return {
    id: w.id,
    name: w.name,
    art: w.art,
    regions: w.regions.map((r) => {
      const unlock: UnlockGate = {};
      if (r.unlock?.after_mission !== undefined) unlock.afterMission = r.unlock.after_mission;
      if (r.unlock?.roe_rating_min !== undefined) unlock.roeMin = r.unlock.roe_rating_min;
      const region: WorldRegion = {
        id: r.id,
        name: r.name,
        faction: r.faction,
        doctrine: r.doctrine,
        towns: r.towns.map((t) => ({
          id: t.id,
          name: t.name,
          at: [t.at[0] ?? 0, t.at[1] ?? 0] as const,
          missions: [...t.missions],
        })),
      };
      if (r.blurb !== undefined) region.blurb = r.blurb;
      if (Object.keys(unlock).length > 0) region.unlock = unlock;
      return region;
    }),
  };
}

const completed = (ledger: LedgerData | undefined): ReadonlySet<string> => {
  const done = ledger?.['campaign.completed_missions'];
  return new Set(Array.isArray(done) ? done : []);
};

export function townProgress(town: WorldTown, ledger: LedgerData | undefined): { done: number; total: number } {
  const done = completed(ledger);
  return { done: town.missions.filter((m) => done.has(m)).length, total: town.missions.length };
}

export function regionProgress(region: WorldRegion, ledger: LedgerData | undefined): RegionProgress {
  let done = 0;
  let total = 0;
  for (const town of region.towns) {
    const p = townProgress(town, ledger);
    done += p.done;
    total += p.total;
  }
  const lockedBecause = unlockReason(region.unlock, ledger);
  // A region with nothing authored yet is not "finished". Treating total 0 as complete
  // would grey out every region piece 2 has not written, which reads as a bug.
  const status: RegionStatus =
    lockedBecause !== null ? 'locked' : total > 0 && done === total ? 'complete' : 'live';
  return { status, done, total, lockedBecause };
}

/** The mission a town would start now: the first in authored order that is not done.
 *  Null when the town is finished, or has nothing authored yet. */
export function nextMissionOf(town: WorldTown, ledger: LedgerData | undefined): string | null {
  const done = completed(ledger);
  return town.missions.find((m) => !done.has(m)) ?? null;
}

/**
 * The mission that should follow the one that just ended, for the end screen's "next
 * mission" link.
 *
 * Tries the mission's owning town first: the mission that just ended belongs to some
 * town's authored order, and the next mission in that order is the obvious answer. A
 * mission off the map -- the tutorial is deliberately not listed under any town, since
 * it teaches the mouse rather than the war -- has no owning town to ask "what's next".
 * Hand off to wherever the campaign currently is instead: the first live region's first
 * town with something left to play. This is what carries a new player from the tutorial
 * into the campaign, rather than stranding them on an end screen offering only "replay"
 * and "menu".
 */
export function nextMissionAfter(
  world: ParsedWorld,
  missionId: string,
  ledger: LedgerData | undefined
): string | undefined {
  let owner = world.regions.flatMap((r) => r.towns).find((t) => t.missions.includes(missionId));
  if (!owner) {
    const front = world.regions.find((r) => regionProgress(r, ledger).status === 'live');
    owner = front?.towns.find((t) => nextMissionOf(t, ledger) !== null);
  }
  return owner ? (nextMissionOf(owner, ledger) ?? undefined) : undefined;
}

/**
 * The campaign ROE figure for display, and the mission dragging it down.
 *
 * The mean is computed here rather than in the sim on purpose: `@lions/sim` bans floating
 * point, and an average is division. The sim stores the per-mission bests -- bookkeeping,
 * no arithmetic -- and gates unlocks by integer comparison (Task 2). Presentation maths
 * belongs on this side of the boundary.
 */
export function campaignRoe(
  ledger: LedgerData | undefined
): { mean: number; worst: [string, number] | null } | null {
  const ratings = ledger?.['roe.mission_ratings'];
  if (ratings !== null && typeof ratings === 'object') {
    const entries = Object.entries(ratings as Record<string, number>);
    if (entries.length > 0) {
      const total = entries.reduce((a, [, v]) => a + v, 0);
      const worst = entries.length > 1 ? entries.reduce((a, b) => (b[1] < a[1] ? b : a)) : null;
      return { mean: Math.round(total / entries.length), worst };
    }
  }
  // A save written before per-mission ratings existed has a bare cumulative number.
  const legacy = ledger?.['roe.cumulative_rating'];
  return typeof legacy === 'number' ? { mean: legacy, worst: null } : null;
}
