/**
 * `pnpm closeups:garage` (GH-238 plan 3 Task 9, K11): the garage's track
 * close-ups, one 480x320 JPEG per KDF type and upgrade track, photographed
 * through the bay's OWN turntable -- the shipped `mountGarageView`, its
 * camera, lights and sand -- with `GarageViewOptions.focus` set, which is
 * what turns the camera onto the track's subject (`three/garage/
 * garage-focus.ts` has the rules). Written to
 * `assets/ui/garage/closeups/<id>_<track>.jpg` with a `manifest.json`;
 * `packages/app/src/ui/garage-closeup.ts` reads both, and the board's track
 * head (`ui/garage-board.ts`) draws the picture where its hatch was.
 *
 *   pnpm closeups:garage
 *   pnpm closeups:garage -- --only=mbt_lavi,inf_squad
 *   pnpm closeups:garage -- --port=5236 --gpu=swiftshader
 *
 * Every flag is checked; anything else exits 2 before a server or a browser
 * starts. `--port` defaults to 5235 (env `CLOSEUPS_PORT`) and a busy port is
 * refused (`ui-review/port.ts`), never attached to. `--gpu` defaults to Metal
 * on macOS (`ui-review/gpu.ts`).
 *
 * ## No app boot
 *
 * The page is a bare host element at the close-up's size, served from the
 * dev server's own origin (a routed HTML stub), which imports the door and
 * the app's own model-source tables straight through Vite (`/@fs/...`). So
 * the GLB, the faction, the stage colours and the sand are exactly the ones
 * the bay resolves (`garage-model-source.ts`), and nothing of the shell --
 * no menu scene host, no router, no audio -- is on the page at all. The
 * music-off seed is still installed, per the standing rule.
 *
 * ## The count
 *
 * What a run owes is derived from `data/units/kdf/*.json`
 * (`garage-closeups-plan.ts`), and a run that wrote a different number is
 * refused (`assertCloseupCount`) after the manifest is written, so a missing
 * close-up cannot pass silently. A full run also deletes any JPEG in the
 * directory that the plan no longer names.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright';
import { paletteColor } from '@lions/data';
import { ensureDevServer, readUnmaskedRenderer, stopDevServer } from '../golden-diff/browser';
import { claimGpuBackend, gpuLaunchArgs } from '../ui-review/gpu';
import { musicOffInitScript } from '../ui-review/music-off';
import { claimPort } from '../ui-review/port';
import { CLOSEUP_H, CLOSEUP_W, assertCloseupCount, closeupPlan, type CloseupJob } from './garage-closeups-plan';

const TAG = 'closeups';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const OUT_DIR = path.join(REPO_ROOT, 'assets/ui/garage/closeups');
const UNITS_DIR = path.join(REPO_ROOT, 'data/units/kdf');
/** Rendered at 2x and scaled down by the browser to CSS pixels: a cleaner
 *  480x320 than one drawn at 480x320. */
const DPR = 2;
const JPEG_QUALITY = 85;
const STUB_PATH = '/__garage-closeups__';

// --- argv: every flag this file reads, and nothing else -------------------
{
  const known = /^--(only|port|gpu)=.+$|^--$/;
  const bad = process.argv.slice(2).filter((a) => !known.test(a));
  if (bad.length > 0) {
    console.error(`[${TAG}] unknown argument(s): ${bad.join(' ')}`);
    console.error(`[${TAG}] usage: pnpm closeups:garage -- [--only=<id>[,<id>...]] [--port=<n>] [--gpu=metal|swiftshader]`);
    process.exit(2);
  }
}
const onlyArg = process.argv.find((a) => a.startsWith('--only='))?.slice('--only='.length) ?? '';
const plan = closeupPlan(UNITS_DIR);
const only = onlyArg.length > 0 ? new Set(onlyArg.split(',')) : null;
if (only) {
  const unknown = [...only].filter((id) => !plan.some((j) => j.id === id));
  if (unknown.length > 0) {
    console.error(`[${TAG}] --only names no KDF type with upgrades: ${unknown.join(', ')}`);
    process.exit(2);
  }
}
const jobs: CloseupJob[] = only ? plan.filter((j) => only.has(j.id)) : plan;
const gpuBackend = claimGpuBackend(TAG);
const PORT = await claimPort(TAG, 'CLOSEUPS_PORT', 5235);

interface CloseupEntry {
  file: string;
  unit: string;
  track: string;
  subject: string;
  yawDeg: number;
  elevationDeg: number;
  distance: number;
}
interface CloseupManifest {
  version: 1;
  camera: { fovDeg: number; size: [number, number]; dpr: number; gpu: string };
  closeups: Record<string, CloseupEntry>;
}

interface FocusInfo {
  track: string;
  subject: string;
  yawDeg: number;
  pixelsByYaw: number[];
  triangles: number;
  points: number;
  figure: string | null;
}
interface MountResult {
  info: {
    cls: string;
    camera: { fovDeg: number; elevationDeg: number; distance: number };
    focus?: FocusInfo;
  };
  warnings: string[];
}

/** The page: a host at the close-up's size on the bay's own tile colour
 *  (`--tile-bg` is `shadow.0`), and a module that mounts the door. A string
 *  module, never a serialised function: tsx's `keepNames` would plant a
 *  `__name` helper the page does not have. */
function stubHtml(): string {
  const fsPath = (rel: string): string => `/@fs${path.join(REPO_ROOT, rel)}`;
  const background = paletteColor('shadow.0');
  return `<!doctype html><html><head><meta charset="utf-8"><title>garage close-ups</title></head>
<body style="margin:0;background:${background}">
<div id="host" style="width:${CLOSEUP_W}px;height:${CLOSEUP_H}px;background:${background}"></div>
<script type="module">
import { mountGarageView } from ${JSON.stringify(fsPath('packages/render/src/three/garage/garage-view.ts'))};
import { garageModelSource, garageColors, garageGroundTexture } from ${JSON.stringify(fsPath('packages/app/src/garage-model-source.ts'))};
import { dracoDecoderPath } from ${JSON.stringify(fsPath('packages/app/src/mesh-catalogue.ts'))};
let view = null;
window.__closeupDispose = () => { if (view) { view.dispose(); view = null; } };
window.__closeup = async (id, track) => {
  window.__closeupDispose();
  const source = garageModelSource(id);
  if (!source) throw new Error(id + ': no GLB in the mesh catalogue');
  const warnings = [];
  const warn = console.warn;
  console.warn = (...a) => { warnings.push(a.map(String).join(' ')); warn(...a); };
  try {
    view = await mountGarageView(document.getElementById('host'), {
      typeId: id, kind: source.kind, meshUrl: source.url, faction: source.faction,
      dracoDecoderPath: dracoDecoderPath(), groundTextureUrl: garageGroundTexture('/'),
      colors: garageColors(), focus: { track },
    });
  } finally { console.warn = warn; }
  const info = view.info;
  if (!info.focus) throw new Error(id + ' ' + track + ': the view reported no focus');
  view.draw(info.focus.yawDeg);
  return { info: { cls: info.cls, camera: info.camera, focus: info.focus }, warnings };
};
window.__closeupReady = true;
</script></body></html>`;
}

/** A JPEG's pixel size, from its first SOFn marker. */
function jpegSize(buf: Buffer): [number, number] {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) throw new Error('not a JPEG marker stream');
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
    }
    i += 2 + len;
  }
  throw new Error('no SOF marker');
}

async function run(): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const devServer = await ensureDevServer(PORT, REPO_ROOT, TAG);
  let browser: Browser | null = null;
  const t0 = Date.now();
  try {
    browser = await chromium.launch({ headless: true, args: gpuLaunchArgs(gpuBackend) });
    const gpu = await readUnmaskedRenderer(browser);
    console.log(`[${TAG}] GPU: ${gpu}`);
    const page = await browser.newPage({ viewport: { width: CLOSEUP_W + 40, height: CLOSEUP_H + 40 }, deviceScaleFactor: DPR });
    await page.addInitScript(musicOffInitScript());
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.log(`  page error: ${msg.text()}`);
    });
    const base = `http://localhost:${PORT}`;
    await page.route(`${base}${STUB_PATH}`, (route) => route.fulfill({ contentType: 'text/html', body: stubHtml() }));
    await page.goto(`${base}${STUB_PATH}`, { waitUntil: 'load', timeout: 120_000 });
    await page.waitForFunction(() => (window as unknown as { __closeupReady?: boolean }).__closeupReady === true, null, {
      timeout: 120_000,
    });

    const manifestPath = path.join(OUT_DIR, 'manifest.json');
    const prior: Record<string, CloseupEntry> =
      only && fs.existsSync(manifestPath) ? (JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as CloseupManifest).closeups : {};
    const closeups: Record<string, CloseupEntry> = { ...prior };
    let fovDeg = 0;
    const wholes: string[] = [];

    for (const job of jobs) {
      const res = (await page.evaluate(
        ([id, track]) =>
          (window as unknown as { __closeup: (i: string, t: string) => Promise<unknown> }).__closeup(id, track),
        [job.id, job.track] as [string, string]
      )) as MountResult;
      if (pageErrors.length > 0) throw new Error(`${job.key}: page error -- ${pageErrors.join(' | ')}`);
      const focus = res.info.focus;
      if (!focus) throw new Error(`${job.key}: no focus info`);
      const best = Math.max(...focus.pixelsByYaw);
      if (best <= 0) throw new Error(`${job.key}: the subject showed 0 pixels at every yaw -- refusing an empty close-up`);
      if (focus.subject === 'whole') wholes.push(job.key);
      const file = `${job.key}.jpg`;
      const out = path.join(OUT_DIR, file);
      await page.locator('#host').screenshot({ path: out, type: 'jpeg', quality: JPEG_QUALITY, scale: 'css' });
      const [w, h] = jpegSize(fs.readFileSync(out));
      if (w !== CLOSEUP_W || h !== CLOSEUP_H) throw new Error(`${file}: ${w}x${h}, expected ${CLOSEUP_W}x${CLOSEUP_H}`);
      fovDeg = res.info.camera.fovDeg;
      closeups[job.key] = {
        file,
        unit: job.id,
        track: job.track,
        subject: focus.subject,
        yawDeg: focus.yawDeg,
        elevationDeg: res.info.camera.elevationDeg,
        distance: res.info.camera.distance,
      };
      const lead = focus.figure ? `, lead ${focus.figure}` : '';
      console.log(
        `[${TAG}] ${job.key}: ${focus.subject} (${focus.triangles} tris${lead}), yaw ${focus.yawDeg}, ` +
          `${best} subject px, elevation ${res.info.camera.elevationDeg}, distance ${res.info.camera.distance}` +
          (res.warnings.length > 0 ? `\n  warned: ${res.warnings.join(' | ')}` : '')
      );
    }
    await page.evaluate(() => (window as unknown as { __closeupDispose: () => void }).__closeupDispose());

    if (!only) {
      // A full run owns the directory: a JPEG the plan no longer names goes.
      const keep = new Set(plan.map((j) => `${j.key}.jpg`));
      for (const f of fs.readdirSync(OUT_DIR)) {
        if (f.endsWith('.jpg') && !keep.has(f)) {
          fs.rmSync(path.join(OUT_DIR, f));
          console.log(`[${TAG}] removed stale ${f}`);
        }
      }
    }
    const ordered: Record<string, CloseupEntry> = {};
    for (const key of Object.keys(closeups).sort()) ordered[key] = closeups[key];
    const manifest: CloseupManifest = {
      version: 1,
      camera: { fovDeg, size: [CLOSEUP_W, CLOSEUP_H], dpr: DPR, gpu },
      closeups: ordered,
    };
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    if (wholes.length > 0) console.warn(`[${TAG}] framed the WHOLE model (no region matched): ${wholes.join(', ')}`);
    console.log(`[${TAG}] wrote ${jobs.length} close-up(s) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    const onDisk = Object.values(ordered).filter((e) => fs.existsSync(path.join(OUT_DIR, e.file))).length;
    assertCloseupCount(onDisk, plan);
    console.log(`[${TAG}] ${onDisk} close-ups on disk and in the manifest, as data/units/kdf/ declares`);
  } finally {
    if (browser) await browser.close();
    stopDevServer(devServer, TAG);
  }
}

try {
  await run();
} catch (err) {
  console.error(`[${TAG}] FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}
