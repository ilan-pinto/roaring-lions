// GH-913 L7: the in-game frames and the minimap of a free-play map, through the real UI (route, minimap click, wheel).
// `tsx src/perf/rujm-l7-shots.ts --root=<tree> --port=5213 --map=rujm_sawda --out=<dir> [--dpr=2]`. Report-only; hardware GPU, music off.
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
const port = await claimPort('rujm-l7-shots', 'RUJM_L7_SHOTS_PORT', 5213);
const maps = arg('map', 'rujm_sawda').split(',');
const out = path.resolve(arg('out', '.'));
const DPR = Number(arg('dpr', '2'));
fs.mkdirSync(out, { recursive: true });
const stop = devServerStopper(await ensureDevServer(port, root, 'rujm-l7-shots'), 'rujm-l7-shots');
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
    await page.waitForTimeout(4000);
    const gpu = await page.evaluate(() => {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      return ext && gl ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
    });
    const cam = () =>
      page.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const L = (window as any).__lions;
        const c = L.renderer.camera;
        return { x: +c.x.toFixed(1), y: +c.y.toFixed(1), zoom: +c.zoom.toFixed(2), map: [L.sim.width, L.sim.height] };
      });
    console.log(`${map}: gpu=${gpu} dpr=${DPR} loadavg ${os.loadavg().map((v) => v.toFixed(1)).join('/')} boot camera ${JSON.stringify(await cam())}`);
    const mm = page.locator('canvas.rl-minimap');
    const box = await mm.boundingBox();
    if (!box) throw new Error('no minimap');
    console.log(`  minimap box ${box.width.toFixed(0)}x${box.height.toFixed(0)} css px`);
    await page.screenshot({ path: path.join(out, `${map}-boot-full.png`) });
    await mm.screenshot({ path: path.join(out, `${map}-minimap-dpr${DPR}.png`) });
    // The real control: click the minimap at the map centre, then wheel the zoom.
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(1500);
    console.log(`  after a minimap click at its centre: ${JSON.stringify(await cam())}`);
    await page.mouse.move(720, 400);
    for (let i = 0; i < 12; i++) {
      await page.mouse.wheel(0, 100);
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(800);
    console.log(`  wheel out: ${JSON.stringify(await cam())}`);
    await page.screenshot({ path: path.join(out, `${map}-centre-wheel-out-full.png`) });
    for (let i = 0; i < 40; i++) {
      await page.mouse.wheel(0, -100);
      await page.waitForTimeout(40);
    }
    await page.waitForTimeout(800);
    console.log(`  wheel in: ${JSON.stringify(await cam())}`);
    await page.screenshot({ path: path.join(out, `${map}-centre-wheel-in-full.png`) });
    await mm.screenshot({ path: path.join(out, `${map}-minimap-framed-dpr${DPR}.png`) });
    await page.close();
  }
} finally {
  await browser.close();
  stop();
}
process.exit(0);
