/**
 * The kit mark on the map (WP-S3g plan 2, Task 3), pinned through the REAL
 * `updateOverlays`: the failure worth catching is a mark whose geometry is
 * right (Task 1) and whose wiring is not. The draw hands `OverlayBatch.triangle`
 * the frozen lists `kitMarkTriangles` returns, so the kit's calls are found by
 * IDENTITY among everything else the pass pushes.
 *
 * Harness copied from `ThreeRenderer.route.test.ts`: a faked `WebGLRenderer`,
 * and `renderer.snapshot()` driving the interpolation buffers.
 */
import { describe, it, expect, vi } from 'vitest';
import { Sim, fx, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import type { ChevronBatch, NumeralBatch, OverlayBatch } from './units/overlays';
import { KIT_COLOR_KEY, KIT_EDGE_COLOR_KEY, kitMarkTriangles, type KitMarkLevel, type MarkPoint } from './units/kit-mark';

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
  crownRatio: 0.52, scatter: 'stone', groveFamily: 'desert_tree',
};

const STEEL = '#C3C7C4';
const EDGE = '#23241F';
const OTHER = '#8E9491';

function makeOpts(unitKit?: RendererOptions['unitKit']): RendererOptions {
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
    resolveColor: (key) => (key === KIT_COLOR_KEY ? STEEL : key === KIT_EDGE_COLOR_KEY ? EDGE : OTHER),
    ...(unitKit ? { unitKit } : {}),
  };
}

/** Soft (front armour 10 mm < 30 mm, `SOFT_ARMOR_LIMIT`), so r = 7. */
const RIFLES: UnitTypeJson = {
  id: 'inf_squad',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.9 },
  sensors: { optics: 1, sight_tiles: 8, signature: 0.6 },
};
/** Hard, so r = 11; a real key in every closed table this backend consults. */
const DOZER: UnitTypeJson = {
  id: 'dozer_d9',
  role: 'engineer',
  hull: { hp: 900, armor: { front: 40, side: 30, rear: 20 } },
  mobility: { speed_tiles_s: 4 },
  sensors: { optics: 2, sight_tiles: 14, signature: 0.9 },
};

interface Privates {
  overlayBatch: OverlayBatch;
  chevronBatch: ChevronBatch;
  numeralBatch: NumeralBatch;
  fog: Uint8Array;
  updateOverlays(alpha: number): void;
}

interface Spawn {
  readonly type: 'rifles' | 'dozer';
  readonly side: number;
  readonly veterancy?: number;
}

function setUp(unitKit: RendererOptions['unitKit'], spawns: readonly Spawn[], capacity = 8) {
  const sim = new Sim({ seed: 1, width: 48, height: 48, capacity });
  const rifles = sim.addUnitType(RIFLES);
  const dozer = sim.addUnitType(DOZER);
  const ids = spawns.map((s, k) =>
    sim.spawn(
      s.type === 'rifles' ? rifles : dozer,
      s.side,
      fx.from(1.5 + (k % 11) * 2),
      fx.from(1.5 + Math.floor(k / 11) * 2),
      0,
      s.veterancy ?? 0
    )
  );
  const renderer = new ThreeRenderer(sim, makeOpts(unitKit));
  const priv = renderer as unknown as Privates;
  renderer.snapshot();
  renderer.snapshot();
  priv.fog.fill(2); // every tile visible, after the snapshots: a side-1 unit reaches the overlay pass
  const triangle = vi.spyOn(priv.overlayBatch, 'triangle');
  const rect = vi.spyOn(priv.overlayBatch, 'rect');
  return { sim, renderer, priv, ids, triangle, rect };
}

type TriangleCall = [readonly [number, number, number], readonly (readonly [number, number])[], string, number];

/** The kit's own calls, found by identity with the frozen lists. */
function kitCalls(calls: readonly TriangleCall[], r: number, level: KitMarkLevel): TriangleCall[] {
  const t = kitMarkTriangles(r, level);
  const mine: readonly (readonly MarkPoint[])[] = [t.edge, t.steel, t.bars];
  return calls.filter(([, pts]) => mine.includes(pts));
}

/** Every kit call at either radius and any level: edge, steel and bars alike. */
const anyKitCalls = (calls: readonly TriangleCall[]): number =>
  [7, 11].reduce((n, r) => n + ([1, 2, 3] as const).reduce((m, l) => m + kitCalls(calls, r, l).length, 0), 0);

describe('the kit mark on the map (WP-S3g plan 2)', () => {
  it("draws a level-2 dozer's plate, steel and two bars, in that order and those colours", () => {
    const { priv, triangle } = setUp({ dozer_d9: 2 }, [{ type: 'dozer', side: 0 }]);
    priv.updateOverlays(1);
    const t = kitMarkTriangles(11, 2);
    const calls = kitCalls(triangle.mock.calls as TriangleCall[], 11, 2);
    expect(calls.map(([, pts, color, alpha]) => [pts, color, alpha])).toEqual([
      [t.edge, EDGE, 1],
      [t.steel, STEEL, 1],
      [t.bars, EDGE, 1],
    ]);
  });

  it('uses the soft radius for infantry', () => {
    const { priv, triangle } = setUp({ inf_squad: 1 }, [{ type: 'rifles', side: 0 }]);
    priv.updateOverlays(1);
    const calls = triangle.mock.calls as TriangleCall[];
    expect(kitCalls(calls, 7, 1)).toHaveLength(3);
    expect(kitCalls(calls, 11, 1)).toHaveLength(0);
  });

  it('anchors the mark where the HP bar is anchored', () => {
    const { priv, triangle, rect } = setUp({ dozer_d9: 3 }, [{ type: 'dozer', side: 0 }]);
    priv.updateOverlays(1);
    const hpAnchor = rect.mock.calls[0][0];
    for (const [anchor] of kitCalls(triangle.mock.calls as TriangleCall[], 11, 3)) expect(anchor).toEqual(hpAnchor);
  });

  it('draws nothing at level 0, for a type the option does not name, or with no option', () => {
    const kits: readonly RendererOptions['unitKit'][] = [{ dozer_d9: 0 }, { inf_squad: 3 }, undefined];
    for (const kit of kits) {
      const { priv, triangle } = setUp(kit, [{ type: 'dozer', side: 0 }]);
      priv.updateOverlays(1);
      expect(anyKitCalls(triangle.mock.calls as TriangleCall[]), JSON.stringify(kit)).toBe(0);
    }
  });

  it("never marks another side's unit, even one in plain sight", () => {
    const { priv, triangle, rect } = setUp({ dozer_d9: 3 }, [
      { type: 'rifles', side: 0 },
      { type: 'dozer', side: 1 },
    ]);
    priv.updateOverlays(1);
    // Precondition, asserted: both units reached the pass -- two HP-bar
    // backgrounds, told from the full-health fill (same span) by alpha 0.8.
    expect(rect.mock.calls.filter((c) => c[1] === -12 && c[3] === 12 && c[6] === 0.8)).toHaveLength(2);
    expect(anyKitCalls(triangle.mock.calls as TriangleCall[])).toBe(0);
  });

  it('hides with the kit-mark layer and nothing else, and comes back', () => {
    const { renderer, priv, triangle, rect } = setUp({ dozer_d9: 1 }, [{ type: 'dozer', side: 0 }]);
    expect(renderer.setDebugLayerVisible('kit-mark', false)).toBe(1);
    priv.updateOverlays(1);
    expect(anyKitCalls(triangle.mock.calls as TriangleCall[])).toBe(0);
    expect(rect).toHaveBeenCalled(); // the HP bar shares the batch and still draws
    expect(renderer.setDebugLayerVisible('kit-mark', true)).toBe(1);
    triangle.mockClear();
    priv.updateOverlays(1);
    expect(kitCalls(triangle.mock.calls as TriangleCall[], 11, 1)).toHaveLength(3);
  });

  it('gives a veteran both registers: the gold chevron and the steel plate', () => {
    const { priv, triangle } = setUp({ dozer_d9: 3 }, [{ type: 'dozer', side: 0, veterancy: 2 }]);
    // Recorded, not run: the chevron's texture is a 2D canvas, which this
    // node environment does not have (`buildChevronTexture`, overlays.ts).
    const push = vi.spyOn(priv.chevronBatch, 'push').mockImplementation(() => undefined);
    priv.updateOverlays(1);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][5]).toBe(2);
    expect(kitCalls(triangle.mock.calls as TriangleCall[], 11, 3)).toHaveLength(3);
  });

  it('resolves a type registered after the renderer was built', () => {
    const { sim, renderer, priv, triangle } = setUp({ dozer_d9: 1, at_team: 2 }, [{ type: 'dozer', side: 0 }]);
    // One pass first, so the table is already built at two types when the
    // third arrives: it has to REBUILD on the count changing, not merely
    // build lazily once.
    priv.updateOverlays(1);
    // A real id (closed tables), soft like the rifles, registered late.
    const late = sim.addUnitType({ ...RIFLES, id: 'at_team' });
    sim.spawn(late, 0, fx.from(9.5), fx.from(9.5));
    renderer.snapshot();
    renderer.snapshot();
    priv.updateOverlays(1);
    expect(kitCalls(triangle.mock.calls as TriangleCall[], 7, 2)).toHaveLength(3);
  });

  it('fits the overlay budget with every own unit selected, grouped and marked at level 3', () => {
    const N = 200;
    const spawns: Spawn[] = Array.from({ length: N }, () => ({ type: 'rifles', side: 0 }));
    const { renderer, priv, ids } = setUp({ inf_squad: 3 }, spawns, N);
    // The badge numeral's texture is a 2D canvas too, and it is not in this batch.
    vi.spyOn(priv.numeralBatch, 'push').mockImplementation(() => undefined);
    renderer.selection = [...ids];
    for (const id of ids) renderer.unitGroup[id] = 1;
    priv.updateOverlays(1);
    const soup = (priv.overlayBatch as unknown as { soup: { count: number; capacity: number } }).soup;
    // HP background 6 + fill 6 + selection ring 96 + badge 48 + mark 42 = 198 a unit.
    expect(soup.count).toBe(N * 198);
    expect(soup.count).toBeLessThan(soup.capacity);
  });
});
