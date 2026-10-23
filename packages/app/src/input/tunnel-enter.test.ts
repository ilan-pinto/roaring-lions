/**
 * GH-681: the enter verb, against a REAL `Sim` through the one adapter the
 * click and the hover cursor share (`simIntentWorld`). A right-click within a
 * tile of the seat's OWN route end, with foot units selected, is an
 * `enterTunnel` and reads `tunnel-enter`; a wheeled unit beside them
 * attack-moves to the point; a selection with nobody on foot is refused and
 * reads `blocked`. The other seat, and single-player, never see the verb.
 */
import { describe, expect, it } from 'vitest';
import { Sim, fx, type UnitTypeJson } from '@lions/sim';
import { applyIntent, resolvePointer } from './intents';
import { cursorAt, identifiedRouteAt, ownRouteEndAt, simIntentWorld, type PointerPoint } from './pointer';

const RIFLE: UnitTypeJson = {
  id: 'te_rifle',
  role: 'infantry',
  hull: { hp: 20000, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0.9 },
  sensors: { optics: 1.0, sight_tiles: 8, signature: 0.6 },
  weapons: [],
};
const TRUCK: UnitTypeJson = { ...RIFLE, id: 'te_truck', mobility: { speed_tiles_s: 0.9, wheeled: true } };
const MARKER: UnitTypeJson = { ...RIFLE, id: 'te_marker', abilities: ['mark_tunnel'] };

/** Mouth (4,6), vent (14,6), owned by side 1 unless `side` says otherwise. */
function world(side: number | null = 1) {
  const sim = new Sim({ seed: 5, width: 30, height: 12, capacity: 16, humanHeld: [true, true] });
  const route = sim.addTunnel({
    id: 'te_s_west',
    points: [[4, 6], [14, 6]],
    dig_tiles_per_s: 1,
    pre_dug: true,
    ...(side === null ? {} : { side }),
  });
  const rifle = sim.addUnitType(RIFLE);
  const truck = sim.addUnitType(TRUCK);
  const foot = sim.spawn(rifle, 1, fx.from(2.5), fx.from(5.5));
  const wheels = sim.spawn(truck, 1, fx.from(2.5), fx.from(7.5));
  return { sim, route, foot, wheels, marker: sim.addUnitType(MARKER) };
}

const at = (x: number, y: number): PointerPoint => ({
  ground: { x, y },
  x,
  y,
  hostile: -1,
  hostileAt: null,
  wounded: -1,
  woundedAt: null,
  facade: -1,
});
const cursor = (sim: Sim, viewer: number, ids: number[], x: number, y: number): string =>
  cursorAt(sim, simIntentWorld(sim, () => false, viewer), at(x, y), { ids, armed: null, confirm: false, armedSmoke: false }).key;

describe('the enter verb (GH-681)', () => {
  it('names the own route within a tile of its mouth or its vent, and nothing further out', () => {
    const { sim, route } = world();
    expect(ownRouteEndAt(sim, 1, 4.5, 6.5)).toBe(route);
    expect(ownRouteEndAt(sim, 1, 5.4, 6.5)).toBe(route);
    expect(ownRouteEndAt(sim, 1, 14.5, 7.4)).toBe(route);
    expect(ownRouteEndAt(sim, 1, 9.5, 6.5)).toBe(-1); // the bore's middle is not an end
    expect(ownRouteEndAt(sim, 1, 6.5, 6.5)).toBe(-1);
  });

  it('is never offered to the side that does not own the route, nor on a route nobody owns', () => {
    const owned = world();
    expect(ownRouteEndAt(owned.sim, 0, 4.5, 6.5)).toBe(-1);
    const mapFile = world(null);
    expect(ownRouteEndAt(mapFile.sim, 0, 4.5, 6.5)).toBe(-1);
    expect(ownRouteEndAt(mapFile.sim, 1, 4.5, 6.5)).toBe(-1);
    // ...so a right-click there is the ordinary attack-move it always was.
    const res = resolvePointer(simIntentWorld(mapFile.sim, () => false, 0), {
      ids: [mapFile.foot], x: 4.5, y: 6.5, append: false, armed: null, confirm: false,
    });
    expect(res.intents.map((i) => i.kind)).toEqual(['order']);
  });

  it('foot units get the enterTunnel and the cursor reads tunnel-enter; it takes them below', () => {
    const { sim, route, foot } = world();
    const w = simIntentWorld(sim, () => false, 1);
    const res = resolvePointer(w, { ids: [foot], x: 4.5, y: 6.5, append: false, armed: null, confirm: false });
    expect(res.intents).toEqual([{ kind: 'enterTunnel', ids: [foot], tunnel: route }]);
    expect(cursor(sim, 1, [foot], 4.5, 6.5)).toBe('tunnel-enter');
    for (const i of res.intents) applyIntent(sim, i, sim);
    for (let t = 0; t < 200 && sim.state.tunnelIn[foot] < 0; t++) sim.tick();
    expect(sim.state.tunnelIn[foot]).toBe(route);
  });

  it('a wheeled unit beside them attack-moves to the point instead', () => {
    const { sim, route, foot, wheels } = world();
    const res = resolvePointer(simIntentWorld(sim, () => false, 1), {
      ids: [foot, wheels], x: 4.5, y: 6.5, append: false, armed: null, confirm: false,
    });
    expect(res.intents).toEqual([
      { kind: 'enterTunnel', ids: [foot], tunnel: route },
      { kind: 'order', verb: 'attackMove', ids: [wheels], x: 4.5, y: 6.5, append: false },
    ]);
    expect(cursor(sim, 1, [foot, wheels], 4.5, 6.5)).toBe('tunnel-enter');
  });

  it('nobody on foot: refused, with a note, and the cursor reads blocked', () => {
    const { sim, wheels } = world();
    const res = resolvePointer(simIntentWorld(sim, () => false, 1), {
      ids: [wheels], x: 4.5, y: 6.5, append: false, armed: null, confirm: false,
    });
    expect(res.intents).toEqual([]);
    expect(res.tunnelRefused).toBe(true);
    expect(res.note?.tone).toBe('mute');
    expect(cursor(sim, 1, [wheels], 4.5, 6.5)).toBe('blocked');
  });

  it('a Shift click keeps its appended attack-move', () => {
    const { sim, foot } = world();
    const res = resolvePointer(simIntentWorld(sim, () => false, 1), {
      ids: [foot], x: 4.5, y: 6.5, append: true, armed: null, confirm: false,
    });
    expect(res.intents.map((i) => i.kind)).toEqual(['order']);
  });
});

describe('the identified route under the pointer is the VIEWER\'s (GH-681 fog audit)', () => {
  it('reads the viewer\'s contact, not side 0\'s', () => {
    const { sim, route, marker } = world(null);
    // A side-1 carrier finds the route; side 0 has not.
    sim.spawn(marker, 1, fx.from(8.5), fx.from(8.5));
    sim.tick();
    expect(sim.tunnelContactLevel(1, route)).toBe(2);
    expect(sim.tunnelContactLevel(0, route)).toBe(0);
    expect(identifiedRouteAt(sim, 1, 8, 6)).toBe(route);
    expect(identifiedRouteAt(sim, 0, 8, 6)).toBe(-1);
    // For viewer 0 the answer is Sim.tunnelAt's, tile for tile.
    for (let y = 0; y < 12; y++) for (let x = -1; x < 31; x++) expect(identifiedRouteAt(sim, 0, x, y)).toBe(sim.tunnelAt(x, y));
  });
});
