import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { addNatureAttribute, buildDecorMesh, disposeDecorMesh, stripToBatchAttributes, swayingFoliageMaterial } from './decor-mesh';
import { windVertexChunk } from './wind';
import { makeWindUniforms } from './wind-uniforms';
import type { DecorGeometrySet } from './decor-mesh';
import type { DecorPlacement } from './decor-place';
import { rampForDecorRole } from './decor-role';
import { liftTone } from '../world-materials';

function geo(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0,0,0, 1,0,0, 0,1,0]), 3));
  g.setIndex([0, 1, 2]);
  return g;
}
const SET: DecorGeometrySet = { parts: new Map([['rock_0', [{ role: 'rock', geometry: geo() }]]]) };
const P = (n: number): DecorPlacement[] =>
  Array.from({ length: n }, (_, i) => ({
    family: 'rock' as const, variant: 0, x: i, z: i, y: 0, yawTurns: 0, scale: 1,
  }));

function batchesOf(g: THREE.Group): THREE.BatchedMesh[] {
  return g.children.filter(
    (c): c is THREE.BatchedMesh => (c as THREE.BatchedMesh).isBatchedMesh === true
  );
}

describe('buildDecorMesh', () => {
  it('draws N objects of one family in a SINGLE batched draw', () => {
    // The whole reason this is BatchedMesh and not six instancers: draw-call
    // submission is the measured bottleneck on this project.
    const g = buildDecorMesh(P(50), SET);
    // `isBatchedMesh`, NOT `.type` — three.js r170 leaves BatchedMesh's `type`
    // as the inherited "Mesh", so a `.type === 'BatchedMesh'` filter finds
    // nothing and fails against a CORRECT implementation. Verified against the
    // installed build, not assumed.
    expect(batchesOf(g).length).toBe(1);
  });

  it('places nothing, and adds no child, for an empty placement list', () => {
    expect(buildDecorMesh([], SET).children.length).toBe(0);
  });

  it('skips a placement whose geometry was never loaded, without throwing', () => {
    // A map may reference a family whose GLB failed to fetch. Losing a bush is
    // acceptable; a black screen is not.
    const missing = [{ family: 'tree' as const, variant: 2, x: 0, z: 0, y: 0, yawTurns: 0, scale: 1 }];
    expect(() => buildDecorMesh(missing, SET)).not.toThrow();
  });

  it('merges two different families sharing a role into ONE batch', () => {
    // The design claim the whole file exists for: `rock` and `slab` both use
    // the 'rock' role, so they share one ramp and MUST land in the same
    // BatchedMesh. A fixture with only one key (the original test above)
    // cannot distinguish this from "one batch per family" -- N instances of
    // ONE geometry share a batch either way. Two keys, one shared role, is
    // the only way to prove the merge actually happens.
    const set: DecorGeometrySet = {
      parts: new Map([
        ['rock_0', [{ role: 'rock', geometry: geo() }]],
        ['slab_0', [{ role: 'rock', geometry: geo() }]],
      ]),
    };
    const placements: DecorPlacement[] = [
      { family: 'rock', variant: 0, x: 0, z: 0, y: 0, yawTurns: 0, scale: 1 },
      { family: 'slab', variant: 0, x: 1, z: 1, y: 0, yawTurns: 0, scale: 1 },
    ];
    expect(batchesOf(buildDecorMesh(placements, set)).length).toBe(1);
  });

  it('keeps a different role in its own batch', () => {
    // Same fixture as the merge test above, plus a third key on a DIFFERENT
    // role -- proves roles still separate rather than everything collapsing
    // into one mesh regardless of role.
    const set: DecorGeometrySet = {
      parts: new Map([
        ['rock_0', [{ role: 'rock', geometry: geo() }]],
        ['slab_0', [{ role: 'rock', geometry: geo() }]],
        ['bush_0', [{ role: 'foliage', geometry: geo() }]],
      ]),
    };
    const placements: DecorPlacement[] = [
      { family: 'rock', variant: 0, x: 0, z: 0, y: 0, yawTurns: 0, scale: 1 },
      { family: 'slab', variant: 0, x: 1, z: 1, y: 0, yawTurns: 0, scale: 1 },
      { family: 'bush', variant: 0, x: 2, z: 2, y: 0, yawTurns: 0, scale: 1 },
    ];
    expect(batchesOf(buildDecorMesh(placements, set)).length).toBe(2);
  });

  it('gives a key holding two same-role parts an id for EACH part, not one', () => {
    // A rock-cluster family exported as several rock sub-meshes under one
    // family/variant is a natural GLB shape. Both parts' vertices are
    // reserved in the batch budget regardless -- losing the second part's id
    // to a key collision would upload its geometry to the GPU and never draw
    // it. One placement referencing this key must yield TWO instances.
    const cluster: DecorGeometrySet = {
      parts: new Map([
        ['rock_1', [{ role: 'rock', geometry: geo() }, { role: 'rock', geometry: geo() }]],
      ]),
    };
    const placements: DecorPlacement[] = [
      { family: 'rock', variant: 1, x: 0, z: 0, y: 0, yawTurns: 0, scale: 1 },
    ];
    const g = buildDecorMesh(placements, cluster);
    const mesh = batchesOf(g)[0];
    expect(mesh.instanceCount).toBe(2);
  });

  it('sizes the instance budget from the actual per-key part count, not a fixed multiplier', () => {
    // A 5-part rock cluster with only 2 placements needs 10 instances in
    // this role's batch. BatchedMesh is allocated up front and cannot grow --
    // `addInstance` throws once its budget is exhausted -- so a bound that
    // is not derived from the real per-key part count is a latent overflow,
    // not merely wasted headroom.
    const cluster: DecorGeometrySet = {
      parts: new Map([
        [
          'rock_2',
          [
            { role: 'rock', geometry: geo() },
            { role: 'rock', geometry: geo() },
            { role: 'rock', geometry: geo() },
            { role: 'rock', geometry: geo() },
            { role: 'rock', geometry: geo() },
          ],
        ],
      ]),
    };
    const placements: DecorPlacement[] = [
      { family: 'rock', variant: 2, x: 0, z: 0, y: 0, yawTurns: 0, scale: 1 },
      { family: 'rock', variant: 2, x: 1, z: 1, y: 0, yawTurns: 0, scale: 1 },
    ];
    let g!: THREE.Group;
    expect(() => {
      g = buildDecorMesh(placements, cluster);
    }).not.toThrow();
    const mesh = batchesOf(g)[0];
    expect(mesh.instanceCount).toBe(10);
  });

  it('throws on a batch whose geometries disagree about attributes — the boot crash', () => {
    // Pins the failure `stripToBatchAttributes` exists to remove, so the fix
    // cannot be quietly reverted. `BatchedMesh` takes its attribute set from
    // the FIRST geometry added and rejects any later one missing a member of
    // it. `tree_*.glb` ships a uv that grass and bush do not, and all three
    // share the `foliage` role and therefore one batch: on
    // `wadi_halam_basin` the tree landed first and the boot died with
    // `BatchedMesh: Added geometry missing "uv"`.
    const withUv = geo();
    withUv.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(6), 2));
    const mixed: DecorGeometrySet = {
      parts: new Map([
        ['tree_0', [{ role: 'foliage', geometry: withUv }]],
        ['grass_0', [{ role: 'foliage', geometry: geo() }]],
      ]),
    };
    const placements: DecorPlacement[] = [
      { family: 'tree', variant: 0, x: 0, z: 0, y: 0, yawTurns: 0, scale: 1 },
      { family: 'grass', variant: 0, x: 1, z: 1, y: 0, yawTurns: 0, scale: 1 },
    ];
    expect(() => buildDecorMesh(placements, mixed)).toThrow(/missing "uv"/);
  });

  it('batches the same mixed set once every geometry is stripped', () => {
    // The other half: after the loader normalises them, tree and grass share
    // one foliage batch with no error. Order-independent -- the uv geometry
    // is first here, which is the order that used to throw.
    const withUv = geo();
    withUv.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(6), 2));
    const stripped = stripToBatchAttributes(withUv);
    expect(stripped.getAttribute('uv')).toBeUndefined();
    // Never at the cost of what the shader actually reads.
    expect(stripped.getAttribute('position')).toBeDefined();
    const set: DecorGeometrySet = {
      parts: new Map([
        ['tree_0', [{ role: 'foliage', geometry: stripped }]],
        ['grass_0', [{ role: 'foliage', geometry: stripToBatchAttributes(geo()) }]],
      ]),
    };
    const placements: DecorPlacement[] = [
      { family: 'tree', variant: 0, x: 0, z: 0, y: 0, yawTurns: 0, scale: 1 },
      { family: 'grass', variant: 0, x: 1, z: 1, y: 0, yawTurns: 0, scale: 1 },
    ];
    let g!: THREE.Group;
    expect(() => {
      g = buildDecorMesh(placements, set);
    }).not.toThrow();
    expect(batchesOf(g).length).toBe(1);
    expect(batchesOf(g)[0].instanceCount).toBe(2);
  });

  it('draws through a lit standard material and both casts and receives shadows', () => {
    // The flags are what put decor into the sun's shadow map at all. Without
    // `castShadow` a boulder sits on ground it does not darken, which reads as
    // an object pasted onto the map rather than standing on it -- and it is
    // exactly the kind of miss no other test in this file can see, since every
    // assertion here is about batching and none about light.
    const mesh = batchesOf(buildDecorMesh(P(3), SET))[0];
    expect((mesh.material as THREE.MeshStandardMaterial).isMeshStandardMaterial).toBe(true);
    expect(mesh.castShadow).toBe(true);
    expect(mesh.receiveShadow).toBe(true);
  });

  it('keeps the normal attribute — the sun shades by it', () => {
    // Stripping to `position` alone would compile and draw flat, unlit-looking
    // blobs: `rampMaterial` carries one tone and the whole of its form comes
    // from `N·L` against the scene sun.
    const g = geo();
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(9), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(6), 2));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(9), 3));
    stripToBatchAttributes(g);
    expect(Object.keys(g.attributes).sort()).toEqual(['normal', 'position']);
  });

  it('disposes every geometry and material it created', () => {
    const g = buildDecorMesh(P(4), SET);
    const mesh = batchesOf(g)[0];
    const material = mesh.material as THREE.Material;
    // Observe the actual dispose calls rather than only the child count --
    // an implementation that removes children without ever calling
    // `.dispose()` on the mesh or material would pass a child-count-only
    // assertion unchanged.
    const materialDispose = vi.spyOn(material, 'dispose');
    const meshDispose = vi.spyOn(mesh, 'dispose');
    disposeDecorMesh(g);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(meshDispose).toHaveBeenCalledTimes(1);
    expect(g.children.length).toBe(0);
  });
});

/** mesh.test.ts's meshphysical harness, copied: the standard material's own
 *  sources with this material's injection applied. */
function compiled(material: THREE.Material): {
  uniforms: Record<string, THREE.IUniform>;
  vertexShader: string;
  fragmentShader: string;
} {
  const shader = {
    uniforms: {} as Record<string, THREE.IUniform>,
    vertexShader: THREE.ShaderChunk.meshphysical_vert,
    fragmentShader: THREE.ShaderChunk.meshphysical_frag,
  };
  material.onBeforeCompile(
    shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    {} as THREE.WebGLRenderer
  );
  return shader;
}

/** One bush (foliage + trunk), one rock, one sand: every decor role once. */
function geometrySetOfEveryRole(): DecorGeometrySet {
  return {
    parts: new Map([
      ['bush_0', [{ role: 'foliage', geometry: new THREE.BoxGeometry() }, { role: 'trunk', geometry: new THREE.BoxGeometry() }]],
      ['rock_0', [{ role: 'rock', geometry: new THREE.BoxGeometry() }]],
      ['sand_0', [{ role: 'sand', geometry: new THREE.BoxGeometry() }]],
    ]),
  };
}
function placementsOfEveryRole(): DecorPlacement[] {
  return (['bush', 'rock', 'sand'] as const).map((family, i) => ({
    family, variant: 0, x: i, z: 0, y: 0, yawTurns: 0, scale: 1,
  }));
}

/** What a material with no custom key reports (three's default). */
const PLAIN_KEY = new THREE.MeshStandardMaterial().customProgramCacheKey();

describe('the foliage batch sways (Task 7)', () => {
  const sway = { time: { value: 0 }, amp: { value: 1 }, wind: makeWindUniforms() };
  it('splices the sway chunk after project_vertex and shares the two uniforms', () => {
    const shader = compiled(swayingFoliageMaterial(['#6E7446', '#5A5F39', '#474B2D'], sway));
    const at = shader.vertexShader.indexOf('#include <project_vertex>');
    expect(at).toBeGreaterThanOrEqual(0);
    // The brief wrote `indexOf('uSwayTime')`, but GLSL needs the uniform
    // DECLARED at global scope, which is before `main` and so before the
    // anchor. What must sit after the anchor is its use: the chunk itself.
    expect(shader.vertexShader.indexOf(windVertexChunk())).toBeGreaterThan(at);
    expect(shader.vertexShader.lastIndexOf('uSwayTime')).toBeGreaterThan(at);
    expect(shader.vertexShader.indexOf('uniform float uSwayTime;')).toBeLessThan(shader.vertexShader.indexOf('void main'));
    expect(shader.uniforms.uSwayTime).toBe(sway.time);
    expect(shader.uniforms.uSwayAmp).toBe(sway.amp);
    expect(shader.uniforms.uWindMode).toBe(sway.wind.mode);
    expect(shader.uniforms.uWindStrength).toBe(sway.wind.strength);
    expect(shader.uniforms.uWindDir).toBe(sway.wind.dir);
  });
  it('throws when three no longer has the chunk it splices after', () => {
    const m = swayingFoliageMaterial(['#6E7446'], sway);
    const shader = { uniforms: {}, vertexShader: 'void main(){}', fragmentShader: '' };
    expect(() => m.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer)).toThrow(/project_vertex/);
  });
  it('is the foliage and the trunk (GH-984 N1): rock and sand keep the plain ramp material', () => {
    const group = buildDecorMesh(placementsOfEveryRole(), geometrySetOfEveryRole(), sway);
    expect(group.children.map((c) => c.name).sort()).toEqual(['decor-foliage', 'decor-rock', 'decor-sand', 'decor-trunk']);
    const keys: Record<string, string> = { 'decor-foliage': 'rl-foliage-sway', 'decor-trunk': 'rl-trunk-sway' };
    for (const child of group.children) {
      const mat = (child as THREE.BatchedMesh).material as THREE.Material;
      expect(mat.customProgramCacheKey()).toBe(keys[child.name] ?? PLAIN_KEY);
    }
  });
  it('the trunk batch carries the SAME chunk as the crown: the trunk-follows-crown falsifier', () => {
    const group = buildDecorMesh(placementsOfEveryRole(), geometrySetOfEveryRole(), sway);
    const trunk = (group.children.find((c) => c.name === 'decor-trunk') as THREE.BatchedMesh).material as THREE.Material;
    const vs = compiled(trunk).vertexShader;
    expect(vs).toContain(windVertexChunk(false, true));
    expect(vs).toContain('rlWindLean(');
    expect(vs).toContain('uWindMode');
    // A trunk held still in reduced motion: its legacy amplitude is the literal 0.
    expect(vs).toContain('uSwayAmp * 0.00000000 *');
    expect(compiled((group.children.find((c) => c.name === 'decor-foliage') as THREE.BatchedMesh).material as THREE.Material).vertexShader)
      .toContain('uSwayAmp * 0.03500000 *');
  });
  it('does not sway at all without the uniforms: no caller, no sway', () => {
    const group = buildDecorMesh(placementsOfEveryRole(), geometrySetOfEveryRole());
    for (const child of group.children) {
      expect(((child as THREE.BatchedMesh).material as THREE.Material).customProgramCacheKey()).not.toBe('rl-foliage-sway');
    }
  });
  it('a caller that never heard of the wind plays today`s sway: mode 0', () => {
    const shader = compiled(swayingFoliageMaterial(['#6E7446'], { time: { value: 0 }, amp: { value: 1 } }));
    expect((shader.uniforms.uWindMode as { value: number }).value).toBe(0);
  });
});

describe('rlNature (GH-984 N1)', () => {
  const tall = (y0: number, y1: number): THREE.BufferGeometry => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, y0, 0, 1, y1, 0, 0, y1, 1]), 3));
    return g;
  };
  const nature = (g: THREE.BufferGeometry): number[] => Array.from((g.getAttribute('rlNature') as THREE.BufferAttribute).array);

  it('normalises to the box of the whole KEY, so a bush`s foliage sits above its trunk`s bottom', () => {
    const trunk = tall(0, 0.8);
    const foliage = tall(0.4, 1.0);
    addNatureAttribute('bush_0', [{ role: 'trunk', geometry: trunk }, { role: 'foliage', geometry: foliage }]);
    // Heights over the union [0, 1.0]: the foliage's lowest vertex is at 0.4, not 0 (its own box would say 0).
    expect(nature(foliage).filter((_, i) => i % 2 === 0)).toEqual([expect.closeTo(0.4, 6), expect.closeTo(1, 6), expect.closeTo(1, 6)]);
    expect(nature(trunk).filter((_, i) => i % 2 === 0)).toEqual([0, expect.closeTo(0.8, 6), expect.closeTo(0.8, 6)]);
    // The trunk's top and the foliage at the same height agree: no seam.
    expect(nature(trunk)[2]).toBeCloseTo(0.8, 6);
  });

  it('writes the family class: grass 0, reed 1, shrub 2, tree 3', () => {
    const cases: [string, number][] = [['grass_1', 0], ['wet_grass_0', 0], ['reed_2', 1], ['bush_0', 2], ['shrub_1', 2], ['tree_0', 3], ['cedar_2', 3], ['desert_tree_0', 3], ['oak_0', 3], ['willow_1', 3]];
    for (const [key, cls] of cases) {
      const g = tall(0, 1);
      addNatureAttribute(key, [{ role: 'foliage', geometry: g }]);
      expect(nature(g).filter((_, i) => i % 2 === 1)).toEqual([cls, cls, cls]);
    }
  });

  it('leaves rock and sand parts alone, and a part that has it is not rewritten', () => {
    const rock = tall(0, 1);
    const foliage = tall(0, 1);
    addNatureAttribute('tree_0', [{ role: 'rock', geometry: rock }, { role: 'foliage', geometry: foliage }]);
    expect(rock.getAttribute('rlNature')).toBeUndefined();
    const first = foliage.getAttribute('rlNature');
    addNatureAttribute('tree_0', [{ role: 'foliage', geometry: foliage }]);
    expect(foliage.getAttribute('rlNature')).toBe(first);
  });

  it('buildDecorMesh adds it to foliage and trunk parts only when the sway is on, +0 batches', () => {
    const withSway = geometrySetOfEveryRole();
    const g = buildDecorMesh(placementsOfEveryRole(), withSway, { time: { value: 0 }, amp: { value: 1 }, wind: makeWindUniforms() });
    expect(g.children.length).toBe(4);
    const bush = withSway.parts.get('bush_0') ?? [];
    expect(bush.every((p) => p.geometry.getAttribute('rlNature') !== undefined)).toBe(true);
    expect((withSway.parts.get('rock_0') ?? [])[0].geometry.getAttribute('rlNature')).toBeUndefined();
    const without = geometrySetOfEveryRole();
    buildDecorMesh(placementsOfEveryRole(), without);
    expect((without.parts.get('bush_0') ?? [])[0].geometry.getAttribute('rlNature')).toBeUndefined();
  });

  it('survives stripToBatchAttributes (the whitelist names it)', () => {
    const g = tall(0, 1);
    addNatureAttribute('bush_0', [{ role: 'foliage', geometry: g }]);
    stripToBatchAttributes(g);
    expect(g.getAttribute('rlNature')).toBeDefined();
  });
});

describe('buildDecorMesh decorColors (GH-322)', () => {
  const set: DecorGeometrySet = {
    parts: new Map([
      ['rock_0', [{ role: 'rock', geometry: geo() }]],
      ['slab_0', [{ role: 'rock', geometry: geo() }]],
      ['bush_0', [{ role: 'foliage', geometry: geo() }]],
    ]),
  };
  const placements: DecorPlacement[] = [
    { family: 'rock', variant: 0, x: 0, z: 0, y: 0, yawTurns: 0, scale: 1 },
    { family: 'slab', variant: 0, x: 1, z: 1, y: 0, yawTurns: 0, scale: 1 },
    { family: 'bush', variant: 0, x: 2, z: 2, y: 0, yawTurns: 0, scale: 1 },
  ];
  const byName = (g: THREE.Group, name: string): THREE.BatchedMesh => {
    const m = batchesOf(g).find((b) => b.name === name);
    if (!m) throw new Error(`no ${name}`);
    return m;
  };
  const colorsTexture = (m: THREE.BatchedMesh): unknown => (m as unknown as { _colorsTexture: unknown })._colorsTexture;

  it('builds an untinted batch exactly as before: ramp-coloured material, no instance colours', () => {
    const plain = buildDecorMesh(placements, set);
    const rock = byName(plain, 'decor-rock');
    expect(colorsTexture(rock)).toBeNull();
    expect((rock.material as THREE.MeshStandardMaterial).color.getHexString()).toBe(
      new THREE.Color(liftTone(rampForDecorRole('rock'))).getHexString()
    );
    // A tint for a family the batch does not hold switches nothing over.
    const other = buildDecorMesh(placements, set, undefined, { 'cedar:foliage': '#3E5C2E' });
    expect(colorsTexture(byName(other, 'decor-rock'))).toBeNull();
    expect(colorsTexture(byName(other, 'decor-foliage'))).toBeNull();
  });

  it('tints a keyed family inside its role batch, and gives the unkeyed one its old tone, at +0 draws', () => {
    const g = buildDecorMesh(placements, set, undefined, { 'slab:rock': '#6E6960' });
    expect(batchesOf(g).length).toBe(2);
    const rock = byName(g, 'decor-rock');
    expect((rock.material as THREE.MeshStandardMaterial).color.getHex()).toBe(0xffffff);
    const c = new THREE.Color();
    rock.getColorAt(0, c);
    expect(c.getHexString()).toBe(new THREE.Color(liftTone(rampForDecorRole('rock'))).getHexString());
    rock.getColorAt(1, c);
    expect(c.getHexString()).toBe(new THREE.Color('#6E6960').getHexString());
    // The foliage batch had no key and is untouched.
    expect(colorsTexture(byName(g, 'decor-foliage'))).toBeNull();
  });
});

describe('the wet foliage batch (GH-871 P4 T5): the direct witness', () => {
  // The theme-identity harness loads no decor GLBs, so its `scene` digest cannot
  // see a wet-sway change made at the decor/batch call site. This builds the
  // batch the way the renderer does (`buildDecorMesh`) with the rain option on
  // and off and reads the compiled foliage program.
  const sway = { time: { value: 0 }, amp: { value: 1 }, wind: makeWindUniforms() };
  const foliageOf = (g: THREE.Group): THREE.Material =>
    (g.children.find((c) => c.name === 'decor-foliage') as THREE.BatchedMesh).material as THREE.Material;
  const build = (wet?: boolean): THREE.Group =>
    buildDecorMesh(placementsOfEveryRole(), geometrySetOfEveryRole(), sway, undefined, wet);

  it('a dry batch is today`s: the shipped cache key and the shipped chunk, byte for byte', () => {
    for (const wet of [undefined, false]) {
      const mat = foliageOf(build(wet));
      expect(mat.customProgramCacheKey()).toBe('rl-foliage-sway');
      const vs = compiled(mat).vertexShader;
      // Today's program: the amplitude and the gust gain this file shipped with.
      expect(vs).toContain('uSwayAmp * 0.03500000 *');
      expect(vs).toContain('(1.40000000 - 1.0)');
      expect(vs).not.toContain('0.07700000');
      expect(vs).not.toContain('(3.00000000 - 1.0)');
      expect(vs).not.toContain('float gain = 3.00000000;');
      expect(vs).toContain('float gain = RL_WIND_GAIN[cls];');
      // And it equals the material the unchanged signature builds.
      expect(vs).toBe(compiled(swayingFoliageMaterial(['#808080'], sway)).vertexShader);
    }
  });

  it('a wet batch differs in exactly the amplitude x2.2, the gust 3.0 and the cache key', () => {
    const dry = foliageOf(build(false));
    const wet = foliageOf(build(true));
    expect(wet.customProgramCacheKey()).toBe('rl-foliage-sway-wet');
    expect(wet.customProgramCacheKey()).not.toBe(dry.customProgramCacheKey());
    const dryVs = compiled(dry).vertexShader;
    const wetVs = compiled(wet).vertexShader;
    expect(wetVs).toContain('uSwayAmp * 0.07700000 *');
    expect(wetVs).toContain('(3.00000000 - 1.0)');
    // The wind branch (GH-984 N1) bakes the same two numbers: its gain (3.0 for every class) and the x2.2.
    expect(wetVs).toContain('float gain = 3.00000000;');
    expect(wetVs).toContain('* 2.20000000 * strength');
    expect(
      wetVs
        .replace('0.07700000', '0.03500000')
        .replace('(3.00000000 - 1.0)', '(1.40000000 - 1.0)')
        .replace('float gain = 3.00000000;', 'float gain = RL_WIND_GAIN[cls];')
        .replace('* 2.20000000 * strength', '* 1.00000000 * strength')
    ).toBe(dryVs);
    // The fragment source and the sway uniforms (the `wind` layer's) are untouched.
    expect(compiled(wet).fragmentShader).toBe(compiled(dry).fragmentShader);
    expect(compiled(wet).uniforms.uSwayAmp).toBe(sway.amp);
    expect(compiled(wet).uniforms.uSwayTime).toBe(sway.time);
  });

  it('a wet batch is the foliage and the trunk: rock and sand keep the plain ramp', () => {
    const group = build(true);
    const keys: Record<string, string> = { 'decor-foliage': 'rl-foliage-sway-wet', 'decor-trunk': 'rl-trunk-sway-wet' };
    for (const child of group.children) {
      const key = ((child as THREE.BatchedMesh).material as THREE.Material).customProgramCacheKey();
      if (keys[child.name] !== undefined) expect(key).toBe(keys[child.name]);
      else expect(key).toBe(PLAIN_KEY);
    }
  });
});
