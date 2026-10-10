// GH-469 saving 1: a GLB texture's decoded CPU copy is released once three
// has uploaded it -- and not before, and loudly if it is ever needed again.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  disposeGltfLoader,
  gltfLoader,
  RELEASE_IMAGES_PLUGIN,
  RELEASED_IMAGE_KEY,
  releaseImagesAfterUpload,
} from './gltf-loader';

/** An ImageBitmap stand-in: `close()` zeroes the size, as the real one does. */
class FakeBitmap {
  closed = 0;
  constructor(public width: number, public height: number) {}
  close(): void {
    this.closed += 1;
    this.width = 0;
    this.height = 0;
  }
}

function texturedScene(bitmap: FakeBitmap): { root: THREE.Group; tex: THREE.Texture } {
  const tex = new THREE.Texture(bitmap as unknown as HTMLImageElement);
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ map: tex })));
  return { root, tex };
}

afterEach(() => {
  disposeGltfLoader();
  vi.restoreAllMocks();
});

describe('releasing a GLB texture\'s CPU copy after upload', () => {
  it('keeps the bitmap until the upload, then closes it and remembers its size', () => {
    const bmp = new FakeBitmap(2048, 1024);
    const { root, tex } = texturedScene(bmp);
    releaseImagesAfterUpload(root);
    expect(bmp.closed).toBe(0);
    tex.onUpdate?.(); // three's own after-upload callback
    expect(bmp.closed).toBe(1);
    expect(tex.userData[RELEASED_IMAGE_KEY]).toEqual({ width: 2048, height: 1024 });
  });

  it('says so, by name, if a released texture is ever uploaded again', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const bmp = new FakeBitmap(64, 64);
    const { root, tex } = texturedScene(bmp);
    tex.name = 'base_color';
    releaseImagesAfterUpload(root);
    tex.onUpdate?.();
    tex.onUpdate?.();
    expect(bmp.closed).toBe(1);
    expect(err).toHaveBeenCalledWith(expect.stringContaining('"base_color" was uploaded again'));
  });

  it('leaves a texture that is not a bitmap alone (a DataTexture, a canvas)', () => {
    const tex = new THREE.DataTexture(new Uint8Array(16), 2, 2);
    const root = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ map: tex }));
    releaseImagesAfterUpload(root);
    expect(tex.onUpdate).toBeNull();
  });

  it('is armed on every GLB the shared loader parses', () => {
    const loader = gltfLoader() as unknown as { pluginCallbacks: ((p: unknown) => { name: string })[] };
    const names = loader.pluginCallbacks.map((cb) => cb({}).name);
    expect(names).toContain(RELEASE_IMAGES_PLUGIN);
  });
});
