export function canonicalJson(v: unknown): string;
export function digestOf(doc: object): string;
export const DENY: readonly (readonly [string, RegExp])[];
export function denyHits(text: string): string[];
export function arenaResultsFailures(doc: unknown, file?: string): string[];
