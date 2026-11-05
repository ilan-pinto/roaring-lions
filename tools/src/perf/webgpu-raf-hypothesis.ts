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
  frames: number;
  renderCalls: number;
  cpuRenderMedMs: number;
  cpuFrameMedMs: number;
  drawCalls: number;
  errors: string[];
}

async function read(mode: 'native' | 'stub' | 'flag'): Promise<Reading> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  await page.addInitScript(musicOffInitScript({}, { quality: 'high' }));
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 160));
  });
  await page.goto(`http://localhost:${port}/?sandbox=${MAP}&envlight=0&grade=0&tod=day&gpu=${GPU}`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window as unknown as { __lions?: { renderer?: unknown } }).__lions?.renderer, null, { timeout: 120000 });
  await page.waitForTimeout(3000);
  const out = await page.evaluate(
    async ({ mode, frames }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const L = (window as any).__lions;
      const r = L.renderer;
      if (mode === 'stub') window.requestAnimationFrame = () => 0;
      if (mode === 'flag') L.freezeLoop(true);
      // Let a stubbed/frozen loop die out: two real-time ticks.
      await new Promise((res) => setTimeout(res, 300));
      const nb = r.nodeBackend;
      let calls = 0;
      let renderMs = 0;
      const orig = nb.render;
      nb.render = (...a: unknown[]) => {
        const t = performance.now();
        orig.apply(nb, a);
        renderMs += performance.now() - t;
        calls++;
      };
      const cpuRender: number[] = [];
      const cpuFrame: number[] = [];
      for (let i = 0; i < frames; i++) {
        const before = renderMs;
        const t0 = performance.now();
        r.frame(1, 0);
        cpuFrame.push(performance.now() - t0);
        cpuRender.push(renderMs - before);
        await r.whenGpuIdle();
      }
      nb.render = orig;
      const med = (v: number[]): number => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] as number;
      return {
        backend: r.backendInfo().kind as string,
        rafNative: /\[native code\]/.test(String(window.requestAnimationFrame)),
        renderCalls: calls,
        cpuRenderMedMs: med(cpuRender),
        cpuFrameMedMs: med(cpuFrame),
        drawCalls: nb.stats().calls as number,
      };
    },
    { mode, frames: FRAMES }
  );
  await page.close();
  return { mode, frames: FRAMES, errors: errors.slice(0, 5), ...out };
}

const load = os.loadavg()[0] as number;
const rows: Reading[] = [];
for (const m of ['native', 'stub', 'flag'] as const) rows.push(await read(m));
await browser.close();
stop();
console.log(`conditions: map=${MAP} gpu=${GPU} 1280x720 DPR 2, ${FRAMES} pumped frames, ANGLE/Metal, loadavg at start ${load.toFixed(2)}`);
for (const r of rows) {
  console.log(
    `  ${r.mode.padEnd(6)} backend=${r.backend} rafNative=${r.rafNative} render() calls=${r.renderCalls}/${r.frames} cpuRender med=${r.cpuRenderMedMs.toFixed(3)} ms cpuFrame med=${r.cpuFrameMedMs.toFixed(2)} ms drawCalls=${r.drawCalls}${r.errors.length ? ` errors=${JSON.stringify(r.errors)}` : ''}`
  );
}
const [native, stub, flag] = rows as [Reading, Reading, Reading];
const stubZero = stub.cpuRenderMedMs < 0.001 || stub.renderCalls === 0;
const flagLive = flag.cpuRenderMedMs > 0.001 && flag.renderCalls > 0 && native.cpuRenderMedMs > 0.001;
console.log(
  `hypothesis: stub reproduces CPU render 0: ${stubZero ? 'YES' : 'NO'}; the flag does not (reads like native): ${flagLive ? 'YES' : 'NO'} -> ${stubZero && flagLive ? 'CONFIRMED' : 'NOT CONFIRMED as stated'}`
);
process.exit(0);
