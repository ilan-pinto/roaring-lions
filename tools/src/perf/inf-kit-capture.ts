/**
 * The infantry kit in the running game (GH-826): `pnpm inf-kit:capture`.
 *
 *   pnpm inf-kit:capture -- --out=<dir> [--port=<n>] [--gpu=metal|swiftshader]
 *
 * `inf_squad` photographed by the game's own camera at zoom 1.0 and 2.5, at
 * tier 0, EVERY tier of each track alone (armour, sensors, firepower: eleven
 * states with the full kit, all three at tier 3). The browser is made to serve the
 * switch ON (`forceKitOn`), for the capture only, from two facings (the flank and rear toward the
 * camera, and the front three-quarter). One Metal browser, opened only after
 * the last one closed; one fresh context per state, because a type's tiers are
 * fixed at BOOT (brigade D3) and reach the renderer the way a player's do:
 * the brigade account is seeded (`garage-seed.ts`'s shape), the sandbox booted
 * WITHOUT `&kit`, and `upgradePrepass` -> `RendererOptions.unitKitTiers` ->
 * `loadMeshUnit` -> `buildMeshUnitTemplate` does the rest. Every page is seeded
 * music off (`ui-review/music-off.ts`). The tool boots its OWN dev server
 * (default :5233) and refuses a port something else already holds.
 *
 * Before a cell is trusted the MERGE is read back from the renderer itself:
 * the tiers it received (`opts.unitKitTiers`), the squad template's live
 * triangle count and kit triangle count (`rlKitBaseCount`), held against the
 * numbers `infantry-kit-shipped.test.ts` pins from the GLB. A silent no-op
 * (the seed not arriving, a merge that kept nothing) would otherwise be a
 * sheet of identical pictures. Draw calls are read per state by hand
 * (`renderer.info`, `autoReset` off): the kit must cost +0.
 *
 * Outputs under `--out`: `cells/<state>_f<facing>_z<zoom>.png`, `zoom1.0.png`
 * and `zoom2.5.png` (contact sheets, one row per facing, one column per
 * state), and `readings.json`.
 *
 * ## `--garage` (GH-826, the bay's turntable)
 *
 *   pnpm inf-kit:capture -- --garage --out=<dir> [--port=<n>] [--gpu=metal|swiftshader]
 *
 * The same squad on the brigade bay's turntable (`/brigade`, `inf_squad`'s
 * card) at three states, photographed at the default face (Home, 0 deg) and
 * the far side (End, 180 deg), the turntable focused so it does not auto-turn:
 * `T0` (an account with no tiers), `full` (all three tracks at tier 3, seeded,
 * so the model MOUNTS wearing them) and `bought` (the tier-0 account, then
 * every rung bought by clicking Buy, so the model RE-MERGES through `setKit`
 * live). Writes `garage-<state>-<yaw>.png` under `--out`. The check: the full
 * and bought pictures must differ from tier 0 and agree with each other, at
 * both angles -- a bay that ignored the tiers would be three identical
 * pictures and the run exits 1.
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { PNG } from 'pngjs';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ensureDevServer, stopDevServer, readUnmaskedRenderer } from '../golden-diff/browser';
import { CAPTURE_VIEWPORT, FREEZE_FRAME_LOOP_SCRIPT, hideHudExceptCanvas } from '../golden-diff/capture-protocol';
import { musicOffInitScript, SILENT_AUDIO } from '../ui-review/music-off';
import { garageSeedScript, GARAGE_SEED_LEDGER } from '../ui-review/garage-seed';
import { claimPort } from '../ui-review/port';
import { gpuLaunchArgs, resolveGpuBackend } from '../ui-review/gpu';
import type { BrigadeAccount } from '../../../packages/app/src/brigade-account';
import { ACCOUNT_VERSION } from '../../../packages/app/src/brigade-account';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const TAG = 'inf-kit-capture';
const PORT_ENV = 'INF_KIT_CAPTURE_PORT';
const DEFAULT_PORT = 5233;
const UNIT = 'inf_squad';
const MAP_ID = 'beit_sahwan_outskirts';

import { STATES, differingPixels, mergeFailures, type Reading, type State } from './inf-kit-capture-check';

const FACINGS = [
  { id: 'rear', label: 'flank and rear to the camera', offsetTurns: 0 },
  { id: 'front', label: 'front three-quarter', offsetTurns: 0.5 },
] as const;
const ZOOMS = [1.0, 2.5] as const;
const BOX: Readonly<Record<string, { w: number; h: number; lift: number }>> = {
  '1.0': { w: 200, h: 160, lift: 12 },
  '2.5': { w: 380, h: 320, lift: 30 },
};
const EDGE_TILES = 4;
const SPAWN_TICK = 200;
const SWEEP_TICK = 220;
const CAPTURE_TICK = 240;
const TARGET_SCREEN_DIR = { x: -Math.cos(Math.PI / 3), y: -Math.sin(Math.PI / 3) };
const FACING_CANDIDATES = 64;
const FIXED = 65536;

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
      renderer: { info: { autoReset: boolean; reset(): void; render: { calls: number; triangles: number } } };
      opts?: { unitKitTiers?: Record<string, Record<string, number>> };
      meshUnitTemplates?: Map<string, { root: TemplateObject }[]>;
    };
  };
}
interface TemplateObject {
  name: string;
  isMesh?: boolean;
  geometry?: { index: { count: number } | null; attributes: { position: { count: number } }; userData: Record<string, unknown> };
  traverse(fn: (o: TemplateObject) => void): void;
}

function usage(msg: string): never {
  console.error(`[${TAG}] ${msg}`);
  console.error(`[${TAG}] usage: pnpm inf-kit:capture -- [--garage] --out=<dir> [--port=<n>] [--gpu=metal|swiftshader]`);
  process.exit(2);
}

function parseArgs(argv: readonly string[]): { out: string; gpu: ReturnType<typeof resolveGpuBackend>; garage: boolean } {
  let out = path.join(REPO_ROOT, '.superpowers/inf-kit/ingame');
  let garage = false;
  for (const a of argv) {
    if (a === '--') continue;
    if (a === '--garage') garage = true;
    else if (a.startsWith('--out=')) out = path.resolve(a.slice('--out='.length));
    else if (a.startsWith('--port=') || a.startsWith('--gpu=')) {
      // Parsed (and refused when malformed) by `claimPort` / `resolveGpuBackend`.
    } else usage(`unknown argument "${a}"`);
  }
  let gpu: ReturnType<typeof resolveGpuBackend>;
  try {
    gpu = resolveGpuBackend(argv, process.platform);
  } catch (err) {
    usage(err instanceof Error ? err.message : String(err));
  }
  return { out, gpu, garage };
}

function accountWith(tiers: Readonly<Record<string, number>>): BrigadeAccount {
  return {
    version: ACCOUNT_VERSION,
    balance: 2400,
    earned_total: 0,
    paid: {},
    campaign_paid: {},
    unlocks: [],
    upgrades: { [UNIT]: { ...tiers } },
    grants: [{ source: 'granted', amount: 5000, at: 1 }],
    coupons: [],
  };
}

/**
 * The shipped switch is ON (`INFANTRY_KIT_ENABLED`, GH-826, since 29 Oct 2026), but a capture must not depend on
 * that staying so: the served `infantry-kit.ts` module is rewritten in flight (`= false` -> `= true`), which is a
 * no-op while the switch ships on and still makes the capture see the kit if it is ever killed again. Nothing on
 * disk changes. A hit is counted when the module was served with the switch reading `true` afterwards, so a run
 * that never saw the module (a renamed constant, a different module path) is refused rather than photographed as
 * a sheet of tier-0 figures.
 */
async function forceKitOn(ctx: BrowserContext): Promise<{ hits: number }> {
  const counter = { hits: 0 };
  await ctx.route(/\/infantry-kit\.ts(\?.*)?$/, async (route) => {
    const resp = await route.fetch();
    const body = await resp.text();
    const next = body.replace(/(export const INFANTRY_KIT_ENABLED[^=]*=\s*)false/, '$1true');
    if (/export const INFANTRY_KIT_ENABLED[^=]*=\s*true/.test(next)) counter.hits++;
    await route.fulfill({ response: resp, body: next });
  });
  return counter;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function bootSandbox(page: Page, base: string): Promise<void> {
  await page.goto(`${base}/free-play/${MAP_ID}`, { waitUntil: 'load', timeout: 60_000 });
  await page.waitForFunction(() => !!(window as unknown as LionsWindow).__lions?.renderer, null, { timeout: 60_000 });
  await page.evaluate(FREEZE_FRAME_LOOP_SCRIPT);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(hideHudExceptCanvas);
  await page.evaluate(() => {
    const L = (window as unknown as LionsWindow).__lions;
    for (const layer of ['fog', 'overlays', 'wind']) L.renderer.setDebugLayerVisible(layer, false);
    for (let i = 0; i < L.sim.entityCount; i++) if (L.sim.state.alive[i] === 1) L.sim.removeFromPlay(i);
  });
}

/** The first open tile, scanned row-major, with no non-open map tile within the
 *  box on screen (kit-captures' parade rule, for one unit). */
async function openTile(page: Page): Promise<[number, number]> {
  const rows = (JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'data/maps', `${MAP_ID}.json`), 'utf8')) as { rows: string[] }).rows;
  const obstacles: [number, number][] = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] !== '.') obstacles.push([x, y]);
  });
  const box = BOX['2.5'];
  const tile = await page.evaluate(
    ([obs, edge, bw, bh, lift]) => {
      const L = (window as unknown as LionsWindow).__lions;
      const r = L.renderer;
      const w = L.sim.width;
      const h = L.sim.height;
      r.camera.x = w / 2;
      r.camera.y = h / 2;
      r.camera.zoom = 2.5;
      const top = -lift - bh / 2;
      const bottom = -lift + bh / 2;
      for (let ty = edge; ty < h - edge; ty++) {
        for (let tx = edge; tx < w - edge; tx++) {
          if (L.sim.blocked[ty * w + tx] !== 0) continue;
          const c = r.worldToScreen(tx + 0.5, ty + 0.5);
          let ok = true;
          for (const o of obs) {
            const p = r.worldToScreen(o[0] + 0.5, o[1] + 0.5);
            const ox = p.x - c.x;
            const oy = p.y - c.y;
            if (Math.abs(ox) < bw / 2 + 48 && oy > top - 48 && oy < bottom + 240) {
              ok = false;
              break;
            }
          }
          if (ok) return [tx, ty] as [number, number];
        }
      }
      return null;
    },
    [obstacles, EDGE_TILES, box.w, box.h, box.lift] as [[number, number][], number, number, number, number]
  );
  if (!tile) throw new Error(`no open tile found on ${MAP_ID}`);
  return tile;
}

async function measureFacing(page: Page, at: [number, number]): Promise<number> {
  return page.evaluate(
    ([x, y, tdx, tdy, n]) => {
      const r = (window as unknown as LionsWindow).__lions.renderer;
      const o = r.worldToScreen(x, y);
      let best = { turns: 0, score: -2 };
      for (let i = 0; i < n; i++) {
        const turns = i / n;
        const p = r.worldToScreen(x + Math.cos(turns * 2 * Math.PI), y + Math.sin(turns * 2 * Math.PI));
        const dx = p.x - o.x;
        const dy = p.y - o.y;
        const score = (dx * tdx + dy * tdy) / Math.hypot(dx, dy);
        if (score > best.score) best = { turns, score };
      }
      return best.turns;
    },
    [at[0], at[1], TARGET_SCREEN_DIR.x, TARGET_SCREEN_DIR.y, FACING_CANDIDATES] as [number, number, number, number, number]
  );
}

async function readMerge(page: Page): Promise<Reading> {
  return page.evaluate((id) => {
    const r = (window as unknown as LionsWindow).__lions.renderer;
    const variants = r.meshUnitTemplates?.get(id);
    let tris = 0;
    let kitTris = 0;
    let meshes = 0;
    if (variants) {
      const seen = new Set<unknown>();
      for (const t of variants) {
        t.root.traverse((o) => {
          if (!o.isMesh || !o.geometry) return;
          meshes++;
          const g = o.geometry;
          if (seen.has(g)) return;
          seen.add(g);
          const count = g.index ? g.index.count : g.attributes.position.count;
          const base = typeof g.userData.rlKitBaseCount === 'number' ? (g.userData.rlKitBaseCount as number) : count;
          tris += count / 3;
          kitTris += (count - base) / 3;
        });
      }
    }
    const tiers = r.opts?.unitKitTiers?.[id] ?? null;
    return { tiers: tiers ? { ...tiers } : null, loaded: !!variants, tris, kitTris, meshes, calls: 0 };
  }, UNIT);
}

async function drawCalls(page: Page): Promise<number> {
  return page.evaluate(() => {
    const R = (window as unknown as LionsWindow).__lions.renderer;
    const info = R.renderer.info;
    info.autoReset = false;
    info.reset();
    R.frame(1, 0);
    const c = info.render.calls;
    info.autoReset = true;
    return c;
  });
}

async function composeSheet(
  browser: Browser,
  outFile: string,
  title: string,
  footer: string,
  columns: readonly string[],
  rows: readonly { label: string; cells: readonly string[] }[],
  scale = 1
): Promise<void> {
  const img = (file: string): string =>
    fs.existsSync(file) ? `<img src="data:image/png;base64,${fs.readFileSync(file).toString('base64')}">` : '<div class="missing">not captured</div>';
  const head = columns.map((c) => `<th>${c}</th>`).join('');
  const body = rows.map((r) => `<tr><th class="row">${r.label}</th>${r.cells.map((c) => `<td>${img(c)}</td>`).join('')}</tr>`).join('\n');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin: 0; background: #c6b79c; color: #1f1a14; font: 14px/1.3 -apple-system, Helvetica, Arial, sans-serif; }
    #sheet { display: inline-block; padding: 14px 18px; }
    h1 { font-size: 18px; margin: 0 0 8px; font-weight: 600; }
    table { border-collapse: separate; border-spacing: 6px; }
    th { font-weight: 600; text-align: center; }
    th.row { text-align: left; padding-right: 8px; white-space: nowrap; }
    td { padding: 0; }
    img { display: block; image-rendering: pixelated; zoom: ${scale}; }
    .missing { padding: 20px; color: #6b1d1d; }
    p { margin: 8px 0 0; font-size: 12px; max-width: 1400px; }
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

async function captureState(browser: Browser, base: string, state: State, cellDir: string): Promise<Reading & { facingTurns: number; tile: [number, number] }> {
  const ctx = await browser.newContext({ viewport: { ...CAPTURE_VIEWPORT }, deviceScaleFactor: 1 });
  try {
    await ctx.addInitScript(musicOffInitScript(SILENT_AUDIO));
    await ctx.addInitScript(garageSeedScript(GARAGE_SEED_LEDGER, accountWith(state.tiers)));
    const forced = await forceKitOn(ctx);
    const page = await ctx.newPage();
    page.setDefaultTimeout(120_000);
    page.on('pageerror', (err) => console.log(`  [${state.id}] page error: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.log(`  [${state.id}] console.error: ${msg.text()}`);
    });
    await bootSandbox(page, base);
    const tick0 = await page.evaluate(() => (window as unknown as LionsWindow).__lions.sim.tickCount);
    if (tick0 > SPAWN_TICK) throw new Error(`${state.id}: the loop ran to tick ${tick0} before the freeze (> ${SPAWN_TICK})`);
    await page.evaluate((t) => {
      const L = (window as unknown as LionsWindow).__lions;
      L.step(t - L.sim.tickCount);
    }, SPAWN_TICK);
    const tile = await openTile(page);
    const cx = tile[0] + 0.5;
    const cy = tile[1] + 0.5;
    await page.evaluate(
      ([x, y]) => {
        const c = (window as unknown as LionsWindow).__lions.renderer.camera;
        c.x = x;
        c.y = y;
        c.zoom = 1;
      },
      [cx, cy] as [number, number]
    );
    const turns = await measureFacing(page, [cx, cy]);
    const facings = FACINGS.map((f) => (turns + f.offsetTurns) % 1);
    await page.evaluate(
      ([unit, x, y, fixed, ft]) => {
        const L = (window as unknown as LionsWindow).__lions;
        const typeIdx = L.sim.unitTypes.findIndex((t) => t.id === unit);
        if (typeIdx < 0) throw new Error(`no unit type "${unit}" in this build`);
        L.sim.spawn(typeIdx, 0, Math.round(x * fixed), Math.round(y * fixed), ft);
      },
      [UNIT, cx, cy, FIXED, Math.round(facings[0] * FIXED) & 0xffff] as [string, number, number, number, number]
    );
    // The mesh sweep runs on `tickCount % 20 === 0`: step to the next sweep, then wait on wall
    // time for the template. Stepping while waiting would let the idle phase drift per state.
    await page.evaluate((t) => {
      const L = (window as unknown as LionsWindow).__lions;
      L.step(t - L.sim.tickCount);
    }, SWEEP_TICK);
    const deadline = Date.now() + 90_000;
    for (;;) {
      const loaded = await page.evaluate((id) => !!(window as unknown as LionsWindow).__lions.renderer.meshUnitTemplates?.has(id), UNIT);
      if (loaded) break;
      if (Date.now() > deadline) throw new Error(`${state.id}: the ${UNIT} template never loaded`);
      await sleep(500);
    }
    const tickAtCapture = await page.evaluate((t) => {
      const L = (window as unknown as LionsWindow).__lions;
      L.step(t - L.sim.tickCount);
      L.renderer.frame(1, 0);
      return L.sim.tickCount;
    }, CAPTURE_TICK);
    if (tickAtCapture !== CAPTURE_TICK) throw new Error(`${state.id}: captured at tick ${tickAtCapture}, not ${CAPTURE_TICK}`);
    const reading = await readMerge(page);
    if (forced.hits === 0) throw new Error(`${state.id}: the switch was never forced on (no infantry-kit.ts rewritten)`);

    // Camera at the squad, per zoom; the second facing is a re-spawn on the same tile after the first was struck.
    for (let fi = 0; fi < FACINGS.length; fi++) {
      if (fi > 0) {
        await page.evaluate(
          ([unit, x, y, fixed, ft]) => {
            const L = (window as unknown as LionsWindow).__lions;
            for (let i = 0; i < L.sim.entityCount; i++) if (L.sim.state.alive[i] === 1) L.sim.removeFromPlay(i);
            const typeIdx = L.sim.unitTypes.findIndex((t) => t.id === unit);
            L.sim.spawn(typeIdx, 0, Math.round(x * fixed), Math.round(y * fixed), ft);
            L.step(40);
          },
          [UNIT, cx, cy, FIXED, Math.round(facings[fi] * FIXED) & 0xffff] as [string, number, number, number, number]
        );
      }
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
        const clip = { x: Math.round(sp.x - box.w / 2), y: Math.round(sp.y - box.lift - box.h / 2), width: box.w, height: box.h };
        if (clip.x < 0 || clip.y < 0 || clip.x + clip.width > CAPTURE_VIEWPORT.width || clip.y + clip.height > CAPTURE_VIEWPORT.height) {
          throw new Error(`${state.id} z${zKey}: clip ${JSON.stringify(clip)} leaves the viewport`);
        }
        await page.screenshot({ path: path.join(cellDir, `${state.id}_${FACINGS[fi].id}_z${zKey}.png`), clip });
        if (fi === 0 && zoom === 2.5) reading.calls = await drawCalls(page);
      }
    }
    return { ...reading, facingTurns: turns, tile };
  } finally {
    await ctx.close();
  }
}

function shortCommit(): string {
  try {
    return execFileSync('/usr/bin/git', ['-C', REPO_ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

// -------------------------------------------------------------- garage ----

const GARAGE_STATES = [
  { id: 'T0', label: 'tier 0', tiers: {} as Record<string, number>, buyAll: false },
  { id: 'full', label: 'full kit, seeded', tiers: { armour: 3, sensors: 3, firepower: 3 }, buyAll: false },
  { id: 'bought', label: 'full kit, bought live', tiers: {} as Record<string, number>, buyAll: true },
] as const;
const GARAGE_YAWS = [
  ['Home', 0],
  ['End', 180],
] as const;

/** `differingPixels` over two PNG files. */
function differingPixelsOf(a: string, b: string): number {
  return differingPixels(PNG.sync.read(fs.readFileSync(a)), PNG.sync.read(fs.readFileSync(b)));
}

async function runGarage(out: string, gpu: ReturnType<typeof resolveGpuBackend>, base: string): Promise<string[]> {
  const failures: string[] = [];
  const browser = await chromium.launch({ headless: true, args: gpuLaunchArgs(gpu) });
  try {
    console.log(`[${TAG}] GPU (${gpu}): ${await readUnmaskedRenderer(browser)}`);
    const frames = (page: Page): Promise<number> =>
      page.evaluate(() => Number(document.querySelector<HTMLElement>('.rl-garage__plate .rl-garage__model')?.dataset.frames ?? 0));
    for (const state of GARAGE_STATES) {
      const ctx = await browser.newContext({ viewport: { ...CAPTURE_VIEWPORT }, deviceScaleFactor: 1 });
      try {
        await ctx.addInitScript(musicOffInitScript(SILENT_AUDIO));
        await ctx.addInitScript(garageSeedScript(GARAGE_SEED_LEDGER, accountWith(state.tiers)));
        const forced = await forceKitOn(ctx);
        const page = await ctx.newPage();
        page.setDefaultTimeout(60_000);
        page.on('pageerror', (err) => console.log(`  [garage ${state.id}] page error: ${err.message}`));
        page.on('console', (msg) => {
          if (msg.type() === 'error') console.log(`  [garage ${state.id}] console.error: ${msg.text()}`);
        });
        await page.goto(`${base}/brigade`, { waitUntil: 'load' });
        await page.waitForSelector('.rl-garage__card');
        await page.click(`.rl-garage__card[data-unit="${UNIT}"]`);
        await page.waitForFunction(
          () => {
            const plate = document.querySelector<HTMLElement>('.rl-garage__plate');
            const model = plate?.querySelector<HTMLElement>('.rl-garage__model');
            return plate?.dataset.model === 'live' && Number(model?.dataset.frames ?? 0) >= 1;
          },
          undefined,
          { timeout: 90_000 }
        );
        if (state.buyAll) {
          // Every rung, by the Buy button a player clicks: the model re-merges through `setKit`.
          for (let n = 0; n < 9; n++) {
            const before = await frames(page);
            const clicked = await page.evaluate(() => {
              const b = document.querySelector<HTMLButtonElement>('.rl-garage__buy-tier:not([disabled])');
              b?.click();
              return b !== null;
            });
            if (!clicked) {
              failures.push(`${state.id}: no Buy button left after ${n} purchases`);
              break;
            }
            await page.waitForFunction(
              (f) => Number(document.querySelector<HTMLElement>('.rl-garage__plate .rl-garage__model')?.dataset.frames ?? 0) > f,
              before,
              { timeout: 10_000 }
            ).catch(() => failures.push(`${state.id}: purchase ${n + 1} drew no new frame`));
            await sleep(450);
          }
          const kit = await page.evaluate(() => document.querySelector<HTMLElement>('.rl-garage__plate')?.dataset.kit);
          console.log(`[${TAG}] ${state.id}: ${await frames(page)} frames after the purchases, plate kit level ${kit}`);
        }
        for (const [key, deg] of GARAGE_YAWS) {
          const before = await frames(page);
          await page.focus('.rl-garage__plate .rl-garage__model');
          await page.keyboard.press(key);
          await page
            .waitForFunction(
              (f) => Number(document.querySelector<HTMLElement>('.rl-garage__plate .rl-garage__model')?.dataset.frames ?? 0) > f,
              before,
              { timeout: 10_000 }
            )
            .catch(() => undefined); // Home on an already-0 yaw may draw nothing new
          await sleep(400);
          await page.locator('.rl-garage__plate').screenshot({ path: path.join(out, `garage-${state.id}-${deg}.png`) });
        }
        if (forced.hits === 0) failures.push(`${state.id}: the switch was never forced on (no infantry-kit.ts rewritten)`);
        console.log(`[${TAG}] garage ${state.id} (${state.label}): photographed (switch forced on in this browser: ${forced.hits} rewrite(s))`);
      } finally {
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
  }
  for (const [, deg] of GARAGE_YAWS) {
    const f = (id: string): string => path.join(out, `garage-${id}-${deg}.png`);
    const seeded = differingPixelsOf(f('T0'), f('full'));
    const bought = differingPixelsOf(f('T0'), f('bought'));
    const agree = differingPixelsOf(f('full'), f('bought'));
    console.log(`[${TAG}] yaw ${deg}: pixels differing from tier 0 -- seeded ${seeded}, bought live ${bought}; seeded vs bought ${agree}`);
    if (seeded < 200) failures.push(`yaw ${deg}: the seeded full kit differs from tier 0 in only ${seeded} pixels`);
    if (bought < 200) failures.push(`yaw ${deg}: the live-bought kit differs from tier 0 in only ${bought} pixels`);
    if (agree > 200) failures.push(`yaw ${deg}: seeded and live-bought full kit differ in ${agree} pixels`);
  }
  return failures;
}

const args = parseArgs(process.argv.slice(2));
const port = await claimPort(TAG, PORT_ENV, DEFAULT_PORT);
const cellDir = path.join(args.out, 'cells');
fs.mkdirSync(cellDir, { recursive: true });
const base = `http://localhost:${port}`;
const dev = await ensureDevServer(port, REPO_ROOT, TAG);
if (args.garage) {
  const garageFailures: string[] = [];
  try {
    garageFailures.push(...(await runGarage(args.out, args.gpu, base)));
  } finally {
    stopDevServer(dev, TAG);
  }
  if (garageFailures.length > 0) {
    console.error(`[${TAG}] GARAGE CHECK FAILED:\n  ${garageFailures.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`[${TAG}] garage check: PASS`);
  process.exit(0);
}
const results = new Map<string, Reading & { facingTurns: number; tile: [number, number] }>();
const failures: string[] = [];
let gpuName: string;
try {
  const browser = await chromium.launch({ headless: true, args: gpuLaunchArgs(args.gpu) });
  try {
    gpuName = await readUnmaskedRenderer(browser);
    console.log(`[${TAG}] GPU (${args.gpu}): ${gpuName}`);
    for (const state of STATES) {
      const t0 = Date.now();
      const res = await captureState(browser, base, state, cellDir);
      results.set(state.id, res);
      console.log(
        `[${TAG}] ${state.id}: tiers ${JSON.stringify(res.tiers)}, ${res.tris} tris (kit ${res.kitTris}) in ${res.meshes} meshes, ` +
          `${res.calls} draw calls, facing ${res.facingTurns.toFixed(4)} turns, tile ${res.tile.join(',')}, ${((Date.now() - t0) / 1000).toFixed(1)}s`
      );
    }
  } finally {
    await browser.close();
  }

  failures.push(...mergeFailures(results));

  const browser2 = await chromium.launch({ headless: true });
  try {
    const commit = shortCommit();
    for (const zoom of ZOOMS) {
      const zKey = zoom.toFixed(1);
      for (const [scale, suffix] of zKey === '1.0' ? ([[1, ''], [2, '_x2'], [4, '_x4']] as const) : ([[1, ''], [2, '_x2']] as const)) {
      await composeSheet(
        browser2,
        path.join(args.out, `zoom${zKey}${suffix}.png`),
        `inf_squad in game, zoom ${zKey}${scale > 1 ? `, ${scale}x nearest` : ''} -- tier 0, every tier of every track alone, and the full kit`,
        `pnpm inf-kit:capture at ${commit}; ${MAP_ID} sandbox without &amp;kit, account-seeded tiers through upgradePrepass; the shipped switch (INFANTRY_KIT_ENABLED) forced on in this browser only, nothing committed; ` +
          `rows: ${FACINGS.map((f) => f.label).join(' / ')}; tick ${CAPTURE_TICK}, frame loop frozen, zero-time repaint; ` +
          `fog, overlays and wind hidden; ${BOX[zKey].w}x${BOX[zKey].h} CSS px at DPR 1; GPU ${gpuName.replace(/[<>&]/g, '')}.`,
        STATES.map((s) => s.label),
        FACINGS.map((f) => ({ label: f.id, cells: STATES.map((s) => path.join(cellDir, `${s.id}_${f.id}_z${zKey}.png`)) })),
        scale
      );
      console.log(`[${TAG}] wrote ${path.join(args.out, `zoom${zKey}${suffix}.png`)}`);
      }
    }
  } finally {
    await browser2.close();
  }
  fs.writeFileSync(
    path.join(args.out, 'readings.json'),
    `${JSON.stringify({ gpu: gpuName, commit: shortCommit(), switchForcedOnInThisBrowserOnly: true, states: Object.fromEntries(results) }, null, 2)}\n`
  );
} finally {
  stopDevServer(dev, TAG);
}
if (failures.length > 0) {
  console.error(`[${TAG}] MERGE CHECK FAILED:\n  ${failures.join('\n  ')}`);
  process.exitCode = 1;
} else {
  console.log(`[${TAG}] merge check: PASS (${STATES.length} states, +0 meshes and +0 draw calls against tier 0)`);
}
