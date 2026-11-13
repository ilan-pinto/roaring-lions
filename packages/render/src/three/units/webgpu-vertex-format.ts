/**
 * GH-1319: a vehicle GLB's 8-bit scalar vertex attribute, widened to float32 on a NODE boot so three's WebGPU backend can name its
 * vertex format.
 *
 * `pnpm running-gear:meshes` writes `_RL_WHEEL` as an UNSIGNED_BYTE scalar into every vehicle GLB that has wheels or tracks (17
 * shipped files on 13 Nov). Both loaders hand it over INTERLEAVED: `DRACOLoader` pads a 1-byte element to a 4-byte stride
 * (`decodeAttribute`, `dstStride`) and returns an `InterleavedBufferAttribute`, and an uncompressed `art/meshes` copy has the
 * bufferView's own 40-byte stride, which `GLTFLoader` keeps the same way. three 0.186.1's `WebGPUAttributeUtils` widens an 8- or
 * 16-bit array to 32 bits only when the attribute is NOT interleaved and NOT normalised (`createAttribute`), and its item-size-1
 * table (`_getVertexFormat`) has no 8- or 16-bit entry, so such an attribute gets `format: undefined` and `createRenderPipeline`
 * throws ("GPUVertexAttribute 'format' Required member is undefined").
 *
 * Nothing reads `_rl_wheel` until a vehicle first moves: the running-gear clone (`running-gear-binding.ts`) is bound then, and its
 * node twin's wheel term (`running-gear.node.ts`) is the first program whose pipeline lists the attribute. So a parked Lavi draws
 * and a moving one throws. WebGL needs none of this (`vertexAttribPointer` takes UNSIGNED_BYTE at any stride), and the legacy boot
 * never calls this file: the caller holds `queueNodeAdoption`'s own node-only guard.
 *
 * Only the attributes three cannot format are replaced (item size 1, an 8- or 16-bit array, interleaved or normalised), by a
 * non-interleaved `Float32Array` of `getX` (which denormalises a normalised one), the type `T.attribute(name, 'float')` reads and
 * that `_rl_track` already draws as. Instanced attributes are left alone (none is loaded from a GLB). Idempotent: a widened
 * attribute is float32 and is not touched again.
 *
 * Presentation only. Nothing here is read by the sim.
 */
import * as THREE from 'three';

type AnyAttribute = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;

/** True for an attribute three 0.186.1's WebGPU backend gives no vertex format (see the header). */
export function lacksWebGpuVertexFormat(a: AnyAttribute): boolean {
  if (a.itemSize !== 1) return false;
  const interleaved = (a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute === true;
  if ((a as THREE.InstancedBufferAttribute).isInstancedBufferAttribute === true) return false;
  if (interleaved && (a as THREE.InterleavedBufferAttribute).data instanceof THREE.InstancedInterleavedBuffer) return false;
  const arr = a.array;
  const narrow = arr instanceof Uint8Array || arr instanceof Int8Array || arr instanceof Uint16Array || arr instanceof Int16Array;
  return narrow && (interleaved || a.normalized);
}

/** Replaces every attribute of `geometry` that `lacksWebGpuVertexFormat` with a float32 copy. Returns how many it replaced. */
export function widenForWebGpu(geometry: THREE.BufferGeometry): number {
  let widened = 0;
  for (const name of Object.keys(geometry.attributes)) {
    const a = geometry.attributes[name] as AnyAttribute;
    if (!lacksWebGpuVertexFormat(a)) continue;
    const out = new Float32Array(a.count);
    for (let i = 0; i < a.count; i++) out[i] = a.getX(i);
    const w = new THREE.BufferAttribute(out, 1);
    w.name = a.name;
    geometry.setAttribute(name, w);
    widened++;
  }
  return widened;
}

/** `widenForWebGpu` on every mesh geometry under `root` (a vehicle template: its live meshes and the `WRECK_` twin share them). */
export function widenTreeForWebGpu(root: THREE.Object3D): number {
  let widened = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh === true && mesh.geometry !== undefined) widened += widenForWebGpu(mesh.geometry);
  });
  return widened;
}
