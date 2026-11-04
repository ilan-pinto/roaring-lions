/**
 * MOCK, nothing shipped (the 4 Nov lead report, part 2): what a tank with its main gun knocked out
 * could look like on the tank itself. `pnpm gun-out:mock`.
 *
 *   pnpm gun-out:mock                         the sheet -> _coord/retarget-gunout/gun-out-mock.png
 *   pnpm gun-out:mock -- --probe              print each live mesh's bounds (the barrel hunt)
 *   pnpm gun-out:mock -- --out=<file.png>     write the sheet elsewhere
 *   pnpm gun-out:mock -- --port=5196 --gpu=metal
 *
 * What it does, and what it does not. The look is applied IN THE PAGE, to the live vehicle's own
 * clone, by a string of plain JavaScript below (`BEND_SCRIPT`): the turret's metal mesh gets its OWN
 * geometry (the template stays untouched, so a healthy twin beside it is the shipped model), the
 * barrel is bent down about the mantlet by a few degrees, and its muzzle end is darkened through a
 * vertex colour. No renderer file is changed: this is the lead's look, approved or not, before any
 * code path exists. Sim state is written ONLY to put the unit's `firepowerKilled` flag up, so the
 * real unit card and chip (which already say "Gun out") are photographed too; that write is this
 * throwaway browser's own, never a sim or app code path.
 *
 * Boots its OWN dev server (default :5196) through `ui-review/port.ts`, refuses a held port, seeds
 * music off through `ui-review/music-off.ts`, opens ONE browser at a time, and stops the server by
 * process group on every exit path. Metal by default on macOS (`--gpu=`); the GPU it got is printed
 * on the sheet.
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
const DEFAULT_OUT = path.resolve(REPO_ROOT, '..', '_coord/retarget-gunout/gun-out-mock.png');
const FIXED = 65536;

/** The two hulls the lead named. */
const VEHICLES = ['mbt_lavi', 'ifv_namer'] as const;
type VehicleId = (typeof VEHICLES)[number];

/** Absolute ticks, so every vehicle is photographed at the same idle phase. */
const SPAWN_TICK = 200;
const CAPTURE_TICK = 240;

/** Where the nose points on screen, as a unit vector (x right, y down). PROFILE shows the barrel's
 *  side; FRONT turns the nose toward the camera, down and to the left. */
const VIEWS = {
  profile: { dir: { x: -1, y: -0.08 }, label: 'side' },
  front: { dir: { x: -0.55, y: 0.83 }, label: 'front three-quarter' },
} as const;
type ViewId = keyof typeof VIEWS;

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
    sel(ids: number[]): void;
    sim: {
      width: number;
      height: number;
      tickCount: number;
      entityCount: number;
      blocked: Uint8Array;
      state: { alive: Uint8Array; firepowerKilled: Uint8Array };
      unitTypes: { id: string }[];
      spawn(typeIdx: number, side: number, x: number, y: number, facing?: number): number;
      removeFromPlay(id: number): void;
    };
    renderer: {
      camera: { x: number; y: number; zoom: number };
      setDebugLayerVisible(name: string, visible: boolean): number;
      frame(alpha: number, dtMs: number): void;
      worldToScreen(wx: number, wy: number): { x: number; y: number };
      vehicleMeshEntities?: Map<number, unknown>;
      vehicleMeshTemplates?: Map<string, unknown>;
    };
  };
}

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

// --------------------------------------------------- the page-side look ----

/**
 * The mock look, as an expression a `page.evaluate` runs. `id` is the entity, `P` the parameters.
 * Plain JavaScript on purpose (no inner TypeScript functions: tsx wraps those in a `__name` the page
 * lacks).
 *
 * For every LIVE turret mesh of the entity whose role is `metal` (the Lavi's `turret_metal` is the
 * barrel and little else; the Namer's holds the cannon with its mount), the geometry is cloned and
 * the vertices ahead of the MANTLET are rotated about the horizontal axis across the hull. The angle
 * eases in from 0 at the mantlet to `P.deg` at the muzzle (a smoothstep), so the barrel droops as one
 * bent tube rather than hinging at a seam. A `color` attribute darkens the last `P.scorch` of the
 * barrel's length, and the mesh gets its own material clone with `vertexColors` on.
 */
const BEND_SCRIPT = `((id, P) => {
  const THREE_ENT = window.__lions.renderer.vehicleMeshEntities.get(id);
  if (!THREE_ENT) return { ok: false, why: 'no entity ' + id };
  const report = [];
  THREE_ENT.root.traverse((o) => {
    if (!o.isMesh || o.userData.rl_wreck === true) return;
    if (!/^turret_metal$/.test(o.name)) return;
    const src = o.geometry;
    const g = src.clone();
    const pos = g.attributes.position;
    let minX = Infinity, maxX = -Infinity;
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i); if (x < minX) minX = x; if (x > maxX) maxX = x; }
    const x0 = P.x0;
    const len = maxX - x0;
    // The bend axis: the mean height of the barrel's first stretch beyond the mantlet.
    let sy = 0, n = 0;
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i); if (x >= x0 && x <= x0 + len * 0.12) { sy += pos.getY(i); n++; } }
    const cy = n > 0 ? sy / n : P.pivotY;
    const rad = P.deg * Math.PI / 180;
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      let t = (x - x0) / len;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const e = t * t * (3 - 2 * t);
      const a = -rad * e;
      const dx = x - x0, dy = y - cy;
      pos.setX(i, x0 + dx * Math.cos(a) - dy * Math.sin(a));
      pos.setY(i, cy + dx * Math.sin(a) + dy * Math.cos(a));
      const s = t <= 1 - P.scorch ? 0 : (t - (1 - P.scorch)) / P.scorch;
      const k = 1 - (1 - P.scorchFloor) * s;
      col[i * 3] = k; col[i * 3 + 1] = k; col[i * 3 + 2] = k;
    }
    pos.needsUpdate = true;
    g.setAttribute('color', new pos.constructor(col, 3));
    g.computeVertexNormals();
    g.computeBoundingBox(); g.computeBoundingSphere();
    const m = Array.isArray(o.material) ? o.material.map((q) => q.clone()) : o.material.clone();
    for (const q of (Array.isArray(m) ? m : [m])) { q.vertexColors = true; q.needsUpdate = true; }
    o.geometry = g;
    o.material = m;
    report.push({ name: o.name, verts: pos.count, minX, maxX, x0 });
  });
  return { ok: true, report };
})`;

/** Prints every live mesh of an entity with its geometry bounds, to find the barrel. */
const PROBE_SCRIPT = `((id) => {
  const ent = window.__lions.renderer.vehicleMeshEntities.get(id);
  if (!ent) return [];
  const out = [];
  ent.root.traverse((o) => {
    if (!o.isMesh || o.userData.rl_wreck === true) return;
    const g = o.geometry; g.computeBoundingBox(); const b = g.boundingBox;
    out.push({ name: o.name, parent: o.parent && o.parent.name, verts: g.attributes.position.count,
      min: [b.min.x, b.min.y, b.min.z].map((v) => Math.round(v * 1000) / 1000),
      max: [b.max.x, b.max.y, b.max.z].map((v) => Math.round(v * 1000) / 1000),
      pos: o.position.toArray().map((v) => Math.round(v * 1000) / 1000), textured: !!(o.material && o.material.map) });
  });
  return out;
})`;

// ------------------------------------------------------- page choreography ----

async function bootSandbox(page: Page, base: string, hideHud: boolean): Promise<void> {
  await page.goto(`${base}/free-play/${MAP_ID}`, { waitUntil: 'load', timeout: 90_000 });
  await page.waitForFunction(() => !!(window as unknown as LionsWindow).__lions?.renderer, null, { timeout: 90_000 });
  await page.evaluate(FREEZE_FRAME_LOOP_SCRIPT);
  await page.evaluate(() => document.fonts.ready);
  if (hideHud) await page.evaluate(hideHudExceptCanvas);
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

/** The open tile nearest the map's middle with a clear 9x9 block around it, read from the map JSON. */
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

async function spawnAt(page: Page, id: VehicleId, at: [number, number], turns: number): Promise<number> {
  const ent = await page.evaluate(
    ([tid, x, y, f, fixed]) => {
      const L = (window as unknown as LionsWindow).__lions;
      const typeIdx = L.sim.unitTypes.findIndex((t) => t.id === tid);
      if (typeIdx < 0) throw new Error('no unit type ' + tid);
      return L.sim.spawn(typeIdx, 0, Math.round((x + 0.5) * fixed), Math.round((y + 0.5) * fixed), Math.round(f * fixed) & 0xffff);
    },
    [id, at[0], at[1], turns, FIXED] as [string, number, number, number, number]
  );
  // Two 1 Hz mesh sweeps load an unrostered type's template (main.ts); then a frame builds the entity.
  await page.evaluate((t) => {
    const L = (window as unknown as LionsWindow).__lions;
    L.step(t - L.sim.tickCount);
  }, CAPTURE_TICK);
  const deadline = Date.now() + 90_000;
  for (;;) {
    const ready = await page.evaluate((e) => {
      const r = (window as unknown as LionsWindow).__lions.renderer;
      r.frame(1, 0);
      return r.vehicleMeshEntities?.has(e) === true;
    }, ent);
    if (ready) break;
    if (Date.now() > deadline) throw new Error(`${id}: the mesh entity never appeared`);
    await page.evaluate(() => (window as unknown as LionsWindow).__lions.step(20));
    await sleep(400);
  }
  return ent;
}

async function shoot(page: Page, at: [number, number], zoom: number, file: string): Promise<void> {
  const box = BOX[zoom.toFixed(1)];
  const sp = await page.evaluate(
    ([x, y, z]) => {
      const r = (window as unknown as LionsWindow).__lions.renderer;
      r.camera.x = x;
      r.camera.y = y;
      r.camera.zoom = z;
      r.frame(1, 0);
      return r.worldToScreen(x, y);
    },
    [at[0] + 0.5, at[1] + 0.5, zoom] as [number, number, number]
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

/** The mantlet, per hull: the x where the turret body ends and the barrel begins (from `--probe`). */
const MANTLET_X: Readonly<Record<VehicleId, number>> = { mbt_lavi: 0.95, ifv_namer: 1.15 };

/** The three states photographed: the shipped model, then the bend at two strengths. */
const STATES = [
  { key: 'healthy', deg: 0, head: 'healthy' },
  { key: 'a', deg: 8, head: 'gun out: 8 degrees' },
  { key: 'b', deg: 14, head: 'gun out: 14 degrees' },
] as const;

const MOCK_LOOK = {
  /** Tilt of the muzzle end, degrees downward ("a few degrees"). */
  deg: 8, // overridden per state
  /** Where the bend starts: the turret's front face in the mesh's own space, per hull (the probe). */
  x0: 0,
  /** A fallback bend-axis height if no vertex lies in the barrel's first stretch. */
  pivotY: 0,
  /** The muzzle fraction darkened, and how dark the very tip gets. */
  scorch: 0.3,
  scorchFloor: 0.18,
};

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
    await bootSandbox(page, `http://localhost:${port}`, true);
    const at = parkingTile();
    for (const id of VEHICLES) {
      const turns = await facingFor(page, at, VIEWS.profile.dir);
      const ent = await spawnAt(page, id, at, turns);
      console.log(`[${TAG}] ${id} entity ${ent}`);
      console.log(JSON.stringify(await page.evaluate(`${PROBE_SCRIPT}(${ent})`), null, 1));
      await page.evaluate((e) => (window as unknown as LionsWindow).__lions.sim.removeFromPlay(e), ent);
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

async function runSheet(args: Args, port: number): Promise<void> {
  const t0 = Date.now();
  const outDir = path.join(path.dirname(args.out), 'gun-out-cells');
  fs.mkdirSync(outDir, { recursive: true });
  const dev = await startServer(port);
  const cells = new Map<string, Cell>();
  const meta = { gpu: 'unknown' };
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
      await bootSandbox(page, `http://localhost:${port}`, true);
      const at = parkingTile();
      for (const id of VEHICLES) {
        for (const view of Object.keys(VIEWS) as ViewId[]) {
          const turns = await facingFor(page, at, VIEWS[view].dir);
          for (const state of STATES) {
            // A fresh hull per state: the bend works on the entity's own geometry and must not stack.
            const ent = await spawnAt(page, id, at, turns);
            if (state.deg > 0) {
              const probe = (await page.evaluate(`${PROBE_SCRIPT}(${ent})`)) as { name: string; min: number[]; max: number[] }[];
              const metal = probe.find((m) => m.name === 'turret_metal');
              if (!metal) throw new Error(`${id}: no turret_metal mesh (saw ${probe.map((m) => m.name).join(', ')})`);
              const look = { ...MOCK_LOOK, deg: state.deg, x0: MANTLET_X[id], pivotY: (metal.min[1] + metal.max[1]) / 2 };
              const res = (await page.evaluate(`${BEND_SCRIPT}(${ent}, ${JSON.stringify(look)})`)) as { ok: boolean; why?: string };
              if (!res.ok) throw new Error(`${id}: bend failed: ${res.why}`);
              await page.evaluate((e) => {
                (window as unknown as LionsWindow).__lions.sim.state.firepowerKilled[e] = 1;
              }, ent);
            }
            for (const zoom of [2.5, 1.0]) {
              const key = `${id}_${view}_${state.key}_z${zoom.toFixed(1)}`;
              const file = path.join(outDir, `${key}.png`);
              await shoot(page, at, zoom, file);
              cells.set(key, { file });
            }
            await page.evaluate((e) => (window as unknown as LionsWindow).__lions.sim.removeFromPlay(e), ent);
          }
        }
      }
      await ctx.close();
      const hud = await shootHud(browser, `http://localhost:${port}`, outDir);
      cells.set('hud_healthy', { file: hud.healthy });
      cells.set('hud_gunout', { file: hud.gunout });
    } finally {
      await browser.close();
    }
    await composeSheet(args.out, meta.gpu, cells);
  } finally {
    stopDevServer(dev, TAG);
  }
  console.log(`[${TAG}] wrote ${args.out} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}


/**
 * The real unit card and chip for a selected Lavi, healthy and then with `firepowerKilled` up. The
 * app already says "Gun out" there (`hud.ts`, `combat-state.ts`'s `vehicleDamage`); this photographs
 * it so the sheet shows what the lead has today beside the model change. A live (unfrozen) page: the
 * card refreshes at its own 4 Hz cadence.
 */
async function shootHud(browser: Browser, base: string, outDir: string): Promise<{ healthy: string; gunout: string }> {
  const ctx = await openContext(browser);
  try {
    const page = await ctx.newPage();
    page.setDefaultTimeout(120_000);
    await page.goto(`${base}/free-play/${MAP_ID}`, { waitUntil: 'load', timeout: 90_000 });
    await page.waitForFunction(() => !!(window as unknown as LionsWindow).__lions?.renderer, null, { timeout: 90_000 });
    const at = parkingTile();
    const ent = await page.evaluate(
      ([x, y, fixed]) => {
        const L = (window as unknown as LionsWindow).__lions;
        for (let i = 0; i < L.sim.entityCount; i++) if (L.sim.state.alive[i] === 1) L.sim.removeFromPlay(i);
        const typeIdx = L.sim.unitTypes.findIndex((t) => t.id === 'mbt_lavi');
        const id = L.sim.spawn(typeIdx, 0, Math.round((x + 0.5) * fixed), Math.round((y + 0.5) * fixed), 0);
        L.renderer.camera.x = x + 0.5;
        L.renderer.camera.y = y + 0.5;
        L.renderer.camera.zoom = 1;
        return id;
      },
      [at[0], at[1], FIXED] as [number, number, number]
    );
    const photograph = async (name: string): Promise<string> => {
      await page.evaluate((e) => (window as unknown as LionsWindow).__lions.sel([e]), ent);
      await sleep(2500);
      const file = path.join(outDir, `hud_${name}.png`);
      const cluster = page.locator('.rl-cluster');
      await cluster.screenshot({ path: file });
      return file;
    };
    const healthy = await photograph('healthy');
    await page.evaluate((e) => {
      (window as unknown as LionsWindow).__lions.sim.state.firepowerKilled[e] = 1;
    }, ent);
    const gunout = await photograph('gunout');
    return { healthy, gunout };
  } finally {
    await ctx.close();
  }
}

async function composeSheet(out: string, gpuName: string, cells: ReadonlyMap<string, Cell>): Promise<void> {
  const img = (key: string): string => {
    const c = cells.get(key);
    return c && fs.existsSync(c.file) ? `<img src="data:image/png;base64,${fs.readFileSync(c.file).toString('base64')}">` : '<div class="missing">not captured</div>';
  };
  const rows: string[] = [];
  for (const id of VEHICLES) {
    for (const view of Object.keys(VIEWS) as ViewId[]) {
      const z25 = STATES.map((st) => `<td>${img(`${id}_${view}_${st.key}_z2.5`)}</td>`).join('');
      const z10 = STATES.map((st) => `<td>${img(`${id}_${view}_${st.key}_z1.0`)}</td>`).join('');
      rows.push(
        `<tr><th class="row">${id}<br><span>${VIEWS[view].label}, zoom 2.5</span></th>${z25}` +
          `<th class="row">zoom 1.0<br><span>game scale</span></th>${z10}</tr>`
      );
    }
  }
  const heads = STATES.map((st) => `<th>${st.head}</th>`).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin: 0; background: #c6b79c; color: #1f1a14; font: 14px/1.3 -apple-system, Helvetica, Arial, sans-serif; }
    #sheet { display: inline-block; padding: 14px 18px; }
    h1 { font-size: 18px; margin: 0 0 4px; font-weight: 600; }
    table { border-collapse: separate; border-spacing: 6px; }
    th { font-weight: 600; text-align: center; }
    th span { font-weight: 400; font-size: 12px; }
    th.row { text-align: left; padding-right: 8px; white-space: nowrap; }
    td { padding: 0; } img { display: block; }
    p { margin: 8px 0 0; font-size: 12px; max-width: 1500px; }
  </style></head><body><div id="sheet"><h1>Main gun knocked out: the model shows it (MOCK, nothing shipped)</h1>
  <table><tr><th></th>${heads}<th></th>${heads}</tr>${rows.join('\n')}</table>
  <h1 style="margin-top:14px">Unit card and chip, today (the app already says it; selected Lavi)</h1>
  <table><tr><th class="row">healthy</th><td>${img('hud_healthy')}</td></tr><tr><th class="row">gun out</th><td>${img('hud_gunout')}</td></tr></table>
  <p>Gun out: the barrel bent down about the mantlet by 8 degrees (a few degrees) or 14 (louder), its last ${Math.round(MOCK_LOOK.scorch * 100)}% scorched.
  Applied in the page to the live unit's own turret mesh by tools/src/perf/gun-out-mock.ts at ${shortCommit()}; the healthy twin is the shipped model.
  The existing dark damage wisp is on the gun-out tank in both cases. Metal, DPR 1, music off, frozen frame loop, GPU ${gpuName.replace(/[<>&]/g, '')}.</p></div></body></html>`;
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
else await runSheet(args, port);
