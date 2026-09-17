// Type declaration for validate_i18n.mjs, so a TypeScript test under the
// strict tsconfig (tools/src/validate_i18n.test.ts) can import the plain-JS
// gate module without an implicit-any error. Same arrangement as
// validate_ui_palette.d.mts, and for the same reason: the gate stays plain
// Node with no build step (`pnpm validate:ui` runs it directly) — this file
// exists only for the test's benefit.
export function bareStringFailures(file: string, source: string): string[];
export const MIGRATED: string[];
