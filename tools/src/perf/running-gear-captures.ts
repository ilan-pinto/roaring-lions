/**
 * Wheels that spin and tracks that scroll, photographed in motion (GH-177's
 * second half; design `docs/superpowers/specs/2026-10-12-wheels-and-tracks-
 * design.md` §4). Rides on `weight-captures.ts`'s spawn and phase
 * choreography, under the same command:
 *
 *   pnpm weight:capture -- --running-gear [--only=jeep_shoded,ifv_namer]
 *       [--out=<dir>] [--port=<n> | RUNNING_GEAR_PORT] [--gpu=metal|swiftshader] [--frames=24]
 *
 * **Why this exists at all: no gated golden scenario moves a vehicle.**
 * `vehicle` and `kitted` park the sandbox force, `relief` recoils two Lavis
 * in place, and `combat` is report-only. The golden gate can therefore only
 * confirm that parked vehicles did not move. Whether wheels turn is
 * witnessed here, by the `running-gear` debug layer's A/B on a vehicle that
 * IS moving:
 *
 * - Pump one real 60 fps frame with the vehicle cruising. That is the AFTER
 *   picture.
 * - Hide the layer and repaint at zero elapsed time. Everything else in the
 *   frame is frozen to the same alpha and the same clocks, so the wheels sit
 *   at rest and the tread is off. That is the BEFORE picture.
 * - Diff the two crops. A moving lane must change by at least its floor
 *   (`RG_TOGGLE_FLOORS`, a third of a measured signal: the `blast-captures`
 *   rule).
 *
 * `runningGearDebugHidden` is a FLAG the per-frame uniform write reads, not a
 * one-off write. A toggle that only holds until the next frame would be no
 * measurement at all (CLAUDE.md, the `vehicle` scenario's `units` lesson).
 *
 * **The control is a parked vehicle, and it must read exactly 0.** Before its
 * move order, each subject has never moved, so it is not bound to the
 * running-gear material at all: the layer reports 0 bound vehicles and the
 * A/B reads 0 px. That is the claim the golden gate depends on, measured.
 *
 * The before/after pairs are the evidence the lead judges: one flip page per
 * subject that plays both at 60 fps side by side, and one contact strip per
 * lane. They use ONE browser (Metal by default on macOS), music off, and a
 * port of their own that is refused if anything already holds it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { musicOffInitScript } from '../ui-review/music-off';
import { gpuLaunchArgs, resolveGpuBackend } from '../ui-review/gpu';
import { decidePort } from '../ui-review/port';
import { beginPhase, settleTickFloor, spawnBare, waitForMesh, type LionsWindow, type WeightPhase, type WeightSubject } from './weight-captures';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** The four vehicles the lead asked to see (a jeep, the Namer's wheels and
 *  tracks, the Lavi's tracks, the D9), on `weight-captures.ts`'s open
 *  northern band. Each lane gets its own page and its own sim. */
export const RG_CAPTURE_SUBJECTS: readonly WeightSubject[] = [
  { id: 'jeep_shoded', map: 'beit_sahwan_outskirts', x: 2, y: 2, turnSign: 1, why: 'wheels spin and the front axle steers' },
  { id: 'ifv_namer', map: 'beit_sahwan_outskirts', x: 2, y: 2, turnSign: 1, why: 'road wheels spin and the tracks scroll' },
  { id: 'mbt_lavi', map: 'beit_sahwan_outskirts', x: 2, y: 2, turnSign: 1, why: 'tracks scroll (A3: road wheels static)' },
  { id: 'dozer_d9', map: 'beit_sahwan_outskirts', x: 2, y: 2, turnSign: 1, why: 'tracks scroll (A4: road wheels static)' },
];

export const RG_CAPTURE_PHASES: readonly WeightPhase[] = ['start', 'turn'];
export const RG_CAPTURE_ZOOMS: readonly number[] = [1, 2.5];

/** Crop per zoom, CSS px, centred on the vehicle. */
const CROP: Readonly<Record<number, { w: number; h: number }>> = { 1: { w: 240, h: 160 }, 2.5: { w: 560, h: 360 } };
/** Ticks of cruise before the `start` lane is photographed, so the wheels are
 *  turning at speed rather than spinning up. */
const START_CRUISE_TICKS = 24;
const FRAME_MS = 1000 / 60;
const TICK_MS = 1000 / 20;
const FIXED = 65536;
const PORT = 5196;
const VIEWPORT = { width: 1400, height: 900 } as const;
const SETTLE_MS = 2500;
const SETTLE_VIEWPORT = { width: 320, height: 200 } as const;
/** pixelmatch's per-pixel threshold for the A/B count. Lower than the golden
 *  gate's 0.1 because the bars are a mean-preserving 35% modulation and a
 *  wheel's turn moves texture, not silhouette. */
const DIFF_THRESHOLD = 0.05;

/**
 * Per lane (`<subject>|<phase>|z<zoom>`): the floor the lane's LARGEST
 * per-frame A/B must reach, in exactly-changed pixels. A third of the
 * smaller of two calibration runs (the `blast-captures` rule), each run's
 * peak beside it, and verified on a third. Measured 2026-10-12 on darwin-arm64 (Apple M3 Pro), headless
 * Chromium on ANGLE/Metal, 24 frames a lane. See `RG_TOGGLE_FLOOR_NOTE`.
 */
export const RG_TOGGLE_FLOORS: Readonly<Record<string, number>> = {
  // lane: floor  -- (run 1 peak, run 2 peak) of exactly-changed pixels
  'jeep_shoded|start|z1': 59, // (179, 179)
  'jeep_shoded|start|z2.5': 351, // (1055, 1056)
  'jeep_shoded|turn|z1': 47, // (141, 141)
  'jeep_shoded|turn|z2.5': 192, // (591, 578)
  'ifv_namer|start|z1': 197, // (591, 591)
  'ifv_namer|start|z2.5': 1433, // (4343, 4300)
  'ifv_namer|turn|z1': 124, // (374, 377)
  'ifv_namer|turn|z2.5': 708, // (2125, 3044)
  // The Lavi's track is a slice under its hull skirt: from the game camera it
  // shows a few pixels at zoom 1. A floor of 1 says only "it moved at all".
  'mbt_lavi|start|z1': 1, // (4, 4)
  'mbt_lavi|start|z2.5': 19, // (59, 58)
  'mbt_lavi|turn|z1': 1, // (4, 4)
  'mbt_lavi|turn|z2.5': 12, // (36, 44)
  'dozer_d9|start|z1': 80, // (252, 241)
  'dozer_d9|start|z2.5': 868, // (2612, 2605)
  'dozer_d9|turn|z1': 60, // (183, 180)
  'dozer_d9|turn|z2.5': 821, // (2553, 2463)
};
export const RG_TOGGLE_FLOOR_NOTE =
  'a third of the smaller of two calibration runs (24 and 12 frames), verified on a third run of 24';

export interface ToggleFrame {
  readonly frame: number;
  /** Pixels that differ AT ALL between the two crops. The voting metric: the
   *  frame is frozen, so the control reads exactly 0 and any change is the
   *  layer's. The tread is a 35% modulation of baked track, and on the
   *  darker bakes (the D9, the Lavi) most of it moves a pixel by under 13
   *  levels, which pixelmatch's perceptual threshold does not count. */
  readonly changedPixels: number;
  /** pixelmatch's perceptual count, reported beside it. */
  readonly diffPixels: number;
  readonly meanAbsDelta: number;
}

export interface LaneReading {
  readonly lane: string;
  /** The parked control: the layer's bound-vehicle count and its A/B, before
   *  the move order. Both must be exactly 0. */
  readonly controlBound: number;
  readonly controlChangedPixels: number;
  readonly frames: readonly ToggleFrame[];
  /** The layer's bound-vehicle count once moving: 1. */
  readonly movingBound: number;
}

/** `null` for a pass, else why the lane fails. `calibrating` skips the floor
 *  but still holds the control and the binding. */
export function laneFailure(r: LaneReading, floors: Readonly<Record<string, number>>, calibrating = false): string | null {
  if (r.controlBound !== 0 || r.controlChangedPixels !== 0) {
    return `${r.lane}: the parked control bound ${r.controlBound} vehicle(s) and changed ${r.controlChangedPixels} px -- a vehicle that never moved must draw exactly as before`;
  }
  if (r.movingBound !== 1) return `${r.lane}: ${r.movingBound} vehicle(s) bound while moving, want 1`;
  if (r.frames.length === 0) return `${r.lane}: no frame photographed`;
  const peak = Math.max(...r.frames.map((f) => f.changedPixels));
  if (calibrating) return null;
  const floor = floors[r.lane];
  if (floor === undefined) return `${r.lane}: no floor in RG_TOGGLE_FLOORS -- run with --calibrate and set one`;
  if (peak < floor) return `${r.lane}: the running-gear A/B peaks at ${peak} px, under its floor ${floor}`;
  return null;
}

function arg(argv: readonly string[], name: string, fallback: string): string {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

function crop(png: PNG, cx: number, cy: number, w: number, h: number): PNG {
  const out = new PNG({ width: w, height: h });
  const x0 = Math.round(Math.min(Math.max(0, cx - w / 2), png.width - w));
  const y0 = Math.round(Math.min(Math.max(0, cy - h / 2), png.height - h));
  PNG.bitblt(png, out, x0, y0, w, h, 0, 0);
  return out;
}

function compare(a: PNG, b: PNG): { changedPixels: number; diffPixels: number; meanAbsDelta: number } {
  const diffPixels = pixelmatch(a.data, b.data, undefined, a.width, a.height, { threshold: DIFF_THRESHOLD });
  let sum = 0;
  let changedPixels = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
    sum += d;
    if (d > 0) changedPixels++;
  }
  return { changedPixels, diffPixels, meanAbsDelta: sum / ((a.data.length / 4) * 3) };
}

/** A contact strip: `before` frames on the top row, `after` below. */
function strip(before: readonly PNG[], after: readonly PNG[], every: number): PNG {
  const picks = before.map((_, i) => i).filter((i) => i % every === 0);
  const w = before[0].width;
  const h = before[0].height;
  const out = new PNG({ width: w * picks.length, height: h * 2 + 4 });
  out.data.fill(255);
  picks.forEach((i, k) => {
    PNG.bitblt(before[i], out, 0, 0, w, h, k * w, 0);
    PNG.bitblt(after[i], out, 0, 0, w, h, k * w, h + 4);
  });
  return out;
}

function flipPage(subject: string, lanes: readonly { lane: string; zoom: number; frames: number; dir: string }[]): string {
  const blocks = lanes
    .map(
      (l) => `<section><h2>${l.lane}</h2>
<div class="pair"><figure><figcaption>before (layer hidden: wheels at rest, no tread)</figcaption>
<img data-dir="${l.dir}" data-kind="before" data-n="${l.frames}" class="z${String(l.zoom).replace('.', '_')}"></figure>
<figure><figcaption>after</figcaption>
<img data-dir="${l.dir}" data-kind="after" data-n="${l.frames}" class="z${String(l.zoom).replace('.', '_')}"></figure></div></section>`
    )
    .join('\n');
  return `<!doctype html><meta charset="utf-8"><title>${subject} -- running gear</title>
<style>body{font:14px system-ui;background:#222;color:#ddd;margin:16px}.pair{display:flex;gap:16px}
figure{margin:0}img{image-rendering:pixelated;display:block;border:1px solid #444}img.z1{width:480px}img.z2_5{width:560px}
button{font-size:14px;margin:4px}</style>
<h1>${subject}: before / after, 60 fps, looping</h1>
<p>Each pair is the SAME frame twice: the game's frame (after) and that frame repainted at zero elapsed time with the
running-gear layer hidden (before). Zoom 1 crops are shown 2x, pixelated.
<button id="p">pause</button><button id="s">step</button> <span id="f"></span></p>
${blocks}
<script>
const imgs=[...document.querySelectorAll('img')];let i=0,run=true;
const show=()=>{for(const im of imgs){const n=+im.dataset.n;im.src=im.dataset.dir+'/f'+String(i%n).padStart(2,'0')+'-'+im.dataset.kind+'.png';}
document.getElementById('f').textContent='frame '+(i%imgs[0].dataset.n);};
show();setInterval(()=>{if(run){i++;show();}},1000/60);
document.getElementById('p').onclick=()=>{run=!run;};document.getElementById('s').onclick=()=>{run=false;i++;show();};
</script>`;
}

export async function runRunningGearCaptures(argv: readonly string[]): Promise<void> {
  const { chromium } = await import('playwright');
  const { ensureDevServer, stopDevServer, readUnmaskedRenderer } = await import('../golden-diff/browser');
  const { FREEZE_FRAME_LOOP_SCRIPT } = await import('../golden-diff/capture-protocol');

  const rawPort = arg(argv, 'port', '');
  if (rawPort === '5177' || rawPort === '5173') throw new Error(`refusing --port=${rawPort}: a human's own dev server lives there`);
  // `--port=<n>`, else RUNNING_GEAR_PORT, else 5196, and a port something
  // already holds is REFUSED, exit 2 (`ui-review/port.ts`). It read `lsof`
  // here before, which reports nothing at all where `lsof` is missing or
  // denied -- a probe that fails open. port.ts connects on both loopbacks.
  const claim = await decidePort('running-gear-captures', 'RUNNING_GEAR_PORT', PORT, argv, process.env, 'own');
  if (!claim.ok) {
    console.error(claim.message);
    process.exit(2);
  }
  const port = claim.port;
  console.log(`[running-gear-captures] serving on :${port} (${claim.source})`);
  const outRoot = path.resolve(REPO, arg(argv, 'out', path.join('.superpowers', 'art-captures', 'running-gear')));
  const nFrames = Number(arg(argv, 'frames', '24'));
  const calibrating = argv.includes('--calibrate');
  const only = arg(argv, 'only', '');
  const wanted = only ? RG_CAPTURE_SUBJECTS.filter((s) => only.split(',').includes(s.id)) : RG_CAPTURE_SUBJECTS;
  if (wanted.length === 0) throw new Error(`--only=${only} names no subject (have ${RG_CAPTURE_SUBJECTS.map((s) => s.id).join(', ')})`);
  const gpu = resolveGpuBackend(argv, process.platform);
  fs.mkdirSync(outRoot, { recursive: true });

  const readings: LaneReading[] = [];
  const server = await ensureDevServer(port, REPO, 'running-gear-captures');
  const browser = await chromium.launch({ headless: true, args: gpuLaunchArgs(gpu) });
  try {
    const gl = await readUnmaskedRenderer(browser);
    console.log(`[running-gear] gpu ${gpu}: ${gl}; ${nFrames} frames a lane; out ${outRoot}`);
    for (const subject of wanted) {
      const pageLanes: { lane: string; zoom: number; frames: number; dir: string }[] = [];
      for (const phase of RG_CAPTURE_PHASES) {
        const page = await browser.newPage({ viewport: { ...SETTLE_VIEWPORT }, deviceScaleFactor: 1 });
        await page.addInitScript(musicOffInitScript());
        page.setDefaultTimeout(120_000);
        page.on('pageerror', (err) => console.log('  page error:', err.message));
        await page.goto(`http://localhost:${port}/?sandbox=${subject.map}&renderer=three`, { waitUntil: 'load' });
        await page.waitForFunction(() => typeof (window as unknown as { __lions?: unknown }).__lions !== 'undefined');
        await page.waitForTimeout(SETTLE_MS);
        await page.evaluate(FREEZE_FRAME_LOOP_SCRIPT);
        await page.setViewportSize({ ...VIEWPORT });
        await page.evaluate(() => (window as unknown as LionsWindow).__lions.renderer.frame(1, 0));
        const notes: string[] = [];
        const entity = await spawnBare(page, subject.id, subject.x, subject.y);
        await waitForMesh(page, entity, notes, subject.id);
        await settleTickFloor(page, notes, subject.id);

        // The control: parked, never moved.
        const control = await abPair(page, entity, 1, 1);
        const controlBound = control.bound;

        await beginPhase(page, entity, { subject, phase });
        if (phase === 'start') await pump(page, entity, START_CRUISE_TICKS * (TICK_MS / FRAME_MS), 1);

        for (const zoom of RG_CAPTURE_ZOOMS) {
          const lane = `${subject.id}|${phase}|z${zoom}`;
          const dir = `${subject.id}-${phase}-z${String(zoom).replace('.', '_')}`;
          fs.mkdirSync(path.join(outRoot, dir), { recursive: true });
          const frames: ToggleFrame[] = [];
          const befores: PNG[] = [];
          const afters: PNG[] = [];
          let movingBound = 0;
          for (let f = 0; f < nFrames; f++) {
            await pump(page, entity, 1, zoom);
            const ab = await abPair(page, entity, zoom, 0);
            movingBound = ab.bound;
            const { w, h } = CROP[zoom];
            const after = crop(PNG.sync.read(ab.after), ab.cx, ab.cy, w, h);
            const before = crop(PNG.sync.read(ab.before), ab.cx, ab.cy, w, h);
            fs.writeFileSync(path.join(outRoot, dir, `f${String(f).padStart(2, '0')}-after.png`), PNG.sync.write(after));
            fs.writeFileSync(path.join(outRoot, dir, `f${String(f).padStart(2, '0')}-before.png`), PNG.sync.write(before));
            befores.push(before);
            afters.push(after);
            frames.push({ frame: f, ...compare(before, after) });
          }
          fs.writeFileSync(path.join(outRoot, `${dir}-strip.png`), PNG.sync.write(strip(befores, afters, 3)));
          const reading: LaneReading = { lane, controlBound, controlChangedPixels: control.changedPixels, frames, movingBound };
          readings.push(reading);
          pageLanes.push({ lane, zoom, frames: nFrames, dir });
          const peak = Math.max(...frames.map((x) => x.changedPixels));
          const mean = frames.reduce((s, x) => s + x.meanAbsDelta, 0) / frames.length;
          console.log(
            `  ${lane}: control bound ${controlBound}, ${control.changedPixels} px; moving bound ${movingBound}; ` +
              `A/B changed peak ${peak} px (min ${Math.min(...frames.map((x) => x.changedPixels))}), ` +
              `pixelmatch peak ${Math.max(...frames.map((x) => x.diffPixels))} px, mean |delta| ${mean.toFixed(4)}`
          );
        }
        for (const n of notes) console.log(`  note: ${n}`);
        await page.close();
      }
      fs.writeFileSync(path.join(outRoot, `${subject.id}-flip.html`), flipPage(subject.id, pageLanes));
    }
  } finally {
    await browser.close();
    stopDevServer(server, 'running-gear-captures');
  }

  fs.writeFileSync(path.join(outRoot, 'readings.json'), JSON.stringify({ gpu, floors: RG_TOGGLE_FLOORS, readings }, null, 1));
  let failed = 0;
  for (const r of readings) {
    const why = laneFailure(r, RG_TOGGLE_FLOORS, calibrating);
    if (why) {
      failed++;
      console.error(`FAIL ${why}`);
    } else {
      console.log(`PASS ${r.lane}${calibrating ? ' (calibrating: floor not applied)' : ''}`);
    }
  }
  if (failed > 0) process.exitCode = 1;
}

/** Advance `frames` real 60 fps frames with the camera on the vehicle:
 *  `sim.tick()` + `snapshot()` every third frame (20 Hz), and every frame a
 *  `renderer.frame(alpha, FRAME_MS)` -- the weight harness's hand-ticking. */
async function pump(page: import('playwright').Page, entity: number, frames: number, zoom: number): Promise<void> {
  await page.evaluate(
    ([id, n, z, frameMs, tickMs, fixed]) => {
      const L = (window as unknown as LionsWindow).__lions;
      const w = window as unknown as { __rgAlpha?: number };
      let alpha = w.__rgAlpha ?? 1;
      for (let i = 0; i < n; i++) {
        alpha += frameMs / tickMs;
        if (alpha > 1 + 1e-9) {
          const events = L.sim.tick();
          L.renderer.snapshot();
          L.renderer.onEvents(events);
          alpha -= 1;
        }
        const c = L.renderer.camera;
        c.x = L.sim.state.posX[id] / fixed;
        c.y = L.sim.state.posY[id] / fixed;
        c.zoom = z;
        L.renderer.frame(Math.min(1, alpha), frameMs);
      }
      w.__rgAlpha = alpha;
    },
    [entity, Math.round(frames), zoom, FRAME_MS, TICK_MS, FIXED] as const
  );
}

/** The frame as the game painted it (after), then the same frame repainted
 *  at zero elapsed time with the layer hidden (before), and the layer shown
 *  again. `paint` 1 repaints the "after" too (the control, where no frame
 *  was pumped at this zoom). */
async function abPair(
  page: import('playwright').Page,
  entity: number,
  zoom: number,
  paint: 0 | 1
): Promise<{ after: Buffer; before: Buffer; cx: number; cy: number; bound: number; changedPixels: number }> {
  const at = await page.evaluate(
    ([id, z, fixed, p]) => {
      const L = (window as unknown as LionsWindow).__lions;
      const w = window as unknown as { __rgAlpha?: number };
      const c = L.renderer.camera;
      if (p) {
        c.x = L.sim.state.posX[id] / fixed;
        c.y = L.sim.state.posY[id] / fixed;
        c.zoom = z;
        L.renderer.frame(Math.min(1, w.__rgAlpha ?? 1), 0);
      }
      const s = L.renderer.worldToScreen(c.x, c.y);
      return { x: s.x, y: s.y };
    },
    [entity, zoom, FIXED, paint] as const
  );
  const after = await page.screenshot();
  const bound = await page.evaluate(() => {
    const L = (window as unknown as LionsWindow).__lions;
    const r = L.renderer as unknown as { setDebugLayerVisible(n: string, v: boolean): number };
    const w = window as unknown as { __rgAlpha?: number };
    const n = r.setDebugLayerVisible('running-gear', false);
    L.renderer.frame(Math.min(1, w.__rgAlpha ?? 1), 0);
    return n;
  });
  const before = await page.screenshot();
  await page.evaluate(() => {
    const r = (window as unknown as LionsWindow).__lions.renderer as unknown as { setDebugLayerVisible(n: string, v: boolean): number };
    r.setDebugLayerVisible('running-gear', true);
  });
  const { w, h } = CROP[zoom];
  const { changedPixels } = compare(crop(PNG.sync.read(before), at.x, at.y, w, h), crop(PNG.sync.read(after), at.x, at.y, w, h));
  return { after, before, cx: at.x, cy: at.y, bound, changedPixels };
}
