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

/** `empty` is "unlocked, but nothing authored" -- distinct from `live`, which
 *  promises something to click. Without it an empty region printed the badge
 *  `live` directly above "no operations authored yet" and the card
 *  contradicted itself; the badge is the half that reads as actionable. */
export type RegionStatus = 'live' | 'complete' | 'locked' | 'empty';

/** One country on the world render: generated geometry from countries.json.
 *  The three campaign fronts share ids with world.json regions; the rest are
 *  placeholder countries the shell shows locked. */
export interface WorldCountry {
  id: string;
  name: string;
  home: boolean;
  anchor: readonly [number, number];
  outline: readonly (readonly [number, number])[];
}

interface CountriesJson {
  countries: { id: string; name: string; home: boolean; anchor: number[]; outline: number[][] }[];
}

export function parseCountries(json: unknown): WorldCountry[] {
  const c = json as CountriesJson;
  if (!c || !Array.isArray(c.countries)) throw new Error('countries: expected an object with a countries array');
  return c.countries.map((k) => ({
    id: k.id,
    name: k.name,
    home: k.home,
    anchor: [k.anchor[0] ?? 0, k.anchor[1] ?? 0] as const,
    outline: k.outline.map((p) => [p[0] ?? 0, p[1] ?? 0] as const),
  }));
}

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
    lockedBecause !== null
      ? 'locked'
      : total === 0
        ? 'empty'
        : done === total
          ? 'complete'
          : 'live';
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

/**
 * The player's chain of command (GDD §11): the two recurring voices behind
 * `say`/`dispatch`/`aftermath`/`debrief`, and Shai's rank for a given
 * mission. Runtime shapes for `data/campaign/commander.json`, matched to
 * `commander.schema.json` the same way `ParsedWorld` matches `world.schema
 * .json` above -- `@lions/data` exports the raw JSON, this parses it once.
 */
export interface CommanderPerson {
  name: string;
  plate: string;
}

export interface CommanderRank {
  rank: string;
  stars: number;
  /** Mission id (campaign order) this rank holds through. Absent only on
   *  the last entry, which is the default for everything after it. */
  untilMission?: string;
}

export interface CommanderData {
  people: { shai: CommanderPerson; idit: CommanderPerson };
  /** Ascending campaign order -- see `commanderForMission`. */
  ranks: readonly CommanderRank[];
}

/** Shai's rank and plate for one mission -- what `ui/hud.ts` and
 *  `ui/loading.ts` show in place of the old hard-coded `COMMANDER` constant. */
export interface ResolvedCommander {
  name: string;
  plate: string;
  rank: string;
  stars: number;
}

interface CommanderRankJson {
  rank: string;
  stars: number;
  until_mission?: string;
}

interface CommanderJson {
  people: { shai: CommanderPerson; idit: CommanderPerson };
  ranks: CommanderRankJson[];
}

/** Maps the authoring spelling (`until_mission`) onto the runtime one
 *  (`untilMission`) -- the same convention `parseWorld` above already
 *  follows for `unlock.after_mission`. */
export function parseCommander(json: unknown): CommanderData {
  const c = json as CommanderJson;
  if (!c || !c.people?.shai || !c.people.idit || !Array.isArray(c.ranks)) {
    throw new Error('commander: expected people (shai, idit) and a ranks array');
  }
  return {
    people: { shai: { ...c.people.shai }, idit: { ...c.people.idit } },
    ranks: c.ranks.map((r) => {
      const rank: CommanderRank = { rank: r.rank, stars: r.stars };
      if (r.until_mission !== undefined) rank.untilMission = r.until_mission;
      return rank;
    }),
  };
}

/**
 * A mission's position in campaign order, as (town index, mission index
 * within that town) -- comparable lexicographically, which is all
 * `commanderForMission` needs. Every rank boundary in `commander.json` today
 * happens to be a town's own LAST mission, but resolving at mission
 * granularity (rather than town granularity) means a future promotion
 * mid-town would still be placed correctly rather than only by luck.
 *
 * A mission absent from every town's `missions` array -- today, only the
 * tutorial (this file's own `nextMissionAfter` doc comment: "teaches the
 * mouse, not the war") -- is placed just BEFORE its town's own list, by
 * matching the `${town.id}_` id prefix every mission in this campaign
 * happens to share with its town. `undefined` means neither matched: an id
 * this campaign does not recognise at all, which `commanderForMission` reads
 * as "no rank claims this mission" and answers with the roster's own default
 * (the last rank, which names no `untilMission`).
 */
function missionPosition(towns: readonly WorldTown[], missionId: string): readonly [number, number] | undefined {
  for (let t = 0; t < towns.length; t++) {
    const m = towns[t].missions.indexOf(missionId);
    if (m >= 0) return [t, m];
  }
  const byPrefix = towns.findIndex((t) => missionId.startsWith(`${t.id}_`));
  return byPrefix >= 0 ? [byPrefix, -1] : undefined;
}

function comparePosition(a: readonly [number, number], b: readonly [number, number]): number {
  return a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1];
}

/**
 * Shai's rank and plate for `missionId` -- the first `ranks` entry whose
 * `untilMission` is that mission or later in campaign order (`world`'s
 * region array, then town array, then mission array, all in authored
 * order); the last entry, which names no `untilMission`, is the default for
 * everything after it and for anything this campaign cannot place at all
 * (`missionPosition`'s own doc comment) -- see `commander.schema.json`'s
 * `ranks` field for the authoring contract this walks.
 */
export function commanderForMission(
  commander: CommanderData,
  world: ParsedWorld,
  missionId: string
): ResolvedCommander {
  const towns = world.regions.flatMap((r) => r.towns);
  const shai = commander.people.shai;
  const target = missionPosition(towns, missionId);
  if (target) {
    for (const r of commander.ranks) {
      if (r.untilMission === undefined) break; // the default, handled below
      const until = missionPosition(towns, r.untilMission);
      if (until && comparePosition(target, until) <= 0) {
        return { name: shai.name, plate: shai.plate, rank: r.rank, stars: r.stars };
      }
    }
  }
  const last = commander.ranks[commander.ranks.length - 1];
  return { name: shai.name, plate: shai.plate, rank: last.rank, stars: last.stars };
}
