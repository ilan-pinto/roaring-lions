// Wadi Halam look, layer 1 (Lane B, 25 Oct): backdrop before/after mocks. PROTOTYPE tool.
// ONE browser, its own dev server on --port, music off, Metal, frame loop frozen, HUD hidden.
// "before" and "after" come from the SAME page by toggling the `backdrop` debug layer
// (off = today's flat skirt + never-seen off-map fog; on = the valley backdrop).
//
//   npx tsx src/wadi-look/capture.ts --port=5188 --out=<dir> [--maps=a,b] [--tods=day,dusk] [--zooms=0.35,1,2.5] [--fog=on|off]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';
import { ensureDevServer, readUnmaskedRenderer, stopDevServer } from '../golden-diff/browser';
import { CAPTURE_VIEWPORT, FREEZE_FRAME_LOOP_SCRIPT, hideHudExceptCanvas } from '../golden-diff/capture-protocol';
import { gpuLaunchArgs } from '../ui-review/gpu';
import { musicOffInitScript } from '../ui-review/music-off';
import { claimPort } from '../ui-review/port';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const TAG = 'wadi-look';
const flag = (name: string, d: string): string => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? d;
const out = path.resolve(flag('out', '.superpowers/wadi-look'));
const maps = flag('maps', 'wadi_halam_4,wadi_halam_basin').split(',');
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
];
const viewNames = flag('views', '').split(',').filter(Boolean);
const zoomOnly = flag('zooms', '').split(',').filter(Boolean).map(Number);
const VIEWS = ALL_VIEWS.filter((v) => (viewNames.length === 0 || viewNames.includes(`${v.name}@${v.zoom}`)) && (zoomOnly.length === 0 || zoomOnly.includes(v.zoom)));
const fogMode = flag('fog', 'on');
const only = flag('only', ''); // 'after' to skip the before shots

interface Lions {
  __lions: {
    goto(x: number, y: number): unknown;
    sim: { width: number; height: number };
    renderer: {
      readonly canvas: HTMLCanvasElement;
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
  await page.evaluate(FREEZE_FRAME_LOOP_SCRIPT);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(3000);
  await page.evaluate(hideHudExceptCanvas);
  const actual = new URL(page.url()).port;
  if (actual !== String(port)) throw new Error(`browser on :${actual}, asked for :${port}`);
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
          for (const state of ['before', 'after']) {
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
