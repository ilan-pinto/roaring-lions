import { describe, expect, it } from 'vitest';
import type { MatchConfig } from '@lions/net';
import { seatShouldProduceSnapshots } from './snapshot-gate';

type Kind = 'human' | 'bot';

function room(over: { mode?: 'versus' | 'sandbox'; kinds?: [Kind, Kind]; every?: number } = {}): Pick<MatchConfig, 'mode' | 'seats' | 'snapshotEveryTicks'> {
  const kinds = over.kinds ?? ['human', 'human'];
  const seat = (s: 0 | 1) => ({ seat: s, side: s, faction: 'kdf' as const, kit: 'matched' as const, tiers: {}, unlocks: [], player: `p${s}`, callsign: `c${s}`, kind: kinds[s] });
  return {
    mode: over.mode ?? 'versus',
    seats: [seat(0), seat(1)],
    ...(over.every === 0 ? {} : { snapshotEveryTicks: over.every ?? 1200 }),
  };
}

describe('seatShouldProduceSnapshots (S4 N2)', () => {
  it('a human v human versus room produces', () => {
    expect(seatShouldProduceSnapshots(room())).toBe(true);
  });

  it('a human v bot room does not, whichever seat the bot holds', () => {
    expect(seatShouldProduceSnapshots(room({ kinds: ['human', 'bot'] }))).toBe(false);
    expect(seatShouldProduceSnapshots(room({ kinds: ['bot', 'human'] }))).toBe(false);
  });

  it('a bot v bot room does not', () => {
    expect(seatShouldProduceSnapshots(room({ kinds: ['bot', 'bot'] }))).toBe(false);
  });

  it('a sandbox room does not, even with two humans and a cadence', () => {
    expect(seatShouldProduceSnapshots(room({ mode: 'sandbox' }))).toBe(false);
  });

  it('a room with the cadence off does not', () => {
    expect(seatShouldProduceSnapshots(room({ every: 0 }))).toBe(false);
  });
});
