// Types for validate_versus_rules.mjs, so tools/src/validate_versus_rules.test.ts typechecks.
export declare const MATCHUP_MAPS: string[];
export declare const VERSUS_SEATS: Record<string, { friendly: [number, number]; hostile: [number, number] }>;
export declare const CAMP_REACH: number;
export declare const OPEN_SYMBOLS: Set<string>;
export declare const MAX_RATE_PER_MIN: number;
export declare function anchorsOf(map: {
  id: string;
  markers?: Record<string, number[]>;
}): { friendly: number[]; hostile: number[] } | null;
export declare function versusRulesFailures(
  rulesFiles: { file: string; doc: unknown }[],
  mapsById: Map<string, unknown>,
): string[];
