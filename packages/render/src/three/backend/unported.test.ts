import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { censusUnported, unportedWarnings } from './unported';

describe('censusUnported: no hook is dropped silently', () => {
  it('names a ShaderMaterial, hides it, and names an onBeforeCompile material without hiding it', () => {
    const root = new THREE.Group();
    const geo = new THREE.BufferGeometry();
    const shader = new THREE.Mesh(geo, new THREE.ShaderMaterial({ name: 'fog-quad' }));
    const hooked = new THREE.MeshStandardMaterial({ name: 'ground' });
    hooked.onBeforeCompile = () => {};
    const ground = new THREE.Mesh(geo, hooked);
    const stock = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ name: 'stock' }));
    root.add(shader, ground, stock);
    const found = censusUnported(root);
    expect(found.map((h) => `${h.kind}:${h.key}`)).toEqual(['on-before-compile:ground', 'shader-material:fog-quad']);
    expect(shader.visible).toBe(false);
    expect(ground.visible).toBe(true);
    expect(stock.visible).toBe(true);
  });
  it('counts shared hooks once per object and drops a render-target envMap', () => {
    const root = new THREE.Group();
    const geo = new THREE.BufferGeometry();
    const m = new THREE.MeshStandardMaterial({ name: 'unit' });
    m.onBeforeCompile = () => {};
    const env = new THREE.Texture();
    (env as THREE.Texture & { isRenderTargetTexture: boolean }).isRenderTargetTexture = true;
    m.envMap = env;
    root.add(new THREE.Mesh(geo, m), new THREE.Mesh(geo, m));
    const found = censusUnported(root);
    expect(found.find((h) => h.kind === 'on-before-compile')?.objects).toBe(2);
    expect(found.some((h) => h.kind === 'env-map')).toBe(true);
    expect(m.envMap).toBeNull();
  });
  it('warns once per hook, and the warning names it', () => {
    const seen = new Set<string>();
    const hook = [{ kind: 'on-before-compile' as const, key: 'team-mask', objects: 3 }];
    const first = unportedWarnings(hook, seen);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatch(/UNPORTED on-before-compile "team-mask" \(3 objects\)/);
    expect(unportedWarnings(hook, seen)).toEqual([]);
  });
  it('a clean scene reports nothing', () => {
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial()));
    expect(censusUnported(root)).toEqual([]);
    const spy = vi.fn();
    for (const l of unportedWarnings(censusUnported(root), new Set())) spy(l);
    expect(spy).not.toHaveBeenCalled();
  });
});
