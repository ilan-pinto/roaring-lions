/**
 * Kitted vehicles in the running game (GH-238, plan 3 Task 8): `pnpm kit:capture`.
 *
 *   pnpm kit:capture                         sheets: 8 vehicles x L0-L3 x zoom 1.0 / 2.5
 *   pnpm kit:capture -- --only=mbt_lavi      sheets for a subset (comma list)
 *   pnpm kit:capture -- --garage             the bay's turntable at L3 (and the Lavi at L0)
 *   pnpm kit:capture -- --toggle             the `kit` layer toggle A/B, for the `kitted` floor
 *   pnpm kit:capture -- --port=5233 --gpu=swiftshader
 *
 * Every flag is checked: an unknown one, or `--garage` with `--toggle`, exits 2
 * before anything starts. The tool boots its OWN dev server (default :5232)
 * and refuses a port something else already holds (`ui-review/port.ts`), so
 * it can never photograph another checkout. Every page is seeded music off
 * (`ui-review/music-off.ts`), one browser is open at a time, and the server
 * is stopped by process group on every exit path.
 *
 * ## Sheets (default)
 *
 * One fresh browser per kit level L = 0..3. Each is seeded with a brigade
 * account (`ui-review/garage-seed.ts`'s shape) in which each of the eight
 * vehicles holds EVERY track it declares at L, clamped to the track's length
 * (the D9 has two tracks), and boots `/free-play/beit_sahwan_outskirts`
 * WITHOUT `&kit` -- so the tiers reach the renderer the way a player's do,
 * through `bootTiers` -> `upgradePrepass` -> `RendererOptions.unitKitTiers`,
 * not through the sandbox ladder. The sandbox force is struck
 * (`removeFromPlay`, `unit-plates.ts`' reason: nothing may fight), the frame
 * loop is frozen (`FREEZE_FRAME_LOOP_SCRIPT`), and the eight are spawned at
 * one facing on open tiles well apart on screen, at an absolute tick, then
 * stepped to an absolute capture tick, so every level photographs the same
 * idle phase. Each vehicle is then framed by the game's own camera (camera
 * centred on its tile, zoom 1.0 and 2.5, the gate's pitch because it IS the
 * game's camera), repainted with zero elapsed time (`frame(1, 0)`), and
 * photographed by a page screenshot clipped to a fixed box per zoom.
 *
 * Before any cell is trusted, the MERGE is checked from the renderer itself,
 * not from the account: the type's tiers as the renderer received them
 * (`opts.unitKitTiers`), and its template's triangle count and kit triangle
 * count (`rlKitBaseCount`, `three/units/vehicle-kit.ts`). Those are held
 * against the GLB the dev server serves (`assets/meshes/vehicles/<id>.glb`,
 * whose `kit_<track>_<tier>_<host>` nodes are read off its JSON chunk): a
 * vehicle whose GLB carries a part its tiers own must show kit triangles, one
 * that carries none must show none, L0 must draw the shipped template, and the
 * kit may only grow with L. Any contradiction exits 1 -- a silent no-op (the
 * seed not arriving, a merge that kept nothing) is exactly the failure a sheet
 * of identical pictures would otherwise hide. A vehicle with no kit grafted yet
 * is printed as such and simply looks the same in every column.
 *
 * The facing is MEASURED, not guessed: the sim's facing is `atan2(dy, dx)` in
 * turns (`sim.ts`, `spawn`'s own doc), so a hull at facing f points along
 * tile vector (cos 2 pi f, sin 2 pi f); the tool projects that vector through
 * the live `renderer.worldToScreen` for 64 candidate facings and keeps the one
 * whose nose points closest to `TARGET_SCREEN_DIR` -- up-screen and to the
 * left, so the camera sees the hull's flank and its rear (where the slat cage
 * and the stowage sit). That is the view of the mock's heading 60; the mock's
 * heading 240 (`kit_blockout.py`'s `HEADINGS_MOCK`) is the FRONT
 * three-quarter, nose toward the camera. The chosen facing and its screen
 * angle are printed and written on the sheet.
 *
 * Outputs (left on disk; Task 10 regenerates and commits them):
 *   docs/art/sheets/kitted-vehicles/final/cells/<id>_z<zoom>_L<L>.png
 *   docs/art/sheets/kitted-vehicles/final/zoom1.0.png, zoom2.5.png
 * The composites are laid out as HTML and photographed by the browser, so the
 * labels need no image library beyond what `tools` already has.
 *
 * ## `--garage`
 *
 * The account holds the eight vehicles bought and at L3 (and credits); the
 * tool opens `/brigade`, selects each vehicle's card, waits for the turntable
 * to report its first frame (`data-model="live"`, `data-frames`), focuses it
 * (which stops the auto-turn) and photographs the plate at the default face
 * (Home, 0 deg) and the far side (End, 180 deg). Then the Lavi again from an
 * account at L0. Writes `final/garage-<id>.png` and `final/garage-mbt_lavi-L0.png`.
 * Until the garage view takes tiers (plan Task 7b) the L0 and L3 bays are
 * expected to match; the tool reports what it saw rather than asserting it.
 *
 * ## `--toggle`
 *
 * The floor for the `kitted` golden scenario's `kit` layer check, measured
 * through the GATE'S OWN code: `capture()`/`rephotograph()`
 * (`golden-diff/browser.ts`), `captureScript`/`threeUrl`/`REPAINT_SCRIPT`/
 * `layerToggleScript` (`golden-diff/capture-protocol.ts`), `computeDiff`
 * (`golden-diff/diff.ts`) at the gate's pixelmatch threshold, in the gate's
 * own browser (`launchCaptureBrowser`, SwiftShader) at its viewport. The
 * scenario is `VEHICLE_SCENARIO` plus `&kit`, captured in three fresh page
 * loads; each prints the repaint control and the toggle, then the three
 * readings and a third of the smallest. `pnpm golden-baseline` is NOT run.
 *
 * Then the falsification, every time: the same capture with the bare
 * `VEHICLE_SCENARIO` URL (no `&kit`, and a fresh browser context, so the
 * brigade account is empty) hands `applyVehicleKit` empty tiers for every
 * type -- the honest way to give the renderer no kit, through the same boot a
 * player takes, with no debug path in the app. The `kit` toggle must then
 * report 0 kitted geometries and move 0 px / 0.0000; anything else exits 1.
 */
import { chromium, type Browser, type Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ensureDevServer, stopDevServer, readUnmaskedRenderer, capture, rephotograph, launchCaptureBrowser } from '../golden-diff/browser';
import {
  CAPTURE_VIEWPORT,
  FREEZE_FRAME_LOOP_SCRIPT,
  KITTED_SCENARIO,
  REPAINT_SCRIPT,
  VEHICLE_SCENARIO,
  captureScript,
  hideHudExceptCanvas,
  layerToggleScript,
  threeUrl,
  type Scenario,
} from '../golden-diff/capture-protocol';
import { computeDiff, type DiffSummary } from '../golden-diff/diff';
import { musicOffInitScript, SILENT_AUDIO } from '../ui-review/music-off';
import { garageSeedScript, GARAGE_SEED_LEDGER } from '../ui-review/garage-seed';
import { claimPort } from '../ui-review/port';
import { gpuLaunchArgs, resolveGpuBackend, type GpuBackend } from '../ui-review/gpu';
import type { BrigadeAccount } from '../../../packages/app/src/brigade-account';
import { ACCOUNT_VERSION } from '../../../packages/app/src/brigade-account';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const TAG = 'kit-capture';
const PORT_ENV = 'KIT_CAPTURE_PORT';
const DEFAULT_PORT = 5232;

/** The eight KDF vehicles plan 3 kits, in the sheet's row order. */
const VEHICLES = [
  'mbt_lavi',
  'ifv_namer',
  'apc_eitan',
  'apc_kipod',
  'jeep_shoded',
  'scout_shachaf',
  'dozer_d9',
  'heli_peten',
] as const;
type VehicleId = (typeof VEHICLES)[number];
const LEVELS = [0, 1, 2, 3] as const;
const ZOOMS = [1.0, 2.5] as const;

const MAP_ID = 'beit_sahwan_outskirts';
const SHEET_DIR = path.join(REPO_ROOT, 'docs/art/sheets/kitted-vehicles/final');
const CELL_DIR = path.join(SHEET_DIR, 'cells');
const TOGGLE_DIR = path.join(REPO_ROOT, '.superpowers/kit/toggle');
/** The gate's own pixelmatch threshold (`three-baseline-gate.ts`'s
 *  `PIXELMATCH_THRESHOLD`, not exported there; pixelmatch's default). */
const PIXELMATCH_THRESHOLD = 0.1;

/** The parade: tiles picked so that nothing but the vehicle and open ground
 *  stands in its zoom-2.5 box. Judged ON SCREEN, through the live camera
 *  (`worldToScreen` at zoom 2.5), not in tile distance: a Chebyshev spacing
 *  put a neighbour's slat cage in the Eitan's corner and a rooftop in the
 *  jeep's, because what reaches into a box is a neighbour's HULL and a
 *  building's HEIGHT, both of which stand up-screen of their tiles.
 *
 *  A tile is refused when any non-open map tile (any symbol but `.`, read
 *  from the map JSON: buildings, walls, cover, roads, groves and their
 *  decor) projects inside the box widened by `OBSTACLE_SIDE_PX` and
 *  lengthened downward by `OBSTACLE_RISE_PX` (a tile below the box can
 *  still rise into it), or when an already-picked vehicle does the same
 *  with `HULL_PX` all round. `EDGE_TILES` keeps the off-map skirt out. */
const EDGE_TILES = 4;
const OBSTACLE_SIDE_PX = 48;
const OBSTACLE_RISE_PX = 240;
const HULL_PX = 160;
/** Absolute ticks: spawn after the boot's own ticks, capture after two 1 Hz
 *  mesh sweeps (`main.ts` loads an unrostered type's mesh on
 *  `tickCount % 20 === 0`). The same pair at every level, so every column
 *  shows the same idle phase. */
const SPAWN_TICK = 40;
const SWEEP_TICK = 60;
const CAPTURE_TICK = 80;
/** The box each cell is clipped to, in CSS px at DPR 1, centred on the
 *  vehicle's ground point raised by `lift` (an aircraft flies `AIR_LIFT_PX`
 *  above its tile and every hull stands up-screen of its footprint). One box
 *  per zoom, so every cell of a vehicle -- and of every vehicle -- is the
 *  same size. */
const BOX: Readonly<Record<string, { w: number; h: number; lift: number }>> = {
  '1.0': { w: 200, h: 160, lift: 12 },
  '2.5': { w: 380, h: 320, lift: 30 },
};
/** Where the nose should point on screen: up and to the left, 60 degrees
 *  above the horizontal -- flank and rear toward the camera. */
const TARGET_SCREEN_DIR = { x: -Math.cos(Math.PI / 3), y: -Math.sin(Math.PI / 3) };
const FACING_CANDIDATES = 64;
const FIXED = 65536;

// ---------------------------------------------------------------- argv ----

type Mode = 'sheets' | 'garage' | 'toggle';

interface Args {
  mode: Mode;
  only: VehicleId[];
  gpu: GpuBackend;
}

function usage(msg: string): never {
  console.error(`[${TAG}] ${msg}`);
  console.error(
    `[${TAG}] usage: pnpm kit:capture -- [--garage | --toggle] [--only=<id>[,<id>...]] [--port=<n>] [--gpu=metal|swiftshader]`
  );
  process.exit(2);
}

function parseArgs(argv: readonly string[]): Args {
  let garage = false;
  let toggle = false;
  let only: VehicleId[] = [...VEHICLES];
  for (const a of argv) {
    if (a === '--') continue;
    if (a === '--garage') garage = true;
    else if (a === '--toggle') toggle = true;
    else if (a.startsWith('--only=')) {
      const ids = a.slice('--only='.length).split(',').filter((s) => s.length > 0);
      if (ids.length === 0) usage('--only= names no vehicle');
      for (const id of ids) {
        if (!(VEHICLES as readonly string[]).includes(id)) usage(`--only: "${id}" is not one of ${VEHICLES.join(', ')}`);
      }
      only = VEHICLES.filter((v) => ids.includes(v));
    } else if (a.startsWith('--port=') || a.startsWith('--gpu=')) {
      // Parsed (and refused when malformed) by `claimPort` / `resolveGpuBackend`.
    } else usage(`unknown argument "${a}"`);
  }
  if (garage && toggle) usage('--garage and --toggle are separate runs; pick one');
  let gpu: GpuBackend;
  try {
    gpu = resolveGpuBackend(argv, process.platform);
  } catch (err) {
    usage(err instanceof Error ? err.message : String(err));
  }
  if (toggle && argv.some((a) => a.startsWith('--gpu='))) {
    usage('--toggle runs in the gate\'s own browser (SwiftShader, launchCaptureBrowser); --gpu does not apply');
  }
  return { mode: garage ? 'garage' : toggle ? 'toggle' : 'sheets', only, gpu };
}

// ------------------------------------------------------------- data ----

interface UnitJson {
  name: string;
  upgrades?: Record<string, { tiers: unknown[] }>;
}

function unitJson(id: string): UnitJson {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'data/units/kdf', `${id}.json`), 'utf8')) as UnitJson;
}

/** Every track the unit declares, at `level`, clamped to the track's length. */
function tiersAt(id: string, level: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [track, t] of Object.entries(unitJson(id).upgrades ?? {})) out[track] = Math.min(level, t.tiers.length);
  return out;
}

/** The brigade account a level boots from: every vehicle in `ids` at `level`
 *  on every track, all eight bought, credits on hand. `garage-seed.ts`'s
 *  shape, including the `granted` entry that keeps `balance` a fixed point of
 *  `migrateAccount`. */
function accountAt(level: number, ids: readonly string[] = VEHICLES): BrigadeAccount {
  const upgrades: Record<string, Record<string, number>> = {};
  for (const id of ids) upgrades[id] = tiersAt(id, level);
  return {
    version: ACCOUNT_VERSION,
    balance: 2400,
    earned_total: 0,
    paid: {},
    campaign_paid: {},
    unlocks: [...VEHICLES],
    upgrades,
    grants: [{ source: 'granted', amount: 5000, at: 1 }],
  };
}

interface KitNode {
  name: string;
  track: string;
  tier: number;
}

/** The `kit_<track>_<tier>_<host>` nodes of the GLB the dev server serves
 *  (`publicDir` is `assets/`), read off the GLB's JSON chunk -- Draco only
 *  compresses accessors, so node names are plain JSON. */
function glbKitNodes(id: string): KitNode[] {
  const file = path.join(REPO_ROOT, 'assets/meshes/vehicles', `${id}.glb`);
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file} is not a GLB`);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as { nodes?: { name?: string }[] };
  const out: KitNode[] = [];
  for (const n of json.nodes ?? []) {
    const m = /^kit_([a-z]+)_(\d+)_/.exec(n.name ?? '');
    if (m) out.push({ name: n.name ?? '', track: m[1], tier: Number(m[2]) });
  }
  return out;
}

function shortCommit(): string {
  try {
    return execFileSync('/usr/bin/git', ['-C', REPO_ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

// --------------------------------------------------------- page types ----

interface TemplateGeometry {
  index: { count: number } | null;
  attributes: { position: { count: number } };
  userData: Record<string, unknown>;
}

interface LionsWindow {
  __lions: {
    step(n: number): number;
    sim: {
      width: number;
      height: number;
      tickCount: number;
      blocked: Uint8Array;
      entityCount: number;
      state: { alive: Uint8Array };
      unitTypes: { id: string }[];
      spawn(typeIdx: number, side: number, x: number, y: number, facing?: number): number;
      removeFromPlay(id: number): void;
    };
    renderer: {
      camera: { x: number; y: number; zoom: number };
      setDebugLayerVisible(name: string, visible: boolean): number;
      frame(alpha: number, dtMs: number): void;
      worldToScreen(wx: number, wy: number): { x: number; y: number };
      // Private on `ThreeRenderer`; read here as a capture instrument, never written.
      opts?: { unitKitTiers?: Record<string, Record<string, number>> };
      vehicleMeshTemplates?: Map<string, { geometries: TemplateGeometry[] }>;
    };
  };
}

/** What the renderer holds for one vehicle at one level. */
interface MergeReading {
  tiers: Record<string, number> | null;
  loaded: boolean;
  tris: number;
  kitTris: number;
  kittedGeometries: number;
}

// ------------------------------------------------------------- helpers ----

async function bootSandbox(page: Page, base: string): Promise<void> {
  await page.goto(`${base}/free-play/${MAP_ID}`, { waitUntil: 'load', timeout: 60_000 });
  await page.waitForFunction(() => !!(window as unknown as LionsWindow).__lions?.renderer, null, { timeout: 60_000 });
  // Frozen at once: from here the sim advances only on an explicit step().
  await page.evaluate(FREEZE_FRAME_LOOP_SCRIPT);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(hideHudExceptCanvas);
  await page.evaluate(() => {
    const L = (window as unknown as LionsWindow).__lions;
    // fog: the sandbox force that lifted it is struck below. overlays: no
    // HP bar or ring. wind: foliage at rest, so grass is the same in every cell.
    for (const layer of ['fog', 'overlays', 'wind']) L.renderer.setDebugLayerVisible(layer, false);
    for (let i = 0; i < L.sim.entityCount; i++) if (L.sim.state.alive[i] === 1) L.sim.removeFromPlay(i);
  });
}

/** `n` parade tiles -- see `EDGE_TILES`' comment -- scanned row-major from
 *  the top of the map. Deterministic: the same map gives the same tiles at
 *  every level. */
async function paradeTiles(page: Page, n: number): Promise<[number, number][]> {
  const rows = (JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'data/maps', `${MAP_ID}.json`), 'utf8')) as { rows: string[] })
    .rows;
  const obstacles: [number, number][] = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] !== '.') obstacles.push([x, y]);
  });
  const box = BOX['2.5'];
  const tiles = await page.evaluate(
    ([count, obs, edge, bw, bh, lift, side, rise, hull]) => {
      const L = (window as unknown as LionsWindow).__lions;
      const r = L.renderer;
      const w = L.sim.width;
      const h = L.sim.height;
      r.camera.x = w / 2;
      r.camera.y = h / 2;
      r.camera.zoom = 2.5;
      const top = -lift - bh / 2;
      const bottom = -lift + bh / 2;
      const picked: [number, number][] = [];
      for (let ty = edge; ty < h - edge && picked.length < count; ty++) {
        for (let tx = edge; tx < w - edge && picked.length < count; tx++) {
          if (L.sim.blocked[ty * w + tx] !== 0) continue;
          const c = r.worldToScreen(tx + 0.5, ty + 0.5);
          let ok = true;
          for (const o of obs) {
            const p = r.worldToScreen(o[0] + 0.5, o[1] + 0.5);
            const ox = p.x - c.x;
            const oy = p.y - c.y;
            if (Math.abs(ox) < bw / 2 + side && oy > top - side && oy < bottom + rise) {
              ok = false;
              break;
            }
          }
          for (const q of picked) {
            if (!ok) break;
            const p = r.worldToScreen(q[0] + 0.5, q[1] + 0.5);
            const ox = p.x - c.x;
            const oy = p.y - c.y;
            if (Math.abs(ox) < bw / 2 + hull && oy > top - hull && oy < bottom + hull) ok = false;
          }
          if (ok) picked.push([tx, ty]);
        }
      }
      return picked;
    },
    [n, obstacles, EDGE_TILES, box.w, box.h, box.lift, OBSTACLE_SIDE_PX, OBSTACLE_RISE_PX, HULL_PX] as [
      number,
      [number, number][],
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ]
  );
  if (tiles.length < n) throw new Error(`only ${tiles.length} of ${n} parade tiles found on ${MAP_ID}`);
  return tiles;
}

/** The facing (turns) whose nose projects closest to `TARGET_SCREEN_DIR`
 *  through the live camera -- see the top comment. */
async function measureFacing(page: Page, at: [number, number]): Promise<{ turns: number; screenDeg: number }> {
  return page.evaluate(
    ([x, y, tdx, tdy, n]) => {
      const r = (window as unknown as LionsWindow).__lions.renderer;
      const o = r.worldToScreen(x, y);
      let best = { turns: 0, screenDeg: 0, score: -2 };
      for (let i = 0; i < n; i++) {
        const turns = i / n;
        const p = r.worldToScreen(x + Math.cos(turns * 2 * Math.PI), y + Math.sin(turns * 2 * Math.PI));
        const dx = p.x - o.x;
        const dy = p.y - o.y;
        const len = Math.hypot(dx, dy);
        const score = (dx * tdx + dy * tdy) / len;
        if (score > best.score) best = { turns, screenDeg: (Math.atan2(-dy, dx) * 180) / Math.PI, score };
      }
      return { turns: best.turns, screenDeg: best.screenDeg };
    },
    [at[0], at[1], TARGET_SCREEN_DIR.x, TARGET_SCREEN_DIR.y, FACING_CANDIDATES] as [number, number, number, number, number]
  );
}

async function readMerge(page: Page, ids: readonly string[]): Promise<Record<string, MergeReading>> {
  return page.evaluate((wanted) => {
    const r = (window as unknown as LionsWindow).__lions.renderer;
    const out: Record<string, MergeReading> = {};
    for (const id of wanted) {
      const tiers = r.opts?.unitKitTiers?.[id] ?? null;
      const t = r.vehicleMeshTemplates?.get(id);
      let tris = 0;
      let kitTris = 0;
      let kitted = 0;
      if (t) {
        for (const g of t.geometries) {
          const count = g.index ? g.index.count : g.attributes.position.count;
          tris += count / 3;
          const base = g.userData.rlKitBaseCount;
          if (typeof base === 'number') {
            kitTris += (count - base) / 3;
            kitted++;
          }
        }
      }
      out[id] = { tiers: tiers ? { ...tiers } : null, loaded: !!t, tris, kitTris, kittedGeometries: kitted };
    }
    return out;
  }, ids);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** A labelled grid, laid out as HTML and photographed by the browser that
 *  is already open. Cells are embedded as data URIs at 1:1. */
async function composeSheet(
  browser: Browser,
  outFile: string,
  title: string,
  footer: string,
  columns: readonly string[],
  rows: readonly { label: string; cells: readonly (string | null)[] }[]
): Promise<void> {
  const img = (file: string | null): string =>
    file && fs.existsSync(file)
      ? `<img src="data:image/png;base64,${fs.readFileSync(file).toString('base64')}">`
      : '<div class="missing">not captured</div>';
  const head = columns.map((c) => `<th>${c}</th>`).join('');
  const body = rows
    .map((r) => `<tr><th class="row">${r.label}</th>${r.cells.map((c) => `<td>${img(c)}</td>`).join('')}</tr>`)
    .join('\n');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin: 0; background: #c6b79c; color: #1f1a14; font: 14px/1.3 -apple-system, Helvetica, Arial, sans-serif; }
    #sheet { display: inline-block; padding: 14px 18px; }
    h1 { font-size: 18px; margin: 0 0 8px; font-weight: 600; }
    table { border-collapse: separate; border-spacing: 6px; }
    th { font-weight: 600; text-align: center; }
    th.row { text-align: left; padding-right: 8px; white-space: nowrap; }
    td { padding: 0; }
    img { display: block; }
    .missing { padding: 20px; color: #6b1d1d; }
    p { margin: 8px 0 0; font-size: 12px; }
  </style></head><body><div id="sheet"><h1>${title}</h1>
  <table><tr><th></th>${head}</tr>${body}</table><p>${footer}</p></div></body></html>`;
  // music-off: exempt -- a static HTML page with no game in it.
  const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
  try {
    await page.setContent(html, { waitUntil: 'load' });
    await page.locator('#sheet').screenshot({ path: outFile });
  } finally {
    await page.close();
  }
}

// -------------------------------------------------------------- sheets ----

interface LevelResult {
  merge: Record<string, MergeReading>;
  facing: { turns: number; screenDeg: number };
  tiles: [number, number][];
}

async function captureLevel(
  browser: Browser,
  base: string,
  level: number,
  ids: readonly VehicleId[]
): Promise<LevelResult> {
  const ctx = await browser.newContext({ viewport: { ...CAPTURE_VIEWPORT }, deviceScaleFactor: 1 });
  try {
    await ctx.addInitScript(musicOffInitScript(SILENT_AUDIO));
    await ctx.addInitScript(garageSeedScript(GARAGE_SEED_LEDGER, accountAt(level, ids)));
    const page = await ctx.newPage();
    page.setDefaultTimeout(120_000);
    page.on('pageerror', (err) => console.log(`  [L${level}] page error: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.log(`  [L${level}] console.error: ${msg.text()}`);
    });

    await bootSandbox(page, base);
    const tick0 = await page.evaluate(() => (window as unknown as LionsWindow).__lions.sim.tickCount);
    if (tick0 > SPAWN_TICK) throw new Error(`L${level}: the loop ran to tick ${tick0} before the freeze (> ${SPAWN_TICK})`);
    await page.evaluate((t) => {
      const L = (window as unknown as LionsWindow).__lions;
      L.step(t - L.sim.tickCount);
    }, SPAWN_TICK);

    const tiles = await paradeTiles(page, ids.length);
    // Measured at the first tile with the camera parked there at zoom 1:
    // the projection is affine, so the direction is the same at every tile.
    await page.evaluate(
      ([x, y]) => {
        const c = (window as unknown as LionsWindow).__lions.renderer.camera;
        c.x = x;
        c.y = y;
        c.zoom = 1;
      },
      [tiles[0][0] + 0.5, tiles[0][1] + 0.5] as [number, number]
    );
    const facing = await measureFacing(page, [tiles[0][0] + 0.5, tiles[0][1] + 0.5]);

    await page.evaluate(
      ([wanted, at, facingFx, fixed]) => {
        const L = (window as unknown as LionsWindow).__lions;
        for (let i = 0; i < wanted.length; i++) {
          const typeIdx = L.sim.unitTypes.findIndex((t) => t.id === wanted[i]);
          if (typeIdx < 0) throw new Error(`no unit type "${wanted[i]}" in this build`);
          L.sim.spawn(typeIdx, 0, Math.round((at[i][0] + 0.5) * fixed), Math.round((at[i][1] + 0.5) * fixed), facingFx);
        }
      },
      [ids as readonly string[], tiles, Math.round(facing.turns * FIXED) & 0xffff, FIXED] as [
        readonly string[],
        [number, number][],
        number,
        number,
      ]
    );
    await page.evaluate((t) => {
      const L = (window as unknown as LionsWindow).__lions;
      L.step(t - L.sim.tickCount);
    }, SWEEP_TICK);

    // Every template must land; network work, not frame work, so wall time.
    const deadline = Date.now() + 90_000;
    for (;;) {
      const loaded = await page.evaluate(
        (wanted) => wanted.filter((id) => !(window as unknown as LionsWindow).__lions.renderer.vehicleMeshTemplates?.has(id)),
        ids as readonly string[]
      );
      if (loaded.length === 0) break;
      if (Date.now() > deadline) throw new Error(`L${level}: templates never loaded for ${loaded.join(', ')}`);
      await sleep(500);
    }
    await page.evaluate((t) => {
      const L = (window as unknown as LionsWindow).__lions;
      L.step(t - L.sim.tickCount);
      L.renderer.frame(1, 0);
    }, CAPTURE_TICK);

    const merge = await readMerge(page, ids);

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const cx = tiles[i][0] + 0.5;
      const cy = tiles[i][1] + 0.5;
      for (const zoom of ZOOMS) {
        const zKey = zoom.toFixed(1);
        const box = BOX[zKey];
        const sp = await page.evaluate(
          ([x, y, z]) => {
            const r = (window as unknown as LionsWindow).__lions.renderer;
            r.camera.x = x;
            r.camera.y = y;
            r.camera.zoom = z;
            r.frame(1, 0);
            return { ...r.worldToScreen(x, y), zoom: r.camera.zoom };
          },
          [cx, cy, zoom] as [number, number, number]
        );
        if (sp.zoom !== zoom) throw new Error(`camera.zoom read back ${sp.zoom}, set ${zoom}`);
        const clip = {
          x: Math.round(sp.x - box.w / 2),
          y: Math.round(sp.y - box.lift - box.h / 2),
          width: box.w,
          height: box.h,
        };
        if (clip.x < 0 || clip.y < 0 || clip.x + clip.width > CAPTURE_VIEWPORT.width || clip.y + clip.height > CAPTURE_VIEWPORT.height) {
          throw new Error(`${id} z${zKey}: clip ${JSON.stringify(clip)} leaves the viewport`);
        }
        const file = path.join(CELL_DIR, `${id}_z${zKey}_L${level}.png`);
        await page.screenshot({ path: file, clip });
      }
    }
    return { merge, facing, tiles };
  } finally {
    await ctx.close();
  }
}

/** The merge check: renderer readings against the served GLB's kit nodes.
 *  Returns the failures; prints one line per vehicle. */
function checkMerges(ids: readonly VehicleId[], results: ReadonlyMap<number, LevelResult>): string[] {
  const failures: string[] = [];
  console.log(`\n[${TAG}] merge check (renderer template vs served GLB):`);
  for (const id of ids) {
    const nodes = glbKitNodes(id);
    const tracks = Object.keys(unitJson(id).upgrades ?? {});
    const cols: string[] = [];
    let prevKit = -1;
    let l0Tris = -1;
    for (const level of LEVELS) {
      const res = results.get(level);
      if (!res) continue;
      const m = res.merge[id];
      const want = tiersAt(id, level);
      const expectKit = nodes.some((n) => tracks.includes(n.track) && n.tier <= (want[n.track] ?? 0));
      cols.push(`L${level} ${m.tris} tris (kit ${m.kitTris}, ${m.kittedGeometries} geom)`);
      if (!m.loaded) failures.push(`${id} L${level}: no vehicle template loaded`);
      if (JSON.stringify(m.tiers ?? {}) !== JSON.stringify(want)) {
        failures.push(`${id} L${level}: renderer tiers ${JSON.stringify(m.tiers)} != seeded ${JSON.stringify(want)}`);
      }
      if (expectKit && m.kitTris <= 0) failures.push(`${id} L${level}: GLB carries owned kit but the template merged none`);
      if (!expectKit && m.kitTris !== 0) failures.push(`${id} L${level}: ${m.kitTris} kit tris merged with nothing owned`);
      if (m.kitTris < prevKit) failures.push(`${id} L${level}: kit shrank (${prevKit} -> ${m.kitTris})`);
      if (level === 0) l0Tris = m.tris;
      else if (l0Tris >= 0 && m.tris - m.kitTris !== l0Tris) {
        failures.push(`${id} L${level}: host tris ${m.tris - m.kitTris} != L0's shipped ${l0Tris}`);
      }
      prevKit = m.kitTris;
    }
    const glb =
      nodes.length === 0
        ? 'GLB: no kit grafted (looks the same at every level)'
        : `GLB: ${nodes.length} kit node(s) [${nodes.map((n) => `${n.track}${n.tier}`).join(' ')}]`;
    console.log(`  ${id.padEnd(14)} ${glb}\n  ${''.padEnd(14)} ${cols.join(' | ')}`);
  }
  return failures;
}

async function runSheets(args: Args, port: number): Promise<void> {
  const t0 = Date.now();
  fs.mkdirSync(CELL_DIR, { recursive: true });
  const base = `http://localhost:${port}`;
  const dev = await ensureDevServer(port, REPO_ROOT, TAG);
  const results = new Map<number, LevelResult>();
  let gpuName = 'unknown';
  let failures: string[] = [];
  try {
    for (const level of LEVELS) {
      const tl = Date.now();
      // One browser per level, opened only after the last one closed.
      const browser = await chromium.launch({ headless: true, args: gpuLaunchArgs(args.gpu) });
      try {
        if (level === 0) {
          gpuName = await readUnmaskedRenderer(browser);
          console.log(`[${TAG}] GPU (${args.gpu}): ${gpuName}`);
        }
        const res = await captureLevel(browser, base, level, args.only);
        results.set(level, res);
        if (level === 0) {
          console.log(
            `[${TAG}] facing ${res.facing.turns.toFixed(4)} turns (${(res.facing.turns * 360).toFixed(1)} deg in the sim), ` +
              `nose on screen at ${res.facing.screenDeg.toFixed(1)} deg from screen-right, counter-clockwise; ` +
              `tiles ${res.tiles.map((t) => `(${t[0]},${t[1]})`).join(' ')}`
          );
        }
        console.log(`[${TAG}] L${level}: ${args.only.length * ZOOMS.length} cells in ${((Date.now() - tl) / 1000).toFixed(1)}s`);
      } finally {
        await browser.close();
      }
    }
    failures = checkMerges(args.only, results);

    const facing = results.get(0)?.facing;
    const commit = shortCommit();
    const browser = await chromium.launch({ headless: true });
    try {
      for (const zoom of ZOOMS) {
        const zKey = zoom.toFixed(1);
        const out = path.join(SHEET_DIR, `zoom${zKey}.png`);
        await composeSheet(
          browser,
          out,
          `Kitted vehicles in game, zoom ${zKey} -- kit level L = every track at tier L (clamped)`,
          `pnpm kit:capture at ${commit}; ${MAP_ID} sandbox without &amp;kit, account-seeded tiers; ` +
            `facing ${facing ? facing.turns.toFixed(4) : '?'} turns (flank and rear to the camera); ` +
            `tick ${CAPTURE_TICK}, frame loop frozen, zero-time repaint; fog, overlays and wind hidden; ` +
            `${BOX[zKey].w}x${BOX[zKey].h} CSS px at DPR 1; GPU ${gpuName.replace(/[<>&]/g, '')}.`,
          LEVELS.map((l) => `L${l}`),
          args.only.map((id) => ({
            label: id,
            cells: LEVELS.map((l) => path.join(CELL_DIR, `${id}_z${zKey}_L${l}.png`)),
          }))
        );
        console.log(`[${TAG}] wrote ${path.relative(REPO_ROOT, out)}`);
      }
    } finally {
      await browser.close();
    }
  } finally {
    stopDevServer(dev, TAG);
  }
  console.log(`[${TAG}] sheets done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (failures.length > 0) {
    console.error(`[${TAG}] MERGE CHECK FAILED:\n  ${failures.join('\n  ')}`);
    process.exitCode = 1;
  } else {
    console.log(`[${TAG}] merge check: PASS (${args.only.length} vehicle(s) x ${LEVELS.length} levels)`);
  }
}

// -------------------------------------------------------------- garage ----

async function photographBay(page: Page, id: string, name: string, outDir: string, tag: string): Promise<string[]> {
  await page.click(`.rl-garage__card[data-unit="${id}"]`);
  await page.waitForFunction(
    (unitName) => {
      const plate = document.querySelector<HTMLElement>('.rl-garage__plate');
      const nameEl = document.querySelector('.rl-garage__name');
      const model = plate?.querySelector<HTMLElement>('.rl-garage__model');
      return (
        nameEl?.textContent === unitName &&
        !!plate &&
        (plate.dataset.model === 'plate' || (plate.dataset.model === 'live' && Number(model?.dataset.frames ?? 0) >= 1))
      );
    },
    name,
    { timeout: 60_000 }
  );
  const state = await page.evaluate(() => document.querySelector<HTMLElement>('.rl-garage__plate')?.dataset.model ?? '?');
  const shots: string[] = [];
  if (state !== 'live') {
    console.warn(`[${TAG}] ${id}: the bay kept its plate (data-model=${state}); photographing that`);
  }
  for (const [key, deg] of [
    ['Home', 0],
    ['End', 180],
  ] as const) {
    if (state === 'live') {
      const before = await page.evaluate(
        () => Number(document.querySelector<HTMLElement>('.rl-garage__plate .rl-garage__model')?.dataset.frames ?? 0)
      );
      await page.focus('.rl-garage__plate .rl-garage__model');
      await page.keyboard.press(key);
      await page
        .waitForFunction(
          (n) => Number(document.querySelector<HTMLElement>('.rl-garage__plate .rl-garage__model')?.dataset.frames ?? 0) > n,
          before,
          { timeout: 10_000 }
        )
        .catch(() => undefined); // Home on an already-0 yaw may draw nothing new
      await sleep(300);
    }
    const file = path.join(outDir, `.garage-${tag}-${deg}.png`);
    await page.locator('.rl-garage__plate').screenshot({ path: file });
    shots.push(file);
  }
  return shots;
}

async function runGarage(args: Args, port: number): Promise<void> {
  const t0 = Date.now();
  fs.mkdirSync(SHEET_DIR, { recursive: true });
  const tmp = path.join(REPO_ROOT, '.superpowers/kit/garage');
  fs.mkdirSync(tmp, { recursive: true });
  const base = `http://localhost:${port}`;
  const dev = await ensureDevServer(port, REPO_ROOT, TAG);
  const browser = await chromium.launch({ headless: true, args: gpuLaunchArgs(args.gpu) });
  try {
    console.log(`[${TAG}] GPU (${args.gpu}): ${await readUnmaskedRenderer(browser)}`);
    const runs: { level: number; ids: readonly VehicleId[]; suffix: string }[] = [
      { level: 3, ids: args.only, suffix: '' },
    ];
    if (args.only.includes('mbt_lavi')) runs.push({ level: 0, ids: ['mbt_lavi'], suffix: '-L0' });
    for (const run of runs) {
      const ctx = await browser.newContext({ viewport: { ...CAPTURE_VIEWPORT }, deviceScaleFactor: 1 });
      try {
        await ctx.addInitScript(musicOffInitScript(SILENT_AUDIO));
        await ctx.addInitScript(garageSeedScript(GARAGE_SEED_LEDGER, accountAt(run.level)));
        const page = await ctx.newPage();
        page.setDefaultTimeout(60_000);
        page.on('pageerror', (err) => console.log(`  [garage] page error: ${err.message}`));
        await page.goto(`${base}/brigade`, { waitUntil: 'load' });
        await page.waitForSelector('.rl-garage__card');
        for (const id of run.ids) {
          const name = unitJson(id).name;
          const shots = await photographBay(page, id, name, tmp, `${id}${run.suffix}`);
          const out = path.join(SHEET_DIR, `garage-${id}${run.suffix}.png`);
          await composeSheet(
            browser,
            out,
            `${name} (${id}) in the garage bay, account at L${run.level}`,
            `pnpm kit:capture --garage at ${shortCommit()}; the turntable focused (no auto-turn), Home and End.`,
            ['yaw 0 (Home)', 'yaw 180 (End)'],
            [{ label: `L${run.level}`, cells: shots }]
          );
          console.log(`[${TAG}] wrote ${path.relative(REPO_ROOT, out)}`);
        }
      } finally {
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    stopDevServer(dev, TAG);
  }
  console.log(`[${TAG}] garage done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

// -------------------------------------------------------------- toggle ----

/** The gated scenario itself (`capture-protocol.ts`), not a copy of it, so the
 *  floor is measured on exactly the URL, camera and tick the gate captures. */
const KITTED_PROBE: Scenario = KITTED_SCENARIO;

interface ToggleReading {
  control: DiffSummary;
  toggle: DiffSummary;
  objects: number;
  tick: number;
}

/** One fresh page load of `scenario` through the gate's own capture, the
 *  zero-time repaint control, and the `kit` toggle -- `runSelfChecks`'
 *  sequence in `three-baseline-gate.ts`, for one layer. */
async function toggleOnce(browser: Browser, port: number, scenario: Scenario, dir: string): Promise<ToggleReading> {
  fs.mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { ...CAPTURE_VIEWPORT } });
  try {
    await ctx.addInitScript(musicOffInitScript());
    const page = await ctx.newPage();
    const captured = path.join(dir, 'current.png');
    const shown = path.join(dir, 'layer-shown.png');
    const hidden = path.join(dir, 'layer-kit-hidden.png');
    const result = await capture(page, threeUrl(port, scenario), captureScript(scenario), captured, `${TAG}/${scenario.id}`);
    await rephotograph(page, REPAINT_SCRIPT, shown, result.rect);
    const control = computeDiff(captured, shown, { threshold: PIXELMATCH_THRESHOLD });
    const raw = (await rephotograph(page, layerToggleScript('kit', false), hidden, result.rect)) as { objects: number };
    await page.evaluate(layerToggleScript('kit', true));
    const toggle = computeDiff(shown, hidden, {
      outDir: dir,
      diffFileName: 'diff-layer-kit.png',
      threshold: PIXELMATCH_THRESHOLD,
    });
    return { control, toggle, objects: raw.objects, tick: result.tick };
  } finally {
    await ctx.close();
  }
}

function line(r: ToggleReading): string {
  return (
    `tick ${r.tick}; repaint control ${r.control.diffPixels} px / ${r.control.meanAbsChannelDelta.toFixed(4)}; ` +
    `kit toggle (${r.objects} kitted geometr${r.objects === 1 ? 'y' : 'ies'}) ${r.toggle.diffPixels} px / ` +
    `${r.toggle.meanAbsChannelDelta.toFixed(4)}`
  );
}

async function runToggle(port: number): Promise<void> {
  const t0 = Date.now();
  const dev = await ensureDevServer(port, REPO_ROOT, TAG);
  // The gate's own browser: no GL args, i.e. SwiftShader (browser.ts says why).
  const browser = await launchCaptureBrowser();
  const failures: string[] = [];
  try {
    console.log(`[${TAG}] GPU (gate browser): ${await readUnmaskedRenderer(browser)}`);
    console.log(`[${TAG}] ${threeUrl(port, KITTED_PROBE)}`);
    const readings: ToggleReading[] = [];
    for (let run = 1; run <= 3; run++) {
      const r = await toggleOnce(browser, port, KITTED_PROBE, path.join(TOGGLE_DIR, `kitted-r${run}`));
      console.log(`[${TAG}] kitted r${run}: ${line(r)}`);
      if (r.control.diffPixels !== 0 || r.control.meanAbsChannelDelta !== 0) {
        failures.push(`kitted r${run}: the repaint control moved; the toggle reading is contaminated`);
      }
      readings.push(r);
    }
    const minPx = Math.min(...readings.map((r) => r.toggle.diffPixels));
    const minMean = Math.min(...readings.map((r) => r.toggle.meanAbsChannelDelta));
    console.log(
      `[${TAG}] kit toggle readings: ${readings.map((r) => `${r.toggle.diffPixels} px / ${r.toggle.meanAbsChannelDelta.toFixed(4)}`).join(', ')}`
    );
    console.log(
      `[${TAG}] floor (a third of the smallest): minDiffPixels ${Math.floor(minPx / 3)}, ` +
        `minMeanAbsChannelDelta ${(Math.floor((minMean / 3) * 10000) / 10000).toFixed(4)}`
    );
    if (minPx === 0) failures.push('the kit toggle read 0 px under &kit: nothing kitted is in the frame');

    // The falsification: the gate's bare `vehicle` URL, a fresh (empty)
    // account, so `applyVehicleKit` is handed empty tiers for every type.
    console.log(`[${TAG}] falsification: ${threeUrl(port, VEHICLE_SCENARIO)} (no &kit, empty account)`);
    const f = await toggleOnce(browser, port, VEHICLE_SCENARIO, path.join(TOGGLE_DIR, 'falsify-no-kit'));
    console.log(`[${TAG}] no-kit: ${line(f)}`);
    const floorPx = Math.floor(minPx / 3);
    if (f.objects !== 0 || f.toggle.diffPixels !== 0 || f.toggle.meanAbsChannelDelta !== 0) {
      failures.push(`falsification: with empty tiers the kit toggle should read 0 kitted / 0 px / 0.0000, read ${line(f)}`);
    } else {
      console.log(`[${TAG}] falsification: 0 px / 0.0000 with empty tiers, under the floor of ${floorPx} px -> the check can fail`);
    }
  } finally {
    await browser.close();
    stopDevServer(dev, TAG);
  }
  console.log(`[${TAG}] toggle done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (failures.length > 0) {
    console.error(`[${TAG}] FAILED:\n  ${failures.join('\n  ')}`);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------- main ----

const args = parseArgs(process.argv.slice(2));
const port = await claimPort(TAG, PORT_ENV, DEFAULT_PORT);
if (args.mode === 'garage') await runGarage(args, port);
else if (args.mode === 'toggle') await runToggle(port);
else await runSheets(args, port);
