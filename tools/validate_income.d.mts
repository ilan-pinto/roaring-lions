/** F2 (GH-183): income zones and the supply entry, cross-checked against the mission's map. */
export const CORRIDOR_ENTRY_EXEMPT: string[];
export function incomeFailures(
  mission: unknown,
  map: unknown,
  file: string,
  exempt?: readonly string[],
): string[];
