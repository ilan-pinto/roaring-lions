/**
 * No living state plays its corpse (pass C2/C4, PA-31).
 *
 * The defect this exists for: rig.py's `build_death_clip` builds `down` and
 * `wreck` "otherwise IDENTICAL", and the renderer played `down` for a pinned
 * unit and for a broken one standing still. On every drawn infantry rig but
 * the three captured bipeds, a pinned team lay in exactly the pose it would
 * lie in dead, and the only tell was a bar over it.
 *
 * What it reads is what the renderer would PLAY, not what a file happens to
 * contain: every living `UnitAnimInput` goes through the renderer's own
 * `resolveClip` -> `resolveMeshMotionClip` -> `meshClipOrFallback`, against
 * the clips each shipped GLB actually carries, and the pose that clip opens
 * on is compared joint by joint with the pose `wreck` (and `wreckAlt`) holds.
 * The kneel clips are judged too, since the kneel layer can swap them in for
 * any standing clip. Identical means every joint drawn in either pose within
 * 1 mm, 0.5 deg and 0.1% of scale, over every NODE (a vehicle has no
 * skin) -- the corpse, not a pose near it.
 *
 * The files are the ones the game DRAWS (`RIGGED_UNIT_MESHES` and
 * `VEHICLE_UNIT_MESHES`), read from the catalogue the app loads from; a held
 * file (`HELD_MESH_FILES`, the three officers today) joins the sweep the day
 * it is wired, and must carry a huddle then.
 *
 * Falsified on main's bytes and code (006d926a): 14 drawn files red on the
 * pinned and broken-standing states -- `pinned` resolved to `down`, which is
 * keyframe-identical to `wreck` on every one of them. The three held
 * officers carry the same pair, which is 17.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { measureNodePoses, readGlb, rotationDeltaDeg, type JointPose } from './mesh_gait';
import { RIGGED_UNIT_MESHES, VEHICLE_UNIT_MESHES } from '../../packages/app/src/mesh-catalogue';
// Relative imports, as mesh_gait.test.ts does: `clip.ts` and `mesh-anim.ts`
// import only types from three.js-free modules.
import { resolveClip, type UnitAnimInput } from '../../packages/render/src/clip';
import { meshClipOrFallback, resolveMeshMotionClip } from '../../packages/render/src/three/units/mesh-anim';
import type { ClipName } from '../../packages/render/src/sheet';

const MESHES = fileURLToPath(new URL('../../art/meshes/', import.meta.url));

/** Every living state the sim can put a unit in, as the renderer reads it. */
const ALIVE: UnitAnimInput = { alive: 1, routed: 0, pinned: 0, speed: 0, firing: false, working: false };
const LIVING_STATES: readonly [string, UnitAnimInput][] = [
  ['idle', ALIVE],
  ['moving', { ...ALIVE, speed: 0.9 }],
  ['firing', { ...ALIVE, firing: true }],
  ['firing on the move', { ...ALIVE, firing: true, speed: 0.9 }],
  ['working', { ...ALIVE, working: true }],
  ['pinned', { ...ALIVE, pinned: 1 }],
  ['pinned and ordered on', { ...ALIVE, pinned: 1, speed: 0.01 }],
  ['broken, running', { ...ALIVE, routed: 1, pinned: 1, speed: 1.4 }],
  ['broken, standing', { ...ALIVE, routed: 1, pinned: 1, speed: 0 }],
  ['broken, unpinned, standing', { ...ALIVE, routed: 1, speed: 0 }],
];
/** The kneel layer (`kneelClipFor`) can swap these in for a standing clip. */
const KNEEL_CLIPS: readonly ClipName[] = ['kneel', 'kneelIn', 'kneelOut'];
const CORPSES: readonly ClipName[] = ['wreck', 'wreckAlt'];

const MM = 0.001;
const DEG = 0.5;
const SCALE = 0.001;

/** True when the two poses draw the same body: every joint drawn in either
 *  (scale above zero) agrees. A joint scaled out in both is not drawn. */
export function samePose(a: readonly JointPose[], b: readonly JointPose[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const p = a[i];
    const q = b[i];
    if (p.scale < 1e-6 && q.scale < 1e-6) continue;
    if (Math.abs(p.scale - q.scale) > SCALE) return false;
    const d = Math.hypot(p.translation[0] - q.translation[0], p.translation[1] - q.translation[1], p.translation[2] - q.translation[2]);
    if (d > MM) return false;
    if (rotationDeltaDeg(p.rotation, q.rotation) > DEG) return false;
  }
  return true;
}

function clipsOf(file: string): Set<ClipName> {
  return new Set((readGlb(`${MESHES}${file}`).json.animations ?? []).map((a) => a.name as ClipName));
}

const DRAWN = [
  ...Object.values(RIGGED_UNIT_MESHES).flatMap((e) => e.files),
  ...Object.values(VEHICLE_UNIT_MESHES),
].filter((f, i, all) => all.indexOf(f) === i);
const WITH_CORPSE = DRAWN.filter((f) => existsSync(`${MESHES}${f}`) && clipsOf(f).has('wreck')).sort();

describe('no living state plays its corpse', () => {
  it('judges every drawn file that has a corpse -- a known population', () => {
    // A literal, so an empty catalogue or a path that matches nothing cannot
    // pass this file in no time: 18 rigged infantry files with a `wreck`
    // (the civilians have none; the three officers are held) and 16
    // vehicles, counted 7 Oct.
    expect(WITH_CORPSE.filter((f) => !f.startsWith('vehicles/'))).toHaveLength(18);
    expect(WITH_CORPSE.filter((f) => f.startsWith('vehicles/'))).toHaveLength(16);
  });

  for (const file of WITH_CORPSE) {
    it(`${file}: every living state, and the kneel, draws a body that is not the wreck`, () => {
      const available = clipsOf(file);
      const corpses = CORPSES.filter((c) => available.has(c)).map((c) => measureNodePoses(`${MESHES}${file}`, c, 'start'));
      const played = new Map<ClipName, string[]>();
      for (const [state, input] of LIVING_STATES) {
        const desired = resolveMeshMotionClip(resolveClip(input), input.speed > 0, available.has('moveFire'));
        const clip = meshClipOrFallback(available, desired);
        played.set(clip, [...(played.get(clip) ?? []), state]);
      }
      for (const k of KNEEL_CLIPS) if (available.has(k)) played.set(k, [...(played.get(k) ?? []), 'the kneel layer']);
      const bad: string[] = [];
      for (const [clip, states] of played) {
        for (const at of ['start', 'end'] as const) {
          const pose = measureNodePoses(`${MESHES}${file}`, clip, at);
          if (corpses.some((c) => samePose(pose, c))) bad.push(`${clip} (${at}; for ${states.join(', ')})`);
        }
      }
      expect(bad).toEqual([]);
    });
  }

  it('every drawn file that carries the corpse pair down/wreck carries a huddle of its own', () => {
    // Without it the renderer's stand-in (the kneel, or idle) would pass the
    // sweep above while showing a man aiming, or standing, under fire.
    const missing = WITH_CORPSE.filter((f) => {
      const c = clipsOf(f);
      return c.has('down') && !c.has('pinned');
    });
    expect(missing).toEqual([]);
  });

  it('the huddle is not the kneel: a pinned man is not drawn aiming', () => {
    const same = WITH_CORPSE.filter((f) => {
      const c = clipsOf(f);
      if (!c.has('pinned') || !c.has('kneel')) return false;
      return samePose(measureNodePoses(`${MESHES}${f}`, 'pinned', 'start'), measureNodePoses(`${MESHES}${f}`, 'kneel', 'start'));
    });
    expect(same).toEqual([]);
  });
});
