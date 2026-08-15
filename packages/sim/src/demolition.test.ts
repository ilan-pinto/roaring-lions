import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, type UnitTypeJson } from './sim';
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
/** roe_penalty at PROTECTED_ROE. A mosque is 30; the threshold is 20. */
const SHRINE: StructureTypeJson = { id: 'test_shrine', hp_per_tile: 100, roe_penalty: 30 };

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
  // beside a mosque levelled it with no order given, for -30 ROE.
  it('does not demolish a protected site on its own initiative', () => {
    const sim = new Sim({ seed: 7, width: 32, height: 32, capacity: 8 });
    const shrine = sim.addStructureType(SHRINE);
    sim.addStructure(shrine, [10 * 32 + 10]);
    const t = sim.addUnitType(DOZER);
    sim.spawn(t, 0, fx.from(11.5), fx.from(10.5));
    for (let n = 0; n < 400; n++) sim.tick();
    expect(sim.structureAt(10, 10)).toBeGreaterThanOrEqual(0);
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
});
