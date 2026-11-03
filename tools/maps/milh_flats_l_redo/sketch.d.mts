// Types for sketch.mjs, so tools/src/milh_flats_l.test.ts typechecks.
export declare const SOURCE_ID: string;
export declare const SOURCE_PATH: string;
export declare const N: number;
export declare const KEPT_RELIEF: [number, number, number, number][];
export declare const PLAIN: number;
export declare function loadSource(): Record<string, unknown>;
export declare function sketch(): { json: Record<string, unknown>; rows: string[][]; elev: number[][] };
