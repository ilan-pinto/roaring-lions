/**
 * GH-943 WebGPU P2 T2: the banding probe. A DIAGNOSIS, not a gate: it reads `bandingIndex` (`golden-diff/banding.ts`) on two fixed crops
 * of the P1 sheet's framing, once per hypothesis toggle, on every arm, and writes the table T8 is sized by.
 *
 *   pnpm --filter @lions/tools exec tsx src/perf/webgpu-banding-probe.ts --out-dir=<dir> [--hw=metal|swiftshader] [--arms=L,G[,F]]
 *       [--port=5193] [--lock=<dir>] [--max-load=4]
 *
 * The framing is the sheet's (`webgpu-p1-sheet.ts`): `?sandbox=wadi_halam_4`, the booted camera at zoom 1, the parked force, the loop frozen
 * at boot (the app's own flag on the node arms, the rAF-dropping script on legacy), sim tick 5, quality high, music off, reduced motion,
 * 1440x900 at DPR 2. L is L-MATCHED (the node census' hidden set hidden on the legacy scene). The crops are the committed fixtures'
 * rectangles (`golden-diff/fixtures/banding/manifest.json`), one source for both.
 *
 * Per arm, one page: a baseline and a repaint control (two zero-time repaints; the pixels that differ are UNSTABLE and every delta skips
 * them), then each variant: apply, repaint, photograph, read both crops, restore, repaint, photograph, check the restore. The hypotheses:
 *   H0 exposure      `ground-albedo` + `macro` hidden: the flat palette ground on L (G has no texture to hide).
 *   H1 dither        the output dither forced ON and OFF through a near-identity grade (the dither runs only while a grade is on), on
 *                    both arms; the uniforms are read first; the dither's y convention is read off the frames (`ditherConvention`).
 *   H2 precision     every node target's type and format, the canvas format and colour space are read; the scene pass at FloatType (node).
 *   H3 shadows       `shadow.radius` 0 and 4 (1 is shipped), BasicShadowMap on both arms, VSM on node; the shadow depth format is read.
 *   H4 AO            `ao` hidden on both arms.
 *   H5 sky light     `environment` hidden on both arms.
 *   HX the shroud    `fog` hidden (every on-map tile revealed): says whether the large soft "shadow" is a shadow at all.
 *
 * REFUSES (exit 2): a crop whose mask is empty (`bandingIndex`'s refusal), a hypothesis whose toggle moved no stable pixel on any arm,
 * a page whose backend is not the arm's, on Metal a page that is not hardware Metal, a Metal run without `--lock=<dir>` naming the
 * BROWSER.lock the caller holds, and a Metal run above `--max-load`. Writes `banding-probe.json`, `banding-probe.md` and the crops.
 * Presentation only: it toggles renderer state and repaints; it never steps the sim past the boot settle.
 */
import { chromium, type Browser, type Page } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { bootFreezeRefusal, bootFreezeScriptFor, BOOT_SETTLE_SCRIPT, CAPTURE_PRECONDITION_STATEMENTS, FREEZE_FRAME_LOOP_SCRIPT, HIDE_ALERT_FEED_STATEMENTS, HUD_WALL_CLOCK_SETTLE_MS, hideHudExceptCanvas, threeUrl, type Scenario } from '../golden-diff/capture-protocol';
import { devServerStopper, ensureDevServer } from '../golden-diff/browser';
import { chromiumArgsFor, type GpuArm } from '../golden-diff/backend';
import type { Crop } from '../golden-diff/banding';
import { gpuLaunchArgs } from '../ui-review/gpu';
import { musicOffInitScript } from '../ui-review/music-off';
import { claimPort } from '../ui-review/port';
import {
  abDelta,
  deadHypotheses,
  ditherConvention,
  fmtIndex,
  HYPOTHESIS_NAME,
  readIndex,
  unstableMask,
  variantTable,
  type CropId,
  type Delta,
  type Frame,
  type Hypothesis,
  type IndexReading,
  type ProbeArm,
  type VariantRow,
} from './webgpu-banding-probe-lib';
import { grassCondition, hideGrassOnPage } from './webgpu-grass-lib';

const args = process.argv.slice(2);
const arg = (n: string, d: string): string => (args.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).slice(n.length + 3);
const TOOLS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ROOT = path.resolve(TOOLS, '..');
const HW = arg('hw', process.platform === 'darwin' ? 'metal' : 'swiftshader') as 'metal' | 'swiftshader';
const ARMS = arg('arms', HW === 'metal' ? 'L,G' : 'L,F,G').split(',') as ProbeArm[];
const OUT = path.resolve(arg('out-dir', ''));
const LOCK = arg('lock', '');
const MAX_LOAD = Number(arg('max-load', '4'));
const DPR = 2;
const MAP = 'wadi_halam_4';
const ARM_OF: Record<ProbeArm, GpuArm> = { L: 'legacy', G: 'webgpu', F: 'webgl2' };
const UNPORTED = `/@fs${ROOT}/packages/render/src/three/backend/unported.ts`;
const MANIFEST = path.join(TOOLS, 'src/golden-diff/fixtures/banding/manifest.json');

function refuse(msg: string): never {
  console.error(`webgpu-banding-probe: REFUSED: ${msg}`);
  process.exit(2);
}
if (args.find((a) => a.startsWith('--out-dir=')) === undefined) refuse('--out-dir=<dir> is required');
if (HW !== 'metal' && HW !== 'swiftshader') refuse(`--hw=${HW} is not metal or swiftshader`);
for (const a of ARMS) if (!(a in ARM_OF)) refuse(`--arms: "${a}" is not L, G or F`);
if (HW === 'metal' && (LOCK === '' || !existsSync(LOCK))) refuse('--lock=<dir> must name the BROWSER.lock directory the caller holds (a Metal run is one lock hold)');
mkdirSync(OUT, { recursive: true });

const CROPS = (JSON.parse(readFileSync(MANIFEST, 'utf8')) as { crops: Record<CropId, Crop> }).crops;
const CROP_IDS: CropId[] = ['penumbra', 'lit'];
const SCENARIO: Scenario = { id: 'banding-probe', description: 'the P1 sheet framing: wadi_halam_4, booted camera, z1', sandboxMap: MAP, ticks: 0, cameraMarker: 'unused' };

const loads: { at: string; load1m: number }[] = [];
function noteLoad(at: string): number {
  const l = os.loadavg()[0] as number;
  loads.push({ at, load1m: l });
  console.log(`[banding-probe] loadavg (1 min) at ${at}: ${l.toFixed(2)}`);
  return l;
}
if (HW === 'metal' && noteLoad('start') > MAX_LOAD) refuse(`1-minute load ${loads[0]?.load1m.toFixed(2)} is above --max-load=${MAX_LOAD}`);
if (HW !== 'metal') noteLoad('start');

// ---------------------------------------------------------------------------------------------------------------------------------
// In-page: the variants, the reads, the repaint and the photograph.
// ---------------------------------------------------------------------------------------------------------------------------------

interface VariantSpec {
  readonly hypothesis: Hypothesis;
  readonly id: string;
  /** Arms the variant runs on (H2's FloatType swap and H3's VSM are node-only, as the brief puts them). */
  readonly arms: readonly ProbeArm[];
}
const VARIANTS: readonly VariantSpec[] = [
  { hypothesis: 'H0', id: 'flat-ground', arms: ['L', 'G', 'F'] },
  { hypothesis: 'H1', id: 'dither-on', arms: ['L', 'G', 'F'] },
  { hypothesis: 'H1', id: 'dither-off', arms: ['L', 'G', 'F'] },
  { hypothesis: 'H2', id: 'float-scene', arms: ['G', 'F'] },
  { hypothesis: 'H4', id: 'ao-off', arms: ['L', 'G', 'F'] },
  { hypothesis: 'H5', id: 'env-off', arms: ['L', 'G', 'F'] },
  { hypothesis: 'HX', id: 'shroud-off', arms: ['L', 'G', 'F'] },
  // The shadow-type switches recompile every material, so they run last on a page.
  { hypothesis: 'H3', id: 'radius-0', arms: ['L', 'G', 'F'] },
  { hypothesis: 'H3', id: 'radius-4', arms: ['L', 'G', 'F'] },
  { hypothesis: 'H3', id: 'basic', arms: ['L', 'G', 'F'] },
  { hypothesis: 'H3', id: 'vsm', arms: ['G', 'F'] },
];

/** Installs `window.__band` on the page: one apply and one restore per variant, and the reads. Plain JS (an injected string). */
const SETUP_SCRIPT = `(() => {
  const R = window.__lions.renderer;
  const node = R.nodeBackend;
  const nr = node ? node.post.pipeline.renderer : null;
  const gl = node ? null : R.renderer;
  const TYPES = { 1009: 'UnsignedByte', 1010: 'Byte', 1012: 'UnsignedShort', 1014: 'UnsignedInt', 1015: 'Float', 1016: 'HalfFloat', 1020: 'UnsignedInt248' };
  const FORMATS = { 1023: 'RGBA', 1026: 'Depth', 1027: 'DepthStencil', 1030: 'RG' };
  const SHADOW = { 0: 'Basic', 1: 'PCF', 2: 'PCFSoft', 3: 'VSM' };
  const typeName = function (t) { return t === undefined || t === null ? null : (TYPES[t] || String(t)); };
  const gpuFormat = function (tex) {
    if (!tex || !nr) return null;
    const d = nr.backend.get(tex);
    if (!d) return null;
    if (d.texture && d.texture.format) return d.texture.format;
    if (d.glInternalFormat !== undefined) return 'gl:' + d.glInternalFormat;
    return null;
  };
  const sun = R.sceneLights.sun;
  const shadowRenderer = node ? nr : gl;
  const saved = { radius: sun.shadow.radius, type: shadowRenderer.shadowMap.type };
  // The dither runs only while a grade is on (uGradeOn > 0.5), on both paths. A near-identity grade turns the grade on without moving a
  // colour (saturation 1 + 1e-6, so isIdentity says no; the LUT then holds the identity to its half-float precision).
  const NEAR = { lift: [0, 0, 0], gain: [1, 1, 1], gamma: [1, 1, 1], saturation: 1.000001, warmth: 0, shadowTone: [0, 0, 0], highlightTone: [0, 0, 0], balance: 0.5 };
  const touchMaterials = function () {
    let n = 0;
    R.scene.traverse(function (o) {
      const m = o.material;
      if (!m) return;
      (Array.isArray(m) ? m : [m]).forEach(function (x) { x.needsUpdate = true; n++; });
    });
    return n;
  };
  const setShadowType = function (t) {
    shadowRenderer.shadowMap.type = t;
    if (!node) shadowRenderer.shadowMap.needsUpdate = true;
    return SHADOW[t] + ' (' + touchMaterials() + ' materials rebuilt)';
  };
  const layer = function (n, v) { return R.setDebugLayerVisible(n, v); };
  const sceneType = function (t) {
    const rt = node.post.scenePass.renderTarget;
    for (const tex of rt.textures) tex.type = t;
    rt.dispose();
    return 'scene pass ' + typeName(t);
  };
  const V = {
    'flat-ground': { apply: function () { return 'objects ' + layer('ground-albedo', false) + '+' + layer('macro', false); }, restore: function () { layer('ground-albedo', true); layer('macro', true); } },
    'dither-on': { apply: function () { return 'grade ' + R.gradePass.apply(NEAR, { dither: true }) + ', uGradeOn ' + R.gradePass.uniforms.uGradeOn.value + ', uGradeDither ' + R.gradePass.uniforms.uGradeDither.value; }, restore: function () { R.gradePass.apply(null); } },
    'dither-off': { apply: function () { return 'grade ' + R.gradePass.apply(NEAR, { dither: false }) + ', uGradeOn ' + R.gradePass.uniforms.uGradeOn.value + ', uGradeDither ' + R.gradePass.uniforms.uGradeDither.value; }, restore: function () { R.gradePass.apply(null); } },
    'float-scene': { apply: function () { return sceneType(1015); }, restore: function () { sceneType(1016); } },
    'ao-off': { apply: function () { return 'objects ' + layer('ao', false); }, restore: function () { layer('ao', true); } },
    'env-off': { apply: function () { return 'objects ' + layer('environment', false); }, restore: function () { layer('environment', true); } },
    'shroud-off': { apply: function () { return 'objects ' + layer('fog', false); }, restore: function () { layer('fog', true); } },
    'radius-0': { apply: function () { sun.shadow.radius = 0; return 'radius 0 (was ' + saved.radius + ')'; }, restore: function () { sun.shadow.radius = saved.radius; } },
    'radius-4': { apply: function () { sun.shadow.radius = 4; return 'radius 4 (was ' + saved.radius + ')'; }, restore: function () { sun.shadow.radius = saved.radius; } },
    'basic': { apply: function () { return setShadowType(0); }, restore: function () { setShadowType(saved.type); } },
    'vsm': { apply: function () { return setShadowType(3); }, restore: function () { setShadowType(saved.type); } },
  };
  const reads = function () {
    const out = { backend: R.backendInfo(), passNames: (R.postChain() || { passNames: [] }).passNames };
    const g = R.gradePass;
    out.grade = g ? { uGradeOn: g.uniforms.uGradeOn.value, uGradeDither: g.uniforms.uGradeDither.value, active: g.active, enabled: g.enabled } : null;
    const map = sun.shadow.map;
    const depth = map ? map.depthTexture : null;
    out.shadow = {
      type: SHADOW[shadowRenderer.shadowMap.type], radius: sun.shadow.radius, mapSize: sun.shadow.mapSize.x, bias: sun.shadow.bias, normalBias: sun.shadow.normalBias,
      mapTexture: map ? typeName(map.texture.type) : null,
      depth: depth ? { type: typeName(depth.type), format: FORMATS[depth.format] || String(depth.format), gpu: gpuFormat(depth), compare: depth.compareFunction } : null,
    };
    out.renderer = { outputColorSpace: shadowRenderer.outputColorSpace, toneMapping: shadowRenderer.toneMapping, exposure: shadowRenderer.toneMappingExposure };
    if (node) {
      const sp = node.post.scenePass.renderTarget;
      const smaa = node.post.smaaInput;
      out.targets = {
        scenePass: { type: typeName(sp.texture.type), gpu: gpuFormat(sp.texture) },
        sceneDepth: sp.depthTexture ? { type: typeName(sp.depthTexture.type), format: FORMATS[sp.depthTexture.format] || String(sp.depthTexture.format), gpu: gpuFormat(sp.depthTexture) } : null,
        smaaInput: smaa ? { type: typeName(smaa.renderTarget.texture.type), gpu: gpuFormat(smaa.renderTarget.texture) } : null,
      };
      if (nr.backend.isWebGPUBackend) {
        const ctx = nr.backend.context;
        const conf = ctx && ctx.getConfiguration ? ctx.getConfiguration() : null;
        out.canvas = { api: 'webgpu', format: conf ? conf.format : nr.backend.utils.getPreferredCanvasFormat(), colorSpace: conf ? conf.colorSpace : null, toneMapping: conf && conf.toneMapping ? conf.toneMapping.mode : null, alphaMode: conf ? conf.alphaMode : null, preferred: navigator.gpu.getPreferredCanvasFormat(), outputType: typeName(nr.backend.parameters.outputType) };
      } else {
        const c = R.canvas.getContext('webgl2');
        out.canvas = c ? { api: 'webgl2', bits: [c.getParameter(c.RED_BITS), c.getParameter(c.GREEN_BITS), c.getParameter(c.BLUE_BITS)], colorSpace: c.drawingBufferColorSpace, format: c.drawingBufferFormat === undefined ? null : c.drawingBufferFormat } : null;
      }
    } else {
      const comp = R.post.composer;
      out.targets = { composerRT1: { type: typeName(comp.renderTarget1.texture.type) }, composerRT2: { type: typeName(comp.renderTarget2.texture.type) } };
      const c = gl.getContext();
      out.canvas = { api: 'webgl2', bits: [c.getParameter(c.RED_BITS), c.getParameter(c.GREEN_BITS), c.getParameter(c.BLUE_BITS)], colorSpace: c.drawingBufferColorSpace, format: c.drawingBufferFormat === undefined ? null : c.drawingBufferFormat };
    }
    return out;
  };
  window.__band = { V: V, reads: reads };
  return 'ok';
})()`;

/** Two zero-time repaints (a node arm waits a native rAF before each: its passes redraw once per frameId), then the GPU idle. */
const repaintScript = (arm: ProbeArm): string => `(async () => {
  const R = window.__lions.renderer;
  for (let i = 0; i < 2; i++) {
${ARM_OF[arm] === 'legacy' ? '' : '    await new Promise(function (r) { window.requestAnimationFrame(function () { r(); }); });\n'}    R.frame(1, 0);
  }
${ARM_OF[arm] === 'legacy' ? '' : '  await R.whenGpuIdle();\n'}  return 'ok';
})()`;

/** On Metal a WebGPU canvas screenshot reads black (the sheet's finding), so G is copied out of the canvas in the render's own task. */
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

interface ArmResult {
  arm: ProbeArm;
  backend: string;
  adapter: string;
  gpu: string;
  grab: 'screenshot' | 'canvas';
  tick: number;
  camera: { x: number; y: number; zoom: number };
  reads: unknown;
  readsAfter: unknown;
  control: { frame: Delta; crops: Record<CropId, Delta> };
  baseline: Record<CropId, IndexReading>;
  rows: VariantRow[];
  dither: Record<CropId, { bottomLeft: number; topLeft: number; moved: number }> | null;
  consoleErrors: string[];
}

const toFrame = (png: Buffer): Frame => {
  const p = PNG.sync.read(png);
  return { w: p.width, h: p.height, data: p.data };
};

function writeCrop(f: Frame, crop: Crop, file: string): void {
  const out = new PNG({ width: crop.w, height: crop.h, colorType: 2 });
  for (let y = 0; y < crop.h; y++) {
    for (let x = 0; x < crop.w; x++) {
      const s = ((crop.y + y) * f.w + crop.x + x) * 4;
      const d = (y * crop.w + x) * 4;
      out.data[d] = f.data[s] as number;
      out.data[d + 1] = f.data[s + 1] as number;
      out.data[d + 2] = f.data[s + 2] as number;
      out.data[d + 3] = 255;
    }
  }
  writeFileSync(file, PNG.sync.write(out, { colorType: 2 }));
}

async function launch(arm: ProbeArm): Promise<Browser> {
  if (HW === 'metal') return chromium.launch({ headless: true, args: [...gpuLaunchArgs('metal'), '--enable-unsafe-webgpu'] });
  const a = chromiumArgsFor(ARM_OF[arm]);
  return chromium.launch(a.length === 0 ? { headless: true } : { headless: true, args: a });
}

async function probeArm(arm: ProbeArm, port: number): Promise<ArmResult> {
  const browser = await launch(arm);
  const consoleErrors: string[] = [];
  try {
    const page: Page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: DPR });
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    await page.addInitScript(musicOffInitScript({}, { quality: 'high' }));
    await page.addInitScript('window.__name = (f) => f;');
    await page.addInitScript(bootFreezeScriptFor(ARM_OF[arm]));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(threeUrl(port, SCENARIO, ARM_OF[arm]), { waitUntil: 'load', timeout: 120_000 });
    await page.waitForFunction(() => typeof (window as unknown as { __lions?: unknown }).__lions !== 'undefined', undefined, { timeout: 180_000 });
    await page.evaluate(FREEZE_FRAME_LOOP_SCRIPT);
    await page.evaluate(() => document.fonts.ready);
    const settled = JSON.parse((await page.evaluate(BOOT_SETTLE_SCRIPT)) as string) as { tick: number };
    const fr = bootFreezeRefusal(settled.tick);
    if (fr !== null) refuse(`${arm}: ${fr}`);
    // GH-1167 S6: the L-vs-G tools hide the 3D grass field (the grass cost is its own column).
    await hideGrassOnPage(page, `banding-probe ${arm}`).catch((e: Error) => refuse(e.message));
    const info = (await page.evaluate('window.__lions.renderer.backendInfo()')) as { kind: string; adapter: string };
    const gpu = (await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      return ext ? String(gl?.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
    })) as string;
    const want = ARM_OF[arm] === 'legacy' ? 'legacy-gl' : ARM_OF[arm] === 'webgl2' ? 'node-webgl2' : 'node-webgpu';
    if (info.kind !== want) refuse(`${arm}: backendInfo().kind is "${info.kind}", expected "${want}" (a fallback is evidence about the fallback)`);
    const drawsOn = ARM_OF[arm] === 'webgpu' ? info.adapter : gpu;
    if (HW === 'metal' && (!/metal/i.test(drawsOn) || /swiftshader/i.test(drawsOn))) refuse(`${arm}: draws on "${drawsOn}", not hardware Metal`);
    console.log(`[banding-probe] ${arm}: ${info.kind} on ${drawsOn}`);

    // The sheet's own order: the HUD's wall-clock animations run out, then everything but the canvas goes.
    await page.evaluate(`(async () => { ${HIDE_ALERT_FEED_STATEMENTS}\n await new Promise(function (r) { setTimeout(r, ${HUD_WALL_CLOCK_SETTLE_MS}); }); ${CAPTURE_PRECONDITION_STATEMENTS} })()`);
    await page.evaluate(hideHudExceptCanvas);
    // z1 at the booted camera; L-matched runs the node census on the legacy scene. Then paced frames at this view (late mesh templates
    // are instantiated BY a frame), as the sheet does before it photographs.
    const cam = JSON.parse(
      (await page.evaluate(`(async () => {
  const R = window.__lions.renderer;
  R.camera.zoom = 1;
${arm === 'L' ? `  { const u = await import(${JSON.stringify(UNPORTED)}); u.censusUnported(R.scene); }\n` : ''}  for (let i = 0; i < 20; i++) {
${ARM_OF[arm] === 'legacy' ? '' : '    await new Promise(function (r) { window.requestAnimationFrame(function () { r(); }); });\n'}    R.frame(1, 100);
    await new Promise(function (r) { setTimeout(r, 100); });
  }
${ARM_OF[arm] === 'legacy' ? '' : '  await R.whenGpuIdle();\n'}  return JSON.stringify({ x: R.camera.x, y: R.camera.y, zoom: R.camera.zoom, tick: window.__lions.sim.tickCount });
})()`)) as string
    ) as { x: number; y: number; zoom: number; tick: number };
    if ((await page.evaluate(SETUP_SCRIPT)) !== 'ok') refuse(`${arm}: the in-page probe did not install`);
    const reads = await page.evaluate('window.__band.reads()');

    const grabKind: 'screenshot' | 'canvas' = ARM_OF[arm] === 'webgpu' && HW === 'metal' ? 'canvas' : 'screenshot';
    const rect = (await page.evaluate(() => {
      const r = document.querySelector('canvas')?.getBoundingClientRect();
      return { x: r?.x ?? 0, y: r?.y ?? 0, width: r?.width ?? 0, height: r?.height ?? 0 };
    })) as { x: number; y: number; width: number; height: number };
    // The caller has just repainted (`repaintScript`): the screenshot path photographs that frame; the canvas path draws one more
    // zero-time frame in its own task (it must, to read the WebGPU canvas back).
    const grab = async (): Promise<Frame> => {
      if (grabKind === 'canvas') return toFrame(Buffer.from((await page.evaluate(CANVAS_GRAB_SCRIPT)) as string, 'base64'));
      return toFrame(await page.screenshot({ clip: rect }));
    };
    const readCrops = (f: Frame): Record<CropId, IndexReading> => ({ penumbra: readIndex(f, CROPS.penumbra), lit: readIndex(f, CROPS.lit) });
    const cropDeltas = (a: Frame, b: Frame, unstable: Uint8Array | null): Record<CropId, Delta> => ({
      penumbra: abDelta(a, b, unstable, CROPS.penumbra),
      lit: abDelta(a, b, unstable, CROPS.lit),
    });

    await page.evaluate(repaintScript(arm));
    const base = await grab();
    await page.evaluate(repaintScript(arm));
    const again = await grab();
    if (base.w !== 1440 * DPR || base.h !== 900 * DPR) refuse(`${arm}: frame is ${base.w}x${base.h}, expected ${1440 * DPR}x${900 * DPR} (the crops are in that frame)`);
    const unstable = unstableMask(base, again);
    const control = { frame: abDelta(base, again, null), crops: cropDeltas(base, again, null) };
    const baseline = readCrops(base);
    for (const c of CROP_IDS) writeCrop(base, CROPS[c], path.join(OUT, `${arm}-baseline-${c}.png`));
    console.log(`[banding-probe] ${arm} baseline: penumbra ${fmtIndex(baseline.penumbra)}, lit ${fmtIndex(baseline.lit)}; control ${control.frame.changed} px (penumbra ${control.crops.penumbra.changed}, lit ${control.crops.lit.changed})`);

    const rows: VariantRow[] = [];
    const ditherFrames: Partial<Record<'dither-on' | 'dither-off', Frame>> = {};
    for (const v of VARIANTS) {
      if (!v.arms.includes(arm)) continue;
      const applied = (await page.evaluate(`window.__band.V[${JSON.stringify(v.id)}].apply()`)) as string;
      await page.evaluate(repaintScript(arm));
      const f = await grab();
      for (const c of CROP_IDS) writeCrop(f, CROPS[c], path.join(OUT, `${arm}-${v.id}-${c}.png`));
      if (v.id === 'dither-on' || v.id === 'dither-off') ditherFrames[v.id] = f;
      await page.evaluate(`window.__band.V[${JSON.stringify(v.id)}].restore()`);
      await page.evaluate(repaintScript(arm));
      const back = await grab();
      const row: VariantRow = {
        hypothesis: v.hypothesis,
        variant: v.id,
        arm,
        applied,
        frame: abDelta(base, f, unstable),
        crops: cropDeltas(base, f, unstable),
        index: readCrops(f),
        restored: CROP_IDS.every((c) => abDelta(base, back, unstable, CROPS[c]).changed === 0),
        restoreFramePx: abDelta(base, back, unstable).changed,
      };
      rows.push(row);
      // Written as it goes: a page that dies mid-run still leaves every row it read.
      writeFileSync(path.join(OUT, `partial-${arm}.json`), JSON.stringify({ arm, baseline, control, reads, rows }, null, 2));
      console.log(`[banding-probe] ${arm} ${v.hypothesis} ${v.id}: ${applied}; frame ${row.frame.changed} px, penumbra ${row.crops.penumbra.changed} px idx ${fmtIndex(row.index.penumbra)}, lit ${row.crops.lit.changed} px idx ${fmtIndex(row.index.lit)}${row.restored ? '' : ' NOT RESTORED'}`);
    }
    const on = ditherFrames['dither-on'];
    const off = ditherFrames['dither-off'];
    const dither = on && off ? { penumbra: ditherConvention(on, off, CROPS.penumbra), lit: ditherConvention(on, off, CROPS.lit) } : null;
    const readsAfter = await page.evaluate('window.__band.reads()');
    await page.close();
    return { arm, backend: info.kind, adapter: info.adapter, gpu, grab: grabKind, tick: cam.tick, camera: { x: cam.x, y: cam.y, zoom: cam.zoom }, reads, readsAfter, control, baseline, rows, dither, consoleErrors };
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------------------------------------------------------------

const startedAt = new Date().toISOString();
const port = await claimPort('webgpu-banding-probe', 'WEBGPU_BANDING_PROBE_PORT', 5193);
const stop = devServerStopper(await ensureDevServer(port, ROOT, 'webgpu-banding-probe'), 'webgpu-banding-probe');
const results: ArmResult[] = [];
try {
  for (const [i, a] of ARMS.entries()) {
    results.push(await probeArm(a, port));
    noteLoad(i === ARMS.length - 1 ? 'end' : `after ${a}`);
  }
} finally {
  stop();
}

const allRows = results.flatMap((r) => r.rows);
const dead = deadHypotheses(allRows);
const refusedCrops = results.flatMap((r) => CROP_IDS.filter((c) => 'refused' in r.baseline[c]).map((c) => `${r.arm} ${c}`));
const validation = results.flatMap((r) => r.consoleErrors.filter((l) => /GPUValidationError/i.test(l)).map((l) => `${r.arm}: ${l}`));
const conditions = `map=${MAP} 1440x900 DPR ${DPR} (2880x1800 device px), booted camera z1, sim tick ${results[0]?.tick ?? '?'}, quality high, music off, reduced motion, L matched (node census hidden set hidden); ${grassCondition('hidden')}; hw=${HW}; ${results.map((r) => `${r.arm}=${r.backend} on ${r.backend === 'node-webgpu' ? r.adapter : r.gpu} (${r.grab})`).join('; ')}; loadavg ${loads.map((l) => `${l.at} ${l.load1m.toFixed(2)}`).join(', ')}`;

const md: string[] = [
  `# WebGPU P2 T2: the banding probe (${HW})`,
  '',
  `Run ${startedAt}. Machine: ${os.cpus()[0]?.model ?? 'unknown'}, ${os.platform()}.`,
  '',
  `Conditions: ${conditions}`,
  '',
  `Crops (device px): penumbra ${JSON.stringify(CROPS.penumbra)}, lit ${JSON.stringify(CROPS.lit)}.`,
  '',
  '## Baseline and repaint control',
  '',
  '| arm | backend | gpu | index penumbra | index lit | control frame px | control penumbra px | control lit px |',
  '|---|---|---|---|---|---|---|---|',
  ...results.map((r) => `| ${r.arm} | ${r.backend} | ${r.backend === 'node-webgpu' ? r.adapter : r.gpu} | ${fmtIndex(r.baseline.penumbra)} | ${fmtIndex(r.baseline.lit)} | ${r.control.frame.changed} | ${r.control.crops.penumbra.changed} | ${r.control.crops.lit.changed} |`),
  '',
  '## Variants',
  '',
  ...Object.entries(HYPOTHESIS_NAME).map(([h, n]) => `- ${h}: ${n}`),
  '',
  ...variantTable(allRows),
  '',
  '## The dither\'s y convention (H1: corr of dither-on minus dither-off with the IGN noise, bottom-left vs top-left origin)',
  '',
  '| arm | crop | px moved | corr bottom-left (gl_FragCoord) | corr top-left |',
  '|---|---|---|---|---|',
  ...results.flatMap((r) => (r.dither === null ? [] : CROP_IDS.map((c) => `| ${r.arm} | ${c} | ${r.dither?.[c].moved} | ${r.dither?.[c].bottomLeft.toFixed(3)} | ${r.dither?.[c].topLeft.toFixed(3)} |`))),
  '',
  '## Reads (H1 uniforms, H2 targets and canvas, H3 shadow)',
  '',
  ...results.flatMap((r) => [`### ${r.arm}`, '', '```json', JSON.stringify(r.reads, null, 2), '```', '']),
  '## Refusals',
  '',
  `- empty-mask crops: ${refusedCrops.length === 0 ? 'none' : refusedCrops.join(', ')}`,
  `- hypotheses whose toggle moved no stable pixel on any arm: ${dead.length === 0 ? 'none' : dead.join(', ')}`,
  `- GPUValidationError lines: ${validation.length}`,
  `- rows not restored: ${allRows.filter((r) => !r.restored).map((r) => `${r.arm} ${r.variant}`).join(', ') || 'none'}`,
];
writeFileSync(path.join(OUT, 'banding-probe.md'), md.join('\n') + '\n');
writeFileSync(path.join(OUT, 'banding-probe.json'), JSON.stringify({ startedAt, hw: HW, conditions, loads, crops: CROPS, results, dead, refusedCrops, validation }, null, 2));
console.log(md.join('\n'));
if (refusedCrops.length > 0) refuse(`empty mask on ${refusedCrops.join(', ')}: those crops measure nothing`);
if (dead.length > 0) refuse(`hypotheses ${dead.join(', ')} moved no stable pixel on any arm: a toggle that changed nothing tested nothing`);
process.exit(0);
