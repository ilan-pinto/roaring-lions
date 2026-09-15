// The browser-driving half of tools/src/perf/three-units.ts. That file's own
// top comment names two execution modes -- a Node CLI (sim tick cost only)
// and a browser mode ("dynamically imported from a page the real Vite dev
// server is serving... from the console of a tab") -- and documents the
// second one as a manual, by-hand protocol, the same gap
// tools/src/ci/golden-diff-gate.ts closed for the golden-image diff. This
// file is that closure for the perf harness: it drives a real headless
// Chromium (Playwright, same dependency golden-diff-gate.ts already added)
// against a real Vite dev server, runs `measurePixi`/`measureThree`/
// `measureThreeMesh`/`measureSkinnedInfantry` inside it, and prints a
// reproducible report -- so "re-run this" is a command, not a transcription
// of a session's console output.
//
// ============================================================================
// Why navigate to `/` and not a `?sandbox=...` URL
// ============================================================================
//
// `golden-diff-gate.ts` navigates to a sandbox/mission URL because it needs
// the real app's own renderer on screen to screenshot. This harness needs
// the OPPOSITE: `measureThree`/`measurePixi`/`measureThreeMesh` build their
// own independent `Sim` + `Renderer` entirely inside the imported module
// (`buildWorld`, `runBackendCurve`) -- they do not touch `window.__lions` at
// all. Navigating to a `?sandbox=` URL would boot `main.ts`'s OWN renderer
// in the same tab, running its own rAF loop concurrently with this harness's
// renderer for the whole measurement -- exactly the "sharing a tab with a
// live renderer" contamination `three-units.ts`'s own `measureThree` doc
// comment quantifies (a co-resident Pixi renderer inflated bare `sim.tick()`
// cost 5-8x in that investigation). The bare `/` route renders the campaign
// menu only -- confirmed live (`document.body.innerText` shows "ROARING
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
// `runBackendCurve`'s own doc comment explains it disposes a `ThreeRenderer`
// at the end of its run but explicitly does NOT dispose a `PixiRenderer`
// ("Pixi's own `Application` is torn down with the page"). Running
// `measurePixi()` then `measureThree()` then `measureThreeMesh()` in the
// SAME page would therefore leak the first two backends' GL/canvas
// resources into the next measurement. Each measurement function below gets
// its own fresh `page.goto('/')`, so every run starts from a clean tab with
// nothing else resident.
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
// `--only` exists because the four measurement functions answer different
// questions and a ladder step (spec 2026-09-14 section 11) re-measures ONE of
// them repeatedly. Running all four to re-read one rung wastes ~4 minutes
// per rung, most of it in `measurePixi`, which no lighting change can move.
//
// Usage: npx tsx tools/src/perf/backend-curve-gate.ts [--port=5190]
//   [--host=localhost] [--out=path.json] [--skip-skinned]
//   [--only=pixi,three,three-mesh,skinned]

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page, type Browser } from 'playwright';
import type { BackendReport } from './three-units';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
// Vite dev's own mechanism for serving an arbitrary absolute filesystem
// path, independent of which page/module asks for it -- the same `/@fs/`
// convention `three-units.ts`'s own `repoRootFromModuleUrl()` uses for the
// skinned-infantry spike GLB.
const MODULE_PATH = `/@fs${REPO_ROOT}/tools/src/perf/three-units.ts`;

/** The measurement functions `--only` can select, in run order. `all` is the
 *  default and is what every recorded curve in `docs/PERFORMANCE.md` was
 *  taken with. */
const MEASUREMENTS = ['pixi', 'three', 'three-mesh', 'skinned'] as const;
type Measurement = (typeof MEASUREMENTS)[number];

interface Args {
  port: number;
  host: string;
  outFile: string;
  only: ReadonlySet<Measurement>;
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
  const onlyRaw = flags.get('only');
  const only = new Set<Measurement>(MEASUREMENTS);
  if (onlyRaw !== undefined && onlyRaw !== 'true') {
    only.clear();
    for (const name of onlyRaw.split(',').map((s) => s.trim()).filter(Boolean)) {
      if (!(MEASUREMENTS as readonly string[]).includes(name)) {
        throw new Error(`backend-curve-gate: unknown --only "${name}" (known: ${MEASUREMENTS.join(', ')})`);
      }
      only.add(name as Measurement);
    }
  }
  if (flags.has('skip-skinned')) only.delete('skinned');
  return {
    port: Number(flags.get('port') ?? 5190),
    // `localhost` by default (what every recorded run used); overridable
    // because a dev server started with `--host 127.0.0.1` is NOT reachable
    // over `localhost`'s IPv6 answer on this platform, and the failure reads
    // as a dead server rather than as a wrong hostname.
    host: flags.get('host') ?? 'localhost',
    outFile: flags.get('out') ?? path.join(REPO_ROOT, '.superpowers', 'perf-evidence-raw.json'),
    only,
  };
}

async function isServerUp(origin: string): Promise<boolean> {
  try {
    const res = await fetch(`${origin}/`, { signal: AbortSignal.timeout(1000) });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function waitForServer(origin: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isServerUp(origin)) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`backend-curve-gate: dev server at ${origin} did not come up within ${timeoutMs}ms`);
}

/** Same "never kill a server this process did not start" rule
 *  `golden-diff-gate.ts` follows -- reused verbatim rather than re-derived,
 *  because getting this wrong is the one mistake CLAUDE.md explicitly warns
 *  a subagent has made repeatedly (killing a shared `pnpm dev`). */
async function ensureDevServer(origin: string, port: number): Promise<ChildProcess | null> {
  if (await isServerUp(origin)) {
    console.log(`[backend-curve-gate] reusing dev server already listening at ${origin} (not managed, will not be killed)`);
    return null;
  }
  console.log(`[backend-curve-gate] starting a dev server on :${port}...`);
  const child = spawn('pnpm', ['--filter', '@lions/app', 'dev'], {
    cwd: REPO_ROOT,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout?.on('data', (d: Buffer) => (out += d.toString()));
  child.stderr?.on('data', (d: Buffer) => (out += d.toString()));
  try {
    await waitForServer(origin, 30_000);
  } catch (err) {
    console.error(`[backend-curve-gate] dev server output so far:\n${out}`);
    child.kill('SIGTERM');
    throw err;
  }
  return child;
}

async function freshPage(browser: Browser, origin: string): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (err) => console.error('[pageerror]', err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'log' || msg.type() === 'info') console.log(msg.text());
  });
  await page.goto(`${origin}/`, { waitUntil: 'load', timeout: 30_000 });
  return page;
}

/** The unmasked GL renderer string this run's numbers were taken on, read
 *  from a throwaway canvas in the page. Printed rather than asserted: a
 *  SwiftShader run is not comparable to a hardware one and this is how a
 *  reader of a recorded number finds out which they are holding. */
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

/** One line per checkpoint, p95 first, so the curve is in the transcript and
 *  not only in the `--out` JSON. `render p95` is the figure the 16.7 ms
 *  budget is read against (spec 2026-09-14 section 11). */
function printCurve(label: string, report: BackendReport): void {
  console.log(`\n[backend-curve-gate] ${label} curve (ms):`);
  console.log('  target | living | tick avg | tick p95 | render avg | render p95 | render max');
  for (const c of report.checkpoints) {
    console.log(
      `  ${String(c.target).padStart(6)} | ${String(c.livingAtMeasure).padStart(6)} | ` +
        `${c.tick.avgMs.toFixed(2).padStart(8)} | ${c.tick.p95Ms.toFixed(2).padStart(8)} | ` +
        `${c.render.avgMs.toFixed(2).padStart(10)} | ${c.render.p95Ms.toFixed(2).padStart(10)} | ` +
        `${c.render.maxMs.toFixed(2).padStart(10)}`
    );
  }
}

/** Runs one exported measurement function (`measurePixi`, `measureThree`,
 *  `measureThreeMesh`, `measureSkinnedInfantry`) inside a fresh page,
 *  serialising its result back to Node as JSON. The `onProgress` callback
 *  passed to the in-page function is a plain in-page closure (not a Node
 *  function threaded across the CDP boundary) that just `console.log`s --
 *  `page.on('console')` above relays it to this process's own stdout, which
 *  is simpler and has no `page.exposeFunction` round-trip cost per call. */
async function runInPage<T>(page: Page, exportName: string): Promise<T> {
  const raw = await page.evaluate(
    async ({ modulePath, name }) => {
      const mod = (await import(/* @vite-ignore */ modulePath)) as Record<
        string,
        (onProgress?: (msg: string) => void) => Promise<unknown>
      >;
      const fn = mod[name];
      if (typeof fn !== 'function') throw new Error(`three-units.ts has no export "${name}"`);
      const result = await fn((msg: string) => console.log(msg));
      return JSON.stringify(result);
    },
    { modulePath: MODULE_PATH, name: exportName }
  );
  return JSON.parse(raw) as T;
}

async function main(): Promise<void> {
  const { port, host, outFile, only } = parseArgs(process.argv.slice(2));
  const origin = `http://${host}:${port}`;
  const devServer = await ensureDevServer(origin, port);
  // Playwright's default headless Chromium renders WebGL through SwiftShader
  // (software) -- confirmed live via `WEBGL_debug_renderer_info` before this
  // flag set was added: `unmaskedRenderer` read "ANGLE (Google, Vulkan 1.3.0
  // (SwiftShader Device...))" with no args. These flags switch it to the
  // REAL hardware backend (confirmed the same way: `unmaskedRenderer` reads
  // "ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro...)" with them) --
  // load-bearing for every number this file produces, since a mesh-heavy
  // scene's draw-call submission cost (the documented bottleneck, CLAUDE.md's
  // scaling-debt entry) is dramatically different in software vs hardware
  // rasterisation, and a player never runs on SwiftShader.
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--use-gl=angle', '--enable-gpu-rasterization', '--disable-gpu-sandbox'],
  });
  const report: Record<string, unknown> = {
    capturedAt: new Date().toISOString(),
    port,
    only: [...only],
  };
  try {
    const probe = await freshPage(browser, origin);
    const gpu = await readGpuString(probe);
    await probe.close();
    report.gpu = gpu;
    console.log(`[backend-curve-gate] GPU: ${gpu}`);
    if (/swiftshader|software/i.test(gpu)) {
      console.warn(
        '[backend-curve-gate] WARNING: this is the SOFTWARE rasteriser. Every number below is ' +
          'incomparable to a hardware run -- see docs/PERFORMANCE.md capture conditions.'
      );
    }

    if (only.has('pixi')) {
      console.log('\n[backend-curve-gate] === measurePixi ===');
      const page = await freshPage(browser, origin);
      const r = await runInPage<BackendReport>(page, 'measurePixi');
      report.pixi = r;
      printCurve('pixi', r);
      await page.close();
    }

    if (only.has('three')) {
      console.log('\n[backend-curve-gate] === measureThree (billboard) ===');
      const page = await freshPage(browser, origin);
      const r = await runInPage<BackendReport>(page, 'measureThree');
      report.three = r;
      printCurve('three (billboards)', r);
      await page.close();
    }

    if (only.has('three-mesh')) {
      console.log('\n[backend-curve-gate] === measureThreeMesh (real mesh units) ===');
      const page = await freshPage(browser, origin);
      const r = await runInPage<BackendReport>(page, 'measureThreeMesh');
      report.threeMesh = r;
      printCurve('three (real shipped meshes)', r);
      await page.close();
    }

    if (only.has('skinned')) {
      console.log('\n[backend-curve-gate] === measureSkinnedInfantry (R0 spike ceiling stand-in) ===');
      const page = await freshPage(browser, origin);
      report.skinnedInfantry = await runInPage(page, 'measureSkinnedInfantry');
      await page.close();
    }

    mkdirSync(path.dirname(outFile), { recursive: true });
    writeFileSync(outFile, JSON.stringify(report, null, 2));
    console.log(`\n[backend-curve-gate] wrote ${outFile}`);
  } finally {
    await browser.close();
    if (devServer) devServer.kill('SIGTERM');
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
