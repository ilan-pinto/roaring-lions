// Types for common.mjs, so tools/src/map_lib.test.ts typechecks.
export declare const hash: (x: number, y: number, salt: number) => number;
export declare function halfTurnOf(size: number): {
  mirror: (p: readonly [number, number]) => [number, number];
  mirrorRect: (r: readonly [number, number, number, number]) => [number, number, number, number];
};
export declare function halfTurn(t: string[][], el: number[][], size: number): void;
export declare const serialise: (doc: unknown) => string;
export declare function sortedByKey<T>(o: Record<string, T>): Record<string, T>;
export declare function runCli(argv: readonly string[], outputs: readonly (readonly [string, string])[], generator: string): void;
