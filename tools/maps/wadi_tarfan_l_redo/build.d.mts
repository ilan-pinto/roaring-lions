// Types for build.mjs, so tools/src/wadi_tarfan_l_redo.test.ts typechecks.
export declare const ID: string;
export declare const NAME: string;
export declare const SIZE: number;
export declare const STAGED: string;
export declare const MAP_PATH: string;
export declare const VERSUS_PATH: string;
export declare const PLAIN: number;
export declare const SHELF: number;
export declare const SHELF_REACH: number;
export declare const WADI: { amp: number; period: number; fords: number[]; fordHalf: number; bedHalf: number };
export declare const BLUFF: { hill: number; crowns: Record<string, number[]> };
export declare const FUNNEL: { core: number[]; from: number; to: number };
export declare const FOLDS: [number, number, number, number, number[][]][];
export declare const OUTCROPS: number[][];
export declare const FORD_SCRUB: { from: number; to: number; density: number; symbol: string; salt: number };
export declare const BELTS: { stepX: number; stepY: number; x0: number; y0: number; jitter: number; minOpen: number };
export declare const LANE_HALF: number;
export declare const YARDS: Record<
  string,
  { x0: number; y0: number; gates: number[][]; house: number[] | null; sheds: number[][]; pump: number[] | null }
>;
export declare const FARMS: Record<string, { x0: number; y0: number; gates: number[][]; shed: number[] }>;
export declare const TOWN_ZONE: number[];
export declare const RATES: Record<string, number>;
export declare function bedCentre(v: number): number;
export declare function tileMap(): { t: string[][]; el: number[][]; road: number[][]; patches: number[][] };
export declare function build(): { map: Record<string, unknown>; versus: Record<string, unknown> };
export declare function serialise(doc: unknown): string;
