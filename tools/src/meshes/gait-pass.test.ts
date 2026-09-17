/**
 * The gait pass, checked against real shipped GLBs.
 *
 * Unlike `wreck-pass.test.ts`, this cannot use a hand-built in-memory
 * fixture for its core property: `measureGait` reads real skinning and
 * animation data (`mesh_gait.ts`'s `measureRoleFootprint`), and fabricating a
 * skinned, animated rig byte-for-byte would be testing a fixture built to
 * pass rather than the instrument itself. `mesh_gait.test.ts` already made
 * this call for the read side; the mutating tests below copy a real shipped
 * file into a scratch directory first, so nothing here ever writes to
 * `art/meshes/`.
 *
 * **Fix round 1.** The declared-versus-measured tests below now write the
 * role and clip as LITERAL strings (`'boot'`, `'move'`, `'moveFire'`)
 * instead of importing `GAIT_ROLE`/`MOVE_CLIP`/`MOVE_FIRE_CLIP` from
 * `./gait-pass`. That import was a real hole: with both sides of the
 * equality sourcing their arguments from the implementation under test,
 * setting `GAIT_ROLE = 'uniform'` in `gait-pass.ts` (declaring torso travel
 * instead of boot travel) left every "declares what the instrument
 * independently measures" assertion green, because both sides moved
 * together. `mesh_gait.test.ts` already writes its own oracle calls this
 * way; this file now matches it.
 */
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { Document, NodeIO, type Accessor } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { groundPerCycleM, measureRoleFootprint } from '../mesh_gait';
import { RIGGED_UNIT_MESHES } from '../../../packages/app/src/mesh-catalogue';
import {
  MIN_GAIT_TRAVEL_M,
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

// `atgm_cell`/`mortar_crew`/`digger_crew` were here too until the
// 2026-09-17 infantry-animation branch gave all three a standing walker
// (`rig.py`'s `build_move_clip`) -- their `move` clips now measure real
// forward travel (1.30/1.15/0.99 m, well clear of `MIN_GAIT_TRAVEL_M`) and
// `measureGait` no longer skips them, so keeping them in this list would be
// exactly the exemption-outlived-its-need case CLAUDE.md's gait bullet
// describes: it fails, and that failure is the instruction to delete the
// name, not to reassert it. `moto_rpg` alone remains -- a motorcycle whose
// riders' boots do not move.
const EXPECTED_SKIP_TYPES = ['moto_rpg'] as const;

describe('measureGait over every shipped rigged mesh', () => {
  // Counts, not iteration: an empty result silently passing a `for` loop is
  // exactly how `measureFacing` stayed blind to four rigs for two tasks
  // (see mesh_gait.ts's own `measureFacing` doc comment). This asserts the
  // total shape of the whole tree, not just that each individual call did
  // not throw.
  it('declares a gait for every file except the one named exemption', () => {
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

    expect(skipped.sort()).toEqual(['moto_rpg.glb']);
    expect(declared.length).toBe(18);
    // Only the two Meshy-sourced bipeds carry moveFire today.
    expect(moveFireCount).toBe(2);
  });

  it.each(EXPECTED_SKIP_TYPES)('%s is a named skip, and really is degenerate', (type) => {
    const entry = RIGGED_UNIT_MESHES[type];
    expect(entry, type).toBeDefined();
    for (const file of entry.files) {
      const abs = path.join(MESHES, file);
      // The skip is not vacuous: confirm independently, with literal role
      // and clip strings rather than the implementation's own constants,
      // that the raw FORWARD travel really does sit under the floor this
      // pass gates on -- not the 3-D hypot (see gait-pass.ts's Fix round 1
      // header section for why forward and not hypot).
      const raw = measureRoleFootprint(abs, 'boot', 'move');
      expect(raw.axisTravelM[0], file).toBeLessThan(MIN_GAIT_TRAVEL_M);

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
  // be traceable to a SEPARATE, freshly invoked measureRoleFootprint call
  // with LITERAL 'boot'/'move'/'moveFire' arguments -- not the
  // implementation's own GAIT_ROLE/MOVE_CLIP/MOVE_FIRE_CLIP constants, and
  // not merely internally consistent with whatever measureGait computed for
  // itself. toBe (not toBeCloseTo) because both calls run the identical
  // deterministic skinning pass over identical bytes. strideM is the FORWARD
  // (`axisTravelM[0]`) component, per gait-pass.ts's Fix round 1 section --
  // not the 3-D hypot `measureRoleTravel` would report.
  it('move: strideM/cycleS equal a fresh, independently-invoked measureRoleFootprint call', () => {
    const abs = path.join(MESHES, 'demo_squad.glb');
    const declared = measureGait(abs);
    const fresh = measureRoleFootprint(abs, 'boot', 'move');
    expect(declared.clips.move?.strideM).toBe(fresh.axisTravelM[0]);
    expect(declared.clips.move?.cycleS).toBe(fresh.clipSeconds);
  });

  it('moveFire: strideM/cycleS equal a fresh, independently-invoked measureRoleFootprint call', () => {
    const abs = path.join(MESHES, 'meshy_soldier.glb');
    const declared = measureGait(abs);
    const fresh = measureRoleFootprint(abs, 'boot', 'moveFire');
    expect(declared.clips.moveFire?.strideM).toBe(fresh.axisTravelM[0]);
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
    // must beat" 0.824. The forward-only strideM is smaller than the old
    // hypot, so this margin is tighter than it used to be but still clears.
    expect(move.strideM / ground).toBeGreaterThan(0.824);
  });

  // The property that makes toBe legitimate above: measuring twice, on the
  // same bytes, gives the identical float both times. If this test could
  // fail, the toBe assertions above would be flaky rather than meaningful.
  it('measureRoleFootprint itself is deterministic across repeated calls on the same file', () => {
    const abs = path.join(MESHES, 'demo_squad.glb');
    const a = measureRoleFootprint(abs, 'boot', 'move');
    const b = measureRoleFootprint(abs, 'boot', 'move');
    expect(a.axisTravelM[0]).toBe(b.axisTravelM[0]);
    expect(a.clipSeconds).toBe(b.clipSeconds);
  });
});

// Fix round 1, item 3: proving the oracle can fail. `GAIT_ROLE`/`MOVE_CLIP`
// are gait-pass.ts's OWN policy constants (not the mesh contract's), so a
// literal-argument oracle and an imported-constant one are expected to
// agree today -- this pins that they measure the SAME thing the role/clip
// names say, using the independent (mesh_gait.ts, not gait-pass.ts) API on
// both sides of the comparison, the shape the review specifically asked for.
describe('the oracle would actually catch a wrong role or clip', () => {
  it('a "uniform" role reads a materially different number than "boot" on the same file/clip', () => {
    const abs = path.join(MESHES, 'demo_squad.glb');
    const boot = measureRoleFootprint(abs, 'boot', 'move');
    const uniform = measureRoleFootprint(abs, 'uniform', 'move');
    // Not merely different -- different enough that declaring one and
    // checking it against the other could not coincidentally agree the way
    // GAIT_ROLE='uniform' did against itself in the pre-fix version.
    expect(Math.abs(boot.axisTravelM[0] - uniform.axisTravelM[0])).toBeGreaterThan(0.1);
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
    // not the one skip), processed twice in a row on disk -- the
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
    // moto_rpg.glb ships from Blender with no rl_gait key, so there is
    // nothing to declare and nothing stale to strip. processGaitFile must
    // not even call io.write. Asserted through the file's own mtime rather
    // than a byte comparison against `art/meshes/moto_rpg.glb`: this suite
    // runs against a shared worktree, and that source file's byte layout
    // depends on whatever this pass (or an earlier version of it,
    // mid-development) has already done to it this session. An unbumped
    // mtime is a direct signal that no write syscall happened at all, not
    // merely that the write happened to reproduce the same bytes.
    const target = scratchCopy('moto_rpg.glb');
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
    const target = scratchCopy('moto_rpg.glb');
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

// Fix round 1, item 2: `cycleS` names a cycle and measures a clip. A clip
// with two gait cycles baked in reads the same peak-to-peak strideM as one
// with a single cycle, and the ONLY thing that changes is cycleS -- which is
// exactly the shape a bad re-export would take, so a real (not synthetic)
// fixture is built by doubling a genuine clip's own keyframes rather than
// hand-waving the scenario.
describe('measureGait warns when a clip does not read as one gait cycle', () => {
  /** Doubles every sampler of `clipName` in a copy of `sourceRel`: each
   *  sampler's own keyframe times and values are repeated once, offset by
   *  the clip's own original duration, so the SAME motion plays twice in
   *  what is now one twice-as-long clip. A real defect shape (a re-export
   *  that bakes two strides into one `move`), not a synthetic curve. */
  async function scratchDoubledClip(sourceRel: string, clipName: string): Promise<string> {
    const target = scratchCopy(sourceRel);
    const doc = await io.read(target);
    const anim = doc.getRoot().listAnimations().find((a) => a.getName() === clipName);
    if (!anim) throw new Error(`fixture setup: ${sourceRel} has no clip "${clipName}"`);
    const doneAccessors = new Set<Accessor>();
    for (const sampler of anim.listSamplers()) {
      const input = sampler.getInput();
      const output = sampler.getOutput();
      if (!input || !output) continue;
      for (const accessor of [input, output]) {
        if (doneAccessors.has(accessor)) continue; // samplers can share one
        doneAccessors.add(accessor);
        const array = accessor.getArray();
        if (!array) continue;
        if (accessor === input) {
          const times = Array.from(array);
          const duration = times[times.length - 1] - times[0];
          const doubled = new Float32Array([...times, ...times.map((t) => t + duration)]);
          accessor.setArray(doubled);
        } else {
          const values = Array.from(array);
          const doubled = new Float32Array([...values, ...values]);
          accessor.setArray(doubled);
        }
      }
    }
    await io.write(target, doc);
    return target;
  }

  it('reads zero warnings on every one of the seventeen real declarations today', () => {
    // The false-positive check: this heuristic is new, and a warning printed
    // on every passing run would be worse than no check at all.
    let totalWarnings = 0;
    for (const file of ALL_RIGGED_FILES) {
      const result = measureGait(path.join(MESHES, file));
      totalWarnings += result.warnings.length;
    }
    expect(totalWarnings).toBe(0);
  });

  it('warns by name -- naming the clip and the cycle count -- for a genuinely doubled clip', async () => {
    const target = await scratchDoubledClip('demo_squad.glb', 'move');

    const result = measureGait(target);

    // Still declares a gait -- a warning is advisory, not a second skip
    // condition (see gait-pass.ts's header for why this is deliberate).
    expect(result.skipReason).toBeUndefined();
    expect(result.clips.move).toBeDefined();
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/"move"/);
    expect(result.warnings[0]).toMatch(/2 gait cycle/);
  });

  it('the doubled clip keeps roughly the same strideM but doubles cycleS -- the exact defect this catches', async () => {
    const before = measureGait(path.join(MESHES, 'demo_squad.glb'));
    const beforeMove = before.clips.move;
    if (!beforeMove) throw new Error('demo_squad unexpectedly has no move gait');

    const target = await scratchDoubledClip('demo_squad.glb', 'move');
    const after = measureGait(target);
    const afterMove = after.clips.move;
    if (!afterMove) throw new Error('doubled demo_squad unexpectedly has no move gait');

    expect(afterMove.cycleS).toBeCloseTo(beforeMove.cycleS * 2, 3);
    // strideM is peak-to-peak over the WHOLE window: repeating an identical
    // cycle twice does not widen the range, so it stays close to the
    // original rather than doubling with cycleS -- which is exactly why a
    // downstream reader dividing strideM by cycleS would silently halve the
    // implied ground speed with no other symptom.
    expect(Math.abs(afterMove.strideM - beforeMove.strideM)).toBeLessThan(0.01);
  });
});

// Fix round 1, item 4: a THROWN failure (no clip, no role, an unskinned
// mesh, a corrupt file) must propagate rather than being folded into a skip.
describe('a thrown measurement failure is not a skip', () => {
  async function scratchBrokenFixture(): Promise<string> {
    const doc = new Document();
    const buffer = doc.createBuffer();
    // A real (if trivial) mesh, so the file carries an actual BIN chunk --
    // an empty/bufferless document writes as a JSON-only GLB, which fails
    // `readGlb`'s own chunk parsing before ever reaching the "no mesh node
    // named boot" check this fixture exists to exercise. Named 'not_boot'
    // deliberately: the node exists, the mesh exists, there is simply no
    // node or mesh named 'boot' anywhere in the document.
    const positions = doc
      .createAccessor('pos', buffer)
      .setType('VEC3')
      .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]));
    const prim = doc.createPrimitive().setAttribute('POSITION', positions);
    const mesh = doc.createMesh('not_boot').addPrimitive(prim);
    const node = doc.createNode('not_boot').setMesh(mesh);
    doc.createScene('Scene').addChild(node);
    const dir = mkdtempSync(path.join(tmpdir(), 'gait-pass-test-'));
    scratchDirs.push(dir);
    const dest = path.join(dir, 'broken.glb');
    await io.write(dest, doc);
    return dest;
  }

  it('measureGait does not catch it -- it propagates out uncaught', async () => {
    const broken = await scratchBrokenFixture();
    expect(() => measureGait(broken)).toThrow(/no mesh node named "boot"/);
  });

  it('processGaitFile propagates the same throw rather than returning a skip result', async () => {
    const broken = await scratchBrokenFixture();
    await expect(processGaitFile(io, broken)).rejects.toThrow(/no mesh node named "boot"/);
  });

  it('a degenerate (measured, not thrown) skip is the ONLY case that resolves normally', () => {
    // Contrast case, in the same file, so the two are not accidentally
    // conflated: moto_rpg's move clip measures fine and reads as degenerate
    // -- this must NOT throw.
    expect(() => measureGait(path.join(MESHES, 'moto_rpg.glb'))).not.toThrow();
  });
});

// `runGaitPass` resolves every path against the real `art/meshes/` tree
// (`MESHES` is a module-level constant, not injectable per call) and this
// suite's own header rule is that nothing here may write to that tree, so a
// genuine end-to-end "a corrupt file aborts the whole run with exit 1" case
// cannot be constructed without either mutating real shipped art or adding
// path injection this fix round did not ask for. The propagation contract
// itself -- a thrown failure is not caught into a skip -- is proven directly
// above ('a thrown measurement failure is not a skip') at the layer
// `runGaitPass`'s loop calls un-modified (`processGaitFile`); `runGaitPass`
// only adds a `${id} (${file}): ...` wrapper around whatever that layer
// throws before letting it continue propagating, which is inspectable
// directly in gait-pass.ts and not worth a test that would have to fake the
// same limitation it is working around.
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
