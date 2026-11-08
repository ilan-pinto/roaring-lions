/**
 * GH-943 WebGPU P2 T9: the lead's P2 sheet and the Metal run, in ONE browser lock hold. It extends the P1 sheet (`webgpu-p1-sheet.ts`).
 *
 *   pnpm --filter @lions/tools exec tsx src/perf/webgpu-p2-sheet.ts --out-dir=<dir> --lock=<BROWSER.lock dir> [--port=5191]
 *       [--abba-rounds=6] [--max-load=4] [--wait-quiet=10] [--skip=abba,sheet] [--report-only]
 *
 * Steps, strictly one browser at a time (each child tool owns its own dev server on its own port and stops only that):
 *   1. GH-829 ABBA at 300 and 600 units, G against L-matched (`webgpu-abba-run.ts --arms=G --legacy=matched`; no F timing).
 *   2. THE SHEET, `?sandbox=wadi_halam_4`, the booted camera, the parked force SELECTED (the ring on every arm), the frame loop frozen at
 *      boot, quality high, music off, 1440x900 at DPR 2: L-matched, G and F at z1, z1.6, z2.5; one L-shipped frame at z1; a minimap crop
 *      per arm; the `aftermath` crossroads and the `relief` view on L-matched and G; a WIND PAIR (the same view at two sim ticks 1 s
 *      apart) on L and G, with the wind layer hidden as its control; the BANDING crops (T2's rectangles) shipped and flat on L-matched
 *      and G. Six difference panels (x8).
 *   3. The node census per arm (`unportedHooks()` on G and F; the matched census on L), classified against `CENSUS_RULES`.
 *   4. A count of GPUValidationErrors over every page and every child's output, and a black/flat check of every node frame.
 * `--report-only` rebuilds the numbers and the sheet from `p2-data.json` in --out-dir (no GPU run, no lock, no dev server), so a rule
 * table can be corrected after the run is READ without a second lock hold. It still opens a plain headless Chromium (no GPU args) to
 * screenshot the written `p2-sheet.html` into `p2-sheet.png`, so Playwright's browser must be installed. The run's captured PNGs must
 * still be in --out-dir: the report reads them back (a moved directory is fine, the stored paths are rebased onto --out-dir by base name).
 * REFUSES (exit 2, but not under --report-only) without `--lock=<dir>` naming an existing directory, on a loaded machine, or on a page that is not hardware Metal.
 * r0 and the node floors are NOT measured here: they are printed from `parity-bands.ts`, where CI's three runs per key put them.
 */
import { chromium, type Browser, type Page } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import {
  AFTERMATH_SCENARIO,
  RELIEF_SCENARIO,
  bootFreezeRefusal,
  bootFreezeScriptFor,
  BOOT_SETTLE_SCRIPT,
  CAPTURE_PRECONDITION_STATEMENTS,
  FREEZE_FRAME_LOOP_SCRIPT,
  HIDE_ALERT_FEED_STATEMENTS,
  HUD_WALL_CLOCK_SETTLE_MS,
  NODE_REPAINT_SCRIPT,
  REPAINT_SCRIPT,
  captureScript,
  hideHudExceptCanvas,
  layerToggleScript,
  threeUrl,
  type Scenario,
} from '../golden-diff/capture-protocol';
import { devServerStopper, ensureDevServer } from '../golden-diff/browser';
import type { GpuArm } from '../golden-diff/backend';
import type { Crop } from '../golden-diff/banding';
import { frameContentRefusal, frameContentStats } from '../golden-diff/frame-content';
import { gpuLaunchArgs } from '../ui-review/gpu';
import { musicOffInitScript } from '../ui-review/music-off';
import { claimPort } from '../ui-review/port';
import { loadRefusal, MAX_LOADAVG_1M } from './webgpu-abba';
import {
  bandingOf,
  classifyCensus,
  countValidationErrors,
  diffPanel,
  fmtBanding,
  gateTableP2,
  p2ParityRows,
  p2SheetHtml,
  parityTable,
  r0Outside,
  rebaseFiles,
  syncedSummary,
  type BandingCell,
  type CensusEntry,
  type CropId,
  type P2Frame,
  type P2Section,
} from './webgpu-p2-sheet-lib';
import type { AbbaVerdictRow } from './webgpu-p1-sheet-lib';

const args = process.argv.slice(2);
const arg = (n: string, d: string): string => (args.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).slice(n.length + 3);
const TOOLS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ROOT = path.resolve(TOOLS, '..');
const OUT = path.resolve(arg('out-dir', ''));
const MAX_LOAD = Number(arg('max-load', String(MAX_LOADAVG_1M)));
const ABBA_ROUNDS = Number(arg('abba-rounds', '6'));
const WAIT_QUIET = Number(arg('wait-quiet', '10'));
const LOCK = arg('lock', '');
const DPR = 2;
const QUALITY = 'high';
const REPORT_ONLY = args.includes('--report-only');
const SKIP = new Set(arg('skip', '').split(',').filter((s) => s !== ''));
const MAP = 'wadi_halam_4';
const ZOOMS = [1, 1.6, 2.5] as const;
const ROUNDS = 5;
const FRAMES = 20;
const BASE_PORT = Number(arg('child-port', '5192'));
const MANIFEST = path.join(TOOLS, 'src/golden-diff/fixtures/banding/manifest.json');

function refuse(msg: string): never {
  console.error(`webgpu-p2-sheet: REFUSED: ${msg}`);
  process.exit(2);
}
if (args.find((a) => a.startsWith('--out-dir=')) === undefined) refuse('--out-dir=<dir> is required');
if (!REPORT_ONLY && (LOCK === '' || !existsSync(LOCK))) refuse('--lock=<dir> must name the BROWSER.lock directory the caller holds (mkdir it first)');
mkdirSync(OUT, { recursive: true });

type Arm = 'L' | 'G' | 'F' | 'LS';
const ARM_OF: Record<Arm, GpuArm> = { L: 'legacy', G: 'webgpu', F: 'webgl2', LS: 'legacy' };
const ARM_NAME: Record<Arm, string> = { L: 'L matched', G: 'G', F: 'F', LS: 'L shipped' };
const UNPORTED = `/@fs${ROOT}/packages/render/src/three/backend/unported.ts`;
const CROPS = (JSON.parse(readFileSync(MANIFEST, 'utf8')) as { crops: Record<CropId, Crop> }).crops;
const SHEET_SCENARIO: Scenario = { id: 'p2-sheet', description: "the lead's P2 sheet: wadi_halam_4, booted camera", sandboxMap: MAP, ticks: 0, cameraMarker: 'unused' };

interface FrameRec {
  key: string;
  png: string;
  settled: boolean;
  content: string | null;
  syncedMs?: number;
  syncedSpread?: number;
  rounds?: number[];
  triangles?: number;
  draws?: number;
}
interface WindRec {
  on: { changed: number; mean: number; file: string };
  off: { changed: number; mean: number; file: string };
}
interface PageRec {
  arm: Arm;
  label: 'wadi' | 'aftermath' | 'relief' | 'wind';
  backend: string;
  adapter: string;
  gpu: string;
  load: number;
  camera: { x: number; y: number };
  tick: number;
  frames: FrameRec[];
  minimap?: string;
  census?: CensusEntry[];
  banding?: { shipped: Record<CropId, BandingCell>; flat?: Record<CropId, BandingCell>; flatPng?: string };
  wind?: WindRec;
  lines: string[];
}
interface AbbaRec {
  rows: (AbbaVerdictRow & { l: { value: number; spread: number }; t: { value: number; spread: number }; cpuRenderL: number; cpuRenderT: number })[];
  note: string;
  loads: string;
  triangles: { zoom: number; L: number; G: number }[];
  refusal: string;
  output: string;
}
interface RunData {
  startedAt: string;
  machine: string;
  loads: { at: string; load1m: number }[];
  abba: AbbaRec | null;
  pages: PageRec[];
  childValidation: number;
}

const loads: { at: string; load1m: number }[] = [];
function noteLoad(at: string): number {
  const l = os.loadavg()[0] as number;
  loads.push({ at, load1m: l });
  console.log(`[p2-sheet] loadavg (1 min) at ${at}: ${l.toFixed(2)}`);
  return l;
}
async function untilQuiet(minutes: number): Promise<number> {
  const deadline = Date.now() + minutes * 60_000;
  for (;;) {
    const l = os.loadavg()[0] as number;
    if (loadRefusal(l, MAX_LOAD) === null) return l;
    if (Date.now() >= deadline) refuse(loadRefusal(l, MAX_LOAD) as string);
    await new Promise((res) => setTimeout(res, 5000));
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// In-page scripts.
// ---------------------------------------------------------------------------------------------------------------------------

const zoomScript = (arm: Arm, zoom: number): string => `(async () => {
  const R = window.__lions.renderer;
  R.camera.zoom = ${zoom};
${ARM_OF[arm] === 'legacy' ? '' : '  await new Promise(function (r) { window.requestAnimationFrame(function () { r(); }); });\n'}  R.frame(1, 0);
${ARM_OF[arm] === 'legacy' ? '' : '  await R.whenGpuIdle();\n'}  return JSON.stringify({ zoom: R.camera.zoom, x: R.camera.x, y: R.camera.y, tick: window.__lions.sim.tickCount });
})()`;

/** The matched census on the LEGACY scene, with the ported keys exempt (what `matchNodeStatements` runs); returns the list it left. */
const MATCH_CENSUS_SCRIPT = `(async () => {
  const R = window.__lions.renderer;
  const u = await import(${JSON.stringify(UNPORTED)});
  const found = u.censusUnported(R.scene, { portedKeys: u.PORTED_MATERIAL_KEYS });
  return JSON.stringify(found);
})()`;

const NODE_CENSUS_SCRIPT = `(async () => { return JSON.stringify(window.__lions.renderer.unportedHooks()); })()`;

const PUMP_SCRIPT = (arm: Arm): string =>
  `(async () => { const R = window.__lions.renderer; for (let i = 0; i < 20; i++) { ${ARM_OF[arm] === 'legacy' ? '' : 'await new Promise(function (r) { window.requestAnimationFrame(function () { r(); }); });'} R.frame(1, 100); await new Promise(function (r) { setTimeout(r, 100); }); } ${ARM_OF[arm] === 'legacy' ? '' : 'await R.whenGpuIdle();'} })()`;

const timeScript = (): string => `(async () => {
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
  return JSON.stringify({ rounds, triangles, draws });
})()`;

// ---------------------------------------------------------------------------------------------------------------------------
// One page.
// ---------------------------------------------------------------------------------------------------------------------------

interface Open {
  page: Page;
  lines: string[];
  backend: string;
  adapter: string;
  gpu: string;
  load: number;
}

async function openArm(browser: Browser, arm: Arm, port: number, scenario: Scenario, reducedMotion: boolean): Promise<Open> {
  const load = await untilQuiet(WAIT_QUIET);
  const lines: string[] = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: DPR });
  page.on('pageerror', (e) => lines.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') lines.push(m.text());
  });
  await page.addInitScript(musicOffInitScript({}, { quality: QUALITY }));
  await page.addInitScript('window.__name = (f) => f;');
  await page.addInitScript(bootFreezeScriptFor(ARM_OF[arm]));
  await page.emulateMedia({ reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
  await page.goto(threeUrl(port, scenario, ARM_OF[arm]), { waitUntil: 'load', timeout: 60_000 });
  await page.waitForFunction(() => typeof (window as unknown as { __lions?: unknown }).__lions !== 'undefined', undefined, { timeout: 60_000 });
  await page.evaluate(FREEZE_FRAME_LOOP_SCRIPT);
  await page.evaluate(() => document.fonts.ready);
  const settled = JSON.parse((await page.evaluate(BOOT_SETTLE_SCRIPT)) as string) as { tick: number };
  const refusal = bootFreezeRefusal(settled.tick);
  if (refusal !== null) refuse(`${arm}: ${refusal}`);
  const info = (await page.evaluate(() => (window as unknown as { __lions: { renderer: { backendInfo(): { kind: string; adapter: string } } } }).__lions.renderer.backendInfo())) as { kind: string; adapter: string };
  const gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext ? String(gl?.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  });
  const onMetal = ARM_OF[arm] === 'webgpu' ? /metal/i.test(info.adapter) : /metal/i.test(gpu) && !/swiftshader/i.test(gpu);
  if (!onMetal) refuse(`${arm}: draws on "${ARM_OF[arm] === 'webgpu' ? info.adapter : gpu}", not hardware Metal`);
  const want = ARM_OF[arm] === 'legacy' ? 'legacy-gl' : ARM_OF[arm] === 'webgl2' ? 'node-webgl2' : 'node-webgpu';
  if (info.kind !== want) refuse(`${arm}: backendInfo().kind is "${info.kind}", expected "${want}" (a fallback is evidence about the fallback)`);
  return { page, lines, backend: info.kind, adapter: info.adapter, gpu: ARM_OF[arm] === 'webgpu' ? info.adapter : gpu, load };
}

async function canvasClip(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  const r = (await page.evaluate(() => {
    const b = document.querySelector('canvas')?.getBoundingClientRect();
    return { x: b?.x ?? 0, y: b?.y ?? 0, w: b?.width ?? 0, h: b?.height ?? 0 };
  })) as { x: number; y: number; w: number; h: number };
  return { x: r.x, y: r.y, width: r.w, height: r.h };
}

/** One zero-time repaint and a photograph. G is copied out of the canvas in the SAME task as its render (a WebGPU canvas screenshot reads black). */
async function grab(page: Page, arm: Arm): Promise<Buffer> {
  const clip = await canvasClip(page);
  if (ARM_OF[arm] === 'webgpu') {
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
  }
  // L matched: the census runs immediately before the repaint, so nothing a frame un-hid stays drawn.
  if (arm === 'L') await page.evaluate(MATCH_CENSUS_SCRIPT);
  await page.evaluate(ARM_OF[arm] === 'legacy' ? REPAINT_SCRIPT : NODE_REPAINT_SCRIPT);
  return page.screenshot({ clip });
}

/** The capture protocol's settled-frame check: two zero-time repaints must read byte-identical. Up to 3 tries, then it is said. */
async function settledGrab(page: Page, arm: Arm, file: string): Promise<{ png: Buffer; ok: boolean }> {
  let png: Buffer = Buffer.alloc(0);
  let ok = false;
  for (let t = 0; t < 3 && !ok; t++) {
    const a = await grab(page, arm);
    png = await grab(page, arm);
    ok = a.equals(png);
  }
  writeFileSync(file, png);
  return { png, ok };
}

function contentOf(file: string, arm: Arm): string | null {
  if (ARM_OF[arm] === 'legacy') return null;
  const p = PNG.sync.read(readFileSync(file));
  return frameContentRefusal(frameContentStats(p.data, p.width, p.height));
}

async function frameRec(open: Open, arm: Arm, key: string, file: string, timed: boolean): Promise<FrameRec> {
  const { ok } = await settledGrab(open.page, arm, file);
  const rec: FrameRec = { key, png: file, settled: ok, content: contentOf(file, arm) };
  if (timed) {
    const t = JSON.parse((await open.page.evaluate(timeScript())) as string) as { rounds: number[]; triangles: number; draws: number };
    const s = syncedSummary(t.rounds);
    Object.assign(rec, { syncedMs: s.value, syncedSpread: s.spread, rounds: t.rounds, triangles: t.triangles, draws: t.draws });
    console.log(`[p2-sheet] ${arm} ${key}: synced ${s.value.toFixed(2)} ms (spread ${s.spread.toFixed(2)}), tris ${t.triangles}, draws ${t.draws}${ok ? '' : ' UNSETTLED'}${rec.content === null ? '' : ` CONTENT: ${rec.content}`}`);
  } else console.log(`[p2-sheet] ${arm} ${key}: photographed${ok ? '' : ' UNSETTLED'}${rec.content === null ? '' : ` CONTENT: ${rec.content}`}`);
  return rec;
}

const readCensus = async (page: Page, arm: Arm): Promise<CensusEntry[] | undefined> =>
  arm === 'LS' ? undefined : (JSON.parse((await page.evaluate(arm === 'L' ? MATCH_CENSUS_SCRIPT : NODE_CENSUS_SCRIPT)) as string) as CensusEntry[]);

async function hudDown(page: Page): Promise<void> {
  await page.evaluate(`(async () => { ${HIDE_ALERT_FEED_STATEMENTS}\n await new Promise(function (r) { setTimeout(r, ${HUD_WALL_CLOCK_SETTLE_MS}); }); ${CAPTURE_PRECONDITION_STATEMENTS} })()`);
}

const SELECT_FORCE = `(() => { const L = window.__lions; return L.sel(L.units().map(function (u) { return u.id; })).length; })()`;

/** wadi_halam_4: the force selected, three zooms (one for L shipped), the minimap, the census, the banding crops. */
async function wadiPage(browser: Browser, arm: Arm, port: number): Promise<PageRec> {
  const open = await openArm(browser, arm, port, SHEET_SCENARIO, true);
  const { page } = open;
  await page.evaluate(
    `(async () => { ${HIDE_ALERT_FEED_STATEMENTS}\n await new Promise(function (r) { setTimeout(r, ${HUD_WALL_CLOCK_SETTLE_MS}); }); window.__lions.redrawMinimap(); await window.__lions.renderer.groundPhotoSettled?.(); window.__lions.redrawMinimap(true); ${CAPTURE_PRECONDITION_STATEMENTS} })()`
  );
  const minimap = path.join(OUT, `minimap-${arm}.png`);
  await page.locator('.rl-minimap').first().screenshot({ path: minimap });
  const selected = Number(await page.evaluate(SELECT_FORCE));
  console.log(`[p2-sheet] ${arm}: ${selected} own units selected`);
  if (selected === 0) refuse(`${arm}: the force selection is empty, so the ring would not be on the sheet`);
  await page.evaluate(hideHudExceptCanvas);
  const frames: FrameRec[] = [];
  let camera = { x: 0, y: 0 };
  let tick = 0;
  const zooms = arm === 'LS' ? [1] : [...ZOOMS];
  for (const z of zooms) {
    const z0 = JSON.parse((await page.evaluate(zoomScript(arm, z))) as string) as { x: number; y: number; tick: number };
    camera = { x: z0.x, y: z0.y };
    tick = z0.tick;
    await page.evaluate(PUMP_SCRIPT(arm));
    frames.push(await frameRec(open, arm, `z${z}`, path.join(OUT, `frame-${arm}-z${z}.png`), true));
  }
  const rec: PageRec = { arm, label: 'wadi', backend: open.backend, adapter: open.adapter, gpu: open.gpu, load: open.load, camera, tick, frames, minimap, lines: open.lines };
  rec.census = await readCensus(page, arm);
  // Banding: the shipped z1 frame, then the flat ground (ground-albedo and macro hidden), on L matched and G.
  const z1 = frames.find((f) => f.key === 'z1');
  if (z1 !== undefined) {
    rec.banding = { shipped: bandingOf(PNG.sync.read(readFileSync(z1.png)), CROPS) };
    if (arm === 'L' || arm === 'G') {
      await page.evaluate(zoomScript(arm, 1));
      for (const layer of ['ground-albedo', 'macro']) await page.evaluate(layerToggleScript(layer, false, ARM_OF[arm], arm === 'L' ? { matchNodeRoot: ROOT } : {}));
      await page.evaluate(PUMP_SCRIPT(arm));
      const flatFile = path.join(OUT, `frame-${arm}-z1-flat.png`);
      const { ok } = await settledGrab(page, arm, flatFile);
      rec.banding.flat = bandingOf(PNG.sync.read(readFileSync(flatFile)), CROPS);
      rec.banding.flatPng = flatFile;
      for (const layer of ['ground-albedo', 'macro']) await page.evaluate(layerToggleScript(layer, true, ARM_OF[arm], arm === 'L' ? { matchNodeRoot: ROOT } : {}));
      console.log(`[p2-sheet] ${arm} banding shipped ${fmtBanding(rec.banding.shipped.penumbra)} / ${fmtBanding(rec.banding.shipped.lit)}; flat ${fmtBanding(rec.banding.flat.penumbra)} / ${fmtBanding(rec.banding.flat.lit)}${ok ? '' : ' (flat UNSETTLED)'}`);
    }
  }
  writeFileSync(path.join(OUT, `console-${arm}-wadi.txt`), open.lines.join('\n'));
  await page.close();
  return rec;
}

/** The `aftermath` and `relief` framings (the gate's own scenarios, its own capture script). */
async function framingPage(browser: Browser, arm: 'L' | 'G', port: number, scenario: Scenario, label: 'aftermath' | 'relief'): Promise<PageRec> {
  const open = await openArm(browser, arm, port, scenario, true);
  const { page } = open;
  const cap = JSON.parse((await page.evaluate(captureScript(scenario, ARM_OF[arm], arm === 'L' ? { matchNodeRoot: ROOT } : {}))) as string) as { camera: { x: number; y: number }; tick: number };
  await new Promise((res) => setTimeout(res, HUD_WALL_CLOCK_SETTLE_MS));
  await page.evaluate(hideHudExceptCanvas);
  await page.evaluate(PUMP_SCRIPT(arm));
  const frames = [await frameRec(open, arm, label, path.join(OUT, `frame-${arm}-${label}.png`), false)];
  const rec: PageRec = { arm, label, backend: open.backend, adapter: open.adapter, gpu: open.gpu, load: open.load, camera: cap.camera, tick: cap.tick, frames, lines: open.lines };
  rec.census = await readCensus(page, arm);
  writeFileSync(path.join(OUT, `console-${arm}-${label}.txt`), open.lines.join('\n'));
  await page.close();
  return rec;
}

/** The wind pair: z2.5 at two sim ticks 1 s apart (20 ticks), then the same pair with the `wind` layer hidden as the control. */
async function windPage(browser: Browser, arm: 'L' | 'G', port: number): Promise<PageRec> {
  const open = await openArm(browser, arm, port, SHEET_SCENARIO, false);
  const { page } = open;
  await hudDown(page);
  await page.evaluate(hideHudExceptCanvas);
  const z0 = JSON.parse((await page.evaluate(zoomScript(arm, 2.5))) as string) as { x: number; y: number; tick: number };
  await page.evaluate(PUMP_SCRIPT(arm));
  const pair = async (tag: string): Promise<{ changed: number; mean: number; file: string; frames: FrameRec[] }> => {
    const a = await frameRec(open, arm, `wind-${tag}-t0`, path.join(OUT, `wind-${arm}-${tag}-t0.png`), false);
    await page.evaluate(`(() => { window.__lions.step(20); return window.__lions.sim.tickCount; })()`);
    const b = await frameRec(open, arm, `wind-${tag}-t1`, path.join(OUT, `wind-${arm}-${tag}-t1.png`), false);
    const d = diffPanel(PNG.sync.read(readFileSync(a.png)), PNG.sync.read(readFileSync(b.png)));
    const file = path.join(OUT, `wind-${arm}-${tag}-diff.png`);
    writeFileSync(file, PNG.sync.write(d.png));
    return { changed: d.changedPixels, mean: d.meanAbsChannelDelta, file, frames: [a, b] };
  };
  const on = await pair('on');
  await page.evaluate(layerToggleScript('wind', false, ARM_OF[arm], arm === 'L' ? { matchNodeRoot: ROOT } : {}));
  const off = await pair('off');
  await page.evaluate(layerToggleScript('wind', true, ARM_OF[arm], arm === 'L' ? { matchNodeRoot: ROOT } : {}));
  console.log(`[p2-sheet] ${arm} wind pair: wind on ${on.changed} px (mean ${on.mean.toFixed(4)}), wind hidden ${off.changed} px (mean ${off.mean.toFixed(4)})`);
  const rec: PageRec = {
    arm,
    label: 'wind',
    backend: open.backend,
    adapter: open.adapter,
    gpu: open.gpu,
    load: open.load,
    camera: { x: z0.x, y: z0.y },
    tick: z0.tick,
    frames: [...on.frames, ...off.frames],
    wind: { on: { changed: on.changed, mean: on.mean, file: on.file }, off: { changed: off.changed, mean: off.mean, file: off.file } },
    lines: open.lines,
  };
  writeFileSync(path.join(OUT, `console-${arm}-wind.txt`), open.lines.join('\n'));
  await page.close();
  return rec;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Children: the ABBA.
// ---------------------------------------------------------------------------------------------------------------------------

async function runTool(file: string, toolArgs: string[]): Promise<{ code: number; out: string }> {
  const load = await untilQuiet(WAIT_QUIET);
  console.log(`\n[p2-sheet] >>> ${file} ${toolArgs.join(' ')} (loadavg ${load.toFixed(2)})`);
  return new Promise((resolve) => {
    const child = spawn('pnpm', ['exec', 'tsx', file, ...toolArgs], { cwd: TOOLS, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const take = (b: Buffer): void => {
      out += b.toString();
      process.stdout.write(b);
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('close', (code) => resolve({ code: code ?? 1, out }));
  });
}

async function abba(): Promise<AbbaRec> {
  const jsonFile = path.join(OUT, 'abba.json');
  const r = await runTool('src/perf/webgpu-abba-run.ts', [`--port=${BASE_PORT}`, `--root=${ROOT}`, '--counts=300,600', `--rounds=${ABBA_ROUNDS}`, '--frames=60', `--wait-quiet=${WAIT_QUIET}`, `--max-load=${MAX_LOAD}`, '--arms=G', '--legacy=matched', `--out=${jsonFile}`]);
  if (r.code !== 0 || !existsSync(jsonFile)) return { rows: [], note: `FAILED (exit ${r.code}); no timing exists`, loads: '', triangles: [], refusal: r.out.split('\n').filter((l) => /REFUSED|arm G/.test(l)).slice(0, 4).join(' | '), output: r.out };
  const j = JSON.parse(readFileSync(jsonFile, 'utf8')) as {
    conditions: string;
    loads: { load1m: number }[];
    verdict: AbbaRec['rows'];
    sample: Record<string, { views: { zoom: number; triangles: number }[] }>;
  };
  const tri = (a: string, zoom: number): number => j.sample[a]?.views.find((v) => v.zoom === zoom)?.triangles ?? 0;
  return {
    rows: j.verdict,
    note: j.conditions,
    loads: `${Math.min(...j.loads.map((l) => l.load1m)).toFixed(2)} to ${Math.max(...j.loads.map((l) => l.load1m)).toFixed(2)} (1-minute, per page)`,
    triangles: [1, 2.5].map((zoom) => ({ zoom, L: tri('L', zoom), G: tri('G', zoom) })),
    refusal: '',
    output: r.out,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------
// The report (pure over RunData, so `--report-only` can rerun it).
// ---------------------------------------------------------------------------------------------------------------------------

const loadPng = (f: string): PNG => PNG.sync.read(readFileSync(f));
const frameOf = (d: RunData, arm: Arm, label: PageRec['label'], key: string): { rec: FrameRec; page: PageRec } | undefined => {
  const page = d.pages.find((p) => p.arm === arm && p.label === label);
  const rec = page?.frames.find((f) => f.key === key);
  return page !== undefined && rec !== undefined ? { rec, page } : undefined;
};

function cropFile(src: string, crop: Crop, name: string): string {
  const p = loadPng(src);
  const out = new PNG({ width: crop.w, height: crop.h });
  PNG.bitblt(p, out, crop.x, crop.y, crop.w, crop.h, 0, 0);
  const file = path.join(OUT, name);
  writeFileSync(file, PNG.sync.write(out));
  return file;
}

async function report(d: RunData): Promise<boolean> {
  const cap = (d_: { rec: FrameRec; page: PageRec } | undefined, label: string): P2Frame | null =>
    d_ === undefined
      ? null
      : {
          file: d_.rec.png,
          caption: `${label}: ${d_.rec.syncedMs === undefined ? 'photographed' : `synced ${d_.rec.syncedMs.toFixed(2)} ms (spread ${(d_.rec.syncedSpread ?? 0).toFixed(2)}, ${d_.rec.rounds?.length ?? 0} rounds), ${(d_.rec.triangles ?? 0).toLocaleString()} tris, ${d_.rec.draws} draws`}${d_.rec.settled ? '' : ' UNSETTLED'}${d_.rec.content === null ? '' : ' BLACK/FLAT'} | ${d_.page.backend} / ${d_.page.adapter} / load ${d_.page.load.toFixed(2)}`,
        };
  const sections: P2Section[] = [];
  sections.push({
    title: `Rows: L matched (AO on, ported twins kept), G (node on WebGPU), F (node on WebGL2). Columns: z${ZOOMS.join(', z')}. Force SELECTED.`,
    rows: (['L', 'G', 'F'] as const).map((a) => ZOOMS.map((z) => cap(frameOf(d, a, 'wadi', `z${z}`), `${ARM_NAME[a]} z${z}`))),
  });
  const panels: { name: string; zoom: number; mean: number; changed: number }[] = [];
  const diffRows: (P2Frame | null)[][] = [];
  for (const t of ['G', 'F'] as const) {
    const row: (P2Frame | null)[] = [];
    for (const z of ZOOMS) {
      const a = frameOf(d, 'L', 'wadi', `z${z}`);
      const b = frameOf(d, t, 'wadi', `z${z}`);
      if (a === undefined || b === undefined) {
        row.push(null);
        continue;
      }
      const dp = diffPanel(loadPng(a.rec.png), loadPng(b.rec.png));
      const file = path.join(OUT, `diff-${t}-L-z${z}.png`);
      writeFileSync(file, PNG.sync.write(dp.png));
      panels.push({ name: `${t} - L`, zoom: z, mean: dp.meanAbsChannelDelta, changed: dp.changedPixels });
      row.push({ file, caption: `|${t} - L| x8 at z${z}: mean abs channel delta ${dp.meanAbsChannelDelta.toFixed(4)}, ${dp.changedPixels.toLocaleString()} px changed` });
    }
    diffRows.push(row);
  }
  sections.push({ title: 'Differences (x8)', rows: diffRows });
  const minis = (['L', 'G', 'F'] as const).map((a): P2Frame | null => {
    const p = d.pages.find((x) => x.arm === a && x.label === 'wadi');
    return p?.minimap === undefined ? null : { file: p.minimap, caption: `${a} minimap crop (2x)` };
  });
  sections.push({ title: 'L shipped at z1 (the player\'s frame, no census), and the minimap per arm', rows: [[cap(frameOf(d, 'LS', 'wadi', 'z1'), 'L shipped z1'), ...minis.slice(0, 2)], [minis[2]]] });
  sections.push({
    title: 'Extra framings: aftermath crossroads (roads, slope light), relief view (tel_marum), L matched and G',
    rows: [
      [cap(frameOf(d, 'L', 'aftermath', 'aftermath'), 'L matched aftermath'), cap(frameOf(d, 'G', 'aftermath', 'aftermath'), 'G aftermath')],
      [cap(frameOf(d, 'L', 'relief', 'relief'), 'L matched relief'), cap(frameOf(d, 'G', 'relief', 'relief'), 'G relief')],
    ],
  });
  const windRows: (P2Frame | null)[][] = [];
  for (const a of ['L', 'G'] as const) {
    const p = d.pages.find((x) => x.arm === a && x.label === 'wind');
    if (p?.wind === undefined) {
      windRows.push([null]);
      continue;
    }
    const f = (k: string): FrameRec | undefined => p.frames.find((x) => x.key === k);
    windRows.push([
      f('wind-on-t0') ? { file: (f('wind-on-t0') as FrameRec).png, caption: `${a} z2.5 tick ${p.tick} + 0 s` } : null,
      f('wind-on-t1') ? { file: (f('wind-on-t1') as FrameRec).png, caption: `${a} z2.5 +1 s (20 ticks)` } : null,
      { file: p.wind.on.file, caption: `|t1 - t0| x8, wind ON: ${p.wind.on.changed.toLocaleString()} px, mean ${p.wind.on.mean.toFixed(4)}; wind layer hidden control: ${p.wind.off.changed.toLocaleString()} px, mean ${p.wind.off.mean.toFixed(4)}` },
    ]);
  }
  sections.push({ title: 'Wind pair: the same view at two sim ticks 1 s apart (reduced motion OFF), L matched and G', rows: windRows });
  const bandRows: (P2Frame | null)[][] = [];
  for (const crop of ['penumbra', 'lit'] as const) {
    const row: (P2Frame | null)[] = [];
    for (const a of ['L', 'G', 'LS'] as const) {
      const p = d.pages.find((x) => x.arm === a && x.label === 'wadi');
      const z1 = p?.frames.find((f) => f.key === 'z1');
      row.push(p?.banding === undefined || z1 === undefined ? null : { file: cropFile(z1.png, CROPS[crop], `crop-${a}-${crop}.png`), caption: `${ARM_NAME[a]} shipped, ${crop} crop: bandingIndex ${fmtBanding(p.banding.shipped[crop])}` });
    }
    bandRows.push(row);
    const flat: (P2Frame | null)[] = [];
    for (const a of ['L', 'G'] as const) {
      const p = d.pages.find((x) => x.arm === a && x.label === 'wadi');
      flat.push(p?.banding?.flat === undefined || p.banding.flatPng === undefined ? null : { file: cropFile(p.banding.flatPng, CROPS[crop], `crop-${a}-${crop}-flat.png`), caption: `${ARM_NAME[a]} FLAT ground (ground-albedo and macro hidden), ${crop} crop: bandingIndex ${fmtBanding(p.banding.flat[crop])}` });
    }
    bandRows.push(flat);
  }
  sections.push({ title: 'Banding crops (T2\'s rectangles, device px), shipped and flat', rows: bandRows });
  const htmlFile = path.join(OUT, 'p2-sheet.html');
  writeFileSync(htmlFile, p2SheetHtml(`GH-943 WebGPU P2 sheet: ${MAP}, quality ${QUALITY}, 1440x900 DPR ${DPR}, music off`, sections));
  const b2 = await chromium.launch({ headless: true });
  const p2 = await b2.newPage({ viewport: { width: 1832, height: 900 } });
  await p2.goto(pathToFileURL(htmlFile).href);
  await p2.waitForFunction(() => Array.from(document.images).every((i) => i.complete));
  await p2.screenshot({ path: path.join(OUT, 'p2-sheet.png'), fullPage: true });
  await b2.close();

  // Numbers.
  const censusBy: Record<string, ReturnType<typeof classifyCensus>> = {};
  for (const a of ['L', 'G', 'F'] as const) {
    const p = d.pages.find((x) => x.arm === a && x.label === 'wadi');
    if (p?.census !== undefined) censusBy[a] = classifyCensus(p.census);
  }
  for (const [a, label] of [['L', 'aftermath'], ['G', 'aftermath'], ['L', 'relief'], ['G', 'relief']] as const) {
    const p = d.pages.find((x) => x.arm === a && x.label === label);
    if (p?.census !== undefined) censusBy[`${a} ${label}`] = classifyCensus(p.census);
  }
  const win = (a: 'L' | 'G'): WindRec | undefined => d.pages.find((x) => x.arm === a && x.label === 'wind')?.wind;
  const validation = d.childValidation + d.pages.reduce((n, p) => n + countValidationErrors(p.lines), 0);
  const allFrames = d.pages.flatMap((p) => p.frames);
  const contentBad = allFrames.filter((f) => f.content !== null);
  const bandingOf1 = (a: Arm): Record<CropId, BandingCell> | undefined => d.pages.find((p) => p.arm === a && p.label === 'wadi')?.banding?.shipped;
  const g = gateTableP2({
    sheetFrames: allFrames.length,
    expectedFrames: 3 * 3 + 1 + 4 + 8,
    sheetUnsettled: allFrames.filter((f) => !f.settled).length,
    abba: d.abba?.rows ?? [],
    triangles: d.abba?.triangles ?? [],
    banding: { L: bandingOf1('L'), G: bandingOf1('G'), LS: bandingOf1('LS') },
    census: censusBy,
    wind: win('L') !== undefined && win('G') !== undefined ? { L: (win('L') as WindRec).on.changed - (win('L') as WindRec).off.changed, G: (win('G') as WindRec).on.changed - (win('G') as WindRec).off.changed } : null,
    validationErrors: validation,
  });
  if (contentBad.length > 0) g.push({ item: 'no node frame black or flat', verdict: 'FAIL', detail: contentBad.map((f) => `${f.key}: ${f.content}`).join('; ') });
  const outside = r0Outside();
  const md: string[] = [
    "# WebGPU P2 T9: the lead's sheet and the Metal run",
    '',
    `Run ${d.startedAt}. Machine: ${d.machine}. 1-minute load average: ${d.loads.map((l) => `${l.at} ${l.load1m.toFixed(2)}`).join(', ')}; ABBA pages ${d.abba?.loads || 'n/a'}.`,
    '',
    '## Gates',
    '',
    '| item | verdict | detail |',
    '|---|---|---|',
    ...g.map((r) => `| ${r.item} | ${r.verdict} | ${r.detail} |`),
    '',
    `r0 values outside their band (parity-bands.ts, reported, never widened): ${outside.length === 0 ? 'none recorded outside' : outside.map((o) => `${o.scenario}/${o.layer} ${o.key} r0 ${o.r0} (${o.band})`).join('; ')}`,
    '',
    '## 1. The sheet',
    '',
    `File: ${path.join(OUT, 'p2-sheet.png')}`,
    '',
    `Boot: \`?sandbox=${MAP}\`, the booted camera, the parked force SELECTED, quality ${QUALITY}, music off, 1440x900 at DPR ${DPR}, Chromium ANGLE/Metal. Framing pages: aftermath (qarn_hadid, &decals, tick 300, zoom 2.2) and relief (tel_marum, tick 500, zoom 2), each by the gate's own capture script.`,
    '',
    '| frame | backend | adapter | load at start | sim tick | synced ms (median of ' + ROUNDS + ' round medians, spread) | triangles | draws | settled |',
    '|---|---|---|---|---|---|---|---|---|',
    ...d.pages.flatMap((p) =>
      (p.label === 'wind' ? [] : p.frames).map((f) => `| ${ARM_NAME[p.arm]} ${p.label === 'wadi' ? '' : `${p.label} `}${f.key} | ${p.backend} | ${p.gpu} | ${p.load.toFixed(2)} | ${p.tick} | ${f.syncedMs === undefined ? 'n/a' : `${f.syncedMs.toFixed(2)} (${(f.syncedSpread ?? 0).toFixed(2)})`} | ${f.triangles ?? 'n/a'} | ${f.draws ?? 'n/a'} | ${f.settled ? 'yes' : 'NO'} |`)
    ),
    '',
    '| difference panel (x8) | mean abs channel delta | changed px |',
    '|---|---|---|',
    ...panels.map((p) => `| ${p.name} z${p.zoom} | ${p.mean.toFixed(4)} | ${p.changed} |`),
    '',
    '## 2. GH-829 ABBA (G against L-matched, AO on, no F timing)',
    '',
  ];
  if (d.abba === null) md.push('skipped', '');
  else {
    md.push(`Conditions: ${d.abba.note}`, '', ...(d.abba.refusal === '' ? [] : [`REFUSED by the harness: ${d.abba.refusal}`, '']), '| point | L synced ms (spread) | G synced ms (spread) | ratio | bar | verdict | CPU render L / G ms |', '|---|---|---|---|---|---|---|');
    for (const v of d.abba.rows) md.push(`| n${v.target} ${v.test} | ${v.l.value.toFixed(2)} (${v.l.spread.toFixed(2)}) | ${v.t.value.toFixed(2)} (${v.t.spread.toFixed(2)}) | x${v.ratio.toFixed(3)}${v.withinSpread ? ' inside spread' : ''} | 1.05 | ${v.met ? 'MET' : 'NOT MET'} | ${v.cpuRenderL.toFixed(2)} / ${v.cpuRenderT.toFixed(2)} |`);
    md.push('', 'Triangle agreement (ABBA, AO on; the harness refuses above 1%):', '', '| zoom | L | G |', '|---|---|---|', ...d.abba.triangles.map((t) => `| z${t.zoom} | ${t.L} | ${t.G} |`), '');
  }
  md.push('## 3. bandingIndex (T2\'s crops; penumbra / lit; value (masked px))', '', '| arm | shipped penumbra | shipped lit | flat penumbra | flat lit |', '|---|---|---|---|---|');
  for (const a of ['LS', 'L', 'G', 'F'] as const) {
    const b = d.pages.find((p) => p.arm === a && p.label === 'wadi')?.banding;
    if (b !== undefined) md.push(`| ${ARM_NAME[a]} | ${fmtBanding(b.shipped.penumbra)} | ${fmtBanding(b.shipped.lit)} | ${b.flat ? fmtBanding(b.flat.penumbra) : 'n/a'} | ${b.flat ? fmtBanding(b.flat.lit) : 'n/a'} |`);
  }
  md.push('', '## 4. Wind pair (z2.5, +20 ticks)', '', '| arm | changed px, wind on | changed px, wind layer hidden | wind alone |', '|---|---|---|---|');
  for (const a of ['L', 'G'] as const) {
    const w = win(a);
    if (w !== undefined) md.push(`| ${ARM_NAME[a]} | ${w.on.changed} (mean ${w.on.mean.toFixed(4)}) | ${w.off.changed} (mean ${w.off.mean.toFixed(4)}) | ${w.on.changed - w.off.changed} |`);
  }
  md.push('', '## 5. The node census per arm', '');
  for (const [arm, v] of Object.entries(censusBy)) {
    md.push(`### ${arm}`, '', '| kind | key | objects | status |', '|---|---|---|---|');
    for (const e of v.expected) md.push(`| ${e.kind} | ${e.key} | ${e.objects} | expected: ${e.reason} |`);
    for (const e of v.unexpected) md.push(`| ${e.kind} | ${e.key} | ${e.objects} | **UNEXPECTED** |`);
    md.push('');
  }
  md.push('## 6. P2 parity rows (r0 and node floors are CI-sourced; null = not yet read)', '', ...parityTable(p2ParityRows()), '', '## 7. GPUValidationErrors', '', `${validation} (console lines of ${d.pages.length} pages plus every child tool's output; the ABBA harness also refuses on one).`, '');
  writeFileSync(path.join(OUT, 'p2-numbers.md'), md.join('\n'));
  console.log('\n' + g.map((r) => `${r.verdict}  ${r.item}  [${r.detail}]`).join('\n'));
  console.log(`\n[p2-sheet] wrote ${path.join(OUT, 'p2-sheet.png')} and p2-numbers.md`);
  return !g.some((r) => r.verdict === 'FAIL');
}

// ---------------------------------------------------------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------------------------------------------------------

const dataFile = path.join(OUT, 'p2-data.json');
if (REPORT_ONLY) {
  // Rebased: the data file stores absolute frame paths, and the directory may have moved since the run.
  const ok = await report(rebaseFiles(JSON.parse(readFileSync(dataFile, 'utf8')) as RunData, OUT));
  process.exit(ok ? 0 : 1);
}

const startedAt = new Date().toISOString();
if (noteLoad('start') > MAX_LOAD) await untilQuiet(WAIT_QUIET);
const data: RunData = { startedAt, machine: `${os.cpus()[0]?.model}`, loads, abba: null, pages: [], childValidation: 0 };
const save = (): void => writeFileSync(dataFile, JSON.stringify(data, null, 1));

if (!SKIP.has('abba')) {
  data.abba = await abba();
  data.childValidation += countValidationErrors(data.abba.output.split('\n'));
  save();
}
noteLoad('mid');
if (!SKIP.has('sheet')) {
  const port = await claimPort('webgpu-p2-sheet', 'WEBGPU_P2_SHEET_PORT', 5191);
  const stop = devServerStopper(await ensureDevServer(port, ROOT, 'webgpu-p2-sheet'), 'webgpu-p2-sheet');
  const browser = await chromium.launch({ headless: true, args: [...gpuLaunchArgs('metal'), '--enable-unsafe-webgpu'] });
  try {
    for (const a of ['L', 'G', 'F', 'LS'] as const) {
      data.pages.push(await wadiPage(browser, a, port));
      save();
    }
    for (const a of ['L', 'G'] as const) {
      data.pages.push(await framingPage(browser, a, port, AFTERMATH_SCENARIO, 'aftermath'));
      data.pages.push(await framingPage(browser, a, port, RELIEF_SCENARIO, 'relief'));
      save();
    }
    for (const a of ['L', 'G'] as const) {
      data.pages.push(await windPage(browser, a, port));
      save();
    }
  } finally {
    await browser.close();
    stop();
  }
}
noteLoad('end');
save();
const ok = await report(data);
process.exit(ok ? 0 : 1);
