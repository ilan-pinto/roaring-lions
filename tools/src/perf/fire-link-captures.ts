/**
 * proto/fire-link captures: each fire-link concept, photographed in the
 * running game with a selected unit firing at a target and being fired at.
 *
 *   npx tsx src/perf/fire-link-captures.ts --port=5268 --out=<dir> [--only=ring,ticks]
 *
 * Drives the REAL UI for everything that matters to the feature: the unit is
 * selected by a left click on the canvas and ordered forward by a right click,
 * so selection and order dispatch run exactly as they do for a player. The
 * console API is used only for FRAMING (camera position and zoom), for
 * waiting on a condition, and for the draw-call readout -- never to select.
 *
 * Per concept: a 3-second, 8-frame strip with the game running; then the
 * frame loop is frozen at a moment the concept is visibly active and stills
 * are taken at zoom 1 and 2 from that one frozen moment; then a draw-call
 * A/B on that frame (the concept on vs `none`, `gl.info.render.calls` over a
 * zero-time `frame(1, 0)`).
 *
 * Music is off before boot (`lions.settings`). Never starts or stops a dev
 * server: point it at one with `--port`.
 */
import { chromium, type Page } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The page-side surface this harness reads -- framing, waiting and the
 *  draw-call readout only; selection goes through real clicks. */
interface LionsWindow {
  __lions: {
    renderer: {
      worldToScreen(x: number, y: number): { x: number; y: number };
      curX: ArrayLike<number>;
      curY: ArrayLike<number>;
      selection: number[];
      camera: { x: number; y: number; zoom: number };
      frame(alpha: number, dtMs: number): void;
    };
    sim: {
      tickCount: number;
      entityCount: number;
      state: { curTarget: ArrayLike<number>; alive: ArrayLike<number>; side: ArrayLike<number> };
    };
  };
}

const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const port = arg('port') ?? '5268';
const out = arg('out') ?? 'fire-link-out';
const only = arg('only')?.split(',');
const base = `http://localhost:${port}`;
mkdirSync(out, { recursive: true });

interface Concept {
  id: string;
  flag: string;
  /** JS expression on `r` (the ThreeRenderer) true when the concept is visibly active. */
  activeWhen: string;
}
/** A flash is on, on a target standing in the open (a garrisoned unit has
 *  no outline to flash). */
const FLASH_ON_OPEN_TARGET =
  '[...r.fireLinkFlashed.keys()].some((k) => window.__lions.sim.state.garrisonedIn[k] < 0)';
const CONCEPTS: Concept[] = [
  { id: 'legacy', flag: 'legacy', activeWhen: 'true' },
  { id: 'ring', flag: 'ring', activeWhen: 'true' },
  { id: 'ticks', flag: 'ticks', activeWhen: 'true' },
  { id: 'owned', flag: 'owned', activeWhen: 'r.tracers.some(t=>t.side===3)||r.bolts.some(s=>s.owned)||r.shells.some(s=>s.owned)' },
  { id: 'flash', flag: 'flash', activeWhen: FLASH_ON_OPEN_TARGET },
  { id: 'pulse', flag: 'pulse', activeWhen: 'r.fireLinkPulses.some(p=>r.fireLinkClockS-p.bornS<0.15)' },
  { id: 'combo', flag: 'ring,ticks,flash', activeWhen: FLASH_ON_OPEN_TARGET },
];

const SELECTED = 0; // mbt_lavi at (4,20)
const SUPPORT = 5; // inf_squad at (6,18)

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--use-gl=angle', '--enable-gpu-rasterization', '--disable-gpu-sandbox'],
});
const results: Record<string, unknown>[] = [];
try {
  for (const c of CONCEPTS) {
    if (only && !only.includes(c.id)) continue;
    results.push(await captureConcept(c));
  }
} finally {
  await browser.close();
}
// Merge with earlier runs, so `--only=` re-shoots one concept in place.
const resultsPath = join(out, 'results.json');
const prior: Record<string, unknown>[] = existsSync(resultsPath) ? JSON.parse(readFileSync(resultsPath, 'utf8')) : [];
const merged = [...prior.filter((p) => !results.some((r) => r.id === p.id)), ...results];
writeFileSync(resultsPath, JSON.stringify(merged, null, 2));


async function clickWorld(page: Page, x: number, y: number, button: 'left' | 'right'): Promise<void> {
  const p = await page.evaluate(([wx, wy]) => (window as unknown as LionsWindow).__lions.renderer.worldToScreen(wx, wy), [x, y]);
  const box = await page.locator('canvas').first().boundingBox();
  await page.mouse.move((box?.x ?? 0) + p.x, (box?.y ?? 0) + p.y);
  await page.waitForTimeout(120);
  await page.mouse.click((box?.x ?? 0) + p.x, (box?.y ?? 0) + p.y, { button });
  await page.waitForTimeout(150);
}

async function unitTile(page: Page, id: number): Promise<[number, number]> {
  return page.evaluate((i) => {
    const L = (window as unknown as LionsWindow).__lions;
    const r = L.renderer;
    return [r.curX[i], r.curY[i]] as [number, number];
  }, id);
}

async function frame(page: Page, zoom: number): Promise<void> {
  await page.evaluate(
    ([sel, z]) => {
      const L = (window as unknown as LionsWindow).__lions;
      const r = L.renderer;
      const st = L.sim.state;
      const t = st.curTarget[sel];
      const ax = r.curX[sel];
      const ay = r.curY[sel];
      const bx = t >= 0 ? r.curX[t] : ax;
      const by = t >= 0 ? r.curY[t] : ay;
      // Biased down-screen (+x,+y) so the duel sits above the unit card.
      r.camera.x = (ax + bx) / 2 + 2.2 / z;
      r.camera.y = (ay + by) / 2 + 2.2 / z;
      r.camera.zoom = z;
    },
    [SELECTED, zoom]
  );
}

async function captureConcept(c: Concept): Promise<Record<string, unknown>> {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  await page.addInitScript(() => {
    try {
      localStorage.setItem('lions.settings', JSON.stringify({ audio: { music: 0 } }));
    } catch {
      /* defaults */
    }
  });
  page.on('pageerror', (e) => console.log(`  [${c.id}] pageerror`, e.message));
  await page.goto(`${base}/?sandbox=beit_sahwan_outskirts&sur&firelink=${c.flag}`);
  await page.waitForFunction(() => !!(window as unknown as LionsWindow).__lions?.renderer, null, { timeout: 180000 });
  await page.waitForTimeout(5000); // meshes

  // Frame the friendly force, then order through the real UI.
  await page.evaluate(() => {
    const r = (window as unknown as LionsWindow).__lions.renderer;
    r.camera.x = 9.5;
    r.camera.y = 21;
    r.camera.zoom = 1.1;
  });
  await page.waitForTimeout(400);
  const [sx, sy] = await unitTile(page, SUPPORT);
  await clickWorld(page, sx, sy, 'left');
  await clickWorld(page, 12.5, 18.5, 'right');
  const [lx, ly] = await unitTile(page, SELECTED);
  await clickWorld(page, lx, ly, 'left');
  const sel = await page.evaluate(() => (window as unknown as LionsWindow).__lions.renderer.selection as number[]);
  if (sel.length !== 1 || sel[0] !== SELECTED) throw new Error(`[${c.id}] click did not select the Lavi: ${JSON.stringify(sel)}`);
  await clickWorld(page, 15.5, 22.5, 'right');
  await page.mouse.move(1100, 140);

  // Wait for the duel: the Lavi has a target AND a hostile has the Lavi.
  const t0 = Date.now();
  for (;;) {
    const ok = await page.evaluate((i) => {
      const L = (window as unknown as LionsWindow).__lions;
      const st = L.sim.state;
      if (st.curTarget[i] < 0) return false;
      for (let j = 0; j < L.sim.entityCount; j++) if (st.alive[j] && st.side[j] === 1 && st.curTarget[j] === i) return true;
      return false;
    }, SELECTED);
    if (ok) break;
    if (Date.now() - t0 > 90000) throw new Error(`[${c.id}] no duel within 90 s`);
    await frame(page, 1.4);
    await page.waitForTimeout(250);
  }
  const tick0 = await page.evaluate(() => (window as unknown as LionsWindow).__lions.sim.tickCount);

  // 3-second strip, game running, zoom 1.5.
  const strip: string[] = [];
  for (let k = 0; k < 8; k++) {
    await frame(page, 1.5);
    const f = `${c.id}-strip-${k}.png`;
    await page.screenshot({ path: join(out, f), clip: { x: 250, y: 150, width: 900, height: 560 } });
    strip.push(f);
    await page.waitForTimeout(260);
  }

  // Wait for the concept to be visibly active, then freeze on that frame.
  const t1 = Date.now();
  let active = false;
  while (Date.now() - t1 < 60000) {
    active = await page.evaluate(`(() => { const r = window.__lions.renderer; return !!(${c.activeWhen}); })()`);
    if (active) break;
    await page.waitForTimeout(16);
  }
  await page.evaluate(`(async () => {
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = function () { return 0; };
    await new Promise((res) => raf(() => raf(res)));
  })()`);
  const stills: string[] = [];
  for (const z of [1, 2]) {
    await frame(page, z);
    await page.evaluate(() => (window as unknown as LionsWindow).__lions.renderer.frame(1, 0));
    const f = `${c.id}-z${z}.png`;
    await page.screenshot({ path: join(out, f) });
    stills.push(f);
  }
  // Card crop at the frozen moment (the HUD is DOM; it keeps updating).
  const card = `${c.id}-card.png`;
  const cardEl = page.locator('.rl-card').first();
  if ((await cardEl.count()) > 0) await cardEl.screenshot({ path: join(out, card) });

  // Draw calls: this frame with the concept on, then with `none`.
  const calls = await page.evaluate(`(() => {
    const r = window.__lions.renderer;
    const gl = r.renderer;
    const count = () => { gl.info.autoReset = false; gl.info.reset(); r.frame(1, 0); const n = gl.info.render.calls; gl.info.autoReset = true; return n; };
    const on = count();
    const saved = r.fireLinkSet;
    const flashed = [...r.fireLinkFlashed.entries()];
    for (const [, list] of flashed) for (const { mesh, was } of list) mesh.material = was;
    const savedFlashed = new Map(r.fireLinkFlashed); r.fireLinkFlashed.clear();
    const savedFlashes = r.fireLinkFlashes; r.fireLinkFlashes = [];
    r.fireLinkSet = new Set(['none']);
    r.fireLinkTracerColorList = null; r.fireLinkShellColorList = null;
    const off = count();
    r.fireLinkSet = saved; r.fireLinkFlashes = savedFlashes;
    return { on, off, delta: on - off, flashedNow: savedFlashed.size };
  })()`);
  const tick1 = await page.evaluate(() => (window as unknown as LionsWindow).__lions.sim.tickCount);
  await page.close();
  console.log(`[${c.id}] active=${active} ticks ${tick0}->${tick1} calls ${JSON.stringify(calls)}`);
  return { id: c.id, flag: c.flag, active, tick0, tick1, calls, stills, strip, card };
}
