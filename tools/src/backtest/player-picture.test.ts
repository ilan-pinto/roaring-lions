// `Picture` is what keeps the re-scripted winning plans honest: an order aimed at a hostile is
// allowed only if the player could have seen that hostile. These pin the rules it rests on.
import { describe, expect, it } from 'vitest';
import { Sim, fx } from '@lions/sim';
import { units } from '@lions/data';
import { Picture } from './player-picture';

function world(): { sim: Sim; theirs: number } {
  const sim = new Sim({ seed: 3, width: 40, height: 40, capacity: 8 });
  const rifle = sim.addUnitType(units.inf_squad as Parameters<Sim['addUnitType']>[0]);
  sim.spawn(rifle, 0, fx.from(5), fx.from(5));
  // Thirty tiles off: nothing of ours can see it.
  const theirs = sim.spawn(rifle, 1, fx.from(35), fx.from(35));
  return { sim, theirs };
}

describe('Picture', () => {
  it('holds nothing the side has never observed', () => {
    const { sim } = world();
    const pic = new Picture(sim);
    for (let t = 0; t < 40; t++) {
      sim.tick();
      pic.update();
    }
    expect(pic.contacts()).toEqual([]);
  });

  it('remembers a contact where it was last seen, after the mark fades', () => {
    const { sim, theirs } = world();
    const pic = new Picture(sim);
    sim.identifyTo(0, theirs);
    pic.update();
    expect(pic.nearest(0, 0)).toMatchObject({ id: theirs, x: 35, y: 35 });
    // Long enough for an unobserved contact to decay to nothing.
    for (let t = 0; t < 20 * 120; t++) sim.tick();
    expect(sim.contactLevel(0, theirs)).toBe(0);
    pic.update();
    expect(pic.nearest(0, 0)?.id).toBe(theirs);
  });

  it('forgets a contact that dies', () => {
    const { sim, theirs } = world();
    const pic = new Picture(sim);
    sim.identifyTo(0, theirs);
    pic.update();
    expect(pic.contacts()).toHaveLength(1);
    sim.debugKill(theirs);
    pic.update();
    expect(pic.contacts()).toEqual([]);
  });

  it('names the type of a contact only once it is identified', () => {
    // A drone 10 tiles from a Kornet team: the contact climbs to suspected (level 1) in a
    // couple of seconds and to identified (level 2) a few seconds later. The plans hunt
    // Kornets by type, and a suspected mark on the screen is anonymous.
    const sim = new Sim({ seed: 3, width: 40, height: 40, capacity: 8 });
    const drone = sim.addUnitType(units.recon_drone as Parameters<Sim['addUnitType']>[0]);
    const cell = sim.addUnitType(units.atgm_cell as Parameters<Sim['addUnitType']>[0]);
    sim.spawn(drone, 0, fx.from(5), fx.from(5));
    const theirs = sim.spawn(cell, 1, fx.from(15), fx.from(5));
    const pic = new Picture(sim);
    const until = (level: number) => {
      for (let t = 0; t < 400 && sim.contactLevel(0, theirs) < level; t++) sim.tick();
      expect(sim.contactLevel(0, theirs)).toBe(level);
      pic.update();
    };
    until(1);
    expect(pic.contacts().map((c) => c.id)).toEqual([theirs]);
    expect(pic.identified('atgm_cell')).toEqual([]);
    until(2);
    expect(pic.identified('atgm_cell').map((c) => c.id)).toEqual([theirs]);
    expect(pic.identified('inf_squad')).toEqual([]);
  });

  it('filters by a zone rectangle', () => {
    const { sim, theirs } = world();
    const pic = new Picture(sim);
    sim.identifyTo(0, theirs);
    pic.update();
    expect(pic.contacts([30, 30, 10, 10])).toHaveLength(1);
    expect(pic.contacts([0, 0, 10, 10])).toHaveLength(0);
  });
});
