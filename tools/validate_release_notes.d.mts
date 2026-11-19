// Type declaration for validate_release_notes.mjs, so tools/src/validate_release_notes.test.ts (strict TypeScript) can
// import the plain Node module. Same arrangement as tools/validate_arena_results.d.mts.
export const SECTIONS: readonly ['units', 'rules', 'fixes'];
export const DENYLIST: readonly string[];
export const PATTERNS: readonly (readonly [string, RegExp])[];
export function foldEntry(entry: string): string;
export function entryHits(entry: string): string[];
export function releaseNotesFailures(files: readonly { file: string; doc: unknown }[]): string[];
