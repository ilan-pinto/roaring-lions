// The spacing census's own checks (GH-1360 S0). The census is report-only, so what must not pass quietly is the
// INSTRUMENT: it pins the geometry and the counters with LITERAL inputs (every expected number below was worked by hand
// from the footprints written beside it, never read back from the code under test), and never the level of the defect.
// Each test names the one-line mutation that was seen to turn it red; the commit message lists them.
import { describe, expect, it } from 'vitest';
import { Sim, fx, type UnitTypeJson } from '@lions/sim';
import { units } from '@lions/data';
import {
  CONTACT_EPS,
  FOOT_RADIUS,
  ZeroRunTracker,
  bodyDepth,
  bodyOfType,
  classPairOf,
  entriesOf,
  facingReversal,
  footCircleType,
  footRadius,
  missionStart,
  newPlayAcc,
  overlaps,
  PlayState,
  sampleTick,
  runChoke,
  chokeTwelve,
  splitBlocked,
  tallyOf,
  turnDeg,
  type Body,
  type Entry,
} from './spacing-census';

const TURN = 65536;
const EAST = 0;
const SOUTH = TURN / 4;

/** A Lavi's GH-421 capsule as the shipped JSON declares it: half length 1.03, half width 0.57, centre 0.22 behind the origin. */
const lavi = (x: number, y: number, facing = EAST): Body => ({ x, y, facing, halfLen: 1.03, halfWid: 0.57, centre: -0.22 });
/** A foot team's circle. */
const circle = (x: number, y: number, r = 0.45): Body => ({ x, y, facing: EAST, halfLen: r, halfWid: r, centre: 0 });

function entry(kind: 'foot' | 'vehicle', side: number, body: Body, id = 0): Entry {
  return { id, side, unit: kind === 'foot' ? 'inf_squad' : 'mbt_lavi', cls: kind === 'foot' ? 'infantry' : 'armour', kind, wheeled: kind === 'vehicle', body, tx: 0, ty: 0, onBlocked: false, unlisted: false };
}

describe('the foot radius table', () => {
  it('reads the spec radii, never zero', () => {
    // mutation: footRadius returns 0
    expect(footRadius('inf_squad')).toBe(0.45);
    expect(footRadius('civilians')).toBe(0.25);
    expect(footRadius('breach_team')).toBe(0.3);
    expect(footRadius('manpad_team')).toBe(0.35);
    expect(footRadius('rpg_team')).toBe(0.4);
  });
  it('names a real unit for every entry, and every ground foot unit has an entry (the default is never used)', () => {
    // mutation: delete one key from FOOT_RADIUS (rpg_team, say)
    const sim = new Sim({ seed: 1, width: 8, height: 8, capacity: 4 });
    for (const u of Object.values(units)) sim.addUnitType(u as unknown as UnitTypeJson);
    const ids = new Set(sim.unitTypes.map((t) => t.id));
    for (const k of Object.keys(FOOT_RADIUS)) expect(ids.has(k), k).toBe(true);
    for (const t of sim.unitTypes) {
      const b = bodyOfType(t);
      if (b !== null && b.kind === 'foot') expect(b.unlisted, `${t.id} has no radius`).toBe(false);
    }
  });
});

describe('bodyDepth: two circles', () => {
  it('a stacked pair overlaps by the sum of the radii', () => {
    // mutation: the circle radius read as 0 (halfWid 0) turns this and the next red
    expect(bodyDepth(circle(5, 5), circle(5, 5))).toBeCloseTo(0.9, 9);
  });
  it('a pair 0.95 apart is clear, by 0.05', () => {
    expect(bodyDepth(circle(5, 5), circle(5.95, 5))).toBeCloseTo(-0.05, 9);
  });
  it('0.01 of interpenetration is under the 0.02 threshold and 0.03 is over it', () => {
    // 0.89 apart: depth 0.01. 0.87 apart: depth 0.03. mutation: CONTACT_EPS 0.02 -> 0 counts the first; -> 0.05 misses the second
    expect(CONTACT_EPS).toBe(0.02);
    expect(overlaps([entry('foot', 0, circle(5, 5)), entry('foot', 0, circle(5.89, 5), 1)])).toHaveLength(0);
    expect(overlaps([entry('foot', 0, circle(5, 5)), entry('foot', 0, circle(5.87, 5), 1)])).toHaveLength(1);
  });
});

describe('bodyDepth: a team against a hull capsule', () => {
  // The Lavi at (10, 10) facing east: its body centre is 0.22 behind the origin, x 9.78; the axis half-length is 1.03 - 0.57 = 0.46,
  // so the axis runs x 9.32 .. 10.24 at y 10, swept by 0.57. A team (r 0.45) is in contact inside 1.02 of that axis.
  it('touching the flank: 0.92 off the axis, 0.10 deep', () => {
    // mutation: the capsule using the wrong half-width (halfLen swept) turns the flank cases red
    expect(bodyDepth(lavi(10, 10), circle(10, 10.92))).toBeCloseTo(0.1, 9);
    expect(overlaps([entry('vehicle', 0, lavi(10, 10)), entry('foot', 0, circle(10, 10.92), 1)])).toHaveLength(1);
  });
  it('a team 1.1 off the flank is clear, by 0.08', () => {
    expect(bodyDepth(lavi(10, 10), circle(10, 11.1))).toBeCloseTo(-0.08, 9);
  });
  it('the nose end: the axis ends at x 10.24, so a team at 11.16 is 0.10 deep', () => {
    // mutation: the capsule's endpoint taken from the origin (centre offset dropped) puts the nose end at 10.46 and reads 0.32
    expect(bodyDepth(lavi(10, 10), circle(11.16, 10))).toBeCloseTo(0.1, 9);
  });
  it('the tail end: the axis ends at x 9.32, so a team at 8.40 is 0.10 deep', () => {
    // mutation: the capsule's endpoint taken from the origin puts the tail end at 9.54 and misses this pair
    expect(bodyDepth(lavi(10, 10), circle(8.4, 10))).toBeCloseTo(0.1, 9);
    expect(overlaps([entry('vehicle', 0, lavi(10, 10)), entry('foot', 0, circle(8.4, 10), 1)])).toHaveLength(1);
  });
  it('turned to face south the same three contacts hold on the other axis', () => {
    // mutation: the facing read as a turn from north, or the sin/cos swapped
    const h = lavi(10, 10, SOUTH);
    expect(bodyDepth(h, circle(10.92, 10))).toBeCloseTo(0.1, 9); // the flank
    expect(bodyDepth(h, circle(10, 11.16))).toBeCloseTo(0.1, 9); // the nose
    expect(bodyDepth(h, circle(10, 8.4))).toBeCloseTo(0.1, 9); // the tail
  });
  it('two hulls side by side: 1.0 apart, half-widths 0.57 + 0.57, 0.14 deep', () => {
    expect(bodyDepth(lavi(10, 10), lavi(10, 11))).toBeCloseTo(0.14, 9);
  });
});

describe('class pairs and sides', () => {
  it('a foot-vehicle pair is not a foot-foot pair', () => {
    // mutation: classPairOf returns 'foot-foot' for any pair with a foot
    expect(classPairOf('foot', 'foot')).toBe('foot-foot');
    expect(classPairOf('foot', 'vehicle')).toBe('foot-vehicle');
    expect(classPairOf('vehicle', 'foot')).toBe('foot-vehicle');
    expect(classPairOf('vehicle', 'vehicle')).toBe('vehicle-vehicle');
    // Two teams and a hull stacked at one point: one foot-foot, two foot-vehicle, no vehicle-vehicle.
    const es = [entry('foot', 0, circle(5, 5), 0), entry('foot', 0, circle(5, 5), 1), entry('vehicle', 0, lavi(5, 5), 2)];
    expect(tallyOf(overlaps(es))).toEqual({ 'foot-foot': 1, 'foot-vehicle': 2, 'vehicle-vehicle': 0 });
  });
  it('a stacked pair of opposing sides is a fight, not a clump: counted only when asked', () => {
    // mutation: the side test dropped
    const es = [entry('foot', 0, circle(5, 5), 0), entry('foot', 1, circle(5, 5), 1)];
    expect(overlaps(es)).toHaveLength(0);
    expect(overlaps(es, { crossSide: true })).toHaveLength(1);
  });
});

describe('entriesOf on a real sim', () => {
  const build = () => {
    const sim = new Sim({ seed: 1, width: 24, height: 24, capacity: 16 });
    const typeOf = new Map<string, number>();
    for (const u of Object.values(units)) typeOf.set(u.id, sim.addUnitType(u as unknown as UnitTypeJson));
    const squad = typeOf.get('inf_squad') as number;
    const ids = [
      sim.spawn(squad, 0, fx.from(5.5), fx.from(5.5), 0),
      sim.spawn(squad, 0, fx.from(5.5), fx.from(5.5), 0),
      sim.spawn(squad, 0, fx.from(5.5), fx.from(5.5), 0),
      sim.spawn(squad, 0, fx.from(15.5), fx.from(15.5), 0), // the fourth stands alone, and is the LAST entity
    ];
    return { sim, ids, typeOf };
  };
  it('reads every body, and three stacked teams are three pairs', () => {
    // mutation: the entity loop stops one short (`i < sim.entityCount - 1`) drops the lone fourth team
    const { sim } = build();
    const es = entriesOf(sim);
    expect(es).toHaveLength(4);
    expect(overlaps(es)).toHaveLength(3);
  });
  it('leaves out the dead (debugKill at t=0: the entry stays, the body goes)', () => {
    // mutation: the alive test dropped
    const { sim, ids } = build();
    sim.debugKill(ids[1]);
    const es = entriesOf(sim);
    expect(es.map((e) => e.id)).toEqual([ids[0], ids[2], ids[3]]);
    expect(overlaps(es)).toHaveLength(1);
  });
  it('leaves out aircraft, which have no body', () => {
    // mutation: bodyOfType's isAir test dropped
    const { sim, typeOf } = build();
    sim.spawn(typeOf.get('recon_drone') as number, 0, fx.from(5.5), fx.from(5.5), 0);
    expect(entriesOf(sim)).toHaveLength(4);
  });
  it('reads a hull as its footprint capsule and a team as the table circle', () => {
    const { sim, typeOf } = build();
    sim.spawn(typeOf.get('mbt_lavi') as number, 0, fx.from(10.5), fx.from(10.5), 0);
    const v = entriesOf(sim).find((e) => e.unit === 'mbt_lavi');
    expect(v?.kind).toBe('vehicle');
    expect(v?.body.halfLen).toBeCloseTo(1.03, 3);
    expect(v?.body.halfWid).toBeCloseTo(0.57, 3);
    expect(v?.body.centre).toBeCloseTo(-0.22, 3);
    const f = entriesOf(sim).find((e) => e.unit === 'inf_squad');
    expect(f?.body.halfWid).toBe(0.45);
  });
});

describe('bodyOfType', () => {
  const type = (over: Partial<Parameters<typeof bodyOfType>[0]>) => ({ id: 'inf_squad', isAir: false, wheeled: false, sepHalfLen: 0, sepHalfWid: 0, sepCentre: 0, ...over });
  it('gives no body to an aircraft, and none to a wheeled hull with neither a footprint nor a radius', () => {
    expect(bodyOfType(type({ isAir: true }))).toBeNull();
    expect(bodyOfType(type({ id: 'some_truck', wheeled: true }))).toBeNull();
  });
  it('gives a wheeled type with a table radius (moto_rpg) a circle', () => {
    const b = bodyOfType(type({ id: 'moto_rpg', wheeled: true }));
    expect(b).toMatchObject({ kind: 'foot', halfLen: 0.45, halfWid: 0.45 });
  });
  it('a footprint wins over the table', () => {
    const b = bodyOfType(type({ id: 'inf_squad', sepHalfLen: fx.from(1), sepHalfWid: fx.from(0.5) }));
    expect(b?.kind).toBe('vehicle');
  });
});

describe('the garrison exemption', () => {
  it('splits blocked-tile bodies by whether a garrison order was queued for them', () => {
    // mutation: the garrison set ignored (everything is "other")
    const a = { ...entry('foot', 0, circle(1, 1), 7), onBlocked: true };
    const b = { ...entry('foot', 0, circle(2, 2), 8), onBlocked: true };
    const c = { ...entry('foot', 0, circle(3, 3), 9), onBlocked: false };
    const s = splitBlocked([a, b, c], new Set([7, 9]));
    expect(s.total).toBe(2);
    expect(s.garrison.map((e) => e.id)).toEqual([7]);
    expect(s.other.map((e) => e.id)).toEqual([8]);
  });
  it('missionStart records the garrison orders start() queues, on real bodies', () => {
    // mutation: missionStart does not wrap queueCommand (the set stays empty)
    const st = missionStart('khan_rafid_3_clearance');
    expect(st.garrisonIds.size).toBeGreaterThan(0);
    for (const id of st.garrisonIds) expect(id).toBeLessThan(st.sim.entityCount);
    // The split is exhaustive: every blocked-tile body is one or the other.
    const s = splitBlocked(entriesOf(st.sim), st.garrisonIds);
    expect(s.garrison.length + s.other.length).toBe(s.total);
    expect(s.garrison.length).toBeGreaterThan(0);
  });
});

describe('turnDeg and facingReversal', () => {
  it('turnDeg is the short way round, signed', () => {
    // mutation: the wrap (`d > TURN / 2`) dropped
    expect(turnDeg(0, 16384)).toBeCloseTo(90, 9);
    expect(turnDeg(0, 49152)).toBeCloseTo(-90, 9);
    expect(turnDeg(61000, 2000)).toBeCloseTo(35.9, 1);
    expect(turnDeg(2000, 61000)).toBeCloseTo(-35.9, 1);
  });
  it('a swing of 32.9 degrees out and back completes a reversal on the tick it comes back', () => {
    // 6000/65536 of a turn = 32.96 degrees. mutation: the threshold 30 -> 40 misses it
    expect(facingReversal([0, 0, 6000, 0])).toBe(true);
    expect(facingReversal([0, 6000, 0])).toBe(true);
  });
  it('is counted once: the tick after, with the swing already complete, it is not', () => {
    // mutation: the "already complete a tick earlier" test dropped
    expect(facingReversal([0, 6000, 0, 0])).toBe(false);
  });
  it('a steady turn, and a wiggle under 30 degrees, are not reversals', () => {
    expect(facingReversal([0, 6000, 12000, 18000])).toBe(false);
    expect(facingReversal([0, 4000, 0, 4000])).toBe(false); // 21.97 degrees
  });
  it('a turn through north, the same way, is not a reversal (the wrap)', () => {
    // 10000 -> 3000 -> 62000 is -38 then -36 degrees: one direction. Without the wrap the second reads +59000.
    expect(facingReversal([10000, 3000, 62000, 62000])).toBe(false);
  });
});

describe('ZeroRunTracker (speed-zero runs of 1-2 ticks inside a moving leg)', () => {
  const feed = (steps: [boolean, boolean][]): number => {
    const z = new ZeroRunTracker();
    let n = 0;
    for (const [moved, moving] of steps) if (z.step(moved, moving)) n++;
    return n;
  };
  const T = true;
  const F = false;
  it('counts a one-tick stall and a two-tick stall between moving ticks', () => {
    // mutation: the upper bound `run <= 2` -> `run <= 1` misses the second
    expect(feed([[T, T], [F, T], [T, T]])).toBe(1);
    expect(feed([[T, T], [F, T], [F, T], [T, T]])).toBe(1);
  });
  it('does not count a three-tick stall, or one that never moved before', () => {
    // mutation: `run <= 2` -> `run <= 3` counts the first
    expect(feed([[T, T], [F, T], [F, T], [F, T], [T, T]])).toBe(0);
    expect(feed([[F, T], [F, T], [T, T]])).toBe(0);
  });
  it('a stop under no order (moving 0) is not a stall inside a leg', () => {
    // mutation: the `!moving` reset dropped
    expect(feed([[T, T], [F, F], [T, T]])).toBe(0);
  });
  it('counts each stall once', () => {
    expect(feed([[T, T], [F, T], [T, T], [F, T], [T, T]])).toBe(2);
  });
});

describe('the choke', () => {
  it('twelve teams with no footprint all get through a 1-tile door, with no valve and no stop at contact', () => {
    // mutation: runChoke's `d.on = true` removed makes nothing count, but the through-count is what this pins:
    //           the crossing test `x > WALL_X + wallLen` -> `x > 40` leaves every team "not through"
    const r = chokeTwelve('inf_squad');
    expect(r.teams).toBe(12);
    expect(r.through).toBe(12);
    expect(r.clearedAtS).not.toBeNull();
    expect(r.valve).toBe(0);
  });
  it('with circle footprints (the S5c participants) all twelve still get through', () => {
    const r = chokeTwelve('inf_squad_circle', [footCircleType(0.45)]);
    expect(r.through).toBe(12);
    expect(r.clearedAtS).not.toBeNull();
  });
  it('two Lavis meeting head-on in a one-tile corridor are held, and the valve opening is counted', () => {
    // A Lavi is 1.14 wide: two cannot pass in 1.0, so both wait and the 1 s valve opens on each (measured: 2 opens,
    // 23 overlapping pair-ticks). mutation: runChoke never switches sepDiag on -> valve 0
    const r = runChoke({
      wallLen: 6,
      seconds: 60,
      groups: [
        { unit: 'mbt_lavi', x: 11.5, y: 5.5, goalX: 24.5, goalY: 5.5, exact: true },
        { unit: 'mbt_lavi', x: 24.5, y: 5.5, goalX: 11.5, goalY: 5.5, exact: true },
      ],
    });
    expect(r.through).toBe(2);
    expect(r.valve).toBeGreaterThanOrEqual(1);
    expect(r.overlapPairTicks).toBeGreaterThan(0);
  });
  it('two jeeps that DO fit side by side in the corridor pass without a valve open', () => {
    // 0.78 wide each, steering to 5.05 and 5.91 inside the tile: the control for the Lavi test above.
    const r = runChoke({
      wallLen: 6,
      seconds: 60,
      groups: [
        { unit: 'jeep_shoded', x: 11.5, y: 5.5, goalX: 24.5, goalY: 5.5, exact: true },
        { unit: 'jeep_shoded', x: 24.5, y: 5.5, goalX: 11.5, goalY: 5.5, exact: true },
      ],
    });
    expect(r.through).toBe(2);
    expect(r.valve).toBe(0);
  });
});

describe('sampleTick (the in-play sampler) on a literal world', () => {
  const N = 5;
  const world = (extra?: (sim: Sim, typeOf: Map<string, number>) => void) => {
    const sim = new Sim({ seed: 1, width: 40, height: 24, capacity: 16 });
    const typeOf = new Map<string, number>();
    for (const u of Object.values(units)) typeOf.set(u.id, sim.addUnitType(u as unknown as UnitTypeJson));
    const squad = typeOf.get('inf_squad') as number;
    sim.spawn(squad, 0, fx.from(5.5), fx.from(5.5), 0);
    sim.spawn(squad, 0, fx.from(5.5), fx.from(5.5), 0); // stacked on the first
    sim.spawn(squad, 0, fx.from(30.5), fx.from(15.5), 0); // alone
    extra?.(sim, typeOf);
    return sim;
  };
  const play = (sim: Sim, ticks: number) => {
    const acc = newPlayAcc('literal');
    const ps = new PlayState(sim.capacity);
    for (let t = 0; t < ticks; t++) {
      sim.tick();
      sampleTick(sim, acc, ps);
    }
    return acc;
  };

  it('two stacked teams and one alone, for 5 ticks: 15 foot unit-ticks, 10 with a foot neighbour by body and by centre, 5 foot-foot pair-ticks', () => {
    // mutations: `acc.unitTicks[e.kind]++` dropped; `acc.pairTicks[o.pair]++` dropped; the body `flag(...)` dropped
    const a = play(world(), N);
    expect(a.ticks).toBe(N);
    expect(a.unitTicks).toEqual({ foot: 3 * N, vehicle: 0 });
    expect(a.unitTicksWheeled).toEqual({ foot: 3 * N, vehicle: 0 });
    expect(a.near.body).toEqual({ foot: 2 * N, vehicle: 0, cross: 0, any: 2 * N });
    expect(a.near.centre).toEqual({ foot: 2 * N, vehicle: 0, cross: 0, any: 2 * N });
    expect(a.pairTicks).toEqual({ 'foot-foot': N, 'foot-vehicle': 0, 'vehicle-vehicle': 0 });
  });

  it('a Lavi stacked on one team adds a foot-vehicle pair every tick and "cross" for both, and the lone team stays clear', () => {
    // mutation: the cross tally dropped
    const a = play(
      world((sim, typeOf) => {
        sim.spawn(typeOf.get('mbt_lavi') as number, 0, fx.from(30.5), fx.from(15.5), 0);
      }),
      N,
    );
    expect(a.unitTicks).toEqual({ foot: 3 * N, vehicle: N });
    expect(a.pairTicks).toEqual({ 'foot-foot': N, 'foot-vehicle': N, 'vehicle-vehicle': 0 });
    expect(a.near.body.cross).toBe(2 * N);
    expect(a.near.body.vehicle).toBe(0);
  });

  it('a team under a move order is counted as moving every tick, and a straight march has no stall and no reversal', () => {
    // mutation: `if (moving) acc.footMoving++` dropped
    const sim = world();
    sim.queueCommand({ kind: 'move', ids: [2], x: fx.from(38.5), y: fx.from(15.5), exact: true });
    const a = play(sim, 20);
    expect(a.footMoving).toBe(20);
    expect(a.zeroRuns).toBe(0);
    expect(a.reversals).toBe(0);
  });

  it('two samples are not a reversal: the history is not yet full, and its unset entries are not facings', () => {
    // mutation: `ps.histN[i] === 4 &&` dropped in sampleTick reads the unset zero as a sample and finds a swing and a return
    const sim = world();
    sim.queueCommand({ kind: 'move', ids: [2], x: fx.from(38.5), y: fx.from(15.5), exact: true });
    sim.tick();
    const acc = newPlayAcc('literal');
    const ps = new PlayState(sim.capacity);
    for (const f of [6000, 0]) {
      sim.state.facing[2] = f;
      sampleTick(sim, acc, ps);
    }
    expect(acc.reversals).toBe(0);
  });

  it('feeds a stall and a reversal through the same plumbing (state written by the test, the sampler only reads)', () => {
    // The sim cannot be made to stall a foot team for 1-2 ticks or to swing its facing 33 degrees out and back inside 3
    // ticks without footprints, so the test writes the position and facing arrays between samples. It pins the sampler's
    // history and `moving` wiring; facingReversal and ZeroRunTracker are pinned on their own above.
    // mutations: `if (z.step(moved, moving)) acc.zeroRuns++` dropped; `acc.reversals++` dropped
    const sim = world();
    sim.queueCommand({ kind: 'move', ids: [2], x: fx.from(38.5), y: fx.from(15.5), exact: true });
    sim.tick(); // the order is taken: moving is 1
    const acc = newPlayAcc('literal');
    const ps = new PlayState(sim.capacity);
    const x0 = sim.state.posX[2];
    const step = fx.from(0.05);
    const xs = [x0, x0 + step, x0 + step, x0 + 2 * step]; // moved, then one stalled tick, then moved again
    const faces = [0, 0, 6000, 0]; // 32.96 degrees out and back
    for (let k = 0; k < 4; k++) {
      sim.state.posX[2] = xs[k];
      sim.state.facing[2] = faces[k];
      sampleTick(sim, acc, ps);
    }
    expect(acc.zeroRuns).toBe(1);
    expect(acc.reversals).toBe(1);
  });
});
