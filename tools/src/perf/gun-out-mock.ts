/**
 * The confirmation capture for the knocked-out main gun (the lead's ruling of 4 Nov after the mock
 * sheet: the 14 degree droop, a puff at the moment, a small fire). `pnpm gun-out:mock`.
 *
 *   pnpm gun-out:mock                         -> _coord/retarget-gunout/gun-out-final.png
 *   pnpm gun-out:mock -- --probe              print each live mesh's bounds
 *   pnpm gun-out:mock -- --out=<file.png>     write the sheet elsewhere
 *   pnpm gun-out:mock -- --port=5196 --gpu=metal
 *
 * It photographs the SHIPPED renderer, and the knock-out is a REAL one: our Lavi (then our Namer) and an
 * enemy Lavi are set face to face, both topped up to full hit points between ticks so neither dies first, and
 * the page's own frame pipeline (`__lions.step`) runs until the sim's `component` event takes the gun out.
 * Then the enemy is struck from play and the hull is photographed at the knock-out moment, three seconds
 * later, and twenty seconds later (after the fire has faded into the damage wisp), at zoom 2.5 and game zoom.
 * The tool checks that the renderer itself armed the fire (`gunOutFx` held the entity), so a sheet cannot be
 * made from a build where the event never reached the effects.
 *
 * The only writes to the sim are this throwaway browser's own: topping up `hp` so a component roll can
 * happen, and `removeFromPlay` on the opponent. No sim or app code path does either.
 *
 * Boots its OWN dev server (default :5196) through `ui-review/port.ts`, refuses a held port, seeds music off
 * through `ui-review/music-off.ts`, opens ONE browser at a time, and stops the server by process group on every
 * exit path. Metal by default on macOS (`--gpu=`); the GPU it got is printed on the sheet.
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
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
const TAG = 'gun-out-mock';
const PORT_ENV = 'GUN_OUT_MOCK_PORT';
const DEFAULT_PORT = 5196;
const MAP_ID = 'beit_sahwan_outskirts';
const DEFAULT_OUT = path.resolve(REPO_ROOT, '..', '_coord/retarget-gunout/gun-out-final.png');
const FIXED = 65536;

/** The two hulls the lead named. */
const VEHICLES = ['mbt_lavi', 'ifv_namer'] as const;
type VehicleId = (typeof VEHICLES)[number];

/** Absolute ticks, so every run starts from the same idle phase. */
const SPAWN_TICK = 200;
/** How far the opponent stands from the hull, tiles. */
const OPPONENT_TILES = 4.5;
/** The ticks polled for a real knock-out before the pair is replaced (20 s), and the pairs tried. */
const KNOCKOUT_TICKS = 400;
const PAIRS_TRIED = 8;

/** Where the nose points on screen, as a unit vector (x right, y down): the side view shows the droop. */
const NOSE_DIR = { x: -1, y: -0.08 };

/** When each cell is photographed, in sim ticks after the knock-out: the moment, a few seconds on, and
 *  after the fire (8-15 s) has faded into the damage wisp. */
const MOMENTS = [
  { key: 'moment', ticks: 4, head: 'the knock-out moment (+0.2 s)' },
  { key: 'later', ticks: 60, head: '+3 s' },
  { key: 'faded', ticks: 400, head: '+20 s, the fire has faded' },
] as const;
const ZOOMS = [2.5, 1.0] as const;

/** The box each cell is clipped to, CSS px at DPR 1, centred on the hull's ground point raised by `lift`. */
const BOX: Readonly<Record<string, { w: number; h: number; lift: number }>> = {
  '2.5': { w: 420, h: 300, lift: 34 },
  '1.0': { w: 240, h: 170, lift: 14 },
};

// ---------------------------------------------------------------- argv ----

interface Args {
  probe: boolean;
  out: string;
  gpu: GpuBackend;
}

function usage(msg: string): never {
  console.error(`[${TAG}] ${msg}`);
  console.error(`[${TAG}] usage: pnpm gun-out:mock -- [--probe] [--out=<file.png>] [--port=<n>] [--gpu=metal|swiftshader]`);
  process.exit(2);
}

function parseArgs(argv: readonly string[]): Args {
  let probe = false;
  let out = DEFAULT_OUT;
  for (const a of argv) {
    if (a === '--') continue;
    if (a === '--probe') probe = true;
    else if (a.startsWith('--out=')) out = path.resolve(a.slice('--out='.length));
    else if (a.startsWith('--port=') || a.startsWith('--gpu=')) {
      // Parsed (and refused when malformed) by `claimPort` / `resolveGpuBackend`.
    } else usage(`unknown argument "${a}"`);
  }
  let gpu: GpuBackend;
  try {
    gpu = resolveGpuBackend(argv, process.platform);
  } catch (err) {
    usage(err instanceof Error ? err.message : String(err));
  }
  return { probe, out, gpu };
}

// --------------------------------------------------------- page types ----

interface LionsWindow {
  __lions: {
    step(n: number): number;
    sim: {
      width: number;
      height: number;
      tickCount: number;
      entityCount: number;
      state: {
        alive: Uint8Array;
        firepowerKilled: Uint8Array;
        mobilityKilled: Uint8Array;
        hp: Int32Array;
        typeIdx: Int32Array;
        posX: Int32Array;
        posY: Int32Array;
      };
      unitTypes: { id: string; hp: number }[];
      spawn(typeIdx: number, side: number, x: number, y: number, facing?: number): number;
      removeFromPlay(id: number): void;
    };
    renderer: {
      camera: { x: number; y: number; zoom: number };
      setDebugLayerVisible(name: string, visible: boolean): number;
      frame(alpha: number, dtMs: number): void;
      worldToScreen(wx: number, wy: number): { x: number; y: number };
      vehicleMeshEntities?: Map<number, unknown>;
      // Private on `ThreeRenderer`; read as an instrument, never written.
      gunOutFx?: Map<number, unknown>;
    };
  };
}

function shortCommit(): string {
  try {
    return execFileSync('/usr/bin/git', ['-C', REPO_ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

/** Prints every live mesh of an entity with its geometry bounds. */
const PROBE_SCRIPT = `((id) => {
  const ent = window.__lions.renderer.vehicleMeshEntities.get(id);
  if (!ent) return [];
  const out = [];
  ent.root.traverse((o) => {
    if (!o.isMesh || o.userData.rl_wreck === true) return;
    const g = o.geometry; g.computeBoundingBox(); const b = g.boundingBox;
    out.push({ name: o.name, parent: o.parent && o.parent.name, verts: g.attributes.position.count,
      min: [b.min.x, b.min.y, b.min.z].map((v) => Math.round(v * 1000) / 1000),
      max: [b.max.x, b.max.y, b.max.z].map((v) => Math.round(v * 1000) / 1000) });
  });
  return out;
})`;

// ------------------------------------------------------- page choreography ----

async function bootSandbox(page: Page, base: string): Promise<void> {
  await page.goto(`${base}/free-play/${MAP_ID}`, { waitUntil: 'load', timeout: 90_000 });
  await page.waitForFunction(() => !!(window as unknown as LionsWindow).__lions?.renderer, null, { timeout: 90_000 });
  await page.evaluate(FREEZE_FRAME_LOOP_SCRIPT);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(hideHudExceptCanvas);
  await page.evaluate(() => {
    const L = (window as unknown as LionsWindow).__lions;
    for (const layer of ['fog', 'overlays', 'wind']) L.renderer.setDebugLayerVisible(layer, false);
    for (let i = 0; i < L.sim.entityCount; i++) if (L.sim.state.alive[i] === 1) L.sim.removeFromPlay(i);
  });
  await page.evaluate((t) => {
    const L = (window as unknown as LionsWindow).__lions;
    L.step(t - L.sim.tickCount);
  }, SPAWN_TICK);
}

/** The open tile nearest the map's middle with a clear 11x11 block around it, read from the map JSON. */
function parkingTile(): [number, number] {
  const rows = (JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'data/maps', `${MAP_ID}.json`), 'utf8')) as { rows: string[] }).rows;
  const h = rows.length;
  const w = rows[0].length;
  const R = 5;
  let best: [number, number] | null = null;
  let bestD = Infinity;
  for (let y = R; y < h - R; y++) {
    for (let x = R; x < w - R; x++) {
      let clear = true;
      for (let dy = -R; dy <= R && clear; dy++) for (let dx = -R; dx <= R; dx++) if (rows[y + dy][x + dx] !== '.') { clear = false; break; }
      if (!clear) continue;
      const d = Math.hypot(x - w / 2, y - h / 2);
      if (d < bestD) { bestD = d; best = [x, y]; }
    }
  }
  if (best === null) throw new Error(`no 11x11 open block on ${MAP_ID}`);
  return best;
}

/** The facing (turns) whose nose projects closest to `dir` on screen, through the live camera. */
async function facingFor(page: Page, at: [number, number], dir: { x: number; y: number }): Promise<number> {
  return page.evaluate(
    ([x, y, dx, dy]) => {
      const r = (window as unknown as LionsWindow).__lions.renderer;
      const o = r.worldToScreen(x, y);
      let best = { turns: 0, score: -2 };
      for (let i = 0; i < 128; i++) {
        const turns = i / 128;
        const p = r.worldToScreen(x + Math.cos(turns * 2 * Math.PI), y + Math.sin(turns * 2 * Math.PI));
        const vx = p.x - o.x;
        const vy = p.y - o.y;
        const score = (vx * dx + vy * dy) / Math.hypot(vx, vy) / Math.hypot(dx, dy);
        if (score > best.score) best = { turns, score };
      }
      return best.turns;
    },
    [at[0], at[1], dir.x, dir.y] as [number, number, number, number]
  );
}

interface Knockout {
  /** The hull whose gun came out. */
  id: number;
  /** The attempts it took. */
  pairs: number;
  /** Whether the renderer itself armed the effects off the sim's event. */
  fxArmed: boolean;
}

/**
 * Sets `type` face to face with an enemy Lavi on the parking tile, steps the page's own frame pipeline,
 * and returns the hull the moment the sim takes its gun out. The two are topped up to full hit points each
 * poll so a component roll can come before a death; a pair that dies, or never rolls a gun, is replaced.
 * On return the opponent is out of play and nothing else moves.
 */
async function knockOut(page: Page, type: VehicleId, at: [number, number], turns: number): Promise<Knockout> {
  for (let pair = 1; pair <= PAIRS_TRIED; pair++) {
    // Plain JavaScript in a string: tsx wraps inner TypeScript functions in a `__name` the page lacks.
    const script = `(() => {
      const L = window.__lions;
      const idx = L.sim.unitTypes.findIndex((t) => t.id === ${JSON.stringify(type)});
      const lavi = L.sim.unitTypes.findIndex((t) => t.id === 'mbt_lavi');
      if (idx < 0 || lavi < 0) throw new Error('no unit type');
      const F = ${FIXED};
      const a = ${turns} * Math.PI * 2;
      const mine = L.sim.spawn(idx, 0, Math.round((${at[0]} + 0.5) * F), Math.round((${at[1]} + 0.5) * F), Math.round(${turns} * F) & 0xffff);
      const ox = ${at[0]} + 0.5 + Math.cos(a) * ${OPPONENT_TILES};
      const oy = ${at[1]} + 0.5 + Math.sin(a) * ${OPPONENT_TILES};
      const foe = L.sim.spawn(lavi, 1, Math.round(ox * F), Math.round(oy * F), Math.round(((${turns} + 0.5) % 1) * F) & 0xffff);
      for (let k = 0; k < ${KNOCKOUT_TICKS}; k++) {
        L.step(1);
        if (L.sim.state.alive[mine] === 0) return { ok: false, why: 'died' };
        if (L.sim.state.firepowerKilled[mine] === 1) {
          L.sim.removeFromPlay(foe);
          return { ok: true, id: mine, armed: L.renderer.gunOutFx ? L.renderer.gunOutFx.has(mine) : false };
        }
        for (const i of [mine, foe]) {
          if (L.sim.state.alive[i] === 1) L.sim.state.hp[i] = L.sim.unitTypes[L.sim.state.typeIdx[i]].hp;
        }
      }
      L.sim.removeFromPlay(foe);
      L.sim.removeFromPlay(mine);
      return { ok: false, why: 'no gun kill in the window' };
    })()`;
    const res = (await page.evaluate(script)) as { ok: boolean; why?: string; id?: number; armed?: boolean };
    if (res.ok) return { id: res.id as number, pairs: pair, fxArmed: res.armed as boolean };
    console.log(`[${TAG}] ${type}: pair ${pair}: ${res.why}; trying another`);
  }
  throw new Error(`${type}: no gun knock-out in ${PAIRS_TRIED} pairs`);
}

/** Steps `ticks`, repaints, and photographs the hull where it stands now. */
async function photograph(page: Page, id: number, zoom: number, file: string): Promise<void> {
  const box = BOX[zoom.toFixed(1)];
  const sp = await page.evaluate(
    ([e, z, fixed]) => {
      const L = (window as unknown as LionsWindow).__lions;
      const x = L.sim.state.posX[e as number] / (fixed as number);
      const y = L.sim.state.posY[e as number] / (fixed as number);
      const r = L.renderer;
      r.camera.x = x;
      r.camera.y = y;
      r.camera.zoom = z as number;
      r.frame(1, 0);
      return r.worldToScreen(x, y);
    },
    [id, zoom, FIXED] as [number, number, number]
  );
  const clip = { x: Math.round(sp.x - box.w / 2), y: Math.round(sp.y - box.lift - box.h / 2), width: box.w, height: box.h };
  await page.screenshot({ path: file, clip });
}

// ----------------------------------------------------------------- run ----

/** `ensureDevServer`, retried: it gives the first answer 30 s, and Vite's first answer is slower than that on a
 *  machine carrying a load average in the sixties. Each failed attempt stops its own process group first. */
async function startServer(port: number): Promise<Awaited<ReturnType<typeof ensureDevServer>>> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await ensureDevServer(port, REPO_ROOT, TAG);
    } catch (err) {
      if (attempt >= 4) throw err;
      console.log(`[${TAG}] dev server attempt ${attempt} did not answer in time; trying again`);
    }
  }
}

async function openContext(browser: Browser): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: { ...CAPTURE_VIEWPORT }, deviceScaleFactor: 1 });
  await ctx.addInitScript(musicOffInitScript(SILENT_AUDIO));
  return ctx;
}

async function runProbe(args: Args, port: number): Promise<void> {
  const dev = await startServer(port);
  const browser = await chromium.launch({ headless: true, args: gpuLaunchArgs(args.gpu) });
  try {
    const ctx = await openContext(browser);
    const page = await ctx.newPage();
    page.setDefaultTimeout(120_000);
    await bootSandbox(page, `http://localhost:${port}`);
    const at = parkingTile();
    const turns = await facingFor(page, at, NOSE_DIR);
    for (const id of VEHICLES) {
      const k = await knockOut(page, id, at, turns);
      await page.evaluate(() => (window as unknown as LionsWindow).__lions.step(2));
      console.log(`[${TAG}] ${id} entity ${k.id}`);
      console.log(JSON.stringify(await page.evaluate(`${PROBE_SCRIPT}(${k.id})`), null, 1));
      await page.evaluate((e) => (window as unknown as LionsWindow).__lions.sim.removeFromPlay(e), k.id);
    }
    await ctx.close();
  } finally {
    await browser.close();
    stopDevServer(dev, TAG);
  }
}

interface Cell {
  file: string;
}

async function runFinal(args: Args, port: number): Promise<void> {
  const t0 = Date.now();
  const outDir = path.join(path.dirname(args.out), 'gun-out-final-cells');
  fs.mkdirSync(outDir, { recursive: true });
  const dev = await startServer(port);
  const cells = new Map<string, Cell>();
  const meta = { gpu: 'unknown', notes: [] as string[] };
  try {
    const browser = await chromium.launch({ headless: true, args: gpuLaunchArgs(args.gpu) });
    try {
      meta.gpu = await readUnmaskedRenderer(browser);
      console.log(`[${TAG}] GPU (${args.gpu}): ${meta.gpu}`);
      const ctx = await openContext(browser);
      const page = await ctx.newPage();
      page.setDefaultTimeout(120_000);
      page.on('pageerror', (err) => console.log(`  page error: ${err.message}`));
      page.on('console', (msg) => {
        if (msg.type() === 'error') console.log(`  console.error: ${msg.text()}`);
      });
      await bootSandbox(page, `http://localhost:${port}`);
      const at = parkingTile();
      const turns = await facingFor(page, at, NOSE_DIR);
      for (const id of VEHICLES) {
        const k = await knockOut(page, id, at, turns);
        if (!k.fxArmed) throw new Error(`${id}: the sim took the gun out but the renderer never armed the fire (the event did not reach it)`);
        meta.notes.push(`${id}: knock-out after ${k.pairs} pair(s), effects armed by the renderer`);
        console.log(`[${TAG}] ${meta.notes[meta.notes.length - 1]}`);
        // The fight's own muzzle flashes, tracers and blast lights age on the FRAME clock, which a frozen loop
        // stops: left alone they sit over the hull for the whole sheet. Age them out with repaints at zero sim
        // time (a repaint advances nothing the sim dates, so the knock-out's puff and fire are untouched).
        await page.evaluate(() => {
          const r = (window as unknown as LionsWindow).__lions.renderer;
          for (let k = 0; k < 40; k++) r.frame(1, 100);
        });
        let ticks = 0;
        for (const m of MOMENTS) {
          const dt = m.ticks - ticks;
          await page.evaluate((n) => (window as unknown as LionsWindow).__lions.step(n), dt);
          await page.evaluate(() => {
            const r = (window as unknown as LionsWindow).__lions.renderer;
            for (let k = 0; k < 40; k++) r.frame(1, 100);
          });
          ticks = m.ticks;
          for (const zoom of ZOOMS) {
            const key = `${id}_${m.key}_z${zoom.toFixed(1)}`;
            const file = path.join(outDir, `${key}.png`);
            await photograph(page, k.id, zoom, file);
            cells.set(key, { file });
          }
        }
        await page.evaluate((e) => (window as unknown as LionsWindow).__lions.sim.removeFromPlay(e), k.id);
        await page.evaluate(() => (window as unknown as LionsWindow).__lions.step(2));
      }
      await ctx.close();
    } finally {
      await browser.close();
    }
    await composeSheet(args.out, meta, cells);
  } finally {
    stopDevServer(dev, TAG);
  }
  console.log(`[${TAG}] wrote ${args.out} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

async function composeSheet(out: string, meta: { gpu: string; notes: string[] }, cells: ReadonlyMap<string, Cell>): Promise<void> {
  const img = (key: string): string => {
    const c = cells.get(key);
    return c && fs.existsSync(c.file) ? `<img src="data:image/png;base64,${fs.readFileSync(c.file).toString('base64')}">` : '<div class="missing">not captured</div>';
  };
  const rows = VEHICLES.map((id) => {
    const tds = (zoom: number): string => MOMENTS.map((m) => `<td>${img(`${id}_${m.key}_z${zoom.toFixed(1)}`)}</td>`).join('');
    return `<tr><th class="row">${id}<br><span>zoom 2.5</span></th>${tds(2.5)}</tr><tr><th class="row">${id}<br><span>game zoom 1.0</span></th>${tds(1.0)}</tr>`;
  });
  const heads = MOMENTS.map((m) => `<th>${m.head}</th>`).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin: 0; background: #c6b79c; color: #1f1a14; font: 14px/1.3 -apple-system, Helvetica, Arial, sans-serif; }
    #sheet { display: inline-block; padding: 14px 18px; }
    h1 { font-size: 18px; margin: 0 0 4px; font-weight: 600; }
    table { border-collapse: separate; border-spacing: 6px; }
    th { font-weight: 600; text-align: center; } th span { font-weight: 400; font-size: 12px; }
    th.row { text-align: left; padding-right: 8px; white-space: nowrap; }
    td { padding: 0; } img { display: block; }
    p { margin: 8px 0 0; font-size: 12px; max-width: 1300px; }
  </style></head><body><div id="sheet"><h1>Main gun knocked out: the shipped renderer, a real knock-out</h1>
  <table><tr><th></th>${heads}</tr>${rows.join('\n')}</table>
  <p>The sim's own component roll took each gun out (${meta.notes.join('; ')}). Barrel bent 14 degrees, the Namer's whole mount tilted, the muzzle charred;
  a brief puff at the moment, then a small fire at the turret ring for 8-15 s of sim time that thins into the damage wisp.
  tools/src/perf/gun-out-mock.ts at ${shortCommit()}; both hulls topped up to full hit points between ticks so a component roll could come first; the opponent
  struck from play at the knock-out. Metal, DPR 1, music off, frozen frame loop stepped by the page, GPU ${meta.gpu.replace(/[<>&]/g, '')}.</p></div></body></html>`;
  const browser = await chromium.launch({ headless: true });
  try {
    // music-off: exempt -- a static HTML page with no game in it.
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'load' });
    await page.locator('#sheet').screenshot({ path: out });
    await page.close();
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------- main ----

const args = parseArgs(process.argv.slice(2));
const port = await claimPort(TAG, PORT_ENV, DEFAULT_PORT);
if (args.probe) await runProbe(args, port);
else await runFinal(args, port);
