// GH-1389: the versus computer seat's three levels, `data/computer/levels.json` (computer_levels.schema.json).
// A level is a STATED handicap on the computer's force size: the units of its placed force it leaves at home, stated per
// faction the computer can play (lead ruling, GH-1389, 19 Nov 2026), because the KDF and Sarim placed forces share no unit.
// Nothing here names a purse, an income or a vision: the schema has no such field, and the computer reads the
// same fog-honest view at every level. The app writes a level's handicap onto the computer seat's `withhold`
// (`offlineConfig`), choosing the row by the faction THAT seat plays; the sim only ever sees the units that were spawned.
import levelsJson from '../../../data/computer/levels.json';

/** The three levels, easiest first (the order the file holds and the ladder gates). */
export const COMPUTER_LEVEL_IDS = ['easy', 'medium', 'hard'] as const;
export type ComputerLevelId = (typeof COMPUTER_LEVEL_IDS)[number];

/** The factions the computer seat can play, each with its own withhold row (the same ids as `@lions/net`'s `Faction`). */
export const COMPUTER_FACTIONS = ['kdf', 'sarim'] as const;
export type ComputerFaction = (typeof COMPUTER_FACTIONS)[number];

export interface ComputerLevelJson {
  id: ComputerLevelId;
  label_key: string;
  blurb_key: string;
  /** By the faction the computer seat plays: the units of THAT faction's placed force it leaves at home. */
  withhold: Readonly<Record<ComputerFaction, readonly { unit: string; count: number }[]>>;
}

export interface ComputerLevelCatalogue {
  levels: readonly ComputerLevelJson[];
}

/** The shipped catalogue. */
export const computerLevels: ComputerLevelCatalogue = levelsJson as unknown as ComputerLevelCatalogue;

/** The level named `id` in `catalogue`; throws on an id it does not hold. */
export function computerLevelOf(id: ComputerLevelId, catalogue: ComputerLevelCatalogue = computerLevels): ComputerLevelJson {
  const l = catalogue.levels.find((x) => x.id === id);
  if (l === undefined) throw new Error(`computer level "${id}" is not in the catalogue`);
  return l;
}

/** A level's force handicap for a computer seat playing `faction`, as that seat's `withhold` (unit type id -> count),
 *  summing repeats of a unit. Empty for a level that leaves nothing of that faction's force at home: the caller then
 *  writes no `withhold` at all, so the world is the default's. Throws on a faction the level states nothing for. */
export function withholdOf(level: Pick<ComputerLevelJson, 'withhold'>, faction: ComputerFaction): Record<string, number> {
  const rows = level.withhold[faction] as ComputerLevelJson['withhold'][ComputerFaction] | undefined;
  if (rows === undefined) throw new Error(`computer level states no withhold for faction "${faction}"`);
  const out: Record<string, number> = {};
  for (const { unit, count } of rows) out[unit] = (out[unit] ?? 0) + count;
  return out;
}
