/**
 * GH-943 P3 (T1): `twin-identity.ts`, the legacy material behind a twin, and the render state a twin copies.
 *
 * - `legacyOf`: a legacy material is itself; a twin resolves to the mesh's own record first (ruling P3-R2), then its own key; a
 *   stale mesh record (the mesh now holds another twin) is ignored. Records never ride a clone.
 *   Falsify: read only the twin's key in `legacyOf` (`return own as M;` first): the mesh-record specs go red.
 * - G6: `RENDER_STATE_KEYS` against a LITERAL list, a legacy material with every field non-default copies whole, and every
 *   stencil / depth-function / blend / polygon-offset MATERIAL field a legacy source sets is on the list.
 *   Falsify: delete `'stencilZFail'` from `RENDER_STATE_KEYS`: all three go red.
 * - G9: `twin-identity.ts` and `material-names.ts` import NOTHING (three-free, no `.node.ts`, no `material-maths.ts`).
 *   Falsify: add `import { MATERIAL_MATHS } from './material-maths';` to `twin-identity.ts`.
 * - Ruling P3-R3: `mirrorLegacyFields` on a SHARED twin leaves opacity, colour, roughness and metalness alone.
 *   Falsify: drop the `shared &&` skip.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  copyRenderState,
  legacyBaseOf,
  legacyMaterialOf,
  legacyOf,
  markTwin,
  mirrorLegacyFields,
  recordAdoption,
  recordLegacyBase,
  RENDER_STATE_KEYS,
  TWIN_LEGACY_KEY,
} from './twin-identity';

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe('legacyOf', () => {
  it('a legacy material is itself; a twin with no mesh is its own record', () => {
    const legacy = new THREE.MeshStandardMaterial();
    const twin = new THREE.MeshBasicMaterial();
    expect(legacyOf(legacy)).toBe(legacy);
    markTwin(twin, legacy);
    expect(legacyOf(twin)).toBe(legacy);
  });

  it('ruling P3-R2: two meshes sharing one twin, each adopted from its own legacy material, each resolve to their own', () => {
    const base = new THREE.MeshStandardMaterial({ name: 'template' });
    const scarA = new THREE.MeshStandardMaterial({ name: 'scar-band-4' });
    const scarB = new THREE.MeshStandardMaterial({ name: 'scar-band-2' });
    const shared = new THREE.MeshBasicMaterial();
    markTwin(shared, base);
    const a = new THREE.Mesh(new THREE.BufferGeometry(), shared);
    const b = new THREE.Mesh(new THREE.BufferGeometry(), shared);
    recordAdoption(a, scarA, shared);
    recordAdoption(b, scarB, shared);
    expect(legacyOf(shared, a)).toBe(scarA);
    expect(legacyOf(shared, b)).toBe(scarB);
    expect(legacyMaterialOf(a)).toBe(scarA);
  });

  it('a stale mesh record (the mesh now holds a different twin) falls back to the twin\'s own record', () => {
    const base = new THREE.MeshStandardMaterial();
    const rgClone = new THREE.MeshStandardMaterial();
    const rgTwin = new THREE.MeshBasicMaterial();
    const baseTwin = new THREE.MeshBasicMaterial();
    markTwin(rgTwin, base);
    markTwin(baseTwin, base);
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), rgTwin);
    recordAdoption(mesh, rgClone, rgTwin);
    mesh.material = baseTwin;
    expect(legacyOf(baseTwin, mesh)).toBe(base);
  });

  it('records are non-enumerable: a cloned mesh, a cloned material and toJSON carry none of them', () => {
    const legacy = new THREE.MeshStandardMaterial();
    const twin = new THREE.MeshBasicMaterial();
    markTwin(twin, legacy);
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), twin);
    recordAdoption(mesh, legacy, twin);
    recordLegacyBase(legacy, new THREE.MeshStandardMaterial());
    expect(mesh.clone().userData[TWIN_LEGACY_KEY]).toBeUndefined();
    expect(twin.clone().userData[TWIN_LEGACY_KEY]).toBeUndefined();
    expect(Object.keys(legacy.clone().userData)).toEqual([]);
    expect(JSON.stringify(mesh.userData)).toBe('{}');
    // The clone of a template mesh shares the twin by reference and resolves to the template, through the twin's record.
    const cloned = mesh.clone();
    expect(legacyOf(cloned.material as THREE.Material, cloned)).toBe(legacy);
  });

  it('legacyBaseOf follows the clone chain to its root', () => {
    const template = new THREE.MeshStandardMaterial();
    const scar = new THREE.MeshStandardMaterial();
    const fade = new THREE.MeshStandardMaterial();
    recordLegacyBase(scar, template);
    recordLegacyBase(fade, scar);
    expect(legacyBaseOf(fade)).toBe(template);
    expect(legacyBaseOf(template)).toBe(template);
  });
});

/** G6: the list, literal. */
const EXPECTED_RENDER_STATE_KEYS = [
  'side',
  'transparent',
  'depthTest',
  'depthWrite',
  'depthFunc',
  'blending',
  'blendSrc',
  'blendDst',
  'blendEquation',
  'blendSrcAlpha',
  'blendDstAlpha',
  'blendEquationAlpha',
  'polygonOffset',
  'polygonOffsetFactor',
  'polygonOffsetUnits',
  'stencilWrite',
  'stencilFunc',
  'stencilRef',
  'stencilFuncMask',
  'stencilWriteMask',
  'stencilFail',
  'stencilZFail',
  'stencilZPass',
  'alphaTest',
  'vertexColors',
];

/** Production legacy sources under `three/`: no spec, no twin (`.node.ts`), no spike. */
function legacySources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== 'spike') legacySources(p, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.node.ts')) out.push(p);
  }
  return out;
}

describe('G6: render state copies whole', () => {
  it('RENDER_STATE_KEYS is the literal list', () => {
    expect([...RENDER_STATE_KEYS]).toEqual(EXPECTED_RENDER_STATE_KEYS);
  });

  it('a legacy material with every field non-default gives a twin equal on all of them', () => {
    const legacy = new THREE.ShaderMaterial();
    const fresh = new THREE.MeshBasicMaterial();
    Object.assign(legacy, {
      side: THREE.BackSide,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      depthFunc: THREE.GreaterDepth,
      blending: THREE.CustomBlending,
      blendSrc: THREE.DstColorFactor,
      blendDst: THREE.ZeroFactor,
      blendEquation: THREE.SubtractEquation,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      blendEquationAlpha: THREE.ReverseSubtractEquation,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
      stencilWrite: true,
      stencilFunc: THREE.NotEqualStencilFunc,
      stencilRef: 3,
      stencilFuncMask: 0x0f,
      stencilWriteMask: 0xf0,
      stencilFail: THREE.ZeroStencilOp,
      stencilZFail: THREE.ReplaceStencilOp,
      stencilZPass: THREE.InvertStencilOp,
      alphaTest: 0.25,
      vertexColors: true,
    });
    const before = fresh as unknown as Record<string, unknown>;
    // Every one of them differs from a fresh material's default: the copy is what makes them equal.
    for (const k of EXPECTED_RENDER_STATE_KEYS) expect((legacy as unknown as Record<string, unknown>)[k], k).not.toBe(before[k]);
    const twin = new THREE.MeshBasicMaterial();
    copyRenderState(legacy, twin);
    for (const k of EXPECTED_RENDER_STATE_KEYS) {
      expect((twin as unknown as Record<string, unknown>)[k], k).toBe((legacy as unknown as Record<string, unknown>)[k]);
    }
  });

  it('every stencil, depth-function, blend and polygon-offset MATERIAL field a legacy source sets is on the list', () => {
    const material = new THREE.Material() as unknown as Record<string, unknown>;
    const found = new Map<string, string>();
    for (const file of legacySources(HERE)) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/(?:^|[\s{(,.])(stencil\w*|depthFunc|blend\w*|polygonOffset\w*)\s*(?::|=(?!=))/gm)) {
        const field = m[1] as string;
        // Only a field of `THREE.Material` is render state (`blendIntensity` is the AO pass's, `stencilBuffer` a target's).
        if (field in material && !found.has(field)) found.set(field, path.relative(HERE, file));
      }
    }
    // Non-vacuous: the outline's stencil and depth function, and the decal's blend, are found.
    for (const k of ['stencilZFail', 'stencilFuncMask', 'depthFunc', 'blendEquationAlpha', 'polygonOffsetUnits']) expect(found.has(k), k).toBe(true);
    const missing = [...found].filter(([k]) => !(RENDER_STATE_KEYS as readonly string[]).includes(k));
    expect(missing).toEqual([]);
  });
});

describe('G9: the two twin-side modules are three-free and import nothing', () => {
  it.each(['twin-identity.ts', 'material-names.ts'])('%s', (file) => {
    const src = readFileSync(path.join(HERE, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/\bimport\b/);
    expect(src).not.toMatch(/\brequire\s*\(/);
    expect(src).not.toMatch(/['"]three['"]/);
  });
});

describe('ruling P3-R3: a shared twin never mirrors the per-entity fields material-wide', () => {
  it('a 1:1 twin mirrors all of them; a shared twin only the material-wide ones', () => {
    const map = new THREE.Texture();
    const legacy = new THREE.MeshStandardMaterial({ color: 0x336699, roughness: 0.3, metalness: 0.6, opacity: 0.5, transparent: true, map });
    const one = new THREE.MeshStandardMaterial();
    mirrorLegacyFields(legacy, one, false);
    expect(one.color.getHex()).toBe(0x336699);
    expect([one.roughness, one.metalness, one.opacity, one.transparent, one.map]).toEqual([0.3, 0.6, 0.5, true, map]);
    const shared = new THREE.MeshStandardMaterial();
    mirrorLegacyFields(legacy, shared, true);
    expect(shared.color.getHex()).toBe(0xffffff);
    expect([shared.roughness, shared.metalness, shared.opacity]).toEqual([1, 0, 1]);
    expect([shared.transparent, shared.map]).toEqual([true, map]);
  });
});
