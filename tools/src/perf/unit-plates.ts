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
 *   pnpm plates:units --port=5180
 *
 * Manages its own dev server, the way `plate-capture.ts` does (never a
 * human's `pnpm dev`, never a port another tool already owns -- see that
 * file's own comment for the ledger: 5173 human, 5174 golden-diff, 5175
 * three-baseline, 5176 ui:shots, 5177 ui:routes/plate:capture; this one
 * defaults to 5179, the next free self-managed slot -- 5178 is the OTHER
 * convention, "point me at a server you already started", used by
 * `wreck-captures.ts`/`gait-captures.ts`, not this file. `--port` overrides
 * it, which is also how a spawned child is told which server its parent
 * already started -- see "One process per unit" below).
 *
 * ## Hardware GPU: tried, and rejected as the default (fix round 1, item 1)
 *
 * `docs/PERFORMANCE.md` and `backend-curve-gate.ts` record that headless
 * Chromium renders WebGL through SwiftShader (software) by default, and that
 * `['--use-angle=metal', '--ignore-gpu-blocklist', '--use-gl=angle',
 * '--enable-gpu-rasterization', '--disable-gpu-sandbox']` switches it to the
 * real Metal backend on this Mac, clearing multi-second per-frame stalls
 * measured elsewhere. Tested here directly: the monolithic all-seventeen
 * loop (this file's shape before the fix-round split below) was rerun
 * unchanged except for those launch args. It did NOT clear this file's own
 * crash -- `apc_eitan` captured correctly (`747x549`, matching the
 * SwiftShader run's `744x549` within noise), then the SAME failure hit on
 * the very next unit's `removeFromPlay` call: `TypeError: Cannot read
 * properties of undefined (reading 'sim')`, i.e. `window.__lions` itself was
 * gone -- a WebGL context loss, not a slow frame. The one thing Metal
 * changed was speed: total wall time to that crash was **14.88s**, against
 * SwiftShader's multi-minute stalls before its own equivalent failure. So
 * the crash is not a SwiftShader-speed problem this file can launch its way
 * out of -- it reproduces, faster, on real hardware -- and per the fix
 * round's own instruction the default STAYS SwiftShader. `--metal` is an
 * explicit opt-in for anyone who wants the faster (still fundamentally
 * fragile, in a single long-lived session) path; `readUnmaskedRenderer`
 * (`golden-diff/browser.ts`, the same `WEBGL_debug_renderer_info` read
 * `backend-curve-gate.ts` uses) confirms and logs whichever backend actually
 * launched, and the string lands in the manifest's own `camera.gpu`.
 *
 * ## One process per unit, not one browser for all seventeen (fix round 1, item 2)
 *
 * The crash above is not GPU-backend-specific, and two SwiftShader runs of
 * the old monolithic loop reproduced it independently (see task-15-report.md
 * for both). What DOES avoid it, reliably, across eighteen real captures
 * (the seventeen KDF types plus the falsification run): giving each unit its
 * own browser, so no session ever asks a second `page.screenshot` of a page
 * that already produced one. `wanted.length > 1 && !isChild` is therefore
 * the ORCHESTRATOR path: it starts the dev server once, then spawns one
 * `tsx` CHILD process per id (`--only=<id> --child --port=<port>
 * --out=<outDir>`, `--metal` forwarded if the parent got it), each with its
 * own fresh `chromium.launch`, waited on SEQUENTIALLY (not in parallel --
 * running several headless Chromiums against one software/hardware
 * rasteriser at once would reproduce exactly the resource pressure this
 * split exists to avoid). `ensureDevServer` already treats "a server is
 * already listening on this port" as "reuse it, never manage it"
 * (`golden-diff/browser.ts`), which is the entire mechanism that lets every
 * child share the parent's server for free -- no special-casing needed here.
 *
 * A child does the exact same capture this file always did (spawn, settle,
 * screenshot, measure, strike), but writes its own result as a FRAGMENT file
 * under `<outDir>/.fragments/<id>.json` instead of touching the shared
 * `manifest.json` itself -- only the orchestrator (one process, one writer)
 * ever merges into that file, which is what makes "a child failure is
 * reported by id and the run exits non-zero with the others still written"
 * true without a write race: a failed child simply leaves no fragment, the
 * orchestrator notices, and every OTHER id's fragment still merges in.
 * `--only=<one id>` with no `--child` is UNCHANGED from before this fix
 * round -- still a direct, single-session capture that merges straight into
 * `manifest.json` itself -- so the fast interactive `--only=mbt_lavi`
 * falsification workflow this file's own Step 2 depends on still works
 * exactly as documented below.
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
 * flakiness the brief's own literal sequence does not protect against. In
 * the orchestrator's per-child path this pre-warms exactly one mesh, which
 * costs a few idle seconds per child rather than saving them -- kept anyway,
 * because the two GLB-less billboard types (below) and any future roster gap
 * still need the same settle, and a single code path with no `wanted.length`
 * special case is worth more than shaving a handful of seconds seventeen times.
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
 *
 * `attack_drone`/`recon_drone` also carry no GLB at all (`hasUnitMesh`
 * false, checked directly against `mesh-catalogue.ts`) and the roster-driven
 * sprite loader only ever queues a billboard sheet for a type the BOOT-TIME
 * force already fields -- so spawning either one cold drew nothing but a
 * stray VFX blur on empty ground. Fixed by calling `renderer.loadSprites` on
 * their own `SPRITE_MAP` paths (`main.ts:580`, `main.ts:647`) directly
 * before the first spawn.
 */
import { chromium, type Browser, type Page } from 'playwright';
import { spawn as spawnProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { ensureDevServer, stopDevServer, readUnmaskedRenderer } from '../golden-diff/browser';
import { FREEZE_FRAME_LOOP_SCRIPT, hideHudExceptCanvas } from '../golden-diff/capture-protocol';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const TOOLS_DIR = path.join(REPO_ROOT, 'tools');
const TAG = 'unit-plates';
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
// SwiftShader by default -- see this file's own top comment ("Hardware GPU:
// tried, and rejected as the default") for the measured reason. `--metal`
// opts in per invocation; the orchestrator forwards it to every child.
const SWIFTSHADER_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const METAL_ARGS = [
  '--use-angle=metal',
  '--ignore-gpu-blocklist',
  '--use-gl=angle',
  '--enable-gpu-rasterization',
  '--disable-gpu-sandbox',
];

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
const PORT = Number(arg('port', '5179'));
const isChild = process.argv.includes('--child');
const useMetal = process.argv.includes('--metal');
const LAUNCH_ARGS = useMetal ? METAL_ARGS : SWIFTSHADER_ARGS;

interface PlateManifestEntry {
  file: string;
  width: number;
  height: number;
  extent: [number, number];
}

interface PlateManifest {
  version: 1;
  camera: { zoom: number; dpr: number; gpu: string };
  plates: Record<string, PlateManifestEntry>;
}

/** What a child writes for the orchestrator to collect -- see this file's
 *  own top comment ("One process per unit") for why a fragment file, not a
 *  direct write into the shared `manifest.json`. */
interface PlateFragment {
  entry: PlateManifestEntry;
  zoom: number;
  dpr: number;
  gpu: string;
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
 *  same request against exactly the same picture, not a second guess. Does
 *  NOT recover from the WebGL-context-loss failure this file's own top
 *  comment measures (that one takes `window.__lions` down with it, so a
 *  retried `page.evaluate` fails identically) -- it exists for the merely
 *  slow case, which is real and separate (`GL Driver Message ... GPU stall
 *  due to ReadPixels`). */
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

/** Spawns one child `tsx` process for a single id, inheriting stdio (so its
 *  output streams straight into the parent's, unbuffered and in real time --
 *  the ordering that makes "record the output" meaningful) and resolving
 *  with its exit code (never rejecting: a failed spawn resolves 1, exactly
 *  like a failed capture, so the orchestrator's loop needs only one branch). */
function spawnChild(id: string): Promise<number> {
  return new Promise((resolve) => {
    const args = ['tsx', 'src/perf/unit-plates.ts', `--only=${id}`, '--child', `--port=${PORT}`, `--out=${outDir}`];
    if (useMetal) args.push('--metal');
    const child = spawnProcess('npx', args, { cwd: TOOLS_DIR, stdio: 'inherit' });
    child.on('exit', (code) => resolve(code ?? 1));
    child.on('error', (err) => {
      console.error(`[${TAG}] ${id}: failed to spawn child -- ${err.message}`);
      resolve(1);
    });
  });
}

/** Reads whatever `manifest.json` already has, tolerating an absent or
 *  unparseable file (a first run has neither). Used by both the direct path
 *  (merging its own capture straight in) and the orchestrator (merging every
 *  child's fragment in at the end) -- one function, so the merge rule cannot
 *  drift between the two callers. */
function readExistingPlates(manifestPath: string): Record<string, PlateManifestEntry> {
  if (!fs.existsSync(manifestPath)) return {};
  try {
    const prior = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as PlateManifest;
    return prior.plates ?? {};
  } catch {
    console.warn(`[${TAG}] ${manifestPath} exists but did not parse as a manifest -- starting fresh`);
    return {};
  }
}

/**
 * The orchestrator: one dev server, one child `tsx` process per id, run
 * SEQUENTIALLY (see this file's own top comment for why not in parallel).
 * Collects every child's fragment, merges into `manifest.json` once, and
 * reports failures by id without losing the successes -- a child's own
 * `process.exitCode` becomes this run's floor, never silently swallowed.
 */
async function runOrchestrator(): Promise<void> {
  console.log(`[${TAG}] orchestrating ${wanted.length} child capture(s) on :${PORT}, one process per id...`);
  const startedAt = Date.now();
  const devServer = await ensureDevServer(PORT, REPO_ROOT, TAG);
  const fragmentsDir = path.join(outDir, '.fragments');
  fs.mkdirSync(fragmentsDir, { recursive: true });
  const succeeded: string[] = [];
  const failed: string[] = [];
  try {
    for (const id of wanted) {
      console.log(`[${TAG}] --- ${id} ---`);
      const code = await spawnChild(id);
      const fragPath = path.join(fragmentsDir, `${id}.json`);
      if (code === 0 && fs.existsSync(fragPath)) {
        succeeded.push(id);
      } else {
        failed.push(id);
        console.error(`[${TAG}] ${id}: child exited ${code}${fs.existsSync(fragPath) ? '' : ' with no fragment'} -- treating as failed`);
      }
    }
  } finally {
    stopDevServer(devServer, TAG);
  }

  const manifestPath = path.join(outDir, 'manifest.json');
  const plates = readExistingPlates(manifestPath);
  let gpu = 'unknown';
  let zoom = ZOOM;
  for (const id of succeeded) {
    const frag = JSON.parse(fs.readFileSync(path.join(fragmentsDir, `${id}.json`), 'utf8')) as PlateFragment;
    plates[id] = frag.entry;
    gpu = frag.gpu;
    zoom = frag.zoom;
  }
  const manifest: PlateManifest = { version: 1, camera: { zoom, dpr: DPR, gpu }, plates };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.rmSync(fragmentsDir, { recursive: true, force: true });

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `[${TAG}] ${succeeded.length}/${wanted.length} succeeded in ${seconds}s, ${Object.keys(plates).length} total ` +
      `in manifest.json under ${outDir}`
  );
  if (failed.length > 0) {
    console.error(`[${TAG}] FAILED: ${failed.join(', ')}`);
    process.exitCode = 1;
  }
}

/**
 * The capture itself -- unchanged in shape from before the fix round, run
 * either directly (a human's `--only=<id>[,<id>...]`, no `--child`: merges
 * straight into `manifest.json`) or as one of the orchestrator's children
 * (`--child`: writes a fragment per id instead, see this file's own top
 * comment).
 */
async function runCapture(): Promise<void> {
  const BASE = `http://localhost:${PORT}`;
  const devServer = await ensureDevServer(PORT, REPO_ROOT, TAG);
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
    const gpu = await readUnmaskedRenderer(browser);
    console.log(`[${TAG}] GPU: ${gpu}`);

    const page: Page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: DPR });
    // Generous, not the family's usual 30s: under software SwiftShader a
    // `page.screenshot` measured well past 90s once several GLBs were
    // resident (`GL Driver Message ... GPU stall due to ReadPixels`, this
    // file's own top comment) -- a timeout here is a false failure, not a
    // real one, the capture just needs more wall clock.
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

    // Hide the HUD by containment -- see `hideHudExceptCanvas`'s own doc
    // comment (`golden-diff/capture-protocol.ts`, shared with
    // `plate-capture.ts` since fix round 1) for why.
    await page.evaluate(hideHudExceptCanvas);

    await page.evaluate(() => (window as unknown as LionsWindow).__lions.renderer.setDebugLayerVisible('overlays', false));
    await page.evaluate(() => (window as unknown as LionsWindow).__lions.renderer.setDebugLayerVisible('fog', false));

    // Strip EVERY unit `showSandbox` fields by default (`sandbox-force.ts`'s
    // `SANDBOX_KDF` and `SANDBOX_ENEMY`) before anything else runs -- both
    // sides, not only the hostile one. Found the hard way, not anticipated:
    // an early run put the parade tile at (20, 11), only ~7 tiles from a
    // default `militia_cell` at (27, 12), and an `apc_eitan` in the per-type
    // loop found it and opened fire -- a muzzle flash, a tracer and an
    // explosion burst that blew its own measured extent out to 1186x1083
    // (see the task report for that screenshot). A parade tile chosen only
    // for "open ground, clear of buildings" says nothing about combat
    // safety, and the fix is not a smarter tile search (any tile this
    // sandbox's own roster ships could in principle be within someone's
    // weapon range) -- it is removing every possible shooter, and every
    // possible target, before the first spawn. `removeFromPlay`, not
    // `debugKill`: an abduction, never a kill that would leave a wreck
    // sitting on the parade tile's own empty-ground reference.
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
    // callback is serialised into. Inline the clear-radius check rather than
    // naming it (`gait-captures.ts`'s own top comment names the exact
    // failure: `ReferenceError: __name is not defined`).
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

    // Two KDF types carry no GLB at all -- see this file's own top comment
    // ("Aircraft") for the fix and why it is needed.
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

    // Direct mode only: starts from whatever is already on disk, not an
    // empty object, so a human's `--only=` run adds its entries rather than
    // clobbering every id a fuller run already wrote. Child mode never reads
    // or writes this file at all -- it writes a fragment per id instead (see
    // this file's own top comment, "One process per unit").
    const manifestPath = path.join(outDir, 'manifest.json');
    const manifest: PlateManifest = {
      version: 1,
      camera: { zoom: actualZoom, dpr: DPR, gpu },
      plates: isChild ? {} : readExistingPlates(manifestPath),
    };
    const fragmentsDir = path.join(outDir, '.fragments');
    if (isChild) fs.mkdirSync(fragmentsDir, { recursive: true });
    const writeManifest = (): void => fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    for (const id of wanted) {
      const entity = await spawnAt(id);
      await page.evaluate(() => (window as unknown as LionsWindow).__lions.step(2));
      await page.evaluate(() => (window as unknown as LionsWindow).__lions.renderer.frame(1, 0));

      // Retried, not a bare call: measured under SwiftShader with several
      // GLBs resident, an individual `page.screenshot` can stall well past a
      // minute -- and unlike a real rendering problem, a second attempt on
      // the identical, still-frozen frame has nothing to disagree with the
      // first about. Does NOT recover from a WebGL context loss (this
      // file's own top comment); that failure surfaces as an uncaught
      // exception below, which is exactly what should mark this id/process
      // as failed to a parent orchestrator.
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
      const entry: PlateManifestEntry = { file, width: candidate.width, height: candidate.height, extent };
      console.log(`[${TAG}] ${id}: extent ${extent[0]}x${extent[1]} (${diffPixels} differing px)`);

      if (isChild) {
        const fragment: PlateFragment = { entry, zoom: actualZoom, dpr: DPR, gpu };
        fs.writeFileSync(path.join(fragmentsDir, `${id}.json`), JSON.stringify(fragment));
      } else {
        manifest.plates[id] = entry;
        // Written after every unit, not only at the end: a later unit's own
        // failure must not cost an already-valid capture its manifest entry.
        writeManifest();
      }
    }

    if (!isChild) {
      console.log(
        `[${TAG}] captured ${wanted.length} plate(s) this run, ${Object.keys(manifest.plates).length} total in ` +
          `manifest.json under ${outDir}`
      );
    }
  } finally {
    if (browser) await browser.close();
    stopDevServer(devServer, TAG);
  }
}

if (!onlySet && !isChild) {
  await runOrchestrator();
} else {
  await runCapture();
}
