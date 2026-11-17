/**
 * @vitest-environment jsdom
 *
 * GH-1400: the `soft-depth` debug layer (`debug-layers.ts`), the seam the golden gate's soft-particle layer check toggles.
 * Hidden must be the soft-OFF render exactly (both legacy consumers back on their shipped programs, `setSoftDepth(null)`), shown
 * must put the snapshot back, and a renderer with nothing to switch (no snapshot; the node copy) must say 0 so a check fails.
 * The snapshot is installed by hand: `init` needs a WebGL context jsdom does not have, and the wiring `init` does is pinned
 * elsewhere (`ThreeRenderer.soft-depth-node.test.ts`, the consumer tests). Falsify: return 2 without calling `setSoftDepth`, or
 * pass `snap` in both directions; each turns this file red.
 */
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Sim } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { QUALITY_PRESETS, type RenderQuality } from '../quality';
import { ThreeRenderer } from './ThreeRenderer';
import { NodeSoftDepthCopy, SoftDepthSnapshot } from './soft-depth';
import { paletteHex } from './palette-hex';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    outputColorSpace = actual.SRGBColorSpace;
    domElement: unknown = {};
    setClearColor(): void {}
    render(): void {}
    getContext(): { isContextLost(): boolean } {
      return { isContextLost: () => false };
    }
    forceContextLoss(): void {}
    dispose(): void {}
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer };
});

/** Every fixture colour is a palette key (`paletteHex` reads `data/palette.json`), never a hex literal. */
const p = paletteHex;

const TONES: TerrainTones = {
  open: p('limestone.3'), cover: [p('olive.0'), p('olive.1'), p('olive.2')],
  blocked: p('gunmetal.3'), underBuilding: p('shadow.0'), road: p('limestone.1'), rut: p('olive.2'),
  rock: p('gunmetal.1'), rockLit: p('limestone.0'), earth: p('olive.1'), low: p('olive.0'),
  trunk: p('olive.2'), trunkLit: p('olive.0'), leafDark: p('olive.3'), leafMid: p('olive.2'),
  leafLit: p('olive.1'), bladeLit: p('olive.0'), bladeShade: p('olive.2'), spoil: p('olive.1'),
  crownRatio: 0.52, scatter: 'stone', groveFamily: 'desert_tree', haze: p('dust.0'),
};

function opts(quality: RenderQuality | undefined): RendererOptions {
  return {
    background: p('shadow.1'),
    teamColors: [p('limestone.3'), p('olive.1'), p('gunmetal.1')],
    hullColors: [p('olive.0'), p('olive.1'), p('olive.2')],
    infantryColors: [p('olive.0'), p('olive.1'), p('olive.2')],
    groupColors: [
      p('limestone.3'), p('olive.1'), p('gunmetal.1'), p('gunmetal.3'), p('limestone.1'),
      p('olive.2'), p('gunmetal.1'), p('limestone.0'), p('olive.1'),
    ],
    terrainTones: TONES,
    tracerColors: [p('limestone.0'), p('limestone.1')],
    shellColors: [p('vfx.fire'), p('vfx.ember')],
    flashColor: p('limestone.0'),
    nearMissColor: p('olive.1'),
    interceptColor: p('gunmetal.1'),
    ...(quality ? { quality } : {}),
  };
}

interface Consumers {
  softDepth: unknown;
  flipbook: { softDepthOn: boolean };
  particleInstancerBelow: { softDepthOn: boolean };
}

function renderer(): { r: ThreeRenderer; c: Consumers } {
  const r = new ThreeRenderer(new Sim({ seed: 1, width: 8, height: 8, capacity: 2 }), opts(QUALITY_PRESETS.high));
  return { r, c: r as unknown as Consumers };
}

function installSnapshot(c: Consumers): SoftDepthSnapshot {
  const snap = new SoftDepthSnapshot([new THREE.WebGLRenderTarget(8, 8), new THREE.WebGLRenderTarget(8, 8)]);
  c.softDepth = snap;
  (c.flipbook as unknown as { setSoftDepth(s: SoftDepthSnapshot): void }).setSoftDepth(snap);
  (c.particleInstancerBelow as unknown as { setSoftDepth(s: SoftDepthSnapshot): void }).setSoftDepth(snap);
  return snap;
}

describe('GH-1400: the soft-depth debug layer', () => {
  it('hidden takes both legacy consumers off the snapshot, shown puts them back; each reports the 2 it switched', () => {
    const { r, c } = renderer();
    installSnapshot(c);
    expect(c.flipbook.softDepthOn && c.particleInstancerBelow.softDepthOn).toBe(true);
    expect(r.setDebugLayerVisible('soft-depth', false)).toBe(2);
    expect(c.flipbook.softDepthOn).toBe(false);
    expect(c.particleInstancerBelow.softDepthOn).toBe(false);
    expect(r.setDebugLayerVisible('soft-depth', true)).toBe(2);
    expect(c.flipbook.softDepthOn).toBe(true);
    expect(c.particleInstancerBelow.softDepthOn).toBe(true);
    r.dispose();
  });

  it('says 0, and changes nothing, with no snapshot (soft particles off) or the node copy', () => {
    const { r, c } = renderer();
    expect(c.softDepth).toBeNull();
    expect(r.setDebugLayerVisible('soft-depth', false)).toBe(0);
    c.softDepth = new NodeSoftDepthCopy(() => null);
    expect(r.setDebugLayerVisible('soft-depth', false)).toBe(0);
    expect(c.flipbook.softDepthOn).toBe(false);
    r.dispose();
  });
});
