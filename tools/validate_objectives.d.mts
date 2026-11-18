export function objectiveFailures(
  o: Record<string, unknown>,
  mi: Record<string, unknown>,
  map: Record<string, unknown>,
  file: string,
): string[];

export function razeZoneFailures(
  o: Record<string, unknown>,
  mi: Record<string, unknown>,
  map: Record<string, unknown>,
  catalogue: { types: Record<string, Record<string, unknown>> },
  symbols: Map<string, string>,
  protectedRoe: number,
  file: string,
): string[];
