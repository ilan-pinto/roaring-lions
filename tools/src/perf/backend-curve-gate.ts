// The browser-driving half of tools/src/perf/three-units.ts. That file's own
// top comment names two execution modes -- a Node CLI (sim tick cost only)
// and a browser mode ("dynamically imported from a page the real Vite dev
// server is serving") -- and this file drives the second one: a real
// headless Chromium (Playwright) against a real Vite dev server, running
// `measureThreeMesh`/`measureSkinnedInfantry` inside it and printing a
// reproducible report -- so "re-run this" is a command, not a transcription
// of a session's console output.
//
// Until WP-A3.3 it also ran `measurePixi` and a billboard-only
// `measureThree`; both backends' billboard paths are deleted, and their
// recorded curves are history in `docs/PERFORMANCE.md`. The name stays so
// every doc line that cites it still resolves.
//
// ============================================================================
// Why navigate to `/` and not a `?sandbox=...` URL
// ============================================================================
//
// The visual gate navigates to a sandbox/mission URL because it needs the
// real app's own renderer on screen to screenshot. This harness needs the
// OPPOSITE: `measureThreeMesh` builds its
// own independent `Sim` + `Renderer` entirely inside the imported module
// (`buildWorld`, `runBackendCurve`) -- they do not touch `window.__lions` at
// all. Navigating to a `?sandbox=` URL would boot `main.ts`'s OWN renderer
// in the same tab, running its own rAF loop concurrently with this harness's
// renderer for the whole measurement -- exactly the "sharing a tab with a
// live renderer" contamination `docs/PERFORMANCE.md` quantifies (a
// co-resident Pixi renderer inflated bare `sim.tick()` cost 5-8x in that
// investigation, before Pixi was retired). The bare `/` route renders the
// campaign menu only -- confirmed live (`document.body.innerText` shows "ROARING
// LIONS" / "CAMPAIGN", `window.__lions` stays `undefined`) -- so this
// harness's own renderer is the ONLY renderer running in the tab for the
// whole measurement. A cross-origin `about:blank` + absolute-URL dynamic
// import was tried first and rejected: Chromium blocks it with
// `net::ERR_FAILED` / "more-private address space" CORS (a null-origin page
// fetching a loopback resource), confirmed live, not assumed.
//
// ============================================================================
// One fresh page per measurement function
// ============================================================================
//
// Each measurement function gets its own fresh `page.goto('/')`, so every
// run starts from a clean tab with nothing else resident -- the skinned
// stand-in never shares GL state with the backend curve.
//
// ============================================================================
// Why the GPU string is printed, and why `--only` exists
// ============================================================================
//
// `docs/PERFORMANCE.md`'s own capture-conditions section names the GPU
// backend as "the single largest confound found while producing this doc":
// Playwright's default headless Chromium renders WebGL through SwiftShader,
// and under it this curve's own numbers were dominated by 1,000-13,000 ms
// single-frame stalls. The launch args below switch that to real hardware --
// but nothing PROVED it per run until 2026-09-15, so a reader of a recorded
// number had to take the args on trust. Every run now prints
// `WEBGL_debug_renderer_info`'s `UNMASKED_RENDERER_WEBGL` before it measures
// anything, and says loudly when it reads SwiftShader; the same thing
// `render-frame-cost.ts` already does.
//
// `--only` exists because the measurement functions answer different
// questions and a ladder step (spec 2026-09-14 section 11) re-measures ONE of
// them repeatedly.
//
// ============================================================================
// GH-1411: conditions, repeats, and the census gate
// ============================================================================
//
// Every run prints the capture-conditions block (`capture-conditions.ts`) and,
// per page, the GPU string, the drawing buffer actually allocated (CSS size x
// pixel ratio, read back from the WebGLRenderer), the preset, the tick and the
// load average before and after. `--dpr`, `--quality` and `--repeat` run their
// product as fresh pages in ONE browser (one Metal session, the house rule).
// `--gpu=metal` refuses (exit 2) a GPU string that is not Metal, before any
// mesh is loaded. The `--out` JSON is rewritten after every page.
//
// `render p95` is a CPU bracket of `frame()` with no GPU sync (no `gl.finish`,
// no readPixels): the time to SUBMIT the frame, not the time the GPU takes to
// draw it. It is not an fps figure and must not be quoted as one.
//
// `--only=census --gate` is the CI gate (`draw-census.ts`): the draw-call
// census of the same world, no timed frames, judged against `CENSUS_BUDGET`.
// Exit 1 over budget, 2 the instrument failing (an unstable count, a page
// error, a world that did not fight).
//
// Usage: npx tsx tools/src/perf/backend-curve-gate.ts [--port=5190] [--attach]
//   (or BACKEND_CURVE_PORT; a held port is refused unless --attach)
//   [--host=localhost] [--out=path.json] [--skip-skinned]
//   [--only=three-mesh,skinned,census] [--gpu=metal|swiftshader]
//   [--dpr=1,2] [--quality=high,medium,low] [--repeat=1] [--frames=<n>] [--gate]

import { mkdirSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page, type Browser } from 'playwright';
import { BENCH_QUALITIES, type BackendReport, type BenchOptions, type BenchQuality } from './three-units';
import { CENSUS_BUDGET, censusRepeatsAgree, censusVerdict } from './draw-census';
import { conditionsBlock, formatLoad, readConditions } from './capture-conditions';
import { musicOffInitScript } from '../ui-review/music-off';
import { claimPortOrAttach } from '../ui-review/port';
import { gpuLaunchArgs, resolveGpuBackend, type GpuBackend } from '../ui-review/gpu';
import { ensureDevServer, stopDevServer } from '../golden-diff/browser';

const TAG = 'backend-curve-gate';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
// Vite dev's own mechanism for serving an arbitrary absolute filesystem
// path, independent of which page/module asks for it -- the same `/@fs/`
// convention `three-units.ts`'s own `repoRootFromModuleUrl()` uses for the
// skinned-infantry spike GLB.
const MODULE_PATH = `/@fs${REPO_ROOT}/tools/src/perf/three-units.ts`;

/** The measurement functions `--only` can select, in run order. The default
 *  (`three-mesh,skinned`) is what every recorded curve in `docs/PERFORMANCE.md`
 *  was taken with; `census` is the GH-1411 gate's reading. */
const MEASUREMENTS = ['three-mesh', 'skinned', 'census'] as const;
type Measurement = (typeof MEASUREMENTS)[number];
const DEFAULT_ONLY: readonly Measurement[] = ['three-mesh', 'skinned'];

interface Args {
  host: string;
  outFile: string;
  only: ReadonlySet<Measurement>;
  gpu: GpuBackend;
  dprs: readonly number[];
  qualities: readonly BenchQuality[];
  repeat: number;
  gate: boolean;
  frames: number | undefined;
}

function parseList<T>(raw: string | undefined, fallback: readonly T[], parse: (s: string) => T): readonly T[] {
  if (raw === undefined || raw === 'true') return fallback;
  return raw.split(',').map((s) => s.trim()).filter(Boolean).map(parse);
}

function parseArgs(argv: readonly string[]): Args {
  const flags = new Map(
    argv
      .filter((a) => a.startsWith('--'))
      .map((a) => {
        const [k, v] = a.slice(2).split('=');
        return [k, v ?? 'true'] as const;
      })
  );
  const only = new Set<Measurement>(
    parseList<Measurement>(flags.get('only'), DEFAULT_ONLY, (name) => {
      if (!(MEASUREMENTS as readonly string[]).includes(name)) {
        throw new Error(`${TAG}: unknown --only "${name}" (known: ${MEASUREMENTS.join(', ')})`);
      }
      return name as Measurement;
    })
  );
  if (flags.has('skip-skinned')) only.delete('skinned');
  const dprs = parseList(flags.get('dpr'), [1], (s) => {
    const n = Number(s);
    if (!(n > 0 && n <= 4)) throw new Error(`${TAG}: --dpr "${s}" is not a device scale factor (0-4]`);
    return n;
  });
  const qualities = parseList<BenchQuality>(flags.get('quality'), ['high'], (s) => {
    if (!(BENCH_QUALITIES as readonly string[]).includes(s)) throw new Error(`${TAG}: --quality "${s}" (known: ${BENCH_QUALITIES.join(', ')})`);
    return s as BenchQuality;
  });
  const repeatRaw = flags.get('repeat') ?? '1';
  const repeat = Number(repeatRaw);
  if (!Number.isInteger(repeat) || repeat < 1) throw new Error(`${TAG}: --repeat "${repeatRaw}" is not a positive integer`);
  const gate = flags.has('gate');
  const framesRaw = flags.get('frames');
  const frames = framesRaw === undefined ? undefined : Number(framesRaw);
  if (frames !== undefined && !(Number.isInteger(frames) && frames >= 1)) throw new Error(`${TAG}: --frames "${framesRaw}" is not a positive integer`);
  if (gate && (only.size !== 1 || !only.has('census'))) throw new Error(`${TAG}: --gate judges the census alone: pass --only=census`);
  return {
    // `localhost` by default (what every recorded run used); overridable
    // because a dev server started with `--host 127.0.0.1` is NOT reachable
    // over `localhost`'s IPv6 answer on this platform, and the failure reads
    // as a dead server rather than as a wrong hostname.
    host: flags.get('host') ?? 'localhost',
    // Resolved against the repo root, as `memory.ts` does: `pnpm perf:census` runs in `tools/` (`pnpm --filter`), and a
    // cwd-relative `--out=memory-output/...` would land where CI's upload step never looks.
    outFile: path.resolve(REPO_ROOT, flags.get('out') ?? path.join('.superpowers', 'perf-evidence-raw.json')),
    only,
    // Before GH-1411 this file hard-coded the Metal flags. It still defaults to Metal on macOS (`resolveGpuBackend`),
    // so every recorded command line means what it meant; CI passes `--gpu=swiftshader`.
    gpu: resolveGpuBackend(argv, process.platform),
    dprs,
    qualities,
    repeat,
    gate,
    frames,
  };
}

async function freshPage(browser: Browser, origin: string, dpr: number, errors: string[]): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: dpr });
  await page.addInitScript(musicOffInitScript());
  page.on('pageerror', (err) => {
    console.error('[pageerror]', err.message);
    errors.push(`pageerror: ${err.message}`);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'log' || msg.type() === 'info') console.log(msg.text());
    if (msg.type() === 'error') {
      console.error(`[console.error] ${msg.text()}`);
      errors.push(`console.error: ${msg.text()}`);
    }
  });
  await page.goto(`${origin}/`, { waitUntil: 'load', timeout: 60_000 });
  return page;
}

/** The unmasked GL renderer string this run's numbers were taken on, read
 *  from a throwaway canvas in the page. A SwiftShader run is not comparable
 *  to a hardware one and this is how a reader of a recorded number finds out
 *  which they are holding; `--gpu=metal` refuses one that is not Metal. */
async function readGpuString(page: Page): Promise<string> {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return 'no webgl2 context';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (!ext) return 'WEBGL_debug_renderer_info unavailable';
    return String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
  });
}

const fmt = (n: number, w: number): string => n.toFixed(2).padStart(w);

/** One line per checkpoint, p95 first, so the curve is in the transcript and
 *  not only in the `--out` JSON. `render p95` is the figure the 16.7 ms
 *  budget is read against (spec 2026-09-14 section 11) -- as a SUBMIT time. */
function printCurve(label: string, report: BackendReport): void {
  const c0 = report.canvas;
  console.log(`\n[${TAG}] ${label} curve (ms):`);
  console.log(
    `  canvas ${c0.cssWidth}x${c0.cssHeight} CSS px x DPR ${c0.pixelRatio} = drawing buffer ${c0.bufferWidth}x${c0.bufferHeight}; ` +
      `preset ${report.quality}; empty-scene calls ${report.emptyCensus.calls.join('/')}`
  );
  console.log('  render = frame() alone (submit, no GPU sync); synced = frame() + 1x1 readPixels (CPU + GPU wall)');
  console.log(
    '  target | living |  tick | tick avg | tick p95 | render med | render p95 | render max | synced med | synced p95 | synced max | calls | triangles'
  );
  const cells = (r: { medianMs: number; p95Ms: number; maxMs: number } | null): string =>
    r === null ? `${'-'.padStart(10)} | ${'-'.padStart(10)} | ${'-'.padStart(10)} | ` : `${fmt(r.medianMs, 10)} | ${fmt(r.p95Ms, 10)} | ${fmt(r.maxMs, 10)} | `;
  for (const c of report.checkpoints) {
    console.log(
      `  ${String(c.target).padStart(6)} | ${String(c.livingAtMeasure).padStart(6)} | ${String(c.tickCount).padStart(5)} | ` +
        `${fmt(c.tick.avgMs, 8)} | ${fmt(c.tick.p95Ms, 8)} | ` +
        cells(c.render) +
        cells(c.synced) +
        `${c.census.calls.join('/')} | ${c.census.triangles.join('/')}`
    );
  }
}

/** Runs one exported measurement function (`measureThreeMesh`,
 *  `measureSkinnedInfantry`) inside a fresh page,
 *  serialising its result back to Node as JSON. The `onProgress` callback
 *  passed to the in-page function is a plain in-page closure (not a Node
 *  function threaded across the CDP boundary) that just `console.log`s --
 *  `page.on('console')` above relays it to this process's own stdout, which
 *  is simpler and has no `page.exposeFunction` round-trip cost per call. */
async function runInPage<T>(page: Page, exportName: string, bench: BenchOptions = {}): Promise<T> {
  const raw = await page.evaluate(
    async ({ modulePath, name, opts }) => {
      const mod = (await import(/* @vite-ignore */ modulePath)) as Record<
        string,
        (onProgress?: (msg: string) => void, bench?: unknown) => Promise<unknown>
      >;
      const fn = mod[name];
      if (typeof fn !== 'function') throw new Error(`three-units.ts has no export "${name}"`);
      const result = await fn((msg: string) => console.log(msg), opts);
      return JSON.stringify(result);
    },
    { modulePath: MODULE_PATH, name: exportName, opts: bench }
  );
  return JSON.parse(raw) as T;
}

interface PageRun {
  measurement: Measurement;
  dpr: number;
  quality: BenchQuality;
  repeat: number;
  loadBefore: string;
  loadAfter: string;
  pageErrors: string[];
  report: unknown;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const { host, outFile, only } = args;
  // `--port=<n>`, else BACKEND_CURVE_PORT, else 5190; a port something else
  // holds is REFUSED (exit 2, `ui-review/port.ts`) unless `--attach` says the
  // caller started that server on purpose (the `--host 127.0.0.1` case below).
  const { port } = await claimPortOrAttach(TAG, 'BACKEND_CURVE_PORT', 5190);
  const origin = `http://${host}:${port}`;
  // Its own process GROUP, stopped as a group (`golden-diff/browser.ts`): a non-detached `child.kill` reaches the pnpm
  // wrapper only, and on Linux the orphaned vite kept this process alive for 40 minutes once (visual-baseline-bless).
  const devServer = await ensureDevServer(port, REPO_ROOT, TAG);
  // Playwright's default headless Chromium renders WebGL through SwiftShader
  // (software) -- confirmed live via `WEBGL_debug_renderer_info`. `--gpu=metal`
  // (the macOS default) switches it to the REAL hardware backend -- load-bearing
  // for every TIME this file produces, since a mesh-heavy scene's draw-call
  // submission cost (the documented bottleneck) is dramatically different in
  // software vs hardware rasterisation, and a player never runs on SwiftShader.
  // The census COUNTS do not depend on it (GH-1411, measured on both).
  const browser = await chromium.launch({ headless: true, args: gpuLaunchArgs(args.gpu) });
  const report: Record<string, unknown> = {
    capturedAt: new Date().toISOString(),
    port,
    only: [...only],
    gpuArm: args.gpu,
    runs: [] as PageRun[],
  };
  const write = (): void => {
    mkdirSync(path.dirname(outFile), { recursive: true });
    writeFileSync(outFile, JSON.stringify(report, null, 2));
  };
  let exit = 0;
  try {
    const probeErrors: string[] = [];
    const probe = await freshPage(browser, origin, 1, probeErrors);
    const gpu = await readGpuString(probe);
    await probe.close();
    report.gpu = gpu;
    const conditions = readConditions(`three.js WebGLRenderer (legacy path, the shipped one) on ${gpu}`);
    report.conditions = conditions;
    for (const line of conditionsBlock(conditions)) console.log(line);
    console.log(`  gpu arm:      --gpu=${args.gpu}`);
    console.log(`[${TAG}] GPU: ${gpu}`);
    if (/swiftshader|software/i.test(gpu)) {
      console.warn(
        `[${TAG}] WARNING: this is the SOFTWARE rasteriser. Every TIME below is ` +
          'incomparable to a hardware run -- see docs/PERFORMANCE.md capture conditions. Counts are comparable.'
      );
    }
    if (args.gpu === 'metal' && !/metal/i.test(gpu)) {
      console.error(`[${TAG}] --gpu=metal asked for Metal and the page reports "${gpu}": refusing to measure (exit 2).`);
      return 2;
    }

    const runs = report.runs as PageRun[];
    const runPage = async (measurement: Measurement, dpr: number, quality: BenchQuality, repeat: number): Promise<PageRun> => {
      const pageErrors: string[] = [];
      const loadBefore = formatLoad({ loadavg });
      console.log(`\n[${TAG}] === ${measurement} dpr=${dpr} quality=${quality} repeat=${repeat} (load ${loadBefore}) ===`);
      const page = await freshPage(browser, origin, dpr, pageErrors);
      let result: unknown;
      if (measurement === 'skinned') {
        result = await runInPage(page, 'measureSkinnedInfantry');
      } else {
        const r = await runInPage<BackendReport>(page, 'measureThreeMesh', { quality, censusOnly: measurement === 'census', timedFrames: args.frames });
        printCurve(`three (real shipped meshes, ${measurement})`, r);
        result = r;
      }
      await page.close();
      const run: PageRun = { measurement, dpr, quality, repeat, loadBefore, loadAfter: formatLoad({ loadavg }), pageErrors, report: result };
      console.log(`[${TAG}] load after: ${run.loadAfter}`);
      runs.push(run);
      write();
      return run;
    };

    const censusByArm = new Map<string, BackendReport[]>();
    for (const measurement of MEASUREMENTS) {
      if (!only.has(measurement)) continue;
      if (measurement === 'skinned') {
        await runPage('skinned', 1, 'high', 1);
        continue;
      }
      for (let rep = 1; rep <= args.repeat; rep++) {
        for (const dpr of args.dprs) {
          for (const quality of args.qualities) {
            const run = await runPage(measurement, dpr, quality, rep);
            if (measurement === 'census') {
              const arm = `dpr ${dpr}, ${quality}`;
              censusByArm.set(arm, [...(censusByArm.get(arm) ?? []), run.report as BackendReport]);
            }
            if (args.gate) {
              const verdict = censusVerdict(run.report as BackendReport, CENSUS_BUDGET, run.pageErrors);
              const word = verdict.kind === 'pass' ? 'PASS' : verdict.kind === 'over-budget' ? 'FAIL' : 'INSTRUMENT FAILURE';
              console.log(`\n[${TAG}] census gate (dpr ${dpr}, ${quality}): ${word}`);
              for (const line of verdict.lines) console.log(`  ${line}`);
              const code = verdict.kind === 'pass' ? 0 : verdict.kind === 'over-budget' ? 1 : 2;
              exit = Math.max(exit, code);
            }
          }
        }
      }
    }

    for (const [arm, reports] of censusByArm) {
      const disagreement = censusRepeatsAgree(reports, CENSUS_BUDGET.target);
      if (disagreement === null) {
        if (reports.length > 1) console.log(`[${TAG}] census reproduced across ${reports.length} pages (${arm})`);
        continue;
      }
      console.log(`\n[${TAG}] census (${arm}): ${args.gate ? 'INSTRUMENT FAILURE' : 'WARNING'}`);
      for (const line of disagreement) console.log(`  ${line}`);
      if (args.gate) exit = Math.max(exit, 2);
    }

    write();
    console.log(`\n[${TAG}] wrote ${outFile}`);
  } finally {
    await browser.close();
    stopDevServer(devServer, TAG);
  }
  return exit;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(err);
    process.exitCode = 2;
  }
);
