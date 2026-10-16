import { describe, expect, it } from 'vitest';
import { validateConfig, type MatchConfig, type SeatConfig } from '@lions/net';
import { buildMatchWorld, seatKitTiers, type MatchWorld } from './match-world';

function config(map: string, factions: ['kdf' | 'sarim', 'kdf' | 'sarim'], seed = 1234): MatchConfig {
  const seat = (s: 0 | 1) => ({ seat: s, side: s, faction: factions[s], kit: 'matched', tiers: {}, unlocks: [], player: `p${s}`, callsign: `c${s}`, kind: 'human' });
  const c = validateConfig({ matchId: 'M', code: 'ABCDEF', seed, map, mode: 'versus', seats: [seat(0), seat(1)], pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: 'b', dataDigest: 0 });
  if (c === null) throw new Error('bad fixture');
  return c;
}

describe('buildMatchWorld', () => {
  it('reproduces the mirror pins versus-force.test.ts holds (beit, tel; 200 ticks)', () => {
    // LITERALS (an oracle that imports its expectation from the code under test
    // cannot fail, CLAUDE.md). seed 20260727, 200 ticks, KDF against KDF.
    // tel_marum: 2485550309 is versus-force.test.ts's own pin (re-pinned 14 Oct, GH-420)
    // -- the map has no tunnels, so the helper's world and the browser's agree.
    // beit_sahwan_outskirts: versus-force.test.ts pins 1757246701 through
    // `versus-world.test-helper.ts`, which registers NO tunnels. The browser's boot
    // (`bootBattlefield`) registers the map's four routes, and tunnel state is in the
    // hash, so the browser's world -- and so this builder's -- hashes differently.
    // The browser path is the truth; that is its own pin. Registering the prepass's
    // types instead of the raw units moves nothing (checked both ways); the tunnels
    // are the whole difference (drop the loop and this reads 1757246701 again).
    // 2026-10-16: sepStall column (GH-421, V-D10) joins the hash, no behaviour moved; with its
    // hashArray line removed these read the old values. Was 3043363756 / 1260439781.
    for (const [map, pin] of [['beit_sahwan_outskirts', 2723429292], ['tel_marum', 2485550309]] as const) {
      const w = buildMatchWorld(config(map, ['kdf', 'kdf'], 20260727));
      for (let i = 0; i < 200; i++) w.sim.tick();
      expect(w.sim.hash()).toBe(pin);
    }
  });
  it('N2: a versus world holds both seats (seatRules), so neither side auto-breaches', () => {
    const w = buildMatchWorld(config('wadi_tarfan', ['kdf', 'kdf']));
    expect([w.sim.isHumanHeld(0), w.sim.isHumanHeld(1), w.sim.isHumanHeld(2)]).toEqual([true, true, false]);
  });
  it('is a function of the config alone: two builds agree, a different seed differs', () => {
    const a = buildMatchWorld(config('wadi_tarfan', ['kdf', 'sarim']));
    const b = buildMatchWorld(config('wadi_tarfan', ['kdf', 'sarim']));
    const c = buildMatchWorld(config('wadi_tarfan', ['kdf', 'sarim'], 99));
    for (const w of [a, b, c]) for (let i = 0; i < 100; i++) w.sim.tick();
    expect(a.sim.hash()).toBe(b.sim.hash());
    expect(c.sim.hash()).not.toBe(a.sim.hash());
  });
  it('spawns each side its faction force on its own anchor', () => {
    const w = buildMatchWorld(config('tel_marum', ['sarim', 'kdf']));
    const types = (ids: number[]) => new Set(ids.map((i) => w.sim.unitTypes[w.sim.state.typeIdx[i]].id));
    expect(types(w.bySide[0]).has('atgm_cell')).toBe(true);
    expect(types(w.bySide[1]).has('mbt_lavi')).toBe(true);
    expect(w.bySide[0].every((i) => w.sim.state.side[i] === 0)).toBe(true);
  });
  it('refuses a sandbox config', () => {
    expect(() => buildMatchWorld({ ...config('tel_marum', ['kdf', 'kdf']), mode: 'sandbox' })).toThrow(/versus/);
  });
});

type Tiers = Record<string, Record<string, number>>;
/** A `kit: 'brigade'` versus config, each SEAT's tiers and side given. */
function brigade(map: string, tiers: [Tiers, Tiers], opts: { factions?: ['kdf' | 'sarim', 'kdf' | 'sarim']; sides?: [0 | 1, 0 | 1]; kit?: ['matched' | 'brigade', 'matched' | 'brigade']; seed?: number } = {}): MatchConfig {
  const factions = opts.factions ?? ['kdf', 'kdf'];
  const sides = opts.sides ?? [0, 1];
  const kit = opts.kit ?? ['brigade', 'brigade'];
  const seat = (s: 0 | 1) => ({ seat: s, side: sides[s], faction: factions[sides[s]], kit: kit[s], tiers: tiers[s], unlocks: [], player: `p${s}`, callsign: `c${s}`, kind: 'human' });
  const c = validateConfig({ matchId: 'M', code: 'ABCDEF', seed: opts.seed ?? 1234, map, mode: 'versus', seats: [seat(0), seat(1)], pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: 'b', dataDigest: 0 });
  if (c === null) throw new Error('bad fixture');
  return c;
}

/** LITERALS, never read from the code under test (CLAUDE.md). The roster
 *  registers MATCHED_TYPES types in a matched room; a mbt_lavi's hull.hp is
 *  3000 and its armour tier 1 adds 210 (data/units/kdf/mbt_lavi.json), so in
 *  Q16.16 a base Lavi reads 3000 * 65536 and a tier-1 Lavi 3210 * 65536. */
const MATCHED_TYPES = 35;
const LAVI_BASE_HP = 196608000;
const LAVI_ARMOUR1_HP = 210370560;
const LAVI1: Tiers = { mbt_lavi: { armour: 1 } };

const idOf = (w: MatchWorld, i: number): string => w.sim.unitTypes[w.sim.state.typeIdx[i]].id;
const laviHp = (w: MatchWorld, side: 0 | 1): number[] =>
  w.bySide[side].filter((i) => idOf(w, i) === 'mbt_lavi').map((i) => w.sim.state.hp[i]);
const hashAfter = (w: MatchWorld, ticks: number): number => {
  for (let i = 0; i < ticks; i++) w.sim.tick();
  return w.sim.hash();
};

describe('buildMatchWorld: each side registers and spawns its own kit', () => {
  it('a matched room registers the roster once (the literal every case below is measured from)', () => {
    expect(buildMatchWorld(config('tel_marum', ['kdf', 'kdf'])).sim.unitTypes.length).toBe(MATCHED_TYPES);
  });

  it("side 1's kit appends ONE type, and only side 1's Lavis carry it", () => {
    const w = buildMatchWorld(brigade('tel_marum', [{}, LAVI1]));
    expect(w.sim.unitTypes.length).toBe(MATCHED_TYPES + 1);
    expect(laviHp(w, 1)).toEqual([LAVI_ARMOUR1_HP, LAVI_ARMOUR1_HP]);
    expect(laviHp(w, 0)).toEqual([LAVI_BASE_HP, LAVI_BASE_HP]);
    expect(w.typeOf).toBe(w.typeOfBySide[0]);
    expect(w.typeOfBySide[1].get('mbt_lavi')).toBe(MATCHED_TYPES);
    expect(w.kitBySide[1].unitKitTiers.mbt_lavi).toEqual({ armour: 1 });
    expect(w.kitBySide[0].unitKitTiers.mbt_lavi).toEqual({});
  });

  it('two builds of the kitted config hash equal after 200 ticks', () => {
    const a = hashAfter(buildMatchWorld(brigade('tel_marum', [{}, LAVI1])), 200);
    const b = hashAfter(buildMatchWorld(brigade('tel_marum', [{}, LAVI1])), 200);
    expect(a).toBe(b);
  });

  it('the same kit on side 0 builds a different world, deterministically', () => {
    const original = hashAfter(buildMatchWorld(brigade('tel_marum', [{}, LAVI1])), 200);
    const swapped = buildMatchWorld(brigade('tel_marum', [LAVI1, {}]));
    // Side 0 registers the kitted roster; side 1, whose kit now differs, gets a
    // base copy appended -- still one type more than a matched room.
    expect(swapped.sim.unitTypes.length).toBe(MATCHED_TYPES + 1);
    expect(laviHp(swapped, 0)).toEqual([LAVI_ARMOUR1_HP, LAVI_ARMOUR1_HP]);
    expect(laviHp(swapped, 1)).toEqual([LAVI_BASE_HP, LAVI_BASE_HP]);
    const s = hashAfter(swapped, 200);
    expect(s).not.toBe(original);
    expect(hashAfter(buildMatchWorld(brigade('tel_marum', [LAVI1, {}])), 200)).toBe(s);
  });

  it('a seat is looked up by its side, never by its seat index', () => {
    // Seat 0 plays side 1 and holds the kit: side 1's Lavis must carry it.
    const w = buildMatchWorld(brigade('tel_marum', [LAVI1, {}], { sides: [1, 0] }));
    expect(laviHp(w, 1)).toEqual([LAVI_ARMOUR1_HP, LAVI_ARMOUR1_HP]);
    expect(laviHp(w, 0)).toEqual([LAVI_BASE_HP, LAVI_BASE_HP]);
  });

  it('a matched seat and a Sarim seat field no kit, whatever tiers the config carries', () => {
    const matched = buildMatchWorld(brigade('tel_marum', [{}, LAVI1], { kit: ['brigade', 'matched'] }));
    expect(matched.sim.unitTypes.length).toBe(MATCHED_TYPES);
    expect(laviHp(matched, 1)).toEqual([LAVI_BASE_HP, LAVI_BASE_HP]);
    // A Sarim side fields no KDF type, so a copy for it would be registered and never spawned.
    const sarim = buildMatchWorld(brigade('tel_marum', [{}, LAVI1], { factions: ['kdf', 'sarim'] }));
    expect(sarim.sim.unitTypes.length).toBe(MATCHED_TYPES);
  });

  it("a kitted KDF side 0 against a Sarim side 1 registers no copy side 1 could never spawn", () => {
    // Side 1's kit ({}) differs from side 0's, but side 1 is Sarim and fields
    // no KDF type: a base copy for it would be registered and never used.
    const w = buildMatchWorld(brigade('tel_marum', [LAVI1, {}], { factions: ['kdf', 'sarim'] }));
    expect(w.sim.unitTypes.length).toBe(MATCHED_TYPES);
    expect(laviHp(w, 0)).toEqual([LAVI_ARMOUR1_HP, LAVI_ARMOUR1_HP]);
  });
});

describe("seatKitTiers: a seat's claim as the world reads it", () => {
  const seat = (tiers: unknown, over: Partial<SeatConfig> = {}): SeatConfig =>
    ({ seat: 1, side: 1, faction: 'kdf', kit: 'brigade', tiers, unlocks: [], player: 'p', callsign: 'c', kind: 'human', ...over }) as SeatConfig;

  it("clamps each leaf to that track's own maximum, and drops what no KDF type declares", () => {
    // mbt_lavi's armour track has 3 tiers; a validated config admits up to 16.
    const got = seatKitTiers(seat({ mbt_lavi: { armour: 16, sensors: 0, warp: 2 }, atgm_cell: { armour: 1 }, no_such_unit: { armour: 1 } }));
    expect(got).toEqual({ mbt_lavi: { armour: 3 } });
    expect(Object.getPrototypeOf(got)).toBeNull();
    expect(Object.getPrototypeOf(got.mbt_lavi)).toBeNull();
  });

  it('is {} for a matched seat and for a Sarim seat', () => {
    expect(seatKitTiers(seat(LAVI1, { kit: 'matched' }))).toEqual({});
    expect(seatKitTiers(seat(LAVI1, { faction: 'sarim' }))).toEqual({});
  });

  it('reads own keys only: an own "__proto__" claim fields nothing', () => {
    // JSON.parse makes "__proto__" an OWN key; a spread copy of it would set
    // the copy's prototype, and the Lavi's tiers would be read through it.
    const claim = JSON.parse('{"__proto__": {"mbt_lavi": {"armour": 3}}}') as unknown;
    expect(seatKitTiers(seat(claim))).toEqual({});
    // An inherited id is not an own key either (validateConfig admits it: Object.keys sees nothing).
    expect(seatKitTiers(seat(Object.create(LAVI1) as unknown))).toEqual({});
    const base = brigade('tel_marum', [{}, {}]);
    const forged: MatchConfig = { ...base, seats: [base.seats[0], { ...base.seats[1], tiers: claim as Tiers }] };
    const w = buildMatchWorld(forged);
    expect(w.sim.unitTypes.length).toBe(MATCHED_TYPES);
    expect(laviHp(w, 1)).toEqual([LAVI_BASE_HP, LAVI_BASE_HP]);
  });

  it('a "constructor" track in a claim neither throws nor stops the real track', () => {
    const claim = JSON.parse('{"mbt_lavi": {"constructor": 1, "armour": 1}}') as Tiers;
    const base = brigade('tel_marum', [{}, {}]);
    const forged: MatchConfig = { ...base, seats: [base.seats[0], { ...base.seats[1], tiers: claim }] };
    const w = buildMatchWorld(forged);
    expect(laviHp(w, 1)).toEqual([LAVI_ARMOUR1_HP, LAVI_ARMOUR1_HP]);
  });

  it('a leaf of 16 builds the same world as the track maximum', () => {
    const at16 = hashAfter(buildMatchWorld(brigade('tel_marum', [{}, { mbt_lavi: { armour: 16 } }])), 20);
    const at3 = hashAfter(buildMatchWorld(brigade('tel_marum', [{}, { mbt_lavi: { armour: 3 } }])), 20);
    expect(at16).toBe(at3);
  });
});

describe("a matched room, and a brigade room with equal claims, build today's bytes", () => {
  // LITERALS: the same two pins the first describe holds (seed 20260727, 200 ticks).
  // 2026-10-16: the same two pins as above, moved by the sepStall column (GH-421). Was 3043363756 / 1260439781.
  const PINS = [['beit_sahwan_outskirts', 2723429292], ['tel_marum', 2485550309]] as const;
  const SEED = 20260727;

  it("kit 'matched' with empty tiers: the pins, and the roster registered once", () => {
    for (const [map, pin] of PINS) {
      const w = buildMatchWorld(config(map, ['kdf', 'kdf'], SEED));
      expect(w.sim.unitTypes.length).toBe(MATCHED_TYPES);
      expect(hashAfter(w, 200)).toBe(pin);
    }
  });

  it("kit 'brigade' with empty tiers on both seats: the same pins, the same type count", () => {
    for (const [map, pin] of PINS) {
      const w = buildMatchWorld(brigade(map, [{}, {}], { seed: SEED }));
      expect(w.sim.unitTypes.length).toBe(MATCHED_TYPES);
      expect(hashAfter(w, 200)).toBe(pin);
    }
  });

  it("kit 'brigade' with EQUAL non-empty claims: the roster once, one kit on both sides, one type per placement", () => {
    for (const [map] of PINS) {
      const w = buildMatchWorld(brigade(map, [LAVI1, LAVI1], { seed: SEED }));
      expect(w.sim.unitTypes.length).toBe(MATCHED_TYPES);
      expect(laviHp(w, 0)).toEqual([LAVI_ARMOUR1_HP, LAVI_ARMOUR1_HP]);
      expect(laviHp(w, 1)).toEqual([LAVI_ARMOUR1_HP, LAVI_ARMOUR1_HP]);
      // Both sides read one id -> index table, so a placement and its mirror share a type.
      for (const [id, idx] of w.typeOfBySide[0]) expect(w.typeOfBySide[1].get(id)).toBe(idx);
      expect(w.bySide[0].map((i) => w.sim.state.typeIdx[i])).toEqual(w.bySide[1].map((i) => w.sim.state.typeIdx[i]));
    }
  });

  it("two equal non-empty claims given in a different key order build one world", () => {
    const a: Tiers = { mbt_lavi: { armour: 1, firepower: 1 } };
    const b: Tiers = { mbt_lavi: { firepower: 1, armour: 1 } };
    const w = buildMatchWorld(brigade('tel_marum', [a, b], { seed: SEED }));
    expect(w.sim.unitTypes.length).toBe(MATCHED_TYPES);
  });
});
