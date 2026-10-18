/**
 * The rescale pass (the Lavi x1.18, lead's ruling 2026-10-15), its refusal of
 * a second run, the kit pass's refusal of a kit source in another frame, and
 * the SHIPPED files' marks -- so a re-export that skips `pnpm rescale:meshes`
 * ships red rather than 18% short.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { describe, expect, it } from 'vitest';
import { applyKitGraft } from './kit-pass';
import { applyRescale } from './rescale-pass';
import { LAVI_RESCALE, RESCALE_FACTORS, rescaleMark } from './rescale-contract';
import { RG_TRACK_ATTR } from './running-gear-contract';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

function glbSceneExtras(file: string): Record<string, unknown> {
  const bytes = readFileSync(file);
  const len = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + len).toString('utf8')) as { scenes?: { extras?: Record<string, unknown> }[] };
  return json.scenes?.[0]?.extras ?? {};
}

function fixture(): Document {
  const doc = new Document();
  const buf = doc.createBuffer();
  const pos = doc.createAccessor('pos').setType('VEC3').setBuffer(buf).setArray(new Float32Array([0, 0, 0, 1, 2, 3, -2, 0.5, 1]));
  const trk = doc.createAccessor('trk').setType('SCALAR').setBuffer(buf).setArray(new Float32Array([-1, 0.5, 2]));
  const prim = doc.createPrimitive().setAttribute('POSITION', pos).setAttribute(RG_TRACK_ATTR, trk);
  const mesh = doc.createMesh('m').addPrimitive(prim);
  const a = doc.createNode('a').setMesh(mesh).setTranslation([1, 0, -2]);
  // A second node sharing the mesh, as the wreck twins share theirs: the
  // accessor must be scaled once, not twice.
  const b = doc.createNode('b').setMesh(mesh).setTranslation([0, 1, 0]);
  // And a second MESH whose primitive reuses the same POSITION accessor (the
  // damage pass's copies and the kit pass's LOD buffers both share accessors
  // across primitives): still scaled once.
  const c = doc.createNode('c').setMesh(doc.createMesh('m2').addPrimitive(doc.createPrimitive().setAttribute('POSITION', pos)));
  a.addChild(c);
  doc.createScene('s').addChild(a).addChild(b).setExtras({
    rl_running_gear: { version: 1, wheels: [], tracks: [{ side: 'r', loopLength: 10, pitch: 0.25, gauge: 1 }] },
  });
  return doc;
}

describe('applyRescale', () => {
  it('scales positions once, translations, track metres (not -1) and the running-gear lengths', () => {
    const doc = fixture();
    applyRescale(doc, 2, 'fixture');
    const root = doc.getRoot();
    const prim = root.listMeshes()[0].listPrimitives()[0];
    expect([...prim.getAttribute('POSITION')!.getArray()!]).toEqual([0, 0, 0, 2, 4, 6, -4, 1, 2]);
    expect([...prim.getAttribute(RG_TRACK_ATTR)!.getArray()!]).toEqual([-1, 1, 4]);
    expect(root.listNodes().map((n) => n.getTranslation())).toEqual([
      [2, 0, -4],
      [0, 2, 0],
      [0, 0, 0],
    ]);
    const extras = root.listScenes()[0].getExtras() as { rl_running_gear: { tracks: object[] }; rl_rescale: unknown };
    expect(extras.rl_running_gear.tracks[0]).toMatchObject({ loopLength: 20, pitch: 0.5, gauge: 2 });
    expect(extras.rl_rescale).toEqual({ factor: 2 });
    expect(rescaleMark(doc)).toBe(2);
  });

  it('refuses a file it has already scaled', () => {
    const doc = fixture();
    applyRescale(doc, 1.18, 'fixture');
    expect(() => applyRescale(doc, 1.18, 'fixture')).toThrow(/already rescaled/);
  });

  it('an unmarked file reads factor 1', () => {
    expect(rescaleMark(fixture())).toBe(1);
  });
});

describe('the kit pass and the rescale mark', () => {
  it('refuses a kit source whose frame differs from its vehicle', async () => {
    const vehicle = await io.read(path.join(REPO, 'art/meshes/vehicles/mbt_lavi.glb'));
    const kit = await io.read(path.join(REPO, 'art/parts/kit/mbt_lavi.glb'));
    const extras = { ...(kit.getRoot().listScenes()[0].getExtras() as Record<string, unknown>) };
    delete extras.rl_rescale;
    kit.getRoot().listScenes()[0].setExtras(extras);
    expect(() => applyKitGraft(vehicle, kit, 'mbt_lavi')).toThrow(/rescaled x1.18 and its kit source x1/);
  });
});

describe('the shipped files carry their rescale', () => {
  it('the Lavi factor is the ruling', () => {
    expect(LAVI_RESCALE).toBe(1.18);
  });
  for (const id of Object.keys(RESCALE_FACTORS)) {
    for (const dir of ['art/meshes/vehicles', 'assets/meshes/vehicles']) {
      it(`${dir}/${id}.glb is marked x${RESCALE_FACTORS[id]}`, () => {
        // Off the JSON chunk, so the Draco mirror needs no decoder.
        expect(glbSceneExtras(path.join(REPO, dir, `${id}.glb`)).rl_rescale).toEqual({ factor: RESCALE_FACTORS[id] });
      });
    }
  }
  it('art/parts/kit/mbt_lavi.glb is marked like its vehicle', async () => {
    expect(rescaleMark(await io.read(path.join(REPO, 'art/parts/kit/mbt_lavi.glb')))).toBe(LAVI_RESCALE);
  });
  it('the Lavi is 7.46 m from its rear deck to its muzzle (6.32 m x 1.18)', async () => {
    const doc = await io.read(path.join(REPO, 'art/meshes/vehicles/mbt_lavi.glb'));
    let lo = Infinity;
    let hi = -Infinity;
    for (const node of doc.getRoot().listNodes()) {
      const name = node.getName();
      if (!['hull_hull', 'hull_rubber', 'turret_hull', 'turret_metal'].includes(name)) continue;
      const m = node.getWorldMatrix();
      const arr = node.getMesh()!.listPrimitives()[0].getAttribute('POSITION')!.getArray()!;
      for (let i = 0; i < arr.length; i += 3) {
        const x = m[0] * arr[i] + m[4] * arr[i + 1] + m[8] * arr[i + 2] + m[12];
        lo = Math.min(lo, x);
        hi = Math.max(hi, x);
      }
    }
    expect(hi - lo).toBeCloseTo(6.32 * 1.18, 2);
  });
});
