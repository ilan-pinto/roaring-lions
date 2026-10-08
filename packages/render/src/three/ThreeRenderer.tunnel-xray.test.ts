/**
 * GH-471: the tunnel x-ray, driven by a REAL `Sim` -- a pre_dug route, a
 * `mark_tunnel` carrier and two fighters put inside it -- through the
 * renderer's own event and refresh path. Pins the rules where the defect
 * would be: the sim has the answer and the renderer must ask for it.
 *
 * Harness copied from `ThreeRenderer.route.test.ts`: a faked
 * `WebGLRenderer`; `frame()` is not called (it needs a GL context), so the
 * two x-ray hooks it calls are called directly, in its order.
 */
import { describe, it, expect, vi } from 'vitest';
import { Sim, fx, type SimEvent, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import type { TunnelXray } from './tunnel-xray';
import type { TrailInstanceInput } from './trail-mesh';

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

const MARKER: UnitTypeJson = {
  id: 'tn_marker',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.9 },
  sensors: { optics: 1.0, sight_tiles: 8, signature: 0.6 },
  abilities: ['mark_tunnel'],
  weapons: [],
};
const FIGHTER: UnitTypeJson = { ...MARKER, id: 'tn_fighter', abilities: [] };

interface Privates {
  tunnelXray: TunnelXray;
  xrayRouteState(): void;
  xrayFrame(alpha: number): void;
  buildTrailInput(): TrailInstanceInput;
}

function world(opts: { marker: boolean; fighters: number }) {
  const sim = new Sim({ seed: 7, width: 16, height: 16, capacity: 8 });
  const route = sim.addTunnel({ id: 'tn_a', points: [[2, 2], [8, 2]], dig_tiles_per_s: 1, pre_dug: true });
  const marker = opts.marker ? sim.spawn(sim.addUnitType(MARKER), 0, fx.from(4.5), fx.from(4.5)) : -1;
  const fighterType = sim.addUnitType(FIGHTER);
  for (let i = 0; i < opts.fighters; i++) {
    const id = sim.spawn(fighterType, 1, fx.from(3.5 + i), fx.from(2.5));
    sim.putInTunnel(id, route);
  }
  const renderer = new ThreeRenderer(sim, makeOpts());
  const priv = renderer as unknown as Privates;
  const seen: SimEvent[] = [];
  const run = (ticks: number): void => {
    for (let t = 0; t < ticks; t++) {
      const events = sim.tick();
      seen.push(...events);
      renderer.snapshot();
      renderer.onEvents(events);
      // `frame()`'s order: the 5 Hz refresh (every tick here), then the frame.
      priv.xrayRouteState();
      priv.xrayFrame(1);
    }
  };
  return { sim, route, marker, renderer, priv, run, seen };
}

describe('tunnel x-ray (GH-471)', () => {
  it('identified: the route is drawn, with one figure per fighter inside', () => {
    const { sim, route, priv, run } = world({ marker: true, fighters: 2 });
    run(60);
    expect(sim.tunnelContactLevel(0, route)).toBe(2);
    expect(priv.tunnelXray.clock.strength[route]).toBeGreaterThan(0.9);
    expect(priv.tunnelXray.figures.count).toBe(2);
    expect(priv.tunnelXray.drawCalls).toBeGreaterThanOrEqual(3);
  });

  it('unidentified: nothing is drawn, fighters or not', () => {
    const { sim, route, priv, run } = world({ marker: false, fighters: 2 });
    run(60);
    expect(sim.tunnelContactLevel(0, route)).toBe(0);
    expect(priv.tunnelXray.figures.count).toBe(0);
    expect(priv.tunnelXray.drawCalls).toBe(0);
  });

  it('lapsed: fades on the sim clock while the sim still knows it, and goes out when it forgets', () => {
    const { sim, route, marker, priv, run } = world({ marker: true, fighters: 1 });
    run(60);
    const held = priv.tunnelXray.clock.strength[route];
    sim.debugKill(marker);
    run(160); // 8 s with nobody watching
    expect(sim.tunnelContactLevel(0, route)).toBe(2);
    const lapsed = priv.tunnelXray.clock.strength[route];
    expect(lapsed).toBeLessThan(held - 0.15);
    expect(lapsed).toBeGreaterThan(0);
    run(260); // past the ~16 s the sim takes to forget
    expect(sim.tunnelContactLevel(0, route)).toBe(0);
    expect(priv.tunnelXray.clock.strength[route]).toBe(0);
    expect(priv.tunnelXray.figures.count).toBe(0);
  });

  it('plays the discovery beam from the carrier that found it', () => {
    const { priv, run, seen, marker } = world({ marker: true, fighters: 0 });
    run(1);
    expect(seen).toContainEqual(expect.objectContaining({ kind: 'tunnelContact', side: 0, level: 'identified', observer: marker }));
    expect(priv.tunnelXray.beam.visible).toBe(true);
  });

  it('retires the trail\'s identified-line rung: an identified route asks the trail for spoil only', () => {
    const { route, priv, run } = world({ marker: true, fighters: 0 });
    run(5);
    expect(priv.buildTrailInput().routeLevel(route)).toBe(1);
  });
});
