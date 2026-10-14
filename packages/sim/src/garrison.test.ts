import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, TICKS_PER_SECOND, type SimEvent, type UnitTypeJson } from './sim';

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
