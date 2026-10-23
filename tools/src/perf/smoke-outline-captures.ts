/**
 * The smoke-outline witness (GH-705, the lead's ruling 23 Oct 2026).
 *
 *   pnpm smoke-outline:capture -- --out=<dir> [--port=5193] [--time]
 *
 * Own units in smoke at >= 48/255 wear their occlusion outline through it. No
 * gated golden scenario lays smoke, so this is what votes (blast:capture's
 * shape): the `smoke-outline` toggle A/B on the SAME frozen frame, repainted
 * at zero elapsed time, must move at least `FLOORS` pixels and mean |delta|
 * on the dense and thinning smoke frames; the quiet frame must move 0 px; and
 * hiding `overlays` must hide the smoke outline too (on-vs-off under hidden
 * overlays reads 0 px). Exit 1 on any miss.
 *
 * One dev server, one Metal Chromium, music off. `beit_sahwan_outskirts`, at
 * the force centroid, zoom 1 and 2.5. `--time` also times `stepSmokeOutlines`
 * on the dense frame (performance.now, many frames).
 */
import { chromium, type Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { devServerStopper, ensureDevServer } from '../golden-diff/browser';
import { musicOffInitScript } from '../ui-review/music-off';
import { claimPortOrAttach } from '../ui-review/port';

const TAG = 'smoke-outline';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const flag = (n: string): string | undefined => process.argv.slice(2).find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const OUT = path.resolve(flag('out') ?? path.join(REPO_ROOT, '.superpowers/smoke-outline'));
fs.mkdirSync(OUT, { recursive: true });

interface Subject { id: string; tick: number; setup: 'smoke' | '' }
const SUBJECTS: Subject[] = [
  { id: 'smoke-dense', tick: 90, setup: 'smoke' },
  { id: 'smoke-thin', tick: 230, setup: 'smoke' },
  { id: 'quiet', tick: 200, setup: '' },
];
const ZOOMS = [1, 2.5];
const SMOKE_TYPES = [
  'apc_eitan', 'apc_kipod', 'breach_team', 'demo_squad', 'ifv_namer', 'inf_medic_squad', 'mbt_lavi',
  'mbt_lavi_camo', 'mortar_team', 'scout_shachaf', 'veh_ambulance', 'yahalom_squad',
];

type R = {
  camera: { x: number; y: number; zoom: number };
  canvas: HTMLCanvasElement;
  frame(a: number, dt: number): void;
  setDebugLayerVisible(n: string, v: boolean): number;
  renderer: { info: { autoReset: boolean; reset(): void; render: { calls: number; triangles: number } } };
};
type Lions = {
  renderer: R;
  sim: { tickCount: number; width: number; smoke: Uint8Array; queueCommand(c: unknown): void };
  step(n: number): void;
  units(side?: number): { id: number; type: string; x: number; y: number }[];
};

const { port } = await claimPortOrAttach(TAG, 'SMOKE_OUTLINE_PORT', 5193);
const stopServer = devServerStopper(await ensureDevServer(port, REPO_ROOT, TAG), TAG);
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--use-gl=angle', '--enable-gpu-rasterization', '--disable-gpu-sandbox'],
});
/**
 * Floors on the toggle A/B, each a third of the SMALLEST of three runs
 * (macOS / M3 Pro / ANGLE-Metal, DPR 2, 1440x900, music off), keyed
 * `<subject>@z<zoom>`. Filled from the measured readings; see the comment on
 * each. The quiet frame has no floor: it must read exactly 0 px.
 */
const FLOORS: Record<string, { px: number; mad: number }> = {
  // n = 3 runs each, 23 Oct 2026, load average 5-11. Readings (px / mean |delta|):
  //   dense z1   16556, 16640, 16423 / 0.2241, 0.2269, 0.2214
  //   dense z2.5 37968, 38175, 38803 / 0.4687, 0.4720, 0.4767
  //   thin  z1   17722, 17977, 17997 / 0.2303, 0.2307, 0.2330
  //   thin  z2.5 40184, 40817, 40690 / 0.4697, 0.4672, 0.4724
  // Each floor is a third of the smallest of the three.
  'smoke-dense@z1': { px: 5474, mad: 0.0738 },
  'smoke-dense@z2.5': { px: 12656, mad: 0.1562 },
  'smoke-thin@z1': { px: 5907, mad: 0.0767 },
  'smoke-thin@z2.5': { px: 13394, mad: 0.1557 },
};
const failures: string[] = [];
const log: string[] = [];
const say = (s: string): void => { console.log(s); log.push(s); };

async function boot(s: Subject): Promise<{ page: Page; cam: [number, number] }> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await page.addInitScript(musicOffInitScript());
  page.on('pageerror', (e) => say(`[${s.id}] pageerror ${e.message}`));
  await page.goto(`http://localhost:${port}/?sandbox=beit_sahwan_outskirts`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window as unknown as { __lions?: { renderer?: unknown } }).__lions?.renderer, null, { timeout: 120000 });
  await page.waitForTimeout(4000);
  const info = await page.evaluate(
    async ([tick, setup, smokeTypes]) => {
      const w = window as unknown as { __lions: Lions; requestAnimationFrame: (f: FrameRequestCallback) => number };
      const raf = w.requestAnimationFrame.bind(window);
      w.requestAnimationFrame = () => 0;
      await new Promise((r) => raf(() => raf(() => r(null))));
      const L = w.__lions;
      const mine = L.units(0);
      const foe = L.units(1);
      const cx = mine.reduce((t, u) => t + u.x, 0) / mine.length + 0.5;
      const cy = mine.reduce((t, u) => t + u.y, 0) / mine.length + 0.5;
      if (L.sim.tickCount < 20) L.step(20 - L.sim.tickCount);
      const notes: string[] = [];
      const FX = 65536;
      if (setup === 'smoke') {
        const spots = [[0, 0], [2, -1], [-2, 1], [1, 2], [-1, -2], [3, 2]];
        const layers = mine.filter((u) => (smokeTypes as string[]).includes(u.type));
        layers.forEach((u, k) => {
          const [dx, dy] = spots[k % spots.length];
          L.sim.queueCommand({ kind: 'smoke', ids: [u.id], x: Math.round((cx + dx) * FX), y: Math.round((cy + dy) * FX) });
        });
        notes.push(`smoke ordered by ${layers.length} unit(s): ${layers.map((u) => u.type).join(',')}`);
      }
      L.step(Math.max(0, (tick as number) - L.sim.tickCount));
      return { cam: [cx, cy] as [number, number], notes, tick: L.sim.tickCount, nMine: mine.length, nFoe: foe.length };
    },
    [s.tick, s.setup, SMOKE_TYPES] as const
  );
  const gpu = await page.evaluate(() => {
    const gl = (window as unknown as { __lions: Lions }).__lions.renderer.canvas.getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext && gl ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  });
  say(`[${s.id}] tick ${info.tick}, camera (${info.cam[0].toFixed(2)}, ${info.cam[1].toFixed(2)}), own ${info.nMine} / enemy ${info.nFoe}, gpu ${gpu}; ${info.notes.join('; ')}`);
  if (/SwiftShader/i.test(gpu)) throw new Error('software GPU: refusing (Metal only)');
  await page.addStyleTag({ content: '.rl-feed{display:none !important}' });
  return { page, cam: info.cam };
}

/** Sets the arm, repaints twice at zero elapsed time, returns own units wearing the smoke outline. */
async function arm(page: Page, on: boolean): Promise<number> {
  return page.evaluate((v) => {
    const R = (window as unknown as { __lions: Lions }).__lions.renderer;
    const n = R.setDebugLayerVisible('smoke-outline', v);
    R.frame(1, 0);
    R.frame(1, 0);
    return n;
  }, on);
}
async function shot(page: Page): Promise<PNG> { return PNG.sync.read(await page.screenshot({ type: 'png' })); }
function diff(a: PNG, b: PNG): { px: number; mad: number } {
  let px = 0, sum = 0;
  const n = a.width * a.height;
  for (let i = 0; i < n; i++) {
    let d = 0;
    for (let c = 0; c < 3; c++) d += Math.abs(a.data[i * 4 + c] - b.data[i * 4 + c]);
    sum += d / 3;
    if (d / 3 > 6) px++;
  }
  return { px, mad: sum / n };
}

const TIME = process.argv.includes('--time');
for (const s of SUBJECTS) {
  const { page, cam } = await boot(s);
  for (const z of ZOOMS) {
    await page.evaluate(([x, y, zz]) => {
      const R = (window as unknown as { __lions: Lions }).__lions.renderer;
      R.camera.x = x; R.camera.y = y; R.camera.zoom = zz;
      R.frame(1, 0); R.frame(1, 0);
    }, [cam[0], cam[1], z] as const);
    await arm(page, false);
    const off = await shot(page);
    const off2 = await shot(page);
    const nOn = await arm(page, true);
    const on = await shot(page);
    const on2 = await shot(page);
    fs.writeFileSync(path.join(OUT, `${s.id}_z${z}_off.png`), PNG.sync.write(off));
    fs.writeFileSync(path.join(OUT, `${s.id}_z${z}_on.png`), PNG.sync.write(on));
    const d = diff(off, on);
    const cOff = diff(off, off2);
    const cOn = diff(on, on2);
    // `overlays` hidden must take the smoke outline with it: on == off then.
    await page.evaluate(() => (window as unknown as { __lions: Lions }).__lions.renderer.setDebugLayerVisible('overlays', false));
    await arm(page, false);
    const hOff = await shot(page);
    await arm(page, true);
    const hOn = await shot(page);
    const dh = diff(hOff, hOn);
    await page.evaluate(() => (window as unknown as { __lions: Lions }).__lions.renderer.setDebugLayerVisible('overlays', true));
    // Cost: one frame per arm, renderer.info reset by hand.
    const calls: Record<string, number> = {};
    for (const a of [false, true]) {
      await arm(page, a);
      calls[a ? 'on' : 'off'] = await page.evaluate(() => {
        const R = (window as unknown as { __lions: Lions }).__lions.renderer;
        const info = R.renderer.info;
        info.autoReset = false;
        info.reset();
        R.frame(1, 0);
        const c = info.render.calls;
        info.autoReset = true;
        return c;
      });
    }
    say(`[${s.id} z${z}] off vs on: ${d.px} px moved / mean |delta| ${d.mad.toFixed(4)}; control off-off ${cOff.px} px, on-on ${cOn.px} px; overlays-hidden on vs off ${dh.px} px; own units in smoke (>= 48/255): ${nOn}; draw calls off ${calls.off} / on ${calls.on}`);
    const key = `${s.id}@z${z}`;
    const floor = FLOORS[key];
    if (s.id === 'quiet') {
      if (d.px !== 0) failures.push(`${key}: quiet frame moved ${d.px} px, must be 0`);
    } else {
      if (floor === undefined) say(`[${key}] no floor recorded yet`);
      else if (d.px < floor.px || d.mad < floor.mad) failures.push(`${key}: ${d.px} px / ${d.mad.toFixed(4)} below floor ${floor.px} px / ${floor.mad}`);
    }
    if (s.id !== 'quiet') {
      // The overlays-hidden check below is only meaningful on a frame that
      // really has outlines: own units in smoke, and a visible A/B.
      if (nOn <= 0) failures.push(`${key}: no own unit is in smoke (${nOn}); the frame proves nothing`);
      if (d.px <= 0) failures.push(`${key}: the toggle moved 0 px with overlays visible; the overlays-hidden check would be vacuous`);
    }
    if (dh.px !== 0) failures.push(`${key}: overlays hidden but the smoke outline still moved ${dh.px} px`);
    if (calls.on !== calls.off) failures.push(`${key}: draw calls ${calls.off} -> ${calls.on}`);
  }
  if (TIME && s.id === 'smoke-dense') {
    await page.evaluate(() => (window as unknown as { __lions: Lions }).__lions.renderer.setDebugLayerVisible('smoke-outline', true));
    const t = await page.evaluate(() => {
      const R = (window as unknown as { __lions: { renderer: { stepSmokeOutlines(): void } } }).__lions.renderer;
      for (let i = 0; i < 200; i++) R.stepSmokeOutlines();
      // performance.now is coarsened in a page, so time batches of 500 calls
      // (a single call reads 0) and report the per-call mean of each batch.
      const BATCH = 500;
      const xs: number[] = [];
      for (let i = 0; i < 200; i++) {
        const t0 = performance.now();
        for (let j = 0; j < BATCH; j++) R.stepSmokeOutlines();
        xs.push(((performance.now() - t0) * 1000) / BATCH);
      }
      xs.sort((a, b) => a - b);
      return { median: xs[xs.length >> 1], p95: xs[Math.floor(xs.length * 0.95)], n: xs.length };
    });
    say(`[timing] stepSmokeOutlines on the dense-smoke frame: median ${t.median.toFixed(1)} us, p95 ${t.p95.toFixed(1)} us per call, over ${t.n} batches of 500`);
  }
  await page.close();
}
fs.writeFileSync(path.join(OUT, `run-${Date.now()}.log`), log.join('\n') + '\n');
await browser.close();
stopServer();
if (failures.length) {
  console.error(`${TAG}: FAIL\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(`${TAG}: ok`);
