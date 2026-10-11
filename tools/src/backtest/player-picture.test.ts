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

  it('filters by a zone rectangle', () => {
    const { sim, theirs } = world();
    const pic = new Picture(sim);
    sim.identifyTo(0, theirs);
    pic.update();
    expect(pic.contacts([30, 30, 10, 10])).toHaveLength(1);
    expect(pic.contacts([0, 0, 10, 10])).toHaveLength(0);
  });
});
