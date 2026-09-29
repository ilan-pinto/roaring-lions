/**
 * A4 Task 5 (GH-186): the selection ring is WIRED -- a selected unit on open
 * ground pushes one ground ring (`units/selection-ring.ts`) in TEAM colour,
 * and the old flat billboard ellipse survives only where the ground ring
 * cannot go: a garrisoned unit's roof (Q7) and a batch that is full.
 *
 * Pinned through the REAL `updateOverlays`, on the
 * `ThreeRenderer.hp-visibility.test.ts` fixture: `selectionRing.push` is
 * spied (with each placement COPIED, because the renderer reuses one scratch
 * object) and `overlayBatch.ellipseRing` counted. The fixture's types are
 * unarmed, so no range envelope -- the other `ellipseRing` caller -- draws.
 */
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { Sim, fx, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import { cachedHexToLinear, type OverlayBatch } from './units/overlays';
import { ELLIPSE_BY_TYPE, ringClassOf, SELECTION_RING } from './units/readability';
import { SelectionRingBatch, type RingPlacement } from './units/selection-ring';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    outputColorSpace = actual.SRGBColorSpace;
    domElement: unknown = {};
    setClearColor(): void {}
    getContext(): { isContextLost(): boolean } {
      return { isContextLost: () => false };
    }
    forceContextLoss(): void {}
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

/** Team and group colours deliberately DISJOINT, so a ring coloured from the
 *  wrong one cannot pass by coincidence. */
const TEAM: [string, string, string] = ['#2F6FD9', '#C8402A', '#8E9491'];
const GROUP = ['#B8FF5A', '#6FE0FF', '#FFCE5A', '#3A3C33', '#E6D8BE', '#4E5433', '#8E9491', '#F2E8D5', '#6E7449'];

function makeOpts(): RendererOptions {
  return {
    background: '#14150F',
    teamColors: TEAM,
    hullColors: ['#8F9464', '#6E7449', '#4E5433'],
    infantryColors: ['#8F9464', '#6E7449', '#4E5433'],
    groupColors: GROUP,
    terrainTones: TONES,
    tracerColors: ['#F2E8D5', '#E6D8BE'],
    shellColors: ['#FFB43C', '#E8541E'],
    flashColor: '#F2E8D5',
    nearMissColor: '#6E7449',
    interceptColor: '#8E9491',
  };
}

const RIFLES: UnitTypeJson = {
  id: 'ring_rifles',
  role: 'infantry',
  hull: { hp: 300, armor: { front: 8, side: 8, rear: 8 } },
  mobility: { speed_tiles_s: 1.2 },
  sensors: { optics: 1, sight_tiles: 12, signature: 0.6 },
};
/** Carries a shipped vehicle id so its row in `ELLIPSE_BY_TYPE` applies. */
const LAVI: UnitTypeJson = {
  id: 'mbt_lavi',
  role: 'tank',
  hull: { hp: 900, armor: { front: 40, side: 30, rear: 20 } },
  mobility: { speed_tiles_s: 4 },
  sensors: { optics: 2, sight_tiles: 14, signature: 0.9 },
};

interface Priv {
  overlayBatch: OverlayBatch;
  selectionRing: SelectionRingBatch;
  selectionRingGroup: THREE.Group;
  updateOverlays(alpha: number): void;
}

function setUp() {
  const sim = new Sim({ seed: 1, width: 24, height: 24, capacity: 16 });
  const rifles = sim.addUnitType(RIFLES);
  const lavi = sim.addUnitType(LAVI);
  const hut = sim.addStructureType({ id: 'hut', hp_per_tile: 80, height_px: 14, color: 'dust.1' });
  const hutId = sim.addStructure(hut, [12 * 24 + 18]);
  const a = sim.spawn(rifles, 0, fx.from(6.5), fx.from(6.5));
  const b = sim.spawn(rifles, 0, fx.from(9.5), fx.from(6.5));
  const tank = sim.spawn(lavi, 0, fx.from(12.5), fx.from(6.5));
  const inside = sim.spawn(rifles, 0, fx.from(18.5), fx.from(12.5));
  sim.state.garrisonedIn[inside] = hutId;
  sim.state.facing[tank] = fx.from(0.25);
  const renderer = new ThreeRenderer(sim, makeOpts());
  const priv = renderer as unknown as Priv;
  renderer.snapshot();
  renderer.snapshot();
  const pushed: RingPlacement[] = [];
  const spyPush = (): void => {
    const batch = priv.selectionRing;
    const real = batch.push.bind(batch);
    vi.spyOn(batch, 'push').mockImplementation((p, sampleY) => {
      pushed.push({ ...p });
      return real(p, sampleY);
    });
  };
  spyPush();
  const ellipse = vi.spyOn(priv.overlayBatch, 'ellipseRing');
  const draw = (): void => {
    pushed.length = 0;
    ellipse.mockClear();
    priv.updateOverlays(1);
  };
  return { sim, renderer, priv, a, b, tank, inside, pushed, ellipse, draw, spyPush, rifles };
}

describe('selection ring wiring (GH-186)', () => {
  it('a selected unit on open ground pushes exactly one ring, in TEAM colour at its class radius, and no billboard', () => {
    const w = setUp();
    w.renderer.selection = [w.a];
    w.draw();
    expect(w.pushed).toHaveLength(1);
    const p = w.pushed[0];
    const type = w.sim.unitTypes[w.rifles];
    expect(p.radiusTiles).toBe(SELECTION_RING.radiusTiles[ringClassOf(type)]);
    expect(p.color).toEqual(cachedHexToLinear(TEAM[0]));
    // Not the group colour, nor the accent a group-less unit's old ring fell
    // back to (with no resolver that is '#B8FF5A', which is GROUP[0] here).
    expect(p.color).not.toEqual(cachedHexToLinear(GROUP[0]));
    expect(p.alongTiles).toBeUndefined();
    expect(p.x).toBeCloseTo(6.5, 6);
    expect(p.z).toBeCloseTo(6.5, 6);
    expect(w.ellipse).not.toHaveBeenCalled();
    expect(w.priv.selectionRing.count).toBe(1);
    expect(w.priv.selectionRing.mesh.visible).toBe(true);
  });

  it('a ground vehicle pushes its hull-aligned ellipse, turned to its heading (G-MOCK)', () => {
    const w = setUp();
    w.renderer.selection = [w.tank];
    w.draw();
    expect(w.pushed).toHaveLength(1);
    const p = w.pushed[0];
    expect(p.alongTiles).toBe(ELLIPSE_BY_TYPE.mbt_lavi.along);
    expect(p.acrossTiles).toBe(ELLIPSE_BY_TYPE.mbt_lavi.across);
    expect(p.headingRad).toBeCloseTo(0.25 * 2 * Math.PI, 6);
    // It turns with the hull, frame by frame.
    w.sim.state.facing[w.tank] = fx.from(0.5);
    w.draw();
    expect(w.pushed[0].headingRad).toBeCloseTo(Math.PI, 6);
    expect(w.ellipse).not.toHaveBeenCalled();
  });

  it('a garrisoned selected unit pushes no ring and one billboard ellipse at roof height (Q7)', () => {
    const w = setUp();
    w.renderer.selection = [w.inside];
    w.draw();
    expect(w.pushed).toHaveLength(0);
    expect(w.ellipse).toHaveBeenCalledTimes(1);
    const [centre, , , width, , alpha] = w.ellipse.mock.calls[0];
    expect(centre[0]).toBeCloseTo(18.5, 6);
    expect(centre[1]).toBeGreaterThan(0); // lifted onto the roof, off flat ground at 0
    expect(width).toBe(2);
    expect(alpha).toBe(1);
    expect(w.priv.selectionRing.mesh.visible).toBe(false);
  });

  it('past capacity the ring falls back to the billboard: capacity 2, 3 selected -> 2 rings and 1 billboard', () => {
    const w = setUp();
    const small = new SelectionRingBatch({ capacity: 2, resolveShadow: () => [0, 0, 0] });
    (w.priv as unknown as { selectionRing: SelectionRingBatch }).selectionRing = small;
    w.spyPush();
    w.renderer.selection = [w.a, w.b, w.tank];
    w.draw();
    expect(small.count).toBe(2);
    expect(w.ellipse).toHaveBeenCalledTimes(1);
    small.dispose();
  });

  it('with no selection the ring mesh is not visible, and it costs no draw', () => {
    const w = setUp();
    w.renderer.selection = [w.a];
    w.draw();
    expect(w.priv.selectionRing.mesh.visible).toBe(true);
    w.renderer.selection = [];
    w.draw();
    expect(w.pushed).toHaveLength(0);
    expect(w.priv.selectionRing.mesh.visible).toBe(false);
  });

  it("setDebugLayerVisible('overlays', false) hides the ring too, it stays hidden across frames, and the count includes it", () => {
    const w = setUp();
    w.renderer.selection = [w.a];
    expect(w.renderer.setDebugLayerVisible('overlays', false)).toBe(7);
    w.draw();
    w.draw();
    // `endFrame` re-asserts the MESH's own visibility every frame; the layer
    // hides its parent group, which nothing per-frame writes.
    expect(w.priv.selectionRing.mesh.visible).toBe(true);
    expect(w.priv.selectionRing.mesh.parent).toBe(w.priv.selectionRingGroup);
    expect(w.priv.selectionRingGroup.visible).toBe(false);
    expect(w.renderer.setDebugLayerVisible('overlays', true)).toBe(7);
    expect(w.priv.selectionRingGroup.visible).toBe(true);
  });

  it('the halo colour is a CACHED linear tuple: shadow.1, the same array every frame, no per-frame hex parse', () => {
    const w = setUp();
    const resolve = (w.priv.selectionRing as unknown as { resolveShadow: () => readonly number[] }).resolveShadow;
    const first = resolve();
    expect(resolve()).toBe(first);
    expect(first).toEqual(cachedHexToLinear('#14150F'));
  });
});
