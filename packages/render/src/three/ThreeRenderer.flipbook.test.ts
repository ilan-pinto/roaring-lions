// The `vi.mock('three', ...)` block, `TONES` and `makeOpts` below are copied
// verbatim from `ThreeRenderer.missile.test.ts`.
/**
 * Defilade T4, Task 4: the flipbook is built, added to the scene, stepped on
 * the frame clock and disposed by the renderer, and its debug layer holds
 * across a zero-time repaint. Its spawn paths are Task 6's.
 */
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { Sim } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import type { FlipbookFx } from './units/flipbook-fx';
import { FLIP_SMOKE } from './units/flipbook-fx';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    outputColorSpace = actual.SRGBColorSpace;
    domElement: unknown = {};
    setClearColor(): void {
      // Real `WebGLRenderer#setClearColor` reads `outputColorSpace`
      // synchronously; this stand-in only needs to accept the call.
    }
    // `ThreeRenderer.dispose` loses the context last (`context-release.ts`).
    getContext(): { isContextLost(): boolean } {
      return { isContextLost: () => false };
    }
    forceContextLoss(): void {}
    dispose(): void {
      // Nothing to release: this stand-in holds no GPU context.
    }
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer };
});

const TONES: TerrainTones = {
  open: '#C8B494', cover: ['#8F9464', '#6E7449', '#4E5433'],
  blocked: '#3A3C33', underBuilding: '#23241F', road: '#E6D8BE', rut: '#4E5433',
  rock: '#8E9491', rockLit: '#F2E8D5', earth: '#6E7449', low: '#8F9464',
  trunk: '#4E5433', trunkLit: '#8F9464', leafDark: '#333821', leafMid: '#4E5433',
  leafLit: '#6E7449', bladeLit: '#8F9464', bladeShade: '#4E5433', spoil: '#6E7449',
  crownRatio: 0.52, scatter: 'stone',
    groveFamily: 'desert_tree',
  haze: '#E0B87A',
};

function makeOpts(): RendererOptions {
  return {
    background: '#14150F',
    teamColors: ['#C8B494', '#6E7449', '#8E9491'],
    hullColors: ['#8F9464', '#6E7449', '#4E5433'],
    infantryColors: ['#8F9464', '#6E7449', '#4E5433'],
    groupColors: ['#C8B494', '#6E7449', '#8E9491', '#3A3C33', '#E6D8BE', '#4E5433', '#8E9491', '#F2E8D5', '#6E7449'],
    terrainTones: TONES,
    tracerColors: ['#F2E8D5', '#E6D8BE'],
    shellColors: ['#FFB43C', '#E8541E'],
    flashColor: '#F2E8D5',
    nearMissColor: '#6E7449',
    interceptColor: '#8E9491',
  };
}

interface Privates {
  flipbook: FlipbookFx;
  scene: THREE.Scene;
  updateFx(ms: number): void;
}
const priv = (r: ThreeRenderer): Privates => r as unknown as Privates;

function renderer(): ThreeRenderer {
  const r = new ThreeRenderer(new Sim({ seed: 1, width: 16, height: 16, capacity: 4 }), makeOpts());
  r.snapshot();
  return r;
}

describe('ThreeRenderer flipbook', () => {
  it('adds both flipbook meshes to the scene, hidden while idle', () => {
    const r = renderer();
    const fb = priv(r).flipbook;
    expect(fb.mesh.parent).toBe(priv(r).scene);
    expect(fb.fireMesh.parent).toBe(priv(r).scene);
    priv(r).updateFx(16);
    expect(fb.mesh.visible).toBe(false);
    expect(fb.fireMesh.visible).toBe(false);
    r.dispose();
  });

  it('steps the flipbook on the frame clock, with lit-ground radiance and a unit sun', () => {
    const r = renderer();
    const fb = priv(r).flipbook;
    priv(r).updateFx(16);
    priv(r).updateFx(20);
    expect(fb.nowMs).toBeCloseTo(36, 6);
    const u = fb.mesh.material.uniforms;
    expect(u.uLight.value).toBeGreaterThan(0);
    expect((u.uSun.value as THREE.Vector2).length()).toBeCloseTo(1, 5);
    r.dispose();
  });

  it('the flipbook debug layer answers 2 and holds across a zero-time repaint', () => {
    const r = renderer();
    const fb = priv(r).flipbook;
    const tex = (): THREE.DataTexture => new THREE.DataTexture(new Uint8Array(4), 1, 1);
    fb.setAtlases(tex(), tex());
    fb.spawn({ x: 1, y: 0, z: 1, durationMs: 5000, scale: 1, type: FLIP_SMOKE });
    priv(r).updateFx(16);
    expect(fb.mesh.visible).toBe(true);
    expect(r.setDebugLayerVisible('flipbook', false)).toBe(2);
    priv(r).updateFx(0);
    expect(fb.mesh.visible).toBe(false);
    expect(fb.fireMesh.visible).toBe(false);
    r.setDebugLayerVisible('flipbook', true);
    priv(r).updateFx(0);
    expect(fb.mesh.visible).toBe(true);
    r.dispose();
  });
});
