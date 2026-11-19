// Types for validate_abduct.mjs, so tools/src/validate_abduct.test.ts typechecks.
export declare const ABDUCT_RELEASE_TILES: number;
export declare const ABDUCT_ROUTE_MARGIN_TILES: number;
export declare function abductRouteBound(vEscort: number, vCaptive: number, startGap: number): number;
export declare function abductFailures(
  mission: unknown,
  map: unknown,
  unitsById: ReadonlyMap<string, unknown> | undefined,
  blockedSyms: ReadonlySet<string>,
  file: string
): { failures: string[]; warnings: string[] };
