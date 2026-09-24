/**
 * The menu's plate, photographed from the scene host itself.
 *
 *   pnpm plate:host [-- --port=<n>]
 *
 * Replaces `tools/src/perf/plate-capture.ts` and its output
 * `assets/ui/menu_plate.jpg` (scene-host plan Task 7, spec Q1). That script
 * booted a standalone `?sandbox=` mission, hand-picked a camera position
 * clear of the map's void and the fog-of-war boundary, and hoped the result
 * looked like the menu -- because at the time nothing stood behind the menu
 * to compare it against. Now the scene host (`ui/scene-host.ts`) draws a real
 * diorama (`data/front/menu_diorama.json`, via `front/diorama.ts`) behind the
 * menu column on every visit, so the plate and the live frame can be made the
 * SAME picture instead of two independently-tuned ones: this script opens the
 * real menu, waits for the real host to go live, strips the parallax bleed
 * and the menu column, and photographs exactly what a player's first frame
 * would have been. Re-staging the diorama (a camera, a unit roster, a map) in
 * `menu_diorama.json` is re-photographed by running this one command again --
 * no camera hunting, no void to avoid, no separate tuning pass.
 *
 * Manages its own dev server through `claimPort` (`ui-review/port.ts`) before
 * `ensureDevServer`, the way `ui-review/shoot.ts` and `ui-review/routes-check
 * .ts` do: `ensureDevServer` REUSES whatever already answers on a port, which
 * is correct for a shared CI server and wrong here, where an attached server
 * could silently be serving a different checkout. `claimPort` refuses a busy
 * port instead of sharing it. Default port 5183 -- the next free number after
 * this repo's other self-managed captures (5173 human, 5174 golden-diff, 5175
 * three-baseline, 5176 ui:shots, 5177 ui:routes, 5178 wreck-captures, 5179
 * death-captures/unit-plates, 5181 blast-captures, 5182 weight-captures).
 *
 * Launches Chromium via `golden-diff/browser.ts`'s `launchCaptureBrowser`: no
 * GL arguments, so WebGL renders through SwiftShader, a pure-CPU rasterizer
 * that reproduces itself exactly -- see that function's own comment for the
 * measured cost of the alternative (a hardware backend the plate would then
 * depend on). The door takes on the order of 5s to settle a WebGL2 context
 * under SwiftShader; the wait below is 60s to leave headroom.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDevServer, launchCaptureBrowser, stopDevServer } from '../golden-diff/browser';
import { FREEZE_FRAME_LOOP_STATEMENTS } from '../golden-diff/capture-protocol';
import { claimPort } from '../ui-review/port';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const TAG = 'plate-host';
const OUT_FILE = path.resolve(REPO_ROOT, 'assets/ui/menu_host_plate.jpg');
// The plate's own framing (spec M18: 2560x1440 JPEG q80 ~429 KiB); no clip,
// the host fills the whole viewport once the menu column is hidden.
const VIEWPORT = { width: 2560, height: 1440 } as const;
// Spec's own load-deadline table (M5-M8): 1.0-1.9s local, 4.2-4.6s at
// 20Mbit/s, 1.3-1.7s on SwiftShader. 60s leaves headroom over all of them and
// over the model's own HOST_DEADLINE_MS (15s) that would otherwise fall back
// to the plate mid-capture.
const HOST_WAIT_MS = 60000;

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });

const port = await claimPort(TAG, 'PLATE_HOST_PORT', 5183);
const BASE = `http://localhost:${port}`;
const devServer = await ensureDevServer(port, REPO_ROOT, TAG);
let browser: Awaited<ReturnType<typeof launchCaptureBrowser>> | null = null;
try {
  browser = await launchCaptureBrowser();
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  page.setDefaultTimeout(HOST_WAIT_MS);

  console.log(`[${TAG}] booting / at ${VIEWPORT.width}x${VIEWPORT.height}`);
  await page.goto(`${BASE}/`, { waitUntil: 'load' });

  // `data-host` starts at `pending` and never returns to it (scene-host.ts's
  // own state machine); wait for it to leave that state, then insist on
  // `live` -- a capture that itself fell back to the plate would photograph
  // the very poster this script exists to replace.
  await page.waitForFunction(() => {
    const el = document.querySelector('.rl-scene-host');
    return el !== null && el.getAttribute('data-host') !== 'pending';
  });
  const reached = await page.evaluate(() => {
    const el = document.querySelector('.rl-scene-host');
    return { host: el?.getAttribute('data-host') ?? null, reason: el?.getAttribute('data-host-reason') ?? null };
  });
  if (reached.host !== 'live') {
    throw new Error(
      `[${TAG}] scene host did not go live -- data-host="${reached.host}", data-host-reason="${reached.reason}"`
    );
  }
  console.log(`[${TAG}] scene host is live`);

  // The parallax layer is oversized by --host-bleed on every side
  // (theme.css); zeroing it for the capture removes that overshoot from the
  // photograph. The layer shrinking is a resize the host's own observer
  // reacts to -- the door redraws and reports a new data-host-zoom through
  // onCamera -- so wait for that value to actually change rather than
  // assuming the redraw finished by the time this evaluate returns.
  const zoomBefore = await page.evaluate(
    () => document.querySelector('.rl-scene-host')?.getAttribute('data-host-zoom') ?? null
  );
  await page.evaluate(() => {
    (document.querySelector('.rl-scene-host') as HTMLElement).style.setProperty('--host-bleed', '0rem');
  });
  await page.waitForFunction(
    (before) => document.querySelector('.rl-scene-host')?.getAttribute('data-host-zoom') !== before,
    zoomBefore
  );
  const zoomAfter = await page.evaluate(() =>
    document.querySelector('.rl-scene-host')?.getAttribute('data-host-zoom')
  );
  console.log(`[${TAG}] --host-bleed: 0rem; data-host-zoom ${zoomBefore} -> ${zoomAfter}`);

  // The plate is the diorama alone -- no menu chrome baked in.
  await page.evaluate(() => {
    const menu = document.querySelector('.rl-menu') as HTMLElement | null;
    if (menu) menu.style.display = 'none';
  });

  // Freeze the app's own rAF loop before the screenshot, so nothing repaints
  // mid-capture. FREEZE_FRAME_LOOP_STATEMENTS, never _SCRIPT: the SCRIPT
  // variant's return statement reads `window.__lions.sim.tickCount`, and the
  // menu route never assigns `window.__lions` at all (`ui:routes` asserts
  // exactly that) -- so on this route the SCRIPT form throws. This runs the
  // same statements inside their own async IIFE instead, with no such read.
  await page.evaluate(`(async () => {\n${FREEZE_FRAME_LOOP_STATEMENTS}\n})()`);

  const hostMs = await page.evaluate(() => document.querySelector('.rl-scene-host')?.getAttribute('data-host-ms') ?? null);

  await page.screenshot({ path: OUT_FILE, type: 'jpeg', quality: 80, fullPage: false });
  const { size } = fs.statSync(OUT_FILE);
  console.log(`[${TAG}] saved ${OUT_FILE} (${(size / 1024).toFixed(1)} KiB); data-host-ms=${hostMs}`);
} finally {
  if (browser) await browser.close();
  stopDevServer(devServer, TAG);
}
