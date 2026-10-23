/**
 * Defilade Task 6 (GH-705): the A/B instrument for the unit surface pass and
 * the unit rim -- not a gate. PROTOTYPE.
 *
 *   npx tsx tools/src/perf/defilade-t6-captures.ts --out=<dir> [--port=5193] [--only=stills,cost]
 *
 * One dev server on its own port, one Metal Chromium, music off. Three frames
 * on `beit_sahwan_outskirts` at the sandbox force, each at zoom 1 and 2.5:
 *
 * - **quiet**: tick 200, nothing laid.
 * - **smoke**: every smoke-capable KDF unit in the force lays a screen on and
 *   around the force at tick 20; photographed at tick 90.
 * - **rubble**: every structure within 9 tiles of the force collapsed
 *   (`debugDestroyStructure`) at tick 20; photographed at tick 200, after the
 *   collapse shroud has cleared.
 *
 * Arms, all on the SAME frozen frame repainted at zero elapsed time:
 * `today` (all three switches off), `surface` (unit-surface + terrain-roughness),
 * `rim` (unit-rim alone), `both`. At zoom 2.5 a rim gain ladder too.
 *
 * Readability: a unit MASK (pixels moving > 6/255 when the `units` layer is
 * hidden, taken in the `today` arm) and, per arm, the mean |delta| between
 * the frame and the same frame with units hidden, over that mask -- how far
 * the unit stands off what is behind it. The rim must raise it in smoke.
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

const TAG = 'defilade-t6';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
const flag = (n: string): string | undefined => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const OUT = path.resolve(flag('out') ?? path.join(REPO_ROOT, '.superpowers/defilade-t6'));
const only = new Set((flag('only') ?? 'stills,cost').split(','));
const subjectsWanted = flag('subjects')?.split(',');
fs.mkdirSync(OUT, { recursive: true });
const load = (): string => os.loadavg().map((n) => n.toFixed(1)).join(' ');

interface Subject {
  id: string;
  query: string;
  tick: number;
  setup?: 'smoke' | 'rubble';
  cam: [number, number];
}
const SUBJECTS: Subject[] = [
  { id: 'quiet', query: '?sandbox=beit_sahwan_outskirts', tick: 200, cam: [0, 0] },
  { id: 'smoke', query: '?sandbox=beit_sahwan_outskirts', tick: 90, setup: 'smoke', cam: [0, 0] },
  { id: 'smoke-thin', query: '?sandbox=beit_sahwan_outskirts', tick: 230, setup: 'smoke', cam: [0, 0] },
  { id: 'rubble', query: '?sandbox=beit_sahwan_outskirts', tick: 200, setup: 'rubble', cam: [0, 0] },
];
const ZOOMS = [1, 2.5];
type Arm = { surface: boolean; rim: false | 'light' | 'dark' };
const ARMS: Record<string, Arm> = {
  today: { surface: false, rim: false },
  surface: { surface: true, rim: false },
  rim: { surface: false, rim: 'light' },
  'rim-dark': { surface: false, rim: 'dark' },
  both: { surface: true, rim: 'light' },
  'both-dark': { surface: true, rim: 'dark' },
};

type R = {
  camera: { x: number; y: number; zoom: number };
  canvas: HTMLCanvasElement;
  frame(a: number, dt: number): void;
  setDebugLayerVisible(n: string, v: boolean): number;
  setUnitRim(gain: number, width?: number, mode?: 'light' | 'dark', darkGain?: number): void;
  renderer: { info: { autoReset: boolean; reset(): void; programs: { cacheKey: string }[] | null; render: { calls: number; triangles: number } } };
};
type Lions = {
  renderer: R;
  sim: {
    tickCount: number;
    width: number;
    queueCommand(c: unknown): void;
    structureCount: number;
    stAlive: Uint8Array;
    stTiles: number[][];
    debugDestroyStructure(id: number): void;
  };
  step(n: number): void;
  units(side?: number): { id: number; type: string; x: number; y: number }[];
};

const SMOKE_TYPES = [
  'apc_eitan', 'apc_kipod', 'breach_team', 'demo_squad', 'ifv_namer', 'inf_medic_squad', 'mbt_lavi',
  'mbt_lavi_camo', 'mortar_team', 'scout_shachaf', 'veh_ambulance', 'yahalom_squad',
];

const { port } = await claimPortOrAttach(TAG, 'DEFILADE_T6_PORT', 5193);
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
  page.on('pageerror', (e) => say(`[${s.id}] pageerror ${e.message}`));
  await page.goto(base + '/' + s.query, { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window as unknown as { __lions?: { renderer?: unknown } }).__lions?.renderer, null, {
    timeout: 120000,
  });
  await page.waitForTimeout(4000);
  const info = await page.evaluate(
    async ([tick, setup, smokeTypes]) => {
      const w = window as unknown as { __lions: Lions; requestAnimationFrame: (f: FrameRequestCallback) => number };
      const raf = w.requestAnimationFrame.bind(window);
      w.requestAnimationFrame = () => 0;
      await new Promise((r) => raf(() => raf(() => r(null))));
      const lions = w.__lions;
      const us = lions.units(0);
      const cx = us.reduce((a, u) => a + u.x, 0) / us.length + 0.5;
      const cy = us.reduce((a, u) => a + u.y, 0) / us.length + 0.5;
      const t0 = lions.sim.tickCount;
      if (t0 < 20) lions.step(20 - t0);
      const notes: string[] = [];
      const FX = 65536;
      if (setup === 'smoke') {
        const layers = us.filter((u) => (smokeTypes as string[]).includes(u.type));
        const spots = [
          [0, 0], [2, -1], [-2, 1], [1, 2], [-1, -2], [3, 2],
        ];
        layers.forEach((u, k) => {
          const [dx, dy] = spots[k % spots.length];
          lions.sim.queueCommand({ kind: 'smoke', ids: [u.id], x: Math.round((cx + dx) * FX), y: Math.round((cy + dy) * FX) });
        });
        notes.push(`smoke ordered by ${layers.length} unit(s): ${layers.map((u) => u.type).join(',')}`);
      }
      if (setup === 'rubble') {
        // A battlefield floor under the force: rubble, craters and scorch
        // stamped through the renderer's one decal entry, in a 7x6 lattice
        // around the force, at tick 20 (dated on the sim clock like any stamp).
        const R = lions.renderer as unknown as {
          stampGroundDecal(s: unknown): boolean;
          persistentStamp(k: string, x: number, z: number, r: number): unknown;
        };
        const kinds: [string, number][] = [['rubble', 0.9], ['crater', 0.6], ['rubble', 0.7], ['scorch', 0.9], ['crater', 0.45], ['rubble', 1.1]];
        let n = 0;
        for (let i = 0; i < 42; i++) {
          const x = cx - 7 + (i % 7) * 2.2 + ((i * 7) % 3) * 0.35;
          const z = cy - 6 + Math.floor(i / 7) * 2.1 + ((i * 5) % 3) * 0.35;
          const [k, r] = kinds[i % kinds.length];
          if (R.stampGroundDecal(R.persistentStamp(k, x, z, r))) n++;
        }
        notes.push(`stamped ${n} rubble/crater/scorch decals around the force`);
      }
      lions.step(Math.max(0, (tick as number) - lions.sim.tickCount));
      return { cam: [cx, cy] as [number, number], notes, tick: lions.sim.tickCount };
    },
    [s.tick, s.setup ?? '', SMOKE_TYPES] as const
  );
  s.cam = info.cam;
  const gpu = await page.evaluate(() => {
    const gl = (window as unknown as { __lions: Lions }).__lions.renderer.canvas.getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext && gl ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  });
  say(`[${s.id}] tick ${info.tick}, force at (${s.cam[0].toFixed(2)}, ${s.cam[1].toFixed(2)}), gpu ${gpu}; ${info.notes.join('; ')}`);
  if (/SwiftShader/i.test(gpu)) throw new Error('software GPU: refusing (Metal only)');
  await page.addStyleTag({ content: '.rl-feed{display:none !important}' });
  return page;
}

async function view(page: Page, x: number, y: number, zoom: number): Promise<void> {
  await page.evaluate(
    ([cx, cy, cz]) => {
      const R = (window as unknown as { __lions: Lions }).__lions.renderer;
      R.camera.x = cx;
      R.camera.y = cy;
      R.camera.zoom = cz;
      R.frame(1, 0);
      R.frame(1, 0);
    },
    [x, y, zoom] as const
  );
}

async function setArm(page: Page, arm: string, units = true): Promise<void> {
  const v = ARMS[arm];
  if (!v) throw new Error(`arm ${arm}`);
  await page.evaluate(
    ([surface, rim, u]) => {
      const R = (window as unknown as { __lions: Lions }).__lions.renderer;
      R.setDebugLayerVisible('unit-surface', surface as boolean);
      R.setDebugLayerVisible('terrain-roughness', surface as boolean);
      R.setDebugLayerVisible('unit-rim', rim !== false);
      if (rim !== false) R.setUnitRim(0.35, 0.32, rim as 'light' | 'dark', 0.55);
      R.setDebugLayerVisible('units', u as boolean);
      R.frame(1, 0);
      R.frame(1, 0);
    },
    [v.surface, v.rim, units] as const
  );
}

async function shot(page: Page): Promise<PNG> {
  return PNG.sync.read(await page.screenshot({ type: 'png' }));
}
function save(png: PNG, name: string): void {
  fs.writeFileSync(path.join(OUT, name), PNG.sync.write(png));
}
function diff(a: PNG, b: PNG): { px: number; mad: number } {
  let px = 0;
  let sum = 0;
  const n = a.width * a.height;
  for (let i = 0; i < n; i++) {
    let d = 0;
    for (let c = 0; c < 3; c++) d += Math.abs(a.data[i * 4 + c] - b.data[i * 4 + c]);
    sum += d / 3;
    if (d / 3 > 6) px++;
  }
  return { px, mad: sum / n };
}
/** Mask of pixels a unit contributes to (> 6/255 against the units-hidden frame). */
function unitMask(withUnits: PNG, without: PNG): Uint8Array {
  const n = withUnits.width * withUnits.height;
  const m = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let d = 0;
    for (let c = 0; c < 3; c++) d += Math.abs(withUnits.data[i * 4 + c] - without.data[i * 4 + c]);
    if (d / 3 > 6) m[i] = 1;
  }
  return m;
}
/** Mean |delta| between two frames over a mask. */
function maskedMad(a: PNG, b: PNG, m: Uint8Array): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < m.length; i++) {
    if (!m[i]) continue;
    let d = 0;
    for (let c = 0; c < 3; c++) d += Math.abs(a.data[i * 4 + c] - b.data[i * 4 + c]);
    sum += d / 3;
    n++;
  }
  return n ? sum / n : 0;
}
/** Mean luma over a mask. */
function maskedLuma(p: PNG, m: Uint8Array): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < m.length; i++) {
    if (!m[i]) continue;
    sum += 0.2126 * p.data[i * 4] + 0.7152 * p.data[i * 4 + 1] + 0.0722 * p.data[i * 4 + 2];
    n++;
  }
  return n ? sum / n : 0;
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
      const shots: Record<string, PNG> = {};
      const bare: Record<string, PNG> = {};
      for (const arm of Object.keys(ARMS)) {
        await setArm(page, arm, true);
        shots[arm] = await shot(page);
        save(shots[arm], `${s.id}_z${z}_${arm}.png`);
        await setArm(page, arm, false);
        bare[arm] = await shot(page);
      }
      // The same-frame control: two photographs of one arm.
      await setArm(page, 'today', true);
      const again = await shot(page);
      const control = diff(shots.today, again);
      const mask = unitMask(shots.today, bare.today);
      let maskPx = 0;
      for (const v of mask) maskPx += v;
      const parts = Object.keys(ARMS).map((arm) => {
        const d = arm === 'today' ? { px: 0, mad: 0 } : diff(shots.today, shots[arm]);
        return `${arm}: vs today ${d.px} px / ${d.mad.toFixed(4)}, unit stand-off ${maskedMad(shots[arm], bare[arm], mask).toFixed(2)}, unit luma ${maskedLuma(shots[arm], mask).toFixed(1)}`;
      });
      say(`[${s.id} z${z}] control ${control.px} px; unit mask ${maskPx} px | ${parts.join(' | ')}`);
      // The ground's own move under terrain-roughness alone (units hidden).
      const g = diff(bare.today, bare.surface);
      say(`[${s.id} z${z}] units hidden, today vs surface (terrain roughness only on the ground): ${g.px} px / ${g.mad.toFixed(4)}`);
      if (z === 2.5) {
        const ladder: [string, number, number, 'light' | 'dark', number][] = [
          ['light-g0.2', 0.2, 0.32, 'light', 0],
          ['light-g0.5', 0.5, 0.32, 'light', 0],
          ['light-w0.2', 0.35, 0.2, 'light', 0],
          ['dark-g0.35', 0.35, 0.32, 'dark', 0.35],
          ['dark-g0.75', 0.35, 0.32, 'dark', 0.75],
        ];
        for (const [name, gain, width, mode, dark] of ladder) {
          await setArm(page, 'rim', true);
          await page.evaluate(
            ([gn, wd, md, dk]) => {
              const R = (window as unknown as { __lions: Lions }).__lions.renderer;
              R.setUnitRim(gn, wd, md, dk);
              R.frame(1, 0);
              R.frame(1, 0);
            },
            [gain, width, mode, dark] as const
          );
          const p = await shot(page);
          save(p, `${s.id}_z${z}_rim-${name}.png`);
          await page.evaluate(() => {
            const R = (window as unknown as { __lions: Lions }).__lions.renderer;
            R.setDebugLayerVisible('units', false);
            R.frame(1, 0);
            R.frame(1, 0);
          });
          const pb = await shot(page);
          say(`[${s.id} z${z}] ladder ${name}: unit stand-off ${maskedMad(p, pb, mask).toFixed(2)}, unit luma ${maskedLuma(p, mask).toFixed(1)}`);
        }
        await page.evaluate(() => (window as unknown as { __lions: Lions }).__lions.renderer.setUnitRim(0.35, 0.32, 'light', 0.55));
      }
      await setArm(page, 'both', true);
    }
  }
}

if (only.has('cost')) {
  const cases: { s: Subject; z: number }[] = [
    { s: SUBJECTS[0], z: 1 },
    { s: SUBJECTS[0], z: 2.5 },
    { s: SUBJECTS[1], z: 1 },
  ];
  const arms = ['today', 'both'];
  for (const c of cases) {
    const page = await pageFor(c.s);
    await view(page, c.s.cam[0], c.s.cam[1], c.z);
    const res: Record<string, { ms: number[]; calls: number; tris: number; programs: number; rimPrograms: number }> = {};
    for (const a of arms) res[a] = { ms: [], calls: 0, tris: 0, programs: 0, rimPrograms: 0 };
    for (let block = 0; block < 16; block++) {
      for (const a of block % 2 === 0 ? arms : [...arms].reverse()) {
        await setArm(page, a, true);
        const r = await page.evaluate(() => {
          const R = (window as unknown as { __lions: Lions }).__lions.renderer;
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
          for (let i = 0; i < 40; i++) {
            const t0 = performance.now();
            R.frame(1, 16);
            gl.finish();
            ms.push(performance.now() - t0);
          }
          const progs = info.programs ?? [];
          return { ms, calls, tris, programs: progs.length, rimPrograms: progs.filter((p) => p.cacheKey.includes('rl-rim')).length };
        });
        res[a].ms.push(...r.ms);
        res[a].calls = r.calls;
        res[a].tris = r.tris;
        res[a].programs = r.programs;
        res[a].rimPrograms = r.rimPrograms;
      }
    }
    const row = arms.map((a) => {
      const m = [...res[a].ms].sort((x, y) => x - y);
      const q = (f: number): string => m[Math.floor(m.length * f)].toFixed(2);
      return `${a}: wall q1 ${q(0.25)} / median ${q(0.5)} / q3 ${q(0.75)} / p95 ${q(0.95)} ms, calls ${res[a].calls}, tris ${res[a].tris}, programs ${res[a].programs} (rim ${res[a].rimPrograms})`;
    });
    say(`[cost ${c.s.id} z${c.z}] ${row.join(' | ')}  (load ${load()})`);
  }
}

say(`load average at end: ${load()}`);
fs.writeFileSync(path.join(OUT, `run-${Date.now()}.log`), log.join('\n') + '\n');
await browser.close();
stopServer();
