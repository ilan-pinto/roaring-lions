/**
 * In-memory documents for the kit pass's tests (and the wreck pass's kit
 * case): a miniature vehicle with the shipped files' shapes, and a kit source
 * in the shape `export_vehicle_kit.py` writes. Built in code with
 * gltf-transform rather than read from art, for the reason
 * `wreck-pass.test.ts` gives: a test over `art/meshes/vehicles/*.glb` would
 * pass or fail on whether somebody had run a pass on them.
 *
 * The vehicle, as censused on the shipped eight:
 *
 *   hull_hull      textured (bake material, TEXCOORD_0), a scene child,
 *                  deliberately NOT at the identity so a hull part's inverse
 *                  transform is not a no-op either
 *   hull_rubber    textured, at the identity
 *   turret_pivot   an empty, translated AND turned 30 degrees about Y, so a
 *                  part grafted without the inverse host transform lands
 *                  visibly wrong and its normals turn too
 *     turret_hull  textured, local translation not cancelling the pivot
 *     turret_metal PALETTE: no material, no TEXCOORD_0 (the Namer/Eitan/Kipod/
 *                  Shachaf weapon station)
 */
import { Document, type Material, type Mesh, type vec3, type vec4 } from '@gltf-transform/core';

export const PIVOT_T: vec3 = [2, 6, 0.5];
/** 30 degrees about +Y, as a quaternion. */
export const PIVOT_R: vec4 = [0, Math.sin(Math.PI / 12), 0, Math.cos(Math.PI / 12)];
export const HULL_T: vec3 = [0, 0.5, 0];

/** The six faces of an axis-aligned box: outward normal, and the two in-plane
 *  axes as (axis index, sign) so the four corners wind outward. */
const FACES: readonly { n: vec3; corners: readonly vec3[] }[] = [
  { n: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { n: [-1, 0, 0], corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
  { n: [0, 1, 0], corners: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
  { n: [0, -1, 0], corners: [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]] },
  { n: [0, 0, 1], corners: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]] },
  { n: [0, 0, -1], corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
];

export interface BoxOptions {
  /** Write TEXCOORD_0, every vertex pinned to this one texel (the T1 rule). */
  readonly uv?: readonly [number, number] | null;
  readonly material?: Material | null;
}

/** A closed box with flat normals, as one indexed TRIANGLES primitive. */
export function boxMesh(doc: Document, name: string, min: vec3, max: vec3, opts: BoxOptions = {}): Mesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (const face of FACES) {
    const base = positions.length / 3;
    for (const c of face.corners) {
      positions.push(...([0, 1, 2] as const).map((k) => (c[k] ? max[k] : min[k])));
      normals.push(...face.n);
      if (opts.uv) uvs.push(opts.uv[0], opts.uv[1]);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const buffer = doc.getRoot().listBuffers()[0];
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', doc.createAccessor(`${name}_P`, buffer).setType('VEC3').setArray(new Float32Array(positions)))
    .setAttribute('NORMAL', doc.createAccessor(`${name}_N`, buffer).setType('VEC3').setArray(new Float32Array(normals)))
    .setIndices(doc.createAccessor(`${name}_I`, buffer).setType('SCALAR').setArray(new Uint16Array(indices)));
  if (opts.uv) {
    prim.setAttribute('TEXCOORD_0', doc.createAccessor(`${name}_T`, buffer).setType('VEC2').setArray(new Float32Array(uvs)));
  }
  if (opts.material) prim.setMaterial(opts.material);
  return doc.createMesh(name).addPrimitive(prim);
}

/** The miniature vehicle described in this file's header. */
export function kitVehicle(): Document {
  const doc = new Document();
  doc.createBuffer();
  const scene = doc.createScene('Scene');
  const bake = doc.createMaterial('bake');

  const hull = doc
    .createNode('hull_hull')
    .setTranslation(HULL_T)
    .setMesh(boxMesh(doc, 'hull_hull', [-1, 0, -1], [1, 2, 1], { uv: [0.1, 0.2], material: bake }))
    .setExtras({ rl_role: 'hull', rl_part: 'hull' });
  const rubber = doc
    .createNode('hull_rubber')
    .setMesh(boxMesh(doc, 'hull_rubber', [-1, 0, -1], [1, 2, 1], { uv: [0.3, 0.4], material: bake }))
    .setExtras({ rl_role: 'rubber', rl_part: 'hull' });

  const pivot = doc.createNode('turret_pivot').setTranslation(PIVOT_T).setRotation(PIVOT_R).setExtras({ rl_pivot: 'turret' });
  const turretHull = doc
    .createNode('turret_hull')
    .setTranslation([0.5, -1, 0])
    .setMesh(boxMesh(doc, 'turret_hull', [-0.4, 0, -0.4], [0.4, 1, 0.4], { uv: [0.5, 0.6], material: bake }))
    .setExtras({ rl_role: 'hull', rl_part: 'turret' });
  const turretMetal = doc
    .createNode('turret_metal')
    .setTranslation([-0.3, 0.2, 0.1])
    .setMesh(boxMesh(doc, 'turret_metal', [-0.2, 0, -0.2], [0.2, 0.5, 0.2]))
    .setExtras({ rl_role: 'metal', rl_part: 'turret' });
  pivot.addChild(turretHull).addChild(turretMetal);

  scene.addChild(hull).addChild(rubber).addChild(pivot);
  return doc;
}

export interface KitPartSpec {
  readonly track: string;
  readonly tier: number;
  readonly host: string;
  /** World-space box, as the Blender exporter writes it. */
  readonly min: vec3;
  readonly max: vec3;
  /** Override the node name (to falsify the name check). */
  readonly name?: string;
  /** Override extras.rl_kit wholesale (to falsify the rl_kit checks). */
  readonly rlKit?: unknown;
  /** Leave TEXCOORD_0 out (the exporter always writes it; this falsifies). */
  readonly noUv?: boolean;
  readonly material?: boolean;
}

/** The default source: one part on each kind of host -- a textured hull at
 *  the scene root, a textured turret part and a palette turret part under the
 *  turned pivot. Every one sits in VEHICLE world space. */
export const DEFAULT_KIT: readonly KitPartSpec[] = [
  { track: 'armour', tier: 1, host: 'hull_hull', min: [1.0, 0.6, -0.3], max: [1.3, 1.4, 0.3] },
  { track: 'armour', tier: 3, host: 'turret_hull', min: [2.6, 5.2, 0.2], max: [3.0, 5.9, 0.9] },
  { track: 'sensors', tier: 2, host: 'turret_metal', min: [1.6, 6.3, 0.4], max: [1.8, 7.1, 0.7] },
];

/** A kit source in the exporter's shape: one node per part at the identity at
 *  the scene root, POSITION + NORMAL + TEXCOORD_0 in world space, no material,
 *  `extras.rl_kit` and an `rl_role` of its own (the graft replaces it). */
export function kitSource(parts: readonly KitPartSpec[] = DEFAULT_KIT): Document {
  const doc = new Document();
  doc.createBuffer();
  const scene = doc.createScene('Scene');
  const stray = doc.createMaterial('stray');
  for (const p of parts) {
    const name = p.name ?? `kit_${p.track}_${p.tier}_${p.host}`;
    scene.addChild(
      doc
        .createNode(name)
        .setMesh(
          boxMesh(doc, name, p.min, p.max, {
            uv: p.noUv ? null : [0.75, 0.25],
            material: p.material ? stray : null,
          })
        )
        .setExtras({
          rl_role: 'plate',
          rl_kit: p.rlKit === undefined ? { track: p.track, tier: p.tier, host: p.host } : p.rlKit,
        })
    );
  }
  return doc;
}
