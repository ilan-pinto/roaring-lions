/**
 * Graft the raised, weathered mortar into `mortar_crew.glb` WITHOUT
 * re-exporting the crew (unit polish, the lead's ruling of 2026-10-14).
 *
 *     pnpm --filter @lions/tools exec tsx src/meshes/mortar-graft.ts
 *
 * Then, in this order: `pnpm motion:meshes -- --id=mortar_crew`,
 * `pnpm gait:meshes -- --id=mortar_crew`, `pnpm encode:meshes`.
 *
 * ## Why a graft
 *
 * `import_meshy_crew_team.py` has moved on since this team's B4 export, and
 * re-exporting it today changes its boot and uniform meshes (600 -> 814 boot
 * vertices) and every bone's rest (`move-fire-splice.ts`). That is an art change
 * nobody asked for. So the crew's bytes are taken from BEFORE the motion pass,
 * at `rl_motion.base` (13f667ff), the kit tube is swapped for the part, and the
 * motion pass is re-run on the result. Re-running the motion pass alone on
 * those bytes reproduces the shipped binary chunk byte for byte (checked
 * 2026-10-14), so everything that changes here is the mortar.
 *
 * ## What it does
 *
 *  - Drops the kit tube: the `metal` mesh (bipod/baseplate box, 36 tris) and
 *    the `weapon` mesh's contents (the tube, 28 tris). Both rode `prop`.
 *  - Writes `art/parts/mortar_crew/mortar.glb` (`tools/units/mortar_crew_part.py`)
 *    into the `weapon` mesh: rigid on `prop`, the crew's own material, its uvs
 *    already in the atlas's right half.
 *  - Halves every crew uv into the left half and swaps the base colour for the
 *    2 x 1024 atlas the part script composed (crew bake untouched on the left).
 *  - Seats the socket on the kit's anchor x 0.22, then slides it forward in
 *    `SLIDE_STEP` steps until no mortar sample is inside a crewman in `idle`
 *    (`measureMountedPartInBody`, the gate `launcher_clearance.test.ts` runs),
 *    plus `SWAY_MARGIN` for the breathing crew -- the ATGM post's rule.
 *  - Records the fire points on the scene's extras as `rl_fire`, team frame,
 *    metres, for the renderer's muzzle blast and baseplate dust.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, type Document, type Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { measureMountedPartInBody } from '../mesh_gait';

const REPO = fileURLToPath(new URL('../../..', import.meta.url));
export const BASE_REV = '13f667ff';
/** `rig._mortar_crew_extras`' anchor: the kit tube's baseplate centre. */
export const KIT_ANCHOR_X = 0.22;
export const SLIDE_STEP = 0.04;
export const SLIDE_MAX = 0.6;
/** Beyond the first clear anchor, for the crew's breathing (atgm_cell's 0.05). */
export const SWAY_MARGIN = 0.05;
const CREW_BODY = /^emtr_crew(0|1)_/;

interface PartData {
  pos: Float32Array;
  nrm: Float32Array;
  uv: Float32Array;
  idx: Uint32Array<ArrayBuffer>;
  points: Record<string, [number, number, number]>;
}

async function readPart(io: NodeIO): Promise<PartData> {
  const doc = await io.read(path.join(REPO, 'art/parts/mortar_crew/mortar.glb'));
  const meshes = doc.getRoot().listMeshes();
  if (meshes.length !== 1 || meshes[0].listPrimitives().length !== 1) {
    throw new Error('mortar-graft: the part must be one mesh, one primitive');
  }
  const prim = meshes[0].listPrimitives()[0];
  const get = (n: string): Float32Array => {
    const a = prim.getAttribute(n);
    if (!a) throw new Error(`mortar-graft: the part has no ${n}`);
    return new Float32Array(a.getArray() as ArrayLike<number>);
  };
  const ind = prim.getIndices();
  if (!ind) throw new Error('mortar-graft: the part is not indexed');
  const raw = JSON.parse(readFileSync(path.join(REPO, 'art/parts/mortar_crew/points.json'), 'utf8')) as {
    points: Record<string, [number, number, number]>;
  };
  return { pos: get('POSITION'), nrm: get('NORMAL'), uv: get('TEXCOORD_0'), idx: Uint32Array.from(ind.getArray() as ArrayLike<number>), points: raw.points };
}

/** Graft at one anchor x; returns the document (mutated). */
function graft(doc: Document, part: PartData, anchorX: number, atlas: Uint8Array): void {
  const root = doc.getRoot();
  const buffer = root.listBuffers()[0];
  const byName = new Map(root.listNodes().map((n) => [n.getName(), n]));
  const weaponNode = byName.get('weapon');
  const metalNode = byName.get('metal');
  const prop = byName.get('prop');
  if (!weaponNode || !metalNode || !prop) throw new Error('mortar-graft: no weapon/metal/prop node -- not the B4 crew file');
  const skin = weaponNode.getSkin();
  if (!skin) throw new Error('mortar-graft: weapon is not skinned');
  const propIdx = skin.listJoints().indexOf(prop);
  if (propIdx < 0) throw new Error('mortar-graft: prop is not a joint');
  const material = root.listMaterials()[0];
  if (!material || !material.getBaseColorTexture()) throw new Error('mortar-graft: no textured crew material');

  // The crew's uvs into the left half. Fresh accessors: one may be shared.
  const crewPrims: Primitive[] = [];
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMaterial() === material && prim.getAttribute('TEXCOORD_0')) crewPrims.push(prim);
    }
  }
  for (const prim of crewPrims) {
    const a = prim.getAttribute('TEXCOORD_0')!;
    const uv = new Float32Array(a.getArray() as ArrayLike<number>);
    for (let i = 0; i < uv.length; i += 2) uv[i] *= 0.5;
    prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(uv).setBuffer(buffer));
  }

  // The kit tube out.
  const metalMesh = metalNode.getMesh();
  metalNode.dispose();
  metalMesh?.dispose();
  const weaponMesh = weaponNode.getMesh()!;
  // The skin attributes keep the file's OWN component types: three.js's
  // mergeGeometries (the occlusion outline) refuses a skinIndex that is
  // Uint8 in one mesh and Uint16 in another (skin_attribute_types.test.ts).
  const crewSkin = root.listMeshes().flatMap((m) => m.listPrimitives()).find((p) => p.getAttribute('JOINTS_0') && p.getMaterial() === material);
  if (!crewSkin) throw new Error('mortar-graft: no textured skinned crew primitive to read the skin types from');
  const crewJoints = crewSkin.getAttribute('JOINTS_0')!.getArray();
  if (!(crewSkin.getAttribute('WEIGHTS_0')!.getArray() instanceof Float32Array)) {
    throw new Error("mortar-graft: the crew's WEIGHTS_0 is not FLOAT; a normalized type needs 255, not 1");
  }
  for (const p of weaponMesh.listPrimitives()) p.dispose();

  // The part in, rigid on `prop`, at the anchor.
  const n = part.pos.length / 3;
  const pos = new Float32Array(part.pos);
  for (let i = 0; i < n; i++) pos[i * 3] += anchorX;
  const joints = crewJoints instanceof Uint8Array ? new Uint8Array(n * 4) : new Uint16Array(n * 4);
  const weights = new Float32Array(n * 4);
  if (propIdx > (joints instanceof Uint8Array ? 255 : 65535)) throw new Error("mortar-graft: prop's joint index does not fit the file's JOINTS_0 type");
  for (let i = 0; i < n; i++) {
    joints[i * 4] = propIdx;
    weights[i * 4] = 1;
  }
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(part.nrm)).setBuffer(buffer))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(part.uv)).setBuffer(buffer))
    .setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(joints).setBuffer(buffer))
    .setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(weights).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(part.idx)).setBuffer(buffer))
    .setMaterial(material);
  weaponMesh.addPrimitive(prim);

  // The atlas.
  const tex = material.getBaseColorTexture()!;
  tex.setImage(atlas).setMimeType('image/jpeg');

  // Fire points, team frame, at this anchor.
  const at = (k: string): [number, number, number] => {
    const p = part.points[k];
    if (!p) throw new Error(`mortar-graft: points.json has no ${k}`);
    return [round(p[0] + anchorX), round(p[1]), round(p[2])];
  };
  const scene = root.listScenes()[0];
  scene.setExtras({
    ...((scene.getExtras() ?? {}) as Record<string, unknown>),
    rl_fire: { muzzle: at('muzzle'), base: at('plate') },
    rl_crew_points: { handwheel: at('handwheel'), socket: at('socket') },
  });
  for (const a of root.listAccessors()) if (a.listParents().every((p) => p === root)) a.dispose();
}

const round = (x: number): number => Math.round(x * 1e4) / 1e4;

export async function main(): Promise<void> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const rel = 'art/meshes/mortar_crew.glb';
  const base = execFileSync('/usr/bin/git', ['-C', REPO, 'show', `${BASE_REV}:${rel}`], { maxBuffer: 1 << 28 });
  const part = await readPart(io);
  const atlas = new Uint8Array(readFileSync(path.join(REPO, 'art/parts/mortar_crew/atlas.jpg')));
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'mortar-graft-'));
  const tried: string[] = [];
  let clear: number | null = null;
  for (let dx = 0; dx <= SLIDE_MAX + 1e-9; dx += SLIDE_STEP) {
    const doc = await io.readBinary(new Uint8Array(base));
    graft(doc, part, KIT_ANCHOR_X + dx, atlas);
    const file = path.join(scratch, `try-${dx.toFixed(2)}.glb`);
    writeFileSync(file, await io.writeBinary(doc));
    const r = measureMountedPartInBody(file, 'idle', { roles: ['weapon'], joint: 'prop', bodyJoint: (j) => CREW_BODY.test(j) });
    tried.push(`+${dx.toFixed(2)}:${r.worstInside}`);
    if (r.worstInside === 0) {
      clear = dx;
      break;
    }
  }
  if (clear === null) throw new Error(`mortar-graft: inside a crewman at every anchor tried (${tried.join(' ')})`);
  const anchor = KIT_ANCHOR_X + clear + SWAY_MARGIN;
  const doc = await io.readBinary(new Uint8Array(base));
  graft(doc, part, anchor, atlas);
  writeFileSync(path.join(REPO, rel), await io.writeBinary(doc));
  console.log(`MORTAR GRAFT samples inside the crew by anchor offset from x ${KIT_ANCHOR_X}: ${tried.join(' ')}`);
  console.log(`  anchor x ${anchor.toFixed(2)} (first clear +${clear.toFixed(2)}, sway margin ${SWAY_MARGIN}); wrote ${rel} (pre-motion: run motion, gait, encode next)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
