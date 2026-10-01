// Type declaration for validate_biome.mjs, so tools/src/validate_biome.test.ts
// (strict tsconfig) can import the plain-JS gate module -- the same reason
// validate_map_grid.d.mts exists. The gate itself stays plain Node.
export const REGION_BIOME: { readonly sur: 'highland' };
export function regionBiomeFailures(
  world: object,
  missionsById: ReadonlyMap<string, unknown>,
  mapsById: ReadonlyMap<string, unknown>
): string[];
