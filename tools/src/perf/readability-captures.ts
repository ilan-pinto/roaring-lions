/**
 * GH-346: the battlefield-readability instrument. Measures how far units
 * stand out from the ground they stand on, and photographs every prototype
 * lever (`packages/render/src/three/units/readability-levers.ts`) before and
 * after, on a mixed fight, at the default tactical zoom (1) and at 0.5.
 *
 * Run against a dev server you started yourself (it never starts or stops
 * one), music off:
 *   cd tools && npx tsx src/perf/readability-captures.ts --port=5271 --out=<dir>
 *     [--maps=beit_sahwan_outskirts,tel_marum,wadi_halam_basin] [--variants=base,teamband,...]
 *
 * ## What is measured, and how
 *
 * Per scenario and zoom, the frame loop is frozen, the sim is stepped to an
 * ABSOLUTE tick, and three frames are photographed at zero elapsed time:
 *  - `full`: what the player sees (overlays on);
 *  - `A`: overlays hidden, unit shadow-casting and the GTAO pass off -- bodies on the ground;
 *  - `B`: the same with the `units` debug layer hidden too -- the ground alone.
 * A pixel is a UNIT pixel where A and B differ (sum |dRGB| > 12), assigned to
 * the nearest unit's vertical body segment within a class radius. Shadow
 * casting is off for A and B so a unit's shadow on the sand is not counted as
 * its body (the shadow is real, and part of the read -- this measures the
 * body alone, which is what "olive on olive" is about).
 *
 * Per unit: pixel count and box (its on-screen SIZE); mean CIELAB of the body
 * (A) against the mean of the ground in a ring around it (B, unit pixels
 * excluded); dL*, dE76, chroma and hue; and EDGE contrast -- the mean dE76
 * across every boundary pixel of the body and its non-unit neighbour, which is
 * what an outline or a rim changes. Background class is read off the map rows
 * at the unit's tile: `house` (a building within one tile), `scrub` (cover,
 * grove, knoll), `road`, else `open`.
 */
import { chromium, type Page } from 'playwright';
import { PNG } from 'pngjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const arg = (k: string, d: string): string => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const PORT = Number(arg('port', '5271'));
if (PORT === 5177) throw new Error('5177 is the lead’s dev server; use another port');
const OUT = resolve(arg('out', '.superpowers/readability'));
const MAPS = arg('maps', 'beit_sahwan_outskirts,tel_marum,wadi_halam_basin').split(',');
const VARIANTS: Record<string, string> = {
  base: '',
  teamband: '&teamband',
  bigrings: '&bigrings',
  contacts: '&contacts',
  rimlift: '&rimlift',
  rimbroad: '&rimlift=2.2',
  footscale: '&footscale',
  teamband15: '&teamband=1.5',
  combo: '&teamband&bigrings&contacts&rimlift&footscale',
  recommended: '&bigrings&contacts&footscale',
};
const WANT = arg('variants', Object.keys(VARIANTS).join(',')).split(',');
const ZOOMS = [1, 0.5];
const TARGET_TICK = Number(arg('tick', '400'));
const ORDER_TICK = 60;
const ROOT = resolve(import.meta.dirname, '../../..');
const BUILDINGS = new Set('#=acfhkmsw'.split(''));
/** Team colours from the palette, as CIELAB, by side: a unit pixel within
 *  `TEAM_DE` of its OWN side's colour counts as team-coloured. 25 is the
 *  separation `tools/src/cvd.test.ts` holds the team colours to. */
const TEAM_HEX: string[] = (() => {
  const t = JSON.parse(readFileSync(`${resolve(import.meta.dirname, '../../..')}/data/palette.json`, 'utf8')).reserved.team.colors;
  return [t.kedem, t.hostile, t.neutral];
})();
const TEAM_DE = 25;
const SCRUB = new Set('123on'.split(''));

/** The slice of `window.__lions` this harness reads, typed so nothing here is
 *  `any`. Several fields are `ThreeRenderer` internals (TypeScript-private,
 *  readable at runtime): a measurement instrument reaching them is the same
 *  call `render-frame-cost.ts` makes for `renderer.info`. */
interface PageV3 {
  x: number;
  y: number;
  z: number;
  clone(): PageV3;
  project(camera: unknown): PageV3;
}
interface PageObj {
  isMesh?: boolean;
  castShadow: boolean;
  userData: { rlCast?: boolean };
}
interface PageEntity {
  root: { visible: boolean; position: PageV3; traverse(cb: (o: PageObj) => void): void };
}
interface PageUnit {
  id: number;
  type: string;
  x: number;
  y: number;
}
interface PageLions {
  sim: {
    tickCount: number;
    queueCommand(cmd: object): void;
    state: { alive: ArrayLike<number>; side: ArrayLike<number>; typeIdx: ArrayLike<number> };
    unitTypes: { id: string; isAir: boolean }[];
  };
  renderer: {
    camera: { zoom: number };
    canvas: HTMLCanvasElement;
    renderer: { info: { autoReset: boolean; reset(): void; render: { calls: number; triangles: number } } };
    frame(alpha: number, dtMs: number): void;
    threeCamera(): unknown;
    meshUnitEntities: Map<number, PageEntity>;
    vehicleMeshEntities: Map<number, PageEntity>;
    setDebugLayerVisible(name: string, visible: boolean): number;
    aoPass: { enabled: boolean } | null;
    silhouetteMeshMaterials: { visible: boolean }[];
  };
  step(n: number): number;
  units(side?: number): PageUnit[];
  goto(x: number, y: number): unknown;
  hover(x: number, y: number): unknown;
}

mkdirSync(OUT, { recursive: true });

interface UnitShot {
  id: number;
  side: number;
  type: string;
  cls: 'foot' | 'vehicle' | 'air';
  tx: number;
  ty: number;
  /** Feet and head in screen px. */
  fx: number;
  fy: number;
  hy: number;
}

function backgroundOf(rows: string[], tx: number, ty: number): string {
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const c = rows[ty + dy]?.[tx + dx];
      if (c !== undefined && BUILDINGS.has(c)) return 'house';
    }
  const c = rows[ty]?.[tx] ?? '.';
  if (SCRUB.has(c)) return 'scrub';
  if (c === 'r') return 'road';
  return 'open';
}

// ---- colour ----
function srgbToLin(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
function lab(r: number, g: number, b: number): [number, number, number] {
  const R = srgbToLin(r), G = srgbToLin(g), B = srgbToLin(b);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
const dE = (a: number[], b: number[]): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const chroma = (l: number[]): number => Math.hypot(l[1], l[2]);
const hue = (l: number[]): number => ((Math.atan2(l[2], l[1]) * 180) / Math.PI + 360) % 360;

function mean(png: PNG, idx: number[]): [number, number, number] {
  let r = 0, g = 0, b = 0;
  for (const p of idx) {
    r += png.data[p * 4];
    g += png.data[p * 4 + 1];
    b += png.data[p * 4 + 2];
  }
  const n = Math.max(1, idx.length);
  return lab(r / n, g / n, b / n);
}

function measure(A: PNG, B: PNG, units: UnitShot[], zoom: number, rows: string[]): Record<string, unknown>[] {
  const W = A.width, H = A.height;
  const owner = new Int32Array(W * H).fill(-1);
  const isUnit = new Uint8Array(W * H);
  const reach = { foot: 14, vehicle: 46, air: 30 };
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      const d =
        Math.abs(A.data[p * 4] - B.data[p * 4]) +
        Math.abs(A.data[p * 4 + 1] - B.data[p * 4 + 1]) +
        Math.abs(A.data[p * 4 + 2] - B.data[p * 4 + 2]);
      if (d <= 12) continue;
      isUnit[p] = 1;
      let best = -1, bestD = Infinity;
      for (let k = 0; k < units.length; k++) {
        const u = units[k];
        const sy = Math.max(u.hy, Math.min(u.fy, y));
        const dd = Math.hypot(x - u.fx, y - sy);
        if (dd < bestD && dd <= reach[u.cls] * zoom + 3) {
          bestD = dd;
          best = k;
        }
      }
      owner[p] = best;
    }
  const out: Record<string, unknown>[] = [];
  units.forEach((u, k) => {
    const body: number[] = [];
    let x0 = W, x1 = -1, y0 = H, y1 = -1;
    for (let p = 0; p < W * H; p++)
      if (owner[p] === k) {
        body.push(p);
        const x = p % W, y = (p / W) | 0;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
    if (body.length < 6) return;
    const pad = Math.max(4, Math.round(6 * zoom));
    const ring: number[] = [];
    for (let y = Math.max(0, y0 - pad); y <= Math.min(H - 1, y1 + pad); y++)
      for (let x = Math.max(0, x0 - pad); x <= Math.min(W - 1, x1 + pad); x++) {
        const p = y * W + x;
        if (!isUnit[p]) ring.push(p);
      }
    // Edge: every body pixel with a non-unit 4-neighbour, against that neighbour (both in A).
    let edgeSum = 0, edgeN = 0;
    for (const p of body) {
      const x = p % W;
      for (const q of [p - 1, p + 1, p - W, p + W]) {
        if (q < 0 || q >= W * H || isUnit[q]) continue;
        if ((q === p - 1 && x === 0) || (q === p + 1 && x === W - 1)) continue;
        edgeSum += dE(lab(A.data[p * 4], A.data[p * 4 + 1], A.data[p * 4 + 2]), lab(A.data[q * 4], A.data[q * 4 + 1], A.data[q * 4 + 2]));
        edgeN++;
        break;
      }
    }
    const team = (() => {
      const h = TEAM_HEX[u.side] ?? TEAM_HEX[2];
      return lab(parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16));
    })();
    let teamPx = 0;
    for (const p of body) if (dE(lab(A.data[p * 4], A.data[p * 4 + 1], A.data[p * 4 + 2]), team) < TEAM_DE) teamPx++;
    const bl = mean(A, body);
    const gl = mean(B, ring);
    out.push({
      id: u.id,
      side: u.side,
      type: u.type,
      cls: u.cls,
      bg: backgroundOf(rows, u.tx, u.ty),
      px: body.length,
      w: x1 - x0 + 1,
      h: y1 - y0 + 1,
      bodyL: +bl[0].toFixed(1),
      groundL: +gl[0].toFixed(1),
      dL: +(bl[0] - gl[0]).toFixed(1),
      dE: +dE(bl, gl).toFixed(1),
      bodyC: +chroma(bl).toFixed(1),
      groundC: +chroma(gl).toFixed(1),
      bodyHue: +hue(bl).toFixed(0),
      groundHue: +hue(gl).toFixed(0),
      edgeDE: +(edgeSum / Math.max(1, edgeN)).toFixed(1),
      teamShare: +(teamPx / body.length).toFixed(3),
      bodyLab: bl.map((v) => +v.toFixed(1)),
    });
  });
  return out;
}

async function boot(page: Page, map: string, flags: string): Promise<void> {
  await page.goto(`http://127.0.0.1:${PORT}/?sandbox=${map}&sur&civ${flags}`);
  await page.waitForFunction(() => (window as unknown as { __lions?: { sim?: unknown } }).__lions?.sim, null, {
    timeout: 180000,
  });
  await page.waitForTimeout(2500);
}

/** Freeze, order the KDF ground force at the Sarim centroid, step to the tick,
 *  frame the fight. Returns the camera tile it chose. */
async function stage(page: Page): Promise<{ tick: number; cam: [number, number]; frozenAt: number }> {
  return page.evaluate(
    async ({ orderTick, target }) => {
      const L = (window as unknown as { __lions: PageLions }).__lions;
      const raf = window.requestAnimationFrame.bind(window);
      const frozenAt = L.sim.tickCount;
      window.requestAnimationFrame = () => 0;
      await new Promise((r) => raf(() => raf(() => r(null))));
      L.step(Math.max(0, orderTick - L.sim.tickCount));
      const kdf = L.units(0).filter((u: PageUnit) => !/drone|heli|paramotor/.test(u.type));
      const sar = L.units(1);
      const cx = sar.reduce((s: number, u: PageUnit) => s + u.x, 0) / sar.length;
      const cy = sar.reduce((s: number, u: PageUnit) => s + u.y, 0) / sar.length;
      L.sim.queueCommand({
        kind: 'attackMove',
        ids: kdf.map((u: PageUnit) => u.id),
        x: Math.round(cx * 65536),
        y: Math.round(cy * 65536),
      });
      L.step(Math.max(0, target - L.sim.tickCount));
      const k = L.units(0).filter((u: PageUnit) => !/drone|heli|paramotor/.test(u.type));
      const kx = k.reduce((s: number, u: PageUnit) => s + u.x, 0) / Math.max(1, k.length);
      const ky = k.reduce((s: number, u: PageUnit) => s + u.y, 0) / Math.max(1, k.length);
      let near: { x: number; y: number } = { x: cx, y: cy }, nd = Infinity;
      for (const u of L.units(1)) {
        const d = Math.hypot(u.x - kx, u.y - ky);
        if (d < nd) { nd = d; near = u; }
      }
      const cam: [number, number] = [(kx + near.x) / 2 + 0.5, (ky + near.y) / 2 + 0.5];
      L.goto(cam[0], cam[1]);
      L.hover(-1000, -1000);
      return { tick: L.sim.tickCount, cam, frozenAt };
    },
    { orderTick: ORDER_TICK, target: TARGET_TICK }
  );
}

async function hideChrome(page: Page): Promise<void> {
  await page.evaluate(() => {
    const canvas: HTMLElement = (window as unknown as { __lions: PageLions }).__lions.renderer.canvas;
    for (const el of Array.from(document.body.children) as HTMLElement[]) if (!el.contains(canvas)) el.style.visibility = 'hidden';
  });
}

async function shot(page: Page, path?: string): Promise<PNG> {
  const buf = await page.screenshot(path ? { path } : {});
  return PNG.sync.read(buf);
}

/** Zoom, repaint at zero elapsed time, and the visible units' screen points. */
async function setZoom(page: Page, zoom: number): Promise<{ units: UnitShot[]; calls: number; triangles: number }> {
  return page.evaluate((zoom) => {
    const L = (window as unknown as { __lions: PageLions }).__lions;
    const r = L.renderer;
    r.camera.zoom = zoom;
    // Draw calls and triangles over ONE zero-time frame, summed across the
    // post chain's several render() calls (render-frame-cost.ts's method).
    const info = r.renderer.info;
    const autoReset = info.autoReset;
    info.autoReset = false;
    info.reset();
    r.frame(1, 0);
    const calls = info.render.calls;
    const triangles = info.render.triangles;
    info.autoReset = autoReset;
    const cam = r.threeCamera();
    const rect = r.canvas.getBoundingClientRect();
    const out: UnitShot[] = [];
    const st = L.sim.state;
    for (const [map, isVeh] of [[r.meshUnitEntities, false], [r.vehicleMeshEntities, true]] as const) {
      for (const [id, e] of map) {
        if (!e.root.visible || st.alive[id] !== 1) continue;
        const t = L.sim.unitTypes[st.typeIdx[id]];
        const cls = t.isAir ? 'air' : isVeh ? 'vehicle' : 'foot';
        const feet = e.root.position.clone();
        const head = feet.clone();
        head.y += cls === 'foot' ? 0.9 : 1.2;
        feet.project(cam);
        head.project(cam);
        const sx = ((feet.x + 1) / 2) * rect.width;
        const sy = ((1 - feet.y) / 2) * rect.height;
        const hy = ((1 - head.y) / 2) * rect.height;
        if (sx < 0 || sy < 0 || sx > rect.width || sy > rect.height) continue;
        out.push({ id, side: st.side[id], type: t.id, cls, tx: Math.floor(e.root.position.x), ty: Math.floor(e.root.position.z), fx: sx, fy: sy, hy });
      }
    }
    return { units: out, calls, triangles };
  }, zoom);
}

async function bodyFrames(page: Page): Promise<{ A: PNG; B: PNG }> {
  const toggle = (on: boolean): Promise<void> =>
    page.evaluate((on) => {
      const r = (window as unknown as { __lions: PageLions }).__lions.renderer;
      for (const map of [r.meshUnitEntities, r.vehicleMeshEntities])
        for (const e of map.values())
          e.root.traverse((o: PageObj) => {
            if (o.isMesh) {
              if (o.userData.rlCast === undefined) o.userData.rlCast = o.castShadow;
              o.castShadow = on ? o.userData.rlCast : false;
            }
          });
      r.setDebugLayerVisible('overlays', on);
      // `overlays` also hides the three mesh-silhouette materials (band 6),
      // which is the team band itself -- keep them, so A is what the player
      // sees of a unit. B hides them with their units (children of the root).
      for (const m of r.silhouetteMeshMaterials) m.visible = true;
      // Ambient occlusion darkens the ground AROUND a unit, so hiding the unit
      // moves a soft halo of ground pixels too -- measured as a 2-3x
      // overcount of a hull's footprint before this. Off for A and B alike.
      if (r.aoPass) r.aoPass.enabled = on;
      r.frame(1, 0);
    }, on);
  await toggle(false);
  const A = await shot(page);
  await page.evaluate(() => {
    const r = (window as unknown as { __lions: PageLions }).__lions.renderer;
    r.setDebugLayerVisible('units', false);
    r.frame(1, 0);
  });
  const B = await shot(page);
  await page.evaluate(() => {
    const r = (window as unknown as { __lions: PageLions }).__lions.renderer;
    r.setDebugLayerVisible('units', true);
    r.frame(1, 0);
  });
  await toggle(true);
  return { A, B };
}

const browser = await chromium.launch({
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--use-gl=angle', '--enable-gpu-rasterization', '--disable-gpu-sandbox'],
});
const gpu = await (async () => {
  const p = await browser.newPage();
  const s = await p.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext ? String(gl!.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  });
  await p.close();
  return s;
})();
console.log(`[readability] gpu: ${gpu}`);
/**
 * `--cost`: frame cost instead of photographs, by `render-frame-cost.ts`'s
 * own method (CPU = `frame(1, 16)` submission; GPU = the same bracketed by
 * `gl.finish()`), at DPR 2, on the STAGED fight rather than that harness's
 * idle boot -- the levers only do work where units and hostiles are in view.
 * Variants are interleaved across `--rounds` rounds so machine drift lands
 * on all of them alike.
 */
if (args.includes('--cost')) {
  const rounds = Number(arg('rounds', '3'));
  const out: Record<string, { cpu: number[]; gpu: number[]; calls: number }> = {};
  for (let round = 0; round < rounds; round++) {
    for (const map of MAPS) {
      for (const v of WANT) {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
        await page.addInitScript(() => {
          localStorage.setItem('lions.settings', JSON.stringify({ version: 1, audio: { master: 1, music: 0, sfx: 0, voice: 0, radio: false } }));
        });
        await boot(page, map, VARIANTS[v]);
        await stage(page);
        for (const z of ZOOMS) {
          const r = await page.evaluate((z) => {
            const L = (window as unknown as { __lions: PageLions }).__lions;
            const R = L.renderer;
            R.camera.zoom = z;
            for (let i = 0; i < 30; i++) R.frame(1, 16);
            const info = R.renderer.info;
            const autoReset = info.autoReset;
            info.autoReset = false;
            info.reset();
            R.frame(1, 16);
            const calls = info.render.calls;
            info.autoReset = autoReset;
            const gl = R.canvas.getContext('webgl2');
            if (!gl) throw new Error('renderer canvas has no webgl2 context');
            const cpu: number[] = [];
            for (let i = 0; i < 240; i++) {
              const t0 = performance.now();
              R.frame(1, 16);
              cpu.push(performance.now() - t0);
            }
            gl.finish();
            const gpu: number[] = [];
            for (let i = 0; i < 120; i++) {
              const t0 = performance.now();
              R.frame(1, 16);
              gl.finish();
              gpu.push(performance.now() - t0);
            }
            // Inline, not a named helper: tsx would wrap one in `__name`, which
            // does not exist in the page.
            cpu.sort((x, y) => x - y);
            gpu.sort((x, y) => x - y);
            return {
              cpu50: cpu[Math.floor(0.5 * (cpu.length - 1))],
              gpu50: gpu[Math.floor(0.5 * (gpu.length - 1))],
              gpu95: gpu[Math.floor(0.95 * (gpu.length - 1))],
              calls,
            };
          }, z);
          const key = `${map}/${v}/z${z}`;
          out[key] ??= { cpu: [], gpu: [], calls: r.calls };
          out[key].cpu.push(r.cpu50);
          out[key].gpu.push(r.gpu95);
          console.log(`[readability:cost] round ${round} ${key}: cpu p50 ${r.cpu50.toFixed(2)} ms, gpu p50 ${r.gpu50.toFixed(2)} p95 ${r.gpu95.toFixed(2)} ms, ${r.calls} calls`);
        }
        await page.close();
      }
    }
  }
  writeFileSync(`${OUT}/cost.json`, JSON.stringify({ gpu, dpr: 2, viewport: '1440x900', rounds, out }, null, 1));
  await browser.close();
  process.exit(0);
}
const report: Record<string, unknown> = { gpu, viewport: '1440x900 @ DPR 1', tick: TARGET_TICK, scenarios: {} };

for (const map of MAPS) {
  const rows: string[] = JSON.parse(readFileSync(`${ROOT}/data/maps/${map}.json`, 'utf8')).rows;
  for (const v of WANT) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await page.addInitScript(() => {
      localStorage.setItem('lions.settings', JSON.stringify({ version: 1, audio: { master: 1, music: 0, sfx: 0, voice: 0, radio: false } }));
    });
    page.on('pageerror', (e) => console.log(`[readability] pageerror ${e.message}`));
    await boot(page, map, VARIANTS[v]);
    const staged = await stage(page);
    if (staged.frozenAt > ORDER_TICK) console.warn(`[readability] ${map}/${v}: froze at tick ${staged.frozenAt}, past the order tick`);
    await hideChrome(page);
    for (const z of ZOOMS) {
      const { units, calls, triangles } = await setZoom(page, z);
      await shot(page, `${OUT}/${map}-${v}-z${z}.png`);
      const { A, B } = await bodyFrames(page);
      if (args.includes('--debug')) {
        writeFileSync(`${OUT}/${map}-${v}-z${z}-A.png`, PNG.sync.write(A));
        writeFileSync(`${OUT}/${map}-${v}-z${z}-B.png`, PNG.sync.write(B));
      }
      const rowsOut = measure(A, B, units, z, rows);
      (report.scenarios as Record<string, unknown>)[`${map}/${v}/z${z}`] = { ...staged, calls, triangles, units: rowsOut };
      console.log(`[readability] ${map} ${v} z${z}: tick ${staged.tick}, cam ${staged.cam.map((c) => c.toFixed(1))}, ${rowsOut.length} units measured, ${calls} draw calls`);
    }
    await page.close();
  }
}
writeFileSync(`${OUT}/measurements.json`, JSON.stringify(report, null, 1));
await browser.close();
console.log(`[readability] wrote ${OUT}/measurements.json`);
