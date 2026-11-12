/**
 * GH-1223 slice 1: a dying infantry entity's figures, as ragdoll bodies -- and the bodies' poses, written back.
 *
 * STRUCTURAL, never by bone name (mesh-unit contract: the runtime depends on no bone name beyond the `f<N>_` prefix):
 *
 * - **Figures** are `liveFigureRoots` (a parentless bone at scale 1 with a bone child), as the topple finds them.
 * - **Bodies** are the LINK bones under a figure root: a bone with at least one bone child (pelvis, spine, neck, the
 *   upper and fore arms, thighs and shins of a rig.py figure: 11). A LEAF bone (no bone child: head, hand, foot, hip,
 *   weapon) rides its parent body rigidly, so the rifle stays where it is carried (design L7).
 * - **Shapes** come from the figure's own vertices (the rig is rigid, one part per bone, so each vertex has one
 *   dominant joint): a capsule along the longest axis of the bone-local box of the body's own vertices -- and of its
 *   leaves' too when the body ends a chain (no link children: the neck takes the head, a forearm the hand, a shin the
 *   foot; the design's "neck and head merged").
 * - **Joints** are at each body's bone origin. A body that ends a two-link chain (its parent body has no other link
 *   child: forearm, shin) is a HINGE about the figure's lateral axis; every other is a ball.
 *
 * The starting pose is DATA, not the screen (design section 2, rule 3): the death clip (`fall`/`fallAlt`, else `idle`
 * with the topple's start spin) sampled at a fixed clip time on a reset skeleton, at the sim's own position and
 * facing. The screen crossfades into it over `BLEND_MS` (display only; physics never reads it).
 */
import * as THREE from 'three';
import type { ClipName } from '../../sheet';
import { pickDeathClips } from '../units/mesh-anim';
import { liveFigureRoots } from '../units/mesh-death';
import type { MeshUnitEntity, MeshUnitTemplate } from '../units/mesh-unit';
import { METRES_PER_TILE } from '../units/squad-motion';
import { tileHash } from '../../tile-hash';
import { PHYSICS_STEP_MS, POSE_STRIDE, type RagdollBodySpec, type RagdollFigureSpec, type V3 } from './ragdoll-world';

/** The clip time the physics takes over at (design section 4: 0.20 s). Also the sim-time delay from the death. */
export const HANDOFF_MS = 200;
/** The screen blends from what it showed into the ragdoll over this long, on the sim clock. */
export const BLEND_MS = 100;
/** The push away from the killer: horizontal and upward m/s, and the hashed spread about them. */
export const PUSH_M_S = 1.0;
export const PUSH_UP_M_S = 0.4;
export const PUSH_JITTER = 0.3;
/** A rig with no fall clip starts toppling at the generic topple's speed at 0.2 s (90 deg x p^2 over 0.5 s). */
export const TOPPLE_START_RAD_S = ((Math.PI / 2) * 2 * (0.2 / 0.5)) / 0.5;
const CAPSULE_FILL = 0.85;
const MIN_RADIUS_M = 0.025;
const MAX_RADIUS_M = 0.15;

interface BoneShapeSource {
  /** Bind-space points (`bindMatrix * v`) whose dominant joint is this bone, flattened xyz. */
  readonly points: Float32Array;
  readonly boneInverse: THREE.Matrix4;
}

/** Per geometry: its bind-space points grouped by dominant joint index. Shared by every clone of a template. */
const pointCache = new WeakMap<THREE.BufferGeometry, Map<number, Float32Array>>();

function pointsByJoint(mesh: THREE.SkinnedMesh): Map<number, Float32Array> {
  const hit = pointCache.get(mesh.geometry);
  if (hit) return hit;
  const pos = mesh.geometry.getAttribute('position');
  const idx = mesh.geometry.getAttribute('skinIndex');
  const wt = mesh.geometry.getAttribute('skinWeight');
  const lists = new Map<number, number[]>();
  const v = new THREE.Vector3();
  if (pos && idx && wt) {
    for (let i = 0; i < pos.count; i++) {
      let best = 0;
      for (let k = 1; k < 4; k++) if (wt.getComponent(i, k) > wt.getComponent(i, best)) best = k;
      const j = idx.getComponent(i, best);
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.bindMatrix);
      let l = lists.get(j);
      if (!l) lists.set(j, (l = []));
      l.push(v.x, v.y, v.z);
    }
  }
  const out = new Map<number, Float32Array>();
  for (const [j, l] of lists) out.set(j, new Float32Array(l));
  pointCache.set(mesh.geometry, out);
  return out;
}

/** Every bone of the entity mapped to its vertices (from every skinned mesh that binds it) and its bind inverse. */
function shapeSources(root: THREE.Object3D): Map<THREE.Bone, BoneShapeSource[]> {
  const out = new Map<THREE.Bone, BoneShapeSource[]>();
  root.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh || !mesh.skeleton) return;
    const byJoint = pointsByJoint(mesh);
    for (const [j, points] of byJoint) {
      const bone = mesh.skeleton.bones[j];
      if (!bone) continue;
      let l = out.get(bone);
      if (!l) out.set(bone, (l = []));
      l.push({ points, boneInverse: mesh.skeleton.boneInverses[j] });
    }
  });
  return out;
}

function boneChildren(b: THREE.Object3D): THREE.Bone[] {
  return b.children.filter((c): c is THREE.Bone => (c as THREE.Bone).isBone === true);
}

/** One body: its bone, the bones whose vertices shape it, its parent body. */
export interface RagdollLink {
  readonly bone: THREE.Bone;
  readonly parent: number;
  readonly shapeBones: readonly THREE.Bone[];
  readonly hinge: boolean;
}

/** The bodies of the figure under `figureRoot`, parents before children (`traverse` order). */
export function figureLinks(figureRoot: THREE.Bone): RagdollLink[] {
  const links: THREE.Bone[] = [];
  figureRoot.traverse((o) => {
    const b = o as THREE.Bone;
    if (b === figureRoot || !b.isBone) return;
    if (boneChildren(b).length > 0) links.push(b);
  });
  const index = new Map(links.map((b, i) => [b, i]));
  const parentOf = (b: THREE.Bone): number => {
    for (let p = b.parent; p !== null && p !== figureRoot; p = p.parent) {
      const i = index.get(p as THREE.Bone);
      if (i !== undefined) return i;
    }
    return -1;
  };
  const isLink = (b: THREE.Bone): boolean => index.has(b);
  const linkKids = (b: THREE.Bone): number => boneChildren(b).filter(isLink).length;
  return links.map((bone) => {
    const parent = parentOf(bone);
    const endsChain = linkKids(bone) === 0;
    const shapeBones = endsChain ? [bone, ...boneChildren(bone)] : [bone];
    const hinge = parent >= 0 && endsChain && linkKids(links[parent]) === 1;
    return { bone, parent, shapeBones, hinge };
  });
}

interface LocalCapsule {
  readonly centre: THREE.Vector3;
  readonly rot: THREE.Quaternion;
  readonly halfHeight: number;
  readonly radius: number;
}

/** The capsule fitted to `link`'s shape vertices, in its bone's bind-local frame (GLB metres). */
function localCapsule(link: RagdollLink, sources: Map<THREE.Bone, BoneShapeSource[]>): LocalCapsule {
  const own = sources.get(link.bone)?.[0];
  const box = new THREE.Box3();
  const p = new THREE.Vector3();
  if (own) {
    for (const b of link.shapeBones) {
      for (const s of sources.get(b) ?? []) {
        for (let i = 0; i < s.points.length; i += 3) {
          box.expandByPoint(p.set(s.points[i], s.points[i + 1], s.points[i + 2]).applyMatrix4(own.boneInverse));
        }
      }
    }
  }
  if (box.isEmpty()) return { centre: new THREE.Vector3(), rot: new THREE.Quaternion(), halfHeight: 0.005, radius: 0.04 };
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const ext = [size.x, size.y, size.z];
  const axis = ext.indexOf(Math.max(...ext));
  const others = ext.filter((_, i) => i !== axis);
  const radius = Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, ((others[0] + others[1]) / 4) * CAPSULE_FILL));
  const halfHeight = Math.max(0.005, (ext[axis] / 2) * CAPSULE_FILL - radius);
  const rot = new THREE.Quaternion();
  if (axis === 0) rot.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2);
  else if (axis === 2) rot.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  return { centre, rot, halfHeight, radius };
}

/** Every bone of `root`, in traverse order (the same order in a template and every clone of it). */
function bonesOf(root: THREE.Object3D): THREE.Bone[] {
  const out: THREE.Bone[] = [];
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) out.push(o as THREE.Bone);
  });
  return out;
}

/**
 * Poses `entity` deterministically: every bone back to the template's rest, the root at the sim's own position and
 * yaw, then `clip` alone at `clipMs` (the mixer at time 0, weight 1). Stops every action: the mixer does not run again.
 */
export function sampleClipPose(
  entity: MeshUnitEntity, template: MeshUnitTemplate, clip: ClipName, clipMs: number,
  at: { x: number; y: number; z: number; yaw: number }
): void {
  const rest = bonesOf(template.root);
  const mine = bonesOf(entity.root);
  entity.mixer.stopAllAction();
  for (let i = 0; i < mine.length && i < rest.length; i++) {
    mine[i].position.copy(rest[i].position);
    mine[i].quaternion.copy(rest[i].quaternion);
    mine[i].scale.copy(rest[i].scale);
  }
  entity.root.position.set(at.x, at.y, at.z);
  entity.root.rotation.y = at.yaw;
  const action = entity.actions.get(clip);
  if (action) {
    action.reset();
    action.setEffectiveWeight(1);
    action.setEffectiveTimeScale(1);
    action.play();
    action.time = Math.min(clipMs / 1000, action.getClip().duration);
    entity.mixer.update(0);
    entity.mixer.stopAllAction();
  }
  entity.root.updateMatrixWorld(true);
}

/** What `writePose` needs to put a stepped incident back on the bones. */
export interface RagdollDriver {
  readonly bones: readonly THREE.Bone[];
  /** Each body bone's world rotation and scale at the handoff (bodies start at the identity rotation). */
  readonly rot0: readonly THREE.Quaternion[];
  readonly scale0: readonly THREE.Vector3[];
}

export interface RagdollSeed {
  readonly entityId: number;
  readonly deathTick: number;
  /** World unit direction (x, z) of the push: away from the killer. */
  readonly away: readonly [number, number];
  /** The push, m/s, from the killing weapon's class (`munitions.json`); absent = the default constants below. */
  readonly push?: { readonly horizontalMS: number; readonly upMS: number };
}

function worldOf(b: THREE.Object3D): { p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 } {
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  b.matrixWorld.decompose(p, q, s);
  return { p, q, s };
}

const v3 = (v: THREE.Vector3, k = 1): V3 => [v.x * k, v.y * k, v.z * k];

/**
 * The figures of a dying `entity` as ragdoll specs, read off TWO deterministic samples of its death clip one physics
 * step apart (for the velocities), plus the push away from the killer, hashed per figure. Leaves the entity at the
 * first sample. Returns the specs and the driver that writes poses back.
 */
export function buildFigures(
  entity: MeshUnitEntity, template: MeshUnitTemplate,
  at: { x: number; y: number; z: number; yaw: number }, seed: RagdollSeed
): { figures: RagdollFigureSpec[]; driver: RagdollDriver } {
  const pick = pickDeathClips(seed.entityId, new Set(entity.actions.keys()));
  const falls = entity.actions.has(pick.fall);
  const clip: ClipName = falls ? pick.fall : 'idle';
  const h = PHYSICS_STEP_MS;
  const sources = shapeSources(entity.root);
  // Sample 2 first (one step on) for the velocities, then sample 1, which the entity is left in.
  sampleClipPose(entity, template, clip, HANDOFF_MS + h, at);
  const later = new Map<THREE.Bone, ReturnType<typeof worldOf>>();
  entity.root.traverse((o) => {
    if ((o as THREE.Bone).isBone) later.set(o as THREE.Bone, worldOf(o));
  });
  sampleClipPose(entity, template, clip, HANDOFF_MS, at);
  const M = METRES_PER_TILE;
  const figures: RagdollFigureSpec[] = [];
  const bones: THREE.Bone[] = [];
  const rot0: THREE.Quaternion[] = [];
  const scale0: THREE.Vector3[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  liveFigureRoots(entity.root).forEach((froot, f) => {
    const links = figureLinks(froot);
    if (links.length === 0) return;
    const fw = worldOf(froot);
    const lateral = new THREE.Vector3(0, 0, 1).applyQuaternion(fw.q).normalize();
    // The push: away from the killer, turned and scaled by a hash of (entity, tick, figure).
    const hs = (salt: number): number => tileHash(seed.entityId * 16 + f, seed.deathTick * 8 + salt);
    const turn = (hs(1) - 0.5) * 2 * PUSH_JITTER;
    const mag = (seed.push?.horizontalMS ?? PUSH_M_S) * (1 + (hs(2) - 0.5) * 2 * PUSH_JITTER);
    const ax = seed.away[0] * Math.cos(turn) - seed.away[1] * Math.sin(turn);
    const az = seed.away[0] * Math.sin(turn) + seed.away[1] * Math.cos(turn);
    const push = new THREE.Vector3(ax * mag, (seed.push?.upMS ?? PUSH_UP_M_S) * (1 + (hs(3) - 0.5) * PUSH_JITTER), az * mag);
    // A rig with no fall clip starts the topple's spin about its feet, away from the killer.
    const spinAxis = up.clone().cross(new THREE.Vector3(ax, 0, az)).normalize();
    const pivot = fw.p.clone().multiplyScalar(M);
    const bodies: RagdollBodySpec[] = links.map((link) => {
      const w1 = worldOf(link.bone);
      const w2 = later.get(link.bone) ?? w1;
      const cap = localCapsule(link, sources);
      const scale = w1.s.x * M;
      const atM = w1.p.clone().multiplyScalar(M);
      const centre = cap.centre.clone().applyMatrix4(link.bone.matrixWorld).multiplyScalar(M);
      const rot = w1.q.clone().multiply(cap.rot);
      let linvel = w2.p.clone().sub(w1.p).multiplyScalar(M / (h / 1000));
      const dq = w2.q.clone().multiply(w1.q.clone().invert());
      if (dq.w < 0) dq.set(-dq.x, -dq.y, -dq.z, -dq.w);
      const angle = 2 * Math.acos(Math.min(1, dq.w));
      const sinHalf = Math.sqrt(Math.max(0, 1 - dq.w * dq.w));
      let angvel = sinHalf > 1e-9 ? new THREE.Vector3(dq.x, dq.y, dq.z).multiplyScalar(angle / sinHalf / (h / 1000)) : new THREE.Vector3();
      if (!falls) {
        angvel = spinAxis.clone().multiplyScalar(TOPPLE_START_RAD_S);
        linvel = angvel.clone().cross(atM.clone().sub(pivot));
      }
      linvel.add(push);
      let hinge: V3 | null = null;
      if (link.hinge) {
        const axisDir = new THREE.Vector3(0, 1, 0).applyQuaternion(rot);
        const lat = lateral.clone().sub(axisDir.clone().multiplyScalar(lateral.dot(axisDir)));
        if (lat.lengthSq() > 1e-6) hinge = v3(lat.normalize());
      }
      bones.push(link.bone);
      rot0.push(w1.q.clone());
      scale0.push(w1.s.clone());
      return {
        parent: link.parent,
        at: v3(atM),
        capsule: { centre: v3(centre), rot: [rot.x, rot.y, rot.z, rot.w], halfHeight: cap.halfHeight * scale, radius: cap.radius * scale },
        hinge,
        linvel: v3(linvel),
        angvel: v3(angvel),
      };
    });
    figures.push({ bodies });
  });
  return { figures, driver: { bones, rot0, scale0 } };
}

const _m = new THREE.Matrix4();
const _pinv = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qb = new THREE.Quaternion();

/** Puts a pose (`RagdollIncident.poseAt`, world metres) on the driver's bones, parents first. */
export function writePose(driver: RagdollDriver, pose: Float64Array): void {
  const M = METRES_PER_TILE;
  driver.bones.forEach((bone, k) => {
    const o = k * POSE_STRIDE;
    _p.set(pose[o] / M, pose[o + 1] / M, pose[o + 2] / M);
    _qb.set(pose[o + 3], pose[o + 4], pose[o + 5], pose[o + 6]);
    _q.copy(_qb).multiply(driver.rot0[k]);
    _m.compose(_p, _q, driver.scale0[k]);
    const parent = bone.parent;
    if (parent) {
      _pinv.copy(parent.matrixWorld).invert();
      _m.premultiply(_pinv);
    }
    _m.decompose(bone.position, bone.quaternion, bone.scale);
    bone.updateMatrix();
    if (parent) bone.matrixWorld.multiplyMatrices(parent.matrixWorld, bone.matrix);
    else bone.matrixWorld.copy(bone.matrix);
  });
}

/** Every bone's local transform: what the screen showed at the handoff, for the blend. */
export interface ScreenPose {
  readonly bones: readonly THREE.Bone[];
  readonly p: readonly THREE.Vector3[];
  readonly q: readonly THREE.Quaternion[];
  readonly s: readonly THREE.Vector3[];
  readonly rootP: THREE.Vector3;
  readonly rootYaw: number;
}

export function captureScreenPose(root: THREE.Object3D): ScreenPose {
  const bones = bonesOf(root);
  return {
    bones,
    p: bones.map((b) => b.position.clone()),
    q: bones.map((b) => b.quaternion.clone()),
    s: bones.map((b) => b.scale.clone()),
    rootP: root.position.clone(),
    rootYaw: root.rotation.y,
  };
}

/** Blends every bone from the screen's pose (weight 0) to its current local transform (weight 1). Display only. */
export function blendFromScreen(screen: ScreenPose, root: THREE.Object3D, w: number): void {
  if (w >= 1) return;
  const t = Math.max(0, w);
  screen.bones.forEach((b, i) => {
    b.position.lerpVectors(screen.p[i], b.position, t);
    b.quaternion.slerpQuaternions(screen.q[i], b.quaternion.clone(), t);
    b.scale.lerpVectors(screen.s[i], b.scale, t);
  });
  root.position.lerpVectors(screen.rootP, root.position, t);
}

/** The drawn ground under (x, z) tiles, `half` tiles each way at `step`, as a triangle mesh in world metres. */
export function groundPatch(
  x: number, z: number, groundAt: (x: number, z: number) => number, half = 2, step = 0.5
): { vertices: Float32Array; indices: Uint32Array } {
  const n = Math.round((2 * half) / step);
  const M = METRES_PER_TILE;
  const vertices = new Float32Array((n + 1) * (n + 1) * 3);
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const px = x - half + i * step;
      const pz = z - half + j * step;
      const o = (j * (n + 1) + i) * 3;
      vertices[o] = px * M;
      vertices[o + 1] = groundAt(px, pz) * M;
      vertices[o + 2] = pz * M;
    }
  }
  const indices = new Uint32Array(n * n * 6);
  let k = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      const b = a + 1;
      const c = a + n + 1;
      const d = c + 1;
      // Counter-clockwise seen from above (+y up).
      indices.set([a, c, b, b, c, d], k);
      k += 6;
    }
  }
  return { vertices, indices };
}
