/**
 * GH-943 WebGPU-primary P1 T9: the lead's sheet and the Metal run, in ONE browser lock hold.
 *
 *   pnpm --filter @lions/tools exec tsx src/perf/webgpu-p1-sheet.ts --out-dir=<dir> [--port=5191] [--abba-rounds=6] [--max-load=4]
 *       [--lock=<dir>] [--skip=abba,sheet,bloom,raf]
 *
 * Steps, strictly one browser at a time (each child is a tool that owns its own dev server on its own port and stops only that):
 *   1. GH-829 ABBA at 300 and 600 units, F and G against L-matched (`webgpu-abba-run.ts`, AO on both sides, the harness' own refusals).
 *   2. THE SHEET: `?sandbox=wadi_halam_4`, the booted camera, the parked force, the frame loop frozen at boot (the app's own flag on
 *      the node arms, the rAF-dropping boot script on legacy), quality high, music off, 1440x900 at DPR 2. Columns z1, z1.6, z2.5;
 *      rows L-matched (legacy with the node scene's `censusUnported` hidden set hidden, AO ON), G (node on WebGPU), F (node on WebGL2);
 *      6 difference panels (x8); one L-shipped reference at z1; a 2x minimap crop per arm. Each frame states synced ms (median of
 *      round medians plus spread), triangles, draws, the backend and the adapter string.
 *   3. The bloom census on G and F (`bloom-census.ts --gpu=webgpu|webgl2 --hw=metal`), quiet max under 0.9.
 *   4. The rAF re-check (`webgpu-raf-hypothesis.ts`).
 *   5. A count of GPUValidationErrors over every page of the sheet and every child's output.
 * REFUSES (exit 2) without `--lock=<dir>` naming an existing directory (the caller holds BROWSER.lock), on a loaded machine, or on a
 * page that is not hardware Metal. Writes `p1-sheet.png`, the frames, the panels and `p1-numbers.md` into --out-dir.
 */
import { chromium, type Browser, type Page } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import { bootFreezeRefusal, bootFreezeScriptFor, BOOT_SETTLE_SCRIPT, CAPTURE_PRECONDITION_STATEMENTS, FREEZE_FRAME_LOOP_SCRIPT, HIDE_ALERT_FEED_STATEMENTS, HUD_WALL_CLOCK_SETTLE_MS, NODE_REPAINT_SCRIPT, REPAINT_SCRIPT, hideHudExceptCanvas, threeUrl, type Scenario } from '../golden-diff/capture-protocol';
import { devServerStopper, ensureDevServer } from '../golden-diff/browser';
import type { GpuArm } from '../golden-diff/backend';
import { gpuLaunchArgs } from '../ui-review/gpu';
import { musicOffInitScript } from '../ui-review/music-off';
import { claimPort } from '../ui-review/port';
import { loadRefusal, MAX_LOADAVG_1M } from './webgpu-abba';
import {
  countValidationErrors,
  diffPanel,
  gateTable,
  parseQuietMax,
  r0Outside,
  syncedSummary,
  type AbbaVerdictRow,
} from './webgpu-p1-sheet-lib';

const args = process.argv.slice(2);
const arg = (n: string, d: string): string => (args.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).slice(n.length + 3);
const TOOLS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ROOT = path.resolve(TOOLS, '..');
const OUT = path.resolve(arg('out-dir', ''));
const MAX_LOAD = Number(arg('max-load', String(MAX_LOADAVG_1M)));
const ABBA_ROUNDS = Number(arg('abba-rounds', '6'));
const WAIT_QUIET = Number(arg('wait-quiet', '10'));
const LOCK = arg('lock', '');
const DPR = Number(arg('dpr', '2'));
const QUALITY = arg('quality', 'high') as 'low' | 'medium' | 'high';
const ONLY = arg('arms', 'L,G,F,LS').split(',') as SheetArm[];
const SKIP = new Set(arg('skip', '').split(',').filter((s) => s !== ''));
const MAP = 'wadi_halam_4';
const ZOOMS = [1, 1.6, 2.5] as const;
const ROUNDS = 5;
const FRAMES = 20;
/** Child tools take consecutive ports from this one; the sheet's own server takes `--port`. */
const BASE_PORT = Number(arg('child-port', '5192'));

function refuse(msg: string): never {
  console.error(`webgpu-p1-sheet: REFUSED: ${msg}`);
  process.exit(2);
}
if (args.find((a) => a.startsWith('--out-dir=')) === undefined) refuse('--out-dir=<dir> is required');
if (LOCK === '' || !existsSync(LOCK)) refuse('--lock=<dir> must name the BROWSER.lock directory the caller holds (mkdir it first)');
mkdirSync(OUT, { recursive: true });

const SHEET_SCENARIO: Scenario = { id: 'p1-sheet', description: 'the lead\'s P1 sheet: wadi_halam_4, booted camera', sandboxMap: MAP, ticks: 0, cameraMarker: 'unused' };

async function untilQuiet(minutes: number): Promise<number> {
  const deadline = Date.now() + minutes * 60_000;
  for (;;) {
    const l = os.loadavg()[0] as number;
    if (loadRefusal(l, MAX_LOAD) === null) return l;
    if (Date.now() >= deadline) refuse(loadRefusal(l, MAX_LOAD) as string);
    await new Promise((res) => setTimeout(res, 5000));
  }
}

interface ChildResult {
  code: number;
  out: string;
  load: number;
}
/** Runs one sibling tool to completion, streaming its output. Its own dev server and browser are its own business. */
async function runTool(file: string, toolArgs: string[]): Promise<ChildResult> {
  const load = await untilQuiet(WAIT_QUIET);
  console.log(`\n[p1-sheet] >>> ${file} ${toolArgs.join(' ')} (loadavg ${load.toFixed(2)})`);
  return new Promise((resolve) => {
    const child = spawn('pnpm', ['exec', 'tsx', file, ...toolArgs], { cwd: TOOLS, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const take = (b: Buffer): void => {
      out += b.toString();
      process.stdout.write(b);
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('close', (code) => resolve({ code: code ?? 1, out, load }));
  });
}

// ---------------------------------------------------------------------------------------------------------------------------
// The sheet.
// ---------------------------------------------------------------------------------------------------------------------------

type SheetArm = 'L' | 'G' | 'F' | 'LS';
const ARM_OF: Record<SheetArm, GpuArm> = { L: 'legacy', G: 'webgpu', F: 'webgl2', LS: 'legacy' };
const UNPORTED = `/@fs${ROOT}/packages/render/src/three/backend/unported.ts`;

interface FrameReading {
  zoom: number;
  png: string;
  settled: boolean;
  syncedMs: number;
  syncedSpread: number;
  rounds: number[];
  triangles: number;
  draws: number;
}
interface ArmSheet {
  arm: SheetArm;
  backend: string;
  adapter: string;
  gpu: string;
  load: number;
  camera: { x: number; y: number };
  tick: number;
  frames: FrameReading[];
  minimap: string;
  consoleLines: string[];
}

/** One zoom: set it, wait the renderer's own frame (a node arm redraws once per rAF frameId), repaint with zero time. */
const zoomScript = (arm: SheetArm, zoom: number): string => `(async () => {
  const R = window.__lions.renderer;
  R.camera.zoom = ${zoom};
${arm === 'L' ? `  { const u = await import(${JSON.stringify(UNPORTED)}); u.censusUnported(R.scene); }\n` : ''}${arm === 'LS' ? '' : ''}${ARM_OF[arm] === 'legacy' ? '' : '  await new Promise(function (r) { window.requestAnimationFrame(function () { r(); }); });\n'}  R.frame(1, 0);
${ARM_OF[arm] === 'legacy' ? '' : '  await R.whenGpuIdle();\n'}  return JSON.stringify({ zoom: R.camera.zoom, x: R.camera.x, y: R.camera.y, tick: window.__lions.sim.tickCount });
})()`;

/** Synced frame time, `rounds` rounds of `frames` frames each, plus whole-frame triangles and draw calls from one counted frame. */
const timeScript = (arm: SheetArm): string => `(async () => {
  const R = window.__lions.renderer;
  const kind = R.backendInfo().kind;
  const nb = R.nodeBackend;
  const node = kind !== 'legacy-gl';
  const gl = kind === 'node-webgpu' ? null : R.canvas.getContext('webgl2');
  const px = new Uint8Array(4);
  async function sync() { if (gl) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); else await R.whenGpuIdle(); }
  function tick() { return new Promise(function (res) { requestAnimationFrame(function () { res(); }); }); }
  async function one() {
    if (node) await tick();
    const t0 = performance.now();
    R.frame(1, 0);
    await sync();
    return performance.now() - t0;
  }
  for (let i = 0; i < 12; i++) await one();
  let triangles = 0, draws = 0;
  if (nb) {
    await tick();
    R.frame(1, 0);
    const s = nb.stats();
    triangles = s.triangles; draws = s.calls;
    await sync();
  } else {
    const info = R.renderer.info;
    info.autoReset = false; info.reset();
    R.frame(1, 0);
    triangles = info.render.triangles; draws = info.render.calls;
    info.autoReset = true;
    await sync();
  }
  const rounds = [];
  for (let r = 0; r < ${ROUNDS}; r++) {
    const v = [];
    for (let i = 0; i < ${FRAMES}; i++) v.push(await one());
    v.sort(function (a, b) { return a - b; });
    rounds.push(v[Math.floor(v.length / 2)]);
  }
  return JSON.stringify({ rounds, triangles, draws, arm: ${JSON.stringify(arm)} });
})()`;

async function sheetArm(browser: Browser, arm: SheetArm, port: number): Promise<ArmSheet> {
  const load = await untilQuiet(WAIT_QUIET);
  const lines: string[] = [];
  const page: Page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: DPR });
  page.on('pageerror', (e) => lines.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') lines.push(m.text());
  });
  await page.addInitScript(musicOffInitScript({}, { quality: QUALITY }));
  await page.addInitScript('window.__name = (f) => f;');
  await page.addInitScript(bootFreezeScriptFor(ARM_OF[arm]));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(threeUrl(port, SHEET_SCENARIO, ARM_OF[arm]), { waitUntil: 'load', timeout: 60_000 });
  await page.waitForFunction(() => typeof (window as unknown as { __lions?: unknown }).__lions !== 'undefined', undefined, { timeout: 60_000 });
  await page.evaluate(FREEZE_FRAME_LOOP_SCRIPT);
  await page.evaluate(() => document.fonts.ready);
  const settled = JSON.parse((await page.evaluate(BOOT_SETTLE_SCRIPT)) as string) as { tick: number };
  const refusal = bootFreezeRefusal(settled.tick);
  if (refusal !== null) refuse(`${arm}: ${refusal}`);
  const info = (await page.evaluate(() => {
    const L = (window as unknown as { __lions: { renderer: { backendInfo(): { kind: string; adapter: string } } } }).__lions;
    return L.renderer.backendInfo();
  })) as { kind: string; adapter: string };
  const gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext ? String(gl?.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  });
  const onMetal = ARM_OF[arm] === 'webgpu' ? /metal/i.test(info.adapter) : /metal/i.test(gpu) && !/swiftshader/i.test(gpu);
  if (!onMetal) refuse(`${arm}: draws on "${ARM_OF[arm] === 'webgpu' ? info.adapter : gpu}", not hardware Metal`);
  const want = ARM_OF[arm] === 'legacy' ? 'legacy-gl' : ARM_OF[arm] === 'webgl2' ? 'node-webgl2' : 'node-webgpu';
  if (info.kind !== want) refuse(`${arm}: backendInfo().kind is "${info.kind}", expected "${want}" (a fallback is evidence about the fallback)`);

  // The HUD's wall-clock animations run out and the minimap is redrawn fresh, on every arm alike; the crop is taken before the HUD goes.
  await page.evaluate(
    `(async () => { ${HIDE_ALERT_FEED_STATEMENTS}\n await new Promise(function (r) { setTimeout(r, ${HUD_WALL_CLOCK_SETTLE_MS}); }); window.__lions.redrawMinimap(); await window.__lions.renderer.groundPhotoSettled?.(); window.__lions.redrawMinimap(true); ${CAPTURE_PRECONDITION_STATEMENTS} })()`
  );
  const minimapFile = path.join(OUT, `minimap-${arm}.png`);
  await page.locator('.rl-minimap').first().screenshot({ path: minimapFile });
  await page.evaluate(hideHudExceptCanvas);

  const frames: FrameReading[] = [];
  const zooms = arm === 'LS' ? [1] : [...ZOOMS];
  let camera = { x: 0, y: 0 };
  let tick = 0;
  for (const z of zooms) {
    const z0 = JSON.parse((await page.evaluate(zoomScript(arm, z))) as string) as { x: number; y: number; tick: number };
    camera = { x: z0.x, y: z0.y };
    tick = z0.tick;
    const rect = (await page.evaluate(() => {
      const r = document.querySelector('canvas')?.getBoundingClientRect();
      return { x: r?.x ?? 0, y: r?.y ?? 0, w: r?.width ?? 0, h: r?.height ?? 0 };
    })) as { x: number; y: number; w: number; h: number };
    const clip = { x: rect.x, y: rect.y, width: rect.w, height: rect.h };
    // Units whose mesh template warmed late are instantiated BY a frame (the boot settle's own reason): pump paced frames at this view,
    // then a fixed tail, so the zero-time repaints below meet a scene with nothing left to arrive.
    await page.evaluate(
      `(async () => { const R = window.__lions.renderer; for (let i = 0; i < 20; i++) { ${ARM_OF[arm] === 'legacy' ? '' : 'await new Promise(function (r) { window.requestAnimationFrame(function () { r(); }); });'} R.frame(1, 100); await new Promise(function (r) { setTimeout(r, 100); }); } ${ARM_OF[arm] === 'legacy' ? '' : 'await R.whenGpuIdle();'} })()`
    );
    const repaint = ARM_OF[arm] === 'legacy' ? REPAINT_SCRIPT : NODE_REPAINT_SCRIPT;
    // The settled-frame check of the capture protocol: two zero-time repaints must read byte-identical. Up to 3 tries, then it is said.
    let png: Buffer = Buffer.alloc(0);
    let ok = false;
    let unsettledPx = 0;
    // A WebGPU canvas screenshot reads black under headless Metal (the swap-chain texture is gone by the time the compositor looks),
    // so the G frame is copied out in the SAME task as the render that drew it. The other arms are photographed as the gate does.
    const grab = async (): Promise<Buffer> => {
      if (ARM_OF[arm] !== 'webgpu') {
        await page.evaluate(repaint);
        return page.screenshot({ clip });
      }
      const b64 = (await page.evaluate(`(async () => {
        const R = window.__lions.renderer;
        await new Promise(function (r) { window.requestAnimationFrame(function () { r(); }); });
        R.frame(1, 0);
        const c = document.createElement('canvas');
        c.width = R.canvas.width; c.height = R.canvas.height;
        c.getContext('2d').drawImage(R.canvas, 0, 0);
        await R.whenGpuIdle();
        return c.toDataURL('image/png').split(',')[1];
      })()`)) as string;
      return Buffer.from(b64, 'base64');
    };
    for (let t = 0; t < 3 && !ok; t++) {
      const a = await grab();
      png = await grab();
      ok = a.equals(png);
      if (!ok) unsettledPx = diffPanel(PNG.sync.read(a), PNG.sync.read(png)).changedPixels;
    }
    if (!ok) console.log(`[p1-sheet] ${arm} z${z}: two repaints differ by ${unsettledPx} px`);
    const file = path.join(OUT, `frame-${arm}-z${z}.png`);
    writeFileSync(file, png);
    const t = JSON.parse((await page.evaluate(timeScript(arm))) as string) as { rounds: number[]; triangles: number; draws: number };
    const s = syncedSummary(t.rounds);
    frames.push({ zoom: z, png: file, settled: ok, syncedMs: s.value, syncedSpread: s.spread, rounds: t.rounds, triangles: t.triangles, draws: t.draws });
    console.log(`[p1-sheet] ${arm} z${z}: synced ${s.value.toFixed(2)} ms (spread ${s.spread.toFixed(2)}), tris ${t.triangles}, draws ${t.draws}${ok ? '' : ' UNSETTLED'}`);
  }
  writeFileSync(path.join(OUT, `console-${arm}.txt`), lines.join('\n'));
  await page.close();
  return { arm, backend: info.kind, adapter: info.adapter, gpu: ARM_OF[arm] === 'webgpu' ? info.adapter : gpu, load, camera, tick, frames, minimap: minimapFile, consoleLines: lines };
}

const loadPng = (f: string): PNG => PNG.sync.read(readFileSync(f));

interface PanelRow {
  name: string;
  zoom: number;
  file: string;
  mean: number;
  changed: number;
}

async function buildSheet(arms: Map<SheetArm, ArmSheet>): Promise<{ panels: PanelRow[]; sheet: string }> {
  const panels: PanelRow[] = [];
  const L = arms.get('L') as ArmSheet;
  for (const t of ['G', 'F'] as const) {
    for (const z of ZOOMS) {
      const a = loadPng((L.frames.find((f) => f.zoom === z) as FrameReading).png);
      const b = loadPng(((arms.get(t) as ArmSheet).frames.find((f) => f.zoom === z) as FrameReading).png);
      const d = diffPanel(a, b);
      const file = path.join(OUT, `diff-${t}-L-z${z}.png`);
      writeFileSync(file, PNG.sync.write(d.png));
      panels.push({ name: `${t} - L`, zoom: z, file, mean: d.meanAbsChannelDelta, changed: d.changedPixels });
    }
  }
  const rel = (f: string): string => path.basename(f);
  const cap = (a: ArmSheet, f: FrameReading): string =>
    `<div class="cap">${a.arm === 'LS' ? 'L shipped' : a.arm === 'L' ? 'L matched' : a.arm} z${f.zoom}: synced ${f.syncedMs.toFixed(2)} ms (spread ${f.syncedSpread.toFixed(2)}, ${f.rounds.length} rounds), ${f.triangles.toLocaleString()} tris, ${f.draws} draws${f.settled ? '' : ' UNSETTLED'}<br>${a.backend} / ${a.adapter} / load ${a.load.toFixed(2)}</div>`;
  const cell = (a: ArmSheet, z: number): string => {
    const f = a.frames.find((x) => x.zoom === z) as FrameReading;
    return `<div class="c"><img src="${rel(f.png)}">${cap(a, f)}</div>`;
  };
  const rows = (['L', 'G', 'F'] as const).map((id) => `<div class="row">${ZOOMS.map((z) => cell(arms.get(id) as ArmSheet, z)).join('')}</div>`).join('');
  const diffRows = (['G', 'F'] as const)
    .map(
      (t) =>
        `<div class="row">${panels
          .filter((p) => p.name.startsWith(t))
          .map((p) => `<div class="c"><img src="${rel(p.file)}"><div class="cap">|${p.name}| x8 at z${p.zoom}: mean abs channel delta ${p.mean.toFixed(4)}, ${p.changed.toLocaleString()} px changed</div></div>`)
          .join('')}</div>`
    )
    .join('');
  const LS = arms.get('LS') as ArmSheet;
  const mini = (['L', 'G', 'F'] as const).map((id) => `<div class="m"><img src="${rel((arms.get(id) as ArmSheet).minimap)}"><div class="cap">${id} minimap, 2x</div></div>`).join('');
  const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;padding:16px;background:#111;color:#ddd;font:13px/1.35 ui-monospace,Menlo,monospace;width:1800px}
.row{display:flex;gap:8px;margin-bottom:8px}.c{width:588px}.c img{width:588px;display:block}.m img{display:block}.cap{padding:2px 0}
h2{margin:14px 0 6px;font-size:14px}
</style>
<h2>GH-943 WebGPU P1 sheet: ${MAP}, booted camera (${L.camera.x.toFixed(1)}, ${L.camera.y.toFixed(1)}), parked force, tick ${L.tick}, quality high, 1440x900 DPR 2, music off</h2>
<h2>Rows: L matched (AO on), G (node on WebGPU), F (node on WebGL2). Columns: z1, z1.6, z2.5.</h2>${rows}
<h2>Differences (x8)</h2>${diffRows}
<h2>L shipped at z1 (the player's frame, no census), and the minimap per arm</h2>
<div class="row">${cell(LS, 1)}<div class="c" style="display:flex;gap:8px;align-items:flex-start">${mini}</div></div>`;
  const htmlFile = path.join(OUT, 'p1-sheet.html');
  writeFileSync(htmlFile, html);
  return { panels, sheet: htmlFile };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------------------------------------------------------

const startedAt = new Date().toISOString();
const startLoad = await untilQuiet(WAIT_QUIET);
const md: string[] = [];
let abbaRows: AbbaVerdictRow[] = [];
let triangles: { zoom: number; L: number; F: number; G: number }[] = [];
let abbaNote = 'skipped';
let abbaRefusal = '';
let abbaLoads = '';
let validation = 0;
const consoleAll: string[] = [];

if (!SKIP.has('abba')) {
  const jsonFile = path.join(OUT, 'abba.json');
  const abbaArgs = (armList: string): string[] => [`--port=${BASE_PORT}`, `--root=${ROOT}`, '--counts=300,600', `--rounds=${ABBA_ROUNDS}`, '--frames=60', `--wait-quiet=${WAIT_QUIET}`, `--max-load=${MAX_LOAD}`, `--arms=${armList}`, '--legacy=matched', `--out=${jsonFile}`];
  let r = await runTool('src/perf/webgpu-abba-run.ts', abbaArgs('F,G'));
  validation += countValidationErrors(r.out.split('\n'));
  if (r.code === 2 && /GPUValidationError/i.test(r.out)) {
    // The harness refuses any timing taken while a validation error is in the console. Say so, and still time F (a WebGL arm).
    abbaRefusal = r.out.split('\n').filter((l) => /REFUSED|arm G|arm F/.test(l)).slice(0, 4).join(' | ');
    r = await runTool('src/perf/webgpu-abba-run.ts', abbaArgs('F'));
  }
  if (r.code !== 0 || !existsSync(jsonFile)) abbaNote = `FAILED (exit ${r.code}); no timing exists`;
  else {
    const j = JSON.parse(readFileSync(jsonFile, 'utf8')) as {
      conditions: string;
      loads: { load1m: number }[];
      verdict: (AbbaVerdictRow & { l: { value: number; spread: number }; t: { value: number; spread: number }; cpuRenderL: number; cpuRenderT: number })[];
      sample: Record<string, { views: { zoom: number; triangles: number; frameTriangles: number }[] }>;
    };
    abbaRows = j.verdict;
    abbaNote = j.conditions;
    abbaLoads = `${Math.min(...j.loads.map((l) => l.load1m)).toFixed(2)} to ${Math.max(...j.loads.map((l) => l.load1m)).toFixed(2)} (1-minute, per page)`;
    triangles = [1, 2.5].map((zoom) => {
      const tri = (a: string): number => j.sample[a]?.views.find((v) => v.zoom === zoom)?.triangles ?? 0;
      return { zoom, L: tri('L'), F: tri('F'), G: tri('G') };
    });
    md.push('## 2. GH-829 ABBA (F and G against L matched, AO on)', '', ...(abbaRefusal === '' ? [] : [`**G was REFUSED by the harness: ${abbaRefusal}.** F was re-run alone.`, '']), `Conditions: ${j.conditions}`, '', '| point | L synced ms (spread) | test synced ms (spread) | ratio | bar | verdict | CPU render L / test ms |', '|---|---|---|---|---|---|---|');
    for (const v of j.verdict) {
      md.push(`| n${v.target} ${v.test} | ${v.l.value.toFixed(2)} (${v.l.spread.toFixed(2)}) | ${v.t.value.toFixed(2)} (${v.t.spread.toFixed(2)}) | x${v.ratio.toFixed(3)}${v.withinSpread ? ' inside spread' : ''} | ${v.test === 'G' ? 1.05 : 1.1} | ${v.met ? 'MET' : 'NOT MET'} | ${v.cpuRenderL.toFixed(2)} / ${v.cpuRenderT.toFixed(2)} |`);
    }
    md.push('', 'Triangle agreement (ABBA, AO on; the harness refuses above 1%):', '', '| zoom | L | F | G |', '|---|---|---|---|', ...triangles.map((t) => `| z${t.zoom} | ${t.L} | ${t.F} | ${t.G} |`), '');
  }
}

let sheetFrames = 0;
let sheetUnsettled = 0;
const sheetTris = new Map<string, number>();
const sheetNumbers: string[] = [];
if (!SKIP.has('sheet')) {
  const port = await claimPort('webgpu-p1-sheet', 'WEBGPU_P1_SHEET_PORT', 5191);
  const stop = devServerStopper(await ensureDevServer(port, ROOT, 'webgpu-p1-sheet'), 'webgpu-p1-sheet');
  const browser = await chromium.launch({ headless: true, args: [...gpuLaunchArgs('metal'), '--enable-unsafe-webgpu'] });
  const arms = new Map<SheetArm, ArmSheet>();
  try {
    for (const a of ONLY) arms.set(a, await sheetArm(browser, a, port));
  } finally {
    await browser.close();
    stop();
  }
  for (const a of arms.values()) {
    consoleAll.push(...a.consoleLines);
    sheetFrames += a.frames.length;
    for (const f of a.frames) sheetTris.set(`${a.arm}${f.zoom}`, f.triangles);
    sheetUnsettled += a.frames.filter((f) => !f.settled).length;
  }
  // 9 + 1 = 10 frames. The minimap crops are counted by their files existing (they were written or the run threw).
  const { panels, sheet } = await buildSheet(arms);
  const b2 = await chromium.launch({ headless: true });
  const p2 = await b2.newPage({ viewport: { width: 1832, height: 900 } });
  await p2.goto(pathToFileURL(sheet).href);
  await p2.waitForFunction(() => Array.from(document.images).every((i) => i.complete));
  await p2.screenshot({ path: path.join(OUT, 'p1-sheet.png'), fullPage: true });
  await b2.close();
  sheetNumbers.push('## 1. The sheet', '', `File: ${path.join(OUT, 'p1-sheet.png')}`, '', `Boot: \`?sandbox=${MAP}\`, the booted camera, the parked force, sim tick ${[...arms.values()][0]?.tick}, quality high, music off, 1440x900 at DPR 2, Chromium ANGLE/Metal, reduced motion.`, '', '| frame | backend | adapter | load at start | synced ms (median of ' + ROUNDS + ' round medians, spread) | triangles | draws | settled |', '|---|---|---|---|---|---|---|---|');
  for (const a of arms.values())
    for (const f of a.frames) sheetNumbers.push(`| ${a.arm === 'LS' ? 'L shipped' : a.arm === 'L' ? 'L matched' : a.arm} z${f.zoom} | ${a.backend} | ${a.gpu} | ${a.load.toFixed(2)} | ${f.syncedMs.toFixed(2)} (${f.syncedSpread.toFixed(2)}) | ${f.triangles} | ${f.draws} | ${f.settled ? 'yes' : 'NO'} |`);
  sheetNumbers.push('', '| difference panel (x8) | mean abs channel delta | changed px |', '|---|---|---|', ...panels.map((p) => `| ${p.name} z${p.zoom} | ${p.mean.toFixed(4)} | ${p.changed} |`), '');
}

const bloom: { arm: 'F' | 'G'; exit: number; quietMax: number | null }[] = [];
const bloomMd: string[] = [];
if (!SKIP.has('bloom')) {
  for (const [i, arm] of (['webgpu', 'webgl2'] as const).entries()) {
    const r = await runTool('src/perf/bloom-census.ts', [`--gpu=${arm}`, '--hw=metal', '--only=wadi_halam_4,beit_sahwan_outskirts', '--quality=high', '--aftermath=off', `--port=${BASE_PORT + 1 + i}`]);
    validation += countValidationErrors(r.out.split('\n'));
    bloom.push({ arm: arm === 'webgpu' ? 'G' : 'F', exit: r.code, quietMax: parseQuietMax(r.out) });
    bloomMd.push(`### ${arm === 'webgpu' ? 'G' : 'F'} (loadavg ${r.load.toFixed(2)} at start)`, '', '```', r.out.split('\n').filter((l) => /\||bloom-census/.test(l)).join('\n'), '```', '');
  }
}

let rafLine: string | null = null;
let rafBlock = '';
if (!SKIP.has('raf')) {
  const r = await runTool('src/perf/webgpu-raf-hypothesis.ts', [`--port=${BASE_PORT + 3}`]);
  validation += countValidationErrors(r.out.split('\n'));
  rafLine = r.out.split('\n').find((l) => l.startsWith('hypothesis:')) ?? null;
  rafBlock = r.out.split('\n').filter((l) => /^(conditions|hypothesis|\s+(native|stub|flag))/.test(l)).join('\n');
}
validation += countValidationErrors(consoleAll);

if (triangles.some((t) => t.G === 0) && sheetTris.size > 0) {
  triangles = [1, 2.5].map((zoom) => ({ zoom, L: sheetTris.get(`L${zoom}`) ?? 0, F: sheetTris.get(`F${zoom}`) ?? 0, G: sheetTris.get(`G${zoom}`) ?? 0 }));
  abbaNote += ' (triangle agreement read from the sheet pages: the ABBA had no G)';
}
const gates = gateTable({ sheetFrames, sheetUnsettled, abba: abbaRows, triangles, bloom, rafLine, validationErrors: validation });
const outside = r0Outside();
const doc = [
  '# WebGPU P1 T9: the lead\'s sheet and the Metal run',
  '',
  `Run ${startedAt}. Branch tools/webgpu-p1-sheet. Load average at the start (1-minute): ${startLoad.toFixed(2)}; ABBA pages ${abbaLoads || 'n/a'}. Machine: ${os.cpus()[0]?.model}.`,
  '',
  '## Gates',
  '',
  '| item | verdict | detail |',
  '|---|---|---|',
  ...gates.map((g) => `| ${g.item} | ${g.verdict} | ${g.detail} |`),
  '',
  `r0 values outside their band (parity-bands.ts, reported, never widened): ${outside.length === 0 ? 'none recorded outside' : outside.map((o) => `${o.scenario}/${o.layer} ${o.key} r0 ${o.r0} (${o.band})`).join('; ')}`,
  '',
  ...sheetNumbers,
  ...md,
  '## 3. Bloom census (quiet frames, tick 0, high, Metal)',
  '',
  ...bloomMd,
  '## 4. rAF re-check',
  '',
  '```',
  rafBlock,
  '```',
  '',
  '## 5. GPUValidationErrors',
  '',
  `${validation} (console lines of the four sheet pages plus every child tool's output; the ABBA harness also refuses on one).`,
  '',
  `ABBA conditions line: ${abbaNote}`,
];
writeFileSync(path.join(OUT, 'p1-numbers.md'), doc.join('\n'));
console.log('\n' + gates.map((g) => `${g.verdict}  ${g.item}  [${g.detail}]`).join('\n'));
console.log(`\n[p1-sheet] wrote ${path.join(OUT, 'p1-sheet.png')} and p1-numbers.md`);
process.exit(gates.some((g) => g.verdict === 'FAIL') ? 1 : 0);
