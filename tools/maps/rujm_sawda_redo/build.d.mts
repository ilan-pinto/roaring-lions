// Types for build.mjs, so tools/src/rujm_sawda_redo.test.ts typechecks.
export declare const ID: string;
export declare const NAME: string;
export declare const SIZE: number;
export declare const STAGED: string;
export declare const MAP_PATH: string;
export declare const VERSUS_PATH: string;
export declare const PLAIN: number;
export declare const SHELF: number;
export declare const SHELF_REACH: number;
export declare const WADI: { amp: number; period: number; fords: number[]; fordHalf: number; bedHalf: number; vMax: number };
export declare const MESA: { crown: number[]; plateau: number; skirt: number; ring: number[] };
export declare const TELL: { crown: number[]; hill: number };
export declare const FUNNEL: { core: number[]; from: number; to: number };
export declare const YARDS: Record<
  string,
  { x0: number; y0: number; gates: number[][]; house: number[] | null; sheds: number[][]; pump: number[] | null }
>;
export declare const TOWN_ZONE: number[];
export declare function bedCentre(v: number): number;
export declare function tileMap(): { t: string[][]; el: number[][]; road: number[][] };
export declare function build(): { map: Record<string, unknown>; versus: Record<string, unknown> };
export declare function serialise(doc: unknown): string;
