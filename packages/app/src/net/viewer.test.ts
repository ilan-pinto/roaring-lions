import { describe, it, expect } from 'vitest';
import type { MatchConfig, SeatConfig } from '@lions/net';
import { viewerSideOf } from './viewer';

const seat = (s: 0 | 1, side: 0 | 1): SeatConfig => ({
  seat: s, side, faction: 'kdf', kit: 'matched', tiers: {}, unlocks: [], player: 'p', callsign: 'c', kind: 'human',
});
const config = (side1: 0 | 1): MatchConfig => ({
  matchId: 'm', code: 'ABCDEF', seed: 1, map: 'x', mode: 'versus', seats: [seat(0, 0), seat(1, side1)],
  pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: 'b', dataDigest: 0,
});

describe('viewerSideOf', () => {
  it('is 0 in single-player', () => { expect(viewerSideOf(null, null)).toBe(0); });
  it('is the seat\'s own side in a room', () => {
    expect(viewerSideOf(config(1), 1)).toBe(1);
    expect(viewerSideOf(config(1), 0)).toBe(0);
    expect(viewerSideOf(config(0), 1)).toBe(0);
  });
});
