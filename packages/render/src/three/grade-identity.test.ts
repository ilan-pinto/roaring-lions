/**
 * @vitest-environment jsdom
 *
 * jsdom for `post-chain.test.ts`'s reason: `SMAAPass` builds its lookup textures from `new Image()`.
 * The assertions are about the REAL `OutputPass` and the REAL vignette fold underneath the grade.
 *
 * The pixel claim (a graded frame equals what the maths says; an identity frame equals today's) cannot
 * be made without a GPU: `tools/src/perf/look-l2-captures.ts` makes it with a Metal browser. What a unit
 * test CAN hold is the structure that makes it true: an identity grade compiles NOTHING into the output
 * shader, and a non-identity one compiles the lookup in the right place.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { OutputShader } from 'three/addons/shaders/OutputShader.js';
import { createPostChain } from './post-chain';
import { foldVignetteShaders } from './vignette-pass';
import { foldGradeShader } from './output-grade';
import { IDENTITY_GRADE, resolveGrade, type GradeJson, type ResolvedGrade } from './grade-maths';
import dusk from '../../../../data/grades/dusk.json';

function fakeRenderer(): THREE.WebGLRenderer {
  const size = new THREE.Vector2(1440, 900);
  return {
    getSize: (v: THREE.Vector2) => v.copy(size),
    getPixelRatio: () => 1,
    setRenderTarget: () => undefined,
    getRenderTarget: () => null,
    getContext: () => ({}),
  } as unknown as THREE.WebGLRenderer;
}

const newChain = () => createPostChain(fakeRenderer(), new THREE.Scene(), new THREE.OrthographicCamera(), 800, 600, 1);
const outputOf = (chain: ReturnType<typeof newChain>) =>
  chain.composer.passes.find((p) => p.constructor.name === 'OutputPass') as unknown as {
    uniforms: Record<string, THREE.IUniform>;
    material: THREE.RawShaderMaterial;
  };

/** The identity grade with one number moved by an amount no eye could see: saturation 1.01. */
const SLIGHTLY_SATURATED: ResolvedGrade = { ...IDENTITY_GRADE, saturation: 1.01 };

describe('an identity grade builds no pass (spec section 8, grade-identity)', () => {
  it('null, the identity, and day (no grade) leave the output shader byte for byte as the vignette fold made it', () => {
    const chain = newChain();
    const out = outputOf(chain);
    const stock = out.material.fragmentShader;
    expect(stock).not.toContain('uGradeLut');
    expect(chain.grade.active).toBe(false);
    expect(chain.grade.apply(null)).toBe(false);
    expect(chain.grade.apply(IDENTITY_GRADE)).toBe(false);
    expect(out.material.fragmentShader).toBe(stock);
    expect(chain.grade.active).toBe(false);
    expect(out.uniforms.uGradeOn.value).toBe(0);
    // No extra pass either way.
    expect(chain.passNames).toEqual(['RenderPass', 'OutputPass', 'SMAAPass']);
    chain.dispose();
  });

  it('a strength-0 dusk resolves to an identity and builds nothing', () => {
    const chain = newChain();
    const stock = outputOf(chain).material.fragmentShader;
    expect(chain.grade.apply(resolveGrade(dusk as GradeJson, 0))).toBe(false);
    expect(outputOf(chain).material.fragmentShader).toBe(stock);
    chain.dispose();
  });

  it('FALSIFIER: a saturation of 1.01 is not an identity, so the same assertions go red on it', () => {
    const chain = newChain();
    const out = outputOf(chain);
    const stock = out.material.fragmentShader;
    expect(chain.grade.apply(SLIGHTLY_SATURATED)).toBe(true);
    expect(chain.grade.active).toBe(true);
    expect(out.material.fragmentShader).not.toBe(stock);
    expect(out.material.fragmentShader).toContain('uGradeLut');
    chain.dispose();
  });

  it('removing a grade restores the stock shader exactly, and the debug layer is a uniform that zeroes the lookup', () => {
    const chain = newChain();
    const out = outputOf(chain);
    const stock = out.material.fragmentShader;
    chain.grade.apply(resolveGrade(dusk as GradeJson));
    expect(out.uniforms.uGradeOn.value).toBe(1);
    chain.grade.enabled = false;
    expect(out.uniforms.uGradeOn.value).toBe(0);
    chain.grade.enabled = true;
    expect(out.uniforms.uGradeOn.value).toBe(1);
    chain.grade.apply(null);
    expect(out.material.fragmentShader).toBe(stock);
    expect(out.uniforms.uGradeOn.value).toBe(0);
    chain.dispose();
  });

  it('bakes a 32^3 half-float 3D texture, linear filtered and clamped', () => {
    const chain = newChain();
    chain.grade.apply(resolveGrade(dusk as GradeJson));
    const tex = chain.grade.uniforms.uGradeLut.value;
    expect(tex).toBeInstanceOf(THREE.Data3DTexture);
    expect(tex?.image.width).toBe(32);
    expect(tex?.image.height).toBe(32);
    expect(tex?.image.depth).toBe(32);
    expect(tex?.type).toBe(THREE.HalfFloatType);
    expect(tex?.minFilter).toBe(THREE.LinearFilter);
    expect(tex?.wrapR).toBe(THREE.ClampToEdgeWrapping);
    chain.dispose();
  });
});

describe('the lookup is folded where the spec puts it', () => {
  const { fragment } = foldVignetteShaders(OutputShader.vertexShader, OutputShader.fragmentShader);
  const folded = foldGradeShader(fragment);

  it('sits AFTER the tone map and the sRGB encode and BEFORE the vignette multiply, with the dither last', () => {
    const encode = folded.indexOf('sRGBTransferOETF( fragColor )');
    const lookup = folded.indexOf('texture(uGradeLut');
    const vignette = folded.indexOf('roundTripHalf(fragColor.rgb) * (1.0 - uVigStrength * vigV)');
    const dither = folded.indexOf('gradeNoise(gl_FragCoord.xy)', folded.indexOf('void main()'));
    expect(encode).toBeGreaterThan(-1);
    expect(lookup).toBeGreaterThan(encode);
    expect(vignette).toBeGreaterThan(lookup);
    expect(dither).toBeGreaterThan(vignette);
  });

  it('declares sampler3D precision (a raw-shader material gets no default for it)', () => {
    expect(folded).toContain('precision highp sampler3D;');
    expect(folded.indexOf('precision highp sampler3D;')).toBeLessThan(folded.indexOf('uniform sampler3D uGradeLut;'));
  });

  it('samples at texel centres: scale (N-1)/N, offset 0.5/N', () => {
    expect(folded).toContain('gc * 0.96875000 + 0.01562500');
  });

  it('refuses a source it cannot anchor into, rather than drawing no grade', () => {
    expect(() => foldGradeShader('void main() {}')).toThrow(/anchors/);
  });
});
