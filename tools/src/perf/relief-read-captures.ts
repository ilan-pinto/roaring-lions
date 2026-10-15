/**
 * Before/after sheet for relief read: four relief maps, each photographed
 * with `slope-light` and `height-contours` both hidden (today's look) and both
 * shown, from ONE frozen page, at zoom 1 and 2.
 *
 *   npx tsx src/perf/relief-read-captures.ts --port=<n> --attach <outDir>
 *
 * Drives a dev server the CALLER started on that port (`requireAttach`). The fog-of-war layer is
 * hidden so the ground, not the shroud, is what the frame shows. Music off.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { musicOffInitScript } from '../ui-review/music-off';
import { gpuLaunchArgs } from '../ui-review/gpu';
import { requireAttach } from '../ui-review/port';

const [out] = process.argv.slice(2).filter((a) => !a.startsWith('--')) as [string];
const port = Number(process.argv.find((a) => a.startsWith('--port='))?.slice(7));
if (!port || !out) throw new Error('usage: relief-read-captures.ts --port=<n> --attach <outDir>');
await requireAttach('relief-read-captures', [port]);
const base = `http://127.0.0.1:${port}`;
fs.mkdirSync(out, { recursive: true });

/** Map and the relief it frames: a bluff, a tell, a saddle, a shoulder. */
const MAPS: [string, number, number][] = [
  ['wadi_tarfan', 19, 22],
  ['milh_flats', 12, 11],
  ['tel_marum', 24, 14],
  ['qarn_hadid', 22, 20],
];
const LAYERS = ['slope-light', 'height-contours'];

interface W {
  __lions: {
    renderer: {
      camera: { x: number; y: number; zoom: number };
      frame(a: number, dt: number): void;
      setDebugLayerVisible(n: string, v: boolean): unknown;
    };
  };
}

const browser = await chromium.launch({ headless: true, args: gpuLaunchArgs('metal') });
try {
  for (const [map, x, y] of MAPS) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await page.addInitScript(musicOffInitScript());
    await page.goto(`${base}/?sandbox=${map}`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!(window as unknown as W).__lions?.renderer, null, { timeout: 180000 });
    await page.waitForTimeout(3000);
    await page.evaluate(() => {
      (window as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = () => 0;
      (window as unknown as W).__lions.renderer.setDebugLayerVisible('fog', false);
    });
    for (const z of [1, 2]) {
      for (const shown of [false, true]) {
        await page.evaluate(
          ([cx, cy, cz, on, layers]) => {
            const r = (window as unknown as W).__lions.renderer;
            for (const l of layers as string[]) r.setDebugLayerVisible(l, on as boolean);
            r.camera.x = cx as number;
            r.camera.y = cy as number;
            r.camera.zoom = cz as number;
            for (let i = 0; i < 3; i++) r.frame(1, 0);
          },
          [x, y, z, shown, LAYERS] as const
        );
        await page.waitForTimeout(250);
        await page.screenshot({ path: path.join(out, `${map}-${shown ? 'after' : 'before'}-z${z}.png`), clip: { x: 0, y: 40, width: 1440, height: 820 } });
      }
    }
    console.log(`${map} done`);
    await page.close();
  }
} finally {
  await browser.close();
}
