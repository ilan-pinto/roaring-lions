/**
 * The HP-bar visibility rule (GH-186, A4): a bar draws only for a unit that
 * is damaged, selected or hovered. Pinned through the REAL `updateOverlays`,
 * spying `overlayBatch.rect`, on the `ThreeRenderer.route.test.ts` fixture
 * pattern. Bars are identified by anchor: every bar is three rects (frame,
 * backing, fill) sharing one world anchor, so the anchor set IS the set of
 * units with a bar.
 */
import { describe, it, expect, vi } from 'vitest';
import { Sim, fx, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import type { OverlayBatch } from './units/overlays';
import { HP_BAR } from './units/readability';

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

const TANK: UnitTypeJson = {
  id: 'hp_tank',
  role: 'tank',
  hull: { hp: 900, armor: { front: 40, side: 30, rear: 20 } },
  mobility: { speed_tiles_s: 4 },
  sensors: { optics: 2, sight_tiles: 14, signature: 0.9 },
};
const RIFLES: UnitTypeJson = {
  id: 'hp_rifles',
  role: 'infantry',
  hull: { hp: 300, armor: { front: 8, side: 8, rear: 8 } },
  mobility: { speed_tiles_s: 1.2 },
  sensors: { optics: 1, sight_tiles: 12, signature: 0.6 },
};

interface Priv {
  overlayBatch: OverlayBatch;
  updateOverlays(alpha: number): void;
}

const AT = {
  healthy: [6.5, 6.5],
  damaged: [10.5, 6.5],
  squad: [14.5, 6.5],
  hostile: [18.5, 6.5],
} as const;

function setUp() {
  const sim = new Sim({ seed: 1, width: 24, height: 24, capacity: 16 });
  const tank = sim.addUnitType(TANK);
  const rifles = sim.addUnitType(RIFLES);
  const healthy = sim.spawn(tank, 0, fx.from(AT.healthy[0]), fx.from(AT.healthy[1]));
  const damaged = sim.spawn(tank, 0, fx.from(AT.damaged[0]), fx.from(AT.damaged[1]));
  const squad = sim.spawn(rifles, 0, fx.from(AT.squad[0]), fx.from(AT.squad[1]));
  const hostile = sim.spawn(tank, 1, fx.from(AT.hostile[0]), fx.from(AT.hostile[1]));
  sim.state.hp[damaged] -= 1;
  const renderer = new ThreeRenderer(sim, makeOpts());
  const priv = renderer as unknown as Priv;
  renderer.snapshot();
  renderer.snapshot();
  const rect = vi.spyOn(priv.overlayBatch, 'rect');
  const draw = (): void => {
    rect.mockClear();
    priv.updateOverlays(1);
  };
  /** The rects grouped by world anchor (x, z), in call order. */
  const barsByAnchor = (): Map<string, number[][]> => {
    const by = new Map<string, number[][]>();
    for (const c of rect.mock.calls) {
      const a = c[0];
      const key = `${a[0]},${a[2]}`;
      const list = by.get(key) ?? [];
      list.push([c[1], c[2], c[3], c[4]]);
      by.set(key, list);
    }
    return by;
  };
  const alphasAt = (at: readonly number[]): number[] =>
    rect.mock.calls.filter((c) => c[0][0] === at[0] && c[0][2] === at[1]).map((c) => c[6]);
  const key = (at: readonly number[]): string => `${at[0]},${at[1]}`;
  return { sim, renderer, healthy, damaged, squad, hostile, draw, barsByAnchor, key, alphasAt };
}

describe('HP bar visibility (GH-186)', () => {
  it('draws a bar at the damaged tank and the selected squad, and none at the healthy tank', () => {
    const w = setUp();
    w.renderer.selection = [w.squad];
    w.draw();
    const bars = w.barsByAnchor();
    expect(bars.has(w.key(AT.damaged))).toBe(true);
    expect(bars.has(w.key(AT.squad))).toBe(true);
    expect(bars.has(w.key(AT.healthy))).toBe(false);
  });

  it('a hovered hostile gets a bar (hoverEntity)', () => {
    const w = setUp();
    w.draw();
    expect(w.barsByAnchor().has(w.key(AT.hostile))).toBe(false);
    w.renderer.hoverEntity = w.hostile;
    w.draw();
    expect(w.barsByAnchor().has(w.key(AT.hostile))).toBe(true);
  });

  it('a friendly under the cursor gets a bar (rangeRingPreview)', () => {
    const w = setUp();
    w.draw();
    expect(w.barsByAnchor().has(w.key(AT.healthy))).toBe(false);
    w.renderer.rangeRingPreview = w.healthy;
    w.draw();
    expect(w.barsByAnchor().has(w.key(AT.healthy))).toBe(true);
  });

  it('every drawn bar is exactly three rects: a frame HP_BAR.widthPx + 2 * framePx wide, a backing, and a fill', () => {
    const w = setUp();
    w.renderer.selection = [w.squad];
    w.draw();
    const bars = w.barsByAnchor();
    for (const at of [AT.damaged, AT.squad]) {
      const rects = bars.get(w.key(at)) ?? [];
      // The suppression bar is a fourth rect only for a suppressed unit;
      // nobody here is.
      expect(rects, `rects at ${at}`).toHaveLength(3);
      const [frame, backing, fill] = rects;
      expect(frame[2] - frame[0]).toBe(HP_BAR.widthPx + 2 * HP_BAR.framePx);
      expect(frame[3] - frame[1]).toBe(HP_BAR.heightPx + 2 * HP_BAR.framePx);
      expect(backing[2] - backing[0]).toBe(HP_BAR.widthPx);
      expect(backing[3] - backing[1]).toBe(HP_BAR.heightPx);
      expect(fill[2] - fill[0]).toBeLessThanOrEqual(HP_BAR.widthPx);
    }
  });

  it('the frame is drawn at HP_BAR.frameAlpha and the fill at full alpha', () => {
    const w = setUp();
    w.draw();
    const rects = w.barsByAnchor().get(w.key(AT.damaged)) ?? [];
    expect(rects).toHaveLength(3);
    expect(w.alphasAt(AT.damaged)).toEqual([HP_BAR.frameAlpha, 0.8, 1]);
  });
});
