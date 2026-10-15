/**
 * The armed fire-support rings, per kind (S-F Task 1, GH-113).
 *
 * Pinned through the REAL `updateOverlays`, by the calls it makes to
 * `OverlayBatch.dashedEllipseRing`: that primitive is the only thing the aim
 * footprint draws with, and a scene with no refuge ping draws no other ring,
 * so its call list IS the picture. Each ring is two calls -- the `shadow.1`
 * halo (widened), then the dash in the ring's own tone.
 *
 * A smoke-screen ring aimed into standing smoke draws UNDER `SmokeMesh`
 * (band 5, veiled up to 0.72): the rings stay in the overlay band (4) on
 * purpose (Q7, no new band). The ring still draws and nothing errors; the
 * halo carries it. Recorded here and at `aimRingSpecs`.
 *
 * Harness copied from `ThreeRenderer.route.test.ts`.
 */
import { describe, it, expect, vi } from 'vitest';
import { Sim } from '@lions/sim';
import type { AimFootprint, RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import { paletteHex } from './palette-hex';
import { TILE_H, TILE_W } from '../project';
import {
  AIM_FOOTPRINT_STYLE,
  AIM_SCATTER_STYLE,
  REFUGE_RING_EDGE_COLOR_KEY,
  haloStyleOf,
  tileRadiusToEllipsePx,
  type OverlayBatch,
} from './units/overlays';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    outputColorSpace = actual.SRGBColorSpace;
    domElement: unknown = {};
    setClearColor(): void {}
    dispose(): void {}
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

interface ThreeRendererPrivates {
  overlayBatch: OverlayBatch;
  updateOverlays(alpha: number): void;
}

function setUp(aim: AimFootprint | null) {
  const sim = new Sim({ seed: 1, width: 24, height: 24, capacity: 8 });
  const renderer = new ThreeRenderer(sim, makeOpts());
  const priv = renderer as unknown as ThreeRendererPrivates;
  renderer.snapshot();
  renderer.snapshot();
  renderer.aimFootprint = aim;
  const ring = vi.spyOn(priv.overlayBatch, 'dashedEllipseRing');
  priv.updateOverlays(1);
  return { ring, calls: ring.mock.calls };
}

const at = { x: 12.5, y: 11.5 };
const halo = paletteHex(REFUGE_RING_EDGE_COLOR_KEY);
const radii = (tiles: number) => tileRadiusToEllipsePx(tiles, TILE_W, TILE_H);

/** One ring's two calls: halo first, dash over it. */
function expectRing(
  calls: readonly (readonly unknown[])[],
  at0: number,
  tiles: number,
  style: { widthPx: number; dashPx: number; gapPx: number },
  key: string
): void {
  const { rightR, upR } = radii(tiles);
  const [h, d] = [calls[at0], calls[at0 + 1]];
  expect(h[1]).toBeCloseTo(rightR, 6);
  expect(h[2]).toBeCloseTo(upR, 6);
  expect(h[3]).toEqual(haloStyleOf(style));
  expect(h[4]).toBe(halo);
  expect(d[1]).toBeCloseTo(rightR, 6);
  expect(d[2]).toBeCloseTo(upR, 6);
  expect(d[3]).toEqual(style);
  expect(d[4]).toBe(paletteHex(key));
  expect(d[5]).toBe(1);
}

describe('armed aim rings, per kind (S-F Task 1)', () => {
  it('draws nothing with no footprint', () => {
    expect(setUp(null).calls).toHaveLength(0);
  });

  it('strike: one dashed vfx.fire ring over its halo, as before', () => {
    const { calls } = setUp({ ...at, radius: 2, kind: 'strike' });
    expect(calls).toHaveLength(2);
    expectRing(calls, 0, 2, AIM_FOOTPRINT_STYLE, 'vfx.fire');
  });

  it('a footprint with no kind is the strike ring (the seam is optional)', () => {
    const { calls } = setUp({ ...at, radius: 2 });
    expect(calls).toHaveLength(2);
    expectRing(calls, 0, 2, AIM_FOOTPRINT_STYLE, 'vfx.fire');
  });

  it('barrage: the 2.5-tile vfx.fire outer ring AND a 1.5-tile vfx.ember inner ring, 1.5 px dash 3 gap 3', () => {
    const { calls } = setUp({ ...at, radius: 2.5, kind: 'barrage', scatter: 1.5 });
    expect(calls).toHaveLength(4);
    expectRing(calls, 0, 2.5, AIM_FOOTPRINT_STYLE, 'vfx.fire');
    expectRing(calls, 2, 1.5, AIM_SCATTER_STYLE, 'vfx.ember');
    expect(AIM_SCATTER_STYLE).toEqual({ widthPx: 1.5, dashPx: 3, gapPx: 3 });
    expect(paletteHex('vfx.ember')).not.toBe(paletteHex('vfx.fire'));
  });

  it('barrage with no usable scatter draws the outer ring alone, never a bogus one', () => {
    expect(setUp({ ...at, radius: 2.5, kind: 'barrage' }).calls).toHaveLength(2);
    expect(setUp({ ...at, radius: 2.5, kind: 'barrage', scatter: 0 }).calls).toHaveLength(2);
    expect(setUp({ ...at, radius: 2.5, kind: 'barrage', scatter: 2.5 }).calls).toHaveLength(2);
  });

  it('smoke screen: today\'s 4.5-tile geometry in limestone.0, not fire', () => {
    const { calls } = setUp({ ...at, radius: 4.5, kind: 'smoke' });
    expect(calls).toHaveLength(2);
    expectRing(calls, 0, 4.5, AIM_FOOTPRINT_STYLE, 'limestone.0');
    expect(paletteHex('limestone.0')).not.toBe(paletteHex('vfx.fire'));
  });

  it('smoke screen aimed into standing smoke still emits both ring calls (the veil is band 5\'s, not the ring\'s)', () => {
    const sim = new Sim({ seed: 1, width: 24, height: 24, capacity: 8 });
    sim.smoke.fill(255); // standing smoke over the whole map, the ring's centre included
    const renderer = new ThreeRenderer(sim, makeOpts());
    const priv = renderer as unknown as ThreeRendererPrivates;
    renderer.snapshot();
    renderer.aimFootprint = { ...at, radius: 4.5, kind: 'smoke' };
    const ring = vi.spyOn(priv.overlayBatch, 'dashedEllipseRing');
    expect(() => priv.updateOverlays(1)).not.toThrow();
    expect(ring).toHaveBeenCalledTimes(2);
  });
});
