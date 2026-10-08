/**
 * `pnpm tunnel:capture -- --out=<dir> [--port=5194] [--only=<run id prefix>]`
 *
 * GH-471's instrument: the x-ray reveal of an identified tunnel, photographed
 * from the running game. One Metal browser, music off, its own dev server on
 * its own port (refuses 5177, the lead's), every process it starts stopped by
 * process group on the way out.
 *
 * The drone is ordered with a REAL right-click on the canvas (selection is set
 * through `__lions.sel`, then cleared before every frame). Frames are stepped
 * on the sim clock with the rAF loop frozen, so the discovery strip is a
 * deterministic series of real renderer frames 250 ms apart.
 */
import { chromium, type Page } from 'playwright';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gpuLaunchArgs } from '../ui-review/gpu';
import { musicOffInitScript } from '../ui-review/music-off';
import { portBusy } from '../ui-review/port';

const arg = (k: string, d: string): string => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const PORT = Number(arg('port', '5194'));
if (PORT === 5177) {
  console.error('[tunnel-xray] refusing port 5177: it is the lead\'s dev server');
  process.exit(2);
}

const OUT = resolve(arg('out', 'tunnel-xray-out'));
const ONLY = arg('only', '');
const ROOT = resolve(import.meta.dirname, '../../..');
mkdirSync(OUT, { recursive: true });
const log: string[] = [];
const say = (s: string): void => {
  console.log(s);
  log.push(s);
};

async function waitHttp(url: string, ms: number): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`dev server never answered at ${url}`);
}

async function boot(page: Page, query: string): Promise<void> {
  await page.goto(`http://localhost:${PORT}/${query}`, { waitUntil: 'load', timeout: 120_000 });
  // Deploy gate: click until the loading screen is gone (capture-guard's rule).
  const t0 = Date.now();
  while (Date.now() - t0 < 120_000) {
    const state = await page.evaluate(() => ({
      lions: typeof (window as unknown as { __lions?: unknown }).__lions !== 'undefined',
      loading: document.querySelector('.rl-loading') !== null,
    }));
    if (state.lions && !state.loading) break;
    const btn = await page.$('.rl-loading__deploy');
    if (btn) await btn.click({ timeout: 1000 }).catch(() => undefined);
    await page.waitForTimeout(250);
  }
  await page.waitForFunction(() => typeof (window as unknown as { __lions?: unknown }).__lions !== 'undefined', null, {
    timeout: 120_000,
  });
  await page.waitForTimeout(1500);
  await page.evaluate(`(async () => {
    if (!window.__lionsCaptureFrozen) {
      const _raf = window.requestAnimationFrame.bind(window);
      window.__lionsCaptureFrozen = true;
      window.requestAnimationFrame = function () { return 0; };
      await new Promise(function (r) { _raf(function () { _raf(function () { r(null); }); }); });
    }
  })()`);
}

type L = {
  __lions: {
    sim: {
      tickCount: number;
      tunnelCount: number;
      tunnelContactLevel(s: number, r: number): number;
      state: { tunnelIn: Int32Array; alive: Uint8Array };
      entityCount: number;
    };
    renderer: {
      camera: { x: number; y: number; zoom: number };
      worldToScreen(x: number, y: number): { x: number; y: number };
      frame(a: number, dt: number): void;
    };
    step(n: number): number;
    sel(ids: number[]): number[];
    units(side?: number): { id: number; type: string; x: number; y: number }[];
  };
};

async function stepTo(page: Page, tick: number): Promise<number> {
  return page.evaluate((t) => {
    const w = window as unknown as L;
    const n = t - w.__lions.sim.tickCount;
    return n > 0 ? w.__lions.step(n) : w.__lions.sim.tickCount;
  }, tick);
}

async function camera(page: Page, x: number, y: number, zoom: number): Promise<void> {
  await page.evaluate(
    ([cx, cy, z]) => {
      const w = window as unknown as L;
      w.__lions.renderer.camera.x = cx;
      w.__lions.renderer.camera.y = cy;
      w.__lions.renderer.camera.zoom = z;
      w.__lions.renderer.frame(1, 0);
    },
    [x, y, zoom] as const
  );
}

async function orderDrone(page: Page, tx: number, ty: number): Promise<void> {
  const drone = await page.evaluate(() => (window as unknown as L).__lions.units(0).find((u) => u.type === 'recon_drone'));
  if (!drone) throw new Error('no recon_drone on side 0');
  await page.evaluate((id) => (window as unknown as L).__lions.sel([id]), drone.id);
  const cam = await page.evaluate(() => {
    const c = (window as unknown as L).__lions.renderer.camera;
    return { x: c.x, y: c.y, zoom: c.zoom };
  });
  await camera(page, tx, ty, cam.zoom);
  const p = await page.evaluate(([x, y]) => (window as unknown as L).__lions.renderer.worldToScreen(x, y), [tx + 0.5, ty + 0.5] as const);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await page.mouse.move(2, 2);
  await page.evaluate(() => (window as unknown as L).__lions.sel([]));
  say(`ordered drone ${drone.id} from (${drone.x},${drone.y}) to (${tx},${ty}) via right-click at ${p.x.toFixed(0)},${p.y.toFixed(0)}`);
}

async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => (window as unknown as L).__lions.renderer.frame(1, 0));
  await page.screenshot({ path: join(OUT, `${name}.png`) });
}

async function stats(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const r = (window as unknown as L).__lions.renderer;
    r.frame(1, 0);
    const x = (r as unknown as { tunnelXray: { drawCalls: number; figures: { count: number } } }).tunnelXray;
    return { xrayDraws: x.drawCalls, figures: x.figures.count };
  });
}

interface Run {
  id: string;
  query: string;
  route: number;
  orderAt: number;
  /** Where the drone is sent and the camera looks; null = the route's midpoint. */
  target: [number, number] | null;
  view: [number, number] | null;
  close: [number, number] | null;
  strip: boolean;
}

const RUNS: Run[] = [
  { id: 'tm-xray', query: '?sandbox=tel_marum&tunnel', route: 0, orderAt: 40, target: null, view: null, close: null, strip: true },
  // bs_tn_north: (26,9) -> (28,12) -> (31,16) -> vent (33,19), two rpg_teams inside.
  { id: 'bs4-xray', query: '?mission=beit_sahwan_4_subterranean', route: 1, orderAt: 40, target: [29, 17], view: [29.5, 14.5], close: [29.5, 14.5], strip: true },
];

async function main(): Promise<void> {
  if (await portBusy(PORT)) {
    console.error(`[tunnel-xray] port ${PORT} is already taken -- refusing to photograph someone else's server`);
    process.exit(2);
  }
  say(`[tunnel-xray] starting vite on :${PORT} in ${ROOT}`);
  const server: ChildProcess = spawn('pnpm', ['--filter', '@lions/app', 'exec', 'vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout?.on('data', () => undefined);
  server.stderr?.on('data', () => undefined);
  say(`[tunnel-xray] server pgid ${server.pid}`);
  const browser = await chromium.launch({ headless: true, args: gpuLaunchArgs('metal') });
  try {
    await waitHttp(`http://localhost:${PORT}/`, 90_000);
    for (const run of RUNS) {
      if (ONLY && !run.id.startsWith(ONLY)) continue;
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
      await page.addInitScript(musicOffInitScript());
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      await boot(page, run.query);
      const gl = await page.evaluate(() => {
        const c = document.createElement('canvas').getContext('webgl2');
        const e = c?.getExtension('WEBGL_debug_renderer_info');
        return e && c ? String(c.getParameter(e.UNMASKED_RENDERER_WEBGL)) : 'unknown';
      });
      const zoom0 = await page.evaluate(() => (window as unknown as L).__lions.renderer.camera.zoom);
      say(`[${run.id}] gl=${gl} default zoom=${zoom0} tick=${await page.evaluate(() => (window as unknown as L).__lions.sim.tickCount)}`);
      await stepTo(page, run.orderAt);
      const mid = await page.evaluate((r) => {
        const s = (window as unknown as { __lions: { sim: { tnLength: Int32Array; tunnelPointAt(r: number, d: number): [number, number] } } }).__lions.sim;
        const p = s.tunnelPointAt(r, Math.floor(s.tnLength[r] / 2));
        return [Math.round(p[0] / 65536), Math.round(p[1] / 65536)] as [number, number];
      }, run.route);
      const target = run.target ?? mid;
      run.view = run.view ?? [mid[0] + 0.5, mid[1] + 0.5];
      run.close = run.close ?? run.view;
      say(`[${run.id}] route ${run.route} midpoint ${mid.join(',')}`);
      await orderDrone(page, target[0], target[1]);
      // Step until the route is identified.
      let t = run.orderAt;
      for (; t < run.orderAt + 1200; t++) {
        await stepTo(page, t + 1);
        const lv = await page.evaluate((r) => (window as unknown as L).__lions.sim.tunnelContactLevel(0, r), run.route);
        if (lv === 2) break;
      }
      const t0 = t + 1;
      say(`[${run.id}] route ${run.route} identified at tick ${t0}`);
      const occupants = await page.evaluate((r) => {
        const s = (window as unknown as L).__lions.sim;
        let n = 0;
        for (let i = 0; i < s.entityCount; i++) if (s.state.alive[i] === 1 && s.state.tunnelIn[i] === r) n++;
        return n;
      }, run.route);
      say(`[${run.id}] occupants in route ${run.route}: ${occupants}`);
      if (run.strip) {
        for (let k = 0; k <= 8; k++) {
          await stepTo(page, t0 + k * 5);
          const ms = k * 250;
          await camera(page, run.view![0], run.view![1], zoom0);
          await shot(page, `${run.id}-strip-${String(ms).padStart(4, '0')}ms-z${zoom0}`);
          await camera(page, run.close![0], run.close![1], 2.2);
          await shot(page, `${run.id}-strip-${String(ms).padStart(4, '0')}ms-z2.2`);
        }
      }
      await stepTo(page, t0 + 80);
      await camera(page, run.view![0], run.view![1], zoom0);
      await shot(page, `${run.id}-steady-z${zoom0}`);
      say(`[${run.id}] steady stats z${zoom0}: ${JSON.stringify(await stats(page))}`);
      await camera(page, run.close![0], run.close![1], 2.2);
      await shot(page, `${run.id}-steady-z2.2`);
      say(`[${run.id}] steady stats z2.2: ${JSON.stringify(await stats(page))}`);
      // Cost: interleaved on/off, 3 rounds x 60 repaints each, gl.finish() at
      // the end of every batch so GPU work is inside the wall clock; draw
      // calls counted with info.autoReset off over one repaint.
      const cost = await page.evaluate(`(() => {
        const r = window.__lions.renderer;
        const three = r.renderer;
        const group = r.tunnelXray.group;
        const gl = three.getContext();
        function batch(on) {
          group.visible = on;
          const t0 = performance.now();
          for (let i = 0; i < 60; i++) r.frame(1, 0);
          gl.finish();
          return (performance.now() - t0) / 60;
        }
        function calls(on) {
          group.visible = on;
          three.info.autoReset = false;
          three.info.reset();
          r.frame(1, 0);
          const out = { calls: three.info.render.calls, triangles: three.info.render.triangles };
          three.info.autoReset = true;
          return out;
        }
        batch(true); batch(false);
        const on = []; const off = [];
        for (let k = 0; k < 3; k++) { on.push(batch(true)); off.push(batch(false)); }
        const c = { on: calls(true), off: calls(false) };
        group.visible = true;
        r.frame(1, 0);
        return { msOn: on, msOff: off, calls: c };
      })()`);
      say(`[${run.id}] cost z2.2: ${JSON.stringify(cost)}`);
      if (errors.length) say(`[${run.id}] page errors: ${errors.slice(0, 5).join(' | ')}`);
      await page.close();
    }
  } finally {
    await browser.close();
    if (server.pid) {
      try {
        process.kill(-server.pid, 'SIGTERM');
      } catch {
        /* gone */
      }
    }
    writeFileSync(join(OUT, 'capture-log.txt'), log.join('\n') + '\n');
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
