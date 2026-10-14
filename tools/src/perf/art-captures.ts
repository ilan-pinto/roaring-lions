/**
 * The captures the 2026-09-14 art review was argued from, repeatable (eight
 * of its nine; 06, the billboard shot, went with the billboard path):
 *   npx tsx tools/src/perf/art-captures.ts out/dir [--port=5178] [--attach]
 * Headless Chromium, SwiftShader, 1440x900, device pixel ratio 1.
 *
 * It serves its own tree on `--port=<n>` (else ART_CAPTURE_PORT, else 5178),
 * and a port something already holds is refused (`ui-review/port.ts`).
 * `--attach` drives a server you started there instead -- a BEFORE tree that
 * has no copy of this file. It used to take that server's URL as its first
 * argument and photograph whatever answered, with no error.
 */
import { chromium, type Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { devServerStopper, ensureDevServer } from '../golden-diff/browser';
import { musicOffInitScript } from '../ui-review/music-off';
import { claimPortOrAttach, refuseRetiredBaseUrl } from '../ui-review/port';

const TAG = 'art-captures';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
refuseRetiredBaseUrl(TAG, process.argv.slice(2));
const [out = 'art-captures'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const { port } = await claimPortOrAttach(TAG, 'ART_CAPTURE_PORT', 5178);
fs.mkdirSync(out, { recursive: true });
const stopServer = devServerStopper(await ensureDevServer(port, REPO_ROOT, TAG), TAG);
const base = `http://localhost:${port}`;
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page: Page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
await page.addInitScript(musicOffInitScript());

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
// 06 was `06-nomesh-billboards`; the billboard path is deleted (WP-A3.3).
// The other numbers are kept so a capture set stays comparable by name.
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
stopServer();
