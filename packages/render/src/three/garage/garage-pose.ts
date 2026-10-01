/**
 * The garage's showcase pose (GH-316): what a unit looks like standing on the
 * stage, and how each figure in a team turns on its own spot.
 *
 * ## Where the pose comes from, in order
 *
 * 1. **A baked `showcase` clip**, when the GLB carries one -- the lead's
 *    default (Q3): the pose is DATA the exporters own (`tools/units/rig.py`
 *    for the kit and Meshy-cut teams, the Meshy importers for the skinned
 *    riflemen), so the mesh gates can check it. No shipped GLB carries one
 *    yet; see "The bake is a follow-up" below.
 * 2. **`idle` at frame 0**, which every shipped team and vehicle has. It is
 *    applied even where the rest geometry is already the posture, because
 *    only the clip's scale keys hide the prone death rig and the crew walker
 *    (`rig.py`'s `_key_death_visibility`): the bind pose alone draws the
 *    corpse lying beside the living figure.
 * 3. **The relaxed ready, on a skinned rifleman.** Of the three
 *    Meshy-skinned GLBs (`meshy_soldier` for the Rifle Squad,
 *    `yahalom_engineer`, `sarim_rifles`), a figure whose idle holds the
 *    rifle UP (`READY_HANG_MAX` measures it) is lowered: the arms keep idle
 *    frame 0, every other bone goes back to REST (legs straight, spine
 *    upright, the idle's crouch out of the hips), and then the whole arm
 *    assembly pitches `READY_DROP_DEG` about the shoulder line -- the rifle
 *    comes down across the body. Recognised by bone NAME
 *    (`<prefix>_LeftArm` and `<prefix>_RightArm`), which only those rigs
 *    have: a rigidly bound kit figure (one part, one bone, no weights) has no
 *    arm bones at all, and its rest geometry already IS its posture -- the
 *    Spike gunner kneels with the launcher, the spotter holds binoculars.
 *
 * ## The bake is a follow-up, and why the runtime pose shipped instead
 *
 * Baking `showcase` touches every team GLB (twenty of them) through two
 * export paths and both mesh gates, and the runtime reader still refuses an
 * animation it does not know (`isMeshClipName`, "a clip present under any
 * other name is a failure") -- so a baked clip would also need the mesh
 * contract widened before a MISSION could load the same file. This module
 * already reads one: `splitShowcase` takes it out of the clip list before
 * the shipped template builder sees it, so the garage is ready for the bake
 * the day it lands, and the pose below is its stand-in until then.
 */
import * as THREE from 'three';

/** The clip name the exporters will bake (Q3). */
export const SHOWCASE_CLIP = 'showcase';

/** The skinned rifleman's arm pitch about the shoulder line, degrees -- the
 *  approved mock's low ready. Negative pitches the hands DOWN and forward. */
export const READY_DROP_DEG = -90;

/** Which of the three paths above posed this unit, for the report line. */
export type PoseSource = 'showcase' | 'idle0' | 'idle0+ready' | 'bind';

/**
 * Take a `showcase` clip out of a GLB's animation list, leaving the rest in
 * order. Done BEFORE the shipped template builder runs, because that builder
 * throws on any clip name outside the mission's contract.
 */
export function splitShowcase<T extends { readonly name: string }>(
  animations: readonly T[]
): { showcase: T | null; rest: T[] } {
  let showcase: T | null = null;
  const rest: T[] = [];
  for (const a of animations) {
    if (a.name === SHOWCASE_CLIP && showcase === null) showcase = a;
    else rest.push(a);
  }
  return { showcase, rest };
}

/** Every bone under `root`, in traversal order. */
export function bonesOf(root: THREE.Object3D): THREE.Bone[] {
  const out: THREE.Bone[] = [];
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) out.push(o as THREE.Bone);
  });
  return out;
}

/**
 * The bones that turn a team's figures: a top-level bone (no bone above it)
 * that is still SHOWN after the pose. A death root or a crew walker is keyed
 * to scale 0 by `idle` frame 0 and is not a figure.
 *
 * The NAME is only a tie-breaker, and not a filter, because one shipped rig
 * inverts it: `sniper_team` lies prone, so its living figures are the bones
 * named `snp_*_death_root` (scale 1 at idle) while `snp_*_root` is the one
 * scaled to nothing. So a shown bone named for death or walking is dropped
 * only when some OTHER shown bone is not -- which also covers a rig posed
 * from its bind pose, where every root is shown.
 */
export function livingFigureRoots(bones: readonly THREE.Bone[]): THREE.Bone[] {
  const shown = bones.filter((b) => !(b.parent as THREE.Bone | null)?.isBone && Math.abs(b.scale.x) > 1e-4);
  const named = shown.filter((b) => !/death|walk/i.test(b.name));
  return named.length > 0 ? named : shown;
}

const ARM = /(Shoulder|Arm|ForeArm|Hand)$/;

/**
 * How far a figure's hands must already HANG for its idle to count as a
 * relaxed carry, as a fraction of its arm's length below the shoulder.
 *
 * The ready drop exists for a rifleman whose idle holds the rifle UP; it is
 * wrong for one whose idle already carries it low. Measured at idle frame 0
 * (left side, world units): `meshy_soldier` (the Rifle Squad) has the hand
 * 0.02 below the shoulder on a 0.15 arm -- 0.13, aiming -- and the -90
 * pitch brings the rifle across the chest. `yahalom_engineer` has it 0.16
 * below on a 0.16 arm -- 0.97, hanging -- and the same pitch swung both arms
 * back to shoulder height, a T-pose from behind. So the drop is applied only
 * below this fraction, and a figure above it keeps its idle as it is.
 */
export const READY_HANG_MAX = 0.5;

/** How far `prefix`'s hands hang below its shoulders, as a fraction of its
 *  arm's length: 0 is level with the shoulder, 1 straight down. */
function hangOf(byName: ReadonlyMap<string, THREE.Bone>, prefix: string): number {
  let total = 0;
  let n = 0;
  for (const side of ['Left', 'Right']) {
    const arm = byName.get(`${prefix}_${side}Arm`);
    const fore = byName.get(`${prefix}_${side}ForeArm`);
    const hand = byName.get(`${prefix}_${side}Hand`);
    if (!arm || !fore || !hand) continue;
    const a = arm.getWorldPosition(new THREE.Vector3());
    const f = fore.getWorldPosition(new THREE.Vector3());
    const h = hand.getWorldPosition(new THREE.Vector3());
    const len = a.distanceTo(f) + f.distanceTo(h);
    if (len <= 1e-9) continue;
    total += (a.y - h.y) / len;
    n += 1;
  }
  return n === 0 ? 1 : total / n;
}

/**
 * The relaxed ready on every skinned figure in `root` whose idle holds its
 * hands up (see the header and `READY_HANG_MAX`). `rest` holds each bone's
 * bind transform, captured BEFORE any clip was applied. Returns whether any
 * figure took it.
 */
export function applyReadyPose(
  root: THREE.Object3D,
  bones: readonly THREE.Bone[],
  rest: ReadonlyMap<THREE.Bone, { q: THREE.Quaternion; p: THREE.Vector3 }>,
  dropDeg = READY_DROP_DEG
): boolean {
  const byName = new Map(bones.map((b) => [b.name, b] as const));
  const candidates: string[] = [];
  for (const b of bones) {
    const m = /^(.*)_LeftArm$/.exec(b.name);
    if (m && byName.has(`${m[1]}_RightArm`)) candidates.push(m[1]);
  }
  root.updateMatrixWorld(true);
  const prefixes = candidates.filter((p) => hangOf(byName, p) < READY_HANG_MAX);
  if (prefixes.length === 0) return false;
  const inFigure = (b: THREE.Bone): boolean => prefixes.some((p) => b.name.startsWith(`${p}_`));
  for (const b of bones) {
    if (!inFigure(b) || ARM.test(b.name)) continue;
    const r = rest.get(b);
    if (!r) continue;
    b.quaternion.copy(r.q);
    b.position.copy(r.p);
  }
  root.updateMatrixWorld(true);
  for (const pre of prefixes) {
    const la = byName.get(`${pre}_LeftArm`);
    const ra = byName.get(`${pre}_RightArm`);
    if (!la || !ra || !la.parent || !ra.parent) continue;
    const a = la.getWorldPosition(new THREE.Vector3());
    const axis = ra.getWorldPosition(new THREE.Vector3()).sub(a).setY(0);
    if (axis.lengthSq() < 1e-12) continue;
    axis.normalize();
    const pitch = new THREE.Quaternion().setFromAxisAngle(axis, THREE.MathUtils.degToRad(dropDeg));
    for (const arm of [la, ra]) {
      const parentWorld = arm.parent!.getWorldQuaternion(new THREE.Quaternion());
      const world = parentWorld.clone().multiply(arm.quaternion);
      arm.quaternion.copy(parentWorld.invert().multiply(pitch.clone().multiply(world)));
    }
    root.updateMatrixWorld(true);
  }
  return true;
}

/**
 * Pose a rigged team for the stage and report which path did it. The mixer
 * is returned so the caller can release it; it is never updated again --
 * stopping its action would restore the bind pose.
 */
export function poseRigged(
  root: THREE.Object3D,
  clips: { readonly showcase: THREE.AnimationClip | null; readonly idle: THREE.AnimationClip | null }
): { source: PoseSource; mixer: THREE.AnimationMixer } {
  const bones = bonesOf(root);
  const rest = new Map(bones.map((b) => [b, { q: b.quaternion.clone(), p: b.position.clone() }] as const));
  const mixer = new THREE.AnimationMixer(root);
  if (clips.showcase) {
    mixer.clipAction(clips.showcase).play();
    mixer.setTime(0);
    return { source: 'showcase', mixer };
  }
  if (!clips.idle) return { source: 'bind', mixer };
  mixer.clipAction(clips.idle).play();
  mixer.setTime(0);
  return { source: applyReadyPose(root, bones, rest) ? 'idle0+ready' : 'idle0', mixer };
}

/** Is `o` hidden, by its own flag or any ancestor's, or scaled to nothing? */
function hiddenByAncestry(o: THREE.Object3D): boolean {
  let hidden = false;
  o.traverseAncestors((a) => {
    if (!a.visible || Math.abs(a.scale.x) < 1e-6) hidden = true;
  });
  return hidden || !o.visible;
}

/**
 * A world-space sample of every VISIBLE vertex at the current pose, each
 * tagged with the figure root it belongs to (`-1` when it hangs under none).
 *
 * Skinned vertices are skinned on the CPU (`applyBoneTransform`), and one
 * whose live weight is under half -- bound to a death rig or walker the pose
 * scaled to zero -- is not part of the visible body and is skipped. Capped
 * at `maxPerMesh` per mesh by striding, which is plenty for a fit: the
 * Rifle Squad's 32k-triangle mesh samples in under a millisecond.
 */
export function visiblePoints(
  root: THREE.Object3D,
  figures: readonly THREE.Object3D[] = [],
  maxPerMesh = 3000
): { points: THREE.Vector3[]; owner: number[] } {
  root.updateMatrixWorld(true);
  const points: THREE.Vector3[] = [];
  const owner: number[] = [];
  const ownerOf = (o: THREE.Object3D | null): number => {
    let n: THREE.Object3D | null = o;
    while (n) {
      const i = figures.indexOf(n);
      if (i >= 0) return i;
      n = n.parent;
    }
    return -1;
  };
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || hiddenByAncestry(o)) return;
    const pos = mesh.geometry.getAttribute('position');
    if (!pos) return;
    const skinned = (mesh as unknown as THREE.SkinnedMesh).isSkinnedMesh ? (mesh as unknown as THREE.SkinnedMesh) : null;
    const si = skinned ? skinned.geometry.getAttribute('skinIndex') : null;
    const sw = skinned ? skinned.geometry.getAttribute('skinWeight') : null;
    let dead: boolean[] = [];
    let boneOwner: number[] = [];
    if (skinned) {
      const s = new THREE.Vector3();
      const scratchP = new THREE.Vector3();
      const scratchQ = new THREE.Quaternion();
      dead = skinned.skeleton.bones.map((b) => {
        b.matrixWorld.decompose(scratchP, scratchQ, s);
        return Math.abs(s.x) < 1e-4;
      });
      boneOwner = skinned.skeleton.bones.map((b) => ownerOf(b));
    }
    const meshOwner = ownerOf(mesh);
    const step = Math.max(1, Math.floor(pos.count / maxPerMesh));
    for (let i = 0; i < pos.count; i += step) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, i);
      let who = meshOwner;
      if (skinned && si && sw) {
        let live = 0;
        let best = -1;
        let bestW = 0;
        for (let k = 0; k < 4; k++) {
          const w = sw.getComponent(i, k);
          const bi = si.getComponent(i, k);
          if (w !== 0 && !dead[bi]) live += w;
          if (w > bestW) {
            bestW = w;
            best = bi;
          }
        }
        if (live < 0.5) continue;
        skinned.applyBoneTransform(i, v);
        if (best >= 0 && boneOwner[best] !== undefined && boneOwner[best] >= 0) who = boneOwner[best];
      }
      points.push(v.applyMatrix4(mesh.matrixWorld));
      owner.push(who);
    }
  });
  return { points, owner };
}

/**
 * Turns each figure about its OWN vertical axis -- the lead's ruling ("each
 * figure in a team turns on its own spot"). Turning the whole line as one
 * group overlapped the riflemen past about 50 degrees in the mock's first
 * pass. The axis is world up expressed in the bone's parent space, so a rig
 * whose armature node is itself rotated (the Meshy imports are) still turns
 * about the vertical.
 */
export function figureTurner(figures: readonly THREE.Bone[]): (yawDeg: number) => void {
  const base = figures.map((b) => ({ b, q: b.quaternion.clone() }));
  const up = new THREE.Vector3();
  const pq = new THREE.Quaternion();
  const turn = new THREE.Quaternion();
  return (yawDeg) => {
    const r = THREE.MathUtils.degToRad(yawDeg);
    for (const { b, q } of base) {
      if (!b.parent) continue;
      b.parent.updateMatrixWorld(true);
      b.parent.getWorldQuaternion(pq);
      up.set(0, 1, 0).applyQuaternion(pq.invert()).normalize();
      turn.setFromAxisAngle(up, r);
      b.quaternion.copy(turn).multiply(q);
    }
  };
}

/**
 * A team's figures in the order they will stand on the stage's line: as they
 * already stood along whichever ground axis they were most spread on, so
 * the exporter's own formation decides who is on the left.
 */
export function lineOrder(figures: readonly THREE.Bone[]): THREE.Bone[] {
  const world = figures.map((b) => {
    b.updateWorldMatrix(true, false);
    return b.getWorldPosition(new THREE.Vector3());
  });
  const spread = (k: 'x' | 'z'): number =>
    world.length === 0 ? 0 : Math.max(...world.map((p) => p[k])) - Math.min(...world.map((p) => p[k]));
  const along: 'x' | 'z' = spread('z') >= spread('x') ? 'z' : 'x';
  return figures
    .map((b, i) => ({ b, p: world[i] }))
    .sort((a, c) => a.p[along] - c.p[along])
    .map(({ b }) => b);
}

/**
 * Stand `ordered` on one line across the view (world `Z`, the screen's
 * horizontal), `spacing` apart and centred on their own mean. Moves each
 * figure root in its PARENT's space, measured from posed world positions,
 * so it is the same code for a kit rig and a Meshy one.
 */
export function respaceLine(ordered: readonly THREE.Bone[], spacing: number): void {
  if (ordered.length < 2 || !(spacing > 0)) return;
  const world = ordered.map((b) => {
    b.updateWorldMatrix(true, false);
    return b.getWorldPosition(new THREE.Vector3());
  });
  const centre = new THREE.Vector3();
  for (const p of world) centre.add(p);
  centre.multiplyScalar(1 / world.length);
  const n = ordered.length;
  ordered.forEach((b, i) => {
    const parent = b.parent;
    if (!parent) return;
    const p = world[i];
    const want = new THREE.Vector3(centre.x, p.y, centre.z + (i - (n - 1) / 2) * spacing);
    b.position.add(parent.worldToLocal(want.clone()).sub(parent.worldToLocal(p.clone())));
  });
}
