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
// Usage: npx tsx tools/src/perf/backend-curve-gate.ts [--port=5190]
//   [--out=path.json] [--skip-skinned]

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page, type Browser } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
// Vite dev's own mechanism for serving an arbitrary absolute filesystem
// path, independent of which page/module asks for it -- the same `/@fs/`
// convention `three-units.ts`'s own `repoRootFromModuleUrl()` uses for the
// skinned-infantry spike GLB.
const MODULE_PATH = `/@fs${REPO_ROOT}/tools/src/perf/three-units.ts`;

interface Args {
  port: number;
  outFile: string;
  skipSkinned: boolean;
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
  return {
    port: Number(flags.get('port') ?? 5190),
    outFile: flags.get('out') ?? path.join(REPO_ROOT, '.superpowers', 'perf-evidence-raw.json'),
    skipSkinned: flags.has('skip-skinned'),
  };
}

async function isServerUp(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(1000) });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function waitForServer(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isServerUp(port)) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`backend-curve-gate: dev server on port ${port} did not come up within ${timeoutMs}ms`);
}

/** Same "never kill a server this process did not start" rule
 *  `golden-diff-gate.ts` follows -- reused verbatim rather than re-derived,
 *  because getting this wrong is the one mistake CLAUDE.md explicitly warns
 *  a subagent has made repeatedly (killing a shared `pnpm dev`). */
async function ensureDevServer(port: number): Promise<ChildProcess | null> {
  if (await isServerUp(port)) {
    console.log(`[backend-curve-gate] reusing dev server already listening on :${port} (not managed, will not be killed)`);
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
    await waitForServer(port, 30_000);
  } catch (err) {
    console.error(`[backend-curve-gate] dev server output so far:\n${out}`);
    child.kill('SIGTERM');
    throw err;
  }
  return child;
}

async function freshPage(browser: Browser, port: number): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (err) => console.error('[pageerror]', err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'log' || msg.type() === 'info') console.log(msg.text());
  });
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'load', timeout: 30_000 });
  return page;
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
  const { port, outFile, skipSkinned } = parseArgs(process.argv.slice(2));
  const devServer = await ensureDevServer(port);
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
  };
  try {
    console.log('\n[backend-curve-gate] === measurePixi ===');
    let page = await freshPage(browser, port);
    report.pixi = await runInPage(page, 'measurePixi');
    await page.close();

    console.log('\n[backend-curve-gate] === measureThree (billboard) ===');
    page = await freshPage(browser, port);
    report.three = await runInPage(page, 'measureThree');
    await page.close();

    console.log('\n[backend-curve-gate] === measureThreeMesh (real mesh units) ===');
    page = await freshPage(browser, port);
    report.threeMesh = await runInPage(page, 'measureThreeMesh');
    await page.close();

    if (!skipSkinned) {
      console.log('\n[backend-curve-gate] === measureSkinnedInfantry (R0 spike ceiling stand-in) ===');
      page = await freshPage(browser, port);
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
