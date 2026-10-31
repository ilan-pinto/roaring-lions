/**
 * The pure half of `ground-captures.ts`' S-L2 options (GH-871 P4 T12): `--quality`, `--ticks`,
 * `--motion`, `--clip`, `--stops`, `--zooms`, the per-frame rain-density label and the read-back
 * assertions. Nothing here touches a browser: a test drives every function with plain data, and
 * the page scripts are raw strings the test runs against a fake `window`.
 *
 * It is a separate file so `ground-captures.ts` (which boots a browser when run) stays a thin
 * shell around decisions a unit test can see. It imports nothing from `ground-captures.ts`.
 *
 * ## What each read-back is for
 *
 * The run is announced once and is expensive to repeat, so every option that changes how the
 * renderer BOOTS is checked against the renderer's own answer, not the flag we passed:
 *
 *  - a quality preset applies at boot (`main.ts` reads `settings.video.quality` once), and the
 *    seed that selects it is `musicOffInitScript`'s `video` override, never a hand-written
 *    `lions.settings`. The read-back is the drop count the booted `opts.quality.rain` carries and,
 *    on a wet map, the instance count of the live `RainBatch`;
 *  - reduced motion is `data-motion="reduce"` (the same seed's `accessibility.motion`), read back
 *    as the renderer's OWN `opts.reducedMotion()` answer and the rain mesh's `visible` flag.
 */
import { dimetricCamera } from '../../../packages/render/src/three/camera';
import { mapEdgeFade, dropKeepSeed, dropLanding, dropPosition, dropSeed } from '../../../packages/render/src/three/units/rain-maths';
import { RAIN_FALL_SPEED } from '../../../packages/render/src/three/weather';

// ============================================================================
// Option parsing
// ============================================================================

export type Preset = 'high' | 'medium' | 'low';
export const PRESET_IDS: readonly Preset[] = ['high', 'medium', 'low'];

/**
 * The drop count each preset must boot with: the SHIPPED ladder (`RAIN_LADDER` after the cost
 * run's first step, low 1,500 -> 900). A literal on purpose: it is the oracle the booted renderer is
 * read back against, and `ground-captures.test.ts` pins it to `QUALITY_PRESETS` so a deliberate
 * ladder move turns that one test red, not the capture.
 */
export const EXPECTED_RAIN_DROPS: Readonly<Record<Preset, number>> = { high: 6000, medium: 3500, low: 900 };

/** The zoom the tick strip is photographed at (the sheet's page 2). */
export const TICK_STRIP_ZOOM = 1.6;
/** The zoom the infantry stops are photographed at. */
export const STOP_ZOOM = 2.5;
/** The zoom the clip is recorded at. */
export const CLIP_ZOOM = 1.6;
/** The most ticks a strip may take (a typo of 600 would photograph for ten minutes). */
export const TICKS_MAX = 60;
/** The longest clip, seconds. */
export const CLIP_MAX_SECONDS = 60;

function items(raw: string): string[] {
  return raw.split(',').map((v) => v.trim()).filter((v) => v.length > 0);
}

/** `--quality=high,medium,low`, in the order typed, no repeats. */
export function parsePresets(raw: string): Preset[] {
  const out: Preset[] = [];
  for (const item of items(raw)) {
    if (!(PRESET_IDS as readonly string[]).includes(item)) throw new Error(`--quality wants high, medium or low, got "${item}"`);
    if (out.includes(item as Preset)) throw new Error(`--quality names ${item} twice: its views would share a file name`);
    out.push(item as Preset);
  }
  if (out.length === 0) throw new Error('--quality wants at least one preset, e.g. --quality=high,medium,low');
  return out;
}

/** `--ticks=<n>`: a whole number of one-tick frames, 1..`TICKS_MAX`. */
export function parseTicks(raw: string): number {
  if (!/^\d+$/.test(raw.trim())) throw new Error(`--ticks wants a whole number of frames, got "${raw}"`);
  const n = Number(raw);
  if (n < 1 || n > TICKS_MAX) throw new Error(`--ticks wants 1..${TICKS_MAX}, got ${n}`);
  return n;
}

/** `--motion=reduce`: the only value. (`system` is what every other pass is.) */
export function parseMotion(raw: string): 'reduce' {
  if (raw.trim() !== 'reduce') throw new Error(`--motion only takes "reduce", got "${raw}"`);
  return 'reduce';
}

/** `--clip=<seconds>`: a positive number of seconds, at most `CLIP_MAX_SECONDS`. */
export function parseClip(raw: string): number {
  const v = Number(raw);
  if (!Number.isFinite(v) || v <= 0 || v > CLIP_MAX_SECONDS) throw new Error(`--clip wants 0..${CLIP_MAX_SECONDS} seconds, got "${raw}"`);
  return v;
}

export type StopKind = 'road' | 'water' | 'grass';
export const STOP_KINDS: readonly StopKind[] = ['road', 'water', 'grass'];

/** `--stops=road,water,grass`: the tile kinds the squad is walked onto, in the order typed. */
export function parseStops(raw: string): StopKind[] {
  const out: StopKind[] = [];
  for (const item of items(raw)) {
    if (!(STOP_KINDS as readonly string[]).includes(item)) throw new Error(`--stops wants road, water or grass, got "${item}"`);
    if (out.includes(item as StopKind)) throw new Error(`--stops names ${item} twice: its view would share a file name`);
    out.push(item as StopKind);
  }
  if (out.length === 0) throw new Error('--stops wants at least one kind, e.g. --stops=road,water,grass');
  return out;
}

/** `--zooms=1,1.6,2.5`: the zooms each marker is photographed at (default 1 and 2.5). */
export function parseZooms(raw: string): number[] {
  const out: number[] = [];
  for (const item of items(raw)) {
    const v = Number(item);
    if (!Number.isFinite(v) || v <= 0 || v > 8) throw new Error(`--zooms wants zooms in (0, 8], got "${item}"`);
    if (out.includes(v)) throw new Error(`--zooms names ${v} twice ("${item}"): the views would share a file name`);
    out.push(v);
  }
  if (out.length === 0) throw new Error('--zooms wants at least one zoom, e.g. --zooms=1,1.6,2.5');
  return out;
}

// ============================================================================
// Passes and names
// ============================================================================

/** One browser boot: a preset, a motion setting, and the suffix its views carry. */
export interface Pass {
  readonly preset: Preset;
  readonly reduced: boolean;
  /** `''` for the baseline, `-<preset>` for a preset pass, `-reduced` for the reduced pass. */
  readonly suffix: string;
  /** The baseline pass takes every view, the layer cost, the reflect, tick, wade and stop frames;
   *  the others take the marker views only. */
  readonly full: boolean;
}

/**
 * The boots a run makes, in order: the baseline (today's run, at `high`), then one per
 * `--quality` preset, then the reduced-motion pass (at `high`). A run with neither option is the
 * baseline alone, which is the run it always was.
 */
export function planPasses(opts: { readonly quality?: readonly Preset[]; readonly motion?: 'reduce' }): readonly Pass[] {
  const passes: Pass[] = [{ preset: 'high', reduced: false, suffix: '', full: true }];
  for (const preset of opts.quality ?? []) passes.push({ preset, reduced: false, suffix: `-${preset}`, full: false });
  if (opts.motion === 'reduce') passes.push({ preset: 'high', reduced: true, suffix: '-reduced', full: false });
  return passes;
}

/** `<view>-<preset>` / `<view>-reduced`: the suffix is what keeps two passes' frames in two files. */
export function suffixName(viewName: string, suffix: string): string {
  return `${viewName}${suffix}`;
}

/** `<view>-t<tick>`: the sim tick the frame was drawn at. */
export function tickName(viewName: string, tick: number): string {
  return `${viewName}-t${tick}`;
}

/** `<map>-squad-<kind>`. */
export function stopName(mapId: string, kind: StopKind): string {
  return `${mapId}-squad-${kind}`;
}

/** The views of a pass other than the baseline: the marker views only, each renamed with the
 *  pass's suffix. `isMarkerView` is `ground-captures.ts`' own test of "a marker view" (the name
 *  starts `<map>-<marker>-z`). */
export function suffixedViews<V extends { readonly name: string }>(
  views: readonly V[],
  mapId: string,
  wanted: readonly string[],
  suffix: string
): V[] {
  const out: V[] = [];
  for (const marker of wanted) {
    for (const v of views) {
      if (v.name.startsWith(`${mapId}-${marker}-z`)) out.push({ ...v, name: suffixName(v.name, suffix) });
    }
  }
  return out;
}

/** Every file name a run will write must be distinct: a repeat would overwrite its own frame. */
export class NameClaims {
  private readonly seen = new Set<string>();
  claim(name: string): string {
    if (this.seen.has(name)) throw new Error(`ground-capture: two views are named "${name}": the second would overwrite the first`);
    this.seen.add(name);
    return name;
  }
  get size(): number {
    return this.seen.size;
  }
}

/** The failures a run can only see at the end: a requested mode that took no frame. Each string is
 *  one ERROR line; empty means the run took everything it was asked for. */
export function requestedModeFailures(
  asked: { readonly quality?: readonly Preset[]; readonly ticks?: number; readonly motion?: 'reduce'; readonly clip?: number; readonly stops?: readonly StopKind[] },
  took: {
    readonly presetFrames: Readonly<Record<string, number>>;
    readonly tickFrames: number;
    readonly reducedFrames: number;
    readonly clipPath: string | null;
    readonly stopFrames: Readonly<Record<string, number>>;
  }
): string[] {
  const out: string[] = [];
  for (const p of asked.quality ?? []) {
    if ((took.presetFrames[p] ?? 0) === 0) out.push(`--quality=${p} was given but no ${p} frame was taken (no map in --maps had a marker view)`);
  }
  if (asked.ticks !== undefined && took.tickFrames === 0) {
    out.push(`--ticks=${asked.ticks} was given but no tick frame was taken (a marker view at zoom ${TICK_STRIP_ZOOM} is needed: add --zooms=...,${TICK_STRIP_ZOOM})`);
  }
  if (asked.motion === 'reduce' && took.reducedFrames === 0) out.push('--motion=reduce was given but no reduced frame was taken (no map in --maps had a marker view)');
  if (asked.clip !== undefined && took.clipPath === null) out.push(`--clip=${asked.clip} was given but no clip was written`);
  for (const k of asked.stops ?? []) {
    if ((took.stopFrames[k] ?? 0) === 0) out.push(`--stops=${k} was given but no ${k} stop frame was taken`);
  }
  return out;
}

// ============================================================================
// Infantry stops: the tiles
// ============================================================================

const GLYPH: Readonly<Record<StopKind, string>> = { road: 'r', water: '~', grass: '.' };

/** How many of a tile's 8 neighbours are NOT `glyph` (off the map counts as not). */
export function nonKindNeighbours(rows: readonly string[], x: number, y: number, glyph: string): number {
  let n = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (rows[y + dy]?.[x + dx] !== glyph) n++;
    }
  }
  return n;
}

export interface StopTile {
  readonly tile: [number, number];
  /** The tile's non-matching neighbours: 0 means the squad truly stands in the kind. */
  readonly nonKind: number;
}

/**
 * The tile of `kind` to walk the squad to, near `from` (a marker tile): the nearest tile whose
 * glyph is the kind's (`r`, `~`, `.`). A ROAD tile is the nearest road tile (a road is one lane
 * wide on the wetland maps, so no interior is asked of it). WATER and GRASS prefer the interior:
 * the fewest non-matching neighbours first (0 when any exists: every one of its 8 neighbours is
 * the same kind), then nearest by squared distance, ties to the lowest (y, x). `null` when the map
 * has no tile of the kind. The caller prints `nonKind` when it is above 0.
 */
export function stopTile(rows: readonly string[], from: readonly [number, number], kind: StopKind): StopTile | null {
  const glyph = GLYPH[kind];
  let best: StopTile | null = null;
  let bestKey: [number, number] | null = null;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] !== glyph) continue;
      const nonKind = kind === 'road' ? 0 : nonKindNeighbours(rows, x, y, glyph);
      const d = (x - from[0]) ** 2 + (y - from[1]) ** 2;
      const key: [number, number] = [nonKind, d];
      // Row-major scan, strictly better only: the first of equals is already the lowest (y, x).
      if (bestKey === null || key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) {
        bestKey = key;
        best = { tile: [x, y], nonKind: kind === 'road' ? nonKindNeighbours(rows, x, y, glyph) : nonKind };
      }
    }
  });
  return best;
}

// ============================================================================
// Infantry stops: arrival, settling, and what the squad stands on
// ============================================================================

/** A road is one lane wide and an interior water or grass tile has a one-tile margin, so a stop
 *  only counts when the lead entity is within this many tiles of the tile's CENTRE. (The wade's
 *  1.5 is for "somewhere in the marsh"; at 1.5 the squad is probably not on a one-lane road.) */
export const STOP_ARRIVE_TILES = 0.3;
/** The wade's looser tolerance, kept to tell "close but not on the tile" from "never got there". */
export const STOP_NEAR_TILES = 1.5;
/** Ticks between polls of the squad's position while it walks to a stop (the wade polls every 20). */
export const STOP_POLL_TICKS = 5;
/** Ticks stepped after arrival so the squad settles out of its stride before the frame. */
export const STOP_SETTLE_TICKS = 20;
/** The squad has stalled when it moved less than this many tiles over this many polls in a row. */
export const STOP_STALL_MOVE = 0.01;
export const STOP_STALL_POLLS = 3;

/** The glyph a stop of `kind` must be standing on (`r` road, `~` water, `.` open ground). */
export function stopGlyph(kind: StopKind): string {
  return GLYPH[kind];
}

/** The glyph under a position in tiles (`''` off the map). */
export function standsOn(rows: readonly string[], pos: { readonly x: number; readonly y: number }): string {
  return rows[Math.floor(pos.y)]?.[Math.floor(pos.x)] ?? '';
}

function within(pos: { readonly x: number; readonly y: number }, tile: readonly [number, number], tol: number): boolean {
  return Math.hypot(pos.x - (tile[0] + 0.5), pos.y - (tile[1] + 0.5)) <= tol;
}

export type StopOutcome = 'ARRIVED' | 'DID NOT SETTLE' | 'DID NOT ARRIVE';

/** Within `STOP_ARRIVE_TILES` of the tile's centre is ARRIVED; within `STOP_NEAR_TILES` only, DID NOT
 *  SETTLE (the frame is off the requested tile); further, DID NOT ARRIVE. */
export function stopOutcome(pos: { readonly x: number; readonly y: number }, tile: readonly [number, number]): StopOutcome {
  if (within(pos, tile, STOP_ARRIVE_TILES)) return 'ARRIVED';
  return within(pos, tile, STOP_NEAR_TILES) ? 'DID NOT SETTLE' : 'DID NOT ARRIVE';
}

/** The squad truly stands on the stop: tight to the tile's centre AND the glyph under it is the
 *  kind's. (The glyph check is the one that catches a tile picked wrongly or a map that moved.) */
export function isOnStop(
  rows: readonly string[],
  kind: StopKind,
  tile: readonly [number, number],
  pos: { readonly x: number; readonly y: number }
): boolean {
  return stopOutcome(pos, tile) === 'ARRIVED' && standsOn(rows, pos) === GLYPH[kind];
}

/** The consecutive-stalled-polls count after a poll: one more if the squad moved under
 *  `STOP_STALL_MOVE` tiles since the last, else back to 0. */
export function nextStall(count: number, prev: { readonly x: number; readonly y: number }, cur: { readonly x: number; readonly y: number }): number {
  return Math.hypot(cur.x - prev.x, cur.y - prev.y) < STOP_STALL_MOVE ? count + 1 : 0;
}

// ============================================================================
// The rain-density label
// ============================================================================

/** An IEEE half float's bits as a number (the R16F texel `RainBatch` bakes the ground into). */
export function halfToFloat(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exp = (bits >> 10) & 0x1f;
  const mant = bits & 0x3ff;
  if (exp === 0) return sign * 2 ** -14 * (mant / 1024);
  if (exp === 31) return mant === 0 ? sign * Infinity : Number.NaN;
  return sign * 2 ** (exp - 15) * (1 + mant / 1024);
}

/** The ground-height texture as the shader samples it: `RainBatch`'s texels (four a tile, row =
 *  z), bilinear, clamped to the edge, at `land / mapSize`. */
export function makeHeightSampler(
  texels: ArrayLike<number>,
  mapW: number,
  mapH: number,
  texelsPerTile = 4
): (x: number, z: number) => number {
  const w = mapW * texelsPerTile;
  const h = mapH * texelsPerTile;
  if (texels.length !== w * h) throw new Error(`ground-capture: height texture has ${texels.length} texels, expected ${w * h} for a ${mapW}x${mapH} map`);
  const at = (i: number, j: number): number => texels[Math.min(h - 1, Math.max(0, j)) * w + Math.min(w - 1, Math.max(0, i))];
  return (x, z) => {
    const fx = Math.min(1, Math.max(0, x / mapW)) * w - 0.5;
    const fz = Math.min(1, Math.max(0, z / mapH)) * h - 0.5;
    const i0 = Math.floor(fx);
    const j0 = Math.floor(fz);
    const tx = fx - i0;
    const tz = fz - j0;
    return (at(i0, j0) * (1 - tx) + at(i0 + 1, j0) * tx) * (1 - tz) + (at(i0, j0 + 1) * (1 - tx) + at(i0 + 1, j0 + 1) * tx) * tz;
  };
}

/** What the count needs, all read from the page: the batch's own uniforms, the camera and the
 *  canvas. */
export interface DensityInput {
  /** The instance count (`RainBatch.drops`). */
  readonly drops: number;
  /** `uLow`, `uPeriod`, `uKeep`, `uFall` as the shader read them on the frame just drawn. */
  readonly low: { readonly x: number; readonly z: number };
  readonly period: number;
  /** `uKeep`: an instance whose `dropKeepSeed` is at or above it is not drawn (S-L2 ruling 2). */
  readonly keep: number;
  readonly fall: number;
  readonly mapW: number;
  readonly mapH: number;
  /** The camera and the CSS canvas the frame was drawn through. */
  readonly view: { readonly x: number; readonly y: number; readonly zoom: number; readonly width: number; readonly height: number };
  /** The ground height at a landing point. */
  readonly ground: (x: number, z: number) => number;
}

/**
 * How many drops have their HEAD on screen: every seed's lattice landing point and fall phase from
 * the batch's uniforms, the head from `dropPosition` (the CPU mirror of the vertex shader), the
 * drop kept when its keep seed is under `uKeep` (the ruling's density hold) and `mapEdgeFade` leaves it any alpha, and its head projected through the real
 * dimetric camera (`updateDimetricCamera`) into the canvas rectangle. Occlusion is not modelled
 * (a roof hiding a drop still counts) and the seeds are the maths' float64 ones, where the page's
 * are float32: the count is exact for the geometry, not a pixel readback.
 */
export function onScreenDropCount(input: DensityInput): number {
  const { view } = input;
  // The real camera (`three` itself is not a dependency of `tools`; its matrices are read as arrays).
  const cam = dimetricCamera({ x: view.x, y: view.y, zoom: view.zoom }, { width: view.width, height: view.height });
  const v = cam.matrixWorldInverse.elements;
  const pr = cam.projectionMatrix.elements;
  const tSec = input.fall / RAIN_FALL_SPEED;
  let n = 0;
  for (let i = 0; i < input.drops; i++) {
    if (dropKeepSeed(i) >= input.keep) continue;
    const seed = dropSeed(i);
    const land = dropLanding(seed, input.low, input.period);
    if (mapEdgeFade(land.x, land.z, input.mapW, input.mapH) <= 0) continue;
    const head = dropPosition(seed, input.low, input.period, tSec, input.ground(land.x, land.z));
    // view space, then clip space (orthographic: w stays 1); column-major matrices.
    const ex = v[0] * head.x + v[4] * head.y + v[8] * head.z + v[12];
    const ey = v[1] * head.x + v[5] * head.y + v[9] * head.z + v[13];
    const ez = v[2] * head.x + v[6] * head.y + v[10] * head.z + v[14];
    const ndcX = pr[0] * ex + pr[4] * ey + pr[8] * ez + pr[12];
    const ndcY = pr[1] * ex + pr[5] * ey + pr[9] * ez + pr[13];
    const sx = ((ndcX + 1) / 2) * view.width;
    const sy = ((1 - ndcY) / 2) * view.height;
    if (sx >= 0 && sx <= view.width && sy >= 0 && sy <= view.height) n++;
  }
  return n;
}

// ============================================================================
// The page reads, and what they must say
// ============================================================================

/** What `READ_RENDER_SCRIPT` returns. */
export interface RenderRead {
  readonly weather: 'rain' | 'clear' | null;
  /** `opts.quality.rain.drops`, or null when the quality object carries no rain row. */
  readonly qualityDrops: number | null;
  readonly reduced: boolean;
  readonly motionAttr: string | null;
  readonly rain: {
    readonly drops: number;
    readonly visible: boolean;
    readonly period: number;
    readonly keep: number;
    readonly fall: number;
    readonly low: { readonly x: number; readonly z: number };
    readonly mapW: number;
    readonly mapH: number;
  } | null;
  readonly view: { readonly x: number; readonly y: number; readonly zoom: number; readonly width: number; readonly height: number };
  readonly tick: number;
}

/**
 * The renderer's own answers, read off `window.__lions.renderer`'s private fields (plain properties
 * at runtime, as `groundMat` is for `READ_TUNING_SCRIPT`). A field that is missing THROWS naming
 * it: a renamed private must not read as "no rain", which would pass every assertion vacuously and
 * still exit 0 on a run that is announced once.
 */
export const READ_RENDER_SCRIPT = `(() => {
  const r = window.__lions.renderer;
  const need = (ok, what) => { if (!ok) throw new Error('ground-capture: renderer.' + what + ' is missing: tree changed'); };
  need(r.opts && typeof r.opts === 'object', 'opts');
  need(typeof r.opts.reducedMotion === 'function', 'opts.reducedMotion');
  need(typeof r.cssWidth === 'number' && typeof r.cssHeight === 'number', 'cssWidth/cssHeight');
  need(r.camera && typeof r.camera.zoom === 'number', 'camera');
  need(window.__lions.sim && typeof window.__lions.sim.tickCount === 'number', 'sim.tickCount (on __lions)');
  const q = r.opts.quality;
  let rain = null;
  if (r.rain) {
    need(r.rain.mesh && r.rain.mesh.material && r.rain.mesh.material.uniforms, 'rain.mesh.material.uniforms');
    const u = r.rain.mesh.material.uniforms;
    need(u.uFall && u.uLow && u.uPeriod && u.uKeep, 'rain uniforms uFall/uLow/uPeriod/uKeep');
    // A keep that is not a finite number would count every drop (NaN compares false) and print a
    // plausible density: fail loud instead.
    need(typeof u.uKeep.value === 'number' && Number.isFinite(u.uKeep.value), 'rain uniform uKeep (a finite number)');
    need(typeof r.rain.mapWidth === 'number' && typeof r.rain.mapHeight === 'number', 'rain.mapWidth/mapHeight');
    rain = {
      drops: r.rain.drops, visible: r.rain.mesh.visible === true, period: u.uPeriod.value, keep: u.uKeep.value, fall: u.uFall.value,
      low: { x: u.uLow.value.x, z: u.uLow.value.y }, mapW: r.rain.mapWidth, mapH: r.rain.mapHeight,
    };
  }
  return JSON.stringify({
    weather: r.opts.weather === undefined ? null : r.opts.weather,
    qualityDrops: q && q.rain && typeof q.rain.drops === 'number' ? q.rain.drops : null,
    reduced: r.opts.reducedMotion() === true,
    motionAttr: document.documentElement.dataset.motion === undefined ? null : document.documentElement.dataset.motion,
    rain,
    view: { x: r.camera.x, y: r.camera.y, zoom: r.camera.zoom, width: r.cssWidth, height: r.cssHeight },
    tick: window.__lions.sim.tickCount,
  });
})()`;

/** The height texels of the live batch (half-float bits) and its map, read once per boot. */
export const READ_RAIN_HEIGHTS_SCRIPT = `(() => {
  const b = window.__lions.renderer.rain;
  if (!b) return JSON.stringify(null);
  if (!b.heightData || typeof b.heightData.length !== 'number') throw new Error('ground-capture: renderer.rain.heightData is missing: tree changed');
  return JSON.stringify({ w: b.mapWidth, h: b.mapHeight, bits: Array.from(b.heightData) });
})()`;

/** Where an entity stands on the screen, CSS px (`renderer.worldToScreen` on its tile position). */
export function squadScreenScript(id: number): string {
  return `(() => {
  const L = window.__lions;
  if (typeof L.renderer.worldToScreen !== 'function') throw new Error('ground-capture: renderer.worldToScreen is missing: tree changed');
  const s = L.sim.state;
  const p = L.renderer.worldToScreen(s.posX[${id}] / 65536, s.posY[${id}] / 65536);
  return JSON.stringify([p.x, p.y]);
})()`;
}

/** A frame's rain label, as `cost.json` and the printed line carry it. */
export interface RainLabel {
  /** Drops with a head on screen and any alpha; 0 while the batch is hidden. */
  readonly onScreen: number;
  /** The preset's drop total (`RainBatch.drops`). */
  readonly total: number;
  /** The lattice period P, tiles. */
  readonly period: number;
  /** The keep fraction `uKeep`, `(0, 1]`. */
  readonly keep: number;
  readonly visible: boolean;
}

/** The label for a frame: `null` when the renderer has no rain batch (a dry map, or 0 drops). */
export function rainLabel(read: RenderRead, heights: ((x: number, z: number) => number) | null): RainLabel | null {
  if (read.rain === null) return null;
  if (heights === null) throw new Error('ground-capture: the renderer has a rain batch but its height texels were not read');
  const r = read.rain;
  const onScreen = r.visible
    ? onScreenDropCount({ drops: r.drops, low: r.low, period: r.period, keep: r.keep, fall: r.fall, mapW: r.mapW, mapH: r.mapH, view: read.view, ground: heights })
    : 0;
  return { onScreen, total: r.drops, period: r.period, keep: r.keep, visible: r.visible };
}

/**
 * A pass booted at `preset` must READ BACK that preset: the booted quality's rain row carries the
 * ladder's drop count, and on a wet map the live batch has that many instances. Throws naming the
 * pass otherwise (the preset applies at boot; there is no second chance in the run).
 */
export function assertPresetBooted(preset: Preset, read: RenderRead): void {
  const want = EXPECTED_RAIN_DROPS[preset];
  if (read.qualityDrops !== want) {
    throw new Error(`ground-capture: booted for ${preset} (rain drops ${want}) but the renderer's quality carries ${String(read.qualityDrops)}`);
  }
  if (read.weather === 'rain') {
    if (read.rain === null) throw new Error(`ground-capture: ${preset} on a wet map but the renderer has no rain batch`);
    if (read.rain.drops !== want) {
      throw new Error(`ground-capture: booted for ${preset} (rain drops ${want}) but the rain batch has ${read.rain.drops} instances`);
    }
  }
}

/**
 * The motion setting of a pass, read back from the renderer: a `-reduced` pass must read reduced
 * motion TRUE (the renderer's own `opts.reducedMotion()`, which is `prefersReducedMotion`, and the
 * `data-motion` attribute behind it) with the rain mesh NOT visible; every other pass must read it
 * false. A wet map must have a batch to read (a missing one would pass `visible === false`
 * vacuously).
 */
export function assertMotion(reduced: boolean, read: RenderRead): void {
  if (read.reduced !== reduced) {
    throw new Error(`ground-capture: a ${reduced ? 'reduced' : 'full'}-motion pass but the renderer's reducedMotion() says ${String(read.reduced)} (data-motion=${String(read.motionAttr)})`);
  }
  if (reduced && read.motionAttr !== 'reduce') {
    throw new Error(`ground-capture: a reduced pass but data-motion is ${String(read.motionAttr)}, not "reduce"`);
  }
  if (read.weather === 'rain') {
    if (read.rain === null) throw new Error('ground-capture: a wet map but the renderer has no rain batch to read the motion off');
    if (reduced && read.rain.visible) throw new Error('ground-capture: a reduced pass but the rain mesh is still visible');
    if (!reduced && !read.rain.visible) throw new Error('ground-capture: a full-motion pass but the rain mesh is not visible');
  }
}
