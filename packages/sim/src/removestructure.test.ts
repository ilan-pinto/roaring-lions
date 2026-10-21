import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { FlowField } from './flowfield';
import { Sim, TICKS_PER_SECOND, type SimEvent, type UnitTypeJson } from './sim';

// removeStructure (#277 Task 3): a cancelled stake leaves the ground exactly as
// it was. destroyStructure is the contrast: rubble, shock, an event.
// Lazy field invalidation (same task) is tested at the bottom against a fresh
// FlowField.compute, which is the oracle and is independent of the sim.

const HOUSE = { id: 'house', name: 'House', hp_per_tile: 260, garrison_slots: 2, rubble_cover: 3 };

const RIFLES: UnitTypeJson = {
  id: 'r_inf',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.6 },
  sensors: { optics: 1, sight_tiles: 10, signature: 0.6 },
  abilities: ['garrison'],
  weapons: [
    { id: 'rifles', type: 'small_arms', range_tiles: 8, effective_range_tiles: 6.4, accuracy: 0.6, penetration: 8, damage: 15, suppression: 50, rof_per_min: 300 },
  ],
};

const W = 32;
const FOOTPRINT = [6 * W + 14, 6 * W + 15, 7 * W + 14, 7 * W + 15];

function world(capacity = 32): { sim: Sim; typeIdx: number } {
  const sim = new Sim({ seed: 9, width: W, height: 16, capacity });
  const typeIdx = sim.addStructureType(HOUSE);
  return { sim, typeIdx };
}

function run(sim: Sim, ticks: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) out.push(...sim.tick());
  return out;
}

describe('removeStructure', () => {
  it('opens the tiles in both masks and leaves cover, events and bystanders alone', () => {
    const { sim, typeIdx } = world();
    for (const t of FOOTPRINT) sim.setCover(t % W, Math.floor(t / W), 1);
    const s = sim.addStructure(typeIdx, FOOTPRINT);
    const bystander = sim.spawn(sim.addUnitType(RIFLES), 0, fx.from(13.0), fx.from(6.5));
    for (const t of FOOTPRINT) expect(sim.blocked[t]).toBe(1);

    sim.removeStructure(s);

    for (const t of FOOTPRINT) {
      expect(sim.blocked[t]).toBe(0);
      expect(sim.blockedVehicle[t]).toBe(0);
      // Hand-set to 1 above; the type's rubble_cover is 3, so 1 proves no rubble was written.
      expect(sim.cover[t]).toBe(1);
    }
    expect(sim.structures.alive[s]).toBe(0);
    const events = run(sim, 2);
    expect(events.some((e) => e.kind === 'structureDestroyed')).toBe(false);
    expect(sim.state.suppression[bystander]).toBe(0);
  });

  it('destroyStructure on the same footprint is the contrast: rubble, an event, a shock', () => {
    const { sim, typeIdx } = world();
    const s = sim.addStructure(typeIdx, FOOTPRINT);
    const bystander = sim.spawn(sim.addUnitType(RIFLES), 0, fx.from(13.0), fx.from(6.5));

    sim.debugDestroyStructure(s);

    for (const t of FOOTPRINT) expect(sim.cover[t]).toBe(3); // rubble_cover
    expect(sim.state.suppression[bystander]).toBeGreaterThan(0);
    const events = run(sim, 1);
    expect(events.some((e) => e.kind === 'structureDestroyed' && e.structure === s)).toBe(true);
  });

  it('throws while anyone is inside, and changes nothing when it does', () => {
    const { sim, typeIdx } = world();
    const s = sim.addStructure(typeIdx, FOOTPRINT);
    const holder = sim.spawn(sim.addUnitType(RIFLES), 0, fx.from(13.0), fx.from(6.5));
    sim.queueCommand({ kind: 'garrison', ids: [holder], structure: s });
    run(sim, 20 * TICKS_PER_SECOND);
    expect(sim.structures.occupants[s]).toBe(1);

    expect(() => sim.removeStructure(s)).toThrow();
    expect(sim.structures.alive[s]).toBe(1);
    for (const t of FOOTPRINT) expect(sim.blocked[t]).toBe(1);
  });

  it('frees the footprint for a second structure, and a second call is a no-op', () => {
    const { sim, typeIdx } = world();
    const s = sim.addStructure(typeIdx, FOOTPRINT);
    sim.removeStructure(s);
    sim.removeStructure(s);
    expect(sim.structureAt(14, 6)).toBe(-1);
    const again = sim.addStructure(typeIdx, FOOTPRINT);
    expect(sim.structureAt(14, 6)).toBe(again);
    expect(sim.structures.alive[again]).toBe(1);
  });

  it('re-derives the vehicle mask per tile on a map with boulders', () => {
    const { sim, typeIdx } = world();
    sim.setBoulder(3, 3, true); // makes the vehicle mask a real second array
    expect(sim.blockedVehicle).not.toBe(sim.blocked);
    // Footprint: (14,6) is plain ground; (15,6) is a boulder under the footprint.
    sim.setBoulder(15, 6, true);
    const s = sim.addStructure(typeIdx, FOOTPRINT);
    expect(sim.blockedVehicle[6 * W + 14]).toBe(1);

    sim.removeStructure(s);

    // Plain ground opens for wheels; the boulder stays a wall to them but not on foot.
    expect(sim.blockedVehicle[6 * W + 14]).toBe(0);
    expect(sim.blockedVehicle[7 * W + 15]).toBe(0);
    expect(sim.blockedVehicle[6 * W + 15]).toBe(1);
    expect(sim.blocked[6 * W + 15]).toBe(0);
  });
});

// Reach into the pool: the oracle is a FlowField computed from scratch.
interface Pool {
  fields: FlowField[];
  fieldByGoal: Map<number, number>[];
  fieldFor(gx: number, gy: number, d: number): number;
  maskFor(d: number): Uint8Array;
  elevation: Uint8Array;
}

function fresh(sim: Sim, goal: number): Uint8Array {
  const p = sim as unknown as Pool;
  const f = new FlowField(sim.width, sim.height);
  f.compute(p.maskFor(0), p.elevation, goal % sim.width, Math.floor(goal / sim.width));
  return f.dirs;
}

describe('recomputeFields is lazy', () => {
  // Three goals. Unit A and B follow theirs; C's unit is killed, so its field
  // stays cached with nobody following it. A wall then goes up across all three routes.
  function pooled() {
    const { sim, typeIdx } = world();
    const inf = sim.addUnitType(RIFLES);
    const goals = [[28, 3], [28, 12], [28, 8]];
    const ids = goals.map(([, gy]) => sim.spawn(inf, 0, fx.from(2.5), fx.from(gy + 0.5)));
    goals.forEach(([gx, gy], i) =>
      sim.queueCommand({ kind: 'move', ids: [ids[i]], x: fx.from(gx + 0.5), y: fx.from(gy + 0.5), exact: true }),
    );
    sim.tick();
    sim.debugKill(ids[2]);
    return { sim, typeIdx, goals: goals.map(([gx, gy]) => gy * W + gx) };
  }

  it('recomputes every field a living unit follows, exactly as a fresh compute would', () => {
    const { sim, typeIdx, goals } = pooled();
    const pool = sim as unknown as Pool;
    expect(sim.flowFieldCount).toBe(3);
    // A 2-tile-wide wall across the middle with a gap, so the routes really change.
    const tiles: number[] = [];
    for (let y = 1; y < 15; y++) tiles.push(y * W + 14);
    sim.addStructure(typeIdx, tiles);

    for (const g of [goals[0], goals[1]]) {
      const idx = pool.fieldByGoal[0].get(g);
      expect(idx).toBeDefined();
      expect(Array.from(pool.fields[idx as number].dirs)).toEqual(Array.from(fresh(sim, g)));
    }
  });

  it('drops the unfollowed field, and asking for it again yields a fresh one', () => {
    const { sim, typeIdx, goals } = pooled();
    const pool = sim as unknown as Pool;
    const tiles: number[] = [];
    for (let y = 1; y < 15; y++) tiles.push(y * W + 14);
    sim.addStructure(typeIdx, tiles);

    expect(pool.fieldByGoal[0].has(goals[2])).toBe(false);
    const idx = pool.fieldFor(28, 8, 0);
    expect(Array.from(pool.fields[idx].dirs)).toEqual(Array.from(fresh(sim, goals[2])));
    // The pool is far below its cap, so a miss allocates a fourth slot.
    expect(sim.flowFieldCount).toBe(4);
  });

  it('serves a full pool: every field requested after the drop equals a fresh compute', () => {
    const { sim, typeIdx } = world(256);
    const pool = sim as unknown as Pool;
    const inf = sim.addUnitType(RIFLES);
    // 128 = MAX_FLOW_FIELDS (sim.ts). Goals are the 16x8 tiles x 8..23, y 4..11, one unit each.
    const ids: number[] = [];
    for (let i = 0; i < 128; i++) {
      const gx = 8 + (i % 16);
      const gy = 4 + Math.floor(i / 16);
      const id = sim.spawn(inf, 0, fx.from(2.5), fx.from(2.5));
      ids.push(id);
      sim.queueCommand({ kind: 'move', ids: [id], x: fx.from(gx + 0.5), y: fx.from(gy + 0.5), exact: true });
    }
    sim.tick();
    expect(sim.flowFieldCount).toBe(128);
    for (const id of ids.slice(8)) sim.debugKill(id);
    sim.tick();
    const tiles: number[] = [];
    for (let y = 1; y < 15; y++) tiles.push(y * W + 5);
    sim.addStructure(typeIdx, tiles); // drops the 120 unfollowed
    expect(pool.fieldByGoal[0].size).toBe(8);
    // New goals evict dropped slots (120 of them; a field issued this tick is never evicted), so the count stays at the cap.
    for (let i = 0; i < 100; i++) {
      const gx = 6 + (i % 24);
      const gy = 1 + Math.floor(i / 24);
      const idx = pool.fieldFor(gx, gy, 0);
      expect(Array.from(pool.fields[idx].dirs)).toEqual(Array.from(fresh(sim, gy * W + gx)));
    }
    expect(sim.flowFieldCount).toBe(128);
  });
});
