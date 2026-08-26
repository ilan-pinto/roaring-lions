/**
 * Phase 0 measured the obvious setup at ZERO colours in palette: building LUT
 * colours with convertSRGBToLinear() and leaving three.js's default output
 * colour space moves every value off its palette entry. It fails silently --
 * the render looks fine, it is merely not the palette.
 *
 * These tests pin the three settings that fix it, so the failure cannot come
 * back as a surprise in B2 or B3.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  paletteColorNoConvert,
  toonRampMaterial,
  applyPalettePipeline,
  RAMP_MAX,
  type PaletteTarget,
} from './palette-material';

const OLIVE = ['#8F9464', '#6E7449', '#4E5433', '#333821'];

describe('paletteColorNoConvert', () => {
  it('preserves the exact bytes of the palette entry', () => {
    // Read with the same explicit space it was written in. A bare
    // c.getHexString() defaults its read-side colour space to SRGBColorSpace
    // regardless of how the value was written, and does NOT round-trip --
    // that default-read gap is exactly what this pipeline exists to route
    // around at the renderer/clear-colour call sites, not to paper over here
    // with a global ColorManagement.enabled = false (which would make this
    // function indistinguishable from the naive `new THREE.Color(hex)` path
    // it replaces).
    for (const hex of OLIVE) {
      const c = paletteColorNoConvert(hex);
      expect('#' + c.getHexString(THREE.LinearSRGBColorSpace).toUpperCase()).toBe(
        hex.toUpperCase()
      );
    }
  });

  it('differs from the converting path — the bug this exists to prevent', () => {
    // If these ever agree, three.js changed its conversion and this guard is
    // no longer measuring anything.
    const plain = paletteColorNoConvert('#8F9464');
    const converted = new THREE.Color('#8F9464').convertSRGBToLinear();
    expect(plain.getHexString()).not.toBe(converted.getHexString());
  });
});

describe('toonRampMaterial', () => {
  it('pads the ramp to the shader array length so three.js can upload it', () => {
    // A short ramp left short makes three.js read past the end of the array
    // while uploading a vec3[RAMP_MAX] uniform.
    const m = toonRampMaterial(OLIVE);
    expect(m.uniforms.uRamp.value).toHaveLength(RAMP_MAX);
  });

  it('reports the true step count separately from the padded length', () => {
    const m = toonRampMaterial(OLIVE);
    expect(m.uniforms.uSteps.value).toBe(OLIVE.length);
  });

  it('carries the ramp colours unconverted', () => {
    const m = toonRampMaterial(OLIVE);
    const first = m.uniforms.uRamp.value[0];
    // Same explicit-read-space reasoning as paletteColorNoConvert's own test.
    expect('#' + first.getHexString(THREE.LinearSRGBColorSpace).toUpperCase()).toBe(OLIVE[0]);
  });

  it('handles the shortest ramp in the palette without padding past the end', () => {
    const skin = ['#C78773', '#A87262'];
    const m = toonRampMaterial(skin);
    expect(m.uniforms.uRamp.value).toHaveLength(RAMP_MAX);
    expect(m.uniforms.uSteps.value).toBe(2);
  });
});

// `THREE.WebGLRenderer` cannot be constructed in this suite's headless
// `environment: 'node'` (no WebGL, no DOM) -- see vitest.config.ts.
// `applyPalettePipeline` is typed as the narrow structural shape it actually
// mutates (`PaletteTarget`: `outputColorSpace` plus `setClearColor`), so a
// plain object stands in for the renderer here. A real `THREE.WebGLRenderer`
// still satisfies that shape unchanged at the `ThreeRenderer` call site.
//
// What this stub does NOT prove: real `WebGLRenderer#setClearColor` reads
// `renderer.outputColorSpace` synchronously, inside its own call
// (`WebGLBackground.setClear` -> `color.getRGB(_rgb,
// getUnlitUniformColorSpace(renderer))`), to convert the stored `Color` into
// the final RGB that reaches `gl.clearColor`. This stub's `setClearColor`
// only records the `Color` object it was handed -- it does not perform that
// conversion, so it cannot observe whether `outputColorSpace` was set
// correctly or in time, only whether `applyPalettePipeline` handed
// `paletteColorNoConvert`'s output to `setClearColor` at all. The
// conversion -- and therefore the actual on-screen byte -- is exercised only
// by a real browser readback (done for this task; not part of `pnpm test`,
// since `WebGLRenderer` cannot construct here and rasterization is
// out-of-suite by design, same as `playtest.ts`).
describe('applyPalettePipeline', () => {
  it('sets outputColorSpace to pass-through and the clear colour to the palette hex', () => {
    // Not a test of call order -- applyPalettePipeline is now the only
    // place that sequence exists, so there is no pair of lines outside it
    // left to get wrong. This just checks both of its effects landed.
    const BACKGROUND = '#C8B494';
    let received: THREE.Color | undefined;
    const target: PaletteTarget = {
      outputColorSpace: THREE.SRGBColorSpace,
      setClearColor(color) {
        received = color;
      },
    };

    applyPalettePipeline(target, BACKGROUND);

    expect(target.outputColorSpace).toBe(THREE.LinearSRGBColorSpace);
    expect(received).toBeDefined();
    // Same explicit-read-space reasoning as paletteColorNoConvert's own test.
    expect(
      '#' + (received as THREE.Color).getHexString(THREE.LinearSRGBColorSpace).toUpperCase()
    ).toBe(BACKGROUND);
  });
});
