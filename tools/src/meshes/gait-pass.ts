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
 * fresh `measureRoleTravel` compared against the declared value) exists to
 * catch.
 *
 * ## What gets written
 *
 * One scene-level glTF extra per file, added to whatever `extras` the scene
 * already carries rather than replacing them wholesale:
 *
 *     rl_gait: { move: { strideM, cycleS }, moveFire?: { strideM, cycleS } }
 *
 * `strideM` is `measureRoleTravel(path, 'boot', clip).maxTravelM` and
 * `cycleS` is that same call's `clipSeconds` -- declared exactly as
 * measured, not derived from a unit's speed. That is a deliberate contract,
 * not an oversight: Task 7's gate checks the declared value against a FRESH
 * `measureRoleTravel` call on the same file and clip, and the two can only
 * ever agree if this pass never does arithmetic of its own on top of the
 * instrument's own numbers. `groundPerCycleM` (also in `mesh_gait.ts`) is
 * therefore NOT called here -- it turns a stride and a cycle length into a
 * ground-plane speed, which is exactly the computation Task 6's renderer and
 * Task 7's gate each do on their own side of this contract. Calling it here
 * too would be a second, and potentially drifting, notion of "ground speed"
 * for the same two numbers. This pass's own test suite exercises it, as a
 * sanity cross-check against the ratios `mesh_gait.test.ts` already gates --
 * see that file's header for why a second implementation of a measurement is
 * the failure mode this project keeps getting bitten by.
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
 * ## Skips: four named exemptions, not errors
 *
 * `atgm_cell`, `mortar_crew` and `digger_crew` are crew-served -- every
 * figure carries `animates: False` in `teams.py`'s own `TEAMS` table -- and
 * ship a degenerate ~0.04s `move` with no leg keys at all; `moto_rpg` is a
 * motorcycle whose riders' boots do not move. All four DO carry a `move`
 * clip and a `boot` mesh (measured directly, 2026-09-16: every one of them
 * resolves through `measureRoleTravel` without throwing), so the skip is
 * not "clip absent" or "role absent" -- it is that the measured travel is
 * degenerate. `MIN_GAIT_TRAVEL_M` draws that line at the same 0.1 m
 * `mesh_gait.test.ts`'s own STILL assertion already uses
 * (`expect(m.maxTravelM).toBeLessThan(0.1)`), against measured values of
 * 0.0000-0.0547 m for these four and 0.66-1.63 m for every walking rig in
 * this tree -- reused rather than a second number invented for the same
 * fact. A file that throws outright (no `move` clip, no `boot` role, an
 * unskinned `boot` mesh) is treated the same way: a skip, not a crash,
 * because a shape this pass has never seen should fail loudly through the
 * printed line below rather than take the whole run down with it.
 *
 * `sniper_team` is NOT one of the four, and was checked rather than assumed:
 * it comes from a different build path than the other kit teams (absent
 * from both `mesh_gait.test.ts`'s KIT and STILL tables) and has no `face`
 * role, but it measures a completely ordinary walk --
 * `maxTravelM=0.7355 m`, `clipSeconds=1.0000s` -- so it is processed like
 * any other file here. The "no `face` role" fact is `measureFacing`'s
 * problem, not this pass's: gait reads only the `boot` mesh.
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
import { measureRoleTravel } from '../mesh_gait';
import { RIGGED_UNIT_MESHES } from '../../../packages/app/src/mesh-catalogue';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const MESHES = path.join(REPO, 'art', 'meshes');

/** The one role this pass reads -- see `mesh_gait.ts`'s own header for why
 *  the boots, and not the root, are what a gait is measured from. */
export const GAIT_ROLE = 'boot';

export const MOVE_CLIP = 'move';
export const MOVE_FIRE_CLIP = 'moveFire';

/** See the file header's "Skips" section for the measured values either
 *  side of this line. */
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
  /** Set iff `clips` is empty -- a skip, not an error. Printed by the CLI. */
  readonly skipReason?: string;
}

type ClipMeasurement = GaitClipMetrics | { readonly error: string };

/** One clip, measured and floor-checked. Never throws -- a missing clip, a
 *  missing role or an unskinned mesh all come back as `{ error }` so the
 *  caller decides what a failure to measure MEANS for that clip rather than
 *  this function deciding it for every caller. */
function measureClip(absPath: string, clip: string): ClipMeasurement {
  let m: ReturnType<typeof measureRoleTravel>;
  try {
    m = measureRoleTravel(absPath, GAIT_ROLE, clip);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  if (m.maxTravelM < MIN_GAIT_TRAVEL_M) {
    return {
      error:
        `no measurable "${clip}" gait (maxTravelM=${m.maxTravelM.toFixed(4)} m, under the ` +
        `${MIN_GAIT_TRAVEL_M} m floor -- crew-served or non-walking rig)`,
    };
  }
  return { strideM: m.maxTravelM, cycleS: m.clipSeconds };
}

const isError = (m: ClipMeasurement): m is { readonly error: string } =>
  Object.prototype.hasOwnProperty.call(m, 'error');

/**
 * Measure every locomotion clip `absPath`'s own bytes carry. `move` gates
 * the whole file: if it cannot be measured or reads as degenerate, the file
 * is a skip and `moveFire` is not even attempted, because a file with no
 * real walk has no real walk-and-shoot either (true of all four shipped
 * exemptions). `moveFire`'s own absence, when `move` is fine, is the common
 * case (thirteen of the fifteen walking files here have no such clip) and is
 * silently omitted rather than reported as anything -- only `move` failing
 * is a named skip.
 */
export function measureGait(absPath: string): GaitMeasureResult {
  const move = measureClip(absPath, MOVE_CLIP);
  if (isError(move)) return { clips: {}, skipReason: move.error };

  const clips: { move: GaitClipMetrics; moveFire?: GaitClipMetrics } = { move };
  const fire = measureClip(absPath, MOVE_FIRE_CLIP);
  if (!isError(fire)) clips.moveFire = fire;
  return { clips };
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

/** Apply the pass to the named unit types (or all of them) and write every
 *  file each one claims back to `art/meshes/`. */
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
      const result = await processGaitFile(io, abs);
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
