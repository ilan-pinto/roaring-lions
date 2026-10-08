// GH-470 mock instrument: photographs an objective zone over a town centre,
// on the LIVE renderer, once per zone-drawing variant, on the SAME frame.
//
// Usage (an already-running dev server of THIS tree, never :5177):
//   pnpm --filter @lions/tools exec tsx src/perf/zone-tint-captures.ts --port=5193 --out=<dir>
//
// One Metal browser, music off, frame loop frozen before anything is stepped,
// so every variant of a scene is the same sim tick and the same camera --
// the only thing that differs between two photographs of one scene is the
// zone's own draw. The variants are switched through `renderer.zoneMock`,
// a field that exists only on the `design/zone-tint` mock patch
// (`docs/polish/zone-tint/mock.patch`); on a tree without it every variant
// photographs "today", which the log says.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { dismissDeployGate } from '../golden-diff/capture-guard';
import { FREEZE_FRAME_LOOP_STATEMENTS, hideHudExceptCanvas } from '../golden-diff/capture-protocol';
import { gpuLaunchArgs } from '../ui-review/gpu';
import { musicOffInitScript } from '../ui-review/music-off';

interface Scene {
  id: string;
  /** Query string after `/?`. */
  query: string;
  mission: boolean;
  /** Where the force is sent, so the zone is explored and has units in it. */
  rally: [number, number];
  /** Camera centre, in tiles. */
  look: [number, number];
  /** Camera centre for the close zoom: on the zone's edge, so the outline
   *  and any edge band are in shot as well as units inside it. */
  lookClose: [number, number];
  /** Sim tick to photograph at. */
  tick: number;
  /** False: draws no zone in the world, so only "today" is photographed. */
  variants?: boolean;
}

const SCENES: readonly Scene[] = [
  // take_town: capture zone `town` [18,8,24,32] -- the whole town.
  {
    id: 'clearance',
    query: 'mission=beit_sahwan_3_clearance',
    mission: true,
    rally: [22, 25],
    look: [29, 24],
    lookClose: [20, 23],
    tick: 320,
  },
  // The same zone NOT held (dashed, VR-36): the force halted short of it.
  {
    id: 'clearance-unheld',
    query: 'mission=beit_sahwan_3_clearance',
    mission: true,
    rally: [14, 24],
    look: [24, 23],
    lookClose: [19, 22],
    tick: 320,
  },
  // hold_west [0,12,16,24] beside the collapse target tunnel_mouth_west.
  {
    id: 'foothold',
    query: 'mission=beit_sahwan_2_foothold',
    mission: true,
    rally: [12, 22],
    look: [14, 23],
    lookClose: [14, 15],
    tick: 500,
  },
  // `&roe` flagged ground: proves no world layer draws it (minimap only).
  {
    id: 'roe-sandbox',
    query: 'sandbox=beit_sahwan_outskirts&roe',
    mission: false,
    rally: [24, 24],
    look: [24, 24],
    lookClose: [24, 24],
    tick: 200,
    variants: false,
  },
];

const VARIANTS = ['today', 'a', 'b', 'c', 'd'] as const;
const ZOOMS: readonly ['default' | 'close' | 'far', number | null][] = [
  ['default', null],
  ['close', 2.0],
  ['far', 0.55],
];

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

async function main(): Promise<void> {
  const port = Number(arg('port', '5193'));
  if (port === 5177) throw new Error('5177 is the lead’s server; pick another port');
  const outDir = resolve(arg('out', 'zone-tint-out'));
  const only = arg('only', '');
  mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true, args: gpuLaunchArgs('metal') });
  try {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
    await context.addInitScript(musicOffInitScript());
    const page = await context.newPage();
    page.on('pageerror', (e) => console.warn(`[zone-tint] pageerror: ${e.message}`));
    for (const scene of SCENES) {
      if (only && !only.split(',').includes(scene.id)) continue;
      await page.goto(`http://localhost:${port}/?${scene.query}`, { waitUntil: 'load', timeout: 60_000 });
      if (scene.mission) await dismissDeployGate(page, scene.id);
      await page.mouse.move(0, 0);
      await page.waitForFunction(() => typeof (window as unknown as { __lions?: unknown }).__lions !== 'undefined', undefined, {
        timeout: 30_000,
      });
      await page.evaluate(`(async () => { ${FREEZE_FRAME_LOOP_STATEMENTS} })()`);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(1500);
      await page.evaluate(hideHudExceptCanvas);
      const info = await page.evaluate(`(async () => {
        const L = window.__lions;
        const bootZoom = L.renderer.camera.zoom;
        const ids = L.units(0).map((u) => u.id);
        L.sim.queueCommand({ kind: 'move', ids, x: Math.round(${scene.rally[0]} * 65536), y: Math.round(${scene.rally[1]} * 65536) });
        L.step(Math.max(0, ${scene.tick} - L.sim.tickCount));
        L.hover(-1000, -1000);
        L.renderer.selection = [];
        return JSON.stringify({ bootZoom, tick: L.sim.tickCount, zones: L.renderer.objectiveZones ?? null,
          mock: 'zoneMock' in L.renderer });
      })()`);
      const parsed = JSON.parse(info as string) as { bootZoom: number; tick: number; zones: unknown; mock: boolean };
      console.log(`[zone-tint] ${scene.id}: ${info as string}`);
      for (const [zname, zoom] of ZOOMS) {
        for (const v of VARIANTS) {
          if ((!parsed.mock || scene.variants === false) && v !== 'today') continue;
          const ms = await page.evaluate(`(async () => {
            const L = window.__lions;
            L.goto(${zname === 'close' ? scene.lookClose[0] : scene.look[0]}, ${zname === 'close' ? scene.lookClose[1] : scene.look[1]});
            L.renderer.camera.zoom = ${zoom ?? parsed.bootZoom};
            if ('zoneMock' in L.renderer) L.renderer.zoneMock = ${JSON.stringify(v)};
            L.renderer.frame(1, 0);
            const gl = L.renderer.renderer;
            const ctx = gl.getContext();
            const px = new Uint8Array(4);
            const sync = () => ctx.readPixels(0, 0, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
            sync();
            const samples = [];
            for (let k = 0; k < 40; k++) {
              const t0 = performance.now();
              L.renderer.frame(1, 0);
              sync();
              samples.push(performance.now() - t0);
            }
            samples.sort((p, q) => p - q);
            gl.info.autoReset = false; gl.info.reset(); L.renderer.frame(1, 0);
            const calls = gl.info.render.calls; const tris = gl.info.render.triangles;
            gl.info.autoReset = true;
            return JSON.stringify({ median: samples[20], p90: samples[36], calls, tris });
          })()`);
          await page.evaluate(hideHudExceptCanvas);
          const file = join(outDir, `${scene.id}-${zname}-${v}.png`);
          await page.screenshot({ path: file });
          const m = JSON.parse(ms as string) as { median: number; p90: number; calls: number; tris: number };
          console.log(
            `[zone-tint] ${scene.id} ${zname} ${v}: frame+sync median ${m.median.toFixed(2)} ms p90 ${m.p90.toFixed(2)} ms, ` +
              `${m.calls} draw calls, ${m.tris} triangles -> ${file}`
          );
        }
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
