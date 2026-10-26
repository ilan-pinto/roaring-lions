/**
 * @vitest-environment jsdom
 *
 * jsdom for the same single reason `post-chain.test.ts` needs it: `SMAAPass`
 * builds its two lookup textures from `new Image()`, which the repo's default
 * `environment: 'node'` does not have. The chain assertions here are about the
 * REAL `OutputPass` and the REAL `SMAAPass`, so stubbing either of them would
 * leave the thing this file pins testing a stand-in.
 *
 * The pixel claim (the fold draws what the separate pass drew) cannot be made
 * without a GPU: it was measured once, in one session, as max per-channel
 * delta 0 over 36 frames (GH-829). What a unit test CAN hold is the structure
 * that made it true, below.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createPostChain } from './post-chain';
import { OutputShader } from 'three/addons/shaders/OutputShader.js';
import {
  OutputVignette,
  foldVignetteShaders,
  VIGNETTE_RADIUS,
  VIGNETTE_SOFTNESS,
  VIGNETTE_STRENGTH,
} from './vignette-pass';

/** The composer needs only these members of a renderer at construction --
 *  copied from `post-chain.test.ts`'s own fake for the same reason. */
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

/** The shader's own falloff, in JS, so the two numbers this file asserts
 *  about the picture (centre untouched, corner darkened) are read off the
 *  same expression the GPU evaluates rather than off a remembered result.
 *  `d` is 0 at the frame's centre and 1 at a corner. */
function vignetteMultiplierAt(d: number): number {
  const t = Math.min(1, Math.max(0, (d - VIGNETTE_RADIUS) / VIGNETTE_SOFTNESS));
  const v = t * t * (3 - 2 * t);
  return 1 - VIGNETTE_STRENGTH * v;
}

describe('the vignette folded into OutputPass (GH-829)', () => {
  const newChain = () =>
    createPostChain(fakeRenderer(), new THREE.Scene(), new THREE.OrthographicCamera(), 800, 600, 1);

  it('adds no pass of its own, in any slot', () => {
    // The point of the fold. Falsify: re-add a pass named VignettePass to `rebuild`.
    const chain = newChain();
    chain.vignette.enabled = true;
    expect(chain.passNames).toEqual(['RenderPass', 'OutputPass', 'SMAAPass']);
    chain.dispose();
  });

  it('starts OFF, and `enabled` writes the strength uniform the shader reads', () => {
    const chain = newChain();
    const output = chain.composer.passes.find((p) => p.constructor.name === 'OutputPass') as unknown as {
      uniforms: Record<string, THREE.IUniform>;
      material: THREE.RawShaderMaterial;
    };
    // `outputPass.uniforms` must BE the material's table, or the write never reaches the GPU.
    expect(output.material.uniforms).toBe(output.uniforms);
    expect(chain.vignette.enabled).toBe(false);
    expect(output.uniforms.uVigStrength.value).toBe(0);
    chain.vignette.enabled = true;
    expect(output.uniforms.uVigStrength.value).toBe(VIGNETTE_STRENGTH);
    expect(output.uniforms.uVigRadius.value).toBe(VIGNETTE_RADIUS);
    expect(output.uniforms.uVigSoftness.value).toBe(VIGNETTE_SOFTNESS);
    chain.vignette.enabled = false;
    expect(output.uniforms.uVigStrength.value).toBe(0);
    chain.dispose();
  });

  it('applies the fall-off AFTER the tone map and the sRGB encode, and rounds through half float first', () => {
    const { fragment } = foldVignetteShaders(OutputShader.vertexShader, OutputShader.fragmentShader);
    const tone = fragment.indexOf('ACESFilmicToneMapping( fragColor.rgb )');
    const encode = fragment.indexOf('sRGBTransferOETF( fragColor )');
    const apply = fragment.indexOf('fragColor.rgb = roundTripHalf(fragColor.rgb) * (1.0 - uVigStrength * vigV)');
    // Display-referred: a vignette before ACES rides the shoulder instead of the display ramp.
    // Falsify: move the APPLY anchor's replacement above the colour-space block.
    expect(tone).toBeGreaterThan(-1);
    expect(encode).toBeGreaterThan(tone);
    expect(apply).toBeGreaterThan(encode);
    // The half round trip is what makes the fold pixel-identical under SMAA (see HALF_GLSL).
    // Falsify: drop `roundTripHalf(...)` from the multiply -- 250-330 SMAA edge pixels per
    // 2880x1800 frame move by up to 32/255 (measured), with nothing else in this file noticing.
    expect(fragment).toContain('unpackHalf2x16(packHalf2x16(');
    // The same smoothstep on the same normalised distance as the pass it replaced.
    expect(fragment).toContain('length(vUv - 0.5) / 0.7071');
    expect(fragment).toContain('smoothstep(uVigRadius, uVigRadius + uVigSoftness, vigD)');
  });

  it('is ported to GLSL ES 3.00 completely: no ES 1.00 spelling survives in either stage', () => {
    const { vertex, fragment } = foldVignetteShaders(OutputShader.vertexShader, OutputShader.fragmentShader);
    expect(`${vertex}\n${fragment}`).not.toMatch(/\b(attribute|varying|texture2D|gl_FragColor)\b/);
    expect(vertex).toMatch(/\bout vec2 vUv;/);
    expect(fragment).toMatch(/\bin vec2 vUv;/);
    expect(fragment).toContain('out highp vec4 fragColor;');
    const chain = newChain();
    const output = chain.composer.passes.find((p) => p.constructor.name === 'OutputPass') as unknown as {
      material: THREE.RawShaderMaterial;
    };
    expect(output.material.glslVersion).toBe(THREE.GLSL3);
    chain.dispose();
  });

  it('refuses a stock shader it cannot anchor into, rather than drawing no vignette', () => {
    // Falsify: delete the anchor check in `foldVignetteShaders`; a three upgrade then ships a
    // chain with a vignette that silently never draws, and the visual gate's layer floor is
    // the only thing left to notice.
    expect(() => foldVignetteShaders(OutputShader.vertexShader, 'void main() {}')).toThrow(/anchors/);
  });

  it('leaves the playable centre EXACTLY untouched and darkens a corner by about half', () => {
    // `smoothstep` is identically 0 below `uRadius`, so every pixel inside 0.62 of the
    // half-diagonal is multiplied by exactly 1. Asserting the STRUCTURE rather than a
    // measured epsilon is what makes that a guarantee instead of a reading.
    expect(vignetteMultiplierAt(0)).toBe(1);
    expect(vignetteMultiplierAt(VIGNETTE_RADIUS)).toBe(1);
    expect(vignetteMultiplierAt(VIGNETTE_RADIUS + 0.2)).toBeLessThan(0.95);
    // 1 - 0.55 * smoothstep(0.62, 1.07, 1.0) = 1 - 0.55 * 0.93494 = 0.48578.
    expect(vignetteMultiplierAt(1)).toBeCloseTo(0.48579, 5);
    // The ramp's top sits PAST the corner, so the gradient is still moving where the frame
    // runs out -- an outer band pinned at full strength reads as a dark ring.
    expect(VIGNETTE_RADIUS + VIGNETTE_SOFTNESS).toBeGreaterThan(1);
  });

  it('is a handle on the chain, not a thing it frees: dispose() does not touch the output pass twice', () => {
    const chain = newChain();
    expect(chain.vignette).toBeInstanceOf(OutputVignette);
    expect(() => chain.dispose()).not.toThrow();
  });
});
