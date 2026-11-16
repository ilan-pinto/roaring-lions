/**
 * GH-1400 Q1: the ragdoll CPU bench the presentation-physics design says is owed before the flag flips (design section 3,
 * "Bench plan in the browser": CPU at 4, 8, 16 and 32 incidents; memory; the `perf:memory` leak check). This is the headless half:
 * Rapier's own cost on the CPU, in the WASM the player would run, with NO renderer and NO GPU.
 *
 *   RAGDOLL_BENCH=1 [RAGDOLL_BENCH_OUT=<json>] pnpm exec vitest run packages/render/src/three/physics/ragdoll-bench.test.ts
 *
 * Off by default (`pnpm test` skips the whole block), and it EXITS: vitest ends the process when the file is done, and the init
 * runs use child processes that return. It lives here, not in `tools/`, because of the physics fence (see `ragdoll-bench-lib.ts`).
 *
 * What it measures, and what it cannot:
 * - **Per-step cost** of `RagdollIncident.advanceTo`, one step at a time, which includes `world.step()`, the pose read-back, the tone
 *   writes and the settle test: everything `RagdollSystem` pays per physics step. Not the drawing of the poses.
 * - **A frame** is the physics a render frame owes: the steps `advanceTo` runs for the presentation sim time plus `poseAt` for each live
 *   incident. At 60 fps and 1x speed that is about one step a frame (three steps a 20 Hz tick); at 2x speed two; a stalled frame owes more.
 * - **Figures, not bodies, are the cap** (`RenderQuality.physics.ragdolls` counts figures; a rig.py figure is 11 bodies and 4 hinges).
 * - It is Node's V8 on whatever CPU runs it, single-threaded, no SIMD (the deterministic build has none). A player's browser CPU, and
 *   Safari's and Firefox's WASM tiers, are NOT measured. The conditions are printed with every run.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cpus, freemem, loadavg, totalmem } from 'node:os';
import { performance } from 'node:perf_hooks';
import { runInNewContext } from 'node:vm';
import { setFlagsFromString } from 'node:v8';
import { describe, it } from 'vitest';
import { burstSchedule, groundPatch, squad, summarise, type Summary } from './ragdoll-bench-lib';
import { HANDOFF_MS } from './ragdoll-rig';
import { MAX_STEPS, PHYSICS_STEP_MS, RagdollIncident } from './ragdoll-world';
import { loadRapier } from './rapier';

const ON = process.env.RAGDOLL_BENCH === '1';
const OUT = process.env.RAGDOLL_BENCH_OUT;
/** `RAGDOLL_BENCH_ONLY=init|step|burst|memory` runs one block in a fresh process: the memory block is only a clean growth curve when nothing else has raised the WASM high-water first. */
const ONLY = process.env.RAGDOLL_BENCH_ONLY;
const want = (name: string): boolean => ONLY === undefined || ONLY === '' || ONLY === name;
const REPEATS = Number(process.env.RAGDOLL_BENCH_REPEATS ?? 20);
const WARMUP = 3;
const FRAME_MS = 1000 / 60;
const MiB = 1024 * 1024;

const report: Record<string, unknown> = {};
const lines: string[] = [];
/** The tables go to the console AND to `${RAGDOLL_BENCH_OUT}.md`: vitest buffers a worker's console, a file does not lie. */
function log(text: string): void {
  lines.push(text);
  console.log(text);
}
const ground = groundPatch();

/** WebAssembly.Memory of the Rapier instance, captured at instantiation: the only honest read of its linear memory. */
let wasmMemory: WebAssembly.Memory | null = null;
let patched = false;
function captureWasmMemory(): void {
  if (patched) return;
  patched = true;
  const orig = WebAssembly.instantiate.bind(WebAssembly);
  (WebAssembly as unknown as { instantiate: unknown }).instantiate = async (...a: unknown[]) => {
    const r = (await (orig as (...x: unknown[]) => Promise<unknown>)(...a)) as { instance?: WebAssembly.Instance } & WebAssembly.Instance;
    const inst = r.instance ?? r;
    const mem = (inst.exports as Record<string, unknown>).memory;
    if (mem instanceof WebAssembly.Memory) wasmMemory = mem;
    return r;
  };
}

function forceGc(): void {
  setFlagsFromString('--expose-gc');
  (runInNewContext('gc') as () => void)();
}

const fmt = (x: number, d = 3): string => x.toFixed(d);
function row(label: string, s: Summary): string {
  return `| ${label} | ${s.n} | ${fmt(s.median)} | ${fmt(s.p95)} | ${fmt(s.p99)} | ${fmt(s.max)} | ${fmt(s.mean)} |`;
}
const HEAD = '| case | n | median ms | p95 ms | p99 ms | max ms | mean ms |\n|---|---|---|---|---|---|---|';

/** Runs one incident of `figures` to its freeze (or MAX_STEPS), timing each step; returns the step times and the construction time. */
function lifetime(R: Awaited<ReturnType<typeof loadRapier>>, figures: number): { build: number; steps: number[] } {
  const t0 = performance.now();
  const inc = new RagdollIncident(R, { t0Ms: 0, figures: squad(figures), ground, boxes: [] });
  const build = performance.now() - t0;
  const steps: number[] = [];
  for (let s = 1; s <= MAX_STEPS && !inc.frozen; s++) {
    const a = performance.now();
    inc.advanceTo(s * PHYSICS_STEP_MS + 1e-6);
    steps.push(performance.now() - a);
  }
  inc.dispose();
  return { build, steps };
}

interface BurstResult {
  frames: number[];
  steps: number;
  peakFigures: number;
  wallMs: number;
}

/**
 * A scripted burst at a cap: `figures` deaths, entities of 3 (an `inf_squad`), over `ticks` ticks, then a 60 fps frame loop on the
 * presentation sim clock until every incident has frozen. `stepsPerFrame` > 1 is a faster game speed; `stall` makes ONE frame at
 * `stallAt` owe `stall` extra frames of sim time (a hitch the physics has to catch up on, since owed steps are never dropped).
 */
function burst(
  R: Awaited<ReturnType<typeof loadRapier>>,
  figures: number,
  opts: { ticks: number; speed: number; stallAt?: number; stallFrames?: number }
): BurstResult {
  const sched = burstSchedule(figures, 3, opts.ticks);
  const pending = sched.map((e) => ({ ...e, t0Ms: e.tick * 50 + HANDOFF_MS }));
  const live: RagdollIncident[] = [];
  const out = new Float64Array(11 * 7 * 3);
  const frames: number[] = [];
  let steps = 0;
  let sim = 0;
  const wall0 = performance.now();
  for (let frame = 0; frame < 2000; frame++) {
    sim += FRAME_MS * opts.speed;
    if (opts.stallAt !== undefined && frame === opts.stallAt) sim += FRAME_MS * (opts.stallFrames ?? 6);
    const a = performance.now();
    for (let i = pending.length - 1; i >= 0; i--) {
      if (pending[i].t0Ms <= sim) {
        const p = pending.splice(i, 1)[0];
        live.push(new RagdollIncident(R, { t0Ms: p.t0Ms, figures: squad(p.figures, live.length * 2.4, 0), ground, boxes: [] }));
      }
    }
    for (const inc of live) {
      steps += inc.advanceTo(sim);
      inc.poseAt(sim, out);
    }
    frames.push(performance.now() - a);
    if (pending.length === 0 && live.every((i) => i.frozen)) break;
  }
  const wallMs = performance.now() - wall0;
  for (const inc of live) inc.dispose();
  return { frames, steps, peakFigures: figures, wallMs };
}

describe.skipIf(!ON)('the ragdoll CPU bench (GH-1400 Q1)', () => {
  it('prints the machine conditions', () => {
    const c = cpus();
    report.machine = {
      cpu: c[0]?.model ?? 'unknown',
      logicalCores: c.length,
      node: process.version,
      platform: `${process.platform}/${process.arch}`,
      loadAvg1m: Number(loadavg()[0].toFixed(2)),
      freeMemMiB: Math.round(freemem() / MiB),
      totalMemMiB: Math.round(totalmem() / MiB),
      repeats: REPEATS,
      warmupDiscarded: WARMUP,
      date: new Date().toISOString(),
    };
    log(`MACHINE ${JSON.stringify(report.machine)}`);
  });

  it.runIf(want('init'))('init cost: a cold process, import then R.init(), seven times', () => {
    const code = `
      const t0 = performance.now();
      const m = await import('@dimforge/rapier3d-deterministic-compat');
      const t1 = performance.now();
      await m.default.init();
      const t2 = performance.now();
      console.log(JSON.stringify({ importMs: t1 - t0, initMs: t2 - t1, totalMs: t2 - t0 }));
    `;
    const runs = Array.from({ length: 7 }, () =>
      JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code], { cwd: resolve(__dirname, '..', '..', '..'), encoding: 'utf8' })) as { importMs: number; initMs: number; totalMs: number }
    );
    const s = { import: summarise(runs.map((r) => r.importMs)), init: summarise(runs.map((r) => r.initMs)), total: summarise(runs.map((r) => r.totalMs)) };
    report.init = s;
    log(`INIT (cold child process, n=7)\n${HEAD}\n${row('import', s.import)}\n${row('R.init()', s.init)}\n${row('total', s.total)}`);
  }, 120_000);

  it.runIf(want('step'))('per-step and construction cost by figures in one world', async () => {
    captureWasmMemory();
    const R = await loadRapier();
    const table: string[] = [];
    const per: Record<string, unknown> = {};
    for (const figures of [1, 3, 8, 16, 32]) {
      const builds: number[] = [];
      const steps: number[] = [];
      const lifetimes: number[] = [];
      let stepsToFreeze = 0;
      for (let r = 0; r < REPEATS + WARMUP; r++) {
        const l = lifetime(R, figures);
        if (r < WARMUP) continue;
        builds.push(l.build);
        steps.push(...l.steps);
        lifetimes.push(l.build + l.steps.reduce((a, b) => a + b, 0));
        stepsToFreeze = l.steps.length;
      }
      per[figures] = { bodies: figures * 11, build: summarise(builds), step: summarise(steps), lifetimeTotal: summarise(lifetimes), stepsToFreeze };
      table.push(row(`${figures} fig (${figures * 11} bodies): step`, summarise(steps)));
      table.push(row(`${figures} fig: build`, summarise(builds)));
      table.push(row(`${figures} fig: whole life (${stepsToFreeze} steps)`, summarise(lifetimes)));
    }
    report.perStep = per;
    log(`PER-STEP and BUILD, one world, ${REPEATS} repeats after ${WARMUP} warm-ups\n${HEAD}\n${table.join('\n')}`);
  }, 600_000);

  it.runIf(want('burst'))('a scripted burst: 16 figures (a mortar barrage) over four ticks, at the preset caps, 60 fps frames', async () => {
    captureWasmMemory();
    const R = await loadRapier();
    const rows: string[] = [];
    const res: Record<string, unknown> = {};
    const cases: { label: string; figures: number; speed: number; stallAt?: number }[] = [
      { label: 'cap 8, 1x', figures: 8, speed: 1 },
      { label: 'cap 16, 1x', figures: 16, speed: 1 },
      { label: 'cap 16, 2x speed', figures: 16, speed: 2 },
      { label: 'cap 16, 1x, one 7-frame stall at frame 40', figures: 16, speed: 1, stallAt: 40 },
      { label: 'cap 32, 1x (above any preset)', figures: 32, speed: 1 },
    ];
    for (const c of cases) {
      const allFrames: number[] = [];
      const worst: number[] = [];
      let over1 = 0;
      let over4 = 0;
      let totalFrames = 0;
      let steps = 0;
      for (let r = 0; r < REPEATS + WARMUP; r++) {
        const b = burst(R, c.figures, { ticks: 4, speed: c.speed, stallAt: c.stallAt, stallFrames: 6 });
        if (r < WARMUP) continue;
        allFrames.push(...b.frames);
        worst.push(Math.max(...b.frames));
        over1 += b.frames.filter((f) => f > 1).length;
        over4 += b.frames.filter((f) => f > 4).length;
        totalFrames += b.frames.length;
        steps = b.steps;
      }
      const s = summarise(allFrames);
      rows.push(row(`${c.label}: frame`, s));
      rows.push(row(`${c.label}: the worst frame of each burst`, summarise(worst)));
      res[c.label] = { frame: s, worstPerBurst: summarise(worst), framesOver1ms: over1, framesOver4ms: over4, framesTotal: totalFrames, stepsPerBurst: steps };
      log(`  ${c.label}: ${totalFrames} frames, ${over1} over 1 ms, ${over4} over 4 ms, ${steps} steps a burst`);
    }
    report.burst = res;
    log(`BURST, the physics a 60 fps frame owes (frame budget ${fmt(FRAME_MS, 2)} ms), ${REPEATS} bursts after ${WARMUP} warm-ups\n${HEAD}\n${rows.join('\n')}`);
  }, 900_000);

  it.runIf(want('memory'))('memory: WASM linear memory and the JS heap over 200 create-run-free bursts of 16 figures', async () => {
    captureWasmMemory();
    const R = await loadRapier();
    const wasm = (): number => (wasmMemory ? wasmMemory.buffer.byteLength / MiB : NaN);
    forceGc();
    const base = { isolatedRun: ONLY === 'memory', wasmMiB: wasm(), heapMiB: process.memoryUsage().heapUsed / MiB, rssMiB: process.memoryUsage().rss / MiB };
    const samples: { burst: number; wasmMiB: number; heapMiB: number; rssMiB: number }[] = [];
    for (let b = 1; b <= 200; b++) {
      burst(R, 16, { ticks: 4, speed: 1 });
      if (b === 1 || b === 5 || b % 25 === 0) {
        forceGc();
        const m = process.memoryUsage();
        samples.push({ burst: b, wasmMiB: wasm(), heapMiB: m.heapUsed / MiB, rssMiB: m.rss / MiB });
      }
    }
    const first = samples[1]; // after burst 5
    const last = samples[samples.length - 1];
    const lateGrowthWasm = last.wasmMiB - first.wasmMiB;
    const lateGrowthHeap = last.heapMiB - first.heapMiB;
    report.memory = { base, samples, wasmGrowthAfterBurst5MiB: lateGrowthWasm, heapGrowthAfterBurst5MiB: lateGrowthHeap, headroomMiB: 5 };
    log(
      `MEMORY (16 figures, 176 bodies a burst, forced GC at each sample; baseline is right after init only when RAGDOLL_BENCH_ONLY=memory, which was ${base.isolatedRun})\nbaseline after init: wasm ${fmt(base.wasmMiB, 2)} MiB, heap ${fmt(base.heapMiB, 2)} MiB, rss ${fmt(base.rssMiB, 1)} MiB\n` +
        '| burst | wasm MiB | heap MiB | rss MiB |\n|---|---|---|---|\n' +
        samples.map((s) => `| ${s.burst} | ${fmt(s.wasmMiB, 2)} | ${fmt(s.heapMiB, 2)} | ${fmt(s.rssMiB, 1)} |`).join('\n') +
        `\nWASM growth burst 5 to 200: ${fmt(lateGrowthWasm, 2)} MiB; heap growth burst 5 to 200: ${fmt(lateGrowthHeap, 2)} MiB; headroom in the perf:memory leak check: about 5 MiB`
    );
  }, 900_000);

  it('writes the JSON when asked', () => {
    if (OUT) {
      writeFileSync(OUT, JSON.stringify(report, null, 2));
      writeFileSync(`${OUT}.md`, lines.join('\n\n') + '\n');
    }
  });
});
