/**
 * GH-1361 slice 1, review fixes: every REAL clone site keeps the glint (a scar band, a death fade, a running-gear clone), the support
 * helicopter has none (ruling D7), and a settled corpse has none (the fog pass dims only 0.4 before bloom).
 */
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { applySunGlint, isSunGlintMaterial, SUN_GLINT_PROGRAM_KEY, sunGlintUniforms, setSunGlintPass } from './sun-glint';
import { VehicleScarMaterials } from './vehicle-damage';
import { beginMeshDeathFade, pushMeshWreck, type MeshWreck } from './mesh-death';
import { runningGearMaterial } from './running-gear-material';
import { parseRunningGear, type RunningGearSpec } from './running-gear';
import { buildVehicleMeshTemplate } from './mesh-vehicle';
import { surfaceMaterialFor, SUPPORT_SURFACES } from './unit-surface';
import { applyRainRim } from './rain-rim';

const SPEC = parseRunningGear(
  { rl_running_gear: { version: 1, wheels: [{ side: 'r', index: 0, centre: [1, 0.4, 0.9], radius: 0.4, cutRadius: 0.41, steer: false, maxSteerRad: 0 }], tracks: [] } },
  'fixture'
) as RunningGearSpec;

const glintBase = (): THREE.MeshStandardMaterial => {
  const m = new THREE.MeshStandardMaterial();
  applySunGlint(m);
  return m;
};
/** What the program would be compiled from: three's own meshphysical fragment, then the material's hook. */
function compile(m: THREE.Material): { fragmentShader: string; uniforms: Record<string, { value: unknown }> } {
  const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: THREE.ShaderChunk.meshphysical_vert, fragmentShader: THREE.ShaderChunk.meshphysical_frag };
  m.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
  return { fragmentShader: shader.fragmentShader, uniforms: shader.uniforms };
}
const glints = (m: THREE.Material): boolean => compile(m).fragmentShader.includes('RE_Direct_Glint') && m.customProgramCacheKey().includes(SUN_GLINT_PROGRAM_KEY);

describe('the clone sites keep the glint (through the real calls)', () => {
  it('a scar band', () => {
    const base = glintBase();
    const scarred = new VehicleScarMaterials().materialFor(base, 3);
    expect(scarred).not.toBe(base);
    expect(glints(scarred)).toBe(true);
  });

  it('a death fade', () => {
    const base = glintBase();
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BufferGeometry(), base));
    const [swap] = beginMeshDeathFade(root);
    expect(swap.fade).not.toBe(base);
    expect(glints(swap.fade)).toBe(true);
  });

  it('a running-gear clone of a glint base (its key already names glint; the patch must still be there, once)', () => {
    const base = glintBase();
    const { material } = runningGearMaterial(base, SPEC);
    expect(glints(material)).toBe(true);
    expect(material.customProgramCacheKey().split(SUN_GLINT_PROGRAM_KEY).length - 1).toBe(1);
    expect(compile(material).uniforms.uRgAxle).toBeDefined(); // the tread's own hook still runs
  });
});

describe('the support helicopter does not glint (ruling D7)', () => {
  const gltf = (): { scene: THREE.Group } => {
    const scene = new THREE.Group();
    for (const name of ['glass', 'metal']) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
      mesh.name = name;
      mesh.userData = { rl_role: name };
      scene.add(mesh);
    }
    return { scene };
  };
  const drawn = (t: ReturnType<typeof buildVehicleMeshTemplate>): THREE.Material[] => t.materials.filter((m) => (m as THREE.MeshStandardMaterial).isMeshStandardMaterial);

  it('SUPPORT_SURFACES clones of glass and gunmetal carry no glint; the default table still does', () => {
    for (const role of ['cab_glass', 'weapon']) {
      expect(isSunGlintMaterial(surfaceMaterialFor(new THREE.MeshStandardMaterial(), role, undefined, SUPPORT_SURFACES))).toBe(false);
      expect(isSunGlintMaterial(surfaceMaterialFor(new THREE.MeshStandardMaterial(), role))).toBe(true);
    }
  });

  it('SupportAircraft.load builds the helicopter template with that table (the real call)', async () => {
    vi.resetModules();
    vi.doMock('./gltf-loader', async (orig) => {
      const real = await orig<typeof import('./gltf-loader')>();
      return { ...real, coldGltfLoader: () => ({ loadAsync: () => Promise.reject(new Error('no jet in this test')) }) };
    });
    vi.doMock('./mesh-vehicle', async (orig) => {
      const real = await orig<typeof import('./mesh-vehicle')>();
      return {
        ...real,
        loadVehicleMeshTemplate: async (_url: string, id: string, allowTextured?: boolean, tiers?: unknown, _cold?: boolean, surfaces?: never) =>
          real.buildVehicleMeshTemplate(gltf() as never, id, allowTextured, tiers as never, surfaces),
      };
    });
    const errs: unknown[][] = [];
    const err = vi.spyOn(console, 'error').mockImplementation((...a) => { errs.push(a); });
    const { SupportAircraftManager } = await import('./support-aircraft');
    const m = new SupportAircraftManager(0xffffff);
    await m.load('heli.glb', 'jet.glb');
    const template = (m as unknown as { heliTemplate: ReturnType<typeof buildVehicleMeshTemplate> | null }).heliTemplate;
    expect(template, JSON.stringify(errs.map((a) => a.map(String)))).not.toBeNull();
    const mats = drawn(template as ReturnType<typeof buildVehicleMeshTemplate>);
    expect(mats.length).toBeGreaterThan(0);
    for (const mat of mats) expect(isSunGlintMaterial(mat)).toBe(false);
    m.dispose();
    err.mockRestore();
    vi.doUnmock('./gltf-loader');
    vi.doUnmock('./mesh-vehicle');
  });
});

describe('a settled corpse does not glint (fog: explored but unseen ground)', () => {
  const corpse = (mat: THREE.Material): MeshWreck => {
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BufferGeometry(), mat));
    return { root, x: 1, y: 1, shown: true };
  };

  it('pushMeshWreck swaps in a twin whose compiled gain is the constant 0, while the live material still reads the shared gain', () => {
    setSunGlintPass(true);
    const live = glintBase();
    const w = corpse(live);
    pushMeshWreck([], w, new THREE.Scene());
    const dead = (w.root.children[0] as THREE.Mesh).material as THREE.Material;
    expect(dead).not.toBe(live);
    expect(compile(live).uniforms.uGlintGain).toBe(sunGlintUniforms().gain);
    expect(sunGlintUniforms().gain.value).toBe(2);
    expect((compile(dead).uniforms.uGlintGain as { value: number }).value).toBe(0);
    // Still the same program (the lobe is present, bound to 0), and idempotent.
    expect(dead.customProgramCacheKey()).toBe(live.customProgramCacheKey());
    pushMeshWreck([], w, new THREE.Scene());
    expect((w.root.children[0] as THREE.Mesh).material).toBe(dead);
  });

  it('keeps every other hook the live material had (a rain rim)', () => {
    const live = new THREE.MeshStandardMaterial();
    applyRainRim(live);
    applySunGlint(live);
    const w = corpse(live);
    pushMeshWreck([], w, new THREE.Scene());
    const dead = (w.root.children[0] as THREE.Mesh).material as THREE.Material;
    expect(compile(dead).fragmentShader).toContain('uRimGain');
    expect((compile(dead).uniforms.uGlintGain as { value: number }).value).toBe(0);
  });

  it('leaves a material with no glint alone', () => {
    const plain = new THREE.MeshStandardMaterial();
    const w = corpse(plain);
    pushMeshWreck([], w, new THREE.Scene());
    expect((w.root.children[0] as THREE.Mesh).material).toBe(plain);
  });
});
