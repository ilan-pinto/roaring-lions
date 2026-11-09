// Types for validate_works.mjs, so tools/src/validate_works.test.ts typechecks.
export declare function buildableOwnerFailures(catalogue: unknown, file: string): string[];
export declare function fieldWorksKeyFailures(mission: unknown, catalogue: unknown, file: string): string[];
export declare function fieldWorksCarrierReport(
  mission: unknown,
  unitsById: Map<string, { abilities?: string[] }>,
  file: string
): { failures: string[]; warnings: string[] };
export declare function tunnelSensorFailures(mission: unknown, catalogue: unknown, file: string): string[];
export declare function worksSymbolFailures(
  catalogue: unknown,
  maps: { file: string; rows: string[] }[],
  terrainSymbols: Set<string>
): string[];
export declare function productionTypeFailures(catalogue: unknown, kdfRoles: ReadonlySet<string>, file: string): string[];
export declare function productionPlacementFailures(mission: unknown, catalogue: unknown, file: string): string[];
export declare function productionWorksCount(mission: unknown, catalogue: unknown): number;
