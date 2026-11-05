/**
 * The WebGPU trial's measurement driver (GH-943 L5, option (b)).
 *
 *   pnpm exec tsx tools/src/perf/webgpu-trial.ts --root=<tree> --port=5184 [--map=wadi_halam_4] [--rounds=1] [--frames=80]
 *       [--counts=300,600,900] [--out=<json>] [--skip-curve]
 *
 * ABBA rounds: arms run gl, gpu, gpu, gl per round, each on a FRESH page, so load drift lands on both. The views run
 * on the real sandbox (`?sandbox=<map>&gpu=webgpu`, the flag path itself); the figure curve runs on a private Sim and
 * ThreeRenderer (the sandbox's sim holds 256 units, the curve needs 900). Both arms hide the same layers and skip
 * the same effects (`webgpu-trial-page.ts` HIDDEN_LAYERS). Refuses SwiftShader (exit 2) and a WebGPU arm that fell
 * back (exit 3): a fallback is evidence about the fallback, not about WebGPU.
 *
 * ONE Metal browser, on the port given, music off. Starts its own dev server and stops only that one.
 */
import { chromium, type Page } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { devServerStopper, ensureDevServer } from '../golden-diff/browser';
import { musicOffInitScript } from '../ui-review/music-off';
import { claimPort } from '../ui-review/port';

const args = process.argv.slice(2);
const arg = (n: string, d: string): string => (args.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).slice(n.length + 3);
const root = path.resolve(arg('root', process.cwd()));
const port = await claimPort('webgpu-trial', 'WEBGPU_TRIAL_PORT', 5184);
const MAP = arg('map', 'wadi_halam_4');
const DPR = Number(arg('dpr', '2'));
const ROUNDS = Number(arg('rounds', '1'));
const FRAMES = Number(arg('frames', '80'));
const COUNTS = arg('counts', '300,600,900').split(',').map(Number);
const OUT = arg('out', '');
const SKIP_CURVE = args.includes('--skip-curve');
const ZOOMS = [1, 1.6, 2.5];
const MODULE = `/@fs${root}/tools/src/perf/webgpu-trial-page.ts`;

const stop = devServerStopper(await ensureDevServer(port, root, 'webgpu-trial'), 'webgpu-trial');
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--use-gl=angle', '--enable-gpu-rasterization', '--disable-gpu-sandbox', '--enable-unsafe-webgpu'],
});

const unportedSeen = new Map<string, string>();
const errors: string[] = [];

async function newPage(width: number, height: number): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: DPR });
  await page.addInitScript(musicOffInitScript({}, { quality: 'high' }));
  await page.addInitScript('window.__name = (f) => f;');
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    const t = m.text();
    if (t.startsWith('[webgpu-trial] UNPORTED')) unportedSeen.set(t, t);
    else if (t.startsWith('[webgpu-trial]')) console.log(t);
    else if (m.type() === 'error') errors.push(`console.error: ${t.slice(0, 300)}`);
  });
  return page;
}

async function die(code: number, msg: string): Promise<never> {
  console.error(`webgpu-trial: ${msg}`);
  await browser.close();
  stop();
  process.exit(code);
}

type AnyRow = Record<string, unknown>;
interface ArmRun {
  arm: { gpu: boolean; backend: string; unported: unknown[] };
  tick: number;
  cadence?: Record<string, unknown>;
  views?: { zoom: number; base: AnyRow; decor: Record<string, AnyRow> }[];
  curve?: { arm: { backend: string; unported: unknown[] }; points: { target: number; living: number; row: AnyRow }[] };
}

async function runViews(gpu: boolean): Promise<ArmRun> {
  const page = await newPage(1440, 900);
  const q = `?sandbox=${MAP}&envlight=0&grade=0&tod=day${gpu ? '&gpu=webgpu' : ''}`;
  await page.goto(`http://localhost:${port}/${q}`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window as unknown as { __lions?: { renderer?: unknown } }).__lions?.renderer, null, { timeout: 120000 });
  if (gpu) {
    await page
      .waitForFunction(() => (window as unknown as { __lions: { renderer: { gpuTrialState: string } } }).__lions.renderer.gpuTrialState !== 'pending', null, { timeout: 120000 })
      .catch(() => undefined);
    const st = await page.evaluate(() => {
      const r = (window as unknown as { __lions: { renderer: { gpuTrialState: string; gpuTrialReason: string } } }).__lions.renderer;
      return `${r.gpuTrialState}: ${r.gpuTrialReason}`;
    });
    if (!st.startsWith('active')) await die(3, `the WebGPU arm did not go active (${st}); the flag fell back to WebGL2 (that fallback is the behaviour under test elsewhere, not a measurement)`);
  }
  await page.waitForTimeout(4000);
  const run = await page.evaluate(
    async ({ mod, gpuArm, zooms, frames }) => {
      const m = (await import(/* @vite-ignore */ mod)) as typeof import('./webgpu-trial-page');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const L = (window as any).__lions;
      const r = L.renderer;
      const cadence = await m.cadence(r, zooms, 240);
      window.requestAnimationFrame = () => 0; // freeze the app's loop; the harness pumps frames
      const arm = m.prepareArm(r, gpuArm);
      const views = await m.measureViews(r, gpuArm, zooms, frames);
      return { arm, tick: Number(L.sim.tick ?? 0), cadence, views };
    },
    { mod: MODULE, gpuArm: gpu, zooms: ZOOMS, frames: FRAMES }
  );
  await page.close();
  return run as unknown as ArmRun;
}

async function runCurve(gpu: boolean): Promise<ArmRun['curve']> {
  const page = await newPage(1280, 720);
  await page.emulateMedia({ reducedMotion: 'reduce' }); // the menu draws its plate, not a second live renderer
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'load', timeout: 60000 });
  const out = await page.evaluate(
    async ({ mod, gpuArm, mapId, counts, frames }) => {
      const m = (await import(/* @vite-ignore */ mod)) as typeof import('./webgpu-trial-page');
      return m.runCurve({ mapId: mapId as never, counts, gpu: gpuArm, frames });
    },
    { mod: MODULE, gpuArm: gpu, mapId: MAP, counts: COUNTS, frames: FRAMES }
  );
  await page.close();
  return out as unknown as ArmRun['curve'];
}

const runs: { arm: 'gl' | 'gpu'; round: number; views: ArmRun; curve?: ArmRun['curve'] }[] = [];
for (let round = 0; round < ROUNDS; round++) {
  for (const gpu of [false, true, true, false]) {
    const tag = gpu ? 'gpu' : 'gl';
    console.log(`[webgpu-trial] round ${round + 1} arm ${tag} (loadavg ${os.loadavg().map((v) => v.toFixed(1)).join('/')})`);
    const views = await runViews(gpu);
    if (!gpu && /swiftshader|llvmpipe|software/i.test(views.arm.backend)) await die(2, `refusing to time on "${views.arm.backend}" (need hardware Metal)`);
    const curve = SKIP_CURVE ? undefined : await runCurve(gpu);
    runs.push({ arm: tag, round, views, curve });
  }
}

await browser.close();
stop();

const f = (x: unknown): string => (typeof x === 'number' ? x.toFixed(2) : String(x));
const rowOf = (r: AnyRow) => r as { synced: { med: number; p95: number }; cpuFrame: { med: number }; cpuRender: { med: number }; gpuWait: { med: number }; calls: number; tris: number; entries: number };
const summary: string[] = [];
const pad = (s: string, n: number): string => s.padEnd(n);
summary.push(`conditions: map=${MAP} viewport 1440x900 DPR ${DPR} (${1440 * DPR}x${900 * DPR}) quality high frames/cell ${FRAMES} rounds ${ROUNDS} (ABBA)`);
for (const r of runs) summary.push(`  ${r.arm}#${r.round} backend=${r.views.arm.backend} sim tick ${r.views.tick}`);
summary.push('\nGH-829 views, synced frame ms (median / p95), CPU render submit (median), GPU wait (median), calls, tris');
for (const z of ZOOMS) {
  for (const arm of ['gl', 'gpu'] as const) {
    const cells = runs.filter((r) => r.arm === arm).map((r) => rowOf(r.views.views!.find((v) => v.zoom === z)!.base));
    const m = (k: (c: ReturnType<typeof rowOf>) => number): number => cells.reduce((a, c) => a + k(c), 0) / cells.length;
    summary.push(
      `  z${pad(String(z), 4)} ${pad(arm, 4)} synced ${f(m((c) => c.synced.med))} / ${f(m((c) => c.synced.p95))}  cpuRender ${f(m((c) => c.cpuRender.med))}  gpuWait ${f(m((c) => c.gpuWait.med))}  calls ${f(m((c) => c.calls))}  tris ${f(m((c) => c.tris))}  entries ${f(m((c) => c.entries))}`
    );
  }
}
summary.push('\ndecor (synced median): hidden / cull on / cull off ; entries cull on / off');
for (const z of ZOOMS) {
  for (const arm of ['gl', 'gpu'] as const) {
    const ds = runs.filter((r) => r.arm === arm).map((r) => r.views.views!.find((v) => v.zoom === z)!.decor);
    const m = (k: string, g: (c: ReturnType<typeof rowOf>) => number): number => ds.reduce((a, d) => a + g(rowOf(d[k]!)), 0) / ds.length;
    summary.push(
      `  z${pad(String(z), 4)} ${pad(arm, 4)} ${f(m('hidden', (c) => c.synced.med))} / ${f(m('cullOn', (c) => c.synced.med))} / ${f(m('cullOff', (c) => c.synced.med))}  cpuRender ${f(m('hidden', (c) => c.cpuRender.med))} / ${f(m('cullOn', (c) => c.cpuRender.med))} / ${f(m('cullOff', (c) => c.cpuRender.med))}  entries ${f(m('cullOn', (c) => c.entries))} / ${f(m('cullOff', (c) => c.entries))}`
    );
  }
}
summary.push('\ncadence (rAF-to-rAF, app loop live): median / p95 / >20ms');
for (const z of ZOOMS) {
  for (const arm of ['gl', 'gpu'] as const) {
    const cs = runs.filter((r) => r.arm === arm).map((r) => (r.views.cadence as Record<string, { med: number; p95: number; over20: number }>)[`z${z}`]!);
    const m = (k: 'med' | 'p95' | 'over20'): number => cs.reduce((a, c) => a + c[k], 0) / cs.length;
    summary.push(`  z${pad(String(z), 4)} ${pad(arm, 4)} ${f(m('med'))} / ${f(m('p95'))} / ${f(m('over20') * 100)}%`);
  }
}
if (!SKIP_CURVE) {
  summary.push('\nfigure curve (z0.5, all-mesh roster, sim held still): synced median / p95, cpuRender, gpuWait, calls');
  for (const t of COUNTS) {
    for (const arm of ['gl', 'gpu'] as const) {
      const ps = runs.filter((r) => r.arm === arm).map((r) => r.curve!.points.find((p) => p.target === t)!);
      const m = (k: (c: ReturnType<typeof rowOf>) => number): number => ps.reduce((a, p) => a + k(rowOf(p.row)), 0) / ps.length;
      summary.push(
        `  n${pad(String(t), 4)} ${pad(arm, 4)} living ${ps[0]!.living}  synced ${f(m((c) => c.synced.med))} / ${f(m((c) => c.synced.p95))}  cpuRender ${f(m((c) => c.cpuRender.med))}  gpuWait ${f(m((c) => c.gpuWait.med))}  calls ${f(m((c) => c.calls))}`
      );
    }
  }
}
summary.push(`\nUNPORTED hooks warned (${unportedSeen.size}):`);
for (const l of unportedSeen.values()) summary.push('  ' + l.replace('[webgpu-trial] UNPORTED ', ''));
summary.push(`\npage errors (${errors.length}, first 12):`);
for (const e of [...new Set(errors)].slice(0, 12)) summary.push('  ' + e);
console.log(summary.join('\n'));
if (OUT) {
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ map: MAP, dpr: DPR, frames: FRAMES, rounds: ROUNDS, runs, unported: [...unportedSeen.values()], errors }, null, 2));
  writeFileSync(OUT.replace(/\.json$/, '.txt'), summary.join('\n'));
}
process.exit(0);
