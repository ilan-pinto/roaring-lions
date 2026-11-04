/**
 * GH-974: the equal-pixels check for instanced per-tile structures.
 *
 *   pnpm perf:instancing -- --port=5266 --map=milh_flats_l \
 *     --views="centre,1;centre,1.6;versus_0,1" --out=<dir>
 *
 * Boots `?sandbox=<map>` on hardware Metal in ONE page, freezes the app's loop,
 * and for each view photographs the same frame twice: walls, fences and HESCO as
 * instances (the shipped path), then as clones (`debugPerTileInstancing(false)`,
 * the pre-GH-974 path), at the same tick and camera. The two PNGs are diffed with
 * the golden-diff engine.
 *
 * The answer is NOT zero, and the reason is stated rather than widened around: a
 * clone's modelView matrix is multiplied on the CPU in double precision, an
 * instance's on the GPU in float32, so a few rasterisation-edge pixels land on
 * the other side of a tie. Measured (M3 Pro, ANGLE Metal, 2880x1800): 0 to 4,807
 * of 5.18 M pixels (under 0.1%), mean absolute channel delta 0.0000 to 0.0006,
 * over 98% of the changed pixels by one to three levels, a handful of silhouette
 * pixels by tens, pixelmatch 0 to 23. `--max-mean=<n>` (default 0.01) is the line
 * between that and a defect; the falsification is a 0.05-unit lift on every
 * instance, which reads 152,290 changed pixels, mean 0.72 (1296000 px at 1x).
 * `--rounds=<n> --frames=<n>` also TIMES the two arms ABBA in this page.
 *
 * GH-974 `--toggle=lod1`: the arms are the compound wall's LOD1 twin ("on": `wall_lod1` below zoom 2.0)
 * against full art at every zoom ("off": `debugStructureLod1(false)`), same build, same tick. The pixel
 * diff is then EXPECTED to be non-zero (the twin is a different mesh) and is reported, never failed; the
 * timing is the measurement.
 *
 * Camera: `goto(marker)` (or `@x:y`, tile coordinates) then the zoom. The shot is the canvas rect, a
 * `page.screenshot` (the drawing buffer reads black by design). Music is off
 * (`musicOffInitScript`). Refuses SwiftShader.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { devServerStopper, ensureDevServer } from '../golden-diff/browser';
import { computeDiff } from '../golden-diff/diff';
import { musicOffInitScript } from '../ui-review/music-off';
import { claimPort } from '../ui-review/port';
import { INSTANCING_DEFAULT_PORT, instancingPortRefusal } from './instancing-port';

const args = process.argv.slice(2);
const arg = (n: string, d: string): string => (args.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).slice(n.length + 3);
const root = path.resolve(arg('root', process.cwd()));
// The RESOLVED port (flag, then INSTANCING_AB_PORT, then the default), not just `--port=`: 5177 is the lead's.
const refusal = instancingPortRefusal(args, process.env);
if (refusal !== null) {
  console.error(refusal);
  process.exit(2);
}
const port = await claimPort('instancing-ab', 'INSTANCING_AB_PORT', INSTANCING_DEFAULT_PORT);
const map = arg('map', 'milh_flats_l');
const out = path.resolve(arg('out', 'instancing-ab'));
const views = arg('views', 'centre,1')
  .split(';')
  .map((v) => v.split(','))
  .map(([marker, zoom]) => ({ marker, zoom: Number(zoom) }));
// `--rounds=<n> --frames=<n>`: also TIME the two arms, interleaved in this page (ABBA), readPixels-synced.
const rounds = Number(arg('rounds', '0'));
const frames = Number(arg('frames', '30'));
const dpr = Number(arg('dpr', '1'));
const maxMean = Number(arg('max-mean', '0.01'));
const toggle = arg('toggle', 'instancing') as 'instancing' | 'lod1';
if (toggle !== 'instancing' && toggle !== 'lod1') throw new Error(`--toggle=${toggle}: instancing or lod1`);
const quality = arg('quality', 'high') as 'high' | 'medium' | 'low';
mkdirSync(out, { recursive: true });

const stop = devServerStopper(await ensureDevServer(port, root, 'instancing-ab'), 'instancing-ab');
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--use-gl=angle', '--enable-gpu-rasterization', '--disable-gpu-sandbox'],
});
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: dpr });
  await page.addInitScript(musicOffInitScript({}, { quality }));
  await page.addInitScript('window.__name = (f) => f;');
  await page.goto(`http://localhost:${port}/?sandbox=${map}`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window as unknown as { __lions?: { renderer?: unknown } }).__lions?.renderer, null, { timeout: 120000 });
  await page.waitForTimeout(4000);
  const gpu = await page.evaluate(() => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext && gl ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  });
  if (/swiftshader|llvmpipe|software/i.test(gpu) || gpu === 'unknown') {
    console.error(`instancing-ab: refusing "${gpu}" (need hardware Metal)`);
    process.exitCode = 2;
  } else {
    console.log(`[instancing-ab] map=${map} quality=${quality} gpu="${gpu}" viewport 1440x900 @${dpr}x`);
    // Freeze the app's loop so the two arms share a tick; the sim does not advance.
    await page.evaluate(() => {
      window.requestAnimationFrame = () => 0;
    });
    await page.waitForTimeout(500);
    const counts = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = (window as any).__lions.renderer;
      const sc = r.scene;
      let inst = 0;
      sc.traverse((o: { isInstancedMesh?: boolean; count?: number; visible?: boolean }) => {
        if (o.isInstancedMesh && o.visible) inst += 1;
      });
      return { instancedMeshesVisible: inst };
    });
    console.log(`[instancing-ab] visible InstancedMesh objects in the scene (every kind, not only structures): ${counts.instancedMeshesVisible}`);
    for (const v of views) {
      const shoot = async (arm: 'on' | 'off'): Promise<string> => {
        await page.evaluate(
          async ([marker, zoom, enabled, which]) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const L = (window as any).__lions;
            const r = L.renderer;
            if (which === 'lod1') r.debugStructureLod1(enabled);
            else r.debugPerTileInstancing(enabled);
            const at = /^@(-?[\d.]+):(-?[\d.]+)$/.exec(marker);
            if (at) {
              r.camera.x = Number(at[1]);
              r.camera.y = Number(at[2]);
            } else if (!L.goto(marker)) throw new Error(`marker ${marker} not on this map`);
            r.camera.zoom = zoom;
            // Several frames: building updates, wreck settles and the shadow fit all land by the last.
            for (let i = 0; i < 6; i++) r.frame(1, 0);
            await new Promise((res) => setTimeout(res, 150));
            r.frame(1, 0);
            await new Promise((res) => setTimeout(res, 150));
          },
          [v.marker, v.zoom, arm === 'on', toggle] as const
        );
        const file = path.join(out, `${map}-${v.marker}-z${v.zoom}-${arm}.png`);
        await page.screenshot({ path: file });
        return file;
      };
      const on = await shoot('on');
      const off = await shoot('off');
      const on2 = await shoot('on');
      const d = computeDiff(off, on, { outDir: out, diffFileName: `${map}-${v.marker}-z${v.zoom}-diff.png` });
      const control = computeDiff(on, on2);
      console.log(
        `[instancing-ab] ${v.marker} z${v.zoom}: instanced vs clones  changed ${d.changedPixels}/${d.totalPixels} px  meanAbsChannelDelta ${d.meanAbsChannelDelta.toFixed(5)}  max ${d.maxAbsChannelDelta}  pixelmatch ${d.diffPixels}` +
          `   | control (instanced twice) changed ${control.changedPixels}  mean ${control.meanAbsChannelDelta.toFixed(5)}`
      );
      if (toggle === 'instancing' && d.meanAbsChannelDelta > maxMean) failed = true;
    }
    if (rounds > 0) {
      for (const v of views) {
        const t = await page.evaluate(
          async ([marker, zoom, nRounds, nFrames, which]) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const L = (window as any).__lions;
            const r = L.renderer;
            const canvas: HTMLCanvasElement = r.canvas;
            const gl = canvas.getContext('webgl2') as WebGL2RenderingContext;
            const px = new Uint8Array(4);
            const sync = (): void => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
            const at = /^@(-?[\d.]+):(-?[\d.]+)$/.exec(marker);
            if (at) {
              r.camera.x = Number(at[1]);
              r.camera.y = Number(at[2]);
            } else if (!L.goto(marker)) throw new Error(`marker ${marker} not on this map`);
            r.camera.zoom = zoom;
            const info = r.renderer.info;
            const arm = (enabled: boolean): { med: number; calls: number; tris: number } => {
              if (which === 'lod1') r.debugStructureLod1(enabled);
              else r.debugPerTileInstancing(enabled);
              for (let i = 0; i < 20; i++) r.frame(1, 16);
              info.autoReset = false;
              info.reset();
              r.frame(1, 16);
              const calls = info.render.calls;
              const tris = info.render.triangles;
              info.autoReset = true;
              sync();
              const w: number[] = [];
              for (let i = 0; i < nFrames; i++) {
                const t0 = performance.now();
                r.frame(1, 0);
                sync();
                w.push(performance.now() - t0);
              }
              w.sort((a, b) => a - b);
              return { med: w[Math.floor(nFrames / 2)], calls, tris };
            };
            const on: number[] = [];
            const off: number[] = [];
            let callsOn = 0, callsOff = 0, trisOn = 0, trisOff = 0;
            for (let k = 0; k < nRounds; k++) {
              // ABBA: the order flips each round so a drift lands on both arms.
              const order = k % 2 === 0 ? [true, false] : [false, true];
              for (const e of order) {
                const a = arm(e);
                if (e) { on.push(a.med); callsOn = a.calls; trisOn = a.tris; } else { off.push(a.med); callsOff = a.calls; trisOff = a.tris; }
              }
              await new Promise((res) => setTimeout(res, 0));
            }
            if (which === 'lod1') r.debugStructureLod1(true);
            else r.debugPerTileInstancing(true);
            return { on, off, callsOn, callsOff, trisOn, trisOff };
          },
          [v.marker, v.zoom, rounds, frames, toggle] as const
        );
        const med = (a: number[]): number => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
        const diffs = t.off.map((o, i) => o - t.on[i]);
        console.log(
          `[instancing-ab] TIME(${toggle}) ${v.marker} z${v.zoom}: ${toggle === 'lod1' ? 'full art' : 'clones'} ${med(t.off).toFixed(2)} ms  ${toggle === 'lod1' ? 'lod1 twin' : 'instanced'} ${med(t.on).toFixed(2)} ms  ` +
            `saved paired-median ${med(diffs).toFixed(2)} ms (mean ${(diffs.reduce((x, y) => x + y, 0) / diffs.length).toFixed(2)}, instanced faster in ${diffs.filter((x) => x > 0).length}/${diffs.length} rounds)  ` +
            `calls ${t.callsOff} -> ${t.callsOn}  tris ${(t.trisOff / 1000).toFixed(0)}k -> ${(t.trisOn / 1000).toFixed(0)}k  loadavg ${os.loadavg().map((x) => x.toFixed(1)).join('/')}  rounds ${rounds}x${frames}`
        );
      }
    }
  }
} finally {
  await browser.close();
  stop();
}
if (failed) process.exitCode = 1;
