/**
 * Fire-link captures: a selected rifle squad and a selected Eitan (HMG)
 * firing at a target while being fired at, photographed in the running game.
 *
 *   npx tsx src/perf/fire-link-captures.ts --port=5268 --out=<dir> --label=after [--only=rifle,hmg]
 *
 * Point it at a dev server serving whichever tree you want photographed
 * (`--label` only names the files), so a before/after pair is two runs
 * against two trees on the same port. It never starts or stops a server.
 *
 * Drives the REAL UI for everything that matters to the feature: the shooter
 * is selected by a left click on the canvas and ordered forward by a right
 * click, so selection and order dispatch run exactly as they do for a
 * player. The console API is used only for FRAMING (camera position and
 * zoom), for waiting on a condition, and for the draw-call readout.
 *
 * Per subject: the frame loop is frozen while machine-gun or rifle fire is
 * in the air and stills are taken at zoom 1 and 2 from that one frozen
 * moment, with draw calls on that frame (`gl.info.render.calls`
 * over a zero-time `frame(1, 0)`), with two in-page A/Bs where the tree has
 * the new code: streaks vs the same rounds as old full-span tracers, and
 * fire link (pulse + flash) on vs cleared. Then the loop is released and a
 * 3-second, 8-frame strip is taken at zoom 1 and another at zoom 2. Stills
 * come first because a rifle squad in this fight is often dead in ten
 * seconds.
 *
 * Music is off before boot (`lions.settings`).
 */
import { chromium, type Page } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { musicOffInitScript } from '../ui-review/music-off';

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
      state: { curTarget: ArrayLike<number>; alive: ArrayLike<number>; side: ArrayLike<number>; moving: ArrayLike<number> };
    };
  };
}

const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const port = arg('port') ?? '5268';
const out = arg('out') ?? 'fire-link-out';
const label = arg('label') ?? 'after';
const only = arg('only')?.split(',');
const base = `http://localhost:${port}`;
mkdirSync(out, { recursive: true });

interface Subject {
  id: string;
  /** Entity id on `beit_sahwan_outskirts&sur` (`__lions.units()`). */
  selected: number;
  /** Where the right click sends it. */
  dest: [number, number];
}
const SUBJECTS: Subject[] = [
  { id: 'rifle', selected: 6, dest: [15.5, 22.5] }, // inf_squad, rifles (small_arms)
  { id: 'hmg', selected: 4, dest: [15.5, 23.5] }, // apc_eitan, rws_50 (hmg)
];

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--use-gl=angle', '--enable-gpu-rasterization', '--disable-gpu-sandbox'],
});
const results: Record<string, unknown>[] = [];
try {
  for (const s of SUBJECTS) {
    if (only && !only.includes(s.id)) continue;
    results.push(await capture(s));
  }
} finally {
  await browser.close();
}
const resultsPath = join(out, 'results.json');
const prior: Record<string, unknown>[] = existsSync(resultsPath) ? JSON.parse(readFileSync(resultsPath, 'utf8')) : [];
const key = (r: Record<string, unknown>): string => `${String(r.label)}/${String(r.id)}`;
writeFileSync(
  resultsPath,
  JSON.stringify([...prior.filter((p) => !results.some((r) => key(r) === key(p))), ...results], null, 2)
);

async function clickWorld(page: Page, x: number, y: number, button: 'left' | 'right'): Promise<void> {
  const p = await page.evaluate(([wx, wy]) => (window as unknown as LionsWindow).__lions.renderer.worldToScreen(wx, wy), [x, y]);
  const box = await page.locator('canvas').first().boundingBox();
  await page.mouse.move((box?.x ?? 0) + p.x, (box?.y ?? 0) + p.y);
  await page.waitForTimeout(120);
  await page.mouse.click((box?.x ?? 0) + p.x, (box?.y ?? 0) + p.y, { button });
  await page.waitForTimeout(150);
}

async function frameOn(page: Page, sel: number, zoom: number): Promise<void> {
  await page.evaluate(
    ([i, z]) => {
      const L = (window as unknown as LionsWindow).__lions;
      const r = L.renderer;
      const t = L.sim.state.curTarget[i];
      const ax = r.curX[i];
      const ay = r.curY[i];
      const bx = t >= 0 ? r.curX[t] : ax;
      const by = t >= 0 ? r.curY[t] : ay;
      // Biased down-screen (+x,+y) so the duel sits above the unit card.
      r.camera.x = (ax + bx) / 2 + 2.2 / z;
      r.camera.y = (ay + by) / 2 + 2.2 / z;
      r.camera.zoom = z;
    },
    [sel, zoom]
  );
}

async function capture(s: Subject): Promise<Record<string, unknown>> {
  const tag = `${label}-${s.id}`;
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  await page.addInitScript(musicOffInitScript());
  page.on('pageerror', (e) => console.log(`  [${tag}] pageerror`, e.message));
  await page.goto(`${base}/?sandbox=beit_sahwan_outskirts&sur`);
  await page.waitForFunction(() => !!(window as unknown as LionsWindow).__lions?.renderer, null, { timeout: 180000 });
  await page.waitForTimeout(5000); // meshes

  await page.evaluate(() => {
    const r = (window as unknown as LionsWindow).__lions.renderer;
    r.camera.x = 9.5;
    r.camera.y = 21;
    r.camera.zoom = 1.1;
  });
  await page.waitForTimeout(400);
  const [ux, uy] = await page.evaluate(
    (i) => [(window as unknown as LionsWindow).__lions.renderer.curX[i], (window as unknown as LionsWindow).__lions.renderer.curY[i]],
    s.selected
  );
  await clickWorld(page, ux, uy, 'left');
  const sel = await page.evaluate(() => (window as unknown as LionsWindow).__lions.renderer.selection);
  if (sel.length !== 1 || sel[0] !== s.selected) throw new Error(`[${tag}] click did not select ${s.selected}: ${JSON.stringify(sel)}`);
  await clickWorld(page, s.dest[0], s.dest[1], 'right');
  await page.mouse.move(1100, 140);

  // Wait for the duel: the subject has a target AND a hostile has it.
  const t0 = Date.now();
  for (;;) {
    const ok = await page.evaluate((i) => {
      const L = (window as unknown as LionsWindow).__lions;
      const st = L.sim.state;
      if (st.curTarget[i] < 0) return false;
      for (let j = 0; j < L.sim.entityCount; j++) if (st.alive[j] && st.side[j] === 1 && st.curTarget[j] === i) return true;
      return false;
    }, s.selected);
    if (ok) break;
    if (Date.now() - t0 > 90000) {
      const why = await page.evaluate((i) => {
        const L = (window as unknown as LionsWindow).__lions;
        const st = L.sim.state;
        return { alive: st.alive[i], moving: st.moving[i], target: st.curTarget[i], x: L.renderer.curX[i], y: L.renderer.curY[i] };
      }, s.selected);
      throw new Error(`[${tag}] no duel within 90 s: ${JSON.stringify(why)}`);
    }
    await frameOn(page, s.selected, 1.4);
    await page.waitForTimeout(250);
  }
  // Halt it through the real hotkey, so the move order's own route line (the
  // lime accent the overlay tier draws for a unit under way) is not in the
  // picture -- it runs from the unit to its goal and reads as a fire line.
  await page.keyboard.press('h');
  await page.waitForTimeout(600);
  const tick0 = await page.evaluate(() => (window as unknown as LionsWindow).__lions.sim.tickCount);

  // Freeze on a frame with small-arms fire in the air: a streak (new code)
  // or a full-span tracer (old code).
  const t1 = Date.now();
  let active = false;
  while (Date.now() - t1 < 30000) {
    active = await page.evaluate(`(() => { const r = window.__lions.renderer;
      return r.bolts.some((b) => (b.kind === 'rifle' || b.kind === 'mg') && b.t > 0.06) || r.tracers.length > 0; })()`);
    if (active) break;
    await page.waitForTimeout(16);
  }
  // Freeze: hold the app's frame callbacks instead of running them, so the
  // loop can be released again for the strips afterwards.
  await page.evaluate(`(async () => {
    const raf = window.requestAnimationFrame.bind(window);
    window.__flRaf = raf;
    window.__flHeld = [];
    window.requestAnimationFrame = function (cb) { window.__flHeld.push(cb); return 0; };
    await new Promise((res) => raf(() => raf(res)));
  })()`);
  const stills: string[] = [];
  for (const z of [1, 2]) {
    await frameOn(page, s.selected, z);
    await page.evaluate(() => (window as unknown as LionsWindow).__lions.renderer.frame(1, 0));
    const f = `${tag}-z${z}.png`;
    await page.screenshot({ path: join(out, f) });
    stills.push(f);
  }
  const card = `${tag}-card.png`;
  const cardEl = page.locator('.rl-card').first();
  // The card is gone if the subject died before the freeze; say so.
  const cardShot = (await cardEl.count()) > 0 && (await cardEl.isVisible());
  if (cardShot) await cardEl.screenshot({ path: join(out, card), timeout: 5000 });
  else console.log(`  [${tag}] no unit card visible at the freeze (subject dead or deselected)`);

  const calls = await page.evaluate(`(() => {
    const r = window.__lions.renderer;
    const gl = r.renderer;
    const count = () => { gl.info.autoReset = false; gl.info.reset(); r.frame(1, 0); const n = gl.info.render.calls; gl.info.autoReset = true; return n; };
    const asIs = count();
    const out = { asIs };
    const streaks = r.bolts.filter((b) => b.kind === 'rifle' || b.kind === 'mg');
    out.streaksInAir = streaks.length;
    if (streaks.length > 0) {
      // The same rounds as old-style full-span tracers, streaks removed.
      const savedB = r.bolts, savedT = r.tracers;
      r.bolts = savedB.filter((b) => !(b.kind === 'rifle' || b.kind === 'mg'));
      r.tracers = savedT.concat(streaks.map((b) => ({ sx: b.sx, sy: b.sy, tx: b.tx, ty: b.ty, ttl: 0.1, side: b.side })));
      out.asOldTracers = count();
      r.bolts = savedB; r.tracers = savedT;
    }
    if (Array.isArray(r.fireLinkPulses)) {
      const savedP = r.fireLinkPulses, savedF = r.fireLinkFlashes;
      out.pulsesLive = savedP.length;
      out.flashedNow = r.fireLinkFlashed.size;
      for (const [, list] of r.fireLinkFlashed) for (const { mesh, was } of list) mesh.material = was;
      r.fireLinkFlashed.clear();
      r.fireLinkPulses = []; r.fireLinkFlashes = [];
      out.withoutFireLink = count();
      r.fireLinkPulses = savedP; r.fireLinkFlashes = savedF;
    }
    return out;
  })()`);
  await page.evaluate(`(() => {
    window.requestAnimationFrame = window.__flRaf;
    for (const cb of window.__flHeld) window.requestAnimationFrame(cb);
  })()`);

  // 3-second strips, game running.
  const strips: Record<string, string[]> = {};
  for (const z of [1, 2]) {
    const frames: string[] = [];
    for (let k = 0; k < 8; k++) {
      await frameOn(page, s.selected, z);
      const f = `${tag}-z${z}-strip-${k}.png`;
      await page.screenshot({ path: join(out, f), clip: { x: 250, y: 120, width: 900, height: 540 } });
      frames.push(f);
      await page.waitForTimeout(260);
    }
    strips[`z${z}`] = frames;
  }

  const tick1 = await page.evaluate(() => (window as unknown as LionsWindow).__lions.sim.tickCount);
  await page.close();
  console.log(`[${tag}] active=${active} ticks ${tick0}->${tick1} calls ${JSON.stringify(calls)}`);
  return { id: s.id, label, active, tick0, tick1, calls, stills, strips, card: cardShot ? card : null };
}
