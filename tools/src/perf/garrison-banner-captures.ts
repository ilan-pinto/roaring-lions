/**
 * `pnpm banner:capture -- --out=<dir> [--port=5198] [--attach] [--label=after]
 *    [--only=types,evidence,hud,scenarios]`
 *
 * The held-building banner's instrument (lead ruling 2026-10-14; the banner
 * is `packages/render/src/three/units/garrison-banner.ts`). One Metal
 * browser, music off, its own dev server on its own port (5177, the lead's,
 * is refused), every process it starts stopped by process group on the way
 * out. `--attach` drives a server already running on `--port` instead -- how
 * the BEFORE half of the evidence is photographed against a `main` tree,
 * which has no copy of this file.
 *
 * Four passes, each a page of its own:
 *
 * - `types`: one building of every garrisonable type is held by a KDF squad
 *   in turn, framed at zoom 1, and photographed with the `garrison-banner`
 *   debug layer shown and hidden on the SAME frozen frame -- the toggle A/B
 *   (`debug-layers.ts`). The pixels inside the building's own screen box
 *   that moved by a quarter of the channel range or more are its visible
 *   pixel count (every changed pixel is reported beside it). This pass
 *   VOTES: a type under its floor (`BANNER_FLOORS`, a third of the smallest
 *   of three measured runs) exits 1, and so does a type that drew no banner
 *   at all. No gated golden scenario contains a garrison, which is why the
 *   check lives here. Draw calls are read with `info.autoReset` off over one
 *   repaint, shown and hidden, with one banner and with every free building
 *   on the map held at once.
 * - `evidence`: house, apartment, hall, warehouse and shanty, held by each
 *   side, at zoom 1 and 2.5, plus one hostile building observed and fogged.
 *   Run against both trees for the before/after sheet.
 * - `hud`: the "2 / 4 inside" readout, driven with the real mouse: a hover
 *   over a held building's wall, and a click on a garrisoned squad.
 * - `scenarios`: every golden scenario captured exactly as the gate
 *   captures it (`golden-diff/browser.ts`'s `capture`), then asked which
 *   buildings are held at the capture tick and whether any is in frame --
 *   which gated pictures the banner can move. With `--compare=<dir>` it
 *   diffs each frame against a BEFORE run's by the gate's own metrics.
 */
import { chromium, type Page } from 'playwright';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PNG } from 'pngjs';
import { gpuLaunchArgs } from '../ui-review/gpu';
import { musicOffInitScript } from '../ui-review/music-off';
import { portBusy } from '../ui-review/port';
import {
  CAPTURE_VIEWPORT,
  FREEZE_FRAME_LOOP_STATEMENTS,
  HIDE_ALERT_FEED_STATEMENTS,
  SCENARIOS,
  captureScript,
  hideHudExceptCanvas,
  threeUrl,
} from '../golden-diff/capture-protocol';
import { isGated, specFor } from '../golden-diff/baseline';
import { capture } from '../golden-diff/browser';
import { computeDiff } from '../golden-diff/diff';

const arg = (k: string, d: string): string => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const PORT = Number(arg('port', '5198'));
if (PORT === 5177) {
  console.error("[banner] refusing port 5177: it is the lead's dev server");
  process.exit(2);
}
const ATTACH = process.argv.includes('--attach');
const LABEL = arg('label', 'after');
const ONLY = arg('only', 'types,evidence,hud,scenarios').split(',');
const SCENE = arg('scene', '');
const ROOT = resolve(import.meta.dirname, '../../..');
const OUT = resolve(arg('out', 'garrison-banner-out'));
mkdirSync(OUT, { recursive: true });
const log: string[] = [];
const say = (s: string): void => {
  console.log(s);
  log.push(s);
};

/**
 * The `types` pass's floors: pixels inside the building's own screen box
 * whose colour moved by a quarter of the channel range or more (64/255)
 * when the banner was hidden -- the cloth itself, not the AO halo and the
 * soft shadow edge round it, which move hundreds of pixels by a level or
 * two and kept a banner cut to a tenth of its drop above an any-change
 * floor on four types. A third of the smallest of three runs (the golden
 * gate's one-third rule). Measured 2026-10-14 on ANGLE/Metal, Apple M3 Pro,
 * 1400x900 at DPR 1, frame loop frozen, three fresh runs; the readings are
 * beside each. The building is the median-sized free one of its type on the
 * scene's map (`TYPE_SCENES`), fitted to its own plot, at zoom 1.
 */
export const BANNER_FLOORS: Readonly<Record<string, number>> = {
  house: 200, // 601 602 602
  apartment: 147, // 442 441 441
  hall: 193, // 581 581 581 -- the mock's banner moved 4 px here
  warehouse: 257, // 771 775 775
  shanty: 142, // 427 430 430
  clinic: 207, // 623 639 639 -- its shaded +x wall
  concrete: 367, // 1104 1102 1102
  relay: 123, // 372 371 373
  camp: 44, // 134 134 134 -- a wide cloth on a barrier 0.35 tall
  pump_house: 35, // 107 106 107 -- a 1x1 plot
};

/** Where each type is measured: a sandbox map (or a mission) that has one. */
const TYPE_SCENES: readonly { query: string; types: readonly string[] }[] = [
  { query: '?sandbox=khan_rafid', types: ['house', 'apartment', 'hall', 'warehouse', 'shanty', 'clinic', 'concrete'] },
  { query: '?sandbox=umm_zeitoun', types: ['relay'] },
  { query: '?mission=khan_rafid_2_foothold', types: ['camp', 'pump_house'] },
];

const EVIDENCE_TYPES: readonly string[] = arg('evidence-types', 'house,apartment,hall,warehouse,shanty').split(',');
/** Where the evidence pass is photographed. The sandbox clears both forces
 *  first; a mission (`--evidence-scene=?mission=<id>`) keeps its own, so its
 *  runtime is not ended by an empty side. */
const EVIDENCE_SCENE = arg('evidence-scene', '?sandbox=khan_rafid');

async function waitHttp(url: string, ms: number): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`dev server never answered at ${url}`);
}

/** Page-side helpers, installed once per page as `window.__banner`. Plain
 *  JavaScript: it runs in the page against `window.__lions`. */
const HELPERS = `(() => {
  const F = 65536;
  const L = window.__lions;
  const sim = L.sim;
  const r = L.renderer;
  function typeOf(s) { return sim.structureTypes[sim.structures.typeIdx[s]].id; }
  function structures(type) {
    const out = [];
    const st = sim.structures;
    for (let s = 0; s < sim.structureCount; s++) {
      if (st.alive[s] === 0 || typeOf(s) !== type) continue;
      out.push({ s, box: [st.minX[s], st.minY[s], st.maxX[s], st.maxY[s]], area: (st.maxX[s] - st.minX[s] + 1) * (st.maxY[s] - st.minY[s] + 1), occ: st.occupants[s] });
    }
    return out;
  }
  function centre(s) {
    const st = sim.structures;
    return [(st.minX[s] + st.maxX[s] + 1) / 2, (st.minY[s] + st.maxY[s] + 1) / 2];
  }
  /** A walkable tile next to structure s, nearest its camera-facing corner. */
  function doorstep(s) {
    const st = sim.structures;
    const w = sim.width;
    let best = null;
    for (let y = st.minY[s] - 2; y <= st.maxY[s] + 2; y++) {
      for (let x = st.minX[s] - 2; x <= st.maxX[s] + 2; x++) {
        if (x < 0 || y < 0 || x >= w || y >= sim.height) continue;
        if (x >= st.minX[s] && x <= st.maxX[s] && y >= st.minY[s] && y <= st.maxY[s]) continue;
        if (sim.blocked[y * w + x] !== 0) continue;
        const d = Math.hypot(x - st.maxX[s] - 1, y - st.maxY[s] - 1);
        if (!best || d < best.d) best = { x, y, d };
      }
    }
    return best;
  }
  function spawnAt(typeId, side, x, y) {
    const t = sim.unitTypes.findIndex((u) => u.id === typeId);
    if (t < 0) throw new Error('no unit type ' + typeId);
    return sim.spawn(t, side, Math.round((x + 0.5) * F), Math.round((y + 0.5) * F));
  }
  function garrison(s, side, typeId) {
    const d = doorstep(s);
    if (!d) throw new Error('no doorstep for structure ' + s);
    const id = spawnAt(typeId, side, d.x, d.y);
    sim.queueCommand({ kind: 'garrison', ids: [id], structure: s });
    return id;
  }
  function stepUntilInside(ids, s, limit) {
    for (let k = 0; k < limit; k += 5) {
      if (ids.every((i) => sim.state.garrisonedIn[i] === s)) return k;
      L.step(5);
    }
    return -1;
  }
  function killSide(side, keep) {
    for (let i = 0; i < sim.entityCount; i++) {
      if (sim.state.alive[i] === 1 && sim.state.side[i] === side && !(keep || []).includes(i)) sim.debugKill(i);
    }
  }
  function look(x, y, zoom) {
    L.goto(x, y);
    r.camera.zoom = zoom;
    r.selection = [];
    r.frame(1, 0);
    r.frame(1, 0);
  }
  /** The banner of structure s on screen: the cloth's four corners through
   *  the renderer's own camera, as a pixel box. Null when none is drawn. */
  function bannerBox(s) {
    const e = (r.bannerEntries || []).find((b) => b.s === s);
    if (!e) return null;
    const cam = r.viewCamera;
    cam.updateMatrixWorld();
    const P = cam.projectionMatrix.elements;
    const V = cam.matrixWorldInverse.elements;
    const M = e.matrix.elements;
    const mul = (m, p) => [
      m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12] * p[3],
      m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13] * p[3],
      m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14] * p[3],
      m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15] * p[3],
    ];
    const W = window.innerWidth;
    const H = window.innerHeight;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [lx, ly] of [[-0.55, 0.02], [0.55, 0.02], [-0.55, -1.03], [0.55, -1.03]]) {
      const c = mul(P, mul(V, mul(M, [lx, ly, 0.035, 1])));
      const sx = ((c[0] / c[3] + 1) / 2) * W;
      const sy = ((1 - c[1] / c[3]) / 2) * H;
      x0 = Math.min(x0, sx); y0 = Math.min(y0, sy); x1 = Math.max(x1, sx); y1 = Math.max(y1, sy);
    }
    return [x0, y0, x1, y1];
  }
  /** A recon drone parked 9-12 tiles out from structure s: far enough that
   *  a militia cell inside (sight and rifle range 7) neither sees nor
   *  reaches it, near enough that its sight (16) holds the building. Fog is
   *  ground line of sight (fog.ts), so the first post that actually puts
   *  a tile of the building in sight wins. Ordered nowhere, it hovers.
   *  Returns -1 when no post works. */
  function observer(s) {
    const c = centre(s);
    for (const dist of [10, 11, 12, 9]) {
      for (let k = 0; k < 16; k++) {
        const a = Math.PI / 4 + (k * Math.PI) / 8;
        const x = Math.floor(c[0] + dist * Math.cos(a));
        const y = Math.floor(c[1] + dist * Math.sin(a));
        if (x < 0 || y < 0 || x >= sim.width || y >= sim.height) continue;
        const id = spawnAt('recon_drone', 0, x, y);
        L.step(8);
        if (typeof r.structureInSight !== 'function' || r.structureInSight(s)) return id;
        sim.debugKill(id);
        L.step(1);
      }
    }
    return -1;
  }
  /** Walks unit id out of its building, then removes it. */
  function evict(id) {
    const s = sim.state.garrisonedIn[id];
    if (s >= 0) {
      const d = doorstep(s);
      sim.queueCommand({ kind: 'move', ids: [id], x: Math.round((d.x + 0.5) * F), y: Math.round((d.y + 0.5) * F) });
      for (let k = 0; k < 200 && sim.state.garrisonedIn[id] >= 0; k++) L.step(1);
    }
    sim.debugKill(id);
    L.step(1);
    return sim.state.garrisonedIn[id];
  }
  /** Structure s's standing clone on screen: its drawn box (the type's
   *  measured bounds times its fit) through the camera, as a pixel box --
   *  independent of the banner, so a banner that shrinks reads smaller. */
  function buildingBox(s) {
    const root = r.buildingMeshIdleEntities.get(s);
    const size = root && r.drawnBuildingSize(s);
    if (!root || !size) return null;
    const cam = r.viewCamera;
    cam.updateMatrixWorld();
    const P = cam.projectionMatrix.elements;
    const V = cam.matrixWorldInverse.elements;
    const W = window.innerWidth;
    const H = window.innerHeight;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const dx of [-0.5, 0.5]) for (const dy of [0, 1]) for (const dz of [-0.5, 0.5]) {
      const p = [root.position.x + dx * size.x, root.position.y + dy * size.y, root.position.z + dz * size.z, 1];
      const v = [0, 1, 2, 3].map((k) => V[k] * p[0] + V[4 + k] * p[1] + V[8 + k] * p[2] + V[12 + k] * p[3]);
      const c = [0, 1, 2, 3].map((k) => P[k] * v[0] + P[4 + k] * v[1] + P[8 + k] * v[2] + P[12 + k] * v[3]);
      const sx = ((c[0] / c[3] + 1) / 2) * W;
      const sy = ((1 - c[1] / c[3]) / 2) * H;
      x0 = Math.min(x0, sx); y0 = Math.min(y0, sy); x1 = Math.max(x1, sx); y1 = Math.max(y1, sy);
    }
    return [x0, y0, x1, y1];
  }
  function drawCalls() {
    const gl = r.renderer;
    gl.info.autoReset = false;
    gl.info.reset();
    r.frame(1, 0);
    const out = { calls: gl.info.render.calls, triangles: gl.info.render.triangles };
    gl.info.autoReset = true;
    return out;
  }
  window.__banner = { typeOf, structures, centre, doorstep, spawnAt, garrison, stepUntilInside, killSide, look, bannerBox, buildingBox, drawCalls, evict, observer };
  return true;
})()`;

async function boot(page: Page, query: string): Promise<void> {
  await page.goto(`http://localhost:${PORT}/${query}`, { waitUntil: 'load', timeout: 120_000 });
  await page.mouse.move(2, 2);
  // Deploy gate: click until the loading screen is gone (capture-guard's rule).
  const t0 = Date.now();
  while (Date.now() - t0 < 120_000) {
    const state = await page.evaluate(() => ({
      lions: typeof (window as unknown as { __lions?: unknown }).__lions !== 'undefined',
      loading: document.querySelector('.rl-loading') !== null,
    }));
    if (state.lions && !state.loading) break;
    const btn = await page.$('.rl-loading__deploy');
    if (btn) await btn.click({ timeout: 1000 }).catch(() => undefined);
    await page.waitForTimeout(250);
  }
  await page.waitForFunction(() => typeof (window as unknown as { __lions?: unknown }).__lions !== 'undefined', null, {
    timeout: 120_000,
  });
  // The boot tail (building GLBs, then the deferred wrecks) lands before the
  // loop is frozen; every frame after this is one the script asked for.
  await page.waitForTimeout(6000);
  await page.evaluate(`(async () => { ${FREEZE_FRAME_LOOP_STATEMENTS} ${HIDE_ALERT_FEED_STATEMENTS} })()`);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(HELPERS);
}

/** `boot` without the freeze: the HUD pass needs the real frame loop. */
async function bootLive(page: Page, query: string): Promise<void> {
  await page.goto(`http://localhost:${PORT}/${query}`, { waitUntil: 'load', timeout: 120_000 });
  await page.mouse.move(2, 2);
  await page.waitForFunction(() => typeof (window as unknown as { __lions?: unknown }).__lions !== 'undefined', null, {
    timeout: 120_000,
  });
  await page.waitForTimeout(6000);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(HELPERS);
}

async function newPage(browser: import('playwright').Browser, errors: string[]): Promise<Page> {
  const page = await browser.newPage({ viewport: { ...CAPTURE_VIEWPORT }, deviceScaleFactor: 1 });
  await page.addInitScript(musicOffInitScript());
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return page;
}

function decode(buf: Buffer): PNG {
  return PNG.sync.read(buf);
}

/** Pixels that differ at all, and pixels that differ by a quarter of the
 *  channel range or more ("clearly"), inside `box` (whole frame if null). */
function changed(a: PNG, b: PNG, box: readonly number[] | null): { any: number; clear: number } {
  const x0 = box ? Math.max(0, Math.floor(box[0])) : 0;
  const y0 = box ? Math.max(0, Math.floor(box[1])) : 0;
  const x1 = box ? Math.min(a.width - 1, Math.ceil(box[2])) : a.width - 1;
  const y1 = box ? Math.min(a.height - 1, Math.ceil(box[3])) : a.height - 1;
  let any = 0;
  let clear = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * a.width + x) * 4;
      const d = Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]));
      if (d > 0) any++;
      if (d >= 64) clear++;
    }
  }
  return { any, clear };
}

async function hasLayer(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    try {
      (window as unknown as { __lions: { renderer: { setDebugLayerVisible(n: string, v: boolean): number } } }).__lions.renderer.setDebugLayerVisible(
        'garrison-banner',
        true
      );
      return true;
    } catch {
      return false;
    }
  });
}

/** The `types` pass: the per-type toggle A/B at zoom 1. Returns failures. */
async function typesPass(page: Page, scene: (typeof TYPE_SCENES)[number], results: Record<string, unknown>): Promise<string[]> {
  const failures: string[] = [];
  // Nobody shoots in shot: every hostile goes, before anything is held.
  await page.evaluate(() => (window as unknown as { __banner: { killSide(s: number): void } }).__banner.killSide(1));
  for (const type of scene.types) {
    const pick = await page.evaluate((t) => {
      const B = (window as unknown as { __banner: Record<string, (...a: unknown[]) => unknown> }).__banner;
      const all = B.structures(t) as { s: number; area: number; box: number[]; occ: number }[];
      const free = all.filter((x) => x.occ === 0).sort((p, q) => p.area - q.area);
      return free.length ? { ...free[Math.floor(free.length / 2)], n: all.length } : null;
    }, type);
    if (!pick) {
      failures.push(`${type}: no free building of this type on ${scene.query}`);
      continue;
    }
    const inside = await page.evaluate(
      ({ s }) => {
        const B = (window as unknown as { __banner: Record<string, (...a: unknown[]) => unknown> }).__banner;
        const id = B.garrison(s, 0, 'inf_squad') as number;
        const k = B.stepUntilInside([id], s, 800) as number;
        return { id, k };
      },
      { s: pick.s }
    );
    if (inside.k < 0) {
      failures.push(`${type}: the squad never got inside structure ${pick.s}`);
      continue;
    }
    // Let fog settle round the new garrison (5 Hz), then frame it.
    const shot = async (visible: boolean): Promise<{ png: PNG; box: number[] | null; building: number[] | null; calls: unknown; count: number }> => {
      const info = await page.evaluate(
        ({ s, visible: v }) => {
          const w = window as unknown as {
            __lions: { renderer: { setDebugLayerVisible(n: string, v: boolean): number; frame(a: number, d: number): void; garrisonBanners: { count: number } } };
            __banner: Record<string, (...a: unknown[]) => unknown>;
          };
          w.__lions.renderer.setDebugLayerVisible('garrison-banner', v);
          w.__lions.renderer.frame(1, 0);
          const calls = w.__banner.drawCalls();
          return {
            box: w.__banner.bannerBox(s) as number[] | null,
            building: w.__banner.buildingBox(s) as number[] | null,
            calls,
            count: w.__lions.renderer.garrisonBanners.count,
          };
        },
        { s: pick.s, visible }
      );
      const png = decode(await page.screenshot());
      return { png, ...info };
    };
    await page.evaluate(
      ({ s }) => {
        const w = window as unknown as { __lions: { step(n: number): void }; __banner: Record<string, (...a: unknown[]) => unknown> };
        w.__lions.step(8);
        const c = w.__banner.centre(s) as number[];
        w.__banner.look(c[0], c[1], 1);
      },
      { s: pick.s }
    );
    await page.evaluate(hideHudExceptCanvas);
    const on = await shot(true);
    const off = await shot(false);
    await page.evaluate(() =>
      (window as unknown as { __lions: { renderer: { setDebugLayerVisible(n: string, v: boolean): number } } }).__lions.renderer.setDebugLayerVisible(
        'garrison-banner',
        true
      )
    );
    // Counted inside the BUILDING's own screen box (plus a margin for the
    // cloth's shadow on the ground before it), not the banner's: a banner
    // that shrinks must read smaller, and one measured by its own box would
    // shrink its yardstick with it.
    const pad = 20;
    const box = on.building ? [on.building[0] - pad, on.building[1] - pad, on.building[2] + pad, on.building[3] + pad] : null;
    const px = box ? changed(on.png, off.png, box) : { any: 0, clear: 0 };
    const whole = changed(on.png, off.png, null);
    writeFileSync(join(OUT, `types-${type}-on.png`), PNG.sync.write(on.png));
    writeFileSync(join(OUT, `types-${type}-off.png`), PNG.sync.write(off.png));
    const spot = await page.evaluate((t) => {
      const r = (window as unknown as { __lions: { renderer: { bannerSpots: Map<string, unknown> } } }).__lions.renderer;
      return r.bannerSpots.get(t) ?? null;
    }, type);
    const row = {
      type,
      structure: pick.s,
      plot: [pick.box[2] - pick.box[0] + 1, pick.box[3] - pick.box[1] + 1],
      enteredAfterTicks: inside.k,
      banners: on.count,
      bannerBoxPx: on.box ? [Math.round(on.box[2] - on.box[0]), Math.round(on.box[3] - on.box[1])] : null,
      buildingBoxPx: on.building ? [Math.round(on.building[2] - on.building[0]), Math.round(on.building[3] - on.building[1])] : null,
      changedInBox: px.any,
      clearlyChangedInBox: px.clear,
      changedWholeFrame: whole.any,
      callsShown: on.calls,
      callsHidden: off.calls,
      spot,
    };
    results[type] = row;
    say(`[types] ${JSON.stringify(row)}`);
    const floor = BANNER_FLOORS[type];
    if (on.count === 0 || !on.box) failures.push(`${type}: no banner drawn on a held building`);
    else if (floor !== undefined && px.clear < floor) failures.push(`${type}: ${px.clear} px visibly changed, under its floor of ${floor}`);
    // The next type starts from no banner at all: the squad walks out (a
    // move order leaves the building; `debugKill` inside would leave the
    // sim's occupant count standing) and is then removed.
    await page.evaluate(`window.__banner.evict(${inside.id})`);
  }
  return failures;
}

type B = { __banner: Record<string, (...a: unknown[]) => unknown>; __lions: Record<string, unknown> };

/** The median-sized free building of `type`. */
async function pickOne(page: Page, type: string): Promise<number | null> {
  return page.evaluate((t) => {
    const w = window as unknown as B;
    const all = (w.__banner.structures(t) as { s: number; occ: number; area: number }[]).filter((x) => x.occ === 0);
    all.sort((p, q) => p.area - q.area || p.s - q.s);
    return all.length ? all[Math.floor(all.length / 2)].s : null;
  }, type);
}

async function frame(page: Page, s: number, zoom: number, name: string): Promise<void> {
  await page.evaluate(`(() => { const c = window.__banner.centre(${s}); window.__banner.look(c[0], c[1], ${zoom}); })()`);
  await page.evaluate(hideHudExceptCanvas);
  await page.screenshot({ path: join(OUT, `${LABEL}-${name}.png`) });
}

/** The `evidence` pass: before/after material for the sheet. One building
 *  of each type, held by the KDF and photographed, emptied, then held by a
 *  militia cell with a recon drone watching from out of its reach and
 *  photographed again -- one side at a time, so nobody fights in shot. */
async function evidencePass(page: Page): Promise<void> {
  if (EVIDENCE_SCENE.includes('sandbox')) {
    await page.evaluate(() => {
      const w = window as unknown as B;
      w.__banner.killSide(1);
      w.__banner.killSide(0);
      (w.__lions.step as (n: number) => void)(2);
    });
  }
  for (const type of EVIDENCE_TYPES) {
    const s = await pickOne(page, type);
    if (s === null) {
      say(`[evidence] ${type}: no free building, skipped`);
      continue;
    }
    const own = await page.evaluate((st) => {
      const w = window as unknown as B;
      const id = w.__banner.garrison(st, 0, 'inf_squad') as number;
      const k = w.__banner.stepUntilInside([id], st, 800) as number;
      (w.__lions.step as (n: number) => void)(10);
      return { id, k };
    }, s);
    await frame(page, s, 1, `${type}-own-z1`);
    await frame(page, s, 2.5, `${type}-own-z25`);
    await page.evaluate(`window.__banner.evict(${own.id})`);
    const hostile = await page.evaluate((st) => {
      const w = window as unknown as B;
      const id = w.__banner.garrison(st, 1, 'militia_cell') as number;
      const k = w.__banner.stepUntilInside([id], st, 800) as number;
      const eye = w.__banner.observer(st) as number;
      (w.__lions.step as (n: number) => void)(10);
      const alive = (w.__lions.sim as { state: { alive: Uint8Array } }).state.alive;
      return { id, k, eye, eyeAlive: alive[eye] === 1 };
    }, s);
    say(`[evidence] ${type}: structure ${s}, own ${JSON.stringify(own)}, hostile ${JSON.stringify(hostile)}`);
    await frame(page, s, 1, `${type}-hostile-z1`);
    await frame(page, s, 2.5, `${type}-hostile-z25`);
    if (type === 'house') {
      // The fog rule: the same hostile house, observed and then not. The
      // drone goes and the fog recomputes (5 Hz) before the second photo.
      await frame(page, s, 1.6, 'fog-observed');
      await page.evaluate((eye) => {
        const w = window as unknown as B;
        (w.__lions.sim as { debugKill(i: number): void }).debugKill(eye);
        (w.__lions.step as (n: number) => void)(10);
      }, hostile.eye);
      await frame(page, s, 1.6, 'fog-fogged');
    } else {
      await page.evaluate((eye) => (window as unknown as { __lions: { sim: { debugKill(i: number): void } } }).__lions.sim.debugKill(eye), hostile.eye);
    }
    await page.evaluate(`window.__banner.evict(${hostile.id})`);
  }
}

/**
 * The `scenarios` pass: every golden scenario, captured EXACTLY as the gate
 * captures it (`golden-diff/browser.ts`'s `capture`, the scenario's own
 * `captureScript`), then asked which buildings are held at that tick, whether
 * any of them stands in the frame, and how many banners the renderer drew.
 * Pass `--compare=<dir>` with a BEFORE run's directory (`--label=before`,
 * against a `main` tree) to diff each frame against it.
 */
async function scenariosPass(page: Page): Promise<string[]> {
  const failures: string[] = [];
  const compare = arg('compare', '');
  for (const sc of SCENARIOS) {
    const file = join(OUT, `${LABEL}-scenario-${sc.id}.png`);
    const res = await capture(page, threeUrl(PORT, sc), captureScript(sc), file, sc.id, sc.mission !== undefined);
    const held = (await page.evaluate(`(() => {
      const L = window.__lions;
      const sim = L.sim;
      const r = L.renderer;
      const st = sim.structures;
      const out = [];
      for (let s = 0; s < sim.structureCount; s++) {
        if (st.alive[s] === 0 || st.occupants[s] === 0) continue;
        let holder = -1;
        for (let i = 0; i < sim.entityCount; i++) if (sim.state.alive[i] === 1 && sim.state.garrisonedIn[i] === s) { holder = sim.state.side[i]; break; }
        const c = [(st.minX[s] + st.maxX[s] + 1) / 2, (st.minY[s] + st.maxY[s] + 1) / 2];
        const p = r.worldToScreen(c[0], c[1]);
        const inFrame = p.x > -150 && p.y > -150 && p.x < innerWidth + 150 && p.y < innerHeight + 300;
        out.push({ s, type: sim.structureTypes[st.typeIdx[s]].id, holder, occupants: st.occupants[s], inSight: r.structureInSight(s), inFrame, at: [Math.round(p.x), Math.round(p.y)] });
      }
      const banners = r.garrisonBanners ? r.garrisonBanners.count : null;
      return JSON.stringify({ held: out, banners });
    })()`)) as string;
    const gated = isGated(specFor(sc.id));
    let diff = '';
    const before = compare ? join(resolve(compare), `${arg('compare-label', 'before')}-scenario-${sc.id}.png`) : '';
    if (before && existsSync(before)) {
      // The gate's own numbers (pixelmatch at 0.1 inside the scenario's
      // region, and the mean |channel delta|), beside a strict any-change
      // count over the whole frame.
      const spec = specFor(sc.id);
      const g = computeDiff(before, file, spec.region ? { region: spec.region } : {});
      const d = changed(decode(readFileSync(before)), decode(readFileSync(file)), null);
      diff =
        ` vs ${arg('compare-label', 'before')}: gate ${g.diffPixels} px / ${g.meanAbsChannelDelta.toFixed(4)}` +
        ` (budget ${spec.maxDiffPixels} / ${spec.maxMeanAbsChannelDelta}), any-change ${d.any} px, max delta ${g.maxAbsChannelDelta}`;
    }
    say(`[scenarios] ${sc.id} (${gated ? 'gated' : 'report-only'}) tick ${res.tick}: ${held}${diff}`);
  }
  return failures;
}

/**
 * The `hud` pass, driven like a player: the frame loop RUNS (no freeze), the
 * held building is found with the real mouse over its wall, and a garrisoned
 * squad is selected by clicking it. Two photographs of the HUD: the held tag
 * beside the hovered building, and the selected unit's card.
 */
async function hudPass(page: Page): Promise<void> {
  const setup = (await page.evaluate(`(() => {
    const L = window.__lions;
    const B = window.__banner;
    B.killSide(1);
    const s = B.structures('house').filter((x) => x.occ === 0)[0].s;
    const ids = [B.garrison(s, 0, 'inf_squad'), B.garrison(s, 0, 'at_team')];
    B.stepUntilInside(ids, s, 900);
    const c = B.centre(s);
    L.goto(c[0], c[1]);
    L.renderer.camera.zoom = 1.6;
    L.renderer.selection = [];
    return JSON.stringify({ s, ids, inside: ids.map((i) => L.sim.state.garrisonedIn[i]) });
  })()`)) as string;
  say(`[hud] ${setup}`);
  const { s, ids } = JSON.parse(setup) as { s: number; ids: number[] };
  // Unfreeze: this pass is the real loop, real pointer, real HUD ticks.
  await page.waitForTimeout(800);
  // Over the banner's own cloth -- or, on a tree with no banner (the BEFORE
  // run against main), over the footprint centre, which is wall as well.
  const wall = (await page.evaluate(`(() => {
    const b = window.__banner.bannerBox(${s});
    if (b) return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
    const c = window.__banner.centre(${s});
    const p = window.__lions.renderer.worldToScreen(c[0], c[1]);
    return [p.x, p.y - 30];
  })()`)) as number[];
  await page.mouse.move(wall[0], wall[1], { steps: 6 });
  await page.waitForTimeout(700);
  const tag = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.rl-held');
    return el ? { shown: el.style.display !== 'none', text: el.textContent, side: el.dataset.side } : null;
  });
  say(`[hud] hover over the banner at ${wall.map(Math.round).join(',')}: ${JSON.stringify(tag)}`);
  await page.screenshot({ path: join(OUT, `${LABEL}-hud-hover.png`) });
  // Select one of the squad on the roof with a real click on its drawn body.
  const body = (await page.evaluate(`(() => {
    const r = window.__lions.renderer;
    const st = window.__lions.sim.state;
    const id = ${ids[0]};
    return r.worldToScreen(st.posX[id] / 65536, st.posY[id] / 65536);
  })()`)) as { x: number; y: number };
  await page.mouse.click(body.x, body.y);
  await page.waitForTimeout(700);
  await page.mouse.move(4, 450, { steps: 4 });
  await page.waitForTimeout(700);
  const card = await page.evaluate(() => {
    const sel = (window as unknown as { __lions: { renderer: { selection: number[] } } }).__lions.renderer.selection;
    const cond = document.querySelector('.rl-card__cond');
    return { selection: sel, cond: cond ? cond.textContent : null };
  });
  say(`[hud] click on the garrison at ${Math.round(body.x)},${Math.round(body.y)}: ${JSON.stringify(card)}`);
  await page.screenshot({ path: join(OUT, `${LABEL}-hud-card.png`) });
  // The minimap, with its outline.
  const mm = await page.$('.rl-minimap');
  if (mm) await mm.screenshot({ path: join(OUT, `${LABEL}-minimap.png`) });
}

async function main(): Promise<void> {
  let server: ChildProcess | null = null;
  if (!ATTACH) {
    if (await portBusy(PORT)) {
      console.error(`[banner] port ${PORT} is already taken -- refusing to photograph someone else's server (use --attach to mean it)`);
      process.exit(2);
    }
    say(`[banner] starting vite on :${PORT} in ${ROOT}`);
    server = spawn('pnpm', ['--filter', '@lions/app', 'exec', 'vite', '--port', String(PORT), '--strictPort'], {
      cwd: ROOT,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stdout?.on('data', () => undefined);
    server.stderr?.on('data', () => undefined);
  }
  const browser = await chromium.launch({ headless: true, args: gpuLaunchArgs('metal') });
  const failures: string[] = [];
  const results: Record<string, unknown> = {};
  try {
    await waitHttp(`http://localhost:${PORT}/`, 90_000);
    if (ONLY.includes('types')) {
      for (const scene of TYPE_SCENES) {
        if (SCENE && !scene.query.includes(SCENE)) continue;
        const errors: string[] = [];
        const page = await newPage(browser, errors);
        await boot(page, scene.query);
        if (!(await hasLayer(page))) throw new Error('this tree has no garrison-banner layer: the types pass needs the banner');
        const gl = await page.evaluate(() => {
          const c = document.createElement('canvas').getContext('webgl2');
          const e = c?.getExtension('WEBGL_debug_renderer_info');
          return e && c ? String(c.getParameter(e.UNMASKED_RENDERER_WEBGL)) : 'unknown';
        });
        say(`[types] ${scene.query} gl=${gl}`);
        failures.push(...(await typesPass(page, scene, results)));
        if (scene.query === TYPE_SCENES[0].query) {
          // "+3 whatever the count": every free building on the map held at
          // once, then the draw calls with the layer shown and hidden.
          const many = (await page.evaluate(`(() => {
            const B = window.__banner;
            const sim = window.__lions.sim;
            const ids = [];
            for (const t of ['house', 'apartment', 'hall', 'warehouse', 'shanty', 'clinic', 'concrete']) {
              for (const x of B.structures(t)) if (x.occ === 0 && ids.length < 24) ids.push([B.garrison(x.s, 0, 'inf_squad'), x.s]);
            }
            for (let k = 0; k < 900 && ids.some(([i, s]) => sim.state.garrisonedIn[i] !== s); k += 5) window.__lions.step(5);
            window.__lions.step(8);
            const r = window.__lions.renderer;
            r.setDebugLayerVisible('garrison-banner', true);
            const shown = B.drawCalls();
            const n = r.garrisonBanners.count;
            r.setDebugLayerVisible('garrison-banner', false);
            const hidden = B.drawCalls();
            r.setDebugLayerVisible('garrison-banner', true);
            return JSON.stringify({ banners: n, shown, hidden });
          })()`)) as string;
          say(`[types] all held at once: ${many}`);
          results.many = JSON.parse(many) as unknown;
        }
        if (errors.length) say(`[types] page errors: ${errors.slice(0, 5).join(' | ')}`);
        await page.close();
      }
      writeFileSync(join(OUT, 'types.json'), JSON.stringify(results, null, 1));
    }
    if (ONLY.includes('scenarios')) {
      const errors: string[] = [];
      const page = await newPage(browser, errors);
      failures.push(...(await scenariosPass(page)));
      if (errors.length) say(`[scenarios] page errors: ${errors.slice(0, 5).join(' | ')}`);
      await page.close();
    }
    if (ONLY.includes('hud')) {
      const errors: string[] = [];
      const page = await newPage(browser, errors);
      await bootLive(page, '?sandbox=khan_rafid');
      await hudPass(page);
      if (errors.length) say(`[hud] page errors: ${errors.slice(0, 5).join(' | ')}`);
      await page.close();
    }
    if (ONLY.includes('evidence')) {
      const errors: string[] = [];
      const page = await newPage(browser, errors);
      await boot(page, EVIDENCE_SCENE);
      await evidencePass(page);
      if (errors.length) say(`[evidence] page errors: ${errors.slice(0, 5).join(' | ')}`);
      await page.close();
    }
  } finally {
    await browser.close();
    if (server?.pid) {
      try {
        process.kill(-server.pid, 'SIGTERM');
      } catch {
        /* gone */
      }
    }
    writeFileSync(join(OUT, `capture-log-${LABEL}.txt`), log.join('\n') + '\n');
  }
  if (failures.length) {
    for (const f of failures) console.error(`[banner] FAIL ${f}`);
    process.exitCode = 1;
  }
}


main().then(
  () => process.exit(process.exitCode ?? 0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
