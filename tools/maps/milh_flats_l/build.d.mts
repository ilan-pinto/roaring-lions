// Types for build.mjs, so tools/src/milh_flats_l.test.ts typechecks.
export declare const ID: string;
export declare const NAME: string;
export declare const SOURCE_ID: string;
export declare const N: number;
export declare const SIZE: number;
export declare const MAP_PATH: string;
export declare const VERSUS_PATH: string;
export declare function loadSketch(): { json: Record<string, unknown>; rows: string[][]; elev: number[][] };
export declare const SEAT_0: number[];
export declare const SEAT_1: number[];
export declare function layout(t: string[][]): { markers: Record<string, number[]>; zones: Record<string, number[]> };
export declare function tileMap(): { t: string[][]; el: number[][]; rows: string[][]; elev: number[][] };
export declare function build(): { map: Record<string, unknown>; versus: Record<string, unknown> };
export declare function serialise(doc: unknown): string;
