/**
 * The source stills for the cinematics storyboard, photographed through the
 * real game (docs/cinematics/README.md, docs/cinematics/storyboard.md).
 *
 *   pnpm stills:cinematics [-- --only=<id>[,<id>]] [--shots=<file>] [--out-dir=<dir>] [--port=<n>] [--gpu=metal|swiftshader]
 *
 * Each shot in `docs/cinematics/shots.json` carries a `capture` block -- a
 * shipped map (`?sandbox=<map>`), a light preset (`&tod=`), a camera tile and
 * a zoom -- and this script writes the shot's `still` from it: 1280x720 JPEG,
 * the size and aspect the video request sends.
 *
 * A still is TERRAIN AND ARCHITECTURE ONLY, by construction rather than by
 * framing: before the photograph the `units` layer is hidden (every unit body,
 * the sandbox force included, `ThreeRenderer.unitsDebugHidden`), so are
 * `overlays` (rings, bars), `missiles` and `blast-light` (a round or a muzzle
 * light the sandbox force's first ticks threw: a survey frame caught a
 * streak) and `fog` (`uRevealAll`, so the frame is not the force's sight), and every DOM element but the canvas is hidden. The approved
 * scope is people-free footage with no real units or insignia, and an input
 * image with nobody in it is the cheapest way to get an output with nobody in
 * it.
 *
 * One browser, sequential pages, Metal by default on macOS (`ui-review/gpu.ts`),
 * music off (`musicOffInitScript`), its own dev server on its own port
 * (default 5197, refused if busy by `claimPort`; never 5177, the lead's).
 * The frame loop is frozen and every repaint is the script's own, at a fixed
 * tick, so a re-run frames the same picture (bar the GPU backend, which is
 * printed and recorded beside the stills).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { ensureDevServer, stopDevServer } from '../golden-diff/browser';
import { FREEZE_FRAME_LOOP_SCRIPT, PARK_POINTER_STATEMENTS } from '../golden-diff/capture-protocol';
import { claimGpuBackend, gpuLaunchArgs } from '../ui-review/gpu';
import { musicOffInitScript } from '../ui-review/music-off';
import { claimPort } from '../ui-review/port';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const TAG = 'cinematic-stills';
const VIEWPORT = { width: 1280, height: 720 } as const;
/** Paced frames after boot, so building and decor GLBs land before the shot. */
const LOAD_SETTLE_MS = 6000;

interface Capture {
  readonly sandbox: string;
  readonly tod: 'dawn' | 'day' | 'dusk' | 'night';
  readonly at: readonly [number, number];
  readonly zoom: number;
}
interface ShotIn {
  readonly id: string;
  readonly still: string;
  readonly capture?: Capture;
}

const arg = (name: string): string | undefined =>
  process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const shotsFile = path.resolve(REPO_ROOT, arg('shots') ?? 'docs/cinematics/shots.json');
const outDir = arg('out-dir');
const only = arg('only')?.split(',');
const shots = (JSON.parse(fs.readFileSync(shotsFile, 'utf8')) as { shots: ShotIn[] }).shots.filter(
  (s) => s.capture !== undefined && (only === undefined || only.includes(s.id))
);
if (shots.length === 0) {
  console.error(`[${TAG}] no shot with a capture block matched${only ? ` --only=${only.join(',')}` : ''}`);
  process.exit(2);
}

const gpu = claimGpuBackend(TAG);
const port = await claimPort(TAG, 'CINEMATIC_STILLS_PORT', 5197);
const devServer = await ensureDevServer(port, REPO_ROOT, TAG);
const browser = await chromium.launch({ headless: true, args: gpuLaunchArgs(gpu) });
let failed = 0;
try {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await page.addInitScript(musicOffInitScript());
  page.setDefaultTimeout(60_000);
  const renderer = { reported: false };
  for (const shot of shots) {
    const c = shot.capture as Capture;
    const out = outDir ? path.resolve(outDir, path.basename(shot.still)) : path.resolve(REPO_ROOT, shot.still);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    try {
      await page.goto(`http://localhost:${port}/?sandbox=${c.sandbox}&tod=${c.tod}`, { waitUntil: 'load' });
      await page.waitForFunction(() => typeof (window as unknown as { __lions?: unknown }).__lions !== 'undefined');
      if (!renderer.reported) {
        const gl = await page.evaluate(() => {
          const g = document.createElement('canvas').getContext('webgl2');
          const ext = g?.getExtension('WEBGL_debug_renderer_info');
          return ext && g ? String(g.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
        });
        console.log(`[${TAG}] --gpu=${gpu}; the browser reports ${gl}`);
        renderer.reported = true;
      }
      // Off the play area, before the loop freezes: with the pointer left at
      // Playwright's default the frame carried a soft orange glow at one fixed
      // SCREEN spot on every map, which no draw layer hid; moving the pointer
      // away removed it (measured on marj_perimeter, 2026-10-11).
      await page.mouse.move(VIEWPORT.width - 10, 60);
      await page.evaluate(FREEZE_FRAME_LOOP_SCRIPT);
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(
        `(async () => {
          const L = window.__lions, r = L.renderer;
          ${PARK_POINTER_STATEMENTS}
          for (const layer of ['units', 'overlays', 'fog', 'missiles', 'blast-light']) r.setDebugLayerVisible(layer, false);
          r.camera.x = ${c.at[0]}; r.camera.y = ${c.at[1]}; r.camera.zoom = ${c.zoom};
          const until = performance.now() + ${LOAD_SETTLE_MS};
          while (performance.now() < until) { r.frame(1, 100); await new Promise((s) => setTimeout(s, 100)); }
          // The FX and smoke bands (units/render-order.ts: 1.5 badge, 2-3.5 FX, 4 overlays, 5-5.5
          // smoke, 6 silhouette) have no debug layer of their own, and two things in them
          // survived every layer above: a pooled glow at one spot and a
          // streak over the town. A still is the ground and the buildings, so
          // both bands go, through the private scene (a capture tool, not a
          // gate; nothing here claims a layer draws or does not).
          r.scene.traverse((o) => { if ([1.5, 2, 2.5, 3, 3.5, 4, 5, 5.5, 6].includes(o.renderOrder)) o.visible = false; });
          r.frame(1, 0);
          const canvas = document.querySelector('canvas');
          let node = canvas;
          while (node && node !== document.body) {
            for (const sib of Array.from(node.parentElement ? node.parentElement.children : [])) {
              if (sib !== node) sib.style.visibility = 'hidden';
            }
            node = node.parentElement;
          }
        })()`
      );
      await page.screenshot({ path: out, type: 'jpeg', quality: 85 });
      console.log(`[${TAG}] ${shot.id}: ${path.relative(REPO_ROOT, out)} (${(fs.statSync(out).size / 1024).toFixed(0)} KiB) ` +
        `${c.sandbox} ${c.tod} at ${c.at.join(',')} zoom ${c.zoom}`);
    } catch (e) {
      failed++;
      console.error(`[${TAG}] ${shot.id}: FAILED -- ${(e as Error).message}`);
    }
  }
} finally {
  await browser.close();
  stopDevServer(devServer, TAG);
}
process.exit(failed > 0 ? 1 : 0);
