import { describe, expect, it } from 'vitest';
import { parseClientMsg, validateCommand, type Seat, type SeatWorld } from '@lions/net';
import { fx, Sim, type Command, type UnitTypeJson } from '@lions/sim';

// GH-972, versus parity. A seat's group order crosses the wire as JSON, is rebuilt by `cleanCommand`, is
// checked by `validateCommand`, and is then queued by BOTH machines. The assignment is made inside the sim,
// so two machines holding the same frames must stand every squad in the same place, tick for tick. If the
// room dropped `spread` or `carriers` in transit, the receiving machine would run a plain order while the
// sender ran a spread one: the first test is the proof they do not.

const HOUSE = { id: 'w_house', name: 'House', hp_per_tile: 260, garrison_slots: 2, rubble_cover: 2 };
const RIFLES: UnitTypeJson = {
  id: 'w_rifles', role: 'infantry',
  hull: { hp: 400, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 1.6 },
  sensors: { optics: 1, sight_tiles: 10, signature: 0.6 },
  abilities: ['garrison'],
  weapons: [],
};
const APC: UnitTypeJson = {
  id: 'w_apc', role: 'technical',
  hull: { hp: 900, armor: { front: 20, side: 15, rear: 10 }, transport_slots: 2 },
  mobility: { speed_tiles_s: 2.5, turn_rate_deg_s: 150 },
  sensors: { optics: 1, sight_tiles: 9, signature: 0.8 },
  weapons: [],
};

/** One machine of the room: two seats' squads, two houses and two carriers each. */
function machine() {
  const sim = new Sim({ seed: 3, width: 48, height: 32, capacity: 64 });
  const house = sim.addStructureType(HOUSE);
  const rifles = sim.addUnitType(RIFLES);
  const apc = sim.addUnitType(APC);
  const houses = [[12, 10], [12, 15], [34, 10], [34, 15]].map(([x, y]) =>
    sim.addStructure(house, [y * 48 + x, y * 48 + x + 1, (y + 1) * 48 + x, (y + 1) * 48 + x + 1]),
  );
  const west = Array.from({ length: 6 }, (_, k) => sim.spawn(rifles, 0, fx.from(6.5), fx.from(10 + k)));
  const east = Array.from({ length: 6 }, (_, k) => sim.spawn(rifles, 1, fx.from(42.5), fx.from(10 + k)));
  const wCars = [4.5, 24.5].map((y) => sim.spawn(apc, 0, fx.from(8.5), fx.from(y)));
  const eCars = [4.5, 24.5].map((y) => sim.spawn(apc, 1, fx.from(40.5), fx.from(y)));
  const world: SeatWorld = {
    sideOfSeat: (seat) => seat,
    sideOfEntity: (id) => (id < sim.entityCount ? sim.state.side[id] : undefined),
    width: 48, height: 32,
    structureExists: (s) => s >= 0 && s < houses.length,
    tunnelExists: () => false,
    factionOfSeat: () => 'kdf',
    tunnelOwner: () => -1,
    versus: true,
    economy: false,
    setupRoom: false,
    formationAllowed: () => false,
  };
  return { sim, world, houses, west, east, wCars, eCars };
}

/** The wire, as a room sees it: JSON out, `cleanCommand` in, ownership checked for the sending seat. */
function viaWire(cmd: Command, seat: Seat, world: SeatWorld): Command | null {
  const parsed = parseClientMsg(JSON.stringify({ t: 'cmd', seq: 0, cmd }));
  if (parsed === null || parsed.t !== 'cmd') return null;
  return validateCommand(parsed.cmd, seat, world) ? parsed.cmd : null;
}

describe('a group order in a versus room (GH-972)', () => {
  it('survives the wire intact, and runs identically on the sender\'s machine and the receiver\'s', () => {
    const sender = machine();
    const receiver = machine();
    const orders = (m: ReturnType<typeof machine>): [Command, Seat][] => [
      [{ kind: 'garrison', ids: m.west, structure: m.houses[0], spread: true }, 0],
      [{ kind: 'garrison', ids: m.east, structure: m.houses[2], spread: true }, 1],
      [{ kind: 'load', ids: m.west.slice(0, 4), carrier: m.wCars[0], carriers: m.wCars }, 0],
    ];
    // The sender runs what it typed; the receiver runs what came out of the wire.
    for (const [cmd] of orders(sender)) sender.sim.queueCommand(cmd);
    const rebuilt = orders(receiver).map(([cmd, seat]) => viaWire(cmd, seat, receiver.world));
    for (const cmd of rebuilt) {
      expect(cmd).not.toBeNull();
      receiver.sim.queueCommand(cmd as Command);
    }
    expect(rebuilt).toEqual(orders(receiver).map(([cmd]) => cmd));
    for (let k = 0; k < 20 * 40; k++) {
      sender.sim.tick();
      receiver.sim.tick();
      expect(receiver.sim.hash(), `tick ${k}`).toBe(sender.sim.hash());
    }
    // And the spread actually happened: the east seat's six squads fill its two 2-seat houses (the other two
    // wait outside), and the west seat's four loaders take two seats in each of its carriers.
    const inside = (m: ReturnType<typeof machine>, ids: number[]) => ids.filter((i) => m.sim.state.garrisonedIn[i] >= 0).length;
    expect(inside(sender, sender.east)).toBe(4);
    expect(inside(receiver, receiver.east)).toBe(4);
    expect(sender.wCars.map((c) => sender.sim.passengerCount(c))).toEqual([2, 2]);
    expect(receiver.wCars.map((c) => receiver.sim.passengerCount(c))).toEqual([2, 2]);
  });

  it('a seat cannot spread its riders onto the other seat\'s carrier: the whole order is dropped on both machines', () => {
    const m = machine();
    const forged: Command = { kind: 'load', ids: m.west.slice(0, 2), carrier: m.wCars[0], carriers: [m.wCars[0], m.eCars[0]] };
    expect(viaWire(forged, 0, m.world)).toBeNull();
    const own: Command = { ...forged, carriers: m.wCars };
    expect(viaWire(own, 0, m.world)).toEqual(own);
  });
});
