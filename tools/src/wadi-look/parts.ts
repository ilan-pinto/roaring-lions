/**
 * Wadi Halam backdrop (GH-161): WHERE the frame cost goes. Interleaves five states inside one page (the
 * `backdrop` layer off = today's skirt; then the floor alone; floor + kit; floor + kit + olives; everything), at
 * the three cost views, each frame synced by a 1x1 readPixels, and prints medians, deltas against the skirt and
 * draw calls / triangles. Same conditions as `cost.ts` (Metal, 1440x900 at DPR 2, music off).
 *
 *   npx tsx src/wadi-look/parts.ts --port=5188 [--preset=high] [--zoom=0.35]
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
const port = await claimPort('wadi-parts', 'WADI_PARTS_PORT', 5188);
const quality = arg('preset', 'high') as 'high' | 'medium' | 'low';
const zoom = Number(arg('zoom', '0.35'));
const rounds = Number(arg('rounds', '16'));

const stop = devServerStopper(await ensureDevServer(port, root, 'wadi-parts'), 'wadi-parts');
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--use-gl=angle', '--enable-gpu-rasterization', '--disable-gpu-sandbox'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await page.addInitScript(musicOffInitScript({}, { quality }));
  await page.addInitScript('window.__name = (f) => f;');
  await page.goto(`http://localhost:${port}/?sandbox=wadi_halam_4`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window as unknown as { __lions?: { renderer?: unknown } }).__lions?.renderer, null, { timeout: 120000 });
  await page.waitForFunction(() => (window as unknown as { __lions: { renderer: { backdropStats: unknown } } }).__lions.renderer.backdropStats !== null, null, { timeout: 60000 });
  await page.waitForTimeout(5000);
  const res = await page.evaluate(
    ([z, nRounds]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = (window as any).__lions.renderer;
      window.requestAnimationFrame = () => 0;
      const canvas: HTMLCanvasElement = r.canvas;
      const gl = canvas.getContext('webgl2') as WebGL2RenderingContext;
      const info = r.renderer.info;
      const px = new Uint8Array(4);
      const sync = (): void => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      r.camera.x = 24;
      r.camera.y = 24;
      r.camera.zoom = z;
      const group = r.backdrop.group;
      r.backdrop.setZoom = (): void => {}; // the frame loop must not re-pick the kit mesh under us
      const byName = (n: string): { visible: boolean } => group.children.find((c: { name: string }) => c.name === n);
      const parts = ['backdrop-kit', 'backdrop-kit-lod1', 'backdrop-olives', 'backdrop-houses'];
      const show = (on: string[]): void => {
        r.setDebugLayerVisible('backdrop', true);
        for (const n of parts) byName(n).visible = on.includes(n);
        // the shipped min-zoom state thins the olives (Backdrop.setZoom is stubbed above): do the same when LOD1 is up
        const olives = byName('backdrop-olives') as unknown as { count: number };
        const total = r.backdropStats.olives;
        olives.count = on.includes('backdrop-kit-lod1') ? Math.ceil(total * 0.5) : total;
      };
      const states: Record<string, () => void> = {
        skirt: () => r.setDebugLayerVisible('backdrop', false),
        floor: () => show([]),
        'floor+lod1': () => show(['backdrop-kit-lod1']),
        'floor+lod1+olives': () => show(['backdrop-kit-lod1', 'backdrop-olives']),
        'floor+lod1+olives+houses': () => show(['backdrop-kit-lod1', 'backdrop-olives', 'backdrop-houses']),
        'floor+lod0 (ref)': () => show(['backdrop-kit']),
      };
      const names = Object.keys(states);
      const w: Record<string, number[]> = Object.fromEntries(names.map((n) => [n, []]));
      const geo: Record<string, { calls: number; tris: number }> = {};
      for (const n of names) {
        states[n]();
        for (let i = 0; i < 20; i++) r.frame(1, 16);
        info.autoReset = false;
        info.reset();
        r.frame(1, 16);
        geo[n] = { calls: info.render.calls, tris: info.render.triangles };
        info.autoReset = true;
        sync();
      }
      for (let round = 0; round < (nRounds as number); round++) {
        const order = round % 2 === 0 ? names : [...names].reverse();
        for (const n of order) {
          states[n]();
          for (let i = 0; i < 3; i++) r.frame(1, 0);
          sync();
          for (let i = 0; i < 20; i++) {
            const t0 = performance.now();
            r.frame(1, 0);
            sync();
            w[n].push(performance.now() - t0);
          }
        }
      }
      states['floor+lod1+olives+houses']();
      const med = (a: number[]): number => a.slice().sort((p, q) => p - q)[Math.floor(a.length / 2)];
      return Object.fromEntries(names.map((n) => [n, { med: med(w[n]), calls: geo[n].calls, tris: geo[n].tris }]));
    },
    [zoom, rounds] as const
  );
  const base = (res as Record<string, { med: number }>).skirt.med;
  for (const [k, v] of Object.entries(res as Record<string, { med: number; calls: number; tris: number }>)) {
    console.log(`${k.padEnd(18)} med ${v.med.toFixed(2)} ms  d ${(v.med - base >= 0 ? '+' : '')}${(v.med - base).toFixed(2)}  calls ${v.calls}  tris ${v.tris}`);
  }
} finally {
  await browser.close();
  stop();
}
