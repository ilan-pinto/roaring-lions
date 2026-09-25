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
import { ensureDevServer, readUnmaskedRenderer, stopDevServer } from '../golden-diff/browser';
import { CAPTURE_VIEWPORT, FREEZE_FRAME_LOOP_SCRIPT, hideHudExceptCanvas } from '../golden-diff/capture-protocol';
import { gpuLaunchArgs } from '../ui-review/gpu';

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

export function parseGroundCaptureArgs(argv: readonly string[]): GroundCaptureArgs {
  const rawPort = flag(argv, 'port');
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
  const reuse = argv.includes('--reuse');

  return { port, out, maps, decals, reuse };
}

export interface MapView {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
  readonly fog: boolean;
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

export function viewsFor(mapId: string, rows: readonly string[]): readonly MapView[] {
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
  return views;
}

/** What `layerCost` measures the price of, in the order it reports them.
 *  `decals` sits before `scorch` deliberately -- see this file's header,
 *  difference 2: after Task 13, on THIS branch `decals` resolves and
 *  `scorch` throws (retired, D5/R-17), and on main it is the other way
 *  round, so the one array measures both trees. */
export const COST_LAYERS: readonly string[] = ['scatter', 'decor', 'units', 'buildings', 'decals', 'scorch'];

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
    renderer: {
      readonly canvas: HTMLCanvasElement;
      camera: { x: number; y: number; zoom: number };
      frame(alpha: number, dtMs: number): void;
      setDebugLayerVisible(name: string, visible: boolean): number;
    };
  };
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

interface ViewStats {
  readonly calls: number;
  readonly triangles: number;
  readonly textures: number;
  readonly geometries: number;
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

async function shot(page: Page, out: string, view: MapView): Promise<ViewStats> {
  const rect = await page.evaluate(
    ([x, y, zoom, fog]) => {
      const L = (window as unknown as LionsWindow).__lions;
      L.goto(x, y);
      L.renderer.camera.zoom = zoom;
      L.renderer.setDebugLayerVisible('fog', fog);
      L.renderer.frame(1, 0);
      L.renderer.frame(1, 0);
      const c = L.renderer.canvas.getBoundingClientRect();
      return { x: c.x, y: c.y, w: c.width, h: c.height };
    },
    [view.x, view.y, view.zoom, view.fog] as const
  );
  const stats = await readStats(page);
  await page.screenshot({
    path: path.join(out, `${view.name}.png`),
    clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h },
  });
  return stats;
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

function rowsFor(mapId: string): readonly string[] {
  const table = ALL_MAPS as unknown as Record<string, { readonly rows?: readonly string[] } | undefined>;
  const entry = table[mapId];
  if (entry?.rows === undefined) {
    throw new Error(`${TAG}: no map "${mapId}" in @lions/data (have: ${Object.keys(ALL_MAPS).join(', ')})`);
  }
  return entry.rows;
}

interface MapCost {
  readonly views: Record<string, ViewStats>;
  readonly layers: readonly LayerDelta[];
}

async function main(): Promise<void> {
  const args = parseGroundCaptureArgs(process.argv.slice(2));
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

  const browser = await chromium.launch({ headless: true, args: gpuLaunchArgs('metal') });
  const cost: Record<string, MapCost> = {};
  try {
    say(`[${TAG}] gl=${await readUnmaskedRenderer(browser)}`);
    const page = await browser.newPage({ viewport: CAPTURE_VIEWPORT, deviceScaleFactor: 1 });
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    for (const mapId of args.maps) {
      const rows = rowsFor(mapId);
      const extra = args.decals ? '&decals' : '';
      await boot(page, args.port, mapId, extra);
      say(`boot ${mapId}${extra}`);

      const views = viewsFor(mapId, rows);
      const viewCosts: Record<string, ViewStats> = {};
      for (const view of views) {
        const stats = await shot(page, outDir, view);
        viewCosts[view.name] = stats;
        say(`  ${view.name}: calls=${stats.calls} tris=${stats.triangles} tex=${stats.textures} geo=${stats.geometries}`);
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
      cost[mapId] = { views: viewCosts, layers };
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
