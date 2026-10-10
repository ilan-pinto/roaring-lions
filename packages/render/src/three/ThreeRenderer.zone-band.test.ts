/**
 * #470, through the REAL `updateOverlays`: an objective zone draws its
 * halo and outline in the overlay tier exactly as before, a hatched band on
 * the ground inside its edge, and NOTHING over its interior in the
 * over-everything tier -- the fill that tinted every roof and hull in a
 * town lime is gone.
 *
 * Harness copied from `ThreeRenderer.route.test.ts`: a faked
 * `WebGLRenderer`, nothing initialised that the overlay pass does not read.
 */
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { Sim } from '@lions/sim';
import type { ObjectiveZoneView, RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import type { OverlayBatch } from './units/overlays';
import type { ZoneBandBatch } from './units/zone-band';
import { hexToLinear } from './terrain/shared';

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
  crownRatio: 0.52, scatter: 'stone', groveFamily: 'desert_tree', haze: '#E0B87A',
};

function makeOpts(resolveColor?: (key: string) => string): RendererOptions {
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
    ...(resolveColor ? { resolveColor } : {}),
  };
}

interface Privates {
  overlayBatch: OverlayBatch;
  zoneBand: ZoneBandBatch;
  scene: THREE.Scene;
  updateOverlays(alpha: number): void;
}

const TOWN = [4, 4, 12, 10];

function draw(zones: ObjectiveZoneView[], resolveColor?: (key: string) => string) {
  const sim = new Sim({ seed: 1, width: 24, height: 24, capacity: 4 });
  const renderer = new ThreeRenderer(sim, makeOpts(resolveColor));
  const priv = renderer as unknown as Privates;
  renderer.objectiveZones = zones;
  const stroke = vi.spyOn(priv.overlayBatch, 'polygonStrokeWorld');
  priv.updateOverlays(1);
  return { renderer, priv, stroke };
}

/** Triangles a mesh draws this frame, as (x, z) triples. */
function trianglesXZ(mesh: THREE.Mesh): [number, number][][] {
  const pos = mesh.geometry.getAttribute('position').array as Float32Array;
  const n = mesh.geometry.drawRange.count;
  const out: [number, number][][] = [];
  for (let v = 0; v + 2 < n; v += 3) {
    out.push([0, 1, 2].map((k) => [pos[(v + k) * 3], pos[(v + k) * 3 + 2]] as [number, number]));
  }
  return out;
}

function contains(tri: [number, number][], [px, py]: [number, number]): boolean {
  const s = (a: [number, number], b: [number, number]) => (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]);
  const d0 = s(tri[0], tri[1]);
  const d1 = s(tri[1], tri[2]);
  const d2 = s(tri[2], tri[0]);
  return (d0 >= 0 && d1 >= 0 && d2 >= 0) || (d0 <= 0 && d1 <= 0 && d2 <= 0);
}

const linear = (hex: string) => hexToLinear(hex).map((c) => Math.round(c * 1e4) / 1e4);
function bandColors(band: ZoneBandBatch): string[] {
  const col = band.mesh.geometry.getAttribute('aColor').array as Float32Array;
  const seen = new Set<string>();
  for (let v = 0; v < band.mesh.geometry.drawRange.count; v++) {
    seen.add([col[v * 3], col[v * 3 + 1], col[v * 3 + 2]].map((c) => Math.round(c * 1e4) / 1e4).join(','));
  }
  return [...seen];
}

describe('objective zone over a town (#470)', () => {
  it('draws nothing over the zone interior in the over-everything overlay tier', () => {
    const { priv } = draw([{ id: 'town', rect: TOWN, state: 'held' }]);
    const centre: [number, number] = [TOWN[0] + TOWN[2] / 2, TOWN[1] + TOWN[3] / 2];
    const tris = trianglesXZ(priv.overlayBatch.mesh);
    expect(tris.length).toBeGreaterThan(0); // the outline still draws
    expect(tris.some((t) => contains(t, centre))).toBe(false);
  });

  it('keeps the outline exactly: a halo then a stroke per zone, the stroke dashed for not held and contested only', () => {
    const states: ObjectiveZoneView['state'][] = ['held', 'unheld', 'contested', 'target'];
    const { stroke } = draw(states.map((state, i) => ({ id: state, rect: [i * 5, 0, 4, 4], state })));
    expect(stroke).toHaveBeenCalledTimes(8);
    const dashed = states.map((_, i) => stroke.mock.calls[i * 2 + 1][4] !== undefined);
    expect(dashed).toEqual([false, true, true, false]);
  });

  it('draws the band on the ground, inside the edge only', () => {
    const { priv } = draw([{ id: 'town', rect: TOWN, state: 'held' }]);
    const [zx, zy, zw, zh] = TOWN;
    const tris = trianglesXZ(priv.zoneBand.mesh);
    expect(tris.length).toBeGreaterThan(0);
    for (const t of tris) {
      for (const [x, z] of t) {
        expect(x).toBeGreaterThanOrEqual(zx);
        expect(x).toBeLessThanOrEqual(zx + zw);
        expect(z).toBeGreaterThanOrEqual(zy);
        expect(z).toBeLessThanOrEqual(zy + zh);
      }
      // Every band triangle has a vertex within the band of an edge.
      const nearest = Math.min(...t.map(([x, z]) => Math.min(x - zx, zx + zw - x, z - zy, zy + zh - z)));
      expect(nearest).toBeLessThan(0.5);
    }
    const centre: [number, number] = [zx + zw / 2, zy + zh / 2];
    expect(tris.some((t) => contains(t, centre))).toBe(false);
    expect(priv.zoneBand.mesh.material).toMatchObject({ depthTest: true, depthWrite: false });
  });

  it('wears each state\'s own colour: held vfx.tracer, not held team.neutral, contested and target team.hostile', () => {
    // Literal hexes: the palette's own, as `overlays.test.ts` pins the outline.
    const expected: Record<ObjectiveZoneView['state'], string> = {
      held: '#B8FF5A',
      unheld: '#E8C33A',
      contested: '#D93A2B',
      target: '#D93A2B',
    };
    for (const state of Object.keys(expected) as ObjectiveZoneView['state'][]) {
      const { priv } = draw([{ id: state, rect: TOWN, state }]);
      expect(bandColors(priv.zoneBand)).toEqual([linear(expected[state]).join(',')]);
    }
  });

  it('follows a colour-vision variant through the same resolver the outline uses', () => {
    const variant = (key: string) => (key === 'team.neutral' ? '#F0E442' : '#000000');
    const { priv, stroke } = draw([{ id: 'town', rect: TOWN, state: 'unheld' }], variant);
    expect(bandColors(priv.zoneBand)).toEqual([linear('#F0E442').join(',')]);
    expect(stroke.mock.calls[1][2]).toBe('#F0E442');
  });

  it('costs one mesh for every zone on screen, and none when there is no zone', () => {
    const none = draw([]);
    expect(none.priv.zoneBand.mesh.visible).toBe(false);
    const three = draw([
      { id: 'a', rect: [0, 0, 4, 4], state: 'held' },
      { id: 'b', rect: [6, 0, 4, 4], state: 'unheld' },
      { id: 'c', rect: [12, 0, 4, 4], state: 'target' },
    ]);
    expect(three.priv.zoneBand.mesh.visible).toBe(true);
    const bands = three.priv.scene.getObjectsByProperty('name', 'zone-band');
    expect(bands).toHaveLength(1);
  });
});
