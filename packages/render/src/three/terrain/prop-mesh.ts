/**
 * Props as one batch of GPU geometry (ground plan 2, Task 4, R-6).
 *
 * ONE BatchedMesh for every prop of every kind, not one per role the way
 * `decor-mesh.ts` batches decor. Decor's per-role split exists because six
 * families share four roles and splitting further would buy nothing; a prop
 * batch has the opposite shape -- seven kinds, five roles, at most 150
 * instances a map (N-8) -- so the thing worth minimising is draw-call
 * SUBMISSION, this project's own measured bottleneck (`docs/PERFORMANCE.md`),
 * not material variety. Five role-keyed batches would spend 5x the draw
 * calls (main pass, shadow pass, AO pass -- the "+3" the plan's budget names)
 * to draw an object count an order of magnitude smaller than decor's; one
 * batch spends exactly +3, the whole of this plan's draw-call budget for
 * props.
 *
 * A role therefore cannot be the material any more -- there is only one
 * material for the whole batch, `MeshStandardMaterial({ vertexColors: true
 * })` -- so a role's colour is baked into the geometry's own `color`
 * attribute instead, once, at load (`bakePropColors`), the same
 * `liftTone(rampForPropRole(role))` tone `rampMaterial` would have set as a
 * flat `color` uniform. Every prop GLB ships zero materials (Task 3), so
 * nothing here discards a supplied one -- the vertex colour IS the only
 * colour this asset class ever has.
 */
import * as THREE from 'three';
import { memoizeBatchCulling } from './batch-cull';
import { WORLD_ROUGHNESS } from '../world-materials';
import type { PropKind, PropMeshRole } from './prop-role';
import { liftTone } from '../world-materials';
import { rampForPropRole } from './prop-role';
import type { PropPlacement } from './prop-place';

const TAU = Math.PI * 2;

/** Keyed by `PropKind` -- unlike `DecorGeometrySet`, never by
 *  `${kind}_${variant}`: the kit has one shape per kind, no variants. */
export interface PropGeometrySet {
  readonly parts: ReadonlyMap<PropKind, readonly { role: PropMeshRole; geometry: THREE.BufferGeometry }[]>;
}

/**
 * Writes a `color` attribute onto `geometry`, IN PLACE: every vertex the
 * role's lit tone (`liftTone(rampForPropRole(role))`), which
 * `THREE.Color`'s own construction from a palette hex already puts in
 * three's linear working colour space -- the same conversion `rampMaterial`
 * relies on for a flat `MeshStandardMaterial.color`, just baked per vertex
 * instead of set once as a uniform.
 *
 * Returns the same geometry for call-site convenience, matching
 * `decor-mesh.ts`'s `stripToBatchAttributes`.
 */
export function bakePropColors(geometry: THREE.BufferGeometry, role: PropMeshRole): THREE.BufferGeometry {
  const tone = new THREE.Color(liftTone(rampForPropRole(role)));
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = tone.r;
    colors[i * 3 + 1] = tone.g;
    colors[i * 3 + 2] = tone.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/**
 * One `BatchedMesh` for every placed prop whose kind is actually loaded
 * (`set.parts`), or `null` when nothing is placed or nothing loaded --
 * `decor-mesh.ts`'s own two escape hatches, restated for a single batch
 * rather than one per role.
 *
 * A kind absent from `set` (its GLB never fetched, or failed) drops its
 * placements silently, the same "losing a bush is acceptable, throwing here
 * would lose the whole frame" tolerance `buildDecorMesh` already carries.
 */
export function buildPropMesh(
  placements: readonly PropPlacement[],
  set: PropGeometrySet
): THREE.BatchedMesh | null {
  // Pass 1: which kinds are actually referenced, and the live placements that
  // reference a loaded one. `used` is looked up once per DISTINCT kind
  // (`used.get` returns a hit for every placement after a kind's first),
  // matching `buildDecorMesh`'s own reasoning: a shipped map can reference
  // one kind hundreds of times, and `parts` is a `readonly` reference, so
  // caching it costs nothing.
  const used = new Map<PropKind, readonly { role: PropMeshRole; geometry: THREE.BufferGeometry }[]>();
  const live: PropPlacement[] = [];
  for (const p of placements) {
    let parts = used.get(p.kind);
    if (parts === undefined) {
      const found = set.parts.get(p.kind);
      if (!found) continue;
      used.set(p.kind, found);
      parts = found;
    }
    live.push(p);
  }
  if (live.length === 0) return null;

  // Pass 2: size the one batch. `BatchedMesh` is allocated up front and
  // cannot grow -- vertex/index totals sum every referenced kind's parts
  // exactly once; the instance budget is `live.length * the most parts any
  // single kind holds`, the worst case being every placement referencing
  // that kind (the same bound `buildDecorMesh` computes per role, here taken
  // once across the whole batch).
  let verts = 0;
  let indices = 0;
  let maxPartsPerKind = 0;
  for (const parts of used.values()) {
    if (parts.length > maxPartsPerKind) maxPartsPerKind = parts.length;
    for (const part of parts) {
      const pos = part.geometry.getAttribute('position');
      verts += pos.count;
      indices += part.geometry.getIndex()?.count ?? pos.count;
    }
  }

  const mesh = new THREE.BatchedMesh(
    live.length * maxPartsPerKind,
    verts,
    indices,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: WORLD_ROUGHNESS, metalness: 0 })
  );
  // Both, for every prop: a jersey barrier casts onto the road it stands
  // beside, and a tyre pile in a yard takes a building's shadow across it
  // exactly as decor's own batches do.
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const geomIds = new Map<PropKind, number[]>();
  for (const [kind, parts] of used) {
    geomIds.set(
      kind,
      parts.map((part) => mesh.addGeometry(part.geometry))
    );
  }

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const axis = new THREE.Vector3(0, 1, 0);
  const scale = new THREE.Vector3(1, 1, 1);
  const position = new THREE.Vector3();
  for (const p of live) {
    const ids = geomIds.get(p.kind);
    if (ids === undefined) continue;
    q.setFromAxisAngle(axis, p.yawTurns * TAU);
    position.set(p.x, p.y, p.z);
    m.compose(position, q, scale);
    for (const id of ids) {
      const inst = mesh.addInstance(id);
      mesh.setMatrixAt(inst, m);
    }
  }

  // Culled and sorted once per view, not once per pass (`batch-cull.ts`).
  return memoizeBatchCulling(mesh);
}

export function disposePropMesh(mesh: THREE.BatchedMesh): void {
  (mesh.material as THREE.Material).dispose();
  mesh.dispose();
}
