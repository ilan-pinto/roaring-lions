// GH-920: the full HUD of a free-play map at several viewports and UI scales, the minimap's box against every other HUD box, and a
// click-to-jump check at each. `tsx src/perf/minimap-big-hud.ts --root=<tree> --port=5191 --map=wadi_tarfan_l --out=<dir>
//   [--views=1280x720,1440x900,1920x1080] [--scales=1,1.4] [--text=1]`. Report-only; hardware GPU (ANGLE/Metal), music off.
// The click is a real mouse click on the canvas; the camera readback is the debugging instrument and is only the readback.
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
const port = await claimPort('minimap-big-hud', 'MINIMAP_BIG_HUD_PORT', 5191);
const map = arg('map', 'wadi_tarfan_l');
const out = path.resolve(arg('out', '.'));
const views = arg('views', '1280x720,1440x900,1920x1080').split(',').map((v) => v.split('x').map(Number) as [number, number]);
const scales = arg('scales', '1,1.4').split(',').map(Number);
const textSize = Number(arg('text', '1'));
const DPR = Number(arg('dpr', '1'));
fs.mkdirSync(out, { recursive: true });
const stop = devServerStopper(await ensureDevServer(port, root, 'minimap-big-hud'), 'minimap-big-hud');
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--use-gl=angle', '--enable-gpu-rasterization', '--disable-gpu-sandbox'],
});
try {
  for (const [w, h] of views) {
    for (const scale of scales) {
      const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: DPR });
      await page.addInitScript(musicOffInitScript({}, { quality: 'high', uiScale: scale as 1, textSize: textSize as 1 }));
      await page.goto(`http://localhost:${port}/free-play/${map}`, { waitUntil: 'load' });
      await page.waitForFunction(() => !!(window as unknown as { __lions?: { renderer?: unknown } }).__lions?.renderer, null, { timeout: 120000 });
      await page.waitForTimeout(3000);
      await page.mouse.move(2, 2);
      const tag = `${map}-${w}x${h}-ui${scale}${textSize === 1 ? '' : `-text${textSize}`}`;
      await page.screenshot({ path: path.join(out, `${tag}.png`) });
      const facts = await page.evaluate(() => {
        const vw = window.innerWidth, vh = window.innerHeight;
        const mm = document.querySelector('canvas.rl-minimap') as HTMLCanvasElement;
        const r = mm.getBoundingClientRect();
        const hits: string[] = [];
        for (const el of Array.from(document.body.querySelectorAll('*'))) {
          if (el === mm || mm.contains(el) || el.contains(mm)) continue;
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
          const b = el.getBoundingClientRect();
          if (b.width === 0 || b.height === 0) continue;
          if (b.width >= vw * 0.9 && b.height >= vh * 0.9) continue; // the full-frame canvas and its wrappers
          const paints = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || parseFloat(cs.borderTopWidth) > 0 || (el.childNodes.length > 0 && Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? '').trim() !== '')) || el.tagName === 'CANVAS' || el.tagName === 'IMG' || el.tagName === 'svg';
          if (!paints) continue;
          const ix = Math.min(r.right, b.right) - Math.max(r.left, b.left);
          const iy = Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top);
          if (ix > 0 && iy > 0) hits.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ').join('.')} ${Math.round(ix)}x${Math.round(iy)}px`);
        }
        const inside = r.left >= 0 && r.top >= 0 && r.right <= vw && r.bottom <= vh;
        return { vw, vh, box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], inside, rootPx: parseFloat(getComputedStyle(document.documentElement).fontSize), hits: hits.slice(0, 12) };
      });
      // Real clicks at three fractions of the box; expected tile is fraction x map size.
      const dims = await page.evaluate(() => {
        const L = (window as unknown as { __lions: { sim: { width: number; height: number } } }).__lions;
        return { w: L.sim.width, h: L.sim.height };
      });
      const box = facts.box;
      const errs: string[] = [];
      for (const [fx, fy] of [[0.25, 0.25], [0.5, 0.5], [0.75, 0.6]] as const) {
        await page.mouse.click(box[0] + box[2] * fx, box[1] + box[3] * fy);
        await page.waitForTimeout(500);
        const cam = await page.evaluate(() => {
          const c = (window as unknown as { __lions: { renderer: { camera: { x: number; y: number } } } }).__lions.renderer.camera;
          return { x: c.x, y: c.y };
        });
        errs.push(`(${fx},${fy}) -> camera ${cam.x.toFixed(1)},${cam.y.toFixed(1)} want ${(fx * dims.w).toFixed(1)},${(fy * dims.h).toFixed(1)} off ${Math.hypot(cam.x - fx * dims.w, cam.y - fy * dims.h).toFixed(1)} tiles`);
      }
      console.log(`${tag} loadavg ${os.loadavg()[0].toFixed(1)} ${JSON.stringify(facts)}\n  clicks: ${errs.join(' | ')}`);
      await page.close();
    }
  }
} finally {
  await browser.close();
  stop();
}
process.exit(0);
