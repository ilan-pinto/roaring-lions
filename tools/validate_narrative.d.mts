// Type declaration for validate_narrative.mjs, so a TypeScript test under the
// strict tsconfig (tools/src/*.test.ts) can import the plain-JS gate module
// without an implicit-any error. The gate itself stays plain Node with no
// build step (see validate_data.mjs's own header comment) — this file exists
// only for tests' benefit, the same role validate_map_grid.d.mts plays for
// validate_map_grid.mjs.
export function removeTriggerFailures(mission: object, label: string): string[];
export function narrativeTextFailures(mission: object, label: string): string[];
export function commanderRankFailures(commander: object, world: object, label: string): string[];
