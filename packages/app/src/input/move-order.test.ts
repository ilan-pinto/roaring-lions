/**
 * The Move key (L1 reopened, 2026-10-11): press the key, click the ground, and
 * the selection gets the sim's plain `move` -- not the attack-move every
 * right-click is, which a fighting unit answers by staying to fight.
 *
 * Pure tests over the one decision (`resolveMoveOrder`/`issueMove`), the
 * command it becomes, the cursor it draws and the key that arms it. The click
 * wiring in `main.ts` is driven in a real browser, not here.
 */
import { describe, expect, it } from 'vitest';
import { Sim, fx, type Command } from '@lions/sim';
import { applyTerrain, maps, parseMap, units } from '@lions/data';
import type { Camera, Viewport } from '@lions/render/project';
import { screenToWorldThree, structureAtScreenThree, structureBoxes } from '@lions/render/three-camera';
import { standMapStructures } from '../map-sim';
import { applyIntent, issueMove, resolveMoveOrder, type IntentWorld, type OrderSink, type PlayerIntent } from './intents';
import { cursorFor } from './cursor';
import { cursorAt, pointerPoint, simIntentWorld, type PointerView } from './pointer';
import { ACTIONS, anyArmed, bindingsFrom, escapeTarget, rebind, resolveKey } from './keymap';

function world(over: Partial<IntentWorld> = {}): IntentWorld {
  return {
    structureAt: () => -1,
    tunnelAt: () => -1,
    isProtected: () => false,
    structureRoePenalty: () => 0,
    garrisonFree: () => 0,
    canDemolish: () => false,
    canGarrison: () => false,
    canTunnelCharge: () => false,
    inFlaggedZone: () => false,
    groundAt: () => 'open',
    flies: () => false,
    canFocus: () => false,
    focusHurts: () => false,
    garrisoned: () => false,
    ...over,
  };
}

type Effect = 'dispatch' | 'note' | 'marker' | 'deny';
function sink(): OrderSink & { log: Effect[]; intents: PlayerIntent[] } {
  const log: Effect[] = [];
  const intents: PlayerIntent[] = [];
  return {
    log,
    intents,
    dispatch: (i) => (log.push('dispatch'), intents.push(i)),
    note: () => log.push('note'),
    marker: () => log.push('marker'),
    deny: () => log.push('deny'),
  };
}

describe('armed Move + a click on open ground', () => {
  it('is the plain move verb, never attackMove, to the point clicked', () => {
    const s = sink();
    issueMove(world(), s, [1, 2], 4.5, 6.5, { append: false });
    expect(s.intents).toEqual([{ kind: 'order', verb: 'move', ids: [1, 2], x: 4.5, y: 6.5, append: false }]);
    expect(s.log).toEqual(['dispatch', 'marker']);
  });

  it('becomes the sim\'s own move command', () => {
    const out: Command[] = [];
    const [intent] = resolveMoveOrder(world(), { ids: [3], x: 2, y: 5, append: false }).intents;
    applyIntent({ queueCommand: (c) => out.push(c) }, intent, { width: 48, height: 48 });
    expect(out).toEqual([{ kind: 'move', ids: [3], x: fx.from(2), y: fx.from(5), append: false }]);
  });

  it('Shift queues, as it does for any order', () => {
    const s = sink();
    issueMove(world(), s, [1], 4.5, 6.5, { append: true });
    expect(s.intents[0]).toMatchObject({ verb: 'move', append: true });
  });

  it('is not turned into a demolish, a garrison or an attack by what stands on the tile', () => {
    // An enemy building, a protected site and an identified tunnel are all
    // ways of ATTACKING; a move is none of them. (The ground under a real
    // building is impassable, which the next test covers.)
    const w = world({ structureAt: () => 7, isProtected: () => true, tunnelAt: () => 2, canDemolish: () => true, canGarrison: () => true, canTunnelCharge: () => true });
    const res = resolveMoveOrder(w, { ids: [1], x: 4.5, y: 6.5, append: false });
    expect(res.intents.map((i) => i.kind)).toEqual(['order']);
    expect(res.intents[0]).toMatchObject({ verb: 'move' });
  });
});

describe('armed Move + a click on ground nobody can enter (K-08)', () => {
  const rock = world({ groundAt: () => 'blocked' });
  it('dispatches nothing, drops no marker, says why and denies', () => {
    const s = sink();
    const res = issueMove(rock, s, [1, 2], 4.5, 6.5, { append: false });
    expect(res.groundRefused).toBe('blocked');
    expect(s.intents).toEqual([]);
    expect(s.log).toEqual(['note', 'deny']);
  });
  it('off the map is refused too, and a queued click is refused the same way', () => {
    const s = sink();
    issueMove(world({ groundAt: () => 'offmap' }), s, [1], -3, 2, { append: true });
    expect(s.log).toEqual(['note', 'deny']);
  });
  it('a drone in the selection keeps the order', () => {
    const s = sink();
    issueMove(world({ groundAt: () => 'blocked', flies: (i) => i === 2 }), s, [1, 2], 4.5, 6.5, { append: false });
    expect(s.log).toEqual(['dispatch', 'marker']);
  });
  it('nothing selected is no order and no denial', () => {
    const s = sink();
    issueMove(world(), s, [], 4.5, 6.5, { append: false });
    expect(s.log).toEqual([]);
  });
});

describe('the cursor while Move is armed', () => {
  const res = (w: IntentWorld, ids = [1]) => resolveMoveOrder(w, { ids, x: 4.5, y: 6.5, append: false });
  const armed = { hostile: false, blocked: false, armedMove: true };

  it('reads moveOnly -- its own key, not the hover move or the advance', () => {
    expect(cursorFor(res(world()), armed)).toBe('moveOnly');
  });
  it('stays moveOnly over an enemy: the click does not engage', () => {
    expect(cursorFor(res(world()), { ...armed, hostile: true })).toBe('moveOnly');
  });
  it('reads blocked over impassable ground, and default with nothing selected', () => {
    expect(cursorFor(res(world({ groundAt: () => 'blocked' })), armed)).toBe('blocked');
    expect(cursorFor(res(world(), []), armed)).toBe('default');
  });
  it('is the ordinary hover when Move is not armed', () => {
    expect(cursorFor(res(world()), { hostile: true, blocked: false })).toBe('advance');
  });
});

describe('the cursor through the real pointer (tutorial ground)', () => {
  const VP: Viewport = { width: 1440, height: 900 };
  function setup() {
    const map = parseMap(maps.tutorial_ground);
    const sim = new Sim({ seed: 7, width: map.width, height: map.height, capacity: 64 });
    applyTerrain(map, sim);
    standMapStructures(sim, map);
    const typeOf = new Map<string, number>();
    for (const u of Object.values(units)) typeOf.set(u.id, sim.addUnitType(u as never));
    const spawn = (id: string, side: number, x: number, y: number): number =>
      sim.spawn(typeOf.get(id) as number, side, fx.from(x), fx.from(y));
    return { sim, spawn };
  }
  it('over an enemy: Move armed reads moveOnly where the same pixel reads advance-soft otherwise', () => {
    const { sim, spawn } = setup();
    const squad = spawn('inf_squad', 0, 11.5, 24.5);
    const militia = spawn('militia_cell', 1, 26.5, 24.5);
    const cam: Camera = { x: fx.toNumber(sim.state.posX[militia]), y: fx.toNumber(sim.state.posY[militia]), zoom: 1 };
    const view: PointerView = {
      screenToWorld: (px, py) => screenToWorldThree(px, py, cam, VP),
      structureAtScreen: (px, py) => structureAtScreenThree(px, py, cam, VP, structureBoxes(sim, null, () => ({ width: 1, height: 1, depth: 1 }))),
      isVisible: () => true,
      // The militia is the only unit at the centre pixel.
      unitAtScreen: () => militia,
      viewer: 0,
    };
    const p = pointerPoint(view, sim, VP.width / 2, VP.height / 2);
    const w = simIntentWorld(sim, () => false);
    const base = { ids: [squad], armed: null, confirm: false, armedSmoke: false };
    expect(cursorAt(sim, w, p, base).key).toBe('advance-soft');
    const armed = cursorAt(sim, w, p, { ...base, armedMove: true });
    expect(armed.key).toBe('moveOnly');
    expect(canvasKeyHasNoBadge(armed.key)).toBe(true);
    expect(armed.res.intents).toEqual([{ kind: 'order', verb: 'move', ids: [squad], x: p.x, y: p.y, append: false }]);
  });
});
const canvasKeyHasNoBadge = (k: string): boolean => !k.includes('-');

describe('the Move key', () => {
  it('is bound, remappable, and free of every other binding', () => {
    const spec = ACTIONS.find((a) => a.id === 'move');
    expect(spec).toMatchObject({ key: 'n', rebindable: true });
    expect(spec?.modifier).toBeUndefined();
    const same = ACTIONS.filter((a) => a.key === 'n' && a.modifier === undefined);
    expect(same.map((a) => a.id)).toEqual(['move']);
  });
  it('resolves from the keyboard and can be rebound onto a free key', () => {
    const b = bindingsFrom({});
    expect(resolveKey(b, { key: 'n', ctrlKey: false, metaKey: false })).toBe('move');
    // `x` was the free key here until N4a's veto took it (D11); `j` is free.
    const r = rebind(b, 'move', 'j');
    expect(r.ok && resolveKey(r.bindings, { key: 'j', ctrlKey: false, metaKey: false })).toBe('move');
    expect(rebind(b, 'move', 'x')).toMatchObject({ ok: false, takenBy: 'veto' });
    expect(rebind(b, 'move', 'm')).toMatchObject({ ok: false, takenBy: 'mute' });
  });
  it('an armed Move is something Escape disarms, before it opens the pause menu', () => {
    expect(anyArmed('move', null)).toBe(true);
    expect(escapeTarget(false, false, anyArmed('move', null))).toBe('disarm');
  });
});
