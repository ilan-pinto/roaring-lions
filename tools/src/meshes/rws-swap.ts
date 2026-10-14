/**
 * Put the Meshy remote weapon station on the four KDF hulls that carried
 * `kit.rws`'s box (unit polish, item 3; the lead's rulings of 2026-10-14),
 * WITHOUT re-exporting a hull.
 *
 *     python3 tools/vehicles/rws_atlas.py <atlas_dir>
 *     pnpm --filter @lions/tools exec tsx src/meshes/rws-swap.ts -- --atlas=<atlas_dir> [--id=apc_eitan,...]
 *
 * Then the kit pipeline re-fits the firepower track to the new station:
 * `export_vehicle_kit.py` -> `pnpm kit:meshes` -> `pnpm wreck:meshes` ->
 * `pnpm encode:meshes`, and `pnpm validate:meshes`.
 *
 * ## Why not a re-export
 *
 * Every one of these hulls has been through passes after its Blender export
 * -- the running gear (`_RL_WHEEL`/`_RL_TRACK`), the kit graft, the wreck --
 * and the Namer's Meshy source is not even in this tree. The station is two
 * nodes, `turret_metal` and `turret_plate`, children of `turret_pivot`, whose
 * vertices are in the vehicle's own frame; so this pass rewrites those two
 * meshes and nothing else's geometry.
 *
 * ## What it writes, per host
 *
 *  - `turret_metal` / `turret_plate`: `art/parts/rws/rws_50.glb` (or
 *    `rws_30.glb` on the Namer) at the host's DECLARED scale (`HOST_SCALE`,
 *    the approved proposal's numbers against the part's 1.7 m), its ring foot
 *    on the pivot, the barrel along +X. The hull's own material, so the
 *    station is textured from the bake (`TEXCOORD_0` into the atlas slot).
 *  - The three maps widened to 2560 x 2048 (`rws_atlas.py`): the hull's
 *    pixels untouched, the station's 512 slot beside them. Every other
 *    textured primitive's u is scaled by 2048 / 2560 so it samples exactly
 *    the texels it did.
 *
 * Idempotent: it refuses a file whose `turret_metal` already has uvs.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, type Accessor, type Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const REPO = fileURLToPath(new URL('../../..', import.meta.url));

/** The proposal's declared per-host factors against the part's 1.7 m .50
 *  station: the Eitan carries the .50 itself; the Kipod a 7.62 station
 *  (~1.3 m); the Shachaf a light MG station (~1.2 m); the Namer the same
 *  cradle at 1.15 with its barrel lengthened to 30 mm in Blender. */
export const HOST_SCALE: Readonly<Record<string, { scale: number; part: 'rws_50' | 'rws_30' }>> = {
  apc_eitan: { scale: 1.0, part: 'rws_50' },
  apc_kipod: { scale: 0.76, part: 'rws_50' },
  scout_shachaf: { scale: 0.7, part: 'rws_50' },
  ifv_namer: { scale: 1.15, part: 'rws_30' },
};
export const HULL_PX = 2048;
export const ATLAS_PX = 2560;
const U_SCALE = HULL_PX / ATLAS_PX;
const MAPS = ['base_color', 'normal', 'metallic_roughness'] as const;

interface PartMesh {
  pos: Float32Array;
  nrm: Float32Array;
  uv: Float32Array;
  idx: Uint32Array<ArrayBuffer>;
}

async function readPart(io: NodeIO, name: string): Promise<Record<'metal' | 'plate', PartMesh>> {
  const doc = await io.read(path.join(REPO, 'art', 'parts', 'rws', `${name}.glb`));
  const out: Partial<Record<'metal' | 'plate', PartMesh>> = {};
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const role = ((node.getExtras() as { rl_role?: string }).rl_role ?? '') as string;
    if (role !== 'metal' && role !== 'plate') throw new Error(`rws-swap: ${name} node ${node.getName()} has role "${role}"`);
    // The exporter bakes object transforms (`export_apply`), and the part's
    // nodes sit at the identity -- asserted, so a stray transform cannot
    // silently move the station.
    const t = node.getTranslation();
    const r = node.getRotation();
    if (Math.hypot(...t) > 1e-6 || Math.abs(r[3]) < 0.999999) throw new Error(`rws-swap: ${name} ${node.getName()} is not at the identity`);
    const prims = mesh.listPrimitives();
    if (prims.length !== 1) throw new Error(`rws-swap: ${name} ${role} has ${prims.length} primitives`);
    const p = prims[0];
    const get = (a: string): Float32Array => new Float32Array(p.getAttribute(a)!.getArray() as ArrayLike<number>);
    out[role] = { pos: get('POSITION'), nrm: get('NORMAL'), uv: get('TEXCOORD_0'), idx: new Uint32Array(p.getIndices()!.getArray() as ArrayLike<number>) };
  }
  if (!out.metal || !out.plate) throw new Error(`rws-swap: ${name} lacks metal or plate`);
  return out as Record<'metal' | 'plate', PartMesh>;
}

function scaleU(prim: Primitive, done: Set<Accessor>): void {
  const a = prim.getAttribute('TEXCOORD_0');
  if (!a || done.has(a)) return;
  const uv = a.getArray() as Float32Array;
  const next = new Float32Array(uv.length);
  for (let i = 0; i < uv.length; i += 2) {
    next[i] = uv[i] * U_SCALE;
    next[i + 1] = uv[i + 1];
  }
  a.setArray(next);
  done.add(a);
}

export async function swap(io: NodeIO, id: string, atlasDir: string): Promise<string> {
  const spec = HOST_SCALE[id];
  if (!spec) throw new Error(`rws-swap: no host ${id}`);
  const file = path.join(REPO, 'art', 'meshes', 'vehicles', `${id}.glb`);
  const doc = await io.read(file);
  const root = doc.getRoot();
  const buffer = root.listBuffers()[0];
  const byName = new Map(root.listNodes().map((n) => [n.getName(), n]));
  const pivot = byName.get('turret_pivot');
  const metal = byName.get('turret_metal');
  const plate = byName.get('turret_plate');
  if (!pivot || !metal || !plate) throw new Error(`rws-swap: ${id} lacks turret_pivot/metal/plate`);
  if (metal.getMesh()!.listPrimitives()[0].getAttribute('TEXCOORD_0')) throw new Error(`rws-swap: ${id} already carries the station`);
  const materials = root.listMaterials();
  if (materials.length !== 1) throw new Error(`rws-swap: ${id} has ${materials.length} materials`);
  const material = materials[0];

  // 1. Every textured primitive into the hull's [0, 0.8) of the widened atlas.
  const done = new Set<Accessor>();
  for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) if (prim.getMaterial() === material) scaleU(prim, done);

  // 2. The station. A turret mesh's vertices are in the vehicle's frame (its
  // node carries -pivot under the pivot), so the station is placed at the
  // pivot's world position: glTF (x, y up, z right) from the part's Blender
  // frame (x, y left, z up).
  const pw = pivot.getWorldTranslation();
  const part = await readPart(io, spec.part);
  const k = spec.scale;
  for (const [node, role] of [[metal, 'metal'], [plate, 'plate']] as const) {
    const m = part[role];
    const n = m.pos.length / 3;
    const pos = new Float32Array(n * 3);
    const nrm = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      // The part GLB is already glTF (Y up): x forward, y up, z right.
      pos[i * 3] = pw[0] + m.pos[i * 3] * k;
      pos[i * 3 + 1] = pw[1] + m.pos[i * 3 + 1] * k;
      pos[i * 3 + 2] = pw[2] + m.pos[i * 3 + 2] * k;
      nrm.set(m.nrm.subarray(i * 3, i * 3 + 3), i * 3);
    }
    const mesh = node.getMesh()!;
    for (const old of mesh.listPrimitives()) old.dispose();
    mesh.addPrimitive(
      doc
        .createPrimitive()
        .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buffer))
        .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(nrm).setBuffer(buffer))
        .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(m.uv)).setBuffer(buffer))
        .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(m.idx)).setBuffer(buffer))
        .setMaterial(material)
    );
  }

  // 3. The widened maps.
  for (const tex of root.listTextures()) {
    const name = tex.getName() as (typeof MAPS)[number];
    if (!MAPS.includes(name)) throw new Error(`rws-swap: ${id} carries an unexpected image "${name}"`);
    tex.setImage(new Uint8Array(readFileSync(path.join(atlasDir, `${id}_${name}.jpg`)))).setMimeType('image/jpeg');
  }
  for (const a of root.listAccessors()) if (a.listParents().every((p) => p === root)) a.dispose();
  writeFileSync(file, await io.writeBinary(doc));
  const tris = (part.metal.idx.length + part.plate.idx.length) / 3;
  return `RWS ${id}: ${spec.part} x${k} at the pivot (${pw.map((x) => x.toFixed(3)).join(', ')}), ${tris} tris; ${done.size} uv set(s) into the ${ATLAS_PX} atlas`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const atlas = args.find((a) => a.startsWith('--atlas='))?.slice(8);
  if (!atlas) throw new Error('rws-swap: --atlas=<dir> (python3 tools/vehicles/rws_atlas.py <dir>)');
  const only = args.find((a) => a.startsWith('--id='))?.slice(5);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  for (const id of only ? only.split(',') : Object.keys(HOST_SCALE)) console.log(await swap(io, id, atlas));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
