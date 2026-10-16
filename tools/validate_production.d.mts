/** F4 (GH-183) Task 7: `structures[].side` and `enemy.production`, cross-checked against map, catalogue and unit files. */
export const MAX_PRODUCTION_LINES: number;
export function productionFailures(
  mission: unknown,
  map: unknown,
  catalogue: unknown,
  enemyUnits: ReadonlyMap<string, unknown>,
  file: string,
): string[];
