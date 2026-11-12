/**
 * The P0 ABBA figure-curve runner (GH-943 WebGPU-primary, design section 6).
 *
 *   pnpm --filter @lions/tools webgpu:abba -- --port=5190 [--map=wadi_halam_4] [--counts=300,600] [--rounds=3] [--frames=80] [--out=<json>]
 *       [--node-opts=refreshPolicy=three,matrixWalk=every-pass,uploads=three]   (GH-943 P3 T14b: the node arms' draw switches)
 *
 * Every round runs L against the test arm (`abbaOrder('L', test, round)`), so `--arms=G` still yields G against L.
 *
 * Arms L (legacy), F (node on WebGL2), G (node on WebGPU) run L-vs-F and L-vs-G in ABBA order, each on a FRESH page, hardware Metal
 * (ANGLE/Metal; WebGPU through Dawn/Metal), 1280x720 DPR 2, z0.5, music off. REFUSES (exit 2) when:
 *  - the 1-minute load average is above 4, or `--max-load=<n>` (checked before every run; the bar used is in the conditions),
 *  - fewer than 3 rounds are asked for,
 *  - any `harnessRefusals` entry holds (CPU render 0, a stubbed rAF, a validation error in the console, wrong backend, ...),
 *  - the browser is on SwiftShader (this measures SPEED; a player never runs on it).
 * Reports the median of the round medians and the spread; a difference inside the spread is "no difference".
 *
 * ONE Metal browser, on the port given. Starts its own dev server and stops only that one.
 */
import { chromium, type Page } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { devServerStopper, ensureDevServer } from '../golden-diff/browser';
import { musicOffInitScript } from '../ui-review/music-off';
import { claimPort } from '../ui-review/port';
import { MAX_LOADAVG_1M, abbaOrder, barMet, compare, loadRefusal, roundsRefusal, summarise } from './webgpu-abba';
import { grassColumnRefusals, grassCondition, hiddenRefusal, type GrassMode } from './webgpu-grass-lib';
import { ARM_KIND, harnessRefusals, type ArmId, type ArmReading } from './webgpu-refusals';
import type { ArmRun, LegacyScene } from './webgpu-page';
import { parseNodeDraw, resolveNodeDraw, type NodeDrawOptions } from '../../../packages/render/src/three/backend/node-draw-options';

const args = process.argv.slice(2);
const arg = (n: string, d: string): string => (args.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).slice(n.length + 3);
const root = path.resolve(arg('root', process.cwd().replace(/\/tools$/, '')));
const port = await claimPort('webgpu-abba', 'WEBGPU_ABBA_PORT', 5190);
const MAP = arg('map', 'wadi_halam_4');
const COUNTS = arg('counts', '300,600').split(',').map(Number);
const ROUNDS = Number(arg('rounds', '3'));
const FRAMES = Number(arg('frames', '80'));
const OUT = arg('out', '');
// GH-1167 S6: `--grass` adds the grass COLUMN: G with the 3D grass field on against G with it off, in ABBA order on fresh pages. Without it every
// L-vs-G reading hides the grass (`grass: hidden`), so the like-for-like comparison, and the GH-1152 ratio, are unchanged.
const GRASS = args.includes('--grass');
/** The grass budget's zooms (design 5.1): z0.5 is the figure points, these are the view probes. */
const GRASS_VIEW_ZOOMS = [1, 1.5, 2.5];
const ARMS = arg('arms', 'F,G').split(',') as ('F' | 'G')[];
// `--max-load=<n>`: the 1-minute load-average bar (default MAX_LOADAVG_1M, 4, the design's figure). Raising it is a stated
// condition, never a silent one: the value used is printed in the conditions line and written to the JSON.
const MAX_LOAD = Number(arg('max-load', String(MAX_LOADAVG_1M)));
// `--legacy=matched|shipped`: what L is timed as (`LegacyScene` in webgpu-page.ts). `matched`, the default, is legacy drawing the
// P0 node chain's scene, so the triangle refusal can pass; `shipped` is the player's frame, which P0's node arms cannot match.
const LEGACY = arg('legacy', 'matched') as LegacyScene;
if (LEGACY !== 'matched' && LEGACY !== 'shipped') refuse(`--legacy=${LEGACY}: expected matched or shipped`);
if (!(MAX_LOAD > 0)) refuse(`--max-load=${arg('max-load', '')} is not a positive number`);
const MODULE = `/@fs${root}/tools/src/perf/webgpu-page.ts`;
// GH-943 P3 T14b: `--node-opts=k=v,...`, the node draw switches for the F and G arms only (L never gets them). A typo refuses.
let NODE_DRAW: NodeDrawOptions = {};
try {
  NODE_DRAW = parseNodeDraw(arg('node-opts', ''));
} catch (e) {
  refuse((e as Error).message);
}

function refuse(msg: string): never {
  console.error(`webgpu-abba: REFUSED: ${msg}`);
  process.exit(2);
}

// `--wait-quiet=<minutes>`: before EACH run, wait up to that long for the 1-minute load average to reach the bar instead of refusing
// at once. The refusal itself is unchanged (a run never starts on a loaded machine); this only keeps a 24-run job from dying on the
// first neighbour's spike. 0 (the default) refuses immediately.
const WAIT_QUIET_MIN = Number(arg('wait-quiet', '0'));
async function untilQuiet(): Promise<string | null> {
  const deadline = Date.now() + WAIT_QUIET_MIN * 60_000;
  for (;;) {
    const lr = loadRefusal(os.loadavg()[0] as number, MAX_LOAD);
    if (lr === null) return null;
    if (Date.now() >= deadline) return lr;
    await new Promise((res) => setTimeout(res, 5000));
  }
}

const rr = roundsRefusal(ROUNDS);
if (rr !== null) refuse(rr);
const lr0 = await untilQuiet();
if (lr0 !== null) refuse(lr0);

const stop = devServerStopper(await ensureDevServer(port, root, 'webgpu-abba'), 'webgpu-abba');
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--use-gl=angle', '--enable-gpu-rasterization', '--disable-gpu-sandbox', '--enable-unsafe-webgpu'],
});
const consoleLines: string[] = [];

async function runOne(arm: ArmId, grass: GrassMode = 'hidden', viewZooms: number[] | null = null): Promise<{ run: ArmRun; lines: string[]; gpu: string }> {
  const lines: string[] = [];
  const page: Page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  await page.addInitScript(musicOffInitScript({}, { quality: 'high' }));
  await page.addInitScript('window.__name = (f) => f; window.process = { env: {} };');
  page.on('pageerror', (e) => lines.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') lines.push(m.text());
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'load', timeout: 60000 });
  const glRenderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext ? String(gl?.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  });
  const run = (await page.evaluate(
    async ({ mod, arm, mapId, counts, frames, legacyScene, nodeDraw, grass, viewZooms }) => {
      const m = (await import(/* @vite-ignore */ mod)) as typeof import('./webgpu-page');
      return m.runArm({ mapId: mapId as never, arm, counts, frames, viewFrames: 40, legacyScene, grass, ...(viewZooms === null ? {} : { viewZooms }), ...(arm === 'L' || nodeDraw === null ? {} : { nodeDraw }) });
    },
    { mod: MODULE, arm, mapId: MAP, counts: COUNTS, frames: FRAMES, legacyScene: LEGACY, nodeDraw: Object.keys(NODE_DRAW).length === 0 ? null : NODE_DRAW, grass, viewZooms }
  )) as ArmRun;
  const hr = hiddenRefusal(`arm ${arm}`, grass === 'hidden' ? run.grass.meshes : 0);
  if (run.grass.mode !== grass) refuse(`arm ${arm}: asked for ${grassCondition(grass)}, the page booted with ${grassCondition(run.grass.mode)}`);
  if (hr !== null) refuse(hr);
  await page.close();
  return { run, lines, gpu: arm === 'G' ? run.adapter : glRenderer };
}

const results = new Map<ArmId, { target: number; synced: number[][]; cpuRender: number[][] }[]>();
const readings: ArmReading[] = [];
/** The 1-minute load average at the start of every fresh page, a stated condition of the result. */
const loads: { test: string; round: number; arm: ArmId; load1m: number }[] = [];
const sample: Record<string, ArmRun> = {};

for (const test of ARMS) {
  for (let round = 0; round < ROUNDS; round++) {
    const order = abbaOrder<ArmId>('L', test, round);
    console.log(`[webgpu-abba] ${test} round ${round + 1}/${ROUNDS} order ${order.join('')} loadavg ${os.loadavg().map((v) => v.toFixed(2)).join('/')}`);
    const perArmRound = new Map<ArmId, { target: number; synced: number[]; cpuRender: number[] }[]>();
    for (const arm of order) {
      // Checked before EVERY fresh page: load drifts, and a run that starts loaded measures the load.
      const lr = await untilQuiet();
      if (lr !== null) {
        await browser.close();
        stop();
        refuse(lr);
      }
      const load1 = os.loadavg()[0] as number;
      const { run, lines, gpu } = await runOne(arm);
      loads.push({ test, round: round + 1, arm, load1m: Number(load1.toFixed(2)) });
      consoleLines.push(...lines);
      sample[`${arm}`] = run;
      readings.push({
        arm,
        backendKind: run.backendKind,
        rafSource: run.rafSource,
        gpu,
        consoleLines: lines,
        views: run.views.map((v) => ({ zoom: v.zoom, cpuRenderMs: v.cpuRenderMs, syncedMs: v.syncedMs, cpuFrameMs: v.cpuFrameMs, triangles: v.triangles, frameTriangles: v.frameTriangles, entriesCullOn: v.entriesCullOn, entriesCullOff: v.entriesCullOff })),
        timestampQueryAvailable: false,
      });
      const acc = perArmRound.get(arm) ?? run.points.map((p) => ({ target: p.target, synced: [] as number[], cpuRender: [] as number[] }));
      run.points.forEach((p, i) => {
        acc[i]?.synced.push(p.row.synced.med);
        acc[i]?.cpuRender.push(p.row.cpuRender.med);
      });
      perArmRound.set(arm, acc);
    }
    for (const [arm, acc] of perArmRound) {
      const cur = results.get(arm) ?? acc.map((a) => ({ target: a.target, synced: [] as number[][], cpuRender: [] as number[][] }));
      acc.forEach((a, i) => {
        cur[i]?.synced.push(a.synced);
        cur[i]?.cpuRender.push(a.cpuRender);
      });
      results.set(arm, cur);
    }
  }
}
// GH-1167 S6: the grass column, G with the field on against G with it off, ABBA on fresh pages (the same quiet-machine rules). The
// L-vs-G rows above hid the grass; this is its cost on its own.
const grassRes = new Map<'on' | 'off', { target: number; synced: number[][]; p95: number[][] }[]>();
const grassViews = new Map<'on' | 'off', { zoom: number; synced: number[][]; p95: number[][]; triangles: number }[]>();
const grassSample: Partial<Record<'on' | 'off', ArmRun>> = {};
if (GRASS) {
  if (!ARMS.includes('G')) refuse('--grass reads G: --arms must include G');
  for (let round = 0; round < ROUNDS; round++) {
    const order = abbaOrder<'on' | 'off'>('off', 'on', round);
    console.log(`[webgpu-abba] grass column round ${round + 1}/${ROUNDS} order ${order.join(',')} loadavg ${os.loadavg().map((v) => v.toFixed(2)).join('/')}`);
    const acc = new Map<'on' | 'off', { pts: { target: number; synced: number[]; p95: number[] }[]; views: Map<number, { synced: number[]; p95: number[]; triangles: number }> }>();
    for (const mode of order) {
      const lr = await untilQuiet();
      if (lr !== null) {
        await browser.close();
        stop();
        refuse(lr);
      }
      const load1 = os.loadavg()[0] as number;
      const { run, lines } = await runOne('G', mode, GRASS_VIEW_ZOOMS);
      loads.push({ test: `grass-${mode}`, round: round + 1, arm: 'G', load1m: Number(load1.toFixed(2)) });
      consoleLines.push(...lines);
      grassSample[mode] = run;
      const a = acc.get(mode) ?? { pts: run.points.map((p) => ({ target: p.target, synced: [] as number[], p95: [] as number[] })), views: new Map() };
      run.points.forEach((p, i) => {
        a.pts[i]?.synced.push(p.row.synced.med);
        a.pts[i]?.p95.push(p.row.synced.p95);
      });
      for (const v of run.views) {
        const cur = a.views.get(v.zoom) ?? { synced: [], p95: [], triangles: v.triangles };
        cur.synced.push(v.syncedMs);
        cur.p95.push(v.syncedP95Ms);
        a.views.set(v.zoom, cur);
      }
      acc.set(mode, a);
    }
    for (const [mode, a] of acc) {
      const cur = grassRes.get(mode) ?? a.pts.map((p) => ({ target: p.target, synced: [] as number[][], p95: [] as number[][] }));
      a.pts.forEach((p, i) => {
        cur[i]?.synced.push(p.synced);
        cur[i]?.p95.push(p.p95);
      });
      grassRes.set(mode, cur);
      const cv = grassViews.get(mode) ?? [...a.views].map(([zoom, v]) => ({ zoom, synced: [] as number[][], p95: [] as number[][], triangles: v.triangles }));
      for (const [zoom, v] of a.views) {
        const e = cv.find((x) => x.zoom === zoom);
        e?.synced.push(v.synced);
        e?.p95.push(v.p95);
      }
      grassViews.set(mode, cv);
    }
  }
}

await browser.close();
stop();

// The refusals judge ONE reading per arm (the last), except the console, which is the union over the arm's runs.
const refusals = harnessRefusals(
  (['L', ...ARMS] as ArmId[]).map((arm) => {
    const mine = readings.filter((r) => r.arm === arm);
    const last = mine[mine.length - 1] as ArmReading;
    return { ...last, consoleLines: mine.flatMap((r) => r.consoleLines) };
  })
);
if (refusals.length > 0) refuse(`\n  ${refusals.join('\n  ')}`);

const out: string[] = [];
out.push(`conditions: map=${MAP} 1280x720 DPR 2, z0.5, quality high, ${FRAMES} frames/point, ${ROUNDS} ABBA rounds, L ${LEGACY === 'matched' ? 'MATCHED to the node scene (the node census hidden set hidden, AO ON since P1 T7; fog/bloom/SMAA/grade still on L)' : 'shipped'}, music off, node draw ${JSON.stringify(resolveNodeDraw(NODE_DRAW))}, ${grassCondition('hidden')} on the L-vs-G rows${GRASS ? ' (the grass column is G on against G off below)' : ''}, max-load ${MAX_LOAD}, loadavg per page ${Math.min(...loads.map((l) => l.load1m)).toFixed(2)}-${Math.max(...loads.map((l) => l.load1m)).toFixed(2)}, at end ${os.loadavg()[0]?.toFixed(2)}`);
out.push(`  gpu: ${[...new Set(readings.map((r) => `${r.arm}=${r.gpu}`))].join('; ')}`);
for (const arm of ['L', ...ARMS] as ArmId[])
  out.push(
    `  ${arm}: ${ARM_KIND[arm]} (${sample[arm]?.adapter}), unported hooks ${sample[arm]?.unportedCount}; ` +
      (sample[arm]?.views ?? []).map((v) => `z${v.zoom}: tris ${v.triangles} (frame ${v.frameTriangles}), entries ${v.entriesCullOn}/${v.entriesCullOff}, render ${v.cpuRenderMs.toFixed(2)} ms`).join('; ')
  );
const verdict: Record<string, unknown>[] = [];
for (const test of ARMS) {
  for (const [i, target] of COUNTS.entries()) {
    const l = summarise(results.get('L')?.[i]?.synced ?? []);
    const t = summarise(results.get(test)?.[i]?.synced ?? []);
    const c = compare(l, t);
    const lc = summarise(results.get('L')?.[i]?.cpuRender ?? []);
    const tc = summarise(results.get(test)?.[i]?.cpuRender ?? []);
    const met = barMet(test, c);
    out.push(
      `  n${target} ${test} vs L: synced ${t.value.toFixed(2)} vs ${l.value.toFixed(2)} ms (x${c.ratio.toFixed(3)}, spread ${t.spread.toFixed(2)}/${l.spread.toFixed(2)}, ${c.withinSpread ? 'inside spread' : 'outside spread'}); ` +
        `cpuRender ${tc.value.toFixed(2)} vs ${lc.value.toFixed(2)} ms (x${(tc.value / lc.value).toFixed(2)}); bar ${test === 'G' ? 1.05 : 1.1} ${met ? 'MET' : 'NOT MET'}`
    );
    verdict.push({ test, target, l, t, ratio: c.ratio, withinSpread: c.withinSpread, cpuRenderL: lc.value, cpuRenderT: tc.value, met });
  }
}
if (GRASS) {
  const gon = grassSample.on as ArmRun;
  const goff = grassSample.off as ArmRun;
  const gr = grassColumnRefusals({ mode: 'on', meshes: gon.grass.meshes, views: gon.views }, { mode: 'off', meshes: goff.grass.meshes, views: goff.views });
  if (gr.length > 0) refuse(`the grass column: ${gr.join('; ')}`);
  out.push(`grass column (G on against G off, ${ROUNDS} ABBA rounds on fresh pages; budget per design 5.1: median <= +1.0 ms, p95 <= +1.5 ms at every zoom): grass ${grassCondition('on')} vs ${grassCondition('off')}`);
  for (const [i, target] of COUNTS.entries()) {
    const on = summarise(grassRes.get('on')?.[i]?.synced ?? []);
    const off = summarise(grassRes.get('off')?.[i]?.synced ?? []);
    const on95 = summarise(grassRes.get('on')?.[i]?.p95 ?? []);
    const off95 = summarise(grassRes.get('off')?.[i]?.p95 ?? []);
    out.push(`  n${target} z0.5: G on ${on.value.toFixed(2)} vs off ${off.value.toFixed(2)} ms (delta ${(on.value - off.value).toFixed(2)}, spread ${on.spread.toFixed(2)}/${off.spread.toFixed(2)}); p95 ${on95.value.toFixed(2)} vs ${off95.value.toFixed(2)} (delta ${(on95.value - off95.value).toFixed(2)})`);
    verdict.push({ grassColumn: true, target, zoom: 0.5, on, off, on95, off95, deltaMed: on.value - off.value, deltaP95: on95.value - off95.value });
  }
  for (const v of grassViews.get('on') ?? []) {
    const o = grassViews.get('off')?.find((x) => x.zoom === v.zoom);
    const on = summarise(v.synced);
    const off = summarise(o?.synced ?? []);
    const on95 = summarise(v.p95);
    const off95 = summarise(o?.p95 ?? []);
    out.push(`  last count z${v.zoom}: G on ${on.value.toFixed(2)} vs off ${off.value.toFixed(2)} ms (delta ${(on.value - off.value).toFixed(2)}, spread ${on.spread.toFixed(2)}/${off.spread.toFixed(2)}); p95 ${on95.value.toFixed(2)} vs ${off95.value.toFixed(2)} (delta ${(on95.value - off95.value).toFixed(2)}); tris ${v.triangles} vs ${o?.triangles}`);
    verdict.push({ grassColumn: true, zoom: v.zoom, on, off, on95, off95, deltaMed: on.value - off.value, deltaP95: on95.value - off95.value });
  }
}
console.log(out.join('\n'));
if (OUT) {
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ conditions: out[0], maxLoad: MAX_LOAD, legacyScene: LEGACY, nodeDraw: resolveNodeDraw(NODE_DRAW), loads, gpu: [...new Set(readings.map((r) => `${r.arm}=${r.gpu}`))], verdict, sample }, null, 2));
  writeFileSync(OUT.replace(/\.json$/, '.txt'), out.join('\n'));
}
process.exit(0);
