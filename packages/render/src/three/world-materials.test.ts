import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  WORLD_ROUGHNESS,
  liftTone,
  rampMaterial,
  texturedMaterial,
  texturedMapMaterial,
  prepareTexturedMap,
} from './world-materials';

const OLIVE = ['#8F9464', '#6E7449', '#4E5433', '#333821'];

describe('liftTone', () => {
  it('picks the lit face of a ramp: index 1 of three or more steps, index 0 of fewer', () => {
    expect(liftTone(OLIVE)).toBe('#6E7449');
    expect(liftTone(['#A9C4D1', '#4E7186'])).toBe('#A9C4D1');
    expect(liftTone(['#C78773'])).toBe('#C78773');
    expect(() => liftTone([])).toThrow(/empty/);
  });
});

describe('rampMaterial', () => {
  it('is a lit standard material carrying the lifted tone as a linear colour', () => {
    const m = rampMaterial(OLIVE);
    expect(m).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(m.color.getHexString().toUpperCase()).toBe('6E7449');
    expect(m.roughness).toBe(WORLD_ROUGHNESS);
    expect(m.metalness).toBe(0);
  });
});

describe('texturedMaterial', () => {
  it('keeps the loader material and its map, tags the map sRGB, and zeroes metalness with no metalness map', () => {
    const loaded = new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
    loaded.metalness = 1; // GLTFLoader's default metallicFactor
    const m = texturedMaterial(loaded);
    expect(m).toBe(loaded);
    expect(m.map?.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(m.metalness).toBe(0);
    expect(m.roughness).toBe(WORLD_ROUGHNESS);
    expect(m.envMapIntensity).toBe(0);
  });
  it('leaves metalness and roughness alone when the GLB carries the maps (Phase 0b re-export)', () => {
    const loaded = new THREE.MeshStandardMaterial({
      map: new THREE.Texture(),
      metalnessMap: new THREE.Texture(),
      roughnessMap: new THREE.Texture(),
      normalMap: new THREE.Texture(),
    });
    loaded.metalness = 1;
    loaded.roughness = 1;
    const m = texturedMaterial(loaded);
    expect(m.metalness).toBe(1);
    expect(m.roughness).toBe(1);
    expect(m.normalMap).not.toBeNull();
  });
  it('wraps a non-standard material that carries a map (KHR_materials_unlit)', () => {
    const map = new THREE.Texture();
    const m = texturedMaterial(new THREE.MeshBasicMaterial({ map }));
    expect(m).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(m.map).toBe(map);
  });
  it('refuses a material with no map -- that is a palette asset, not a textured one', () => {
    expect(() => texturedMaterial(new THREE.MeshStandardMaterial())).toThrow(/no base colour map/);
  });
});

describe('texturedMapMaterial / prepareTexturedMap', () => {
  it('builds a lit material around a bare map with mipmaps and sRGB', () => {
    const m = texturedMapMaterial(new THREE.Texture());
    expect(m.map?.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(m.map?.generateMipmaps).toBe(true);
    expect(m.map?.minFilter).toBe(THREE.LinearMipmapLinearFilter);
    expect(m.roughness).toBe(WORLD_ROUGHNESS);
  });
  it('prepareTexturedMap tags sRGB (the reverse of what the retired palette pipeline did)', () => {
    const map = new THREE.Texture();
    map.colorSpace = THREE.NoColorSpace;
    expect(prepareTexturedMap(map).colorSpace).toBe(THREE.SRGBColorSpace);
  });
});
