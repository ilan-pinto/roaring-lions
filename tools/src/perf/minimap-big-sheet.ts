// GH-920: the minimap of a free-play map with the task force spread out, one PNG per map.
// `tsx src/perf/minimap-big-sheet.ts --root=<tree> --port=5191 --map=wadi_tarfan_l,milh_flats_l,wadi_tarfan --out=<dir> [--dpr=2]`
// Report-only; hardware GPU (ANGLE/Metal), music off. Staging goes through queueCommand (a real move order per squad),
// the picture is the real minimap canvas element, and the jump is a real click on it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { devServerStopper, ensureDevServer } from '../golden-diff/browser';
import { musicOffInitScript } from '../ui-review/music-off';
import { claimPort } from '../ui-review/port';

const args = process.argv.slice(2);
const arg = (n: string, d: string): string => (args.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).slice(n.length + 3);
const root = path.resolve(arg('root', process.cwd()));
const port = await claimPort('minimap-big-sheet', 'MINIMAP_BIG_PORT', 5191);
const maps = arg('map', 'wadi_tarfan_l,milh_flats_l,wadi_tarfan').split(',');
const out = path.resolve(arg('out', '.'));
const DPR = Number(arg('dpr', '2'));
fs.mkdirSync(out, { recursive: true });
const stop = devServerStopper(await ensureDevServer(port, root, 'minimap-big-sheet'), 'minimap-big-sheet');
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--use-gl=angle', '--enable-gpu-rasterization', '--disable-gpu-sandbox'],
});
try {
  for (const map of maps) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: DPR });
    await page.addInitScript(musicOffInitScript({}, { quality: 'high' }));
    await page.goto(`http://localhost:${port}/free-play/${map}`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!(window as unknown as { __lions?: { renderer?: unknown } }).__lions?.renderer, null, { timeout: 120000 });
    await page.waitForTimeout(3000);
    const gpu = await page.evaluate(() => {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      return ext && gl ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
    });
    // Spread the force: squads of 4 sent to points on a grid around the group's centroid, then run until they stop.
    const info = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const L = (window as any).__lions;
      const us = L.units() as { id: number; x: number; y: number }[];
      const W = L.sim.width as number;
      const H = L.sim.height as number;
      const cx = us.reduce((a, u) => a + u.x, 0) / us.length;
      const cy = us.reduce((a, u) => a + u.y, 0) / us.length;
      const squads = Math.ceil(us.length / 4);
      const cols = Math.ceil(Math.sqrt(squads));
      const gap = W >= 80 ? 11 : 8;
      for (let s = 0; s < squads; s++) {
        const ids = us.slice(s * 4, s * 4 + 4).map((u) => u.id);
        const gx = (s % cols) - (cols - 1) / 2;
        const gy = Math.floor(s / cols) - (Math.ceil(squads / cols) - 1) / 2;
        const tx = Math.min(W - 2, Math.max(2, cx + gx * gap));
        const ty = Math.min(H - 2, Math.max(2, cy + gy * gap));
        L.sim.queueCommand({ kind: 'move', ids, x: Math.round(tx * 65536), y: Math.round(ty * 65536) });
      }
      L.step(700);
      return { units: us.length, squads, centroid: [Math.round(cx), Math.round(cy)], map: [W, H] };
    });
    await page.waitForTimeout(1500);
    const mm = page.locator('canvas.rl-minimap');
    const box = await mm.boundingBox();
    if (!box) throw new Error('no minimap');
    console.log(`${map}: gpu=${gpu} dpr=${DPR} loadavg ${os.loadavg().map((v) => v.toFixed(1)).join('/')} ${JSON.stringify(info)} minimap box ${box.width.toFixed(0)}x${box.height.toFixed(0)} css px`);
    // How many separate friendly marks the canvas shows: connected components (8-neighbour) of strongly blue pixels, over the
    // number of living friendly units. A measurement of readability, not a gate; the blue test is the team colour's, not terrain's.
    const marks = await page.evaluate(() => {
      const c = document.querySelector('canvas.rl-minimap') as HTMLCanvasElement;
      const g = c.getContext('2d') as CanvasRenderingContext2D;
      const { width: w, height: h } = c;
      const d = g.getImageData(0, 0, w, h).data;
      const on = new Uint8Array(w * h);
      let px = 0;
      for (let i = 0; i < w * h; i++) {
        const r = d[i * 4], gg = d[i * 4 + 1], b = d[i * 4 + 2];
        if (b > r + 60 && b > gg + 30) { on[i] = 1; px++; }
      }
      let comps = 0;
      const sizes: number[] = [];
      for (let i = 0; i < w * h; i++) {
        if (on[i] !== 1) continue;
        comps++;
        let n = 0;
        const st = [i];
        on[i] = 2;
        while (st.length) {
          const k = st.pop() as number;
          n++;
          const kx = k % w, ky = (k - kx) / w;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const x = kx + dx, y = ky + dy;
            if (x < 0 || y < 0 || x >= w || y >= h) continue;
            if (on[y * w + x] === 1) { on[y * w + x] = 2; st.push(y * w + x); }
          }
        }
        sizes.push(n);
      }
      return { canvasPx: [w, h], bluePx: px, components: comps, sizes: sizes.sort((a, b) => b - a).slice(0, 16) };
    });
    console.log(`  friendly marks: ${JSON.stringify(marks)} for ${info.units} units`);
    await page.mouse.move(5, 5);
    await mm.screenshot({ path: path.join(out, `${map}-minimap.png`) });
    await page.screenshot({ path: path.join(out, `${map}-full.png`) });
    // The real control: click the minimap at its centre; the camera must land mid-map.
    const before = await page.evaluate(() => (window as unknown as { __lions: { renderer: { camera: { x: number; y: number } } } }).__lions.renderer.camera);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(1200);
    const after = await page.evaluate(() => {
      const c = (window as unknown as { __lions: { renderer: { camera: { x: number; y: number } } } }).__lions.renderer.camera;
      return { x: +c.x.toFixed(1), y: +c.y.toFixed(1) };
    });
    console.log(`  click at the minimap centre: camera ${JSON.stringify({ x: +before.x.toFixed(1), y: +before.y.toFixed(1) })} -> ${JSON.stringify(after)}`);
    await page.close();
  }
} finally {
  await browser.close();
  stop();
}
process.exit(0);
