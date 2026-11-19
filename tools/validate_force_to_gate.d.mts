// Types for validate_force_to_gate.mjs, so tools/src/validate_force_to_gate.test.ts typechecks.
export interface ClearPoint {
  label: string;
  x: number;
  y: number;
}
export declare const FORCE_CLEARANCE_TILES: number;
export declare function authoredBodies(
  placements: unknown,
  markers: unknown,
  playerStart: unknown,
  keep?: (p: never) => boolean
): ClearPoint[];
export declare function musterPoints(mission: unknown, markers: unknown): ClearPoint[];
export declare function gateCentres(mission: unknown, map: unknown, types: unknown): ClearPoint[];
export declare function forceToGateFailures(
  points: { force?: readonly ClearPoint[]; civilians?: readonly ClearPoint[]; musters?: readonly ClearPoint[]; gates?: readonly ClearPoint[] },
  file: string,
  clearance?: number
): string[];
export declare function authoredForceToGateFailures(
  mission: unknown,
  map: unknown,
  types: unknown,
  unitsById: unknown,
  file: string
): string[];
