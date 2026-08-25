// Type declaration for next_version.mjs, so tools/src/next_version.test.ts
// (a TypeScript file under the strict tsconfig) can import the plain-JS rule
// without an implicit-any error. Same arrangement as validate_map_grid.d.mts,
// and for the same reason: the module stays plain Node with no build step so
// a GitHub Actions step can run it directly, and this file exists only for
// the test's benefit.
export function commitType(subject: string): string | null;
export function nextVersion(current: string, subjects: readonly string[]): string | null;
