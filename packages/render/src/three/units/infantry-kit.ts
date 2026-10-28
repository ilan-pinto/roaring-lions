/**
 * Kitted infantry (GH-826): the bought upgrade kit, merged into a team's role
 * primitives at load, for +0 draw calls.
 *
 * The brigade buys tiers per unit type and they are fixed for a mission
 * (brigade D3), and `@lions/data`'s `applyUpgrades` is where the SIM learns of
 * them; the renderer reads the same tiers (`RendererOptions.unitKitTiers`,
 * from `upgrade-prepass.ts`) and chooses parts ONCE, here, on the template.
 * Never per entity, never per frame, and never a status mark in the world:
 * the gear on the figure is the signal.
 *
 * A kitted team's GLB carries, beside its role meshes, one packed node per
 * host role it can kit, `kit_uniform` and `kit_weapon`
 * (`tools/src/meshes/infantry-kit-pass.ts`). Each is a SkinnedMesh of the same
 * skeleton, with the host's attributes plus `_rl_kit`, one byte per vertex:
 * the id of the part the vertex belongs to, an index into
 * `userData.rl_kit.parts` (`{ id, track, tier, figure, part, slot?, side? }`).
 * Every part is rigid on one bone (weight 1), so it rides that bone in every
 * clip the team already has: the kit adds no clips, keys or poses.
 *
 * What this does to the scene graph:
 *
 * 1. Choose the kept parts (`keptPartIds`): `tier <= tiers[track]`, and where a
 *    part names a `slot` only the HIGHEST bought tier in each (track, figure,
 *    slot, side) -- a red dot gives way to the magnified optic, the monocular
 *    to the quad tube, the short whip to the long one, the shoulder pads to
 *    the arm sleeve. Base geometry is never in a slot, and a tier only ever
 *    ADDS to the figure: tier 0 is the shipped figure.
 * 2. Cut the triangles of the kept parts out of the packed primitive
 *    (`keptKitGeometry`), compacting the vertices, and merge them into their
 *    host's geometry, HOST FIRST and kit after, so
 *    `setDrawRange(0, rlKitBaseCount)` hides exactly the kit and the host's
 *    own triangles keep their indices.
 * 3. Remove every `kit_*` node, kept or not.
 *
 * WITH NO TIERS, OR EVERY TIER 0, the template is the shipped one: every
 * role mesh keeps its exact geometry object and only the (undrawn) kit nodes
 * go. That is what keeps every gated golden scenario that fields a plain squad
 * still byte-for-byte what it was.
 *
 * Contract violations THROW, naming the node, rather than being silently
 * corrected: a kit that does not sit on its host's skeleton, material and
 * attribute set would otherwise draw wrong in a frame and be found there.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { KIT_BASE_COUNT_KEY, KIT_NODE_PREFIX } from './vehicle-kit';

/** The per-vertex part id on a packed kit primitive (`_RL_KIT`, lower-cased by the loader). */
export const INFANTRY_KIT_TAG_ATTR = '_rl_kit';

/** A team's bought tiers by track (`armour`, `sensors`, `firepower`). */
export type InfantryKitTiers = Readonly<Record<string, number>>;

/** One entry of `userData.rl_kit.parts`. */
export interface InfantryKitPart {
  readonly id: number;
  readonly track: string;
  readonly tier: number;
  readonly figure: string;
  readonly part: string;
  readonly slot?: string;
  readonly side?: string;
}

/** What a packed kit node reports about itself. */
export interface InfantryKitTag {
  readonly host: string;
  readonly parts: readonly InfantryKitPart[];
}

/** The result of applying a kit to a freshly loaded team scene. */
export interface InfantryKitResult {
  /** Geometries no mesh in the scene references any more: dispose them. */
  readonly unused: THREE.BufferGeometry[];
  /** The GLB carries kit nodes at all (whether or not any tier was bought). */
  readonly kitted: boolean;
  /** Triangles merged into the role primitives. */
  readonly keptTris: number;
}

function isKitNode(o: THREE.Object3D): boolean {
  return o.name.startsWith(KIT_NODE_PREFIX) || (o.userData as { rl_kit?: unknown }).rl_kit !== undefined;
}

/** Validate and read `userData.rl_kit` of a packed node. */
export function infantryKitTag(o: THREE.Object3D): InfantryKitTag {
  const raw = (o.userData as { rl_kit?: unknown }).rl_kit;
  const bad = (why: string): never => {
    throw new Error(
      `infantry-kit: node "${o.name}" is a kit node but ${why} -- see mesh-unit-contract.md, "Infantry kit parts"`
    );
  };
  if (typeof raw !== 'object' || raw === null) return bad('carries no extras.rl_kit');
  const { host, parts } = raw as { host?: unknown; parts?: unknown };
  if (typeof host !== 'string' || host.length === 0) return bad('names no host');
  if (!Array.isArray(parts) || parts.length === 0) return bad('lists no parts');
  const out: InfantryKitPart[] = [];
  (parts as unknown[]).forEach((p, i) => {
    if (typeof p !== 'object' || p === null) return bad(`part ${i} is not an object`);
    const { track, tier, figure, part, slot, side } = p as Record<string, unknown>;
    if (typeof track !== 'string' || track.length === 0) return bad(`part ${i} has no track`);
    if (typeof tier !== 'number' || !Number.isInteger(tier) || tier < 1) return bad(`part ${i} has tier ${String(tier)}`);
    if (typeof figure !== 'string' || typeof part !== 'string') return bad(`part ${i} has no figure or part name`);
    if (slot !== undefined && typeof slot !== 'string') return bad(`part ${i} has a non-string slot`);
    if (side !== undefined && typeof side !== 'string') return bad(`part ${i} has a non-string side`);
    out.push({
      id: i,
      track,
      tier,
      figure,
      part,
      ...(slot === undefined ? {} : { slot }),
      ...(side === undefined ? {} : { side }),
    });
  });
  return { host, parts: out };
}

/**
 * The ids of the parts a team with `tiers` wears. Pure.
 *
 * A part is eligible when `tier <= tiers[track]` (tiers are cumulative within
 * a track: tier 3 draws 1, 2 and 3); among the eligible parts that name a
 * slot, only the highest tier of each (track, figure, slot, side) is kept.
 */
export function keptPartIds(parts: readonly InfantryKitPart[], tiers: InfantryKitTiers | undefined): Set<number> {
  const eligible = parts.filter((p) => p.tier <= (tiers?.[p.track] ?? 0));
  const best = new Map<string, number>();
  const slotKey = (p: InfantryKitPart): string => `${p.track}/${p.figure}/${p.slot ?? ''}/${p.side ?? ''}`;
  for (const p of eligible) {
    if (p.slot === undefined) continue;
    const k = slotKey(p);
    best.set(k, Math.max(best.get(k) ?? 0, p.tier));
  }
  const kept = new Set<number>();
  for (const p of eligible) {
    if (p.slot !== undefined && p.tier !== best.get(slotKey(p))) continue;
    kept.add(p.id);
  }
  return kept;
}

/**
 * The packed kit geometry cut down to the triangles of the `keep` parts, its
 * vertices compacted (in order of first use, so two loads of one GLB build
 * identical buffers) and the part-id attribute dropped. Null when nothing is
 * kept. Throws on a triangle whose three vertices disagree about their part.
 */
export function keptKitGeometry(
  kit: THREE.BufferGeometry,
  keep: ReadonlySet<number>,
  label: string
): { geometry: THREE.BufferGeometry; triangles: number } | null {
  const tag = kit.getAttribute(INFANTRY_KIT_TAG_ATTR);
  const index = kit.index;
  if (!tag || !index) throw new Error(`infantry-kit: "${label}" has no ${INFANTRY_KIT_TAG_ATTR} attribute or no index`);
  const remap = new Map<number, number>();
  const order: number[] = [];
  const out: number[] = [];
  for (let t = 0; t < index.count; t += 3) {
    const a = index.getX(t);
    const b = index.getX(t + 1);
    const c = index.getX(t + 2);
    const id = tag.getX(a);
    if (tag.getX(b) !== id || tag.getX(c) !== id) {
      throw new Error(`infantry-kit: "${label}" triangle ${t / 3} spans two parts (${id}, ${tag.getX(b)}, ${tag.getX(c)})`);
    }
    if (!keep.has(id)) continue;
    for (const v of [a, b, c]) {
      let n = remap.get(v);
      if (n === undefined) {
        n = order.length;
        remap.set(v, n);
        order.push(v);
      }
      out.push(n);
    }
  }
  if (out.length === 0) return null;
  const g = new THREE.BufferGeometry();
  for (const [name, src] of Object.entries(kit.attributes)) {
    if (name === INFANTRY_KIT_TAG_ATTR) continue;
    // Read through the accessor, never `.array`: a loaded attribute may be an
    // `InterleavedBufferAttribute`, whose `.array` is the whole interleaved
    // block (found against the shipped file: weights of 1.37 on kit vertices).
    const a = src as THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
    const Ctor = a.array.constructor as new (n: number) => THREE.BufferAttribute['array'];
    const arr = new Ctor(order.length * a.itemSize);
    for (let i = 0; i < order.length; i++) {
      for (let k = 0; k < a.itemSize; k++) {
        const v = a.getComponent(order[i], k);
        arr[i * a.itemSize + k] = a.normalized ? THREE.MathUtils.denormalize(v, a.array as Float32Array) : v;
      }
    }
    const copy = new THREE.BufferAttribute(arr, a.itemSize, a.normalized);
    // `mergeGeometries` refuses attributes whose `gpuType` differs; the loader sets it
    // (integer for skin indices), and a cut attribute must keep what its source had.
    (copy as { gpuType?: unknown }).gpuType = (a as { gpuType?: unknown }).gpuType;
    g.setAttribute(name, copy);
  }
  g.setIndex(new THREE.BufferAttribute(order.length > 65535 ? new Uint32Array(out) : new Uint16Array(out), 1));
  return { geometry: g, triangles: out.length / 3 };
}

const MATRIX_EPSILON = 1e-5;

function sameMatrix(a: THREE.Matrix4, b: THREE.Matrix4): boolean {
  for (let i = 0; i < 16; i++) if (Math.abs(a.elements[i] - b.elements[i]) > MATRIX_EPSILON) return false;
  return true;
}

function sameLocalMatrix(a: THREE.Object3D, b: THREE.Object3D): boolean {
  a.updateMatrix();
  b.updateMatrix();
  return sameMatrix(a.matrix, b.matrix);
}

const attributeSet = (g: THREE.BufferGeometry, drop?: string): string =>
  Object.keys(g.attributes)
    .filter((k) => k !== drop)
    .sort()
    .join(',');

/**
 * Applies a team's bought kit to a freshly loaded team scene, IN PLACE. See
 * the module comment. A scene with no kit nodes is left alone (`kitted:
 * false`).
 *
 * Nothing returned has been uploaded: this runs before any frame draws the
 * template.
 */
export function applyInfantryKit(root: THREE.Object3D, tiers?: InfantryKitTiers): InfantryKitResult {
  const kitNodes: THREE.Object3D[] = [];
  const hostsByName = new Map<string, THREE.SkinnedMesh>();
  root.traverse((o) => {
    if (isKitNode(o)) {
      kitNodes.push(o);
      return;
    }
    const mesh = o as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh && !hostsByName.has(mesh.name)) hostsByName.set(mesh.name, mesh);
  });
  if (kitNodes.length === 0) return { unused: [], kitted: false, keptTris: 0 };

  const candidates = new Set<THREE.BufferGeometry>();
  const merges: { host: THREE.SkinnedMesh; kept: THREE.BufferGeometry }[] = [];
  let keptTris = 0;
  for (const node of kitNodes) {
    const kit = node as THREE.SkinnedMesh;
    if (!kit.isSkinnedMesh) throw new Error(`infantry-kit: kit node "${node.name}" is not a skinned mesh`);
    candidates.add(kit.geometry);
    const tag = infantryKitTag(node);
    const host = hostsByName.get(tag.host);
    if (host === undefined) {
      throw new Error(`infantry-kit: kit node "${node.name}" names host "${tag.host}", and no skinned mesh has that name`);
    }
    if (kit.parent !== host.parent) {
      throw new Error(`infantry-kit: kit node "${node.name}" must share its host "${tag.host}"'s parent`);
    }
    if (!sameLocalMatrix(kit, host)) {
      throw new Error(`infantry-kit: kit node "${node.name}" must share its host "${tag.host}"'s local transform`);
    }
    if (kit.material !== host.material) {
      throw new Error(`infantry-kit: kit node "${node.name}" must use its host "${tag.host}"'s material (+0 draw calls)`);
    }
    if (attributeSet(kit.geometry, INFANTRY_KIT_TAG_ATTR) !== attributeSet(host.geometry)) {
      throw new Error(
        `infantry-kit: kit node "${node.name}" carries [${attributeSet(kit.geometry, INFANTRY_KIT_TAG_ATTR)}], ` +
          `its host "${tag.host}" [${attributeSet(host.geometry)}]; they must match`
      );
    }
    if (kit.geometry.index === null || host.geometry.index === null) {
      throw new Error(`infantry-kit: kit node "${node.name}" and its host "${tag.host}" must both be indexed`);
    }
    const names = (m: THREE.SkinnedMesh): string => m.skeleton.bones.map((b) => b.name).join(',');
    if (names(kit) !== names(host) || !sameMatrix(kit.bindMatrix, host.bindMatrix)) {
      throw new Error(`infantry-kit: kit node "${node.name}" is not bound to its host "${tag.host}"'s skeleton and bind matrix`);
    }
    // Validated whether kept or not: a malformed kit is a broken export at tier 0 too.
    const cut = keptKitGeometry(kit.geometry, keptPartIds(tag.parts, tiers), node.name);
    if (cut === null) continue;
    candidates.add(cut.geometry);
    keptTris += cut.triangles;
    merges.push({ host, kept: cut.geometry });
  }

  for (const { host, kept } of merges) {
    const old = host.geometry;
    const merged = mergeGeometries([old, kept], false);
    if (merged === null) {
      throw new Error(
        `infantry-kit: could not merge the kit into "${host.name}" ` +
          `(mergeGeometries refused: attribute array types, item sizes or normalisation differ)`
      );
    }
    merged.name = old.name;
    merged.userData[KIT_BASE_COUNT_KEY] = old.index !== null ? old.index.count : old.getAttribute('position').count;
    host.geometry = merged;
    candidates.add(old);
  }
  for (const node of kitNodes) node.parent?.remove(node);

  // Only what no remaining mesh references -- never a geometry still drawn.
  const live = new Set<THREE.BufferGeometry>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) live.add(mesh.geometry);
  });
  return { unused: [...candidates].filter((g) => !live.has(g)), kitted: true, keptTris };
}
