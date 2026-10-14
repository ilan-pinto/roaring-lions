// Types for validate_garrison.mjs, so tools/src/validate_garrison.test.ts typechecks.
export declare function garrisonWeaponFailures(unit: unknown, file: string): string[];
export declare function garrisonStanceFailures(
  mission: unknown,
  unitsById: Map<string, { abilities?: string[] }>,
  file: string
): string[];
