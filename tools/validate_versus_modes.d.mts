// Types for validate_versus_modes.mjs, so tools/src/validate_versus_modes.test.ts typechecks.
export declare const WIN_MODES: string[];
export declare const MODE_CAMP_REACH: number;
export declare const OFFERED_MAPS: string[];
export declare function versusModeFailures(
  files: { file: string; doc: unknown }[],
  mapsById: Map<string, unknown>,
): string[];
