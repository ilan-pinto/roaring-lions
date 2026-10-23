/**
 * Defilade Tasks 2 and 5 (GH-705): the A/B instrument -- not a gate.
 *
 *   npx tsx tools/src/perf/defilade-25-captures.ts --out=<dir> [--port=5191] [--only=stills,shimmer,cost]
 *
 * Boots its own dev server on its own port, one Metal Chromium, music off,
 * and on six frames (quiet / relief / crater field x zoom 1 / 2.5) takes:
 *
 * - **stills**: A/B photographs. Shadows: `setShadowFit('map')` against
 *   `'view'`. Crater rims: the `crater-rims` debug layer off against on.
 *   Each frame is frozen (the app's rAF loop killed, the sim stepped to an
 *   absolute tick), and the B arm is the same frame repainted at zero elapsed
 *   time, so the two photographs differ by the switch alone.
 * - **shimmer**: the camera panned in whole CSS pixels (2 device pixels at
 *   DPR 2), each frame compared with the one before it shifted back by the
 *   pan. A world-fixed image reads 0 there; what does not is crawl. Arms:
 *   the map box, the view box snapped to texels, the view box NOT snapped
 *   (the falsification: it must crawl), and shadows off (the floor).
 *   Vignette and haze are hidden for it: both are screen- or focus-anchored
 *   and move with the camera by design.
 * - **cost**: `frame(1, 16)` bracketed by `gl.finish()`, the two arms
 *   interleaved in 8 blocks of 40 frames on one page so machine load hits
 *   both alike, plus draw calls over one frame (summed by hand, `info`
 *   auto-reset off -- `render-frame-cost.ts`'s method).
 */
import { chromium, type Page } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { devServerStopper, ensureDevServer } from '../golden-diff/browser';
import { musicOffInitScript } from '../ui-review/music-off';
import { claimPortOrAttach } from '../ui-review/port';

const TAG = 'defilade-25';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
const flag = (n: string): string | undefined => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const OUT = path.resolve(flag('out') ?? path.join(REPO_ROOT, '.superpowers/defilade-25'));
const only = new Set((flag('only') ?? 'stills,shimmer,cost').split(','));
const subjectsWanted = flag('subjects')?.split(',');
fs.mkdirSync(OUT, { recursive: true });
const load = (): string => os.loadavg().map((n) => n.toFixed(1)).join(' ');

interface Subject {
  id: string;
  query: string;
  cam: [number, number];
  tick: number;
  orders?: string[];
  /** `'force'`: `cam` is the side-0 units' centroid plus `nudge`, read at boot. */
  at?: 'force';
  nudge?: [number, number];
  /** A named marker: `cam` is read back from `goto` at boot. */
  marker?: string;
  /** Extra craters stamped at boot, for the crater field. */
  craters?: boolean;
}
const SUBJECTS: Subject[] = [
  { id: 'quiet', query: '?sandbox=beit_sahwan_outskirts', cam: [0, 0], tick: 200, at: 'force' },
  { id: 'relief', query: '?sandbox=tel_marum', cam: [0, 0], tick: 200, at: 'force' },
  { id: 'relief-qarn', query: '?sandbox=qarn_hadid', cam: [0, 0], tick: 200, at: 'force' },
  { id: 'craters', query: '?sandbox=qarn_hadid&decals', cam: [34.5, 32], tick: 300 },
  { id: 'crater-town', query: '?sandbox=beit_sahwan_outskirts', cam: [0, 0], tick: 200, at: 'force', craters: true },
];
const ZOOMS = [1, 2.5];

type L = {
  renderer: {
    camera: { x: number; y: number; zoom: number };
    canvas: HTMLCanvasElement;
    frame(a: number, dt: number): void;
    setShadowFit(m: string, snap?: boolean): void;
    shadowFitInfo(): { halfX: number; halfY: number; texelX: number; texelY: number } | null;
    setDebugLayerVisible(n: string, v: boolean): number;
    stampGroundDecal(s: unknown): boolean;
    persistentStamp(k: string, x: number, z: number, r: number): unknown;
    sceneLights: { sun: { castShadow: boolean } };
    renderer: { info: { autoReset: boolean; reset(): void; render: { calls: number; triangles: number } } };
  };
  sim: { tickCount: number };
  step(n: number): void;
  goto(m: string): void;
};

const { port } = await claimPortOrAttach(TAG, 'DEFILADE25_PORT', 5191);
const stopServer = devServerStopper(await ensureDevServer(port, REPO_ROOT, TAG), TAG);
const base = `http://localhost:${port}`;
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--use-gl=angle', '--enable-gpu-rasterization', '--disable-gpu-sandbox'],
});
const log: string[] = [];
const say = (s: string): void => {
  console.log(s);
  log.push(s);
};
say(`load average at start: ${load()}`);

async function boot(s: Subject): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await page.addInitScript(musicOffInitScript());
  await page.goto(base + '/' + s.query, { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window as unknown as { __lions?: { renderer?: unknown } }).__lions?.renderer, null, {
    timeout: 120000,
  });
  await page.waitForTimeout(4000);
  // Kill the app's frame loop (the golden gate's FREEZE statements), then step
  // to an absolute tick, the orders landing at tick 20.
  await page.evaluate(
    async ([tick, orders]) => {
      const w = window as unknown as { __lions: L; requestAnimationFrame: (f: FrameRequestCallback) => number };
      const raf = w.requestAnimationFrame.bind(window);
      w.requestAnimationFrame = () => 0;
      await new Promise((r) => raf(() => raf(() => r(null))));
      const lions = w.__lions;
      const t0 = lions.sim.tickCount;
      if (orders.length > 0 && t0 < 20) {
        lions.step(20 - t0);
        for (const o of orders) new Function(o)();
      }
      lions.step(Math.max(0, (tick as number) - lions.sim.tickCount));
    },
    [s.tick, s.orders ?? []] as const
  );
  const gpu = await page.evaluate(() => {
    const gl = (window as unknown as { __lions: L }).__lions.renderer.canvas.getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext && gl ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  });
  say(`[${s.id}] tick ${await page.evaluate(() => (window as unknown as { __lions: L }).__lions.sim.tickCount)}, gpu ${gpu}`);
  if (/SwiftShader/i.test(gpu)) throw new Error('software GPU: refusing (Metal only)');
  await page.addStyleTag({ content: '.rl-feed{display:none !important}' });
  if (s.at === 'force') {
    s.cam = await page.evaluate((n) => {
      const lions = (window as unknown as { __lions: L & { units(side?: number): { x: number; y: number }[] } }).__lions;
      const us = lions.units(0);
      const x = us.reduce((a, u) => a + u.x, 0) / us.length + n[0];
      const y = us.reduce((a, u) => a + u.y, 0) / us.length + n[1];
      return [x, y] as [number, number];
    }, s.nudge ?? [0, 0]);
    say(`[${s.id}] force view at (${s.cam[0].toFixed(2)}, ${s.cam[1].toFixed(2)})`);
  }
  if (s.marker) {
    s.cam = await page.evaluate((m) => {
      const lions = (window as unknown as { __lions: L }).__lions;
      lions.goto(m);
      return [lions.renderer.camera.x, lions.renderer.camera.y] as [number, number];
    }, s.marker);
    say(`[${s.id}] ${s.marker} at (${s.cam[0].toFixed(2)}, ${s.cam[1].toFixed(2)})`);
  }
  if (s.craters) {
    // A 5x4 field across the street and into a building's shadow, three sizes:
    // the mortar (0.45), the Grad (0.6) and a big one (0.9).
    await page.evaluate(([cx, cy]) => {
      const R = (window as unknown as { __lions: L }).__lions.renderer;
      const sizes = [0.45, 0.6, 0.9];
      for (let i = 0; i < 20; i++) {
        const x = cx - 4 + (i % 5) * 2 + ((i * 7) % 3) * 0.3;
        const z = cy - 3 + Math.floor(i / 5) * 2 + ((i * 5) % 3) * 0.3;
        R.stampGroundDecal(R.persistentStamp('crater', x, z, sizes[i % 3]));
      }
    }, s.cam);
  }
  return page;
}

async function view(page: Page, x: number, y: number, zoom: number): Promise<void> {
  await page.evaluate(
    ([cx, cy, cz]) => {
      const R = (window as unknown as { __lions: L }).__lions.renderer;
      R.camera.x = cx;
      R.camera.y = cy;
      R.camera.zoom = cz;
      R.frame(1, 0);
      R.frame(1, 0);
    },
    [x, y, zoom] as const
  );
}

async function setArm(page: Page, arm: string): Promise<void> {
  await page.evaluate((arm) => {
    let a = arm;
    const R = (window as unknown as { __lions: L }).__lions.renderer;
    R.sceneLights.sun.castShadow = a !== 'noshadow';
    // The shadow map's own size: 2048 for the `*2048` arms, 4096 otherwise.
    const sun = R.sceneLights.sun as unknown as { shadow: { mapSize: { x: number; set(a: number, b: number): void }; map: { dispose(): void } | null } };
    const want = a.endsWith('2048') ? 2048 : 4096;
    if (sun.shadow.mapSize.x !== want) {
      sun.shadow.mapSize.set(want, want);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    if (a.endsWith('2048')) a = a.slice(0, -4);
    if (a === 'map' || a === 'noshadow') R.setShadowFit('map');
    else if (a === 'view') R.setShadowFit('view', true);
    else if (a === 'view-nosnap') R.setShadowFit('view', false);
    else if (a === 'rims-off') R.setDebugLayerVisible('crater-rims', false);
    else if (a === 'rims-on') R.setDebugLayerVisible('crater-rims', true);
    else throw new Error(`arm ${a}`);
    R.frame(1, 0);
    R.frame(1, 0);
  }, arm);
}

async function shot(page: Page): Promise<PNG> {
  return PNG.sync.read(await page.screenshot({ type: 'png' }));
}

function save(png: PNG, name: string): void {
  fs.writeFileSync(path.join(OUT, name), PNG.sync.write(png));
}

/** Pixels differing between two same-size frames, and mean |delta| / 255. */
function diff(a: PNG, b: PNG, dx = 0, region?: [number, number, number, number]): { px: number; mad: number } {
  const [x0, y0, x1, y1] = region ?? [0, 0, a.width, a.height];
  let px = 0;
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * a.width + x) * 4;
      const j = (y * b.width + (x + dx)) * 4;
      let d = 0;
      for (let c = 0; c < 3; c++) d += Math.abs(a.data[i + c] - b.data[j + c]);
      sum += d / 3;
      n++;
      if (d / 3 > 6) px++;
    }
  }
  return { px, mad: sum / n };
}

const pages = new Map<string, Page>();
async function pageFor(s: Subject): Promise<Page> {
  let p = pages.get(s.id);
  if (!p) {
    p = await boot(s);
    pages.set(s.id, p);
  }
  return p;
}

if (only.has('stills')) {
  for (const s of SUBJECTS.filter((x) => !subjectsWanted || subjectsWanted.includes(x.id))) {
    const page = await pageFor(s);
    for (const z of ZOOMS) {
      await view(page, s.cam[0], s.cam[1], z);
      const isCrater = s.id === 'crater-town' || s.id === 'craters';
      const shadowArms = isCrater ? [] : ['map', 'view', 'view2048'];
      const rimArms = isCrater ? ['rims-off', 'rims-on'] : [];
      const shots: Record<string, PNG> = {};
      for (const arm of [...shadowArms, ...rimArms]) {
        await setArm(page, arm);
        shots[arm] = await shot(page);
        save(shots[arm], `${s.id}_z${z}_${arm}.png`);
        if (arm === 'view') {
          const info = await page.evaluate(() => (window as unknown as { __lions: L }).__lions.renderer.shadowFitInfo());
          say(`[${s.id} z${z}] view box ${info ? `${(2 * info.halfX).toFixed(1)}x${(2 * info.halfY).toFixed(1)} wu, texel ${info.texelX.toFixed(5)}x${info.texelY.toFixed(5)} wu` : 'none'}`);
        }
      }
      if (shadowArms.length) {
        const d = diff(shots.map, shots.view);
        say(`[${s.id} z${z}] map vs view: ${d.px} px differ (>6/255), mean |delta| ${d.mad.toFixed(4)}`);
        await setArm(page, 'map');
      }
      if (rimArms.length) {
        const d = diff(shots['rims-off'], shots['rims-on']);
        say(`[${s.id} z${z}] rims off vs on: ${d.px} px differ (>6/255), mean |delta| ${d.mad.toFixed(4)}`);
        // The rim gain ladder the lead chooses from (D-R1), at the close zoom.
        if (z === 2.5) {
          for (const g of [0.5, 1.5]) {
            await page.evaluate((gain) => (window as unknown as { __lions: L & { renderer: { setCraterRim(g: number): void } } }).__lions.renderer.setCraterRim(gain), g);
            await setArm(page, 'rims-on');
            save(await shot(page), `${s.id}_z${z}_rims-gain${g}.png`);
          }
          await page.evaluate(() => (window as unknown as { __lions: L & { renderer: { setCraterRim(g: number): void } } }).__lions.renderer.setCraterRim(1));
        }
        // Both: the tight shadow and the rims together, for the sheet.
        await setArm(page, 'view');
        save(await shot(page), `${s.id}_z${z}_rims-on-view.png`);
        await setArm(page, 'map');
      }
    }
  }
}

if (only.has('lighting')) {
  // S4 MOCK (the lead, 22 Oct: mock first, ship nothing): GH-705 Task 2's own
  // lighting numbers applied at runtime over today's, same frame. Exposure
  // 1.05, sun #FFF4E0 x 2.8, hemisphere #DDEEFF / #3D382E x 0.55, bias
  // -0.0004. Colours go through THREE.Color like createSceneLights' own.
  // The haze tint is resolved at boot from today's lights and is NOT redone.
  for (const s of SUBJECTS.filter((x) => ['quiet', 'relief', 'relief-qarn', 'crater-town'].includes(x.id))) {
    const page = await pageFor(s);
    for (const z of ZOOMS) {
      await view(page, s.cam[0], s.cam[1], z);
      const shots: Record<string, PNG> = {};
      for (const arm of ['today', 'brief']) {
        await page.evaluate((a) => {
          type C = { set(v: number): void; getHex(): number };
          const R = (window as unknown as { __lions: { renderer: {
            renderer: { toneMappingExposure: number };
            sceneLights: { sun: { color: C; intensity: number; shadow: { bias: number } }; hemisphere: { color: C; groundColor: C; intensity: number } };
            frame(a: number, dt: number): void;
          } } }).__lions.renderer;
          const w = window as unknown as { __today?: { e: number; sc: number; si: number; hs: number; hg: number; hi: number; b: number } };
          const L = R.sceneLights;
          if (!w.__today) w.__today = { e: R.renderer.toneMappingExposure, sc: L.sun.color.getHex(), si: L.sun.intensity, hs: L.hemisphere.color.getHex(), hg: L.hemisphere.groundColor.getHex(), hi: L.hemisphere.intensity, b: L.sun.shadow.bias };
          const t = w.__today;
          const v = a === 'brief' ? { e: 1.05, sc: 0xfff4e0, si: 2.8, hs: 0xddeeff, hg: 0x3d382e, hi: 0.55, b: -0.0004 } : t;
          R.renderer.toneMappingExposure = v.e;
          L.sun.color.set(v.sc);
          L.sun.intensity = v.si;
          L.hemisphere.color.set(v.hs);
          L.hemisphere.groundColor.set(v.hg);
          L.hemisphere.intensity = v.hi;
          L.sun.shadow.bias = v.b;
          R.frame(1, 0);
          R.frame(1, 0);
        }, arm);
        shots[arm] = await shot(page);
        save(shots[arm], `${s.id}_z${z}_light-${arm}.png`);
      }
      const d = diff(shots.today, shots.brief);
      // Mean luminance of each, over the whole frame.
      const lum = (p: PNG): number => {
        let t = 0;
        for (let i = 0; i < p.data.length; i += 4) t += 0.2126 * p.data[i] + 0.7152 * p.data[i + 1] + 0.0722 * p.data[i + 2];
        return t / (p.data.length / 4);
      };
      say(`[lighting ${s.id} z${z}] today vs brief: ${d.px} px differ, mean |delta| ${d.mad.toFixed(3)}; mean luma ${lum(shots.today).toFixed(1)} -> ${lum(shots.brief).toFixed(1)}`);
    }
  }
}

if (only.has('lighting2')) {
  // S4 MOCK 2 (the lead, 23 Oct): a harsher look on TODAY's palette colours --
  // only the two intensities move, and the haze tint is recomputed from them
  // through the renderer's own `applyHaze` (it reads `resolvedLights`).
  // Arms: today (sun 2.6 / fill 0.9), harsh (2.8 / 0.75), alt (2.6 / 0.65).
  const ARMS: Record<string, [number, number]> = { today: [2.6, 0.9], harsh: [2.8, 0.75], alt: [2.6, 0.65] };
  for (const s of SUBJECTS.filter((x) => ['quiet', 'relief', 'relief-qarn', 'crater-town'].includes(x.id))) {
    const page = await pageFor(s);
    for (const z of ZOOMS) {
      await view(page, s.cam[0], s.cam[1], z);
      const shots: Record<string, PNG> = {};
      for (const [arm, [sun, fill]] of Object.entries(ARMS)) {
        await page.evaluate(([si, hi]) => {
          const R = (window as unknown as { __lions: { renderer: {
            resolvedLights: { sunIntensity: number; hemiIntensity: number };
            sceneLights: { sun: { intensity: number }; hemisphere: { intensity: number } };
            applyHaze(): void;
            frame(a: number, dt: number): void;
          } } }).__lions.renderer;
          R.resolvedLights = { ...R.resolvedLights, sunIntensity: si, hemiIntensity: hi };
          R.sceneLights.sun.intensity = si;
          R.sceneLights.hemisphere.intensity = hi;
          R.applyHaze();
          R.frame(1, 0);
          R.frame(1, 0);
        }, [sun, fill] as const);
        shots[arm] = await shot(page);
        save(shots[arm], `${s.id}_z${z}_light-${arm}.png`);
      }
      const lum = (p: PNG): number => {
        let t = 0;
        for (let i = 0; i < p.data.length; i += 4) t += 0.2126 * p.data[i] + 0.7152 * p.data[i + 1] + 0.0722 * p.data[i + 2];
        return t / (p.data.length / 4);
      };
      // Luma of the brightest and darkest tenths of the TODAY frame's pixels,
      // read at the same pixels in every arm: the lit and shaded ends.
      const t = shots.today;
      const l = new Float32Array(t.width * t.height);
      for (let i = 0; i < l.length; i++) l[i] = 0.2126 * t.data[i * 4] + 0.7152 * t.data[i * 4 + 1] + 0.0722 * t.data[i * 4 + 2];
      const sorted = Float32Array.from(l).sort();
      const lo = sorted[Math.floor(l.length * 0.1)];
      const hi = sorted[Math.floor(l.length * 0.9)];
      const band = (p: PNG, pick: (v: number) => boolean): number => {
        let sum = 0;
        let n = 0;
        for (let i = 0; i < l.length; i++) {
          if (!pick(l[i])) continue;
          sum += 0.2126 * p.data[i * 4] + 0.7152 * p.data[i * 4 + 1] + 0.0722 * p.data[i * 4 + 2];
          n++;
        }
        return sum / n;
      };
      say(
        `[lighting2 ${s.id} z${z}] ` +
          Object.keys(ARMS)
            .map((a) => `${a}: mean ${lum(shots[a]).toFixed(1)}, lit tenth ${band(shots[a], (v) => v >= hi).toFixed(1)}, dark tenth ${band(shots[a], (v) => v <= lo).toFixed(1)}`)
            .join(' | ')
      );
    }
  }
}

if (only.has('shimmer')) {
  // Pan 1 CSS px along screen-right per step: camera (x, y) += (1, -1) / (64 zoom)
  // (project.ts: screen x = (wx - wy) * 32 * zoom, screen y = (wx + wy) * 16 * zoom).
  const STEPS = 12;
  for (const s of [SUBJECTS[0], SUBJECTS[1]]) {
    const page = await pageFor(s);
    await page.evaluate(() => {
      const R = (window as unknown as { __lions: L }).__lions.renderer;
      R.setDebugLayerVisible('vignette', false);
      R.setDebugLayerVisible('haze', false);
    });
    for (const z of ZOOMS) {
      // A central crop clear of the HUD and the screen edges.
      const region: [number, number, number, number] = [500, 300, 2380, 1500];
      for (const arm of ['map', 'view', 'view-nosnap']) {
        await setArm(page, arm);
        let prev: Float32Array | null = null;
        let px = 0;
        let mad = 0;
        let control = 0;
        for (let k = 0; k <= STEPS; k++) {
          await view(page, s.cam[0] + k / (64 * z), s.cam[1] - k / (64 * z), z);
          // The shadow's own contribution: the frame lit minus the same frame
          // with the sun's shadow intensity at 0 (a uniform: no recompile).
          // Everything that is not the shadow cancels.
          const lit = await shot(page);
          await page.evaluate(() => {
            const R = (window as unknown as { __lions: L & { renderer: { sceneLights: { sun: { shadow: { intensity: number } } } } } }).__lions.renderer;
            R.sceneLights.sun.shadow.intensity = 0;
            R.frame(1, 0);
          });
          const flat = await shot(page);
          await page.evaluate(() => {
            const R = (window as unknown as { __lions: L & { renderer: { sceneLights: { sun: { shadow: { intensity: number } } } } } }).__lions.renderer;
            R.sceneLights.sun.shadow.intensity = 1;
            R.frame(1, 0);
          });
          const mask = new Float32Array(lit.width * lit.height);
          for (let i = 0; i < mask.length; i++) {
            mask[i] = (flat.data[i * 4] + flat.data[i * 4 + 1] + flat.data[i * 4 + 2] - lit.data[i * 4] - lit.data[i * 4 + 1] - lit.data[i * 4 + 2]) / 3;
          }
          if (prev) {
            const [x0, y0, x1, y1] = region;
            let n = 0;
            let sum = 0;
            let c = 0;
            for (let y = y0; y < y1; y++) {
              for (let x = x0; x < x1; x++) {
                const d = Math.abs(mask[y * lit.width + x] - prev[y * lit.width + x + 2]);
                sum += d;
                n++;
                if (d > 6) c++;
              }
            }
            px += c;
            mad += sum / n;
          }
          if (k === 0) {
            // The control: the SAME camera photographed twice reads 0 here.
            const again = await shot(page);
            control = diff(lit, again, 0, region).px;
          }
          prev = mask;
        }
        say(`[shimmer ${s.id} z${z}] ${arm}: shadow-mask crawl ${(px / STEPS).toFixed(0)} px/step (>6/255), mean |delta| ${(mad / STEPS).toFixed(4)} (same-frame control ${control} px)`);
      }
      await setArm(page, 'map');
    }
    await page.evaluate(() => {
      const R = (window as unknown as { __lions: L }).__lions.renderer;
      R.setDebugLayerVisible('vignette', true);
      R.setDebugLayerVisible('haze', true);
    });
  }
}

if (only.has('cost')) {
  const cases: { s: Subject; z: number; arms: string[] }[] = [
    { s: SUBJECTS[0], z: 1, arms: ['map', 'view', 'view2048', 'map2048'] },
    { s: SUBJECTS[0], z: 2.5, arms: ['map', 'view', 'view2048', 'map2048'] },
    { s: SUBJECTS[1], z: 1, arms: ['map', 'view', 'view2048', 'map2048'] },
    { s: SUBJECTS[1], z: 2.5, arms: ['map', 'view', 'view2048', 'map2048'] },
    { s: SUBJECTS[4], z: 1, arms: ['rims-off', 'rims-on'] },
    { s: SUBJECTS[4], z: 2.5, arms: ['rims-off', 'rims-on'] },
  ];
  for (const c of cases) {
    const page = await pageFor(c.s);
    await view(page, c.s.cam[0], c.s.cam[1], c.z);
    const res: Record<string, { ms: number[]; gpu: number[]; calls: number; tris: number }> = {};
    for (const a of c.arms) res[a] = { ms: [], gpu: [], calls: 0, tris: 0 };
    for (let block = 0; block < 16; block++) {
      for (const a of block % 2 === 0 ? c.arms : [...c.arms].reverse()) {
        await setArm(page, a);
        const r = await page.evaluate(() => {
          const R = (window as unknown as { __lions: L }).__lions.renderer;
          const gl = R.canvas.getContext('webgl2');
          if (!gl) throw new Error('no context');
          const info = R.renderer.info;
          info.autoReset = false;
          info.reset();
          R.frame(1, 16);
          const calls = info.render.calls;
          const tris = info.render.triangles;
          info.autoReset = true;
          for (let i = 0; i < 10; i++) R.frame(1, 16);
          gl.finish();
          const ms: number[] = [];
          const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number } | null;
          const queries: WebGLQuery[] = [];
          for (let i = 0; i < 40; i++) {
            const t0 = performance.now();
            const q = ext ? gl.createQuery() : null;
            if (ext && q) gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
            R.frame(1, 16);
            if (ext && q) {
              gl.endQuery(ext.TIME_ELAPSED_EXT);
              queries.push(q);
            }
            gl.finish();
            ms.push(performance.now() - t0);
          }
          const gpuMs: number[] = [];
          for (const q of queries) {
            if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) gpuMs.push((gl.getQueryParameter(q, gl.QUERY_RESULT) as number) / 1e6);
            gl.deleteQuery(q);
          }
          return { ms, calls, tris, gpuMs };
        });
        res[a].ms.push(...r.ms);
        res[a].gpu.push(...r.gpuMs);
        res[a].calls = r.calls;
        res[a].tris = r.tris;
      }
    }
    const row = c.arms.map((a) => {
      const m = [...res[a].ms].sort((x, y) => x - y);
      const g = [...res[a].gpu].sort((x, y) => x - y);
      const gq = g.length ? `, gpu-timer median ${g[Math.floor(g.length / 2)].toFixed(2)} ms (n ${g.length})` : ', gpu-timer n/a';
      const q1 = m[Math.floor(m.length / 4)];
      const q3 = m[Math.floor((m.length * 3) / 4)];
      return `${a}: wall q1 ${q1.toFixed(2)} / median ${m[Math.floor(m.length / 2)].toFixed(2)} ms / q3 ${q3.toFixed(2)}, p95 ${m[Math.floor(m.length * 0.95)].toFixed(2)} ms${gq}, calls ${res[a].calls}, tris ${res[a].tris}`;
    });
    say(`[cost ${c.s.id} z${c.z}] ${row.join(' | ')}  (load ${load()})`);
    await setArm(page, c.arms[0]);
  }
}

say(`load average at end: ${load()}`);
fs.writeFileSync(path.join(OUT, `run-${Date.now()}.log`), log.join('\n') + '\n');
await browser.close();
stopServer();
