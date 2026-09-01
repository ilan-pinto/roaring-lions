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

  const byRole = new Map<string, { verts: number; idx: number; parts: Set<string> }>();
  for (const [key, parts] of used) {
    for (const part of parts) {
      const acc = byRole.get(part.role) ?? { verts: 0, idx: 0, parts: new Set<string>() };
      const pos = part.geometry.getAttribute('position');
      acc.verts += pos.count;
      acc.idx += part.geometry.getIndex()?.count ?? pos.count;
      acc.parts.add(key);
      byRole.set(part.role, acc);
    }
  }

  // Pass 2: one batch per role. Instance count is bounded by (placements x
  // parts-per-placement), so size it from the worst case.
  const maxInstances = live.length * 4;
  for (const [role, acc] of byRole) {
    const mesh = new THREE.BatchedMesh(
      maxInstances,
      acc.verts,
      acc.idx,
      toonRampMaterial(rampForDecorRole(role))
    );
    // geometryId per "${family}_${variant}::role", so one addGeometry per
    // distinct part rather than one per placement.
    const geomId = new Map<string, number>();
    for (const key of acc.parts) {
      for (const part of used.get(key) ?? []) {
        if (part.role !== role) continue;
        geomId.set(key, mesh.addGeometry(part.geometry));
      }
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const axis = new THREE.Vector3(0, 1, 0);
    const scale = new THREE.Vector3();
    let added = 0;
    for (const p of live) {
      const id = geomId.get(`${p.family}_${p.variant}`);
      if (id === undefined) continue;
      const inst = mesh.addInstance(id);
      q.setFromAxisAngle(axis, p.yawTurns * TAU);
      scale.set(p.scale, p.scale, p.scale);
      m.compose(new THREE.Vector3(p.x, p.y, p.z), q, scale);
      mesh.setMatrixAt(inst, m);
      added++;
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
