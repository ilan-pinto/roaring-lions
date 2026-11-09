import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { censusUnported, PORTED_MATERIAL_KEYS, UNPORTED_TERMS_KEY, unportedWarnings } from './unported';

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

/** A ring-like legacy material: a `ShaderMaterial` named with `key`, never passed through the kit. */
const ringLike = (key: string): THREE.ShaderMaterial => new THREE.ShaderMaterial({ name: key });

/** Runs `body` with `key` on `PORTED_MATERIAL_KEYS` (empty until T3/T5/T6 append), then takes it off again. */
function withListedKey(key: string, body: () => void): void {
  const keys = PORTED_MATERIAL_KEYS as Set<string>;
  keys.add(key);
  try {
    body();
  } finally {
    keys.delete(key);
  }
}

describe('GH-943 P2 (T1): the partial census and the ported-key exemption', () => {
  it('names every term a twin declares it does not draw, once per term, as a partial hook', () => {
    const root = new THREE.Group();
    const geo = new THREE.BufferGeometry();
    const twin = new THREE.MeshStandardMaterial({ name: 'ground-twin' });
    twin.userData[UNPORTED_TERMS_KEY] = ['rl-ground: wet terms', 'rl-ground: marsh'];
    const sway = new THREE.MeshStandardMaterial({ name: 'foliage-twin' });
    sway.userData[UNPORTED_TERMS_KEY] = ['rl-foliage-sway: disturb'];
    root.add(new THREE.Mesh(geo, twin), new THREE.Mesh(geo, twin), new THREE.Mesh(geo, sway));
    const found = censusUnported(root);
    expect(found.map((h) => `${h.kind}:${h.key}:${h.objects}`)).toEqual([
      'partial:rl-foliage-sway: disturb:1',
      'partial:rl-ground: marsh:2',
      'partial:rl-ground: wet terms:2',
    ]);
    const lines = unportedWarnings(found, new Set());
    expect(lines).toHaveLength(3);
    expect(lines[2]).toMatch(/^\[lions\] UNPORTED partial "rl-ground: wet terms" \(2 objects\): the node twin draws its material WITHOUT this term$/);
  });

  it('with { portedKeys } (the legacy-matched call), a listed key stays visible and unreported; a key off the list is still hidden', () => {
    const root = new THREE.Group();
    const geo = new THREE.BufferGeometry();
    const listed = new THREE.Mesh(geo, ringLike('rl-ring-fixture'));
    const unlisted = new THREE.Mesh(geo, ringLike('rl-other-fixture'));
    const hooked = new THREE.MeshStandardMaterial({ name: 'rl-ground-fixture' });
    hooked.onBeforeCompile = () => {};
    const ground = new THREE.Mesh(geo, hooked);
    root.add(listed, unlisted, ground);
    const found = censusUnported(root, { portedKeys: new Set(['rl-ring-fixture', 'rl-ground-fixture']) });
    expect(found.map((h) => `${h.kind}:${h.key}`)).toEqual(['shader-material:rl-other-fixture']);
    expect(listed.visible).toBe(true);
    expect(unlisted.visible).toBe(false);
    expect(ground.visible).toBe(true);
  });

  it("WITHOUT the option (the node backend's own census), an un-adopted ShaderMaterial whose key IS on PORTED_MATERIAL_KEYS is still hidden and named", () => {
    withListedKey('rl-ring-fixture', () => {
      const root = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.BufferGeometry(), ringLike('rl-ring-fixture'));
      root.add(ring);
      expect(censusUnported(root).map((h) => `${h.kind}:${h.key}`)).toEqual(['shader-material:rl-ring-fixture']);
      expect(ring.visible).toBe(false);
    });
  });

  it('an unnamed ShaderMaterial is keyed by its object, never by the stock program-key text every unnamed one shares', () => {
    const root = new THREE.Group();
    const a = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.ShaderMaterial());
    a.name = 'quad-a';
    const b = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.ShaderMaterial());
    b.name = 'quad-b';
    root.add(a, b);
    expect(censusUnported(root).map((h) => h.key)).toEqual(['quad-a', 'quad-b']);
  });
});
