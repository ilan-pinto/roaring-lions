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
 * ## History: three follow-ups, all from looking at the actual plate
 *
 * v1 framed the sandbox force where it SPAWNS, near `kdf_assembly` (world
 * (4, 23), four tiles from the map's west edge) -- and fighting the map's
 * edges from there, at whatever camera position, kept costing something:
 * either a visible skirt wedge, or the force pushed to a corner of frame, or
 * (once zoom 1.3 was required) a width narrower than the old banner's. v2
 * hid the unit/structure overlays and the occlusion silhouette. v3 stopped
 * fighting the spawn position and MOVED the force instead: ordered to open
 * ground between the assembly area and the town, the same way
 * `golden-diff/baseline.ts`'s `RELIEF_SCENARIO` moves its recon drone with a
 * `queueCommand` -- see "Order and arrival" below. This also fixed a defect
 * the coordinator caught that no earlier version of this file even knew to
 * look for: the large dark diagonal every capture carried was not a shadow,
 * it was the fog-of-war boundary, and moving the camera around never could
 * have fixed that -- only hiding the fog pass could, which v3 did by
 * disabling it outright.
 *
 * v4 (this version, C2 of the shell-upgrade Phase 0 final review) undid
 * that last part. Disabling the WHOLE fog pass to remove the fog-of-war
 * boundary also disabled `FOG_OFFMAP_FADE_TILES`, the off-map fade the SAME
 * pass carries -- so the shipped plate's off-map ground read back
 * unshrouded, a pale, texture-poor wedge with a dead-straight diagonal edge
 * at the map border, the exact defect class this whole file exists to
 * abolish, just relocated. `setDebugLayerVisible('fog', false)` now leaves
 * the pass enabled and reveals every ON-map sample instead (`uRevealAll`,
 * `fog-pass.ts`), so the fog-of-war boundary still disappears and the
 * off-map fade still darkens the skirt toward never-seen, exactly as it
 * does in a real mission.
 *
 * ## Order and arrival
 *
 * Every side-0 unit (`__lions.units(0)`, not just the Lavi) is sent, as one
 * group `move`, to a point WEST_OF_TOWN_CENTER tiles west and
 * SOUTH_OF_TOWN_CENTER tiles south of the `town_center` marker (21 west, 4
 * south today -- NOT the coordinator's own suggested "8 west, same y"; see
 * those constants' own comment for the two independent, partly conflicting
 * measurements that moved both numbers). `capture-protocol.ts`'s own comment
 * on `Scenario.orders` has the `queueCommand` shape this borrows: `{ kind:
 * 'move', ids, x, y }`, `x`/`y` in Q16.16 (`Math.round(tile * 65536)`, never
 * a raw tile number -- invariant 2). `town_center`'s own tile comes from
 * `__lions.goto('town_center')`, which both returns the marker's `[x, y]`
 * and (harmlessly, since the camera below is set explicitly afterward)
 * recentres the camera there -- reading the map's marker live rather than
 * hardcoding the map's current (31, 22), so a future map edit does not
 * silently point this script at the wrong tile.
 *
 * Since 2026-09-15 a group order lands in FORMATION
 * (`packages/sim/src/formation.ts`), not stacked on one tile, so "arrived"
 * is checked against the one unit the brief names -- `mbt_lavi`, re-found by
 * id after each step chunk -- within 2 tiles of the goal, not exact
 * equality. Stepped in 30-tick (1.5s) chunks up to a 600-tick cap; if the
 * Lavi is still more than 2 tiles out when the cap is reached, the script
 * throws rather than framing wherever the force happened to stop (a silent
 * partial arrival would be a worse failure than a loud one -- the same
 * reasoning as the missing-`mbt_lavi` check below). One more `SETTLE_TICKS`
 * (150) runs after the Lavi arrives: the CAMERA below frames the whole
 * force's CENTROID, not the Lavi alone, and formation stragglers left that
 * centroid measured 3-4 tiles short of the target at the instant the Lavi
 * itself crossed the arrival threshold.
 *
 * ## Overlays, the occlusion silhouette, and fog
 *
 * `__lions.renderer.setDebugLayerVisible('overlays', false)`
 * (`packages/render/src/three/debug-layers.ts`) hides every unit/structure
 * overlay (HP bars, suppression bars, selection/threat rings, control-group
 * badges, the veterancy chevron) AND the occlusion silhouette (a unit's
 * team-coloured outline, visible through whatever is standing in front of
 * it -- `units/silhouette.ts`) -- found the hard way in the first follow-up:
 * a capture near the map's civic-hall structure showed a thin red outline
 * poking through its wall, which turned out to be a HOSTILE unit standing
 * behind it, revealed by the sandbox force's own recon drone, not a HUD
 * element. `setDebugLayerVisible('fog', false)` removes the SECOND thing the
 * coordinator caught: the fog-of-war post pass (`FogOfWarPass`, band-dimming
 * never-seen ground to 85% shroud and explored ground to 40%), which a
 * camera anywhere near the edge of what the force can see paints as a hard
 * diagonal that reads as a shadow until you look for what casts it and find
 * nothing. As of v4 this no longer disables the pass -- it reveals every
 * ON-map sample instead (`uRevealAll`, `fog-pass.ts`) so the pass's own
 * off-map fade keeps running; see this file's own History section for why
 * disabling the pass outright shipped a different first-minute defect in
 * its place. Both calls run AFTER the arrival step-loop's last `step()` and
 * BEFORE the freeze + single repaint, per the coordinator's own ordering --
 * both are one-time flag flips (a batch's `endFrame()` never touches
 * `.visible`; neither `Pass`'s `enabled` nor `FogOfWarPass`'s `uRevealAll`
 * uniform is ever reasserted per frame, see `debug-layers.ts`'s own comments
 * for the greps that confirm it), so there is nothing to race by running
 * them before the freeze rather than after.
 *
 * ## Camera and clip
 *
 * Camera: the force's own centroid (mean `x`/`y` over `__lions.units(0)`,
 * read AFTER arrival AND the settle above, not the spawn-time positions) at
 * zoom 1.4 -- the coordinator's replacement for hunting a camera position
 * near the map's edges, now that the force stands on open ground with the
 * town in view instead. That replacement is not quite as clean as it
 * sounds, though, and the "Order and arrival" measurements above are why:
 * the force's spawn point is close enough to the map's west edge that even
 * ground it can safely march to (outside the nearest `SANDBOX_ENEMY` unit's
 * engagement) still needed a specific, measured (x, y), not merely "some
 * open ground" -- the edge does not vanish just because the force moved,
 * it just moves the fight from "which camera offset" to "which order
 * target". Clip: 2200x900 (this file's own v2 measurement of the largest
 * window the old banner's ratio could get within reach of), centred in the
 * 2560x1440 viewport this time (`x=180, y=270`), which the chosen order
 * target keeps clean on all four sides -- verified the same way v2's clip
 * was, by cropping and sampling the corners and a grid over the quadrant
 * likeliest to catch a regression, recorded in the task report.
 *
 * Freeze/repaint: `FREEZE_FRAME_LOOP_SCRIPT` (stop `main.ts`'s own rAF loop
 * so nothing repaints between the last `step()`/camera write and the
 * screenshot) and `REPAINT_SCRIPT` (one explicit zero-time repaint at the
 * FINAL camera position) are `golden-diff/capture-protocol.ts`'s, not
 * reimplemented -- that file's own comment has the measured 28% false-red
 * rate a hand-rolled version of this risked repeating.
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
const ZOOM = 1.4;
// See this file's own top comment ("Camera and clip") for why 2200x900 and
// why centred this time.
const CLIP = { x: (VIEWPORT.width - 2200) / 2, y: (VIEWPORT.height - 900) / 2, width: 2200, height: 900 } as const;
// Applied to the force's centroid AFTER it is measured, not part of the
// order target -- see the camera-setting code's own comment for why the
// combat-safe order and the void-clean camera are not quite the same point.
const CENTROID_X_NUDGE = 3;
// Offset from `town_center` the force is ordered to, in tiles -- NOT the
// coordinator's own suggested "8 west, same y". See this file's own top
// comment ("Order and arrival") for the two independent, and NOT quite
// reconcilable at a single point, constraints that moved both numbers, and
// `CENTROID_X_NUDGE` above for the third piece (the order target and the
// camera position are not the same point either).
//
// COMBAT: `sandboxAnchors` (`packages/app/src/sandbox-anchors.ts`, pinned by
// its own test for this map) puts the HOSTILE anchor exactly ON
// `town_center`, and `SANDBOX_ENEMY`'s closest entry (an `rpg_team`, offset
// (-12, -3) from it, `sight_tiles: 7`) sits only 12 tiles west of it -- an
// 8-tile order lands well inside its sight. What actually triggers a
// firefight did not reduce to a single static "stay outside this unit's
// sight/weapon range" formula: several targets measured 9-10 tiles from that
// `rpg_team` (by straight-line distance) came back combat-free, and others
// at a SIMILAR distance, in a different direction, came back with visible
// tracers, a muzzle flash and a dust burst in the capture. Terrain-dependent
// line of sight is the likely reason, but nothing here proves it. The one
// reliable reading, across every order actually tried, is that the Lavi's
// own ARRIVAL tile staying at x=9 (this file's original "8 west, same y"
// region, barely extended) was combat-free twice running, while every
// other arrival tried -- x=11, 12, 13 and 21, at two different y values --
// came back with a firefight. So x=9 is the value this script now aims the
// ORDER at, not a distance formula extrapolated from it.
//
// VOID: with the camera on the force's own centroid (not independently
// tuned, as the first two follow-ups' cameras were), x=9-ish at the same y
// as `town_center` (22) reopens the west-edge void this whole task keeps
// finding -- a centroid camera pins camera.y to the force's own y too, so
// there is no independent knob left to clear it the way earlier follow-ups
// did. Full-viewport probes (zoom 1.4, camera set directly, no orders
// issued, so cheap to sweep) found x=9-15 at y=26-28 clean on all four
// corners and both edges -- neither y=22 (too close to the west edge at
// this x) nor y=32+ (clears the NORTH edge but reopens the WEST one at the
// BOTTOM of frame, the same edge from a different diagonal) work, but 26-28
// threads both.
//
// The two clean regions (x=9 for the order, x=9-15 for the camera) DO
// overlap, but the force's own centroid sits measurably west of wherever
// the Lavi itself stops (formation stragglers -- see `SETTLE_TICKS`'s own
// comment), so ordering to the safe point alone still leaves the CAMERA
// west of the clean one. `CENTROID_X_NUDGE` is that gap, measured directly
// rather than folded into a second guess-and-check on the order itself.
const WEST_OF_TOWN_CENTER = 21;
const SOUTH_OF_TOWN_CENTER = 4;
// See "Order and arrival" above.
const ARRIVAL_TILES = 2;
const STEP_CHUNK = 30;
const STEP_CAP = 600;
// Extra settle after the Lavi arrives, so the rest of the formation (and the
// centroid the camera frames on) catches up too -- see this file's own top
// comment ("Order and arrival") for the measurement that made this
// necessary: the centroid landed 3-4 tiles short of the target at the
// moment the Lavi alone arrived.
const SETTLE_TICKS = 150;

interface LionsWindow {
  __lions: {
    step(n: number): number;
    units(side?: number): { id: number; type: string; x: number; y: number }[];
    goto(where: string | number, y?: number): [number, number] | null;
    sim: {
      queueCommand(c: { kind: string; ids: number[]; x: number; y: number }): void;
    };
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

  // Hide the HUD by containment, not by tagName -- see top comment for why.
  // Pure DOM, unrelated to sim timing, so it can run any time before the
  // final screenshot; doing it early keeps the "make the page look right"
  // steps together.
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    for (const el of Array.from(document.body.children)) {
      if (canvas && el.contains(canvas)) continue;
      (el as HTMLElement).style.display = 'none';
    }
  });

  const startUnits = await page.evaluate(() => (window as unknown as LionsWindow).__lions.units(0));
  const startTank = startUnits.find((u) => u.type === 'mbt_lavi');
  if (!startTank) {
    const present = [...new Set(startUnits.map((u) => u.type))].join(', ') || '(no side-0 units at all)';
    throw new Error(`no mbt_lavi in the sandbox force on ${MAP_ID} -- types present: ${present}`);
  }

  // Order: every side-0 unit, as one group, to a point west of town_center.
  // See "Order and arrival" above for why the marker is read live rather
  // than hardcoded.
  const townCenter = await page.evaluate(() => (window as unknown as LionsWindow).__lions.goto('town_center'));
  if (!townCenter) throw new Error(`map "${MAP_ID}" has no "town_center" marker`);
  const target = { x: townCenter[0] - WEST_OF_TOWN_CENTER, y: townCenter[1] + SOUTH_OF_TOWN_CENTER };
  console.log(`[${TAG}] town_center at (${townCenter[0]}, ${townCenter[1]}); ordering the force to (${target.x}, ${target.y})`);

  await page.evaluate(
    ([ids, tx, ty]) => {
      const FIXED = 65536;
      (window as unknown as LionsWindow).__lions.sim.queueCommand({
        kind: 'move',
        ids: ids as number[],
        x: Math.round((tx as number) * FIXED),
        y: Math.round((ty as number) * FIXED),
      });
    },
    [startUnits.map((u) => u.id), target.x, target.y]
  );

  // Step until the Lavi is within ARRIVAL_TILES of the goal, capped at
  // STEP_CAP ticks total -- fail loudly rather than frame wherever the
  // force happened to stop.
  let ticksStepped = 0;
  let arrived = false;
  let lastTankPos: { x: number; y: number } = { x: startTank.x, y: startTank.y };
  while (ticksStepped < STEP_CAP) {
    await page.evaluate((n) => (window as unknown as LionsWindow).__lions.step(n), STEP_CHUNK);
    ticksStepped += STEP_CHUNK;
    const cur = await page.evaluate(
      (id) => {
        const L = (window as unknown as LionsWindow).__lions;
        const u = L.units(0).find((u) => u.id === id);
        return u ? { x: u.x, y: u.y } : null;
      },
      startTank.id
    );
    if (!cur) throw new Error(`mbt_lavi #${startTank.id} died or vanished while marching to (${target.x}, ${target.y})`);
    lastTankPos = cur;
    const dist = Math.hypot(cur.x - target.x, cur.y - target.y);
    if (dist <= ARRIVAL_TILES) {
      arrived = true;
      break;
    }
  }
  if (!arrived) {
    throw new Error(
      `mbt_lavi #${startTank.id} never reached within ${ARRIVAL_TILES} tiles of (${target.x}, ${target.y}) ` +
        `after ${ticksStepped} ticks -- stalled at (${lastTankPos.x}, ${lastTankPos.y})`
    );
  }
  console.log(`[${TAG}] mbt_lavi #${startTank.id} arrived at (${lastTankPos.x}, ${lastTankPos.y}) after ${ticksStepped} ticks`);

  // Let the whole formation -- not just the Lavi -- catch up before framing.
  // The arrival check above watches only the Lavi (per the coordinator's own
  // instruction), and a group order lands in FORMATION rather than stacked
  // (`packages/sim/src/formation.ts`), so trailing units (measured: the
  // centroid landed 3-4 tiles short of the target at the moment the Lavi
  // itself arrived) leave the CENTROID -- what the camera below is actually
  // framed on -- well short of the clean, combat-free point this file's own
  // top comment measured. `SETTLE_TICKS` is one more `step()` call, so it is
  // still covered by "overlays and fog after the LAST step()" below.
  await page.evaluate((n) => (window as unknown as LionsWindow).__lions.step(n), SETTLE_TICKS);

  // Overlays and fog AFTER the last step(), per the coordinator's own
  // ordering -- see "Overlays, the occlusion silhouette, and fog" above.
  await page.evaluate(() => (window as unknown as LionsWindow).__lions.renderer.setDebugLayerVisible('overlays', false));
  await page.evaluate(() => (window as unknown as LionsWindow).__lions.renderer.setDebugLayerVisible('fog', false));

  // Freeze the app's own rAF loop before the camera write below, so nothing
  // can repaint between it and the final screenshot.
  await page.evaluate(FREEZE_FRAME_LOOP_SCRIPT);

  // Camera on the force's centroid, at its FINAL (arrived) positions --
  // plus CENTROID_X_NUDGE, which this file's own top comment ("Camera and
  // clip") explains: the combat-safe order target and the void-clean
  // camera position turned out not to be the SAME point (a margin of one to
  // two tiles separates "the Lavi's own arrival is safe" from "the
  // formation's centroid clears the map edge"), so the order aims for the
  // safe point and the camera is nudged east from the centroid it actually
  // produces, onto the clean one -- measured, not a guess: this centroid
  // plus 3 tiles is where the corner/quadrant samples below were taken.
  const finalUnits = await page.evaluate(() => (window as unknown as LionsWindow).__lions.units(0));
  const centroid = finalUnits.reduce(
    (acc, u) => ({ x: acc.x + u.x / finalUnits.length, y: acc.y + u.y / finalUnits.length }),
    { x: 0, y: 0 }
  );
  const cameraTarget = { x: centroid.x + CENTROID_X_NUDGE, y: centroid.y };
  console.log(
    `[${TAG}] force centroid (${centroid.x.toFixed(2)}, ${centroid.y.toFixed(2)}); ` +
      `camera at (${cameraTarget.x.toFixed(2)}, ${cameraTarget.y.toFixed(2)}), zoom ${ZOOM}`
  );
  await page.evaluate(
    ([cx, cy, cz]) => {
      const c = (window as unknown as LionsWindow).__lions.renderer.camera;
      c.x = cx;
      c.y = cy;
      c.zoom = cz;
    },
    [cameraTarget.x, cameraTarget.y, ZOOM]
  );

  // One explicit zero-time repaint at the FINAL camera position -- the
  // picture the last step() painted was at the OLD camera, not this one.
  await page.evaluate(REPAINT_SCRIPT);

  await page.screenshot({ path: OUT_FILE, type: 'jpeg', quality: 86, clip: CLIP });
  console.log(`[${TAG}] saved ${OUT_FILE}`);
} finally {
  if (browser) await browser.close();
  stopDevServer(devServer, TAG);
}
