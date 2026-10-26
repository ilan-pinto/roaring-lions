/**
 * The FX frame-cost instrument (smoke uplift P1; reused by P2 and P3+P4).
 *
 *   pnpm perf:fx -- --root=<tree> --port=<n> --label=<name> [--query=<extra>]
 *
 * Serves <tree> (run the SAME script against BEFORE and AFTER trees by pointing
 * --root at each), boots `?sandbox=beit_sahwan_outskirts` on HARDWARE Metal and,
 * per quality preset (high/medium/low, or `--presets=high,medium`), times
 * `renderer.frame(1, 0)` synced by a 1x1 `readPixels` (GPU wall, rAF frozen) for:
 *   quiet z0.5 / z2.5 / z1.6 -- the three mocked views
 *   smoke                    -- a dense screen: ten side-0 Eitans lay at tiles
 *                               ringed round the zoom-1.6 centre
 *   kill                     -- 8 Lavi kills, one per 250 ms of FX time; timed
 *                               500 ms and 4 s after the last
 *   grad                     -- 24 Grad landings, timed at 250 ms and 1.75 s
 * Draw calls come from `renderer.info` with autoReset off. The 60 Hz verdict is
 * p95 <= 16.7 ms. Refuses SwiftShader (exit 2). Frame time only: tick time is a
 * different budget and is not measured here.
 *
 * GH-829 `--breakdown` (with `--map=<id> --dpr=<n> --rounds=<n> --burn=<k>`): swaps the FX rows
 * for a per-pass frame breakdown on one map. Each config switches ONE thing off (a composer
 * pass's `enabled`, the shadow casting pass, or a debug layer), is timed readPixels-synced, and
 * switches it back; rounds interleave the configs so load drift lands on all of them. Rows carry
 * the median over rounds, the per-round medians, p95, CPU submit time (`cpu`, frame() return
 * before the sync) and draw calls / triangles read by hand with `autoReset` off. A toggle that
 * does nothing shows as unchanged calls AND a ~0 delta. It first prints the free-running rAF
 * CADENCE (app loop live) per view: the synced rows are serialised latency, the cadence is what
 * a player's loop sees, and the two disagree (docs/PERFORMANCE.md, GH-829). `--burn=2` draws two
 * extra frames per rAF, the falsification: the cadence must stop reading 16.7 ms.
 *
 * WHY readPixels AND NOT gl.finish() (GH-777, `_coord/high-perf/report.md` point 1):
 * on ANGLE/Metal `gl.finish()` does not wait for the whole frame when no pass
 * samples a render target back -- `medium` read 3 ms with it and 13.9 ms with a
 * 1x1 readPixels, `low` ~3 -> 10.5 ms. A readPixels cannot return before every
 * command that writes the default framebuffer has run.
 */
import { chromium } from 'playwright';
import os from 'node:os';
import path from 'node:path';
import { devServerStopper, ensureDevServer } from '../golden-diff/browser';
import { musicOffInitScript } from '../ui-review/music-off';
import { claimPort } from '../ui-review/port';

const args = process.argv.slice(2);
const arg = (n: string, d: string): string => (args.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).slice(n.length + 3);
const root = path.resolve(arg('root', process.cwd()));
// `--port=<n>`, else FX_COST_PORT, else 5211; a port something already holds
// is refused (`ui-review/port.ts`), so this never times someone else's server.
const port = await claimPort('fx-cost', 'FX_COST_PORT', 5211);
const label = arg('label', 'run');
const extra = arg('query', '');
const BUDGET_MS = 16.7;
// GH-829: `--breakdown` replaces the FX rows with a per-pass frame breakdown on
// `--map=<id>` at `--dpr=<n>` (default 2), `--rounds=<n>` interleaved passes.
const BREAKDOWN = args.includes('--breakdown');
const MAP = arg('map', 'beit_sahwan_outskirts');
const DPR = Number(arg('dpr', '2'));
const ROUNDS = Number(arg('rounds', '3'));
// `--burn=<k>`: draw k extra frames per rAF in the cadence rows. The falsification
// of the cadence check: at k=2 it must stop reading 16.7 ms.
const BURN = Number(arg('burn', '0'));

const VIEWS: [number, number, number][] = [
  [22, 24, 0.5],
  [5, 22, 2.5],
  [26, 22, 1.6],
];

const PRESETS = arg('presets', 'high,medium,low')
  .split(',')
  .map((q) => q.trim())
  .filter((q): q is 'high' | 'medium' | 'low' => q === 'high' || q === 'medium' || q === 'low');
if (PRESETS.length === 0) throw new Error('--presets names no preset (high, medium, low)');

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
  for (const quality of PRESETS) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: DPR });
    await page.addInitScript(musicOffInitScript({}, { quality }));
    await page.addInitScript('window.__name = (f) => f;');
    await page.goto(`http://localhost:${port}/?sandbox=${MAP}${extra}`, { waitUntil: 'load' });
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
    if (BREAKDOWN) {
      await page.waitForTimeout(4000);
      // Free-running cadence with the app's own loop on (GH-829): rAF-to-rAF
      // intervals per view, BEFORE the loop is frozen below. This is what a
      // player sees; the readPixels rows below are serialised GPU latency.
      const cadence = await page.evaluate(async (burn) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const L = (window as any).__lions;
        const r = L.renderer;
        const base = { x: r.camera.x, y: r.camera.y, zoom: r.camera.zoom };
        const out: Record<string, { med: number; p95: number; over20: number; over25: number; frames: number }> = {};
        for (const z of [base.zoom, 1.6, 2.5]) {
          r.camera.x = base.x;
          r.camera.y = base.y;
          r.camera.zoom = z;
          await new Promise<void>((res) => requestAnimationFrame(() => res()));
          const d: number[] = [];
          let last = performance.now();
          for (let i = 0; i < 300; i++) {
            const now = await new Promise<number>((res) =>
              requestAnimationFrame((t) => {
                for (let b = 0; b < burn; b++) r.frame(1, 0);
                res(t);
              })
            );
            d.push(now - last);
            last = now;
          }
          const sorted = [...d].sort((a, b) => a - b);
          out[`z${z}`] = { med: sorted[150], p95: sorted[285], over20: d.filter((v) => v > 20).length / d.length, over25: d.filter((v) => v > 25).length / d.length, frames: d.length };
        }
        r.camera.x = base.x;
        r.camera.y = base.y;
        r.camera.zoom = base.zoom;
        return out;
      }, BURN);
      console.log(`${label} CADENCE burn=${BURN} (app loop live, rAF intervals, loadavg ${os.loadavg().map((v) => v.toFixed(1)).join('/')}, visibility ${await page.evaluate(() => document.visibilityState)})`);
      for (const [k, v] of Object.entries(cadence)) {
        console.log(`  ${k.padEnd(6)} med ${v.med.toFixed(2)} ms  p95 ${v.p95.toFixed(2)}  >20ms ${(v.over20 * 100).toFixed(1)}%  >25ms ${(v.over25 * 100).toFixed(1)}%  (${v.frames} frames)`);
      }
      const out = await page.evaluate(
        ([rounds, n]) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const L = (window as any).__lions;
          const r = L.renderer;
          window.requestAnimationFrame = () => 0; // freeze the app's loop; we pump frames
          const canvas: HTMLCanvasElement = r.canvas;
          const gl = canvas.getContext('webgl2') as WebGL2RenderingContext;
          const info = r.renderer.info;
          const syncPx = new Uint8Array(4);
          const sync = (): void => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, syncPx);
          const post = r.post;
          const passes: { constructor: { name: string }; enabled: boolean }[] = post.composer.passes;
          const byName = (nm: string) => passes.find((p) => p.constructor.name === nm);
          const sun = (() => {
            let found: { castShadow: boolean } | null = null;
            r.scene.traverse((o: { isDirectionalLight?: boolean; castShadow?: boolean }) => {
              if (!found && o.isDirectionalLight && o.castShadow) found = o as { castShadow: boolean };
            });
            return found as { castShadow: boolean } | null;
          })();
          const sm = r.renderer.shadowMap;
          interface Cfg {
            name: string;
            off: () => void;
            on: () => void;
          }
          const passCfg = (label: string, nm: string): Cfg => ({
            name: `-${label}`,
            off: () => {
              const p = byName(nm);
              if (!p) throw new Error(`no pass ${nm}`);
              p.enabled = false;
            },
            on: () => {
              const p = byName(nm);
              if (p) p.enabled = true;
            },
          });
          const layerCfg = (label: string, layer: string): Cfg => ({
            name: `-${label}`,
            off: () => r.setDebugLayerVisible(layer, false),
            on: () => r.setDebugLayerVisible(layer, true),
          });
          const present = (nm: string): boolean => !!byName(nm);
          const cfgs: Cfg[] = [{ name: 'baseline', off: () => {}, on: () => {} }];
          // Shadow casting pass only (map goes stale, sampling remains) vs the whole shadow (light stops casting).
          cfgs.push({ name: '-shadow-cast-pass', off: () => { sm.autoUpdate = false; sm.needsUpdate = false; }, on: () => { sm.autoUpdate = true; } });
          if (sun) cfgs.push({ name: '-shadow-all', off: () => { sun.castShadow = false; }, on: () => { sun.castShadow = true; } });
          cfgs.push(passCfg('RenderPass(scene)', 'RenderPass'));
          if (present('FogOfWarPass')) cfgs.push(passCfg('fog-pass', 'FogOfWarPass'));
          if (present('WorldGTAOPass')) cfgs.push(passCfg('GTAO', 'WorldGTAOPass'));
          const bloomName = passes.map((p) => p.constructor.name).find((nm) => /bloom/i.test(nm));
          if (bloomName) cfgs.push(passCfg('bloom', bloomName));
          cfgs.push(passCfg('OutputPass', 'OutputPass'));
          cfgs.push(passCfg('vignette', 'VignettePass'));
          if (present('SMAAPass')) cfgs.push(passCfg('SMAA', 'SMAAPass'));
          for (const [l, k] of [['units', 'units'], ['buildings', 'buildings'], ['decals', 'decals'], ['scatter', 'scatter'], ['decor', 'decor'], ['props', 'props'], ['overlays', 'overlays'], ['ground-albedo', 'ground-albedo'], ['macro', 'macro'], ['roads', 'roads'], ['haze', 'haze']] as const) {
            cfgs.push(layerCfg(l, k));
          }
          // Ground only: every object layer hidden, the ground shader still drawn.
          const OBJECT_LAYERS = ['units', 'buildings', 'decals', 'scatter', 'decor', 'props', 'overlays'];
          cfgs.push({
            name: '-ALL-objects(ground only)',
            off: () => { for (const l of OBJECT_LAYERS) r.setDebugLayerVisible(l, false); },
            on: () => { for (const l of OBJECT_LAYERS) r.setDebugLayerVisible(l, true); },
          });
          // Everything but the scene + output: the post chain's whole cost by difference.
          const postNames = passes.map((p) => p.constructor.name).filter((nm) => nm !== 'RenderPass' && nm !== 'OutputPass');
          cfgs.push({
            name: '-ALL-POST(except Output)',
            off: () => { for (const nm of postNames) { const p = byName(nm); if (p) p.enabled = false; } },
            on: () => { for (const nm of postNames) { const p = byName(nm); if (p) p.enabled = true; } },
          });
          cfgs.push({
            name: '-ALL-POST+shadow-cast',
            off: () => { for (const nm of postNames) { const p = byName(nm); if (p) p.enabled = false; } sm.autoUpdate = false; sm.needsUpdate = false; },
            on: () => { for (const nm of postNames) { const p = byName(nm); if (p) p.enabled = true; } sm.autoUpdate = true; },
          });

          interface Cell {
            med: number;
            p95: number;
            cpu: number;
            calls: number;
            tris: number;
          }
          const time = (): Cell => {
            for (let i = 0; i < 20; i++) r.frame(1, 16);
            info.autoReset = false;
            info.reset();
            r.frame(1, 16);
            const calls = info.render.calls;
            const tris = info.render.triangles;
            info.autoReset = true;
            sync();
            const w: number[] = [];
            const c: number[] = [];
            for (let i = 0; i < n; i++) {
              const t0 = performance.now();
              r.frame(1, 0);
              const t1 = performance.now();
              sync();
              w.push(performance.now() - t0);
              c.push(t1 - t0);
            }
            w.sort((a, b) => a - b);
            c.sort((a, b) => a - b);
            return { med: w[Math.floor(n / 2)], p95: w[Math.floor(n * 0.95)], cpu: c[Math.floor(n / 2)], calls, tris };
          };
          const views: Record<string, [number, number, number]> = {};
          const boot = { x: r.camera.x, y: r.camera.y, zoom: r.camera.zoom };
          views['boot'] = [boot.x, boot.y, boot.zoom];
          views['boot-z1.6'] = [boot.x, boot.y, 1.6];
          views['boot-z2.5'] = [boot.x, boot.y, 2.5];
          const res: Record<string, Record<string, Cell[]>> = {};
          for (const [vn, [x, y, z]] of Object.entries(views)) {
            r.camera.x = x;
            r.camera.y = y;
            r.camera.zoom = z;
            res[vn] = {};
            for (let round = 0; round < (rounds as number); round++) {
              for (const cfg of cfgs) {
                cfg.off();
                (res[vn][cfg.name] ??= []).push(time());
                cfg.on();
              }
            }
          }
          return { res, boot, passes: post.passNames.join('>'), size: [canvas.width, canvas.height], map: [L.sim.width, L.sim.height], pr: r.renderer.getPixelRatio(), sunFound: !!sun, entities: L.sim.entityCount };
        },
        [ROUNDS, 100] as const
      );
      console.log(`${label} BREAKDOWN map=${MAP} quality=${quality} dprRequested=${DPR} pixelRatio=${out.pr} canvas=${out.size.join('x')} gpu=${gpu} loadavg=${os.loadavg().map((v) => v.toFixed(1)).join('/')} (before) passes=${out.passes} sun=${out.sunFound} entities=${out.entities} map=${out.map.join('x')} boot=${JSON.stringify(out.boot)}`);
      type Cell = { med: number; p95: number; cpu: number; calls: number; tris: number };
      const medianOf = (v: number[]): number => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
      for (const [vn, cfgs] of Object.entries(out.res as Record<string, Record<string, Cell[]>>)) {
        console.log(` view ${vn}`);
        const base = medianOf(cfgs['baseline'].map((c) => c.med));
        for (const [name, cells] of Object.entries(cfgs)) {
          const meds = cells.map((c) => c.med);
          const m = medianOf(meds);
          console.log(
            `  ${name.padEnd(26)} med ${m.toFixed(2)} ms (rounds ${meds.map((v) => v.toFixed(1)).join('/')})  p95 ${medianOf(cells.map((c) => c.p95)).toFixed(2)}  cpu ${medianOf(cells.map((c) => c.cpu)).toFixed(2)}  delta ${(m - base).toFixed(2)}  calls ${cells[0].calls}  tris ${(cells[0].tris / 1000).toFixed(0)}k`
          );
        }
      }
      console.log(`loadavg after: ${os.loadavg().map((v) => v.toFixed(1)).join('/')}`);
      await page.close();
      continue;
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
        const syncPx = new Uint8Array(4);
        const sync = (): void => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, syncPx);
        const time = (n: number): Row => {
          for (let i = 0; i < 20; i++) r.frame(1, 16);
          info.autoReset = false;
          info.reset();
          r.frame(1, 16);
          const calls = info.render.calls;
          info.autoReset = true;
          sync();
          const w: number[] = [];
          for (let i = 0; i < n; i++) {
            const t0 = performance.now();
            r.frame(1, 0);
            sync();
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

        // Let the screen decay away in the SIM (SMOKE_DECAY 1 a tick from 255),
        // so the kill and grad rows below time no smoke. Before this, the
        // screen was still drawn in every later row (P1 review).
        for (let i = 0; i < 260; i++) handTick();
        pump(100);

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
