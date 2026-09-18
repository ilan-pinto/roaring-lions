/**
 * Engine-rendered unit plates for the garage: one JPEG per KDF unit type,
 * photographed through the running game itself -- the same camera, sun and
 * tone mapping a mission uses -- rather than a sprite-sheet frame the way
 * `packages/app/src/ui/portrait.ts`'s cropped icons are. `pnpm plates:units`.
 *
 *   pnpm plates:units
 *   pnpm plates:units --only=mbt_lavi
 *   pnpm plates:units --only=mbt_lavi,ifv_namer
 *   pnpm plates:units --out=assets/ui/plates/units
 *
 * Manages its own dev server, the way `plate-capture.ts` does (never a
 * human's `pnpm dev`, never a port another tool already owns -- see that
 * file's own comment for the ledger: 5173 human, 5174 golden-diff, 5175
 * three-baseline, 5176 ui:shots, 5177 ui:routes/plate:capture; this one
 * takes 5179, the next free self-managed slot -- 5178 is the OTHER
 * convention, "point me at a server you already started", used by
 * `wreck-captures.ts`/`gait-captures.ts`, not this file).
 *
 * ## One parade tile, spawned and struck one type at a time
 *
 * Every KDF type is spawned at the SAME tile -- found once, at boot, by
 * scanning `sim.blocked` outward from `town_center` for the nearest tile
 * whose own 13x13 (Chebyshev radius 6) neighbourhood is entirely open
 * ground, the in-page equivalent of the fixed "rows 0-7 are open end to
 * end" parade `wreck-captures.ts` hardcodes for the same map, done as a
 * live search instead of a literal so a future map edit cannot silently
 * point this at a tile beside a building. A squad or a crew-served team is
 * ONE sim entity whose own GLB carries every figure (CLAUDE.md's "Mesh
 * units" section: a rig is authored per TEAM, not per soldier), so one
 * `sim.spawn` per type is the whole placement -- there is no group to
 * scatter across tiles the way a mission's `starting_force` would.
 *
 * The camera is set ONCE, centred on that tile, and never moves again --
 * `worldToScreen(tileX, tileY)` therefore lands on the same screen point
 * for every type, so the capture clip is one fixed 900x600 CSS-pixel
 * rectangle around it, computed once and reused, rather than recomputed
 * per unit from a per-unit position (the brief's own wording -- "worldToScreen
 * to centre a clip on the unit" -- reads as per-unit only because a mission
 * placement would scatter units across tiles; a shared parade tile makes
 * that computation idempotent, not per-unit).
 *
 * Sequence per type: spawn at the tile, `step(2)` to let the pose settle,
 * a zero-time `frame(1, 0)` repaint (matching `capture-protocol.ts`'s own
 * `REPAINT_SCRIPT` convention -- every clock the renderer owns, from a
 * mixer to a particle age, is handed 0 ms so two otherwise-identical
 * captures are bit-for-bit reproducible), screenshot, `removeFromPlay`
 * (never `debugKill` -- that leaves a persistent `MeshWreck` standing on
 * the empty-ground reference tile for every capture after the first one it
 * kills; `removeFromPlay` is "an abduction, not a kill", the same choice
 * `gait-captures.ts` documents for its own walking sheet), one more repaint
 * to clear the mesh before the next spawn.
 *
 * ## Pre-warming every mesh before any capture (a deliberate addition)
 *
 * The brief's own sequence captures the empty-ground reference before the
 * per-type loop with no warm-up step. Left that way, a KDF type absent from
 * this sandbox's own roster (`mesh-catalogue.ts` is roster-driven; `/free-play`
 * with no flags fields only `SANDBOX_KDF`) would still be waiting on
 * `main.ts`'s 1 Hz "unknown living type" sweep and its GLB fetch at the
 * moment `step(2)` and one repaint call for its capture -- the same race
 * `wreck-captures.ts`'s own top comment names for its two unrostered
 * vehicles, and the failure mode is silent: an empty tile, which this
 * script's own extent gate would then (correctly, but for the wrong
 * reason) refuse to ship. So every wanted type is spawned once, stacked on
 * the parade tile, BEFORE the reference frame is taken; `step(20)` arms the
 * sweep, a wall-clock wait lets every fetch land (network I/O is not tied
 * to the frame loop this script freezes below), and every pre-warm spawn is
 * then struck before the reference itself is captured. This changes no
 * measured pixel -- every mesh is cached in the loader the same way a
 * second mission using it would find it -- it only removes a source of
 * flakiness the brief's own literal sequence does not protect against.
 *
 * ## Extent: a diff, not an alpha channel
 *
 * A JPEG plate carries no alpha, so "the unit's own pixel footprint" is
 * measured the only way that is left: `pixelmatch` (already a dependency,
 * the same tool `golden-diff/diff.ts` uses) against the empty-ground
 * reference, at the SAME clip, with `diffMask: true` so only genuine
 * differences are drawn into the output buffer -- the bounding box of
 * those pixels is `extent`. Diffed as PNG (lossless, captured in the same
 * breath as the shipped JPEG, never decoded FROM the JPEG this script also
 * writes), because JPEG's own DCT ringing would inflate the measured
 * footprint by however many blocks a real edge bleeds into.
 *
 * A self-diff (comparing a capture with itself) is pixel-identical, so
 * `pixelmatch` takes its fast "images are identical" path and reports zero
 * differing pixels -- `measureExtent` then returns `[0, 0]` for the same
 * reason a diff against a capture where the unit never actually spawned
 * would: neither case has anything to measure, and this script refuses to
 * write a manifest entry for either, loudly, rather than shipping a plate
 * with no known footprint. See task-15-report.md for the falsification run
 * that proved this refusal actually fires.
 *
 * ## Aircraft
 *
 * `heli_peten`/`recon_drone`/`attack_drone` fly at a real render-side world
 * height (`AIR_LIFT_PX`, `packages/render/src/three/units/frame-state.ts` --
 * untouchable, read only), but `Renderer.worldToScreen(wx, wy)` is
 * deliberately lift-blind (`api.ts`'s own comment: "no lift parameter" is
 * the public seam's contract, not an oversight) and this script has no
 * other way to ask the renderer where a specific unit's own mesh landed on
 * screen. The clip is therefore centred on the FLAT ground projection of
 * the parade tile, same as every ground unit; the lift raises an airborne
 * type a modest amount on screen (well inside the clip's own margin at this
 * zoom), so it still sits in frame, but not perfectly centred the way a
 * ground unit is. Recorded in the task report from an actual look at the
 * drone and the helicopter plates, not assumed.
 */
import { chromium, type Browser, type Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { ensureDevServer, stopDevServer } from '../golden-diff/browser';
import { FREEZE_FRAME_LOOP_SCRIPT } from '../golden-diff/capture-protocol';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const TAG = 'unit-plates';
// See this file's own top comment for the port ledger.
const PORT = 5179;
const MAP_ID = 'beit_sahwan_outskirts';
const VIEWPORT = { width: 1400, height: 900 } as const;
const DPR = 2;
const CLIP_W = 900;
const CLIP_H = 600;
const JPEG_QUALITY = 90;
// The brief's own starting point was 3; measured too tight (mbt_lavi read
// 596px wide, just under the required 600) and raised to 3.2, which clears
// it with margin -- see the task report for the measured run.
const ZOOM = 3.2;
// Chebyshev radius the parade tile's own neighbourhood must be entirely open
// ground for -- "6 tiles from any building" read as a half-width, so the
// nearest blocked tile ends up strictly further than 6 away.
const CLEAR_RADIUS = 6;

interface LionsWindow {
  __lions: {
    step(n: number): number;
    goto(where: string | number, y?: number): [number, number] | null;
    sim: {
      width: number;
      height: number;
      blocked: Uint8Array;
      entityCount: number;
      state: { alive: Uint8Array; side: Uint8Array };
      unitTypes: { id: string }[];
      spawn(typeIdx: number, side: number, x: number, y: number): number;
      removeFromPlay(id: number): void;
    };
    renderer: {
      camera: { x: number; y: number; zoom: number };
      setDebugLayerVisible(name: string, visible: boolean): number;
      frame(alpha: number, dtMs: number): void;
      worldToScreen(wx: number, wy: number): { x: number; y: number };
      loadSprites(unitTypeId: string, basePath: string): Promise<void>;
    };
  };
}

function arg(name: string, fallback: string): string {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const only = arg('only', '');
const outDir = path.resolve(REPO_ROOT, arg('out', 'assets/ui/plates/units'));

interface PlateManifestEntry {
  file: string;
  width: number;
  height: number;
  extent: [number, number];
}

interface PlateManifest {
  version: 1;
  camera: { zoom: number; dpr: number };
  plates: Record<string, PlateManifestEntry>;
}

/** Bounding box of every pixel `pixelmatch` counts as a genuine difference
 *  between the empty-ground reference and one unit's own capture -- see this
 *  file's own top comment ("Extent: a diff, not an alpha channel") for why a
 *  diff stands in for an alpha channel a JPEG does not carry.
 *
 *  `diffMask: true` leaves every matching AND every anti-aliased-only pixel
 *  untouched (alpha 0) in the output buffer, so the scan below only has to
 *  test alpha, never decode a colour. Two identical inputs take
 *  `pixelmatch`'s own "images are identical" fast path, which never writes
 *  the output buffer at all -- the scan then finds nothing and this returns
 *  `[0, 0]`, the exact shape Step 2's falsification run exercises on
 *  purpose. */
function measureExtent(reference: PNG, candidate: PNG): { extent: [number, number]; diffPixels: number } {
  if (reference.width !== candidate.width || reference.height !== candidate.height) {
    throw new Error(
      `measureExtent: dimension mismatch -- reference ${reference.width}x${reference.height}, ` +
        `candidate ${candidate.width}x${candidate.height}`
    );
  }
  const { width, height } = reference;
  const out = Buffer.alloc(width * height * 4);
  const diffPixels = pixelmatch(reference.data, candidate.data, out, width, height, {
    threshold: 0.1,
    diffMask: true,
  });
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (out[(y * width + x) * 4 + 3] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) return { extent: [0, 0], diffPixels };
  return { extent: [maxX - minX + 1, maxY - minY + 1], diffPixels };
}

/** Retries a `page.screenshot` call up to `attempts` times on ANY failure
 *  (Playwright's own timeout included), waiting `delayMs` between tries.
 *  There is nothing to re-derive between attempts -- the frame loop is
 *  frozen and nothing on the page has changed -- so a retry is exactly the
 *  same request against exactly the same picture, not a second guess. */
async function captureWithRetry<T>(take: () => Promise<T>, label: string, attempts = 3, delayMs = 5000): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await take();
    } catch (err) {
      lastErr = err;
      console.warn(`[${TAG}] ${label}: capture attempt ${attempt}/${attempts} failed: ${(err as Error).message}`);
      if (attempt < attempts) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

fs.mkdirSync(outDir, { recursive: true });

const kdfDir = path.join(REPO_ROOT, 'data/units/kdf');
const allIds = fs
  .readdirSync(kdfDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.slice(0, -'.json'.length))
  .sort();
const onlySet = only.length > 0 ? new Set(only.split(',')) : null;
const wanted = onlySet ? allIds.filter((id) => onlySet.has(id)) : allIds;
if (wanted.length === 0) {
  throw new Error(`--only=${only} names no unit under data/units/kdf/`);
}
console.log(`[${TAG}] ${wanted.length} type(s): ${wanted.join(', ')}`);

const BASE = `http://localhost:${PORT}`;
const devServer = await ensureDevServer(PORT, REPO_ROOT, TAG);
let browser: Browser | null = null;
try {
  browser = await chromium.launch({
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const page: Page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: DPR });
  // Generous, not the family's usual 30s: seventeen loaded GLBs under
  // software SwiftShader measured individual screenshots taking well past
  // 90s once several meshes were resident (see the task report -- a real
  // `GPU stall due to ReadPixels` driver message, not a hang), and a
  // timeout here is a false failure, not a real one -- the capture just
  // needs more wall clock.
  page.setDefaultTimeout(180000);
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') console.log(`  page ${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => console.log(`  page error: ${err.message}`));

  console.log(`[${TAG}] booting /free-play/${MAP_ID} at ${VIEWPORT.width}x${VIEWPORT.height}, DPR ${DPR}`);
  await page.goto(`${BASE}/free-play/${MAP_ID}`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window as unknown as LionsWindow).__lions?.renderer, null, {
    timeout: 30000,
  });
  await page.evaluate(() => document.fonts.ready);
  // Time for the roster-driven mesh loader's own boot fetches, same margin
  // `plate-capture.ts` gives it.
  await page.waitForTimeout(3000);

  // Hide the HUD by containment, not by tagName -- see `plate-capture.ts`'s
  // own top comment for why containment is the correct test in a build
  // where the canvas is nested one level under <body>, not a direct child.
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    for (const el of Array.from(document.body.children)) {
      if (canvas && el.contains(canvas)) continue;
      (el as HTMLElement).style.display = 'none';
    }
  });

  await page.evaluate(() => (window as unknown as LionsWindow).__lions.renderer.setDebugLayerVisible('overlays', false));
  await page.evaluate(() => (window as unknown as LionsWindow).__lions.renderer.setDebugLayerVisible('fog', false));

  // Strip EVERY unit `showSandbox` fields by default (`sandbox-force.ts`'s
  // `SANDBOX_KDF` and `SANDBOX_ENEMY`) before anything else runs -- both
  // sides, not only the hostile one. Found the hard way, not anticipated:
  // the first full run put the parade tile at (20, 11), only ~7 tiles from a
  // default `militia_cell` at (27, 12), and an `apc_eitan` in the per-type
  // loop found it and opened fire -- a muzzle flash, a tracer and an
  // explosion burst that blew its own measured extent out to 1186x1083 (see
  // the task report for that screenshot). A parade tile chosen only for
  // "open ground, clear of buildings" says nothing about combat safety, and
  // the fix is not a smarter tile search (any tile this sandbox's own
  // roster ships could in principle be within someone's weapon range) -- it
  // is removing every possible shooter, and every possible target, before
  // the first spawn. `removeFromPlay`, not `debugKill`: an abduction, never
  // a kill that would leave a wreck sitting on the parade tile's own
  // empty-ground reference.
  await page.evaluate(() => {
    const L = (window as unknown as LionsWindow).__lions;
    const n = L.sim.entityCount;
    for (let i = 0; i < n; i++) {
      if (L.sim.state.alive[i] === 1) L.sim.removeFromPlay(i);
    }
  });

  // Freeze the app's own rAF loop before anything below reads or writes a
  // frame -- every capture from here on is driven entirely by explicit
  // `step()`/`frame()` calls, never by real time.
  await page.evaluate(FREEZE_FRAME_LOOP_SCRIPT);

  const townCenter = await page.evaluate(() => (window as unknown as LionsWindow).__lions.goto('town_center'));
  if (!townCenter) throw new Error(`map "${MAP_ID}" has no "town_center" marker`);

  // No named `const f = (...) => {}` in here: `tsx` compiles with esbuild's
  // `keepNames`, which rewrites one into `__name(f, "f")` -- a helper that
  // exists in the Node module scope this file runs in, not in the page this
  // callback is serialised into. `gait-captures.ts`'s own top comment names
  // the exact failure (`ReferenceError: __name is not defined`) and the same
  // fix: inline the clear-radius check rather than naming it.
  const paradeTile = await page.evaluate(
    ([tcx, tcy, radius]) => {
      const sim = (window as unknown as LionsWindow).__lions.sim;
      const w = sim.width;
      const h = sim.height;
      const blocked = sim.blocked;
      const maxR = w + h;
      for (let r = 0; r <= maxR; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const tx = tcx + dx;
            const ty = tcy + dy;
            if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
            if (tx - radius < 0 || ty - radius < 0 || tx + radius >= w || ty + radius >= h) continue;
            let clear = true;
            for (let ny = -radius; ny <= radius && clear; ny++) {
              for (let nx = -radius; nx <= radius; nx++) {
                if (blocked[(ty + ny) * w + (tx + nx)] !== 0) {
                  clear = false;
                  break;
                }
              }
            }
            if (clear) return [tx, ty] as [number, number];
          }
        }
      }
      return null;
    },
    [townCenter[0], townCenter[1], CLEAR_RADIUS]
  );
  if (!paradeTile) throw new Error(`no tile on "${MAP_ID}" has a clear ${CLEAR_RADIUS}-tile radius`);
  console.log(`[${TAG}] parade tile (${paradeTile[0]}, ${paradeTile[1]}), ${CLEAR_RADIUS}-tile clear radius`);

  const [tileX, tileY] = paradeTile;
  const actualZoom = await page.evaluate(
    ([x, y, z]) => {
      const c = (window as unknown as LionsWindow).__lions.renderer.camera;
      c.x = x;
      c.y = y;
      c.zoom = z;
      return c.zoom;
    },
    [tileX, tileY, ZOOM]
  );
  if (actualZoom !== ZOOM) {
    throw new Error(`camera.zoom read back ${actualZoom} after being set to ${ZOOM} -- something is clamping it`);
  }
  console.log(`[${TAG}] camera at (${tileX}, ${tileY}), zoom ${actualZoom} (read back, unclamped)`);
  await page.evaluate(() => (window as unknown as LionsWindow).__lions.renderer.frame(1, 0));

  const screenPoint = await page.evaluate(
    ([x, y]) => (window as unknown as LionsWindow).__lions.renderer.worldToScreen(x, y),
    [tileX, tileY]
  );
  const clip = {
    x: screenPoint.x - CLIP_W / 2,
    y: screenPoint.y - CLIP_H / 2,
    width: CLIP_W,
    height: CLIP_H,
  };
  if (clip.x < 0 || clip.y < 0 || clip.x + clip.width > VIEWPORT.width || clip.y + clip.height > VIEWPORT.height) {
    throw new Error(
      `${JSON.stringify(clip)} falls outside the ${VIEWPORT.width}x${VIEWPORT.height} viewport -- ` +
        `the parade tile's screen point is not where the camera was expected to centre it`
    );
  }
  console.log(`[${TAG}] clip ${JSON.stringify(clip)} (${CLIP_W * DPR}x${CLIP_H * DPR} capture px)`);

  const FIXED = 65536;
  const spawnAt = async (id: string): Promise<number> => {
    return page.evaluate(
      ([unitId, x, y]) => {
        const L = (window as unknown as LionsWindow).__lions;
        const typeIdx = L.sim.unitTypes.findIndex((t) => t.id === unitId);
        if (typeIdx < 0) throw new Error(`no unit type "${unitId}" in this build`);
        return L.sim.spawn(typeIdx, 0, x, y);
      },
      [id, tileX * FIXED, tileY * FIXED] as [string, number, number]
    );
  };
  const remove = async (entity: number): Promise<void> => {
    await page.evaluate((e) => (window as unknown as LionsWindow).__lions.sim.removeFromPlay(e), entity);
  };

  // Two KDF types carry no GLB at all (`hasUnitMesh` false: `attack_drone`,
  // `recon_drone` -- checked against `mesh-catalogue.ts` directly, not
  // assumed; `heli_peten` DOES have one despite also naming a `SPRITE_MAP`
  // fallback for `&nomesh`). The mesh sweep below never touches them --
  // `main.ts`'s own sweep gates on `hasUnitMesh(typeId)` and skips a type
  // with none by construction -- and there is no billboard equivalent of it:
  // a sprite sheet loads before deploy only for a type the BOOT-TIME roster
  // already knew to field, so a type spawned after boot with no mesh and no
  // pre-queued sheet draws nothing at all, with no warning. Found by looking
  // at the actual `attack_drone.jpg` this produced before this fix: a small
  // out-of-place blur (a VFX layer, not the unit) on otherwise empty ground.
  // `renderer.loadSprites` is the same call `main.ts`'s own roster loader
  // makes; the two paths are `SPRITE_MAP`'s own entries, read directly
  // rather than guessed (`main.ts:580` `DRONE`, `main.ts:647`).
  const NO_MESH_SPRITE_PATHS: Readonly<Record<string, string>> = {
    attack_drone: '/sprites/DRONE_ATTACK/',
    recon_drone: '/sprites/DRONE_RECON/',
  };
  for (const id of wanted) {
    const spritePath = NO_MESH_SPRITE_PATHS[id];
    if (spritePath === undefined) continue;
    console.log(`[${TAG}] ${id} has no mesh -- loading its billboard sheet directly (${spritePath})`);
    await page.evaluate(
      ([unitId, base]) => (window as unknown as LionsWindow).__lions.renderer.loadSprites(unitId, base),
      [id, spritePath] as [string, string]
    );
  }

  // --- pre-warm: see this file's own top comment for why this is not in
  // the brief's literal sequence and why it changes no measured pixel.
  console.log(`[${TAG}] pre-warming ${wanted.length} mesh(es)...`);
  const warm: number[] = [];
  for (const id of wanted) warm.push(await spawnAt(id));
  await page.evaluate(() => (window as unknown as LionsWindow).__lions.step(20));
  await page.waitForTimeout(6000);
  for (let i = 0; i < 4; i++) await page.evaluate(() => (window as unknown as LionsWindow).__lions.renderer.frame(1, 0));
  for (const e of warm) await remove(e);
  await page.evaluate(() => (window as unknown as LionsWindow).__lions.renderer.frame(1, 0));

  // --- the empty-ground reference, captured once, after every mesh is warm
  // and every pre-warm spawn has been struck.
  const referenceBuf = await page.screenshot({ clip, type: 'png' });
  const reference = PNG.sync.read(referenceBuf);
  console.log(`[${TAG}] reference frame captured (${reference.width}x${reference.height})`);

  // Starts from whatever is already on disk, not an empty object: a
  // `--only=` batch (this run's own recovery path after a SwiftShader stall
  // mid-run -- see this file's own top comment) must ADD its entries to an
  // existing manifest, never clobber every id a previous invocation already
  // wrote. Only entries for `wanted` are ever touched below.
  const manifestPath = path.join(outDir, 'manifest.json');
  let existingPlates: Record<string, PlateManifestEntry> = {};
  if (fs.existsSync(manifestPath)) {
    try {
      const prior = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as PlateManifest;
      existingPlates = prior.plates ?? {};
    } catch {
      console.warn(`[${TAG}] ${manifestPath} exists but did not parse as a manifest -- starting fresh`);
    }
  }
  const manifest: PlateManifest = { version: 1, camera: { zoom: actualZoom, dpr: DPR }, plates: existingPlates };
  const writeManifest = (): void => fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  for (const id of wanted) {
    const entity = await spawnAt(id);
    await page.evaluate(() => (window as unknown as LionsWindow).__lions.step(2));
    await page.evaluate(() => (window as unknown as LionsWindow).__lions.renderer.frame(1, 0));

    // Retried, not a bare call: measured under SwiftShader with several
    // GLBs resident, an individual `page.screenshot` can stall well past a
    // minute (`GL Driver Message ... GPU stall due to ReadPixels`, this
    // file's own top comment) -- and unlike a real rendering problem, a
    // second attempt on the identical, still-frozen frame has nothing to
    // disagree with the first about.
    const candidateBuf = await captureWithRetry(() => page.screenshot({ clip, type: 'png' }), `${id} (png)`);
    const candidate = PNG.sync.read(candidateBuf);
    const file = `${id}.jpg`;
    await captureWithRetry(
      () => page.screenshot({ clip, type: 'jpeg', quality: JPEG_QUALITY, path: path.join(outDir, file) }),
      `${id} (jpeg)`
    );

    await remove(entity);
    await page.evaluate(() => (window as unknown as LionsWindow).__lions.renderer.frame(1, 0));

    const { extent, diffPixels } = measureExtent(reference, candidate);
    if (extent[0] === 0 || extent[1] === 0) {
      throw new Error(`${id}: empty extent -- the diff is broken or the unit did not spawn`);
    }
    manifest.plates[id] = { file, width: candidate.width, height: candidate.height, extent };
    console.log(`[${TAG}] ${id}: extent ${extent[0]}x${extent[1]} (${diffPixels} differing px)`);
    // Written after every unit, not only at the end: a later unit's own
    // SwiftShader stall (or a `--only` run) must not cost an already-valid
    // capture its manifest entry.
    writeManifest();
  }

  console.log(
    `[${TAG}] captured ${wanted.length} plate(s) this run, ${Object.keys(manifest.plates).length} total in ` +
      `manifest.json under ${outDir}`
  );
} finally {
  if (browser) await browser.close();
  stopDevServer(devServer, TAG);
}
