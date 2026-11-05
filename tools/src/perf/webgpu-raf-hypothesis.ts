/**
 * The P0 rAF hypothesis (GH-943 WebGPU-primary, design sections 4 and 8): "a stubbed global rAF reproduces the L5 trial's invalid
 * `CPU render 0` rows on the node backend, and the app-level freeze flag does not."
 *
 *   pnpm --filter @lions/tools webgpu:raf -- --port=5190 [--map=wadi_halam_4] [--frames=60]
 *
 * Three FRESH pages, each the real sandbox booted through its real URL (`?sandbox=<map>&gpu=webgpu`), each timed the same way:
 *   native   native rAF, the app's own loop live            (the control: what a player has)
 *   stub     `window.requestAnimationFrame = () => 0`        (the L5 trial's method; `FREEZE_FRAME_LOOP_STATEMENTS`)
 *   flag     `__lions.freezeLoop(true)`, rAF left NATIVE     (P0's replacement)
 * `cpuRender` is the time inside the node backend's `render()` (wrapped), over frames the harness pumps by `renderer.frame(1, 0)`.
 * The hypothesis is CONFIRMED only if stub reads 0 (or ~0) and flag reads > 0 like native; any other pattern is reported as it is.
 * ONE Metal browser, on the port given, music off.
 */
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { devServerStopper, ensureDevServer } from '../golden-diff/browser';
import { musicOffInitScript } from '../ui-review/music-off';
import { claimPort } from '../ui-review/port';

const args = process.argv.slice(2);
const arg = (n: string, d: string): string => (args.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).slice(n.length + 3);
const root = path.resolve(arg('root', process.cwd().replace(/\/tools$/, '')));
const port = await claimPort('webgpu-raf', 'WEBGPU_RAF_PORT', 5190);
const MAP = arg('map', 'wadi_halam_4');
const FRAMES = Number(arg('frames', '60'));
const GPU = arg('gpu', 'webgpu');

const stop = devServerStopper(await ensureDevServer(port, root, 'webgpu-raf'), 'webgpu-raf');
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--use-gl=angle', '--enable-gpu-rasterization', '--disable-gpu-sandbox', '--enable-unsafe-webgpu'],
});

interface Reading {
  mode: string;
  backend: string;
  rafNative: boolean;
  /** Per zoom: the pumped frame's synced time (ms), the renderer's draw-call and triangle counters, and a hash of the photographed canvas. */
  z: Record<string, { syncedMs: number; calls: number; triangles: number; picture: string }>;
  cpuRenderMedMs: number;
  errors: string[];
}

/** The hypothesis' observable: a frame the harness PUMPS must show the view it was pumped at. The `cpuRender` timer alone is not
 *  enough (it reads ~0.1 ms on every mode: WebGPURenderer encodes cheaply), so the verdict is on the PICTURE and the counters. */
async function read(mode: 'native' | 'stub' | 'flag'): Promise<Reading> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  await page.addInitScript(musicOffInitScript({}, { quality: 'high' }));
  await page.addInitScript('window.__name = (f) => f;');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 160));
  });
  await page.goto(`http://localhost:${port}/?sandbox=${MAP}&envlight=0&grade=0&tod=day&gpu=${GPU}`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window as unknown as { __lions?: { renderer?: unknown } }).__lions?.renderer, null, { timeout: 120000 });
  await page.waitForTimeout(3000);
  // The stub / the flag go up here, then the loop is given 500 ms to die out.
  await page.evaluate((mode) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const L = (window as any).__lions;
    if (mode === 'stub') window.requestAnimationFrame = () => 0;
    if (mode === 'flag') L.freezeLoop(true);
  }, mode);
  await page.waitForTimeout(500);
  const z: Reading['z'] = {};
  let cpuRender = 0;
  for (const zoom of [1, 2.5]) {
    const r = await page.evaluate(
      async ({ zoom, frames }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const R = (window as any).__lions.renderer;
        R.camera.zoom = zoom;
        const nb = R.nodeBackend;
        let renderMs = 0;
        const orig = nb.render;
        nb.render = (...a: unknown[]) => {
          const t = performance.now();
          orig.apply(nb, a);
          renderMs += performance.now() - t;
        };
        const synced: number[] = [];
        for (let i = 0; i < frames; i++) {
          const t0 = performance.now();
          R.frame(1, 0);
          await R.whenGpuIdle();
          synced.push(performance.now() - t0);
        }
        nb.render = orig;
        const med = [...synced].sort((a, b) => a - b)[Math.floor(synced.length / 2)] as number;
        const st = nb.stats();
        return { syncedMs: med, calls: st.calls as number, triangles: st.triangles as number, renderMs: renderMs / frames, native: /\[native code\]/.test(String(window.requestAnimationFrame)), backend: R.backendInfo().kind as string };
      },
      { zoom, frames: FRAMES }
    );
    const shot = await page.screenshot();
    z[`z${zoom}`] = { syncedMs: r.syncedMs, calls: r.calls, triangles: r.triangles, picture: createHash('sha256').update(shot).digest('hex').slice(0, 12) };
    cpuRender = r.renderMs;
    if (zoom === 2.5) {
      await page.close();
      return { mode, backend: r.backend, rafNative: r.native, z, cpuRenderMedMs: cpuRender, errors: errors.slice(0, 3) };
    }
  }
  await page.close();
  throw new Error('unreachable');
}

const load = os.loadavg()[0] as number;
const rows: Reading[] = [];
for (const m of ['native', 'stub', 'flag'] as const) rows.push(await read(m));
await browser.close();
stop();
console.log(`conditions: map=${MAP} gpu=${GPU} 1280x720 DPR 2, ${FRAMES} pumped frames per zoom, ANGLE/Metal, loadavg at start ${load.toFixed(2)}`);
for (const r of rows) {
  console.log(
    `  ${r.mode.padEnd(6)} backend=${r.backend} rafNative=${r.rafNative} z1: ${r.z.z1?.syncedMs.toFixed(2)} ms calls ${r.z.z1?.calls} tris ${r.z.z1?.triangles} pic ${r.z.z1?.picture} | z2.5: ${r.z['z2.5']?.syncedMs.toFixed(2)} ms calls ${r.z['z2.5']?.calls} tris ${r.z['z2.5']?.triangles} pic ${r.z['z2.5']?.picture} | render() ${r.cpuRenderMedMs.toFixed(3)} ms${r.errors.length ? ` errors=${JSON.stringify(r.errors)}` : ''}`
  );
}
const [native, stub, flag] = rows as [Reading, Reading, Reading];
// A pumped frame "draws" when the picture and the counters follow the zoom it was pumped at.
const follows = (r: Reading): boolean => r.z.z1?.picture !== r.z['z2.5']?.picture && r.z.z1?.triangles !== r.z['z2.5']?.triangles;
console.log(
  `hypothesis: under the stubbed rAF a pumped frame does NOT follow the zoom (CPU-render-0 class): ${follows(stub) ? 'NO (it follows)' : 'YES'}; ` +
    `under the app flag it does: ${follows(flag) ? 'YES' : 'NO'}; native control follows: ${follows(native) ? 'YES' : 'NO'} -> ${!follows(stub) && follows(flag) ? 'CONFIRMED' : 'NOT CONFIRMED as stated'}`
);
process.exit(0);
