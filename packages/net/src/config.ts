/** The whole input to both simulations (spec §2.1). `mode: 'sandbox'` is
 *  N0's two-humans-on-side-0 room; `'versus'` arrives with N1. */
export type Seat = 0 | 1;
export type Faction = 'kdf' | 'sarim';

export interface SeatConfig {
  seat: Seat;
  side: 0 | 1;
  faction: Faction;
  kit: 'matched' | 'brigade';
  /** The seat's bought kit, the account's own `ownedTiers` shape and the one
   *  `upgradePrepass` takes: unit type id -> track -> tier. `{}` for a matched
   *  room. Structural checks only (`isTiers`); the room cannot check a claim
   *  against an account. */
  tiers: Record<string, Record<string, number>>;
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
  /** Minted 0 by the room and kept for wire compatibility; NOT folded into
   *  any hash since ruling L4 (N2-P3). Each client folds the digest of its
   *  OWN content instead (`packages/app/src/net/content-digest.ts`): a number
   *  the room hands both seats alike cannot tell them apart. */
  dataDigest: number;
}

/** What the host of a versus room picks (2026-10-14, the quick version before
 *  N3): `mirror` is KDF against KDF, as every room was before; `kdf` and
 *  `sarim` are the HOST's faction, and the guest gets the other. */
export type Matchup = 'mirror' | 'kdf' | 'sarim';
export const MATCHUPS: readonly Matchup[] = ['mirror', 'kdf', 'sarim'];

/** A matchup from anything a client sent: unknown reads as the mirror. */
export function matchupField(v: unknown): Matchup {
  return v === 'kdf' || v === 'sarim' ? v : 'mirror';
}

/** Each SEAT's faction for a matchup (index 0 is the host's seat). */
export function factionsOfMatchup(m: Matchup): [Faction, Faction] {
  if (m === 'kdf') return ['kdf', 'sarim'];
  if (m === 'sarim') return ['sarim', 'kdf'];
  return ['kdf', 'kdf'];
}

/** The maps a versus room is offered on (the lead's ruling on #561,
 *  2026-10-14, "Limit, then fix"): the two the versus probe measured close to
 *  even in a mirror match (#589, `pnpm versus:probe`). On
 *  `beit_sahwan_outskirts` the west spawn's Lavis once survived 75% of the
 *  time against 15% for the east -- terrain, not side logic -- so a map
 *  nobody has measured is not a fair contest. The lobby offers only these
 *  (`versusMaps`) and the route and the room both refuse any other with a 400
 *  before a room exists (`versusMapAllowed`); a sandbox room, two humans on
 *  one side, has no contest to be fair about and is not limited.
 *
 *  A further map re-opens only after its per-map fair start points are
 *  authored and measured within 60/40 at 48 seeds per spawn order. The two
 *  dedicated versus maps (2026-10-14) are those: point-symmetric, with their
 *  seats named `versus_0`/`versus_1` and read by name (`sandboxAnchors`), and
 *  the probe's mirror read at 48 seeds is wadi_tarfan west 22 / east 25 /
 *  1 draw and milh_flats 24 / 24.
 *
 *  `beit_sahwan_outskirts`' room seats are no longer the heuristic's: after
 *  PR #721 the mirror read west 38 / east 10 there, and its measured seats
 *  live in `VERSUS_SEATS` (packages/app/src/net/versus-seats.ts). */
export const VERSUS_FAIR_MAPS: readonly string[] = ['beit_sahwan_outskirts', 'tel_marum', 'wadi_tarfan', 'milh_flats'];

/** Whether a versus room may be hosted on `map`. */
export function versusMapAllowed(map: string): boolean {
  return VERSUS_FAIR_MAPS.includes(map);
}

/** The maps a KDF-vs-Sarim matchup is offered on (the lead's ruling,
 *  2026-10-14): Tel Marum -- the map the versus probe balanced the Sarim
 *  force on -- and Wadi Tarfan, which reads the same at 48 seeds (KDF west:
 *  KDF 19 / Sarim 29, Tel Marum's own cell to the game; Sarim west: KDF 25 /
 *  Sarim 23). Milh Flats is NOT here: Sarim on the west seat lost 33 of 48
 *  (KDF 68.8%), so it is a mirror-only map. The mirror plays on the fair maps
 *  (`VERSUS_FAIR_MAPS`); a non-mirror pairing is narrower still. The lobby
 *  offers no other pairing and the room refuses one (`matchupAllowed`). */
export const FACTION_MATCHUP_MAPS: readonly string[] = ['tel_marum', 'wadi_tarfan'];

/** Whether `m` may be played on `map`, among the maps a room is offered on at
 *  all: the mirror anywhere, a KDF-vs-Sarim pairing on `FACTION_MATCHUP_MAPS`.
 *  Whether the map is offered is `versusMapAllowed`'s question, asked beside it. */
export function matchupAllowed(m: Matchup, map: string): boolean {
  return m === 'mirror' || FACTION_MATCHUP_MAPS.includes(map);
}

/** Whether `v` is a faction pair, by seat. */
export function isFactionPair(v: unknown): v is [Faction, Faction] {
  return Array.isArray(v) && v.length === 2 && v.every((f) => f === 'kdf' || f === 'sarim');
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Bounds on a seat's `tiers`, so a config read back from a replay or the
 *  room's own storage is bounded as well as the client's message is. The
 *  shipped kit is 19 KDF types with at most 3 tracks of at most 3 tiers each;
 *  every bound sits at three times that or more, so it never refuses a real
 *  claim, and `packages/worker/src/match/kit-tracks.test.ts` fails if the
 *  shipped tracks ever outgrow one of them. */
export const TIERS_MAX_TYPES = 64;
export const TIERS_MAX_TRACKS = 8;
export const TIERS_MAX_TIER = 16;
/** `tiers` is `{ typeId: { track: n } }` with every leaf an integer in
 *  0..TIERS_MAX_TIER, at most TIERS_MAX_TYPES ids and TIERS_MAX_TRACKS tracks
 *  an id. Own enumerable keys only (`Object.keys`/`Object.entries`), and no
 *  key at either level may be `__proto__`, `constructor` or `prototype`:
 *  JSON.parse makes each an OWN key, which any later spread or assignment
 *  copy turns into a prototype or an inherited read. No shipped type id or
 *  track carries one of those names. */
const RESERVED_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);
function isTiers(v: unknown): v is Record<string, Record<string, number>> {
  if (!isRecord(v) || Object.keys(v).length > TIERS_MAX_TYPES) return false;
  return Object.entries(v).every(([id, t]) => !RESERVED_KEYS.has(id) && isRecord(t) &&
    Object.keys(t).length <= TIERS_MAX_TRACKS &&
    Object.entries(t).every(([track, n]) => !RESERVED_KEYS.has(track) && isInt(n) && n >= 0 && n <= TIERS_MAX_TIER));
}

function isSeatConfig(v: unknown, seat: Seat): v is SeatConfig {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  return s.seat === seat && (s.side === 0 || s.side === 1) && (s.faction === 'kdf' || s.faction === 'sarim') &&
    (s.kit === 'matched' || s.kit === 'brigade') && isTiers(s.tiers) &&
    Array.isArray(s.unlocks) && s.unlocks.every(isStr) &&
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
