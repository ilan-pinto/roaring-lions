/**
 * GH-943 WebGPU P2 T8: the before/after banding sheet. T2's two crops on L-shipped (Ls), L-matched (L) and G, BEFORE and AFTER the output
 * dither became unconditional, in the shipped state and in the FLAT state (`ground-albedo` + `macro` hidden: the texture removed from
 * both arms), each with its `bandingIndex`; plus the shipped legacy frame before/after at z1 and its x8 difference.
 *
 *   pnpm --filter @lions/tools exec tsx src/perf/webgpu-banding-sheet.ts --out-dir=<dir> --lock=<BROWSER.lock dir> [--port=5194] [--max-load=4]
 *
 * BEFORE is made from the same code as AFTER: `uGradeDither` 0 adds exactly zero, which is the old no-grade frame bit for bit (the
 * dither was a `+ (noise - 0.5) * (uGradeDither / 255)` that did not run; it now always runs and 0 is its off). The sheet therefore needs
 * no second checkout. The bytes of the before frame equal the pre-fix frame: asserted by the probe's H1 "dither off" row.
 *
 * Conditions as T2's probe: `?sandbox=wadi_halam_4`, booted camera z1, sim tick 5, quality high, music off, reduced motion, 1440x900 at
 * DPR 2, one Metal lock hold. REFUSES (exit 2) without the lock, above --max-load, on a page that is not hardware Metal or not the arm's
 * backend, and when a state toggle moved no stable pixel. Exit 1 when the T8 gate fails (node flat index above L-matched flat's, or the
 * legacy flat index not falling). Presentation only.
 */
import { chromium, type Browser, type Page } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { bootFreezeRefusal, bootFreezeScriptFor, BOOT_SETTLE_SCRIPT, CAPTURE_PRECONDITION_STATEMENTS, FREEZE_FRAME_LOOP_SCRIPT, HIDE_ALERT_FEED_STATEMENTS, HUD_WALL_CLOCK_SETTLE_MS, hideHudExceptCanvas, threeUrl, type Scenario } from '../golden-diff/capture-protocol';
import { devServerStopper, ensureDevServer } from '../golden-diff/browser';
import { gpuLaunchArgs } from '../ui-review/gpu';
import { musicOffInitScript } from '../ui-review/music-off';
import { claimPort } from '../ui-review/port';
import type { Crop } from '../golden-diff/banding';
import { abDelta, fmtIndex, readIndex, unstableMask, type CropId, type Frame, type IndexReading } from './webgpu-banding-probe-lib';
import { amplifiedDiff, gateRows, legacyFalls, stretchedTile, stretchRange, type SheetArm, type SheetPhase, type SheetState } from './webgpu-banding-sheet-lib';

const args = process.argv.slice(2);
const arg = (n: string, d: string): string => (args.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).slice(n.length + 3);
const TOOLS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ROOT = path.resolve(TOOLS, '..');
const OUT = path.resolve(arg('out-dir', ''));
const LOCK = arg('lock', '');
const MAX_LOAD = Number(arg('max-load', '4'));
const DPR = 2;
const MAP = 'wadi_halam_4';
const UNPORTED = `/@fs${ROOT}/packages/render/src/three/backend/unported.ts`;
const MANIFEST = path.join(TOOLS, 'src/golden-diff/fixtures/banding/manifest.json');
const ARMS: SheetArm[] = ['Ls', 'L', 'G'];
const GPU_OF: Record<SheetArm, 'legacy' | 'webgpu'> = { Ls: 'legacy', L: 'legacy', G: 'webgpu' };
const LABEL: Record<SheetArm, string> = { Ls: 'L shipped', L: 'L matched', G: 'G (WebGPU)' };

function refuse(msg: string): never {
  console.error(`webgpu-banding-sheet: REFUSED: ${msg}`);
  process.exit(2);
}
if (args.find((a) => a.startsWith('--out-dir=')) === undefined) refuse('--out-dir=<dir> is required');
if (LOCK === '' || !existsSync(LOCK)) refuse('--lock=<dir> must name the BROWSER.lock directory the caller holds (a Metal run is one lock hold)');
mkdirSync(OUT, { recursive: true });
const CROPS = (JSON.parse(readFileSync(MANIFEST, 'utf8')) as { crops: Record<CropId, Crop> }).crops;
const CROP_IDS: CropId[] = ['penumbra', 'lit'];
const SCENARIO: Scenario = { id: 'banding-sheet', description: 'the P1 sheet framing: wadi_halam_4, booted camera, z1', sandboxMap: MAP, ticks: 0, cameraMarker: 'unused' };

const loads: { at: string; load1m: number }[] = [];
function noteLoad(at: string): number {
  const l = os.loadavg()[0] as number;
  loads.push({ at, load1m: l });
  console.log(`[banding-sheet] loadavg (1 min) at ${at}: ${l.toFixed(2)}`);
  return l;
}
if (noteLoad('start') > MAX_LOAD) refuse(`1-minute load ${loads[0]?.load1m.toFixed(2)} is above --max-load=${MAX_LOAD}`);

/** The dither amount is the unconditional output term's uniform; 0 reproduces the pre-T8 no-grade frame exactly. */
const SET_DITHER = (v: 0 | 1): string => `(() => { const g = window.__lions.renderer.gradePass; g.uniforms.uGradeDither.value = ${v}; return g.uniforms.uGradeOn.value + ',' + g.uniforms.uGradeDither.value; })()`;
const SET_FLAT = (flat: boolean): string => `(() => { const R = window.__lions.renderer; return R.setDebugLayerVisible('ground-albedo', ${!flat}) + '+' + R.setDebugLayerVisible('macro', ${!flat}); })()`;

const repaintScript = (arm: SheetArm): string => `(async () => {
  const R = window.__lions.renderer;
  for (let i = 0; i < 2; i++) {
${GPU_OF[arm] === 'legacy' ? '' : '    await new Promise(function (r) { window.requestAnimationFrame(function () { r(); }); });\n'}    R.frame(1, 0);
  }
${GPU_OF[arm] === 'legacy' ? '' : '  await R.whenGpuIdle();\n'}  return 'ok';
})()`;
const CANVAS_GRAB_SCRIPT = `(async () => {
  const R = window.__lions.renderer;
  await new Promise(function (r) { window.requestAnimationFrame(function () { r(); }); });
  R.frame(1, 0);
  const c = document.createElement('canvas');
  c.width = R.canvas.width; c.height = R.canvas.height;
  c.getContext('2d').drawImage(R.canvas, 0, 0);
  await R.whenGpuIdle();
  return c.toDataURL('image/png').split(',')[1];
})()`;

const toFrame = (png: Buffer): Frame => {
  const p = PNG.sync.read(png);
  return { w: p.width, h: p.height, data: p.data };
};
function pngOf(data: Uint8Array, w: number, h: number): Buffer {
  const p = new PNG({ width: w, height: h, colorType: 2 });
  for (let i = 0; i < w * h; i++) {
    p.data[i * 4] = data[i * 4] as number;
    p.data[i * 4 + 1] = data[i * 4 + 1] as number;
    p.data[i * 4 + 2] = data[i * 4 + 2] as number;
    p.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(p, { colorType: 2 });
}

interface Cell {
  index: Record<CropId, IndexReading>;
  frame: Frame;
}
interface ArmOut {
  info: { kind: string; adapter: string };
  tick: number;
  cells: Map<string, Cell>;
}
const key = (s: SheetState, p: SheetPhase): string => `${s}-${p}`;

async function runArm(arm: SheetArm, port: number): Promise<ArmOut> {
  const browser: Browser = await chromium.launch({ headless: true, args: [...gpuLaunchArgs('metal'), '--enable-unsafe-webgpu'] });
  try {
    const page: Page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: DPR });
    await page.addInitScript(musicOffInitScript({}, { quality: 'high' }));
    await page.addInitScript('window.__name = (f) => f;');
    await page.addInitScript(bootFreezeScriptFor(GPU_OF[arm]));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(threeUrl(port, SCENARIO, GPU_OF[arm]), { waitUntil: 'load', timeout: 120_000 });
    await page.waitForFunction(() => typeof (window as unknown as { __lions?: unknown }).__lions !== 'undefined', undefined, { timeout: 180_000 });
    await page.evaluate(FREEZE_FRAME_LOOP_SCRIPT);
    await page.evaluate(() => document.fonts.ready);
    const settled = JSON.parse((await page.evaluate(BOOT_SETTLE_SCRIPT)) as string) as { tick: number };
    const fr = bootFreezeRefusal(settled.tick);
    if (fr !== null) refuse(`${arm}: ${fr}`);
    const info = (await page.evaluate('window.__lions.renderer.backendInfo()')) as { kind: string; adapter: string };
    const gpu = (await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      return ext ? String(gl?.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
    })) as string;
    const want = GPU_OF[arm] === 'legacy' ? 'legacy-gl' : 'node-webgpu';
    if (info.kind !== want) refuse(`${arm}: backendInfo().kind is "${info.kind}", expected "${want}"`);
    const drawsOn = GPU_OF[arm] === 'webgpu' ? info.adapter : gpu;
    if (!/metal/i.test(drawsOn) || /swiftshader/i.test(drawsOn)) refuse(`${arm}: draws on "${drawsOn}", not hardware Metal`);
    console.log(`[banding-sheet] ${arm}: ${info.kind} on ${drawsOn}`);

    await page.evaluate(`(async () => { ${HIDE_ALERT_FEED_STATEMENTS}\n await new Promise(function (r) { setTimeout(r, ${HUD_WALL_CLOCK_SETTLE_MS}); }); ${CAPTURE_PRECONDITION_STATEMENTS} })()`);
    await page.evaluate(hideHudExceptCanvas);
    const cam = JSON.parse(
      (await page.evaluate(`(async () => {
  const R = window.__lions.renderer;
  R.camera.zoom = 1;
${arm === 'L' ? `  { const u = await import(${JSON.stringify(UNPORTED)}); u.censusUnported(R.scene); }\n` : ''}  for (let i = 0; i < 20; i++) {
${GPU_OF[arm] === 'legacy' ? '' : '    await new Promise(function (r) { window.requestAnimationFrame(function () { r(); }); });\n'}    R.frame(1, 100);
    await new Promise(function (r) { setTimeout(r, 100); });
  }
${GPU_OF[arm] === 'legacy' ? '' : '  await R.whenGpuIdle();\n'}  return JSON.stringify({ tick: window.__lions.sim.tickCount });
})()`)) as string
    ) as { tick: number };
    const grabKind = GPU_OF[arm] === 'webgpu' ? 'canvas' : 'screenshot';
    const rect = (await page.evaluate(() => {
      const r = document.querySelector('canvas')?.getBoundingClientRect();
      return { x: r?.x ?? 0, y: r?.y ?? 0, width: r?.width ?? 0, height: r?.height ?? 0 };
    })) as { x: number; y: number; width: number; height: number };
    const grab = async (): Promise<Frame> => {
      await page.evaluate(repaintScript(arm));
      return grabKind === 'canvas' ? toFrame(Buffer.from((await page.evaluate(CANVAS_GRAB_SCRIPT)) as string, 'base64')) : toFrame(await page.screenshot({ clip: rect }));
    };
    const states: SheetState[] = arm === 'Ls' ? ['shipped'] : ['shipped', 'flat'];
    const cells = new Map<string, Cell>();
    // The repaint control: two paints of the before/shipped state; their differing pixels are UNSTABLE and skipped by the toggle check.
    console.log(`[banding-sheet] ${arm} dither: ${await page.evaluate(SET_DITHER(0))}`);
    const a = await grab();
    const b = await grab();
    if (a.w !== 1440 * DPR || a.h !== 900 * DPR) refuse(`${arm}: frame is ${a.w}x${a.h}`);
    const unstable = unstableMask(a, b);
    for (const s of states) {
      if (s === 'flat') console.log(`[banding-sheet] ${arm} flat: ${await page.evaluate(SET_FLAT(true))}`);
      for (const p of ['before', 'after'] as const) {
        await page.evaluate(SET_DITHER(p === 'before' ? 0 : 1));
        const f = await grab();
        const idx: Record<CropId, IndexReading> = { penumbra: readIndex(f, CROPS.penumbra), lit: readIndex(f, CROPS.lit) };
        cells.set(key(s, p), { index: idx, frame: f });
        console.log(`[banding-sheet] ${arm} ${s} ${p}: penumbra ${fmtIndex(idx.penumbra)}, lit ${fmtIndex(idx.lit)}`);
      }
      const bf = (cells.get(key(s, 'before')) as Cell).frame;
      const af = (cells.get(key(s, 'after')) as Cell).frame;
      const moved = abDelta(bf, af, unstable);
      if (moved.changed === 0) refuse(`${arm} ${s}: the dither toggle moved no stable pixel (a toggle that changed nothing tested nothing)`);
    }
    if (states.includes('flat')) {
      const sh = (cells.get(key('shipped', 'before')) as Cell).frame;
      const fl = (cells.get(key('flat', 'before')) as Cell).frame;
      if (arm === 'L' && abDelta(sh, fl, unstable).changed === 0) refuse(`${arm}: hiding ground-albedo and macro moved no pixel`);
    }
    await page.close();
    return { info, tick: cam.tick, cells };
  } finally {
    await browser.close();
  }
}

const startedAt = new Date().toISOString();
const port = await claimPort('webgpu-banding-sheet', 'WEBGPU_BANDING_SHEET_PORT', 5194);
const stop = devServerStopper(await ensureDevServer(port, ROOT, 'webgpu-banding-sheet'), 'webgpu-banding-sheet');
const out = new Map<SheetArm, ArmOut>();
try {
  for (const a of ARMS) {
    out.set(a, await runArm(a, port));
    noteLoad(a === 'G' ? 'end' : `after ${a}`);
  }
} finally {
  stop();
}

const cell = (a: SheetArm, s: SheetState, p: SheetPhase): Cell => {
  const c = out.get(a)?.cells.get(key(s, p));
  if (c === undefined) throw new Error(`banding-sheet: no ${a} ${s} ${p}`);
  return c;
};
const num = (r: IndexReading): number | null => ('refused' in r ? null : r.index);
const idxOf = (a: SheetArm, s: SheetState, p: SheetPhase): Record<CropId, number | null> => ({ penumbra: num(cell(a, s, p).index.penumbra), lit: num(cell(a, s, p).index.lit) });

// Tiles: per arm x crop x state, a before/after pair stretched by the BEFORE tile's range.
const tiles: string[] = [];
const dataUri = (buf: Buffer): string => `data:image/png;base64,${buf.toString('base64')}`;
const rowsHtml: string[] = [];
for (const a of ARMS) {
  for (const c of CROP_IDS) {
    const cellsHtml: string[] = [];
    for (const s of (a === 'Ls' ? ['shipped'] : ['flat', 'shipped']) as SheetState[]) {
      const range = stretchRange(cell(a, s, 'before').frame, CROPS[c]);
      for (const p of ['before', 'after'] as const) {
        const cl = cell(a, s, p);
        const tile = stretchedTile(cl.frame, CROPS[c], range);
        const file = path.join(OUT, `${a}-${c}-${s}-${p}.png`);
        writeFileSync(file, pngOf(tile, CROPS[c].w, CROPS[c].h));
        tiles.push(file);
        cellsHtml.push(`<figure><img src="${dataUri(pngOf(tile, CROPS[c].w, CROPS[c].h))}" width="${CROPS[c].w * 2}"><figcaption>${LABEL[a]} / ${c} / ${s} / ${p}<br>bandingIndex <b>${fmtIndex(cl.index[c])}</b> (stretch ${range.lo}-${range.hi})</figcaption></figure>`);
      }
    }
    rowsHtml.push(`<div class="row">${cellsHtml.join('')}</div>`);
  }
}
const ls = { b: cell('Ls', 'shipped', 'before').frame, a: cell('Ls', 'shipped', 'after').frame };
const diff = amplifiedDiff(ls.b, ls.a, 8);
const half = (f: Frame): Buffer => pngOf(f.data as Uint8Array, f.w, f.h);
const fullHtml = `<div class="row">
<figure><img src="${dataUri(half(ls.b))}" width="720"><figcaption>L shipped, full frame z1, BEFORE (dither 0)</figcaption></figure>
<figure><img src="${dataUri(half(ls.a))}" width="720"><figcaption>L shipped, full frame z1, AFTER (dither 1)</figcaption></figure>
<figure><img src="${dataUri(pngOf(diff.data, ls.b.w, ls.b.h))}" width="720"><figcaption>|after - before| x8: ${diff.changed} px changed, mean ${diff.meanAbs.toFixed(3)} channel units</figcaption></figure></div>`;
const html = `<html><body style="background:#222;color:#ddd;font:14px sans-serif;margin:8px"><style>.row{display:flex;gap:8px;margin-bottom:8px}img{image-rendering:pixelated;display:block}figure{margin:0}</style>
<h3>WebGPU P2 T8: banding before / after the unconditional output dither (${MAP}, z1, DPR 2, Metal). Stretched crops: the BEFORE tile's 1st-99th luma percentile maps to 0-255 for the pair.</h3>
${rowsHtml.join('\n')}${fullHtml}</body></html>`;
const sheetPage = await (await chromium.launch({ headless: true })).newPage({ viewport: { width: 3000, height: 800 } });
await sheetPage.setContent(html);
await sheetPage.screenshot({ path: path.join(OUT, 'banding-sheet.png'), fullPage: true });
await sheetPage.context().browser()?.close();

const node = gateRows(idxOf('G', 'flat', 'after'), idxOf('L', 'flat', 'after'));
const legacy = legacyFalls(idxOf('L', 'flat', 'before'), idxOf('L', 'flat', 'after'));
const md: string[] = [
  `# T8 banding sheet (${startedAt})`,
  '',
  `Conditions: map=${MAP}, 1440x900 DPR ${DPR}, booted camera z1, quality high, music off, reduced motion, Metal (L on ${out.get('L')?.info.kind}, G on ${out.get('G')?.info.adapter}); sim tick ${out.get('L')?.tick}; loadavg ${loads.map((l) => `${l.at} ${l.load1m.toFixed(2)}`).join(', ')}.`,
  '',
  '| arm | state | phase | penumbra | lit |',
  '|---|---|---|---|---|',
  ...ARMS.flatMap((a) => (a === 'Ls' ? ['shipped'] : ['flat', 'shipped']).flatMap((s) => (['before', 'after'] as const).map((p) => `| ${LABEL[a]} | ${s} | ${p} | ${fmtIndex(cell(a, s as SheetState, p).index.penumbra)} | ${fmtIndex(cell(a, s as SheetState, p).index.lit)} |`))),
  '',
  `Legacy shipped frame, after minus before: ${diff.changed} px changed, mean ${diff.meanAbs.toFixed(4)} channel units.`,
  '',
  '## Gate (flat state, texture removed from both arms)',
  '',
  ...node.map((r) => `- node flat index (G, after) ${r.node === null ? 'REFUSED' : r.node.toFixed(3)} <= L-matched flat (after) ${r.legacy === null ? 'REFUSED' : r.legacy.toFixed(3)} on ${r.crop}: ${r.verdict}`),
  ...legacy.map((r) => `- L-matched flat index falls across the fix on ${r.crop}: ${r.legacy === null ? 'REFUSED' : r.legacy.toFixed(3)} -> ${r.node === null ? 'REFUSED' : r.node.toFixed(3)}: ${r.verdict}`),
];
writeFileSync(path.join(OUT, 'banding-sheet.md'), md.join('\n') + '\n');
console.log(md.join('\n'));
const bad = [...node, ...legacy].filter((r) => r.verdict !== 'PASS');
process.exit(bad.some((r) => r.verdict === 'REFUSED') ? 2 : bad.length > 0 ? 1 : 0);
