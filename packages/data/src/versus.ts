// N3 Task 1: the versus rules file (data/versus/<map>.json, versus_rules.schema.json) and the
// pure loader that maps it, field for field, into the mission shape the runtime already takes.
// The loader only COPIES: a value that is not in a JSON file does not reach the runtime
// (network design §11b.4). No objective, trigger, wave or civilian is authored, so `checkEnd`
// can never end the runtime and `outcome.ts` decides the match.

/** One end of the map: where its camp stands. */
export interface VersusEndJson {
  readonly camp: { readonly at: readonly [number, number]; readonly size: readonly [number, number] };
}

/** One authored route of a rules file (`tunnels.friendly` / `tunnels.hostile`). */
export interface VersusTunnelJson {
  readonly id: string;
  /** Tile [x, y] pairs, mouth first, vent last. */
  readonly points: readonly (readonly [number, number])[];
  readonly capacity: number;
}

/** data/versus/<map>.json. */
export interface VersusRulesJson {
  readonly id: string;
  readonly map: string;
  readonly ends: { readonly friendly: VersusEndJson; readonly hostile: VersusEndJson };
  readonly tunnels?: { readonly friendly?: readonly VersusTunnelJson[]; readonly hostile?: readonly VersusTunnelJson[] };
  readonly zones?: Readonly<Record<string, readonly number[]>>;
  readonly income_zones: readonly { readonly zone: string; readonly rate_per_min: number }[];
}

/** data/doctrines/<faction>.json. */
export interface DoctrineJson {
  readonly id: string;
  readonly faction: 'kdf' | 'sarim';
  readonly name: string;
  readonly menu: readonly string[];
  readonly pop_cap?: number;
  readonly budget: { readonly logistics_start: number; readonly status: 'provisional' | 'swept' };
}

/** The runtime mission a versus rules file becomes: exactly these six keys. */
export interface VersusMissionJson {
  id: string;
  map: { file: string };
  ledger: { requires: never[]; produces: never[] };
  objectives: never[];
  structures: { type: 'camp'; at: [number, number]; size: [number, number]; side: 0 | 1 }[];
  resources: { income_zones: { zone: string; rate_per_min: number }[] };
}

/**
 * The mission a versus room's runtime is built from. `campSide` says which SIDE stands at each
 * END (the room's call: KDF is side 0 wherever it spawns). Side 0's camp is listed first
 * whichever end it stands on, so structure indices, and so production-line order, never depend
 * on the spawn order.
 */
export function versusMissionOf(
  rules: VersusRulesJson,
  campSide: { friendly: 0 | 1; hostile: 0 | 1 },
): VersusMissionJson {
  const camp = (end: 'friendly' | 'hostile') => ({
    type: 'camp' as const,
    at: [rules.ends[end].camp.at[0], rules.ends[end].camp.at[1]] as [number, number],
    size: [rules.ends[end].camp.size[0], rules.ends[end].camp.size[1]] as [number, number],
    side: campSide[end],
  });
  const both = [camp('friendly'), camp('hostile')];
  both.sort((a, b) => a.side - b.side); // stable: side 0 first
  return {
    id: 'versus:' + rules.map,
    map: { file: rules.map },
    ledger: { requires: [], produces: [] },
    objectives: [],
    structures: both,
    resources: { income_zones: rules.income_zones.map((z) => ({ zone: z.zone, rate_per_min: z.rate_per_min })) },
  };
}

/** The map's zones plus the rules file's own. A name in both is an authoring fault: refused. */
export function versusZonesOf(
  rules: VersusRulesJson,
  mapZones: Readonly<Record<string, readonly number[]>>,
): Record<string, readonly number[]> {
  const out: Record<string, readonly number[]> = { ...mapZones };
  for (const [name, z] of Object.entries(rules.zones ?? {})) {
    if (Object.hasOwn(mapZones, name)) {
      throw new Error(`versus rules "${rules.id}": zone "${name}" is already a zone of map "${rules.map}"`);
    }
    out[name] = z;
  }
  return out;
}

/** A versus route as the sim's `addTunnel` takes it (`TunnelRouteJson`, restated: this package imports nothing). */
export interface VersusTunnelRoute {
  id: string;
  points: [number, number][];
  dig_tiles_per_s: number;
  pre_dug: true;
  side: 0 | 1;
  capacity: number;
}

/**
 * The routes of one END of the map (GH-681, spec 6.1), in file order, as copies: owned by `side`
 * (the room's call: the Sarim side), pre-dug, digging rate 1 (inert once dug). An end with no
 * routes, or a file with no `tunnels` block, gives `[]`.
 */
export function versusTunnelsOf(rules: VersusRulesJson, end: 'friendly' | 'hostile', side: 0 | 1): VersusTunnelRoute[] {
  return (rules.tunnels?.[end] ?? []).map((t) => ({
    id: t.id,
    points: t.points.map((p) => [p[0], p[1]] as [number, number]),
    dig_tiles_per_s: 1,
    pre_dug: true as const,
    side,
    capacity: t.capacity,
  }));
}
