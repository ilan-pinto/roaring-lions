/**
 * Frame cost of the REAL renderer at the sandbox's own roster, three points
 * of view, hardware GPU. Not a unit-count curve (see three-units.ts for
 * that) -- a before/after instrument for a renderer change. Prints median
 * and p95 of `renderer.frame(1, 16)` in ms over 240 frames per view.
 *
 * Run against a dev server you started yourself:
 *   npx tsx tools/src/perf/render-frame-cost.ts http://127.0.0.1:5178 '?sandbox=beit_sahwan_outskirts&sur&civ'
 *
 * The optional third argument is the CSS viewport, `WIDTHxHEIGHT`, default
 * `1440x900`. It exists for one job: the drawing buffer is that times the
 * renderer's pixel ratio (capped at 2), so doubling it quadruples the fill
 * WITHOUT changing the scene, the camera or a single draw call. That is the
 * positive control for the `gpu` figure below -- see "Is `gpu` real".
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
 */
import { chromium } from 'playwright';

const [base = 'http://127.0.0.1:5178', query = '?sandbox=beit_sahwan_outskirts&sur&civ', size = '1440x900'] =
  process.argv.slice(2);
const [viewportWidth, viewportHeight] = size.split('x').map(Number);
if (!Number.isFinite(viewportWidth) || !Number.isFinite(viewportHeight)) {
  throw new Error(`third argument must be WIDTHxHEIGHT, got ${JSON.stringify(size)}`);
}
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
for (const [x, y, zoom] of VIEWS) {
  const stats = await page.evaluate(([cx, cy, cz]) => {
    const L = (window as unknown as {
      __lions: {
        renderer: { canvas: HTMLCanvasElement; camera: { x: number; y: number; zoom: number }; frame(a: number, dt: number): void };
        step(n: number): void;
      };
    }).__lions;
    L.renderer.camera.x = cx;
    L.renderer.camera.y = cy;
    L.renderer.camera.zoom = cz;
    const times: number[] = [];
    const wall: number[] = [];
    for (let i = 0; i < 30; i++) L.renderer.frame(1, 16);

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
      L.renderer.frame(1, 16);
      times.push(performance.now() - t0);
    }
    // Drain once before timing, so the first bracketed frame is not also
    // waiting on the unbracketed loop's backlog.
    gl2.finish();
    for (let i = 0; i < 120; i++) {
      const t0 = performance.now();
      L.renderer.frame(1, 16);
      gl2.finish();
      wall.push(performance.now() - t0);
    }
    wall.sort((a, b) => a - b);
    times.sort((a, b) => a - b);
    return { median: times[120], p95: times[228], wallMedian: wall[60], wallP95: wall[114] };
  }, [x, y, zoom]);
  console.log(
    `view (${x},${y}) zoom ${zoom}: cpu median ${stats.median.toFixed(2)} ms, cpu p95 ${stats.p95.toFixed(2)} ms, ` +
      `gpu median ${stats.wallMedian.toFixed(2)} ms, gpu p95 ${stats.wallP95.toFixed(2)} ms`
  );
}
await browser.close();
