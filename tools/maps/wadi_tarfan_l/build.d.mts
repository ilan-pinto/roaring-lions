// Types for build.mjs, so tools/src/wadi_tarfan_l.test.ts typechecks.
export declare const ID: string;
export declare const NAME: string;
export declare const SOURCE_ID: string;
export declare const N: number;
export declare const SIZE: number;
export declare const MAP_PATH: string;
export declare const VERSUS_PATH: string;
export declare function loadSketch(): { json: Record<string, unknown>; rows: string[][]; elev: number[][] };
export declare function keepCliffs(el: number[][], elev: number[][]): number[][];
export declare function tileMap(): { t: string[][]; el: number[][]; rows: string[][]; elev: number[][] };
export declare function build(): { map: Record<string, unknown>; versus: Record<string, unknown> };
export declare function serialise(doc: unknown): string;
