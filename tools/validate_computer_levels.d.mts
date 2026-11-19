// Types for validate_computer_levels.mjs, so the computer ladder and its tests typecheck (GH-1389).
export declare const LEVEL_ORDER: string[];
export declare const INCOME_VOCABULARY: RegExp;
export declare const VISION_VOCABULARY: RegExp;
export declare function levelBoosts(level: unknown): { income: boolean; vision: boolean; keys: string[] };
export declare function withheldValue(
  level: { withhold?: { unit: string; count: number }[] } | unknown,
  unitsById: Map<string, { cost?: { logistics?: number } }>,
): number;
export declare function computerLevelFailures(
  levels: { file: string; doc: unknown },
  unitsById: Map<string, { faction?: string; cost?: { logistics?: number } }>,
): string[];
