// Types for validate_abduct.mjs, so tools/src/validate_abduct.test.ts typechecks.
export declare const ABDUCT_RELEASE_TILES: number;
export declare function abductFailures(
  mission: unknown,
  map: unknown,
  blockedSyms: ReadonlySet<string>,
  file: string
): { failures: string[]; warnings: string[] };
