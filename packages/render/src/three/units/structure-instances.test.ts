/**
 * `StructureInstances` (GH-974): the pure half of instanced per-tile
 * structures. What is proven here needs no renderer: the dense packing of one
 * set, a standing tile moving between scar states, and a destroyed tile leaving
 * the standing sets for the wreck's. `ThreeRenderer.structure-instances.test.ts`
 * proves the same through `updateBuildingMeshes` against the clone path.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  InstanceSet,
  StructureInstances,
  STRUCTURE_LOD1_BELOW_ZOOM,
  STRUCTURE_LOD1_HYSTERESIS,
  instanceableTemplate,
  lod1Active,
  partsOf,
  stateOfKey,
  structureChunkTilesFor,
  STRUCTURE_CHUNK_TILES,
  STRUCTURE_CHUNK_TILES_LARGE,
} from './structure-instances';
import type { BuildingMeshTemplate } from './mesh-building';

function box(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(1, 1, 1);
}

/** A two-mesh template (a wall and a roof, the shape a real wall GLB has) at the root's own frame. */
function template(offsetRoof?: THREE.Vector3): BuildingMeshTemplate {
  const root = new THREE.Group();
  root.scale.setScalar(2);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x808080 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x404040 });
  const wall = new THREE.Mesh(box(), wallMat);
  wall.name = 'wall';
  const roof = new THREE.Mesh(box(), roofMat);
  roof.name = 'roof';
  if (offsetRoof) roof.position.copy(offsetRoof);
  root.add(wall, roof);
  return { root, materials: [wallMat, roofMat], geometries: [wall.geometry, roof.geometry] };
}

function at(x: number, y: number, z: number): THREE.Matrix4 {
  return new THREE.Matrix4().makeTranslation(x, y, z);
}

/** The translation of instance `i` of `mesh`. */
function posOf(mesh: THREE.InstancedMesh, i: number): THREE.Vector3 {
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(i, m);
  return new THREE.Vector3().setFromMatrixPosition(m);
}

function newSet(scene: THREE.Object3D, capacity = 4): { set: InstanceSet; tpl: BuildingMeshTemplate } {
  const tpl = template();
  const part = partsOf(tpl)[0];
  return { set: new InstanceSet(part, part.mesh.material as THREE.Material, scene, capacity), tpl };
}

describe('instanceableTemplate', () => {
  it('accepts meshes at the root frame and refuses one carrying its own offset', () => {
    expect(instanceableTemplate(template())).toBe(true);
    // A part offset inside the root would be sheared by a non-uniform fit.
    expect(instanceableTemplate(template(new THREE.Vector3(0, 0.5, 0)))).toBe(false);
  });

  it('refuses a template with no mesh at all, which would instance nothing', () => {
    expect(instanceableTemplate({ root: new THREE.Group(), materials: [], geometries: [] })).toBe(false);
  });
});

describe('InstanceSet', () => {
  it('packs densely: count is what is drawn, and a removal moves the LAST instance into the hole', () => {
    const scene = new THREE.Group();
    const { set } = newSet(scene);
    set.set(10, at(1, 0, 0));
    set.set(11, at(2, 0, 0));
    set.set(12, at(3, 0, 0));
    expect(set.mesh.count).toBe(3);
    expect(set.remove(10)).toBe(true);
    expect(set.mesh.count).toBe(2);
    // 12 took slot 0; 11 stayed in slot 1: each key still has its OWN matrix.
    expect(posOf(set.mesh, 0).x).toBe(3);
    expect(posOf(set.mesh, 1).x).toBe(2);
    expect(set.has(10)).toBe(false);
    expect(set.remove(10)).toBe(false);
  });

  it('re-placing a key rewrites its slot and adds none', () => {
    const scene = new THREE.Group();
    const { set } = newSet(scene);
    set.set(1, at(1, 0, 0));
    set.set(1, at(9, 0, 0));
    expect(set.mesh.count).toBe(1);
    expect(posOf(set.mesh, 0).x).toBe(9);
  });

  it('grows past its first capacity without losing an instance, and the old mesh leaves the scene', () => {
    const scene = new THREE.Group();
    const { set } = newSet(scene, 4);
    const first = set.mesh;
    for (let k = 0; k < 11; k++) set.set(k, at(k, 0, 0));
    expect(set.mesh).not.toBe(first);
    expect(scene.children).toEqual([set.mesh]);
    expect(set.mesh.count).toBe(11);
    for (let k = 0; k < 11; k++) expect(posOf(set.mesh, k).x).toBe(k);
  });

  it('is invisible empty or hidden, and its culling sphere is rebuilt after a change', () => {
    const scene = new THREE.Group();
    const { set } = newSet(scene);
    set.flush(false);
    expect(set.mesh.visible).toBe(false);
    set.set(1, at(0, 0, 0));
    set.flush(false);
    expect(set.mesh.visible).toBe(true);
    set.mesh.computeBoundingSphere();
    const near = set.mesh.boundingSphere!.radius;
    set.set(2, at(500, 0, 0));
    set.flush(false);
    expect(set.mesh.boundingSphere).toBeNull();
    set.mesh.computeBoundingSphere();
    expect(set.mesh.boundingSphere!.radius).toBeGreaterThan(near + 200);
    set.flush(true);
    expect(set.mesh.visible).toBe(false);
  });

  it('draws as the clones did: world-order band, casting and receiving shadows', () => {
    const { set } = newSet(new THREE.Group());
    expect(set.mesh.renderOrder).toBe(-1);
    expect(set.mesh.castShadow).toBe(true);
    expect(set.mesh.receiveShadow).toBe(true);
  });
});

describe('structure chunk size by map (GH-974)', () => {
  const clean = (m: THREE.Mesh): THREE.Material => m.material as THREE.Material;
  /** Stands tiles at `xz` on a `size` x `size` map the way the renderer builds it; returns the sorted set keys. */
  function keysFor(size: number, xz: [number, number][]): string[] {
    const si = new StructureInstances(new THREE.Group(), structureChunkTilesFor(size, size));
    si.setIdleTemplate('wall', template());
    xz.forEach(([x, z], i) => si.addIdle(i + 1, 'wall', at(x + 0.5, 0, z + 0.5), 0, clean));
    return si.idleSetKeys('wall');
  }
  const SPREAD: [number, number][] = [[1, 1], [17, 1], [1, 17], [33, 33], [47, 47]];

  it('a 48x48 map keeps the 16-tile chunks: its set keys are pinned to what shipped', () => {
    expect(structureChunkTilesFor(48, 48)).toBe(STRUCTURE_CHUNK_TILES);
    expect(STRUCTURE_CHUNK_TILES).toBe(16);
    expect(keysFor(48, SPREAD)).toEqual(['0|0|0', '0|0|1', '0|1|0', '0|2|2'].sort());
  });

  it('a map above 48x48 takes the ground chunk edge, so a wall set is one per ground chunk', () => {
    expect(structureChunkTilesFor(80, 80)).toBe(STRUCTURE_CHUNK_TILES_LARGE);
    expect(structureChunkTilesFor(49, 48)).toBe(STRUCTURE_CHUNK_TILES_LARGE);
    expect(keysFor(80, [...SPREAD, [70, 70]])).toEqual(['0|0|0', '0|1|1', '0|2|2'].sort());
  });
});

describe('StructureInstances', () => {
  const clean = (m: THREE.Mesh): THREE.Material => m.material as THREE.Material;

  function arm(): { scene: THREE.Group; si: StructureInstances } {
    const scene = new THREE.Group();
    const si = new StructureInstances(scene);
    si.setIdleTemplate('wall', template());
    si.setWreckTemplate('wall', template());
    return { scene, si };
  }

  const instancedCount = (si: StructureInstances): number => si.meshes().reduce((n, m) => n + m.count, 0);

  it('builds one set per template MESH, not per tile', () => {
    const { si } = arm();
    for (const s of [1, 2, 3]) si.addIdle(s, 'wall', at(s, 0, 0), 0, clean);
    expect(si.meshes().length).toBe(2); // wall + roof
    expect(instancedCount(si)).toBe(6);
  });

  it('splits a run into map chunks, so a view that cannot see one chunk does not draw its tiles', () => {
    const { si } = arm();
    si.addIdle(1, 'wall', at(1, 0, 1), 0, clean);
    si.addIdle(2, 'wall', at(2, 0, 2), 0, clean);
    si.addIdle(3, 'wall', at(49, 0, 1), 0, clean);
    si.addIdle(4, 'wall', at(1, 0, 33), 0, clean);
    si.flush();
    // Three chunks x two template meshes; each chunk's sphere covers its own tiles only.
    const meshes = si.meshes();
    expect(meshes.length).toBe(6);
    expect(meshes.map((m) => m.count).sort()).toEqual([1, 1, 1, 1, 2, 2]);
    for (const m of meshes) {
      m.computeBoundingSphere();
      expect(m.boundingSphere!.radius, 'a chunk sphere spans the whole map').toBeLessThan(16);
    }
    // A wreck lands in the chunk its tile stands in, and a scar state keeps the chunk.
    si.removeIdle(3);
    si.addWreck(3, 'wall', at(49, 0, 1), 0);
    expect(si.meshes().filter((m) => m.count === 1 && posOf(m, 0).x > 32).length).toBe(2);
  });

  it('a destroyed tile leaves the standing sets and joins the wreck sets, once', () => {
    const { si } = arm();
    for (const s of [1, 2, 3]) si.addIdle(s, 'wall', at(s, 0, 0), 0, clean);
    expect(si.removeIdle(2)).toBe(true);
    expect(si.hasIdle(2)).toBe(false);
    si.addWreck(2, 'wall', at(2, 0, 0), 0);
    expect(si.hasWreck(2)).toBe(true);
    // 2 standing tiles x 2 meshes + 1 wreck x 2 meshes.
    expect(instancedCount(si)).toBe(6);
    expect(si.removeIdle(2)).toBe(false);
  });

  it('moves a standing tile to its scar state\'s set and back, keeping its place and yaw', () => {
    const { si } = arm();
    const scarred = new THREE.MeshStandardMaterial({ color: 0x202020 });
    const material = (m: THREE.Mesh, state: number): THREE.Material => (state === 0 ? clean(m) : scarred);
    for (const s of [1, 2]) si.addIdle(s, 'wall', at(s, 0, 0), s === 2 ? 1.5 : 0, material);
    const before = si.meshes().length;
    si.setIdleState(2, 4, material);
    // A new set per mesh for state 4, one tile in it; the clean sets lost one.
    expect(si.meshes().length).toBe(before + 2);
    expect(si.stateOf(2)).toBe(4);
    const scarMeshes = si.meshes().filter((m) => m.material === scarred);
    expect(scarMeshes.length).toBe(2);
    for (const m of scarMeshes) {
      expect(m.count).toBe(1);
      expect(posOf(m, 0).x).toBe(2);
    }
    expect(si.yawOf(2)).toBe(1.5);
    // Setting the same state again draws nothing new.
    si.setIdleState(2, 4, material);
    expect(si.meshes().length).toBe(before + 2);
  });

  it('the hidden flag holds across flushes and answers how many meshes it covers', () => {
    const { si } = arm();
    si.addIdle(1, 'wall', at(1, 0, 0), 0, clean);
    si.flush();
    expect(si.meshes().every((m) => m.visible)).toBe(true);
    expect(si.setHidden(true)).toBe(2);
    si.addIdle(2, 'wall', at(2, 0, 0), 0, clean);
    si.flush();
    expect(si.meshes().every((m) => !m.visible)).toBe(true);
    si.setHidden(false);
    expect(si.meshes().every((m) => m.visible)).toBe(true);
  });

  it('switched off it tears every set down and refuses the type, so the clones take over', () => {
    const { scene, si } = arm();
    si.addIdle(1, 'wall', at(1, 0, 0), 0, clean);
    si.setEnabled(false);
    expect(si.handles('wall')).toBe(false);
    expect(si.handlesWreck('wall')).toBe(false);
    expect(si.hasIdle(1)).toBe(false);
    expect(scene.children.length).toBe(0);
    si.setEnabled(true);
    expect(si.handles('wall')).toBe(true);
  });

  it('dispose removes every mesh from the scene', () => {
    const { scene, si } = arm();
    si.addIdle(1, 'wall', at(1, 0, 0), 0, clean);
    si.addWreck(2, 'wall', at(2, 0, 0), 0);
    expect(scene.children.length).toBe(4);
    si.dispose();
    expect(scene.children.length).toBe(0);
  });
});

// GH-974 LOD1: the zoom band, and the swap at frame level.
describe('lod1Active (the zoom band)', () => {
  // Literals, not the constants under test: the band is 2.0 with 0.05 of headroom.
  it('is the twin below 2.0 and the full art at 2.0 and above, from either state', () => {
    expect(lod1Active(1.0, false)).toBe(true);
    expect(lod1Active(1.999, false)).toBe(true);
    expect(lod1Active(2.0, false)).toBe(false); // the exact boundary: full at zoom >= 2.0
    expect(lod1Active(3.0, false)).toBe(false);
    expect(lod1Active(1.0, true)).toBe(true);
    expect(lod1Active(3.0, true)).toBe(false);
  });

  it('holds the twin through the hysteresis band and releases it at 2.05', () => {
    expect(STRUCTURE_LOD1_BELOW_ZOOM).toBe(2.0);
    expect(STRUCTURE_LOD1_HYSTERESIS).toBe(0.05);
    expect(lod1Active(2.0, true)).toBe(true);
    expect(lod1Active(2.049, true)).toBe(true);
    expect(lod1Active(2.05, true)).toBe(false);
    // And entering is not eased: a zoom held at 2.04 coming from full art stays full.
    expect(lod1Active(2.04, false)).toBe(false);
  });

  it('a zoom oscillating across 2.0 flips at most once per crossing of the band, not per frame', () => {
    let on = false;
    const flips: boolean[] = [];
    for (const z of [2.2, 2.04, 2.01, 2.0, 1.99, 2.0, 2.01, 2.04, 1.99, 2.04, 2.049, 2.05]) {
      const next = lod1Active(z, on);
      if (next !== on) flips.push(next);
      on = next;
    }
    expect(flips).toEqual([true, false]);
  });
});

describe('StructureInstances LOD1 twin', () => {
  const clean = (m: THREE.Mesh): THREE.Material => m.material as THREE.Material;

  /** A twin of `template()`: the same roles, its own (smaller) geometry, and NO material of its own. */
  function twin(): BuildingMeshTemplate {
    const root = new THREE.Group();
    root.scale.setScalar(2);
    const geos: THREE.BufferGeometry[] = [];
    for (const name of ['wall', 'roof']) {
      const g = new THREE.PlaneGeometry(1, 1);
      const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
      mesh.name = name;
      root.add(mesh);
      geos.push(g);
    }
    return { root, materials: [], geometries: geos };
  }

  function arm(): {
    scene: THREE.Group;
    si: StructureInstances;
    full: BuildingMeshTemplate;
    lod: BuildingMeshTemplate;
    wreck: BuildingMeshTemplate;
  } {
    const scene = new THREE.Group();
    const si = new StructureInstances(scene);
    const full = template();
    const lod = twin();
    const wreck = template();
    si.setIdleTemplate('wall', full);
    si.setWreckTemplate('wall', wreck);
    expect(si.setIdleLod1('wall', lod)).toBe(true);
    return { scene, si, full, lod, wreck };
  }

  /** The geometries of the instanced meshes that are drawn this frame, with their counts. */
  const drawn = (si: StructureInstances): { geo: THREE.BufferGeometry; count: number }[] =>
    si.meshes().filter((m) => m.visible).map((m) => ({ geo: m.geometry, count: m.count }));

  it('draws the twin below 2.0 and the full art from 2.0, the same number of sets either way', () => {
    const { si, full, lod } = arm();
    for (const s of [1, 2, 3]) si.addIdle(s, 'wall', at(s, 0, 0), 0, clean);
    si.setZoom(1.5);
    si.flush();
    const lodGeos = new Set(lod.geometries);
    const fullGeos = new Set(full.geometries);
    expect(drawn(si).length).toBe(2);
    expect(drawn(si).every((d) => lodGeos.has(d.geo) && d.count === 3)).toBe(true);
    si.setZoom(2.05); // past the hysteresis band (2.0 itself holds the twin once it is on)
    si.flush();
    expect(drawn(si).length).toBe(2); // still one draw per template mesh
    expect(drawn(si).every((d) => fullGeos.has(d.geo) && d.count === 3)).toBe(true);
  });

  it('holds the twin at 2.0 once it is on, and lets go at 2.05', () => {
    const { si, lod } = arm();
    si.addIdle(1, 'wall', at(1, 0, 0), 0, clean);
    const lodGeos = new Set(lod.geometries);
    const isTwin = (): boolean => drawn(si).every((d) => lodGeos.has(d.geo));
    si.setZoom(1.9);
    si.flush();
    expect(isTwin()).toBe(true);
    si.setZoom(2.0);
    si.flush();
    expect(isTwin()).toBe(true);
    si.setZoom(2.05);
    si.flush();
    expect(isTwin()).toBe(false);
  });

  it('draws the twin with the FULL art\'s own material, role for role', () => {
    const { si, full } = arm();
    si.addIdle(1, 'wall', at(1, 0, 0), 0, clean);
    const matOf = new Map(full.root.children.map((c) => [c.name, (c as THREE.Mesh).material]));
    const twinSets = si.meshes().filter((m) => !full.geometries.includes(m.geometry) && m.count === 1);
    expect(twinSets.length).toBe(2);
    for (const m of twinSets) expect(full.materials).toContain(m.material);
    // wall -> the wall material, roof -> the roof material: not swapped.
    expect(twinSets.map((m) => m.material).sort()).toEqual([matOf.get('wall'), matOf.get('roof')].sort());
  });

  it('a scarred tile and a wreck keep the full geometry, and a tile healed back rejoins the twin', () => {
    const { si, full, lod, wreck } = arm();
    si.addIdle(1, 'wall', at(1, 0, 0), 0, clean);
    si.addIdle(2, 'wall', at(2, 0, 0), 0, clean);
    si.setIdleState(2, 3, clean);
    si.addIdle(3, 'wall', at(3, 0, 0), 0, clean);
    si.removeIdle(3);
    si.addWreck(3, 'wall', at(3, 0, 0), 0);
    si.setZoom(1.0);
    si.flush();
    const count = (geos: readonly THREE.BufferGeometry[]): number =>
      drawn(si).filter((d) => geos.includes(d.geo)).reduce((n, d) => n + d.count, 0);
    // The twin carries the one clean tile (per mesh: x2 meshes); the scarred tile and the wreck are drawn full.
    expect(count(lod.geometries)).toBe(2);
    expect(count(full.geometries)).toBe(2); // the scarred tile, one per mesh
    expect(count(wreck.geometries)).toBe(2); // the wreck, one per mesh
    si.setIdleState(2, 0, clean);
    si.flush();
    expect(count(lod.geometries)).toBe(4);
    expect(count(full.geometries)).toBe(0);
  });

  it('a destroyed or removed tile leaves the twin too', () => {
    const { si, lod } = arm();
    si.addIdle(1, 'wall', at(1, 0, 0), 0, clean);
    si.addIdle(2, 'wall', at(2, 0, 0), 0, clean);
    si.removeIdle(1);
    si.setZoom(1.0);
    si.flush();
    const lodCounts = si.meshes().filter((m) => lod.geometries.includes(m.geometry)).map((m) => m.count);
    expect(lodCounts).toEqual([1, 1]);
  });

  it('refuses a twin with a role the full art lacks, and draws full art at every zoom', () => {
    const { si } = arm();
    const odd = twin();
    odd.root.children[0].name = 'cupola';
    expect(si.setIdleLod1('wall', odd)).toBe(false);
    const none = new StructureInstances(new THREE.Group());
    expect(none.setIdleLod1('wall', twin())).toBe(false); // no standing template at all
  });

  /** A one-mesh twin (role `wall`, as the shipped wall_lod1): the roof and body joined. */
  function joinedTwin(name = 'wall'): BuildingMeshTemplate {
    const root = new THREE.Group();
    root.scale.setScalar(2);
    const g = new THREE.PlaneGeometry(1, 1);
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
    mesh.name = name;
    root.add(mesh);
    return { root, materials: [], geometries: [g] };
  }

  it('a one-mesh twin pairs to the full art when every full part shares one material, and draws one set per chunk', () => {
    const scene = new THREE.Group();
    const si = new StructureInstances(scene);
    const full = template();
    const shared = new THREE.MeshStandardMaterial();
    full.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = shared; });
    si.setIdleTemplate('wall', full);
    const lod = joinedTwin('cap'); // no role match at all: only the shared material pairs it
    expect(si.setIdleLod1('wall', lod)).toBe(true);
    si.addIdle(1, 'wall', at(1, 0, 0), 0, clean);
    si.setZoom(1.0);
    si.flush();
    const twinDraws = si.meshes().filter((m) => m.visible && lod.geometries.includes(m.geometry));
    expect(twinDraws.length).toBe(1); // one draw, where the two-part twin cost two
    expect(twinDraws[0].material).toBe(shared);
  });

  it('refuses a one-mesh twin when the full parts carry different materials', () => {
    const si = new StructureInstances(new THREE.Group());
    si.setIdleTemplate('wall', template()); // wall and roof have distinct materials
    expect(si.setIdleLod1('wall', joinedTwin('cap'))).toBe(false);
    expect(si.hasLod1('wall')).toBe(false);
  });

  it('the A/B switch holds: with the twin disabled, full art is drawn at every zoom, every frame', () => {
    const { si, full } = arm();
    si.addIdle(1, 'wall', at(1, 0, 0), 0, clean);
    si.setLod1Enabled(false);
    for (const z of [0.5, 1.0, 1.9]) {
      si.setZoom(z);
      si.flush();
      expect(drawn(si).every((d) => full.geometries.includes(d.geo)), `zoom ${z}`).toBe(true);
    }
    si.setLod1Enabled(true);
    si.setZoom(1.0);
    si.flush();
    expect(drawn(si).every((d) => full.geometries.includes(d.geo))).toBe(false);
  });

  it('a type with no twin is untouched by the zoom', () => {
    const scene = new THREE.Group();
    const si = new StructureInstances(scene);
    const full = template();
    si.setIdleTemplate('fence', full);
    si.addIdle(1, 'fence', at(1, 0, 0), 0, clean);
    si.setZoom(0.5);
    si.flush();
    expect(drawn(si).length).toBe(2);
    expect(si.hasLod1('fence')).toBe(false);
  });

  it('dispose and a template reload tear the twin down with the rest', () => {
    const { scene, si, full } = arm();
    si.addIdle(1, 'wall', at(1, 0, 0), 0, clean);
    expect(scene.children.length).toBe(4);
    si.setIdleTemplate('wall', full); // a reload drops the old twin with the old sets
    expect(si.hasLod1('wall')).toBe(false);
    expect(scene.children.length).toBe(0);
    expect(si.setIdleLod1('wall', twin())).toBe(true);
    si.addIdle(1, 'wall', at(1, 0, 0), 0, clean);
    si.dispose();
    expect(scene.children.length).toBe(0);
  });
});

describe('stateOfKey', () => {
  it('reads the scar state out of a set key, for every state and chunk', () => {
    expect(stateOfKey('0|3|4')).toBe(0);
    expect(stateOfKey('5|0|12')).toBe(5);
    expect(stateOfKey('10|1|1')).toBe(10);
  });
});

describe('InstanceSet.cull (GH-913)', () => {
  /** An orthographic top-down camera over a `half` x `half` window centred on (cx, cz), and its frustum + key. */
  function view(cx: number, cz: number, half: number): { frustum: THREE.Frustum; key: Float32Array } {
    const cam = new THREE.OrthographicCamera(-half, half, half, -half, 1, 100);
    cam.position.set(cx, 50, cz);
    cam.up.set(0, 0, -1);
    cam.lookAt(cx, 0, cz);
    cam.updateMatrixWorld();
    const m = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const key = new Float32Array(32);
    key.set(m.elements, 0);
    return { frustum: new THREE.Frustum().setFromProjectionMatrix(m), key };
  }
  const filled = (n: number) => {
    const scene = new THREE.Scene();
    const { set } = newSet(scene, 4);
    for (let i = 0; i < n; i++) set.set(i, at(i * 4, 0, 0)); // a row of boxes 4 apart along x
    set.flush(false);
    return set;
  };

  it('draws only the instances in view, the visible ones first, and leaves the culling sphere the whole set', () => {
    const set = filled(20); // x = 0 .. 76
    const { frustum, key } = view(40, 0, 6);
    set.cull(frustum, null, key);
    expect(set.mesh.count, 'x in 34..46: the boxes at 36, 40, 44 (radius reaches 32 and 48 too)').toBeLessThan(8);
    expect(set.mesh.count).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < set.mesh.count; i++) expect(Math.abs(posOf(set.mesh, i).x - 40)).toBeLessThanOrEqual(10);
    // every instance is still in the buffer exactly once, and keys follow their matrices
    const xs = new Set<number>();
    for (let i = 0; i < 20; i++) xs.add(posOf(set.mesh, i).x);
    expect(xs.size).toBe(20);
    for (let k = 0; k < 20; k++) {
      expect(set.has(k)).toBe(true);
      set.remove(k); // slot map must still point at the right slot: removing every key empties the set
    }
    expect(set.count).toBe(0);
  });

  it('the culling sphere covers every instance, not the visible prefix', () => {
    const set = filled(20);
    const { frustum, key } = view(40, 0, 6);
    set.cull(frustum, null, key);
    const sphere = set.mesh.boundingSphere as THREE.Sphere;
    expect(sphere.containsPoint(new THREE.Vector3(0, 0, 0))).toBe(true);
    expect(sphere.containsPoint(new THREE.Vector3(76, 0, 0))).toBe(true);
  });

  it('an instance only the SHADOW frustum reaches is kept; an unchanged view and set recut nothing', () => {
    const set = filled(20);
    const cam = view(40, 0, 6);
    const sun = view(4, 0, 3); // the shadow box sits over x = 4, far from the camera
    const key = new Float32Array(32);
    key.set(cam.key.subarray(0, 16), 0);
    key.set(sun.key.subarray(0, 16), 16);
    set.cull(cam.frustum, sun.frustum, key);
    const xs: number[] = [];
    for (let i = 0; i < set.mesh.count; i++) xs.push(posOf(set.mesh, i).x);
    expect(xs.some((x) => x === 4), 'the instance under the shadow box is drawn').toBe(true);
    expect(xs.some((x) => x === 40), 'and the one under the camera').toBe(true);
    expect(xs.some((x) => x === 76), 'and nothing else').toBe(false);
    // unchanged: a different frustum object with the same key does nothing
    const before = set.mesh.count;
    set.cull(view(200, 200, 1).frustum, null, key);
    expect(set.mesh.count).toBe(before);
  });

  it('a set that changed recuts, and add/remove after a cut keep the whole set drawable', () => {
    const set = filled(20);
    const { frustum, key } = view(40, 0, 6);
    set.cull(frustum, null, key);
    set.set(99, at(40, 0, 1));
    expect(set.mesh.count, 'a new instance resets the count to the whole set until the next cut').toBe(21);
    set.flush(false);
    set.cull(frustum, null, key);
    let found = false;
    for (let i = 0; i < set.mesh.count; i++) if (posOf(set.mesh, i).z === 1) found = true;
    expect(found, 'the new instance is in view and drawn').toBe(true);
  });

  it('drawAll restores every instance', () => {
    const set = filled(20);
    const { frustum, key } = view(40, 0, 6);
    set.cull(frustum, null, key);
    expect(set.mesh.count).toBeLessThan(20);
    set.drawAll();
    expect(set.mesh.count).toBe(20);
  });
});
