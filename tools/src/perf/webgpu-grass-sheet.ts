/**
 * GH-1167 S7 (design 2026-11-11, section 5.2): the 3D grass close-up and clip sheets, on the NODE path (G: WebGPU on Metal), driven through the
 * real app (`?sandbox=<map>&gpu=webgpu`), never through a harness page. REPORT-ONLY, no gate: the lead looks at the pictures.
 *
 *   pnpm --filter @lions/tools exec tsx src/perf/webgpu-grass-sheet.ts --out-dir=<dir> [--port=5215] [--map=wadi_halam_basin]
 *       [--max-load=4] [--wait-quiet=0]
 *
 * One G page (1440x900 CSS, DPR 2, quality high, music off, the HUD hidden, the frame loop frozen at boot), photographed by copying the canvas in
 * the SAME task as its render (a WebGPU canvas screenshot reads black). Every picture is a grass ON / grass OFF pair at the SAME sim tick (the
 * `grass-field` layer, so the off frame is the node boot with the field's sward and tufts replaced by nothing: ground only, not today's grass):
 *   - close-up z2.5 on the densest meadow, a second meadow, and a patchy spot (the field's own per-tile clump counts pick the spots);
 *   - play zoom z1, z1.5 and the whole-view z0.5;
 *   - WIND: 8 frames 0.25 s apart at z2.5, three rows at the same tick each: full motion (the per-blade flutter on), the OS reduced-motion
 *     preference (the reduced sway, flutter x mode 0), and the `wind` layer hidden (amp 0: static). The flutter alone has no switch;
 *   - a Lavi driving through (the sim's own `move`), a hovering helicopter, and a squad in grass (standing, then under fire), selected so the ring draws.
 * REFUSES (exit 2): a backend that is not node-webgpu on Metal, no visible grass mesh, a console GPUValidationError, a pair of frames that are
 * byte-identical (the toggle did nothing), a blank frame. The palette side of the figure-ground check (grass keys against the KDF uniform) is printed.
 */
import { chromium, type Browser, type Page } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { devServerStopper, ensureDevServer } from '../golden-diff/browser';
import { BOOT_SETTLE_SCRIPT, bootFreezeScriptFor, FREEZE_FRAME_LOOP_SCRIPT, HIDE_ALERT_FEED_STATEMENTS } from '../golden-diff/capture-protocol';
import { gpuLaunchArgs } from '../ui-review/gpu';
import { musicOffInitScript } from '../ui-review/music-off';
import { claimPort } from '../ui-review/port';
import { loadRefusal, MAX_LOADAVG_1M } from './webgpu-abba';
import { deltaE2000, linearHex } from '../delta-e2000';
import palette from '../../../data/palette.json';

const args = process.argv.slice(2);
const arg = (n: string, d: string): string => (args.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).slice(n.length + 3);
const TOOLS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ROOT = path.resolve(TOOLS, '..');
const OUT = path.resolve(arg('out-dir', ''));
const MAP = arg('map', 'wadi_halam_basin');
const MAX_LOAD = Number(arg('max-load', String(MAX_LOADAVG_1M)));
const WAIT_QUIET = Number(arg('wait-quiet', '0'));
const VIEW = { width: 1440, height: 900 };
const DPR = 2;
const TICKS_BETWEEN = 5;
const FRAMES = 8;

function refuse(msg: string): never {
  console.error(`webgpu-grass-sheet: REFUSED: ${msg}`);
  process.exit(2);
}
if (args.find((a) => a.startsWith('--out-dir=')) === undefined) refuse('--out-dir=<dir> is required');
mkdirSync(OUT, { recursive: true });

async function untilQuiet(): Promise<number> {
  const deadline = Date.now() + WAIT_QUIET * 60_000;
  for (;;) {
    const load = os.loadavg()[0] as number;
    const lr = loadRefusal(load, MAX_LOAD);
    if (lr === null) return load;
    if (Date.now() >= deadline) refuse(lr);
    await new Promise((res) => setTimeout(res, 5000));
  }
}

/** The in-page instruments: the field's clumps, spot picking, the photograph. Plain JS in a string (an injected script). */
const HELPERS = `(() => {
  const L = window.__lions;
  const R = L.renderer;
  const sim = L.sim;
  const Q = 65536;
  const q = (v) => Math.round(v * Q);
  const gs = {};
  gs.meshes = () => {
    const out = [];
    const walk = (o, pv) => {
      const v = pv && o.visible;
      if (v && o.isMesh === true && o.name.startsWith('rl-grass-field')) out.push(o);
      for (const c of o.children) walk(c, v);
    };
    walk(R.scene, true);
    return out;
  };
  gs.clumps = () => {
    const pts = [];
    for (const m of gs.meshes()) {
      m.updateWorldMatrix(true, false);
      const e = m.matrixWorld.elements;
      const a = m.instanceMatrix.array;
      for (let i = 0; i < m.count; i++) {
        const x = a[i * 16 + 12], y = a[i * 16 + 13], z = a[i * 16 + 14];
        pts.push([e[0] * x + e[4] * y + e[8] * z + e[12], e[2] * x + e[6] * y + e[10] * z + e[14]]);
      }
    }
    return pts;
  };
  /** The field's own per-tile clump counts, and three spots from them: the densest WxW window, the densest one far from it, a median one. */
  gs.spots = (W) => {
    const pts = gs.clumps();
    const grid = new Map();
    let maxX = 0, maxZ = 0;
    for (const p of pts) {
      const tx = Math.floor(p[0]), tz = Math.floor(p[1]);
      grid.set(tx + ',' + tz, (grid.get(tx + ',' + tz) || 0) + 1);
      maxX = Math.max(maxX, tx); maxZ = Math.max(maxZ, tz);
    }
    const wins = [];
    for (let x = 4; x <= maxX - W - 3; x++) for (let z = 4; z <= maxZ - W - 3; z++) {
      let s = 0, filled = 0;
      for (let i = 0; i < W; i++) for (let j = 0; j < W; j++) { const c = grid.get((x + i) + ',' + (z + j)) || 0; s += c; if (c > 0) filled++; }
      wins.push({ x: x + W / 2, z: z + W / 2, sum: s, filled });
    }
    // Open ground to stand a hull on: every tile of the window carries clumps.
    const full = wins.filter((w2) => w2.filled === W * W).sort((a, b) => b.sum - a.sum);
    const A = full[0];
    const B = full.find((s) => Math.hypot(s.x - A.x, s.z - A.z) >= 12);
    const sorted = full.slice().sort((a, b) => a.sum - b.sum);
    const C = sorted[Math.floor(sorted.length / 2)];
    return { A, B, C, tiles: grid.size, clumps: pts.length, perTile: pts.length / grid.size, windows: full.length };
  };
  gs.hudOff = () => {
    const canvas = document.querySelector('canvas');
    for (const el of Array.from(document.body.children)) { if (canvas && el.contains(canvas)) continue; el.style.display = 'none'; }
  };
  gs.cam = (x, z, zoom) => { R.camera.x = x; R.camera.y = z; R.camera.zoom = zoom; };
  gs.typeIndex = (id) => { for (let t = 0; t < sim.unitTypes.length; t++) if (sim.unitTypes[t].id === id) return t; return -1; };
  gs.spawn = (id, side, x, z) => { const t = gs.typeIndex(id); if (t < 0) throw new Error('no unit type ' + id); const e = sim.spawn(t, side, q(x), q(z)); sim.queueCommand({ kind: 'halt', ids: [e] }); return e; };
  gs.move = (ids, x, z) => sim.queueCommand({ kind: 'move', ids, x: q(x), y: q(z) });
  gs.attackMove = (ids, x, z) => sim.queueCommand({ kind: 'attackMove', ids, x: q(x), y: q(z) });
  gs.step = (n) => L.step(n);
  gs.tick = () => sim.tickCount;
  gs.poseOf = (ids) => ids.map((i) => ({ id: i, alive: sim.state.alive[i], pinned: sim.state.pinned ? sim.state.pinned[i] : -1, supp: sim.state.suppression ? sim.state.suppression[i] / Q : -1, x: sim.state.posX[i] / Q, z: sim.state.posY[i] / Q }));
  gs.layer = (name, v) => R.setDebugLayerVisible(name, v);
  /** One zero-time repaint, copied out of the canvas in the same task as its render, cropped (device px) around the canvas centre. */
  gs.grab = async (cw, ch) => {
    await new Promise(function (r) { window.requestAnimationFrame(function () { r(); }); });
    R.frame(1, 0);
    const dpr = window.devicePixelRatio;
    const c = document.createElement('canvas');
    const w = Math.round(cw * dpr), h = Math.round(ch * dpr);
    c.width = w; c.height = h;
    const sx = Math.round((R.canvas.width - w) / 2), sy = Math.round((R.canvas.height - h) / 2);
    c.getContext('2d').drawImage(R.canvas, sx, sy, w, h, 0, 0, w, h);
    await R.whenGpuIdle();
    return c.toDataURL('image/png').split(',')[1];
  };
  window.__gs = gs;
  return true;
})()`;

interface Spot {
  x: number;
  z: number;
  sum: number;
  filled: number;
}
interface Spots {
  A: Spot;
  B: Spot | undefined;
  C: Spot;
  tiles: number;
  clumps: number;
  perTile: number;
  windows: number;
}

const files: { name: string; file: string; note: string }[] = [];
const notes: string[] = [];
const say = (s: string): void => {
  console.log(s);
  notes.push(s);
};
const errors: string[] = [];

const call = async <T>(page: Page, fn: string, ...a: unknown[]): Promise<T> => (await page.evaluate(`window.__gs.${fn}(${a.map((v) => JSON.stringify(v)).join(',')})`)) as T;

/** A section that may fail on the page (a render error is a FINDING, recorded in the README, not a reason to lose the stills already taken). */
const failures: string[] = [];
async function attempt(label: string, fn: () => Promise<void>): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (e) {
    const m = (e as Error).message.split('\n')[0]?.slice(0, 300) ?? String(e);
    failures.push(`${label}: ${m}`);
    say(`FAILED ${label}: ${m}`);
    return false;
  }
}

function gitSha(): string {
  try {
    return execFileSync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD']).toString().trim();
  } catch {
    return 'unknown';
  }
}

const shaOf = (b: Buffer): string => createHash('sha1').update(b).digest('hex').slice(0, 10);

function checkFrame(file: string, png: Buffer): void {
  const p = PNG.sync.read(png);
  let lo = 255;
  let hi = 0;
  for (let i = 0; i < p.data.length; i += 4 * 97) {
    const v = (p.data[i] as number) + (p.data[i + 1] as number) + (p.data[i + 2] as number);
    lo = Math.min(lo, v / 3);
    hi = Math.max(hi, v / 3);
  }
  if (hi - lo < 12) refuse(`${file}: the frame is blank or flat (range ${lo.toFixed(0)}..${hi.toFixed(0)})`);
}

async function shoot(page: Page, name: string, cw: number, ch: number): Promise<Buffer> {
  const b64 = await call<string>(page, 'grab', cw, ch);
  const png = Buffer.from(b64, 'base64');
  const file = path.join(OUT, `${name}.png`);
  writeFileSync(file, png);
  checkFrame(file, png);
  return png;
}

/** A pair at the same tick: grass on, then the layer hidden, then shown again. Refuses a pair of identical frames. */
async function pair(page: Page, name: string, cw: number, ch: number, note: string): Promise<[Buffer, Buffer]> {
  const on = await shoot(page, `${name}-on`, cw, ch);
  await call(page, 'layer', 'grass-field', false);
  const off = await shoot(page, `${name}-off`, cw, ch);
  await call(page, 'layer', 'grass-field', true);
  if (on.equals(off)) refuse(`${name}: the grass-on and grass-off frames are byte-identical: the layer toggled nothing`);
  files.push({ name: `${name}-on`, file: `${name}-on.png`, note }, { name: `${name}-off`, file: `${name}-off.png`, note });
  return [on, off];
}

/** The 3-row clip (rows x 8 columns), as one PNG of an arbitrary list of rows, with a difference-from-column-0 row under each. */
async function composeClip(browser: Browser, title: string, rowLabels: string[], colLabels: string[], rows: Buffer[][], cw: number, ch: number): Promise<{ png: Buffer; motion: number[][] }> {
  // music-off: exempt -- a blank canvas page that composes the PNG; it never loads the game
  const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
  try {
    const payload = JSON.stringify([title, colLabels, rowLabels, rows.map((r) => r.map((b) => b.toString('base64'))), cw, ch]);
    const res = (await page.evaluate(`(async () => {
      const [titleS, cols, rowNames, tileRows, w, h] = ${payload};
      const loadImg = (b64) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('tile did not decode')); im.src = 'data:image/png;base64,' + b64; });
      const left = 170, top = 64, gap = 3;
      const nRows = tileRows.length * 2;
      const canvas = document.createElement('canvas');
      canvas.width = left + cols.length * (w + gap);
      canvas.height = top + nRows * (h + gap) + 8;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#101010'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#e8e8e8'; ctx.font = '600 20px sans-serif'; ctx.fillText(titleS, 10, 26); ctx.font = '14px sans-serif';
      const imgs = [];
      for (const row of tileRows) imgs.push(await Promise.all(row.map(loadImg)));
      const tmp = document.createElement('canvas'); tmp.width = w; tmp.height = h;
      const tctx = tmp.getContext('2d', { willReadFrequently: true });
      for (let c = 0; c < cols.length; c++) ctx.fillText(cols[c], left + c * (w + gap) + 4, top - 10);
      const motion = [];
      for (let r = 0; r < imgs.length; r++) {
        let ref = null; const m = [];
        for (let c = 0; c < cols.length; c++) {
          const x = left + c * (w + gap);
          ctx.drawImage(imgs[r][c], x, top + r * (h + gap), w, h);
          tctx.drawImage(imgs[r][c], 0, 0, w, h);
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
        ctx.fillText(rowNames[r], 8, top + r * (h + gap) + 20);
        ctx.fillText('diff x8 vs col 0', 8, top + (imgs.length + r) * (h + gap) + 20);
        ctx.fillText('(' + rowNames[r] + ')', 8, top + (imgs.length + r) * (h + gap) + 38);
      }
      return { data: canvas.toDataURL('image/png').split(',')[1], motion };
    })()`)) as { data: string; motion: number[][] };
    return { png: Buffer.from(res.data, 'base64'), motion: res.motion };
  } finally {
    await page.close();
  }
}

/** The contact sheet: every on/off still pair side by side, as an HTML page of <img> files screenshotted whole (file URLs, so no 100 MB payload crosses CDP). */
async function composeContact(browser: Browser, pairs: { label: string; on: string; off: string }[]): Promise<Buffer> {
  const html = [
    '<!doctype html><meta charset="utf-8"><body style="margin:0;background:#101010;color:#e8e8e8;font:600 15px sans-serif;width:1292px">',
    ...pairs.map(
      (p) =>
        `<div style="padding:8px 6px 0">${p.label}   (left: grass ON, right: grass OFF)</div><div style="display:flex;gap:6px;padding:4px 6px"><img src="file://${p.on}" width="640"><img src="file://${p.off}" width="640"></div>`
    ),
    '</body>',
  ].join('\n');
  const file = path.join(OUT, 'contact-sheet.html');
  writeFileSync(file, html);
  // music-off: exempt -- a static page of <img> tags that composes the PNG; it never loads the game
  const page = await browser.newPage({ viewport: { width: 1292, height: 800 }, deviceScaleFactor: 1 });
  try {
    await page.goto(`file://${file}`, { waitUntil: 'load' });
    await page.evaluate(() => Promise.all(Array.from(document.images).map((im) => im.decode())));
    return await page.screenshot({ fullPage: true });
  } finally {
    await page.close();
  }
}

async function main(): Promise<void> {
  const port = await claimPort('webgpu-grass-sheet', 'WEBGPU_GRASS_SHEET_PORT', 5215);
  const load0 = await untilQuiet();
  const stop = devServerStopper(await ensureDevServer(port, ROOT, 'webgpu-grass-sheet'), 'webgpu-grass-sheet');
  const browser = await chromium.launch({ headless: true, args: [...gpuLaunchArgs('metal'), '--enable-unsafe-webgpu'] });
  const contact: { label: string; on: string; off: string }[] = [];
  let adapter: string | undefined;
  let kind: string | undefined;
  let glRenderer: string | undefined;
  let startTick: number | undefined;
  try {
    const page = await browser.newPage({ viewport: VIEW, deviceScaleFactor: DPR });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text());
    });
    await page.addInitScript(musicOffInitScript({}, { quality: 'high' }));
    await page.addInitScript('window.__name = (f) => f;');
    await page.addInitScript(bootFreezeScriptFor('webgpu'));
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(`http://localhost:${port}/?sandbox=${MAP}&gpu=webgpu`, { waitUntil: 'load', timeout: 120_000 });
    await page.waitForFunction(() => typeof (window as unknown as { __lions?: unknown }).__lions !== 'undefined', undefined, { timeout: 120_000 });
    await page.evaluate(FREEZE_FRAME_LOOP_SCRIPT);
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(BOOT_SETTLE_SCRIPT);
    await page.evaluate(`(async () => {\n${HIDE_ALERT_FEED_STATEMENTS}\nreturn true;\n})()`);
    await page.evaluate(HELPERS);
    await page.evaluate('window.__gs.hudOff()');
    // The fog of war (the shroud) is hidden for the whole sheet: the spots are far from the sandbox force and would photograph as black. Stated in the README.
    await page.evaluate("window.__lions.renderer.setDebugLayerVisible('fog', false)");
    const info = (await page.evaluate('window.__lions.renderer.backendInfo()')) as { kind: string; adapter: string };
    glRenderer = (await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      return ext ? String(gl?.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
    })) as string;
    adapter = info.adapter;
    kind = info.kind;
    if (kind !== 'node-webgpu') refuse(`backendInfo().kind is "${kind}", expected "node-webgpu" (a fallback is evidence about the fallback)`);
    if (!/metal/i.test(adapter) || /swiftshader/i.test(adapter)) refuse(`the adapter is "${adapter}", not hardware Metal`);
    const nMeshes = (await page.evaluate('window.__gs.meshes().length')) as number;
    if (nMeshes === 0) refuse('no visible rl-grass-field mesh after boot: the field was not built (a fallback photographs the OLD grass)');
    startTick = await call<number>(page, 'tick');
    say(`backend ${kind} on "${adapter}" (WebGL probe: ${glRenderer}); ${nMeshes} visible grass meshes; start tick ${startTick}`);
    const spots = await call<Spots>(page, 'spots', 5);
    say(`field: ${spots.clumps} clumps on ${spots.tiles} tiles (${spots.perTile.toFixed(2)} per tile with any), ${spots.windows} fully-filled 5x5 windows`);
    const A = spots.A;
    const B = spots.B ?? spots.A;
    const C = spots.C;
    say(`spot A (densest meadow) (${A.x}, ${A.z}) ${A.sum} clumps in 5x5; spot B (${B.x}, ${B.z}) ${B.sum}; spot C (median) (${C.x}, ${C.z}) ${C.sum}`);

    // ---- stills -------------------------------------------------------------------------------------------------------------
    const stills: [string, string, Spot, number, number, number][] = [
      ['s1-closeup-A-z2.5', 'close-up z2.5, the densest meadow', A, 2.5, 720, 450],
      ['s2-closeup-B-z2.5', 'close-up z2.5, a second meadow', B, 2.5, 720, 450],
      ['s3-patchy-C-z2.5', 'close-up z2.5, a median-density spot (patch and bare gaps)', C, 2.5, 720, 450],
      ['s4-play-A-z1.5', 'z1.5 on the densest meadow', A, 1.5, 1000, 625],
      ['s5-play-A-z1', 'play zoom z1 (the boot zoom) on the densest meadow', A, 1, 1440, 900],
      ['s6-play-C-z1', 'play zoom z1 on the median spot', C, 1, 1440, 900],
      ['s7-wide-z0.5', 'z0.5 (LOD2), the whole map in view', { x: 24, z: 24, sum: 0, filled: 0 }, 0.5, 1440, 900],
    ];
    for (const [name, label, s, zoom, cw, ch] of stills) {
      await call(page, 'cam', s.x, s.z, zoom);
      const [on, off] = await pair(page, name, cw, ch, label);
      contact.push({ label: `${name}: ${label}`, on: path.join(OUT, `${name}-on.png`), off: path.join(OUT, `${name}-off.png`) });
      say(`${name}: ${label}; on ${shaOf(on)} off ${shaOf(off)}`);
    }

    // ---- wind: 8 frames at z2.5, three rows at the SAME tick ----------------------------------------------------------------
    await call(page, 'cam', A.x, A.z, 2.5);
    const rowsWind: Buffer[][] = [[], [], []];
    const ticks: number[] = [];
    for (let k = 0; k < FRAMES; k++) {
      if (k > 0) await call(page, 'step', TICKS_BETWEEN);
      ticks.push(await call<number>(page, 'tick'));
      rowsWind[0]?.push(await shoot(page, `w-full-${k}`, 480, 300));
      await page.emulateMedia({ reducedMotion: 'reduce' });
      rowsWind[1]?.push(await shoot(page, `w-reduced-${k}`, 480, 300));
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await call(page, 'layer', 'wind', false);
      rowsWind[2]?.push(await shoot(page, `w-static-${k}`, 480, 300));
      await call(page, 'layer', 'wind', true);
    }
    const wind = await composeClip(
      browser,
      `${MAP} / G (node-webgpu on Metal) / z2.5 on spot A (${A.x}, ${A.z}) / 8 frames 0.25 s apart, ticks ${ticks[0]}..${ticks[FRAMES - 1]} / DPR ${DPR}`,
      ['full motion (flutter on)', 'reduced motion (flutter off)', 'wind layer hidden (static)'],
      ticks.map((t) => `tick ${t}`),
      rowsWind,
      480 * DPR,
      300 * DPR
    );
    writeFileSync(path.join(OUT, 'clip-wind.png'), wind.png);
    files.push({ name: 'clip-wind', file: 'clip-wind.png', note: 'wind: three rows at the same ticks, difference rows x8' });
    say(`wind clip: ticks ${ticks.join(',')}; pixels differing >=16/255 from column 0 (full, reduced, static): ${wind.motion.slice(0, 3).map((m) => m.join('/')).join(' | ')}`);
    if (wind.motion[2]?.some((c, i) => i > 0 && c > 0)) say('  note: the static row changed between ticks (the sim moves other things in view, or a clump is not static): see the diff row');

    // ---- a squad in grass: standing, then under fire, selected so the ring draws ---------------------------------------------------
    await attempt('squad', async () => {
      const D = { x: C.x, z: C.z };
      const mine: number[] = [];
      for (let i = 0; i < 3; i++) mine.push(await call<number>(page, 'spawn', 'inf_squad', 0, D.x - 1.2 + i * 1.2, D.z));
      await call(page, 'step', 20);
      await page.evaluate(`window.__lions.sel(${JSON.stringify(mine)})`);
      await call(page, 'cam', D.x, D.z, 2.5);
      await pair(page, 'f1-squad-standing-z2.5', 720, 450, 'a rifle squad x3 standing in grass, selected (ring), z2.5');
      contact.push({ label: 'f1-squad-standing-z2.5: three rifle squads standing in grass, selected', on: path.join(OUT, 'f1-squad-standing-z2.5-on.png'), off: path.join(OUT, 'f1-squad-standing-z2.5-off.png') });
      await call(page, 'cam', D.x, D.z, 1);
      await pair(page, 'f2-squad-standing-z1', 720, 450, 'the same squads at play zoom z1');
      contact.push({ label: 'f2-squad-standing-z1: the same squads at play zoom', on: path.join(OUT, 'f2-squad-standing-z1-on.png'), off: path.join(OUT, 'f2-squad-standing-z1-off.png') });
      // Under fire: a hostile squad 8 tiles east, attack-moving onto them; the three squads stand and fight (they halt-and-fire).
      const foes: number[] = [];
      for (let i = 0; i < 3; i++) foes.push(await call<number>(page, 'spawn', 'sarim_rifles', 1, D.x + 8, D.z - 1.2 + i * 1.2));
      await call(page, 'attackMove', foes, D.x, D.z);
      await call(page, 'attackMove', mine, D.x + 8, D.z);
      await call(page, 'cam', D.x + 2, D.z, 2.5);
      const fightOn: Buffer[] = [];
      const fightOff: Buffer[] = [];
      const fightTicks: number[] = [];
      const fightPoses: string[] = [];
      for (let k = 0; k < FRAMES; k++) {
        await call(page, 'step', 12);
        fightTicks.push(await call<number>(page, 'tick'));
        const ps = await call<{ id: number; alive: number; pinned: number; supp: number }[]>(page, 'poseOf', [...mine, ...foes]);
        fightPoses.push(`tick ${fightTicks[k]}: alive ${ps.filter((p) => p.alive === 1).length}/${ps.length}, pinned ${ps.filter((p) => p.pinned === 1).length}, max suppression ${Math.max(...ps.map((p) => p.supp)).toFixed(2)}`);
        fightOn.push(await shoot(page, `f3-fight-on-${k}`, 720, 450));
        await call(page, 'layer', 'grass-field', false);
        fightOff.push(await shoot(page, `f3-fight-off-${k}`, 720, 450));
        await call(page, 'layer', 'grass-field', true);
      }
      const fight = await composeClip(browser, `${MAP} / z2.5 / three own squads and three hostile squads in grass, firing (kneel / pinned as the sim drives them), ticks ${fightTicks[0]}..${fightTicks[FRAMES - 1]}`, ['grass ON', 'grass OFF'], fightTicks.map((t) => `tick ${t}`), [fightOn, fightOff], 720 * DPR, 450 * DPR);
      writeFileSync(path.join(OUT, 'clip-fight.png'), fight.png);
      files.push({ name: 'clip-fight', file: 'clip-fight.png', note: 'squads fighting in grass (kneel / pinned), on / off' });
      for (const l of fightPoses) say(`  fight ${l}`);
    });

    // ---- a hovering helicopter ---------------------------------------------------------------------------------------------------
    await attempt('heli', async () => {
      const pngsHeli: Buffer[][] = [[], []];
      const heli = await call<number>(page, 'spawn', 'heli_peten', 0, B.x, B.z);
      await call(page, 'step', 60);
      await call(page, 'cam', B.x, B.z, 1.5);
      const heliTicks: number[] = [];
      for (let k = 0; k < FRAMES; k++) {
        if (k > 0) await call(page, 'step', TICKS_BETWEEN);
        heliTicks.push(await call<number>(page, 'tick'));
        pngsHeli[0]?.push(await shoot(page, `heli-on-${k}`, 720, 450));
        await call(page, 'layer', 'grass-field', false);
        pngsHeli[1]?.push(await shoot(page, `heli-off-${k}`, 720, 450));
        await call(page, 'layer', 'grass-field', true);
      }
      const heliPose = await call<unknown[]>(page, 'poseOf', [heli]);
      const heliClip = await composeClip(browser, `${MAP} / z1.5 / a heli_peten hovering over spot B (${B.x}, ${B.z}), ticks ${heliTicks[0]}..${heliTicks[FRAMES - 1]}`, ['grass ON', 'grass OFF'], heliTicks.map((t) => `tick ${t}`), pngsHeli, 720 * DPR, 450 * DPR);
      writeFileSync(path.join(OUT, 'clip-heli.png'), heliClip.png);
      files.push({ name: 'clip-heli', file: 'clip-heli.png', note: 'helicopter hovering over grass, on / off' });
      say(`heli clip: unit ${heli} pose ${JSON.stringify(heliPose[0])}`);
    });

    // ---- the Lavi driving through ----------------------------------------------------------------------------------------------
    // The sandbox force's OWN Lavi (not a spawned one): frame it, tick 20, grab; then drive it with the sim's own `move`.
    await attempt('lavi', async () => {
      const own = (await page.evaluate("window.__lions.units(0).filter((u) => u.type === 'mbt_lavi')")) as { id: number }[];
      const first = own[0];
      if (first === undefined) throw new Error('the sandbox force has no mbt_lavi');
      const lavi = first.id;
      const p0 = (await call<{ x: number; z: number }[]>(page, 'poseOf', [lavi]))[0] as { x: number; z: number };
      await call(page, 'cam', p0.x + 3, p0.z, 1.5);
      await shoot(page, 'lavi-own-parked', 720, 450);
      say(`lavi: the sandbox force's own unit ${lavi} at (${p0.x.toFixed(1)}, ${p0.z.toFixed(1)}), a frame rendered at the start`);
      await call(page, 'step', 20);
      say('lavi: 20 ticks later, a frame rendered');
      await call(page, 'move', [lavi], p0.x + 8, p0.z);
      const pngsLavi: Buffer[][] = [[], []];
      const laviTicks: number[] = [];
      for (let k = 0; k < FRAMES; k++) {
        await call(page, 'step', 10);
        laviTicks.push(await call<number>(page, 'tick'));
        const pk = (await call<{ x: number; z: number }[]>(page, 'poseOf', [lavi]))[0] as { x: number; z: number };
        await call(page, 'cam', pk.x, pk.z, 1.5);
        pngsLavi[0]?.push(await shoot(page, `lavi-on-${k}`, 720, 450));
        await call(page, 'layer', 'grass-field', false);
        pngsLavi[1]?.push(await shoot(page, `lavi-off-${k}`, 720, 450));
        await call(page, 'layer', 'grass-field', true);
      }
      const laviClip = await composeClip(browser, `${MAP} / z1.5 / the force's Lavi driving 8 tiles east (the sim's own move), camera on it, ticks ${laviTicks[0]}..${laviTicks[FRAMES - 1]}`, ['grass ON', 'grass OFF'], laviTicks.map((t) => `tick ${t}`), pngsLavi, 720 * DPR, 450 * DPR);
      writeFileSync(path.join(OUT, 'clip-lavi.png'), laviClip.png);
      files.push({ name: 'clip-lavi', file: 'clip-lavi.png', note: "the sandbox force's Lavi driving, on / off" });
      say(`lavi clip: ticks ${laviTicks.join(',')}`);
    });

    await page.close().catch(() => undefined);
    // ---- the contact sheet --------------------------------------------------------------------------------------------------------
    const sheet = await composeContact(browser, contact);
    writeFileSync(path.join(OUT, 'contact-sheet.png'), sheet);
    files.push({ name: 'contact-sheet', file: 'contact-sheet.png', note: 'every still pair, downscaled' });
  } finally {
    await browser.close();
    stop();
  }

  const bad = errors.filter((l) => /GPUValidationError|Destroyed texture|uploaded again/i.test(l));
  if (bad.length > 0) refuse(`console carries GPU errors: ${bad[0]?.slice(0, 160)}`);
  // The figure-ground side of the palette: the grass keys against the KDF uniform key (the 15.6 floor the wetland used).
  const ramps = (palette as unknown as { ramps: Record<string, { colors: string[] }> }).ramps;
  const olive1 = (ramps.olive as { colors: string[] }).colors[1] as string;
  const dE = (k: string, i: number): string => deltaE2000(linearHex(olive1), linearHex((ramps[k] as { colors: string[] }).colors[i] as string)).toFixed(1);
  const fg = ['grass.4', 'grass.3', 'grass.2', 'grass.1'].map((k) => `${k} ${dE(k.split('.')[0] as string, Number(k.split('.')[1]))}`).join(', ');
  say(`palette figure-ground (CIEDE2000 against olive.1 ${olive1}; floor 15.6): ${fg}`);
  const readme = [
    `# GH-1167 S7: the 3D grass sheet (node path, report-only)`,
    '',
    `- Tree: ${gitSha()} (the working tree this ran from, edits included).`,
    `- Map: \`${MAP}\`, URL \`?sandbox=${MAP}&gpu=webgpu\`, quality high, music off (\`musicOffInitScript\`), the frame loop frozen at boot, the HUD hidden.`,
    `- Backend: ${kind ?? 'n/a'} on adapter "${adapter ?? 'n/a'}" (WebGL probe renderer string: ${glRenderer ?? 'n/a'}).`,
    `- Viewport ${VIEW.width}x${VIEW.height} CSS at DPR ${DPR}; each picture is a crop at NATIVE device pixels (e.g. a 720x450 CSS crop is 1440x900 px). Boot tick ${startTick ?? 'n/a'}.`,
    `- 1-minute load average at start ${load0.toFixed(2)}, at end ${os.loadavg()[0]?.toFixed(2)}; ${os.cpus()[0]?.model ?? ''}.`,
    `- Grass OFF is the \`grass-field\` layer hidden on the same node boot: the field's sward strokes and Meshy tufts are replaced on this path, so off is bare ground, NOT today's grass.`,
    `- Wind clip: row 1 full motion, row 2 \`prefers-reduced-motion: reduce\` (reduced sway, per-blade flutter x mode 0), row 3 the \`wind\` layer hidden (amp 0, static). The flutter alone has no switch.`,
    `- The fog of war (\`fog\` layer) is hidden for every frame, so the spots far from the sandbox force are lit; the shroud's own look is not part of this sheet.`,
    `- Spawned units are the sim's own (\`sim.spawn\` plus \`move\` / \`attackMove\` commands) on a throwaway sandbox; nothing was written to sim state.`,
    '',
    '## Run log',
    '',
    ...notes.map((n) => `- ${n}`),
    '',
    '## Files',
    '',
    ...files.map((f) => `- \`${f.file}\`: ${f.note}`),
    '',
    failures.length > 0 ? `## FAILED SECTIONS (a render error on the page, kept as a finding)\n\n${failures.map((f) => `- ${f}`).join('\n')}\n` : '',
    errors.length > 0 ? `## Console (errors and warnings, ${errors.length})\n\n${errors.slice(0, 12).map((e) => `- ${e.slice(0, 200)}`).join('\n')}\n` : '## Console\n\nNo errors or warnings.\n',
  ].join('\n');
  writeFileSync(path.join(OUT, 'README.md'), readme);
  console.log(`webgpu-grass-sheet: wrote ${files.length} files to ${OUT}`);
  process.exit(0);
}

await main();
