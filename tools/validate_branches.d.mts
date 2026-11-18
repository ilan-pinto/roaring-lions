// Type declaration for validate_branches.mjs (GH-1384), so tools/src/branches.test.ts (a TypeScript file under the
// strict tsconfig) can import the plain-node rules without an implicit-any error. Same arrangement as
// validate_formations.d.mts.
export const BRANCHED_TRACKS_MAX: number;
export const BRANCH_CEILING: Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, number>>>>>>;
export function isBranched(tier: unknown): boolean;
export function tierPatches(tier: unknown): Record<string, number>[];
export function tierRegressions(prev: unknown, curr: unknown): string[];
export function upgradeTierFailures(where: string, unit: unknown, hasPath: (unit: never, path: string) => boolean): string[];
export function validateBranches(
  units: readonly { file: string; doc: unknown }[],
  opts: { en: Readonly<Record<string, string>>; tracksMax?: number; ceiling?: object }
): string[];
