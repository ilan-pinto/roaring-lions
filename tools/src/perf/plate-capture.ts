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
 * `&sur`/`&civ`/`&tunnel` needed). `units(0).find(u => u.type ===
 * 'mbt_lavi')` picks the first of the two, only to confirm the roster and
 * anchor a settle wait; the CAMERA below is NOT centred on it directly (see
 * "Camera" below for why) -- if the type ever disappears from the roster the
 * script throws, naming every type actually present, rather than silently
 * framing empty ground.
 *
 * Camera: a fixed `(24, 24)` at zoom 1.3, not a formula off the tank's own
 * position -- see "Camera, measured" below for why a fixed point replaced
 * the offset-from-subject approach an earlier version of this file used.
 * `lighting.ts`'s `SUN_DIRECTION` lights the camera's LEFT flank (CLAUDE.md,
 * "The colour pipeline").
 *
 * ## Overlays and the occlusion silhouette
 *
 * Every unit/structure overlay (HP bars, suppression bars, selection/threat
 * rings, control-group badges, the veterancy chevron) AND the occlusion
 * silhouette (a unit's team-coloured outline, visible through whatever is
 * standing in front of it -- `units/silhouette.ts`) are hidden via
 * `__lions.renderer.setDebugLayerVisible('overlays', false)`
 * (`packages/render/src/three/debug-layers.ts`) before anything else touches
 * the page. Both are in-canvas render objects, not DOM, so the HUD-hide
 * below (which only ever touches `document.body`) never reached them. The
 * silhouette half was found the hard way: an early capture near the map's
 * civic-hall structure showed a thin red outline poking through its wall --
 * a HOSTILE unit standing behind it, revealed by the sandbox force's own
 * recon drone and rendered as a "the enemy is behind that wall" hint. Real
 * gameplay information, and exactly as unwelcome in key art as a health bar
 * -- see `debug-layers.ts`'s own comment for the mechanism (three shared
 * `MeshBasicMaterial`s, one per side, toggled by `.visible`, not a scene
 * traversal).
 *
 * ## Camera, measured
 *
 * `kdf_assembly` (the sandbox force's anchor, `data/maps/
 * beit_sahwan_outskirts.json`'s own marker) sits at world (4, 23), four
 * tiles from the map's west edge (x=0) -- close enough that an
 * offset-from-the-tank camera (this file's first version: `camera.x =
 * tank.x + 17, camera.y = tank.y, zoom 1.6`) cleared the west edge only by
 * pushing the whole force to the left third of frame. The coordinator's
 * follow-up asked for zoom 1.3 and a camera "between the force and the
 * outpost" with NO off-map ground anywhere in the clip, which turned out to
 * be a much tighter constraint than the west edge alone: at zoom 1.3 the
 * map's NORTH edge (y=0) and SOUTH edge (y=47) are both close enough to
 * intrude too, and which one shows depends on `camera.y` in a way that
 * fighting the west edge (via `camera.x`) does not fix for free. Camera
 * positions tried and read by full-frame pixel classification (`skirt` void
 * is low-luminance AND low colour-saturation; lit sand, shadowed sand and
 * building shadow all keep enough red-over-blue spread to tell apart even
 * when dark) before landing here: (12.5,19.5) -- both north and west edges
 * show; (16,26)/(19,28) -- west edge shrinks, north edge lingers as a
 * sliver; (22,30)/(24,27)/(28,26) -- west and north clear, but far enough
 * south to expose the SOUTH edge in the bottom-left instead; (28,24) --
 * clean on all four edges but only within a ~2200px-wide window, short of
 * the original banner's 2360; (20,24) -- excellent force+outpost framing,
 * but the achievable void-free width shrinks further once the required
 * window is pushed left to include the force. (24,24) -- adopted: zoom 1.3,
 * camera.y at the map's own vertical centre (48-tall map, y=24) rather than
 * matched to any one unit, camera.x roughly midway between the force
 * (world x~2-8) and the civic-hall structure near the KDF outpost (world
 * x~20-22) -- clears all four edges within a verified window and keeps the
 * whole `SANDBOX_KDF` roster in frame.
 *
 * ## Clip
 *
 * `{x:150, y:250, width:2200, height:900}` -- NOT the original
 * `2360x1000` (2.36:1, the old banner's own ratio): every camera position
 * measured above tops out at roughly 2000-2280px of simultaneously
 * void-free width, never the full 2360, because the map's four edges box in
 * the force's own neighbourhood at zoom 1.3 more tightly than the banner's
 * exact aspect ratio leaves room for. 2200x900 (2.44:1, close to the
 * original) is the verified rectangle: every one of its four corners AND a
 * grid over its top-right quadrant -- the specific region a north-edge
 * intrusion would land in -- sampled as lit sand, shadowed sand, a road, or
 * a building, never the skirt's flat low-saturation grey (see the report's
 * own recorded samples for the exact values). `menu.ts`'s intrinsic
 * `width`/`height` hints are updated to match; the CSS itself
 * (`width:100%; height:auto`) does not care what the ratio is.
 *
 * Freeze/repaint: `FREEZE_FRAME_LOOP_SCRIPT` (stop `main.ts`'s own rAF loop
 * so nothing repaints between the last `step()`/camera write and the
 * screenshot) and `REPAINT_SCRIPT` (one explicit zero-time repaint at the
 * FINAL camera position) are `golden-diff/capture-protocol.ts`'s, not
 * reimplemented -- that file's own comment has the measured 28% false-red
 * rate a hand-rolled version of this risked repeating. The overlays toggle
 * runs before the freeze: it is a one-time `.visible` flip with nothing to
 * race (see its own comment above), so there is no ordering hazard, and it
 * keeps every "make the scene look right" step together, ahead of the "now
 * hold it still" step.
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
// 2560x1440, the banner's page-native capture size.
const VIEWPORT = { width: 2560, height: 1440 } as const;
// See this file's own top comment ("Camera, measured") for the values below
// and the measurement behind them.
const CAMERA = { x: 24, y: 24, zoom: 1.3 } as const;
// See this file's own top comment ("Clip") for why this is not the original
// banner's 2360x1000.
const CLIP = { x: 150, y: 250, width: 2200, height: 900 } as const;

interface LionsWindow {
  __lions: {
    step(n: number): number;
    units(side?: number): { id: number; type: string; x: number; y: number }[];
    renderer: {
      camera: { x: number; y: number; zoom: number };
      setDebugLayerVisible(name: string, visible: boolean): number;
    };
  };
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

  // Hide every unit/structure overlay AND the occlusion silhouette -- see
  // this file's own top comment ("Overlays and the occlusion silhouette").
  await page.evaluate(() => (window as unknown as LionsWindow).__lions.renderer.setDebugLayerVisible('overlays', false));

  // Freeze the app's own rAF loop before the HUD hide/camera work below, so
  // nothing can repaint between our own step()/camera writes and the final
  // screenshot. The overlays toggle above deliberately runs BEFORE this --
  // see this file's own top comment ("Freeze/repaint") for why there is no
  // ordering hazard in that.
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
  console.log(`[${TAG}] mbt_lavi #${tank.id} at (${tank.x}, ${tank.y}) -- camera is fixed, not offset from this`);

  // 40 ticks = 2s of sim time at the fixed 20Hz tick, so spawn dust settles
  // before the shot.
  await page.evaluate(() => (window as unknown as LionsWindow).__lions.step(40));

  await page.evaluate(
    ([cx, cy, cz]) => {
      const c = (window as unknown as LionsWindow).__lions.renderer.camera;
      c.x = cx;
      c.y = cy;
      c.zoom = cz;
    },
    [CAMERA.x, CAMERA.y, CAMERA.zoom]
  );

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
