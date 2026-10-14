import { describe, it, expect } from 'vitest';
import type { Command } from '@lions/sim';
import { validateCommand, applyFrame, type SeatWorld } from './ownership';

const world: SeatWorld = {
  sideOfSeat: (seat) => seat,                          // seat 0 → side 0, seat 1 → side 1
  sideOfEntity: (id) => (id < 10 ? 0 : id < 20 ? 1 : undefined),
  width: 48,
  height: 48,
  structureExists: (id) => id === 3,
  tunnelExists: (id) => id === 0,
  versus: false,
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
