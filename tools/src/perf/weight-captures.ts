/**
 * The vehicle-weight contact sheet: ten seconds of motion around a start, a
 * stop and a turn, before and after WP-A1.3 art change
 * (`docs/superpowers/specs/2026-09-20-art-vehicle-weight-design.md`, Decisions
 * R-G, R-P, R-Q).
 *
 *   pnpm weight:capture -- --label=before
 *   pnpm weight:capture -- --label=after --only=mbt_lavi
 *
 * R-G is why this file exists at all: the golden visual gate cannot see
 * motion, and R-Q spells out why the layer-toggle A/B `blast-captures.ts`
 * inherited from `debug-layers.ts` cannot either -- there is no layer to
 * hide, because the hull draws whether or not it leans, lags or settles. This
 * sheet, and the numeric readback beside it, are the package's only witness.
 *
 * ## This is a retarget of `blast-captures.ts`, not a new instrument
 *
 * Three behaviours are INHERITED verbatim, each paid for once already:
 *
 * 1. **The frame loop is frozen with `FREEZE_FRAME_LOOP_SCRIPT`**, never a
 *    `sleep()`. `step()`'s own paint must be the last paint, or the picture is
 *    whichever frame the compositor happened to hold -- the failure that cost
 *    the golden gate a 28% false-red rate (`capture-protocol.ts`'s own note).
 * 2. **Every frame after that is pumped EXPLICITLY**, because rAF is
 *    throttled in a hidden tab and a frame-driven read comes back stale with
 *    no error.
 * 3. **Subjects are SPAWNED, never found**, on the open northern band of
 *    `beit_sahwan_outskirts` (rows 0-7 are open ground end to end) --
 *    `wreck-captures.ts`'s reasoning, unchanged.
 *
 * ## What this file CANNOT inherit, and why (R-P)
 *
 * `blast-captures.ts` freezes the SIM and advances only the FX clock -- right
 * for an explosion, which is a clock running out over a frozen battlefield,
 * and useless for a moving vehicle, which is a position the sim itself has to
 * keep changing. `__lions.step(n)` (`packages/app/src/main.ts:3851`) runs `n`
 * ticks and then presents exactly ONE `renderer.frame(1, lastFrameMs)` --
 * alpha 1, at a frame delta this harness cannot read or set -- so a ladder
 * driven by `step()` alone would photograph tick boundaries only and miss the
 * interpolation the whole package lives in (`renderer.snapshot()` latches the
 * PREVIOUS tick's position into `prevX`/`prevY` and the new one into
 * `curX`/`curY`, and `frame(alpha, dtMs)` interpolates between them -- alpha 1
 * is the frame where that interpolation has nothing left to do).
 *
 * So every one of the `count` ticks this harness advances is hand-ticked
 * (`sim.tick()` + `renderer.snapshot()` + `renderer.onEvents()`, never
 * `step(1)`) followed by a FULL hand-pumped `renderer.frame(alpha,
 * FRAME_MS)` walk (`framePumps`'s own output, `TICK_ALPHAS`) -- **every
 * tick, not only the last of a rung's four.** Both halves of that are Fix
 * round 1's critical correction, and each was measured wrong before it was
 * fixed.
 *
 * The first cut pumped only the last tick, which left the other three
 * advancing the MODEL clock by `step()`'s own single, unmeasured
 * `lastFrameMs` jump (clamped to 100 ms by `frameDtMs`) instead of a
 * measured ~16 ms one, so a labelled `SAMPLE_EVERY_MS` (200) ms rung
 * actually advanced the model by run-varying amounts around 418-450 ms --
 * against transients this package cares about that last only 300-500 ms, so
 * a before/after pair at the "same" rung need not have seen the same amount
 * of model time at all. Pumping every tick (`tickPumpSchedule`, the pure
 * function `advanceTicks` actually consumes, not a parallel
 * reimplementation of it) was the fix that turned up the SECOND, larger
 * defect: `step(n)` ends with its OWN `renderer.frame(1, lastFrameMs)`
 * call, so calling `step(1)` and then pumping MORE frames on top of it
 * double-counts -- measured live, a labelled 200 ms rung read `modelMs`
 * 577.2 with `step(1)` still in the loop, worse than the bug it was meant
 * to fix. Hand-ticking is what makes the pumps the ONLY thing that ever
 * touches `smokeClockMs`: every rung of the re-taken before-set reads
 * `modelMs === ms` exactly, at every one of the 51 rungs, for every subject.
 *
 * **The pumps advance the MODEL clock; they do not change what the PICTURE
 * shows.** Every screenshot is still taken through `frameOnEntity`'s own
 * separate, zero-elapsed-time repaint at alpha 1 -- the frame where
 * `lerp(prevX, curX, alpha)` has settled on the sim's own current position,
 * which is the right thing for a clean per-rung readout, not a mid-
 * interpolation blur. The alpha walk inside `advanceTicks` exists so any
 * FRAME-clock-driven state (this package's own weight filter once Task 6
 * lands, and `smokeClockMs` today) ages by real ~16 ms increments instead of
 * `step()`'s own oversized one -- it is not what the photograph is taken at.
 *
 * `smokeClockMs` stands in for the otherwise-unreadable `lastFrameMs`
 * closure for the same reason `blast-captures.ts` measures `stepJumpMs`
 * instead of assuming it: GH #144 made it a general accumulated-frame-time
 * clock (`ThreeRenderer.frame`: `this.smokeClockMs += dtMs`, unconditional),
 * not a smoke-specific one. It is read through a structural interface
 * (`LionsWindow`), so a rename of the private field would otherwise resolve
 * to `undefined` and silently propagate as `NaN` through every downstream
 * number -- every read site guards with `Number.isFinite` and throws, naming
 * the field, rather than let that happen quietly.
 *
 * `gait-captures.ts`'s `git show` interception is the wrong instrument here
 * for the reason its own header gives about the opposite case: it
 * photographs before-ART by answering GLB fetches from another revision, and
 * this package's change is CODE. The "before" is taken by running this
 * harness at the branch base, same binary, same everything else.
 *
 * ## Orders: one per body
 *
 * `L.sim.queueCommand({ kind: 'move', ids: [id], x, y })`, one call per
 * subject -- `gait-captures.ts:741-762`'s reason: a command whose `ids` holds
 * more than one entity lands in formation (`packages/sim/src/formation.ts`)
 * and would shuffle a subject off the lane this sheet is measuring.
 *
 * ## Isolation
 *
 * Every (subject, phase) pair gets its OWN page and its own fresh sim, never
 * shared. A subject in motion cannot be boxed onto a fixed lane the way a
 * stationary explosion can (`blast-captures.ts`'s subjects never move), so
 * sharing a world would mean choreographing up to twelve moving bodies well
 * clear of one another for the whole ten-second window. Isolation buys
 * correctness at the cost of twelve page loads instead of two; there is no
 * per-mission budget this instrument has to answer to.
 *
 * ## The numeric readback (R-Q)
 *
 * `debugVehicleTransform` does not exist until Task 6. Calling through it
 * would throw; this harness checks `typeof ... === 'function'` first and
 * records every reading as `null` when it is absent -- never `0`, because a
 * zero and an absence read identically (the whole `measureFacing` lesson,
 * CLAUDE.md's "every check gets an input that makes it fail"). That is the
 * correct BEFORE reading, not a failure, exactly as `blast-captures.ts`
 * reports two zeroes with a reason on its own before-set.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// The pure half. Imported by `weight-captures.test.ts`, which must not pull
// playwright into `pnpm test` -- so everything browser-shaped below is behind
// a dynamic import inside `main()`, exactly as `blast-captures.ts` keeps
// `capture-protocol.ts` importable without `browser.ts`.
// ---------------------------------------------------------------------------

/** The window the lead judges on (G0 #14's precedent), in milliseconds. */
export const SAMPLE_WINDOW_MS = 10_000;
/** The rung spacing. See `SAMPLE_MS`. */
export const SAMPLE_EVERY_MS = 200;

/**
 * The sample times, inclusive of both ends.
 *
 * Starts at 0 deliberately: for `start`, ms 0 is the tick the move order was
 * issued, and a ladder that began at `everyMs` would photograph a launch
 * whose first frame had already happened.
 *
 * Refuses a step that does not divide the window rather than silently
 * truncating -- a ladder that stops at 9.9 s of a 10 s window is a sheet
 * whose last rung is not the rung anyone quoted. (Identical to
 * `blast-captures.ts`'s `sampleLadder`, copied rather than imported: the two
 * files must not depend on each other, so a change to one's ladder shape
 * cannot silently move the other's.)
 */
export function sampleLadder(windowMs: number, everyMs: number): number[] {
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error(`sampleLadder: windowMs must be a positive finite number, got ${windowMs}`);
  }
  if (!Number.isFinite(everyMs) || everyMs <= 0) {
    throw new Error(`sampleLadder: everyMs must be a positive finite number, got ${everyMs}`);
  }
  if (windowMs % everyMs !== 0) {
    throw new Error(
      `sampleLadder: a step of ${everyMs} ms does not divide a ${windowMs} ms window evenly ` +
        `(${windowMs} % ${everyMs} = ${windowMs % everyMs}). Pick a step that divides it, rather ` +
        'than accepting a ladder whose last rung is not the end of the window.'
    );
  }
  const out: number[] = [];
  for (let ms = 0; ms <= windowMs; ms += everyMs) out.push(ms);
  return out;
}

/** The ten-second ladder every subject/phase is photographed on. 51 rungs. */
export const SAMPLE_MS: readonly number[] = sampleLadder(SAMPLE_WINDOW_MS, SAMPLE_EVERY_MS);

/**
 * Walks the interpolation fraction across ONE sim tick in real ~frame-sized
 * steps, ending exactly at 1.
 *
 * This is the half `blast-captures.ts` never needed: that harness advances a
 * frame CLOCK with nothing left to tick, so `renderer.frame(1, dtMs)` at
 * whatever `dtMs` is due is enough. A moving vehicle's drawn position is
 * `lerp(prevX, curX, alpha)` (`ThreeRenderer.snapshot`/`frame`), so a ladder
 * that only ever asks for alpha 1 is asking for the single frame per tick
 * where that interpolation has already finished -- the same frame
 * `__lions.step` draws by itself. Walking alpha up to 1 in `frameMs`-sized
 * steps is what makes the smooth lag/lean/settle this package draws visible
 * at all, rather than a sequence of teleports.
 *
 * `count = ceil(tickMs / frameMs)` rather than `round`: a partial last frame
 * still needs a pump to reach alpha 1 (a title too can be rounded away, and
 * then the ladder never actually reaches the tick's own end), and the last
 * entry is forced to exactly 1 to absorb any floating-point remainder from
 * the division above it.
 */
export function framePumps(tickMs: number, frameMs: number): number[] {
  if (!Number.isFinite(tickMs) || tickMs <= 0) {
    throw new Error(`framePumps: tickMs must be a positive finite number, got ${tickMs}`);
  }
  if (!Number.isFinite(frameMs) || frameMs <= 0) {
    throw new Error(`framePumps: frameMs must be a positive finite number, got ${frameMs}`);
  }
  const count = Math.max(1, Math.ceil(tickMs / frameMs));
  const out: number[] = [];
  for (let i = 1; i <= count; i++) out.push(Math.min(1, (i * frameMs) / tickMs));
  out[out.length - 1] = 1;
  return out;
}

/** One pumped frame within a multi-tick advance: which tick (0-indexed
 *  within the batch being advanced) it belongs to, and the alpha to pump it
 *  at. */
export interface TickPump {
  readonly tickIndex: number;
  readonly alpha: number;
}

/**
 * The full pumped-frame schedule for advancing `ticks` whole sim ticks, each
 * one walked across via `alphasPerTick` (`TICK_ALPHAS`).
 *
 * Every tick gets the FULL alpha walk, not only the last -- Fix round 1's
 * critical correction (see the module header). `advanceTicks` consumes this
 * schedule directly rather than re-deriving "pump every tick" independently
 * inside a `page.evaluate` string, so a mutation here (the one this file's
 * own commit history falsified: restricting the loop to `ticks - 1`, i.e.
 * the last tick only) changes what the BROWSER actually does, not just what
 * a parallel implementation claims it does.
 */
export function tickPumpSchedule(ticks: number, alphasPerTick: readonly number[]): TickPump[] {
  if (!Number.isInteger(ticks) || ticks < 0) {
    throw new Error(`tickPumpSchedule: ticks must be a non-negative integer, got ${ticks}`);
  }
  const out: TickPump[] = [];
  for (let tickIndex = 0; tickIndex < ticks; tickIndex++) {
    for (const alpha of alphasPerTick) out.push({ tickIndex, alpha });
  }
  return out;
}

export type WeightPhase = 'start' | 'stop' | 'turn';

/** The three motions GH-177 names, in the order the plan's Task 1 describes
 *  their choreography. */
export const WEIGHT_PHASES: readonly WeightPhase[] = ['start', 'stop', 'turn'];

export interface WeightSubject {
  /** This subject's own name: the file prefix, the sheet row, and what
   *  `--only=<id>` selects on. Distinct across the set. */
  readonly id: string;
  /** The unit type to spawn, when it is not `id` -- the same vehicle
   *  photographed on a second map needs a different id and the same body. */
  readonly typeId?: string;
  /** The map this subject is captured on. Never defaulted (unlike
   *  `blast-captures.ts`'s `BlastSubject.map`): every subject here moves, so
   *  "which band is this on" is load-bearing enough to want stating rather
   *  than implying. */
  readonly map: string;
  /** The tile this subject is spawned on -- its `start` phase's own spawn
   *  point, and the nominal tile the sheet names it by. `stop` and `turn`
   *  spawn their own, isolated instance at the SAME tile (see the header:
   *  every phase gets its own page), so this one coordinate describes all
   *  three. */
  readonly x: number;
  readonly y: number;
  /** Which way the second, perpendicular order turns for this subject's
   *  `turn` phase: +1 increases y, -1 decreases it. Chosen per subject so the
   *  turn stays on open, unobstructed ground -- south for the northern band
   *  (there is room below it), north for the tel_marum subject (its own open
   *  corridor runs both ways, but north is measured clear at this tile and
   *  south is not, past roughly y=29). */
  readonly turnSign: 1 | -1;
  /** One line for the sheet: why this subject is in the set. */
  readonly why: string;
}

/**
 * Brackets the roster on speed and turn rate, and puts one subject somewhere
 * with relief.
 *
 * `mbt_lavi` (1.1 tiles/s, 60 deg/s) is the slowest and slowest-turning --
 * the heaviest weight signature and the biggest silhouette. `technical`
 * (2.6, 120) is the fastest wheeled vehicle in the roster -- the shortest
 * pitch and the hardest lean. `apc_eitan` (1.8, 90) is the middle and the
 * roster's one 8-wheeler. All three read `data/units/kdf/mbt_lavi.json`,
 * `data/units/kdf/apc_eitan.json` and `data/units/enemy/technical.json`
 * directly (verified against the shipped JSON, 2026-09-20).
 *
 * The fourth subject reuses `mbt_lavi`'s body on `tel_marum`'s bench
 * (CLAUDE.md's own name for the raised plateau at (24,26)): open basin floor
 * at elevation 0 west of x=18, climbing onto an elevation-2 plateau east of
 * it (`data/maps/tel_marum.json`'s `elevation` rows 25-26). `mbt_lavi`'s own
 * `start` move (12 tiles east from x=14) crosses that edge, which is the one
 * place this package's four-corner terrain-conform half has anything to
 * read: `beit_sahwan_outskirts` declares no `elevation` grid at all, so the
 * term is arithmetically zero there.
 */
export const WEIGHT_SUBJECTS: readonly WeightSubject[] = [
  {
    id: 'mbt_lavi',
    map: 'beit_sahwan_outskirts',
    x: 2,
    y: 1,
    turnSign: 1,
    why:
      "the roster's slowest and slowest-turning vehicle (1.1 tiles/s, 60 deg/s) -- the heaviest " +
      'weight signature of the three and the biggest silhouette a lean has to carry',
  },
  {
    id: 'apc_eitan',
    map: 'beit_sahwan_outskirts',
    x: 2,
    y: 3,
    turnSign: 1,
    why: 'the middle of the roster and its one 8-wheeler (1.8 tiles/s, 90 deg/s)',
  },
  {
    id: 'technical',
    map: 'beit_sahwan_outskirts',
    x: 2,
    y: 5,
    turnSign: 1,
    why:
      'the fastest wheeled vehicle in the roster (2.6 tiles/s, 120 deg/s) -- the shortest-lived ' +
      'pitch and the hardest lean this sheet can show',
  },
  {
    id: 'mbt_lavi_tel_marum',
    typeId: 'mbt_lavi',
    map: 'tel_marum',
    x: 14,
    y: 26,
    turnSign: -1,
    why:
      "tel_marum's bench: open basin floor climbing onto an elevation-2 plateau over the `start` " +
      'move -- the one place the terrain-conform half has anything to read, since ' +
      'beit_sahwan_outskirts declares no elevation grid and the term is arithmetically zero there',
  },
];

/**
 * One reading of the drawn transform against the sim's own truth, at one
 * rung of one subject's one phase (R-Q).
 *
 * `offsetTiles`, `pitchDeg`, `rollDeg` and `simSpeed` are `null` rather than
 * `0` whenever `debugVehicleTransform` cannot be read -- see the module
 * header. `simFacing` needs no such guard: it is read straight off
 * `sim.state.facing`, which exists regardless of this package's own code.
 */
export interface WeightReading {
  readonly ms: number;
  readonly subject: string;
  readonly phase: WeightPhase;
  /** Straight-line distance in tiles between the DRAWN hull and the sim's own
   *  position, read back rather than recomputed (R-Q, R-C's own bound). */
  readonly offsetTiles: number | null;
  readonly pitchDeg: number | null;
  readonly rollDeg: number | null;
  /** The weight model's own smoothed speed, as `debugVehicleTransform`
   *  reports it -- not re-derived from position deltas here. */
  readonly simSpeed: number | null;
  /** The sim's own hull heading, in degrees (`sim.state.facing` is Q16.16
   *  turns; `* 360` converts it). Always available. */
  readonly simFacing: number;
}

/** One photograph and its reading, as printed in the sheet. A separate shape
 *  from `WeightReading` (rather than extending it) so a caller building a
 *  minimal row -- as the spec's own test literals do -- is not forced to
 *  supply fields the table does not need. */
export interface SheetCell {
  readonly subject: string;
  readonly phase: WeightPhase;
  readonly ms: number;
  readonly zoom: number;
  readonly tick: number;
  readonly file: string;
  readonly offsetTiles: number | null;
  readonly pitchDeg: number | null;
  readonly rollDeg: number | null;
  readonly simSpeed?: number | null;
  readonly simFacing?: number;
  /** Fix round 1, CRITICAL: how much the MODEL clock (`smokeClockMs`) has
   *  actually advanced since this run's trigger, read back rather than
   *  assumed from the labelled `ms`. The two should agree closely now that
   *  every tick is pumped (not only the last) -- see the module header. */
  readonly modelMs?: number;
}

function fmt(v: number | null | undefined): string {
  return v === null || v === undefined ? 'n/a' : String(v);
}

/**
 * The half of the evidence that survives R-G's git-ignored storage.
 *
 * The PNGs live under `.superpowers/` and are never committed, so the
 * NUMBERS -- rung times, the drawn-vs-sim offset, pitch, roll -- are what
 * gets quoted into the task report and the PR body. A sheet that named only
 * the files would leave nothing behind once the directory was gone.
 */
export function sheetIndex(label: string, cells: readonly SheetCell[]): string {
  const subjects = [...new Set(cells.map((c) => c.subject))];
  const lines = [
    `# Weight capture sheet -- ${label}`,
    ``,
    `${cells.length} frame(s) over ${subjects.length} subject(s): ${subjects.join(', ') || '(none)'}.`,
    `Ladder: ${SAMPLE_MS.length} rungs, 0..${SAMPLE_WINDOW_MS} ms every ${SAMPLE_EVERY_MS} ms.`,
    ``,
    `| subject | phase | t (ms) | model_ms | zoom | tick | offset (tiles) | pitch (deg) | roll (deg) | sim speed | sim facing (deg) | file |`,
    `|---|---|---|---|---|---|---|---|---|---|---|---|`,
    ...cells.map(
      (c) =>
        `| \`${c.subject}\` | ${c.phase} | ${c.ms} | ${fmt(c.modelMs)} | ${c.zoom} | ${c.tick} | ` +
        `${fmt(c.offsetTiles)} | ${fmt(c.pitchDeg)} | ${fmt(c.rollDeg)} | ` +
        `${fmt(c.simSpeed)} | ${fmt(c.simFacing)} | \`${c.file}\` |`
    ),
  ];
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// The browser half. Nothing below is imported by the spec.
// ---------------------------------------------------------------------------

/** Ports in use by this repo's other harnesses, per the controller's own
 *  ruling: 5173 a human's own dev server, 5176 ui:shots, 5177 ui:routes and
 *  plate-capture, 5179 death-captures and unit-plates, 5181 blast-captures.
 *  This one takes the next free number and never touches another. */
const PORT = 5182;
const VIEWPORT = { width: 1400, height: 900 } as const;
/** The establishing still, then the ladder. 2.5 is the top of `main.ts`'s own
 *  0.35-2.5 camera clamp, and the spec's own figure for the ladder. */
const ESTABLISH_ZOOM = 1.0;
const LADDER_ZOOM = 2.5;
/** The crop the ladder rungs are taken at, following the tracked vehicle.
 *  Same shape as `blast-captures.ts`'s `CLOSE_CROP`. */
const CLOSE_CROP = { width: 600, height: 400 } as const;
const CLOSE_CROP_LIFT_PX = 50;
/** One pumped frame, ~60 fps -- the value `weight-captures.test.ts` itself
 *  exercises `framePumps` with. */
const FRAME_MS = 1000 / 60;
/** The sim's own fixed tick period (invariant 1). Every rung of `SAMPLE_MS`
 *  is a whole multiple of it (200 / 50 = 4), so the ladder always lands on a
 *  tick boundary and never needs a fractional tick. */
const TICK_MS = 1000 / 20;
/** The pre-computed alpha walk for one tick, reused for every tick this
 *  harness ever advances -- computed once here, in Node, with the exported
 *  `framePumps` itself, rather than re-derived inline inside a
 *  `page.evaluate` string. */
const TICK_ALPHAS: readonly number[] = framePumps(TICK_MS, FRAME_MS);
/** "a tile 12 away" -- the brief's own phrase for `start`'s move and the
 *  distance `stop`'s own order also targets, so cruise is genuinely
 *  established before the halt. */
const MOVE_DISTANCE_TILES = 12;
/** "ordered 20 ticks earlier" -- the brief's own figure for `stop`, reused for
 *  `turn`'s own first order so both phases reach cruise the same way before
 *  their own second act. */
const CRUISE_TICKS = 20;
/** "the ladder starts on the tick its goal is 2 tiles away" (`stop`). */
const STOP_TRIGGER_TILES = 2;
/** How far `turn`'s second, perpendicular order asks the vehicle to go.
 *  Small on purpose: it only has to be far enough to force the pivot into the
 *  open, not far enough to run any subject off the mapped-clear ground this
 *  file's own header measured it against. */
const TURN_OFFSET_TILES = 4;
/** Guards the `stop` phase's own tick-by-tick hunt for "2 tiles from goal"
 *  against an infinite loop if a future subject is misconfigured. 400 ticks
 *  is 20 s -- comfortably past how long even `mbt_lavi` (1.1 tiles/s) takes
 *  to close a 12-tile order to within 2 tiles. */
const STOP_WAIT_TICK_CAP = 400;
/** Fix round 1, MINOR (4): `waitForMesh` steps ticks while it polls, so the
 *  sim's own tick count when it returns encodes how many 400 ms polls a GLB
 *  fetch happened to take on this boot -- 47-61 ticks of jitter, observed
 *  across the four subjects' `start` phase before this fix. Stepping up
 *  (never down -- a spent tick cannot be un-spent) to this fixed floor
 *  before `beginPhase` runs means its own fixed offsets (`start`'s `+10`,
 *  `stop`/`turn`'s `CRUISE_TICKS`) land on the SAME absolute tick across
 *  runs, rather than one that silently varies with boot-time load. 100 is
 *  comfortably past every observed mesh-wait duration, including
 *  `tel_marum`'s relief map; a run whose mesh-wait alone exceeds it is
 *  noted rather than silently left uncomparable (see `settleTickFloor`). */
const MESH_SETTLE_TICK_FLOOR = 100;
const SETTLE_MS = 2500;
const SETTLE_VIEWPORT = { width: 320, height: 200 } as const;
const MESH_WAIT_MS = 300_000;
const STEP_TIMEOUT_MS = 120_000;
const FIXED = 65536;

/** The repo root, derived from this module's own location -- see
 *  `blast-captures.ts`'s identical constant for the `tools/` cwd trap this
 *  avoids. */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * Fix round 1, IMPORTANT (3): `conditions` named no source revision, so a
 * before-set and an after-set taken weeks apart carried no record of which
 * commit either one was actually built from. Read once per process (one
 * `writeIndex` call's own batch), never assumed, and never fatal -- a
 * missing `git` or a detached worktree with no `HEAD` should degrade to
 * `'unknown'`/`false` with a console warning, not take the capture down.
 */
function readGitInfo(): { revision: string; dirty: boolean } {
  try {
    const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: REPO_ROOT, encoding: 'utf8' });
    return { revision, dirty: status.trim().length > 0 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`  could not read git revision/dirty state -- ${message.split('\n')[0]}`);
    return { revision: 'unknown', dirty: false };
  }
}

interface LionsWindow {
  __lions: {
    step(n: number): number;
    sim: {
      tickCount: number;
      unitTypes: { id: string }[];
      state: {
        alive: Int8Array | Uint8Array;
        posX: Int32Array;
        posY: Int32Array;
        facing: Int32Array;
      };
      spawn(typeIdx: number, side: number, x: number, y: number): number;
      queueCommand(cmd: { kind: 'move'; ids: number[]; x: number; y: number }): void;
      /** Dev/test hook (sandbox tooling): knocks out the entity's own
       *  weapons. Called on every spawned subject here -- see `spawnBare`'s
       *  own comment for why. */
      debugDisableFirepower(id: number): void;
      /** Advances exactly one 20 Hz tick and returns its events, with no
       *  frame presented -- `main.ts`'s own `runTick` minus its audio and
       *  mission calls (neither exists in sandbox mode). `advanceTicks` uses
       *  this instead of `step(1)` for the reason its own comment gives:
       *  `step(n)` ends with ONE `renderer.frame(1, lastFrameMs)`, which
       *  would add an unmeasured, unwanted jump to `smokeClockMs` on top of
       *  every pumped frame this harness adds deliberately. */
      tick(): unknown[];
    };
    renderer: {
      camera: { x: number; y: number; zoom: number };
      frame(alpha: number, dtMs: number): void;
      /** Latches current sim positions as the previous frame's -- paired
       *  with `sim.tick()` for hand-ticking, see that method's own comment. */
      snapshot(): void;
      onEvents(events: unknown[]): void;
      worldToScreen(x: number, y: number): { x: number; y: number };
      smokeClockMs: number;
      vehicleMeshEntities: Map<number, unknown>;
      /**
       * Added in Task 6. Declared here optional and read through a `typeof`
       * guard, never asserted, so this file compiles and runs identically
       * before and after that task lands -- see the module header.
       */
      debugVehicleTransform?: (id: number) => {
        x: number;
        y: number;
        pitchDeg: number;
        rollDeg: number;
        simSpeed: number;
      };
    };
  };
}

function arg(name: string, fallback: string): string {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

interface Run {
  readonly subject: WeightSubject;
  readonly phase: WeightPhase;
}

async function main(): Promise<void> {
  const { chromium } = await import('playwright');
  const { ensureDevServer, stopDevServer, readUnmaskedRenderer } = await import('../golden-diff/browser');
  const { FREEZE_FRAME_LOOP_SCRIPT } = await import('../golden-diff/capture-protocol');

  const label = arg('label', '');
  if (label !== 'before' && label !== 'after') {
    throw new Error('--label=before|after is required: the sheet is a comparison or it is nothing');
  }
  const port = Number(arg('port', String(PORT)));
  if (port === 5173) throw new Error("refusing --port=5173: that is the convention for a human's own dev server");
  const outRoot = path.resolve(REPO_ROOT, arg('out', path.join('.superpowers', 'art-captures', 'weight')));
  const out = path.join(outRoot, label);
  const only = arg('only', '');
  const onlyIds = only ? only.split(',').map((s) => s.trim()).filter((s) => s.length > 0) : [];
  for (const id of onlyIds) {
    if (!WEIGHT_SUBJECTS.some((s) => s.id === id)) {
      throw new Error(`--only=${id} names no subject (have: ${WEIGHT_SUBJECTS.map((s) => s.id).join(', ')})`);
    }
  }
  const wantedSubjects = onlyIds.length > 0 ? WEIGHT_SUBJECTS.filter((s) => onlyIds.includes(s.id)) : WEIGHT_SUBJECTS;
  // `--phase`, beside `--only`: a full subject (all three phases, one page
  // each) can run past a single bounded foreground window on the slower map,
  // and this is what lets a caller split the same before/after label across
  // several bounded invocations instead of backgrounding the harness itself.
  // `writeIndex` merges into an existing same-label `sheet.json` rather than
  // clobbering it, so the batches recombine into one sheet.
  const phaseArg = arg('phase', '');
  const wantedPhaseIds = phaseArg
    ? phaseArg.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
    : [];
  for (const p of wantedPhaseIds) {
    if (!WEIGHT_PHASES.includes(p as WeightPhase)) {
      throw new Error(`--phase=${p} names no phase (have: ${WEIGHT_PHASES.join(', ')})`);
    }
  }
  const wantedPhases: readonly WeightPhase[] =
    wantedPhaseIds.length > 0 ? WEIGHT_PHASES.filter((p) => wantedPhaseIds.includes(p)) : WEIGHT_PHASES;
  const runs: readonly Run[] = wantedSubjects.flatMap((subject) => wantedPhases.map((phase) => ({ subject, phase })));

  fs.mkdirSync(out, { recursive: true });

  const { revision, dirty } = readGitInfo();
  const cells: SheetCell[] = [];
  const notes: string[] = [];
  let sawWiredTransform = false;
  let sawNonZeroWiredTransform = false;

  const server = await ensureDevServer(port, REPO_ROOT, 'weight-captures');
  const browser = await chromium.launch({ headless: true });
  let gl = 'unknown';
  let firstStepJumpMs = 0;
  try {
    gl = await readUnmaskedRenderer(browser);
    let runIndex = 0;
    for (const run of runs) {
      runIndex++;
      const label2 = `${run.subject.id} / ${run.phase}`;
      console.log(`\n=== run ${runIndex}/${runs.length}: ${label2}`);
      const page = await browser.newPage({ viewport: { ...SETTLE_VIEWPORT }, deviceScaleFactor: 1 });
      page.setDefaultTimeout(STEP_TIMEOUT_MS);
      page.on('pageerror', (err) => console.log('  page error:', err.message));
      // `&renderer=three` explicitly, never by omission -- `renderer-choice.ts`
      // falls back to a per-ORIGIN `localStorage` key shared with every other
      // capture ever run against this dev server.
      await page.goto(`http://localhost:${port}/?sandbox=${run.subject.map}&renderer=three`, {
        waitUntil: 'load',
      });
      await page.waitForFunction(() => typeof (window as unknown as { __lions?: unknown }).__lions !== 'undefined');
      await page.evaluate(() => document.fonts.ready);
      // Settle at a small viewport before freezing, then resize -- see
      // `blast-captures.ts`'s header for the measured reason: freezing
      // immediately latches a boot/GLB-load frame into `lastFrameMs`, and
      // settling at the full capture viewport pays a needless SwiftShader
      // cost for every one of these twelve pages.
      await page.waitForTimeout(SETTLE_MS);
      await page.evaluate(FREEZE_FRAME_LOOP_SCRIPT);
      await page.setViewportSize({ ...VIEWPORT });
      await page.waitForFunction(
        ([w, h]) => {
          const c = document.querySelector('canvas');
          return c !== null && c.clientWidth === w && c.clientHeight === h;
        },
        [VIEWPORT.width, VIEWPORT.height] as const
      );
      await page.evaluate(() => (window as unknown as LionsWindow).__lions.renderer.frame(1, 0));

      // The dry read of `step()`'s own frame jump, off `smokeClockMs` --
      // see the module header for why that accumulator is a safe stand-in
      // for the unreadable `lastFrameMs` closure.
      const stepJumpMs = await page.evaluate(() => {
        const L = (window as unknown as LionsWindow).__lions;
        const before = L.renderer.smokeClockMs;
        if (!Number.isFinite(before)) {
          throw new Error(
            'weight-captures: L.renderer.smokeClockMs is not a finite number -- has ThreeRenderer ' +
              'renamed or removed the private field this harness reads structurally?'
          );
        }
        L.step(1);
        return L.renderer.smokeClockMs - before;
      });
      console.log(`  step(1) advances the frame clock by ${stepJumpMs.toFixed(2)} ms (measured, not assumed)`);
      if (runIndex === 1) firstStepJumpMs = stepJumpMs;
      notes.push(`${label2}: step(1) advances the frame clock by ${stepJumpMs.toFixed(2)} ms.`);

      const typeId = run.subject.typeId ?? run.subject.id;
      const entity = await spawnBare(page, typeId, run.subject.x, run.subject.y);
      await waitForMesh(page, entity, notes, label2);
      await settleTickFloor(page, notes, label2);

      const trigger = await beginPhase(page, entity, run);
      console.log(`  ${label2}: ladder begins at tick ${trigger.tick}`);
      if (trigger.exhausted === true) {
        notes.push(
          `${label2}: the stop phase's ${STOP_WAIT_TICK_CAP}-tick hunt for "goal is ` +
            `${STOP_TRIGGER_TILES} tiles away" never triggered -- captured at whatever position ` +
            'it reached instead.'
        );
      }
      const baseModelMs = trigger.modelMs;

      let ticksDone = 0;
      for (const ms of SAMPLE_MS) {
        const ticksTarget = ms / TICK_MS;
        await advanceTicks(page, ticksTarget - ticksDone);
        ticksDone = ticksTarget;

        if (ms === 0) {
          const est = await frameOnEntity(page, entity, ESTABLISH_ZOOM, baseModelMs);
          const file = `${run.subject.id}-${run.phase}-establish-${label}-z${ESTABLISH_ZOOM}.png`;
          await page.screenshot({ path: path.join(out, file) });
          const reading = await readTransform(page, entity);
          cells.push({
            subject: run.subject.id,
            phase: run.phase,
            ms,
            zoom: ESTABLISH_ZOOM,
            tick: est.tick,
            file,
            modelMs: Math.round(est.modelMs * 100) / 100,
            ...reading,
          });
        }

        const state = await frameOnEntity(page, entity, LADDER_ZOOM, baseModelMs);
        const rect = {
          x: Math.min(Math.max(0, state.screenX - CLOSE_CROP.width / 2), VIEWPORT.width - CLOSE_CROP.width),
          y: Math.min(
            Math.max(0, state.screenY - CLOSE_CROP.height / 2 - CLOSE_CROP_LIFT_PX),
            VIEWPORT.height - CLOSE_CROP.height
          ),
          w: CLOSE_CROP.width,
          h: CLOSE_CROP.height,
        };
        const file = `${run.subject.id}-${run.phase}-${String(ms).padStart(5, '0')}ms-${label}-z${LADDER_ZOOM}.png`;
        await page.screenshot({
          path: path.join(out, file),
          clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h },
        });
        const reading = await readTransform(page, entity);
        if (reading.offsetTiles !== null) {
          sawWiredTransform = true;
          if (reading.offsetTiles !== 0 || reading.pitchDeg !== 0 || reading.rollDeg !== 0) {
            sawNonZeroWiredTransform = true;
          }
        }
        cells.push({
          subject: run.subject.id,
          phase: run.phase,
          ms,
          zoom: LADDER_ZOOM,
          tick: state.tick,
          file,
          modelMs: Math.round(state.modelMs * 100) / 100,
          ...reading,
        });
      }
      await page.close();
    }

    if (!sawWiredTransform) {
      notes.push(
        '`debugVehicleTransform` is not wired yet (added in Task 6) -- offsetTiles/pitchDeg/rollDeg/' +
          'simSpeed read `null` for every rung of every subject/phase. This is the correct BEFORE ' +
          'reading, not a failure -- exactly as blast-captures.ts reports two zeroes with a reason on ' +
          'its own before-set.'
      );
    }

    writeIndex(out, label, cells, notes, { gl, stepJumpMs: firstStepJumpMs, port, revision, dirty }, wantedSubjects);
  } finally {
    await browser.close();
    stopDevServer(server, 'weight-captures');
  }

  // R-Q: once the transform IS wired, a reading that is wired but reads zero
  // everywhere is a model wired to nothing, and that is a failure -- the
  // same rule `debug-layers.ts` states for a layer toggle. It cannot fire on
  // this branch (nothing calls `debugVehicleTransform` from Task 6 yet), so
  // this only starts biting once the after-set is capturable.
  if (sawWiredTransform && !sawNonZeroWiredTransform) {
    console.error(
      '\ndebugVehicleTransform is wired but reported the identity transform (0 offset, 0 pitch, ' +
        '0 roll) on every single rung of every subject and phase -- a model wired to nothing reads ' +
        'exactly like a model at rest.'
    );
    process.exitCode = 1;
  }
}

/**
 * Spawns one entity with no orders at all, so the mesh-load wait below can
 * step ticks freely without moving it.
 *
 * **`debugDisableFirepower` is not optional.** Measured live on
 * `mbt_lavi_tel_marum`'s `turn` phase: the hull rotated correctly to 270 deg
 * by tick 105 and held it -- then reverted to ~0 deg by tick 245 with no
 * further order from this harness. The cause is combat, not a bug in the
 * choreography: `sim.ts`'s `turnToward` also drives weapon AIMING, and a
 * unit that ends its move within sight of a sandbox-force hostile turns to
 * engage it and, on losing the target, restores `facing` from `aimFrom` --
 * whatever heading it had before it started aiming, not the heading this
 * harness ordered. Isolated with a throwaway harness and confirmed: the same
 * 280-tick run holds a rock-solid 270 deg for the entire window once this
 * call is in place. Every subject gets it, not only the one caught -- a
 * subject that happens not to trigger it on `main` today is one map edit
 * away from triggering it tomorrow, and a harness that measures combat
 * instead of weight would look identical to one measuring weight correctly.
 */
async function spawnBare(page: import('playwright').Page, typeId: string, x: number, y: number): Promise<number> {
  return page.evaluate(
    ([id, tx, ty, fixed]) => {
      const L = (window as unknown as LionsWindow).__lions;
      const idx = L.sim.unitTypes.findIndex((t) => t.id === id);
      if (idx < 0) throw new Error(`no unit type "${id}" in this build`);
      const entity = L.sim.spawn(idx, 0, tx * fixed, ty * fixed);
      L.sim.debugDisableFirepower(entity);
      return entity;
    },
    [typeId, x, y, FIXED] as const
  );
}

/** Waits for the spawned body to hold a real mesh, stepping ticks while it
 *  waits -- safe because nothing has been ordered yet. Mirrors
 *  `blast-captures.ts`'s `waitForMeshes`, scoped to the one entity a run
 *  ever has. */
async function waitForMesh(
  page: import('playwright').Page,
  entity: number,
  notes: string[],
  label: string
): Promise<void> {
  const deadline = Date.now() + MESH_WAIT_MS;
  let first = true;
  for (;;) {
    const has = await page.evaluate(
      ([id, tick]) => {
        const L = (window as unknown as LionsWindow).__lions;
        if (tick) L.step(1);
        return L.renderer.vehicleMeshEntities.has(id);
      },
      [entity, !first] as const
    );
    first = false;
    if (has) return;
    if (Date.now() > deadline) {
      notes.push(`${label}: entity ${entity} never got a mesh in ${MESH_WAIT_MS / 1000}s -- captured anyway`);
      return;
    }
    await page.waitForTimeout(400);
  }
}

/**
 * Fix round 1, MINOR (4). Steps up (never down) to `MESH_SETTLE_TICK_FLOOR`
 * so `beginPhase`'s own fixed tick offsets land on the same absolute tick
 * across runs, regardless of how many polls `waitForMesh` happened to spend.
 * A run whose mesh-wait alone already passed the floor is noted, not
 * silently left incomparable -- the same "never fall through quietly" rule
 * `waitForMesh`'s own deadline branch follows.
 */
async function settleTickFloor(page: import('playwright').Page, notes: string[], label: string): Promise<void> {
  const tick = await page.evaluate(() => (window as unknown as LionsWindow).__lions.sim.tickCount);
  if (tick < MESH_SETTLE_TICK_FLOOR) {
    await page.evaluate((n) => (window as unknown as LionsWindow).__lions.step(n), MESH_SETTLE_TICK_FLOOR - tick);
  } else {
    notes.push(
      `${label}: mesh-wait alone reached tick ${tick}, past the ${MESH_SETTLE_TICK_FLOOR}-tick settle ` +
        "floor -- this run's absolute tick numbers will not line up with a faster run's."
    );
  }
}

/**
 * Sets up the phase's own choreography and returns the tick the ladder
 * begins on. See the plan's Task 1 for the phase descriptions this
 * implements literally:
 *
 * - `start`: ten idle ticks, then a `move` order to a tile `MOVE_DISTANCE_TILES`
 *   away. The ladder starts on the tick the order is issued.
 * - `stop`: a `move` order to the same distant tile, `CRUISE_TICKS` to reach
 *   cruise, then a tick-by-tick hunt (capped) for "goal is
 *   `STOP_TRIGGER_TILES` away", so the halt lands inside the window.
 * - `turn`: a `move` order east, `CRUISE_TICKS` to reach cruise, then a
 *   SECOND order `TURN_OFFSET_TILES` tiles off the current heading (the
 *   subject's own `turnSign`), issued from wherever cruise actually left it.
 */
interface PhaseTrigger {
  readonly tick: number;
  /** `smokeClockMs` at the instant the ladder's own rung zero begins --
   *  Fix round 1's `modelMs` baseline, read the same guarded way as every
   *  other `smokeClockMs` access in this file. */
  readonly modelMs: number;
  /** `stop` only: the tick-by-tick hunt for "goal is `STOP_TRIGGER_TILES`
   *  away" ran out its full `STOP_WAIT_TICK_CAP` without ever getting that
   *  close. Fix round 1, MINOR (5) -- previously this fell through silently
   *  and the ladder began wherever the loop happened to stop. */
  readonly exhausted?: boolean;
}

async function beginPhase(page: import('playwright').Page, entity: number, run: Run): Promise<PhaseTrigger> {
  const { subject, phase } = run;
  return page.evaluate(
    ([id, phase2, x, y, moveTiles, cruiseTicks, stopTiles, turnTiles, turnSign, stopCap, fixed]) => {
      const L = (window as unknown as LionsWindow).__lions;
      const targetX = (x + moveTiles) * fixed;
      const targetY = y * fixed;
      if (phase2 === 'start') {
        L.step(10);
        L.sim.queueCommand({ kind: 'move', ids: [id], x: targetX, y: targetY });
        const modelMs = L.renderer.smokeClockMs;
        if (!Number.isFinite(modelMs)) {
          throw new Error('weight-captures: L.renderer.smokeClockMs is not a finite number in beginPhase (start)');
        }
        return { tick: L.sim.tickCount, modelMs };
      }
      if (phase2 === 'stop') {
        L.sim.queueCommand({ kind: 'move', ids: [id], x: targetX, y: targetY });
        L.step(cruiseTicks);
        let exhausted = true;
        for (let i = 0; i < stopCap; i++) {
          const dx = x + moveTiles - L.sim.state.posX[id] / fixed;
          const dy = y - L.sim.state.posY[id] / fixed;
          if (Math.hypot(dx, dy) <= stopTiles) {
            exhausted = false;
            break;
          }
          L.step(1);
        }
        const modelMs = L.renderer.smokeClockMs;
        if (!Number.isFinite(modelMs)) {
          throw new Error('weight-captures: L.renderer.smokeClockMs is not a finite number in beginPhase (stop)');
        }
        return { tick: L.sim.tickCount, modelMs, exhausted };
      }
      // 'turn'
      L.sim.queueCommand({ kind: 'move', ids: [id], x: targetX, y: targetY });
      L.step(cruiseTicks);
      const curX = L.sim.state.posX[id] / fixed;
      const curY = L.sim.state.posY[id] / fixed;
      L.sim.queueCommand({
        kind: 'move',
        ids: [id],
        x: curX * fixed,
        y: (curY + turnSign * turnTiles) * fixed,
      });
      const modelMs = L.renderer.smokeClockMs;
      if (!Number.isFinite(modelMs)) {
        throw new Error('weight-captures: L.renderer.smokeClockMs is not a finite number in beginPhase (turn)');
      }
      return { tick: L.sim.tickCount, modelMs };
    },
    [
      entity,
      phase,
      subject.x,
      subject.y,
      MOVE_DISTANCE_TILES,
      CRUISE_TICKS,
      STOP_TRIGGER_TILES,
      TURN_OFFSET_TILES,
      subject.turnSign,
      STOP_WAIT_TICK_CAP,
      FIXED,
    ] as const
  );
}

/**
 * Advances `count` whole ticks, EVERY one hand-ticked and walked across in
 * real `FRAME_MS`-sized frames (`TICK_ALPHAS`, computed once in Node with
 * the exported `framePumps`) -- see the module header (R-P, Fix round 1) for
 * both defects this shape fixes and how each was measured.
 *
 * The schedule (`tickPumpSchedule`, tested on its own) is computed once in
 * Node and consumed here verbatim -- a tick advances exactly when the
 * schedule's `tickIndex` changes, and every entry after that pumps its own
 * `alpha`. Two mutations were falsified against this function while fixing
 * it (see the commit body): restricting the schedule to the last tick alone
 * (`i === n - 1`, the original defect), and calling `L.step(1)` instead of
 * hand-ticking (which double-counts, since `step(n)` ends with its own
 * `renderer.frame(1, lastFrameMs)`).
 */
async function advanceTicks(page: import('playwright').Page, count: number): Promise<void> {
  if (count <= 0) return;
  const schedule = tickPumpSchedule(count, TICK_ALPHAS);
  await page.evaluate(
    ([sched, frameMs]) => {
      const L = (window as unknown as LionsWindow).__lions;
      let lastTick = -1;
      for (const entry of sched) {
        if (entry.tickIndex !== lastTick) {
          // HAND-TICK, never `step(1)`: `step(n)` ends with its own
          // `renderer.frame(1, lastFrameMs)`, which would add an
          // unmeasured jump to `smokeClockMs` on top of every pumped frame
          // below -- measured live while fixing this: with `step(1)` here,
          // a labelled 200 ms rung read `modelMs` 577.2, roughly 4x high
          // (each tick was contributing `lastFrameMs + 3*FRAME_MS`, not
          // `3*FRAME_MS` alone). `sim.tick()` + `renderer.snapshot()` +
          // `renderer.onEvents()` -- `blast-captures.ts`'s own `handTick`
          // pattern -- advances the sim with NO frame presented, so the
          // pumps below are the only thing that ever touches the clock.
          const events = L.sim.tick();
          L.renderer.snapshot();
          L.renderer.onEvents(events);
          lastTick = entry.tickIndex;
        }
        L.renderer.frame(entry.alpha, frameMs);
      }
    },
    [schedule, FRAME_MS] as const
  );
}

/**
 * Centres the camera on the tracked entity's CURRENT sim tile -- unlike
 * `blast-captures.ts`'s `frameAt`, which frames a fixed point because an
 * explosion never moves, this one has to follow the vehicle across the
 * whole ladder. Repaints at ZERO elapsed time, so no clock moves.
 *
 * **This repaint is where every photograph is taken, and it is always at
 * alpha 1** (Fix round 1, IMPORTANT (1)) -- the frame where
 * `lerp(prevX, curX, alpha)` has settled on the sim's own current position.
 * The alpha walk in `advanceTicks` is a SEPARATE concern: it advances the
 * MODEL clock (`smokeClockMs`, read back here as `modelMs`) by real elapsed
 * time between rungs. Nothing about pumping every tick changes what this
 * function draws.
 */
async function frameOnEntity(
  page: import('playwright').Page,
  entity: number,
  zoom: number,
  baseModelMs: number
): Promise<{ screenX: number; screenY: number; tick: number; modelMs: number }> {
  return page.evaluate(
    ([id, z, fixed, base]) => {
      const L = (window as unknown as LionsWindow).__lions;
      const tileX = L.sim.state.posX[id] / fixed;
      const tileY = L.sim.state.posY[id] / fixed;
      const c = L.renderer.camera;
      c.x = tileX;
      c.y = tileY;
      c.zoom = z;
      L.renderer.frame(1, 0);
      const screen = L.renderer.worldToScreen(tileX, tileY);
      const clock = L.renderer.smokeClockMs;
      if (!Number.isFinite(clock)) {
        throw new Error('weight-captures: L.renderer.smokeClockMs is not a finite number in frameOnEntity');
      }
      return { screenX: screen.x, screenY: screen.y, tick: L.sim.tickCount, modelMs: clock - base };
    },
    [entity, zoom, FIXED, baseModelMs] as const
  );
}

/** The four transform-derived fields of a `WeightReading`, minus `ms`,
 *  `subject` and `phase` -- those three are known to the caller already, and
 *  keeping this return type free of them means spreading it into a `cells`
 *  entry can never silently clobber the real values with a placeholder. */
type TransformReading = Pick<WeightReading, 'offsetTiles' | 'pitchDeg' | 'rollDeg' | 'simSpeed' | 'simFacing'>;

/** R-Q's numeric readback. See the module header for why every field but
 *  `simFacing` is `null` rather than `0` until Task 6 wires
 *  `debugVehicleTransform`. */
async function readTransform(page: import('playwright').Page, entity: number): Promise<TransformReading> {
  return page.evaluate(
    ([id, fixed]) => {
      const L = (window as unknown as LionsWindow).__lions;
      const simFacing = (L.sim.state.facing[id] / fixed) * 360;
      if (typeof L.renderer.debugVehicleTransform !== 'function') {
        return { offsetTiles: null, pitchDeg: null, rollDeg: null, simSpeed: null, simFacing };
      }
      const drawn = L.renderer.debugVehicleTransform(id);
      const simX = L.sim.state.posX[id] / fixed;
      const simY = L.sim.state.posY[id] / fixed;
      const offsetTiles = Math.hypot(drawn.x - simX, drawn.y - simY);
      return { offsetTiles, pitchDeg: drawn.pitchDeg, rollDeg: drawn.rollDeg, simSpeed: drawn.simSpeed, simFacing };
    },
    [entity, FIXED] as const
  );
}

/** A cell's identity for merge purposes: which (subject, phase, rung, zoom)
 *  it photographs. Two runs of the same batch overwrite rather than
 *  duplicate; two different batches (the normal `--only`/`--phase` case)
 *  never collide because their subjects or phases differ. */
function cellKey(c: Pick<SheetCell, 'subject' | 'phase' | 'ms' | 'zoom'>): string {
  return `${c.subject}|${c.phase}|${c.ms}|${c.zoom}`;
}

/** One batch's own environment snapshot. Fix round 1, IMPORTANT (3):
 *  `conditions` used to be a single object that the LAST `writeIndex` call
 *  overwrote, so a six-batch before-set's aggregate `stepJumpMs`/`gl`
 *  reflected only its final batch. It is a array now, one entry appended
 *  per batch, so a merge keeps every one of them. */
interface ConditionsSnapshot {
  readonly machine: string;
  readonly gl: string;
  readonly viewport: typeof VIEWPORT;
  readonly deviceScaleFactor: number;
  readonly maps: string[];
  readonly renderer: string;
  readonly port: number;
  readonly establishZoom: number;
  readonly ladderZoom: number;
  readonly crop: typeof CLOSE_CROP;
  readonly frameMs: number;
  readonly tickMs: number;
  readonly tickAlphas: readonly number[];
  readonly stepJumpMs: number;
  readonly sampleMs: readonly number[];
  /** Fix round 1, IMPORTANT (3): which commit this batch was captured
   *  against, and whether the worktree had uncommitted changes at the time. */
  readonly revision: string;
  readonly dirty: boolean;
}

/**
 * Reads a same-label `sheet.json` already in `out`, if one exists, so a
 * caller can split one before/after label across several bounded
 * invocations (`--only=<subject>` and/or `--phase=<phase>`) and still land
 * on one combined sheet rather than each batch clobbering the last.
 *
 * A different label, or no file at all, is not an error: the FIRST batch of
 * a fresh label starts from nothing, exactly as it always has.
 */
function loadExisting(
  out: string,
  label: string
): { cells: SheetCell[]; notes: string[]; subjects: WeightSubject[]; conditions: ConditionsSnapshot[] } {
  const empty = { cells: [], notes: [], subjects: [], conditions: [] };
  const file = path.join(out, 'sheet.json');
  if (!fs.existsSync(file)) return empty;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      label?: unknown;
      cells?: unknown;
      notes?: unknown;
      subjects?: unknown;
      conditions?: unknown;
    };
    if (parsed.label !== label) return empty;
    return {
      cells: Array.isArray(parsed.cells) ? (parsed.cells as SheetCell[]) : [],
      notes: Array.isArray(parsed.notes) ? (parsed.notes as string[]) : [],
      subjects: Array.isArray(parsed.subjects) ? (parsed.subjects as WeightSubject[]) : [],
      // A pre-Fix-round-1 sheet.json carried `conditions` as a single object,
      // not an array -- treated as "no history" rather than thrown, since a
      // re-take from scratch (this round's own ruling) makes this the normal
      // case for the FIRST batch of the re-taken before-set too.
      conditions: Array.isArray(parsed.conditions) ? (parsed.conditions as ConditionsSnapshot[]) : [],
    };
  } catch {
    // A half-written or foreign file: treated as absent rather than thrown,
    // the same "start fresh" outcome as no file, and printed so it is never
    // a silent data loss.
    console.warn(`  ${file} could not be read as a previous batch -- starting this label fresh`);
    return empty;
  }
}

export function writeIndex(
  out: string,
  label: string,
  cells: readonly SheetCell[],
  notes: readonly string[],
  batch: { gl: string; stepJumpMs: number; port: number; revision: string; dirty: boolean },
  subjects: readonly WeightSubject[]
): void {
  const previous = loadExisting(out, label);
  const merged = new Map<string, SheetCell>();
  for (const c of previous.cells) merged.set(cellKey(c), c);
  for (const c of cells) merged.set(cellKey(c), c);
  cells = [...merged.values()].sort((a, b) => a.subject.localeCompare(b.subject) || a.phase.localeCompare(b.phase) || a.ms - b.ms);
  notes = [...new Set([...previous.notes, ...notes])];
  const subjectsById = new Map<string, WeightSubject>();
  for (const s of previous.subjects) subjectsById.set(s.id, s);
  for (const s of subjects) subjectsById.set(s.id, s);
  subjects = [...subjectsById.values()];

  const machine = `${process.platform}-${process.arch}, node ${process.version}`;
  const snapshot: ConditionsSnapshot = {
    machine,
    gl: batch.gl,
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    maps: [...new Set(subjects.map((s) => s.map))],
    renderer: 'three',
    port: batch.port,
    establishZoom: ESTABLISH_ZOOM,
    ladderZoom: LADDER_ZOOM,
    crop: CLOSE_CROP,
    frameMs: FRAME_MS,
    tickMs: TICK_MS,
    tickAlphas: TICK_ALPHAS,
    stepJumpMs: batch.stepJumpMs,
    sampleMs: SAMPLE_MS,
    revision: batch.revision,
    dirty: batch.dirty,
  };
  const conditions = [...previous.conditions, snapshot];

  const condLines = [
    ``,
    `## Capture conditions (latest of ${conditions.length} batch(es) -- see sheet.json's ` +
      `\`conditions\` array for every one)`,
    ``,
    `- machine: ${machine}`,
    `- revision: ${snapshot.revision}${snapshot.dirty ? ' (dirty worktree)' : ''}`,
    `- GL backend: ${snapshot.gl.replace(/\|/g, '/')}`,
    `- viewport: ${VIEWPORT.width}x${VIEWPORT.height}, deviceScaleFactor 1, headless chromium`,
    `- maps: ${snapshot.maps.join(', ')}, \`&renderer=three\`, dev server on :${snapshot.port}`,
    `- zooms: ${ESTABLISH_ZOOM} establishing still (full frame), ${LADDER_ZOOM} ladder`,
    `  (${CLOSE_CROP.width}x${CLOSE_CROP.height} crop, lifted ${CLOSE_CROP_LIFT_PX} px, following the vehicle)`,
    `- frame loop: frozen (FREEZE_FRAME_LOOP_SCRIPT); every tick pumped by hand across ${TICK_ALPHAS.length} frames of ${FRAME_MS.toFixed(2)} ms`,
    `- \`step(1)\` frame jump: ${snapshot.stepJumpMs.toFixed(2)} ms, measured at this batch's own boot`,
    `- isolation: one page per (subject, phase) run -- see the module header`,
  ];
  const noteLines = notes.length > 0 ? [``, `## Notes`, ``, ...notes.map((n) => `- ${n}`)] : [];
  const md = sheetIndex(label, cells) + [...condLines, ...noteLines].join('\n') + '\n';
  fs.writeFileSync(path.join(out, 'sheet.md'), md);
  fs.writeFileSync(
    path.join(out, 'sheet.json'),
    JSON.stringify(
      {
        label,
        conditions,
        subjects,
        phases: WEIGHT_PHASES,
        cells,
        notes,
      },
      null,
      2
    ) + '\n'
  );
  console.log(`index at ${path.join(out, 'sheet.md')} (${cells.length} frames)`);
}

// Only when run as a script. The spec imports this module for its pure half,
// and a module that boots a browser on import would make `pnpm test` start a
// dev server.
const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().then(
    () => process.exit(process.exitCode ?? 0),
    (err: unknown) => {
      console.error(err);
      process.exit(1);
    }
  );
}
