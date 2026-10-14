import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, TICKS_PER_SECOND, type SimEvent, type UnitTypeJson } from './sim';
import { COVER_SIG } from './tuning';

// The garrison overhaul (GH-280, GH-34, GH-588; lead rulings 2026-10-14).
// docs/superpowers/plans/2026-10-14-garrison-overhaul.md

const HOUSE = { id: 'g_house', name: 'House', hp_per_tile: 260, garrison_slots: 2, rubble_cover: 2 };
const SHED = { id: 'g_shed', name: 'Shed', hp_per_tile: 120, garrison_slots: 1, rubble_cover: 1 };
/** Blocks sight and movement, holds nobody: the obstacle in the sight tests. */
const BLOCK = { id: 'g_block', name: 'Block', hp_per_tile: 900, garrison_slots: 0, rubble_cover: 1 };

const RIFLE_WEAPON = {
  id: 'rifles', type: 'small_arms', range_tiles: 8, effective_range_tiles: 6.4, accuracy: 0.6,
  penetration: 8, damage: 15, suppression: 50, rof_per_min: 300,
};
const RIFLES: UnitTypeJson = {
  id: 'g_rifles', role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.6 },
  sensors: { optics: 1, sight_tiles: 10, signature: 0.6 },
  abilities: ['garrison'],
  weapons: [RIFLE_WEAPON],
};
/** Never dies in a test's length, never shoots back. */
const DUMMY: UnitTypeJson = {
  id: 'g_dummy', role: 'infantry',
  hull: { hp: 30000, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1 },
  sensors: { optics: 1, sight_tiles: 1, signature: 1 },
};

function rect(sim: Sim, typeIdx: number, x: number, y: number, w: number, h: number): number {
  const tiles: number[] = [];
  for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) tiles.push(ty * sim.width + tx);
  return sim.addStructure(typeIdx, tiles);
}

function run(sim: Sim, ticks: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) out.push(...sim.tick());
  return out;
}

/** Order `id` into `s` and tick until it is inside. Throws if it never gets in. */
function garrison(sim: Sim, id: number, s: number): void {
  sim.queueCommand({ kind: 'garrison', ids: [id], structure: s });
  for (let k = 0; k < 400; k++) {
    sim.tick();
    if (sim.state.garrisonedIn[id] === s) return;
  }
  throw new Error(`unit ${id} never got into structure ${s}`);
}

function world(seed = 7) {
  const sim = new Sim({ seed, width: 48, height: 32, capacity: 32 });
  const house = sim.addStructureType(HOUSE);
  const shed = sim.addStructureType(SHED);
  const block = sim.addStructureType(BLOCK);
  const rifles = sim.addUnitType(RIFLES);
  const dummy = sim.addUnitType(DUMMY);
  return { sim, t: { house, shed, block }, u: { rifles, dummy } };
}

describe('capacity (B5, B3)', () => {
  for (const how of ['debugKill', 'removeFromPlay'] as const) {
    it(`${how} frees the slot, and the unit waiting at the door walks in`, () => {
      const { sim, t, u } = world();
      const house = rect(sim, t.house, 20, 14, 2, 2);
      const ids = [0, 1, 2].map((k) => sim.spawn(u.rifles, 0, fx.from(17.5), fx.from(12.5 + k)));
      sim.queueCommand({ kind: 'garrison', ids, structure: house });
      run(sim, 200);
      const inside = ids.filter((i) => sim.state.garrisonedIn[i] === house);
      const waiter = ids.find((i) => sim.state.garrisonedIn[i] !== house) ?? -1;
      expect(inside).toHaveLength(2);
      expect(waiter).toBeGreaterThanOrEqual(0);
      if (how === 'debugKill') sim.debugKill(inside[0]);
      else sim.removeFromPlay(inside[0]);
      expect(sim.structures.occupants[house]).toBe(1);
      expect(sim.state.garrisonedIn[inside[0]]).toBe(-1);
      run(sim, 5);
      expect(sim.state.garrisonedIn[waiter]).toBe(house);
      expect(sim.structures.occupants[house]).toBe(2);
    });
  }

  it('a slot freed by a mission removal is free the same tick (Review Focus 5)', () => {
    const { sim, t, u } = world();
    const shed = rect(sim, t.shed, 20, 14, 1, 1);
    const a = sim.spawn(u.rifles, 1, fx.from(19.5), fx.from(14.5));
    garrison(sim, a, shed);
    const b = sim.spawn(u.rifles, 1, fx.from(19.5), fx.from(13.5));
    sim.removeFromPlay(a);
    expect(sim.garrisonFree(shed)).toBe(1);
    sim.queueCommand({ kind: 'garrison', ids: [b], structure: shed });
    run(sim, 3);
    expect(sim.state.garrisonedIn[b]).toBe(shed);
  });

  it('a unit that finds the building full stops at the door and fights from there', () => {
    const { sim, t, u } = world();
    const shed = rect(sim, t.shed, 20, 14, 1, 1);
    const ids = [0, 1, 2].map((k) => sim.spawn(u.rifles, 0, fx.from(17.5), fx.from(12.5 + k)));
    sim.queueCommand({ kind: 'garrison', ids, structure: shed });
    run(sim, 200);
    const out = ids.filter((i) => sim.state.garrisonedIn[i] !== shed);
    expect(out).toHaveLength(2);
    for (const i of out) expect(sim.state.moving[i]).toBe(0);
    // Due north of the door, so the shed itself is never on the line.
    const target = sim.spawn(u.dummy, 1, fx.from(19.5), fx.from(7.5));
    const events = run(sim, 20 * TICKS_PER_SECOND);
    expect(sim.state.alive[target]).toBe(1);
    for (const i of out) {
      expect(events.some((e) => e.kind === 'fire' && e.shooter === i && e.target === target)).toBe(true);
    }
  });

  it('a waiter whose building falls stays alive and takes the next order (Review Focus 4)', () => {
    const { sim, t, u } = world();
    const shed = rect(sim, t.shed, 20, 14, 1, 1);
    const ids = [0, 1].map((k) => sim.spawn(u.rifles, 0, fx.from(17.5), fx.from(12.5 + k)));
    sim.queueCommand({ kind: 'garrison', ids, structure: shed });
    run(sim, 200);
    const waiter = ids.find((i) => sim.state.garrisonedIn[i] !== shed) ?? -1;
    expect(waiter).toBeGreaterThanOrEqual(0);
    sim.debugDestroyStructure(shed);
    run(sim, 20);
    expect(sim.state.alive[waiter]).toBe(1);
    expect(sim.state.moving[waiter]).toBe(0);
    sim.queueCommand({ kind: 'move', ids: [waiter], x: fx.from(10.5), y: fx.from(10.5) });
    run(sim, 2);
    expect(sim.state.moving[waiter]).toBe(1);
  });
});

describe('a garrison takes full building cover against suppression (B1, GH-280)', () => {
  // Three rifle squads fire at a house holding one man. A round that misses a
  // building lands on its nearest footprint tile, 0.71 tiles from a 2x2
  // house's centroid -- inside the near-miss radius -- so every miss is a near
  // miss on the man inside. The two arms differ only in garrison_cover.
  function pinnedTicks(garrisonCover: number | undefined): number {
    const sim = new Sim({ seed: 11, width: 48, height: 32, capacity: 16 });
    const type = sim.addStructureType(
      garrisonCover === undefined ? HOUSE : { ...HOUSE, garrison_cover: garrisonCover },
    );
    const house = rect(sim, type, 20, 14, 2, 2);
    const rifles = sim.addUnitType(RIFLES);
    const holder = sim.spawn(rifles, 1, fx.from(19.5), fx.from(14.5));
    garrison(sim, holder, house);
    sim.debugDisableFirepower(holder); // he must not drive the attackers off
    for (let k = 0; k < 3; k++) sim.spawn(rifles, 0, fx.from(28.5), fx.from(13.5 + k));
    let pinned = 0;
    for (let k = 0; k < 60 * TICKS_PER_SECOND; k++) {
      sim.tick();
      if (sim.state.pinned[holder] === 1) pinned++;
    }
    expect(sim.structures.alive[house]).toBe(1);
    return pinned;
  }

  it('pins a garrison whose building gives no cover (the control arm)', () => {
    expect(pinnedTicks(0)).toBeGreaterThan(200);
  });

  it('never pins one behind the default, cover 3', () => {
    expect(pinnedTicks(undefined)).toBe(0);
  });
});

describe('a garrisoned unit is as hard to spot as a man in cover 3 (G2)', () => {
  function seen(garrisonCover: number | undefined) {
    const sim = new Sim({ seed: 3, width: 48, height: 32, capacity: 16 });
    const type = sim.addStructureType(
      garrisonCover === undefined ? HOUSE : { ...HOUSE, garrison_cover: garrisonCover },
    );
    const house = rect(sim, type, 20, 14, 2, 2);
    const rifles = sim.addUnitType(RIFLES);
    const holder = sim.spawn(rifles, 1, fx.from(19.5), fx.from(14.5));
    garrison(sim, holder, house);
    sim.debugDisableFirepower(holder); // no firing signature
    const obs = sim.spawn(rifles, 0, fx.from(27.5), fx.from(14.5));
    sim.debugDisableFirepower(obs);
    return sim.debugDetection(obs, holder);
  }

  it('reads the building garrison cover, not the tile under the centroid', () => {
    const d = seen(undefined);
    expect(d?.visible).toBe(true);
    expect(d?.signature).toBe(fx.mul(fx.from(0.6), COVER_SIG[3]));
  });

  it('and a building that gives no cover hides nothing (the control arm)', () => {
    expect(seen(0)?.signature).toBe(fx.from(0.6));
  });
});

describe('range and sight are measured from the window (G1, B6)', () => {
  it('a long building: the man inside reaches from the end tile nearest the target', () => {
    const { sim, u } = world();
    // 1x9 at x=10..18: centroid (14.5, 10.5), east end tile (18.5, 10.5).
    const hall = rect(sim, sim.addStructureType({ ...HOUSE, id: 'g_long' }), 10, 10, 9, 1);
    const holder = sim.spawn(u.rifles, 0, fx.from(14.5), fx.from(11.5));
    garrison(sim, holder, hall);
    // 7.5 tiles from the window, 11.5 from the centroid: out of rifle range
    // (8) from the centroid even with a range bonus of 3.
    const target = sim.spawn(u.dummy, 1, fx.from(26), fx.from(10.5));
    sim.identifyTo(0, target);
    expect(sim.projectHit(holder, target).kind).toBe('shot');
    const events = run(sim, 10 * TICKS_PER_SECOND);
    expect(events.some((e) => e.kind === 'fire' && e.shooter === holder && e.target === target)).toBe(true);
  });

  it('an outside observer measures to the window nearest it', () => {
    const { sim, u } = world();
    const hall = rect(sim, sim.addStructureType({ ...HOUSE, id: 'g_long' }), 10, 10, 9, 1);
    const holder = sim.spawn(u.rifles, 1, fx.from(14.5), fx.from(11.5));
    garrison(sim, holder, hall);
    const obs = sim.spawn(u.rifles, 0, fx.from(25.5), fx.from(10.5));
    // Window (18.5, 10.5) to (25.5, 10.5): exactly 7 tiles.
    expect(sim.debugDetection(obs, holder)?.distSq).toBe(fx.from(49));
  });

  it('a building whose centroid falls off its own footprint does not blind its garrison (B6)', () => {
    const { sim, u } = world();
    // An L: the top row x=10..13 at y=10, and the stem x=10 at y=11..13. Its
    // centroid (11.36, 11.36) is on tile (11,11), open ground -- the shape of
    // the two khan_rafid_3 shanties.
    const tiles = [10, 11, 12, 13].map((x) => 10 * sim.width + x);
    for (const y of [11, 12, 13]) tiles.push(y * sim.width + 10);
    const ell = sim.addStructure(sim.addStructureType({ ...HOUSE, id: 'g_ell' }), tiles);
    expect(sim.structureAt(fx.toInt(sim.structures.cx[ell]), fx.toInt(sim.structures.cy[ell]))).not.toBe(ell);
    const holder = sim.spawn(u.rifles, 0, fx.from(14.5), fx.from(12.5));
    garrison(sim, holder, ell);
    // Due north: from the centroid tile (11,11) the ray crosses the L's own
    // top row at (11,10); from the window (11,10) it crosses nothing.
    const target = sim.spawn(u.dummy, 1, fx.from(11.5), fx.from(4.5));
    expect(sim.debugDetection(holder, target)?.visible).toBe(true);
  });

  it('garrison against garrison: fires at an enemy-held building from its own window (Review Focus 2)', () => {
    const { sim, t, u } = world();
    const mine = rect(sim, sim.addStructureType({ ...HOUSE, id: 'g_long' }), 4, 10, 9, 1); // x=4..12
    const theirs = rect(sim, t.house, 19, 10, 2, 2); // nearest tile (19.5, 10.5)
    const holder = sim.spawn(u.rifles, 0, fx.from(8.5), fx.from(11.5));
    garrison(sim, holder, mine);
    const enemy = sim.spawn(u.rifles, 1, fx.from(21.5), fx.from(12.5));
    garrison(sim, enemy, theirs);
    sim.debugDisableFirepower(enemy);
    sim.identifyTo(0, enemy);
    // Window (12.5, 10.5) to (19.5, 10.5) is 7 tiles; the centroid (8.5, 10.5) is 11.
    let hits = 0;
    for (let k = 0; k < 10 * TICKS_PER_SECOND; k++) {
      sim.identifyTo(0, enemy);
      for (const e of sim.tick()) if (e.kind === 'fire' && e.shooter === holder && e.structure === theirs) hits++;
    }
    expect(hits).toBeGreaterThan(0);
  });

  it('the window tile is the ground the eye stands on (Review Focus 3)', () => {
    // A 1x5 building x=10..14 whose three east tiles stand two levels up; one
    // floor. A block 3 tiles off each end, a target 7 tiles out. The centroid
    // tile (12,10) is on the high ground, so an eye left there sees the west
    // target and not the east one -- the reverse of what the windows see.
    function from(east: boolean): boolean {
      const { sim, t, u } = world();
      for (const x of [12, 13, 14]) sim.setElevation(x, 10, 2);
      const long = rect(sim, sim.addStructureType({ ...HOUSE, id: 'g_plinth' }), 10, 10, 5, 1);
      const holder = sim.spawn(u.rifles, 0, fx.from(12.5), fx.from(11.5));
      garrison(sim, holder, long);
      const end = east ? 14 : 10;
      const dir = east ? 1 : -1;
      rect(sim, t.block, end + dir * 3, 10, 1, 1);
      const target = sim.spawn(u.dummy, 1, fx.from(end + dir * 7 + 0.5), fx.from(10.5));
      return sim.debugDetection(holder, target)?.visible ?? false;
    }
    expect(from(true)).toBe(true); // the high end sees over its block
    expect(from(false)).toBe(false); // the low end, on the ground, does not
  });
});


describe('each floor above the ground adds to eye height (G3)', () => {
  function sees(floors: number, blockX: number): boolean {
    const { sim, t, u } = world();
    const tower = rect(sim, sim.addStructureType({ ...HOUSE, id: `g_f${floors}`, floors }), 10, 10, 2, 2);
    rect(sim, t.block, blockX, 10, 1, 1);
    const holder = sim.spawn(u.rifles, 0, fx.from(9.5), fx.from(11.5));
    garrison(sim, holder, tower);
    // Window (11.5, 10.5) to the target's tile (18, 10): seven steps.
    const target = sim.spawn(u.dummy, 1, fx.from(18.5), fx.from(10.5));
    return sim.debugDetection(holder, target)?.visible ?? false;
  }

  it('one floor: a building on the line blocks the view', () => expect(sees(1, 14)).toBe(false));
  it('three floors: it sees over a building in the nearer half of the line', () => expect(sees(3, 14)).toBe(true));
  it('but not over one standing beside the target: dead ground stays dead', () => expect(sees(3, 17)).toBe(false));

  it('and it is seen as far as it sees', () => {
    const { sim, t, u } = world();
    const tower = rect(sim, sim.addStructureType({ ...HOUSE, id: 'g_f3', floors: 3 }), 10, 10, 2, 2);
    rect(sim, t.block, 14, 10, 1, 1);
    const holder = sim.spawn(u.rifles, 1, fx.from(9.5), fx.from(11.5));
    garrison(sim, holder, tower);
    const obs = sim.spawn(u.rifles, 0, fx.from(18.5), fx.from(10.5));
    expect(sim.debugDetection(obs, holder)?.visible).toBe(true);
  });

  /** The same tower, block and target as `sees`, from the SHOOTER's side. */
  function shooter(floors: number) {
    const { sim, t, u } = world();
    const tower = rect(sim, sim.addStructureType({ ...HOUSE, id: `g_s${floors}`, floors }), 10, 10, 2, 2);
    rect(sim, t.block, 14, 10, 1, 1);
    const holder = sim.spawn(u.rifles, 0, fx.from(9.5), fx.from(11.5));
    garrison(sim, holder, tower);
    const target = sim.spawn(u.dummy, 1, fx.from(18.5), fx.from(10.5));
    sim.identifyTo(0, target);
    return { sim, holder, target };
  }

  it('shooter, one floor: the block on the line leaves no shot', () => {
    const { sim, holder, target } = shooter(1);
    expect(sim.projectHit(holder, target).kind).not.toBe('shot');
    const events = run(sim, 5 * TICKS_PER_SECOND);
    expect(events.some((e) => e.kind === 'fire' && e.shooter === holder && e.target === target)).toBe(false);
  });

  it('shooter, three floors: projectHit offers the shot and the holder fires over the block', () => {
    const { sim, holder, target } = shooter(3);
    expect(sim.projectHit(holder, target).kind).toBe('shot');
    let fired = false;
    for (let k = 0; k < 10 * TICKS_PER_SECOND; k++) {
      sim.identifyTo(0, target);
      for (const e of sim.tick()) if (e.kind === 'fire' && e.shooter === holder && e.target === target) fired = true;
    }
    expect(fired).toBe(true);
  });

  /** Garrison against garrison: the enemy holds a house behind the block. */
  function structureShots(floors: number): number {
    const { sim, t, u } = world();
    const mine = rect(sim, sim.addStructureType({ ...HOUSE, id: `g_m${floors}`, floors }), 10, 10, 2, 2);
    rect(sim, t.block, 14, 10, 1, 1);
    const theirs = rect(sim, t.house, 18, 10, 2, 2);
    const holder = sim.spawn(u.rifles, 0, fx.from(9.5), fx.from(11.5));
    garrison(sim, holder, mine);
    const enemy = sim.spawn(u.rifles, 1, fx.from(20.5), fx.from(11.5));
    garrison(sim, enemy, theirs);
    sim.debugDisableFirepower(enemy);
    let hits = 0;
    for (let k = 0; k < 10 * TICKS_PER_SECOND; k++) {
      sim.identifyTo(0, enemy);
      for (const e of sim.tick()) if (e.kind === 'fire' && e.shooter === holder && e.structure === theirs) hits++;
    }
    return hits;
  }

  it('a structure behind a block: one floor does not fire on it', () => expect(structureShots(1)).toBe(0));
  it('a structure behind a block: three floors fire on it', () => expect(structureShots(3)).toBeGreaterThan(0));

  /** A real smoke screen (the `smoke` command) centred at tile (cx, cy); a
   *  sapper lays it. The disc is radius 3, so the line y=10 from the window at
   *  x=11 crosses its tiles near the holder. */
  const SAPPER: UnitTypeJson = {
    id: 'g_sapper', role: 'engineer',
    hull: { hp: 380, armor: { front: 10, side: 10, rear: 10 } },
    mobility: { speed_tiles_s: 1 },
    sensors: { optics: 1, sight_tiles: 8, signature: 0.5 },
    abilities: ['smoke'],
    weapons: [],
  };
  function smoked(floors: number, holderSide: 0 | 1, screen: readonly [number, number] | null) {
    const { sim, u } = world();
    const tower = rect(sim, sim.addStructureType({ ...HOUSE, id: `g_k${floors}`, floors }), 10, 10, 2, 2);
    const sapper = sim.spawn(sim.addUnitType(SAPPER), 0, fx.from(9.5), fx.from(15.5));
    const holder = sim.spawn(u.rifles, holderSide, fx.from(9.5), fx.from(11.5));
    garrison(sim, holder, tower);
    const other = sim.spawn(holderSide === 0 ? u.dummy : u.rifles, holderSide === 0 ? 1 : 0, fx.from(18.5), fx.from(10.5));
    if (screen) {
      sim.queueCommand({ kind: 'smoke', ids: [sapper], x: fx.from(screen[0] + 0.5), y: fx.from(screen[1] + 0.5) });
      expect(run(sim, 1).some((e) => e.kind === 'smokeLaid')).toBe(true);
    }
    return { sim, holder, other };
  }

  it('smoke beside the window: one floor is blinded by it, three floors look over it', () => {
    // Screen at (11,10): its tiles x=8..14 on the line, the near four within
    // the first half, where a three-floor eye (h 3 falling to 1) is above the
    // plume top of 2 and a one-floor eye (h 1) is inside it.
    const one = smoked(1, 0, [11, 10]);
    const three = smoked(3, 0, [11, 10]);
    const clear = smoked(1, 0, null);
    expect(clear.sim.debugDetection(clear.holder, clear.other)?.visible).toBe(true);
    expect(one.sim.debugDetection(one.holder, one.other)?.visible).toBe(false);
    expect(three.sim.debugDetection(three.holder, three.other)?.visible).toBe(true);
  });

  it('smoke beside the window, seen from outside: the target end is lifted too', () => {
    const one = smoked(1, 1, [11, 10]);
    const three = smoked(3, 1, [11, 10]);
    expect(one.sim.debugDetection(one.other, one.holder)?.visible).toBe(false);
    expect(three.sim.debugDetection(three.other, three.holder)?.visible).toBe(true);
  });

  it('a thin screen on the line degrades the shot unless the floors lift the eye over it', () => {
    // One smoked tile (12,10) -- the bottom of a disc centred at (12,13) --
    // is thin enough not to block (255 < 320), so only hitFactors' own
    // smoke ray prices it.
    const pOf = (floors: number, screen: boolean): number => {
      const { sim, holder, other } = smoked(floors, 0, screen ? [12, 13] : null);
      sim.identifyTo(0, other);
      const hit = sim.projectHit(holder, other);
      if (hit.kind !== 'shot') throw new Error(`no shot: ${hit.kind}`);
      return hit.pHit;
    };
    expect(pOf(1, true)).toBeLessThan(pOf(1, false)); // the screen bites at eye level
    expect(pOf(3, true)).toBe(pOf(3, false)); // and three floors are over it
  });
});

describe('a mortar does not fire from inside; a Spike does (G4)', () => {
  const MORTAR: UnitTypeJson = {
    id: 'g_mortar', role: 'artillery',
    hull: { hp: 300, armor: { front: 10, side: 10, rear: 10 } },
    mobility: { speed_tiles_s: 1 },
    sensors: { optics: 1, sight_tiles: 10, signature: 0.6 },
    abilities: ['garrison'],
    weapons: [{
      id: 'g_mortar_60', type: 'mortar', range_tiles: 18, effective_range_tiles: 14, min_range_tiles: 4,
      accuracy: 0.3, damage: 150, splash_tiles: 1.5, suppression: 90, rof_per_min: 12, fires_from_building: false,
    }],
  };
  const SPIKE: UnitTypeJson = {
    id: 'g_spike', role: 'at_team',
    hull: { hp: 300, armor: { front: 10, side: 10, rear: 10 } },
    mobility: { speed_tiles_s: 1 },
    sensors: { optics: 1, sight_tiles: 10, signature: 0.6 },
    abilities: ['garrison'],
    weapons: [{
      id: 'g_spike_atgm', type: 'atgm', range_tiles: 13, effective_range_tiles: 7.2, min_range_tiles: 1,
      accuracy: 0.9, penetration: 700, damage: 500, suppression: 60, rof_per_min: 3,
    }],
  };
  function setup(json: UnitTypeJson, inside: boolean) {
    const { sim, t } = world();
    const ut = sim.addUnitType(json);
    const dummy = sim.addUnitType(DUMMY);
    const house = rect(sim, t.house, 20, 14, 2, 2);
    const id = sim.spawn(ut, 0, fx.from(19.5), fx.from(14.5));
    if (inside) garrison(sim, id, house);
    const target = sim.spawn(dummy, 1, fx.from(28.5), fx.from(14.5));
    sim.identifyTo(0, target);
    return { sim, id, target };
  }
  function shots(json: UnitTypeJson, inside: boolean): number {
    const { sim, id, target } = setup(json, inside);
    let n = 0;
    for (let k = 0; k < 30 * TICKS_PER_SECOND; k++) {
      sim.identifyTo(0, target);
      for (const e of sim.tick()) if (e.kind === 'fire' && e.shooter === id) n++;
    }
    return n;
  }
  it('the mortar fires in the open (the control arm)', () => expect(shots(MORTAR, false)).toBeGreaterThan(0));
  it('and holds fire inside', () => expect(shots(MORTAR, true)).toBe(0));
  it('the Spike fires from inside', () => expect(shots(SPIKE, true)).toBeGreaterThan(0));
  it('the fire panel and the fire order agree: no shot, and no order, for the mortar inside', () => {
    const m = setup(MORTAR, true);
    expect(m.sim.projectHit(m.id, m.target).kind).toBe('noSolution');
    expect(m.sim.canFocus(m.id, m.target)).toBe(false);
    expect(m.sim.focusHurts(m.id, m.target)).toBe(false);
    const s = setup(SPIKE, true);
    expect(s.sim.canFocus(s.id, s.target)).toBe(true);
    expect(s.sim.focusHurts(s.id, s.target)).toBe(true);
  });
  it('and it does not breach-fire a wall beside its building either (side 1, no min range)', () => {
    // Wall flush at x=22: at x=23 the unit (stands at 21,15) is out of BREACH_RANGE and the control arm reads 0.
    // selectBreachTarget returns -1 for side 0; a standing side-1 unit always scans, so this is the
    // only way into the breach loop. No min range, or min_range 4 would exceed BREACH_RANGE (2.5).
    const breacher = (flag: boolean | undefined): number => {
      const { sim, t } = world();
      const w = MORTAR.weapons[0];
      const { min_range_tiles: _min, fires_from_building: _flag, ...rest } = w;
      void _min;
      void _flag;
      const ut = sim.addUnitType({
        ...MORTAR,
        id: 'g_breacher',
        weapons: [flag === undefined ? rest : { ...rest, fires_from_building: flag }],
      });
      const house = rect(sim, t.house, 20, 14, 2, 2);
      rect(sim, t.block, 22, 14, 2, 2); // flush against the house: within BREACH_RANGE (2.5) of the garrisoned unit at (21,15)
      const id = sim.spawn(ut, 1, fx.from(19.5), fx.from(14.5));
      garrison(sim, id, house);
      let n = 0;
      for (let k = 0; k < 30 * TICKS_PER_SECOND; k++) {
        for (const e of sim.tick()) if (e.kind === 'fire' && e.shooter === id) n++;
      }
      return n;
    };
    expect(breacher(undefined)).toBeGreaterThan(0); // the control arm: the path is reachable
    expect(breacher(false)).toBe(0);
  });
  it('and it does not shell the building the enemy hides in either', () => {
    const { sim, t } = world();
    const ut = sim.addUnitType(MORTAR);
    const dummy = sim.addUnitType({ ...DUMMY, id: 'g_dummy_garrison', abilities: ['garrison'] });
    const mine = rect(sim, t.house, 20, 14, 2, 2);
    const theirs = rect(sim, t.house, 28, 14, 2, 2);
    const id = sim.spawn(ut, 0, fx.from(19.5), fx.from(14.5));
    garrison(sim, id, mine);
    const foe = sim.spawn(dummy, 1, fx.from(28.5), fx.from(14.5));
    garrison(sim, foe, theirs);
    let n = 0;
    for (let k = 0; k < 30 * TICKS_PER_SECOND; k++) {
      for (const e of sim.tick()) if (e.kind === 'fire' && e.shooter === id) n++;
    }
    expect(n).toBe(0);
  });
});
