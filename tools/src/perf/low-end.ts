// Low-end frame time: the LIVE game loop under a low-end proxy, per quality
// preset. The instrument behind docs/PERFORMANCE.md, "Low-end" (2026-10-09).
//
//   pnpm perf:lowend -- --gpu=metal --cpu=1,4,6 --viewport=1366x768,1920x1080 --quality=high,medium,low --runs=3
//   pnpm perf:lowend -- --gpu=swiftshader --cpu=1 ...
//   pnpm perf:lowend -- --probe            # print the fight timeline used to pick FIGHT_TICK
//
// Why a new file and not an extension of an existing one. `three-units.ts`
// is a unit-COUNT curve over a stand-in roster, and `render-frame-cost.ts`
// times `renderer.frame()` in a tight loop with no sim, no HUD and no rAF --
// neither can see a stutter, which is a long gap between two PRESENTED frames
// of the real loop. This file never calls `frame()` itself in a measured
// window: it lets `main.ts`'s own rAF loop run (sim ticks, audio, HUD, hover,
// render) and records the rAF timestamps, so an interval here is what the
// player sees. It wraps `sim.tick` and `renderer.frame` only to split each
// frame into tick time and render-submit time (the two have different budgets
// and different owners). Boot is read by `boot.ts`'s `driveBoot`, the same
// loop `pnpm perf:load` uses.
//
// One boot per (gpu, cpu, viewport, quality, run), because the quality preset
// is read once at boot. Each boot measures four windows, in order:
//
//   opening  OPENING_MS of untouched live play, OPENING_SKIP_MS after the
//            first frame: what an automatic quality rule would decide on.
//   fight    the heaviest mission's opening fight (`umm_zeitoun_4_clearance`,
//            one of #474's three heaviest): the whole force attack-moves on
//            the depot yard (the playtest plan's own first order, sent to
//            everyone) at whatever tick live play has reached -- reported as
//            `orderTick` -- the sim is stepped to FIGHT_TICK, and the camera
//            sits on the force for FIGHT_MS of live play.
//   blast    from there, the building nearest the camera is levelled and the
//            two nearest vehicles are killed on ONE tick -- the top of the
//            event ladder (collapse + two catastrophic kills: lights, shake,
//            hit-stop, shrouds, decals, and the ground control-map rebuild a
//            collapse pays). BLAST_MS of live play after it.
//   pan      the arrow keys held, through the real `stepPan` path: right for
//            PAN_LEG_MS, then down, then left, then up.
//
// Conditions are printed with every run and written into the JSON:
// the unmasked GL renderer (read back, never assumed), CPU throttle,
// viewport, quality, serve mode, `document.visibilityState` (a hidden tab
// throttles rAF and has already cost this repo one false number), and the
// machine's load average at the start of the boot.
//
// What CDP CPU throttling is and is not: it slows the renderer process's main
// thread by the given factor (Chrome's own "4x / 6x slowdown" presets). It
// does NOT slow the GPU process, the compositor, or the network. Metal + 4x
// is therefore "a slow CPU with a decent GPU"; SwiftShader is the
// "no usable GPU" floor (every fragment rasterised on the CPU, in the GPU
// process, unthrottled). Neither is a real low-end machine.
import os from 'node:os';
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ChildProcess } from 'node:child_process';
import { chromium, type CDPSession, type Page } from 'playwright';
import { ensureDevServer, readUnmaskedRenderer, stopDevServer } from '../golden-diff/browser';
import { gpuLaunchArgs, resolveGpuBackend } from '../ui-review/gpu';
import { musicOffInitScript } from '../ui-review/music-off';
import { portBusy } from '../ui-review/port';
import { driveBoot, startPreview, type Milestones } from './boot';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const TAG = 'low-end';

const MISSION = 'umm_zeitoun_4_clearance';
/** Where the whole force is sent: the depot yard, the playtest plan's own
 *  first objective (`uz4Plan`, `at(1, ...)`). */
const FIGHT_GOAL: [number, number] = [33, 8];
/** Ticks stepped before the fight window opens. Picked from `--probe`
 *  (2026-10-09, Metal, 1x): the ambush springs at ~tick 298, shots run at
 *  ~35 a second from 320 to 960 and peak at 44-49 a second at 667-688, and
 *  the fight is over by ~1400. 660 puts the 10 s window on the peak. */
const DEFAULT_FIGHT_TICK = 660;
/** The opening window: what a player's first seconds of a mission look like,
 *  and the input an automatic quality rule would have to decide on. Opens
 *  OPENING_SKIP_MS after the first frame (the deferred loads land in there)
 *  and runs OPENING_MS of untouched live play. */
const OPENING_SKIP_MS = 2000;
const OPENING_MS = 8000;
const FIGHT_MS = 10_000;
const BLAST_MS = 4000;
const PAN_LEG_MS = 2500;
/** "Below 30 fps": an interval longer than two 60 Hz vsyncs. */
const SLOW_MS = 33.4;

type Quality = 'low' | 'medium' | 'high';

interface Args {
  port: number;
  serve: 'dev' | 'preview';
  gpu: 'metal' | 'swiftshader';
  cpus: number[];
  viewports: { width: number; height: number }[];
  qualities: Quality[];
  runs: number;
  fightTick: number;
  probe: boolean;
  /** Record a V8 CPU profile over each window and print the top self-time
   *  functions and files. Run it with `--serve=dev` so names survive. */
  profile: boolean;
  /** Measure the opening window only (no fight, blast or pan). */
  openingOnly: boolean;
  /** Override OPENING_SKIP_MS: a later window at the same untouched view
   *  separates a start-up transient from the cost of the view itself. */
  openingSkipMs: number;
  /** Device pixel ratio (default 1). 2 is a Retina Mac; the renderer caps
   *  its own pixel ratio at 2 (`PIXEL_RATIO_CAP`). */
  dpr: number;
  out: string | null;
}

function parseArgs(argv: string[]): Args {
  const get = (k: string): string | undefined => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  const list = (k: string, d: string): string[] => (get(k) ?? d).split(',').filter(Boolean);
  const serve = (get('serve') ?? 'preview') as Args['serve'];
  if (serve !== 'dev' && serve !== 'preview') throw new Error(`--serve must be dev or preview`);
  const qualities = list('quality', 'high,medium,low') as Quality[];
  for (const q of qualities) if (!['low', 'medium', 'high'].includes(q)) throw new Error(`unknown quality ${q}`);
  return {
    port: Number(get('port') ?? 5193),
    serve,
    gpu: resolveGpuBackend(argv, 'darwin'),
    cpus: list('cpu', '1').map(Number),
    viewports: list('viewport', '1366x768').map((v) => {
      const [width, height] = v.split('x').map(Number);
      if (!Number.isFinite(width) || !Number.isFinite(height)) throw new Error(`bad viewport ${v}`);
      return { width, height };
    }),
    qualities,
    runs: Number(get('runs') ?? 3),
    fightTick: Number(get('fight-tick') ?? DEFAULT_FIGHT_TICK),
    probe: argv.includes('--probe'),
    profile: argv.includes('--profile'),
    openingOnly: argv.includes('--opening-only'),
    openingSkipMs: Number(get('opening-skip-ms') ?? OPENING_SKIP_MS),
    dpr: Number(get('dpr') ?? 1),
    out: get('out') ?? null,
  };
}

/** Installed before any page script: a rAF recorder that is OFF until a
 *  window opens, and a long-task observer. The recorder registers its own
 *  callback every frame; all rAF callbacks of one frame share one timestamp,
 *  so its deltas are the loop's presented-frame intervals. */
const RECORDER_INIT = `(() => {
  const R = { on: false, t: [], tick: [], draw: [], ticks: [], long: [], curTick: 0, curTicks: 0, curDraw: 0 };
  window.__lowend = R;
  const raf = window.requestAnimationFrame.bind(window);
  const loop = (ts) => {
    if (R.on) { R.t.push(ts); R.tick.push(R.curTick); R.draw.push(R.curDraw); R.ticks.push(R.curTicks); }
    R.curTick = 0; R.curDraw = 0; R.curTicks = 0;
    raf(loop);
  };
  raf(loop);
  try {
    new PerformanceObserver((l) => { if (R.on) for (const e of l.getEntries()) R.long.push(e.duration); })
      .observe({ type: 'longtask', buffered: false });
  } catch (e) {}
})();`;

/** Wraps `sim.tick` and `renderer.frame` on the live instances, once. */
const WRAP = `(() => {
  const L = window.__lions, R = window.__lowend;
  if (R.wrapped) return;
  R.wrapped = true;
  const tick = L.sim.tick.bind(L.sim);
  L.sim.tick = () => { const a = performance.now(); const ev = tick(); R.curTick += performance.now() - a; R.curTicks++; if (R.events) for (const e of ev) R.events[e.kind] = (R.events[e.kind] || 0) + 1; return ev; };
  const frame = L.renderer.frame.bind(L.renderer);
  // Draw calls over ONE presented frame, on request: \`info\` resets per
  // \`render()\` and a frame is several (shadow, AO pre-pass, post chain), so it
  // is summed by hand with the auto-reset off -- render-frame-cost.ts's method.
  const info = L.renderer.renderer && L.renderer.renderer.info;
  L.renderer.frame = (a, d) => {
    const count = R.count && info;
    if (count) { info.autoReset = false; info.reset(); }
    const s = performance.now(); frame(a, d); R.curDraw += performance.now() - s;
    if (count) { R.calls = info.render.calls; R.tris = info.render.triangles; info.autoReset = true; R.count = false; }
  };
})()`;

interface WindowStats {
  frames: number;
  wallMs: number;
  fps: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  over33: number;
  over50: number;
  over100: number;
  tickP50: number;
  tickP95: number;
  drawP50: number;
  drawP95: number;
  simRate: number;
  longTasks: number;
  longMax: number;
}

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function openWindow(page: Page): Promise<void> {
  await page.evaluate(() => {
    const R = (window as unknown as { __lowend: Record<string, unknown> }).__lowend;
    R.t = [];
    R.tick = [];
    R.draw = [];
    R.ticks = [];
    R.long = [];
    R.on = true;
  });
}

async function closeWindow(page: Page): Promise<WindowStats> {
  const raw = await page.evaluate(() => {
    const R = (window as unknown as { __lowend: { on: boolean; t: number[]; tick: number[]; draw: number[]; ticks: number[]; long: number[] } }).__lowend;
    R.on = false;
    return { t: R.t, tick: R.tick, draw: R.draw, ticks: R.ticks, long: R.long };
  });
  const iv: number[] = [];
  for (let i = 1; i < raw.t.length; i++) iv.push(raw.t[i] - raw.t[i - 1]);
  const s = [...iv].sort((a, b) => a - b);
  // Work attributed to the frame that PRESENTED it: index i's tick/draw were
  // accumulated before rAF i fired, i.e. during interval i-1.
  // Tick time over the frames that RAN a tick (20 Hz under a 60 Hz loop, so
  // two frames in three run none, and a per-frame median would read 0).
  const tk = raw.tick.slice(1).filter((_, i) => raw.ticks[i + 1] > 0).sort((a, b) => a - b);
  const dr = raw.draw.slice(1).sort((a, b) => a - b);
  const wallMs = raw.t.length > 1 ? raw.t[raw.t.length - 1] - raw.t[0] : 0;
  const ticks = raw.ticks.slice(1).reduce((a, b) => a + b, 0);
  return {
    frames: iv.length,
    wallMs,
    fps: wallMs > 0 ? (iv.length * 1000) / wallMs : 0,
    p50: pct(s, 50),
    p95: pct(s, 95),
    p99: pct(s, 99),
    max: s[s.length - 1] ?? NaN,
    over33: iv.filter((v) => v > SLOW_MS).length / Math.max(1, iv.length),
    over50: iv.filter((v) => v > 50).length / Math.max(1, iv.length),
    over100: iv.filter((v) => v > 100).length / Math.max(1, iv.length),
    tickP50: pct(tk, 50),
    tickP95: pct(tk, 95),
    drawP50: pct(dr, 50),
    drawP95: pct(dr, 95),
    // Sim ticks per wall second over 20: below 1 means the loop could not
    // keep the 20 Hz sim in real time (MAX_ACC_MS drops the backlog).
    simRate: wallMs > 0 ? ticks / (wallMs / 1000) / 20 : 0,
    longTasks: raw.long.length,
    longMax: raw.long.length ? Math.max(...raw.long) : 0,
  };
}


interface ProfileNode {
  id: number;
  callFrame: { functionName: string; url: string; lineNumber: number };
  children?: number[];
}
interface CpuProfile {
  nodes: ProfileNode[];
  samples: number[];
  timeDeltas: number[];
  startTime: number;
  endTime: number;
}

/** Self time per function and per file, as a share of the window's wall
 *  time. `(program)`/`(idle)`/`(garbage collector)` are kept: under a
 *  throttled CPU the GC line is one of the answers. */
function summariseProfile(p: CpuProfile, top = 14): string[] {
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const selfUs = new Map<number, number>();
  for (let i = 0; i < p.samples.length; i++) selfUs.set(p.samples[i], (selfUs.get(p.samples[i]) ?? 0) + (p.timeDeltas[i] ?? 0));
  const total = p.endTime - p.startTime;
  const fn = new Map<string, number>();
  const file = new Map<string, number>();
  for (const [id, us] of selfUs) {
    const n = byId.get(id);
    if (!n) continue;
    const f = n.callFrame.url.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '') || '(native)';
    const short = f.split('/').slice(-2).join('/');
    const key = `${n.callFrame.functionName || '(anonymous)'}  ${short}:${n.callFrame.lineNumber + 1}`;
    fn.set(key, (fn.get(key) ?? 0) + us);
    file.set(short, (file.get(short) ?? 0) + us);
  }
  const rows = (m: Map<string, number>): string[] =>
    [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, top)
      .map(([k, us]) => `    ${((us / total) * 100).toFixed(1).padStart(5)}%  ${(us / 1000).toFixed(0).padStart(6)} ms  ${k}`);
  return [`   window ${(total / 1000).toFixed(0)} ms -- by function:`, ...rows(fn), '   by file:', ...rows(file)];
}

/** `--profile-dir=<dir>`: also write each window's raw `.cpuprofile` (opens
 *  in Chrome DevTools' Performance panel) for a top-down read. */
let profileDir: string | null = null;

async function profiled<T>(cdp: CDPSession | null, name: string, body: () => Promise<T>): Promise<T> {
  if (!cdp) return body();
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
  await cdp.send('Profiler.start');
  const out = await body();
  const { profile } = (await cdp.send('Profiler.stop')) as unknown as { profile: CpuProfile };
  if (profileDir) writeFileSync(path.join(profileDir, `${name}-${Date.now()}.cpuprofile`), JSON.stringify(profile));
  console.log(`  profile: ${name}`);
  for (const l of summariseProfile(profile)) console.log(l);
  return out;
}

/** Draw calls and triangles over the next presented frame. */
async function drawCalls(page: Page): Promise<{ calls: number; triangles: number }> {
  await page.evaluate(() => {
    (window as unknown as { __lowend: { count: boolean } }).__lowend.count = true;
  });
  await page.waitForFunction(() => !(window as unknown as { __lowend: { count: boolean } }).__lowend.count, null, { timeout: 30_000 });
  return page.evaluate(() => {
    const R = (window as unknown as { __lowend: { calls: number; tris: number } }).__lowend;
    return { calls: R.calls, triangles: R.tris };
  });
}

/** The order goes in at whatever tick live play has reached by then (the
 *  opening window runs the sim in real time first), so `orderTick` is
 *  reported: two runs whose orders went in at different ticks did not fight
 *  the identical fight, and a window can hold a building collapse in one and
 *  not the other. */
async function sendForceAndStep(page: Page, fightTick: number): Promise<{ orderTick: number; tick: number; living: number; cam: [number, number] }> {
  return page.evaluate(
    ([gx, gy, n]) => {
      type L = {
        sim: { queueCommand(c: unknown): void; tickCount: number };
        units(side?: number): { id: number; x: number; y: number }[];
        step(n: number): number;
        goto(x: number, y: number): unknown;
      };
      const L = (window as unknown as { __lions: L }).__lions;
      const ids = L.units(0).map((u) => u.id);
      const orderTick = L.sim.tickCount;
      L.sim.queueCommand({ kind: 'attackMove', ids, x: Math.round(gx * 65536), y: Math.round(gy * 65536) });
      const left = n - L.sim.tickCount;
      if (left > 0) L.step(left);
      const us = L.units(0);
      const cx = us.reduce((a, u) => a + u.x, 0) / Math.max(1, us.length);
      const cy = us.reduce((a, u) => a + u.y, 0) / Math.max(1, us.length);
      L.goto(cx + 0.5, cy + 0.5);
      return { orderTick, tick: L.sim.tickCount, living: us.length + L.units(1).length, cam: [cx, cy] as [number, number] };
    },
    [FIGHT_GOAL[0], FIGHT_GOAL[1], fightTick] as const
  );
}

async function triggerBlast(page: Page): Promise<{ structure: number; vehicles: string[] }> {
  return page.evaluate(() => {
    type L = {
      sim: { structureAt(x: number, y: number): number; debugDestroyStructure(s: number): void; debugKill(i: number): void };
      renderer: { camera: { x: number; y: number } };
      units(side?: number): { id: number; type: string; x: number; y: number }[];
    };
    const L = (window as unknown as { __lions: L }).__lions;
    const cx = L.renderer.camera.x;
    const cy = L.renderer.camera.y;
    let best = -1;
    let bestD = Infinity;
    for (let dy = -10; dy <= 10; dy++)
      for (let dx = -10; dx <= 10; dx++) {
        const s = L.sim.structureAt(Math.floor(cx) + dx, Math.floor(cy) + dy);
        const d = dx * dx + dy * dy;
        if (s >= 0 && d < bestD) {
          best = s;
          bestD = d;
        }
      }
    const veh = [...L.units(0), ...L.units(1)]
      .filter((u) => /mbt_|apc_|ifv_|technical|jeep|dozer/.test(u.type))
      .sort((a, b) => (a.x - cx) ** 2 + (a.y - cy) ** 2 - ((b.x - cx) ** 2 + (b.y - cy) ** 2))
      .slice(0, 2);
    if (best >= 0) L.sim.debugDestroyStructure(best);
    for (const v of veh) L.sim.debugKill(v.id);
    return { structure: best, vehicles: veh.map((v) => v.type) };
  });
}

async function pan(page: Page): Promise<number> {
  const at = async (): Promise<[number, number]> =>
    page.evaluate(() => {
      const c = (window as unknown as { __lions: { renderer: { camera: { x: number; y: number } } } }).__lions.renderer.camera;
      return [c.x, c.y] as [number, number];
    });
  const start = await at();
  let travelled = 0;
  let prev = start;
  for (const key of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) {
    await page.keyboard.down(key);
    await page.waitForTimeout(PAN_LEG_MS);
    await page.keyboard.up(key);
    const now = await at();
    travelled += Math.hypot(now[0] - prev[0], now[1] - prev[1]);
    prev = now;
  }
  return travelled;
}

async function probe(page: Page): Promise<void> {
  await page.evaluate(WRAP);
  await page.evaluate(
    ([gx, gy]) => {
      const W = window as unknown as {
        __lions: { sim: { queueCommand(c: unknown): void }; units(side?: number): { id: number }[] };
        __lowend: { events: Record<string, number> | null };
      };
      W.__lions.sim.queueCommand({ kind: 'attackMove', ids: W.__lions.units(0).map((u) => u.id), x: Math.round(gx * 65536), y: Math.round(gy * 65536) });
    },
    [FIGHT_GOAL[0], FIGHT_GOAL[1]] as const
  );
  console.log('tick  side0 side1  events-in-bin');
  for (let bin = 0; bin < 120; bin++) {
    const row = await page.evaluate(() => {
      const W = window as unknown as {
        __lions: { step(n: number): number; units(side?: number): unknown[] };
        __lowend: { events: Record<string, number> | null };
      };
      W.__lowend.events = {};
      const t = W.__lions.step(20);
      const ev = W.__lowend.events;
      W.__lowend.events = null;
      return { t, a: W.__lions.units(0).length, b: W.__lions.units(1).length, ev };
    });
    const ev = Object.entries(row.ev)
      .filter(([k]) => k !== 'move')
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([k, v]) => `${k}:${v}`)
      .join(' ');
    console.log(`${String(row.t).padStart(5)} ${String(row.a).padStart(5)} ${String(row.b).padStart(5)}  ${ev}`);
  }
}

const fmt = (v: number): string => (Number.isFinite(v) ? v.toFixed(1) : '-');
const pc = (v: number): string => `${(v * 100).toFixed(1)}%`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  profileDir = process.argv.find((a) => a.startsWith('--profile-dir='))?.slice('--profile-dir='.length) ?? null;
  if (await portBusy(args.port)) {
    console.error(`[${TAG}] port ${args.port} is in use by a process this run did not start; pick another with --port=<n>.`);
    process.exit(2);
  }
  let server: ChildProcess | null = null;
  const results: unknown[] = [];
  const browser = await chromium.launch({ headless: true, args: gpuLaunchArgs(args.gpu) });
  try {
    server = args.serve === 'preview' ? await startPreview(args.port, REPO_ROOT, TAG) : await ensureDevServer(args.port, REPO_ROOT, TAG);
    const gl = await readUnmaskedRenderer(browser);
    console.log(`[${TAG}] renderer: ${gl}  serve=${args.serve}  mission=${MISSION}  fightTick=${args.fightTick}`);
    const url = `http://localhost:${args.port}/?mission=${MISSION}`;
    const cells = args.probe ? [{ cpu: 1, vp: args.viewports[0], q: args.qualities[0], run: 1 }] : [];
    if (!args.probe)
      for (let run = 1; run <= args.runs; run++)
        for (const cpu of args.cpus)
          for (const vp of args.viewports) for (const q of args.qualities) cells.push({ cpu, vp, q, run });
    for (const cell of cells) {
      const load = os.loadavg()[0];
      const context = await browser.newContext({ viewport: cell.vp, deviceScaleFactor: args.dpr });
      // The preset under test, seeded through the one music-off helper.
      await context.addInitScript(musicOffInitScript({}, { quality: cell.q }));
      await context.addInitScript(RECORDER_INIT);
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      const cdp = await context.newCDPSession(page);
      if (cell.cpu !== 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cell.cpu });
      const label = `${args.gpu} cpu${cell.cpu}x ${cell.vp.width}x${cell.vp.height}@${args.dpr}x ${cell.q} run${cell.run}`;
      try {
        const m: Milestones = await driveBoot(page, url, 300_000);
        if (m.firstFrame === null) throw new Error(`no first frame: ${m.bootError ?? 'timeout'}`);
        if (args.probe) {
          await probe(page);
          continue;
        }
        await page.waitForTimeout(args.openingSkipMs);
        await page.evaluate(WRAP);
        await openWindow(page);
        await page.waitForTimeout(OPENING_MS);
        const opening = await closeWindow(page);
        const vis = await page.evaluate(() => document.visibilityState);
        const quality = await page.evaluate(() => {
          const raw = localStorage.getItem('lions.settings');
          return raw ? (JSON.parse(raw) as { video: { quality: string } }).video.quality : 'none';
        });
        const lineOf = (n: string, w: WindowStats): string =>
          `  ${n.padEnd(7)} fps ${fmt(w.fps).padStart(5)}  p50 ${fmt(w.p50).padStart(6)}  p95 ${fmt(w.p95).padStart(6)}  p99 ${fmt(w.p99).padStart(6)}  max ${fmt(w.max).padStart(7)}  >33 ${pc(w.over33).padStart(6)}  >100 ${pc(w.over100).padStart(6)}  tick-frame p50/p95 ${fmt(w.tickP50)}/${fmt(w.tickP95)}  draw p50/p95 ${fmt(w.drawP50)}/${fmt(w.drawP95)}  sim ${w.simRate.toFixed(2)}x  long ${w.longTasks} (max ${fmt(w.longMax)})`;
        if (args.openingOnly) {
          results.push({ openingSkipMs: args.openingSkipMs, gpu: args.gpu, gl, cpu: cell.cpu, viewport: `${cell.vp.width}x${cell.vp.height}${args.dpr !== 1 ? `@${args.dpr}x` : ''}`, quality: cell.q, qualityReadBack: quality, run: cell.run, load1: load, visibility: vis, boot: { ready: m.ready, firstFrame: m.firstFrame, loadingScreen: m.loadingScreen }, opening, errors });
          console.log(`[${TAG}] ${label}  load1 ${load.toFixed(2)}  vis ${vis}  quality(read) ${quality}  boot ready ${Math.round(m.ready ?? NaN)} first-frame ${Math.round(m.firstFrame)} ms${errors.length ? `  ERRORS ${errors.length}` : ''}`);
          console.log(lineOf('opening', opening));
          continue;
        }
        const fightAt = await sendForceAndStep(page, args.fightTick);
        await page.waitForTimeout(500);
        const prof = args.profile ? cdp : null;
        const fight = await profiled(prof, 'fight', async () => {
          await openWindow(page);
          await page.waitForTimeout(FIGHT_MS);
          return closeWindow(page);
        });
        const fightCalls = await drawCalls(page);
        let blastWhat: { structure: number; vehicles: string[] } = { structure: -1, vehicles: [] };
        const blast = await profiled(prof, 'blast', async () => {
          await openWindow(page);
          blastWhat = await triggerBlast(page);
          await page.waitForTimeout(BLAST_MS);
          return closeWindow(page);
        });
        let travelled = 0;
        const panW = await profiled(prof, 'pan', async () => {
          await openWindow(page);
          travelled = await pan(page);
          return closeWindow(page);
        });
        const row = {
          gpu: args.gpu,
          gl,
          cpu: cell.cpu,
          viewport: `${cell.vp.width}x${cell.vp.height}${args.dpr !== 1 ? `@${args.dpr}x` : ''}`,
          quality: cell.q,
          qualityReadBack: quality,
          run: cell.run,
          load1: load,
          visibility: vis,
          boot: { ready: m.ready, firstFrame: m.firstFrame, loadingScreen: m.loadingScreen },
          opening,
          fightAt,
          fightCalls,
          blastWhat,
          panTiles: travelled,
          fight,
          blast,
          pan: panW,
          errors,
        };
        results.push(row);
        const line = lineOf;
        console.log(
          `[${TAG}] ${label}  load1 ${load.toFixed(2)}  vis ${vis}  quality(read) ${quality}  boot ready ${Math.round(m.ready ?? NaN)} first-frame ${Math.round(m.firstFrame)} ms  ordered@${fightAt.orderTick} fight@${fightAt.tick} (${fightAt.living} living, ${fightCalls.calls} draw calls, ${(fightCalls.triangles / 1000).toFixed(0)}k tris)  blast s${blastWhat.structure} + ${blastWhat.vehicles.join(',')}  pan ${travelled.toFixed(1)} tiles${errors.length ? `  ERRORS ${errors.length}` : ''}`
        );
        console.log(line('opening', opening));
        console.log(line('fight', fight));
        console.log(line('blast', blast));
        console.log(line('pan', panW));
      } catch (err) {
        console.error(`[${TAG}] ${label}: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
      } finally {
        await context.close();
        if (args.out) writeFileSync(args.out, JSON.stringify(results, null, 1));
      }
    }
  } finally {
    await browser.close();
    stopDevServer(server, TAG);
  }
}

main().catch((err: unknown) => {
  console.error(`[${TAG}] ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exit(1);
});
