/**
 * Wadi Halam look, layer 1: the backdrop's frame cost. PROTOTYPE tool, adapted from `perf/fx-cost.ts`.
 *
 *   npx tsx src/wadi-look/cost.ts --port=5188 [--maps=wadi_halam_4,wadi_halam_basin] [--presets=high,medium,low]
 *
 * One page per (map, preset), HARDWARE Metal (refuses SwiftShader), 1440x900 at DPR 2 like fx-cost. Each frame is
 * timed `renderer.frame(1, 0)` synced by a 1x1 `readPixels` (gl.finish() does not wait on ANGLE/Metal). A and B are
 * INTERLEAVED inside the one page with the `backdrop` debug layer, in blocks of 20 frames x 12 rounds, so thermal and
 * clock drift hit both alike: A = layer off (today's skirt and never-seen off-map fog), B = layer on.
 * Draw calls and triangles come from `renderer.info` with autoReset off, one frame each.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { devServerStopper, ensureDevServer } from '../golden-diff/browser';
import { musicOffInitScript } from '../ui-review/music-off';
import { claimPort } from '../ui-review/port';

const args = process.argv.slice(2);
const arg = (n: string, d: string): string => (args.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).slice(n.length + 3);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const port = await claimPort('wadi-cost', 'WADI_COST_PORT', 5188);
const MAPS = arg('maps', 'wadi_halam_4,wadi_halam_basin').split(',');
const PRESETS = arg('presets', 'high,medium,low')
  .split(',')
  .filter((q): q is 'high' | 'medium' | 'low' => q === 'high' || q === 'medium' || q === 'low');
const VIEWS: [string, number, number, number][] = [
  ['centre z0.35', 24, 24, 0.35],
  ['west rim z1', 2, 24, 1],
  ['west rim z2.5', 1.5, 24, 2.5],
];
const BUDGET_MS = 16.7;

const stop = devServerStopper(await ensureDevServer(port, root, 'wadi-cost'), 'wadi-cost');
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--use-gl=angle', '--enable-gpu-rasterization', '--disable-gpu-sandbox'],
});

interface Side {
  med: number;
  p95: number;
  mean: number;
  calls: number;
  tris: number;
}

try {
  for (const map of MAPS) {
    for (const quality of PRESETS) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
      await page.addInitScript(musicOffInitScript({}, { quality }));
      await page.addInitScript('window.__name = (f) => f;');
      await page.goto(`http://localhost:${port}/?sandbox=${map}`, { waitUntil: 'load' });
      await page.waitForFunction(() => !!(window as unknown as { __lions?: { renderer?: unknown } }).__lions?.renderer, null, { timeout: 120000 });
      await page.waitForTimeout(5000);
      const gpu = await page.evaluate(() => {
        const c = document.createElement('canvas');
        const gl = c.getContext('webgl2');
        const ext = gl?.getExtension('WEBGL_debug_renderer_info');
        return ext && gl ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
      });
      if (/swiftshader|llvmpipe|software/i.test(gpu) || gpu === 'unknown') {
        console.error(`wadi-cost: refusing to time on "${gpu}" (need hardware Metal)`);
        await browser.close();
        stop();
        process.exit(2);
      }
      const res = await page.evaluate(
        ([views]) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const L = (window as any).__lions;
          const r = L.renderer;
          window.requestAnimationFrame = () => 0; // freeze the app's loop; we pump frames
          const canvas: HTMLCanvasElement = r.canvas;
          const gl = canvas.getContext('webgl2') as WebGL2RenderingContext;
          const info = r.renderer.info;
          const px = new Uint8Array(4);
          const sync = (): void => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          const stats = r.backdropStats;
          const out: Record<string, { off: Side; on: Side }> = {};
          for (const [name, x, y, z] of views as [string, number, number, number][]) {
            r.camera.x = x;
            r.camera.y = y;
            r.camera.zoom = z;
            const w: Record<string, number[]> = { off: [], on: [] };
            const geo: Record<string, { calls: number; tris: number }> = {};
            for (const state of ['off', 'on']) {
              r.setDebugLayerVisible('backdrop', state === 'on');
              for (let i = 0; i < 25; i++) r.frame(1, 16);
              info.autoReset = false;
              info.reset();
              r.frame(1, 16);
              geo[state] = { calls: info.render.calls, tris: info.render.triangles };
              info.autoReset = true;
              sync();
            }
            for (let round = 0; round < 12; round++) {
              for (const state of round % 2 === 0 ? ['off', 'on'] : ['on', 'off']) {
                r.setDebugLayerVisible('backdrop', state === 'on');
                for (let i = 0; i < 3; i++) r.frame(1, 0); // settle the switch
                sync();
                for (let i = 0; i < 20; i++) {
                  const t0 = performance.now();
                  r.frame(1, 0);
                  sync();
                  w[state].push(performance.now() - t0);
                }
              }
            }
            const sum = (state: string): Side => {
              const a = w[state].slice().sort((p, q) => p - q);
              return { med: a[Math.floor(a.length / 2)], p95: a[Math.floor(a.length * 0.95)], mean: a.reduce((p, q) => p + q, 0) / a.length, calls: geo[state].calls, tris: geo[state].tris };
            };
            out[name] = { off: sum('off'), on: sum('on') };
          }
          r.setDebugLayerVisible('backdrop', true);
          return { out, stats };
        },
        [VIEWS] as const
      );
      console.log(`map=${map} quality=${quality} gpu=${gpu} backdrop=${JSON.stringify(res.stats)}`);
      for (const [k, v] of Object.entries(res.out as Record<string, { off: Side; on: Side }>)) {
        const d = v.on.med - v.off.med;
        console.log(
          `  ${k.padEnd(14)} off med ${v.off.med.toFixed(2)} p95 ${v.off.p95.toFixed(2)} calls ${v.off.calls} tris ${v.off.tris} | on med ${v.on.med.toFixed(2)} p95 ${v.on.p95.toFixed(2)} calls ${v.on.calls} tris ${v.on.tris} | d med ${d >= 0 ? '+' : ''}${d.toFixed(2)} ms ${v.on.p95 <= BUDGET_MS ? 'holds60' : 'LOSES60'}`
        );
      }
      await page.close();
    }
  }
} finally {
  await browser.close();
  stop();
}
