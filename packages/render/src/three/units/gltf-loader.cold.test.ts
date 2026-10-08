// GH-469 saving 2: a COLD template's textures are parsed but never decoded
// until something is about to draw them.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { GLTFParser } from 'three/addons/loaders/GLTFLoader.js';
import {
  coldTexturesPlugin,
  hasColdTextures,
  isColdTexture,
  markColdTexture,
  warmColdTextures,
} from './gltf-loader';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A parser stand-in: one embedded image, and three's own `loadTextureImage`
 *  contract -- hand the loader a blob: URL, take back a Texture. */
function fakeParser(): GLTFParser {
  return {
    json: { textures: [{ source: 0 }], images: [{ bufferView: 3, mimeType: 'image/png' }] },
    loadTextureImage(_ti: number, _si: number, loader: { load: (...a: unknown[]) => void }): Promise<THREE.Texture> {
      return new Promise((resolve, reject) => loader.load('blob:fake', resolve, undefined, reject));
    },
  } as unknown as GLTFParser;
}

describe('cold GLB textures', () => {
  it('parses an embedded image WITHOUT decoding it, and keeps its encoded bytes', async () => {
    const decode = vi.fn();
    vi.stubGlobal('createImageBitmap', decode);
    const bytes = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes)));
    const tex = await coldTexturesPlugin(fakeParser()).loadTexture?.(0);
    expect(tex).toBeInstanceOf(THREE.Texture);
    expect(decode).not.toHaveBeenCalled();
    expect(isColdTexture(tex as THREE.Texture)).toBe(true);
  });

  it('decodes once per source on warm, and marks every texture over it for upload', async () => {
    const a = new THREE.Texture();
    const b = a.clone(); // same Source, as GLTFParser's sourceCache hands out
    markColdTexture(a, new Blob(['x']));
    const root = new THREE.Group().add(
      new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ map: a })),
      new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ map: b, normalMap: a }))
    );
    expect(hasColdTextures(root)).toBe(true);
    const bitmap = { width: 8, height: 8 } as ImageBitmap;
    const decode = vi.fn(async () => bitmap);
    const [va, vb] = [a.version, b.version];
    await Promise.all([warmColdTextures(root, decode), warmColdTextures(root, decode)]);
    expect(decode).toHaveBeenCalledTimes(1);
    expect(a.source.data).toBe(bitmap);
    expect(a.version).toBeGreaterThan(va);
    expect(b.version).toBeGreaterThan(vb);
    expect(hasColdTextures(root)).toBe(false);
  });

  it('frees a warmed texture\'s decoded copy once it is uploaded (saving 1 on top of saving 2)', async () => {
    const t = new THREE.Texture();
    markColdTexture(t, new Blob(['x']));
    const root = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ map: t }));
    let closed = 0;
    const bitmap = { width: 8, height: 8, close: () => { closed += 1; } } as unknown as ImageBitmap;
    await warmColdTextures(root, async () => bitmap);
    expect(closed).toBe(0);
    t.onUpdate?.(); // three's after-upload callback
    expect(closed).toBe(1);
  });

  it('says so, by name, if a cold texture is ever uploaded', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('createImageBitmap', vi.fn());
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['x']))));
    const tex = (await coldTexturesPlugin(fakeParser()).loadTexture?.(0)) as THREE.Texture;
    tex.name = 'base_color';
    tex.onUpdate?.();
    expect(err).toHaveBeenCalledWith(expect.stringContaining('"base_color" was uploaded before it was warmed'));
  });
});
