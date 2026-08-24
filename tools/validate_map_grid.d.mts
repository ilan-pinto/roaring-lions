// Type declaration for validate_map_grid.mjs, so tools/src/map_grid.test.ts
// (a TypeScript file under the strict tsconfig) can import the plain-JS gate
// module without an implicit-any error. The gate itself stays plain Node with
// no build step (see validate_map_grid.mjs's own header comment) — this file
// exists only for the test's benefit.
export function elevationFailures(m: object, label: string): string[];
