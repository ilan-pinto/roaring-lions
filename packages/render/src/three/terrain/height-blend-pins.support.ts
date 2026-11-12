/**
 * GH-1226 S3: shared by `height-blend-pins.test.ts` (L2) and `ThreeRenderer.height-blend-legacy.test.ts` (L3), so the booted renderer's
 * ground is compared with the SAME literals the bare class is. Test support only: nothing ships it.
 */
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GroundMaterial, WET_PROGRAM_TIERS } from './mesh';

/** sha256 of the text, hex, and the length: the length makes a red message say how far the program moved. */
export const digestOf = (text: string): string => `${createHash('sha256').update(text).digest('hex')}:${text.length}`;

/** The standard material's own sources with the ground's injection applied: the text the GPU would compile (`mesh.test.ts`'s seam). */
export function compiledLegacy(material: THREE.Material): { vertexShader: string; fragmentShader: string; uniformNames: string[] } {
  const shader = {
    uniforms: {} as Record<string, THREE.IUniform>,
    vertexShader: THREE.ShaderChunk.meshphysical_vert,
    fragmentShader: THREE.ShaderChunk.meshphysical_frag,
  };
  material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
  return { vertexShader: shader.vertexShader, fragmentShader: shader.fragmentShader, uniformNames: Object.keys(shader.uniforms).sort() };
}

export interface LegacyGroundPin {
  readonly cacheKey: string;
  readonly defines: Record<string, string>;
  readonly vertex: string;
  readonly fragment: string;
  readonly uniforms: string;
}

export const LEGACY_GROUND: Record<string, { make: () => GroundMaterial; pin: LegacyGroundPin }> = {
  dry: {
    make: () => new GroundMaterial(),
    pin: {
      cacheKey: 'rl-ground',
      defines: { STANDARD: '' },
      vertex: 'fae1eccb426cf980ede67ccb41e74ad2b7faacb7eaa8c8222933c902d1e62ec6:1603',
      fragment: '9fca99c03c46f23eb81c2db17b5a7d5d413c83d8fd11ce7fd50a963e4b0fee2f:10515',
      uniforms: '2384047858c07757cdca9b1e402f2f6f4ba9f3869a287ecfa6f9bb43f36edab8:431',
    },
  },
  'wet full': {
    make: () => new GroundMaterial({ wet: true }),
    pin: {
      cacheKey: 'rl-ground-wet',
      defines: { STANDARD: '', THEME_WET: '' },
      vertex: 'fae1eccb426cf980ede67ccb41e74ad2b7faacb7eaa8c8222933c902d1e62ec6:1603',
      fragment: '3606083dbb76fdef2f33e4c3301bea85cb28d9ff18e55f120242ddb50dfccc29:14116',
      uniforms: '8b73b9289b6b13d2ab74d6fc401e7e62e9e7d7fd2c43ba737545a20a9c6683be:530',
    },
  },
  'wet lite': {
    make: () => new GroundMaterial({ wet: true, wetProgram: WET_PROGRAM_TIERS.lite }),
    pin: {
      cacheKey: 'rl-ground-wet-rim-mask-rip1-rough-water',
      defines: { STANDARD: '', THEME_WET: '' },
      vertex: 'fae1eccb426cf980ede67ccb41e74ad2b7faacb7eaa8c8222933c902d1e62ec6:1603',
      fragment: 'f798b29b7c9d1f9a1c5a76dd5de473b46ace07893aac4f8148f8af9564cbe24a:13567',
      uniforms: '8b73b9289b6b13d2ab74d6fc401e7e62e9e7d7fd2c43ba737545a20a9c6683be:530',
    },
  },
  'wet minimal': {
    make: () => new GroundMaterial({ wet: true, wetProgram: WET_PROGRAM_TIERS.minimal }),
    pin: {
      cacheKey: 'rl-ground-wet-rim-off-rip0-rough-water',
      defines: { STANDARD: '', THEME_WET: '' },
      vertex: 'fae1eccb426cf980ede67ccb41e74ad2b7faacb7eaa8c8222933c902d1e62ec6:1603',
      fragment: 'b8bd80c90b5601ec59228db1c4f54a3f5da991a89cb2bfc5c666ab283a3fd623:11465',
      uniforms: '8b73b9289b6b13d2ab74d6fc401e7e62e9e7d7fd2c43ba737545a20a9c6683be:530',
    },
  },
};


/** What L2 compares, for any ground material: cache key, defines, and the three digests. */
export function programOf(m: THREE.Material & { customProgramCacheKey(): string }): LegacyGroundPin {
  const c = compiledLegacy(m);
  return {
    cacheKey: m.customProgramCacheKey(),
    defines: m.defines as Record<string, string>,
    vertex: digestOf(c.vertexShader),
    fragment: digestOf(c.fragmentShader),
    uniforms: digestOf(c.uniformNames.join(',')),
  };
}
