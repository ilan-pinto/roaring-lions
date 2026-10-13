// H never empties a building (Stage 4, the lead's hold ruling of 2026-10-11).
// The sim's `halt` calls `leaveStructure` on a garrisoned id, so the app keeps
// those ids out of the command (`haltTargets`) and says why when that leaves
// nobody (`haltNote`). The last test guards the premise: the raw halt DOES
// eject, so the filter is preventing something real.
import { describe, expect, it } from 'vitest';
import { Sim, fx, type UnitTypeJson } from '@lions/sim';
import { haltNote, haltTargets } from './intents';

describe('haltTargets', () => {
  it('halts the units outside and skips the garrisoned ones', () => {
    const inside = new Set([2]);
    expect(haltTargets([1, 2, 3], (i) => inside.has(i))).toEqual([1, 3]);
  });

  it('an all-garrisoned selection halts nobody', () => {
    expect(haltTargets([4, 5], () => true)).toEqual([]);
  });
});

describe('haltNote', () => {
  it('an all-garrisoned selection says why', () => {
    expect(haltNote(2, 0)).toEqual({
      text: 'already holding from inside — right-click to leave the building',
      tone: 'mute',
    });
  });

  it('a mixed selection says nothing', () => {
    expect(haltNote(3, 1)).toBeNull();
  });

  it('nothing selected still reads intent.halt.none', () => {
    expect(haltNote(0, 0)).toEqual({
      text: 'nothing of yours selected to halt — select units first',
      tone: 'mute',
    });
    expect(haltNote(0)?.text).toBe('nothing of yours selected to halt — select units first');
  });

  it('with no second argument a selection counts as all outside (old behaviour)', () => {
    expect(haltNote(3)).toBeNull();
  });
});

const GARRISONER: UnitTypeJson = {
  id: 'hg_squad',
  role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.85 },
  sensors: { optics: 1, sight_tiles: 8, signature: 0.6 },
  abilities: ['garrison'],
  weapons: [],
};

describe('the premise: what the sim does with halt', () => {
  /** A squad garrisoned in a house, and a second unit standing outside. */
  function garrisoned() {
    const sim = new Sim({ seed: 7, width: 24, height: 24, capacity: 8 });
    const type = sim.addUnitType(GARRISONER);
    const house = sim.addStructure(
      sim.addStructureType({ id: 'hg_house', hp_per_tile: 200, garrison_slots: 4 }),
      [12 * 24 + 12],
    );
    const squad = sim.spawn(type, 0, fx.from(12.5), fx.from(14.5));
    const outsider = sim.spawn(type, 0, fx.from(4.5), fx.from(4.5));
    sim.queueCommand({ kind: 'garrison', ids: [squad], structure: house });
    for (let n = 0; n < 400 && sim.state.garrisonedIn[squad] !== house; n++) sim.tick();
    expect(sim.state.garrisonedIn[squad]).toBe(house);
    return { sim, house, squad, outsider };
  }

  it('H on a squad inside plus a unit outside leaves the squad inside', () => {
    const { sim, house, squad, outsider } = garrisoned();
    const ids = haltTargets([squad, outsider], (i) => sim.state.garrisonedIn[i] >= 0);
    expect(ids).toEqual([outsider]);
    sim.queueCommand({ kind: 'halt', ids });
    sim.tick();
    expect(sim.state.garrisonedIn[squad]).toBe(house);
  });

  it('control: a raw halt for the same squad ejects it', () => {
    const { sim, house, squad } = garrisoned();
    sim.queueCommand({ kind: 'halt', ids: [squad] });
    sim.tick();
    expect(sim.state.garrisonedIn[squad]).not.toBe(house);
    expect(sim.state.garrisonedIn[squad]).toBe(-1);
  });
});
