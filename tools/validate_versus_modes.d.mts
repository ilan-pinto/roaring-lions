// Types for validate_versus_modes.mjs, so tools/src/validate_versus_modes.test.ts typechecks.
export declare const WIN_MODES: string[];
export declare const MODE_CAMP_REACH: number;
export declare const OFFERED_MAPS: string[];
export declare function versusModeFailures(
  files: { file: string; doc: unknown }[],
  mapsById: Map<string, unknown>,
): string[];
export declare const SETUP_KIT: Record<string, number>;
export declare const SETUP_SECONDS: number;
export declare const SETUP_BAND_TILES_48: number;
export declare const SETUP_BAND_TILES_LARGE: number;
export declare const FOOT_OPEN: Set<string>;
export declare function setupRegion(
  map: { width: number; height: number },
  anchors: { friendly: readonly number[]; hostile: readonly number[] },
  band: number,
): number[];
export declare function footPathTo(
  map: { width: number; height: number; rows: string[] },
  from: readonly number[],
  rect: readonly number[],
): number;
