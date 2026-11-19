// Types for validate_computer_levels.mjs, so the computer ladder and its tests typecheck (GH-1389).
export type LevelFaction = 'kdf' | 'sarim';
export type PlacedForces = { kdf: string[]; sarim: string[] };
export declare const LEVEL_ORDER: string[];
export declare const LEVEL_FACTIONS: LevelFaction[];
export declare const PLACED_FORCE_NAME: Record<LevelFaction, string>;
export declare const PLACED_FORCE_SOURCES: string[];
export declare const INCOME_VOCABULARY: RegExp;
export declare const VISION_VOCABULARY: RegExp;
export declare function placedForcesFromSource(sources: string[]): PlacedForces;
export declare function levelBoosts(level: unknown): { income: boolean; vision: boolean; keys: string[] };
export declare function withheldValue(
  level: { withhold?: Record<string, { unit: string; count: number }[]> } | unknown,
  unitsById: Map<string, { cost?: { logistics?: number } }>,
  faction: LevelFaction,
): number;
export declare function computerLevelFailures(
  levels: { file: string; doc: unknown },
  unitsById: Map<string, { faction?: string; cost?: { logistics?: number } }>,
  placed: PlacedForces | null,
): string[];
