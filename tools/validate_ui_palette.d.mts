// Type declaration for validate_ui_palette.mjs, so a TypeScript test under
// the strict tsconfig (tools/src/validate_ui_px.test.ts) can import the
// plain-JS gate module without an implicit-any error. Same arrangement as
// validate_map_grid.d.mts and validate_narrative.d.mts, and for the same
// reason: the gate stays plain Node with no build step (`pnpm validate:ui`
// runs it directly) — this file exists only for the test's benefit.
export function pxFailures(file: string, css: string): string[];
