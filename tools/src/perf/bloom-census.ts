/**
 * `pnpm perf:bloom-census` -- the threshold census behind the selective HDR
 * bloom (Defilade Task 4; `packages/render/src/three/bloom.ts`, rulings D1/D8).
 *
 *   pnpm perf:bloom-census [-- --only=<map>[,<map>]] [--quality=medium[,high]] [--aftermath=on|off|only]
 *                             [--threshold=0.9] [--stride=5] [--port=<n>] [--gpu=metal|swiftshader]
 *
 * WHAT IT HOLDS. The bloom thresholds a SCENE-REFERRED linear luminance of
 * 1.0, and the claim that makes turning it on at `high` free -- no gated
 * golden frame moves -- is that nothing in a quiet frame gets near that. This
 * tool measures it instead of assuming it: for EVERY map in `data/maps/` it
 * boots `?sandbox=<map>&tod=day`, freezes the frame loop AT TICK 0 (a later
 * freeze reloads -- see the boot loop), sets the renderer quiet, waits for
 * the GLBs,
 * and reads the PRE-bloom HalfFloat buffer -- RenderPass, fog, AO, nothing
 * after -- through `ThreeRenderer.debugPreBloomLuminance`, the same buffer
 * the bloom's high-pass reads. Every `stride`-th pixel, at two views a map:
 *
 *   - `whole`  the map centre at zoom 0.5 -- every surface on the map.
 *   - `force`  the centroid of the player's sandbox force (`__lions.units()`)
 *              at zoom 1.6 -- its textured vehicle bakes, close.
 *
 * It prints p50 / p99 / max and the fraction above 1.0 per view, and EXITS 1
 * if any quiet pixel is above `--threshold` (default 0.9, a 10% margin under
 * the bloom's 1.0). A map that exceeds it is a finding to report, never a
 * reason to raise the limit.
 *
 * Two choices make it STRICTER than a player's frame, on purpose:
 *   - fog of war is revealed (the `fog` debug layer, `uRevealAll`): the shroud
 *     only darkens, and the player will see every tile lit eventually;
 *   - the default preset is `medium`: the brightest bloom-on preset, because
 *     `high` differs from it by AO (a multiply that only darkens) and a
 *     larger shadow map. `--quality=medium,high` runs both.
 *
 * `--threshold=0.5` is the falsification: 44 of the 140 views (16 of 35
 * maps) read a quiet max above 0.5 on the first full run, so the run must go
 * red (it does: exit 1). Exit 2 is a harness failure
 * (no renderer, no read), never a verdict.
 *
 * THE AFTERMATH READ (Defilade Task 7). The per-map views are quiet by
 * construction -- tick 0, nothing fired -- and so they cannot see the one
 * gated frame whose whole subject is what a battle LEAVES: the `aftermath`
 * golden scenario (`AFTERMATH_SCENARIO`, `capture-protocol.ts`, imported here
 * and never copied), every decal kind stamped on `qarn_hadid`'s road, relief
 * and flat showcase sites. A pale crater lip is an albedo RATIO above 1
 * multiplied onto the lit ground (`decal-pool.ts`), the one quiet-frame
 * pixel class that is designed to brighten, so it is the place a quiet pixel
 * could reach the bloom's 1.0. This read boots that scenario through the gate's
 * OWN `capture()` (boot freeze, settle, step to tick 300, the gate's viewport)
 * and reads the pre-bloom buffer twice: with the scenario's own fog (the frame
 * the gate photographs) and with fog revealed (stricter, as above). Three
 * conditions: `medium` and `high` at DPR 1, and `high` at DPR 2 -- the
 * shipping default on a Retina display, where the decals are sampled at twice
 * the density. Same ceiling, same exit code. `--aftermath=only` runs it
 * alone; `--aftermath=off` skips it. A third read hides the pooled flash
 * lights and is printed for ATTRIBUTION only (it never votes): first run,
 * 2026-10-21, the gated frame read max 3.0 at DPR 1 and 3.26 at DPR 2 -- seven
 * small-arms muzzle-flash lights stacked on one point at (24.3, 32.5), the
 * sandbox force firing at tick 300, lighting the ground in the frame's
 * top-left corner -- and 0.69 with them hidden, so no decal and no pale lip
 * is near the limit. That is a finding for the lead, not a reason to move the
 * ceiling or the frame.
 *
 * Conditions: Playwright Chromium, Metal by default on macOS
 * (`ui-review/gpu.ts`), 1440x900 at DPR 1, music off
 * (`musicOffInitScript`), its own dev server on `--port` (default 5186,
 * refused if held -- `ui-review/port.ts`). One browser, one page at a time.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { capture, devServerStopper, ensureDevServer, readUnmaskedRenderer } from '../golden-diff/browser';
import { AFTERMATH_SCENARIO, CAPTURE_VIEWPORT, captureScript, threeUrl } from '../golden-diff/capture-protocol';
import { musicOffInitScript } from '../ui-review/music-off';
import { gpuLaunchArgs, resolveGpuBackend } from '../ui-review/gpu';
import { claimPort } from '../ui-review/port';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DEFAULT_PORT = 5186;
const QUIET_CEILING = 0.9;
const BOOT_TIMEOUT_MS = 240_000;
const LOAD_SETTLE_MS = 4_000;
const MAX_BOOT_ATTEMPTS = 6;

function arg(name: string, fallback: string): string {
  const hit = process.argv
    .slice(2)
    .filter((a) => a.startsWith(`--${name}=`))
    .at(-1);
  return hit === undefined ? fallback : hit.slice(name.length + 3);
}

interface ViewReading {
  view: string;
  x: number;
  y: number;
  zoom: number;
  samples: number;
  p50: number;
  p99: number;
  max: number;
  fracOverThreshold: number;
  width: number;
  height: number;
}

const QUALITIES = ['low', 'medium', 'high'] as const;
type Quality = (typeof QUALITIES)[number];

/** The aftermath read's conditions: the brightest bloom-on preset, the gated
 *  preset, and the gated preset at Retina density. */
const AFTERMATH_CONDITIONS: readonly { quality: Quality; dpr: number }[] = [
  { quality: 'medium', dpr: 1 },
  { quality: 'high', dpr: 1 },
  { quality: 'high', dpr: 2 },
];

type Census = {
  samples: number;
  p50: number;
  p99: number;
  max: number;
  fracOverThreshold: number;
  width: number;
  height: number;
};

/**
 * Boots `AFTERMATH_SCENARIO` through the gate's own `capture()` -- the boot
 * freeze, the settle at `BOOT_SETTLE_TICK`, the step to its `targetTick`, its
 * camera and zoom, at `CAPTURE_VIEWPORT` -- and reads the pre-bloom buffer
 * with the scenario's own fog and then with fog revealed.
 */
async function aftermathReads(
  browser: import('playwright').Browser,
  port: number,
  stride: number,
  quality: Quality,
  dpr: number
): Promise<{ tick: number; reads: { fog: string; census: Census }[] }> {
  const page = await browser.newPage({ viewport: { ...CAPTURE_VIEWPORT }, deviceScaleFactor: dpr });
  try {
    await page.addInitScript(musicOffInitScript({}, { quality }));
    await page.addInitScript('window.__name = (f) => f;');
    const dir = path.join(REPO_ROOT, '.superpowers', 'art-captures', 'bloom-census');
    fs.mkdirSync(dir, { recursive: true });
    const shot = path.join(dir, `aftermath-${quality}-dpr${dpr}.png`);
    const result = await capture(page, threeUrl(port, AFTERMATH_SCENARIO), captureScript(AFTERMATH_SCENARIO), shot, `bloom-census aftermath ${quality} dpr${dpr}`);
    if (result.tick !== AFTERMATH_SCENARIO.targetTick) {
      throw new Error(`aftermath captured at tick ${result.tick}, not ${AFTERMATH_SCENARIO.targetTick}`);
    }
    const reads = (await page.evaluate(
      ({ s }) => {
        const r = (
          window as unknown as {
            __lions: {
              renderer: {
                frame(alpha: number, dtMs: number): void;
                setDebugLayerVisible(name: string, visible: boolean): number;
                debugPreBloomLuminance?(stride: number): unknown;
              };
            };
          }
        ).__lions.renderer;
        if (typeof r.debugPreBloomLuminance !== 'function') throw new Error('renderer has no debugPreBloomLuminance');
        const out: { fog: string; census: unknown }[] = [];
        // Zero elapsed time throughout: the gate's own repaint, so the frame
        // read is the frame the gate photographs.
        r.frame(1, 0);
        out.push({ fog: 'gate', census: r.debugPreBloomLuminance(s) });
        r.setDebugLayerVisible('fog', false);
        r.frame(1, 0);
        out.push({ fog: 'revealed', census: r.debugPreBloomLuminance(s) });
        r.setDebugLayerVisible('fog', true);
        // ATTRIBUTION, not a verdict: the same frame with the pooled flash
        // lights hidden. Printed so a red aftermath line says whether the hot
        // pixel is a DECAL (it survives this) or a live light falling on
        // ground at the frame's edge (it does not). Never consulted by the
        // exit code -- the frame the gate photographs is the one judged.
        r.setDebugLayerVisible('blast-light', false);
        r.frame(1, 0);
        out.push({ fog: 'gate, flash lights hidden (attribution only)', census: r.debugPreBloomLuminance(s) });
        r.setDebugLayerVisible('blast-light', true);
        r.frame(1, 0);
        return out;
      },
      { s: stride }
    )) as { fog: string; census: Census | null }[];
    for (const x of reads) if (x.census === null) throw new Error(`debugPreBloomLuminance returned null (${x.fog})`);
    return { tick: result.tick, reads: reads as { fog: string; census: Census }[] };
  } finally {
    await page.close();
  }
}

async function main(): Promise<number> {
  const threshold = Number(arg('threshold', String(QUIET_CEILING)));
  if (!Number.isFinite(threshold) || threshold <= 0) throw new Error('--threshold must be a positive number');
  const stride = Number(arg('stride', '5'));
  if (!Number.isInteger(stride) || stride < 1) throw new Error('--stride must be a positive integer');
  const qualities = arg('quality', 'medium')
    .split(',')
    .map((q) => q.trim()) as Quality[];
  for (const q of qualities) if (!QUALITIES.includes(q)) throw new Error(`--quality=${q} is not one of ${QUALITIES.join(', ')}`);
  const allMaps = fs
    .readdirSync(path.join(REPO_ROOT, 'data', 'maps'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length))
    .sort();
  const only = arg('only', '');
  const maps = only
    ? only
        .split(',')
        .map((m) => m.trim())
        .filter((m) => m.length > 0)
    : allMaps;
  for (const m of maps) if (!allMaps.includes(m)) throw new Error(`--only=${m} names no map in data/maps/`);
  const aftermath = arg('aftermath', 'on');
  if (!['on', 'off', 'only'].includes(aftermath)) throw new Error('--aftermath must be on, off or only');
  const backend = resolveGpuBackend(process.argv.slice(2), process.platform);

  const port = await claimPort('bloom-census', 'BLOOM_CENSUS_PORT', DEFAULT_PORT);
  const stop = devServerStopper(await ensureDevServer(port, REPO_ROOT, 'bloom-census'), 'bloom-census');
  const browser = await chromium.launch({
    headless: true,
    args: gpuLaunchArgs(backend),
  });
  const failures: string[] = [];
  const harnessErrors: string[] = [];
  try {
    const gl = await readUnmaskedRenderer(browser);
    console.log(`[bloom-census] gpu=${gl} maps=${maps.length} quality=${qualities.join(',')} stride=${stride} ceiling=${threshold}`);
    console.log('map | quality | view (x,y,zoom) | samples | p50 | p99 | max | frac>1.0');
    for (const quality of aftermath === 'only' ? [] : qualities) {
      for (const map of maps) {
        const page = await browser.newPage({
          viewport: { width: 1440, height: 900 },
          deviceScaleFactor: 1,
        });
        page.setDefaultTimeout(BOOT_TIMEOUT_MS);
        const errors: string[] = [];
        page.on('pageerror', (err) => errors.push(err.message));
        try {
          await page.addInitScript(musicOffInitScript({}, { quality }));
          // tsx's esbuild `keepNames` wraps inner functions in `__name(...)`,
          // which does not exist in the page.
          await page.addInitScript('window.__name = (f) => f;');
          // Freeze the app's frame loop AT TICK 0, or reload and try again.
          // The sim ticks only from that loop, so a frame frozen at tick 0
          // has fired nothing, killed nothing and identified nothing: it is
          // quiet by construction. A late freeze is NOT quiet -- measured on
          // the first full run: frozen at tick 1, `beit_sahwan_outskirts`
          // read max 2.01 (352 px over 0.9), and hiding the `tunnel-xray`
          // layer alone took it back to 0.41. That is the tunnel discovery
          // beat (`tunnel-xray.ts`), an EFFECT, so the frame is refused and
          // the page reloaded -- the visual gate's own rule
          // (`lateFreezeRefusal`, `capture-protocol.ts`).
          let tick = -1;
          for (let attempt = 1; attempt <= MAX_BOOT_ATTEMPTS; attempt++) {
            try {
              await page.goto(`http://localhost:${port}/?sandbox=${map}&tod=day`, { waitUntil: 'load', timeout: BOOT_TIMEOUT_MS });
              // The freeze happens INSIDE the predicate, on the first poll that
              // sees the battlefield, so no app frame can run between "booted"
              // and "frozen".
              await page.waitForFunction(
                () => {
                  const w = window as unknown as {
                    __lions?: { renderer?: unknown };
                  };
                  if (!w.__lions?.renderer) return false;
                  window.requestAnimationFrame = () => 0;
                  return true;
                },
                null,
                { timeout: BOOT_TIMEOUT_MS, polling: 50 }
              );
              tick = await page.evaluate(() => {
                const L = (
                  window as unknown as {
                    __lions: {
                      sim: { tickCount: number };
                      renderer: { setQuiet?(q: boolean): void };
                    };
                  }
                ).__lions;
                L.renderer.setQuiet?.(true);
                return L.sim.tickCount;
              });
            } catch (err) {
              // A reload racing the previous page's teardown can destroy the
              // execution context mid-evaluate (seen once in 140 boots, on
              // `tel_marum` at `high`): that is a failed BOOT, not a reading,
              // so it costs an attempt rather than the map.
              tick = -1;
              console.log(
                `${map} | ${quality} | boot attempt ${attempt} failed (${err instanceof Error ? err.message.split('\n')[0] : String(err)})`
              );
              continue;
            }
            if (tick === 0) break;
            console.log(`${map} | ${quality} | froze at tick ${tick}, not 0 -- reloading (attempt ${attempt}/${MAX_BOOT_ATTEMPTS})`);
          }
          if (tick !== 0) throw new Error(`could not freeze at tick 0 in ${MAX_BOOT_ATTEMPTS} boots (last tick ${tick})`);
          // GLBs load on promises, not frames.
          await page.waitForLoadState('networkidle', { timeout: BOOT_TIMEOUT_MS }).catch(() => undefined);
          await page.waitForTimeout(LOAD_SETTLE_MS);
          const readings = (await page.evaluate(
            ({ stride: s }) => {
              type Census = {
                samples: number;
                p50: number;
                p99: number;
                max: number;
                fracOverThreshold: number;
                width: number;
                height: number;
              };
              const L = (
                window as unknown as {
                  __lions: {
                    sim: { width: number; height: number; tickCount: number };
                    units(): { x: number; y: number }[];
                    renderer: {
                      camera: { x: number; y: number; zoom: number };
                      frame(alpha: number, dtMs: number): void;
                      setDebugLayerVisible(name: string, visible: boolean): number;
                      debugPreBloomLuminance?(stride: number): Census | null;
                    };
                  };
                }
              ).__lions;
              const r = L.renderer;
              if (typeof r.debugPreBloomLuminance !== 'function') throw new Error('renderer has no debugPreBloomLuminance');
              r.setDebugLayerVisible('fog', false);
              const force = L.units();
              const boot =
                force.length > 0
                  ? {
                      x: force.reduce((a, u) => a + u.x, 0) / force.length + 0.5,
                      y: force.reduce((a, u) => a + u.y, 0) / force.length + 0.5,
                    }
                  : { x: r.camera.x, y: r.camera.y };
              const views: [string, number, number, number][] = [
                ['whole', L.sim.width / 2, L.sim.height / 2, 0.5],
                ['force', boot.x, boot.y, 1.6],
              ];
              const out: Record<string, unknown>[] = [];
              for (const [view, x, y, zoom] of views) {
                r.camera.x = x;
                r.camera.y = y;
                r.camera.zoom = zoom;
                // Zero elapsed time: lay the scene out for this camera
                // (meshes stood up, fog read) without advancing any clock.
                for (let i = 0; i < 3; i++) r.frame(1, 0);
                const c = r.debugPreBloomLuminance(s);
                if (c === null) throw new Error('debugPreBloomLuminance returned null');
                out.push({ view, x, y, zoom, ...c });
              }
              return { tick: L.sim.tickCount, out };
            },
            { stride }
          )) as unknown as { tick: number; out: ViewReading[] };
          for (const v of readings.out) {
            const line = `${map} | ${quality} | ${v.view} (${v.x.toFixed(1)},${v.y.toFixed(1)},${v.zoom}) | ${v.samples} | ${v.p50.toFixed(4)} | ${v.p99.toFixed(4)} | ${v.max.toFixed(4)} | ${v.fracOverThreshold.toFixed(6)}`;
            console.log(line);
            if (!(v.max <= threshold)) failures.push(`${map} ${quality} ${v.view}: max ${v.max.toFixed(4)} > ${threshold}`);
            if (v.samples === 0) harnessErrors.push(`${map} ${quality} ${v.view}: read 0 samples`);
          }
        } catch (err) {
          harnessErrors.push(
            `${map} ${quality}: ${err instanceof Error ? err.message : String(err)}${errors.length ? ` (page errors: ${errors.join(' | ')})` : ''}`
          );
          console.log(`${map} | ${quality} | HARNESS ERROR: ${harnessErrors[harnessErrors.length - 1]}`);
        } finally {
          await page.close();
        }
      }
    }
    if (aftermath !== 'off') {
      const a = AFTERMATH_SCENARIO;
      console.log(
        `aftermath | ${a.sandboxMap}&${(a.sandboxFlags ?? []).join('&')} @ (${a.cameraTile?.join(',')}) zoom ${a.zoom} tick ${a.targetTick}, ${CAPTURE_VIEWPORT.width}x${CAPTURE_VIEWPORT.height}`
      );
      for (const { quality, dpr } of AFTERMATH_CONDITIONS) {
        try {
          const { reads } = await aftermathReads(browser, port, stride, quality, dpr);
          for (const { fog, census: v } of reads) {
            const line = `aftermath | ${quality} | dpr ${dpr} | fog ${fog} | ${v.width}x${v.height} | ${v.samples} | ${v.p50.toFixed(4)} | ${v.p99.toFixed(4)} | ${v.max.toFixed(4)} | ${v.fracOverThreshold.toFixed(6)}`;
            console.log(line);
            if (fog.includes('attribution')) continue;
            if (!(v.max <= threshold)) failures.push(`aftermath ${quality} dpr${dpr} fog-${fog}: max ${v.max.toFixed(4)} > ${threshold}`);
            if (v.samples === 0) harnessErrors.push(`aftermath ${quality} dpr${dpr} fog-${fog}: read 0 samples`);
          }
        } catch (err) {
          harnessErrors.push(`aftermath ${quality} dpr${dpr}: ${err instanceof Error ? err.message : String(err)}`);
          console.log(`aftermath | ${quality} | dpr ${dpr} | HARNESS ERROR: ${harnessErrors[harnessErrors.length - 1]}`);
        }
      }
    }
  } finally {
    await browser.close();
    stop();
  }
  if (harnessErrors.length > 0) {
    console.error(`[bloom-census] ${harnessErrors.length} harness error(s):\n  ${harnessErrors.join('\n  ')}`);
    return 2;
  }
  if (failures.length > 0) {
    console.error(`[bloom-census] FAIL: ${failures.length} view(s) have a quiet pixel above ${threshold}:\n  ${failures.join('\n  ')}`);
    return 1;
  }
  console.log(
    `[bloom-census] PASS: every quiet pixel on ${aftermath === 'only' ? 0 : maps.length} map(s)` +
      `${aftermath === 'off' ? '' : ' and in the aftermath frame'} is at or under ${threshold}`
  );
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`[bloom-census] ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    process.exit(2);
  }
);
