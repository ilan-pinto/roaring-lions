/**
 * `pnpm wind:capture -- --out=<dir> [--port=5181 | WIND_CAPTURE_PORT] [--only=arid,green,highland,wetland]`
 *
 * The wind's mock clip sheet (GH-984 N1; the lead approves it before the code lands). One Metal browser,
 * music off, its own dev server on its own port (5177, the lead's, is refused), the server stopped by
 * process group on the way out.
 *
 * For each terrain theme, three ARMS photographed at the SAME fixed sim ticks:
 *   today     the old sway -- the renderer's reduced-motion branch IS today's sway (`windU.mode` 0)
 *   proposed  design section 7's values at the theme's strength (1.0 / 0.8 / 1.3 / 1.0)
 *   strong    twice that strength (`windU.strength` written directly, so highland's 2.6 is not clamped)
 * through one gust: 8 frames 0.25 s (5 ticks) apart, starting where the gust front is not yet at the view
 * (gust < 0.2) and ending after it has passed through its peak (>= 0.95). The window is found per VIEW from
 * `windGust` (the pure TS mirror) at that view's own focus, because a front travels at 3 tiles/s.
 *
 * Views per theme, found in the page from the foliage batch's own instances (class from `rlNature.y`):
 *   grass  zoom 2.5 on the densest grass cluster (wetland: wet grass)
 *   reed   zoom 2.5 on the densest reed cluster (wetland only)
 *   tree   zoom 2.5 on the densest tree cluster (crown + trunk)
 *   mid    zoom 1.2 on the spot with most classes in reach
 *
 * Each sheet is rows (today, proposed, strong, then the same three as a MOTION row: |frame k - frame 0|
 * x8, white on black) by 8 columns. Layers hidden for legibility and stated in the index: fog, units,
 * overlays, and the rain streaks on the wetland (the wet sway stays: it is the wetland's program).
 *
 * Conditions are printed and written to index.md: GPU backend as the page reports it, viewport, DPR, ticks.
 */
import { chromium, type Browser, type Page } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { devServerStopper, ensureDevServer } from '../golden-diff/browser';
import { CAPTURE_VIEWPORT, FREEZE_FRAME_LOOP_STATEMENTS, HIDE_ALERT_FEED_STATEMENTS } from '../golden-diff/capture-protocol';
import { gpuLaunchArgs } from '../ui-review/gpu';
import { musicOffInitScript } from '../ui-review/music-off';
import { claimPortOrAttach } from '../ui-review/port';
import { windGust, windHeading } from '../../../packages/render/src/three/terrain/wind';

const TAG = 'wind';
const arg = (k: string, d: string): string => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
if (arg('port', '') === '5177') {
  console.error("[wind] refusing port 5177: it is the lead's dev server");
  process.exit(2);
}
const { port: PORT } = await claimPortOrAttach(TAG, 'WIND_CAPTURE_PORT', 5181);
const OUT = resolve(arg('out', 'wind-sheets-out'));
const ONLY = arg('only', 'arid,green,highland,wetland').split(',');
const ROOT = resolve(import.meta.dirname, '../../..');
mkdirSync(OUT, { recursive: true });
const lines: string[] = [];
const say = (s: string): void => {
  console.log(s);
  lines.push(s);
};

interface Theme {
  readonly id: string;
  readonly map: string;
  /** The theme's own strength (`TERRAIN_WIND`): the proposed arm. */
  readonly strength: number;
}
const THEMES: readonly Theme[] = [
  { id: 'arid', map: 'beit_sahwan_outskirts', strength: 1.0 },
  { id: 'green', map: 'wadi_halam_basin', strength: 0.8 },
  { id: 'highland', map: 'tel_marum', strength: 1.3 },
  { id: 'wetland', map: 'ein_qasab', strength: 1.0 },
];
const ARMS = ['today', 'proposed', 'strong'] as const;
const FRAMES = 8;
const TICKS_BETWEEN = 5; // 0.25 s
const CLASS_GRASS = 0;
const CLASS_REED = 1;
const CLASS_TREE = 3;

interface Inst {
  x: number;
  z: number;
  cls: number;
}
interface View {
  readonly id: string;
  readonly label: string;
  readonly zoom: number;
  readonly x: number;
  readonly z: number;
  /** Crop of the 1400x900 viewport, centred. */
  readonly cw: number;
  readonly ch: number;
}

const HELPERS = `(() => {
  const L = window.__lions;
  const r = L.renderer;
  /** Every foliage instance as {x, z, cls}: the class is rlNature.y at the first vertex of its geometry. */
  function instances() {
    const batch = r.decorGroup.children.find((c) => c.name === 'decor-foliage');
    if (!batch) return [];
    const nat = batch.geometry.getAttribute('rlNature');
    if (!nat) throw new Error('decor-foliage has no rlNature attribute: this tree has no wind');
    const m = new batch.matrixWorld.constructor();
    const out = [];
    for (let i = 0; i < batch._instanceInfo.length; i++) {
      const info = batch._instanceInfo[i];
      if (!info.active) continue;
      const vs = batch._geometryInfo[info.geometryIndex].vertexStart;
      batch.getMatrixAt(i, m);
      out.push({ x: m.elements[12], z: m.elements[14], cls: nat.array[2 * vs + 1] });
    }
    return out;
  }
  function setArm(arm, base) {
    r.opts.reducedMotion = arm === 'today' ? () => true : () => false;
    r.windU.strength.value = arm === 'strong' ? 2 * base : base;
  }
  function shoot(x, z, zoom) {
    L.goto(x, z);
    r.camera.zoom = zoom;
    r.selection = [];
    r.frame(1, 0);
    r.frame(1, 0);
  }
  function state() {
    return {
      tick: L.sim.tickCount, w: L.sim.width, h: L.sim.height,
      mode: r.windU.mode.value, strength: r.windU.strength.value, dir: [r.windU.dir.value.x, r.windU.dir.value.y],
      simSec: r.sway.time.value,
    };
  }
  window.__wind = { instances, setArm, shoot, state };
  return true;
})()`;

async function boot(page: Page, query: string): Promise<void> {
  await page.goto(`http://localhost:${PORT}/${query}`, { waitUntil: 'load', timeout: 120_000 });
  await page.mouse.move(2, 2);
  await page.waitForFunction(() => typeof (window as unknown as { __lions?: unknown }).__lions !== 'undefined', null, { timeout: 120_000 });
  await page.waitForTimeout(6000);
  await page.evaluate(`(async () => { ${FREEZE_FRAME_LOOP_STATEMENTS} ${HIDE_ALERT_FEED_STATEMENTS} })()`);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(HELPERS);
}

/** Densest cluster of `cls` (instances within `radius` tiles), at least `margin` tiles inside the map. */
function densest(list: readonly Inst[], cls: number, radius: number, w: number, h: number, margin: number): { x: number; z: number; n: number } | null {
  const of = list.filter((i) => i.cls === cls && i.x > margin && i.z > margin && i.x < w - margin && i.z < h - margin);
  let best: { x: number; z: number; n: number } | null = null;
  for (const c of of) {
    let n = 0;
    let sx = 0;
    let sz = 0;
    for (const o of of) {
      if (Math.hypot(o.x - c.x, o.z - c.z) <= radius) {
        n++;
        sx += o.x;
        sz += o.z;
      }
    }
    if (best === null || n > best.n) best = { x: sx / n, z: sz / n, n };
  }
  return best;
}

function viewsFor(list: readonly Inst[], w: number, h: number): View[] {
  const out: View[] = [];
  const add = (id: string, label: string, zoom: number, p: { x: number; z: number } | null, cw: number, ch: number): void => {
    if (p) out.push({ id, label, zoom, x: p.x, z: p.z, cw, ch });
    else say(`  (no ${label} cluster on this map: view skipped)`);
  };
  add('grass', 'grass, zoom 2.5', 2.5, densest(list, CLASS_GRASS, 1.5, w, h, 10), 360, 225);
  add('reed', 'reeds, zoom 2.5', 2.5, densest(list, CLASS_REED, 1.5, w, h, 10), 360, 225);
  add('tree', 'tree crown and trunk, zoom 2.5', 2.5, densest(list, CLASS_TREE, 2.5, w, h, 10), 360, 225);
  // Mid: the spot where the most instances of all classes sit within 5 tiles (a mix, not a single class).
  let mid: { x: number; z: number } | null = null;
  let score = -1;
  for (let x = 12; x <= w - 12; x += 2) {
    for (let z = 12; z <= h - 12; z += 2) {
      const near = list.filter((i) => Math.hypot(i.x - x, i.z - z) <= 5);
      const kinds = new Set(near.map((i) => i.cls)).size;
      const s = kinds * 1000 + near.length;
      if (s > score) {
        score = s;
        mid = { x, z };
      }
    }
  }
  add('mid', 'mixed ground, zoom 1.2', 1.2, mid, 480, 300);
  return out;
}

/**
 * The start tick, in the 2000 ticks from `from`, whose 8 frames best run THROUGH a gust at (x, z): calm at
 * the start, the full peak (>= 0.95) in the middle of the clip, easing off by the end. Scored, not first-fit:
 * the first window that reaches the peak is a gust still arriving at the last frame.
 */
function gustWindow(from: number, x: number, z: number, dir: { dirX: number; dirZ: number }): number {
  const g = (tick: number): number => windGust((tick - 1) * 0.05, x, z, dir.dirX, dir.dirZ);
  let best = -1;
  let bestScore = -Infinity;
  for (let t0 = from; t0 < from + 2000; t0++) {
    const f = Array.from({ length: FRAMES }, (_, k) => g(t0 + k * TICKS_BETWEEN));
    const mid = Math.max(f[2], f[3], f[4], f[5]);
    if (mid < 0.95) continue;
    const score = mid - 0.6 * f[0] - 0.6 * Math.max(0, f[FRAMES - 1] - 0.4);
    if (score > bestScore) {
      bestScore = score;
      best = t0;
    }
  }
  if (best < 0) throw new Error(`no gust window within 100 s of tick ${from} at (${x.toFixed(1)}, ${z.toFixed(1)})`);
  return best;
}

/** Compose one contact sheet in a page of the SAME browser (canvas text, no font files): rows x 8 columns. */
async function composeSheet(
  browser: Browser,
  title: string,
  colLabels: string[],
  rowLabels: string[],
  tiles: string[][], // [row][col] base64 PNG (the arms), rows 0..2
  cw: number,
  ch: number
): Promise<{ png: Buffer; motion: number[][] }> {
  // music-off: exempt -- a blank canvas page that composes the PNG; it never loads the game
  const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
  try {
    const args = JSON.stringify([title, colLabels, rowLabels, tiles, cw, ch]);
    const result = (await page.evaluate(`(async () => {
      const [titleS, cols, rows, tileRows, w, h] = ${args};
      const loadImg = (b64) => new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = () => rej(new Error('tile did not decode'));
        im.src = 'data:image/png;base64,' + b64;
      });
      const left = 150, top = 64, gap = 3;
      const nRows = tileRows.length * 2;
      const nCols = cols.length;
      const canvas = document.createElement('canvas');
      canvas.width = left + nCols * (w + gap);
      canvas.height = top + nRows * (h + gap) + 8;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#101010';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#e8e8e8';
      ctx.font = '600 20px sans-serif';
      ctx.fillText(titleS, 10, 26);
      ctx.font = '14px sans-serif';
      const motion = [];
      const imgs = [];
      for (const row of tileRows) imgs.push(await Promise.all(row.map(loadImg)));
      const tmp = document.createElement('canvas');
      tmp.width = w; tmp.height = h;
      const tctx = tmp.getContext('2d', { willReadFrequently: true });
      for (let c = 0; c < nCols; c++) ctx.fillText(cols[c], left + c * (w + gap) + 4, top - 10);
      for (let r = 0; r < imgs.length; r++) {
        let ref = null;
        const m = [];
        for (let c = 0; c < nCols; c++) {
          const x = left + c * (w + gap);
          ctx.drawImage(imgs[r][c], x, top + r * (h + gap));
          tctx.drawImage(imgs[r][c], 0, 0);
          const d = tctx.getImageData(0, 0, w, h);
          if (c === 0) ref = d.data;
          const out = ctx.createImageData(w, h);
          let changed = 0;
          for (let i = 0; i < d.data.length; i += 4) {
            const dv = Math.max(Math.abs(d.data[i] - ref[i]), Math.abs(d.data[i + 1] - ref[i + 1]), Math.abs(d.data[i + 2] - ref[i + 2]));
            if (dv >= 16) changed++;
            const v = Math.min(255, dv * 8);
            out.data[i] = v; out.data[i + 1] = v; out.data[i + 2] = v; out.data[i + 3] = 255;
          }
          ctx.putImageData(out, x, top + (imgs.length + r) * (h + gap));
          m.push(changed);
        }
        motion.push(m);
      }
      ctx.fillStyle = '#e8e8e8';
      for (let r = 0; r < imgs.length; r++) {
        ctx.fillText(rows[r], 8, top + r * (h + gap) + 20);
        ctx.fillText('motion x8', 8, top + (imgs.length + r) * (h + gap) + 20);
        ctx.fillText('(' + rows[r] + ')', 8, top + (imgs.length + r) * (h + gap) + 38);
      }
      return { data: canvas.toDataURL('image/png').split(',')[1], motion };
    })()`)) as { data: string; motion: number[][] };
    return { png: Buffer.from(result.data, 'base64'), motion: result.motion };
  } finally {
    await page.close();
  }
}

async function main(): Promise<void> {
  const server = await ensureDevServer(PORT, ROOT, TAG);
  const stop = devServerStopper(server, TAG);
  const browser = await chromium.launch({ headless: true, args: gpuLaunchArgs('metal') });
  const errors: string[] = [];
  const index: string[] = [];
  try {
    for (const theme of THEMES) {
      if (!ONLY.includes(theme.id)) continue;
      const page = await browser.newPage({ viewport: { ...CAPTURE_VIEWPORT }, deviceScaleFactor: 1 });
      await page.addInitScript(musicOffInitScript());
      page.on('pageerror', (e) => errors.push(`${theme.id}: ${e.message}`));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(`${theme.id}: ${m.text()}`);
      });
      await boot(page, `?sandbox=${theme.map}`);
      const gl = await page.evaluate(() => {
        const c = document.createElement('canvas').getContext('webgl2');
        const e = c?.getExtension('WEBGL_debug_renderer_info');
        return e && c ? String(c.getParameter(e.UNMASKED_RENDERER_WEBGL)) : 'unknown';
      });
      for (const layer of ['fog', 'units', 'overlays', ...(theme.id === 'wetland' ? ['rain'] : [])]) {
        await page.evaluate((l) => (window as unknown as { __lions: { renderer: { setDebugLayerVisible(n: string, v: boolean): number } } }).__lions.renderer.setDebugLayerVisible(l, false), layer);
      }
      await page.evaluate(() => {
        for (const el of Array.from(document.body.children)) {
          if (el.querySelector('canvas') || el.tagName === 'CANVAS') continue;
          (el as HTMLElement).style.display = 'none';
        }
      });
      const st0 = (await page.evaluate('window.__wind.state()')) as { tick: number; w: number; h: number; mode: number; strength: number; dir: number[] };
      say(`[${theme.id}] ${theme.map} ${st0.w}x${st0.h} gl=${gl} viewport ${CAPTURE_VIEWPORT.width}x${CAPTURE_VIEWPORT.height} dpr 1; start tick ${st0.tick}, windU strength ${st0.strength} dir (${st0.dir[0].toFixed(4)}, ${st0.dir[1].toFixed(4)}) mode ${st0.mode}`);
      if (Math.abs(st0.strength - theme.strength) > 1e-9) throw new Error(`${theme.id}: the page's wind strength ${st0.strength} is not the theme's ${theme.strength}`);
      const list = (await page.evaluate('window.__wind.instances()')) as Inst[];
      const census = [0, 1, 2, 3].map((c) => list.filter((i) => i.cls === c).length);
      say(`  foliage instances by class (grass, reed, shrub, tree): ${census.join(', ')}`);
      const dir = windHeading('east', 0, 1);
      index.push(`## ${theme.id} (${theme.map}, ${st0.w}x${st0.h}; proposed strength ${theme.strength}, strong ${2 * theme.strength})`, '');
      index.push(`GPU \`${gl}\`; viewport ${CAPTURE_VIEWPORT.width}x${CAPTURE_VIEWPORT.height}, DPR 1; foliage instances by class (grass, reed, shrub, tree): ${census.join(', ')}.`, '');
      let tick = st0.tick;
      for (const view of viewsFor(list, st0.w, st0.h)) {
        const t0 = gustWindow(tick + 20, view.x, view.z, dir);
        const gusts = Array.from({ length: FRAMES }, (_, k) => windGust((t0 + k * TICKS_BETWEEN - 1) * 0.05, view.x, view.z, dir.dirX, dir.dirZ));
        say(`  view ${view.id} at (${view.x.toFixed(1)}, ${view.z.toFixed(1)}) ${view.label}: ticks ${t0}..${t0 + (FRAMES - 1) * TICKS_BETWEEN}, gust ${gusts.map((g) => g.toFixed(2)).join(' ')}`);
        const tiles: string[][] = ARMS.map(() => []);
        const cols: string[] = [];
        for (let k = 0; k < FRAMES; k++) {
          const target = t0 + k * TICKS_BETWEEN;
          await page.evaluate((n) => (window as unknown as { __lions: { step(n: number): void } }).__lions.step(n), target - tick);
          tick = target;
          cols.push(`+${(k * 0.25).toFixed(2)}s  g=${gusts[k].toFixed(2)}`);
          for (let a = 0; a < ARMS.length; a++) {
            await page.evaluate(([arm, base]) => (window as unknown as { __wind: { setArm(a: string, b: number): void } }).__wind.setArm(arm as string, base as number), [ARMS[a], theme.strength] as const);
            await page.evaluate(([x, z, zoom]) => (window as unknown as { __wind: { shoot(x: number, z: number, zoom: number): void } }).__wind.shoot(x as number, z as number, zoom as number), [view.x, view.z, view.zoom] as const);
            const st = (await page.evaluate('window.__wind.state()')) as { tick: number; mode: number; strength: number; simSec: number };
            if (st.tick !== target) throw new Error(`${theme.id}/${view.id}: tick ${st.tick} != ${target}`);
            if (st.mode !== (ARMS[a] === 'today' ? 0 : 1)) throw new Error(`${theme.id}/${view.id}: arm ${ARMS[a]} but mode ${st.mode}`);
            const buf = await page.screenshot({
              clip: {
                x: CAPTURE_VIEWPORT.width / 2 - view.cw / 2,
                y: CAPTURE_VIEWPORT.height / 2 - view.ch / 2,
                width: view.cw,
                height: view.ch,
              },
            });
            tiles[a].push(buf.toString('base64'));
          }
        }
        const rowLabels = ARMS.map((a) => (a === 'today' ? 'TODAY' : a === 'proposed' ? `PROPOSED x${theme.strength}` : `STRONG x${2 * theme.strength}`));
        const title = `${theme.id} / ${theme.map} / ${view.label} / sim ticks ${t0}..${t0 + (FRAMES - 1) * TICKS_BETWEEN} (0.25 s apart) / ${gl.replace(/ANGLE \(|\)$/g, '')}`;
        const { png, motion } = await composeSheet(browser, title, cols, rowLabels, tiles, view.cw, view.ch);
        const file = `${theme.id}-${view.id}.png`;
        writeFileSync(join(OUT, file), png);
        const changed = motion.map((m) => m[FRAMES - 1]);
        say(`  -> ${file}: pixels changed >= 16/255 vs frame 0 at +1.75 s (of ${view.cw * view.ch}): today ${changed[0]}, proposed ${changed[1]}, strong ${changed[2]}`);
        index.push(`### ${view.label}`, '', `![${theme.id} ${view.id}](${file})`, '',
          `Focus (${view.x.toFixed(1)}, ${view.z.toFixed(1)}); sim ticks ${t0} to ${t0 + (FRAMES - 1) * TICKS_BETWEEN}; gust at the focus ${gusts.map((g) => g.toFixed(2)).join(', ')}.`,
          `Pixels that moved by 16/255 or more against each row's own first frame, at +1.75 s (of ${view.cw * view.ch}): today ${changed[0]}, proposed ${changed[1]}, strong ${changed[2]}.`, '');
      }
      await page.close();
    }
    if (errors.length > 0) {
      say(`console errors (${errors.length}):`);
      for (const e of errors.slice(0, 10)) say(`  ${e}`);
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
    stop();
  }
  const head = [
    '# N1 wind: mock clip sheets (GH-984)',
    '',
    'Each sheet is one view of one theme: three rows (TODAY, PROPOSED, STRONG) of 8 frames 0.25 s (5 sim ticks) apart, the same sim ticks in every row, through one gust; below them the same three as a MOTION row, `|frame k - frame 0|` x8, white on black, so a sway of a pixel or two is readable.',
    '',
    '- **today** is the renderer\'s reduced-motion branch, which is today\'s sway exactly (crowns only, the old periodic gust on one fixed axis; the wetland keeps its x2.2 wet sway). Grass, reeds, shrubs and trunks do not move in it.',
    '- **proposed** is design section 7: grass tip 0.015 wu / 1.9 s, reeds 0.03 / 2.4, shrubs 0.02 / 3.0, tree crown 0.035 / 3.8 with the trunk on the same curve, a travelling gust (x1.5, front 3 tiles/s, noise lattice 3 s), at the theme strength (arid 1.0, green 0.8, highland 1.3, wetland 1.0 on top of its wet x2.2).',
    '- **strong** is twice the proposed strength.',
    '- A gust also leans the whole stand downwind by 0.5 x the class amplitude at its peak (`WIND_GUST_LEAN`); this is mine, not the design\'s, and one constant to zero.',
    '- Hidden for legibility: fog of war, units, overlays' + ', and the rain streaks on the wetland. The HUD is hidden. Reduced motion is the "today" row, so a player who asks for it sees exactly that row.',
    '- Captured on the real renderer through `__lions` (a mock instrument: arms are switched by writing the wind uniforms and the reduced-motion callback), frame loop frozen, `frame(1, 0)` twice per shot.',
    '',
    ...lines.filter((l) => l.startsWith('[')).map((l) => `- ${l}`),
    '',
  ];
  writeFileSync(join(OUT, 'index.md'), [...head, ...index].join('\n'));
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
