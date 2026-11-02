/**
 * Look uplift L1 (GH-943): the MOCK instrument -- not a gate.
 *
 *   pnpm exec tsx tools/src/perf/look-l1-captures.ts --out=<dir> [--port=5231]
 *       [--only=recon,stills,census,probe,layer] [--maps=beit_sahwan_outskirts,...]
 *
 * One Metal Chromium, music off, its own dev server on its own port (never
 * 5177), ONE page at a time. `&envlight=0` (the pre-L1 frame) vs the default on the same sandbox,
 * the same sim tick, the same camera, the frame loop frozen and the frame
 * repainted at zero elapsed time, so two photographs differ by the flag alone.
 *
 * - **recon**   prints what the sandbox force is made of, and where, so the
 *               stills' subjects (a vehicle group, infantry, a street of buildings)
 *               are chosen from facts.
 * - **stills**  the lead's sheet: {vehicles, infantry, buildings} x {dawn, day,
 *               dusk} x zoom {1, 2.5} x {off, on}.
 * - **census**  mean frame luminance (display and linear), off vs on, per
 *               preset x view, and the hemisphere sweep that SOLVES the on
 *               arm's hemisphere to the off arm's brightness
 *               (`ENV_HEMISPHERE_INTENSITY`). Also the bloom headroom: the
 *               brightest PRE-bloom pixel of the on arm
 *               (`debugPreBloomLuminance`, the buffer the bloom thresholds at 1.0).
 * - **probe**   gate 2's rendered-pixel read: per class a probe patch must
 *               change when the `environment` layer is hidden, the ground patch
 *               must not, and the falsifier (the ground given an envMap) must
 *               move it.
 * - **layer**   the `environment` layer's visible-toggle delta against the
 *               repaint control (its floor is a third of the smallest delta).
 *
 * Frame-time is NOT here: `pnpm perf:fx -- --breakdown --query='&envlight=0'` for the pre-L1 arm
 * (docs/PERFORMANCE.md), run once per preset.
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
import { ENV_HEMISPHERE_START } from '../../../packages/render/src/three/environment-classes';

const TAG = 'look-l1';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
const flag = (n: string): string | undefined => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const OUT = path.resolve(flag('out') ?? path.join(REPO_ROOT, '.superpowers/look-l1'));
const only = new Set((flag('only') ?? 'recon,stills,census,probe,layer').split(','));
const MAPS = (flag('maps') ?? 'beit_sahwan_outskirts').split(',');
const PRESETS = (flag('presets') ?? 'dawn,day,dusk').split(',') as Preset[];
const ZOOMS = (flag('zooms') ?? '1,2.5').split(',').map(Number);
const DPR = Number(flag('dpr') ?? 2);
/** Extra query for the ON arm, e.g. a hemisphere override for a solve confirmation. */
const ON_EXTRA = flag('on-extra') ?? '';
fs.mkdirSync(OUT, { recursive: true });

type Preset = 'dawn' | 'day' | 'dusk';
/** `start`: the ON arm with the hemisphere written back to the lead's approved starting value at runtime (the haze tint keeps the solved value's boot-time read). */
type Arm = 'off' | 'on' | 'start';

const log: string[] = [];
const say = (s: string): void => {
  console.log(s);
  log.push(s);
};
const load = (): string => os.loadavg().map((n) => n.toFixed(1)).join(' ');

interface L {
  renderer: {
    camera: { x: number; y: number; zoom: number };
    canvas: HTMLCanvasElement;
    frame(a: number, dt: number): void;
    setDebugLayerVisible(n: string, v: boolean): number;
    sceneLights: { hemisphere: { intensity: number }; sun: { intensity: number } };
    environment: { texture: unknown; carriers(): number; builds: number } | null;
    debugPreBloomLuminance?: (stride: number) => { p50: number; p99: number; max: number; samples: number } | null;
    worldToScreen(x: number, y: number): { x: number; y: number };
    scene: { traverse(f: (o: unknown) => void): void };
  };
  sim: {
    tickCount: number;
    width: number;
    height: number;
    entityCount: number;
    state: { alive: Uint8Array; side: Uint8Array; typeIdx: Uint16Array };
    unitTypes: { id: string; role: string }[];
    structureCount: number;
    structures: Record<string, ArrayLike<number>>;
    structureTypes: { id: string }[];
  };
  step(n: number): void;
  goto(m: string): void;
  units(side?: number): { id: number; type: string; x: number; y: number }[];
}
/** In-page global: a getter onto `window.__lions` (installed by the init script in `boot`), so the callbacks handed to
 *  `page.evaluate` can name it. A module-level helper would be a ReferenceError there: the callback is serialised. */
declare const LL: L;

const { port } = await claimPortOrAttach(TAG, 'LOOK_L1_PORT', 5231);
const stopServer = devServerStopper(await ensureDevServer(port, REPO_ROOT, TAG), TAG);
const base = `http://localhost:${port}`;
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--use-gl=angle', '--enable-gpu-rasterization', '--disable-gpu-sandbox'],
});
say(`look-l1 mock instrument; tree ${REPO_ROOT}; port ${port}; dpr ${DPR}; load average ${load()}`);

/** Boots one sandbox page: music off, frame loop frozen, stepped to `tick`, HUD hidden. */
async function boot(map: string, tod: Preset, arm: Arm, tick = 200, extra = ''): Promise<{ page: Page; gpu: string }> {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: DPR });
  await page.addInitScript(musicOffInitScript({}, { quality: 'high' }));
  await page.addInitScript("window.__name = (f) => f; Object.defineProperty(window, 'LL', { get() { return window.__lions; } });");
  const q = `?sandbox=${map}&tod=${tod}${arm === 'off' ? '&envlight=0' : ON_EXTRA}${extra}`;
  await page.goto(`${base}/${q}`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window as unknown as { __lions?: { renderer?: unknown } }).__lions?.renderer, null, {
    timeout: 180000,
  });
  await page.waitForTimeout(5000);
  await page.evaluate(async (tickTo) => {
    const w = window as unknown as { requestAnimationFrame: (f: FrameRequestCallback) => number };
    const raf = w.requestAnimationFrame.bind(window);
    w.requestAnimationFrame = () => 0;
    await new Promise((r) => raf(() => raf(() => r(null))));
    const l = LL;
    l.step(Math.max(0, tickTo - l.sim.tickCount));
  }, tick);
  await page.addStyleTag({ content: '.rl-feed{display:none !important}' });
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    for (const el of Array.from(document.body.children)) {
      if (canvas && el.contains(canvas)) continue;
      (el as HTMLElement).style.display = 'none';
    }
    LL.renderer.frame(1, 0);
  });
  const gpu = await page.evaluate(() => {
    const gl = LL.renderer.canvas.getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext && gl ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  });
  if (/SwiftShader/i.test(gpu)) throw new Error('software GPU: refusing (Metal only)');
  if (arm === 'start') {
    await page.evaluate((h) => {
      LL.renderer.sceneLights.hemisphere.intensity = h;
      LL.renderer.frame(1, 0);
    }, ENV_HEMISPHERE_START[tod]);
  }
  return { page, gpu };
}

async function view(page: Page, x: number, y: number, zoom: number): Promise<void> {
  await page.evaluate(
    ([cx, cy, cz]) => {
      const R = LL.renderer;
      R.camera.x = cx;
      R.camera.y = cy;
      R.camera.zoom = cz;
      R.frame(1, 0);
      R.frame(1, 0);
    },
    [x, y, zoom] as const
  );
}

async function shot(page: Page): Promise<PNG> {
  const rect = await page.evaluate(() => {
    const r = LL.renderer.canvas.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  return PNG.sync.read(await page.screenshot({ type: 'png', clip: rect }));
}
const save = (png: PNG, name: string): void => fs.writeFileSync(path.join(OUT, name), PNG.sync.write(png));

function srgbToLin(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
/** Mean display luma (Rec.709 weights on the sRGB-encoded bytes, 0..1) and mean linear luma. */
function meanLuma(p: PNG, region?: [number, number, number, number]): { display: number; linear: number } {
  const [x0, y0, x1, y1] = region ?? [0, 0, p.width, p.height];
  let d = 0;
  let l = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * p.width + x) * 4;
      const r = p.data[i];
      const g = p.data[i + 1];
      const b = p.data[i + 2];
      d += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      l += 0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b);
      n++;
    }
  }
  return { display: d / n, linear: l / n };
}
/** Pixels differing by more than `thr`/255 (mean of channels), and the mean absolute channel delta / 255. */
function diff(a: PNG, b: PNG, region?: [number, number, number, number], thr = 2): { px: number; mad: number; n: number } {
  const [x0, y0, x1, y1] = region ?? [0, 0, a.width, a.height];
  let px = 0;
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * a.width + x) * 4;
      let d = 0;
      for (let c = 0; c < 3; c++) d += Math.abs(a.data[i + c] - b.data[i + c]);
      sum += d / 3;
      n++;
      if (d / 3 > thr) px++;
    }
  }
  return { px, mad: sum / n / 255, n };
}

// --- subjects ---------------------------------------------------------------

interface Subject {
  id: string;
  label: string;
  cx: number;
  cy: number;
}

/** The sandbox force's groups. Types are named, not guessed from a role: `recon_drone`, `heli_peten` and
 *  `dozer_d9` are in the force and are not what the lead asked to see. */
const VEHICLE_TYPES = ['mbt_lavi', 'ifv_namer', 'apc_eitan', 'jeep_shoded'];
const INFANTRY_TYPES = ['inf_squad', 'at_team', 'mortar_team'];

/** Where the groups are, found in the page from the sim, never hard-coded. */
async function findSubjects(page: Page): Promise<Subject[]> {
  const found = await page.evaluate(
    ([vehTypes, infTypes]) => {
      const l = LL;
      const sim = l.sim;
      const veh: { x: number; y: number; type: string }[] = [];
      const inf: { x: number; y: number; type: string }[] = [];
      const st = sim.structures as unknown as { alive: Uint8Array; typeIdx: Uint16Array; cx: Int32Array; cy: Int32Array };
      for (const u of l.units(0)) {
        if (vehTypes.includes(u.type)) veh.push({ x: u.x, y: u.y, type: u.type });
        else if (infTypes.includes(u.type)) inf.push({ x: u.x, y: u.y, type: u.type });
      }
      const structs: { x: number; y: number; type: string }[] = [];
      for (let q = 0; q < sim.structureCount; q++) {
        if (st.alive[q] !== 1) continue;
        structs.push({ x: st.cx[q] / 65536, y: st.cy[q] / 65536, type: sim.structureTypes[st.typeIdx[q]].id });
      }
      return { veh, inf, structs, width: l.renderer.camera.x, height: l.renderer.camera.y };
    },
    [VEHICLE_TYPES, INFANTRY_TYPES] as const
  );
  say(`[subjects] vehicles ${JSON.stringify(summarise(found.veh))} at ${JSON.stringify(found.veh.map((u) => [u.x, u.y]))}`);
  say(`[subjects] infantry ${JSON.stringify(summarise(found.inf))} at ${JSON.stringify(found.inf.map((u) => [u.x, u.y]))}`);
  say(`[subjects] structures ${JSON.stringify(found.structs.map((q) => `${q.type}@${q.x.toFixed(1)},${q.y.toFixed(1)}`))}`);
  const mean = (a: { x: number; y: number }[]): [number, number] => [
    a.reduce((t, u) => t + u.x, 0) / Math.max(1, a.length),
    a.reduce((t, u) => t + u.y, 0) / Math.max(1, a.length),
  ];
  const out: Subject[] = [];
  if (found.veh.length > 0) {
    const [x, y] = mean(found.veh);
    out.push({ id: 'vehicles', label: 'vehicle group', cx: x, cy: y });
  }
  if (found.inf.length > 0) {
    const [x, y] = mean(found.inf);
    out.push({ id: 'infantry', label: 'infantry', cx: x, cy: y });
  }
  // The densest knot of structures: the one with the most neighbours within 9 tiles, centred on them.
  let best = 0;
  let bestAt: [number, number] | null = null;
  for (const q of found.structs) {
    const near = found.structs.filter((r) => Math.hypot(q.x - r.x, q.y - r.y) <= 9);
    if (near.length > best) {
      best = near.length;
      bestAt = mean(near);
    }
  }
  if (bestAt) out.push({ id: 'buildings', label: 'buildings', cx: bestAt[0], cy: bestAt[1] });
  say(`[subjects] ${JSON.stringify(out.map((q) => [q.id, +q.cx.toFixed(1), +q.cy.toFixed(1)]))} (building knot: ${best} structures within 9 tiles)`);
  return out;
}

function summarise(a: { type: string }[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const u of a) m[u.type] = (m[u.type] ?? 0) + 1;
  return m;
}

// --- modes ------------------------------------------------------------------

const t0 = Date.now();

/** One preset x arm page: every subject at every zoom, shot and saved. Returns the shots by key. */
async function stillsFor(map: string, tod: Preset, arm: Arm): Promise<Map<string, PNG>> {
  const { page, gpu } = await boot(map, tod, arm);
  say(`[stills ${map} ${tod} ${arm}] gpu ${gpu}, tick ${await page.evaluate(() => LL.sim.tickCount)}`);
  const shots = new Map<string, PNG>();
  const subjects = await findSubjects(page);
  for (const sub of subjects) {
    for (const z of ZOOMS) {
      await view(page, sub.cx, sub.cy, z);
      const png = await shot(page);
      const key = `${map}_${tod}_${sub.id}_z${z}`;
      save(png, `${key}_${arm}.png`);
      shots.set(key, png);
    }
  }
  await page.close();
  return shots;
}

/** Mean-luma views for the census. `whole` has fog revealed (ground-dominated, the strict one). */
interface CensusView {
  id: string;
  cx: number;
  cy: number;
  zoom: number;
  reveal: boolean;
}

async function censusViews(page: Page): Promise<CensusView[]> {
  const c = await page.evaluate(() => {
    const us = LL.units(0);
    const fx = us.reduce((t, u) => t + u.x, 0) / Math.max(1, us.length);
    const fy = us.reduce((t, u) => t + u.y, 0) / Math.max(1, us.length);
    return { fx, fy, w: LL.sim.width, h: LL.sim.height };
  });
  return [
    { id: 'whole', cx: c.w / 2, cy: c.h / 2, zoom: 0.5, reveal: true },
    { id: 'force', cx: c.fx, cy: c.fy, zoom: 1.6, reveal: false },
  ];
}

interface CensusRow {
  map: string;
  tod: Preset;
  view: string;
  off: number;
  offLinear: number;
  on: number;
  onLinear: number;
  sweep: { h: number; display: number }[];
  preBloomOff: number;
  preBloomOn: number;
}

async function readView(page: Page, v: CensusView): Promise<{ display: number; linear: number; maxPre: number }> {
  await page.evaluate((reveal) => {
    LL.renderer.setDebugLayerVisible('fog', !reveal);
  }, v.reveal);
  await view(page, v.cx, v.cy, v.zoom);
  const png = await shot(page);
  const m = meanLuma(png);
  const pre = await page.evaluate(() => LL.renderer.debugPreBloomLuminance?.(5) ?? null);
  return { display: m.display, linear: m.linear, maxPre: pre ? pre.max : NaN };
}

const rows: CensusRow[] = [];

try {
  if (only.has('recon')) {
    const { page, gpu } = await boot(MAPS[0], 'day', 'off');
    say(`[recon] gpu ${gpu}`);
    await findSubjects(page);
    await page.close();
  }

  if (only.has('stills')) {
    for (const map of MAPS) {
      for (const tod of PRESETS) {
        const off = await stillsFor(map, tod, 'off');
        const on = await stillsFor(map, tod, 'on');
        const start = await stillsFor(map, tod, 'start');
        for (const [key, a] of off) {
          for (const [name, arm] of [['on (census-solved hemisphere)', on], ['start (approved 0.5/0.6/0.47)', start]] as const) {
            const b = arm.get(key);
            if (!b) continue;
            const d = diff(a, b);
            const la = meanLuma(a);
            const lb = meanLuma(b);
            say(
              `[stills] ${key} ${name}: ${d.px} px differ (>2/255) of ${d.n}, mean |delta| ${d.mad.toFixed(4)}; mean display luma off ${la.display.toFixed(4)} -> ${lb.display.toFixed(4)} (${(((lb.display - la.display) / la.display) * 100).toFixed(2)}%)`
            );
          }
        }
      }
    }
  }

  if (only.has('census')) {
    // Hemisphere candidates for the sweep, as multiples of the value the ON arm boots with.
    const SWEEP = (flag('sweep') ?? '0.9,1,1.1').split(',').map(Number);
    for (const map of MAPS) {
      for (const tod of PRESETS) {
        const offPage = await boot(map, tod, 'off');
        const views = await censusViews(offPage.page);
        const offRead = new Map<string, { display: number; linear: number; maxPre: number }>();
        for (const v of views) offRead.set(v.id, await readView(offPage.page, v));
        await offPage.page.close();
        const onPage = await boot(map, tod, 'on');
        const h0 = await onPage.page.evaluate(() => LL.renderer.sceneLights.hemisphere.intensity);
        for (const v of views) {
          const o = offRead.get(v.id);
          if (!o) continue;
          const sweep: { h: number; display: number }[] = [];
          for (const k of SWEEP) {
            await onPage.page.evaluate((h) => {
              LL.renderer.sceneLights.hemisphere.intensity = h;
            }, h0 * k);
            const r = await readView(onPage.page, v);
            sweep.push({ h: h0 * k, display: r.display });
          }
          await onPage.page.evaluate((h) => {
            LL.renderer.sceneLights.hemisphere.intensity = h;
          }, h0);
          const at = await readView(onPage.page, v);
          rows.push({
            map, tod, view: v.id, off: o.display, offLinear: o.linear, on: at.display, onLinear: at.linear, sweep,
            preBloomOff: o.maxPre, preBloomOn: at.maxPre,
          });
          say(
            `[census ${map} ${tod} ${v.id}] hemisphere ${h0.toFixed(3)}: off ${o.display.toFixed(4)} on ${at.display.toFixed(4)} (${(((at.display - o.display) / o.display) * 100).toFixed(2)}%); linear off ${o.linear.toFixed(4)} on ${at.linear.toFixed(4)}; pre-bloom max off ${o.maxPre.toFixed(3)} on ${at.maxPre.toFixed(3)}; sweep ${sweep.map((q) => `${q.h.toFixed(2)}:${(((q.display - o.display) / o.display) * 100).toFixed(2)}%`).join(' ')}`
          );
        }
        await onPage.page.close();
      }
    }
    // Solve: per preset, the hemisphere at which the mean error over this preset's views crosses zero (linear interpolation on the sweep).
    for (const tod of PRESETS) {
      const mine = rows.filter((r) => r.tod === tod);
      if (mine.length === 0) continue;
      const n = mine[0].sweep.length;
      const meanErr = (i: number): { h: number; e: number } => ({
        h: mine.reduce((t, r) => t + r.sweep[i].h, 0) / mine.length,
        e: mine.reduce((t, r) => t + (r.sweep[i].display - r.off) / r.off, 0) / mine.length,
      });
      let solved = NaN;
      for (let i = 0; i + 1 < n; i++) {
        const a = meanErr(i);
        const b = meanErr(i + 1);
        if ((a.e <= 0 && b.e >= 0) || (a.e >= 0 && b.e <= 0)) {
          solved = a.h + ((0 - a.e) / (b.e - a.e)) * (b.h - a.h);
          break;
        }
      }
      say(`[census SOLVE ${tod}] mean-over-views zero crossing of (on - off)/off at hemisphere ${Number.isNaN(solved) ? 'OUT OF SWEEP RANGE' : solved.toFixed(3)} (sweep ${mine[0].sweep.map((q) => q.h.toFixed(2)).join(', ')})`);
    }
    fs.writeFileSync(path.join(OUT, 'census.json'), JSON.stringify(rows, null, 2));
  }

  if (only.has('probe') || only.has('layer')) {
    const map = MAPS[0];
    const { page, gpu } = await boot(map, 'day', 'on');
    say(`[probe] gpu ${gpu}`);
    const subs = await findSubjects(page);
    // Class census from the registry, plus a scene walk for any material carrying an envMap the registry does not know.
    const census = await page.evaluate(() => {
      const R = LL.renderer as unknown as { environment: { texture: unknown; classCensus(): Record<string, { registered: number; carrying: number }> } };
      const byClass = R.environment.classCensus();
      let rogue = 0;
      const rogueTypes: string[] = [];
      const seen = new Set<unknown>();
      LL.renderer.scene.traverse((o) => {
        const mat = (o as { material?: unknown }).material;
        for (const m of Array.isArray(mat) ? mat : mat ? [mat] : []) {
          const q = m as { isMeshStandardMaterial?: boolean; envMap?: unknown; type?: string };
          if (seen.has(q)) continue;
          seen.add(q);
          if (q.envMap && q.envMap !== R.environment.texture) {
            rogue++;
            rogueTypes.push(String(q.type));
          }
        }
      });
      return { byClass, rogue, rogueTypes };
    });
    say(`[probe] registry census (registered / carrying the envMap) by class: ${JSON.stringify(census.byClass)}; materials in the scene with a foreign envMap: ${census.rogue}`);
    for (const k of Object.keys(census.byClass)) {
      if (['ground', 'decal', 'smoke', 'fx', 'backdrop'].includes(k) && census.byClass[k].carrying > 0) say(`[probe] FAIL: class ${k} carries an envMap`);
    }
    if (!census.byClass.unitMetal?.carrying) say('[probe] FAIL: no unitMetal material carries an envMap');

    const patches = async (sub: Subject, zoom: number): Promise<{ id: string; box: [number, number, number, number] }[]> => {
      // Screen boxes (device pixels) around: a vehicle, a structure and the emptiest ground near the subject.
      const found = await page.evaluate(
        ([cx, cy, vehTypes]) => {
          const R = LL.renderer;
          const us = LL.units(0);
          const sim = LL.sim;
          const st = sim.structures as unknown as { alive: Uint8Array; cx: Int32Array; cy: Int32Array };
          const sts: [number, number][] = [];
          for (let q = 0; q < sim.structureCount; q++) if (st.alive[q] === 1) sts.push([st.cx[q] / 65536, st.cy[q] / 65536]);
          const veh = us.filter((u) => vehTypes.includes(u.type)).sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy))[0];
          const bld = sts.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy))[0];
          const bestG: [number, number] = [cx, cy];
          const bestD = 0;
          const W = R.canvas.clientWidth;
          const H = R.canvas.clientHeight;
          // null when the point is off the canvas: a clamped box there reads 0 px change and means nothing.
          const sp = (x: number, y: number): [number, number] | null => {
            const p = R.worldToScreen(x, y);
            return p.x > 30 && p.y > 30 && p.x < W - 30 && p.y < H - 30 ? [p.x, p.y] : null;
          };
          return {
            veh: veh ? sp(veh.x + 0.5, veh.y + 0.5) : null,
            bld: bld ? sp(bld[0], bld[1]) : null,
            gnd: [bestG[0], bestG[1]],
            groundClear: bestD,
          };
        },
        [sub.cx, sub.cy, VEHICLE_TYPES] as const
      );
      void zoom;
      const half = 18 * DPR;
      const box = (p: [number, number]): [number, number, number, number] => [
        Math.max(0, Math.round(p[0] * DPR - half)),
        Math.max(0, Math.round(p[1] * DPR - half)),
        Math.round(p[0] * DPR + half),
        Math.round(p[1] * DPR + half),
      ];
      const out: { id: string; box: [number, number, number, number] }[] = [];
      if (found.veh) out.push({ id: 'vehicle (unit metal + dielectric)', box: box(found.veh) });
      if (found.bld) out.push({ id: 'building', box: box(found.bld) });
      void found.gnd;
      void found.groundClear;
      return out;
    };

    const layerDeltas: number[] = [];
    for (const [sid, zoom] of [['vehicles', 1], ['buildings', 1], ['vehicles', 2.5], ['infantry', 2.5]] as const) {
      const sub = subs.find((q) => q.id === sid);
      if (!sub) continue;
      await view(page, sub.cx, sub.cy, zoom);
      const shown = await shot(page);
      const control = await shot(page);
      await page.evaluate(() => {
        LL.renderer.setDebugLayerVisible('environment', false);
        LL.renderer.frame(1, 0);
      });
      const hidden = await shot(page);
      await page.evaluate(() => {
        LL.renderer.setDebugLayerVisible('environment', true);
        LL.renderer.frame(1, 0);
      });
      const ctl = diff(shown, control);
      const whole = diff(shown, hidden);
      layerDeltas.push(whole.px);
      say(`[layer ${sid} z${zoom}] repaint control: ${ctl.px} px; environment hidden vs shown: ${whole.px} px differ (>2/255), mean |delta| ${whole.mad.toFixed(5)}`);
      if (only.has('probe')) {
        for (const p of await patches(sub, zoom)) {
          const d = diff(shown, hidden, p.box);
          say(`[probe ${sid} z${zoom}] ${p.id}: ${d.px} of ${d.n} px change, mean |delta| ${d.mad.toFixed(5)}`);
        }
        // GROUND-ONLY FRAME: hide every layer that may carry an environment (units, buildings, decor, props).
        // What is left -- the ground, scatter, decals, skirt, smoke, FX -- must not change AT ALL when the
        // environment is hidden. The falsifier gives the ground an envMap, and the frame must then change.
        const only_ = async (): Promise<PNG> => {
          await page.evaluate(() => LL.renderer.frame(1, 0));
          return shot(page);
        };
        await page.evaluate(() => {
          for (const l of ['units', 'buildings', 'decor', 'props']) LL.renderer.setDebugLayerVisible(l, false);
          LL.renderer.frame(1, 0);
        });
        const gShown = await only_();
        await page.evaluate(() => {
          LL.renderer.setDebugLayerVisible('environment', false);
          LL.renderer.frame(1, 0);
        });
        const gHidden = await only_();
        await page.evaluate(() => {
          LL.renderer.setDebugLayerVisible('environment', true);
          LL.renderer.frame(1, 0);
        });
        say(`[probe GROUND-ONLY ${sid} z${zoom}] receivers hidden (precondition: ${diff(shown, gShown).px} px differ from the full frame); environment hidden vs shown on what is left: ${diff(gShown, gHidden).px} px differ (must be 0)`);
        await page.evaluate(() => {
          const R = LL.renderer as unknown as { groundMat: { envMap: unknown; envMapIntensity: number; needsUpdate: boolean }; environment: { texture: unknown } };
          R.groundMat.envMap = R.environment.texture;
          R.groundMat.envMapIntensity = 0.3;
          R.groundMat.needsUpdate = true;
          LL.renderer.frame(1, 0);
          LL.renderer.frame(1, 0);
        });
        const gFalsified = await only_();
        say(`[probe FALSIFIER ${sid} z${zoom}] the ground given an envMap: ${diff(gShown, gFalsified).px} px differ from the ground-only frame (must be > 0 for the probe to be able to fail)`);
        await page.evaluate(() => {
          const R = LL.renderer as unknown as { groundMat: { envMap: unknown; needsUpdate: boolean } };
          R.groundMat.envMap = null;
          R.groundMat.needsUpdate = true;
          for (const l of ['units', 'buildings', 'decor', 'props']) LL.renderer.setDebugLayerVisible(l, true);
          LL.renderer.frame(1, 0);
          LL.renderer.frame(1, 0);
        });
        const restored = await shot(page);
        say(`[probe ${sid} z${zoom}] receivers shown and the ground's envMap removed: back to the shown frame: ${diff(shown, restored).px} px differ`);
      }
    }
    if (layerDeltas.length > 0) {
      const floor = Math.floor(Math.min(...layerDeltas) / 3);
      say(`[layer] environment visible-toggle deltas ${JSON.stringify(layerDeltas)} px; floor (a third of the smallest) ${floor} px`);
    }
    await page.close();
  }
} finally {
  fs.writeFileSync(path.join(OUT, 'look-l1-captures.log'), log.join('\n') + '\n');
  await browser.close();
  stopServer();
  say(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
