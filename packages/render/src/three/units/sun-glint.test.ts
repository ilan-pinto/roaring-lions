/**
 * GH-1361 slice 1: the sun-glint lobe. Oracles are LITERALS (the lead's D5 numbers: gain 2, a ~10 degree cone), never imports of
 * what is under test.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { HDR_GAINS } from './hdr-gains';
import { SUN_GLINT_SEGMENT } from '../material-names';
import {
  applySunGlint,
  carrySunGlint,
  isSunGlintMaterial,
  patchSunGlint,
  setSunGlintPass,
  stepSunGlint,
  SUN_GLINT_CLASSES,
  SUN_GLINT_CONE_DEG,
  SUN_GLINT_COS,
  SUN_GLINT_GLSL,
  SUN_GLINT_PROGRAM_KEY,
  sunGlintAdd,
  sunGlintGainNow,
  sunGlintLobe,
  sunGlintUniforms,
  surfaceGlints,
} from './sun-glint';
import { surfaceCloneCount, surfaceMaterialFor, sunGlintCloneCount, type SurfaceClass } from './unit-surface';
import { applyRainRim } from './rain-rim';

afterEach(() => setSunGlintPass(true));

const ALL_CLASSES: readonly SurfaceClass[] = ['cloth', 'leather', 'skin', 'wood', 'gear', 'gunmetal', 'armour', 'plate', 'rubber', 'glass'];

/** A shader stub holding the one chunk anchor the patch needs. */
const shaderStub = (): { fragmentShader: string; uniforms: Record<string, { value: number }> } => ({
  fragmentShader: '#include <common>\n#include <lights_physical_pars_fragment>\nvoid main() {}',
  uniforms: {},
});

describe('the numbers (the lead\'s ruling D5, 16 Nov 2026)', () => {
  it('gain 2 on the sun, a 10 degree cone, and the program segment names agree', () => {
    expect(HDR_GAINS.sunGlint).toBe(2);
    expect(SUN_GLINT_CONE_DEG).toBe(10);
    expect(SUN_GLINT_COS).toBeCloseTo(0.984807753, 8);
    expect(SUN_GLINT_PROGRAM_KEY).toBe('rl-sun-glint');
    expect(SUN_GLINT_SEGMENT).toBe(SUN_GLINT_PROGRAM_KEY);
  });
});

describe('which classes glint', () => {
  it('exactly glass and gunmetal, out of every class', () => {
    expect(ALL_CLASSES.filter(surfaceGlints).sort()).toEqual(['glass', 'gunmetal']);
    expect([...SUN_GLINT_CLASSES].sort()).toEqual(['glass', 'gunmetal']);
  });

  it('on the real clone path: weapons, vehicle metal and glass take the lobe; cloth, armour, plate, rubber, skin do not', () => {
    const glinting = ['weapon', 'metal', 'turret_metal', 'cab_glass', 'canopy_glass'];
    const plain = ['uniform', 'webbing', 'boot', 'face', 'hull_hull', 'hull_plate', 'hull_rubber', 'wood'];
    for (const role of glinting) {
      const m = surfaceMaterialFor(new THREE.MeshStandardMaterial(), role) as THREE.MeshStandardMaterial;
      expect(isSunGlintMaterial(m), role).toBe(true);
      expect(m.customProgramCacheKey(), role).toContain(SUN_GLINT_PROGRAM_KEY);
    }
    for (const role of plain) {
      const m = surfaceMaterialFor(new THREE.MeshStandardMaterial(), role) as THREE.MeshStandardMaterial;
      expect(isSunGlintMaterial(m), role).toBe(false);
      expect(m.customProgramCacheKey(), role).not.toContain(SUN_GLINT_PROGRAM_KEY);
    }
    // An unclassified role (a building, a kit part, a swarm drone's own batch material) is the base itself, untouched.
    const base = new THREE.MeshStandardMaterial();
    expect(surfaceMaterialFor(base, 'frame_cut')).toBe(base);
    expect(isSunGlintMaterial(base)).toBe(false);
  });

  it('a rain rim clone of a weapon keeps both segments, and the rim hook still runs', () => {
    const m = surfaceMaterialFor(new THREE.MeshStandardMaterial(), 'weapon', undefined, undefined, true) as THREE.MeshStandardMaterial;
    expect(m.customProgramCacheKey()).toContain('rl-unit-rain-rim');
    expect(m.customProgramCacheKey()).toContain(SUN_GLINT_PROGRAM_KEY);
    const shader = { fragmentShader: '#include <common>\n#include <emissivemap_fragment>\n#include <lights_physical_pars_fragment>', uniforms: {} as Record<string, unknown> };
    m.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer);
    expect(shader.fragmentShader).toContain('uRimGain');
    expect(shader.fragmentShader).toContain('RE_Direct_Glint');
  });

  it('counts the clones it reached (what the glint layer reports)', () => {
    const before = sunGlintCloneCount();
    surfaceMaterialFor(new THREE.MeshStandardMaterial(), 'weapon');
    surfaceMaterialFor(new THREE.MeshStandardMaterial(), 'uniform');
    expect(sunGlintCloneCount()).toBe(before + 1);
    expect(surfaceCloneCount()).toBeGreaterThanOrEqual(2);
  });
});

describe('the lobe (TS mirror, literal oracles)', () => {
  it('is 1 near the mirror direction, 0 outside the cone, and rises smoothly between', () => {
    expect(sunGlintLobe(1, 1)).toBe(1);
    expect(sunGlintLobe(0.999, 0.5)).toBe(1);
    expect(sunGlintLobe(0.9848, 0.5)).toBeCloseTo(0, 3); // 10 degrees: the cone's edge
    expect(sunGlintLobe(0.97, 0.5)).toBe(0); // 14 degrees
    expect(sunGlintLobe(0, 0.5)).toBe(0);
    // The upper edge is cos + 0.6 (1 - cos) = 0.99088; halfway up the smoothstep (t = 0.5) is exactly 0.5.
    expect(sunGlintLobe(0.9848077 + 0.3 * (1 - 0.9848077), 0.5)).toBeCloseTo(0.5, 4);
  });

  it('is 0 on the far side of the light, and a lined-up barrel reads gain 2 over the sun (pre-bloom over 1)', () => {
    expect(sunGlintLobe(1, -0.01)).toBe(0);
    expect(sunGlintAdd(1, 0.5, 2)).toBe(2);
    expect(sunGlintAdd(1, 0.5, 0)).toBe(0);
  });
});

describe('the shader patch', () => {
  it('splices the wrapper after the physical-lights chunk and makes the wrapper the RE_Direct', () => {
    const out = patchSunGlint(shaderStub().fragmentShader);
    expect(out.indexOf('#include <lights_physical_pars_fragment>')).toBeLessThan(out.indexOf('RE_Direct_Glint'));
    expect(out).toContain('#define RE_Direct RE_Direct_Glint');
    expect(out).toContain('RE_Direct_Physical(');
  });

  it('is restricted to the sun: the directional loop and directionalLights[ 0 ]', () => {
    expect(SUN_GLINT_GLSL).toContain('#if NUM_DIR_LIGHTS > 0');
    expect(SUN_GLINT_GLSL).toContain('directionalLights[ 0 ].direction');
  });

  it('the GLSL is the TS mirror, term for term (the shader cannot run here, so the lines it must contain are pinned literally)', () => {
    expect(SUN_GLINT_GLSL).toContain('vec3 rlGlintH = normalize( directLight.direction + geometryViewDir );');
    expect(SUN_GLINT_GLSL).toContain('float rlGlintLobe = smoothstep( uGlintCos, mix( uGlintCos, 1.0, 0.6 ), rlGlintNH );');
    expect(SUN_GLINT_GLSL).toContain(
      'reflectedLight.directSpecular += directLight.color * ( uGlintGain * rlGlintLobe * step( 0.0, dot( geometryNormal, directLight.direction ) ) );'
    );
  });

  it('uses the colour three has already shadowed (the lobe multiplies directLight.color and reads no shadow of its own)', () => {
    expect(SUN_GLINT_GLSL).toContain('directLight.color *');
    expect(SUN_GLINT_GLSL).not.toMatch(/getShadow/);
    // three multiplies the shadow into directLight.color before it calls RE_Direct, in the directional loop the wrapper rides.
    const begin = THREE.ShaderChunk.lights_fragment_begin;
    expect(begin).toMatch(/directLight\.color \*= \( directLight\.visible && receiveShadow \) \? getShadow\(/);
  });

  it('matches the chunk three really ships: RE_Direct_Physical\'s signature and the directionalLights array', () => {
    const phys = THREE.ShaderChunk.lights_physical_pars_fragment;
    expect(phys).toContain('void RE_Direct_Physical( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight )');
    expect(phys).toContain('#define RE_Direct\t\t\t\tRE_Direct_Physical');
    expect(THREE.ShaderChunk.lights_pars_begin).toContain('uniform DirectionalLight directionalLights[ NUM_DIR_LIGHTS ]');
  });

  it('throws on a shader with no anchor (three renamed its chunks) instead of silently drawing no glint', () => {
    expect(() => patchSunGlint('void main() {}')).toThrow(/lights_physical_pars_fragment/);
  });
});

describe('the flag: the glint layer', () => {
  it('setSunGlintPass(false) zeroes the gain every shader reads, and true restores gain 2', () => {
    const u = sunGlintUniforms();
    setSunGlintPass(true);
    expect(u.gain.value).toBe(2);
    setSunGlintPass(false);
    expect(u.gain.value).toBe(0);
    expect(sunGlintGainNow()).toBe(0);
    setSunGlintPass(true);
    expect(u.gain.value).toBe(2);
  });

  it('holds across the per-frame write: a stray writer cannot turn a hidden glint back on', () => {
    const u = sunGlintUniforms();
    setSunGlintPass(false);
    u.gain.value = 2; // some other writer
    stepSunGlint(); // the frame's write CONSULTS the flag
    expect(u.gain.value).toBe(0);
    setSunGlintPass(true);
    u.gain.value = 0;
    stepSunGlint();
    expect(u.gain.value).toBe(2);
  });

  it('writes the cone too, so the cos is the one the lobe mirror reads', () => {
    const u = sunGlintUniforms();
    u.cos.value = 0.5;
    stepSunGlint();
    expect(u.cos.value).toBe(SUN_GLINT_COS);
  });
});

describe('Material.clone drops the hook: every clone site carries it (the carryTeamMark rule)', () => {
  const glintBase = (): THREE.MeshStandardMaterial => {
    const m = new THREE.MeshStandardMaterial();
    applySunGlint(m);
    return m;
  };
  const run = (m: THREE.MeshStandardMaterial): string => {
    const shader = shaderStub();
    m.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer);
    return shader.fragmentShader;
  };

  it('a plain clone loses the hook (the premise), carrySunGlint restores it with the key', () => {
    const base = glintBase();
    const clone = base.clone();
    expect(run(clone)).not.toContain('RE_Direct_Glint');
    expect(clone.customProgramCacheKey()).not.toContain(SUN_GLINT_PROGRAM_KEY);
    carrySunGlint(clone, base);
    expect(run(clone)).toContain('RE_Direct_Glint');
    expect(clone.customProgramCacheKey()).toContain(SUN_GLINT_PROGRAM_KEY);
  });

  it('a running-gear shaped clone (key copied from the base, own hook) gets the patch without a doubled key', () => {
    const base = glintBase();
    const key = base.customProgramCacheKey();
    const clone = base.clone();
    clone.customProgramCacheKey = () => `${key}|rl-running-gear-1`;
    clone.onBeforeCompile = (s) => {
      s.fragmentShader = s.fragmentShader.replace('void main() {}', 'void main() { /* tread */ }');
    };
    carrySunGlint(clone, base);
    const out = run(clone);
    expect(out).toContain('RE_Direct_Glint');
    expect(out).toContain('/* tread */'); // its own hook still runs, first
    expect(clone.customProgramCacheKey().split(SUN_GLINT_PROGRAM_KEY).length - 1).toBe(1);
  });

  it('is idempotent, and a no-op for a source that never glinted', () => {
    const base = glintBase();
    const clone = base.clone();
    carrySunGlint(clone, base);
    const key = clone.customProgramCacheKey();
    carrySunGlint(clone, base);
    expect(clone.customProgramCacheKey()).toBe(key);
    const plain = new THREE.MeshStandardMaterial();
    const plainClone = plain.clone();
    carrySunGlint(plainClone, plain);
    expect(isSunGlintMaterial(plainClone)).toBe(false);
    expect(plainClone.customProgramCacheKey()).not.toContain(SUN_GLINT_PROGRAM_KEY);
  });

  it('chains a rim hook the base already had', () => {
    const base = new THREE.MeshStandardMaterial();
    applyRainRim(base);
    applySunGlint(base);
    expect(base.customProgramCacheKey()).toContain('rl-unit-rain-rim');
    expect(base.customProgramCacheKey()).toContain(SUN_GLINT_PROGRAM_KEY);
  });
});
