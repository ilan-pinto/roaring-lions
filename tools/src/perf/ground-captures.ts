/**
 * The ground instrument: `pnpm ground:capture`.
 *
 * Promoted from the WP-A2 spec's §1 audit (a git-ignored script the spec
 * worktree carried at `.superpowers/ground-spec/audit.ts`) so that "costs are
 * measured" is a command in this tree, not a transcription of one run's
 * console output into prose. Same shape as every other `tools/src/perf/*`
 * capture: a pure half a test can drive with plain data, and a browser half
 * that boots the real `ThreeRenderer` on a real dev server, because
 * `gl.info`'s draw-call and triangle counts do not exist outside a real
 * `WebGLRenderer` (see `capture-protocol.ts`'s own header for why nothing
 * here can run under `node`/`jsdom`).
 *
 *   pnpm ground:capture -- --port=5196 --out=.superpowers/ground/t1
 *   pnpm ground:capture -- --port=5196 --out=.superpowers/ground/t1 --maps=qarn_hadid
 *   pnpm ground:capture -- --port=5196 --out=.superpowers/ground/t1 --decals --reuse
 *
 * GH-871 P4 T6 adds three things for the wetland look:
 *
 *   pnpm ground:capture -- --port=5196 --maps=ein_qasab --markers=ein_qasab:causeway_s \
 *     --reflect=0.20,0.25,0.35 --wade=ein_qasab:causeway_s --out=...
 *
 *   --reflect=<v>[,<v>...]  each marker view is photographed again per value, at
 *       `debugSetWetTuning({ puddle: v, marsh: v })` (R-12: a concrete-class debug method
 *       reached through `__lions.renderer`, never the `Renderer` interface), repainted at zero
 *       elapsed time and named `<view>-r<v>`. A map with no wet ground has no uniform to move and
 *       is skipped with a line saying so.
 *   --wade=<map>:<marker>   after that map's ordinary views, the sandbox force's first infantry
 *       entity is ordered to the nearest `~` tile to the marker through `sim.queueCommand` (a
 *       `move` Command, the door `input/intents.ts` ends in; never a state write, invariant 4),
 *       `__lions.step` runs until it arrives or `WADE_TICK_CAP` ticks pass, and the result is
 *       printed. Two views (`<map>-wade-z1`, `-z2.5`) are taken on that tile.
 *   the tick of every frame (and the reflectances it was drawn at) is in `cost.json` and on the
 *       printed line.
 *
 * The port is `--port=<n>`, else GROUND_CAPTURE_PORT, else 5196 (5193-5199
 * only), and a port something already holds is refused before the server
 * starts (`ui-review/port.ts`) unless `--reuse` (or `--attach`) says so.
 *
 * For each map it photographs the centre at four zooms (0.35, 0.5, 1, 2.5 --
 * the 0.5 view is F-16's: Task 5 measures on `<map>-centre-z0.5`), one fogged
 * centre view, and (when the map has any) a close-up of its densest road
 * tile. `cost.json` also carries, per map, the call/triangle delta of hiding
 * each of `COST_LAYERS` one at a time -- the same instrument that answers
 * "what does scatter/decor/units/buildings cost on this map" for a shipped
 * map, and "what would decals cost" once that layer exists.
 *
 * Three differences from the spec's audit, beyond typing `window.__lions`
 * properly instead of `(window as any)`:
 *
 * 1. It refuses to silently measure someone else's dev server. This repo's
 *    hard rule is never to kill a `pnpm dev` this process did not start, and
 *    the ambiguous case -- a server already answering on the port -- is
 *    exactly the one that most needs a name: it prints STARTED or REUSED and,
 *    on a reuse, exits 2 unless `--reuse` was passed. A silent reuse would
 *    let a `--port` pointed at the lead's own server (never 5177 -- see
 *    `tools/src/ui-review/port.ts`'s header) measure the WRONG TREE with no
 *    error at all.
 * 2. `layerCost` skips (rather than throws on) a layer name that does not
 *    resolve on this tree and reports `n/a` for it, so the one tool measures
 *    both main's `scorch` (retired on this branch, D5/R-17) and this
 *    branch's `decals`.
 * 3. `--decals` boots each map with `&decals` appended to the sandbox URL.
 *    Before Task 16 ships the flag, the app only warns about it by name
 *    (`sandbox-help.ts`'s unknown-parameter warning) -- this script does not
 *    special-case that; it is simply what "before Task 16" looks like here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';
import { maps as ALL_MAPS } from '@lions/data';
import type { Command } from '@lions/sim';
import { ensureDevServer, readUnmaskedRenderer, stopDevServer } from '../golden-diff/browser';
import { CAPTURE_VIEWPORT, FREEZE_FRAME_LOOP_SCRIPT, hideHudExceptCanvas } from '../golden-diff/capture-protocol';
import { gpuLaunchArgs } from '../ui-review/gpu';
import { musicOffInitScript } from '../ui-review/music-off';
import { ATTACH_FLAG, decidePort } from '../ui-review/port';

const TAG = 'ground-capture';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../..');

// ============================================================================
// Pure half
// ============================================================================

export interface GroundCaptureArgs {
  readonly port: number;
  readonly out: string;
  readonly maps: readonly string[];
  readonly decals: boolean;
  readonly reuse: boolean;
  /** `--markers=<map>:<marker>[,...]` (GH-871 P2 T8). Absent when the flag is
   *  absent, so a run without it is the run it always was. */
  readonly markers?: readonly MarkerRef[];
  /** `--reflect=` (GH-871 P4 T6): the reflectances to photograph each marker view at. Absent
   *  without the flag. In the order typed, no duplicates, each in 0..1. */
  readonly reflect?: readonly number[];
  /** `--wade=<map>:<marker>` (GH-871 P4 T6). Absent without the flag. */
  readonly wade?: MarkerRef;
}

/** One `<map>:<marker>` pair from `--markers=`. */
export interface MarkerRef {
  readonly map: string;
  readonly marker: string;
}

/** The lead's server is 5177 and the tools own 5173-5182 -- see
 *  `tools/src/ui-review/port.ts`'s header. This instrument's own lane. */
const PORT_MIN = 5193;
const PORT_MAX = 5199;
const DEFAULT_PORT = 5196;
const DEFAULT_OUT = '.superpowers/ground/captures';
const DEFAULT_MAPS: readonly string[] = ['beit_sahwan_outskirts', 'tel_marum', 'qarn_hadid', 'wadi_halam_basin'];

function flag(argv: readonly string[], name: string): string | undefined {
  // Last one wins, matching every other `--name=value` parser in this
  // package (`load-profile.ts`, `port.ts`).
  const hit = [...argv].reverse().find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? undefined : hit.slice(name.length + 3);
}

/** The environment override, the way `ui-review/port.ts` takes one: the flag
 *  wins, then this, then `DEFAULT_PORT`. */
export const GROUND_CAPTURE_PORT_ENV = 'GROUND_CAPTURE_PORT';

export function parseGroundCaptureArgs(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>> = {}
): GroundCaptureArgs {
  const envPort = env[GROUND_CAPTURE_PORT_ENV];
  const rawPort = flag(argv, 'port') ?? (envPort === '' ? undefined : envPort);
  const portRangeMsg = `--port must be ${PORT_MIN}-${PORT_MAX}`;
  let port = DEFAULT_PORT;
  if (rawPort !== undefined) {
    if (!/^\d+$/.test(rawPort)) throw new Error(`${portRangeMsg}, got "${rawPort}"`);
    port = Number(rawPort);
  }
  if (port < PORT_MIN || port > PORT_MAX) throw new Error(`${portRangeMsg}, got ${port}`);

  const out = flag(argv, 'out') ?? DEFAULT_OUT;
  const rawMaps = flag(argv, 'maps');
  const maps =
    rawMaps === undefined
      ? [...DEFAULT_MAPS]
      : rawMaps
          .split(',')
          .map((m) => m.trim())
          .filter((m) => m.length > 0);
  const decals = argv.includes('--decals');
  // `--attach` is the spelling every other harness uses for the same thing.
  const reuse = argv.includes('--reuse') || argv.includes(ATTACH_FLAG);

  const base: GroundCaptureArgs = { port, out, maps, decals, reuse };
  const rawMarkers = flag(argv, 'markers');
  const markers =
    rawMarkers === undefined
      ? undefined
      : rawMarkers
          .split(',')
          .map((m) => m.trim())
          .filter((m) => m.length > 0)
          .map((item) => parseRef('--markers', item, maps));
  const rawReflect = flag(argv, 'reflect');
  const reflect = rawReflect === undefined ? undefined : parseReflect(rawReflect);
  if (reflect !== undefined && markers === undefined) {
    // Nothing to apply it to: say so rather than photograph nothing.
    throw new Error('--reflect repaints the --markers views; pass --markers=<map>:<marker> too');
  }
  const rawWade = flag(argv, 'wade');
  const wade = rawWade === undefined ? undefined : parseRef('--wade', rawWade.trim(), maps);
  return {
    ...base,
    ...(markers === undefined ? {} : { markers }),
    ...(reflect === undefined ? {} : { reflect }),
    ...(wade === undefined ? {} : { wade }),
  };
}

function parseRef(flagName: string, item: string, maps: readonly string[]): MarkerRef {
  const parts = item.split(':');
  const [map, marker] = parts;
  if (parts.length !== 2 || map === undefined || marker === undefined || map === '' || marker === '') {
    throw new Error(`${flagName} wants <map>:<marker>, got "${item}"`);
  }
  // A marker on a map this run does not photograph would be dropped
  // without a word; say so instead.
  if (!maps.includes(map)) throw new Error(`${flagName} names map "${map}" (marker "${marker}") but --maps does not include it`);
  return { map, marker };
}

/** `--reflect=0.20,0.25`: reflectances, 0..1. `0.20` and `0.2` are the same number and the same
 *  view name (`-r0.2`), so a repeat is refused rather than overwriting its own frame. */
function parseReflect(raw: string): number[] {
  const out: number[] = [];
  for (const item of raw.split(',').map((v) => v.trim()).filter((v) => v.length > 0)) {
    const v = Number(item);
    if (!Number.isFinite(v) || v < 0 || v > 1) throw new Error(`--reflect wants reflectances in 0..1, got "${item}"`);
    if (out.includes(v)) throw new Error(`--reflect names ${v} twice ("${item}"): the views would share a file name`);
    out.push(v);
  }
  if (out.length === 0) throw new Error('--reflect wants at least one value, e.g. --reflect=0.25');
  return out;
}

export interface MapView {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
  readonly fog: boolean;
  /** GH-871 P4 T6: when present the view is drawn at this puddle and marsh reflectance
   *  (`debugSetWetTuning`). Absent leaves the tuning as the map booted it. */
  readonly reflect?: number;
}

/** The audit's rule: the road tile with the most road inside Chebyshev radius
 *  3, ties broken by (y, x). Scanning row-major (y ascending, then x
 *  ascending) and keeping the first STRICTLY greater count is what breaks
 *  ties that way for free -- the first tile reached in that order is already
 *  the lowest (y, x) among however many share the winning count. */
export function roadCloseUp(rows: readonly string[]): [number, number] | null {
  const roads: [number, number][] = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === 'r') roads.push([x, y]);
  });
  let best: [number, number] | null = null;
  let bestCount = -1;
  for (const [x, y] of roads) {
    let count = 0;
    for (const [ax, ay] of roads) if (Math.abs(ax - x) <= 3 && Math.abs(ay - y) <= 3) count++;
    if (count > bestCount) {
      bestCount = count;
      best = [x, y];
    }
  }
  return best;
}

/** F-16: a zoom-0.5 centre view alongside 0.35, 1 and 2.5, because Task 5
 *  measures on `<map>-centre-z0.5`. */
const CENTRE_ZOOMS: readonly number[] = [0.35, 0.5, 1, 2.5];

/** The two zooms a marker is photographed at (GH-871 P2 T8): the map-scale
 *  read and the vehicle-scale read. */
const MARKER_ZOOMS: readonly number[] = [1, 2.5];

/** `wanted` is this map's `--markers` names; `table` is the map's own
 *  `markers` (tile x, y). A wanted name absent from the table is an error
 *  naming both, so a typo cannot quietly photograph nothing. Both default to
 *  empty, which leaves the views exactly as they were. The tile goes to the
 *  camera as it is, the same way the centre and road views do (`goto`). */
export function viewsFor(
  mapId: string,
  rows: readonly string[],
  wanted: readonly string[] = [],
  table: Readonly<Record<string, readonly [number, number]>> = {}
): readonly MapView[] {
  const w = rows[0]?.length ?? 0;
  const h = rows.length;
  const cx = Math.floor(w / 2);
  const cy = Math.floor(h / 2);
  const views: MapView[] = CENTRE_ZOOMS.map((zoom) => ({
    name: `${mapId}-centre-z${zoom}-nofog`,
    x: cx,
    y: cy,
    zoom,
    fog: false,
  }));
  views.push({ name: `${mapId}-centre-z1-fog`, x: cx, y: cy, zoom: 1, fog: true });
  const road = roadCloseUp(rows);
  if (road !== null) {
    views.push({ name: `${mapId}-road-z2.5-nofog`, x: road[0], y: road[1], zoom: 2.5, fog: false });
  }
  for (const marker of wanted) {
    const tile = Object.prototype.hasOwnProperty.call(table, marker) ? table[marker] : undefined;
    if (tile === undefined) {
      throw new Error(
        `${TAG}: map "${mapId}" has no marker "${marker}" (have: ${Object.keys(table).join(', ') || 'none'})`
      );
    }
    for (const zoom of MARKER_ZOOMS) {
      views.push({ name: `${mapId}-${marker}-z${zoom}`, x: tile[0], y: tile[1], zoom, fog: false });
    }
  }
  return views;
}

/** `<view>-r<v>` -- the suffix is what keeps two reflectances of one view in two files. */
export function reflectName(viewName: string, reflect: number): string {
  return `${viewName}-r${reflect}`;
}

/** One extra view per (marker view of this map, reflectance), the marker views in `viewsFor`'s
 *  order and the values in the order given. A marker view is the one `viewsFor` names
 *  `<map>-<marker>-z<zoom>`; the centre and road views are not repeated (they carry no marker, and
 *  the lead's A/B is the marker views). */
export function reflectViews(
  mapId: string,
  views: readonly MapView[],
  wanted: readonly string[],
  values: readonly number[]
): readonly MapView[] {
  const out: MapView[] = [];
  for (const marker of wanted) {
    for (const v of views) {
      if (!v.name.startsWith(`${mapId}-${marker}-z`)) continue;
      for (const value of values) out.push({ ...v, name: reflectName(v.name, value), reflect: value });
    }
  }
  return out;
}

/** The `~` tile nearest `from` (a marker tile, x then y): smallest squared distance, ties to the
 *  lowest (y, x), `null` on a map with no `~`. The row scan is row-major and keeps only a STRICTLY
 *  nearer tile, so the first tile reached among equals is already the lowest (y, x). */
export function nearestWaterTile(rows: readonly string[], from: readonly [number, number]): [number, number] | null {
  let best: [number, number] | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] !== '~') continue;
      const d = (x - from[0]) ** 2 + (y - from[1]) ** 2;
      if (d < bestD) {
        bestD = d;
        best = [x, y];
      }
    }
  });
  return best;
}

/** The wade order as the sim's own `Command`: a `move` to the CENTRE of `tile` (Q16.16 tile
 *  units, so `(x + 0.5) * 65536`, an integer). Never a position write (invariant 4). */
export function wadeCommand(ids: readonly number[], tile: readonly [number, number]): Command {
  return { kind: 'move', ids: [...ids], x: tile[0] * FX_ONE + FX_ONE / 2, y: tile[1] * FX_ONE + FX_ONE / 2 };
}

/** The page half of the order: hands the Command to `sim.queueCommand`, the same door the app's
 *  order sink ends in, and does nothing else. A raw string for `page.evaluate`, like
 *  `STATS_SCRIPT`; the test runs it against a fake `window` whose sim state refuses a write. */
export function wadeOrderScript(cmd: Command): string {
  return `((cmd) => { window.__lions.sim.queueCommand(cmd); return true; })(${JSON.stringify(cmd)})`;
}

/** The first living side-0 entity whose type has role `infantry` (lowest id), or -1. Reads only. */
export const FIRST_INFANTRY_SCRIPT = `(() => {
  const sim = window.__lions.sim;
  for (let i = 0; i < sim.entityCount; i++) {
    if (sim.state.alive[i] !== 1 || sim.state.side[i] !== 0) continue;
    if (sim.unitTypes[sim.state.typeIdx[i]].role === 'infantry') return i;
  }
  return -1;
})()`;

/** Where entity `id` stands, in tiles (the Q16.16 position over 65536). Reads only. */
export function positionScript(id: number): string {
  return `(() => {
  const s = window.__lions.sim.state;
  return JSON.stringify({ x: s.posX[${id}] / ${FX_ONE}, y: s.posY[${id}] / ${FX_ONE}, tick: window.__lions.sim.tickCount });
})()`;
}

/** Arrived: within `tol` tiles of the target tile's centre. */
export function hasArrived(pos: { x: number; y: number }, tile: readonly [number, number], tol = WADE_ARRIVE_TILES): boolean {
  return Math.hypot(pos.x - (tile[0] + 0.5), pos.y - (tile[1] + 0.5)) <= tol;
}

/** The two views taken on the wading squad's tile. */
export function wadeViews(mapId: string, tile: readonly [number, number]): readonly MapView[] {
  return [1, 2.5].map((zoom) => ({ name: `${mapId}-wade-z${zoom}`, x: tile[0], y: tile[1], zoom, fog: false }));
}

const FX_ONE = 65536;
/** The wade gives up after this many ticks (30 s of sim at 20 Hz) and says so. */
export const WADE_TICK_CAP = 600;
const WADE_STEP_TICKS = 20;
const WADE_ARRIVE_TILES = 1.5;

/** What `layerCost` measures the price of, in the order it reports them.
 *  `decals` sits before `scorch` deliberately -- see this file's header,
 *  difference 2: after Task 13, on THIS branch `decals` resolves and
 *  `scorch` throws (retired, D5/R-17), and on main it is the other way
 *  round, so the one array measures both trees. `props` (ground plan 2,
 *  Task 5) reads `n/a` on a tree that predates the prop batch, by the same
 *  rule. */
export const COST_LAYERS: readonly string[] = ['scatter', 'decor', 'props', 'units', 'buildings', 'decals', 'scorch'];

// ============================================================================
// Browser half
// ============================================================================

/** Everything this script reaches on `window.__lions`, typed -- never
 *  `(window as any)`. Mirrors the shape other `tools/src/perf/*` capture
 *  scripts already declare for the same dev hook (e.g. `wreck-captures.ts`,
 *  `blast-captures.ts`), trimmed to what this file actually touches. */
interface LionsWindow {
  __lions: {
    goto(x: number, y: number): readonly [number, number] | null;
    /** Runs n sim ticks and repaints; returns the tick it ends on. */
    step(n: number): number;
    sim: { readonly tickCount: number };
    renderer: {
      readonly canvas: HTMLCanvasElement;
      camera: { x: number; y: number; zoom: number };
      frame(alpha: number, dtMs: number): void;
      setDebugLayerVisible(name: string, visible: boolean): number;
      /** ThreeRenderer's concrete-class test knob (R-12): NOT on the `Renderer` interface. */
      debugSetWetTuning?(tuning: { puddle?: number; marsh?: number }): void;
      /** Private on the class, a plain property at runtime; read for the reflectance a frame was
       *  drawn at. `uniforms` carries no wet uniforms on a dry map. */
      groundMat?: { uniforms?: Record<string, { value: number } | undefined> };
    };
  };
}

/** The two reflectances the ground shader is currently drawing with; `null` on a dry map (a
 *  `groundMat` with no wet uniform). A raw string, like `STATS_SCRIPT`, so it reads the same private
 *  field the wet-ground tests do. No `groundMat` object AT ALL is a different answer and THROWS: a
 *  renamed private field must not read as "this map is dry", which would skip every `-r` frame and
 *  still exit 0 (the G-7 run is announced once). */
export const READ_TUNING_SCRIPT = `(() => {
  const g = window.__lions.renderer.groundMat;
  if (!g) throw new Error('renderer has no groundMat: tree changed');
  const u = g.uniforms;
  const p = u && u.uPuddleReflect ? u.uPuddleReflect.value : null;
  const m = u && u.uMarshReflect ? u.uMarshReflect.value : null;
  return JSON.stringify({ puddle: p, marsh: m });
})()`;

/** A `-r<v>` frame must have been DRAWN at `v`: the reflectance read back off the uniforms (not the
 *  one we asked for) equals the view's. Throws otherwise, naming the view. */
export function assertReflectApplied(view: { readonly name: string; readonly reflect?: number }, frame: { readonly puddle: number | null; readonly marsh: number | null }): void {
  if (view.reflect === undefined) return;
  if (frame.puddle !== view.reflect || frame.marsh !== view.reflect) {
    throw new Error(
      `${TAG}: ${view.name} was asked for reflectance ${view.reflect} but the uniforms read puddle=${String(frame.puddle)} marsh=${String(frame.marsh)}`
    );
  }
}

/** The run asked for `--reflect` and took no `-r` frame anywhere: every map was dry, or none had a
 *  marker view. A run like that has no A/B and must not exit 0. */
export function reflectRunFailed(reflect: readonly number[] | undefined, reflectFramesTaken: number): boolean {
  return reflect !== undefined && reflectFramesTaken === 0;
}

/** `gl.info`'s draw-call and triangle counts for exactly one settled frame:
 *  reset, draw a `frame(1, 0)` (zero elapsed presentation time, so nothing
 *  animates between the reset and the read), read, restore `autoReset`. A
 *  raw string handed to `page.evaluate` rather than a typed function -- the
 *  `WebGLRenderer.info` shape is not worth declaring here for a value this
 *  script only ever JSON-round-trips. */
const STATS_SCRIPT = `(() => {
  const r = window.__lions.renderer;
  const gl = r.renderer;
  gl.info.autoReset = false;
  gl.info.reset();
  r.frame(1, 0);
  const i = gl.info;
  const out = {
    calls: i.render.calls,
    triangles: i.render.triangles,
    textures: i.memory.textures,
    geometries: i.memory.geometries,
  };
  gl.info.autoReset = true;
  return JSON.stringify(out);
})()`;

/**
 * Fix round 1, item 6: per-FAMILY triangle totals of the decor GEOMETRY the
 * renderer actually LOADED for the current map (`grass`, `tree`,
 * `desert_tree`, ...), not multiplied by placement count -- the layer-wide
 * `decor` delta in `layerCost` already answers "what does decor cost drawn
 * on screen"; this answers the narrower, more diagnostic question "did the
 * renderer load the LOW-poly asset or a stale one", which is exactly what
 * this fix round needed after `assets/meshes/decor` turned out to be stale
 * against `art/meshes/decor` (see `pnpm encode:meshes -- --check`, task-6-
 * report.md's fix round 1). `renderer.decorSet` is `ThreeRenderer`'s own
 * private field (TypeScript `private` is compile-time only -- the runtime
 * object has it as a plain property), a `Map<'family_variant',
 * {role,geometry}[]>`; keys are split on the trailing `_<variant>` to group
 * by family. A raw string, like `STATS_SCRIPT` above, for the same reason:
 * `DecorGeometrySet`'s shape is not worth declaring in this file for a value
 * that only ever gets JSON round-tripped once. */
const DECOR_FAMILY_SCRIPT = `(() => {
  const set = window.__lions.renderer.decorSet;
  const totals = {};
  if (set && set.parts) {
    for (const [key, parts] of set.parts) {
      const family = key.replace(/_\\d+$/, '');
      let tris = 0;
      for (const part of parts) {
        const g = part.geometry;
        const count = g.index ? g.index.count : g.attributes.position.count;
        tris += count / 3;
      }
      totals[family] = (totals[family] || 0) + tris;
    }
  }
  return JSON.stringify(totals);
})()`;

interface ViewStats {
  readonly calls: number;
  readonly triangles: number;
  readonly textures: number;
  readonly geometries: number;
}

/** A frame as `cost.json` records it: its draw cost, the sim tick it was drawn at and the
 *  reflectances the ground shader used (`null`: a dry map has neither). */
interface FrameRecord extends ViewStats {
  readonly tick: number;
  readonly puddle: number | null;
  readonly marsh: number | null;
}

interface Tuning {
  readonly puddle: number | null;
  readonly marsh: number | null;
}

async function readTuning(page: Page): Promise<Tuning> {
  return JSON.parse((await page.evaluate(READ_TUNING_SCRIPT)) as string) as Tuning;
}

async function readStats(page: Page): Promise<ViewStats> {
  const json = (await page.evaluate(STATS_SCRIPT)) as string;
  return JSON.parse(json) as ViewStats;
}

async function boot(page: Page, port: number, mapId: string, extra: string): Promise<void> {
  const url = `http://localhost:${port}/?sandbox=${mapId}${extra}&renderer=three`;
  await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
  await page.waitForFunction(() => typeof (window as unknown as LionsWindow).__lions !== 'undefined', null, {
    timeout: 60_000,
  });
  await page.evaluate(FREEZE_FRAME_LOOP_SCRIPT);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(2500);
  await page.evaluate(hideHudExceptCanvas);
}

async function shot(page: Page, out: string, view: MapView): Promise<FrameRecord> {
  const rect = await page.evaluate(
    ([x, y, zoom, fog, reflect]) => {
      const L = (window as unknown as LionsWindow).__lions;
      if (reflect !== null) {
        if (typeof L.renderer.debugSetWetTuning !== 'function') {
          throw new Error('renderer has no debugSetWetTuning: this tree predates GH-871 P4 T4');
        }
        L.renderer.debugSetWetTuning({ puddle: reflect, marsh: reflect });
      }
      L.goto(x, y);
      L.renderer.camera.zoom = zoom;
      L.renderer.setDebugLayerVisible('fog', fog);
      L.renderer.frame(1, 0);
      L.renderer.frame(1, 0);
      const c = L.renderer.canvas.getBoundingClientRect();
      return { x: c.x, y: c.y, w: c.width, h: c.height };
    },
    [view.x, view.y, view.zoom, view.fog, view.reflect ?? null] as const
  );
  const stats = await readStats(page);
  const tuning = await readTuning(page);
  const tick = await page.evaluate(() => (window as unknown as LionsWindow).__lions.sim.tickCount);
  await page.screenshot({
    path: path.join(out, `${view.name}.png`),
    clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h },
  });
  return { ...stats, tick, puddle: tuning.puddle, marsh: tuning.marsh };
}

export function frameLine(name: string, f: FrameRecord): string {
  const r = f.puddle === null ? 'dry' : `puddle=${f.puddle} marsh=${f.marsh}`;
  return `  ${name}: tick=${f.tick} ${r} calls=${f.calls} tris=${f.triangles} tex=${f.textures} geo=${f.geometries}`;
}

type LayerDelta =
  | { readonly layer: string; readonly calls: number; readonly triangles: number }
  | { readonly layer: string; readonly calls: 'n/a'; readonly triangles: 'n/a' };

/** Hides each of `COST_LAYERS` in turn against a fixed `base` reading and
 *  reports the calls/triangles it was worth. A layer name that does not
 *  resolve on this tree THROWS in the page (`ThreeRenderer.setDebugLayerVisible`)
 *  -- caught here and reported `n/a` rather than failing the whole run, which
 *  is what lets one script measure a layer that exists on one branch and not
 *  the other (see this file's header, difference 2). */
async function layerCost(page: Page, base: ViewStats): Promise<readonly LayerDelta[]> {
  const out: LayerDelta[] = [];
  for (const layer of COST_LAYERS) {
    try {
      await page.evaluate(
        (l) => (window as unknown as LionsWindow).__lions.renderer.setDebugLayerVisible(l, false),
        layer
      );
      const hidden = await readStats(page);
      await page.evaluate(
        (l) => (window as unknown as LionsWindow).__lions.renderer.setDebugLayerVisible(l, true),
        layer
      );
      out.push({ layer, calls: base.calls - hidden.calls, triangles: base.triangles - hidden.triangles });
    } catch {
      out.push({ layer, calls: 'n/a', triangles: 'n/a' });
    }
  }
  return out;
}

function markersFor(mapId: string): Readonly<Record<string, readonly [number, number]>> {
  const table = ALL_MAPS as unknown as Record<
    string,
    { readonly markers?: Readonly<Record<string, readonly [number, number]>> } | undefined
  >;
  return table[mapId]?.markers ?? {};
}

function rowsFor(mapId: string): readonly string[] {
  const table = ALL_MAPS as unknown as Record<string, { readonly rows?: readonly string[] } | undefined>;
  const entry = table[mapId];
  if (entry?.rows === undefined) {
    throw new Error(`${TAG}: no map "${mapId}" in @lions/data (have: ${Object.keys(ALL_MAPS).join(', ')})`);
  }
  return entry.rows;
}

interface MapCost {
  readonly views: Record<string, FrameRecord>;
  readonly layers: readonly LayerDelta[];
  readonly decorFamiliesLoaded: Record<string, number>;
}

/** `--wade`: order the first infantry entity to the nearest `~` tile to the marker through
 *  `sim.queueCommand`, step until it arrives or `WADE_TICK_CAP` ticks pass, print which. Returns the
 *  target tile. Throws (naming the map) when there is no marker, no `~` tile or no infantry. */
async function wadeSquad(
  page: Page,
  say: (line: string) => void,
  mapId: string,
  marker: string,
  rows: readonly string[],
  table: Readonly<Record<string, readonly [number, number]>>
): Promise<[number, number]> {
  const at = Object.prototype.hasOwnProperty.call(table, marker) ? table[marker] : undefined;
  if (at === undefined) {
    throw new Error(`${TAG}: --wade: map "${mapId}" has no marker "${marker}" (have: ${Object.keys(table).join(', ') || 'none'})`);
  }
  const tile = nearestWaterTile(rows, at);
  if (tile === null) throw new Error(`${TAG}: --wade: map "${mapId}" has no "~" tile to wade to`);
  const id = (await page.evaluate(FIRST_INFANTRY_SCRIPT)) as number;
  if (id < 0) throw new Error(`${TAG}: --wade: map "${mapId}" has no living side-0 infantry to order`);
  await page.evaluate(wadeOrderScript(wadeCommand([id], tile)));
  let pos = JSON.parse((await page.evaluate(positionScript(id))) as string) as { x: number; y: number; tick: number };
  const startTick = pos.tick;
  while (!hasArrived(pos, tile) && pos.tick - startTick < WADE_TICK_CAP) {
    await page.evaluate((n) => (window as unknown as LionsWindow).__lions.step(n), WADE_STEP_TICKS);
    pos = JSON.parse((await page.evaluate(positionScript(id))) as string) as typeof pos;
  }
  const spent = pos.tick - startTick;
  say(
    hasArrived(pos, tile)
      ? `  wade ${mapId}: entity ${id} ARRIVED at ~ tile (${tile[0]},${tile[1]}) near ${marker} after ${spent} ticks (tick ${pos.tick})`
      : `  wade ${mapId}: entity ${id} DID NOT ARRIVE at ~ tile (${tile[0]},${tile[1]}) near ${marker} in ${spent} ticks; at (${pos.x.toFixed(1)},${pos.y.toFixed(1)}), tick ${pos.tick}`
  );
  return tile;
}

async function main(): Promise<void> {
  const args = parseGroundCaptureArgs(process.argv.slice(2), process.env);
  // Resolved against the repo root, never against `process.cwd()`: `pnpm
  // ground:capture` delegates through `pnpm --filter @lions/tools`, so the
  // cwd is `tools/` -- the exact trap `blast-captures.ts`'s header records
  // costing the golden gate a silent "no files found" upload. `args.out`
  // itself stays the raw string (`parseGroundCaptureArgs`'s own contract);
  // only file I/O uses the resolved path.
  const outDir = path.resolve(REPO_ROOT, args.out);
  fs.mkdirSync(outDir, { recursive: true });

  const log: string[] = [];
  const say = (line: string): void => {
    console.log(line);
    log.push(line);
  };
  const finish = (code: number): never => {
    fs.writeFileSync(path.join(outDir, 'log.txt'), log.join('\n') + '\n');
    process.exit(code);
  };

  // Before the server, and over TCP on both loopbacks (`ui-review/port.ts`):
  // the REUSED check below reads `ensureDevServer`'s one-second HTTP probe,
  // which misses a listener that is slow, not HTTP or bound only to `::1` --
  // and Vite (`strictPort: false`) would then quietly start one port up while
  // this script measured whatever answered on `args.port`. A held port is
  // refused here unless `--reuse`/`--attach` says the caller meant it, and
  // with either, an EMPTY port is refused too: there is nothing to reuse.
  const portArgv = process.argv.slice(2).map((a) => (a === '--reuse' ? ATTACH_FLAG : a));
  const claim = await decidePort(TAG, GROUND_CAPTURE_PORT_ENV, DEFAULT_PORT, portArgv, process.env, 'own-or-attach');
  if (!claim.ok) {
    say(claim.message);
    finish(2);
  }
  const server = await ensureDevServer(args.port, REPO_ROOT, TAG);
  if (server === null) {
    say(`[${TAG}] REUSED an existing dev server on :${args.port} (not managed, will not be killed)`);
    if (!args.reuse) {
      say(
        `[${TAG}] refusing to measure a reused server without --reuse: a run that reuses ` +
          `someone else's server measures another tree. Pass --reuse if that is really what you want.`
      );
      finish(2);
    }
  } else {
    say(`[${TAG}] STARTED a dev server on :${args.port}`);
  }
  // Fix round 1 (item 6): `packages/app/vite.config.ts` sets `strictPort:
  // false`, so Vite CAN silently bind to a different port than requested if
  // `args.port` happened to be busy at the exact moment it started --
  // `ensureDevServer`'s own `waitForServer(args.port, ...)` would then time
  // out and this script would already have thrown before reaching here, so
  // by construction something IS listening on `args.port` -- but "by
  // construction" is not the same as PROVING it for whoever reads this log
  // later. `page.url()` (Playwright's own read of the frame's current
  // location, not a page-side script) states the port the browser actually
  // ended up connected to; the assertion right after turns a future
  // strictPort=false surprise into a loud failure instead of a quiet
  // measurement of the wrong tree.

  const browser = await chromium.launch({ headless: true, args: gpuLaunchArgs('metal') });
  const cost: Record<string, MapCost> = {};
  let reflectFrames = 0;
  try {
    say(`[${TAG}] gl=${await readUnmaskedRenderer(browser)}`);
    const page = await browser.newPage({ viewport: CAPTURE_VIEWPORT, deviceScaleFactor: 1 });
    await page.addInitScript(musicOffInitScript());
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    for (const mapId of args.maps) {
      const rows = rowsFor(mapId);
      const extra = args.decals ? '&decals' : '';
      await boot(page, args.port, mapId, extra);
      const actualPort = new URL(page.url()).port;
      if (actualPort !== String(args.port)) {
        say(
          `[${TAG}] ERROR: requested --port=${args.port} but the browser is on :${actualPort} -- ` +
            `Vite's strictPort=false let it bind elsewhere; every measurement so far is against ` +
            `the WRONG tree, refusing to continue`
        );
        finish(1);
      }
      say(`boot ${mapId}${extra} (dev server confirmed on :${actualPort})`);

      const familyJson = (await page.evaluate(DECOR_FAMILY_SCRIPT)) as string;
      const familyTotals = JSON.parse(familyJson) as Record<string, number>;
      const familyEntries = Object.entries(familyTotals).sort(([a], [b]) => a.localeCompare(b));
      say(
        `  decor families LOADED (geometry tris, not placement-multiplied): ` +
          (familyEntries.length > 0
            ? familyEntries.map(([f, t]) => `${f}=${t}`).join(', ')
            : '(none -- decorSet empty, or this build has no decorSet field)')
      );

      const wanted = (args.markers ?? []).filter((m) => m.map === mapId).map((m) => m.marker);
      const views = viewsFor(mapId, rows, wanted, markersFor(mapId));
      const viewCosts: Record<string, FrameRecord> = {};
      for (const view of views) {
        const stats = await shot(page, outDir, view);
        viewCosts[view.name] = stats;
        say(frameLine(view.name, stats));
      }

      // Layer cost is measured at a fixed centre/z1/nofog framing, set
      // explicitly rather than inherited from whichever view was shot last
      // (the road close-up, if the map has one, would otherwise leave the
      // camera somewhere else entirely).
      const w = rows[0]?.length ?? 0;
      const h = rows.length;
      const cx = Math.floor(w / 2);
      const cy = Math.floor(h / 2);
      await page.evaluate(
        ([x, y]) => {
          const L = (window as unknown as LionsWindow).__lions;
          L.goto(x, y);
          L.renderer.camera.zoom = 1;
          L.renderer.setDebugLayerVisible('fog', false);
          L.renderer.frame(1, 0);
        },
        [cx, cy] as const
      );
      const base = await readStats(page);
      const layers = await layerCost(page, base);
      // GH-871 P4 T6. After the cost block so the reflectance and the squad move nothing it
      // measured; the reflect views first (the squad still at tick 0, as in the plain views), the
      // tuning put back, and only then the wade.
      if (args.reflect !== undefined && wanted.length > 0) {
        const before = await readTuning(page);
        if (before.puddle === null) {
          say(`  --reflect: ${mapId} has no wet ground (no reflectance uniform), its marker views are not repeated`);
        } else {
          for (const view of reflectViews(mapId, views, wanted, args.reflect)) {
            const stats = await shot(page, outDir, view);
            assertReflectApplied(view, stats);
            reflectFrames++;
            viewCosts[view.name] = stats;
            say(frameLine(view.name, stats));
          }
          await page.evaluate(
            ([puddle, marsh]) =>
              (window as unknown as LionsWindow).__lions.renderer.debugSetWetTuning?.({ puddle, marsh }),
            [before.puddle, before.marsh ?? before.puddle] as const
          );
        }
      }
      if (args.wade !== undefined && args.wade.map === mapId) {
        const tile = await wadeSquad(page, say, mapId, args.wade.marker, rows, markersFor(mapId));
        for (const view of wadeViews(mapId, tile)) {
          const stats = await shot(page, outDir, view);
          viewCosts[view.name] = stats;
          say(frameLine(view.name, stats));
        }
      }
      cost[mapId] = { views: viewCosts, layers, decorFamiliesLoaded: familyTotals };
      say(
        `  cost ${mapId} centre z1 nofog: all calls=${base.calls} tris=${base.triangles} | ` +
          layers
            .map((l) => (l.calls === 'n/a' ? `${l.layer} n/a` : `${l.layer} -${l.calls} calls / -${l.triangles} tris`))
            .join(' | ')
      );
    }

    if (pageErrors.length > 0) say(`page errors: ${pageErrors.slice(0, 5).join(' | ')}`);
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(outDir, 'cost.json'), JSON.stringify(cost, null, 2) + '\n');
    stopDevServer(server, TAG);
  }
  if (reflectRunFailed(args.reflect, reflectFrames)) {
    say(
      `[${TAG}] ERROR: --reflect was given but no -r frame was taken (no map in --maps had a marker view on wet ground): there is no A/B`
    );
    finish(1);
  }
  finish(0);
}

// Only when run as a script -- the test file imports this module for its
// pure half, and a module that boots a browser on import would make
// `pnpm test` start a dev server (the same guard `blast-captures.ts` uses).
const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
