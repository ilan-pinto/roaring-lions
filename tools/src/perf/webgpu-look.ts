/**
 * GH-943 L5 look sheet capture: one scene, three arms (gl = as shipped, gls = hooks stripped, gpu = WebGPU), two zooms.
 *   pnpm --filter @lions/tools exec tsx src/perf/webgpu-look.ts --port=5188 --out=<dir>
 * One fresh page per arm, sim frozen at tick 80, nothing selected, DOM chrome hidden, DPR 2. Sun shadow ON in every arm.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { musicOffInitScript } from '../ui-review/music-off';
import { HIDDEN_LAYERS } from './webgpu-trial-page';

const args = process.argv.slice(2);
const arg = (n: string, d: string): string => (args.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).slice(n.length + 3);
const port = Number(arg('port', '5188'));
const out = arg('out', '.');
const MAP = arg('map', 'wadi_halam_4');
const TICK = 80;
const VIEWS = [
  { name: 'z1', zoom: 1, x: 9.5, y: 21.5 },
  { name: 'z2.5', zoom: 2.5, x: 9.5, y: 23 },
];
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--use-gl=angle', '--enable-gpu-rasterization', '--disable-gpu-sandbox', '--enable-unsafe-webgpu'] });
const MODULE = `/@fs${process.cwd().replace(/\/tools$/, '')}/packages/render/src/three/spike/webgpu-trial-gate.ts`;
const shadowErrs: Record<string, number> = {};

for (const mode of (process.env.LOOK_ARMS ?? 'gl,gls,gpu').split(',') as ('gl' | 'gls' | 'gpu')[]) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await page.addInitScript(musicOffInitScript({}, { quality: 'high' }));
  await page.addInitScript('window.__name = (f) => f; window.process = { env: {} };');
  page.on('console', (m) => {
    if (process.env.LOOK_DEBUG && (m.type() === 'error' || m.type() === 'warning') && !m.text().includes('UNPORTED')) console.log(mode, m.type(), m.text().slice(0, 300));
    if (process.env.LOOK_DEBUG && m.text().includes('webgpu-trial')) console.log(mode, m.text().slice(0, 160));
    if (m.text().includes('ShadowDepthTexture')) shadowErrs[mode] = (shadowErrs[mode] ?? 0) + 1;
  });
  page.on('pageerror', (e) => console.log(mode, 'pageerror', e.message.slice(0, 300)));
  await page.goto(`http://localhost:${port}/?sandbox=${MAP}&envlight=0&grade=0&tod=day${mode === 'gpu' ? '&gpu=webgpu' : ''}`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window as any).__lions?.renderer, null, { timeout: 120000 });
  await page.evaluate(() => { });
  await page.keyboard.press('Escape'); // the real pause menu: sim stops, frame loop keeps drawing
  if (mode === 'gpu') {
    await page.waitForFunction(() => (window as any).__lions.renderer.gpuTrialState !== 'pending', null, { timeout: 120000 });
    const st = await page.evaluate(() => (window as any).__lions.renderer.gpuTrialState);
    if (st !== 'active') throw new Error('webgpu arm not active: ' + st);
  }
  const info = await page.evaluate(
    async ({ mod, mode, tick, layers }) => {
      const L = (window as any).__lions;
      const r = L.renderer;
      const before = Number(L.sim.tickCount);
      if (before < tick) L.step(tick - before);
      L.sel([]);
      if (mode !== 'gl') for (const l of layers) r.setDebugLayerVisible(l, false);
      if (mode === 'gls') ((await import(/* @vite-ignore */ mod)) as typeof import('./webgpu-trial-gate')).stripGlslHooks(r.scene);
      if (mode === 'gl' ) { /* as shipped: nothing hidden */ }
      if (mode !== 'gpu') for (const p of r.post?.composer.passes ?? []) if (mode === 'gls' && p.constructor.name === 'FogOfWarPass') p.enabled = false;
      const st = document.createElement('style');
      st.textContent = 'body > *:not(#stage):not(script) , .rl-strip, .rl-cmd, .rl-clock, .rl-sel, .rl-fire, .rl-held, .rl-bigbanner, .rl-invoice, .rl-minimap, .rl-group-bar, .rl-marquee, .rl-works-tip { visibility: hidden !important; } #stage > :not(canvas) { visibility: hidden !important; }';
      document.head.appendChild(st);
      return { before, after: Number(L.sim.tickCount) };
    },
    { mod: MODULE, mode, tick: TICK, layers: [...HIDDEN_LAYERS] }
  );
  console.log(mode, 'tick', info);
  for (const v of VIEWS) {
    await page.evaluate(({ v }) => { const r = (window as any).__lions.renderer; r.camera.x = v.x; r.camera.y = v.y; r.camera.zoom = v.zoom; }, { v });
    for (let i = 0; i < 40; i++) {
      await page.evaluate(() => (window as any).__lions.renderer.frame(1, 0));
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(500);
    if (process.env.LOOK_DEBUG) console.log(mode, v.name, await page.evaluate(() => { const r = (window as any).__lions.renderer; const h = r.gpuTrialHandle?.(); return JSON.stringify({ cam: [r.camera.x, r.camera.y, r.camera.zoom], info: h?.info(), pos: r.scene.parent ? 1 : 0 }); }));
    await page.screenshot({ path: `${out}/${mode}-${v.name}.png` });
  }
  await page.close();
}
console.log('ShadowDepthTexture errors per arm', shadowErrs);
await browser.close();
process.exit(0);
