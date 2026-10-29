/**
 * Wadi Halam backdrop (GH-161): ONE honest cold boot. A fresh browser (no profile, so no HTTP cache and no GPU shader
 * cache of ours), the sandbox map, Metal, music off. Reports the kit's read (fetch + Draco decode + atlas decode),
 * the CPU build (floor bake + placement), and the longest frame gap around the moment the backdrop was built (the
 * GPU upload and shader work lands in that frame). The dev server is Vite, so the fetch is of the unbundled file
 * from localhost: the wire is the file's size, printed separately.
 *
 *   npx tsx src/wadi-look/cold.ts --port=5188 [--map=wadi_halam_4]
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
const port = await claimPort('wadi-cold', 'WADI_COLD_PORT', 5188);
const map = arg('map', 'wadi_halam_4');
const stop = devServerStopper(await ensureDevServer(port, root, 'wadi-cold'), 'wadi-cold');
// Warm the dev server's own transform cache with a throwaway page, so the cold page measures the game, not Vite's first compile.
const warm = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--use-gl=angle'] });
try {
  const wp = await warm.newPage();
  await wp.goto(`http://localhost:${port}/?sandbox=${map}`, { waitUntil: 'load' });
  await wp.waitForFunction(() => (window as unknown as { __lions?: { renderer?: unknown } }).__lions?.renderer != null, null, { timeout: 120000 });
  await wp.waitForTimeout(3000);
} finally {
  await warm.close();
}
// The measured boots: brand-new browser processes (new temporary profile: empty HTTP cache, empty GPU program cache),
// alternating WITH the kit and WITHOUT it (the kit's request aborted, so the map keeps its skirt: today's boot).
// The milestone is the battlefield being up (`window.__lions` defined, the loading screen gone) and the first 3 s of
// frames after it. The difference is what the backdrop costs a cold boot.
const ROUNDS = Number(arg('rounds', '3'));
interface Boot { milestoneMs: number; builtMs: number | null; worstGap3s: number; stats: Record<string, number> | null }
async function boot(withKit: boolean): Promise<Boot> {
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--use-gl=angle', '--enable-gpu-rasterization', '--disable-gpu-sandbox', '--disk-cache-size=1', '--disable-gpu-shader-disk-cache'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    await page.addInitScript(musicOffInitScript({}, { quality: 'high' }));
    await page.addInitScript(`
      window.__raf = [];
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) => raf((t) => { window.__raf.push(performance.now()); cb(t); });
      window.__upAt = null; window.__statsAt = null;
      const iv = setInterval(() => {
        const r = window.__lions && window.__lions.renderer;
        if (r && window.__upAt === null) window.__upAt = performance.now();
        if (r && r.backdropStats && window.__statsAt === null) window.__statsAt = performance.now();
      }, 4);
    `);
    if (!withKit) await page.route('**/wadi_halam_kit.glb', (route) => route.abort());
    page.on('console', () => {});
    await page.goto(`http://localhost:${port}/?sandbox=${map}`, { waitUntil: 'load' });
    await page.waitForFunction(() => (window as unknown as { __upAt: number | null }).__upAt !== null, null, { timeout: 120000 });
    await page.waitForTimeout(4000);
    return await page.evaluate(() => {
      const w = window as unknown as { __raf: number[]; __upAt: number; __statsAt: number | null; __lions: { renderer: { backdropStats: Record<string, number> | null } } };
      const t = w.__raf.filter((x) => x >= w.__upAt && x < w.__upAt + 3000);
      let worst = 0;
      for (let i = 1; i < t.length; i++) worst = Math.max(worst, t[i] - t[i - 1]);
      return { milestoneMs: w.__upAt, builtMs: w.__statsAt, worstGap3s: worst, stats: w.__lions.renderer.backdropStats };
    });
  } finally {
    await browser.close();
  }
}
const med = (a: number[]): number => a.slice().sort((p, q) => p - q)[Math.floor(a.length / 2)];
try {
  const withK: Boot[] = [];
  const without: Boot[] = [];
  for (let i = 0; i < ROUNDS; i++) {
    withK.push(await boot(true));
    without.push(await boot(false));
  }
  const line = (n: string, b: Boot[]): string => `${n}: battlefield up at ${b.map((x) => x.milestoneMs.toFixed(0)).join(', ')} ms; worst frame gap in the next 3 s ${b.map((x) => x.worstGap3s.toFixed(0)).join(', ')} ms`;
  console.log(line('WITH the kit   ', withK));
  console.log(line('WITHOUT the kit', without));
  console.log(`median battlefield-up delta ${(med(withK.map((x) => x.milestoneMs)) - med(without.map((x) => x.milestoneMs))).toFixed(0)} ms; backdrop built at ${withK.map((x) => (x.builtMs ?? NaN).toFixed(0)).join(', ')} ms (its own read ${withK.map((x) => (x.stats?.kitReadMs ?? NaN).toFixed(0)).join(', ')}, bake ${withK.map((x) => (x.stats?.bakeMs ?? NaN).toFixed(0)).join(', ')}, placement ${withK.map((x) => (x.stats?.assembleMs ?? NaN).toFixed(0)).join(', ')} ms)`);
} finally {
  stop();
}
