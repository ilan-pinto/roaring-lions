// How much memory does the game use, and does leaving a mission give it back?
// (GH-469.)
//
//   pnpm perf:memory                                   # report: menu, board, 3 missions, leaves
//   pnpm perf:memory -- --gate                         # and judge it against memory-budgets.ts
//   pnpm perf:memory -- --missions=a,b --play-s=60 --out=/tmp/mem.json
//   pnpm perf:memory -- --gpu=swiftshader              # CI's rasteriser, on a Mac
//
// ONE browser, ONE page, ONE JS realm for the whole walk -- the menu, the
// campaign board, then each mission booted SOFTLY (a same-origin anchor click,
// which `interceptLinks` turns into a router navigation, exactly what a link
// in the shell does), played for `--play-s` seconds of sim time through
// `__lions.step`, left through the HUD's own leave button, and followed back
// to the menu softly. A hard `page.goto` between missions would hand every
// reading a fresh heap and make the leak check unable to fail.
//
// Five readings at every checkpoint, each after two forced garbage
// collections (CDP `HeapProfiler.collectGarbage`), so what is left is what is
// REACHABLE:
//
//   js       `Runtime.getHeapUsage`: V8's used heap, plus `backingStorageSize`
//            -- the ArrayBuffer backing stores, which `JSHeapUsedSize` does NOT
//            include. Every geometry array, decoded GLB buffer and typed-array
//            sim component lives there. `jsTotal` = used + backing store.
//   gpu      the GL ledger (`memory-ledger.ts`): every byte the page asked WebGL
//            for, per context, live contexts only, plus an estimate of each
//            default framebuffer. Logical bytes, not driver bytes.
//   process  every Chromium process (browser, GPU, renderer, utility), by pid
//            from CDP `SystemInfo.getProcessInfo`: `phys_footprint` on macOS
//            (`footprint`, what Activity Monitor's Memory column shows, which
//            counts the GPU process's Metal allocations) and PSS on Linux
//            (`/proc/<pid>/smaps_rollup`, shared pages split, not counted twice).
//   dom      CDP `Memory.getDOMCounters`: nodes, documents, JS event listeners.
//   uasm     `performance.measureUserAgentSpecificMemory()` -- only in a
//            cross-origin-isolated page, which the dev server is not; the
//            reading says so rather than going missing.
//
// At each mission checkpoint it also reads `__lions.renderer.debugMemoryInventory()`
// (scene and template bytes by owner) and the sim's flow-field pool.
//
// Exit codes: 0 report (or every budget met), 1 OVER BUDGET or a leak check
// failed, 2 the INSTRUMENT failed (bad arguments, a boot that never finished,
// a readback that came back empty), 3 `--gate` with no budget for this capture
// environment -- the same "compared nothing" code the visual gate uses.
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium, type Browser, type CDPSession, type Page } from 'playwright';
import { ensureDevServer, isServerUp, readUnmaskedRenderer, stopDevServer } from '../golden-diff/browser';
import { dismissDeployGate } from '../golden-diff/capture-guard';
import { musicOffInitScript } from '../ui-review/music-off';
import { claimPort } from '../ui-review/port';
import { claimGpuBackend, gpuLaunchArgs } from '../ui-review/gpu';
import { GL_LEDGER_INIT_SCRIPT, liveContexts, liveGpuBytes, type LedgerReadout } from './memory-ledger';
import { envKeyFor, judge, MEMORY_BUDGETS, type Reading } from './memory-budgets';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const TAG = 'perf:memory';

/** The three heaviest missions by what they make the renderer hold, measured
 *  2026-10-08 (see docs/PERFORMANCE.md, "Memory"): every map is 48x48, so the
 *  separator is the mesh payload a mission's roster, structures and decor
 *  plan (`meshPlanFor`) -- 26.0 / 24.5 / 24.4 MiB of GLB on disk, the top
 *  three of 27 -- and among those, the most units and unit types. */
export const DEFAULT_MISSIONS = ['qarn_hadid_3_clearance', 'umm_zeitoun_4_clearance', 'khan_rafid_3_clearance'];

export const EXIT_OK = 0;
export const EXIT_OVER_BUDGET = 1;
export const EXIT_INSTRUMENT = 2;
export const EXIT_NO_BUDGET = 3;

class InstrumentError extends Error {}

interface Args {
  missions: string[];
  playS: number;
  gate: boolean;
  out: string | null;
  /** `dev` (default; what CI runs) or `preview` -- the production build in
   *  `dist/`, served by `vite preview`, which is what a player downloads.
   *  Run `pnpm build` first. */
  serve: 'dev' | 'preview';
  /** CSS viewport and device pixel ratio. Every full-screen target scales
   *  with width x height x dpr^2, so a number without these is half a number. */
  width: number;
  height: number;
  dpr: number;
}

function parseArgs(argv: string[]): Args {
  const get = (k: string): string | undefined => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  const missions = get('missions')?.split(',').filter(Boolean) ?? DEFAULT_MISSIONS;
  const playS = Number(get('play-s') ?? 120);
  if (!Number.isFinite(playS) || playS < 0) throw new InstrumentError(`--play-s must be a number of seconds, got ${get('play-s')}`);
  const [w, h] = (get('viewport') ?? '1400x900').split('x').map(Number);
  const dpr = Number(get('dpr') ?? 1);
  if (!(w > 0 && h > 0 && dpr > 0)) throw new InstrumentError(`--viewport=<w>x<h> and --dpr=<n> must be positive, got ${get('viewport')} / ${get('dpr')}`);
  const serve = get('serve') ?? 'dev';
  if (serve !== 'dev' && serve !== 'preview') throw new InstrumentError(`--serve must be dev or preview, got ${serve}`);
  // Against the repo root, not the cwd: the npm script runs under
  // `pnpm --filter @lions/tools`, whose cwd is tools/ (the golden gate's
  // `--out-dir` was bitten by exactly this).
  const out = get('out');
  return {
    missions,
    playS,
    gate: argv.includes('--gate'),
    out: out ? path.resolve(REPO_ROOT, out) : null,
    serve,
    width: w,
    height: h,
    dpr,
  };
}

const MiB = 1048576;
const mib = (b: number): string => (b / MiB).toFixed(1);

async function processMemory(browserCdp: CDPSession): Promise<{ total: number; byType: Record<string, number>; method: string }> {
  const info = (await browserCdp.send('SystemInfo.getProcessInfo')) as { processInfo: { type: string; id: number }[] };
  const byType: Record<string, number> = {};
  let total = 0;
  let method = '';
  for (const p of info.processInfo) {
    let bytes = 0;
    if (process.platform === 'darwin') {
      method = 'phys_footprint (footprint)';
      bytes = await darwinFootprint(p.id);
    } else if (existsSync(`/proc/${p.id}/smaps_rollup`)) {
      method = 'PSS (/proc/<pid>/smaps_rollup)';
      const m = /^Pss:\s+(\d+) kB/m.exec(readFileSync(`/proc/${p.id}/smaps_rollup`, 'utf8'));
      bytes = m ? Number(m[1]) * 1024 : 0;
    }
    byType[p.type] = (byType[p.type] ?? 0) + bytes;
    total += bytes;
  }
  if (total === 0) throw new InstrumentError('process memory read 0 bytes for every Chromium process');
  return { total, byType, method };
}

function darwinFootprint(pid: number): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn('footprint', ['--noCategories', '-f', 'bytes', '-p', String(pid)], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.on('close', () => {
      const m = /Footprint:\s+(\d+)\s*B/.exec(out);
      resolve(m ? Number(m[1]) : 0);
    });
    child.on('error', () => resolve(0));
  });
}

async function collectGarbage(cdp: CDPSession, page: Page): Promise<void> {
  // An object the page logged is retained by the console for as long as the
  // inspector is attached -- which, under CDP, is always. Drop them first, or
  // a `console.warn(obj)` reads as a leak.
  await cdp.send('Runtime.discardConsoleEntries');
  await cdp.send('HeapProfiler.collectGarbage');
  await page.waitForTimeout(300);
  await cdp.send('HeapProfiler.collectGarbage');
  await page.waitForTimeout(700);
}

async function read(label: string, page: Page, cdp: CDPSession, browserCdp: CDPSession, t0: number): Promise<Reading> {
  await collectGarbage(cdp, page);
  const heap = (await cdp.send('Runtime.getHeapUsage')) as {
    usedSize: number;
    totalSize: number;
    embedderHeapUsedSize?: number;
    backingStorageSize?: number;
  };
  if (heap.backingStorageSize === undefined) {
    throw new InstrumentError('Runtime.getHeapUsage returned no backingStorageSize -- this Chromium is too old to see ArrayBuffers');
  }
  const dom = (await cdp.send('Memory.getDOMCounters')) as { documents: number; nodes: number; jsEventListeners: number };
  const ledger = (await page.evaluate('window.__rlMem ? window.__rlMem.read() : null')) as LedgerReadout | null;
  if (!ledger) throw new InstrumentError(`${label}: the GL ledger is missing -- the init script did not run`);
  const extras = (await page.evaluate(`(async () => {
    const l = window.__lions;
    let inventory = null, sim = null, uasm = null;
    if (l && l.renderer && typeof l.renderer.debugMemoryInventory === 'function') inventory = l.renderer.debugMemoryInventory();
    if (l && l.sim) sim = { entityCount: l.sim.entityCount, tick: l.sim.tickCount, flowFields: l.sim.flowFieldCount ?? null, width: l.sim.width, height: l.sim.height };
    if (self.crossOriginIsolated && performance.measureUserAgentSpecificMemory) {
      try { uasm = (await performance.measureUserAgentSpecificMemory()).bytes; } catch (e) { uasm = 'threw: ' + e; }
    } else uasm = 'unavailable: page is not cross-origin isolated';
    return { inventory, sim, uasm };
  })()`)) as Pick<Reading, 'inventory' | 'sim' | 'uasm'>;
  const proc = await processMemory(browserCdp);
  const r: Reading = {
    label,
    atS: (Date.now() - t0) / 1000,
    js: {
      used: heap.usedSize,
      total: heap.totalSize,
      backing: heap.backingStorageSize,
      embedder: heap.embedderHeapUsedSize ?? 0,
      jsTotal: heap.usedSize + heap.backingStorageSize,
    },
    dom: { nodes: dom.nodes, documents: dom.documents, listeners: dom.jsEventListeners },
    gpu: {
      liveBytes: liveGpuBytes(ledger),
      liveContexts: liveContexts(ledger),
      retainedLostContexts: ledger.contexts.filter((c) => c.lost).length,
      ledger,
    },
    process: proc,
    ...extras,
  };
  console.log(
    `[${TAG}] ${label.padEnd(34)} js ${mib(r.js.used).padStart(7)} + ab ${mib(r.js.backing).padStart(7)} = ${mib(r.js.jsTotal).padStart(7)} MiB` +
      `   gpu ${mib(r.gpu.liveBytes).padStart(7)} MiB in ${r.gpu.liveContexts} ctx (${r.gpu.retainedLostContexts} lost, still reachable)` +
      `   process ${mib(r.process.total).padStart(7)} MiB   nodes ${r.dom.nodes} listeners ${r.dom.listeners}`
  );
  return r;
}

/** A same-origin anchor click, which the shell's `interceptLinks` turns into
 *  a router navigation -- a SOFT one, the way every link in the shell works. */
async function softNav(page: Page, href: string): Promise<void> {
  await page.evaluate((h) => {
    const a = document.createElement('a');
    a.href = h;
    a.textContent = 'perf:memory';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, href);
}

async function waitForMenu(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const h = document.querySelector('.rl-scene-host')?.getAttribute('data-host');
      return h !== undefined && h !== null && h !== 'pending';
    },
    null,
    { timeout: 90_000 }
  );
}

async function waitForBoard(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const wrap = document.querySelector('.rl-world');
      return wrap instanceof HTMLElement && (wrap.dataset.board === 'flat' || wrap.dataset.board === 'diorama');
    },
    null,
    { timeout: 90_000 }
  );
}

async function playMission(page: Page, id: string, playS: number): Promise<void> {
  await dismissDeployGate(page, `${TAG} ${id}`, { selectorTimeoutMs: 120_000, timeoutMs: 120_000 });
  await page.waitForFunction(() => (window as unknown as { __lions?: unknown }).__lions !== undefined, null, { timeout: 60_000 });
  // `playS` of sim time at 20 Hz, in 10 s slices with a real pause between
  // them so the frame loop draws (and the renderer's pools and VFX fill) as
  // the battle advances, rather than one 2,400-tick jump and one frame.
  const ticks = Math.round(playS * 20);
  for (let done = 0; done < ticks; done += 200) {
    const n = Math.min(200, ticks - done);
    await page.evaluate((k) => (window as unknown as { __lions: { step(n: number): number } }).__lions.step(k), n);
    await page.waitForTimeout(250);
  }
}

async function leaveMission(page: Page): Promise<string> {
  const leave = page.locator('.rl-hud__leave');
  if (await leave.isVisible().catch(() => false)) {
    await leave.click({ timeout: 60_000 });
    await page.locator('.rl-confirm__yes').click({ timeout: 60_000 });
    await waitForBoard(page);
    return 'HUD leave + confirm';
  }
  // The end screen (victory/defeat inside the play window) covers the HUD;
  // the router is the same either way.
  await softNav(page, '/campaign');
  await waitForBoard(page);
  return 'soft link to /campaign (the HUD leave was not visible)';
}

async function main(): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`[${TAG}] ${err instanceof Error ? err.message : String(err)}`);
    return EXIT_INSTRUMENT;
  }
  const backend = claimGpuBackend(TAG);
  const port = await claimPort(TAG, 'PERF_MEMORY_PORT', 5178);
  let server: ChildProcess | null = null;
  let browser: Browser | null = null;
  const t0 = Date.now();
  try {
    server = args.serve === 'preview' ? await startPreview(port) : await ensureDevServer(port, REPO_ROOT, TAG);
    browser = await chromium.launch({ headless: true, args: gpuLaunchArgs(backend) });
    const renderer = await readUnmaskedRenderer(browser);
    const env = envKeyFor(process.platform, process.arch, renderer);
    console.log(
      `[${TAG}] renderer: ${renderer}  env: ${env}  platform ${process.platform}/${process.arch}  ` +
        `viewport ${args.width}x${args.height} @${args.dpr}x  serve=${args.serve}  play ${args.playS} s sim time per mission`
    );
    const context = await browser.newContext({ viewport: { width: args.width, height: args.height }, deviceScaleFactor: args.dpr });
    await context.addInitScript(musicOffInitScript());
    await context.addInitScript(GL_LEDGER_INIT_SCRIPT);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    const browserCdp = await browser.newBrowserCDPSession();
    const readings: Reading[] = [];
    const base = `http://localhost:${port}`;

    await page.goto(`${base}/`, { waitUntil: 'load' });
    await waitForMenu(page);
    await page.waitForTimeout(3000);
    readings.push(await read('menu', page, cdp, browserCdp, t0));

    await softNav(page, '/campaign');
    await waitForBoard(page);
    await page.waitForTimeout(3000);
    readings.push(await read('board', page, cdp, browserCdp, t0));

    await softNav(page, '/');
    await waitForMenu(page);
    await page.waitForTimeout(3000);
    readings.push(await read('menu (again, after the board)', page, cdp, browserCdp, t0));

    for (const id of args.missions) {
      await softNav(page, `/mission/${id}`);
      await playMission(page, id, args.playS);
      readings.push(await read(`mission ${id}`, page, cdp, browserCdp, t0));
      const how = await leaveMission(page);
      console.log(`[${TAG}] left ${id} by ${how}`);
      await softNav(page, '/');
      await waitForMenu(page);
      await page.waitForTimeout(3000);
      readings.push(await read(`menu after ${id}`, page, cdp, browserCdp, t0));
    }
    const boots = (await page.evaluate('performance.getEntriesByType("navigation").length')) as number;
    if (errors.length > 0) console.warn(`[${TAG}] ${errors.length} page error(s); first: ${errors[0].slice(0, 300)}`);
    console.log(`[${TAG}] walk took ${((Date.now() - t0) / 1000).toFixed(0)} s, ${boots} document load(s)`);

    printAttribution(readings);
    if (args.out) {
      mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
      writeFileSync(args.out, JSON.stringify({ env, renderer, args, readings }, null, 2));
      console.log(`[${TAG}] wrote ${args.out}`);
    }
    if (!args.gate) return EXIT_OK;
    const budget = MEMORY_BUDGETS[env];
    if (!budget) {
      console.error(`[${TAG}] --gate: no budget for capture environment "${env}" -- nothing was judged (exit 3).`);
      return EXIT_NO_BUDGET;
    }
    const verdicts = judge(readings, budget);
    for (const v of verdicts) console.log(`[${TAG}] ${v.ok ? 'PASS' : 'FAIL'}  ${v.detail}`);
    const failed = verdicts.filter((v) => !v.ok).length;
    console.log(`[${TAG}] ${failed === 0 ? 'every budget met' : `${failed} check(s) OVER BUDGET`} (${budget.conditions})`);
    return failed === 0 ? EXIT_OK : EXIT_OVER_BUDGET;
  } catch (err) {
    console.error(`[${TAG}] INSTRUMENT FAILED: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    return EXIT_INSTRUMENT;
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    stopDevServer(server, TAG);
  }
}

async function startPreview(port: number): Promise<ChildProcess> {
  if (!existsSync(path.join(REPO_ROOT, 'packages', 'app', 'dist', 'index.html'))) throw new InstrumentError('--serve=preview needs a build: run `pnpm build` first');
  const child = spawn('pnpm', ['--filter', '@lions/app', 'exec', 'vite', 'preview', '--port', String(port), '--strictPort'], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await isServerUp(port)) return child;
    await new Promise((r) => setTimeout(r, 250));
  }
  stopDevServer(child, TAG);
  throw new InstrumentError(`vite preview did not come up on :${port}`);
}

function printAttribution(readings: Reading[]): void {
  for (const r of readings) {
    if (!r.inventory) continue;
    console.log(`\n[${TAG}] ${r.label}: scene + templates by owner (geometry arrays are JS-heap AND GPU; textures are GPU estimates)`);
    console.log('  owner                          geo MiB   tex MiB   geos  texs');
    for (const g of r.inventory.groups.slice(0, 18)) {
      console.log(
        `  ${g.label.padEnd(30)} ${mib(g.geometryBytes).padStart(8)}  ${mib(g.textureBytes).padStart(8)}  ${String(g.geometries).padStart(5)} ${String(g.textures).padStart(5)}` +
          (g.topTextures[0] ? `   largest tex ${g.topTextures[0][1]}x${g.topTextures[0][2]} ${mib(g.topTextures[0][3])} MiB ${g.topTextures[0][0]}` : '')
      );
    }
    for (const c of r.gpu.ledger.contexts.filter((x) => !x.lost)) {
      console.log(
        `  GL ctx ${c.id} ${c.canvas.join('x')}${c.inDom ? '' : ' (canvas NOT in DOM)'}: tex ${mib(c.texture.bytes)} MiB (${c.texture.count})  buf ${mib(c.buffer.bytes)} MiB (${c.buffer.count})  rb ${mib(c.renderbuffer.bytes)} MiB (${c.renderbuffer.count})  framebuffer~ ${mib(c.drawingBufferEst)} MiB`
      );
      for (const t of c.topTextures.slice(0, 10)) console.log(`      tex ${t[0]}x${t[1]}x${t[2]}  ${mib(t[3]).padStart(6)} MiB  ${t[4]}`);
      for (const t of c.renderbuffers) console.log(`      rb  ${t[0]}x${t[1]}  ${mib(t[3]).padStart(6)} MiB  ${t[4]}`);
    }
    console.log(`  pixel sources still reachable: ${mib(r.gpu.ledger.sources.bytes)} MiB (${r.gpu.ledger.sources.count}) ${JSON.stringify(r.gpu.ledger.sources.byKind)}`);
    console.log(`  decoded audio still reachable: ${mib(r.gpu.ledger.audio.bytes)} MiB (${r.gpu.ledger.audio.count})`);
    console.log(`  sim: ${JSON.stringify(r.sim)}  process by type: ${JSON.stringify(Object.fromEntries(Object.entries(r.process.byType).map(([k, v]) => [k, mib(v)])))}`);
    if (r.gpu.ledger.unknownFormats.length) console.log(`  unknown GL formats counted at 4 B/texel: ${r.gpu.ledger.unknownFormats.join(', ')}`);
  }
}

main().then(
  (code) => {
    process.stdout.write('', () => process.exit(code));
  },
  (err: unknown) => {
    console.error(`[${TAG}] ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    process.exit(EXIT_INSTRUMENT);
  }
);
