import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  buildTexturedDecorMesh,
  disposeTexturedDecorMesh,
  lod1KeyOf,
  stepTexturedDecorLod,
  type TexturedDecorSet,
} from './decor-textured-mesh';
import type { DecorPlacement } from './decor-place';

function part(): { geometry: THREE.BufferGeometry; map: THREE.Texture } {
  return { geometry: new THREE.BoxGeometry(1, 1, 1), map: new THREE.Texture() };
}

function set(keys: readonly string[]): TexturedDecorSet {
  return { parts: new Map(keys.map((k) => [k, part()])) };
}

function place(over: Partial<DecorPlacement> = {}): DecorPlacement {
  return {
    family: 'ditch',
    variant: 0,
    x: 1.5,
    z: 2.5,
    y: 0,
    yawTurns: 0,
    scale: 1,
    ...over,
  };
}

describe('buildTexturedDecorMesh', () => {
  it('draws a whole ditch run in ONE instanced mesh', () => {
    // Draw-call submission is this renderer's measured bottleneck, and a
    // ditch can be dozens of tiles long. One geometry, one material, one
    // draw -- not one per tile.
    const group = buildTexturedDecorMesh(
      [place({ x: 0.5 }), place({ x: 1.5 }), place({ x: 2.5 }), place({ x: 3.5 })],
      set(['ditch_0'])
    );
    expect(group.children.length).toBe(1);
    expect((group.children[0] as THREE.InstancedMesh).count).toBe(4);
  });

  it('ignores placements from palette families', () => {
    // The two builders partition one placement list. If this took a boulder
    // it would draw it through the ditch's own photograph.
    //
    // `boulder_1` is deliberately IN the set. Without it this test passes
    // whether or not the family filter exists at all -- the missing-key skip
    // just below would drop the boulder anyway, and deleting
    // `isTexturedDecorKey` from the builder was measured leaving this green.
    // Loading a boulder into the set is what makes the family filter the only
    // thing that can exclude it.
    const group = buildTexturedDecorMesh(
      [place(), place({ family: 'boulder', variant: 1 }), place({ family: 'rock', variant: 0 })],
      set(['ditch_0', 'boulder_1'])
    );
    expect(group.children.length).toBe(1);
    const mesh = group.children[0] as THREE.InstancedMesh;
    expect(mesh.count).toBe(1);
  });

  it('draws the bake through a lit standard material, and casts and receives shadows', () => {
    // The three facts the ditch's whole look now rests on, none of which any
    // other test here can see: it is a `MeshStandardMaterial` (so the scene
    // sun models the trench walls instead of a hand-written band), the map is
    // the part's OWN bake rather than a palette tone, and it is tagged sRGB --
    // the reverse of what the retired pass-through pipeline wanted, and
    // getting it wrong leaves a ditch that is merely darker and still looks
    // exactly like a ditch.
    const s = set(['ditch_0']);
    const mesh = buildTexturedDecorMesh([place()], s).children[0] as THREE.InstancedMesh;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    expect(mat.isMeshStandardMaterial).toBe(true);
    expect(mat.map).toBe(s.parts.get('ditch_0')?.map);
    expect(mat.map?.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(mesh.castShadow).toBe(true);
    expect(mesh.receiveShadow).toBe(true);
  });

  it('drops a key whose GLB never loaded rather than throwing', () => {
    const group = buildTexturedDecorMesh([place()], set([]));
    expect(group.children.length).toBe(0);
  });

  it('places each instance at its own position, yaw and scale', () => {
    const group = buildTexturedDecorMesh(
      [place({ x: 4.5, z: 6.5, y: 0.25, yawTurns: 0.25, scale: 1 })],
      set(['ditch_0'])
    );
    const mesh = group.children[0] as THREE.InstancedMesh;
    const m = new THREE.Matrix4();
    mesh.getMatrixAt(0, m);
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    m.decompose(pos, quat, scl);
    expect(pos.x).toBeCloseTo(4.5, 6);
    expect(pos.y).toBeCloseTo(0.25, 6);
    expect(pos.z).toBeCloseTo(6.5, 6);
    expect(scl.x).toBeCloseTo(1, 6);
    // A quarter turn about +Y: the GLB's long axis is +X, so this is what
    // turns a run from east-west to north-south.
    const euler = new THREE.Euler().setFromQuaternion(quat, 'YXZ');
    expect(euler.y).toBeCloseTo(Math.PI / 2, 6);
  });

  it('disposes its materials but NOT the geometry or texture it borrowed', () => {
    // The subtle one. Geometry and map belong to the loader's own
    // TexturedDecorSet and are reused by every later rebuild; disposing them
    // here would blank the ditch on the SECOND terrain rebuild, not the
    // first, which is exactly the kind of bug a smoke test walks past.
    const s = set(['ditch_0']);
    const loaded = s.parts.get('ditch_0');
    if (loaded === undefined) throw new Error('fixture');
    let geometryDisposed = false;
    let mapDisposed = false;
    let materialDisposed = false;
    loaded.geometry.addEventListener('dispose', () => {
      geometryDisposed = true;
    });
    loaded.map.addEventListener('dispose', () => {
      mapDisposed = true;
    });
    const group = buildTexturedDecorMesh([place()], s);
    ((group.children[0] as THREE.InstancedMesh).material as THREE.Material).addEventListener(
      'dispose',
      () => {
        materialDisposed = true;
      }
    );
    disposeTexturedDecorMesh(group);
    expect(materialDisposed).toBe(true);
    expect(geometryDisposed).toBe(false);
    expect(mapDisposed).toBe(false);
    expect(group.children.length).toBe(0);
  });
});

describe('the LOD1 twin of a textured family (GH-974)', () => {
  const twinSet = (): TexturedDecorSet => set(['ditch_0', 'ditch_lod1']);
  const flags = (g: THREE.Group): [boolean, boolean][] =>
    g.children.map((c) => [c.userData.lod1 as boolean, c.visible] as [boolean, boolean]);

  it('names the twin of a variant-0 key and of nothing else', () => {
    expect(lod1KeyOf('ditch_0')).toBe('ditch_lod1');
    expect(lod1KeyOf('ditch_1')).toBeNull();
    expect(lod1KeyOf('ditch_lod1')).toBeNull();
  });

  it('adds ONE twin mesh per chunk beside the full one, same placements, same material, hidden', () => {
    const group = buildTexturedDecorMesh([place({ x: 0.5 }), place({ x: 1.5 }), place({ x: 2.5 })], twinSet());
    expect(group.children.length).toBe(2);
    const [full, twin] = group.children as THREE.InstancedMesh[];
    expect([full.userData.lod1, twin.userData.lod1]).toEqual([false, true]);
    expect(twin.count).toBe(3);
    expect(twin.material).toBe(full.material);
    expect(twin.visible).toBe(false);
    for (let i = 0; i < 3; i++) {
      const a = new THREE.Matrix4();
      const b = new THREE.Matrix4();
      full.getMatrixAt(i, a);
      twin.getMatrixAt(i, b);
      expect(b.toArray()).toEqual(a.toArray());
    }
  });

  it('builds exactly what it did before when no twin was loaded', () => {
    const group = buildTexturedDecorMesh([place()], set(['ditch_0']));
    expect(group.children.length).toBe(1);
    expect(group.children[0].userData.lod1).toBe(false);
  });

  it('a chunked map gets a twin in every chunk the full ditch is in, and no more', () => {
    const grid = { width: 96, height: 96, edge: 8, cols: 12, rows: 12 } as unknown as Parameters<typeof buildTexturedDecorMesh>[2];
    const group = buildTexturedDecorMesh([place({ x: 1.5, z: 1.5 }), place({ x: 60.5, z: 60.5 })], twinSet(), grid);
    const chunks = (lod: boolean): number[] => group.children.filter((c) => c.userData.lod1 === lod).map((c) => c.userData.chunk as number);
    expect(chunks(false).length).toBe(2);
    expect(chunks(true)).toEqual(chunks(false));
  });

  it('shows the twin below 2.0, holds it to 2.05, and draws the full ditch from there', () => {
    const g = buildTexturedDecorMesh([place()], twinSet());
    let on = stepTexturedDecorLod(g, 1, false, true);
    expect([on, ...flags(g).map((f) => f[1])]).toEqual([true, false, true]);
    on = stepTexturedDecorLod(g, 2.0, on, true);
    expect(on).toBe(true);
    on = stepTexturedDecorLod(g, 2.06, on, true);
    expect([on, ...flags(g).map((f) => f[1])]).toEqual([false, true, false]);
    // coming down from above, the full art holds until the zoom is under 2.0
    expect(stepTexturedDecorLod(g, 2.01, false, true)).toBe(false);
    expect(stepTexturedDecorLod(g, 1.99, false, true)).toBe(true);
  });

  it('the A/B switch holds the full ditch at every zoom', () => {
    const g = buildTexturedDecorMesh([place()], twinSet());
    expect(stepTexturedDecorLod(g, 1, false, false)).toBe(false);
    expect(flags(g).map((f) => f[1])).toEqual([true, false]);
  });

  it('leaves a group with no twin exactly as it was', () => {
    const g = buildTexturedDecorMesh([place()], set(['ditch_0']));
    stepTexturedDecorLod(g, 1, false, true);
    expect(g.children[0].visible).toBe(true);
  });

  it('a rebuild or a dispose never leaves a twin behind', () => {
    const g = buildTexturedDecorMesh([place(), place({ x: 5.5 })], twinSet());
    expect(g.children.length).toBe(2);
    disposeTexturedDecorMesh(g);
    expect(g.children.length).toBe(0);
    // the splice path rebuilds the whole group from the set the loader holds: a set without the twin has none
    const again = buildTexturedDecorMesh([place()], set(['ditch_0']));
    expect(again.children.filter((c) => c.userData.lod1 === true)).toEqual([]);
  });
});
