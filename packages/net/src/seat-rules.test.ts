import { describe, it, expect } from 'vitest';
import type { MatchConfig, SeatConfig } from './config';
import { seatRules } from './seat-rules';

const seat = (n: 0 | 1, side: 0 | 1, kind: 'human' | 'bot' = 'human'): SeatConfig => ({
  seat: n, side, faction: 'kdf', kit: 'matched', tiers: {}, unlocks: [], player: `p${n}`, callsign: `c${n}`, kind,
});
const room = (mode: 'sandbox' | 'versus', seats: [SeatConfig, SeatConfig]): MatchConfig => ({
  matchId: 'm', code: 'AAAA', seed: 1, map: 'tel_marum', mode, seats,
  pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: 'b', dataDigest: 0,
});

describe('seatRules', () => {
  it('single-player (no room): side 0 is the player, side 1 is not', () => {
    expect(seatRules(null)).toEqual({ humanHeld: [true, false] });
  });
  it('a sandbox room (two humans on side 0): side 0 held, side 1 not', () => {
    expect(seatRules(room('sandbox', [seat(0, 0), seat(1, 0)]))).toEqual({ humanHeld: [true, false] });
  });
  it('a versus room: both sides are held', () => {
    expect(seatRules(room('versus', [seat(0, 0), seat(1, 1)]))).toEqual({ humanHeld: [true, true] });
  });
  it('a versus room with a bot seat: the bot side is held too', () => {
    expect(seatRules(room('versus', [seat(0, 0), seat(1, 1, 'bot')]))).toEqual({ humanHeld: [true, true] });
  });
  it('returns a fresh table each call (no shared mutable state)', () => {
    const a = seatRules(null);
    a.humanHeld[1] = true;
    expect(seatRules(null).humanHeld[1]).toBe(false);
  });
});
