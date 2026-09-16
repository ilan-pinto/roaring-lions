/**
 * The infantry gait sheet: every type whose art this milestone moved,
 * photographed WALKING and FIRING, before and after, at gameplay zoom and at
 * the top of the zoom band.
 *
 *     npx tsx tools/src/perf/gait-captures.ts            # dev server on 5178
 *     npx tsx tools/src/perf/gait-captures.ts <base> <out> --only=inf_squad
 *     npx tsx tools/src/perf/gait-captures.ts <base> <out> --revisions=after --phases=move
 *
 * 12 subjects x {move, fire, moveFire} x {1.0, 2.5} x {before, after} = **96
 * PNGs**, plus a `sheet.md` index and a `sheet.json` of every number the run
 * read back off the running game.
 *
 * `tools/src/perf/wreck-captures.ts` is the precedent and this follows its
 * shape: a parade of side-0 copies on open ground, a camera centred on each
 * subject in turn, two zooms, one screenshot per cell. Read that file first.
 * Design: `docs/superpowers/specs/2026-09-15-infantry-gait-design.md` §6 --
 * "numbers settle whether the feet keep up; they do not settle whether it
 * looks right, and this project's own record is that the lead judges motion
 * on screen."
 *
 * ---
 *
 * ## Why the LIVE renderer and not `tools/render_clip_pose.py`
 *
 * That script exists, it renders a named clip at 1400 px, and five questions
 * on this branch were settled with it. It is the wrong instrument for THIS
 * sheet, for three reasons that are all about what it cannot express:
 *
 *  - **It frames the camera to the figure's own bounds**, so there is no such
 *    thing as "gameplay zoom" in it. The spec asks for the pose at the size a
 *    player actually sees and again at the top of `main.ts`'s 0.35-2.5 clamp;
 *    only the real camera has those.
 *  - **It renders through `render_rig.py`, the SPRITE rig** -- Cycles, the
 *    gate's AMBIENT tuning, palette materials repainted from the team
 *    registry. The shipping renderer is a lit three.js scene with a side sun,
 *    ACES tone mapping, a shadow box, an occlusion outline and role ramps.
 *    A pose judged in one is not the picture the other draws.
 *  - **It cannot show D4 at all.** Half of what this milestone did is
 *    `gaitTimeScale` (`three/units/mesh-anim.ts`), which is a RUNTIME
 *    playback rate. A Blender render of a clip has no playback rate in it.
 *
 * ## How "before" gets into a running dev server without touching the tree
 *
 * By intercepting the fetch. `meshUrl` serves `<BASE>meshes/<file>` out of
 * Vite's `publicDir`, so every GLB the game loads arrives over HTTP as
 * `/meshes/<name>` -- and `page.route` can answer those requests from
 * `git show <fork>:assets/meshes/<name>` instead. Nothing is written into
 * `art/` or `assets/`, so a concurrent session's `git status` is untouched
 * and the running server (which belongs to the project lead) never restarts.
 *
 * `--rev` defaults to `git merge-base HEAD main`, which is literally "this
 * branch's fork point" -- NOT `main`, which has moved since. It happens to
 * make no difference today (no mesh changed on main since the fork, checked)
 * and it would be wrong by construction the first day it did.
 *
 * **The interception is checked rather than assumed.** Every `/meshes/`
 * response is recorded with its byte length, and a `before` run that did not
 * serve a single file whose length differs from what is on disk right now
 * throws: a route pattern that silently stops matching would otherwise
 * produce a "before" sheet that is a second copy of "after", and the two look
 * exactly as different as the art does.
 *
 * ## The phase problem, and why the sheet pins a FRACTION rather than a time
 *
 * A still cannot show cadence. What it can show is stride, lean, knee drive
 * and where the figure is pointing -- and all four depend on WHERE IN THE
 * CYCLE the shutter opens. Two traps here, both avoided deliberately:
 *
 *  - Photographing both revisions after the same elapsed time is not the same
 *    phase, because the whole point of D4 is that the after-art plays at
 *    1.02x-2.65x. The same 200 ms lands at 30% of the cycle before and at up
 *    to 78% after, so a "before/after" pair would differ by the shutter as
 *    much as by the art.
 *  - Guessing the phase from the declared `rl_gait` and the unit's speed is a
 *    recomputation of exactly what the renderer just computed, and this
 *    project has been bitten by that shape repeatedly (`__lions.cursorKey()`
 *    reads the DOM attribute back for the same reason).
 *
 * So the harness READS the phase off the playing `AnimationAction` -- `time`
 * against `getClip().duration`, the truth the mixer is actually holding --
 * solves for the presentation time that lands on `PHASE_FRACTION`, spends it
 * in one zero-TICK frame, and reads the phase back to confirm. Both revisions
 * are photographed at the same fraction of their own cycle, which is the
 * comparison that means something for stride amplitude.
 *
 * One honest limitation, stated rather than hidden: for the six rigs D2
 * rebound, `move` is a DIFFERENT SOURCE CLIP before and after (a supplied
 * walk against a supplied run), so a shared fraction is a convention, not a
 * correspondence. For the ten `kit.py` teams D3 rescaled, it is a real
 * correspondence -- same authored sinusoid, same 16-frame cycle, larger
 * amplitude.
 *
 * ## Three things about the scene
 *
 * **The frame loop is killed at boot** (`FREEZE_FRAME_LOOP_SCRIPT`, shared
 * with the visual gate rather than reimplemented). Nothing paints between an
 * evaluate and a screenshot, which is what the golden gate learned the hard
 * way at a 28% false-red rate -- and here it also means `firingTimer` cannot
 * drain out from under a capture of the `fire` pose.
 *
 * **The target is a side-1 `digger_crew`**, and the choice is load-bearing.
 * It is the only enemy-faction unit type in the game with an empty `weapons`
 * array, so it never shoots back and no subject is lost mid-sheet;
 * `selectTarget` refuses side 2 outright ("civilians are never targets"), so
 * a civilian could not have done the job. It is also one of the four
 * gait-exempt files this branch never touched, so it is an unchanged control
 * standing in the frame of every firing capture.
 *
 * ## Two rules about the ENVIRONMENT, both of which cost a run
 *
 * **Nothing this script writes may land inside the repository while it is
 * running, and that is why the default output directory is outside the tree.**
 * The dev server is Vite with a file watcher over the workspace, and
 * `vite-plugin-asset-watch.ts` deliberately widens it to the asset
 * directories. A file event reloads the page — which is the feature that
 * makes a new GLB show up without a restart, and which wipes `window.__lions`
 * mid-capture. Measured the hard way: a first full run stalled through its
 * whole 300 s mesh wait and then died on `Cannot read properties of undefined
 * (reading 'step')`, because the harness was writing its own PNGs into
 * `.superpowers/` inside the worktree and reloading the page it was
 * photographing, once per screenshot. The default `out` is the session
 * scratchpad; pass a second positional argument to override it, and if you
 * point it back inside the tree, expect this.
 *
 * **HMR keeps working; its RELOAD is removed.** Vite's own client module is
 * served through this harness with its three `location.reload()` calls
 * rewritten to a console warning, so a file event anywhere — yours, another
 * session's, the lead's — can no longer send the page back to tick 0 with
 * `window.__lions` gone. Rule one keeps this harness from causing an event;
 * rule two keeps somebody else's event from mattering.
 *
 * **Two simpler approaches were tried first and both are worse.** Aborting
 * the client outright breaks the app: every module Vite transforms imports
 * it, so the module graph never resolves and `__lions` never appears — a 90 s
 * boot timeout, which is what the fail-fast path is for. And blocking only
 * the HMR websocket is worse than nothing: the client reads a lost socket as
 * a restarting server, polls for it, and reloads the instant it answers.
 * Verified by touching a file under `packages/app/src/` mid-run: the warning
 * appears in the log, the sim keeps its tick count, and the run finishes.
 *
 * ## It dies naming the frame it died on
 *
 * Every `waitForFunction`, every navigation and every wait here is bounded,
 * and a timeout reports the revision, the phase, the unit and the clip that
 * was in flight before exiting non-zero. The first version hung for ten
 * minutes with an empty log, which tells nobody anything.
 *
 * **No `page.evaluate` callback here assigns a function to a name**, and that
 * is a constraint rather than a style. `tsx` compiles with esbuild's
 * `keepNames`, which rewrites `const f = () => {}` into `__name(f, "f")` --
 * a helper that exists in the Node module scope and not in the page. Every
 * such callback dies in the browser with `ReferenceError: __name is not
 * defined`, naming nothing useful. Anonymous arrows passed straight to
 * `findIndex`/`filter` are untouched, which is why they are everywhere below
 * and named local helpers are nowhere.
 *
 * **Each subject gets its own lane and its own target**, 3 tiles apart along
 * a row that is open end to end (rows 0-7 of `beit_sahwan_outskirts`). A
 * subject's own target is 5 tiles away and a neighbour's is 5.83, and
 * `selectTarget` breaks ties by distance, so nobody shoots across lanes. The
 * one exception is `charge_squad`, whose weapon reaches 1.1 tiles and whose
 * target therefore stands at 1. The lanes start at x=6 rather than at the
 * map's own corner: the close crop at the top of the zoom band is only
 * 600x400, and a subject at x=1 spends half of it looking at the black
 * off-map wedge.
 */
import { chromium, type Page, type Route } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FREEZE_FRAME_LOOP_SCRIPT, REPAINT_SCRIPT } from '../golden-diff/capture-protocol';

// ---------------------------------------------------------------- the sheet

/** The two ends the spec names. 1.0 is `ThreeRenderer`'s own initial
 *  `camera.zoom` -- what a player gets before touching the wheel -- and 2.5
 *  is the top of the band `main.ts` clamps to. */
const ZOOMS = [1.0, 2.5] as const;

/** The browser viewport, and therefore the gameplay-zoom frame. Matches the
 *  visual gate's own `CAPTURE_VIEWPORT` so the two sheets are the same size
 *  of picture. */
const VIEWPORT = { width: 1400, height: 900 } as const;

/**
 * The close look is a CROP, not a second render.
 *
 * At the top of the zoom band a rifleman is about 60 px tall in a 1400x900
 * frame -- better than the 25 px that stopped two facing questions being
 * settled by eye on this branch, and still not a look at a pose. Raising
 * `deviceScaleFactor` would fix that and would also turn a 96-image sheet
 * into some hundreds of megabytes. Cropping costs nothing and does the same
 * job for a reader: an image this size fills a viewer that the full frame
 * only fits into, so the figure arrives about 2.3x larger, with the HUD and
 * two thirds of the empty desert gone. The gameplay-zoom cell stays the
 * whole uncropped frame, HUD included, because that one IS the honest
 * answer to "what does a player see".
 *
 * Centred on `renderer.worldToScreen`, asked of the renderer rather than
 * recomputed from `TILE_W`/`TILE_H` -- the projection is the camera's
 * business and a second copy of the arithmetic drifts silently.
 */
const CLOSE_CROP = { width: 600, height: 400 } as const;
/** `worldToScreen` answers with the tile the FEET stand on, and a figure is
 *  drawn upward from there, so a crop centred on that point puts the head at
 *  the halfway line and three quarters of the picture under the boots. */
const CLOSE_CROP_LIFT_PX = 50;

/** Where in its own cycle every figure is photographed.
 *
 *  0.25 rather than 0: `rig.py`'s `build_move_clip` authors thigh swing as a
 *  pure sinusoid starting at zero, so phase 0 is feet-together -- the one
 *  pose in the cycle that shows nothing about stride length, which is most of
 *  what D3 changed. A quarter of the way in is the forward extension. */
const PHASE_FRACTION = 0.25;

/** How close to `PHASE_FRACTION` counts as arrived, as a fraction of cycle. */
const PHASE_TOLERANCE = 0.02;
/**
 * Milliseconds of `firingTimer` left unspent when hunting the phase of a
 * FIRING pose.
 *
 * Pumping the presentation clock drains that latch exactly as a real frame
 * would, and the frame it reaches zero on is the frame `resolveClip` stops
 * answering `fire` -- so an unbounded hunt would quietly photograph `idle`
 * and label it `fire`. The hunt is therefore budgeted against the latch the
 * shot actually set, with this much held back. There is no equivalent bound
 * on the `move` phase because nothing there expires.
 */
const FIRE_HOLD_MARGIN_MS = 60;

/** Ticks to wait for a subject's first shot. The slowest weapon in the sheet
 *  is `at_team`'s Spike at 3 rounds a minute -- one shot per 20 s, or 400
 *  ticks -- so this is 1.5 of its reload with margin. */
const FIRE_WAIT_TICKS = 700;
/**
 * Ticks per `__lions.step()` call while waiting for a shot, and the reason is
 * cost.
 *
 * `step(n)` runs n ticks and then ONE `renderer.frame`, and under SwiftShader
 * a frame at 1400x900 is the expensive thing in this harness by two orders of
 * magnitude -- 700 calls to `step(1)` is 700 full renders to watch for one
 * muzzle flash. Batching is free of consequence here because `firingTimer` is
 * drained ONLY by a frame, never by a tick: a latch set on any tick of the
 * batch is still standing when the batch's single frame has taken 16 ms off
 * it. The only thing a batch costs is resolution on WHICH tick the shot
 * landed, and nothing in this sheet reads that.
 */
const FIRE_BATCH_TICKS = 10;

/**
 * How long to wait for a subject's GLB before photographing an empty tile.
 *
 * Most of this parade is not on any sandbox roster, so twelve meshes arrive
 * through `main.ts`'s 1 Hz safety sweep and then have to be parsed, Draco-
 * decoded and skinned on a page already spending most of its time in a
 * software rasteriser. Measured here: the last four of twelve were still
 * absent at two minutes. The wait is also re-checked PER SUBJECT immediately
 * before its capture rather than only once up front, because a sheet whose
 * last four rows are pictures of empty ground is worse than a slow one, and
 * the only thing that distinguishes them is knowing to look.
 */
const MESH_WAIT_MS = 300000;
/** Ticks after a move order before anything is photographed: long enough for
 *  every subject to be up to speed and past `applyMeshClip`'s switch, short
 *  enough that the slowest (`sniper_team`, 0.45 tiles/s) has not arrived. */
const MOVE_SETTLE_TICKS = 40;

/** One row of the parade. */
interface Subject {
  /** The sim unit type, and the sheet's own key. */
  readonly id: string;
  /** Lane centre, in tiles. Subjects stand at `y = SUBJECT_Y`. */
  readonly x: number;
  /** How many bodies to spawn. Only `civilians` wants more than one: it is a
   *  single unit TYPE with four mesh VARIANTS chosen by `entity id % 4`
   *  (`three/units/mesh-variant.ts`), so four consecutive spawns are the only
   *  way to get all four into one frame. */
  readonly bodies: number;
  /** Tiles between this subject and its own target, chosen from its weapon's
   *  own `range_tiles` in `data/units/`. `null` means "no `fire` clip in the
   *  GLB, so there is nothing to photograph" -- `civilians` (unarmed) and
   *  `yahalom_squad` (armed in the sim, but `yahalom_engineer.glb` ships
   *  `idle`/`move`/`down`/`work`/`wreck` and no `fire`, which is a finding in
   *  its own right and is printed on the passing path). */
  readonly fireRange: number | null;
  /** Whether this GLB carries a `moveFire` clip. Only two do, and both are
   *  §4a's subject: `sarim_rifles` had its walk-and-shoot resynthesised from
   *  the run, and `inf_squad` gained the clip outright (before, it has none,
   *  so its `moveFire` cell photographs `resolveMeshMotionClip`'s fallback to
   *  `fire` -- which is exactly what shipped). */
  readonly moveFire: boolean;
}

/** Twelve lanes, 4 tiles apart, on a row that is open end to end. A target
 *  stands in its own subject's lane, `fireRange` tiles nearer the top edge. */
const SUBJECT_Y = 7;

const SUBJECTS: readonly Subject[] = [
  { id: 'inf_squad', x: 6, bodies: 1, fireRange: 5, moveFire: true },
  { id: 'sarim_rifles', x: 9, bodies: 1, fireRange: 5, moveFire: true },
  { id: 'militia_cell', x: 12, bodies: 1, fireRange: 5, moveFire: false },
  { id: 'mortar_team', x: 15, bodies: 1, fireRange: 5, moveFire: false },
  { id: 'at_team', x: 18, bodies: 1, fireRange: 5, moveFire: false },
  { id: 'rpg_team', x: 21, bodies: 1, fireRange: 4, moveFire: false },
  { id: 'demo_squad', x: 24, bodies: 1, fireRange: 5, moveFire: false },
  { id: 'breach_team', x: 27, bodies: 1, fireRange: 4, moveFire: false },
  { id: 'sniper_team', x: 30, bodies: 1, fireRange: 5, moveFire: false },
  { id: 'charge_squad', x: 33, bodies: 1, fireRange: 1, moveFire: false },
  { id: 'yahalom_squad', x: 36, bodies: 1, fireRange: null, moveFire: false },
  // Last, because four bodies need four tiles and the lane pitch is three.
  // Nothing stands to its right, so it spills into empty ground.
  { id: 'civilians', x: 39, bodies: 4, fireRange: null, moveFire: false },
];

/** Unarmed, enemy-faction, human-scale, and unchanged by this milestone --
 *  see the header for why all four matter. */
const TARGET_TYPE = 'digger_crew';

// ------------------------------------------------------------ browser types

interface GaitAction {
  time: number;
  timeScale: number;
  getClip(): { duration: number };
}

interface GaitEntity {
  currentClip: string | null;
  actions: Map<string, GaitAction>;
}

/**
 * The window surface this harness drives.
 *
 * `firingTimer`, `entitySpeed` and `meshUnitEntities` are `private` on
 * `ThreeRenderer` and are read here anyway, deliberately: `firingTimer` is
 * the array `updateMeshUnits` itself consults to decide `fire`, and the
 * action's own `time`/`timeScale` are what the mixer is actually holding. A
 * harness that waited on anything else would be waiting on a proxy for the
 * thing it is photographing. Structurally typed rather than cast, so this
 * file stays inside the tree's no-`any` rule and a rename over in the
 * renderer surfaces here as a `undefined is not a function` on the first run
 * rather than as a silently wrong sheet.
 */
interface LionsWindow {
  __lions: {
    step(n: number): number;
    renderer: {
      camera: { x: number; y: number; zoom: number };
      frame(alpha: number, dtMs: number): void;
      worldToScreen(x: number, y: number): { x: number; y: number };
      firingTimer: Float64Array;
      entitySpeed: Float64Array;
      meshUnitEntities: Map<number, GaitEntity>;
    };
    sim: {
      tickCount: number;
      entityCount: number;
      unitTypes: { id: string }[];
      state: { alive: Int8Array | Uint8Array; posX: Int32Array; posY: Int32Array };
      spawn(typeIdx: number, side: number, x: number, y: number): number;
      removeFromPlay(id: number): void;
      queueCommand(cmd: { kind: string; ids: number[]; x?: number; y?: number }): void;
    };
  };
}

// ------------------------------------------------------------------- args

function arg(name: string, fallback: string): string {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
/** The dev server. IPv6 loopback by default because that is what a bare
 *  `vite` binds here (`[::1]:5178`), and `127.0.0.1` gets connection
 *  refused against it. */
const base = positional[0] ?? 'http://localhost:5178';
/**
 * Where the sheet lands. **Outside the repository by default** -- see the
 * header: a write inside the tree reloads the page this harness is
 * photographing. `CLAUDE_SCRATCHPAD` if the session exports one, else the OS
 * temp directory; a second positional argument overrides it, and moving the
 * finished directory into the tree afterwards is safe because the browser is
 * closed by then.
 */
const out =
  positional[1] ??
  path.join(process.env.CLAUDE_SCRATCHPAD ?? os.tmpdir(), 'gait-captures');
const only = arg('only', '');
const tag = arg('tag', '');
const phases = arg('phases', 'fire,movefire,move').split(',');
const revisions = arg('revisions', 'before,after').split(',');
const phaseTarget = Number(arg('phase', String(PHASE_FRACTION)));

const repo = process.cwd();
function git(args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}
/** The fork point, not `main`. See the header. */
const rev = arg('rev', '') || git(['merge-base', 'HEAD', 'main']);

fs.mkdirSync(out, { recursive: true });

const wanted = only ? SUBJECTS.filter((s) => s.id === only) : SUBJECTS;
if (wanted.length === 0) throw new Error(`--only=${only} names no subject in the parade`);

// --------------------------------------------------------------- the run

interface Cell {
  subject: string;
  revision: string;
  phase: string;
  zoom: number;
  /** The clip the renderer was ACTUALLY playing when the shutter opened --
   *  read back, never assumed. A `moveFire` cell that reads `fire` is the
   *  before-art having no such clip, and that is information. */
  clip: string | null;
  /** `action.timeScale`, i.e. what `gaitTimeScale` handed the mixer. 1 on
   *  every before-art cell by construction (no `rl_gait` in those bytes). */
  timeScale: number;
  /** Where in its own cycle the figure was caught, as a fraction. */
  cyclePhase: number;
  /** `ThreeRenderer.entitySpeed`, tiles/s, measured off the last tick. */
  speedTiles: number;
  file: string;
}

const cells: Cell[] = [];
const notes: string[] = [];

/**
 * What the harness is doing right now, in words, for the failure path.
 *
 * Kept as a plain string updated at every step rather than reconstructed from
 * a stack: the first version of this script hung for ten minutes and then died
 * on `Cannot read properties of undefined (reading 'step')` inside a
 * `page.evaluate`, and neither the message nor the stack said which unit, which
 * clip or which revision was in the frame. This does.
 */
let inFlight = 'startup';

/** Every wait in this harness is bounded by this. A capture that cannot make
 *  progress must say so and stop, not sit. */
const STEP_TIMEOUT_MS = 90000;

function bail(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`\nFAILED while: ${inFlight}\n  ${message}`);
  if (message.includes("reading 'step'") || message.includes('__lions')) {
    console.error(
      '  `window.__lions` went missing, which means the PAGE RELOADED. Something wrote\n' +
        '  into a directory the dev server watches. This harness strips HMR`s reload and\n' +
        '  writes its output outside the tree; check what else navigated the page.'
    );
  }
  writeIndex();
  process.exitCode = 1;
  process.exit(1);
}

/** Every `/meshes/` response, with the byte length that actually arrived. */
const served: { revision: string; file: string; bytes: number; fromRev: boolean }[] = [];

function diskBytes(file: string): number | null {
  const p = path.join(repo, 'assets/meshes', file);
  return fs.existsSync(p) ? fs.statSync(p).size : null;
}

/** `git show <rev>:assets/meshes/<file>`, or `null` if that path did not
 *  exist at that revision (a mesh added on this branch -- there are none
 *  today, and falling through rather than 404ing is the right answer if
 *  there ever are). */
const revCache = new Map<string, Buffer | null>();
function revBytes(file: string): Buffer | null {
  const hit = revCache.get(file);
  if (hit !== undefined) return hit;
  let bytes: Buffer | null = null;
  try {
    bytes = execFileSync('git', ['-C', repo, 'show', `${rev}:assets/meshes/${file}`], {
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch {
    bytes = null;
  }
  revCache.set(file, bytes);
  return bytes;
}

console.log(
  `base ${base}, out ${out}, rev ${rev.slice(0, 7)}` +
    `${only ? `, only ${only}` : ''}${tag ? `, tag ${tag}` : ''}\n` +
    `revisions [${revisions.join(', ')}], phases [${phases.join(', ')}], ` +
    `zooms [${ZOOMS.join(', ')}], phase fraction ${phaseTarget}`
);

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

try {
  for (const revision of revisions) {
    if (revision !== 'before' && revision !== 'after') {
      throw new Error(`--revisions: "${revision}" is neither "before" nor "after"`);
    }
    await captureRevision(revision);
  }
} catch (err) {
  await browser.close().catch(() => undefined);
  bail(err);
}

await browser.close();
writeIndex();
console.log(`done -- ${cells.length} PNG(s) under ${out}`);

// --------------------------------------------------------------- functions

async function captureRevision(revision: 'before' | 'after'): Promise<void> {
  inFlight = `${revision}: opening a page`;
  const page: Page = await browser.newPage({
    viewport: { width: VIEWPORT.width, height: VIEWPORT.height },
    deviceScaleFactor: 1,
  });
  page.setDefaultTimeout(STEP_TIMEOUT_MS);
  page.setDefaultNavigationTimeout(STEP_TIMEOUT_MS);
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('no mesh queued') || text.includes('rl_gait')) console.log('  page:', text);
  });
  page.on('pageerror', (err) => console.log('  page error:', err.message));

  // HMR keeps working; its RELOAD does not. See the header for the two
  // approaches that do NOT work and why.
  await page.route('**/@vite/client**', async (r) => {
    const response = await r.fetch();
    const body = (await response.text()).replaceAll(
      'location.reload()',
      'console.warn("[gait-captures] suppressed an HMR page reload")'
    );
    await r.fulfill({ response, body, headers: { 'content-type': 'text/javascript' } });
  });

  // Second belt: if the page navigates anyway, say so loudly rather than
  // letting the next `page.evaluate` report a missing property.
  let loads = 0;
  page.on('load', () => {
    loads += 1;
    if (loads > 1) console.warn(`  ${revision}: PAGE RELOADED (load #${loads}) -- ${inFlight}`);
  });

  // The whole of "before". Registered before `goto`, so the very first GLB
  // the boot sequence asks for already comes from the fork point.
  await page.route('**/meshes/**', async (route: Route) => {
    const url = new URL(route.request().url());
    const file = url.pathname.split('/meshes/')[1] ?? '';
    if (!file.endsWith('.glb')) {
      await route.continue();
      return;
    }
    if (revision === 'after') {
      await route.continue();
      served.push({ revision, file, bytes: diskBytes(file) ?? 0, fromRev: false });
      return;
    }
    const body = revBytes(file);
    if (!body) {
      notes.push(`${file} does not exist at ${rev.slice(0, 7)} -- served from disk instead`);
      await route.continue();
      served.push({ revision, file, bytes: diskBytes(file) ?? 0, fromRev: false });
      return;
    }
    served.push({ revision, file, bytes: body.length, fromRev: true });
    await route.fulfill({ status: 200, contentType: 'model/gltf-binary', body });
  });

  inFlight = `${revision}: loading ${base}/?sandbox=beit_sahwan_outskirts`;
  await page.goto(`${base}/?sandbox=beit_sahwan_outskirts`, {
    waitUntil: 'load',
    timeout: STEP_TIMEOUT_MS,
  });
  inFlight = `${revision}: waiting for window.__lions`;
  await page.waitForFunction(() => !!(window as unknown as LionsWindow).__lions?.renderer, null, {
    timeout: STEP_TIMEOUT_MS,
  });
  // Kill the frame loop before anything else, exactly as the visual gate
  // does: after this, nothing paints unless this harness asks it to.
  inFlight = `${revision}: freezing the frame loop`;
  await page.evaluate(FREEZE_FRAME_LOOP_SCRIPT);

  inFlight = `${revision}: spawning the parade`;
  const placed = await spawnParade(page);
  console.log(
    `${revision}: spawned ${placed.subjects.map((s) => `${s.id}#${s.ids.join('/')}`).join(' ')}`
  );

  inFlight = `${revision}: waiting for every subject's mesh to load`;
  await waitForMeshes(page, placed.subjects.flatMap((s) => s.ids), revision);

  if (phases.includes('fire')) await capturePhase(page, placed, revision, 'fire');
  if (phases.includes('movefire')) await capturePhase(page, placed, revision, 'moveFire');
  if (phases.includes('move')) await capturePhase(page, placed, revision, 'move');

  if (loads > 1) {
    throw new Error(
      `the page reloaded ${loads - 1} time(s) during the "${revision}" pass, so some of ` +
        `what it photographed is not what it thinks -- discard this run`
    );
  }
  await page.close();
  assertRevisionWasServed(revision);
}

interface PlacedSubject {
  id: string;
  ids: number[];
  target: number | null;
  /** The tile row that subject's target stands on, so a replacement can be
   *  put back exactly where the dead one was. */
  targetY: number;
}
interface Placed {
  subjects: PlacedSubject[];
}

async function spawnParade(page: Page): Promise<Placed> {
  return page.evaluate(
    ([rows, targetType, subjectY]) => {
      const L = (window as unknown as LionsWindow).__lions;
      // Q16.16: `Sim.spawn` takes fixed-point tiles, and a raw tile number
      // reaches it as 5/65536 of a tile -- i.e. the map's corner, silently.
      const FIXED = 65536;
      const subjects: PlacedSubject[] = [];
      for (const row of rows) {
        const typeIdx = L.sim.unitTypes.findIndex((t) => t.id === row.id);
        if (typeIdx < 0) throw new Error(`no unit type "${row.id}" in this build`);
        const ids: number[] = [];
        for (let b = 0; b < row.bodies; b++) {
          ids.push(L.sim.spawn(typeIdx, 0, (row.x + b) * FIXED, subjectY * FIXED));
        }
        // `fireRange` is measured up the lane from the subject's own row.
        const targetY = subjectY - (row.fireRange ?? 0);
        let target: number | null = null;
        if (row.fireRange !== null) {
          const targetIdx = L.sim.unitTypes.findIndex((t) => t.id === targetType);
          if (targetIdx < 0) throw new Error(`no unit type "${targetType}" in this build`);
          target = L.sim.spawn(targetIdx, 1, row.x * FIXED, targetY * FIXED);
        }
        subjects.push({ id: row.id, ids, target, targetY });
      }
      return { subjects };
    },
    [
      wanted.map((s) => ({ id: s.id, x: s.x, bodies: s.bodies, fireRange: s.fireRange })),
      TARGET_TYPE,
      SUBJECT_Y,
    ] as const
  );
}

/**
 * Wait until every subject has an instantiated mesh entity with at least one
 * action on it.
 *
 * A READ of the renderer's own entity map rather than a sleep: most of these
 * types are not on this sandbox's roster, so their GLBs arrive through
 * `main.ts`'s 1 Hz safety sweep (which is tick-driven, and therefore still
 * runs with the frame loop frozen) rather than through the loader, and how
 * long that takes depends on the wire.
 */
async function waitForMeshes(page: Page, ids: number[], revision: string): Promise<void> {
  const deadline = Date.now() + MESH_WAIT_MS;
  let first = true;
  for (;;) {
    // `step` ONLY when something is still missing. A poll that ticks the sim
    // unconditionally is not free here: it is called once per subject, and in
    // the walking half of the sheet twelve free seconds of sim is enough for
    // `charge_squad` (1.9 tiles/s) to reach its goal, stop, and be
    // photographed standing still in the cell that is supposed to show it
    // running.
    const missing = await page.evaluate(
      ([want, tick]) => {
        const L = (window as unknown as LionsWindow).__lions;
        if (tick) L.step(20);
        const out: number[] = [];
        for (const id of want) {
          const e = L.renderer.meshUnitEntities.get(id);
          if (!e || e.actions.size === 0) out.push(id);
        }
        return out;
      },
      [ids, !first] as const
    );
    first = false;
    if (missing.length === 0) return;
    if (Date.now() > deadline) {
      notes.push(`${revision}: entities ${missing.join(', ')} never got a mesh -- captured anyway`);
      console.warn(
        `  ${revision}: no mesh for entities ${missing.join(', ')} after ${MESH_WAIT_MS / 1000} s`
      );
      return;
    }
    await page.waitForTimeout(400);
  }
}

async function capturePhase(
  page: Page,
  placed: Placed,
  revision: 'before' | 'after',
  phase: 'fire' | 'moveFire' | 'move'
): Promise<void> {
  const rows = wanted.filter((s) => {
    if (phase === 'fire') return s.fireRange !== null;
    if (phase === 'moveFire') return s.moveFire;
    return true;
  });
  if (rows.length === 0) return;

  if (phase === 'move') {
    // Nothing left to shoot at, so nobody holds `fire`, so `resolveClip`
    // gives `move` to everything that is actually walking.
    //
    // `removeFromPlay`, not `debugKill`: a killed target leaves a persistent
    // `MeshWreck` on the ground, and every subject then walks over its own
    // victim's corpse for the whole walking half of the sheet. The sim's own
    // "take it off the board" write is the one that draws nothing -- see
    // `Sim.removeFromPlay`, and `ThreeRenderer`'s own removal branch, which
    // exists precisely so an abduction never draws as a death.
    await page.evaluate((entry) => {
      const L = (window as unknown as LionsWindow).__lions;
      for (const s of entry) if (s.target !== null) L.sim.removeFromPlay(s.target);
    }, placed.subjects);
  }

  if (phase === 'move' || phase === 'moveFire') {
    await page.evaluate(
      ([entry, ids]) => {
        const L = (window as unknown as LionsWindow).__lions;
        for (const s of entry) {
          if (!ids.includes(s.id)) continue;
          for (const id of s.ids) {
            // One order per body, never a group order: a group lands in
            // formation (`packages/sim/src/formation.ts`) and would shuffle
            // the four civilians off their own lane.
            L.sim.queueCommand({
              kind: 'move',
              ids: [id],
              x: L.sim.state.posX[id],
              y: 0,
            });
          }
        }
      },
      [placed.subjects, rows.map((r) => r.id)] as const
    );
    await page.evaluate((n) => (window as unknown as LionsWindow).__lions.step(n), MOVE_SETTLE_TICKS);
  }

  for (const row of rows) {
    const entry = placed.subjects.find((s) => s.id === row.id);
    if (!entry) continue;
    const subjectId = entry.ids[0];
    inFlight = `${revision} / ${phase} / ${row.id} (entity ${subjectId}): waiting for its mesh`;
    // Re-checked here and not only at boot -- see `MESH_WAIT_MS`.
    await waitForMeshes(page, entry.ids, `${revision}/${phase}/${row.id}`);

    let firingBudgetMs: number | null = null;
    if (phase === 'fire' || phase === 'moveFire') {
      inFlight = `${revision} / ${phase} / ${row.id} (entity ${subjectId}): waiting for a shot`;
      const got = await advanceUntilFiring(page, subjectId, entry, phase === 'moveFire');
      if (!got.firing) {
        notes.push(
          `${revision}/${phase}: ${row.id} never fired in ${FIRE_WAIT_TICKS} ticks ` +
            `-- photographed holding "${got.clip ?? 'nothing'}"`
        );
        console.warn(`  ${revision}/${phase}: ${row.id} never fired -- clip "${got.clip}"`);
      }
      firingBudgetMs = Math.max(0, got.latchMs - FIRE_HOLD_MARGIN_MS);
    }

    inFlight = `${revision} / ${phase} / ${row.id} (entity ${subjectId}): hunting phase ${phaseTarget}`;
    const hunted = await huntPhase(page, subjectId, phaseTarget, firingBudgetMs);
    if (!hunted.arrived) {
      notes.push(
        `${revision}/${phase}: ${row.id} held phase ${hunted.cyclePhase.toFixed(3)} rather than ` +
          `${phaseTarget}` +
          (firingBudgetMs === null
            ? ' -- a clip that does not advance'
            : ` -- only ${firingBudgetMs.toFixed(0)} ms of latch to spend`)
      );
    }

    for (const zoom of ZOOMS) {
      inFlight = `${revision} / ${phase} / ${row.id} (entity ${subjectId}): shooting at zoom ${zoom}`;
      const state = await frameOn(page, subjectId, zoom, row.bodies);
      const name = `${row.id}-${phase.toLowerCase()}-${revision}-z${zoom}${tag}.png`;
      // The top of the band is the close look, so it is cropped around the
      // subject; gameplay zoom is the whole frame, HUD included.
      const clip =
        zoom === Math.max(...ZOOMS)
          ? {
              x: Math.min(
                Math.max(0, state.screenX - CLOSE_CROP.width / 2),
                VIEWPORT.width - CLOSE_CROP.width
              ),
              y: Math.min(
                Math.max(0, state.screenY - CLOSE_CROP.height / 2 - CLOSE_CROP_LIFT_PX),
                VIEWPORT.height - CLOSE_CROP.height
              ),
              width: CLOSE_CROP.width,
              height: CLOSE_CROP.height,
            }
          : undefined;
      await page.screenshot({ path: path.join(out, name), ...(clip ? { clip } : {}) });
      cells.push({
        subject: row.id,
        revision,
        phase,
        zoom,
        clip: state.clip,
        timeScale: state.timeScale,
        cyclePhase: state.cyclePhase,
        speedTiles: state.speedTiles,
        file: name,
      });
      console.log(
        `  saved ${name}  clip=${state.clip} timeScale=${state.timeScale.toFixed(3)} ` +
          `phase=${state.cyclePhase.toFixed(3)} speed=${state.speedTiles.toFixed(3)}`
      );
      // A walking cell whose subject is standing still is a harness failure,
      // not a finding, and it is the one failure that looks entirely normal
      // in the picture.
      if (phase !== 'fire' && state.speedTiles === 0 && zoom === Math.min(...ZOOMS)) {
        notes.push(
          `${revision}/${phase}: ${row.id} was NOT MOVING when photographed ` +
            `(clip "${state.clip}") -- it reached its goal before the shutter opened`
        );
        console.warn(`  ${revision}/${phase}: ${row.id} was not moving -- clip "${state.clip}"`);
      }
    }
  }
}

/**
 * Step ticks, one at a time, until this subject's `firingTimer` latches --
 * and respawn its target if the subject killed it first.
 *
 * One `page.evaluate` for the whole loop rather than one per tick: 700 round
 * trips per subject is minutes of harness overhead for a sim step that costs
 * microseconds.
 */
async function advanceUntilFiring(
  page: Page,
  subjectId: number,
  entry: PlacedSubject,
  needMoving: boolean
): Promise<{ firing: boolean; clip: string | null; latchMs: number }> {
  return page.evaluate(
    ([id, target, targetY, moving, budget, type, batch]) => {
      const L = (window as unknown as LionsWindow).__lions;
      const FIXED = 65536;
      let current = target;
      let firing = false;
      for (let t = 0; t < budget; t += batch) {
        if (current !== null && L.sim.state.alive[current] !== 1) {
          // The subject shot its target dead before the shutter opened. A
          // fresh one on the tile the dead one held keeps the engagement
          // alive rather than ending the capture in `idle`.
          const idx = L.sim.unitTypes.findIndex((u) => u.id === type);
          current = L.sim.spawn(idx, 1, L.sim.state.posX[id], targetY * FIXED);
        }
        L.step(batch);
        if (L.renderer.firingTimer[id] > 0 && (!moving || L.renderer.entitySpeed[id] > 0)) {
          firing = true;
          break;
        }
      }
      const e = L.renderer.meshUnitEntities.get(id);
      return {
        firing,
        clip: e ? e.currentClip : null,
        latchMs: L.renderer.firingTimer[id] * 1000,
      };
    },
    [
      subjectId,
      entry.target,
      entry.targetY,
      needMoving,
      FIRE_WAIT_TICKS,
      TARGET_TYPE,
      FIRE_BATCH_TICKS,
    ] as const
  );
}

/**
 * Pump zero-TICK presentation frames until the subject's playing action sits
 * at `target` of its own cycle.
 *
 * `frame(1, ms)` advances every mixer, every particle age and every timer by
 * `ms` and advances the SIM by nothing, so the parade holds its positions
 * while the legs turn over. That is what makes the phase a free variable
 * rather than something the tick rate decides.
 */
async function huntPhase(
  page: Page,
  subjectId: number,
  target: number,
  budgetMs: number | null
): Promise<{ arrived: boolean; cyclePhase: number }> {
  return page.evaluate(
    ([id, want, tol, budget]) => {
      const L = (window as unknown as LionsWindow).__lions;
      const before = L.renderer.meshUnitEntities.get(id);
      const clip = before ? before.currentClip : null;
      const action = before && clip !== null ? before.actions.get(clip) : undefined;
      const duration = action ? action.getClip().duration : 0;
      if (!action || duration <= 0) return { arrived: false, cyclePhase: -1 };
      const now = (action.time % duration) / duration;
      // SOLVED, not stepped. `mixer.update(dt)` advances `action.time` by
      // `dt * timeScale`, and `applyGaitRate` recomputes the same
      // `timeScale` every frame from inputs this harness is holding still --
      // so the presentation time that lands exactly on `want` is arithmetic,
      // and ONE frame does it. Hunting it by repeated small pumps was the
      // first version and it cost 600 full renders per capture under
      // SwiftShader, which is the whole runtime of this harness.
      const scale = action.timeScale === 0 ? 1 : action.timeScale;
      const needMs = ((((want - now) % 1) + 1) % 1) * duration * 1000 / scale;
      const spend = budget !== null ? Math.min(needMs, budget) : needMs;
      L.renderer.frame(1, spend);
      const after = L.renderer.meshUnitEntities.get(id);
      const clipAfter = after ? after.currentClip : null;
      const check = after && clipAfter !== null ? after.actions.get(clipAfter) : undefined;
      const durAfter = check ? check.getClip().duration : 0;
      const landed = check && durAfter > 0 ? (check.time % durAfter) / durAfter : -1;
      // Read back rather than trusting the arithmetic: a clip that switched
      // under us (a latch that expired inside `spend`) lands somewhere else
      // entirely, and the sheet should say so rather than claim the phase it
      // asked for.
      const arrived = landed >= 0 && Math.abs(((landed - want + 1.5) % 1) - 0.5) <= tol;
      return { arrived, cyclePhase: landed };
    },
    [subjectId, target, PHASE_TOLERANCE, budgetMs] as const
  );
}

/** Centre the camera on the subject and repaint with ZERO elapsed
 *  presentation time, so the two zooms of one cell are the same instant of
 *  the same pose rather than two frames a few milliseconds apart. */
async function frameOn(
  page: Page,
  subjectId: number,
  zoom: number,
  bodies: number
): Promise<{
  clip: string | null;
  timeScale: number;
  cyclePhase: number;
  speedTiles: number;
  screenX: number;
  screenY: number;
}> {
  const state = await page.evaluate(
    ([id, z, n]) => {
      const L = (window as unknown as LionsWindow).__lions;
      const FIXED = 65536;
      const c = L.renderer.camera;
      const wx = L.sim.state.posX[id] / FIXED;
      const wy = L.sim.state.posY[id] / FIXED;
      // Centre on the GROUP, not the first body: `civilians` is four
      // entities in a row and the sheet is meant to show all four variants.
      c.x = wx + (n - 1) / 2;
      c.y = wy;
      c.zoom = z;
      const e = L.renderer.meshUnitEntities.get(id);
      const clip = e ? e.currentClip : null;
      const a = e && clip !== null ? e.actions.get(clip) : undefined;
      const duration = a ? a.getClip().duration : 0;
      const screen = L.renderer.worldToScreen(wx, wy);
      return {
        clip,
        timeScale: a ? a.timeScale : 0,
        cyclePhase: a && duration > 0 ? (a.time % duration) / duration : -1,
        speedTiles: L.renderer.entitySpeed[id],
        screenX: screen.x,
        screenY: screen.y,
      };
    },
    [subjectId, zoom, bodies] as const
  );
  await page.evaluate(REPAINT_SCRIPT);
  return state;
}

/**
 * The check that the `before` pass was actually before.
 *
 * A `page.route` glob that stops matching -- a base path change, a query
 * string, a move off `publicDir` -- would hand this harness the CURRENT art
 * twice and label half of it "before". Nothing about the resulting sheet
 * would look wrong; it would simply show no change. So the run refuses to
 * finish unless at least one intercepted file differs in length from what is
 * on disk right now.
 */
function assertRevisionWasServed(revision: 'before' | 'after'): void {
  if (revision !== 'before') return;
  const mine = served.filter((s) => s.revision === 'before');
  const fromRev = mine.filter((s) => s.fromRev);
  const differing = fromRev.filter((s) => {
    const disk = diskBytes(s.file);
    return disk !== null && disk !== s.bytes;
  });
  console.log(
    `  before: ${mine.length} mesh response(s), ${fromRev.length} served from ${rev.slice(0, 7)}, ` +
      `${differing.length} of a different length than the working tree`
  );
  if (differing.length === 0) {
    throw new Error(
      `the "before" pass served nothing that differs from the working tree -- ` +
        `either the route stopped matching /meshes/, or ${rev.slice(0, 7)} is not a fork point ` +
        `with different art. Refusing to write a sheet whose two halves are the same bytes.`
    );
  }
}

/** The sheet's own index: a markdown table pairing before with after, and
 *  the JSON every number came from. Written last so a partial run still
 *  leaves whatever it captured on disk. */
function writeIndex(): void {
  const byKey = new Map<string, Cell[]>();
  for (const c of cells) {
    const k = `${c.subject}|${c.phase}|${c.zoom}`;
    const list = byKey.get(k) ?? [];
    list.push(c);
    byKey.set(k, list);
  }
  const lines: string[] = [
    `# Infantry gait capture sheet`,
    ``,
    `Revision \`before\` is \`${rev}\` (this branch's fork point), served into the running`,
    `dev server by request interception; \`after\` is the working tree. Both are the live`,
    `three.js renderer at ${VIEWPORT.width}x${VIEWPORT.height}, frame loop frozen, every`,
    `figure photographed at ${phaseTarget} of its own animation cycle.`,
    ``,
    `The \`z${Math.min(...ZOOMS)}\` cells are the whole frame at the camera's own default`,
    `zoom -- what a player sees, HUD included. The \`z${Math.max(...ZOOMS)}\` cells are the`,
    `top of \`main.ts\`'s 0.35-2.5 clamp, cropped to ${CLOSE_CROP.width}x${CLOSE_CROP.height}`,
    `around the subject so the pose is legible.`,
    ``,
    `\`timeScale\` is read off the playing \`AnimationAction\` -- what \`gaitTimeScale\``,
    `handed the mixer. It is 1.000 on every \`before\` row by construction: those bytes`,
    `carry no \`rl_gait\`, and a mesh without one gets exactly today's behaviour.`,
    ``,
    `| subject | phase | zoom | before | after | clip (before/after) | timeScale (before/after) |`,
    `|---|---|---|---|---|---|---|`,
  ];
  for (const [k, list] of [...byKey].sort()) {
    const [subject, phase, zoom] = k.split('|');
    const b = list.find((c) => c.revision === 'before');
    const a = list.find((c) => c.revision === 'after');
    lines.push(
      `| \`${subject}\` | ${phase} | ${zoom} | ${b ? `\`${b.file}\`` : '—'} | ` +
        `${a ? `\`${a.file}\`` : '—'} | ${b?.clip ?? '—'} / ${a?.clip ?? '—'} | ` +
        `${b ? b.timeScale.toFixed(3) : '—'} / ${a ? a.timeScale.toFixed(3) : '—'} |`
    );
  }
  if (notes.length > 0) {
    lines.push(``, `## Notes the run printed`, ``);
    for (const n of notes) lines.push(`- ${n}`);
  }
  fs.writeFileSync(path.join(out, `sheet${tag}.md`), lines.join('\n') + '\n');
  fs.writeFileSync(
    path.join(out, `sheet${tag}.json`),
    JSON.stringify({ rev, base, phaseTarget, zooms: ZOOMS, cells, served, notes }, null, 2) + '\n'
  );
  console.log(`index at ${path.join(out, `sheet${tag}.md`)}`);
}
