/** The whole input to both simulations (spec §2.1). `mode: 'sandbox'` is
 *  N0's two-humans-on-side-0 room; `'versus'` arrives with N1. */
export type Seat = 0 | 1;
export type Faction = 'kdf' | 'sarim';

export interface SeatConfig {
  seat: Seat;
  side: 0 | 1;
  faction: Faction;
  kit: 'matched' | 'brigade';
  tiers: Record<string, number>;
  unlocks: string[];
  player: string;
  callsign: string;
  kind: 'human' | 'bot';
}

export type Pace = { kind: 'realtime' } | { kind: 'paced'; roundTicks: number; roundWallMs: number };

export interface MatchConfig {
  matchId: string;
  code: string;
  seed: number;
  map: string;
  mode: 'sandbox' | 'versus';
  seats: [SeatConfig, SeatConfig];
  pace: Pace;
  hashEveryTicks: number;
  bufferTicks: number;
  build: string;
  dataDigest: number;
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

function isSeatConfig(v: unknown, seat: Seat): v is SeatConfig {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  return s.seat === seat && (s.side === 0 || s.side === 1) && (s.faction === 'kdf' || s.faction === 'sarim') &&
    (s.kit === 'matched' || s.kit === 'brigade') && typeof s.tiers === 'object' && s.tiers !== null &&
    Object.values(s.tiers as Record<string, unknown>).every(isInt) && Array.isArray(s.unlocks) && s.unlocks.every(isStr) &&
    isStr(s.player) && isStr(s.callsign) && (s.kind === 'human' || s.kind === 'bot');
}

function isPace(v: unknown): v is Pace {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  if (p.kind === 'realtime') return true;
  return p.kind === 'paced' && isInt(p.roundTicks) && p.roundTicks > 0 && isInt(p.roundWallMs) && p.roundWallMs > 0;
}

export function validateConfig(v: unknown): MatchConfig | null {
  if (typeof v !== 'object' || v === null) return null;
  const c = v as Record<string, unknown>;
  if (!isStr(c.matchId) || !isStr(c.code) || !isInt(c.seed) || !isStr(c.map)) return null;
  if (c.mode !== 'sandbox' && c.mode !== 'versus') return null;
  if (!Array.isArray(c.seats) || c.seats.length !== 2 || !isSeatConfig(c.seats[0], 0) || !isSeatConfig(c.seats[1], 1)) return null;
  if (!isPace(c.pace) || !isInt(c.hashEveryTicks) || c.hashEveryTicks < 1 || !isInt(c.bufferTicks) || c.bufferTicks < 0) return null;
  if (!isStr(c.build) || !isInt(c.dataDigest)) return null;
  return c as unknown as MatchConfig;
}

/** Standard 32-bit FNV-1a over UTF-8 bytes: the data digest of the JSON a
 *  build ships (spec §2.1), computed the same way in a browser and in Node. */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5 | 0;
  const bytes = new TextEncoder().encode(s);
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 16777619);
  return h | 0;
}
