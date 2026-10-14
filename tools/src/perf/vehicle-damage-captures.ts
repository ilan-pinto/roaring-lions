/**
 * Vehicle damage states in the running game (GH-31, the vehicle half):
 * `pnpm vdmg:capture`.
 *
 *   pnpm vdmg:capture                          every subject, both zooms
 *   pnpm vdmg:capture -- --only=mbt_lavi,technical
 *   pnpm vdmg:capture -- --out=<dir> --port=5291 --gpu=metal|swiftshader
 *
 * Photographs each subject at band 8 (clean), 5 and 3 (scarred), 1 (scarred
 * plus the wisp, three seconds of sim time in) and the wreck as it ships,
 * at zoom 2.5 and 1.0, through the live renderer -- the thing judged is
 * runtime material treatment, which `pnpm validate:meshes` repaints away.
 * The subjects are every vehicle that scars (`units/vehicle-damage.ts`:
 * ground vehicles and the two helicopters) plus two rotorless aircraft that
 * must stay clean, as the control rows.
 *
 * Writes `<out>/cells/<id>_z<zoom>_<state>.png`, `<out>/sheet-z2.5.png`,
 * `<out>/sheet-z1.0.png` and `<out>/readings.json` (draw calls, programs,
 * scar materials and frame() CPU time, clean against scarred). `--out`
 * defaults to `.superpowers/vdmg` and resolves against the repo root. Exits 1
 * if scarring changed the draw calls or programs, or if no scar material
 * exists with scarring subjects at band 3 (a hook that never fired).
 *
 * The band is WRITTEN into `sim.state.hp` -- a capture instrument, and the
 * lead's ruling (2026-10-14) rather than a sim dev hook. `Sim.debugSplash`
 * cannot do it: `splashDirect` damages soft targets only, and four splashes
 * of 200-1600 left a Lavi at 3000/3000. The renderer reads hp every frame,
 * so a written hp reaches the scar by the same path a penetration does.
 *
 * Same rules as `kit-captures.ts`, whose parade (open tiles judged on screen)
 * and measured facing this reuses: it boots its OWN dev server and refuses a
 * port something else holds (`ui-review/port.ts`, default 5291), seeds music
 * off, opens one browser, strikes the sandbox force, freezes the frame loop,
 * hides fog/overlays/wind, and stops the server by process group on every
 * exit path. When the map offers fewer parade tiles than subjects, each
 * batch gets a fresh page, so no batch stands on the last one's wrecks.
 */
import { chromium, type Browser, type Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ensureDevServer, stopDevServer, readUnmaskedRenderer } from '../golden-diff/browser';
import { CAPTURE_VIEWPORT, FREEZE_FRAME_LOOP_SCRIPT, hideHudExceptCanvas } from '../golden-diff/capture-protocol';
import { musicOffInitScript, SILENT_AUDIO } from '../ui-review/music-off';
import { claimPort } from '../ui-review/port';
import { gpuLaunchArgs, resolveGpuBackend, type GpuBackend } from '../ui-review/gpu';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const TAG = 'vdmg-capture';
const PORT_ENV = 'VDMG_CAPTURE_PORT';
const DEFAULT_PORT = 5291;
const MAP_ID = 'beit_sahwan_outskirts';
const FIXED = 65536;

/** Every vehicle that scars, then the control rows that must not. */
const SCARRING = [
  'mbt_lavi',
  'ifv_namer',
  'apc_eitan',
  'apc_kipod',
  'jeep_shoded',
  'scout_shachaf',
  'dozer_d9',
  'technical',
  'gun_truck',
  'rocket_battery',
  'heli_peten',
  'heli_peten_gunship',
] as const;
const CONTROLS = ['recon_drone', 'paramotor'] as const;
const SUBJECTS: readonly string[] = [...SCARRING, ...CONTROLS];

/** The states photographed, in column order. */
const STATES = [
  { key: 'b8', band: 8, head: 'band 8', sub: 'clean (8-6)' },
  { key: 'b5', band: 5, head: 'band 5', sub: 'scarred' },
  { key: 'b3', band: 3, head: 'band 3', sub: 'scarred' },
  { key: 'b1', band: 1, head: 'band 1', sub: 'scarred + wisp (2-1)' },
  { key: 'wreck', band: 0, head: 'wreck', sub: 'as shipped, 5 s' },
] as const;
const ZOOMS = [2.5, 1.0] as const;
/** Ticks of sim time the band-1 wisp runs before its photograph (the wisp is
 *  dated off the sim clock), and the wreck's settle. */
const WISP_TICKS = 60;
const WRECK_TICKS = 100;

const BOX: Readonly<Record<string, { w: number; h: number; lift: number }>> = {
  '1.0': { w: 200, h: 160, lift: 12 },
  '2.5': { w: 380, h: 320, lift: 30 },
};
const EDGE_TILES = 4;
const OBSTACLE_SIDE_PX = 48;
const OBSTACLE_RISE_PX = 240;
const HULL_PX = 160;
const TARGET_SCREEN_DIR = { x: -Math.cos(Math.PI / 3), y: -Math.sin(Math.PI / 3) };
const SPAWN_TICK = 200;

// ---------------------------------------------------------------- argv ----

interface Args {
  only: string[];
  out: string;
  gpu: GpuBackend;
}

function usage(msg: string): never {
  console.error(`[${TAG}] ${msg}`);
  console.error(`[${TAG}] usage: pnpm vdmg:capture -- [--only=<id>[,<id>...]] [--out=<dir>] [--port=<n>] [--gpu=metal|swiftshader]`);
  process.exit(2);
}

function parseArgs(argv: readonly string[]): Args {
  let only = [...SUBJECTS];
  let out = path.join(REPO_ROOT, '.superpowers/vdmg');
  for (const a of argv) {
    if (a === '--') continue;
    if (a.startsWith('--only=')) {
      const ids = a.slice('--only='.length).split(',').filter((s) => s.length > 0);
      if (ids.length === 0) usage('--only= names no vehicle');
      for (const id of ids) if (!SUBJECTS.includes(id)) usage(`--only: "${id}" is not one of ${SUBJECTS.join(', ')}`);
      only = SUBJECTS.filter((s) => ids.includes(s));
    } else if (a.startsWith('--out=')) {
      out = path.resolve(REPO_ROOT, a.slice('--out='.length));
    } else if (a.startsWith('--port=') || a.startsWith('--gpu=')) {
      // Parsed (and refused when malformed) by `claimPort` / `resolveGpuBackend`.
    } else usage(`unknown argument "${a}"`);
  }
  let gpu: GpuBackend;
  try {
    gpu = resolveGpuBackend(argv, process.platform);
  } catch (err) {
    usage(err instanceof Error ? err.message : String(err));
  }
  return { only, out, gpu };
}

// --------------------------------------------------------- page access ----

interface LionsPage {
  step(n: number): number;
  sim: {
    width: number;
    height: number;
    tickCount: number;
    entityCount: number;
    blocked: Uint8Array;
    unitTypes: { id: string; hp: number }[];
    state: { alive: Uint8Array; hp: Int32Array; typeIdx: Uint16Array | Int32Array };
    spawn(typeIdx: number, side: number, x: number, y: number, facing?: number): number;
    removeFromPlay(id: number): void;
    debugKill(id: number): void;
  };
  renderer: {
    camera: { x: number; y: number; zoom: number };
    setDebugLayerVisible(name: string, visible: boolean): number;
    frame(alpha: number, dtMs: number): void;
    worldToScreen(wx: number, wy: number): { x: number; y: number };
    // Private on `ThreeRenderer`; read here as capture instruments, never written.
    vehicleMeshTemplates?: Map<string, unknown>;
    vehicleScars?: Map<string, { size: number }>;
    renderer?: {
      info: {
        autoReset: boolean;
        reset(): void;
        render: { calls: number; triangles: number };
        programs?: unknown[];
        memory: { textures: number; geometries: number };
      };
    };
  };
}
type LionsWindow = { __lions: LionsPage };

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function shortCommit(): string {
  try {
    return execFileSync('/usr/bin/git', ['-C', REPO_ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

async function bootSandbox(page: Page, base: string): Promise<void> {
  await page.goto(`${base}/free-play/${MAP_ID}`, { waitUntil: 'load', timeout: 90_000 });
  await page.waitForFunction(() => !!(window as unknown as Partial<LionsWindow>).__lions?.renderer, null, { timeout: 90_000 });
  await page.evaluate(FREEZE_FRAME_LOOP_SCRIPT);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(hideHudExceptCanvas);
  await page.evaluate((spawnTick) => {
    const L = (window as unknown as LionsWindow).__lions;
    for (const layer of ['fog', 'overlays', 'wind']) L.renderer.setDebugLayerVisible(layer, false);
    for (let i = 0; i < L.sim.entityCount; i++) if (L.sim.state.alive[i] === 1) L.sim.removeFromPlay(i);
    L.step(Math.max(0, spawnTick - L.sim.tickCount));
  }, SPAWN_TICK);
}

/** `kit-captures.ts`'s parade: open tiles whose zoom-2.5 box holds nothing
 *  but the vehicle and open ground, judged through the live camera. */
async function paradeTiles(page: Page, n: number): Promise<[number, number][]> {
  const rows = (JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'data/maps', `${MAP_ID}.json`), 'utf8')) as { rows: string[] }).rows;
  const obstacles: [number, number][] = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] !== '.') obstacles.push([x, y]);
  });
  const box = BOX['2.5'];
  return page.evaluate(
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
            if (Math.abs(p.x - c.x) < bw / 2 + side && p.y - c.y > top - side && p.y - c.y < bottom + rise) {
              ok = false;
              break;
            }
          }
          for (const q of picked) {
            if (!ok) break;
            const p = r.worldToScreen(q[0] + 0.5, q[1] + 0.5);
            if (Math.abs(p.x - c.x) < bw / 2 + hull && p.y - c.y > top - hull && p.y - c.y < bottom + hull) ok = false;
          }
          if (ok) picked.push([tx, ty]);
        }
      }
      return picked;
    },
    [n, obstacles, EDGE_TILES, box.w, box.h, box.lift, OBSTACLE_SIDE_PX, OBSTACLE_RISE_PX, HULL_PX] as [
      number, [number, number][], number, number, number, number, number, number, number,
    ]
  );
}

/** The facing (turns) whose nose projects closest to `TARGET_SCREEN_DIR`:
 *  flank and rear to the camera, the kit sheets' view. */
async function measureFacing(page: Page, at: [number, number]): Promise<number> {
  return page.evaluate(
    ([x, y, tdx, tdy]) => {
      const r = (window as unknown as LionsWindow).__lions.renderer;
      r.camera.x = x;
      r.camera.y = y;
      r.camera.zoom = 1;
      const o = r.worldToScreen(x, y);
      let best = { turns: 0, score: -2 };
      for (let i = 0; i < 64; i++) {
        const turns = i / 64;
        const p = r.worldToScreen(x + Math.cos(turns * 2 * Math.PI), y + Math.sin(turns * 2 * Math.PI));
        const dx = p.x - o.x;
        const dy = p.y - o.y;
        const score = (dx * tdx + dy * tdy) / Math.hypot(dx, dy);
        if (score > best.score) best = { turns, score };
      }
      return best.turns;
    },
    [at[0], at[1], TARGET_SCREEN_DIR.x, TARGET_SCREEN_DIR.y] as [number, number, number, number]
  );
}

/** Writes exactly `band` eighths of each entity's max hp, and repaints. */
async function setBand(page: Page, ents: readonly number[], band: number): Promise<void> {
  await page.evaluate(
    ([es, b]) => {
      const L = (window as unknown as LionsWindow).__lions;
      for (const e of es) {
        const max = L.sim.unitTypes[L.sim.state.typeIdx[e]].hp;
        L.sim.state.hp[e] = b >= 8 ? max : Math.max(1, Math.floor((max * b) / 8));
      }
      L.renderer.frame(1, 0);
    },
    [ents as number[], band] as [number[], number]
  );
}

/** `n` sim ticks, each followed by a 50 ms presentation frame. */
async function run(page: Page, ticks: number): Promise<void> {
  await page.evaluate((n) => {
    const L = (window as unknown as LionsWindow).__lions;
    for (let k = 0; k < n; k++) {
      L.step(1);
      L.renderer.frame(1, 50);
    }
  }, ticks);
}

interface Subject {
  id: string;
  e: number;
  tile: [number, number];
}

async function shoot(page: Page, cells: string, subjects: readonly Subject[], state: string): Promise<void> {
  for (const v of subjects) {
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
          return r.worldToScreen(x, y);
        },
        [v.tile[0] + 0.5, v.tile[1] + 0.5, zoom] as [number, number, number]
      );
      const clip = { x: Math.round(sp.x - box.w / 2), y: Math.round(sp.y - box.lift - box.h / 2), width: box.w, height: box.h };
      if (clip.x < 0 || clip.y < 0 || clip.x + clip.width > CAPTURE_VIEWPORT.width || clip.y + clip.height > CAPTURE_VIEWPORT.height) {
        throw new Error(`${v.id} z${zKey}: clip ${JSON.stringify(clip)} leaves the viewport`);
      }
      await page.screenshot({ path: path.join(cells, `${v.id}_z${zKey}_${state}.png`), clip });
    }
  }
  console.log(`[${TAG}] ${state}: ${subjects.map((v) => v.id).join(', ')}`);
}

interface CostReading {
  calls: number;
  triangles: number;
  programs: number;
  textures: number;
  geometries: number;
  scarMaterials: number;
}

/** `renderer.info` over ONE frame with the auto-reset held off (three r170
 *  resets it after the shadow pass), all subjects in view at zoom 0.6. */
async function readCost(page: Page, centre: [number, number]): Promise<CostReading> {
  return page.evaluate(([x, y]) => {
    const r = (window as unknown as LionsWindow).__lions.renderer;
    r.camera.x = x;
    r.camera.y = y;
    r.camera.zoom = 0.6;
    const info = r.renderer?.info;
    if (!info) throw new Error('no renderer.info');
    const auto = info.autoReset;
    info.autoReset = false;
    info.reset();
    r.frame(1, 0);
    let scars = 0;
    for (const s of r.vehicleScars?.values() ?? []) scars += s.size;
    const out = {
      calls: info.render.calls,
      triangles: info.render.triangles,
      programs: info.programs ? info.programs.length : -1,
      textures: info.memory.textures,
      geometries: info.memory.geometries,
      scarMaterials: scars,
    };
    info.autoReset = auto;
    return out;
  }, centre);
}

/** Mean wall ms of `frame(1, 16)`, `blocks` blocks of `n`. CPU submission
 *  only; the GPU work is the same draws and programs by construction. */
async function frameMs(page: Page, n: number, blocks: number): Promise<number[]> {
  const out: number[] = [];
  for (let b = 0; b < blocks; b++) {
    out.push(
      await page.evaluate((count) => {
        const r = (window as unknown as LionsWindow).__lions.renderer;
        const t0 = performance.now();
        for (let i = 0; i < count; i++) r.frame(1, 16);
        return (performance.now() - t0) / count;
      }, n)
    );
  }
  return out;
}

async function openBatch(browser: Browser, base: string, tilesWanted: number) {
  const ctx = await browser.newContext({ viewport: { ...CAPTURE_VIEWPORT }, deviceScaleFactor: 1 });
  await ctx.addInitScript(musicOffInitScript(SILENT_AUDIO));
  const page = await ctx.newPage();
  page.setDefaultTimeout(180_000);
  page.on('pageerror', (err) => console.log(`  page error: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log(`  console.error: ${msg.text()}`);
  });
  await bootSandbox(page, base);
  const tiles = await paradeTiles(page, tilesWanted);
  return { ctx, page, tiles };
}

async function spawnAndLoad(page: Page, ids: readonly string[], tiles: [number, number][]): Promise<Subject[]> {
  const facing = await measureFacing(page, [tiles[0][0] + 0.5, tiles[0][1] + 0.5]);
  const ents = await page.evaluate(
    ([wanted, at, f, fixed]) => {
      const L = (window as unknown as LionsWindow).__lions;
      return wanted.map((id, i) => {
        const typeIdx = L.sim.unitTypes.findIndex((t) => t.id === id);
        if (typeIdx < 0) throw new Error(`no unit type "${id}" in this build`);
        return L.sim.spawn(typeIdx, 0, Math.round((at[i][0] + 0.5) * fixed), Math.round((at[i][1] + 0.5) * fixed), f);
      });
    },
    [ids as string[], tiles, Math.round(facing * FIXED) & 0xffff, FIXED] as [string[], [number, number][], number, number]
  );
  // `main.ts` loads an unrostered type's mesh on its 1 Hz sweep: step until
  // every template has landed (network work, so wall time).
  const deadline = Date.now() + 120_000;
  for (;;) {
    await page.evaluate(() => (window as unknown as LionsWindow).__lions.step(20));
    const missing = await page.evaluate(
      (wanted) => wanted.filter((id) => !(window as unknown as LionsWindow).__lions.renderer.vehicleMeshTemplates?.has(id)),
      ids as string[]
    );
    if (missing.length === 0) break;
    if (Date.now() > deadline) throw new Error(`templates never loaded: ${missing.join(', ')}`);
    await sleep(500);
  }
  await page.evaluate(() => {
    const L = (window as unknown as LionsWindow).__lions;
    L.step(20);
    L.renderer.frame(1, 0);
  });
  return ids.map((id, i) => ({ id, e: ents[i], tile: tiles[i] }));
}

async function composeSheet(browser: Browser, outFile: string, zoom: string, ids: readonly string[], cells: string, footer: string): Promise<void> {
  const img = (file: string): string =>
    fs.existsSync(file) ? `<img src="data:image/png;base64,${fs.readFileSync(file).toString('base64')}">` : '<div class="missing">not captured</div>';
  const head = STATES.map((s) => `<th>${s.head}<br><small>${s.sub}</small></th>`).join('');
  const body = ids
    .map((id) => {
      const label = (CONTROLS as readonly string[]).includes(id) ? `${id}<br><small>control: no rotor, stays clean</small>` : id;
      return `<tr><th class="row">${label}</th>${STATES.map((s) => `<td>${img(path.join(cells, `${id}_z${zoom}_${s.key}.png`))}</td>`).join('')}</tr>`;
    })
    .join('\n');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin: 0; background: #c6b79c; color: #1f1a14; font: 14px/1.3 -apple-system, Helvetica, Arial, sans-serif; }
    #sheet { display: inline-block; padding: 14px 18px; }
    h1 { font-size: 18px; margin: 0 0 8px; font-weight: 600; }
    table { border-collapse: separate; border-spacing: 6px; }
    th { font-weight: 600; text-align: center; }
    th small { font-weight: 400; }
    th.row { text-align: left; padding-right: 8px; white-space: nowrap; }
    td { padding: 0; } img { display: block; }
    .missing { padding: 20px; color: #6b1d1d; }
    p { margin: 8px 0 0; font-size: 12px; }
  </style></head><body><div id="sheet"><h1>GH-31 vehicle damage states, zoom ${zoom}</h1>
  <table><tr><th></th>${head}</tr>${body}</table><p>${footer}</p></div></body></html>`;
  // music-off: exempt -- a static HTML page with no game in it.
  const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
  try {
    await page.setContent(html, { waitUntil: 'load' });
    await page.locator('#sheet').screenshot({ path: outFile });
  } finally {
    await page.close();
  }
  console.log(`[${TAG}] wrote ${outFile}`);
}

// ---------------------------------------------------------------- main ----

const args = parseArgs(process.argv.slice(2));
const cells = path.join(args.out, 'cells');
fs.mkdirSync(cells, { recursive: true });
const port = await claimPort(TAG, PORT_ENV, DEFAULT_PORT);
const dev = await ensureDevServer(port, REPO_ROOT, TAG);
const base = `http://localhost:${port}`;
let exitCode = 0;
let browser: Browser | null = null;
try {
  browser = await chromium.launch({ headless: true, args: gpuLaunchArgs(args.gpu) });
  const gpuRenderer = await readUnmaskedRenderer(browser);
  console.log(`[${TAG}] GPU: ${gpuRenderer}`);
  const readings: Record<string, unknown> = { commit: shortCommit(), gpu: args.gpu, gpuRenderer, map: MAP_ID };

  // How many subjects one page can parade decides the batches.
  const probe = await openBatch(browser, base, args.only.length);
  const per = Math.max(1, probe.tiles.length);
  await probe.ctx.close();
  const batches: string[][] = [];
  for (let i = 0; i < args.only.length; i += per) batches.push(args.only.slice(i, i + per));
  console.log(`[${TAG}] ${per} parade tiles a page; ${batches.length} batch(es)`);

  for (let b = 0; b < batches.length; b++) {
    const ids = batches[b];
    const { ctx, page, tiles } = await openBatch(browser, base, ids.length);
    try {
      const subjects = await spawnAndLoad(page, ids, tiles);
      const ents = subjects.map((s) => s.e);
      const centre: [number, number] = [
        subjects.reduce((a, s) => a + s.tile[0], 0) / subjects.length + 0.5,
        subjects.reduce((a, s) => a + s.tile[1], 0) / subjects.length + 0.5,
      ];
      if (b === 0) {
        // Costs, first batch only: clean, the band-change frame, scarred.
        const clean = await readCost(page, centre);
        await frameMs(page, 30, 1); // warm
        const cleanMs = await frameMs(page, 120, 4);
        const change = await page.evaluate((es) => {
          const L = (window as unknown as LionsWindow).__lions;
          for (const e of es) L.sim.state.hp[e] = Math.floor((L.sim.unitTypes[L.sim.state.typeIdx[e]].hp * 3) / 8);
          const t0 = performance.now();
          L.renderer.frame(1, 16);
          const first = performance.now() - t0;
          const t1 = performance.now();
          L.renderer.frame(1, 16);
          return { firstFrameMs: first, nextFrameMs: performance.now() - t1 };
        }, ents);
        const scarred = await readCost(page, centre);
        const scarredMs = await frameMs(page, 120, 4);
        Object.assign(readings, { vehiclesInView: ents.length, clean, scarred, bandChange: change, frameMs: { clean: cleanMs, scarred: scarredMs } });
        console.log(`[${TAG}] clean ${JSON.stringify(clean)}`);
        console.log(`[${TAG}] scarred ${JSON.stringify(scarred)}`);
        console.log(
          `[${TAG}] band change ${JSON.stringify(change)}; frame() ms clean ${cleanMs.map((m) => m.toFixed(2)).join('/')} ` +
            `scarred ${scarredMs.map((m) => m.toFixed(2)).join('/')}`
        );
        if (clean.calls !== scarred.calls || clean.programs !== scarred.programs) {
          console.error(`[${TAG}] FAIL: scarring changed the draw calls or programs`);
          exitCode = 1;
        }
        const scarringHere = ids.filter((id) => (SCARRING as readonly string[]).includes(id)).length;
        if (scarringHere > 0 && scarred.scarMaterials === 0) {
          console.error(`[${TAG}] FAIL: ${scarringHere} scarring subject(s) at band 3 and no scar material exists`);
          exitCode = 1;
        }
      }
      for (const s of STATES) {
        if (s.key === 'wreck') {
          await page.evaluate((es) => {
            const L = (window as unknown as LionsWindow).__lions;
            for (const e of es) L.sim.debugKill(e);
          }, ents);
          await run(page, WRECK_TICKS);
        } else {
          await setBand(page, ents, s.band);
          if (s.band <= 2) await run(page, WISP_TICKS);
        }
        await shoot(page, cells, subjects, s.key);
      }
    } finally {
      await ctx.close();
    }
  }

  fs.writeFileSync(path.join(args.out, 'readings.json'), JSON.stringify(readings, null, 2));
  const footer =
    `${MAP_ID}, commit ${String(readings.commit)}, ${gpuRenderer}. Bands written into sim.state.hp; ` +
    `band 1 after ${WISP_TICKS} ticks of sim time (the wisp), wreck after ${WRECK_TICKS}. Fog, overlays and wind hidden; force struck; loop frozen.`;
  for (const zoom of ZOOMS) {
    const z = zoom.toFixed(1);
    await composeSheet(browser, path.join(args.out, `sheet-z${z}.png`), z, args.only, cells, footer);
  }
} catch (err) {
  console.error(`[${TAG}] ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  exitCode = 1;
} finally {
  if (browser) await browser.close();
  stopDevServer(dev, TAG);
}
process.exit(exitCode);
