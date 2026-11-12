/**
 * GH-943 P3 T13 (GH-1152): the draw-submission probe. A FINDING, not a gate: the hypothesis table (H1-H6), the per-pass and per-type
 * tallies, and the lever T14 takes. Everything it decides is in `webgpu-submit-probe-lib.ts`; the page half is `webgpu-page.ts`'s
 * `submit*`.
 *
 *   pnpm --filter @lions/tools exec tsx src/perf/webgpu-submit-probe.ts --out-dir=<dir> [--hw=swiftshader|metal] [--arms=L,G]
 *       [--counts=300,600] [--map=wadi_halam_4] [--port=5197]
 *   Metal only: --lock=<BROWSER.lock dir> [--rounds=6] [--frames=80] [--max-load=4] [--wait-quiet=0] [--profile-frames=60]
 *       [--gpu-frames=40] [--skip=profile,gpu] [--before-root=<P2 tree checkout> --before-port=5198]
 *   T14b: [--node-opts=refreshPolicy=three|parked,matrixWalk=every-pass|once,uploads=three|versioned] boots every NODE page with those
 *       switches (`node-draw-options.ts`); H10 (the 1205 uploads) is a second run with `--node-opts=uploads=three`. H7-H9 are
 *       toggles on every page; G2a (`parkedRefreshRefusals`) refuses a run where the parked policy cut no FULL refresh.
 *
 * SwiftShader (CI, `webgpu-noise.yml probe=submit`): COUNTS ONLY, one fresh page per arm: every variant at every count, the stats
 * frame's per-pass calls/objects, the per-type draws, the FULL refreshes per type on the node arms (H2), and one profile window on G
 * (G3 runs everywhere). No timing: a SwiftShader millisecond is not a player's.
 * Metal (one lock hold): the same readings TIMED, in ABBA rounds L/G on fresh pages (load <= 4 checked before every page, >= 3 rounds,
 * median of round medians and its spread: `webgpu-abba.ts`); then a CDP profile window per arm at the high count; then a
 * timestamp-query page on G (`RendererOptions.timestamps`: GPU time, never mixed into the CPU timing); then, with --before-root, H6: G
 * on the integration tree against G on the P2 tree (each tree's own `runArm`, ABBA).
 *
 * REFUSES (exit 2): a backend that is not the arm's; Metal without --lock or on a non-Metal adapter; a loaded machine (Metal);
 * a console GPUValidationError; per-pass calls that do not add up (G1); a toggle hypothesis that moved nothing (G2); an empty profile
 * (G3); a toggle hypothesis never read.
 */
import { chromium, type Browser, type Page } from 'playwright';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { devServerStopper, ensureDevServer } from '../golden-diff/browser';
import { musicOffInitScript } from '../ui-review/music-off';
import { parseNodeDraw, resolveNodeDraw, type NodeDrawOptions } from '../../../packages/render/src/three/backend/node-draw-options';
import { claimPort, portBusy } from '../ui-review/port';
import { gpuLaunchArgs } from '../ui-review/gpu';
import { resolveCensusGpu } from './bloom-census-args';
import { MAX_LOADAVG_1M, abbaOrder, loadRefusal, roundsRefusal, summarise, type ArmSummary } from './webgpu-abba';
import { ARM_KIND } from './webgpu-refusals';
import { grassCondition, hiddenRefusal, type GrassState } from './webgpu-grass-lib';
import type { CpuProfile } from './cpu-profile';
import type { ArmRun } from './webgpu-page';
import {
  HYPOTHESIS_NAME,
  VARIANTS,
  countsRefusal,
  deadHypotheses,
  hypothesisRows,
  hypothesisTable,
  missingHypotheses,
  perPassRefusals,
  parkedRefreshRefusals,
  profileRefusal,
  profileTopOf,
  recommendLever,
  settledByCount,
  tallyTable,
  timedCells,
  unsettledRefusals,
  type BeforeAfter,
  type ProfileTop,
  type SubmitArm,
  type SubmitReading,
  type VariantId,
} from './webgpu-submit-probe-lib';

const args = process.argv.slice(2);
const arg = (n: string, d: string): string => (args.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).slice(n.length + 3);
const TOOLS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ROOT = path.resolve(TOOLS, '..');
const HW = arg('hw', 'swiftshader');
const ARMS = arg('arms', 'L,G').split(',') as SubmitArm[];
const COUNTS = arg('counts', '300,600').split(',').map(Number);
const MAP = arg('map', 'wadi_halam_4');
const OUT = path.resolve(arg('out-dir', ''));
const ROUNDS = Number(arg('rounds', '6'));
const FRAMES = Number(arg('frames', '80'));
const MAX_LOAD = Number(arg('max-load', String(MAX_LOADAVG_1M)));
const WAIT_QUIET = Number(arg('wait-quiet', '0'));
const PROFILE_FRAMES = Number(arg('profile-frames', HW === 'metal' ? '60' : '8'));
const GPU_FRAMES = Number(arg('gpu-frames', '40'));
const LOCK = arg('lock', '');
const BEFORE_ROOT = arg('before-root', '');
const BEFORE_PORT = Number(arg('before-port', '5198'));
const SKIP = new Set(arg('skip', '').split(',').filter((s) => s !== ''));
let NODE_DRAW: NodeDrawOptions = {};
try {
  NODE_DRAW = parseNodeDraw(arg('node-opts', ''));
} catch (e) {
  console.error(`webgpu-submit-probe: REFUSED: ${(e as Error).message}`);
  process.exit(2);
}
const METAL = HW === 'metal';
const DPR = METAL ? 2 : 1;
const VIEWPORT = { width: 1280, height: 720 };
/** Warm-up frames after a spawn (one more than the node census period, so a census ran since the spawn), and after a toggle alone. */
const WARM_AFTER_SPAWN = 61;
const WARM_AFTER_TOGGLE = METAL ? 20 : 3;
const MODULE = (root: string): string => `/@fs${root}/tools/src/perf/webgpu-page.ts`;

function refuse(msg: string): never {
  console.error(`webgpu-submit-probe: REFUSED: ${msg}`);
  process.exit(2);
}
if (args.find((a) => a.startsWith('--out-dir=')) === undefined) refuse('--out-dir=<dir> is required');
if (HW !== 'metal' && HW !== 'swiftshader') refuse(`--hw=${HW}: expected metal or swiftshader`);
for (const a of ARMS) if (a !== 'L' && a !== 'G' && a !== 'F') refuse(`--arms: ${a} is not L, F or G`);
if (!ARMS.includes('L') || !ARMS.includes('G')) refuse('--arms must include L and G (every hypothesis is read on both)');
{
  const cr = countsRefusal(COUNTS);
  if (cr !== null) refuse(cr);
}
if (METAL) {
  if (LOCK === '' || !existsSync(LOCK)) refuse('--lock=<dir> must name the BROWSER.lock directory the caller holds (mkdir it first)');
  const rr = roundsRefusal(ROUNDS);
  if (rr !== null) refuse(rr);
}
if (BEFORE_ROOT !== '' && !METAL) refuse('--before-root (H6) is a timing and runs on the Metal hold only');
mkdirSync(OUT, { recursive: true });

const loads: { at: string; load1m: number }[] = [];
async function untilQuiet(at: string): Promise<number> {
  const deadline = Date.now() + WAIT_QUIET * 60_000;
  for (;;) {
    const l = os.loadavg()[0] as number;
    if (!METAL || loadRefusal(l, MAX_LOAD) === null) {
      loads.push({ at, load1m: Number(l.toFixed(2)) });
      return l;
    }
    if (Date.now() >= deadline) refuse(loadRefusal(l, MAX_LOAD) as string);
    await new Promise((res) => setTimeout(res, 5000));
  }
}

const BAD_CONSOLE = [/GPUValidationError/i, /Destroyed texture/i, /uploaded again/i];
const consoleLines: string[] = [];
/** What every page booted with (GH-1167 S6): printed in the conditions, so the line is the page's word. */
const grassStates: GrassState[] = [];
const refusals: string[] = [];
const notes: string[] = [];

interface Opened {
  page: Page;
  lines: string[];
  backendKind: string;
  adapter: string;
  gpu: string;
}

async function openPage(browser: Browser, port: number, root: string, arm: SubmitArm, timestamps: boolean, label: string): Promise<Opened> {
  const load = await untilQuiet(`${label} ${arm}`);
  console.log(`[submit-probe] ${label} ${arm}: loadavg ${load.toFixed(2)}`);
  const lines: string[] = [];
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: DPR });
  await page.addInitScript(musicOffInitScript({}, { quality: 'high' }));
  await page.addInitScript('window.__name = (f) => f; window.process = { env: {} };');
  page.on('pageerror', (e) => lines.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') lines.push(m.text());
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'load', timeout: 120_000 });
  const gl = await page.evaluate(() => {
    const c = document.createElement('canvas').getContext('webgl2');
    const ext = c?.getExtension('WEBGL_debug_renderer_info');
    return ext ? String(c?.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  });
  const capacity = Math.max(...COUNTS) + 50;
  const info = (await page.evaluate(
    async ({ mod, arm, mapId, capacity: cap, timestamps: ts, nodeDraw }) => {
      const m = (await import(/* @vite-ignore */ mod)) as typeof import('./webgpu-page');
      return m.submitSetup({ mapId: mapId as never, arm, capacity: cap, timestamps: ts, nodeDraw });
    },
    { mod: MODULE(root), arm, mapId: MAP, capacity, timestamps, nodeDraw: NODE_DRAW }
  )) as { backendKind: string; adapter: string; rafSource: string; drawSwitches?: string; grass: GrassState };
  grassStates.push(info.grass);
  {
    const hr = hiddenRefusal(`${label} ${arm}`, info.grass.meshes);
    if (info.grass.mode !== 'hidden') refuse(`${label} ${arm}: the page booted with ${grassCondition(info.grass.mode)}; the L-vs-G readings hide the grass (GH-1167 S6)`);
    if (hr !== null) refuse(hr);
  }
  if (arm !== 'L') console.log(`[submit-probe] ${label} ${arm} node draw switches: ${info.drawSwitches ?? 'n/a (an older tree)'}`);
  const gpu = arm === 'G' ? info.adapter : gl;
  if (info.backendKind !== ARM_KIND[arm]) refuse(`${label} ${arm}: backendInfo().kind is "${info.backendKind}", expected "${ARM_KIND[arm]}" (a fallback is evidence about the fallback)`);
  if (METAL && (!/metal|apple/i.test(gpu) || /swiftshader/i.test(gpu))) refuse(`${label} ${arm}: draws on "${gpu}", not hardware Metal`);
  return { page, lines, backendKind: info.backendKind, adapter: info.adapter, gpu };
}

async function closePage(o: Opened): Promise<void> {
  await o.page.evaluate(async (mod) => {
    const m = (await import(/* @vite-ignore */ mod)) as typeof import('./webgpu-page');
    m.submitDispose();
  }, MODULE(ROOT));
  consoleLines.push(...o.lines);
  await o.page.close();
}

async function measure(o: Opened, n: number, variant: VariantId, frames: number, warmFrames: number, gpuFrames: number): Promise<SubmitReading> {
  return (await o.page.evaluate(
    async ({ mod, p }) => {
      const m = (await import(/* @vite-ignore */ mod)) as typeof import('./webgpu-page');
      return m.submitMeasure(p);
    },
    { mod: MODULE(ROOT), p: { n, variant, frames, warmFrames, gpuFrames } }
  )) as SubmitReading;
}

/** Every variant at every count on one page, in order (the first reading after a spawn gets the long warm-up). */
async function allReadings(o: Opened, frames: number, gpuFrames: number): Promise<SubmitReading[]> {
  const out: SubmitReading[] = [];
  for (const n of COUNTS) {
    let first = true;
    for (const v of VARIANTS) {
      const r = await measure(o, n, v.id, frames, first ? WARM_AFTER_SPAWN : WARM_AFTER_TOGGLE, gpuFrames);
      first = false;
      out.push(r);
      console.log(`[submit-probe]   ${r.arm} n${n} ${v.id}: settled in ${r.settleFrames}${r.settled ? '' : ' (NOT SETTLED)'}, calls ${r.calls}, tris ${r.triangles}, applied ${r.applied}${r.cpuRenderMs === null ? '' : `, cpuRender ${r.cpuRenderMs.toFixed(2)} ms (census ${r.censusMs?.toFixed(3)})`}${r.gpuMs === null ? '' : `, gpu ${r.gpuMs.toFixed(2)} ms`}`);
    }
  }
  return out;
}

/** One CDP profile window over `PROFILE_FRAMES` timed frames at the high count, base scene. */
async function profileWindow(o: Opened, arm: SubmitArm): Promise<{ top: ProfileTop[]; refusal: string | null; samples: number }> {
  const hi = Math.max(...COUNTS);
  await measure(o, hi, 'base', 0, WARM_AFTER_SPAWN, 0);
  const cdp = await o.page.context().newCDPSession(o.page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
  await cdp.send('Profiler.start');
  await o.page.evaluate(
    async ({ mod, frames }) => {
      const m = (await import(/* @vite-ignore */ mod)) as typeof import('./webgpu-page');
      return m.submitTimeOnly(frames);
    },
    { mod: MODULE(ROOT), frames: PROFILE_FRAMES }
  );
  const { profile } = (await cdp.send('Profiler.stop')) as unknown as { profile: CpuProfile };
  await cdp.detach();
  writeFileSync(path.join(OUT, `profile-${arm}-n${hi}.cpuprofile`), JSON.stringify(profile));
  const refusal = profileRefusal(profile, `profile ${arm} n${hi}`);
  return { top: refusal === null ? profileTopOf(profile) : [], refusal, samples: profile?.samples?.length ?? 0 };
}

async function launch(arm: SubmitArm): Promise<Browser> {
  if (METAL) return chromium.launch({ headless: true, args: [...gpuLaunchArgs('metal'), '--enable-unsafe-webgpu'] });
  const gpu = resolveCensusGpu([`--gpu=${arm === 'L' ? 'legacy' : arm === 'G' ? 'webgpu' : 'webgl2'}`, '--hw=swiftshader'], process.platform);
  return chromium.launch(gpu.launchArgs.length === 0 ? { headless: true } : { headless: true, args: gpu.launchArgs });
}

const startedAt = new Date().toISOString();
const port = await claimPort('webgpu-submit-probe', 'WEBGPU_SUBMIT_PROBE_PORT', 5197);
await untilQuiet('start');
const stop = devServerStopper(await ensureDevServer(port, ROOT, 'webgpu-submit-probe'), 'webgpu-submit-probe');
const pages: { round: number; arm: SubmitArm; readings: SubmitReading[] }[] = [];
const backends: { arm: SubmitArm; backendKind: string; gpu: string }[] = [];
const profiles: Record<string, { top: ProfileTop[]; samples: number }> = {};
let gpuReadings: SubmitReading[] = [];
let beforeAfter: BeforeAfter[] | null = null;
/** The two trees' heads, named in the finding (P2 ruling R15). */
const headOf = (root: string): string => {
  try {
    return execFileSync('/usr/bin/git', ['-C', root, 'rev-parse', '--short=9', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
};
const beforeShas = BEFORE_ROOT === '' ? '' : ` (after ${headOf(ROOT)}, before ${headOf(BEFORE_ROOT)})`;

try {
  if (!METAL) {
    // Counts only: one fresh browser and page per arm.
    for (const arm of ARMS) {
      const browser = await launch(arm);
      try {
        const o = await openPage(browser, port, ROOT, arm, false, 'counts');
        backends.push({ arm, backendKind: o.backendKind, gpu: o.gpu });
        pages.push({ round: 0, arm, readings: await allReadings(o, 0, 0) });
        if (arm === 'G' && !SKIP.has('profile')) {
          const p = await profileWindow(o, arm);
          if (p.refusal !== null) refusals.push(p.refusal);
          profiles[arm] = { top: p.top, samples: p.samples };
        }
        await closePage(o);
      } finally {
        await browser.close();
      }
    }
  } else {
    const browser = await launch('G');
    try {
      for (let round = 0; round < ROUNDS; round++) {
        const order = abbaOrder<SubmitArm>('L', 'G', round);
        console.log(`[submit-probe] round ${round + 1}/${ROUNDS} order ${order.join('')}`);
        for (const arm of order) {
          const o = await openPage(browser, port, ROOT, arm, false, `round ${round + 1}`);
          backends.push({ arm, backendKind: o.backendKind, gpu: o.gpu });
          pages.push({ round, arm, readings: await allReadings(o, FRAMES, 0) });
          await closePage(o);
        }
      }
      if (!SKIP.has('profile')) {
        for (const arm of ['L', 'G'] as const) {
          const o = await openPage(browser, port, ROOT, arm, false, 'profile');
          const p = await profileWindow(o, arm);
          if (p.refusal !== null) refusals.push(p.refusal);
          profiles[arm] = { top: p.top, samples: p.samples };
          await closePage(o);
        }
      }
      if (!SKIP.has('gpu')) {
        const o = await openPage(browser, port, ROOT, 'G', true, 'gpu');
        gpuReadings = await allReadings(o, 0, GPU_FRAMES);
        if (gpuReadings.every((r) => r.gpuMs === null)) notes.push('GPU time: the adapter gave no timestamp-query reading (gpuMs null on every reading)');
        await closePage(o);
      }
      if (BEFORE_ROOT !== '') {
        // H6: G on the integration tree against G on the P2 tree, each tree's own `runArm` (the P2 tree's cpuRender includes the census,
        // which H5 measures), ABBA, base scene only.
        if (await portBusy(BEFORE_PORT)) refuse(`--before-port=${BEFORE_PORT} is already in use`);
        const stopBefore = devServerStopper(await ensureDevServer(BEFORE_PORT, BEFORE_ROOT, 'webgpu-submit-probe-before'), 'webgpu-submit-probe-before');
        try {
          const per = new Map<string, number[][]>();
          for (let round = 0; round < ROUNDS; round++) {
            for (const which of abbaOrder<'before' | 'after'>('before', 'after', round)) {
              await untilQuiet(`h6 round ${round + 1} ${which}`);
              const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: DPR });
              await page.addInitScript(musicOffInitScript({}, { quality: 'high' }));
              await page.addInitScript('window.__name = (f) => f; window.process = { env: {} };');
              page.on('pageerror', (e) => consoleLines.push(`H6 ${which}: pageerror: ${e.message}`));
              page.on('console', (m) => {
                if (m.type() === 'error' || m.type() === 'warning') consoleLines.push(`H6 ${which}: ${m.text()}`);
              });
              await page.emulateMedia({ reducedMotion: 'reduce' });
              const p = which === 'before' ? BEFORE_PORT : port;
              const root = which === 'before' ? BEFORE_ROOT : ROOT;
              await page.goto(`http://localhost:${p}/`, { waitUntil: 'load', timeout: 120_000 });
              const run = (await page.evaluate(
                async ({ mod, mapId, counts, frames }) => {
                  const m = (await import(/* @vite-ignore */ mod)) as typeof import('./webgpu-page');
                  return m.runArm({ mapId: mapId as never, arm: 'G', counts, frames, viewFrames: 10 });
                },
                { mod: MODULE(root), mapId: MAP, counts: COUNTS, frames: FRAMES }
              )) as ArmRun;
              await page.close();
              if (run.backendKind !== 'node-webgpu') refuse(`H6 ${which}: backendInfo().kind is "${run.backendKind}"`);
              for (const pt of run.points) {
                const key = `${which}|${pt.target}`;
                const rounds = per.get(key) ?? [];
                (rounds[round] ??= []).push(pt.row.cpuRender.med);
                per.set(key, rounds);
              }
            }
          }
          beforeAfter = COUNTS.map((n) => ({ n, before: summarise(per.get(`before|${n}`) ?? []) as ArmSummary, after: summarise(per.get(`after|${n}`) ?? []) as ArmSummary }));
        } finally {
          stopBefore();
        }
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  stop();
}

const readings = pages.flatMap((p) => p.readings);
const cells = timedCells(pages);
/** The count readings the table reads: the last page per arm (counts are deterministic per arm; the CI run has one page per arm). */
const lastPerArm = ARMS.flatMap((a) => [...pages].reverse().find((p) => p.arm === a)?.readings ?? []);
const withProfiles = lastPerArm.map((r) => (r.variant === 'base' && r.n === Math.max(...COUNTS) && profiles[r.arm] !== undefined ? { ...r, profileTop: profiles[r.arm]?.top ?? [] } : r));
const withGpu = withProfiles.map((r) => {
  const g = gpuReadings.find((x) => x.arm === r.arm && x.n === r.n && x.variant === r.variant);
  return g === undefined ? r : { ...r, gpuMs: g.gpuMs };
});

refusals.push(...perPassRefusals(readings), ...unsettledRefusals(readings));
// G2a (T14b): only when the pages booted with the parked policy (the default); a `refreshPolicy=three` boot has nothing to compare.
if (resolveNodeDraw(NODE_DRAW).refreshPolicy === 'parked') refusals.push(...parkedRefreshRefusals(readings));
for (const h of settledByCount(readings)) notes.push(`${h} (${HYPOTHESIS_NAME[h]}) is settled by the count: its pass draws 0 calls in every base reading (left out of the dead-toggle refusal)`);
for (const h of deadHypotheses(readings, cells)) refusals.push(`${h} (${HYPOTHESIS_NAME[h]}): its toggle moved neither cost nor count on any arm and count; it tested nothing`);
for (const h of missingHypotheses(readings)) refusals.push(`${h} (${HYPOTHESIS_NAME[h]}): never read`);
for (const re of BAD_CONSOLE) {
  const hit = consoleLines.find((l) => re.test(l));
  if (hit !== undefined) refusals.push(`console carries ${re.source}: "${hit.slice(0, 160)}"`);
}

const lo = Math.min(...COUNTS);
const hi = Math.max(...COUNTS);
const rows = hypothesisRows({ readings: withGpu, cells, counts: COUNTS, beforeAfter });
const lever = recommendLever(withGpu, cells, lo, hi);
const conditions = [
  `map=${MAP} ${VIEWPORT.width}x${VIEWPORT.height} DPR ${DPR}, z0.5, quality high, music off, reduced motion, hw=${HW}`,
  METAL ? `${ROUNDS} ABBA rounds L/G on fresh pages, ${FRAMES} timed frames per reading, warm-up ${WARM_AFTER_SPAWN} after a spawn and ${WARM_AFTER_TOGGLE} after a toggle, max-load ${MAX_LOAD}` : 'counts only (no timing on SwiftShader)',
  `loadavg per page ${loads.length === 0 ? 'n/a' : `${Math.min(...loads.map((l) => l.load1m)).toFixed(2)}-${Math.max(...loads.map((l) => l.load1m)).toFixed(2)}`}, at end ${os.loadavg()[0]?.toFixed(2)}`,
  `backends: ${[...new Set(backends.map((b) => `${b.arm}=${b.backendKind} on ${b.gpu}`))].join('; ')}`,
  `${[...new Set(grassStates.map((g) => grassCondition(g.mode)))].join(', ') || 'grass: not read'} on every page (the 3D grass field is hidden from the L-vs-G readings; its cost is its own column: webgpu-grass-probe.ts)`,
  `L is MATCHED to the node scene (the node census's hidden set hidden before the stats frame), as webgpu-page.ts runArm`,
  `profile: ${Object.entries(profiles).map(([a, p]) => `${a} ${p.samples} samples over ${PROFILE_FRAMES} frames at n${hi}`).join('; ') || 'not run'}`,
  `gpu time: ${gpuReadings.length === 0 ? 'not run' : 'a separate timestamps page on G (never the CPU timing pages)'}`,
  `node draw switches at boot: ${JSON.stringify(resolveNodeDraw(NODE_DRAW))} (--node-opts=${arg('node-opts', '')})`,
  `H6: ${beforeAfter === null ? 'not run' : `G on ${ROOT} against G on ${BEFORE_ROOT}${beforeShas}`}`,
].join('\n- ');
const md = [
  `# WebGPU P3 T13: the draw-submission probe (${HW})`,
  '',
  `Run ${startedAt}. Machine: ${os.cpus()[0]?.model ?? 'unknown'}, ${os.platform()}.`,
  '',
  `Conditions:\n- ${conditions}`,
  '',
  '## Hypotheses',
  '',
  ...hypothesisTable(rows),
  '',
  `**Lever (for T14):** ${lever}`,
  '',
  '## Tallies (the stats frame; c/o = calls/objects)',
  '',
  ...tallyTable(withGpu),
  '',
  '## Profile top (self time, the timed frames at the high count)',
  '',
  ...Object.entries(profiles).flatMap(([a, p]) => [`### ${a}`, '', ...(p.top.length === 0 ? ['none'] : p.top.map((t) => `- ${t.selfMs.toFixed(1)} ms ${t.fn} (${t.file})`)), '']),
  '## Notes',
  '',
  ...(notes.length === 0 ? ['none'] : notes.map((n) => `- ${n}`)),
  '',
  '## Refusals',
  '',
  ...(refusals.length === 0 ? ['none'] : refusals.map((r) => `- ${r}`)),
];
writeFileSync(path.join(OUT, 'submit-probe.md'), md.join('\n') + '\n');
writeFileSync(path.join(OUT, 'submit-probe.json'), JSON.stringify({ startedAt, hw: HW, conditions, loads, backends, readings: withGpu, allReadings: readings, cells, gpuReadings, profiles, beforeAfter, rows, lever, notes, refusals }, null, 2));
console.log(md.join('\n'));
if (refusals.length > 0) refuse(`${refusals.length} refusal(s); the table above is what was read`);
process.exit(0);
