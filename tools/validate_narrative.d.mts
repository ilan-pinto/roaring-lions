// Type declaration for validate_narrative.mjs, so a TypeScript test under the
// strict tsconfig (tools/src/*.test.ts) can import the plain-JS gate module
// without an implicit-any error. The gate itself stays plain Node with no
// build step (see validate_data.mjs's own header comment) — this file exists
// only for tests' benefit, the same role validate_map_grid.d.mts plays for
// validate_map_grid.mjs.
export function removeTriggerFailures(mission: object, label: string): string[];
export function narrativeTextFailures(mission: object, label: string): string[];
export function commanderRankFailures(commander: object, world: object, label: string): string[];
export function triggerLabelFailures(mission: object, file: string): string[];
export function overlayFailures(file: string, overlay: object, missions: Map<string, object>): string[];
export function unitOverlayFailures(file: string, overlay: object | null, units: Map<string, object>): string[];
/** GH-1406 part 5: the stale-translation guard's hash, and the generated English unit catalogue. */
export function sourceHash(text: string): string;
export function buildEnglishUnits(units: readonly object[]): Record<string, object>;
export function englishUnitFailures(file: string, catalogue: unknown, units: readonly object[]): string[];
