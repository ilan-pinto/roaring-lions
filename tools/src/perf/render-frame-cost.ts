/**
 * Frame cost of the REAL renderer at the sandbox's own roster, three points
 * of view, hardware GPU. Not a unit-count curve (see three-units.ts for
 * that) -- a before/after instrument for a renderer change. Prints median
 * and p95 of `renderer.frame(1, 16)` in ms over 240 frames per view.
 *
 * It serves its own tree on `--port=<n>` (else RENDER_FRAME_COST_PORT, else
 * 5178), and a port something already holds is refused (`ui-review/port.ts`):
 *   npx tsx tools/src/perf/render-frame-cost.ts '?sandbox=beit_sahwan_outskirts&sur&civ' [--port=5178]
 * `--attach` drives a dev server you started on `--port` instead -- the
 * "before" half of a before/after, on a tree that has no copy of this file.
 * It used to take that server's URL as its first argument and time whatever
 * answered there, with no error.
 *
 * `--select-all` (anywhere in the arguments; A4, GH-186) selects every living
 * side-0 unit through `__lions.sel` before timing, so the selection's own
 * per-frame cost -- the ground rings, and the HP bars and range envelopes a
 * selection also draws -- is inside the figures. Run once with and once
 * without it and difference the two. Each view also prints its draw calls
 * (`renderer.info.render.calls` over one `frame()`), so the ring's promise of
 * exactly one extra draw call while anything is selected can be read off.
 *
 * The optional second argument is the CSS viewport, `WIDTHxHEIGHT`, default
 * `1440x900`. It exists for one job: the drawing buffer is that times the
 * renderer's pixel ratio (capped at 2), so doubling it quadruples the fill.
 * That is the positive control for the `gpu` figure below -- see "Is `gpu`
 * real".
 *
 * **It is not a pure fill control, and an earlier version of this comment
 * claimed it was.** This camera's orthographic frustum is sized FROM the CSS
 * viewport (`camera.ts`: `halfWidth = vp.width / (TILE_W * zoom * sqrt2)`),
 * so doubling the CSS size shows 4x the WORLD as well as drawing 4x the
 * pixels -- more tiles, more units, more draw calls. The zoom-0.5 row is the
 * closest thing to a fill-only change in the table, because at that zoom a
 * 48-tile map already overflows the 1440x900 frame and widening it mostly
 * adds empty ground. Read the control for what it proves -- that `gpu` moves
 * at all when the GPU is given more to do -- and not as a clean 4x-fill
 * coefficient.
 *
 * ## Two numbers per view, and the second one is the one a post pass moves
 *
 * `renderer.frame()` SUBMITS GL commands; it does not wait for them. So the
 * `cpu` figure is scene update plus draw-call submission and nothing else,
 * and a post pass that costs the GPU milliseconds of FILL can move it by
 * almost nothing -- in principle. `gpu` brackets the same call with
 * `gl.finish()`, which blocks until the queue has drained, so it is frame
 * WALL time on this canvas: a lower bound on what the display sees. Read
 * `gpu` for an accept/reject. (In practice, on the one platform this has
 * been run on, the two agree -- see the control below, which explains why
 * and why that is not the finding it looks like.)
 *
 * ## Is `gpu` real? -- the control, and why this file asserts so much
 *
 * A `gpu` figure that merely tracks `cpu` has two possible explanations, and
 * they call for opposite conclusions: the scene is submission-bound (a real
 * finding), or `gl.finish()` is draining a queue that was never the
 * renderer's (a broken instrument). The second is easy to get: ask a canvas
 * that has no context for `webgl2` and the browser hands you a brand new
 * empty one, which finishes instantly, forever.
 *
 * So this file does not guess at the canvas. `Renderer.canvas` is public
 * API (`packages/render/src/api.ts`), and the context is then checked to be
 * one this script did NOT create: `stencil: true` is in the renderer's own
 * context attributes and is not a default, and `CURRENT_PROGRAM` is non-null
 * only on a context that has actually drawn. Either check failing throws
 * with what it found rather than quietly reporting a number.
 *
 * The other half is the control run: same scene, 4x the pixels, not one draw
 * call different. **It was run, and its answer was not the expected one.**
 * `cpu` rose from 10.3 to 27.6 ms at the acceptance view and `gpu` from 10.6
 * to 27.5 -- a pure FILL change moved the supposedly submission-only figure
 * by 17 ms. So on this platform `frame()` does not return before the GPU
 * work: ANGLE/Metal applies back-pressure inside submission, and `cpu` is
 * already most of a wall-clock frame.
 *
 * Two consequences for anyone reading a number out of this file. `cpu` and
 * `gpu` agreeing is NOT evidence that a change is submission-bound rather
 * than fill-bound -- this instrument cannot separate those here, and Task 13
 * briefly claimed it could. And `cpu` is not the free-and-loose figure its
 * name suggests: it is a lower bound on frame time in its own right, with
 * `gpu` the stricter one. To attribute cost between submission and fill you
 * want a GPU timer query (`EXT_disjoint_timer_query_webgl2`), which this
 * file does not use.
 *
 * ## Presets, hidden layers and the flipbook stress (Defilade T4)
 *
 * `--quality=high|medium|low` seeds `lions.settings` (through
 * `musicOffInitScript`, so music stays off) before boot: the preset applies
 * at boot only, so one run measures one preset. `--hide=<layer>[,<layer>]`
 * hides `DEBUG_LAYERS` entries through `setDebugLayerVisible` before any
 * view is timed -- `--hide=bloom` is the bloom off half of an A/B. A layer
 * the tree does not know throws, BY DESIGN of that method, so a run against
 * `main` with `--hide=bloom` fails rather than timing the wrong thing.
 * `--stress` adds two rows at view (26,22) zoom 1.6: the same view frozen
 * (`frame(1, 0)`, zero elapsed time), then the same after 24 Grad landings
 * (`spawnShellLandingAt('rocket', ...)`, the body `shellHasLanded` calls)
 * aged 250 ms of FX time (hit-stop frames do not count), frozen there. The
 * difference between the two rows is what 24 landings cost at that age.
 * Each view also prints `programs` (`renderer.info.programs.length`), and
 * the run prints `os.loadavg()` at start and end: a number taken on a
 * loaded machine is a different number, and says so beside itself.
 *
 * ## The render-pass cliff (measured 2026-10-21, `docs/PERFORMANCE.md`)
 *
 * On ANGLE/Metal this back-to-back loop has a cliff: once a frame switches
 * between 13 or more distinct render targets, it reads about 3x its work
 * after ~30 frames (`medium`, 9 switches: 3 ms; the same frame plus four
 * colour-only clears of four TINY targets: 9.5 ms; clears of one target, or
 * binds with no clear, do not trigger it). `high` is past the cliff on
 * `main` already (13 switches), `medium` and `low` are not, and bloom adds
 * 13. The app's own 60 Hz loop does not show it. So compare two trees or
 * two presets only on the same side of the cliff, or the delta is the
 * cliff, not the change.
 */
import { chromium } from 'playwright';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { devServerStopper, ensureDevServer } from '../golden-diff/browser';
import { musicOffInitScript } from '../ui-review/music-off';
import { claimPortOrAttach, refuseRetiredBaseUrl } from '../ui-review/port';

const TAG = 'render-frame-cost';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
refuseRetiredBaseUrl(TAG, args);
const selectAll = args.includes('--select-all');
const stress = args.includes('--stress');
const flag = (name: string): string | undefined => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const quality = flag('quality');
if (quality !== undefined && !['high', 'medium', 'low'].includes(quality)) throw new Error(`--quality=${quality} is not high, medium or low`);
const hidden = (flag('hide') ?? '').split(',').filter((s) => s.length > 0);
const load = (): string => os.loadavg().map((n) => n.toFixed(2)).join(' ');
console.log(`load average at start: ${load()}`);
const [query = '?sandbox=beit_sahwan_outskirts&sur&civ', size = '1440x900'] = args.filter((a) => !a.startsWith('--'));
const [viewportWidth, viewportHeight] = size.split('x').map(Number);
if (!Number.isFinite(viewportWidth) || !Number.isFinite(viewportHeight)) {
  throw new Error(`second argument must be WIDTHxHEIGHT, got ${JSON.stringify(size)}`);
}
const { port } = await claimPortOrAttach(TAG, 'RENDER_FRAME_COST_PORT', 5178);
const stopServer = devServerStopper(await ensureDevServer(port, REPO_ROOT, TAG), TAG);
const base = `http://localhost:${port}`;
const VIEWS: [number, number, number][] = [
  [5, 22, 2.5],
  [22, 24, 0.5],
  [26, 22, 1.6],
];

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--use-gl=angle', '--enable-gpu-rasterization', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({
  viewport: { width: viewportWidth, height: viewportHeight },
  deviceScaleFactor: 2,
});
await page.addInitScript(quality ? musicOffInitScript({}, { quality: quality as 'high' | 'medium' | 'low' }) : musicOffInitScript());
await page.goto(base + '/' + query, { waitUntil: 'load' });
await page.waitForFunction(() => !!(window as unknown as { __lions?: { renderer?: unknown } }).__lions?.renderer, null, { timeout: 60000 });
await page.waitForTimeout(3000);
const gpu = await page.evaluate(() => {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2');
  const ext = gl?.getExtension('WEBGL_debug_renderer_info');
  return ext && gl ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
});
console.log(`renderer: ${gpu}`);
if (/SwiftShader/i.test(gpu)) console.warn('SOFTWARE GPU -- numbers are not comparable to a hardware run');
const buffer = await page.evaluate(() => {
  const L = (window as unknown as { __lions: { renderer: { canvas: HTMLCanvasElement } } }).__lions;
  return `${L.renderer.canvas.width}x${L.renderer.canvas.height}`;
});
console.log(`drawing buffer: ${buffer} (css ${viewportWidth}x${viewportHeight})`);
const qualityRead = await page.evaluate(() => {
  const raw = localStorage.getItem('lions.settings');
  return raw ? (JSON.parse(raw) as { video?: { quality?: string } }).video?.quality ?? 'none' : 'none';
});
console.log(`quality: ${qualityRead}${quality ? ` (asked ${quality})` : ''}`);
for (const name of hidden) {
  await page.evaluate((n) => {
    (window as unknown as { __lions: { renderer: { setDebugLayerVisible(name: string, v: boolean): number } } }).__lions.renderer.setDebugLayerVisible(n, false);
  }, name);
}
console.log(`hidden layers: ${hidden.length ? hidden.join(',') : 'none'}`);
if (selectAll) {
  // Scaffolding, not the thing under test: `sel` is how a harness puts N
  // units in the selection without N clicks.
  const n = await page.evaluate(() => {
    const L = (window as unknown as {
      __lions: { sel(ids: number[]): number[]; units(side?: number): { id: number }[] };
    }).__lions;
    return L.sel(L.units(0).map((u) => u.id)).length;
  });
  console.log(`selected: ${n} (--select-all)`);
} else {
  console.log('selected: 0');
}
type Row = { x: number; y: number; zoom: number; dt: number; landings: number; label: string };
const ROWS: Row[] = VIEWS.map(([x, y, zoom]) => ({ x, y, zoom, dt: 16, landings: 0, label: '' }));
if (stress) {
  ROWS.push({ x: 26, y: 22, zoom: 1.6, dt: 0, landings: 0, label: ' [stress control: frozen, no landings]' });
  ROWS.push({ x: 26, y: 22, zoom: 1.6, dt: 0, landings: 24, label: ' [stress: 24 Grad landings, 250 ms in, frozen]' });
}
for (const row of ROWS) {
  const { x, y, zoom } = row;
  const stats = await page.evaluate(([cx, cy, cz, dt, landings]) => {
    const L = (window as unknown as {
      __lions: {
        renderer: {
          canvas: HTMLCanvasElement;
          camera: { x: number; y: number; zoom: number };
          frame(a: number, dt: number): void;
          hitStop: { remainingMs: number };
          spawnShellLandingAt(kind: string, tx: number, ty: number): void;
        };
        step(n: number): void;
      };
    }).__lions;
    L.renderer.camera.x = cx;
    L.renderer.camera.y = cy;
    L.renderer.camera.zoom = cz;
    const times: number[] = [];
    const wall: number[] = [];
    for (let i = 0; i < 30; i++) L.renderer.frame(1, 16);
    if (landings > 0) {
      // A 6x4 lattice at 1.5-tile spacing round the view centre, every round
      // inside the zoom-1.6 frame. `spawnShellLandingAt` is private in
      // TypeScript and readable from a page; it is the body every landing
      // runs (`spawnShellImpactFx`), on main and on the branch alike.
      for (let i = 0; i < landings; i++) {
        L.renderer.spawnShellLandingAt('rocket', cx - 3.75 + (i % 6) * 1.5, cy - 2.25 + Math.floor(i / 6) * 1.5);
      }
      // Age the burst 250 ms of FX time. A frame that starts inside a
      // hit-stop does not advance the FX clock, so it is not counted.
      let aged = 0;
      for (let guard = 0; aged < 250 && guard < 200; guard++) {
        const frozen = L.renderer.hitStop.remainingMs > 0;
        L.renderer.frame(1, 16);
        if (!frozen) aged += 16;
      }
    }

    // Draw calls over ONE frame. `info` resets per `render()` call by
    // default, and a frame is several (the post chain), so it is summed by
    // hand with the auto-reset off and restored after.
    const info = (L.renderer as unknown as { renderer: { info: { autoReset: boolean; reset(): void; render: { calls: number } } } })
      .renderer.info;
    const autoReset = info.autoReset;
    info.autoReset = false;
    info.reset();
    L.renderer.frame(1, dt);
    const calls = info.render.calls;
    const programs = (info as unknown as { programs?: unknown[] }).programs?.length ?? -1;
    info.autoReset = autoReset;

    // The renderer's OWN canvas, by its public accessor -- not the biggest
    // canvas in the document, which would be a guess. `getContext` on a
    // canvas that already holds a WebGL2 context hands back THAT context
    // with its attributes ignored; on one that does not, it MAKES a fresh
    // empty one, and `gl.finish()` on that drains nothing and reports the
    // CPU time again. The two checks below are what tell those apart.
    const canvas = L.renderer.canvas;
    const gl2 = canvas.getContext('webgl2');
    if (!gl2) throw new Error(`renderer.canvas has no webgl2 context (${canvas.width}x${canvas.height})`);
    const attributes = gl2.getContextAttributes();
    if (attributes?.stencil !== true) {
      throw new Error(
        `renderer.canvas's webgl2 context has stencil=${String(attributes?.stencil)}; ` +
          `ThreeRenderer asks for stencil: true, so this context was created by THIS script and gl.finish() would measure nothing`
      );
    }
    if (gl2.getParameter(gl2.CURRENT_PROGRAM) === null) {
      throw new Error('renderer.canvas webgl2 context has never drawn (CURRENT_PROGRAM null after 30 frames)');
    }
    if (gl2.drawingBufferWidth !== canvas.width) {
      throw new Error(`drawingBufferWidth ${gl2.drawingBufferWidth} != canvas.width ${canvas.width}`);
    }

    for (let i = 0; i < 240; i++) {
      const t0 = performance.now();
      L.renderer.frame(1, dt);
      times.push(performance.now() - t0);
    }
    // Drain once before timing, so the first bracketed frame is not also
    // waiting on the unbracketed loop's backlog.
    gl2.finish();
    for (let i = 0; i < 120; i++) {
      const t0 = performance.now();
      L.renderer.frame(1, dt);
      gl2.finish();
      wall.push(performance.now() - t0);
    }
    wall.sort((a, b) => a - b);
    times.sort((a, b) => a - b);
    // Live flipbook instances (branch only; `main` has no `flipbook`): the
    // witness that the stress row drew the burst it claims to time.
    const fb = (L.renderer as unknown as { flipbook?: { liveCount: number } }).flipbook;
    const flipbookLive = fb ? fb.liveCount : -1;
    return { median: times[120], p95: times[228], wallMedian: wall[60], wallP95: wall[114], calls, programs, flipbookLive };
  }, [x, y, zoom, row.dt, row.landings]);
  console.log(
    `view (${x},${y}) zoom ${zoom}${row.label}: cpu median ${stats.median.toFixed(2)} ms, cpu p95 ${stats.p95.toFixed(2)} ms, ` +
      `gpu median ${stats.wallMedian.toFixed(2)} ms, gpu p95 ${stats.wallP95.toFixed(2)} ms, draw calls ${stats.calls}, programs ${stats.programs}` +
      (row.landings > 0 ? `, flipbook live ${stats.flipbookLive < 0 ? 'n/a' : stats.flipbookLive}` : '')
  );
}
console.log(`load average at end: ${load()}`);
await browser.close();
stopServer();
