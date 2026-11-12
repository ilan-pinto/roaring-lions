/**
 * GH-1226 (S2): the height-blend field as a three.js texture. The ONE file of the field that imports three, kept out of the
 * `@lions/render/terrain` barrel the way `mesh.ts` is, so the baked bytes (`height-blend-field.ts`) stay reachable without it.
 *
 * RGBA8, `NoColorSpace` (the bytes are data, not colour), Linear filtering both ways, clamp to edge, NO mips (it is only ever
 * magnified: 192 texels across a 48-tile map against 760 CSS px at zoom 0.35). Nothing here is wired into the renderer yet (S5).
 */
import * as THREE from 'three';
import { HEIGHT_BLEND_FIELD_MARKER, type HeightBlendFieldData } from './height-blend-field';

export function heightBlendTexture(field: HeightBlendFieldData): THREE.DataTexture {
  const buffer = field.data.buffer;
  const data = buffer instanceof ArrayBuffer ? new Uint8Array(buffer, field.data.byteOffset, field.data.length) : new Uint8Array(field.data);
  const t = new THREE.DataTexture(data, field.width, field.height, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = THREE.NoColorSpace;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.name = HEIGHT_BLEND_FIELD_MARKER;
  t.needsUpdate = true;
  return t;
}
