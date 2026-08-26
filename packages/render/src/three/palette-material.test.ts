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
  setPaletteClearColor,
  RAMP_MAX,
  type PaletteTarget,
  type ClearColorTarget,
} from './palette-material';

const OLIVE = ['#8F9464', '#6E7449', '#4E5433', '#333821'];

describe('paletteColorNoConvert', () => {
  it('preserves the exact bytes of the palette entry', () => {
    for (const hex of OLIVE) {
      const c = paletteColorNoConvert(hex);
      expect('#' + c.getHexString().toUpperCase()).toBe(hex.toUpperCase());
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
    const first = m.uniforms.uRamp.value[0] as THREE.Color;
    expect('#' + first.getHexString().toUpperCase()).toBe(OLIVE[0]);
  });

  it('handles the shortest ramp in the palette without padding past the end', () => {
    const skin = ['#C78773', '#A87262'];
    const m = toonRampMaterial(skin);
    expect(m.uniforms.uRamp.value).toHaveLength(RAMP_MAX);
    expect(m.uniforms.uSteps.value).toBe(2);
  });
});

// `THREE.WebGLRenderer` cannot be constructed in this suite's headless
// `environment: 'node'` (no WebGL, no DOM) -- see vitest.config.ts. Both
// functions below are typed as the narrow structural shape they actually
// mutate (`PaletteTarget`/`ClearColorTarget`), so a plain object stands in
// for the renderer here. A real `THREE.WebGLRenderer` still satisfies both
// shapes unchanged at the `ThreeRenderer` call site -- `outputColorSpace` is
// a plain data property and `setClearColor` is a real method on it.
describe('applyPalettePipeline', () => {
  it('sets outputColorSpace to pass-through', () => {
    const target: PaletteTarget = { outputColorSpace: THREE.SRGBColorSpace };
    applyPalettePipeline(target);
    expect(target.outputColorSpace).toBe(THREE.LinearSRGBColorSpace);
  });
});

describe('setPaletteClearColor', () => {
  it('sets the clear colour through paletteColorNoConvert, not the naive sRGB path', () => {
    // The verdict's own example: the background hex reads #93744C through
    // the naive path instead of its actual palette entry #C8B494.
    const BACKGROUND = '#C8B494';
    let received: THREE.Color | undefined;
    const target: ClearColorTarget = {
      setClearColor(color) {
        received = color;
      },
    };
    setPaletteClearColor(target, BACKGROUND);
    expect(received).toBeDefined();
    expect('#' + (received as THREE.Color).getHexString().toUpperCase()).toBe(BACKGROUND);
  });
});
