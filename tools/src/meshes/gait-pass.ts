/**
 * The gait pass: give every rigged infantry GLB a declaration, in its own
 * bytes, of what its `move` and `moveFire` clips actually cover on the
 * ground.
 *
 *     pnpm gait:meshes                    # every rigged unit mesh
 *     pnpm gait:meshes -- --id=at_team    # one unit type
 *
 * Design: `docs/superpowers/specs/2026-09-15-infantry-gait-design.md` §3.4.
 * This is `tools/src/meshes/wreck-pass.ts`'s sibling -- same shape, same
 * `@gltf-transform` post-export pass, idempotent, re-runnable after any
 * re-export, invoked by its own pnpm script. Read that file before touching
 * this one.
 *
 * **Ordering matters.** `art/meshes/` is the uncompressed source of record
 * and `assets/meshes/` is what ships, exactly as `encode-meshes.ts`'s own
 * header describes:
 *
 *     re-export (Blender)  ->  pnpm gait:meshes  ->  pnpm encode:meshes
 *
 * This pass writes into `art/meshes/`; the encode step mirrors the result
 * into `assets/meshes/`. Running it out of order -- encoding before gaiting,
 * or re-exporting after gaiting without re-running this pass -- leaves the
 * shipped file's `rl_gait` stale, which is exactly what Task 7's gate (a
 * fresh re-measurement compared against the declared value) exists to catch.
 *
 * ## What gets written
 *
 * One scene-level glTF extra per file, added to whatever `extras` the scene
 * already carries rather than replacing them wholesale:
 *
 *     rl_gait: { move: { strideM, cycleS }, moveFire?: { strideM, cycleS } }
 *
 * ## `strideM` is the FORWARD component, not the 3-D travel
 *
 * **Fix round 1, 2026-09-16.** The first version of this pass declared
 * `measureRoleTravel(...).maxTravelM` -- the worst boot vertex's 3-D
 * peak-to-peak travel, the hypotenuse of its per-axis ranges. Task 6 divides
 * a declared `strideM` by `cycleS` and treats the result as a GROUND speed,
 * but the hypotenuse folds in vertical lift and lateral swing, so it
 * overstates how far the boot actually moves ALONG the direction of travel.
 * Measured across the seventeen declarations this pass makes today, the
 * forward fraction of the old hypot ranges 0.823-0.985 -- worst on
 * `meshy_soldier`'s `move` (0.823) and `farm_worker` (0.830) -- and the bias
 * is rig-dependent, so no single constant applied downstream could correct
 * for it. `strideM` is now `measureRoleFootprint(path, 'boot',
 * clip).axisTravelM[0]`: the SAME worst vertex `measureRoleTravel` would
 * have picked, but only its `+x` component -- `mesh_gait.ts`'s own
 * `RoleFootprint.axisTravelM` doc comment already names `+x` as glTF's own
 * up-is-`y` contract forward, and `measureRoleFootprint`'s own comment
 * already warns that "a long step and a high heel kick are the same number"
 * to the hypot. `cycleS` is unchanged (`clipSeconds` from the same call).
 *
 * **The forward axis was verified, not assumed, on rigs from both
 * pipelines**, because these rigs go through a post-export forward fix and
 * a wrong axis would silently mis-declare every file rather than fail
 * loudly. Measured 2026-09-16 (`measureRoleFootprint('boot','move')`):
 *
 *     kit.py     demo_squad    axisTravelM x=1.4673 y=0.4977 z=0.1076
 *     kit.py     charge_squad  axisTravelM x=1.5297 y=0.5646 z=0.1128
 *     Meshy      meshy_soldier axisTravelM x=1.0948 y=0.7464 z=0.1185
 *     Meshy      sarim_rifles  axisTravelM x=1.1355 y=0.7296 z=0.1384
 *
 * `x` dominates `y` and `z` by a wide margin on every rig from both
 * pipelines -- never less than 2x the vertical component and an order of
 * magnitude over the lateral one -- and `measureFacing('move')` independently
 * reads both `demo_squad` and `meshy_soldier` within a few degrees of 0
 * (`+2.6`/`-2.6`), which is what "facing `+x`, walking along `+x`" predicts.
 * `mesh_gait.test.ts`'s own `measureRoleFootprint` describe block already
 * pinned `x`-dominance for a kit.py rig (`militia_cell`); this confirms the
 * same holds for the Meshy pipeline rather than assuming it carries over.
 *
 * ## `cycleS` names a cycle and measures a clip -- and that is a precondition
 *
 * Peak-to-peak travel is invariant to how many gait cycles a clip's sampled
 * window contains; clip length (`clipSeconds`, i.e. `cycleS`) is not. A
 * future re-export that bakes two strides into one `move` would halve the
 * true per-cycle ground speed while this pass kept printing `GAIT_PASS_OK`
 * and Task 7's declared-vs-measured gate stayed green, because both sides
 * of that equality would still agree with each other -- just with each
 * other, not with the ground. **This pass therefore assumes one clip is one
 * cycle, and checks that assumption rather than trusting it silently**:
 * `mesh_gait.ts`'s `countTracePeaks`, run over `bestVertexTrace.forwardM`
 * (the same vertex `strideM` is read from), reads exactly 1 for every one
 * of the seventeen declarations this pass makes today -- see that
 * function's own doc comment for the phase-alignment trick and the
 * positive control (a trace concatenated with itself reads as 2, three
 * copies as 3) that proves the check can fail. A clip that does not read as
 * exactly one cycle is not failed outright -- a WARN is printed by name
 * (`GAIT_PASS_WARN`) rather than the pass refusing to declare a gait for it,
 * because this is a new, freshly-calibrated heuristic on real production
 * rigs and a false positive that silently blocked every future re-export
 * would be worse than a number that needs a human to look at it once. The
 * warning is loud on the passing path specifically so it cannot be missed
 * the way `GAIT_PASS_OK` would be if this were folded into it.
 *
 * ## `groundPerCycleM` is deliberately not called here
 *
 * `strideM`/`cycleS` are declared exactly as measured, not derived from a
 * unit's speed -- Task 7's gate checks the declared value against a FRESH
 * measurement of the same file and clip, and the two can only ever agree if
 * this pass never does arithmetic of its own on top of the instrument's own
 * numbers. `groundPerCycleM` turns a stride and a cycle length into a
 * ground-plane speed, which is exactly the computation Task 6's renderer and
 * Task 7's gate each do on their own side of this contract; doing it here
 * too would be a second, and potentially drifting, notion of "ground speed"
 * for the same two numbers. This pass's own test suite exercises it instead,
 * as a sanity cross-check against the ratios `mesh_gait.test.ts` already
 * gates -- see that file's header for why a second implementation of a
 * measurement is the failure mode this project keeps getting bitten by.
 *
 * ## Scope: `RIGGED_UNIT_MESHES`, not a blind walk of `art/meshes/**`
 *
 * `packages/app/src/mesh-catalogue.ts`'s `RIGGED_UNIT_MESHES` is plain data
 * with no `import.meta.url` in it, deliberately so a node-side reader can
 * import it directly -- the same reason `mesh_gait.test.ts` already does.
 * This pass processes exactly the files that table claims, which is also
 * exactly the set `main.ts` ever loads into the running game. That excludes:
 *
 *  - every vehicle and building GLB (no `boot` role, no `move`/`moveFire`
 *    semantics -- `wreck-pass.ts`'s territory, not this one's);
 *  - the three RETIRED rig.py-built files that still sit on disk beside their
 *    Meshy replacements (`inf_squad.glb`, `mortar_team.glb`,
 *    `yahalom_squad.glb` -- superseded by `meshy_soldier.glb`,
 *    `meshy_mortar_team.glb`, `yahalom_engineer.glb` respectively, per
 *    `mesh-catalogue.ts`'s own comments on `RETIRED_MESH_FILES`). Measuring
 *    them costs nothing extra, but writing extras onto a file nothing loads
 *    would be dead weight in a tracked binary for no reader.
 *
 * ## Skips are for a DEGENERATE measurement, never for a thrown one
 *
 * **Fix round 1.** The first version of this pass caught every failure mode
 * -- a missing clip, a missing role, an unskinned mesh, a genuinely corrupt
 * file -- the same way it handled a legitimately degenerate measurement:
 * one `GAIT_PASS_SKIP` line among nineteen, and the CLI exited 0 regardless.
 * That is wrong for anything this pass did not expect, because Task 6's
 * documented fallback for a unit type with no declared `rl_gait` is
 * `timeScale = 1` -- exactly the sliding this milestone exists to remove --
 * so a corrupt file silently reporting success would silently reintroduce
 * the defect on whatever unit it belonged to. Only a SUCCESSFULLY measured
 * clip whose travel reads as degenerate is a skip now; a THROWN error (no
 * such clip, no `boot` role, an unskinned mesh) for `move` -- the clip that
 * gates the whole file -- is not caught here at all and propagates out of
 * `measureGait`, through `processGaitFile`, through `runGaitPass`'s loop, to
 * `main`'s own catch, which prints the message and exits 1. `moveFire`'s own
 * absence is the one thrown condition still caught and silently tolerated,
 * because it is the common, expected case -- thirteen of the fifteen
 * declaring files have no such clip at all -- and `move` has already proven
 * the file's `boot` role and skin are sound by the time `moveFire` is even
 * attempted.
 *
 * `moto_rpg` is a motorcycle whose riders' boots do not move -- the one
 * remaining skip. It DOES carry a `move` clip and a `boot` mesh (measured
 * directly, 2026-09-16: it resolves through `measureRoleFootprint` without
 * throwing), so the skip is not "clip absent" or "role absent" -- it is
 * that the measured forward travel is degenerate. `MIN_GAIT_TRAVEL_M` draws
 * that line at the same 0.1 m `mesh_gait.test.ts`'s own STILL assertion
 * already uses (`expect(m.maxTravelM).toBeLessThan(0.1)`), reused rather
 * than a second number invented for the same fact -- and it still separates
 * cleanly under the forward-only metric, since a forward component can only
 * be smaller than the hypot it used to be measured from: moto_rpg reads
 * 0.0184 m, against 0.64-1.53 m for every declaring file.
 *
 * `atgm_cell`, `mortar_crew` and `digger_crew` were here too, and read
 * 0.0000 m under this same metric, until the 2026-09-17
 * infantry-animation branch gave all three a standing walker
 * (`rig.py`'s `build_move_clip`) rather than the crew-served
 * `animates: False` pose `teams.py`'s `TEAMS` table used to carry for them.
 * Their `move` clips now measure 0.99-1.30 m of real forward travel, well
 * clear of `MIN_GAIT_TRAVEL_M`, so `measureGait` declares a gait for all
 * three like any other file -- this pass needed no change of its own to
 * pick that up, since the skip was always a measured floor rather than a
 * name list.
 *
 * `sniper_team` is NOT a skip either, and was checked rather than assumed:
 * it comes from a different build path than the other kit teams (absent
 * from both `mesh_gait.test.ts`'s KIT and STILL tables) and has no `face`
 * role, but it measures a completely ordinary walk. The "no `face` role"
 * fact is `measureFacing`'s problem, not this pass's: gait reads only the
 * `boot` mesh.
 *
 * ## Idempotency
 *
 * Nothing here creates a node, an accessor or a buffer view, so this pass
 * does not have `wreck-pass.ts`'s orphaned-accessor trap. The trap here is
 * narrower but real: `scene.setExtras` takes the WHOLE extras object, so a
 * naive `{ ...current, rl_gait: gait }` reassignment already replaces the
 * key correctly on the happy path, but only because `gait` is built fresh
 * from a full re-measurement every run -- a clip that stopped existing (say
 * a re-export dropped `moveFire`) is simply absent from the new object
 * rather than merged over the old one. A SKIP goes one step further and
 * deletes `rl_gait` outright rather than writing `{}`, so a file that used
 * to walk and now does not is left with no stale claim about a gait it no
 * longer has.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, type Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { countTracePeaks, measureRoleFootprint } from '../mesh_gait';
import { RIGGED_UNIT_MESHES } from '../../../packages/app/src/mesh-catalogue';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const MESHES = path.join(REPO, 'art', 'meshes');

/** The one role this pass reads -- see `mesh_gait.ts`'s own header for why
 *  the boots, and not the root, are what a gait is measured from. */
export const GAIT_ROLE = 'boot';

export const MOVE_CLIP = 'move';
export const MOVE_FIRE_CLIP = 'moveFire';

/** See the file header's "Skips" section for the measured values either
 *  side of this line, under the forward-only metric. */
export const MIN_GAIT_TRAVEL_M = 0.1;

export interface GaitClipMetrics {
  readonly strideM: number;
  readonly cycleS: number;
}

/** `rl_gait`'s own shape: `move` is required when present at all, `moveFire`
 *  only exists on the two Meshy-sourced bipeds that carry that clip today. */
export interface GaitExtras {
  readonly move?: GaitClipMetrics;
  readonly moveFire?: GaitClipMetrics;
}

export interface GaitMeasureResult {
  readonly clips: GaitExtras;
  /** Set iff `clips` is empty -- a measured-degenerate skip, never a thrown
   *  one (those propagate -- see the file header). Printed by the CLI. */
  readonly skipReason?: string;
  /** One message per clip whose sampled boot trace does not read as exactly
   *  one gait cycle. Empty on the common path. Advisory, not fatal -- see
   *  the file header's "cycleS names a cycle" section. */
  readonly warnings: readonly string[];
}

interface ClipOk extends GaitClipMetrics {
  readonly cyclesDetected: number;
}
type ClipMeasurement = ClipOk | { readonly error: string };

const isError = (m: ClipMeasurement): m is { readonly error: string } =>
  Object.prototype.hasOwnProperty.call(m, 'error');

/**
 * One clip, measured and floor-checked. A THROWN failure from
 * `measureRoleFootprint` (no such clip, no `boot` role, an unskinned mesh)
 * is deliberately NOT caught here -- it propagates to the caller, which for
 * `move` means propagating out of this whole module (see the file header).
 * Only a clip that measures successfully but reads as degenerate comes back
 * as `{ error }`, because that is the one failure mode this pass has a name
 * and a reason for.
 */
function measureClip(absPath: string, clip: string): ClipMeasurement {
  const fp = measureRoleFootprint(absPath, GAIT_ROLE, clip);
  // `+x` is the mesh contract's forward -- verified empirically on rigs from
  // both pipelines, see the file header.
  const strideM = fp.axisTravelM[0];
  if (strideM < MIN_GAIT_TRAVEL_M) {
    return {
      error:
        `no measurable "${clip}" gait (forward strideM=${strideM.toFixed(4)} m, under the ` +
        `${MIN_GAIT_TRAVEL_M} m floor -- crew-served or non-walking rig)`,
    };
  }
  return {
    strideM,
    cycleS: fp.clipSeconds,
    cyclesDetected: countTracePeaks(fp.bestVertexTrace.forwardM),
  };
}

/** Turns one successfully-measured clip into its `rl_gait` entry, pushing a
 *  warning string when its trace does not read as exactly one cycle. */
function toGaitClipMetrics(clip: string, m: ClipOk, warnings: string[]): GaitClipMetrics {
  if (m.cyclesDetected !== 1) {
    warnings.push(
      `"${clip}" looks like ${m.cyclesDetected} gait cycle(s) baked into one clip (forward-axis trace) -- ` +
        `declared cycleS assumes exactly one; verify before trusting it`
    );
  }
  return { strideM: m.strideM, cycleS: m.cycleS };
}

/**
 * Measure every locomotion clip `absPath`'s own bytes carry. `move` gates
 * the whole file and its failures are NOT caught: a thrown error propagates
 * to the caller (a real problem, not a skip); a measured-but-degenerate
 * result becomes `skipReason` (an expected, named shape -- see the file
 * header). `moveFire`'s own absence, when `move` succeeds, is the common
 * case (thirteen of the fifteen declaring files have no such clip) and IS
 * caught and silently omitted, because `move` has already proven this
 * file's `boot` role and skin are sound.
 */
export function measureGait(absPath: string): GaitMeasureResult {
  const move = measureClip(absPath, MOVE_CLIP);
  if (isError(move)) return { clips: {}, skipReason: move.error, warnings: [] };

  const warnings: string[] = [];
  const clips: { move: GaitClipMetrics; moveFire?: GaitClipMetrics } = {
    move: toGaitClipMetrics(MOVE_CLIP, move, warnings),
  };

  let fire: ClipMeasurement | undefined;
  try {
    fire = measureClip(absPath, MOVE_FIRE_CLIP);
  } catch {
    fire = undefined; // no such clip -- the common, expected case
  }
  if (fire && !isError(fire)) clips.moveFire = toGaitClipMetrics(MOVE_FIRE_CLIP, fire, warnings);

  return { clips, warnings };
}

/**
 * Write (or remove) `rl_gait` on `doc`'s own scene. `gait` is always a full,
 * freshly measured replacement -- never merged key-by-key with whatever was
 * there before -- so a clip the file no longer has cannot survive as a ghost
 * entry from an earlier run. An empty `gait` deletes the key outright rather
 * than writing `{}`, for the same reason: "no gait" and "an empty claim
 * about a gait" are not the same fact, and only the former is true of a
 * skip.
 */
export function applyGaitPass(doc: Document, gait: GaitExtras): void {
  const scene = doc.getRoot().listScenes()[0];
  if (!scene) throw new Error('no scene');

  const extras: Record<string, unknown> = { ...scene.getExtras() };
  if (Object.keys(gait).length > 0) {
    extras.rl_gait = gait;
  } else {
    delete extras.rl_gait;
  }
  scene.setExtras(extras);
}

/**
 * Measure, apply and write back one file in place. Shared by the CLI loop
 * and by tests that want the exact same read-measure-apply-write cycle a
 * real run performs, rather than a hand-assembled approximation of it.
 * `measureGait`'s own thrown failures (see its doc comment) are not caught
 * here either -- they propagate to whatever calls `processGaitFile`.
 *
 * **Writes only when there is something to change.** A skip with no prior
 * `rl_gait` (every shipped exemption today, on a fresh export) has nothing
 * to declare and nothing stale to strip, so the file is left byte-for-byte
 * untouched -- no gltf-transform re-serialisation, no `encode:meshes`
 * re-Draco, no diff for a run that changed nothing about that file's
 * contract. A skip that DOES carry a stale `rl_gait` (a rig that used to
 * walk and no longer does, after a re-export) still gets written, because
 * that stale claim has to be removed.
 */
export async function processGaitFile(io: NodeIO, absPath: string): Promise<GaitMeasureResult> {
  const result = measureGait(absPath);
  const doc = await io.read(absPath);
  const scene = doc.getRoot().listScenes()[0];
  if (!scene) throw new Error(`${absPath}: no scene`);
  const hadStaleGait = Object.prototype.hasOwnProperty.call(scene.getExtras(), 'rl_gait');
  if (Object.keys(result.clips).length === 0 && !hadStaleGait) {
    return result;
  }
  applyGaitPass(doc, result.clips);
  await io.write(absPath, doc);
  return result;
}

// ---------------------------------------------------------------------------
// The CLI
// ---------------------------------------------------------------------------

const KNOWN = (): string => Object.keys(RIGGED_UNIT_MESHES).join(', ');

const ID_FLAG = '--id=';

/**
 * argv -> the unit types to process. Empty means every entry in
 * `RIGGED_UNIT_MESHES`. Mirrors `wreck-pass.ts`'s `parseWreckArgs` exactly,
 * including the reason every argument must be recognised: a typo that fell
 * through to "process everything" would silently rewrite every tracked GLB
 * in the table, not just the one the caller meant.
 */
export function parseGaitArgs(argv: readonly string[]): readonly string[] | 'all' {
  const ids: string[] = [];
  for (const arg of argv) {
    if (arg === '--') continue;
    if (!arg.startsWith(ID_FLAG) || arg.length === ID_FLAG.length) {
      throw new Error(
        `unrecognised argument "${arg}" -- usage: gait:meshes [--id=<unit type>]... ` +
          `-- known types: ${KNOWN()}`
      );
    }
    ids.push(arg.slice(ID_FLAG.length));
  }
  return ids.length ? ids : 'all';
}

/**
 * Apply the pass to the named unit types (or all of them) and write every
 * file each one claims back to `art/meshes/`. A THROWN failure for any
 * file's `move` clip -- corruption, a missing role, a bug in the instrument
 * -- is rewrapped with the unit id and file name and rethrown, which aborts
 * the run: `main`'s own catch prints it and exits 1, rather than the run
 * printing one skip line among many and reporting success. See the file
 * header's "Skips are for a DEGENERATE measurement" section.
 */
export async function runGaitPass(ids: readonly string[] | 'all'): Promise<void> {
  const wanted = ids === 'all' ? Object.keys(RIGGED_UNIT_MESHES) : ids;
  for (const id of wanted) {
    if (!Object.prototype.hasOwnProperty.call(RIGGED_UNIT_MESHES, id)) {
      throw new Error(`no rigged mesh entry for "${id}" -- known types: ${KNOWN()}`);
    }
  }

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  let declared = 0;
  let skipped = 0;
  for (const id of wanted) {
    const entry = RIGGED_UNIT_MESHES[id];
    for (const file of entry.files) {
      const abs = path.join(MESHES, file);
      let result: GaitMeasureResult;
      try {
        result = await processGaitFile(io, abs);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`${id} (${file}): gait measurement failed -- ${message}`);
      }
      if (result.skipReason) {
        skipped++;
        console.log(`GAIT_PASS_SKIP ${id} (${file}): ${result.skipReason}`);
      } else {
        declared++;
        const describe = (clip: string, m: GaitClipMetrics): string =>
          `${clip} strideM=${m.strideM.toFixed(4)} cycleS=${m.cycleS.toFixed(4)}`;
        const parts: string[] = [];
        if (result.clips.move) parts.push(describe(MOVE_CLIP, result.clips.move));
        if (result.clips.moveFire) parts.push(describe(MOVE_FIRE_CLIP, result.clips.moveFire));
        console.log(`GAIT_PASS_OK ${id} (${file}): ${parts.join(', ')}`);
      }
      for (const warning of result.warnings) {
        console.warn(`GAIT_PASS_WARN ${id} (${file}): ${warning}`);
      }
    }
  }
  console.log(`\n${declared + skipped} mesh(es): ${declared} declared a gait, ${skipped} skipped (no usable "move")`);
}

async function main(): Promise<number> {
  await runGaitPass(parseGaitArgs(process.argv.slice(2)));
  return 0;
}

// Only when this file is the process entry point -- it is imported by its
// own tests, which must not write to `art/meshes/`.
const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  );
}
