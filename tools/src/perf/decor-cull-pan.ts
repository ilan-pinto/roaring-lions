/**
 * How long the decor and prop batches spend culling and sorting while the camera pans
 * (GH-913 L7). `pnpm perf:cullpan -- --maps=rujm_sawda,wadi_tarfan --presets=high,medium`.
 *
 * `THREE.BatchedMesh.onBeforeRender` frustum-culls and depth-sorts EVERY instance of a batch
 * whenever the view changes (`terrain/batch-cull.ts` memoises it per view, so a still camera pays
 * nothing and a panning one pays on every frame). The cull walks every instance on the map, not
 * the ones on screen, so it is the cost that scales with map AREA where the draw does not. This
 * times it on the real frame loop:
 *
 *   - every `isBatchedMesh` object in the scene has its `onBeforeRender` (the memoised wrapper
 *     `memoizeBatchCulling` installed) wrapped in a `performance.now()` pair, and the sum is
 *     reset and read around each `renderer.frame` call the app's own rAF loop makes;
 *   - the camera is panned by the arrow keys through the real input path (`stepPan`), right, down,
 *     left, up, `--leg-ms` each, at zoom 1, 1.6 and 2.5;
 *   - a frame is PANNING when the camera moved since the last one, and IDLE when it did not.
 *
 * It is CPU time inside the callback and nothing on the GPU, which is exactly what a cull is.
 *
 * Falsification built in. The idle frames are the control: a memoised cull on a still camera does
 * no work, so IDLE must read well under PANNING. A wrapper that never ran (or wrapped nothing)
 * reads zero on both and the tool exits 2 instead of printing a flattering zero. It also refuses
 * to run on SwiftShader, on a map that has no batch, and when no frame was a panning one.
 *
 * Boots `?sandbox=<map>` on hardware Metal with music off. Own port: `--port=<n>`,
 * `DECOR_CULL_PAN_PORT`, else 5212 (never 5177).
 */
import os from 'node:os';
import path from 'node:path';
import { chromium, type Page } from 'playwright';
import { devServerStopper, ensureDevServer } from '../golden-diff/browser';
import { musicOffInitScript } from '../ui-review/music-off';
import { claimPort } from '../ui-review/port';

const args = process.argv.slice(2);
const arg = (n: string, d: string): string => (args.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).slice(n.length + 3);
const root = path.resolve(arg('root', process.cwd()));
const port = await claimPort('decor-cull-pan', 'DECOR_CULL_PAN_PORT', 5212);
const MAPS = arg('maps', 'rujm_sawda,wadi_tarfan').split(',').map((m) => m.trim()).filter(Boolean);
const PRESETS = arg('presets', 'high,medium')
  .split(',')
  .map((q) => q.trim())
  .filter((q): q is 'high' | 'medium' | 'low' => q === 'high' || q === 'medium' || q === 'low');
const ZOOMS = arg('zooms', '1,1.6,2.5').split(',').map(Number);
const LEG_MS = Number(arg('leg-ms', '1500'));
const DPR = Number(arg('dpr', '2'));
const ROUNDS = Number(arg('rounds', '2'));
if (MAPS.length === 0 || PRESETS.length === 0 || ZOOMS.some((z) => !(z > 0)) || !(LEG_MS > 0) || !(DPR > 0) || !(ROUNDS >= 1)) {
  throw new Error('decor-cull-pan: bad --maps/--presets/--zooms/--leg-ms/--dpr/--rounds');
}

interface FrameRow {
  cull: number;
  frame: number;
  moved: boolean;
}
interface Install {
  batches: { name: string; instances: number }[];
  gpu: string;
}

const stop = devServerStopper(await ensureDevServer(port, root, 'decor-cull-pan'), 'decor-cull-pan');
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--use-gl=angle', '--enable-gpu-rasterization', '--disable-gpu-sandbox'],
});

function median(v: number[]): number {
  if (v.length === 0) return NaN;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] as number;
}
function quantile(v: number[], q: number): number {
  if (v.length === 0) return NaN;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * q))] as number;
}
const f2 = (x: number): string => (Number.isFinite(x) ? x.toFixed(2) : 'n/a');

async function boot(quality: string, mapId: string): Promise<{ page: Page; install: Install }> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: DPR });
  await page.addInitScript(musicOffInitScript({}, { quality: quality as 'high' | 'medium' | 'low' }));
  await page.addInitScript('window.__name = (f) => f;');
  await page.goto(`http://localhost:${port}/?sandbox=${mapId}`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window as unknown as { __lions?: { renderer?: unknown } }).__lions?.renderer, null, { timeout: 120000 });
  await page.waitForTimeout(4000);
  const install = await page.evaluate((): Install => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const r = w.__lions.renderer;
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    const gpu = ext && gl ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
    const acc = { sum: 0 };
    const batches: { name: string; instances: number }[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    r.scene.traverse((o: any) => {
      if (!o.isBatchedMesh) return;
      const orig = o.onBeforeRender;
      o.onBeforeRender = function (...a: unknown[]) {
        const t0 = performance.now();
        const out = orig.apply(this, a);
        acc.sum += performance.now() - t0;
        return out;
      };
      batches.push({ name: String(o.name || o.parent?.name || 'batch'), instances: Number(o.instanceCount ?? o._instanceInfo?.length ?? 0) });
    });
    w.__cullRows = [] as FrameRow[];
    let lastX = r.camera.x;
    let lastY = r.camera.y;
    let lastZoom = r.camera.zoom;
    const origFrame = r.frame;
    r.frame = function (...a: unknown[]) {
      acc.sum = 0;
      const t0 = performance.now();
      const out = origFrame.apply(this, a);
      const frame = performance.now() - t0;
      const moved = r.camera.x !== lastX || r.camera.y !== lastY || r.camera.zoom !== lastZoom;
      lastX = r.camera.x;
      lastY = r.camera.y;
      lastZoom = r.camera.zoom;
      w.__cullRows.push({ cull: acc.sum, frame, moved });
      return out;
    };
    return { batches, gpu };
  });
  return { page, install };
}

async function panAt(page: Page, zoom: number): Promise<{ rows: FrameRow[]; travelled: number }> {
  await page.evaluate((z) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    w.__lions.renderer.camera.zoom = z;
    w.__cullRows.length = 0;
  }, zoom);
  await page.waitForTimeout(600); // a still camera first: the idle control
  const at = (): Promise<[number, number]> =>
    page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = (window as any).__lions.renderer.camera;
      return [c.x, c.y] as [number, number];
    });
  let prev = await at();
  let travelled = 0;
  for (const key of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) {
    await page.keyboard.down(key);
    await page.waitForTimeout(LEG_MS);
    await page.keyboard.up(key);
    const now = await at();
    travelled += Math.hypot(now[0] - prev[0], now[1] - prev[1]);
    prev = now;
  }
  await page.waitForTimeout(400);
  const rows = (await page.evaluate(() => (window as unknown as { __cullRows: FrameRow[] }).__cullRows.slice())) as FrameRow[];
  return { rows, travelled };
}

let exit = 0;
try {
  for (const quality of PRESETS) {
    // Every map is booted before any is timed, and the timing loop is round -> zoom -> map, so the
    // machine's load drift lands on every map alike (the same reason `fx-cost.ts` interleaves).
    const booted = new Map<string, { page: Page; install: Install }>();
    for (const mapId of MAPS) {
      const b = await boot(quality, mapId);
      if (/swiftshader|llvmpipe|software/i.test(b.install.gpu) || b.install.gpu === 'unknown') {
        console.error(`decor-cull-pan: refusing to time on "${b.install.gpu}" (need hardware Metal)`);
        exit = 2;
      } else if (b.install.batches.length === 0) {
        console.error(`decor-cull-pan: ${mapId} has no BatchedMesh in the scene: nothing to time`);
        exit = 2;
      } else booted.set(mapId, b);
      if (exit === 2 && !booted.has(mapId)) await b.page.close();
    }
    if (exit === 2) {
      for (const b of booted.values()) await b.page.close();
      continue;
    }
    const loadBefore = os.loadavg();
    const acc = new Map<string, { panning: number[]; idle: number[]; frames: number[]; travelled: number }>();
    for (let round = 0; round < ROUNDS; round++) {
      for (const zoom of ZOOMS) {
        for (const mapId of MAPS) {
          const b = booted.get(mapId) as NonNullable<ReturnType<typeof booted.get>>;
          await b.page.bringToFront();
          const r = await panAt(b.page, zoom);
          const a = acc.get(`${mapId}|${zoom}`) ?? { panning: [], idle: [], frames: [], travelled: 0 };
          a.travelled += r.travelled;
          for (const row of r.rows) {
            if (row.moved) {
              a.panning.push(row.cull);
              a.frames.push(row.frame);
            } else a.idle.push(row.cull);
          }
          acc.set(`${mapId}|${zoom}`, a);
        }
      }
    }
    for (const mapId of MAPS) {
      const b = booted.get(mapId) as NonNullable<ReturnType<typeof booted.get>>;
      console.log(
        `decor-cull-pan map=${mapId} quality=${quality} dpr=${DPR} gpu=${b.install.gpu} ` +
          `batches=${b.install.batches.length} (${b.install.batches.map((x) => `${x.name}:${x.instances}`).join(' ')}) rounds=${ROUNDS}`
      );
      for (const zoom of ZOOMS) {
        const a = acc.get(`${mapId}|${zoom}`) as NonNullable<ReturnType<typeof acc.get>>;
        if (a.panning.length < 20) {
          console.error(`decor-cull-pan: ${mapId} z${zoom}: only ${a.panning.length} panning frame(s): the pan did not move the camera`);
          exit = 2;
          continue;
        }
        if (!(quantile(a.panning, 0.95) > 0)) {
          console.error(`decor-cull-pan: ${mapId} z${zoom}: every panning frame read 0 ms of cull: the wrapper did not run`);
          exit = 2;
        }
        console.log(
          `  z${String(zoom).padEnd(4)} panning cull med ${f2(median(a.panning))} ms  p95 ${f2(quantile(a.panning, 0.95))}  max ${f2(Math.max(...a.panning))}   ` +
            `idle cull med ${f2(median(a.idle))} ms  p95 ${f2(quantile(a.idle, 0.95))}   frame CPU while panning med ${f2(median(a.frames))} ms   ` +
            `(${a.panning.length} panning / ${a.idle.length} idle frames, ${a.travelled.toFixed(0)} tiles travelled)`
        );
      }
    }
    console.log(`  loadavg ${loadBefore.map((v) => v.toFixed(1)).join('/')} before, ${os.loadavg().map((v) => v.toFixed(1)).join('/')} after`);
    for (const b of booted.values()) await b.page.close();
  }
} finally {
  await browser.close();
  stop();
}
process.exit(exit);
