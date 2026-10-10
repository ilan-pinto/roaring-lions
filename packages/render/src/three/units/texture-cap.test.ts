import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { cappedSize, capTextureSize } from './texture-cap';

class FakeBitmap {
  closed = false;
  constructor(public width: number, public height: number) {}
  close(): void {
    this.closed = true;
  }
}

describe('capping GLB texture size (GH-469 saving 3)', () => {
  it('keeps the aspect, and leaves a texture at or under the cap alone', () => {
    expect(cappedSize(2048, 2048, 1024)).toEqual({ width: 1024, height: 1024 });
    expect(cappedSize(3072, 1024, 1024)).toEqual({ width: 1024, height: 341 });
    expect(cappedSize(1024, 512, 1024)).toBeNull();
  });

  it('resamples once per source, closes the full-size bitmap and marks every texture for upload', async () => {
    const big = new FakeBitmap(2048, 2048);
    const a = new THREE.Texture(big as unknown as HTMLImageElement);
    const b = a.clone();
    const root = new THREE.Group().add(
      new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ map: a })),
      new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ map: b }))
    );
    const small = new FakeBitmap(1024, 1024);
    const resample = vi.fn(async () => small);
    const [va, vb] = [a.version, b.version];
    await capTextureSize(root, 1024, resample);
    expect(resample).toHaveBeenCalledTimes(1);
    expect(resample).toHaveBeenCalledWith(big, 1024, 1024);
    expect(a.source.data).toBe(small);
    expect(big.closed).toBe(true);
    expect(a.version).toBeGreaterThan(va);
    expect(b.version).toBeGreaterThan(vb);
  });
});
