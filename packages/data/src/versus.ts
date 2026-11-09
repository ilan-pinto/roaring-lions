// N3 Task 1: the versus rules file (data/versus/<map>.json, versus_rules.schema.json) and the
// pure loader that maps it, field for field, into the mission shape the runtime already takes.
// The loader only COPIES: a value that is not in a JSON file does not reach the runtime
// (network design §11b.4). No objective, trigger, wave or civilian is authored, so `checkEnd`
// can never end the runtime and `outcome.ts` decides the match.

/** One end of the map: where its camp stands. */
export interface VersusEndJson {
  readonly camp: { readonly at: readonly [number, number]; readonly size: readonly [number, number]; readonly exit?: readonly [number, number] };
}

/** A camp of a mode file: the rules file's camp plus an optional exit tile (GH-976). */
export interface VersusModeCampJson {
  readonly at: readonly [number, number];
  readonly size: readonly [number, number];
  /** Tile index [x, y] of an open ring tile of the footprint where units leave; absent = the sim's NW scan. */
  readonly exit?: readonly [number, number];
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
  /** GH-913 L3: the room's entity capacity (`VERSUS_CAPACITY_DEFAULT` when absent). */
  readonly capacity?: number;
  /** GH-913 L8: the match cap in minutes (`VERSUS_CAP_MINUTES_DEFAULT` when absent). */
  readonly cap_minutes?: number;
  /** GH-859: room kinds on this map in which formations stay closed with the versus gate open (absent: open in all). */
  readonly formations_closed_in?: readonly ('mirror' | 'placed' | 'economy')[];
  readonly ends: { readonly friendly: VersusEndJson; readonly hostile: VersusEndJson };
  readonly tunnels?: { readonly friendly?: readonly VersusTunnelJson[]; readonly hostile?: readonly VersusTunnelJson[] };
  readonly zones?: Readonly<Record<string, readonly number[]>>;
  readonly income_zones: readonly { readonly zone: string; readonly rate_per_min: number }[];
}

/** Entity capacity of a versus room whose rules file declares none. `spawn` never reuses a dead slot,
 *  so this is a budget for everyone who ever enters the match (GH-913 L3). */
export const VERSUS_CAPACITY_DEFAULT = 256;
/** The range a rules file's `capacity` may take (the schema's own bounds). A room may not be SMALLER
 *  than the default: a placed force and the economy's first builds must always fit. */
export const VERSUS_CAPACITY_MIN = 256;
export const VERSUS_CAPACITY_MAX = 1024;

/**
 * The entity capacity of the room played on a map with these rules (GH-913 L3): the file's `capacity`,
 * else `VERSUS_CAPACITY_DEFAULT`. A map with no rules file (a mirror-only map) is `undefined` and gets
 * the default. Throws on a value outside the schema's range, which `validate:data` would have refused.
 */
export function versusCapacityOf(rules: VersusRulesJson | undefined): number {
  const c = rules?.capacity;
  if (c === undefined) return VERSUS_CAPACITY_DEFAULT;
  if (!Number.isInteger(c) || c < VERSUS_CAPACITY_MIN || c > VERSUS_CAPACITY_MAX) {
    throw new Error(`versus rules "${rules?.id}": capacity ${c} is outside ${VERSUS_CAPACITY_MIN}..${VERSUS_CAPACITY_MAX}`);
  }
  return c;
}

/** The match cap, in minutes, of a versus room whose rules file declares none (GH-913 L8). The cap
 *  rule itself (`outcomeOf`) lives in the app and reads `@lions/net`'s `matchCapMinutes`, which is
 *  pinned to this by `tools/src/validate_versus_rules.test.ts`. */
export const VERSUS_CAP_MINUTES_DEFAULT = 25;
/** The range a rules file's `cap_minutes` may take (the schema's own bounds). */
export const VERSUS_CAP_MINUTES_MIN = 25;
export const VERSUS_CAP_MINUTES_MAX = 60;

/**
 * The match cap, in minutes, of the room played on a map with these rules (GH-913 L8): the file's
 * `cap_minutes`, else `VERSUS_CAP_MINUTES_DEFAULT`. `undefined` rules (a mirror-only map with no rules
 * file) get the default. Throws on a value outside the schema's range, which `validate:data` would
 * have refused.
 */
export function versusCapMinutesOf(rules: VersusRulesJson | undefined): number {
  const c = rules?.cap_minutes;
  if (c === undefined) return VERSUS_CAP_MINUTES_DEFAULT;
  if (!Number.isInteger(c) || c < VERSUS_CAP_MINUTES_MIN || c > VERSUS_CAP_MINUTES_MAX) {
    throw new Error(`versus rules "${rules?.id}": cap_minutes ${c} is outside ${VERSUS_CAP_MINUTES_MIN}..${VERSUS_CAP_MINUTES_MAX}`);
  }
  return c;
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

// ---------------------------------------------------------------------------------------------------
// Win modes (GH-976): data/versus/modes/<map>.json against versus_mode.schema.json
// ---------------------------------------------------------------------------------------------------

/** The win modes a room may play beside annihilation, in the order the lobby will list them. A twin of
 *  `@lions/net`'s `WIN_MODES` (the Worker imports net and not data); `tools/src/validate_versus_modes.test.ts`
 *  holds the two together. */
export const WIN_MODES = ['camp', 'points', 'flag'] as const;
export type WinModeId = (typeof WIN_MODES)[number];

/** One zone a points race pays for. */
export interface PointsZoneJson {
  readonly zone: string;
  readonly per_min: number;
  /** GH-976 P4: a ground the mode DECLARES (top-left tile, then width and height; both or neither). Absent: `zone` names a
   *  zone the map already has. The loader adds a declared ground to the map's zones, as it does a flag's. */
  readonly at?: readonly number[];
  readonly size?: readonly number[];
}

/** data/versus/modes/<map>.json. */
export interface VersusModeFileJson {
  readonly id: string;
  readonly map: string;
  /** Camps by END, required by the `camp` mode. */
  readonly camps?: { readonly friendly: VersusModeCampJson; readonly hostile: VersusModeCampJson };
  /** Flag zones by END, required by the `flag` mode (GH-976 P3). */
  readonly flags?: { readonly friendly: VersusEndJson['camp']; readonly hostile: VersusEndJson['camp'] };
  /** GH-976 v2, STAGED: the defended-flag layout and its set-up. Read only through `flagBlockOf(file, true)`, which a room whose
   *  config carries `flagSetup` asks for; the shipped `flags` and `modes.flag` are untouched until the per-map relist. */
  readonly flag_setup?: FlagSetupJson;
  readonly modes: {
    /** Destroy the camp. `wipe` is `"ends"` (the default: a side with no armed unit loses at once) or `"after_camp"` (GH-976:
     *  a wiped side keeps playing while its camp stands, and the survivor must still raze it). Typed `string`, not the literal
     *  union: a JSON module's inferred type widens a literal to `string`, and a union here breaks every JSON-module call site
     *  (`validate:data` and the schema hold the two values). */
    readonly camp?: { readonly wipe?: string };
    /** Capture the flag, v1 a raid: seconds a side must hold the enemy flag zone alone. */
    readonly flag?: { readonly hold_s: number };
    readonly points?: { readonly zones: readonly PointsZoneJson[]; readonly per_value_destroyed: number; readonly target: number };
  };
}

/** An objective row as a mode file turns it into: the runtime's `ObjectiveJson` shape, restated (this package
 *  imports nothing). */
export interface VersusModeObjectiveJson {
  id: string;
  type: 'raze' | 'score' | 'capture';
  primary: true;
  side: 0 | 1;
  target?: string;
  /** A `capture`'s hold (GH-976 P3). */
  seconds?: number;
  /** GH-976 v2: only a man on the ground holds or contests (the runtime's `ObjectiveJson.ground_only`). Set by a set-up flag room alone. */
  ground_only?: boolean;
  score?: { zones: { zone: string; per_min: number }[]; per_value_destroyed: number; target: number };
}

/** The runtime mission a win mode becomes, with the zones it adds to the map's. */
export interface VersusModeMissionJson {
  id: string;
  map: { file: string };
  ledger: { requires: never[]; produces: never[] };
  objectives: VersusModeObjectiveJson[];
  structures: { type: 'camp'; at: [number, number]; size: [number, number]; side: 0 | 1; owner: 0 | 1 }[];
}

/** The zone a camp's footprint is, by END: what the `camp` mode's `raze` names. */
export function campYardZone(end: 'friendly' | 'hostile'): string {
  return `camp_yard_${end}`;
}

/** The zone a flag stands in, by END: what the `flag` mode's `capture` names (the side at the OTHER end raids it). */
export function flagZone(end: 'friendly' | 'hostile'): string {
  return `flag_${end}`;
}

/**
 * The mission a win mode plays (GH-976). `sideAt` says which SIDE stands at each END, the room's call as in
 * `versusMissionOf`. Every side gets ONE primary objective, in side order, so a mode is symmetric by
 * construction: the same numbers for both, and the only difference is which end is whose.
 *   camp:   side s razes the camp at the OTHER side's end; both camps stand, owned by the side that holds
 *           the end (an owned structure is a target in its own right, which a plain camp is not).
 *   points: side s runs the file's score block.
 *   flag:   side s holds the flag zone of the OTHER side's end (`capture`, `hold_s` seconds, alone: a contact or a
 *           step out resets the count). A raid -- there is no carried flag (GH-976 P3).
 *   flag with `opts.setup` (GH-976 v2): the same, from the staged `flag_setup` block (`flagBlockOf`), and each objective carries
 *   `ground_only: true`, so only a man on the ground holds or contests. Without it the rows are today's, byte for byte.
 * Throws on a mode the file does not carry, or `camp` with no `camps` / `flag` with no `flags`, which `validate:data` refused.
 */
export function versusModeMissionOf(
  file: VersusModeFileJson,
  mode: WinModeId,
  sideAt: { friendly: 0 | 1; hostile: 0 | 1 },
  opts: { setup?: boolean } = {},
): { mission: VersusModeMissionJson; zones: Record<string, number[]> } {
  const mission: VersusModeMissionJson = {
    id: `versus:${file.map}:${mode}`,
    map: { file: file.map },
    ledger: { requires: [], produces: [] },
    objectives: [],
    structures: [],
  };
  const zones: Record<string, number[]> = {};
  const sides = [0, 1] as const;
  if (mode === 'camp') {
    const camps = file.camps;
    if (file.modes.camp === undefined || camps === undefined) throw new Error(`versus mode file "${file.id}": no camp mode`);
    const ends = ['friendly', 'hostile'] as const;
    const endOf = (side: 0 | 1): 'friendly' | 'hostile' => (sideAt.friendly === side ? 'friendly' : 'hostile');
    for (const side of sides) {
      const end = endOf(side);
      const c = camps[end];
      mission.structures.push({ type: 'camp', at: [c.at[0], c.at[1]], size: [c.size[0], c.size[1]], side, owner: side });
    }
    for (const end of ends) zones[campYardZone(end)] = [camps[end].at[0], camps[end].at[1], camps[end].size[0], camps[end].size[1]];
    for (const side of sides) {
      mission.objectives.push({ id: `raze_camp_${side}`, type: 'raze', primary: true, side, target: campYardZone(endOf(side === 0 ? 1 : 0)) });
    }
  } else if (mode === 'flag') {
    // GH-976 R0.22: the rules come through the one reader. v1 rooms read today's block (setup false) until the per-map relist.
    const setup = opts.setup === true;
    const { flags, holdS } = flagBlockOf(file, setup);
    const endOf = (side: 0 | 1): 'friendly' | 'hostile' => (sideAt.friendly === side ? 'friendly' : 'hostile');
    for (const end of ['friendly', 'hostile'] as const) zones[flagZone(end)] = [flags[end].at[0], flags[end].at[1], flags[end].size[0], flags[end].size[1]];
    for (const side of sides) {
      mission.objectives.push({ id: `raid_flag_${side}`, type: 'capture', primary: true, side, target: flagZone(endOf(side === 0 ? 1 : 0)), seconds: holdS, ...(setup ? { ground_only: true } : {}) });
    }
  } else {
    const p = file.modes.points;
    if (p === undefined) throw new Error(`versus mode file "${file.id}": no points mode`);
    // A ground the file declares (`at` + `size`) joins the map's zones, as a flag's does; the room refuses a name the map has.
    for (const z of p.zones) if (z.at !== undefined && z.size !== undefined) zones[z.zone] = [z.at[0], z.at[1], z.size[0], z.size[1]];
    for (const side of sides) {
      mission.objectives.push({
        id: `score_${side}`, type: 'score', primary: true, side,
        score: { zones: p.zones.map((z) => ({ zone: z.zone, per_min: z.per_min })), per_value_destroyed: p.per_value_destroyed, target: p.target },
      });
    }
  }
  return { mission, zones };
}

// ---------------------------------------------------------------------------------------------------
// Capture the flag v2 (GH-976): the staged `flag_setup` block, the set-up regions and the one reader
// ---------------------------------------------------------------------------------------------------

/** The kit pieces a side places in the set-up, in slot order (the sim's `setSetupKit` takes them in this order). */
export const SETUP_KIT_PIECES = ['hesco', 'sandbag_post', 't_wall'] as const;
export type SetupKitPiece = (typeof SETUP_KIT_PIECES)[number];
/** The lead's fixed kit, per side. A different number is a ruling, not data (`validate:data` holds a file to it). */
export const SETUP_KIT: Readonly<Record<SetupKitPiece, number>> = { hesco: 12, sandbag_post: 4, t_wall: 2 };
/** The lead's fixed set-up length: 3:00. */
export const SETUP_SECONDS = 180;
/** The flag match cap, minutes, set-up included. A twin of `@lions/net`'s (the Worker imports net and not data); WP4 pins the pair. */
export const FLAG_SETUP_CAP_MINUTES = 30;
/** Band width, tiles, by size class: 8 on a 48x48 map, 12 on an 80x80 or 96x96 map. */
export const SETUP_BAND_TILES_48 = 8;
export const SETUP_BAND_TILES_LARGE = 12;

/** The staged flag block of a mode file: flags 6-12 path tiles behind their own seat, the hold, and the set-up. */
export interface FlagSetupJson {
  readonly flags: { readonly friendly: VersusEndJson['camp']; readonly hostile: VersusEndJson['camp'] };
  readonly hold_s: number;
  readonly setup: { readonly seconds: number; readonly band_tiles: number; readonly kit: Readonly<Record<string, number>> };
}

/**
 * The set-up regions of a map: -1 for the band, 0 for the region of seat `a`, 1 for the region of seat `b`; length
 * `width * height`, row-major. A tile is in the band when its centre lies less than `bandTiles / 2` from the perpendicular
 * bisector of the two seats. Exact: doubled coordinates make every centre an integer (C = 2x+1), D = |C-B|^2 - |C-A|^2 and
 * L = |A-B|^2 are integers, and the cell is decided by D^2 >= 4 band^2 L. Plain JS numbers throughout: D^2 passes 2^31 on a
 * 96x96 map (R0.20), so no `|0`, no `Math.imul`, no Int32Array scratch, and no square root. Its plain-node twin is
 * `setupRegion` in tools/validate_versus_modes.mjs.
 */
export function setupRegionOf(width: number, height: number, a: readonly [number, number], b: readonly [number, number], bandTiles: number): Int8Array {
  const out = new Int8Array(width * height);
  const ax = 2 * a[0] + 1;
  const ay = 2 * a[1] + 1;
  const bx = 2 * b[0] + 1;
  const by = 2 * b[1] + 1;
  const L = (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
  const bandSq = 4 * bandTiles * bandTiles * L;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cx = 2 * x + 1;
      const cy = 2 * y + 1;
      const D = (cx - bx) * (cx - bx) + (cy - by) * (cy - by) - ((cx - ax) * (cx - ax) + (cy - ay) * (cy - ay));
      out[y * width + x] = D * D >= bandSq ? (D > 0 ? 0 : 1) : -1;
    }
  }
  return out;
}

/**
 * The seat bisector clipped to the map rectangle, in tile units (the rectangle is [0, width] x [0, height], a tile centre at
 * x + 0.5). PRESENTATION ONLY (the dashed line): floating point is fine here, and the sim never reads it. The seats must differ.
 */
export function setupLineOf(width: number, height: number, a: readonly [number, number], b: readonly [number, number]): { a: [number, number]; b: [number, number] } {
  const mx = (a[0] + b[0]) / 2 + 0.5;
  const my = (a[1] + b[1]) / 2 + 0.5;
  // The line through (mx, my) with direction perpendicular to a->b.
  const dx = -(b[1] - a[1]);
  const dy = b[0] - a[0];
  if (dx === 0 && dy === 0) throw new Error('setupLineOf: the two seats are the same tile');
  let tMin = -Infinity;
  let tMax = Infinity;
  const clip = (p: number, d: number, lo: number, hi: number): void => {
    if (d === 0) return;
    const t1 = (lo - p) / d;
    const t2 = (hi - p) / d;
    tMin = Math.max(tMin, Math.min(t1, t2));
    tMax = Math.min(tMax, Math.max(t1, t2));
  };
  clip(mx, dx, 0, width);
  clip(my, dy, 0, height);
  return { a: [mx + dx * tMin, my + dy * tMin], b: [mx + dx * tMax, my + dy * tMax] };
}

/**
 * The ONE switch point for a flag room's rules (GH-976 R0.1, R0.22). `setup` true: the staged `flag_setup` block, hold and
 * set-up included. `setup` false: today's `flags` and `modes.flag.hold_s`, with `setup` null. Throws when the block asked for
 * is absent.
 */
export function flagBlockOf(file: VersusModeFileJson, setup: boolean): { flags: FlagSetupJson['flags']; holdS: number; setup: FlagSetupJson['setup'] | null } {
  if (setup) {
    const f = file.flag_setup;
    if (f === undefined) throw new Error(`versus mode file "${file.id}": no flag_setup`);
    return { flags: f.flags, holdS: f.hold_s, setup: f.setup };
  }
  if (file.flags === undefined || file.modes.flag === undefined) throw new Error(`versus mode file "${file.id}": no flag mode`);
  return { flags: file.flags, holdS: file.modes.flag.hold_s, setup: null };
}
