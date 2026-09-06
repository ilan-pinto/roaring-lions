import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, type SimEvent, type UnitTypeJson } from './sim';
import type { StructureTypeJson } from './structures';

const SAPPER: UnitTypeJson = {
  id: 'test_sapper',
  role: 'engineer',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.85 },
  sensors: { optics: 1.0, sight_tiles: 8, signature: 0.6 },
  abilities: ['demolish'],
  weapons: [],
};

const DOZER: UnitTypeJson = { ...SAPPER, id: 'test_dozer', demolition_time_s: 2.0 };

const SHACK: StructureTypeJson = { id: 'test_shack', hp_per_tile: 100 };
/** roe_penalty at PROTECTED_ROE. A hall is 30; the threshold is 20. */
const SHRINE: StructureTypeJson = { id: 'test_shrine', hp_per_tile: 100, roe_penalty: 30 };
/** A field camp: the side it produces for is the side that must never level it by reflex. */
const CAMP: StructureTypeJson = { id: 'test_camp', hp_per_tile: 100, produces_for: 0 };

/** The D9: same 2 s timer as DOZER, but it grinds rather than setting charges. */
const BLADE: UnitTypeJson = { ...SAPPER, id: 'test_blade', demolition_time_s: 2.0, demolition_method: 'blade' };

describe('demolition_method', () => {
  it('defaults to charges when the field is absent', () => {
    const sim = new Sim({ seed: 7, width: 32, height: 32, capacity: 8 });
    const t = sim.addUnitType(SAPPER);
    expect(sim.unitTypes[t].bladeDemolition).toBe(false);
  });

  it('reads blade from the unit data', () => {
    const sim = new Sim({ seed: 7, width: 32, height: 32, capacity: 8 });
    const t = sim.addUnitType(BLADE);
    expect(sim.unitTypes[t].bladeDemolition).toBe(true);
  });
});

/** Park a demolisher beside a one-tile building and tick until it falls. */
function ticksToLevel(unit: UnitTypeJson): number {
  const sim = new Sim({ seed: 7, width: 32, height: 32, capacity: 8 });
  const st = sim.addStructureType(SHACK);
  sim.addStructure(st, [10 * 32 + 10]);
  const t = sim.addUnitType(unit);
  sim.spawn(t, 0, fx.from(11.5), fx.from(10.5));
  for (let n = 1; n <= 400; n++) {
    sim.tick();
    if (sim.structureAt(10, 10) < 0) return n;
  }
  return -1;
}

describe('per-unit demolition time', () => {
  it('defaults to 5 s (100 ticks) when the field is absent', () => {
    expect(ticksToLevel(SAPPER)).toBe(100);
  });

  it('honours demolition_time_s: 2.0 as 40 ticks', () => {
    expect(ticksToLevel(DOZER)).toBe(40);
  });

  it('reports progress against the unit-s own timer, not the global', () => {
    const sim = new Sim({ seed: 7, width: 32, height: 32, capacity: 8 });
    const st = sim.addStructureType(SHACK);
    sim.addStructure(st, [10 * 32 + 10]);
    const t = sim.addUnitType(DOZER);
    const id = sim.spawn(t, 0, fx.from(11.5), fx.from(10.5));
    for (let n = 0; n < 20; n++) sim.tick();
    // 20 of 40 ticks: half done. Against the old global 100 this read 0.2.
    expect(sim.demolitionProgress(id)).toBeCloseTo(0.5, 2);
  });

  // The D9 ships with no `weapons` key at all. recon_drone already does, but
  // nothing has combined that with an ability that runs a per-tick system, and
  // an unarmed unit reaching selectTarget is the way that breaks.
  it('an unarmed demolisher acquires no target and does not throw', () => {
    const sim = new Sim({ seed: 7, width: 32, height: 32, capacity: 8 });
    const st = sim.addStructureType(SHACK);
    sim.addStructure(st, [10 * 32 + 10]);
    const dozer = sim.addUnitType(DOZER);
    const enemy = sim.addUnitType({ ...SAPPER, id: 'test_enemy', abilities: [] });
    const id = sim.spawn(dozer, 0, fx.from(11.5), fx.from(10.5));
    sim.spawn(enemy, 1, fx.from(13.5), fx.from(10.5));
    expect(() => {
      for (let n = 0; n < 60; n++) sim.tick();
    }).not.toThrow();
    // `engaging` is internal; `state` exposes curTarget and curStructure.
    // curStructure is the sharper assertion anyway: demolition plants charges,
    // it never routes through fireAtStructure, so an unarmed dozer levelling a
    // building must still never be *shooting* at one.
    expect(sim.state.curTarget[id]).toBe(-1);
    expect(sim.state.curStructure[id]).toBe(-1);
  });

  // selectStructureTarget already refuses protected sites "on a gunner's
  // initiative" (sim.ts). Demolition is the same kind of unordered act by the
  // same unit, and was the one path that never got the rule: a dozer halted
  // beside a hall levelled it with no order given, for -30 ROE.
  it('does not demolish a protected site on its own initiative', () => {
    const sim = new Sim({ seed: 7, width: 32, height: 32, capacity: 8 });
    const shrine = sim.addStructureType(SHRINE);
    sim.addStructure(shrine, [10 * 32 + 10]);
    const t = sim.addUnitType(DOZER);
    sim.spawn(t, 0, fx.from(11.5), fx.from(10.5));
    for (let n = 0; n < 400; n++) sim.tick();
    expect(sim.structureAt(10, 10)).toBeGreaterThanOrEqual(0);
  });

  // Umm Zeitoun II, 2026-09-06: the mission's own demo_squad spawned one tile
  // off its field camp and levelled it at tick 100 with no order given, and
  // every build card read 'field camp destroyed' for the rest of the mission.
  // A side's own production structure is never a target on a sapper's
  // initiative.
  it('does not demolish its own side\'s field camp on its own initiative', () => {
    const sim = new Sim({ seed: 7, width: 32, height: 32, capacity: 8 });
    const camp = sim.addStructureType(CAMP);
    sim.addStructure(camp, [10 * 32 + 10]);
    const t = sim.addUnitType(DOZER);
    sim.spawn(t, 0, fx.from(11.5), fx.from(10.5));
    for (let n = 0; n < 400; n++) sim.tick();
    expect(sim.structureAt(10, 10)).toBeGreaterThanOrEqual(0);
  });

  // The guard is about WHOSE camp it is, not about camps being immune.
  it('still levels the other side\'s camp beside it', () => {
    const sim = new Sim({ seed: 7, width: 32, height: 32, capacity: 8 });
    const camp = sim.addStructureType(CAMP); // produces_for 0
    sim.addStructure(camp, [10 * 32 + 10]);
    const t = sim.addUnitType(DOZER);
    sim.spawn(t, 1, fx.from(11.5), fx.from(10.5)); // side 1 sapper
    for (let n = 0; n < 400; n++) sim.tick();
    expect(sim.structureAt(10, 10)).toBe(-1);
  });

  // Levelling your own camp is an order, like cutting your own wire.
  it('demolishes its own camp when the player designates it', () => {
    const sim = new Sim({ seed: 7, width: 32, height: 32, capacity: 8 });
    const camp = sim.addStructureType(CAMP);
    const s = sim.addStructure(camp, [10 * 32 + 10]);
    const t = sim.addUnitType(DOZER);
    const id = sim.spawn(t, 0, fx.from(11.5), fx.from(10.5));
    sim.queueCommand({ kind: 'demolish', ids: [id], structure: s });
    let fell = -1;
    for (let n = 1; n <= 400; n++) {
      sim.tick();
      if (sim.structureAt(10, 10) < 0) {
        fell = n;
        break;
      }
    }
    expect(fell).toBeGreaterThan(0);
  });

  // The guard must be about the ROE flag, not about demolition being broken.
  it('still demolishes an unprotected building beside the protected one', () => {
    const sim = new Sim({ seed: 7, width: 32, height: 32, capacity: 8 });
    const shrine = sim.addStructureType(SHRINE);
    const shack = sim.addStructureType(SHACK);
    sim.addStructure(shrine, [10 * 32 + 10]);
    sim.addStructure(shack, [10 * 32 + 12]);
    const t = sim.addUnitType(DOZER);
    // Equidistant from both: the shrine must be skipped and the shack taken.
    sim.spawn(t, 0, fx.from(11.5), fx.from(10.5));
    for (let n = 0; n < 400; n++) sim.tick();
    expect(sim.structureAt(10, 10)).toBeGreaterThanOrEqual(0); // shrine stands
    expect(sim.structureAt(12, 10)).toBe(-1); // shack levelled
  });

  // Every designated-demolition test above spawns the unit square on one of
  // the structure's axes, where the wall-slide happens to resolve to a dead
  // stop. Approaching at an angle is the normal case in play, and it is the
  // one that hangs: the order aims the unit at the building's *centre*, which
  // is inside the blocked footprint, so it can never arrive and never clears
  // `moving`. The slide then freezes the blocked axis while still stepping the
  // free one by a share that shrinks toward zero without reaching it -- so the
  // unit is `displaced` every tick forever, and stepDemolition drops the
  // charges every tick forever. The building stands until the player halts the
  // unit by hand.
  it('demolishes a designated building promptly when it stops off-axis', () => {
    const sim = new Sim({ seed: 7, width: 32, height: 32, capacity: 8 });
    const st = sim.addStructureType(SHACK);
    // Three by three: with a single tile the unit closes on the centre from
    // both axes at once and happens to stop dead, which is why every existing
    // test here passes.
    const tiles: number[] = [];
    for (let y = 10; y <= 12; y++) for (let x = 10; x <= 12; x++) tiles.push(y * 32 + x);
    const s = sim.addStructure(st, tiles);
    const t = sim.addUnitType(DOZER);
    // A tile west of the wall and a tenth of a tile off the centre row, so the
    // final leg has a large dx it can never satisfy and a small dy it can only
    // approach. One tile of walking plus 40 ticks of charges is about 65.
    const id = sim.spawn(t, 0, fx.from(9.0), fx.from(11.4));
    sim.queueCommand({ kind: 'demolish', ids: [id], structure: s });
    let fell = -1;
    for (let n = 1; n <= 600; n++) {
      sim.tick();
      if (sim.structureAt(11, 11) < 0) {
        fell = n;
        break;
      }
    }
    expect(fell).toBeGreaterThan(0);
    expect(fell).toBeLessThan(120);
  });

  // The guard stops accidents, not intent. Without this the protected site
  // would be undemolishable by anything, forever — there is no other way to
  // ask for it.
  it('demolishes a protected site when the player designates it', () => {
    const sim = new Sim({ seed: 7, width: 32, height: 32, capacity: 8 });
    const shrine = sim.addStructureType(SHRINE);
    const s = sim.addStructure(shrine, [10 * 32 + 10]);
    const t = sim.addUnitType(DOZER);
    const id = sim.spawn(t, 0, fx.from(11.5), fx.from(10.5));
    sim.queueCommand({ kind: 'demolish', ids: [id], structure: s });
    let fell = -1;
    for (let n = 1; n <= 400; n++) {
      sim.tick();
      if (sim.structureAt(10, 10) < 0) {
        fell = n;
        break;
      }
    }
    expect(fell).toBeGreaterThan(0);
  });

  it('a later move order cancels the designation', () => {
    const sim = new Sim({ seed: 7, width: 32, height: 32, capacity: 8 });
    const shrine = sim.addStructureType(SHRINE);
    const s = sim.addStructure(shrine, [10 * 32 + 10]);
    const t = sim.addUnitType(DOZER);
    const id = sim.spawn(t, 0, fx.from(11.5), fx.from(10.5));
    sim.queueCommand({ kind: 'demolish', ids: [id], structure: s });
    sim.tick();
    // Player changes their mind and sends it back where it came from.
    sim.queueCommand({ kind: 'move', ids: [id], x: fx.from(11.5), y: fx.from(10.5) });
    for (let n = 0; n < 400; n++) sim.tick();
    expect(sim.structureAt(10, 10)).toBeGreaterThanOrEqual(0);
  });

  // A designated unit walking past a shed must not stop and flatten the shed.
  it('under orders it ignores other buildings on the way', () => {
    const sim = new Sim({ seed: 7, width: 32, height: 32, capacity: 8 });
    const shrine = sim.addStructureType(SHRINE);
    const shack = sim.addStructureType(SHACK);
    const target = sim.addStructure(shrine, [10 * 32 + 24]);
    sim.addStructure(shack, [10 * 32 + 12]);
    const t = sim.addUnitType(DOZER);
    // Spawned in range of the shack, ordered to the distant shrine.
    const id = sim.spawn(t, 0, fx.from(11.5), fx.from(10.5));
    sim.queueCommand({ kind: 'demolish', ids: [id], structure: target });
    for (let n = 0; n < 60; n++) sim.tick();
    expect(sim.structureAt(12, 10)).toBeGreaterThanOrEqual(0); // shack untouched
  });
});

const WALL: StructureTypeJson = { id: 'test_wall', hp_per_tile: 500 };

describe('a demolish order can find its own way through a gate', () => {
  // Regression guard for the walled-compound pathing bug: `demolish` aims
  // the unit at the target structure's centroid, which sits inside the
  // structure's own footprint and is therefore always blocked.
  // `FlowField.compute` bails to an all-DIR_NONE field the moment its goal
  // tile is blocked, and stepMovement's fallback for "the field has nothing
  // to say" is to walk a straight line at the (unreachable) goal -- which
  // pins the unit against whichever wall face that line meets first. Fine
  // for an isolated shack; fatal for a target sitting behind a compound
  // wall whose only gate is nowhere near the straight line. `Sim` now
  // routes the field through `nearestOpenTile` instead of the raw centroid.
  //
  // A ring of wall tiles around the target, one gap left open on the west
  // face, and the demolisher spawned due north -- so the straight line from
  // spawn to the target's centroid runs straight into the *north* wall,
  // nowhere near the gate on the west side. Pre-fix, this is exactly the
  // shape that hangs forever.
  it('routes around the wall to the gate instead of pinning against it', () => {
    const sim = new Sim({ seed: 7, width: 24, height: 24, capacity: 8 });
    const wallType = sim.addStructureType(WALL);
    const wallTiles: number[] = [];
    for (let x = 8; x <= 16; x++) {
      for (let y = 8; y <= 16; y++) {
        const onRing = x === 8 || x === 16 || y === 8 || y === 16;
        if (!onRing) continue;
        if (x === 8 && y === 12) continue; // the one gate, on the west face
        wallTiles.push(y * 24 + x);
      }
    }
    sim.addStructure(wallType, wallTiles);
    const shackType = sim.addStructureType(SHACK);
    const target = sim.addStructure(shackType, [12 * 24 + 12]); // dead centre

    const t = sim.addUnitType(DOZER);
    // Due north of the ring, well outside it: the straight line to (12,12)
    // runs down through (12, 8), the north wall face -- the gate is on the
    // opposite side of the compound.
    const id = sim.spawn(t, 0, fx.from(12.5), fx.from(2.5));
    sim.queueCommand({ kind: 'demolish', ids: [id], structure: target });

    let enteredInterior = -1;
    let fell = -1;
    for (let n = 1; n <= 800; n++) {
      sim.tick();
      const tx = sim.state.posX[id] >> 16;
      const ty = sim.state.posY[id] >> 16;
      // Inside the ring's open interior (x/y 9-15), which is only reachable
      // through the gate at (8,12) -- the straight line from spawn crosses
      // the blocked north face at y=8 well before it, so landing here at
      // all is proof the field actually routed around, not through.
      if (enteredInterior < 0 && tx >= 9 && tx <= 15 && ty >= 9 && ty <= 15) enteredInterior = n;
      if (sim.structures.alive[target] === 0) {
        fell = n;
        break;
      }
    }
    // Pre-fix, neither of these happens inside any tick budget: the field
    // is all DIR_NONE, the straight-line fallback drives the unit into the
    // north wall face at (12,8), and the wall-slide clamp pins it there --
    // never inside the ring, never in demolition range, building standing
    // forever.
    expect(enteredInterior).toBeGreaterThan(0);
    expect(fell).toBeGreaterThan(0);
    expect(sim.structures.alive[target]).toBe(0);
  });

  // Same fix, same shape, for `garrison`: the doorway is inside the target's
  // own footprint too.
  it('garrison finds the same gate for the same reason', () => {
    const sim = new Sim({ seed: 7, width: 24, height: 24, capacity: 8 });
    const wallType = sim.addStructureType(WALL);
    const wallTiles: number[] = [];
    for (let x = 8; x <= 16; x++) {
      for (let y = 8; y <= 16; y++) {
        const onRing = x === 8 || x === 16 || y === 8 || y === 16;
        if (!onRing) continue;
        if (x === 8 && y === 12) continue;
        wallTiles.push(y * 24 + x);
      }
    }
    sim.addStructure(wallType, wallTiles);
    const houseType = sim.addStructureType({ id: 'test_house', hp_per_tile: 200, garrison_slots: 4 });
    const target = sim.addStructure(houseType, [12 * 24 + 12]);

    const infType = sim.addUnitType({ ...SAPPER, id: 'test_infantry', abilities: ['garrison'] });
    const id = sim.spawn(infType, 0, fx.from(12.5), fx.from(2.5));
    sim.queueCommand({ kind: 'garrison', ids: [id], structure: target });

    let entered = -1;
    for (let n = 1; n <= 800; n++) {
      sim.tick();
      if (sim.state.garrisonedIn[id] === target) {
        entered = n;
        break;
      }
    }
    expect(entered).toBeGreaterThan(0);
  });
});

describe('the blade crumbles a building as it works', () => {
  /** A one-tile shack at (10,10) with a demolisher of `unit` parked beside it. */
  function world(unit: UnitTypeJson) {
    const sim = new Sim({ seed: 7, width: 32, height: 32, capacity: 8 });
    const st = sim.addStructureType(SHACK);
    const s = sim.addStructure(st, [10 * 32 + 10]);
    const t = sim.addUnitType(unit);
    const id = sim.spawn(t, 0, fx.from(11.5), fx.from(10.5));
    return { sim, s, id };
  }

  it('still levels a fresh building in exactly 40 ticks', () => {
    expect(ticksToLevel(BLADE)).toBe(40);
  });

  it('drains structural HP monotonically while it works', () => {
    const { sim, s } = world(BLADE);
    let prev = sim.structures.hp[s];
    expect(prev).toBe(sim.structures.maxHp[s]);
    for (let n = 1; n <= 39; n++) {
      sim.tick();
      expect(sim.structures.hp[s]).toBeLessThan(prev);
      prev = sim.structures.hp[s];
    }
    // 39 bites of maxHp/40 leave the building standing but nearly gone.
    expect(sim.structures.alive[s]).toBe(1);
    expect(prev).toBeLessThan(sim.structures.maxHp[s] / 10);
  });

  it('reports each bite as a structureHit attributed to the dozer', () => {
    const { sim, s, id } = world(BLADE);
    const events = sim.tick();
    const hit = events.find((e) => e.kind === 'structureHit' && e.structure === s);
    expect(hit).toBeDefined();
    if (hit?.kind === 'structureHit') {
      expect(hit.by).toBe(id);
      expect(hit.damage).toBeGreaterThan(0);
      expect(hit.hpLeft).toBe(sim.structures.hp[s]);
    }
  });

  // The regression guard on the split. Without it, a later refactor that
  // unified the two paths would pass every other test in this file.
  it('charges leave the building at full HP until the moment it collapses', () => {
    const { sim, s } = world(DOZER);
    for (let n = 0; n < 39; n++) {
      sim.tick();
      expect(sim.structures.hp[s]).toBe(sim.structures.maxHp[s]);
    }
    sim.tick();
    expect(sim.structures.alive[s]).toBe(0);
  });

  // The blade inherits every guard that sits above target selection.
  it('does not grind a protected site on its own initiative', () => {
    const sim = new Sim({ seed: 7, width: 32, height: 32, capacity: 8 });
    const shrine = sim.addStructureType(SHRINE);
    const s = sim.addStructure(shrine, [10 * 32 + 10]);
    const t = sim.addUnitType(BLADE);
    sim.spawn(t, 0, fx.from(11.5), fx.from(10.5));
    for (let n = 0; n < 400; n++) sim.tick();
    expect(sim.structures.alive[s]).toBe(1);
    expect(sim.structures.hp[s]).toBe(sim.structures.maxHp[s]);
  });

  it('leaves the damage behind when it drives off, and finishes faster on return', () => {
    const { sim, s, id } = world(BLADE);
    for (let n = 0; n < 20; n++) sim.tick();
    const half = sim.structures.hp[s];
    expect(half).toBe(sim.structures.maxHp[s] / 2);

    // Ordered away: out of DEMO_RANGE_SQ (2 tiles) so the timer resets.
    sim.queueCommand({ kind: 'move', ids: [id], x: fx.from(20.5), y: fx.from(10.5) });
    for (let n = 0; n < 60; n++) sim.tick();
    expect(sim.structures.alive[s]).toBe(1);
    expect(sim.structures.hp[s]).toBe(half); // the work is not undone
    expect(sim.demolitionProgress(id)).toBe(0); // but the timer is

    // Sent back. Half a building takes half the time.
    sim.queueCommand({ kind: 'demolish', ids: [id], structure: s });
    let ticksBack = 0;
    let grindStart = 0;
    let down: SimEvent | undefined;
    for (let n = 1; n <= 400; n++) {
      const events = sim.tick();
      // The tick the blade bites again, after walking back into range.
      if (grindStart === 0 && sim.structures.hp[s] < half) grindStart = n;
      down = events.find((e) => e.kind === 'structureDestroyed' && e.structure === s);
      if (down) {
        ticksBack = n;
        break;
      }
    }
    expect(ticksBack).toBeGreaterThan(0);
    expect(grindStart).toBeGreaterThan(0);
    // Twenty bites finish a half-eaten building — not a fresh forty. Measured
    // from the tick grinding actually resumed, so the walk back cannot mask a
    // regression that restarted the work from scratch.
    expect(ticksBack - grindStart + 1).toBe(20);
    expect(sim.structures.alive[s]).toBe(0);
    // The early collapse comes through damageStructure rather than the timer,
    // so it must still be billed to the dozer — the ROE penalty depends on it.
    if (down?.kind === 'structureDestroyed') expect(down.by).toBe(id);
  });

  it('reports progress against the building, not the timer', () => {
    const { sim, s, id } = world(BLADE);
    // Grind to half, drive off, come back: the timer restarts at zero while
    // the building is already half gone. This is the only state in which the
    // two candidate implementations disagree.
    for (let n = 0; n < 20; n++) sim.tick();
    sim.queueCommand({ kind: 'move', ids: [id], x: fx.from(20.5), y: fx.from(10.5) });
    for (let n = 0; n < 60; n++) sim.tick();
    expect(sim.structures.hp[s]).toBe(sim.structures.maxHp[s] / 2);

    sim.queueCommand({ kind: 'demolish', ids: [id], structure: s });
    // Tick until it is back in range and has landed at least one bite.
    for (let n = 0; n < 80 && sim.structures.hp[s] === sim.structures.maxHp[s] / 2; n++) {
      sim.tick();
    }
    expect(sim.structures.alive[s]).toBe(1);
    // The timer says roughly 1/40. The building says just over half.
    expect(sim.demolitionProgress(id)).toBeGreaterThan(0.5);
  });

  it('reports zero for a blade that is not working on anything', () => {
    const sim = new Sim({ seed: 7, width: 32, height: 32, capacity: 8 });
    const t = sim.addUnitType(BLADE);
    const id = sim.spawn(t, 0, fx.from(2.5), fx.from(2.5)); // no building near
    for (let n = 0; n < 10; n++) sim.tick();
    expect(sim.demolitionProgress(id)).toBe(0);
  });
});
