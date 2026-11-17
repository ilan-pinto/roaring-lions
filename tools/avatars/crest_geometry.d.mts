// Types for crest_geometry.mjs, so tools/src/avatars/crests.test.ts (strict TypeScript) can import the plain-Node
// generator without an implicit-any error. Same arrangement as next_version.d.mts.
export interface ChargePath { fill: string; d: string; evenodd?: boolean }
export interface Crest { id: string; ground: string; rim: string; paint?: string; lion?: boolean; charge?: () => ChargePath[] }
export const ROOT: string;
export const CRESTS: readonly Crest[];
export const FLOOR_EXEMPT_CRESTS: readonly string[];
export const FLOOR_EXEMPT_PARTS: readonly string[];
export const MIN_RETENTION: number;
export const MAX_CLOSING_GAIN: number;
export function paletteHex(key: string): string;
export function parsePath(d: string): [number, number][][];
export function readLion(root?: string): { silhouette: { id: string; d: string }[]; cutouts: { id: string; d: string }[] };
export function chargeOf(crest: Crest): ChargePath[];
export function renderCrest(crest: Crest): string;
export function measureCharge(paths: { d: string }[], size?: number): { retention: number[]; closingGain: number };
export function assertLegible(crest: Crest): void;
export function buildAll(): { id: string; svg: string }[];
