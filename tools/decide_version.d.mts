// Type declaration for decide_version.mjs, so tools/src/ci/cut-tag.test.ts (strict TypeScript) can call the real
// last-release lookup. Same arrangement as next_version.d.mts: the workflow runs the module with `node` alone.
export const RELEASE_TAG_MATCH: string;
export function lastTag(cwd?: string): string | null;
