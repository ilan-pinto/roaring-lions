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
