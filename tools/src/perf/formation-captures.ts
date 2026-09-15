/**
 * Three captures for the lead on ?sandbox=tel_marum, zoom 1.6, after the
 * group has settled: the whole force into the open basin, the whole force
 * into the five-wide pass through the ridge, and the foot units alone into
 * the two-wide boulder corridor (a column).
 *   npx tsx tools/src/perf/formation-captures.ts http://127.0.0.1:5178 .superpowers/formation-captures
 * Headless Chromium, SwiftShader, 1440x900, device pixel ratio 1 — same
 * launch args and viewport as art-captures.ts.
 */
import { chromium, type Page } from 'playwright';
import fs from 'node:fs';

const [base = 'http://127.0.0.1:5178', out = 'formation-captures'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page: Page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});

async function boot(url: string): Promise<void> {
  await page.goto(base + url, { waitUntil: 'load' });
  await page.waitForFunction(
    () => !!(window as unknown as { __lions?: { renderer?: unknown } }).__lions?.renderer,
    null,
    { timeout: 60000 }
  );
  await page.waitForTimeout(2500);
}
async function cam(x: number, y: number, zoom: number): Promise<void> {
  await page.evaluate(
    ([cx, cy, cz]) => {
      const c = (
        window as unknown as {
          __lions: { renderer: { camera: { x: number; y: number; zoom: number } } };
        }
      ).__lions.renderer.camera;
      c.x = cx;
      c.y = cy;
      c.zoom = cz;
    },
    [x, y, zoom]
  );
  await page.waitForTimeout(600);
}
async function shot(name: string): Promise<void> {
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log('saved', name);
}

async function order(x: number, y: number, footOnly: boolean): Promise<void> {
  await page.evaluate(
    ([tx, ty, foot]) => {
      const L = (
        window as unknown as {
          __lions: {
            units(): { id: number }[];
            sel(ids: number[]): void;
            sim: {
              state: { typeIdx: Uint16Array };
              unitTypes: { isAir: boolean; moveDomain: number }[];
              queueCommand(c: { kind: 'move'; ids: number[]; x: number; y: number }): void;
            };
            step(n: number): void;
          };
        }
      ).__lions;
      const ids = L.units()
        .map((u) => u.id)
        .filter((id) => {
          if (!foot) return true;
          const t = L.sim.unitTypes[L.sim.state.typeIdx[id]];
          return !t.isAir && t.moveDomain === 0;
        });
      L.sel(ids);
      // Q16.16: a tile centre is (tile << 16) + 32768.
      L.sim.queueCommand({ kind: 'move', ids, x: (tx << 16) + 32768, y: (ty << 16) + 32768 });
      L.step(90 * 20);
    },
    [x, y, footOnly] as [number, number, boolean]
  );
  await page.waitForTimeout(800);
}
await boot('/?sandbox=tel_marum');
await order(24, 30, false);
await cam(24, 30, 1.6);
await shot('01-open-basin');
await boot('/?sandbox=tel_marum');
await order(24, 13, false);
await cam(24, 13, 1.6);
await shot('02-five-wide-pass');
await boot('/?sandbox=tel_marum');
await order(10, 13, true);
await cam(10, 15, 1.6);
await shot('03-corridor-column');
await browser.close();
