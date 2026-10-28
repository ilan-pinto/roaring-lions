// Wadi Halam look (Lane B, GH-161): backdrop before/after captures, in game.
// ONE browser, its own dev server on --port, music off, Metal, frame loop frozen, HUD hidden.
// "before" and "after" come from the SAME page by toggling the `backdrop` debug layer
// (off = today's flat skirt + never-seen off-map fog; on = the valley: floor + kit). Waits for the kit GLB
// to load and the backdrop to build (`renderer.backdropStats` non-null) before the first shot, and refuses to
// shoot an 'after' that is really the fallback skirt.
//
//   npx tsx src/wadi-look/capture.ts --port=5188 --out=<dir> [--maps=a,b] [--tods=day,dusk] [--zooms=0.35,1,2.5] [--fog=on|off]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';
import { PNG } from 'pngjs';
import { ensureDevServer, readUnmaskedRenderer, stopDevServer } from '../golden-diff/browser';
import { CAPTURE_VIEWPORT, FREEZE_FRAME_LOOP_SCRIPT, hideHudExceptCanvas } from '../golden-diff/capture-protocol';
import { gpuLaunchArgs } from '../ui-review/gpu';
import { musicOffInitScript } from '../ui-review/music-off';
import { claimPort } from '../ui-review/port';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const TAG = 'wadi-look';
const flag = (name: string, d: string): string => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? d;
const out = path.resolve(flag('out', '.superpowers/wadi-look'));
const maps = flag('maps', 'wadi_halam_4').split(',');
const tods = flag('tods', 'day,dusk').split(',');
// name, zoom, fraction of the map width/height the camera is centred on.
const ALL_VIEWS: { name: string; zoom: number; fx: number; fy: number }[] = [
  { name: 'centre', zoom: 0.35, fx: 0.5, fy: 0.5 },
  { name: 'west', zoom: 1, fx: 0.04, fy: 0.5 },
  { name: 'north', zoom: 1, fx: 0.5, fy: 0.04 },
  { name: 'east', zoom: 1, fx: 0.96, fy: 0.5 },
  { name: 'south', zoom: 1, fx: 0.5, fy: 0.96 },
  { name: 'west', zoom: 2.5, fx: 0.03, fy: 0.5 },
  { name: 'south', zoom: 2.5, fx: 0.5, fy: 0.97 },
  // The two outer corners (SW, NE), where a far wall's taper meets a near side, and the far feet: framed OUTSIDE
  // the rectangle (the camera is a free object here; the app clamps it, this tool does not).
  { name: 'sw-corner', zoom: 0.7, fx: -0.3, fy: 1.3 },
  { name: 'ne-corner', zoom: 0.7, fx: 1.3, fy: -0.3 },
  { name: 'sw-corner', zoom: 1.5, fx: -0.3, fy: 1.3 },
  { name: 'west-foot', zoom: 1.5, fx: -0.15, fy: 0.5 },
  // The corners as a player reaches them: the camera at the playable rectangle's own corner.
  { name: 'sw-edge', zoom: 1, fx: 0.04, fy: 0.96 },
  { name: 'ne-edge', zoom: 1, fx: 0.96, fy: 0.04 },
];
const viewNames = flag('views', '').split(',').filter(Boolean);
const zoomOnly = flag('zooms', '').split(',').filter(Boolean).map(Number);
const VIEWS = ALL_VIEWS.filter((v) => (viewNames.length === 0 || viewNames.includes(`${v.name}@${v.zoom}`)) && (zoomOnly.length === 0 || zoomOnly.includes(v.zoom)));
const fogMode = flag('fog', 'on');
const only = flag('only', ''); // 'after' to skip the before shots
// `--lozenge`: after each before/after pair, diff the PLAYABLE rectangle's own pixels (the map's four corners
// projected by the renderer, shrunk by LOZENGE_INSET px so the rim's elevation shift cannot leak in). The
// backdrop never covers the lozenge, so the band must read exactly zero; the geometric proof is
// `tools/src/backdrop_lozenge.test.ts`, this is the pixel witness.
const lozengeCheck = process.argv.includes('--lozenge');
const LOZENGE_INSET = Number(flag('inset', '40'));

interface Lions {
  __lions: {
    goto(x: number, y: number): unknown;
    sim: { width: number; height: number };
    renderer: {
      readonly canvas: HTMLCanvasElement;
      worldToScreen(wx: number, wy: number): { x: number; y: number };
      camera: { x: number; y: number; zoom: number };
      frame(a: number, dt: number): void;
      setDebugLayerVisible(n: string, v: boolean): number;
      backdropStats: unknown;
    };
  };
}

async function boot(page: Page, port: number, map: string, tod: string): Promise<void> {
  const q = tod === 'day' ? '' : `&tod=${tod}`;
  await page.goto(`http://localhost:${port}/?sandbox=${map}${q}`, { waitUntil: 'load', timeout: 90_000 });
  await page.waitForFunction(() => typeof (window as unknown as Lions).__lions !== 'undefined', null, { timeout: 90_000 });
  // The kit is fetched in parallel with the roster; the backdrop is built by the first terrain rebuild after it lands.
  await page.waitForFunction(
    () => (window as unknown as Lions).__lions.renderer.backdropStats !== null,
    null,
    { timeout: 60_000 }
  );
  await page.evaluate(FREEZE_FRAME_LOOP_SCRIPT);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(3000);
  await page.evaluate(hideHudExceptCanvas);
  const actual = new URL(page.url()).port;
  if (actual !== String(port)) throw new Error(`browser on :${actual}, asked for :${port}`);
}

/** The playable rectangle's pixels, before against after: `<n> px compared, <k> differ (max channel delta <d>)`. */
function lozengeDiff(beforeFile: string, afterFile: string, quad: { x: number; y: number }[]): string {
  const a = PNG.sync.read(fs.readFileSync(beforeFile));
  const b = PNG.sync.read(fs.readFileSync(afterFile));
  // Inside the convex quad by at least LOZENGE_INSET px from every edge.
  const inside = (px: number, py: number): boolean => {
    for (let i = 0; i < 4; i++) {
      const p = quad[i];
      const q = quad[(i + 1) % 4];
      const ex = q.x - p.x;
      const ey = q.y - p.y;
      const cross = (px - p.x) * ey - (py - p.y) * ex; // sign by winding
      const dist = Math.abs(cross) / Math.hypot(ex, ey);
      const sign = ((quad[2].x - quad[0].x) * (quad[1].y - quad[0].y) - (quad[2].y - quad[0].y) * (quad[1].x - quad[0].x)) > 0 ? 1 : -1;
      if (cross * sign < 0 || dist < LOZENGE_INSET) return false;
    }
    return true;
  };
  let n = 0;
  let differ = 0;
  let max = 0;
  // The frame, dimmed, with every differing pixel inside the band painted red: where a diff sits says whether it is the backdrop.
  const map = new PNG({ width: a.width, height: a.height });
  for (let i = 0; i < a.data.length; i += 4) {
    map.data[i] = a.data[i] >> 2;
    map.data[i + 1] = a.data[i + 1] >> 2;
    map.data[i + 2] = a.data[i + 2] >> 2;
    map.data[i + 3] = 255;
  }
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      if (!inside(x, y)) continue;
      n++;
      const o = (y * a.width + x) * 4;
      const d = Math.max(Math.abs(a.data[o] - b.data[o]), Math.abs(a.data[o + 1] - b.data[o + 1]), Math.abs(a.data[o + 2] - b.data[o + 2]));
      if (d > 0) {
        differ++;
        map.data[o] = 255;
        map.data[o + 1] = 40;
        map.data[o + 2] = 40;
      }
      if (d > max) max = d;
    }
  }
  fs.writeFileSync(afterFile.replace(/\.png$/, '-lozenge-diff.png'), PNG.sync.write(map));
  return `lozenge ${path.basename(afterFile)}: ${n} px compared (inset ${LOZENGE_INSET} px), ${differ} differ, max channel delta ${max}`;
}

async function main(): Promise<void> {
  const port = await claimPort(TAG, 'WADI_LOOK_PORT', 5188);
  if (port === 5177) throw new Error("5177 is the lead's dev server");
  fs.mkdirSync(out, { recursive: true });
  const server = await ensureDevServer(port, REPO_ROOT, TAG);
  console.log(`[${TAG}] ${server ? 'STARTED' : 'REUSED'} dev server on :${port}`);
  const browser = await chromium.launch({ headless: true, args: gpuLaunchArgs('metal') });
  try {
    console.log(`[${TAG}] gl=${await readUnmaskedRenderer(browser)} viewport=${CAPTURE_VIEWPORT.width}x${CAPTURE_VIEWPORT.height} fog=${fogMode}`);
    const page = await browser.newPage({ viewport: CAPTURE_VIEWPORT, deviceScaleFactor: 1 });
    await page.addInitScript(musicOffInitScript());
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 200)}`);
    });
    for (const map of maps) {
      for (const tod of tods) {
        await boot(page, port, map, tod);
        const stats = await page.evaluate(() => JSON.stringify((window as unknown as Lions).__lions.renderer.backdropStats));
        console.log(`[${TAG}] ${map} ${tod} backdropStats=${stats}`);
        for (const view of VIEWS) {
          const zoom = view.zoom;
          const shots: Record<string, string> = {};
          let quad: { x: number; y: number }[] = [];
          // `control` is `before` shot again: the page's own noise floor (ambient dust, particles), which a real
          // difference must stand clear of.
          for (const state of lozengeCheck ? ['before', 'after', 'control'] : ['before', 'after']) {
            if (only && state !== only) continue;
            const rect = await page.evaluate(
              ([zoomV, on, fogOff, fx, fy]) => {
                const L = (window as unknown as Lions).__lions;
                const r = L.renderer;
                r.setDebugLayerVisible('backdrop', on as boolean);
                r.setDebugLayerVisible('fog', !fogOff);
                r.camera.x = L.sim.width * (fx as number);
                r.camera.y = L.sim.height * (fy as number);
                r.camera.zoom = zoomV as number;
                r.frame(1, 0);
                r.frame(1, 0);
                const c = r.canvas.getBoundingClientRect();
                return { x: c.x, y: c.y, w: c.width, h: c.height };
              },
              [zoom, state === 'after', fogMode === 'off', view.fx, view.fy] as const
            );
            const file = path.join(out, `${map}-${tod}-${view.name}-z${zoom}-fog${fogMode}-${state}.png`);
            await page.screenshot({ path: file, clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h } });
            console.log(`[${TAG}] ${path.basename(file)}`);
            shots[state] = file;
            if (state === 'after') {
              quad = await page.evaluate(() => {
                const L = (window as unknown as Lions).__lions;
                const { width: w, height: h } = L.sim;
                return [[0, 0], [w, 0], [w, h], [0, h]].map(([x, y]) => L.renderer.worldToScreen(x, y));
              });
            }
          }
          if (lozengeCheck && shots.before && shots.after) {
            console.log(`[${TAG}] after   ${lozengeDiff(shots.before, shots.after, quad)}`);
            if (shots.control) console.log(`[${TAG}] control ${lozengeDiff(shots.before, shots.control, quad)}`);
          }
        }
      }
    }
    if (errors.length) console.log(`[${TAG}] page errors: ${[...new Set(errors)].join(' | ')}`);
  } finally {
    await browser.close();
    stopDevServer(server, TAG);
  }
  process.exit(0);
}

void main();
