/**
 * The pure half of `fx-cost.ts` (GH-871 P4 T10): its options, the round-robin
 * schedule of the two-map wet run, what each wet config resolves to on a given
 * tree, and the net/gross/saving arithmetic. Three-free and browser-free on
 * purpose, so a test can hold all of it; `fx-cost.ts` is the browser half and
 * does nothing here that a literal could not check.
 *
 * Three things this file exists to refuse.
 *
 * **A 0 delta from a toggle that had nothing to hide.** On a dry map (the
 * `wadi_halam_basin` reference) the `rain` / `wet` / `marsh` / `ripples` layers
 * resolve by name and flip a flag, so the timed frame is the same frame and the
 * delta reads 0.00 -- which is indistinguishable from "this layer is free".
 * `resolveWetConfigs` names every config that has nothing to act on, and
 * `deltaRow` turns that into `n/a (<reason>)`, never a number.
 *
 * **A round that is not interleaved.** The basin is the reference only if it
 * shares the run's load drift. A schedule that times every round of map A and
 * then every round of map B reads the machine's drift as the maps' difference.
 *
 * **A single-map run that changed under the new flags.** The GH-829 command line
 * (`--breakdown --map=<id>`) parses to the same run it always did.
 */

export type Preset = 'high' | 'medium' | 'low';

/** The frame budget for the whole wet package, ms, by preset (the lead's rulings,
 *  GH-871: +1.0 / +0.7 / +0.4). Compared against `netCost`'s net. */
export const WET_BUDGET_MS: Readonly<Record<Preset, number>> = { high: 1.0, medium: 0.7, low: 0.4 };

/** The four debug layers the wet package is made of (`debug-layers.ts`). */
export const WET_LAYERS = ['rain', 'wet', 'marsh', 'ripples'] as const;
export type WetLayer = (typeof WET_LAYERS)[number];

/** Every config the wet mode times beyond `baseline`, in timing order. */
export const WET_CONFIG_NAMES = ['rain', 'wet', 'marsh', 'ripples', 'wet-all', 'wet-program', 'shadow-full'] as const;
export type WetConfigName = (typeof WET_CONFIG_NAMES)[number];
export const BASELINE = 'baseline';

/**
 * `wet-program` is the config the budget rests on. `wet-all` only zeroes the wet UNIFORMS
 * (`uWetAmp`, `uMarshAmp`, the ripple amplitude) and hides the rain draw, but a rain map's
 * ground still compiles the `THEME_WET` program, whose control-C fetch, rim derivatives, mix,
 * roughness and normal blocks run in both arms. `wet-program` removes the define and recompiles
 * the dry ground (with the rain and the ripples hidden too), so `baseline - wet-program` is the
 * wet package's whole cost, standing program included.
 */

/**
 * Probes (GH-871 cheap-wet follow-up): extra configs, named on `--probes=`, that swap ONE thing on
 * a live page and time it against the preset's own frame. A program probe recompiles the wet
 * ground with another `WetProgram` (the terms it keeps; `ThreeRenderer.debugSetWetProgram`); a
 * rain probe changes the rain batch's instance count while it stays visible (so what a drop costs
 * can be told from what the draw costs). Each reads `config - baseline` like every other row, so a
 * probe that is cheaper than the shipped program reads NEGATIVE.
 */
export interface ProgramProbe {
  readonly rim: 'gradient' | 'mask' | 'off';
  readonly ripples: boolean;
  readonly roughness: 'full' | 'water';
}
export const PROGRAM_PROBES: Readonly<Record<string, ProgramProbe>> = {
  full: { rim: 'gradient', ripples: true, roughness: 'full' },
  'rim-mask': { rim: 'mask', ripples: true, roughness: 'full' },
  'rim-off': { rim: 'off', ripples: true, roughness: 'full' },
  'no-ripples': { rim: 'gradient', ripples: false, roughness: 'full' },
  // NOT the shipped `lite` tier (that is `mask-rw-rip`): no ripple code and the full roughness table.
  'mask-norip': { rim: 'mask', ripples: false, roughness: 'full' },
  // The cost-ladder candidates: each drops the ripple code (low draws none) and varies rim and roughness.
  'mask-rw': { rim: 'mask', ripples: false, roughness: 'water' },
  'off-rw': { rim: 'off', ripples: false, roughness: 'water' },
  'off-rfull': { rim: 'off', ripples: false, roughness: 'full' },
  'grad-rw': { rim: 'gradient', ripples: false, roughness: 'water' },
  'mask-rw-rip': { rim: 'mask', ripples: true, roughness: 'water' },
  'off-rw-rip': { rim: 'off', ripples: true, roughness: 'water' },
};
/** Rain probes: the instance count the batch is set to (still drawn). */
export const RAIN_PROBES: Readonly<Record<string, number>> = { 'rain-n0': 0, 'rain-n1': 1, 'rain-n100': 100, 'rain-n300': 300, 'rain-n1000': 1000, 'rain-n2000': 2000 };
/** Rain SHADER probes: the batch's own material changed (and recompiled), count unchanged. `find`
 *  must occur in the stage's source or the probe throws (a drifted source is never a silent no-op). */
export interface RainShaderProbe {
  readonly depthTest?: boolean;
  readonly vertex?: readonly [string, string];
  readonly fragment?: readonly [string, string];
}
export const RAIN_SHADER_PROBES: Readonly<Record<string, RainShaderProbe>> = {
  'rain-nodepth': { depthTest: false },
  'rain-nodiscard': { fragment: ['if (a <= 0.0) discard;', ''] },
  // Every instance submitted, none live: the cost that stays is the cost of SUBMITTING instances.
  'rain-collapsed': { vertex: ['if (aKeep >= uKeep) {', 'if (true) {'] },
  'rain-noheight': { vertex: ['texture2D(uHeight, clamp(land / uMapSize, 0.0, 1.0)).r', '0.0'] },
  'rain-nosplash': { vertex: ['if (position.z < 0.5) {', 'if (position.z > 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }\n  if (position.z < 0.5) {'] },
  'rain-nostreak': { vertex: ['if (position.z < 0.5) {', 'if (position.z < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }\n  if (position.z < 0.5) {'] },
  'rain-halfwidth': { vertex: ['position.x * uStreakHalfWidth', 'position.x * uStreakHalfWidth * 0.5'] },
};
export const PROBE_PREFIX = 'probe:';

/** The wet mode's config list, in the order each round times them. */
export function wetConfigList(probes: readonly string[] = [], only: readonly string[] | null = null): readonly string[] {
  return [BASELINE, ...WET_CONFIG_NAMES.filter((n) => only === null || only.includes(n)), ...probes.map((p) => `${PROBE_PREFIX}${p}`)];
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Where a view looks. `boot` is the camera the sandbox booted with. */
export type ViewAt =
  | { readonly kind: 'boot' }
  | { readonly kind: 'marker'; readonly marker: string }
  | { readonly kind: 'tile'; readonly x: number; readonly y: number };

export interface ViewSpec {
  readonly name: string;
  readonly at: ViewAt;
  /** `null` is the boot zoom. */
  readonly zoom: number | null;
}

export interface CostArgs {
  readonly breakdown: boolean;
  /** True when `--maps=` was given: the wet, two-map mode. */
  readonly wet: boolean;
  /** The run's maps, in `--maps` order; `[--map]` in the GH-829 mode. */
  readonly maps: readonly string[];
  readonly dpr: number;
  readonly rounds: number;
  /** Timed frames per cell. */
  readonly frames: number;
  readonly burn: number;
  readonly views: Readonly<Record<string, readonly ViewSpec[]>>;
  /** `--pairs=<blocks>x<frames>`: time every config as ABBA blocks against the baseline, in one
   *  cell (see `runWet`); null is the P4 design (a config per cell, differences of medians). */
  readonly pairs: { readonly blocks: number; readonly frames: number } | null;
  /** `--configs=`: the built-in wet configs to time (a subset of `WET_CONFIG_NAMES`); null is all. */
  readonly configs: readonly string[] | null;
  /** `--probes=`: names in `PROGRAM_PROBES` / `RAIN_PROBES`, wet mode only. */
  readonly probes: readonly string[];
}

/** The GH-829 defaults, which a bare `--breakdown` has always meant. */
export const LEGACY_MAP = 'beit_sahwan_outskirts';
const LEGACY_ROUNDS = 3;
const LEGACY_FRAMES = 100;
/** The wet mode's spec defaults. */
const WET_ROUNDS = 12;
const WET_FRAMES = 20;

/** The GH-829 views: the boot camera at its own zoom, then 1.6 and 2.5. */
export function bootViews(): readonly ViewSpec[] {
  return [
    { name: 'boot', at: { kind: 'boot' }, zoom: null },
    { name: 'boot-z1.6', at: { kind: 'boot' }, zoom: 1.6 },
    { name: 'boot-z2.5', at: { kind: 'boot' }, zoom: 2.5 },
  ];
}

/** `ein_qasab`: `causeway_s` (the wading ford) at the three zooms the cost run
 *  reads. Every other map keeps the GH-829 boot views. */
export function defaultViews(mapId: string): readonly ViewSpec[] {
  if (mapId === 'ein_qasab') {
    return [1, 1.6, 2.5].map((zoom) => ({ name: `causeway_s-z${zoom}`, at: { kind: 'marker', marker: 'causeway_s' } as const, zoom }));
  }
  return bootViews();
}

function flag(argv: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = argv.find((a) => a.startsWith(prefix));
  return hit === undefined ? undefined : hit.slice(prefix.length);
}

function positiveInt(name: string, raw: string): number {
  if (!/^\d+$/.test(raw) || Number(raw) <= 0) throw new Error(`fx-cost: --${name} wants a positive integer, got "${raw}"`);
  return Number(raw);
}

function positiveNumber(name: string, raw: string): number {
  const v = Number(raw);
  if (raw.trim() === '' || !Number.isFinite(v) || v <= 0) throw new Error(`fx-cost: --${name} wants a positive number, got "${raw}"`);
  return v;
}

const MARKER_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** One `--views` entry's locator and zoom: `x,y,zoom` or `marker,zoom`. */
function parseViewBody(entry: string, body: string): ViewSpec {
  const parts = body.split(',').map((p) => p.trim());
  const zoomAt = (raw: string | undefined): number => {
    if (raw === undefined) throw new Error(`fx-cost: --views entry "${entry}" has no zoom`);
    return positiveNumber('views zoom', raw);
  };
  if (parts.length === 3) {
    const [xs, ys, zs] = parts;
    const x = Number(xs);
    const y = Number(ys);
    if (xs === '' || ys === '' || !Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error(`fx-cost: --views entry "${entry}" wants <x>,<y>,<zoom> or <marker>,<zoom>`);
    }
    const zoom = zoomAt(zs);
    return { name: `t${x}_${y}-z${zoom}`, at: { kind: 'tile', x, y }, zoom };
  }
  if (parts.length === 2) {
    const [marker, zs] = parts;
    if (marker === undefined || !MARKER_NAME.test(marker)) {
      throw new Error(`fx-cost: --views entry "${entry}" wants <x>,<y>,<zoom> or <marker>,<zoom>`);
    }
    const zoom = zoomAt(zs);
    return { name: `${marker}-z${zoom}`, at: { kind: 'marker', marker }, zoom };
  }
  throw new Error(`fx-cost: --views entry "${entry}" wants <map>:<x>,<y>,<zoom> or <map>:<marker>,<zoom>`);
}

/** `--views=<map>:<x>,<y>,<zoom>;<map>:<marker>,<zoom>;...`. Entries for one map
 *  accumulate in order. An entry naming a map the run does not time is an error
 *  (a typo would otherwise fall back to the defaults without a word). */
export function parseViews(raw: string, maps: readonly string[]): Record<string, ViewSpec[]> {
  const out: Record<string, ViewSpec[]> = {};
  for (const entry of raw.split(';').map((e) => e.trim()).filter((e) => e !== '')) {
    const colon = entry.indexOf(':');
    if (colon <= 0) throw new Error(`fx-cost: --views entry "${entry}" wants <map>:<locator>,<zoom>`);
    const map = entry.slice(0, colon).trim();
    if (!maps.includes(map)) throw new Error(`fx-cost: --views names map "${map}" but the run's maps are ${maps.join(', ')}`);
    const view = parseViewBody(entry, entry.slice(colon + 1));
    const list = (out[map] ??= []);
    if (list.some((v) => v.name === view.name)) throw new Error(`fx-cost: --views names view "${view.name}" twice for map "${map}"`);
    list.push(view);
  }
  return out;
}

/** argv -> the run, or a throw naming the argument. */
export function parseCostArgs(argv: readonly string[]): CostArgs {
  const breakdown = argv.includes('--breakdown');
  const rawMaps = flag(argv, 'maps');
  const rawMap = flag(argv, 'map');
  if (rawMaps !== undefined && rawMap !== undefined) throw new Error('fx-cost: pass --maps=<a>,<b> or --map=<id>, not both');
  const wet = rawMaps !== undefined;
  if (wet && !breakdown) throw new Error('fx-cost: --maps is a --breakdown option');
  let maps: string[];
  if (wet) {
    maps = rawMaps.split(',').map((m) => m.trim()).filter((m) => m !== '');
    if (maps.length === 0) throw new Error('fx-cost: --maps names no map');
    if (new Set(maps).size !== maps.length) throw new Error(`fx-cost: --maps names a map twice (${maps.join(', ')})`);
  } else {
    maps = [rawMap ?? LEGACY_MAP];
  }
  const rawViews = flag(argv, 'views');
  if (rawViews !== undefined && !wet) throw new Error('fx-cost: --views needs --maps (the GH-829 single-map run keeps its boot views)');
  const given = rawViews === undefined ? {} : parseViews(rawViews, maps);
  const views: Record<string, readonly ViewSpec[]> = {};
  for (const m of maps) views[m] = given[m] ?? defaultViews(m);
  const rawRounds = flag(argv, 'rounds');
  const rawFrames = flag(argv, 'frames');
  const rawDpr = flag(argv, 'dpr');
  const rawBurn = flag(argv, 'burn');
  let burn = 0;
  if (rawBurn !== undefined) {
    if (!/^\d+$/.test(rawBurn)) throw new Error(`fx-cost: --burn wants a non-negative integer, got "${rawBurn}"`);
    burn = Number(rawBurn);
  }
  const rawPairs = flag(argv, 'pairs');
  let pairs: { blocks: number; frames: number } | null = null;
  if (rawPairs !== undefined) {
    const m = /^(\d+)x(\d+)$/.exec(rawPairs);
    if (!wet) throw new Error('fx-cost: --pairs is a --maps (wet mode) option');
    if (m === null || Number(m[1]) < 2 || Number(m[2]) < 1) throw new Error(`fx-cost: --pairs wants <blocks>x<frames> (blocks >= 2), got "${rawPairs}"`);
    pairs = { blocks: Number(m[1]), frames: Number(m[2]) };
  }
  const rawConfigs = flag(argv, 'configs');
  const configs = rawConfigs === undefined ? null : rawConfigs.split(',').map((c) => c.trim()).filter((c) => c !== '');
  if (configs !== null) {
    if (!wet) throw new Error('fx-cost: --configs is a --maps (wet mode) option');
    for (const c of configs) if (!(WET_CONFIG_NAMES as readonly string[]).includes(c)) throw new Error(`fx-cost: --configs names "${c}"; known: ${WET_CONFIG_NAMES.join(', ')}`);
  }
  const rawProbes = flag(argv, 'probes');
  const probes = rawProbes === undefined ? [] : rawProbes.split(',').map((p) => p.trim()).filter((p) => p !== '');
  if (probes.length > 0 && !wet) throw new Error('fx-cost: --probes is a --maps (wet mode) option');
  for (const p of probes) {
    if (!(p in PROGRAM_PROBES) && !(p in RAIN_PROBES) && !(p in RAIN_SHADER_PROBES)) {
      throw new Error(`fx-cost: --probes names "${p}"; known: ${[...Object.keys(PROGRAM_PROBES), ...Object.keys(RAIN_PROBES), ...Object.keys(RAIN_SHADER_PROBES)].join(', ')}`);
    }
  }
  return {
    breakdown,
    wet,
    maps,
    configs,
    pairs,
    probes,
    dpr: rawDpr === undefined ? 2 : positiveNumber('dpr', rawDpr),
    rounds: rawRounds === undefined ? (wet ? WET_ROUNDS : LEGACY_ROUNDS) : positiveInt('rounds', rawRounds),
    frames: rawFrames === undefined ? (wet ? WET_FRAMES : LEGACY_FRAMES) : positiveInt('frames', rawFrames),
    burn,
    views,
  };
}

// ---------------------------------------------------------------------------
// The schedule
// ---------------------------------------------------------------------------

export interface ScheduleStep {
  readonly round: number;
  readonly map: string;
  readonly viewIndex: number;
  readonly view: string;
  readonly config: string;
}

/**
 * The timing order: for each round, for each view slot, for each map that has
 * that slot, for each config. So A and B alternate at every view slot of every
 * round (A v0, B v0, A v1, B v1, ...), and a drift in the machine lands on both.
 * A map with fewer views simply has no step at a slot it lacks.
 */
export function buildSchedule(plan: {
  readonly maps: readonly string[];
  readonly rounds: number;
  readonly views: Readonly<Record<string, readonly ViewSpec[]>>;
  readonly configs: readonly string[];
}): ScheduleStep[] {
  const slots = Math.max(0, ...plan.maps.map((m) => plan.views[m]?.length ?? 0));
  const steps: ScheduleStep[] = [];
  for (let round = 0; round < plan.rounds; round++) {
    for (let viewIndex = 0; viewIndex < slots; viewIndex++) {
      for (const map of plan.maps) {
        const view = plan.views[map]?.[viewIndex];
        if (view === undefined) continue;
        for (const config of plan.configs) steps.push({ round, map, viewIndex, view: view.name, config });
      }
    }
  }
  return steps;
}

// ---------------------------------------------------------------------------
// What each wet config resolves to
// ---------------------------------------------------------------------------

export type NaReason =
  | 'dry-map'
  | 'no-rain-batch'
  | 'ripples-off'
  | 'reduced-motion'
  | 'no-shadow-step'
  | 'no-quality'
  | 'no-sun'
  | 'no-wet-define';
export type Resolution = { readonly resolves: true } | { readonly resolves: false; readonly reason: NaReason };

/** What the page reports of the renderer, read after the boot frames. */
export interface WetFacts {
  /** `opts.weather === 'rain'`. */
  readonly rainMap: boolean;
  /** The ground material was built `{ wet: true }`. */
  readonly wetGround: boolean;
  /** The rain batch exists (it is built by the first frame after the terrain). */
  readonly rainBatch: boolean;
  /** `groundMat.defines.THEME_WET` is present: the wet ground PROGRAM is compiled (what `wet-program` removes). */
  readonly wetDefine: boolean;
  /** The preset allows ripples (`RenderQuality.rain.ripples`). */
  readonly ripplesAllowed: boolean;
  readonly reducedMotion: boolean;
  /** `sun.shadow.mapSize.x` now (the stepped size under rain), or null with no sun. */
  readonly shadowCurrent: number | null;
  /** The preset's own `shadowMapSize`, or null when the page carries no quality. */
  readonly shadowPreset: number | null;
}

const YES: Resolution = { resolves: true };
const no = (reason: NaReason): Resolution => ({ resolves: false, reason });

/**
 * Which wet configs have something to act on. A debug layer always RESOLVES BY
 * NAME (`setDebugLayerVisible` accepts it on any map); this asks whether hiding
 * it can change a frame. `wet-all` is the budget-bearing A/B and needs only the
 * wet ground; `shadow-full` needs a step to undo (4096 -> 2048 and 2048 -> 1024
 * have one; `low`'s 1024 -> 1024 has none, so its saving is a true zero, not a
 * missing reading).
 */
export function resolveWetConfigs(f: WetFacts): Record<WetConfigName, Resolution> {
  const wetGround = f.rainMap && f.wetGround;
  const layer = (ok: Resolution): Resolution => (wetGround ? ok : no('dry-map'));
  const rain: Resolution = !f.rainMap ? no('dry-map') : !f.rainBatch ? no('no-rain-batch') : f.reducedMotion ? no('reduced-motion') : YES;
  const ripples: Resolution = !wetGround ? no('dry-map') : f.reducedMotion ? no('reduced-motion') : !f.ripplesAllowed ? no('ripples-off') : YES;
  const shadowFull: Resolution = !f.rainMap
    ? no('dry-map')
    : f.shadowCurrent === null
      ? no('no-sun')
      : f.shadowPreset === null
        ? no('no-quality')
        : f.shadowPreset <= f.shadowCurrent
          ? no('no-shadow-step')
          : YES;
  const wetProgram: Resolution = !wetGround ? no('dry-map') : !f.wetDefine ? no('no-wet-define') : YES;
  return { rain, wet: layer(YES), marsh: layer(YES), ripples, 'wet-all': layer(YES), 'wet-program': wetProgram, 'shadow-full': shadowFull };
}

// ---------------------------------------------------------------------------
// Arithmetic and rows
// ---------------------------------------------------------------------------

export function medianOf(v: readonly number[]): number {
  if (v.length === 0) throw new Error('fx-cost: median of no readings');
  return [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] as number;
}

/**
 * The median of `a[i] - b[i]` over rounds: a config's cost against the baseline taken in the SAME
 * round, a few frames apart. The medians-then-subtract form (`deltaRow`) lets a drift that is slow
 * against a round but fast against a run (the machine's clock, a thermal step) land in one config
 * and not the other; pairing cancels it. The two arrays must be the same length.
 */
export function pairedMedian(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) throw new Error(`fx-cost: pairedMedian wants equal lengths, got ${a.length} and ${b.length}`);
  return medianOf(a.map((v, i) => v - (b[i] as number)));
}

/** The p-th quantile (0..1) by nearest rank. */
export function quantileOf(v: readonly number[], p: number): number {
  if (v.length === 0) throw new Error('fx-cost: quantile of no readings');
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))] as number;
}

/**
 * The block-paired NET (`--pairs`): each cell holds the per-block differences `config - baseline`
 * of ABBA blocks, so gross is `-median(off diffs)` (the "off" frame is the cheaper one) and the
 * saving is `median(shadow-full diffs)` (the full map is the dearer one). Pooled over every cell
 * of the view.
 */
export function blockPairedNet(i: {
  readonly offDiffs: readonly number[] | null;
  readonly shadowFullDiffs: readonly number[] | null;
}): { readonly gross: number; readonly saving: number; readonly net: number } | null {
  if (i.offDiffs === null) return null;
  const gross = -medianOf(i.offDiffs);
  const saving = i.shadowFullDiffs === null ? 0 : medianOf(i.shadowFullDiffs);
  return { gross, saving, net: gross - saving };
}

/** The paired NET: gross and saving each a paired median over the rounds (round-adjacent frames),
 *  then `net = gross - saving`. `null` per part when that config did not resolve, as `netFrom`. */
export function pairedTotalNet(i: {
  readonly base: readonly number[];
  readonly off: readonly number[] | null;
  readonly shadowFull: readonly number[] | null;
}): { readonly gross: number; readonly saving: number; readonly net: number } | null {
  if (i.off === null) return null;
  const gross = pairedMedian(i.base, i.off);
  const saving = i.shadowFull === null ? 0 : pairedMedian(i.shadowFull, i.base);
  return { gross, saving, net: gross - saving };
}

export type DeltaRow = { readonly kind: 'delta'; readonly value: number } | { readonly kind: 'na'; readonly reason: NaReason };

/** A config's delta against the baseline median: a number only when the config
 *  resolved on this tree, `n/a` (with the reason) otherwise. Never a 0 for "had
 *  nothing to act on". */
export function deltaRow(baseMed: number, med: number, resolution: Resolution): DeltaRow {
  return resolution.resolves ? { kind: 'delta', value: med - baseMed } : { kind: 'na', reason: resolution.reason };
}

export function formatDelta(row: DeltaRow): string {
  return row.kind === 'delta' ? `delta ${row.value.toFixed(2)}` : `delta n/a (${row.reason})`;
}

export interface NetInput {
  /** The booted frame (wet layers on, the step applied), median ms. */
  readonly base: number;
  /** The frame with all four wet layers hidden (uniforms zeroed, the wet program still compiled). */
  readonly wetAll: { readonly med: number; readonly resolution: Resolution };
  /** The frame with the wet ground program itself removed (and the rain and ripples hidden). */
  readonly wetProgram: { readonly med: number; readonly resolution: Resolution };
  /** The frame with the shadow map back at the preset's own size. */
  readonly shadowFull: { readonly med: number; readonly resolution: Resolution };
}

export type NetCost =
  | { readonly kind: 'na'; readonly reason: NaReason }
  | { readonly kind: 'net'; readonly gross: number; readonly saving: number; readonly net: number; readonly stepless: boolean };

function netFrom(base: number, off: { readonly med: number; readonly resolution: Resolution }, shadowFull: NetInput['shadowFull']): NetCost {
  if (!off.resolution.resolves) return { kind: 'na', reason: off.resolution.reason };
  const gross = base - off.med;
  const sf = shadowFull.resolution;
  if (!sf.resolves) {
    if (sf.reason !== 'no-shadow-step') return { kind: 'na', reason: sf.reason };
    return { kind: 'net', gross, saving: 0, net: gross, stepless: true };
  }
  const saving = shadowFull.med - base;
  return { kind: 'net', gross, saving, net: gross - saving, stepless: false };
}

/**
 * gross  = booted frame - the "off" frame            (what was switched off cost)
 * saving = shadow-full frame - booted frame           (what the shadow step buys back)
 * net    = gross - saving
 *
 * `netCost` is the LAYER net: "off" is `wet-all`, which leaves the compiled wet program
 * running, so it understates the package (it excludes the standing wet-program cost). It is
 * reported for the layer breakdown and carries no budget verdict. `totalNetCost` is the
 * number the budgets apply to: "off" is `wet-program`.
 *
 * An unresolved "off" makes the line `n/a`. A shadow-full with no step to undo
 * (`no-shadow-step`, `low`) is a true zero saving, flagged `stepless`; any other unresolved
 * shadow-full is `n/a`, never a silent 0 saving.
 */
export function netCost(i: NetInput): NetCost {
  return netFrom(i.base, i.wetAll, i.shadowFull);
}

export function totalNetCost(i: NetInput): NetCost {
  return netFrom(i.base, i.wetProgram, i.shadowFull);
}

function netTerms(n: Extract<NetCost, { kind: 'net' }>): string {
  return `${n.net.toFixed(2)} ms = gross ${n.gross.toFixed(2)} - saving ${n.saving.toFixed(2)}${n.stepless ? ' (no shadow step on this preset)' : ''}`;
}

/** `NET (layers)`: no budget verdict, and says why. */
export function formatNetLayers(n: NetCost): string {
  if (n.kind === 'na') return `NET (layers) n/a (${n.reason})`;
  return `NET (layers) ${netTerms(n)}  [layer-toggle cost, excludes the standing wet-program cost; no budget applies]`;
}

/** `NET (total wet)`: the budget-bearing line. */
export function formatNetTotal(preset: Preset, n: NetCost): string {
  if (n.kind === 'na') return `NET (total wet) n/a (${n.reason})`;
  const budget = WET_BUDGET_MS[preset];
  return `NET (total wet) ${netTerms(n)}  budget +${budget.toFixed(1)} ms: ${n.net <= budget ? 'within' : 'OVER'}`;
}

/** `os.loadavg()` before and after one preset, beside its rows. */
export function formatLoadLine(preset: string, before: readonly number[], after: readonly number[]): string {
  const f = (v: readonly number[]): string => v.map((x) => x.toFixed(1)).join('/');
  return `load ${preset} before ${f(before)} after ${f(after)}`;
}
