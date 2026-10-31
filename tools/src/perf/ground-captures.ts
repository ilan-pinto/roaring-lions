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
 * GH-871 P4 T12 adds the options of the lead's second look at the rain (S-L2). The pure half is
 * `ground-captures-plan.ts`; the run is announced once and is expensive to repeat, so each option
 * reads back what it asked for and FAILS LOUD:
 *
 *   pnpm ground:capture -- --port=5196 --maps=ein_qasab \
 *     --markers=ein_qasab:causeway_s,ein_qasab:kdf_start,ein_qasab:hamlet --zooms=1,1.6,2.5 \
 *     --quality=high,medium,low --ticks=6 --motion=reduce --clip=5 --stops=road,water,grass --out=...
 *
 *   --quality=<p>[,<p>...]  one extra boot per preset (the preset applies at boot, through the
 *       `lions.settings` seed `musicOffInitScript` builds, never by hand); the MARKER views are
 *       taken again as `<view>-<preset>`. The booted preset is read back (the quality's rain drop
 *       count and the live batch's instance count: high 6,000, medium 3,500, low 900) and a
 *       mismatch throws.
 *   --ticks=<n>   after the baseline's frozen frames, each marker view at zoom 1.6 is followed by n
 *       frames, the sim stepped ONE tick between them (the fall, frame to frame), named
 *       `<view>-t<tick>`.
 *   --motion=reduce   one more boot with `accessibility.motion = 'reduce'` (so `data-motion="reduce"`),
 *       marker views as `<view>-reduced`; reducedMotion() must read true and the rain mesh hidden.
 *   --clip=<s>    one Playwright `recordVideo` of the LIVE loop (not frozen) at the first marker, zoom
 *       1.6, preset high, music off; the path is printed and is `_run.clip` in cost.json.
 *   --stops=road,water,grass   after the baseline, the sandbox force's first infantry entity is
 *       ordered (a `move` Command through `sim.queueCommand`, exactly as `--wade`) to a tile of
 *       each kind near the first marker, waited for (600 ticks at most, DID NOT ARRIVE printed),
 *       and photographed at zoom 2.5 as `<map>-squad-<kind>` with `squadScreen` in cost.json.
 *   --zooms=1,1.6,2.5   the zooms each marker is photographed at (default 1 and 2.5, unchanged).
 *
 * GH-871 P4 PR 914 adds the rain-rim calibration (the lead's ruling 1: a thin Fresnel rim light on KDF
 * figures under rain replaces the flat lift), so ONE browser run can show several gains:
 *
 *   pnpm ground:capture -- --port=5196 --maps=ein_qasab --markers=ein_qasab:causeway_s \
 *     --stops=road,water,grass --rim=0.2,0.4,0.8 --out=...
 *
 *   --rim=<g>[,<g>...]   needs --stops. After each stop's plain frame (drawn at the shipped default
 *       gain, as before) the SAME frozen view is repainted at each gain, at zero elapsed time as
 *       `--reflect` is: `ThreeRenderer.debugSetRainRim(g)` (a concrete-class method reached through
 *       `__lions.renderer`, never the `Renderer` interface), a repaint, then `debugRainRim()` read
 *       back and compared with the request (a mismatch, or a renderer with no rim material, THROWS).
 *       The frames are named `<map>-squad-<kind>-rim<g>`, and the gain and `squadScreen` are in
 *       `cost.json`. The knob is put back to the shipped default after each stop. Cropping to 4x
 *       around `squadScreen` is the run child's job, not this tool's.
 *
 * GH-871 P4 S-L2 ruling 4 adds the one ordered vehicle, for the mud spray:
 *
 *   --vehicle[=<marker>]   after the stops, the sandbox force's first LIVING side-0 vehicle (a unit type
 *       whose resolved `wheeled` is true and that is neither air nor soft (the renderer sprays only
 *       `!isSoft` hulls): `dozer_d9` and the armoured Lavi count, `rocket_battery` (soft) and
 *       `manpad_team` do not; the ROLE alone is wrong both ways) is ordered by a `move` Command
 *       (`sim.queueCommand`, never a state write) to a road tile at least 10 tiles away (more for a fast
 *       hull), the one nearest the marker (default the map's first `--markers` entry). The sim is then
 *       stepped one tick at a time (three 16.7 ms frames a tick, as the live loop draws, through a
 *       temporary `renderer.frame` wrapper) and the hull photographed, the camera on it, at zoom 1.6
 *       and 2.5 on ticks 20, 60 and 120 after the order, as `<view>-vehicle-t<n>`. Each shot records
 *       whether the hull was MOVING (>= 0.05 tile over the last 5 ticks) and its speed, in `cost.json` `<map>.vehicle`,
 *       with the emitter the renderer trails (`vehicle_mud` under rain, or the run throws). No
 *       vehicle prints NO VEHICLE and a stationary shot prints NOT MOVING; both exit non-zero.
 *
 * Every frame also carries its preset, zoom, tick and the ON-SCREEN DROP DENSITY (`drops=`, with
 * the lattice period `P=` and the preset's `total=`): the density depends on the zoom, and the
 * lead judges the streak at the zoom it is seen at.
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
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { maps as ALL_MAPS } from '@lions/data';
import type { Command } from '@lions/sim';
import { ensureDevServer, readUnmaskedRenderer, stopDevServer } from '../golden-diff/browser';
import { CAPTURE_VIEWPORT, FREEZE_FRAME_LOOP_SCRIPT, hideHudExceptCanvas } from '../golden-diff/capture-protocol';
import { gpuLaunchArgs } from '../ui-review/gpu';
import { musicOffInitScript } from '../ui-review/music-off';
import { ATTACH_FLAG, decidePort } from '../ui-review/port';
import {
  CLIP_ZOOM,
  FIRST_VEHICLE_SCRIPT,
  NameClaims,
  READ_RAIN_HEIGHTS_SCRIPT,
  READ_RENDER_SCRIPT,
  STOP_ARRIVE_TILES,
  STOP_POLL_TICKS,
  STOP_SETTLE_TICKS,
  STOP_STALL_POLLS,
  STOP_ZOOM,
  TICK_STRIP_ZOOM,
  VEHICLE_EMITTER_SCRIPT,
  VEHICLE_FRAMES_PER_TICK,
  VEHICLE_FRAME_DT_MS,
  VEHICLE_FRAME_UNWRAP_SCRIPT,
  VEHICLE_FRAME_WRAP_SCRIPT,
  VEHICLE_TICKS,
  VEHICLE_ZOOMS,
  assertMotion,
  assertPresetBooted,
  assertVehicleEmitter,
  isOnStop,
  makeHeightSampler,
  halfToFloat,
  nextStall,
  parseClip,
  parseMotion,
  parsePresets,
  parseStops,
  parseTicks,
  parseVehicleMarker,
  parseZooms,
  planPasses,
  rainLabel,
  requestedModeFailures,
  squadScreenScript,
  READ_RIM_SCRIPT,
  assertRimApplied,
  parseRim,
  rimViews,
  type RimRead,
  standsOn,
  stopGlyph,
  stopName,
  stopOutcome,
  stopTile,
  suffixedViews,
  tickName,
  vehicleLegend,
  vehicleMinDistance,
  vehicleMotionAt,
  vehicleName,
  vehicleRoadTile,
  vehicleTickScript,
  type FirstVehicle,
  type Pass,
  type Preset,
  type RainLabel,
  type RenderRead,
  type StopKind,
  type VehicleMotion,
  type VehicleRoadPick,
} from './ground-captures-plan';

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
  /** `--quality=` (GH-871 P4 T12): the presets to take the marker views at. Absent without the flag. */
  readonly quality?: readonly Preset[];
  /** `--ticks=` (T12): one-tick frames after each marker view at zoom 1.6. */
  readonly ticks?: number;
  /** `--motion=reduce` (T12). */
  readonly motion?: 'reduce';
  /** `--clip=` (T12): seconds of live loop to record. */
  readonly clip?: number;
  /** `--stops=` (T12): the tile kinds the first infantry entity is walked onto. */
  readonly stops?: readonly StopKind[];
  /** `--zooms=` (T12): the zooms each marker is photographed at. Absent keeps `MARKER_ZOOMS`. */
  readonly zooms?: readonly number[];
  /** `--rim=` (GH-871 P4 PR 914): the rain-rim gains each `--stops` frame is repainted at. Absent without the flag. */
  readonly rim?: readonly number[];
  /** `--vehicle[=<marker>]` (S-L2 ruling 4): the marker to drive towards, `null` for each map's first
   *  `--markers` entry. Absent without the flag. */
  readonly vehicle?: { readonly marker: string | null };
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
  const rawQuality = flag(argv, 'quality');
  const quality = rawQuality === undefined ? undefined : parsePresets(rawQuality);
  const rawTicks = flag(argv, 'ticks');
  const ticks = rawTicks === undefined ? undefined : parseTicks(rawTicks);
  const rawMotion = flag(argv, 'motion');
  const motion = rawMotion === undefined ? undefined : parseMotion(rawMotion);
  const rawClip = flag(argv, 'clip');
  const clip = rawClip === undefined ? undefined : parseClip(rawClip);
  const rawStops = flag(argv, 'stops');
  const stops = rawStops === undefined ? undefined : parseStops(rawStops);
  const rawZooms = flag(argv, 'zooms');
  const zooms = rawZooms === undefined ? undefined : parseZooms(rawZooms);
  const rawRim = flag(argv, 'rim');
  const rim = rawRim === undefined ? undefined : parseRim(rawRim);
  const rawVehicle = flag(argv, 'vehicle');
  const vehicle =
    rawVehicle !== undefined ? { marker: parseVehicleMarker(rawVehicle) } : argv.includes('--vehicle') ? { marker: null } : undefined;
  // Each of these photographs a MARKER; without one there is nothing to apply it to.
  for (const [name, given] of [['--quality', quality], ['--ticks', ticks], ['--motion', motion], ['--clip', clip], ['--stops', stops], ['--zooms', zooms], ['--vehicle', vehicle]] as const) {
    if (given !== undefined && markers === undefined) throw new Error(`${name} photographs the --markers views; pass --markers=<map>:<marker> too`);
  }
  // The rim repaints the settled squad frames: with no --stops there is nothing to repaint.
  if (rim !== undefined && stops === undefined) throw new Error('--rim repaints the --stops frames; pass --stops=road,water,grass too');
  // A named marker must be one the run has: a typo must not quietly drive nowhere.
  if (typeof vehicle?.marker === 'string' && !(markers ?? []).some((m) => m.marker === vehicle.marker)) {
    throw new Error(`--vehicle=${vehicle.marker} names a marker that is not in --markers (have: ${(markers ?? []).map((m) => m.marker).join(', ')})`);
  }
  // A tick strip is taken at zoom 1.6: refuse a run that cannot take one rather than finish with none.
  if (ticks !== undefined && !(zooms ?? MARKER_ZOOMS).includes(TICK_STRIP_ZOOM)) {
    throw new Error(`--ticks strips are taken at zoom ${TICK_STRIP_ZOOM}: pass --zooms=...,${TICK_STRIP_ZOOM}`);
  }
  return {
    ...base,
    ...(markers === undefined ? {} : { markers }),
    ...(reflect === undefined ? {} : { reflect }),
    ...(wade === undefined ? {} : { wade }),
    ...(quality === undefined ? {} : { quality }),
    ...(ticks === undefined ? {} : { ticks }),
    ...(motion === undefined ? {} : { motion }),
    ...(clip === undefined ? {} : { clip }),
    ...(stops === undefined ? {} : { stops }),
    ...(zooms === undefined ? {} : { zooms }),
    ...(vehicle === undefined ? {} : { vehicle }),
    ...(rim === undefined ? {} : { rim }),
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
  /** GH-871 P4 PR 914: when present the view is drawn at this rain-rim gain (`debugSetRainRim`) and the
   *  gain is read back and asserted. Absent leaves the knob as it was. */
  readonly rim?: number;
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
  table: Readonly<Record<string, readonly [number, number]>> = {},
  zooms: readonly number[] = MARKER_ZOOMS
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
    for (const zoom of zooms) {
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

/** The `--stops` order: the same `move` Command door as the wade, for entity `id` to `tile`. A
 *  Command through `sim.queueCommand`, never a position write (invariant 4); the test runs it
 *  against a fake `window` whose sim state refuses a write. */
export function stopOrderScript(id: number, tile: readonly [number, number]): string {
  return wadeOrderScript(wadeCommand([id], tile));
}

/** The `--vehicle` order: the same `move` Command door as the squad stops, for the vehicle `id` to
 *  `tile`. Through `sim.queueCommand`, never a position write (invariant 4); the test runs it against
 *  a fake `window` whose sim state refuses a write. */
export function vehicleOrderScript(id: number, tile: readonly [number, number]): string {
  return wadeOrderScript(wadeCommand([id], tile));
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
      /** ThreeRenderer's rain-rim calibration knob (GH-871 P4 PR 914): also concrete-class only. */
      debugSetRainRim?(gain: number): void;
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

/** What `--stops` records for the frame it photographed. */
interface StopRecord {
  readonly kind: StopKind;
  readonly tile: readonly [number, number];
  /** The tile's neighbours that are not its kind: 0 means the squad truly stands in it. */
  readonly nonKind: number;
  readonly arrived: boolean;
  readonly ticks: number;
  /** `ARRIVED` (within 0.3 tile of the centre), `DID NOT SETTLE` (within 1.5) or `DID NOT ARRIVE`. */
  readonly outcome: string;
  /** The map glyph under the lead entity when the frame was taken (`''` off the map). */
  readonly standsOn: string;
  /** The squad stood on the stop: ARRIVED and `standsOn` is the kind's glyph. */
  readonly onStop: boolean;
}

/** A frame as `cost.json` records it: its draw cost, the sim tick it was drawn at and the
 *  reflectances the ground shader used (`null`: a dry map has neither). T12 adds the labels the
 *  lead reads a frame by: the preset, the zoom and the rain density (`null`: no rain batch). */
export interface FrameRecord extends ViewStats {
  readonly tick: number;
  readonly puddle: number | null;
  readonly marsh: number | null;
  readonly preset?: Preset;
  readonly zoom?: number;
  readonly rain?: RainLabel | null;
  /** `--stops`: where the squad's lead entity stood on the screen, CSS px, for a contrast step. */
  readonly squadScreen?: readonly [number, number];
  readonly stop?: StopRecord;
  /** `--rim`: the rain rim as READ BACK after the frame was drawn (gain, power, built). */
  readonly rim?: RimRead;
}

/** What `--vehicle` records for one shot, in `cost.json` `<map>.vehicle.shots`. */
interface VehicleShot {
  readonly name: string;
  readonly zoom: number;
  /** Sim ticks after the order. */
  readonly ticks: number;
  /** The ticks `moving` and `speedTilesPerSec` were read over, and the tiles travelled in them. */
  readonly windowTicks: number;
  readonly windowTiles: number;
  readonly tick: number;
  readonly moving: boolean;
  readonly speedTilesPerSec: number;
  readonly tilesPerTick: number;
  /** The hull's position in tiles, and its tile. */
  readonly pos: readonly [number, number];
  readonly tile: readonly [number, number];
  /** `renderer.worldToScreen` on the hull, CSS px, for the crop. */
  readonly screen: readonly [number, number];
}

/** `--vehicle` for one map. */
interface VehicleRecord {
  readonly id: number;
  readonly typeId: string;
  readonly marker: string;
  readonly from: readonly [number, number];
  readonly target: readonly [number, number];
  /** `far` (>= minDistance away) or `nearest` (no road tile was that far). */
  readonly targetKind: VehicleRoadPick['kind'];
  readonly targetDistance: number;
  readonly minDistance: number;
  readonly orderTick: number;
  /** The presentation time of each frame drawn during the run, ms, and the frames drawn per sim tick. */
  readonly frameDtMs: number;
  readonly framesPerTick: number;
  /** `renderer.vehicleMoveEmitterName()` as read from the page: `vehicle_mud` under rain. */
  readonly emitter: string;
  readonly weather: 'rain' | 'clear' | null;
  readonly shots: readonly VehicleShot[];
}

interface Tuning {
  readonly puddle: number | null;
  readonly marsh: number | null;
}

async function readTuning(page: Page): Promise<Tuning> {
  return JSON.parse((await page.evaluate(READ_TUNING_SCRIPT)) as string) as Tuning;
}

async function readRim(page: Page): Promise<RimRead> {
  return JSON.parse((await page.evaluate(READ_RIM_SCRIPT)) as string) as RimRead;
}

async function readStats(page: Page): Promise<ViewStats> {
  const json = (await page.evaluate(STATS_SCRIPT)) as string;
  return JSON.parse(json) as ViewStats;
}

async function readRender(page: Page): Promise<RenderRead> {
  return JSON.parse((await page.evaluate(READ_RENDER_SCRIPT)) as string) as RenderRead;
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

/** The rain batch's ground-height sampler, read off the page ONCE per boot (the ground does not
 *  move during a capture). */
interface HeightCache {
  sampler: ((x: number, z: number) => number) | null;
  loaded: boolean;
}

/** What one `shot` needs beyond the camera: the pass it belongs to, the run's name register, this
 *  boot's height cache and (for `--stops`) the entity whose screen position to record. */
interface ShotCtx {
  readonly pass: Pass;
  readonly claims: NameClaims;
  readonly cache: HeightCache;
  readonly track?: number;
}

async function loadHeights(page: Page, cache: HeightCache): Promise<void> {
  if (cache.loaded) return;
  const raw = JSON.parse((await page.evaluate(READ_RAIN_HEIGHTS_SCRIPT)) as string) as { w: number; h: number; bits: number[] } | null;
  if (raw === null) throw new Error(`${TAG}: the renderer has a rain batch but READ_RAIN_HEIGHTS_SCRIPT found none`);
  cache.sampler = makeHeightSampler(raw.bits.map(halfToFloat), raw.w, raw.h);
  cache.loaded = true;
}

async function shot(page: Page, out: string, view: MapView, ctx: ShotCtx): Promise<FrameRecord> {
  ctx.claims.claim(view.name);
  const rect = await page.evaluate(
    ([x, y, zoom, fog, reflect, rim]) => {
      const L = (window as unknown as LionsWindow).__lions;
      if (rim !== null) {
        if (typeof L.renderer.debugSetRainRim !== 'function') {
          throw new Error('renderer has no debugSetRainRim: this tree predates GH-871 P4 PR 914');
        }
        L.renderer.debugSetRainRim(rim);
      }
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
    [view.x, view.y, view.zoom, view.fog, view.reflect ?? null, view.rim ?? null] as const
  );
  const stats = await readStats(page);
  const tuning = await readTuning(page);
  // The renderer's own answers about THIS frame. A pass that did not boot as asked throws here, on
  // its first frame, instead of filling a sheet with frames of the wrong preset.
  const read = await readRender(page);
  assertPresetBooted(ctx.pass.preset, read);
  assertMotion(ctx.pass.reduced, read);
  if (read.rain !== null) await loadHeights(page, ctx.cache);
  const rain = rainLabel(read, ctx.cache.sampler);
  // A `-rim<g>` frame must have been DRAWN at g: read the shared uniform back off the renderer.
  const rimRead = view.rim === undefined ? undefined : await readRim(page);
  if (view.rim !== undefined && rimRead !== undefined) assertRimApplied(view.name, view.rim, rimRead);
  const squadScreen =
    ctx.track === undefined ? undefined : (JSON.parse((await page.evaluate(squadScreenScript(ctx.track))) as string) as [number, number]);
  await page.screenshot({
    path: path.join(out, `${view.name}.png`),
    clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h },
  });
  return {
    ...stats,
    tick: read.tick,
    puddle: tuning.puddle,
    marsh: tuning.marsh,
    preset: ctx.pass.preset,
    zoom: view.zoom,
    rain,
    ...(squadScreen === undefined ? {} : { squadScreen }),
    ...(rimRead === undefined ? {} : { rim: rimRead }),
  };
}

export function frameLine(name: string, f: FrameRecord): string {
  const r = f.puddle === null ? 'dry' : `puddle=${f.puddle} marsh=${f.marsh}`;
  let line = `  ${name}: tick=${f.tick} ${r} calls=${f.calls} tris=${f.triangles} tex=${f.textures} geo=${f.geometries}`;
  if (f.preset !== undefined) line += ` preset=${f.preset}`;
  if (f.zoom !== undefined) line += ` zoom=${f.zoom}`;
  if (f.rain === null) line += ' rain=none';
  else if (f.rain !== undefined) {
    line += ` drops=${f.rain.onScreen}${f.rain.visible ? '' : '(hidden)'} P=${Number(f.rain.period.toFixed(1))} keep=${Number(f.rain.keep.toFixed(2))} total=${f.rain.total}`;
  }
  if (f.squadScreen !== undefined) line += ` squad=[${Math.round(f.squadScreen[0])},${Math.round(f.squadScreen[1])}]`;
  if (f.rim !== undefined) line += ` rim=${f.rim.gain}`;
  return line;
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
  /** `--vehicle` (S-L2 ruling 4): the ordered vehicle and its shots; absent without the flag. */
  vehicle?: VehicleRecord;
}

/** What a squad walk ended with. */
interface Walk {
  readonly arrived: boolean;
  readonly spent: number;
  readonly pos: { x: number; y: number; tick: number };
}

/** How `walkSquad` decides it is there: the wade's loose 1.5 tiles polled every 20 ticks, or a stop's
 *  tight tolerance polled every `STOP_POLL_TICKS`, which also gives up early once the squad has
 *  STALLED short of the tile (it will get no nearer) and, once there, steps `STOP_SETTLE_TICKS` more
 *  so the frame is not a walking pose. */
interface WalkMode {
  readonly tol: number;
  readonly pollTicks: number;
  readonly settle: boolean;
}
const WADE_MODE: WalkMode = { tol: WADE_ARRIVE_TILES, pollTicks: WADE_STEP_TICKS, settle: false };
const STOP_MODE: WalkMode = { tol: STOP_ARRIVE_TILES, pollTicks: STOP_POLL_TICKS, settle: true };

/** Orders entity `id` to `tile` (a `move` Command through `sim.queueCommand`, never a state write)
 *  and steps the sim until it arrives or `WADE_TICK_CAP` ticks pass. Prints nothing: each caller
 *  words its own line. */
async function walkSquad(page: Page, id: number, tile: readonly [number, number], mode: WalkMode = WADE_MODE): Promise<Walk> {
  await page.evaluate(stopOrderScript(id, tile));
  const read = async (): Promise<{ x: number; y: number; tick: number }> =>
    JSON.parse((await page.evaluate(positionScript(id))) as string) as { x: number; y: number; tick: number };
  const step = (n: number): Promise<unknown> => page.evaluate((k) => (window as unknown as LionsWindow).__lions.step(k), n);
  let pos = await read();
  const startTick = pos.tick;
  let stall = 0;
  while (!hasArrived(pos, tile, mode.tol) && pos.tick - startTick < WADE_TICK_CAP && stall < STOP_STALL_POLLS) {
    await step(mode.pollTicks);
    const next = await read();
    if (mode.settle) stall = nextStall(stall, pos, next);
    pos = next;
  }
  if (mode.settle && hasArrived(pos, tile, mode.tol)) {
    await step(STOP_SETTLE_TICKS);
    pos = await read();
  }
  return { arrived: hasArrived(pos, tile, mode.tol), spent: pos.tick - startTick, pos };
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
  const { arrived, spent, pos } = await walkSquad(page, id, tile);
  say(
    arrived
      ? `  wade ${mapId}: entity ${id} ARRIVED at ~ tile (${tile[0]},${tile[1]}) near ${marker} after ${spent} ticks (tick ${pos.tick})`
      : `  wade ${mapId}: entity ${id} DID NOT ARRIVE at ~ tile (${tile[0]},${tile[1]}) near ${marker} in ${spent} ticks; at (${pos.x.toFixed(1)},${pos.y.toFixed(1)}), tick ${pos.tick}`
  );
  return tile;
}

/** What one map's `--vehicle` run came to. */
type VehicleRun =
  | { readonly kind: 'none' }
  | { readonly kind: 'ran'; readonly record: VehicleRecord; readonly frames: number; readonly notMoving: readonly string[] };

/**
 * `--vehicle` for one map (S-L2 ruling 4): the first living side-0 wheeled vehicle is ordered to a road
 * tile by a `move` Command through `sim.queueCommand` (never a state write), the sim is stepped ONE
 * tick at a time, and at each of `VEHICLE_TICKS` after the order the hull is photographed at every
 * `VEHICLE_ZOOMS` with the camera on it. Whether it was moving is read from its position over the
 * last tick, never assumed. No vehicle is `{ kind: 'none' }` (the caller turns it into a failed run);
 * a missing renderer field, a wet map that does not trail `vehicle_mud`, a sim that did not advance one
 * tick or a map with no other road THROWS.
 */
async function driveVehicle(
  page: Page,
  say: (line: string) => void,
  outDir: string,
  ctx: ShotCtx,
  viewCosts: Record<string, FrameRecord>,
  mapId: string,
  rows: readonly string[],
  marker: string,
  markerTile: readonly [number, number]
): Promise<VehicleRun> {
  const found = JSON.parse((await page.evaluate(FIRST_VEHICLE_SCRIPT)) as string) as FirstVehicle | null;
  if (found === null) {
    say(`  vehicle ${mapId}: NO VEHICLE: no living side-0 wheeled vehicle in the sandbox force`);
    return { kind: 'none' };
  }
  const weather = (await readRender(page)).weather;
  const emitter = assertVehicleEmitter(weather, await page.evaluate(VEHICLE_EMITTER_SCRIPT));
  const readPos = async (): Promise<{ x: number; y: number; tick: number }> =>
    JSON.parse((await page.evaluate(positionScript(found.id))) as string) as { x: number; y: number; tick: number };
  const prev = await readPos();
  const from: [number, number] = [Math.floor(prev.x), Math.floor(prev.y)];
  const minDistance = vehicleMinDistance(found.stepPerTick);
  const pick = vehicleRoadTile(rows, from, markerTile, minDistance);
  if (pick === null) throw new Error(`${TAG}: --vehicle: map "${mapId}" has no road tile to drive the ${found.typeId} to`);
  say(
    `  vehicle ${mapId}: entity ${found.id} (${found.typeId}, ${(found.stepPerTick * 20).toFixed(1)} tiles/s) at (${prev.x.toFixed(1)},${prev.y.toFixed(1)}) ordered to road tile (${pick.tile[0]},${pick.tile[1]}) near ${marker}: ` +
      (pick.kind === 'far'
        ? `${pick.distance.toFixed(1)} tiles away (>= ${minDistance})`
        : `NEAREST road tile, ${pick.distance.toFixed(1)} tiles away: none was >= ${minDistance} tiles from the vehicle`) +
      `; emitter ${emitter} (${weather ?? 'no weather'}); ${VEHICLE_FRAMES_PER_TICK} frames of ${VEHICLE_FRAME_DT_MS.toFixed(3)} ms per tick`
  );
  const orderTick = prev.tick;
  const history: { x: number; y: number }[] = [{ x: prev.x, y: prev.y }];
  const shots: VehicleShot[] = [];
  const notMoving: string[] = [];
  // Presentation time for the stepped run (see VEHICLE_FRAME_WRAP_SCRIPT). Installed before the order,
  // removed in the finally; the zero-time repaints of `shot()` pass through unchanged.
  await page.evaluate(VEHICLE_FRAME_WRAP_SCRIPT);
  let failure: unknown = null;
  try {
    await page.evaluate(vehicleOrderScript(found.id, pick.tile));
    const last = VEHICLE_TICKS[VEHICLE_TICKS.length - 1];
    for (let k = 1; k <= last; k++) {
      const cur = JSON.parse((await page.evaluate(vehicleTickScript(found.id))) as string) as { x: number; y: number; tick: number };
      if (cur.tick !== orderTick + k) throw new Error(`${TAG}: --vehicle: stepped one tick but the sim reads tick ${cur.tick}, expected ${orderTick + k}`);
      history.push({ x: cur.x, y: cur.y });
      if (!VEHICLE_TICKS.includes(k)) continue;
      const motion: VehicleMotion = vehicleMotionAt(history, k);
      for (const zoom of VEHICLE_ZOOMS) {
        const view: MapView = { name: vehicleName(mapId, marker, zoom, k), x: cur.x, y: cur.y, zoom, fog: false };
        const stats = await shot(page, outDir, view, { ...ctx, track: found.id });
        if (stats.tick !== cur.tick) throw new Error(`${TAG}: ${view.name} was stepped to tick ${cur.tick} but the frame reads tick ${stats.tick}`);
        if (stats.squadScreen === undefined) throw new Error(`${TAG}: ${view.name}: renderer.worldToScreen gave no screen position for the vehicle`);
        viewCosts[view.name] = stats;
        shots.push({
          name: view.name,
          zoom,
          ticks: k,
          windowTicks: motion.windowTicks,
          windowTiles: Number(motion.tiles.toFixed(4)),
          tick: cur.tick,
          moving: motion.moving,
          speedTilesPerSec: Number(motion.speedTilesPerSec.toFixed(3)),
          tilesPerTick: Number(motion.tilesPerTick.toFixed(4)),
          pos: [Number(cur.x.toFixed(3)), Number(cur.y.toFixed(3))],
          tile: [Math.floor(cur.x), Math.floor(cur.y)],
          screen: stats.squadScreen,
        });
        say(frameLine(view.name, stats));
        say(
          `    ${view.name}: moving=${motion.moving} speed=${motion.speedTilesPerSec.toFixed(2)} tiles/s (${motion.tiles.toFixed(3)} tile over ${motion.windowTicks} ticks) at (${cur.x.toFixed(2)},${cur.y.toFixed(2)})`
        );
        if (!motion.moving) {
          notMoving.push(view.name);
          say(`    ${view.name}: NOT MOVING: ${motion.tiles.toFixed(3)} tile over the last ${motion.windowTicks} ticks (< 0.05): the frame shows a stationary hull`);
        }
      }
    }
  } catch (err) {
    failure = err;
  }
  // The next frame must be the renderer's own again: a wrapper left behind would colour every later shot.
  // (Removed whether or not the run failed; the run's own error wins over the wrapper's.)
  const stillWrapped = (await page.evaluate(VEHICLE_FRAME_UNWRAP_SCRIPT)) as boolean;
  if (failure !== null) throw failure;
  if (stillWrapped) throw new Error(`${TAG}: --vehicle: renderer.frame is still an own property after the vehicle run: the wrapper was not removed`);
  return {
    kind: 'ran',
    frames: shots.length,
    notMoving,
    record: {
      id: found.id,
      typeId: found.typeId,
      marker,
      from,
      target: pick.tile,
      targetKind: pick.kind,
      targetDistance: Number(pick.distance.toFixed(2)),
      minDistance,
      orderTick,
      frameDtMs: Number(VEHICLE_FRAME_DT_MS.toFixed(3)),
      framesPerTick: VEHICLE_FRAMES_PER_TICK,
      emitter,
      weather,
      shots,
    },
  };
}

/** `--clip`: one Playwright `recordVideo` of the LIVE loop (the frame loop is NOT frozen, unlike
 *  every other boot) at the first `--markers` entry, zoom `CLIP_ZOOM`, preset high, music off. The
 *  file is checked to exist and to be non-empty, and the sim must have ticked while it recorded
 *  (rain is on the sim clock: a paused sim would record still rain). */
async function recordClip(
  browser: Browser,
  args: GroundCaptureArgs,
  outDir: string,
  say: (line: string) => void
): Promise<{ path: string; seconds: number; map: string; marker: string; tick0: number; tick1: number }> {
  const ref = args.markers?.[0];
  if (ref === undefined || args.clip === undefined) throw new Error(`${TAG}: --clip needs --markers (the first names the view)`);
  const at = markersFor(ref.map)[ref.marker];
  if (at === undefined) throw new Error(`${TAG}: --clip: map "${ref.map}" has no marker "${ref.marker}"`);
  const dir = path.join(outDir, 'clip');
  fs.mkdirSync(dir, { recursive: true });
  const context = await browser.newContext({
    viewport: CAPTURE_VIEWPORT,
    deviceScaleFactor: 1,
    recordVideo: { dir, size: { width: CAPTURE_VIEWPORT.width, height: CAPTURE_VIEWPORT.height } },
  });
  const page = await context.newPage();
  await page.addInitScript(musicOffInitScript({}, { quality: 'high' }));
  const video = page.video();
  if (video === null) throw new Error(`${TAG}: --clip: Playwright gave the page no video`);
  const url = `http://localhost:${args.port}/?sandbox=${ref.map}&renderer=three`;
  await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
  await page.waitForFunction(() => typeof (window as unknown as LionsWindow).__lions !== 'undefined', null, { timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(2500);
  await page.evaluate(hideHudExceptCanvas);
  await page.evaluate(
    ([x, y, zoom]) => {
      const L = (window as unknown as LionsWindow).__lions;
      L.goto(x, y);
      L.renderer.camera.zoom = zoom;
    },
    [at[0], at[1], CLIP_ZOOM] as const
  );
  const tick0 = (await readRender(page)).tick;
  await page.waitForTimeout(args.clip * 1000);
  const after = await readRender(page);
  assertPresetBooted('high', after);
  assertMotion(false, after);
  await context.close();
  const file = await video.path();
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) throw new Error(`${TAG}: --clip: the recording ${file} is missing or empty`);
  say(`  clip ${ref.map}:${ref.marker} z${CLIP_ZOOM} ${args.clip}s high, live loop, ticks ${tick0} -> ${after.tick}: ${file}`);
  return { path: file, seconds: args.clip, map: ref.map, marker: ref.marker, tick0, tick1: after.tick };
}

/** The run's conditions, recorded with every number (cost.json `_run`), only when a T12 option ran. */
interface RunMeta {
  readonly gl: string;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly deviceScaleFactor: 1;
  readonly passes: readonly string[];
  readonly loadAverage: readonly number[];
  readonly loadAverageAfter?: readonly number[];
  readonly clip?: { path: string; seconds: number; map: string; marker: string; tick0: number; tick1: number };
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
  const claims = new NameClaims();
  const took = {
    presetFrames: {} as Record<string, number>,
    tickFrames: 0,
    reducedFrames: 0,
    clipPath: null as string | null,
    stopFrames: {} as Record<string, number>,
    vehicleFrames: 0,
    vehicleNoVehicle: [] as string[],
    vehicleNotMoving: [] as string[],
    rimFrames: {} as Record<string, number>,
  };
  const passes = planPasses({ quality: args.quality, motion: args.motion });
  const t12 = args.quality !== undefined || args.ticks !== undefined || args.motion !== undefined || args.clip !== undefined || args.stops !== undefined || args.vehicle !== undefined || args.rim !== undefined;
  let meta: RunMeta | null = null;
  let clipTicked = true;
  try {
    const gl = await readUnmaskedRenderer(browser);
    say(`[${TAG}] gl=${gl}`);
    if (t12) {
      say(
        `[${TAG}] legend: drops= counts heads on screen; the rain edge cull tests the LANDING point, so a thin rim of rain ` +
          `(up to 6 * tan 12deg = 1.28 tiles of slant) can overhang the void on the W and S edges and lose its upper air on the E and N edges`
      );
    }
    if (args.vehicle !== undefined) say(`[${TAG}] ${vehicleLegend()}`);
    meta = { gl, viewport: { ...CAPTURE_VIEWPORT }, deviceScaleFactor: 1, passes: passes.map((p) => `${p.preset}${p.reduced ? '+reduced' : ''}`), loadAverage: os.loadavg().map((v) => Number(v.toFixed(2))) };
    for (const pass of passes) {
      if (!pass.full || t12) say(`[${TAG}] pass preset=${pass.preset} motion=${pass.reduced ? 'reduce' : 'system'}${pass.full ? ' (baseline: every view)' : ' (marker views)'}`);
      // One context per pass: the preset and the motion setting apply at BOOT, from the settings
      // seed the init script writes, so each pass is a fresh browser context (a fresh localStorage).
      const context = await browser.newContext({ viewport: CAPTURE_VIEWPORT, deviceScaleFactor: 1 });
      try {
        const page = await context.newPage();
        await page.addInitScript(musicOffInitScript({}, { quality: pass.preset }, pass.reduced ? { motion: 'reduce' } : {}));
        const pageErrors: string[] = [];
        page.on('pageerror', (err) => pageErrors.push(err.message));

        for (const mapId of args.maps) {
          const rows = rowsFor(mapId);
          const extra = args.decals ? '&decals' : '';
          const wanted = (args.markers ?? []).filter((m) => m.map === mapId).map((m) => m.marker);
          if (!pass.full && wanted.length === 0) {
            say(`  ${pass.preset}${pass.suffix}: ${mapId} has no --markers, its views are not repeated`);
            continue;
          }
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
          say(`boot ${mapId}${extra}${pass.full ? '' : ` ${pass.suffix.slice(1)}`} (dev server confirmed on :${actualPort})`);
          const cache: HeightCache = { sampler: null, loaded: false };
          const ctx: ShotCtx = { pass, claims, cache };
          const table = markersFor(mapId);
          const views = viewsFor(mapId, rows, wanted, table, args.zooms);

          if (!pass.full) {
            const mine = cost[mapId];
            if (mine === undefined) throw new Error(`${TAG}: no baseline cost record for ${mapId}`);
            for (const view of suffixedViews(views, mapId, wanted, pass.suffix)) {
              const stats = await shot(page, outDir, view, ctx);
              mine.views[view.name] = stats;
              if (pass.reduced) took.reducedFrames++;
              else took.presetFrames[pass.preset] = (took.presetFrames[pass.preset] ?? 0) + 1;
              say(frameLine(view.name, stats));
            }
            continue;
          }

          const familyJson = (await page.evaluate(DECOR_FAMILY_SCRIPT)) as string;
          const familyTotals = JSON.parse(familyJson) as Record<string, number>;
          const familyEntries = Object.entries(familyTotals).sort(([a], [b]) => a.localeCompare(b));
          say(
            `  decor families LOADED (geometry tris, not placement-multiplied): ` +
              (familyEntries.length > 0
                ? familyEntries.map(([f, t]) => `${f}=${t}`).join(', ')
                : '(none -- decorSet empty, or this build has no decorSet field)')
          );

          const viewCosts: Record<string, FrameRecord> = {};
          for (const view of views) {
            const stats = await shot(page, outDir, view, ctx);
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
                const stats = await shot(page, outDir, view, ctx);
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
          // GH-871 P4 T12. The tick strips: each marker view at the strip zoom, then `--ticks`
          // frames with the sim stepped ONE tick between them. They come after the tick-0 frames
          // (the sim has moved on) and before the wade and the stops (which step it a long way).
          if (args.ticks !== undefined) {
            // Interleaved: step ONCE, then photograph every marker at that tick, so each marker's
            // strip is the same ticks t1..tn (the sim cannot be rewound per marker).
            const strip = suffixedViews(views, mapId, wanted, '').filter((v) => v.zoom === TICK_STRIP_ZOOM);
            for (let k = 0; k < args.ticks; k++) {
              const tick = (await page.evaluate(() => (window as unknown as LionsWindow).__lions.step(1))) as number;
              for (const view of strip) {
                const tv: MapView = { ...view, name: tickName(view.name, tick) };
                const stats = await shot(page, outDir, tv, ctx);
                if (stats.tick !== tick) throw new Error(`${TAG}: ${tv.name} was stepped to tick ${tick} but the frame reads tick ${stats.tick}`);
                took.tickFrames++;
                viewCosts[tv.name] = stats;
                say(frameLine(tv.name, stats));
              }
            }
          }
          if (args.wade !== undefined && args.wade.map === mapId) {
            const tile = await wadeSquad(page, say, mapId, args.wade.marker, rows, table);
            for (const view of wadeViews(mapId, tile)) {
              const stats = await shot(page, outDir, view, ctx);
              viewCosts[view.name] = stats;
              say(frameLine(view.name, stats));
            }
          }
          // GH-871 P4 T12. The infantry readability stops: the same first infantry entity as
          // the wade, walked by a `move` Command to a road, an interior water and an interior
          // grass tile near the map's first marker, photographed where it stands.
          if (args.stops !== undefined && wanted.length > 0) {
            const markerName = wanted[0];
            const from = table[markerName];
            const id = (await page.evaluate(FIRST_INFANTRY_SCRIPT)) as number;
            if (id < 0) throw new Error(`${TAG}: --stops: map "${mapId}" has no living side-0 infantry to order`);
            for (const kind of args.stops) {
              const pick = stopTile(rows, from, kind);
              if (pick === null) throw new Error(`${TAG}: --stops: map "${mapId}" has no ${kind} tile`);
              if (kind !== 'road' && pick.nonKind > 0) {
                say(`  stop ${mapId} ${kind}: no interior ${kind} tile; using (${pick.tile[0]},${pick.tile[1]}) with ${pick.nonKind} non-${kind} neighbours`);
              }
              const walk = await walkSquad(page, id, pick.tile, STOP_MODE);
              const outcome = stopOutcome(walk.pos, pick.tile);
              const under = standsOn(rows, walk.pos);
              const where = `(${pick.tile[0]},${pick.tile[1]}) near ${markerName}`;
              const at = `at (${walk.pos.x.toFixed(2)},${walk.pos.y.toFixed(2)}) on '${under}', tick ${walk.pos.tick}`;
              say(
                outcome === 'ARRIVED'
                  ? `  stop ${mapId} ${kind}: entity ${id} ARRIVED at ${where} after ${walk.spent} ticks, settled ${STOP_SETTLE_TICKS} (${at})`
                  : `  stop ${mapId} ${kind}: entity ${id} ${outcome} at ${where} in ${walk.spent} ticks; ${at}`
              );
              // The frame shows the squad where it STANDS: say so when that is not the requested kind.
              if (under !== stopGlyph(kind)) say(`  stop ${mapId} ${kind}: NOT ON ${kind}: the lead entity stands on '${under}', not '${stopGlyph(kind)}'`);
              const view: MapView = { name: stopName(mapId, kind), x: walk.pos.x, y: walk.pos.y, zoom: STOP_ZOOM, fog: false };
              const stats = await shot(page, outDir, view, { ...ctx, track: id });
              const stopRecord: StopRecord = {
                kind,
                tile: pick.tile,
                nonKind: pick.nonKind,
                arrived: walk.arrived,
                ticks: walk.spent,
                outcome,
                standsOn: under,
                onStop: isOnStop(rows, kind, pick.tile, walk.pos),
              };
              viewCosts[view.name] = { ...stats, stop: stopRecord };
              took.stopFrames[kind] = (took.stopFrames[kind] ?? 0) + 1;
              say(frameLine(view.name, viewCosts[view.name]));
              // GH-871 P4 PR 914. The same frozen view, repainted at each rim gain (zero elapsed time, the
              // sim not stepped, the camera and the squad where the plain frame left them), then the
              // knob put back so the NEXT stop's plain frame is at the shipped default again.
              if (args.rim !== undefined) {
                const before = await readRim(page);
                for (const rimView of rimViews(view, args.rim)) {
                  const gain = rimView.rim;
                  const rimStats = await shot(page, outDir, rimView, { ...ctx, track: id });
                  viewCosts[rimView.name] = { ...rimStats, stop: stopRecord };
                  took.rimFrames[String(gain)] = (took.rimFrames[String(gain)] ?? 0) + 1;
                  say(frameLine(rimView.name, viewCosts[rimView.name]));
                }
                await page.evaluate((g) => (window as unknown as LionsWindow).__lions.renderer.debugSetRainRim?.(g), before.gain);
                assertRimApplied(`${view.name} (the knob put back)`, before.gain, await readRim(page));
              }
            }
          }
          // S-L2 ruling 4. After the stops: one ordered vehicle, stepped a tick at a time, for the mud spray.
          let vehicleRecord: VehicleRecord | undefined;
          if (args.vehicle !== undefined && wanted.length > 0) {
            const markerName = args.vehicle.marker ?? wanted[0];
            if (!wanted.includes(markerName)) {
              say(`  vehicle ${mapId}: marker ${markerName} is not one of this map's --markers, no vehicle run here`);
            } else {
              const run = await driveVehicle(page, say, outDir, ctx, viewCosts, mapId, rows, markerName, table[markerName]);
              if (run.kind === 'none') took.vehicleNoVehicle.push(mapId);
              else {
                vehicleRecord = run.record;
                took.vehicleFrames += run.frames;
                took.vehicleNotMoving.push(...run.notMoving);
              }
            }
          }
          cost[mapId] = { views: viewCosts, layers, decorFamiliesLoaded: familyTotals, ...(vehicleRecord === undefined ? {} : { vehicle: vehicleRecord }) };
          say(
            `  cost ${mapId} centre z1 nofog: all calls=${base.calls} tris=${base.triangles} | ` +
              layers
                .map((l) => (l.calls === 'n/a' ? `${l.layer} n/a` : `${l.layer} -${l.calls} calls / -${l.triangles} tris`))
                .join(' | ')
          );
        }

        if (pageErrors.length > 0) say(`page errors: ${pageErrors.slice(0, 5).join(' | ')}`);
      } finally {
        await context.close();
      }
    }

    if (args.clip !== undefined) {
      const clip = await recordClip(browser, args, outDir, say);
      took.clipPath = clip.path;
      clipTicked = clip.tick1 > clip.tick0;
      meta = { ...meta, clip };
    }
  } finally {
    await browser.close();
    const out: Record<string, unknown> = { ...cost };
    if (t12 && meta !== null) out._run = { ...meta, loadAverageAfter: os.loadavg().map((v) => Number(v.toFixed(2))) };
    fs.writeFileSync(path.join(outDir, 'cost.json'), JSON.stringify(out, null, 2) + '\n');
    stopDevServer(server, TAG);
  }
  const failures = requestedModeFailures(args, took);
  if (!clipTicked) failures.push('--clip: the sim did not tick while the clip recorded (a paused sim records still rain)');
  if (reflectRunFailed(args.reflect, reflectFrames)) {
    failures.push(
      '--reflect was given but no -r frame was taken (no map in --maps had a marker view on wet ground): there is no A/B'
    );
  }
  for (const f of failures) say(`[${TAG}] ERROR: ${f}`);
  finish(failures.length > 0 ? 1 : 0);
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
