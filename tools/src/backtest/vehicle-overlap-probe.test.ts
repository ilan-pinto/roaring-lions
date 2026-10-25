import { describe, expect, it } from 'vitest';
import { fx } from '@lions/sim';
import { units } from '@lions/data';
import {
  boxAt,
  measure,
  measuredHulls,
  penetration,
  runScenario,
  scenarios,
  worldOn,
  type Box,
} from './vehicle-overlap-probe';

/**
 * The INSTRUMENT, never the defect (GH-421). `vehicle-overlap-probe.ts` is report-only: it prints
 * how often hulls interpenetrate and asserts no level, so this file stays green before and after
 * the vehicle-separation fix. What it does pin is that the probe can see an overlap at all --
 * literal geometry, a stacked pair that must count, a separated pair that must not, a mover
 * driven through a parked hull that must read as MS. Since movers-only avoidance (GH-421 Stage 2) a
 * hull with a footprint no longer drives through a parked one, so the MS fixtures are the cases
 * where avoidance does not hold it: the valve opening on a head-on block, and a type with no
 * footprint. A fixture where avoidance works reads as steering, not MS. Falsified by hand (see the PR).
 */

const axis = (cx: number, cy: number, a: number, b: number, turn = 0): Box => ({
  cx,
  cy,
  ux: Math.cos(turn * 2 * Math.PI),
  uy: Math.sin(turn * 2 * Math.PI),
  a,
  b,
});

describe('penetration (oriented boxes, separating axes)', () => {
  it('nose to tail: 1.5 apart along the heading, half-lengths 1 + 1, overlap 0.5', () => {
    expect(penetration(axis(0, 0, 1, 0.5), axis(1.5, 0, 1, 0.5))).toBeCloseTo(0.5, 9);
  });
  it('apart: 2.5 apart reads -0.5', () => {
    expect(penetration(axis(0, 0, 1, 0.5), axis(2.5, 0, 1, 0.5))).toBeCloseTo(-0.5, 9);
  });
  it('side by side: 0.8 apart across, half-widths 0.5 + 0.5, overlap 0.2', () => {
    expect(penetration(axis(0, 0, 1, 0.5), axis(0, 0.8, 1, 0.5))).toBeCloseTo(0.2, 9);
  });
  it('a T: the crossing hull reaches 1.5 along x against 1.2 of separation, overlap 0.3', () => {
    expect(penetration(axis(0, 0, 1, 0.5), axis(1.2, 0, 1, 0.5, 0.25))).toBeCloseTo(0.3, 9);
  });
});

describe('boxAt', () => {
  it('centres the hull centreAlong ahead of the origin, turning with the facing (y down)', () => {
    const h = { along: 1, across: 0.5, centreAlong: -0.25 };
    const east = boxAt(h, 10, 10, 0);
    expect(east.cx).toBeCloseTo(9.75, 9);
    expect(east.cy).toBeCloseTo(10, 9);
    const south = boxAt(h, 10, 10, 16384);
    expect(south.cx).toBeCloseTo(10, 9);
    expect(south.cy).toBeCloseTo(9.75, 9);
  });
});

describe('measuredHulls', () => {
  const hulls = measuredHulls();
  it('carries the brief mixed group and no aircraft', () => {
    for (const id of ['mbt_lavi', 'ifv_namer', 'apc_eitan', 'jeep_shoded', 'dozer_d9']) {
      expect(hulls.has(id), id).toBe(true);
    }
    for (const id of ['recon_drone', 'heli_peten', 'inf_squad']) expect(hulls.has(id), id).toBe(false);
  });
  it('reads a hull, not a ring: a Namer is longer than it is wide and under 1.5 tile long', () => {
    const n = hulls.get('ifv_namer');
    expect(n).toBeDefined();
    expect(n!.along).toBeGreaterThan(n!.across);
    expect(n!.along).toBeLessThan(1.5);
  });
});

describe('measure (the counter)', () => {
  const hulls = measuredHulls();
  const parked = (gap: number) => {
    const { sim, typeOf, nameOf } = worldOn('beit_sahwan_outskirts', 1);
    const lavi = typeOf.get('mbt_lavi') as number;
    sim.spawn(lavi, 0, fx.from(12.5), fx.from(23.5), 0);
    sim.spawn(lavi, 0, fx.from(12.5 + gap), fx.from(23.5), 0);
    return measure('parked', sim, nameOf, hulls, 10);
  };
  it('two Lavis on one spot overlap on every tick, at rest, and never in transit', () => {
    const r = parked(0);
    expect(r.vehicles).toBe(2);
    expect(r.atRest).toBe(1);
    expect(r.mm + r.ms + r.ss).toBe(0); // settled on tick 0: nothing counts as transit
    expect(r.restDepth).toBeGreaterThan(1);
  });
  it('two Lavis four tiles apart never overlap', () => {
    const r = parked(4);
    expect(r.atRest).toBe(0);
    expect(r.pairs).toBe(0);
  });
  // The mover leaves (10.5, 23.5) for (20, 23.5) on beit_sahwan_outskirts; a Lavi is parked at (14.5, y).
  const drive = (parkedY: number, goalY: number, moverType = 'mbt_lavi', hullMap = hulls, ticks = 200) => {
    const { sim, typeOf, nameOf } = worldOn('beit_sahwan_outskirts', 1);
    const lavi = typeOf.get('mbt_lavi') as number;
    let t = typeOf.get(moverType);
    if (t === undefined) {
      // A Lavi without its footprint: the sim does not make it avoid anything (a non-participant).
      const bare = JSON.parse(JSON.stringify((units as Record<string, unknown>).mbt_lavi)) as { id: string; mobility: { footprint?: unknown } };
      bare.id = moverType;
      delete bare.mobility.footprint;
      t = sim.addUnitType(bare as never);
      nameOf.set(t, moverType);
    }
    const a = sim.spawn(t, 0, fx.from(10.5), fx.from(23.5), 0);
    const b = sim.spawn(lavi, 0, fx.from(14.5), fx.from(parkedY), 0);
    const parkedAt = [sim.state.posX[b], sim.state.posY[b]];
    sim.queueCommand({ kind: 'move', ids: [a], x: fx.from(20), y: fx.from(goalY), exact: true });
    const r = measure('through', sim, nameOf, hullMap, ticks);
    const arrived = sim.state.posX[a] === fx.from(20) && sim.state.posY[a] === fx.from(goalY) && sim.state.moving[a] === 0;
    const parkedStill = sim.state.posX[b] === parkedAt[0] && sim.state.posY[b] === parkedAt[1];
    return { r, arrived, parkedStill };
  };
  const bareHulls = new Map(hulls).set('mbt_lavi_bare', hulls.get('mbt_lavi') as never);
  it('a Lavi driven past a parked one, a tile off its line, steers round it: it arrives, the parked hull never moves, and the overlap stays under 0.15 tile', () => {
    // Measured at the Stage 2 landing: 16 MS pair-ticks, maxDepth 0.138, deep 0. The control is the same
    // drive by a Lavi with no footprint, which avoids nothing: 74 MS pair-ticks, maxDepth 0.138 (a tile
    // off the line is nearly clear of the 1.14 of the two half-widths, so the depth cannot tell the
    // two apart; the count of pair-ticks in contact can).
    const { r, arrived, parkedStill } = drive(22.5, 23.5);
    const control = drive(22.5, 23.5, 'mbt_lavi_bare', bareHulls);
    expect(arrived).toBe(true);
    expect(parkedStill).toBe(true);
    expect(r.mm).toBe(0);
    expect(r.deep).toBe(0); // the valve (a ghost step through the hull) would put 99 pair-ticks past 0.25
    expect(r.maxDepth).toBeLessThan(0.15);
    expect(r.ms).toBeLessThanOrEqual(20);
    expect(r.ms * 3).toBeLessThan(control.r.ms);
  });
  it('a Lavi driven at a parked one head-on is held, then the valve opens and it goes through: that reads as MS', () => {
    // 2 s (SEP_VALVE_TICKS 40 at +2 a tick blocked) of standing against the nose, then the step is taken.
    // Measured: arrives at tick 210 of 300; 110 MS pair-ticks, 99 of them deeper than 0.25, maxDepth 0.669.
    const { r, arrived, parkedStill } = drive(23.5, 23, 'mbt_lavi', hulls, 300);
    expect(arrived).toBe(true);
    expect(parkedStill).toBe(true);
    expect(r.ms).toBeGreaterThan(0);
    expect(r.mm).toBe(0);
    expect(r.deep).toBeGreaterThan(0);
    expect(r.maxDepth).toBeGreaterThan(0.5);
  });
  it('a mover with no footprint is driven through a parked Lavi and reads as MS: the counter still sees a pair that avoidance does not hold apart', () => {
    const { r, arrived, parkedStill } = drive(23.5, 23, 'mbt_lavi_bare', bareHulls, 200);
    expect(arrived).toBe(true);
    expect(parkedStill).toBe(true);
    expect(r.ms).toBeGreaterThan(0);
    expect(r.mm).toBe(0);
    expect(r.maxDepth).toBeGreaterThan(1);
  });
});

describe('scenarios (report only: shape, never level)', () => {
  it('every scenario places what it names and runs', () => {
    const hulls = measuredHulls();
    const sc = scenarios().find((s) => s.name === 'tm hollow x6');
    expect(sc).toBeDefined();
    const r = runScenario(sc!, hulls);
    expect(r.vehicles).toBe(6);
    expect(r.ticks).toBe(90 * 20);
  });
});
