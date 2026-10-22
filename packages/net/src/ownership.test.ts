import { describe, it, expect } from 'vitest';
import type { Command } from '@lions/sim';
import { validateCommand, applyFrame, type SeatWorld } from './ownership';

const world: SeatWorld = {
  sideOfSeat: (seat) => seat,                          // seat 0 → side 0, seat 1 → side 1
  sideOfEntity: (id) => (id < 10 ? 0 : id < 20 ? 1 : undefined),
  width: 48,
  height: 48,
  structureExists: (id) => id === 3,
  tunnelExists: (id) => id === 0 || id === 1,
  // Seat 1 plays Sarim; route 0 is side 1's, route 1 has no owner (a map-file route).
  factionOfSeat: (seat) => (seat === 1 ? 'sarim' : 'kdf'),
  tunnelOwner: (id) => (id === 0 ? 1 : -1),
  versus: false,
  economy: false,
};
const F = 65536;

describe('validateCommand', () => {
  it('accepts an order naming only the seat\'s own units', () => {
    expect(validateCommand({ kind: 'halt', ids: [1, 2] }, 0, world)).toBe(true);
  });
  it('drops an order naming a foreign unit, or one that does not exist', () => {
    expect(validateCommand({ kind: 'halt', ids: [1, 12] }, 0, world)).toBe(false);
    expect(validateCommand({ kind: 'halt', ids: [999999] }, 0, world)).toBe(false);
  });
  it('checks the carrier, the caller and the reveal side too', () => {
    expect(validateCommand({ kind: 'load', ids: [1], carrier: 12 }, 0, world)).toBe(false);
    expect(validateCommand({ kind: 'callStrike', caller: 12, x: 0, y: 0 }, 0, world)).toBe(false);
    expect(validateCommand({ kind: 'reveal', side: 1, x: 0, y: 0 }, 0, world)).toBe(false);
    expect(validateCommand({ kind: 'reveal', side: 0, x: 0, y: 0 }, 0, world)).toBe(true);
  });
  it('#559 F1: drops every callStrike and reveal in versus, and only those kinds', () => {
    const versus = { ...world, versus: true };
    expect(validateCommand({ kind: 'callStrike', caller: 1, x: 0, y: 0 }, 0, versus)).toBe(false);
    expect(validateCommand({ kind: 'reveal', side: 0, x: 0, y: 0 }, 0, versus)).toBe(false);
    expect(validateCommand({ kind: 'callStrike', caller: 1, x: 0, y: 0 }, 0, world)).toBe(true);
    expect(validateCommand({ kind: 'halt', ids: [1] }, 0, versus)).toBe(true);
    expect(validateCommand({ kind: 'smoke', ids: [1], x: 0, y: 0 }, 0, versus)).toBe(true);
  });
});

describe('validateCommand: setStance', () => {
  it('passes for own units in single-player and versus; a foreign id or an empty ids drops it', () => {
    const versus = { ...world, versus: true };
    const own: Command = { kind: 'setStance', ids: [1, 2], stance: 'ambush' };
    expect(validateCommand(own, 0, world)).toBe(true);
    expect(validateCommand(own, 0, versus)).toBe(true);
    expect(validateCommand({ kind: 'setStance', ids: [1, 12], stance: 'hold' }, 0, world)).toBe(false);
    expect(validateCommand({ kind: 'setStance', ids: [1, 12], stance: 'hold' }, 0, versus)).toBe(false);
    expect(validateCommand({ kind: 'setStance', ids: [], stance: 'hold' }, 0, world)).toBe(false);
  });
});

describe('validateCommand: the map and the target', () => {
  it('drops a point off the map', () => {
    expect(validateCommand({ kind: 'move', ids: [1], x: 10 * F, y: 10 * F }, 0, world)).toBe(true);
    expect(validateCommand({ kind: 'move', ids: [1], x: -1, y: 10 * F }, 0, world)).toBe(false);
    expect(validateCommand({ kind: 'move', ids: [1], x: 48 * F, y: 10 * F }, 0, world)).toBe(false);
    expect(validateCommand({ kind: 'smoke', ids: [1], x: 10 * F, y: 99 * F }, 0, world)).toBe(false);
    expect(validateCommand({ kind: 'callStrike', caller: 1, x: 10 * F, y: -F }, 0, world)).toBe(false);
  });
  it('accepts the map corners and refuses one fixed-point step past the far edge', () => {
    expect(validateCommand({ kind: 'attackMove', ids: [1], x: 0, y: 0 }, 0, world)).toBe(true);
    expect(validateCommand({ kind: 'attackMove', ids: [1], x: 48 * F - 1, y: 48 * F - 1 }, 0, world)).toBe(true);
    expect(validateCommand({ kind: 'attackMove', ids: [1], x: 10 * F, y: 48 * F }, 0, world)).toBe(false);
    expect(validateCommand({ kind: 'reveal', side: 0, x: 10 * F, y: -1 }, 0, world)).toBe(false);
    expect(validateCommand({ kind: 'reveal', side: 0, x: 48 * F, y: 0 }, 0, world)).toBe(false);
  });
  it('treats NaN and infinities as off the map', () => {
    expect(validateCommand({ kind: 'move', ids: [1], x: NaN, y: F }, 0, world)).toBe(false);
    expect(validateCommand({ kind: 'move', ids: [1], x: F, y: Infinity }, 0, world)).toBe(false);
    expect(validateCommand({ kind: 'smoke', ids: [1], x: -Infinity, y: F }, 0, world)).toBe(false);
  });
  it('drops a structure or tunnel id that does not exist', () => {
    expect(validateCommand({ kind: 'garrison', ids: [1], structure: 3 }, 0, world)).toBe(true);
    expect(validateCommand({ kind: 'garrison', ids: [1], structure: 4 }, 0, world)).toBe(false);
    expect(validateCommand({ kind: 'demolish', ids: [1], structure: 3 }, 0, world)).toBe(true);
    expect(validateCommand({ kind: 'demolish', ids: [1], structure: -1 }, 0, world)).toBe(false);
    expect(validateCommand({ kind: 'chargeTunnel', ids: [1], tunnel: 0 }, 0, world)).toBe(true);
    expect(validateCommand({ kind: 'chargeTunnel', ids: [1], tunnel: 7 }, 0, world)).toBe(false);
  });
});

describe('validateCommand: attack (GH-420)', () => {
  it('accepts own units firing on an existing enemy', () => {
    expect(validateCommand({ kind: 'attack', ids: [1, 2], target: 12 }, 0, world)).toBe(true);
    expect(validateCommand({ kind: 'attack', ids: [12], target: 1 }, 1, world)).toBe(true);
  });
  it('drops an attack naming a foreign shooter, no shooter, or a target that is not an enemy', () => {
    expect(validateCommand({ kind: 'attack', ids: [1, 12], target: 13 }, 0, world)).toBe(false);
    expect(validateCommand({ kind: 'attack', ids: [], target: 12 }, 0, world)).toBe(false);
    // The target is the seat's own side, or an id that does not exist.
    expect(validateCommand({ kind: 'attack', ids: [1], target: 2 }, 0, world)).toBe(false);
    expect(validateCommand({ kind: 'attack', ids: [1], target: 999999 }, 0, world)).toBe(false);
  });
});

describe('validateCommand: rescue (GH-707)', () => {
  it('accepts own medics on an existing target of either side', () => {
    expect(validateCommand({ kind: 'rescue', ids: [1, 2], target: 3 }, 0, world)).toBe(true); // own wounded
    expect(validateCommand({ kind: 'rescue', ids: [1], target: 12 }, 0, world)).toBe(true); // an enemy's
    expect(validateCommand({ kind: 'rescue', ids: [12], target: 1 }, 1, world)).toBe(true);
  });
  it('drops a foreign medic, no medic, or a target that does not exist', () => {
    expect(validateCommand({ kind: 'rescue', ids: [1, 12], target: 3 }, 0, world)).toBe(false);
    expect(validateCommand({ kind: 'rescue', ids: [12], target: 3 }, 0, world)).toBe(false);
    expect(validateCommand({ kind: 'rescue', ids: [], target: 3 }, 0, world)).toBe(false);
    expect(validateCommand({ kind: 'rescue', ids: [1], target: 999999 }, 0, world)).toBe(false);
  });
});

describe('applyFrame', () => {
  it('queues in canonical order and counts what it dropped', () => {
    const queued: Command[] = [];
    const r = applyFrame(
      { tick: 3, cmds: [
        { seat: 1, seq: 0, cmd: { kind: 'halt', ids: [11] } },
        { seat: 0, seq: 1, cmd: { kind: 'halt', ids: [1] } },
        { seat: 0, seq: 0, cmd: { kind: 'halt', ids: [12] } },
      ] },
      { queueCommand: (c) => queued.push(c) },
      world
    );
    expect(r).toEqual({ queued: 2, dropped: 1 });
    expect(queued).toEqual([{ kind: 'halt', ids: [1] }, { kind: 'halt', ids: [11] }]);
  });
});

describe('validateCommand: build and support (N2)', () => {
  it('single-player: seat 0 may buy for side 0 only, and a support off the map drops', () => {
    expect(validateCommand({ kind: 'build', side: 0, unit: 'inf_squad' }, 0, world)).toBe(true);
    expect(validateCommand({ kind: 'build', side: 1, unit: 'inf_squad' }, 0, world)).toBe(false);
    expect(validateCommand({ kind: 'support', side: 0, support: 'drone_sweep', x: 2 * F, y: 3 * F }, 0, world)).toBe(true);
    expect(validateCommand({ kind: 'support', side: 1, support: 'drone_sweep', x: 2 * F, y: 3 * F }, 0, world)).toBe(false);
    expect(validateCommand({ kind: 'support', side: 0, support: 'air_strike', x: 48 * F, y: 3 * F }, 0, world)).toBe(false);
    expect(validateCommand({ kind: 'support', side: 0, support: 'air_strike', x: 2 * F, y: -1 }, 0, world)).toBe(false);
  });
  it('a mirror versus room: both drop for every side (no runtime prices them; the #559 rule)', () => {
    const versus = { ...world, versus: true };
    for (const seat of [0, 1] as const) {
      for (const side of [0, 1]) {
        expect(validateCommand({ kind: 'build', side, unit: 'inf_squad' }, seat, versus)).toBe(false);
        expect(validateCommand({ kind: 'support', side, support: 'drone_sweep', x: 2 * F, y: 3 * F }, seat, versus)).toBe(false);
      }
    }
  });
});

describe('validateCommand: the line verbs (F4 Task 5b)', () => {
  const mk = (side: number): Command[] => [
    { kind: 'cancelBuild', side, line: 0, index: -1 },
    { kind: 'setRally', side, line: 0, x: 2 * F, y: 3 * F },
    { kind: 'clearRally', side, line: 0 },
  ];
  it('single-player: side 0 passes, side 1 drops; a rally off the map drops', () => {
    for (const c of mk(0)) expect(validateCommand(c, 0, world), c.kind).toBe(true);
    for (const c of mk(1)) expect(validateCommand(c, 0, world), c.kind).toBe(false);
    expect(validateCommand({ kind: 'setRally', side: 0, line: 0, x: 48 * F, y: 3 * F }, 0, world)).toBe(false);
    expect(validateCommand({ kind: 'setRally', side: 0, line: 0, x: 2 * F, y: -1 }, 0, world)).toBe(false);
  });
  it('a mirror versus room: all three drop for every side', () => {
    const versus = { ...world, versus: true };
    for (const seat of [0, 1] as const) {
      for (const side of [0, 1]) {
        for (const c of mk(side)) expect(validateCommand(c, seat, versus), c.kind).toBe(false);
      }
    }
  });
});

describe('validateCommand: an economy room (N3 Task 4)', () => {
  const economy: SeatWorld = { ...world, versus: true, economy: true };
  const production = (side: number): Command[] => [
    { kind: 'build', side, unit: 'sarim_rifles' },
    { kind: 'build', side, unit: 'sarim_rifles', line: 1 },
    { kind: 'cancelBuild', side, line: 0, index: -1 },
    { kind: 'setRally', side, line: 0, x: 2 * F, y: 3 * F },
    { kind: 'clearRally', side, line: 0 },
  ];
  it('each seat passes every production kind for its OWN side', () => {
    for (const seat of [0, 1] as const) {
      for (const c of production(seat)) expect(validateCommand(c, seat, economy), `${seat} ${c.kind}`).toBe(true);
    }
  });
  it('a forged side drops: seat 0 sending build{side:1} (and every other kind), and seat 1 sending side 0', () => {
    for (const c of production(1)) expect(validateCommand(c, 0, economy), c.kind).toBe(false);
    for (const c of production(0)) expect(validateCommand(c, 1, economy), c.kind).toBe(false);
  });
  it('LD1: a Sarim host is seat 0 on side 1, and builds for side 1 -- not for side 0', () => {
    const sarimHost: SeatWorld = { ...economy, sideOfSeat: (seat) => (seat === 0 ? 1 : 0) };
    for (const c of production(1)) expect(validateCommand(c, 0, sarimHost), c.kind).toBe(true);
    for (const c of production(0)) expect(validateCommand(c, 0, sarimHost), c.kind).toBe(false);
  });
  it('a rally off the map still drops', () => {
    expect(validateCommand({ kind: 'setRally', side: 1, line: 0, x: 48 * F, y: 3 * F }, 1, economy)).toBe(false);
    expect(validateCommand({ kind: 'setRally', side: 1, line: 0, x: 2 * F, y: -1 }, 1, economy)).toBe(false);
  });
  it('a mirror room still drops every production kind, from both seats, for every side', () => {
    const mirror: SeatWorld = { ...economy, economy: false };
    for (const seat of [0, 1] as const) {
      for (const side of [0, 1]) for (const c of production(side)) expect(validateCommand(c, seat, mirror), c.kind).toBe(false);
    }
  });
  it('LD5: support, callStrike and reveal drop in an economy room as in a mirror one', () => {
    for (const seat of [0, 1] as const) {
      expect(validateCommand({ kind: 'support', side: seat, support: 'drone_sweep', x: 2 * F, y: 3 * F }, seat, economy)).toBe(false);
      expect(validateCommand({ kind: 'reveal', side: seat, x: 2 * F, y: 3 * F }, seat, economy)).toBe(false);
    }
    expect(validateCommand({ kind: 'callStrike', caller: 1, x: 2 * F, y: 3 * F }, 0, economy)).toBe(false);
  });
});

describe('validateCommand: field works requests (GH-277)', () => {
  it('single-player: side 0 with its own builders (or none) passes; a foreign side or builder drops', () => {
    expect(validateCommand({ kind: 'raiseWorks', side: 0, works: 'kdf_outpost', x: 4, y: 4, ids: [1, 2] }, 0, world)).toBe(true);
    expect(validateCommand({ kind: 'raiseWorks', side: 0, works: 'kdf_outpost', x: 4, y: 4, ids: [] }, 0, world)).toBe(true);
    expect(validateCommand({ kind: 'raiseWorks', side: 0, works: 'kdf_outpost', x: 4, y: 4, ids: [1, 12] }, 0, world)).toBe(false);
    expect(validateCommand({ kind: 'raiseWorks', side: 1, works: 'kdf_outpost', x: 4, y: 4, ids: [] }, 0, world)).toBe(false);
    expect(validateCommand({ kind: 'cancelWorks', side: 0, site: 0 }, 0, world)).toBe(true);
    expect(validateCommand({ kind: 'cancelWorks', side: 1, site: 0 }, 0, world)).toBe(false);
  });
  it('versus (mirror or economy): both drop for every side (field works are not in a versus room)', () => {
    const versus = { ...world, versus: true };
    for (const seat of [0, 1] as const) {
      for (const side of [0, 1]) {
        const own = seat === 0 ? [1] : [11];
        for (const room of [versus, { ...versus, economy: true }]) {
          expect(validateCommand({ kind: 'raiseWorks', side, works: 'kdf_outpost', x: 4, y: 4, ids: own }, seat, room)).toBe(false);
          expect(validateCommand({ kind: 'cancelWorks', side, site: 0 }, seat, room)).toBe(false);
        }
      }
    }
  });
  it('the sim-level construct and cancelConstruct never validate, from any seat', () => {
    expect(validateCommand({ kind: 'construct', ids: [1], structType: 0, x: 4, y: 4 }, 0, world)).toBe(false);
    expect(validateCommand({ kind: 'cancelConstruct', site: 0 }, 0, world)).toBe(false);
  });
});

describe('versus tunnels (GH-681)', () => {
  it('enterTunnel: the Sarim seat, its own units, a route its side owns -- and nothing else', () => {
    expect(validateCommand({ kind: 'enterTunnel', ids: [11], tunnel: 0 }, 1, world)).toBe(true);
    // The KDF seat may not (T-R4), even naming a route it would own.
    expect(validateCommand({ kind: 'enterTunnel', ids: [1], tunnel: 0 }, 0, world)).toBe(false);
    expect(validateCommand({ kind: 'enterTunnel', ids: [1], tunnel: 0 }, 0, { ...world, tunnelOwner: () => 0 })).toBe(false);
    // Another side's unit, a route nobody owns, a route that does not exist, no units.
    expect(validateCommand({ kind: 'enterTunnel', ids: [11, 1], tunnel: 0 }, 1, world)).toBe(false);
    expect(validateCommand({ kind: 'enterTunnel', ids: [11], tunnel: 1 }, 1, world)).toBe(false);
    expect(validateCommand({ kind: 'enterTunnel', ids: [11], tunnel: 2 }, 1, { ...world, tunnelOwner: () => 1 })).toBe(false);
    expect(validateCommand({ kind: 'enterTunnel', ids: [], tunnel: 0 }, 1, world)).toBe(false);
  });
  it('enterTunnel is a route its OWN side owns: a Sarim seat on side 0 cannot take side 1\'s', () => {
    const sarimOnZero: SeatWorld = { ...world, factionOfSeat: () => 'sarim' };
    expect(validateCommand({ kind: 'enterTunnel', ids: [1], tunnel: 0 }, 0, sarimOnZero)).toBe(false);
    expect(validateCommand({ kind: 'enterTunnel', ids: [1], tunnel: 0 }, 0, { ...sarimOnZero, tunnelOwner: () => 0 })).toBe(true);
  });
  it('vent: the Sarim seat and its own units only', () => {
    expect(validateCommand({ kind: 'vent', ids: [11], mode: 'raid' }, 1, world)).toBe(true);
    expect(validateCommand({ kind: 'vent', ids: [11], mode: 'exit' }, 1, world)).toBe(true);
    expect(validateCommand({ kind: 'vent', ids: [1], mode: 'raid' }, 0, world)).toBe(false);
    expect(validateCommand({ kind: 'vent', ids: [1], mode: 'raid' }, 1, world)).toBe(false);
    expect(validateCommand({ kind: 'vent', ids: [], mode: 'raid' }, 1, world)).toBe(false);
  });
  it('neither is a runtime-priced kind: both pass in versus as out of it', () => {
    const vs: SeatWorld = { ...world, versus: true };
    expect(validateCommand({ kind: 'enterTunnel', ids: [11], tunnel: 0 }, 1, vs)).toBe(true);
    expect(validateCommand({ kind: 'vent', ids: [11], mode: 'exit' }, 1, vs)).toBe(true);
  });
});
