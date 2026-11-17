// Type declaration for promotion-pr.mjs, so tools/src/ci/promotion-pr.test.ts (strict TypeScript) can import the plain
// Node module without an implicit-any error. Same arrangement as tools/next_version.d.mts: the module has no build step
// so a workflow step runs it with `node` alone, and this file exists only for the test.
export interface Commit { sha: string; parents: string[]; subject: string; body: string }
export interface Entry { pr: number | null; sha: string; group: string; line: string }
export interface Run { id?: number; status?: string | null; conclusion?: string | null; html_url?: string; head_sha?: string }
export interface CiRuns { tip?: Run | null; latest?: Run | null }
export type Action = 'empty' | 'create' | 'none' | 'update' | 'foreign';
export const MARKER: string;
export const BODY_LIMIT: number;
export const OTHER_GROUP: string;
export function neutralise(text: string): string;
export function groupOf(subject: string): string;
export function entryOf(commit: Commit): Entry | null;
export function entriesOf(commits: readonly Commit[]): Entry[];
export function ciLine(headSha: string, ci: CiRuns | null): string;
export function titleOf(entries: readonly Entry[]): string;
export function renderBody(input: {
  entries: readonly Entry[];
  headSha: string;
  baseSha: string;
  ci: CiRuns | null;
  compareUrl?: string | null;
  limit?: number;
}): string;
export function decide(input: {
  entries: readonly Entry[];
  title: string;
  body: string;
  open: readonly { number: number; title?: string; body?: string | null }[];
}): { action: Action; number: number | null };
export function parseLog(raw: string): Commit[];
