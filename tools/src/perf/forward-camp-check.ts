/**
 * The forward camp in a real browser (GH-277 follow-on): `&works` sandbox, one Metal browser, music off, its own dev
 * server on its own port (default 5195; the lead's 5177 is refused), the server stopped by process group on the way out.
 *
 *   pnpm exec tsx src/perf/forward-camp-check.ts [--port=5195] [--out=<dir>] [--map=beit_sahwan_outskirts]
 *
 * It drives the UI the way a player does: click the Forward Camp tile in the "Field works" group, hover the ground (the
 * pad and the dashed rings are the preview), click to place; the engineer builds it (the only shortcut is
 * `__lions.step(n)`, which fast-forwards the sim through the frame path so 40 s of building does not take 40 s); the dock
 * then grows a "Forward 1" row; click a unit tile and a squad stands at the camp; click the camp and its rings show.
 * Every step prints PASS or FAIL with what it read, and a screenshot of the state; the exit code is 1 on any FAIL or any
 * console error. Conditions (GPU backend as the page reports it, viewport) are printed first.
 */
import { chromium, type Page } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { devServerStopper, ensureDevServer } from '../golden-diff/browser';
import { CAPTURE_VIEWPORT } from '../golden-diff/capture-protocol';
import { gpuLaunchArgs } from '../ui-review/gpu';
import { musicOffInitScript } from '../ui-review/music-off';
import { claimPortOrAttach } from '../ui-review/port';
import { FORWARD_CAMP_PORT, forwardCampPortRefusal } from './forward-camp-port';

const TAG = 'forward-camp';
const arg = (k: string, d: string): string => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
// The RESOLVED port (flag, then FORWARD_CAMP_PORT, then the default), not just `--port=`: 5177 is the lead's.
const refusal = forwardCampPortRefusal(process.argv.slice(2), process.env);
if (refusal !== null) {
  console.error(refusal);
  process.exit(2);
}
const { port: PORT } = await claimPortOrAttach(TAG, 'FORWARD_CAMP_PORT', FORWARD_CAMP_PORT);
const OUT = resolve(arg('out', 'forward-camp-out'));
const MAP = arg('map', 'beit_sahwan_outskirts');
const ROOT = resolve(import.meta.dirname, '../../..');
mkdirSync(OUT, { recursive: true });

let failed = 0;
const check = (ok: boolean, what: string, read: unknown): void => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}  [${JSON.stringify(read)}]`);
};
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The page's own view of the world, as one evaluate (strings: the page has no TS). */
const FIND_PAD = `(() => {
  const L = window.__lions, s = L.sim;
  const ti = s.structureTypes.findIndex((t) => t.id === 'kdf_forward_camp');
  const b = L.units().find((u) => u.type === 'demo_squad');
  if (ti < 0 || !b) return { error: 'no type ' + ti + ' or no demo_squad ' + JSON.stringify(b) };
  let best = null;
  for (let ty = b.y - 8; ty <= b.y + 8; ty++) for (let tx = b.x - 8; tx <= b.x + 8; tx++) {
    if (tx < 2 || ty < 2 || tx > s.width - 4 || ty > s.height - 4) continue;
    if (s.placementReason(ti, tx, ty, 0) !== null) continue;
    const d = Math.hypot(tx + 1 - b.x, ty + 1 - b.y);
    if (d < 3) continue;
    if (best === null || d < best.d) best = { tx, ty, d };
  }
  return { ti, builder: b, pad: best };
})()`;

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(OUT, name) });
}

/** A canvas-relative projection of a world point, as the page's mouse coordinates. */
async function screenOf(page: Page, wx: number, wy: number): Promise<{ x: number; y: number }> {
  return (await page.evaluate(
    ([x, y]) => {
      const r = (window as unknown as { __lions: { renderer: { canvas: HTMLCanvasElement; worldToScreen(x: number, y: number): { x: number; y: number } } } }).__lions.renderer;
      const p = r.worldToScreen(x, y);
      const box = r.canvas.getBoundingClientRect();
      return { x: box.left + p.x, y: box.top + p.y };
    },
    [wx, wy] as const
  )) as { x: number; y: number };
}

async function main(): Promise<void> {
  const server = await ensureDevServer(PORT, ROOT, TAG);
  const stop = devServerStopper(server, TAG);
  const browser = await chromium.launch({ headless: true, args: gpuLaunchArgs('metal') });
  const errors: string[] = [];
  try {
    const page = await browser.newPage({ viewport: { ...CAPTURE_VIEWPORT }, deviceScaleFactor: 1 });
    await page.addInitScript(musicOffInitScript());
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console: ${m.text()}`);
    });
    // A cold dev server compiles the whole app on the first load, and this machine is shared: the waits are generous, and a
    // timeout says what the page printed instead of only that it timed out.
    await page.goto(`http://localhost:${PORT}/?sandbox=${MAP}&works`, { waitUntil: 'load', timeout: 600_000 });
    await page.mouse.move(2, 2);
    try {
      await page.waitForFunction(() => typeof (window as unknown as { __lions?: unknown }).__lions !== 'undefined', null, { timeout: 600_000 });
    } catch (e) {
      console.log(`FAIL  the page never defined __lions; url ${page.url()}; errors so far ${JSON.stringify(errors.slice(0, 6))}`);
      await shot(page, '00-boot-timeout.png');
      throw e;
    }
    await sleep(5000); // meshes and the first frames
    const gl = await page.evaluate(() => {
      const c = document.createElement('canvas').getContext('webgl2');
      const e = c?.getExtension('WEBGL_debug_renderer_info');
      return e && c ? String(c.getParameter(e.UNMASKED_RENDERER_WEBGL)) : 'unknown';
    });
    console.log(`conditions: ${MAP}, gl=${gl}, viewport ${CAPTURE_VIEWPORT.width}x${CAPTURE_VIEWPORT.height}, dpr 1, port ${PORT}, music off`);

    const found = (await page.evaluate(FIND_PAD)) as { error?: string; ti: number; builder: { id: number; x: number; y: number }; pad: { tx: number; ty: number } | null };
    check(found.error === undefined && found.pad !== null, 'the sandbox has the Forward Camp type, a demolition squad and a valid pad near it', found);
    if (found.error !== undefined || found.pad === null) return;
    const { tx, ty } = found.pad;
    const centre = { x: tx + 1, y: ty + 1 };

    // ---- the tile, the preview -------------------------------------------------------------------------
    await page.evaluate(([x, y]) => (window as unknown as { __lions: { goto(x: number, y: number): void } }).__lions.goto(x, y), [centre.x, centre.y] as const);
    await sleep(800);
    const tile = page.locator(".rl-tile--works[data-works='kdf_forward_camp']");
    check((await tile.count()) === 1, 'the Field works group has a Forward Camp tile', await tile.count());
    check(((await tile.getAttribute('data-state')) ?? '') === 'ready', 'the tile is ready (600+ logistics, an idle carrier)', await tile.getAttribute('data-state'));
    await tile.click();
    await sleep(300);
    check((await tile.getAttribute('data-armed')) === '1', 'clicking the tile arms it', await tile.getAttribute('data-armed'));
    const at = await screenOf(page, centre.x, centre.y);
    await page.mouse.move(at.x - 20, at.y - 20);
    await page.mouse.move(at.x, at.y, { steps: 6 });
    await sleep(900);
    const preview = (await page.evaluate(() => {
      const r = (window as unknown as { __lions: { renderer: { placementPreview: { w: number; h: number; valid: boolean } | null; auraRingPreview: { radius: number; style: string }[] } } }).__lions.renderer;
      return { pad: r.placementPreview, rings: r.auraRingPreview.map((x) => `${x.radius}:${x.style}`) };
    })) as { pad: { w: number; h: number; valid: boolean } | null; rings: string[] };
    check(preview.pad !== null && preview.pad.valid && preview.pad.w === 2 && preview.pad.h === 2, 'hovering the ground shows a valid 2x2 footprint', preview.pad);
    check(preview.rings.includes('4:dashed') && preview.rings.includes('6:dashed'), 'placing draws the aura ring (4) and the dashed contest ring (6)', preview.rings);
    await shot(page, '01-placing.png');

    // ---- placing, building ------------------------------------------------------------------------------
    await page.mouse.click(at.x, at.y);
    await sleep(500);
    check((await tile.getAttribute('data-armed')) === '0', 'the click places it and disarms the tile', await tile.getAttribute('data-armed'));
    let site = (await page.evaluate(`(() => { const w = window.__lions.sim.works; for (let i = 0; i < w.alive.length; i++) if (w.alive[i] === 1) return { site: i, structure: w.structure[i] }; return null; })()`)) as { site: number; structure: number } | null;
    for (let i = 0; i < 20 && site === null; i++) {
      await page.evaluate(() => (window as unknown as { __lions: { step(n: number): void } }).__lions.step(5));
      site = (await page.evaluate(`(() => { const w = window.__lions.sim.works; for (let i = 0; i < w.alive.length; i++) if (w.alive[i] === 1) return { site: i, structure: w.structure[i] }; return null; })()`)) as { site: number; structure: number } | null;
    }
    check(site !== null, 'a construction site stands after the click', site);
    // Fast-forward through the frame path until the work reports complete (800 ticks of building plus the walk).
    let progress = 0;
    let structure = -1;
    let ticks = 0;
    for (let i = 0; i < 60 && progress < 65536; i++) {
      const r = (await page.evaluate(`(() => {
        const L = window.__lions, s = L.sim;
        L.step(60);
        const ti = s.structureTypes.findIndex((t) => t.id === 'kdf_forward_camp');
        for (let k = s.structureCount - 1; k >= 0; k--) if (s.structures.typeIdx[k] === ti && s.structures.alive[k] === 1) return { structure: k, progress: s.structures.progress[k], tick: s.tickCount };
        return { structure: -1, progress: 0, tick: s.tickCount };
      })()`)) as { structure: number; progress: number; tick: number };
      progress = r.progress;
      structure = r.structure;
      ticks = r.tick;
      if (i === 3) await shot(page, '02-under-construction.png');
    }
    check(progress === 65536, 'the engineer completes the work', { structure, progress, tick: ticks });

    // ---- the row ----------------------------------------------------------------------------------------
    await sleep(600);
    const rows = (await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.rl-line')].filter((r) => !r.hidden).map((r) => r.querySelector('.rl-line__camp')?.textContent ?? ''))) as string[];
    check(rows.length === 1 && rows[0] === 'Forward 1', 'the dock grows one row, "Forward 1" (the sandbox has no authored camp)', rows);
    await shot(page, '03-dock-row.png');

    // ---- a unit from its line ---------------------------------------------------------------------------
    const squads = (): Promise<number> => page.evaluate(() => (window as unknown as { __lions: { units(): { type: string }[] } }).__lions.units().filter((u) => u.type === 'inf_squad').length);
    const before = await squads();
    const squadTile = page.locator(".rl-tile[data-unit='inf_squad']");
    check((await squadTile.count()) === 1 && (await squadTile.getAttribute('data-locked')) === '0', 'the Rifle Squad tile is open now the line stands', await squadTile.getAttribute('data-locked'));
    await squadTile.click();
    await sleep(500);
    const building = (await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.rl-line')].filter((r) => !r.hidden).map((r) => r.dataset.state))) as (string | undefined)[];
    check(building[0] === 'building', 'the Forward 1 row shows the squad building', building);
    await shot(page, '04-building.png');
    let after = before;
    for (let i = 0; i < 60 && after === before; i++) {
      await page.evaluate(() => (window as unknown as { __lions: { step(n: number): void } }).__lions.step(30));
      after = await squads();
    }
    check(after === before + 1, 'a Rifle Squad stands after the build time (292 logistics, the line\'s time)', { before, after });
    const where = (await page.evaluate(
      ([s]) => {
        const L = (window as unknown as { __lions: { sim: { structures: { minX: Int32Array; maxX: Int32Array; minY: Int32Array; maxY: Int32Array } }; units(): { id: number; type: string; x: number; y: number }[] } }).__lions;
        const st = L.sim.structures;
        const cx = (st.minX[s] + st.maxX[s] + 1) / 2;
        const cy = (st.minY[s] + st.maxY[s] + 1) / 2;
        const squads = L.units().filter((u) => u.type === 'inf_squad');
        const nearest = Math.min(...squads.map((u) => Math.hypot(u.x + 0.5 - cx, u.y + 0.5 - cy)));
        return { cx, cy, nearest };
      },
      [structure] as const
    )) as { cx: number; cy: number; nearest: number };
    check(where.nearest <= 4, 'a squad is within 4 tiles of the forward camp (it deployed at its exit)', where);
    await shot(page, '05-unit-built.png');

    // ---- selected: the rings ----------------------------------------------------------------------------
    await page.evaluate(([x, y]) => (window as unknown as { __lions: { goto(x: number, y: number): void } }).__lions.goto(x, y), [where.cx, where.cy] as const);
    await sleep(600);
    const campAt = await screenOf(page, where.cx, where.cy);
    await page.mouse.click(campAt.x, campAt.y);
    await sleep(700);
    const rings = (await page.evaluate(() => (window as unknown as { __lions: { renderer: { auraRingPreview: { radius: number; style: string }[] } } }).__lions.renderer.auraRingPreview.map((x) => `${x.radius}:${x.style}`))) as string[];
    check(rings.includes('4:dashed') && rings.includes('6:dashed'), 'selecting the camp draws the aura ring (4) and the contest ring (6)', rings);
    await shot(page, '06-selected.png');

    check(errors.length === 0, 'no console error and no page error', errors.slice(0, 5));
  } finally {
    await browser.close();
    stop();
  }
}

main().then(
  () => {
    console.log(failed === 0 ? 'forward-camp check: all steps passed' : `forward-camp check: ${failed} step(s) FAILED`);
    process.exit(failed === 0 ? 0 : 1);
  },
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
