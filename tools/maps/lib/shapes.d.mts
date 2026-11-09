// Types for shapes.mjs, so tools/src/map_lib.test.ts typechecks.
export declare function farmAt(t: string[][], x0: number, y0: number, house: readonly [number, number], gates: readonly (readonly [number, number])[]): void;
export declare function ringTiles(x0: number, y0: number, w: number, h: number): [number, number][];
export declare function stampChain(t: string[][], tiles: readonly (readonly [number, number])[], symbol: string, allowed: string, label?: string): void;
export declare function shelfSteps(
  t: string[][],
  el: number[][],
  rows: number,
  cols: number,
  options: { reach: number; bands: readonly (readonly [number, number])[]; rest: number; skip: string },
): void;
export declare function scatterPatches(
  put: (x: number, y: number, symbol: string) => unknown,
  hash: (x: number, y: number, salt: number) => number,
  patches: readonly (readonly [number, number])[],
  options: { radius: number; salt: number; rows: number; symbol: string; centreSymbol: string },
): void;
