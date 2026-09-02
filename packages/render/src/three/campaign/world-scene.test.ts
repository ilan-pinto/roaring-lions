import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { glbFixture } from './glb-fixture';
import { readWorldScene } from './world-scene';

const WORLD = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../../../data/campaign/world.json', import.meta.url)), 'utf8')
) as { id: string; regions: { id: string; towns: { id: string }[] }[] };

const GLB = `art/meshes/campaign/${WORLD.id}.glb`;

/** A material factory that records what it was handed, and returns a fresh
 *  material each time -- the property `readWorldScene` has to preserve. */
const spyFactory = (): { calls: THREE.Texture[]; make: (m: THREE.Texture) => THREE.Material } => {
  const calls: THREE.Texture[] = [];
  return {
    calls,
    make: (m) => {
      calls.push(m);
      return new THREE.MeshBasicMaterial({ map: m });
    },
  };
};

const read = (opts?: { shuffle?: boolean; anonymise?: boolean }) => {
  const fixture = glbFixture(GLB, opts);
  const spy = spyFactory();
  return { scene: readWorldScene(fixture.root, spy.make), fixture, spy };
};

describe('readWorldScene over the shipped Sahar Basin', () => {
  it('finds exactly the regions data/campaign/world.json declares', () => {
    const { scene } = read();
    expect([...scene.regions.keys()].sort()).toEqual(WORLD.regions.map((r) => r.id).sort());
  });

  it('finds a marker for every town', () => {
    const { scene } = read();
    const want = WORLD.regions.flatMap((r) => r.towns.map((t) => t.id)).sort();
    expect([...scene.towns.keys()].sort()).toEqual(want);
  });

  /**
   * The handoff's one hard rule about this asset: `outland_scenery` carries
   * the diorama's whole underside and rim, so it must never be reachable as
   * a region. If it ever is, the screen tints the bottom of the world.
   */
  it('keeps outland_scenery out of the regions entirely', () => {
    const { scene } = read();
    const sceneryNames = scene.scenery.map((m) => m.name).sort();
    expect(sceneryNames).toEqual(['outland_scenery', 'wall_scenery']);
    for (const [id, meshes] of scene.regions) {
      expect(meshes.map((m) => m.name), `region ${id}`).not.toContain('outland_scenery');
    }
  });

  /**
   * The whole design rests on extras rather than on names or order. Blanking
   * every node name and reversing the scene list must change nothing.
   */
  it('reads extras, not names and not node order', () => {
    const plain = read();
    const scrambled = read({ shuffle: true, anonymise: true });
    expect([...scrambled.scene.regions.keys()].sort()).toEqual(
      [...plain.scene.regions.keys()].sort()
    );
    expect([...scrambled.scene.towns.keys()].sort()).toEqual([...plain.scene.towns.keys()].sort());
    expect(scrambled.scene.scenery).toHaveLength(plain.scene.scenery.length);
  });

  /**
   * A shared material would mean locking one region locked all five, because
   * the tint is a uniform. One per mesh is what makes per-region state
   * expressible at all.
   */
  it('gives every mesh its own material, over the one shared texture', () => {
    const { scene, spy, fixture } = read();
    const meshes = [...[...scene.regions.values()].flat(), ...scene.scenery];
    expect(meshes).toHaveLength(5);
    expect(spy.calls).toHaveLength(5);
    for (const m of spy.calls) expect(m).toBe(fixture.map);
    const materials = new Set(meshes.map((m) => m.material));
    expect(materials.size).toBe(5);
    expect(scene.map).toBe(fixture.map);
  });

  it('bounds the regions and scenery, and nothing else', () => {
    const { scene, fixture } = read();
    const want = new THREE.Box3();
    for (const box of fixture.boxes.values()) want.union(box);
    for (const axis of ['x', 'y', 'z'] as const) {
      expect(scene.bounds.min[axis]).toBeCloseTo(want.min[axis], 6);
      expect(scene.bounds.max[axis]).toBeCloseTo(want.max[axis], 6);
    }
  });
});

describe('readWorldScene refuses a world it cannot draw', () => {
  const mat = (m: THREE.Texture): THREE.Material => new THREE.MeshBasicMaterial({ map: m });

  it('names a mesh with no known rl_map_role', () => {
    const { root } = glbFixture(GLB);
    const marj = root.getObjectByName('marj_region');
    if (!marj) throw new Error('fixture lost marj_region');
    marj.userData.rl_map_role = 'ground';
    expect(() => readWorldScene(root, mat)).toThrow(/marj_region.*rl_map_role/s);
  });

  it('names a mesh that lost its bake', () => {
    const { root } = glbFixture(GLB);
    const wall = root.getObjectByName('wall_scenery') as THREE.Mesh;
    (wall.material as THREE.MeshBasicMaterial).map = null;
    expect(() => readWorldScene(root, mat)).toThrow(/wall_scenery.*base_color/s);
  });

  it('names a region mesh with no rl_region to join world.json by', () => {
    const { root } = glbFixture(GLB);
    const sur = root.getObjectByName('sur_region');
    if (!sur) throw new Error('fixture lost sur_region');
    delete sur.userData.rl_region;
    expect(() => readWorldScene(root, mat)).toThrow(/sur_region.*rl_region/s);
  });
});
