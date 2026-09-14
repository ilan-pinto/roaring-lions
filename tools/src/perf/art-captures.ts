/**
 * The nine captures the 2026-09-14 art review was argued from, repeatable:
 *   npx tsx tools/src/perf/art-captures.ts http://127.0.0.1:5178 out/dir
 * Headless Chromium, SwiftShader, 1440x900, device pixel ratio 1.
 */
import { chromium, type Page } from 'playwright';
import fs from 'node:fs';

const [base = 'http://127.0.0.1:5178', out = 'art-captures'] = process.argv.slice(2);
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

await boot('/?sandbox=beit_sahwan_outskirts&sur&civ');
await cam(22, 24, 0.5);
await shot('01-wide-fog');
await cam(5, 22, 2.5);
await shot('02-force-closeup');
await page.evaluate(() => {
  const L = (
    window as unknown as { __lions: { sel(ids: number[]): void; units(): { id: number }[] } }
  ).__lions;
  L.sel(L.units().map((u) => u.id));
});
await page.mouse.click(784, 418, { button: 'right' });
await page.evaluate(() =>
  (window as unknown as { __lions: { step(n: number): void } }).__lions.step(520)
);
await page.keyboard.press('Escape');
await cam(26, 22, 1.6);
await shot('03-town-fight');
await cam(27, 22, 2.5);
await shot('04-fight-closeup');
await cam(31, 21, 2.0);
await shot('05-town-fog-blocks');
await boot('/?sandbox=beit_sahwan_outskirts&nomesh');
await cam(5, 22, 2.5);
await shot('06-nomesh-billboards');
await boot('/?sandbox=tel_marum&tunnel&sur&roe&civ');
await cam(20, 18, 0.55);
await shot('07-tel-marum-fog');
await page.goto(base + '/?campaign', { waitUntil: 'load' });
await page.waitForTimeout(6000);
await shot('08-campaign-board');
await page.goto(base + '/', { waitUntil: 'load' });
await page.waitForTimeout(2500);
await shot('09-menu');
await browser.close();
