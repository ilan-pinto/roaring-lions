/**
 * The P0 ABBA figure-curve runner (GH-943 WebGPU-primary, design section 6).
 *
 *   pnpm --filter @lions/tools webgpu:abba -- --port=5190 [--map=wadi_halam_4] [--counts=300,600] [--rounds=3] [--frames=80] [--out=<json>]
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
import { ARM_KIND, harnessRefusals, type ArmId, type ArmReading } from './webgpu-refusals';
import type { ArmRun, LegacyScene } from './webgpu-page';

const args = process.argv.slice(2);
const arg = (n: string, d: string): string => (args.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).slice(n.length + 3);
const root = path.resolve(arg('root', process.cwd().replace(/\/tools$/, '')));
const port = await claimPort('webgpu-abba', 'WEBGPU_ABBA_PORT', 5190);
const MAP = arg('map', 'wadi_halam_4');
const COUNTS = arg('counts', '300,600').split(',').map(Number);
const ROUNDS = Number(arg('rounds', '3'));
const FRAMES = Number(arg('frames', '80'));
const OUT = arg('out', '');
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

async function runOne(arm: ArmId): Promise<{ run: ArmRun; lines: string[]; gpu: string }> {
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
    async ({ mod, arm, mapId, counts, frames, legacyScene }) => {
      const m = (await import(/* @vite-ignore */ mod)) as typeof import('./webgpu-page');
      return m.runArm({ mapId: mapId as never, arm, counts, frames, viewFrames: 40, legacyScene });
    },
    { mod: MODULE, arm, mapId: MAP, counts: COUNTS, frames: FRAMES, legacyScene: LEGACY }
  )) as ArmRun;
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
out.push(`conditions: map=${MAP} 1280x720 DPR 2, z0.5, quality high, ${FRAMES} frames/point, ${ROUNDS} ABBA rounds, L ${LEGACY === 'matched' ? 'MATCHED to the node scene (the node census hidden set hidden, AO ON since P1 T7; fog/bloom/SMAA/grade still on L)' : 'shipped'}, music off, max-load ${MAX_LOAD}, loadavg per page ${Math.min(...loads.map((l) => l.load1m)).toFixed(2)}-${Math.max(...loads.map((l) => l.load1m)).toFixed(2)}, at end ${os.loadavg()[0]?.toFixed(2)}`);
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
console.log(out.join('\n'));
if (OUT) {
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ conditions: out[0], maxLoad: MAX_LOAD, legacyScene: LEGACY, loads, gpu: [...new Set(readings.map((r) => `${r.arm}=${r.gpu}`))], verdict, sample }, null, 2));
  writeFileSync(OUT.replace(/\.json$/, '.txt'), out.join('\n'));
}
process.exit(0);
