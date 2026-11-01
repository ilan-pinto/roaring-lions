// Types for build.mjs, so tools/src/rujm_sawda.test.ts typechecks.
export declare const ID: string;
export declare const NAME: string;
export declare const SIZE: number;
export declare const MAP_PATH: string;
export declare const VERSUS_PATH: string;
export declare function cellSketch(options?: { walledFarms?: boolean; thickRoad?: boolean }): { g: string[][]; e: number[][] };
export declare function tileMap(): { t: string[][]; el: number[][] };
export declare function build(): { map: Record<string, unknown>; versus: Record<string, unknown> };
export declare function serialise(doc: unknown): string;
