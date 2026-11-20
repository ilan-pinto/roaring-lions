// Types for validate_muster.mjs, so tools/src/validate_muster.test.ts typechecks.
export interface Muster {
  trigger: string;
  marker: string;
  tile: [number, number];
}
export declare function musters(mission: unknown, markers: unknown): Muster[];
export declare function musterZoneFailures(mission: unknown, map: unknown, file: string): string[];
export declare function footBlocked(mission: unknown, map: unknown, types: unknown): { blocked: Uint8Array; w: number; h: number };
export declare function musterReach(
  mission: unknown,
  map: unknown,
  types: unknown
): { muster: Muster; open: boolean; reached: { x: number; y: number; what: string } | null }[];
export declare function sealedCompoundFailures(mission: unknown, map: unknown, types: unknown, file: string): string[];
