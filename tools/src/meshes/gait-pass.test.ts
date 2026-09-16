/**
 * The gait pass, checked against real shipped GLBs.
 *
 * Unlike `wreck-pass.test.ts`, this cannot use a hand-built in-memory
 * fixture for its core property: `measureGait` reads real skinning and
 * animation data (`mesh_gait.ts`'s `measureRoleTravel`), and fabricating a
 * skinned, animated rig byte-for-byte would be testing a fixture built to
 * pass rather than the instrument itself. `mesh_gait.test.ts` already made
 * this call for the read side; the mutating tests below copy a real shipped
 * file into a scratch directory first, so nothing here ever writes to
 * `art/meshes/`.
 */
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { groundPerCycleM, measureRoleTravel } from '../mesh_gait';
import { RIGGED_UNIT_MESHES } from '../../../packages/app/src/mesh-catalogue';
import {
  GAIT_ROLE,
  MIN_GAIT_TRAVEL_M,
  MOVE_CLIP,
  MOVE_FIRE_CLIP,
  applyGaitPass,
  measureGait,
  parseGaitArgs,
  processGaitFile,
  runGaitPass,
} from './gait-pass';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const MESHES = path.join(REPO, 'art', 'meshes');

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const scratchDirs: string[] = [];
function scratchCopy(sourceRel: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'gait-pass-test-'));
  scratchDirs.push(dir);
  const dest = path.join(dir, path.basename(sourceRel));
  writeFileSync(dest, readFileSync(path.join(MESHES, sourceRel)));
  return dest;
}

afterEach(() => {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// Every file RIGGED_UNIT_MESHES claims, flattened -- the exact set this pass
// processes (see gait-pass.ts's own header for why that is a deliberate
// scope and not every GLB under art/meshes/).
const ALL_RIGGED_FILES: readonly string[] = Object.values(RIGGED_UNIT_MESHES).flatMap((e) => e.files);

const EXPECTED_SKIP_TYPES = ['atgm_cell', 'mortar_crew', 'digger_crew', 'moto_rpg'] as const;

describe('measureGait over every shipped rigged mesh', () => {
  // Counts, not iteration: an empty result silently passing a `for` loop is
  // exactly how `measureFacing` stayed blind to four rigs for two tasks
  // (see mesh_gait.ts's own `measureFacing` doc comment). This asserts the
  // total shape of the whole tree, not just that each individual call did
  // not throw.
  it('declares a gait for every file except the four named exemptions', () => {
    expect(ALL_RIGGED_FILES.length).toBe(19);

    const skipped: string[] = [];
    const declared: string[] = [];
    let moveFireCount = 0;
    for (const file of ALL_RIGGED_FILES) {
      const result = measureGait(path.join(MESHES, file));
      if (result.skipReason) {
        skipped.push(file);
      } else {
        declared.push(file);
        expect(result.clips.move, file).toBeDefined();
        if (result.clips.moveFire) moveFireCount++;
      }
    }

    expect(skipped.sort()).toEqual(
      ['atgm_cell.glb', 'mortar_crew.glb', 'digger_crew.glb', 'moto_rpg.glb'].sort()
    );
    expect(declared.length).toBe(15);
    // Only the two Meshy-sourced bipeds carry moveFire today.
    expect(moveFireCount).toBe(2);
  });

  it.each(EXPECTED_SKIP_TYPES)('%s is a named skip, and really is degenerate', (type) => {
    const entry = RIGGED_UNIT_MESHES[type];
    expect(entry, type).toBeDefined();
    for (const file of entry.files) {
      const abs = path.join(MESHES, file);
      // The skip is not vacuous: confirm independently that the raw travel
      // really does sit under the floor this pass gates on, rather than
      // merely trusting measureGait's own verdict about itself.
      const raw = measureRoleTravel(abs, GAIT_ROLE, MOVE_CLIP);
      expect(raw.maxTravelM, file).toBeLessThan(MIN_GAIT_TRAVEL_M);

      const result = measureGait(abs);
      expect(result.clips).toEqual({});
      expect(result.skipReason, file).toBeDefined();
    }
  });

  // The brief's own warning: do not assume a file is exempt by resemblance.
  // sniper_team comes from a different build path than the other kit teams
  // and carries no `face` role, which is measureFacing's concern, not
  // gait's -- verified here that it walks like any other file.
  it('sniper_team is NOT a skip -- it has a boot role and a real gait', () => {
    const result = measureGait(path.join(MESHES, 'sniper_team.glb'));
    expect(result.skipReason).toBeUndefined();
    expect(result.clips.move).toBeDefined();
    expect(result.clips.move?.strideM).toBeGreaterThan(MIN_GAIT_TRAVEL_M);
  });
});

describe('measureGait declares exactly what the instrument independently measures', () => {
  // This is the property Task 7's gate relies on: the declared numbers must
  // be traceable to a SEPARATE, freshly invoked measureRoleTravel call, not
  // merely internally consistent with whatever measureGait computed for
  // itself. toBe (not toBeCloseTo) because both calls run the identical
  // deterministic skinning pass over identical bytes.
  it('move: strideM/cycleS equal a fresh measureRoleTravel call', () => {
    const abs = path.join(MESHES, 'demo_squad.glb');
    const declared = measureGait(abs);
    const fresh = measureRoleTravel(abs, GAIT_ROLE, MOVE_CLIP);
    expect(declared.clips.move?.strideM).toBe(fresh.maxTravelM);
    expect(declared.clips.move?.cycleS).toBe(fresh.clipSeconds);
  });

  it('moveFire: strideM/cycleS equal a fresh measureRoleTravel call', () => {
    const abs = path.join(MESHES, 'meshy_soldier.glb');
    const declared = measureGait(abs);
    const fresh = measureRoleTravel(abs, GAIT_ROLE, MOVE_FIRE_CLIP);
    expect(declared.clips.moveFire?.strideM).toBe(fresh.maxTravelM);
    expect(declared.clips.moveFire?.cycleS).toBe(fresh.clipSeconds);
  });

  // Cross-checked against the exact ratios `mesh_gait.test.ts` already gates
  // for these files, using groundPerCycleM the same way that suite does --
  // so this pass's declared numbers are shown to reproduce a fact already
  // established independently, not just to be self-consistent.
  it('reproduces the KIT-table walk ratio mesh_gait.test.ts already gates for at_team', () => {
    const abs = path.join(MESHES, 'at_team.glb');
    const declared = measureGait(abs);
    const move = declared.clips.move;
    if (!move) throw new Error('at_team unexpectedly has no move gait');
    const ground = groundPerCycleM(0.7, move.cycleS);
    // mesh_gait.test.ts's own KIT row: ['at_team', 0.7, 0.824] -- "every row
    // must beat" 0.824.
    expect(move.strideM / ground).toBeGreaterThan(0.824);
  });
});

describe('applyGaitPass', () => {
  function loadScene(): { doc: Document } {
    const doc = new Document();
    doc.createScene('Scene');
    return { doc };
  }

  it('writes rl_gait onto the scene extras, alongside whatever else is there', () => {
    const { doc } = loadScene();
    const scene = doc.getRoot().listScenes()[0];
    scene.setExtras({ rl_unrelated: 'keep-me' });

    applyGaitPass(doc, { move: { strideM: 1.28, cycleS: 0.667 } });

    const extras = scene.getExtras();
    expect(extras.rl_unrelated).toBe('keep-me');
    expect(extras.rl_gait).toEqual({ move: { strideM: 1.28, cycleS: 0.667 } });
  });

  // The trap this pass actually has, in place of wreck-pass.ts's orphaned
  // accessors: a stale rl_gait must be REPLACED wholesale, not merged
  // key-by-key, or a clip the file no longer has (moveFire dropped by a
  // re-export, say) survives as a ghost entry from an earlier run. Breaking
  // this by hand (implementing applyGaitPass with
  // `{ ...oldRlGait, ...gait }` instead of a plain assignment) makes this
  // test fail: the stale `moveFire` and the stale `move.strideM` both leak
  // through. Tried it; it failed as expected; reverted.
  it('fully replaces a stale rl_gait rather than merging over it', () => {
    const { doc } = loadScene();
    const scene = doc.getRoot().listScenes()[0];
    scene.setExtras({
      rl_gait: {
        move: { strideM: 999, cycleS: 999 },
        moveFire: { strideM: 999, cycleS: 999 },
      },
    });

    applyGaitPass(doc, { move: { strideM: 1.28, cycleS: 0.667 } });

    expect(scene.getExtras().rl_gait).toEqual({ move: { strideM: 1.28, cycleS: 0.667 } });
  });

  it('deletes rl_gait outright for a skip, rather than writing an empty object', () => {
    const { doc } = loadScene();
    const scene = doc.getRoot().listScenes()[0];
    scene.setExtras({ rl_gait: { move: { strideM: 1.28, cycleS: 0.667 } } });

    applyGaitPass(doc, {});

    expect(Object.prototype.hasOwnProperty.call(scene.getExtras(), 'rl_gait')).toBe(false);
  });

  it('refuses a document with no scene', () => {
    const doc = new Document();
    expect(() => applyGaitPass(doc, {})).toThrow(/no scene/);
  });
});

describe('processGaitFile / the full read-measure-apply-write cycle', () => {
  it('writes a stride a later reader can use, and is idempotent', async () => {
    // A copy of one shipped file (demo_squad.glb: a normal kit-team walker,
    // not one of the four skips), processed twice in a row on disk -- the
    // shape wreck-pass.test.ts's own idempotency test uses, extended to a
    // real round trip through io.read/io.write since this pass's contract
    // is a property of the SOURCE bytes, not of an in-memory Document alone.
    const target = scratchCopy('demo_squad.glb');

    const first = await processGaitFile(io, target);
    expect(first.skipReason).toBeUndefined();
    const onceBytes = readFileSync(target);

    const second = await processGaitFile(io, target);
    const twiceBytes = readFileSync(target);

    expect(second.clips).toEqual(first.clips);
    expect(twiceBytes.equals(onceBytes)).toBe(true);

    // And the extras really did land where Task 6 will read them from.
    const doc = await io.read(target);
    const scene = doc.getRoot().listScenes()[0];
    expect(scene.getExtras().rl_gait).toEqual(first.clips);
  });

  it('leaves a skip with no prior rl_gait untouched -- no write at all', async () => {
    // atgm_cell.glb ships from Blender with no rl_gait key, so there is
    // nothing to declare and nothing stale to strip. processGaitFile must
    // not even call io.write. Asserted through the file's own mtime rather
    // than a byte comparison against `art/meshes/atgm_cell.glb`: this suite
    // runs against a shared worktree, and that source file's byte layout
    // depends on whatever this pass (or an earlier version of it,
    // mid-development) has already done to it this session. An unbumped
    // mtime is a direct signal that no write syscall happened at all, not
    // merely that the write happened to reproduce the same bytes.
    const target = scratchCopy('atgm_cell.glb');
    const before = statSync(target).mtimeMs;

    const first = await processGaitFile(io, target);
    expect(first.skipReason).toBeDefined();
    expect(statSync(target).mtimeMs).toBe(before);

    await processGaitFile(io, target);
    expect(statSync(target).mtimeMs).toBe(before);
  });

  it('DOES write a declared file -- the mtime check above is not vacuous', async () => {
    const target = scratchCopy('demo_squad.glb');
    const before = statSync(target).mtimeMs;

    // A real filesystem's mtime can tie at sub-millisecond write speed on
    // some platforms; sleeping a tick makes the positive half of this pair
    // trustworthy rather than coincidentally passing because nothing had
    // time to differ.
    await new Promise((resolve) => setTimeout(resolve, 10));

    const result = await processGaitFile(io, target);
    expect(result.skipReason).toBeUndefined();
    expect(statSync(target).mtimeMs).not.toBe(before);
  });

  it('still strips a STALE rl_gait from a skip that used to walk and no longer does', async () => {
    // The one case where a skip DOES need a write: a re-export made the
    // clip degenerate (or removed the leg keys), but the file still carries
    // rl_gait from an earlier, walking version of the same rig. Simulated
    // here by hand-writing a bogus rl_gait onto a copy of a genuine skip
    // file before processing it.
    const target = scratchCopy('atgm_cell.glb');
    const staleDoc = await io.read(target);
    applyGaitPass(staleDoc, { move: { strideM: 1.28, cycleS: 0.667 } });
    await io.write(target, staleDoc);
    const staleBytes = readFileSync(target);

    const result = await processGaitFile(io, target);

    expect(result.skipReason).toBeDefined();
    expect(readFileSync(target).equals(staleBytes)).toBe(false);
    const doc = await io.read(target);
    expect(Object.prototype.hasOwnProperty.call(doc.getRoot().listScenes()[0].getExtras(), 'rl_gait')).toBe(
      false
    );
  });

  it('re-declares onto a file already carrying a DIFFERENT stale rl_gait from a prior run', async () => {
    // Simulates the real trap: a re-export ran, the boots moved differently,
    // and this pass is being re-run over a file that already has the OLD
    // numbers baked in from before. The second measurement must win outright.
    const target = scratchCopy('demo_squad.glb');
    const staleDoc = await io.read(target);
    applyGaitPass(staleDoc, { move: { strideM: 42, cycleS: 42 }, moveFire: { strideM: 42, cycleS: 42 } });
    await io.write(target, staleDoc);

    const result = await processGaitFile(io, target);

    const doc = await io.read(target);
    const rlGait = doc.getRoot().listScenes()[0].getExtras().rl_gait;
    expect(rlGait).toEqual(result.clips);
    expect(rlGait).not.toEqual({
      move: { strideM: 42, cycleS: 42 },
      moveFire: { strideM: 42, cycleS: 42 },
    });
  });
});

describe('runGaitPass', () => {
  it('refuses a unit type with no catalogue entry', async () => {
    await expect(runGaitPass(['not_a_unit_type'])).rejects.toThrow(/not_a_unit_type/);
  });
});

describe('parseGaitArgs', () => {
  it('reads --id= flags, and tolerates the separator pnpm forwards verbatim', () => {
    expect(parseGaitArgs([])).toBe('all');
    expect(parseGaitArgs(['--'])).toBe('all');
    expect(parseGaitArgs(['--', '--id=at_team', '--id=civilians'])).toEqual(['at_team', 'civilians']);
  });

  // A typo falling through to "all" would silently rewrite every tracked
  // rigged-unit GLB the caller never asked about.
  for (const argv of [
    ['--id', 'at_team'],
    ['--ids=at_team'],
    ['--id='],
    ['at_team'],
    ['--all'],
    ['--id=at_team', '--force'],
  ]) {
    it(`refuses [${argv.join(' ')}] rather than defaulting to every unit type`, () => {
      expect(() => parseGaitArgs(argv)).toThrow(/unrecognised argument/);
    });
  }
});
