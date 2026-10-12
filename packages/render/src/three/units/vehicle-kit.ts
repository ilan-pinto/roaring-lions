/**
 * Kitted vehicles (GH-238, plan 3): the bought kit, merged into the hull at
 * load, for +0 draw calls.
 *
 * A KDF vehicle's GLB carries every kit part it can ever wear as its own
 * node, `kit_<track>_<tier>_<host>` with `extras.rl_kit = { track, tier,
 * host }` (`mesh-unit-contract.md`, "Kit parts"). The brigade buys tiers
 * type-wide and they are fixed for a mission (brigade D3), so the choice of
 * parts is made ONCE, here, on the template -- never per entity, never per
 * frame. What this does to the scene graph:
 *
 * 1. Keep a part when `tier <= tiers[track]` (tiers are cumulative within a
 *    track: tier 3 draws 1, 2 and 3). A track the map does not name is 0.
 * 2. Merge the kept parts into their host's geometry, HOST FIRST and kit
 *    after, so `setDrawRange(0, rlKitBaseCount)` hides exactly the kit (the
 *    `kit` debug layer) and the host's own triangles keep their indices.
 * 3. Swap the merged geometry onto EVERY mesh that referenced the host's old
 *    one. `GLTFLoader` hands back the live node and its `WRECK_` twin as two
 *    `THREE.Mesh` objects over one `BufferGeometry` (the wreck pass shares
 *    the glTF mesh), so the wreck wears its kit with the host's own
 *    displacement -- no second recipe.
 * 4. Remove every `kit_*` node, kept or not: a kept part now lives inside its
 *    host, and a part the brigade has not bought must not draw.
 *
 * WHY THERE IS NO MATRIX IN THE MERGE. The contract puts each part under its
 * host's parent with its host's local transform, so its vertices are already
 * in the host's own space (`tools/src/meshes/kit-pass.ts` did the
 * world-to-host transform once, at graft time). That is ASSERTED here rather
 * than silently corrected: a part whose parent or local matrix differs from
 * its host's means the graft broke the contract, and transforming it at load
 * would hide that until a part drifted off a hull in a screenshot.
 *
 * WITH NO TIERS, OR EVERY TIER 0, the template is the shipped one: every live
 * mesh keeps its exact geometry object, and only the (undrawn) kit nodes go.
 * That is what keeps every gated golden scenario still on a kitted GLB.
 *
 * A TWO-LEVEL LOD, for the slat bars (GH-238 leftovers, 2026-10-12). A part
 * may carry `_near` and `_far` nodes beside its main one (`rl_kit.lod`): the
 * real 30 mm bars at 120 mm, and coarse bars at twice the pitch that keep
 * the cage's mean coverage. At zoom 1 and DPR 1 the real rows are a 1.57 px
 * period of 0.62 px bars -- above Nyquist on a single-sampled target, so they
 * alias into a moving moire that SMAA cannot undo. Both levels are merged
 * into the ONE geometry (host, main, near, far), and it carries TWO index
 * buffers over that vertex buffer: host + main + near (the default, and all
 * the garage ever draws) and host + main + far. `setKitLod` swaps them, and
 * `ThreeRenderer` calls it when `camera.zoom x pixelRatio` crosses
 * `KIT_LOD_SWITCH`. Still one draw per mesh; the host stays first in both, so
 * `rlKitBaseCount` and the `kit` debug layer mean what they did.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** The node-name prefix every kit part carries (`kit_armour_3_turret_hull`). */
export const KIT_NODE_PREFIX = 'kit_';

/** The `userData` key on a merged geometry holding the host's OWN index (or,
 *  for a non-indexed host, vertex) count -- the draw range that shows the
 *  host and none of its kit. Absent on every geometry that carries no kit. */
export const KIT_BASE_COUNT_KEY = 'rlKitBaseCount';

/** A type's bought tiers, by track (`armour`, `sensors`, `firepower`).
 *  Type-wide and fixed for the mission (brigade D3). */
export type VehicleKitTiers = Readonly<Record<string, number>>;

/** The `userData` key on a merged geometry whose kit carries an LOD: the two
 *  index buffers `setKitLod` swaps between. */
export const KIT_LOD_KEY = 'rlKitLod';

/** Below this `camera.zoom x pixelRatio` the renderer draws the far bars.
 *  Measured, not derived: `pnpm kit:capture -- --measure` reads the pan
 *  shimmer of both levels at six zooms; see the PR for the readings. */
export const KIT_LOD_SWITCH = 1.75;

export interface KitLodIndices {
  readonly near: THREE.BufferAttribute;
  readonly far: THREE.BufferAttribute;
}

/** `extras.rl_kit`, as the contract writes it. */
export interface KitPartTag {
  readonly track: string;
  readonly tier: number;
  readonly host: string;
  /** Absent: drawn at every zoom. */
  readonly lod?: 'near' | 'far';
}

function isKitNode(o: THREE.Object3D): boolean {
  return o.name.startsWith(KIT_NODE_PREFIX) || (o.userData as { rl_kit?: unknown }).rl_kit !== undefined;
}

function kitTag(o: THREE.Object3D): KitPartTag {
  const raw = (o.userData as { rl_kit?: unknown }).rl_kit;
  if (typeof raw === 'object' && raw !== null) {
    const { track, tier, host, lod } = raw as { track?: unknown; tier?: unknown; host?: unknown; lod?: unknown };
    if (
      (lod === undefined || lod === 'near' || lod === 'far') &&
      typeof track === 'string' &&
      track.length > 0 &&
      typeof host === 'string' &&
      host.length > 0 &&
      typeof tier === 'number' &&
      Number.isInteger(tier) &&
      tier >= 1
    ) {
      return lod === undefined ? { track, tier, host } : { track, tier, host, lod };
    }
  }
  throw new Error(
    `vehicle-kit: node "${o.name}" is a kit part but carries no valid extras.rl_kit ` +
      `({ track, tier >= 1, host, lod? near|far }) -- see mesh-unit-contract.md, "Kit parts"`
  );
}

/** The geometry's own draw count: its index count, or its vertex count when
 *  it has no index. */
function baseCount(g: THREE.BufferGeometry): number {
  return g.index !== null ? g.index.count : g.getAttribute('position').count;
}

const MATRIX_EPSILON = 1e-5;

function sameLocalMatrix(a: THREE.Object3D, b: THREE.Object3D): boolean {
  a.updateMatrix();
  b.updateMatrix();
  const ea = a.matrix.elements;
  const eb = b.matrix.elements;
  for (let i = 0; i < 16; i++) {
    if (Math.abs(ea[i] - eb[i]) > MATRIX_EPSILON) return false;
  }
  return true;
}

function attributeSet(g: THREE.BufferGeometry): string {
  return Object.keys(g.attributes).sort().join(',');
}

/**
 * Applies a type's bought kit to a freshly loaded vehicle scene, IN PLACE.
 * See this module's top comment for what that means.
 *
 * Returns every `BufferGeometry` no mesh in `root` references any more -- the
 * hosts' replaced geometries and every kit part's own -- so a caller that
 * owns them (`buildVehicleMeshTemplate`) can dispose them. Nothing returned
 * has been uploaded: this runs before any frame draws the template.
 *
 * Throws, naming the node, when a part breaks the contract: no valid
 * `rl_kit`, no host by that name, a parent or local transform different from
 * its host's, a different material, or a different attribute set.
 */
export function applyVehicleKit(root: THREE.Object3D, tiers?: VehicleKitTiers): THREE.BufferGeometry[] {
  const kitNodes: THREE.Object3D[] = [];
  const hostsByName = new Map<string, THREE.Mesh>();
  root.traverse((o) => {
    if (isKitNode(o)) {
      kitNodes.push(o);
      return;
    }
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if ((mesh.userData as { rl_wreck?: unknown }).rl_wreck === true) return;
    // First by name wins, the order `Object3D.getObjectByName` uses.
    if (!hostsByName.has(mesh.name)) hostsByName.set(mesh.name, mesh);
  });
  if (kitNodes.length === 0) return [];

  // Kept parts by host, validated whether kept or not: a malformed part is a
  // broken export at tier 0 too, and must not wait for a brigade to buy it.
  const kept = new Map<THREE.Mesh, { tag: KitPartTag; mesh: THREE.Mesh }[]>();
  for (const node of kitNodes) {
    const tag = kitTag(node);
    const part = node as THREE.Mesh;
    if (!part.isMesh) {
      throw new Error(`vehicle-kit: kit part "${node.name}" is not a single mesh (one primitive per part)`);
    }
    const host = hostsByName.get(tag.host);
    if (host === undefined) {
      throw new Error(`vehicle-kit: kit part "${node.name}" names host "${tag.host}", and no live mesh has that name`);
    }
    if (part.parent !== host.parent) {
      throw new Error(
        `vehicle-kit: kit part "${node.name}" must share its host "${tag.host}"'s parent ` +
          `("${host.parent?.name ?? '(none)'}"), and sits under "${part.parent?.name ?? '(none)'}"`
      );
    }
    if (!sameLocalMatrix(part, host)) {
      throw new Error(
        `vehicle-kit: kit part "${node.name}" must share its host "${tag.host}"'s local transform ` +
          `(the contract merges with no matrix), and it differs`
      );
    }
    if (part.material !== host.material) {
      throw new Error(`vehicle-kit: kit part "${node.name}" must use its host "${tag.host}"'s material`);
    }
    if (attributeSet(part.geometry) !== attributeSet(host.geometry)) {
      throw new Error(
        `vehicle-kit: kit part "${node.name}" carries attributes [${attributeSet(part.geometry)}], ` +
          `its host "${tag.host}" [${attributeSet(host.geometry)}]; they must match`
      );
    }
    if ((part.geometry.index === null) !== (host.geometry.index === null)) {
      throw new Error(`vehicle-kit: kit part "${node.name}" and its host "${tag.host}" must both be indexed or neither`);
    }
    if (tag.tier > (tiers?.[tag.track] ?? 0)) continue;
    const list = kept.get(host);
    if (list) list.push({ tag, mesh: part });
    else kept.set(host, [{ tag, mesh: part }]);
  }

  const candidates = new Set<THREE.BufferGeometry>();
  for (const node of kitNodes) candidates.add((node as THREE.Mesh).geometry);

  const LOD_ORDER = { main: 0, near: 1, far: 2 } as const;
  for (const [host, parts] of kept) {
    // A fixed order, so two loads of one GLB build byte-identical buffers:
    // every main part, then every near level, then every far level, each
    // by track and tier -- the two index buffers below are then two slices.
    parts.sort((a, b) => {
      const la = LOD_ORDER[a.tag.lod ?? 'main'];
      const lb = LOD_ORDER[b.tag.lod ?? 'main'];
      if (la !== lb) return la - lb;
      return a.tag.track !== b.tag.track ? (a.tag.track < b.tag.track ? -1 : 1) : a.tag.tier - b.tag.tier;
    });
    const nearCount = parts.filter((p) => p.tag.lod === 'near').length;
    const farCount = parts.filter((p) => p.tag.lod === 'far').length;
    if ((nearCount === 0) !== (farCount === 0)) {
      throw new Error(
        `vehicle-kit: host "${host.name}" keeps ${nearCount} near and ${farCount} far LOD part(s) -- ` +
          `a level swaps for its partner, so both or neither`
      );
    }
    const old = host.geometry;
    if ((nearCount > 0 || farCount > 0) && old.index === null) {
      throw new Error(`vehicle-kit: host "${host.name}" is not indexed, and a kit LOD swaps index buffers`);
    }
    const merged = mergeGeometries([old, ...parts.map((p) => p.mesh.geometry)], false);
    if (merged === null) {
      throw new Error(
        `vehicle-kit: could not merge ${parts.map((p) => `"${p.mesh.name}"`).join(', ')} into "${host.name}" ` +
          `(mergeGeometries refused: attribute array types, item sizes or normalisation differ)`
      );
    }
    merged.name = old.name;
    merged.userData[KIT_BASE_COUNT_KEY] = baseCount(old);
    if (nearCount > 0 && merged.index !== null) {
      // [host | main | near | far] in the merged index: near = the first
      // three runs, far = the first two and the last.
      const full = merged.index.array;
      const before = baseCount(old) + parts.filter((p) => p.tag.lod === undefined).reduce((n, p) => n + baseCount(p.mesh.geometry), 0);
      const near = parts.filter((p) => p.tag.lod === 'near').reduce((n, p) => n + baseCount(p.mesh.geometry), 0);
      const nearArr = full.slice(0, before + near);
      const farArr = new (full.constructor as new (n: number) => typeof full)(full.length - near);
      farArr.set(full.subarray(0, before), 0);
      farArr.set(full.subarray(before + near), before);
      const lod: KitLodIndices = {
        near: new THREE.BufferAttribute(nearArr, 1),
        far: new THREE.BufferAttribute(farArr, 1),
      };
      merged.setIndex(lod.near);
      merged.userData[KIT_LOD_KEY] = lod;
    }
    // EVERY mesh over the old geometry -- the live node and its `WRECK_` twin.
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.geometry === old) mesh.geometry = merged;
    });
    candidates.add(old);
  }

  for (const node of kitNodes) node.parent?.remove(node);

  // Only what no remaining mesh references -- never a geometry still drawn.
  const live = new Set<THREE.BufferGeometry>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) live.add(mesh.geometry);
  });
  return [...candidates].filter((g) => !live.has(g));
}

/**
 * The `kit` debug layer's worker: on every geometry that carries kit
 * (`KIT_BASE_COUNT_KEY`), `hidden` draws the host alone and `!hidden` draws
 * everything. A geometry with no kit is untouched. Returns how many
 * geometries it set.
 *
 * Holds across frames by construction: nothing per-frame writes a vehicle
 * template's draw range (its geometries are shared by every clone and are
 * only ever read).
 */
export function setKitDrawRange(geometries: Iterable<THREE.BufferGeometry>, hidden: boolean): number {
  let n = 0;
  for (const g of geometries) {
    const base = (g.userData as Record<string, unknown>)[KIT_BASE_COUNT_KEY];
    if (typeof base !== 'number') continue;
    g.setDrawRange(0, hidden ? base : Infinity);
    n++;
  }
  return n;
}

/**
 * The kit LOD's worker: on every geometry that carries one
 * (`KIT_LOD_KEY`), draw the far bars when `far`, the near (real) ones when
 * not. Leaves the draw range alone, so a hidden `kit` debug layer stays
 * hidden: the host is first in both index buffers. Returns how many
 * geometries it switched.
 */
export function setKitLod(geometries: Iterable<THREE.BufferGeometry>, far: boolean): number {
  let n = 0;
  for (const g of geometries) {
    const lod = (g.userData as Record<string, unknown>)[KIT_LOD_KEY] as KitLodIndices | undefined;
    if (!lod) continue;
    const want = far ? lod.far : lod.near;
    if (g.index !== want) {
      g.setIndex(want);
      n++;
    }
  }
  return n;
}

/** Whether the renderer should draw the far bars at this zoom and pixel
 *  ratio (`KIT_LOD_SWITCH`). */
export function kitLodIsFar(zoom: number, pixelRatio: number): boolean {
  return zoom * pixelRatio < KIT_LOD_SWITCH;
}
