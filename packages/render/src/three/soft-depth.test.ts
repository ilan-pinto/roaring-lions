/**
 * GH-1227 slice 1: the soft-particle depth source (`soft-depth.ts`). Oracles are literals.
 * Falsifications (each run once, red, then reverted; listed in the commit message).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { NUMBER_OPS } from './fog-ops';
import { isAoOccluder } from './ao-occluder';
import {
  SOFT_PARTICLE_GLSL,
  SoftDepthSnapshot,
  softParticleFadeOps,
  type SoftDepthRenderer,
} from './soft-depth';
import * as bands from './units/render-order';

const fade = (scene: number, frag: number, span: number, size: number): number => softParticleFadeOps(NUMBER_OPS, scene, frag, span, size);

function composerTarget(w: number, h: number): THREE.WebGLRenderTarget {
  const t = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: true });
  const d = new THREE.DepthTexture(w, h, THREE.UnsignedInt248Type);
  d.format = THREE.DepthStencilFormat;
  t.depthTexture = d;
  return t;
}

/** Records every call a capture makes, with `current` as the bound target. */
function recorder(current: THREE.WebGLRenderTarget | null, scissorOn = false) {
  const calls: string[] = [];
  let scissor = scissorOn;
  const scissorAtCopy: boolean[] = [];
  const copies: Array<[THREE.Texture, THREE.Texture]> = [];
  let bound = current;
  const r: SoftDepthRenderer = {
    getRenderTarget: () => bound,
    setRenderTarget: (t) => {
      calls.push('bind');
      bound = t;
    },
    initRenderTarget: () => calls.push('init'),
    copyTextureToTexture: (src, dst) => {
      calls.push('copy');
      copies.push([src, dst]);
      scissorAtCopy.push(scissor);
    },
    getScissorTest: () => scissor,
    setScissorTest: (on) => {
      scissor = on;
    },
  };
  return { r, calls, copies, bound: () => bound, scissor: () => scissor, scissorAtCopy };
}

describe('softParticleFadeOps (GH-1227)', () => {
  it('is 0 at contact and behind the scene, 1 past the band, and smooth inside it (literal readings)', () => {
    expect(fade(0.5, 0.5, 100, 1)).toBe(0);
    expect(fade(0.49, 0.5, 100, 1)).toBe(0);
    // gap (0.501 - 0.5) * 100 = 0.1 world units, band 0.35 x size 1 = 0.35: t = 0.2857, t^2 (3 - 2t) = 0.19825.
    expect(fade(0.501, 0.5, 100, 1)).toBeCloseTo(0.19825, 4);
    expect(fade(0.504, 0.5, 100, 1)).toBe(1);
    // The band scales with the billow: size 4 is a 1.4-unit band, so the same 0.1 gap reads t = 0.0714 -> 0.01458.
    expect(fade(0.501, 0.5, 100, 4)).toBeCloseTo(0.01458, 4);
    // A tiny puff keeps the 0.05-unit floor: gap 0.025 is half of it -> 0.5.
    expect(fade(0.50025, 0.5, 100, 0.01)).toBeCloseTo(0.5, 6);
  });

  it('the GLSL carries the same two constants and the same expression', () => {
    expect(SOFT_PARTICLE_GLSL).toContain('float gap = (sceneDepth - fragDepth) * span;');
    expect(SOFT_PARTICLE_GLSL).toContain('float range = max(0.050, size * 0.350);');
    expect(SOFT_PARTICLE_GLSL).toContain('return smoothstep(0.0, range, gap);');
  });
});

describe('SoftDepthSnapshot (GH-1227)', () => {
  it('copies the depth of a source target, sizes itself to it, and rebinds that target', () => {
    const src = composerTarget(320, 200);
    const snap = new SoftDepthSnapshot([src, composerTarget(320, 200)]);
    const rec = recorder(src);
    expect(snap.capture(rec.r)).toBe(true);
    expect(rec.calls).toEqual(['init', 'copy', 'bind']);
    expect(rec.copies[0]![0]).toBe(src.depthTexture);
    expect(rec.copies[0]![1]).toBe(snap.depthTexture);
    expect(rec.bound()).toBe(src);
    expect(snap.invSize.x).toBeCloseTo(1 / 320, 9);
    expect(snap.invSize.y).toBeCloseTo(1 / 200, 9);
    expect(snap.captures).toBe(1);
  });

  it('copies with the scissor test off (a blit honours it) and puts it back after', () => {
    const src = composerTarget(32, 32);
    const snap = new SoftDepthSnapshot([src]);
    const on = recorder(src, true);
    expect(snap.capture(on.r)).toBe(true);
    expect(on.scissorAtCopy).toEqual([false]);
    expect(on.scissor()).toBe(true);
    const off = recorder(src, false);
    snap.capture(off.r);
    expect(off.scissorAtCopy).toEqual([false]);
    expect(off.scissor()).toBe(false);
  });

  it('never copies from a target it was not given, nor from the canvas', () => {
    const snap = new SoftDepthSnapshot([composerTarget(320, 200)]);
    const foreign = recorder(composerTarget(64, 64));
    expect(snap.capture(foreign.r)).toBe(false);
    expect(foreign.calls).toEqual([]);
    const canvas = recorder(null);
    expect(snap.capture(canvas.r)).toBe(false);
    expect(canvas.calls).toEqual([]);
    expect(snap.invSize.x).toBe(1);
  });

  it('its texture is its own (no feedback loop) and has the composer depth format (the blit needs a match)', () => {
    const a = composerTarget(8, 8);
    const b = composerTarget(8, 8);
    const snap = new SoftDepthSnapshot([a, b]);
    expect(snap.depthTexture).not.toBe(a.depthTexture);
    expect(snap.depthTexture).not.toBe(b.depthTexture);
    expect(snap.depthTexture.format).toBe(THREE.DepthStencilFormat);
    expect(snap.depthTexture.type).toBe(THREE.UnsignedInt248Type);
  });

  it('the sentinel draws while a consumer does, and only then', () => {
    const snap = new SoftDepthSnapshot([]);
    const consumer = new THREE.Object3D();
    expect(snap.sentinel.visible).toBe(false);
    consumer.visible = false;
    snap.sync([consumer]);
    expect(snap.sentinel.visible).toBe(false);
    consumer.visible = true;
    snap.sync([consumer]);
    expect(snap.sentinel.visible).toBe(true);
    snap.sync([]);
    expect(snap.sentinel.visible).toBe(false);
  });

  it('the sentinel changes no pixel: zero vertices, no colour, depth or test, out of AO and shadows', () => {
    const s = new SoftDepthSnapshot([]).sentinel;
    expect(s.geometry.drawRange.count).toBe(0);
    expect(s.material.colorWrite).toBe(false);
    expect(s.material.depthWrite).toBe(false);
    expect(s.material.depthTest).toBe(false);
    expect(s.material.transparent).toBe(true);
    expect(s.castShadow).toBe(false);
    expect(isAoOccluder(s)).toBe(false);
  });

  it('the sentinel is the first transparent draw: its band is below every other band', () => {
    const s = new SoftDepthSnapshot([]).sentinel;
    expect(s.renderOrder).toBe(bands.SOFT_DEPTH_SNAPSHOT_RENDER_ORDER);
    const others = Object.entries(bands)
      .filter(([k, v]) => k.endsWith('_RENDER_ORDER') && k !== 'SOFT_DEPTH_SNAPSHOT_RENDER_ORDER' && typeof v === 'number')
      .map(([, v]) => v as number);
    expect(others.length).toBeGreaterThan(10);
    for (const v of others) expect(s.renderOrder).toBeLessThan(v);
  });

  it('its onBeforeRender is the capture', () => {
    const src = composerTarget(16, 16);
    const snap = new SoftDepthSnapshot([src]);
    const rec = recorder(src);
    const s = snap.sentinel;
    s.onBeforeRender(rec.r as unknown as THREE.WebGLRenderer, new THREE.Scene(), new THREE.Camera(), s.geometry, s.material, null as never);
    expect(snap.captures).toBe(1);
    expect(rec.calls).toEqual(['init', 'copy', 'bind']);
  });
});

describe('the soft-particles design (GH-1227 review)', () => {
  it("D4 gives the reviewer's reason: a fade thins the smoke screen at the ground, it does not hide it behind walls", () => {
    const doc = readFileSync(fileURLToPath(new URL('../../../../docs/superpowers/specs/2026-11-11-soft-particles-design.md', import.meta.url)), 'utf8');
    const d4 = doc.split('\n').filter((l) => l.includes('(D4):') || l.startsWith('| D4 |'));
    expect(d4.length).toBe(2);
    for (const line of d4) {
      expect(line).toContain('thin the screen where it meets the ground');
      expect(line).not.toContain('behind walls');
    }
  });
});
