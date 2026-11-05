/**
 * GH-943 P1 (T6): the node twin of the sky environment. GL-free: the webgpu PMREM generator is a stand-in, so what is pinned is
 * the contract the node path adds to the registry -- the toggle is an intensity (the envMap stays, no program rebuild), the
 * texture is tagged so the census keeps it, the bake repaints one target, and `scene.environment` is never set.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EnvironmentRegistry, NODE_PMREM_TAG, SKY_HEIGHT, SKY_WIDTH, skyColorsFor, skyEquirectFloats } from './environment';
import { createNodePmremHost, type NodePmremGeneratorCtor } from './environment.node';
import { ENV_CLASSES, ENV_USERDATA_KEY, type EnvClass } from './environment-classes';
import { censusUnported } from './backend/unported';

interface Seen {
  sources: THREE.DataTexture[];
  targets: (THREE.RenderTarget | null)[];
  made: number;
  disposed: number;
}
function fakeGenerator(seen: Seen): NodePmremGeneratorCtor {
  return class {
    constructor() {
      seen.made++;
    }
    fromEquirectangular(source: THREE.Texture, target: THREE.RenderTarget | null): THREE.RenderTarget {
      seen.sources.push(source as THREE.DataTexture);
      seen.targets.push(target);
      return target ?? new THREE.RenderTarget(4, 4);
    }
    dispose(): void {
      seen.disposed++;
    }
  };
}
const freshSeen = (): Seen => ({ sources: [], targets: [], made: 0, disposed: 0 });
function mat(cls: EnvClass): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial();
  m.userData = { [ENV_USERDATA_KEY]: cls };
  return m;
}
function attached(seen = freshSeen()): EnvironmentRegistry {
  const reg = new EnvironmentRegistry('day');
  reg.attach(createNodePmremHost(fakeGenerator(seen), {}));
  return reg;
}

describe('the node sky bake', () => {
  it('feeds the generator the SAME equirect floats as the legacy bake, as half floats, NoColorSpace', () => {
    const seen = freshSeen();
    attached(seen);
    const src = seen.sources[0];
    expect(src.colorSpace).toBe(THREE.NoColorSpace);
    expect(src.mapping).toBe(THREE.EquirectangularReflectionMapping);
    const want = skyEquirectFloats(skyColorsFor('day'), SKY_WIDTH, SKY_HEIGHT);
    const got = src.image.data as Uint16Array;
    expect(got.length).toBe(want.length);
    for (const i of [0, 4 * SKY_WIDTH * 100, want.length - 4]) expect(got[i]).toBe(THREE.DataUtils.toHalfFloat(want[i]));
  });

  it('tags the baked texture so the unported census keeps it (a WebGL-made render-target PMREM is still dropped)', () => {
    const reg = attached();
    expect((reg.texture?.userData as Record<string, unknown>)[NODE_PMREM_TAG]).toBe(true);
    const m = mat('unitMetal');
    reg.adopt([m], 'unitMetal');
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BufferGeometry(), m));
    const found = censusUnported(root);
    expect(found.some((h) => h.kind === 'env-map')).toBe(false);
    expect(m.envMap).toBe(reg.texture);
  });

  it('repaints into the same target on a preset change (identity stable, one generator)', () => {
    const seen = freshSeen();
    const reg = attached(seen);
    const first = reg.texture;
    expect(reg.setPreset('dusk')).toBe(true);
    expect(reg.texture).toBe(first);
    expect(seen.made).toBe(1);
    expect(seen.targets[1]).not.toBeNull();
  });
});

describe('the node toggle', () => {
  it('zeroes envMapIntensity and KEEPS the envMap (no program rebuild); turning it on restores the class intensity', () => {
    const reg = attached();
    const m = mat('unitMetal');
    reg.adopt([m], 'unitMetal');
    const tex = reg.texture;
    expect(m.envMapIntensity).toBe(ENV_CLASSES.unitMetal.intensity);
    const version = m.version;
    reg.setEnabled(false);
    expect(m.envMap).toBe(tex);
    expect(m.envMapIntensity).toBe(0);
    expect(m.version).toBe(version);
    reg.setEnabled(true);
    expect(m.envMapIntensity).toBe(ENV_CLASSES.unitMetal.intensity);
    expect(m.version).toBe(version);
  });

  it('a material adopted while the layer is off arrives at intensity 0, not at its class value', () => {
    const reg = attached();
    reg.setEnabled(false);
    const m = mat('building');
    reg.adopt([m], 'building');
    expect(m.envMap).toBe(reg.texture);
    expect(m.envMapIntensity).toBe(0);
  });

  it('still gives a non-receiving class no envMap at all, and the census env-map count is 0', () => {
    const reg = attached();
    const ms = (['ground', 'decal', 'smoke', 'fx', 'backdrop', 'unitMetal', 'prop'] as const).map(mat);
    reg.adopt(ms, 'prop');
    const root = new THREE.Group();
    for (const m of ms) root.add(new THREE.Mesh(new THREE.BufferGeometry(), m));
    expect(ms.slice(0, 5).every((m) => m.envMap === null)).toBe(true);
    expect(censusUnported(root).filter((h) => h.kind === 'env-map')).toEqual([]);
  });

  it('never sets scene.environment', () => {
    const scene = new THREE.Scene();
    const reg = attached();
    const m = mat('unitMetal');
    scene.add(new THREE.Mesh(new THREE.BufferGeometry(), m));
    reg.adopt([m], 'unitMetal');
    reg.setEnabled(false);
    reg.setPreset('dawn');
    expect(scene.environment).toBeNull();
  });

  it('the legacy host is unchanged: the toggle there still nulls the envMap', () => {
    const reg = new EnvironmentRegistry('day', undefined, (_gl, _c, prev) => prev ?? { texture: new THREE.Texture(), dispose: () => {} });
    reg.attach({} as THREE.WebGLRenderer);
    const m = mat('unitMetal');
    reg.adopt([m], 'unitMetal');
    reg.setEnabled(false);
    expect(m.envMap).toBeNull();
  });
});
