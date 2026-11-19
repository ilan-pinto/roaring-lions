// Types for validate_doctrine.mjs, so tools/src/validate_doctrine.test.ts typechecks.
export declare const OPPOSITION_FACTIONS: string[];
export declare const BANNED_MENU_UNITS: string[];
export declare const SARIM_BUDGET_RATIO: [number, number];
export declare function doctrineFailures(
  doctrines: { file: string; doc: unknown }[],
  unitsById: Map<string, { faction?: string }>,
): string[];

// GH-1383 slice 1: the doctrine picks (P1-P10).
export declare const PICKS_PER_FACTION: number;
export declare const OP_ORDER: string[];
export declare const PRICE_STEP_PCT: number;
export declare function isStoreSpecial(unit: unknown): boolean;
export declare function storeSpecialIds(unitsById: Map<string, unknown>): string[];
export declare function resolvePick(
  base: { menu?: readonly string[]; pop_cap?: number } | null | undefined,
  pick: { ops?: readonly unknown[] } | null | undefined,
): { menu: string[]; prices: Record<string, number>; popCap: number | null };
export declare function neutralCap(
  baseCap: number,
  baseMenu: readonly string[],
  menu: readonly string[],
  unitsById: Map<string, unknown>,
): number | null;
export declare function doctrinePickFailures(
  picks: { file: string; doc: unknown }[],
  bases: { file: string; doc: unknown }[],
  unitsById: Map<string, unknown>,
  en: Record<string, string>,
  formationIds: string[],
): string[];
