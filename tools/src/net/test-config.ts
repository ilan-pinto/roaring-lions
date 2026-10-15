import { validateConfig, type Faction, type MatchConfig, type Pace } from '@lions/net';
export function versusConfig(map: string, o: { factions?: [Faction, Faction]; seed?: number; pace?: Pace; kinds?: ['human' | 'bot', 'human' | 'bot'] } = {}): MatchConfig {
  const factions = o.factions ?? ['kdf', 'kdf'];
  const kinds = o.kinds ?? ['human', 'human'];
  const seat = (s: 0 | 1) => ({ seat: s, side: s, faction: factions[s], kit: 'matched', tiers: {}, unlocks: [], player: `p${s}`, callsign: `c${s}`, kind: kinds[s] });
  const c = validateConfig({ matchId: 'M', code: 'ABCDEF', seed: o.seed ?? 1234, map, mode: 'versus', seats: [seat(0), seat(1)], pace: o.pace ?? { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: 'test', dataDigest: 0 });
  if (c === null) throw new Error('versusConfig: the fixture no longer validates');
  return c;
}
