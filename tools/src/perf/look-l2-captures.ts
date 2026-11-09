/**
 * Look uplift L2 (GH-943): the MOCK instrument for the colour grade -- not a gate.
 *
 *   pnpm exec tsx tools/src/perf/look-l2-captures.ts --out=<dir> [--port=5183]
 *       [--only=recon,stills,identity,banding,cost] [--maps=beit_sahwan_outskirts]
 *
 * One Metal Chromium, music off, its own dev server on its own port (never 5177), ONE page at a time.
 * Every arm of a still is the SAME page: same sandbox, same sim tick, same camera, frame loop frozen and
 * the frame repainted at zero elapsed time, with only `ThreeRenderer.setGrade` between two photographs,
 * so two columns differ by the grade alone.
 *
 * - **recon**    prints what the sandbox force is made of, and where.
 * - **stills**   the lead's sheet: {vehicles, infantry, buildings} x {dawn, dusk} x zoom {1, 2.5} x
 *                {identity, 0.5, 1.0, 1.5}.
 * - **identity** the pixel half of `grade-identity.test.ts`: a page that never saw a grade, the same
 *                page after set-then-remove, and the `grade` layer hidden over a live grade, must all
 *                equal the ungraded frame at 0 px; a saturation-1.01 grade must not (the falsifier).
 * - **banding**  dark dusk frame, four arms: 16-bit (no dither), dither (the shipped default), an 8-bit
 *                LUT with no dither (the diagnostic), and the ungraded frame.
 * - **cost**     GPU-timer (EXT_disjoint_timer_query_webgl2) and wall ms, interleaved blocks, per quality
 *                preset, identity vs graded.
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

const TAG = 'look-l2';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
const flag = (n: string): string | undefined => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const OUT = path.resolve(flag('out') ?? path.join(REPO_ROOT, '.superpowers/look-l2'));
const only = new Set((flag('only') ?? 'recon,stills,identity,banding,cost').split(','));
const MAPS = (flag('maps') ?? 'beit_sahwan_outskirts').split(',');
const PRESETS = (flag('presets') ?? 'dawn,dusk').split(',') as Preset[];
const ZOOMS = (flag('zooms') ?? '1,2.5').split(',').map(Number);
const STRENGTHS = (flag('strengths') ?? '0.5,1,1.5').split(',').map(Number);
const DPR = Number(flag('dpr') ?? 2);
fs.mkdirSync(OUT, { recursive: true });

type Preset = 'dawn' | 'dusk';
const grade = (id: Preset): unknown => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'data/grades', `${id}.json`), 'utf8'));

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
    setGrade(json: unknown, strength?: number, options?: { dither?: boolean; lut?: 'half' | 'byte' }): boolean;
    gradeActive: boolean;
    worldToScreen(x: number, y: number): { x: number; y: number };
  };
  sim: {
    tickCount: number;
    width: number;
    height: number;
    structureCount: number;
    structures: Record<string, ArrayLike<number>>;
    structureTypes: { id: string }[];
  };
  step(n: number): void;
  units(side?: number): { id: number; type: string; x: number; y: number }[];
}
/** In-page global: a getter onto `window.__lions` (installed by the init script in `boot`). */
declare const LL: L;

const { port } = await claimPortOrAttach(TAG, 'LOOK_L2_PORT', 5183);
const stopServer = devServerStopper(await ensureDevServer(port, REPO_ROOT, TAG), TAG);
const base = `http://localhost:${port}`;
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--use-gl=angle', '--enable-gpu-rasterization', '--disable-gpu-sandbox'],
});
say(`look-l2 mock instrument; tree ${REPO_ROOT}; port ${port}; dpr ${DPR}; load average ${load()}`);

/** Boots one sandbox page: music off, frame loop frozen, stepped to `tick`, HUD hidden. NO grade is requested. */
async function boot(map: string, tod: Preset, tick = 200, extra = '', quality: 'high' | 'medium' | 'low' = 'high'): Promise<{ page: Page; gpu: string }> {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: DPR });
  await page.addInitScript(musicOffInitScript({}, { quality }));
  await page.addInitScript("window.__name = (f) => f; Object.defineProperty(window, 'LL', { get() { return window.__lions; } });");
  await page.goto(`${base}/?sandbox=${map}&tod=${tod}${extra}`, { waitUntil: 'load' });
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

/** Installs a grade (or none) and repaints twice at zero elapsed time: the first repaint compiles the changed shader. */
async function setGrade(page: Page, json: unknown, strength = 1, options?: { dither?: boolean; lut?: 'half' | 'byte' }): Promise<boolean> {
  return page.evaluate(
    ([j, s, o]) => {
      const R = LL.renderer;
      const built = R.setGrade(j, s, o ?? undefined);
      R.frame(1, 0);
      R.frame(1, 0);
      return built;
    },
    [json, strength, options ?? null] as const
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
/** Mean display luma (Rec.709 on the sRGB bytes, 0..1) and mean linear luma. */
function meanLuma(p: PNG): { display: number; linear: number } {
  let d = 0;
  let l = 0;
  const n = p.width * p.height;
  for (let i = 0; i < n * 4; i += 4) {
    d += (0.2126 * p.data[i] + 0.7152 * p.data[i + 1] + 0.0722 * p.data[i + 2]) / 255;
    l += 0.2126 * srgbToLin(p.data[i]) + 0.7152 * srgbToLin(p.data[i + 1]) + 0.0722 * srgbToLin(p.data[i + 2]);
  }
  return { display: d / n, linear: l / n };
}
/** Pixels differing by more than `thr`/255 (mean of channels), and the mean absolute channel delta / 255. */
function diff(a: PNG, b: PNG, thr = 0): { px: number; mad: number; max: number } {
  let px = 0;
  let sum = 0;
  let max = 0;
  const n = a.width * a.height;
  for (let i = 0; i < n * 4; i += 4) {
    let d = 0;
    for (let c = 0; c < 3; c++) {
      const e = Math.abs(a.data[i + c] - b.data[i + c]);
      d += e;
      if (e > max) max = e;
    }
    sum += d / 3;
    if (d / 3 > thr) px++;
  }
  return { px, mad: sum / n / 255, max };
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

// --- banding metric ------------------------------------------------------------

/**
 * The fraction of DARK pixels (display luma under `darkBelow` of 255) that sit on a STAIRCASE step of a
 * horizontal or vertical run: a maximal run of identical luma bytes at least `minRun` pixels long whose two
 * neighbours differ from it by exactly one level, in the same direction. That is a band: a gradient the
 * 8-bit write has cut into plateaus. A flat region (the run ends at an edge or a jump, not a +-1 step) and a
 * dithered gradient (runs of 1-3 px) both score ~0; a clean staircase scores its whole plateau area.
 */
function bandedFraction(p: PNG, darkBelow = 64, minRun = 8): number {
  const luma = new Uint8Array(p.width * p.height);
  for (let i = 0; i < luma.length; i++) {
    luma[i] = Math.round(0.2126 * p.data[i * 4] + 0.7152 * p.data[i * 4 + 1] + 0.0722 * p.data[i * 4 + 2]);
  }
  let banded = 0;
  let dark = 0;
  const scan = (get: (k: number) => number, len: number, mark: (k: number) => void): void => {
    let s = 0;
    while (s < len) {
      let e = s;
      while (e + 1 < len && get(e + 1) === get(s)) e++;
      const runLen = e - s + 1;
      if (runLen >= minRun && s > 0 && e < len - 1) {
        const before = get(s - 1) - get(s);
        const after = get(e + 1) - get(s);
        if (Math.abs(before) === 1 && before === -after && get(s) < darkBelow) for (let k = s; k <= e; k++) mark(k);
      }
      s = e + 1;
    }
  };
  const hit = new Uint8Array(luma.length);
  for (let y = 0; y < p.height; y++) scan((x) => luma[y * p.width + x], p.width, (x) => (hit[y * p.width + x] = 1));
  for (let x = 0; x < p.width; x++) scan((y) => luma[y * p.width + x], p.height, (y) => (hit[y * p.width + x] = 1));
  for (let i = 0; i < luma.length; i++) {
    if (luma[i] < darkBelow) dark++;
    if (hit[i] === 1) banded++;
  }
  return dark === 0 ? 0 : banded / dark;
}

// --- modes ------------------------------------------------------------------

const t0 = Date.now();
const COLUMNS = [{ id: 'identity', strength: 0 }, ...STRENGTHS.map((s) => ({ id: `s${s}`, strength: s }))];

try {
  if (only.has('recon')) {
    const { page, gpu } = await boot(MAPS[0], 'dusk');
    say(`[recon] gpu ${gpu}`);
    await findSubjects(page);
    await page.close();
  }

  if (only.has('stills')) {
    for (const map of MAPS) {
      for (const tod of PRESETS) {
        const { page, gpu } = await boot(map, tod);
        say(`[stills ${map} ${tod}] gpu ${gpu}, tick ${await page.evaluate(() => LL.sim.tickCount)}, dpr ${DPR}, 1400x900 css`);
        const json = grade(tod);
        const subjects = await findSubjects(page);
        for (const sub of subjects) {
          for (const z of ZOOMS) {
            await view(page, sub.cx, sub.cy, z);
            const shots: Record<string, PNG> = {};
            // The first column is a page that has just set-then-removed a grade: an identity by construction, and the
            // `identity` mode proves it equals a page that never saw one.
            for (const col of COLUMNS) {
              await setGrade(page, col.strength === 0 ? null : json, col.strength);
              shots[col.id] = await shot(page);
              save(shots[col.id], `${map}_${tod}_${sub.id}_z${z}_${col.id}.png`);
            }
            const lum = Object.fromEntries(Object.entries(shots).map(([k, v]) => [k, meanLuma(v).display]));
            say(
              `[stills ${tod} ${sub.id} z${z}] mean display luma ` +
                COLUMNS.map((c) => `${c.id} ${lum[c.id].toFixed(4)}`).join(', ') +
                `; px differing from identity ` +
                COLUMNS.slice(1).map((c) => `${c.id} ${diff(shots.identity, shots[c.id], 2).px}`).join(', ')
            );
          }
        }
        await page.close();
      }
    }
  }

  if (only.has('identity')) {
    // The pixel half of grade-identity.test.ts.
    const { page, gpu } = await boot(MAPS[0], 'dusk');
    say(`[identity] gpu ${gpu}`);
    const subs = await findSubjects(page);
    const sub = subs.find((s) => s.id === 'vehicles') ?? subs[0];
    await view(page, sub.cx, sub.cy, 1.6);
    const never = await shot(page);
    const json = grade('dusk');
    const built = await setGrade(page, json, 1);
    const graded = await shot(page);
    const hidden = await page.evaluate(() => {
      LL.renderer.setDebugLayerVisible('grade', false);
      LL.renderer.frame(1, 0);
      return LL.renderer.gradeActive;
    });
    const gradedHidden = await shot(page);
    await page.evaluate(() => {
      LL.renderer.setDebugLayerVisible('grade', true);
      LL.renderer.frame(1, 0);
    });
    await setGrade(page, null);
    const removed = await shot(page);
    const sat = { ...(json as Record<string, unknown>), saturation: 1, warmth: 0, lift: { tint: 'water.1', amount: 0, level: 0 }, gamma: { tint: 'water.1', amount: 0, value: 1 }, gain: { tint: 'water.1', amount: 0, value: 1 }, split_tone: { shadows: { tint: 'water.1', amount: 0 }, highlights: { tint: 'water.1', amount: 0 }, balance: 0 } };
    const identityBuilt = await setGrade(page, sat, 1);
    const identityShot = await shot(page);
    const slight = await setGrade(page, { ...sat, saturation: 1.01 }, 1);
    const slightShot = await shot(page);
    const d = (a: PNG, b: PNG): string => {
      const r = diff(a, b);
      return `${r.px} px differ, max channel delta ${r.max}/255`;
    };
    say(`[identity] dusk grade compiled: ${built}; graded vs never-graded: ${d(never, graded)} (must be > 0)`);
    say(`[identity] grade layer hidden over a live grade (gradeActive ${hidden}): ${d(never, gradedHidden)} (must be 0)`);
    say(`[identity] set then removed: ${d(never, removed)} (must be 0)`);
    say(`[identity] an all-identity grade file (builds a lookup: ${identityBuilt}): ${d(never, identityShot)} (must be 0, and build nothing)`);
    say(`[identity] FALSIFIER saturation 1.01 (builds a lookup: ${slight}): ${d(never, slightShot)} (a lookup is compiled in; its pixels are the maths')`);
    await page.close();
  }

  if (only.has('banding')) {
    const { page, gpu } = await boot(MAPS[0], 'dusk');
    say(`[banding] gpu ${gpu}, dusk, tick ${await page.evaluate(() => LL.sim.tickCount)}, dpr ${DPR}`);
    const json = grade('dusk');
    const arms: { id: string; label: string; apply: () => Promise<unknown> }[] = [
      { id: 'ungraded', label: 'ungraded (today)', apply: () => setGrade(page, null) },
      { id: 'half-nodither', label: '16-bit LUT, no dither', apply: () => setGrade(page, json, 1, { dither: false, lut: 'half' }) },
      { id: 'half-dither', label: '16-bit LUT + dither (shipped default)', apply: () => setGrade(page, json, 1, { dither: true, lut: 'half' }) },
      { id: 'byte-nodither', label: '8-bit LUT, no dither (diagnostic)', apply: () => setGrade(page, json, 1, { dither: false, lut: 'byte' }) },
    ];
    // The dark frame: the whole map at the minimum-ish zoom, so the vignette's ramp and the dark void beyond the map
    // are in view, plus a close view of the same dusk ground.
    const w = await page.evaluate(() => ({ w: LL.sim.width, h: LL.sim.height }));
    const views: [string, number, number, number][] = [
      ['wide', w.w / 2, w.h / 2, 0.4],
      ['edge', w.w / 2, w.h - 6, 0.9],
    ];
    for (const [vid, cx, cy, z] of views) {
      await page.evaluate(() => LL.renderer.setDebugLayerVisible('fog', false));
      await view(page, cx, cy, z);
      const shots: Record<string, PNG> = {};
      for (const arm of arms) {
        await arm.apply();
        shots[arm.id] = await shot(page);
        save(shots[arm.id], `banding_${vid}_${arm.id}.png`);
      }
      // Repeat each arm once more: a deterministic arm must give the same number twice.
      for (const arm of arms) {
        await arm.apply();
        const again = await shot(page);
        const same = diff(shots[arm.id], again).px;
        const darkPx = (() => {
          let n = 0;
          for (let i = 0; i < shots[arm.id].data.length; i += 4) if (0.2126 * shots[arm.id].data[i] + 0.7152 * shots[arm.id].data[i + 1] + 0.0722 * shots[arm.id].data[i + 2] < 64) n++;
          return n / (shots[arm.id].width * shots[arm.id].height);
        })();
        say(
          `[banding ${vid}] ${arm.label}: banded fraction of dark px ${(bandedFraction(shots[arm.id]) * 100).toFixed(3)}% (minRun 8) / ${(bandedFraction(shots[arm.id], 64, 4) * 100).toFixed(3)}% (minRun 4); dark px ${(darkPx * 100).toFixed(1)}% of frame; mean |delta| vs ungraded ${(diff(shots.ungraded, shots[arm.id]).mad * 255).toFixed(3)} levels; repeat differs ${same} px`
        );
      }
    }
    await page.close();
  }

  if (only.has('cost')) {
    const qualities = (flag('qualities') ?? 'high,low').split(',') as ('high' | 'medium' | 'low')[];
    for (const q of qualities) {
      const { page, gpu } = await boot(MAPS[0], 'dusk', 200, '', q);
      say(`[cost ${q}] gpu ${gpu}, load ${load()}`);
      const json = grade('dusk');
      const subs = await findSubjects(page);
      const sub = subs.find((s) => s.id === 'vehicles') ?? subs[0];
      await view(page, sub.cx, sub.cy, 1);
      const arms = ['identity', 'graded', 'graded-nodither'] as const;
      const res: Record<string, { ms: number[]; gpu: number[] }> = Object.fromEntries(arms.map((a) => [a, { ms: [] as number[], gpu: [] as number[] }]));
      for (let block = 0; block < 16; block++) {
        for (const a of block % 2 === 0 ? [...arms] : [...arms].reverse()) {
          await setGrade(page, a === 'identity' ? null : json, 1, { dither: a !== 'graded-nodither' });
          const r = await page.evaluate(() => {
            const R = LL.renderer;
            const gl = R.canvas.getContext('webgl2');
            if (!gl) throw new Error('no context');
            for (let i = 0; i < 10; i++) R.frame(1, 16);
            gl.finish();
            const ms: number[] = [];
            const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number } | null;
            const queries: WebGLQuery[] = [];
            for (let i = 0; i < 40; i++) {
              const t = performance.now();
              const query = ext ? gl.createQuery() : null;
              if (ext && query) gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
              R.frame(1, 16);
              if (ext && query) {
                gl.endQuery(ext.TIME_ELAPSED_EXT);
                queries.push(query);
              }
              gl.finish();
              ms.push(performance.now() - t);
            }
            const gpuMs: number[] = [];
            for (const query of queries) {
              if (gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) gpuMs.push((gl.getQueryParameter(query, gl.QUERY_RESULT) as number) / 1e6);
              gl.deleteQuery(query);
            }
            return { ms, gpuMs };
          });
          res[a].ms.push(...r.ms);
          res[a].gpu.push(...r.gpuMs);
        }
      }
      const med = (v: number[]): number => [...v].sort((x, y) => x - y)[Math.floor(v.length / 2)] ?? NaN;
      const quart = (v: number[], f: number): number => [...v].sort((x, y) => x - y)[Math.floor(v.length * f)] ?? NaN;
      for (const a of arms) {
        const r = res[a];
        say(
          `[cost ${q} ${a}] wall median ${med(r.ms).toFixed(2)} ms (q1 ${quart(r.ms, 0.25).toFixed(2)} / q3 ${quart(r.ms, 0.75).toFixed(2)}), ` +
            (r.gpu.length > 0 ? `gpu-timer median ${med(r.gpu).toFixed(3)} ms (q1 ${quart(r.gpu, 0.25).toFixed(3)} / q3 ${quart(r.gpu, 0.75).toFixed(3)}, n ${r.gpu.length})` : 'gpu-timer n/a')
        );
      }
      say(
        `[cost ${q}] graded - identity: wall ${(med(res.graded.ms) - med(res.identity.ms)).toFixed(3)} ms, gpu-timer ${(med(res.graded.gpu) - med(res.identity.gpu)).toFixed(3)} ms; dither adds ${(med(res.graded.gpu) - med(res['graded-nodither'].gpu)).toFixed(3)} ms gpu`
      );
      await page.close();
    }
  }
} finally {
  fs.writeFileSync(path.join(OUT, 'look-l2-captures.log'), log.join('\n') + '\n');
  await browser.close();
  stopServer();
  say(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
