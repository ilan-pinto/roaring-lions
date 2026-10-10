import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildInventory, geometryBytes, texelBytes, textureBytes } from './memory-inventory';

function tri(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3)); // 36 B
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(9), 3)); // 36 B
  g.setIndex(new THREE.BufferAttribute(new Uint16Array(3), 1)); // 6 B
  return g;
}

function data(w: number, h: number, mips: boolean): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array(w * h * 4), w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.generateMipmaps = mips;
  t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  return t;
}

describe('memory inventory', () => {
  it('counts every attribute and the index, and an interleaved buffer once', () => {
    expect(geometryBytes(tri())).toBe(36 + 36 + 6);
    const g = new THREE.BufferGeometry();
    const ib = new THREE.InterleavedBuffer(new Float32Array(24), 6); // 96 B
    g.setAttribute('position', new THREE.InterleavedBufferAttribute(ib, 3, 0));
    g.setAttribute('normal', new THREE.InterleavedBufferAttribute(ib, 3, 3));
    expect(geometryBytes(g)).toBe(96);
  });

  it('sizes a texture from its format and type, with a third more for a mip chain', () => {
    expect(texelBytes(THREE.RGBAFormat, THREE.UnsignedByteType)).toBe(4);
    expect(texelBytes(THREE.RedFormat, THREE.UnsignedByteType)).toBe(1);
    expect(texelBytes(THREE.RGBAFormat, THREE.HalfFloatType)).toBe(8);
    expect(textureBytes(data(64, 32, false)).bytes).toBe(64 * 32 * 4);
    expect(textureBytes(data(64, 32, true)).bytes).toBe(Math.round((64 * 32 * 4 * 4) / 3));
  });

  it('counts a shared geometry and a shared texture SOURCE once, in the first group that reaches it', () => {
    const geo = tri();
    const tex = data(16, 16, false);
    const matA = new THREE.MeshStandardMaterial({ map: tex });
    // A clone of the texture is a new Texture over the same Source.
    const matB = new THREE.MeshStandardMaterial({ map: tex.clone() });
    const a = new THREE.Mesh(geo, matA);
    const b = new THREE.Group().add(new THREE.Mesh(geo, matB));
    const inv = buildInventory([
      ['live', a],
      ['templates', b],
    ]);
    const live = inv.groups.find((g) => g.label === 'live');
    const tmpl = inv.groups.find((g) => g.label === 'templates');
    expect(live?.geometryBytes).toBe(78);
    expect(live?.textureBytes).toBe(16 * 16 * 4);
    expect(tmpl?.geometryBytes).toBe(0);
    expect(tmpl?.textureBytes).toBe(0);
  });

  it('reads textures held in a uniform table, and extra textures by label', () => {
    const tex = data(8, 8, false);
    const mat = new THREE.ShaderMaterial({ uniforms: { uMap: { value: tex } } });
    const inv = buildInventory([['shader', new THREE.Mesh(tri(), mat)]], null, [['shadow map', data(32, 32, false)]]);
    expect(inv.groups.find((g) => g.label === 'shader')?.textureBytes).toBe(8 * 8 * 4);
    expect(inv.groups.find((g) => g.label === 'shadow map')?.textureBytes).toBe(32 * 32 * 4);
  });
});
