// Type declaration for cut-tag.mjs, so tools/src/ci/cut-tag.test.ts (strict TypeScript) can import the plain Node
// module. Same arrangement as promotion-pr.d.mts: the workflow runs the module with `node` alone.
export const CUT_PREFIX: string;
export function cutTagName(release: string): string;
export type GitResult = { status: number; stdout: string; stderr: string };
export type GitRunner = (args: string[]) => GitResult;
export type Outcome =
  | { action: 'created'; name: string; target: string }
  | { action: 'skipped'; reason: 'no-second-parent' | 'not-on-dev' | 'exists'; name: string; detail: string };
export function gitIn(cwd?: string): GitRunner;
export function warning(message: string): string;
export function cutTag(opts: {
  release: string;
  merge: string;
  git: GitRunner;
  dev?: string | null;
  remote?: string | null;
  log?: (line: string) => void;
  annotate?: (line: string) => void;
}): Outcome;
