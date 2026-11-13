/**
 * GH-1319: the vertex format three's REAL WebGPU backend (the bundled `three/webgpu` the app loads) lays out for a vehicle's
 * `_rl_wheel`, in the shape the loaders hand it over, before and after `widenForWebGpu`.
 *
 * The oracle is three's own `WebGPUAttributeUtils` (`createAttribute`, then `createShaderVertexBuffers`, the layout
 * `createRenderPipeline` is given), on a stub device. It is not a copy of three's table.
 *
 * Falsification (run by hand, in the commit message): make `lacksWebGpuVertexFormat` return false and the Draco-shape case reads
 * `format: undefined` again, the error the moving Lavi threw.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { lacksWebGpuVertexFormat, widenForWebGpu } from './webgpu-vertex-format';
import { webGpuFormats } from './webgpu-vertex-format.test-support';

/** `DRACOLoader.decodeAttribute`'s output for a 1-byte scalar: a 4-byte stride, so an `InterleavedBufferAttribute` (literal). */
function dracoWheel(values: readonly number[]): THREE.InterleavedBufferAttribute {
  const arr = new Uint8Array(values.length * 4);
  values.forEach((v, i) => (arr[i * 4] = v));
  return new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(arr, 4), 1, 0);
}

describe('GH-1319: an 8-bit scalar the loaders interleave has no WebGPU vertex format until it is widened', () => {
  it('the Draco shape reads format undefined in three itself (the crash), and float32 once widened, values kept', async () => {
    const values = [0, 1, 2, 3, 0, 4];
    expect(await webGpuFormats([dracoWheel(values)])).toEqual([undefined]);

    const g = new THREE.BufferGeometry();
    g.setAttribute('_rl_wheel', dracoWheel(values));
    expect(widenForWebGpu(g)).toBe(1);
    const w = g.getAttribute('_rl_wheel') as THREE.BufferAttribute;
    expect(w).not.toBeInstanceOf(THREE.InterleavedBufferAttribute);
    expect(Array.from(w.array)).toEqual(values);
    expect(await webGpuFormats([w])).toEqual(['float32']);
    // Idempotent.
    expect(widenForWebGpu(g)).toBe(0);
    expect(g.getAttribute('_rl_wheel')).toBe(w);
  });

  it('a normalised 8-bit scalar is denormalised; formats three already handles are left as they are', async () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('n', new THREE.BufferAttribute(new Uint8Array([0, 255]), 1, true));
    const plain = new THREE.BufferAttribute(new Uint8Array([1, 2]), 1);
    const track = new THREE.BufferAttribute(new Float32Array([-1, 0.5]), 1);
    const pos = new THREE.BufferAttribute(new Float32Array(6), 3);
    g.setAttribute('plain', plain);
    g.setAttribute('_rl_track', track);
    g.setAttribute('position', pos);
    expect(widenForWebGpu(g)).toBe(1);
    expect(Array.from(g.getAttribute('n').array)).toEqual([0, 1]);
    // three widens a plain (non-interleaved, non-normalised) 8-bit scalar itself: untouched here.
    expect(lacksWebGpuVertexFormat(plain)).toBe(false);
    expect(g.getAttribute('plain')).toBe(plain);
    expect(g.getAttribute('_rl_track')).toBe(track);
    expect(g.getAttribute('position')).toBe(pos);
    expect(await webGpuFormats([plain])).toEqual(['uint32']);
  });
});
