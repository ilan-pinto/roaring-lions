/**
 * Scattered decor as batched geometry.
 *
 * ONE BatchedMesh PER ROLE, not per family. Every family's `rock` parts share
 * one ramp and therefore one material, so a rock cluster, a boulder and a slab
 * all land in the same batch -- which is the whole point: draw-call submission
 * is this project's measured bottleneck, with the GPU otherwise idle. Six
 * families across four roles is four draws, not eighteen.
 */
import * as THREE from 'three';
import { toonRampMaterial } from '../palette-material';
import { rampForDecorRole } from './decor-role';
import type { DecorPlacement } from './decor-place';

/** Keyed `${family}_${variant}`, each a role-tagged geometry list. */
export interface DecorGeometrySet {
  readonly parts: ReadonlyMap<string, readonly { role: string; geometry: THREE.BufferGeometry }[]>;
}

const TAU = Math.PI * 2;

export function buildDecorMesh(
  placements: readonly DecorPlacement[],
  set: DecorGeometrySet
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'decor';

  // Pass 1: which parts are actually referenced, and how big each role's
  // batch must be. BatchedMesh is sized up front and cannot grow.
  const used = new Map<string, { role: string; geometry: THREE.BufferGeometry }[]>();
  const live: DecorPlacement[] = [];
  for (const p of placements) {
    const key = `${p.family}_${p.variant}`;
    const parts = set.parts.get(key);
    // A family whose GLB failed to fetch loses its objects. Losing a bush is
    // acceptable; throwing here would lose the whole frame.
    if (!parts) continue;
    used.set(key, [...parts]);
    live.push(p);
  }
  if (live.length === 0) return group;

  const byRole = new Map<
    string,
    {
      verts: number;
      idx: number;
      parts: Set<string>;
      /** The most same-role parts any single `${family}_${variant}` key
       *  holds for this role -- e.g. a rock-cluster family exported as two
       *  rock sub-meshes under one key contributes 2 here. One live
       *  placement referencing that key adds this many instances to this
       *  role's batch in a single pass, so it is the per-placement worst
       *  case the instance budget below is built from. */
      maxPartsPerKey: number;
    }
  >();
  for (const [key, parts] of used) {
    const countInKey = new Map<string, number>();
    for (const part of parts) {
      const acc = byRole.get(part.role) ?? {
        verts: 0,
        idx: 0,
        parts: new Set<string>(),
        maxPartsPerKey: 0,
      };
      const pos = part.geometry.getAttribute('position');
      acc.verts += pos.count;
      acc.idx += part.geometry.getIndex()?.count ?? pos.count;
      acc.parts.add(key);
      byRole.set(part.role, acc);
      countInKey.set(part.role, (countInKey.get(part.role) ?? 0) + 1);
    }
    for (const [role, count] of countInKey) {
      const acc = byRole.get(role);
      if (acc && count > acc.maxPartsPerKey) acc.maxPartsPerKey = count;
    }
  }

  // Pass 2: one batch per role. Instance count is bounded by (live
  // placements x the most same-role parts any single key holds for this
  // role) -- the worst case is every placement referencing that key. Sized
  // per role, not a shared magic multiplier: BatchedMesh is allocated up
  // front and cannot grow, and `addInstance` throws once its budget is
  // exhausted.
  for (const [role, acc] of byRole) {
    const maxInstances = live.length * acc.maxPartsPerKey;
    const mesh = new THREE.BatchedMesh(
      maxInstances,
      acc.verts,
      acc.idx,
      toonRampMaterial(rampForDecorRole(role))
    );
    // One geometry id per PART, not per key -- a key may legitimately hold
    // several same-role parts (a rock-cluster family exported as multiple
    // rock sub-meshes under one family/variant), and collapsing them to one
    // id per key would silently drop every part after the first: its
    // vertices are already reserved in the batch budget above (the byRole
    // tally sums every part unconditionally), so it would upload to the GPU
    // and never draw.
    const geomIds = new Map<string, number[]>();
    for (const key of acc.parts) {
      const ids: number[] = [];
      for (const part of used.get(key) ?? []) {
        if (part.role !== role) continue;
        ids.push(mesh.addGeometry(part.geometry));
      }
      geomIds.set(key, ids);
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const axis = new THREE.Vector3(0, 1, 0);
    const scale = new THREE.Vector3();
    let added = 0;
    for (const p of live) {
      const ids = geomIds.get(`${p.family}_${p.variant}`);
      if (ids === undefined) continue;
      for (const id of ids) {
        const inst = mesh.addInstance(id);
        q.setFromAxisAngle(axis, p.yawTurns * TAU);
        scale.set(p.scale, p.scale, p.scale);
        m.compose(new THREE.Vector3(p.x, p.y, p.z), q, scale);
        mesh.setMatrixAt(inst, m);
        added++;
      }
    }
    if (added === 0) {
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
      continue;
    }
    group.add(mesh);
  }
  return group;
}

export function disposeDecorMesh(group: THREE.Group): void {
  for (const child of [...group.children]) {
    const mesh = child as THREE.BatchedMesh;
    (mesh.material as THREE.Material).dispose();
    mesh.dispose();
    group.remove(child);
  }
}
