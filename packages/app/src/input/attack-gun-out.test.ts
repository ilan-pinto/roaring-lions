/**
 * The lead's ruling of 4 Nov, item 4: a right-click on an enemy with a gun-out tank selected is still
 * the `attack` order (the sim takes it and stops the tank), and the click now SAYS why it will not fire,
 * in the card's own words. The note reads the sim's `firepowerKilled`; `canFocus`/`focusHurts` stay the
 * only filter (the intent list is the one it always was).
 */
import { describe, expect, it } from 'vitest';
import { Sim, fx } from '@lions/sim';
import { applyTerrain, maps, parseMap, units } from '@lions/data';
import { standMapStructures } from '../map-sim';
import { resolvePointer } from './intents';
import { simIntentWorld } from './pointer';

function setup() {
  const map = parseMap(maps.tutorial_ground);
  const sim = new Sim({ seed: 7, width: map.width, height: map.height, capacity: 16 });
  applyTerrain(map, sim);
  standMapStructures(sim, map);
  const typeOf = new Map<string, number>();
  for (const u of Object.values(units)) typeOf.set(u.id, sim.addUnitType(u as never));
  const spawn = (id: string, side: number, x: number, y: number): number =>
    sim.spawn(typeOf.get(id) as number, side, fx.from(x), fx.from(y));
  const tank = spawn('mbt_lavi', 0, 11.5, 24.5);
  const tank2 = spawn('mbt_lavi', 0, 11.5, 26.5);
  const foe = spawn('militia_cell', 1, 22.5, 24.5);
  sim.identifyTo(0, foe);
  const click = (ids: number[]) =>
    resolvePointer(simIntentWorld(sim, () => false), {
      ids, x: 22.5, y: 24.5, append: false, armed: null, confirm: false, hostile: foe, hostileAt: { x: 22.5, y: 24.5 },
    });
  return { sim, tank, tank2, foe, click };
}

describe('an attack order given to a tank whose gun is out', () => {
  it('is the same attack order, with a note saying why it will not fire, in the card\'s words', () => {
    const { sim, tank, foe, click } = setup();
    const healthy = click([tank]);
    expect(healthy.note).toBeUndefined();

    (sim.state.firepowerKilled as Uint8Array)[tank] = 1;
    const out = click([tank]);
    // The intents are untouched: nothing re-derives canFocus/focusHurts here.
    expect(out.intents).toEqual(healthy.intents);
    expect(out.intents).toEqual([{ kind: 'attack', ids: [tank], target: foe }]);
    // Break check: delete the `gunOut` read in `simIntentWorld` -> no note.
    expect(out.note?.text).toBe("Gun out: can't fire, can still drive");
    expect(out.note?.tone).toBe('info');
  });

  it('speaks when any of the selection is out, and not when none is', () => {
    const { sim, tank, tank2, click } = setup();
    expect(click([tank, tank2]).note).toBeUndefined();
    (sim.state.firepowerKilled as Uint8Array)[tank2] = 1;
    expect(click([tank, tank2]).note?.text).toContain('Gun out');
    (sim.state.firepowerKilled as Uint8Array)[tank2] = 0;
    expect(click([tank, tank2]).note).toBeUndefined();
  });
});
