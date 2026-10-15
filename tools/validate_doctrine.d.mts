// Types for validate_doctrine.mjs, so tools/src/validate_doctrine.test.ts typechecks.
export declare const OPPOSITION_FACTIONS: string[];
export declare const BANNED_MENU_UNITS: string[];
export declare const SARIM_BUDGET_RATIO: [number, number];
export declare function doctrineFailures(
  doctrines: { file: string; doc: unknown }[],
  unitsById: Map<string, { faction?: string }>,
): string[];
