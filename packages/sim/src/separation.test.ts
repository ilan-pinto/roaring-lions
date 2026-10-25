// Vehicle separation (GH-421, Stage 2, spec docs/superpowers/specs/2026-10-23-vehicle-separation-design.md,
// Option B + B+): a hull never pushes another, it steers round, waits, or ends its leg at contact.
//
// Fixtures are role-less in the sense that matters: armed with nothing, so no fire, no focus and no
// engagement moves anything. Every footprint is a literal (half length 1.0, half width 0.5, centred
// on the origin), and every expected number is a literal with its arithmetic beside it. "Overlap" is
// `capsuleOverlap` of the two hulls at their drawn facing, in raw Q16.16: 3277 raw is 0.05 tile.
import { describe, expect, it } from 'vitest';
import { fx, ONE, type Fx } from './fixed';
import { Sim, type UnitTypeJson } from './sim';
import { capsuleOverlap, hullCapsule } from './separation';
import { SEP_VALVE_TICKS } from './tuning';

const HULL = { hp: 3000, armor: { front: 300, side: 200, rear: 100 } };
const SENSORS = { optics: 1, sight_tiles: 2, signature: 1 };
/** A 2 x 1 tile hull on tracks: speed 3 tiles/s is 0.15 tile (9830 raw) a tick, 4.5 degrees a tick, like a heavy hull. */
const TANK: UnitTypeJson = {
  id: 'sep_tank',
  role: 'mbt',
  hull: HULL,
  mobility: {
    speed_tiles_s: 3,
    turn_rate_deg_s: 90,
    footprint: { half_length_tiles: 1.0, half_width_tiles: 0.5 },
  },
  sensors: SENSORS,
};
/** The same hull 1.6 tiles across (half width 0.8): two of them do not fit side by side in a two-wide street. */
const WIDE: UnitTypeJson = {
  ...TANK,
  id: 'sep_wide',
  mobility: {
    speed_tiles_s: 3,
    turn_rate_deg_s: 90,
    footprint: { half_length_tiles: 1.0, half_width_tiles: 0.8 },
  },
};
/** A gun that cannot hurt anything (damage 1 into 30000 hp), range 8: it only makes its owner halt to fight. */
const GUN = {
  type: 'small_arms',
  range_tiles: 8,
  effective_range_tiles: 6,
  accuracy: 0.6,
  penetration: 8,
  damage: 1,
  suppression: 0,
  rof_per_min: 60,
};
const GUNNER: UnitTypeJson = { ...TANK, id: 'sep_gunner', hull: { hp: 30000, armor: { front: 300, side: 200, rear: 100 } }, weapons: [{ id: 'gun', ...GUN }] };
/** Something to shoot at: it neither fires nor moves (a dummy on foot, 30000 hp). */
const TARGET: UnitTypeJson = {
  id: 'sep_target',
  role: 'infantry',
  hull: { hp: 30000, armor: { front: 300, side: 300, rear: 300 } },
  mobility: { speed_tiles_s: 0.5 },
  sensors: { optics: 1, sight_tiles: 4, signature: 1 },
};

/** The D9 in miniature: a blade demolisher, 2 s (40 ticks) a building, wheeled so it is a vehicle. */
const DOZER: UnitTypeJson = {
  id: 'sep_dozer',
  role: 'engineer',
  hull: HULL,
  mobility: {
    speed_tiles_s: 3,
    turn_rate_deg_s: 90,
    wheeled: true,
    footprint: { half_length_tiles: 1.0, half_width_tiles: 0.5 },
  },
  sensors: SENSORS,
  abilities: ['demolish'],
  demolition_time_s: 8.0,
  demolition_method: 'blade',
};

const W = 48;
const EAST = 0;
const WEST = ONE / 2;
const NORTH = (ONE * 3) / 4;

/** Raw-fixed-point internals a test reaches through a cast, the pattern the other specs use. */
interface World {
  sim: Sim;
  tank: number;
  wide: number;
  gunner: number;
  target: number;
  dozer: number;
}
function world(h = 40, capacity = 32): World {
  const sim = new Sim({ seed: 3, width: W, height: h, capacity });
  const tank = sim.addUnitType(TANK);
  const wide = sim.addUnitType(WIDE);
  const gunner = sim.addUnitType(GUNNER);
  const target = sim.addUnitType(TARGET);
  const dozer = sim.addUnitType(DOZER);
  return { sim, tank, wide, gunner, target, dozer };
}
/** Walls on every row of the strip except `open` (inclusive), over the whole width. */
function corridor(sim: Sim, h: number, openFrom: number, openTo: number): void {
  for (let y = 0; y < h; y++) {
    if (y >= openFrom && y <= openTo) continue;
    for (let x = 0; x < W; x++) sim.setBlocked(x, y, true);
  }
}
function go(sim: Sim, id: number, x: number, y: number): void {
  sim.queueCommand({ kind: 'move', ids: [id], x: fx.from(x), y: fx.from(y), exact: true });
}
const capBuf = new Int32Array(10);
const outBuf = new Int32Array(4);
/** Overlap of two hulls as drawn now, raw Q16.16 (> 0 is overlapping). */
function overlap(sim: Sim, a: number, b: number): Fx {
  const ta = sim.unitTypes[sim.state.typeIdx[a]];
  const tb = sim.unitTypes[sim.state.typeIdx[b]];
  hullCapsule(sim.state.posX[a], sim.state.posY[a], sim.state.facing[a], ta.sepHalfLen, ta.sepHalfWid, ta.sepCentre, capBuf, 0);
  hullCapsule(sim.state.posX[b], sim.state.posY[b], sim.state.facing[b], tb.sepHalfLen, tb.sepHalfWid, tb.sepCentre, capBuf, 5);
  return capsuleOverlap(capBuf, 0, 5, outBuf);
}
const near = (sim: Sim, id: number, x: number, y: number, tiles: number): boolean =>
  Math.abs(fx.toNumber(sim.state.posX[id]) - x) <= tiles && Math.abs(fx.toNumber(sim.state.posY[id]) - y) <= tiles;
const isBlocked = (sim: Sim, x: number, y: number): boolean => sim.blocked[y * W + x] !== 0;
const tilePos = (sim: Sim, id: number): string => `${fx.toNumber(sim.state.posX[id]).toFixed(2)},${fx.toNumber(sim.state.posY[id]).toFixed(2)}`;

describe('stationary hulls never move (GH-421)', () => {
  it('a parked hull in the road of a column of three: its position is bit-identical every tick, and the column gets past', () => {
    const { sim, tank } = world();
    const parked = sim.spawn(tank, 0, fx.from(24.5), fx.from(20.5), EAST);
    const col = [6.5, 9.5, 12.5].map((x) => sim.spawn(tank, 0, fx.from(x), fx.from(20.5), EAST));
    // Three distinct goals three tiles apart: one shared goal would end the followers' legs at contact (B+).
    col.forEach((c, k) => go(sim, c, 34.5 + 3 * k, 20.5));
    const x0 = sim.state.posX[parked];
    const y0 = sim.state.posY[parked];
    let allPast = -1;
    let worst = 0;
    for (let t = 1; t <= 400; t++) {
      sim.tick();
      expect(sim.state.posX[parked]).toBe(x0);
      expect(sim.state.posY[parked]).toBe(y0);
      for (const c of col) worst = Math.max(worst, overlap(sim, parked, c));
      if (allPast < 0 && col.every((c) => sim.state.moving[c] === 0)) allPast = t;
    }
    // They go round it, not through it: no hull of the column ever overlaps the parked one by 0.05 tile.
    expect(worst).toBeLessThanOrEqual(3277);
    // 34 tiles at 0.15 a tick is 227 ticks flat; steering round the parked hull costs the rest.
    // Stated bound: every one of the three has arrived within 330 ticks (16.5 s).
    expect(allPast).toBeGreaterThan(0);
    expect(allPast).toBeLessThanOrEqual(330);
  });
});

describe('two hulls meeting head-on (GH-421)', () => {
  it('on open ground they pass on a tile-centre line: both arrive, overlap never above 0.05 tile, the valve never opens', () => {
    const { sim, tank } = world();
    const a = sim.spawn(tank, 0, fx.from(8.5), fx.from(20.5), EAST);
    const b = sim.spawn(tank, 0, fx.from(38.5), fx.from(20.5), WEST);
    go(sim, a, 38.5, 20.5);
    go(sim, b, 8.5, 20.5);
    let worst = 0;
    let maxWait = 0;
    for (let t = 1; t <= 500; t++) {
      sim.tick();
      worst = Math.max(worst, overlap(sim, a, b));
      maxWait = Math.max(maxWait, sim.state.sepWait[a], sim.state.sepWait[b]);
    }
    expect(near(sim, a, 38.5, 20.5, 0.6)).toBe(true);
    expect(near(sim, b, 8.5, 20.5, 0.6)).toBe(true);
    expect(sim.state.moving[a]).toBe(0);
    expect(sim.state.moving[b]).toBe(0);
    expect(worst).toBeLessThanOrEqual(3277);
    expect(maxWait).toBeLessThan(SEP_VALVE_TICKS);
  });

  it('in a two-wide corridor two 1.6-wide hulls cannot pass: both still arrive, and the valve opens to let them through', () => {
    const { sim, wide } = world();
    corridor(sim, 40, 20, 21);
    const a = sim.spawn(wide, 0, fx.from(8.5), fx.from(20.5), EAST);
    const b = sim.spawn(wide, 0, fx.from(38.5), fx.from(20.5), WEST);
    go(sim, a, 38.5, 20.5);
    go(sim, b, 8.5, 20.5);
    let maxWait = 0;
    for (let t = 1; t <= 900; t++) {
      sim.tick();
      maxWait = Math.max(maxWait, sim.state.sepWait[a], sim.state.sepWait[b]);
    }
    expect(maxWait).toBeGreaterThanOrEqual(SEP_VALVE_TICKS);
    expect(near(sim, a, 38.5, 20.5, 0.6)).toBe(true);
    expect(near(sim, b, 8.5, 20.5, 0.6)).toBe(true);
  });
});

describe('a mobility-killed hulk in the road (GH-421)', () => {
  it('a column of three gets past a hulk in a three-wide street, and the hulk never moves', () => {
    const { sim, tank } = world();
    corridor(sim, 40, 19, 21);
    const hulk = sim.spawn(tank, 0, fx.from(24.5), fx.from(20.5), EAST);
    sim.state.mobilityKilled[hulk] = 1;
    const col = [6.5, 9.5, 12.5].map((x) => sim.spawn(tank, 0, fx.from(x), fx.from(20.5), EAST));
    col.forEach((c, k) => go(sim, c, 34.5 + 3 * k, 20.5));
    const x0 = sim.state.posX[hulk];
    const y0 = sim.state.posY[hulk];
    let allPast = -1;
    let worst = 0;
    for (let t = 1; t <= 600; t++) {
      sim.tick();
      expect(sim.state.posX[hulk]).toBe(x0);
      expect(sim.state.posY[hulk]).toBe(y0);
      for (const c of col) worst = Math.max(worst, overlap(sim, hulk, c));
      if (allPast < 0 && col.every((c) => sim.state.moving[c] === 0)) allPast = t;
    }
    expect(worst).toBeLessThanOrEqual(3277);
    expect(allPast).toBeGreaterThan(0);
    expect(allPast).toBeLessThanOrEqual(450);
  });
});

describe('arrival at contact, B+ (GH-421)', () => {
  it('four hulls in a column ordered exact to one point queue up nose to tail behind the hull at the goal: each stops in contact, none on top of another', () => {
    const { sim, tank } = world();
    const ids = [6.5, 9.5, 12.5, 15.5].map((x) => sim.spawn(tank, 0, fx.from(x), fx.from(20.5), EAST));
    for (const id of ids) go(sim, id, 30.5, 20.5);
    for (let t = 0; t < 400; t++) sim.tick();
    // The front hull is on the goal; each behind it stops 2.1 tiles back (nose and tail touching, 0.1
    // of gap): 28.4, 26.3, 24.2 in raw Q16.16 within one step (9830).
    expect(ids.map((id) => sim.state.moving[id])).toEqual([0, 0, 0, 0]);
    [24.2, 26.3, 28.4, 30.5].forEach((x, k) => expect(Math.abs(fx.toNumber(sim.state.posX[ids[k]]) - x)).toBeLessThanOrEqual(0.15));
    for (let k = 0; k + 1 < ids.length; k++) expect(overlap(sim, ids[k], ids[k + 1])).toBeLessThanOrEqual(0);
  });
});

describe('hulls that spawned inside each other (GH-421)', () => {
  it('one ordered away leaves at once -- a step that reduces an overlap is never blocked, so its valve never moves', () => {
    const { sim, tank } = world();
    const stay = sim.spawn(tank, 0, fx.from(20.5), fx.from(20.5), EAST);
    const leave = sim.spawn(tank, 0, fx.from(20.5), fx.from(20.5), EAST);
    go(sim, leave, 30.5, 20.5);
    const x0 = sim.state.posX[stay];
    let clearAt = -1;
    for (let t = 1; t <= 200; t++) {
      sim.tick();
      expect(sim.state.posX[stay]).toBe(x0);
      expect(sim.state.sepWait[leave], `tick ${t}`).toBe(0);
      if (clearAt < 0 && overlap(sim, stay, leave) < 0) clearAt = t;
    }
    // Coincident hulls (overlap 1.0): the leaver is a hull length (2.0 tiles) clear after 2.0 / 0.15
    // = 14 ticks. Blocked, it would stand 20 ticks to the valve and ghost: clear at 34 or later.
    expect(clearAt).toBeGreaterThan(0);
    expect(clearAt).toBeLessThanOrEqual(16);
    expect(near(sim, leave, 30.5, 20.5, 0.6)).toBe(true);
  });
});

describe('a demolishing hull is never disturbed (GH-421)', () => {
  it('its charge clock counts up undisturbed while a column drives past it', () => {
    const { sim, tank, dozer } = world();
    const shack = sim.addStructureType({ id: 'sep_shack', hp_per_tile: 100 });
    sim.addStructure(shack, [18 * W + 24]);
    const d = sim.spawn(dozer, 0, fx.from(24.5), fx.from(20.5), NORTH);
    const col = [6.5, 9.5, 12.5].map((x) => sim.spawn(tank, 0, fx.from(x), fx.from(20.5), EAST));
    col.forEach((c, k) => go(sim, c, 34.5 + 3 * k, 20.5));
    const x0 = sim.state.posX[d];
    const y0 = sim.state.posY[d];
    // The dozer's blade charge runs 160 ticks (8 s); progress is ticks / 160, one tick after the
    // first it is 1/160. It reads exactly its tick count over 160 while the column passes.
    for (let t = 1; t <= 120; t++) {
      sim.tick();
      expect(sim.state.posX[d]).toBe(x0);
      expect(sim.state.posY[d]).toBe(y0);
      expect(sim.demolitionProgress(d)).toBeCloseTo(t / 160, 6);
    }
    expect(col.every((c) => fx.toNumber(sim.state.posX[c]) > 20)).toBe(true);
    for (let t = 121; t <= 170; t++) sim.tick();
    expect(sim.structureAt(24, 18)).toBeLessThan(0);
  });
});

describe('two hulls converging abreast on one lane (GH-421, R2)', () => {
  it('neither waits for the other: the lower id steers on, the higher follows, and the valve stays shut for the higher', () => {
    const { sim, tank } = world();
    // Both face north; the lower id is 0.9 tile ahead and 1.6 tiles to the west, and their goals (tiles
    // 24 and 24) pull them onto one lane. Each regards the other as "ahead" of its own heading.
    const a = sim.spawn(tank, 0, fx.from(23), fx.from(30), NORTH);
    const b = sim.spawn(tank, 0, fx.from(24.6), fx.from(30.9), NORTH);
    go(sim, a, 24, 10);
    go(sim, b, 24.5, 10);
    let maxWaitB = 0;
    for (let t = 1; t <= 60; t++) {
      sim.tick();
      maxWaitB = Math.max(maxWaitB, sim.state.sepWait[b]);
    }
    // Free running is 0.15 tile a tick: 60 ticks is 9 tiles, from y 30 and 30.9 to 21 and 21.9. With
    // the pair both waiting for each other (measured) they sit at 24.4 and 24.9 and both reach the
    // valve at 40. With the priority rule: a at 21.83, b at 23.70, and b's wait peaks at 23, under the valve.
    expect(fx.toNumber(sim.state.posY[a])).toBeLessThan(23);
    expect(fx.toNumber(sim.state.posY[b])).toBeLessThan(24.2);
    expect(maxWaitB).toBeLessThan(SEP_VALVE_TICKS);
  });
});

describe('two hulls abreast whose goals cross (GH-421, R2)', () => {
  it('a same-way hull beside one is steered round, not waited for: both clear the cross-over within a second of free running', () => {
    const { sim, tank } = world();
    // Abreast (1.0 apart, the second 0.2 behind), both facing north, goals crossing: a to the east, b to
    // the west. Each is beside the other, so neither is "ahead" of it.
    const a = sim.spawn(tank, 0, fx.from(23), fx.from(30), NORTH);
    const b = sim.spawn(tank, 0, fx.from(24), fx.from(30.2), NORTH);
    go(sim, a, 25.5, 10);
    go(sim, b, 22.5, 10);
    for (let t = 1; t <= 60; t++) sim.tick();
    // Free running covers 9 tiles in 60 ticks (y 21 and 21.2). Measured with the rule: 21.83 and 23.59;
    // with each waiting for the other (the beside hull treated as ahead): 24.83 and 24.79, both stalled.
    expect(fx.toNumber(sim.state.posY[a])).toBeLessThan(24);
    expect(fx.toNumber(sim.state.posY[b])).toBeLessThan(24);
  });
});

describe('a column does not stop-start behind its leader (GH-421)', () => {
  it('a follower with the LOWER id keeps station at the leader\'s speed: the leader is read one step ahead', () => {
    const { sim, tank } = world();
    // Nose to tail, 2.1 tiles apart (the hulls are 2.0 long: 0.1 of gap, under one 0.15 step), the follower spawned first.
    const follower = sim.spawn(tank, 0, fx.from(6.5), fx.from(20.5), EAST);
    const leader = sim.spawn(tank, 0, fx.from(8.6), fx.from(20.5), EAST);
    go(sim, follower, 40.5, 20.5);
    go(sim, leader, 44.5, 20.5);
    let worst = 0;
    for (let t = 1; t <= 100; t++) {
      sim.tick();
      worst = Math.max(worst, overlap(sim, follower, leader));
    }
    // 100 ticks at 0.15 is 15 tiles each: the follower at 21.5. Reading the leader where it stood last
    // tick (the follower runs first) makes every follow step close the 0.1 gap to -0.05, which is an
    // overlap that deepens, so it waits: it stops dead behind the leader's old tail.
    expect(fx.toNumber(sim.state.posX[follower])).toBeGreaterThan(21.4);
    expect(worst).toBeLessThanOrEqual(0);
  });
});

describe('the valve decays, it does not reset (GH-421, R1)', () => {
  it('once open it stays open until the count falls below the threshold, one a free tick', () => {
    const { sim, wide } = world();
    corridor(sim, 40, 20, 21);
    const a = sim.spawn(wide, 0, fx.from(8.5), fx.from(20.5), EAST);
    const b = sim.spawn(wide, 0, fx.from(38.5), fx.from(20.5), WEST);
    go(sim, a, 38.5, 20.5);
    go(sim, b, 8.5, 20.5);
    let prev = 0;
    let sawDecay = false;
    let sawStand = false;
    let lastX = sim.state.posX[a];
    let lastY = sim.state.posY[a];
    for (let t = 1; t <= 900; t++) {
      sim.tick();
      const w = sim.state.sepWait[a];
      // A tick spent standing blocked costs two.
      if (w > prev && w < SEP_VALVE_TICKS && sim.state.posX[a] === lastX && sim.state.posY[a] === lastY) {
        expect(w - prev, `tick ${t}`).toBe(2);
        sawStand = true;
      }
      lastX = sim.state.posX[a];
      lastY = sim.state.posY[a];
      // A count that has been at the threshold or above falls by exactly one on a free tick.
      if (prev >= SEP_VALVE_TICKS && w < prev) {
        expect(w, `tick ${t}`).toBe(prev - 1);
        sawDecay = true;
      }
      prev = w;
    }
    expect(sawDecay).toBe(true);
    expect(sawStand).toBe(true);
  });

  it('a free tick right after a blocked one does not pay it off; the second free tick does', () => {
    const { sim, tank } = world();
    const h = sim.spawn(tank, 0, fx.from(10.5), fx.from(20.5), EAST);
    go(sim, h, 40.5, 20.5);
    sim.tick(); // the order lands (a new order clears the valve: N1), then the count is set
    sim.state.sepWait[h] = 10;
    sim.state.sepLast[h] = 1; // the last test was blocked
    sim.tick();
    expect([sim.state.sepWait[h], sim.state.sepLast[h]]).toEqual([10, 0]);
    sim.tick();
    expect(sim.state.sepWait[h]).toBe(9);
    sim.tick();
    expect(sim.state.sepWait[h]).toBe(8);
  });
});

describe('a hull that steers round and is pulled back does not livelock (GH-421)', () => {
  it('in a seven-wide lane past a hulk 1.6 wide, a hull arrives 24 tiles on; steering that cost nothing would creep forever', () => {
    const { sim, tank, wide } = world();
    for (let y = 0; y < 40; y++) for (let x = 0; x < W; x++) if (x < 26 || x > 32) sim.setBlocked(x, y, true);
    const hulk = sim.spawn(wide, 0, fx.from(28), fx.from(21), EAST);
    sim.state.mobilityKilled[hulk] = 1;
    const m = sim.spawn(tank, 0, fx.from(28.5), fx.from(16), NORTH + ONE / 2);
    go(sim, m, 27.5, 38.5);
    for (let t = 1; t <= 600; t++) sim.tick();
    // The goal lies on the far side of the hulk, so the field pulls the hull back into it after every
    // steer. Measured with a steered tick counted at +1: the valve opens after about 40 ticks of that and
    // the hull passes, through the hulk (the safety valve, 0.56 tile deep) -- and arrives. With a steered
    // tick worth nothing the count never builds: the hull stood at y 19.8 for the whole run, moving,
    // wait 0, 20 tiles short.
    expect(fx.toNumber(sim.state.posY[m])).toBeGreaterThan(38);
  });
});

describe('arrival at contact only AT the goal (GH-421, B+)', () => {
  it('a hull passed by another bound for the same goal tile 18 tiles on does not stop in the open', () => {
    const { sim, tank } = world();
    // Both face north, 1.8 apart and both ordered to tile (24, 10). a is blocked in passing, 18 tiles
    // short, by b (which is nearer to the goal): with arrival at contact anywhere, a stops at y 28.4.
    const a = sim.spawn(tank, 0, fx.from(22.6), fx.from(30), NORTH);
    const b = sim.spawn(tank, 0, fx.from(24.4), fx.from(30.3), NORTH);
    go(sim, a, 24.1, 10);
    go(sim, b, 24.9, 10);
    for (let t = 1; t <= 400; t++) sim.tick();
    expect(sim.state.moving[a]).toBe(0);
    expect(sim.state.moving[b]).toBe(0);
    // Both end in the queue at the goal: within 3.5 tiles (one hull length and a gap) of it.
    expect(fx.toNumber(sim.state.posY[a])).toBeLessThan(14);
    expect(fx.toNumber(sim.state.posY[b])).toBeLessThan(14);
  });
});

describe('what counts as stationary (GH-421, R3 and R4)', () => {
  it('R3: a hull halted to fight does not hold a goal, so a leg ordered onto it does not end at contact', () => {
    const { sim, gunner, tank, target } = world();
    // The fighter attack-moves east and halts in range of the dummy it sees (moving 1, attack-move,
    // engaging: stepMovement skips it). Another hull is then ordered onto the very tile it stands on.
    const fighter = sim.spawn(gunner, 0, fx.from(24.5), fx.from(20.5), EAST);
    sim.spawn(target, 1, fx.from(34.5), fx.from(20.5), WEST);
    sim.queueCommand({ kind: 'attackMove', ids: [fighter], x: fx.from(44.5), y: fx.from(20.5), exact: true });
    for (let t = 0; t < 60; t++) sim.tick();
    const fx0 = sim.state.posX[fighter];
    const fy0 = sim.state.posY[fighter];
    const px = fx.toNumber(fx0);
    expect(sim.state.moving[fighter]).toBe(1);
    const comer = sim.spawn(tank, 0, fx.from(px - 14), fx.from(20.5), EAST);
    go(sim, comer, px, 20.5);
    // 14 tiles at 0.15 a tick: first blocked at about tick 78 and the valve (wait +2 a tick) opens 20
    // ticks later. 90 ticks in it has been blocked a dozen ticks and is still a mover, not finished.
    for (let t = 0; t < 90; t++) {
      sim.tick();
      expect(sim.state.posX[fighter]).toBe(fx0);
      expect(sim.state.posY[fighter]).toBe(fy0);
    }
    // Blocked by the fighter and going round it: 0.1 tile off its row by now (the first steer is 0.106).
    expect(Math.abs(fx.toNumber(sim.state.posY[comer]) - 20.5), 'steering round the fighter').toBeGreaterThan(0.1);
    expect(sim.state.moving[comer], `comer at ${tilePos(sim, comer)}`).toBe(1);
  });

  it('R4: a pinned leader is steered round, not waited behind', () => {
    const { sim, tank } = world();
    const leader = sim.spawn(tank, 0, fx.from(14.5), fx.from(20.5), EAST);
    const follower = sim.spawn(tank, 0, fx.from(6.5), fx.from(20.5), EAST);
    go(sim, leader, 44.5, 20.5);
    go(sim, follower, 40.5, 20.5);
    let passedAt = -1;
    let worst = 0;
    for (let t = 1; t <= 300; t++) {
      sim.state.pinned[leader] = 1; // a pinned hull crawls at half speed
      sim.tick();
      worst = Math.max(worst, overlap(sim, leader, follower));
      if (passedAt < 0 && sim.state.posX[follower] > sim.state.posX[leader] + fx.from(1.5)) passedAt = t;
    }
    // Round it, not through it: waiting behind a leader that never speeds up ends at the valve, which
    // walks the follower through the leader's hull.
    expect(worst).toBeLessThanOrEqual(3277);
    // The follower closes at 0.075 a tick and meets the leader about tick 107; a wait would keep it
    // behind the leader's x for the whole run, a steer puts it a hull length ahead by tick 190.
    expect(passedAt).toBeGreaterThan(0);
    expect(passedAt).toBeLessThanOrEqual(190);
  });
});

/** The TANK hull at another speed, for the follow specs. */
const at = (id: string, speed: number): UnitTypeJson => ({ ...TANK, id, mobility: { ...TANK.mobility, speed_tiles_s: speed } });

describe('a faster hull behind a slower one follows it and never ghosts through (GH-421, M1)', () => {
  // Leader and follower on one lane of open ground, both heading east, the follower much the faster.
  // `leaderFirst` gives the leader the lower id (the follower reads it where it stands); otherwise the
  // leader is read one nominal step ahead. 3277 raw is 0.05 tile of overlap.
  for (const [ls, fs, leaderFirst] of [
    [1.0, 3.0, true],
    [1.5, 3.0, true],
    [0.5, 1.0, false],
    [2.0, 3.0, true],
  ] as const) {
    it(`leader ${ls} tiles/s, follower ${fs}: 300 ticks, overlap never over 3277, the valve never opens`, () => {
      const sim = new Sim({ seed: 3, width: W, height: 40, capacity: 8 });
      const slow = sim.addUnitType(at('sep_slow', ls));
      const fast = sim.addUnitType(at('sep_fast', fs));
      let leader: number;
      let follower: number;
      if (leaderFirst) {
        leader = sim.spawn(slow, 0, fx.from(10.6), fx.from(20.5), EAST);
        follower = sim.spawn(fast, 0, fx.from(6.5), fx.from(20.5), EAST);
      } else {
        follower = sim.spawn(fast, 0, fx.from(6.5), fx.from(20.5), EAST);
        leader = sim.spawn(slow, 0, fx.from(10.6), fx.from(20.5), EAST);
      }
      go(sim, leader, 46.5, 20.5);
      go(sim, follower, 46.5, 20.5);
      let worst = -ONE;
      let maxWait = 0;
      for (let t = 1; t <= 300; t++) {
        sim.tick();
        worst = Math.max(worst, overlap(sim, leader, follower));
        maxWait = Math.max(maxWait, sim.state.sepWait[follower]);
        // Behind the leader's tail the whole way: the follower's centre never passes the leader's.
        expect(sim.state.posX[follower], `tick ${t}`).toBeLessThan(sim.state.posX[leader]);
      }
      expect(worst).toBeLessThanOrEqual(3277);
      // Following is not waiting: the hull gains ground every tick, so the count never builds. Before the
      // partial step, a blocked tick cost 2 and the free tick after it nothing, so at 1.5 / 3.0 the valve
      // (40) opened at tick 66 and the follower drove through its leader.
      expect(maxWait).toBeLessThan(SEP_VALVE_TICKS / 2);
      // And a tick spent following is a free tick for the count: a stale count of 30 falls as it goes on.
      sim.state.sepWait[follower] = 30;
      sim.state.sepLast[follower] = 0;
      for (let t = 0; t < 10; t++) sim.tick();
      expect(sim.state.sepWait[follower]).toBeLessThan(30);
    });
  }
});

describe('a new order starts with a closed valve (GH-421, N1)', () => {
  it('a move order clears a stale open valve and its last-blocked flag', () => {
    const { sim, tank } = world();
    const h = sim.spawn(tank, 0, fx.from(10.5), fx.from(20.5), EAST);
    go(sim, h, 20.5, 20.5);
    sim.tick();
    sim.state.sepWait[h] = 60; // open from an earlier jam
    sim.state.sepLast[h] = 1;
    go(sim, h, 30.5, 20.5);
    sim.tick();
    // Without the reset the first free tick after a blocked one leaves the count at 60 (it only falls on
    // a free tick that follows a free tick), and the valve stays open for the new order.
    expect([sim.state.sepWait[h], sim.state.sepLast[h]]).toEqual([0, 0]);
  });

  it('an attack order does too', () => {
    const { sim, gunner, target } = world();
    const g = sim.spawn(gunner, 0, fx.from(10.5), fx.from(20.5), EAST);
    const e = sim.spawn(target, 1, fx.from(12.5), fx.from(20.5), WEST);
    for (let t = 0; t < 5; t++) sim.tick();
    sim.state.sepWait[g] = 60;
    sim.state.sepLast[g] = 1;
    sim.queueCommand({ kind: 'attack', ids: [g], target: e });
    sim.tick();
    expect(sim.state.focusTarget[g], 'the order was accepted').toBe(e);
    expect(sim.state.sepWait[g]).toBe(0);
    expect(sim.state.sepLast[g]).toBe(0);
  });
});

describe('a leg that ends in a range test does not end at contact (GH-421, N2)', () => {
  it('a dozer ordered at a shack beside a parked hull keeps trying until it is within demolition range', () => {
    const { sim, tank, dozer } = world();
    const shack = sim.addStructureType({ id: 'sep_shack2', hp_per_tile: 100 });
    sim.addStructure(shack, [18 * W + 24]);
    // A hulk (mobility killed: it never moves) on the shack's west flank. A dozer is aimed at the shack's
    // centre (24.5, 18.5); a hull stood there would overlap the hulk (its nose reaches 23.7, the dozer's
    // tail 23.5), so B+ would end the dozer's leg at the hulk's flank, 3 tiles short, out of demolition range.
    const hulk = sim.spawn(tank, 0, fx.from(22.7), fx.from(18.5), EAST);
    sim.state.mobilityKilled[hulk] = 1;
    const d = sim.spawn(dozer, 0, fx.from(12.5), fx.from(18.5), EAST);
    sim.queueCommand({ kind: 'demolish', ids: [d], structure: sim.structureAt(24, 18) });
    for (let t = 1; t <= 700; t++) sim.tick();
    // The shack is down: the dozer got within range (steering round the hulk, or through the valve) and
    // charged. Ended at contact, it stood moving 0 at x 20.7 for the rest of the run and the shack stood.
    expect(sim.structureAt(24, 18), `dozer at ${tilePos(sim, d)}`).toBeLessThan(0);
  });
});

describe('a steered candidate never leaves the open ground (GH-421)', () => {
  it('a diagonal steer that would cut a wall corner is refused: the hull waits where it is', () => {
    const { sim, tank, wide } = world();
    // The hull stands at (20.9, 20.95) facing east. A wide hulk's nearest point to its nose (21.4, 20.95) is
    // 0.92 east and 0.92 north, just touching (radius sum 1.3): any step east deepens the overlap, a
    // 45-degree step south-east does not. That step lands at (21.0, 21.06), tile (21, 21), diagonal from
    // its own tile (20, 20), with (21, 20) and (21, 21) open and (20, 21) a wall: a step across that
    // wall's corner. The straight-south candidate is in the wall tile. Both are refused, and it waits.
    sim.setBlocked(20, 21, true);
    const hulk = sim.spawn(wide, 0, fx.from(22.52), fx.from(20.03), EAST);
    sim.state.mobilityKilled[hulk] = 1;
    const h = sim.spawn(tank, 0, fx.from(20.9), fx.from(20.95), EAST);
    go(sim, h, 40.5, 20.95);
    for (let t = 1; t <= 15; t++) {
      sim.tick();
      expect(`${sim.state.posX[h] >> 16},${sim.state.posY[h] >> 16}`, `tick ${t} at ${tilePos(sim, h)}`).toBe('20,20');
    }
  });

  it('in a two-wide lane past a hulk, no tick puts a hull on a blocked tile or across a wall corner', () => {
    const { sim, tank, wide } = world();
    corridor(sim, 40, 17, 24);
    // Lone pillars on a staggered lattice: a steered diagonal step has a blocked tile at a corner to cut.
    for (let x = 14; x < 40; x += 2) for (const y of [x % 4 === 0 ? 18 : 23, x % 4 === 0 ? 22 : 19]) sim.setBlocked(x, y, true);
    const hulk = sim.spawn(wide, 0, fx.from(24), fx.from(20.9), EAST);
    sim.state.mobilityKilled[hulk] = 1;
    const ids = [6.5, 9.5, 12.5].map((x) => sim.spawn(tank, 0, fx.from(x), fx.from(20.5), EAST));
    ids.forEach((id, k) => go(sim, id, 40.5 + k, 20.5));
    const prev = ids.map((id) => [sim.state.posX[id] >> 16, sim.state.posY[id] >> 16]);
    let steeredOff = false;
    for (let t = 1; t <= 500; t++) {
      sim.tick();
      ids.forEach((id, k) => {
        const tx = sim.state.posX[id] >> 16;
        const ty = sim.state.posY[id] >> 16;
        expect(isBlocked(sim, tx, ty), `tick ${t}: unit ${id} at ${tilePos(sim, id)}`).toBe(false);
        if (tx !== prev[k][0] && ty !== prev[k][1]) {
          expect(isBlocked(sim, tx, prev[k][1]), `tick ${t}: corner cut`).toBe(false);
          expect(isBlocked(sim, prev[k][0], ty), `tick ${t}: corner cut`).toBe(false);
        }
        prev[k] = [tx, ty];
        if (Math.abs(fx.toNumber(sim.state.posY[id]) - 20.5) > 0.05) steeredOff = true;
      });
    }
    expect(steeredOff, 'the hulls did steer, so the check had something to refuse').toBe(true);
  });
});

describe('a footprint whose segment is a sliver is refused at registration (GH-421, N4)', () => {
  const foot = (len: number, wid: number): UnitTypeJson => ({ ...TANK, id: `sep_foot_${len}_${wid}`, mobility: { ...TANK.mobility, footprint: { half_length_tiles: len, half_width_tiles: wid } } });
  it('a segment under 1/64 tile throws; a point (a round hull) and a real segment do not', () => {
    const sim = new Sim({ seed: 3, width: W, height: 40, capacity: 4 });
    // 0.505 - 0.5 = 0.005 tile = 328 raw, under the 1024 (1/64 tile) the division by its squared length needs.
    expect(() => sim.addUnitType(foot(0.505, 0.5))).toThrow(/segment/);
    expect(() => sim.addUnitType(foot(0.5, 0.5))).not.toThrow();
    expect(() => sim.addUnitType(foot(0.52, 0.5))).not.toThrow(); // 0.02 tile = 1311 raw
  });
});
