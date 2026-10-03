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

/** GH-346's approved selected-ring scale, as a LITERAL: an oracle that read
 *  `SELECTED_RING_SCALE` would agree with any value it was given. */
const SELECTED = 1.25;
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
  teamRing: SelectionRingBatch;
  isVisible(x: number, y: number): boolean;
  selectionRingGroup: THREE.Group;
  updateOverlays(alpha: number): void;
  refreshSurface(): void;
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
  const keys: number[] = [];
  const spyPush = (): void => {
    const batch = priv.selectionRing;
    const real = batch.push.bind(batch);
    vi.spyOn(batch, 'push').mockImplementation((p, sampleY, key) => {
      pushed.push({ ...p });
      keys.push(key ?? -1);
      return real(p, sampleY, key);
    });
  };
  spyPush();
  const ellipse = vi.spyOn(priv.overlayBatch, 'ellipseRing');
  const draw = (): void => {
    pushed.length = 0;
    keys.length = 0;
    ellipse.mockClear();
    priv.updateOverlays(1);
  };
  return { sim, renderer, priv, a, b, tank, inside, pushed, keys, ellipse, draw, spyPush, rifles };
}

describe('selection ring wiring (GH-186)', () => {
  it('a selected unit on open ground pushes exactly one ring, in TEAM colour at its class radius, and no billboard', () => {
    const w = setUp();
    w.renderer.selection = [w.a];
    w.draw();
    expect(w.pushed).toHaveLength(1);
    const p = w.pushed[0];
    const type = w.sim.unitTypes[w.rifles];
    expect(p.radiusTiles).toBe(SELECTION_RING.radiusTiles[ringClassOf(type)] * SELECTED);
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
    expect(p.alongTiles).toBe(ELLIPSE_BY_TYPE.mbt_lavi.along * SELECTED);
    expect(p.acrossTiles).toBe(ELLIPSE_BY_TYPE.mbt_lavi.across * SELECTED);
    expect(p.headingRad).toBeCloseTo(0.25 * 2 * Math.PI, 6);
    // Fix round 1: centred on the HULL, `offsetAlong` along the heading
    // (the Lavi's hull box sits 0.18 tile behind its origin). Facing 0.25 turns
    // points +Z, so the centre moves 0.18 toward -Z.
    const off = ELLIPSE_BY_TYPE.mbt_lavi.offsetAlong;
    expect(off).toBeLessThan(0);
    expect(p.x).toBeCloseTo(12.5, 6);
    expect(p.z).toBeCloseTo(6.5 + off, 6);
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

  it('each push carries its entity id, so the batch can cache a stationary ring (fix round 1)', () => {
    const w = setUp();
    w.renderer.selection = [w.a, w.tank];
    w.draw();
    expect(w.keys).toEqual([w.a, w.tank]);
  });

  it('a ground rebuild invalidates the ring cache', () => {
    const w = setUp();
    const inv = vi.spyOn(w.priv.selectionRing, 'invalidate');
    w.priv.refreshSurface();
    expect(inv).toHaveBeenCalled();
  });
});

describe('team ring and contact marks (GH-346)', () => {
  it('every UNSELECTED unit on open ground gets a 1x team ring; the selected one and the garrisoned one do not', () => {
    const w = setUp();
    const pushed: RingPlacement[] = [];
    const keys: number[] = [];
    const team = w.priv.teamRing;
    const real = team.push.bind(team);
    vi.spyOn(team, 'push').mockImplementation((p, sampleY, key) => {
      pushed.push({ ...p });
      keys.push(key ?? -1);
      return real(p, sampleY, key);
    });
    w.renderer.selection = [w.a];
    w.draw();
    expect(keys).toEqual([w.b, w.tank]);
    const type = w.sim.unitTypes[w.rifles];
    expect(pushed[0].radiusTiles).toBe(SELECTION_RING.radiusTiles[ringClassOf(type)]);
    expect(pushed[0].color).toEqual(cachedHexToLinear(TEAM[0]));
    expect(pushed[1].alongTiles).toBe(ELLIPSE_BY_TYPE.mbt_lavi.along);
    expect(team.mesh.visible).toBe(true);
    expect(team.mesh.parent).toBe(w.priv.selectionRingGroup);
  });

  it('an observed hostile wears a contact mark in the hostile team colour: hollow while suspected, a chevron once identified', () => {
    const w = setUp();
    const foe = w.sim.spawn(w.rifles, 1, fx.from(4.5), fx.from(14.5));
    const civ = w.sim.spawn(w.rifles, 2, fx.from(8.5), fx.from(14.5));
    w.renderer.snapshot();
    w.renderer.snapshot();
    w.priv.isVisible = () => true;
    const tri = vi.spyOn(w.priv.overlayBatch, 'triangle');
    const hostileFills = (): number => tri.mock.calls.filter((c) => c[2] === TEAM[1]).length;
    w.draw();
    // Suspected (contact level 0): the hollow diamond, eight triangles.
    expect(w.sim.contactLevel(0, foe)).toBe(0);
    expect(hostileFills()).toBe(8);
    // Nothing in the player's or the neutral colour: only side 1 is marked.
    expect(tri.mock.calls.some((c) => c[2] === TEAM[0] || c[2] === TEAM[2])).toBe(false);
    expect(civ).toBeGreaterThan(foe);
    tri.mockClear();
    w.sim.identifyTo(0, foe);
    w.draw();
    expect(hostileFills()).toBe(1);
    // Unobserved: no mark at all.
    tri.mockClear();
    w.priv.isVisible = () => false;
    w.draw();
    expect(hostileFills()).toBe(0);
  });
});
