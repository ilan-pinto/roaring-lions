import { describe, it, expect } from 'vitest';
import type { Command } from '@lions/sim';
import { validateCommand, applyFrame, type SeatWorld } from './ownership';

const world: SeatWorld = {
  sideOfSeat: (seat) => seat,                          // seat 0 → side 0, seat 1 → side 1
  sideOfEntity: (id) => (id < 10 ? 0 : id < 20 ? 1 : undefined),
};

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
