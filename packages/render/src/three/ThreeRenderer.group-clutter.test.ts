/**
 * WP-P3 (PA-09): a group selection must stay readable. Fourteen units
 * selected and ordered as one group used to draw fourteen range envelopes and
 * fourteen route lines, one per unit, over the very ground being ordered onto
 * (polish audit, play-31/play-32).
 *
 * The rule pinned here, through the REAL `updateOverlays` and read back from
 * the renderer's own `overlayCensus` (counted at the draw calls):
 *
 * - at most TWO range envelopes: the selection's primary, plus the friendly
 *   under the cursor as a preview;
 * - ONE route per command: the units an order sent to one place draw one
 *   merged path and one destination mark, and the order crosshair stays one;
 * - every selected unit keeps its own ground ring (#354), and in a group the
 *   primary's ring reads differently from the rest (pass A1).
 *
 * Falsified against the one-per-unit path it replaced: 14 envelopes,
 * 14 routes, 14 destinations.
 */
import { describe, it, expect, vi } from 'vitest';
import { Sim, fx, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import { paletteHex } from './palette-hex';
import type { OverlayBatch } from './units/overlays';
import type { RingPlacement, SelectionRingBatch } from './units/selection-ring';

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
    teamColors: ['#2F6FD9', '#D93A2B', '#E8C33A'],
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

const RIFLES: UnitTypeJson = {
  id: 'gc_rifles',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.6 },
  sensors: { optics: 1, sight_tiles: 9 },
  weapons: [
    {
      id: 'rifles', type: 'small_arms', range_tiles: 9, effective_range_tiles: 7,
      accuracy: 0.6, penetration: 8, damage: 15, suppression: 50, rof_per_min: 300,
    },
  ],
};

interface Priv {
  overlayBatch: OverlayBatch;
  selectionRing: SelectionRingBatch;
  updateOverlays(alpha: number): void;
}

const GROUP = 14;
const DEST: [number, number] = [34.5, 20.5];

/** Fourteen rifle squads in two ranks of seven on the west side of a 48x48
 *  map, plus one more friendly that is NOT selected (the hover preview's
 *  subject). Nothing hostile, so nothing fights. */
function setUp() {
  const sim = new Sim({ seed: 7, width: 48, height: 48, capacity: 32 });
  const rifles = sim.addUnitType(RIFLES);
  const ids: number[] = [];
  for (let k = 0; k < GROUP; k++) {
    ids.push(sim.spawn(rifles, 0, fx.from(6.5 + (k % 7)), fx.from(18.5 + Math.floor(k / 7) * 2)));
  }
  const spare = sim.spawn(rifles, 0, fx.from(6.5), fx.from(30.5));
  const renderer = new ThreeRenderer(sim, makeOpts());
  const priv = renderer as unknown as Priv;
  const rings: { key: number; color: number[] }[] = [];
  const push = priv.selectionRing.push.bind(priv.selectionRing);
  vi.spyOn(priv.selectionRing, 'push').mockImplementation((p: RingPlacement, sampleY, key = -1) => {
    rings.push({ key, color: [...p.color] });
    return push(p, sampleY, key);
  });
  /** Ticks the sim, then takes the two snapshots the renderer interpolates
   *  between, so every unit has a position copy and a route to draw. */
  const advance = (ticks: number): void => {
    for (let t = 0; t < ticks; t++) sim.tick();
    renderer.snapshot();
    renderer.snapshot();
  };
  // The draw calls themselves, beside the census: `ellipseAnnulusFill` has
  // one caller (the range envelope's fill) and `lineWorld` one (a route
  // leg), so a draw path that counted one thing and drew another would
  // disagree with these.
  const annulus = vi.spyOn(priv.overlayBatch, 'ellipseAnnulusFill');
  const lines = vi.spyOn(priv.overlayBatch, 'lineWorld');
  const draw = (): ThreeRenderer['overlayCensus'] => {
    rings.length = 0;
    annulus.mockClear();
    lines.mockClear();
    priv.updateOverlays(1);
    return renderer.overlayCensus;
  };
  const order = (who: readonly number[], at: readonly [number, number]): void => {
    sim.queueCommand({ kind: 'move', ids: [...who], x: fx.from(at[0]), y: fx.from(at[1]) });
    renderer.addOrderMarker(at[0], at[1]);
  };
  advance(0);
  return { sim, renderer, ids, spare, rings, advance, draw, order, annulus, lines };
}

describe('group selection overlays (WP-P3, PA-09)', () => {
  it('a 14-unit selection under one order draws <= 2 range envelopes and one route, one destination, one crosshair', () => {
    const w = setUp();
    w.renderer.selection = [...w.ids];
    w.order(w.ids, DEST);
    w.advance(4);
    // Asserted, not assumed: all fourteen really are under way with routes
    // the per-unit path would have drawn.
    expect(w.ids.filter((i) => w.sim.state.moving[i] === 1)).toHaveLength(GROUP);
    const c = w.draw();
    expect(c.envelopes).toBeLessThanOrEqual(2);
    expect(c.envelopes).toBeGreaterThanOrEqual(1);
    expect(c.routes).toBe(1);
    expect(c.destinations).toBe(1);
    expect(c.orderMarkers).toBeLessThanOrEqual(1);
    // One envelope fill drawn, and one route leg (centroid -> destination):
    // the per-unit path drew 14 and 14.
    expect(w.annulus).toHaveBeenCalledTimes(c.envelopes);
    expect(w.lines).toHaveBeenCalledTimes(1);
  });

  it('still draws a ground ring under every selected unit (#354)', () => {
    const w = setUp();
    w.renderer.selection = [...w.ids];
    w.draw();
    const selectedRings = w.rings.filter((r) => w.ids.includes(r.key));
    expect(new Set(selectedRings.map((r) => r.key)).size).toBe(GROUP);
  });

  it('the primary ring reads differently from the other thirteen, and they all match each other (A1)', () => {
    const w = setUp();
    w.renderer.selection = [...w.ids];
    w.draw();
    const byKey = new Map(w.rings.filter((r) => w.ids.includes(r.key)).map((r) => [r.key, r.color]));
    const primary = byKey.get(w.ids[0]);
    const secondaries = w.ids.slice(1).map((i) => byKey.get(i));
    expect(primary).toBeDefined();
    for (const s of secondaries) {
      expect(s).toEqual(secondaries[0]);
      expect(s).not.toEqual(primary);
    }
    // ...and a single selection is untouched: its ring is the plain team ring
    // the secondaries wear, not the primary's.
    w.renderer.selection = [w.ids[3]];
    w.draw();
    expect(w.rings.find((r) => r.key === w.ids[3])?.color).toEqual(secondaries[0]);
  });

  it('hovering a friendly adds one preview envelope, never one per unit', () => {
    const w = setUp();
    w.renderer.selection = [...w.ids];
    w.renderer.rangeRingPreview = w.spare;
    expect(w.draw().envelopes).toBe(2);
    // Hovering a SELECTED unit other than the primary previews it too.
    w.renderer.rangeRingPreview = w.ids[9];
    expect(w.draw().envelopes).toBe(2);
    // Hovering the primary itself adds nothing.
    w.renderer.rangeRingPreview = w.ids[0];
    expect(w.draw().envelopes).toBe(1);
  });

  it('two orders to two places draw two routes, one each -- the merge is per command, not per selection', () => {
    const w = setUp();
    w.renderer.selection = [...w.ids];
    w.order(w.ids.slice(0, 7), [34.5, 8.5]);
    w.order(w.ids.slice(7), [34.5, 38.5]);
    w.advance(4);
    const c = w.draw();
    expect(c.routes).toBe(2);
    expect(c.destinations).toBe(2);
    expect(c.orderMarkers).toBe(2);
  });

  it('a single unit under way keeps its own route', () => {
    const w = setUp();
    w.renderer.selection = [w.ids[0]];
    w.order([w.ids[0]], DEST);
    w.advance(4);
    const c = w.draw();
    expect(c.envelopes).toBe(1);
    expect(c.routes).toBe(1);
  });
});

/**
 * VR-33: a route and an order marker wear the colour key the app hands over
 * for the order that set them -- the issuing cursor's family key -- and a unit
 * nobody tagged keeps the overlay accent it always had. Read back at the draw
 * calls (`lineWorld` for a route leg, `rect` for a marker arm).
 *
 * Falsified: drawing every route in `OVERLAY_ACCENT_COLOR_KEY` again (the
 * `routeColorKeys.get(i) ?? ...` lookup replaced by the accent) reddens the
 * first spec; dropping the marker's own key reddens the second.
 */
describe('route and marker colour follow the issuing order (VR-33)', () => {
  const MOVE_KEY = 'vfx.interceptor';
  const ATTACK_KEY = 'team.hostile_text';

  it('two orders of two families draw two routes, each in its own key; an untagged unit stays the accent', () => {
    const w = setUp();
    w.renderer.selection = [...w.ids];
    w.order(w.ids.slice(0, 5), [34.5, 8.5]);
    w.order(w.ids.slice(5, 10), [34.5, 38.5]);
    w.order(w.ids.slice(10), [40.5, 20.5]);
    w.renderer.setRouteColorKey(w.ids.slice(0, 5), MOVE_KEY);
    w.renderer.setRouteColorKey(w.ids.slice(5, 10), ATTACK_KEY);
    w.advance(4);
    w.draw();
    const colours = new Set(w.lines.mock.calls.map((c) => c[3]));
    expect(colours).toEqual(new Set([paletteHex(MOVE_KEY), paletteHex(ATTACK_KEY), paletteHex('vfx.tracer')]));
    // A null tag puts a unit back on the accent.
    w.renderer.setRouteColorKey(w.ids.slice(0, 10), null);
    w.draw();
    expect(new Set(w.lines.mock.calls.map((c) => c[3]))).toEqual(new Set([paletteHex('vfx.tracer')]));
  });

  it('a marker wears the key it was dropped with, and the accent with none', () => {
    const w = setUp();
    const rects = vi.spyOn((w.renderer as unknown as Priv).overlayBatch, 'rect');
    w.renderer.addOrderMarker(20.5, 20.5, MOVE_KEY);
    w.draw();
    expect(new Set(rects.mock.calls.map((c) => c[5]))).toEqual(new Set([paletteHex(MOVE_KEY)]));
    const v = setUp();
    const vRects = vi.spyOn((v.renderer as unknown as Priv).overlayBatch, 'rect');
    v.renderer.addOrderMarker(20.5, 20.5);
    v.draw();
    expect(new Set(vRects.mock.calls.map((c) => c[5]))).toEqual(new Set([paletteHex('vfx.tracer')]));
  });
});
