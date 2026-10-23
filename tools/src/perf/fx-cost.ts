/**
 * The FX frame-cost instrument (smoke uplift P1; reused by P2 and P3+P4).
 *
 *   pnpm perf:fx -- --root=<tree> --port=<n> --label=<name> [--query=<extra>]
 *
 * Serves <tree> (run the SAME script against BEFORE and AFTER trees by pointing
 * --root at each), boots `?sandbox=beit_sahwan_outskirts` on HARDWARE Metal and,
 * per quality preset (high/medium/low), times `renderer.frame(1, 0)` bracketed
 * by `gl.finish()` (GPU wall, rAF frozen) for:
 *   quiet z0.5 / z2.5 / z1.6 -- the three mocked views
 *   smoke                    -- a dense screen: ten side-0 Eitans lay at tiles
 *                               ringed round the zoom-1.6 centre
 *   kill                     -- 8 Lavi kills, one per 250 ms of FX time; timed
 *                               500 ms and 4 s after the last
 *   grad                     -- 24 Grad landings, timed at 250 ms and 1.75 s
 * Draw calls come from `renderer.info` with autoReset off. The 60 Hz verdict is
 * p95 <= 16.7 ms. Refuses SwiftShader (exit 2). Frame time only: tick time is a
 * different budget and is not measured here.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { devServerStopper, ensureDevServer } from '../golden-diff/browser';
import { musicOffInitScript } from '../ui-review/music-off';

const args = process.argv.slice(2);
const arg = (n: string, d: string): string => (args.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).slice(n.length + 3);
const root = path.resolve(arg('root', process.cwd()));
const port = Number(arg('port', '5211'));
const label = arg('label', 'run');
const extra = arg('query', '');
const BUDGET_MS = 16.7;

const VIEWS: [number, number, number][] = [
  [22, 24, 0.5],
  [5, 22, 2.5],
  [26, 22, 1.6],
];

const stop = devServerStopper(await ensureDevServer(port, root, 'fx-cost'), 'fx-cost');
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--use-gl=angle', '--enable-gpu-rasterization', '--disable-gpu-sandbox'],
});

interface Row {
  med: number;
  p95: number;
  calls: number;
  note?: string;
}

try {
  for (const quality of ['high', 'medium', 'low'] as const) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    await page.addInitScript(musicOffInitScript({}, { quality }));
    await page.addInitScript('window.__name = (f) => f;');
    await page.goto(`http://localhost:${port}/?sandbox=beit_sahwan_outskirts${extra}`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!(window as unknown as { __lions?: { renderer?: unknown } }).__lions?.renderer, null, { timeout: 120000 });
    await page.waitForTimeout(4000);
    const gpu = await page.evaluate(() => {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      return ext && gl ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
    });
    if (/swiftshader|llvmpipe|software/i.test(gpu) || gpu === 'unknown') {
      console.error(`fx-cost: refusing to time on "${gpu}" (need hardware Metal)`);
      await browser.close();
      stop();
      process.exit(2);
    }
    // Warm the two vehicle types the stress spawns, off-view, with the app loop
    // still running so their meshes load; then take them out of play.
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const L = (window as any).__lions;
      const idx = (id: string): number => L.sim.unitTypes.findIndex((t: { id: string }) => t.id === id);
      const warm: number[] = [];
      for (const id of ['mbt_lavi', 'apc_eitan']) {
        if (idx(id) < 0) throw new Error(`fx-cost: unit type ${id} missing from the sandbox sim`);
        warm.push(L.sim.spawn(idx(id), 0, 3 * 65536, 3 * 65536));
      }
      (window as unknown as { __warm: number[] }).__warm = warm;
    });
    await page.waitForTimeout(6000);
    const res = await page.evaluate(
      ([views, budget]) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const L = (window as any).__lions;
        const r = L.renderer;
        const FIXED = 65536;
        for (const id of (window as unknown as { __warm: number[] }).__warm) L.sim.removeFromPlay(id);
        window.requestAnimationFrame = () => 0; // freeze the app's loop; we pump frames
        const canvas: HTMLCanvasElement = r.canvas;
        const gl = canvas.getContext('webgl2') as WebGL2RenderingContext;
        const info = r.renderer.info;
        const time = (n: number): Row => {
          for (let i = 0; i < 20; i++) r.frame(1, 16);
          info.autoReset = false;
          info.reset();
          r.frame(1, 16);
          const calls = info.render.calls;
          info.autoReset = true;
          gl.finish();
          const w: number[] = [];
          for (let i = 0; i < n; i++) {
            const t0 = performance.now();
            r.frame(1, 0);
            gl.finish();
            w.push(performance.now() - t0);
          }
          w.sort((a, b) => a - b);
          return { med: w[Math.floor(n / 2)], p95: w[Math.floor(n * 0.95)], calls };
        };
        const pump = (ms: number): void => {
          for (let t = 0; t < ms - 1e-6; t += 16.7) r.frame(1, 16.7);
        };
        const handTick = (): unknown[] => {
          const ev = L.sim.tick();
          r.snapshot();
          r.onEvents(ev);
          return ev;
        };
        const idx = (id: string): number => L.sim.unitTypes.findIndex((t: { id: string }) => t.id === id);
        const open = (x: number, y: number): boolean => L.sim.blocked[y * L.sim.width + x] === 0;
        const rows: Record<string, Row> = {};
        for (const [x, y, z] of views as [number, number, number][]) {
          r.camera.x = x;
          r.camera.y = y;
          r.camera.zoom = z;
          rows[`quiet z${z}`] = time(120);
        }
        const [cx, cy, cz] = (views as [number, number, number][])[2];
        r.camera.x = cx;
        r.camera.y = cy;
        r.camera.zoom = cz;

        // Open tiles on a ring-ish scatter round the view centre.
        const spots: [number, number][] = [];
        for (let dy = -6; dy <= 6; dy += 1) for (let dx = -8; dx <= 8; dx += 1) if (open(cx + dx, cy + dy)) spots.push([cx + dx, cy + dy]);
        spots.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy));
        // Thin to every other tile of the sorted list so units are not stacked.
        const spread = spots.filter((_, i) => i % 3 === 0);
        spots.length = 0;
        spots.push(...spread);

        // ---- smoke: ten Eitans, each laying at a tile 2-4 round the centre.
        const smokers: number[] = [];
        for (let i = 0; i < 10 && i < spots.length; i++) smokers.push(L.sim.spawn(idx('apc_eitan'), 0, spots[i][0] * FIXED, spots[i][1] * FIXED));
        r.snapshot();
        // Also every pre-existing side-0 unit that can smoke.
        const canSmokeIdx = new Set<number>();
        L.sim.unitTypes.forEach((t: { canSmoke?: boolean }, i: number) => {
          if (t.canSmoke) canSmokeIdx.add(i);
        });
        for (let i = 0; i < L.sim.entityCount; i++) {
          if (L.sim.state.alive[i] === 1 && L.sim.state.side[i] === 0 && canSmokeIdx.has(L.sim.state.typeIdx[i]) && !smokers.includes(i) && Math.hypot(L.sim.state.posX[i] / FIXED - cx, L.sim.state.posY[i] / FIXED - cy) < 5) smokers.push(i);
        }
        smokers.forEach((id, k) => {
          const a = (k / smokers.length) * Math.PI * 2;
          const d = 2 + (k % 3);
          L.sim.queueCommand({ kind: 'smoke', ids: [id], x: Math.round((cx + Math.cos(a) * d) * FIXED), y: Math.round((cy + Math.sin(a) * d) * FIXED) });
        });
        let laid = 0;
        let ticks = 0;
        while (ticks < 200 && laid < smokers.length) {
          const ev = handTick() as { kind: string }[];
          laid += ev.filter((e) => e.kind === 'smokeLaid').length;
          ticks++;
          r.frame(1, 50);
        }
        pump(1000);
        let smokedTiles = 0;
        for (let i = 0; i < L.sim.smoke.length; i++) if (L.sim.smoke[i] > 0) smokedTiles++;
        rows['smoke z1.6'] = { ...time(90), note: `smokers ${smokers.length}, smokeLaid ${laid} in ${ticks} ticks, smoked tiles ${smokedTiles}` };

        // ---- kill: 8 Lavis, one every 250 ms of FX time.
        const victims: number[] = [];
        const used = new Set(spots.slice(0, 10).map((s) => `${s[0]},${s[1]}`));
        for (const s of spots.slice(10)) {
          if (victims.length >= 8) break;
          if (used.has(`${s[0]},${s[1]}`)) continue;
          victims.push(L.sim.spawn(idx('mbt_lavi'), 0, s[0] * FIXED, s[1] * FIXED));
        }
        handTick();
        pump(500);
        let killed = 0;
        for (const v of victims) {
          L.sim.debugKill(v);
          handTick();
          pump(250);
        }
        for (const v of victims) if (L.sim.state.alive[v] === 0) killed++;
        pump(250); // settle to 500 ms after the last kill (250 already pumped after it)
        rows['kill z1.6 @500ms'] = { ...time(90), note: `kills ${killed}/${victims.length} (spawned ${victims.length})` };
        pump(3500);
        rows['kill z1.6 @4s'] = time(90);

        // ---- grad: 24 landings.
        pump(6000);
        for (let k = 0; k < 24; k++) {
          const a = (k / 24) * Math.PI * 2;
          const d = 2 + (k % 4) * 1.5;
          r.spawnShellLandingAt('rocket', cx + Math.cos(a) * d, cy + Math.sin(a) * d);
        }
        pump(250);
        rows['grad z1.6 @250ms'] = time(90);
        pump(1500);
        rows['grad z1.6 @1.75s'] = time(90);
        return { rows, budget, passes: r.post.passNames.join('>') };
      },
      [VIEWS, BUDGET_MS] as const
    );
    console.log(`${label} quality=${quality} gpu=${gpu} passes=${res.passes}`);
    for (const [k, v] of Object.entries(res.rows as Record<string, Row>)) {
      const verdict = v.p95 <= BUDGET_MS ? 'holds 60' : 'LOSES 60';
      console.log(`  ${k.padEnd(18)} med ${v.med.toFixed(2)} ms  p95 ${v.p95.toFixed(2)} ms  calls ${v.calls}  ${verdict}${v.note ? `  [${v.note}]` : ''}`);
    }
    await page.close();
  }
} finally {
  await browser.close();
  stop();
}
