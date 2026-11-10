import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { censusKey, censusUnadopted, censusUnported, reassertCensusHides, type CensusHides, PORTED_MATERIAL_KEYS, UNPORTED_TERMS_KEY, unportedWarnings } from './unported';

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

/** A unit-like hooked material: the stock program key plus `segments`, as the five unit hooks compose theirs. */
function chained(name: string, segments: readonly string[]): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ name });
  const stock = m.customProgramCacheKey();
  m.onBeforeCompile = () => {};
  m.customProgramCacheKey = () => [stock, ...segments].join('|');
  return m;
}

/**
 * GH-943 P3 (T1), G4: the census names each hook. A unit hook's key is 65+ characters, so P2's rule fell back to the GLB material
 * name (`BakedMaterial`) and could not say which hook a moving hull lacked. With `portedKeys`, a hooked material is exempt only
 * when EVERY segment is listed. Falsify: `segments.some(...)` for `segments.every(...)` in `isPorted`: the one-listed case goes red.
 */
describe('G4: the census keys a hooked material by its segments, and exempts it only when every segment is ported', () => {
  it('stock|rl-team-mark-2|rl-running-gear-1 keys as rl-team-mark-2|rl-running-gear-1, not as its GLB name', () => {
    const m = chained('BakedMaterial', ['rl-team-mark-2', 'rl-running-gear-1']);
    expect(m.customProgramCacheKey().length).toBeGreaterThan(60);
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), m);
    expect(censusKey(m, mesh)).toBe('rl-team-mark-2|rl-running-gear-1');
    const root = new THREE.Group();
    root.add(mesh);
    expect(censusUnported(root).map((h) => `${h.kind}:${h.key}`)).toEqual(['on-before-compile:rl-team-mark-2|rl-running-gear-1']);
  });

  it('one segment listed: still reported; both listed: exempt', () => {
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BufferGeometry(), chained('BakedMaterial', ['rl-team-mark-2', 'rl-running-gear-1'])));
    expect(censusUnported(root, { portedKeys: new Set(['rl-team-mark-2']) }).map((h) => h.key)).toEqual(['rl-team-mark-2|rl-running-gear-1']);
    expect(censusUnported(root, { portedKeys: new Set(['rl-team-mark-2', 'rl-running-gear-1']) })).toEqual([]);
  });

  it('a material with no segment keeps its P2 key (a named ShaderMaterial, a short hook key)', () => {
    const shader = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.ShaderMaterial({ name: 'rl-decal' }));
    expect(censusKey(shader.material, shader)).toBe('rl-decal');
    const plain = new THREE.MeshStandardMaterial({ name: 'ground' });
    plain.onBeforeCompile = () => {};
    const o = new THREE.Mesh(new THREE.BufferGeometry(), plain);
    expect(censusKey(plain, o)).toBe('ground');
  });
});

/**
 * GH-943 P3 (T1): the census backstop. A material whose slot HAS a factory but which is still on a mesh is `unadopted`, keyed by
 * `censusKey`, and its log line is `[lions] UNADOPTED`. Falsify: return `[]` from `censusUnadopted`: both specs go red.
 */
describe('the unadopted census', () => {
  it('names every adoptable material still on a mesh, once per key, and mutates nothing', () => {
    const root = new THREE.Group();
    const hull = chained('BakedMaterial', ['rl-team-mark-2']);
    const a = new THREE.Mesh(new THREE.BufferGeometry(), hull);
    const b = new THREE.Mesh(new THREE.BufferGeometry(), hull);
    const other = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial());
    root.add(a, b, other);
    const found = censusUnadopted(root, (m) => m === hull);
    expect(found).toEqual([{ kind: 'unadopted', key: 'rl-team-mark-2', objects: 2 }]);
    expect([a.visible, b.visible, other.visible]).toEqual([true, true, true]);
  });

  it('its warning line is [lions] UNADOPTED', () => {
    const lines = unportedWarnings([{ kind: 'unadopted', key: 'rl-running-gear-1', objects: 1 }], new Set());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[lions\] UNADOPTED "rl-running-gear-1" \(1 object\): /);
  });
});

describe('T2b (P3-R13): a census hide holds against a per-frame writer', () => {
  const geo = new THREE.BufferGeometry();
  it('G1: a writer re-shows a census-hidden mesh, and the re-assert hides it again', () => {
    const root = new THREE.Group();
    const xray = new THREE.Mesh(geo, new THREE.ShaderMaterial({ name: 'rl-xray-tube' }));
    root.add(xray);
    const hides: CensusHides = new Set();
    censusUnported(root, { hides });
    expect(xray.visible).toBe(false);
    xray.visible = true; // the per-frame writer (tunnel x-ray, flipbook)
    expect(reassertCensusHides(hides, root)).toBe(1);
    expect(xray.visible).toBe(false);
  });
  it('G2: an object adopted since (its material is now a twin) and one the census never hid are not hidden', () => {
    const root = new THREE.Group();
    const ported = new THREE.Mesh(geo, new THREE.ShaderMaterial({ name: 'rl-ported' }));
    const adopted: THREE.Mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({ name: 'rl-fx-particle' }));
    const bystander = new THREE.Mesh(geo, new THREE.ShaderMaterial({ name: 'rl-ported' }));
    root.add(ported, adopted, bystander);
    const hides: CensusHides = new Set();
    // The census on a scene where 'rl-ported' is a ported key hides neither of those; only the unported one is hidden.
    censusUnported(root, { portedKeys: new Set(['rl-ported']), hides });
    expect([ported.visible, adopted.visible, bystander.visible]).toEqual([true, false, true]);
    (adopted as THREE.Mesh).material = new THREE.MeshBasicMaterial(); // its twin is adopted: drawn
    adopted.visible = true;
    expect(reassertCensusHides(hides, root, { portedKeys: new Set(['rl-ported']) })).toBe(0);
    expect([ported.visible, adopted.visible, bystander.visible]).toEqual([true, true, true]);
    expect(hides.has(adopted)).toBe(false);
  });
  it('G3: an object that left the scene is dropped from the set', () => {
    const root = new THREE.Group();
    const m = new THREE.Mesh(geo, new THREE.ShaderMaterial({ name: 'rl-xray-tube' }));
    root.add(m);
    const hides: CensusHides = new Set();
    censusUnported(root, { hides });
    root.remove(m);
    reassertCensusHides(hides, root);
    expect(hides.size).toBe(0);
  });
  it('G4: the node backend re-asserts the hides at the top of render, before its census', () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'node-backend.ts'), 'utf8');
    const render = src.slice(src.indexOf('    render(scene, camera) {'));
    expect(render.indexOf('reassertCensusHides(censusHides, scene)')).toBeGreaterThan(-1);
    expect(render.indexOf('reassertCensusHides(censusHides, scene)')).toBeLessThan(render.indexOf('runCensus(scene)'));
    expect(src).toMatch(/censusUnported\(scene, \{ hides: censusHides \}\)/);
  });
});
