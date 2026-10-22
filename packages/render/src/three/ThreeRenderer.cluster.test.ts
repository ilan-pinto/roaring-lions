/**
 * GH-709 (E2/E3): a cluster round opens in the air, its bomblets crater the
 * ground, and an indirect ATGM flies lofted -- through the REAL renderer,
 * driven by events a real `Sim` produced (as `ThreeRenderer.indirect-
 * projectile.test.ts` does), so the `weaponId` -> weapon lookup, the flag
 * plumbing and the grouping are the shipped ones.
 *
 * The unit fixtures are the staged `docs/campaign/special_units/gh709/`
 * weapons (`dpicm_155`, `spike_nlos`) trimmed to the fields the sim reads and
 * inlined, so landing the staged units in `data/units/` cannot break this file.
 */
import { describe, it, expect, vi } from 'vitest';
import { Sim, fx, type SimEvent, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import type { ShellModel } from './units/shells';
import type { MissileModel } from './units/missiles';
import type { EmitterSpec } from '../vfx/emitters';
import { WORLD_Y_PER_LIFT_PIXEL } from '../project';
import { CLUSTER_BURST_LIFT_PX } from './units/cluster-burst';
import clusterAirburst from '../../../../data/vfx/cluster_airburst.json';
import shellImpact from '../../../../data/vfx/shell_impact.json';

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

const TONES: TerrainTones = {
  open: '#C8B494', cover: ['#8F9464', '#6E7449', '#4E5433'],
  blocked: '#3A3C33', underBuilding: '#23241F', road: '#E6D8BE', rut: '#4E5433',
  rock: '#8E9491', rockLit: '#F2E8D5', earth: '#6E7449', low: '#8F9464',
  trunk: '#4E5433', trunkLit: '#8F9464', leafDark: '#333821', leafMid: '#4E5433',
  leafLit: '#6E7449', bladeLit: '#8F9464', bladeShade: '#4E5433', spoil: '#6E7449',
  crownRatio: 0.52, scatter: 'stone', groveFamily: 'desert_tree', haze: '#E0B87A',
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

const CLUSTER_WEAPON = {
  id: 'dpicm_155', type: 'mortar', range_tiles: 24, effective_range_tiles: 18,
  accuracy: 0.45, penetration: 20, damage: 0, suppression: 160, rof_per_min: 2,
  min_range_tiles: 6, collateral_risk: 0.95,
  submunitions: { count: 12, scatter_tiles: 2.5, damage: 90, splash_tiles: 0.8, suppression: 60 },
} as const;

function howitzer(weapon: Record<string, unknown>): UnitTypeJson {
  return {
    id: 't_spg', role: 'artillery',
    hull: { hp: 1400, armor: { front: 60, side: 30, rear: 20 } },
    mobility: { speed_tiles_s: 0 },
    sensors: { optics: 0.9, sight_tiles: 20 },
    weapons: [weapon],
  } as unknown as UnitTypeJson;
}

function nlosTeam(extra: Record<string, unknown>): UnitTypeJson {
  return {
    id: 't_nlos', role: 'at_team',
    hull: { hp: 380, armor: { front: 10, side: 10, rear: 10 } },
    mobility: { speed_tiles_s: 0 },
    sensors: { optics: 1.2, sight_tiles: 20 },
    weapons: [{
      id: 'spike_nlos', type: 'atgm', range_tiles: 24, effective_range_tiles: 18,
      accuracy: 0.8, penetration: 1000, damage: 450, suppression: 20, rof_per_min: 2,
      min_range_tiles: 4, collateral_risk: 0.2, ...extra,
    }],
  } as unknown as UnitTypeJson;
}

const TARGET: UnitTypeJson = {
  id: 't_target', role: 'infantry',
  hull: { hp: 100000, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0 },
  sensors: { optics: 1, sight_tiles: 1 },
  weapons: [],
};

interface Priv {
  shells: ShellModel[];
  missileFx: { missiles: MissileModel[] };
  decalsPersistent: { liveCount: number };
  flashLights: { liveCount: number };
  spawnCollapseFx(id: string, x: number, y: number, power: number, yaw: number, lift: number): boolean;
  updateFx(ms: number): void;
}
const priv = (r: ThreeRenderer): Priv => r as unknown as Priv;
/** Frames, not one long step: `updateFx` clamps a frame to 100 ms. */
function flyOut(r: ThreeRenderer): void {
  for (let i = 0; i < 300; i++) priv(r).updateFx(1000 / 60);
}

/** A fired world: shooter at (4,4), target at (11,4), returns the sim, its
 *  first `fire` tick's events and every later tick's events up to `ticks`. */
function run(shooter: UnitTypeJson, ticks: number): { sim: Sim; fireEvents: SimEvent[]; later: SimEvent[][] } {
  const sim = new Sim({ seed: 7, width: 32, height: 32, capacity: 8 });
  const sIdx = sim.addUnitType(shooter);
  const tIdx = sim.addUnitType(TARGET);
  const id = sim.spawn(sIdx, 0, fx.from(4), fx.from(4));
  sim.spawn(tIdx, 1, fx.from(11), fx.from(4));
  let fireEvents: SimEvent[] | null = null;
  const later: SimEvent[][] = [];
  for (let t = 0; t < ticks; t++) {
    const events = [...sim.tick()];
    if (fireEvents === null) {
      if (events.some((e) => e.kind === 'fire' && e.shooter === id)) fireEvents = events;
    } else later.push(events);
  }
  if (fireEvents === null) throw new Error('never fired');
  return { sim, fireEvents, later };
}

function renderer(sim: Sim): ThreeRenderer {
  const r = new ThreeRenderer(sim, makeOpts());
  r.useEmitters(
    [clusterAirburst as unknown as EmitterSpec, shellImpact as unknown as EmitterSpec],
    (key) => (key.startsWith('#') ? key : '#FFB43C')
  );
  r.snapshot();
  r.snapshot();
  return r;
}

const bomblets = (evs: SimEvent[][]): Extract<SimEvent, { kind: 'submunition' }>[] =>
  evs.flat().filter((e): e is Extract<SimEvent, { kind: 'submunition' }> => e.kind === 'submunition');

describe('a cluster round (GH-709 E3)', () => {
  it('draws its carrier as a tagged mortar arc, and the carrier lands as NO bomb', () => {
    const { sim, fireEvents } = run(howitzer(CLUSTER_WEAPON), 400);
    const r = renderer(sim);
    r.onEvents(fireEvents);
    const p = priv(r);
    expect(p.shells).toHaveLength(1);
    expect(p.shells[0].kind).toBe('mortar');
    expect(p.shells[0].cluster).toBe(true);
    // Let the whole flight pass on the frame clock: a mortar bomb would stamp
    // a crater AND a scorch and throw a light here. The carrier does not.
    flyOut(r);
    expect(p.shells).toHaveLength(0);
    expect(p.decalsPersistent.liveCount).toBe(0);
    expect(p.flashLights.liveCount).toBe(0);
    r.dispose();
  });

  it('control: the same weapon without bomblets IS a bomb -- it craters and scorches on landing', () => {
    const plain = { ...CLUSTER_WEAPON, damage: 180, splash_tiles: 1.8 } as Record<string, unknown>;
    delete plain.submunitions;
    const { sim, fireEvents } = run(howitzer(plain), 400);
    const r = renderer(sim);
    r.onEvents(fireEvents);
    expect(priv(r).shells[0].cluster).toBeUndefined();
    flyOut(r);
    expect(priv(r).decalsPersistent.liveCount).toBe(2);
    r.dispose();
  });

  it('twelve bomblets stamp twelve craters, and the round opens ONCE, in the air, at their centroid', () => {
    const { sim, fireEvents, later } = run(howitzer(CLUSTER_WEAPON), 600);
    const subs = bomblets(later);
    expect(subs).toHaveLength(12);
    const r = renderer(sim);
    const spy = vi.spyOn(r as unknown as { spawnCollapseFx: Priv['spawnCollapseFx'] }, 'spawnCollapseFx');
    r.onEvents(fireEvents);
    const p = priv(r);
    // The frame clock runs with the sim, a 50 ms frame per tick, as in play. In
    // lock-step the drawn carrier (1.55 s here) ends a few frames before the
    // sim's burst (tick 34), landing as nothing; a frame clock that lags the sim
    // still has it in the air, and the burst retires it (clusterCarrierToRetire,
    // tested in cluster-burst.test.ts). Either way none is left after the burst.
    let shellsAfterBurst = -1;
    for (const evs of later) {
      if (shellsAfterBurst < 0) {
        r.onEvents(evs);
        if (evs.some((e) => e.kind === 'submunition')) shellsAfterBurst = p.shells.length;
        else p.updateFx(50);
      }
    }
    expect(shellsAfterBurst).toBe(0);
    expect(p.decalsPersistent.liveCount).toBe(12);
    const bursts = spy.mock.calls.filter((c) => c[0] === 'cluster_airburst');
    expect(bursts).toHaveLength(1);
    const cx = subs.reduce((a, e) => a + fx.toNumber(e.x), 0) / 12;
    const cy = subs.reduce((a, e) => a + fx.toNumber(e.y), 0) / 12;
    expect(bursts[0][1]).toBeCloseTo(cx, 9);
    expect(bursts[0][2]).toBeCloseTo(cy, 9);
    expect(bursts[0][5]).toBeCloseTo(CLUSTER_BURST_LIFT_PX * WORLD_Y_PER_LIFT_PIXEL, 9);
    expect(bursts[0][5]).toBeGreaterThan(0);
    // The carrier opened, so it is retired instead of falling to the old aim.
    expect(p.shells).toHaveLength(0);
    // One light for the airburst; bomblet flashes are flat puffs, not lights.
    expect(p.flashLights.liveCount).toBe(1);
    r.dispose();
  });

  it('a catch-up (quiet) throws no airburst and stamps no bomblet crater, like a mortar round', () => {
    const { sim, later } = run(howitzer(CLUSTER_WEAPON), 600);
    const r = renderer(sim);
    r.setQuiet(true);
    const spy = vi.spyOn(r as unknown as { spawnCollapseFx: Priv['spawnCollapseFx'] }, 'spawnCollapseFx');
    for (const evs of later) r.onEvents(evs);
    expect(priv(r).decalsPersistent.liveCount).toBe(0);
    expect(spy).not.toHaveBeenCalled();
    r.dispose();
  });
});

describe('an indirect ATGM flies lofted (GH-709 E2)', () => {
  it('spike_nlos (`indirect: true`) is a lofted round, well above the plain Spike arc', () => {
    const { sim, fireEvents } = run(nlosTeam({ indirect: true }), 400);
    const r = renderer(sim);
    r.onEvents(fireEvents);
    const m = priv(r).missileFx.missiles;
    expect(m).toHaveLength(1);
    expect(m[0].variant).toBe('lofted');
    // Clears a three-floor apartment (3 world units) with room to spare.
    expect(m[0].apexPx * WORLD_Y_PER_LIFT_PIXEL).toBeGreaterThan(3);
    r.dispose();
  });

  it('control: the same atgm without the flag stays a guided round', () => {
    const { sim, fireEvents } = run(nlosTeam({}), 400);
    const r = renderer(sim);
    r.onEvents(fireEvents);
    expect(priv(r).missileFx.missiles.map((m) => m.variant)).toEqual(['guided']);
    r.dispose();
  });
});
