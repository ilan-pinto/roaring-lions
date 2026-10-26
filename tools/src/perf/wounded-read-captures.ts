/**
 * GH-707 wounded readability: the before/after capture instrument.
 *
 * The `wounded-read` debug layer (`three/debug-layers.ts`) puts today's faint team ring and an
 * unlifted figure back, so ONE page photographs both: hide the layer, repaint at zero elapsed time,
 * shoot; show it, repaint, shoot. Same frame, same tick, same camera. It runs against a dev server
 * you started yourself (never 5177), on the real Metal GPU, music off, one browser:
 *
 *   cd tools && npx tsx src/perf/wounded-read-captures.ts --port=5183 --out=<dir> [--only=enemy,own-dusk]
 *
 * Scenes are sandboxes with wounded men SPAWNED beside corpses (`sim.spawn` of a `wounded_*` type,
 * `debugKill` for the corpses): a scene-setting shortcut, which is fine for a look -- the pulse and
 * arc are read off the real `woundState`/`bleedTicks` columns the renderer reads in play. Camera
 * and zoom are set on the renderer's own camera and the frame loop is frozen
 * (`FREEZE_FRAME_LOOP_SCRIPT`), the clock the pulse reads is the SIM clock, so `step(n)` is how the
 * pulse frames advance.
 */
import { chromium, type Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { FREEZE_FRAME_LOOP_SCRIPT } from '../golden-diff/capture-protocol';
import { readUnmaskedRenderer } from '../golden-diff/browser';
import { musicOffInitScript } from '../ui-review/music-off';

const args = process.argv.slice(2);
const arg = (k: string, d: string): string => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const PORT = Number(arg('port', '0'));
if (!PORT) throw new Error('--port=<n> is required (your own dev server; 5177 is the lead’s)');
if (PORT === 5177) throw new Error('5177 is the lead’s dev server');
const OUT = path.resolve(arg('out', '.superpowers/wounded-read'));
const REDUCED = args.includes('--reduced');
const ONLY = arg('only', '').split(',').filter(Boolean);
const PROBE = arg('probe', '');
const PULSE = arg('pulse', '');
const VIEWPORT = { width: 1400, height: 900 } as const;
const CROP = { width: 460, height: 300 } as const;
fs.mkdirSync(OUT, { recursive: true });

/** Where the man is inside each saved crop, for the sheet's own crop. */
const META: Record<string, { mx: number; my: number }> = {};

interface L {
  step(n: number): number;
  units(side?: number): { id: number; type: string; x: number; y: number }[];
  renderer: {
    camera: { x: number; y: number; zoom: number };
    frame(alpha: number, dtMs: number): void;
    worldToScreen(x: number, y: number): { x: number; y: number };
    setDebugLayerVisible(name: string, visible: boolean): number;
    meshUnitEntities: Map<number, { actions: Map<string, unknown> }>;
    selection: number[];
  };
  sim: {
    tickCount: number;
    width: number;
    height: number;
    blocked: Uint8Array;
    structureCount: number;
    structures: { alive: Uint8Array; minX: Int32Array; maxX: Int32Array; minY: Int32Array; maxY: Int32Array };
    unitTypes: { id: string }[];
    state: {
      alive: Uint8Array;
      side: Uint8Array;
      posX: Int32Array;
      posY: Int32Array;
      bleedTicks: Int32Array;
      woundState: Uint8Array;
      woundParent: Int32Array;
      typeIdx: Int32Array;
    };
    spawn(typeIdx: number, side: number, x: number, y: number): number;
    debugKill(id: number): void;
  };
}
type W = { __lions: L };

async function open(page: Page, map: string, flags: string): Promise<void> {
  await page.goto(`http://localhost:${PORT}/?sandbox=${map}${flags}`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window as unknown as W).__lions?.renderer);
  await page.evaluate(FREEZE_FRAME_LOOP_SCRIPT);
}

/** Spawns `typeId` on `side` at tile (x, y); returns its entity id. */
async function spawn(page: Page, typeId: string, side: number, x: number, y: number): Promise<number> {
  return page.evaluate(
    ([t, s, px, py]) => {
      const L = (window as unknown as W).__lions;
      const idx = L.sim.unitTypes.findIndex((u) => u.id === t);
      if (idx < 0) throw new Error(`no unit type ${t}`);
      return L.sim.spawn(idx, s as number, (px as number) * 65536, (py as number) * 65536);
    },
    [typeId, side, x, y] as const
  );
}

async function waitMeshes(page: Page, ids: number[], tickEach = 0): Promise<void> {
  // A unit spawned mid-mission is seeded by the next snapshot, which is taken on a tick.
  await page.evaluate(() => (window as unknown as W).__lions.step(1));
  for (let n = 0; n < 200; n++) {
    const missing = await page.evaluate(([want, ticks]) => {
      const L = (window as unknown as W).__lions;
      if (ticks) L.step(ticks);
      L.renderer.frame(1, 16);
      return (want as number[]).filter((id) => {
        const e = L.renderer.meshUnitEntities.get(id);
        return !e || e.actions.size === 0;
      });
    }, [ids, tickEach] as const);
    if (missing.length === 0) return;
    await page.waitForTimeout(250);
  }
  console.log('  warning: meshes never arrived for', ids.join(','));
}

async function frameAt(page: Page, x: number, y: number, zoom: number): Promise<{ sx: number; sy: number }> {
  return page.evaluate(
    ([px, py, z]) => {
      const L = (window as unknown as W).__lions;
      const c = L.renderer.camera;
      c.x = px as number;
      c.y = py as number;
      c.zoom = z as number;
      L.renderer.frame(1, 0);
      const p = L.renderer.worldToScreen(px as number, py as number);
      return { sx: p.x, sy: p.y };
    },
    [x, y, zoom] as const
  );
}

async function repaint(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as W).__lions.renderer.frame(1, 0));
}

async function layer(page: Page, on: boolean): Promise<number> {
  const n = await page.evaluate((v) => (window as unknown as W).__lions.renderer.setDebugLayerVisible('wounded-read', v), on);
  await repaint(page);
  return n;
}

async function shoot(page: Page, name: string, at: { sx: number; sy: number }, crop = CROP): Promise<string> {
  const clip = {
    x: Math.max(0, Math.min(VIEWPORT.width - crop.width, at.sx - crop.width / 2)),
    y: Math.max(0, Math.min(VIEWPORT.height - crop.height, at.sy - crop.height / 2 - 20)),
    width: crop.width,
    height: crop.height,
  };
  const file = path.join(OUT, `${name}.png`);
  META[name] = { mx: at.sx - clip.x, my: at.sy - clip.y };
  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(META));
  await page.screenshot({ path: file, clip });
  console.log('  saved', name);
  return file;
}

/** One before/after pair of the same frame. */
async function pair(page: Page, name: string, at: { sx: number; sy: number }, crop = CROP): Promise<void> {
  await layer(page, false);
  await shoot(page, `${name}-before`, at, crop);
  const lifted = await layer(page, true);
  await shoot(page, `${name}-after`, at, crop);
  console.log(`  (${lifted} lifted materials)`);
}

async function setBleed(page: Page, id: number, fraction: number, full: number): Promise<void> {
  await page.evaluate(([i, f, n]) => {
    (window as unknown as W).__lions.sim.state.bleedTicks[i as number] = Math.round((f as number) * (n as number));
  }, [id, fraction, full] as const);
}

/** The open 3x3 block farthest from every living unit: a quiet corner, away from the sandbox's fight. */
async function quietSpot(page: Page): Promise<[number, number]> {
  return page.evaluate(() => {
    const L = (window as unknown as W).__lions;
    const { width, height, blocked } = L.sim;
    const st = L.sim.state;
    const live: [number, number][] = [];
    for (let i = 0; i < L.sim.state.alive.length; i++) {
      if (st.alive[i] === 1) live.push([st.posX[i] / 65536, st.posY[i] / 65536]);
    }
    let best: [number, number] = [0, 0];
    let bestD = -1;
    for (let y = 8; y < height - 8; y += 2) {
      for (let x = 8; x < width - 8; x += 2) {
        let ok = true;
        for (let dy = -3; dy <= 3 && ok; dy++) {
          for (let dx = -4; dx <= 4; dx++) if (blocked[(y + dy) * width + x + dx] !== 0) ok = false;
        }
        if (!ok) continue;
        let d = 1e9;
        for (const [ux, uy] of live) d = Math.min(d, Math.hypot(ux - x, uy - y));
        if (d > bestD) {
          bestD = d;
          best = [x, y];
        }
      }
    }
    return best;
  });
}

/** Advance the renderer's own frame clock (death clips, mixers) by `ms`, 16 ms a frame. */
async function advance(page: Page, ms: number): Promise<void> {
  await page.evaluate((total) => {
    for (let done = 0; done < total; done += 16) (window as unknown as W).__lions.renderer.frame(1, 16);
  }, ms);
}

/** Overview of a map at a zoom with a tile->screen table, for choosing a spot by eye (`--probe=<map>[&flags]`). */
async function probe(page: Page, spec: string): Promise<void> {
  const [map, ...rest] = spec.split('&');
  await open(page, map, rest.length ? `&${rest.join('&')}` : '');
  const [cx, cy] = arg('probe-center', '0,0').split(',').map(Number);
  const zoom = Number(arg('probe-zoom', '0.5'));
  const info = await page.evaluate(([cx, cy, zoom]) => {
    const L = (window as unknown as W).__lions;
    const { width, height } = L.sim;
    L.renderer.camera.x = cx || width / 2;
    L.renderer.camera.y = cy || height / 2;
    L.renderer.camera.zoom = zoom;
    L.renderer.frame(1, 0);
    const grid: { x: number; y: number; sx: number; sy: number }[] = [];
    for (let y = 1; y < height; y += 1) {
      for (let x = 1; x < width; x += 1) {
        const p = L.renderer.worldToScreen(x, y);
        grid.push({ x, y, sx: p.x, sy: p.y });
      }
    }
    return { width, height, grid };
  }, [cx, cy, zoom] as const);
  fs.writeFileSync(path.join(OUT, `probe-${map}.json`), JSON.stringify(info));
  await page.screenshot({ path: path.join(OUT, `probe-${map}.png`) });
  console.log('probe saved', map, info.width, info.height);
}


/** Steps the sim until `tickCount % 32 === phaseTick`: the ring's pulse is `sin(tick/20 s x 2pi/1.6 s)`,
 *  so tick 8 of 32 is its brightest and tick 24 its dimmest. */
async function toPulsePhase(page: Page, phaseTick: number): Promise<void> {
  await page.evaluate((target) => {
    const L = (window as unknown as W).__lions;
    while (L.sim.tickCount % 32 !== target) L.step(1);
  }, phaseTick);
}

/** Frames the camera on entity `id` at `zoom`, wherever it has crawled to. */
async function frameOn(page: Page, id: number, zoom: number): Promise<{ sx: number; sy: number }> {
  return page.evaluate(
    ([e, z]) => {
      const L = (window as unknown as W).__lions;
      const px = L.sim.state.posX[e as number] / 65536;
      const py = L.sim.state.posY[e as number] / 65536;
      const c = L.renderer.camera;
      c.x = px;
      c.y = py;
      c.zoom = z as number;
      L.renderer.frame(1, 0);
      const p = L.renderer.worldToScreen(px, py);
      return { sx: p.x, sy: p.y };
    },
    [id, zoom] as const
  );
}

interface Spec {
  readonly id: string;
  readonly map: string;
  readonly flags: string;
  /** Tile, or 'quiet' for the open block farthest from every unit. */
  readonly spot: readonly [number, number] | 'quiet';
  /** The wounded man's side. */
  readonly side: 0 | 1;
  /** Nudge from the spot, tiles, to step off a tree. */
  readonly nudge?: readonly [number, number];
  /** Two enemy corpses beside him. */
  readonly corpses: boolean;
  /** An own squad to see with, for an enemy in a corner. */
  readonly observer: boolean;
  readonly zooms: readonly number[];
  /** Bleed left, 0..1. */
  readonly bleed: number;
}

const SPECS: Spec[] = [
  { id: 'enemy', map: 'beit_sahwan_outskirts', flags: '', spot: 'quiet', side: 1, corpses: true, observer: true, zooms: [1, 2.5], bleed: 0.7 },
  { id: 'own-dusk', map: 'wadi_halam_4', flags: '&tod=dusk', spot: [12, 16], side: 0, corpses: false, observer: false, zooms: [1, 2.5], bleed: 0.6 },
  { id: 'own-shadow', map: 'wadi_halam_4', flags: '&tod=dusk', spot: [17, 9], side: 0, corpses: false, observer: false, zooms: [1, 2.5], bleed: 0.45 },
];

/** Spawns a scene and returns the wounded man's id. */
async function build(page: Page, spec: Spec): Promise<number> {
  const base = spec.spot === 'quiet' ? await quietSpot(page) : spec.spot;
  const over = arg('nudge', '').split(',').map(Number);
  const nudge = over.length === 2 && !over.some(Number.isNaN) ? over : (spec.nudge ?? [0, 0]);
  const x = base[0] + nudge[0];
  const y = base[1] + nudge[1];
  const ids: number[] = [];
  if (spec.observer) ids.push(await spawn(page, 'inf_squad', 0, x - 5, y + 3));
  const dead: number[] = [];
  if (spec.corpses) {
    dead.push(await spawn(page, 'sarim_rifles', 1, x - 1.3, y + 0.2));
    dead.push(await spawn(page, 'sarim_rifles', 1, x - 0.5, y - 0.9));
  }
  const w = await spawn(page, spec.side === 0 ? 'wounded_kdf' : 'wounded_sarim', spec.side, x + 0.5, y + 0.1);
  ids.push(...dead, w);
  await frameAt(page, x, y, 1);
  await waitMeshes(page, ids, spec.corpses ? 2 : 0);
  if (dead.length > 0) {
    await page.evaluate((d) => {
      const L = (window as unknown as W).__lions;
      for (const e of d) L.sim.debugKill(e);
      L.step(1);
    }, dead);
    await advance(page, 2500);
  }
  await setBleed(page, w, spec.bleed, 1200);
  return w;
}

async function runSpec(page: Page, spec: Spec): Promise<void> {
  const w = await build(page, spec);
  for (const z of spec.zooms) {
    for (const [tag, tick] of [['peak', 8], ['trough', 24]] as const) {
      await toPulsePhase(page, tick);
      const at = await frameOn(page, w, z);
      await pair(page, `${spec.id}-z${z}-${tag}`, at);
    }
  }
}

/** The pulse as frames: one sim tick (50 ms) a frame over `ticks` ticks, ring on, camera on the man. */
async function pulseFrames(page: Page, spec: Spec, zoom: number, ticks: number): Promise<void> {
  // No corpses here: a body's death clip runs on the frame clock, which a one-tick step does not advance.
  const w = await build(page, { ...spec, corpses: false });
  const crop = { width: 300, height: 200 };
  const dir = path.join(OUT, `pulse-${spec.id}`);
  fs.mkdirSync(dir, { recursive: true });
  await layer(page, true);
  for (let k = 0; k < ticks; k++) {
    await page.evaluate(() => (window as unknown as W).__lions.step(1));
    const at = await frameOn(page, w, zoom);
    const clip = {
      x: Math.max(0, Math.min(VIEWPORT.width - crop.width, at.sx - crop.width / 2)),
      y: Math.max(0, Math.min(VIEWPORT.height - crop.height, at.sy - crop.height / 2 - 20)),
      ...crop,
    };
    await page.screenshot({ path: path.join(dir, `f${String(k).padStart(3, '0')}.png`), clip });
  }
  console.log('  pulse frames', ticks, 'in', dir);
}

async function main(): Promise<void> {
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--use-gl=angle', '--enable-gpu-rasterization', '--disable-gpu-sandbox'],
  });
  try {
    console.log('GPU:', await readUnmaskedRenderer(browser));
    const page = await browser.newPage({ viewport: { ...VIEWPORT }, deviceScaleFactor: 1 });
    await page.addInitScript(musicOffInitScript());
    // tsx's keepNames wraps inner functions in `__name`, which a serialised evaluate callback lacks.
    await page.addInitScript('window.__name = (f) => f;');
    page.setDefaultTimeout(120000);
    page.on('pageerror', (e) => console.log('  page error:', e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') console.log('  console error:', m.text().slice(0, 200));
    });
    if (PROBE) {
      await probe(page, PROBE);
      await page.close();
      return;
    }
    if (REDUCED) {
      // Reduced motion must hold the ring steady: `uPulseOn` is the uniform the shader's breathe is
      // multiplied by (a private field read, the way `render-frame-cost.ts` reads `renderer.info`).
      // A man who crawls would differ between two frames anyway, so the uniform is the witness.
      const read = (): Promise<number> =>
        page.evaluate(() => {
          const r = (window as unknown as W).__lions.renderer as unknown as {
            woundRing: { mesh: { material: { uniforms: { uPulseOn: { value: number } } } } };
          };
          return r.woundRing.mesh.material.uniforms.uPulseOn.value;
        });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const spec = SPECS[0];
      await open(page, spec.map, spec.flags);
      const w = await build(page, spec);
      await frameOn(page, w, 1);
      const reduced = await read();
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await frameOn(page, w, 1);
      const normal = await read();
      console.log(`uPulseOn: reduced-motion ${reduced}, no-preference ${normal}`);
      await page.close();
      return;
    }
    for (const spec of SPECS) {
      if (ONLY.length > 0 && !ONLY.includes(spec.id)) continue;
      console.log(`scene ${spec.id}`);
      await open(page, spec.map, spec.flags);
      await runSpec(page, spec);
    }
    if (PULSE) {
      const spec = SPECS.find((sp) => sp.id === PULSE);
      if (!spec) throw new Error(`--pulse=${PULSE} names no scene`);
      await open(page, spec.map, spec.flags);
      await pulseFrames(page, spec, Number(arg('pulse-zoom', '1')), 40);
    }
    await page.close();
  } finally {
    await browser.close();
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
