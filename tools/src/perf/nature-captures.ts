/**
 * `pnpm nature:capture -- --out=<dir> [--port=5182 | NATURE_CAPTURE_PORT] [--phase=sheets,signal,cost] [--only=arid,green]`
 *
 * GH-984 N2 (vehicles bend the vegetation): the mock clip sheets the lead approves, the `disturb` layer's
 * signal on the gated `vehicle` scenario, and the frame-cost A/B -- ALL in ONE Metal browser, music off, its own
 * dev server on its own port (5177, the lead's, is refused: `nature-port.ts`), the server stopped by process
 * group on the way out.
 *
 * PHASE `sheets`. For arid (`beit_sahwan_outskirts`) and green (`wadi_halam_basin`), a Lavi, alone on the map
 * (every other unit is moved to a far corner and halted, so nothing fights in frame), photographed at fixed
 * sim ticks, 8 frames 0.25 s (5 ticks) apart, in two arms:
 *   N1 only    the wind alone: `disturb` amplitude 0, and for the pivot scene the churn decal and the clods patched out
 *   N1 + N2    the shipped build
 * Rows: N1 only, N1 + N2, and |N1+N2 - N1| x8 (white on black). Scenes:
 *   drive      the Lavi driving through grass and bushes along screen-right, at a CLOSE zoom (2.5) and a MID zoom (1.2);
 *              the path is the one with the most grass, reeds and shrubs and no tree in the clip window
 *   parked     the Lavi parked in the densest grass, close
 *   pivot      the Lavi turning on the spot (its heading advanced 0.012 turn a tick by the instrument, the sim leaves
 *              a stopped hull's heading alone), showing clods and churn; the two arms are two page loads stepped to
 *              the same absolute tick, so the world is identical
 * MOCK INSTRUMENTS, stated: the Lavi is placed by writing `posX`/`posY`/`facing` (the sandbox's own Lavi), the
 * others moved the same way, and the pivot's heading is written per tick. The renderer, the sim's `move` command and
 * its ticks, the wake ring and every uniform are the shipped ones.
 *
 * PHASE `signal`. The gated `vehicle` scenario's own capture protocol (`capture-protocol.ts`, the gate's URL, freeze,
 * repaint control, toggle script and pixelmatch threshold -- `relief-read-signal.ts`'s method), three fresh page loads,
 * hiding the `disturb` layer: px / mean |channel delta| each, and the repaint control. Metal here, SwiftShader on CI:
 * the floor must be re-measured from CI at the bless.
 *
 * PHASE `cost`. `wadi_tarfan_l` (96x96) sandbox, topped up with Lavis and riflemen to the sandbox sim's capacity
 * (256: not 400, the sandbox cannot hold more), 24 hulls driving round the view so every slot is live and the
 * bounding box covers the view (the worst case for the shader). Per preset (one boot each: the preset applies at boot),
 * the `disturb` layer off (amplitude 0 and the frame's own work skipped: N2 as good as absent) against on, INTERLEAVED
 * three rounds, at zoom 0.5 and 1, `renderer.frame(1, 16)` cpu median/p95 and `gl.finish`-bracketed gpu median/p95
 * (`render-frame-cost.ts`'s method), then the slot ladder 24/16/8/0 on the same page. Conditions printed: GL renderer,
 * drawing buffer, load average before and after.
 */
import { chromium, type Browser, type Page } from 'playwright';
import os from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { capture, devServerStopper, ensureDevServer, rephotograph } from '../golden-diff/browser';
import {
  CAPTURE_VIEWPORT,
  FREEZE_FRAME_LOOP_STATEMENTS,
  HIDE_ALERT_FEED_STATEMENTS,
  REPAINT_SCRIPT,
  SCENARIOS,
  captureScript,
  layerToggleScript,
  threeUrl,
} from '../golden-diff/capture-protocol';
import { computeDiff } from '../golden-diff/diff';
import { specFor } from '../golden-diff/baseline';
import { gpuLaunchArgs } from '../ui-review/gpu';
import { musicOffInitScript } from '../ui-review/music-off';
import { claimPortOrAttach } from '../ui-review/port';
import { NATURE_DEFAULT_PORT, naturePortRefusal } from './nature-port';

const TAG = 'nature';
const arg = (k: string, d: string): string => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
// The RESOLVED port (flag, then NATURE_CAPTURE_PORT, then 5182), not just `--port=`: 5177 is the lead's.
const refusal = naturePortRefusal(process.argv.slice(2), process.env);
if (refusal !== null) {
  console.error(refusal);
  process.exit(2);
}
const { port: PORT } = await claimPortOrAttach(TAG, 'NATURE_CAPTURE_PORT', NATURE_DEFAULT_PORT);
const OUT = resolve(arg('out', 'nature-sheets-out'));
const PHASES = arg('phase', 'sheets,signal,cost').split(',');
const ONLY = arg('only', 'arid,green').split(',');
/** Which clips of the `sheets` phase to shoot (`--scenes=pivot` re-shoots the pivot alone). */
const SCENES = arg('scenes', 'drive,parked,pivot').split(',');
const ROOT = resolve(import.meta.dirname, '../../..');
mkdirSync(OUT, { recursive: true });
const lines: string[] = [];
const say = (s: string): void => {
  console.log(s);
  lines.push(s);
};
const load = (): string => os.loadavg().map((n) => n.toFixed(2)).join(' ');

interface Theme {
  readonly id: string;
  readonly map: string;
}
const THEMES: readonly Theme[] = [
  { id: 'arid', map: 'beit_sahwan_outskirts' },
  { id: 'green', map: 'wadi_halam_basin' },
];
const FRAMES = 8;
const TICKS_BETWEEN = 5; // 0.25 s
const ARMS = ['N1 only', 'N1 + N2'] as const;

// --- the in-page helpers ---------------------------------------------------------------------------------------

const HELPERS = `(() => {
  const L = window.__lions;
  const r = L.renderer;
  const sim = L.sim;
  const Q = 65536;
  const q = (v) => Math.round(v * Q);
  const tileOf = (v) => Math.floor(v);
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
  function lavi() {
    for (let i = 0; i < sim.entityCount; i++) {
      if (sim.state.alive[i] && sim.unitTypes[sim.state.typeIdx[i]].id === 'mbt_lavi' && sim.state.side[i] === 0) return i;
    }
    throw new Error('no living friendly mbt_lavi in this sandbox');
  }
  /** Every other unit to a far corner, halted: nothing fights or crowds the frame. */
  function isolate(keep) {
    const ids = [];
    let k = 0;
    for (let i = 0; i < sim.entityCount; i++) {
      if (i === keep || !sim.state.alive[i]) continue;
      sim.state.posX[i] = q(1.5 + (k % 12) * 0.35);
      sim.state.posY[i] = q(1.5 + Math.floor(k / 12) * 0.35);
      ids.push(i);
      k++;
    }
    if (ids.length) sim.queueCommand({ kind: 'halt', ids });
    return ids.length;
  }
  function place(id, x, z, turns) {
    sim.state.posX[id] = q(x);
    sim.state.posY[id] = q(z);
    sim.state.facing[id] = Math.round(turns * Q) & 0xffff;
    sim.queueCommand({ kind: 'halt', ids: [id] });
  }
  function drive(id, x, z) { sim.queueCommand({ kind: 'move', ids: [id], x: q(x), y: q(z) }); }
  function setFacing(id, turns) { sim.state.facing[id] = Math.round(turns * Q) & 0xffff; }
  function pos(id) { return [sim.state.posX[id] / Q, sim.state.posY[id] / Q, (sim.state.facing[id] & 0xffff) / Q]; }
  function open(x, z) {
    if (x < 1 || z < 1 || x > sim.width - 1 || z > sim.height - 1) return false;
    return sim.blockedVehicle[tileOf(z) * sim.width + tileOf(x)] === 0;
  }
  /** No wall, building or ridge within r tiles (a box): a building drawn in front of the hull would hide the clip. */
  function clear(x, z, r) {
    for (let tz = Math.floor(z - r); tz <= Math.floor(z + r); tz++)
      for (let tx = Math.floor(x - r); tx <= Math.floor(x + r); tx++)
        if (tx < 0 || tz < 0 || tx >= sim.width || tz >= sim.height || sim.blocked[tz * sim.width + tx] !== 0) return false;
    return true;
  }
  /** The N2 arm: amplitude, and (pivot scene only) the churn decal and the clods patched out for the N1 arm. */
  const orig = { stamp: r.stampGroundDecal, clods: r.updateVehicleClods };
  const patch = { dropChurn: false, dropClods: false };
  r.stampGroundDecal = function (s) { return patch.dropChurn && s.kind === 'churn' ? false : orig.stamp.call(this, s); };
  r.updateVehicleClods = function (a) { if (!patch.dropClods) orig.clods.call(this, a); else this.clodDone.fill(1); };
  function arm(n2) { r.disturbU.amp.value = n2 ? 1 : 0; }
  function shoot(x, z, zoom) {
    L.goto(x, z);
    r.camera.zoom = zoom;
    r.selection = [];
    r.frame(1, 0);
    r.frame(1, 0);
  }
  function state() {
    const u = r.disturbU;
    return { tick: sim.tickCount, w: sim.width, h: sim.height, n: u.n.value, amp: u.amp.value, spring: u.spring.value,
      box: Array.from(u.box.value.toArray()), a: Array.from(u.a.value).slice(0, 4) };
  }
  window.__n2 = { instances, lavi, isolate, place, drive, setFacing, pos, open, clear, arm, patch, shoot, state };
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

async function glRenderer(page: Page): Promise<string> {
  return page.evaluate(() => {
    const c = document.createElement('canvas').getContext('webgl2');
    const e = c?.getExtension('WEBGL_debug_renderer_info');
    return e && c ? String(c.getParameter(e.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  });
}

type Win = { __n2: Record<string, (...a: unknown[]) => unknown>; __lions: { step(n: number): number; renderer: { setDebugLayerVisible(n: string, v: boolean): number } } };
const call = <T>(page: Page, fn: string, ...args: unknown[]): Promise<T> =>
  page.evaluate(([f, a]) => (window as unknown as Win).__n2[f as string](...(a as unknown[])) as unknown, [fn, args] as const) as Promise<T>;
const stepTo = async (page: Page, target: number): Promise<number> =>
  page.evaluate((t) => {
    const w = window as unknown as Win & { __lions: { sim: { tickCount: number } } };
    const cur = w.__lions.sim.tickCount;
    if (t < cur) throw new Error(`cannot step back: at tick ${cur}, asked for ${t}`);
    if (t > cur) w.__lions.step(t - cur);
    return w.__lions.sim.tickCount;
  }, target);

/** Hide fog, overlays and the HUD (and the rain on a wet map): what N1's sheets hid. */
async function clean(page: Page): Promise<void> {
  for (const layer of ['fog', 'overlays']) {
    await page.evaluate((l) => (window as unknown as Win).__lions.renderer.setDebugLayerVisible(l, false), layer);
  }
  await page.evaluate(() => {
    for (const el of Array.from(document.body.children)) {
      if (el.querySelector('canvas') || el.tagName === 'CANVAS') continue;
      (el as HTMLElement).style.display = 'none';
    }
  });
}

// --- the scenes ------------------------------------------------------------------------------------------------

interface Inst {
  x: number;
  z: number;
  cls: number;
}
const D = { x: Math.SQRT1_2, z: -Math.SQRT1_2 }; // screen-right on the ground plane
const DRIVE_TURNS = 0.875; // heading of (1, -1): atan2(-1, 1) = -45 deg

/** The drive path through the most undergrowth: the clip window s in [-1.3, 2.2] along `D` from M, no tree inside it, open ground from the start to the goal. */
async function findDrive(page: Page, list: readonly Inst[], w: number, h: number): Promise<{ mx: number; mz: number; grass: number; shrub: number; reed: number } | null> {
  const found = (await page.evaluate(
    ([inst, width, height]) => {
      const n2 = (window as unknown as { __n2: { open(x: number, z: number): boolean; clear(x: number, z: number, r: number): boolean } }).__n2;
      const dx = Math.SQRT1_2;
      const dz = -Math.SQRT1_2;
      let top: { mx: number; mz: number; grass: number; shrub: number; reed: number; score: number } | null = null;
      for (let mx = 9; mx <= (width as number) - 9; mx++) {
        for (let mz = 9; mz <= (height as number) - 9; mz++) {
          let open = true;
          for (let s = -4.8; s <= 7 && open; s += 0.25) open = n2.open(mx + s * dx, mz + s * dz);
          if (!open || !n2.clear(mx, mz, 6)) continue;
          let grass = 0;
          let shrub = 0;
          let reed = 0;
          let tree = 0;
          for (const i of inst as { x: number; z: number; cls: number }[]) {
            // Distance to the segment s in [-1.3, 2.2].
            const px = i.x - mx;
            const pz = i.z - mz;
            const s = Math.max(-1.3, Math.min(2.2, px * dx + pz * dz));
            const d = Math.hypot(px - s * dx, pz - s * dz);
            if (d > 1.3) continue;
            if (i.cls === 0) grass++;
            else if (i.cls === 1) reed++;
            else if (i.cls === 2) shrub++;
            else tree++;
          }
          if (tree > 0) continue;
          const score = grass + reed + 2 * shrub;
          if (top === null || score > top.score) top = { mx, mz, grass, shrub, reed, score };
        }
      }
      return top;
    },
    [list, w, h] as const
  )) as { mx: number; mz: number; grass: number; shrub: number; reed: number; score: number } | null;
  return found === null || found.score < 3 ? null : found;
}

/** The densest grass+shrub spot (instances within 1.7 tiles) with open ground for a hull; no trees within 1.7. */
async function findPark(page: Page, list: readonly Inst[], w: number, h: number): Promise<{ x: number; z: number; grass: number; shrub: number } | null> {
  return (await page.evaluate(
    ([inst, width, height]) => {
      const n2 = (window as unknown as { __n2: { open(x: number, z: number): boolean; clear(x: number, z: number, r: number): boolean } }).__n2;
      let top: { x: number; z: number; grass: number; shrub: number; score: number } | null = null;
      for (let x = 9; x <= (width as number) - 9; x++) {
        for (let z = 9; z <= (height as number) - 9; z++) {
          if (!n2.open(x + 0.5, z + 0.5) || !n2.clear(x + 0.5, z + 0.5, 5)) continue;
          let grass = 0;
          let shrub = 0;
          let tree = 0;
          for (const i of inst as { x: number; z: number; cls: number }[]) {
            if (Math.hypot(i.x - (x + 0.5), i.z - (z + 0.5)) > 1.7) continue;
            if (i.cls === 3) tree++;
            else if (i.cls === 2) shrub++;
            else grass++;
          }
          if (tree > 0) continue;
          const score = grass + 2 * shrub;
          if (top === null || score > top.score) top = { x: x + 0.5, z: z + 0.5, grass, shrub, score };
        }
      }
      return top;
    },
    [list, w, h] as const
  )) as { x: number; z: number; grass: number; shrub: number } | null;
}

/** One contact sheet in a page of the SAME browser (canvas text, no font files): rows N1, N1+N2, then their difference x8. */
async function composeSheet(
  browser: Browser,
  title: string,
  colLabels: string[],
  tilesA: string[],
  tilesB: string[],
  cw: number,
  ch: number
): Promise<{ png: Buffer; changed: number[] }> {
  // music-off: exempt -- a blank canvas page that composes the PNG; it never loads the game
  const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
  try {
    const args = JSON.stringify([title, colLabels, tilesA, tilesB, cw, ch]);
    const result = (await page.evaluate(`(async () => {
      const [titleS, cols, a, b, w, h] = ${args};
      const loadImg = (b64) => new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = () => rej(new Error('tile did not decode'));
        im.src = 'data:image/png;base64,' + b64;
      });
      const left = 130, top = 64, gap = 3;
      const nCols = cols.length;
      const canvas = document.createElement('canvas');
      canvas.width = left + nCols * (w + gap);
      canvas.height = top + 3 * (h + gap) + 8;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#101010';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#e8e8e8';
      ctx.font = '600 20px sans-serif';
      ctx.fillText(titleS, 10, 26);
      ctx.font = '14px sans-serif';
      const imgA = await Promise.all(a.map(loadImg));
      const imgB = await Promise.all(b.map(loadImg));
      const tmp = document.createElement('canvas');
      tmp.width = w; tmp.height = h;
      const tctx = tmp.getContext('2d', { willReadFrequently: true });
      const read = (im) => { tctx.drawImage(im, 0, 0); return tctx.getImageData(0, 0, w, h).data; };
      const changed = [];
      for (let c = 0; c < nCols; c++) {
        const x = left + c * (w + gap);
        ctx.fillText(cols[c], x + 4, top - 10);
        ctx.drawImage(imgA[c], x, top);
        ctx.drawImage(imgB[c], x, top + (h + gap));
        const da = read(imgA[c]);
        const db = read(imgB[c]);
        const out = ctx.createImageData(w, h);
        let n = 0;
        for (let i = 0; i < da.length; i += 4) {
          const dv = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
          if (dv >= 16) n++;
          const v = Math.min(255, dv * 8);
          out.data[i] = v; out.data[i + 1] = v; out.data[i + 2] = v; out.data[i + 3] = 255;
        }
        ctx.putImageData(out, x, top + 2 * (h + gap));
        changed.push(n);
      }
      ctx.fillStyle = '#e8e8e8';
      ctx.fillText('N1 only', 8, top + 20);
      ctx.fillText('N1 + N2', 8, top + (h + gap) + 20);
      ctx.fillText('difference x8', 8, top + 2 * (h + gap) + 20);
      return { data: canvas.toDataURL('image/png').split(',')[1], changed };
    })()`)) as { data: string; changed: number[] };
    return { png: Buffer.from(result.data, 'base64'), changed: result.changed };
  } finally {
    await page.close();
  }
}

interface View {
  readonly id: string;
  readonly label: string;
  readonly zoom: number;
  readonly cw: number;
  readonly ch: number;
}

const index: string[] = [];

async function shootFrame(page: Page, x: number, z: number, view: View): Promise<string> {
  await call(page, 'shoot', x, z, view.zoom);
  const buf = await page.screenshot({
    clip: { x: CAPTURE_VIEWPORT.width / 2 - view.cw / 2, y: CAPTURE_VIEWPORT.height / 2 - view.ch / 2, width: view.cw, height: view.ch },
  });
  return buf.toString('base64');
}

async function newPage(browser: Browser, errors: string[], label: string): Promise<Page> {
  const page = await browser.newPage({ viewport: { ...CAPTURE_VIEWPORT }, deviceScaleFactor: 1 });
  await page.addInitScript(musicOffInitScript());
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${label}: ${m.text()}`);
  });
  return page;
}

async function sheetsPhase(browser: Browser, errors: string[]): Promise<void> {
  for (const theme of THEMES) {
    if (!ONLY.includes(theme.id)) continue;
    const page = await newPage(browser, errors, theme.id);
    await boot(page, `?sandbox=${theme.map}`);
    const gl = await glRenderer(page);
    await clean(page);
    const st0 = await call<{ tick: number; w: number; h: number }>(page, 'state');
    const list = await call<Inst[]>(page, 'instances');
    const census = [0, 1, 2, 3].map((c) => list.filter((i) => i.cls === c).length);
    say(`[${theme.id}] ${theme.map} ${st0.w}x${st0.h} gl=${gl} viewport ${CAPTURE_VIEWPORT.width}x${CAPTURE_VIEWPORT.height} dpr 1; start tick ${st0.tick}; foliage by class (grass, reed, shrub, tree): ${census.join(', ')}`);
    index.push(`## ${theme.id} (${theme.map}, ${st0.w}x${st0.h})`, '', `GPU \`${gl}\`; viewport ${CAPTURE_VIEWPORT.width}x${CAPTURE_VIEWPORT.height}, DPR 1; foliage instances by class (grass, reed, shrub, tree): ${census.join(', ')}.`, '');
    const lavi = await call<number>(page, 'lavi');
    const moved = await call<number>(page, 'isolate', lavi);
    say(`  Lavi is entity ${lavi}; ${moved} other units moved to the far corner and halted`);
    // Let the halt land, and the tick counter settle on a multiple of 5 so every clip frame is on a sample tick.
    const base = Math.ceil((st0.tick + 20) / 5) * 5;
    await stepTo(page, base);

    // ---- drive ----
    const drive = await findDrive(page, list, st0.w, st0.h);
    if (!SCENES.includes('drive')) {
      say('  (drive not asked for: --scenes)');
    } else if (drive === null) {
      say(`  (no drive path with undergrowth on ${theme.id}: drive skipped)`);
    } else {
      const sx = drive.mx - 4.3 * D.x;
      const sz = drive.mz - 4.3 * D.z;
      say(`  drive: M (${drive.mx}, ${drive.mz}); grass ${drive.grass} reed ${drive.reed} shrub ${drive.shrub} within 1.3 tiles of the clip path; start (${sx.toFixed(2)}, ${sz.toFixed(2)})`);
      await call(page, 'place', lavi, sx, sz, DRIVE_TURNS);
      await stepTo(page, base + 1);
      await call(page, 'drive', lavi, drive.mx + 7 * D.x, drive.mz + 7 * D.z);
      // 3 s of driving (the launch and its churn are 3.3 tiles behind the frame), then the clip.
      const t0 = base + 61;
      await stepTo(page, t0);
      const views: View[] = [
        { id: 'close', label: 'close, zoom 2.5', zoom: 2.5, cw: 480, ch: 300 },
        { id: 'mid', label: 'mid, zoom 1.2', zoom: 1.2, cw: 640, ch: 400 },
      ];
      const tiles: Record<string, string[][]> = { close: [[], []], mid: [[], []] };
      const cols: string[] = [];
      const ticks: number[] = [];
      for (let k = 0; k < FRAMES; k++) {
        const target = t0 + k * TICKS_BETWEEN;
        await stepTo(page, target);
        ticks.push(target);
        cols.push(`+${(k * 0.25).toFixed(2)}s`);
        for (let a = 0; a < ARMS.length; a++) {
          await call(page, 'arm', a === 1);
          for (const v of views) tiles[v.id][a].push(await shootFrame(page, drive.mx, drive.mz, v));
        }
        const s = await call<{ tick: number; n: number; a: number[] }>(page, 'state');
        if (s.tick !== target) throw new Error(`${theme.id}/drive: tick ${s.tick} != ${target}`);
        if (k === 0 || k === FRAMES - 1) say(`  drive frame ${k}: tick ${s.tick}, ${s.n} disturber(s), wake head (${s.a[0].toFixed(2)}, ${s.a[1].toFixed(2)}) tail (${s.a[2].toFixed(2)}, ${s.a[3].toFixed(2)})`);
      }
      await call(page, 'arm', true);
      for (const v of views) {
        const title = `${theme.id} / ${theme.map} / Lavi drives through grass and bushes / ${v.label} / sim ticks ${ticks[0]}..${ticks[FRAMES - 1]} / ${gl.replace(/ANGLE \(|\)$/g, '')}`;
        const { png, changed } = await composeSheet(browser, title, cols, tiles[v.id][0], tiles[v.id][1], v.cw, v.ch);
        const file = `${theme.id}-drive-${v.id}.png`;
        writeFileSync(join(OUT, file), png);
        say(`  -> ${file}: pixels differing by 16/255 or more, N1+N2 vs N1, per frame (of ${v.cw * v.ch}): ${changed.join(' ')}`);
        index.push(`### Drive, ${v.label}`, '', `![${theme.id} drive ${v.id}](${file})`, '',
          `The Lavi drives screen-right at 1.1 tiles/s through ${drive.grass} grass, ${drive.reed} reed and ${drive.shrub} shrub instances (none of them trees) around (${drive.mx}, ${drive.mz}). Sim ticks ${ticks[0]} to ${ticks[FRAMES - 1]}, 0.25 s apart. Pixels that differ by 16/255 or more between the rows, per frame (of ${v.cw * v.ch}): ${changed.join(', ')}.`, '');
      }
    }

    // ---- parked ----
    const park = await findPark(page, list, st0.w, st0.h);
    const pview: View = { id: 'close', label: 'close, zoom 2.0', zoom: 2.0, cw: 560, ch: 350 };
    if (park === null) {
      say(`  (no clear grass cluster on ${theme.id}: parked skipped)`);
    } else {
      say(`  parked: at (${park.x}, ${park.z}); grass ${park.grass} shrub ${park.shrub} within 1.7 tiles`);
      themePark.set(theme.id, park);
      if (!SCENES.includes('parked')) {
        await page.close();
        continue;
      }
      let cur = (await call<{ tick: number }>(page, 'state')).tick;
      await call(page, 'place', lavi, park.x, park.z, DRIVE_TURNS);
      cur = await stepTo(page, cur + 1);
      // Parked 4 s before the clip: a disc, the ring all one place.
      const t0 = Math.ceil((cur + 80) / 5) * 5;
      await stepTo(page, t0);
      const tilesP: string[][] = [[], []];
      const cols: string[] = [];
      for (let k = 0; k < FRAMES; k++) {
        await stepTo(page, t0 + k * TICKS_BETWEEN);
        cols.push(`+${(k * 0.25).toFixed(2)}s`);
        for (let a = 0; a < ARMS.length; a++) {
          await call(page, 'arm', a === 1);
          tilesP[a].push(await shootFrame(page, park.x, park.z, pview));
        }
      }
      await call(page, 'arm', true);
      const title = `${theme.id} / ${theme.map} / Lavi parked in grass / ${pview.label} / sim ticks ${t0}..${t0 + (FRAMES - 1) * TICKS_BETWEEN} / ${gl.replace(/ANGLE \(|\)$/g, '')}`;
      const { png, changed } = await composeSheet(browser, title, cols, tilesP[0], tilesP[1], pview.cw, pview.ch);
      const file = `${theme.id}-parked.png`;
      writeFileSync(join(OUT, file), png);
      say(`  -> ${file}: differing pixels per frame (of ${pview.cw * pview.ch}): ${changed.join(' ')}`);
      index.push('### Parked in pressed grass', '', `![${theme.id} parked](${file})`, '',
        `The Lavi has stood at (${park.x}, ${park.z}) for 4 s: ${park.grass} grass and ${park.shrub} shrub instances within 1.7 tiles. A disc of its footprint radius (1.35 tiles; full push inside 0.55 of it, gone at 1.25). Ticks ${t0} to ${t0 + (FRAMES - 1) * TICKS_BETWEEN}. Differing pixels per frame (of ${pview.cw * pview.ch}): ${changed.join(', ')}.`, '');
      themePark.set(theme.id, park);
    }
    await page.close();
  }

  // ---- pivot: two page loads per theme, the same absolute ticks ----
  for (const theme of THEMES) {
    if (!ONLY.includes(theme.id)) continue;
    const park = themePark.get(theme.id);
    if (park === undefined || !SCENES.includes('pivot')) continue;
    const pview: View = { id: 'close', label: 'close, zoom 2.0', zoom: 2.0, cw: 560, ch: 350 };
    const tilesPiv: string[][] = [[], []];
    const cols: string[] = [];
    let gl = '';
    let t0 = 0;
    let pivotStats = '';
    for (let a = 0; a < ARMS.length; a++) {
      const page = await newPage(browser, errors, `${theme.id}-pivot-${a}`);
      await boot(page, `?sandbox=${theme.map}`);
      gl = await glRenderer(page);
      await clean(page);
      const lavi = await call<number>(page, 'lavi');
      await call(page, 'isolate', lavi);
      // The same absolute tick in both loads: the sim is deterministic, so the worlds are identical.
      await stepTo(page, 400);
      await call(page, 'place', lavi, park.x, park.z, DRIVE_TURNS);
      await stepTo(page, 401);
      // N1 only: the churn decal and the clods patched out and the bend at 0. N1 + N2: the shipped build.
      await call(page, 'arm', a === 1);
      await page.evaluate((n2) => {
        const p = (window as unknown as { __n2: { patch: { dropChurn: boolean; dropClods: boolean } } }).__n2.patch;
        p.dropChurn = !n2;
        p.dropClods = !n2;
      }, a === 1);
      // Stand 10 ticks (the launch gate is not relevant to a pivot), then turn 0.012 turn a tick for 35 ticks.
      t0 = 410;
      await stepTo(page, t0);
      let turns = DRIVE_TURNS;
      for (let k = 0; k < FRAMES; k++) {
        const target = t0 + k * TICKS_BETWEEN;
        while ((await call<{ tick: number }>(page, 'state')).tick < target) {
          turns += 0.012;
          await call(page, 'setFacing', lavi, turns % 1);
          await stepTo(page, (await call<{ tick: number }>(page, 'state')).tick + 1);
        }
        if (a === 0) cols.push(`+${(k * 0.25).toFixed(2)}s`);
        tilesPiv[a].push(await shootFrame(page, park.x, park.z, pview));
      }
      const fin = await call<{ tick: number }>(page, 'state');
      pivotStats += ` ${ARMS[a]}: ended tick ${fin.tick};`;
      await page.close();
    }
    const title = `${theme.id} / ${theme.map} / Lavi pivots on the spot / ${pview.label} / sim ticks ${t0}..${t0 + (FRAMES - 1) * TICKS_BETWEEN} / ${gl.replace(/ANGLE \(|\)$/g, '')}`;
    const { png, changed } = await composeSheet(browser, title, cols, tilesPiv[0], tilesPiv[1], pview.cw, pview.ch);
    const file = `${theme.id}-pivot.png`;
    writeFileSync(join(OUT, file), png);
    say(`  [${theme.id}] -> ${file}: differing pixels per frame (of ${pview.cw * pview.ch}): ${changed.join(' ')};${pivotStats}`);
    index.push(`### ${theme.id}: pivot on the spot, churn and clods`, '', `![${theme.id} pivot](${file})`, '',
      `The Lavi at (${park.x}, ${park.z}) turns on the spot at 0.012 turn a tick (0.24 turn/s, written per tick by the instrument): the first scuff after 4 ticks, then one every 10, a churn decal under each track (fading over 120 s) and a clod burst out of each flank. The two rows are two page loads stepped to the same absolute tick (the sim is deterministic), the N1 row with the bend, the churn decal and the clods switched off. Differing pixels per frame (of ${pview.cw * pview.ch}): ${changed.join(', ')}.`, '');
  }
}
const themePark = new Map<string, { x: number; z: number; grass: number; shrub: number }>();

// --- the signal phase --------------------------------------------------------------------------------------

async function signalPhase(browser: Browser, errors: string[]): Promise<void> {
  const scenario = SCENARIOS.find((s) => s.id === 'vehicle');
  if (!scenario) throw new Error('no vehicle scenario');
  const spec = specFor('vehicle');
  const runs = 3;
  const readings: { px: number; mean: number }[] = [];
  const dir = join(OUT, 'signal');
  mkdirSync(dir, { recursive: true });
  say(`[signal] scenario vehicle (${scenario.sandboxMap}, tick ${scenario.targetTick}), layer disturb, ${runs} fresh page loads`);
  for (let r = 0; r < runs; r++) {
    const page = await newPage(browser, errors, `signal-${r}`);
    const png = join(dir, `r${r + 1}-current.png`);
    const res = await capture(page, threeUrl(PORT, scenario), captureScript(scenario), png, `nature-signal/${r}`, scenario.mission !== undefined);
    const shown = join(dir, `r${r + 1}-shown.png`);
    await rephotograph(page, REPAINT_SCRIPT, shown, res.rect);
    const control = computeDiff(png, shown, { outDir: dir, diffFileName: `r${r + 1}-control.png`, threshold: 0.1, region: spec?.region ?? undefined });
    const hidden = join(dir, `r${r + 1}-hidden.png`);
    await rephotograph(page, layerToggleScript('disturb', false), hidden, res.rect);
    await page.evaluate(layerToggleScript('disturb', true));
    const d = computeDiff(shown, hidden, { outDir: dir, diffFileName: `r${r + 1}-diff.png`, threshold: 0.1, region: spec?.region ?? undefined });
    const n = await page.evaluate(() => {
      const w = window as unknown as { __lions: { renderer: { disturbU: { n: { value: number } }; snapshottedCount: number } } };
      return { n: w.__lions.renderer.disturbU.n.value, snap: w.__lions.renderer.snapshottedCount };
    });
    say(`[signal] r${r + 1}: repaint control ${control.diffPixels} px / ${control.meanAbsChannelDelta.toFixed(4)}; hiding disturb moves ${d.diffPixels} px / ${d.meanAbsChannelDelta.toFixed(4)} (${n.n} disturber slots live at the shown frame, ${n.snap} entities)`);
    readings.push({ px: d.diffPixels, mean: d.meanAbsChannelDelta });
    await page.close();
  }
  const minPx = Math.min(...readings.map((x) => x.px));
  const minMean = Math.min(...readings.map((x) => x.mean));
  say(`[signal] smallest of ${runs}: ${minPx} px / ${minMean.toFixed(4)}; a third, rounded down: ${Math.floor(minPx / 3)} px / ${(Math.floor((minMean / 3) * 10000) / 10000).toFixed(4)}`);
}

// --- the cost phase ----------------------------------------------------------------------------------------

type Preset = 'high' | 'medium' | 'low';

async function costPhase(browser: Browser, errors: string[]): Promise<void> {
  const map = 'wadi_tarfan_l';
  for (const preset of ['high', 'medium', 'low'] as Preset[]) {
    // One boot per preset: the preset applies at boot. deviceScaleFactor 2, 1440x900 css: render-frame-cost's own conditions.
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    await page.addInitScript(musicOffInitScript({}, { quality: preset }));
    page.on('pageerror', (e) => errors.push(`cost-${preset}: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`cost-${preset}: ${m.text()}`);
    });
    await page.goto(`http://localhost:${PORT}/?sandbox=${map}`, { waitUntil: 'load', timeout: 120_000 });
    await page.waitForFunction(() => !!(window as unknown as { __lions?: { renderer?: unknown } }).__lions?.renderer, null, { timeout: 120_000 });
    await page.waitForTimeout(5000);
    await page.evaluate(`(async () => { ${FREEZE_FRAME_LOOP_STATEMENTS} })()`);
    const gl = await glRenderer(page);
    const info = await page.evaluate(`(() => {
      const L = window.__lions; const sim = L.sim; const r = L.renderer; const Q = 65536;
      const types = []; for (let t = 0; t < sim.unitTypes.length; t++) types.push(sim.unitTypes[t].id);
      const hull = types.indexOf('mbt_lavi'); const foot = types.indexOf('inf_squad');
      // The camera's centre: the map's middle. 24 hulls on a 6 x 4 lattice 2 tiles apart round it, 130 riflemen scattered, then moving.
      const cx = sim.width / 2, cz = sim.height / 2;
      const ids = [];
      for (let k = 0; k < 24; k++) ids.push(sim.spawn(hull, 0, Math.round((cx - 5 + (k % 6) * 2) * Q), Math.round((cz - 3 + Math.floor(k / 6) * 2) * Q)));
      let men = 0;
      for (let k = 0; sim.entityCount < sim.capacity - 2 && k < 400; k++) {
        const x = cx - 14 + ((k * 37) % 29), z = cz - 9 + ((k * 53) % 19);
        if (sim.blocked[Math.floor(z) * sim.width + Math.floor(x)] !== 0) continue;
        sim.spawn(foot, 0, Math.round((x + 0.5) * Q), Math.round((z + 0.5) * Q)); men++;
      }
      sim.queueCommand({ kind: 'move', ids, x: Math.round((cx + 10) * Q), y: Math.round((cz + 2) * Q) });
      L.step(80);
      let live = 0; for (let i = 0; i < sim.entityCount; i++) if (sim.state.alive[i]) live++;
      return { w: sim.width, h: sim.height, cap: sim.capacity, live, hulls: ids.length, men, buf: r.canvas.width + 'x' + r.canvas.height, cx, cz };
    })()`) as { w: number; h: number; cap: number; live: number; hulls: number; men: number; buf: string; cx: number; cz: number };
    say(`[cost ${preset}] ${map} ${info.w}x${info.h}; ${info.live} living units (24 hulls driving, ${info.men} riflemen; the sandbox sim's capacity is ${info.cap}); gl=${gl}; drawing buffer ${info.buf} (css 1440x900, dpr 2); load ${load()}`);
    const rows: string[] = [];
    for (const zoom of [0.5, 1]) {
      const sample = (): Promise<{ cpuMed: number; cpuP95: number; gpuMed: number; gpuP95: number; calls: number; programs: number; n: number }> =>
        page.evaluate(
          ([cx, cz, z]) => {
            const L = (window as unknown as { __lions: { renderer: Record<string, unknown> } }).__lions;
            const r = L.renderer as unknown as {
              canvas: HTMLCanvasElement; camera: { x: number; y: number; zoom: number }; frame(a: number, dt: number): void;
              disturbU: { n: { value: number } }; renderer: { info: { autoReset: boolean; reset(): void; render: { calls: number }; programs?: unknown[] } };
            };
            r.camera.x = cx as number; r.camera.y = cz as number; r.camera.zoom = z as number;
            for (let i = 0; i < 30; i++) r.frame(1, 16);
            const info = r.renderer.info;
            const auto = info.autoReset; info.autoReset = false; info.reset(); r.frame(1, 16);
            const calls = info.render.calls; const programs = info.programs?.length ?? -1; info.autoReset = auto;
            const gl2 = r.canvas.getContext('webgl2');
            if (!gl2 || gl2.getContextAttributes()?.stencil !== true) throw new Error("not the renderer own context");
            const cpu: number[] = []; const wall: number[] = [];
            for (let i = 0; i < 240; i++) { const t0 = performance.now(); r.frame(1, 16); cpu.push(performance.now() - t0); }
            gl2.finish();
            for (let i = 0; i < 120; i++) { const t0 = performance.now(); r.frame(1, 16); gl2.finish(); wall.push(performance.now() - t0); }
            cpu.sort((a, b) => a - b); wall.sort((a, b) => a - b);
            return { cpuMed: cpu[120], cpuP95: cpu[228], gpuMed: wall[60], gpuP95: wall[114], calls, programs, n: r.disturbU.n.value };
          },
          [info.cx, info.cz, zoom] as const
        );
      const set = async (on: boolean, slots?: number): Promise<void> => {
        await page.evaluate(([v, s]) => {
          const r = (window as unknown as { __lions: { renderer: { setDebugLayerVisible(n: string, v: boolean): number; opts: { quality?: Record<string, unknown> } } } }).__lions.renderer;
          r.setDebugLayerVisible('disturb', v as boolean);
          if (s !== undefined) {
            const q = r.opts.quality ?? {};
            r.opts.quality = { ...q, nature: { wakes: true, foot: true, ...((q.nature as Record<string, unknown>) ?? {}), slots: s } };
          }
        }, [on, slots] as const);
      };
      // Interleaved A B A B A B so a drifting machine hits both arms alike.
      const A: Awaited<ReturnType<typeof sample>>[] = [];
      const B: Awaited<ReturnType<typeof sample>>[] = [];
      for (let round = 0; round < 3; round++) {
        await set(false);
        A.push(await sample());
        await set(true);
        B.push(await sample());
      }
      const med = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
      const f = (xs: Awaited<ReturnType<typeof sample>>[], k: 'cpuMed' | 'cpuP95' | 'gpuMed' | 'gpuP95'): number => med(xs.map((x) => x[k]));
      const line = `z${zoom}: off gpu p95 ${f(A, 'gpuP95').toFixed(2)} / on ${f(B, 'gpuP95').toFixed(2)} -> delta ${(f(B, 'gpuP95') - f(A, 'gpuP95')).toFixed(2)} ms; gpu median ${f(A, 'gpuMed').toFixed(2)} / ${f(B, 'gpuMed').toFixed(2)}; cpu median ${f(A, 'cpuMed').toFixed(2)} / ${f(B, 'cpuMed').toFixed(2)}; cpu p95 ${f(A, 'cpuP95').toFixed(2)} / ${f(B, 'cpuP95').toFixed(2)}; draw calls ${A[0].calls} / ${B[0].calls}; programs ${A[0].programs} / ${B[0].programs}; disturber slots live ${B[0].n}; rounds off ${A.map((x) => x.gpuP95.toFixed(1)).join(',')} on ${B.map((x) => x.gpuP95.toFixed(1)).join(',')}`;
      say(`[cost ${preset}] ${line}`);
      rows.push(`| ${preset} | ${zoom} | ${f(A, 'gpuP95').toFixed(2)} | ${f(B, 'gpuP95').toFixed(2)} | ${(f(B, 'gpuP95') - f(A, 'gpuP95')).toFixed(2)} | ${f(A, 'cpuMed').toFixed(2)} | ${f(B, 'cpuMed').toFixed(2)} | ${A[0].calls} / ${B[0].calls} | ${A[0].programs} / ${B[0].programs} | ${B[0].n} |`);
      // The ladder on this page: each rung against the same off arm.
      for (const rung of [24, 16, 8, 0]) {
        await set(true, rung);
        const Bs: Awaited<ReturnType<typeof sample>>[] = [];
        const As: Awaited<ReturnType<typeof sample>>[] = [];
        for (let round = 0; round < 2; round++) {
          await set(false, rung);
          As.push(await sample());
          await set(true, rung);
          Bs.push(await sample());
        }
        say(`[cost ${preset}]   ladder z${zoom} slots ${rung}: gpu p95 off ${f(As, 'gpuP95').toFixed(2)} on ${f(Bs, 'gpuP95').toFixed(2)} delta ${(f(Bs, 'gpuP95') - f(As, 'gpuP95')).toFixed(2)} ms (live ${Bs[0].n})`);
      }
      await set(true, preset === 'high' ? 24 : preset === 'medium' ? 16 : 8);
    }
    costRows.push(...rows);
    await page.close();
  }
  say(`[cost] load average at end: ${load()}`);
}
const costRows: string[] = [];

// --- main ----------------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  say(`load average at start: ${load()}`);
  const server = await ensureDevServer(PORT, ROOT, TAG);
  const stop = devServerStopper(server, TAG);
  const browser = await chromium.launch({ headless: true, args: gpuLaunchArgs('metal') });
  const errors: string[] = [];
  try {
    if (PHASES.includes('sheets')) await sheetsPhase(browser, errors);
    if (PHASES.includes('signal')) await signalPhase(browser, errors);
    if (PHASES.includes('cost')) await costPhase(browser, errors);
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
    '# N2 vehicles bend the vegetation: mock clip sheets (GH-984)',
    '',
    'Each sheet is one clip: 8 frames 0.25 s (5 sim ticks) apart at fixed ticks. Rows: **N1 only** (the wind, as merged in PR 988), **N1 + N2** (this branch), and the difference between them, `|N1+N2 - N1|` x8 white on black, so a lean of a pixel or two is readable.',
    '',
    '- The Lavi is alone on the map (every other unit moved to a far corner and halted by the instrument); fog, overlays and the HUD are hidden.',
    '- **N1 only** is the shipped build with the `disturb` amplitude at 0 (and, for the pivot, the churn decal and the clods patched out): the wind and nothing else.',
    '- The bend: each blade or bush is rotated about its foot away from the nearest point of the hull\'s capsule (head = where the hull is now, tail = where it was 1.5 s ago), a grass blade flattening to at most 0.8 of its height, a shrub by at most 0.35; full push inside 0.55 of the hull\'s footprint radius, gone at 1.25; it springs back in the wake (1.1 Hz, damping 0.45, about 20% overshoot).',
    '- Trees shiver by at most 0.01 of their height (cap 0.01); reeds flatten to 0.7. These two are mine.',
    '- Mock instruments, stated: the Lavi is placed by writing `posX`/`posY`/`facing`; the drive uses the sim\'s own `move` command and its ticks; the pivot writes the heading per tick (the sim leaves a stopped hull\'s heading alone); the arms are switched by the `disturb` amplitude and two patches on the renderer instance. The wake ring, the uniforms and the shader are the shipped ones.',
    '',
    ...lines.filter((l) => l.startsWith('[')).map((l) => `- ${l}`),
    '',
  ];
  if (PHASES.includes('sheets')) writeFileSync(join(OUT, 'index.md'), [...head, ...index].join('\n'));
  if (PHASES.includes('cost') || PHASES.includes('signal')) {
    writeFileSync(
      join(OUT, 'measurements.md'),
      [
        '# N2 measurements (GH-984)',
        '',
        ...(costRows.length
          ? ['| preset | zoom | gpu p95 off | gpu p95 on | delta ms | cpu median off | cpu median on | draw calls off / on | programs off / on | slots live |', '|---|---|---|---|---|---|---|---|---|---|', ...costRows, '']
          : []),
        '```',
        ...lines,
        '```',
        '',
      ].join('\n')
    );
  }
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
