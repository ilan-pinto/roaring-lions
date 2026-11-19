// Type declaration for release-notes-md.mjs, so tools/src/ci/release-notes-md.test.ts (strict TypeScript) can import the
// plain Node module. Same arrangement as promotion-pr.d.mts: the workflow runs the module with `node` alone.
export const DIR: string;
export const HEADINGS: readonly (readonly ['units' | 'rules' | 'fixes', string])[];
export const NOTHING: string;
export function emptyNotes(version: string): string;
export function releasedText(raw: string, version: string): string;
export function escapeMd(s: string): string;
export function renderMarkdown(doc: unknown): string;
