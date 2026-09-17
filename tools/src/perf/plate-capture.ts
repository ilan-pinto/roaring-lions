/**
 * The menu's key-art plate: one still, photographed from the running game
 * through its own camera, sun and tone-mapping, rather than painted by a
 * generator.
 *
 *   pnpm plate:capture
 *
 * Replaces the menu's previous banner (task 10 of
 * `.superpowers/sdd/2026-09-16-shell-upgrade-phase-0/`), a generated painting
 * that carried a generator watermark, a real M1 Abrams marked 41, and
 * pseudo-Arabic signage -- none of which belongs on a menu for a game that
 * makes no claim to be a real army. The plate is re-takeable by construction
 * (this script), so it is re-shot whenever the world it stands in improves,
 * rather than repainted by hand.
 *
 * Manages its own dev server the way `ui-review/shoot.ts` does -- never a
 * human's `pnpm dev`, never a port another tool already owns (see that
 * file's own comment: 5173 human, 5174 golden-diff, 5175 three-baseline,
 * 5176 ui-review; this one takes 5177) -- and launches Chromium the way
 * `perf/wreck-captures.ts` does: software SwiftShader, for a reproducible
 * capture rather than a fast one (`golden-diff/browser.ts`'s
 * `launchCaptureBrowser` makes the same choice for the same reason).
 *
 * Subject: the sandbox force's own `mbt_lavi` on `beit_sahwan_outskirts`
 * (`?sandbox=beit_sahwan_outskirts`, no flags -- `SANDBOX_KDF` in
 * `sandbox-force.ts` fields two tanks and three infantry squads with no
 * `&sur`/`&civ`/`&tunnel` needed, so both the vehicle and an infantry squad
 * are in frame for free). `units(0).find(u => u.type === 'mbt_lavi')` picks
 * the first of the two; if the roster ever loses the type entirely the
 * script throws, naming every type actually present, rather than silently
 * framing empty ground.
 *
 * Camera: `(tank.x + CAMERA_X_OFFSET, tank.y)` at zoom 1.6, after `step(40)`
 * (2s of sim time at the fixed 20Hz tick) so spawn dust has settled.
 * `lighting.ts`'s `SUN_DIRECTION` lights the camera's LEFT flank (CLAUDE.md,
 * "The colour pipeline").
 *
 * CAMERA_X_OFFSET is 17, not the task brief's placeholder 1.2 -- measured,
 * not guessed, after the first look this file's own task brief asks for.
 * `kdf_assembly` (the sandbox force's anchor, `data/maps/
 * beit_sahwan_outskirts.json`'s own marker) sits at world (4, 23), four
 * tiles from the map's west edge (x=0); at offset 1.2 the camera (x=5.2) is
 * still well inside the zoom-1.6 view of that edge, and the void beyond it
 * (Task 9's ground skirt, a differently-textured, unlit plane -- see
 * CLAUDE.md's "The ground is SMOOTH" and the vignette/skirt bullets) fills
 * roughly a third of the frame as a hard diagonal. Every whole tile of
 * CAMERA_X_OFFSET shifts the world ~51px left / ~26px up on screen at this
 * zoom (`TILE_W`/`TILE_H` in `packages/render/src/project.ts`, halved and
 * scaled by zoom), so clearing the edge costs far more than the "one tile"
 * the brief's fallback language suggests. 17 is the smallest offset found by
 * capturing at 6, 9, 12, 15, 16, 17 and 18 and reading each result: below it
 * a visible wedge of skirt remains in the top-left corner; above it
 * (18) the frame starts clipping `dozer_d9`/`heli_peten` at the left edge
 * for no further gain. At 17 the whole rostered force from `SANDBOX_KDF`
 * (both tanks, the IFV, the APC, three infantry squads, the AT/mortar pair,
 * the drone) is in frame with no edge, no crop.
 *
 * HUD: every element `document.body` holds that does not itself CONTAIN the
 * canvas gets `display: none`, never an app flag (CLAUDE.md, "Verify UI
 * features by driving the UI" -- a flag exercises a code path a player never
 * takes). This is deliberately NOT "every body child whose tagName is not
 * CANVAS": in this build the canvas is not a direct child of `<body>`, it is
 * nested one level down (`main.ts`: `document.getElementById('stage')` ->
 * `renderer.init(stage)` -> `host.appendChild(this.renderer.domElement)`),
 * while the HUD and minimap attach straight to `body` as ITS siblings (`new
 * Hud(document.body, ...)`'s `host.append(this.strip, this.cmd, this.clock,
 * this.sel, this.fire, this.banner)`; `new Minimap(document.body, ...)`).
 * Hiding by `tagName !== 'CANVAS'` would hide `#stage` -- and the canvas
 * inside it -- right along with the HUD. Hiding by containment
 * (`el.contains(canvas)`) keeps the brief's actual intent (every body child
 * that is not the drawing surface disappears) correct for the nesting this
 * build actually has.
 *
 * Freeze/repaint: `FREEZE_FRAME_LOOP_SCRIPT` (stop `main.ts`'s own rAF loop
 * so nothing repaints between the last `step()`/camera write and the
 * screenshot) and `REPAINT_SCRIPT` (one explicit zero-time repaint at the
 * FINAL camera position) are `golden-diff/capture-protocol.ts`'s, not
 * reimplemented -- that file's own comment has the measured 28% false-red
 * rate a hand-rolled version of this risked repeating.
 */
import { chromium, type Browser, type Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDevServer, stopDevServer } from '../golden-diff/browser';
import { FREEZE_FRAME_LOOP_SCRIPT, REPAINT_SCRIPT } from '../golden-diff/capture-protocol';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const TAG = 'plate-capture';
// Not the human dev-server convention (:5173) and not another tool's managed
// port (:5174 golden-diff, :5175 three-baseline, :5176 ui-review) -- this
// script starts and stops its own, so it needs a port nothing else claims.
const PORT = 5177;
const MAP_ID = 'beit_sahwan_outskirts';
const OUT_FILE = path.resolve(REPO_ROOT, 'assets/ui/menu_plate.jpg');
// 2560x1440, the banner's page-native capture size. See this file's own top
// comment for the measurement behind it.
const CAMERA_X_OFFSET = 17;
const VIEWPORT = { width: 2560, height: 1440 } as const;
// The 2360x1000 clip is the banner's own 2.36:1 ratio. NOT centred in the
// viewport (100px/220px margins on every side, the original guess) -- at
// CAMERA_X_OFFSET's zoom-1.6 framing the whole task force sits left-of-centre
// (clearing the map edge costs screen-left real estate; see the camera
// comment above), so the clip is pushed to the viewport's own left (x=0) and
// top (y=100, leaving 340px below rather than 220px above/below) to keep
// every rostered unit in frame rather than centring on empty sand and the
// town beyond it. Still inside Task 9's post-tonemap vignette, which darkens
// the frame's corners rather than its flat centre.
const CLIP = { x: 0, y: 100, width: 2360, height: 1000 } as const;

interface LionsWindow {
  __lions: {
    step(n: number): number;
    units(side?: number): { id: number; type: string; x: number; y: number }[];
    renderer: { camera: { x: number; y: number; zoom: number } };
  };
}

async function setCamera(page: Page, x: number, y: number, zoom: number): Promise<void> {
  await page.evaluate(
    ([cx, cy, cz]) => {
      const c = (window as unknown as LionsWindow).__lions.renderer.camera;
      c.x = cx;
      c.y = cy;
      c.zoom = cz;
    },
    [x, y, zoom]
  );
}

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });

const BASE = `http://localhost:${PORT}`;
const devServer = await ensureDevServer(PORT, REPO_ROOT, TAG);
let browser: Browser | null = null;
try {
  browser = await chromium.launch({
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const page: Page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  page.setDefaultTimeout(30000);

  console.log(`[${TAG}] booting ?sandbox=${MAP_ID} at ${VIEWPORT.width}x${VIEWPORT.height}`);
  await page.goto(`${BASE}/?sandbox=${MAP_ID}`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window as unknown as LionsWindow).__lions?.renderer, null, {
    timeout: 30000,
  });

  // Fonts, plus time for the roster-driven mesh loader's GLB fetches --
  // `mbt_lavi` is in `SANDBOX_KDF`, so it is queued from the very first
  // frame (unlike `wreck-captures.ts`'s two unrostered types, this needs no
  // wait for the 1Hz unrostered-type sweep, only the network round trip).
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(3000);

  // Freeze the app's own rAF loop before anything else touches the page, so
  // nothing can repaint between our own step()/camera writes below and the
  // final screenshot -- see this file's own top comment.
  await page.evaluate(FREEZE_FRAME_LOOP_SCRIPT);

  // Hide the HUD by containment, not by tagName -- see top comment for why.
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    for (const el of Array.from(document.body.children)) {
      if (canvas && el.contains(canvas)) continue;
      (el as HTMLElement).style.display = 'none';
    }
  });

  const units = await page.evaluate(() => (window as unknown as LionsWindow).__lions.units(0));
  const tank = units.find((u) => u.type === 'mbt_lavi');
  if (!tank) {
    const present = [...new Set(units.map((u) => u.type))].join(', ') || '(no side-0 units at all)';
    throw new Error(`no mbt_lavi in the sandbox force on ${MAP_ID} -- types present: ${present}`);
  }
  console.log(`[${TAG}] mbt_lavi #${tank.id} at (${tank.x}, ${tank.y})`);

  // 40 ticks = 2s of sim time at the fixed 20Hz tick, so spawn dust settles
  // before the shot.
  await page.evaluate(() => (window as unknown as LionsWindow).__lions.step(40));

  await setCamera(page, tank.x + CAMERA_X_OFFSET, tank.y, 1.6);

  // One explicit zero-time repaint at the FINAL camera position -- the
  // picture step() painted a moment ago was at the OLD (boot) camera, not
  // this one.
  await page.evaluate(REPAINT_SCRIPT);

  await page.screenshot({ path: OUT_FILE, type: 'jpeg', quality: 86, clip: CLIP });
  console.log(`[${TAG}] saved ${OUT_FILE}`);
} finally {
  if (browser) await browser.close();
  stopDevServer(devServer, TAG);
}
