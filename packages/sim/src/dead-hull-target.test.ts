import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim, type UnitTypeJson } from './sim';

// GH-976: a shooter skips an enemy hull that is firepower-killed and not soft
// only when a known hostile-owned structure is in this weapon's reach. A live
// hull, hurtable or not, is never skipped. Without such a structure nothing
// changes. Stats are inlined (the sim imports nothing).

const W = 40;
const CAMP = { id: 't_camp', name: 'Camp', hp_per_tile: 400, garrison_slots: 0 };

/** mortar_team's tube, with a long eye so the camp latches without a spotter. */
const MORTAR: UnitTypeJson = {
  id: 't_mortar',
  hull: { hp: 350, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.65 },
  sensors: { optics: 1.0, sight_tiles: 24, signature: 0.6 },
  weapons: [{ id: 'tube', type: 'mortar', range_tiles: 18, effective_range_tiles: 14, accuracy: 0.5, penetration: 30, damage: 180, splash_tiles: 1.8, suppression: 90, rof_per_min: 4, min_range_tiles: 4 }],
};
/** apc_eitan's plate: a mortar round cannot hurt it. */
const APC: UnitTypeJson = {
  id: 't_apc',
  hull: { hp: 2200, armor: { front: 220, side: 140, rear: 90 } },
  mobility: { speed_tiles_s: 1.2 },
  sensors: { optics: 1.0, sight_tiles: 10, signature: 1.0 },
  weapons: [{ id: 'rws', type: 'hmg', range_tiles: 8, accuracy: 0.5, penetration: 25, damage: 20, rof_per_min: 400 }],
};

/** A light-skinned hull (armour 35 everywhere: not soft, since the limit is 30) a mortar round hurts. */
const LIGHT: UnitTypeJson = {
  id: 't_light',
  hull: { hp: 1200, armor: { front: 35, side: 35, rear: 35 } },
  mobility: { speed_tiles_s: 1.2 },
  sensors: { optics: 1.0, sight_tiles: 10, signature: 1.0 },
  weapons: [{ id: 'rws', type: 'hmg', range_tiles: 8, accuracy: 0.5, penetration: 25, damage: 20, rof_per_min: 400 }],
};

interface Pick {
  target: number;
  structure: number;
  apc: number;
  camp: number;
  hurts: boolean;
}

function pick(o: { shooter?: UnitTypeJson; hull?: UnitTypeJson; killed?: boolean; campDx?: number | null; apcDx?: number }): Pick {
  const sim = new Sim({ seed: 976, width: W, height: 20, capacity: 16 });
  const camp = sim.addStructureType(CAMP);
  const shooterIdx = sim.addUnitType(o.shooter ?? MORTAR);
  const apcIdx = sim.addUnitType(o.hull ?? APC);
  let campId = -1;
  if (o.campDx !== null) {
    const cx = 4 + (o.campDx ?? 12);
    campId = sim.addStructure(camp, [8 * W + cx, 8 * W + cx + 1]);
    sim.setStructureOwner(campId, 1);
  }
  const apc = sim.spawn(apcIdx, 1, fx.from(4 + (o.apcDx ?? 8)), fx.from(11.5), 16384);
  const shooter = sim.spawn(shooterIdx, 0, fx.from(3.5), fx.from(11.5), 0);
  if (o.killed ?? true) sim.debugDisableFirepower(apc);
  sim.identifyTo(0, apc);
  // Two ticks: the first latches the camp (latchOwnedStructures), the second targets.
  sim.tick();
  sim.tick();
  const p = sim.projectHit(shooter, apc);
  return { target: sim.state.curTarget[shooter], structure: sim.state.curStructure[shooter], apc, camp: campId, hurts: p.kind === 'shot' && p.hurts };
}

describe('skip a firepower-killed hull when a known hostile structure is in reach', () => {
  it('a mortar and a firepower-killed APC with a known camp in reach: it switches to the camp', () => {
    const r = pick({});
    expect(r.target).toBe(-1);
    expect(r.structure).toBe(r.camp);
  });

  it('no structure in reach: the dead APC stays the target', () => {
    // 30 tiles out: beyond the mortar's 18 tile reach.
    const far = pick({ campDx: 30 });
    expect(far.target).toBe(far.apc);
    expect(far.structure).toBe(-1);
    // No structure at all.
    const none = pick({ campDx: null });
    expect(none.target).toBe(none.apc);
    expect(none.structure).toBe(-1);
  });

  it('a firepower-killed hull the weapon CAN hurt is skipped too (decision: a disarmed hull is no threat)', () => {
    const r = pick({ hull: LIGHT });
    expect(r.hurts).toBe(true); // the premise: this is not the unhurtable case
    expect(r.target).toBe(-1);
    expect(r.structure).toBe(r.camp);
  });

  it('a hull that is NOT firepower-killed and that the weapon hurts is unchanged', () => {
    const r = pick({ hull: LIGHT, killed: false });
    expect(r.hurts).toBe(true);
    expect(r.target).toBe(r.apc);
    expect(r.structure).toBe(-1);
  });

  it('a LIVE armed hull the weapon cannot hurt keeps its last-resort target even with a camp in reach', () => {
    // Deliberate: suppressing an armed tank is not waste. Only a firepower-killed hull is skipped.
    const near = pick({ killed: false });
    expect(near.hurts).toBe(false);
    expect(near.target).toBe(near.apc);
    expect(near.structure).toBe(-1);
  });

  it('only an OWNED, latched structure counts: a neutral building with a garrison in it does not', () => {
    // The ruling is the stKnown latch. A garrisoned neutral house is a target for the unit-less path only.
    const sim = new Sim({ seed: 976, width: W, height: 20, capacity: 16 });
    const house = sim.addStructureType({ id: 't_house', name: 'House', hp_per_tile: 400, garrison_slots: 2 });
    const hs = sim.addStructure(house, [8 * W + 16, 8 * W + 17]);
    const apcIdx = sim.addUnitType(APC);
    const man = sim.addUnitType({ ...MORTAR, id: 't_man', abilities: ['garrison'], weapons: [] });
    const inside = sim.spawn(man, 1, fx.from(16.5), fx.from(9.5));
    sim.queueCommand({ kind: 'garrison', ids: [inside], structure: hs });
    for (let k = 0; k < 200 && sim.state.garrisonedIn[inside] !== hs; k++) sim.tick();
    expect(sim.state.garrisonedIn[inside]).toBe(hs);
    const apc = sim.spawn(apcIdx, 1, fx.from(12.5), fx.from(11.5), 16384);
    const shooter = sim.spawn(sim.addUnitType(MORTAR), 0, fx.from(3.5), fx.from(11.5), 0);
    sim.debugDisableFirepower(apc);
    sim.identifyTo(0, apc);
    sim.identifyTo(0, inside);
    sim.tick();
    sim.tick();
    expect(sim.state.curTarget[shooter]).toBe(apc);
    expect(sim.state.curStructure[shooter]).toBe(-1);
  });
});
