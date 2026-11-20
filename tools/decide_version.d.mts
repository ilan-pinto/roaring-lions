// Type declaration for decide_version.mjs, so tools/src/ci/cut-tag.test.ts and tools/src/decide_version.test.ts
// (strict TypeScript) can call the real last-release lookup and decision. Same arrangement as next_version.d.mts:
// the workflow runs the module with `node` alone.
export const RELEASE_TAG_MATCH: string;
export function lastTag(cwd?: string): string | null;
export const NOTES_PATH: string;
export function readNotes(cwd?: string, rev?: string): unknown;
export function decide(cwd?: string): { next: string | null; line: string };
