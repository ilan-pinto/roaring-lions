// Types for upscale.mjs, so tools/src/map_lib.test.ts typechecks.
type Pt = [number, number];
export declare const anchorOf: (c: number, n: number) => number;
export declare function interpElevation(E: readonly (readonly number[])[]): number[][];
export declare function straightenStairs(el: readonly (readonly number[])[]): number[][];
export declare function chainPath(a: readonly [number, number], b: readonly [number, number]): Pt[];
export declare function roadChain(cells: readonly (readonly [number, number])[], n: number, options: { diag: boolean }): Pt[];
export declare function isSimplePoint(fg: (x: number, y: number) => boolean, x: number, y: number): boolean;
export declare function thinSimple(mask: Uint8Array, w: number, h: number, fixed?: Uint8Array | null, keep?: Uint8Array | null): Uint8Array;
export declare function barrierChain(cells: readonly (readonly [number, number])[], fixedCells: readonly (readonly [number, number])[], n: number): Pt[];
export declare function components(rows: readonly string[], symbols: string): { sym: string; cells: Pt[] }[];
export declare function bboxOf(cells: readonly (readonly [number, number])[]): { x0: number; y0: number; w: number; h: number };
export declare function placeShape(cells: readonly (readonly [number, number])[], n: number): Pt[];
export declare function rescaleRect(rect: readonly number[], mode?: 'landmark' | 'area'): number[];
export declare function topHalfMarkers(
  markers: Record<string, readonly number[]>,
  n: number,
  place?: (p: [number, number]) => [number, number],
): Record<string, number[]>;
export declare function topHalfRects(zones: Record<string, readonly number[]>, n: number, rescale: (name: string, rect: number[]) => number[]): Record<string, number[]>;
