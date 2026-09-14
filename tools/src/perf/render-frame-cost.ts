/**
 * Frame cost of the REAL renderer at the sandbox's own roster, three points
 * of view, hardware GPU. Not a unit-count curve (see three-units.ts for
 * that) -- a before/after instrument for a renderer change. Prints median
 * and p95 of `renderer.frame(1, 16)` in ms over 240 frames per view.
 *
 * Run against a dev server you started yourself:
 *   npx tsx tools/src/perf/render-frame-cost.ts http://127.0.0.1:5178 '?sandbox=beit_sahwan_outskirts&sur&civ'
 *
 * ## Two numbers per view, and the second one is the one a post pass moves
 *
 * `renderer.frame()` SUBMITS GL commands; it does not wait for them. So the
 * `cpu` figure below is scene update plus draw-call submission and nothing
 * else, and a post pass that costs the GPU milliseconds of FILL can move it
 * by almost nothing -- all such a pass adds on the CPU is a handful of quad
 * draws. `gpu` brackets the same call with `gl.finish()`, which blocks until
 * the queue has drained, so it is frame WALL time on this canvas: a lower
 * bound on what the display sees, and the figure a fill-rate change shows up
 * in. Read `gpu` for an accept/reject.
 *
 * Both are printed because the PAIR is the diagnosis, and Task 13 is the
 * worked example. On `main` the two sat at 1.5 / 1.8 ms at the zoom-0.5 view
 * -- and they still tracked each other within 0.4 ms through every
 * configuration measured after it, including one that tripled the frame
 * cost. That is not the instrument failing to see the GPU; it is this scene
 * being submission-bound on an M3 Pro, which is also why GTAO turned out to
 * cost what it does: its price here is a second full scene render, not fill.
 * cpu and gpu moving together means submission; gpu climbing while cpu stays
 * flat would mean fill, and nothing measured here has done that yet.
 */
import { chromium } from 'playwright';

const [base = 'http://127.0.0.1:5178', query = '?sandbox=beit_sahwan_outskirts&sur&civ'] = process.argv.slice(2);
const VIEWS: [number, number, number][] = [
  [5, 22, 2.5],
  [22, 24, 0.5],
  [26, 22, 1.6],
];

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--use-gl=angle', '--enable-gpu-rasterization', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
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
for (const [x, y, zoom] of VIEWS) {
  const stats = await page.evaluate(([cx, cy, cz]) => {
    const L = (window as unknown as { __lions: { renderer: { camera: { x: number; y: number; zoom: number }; frame(a: number, dt: number): void }; step(n: number): void } }).__lions;
    L.renderer.camera.x = cx;
    L.renderer.camera.y = cy;
    L.renderer.camera.zoom = cz;
    // The renderer's own canvas, picked by drawing-buffer area: the app
    // appends it to the host and does not expose it on the `Renderer`
    // interface (that seam is deliberately backend-free). `getContext` on a
    // canvas that already holds a WebGL2 context hands back THAT context,
    // its attributes ignored, so this is the live one rather than a second.
    const canvases = Array.from(document.querySelectorAll('canvas'));
    canvases.sort((a, b) => b.width * b.height - a.width * a.height);
    const gl2 = canvases.length > 0 ? canvases[0].getContext('webgl2') : null;
    const times: number[] = [];
    const wall: number[] = [];
    for (let i = 0; i < 30; i++) L.renderer.frame(1, 16);
    for (let i = 0; i < 240; i++) {
      const t0 = performance.now();
      L.renderer.frame(1, 16);
      times.push(performance.now() - t0);
    }
    if (gl2) {
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
    }
    times.sort((a, b) => a - b);
    return { median: times[120], p95: times[228], wallMedian: wall[60], wallP95: wall[114] };
  }, [x, y, zoom]);
  const gpuPart =
    stats.wallMedian === undefined || stats.wallP95 === undefined
      ? 'gpu unavailable (no webgl2 canvas)'
      : `gpu median ${stats.wallMedian.toFixed(2)} ms, gpu p95 ${stats.wallP95.toFixed(2)} ms`;
  console.log(
    `view (${x},${y}) zoom ${zoom}: cpu median ${stats.median.toFixed(2)} ms, cpu p95 ${stats.p95.toFixed(2)} ms, ${gpuPart}`
  );
}
await browser.close();
