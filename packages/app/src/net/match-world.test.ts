import { describe, expect, it } from 'vitest';
import { doctrines, units, versusRules } from '@lions/data';
import { matchDigest, sidesOfFactions, validateConfig, type MatchConfig, type SeatConfig } from '@lions/net';
import type { MissionEvent } from '@lions/sim';
import { campOf } from './versus-force';
import { viewerSideOf } from './viewer';
import { buildMatchWorld, matchTick, seatKitTiers, tunnelRouteOf, versusUnitInfo, type MatchWorld } from './match-world';
import { versusRoster } from './versus-roster';

function config(map: string, factions: ['kdf' | 'sarim', 'kdf' | 'sarim'], seed = 1234): MatchConfig {
  // The room's own rule (LD1): the side follows the faction, the end the seat.
  const sides = sidesOfFactions(factions);
  const seat = (s: 0 | 1) => ({ seat: s, side: sides[s], faction: factions[s], kit: 'matched', tiers: {}, unlocks: [], player: `p${s}`, callsign: `c${s}`, kind: 'human' });
  const c = validateConfig({ matchId: 'M', code: 'ABCDEF', seed, map, mode: 'versus', seats: [seat(0), seat(1)], pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: 'b', dataDigest: 0 });
  if (c === null) throw new Error('bad fixture');
  return c;
}

describe('buildMatchWorld', () => {
  it('reproduces the mirror pins versus-force.test.ts holds (beit, tel; 200 ticks)', () => {
    // LITERALS (an oracle that imports its expectation from the code under test
    // cannot fail, CLAUDE.md). seed 20260727, 200 ticks, KDF against KDF.
    // tel_marum: 1524988923 is versus-force.test.ts's own pin. Was 1260439781: re-pinned
    // 2026-10-22 when its versus seat 0 moved to (24,46) (`versus-seats.ts`, the lead's ruling)
    // -- the map has no tunnels, so the helper's world and the browser's agree.
    // beit_sahwan_outskirts: versus-force.test.ts pins 3296182002 through
    // `versus-world.test-helper.ts`, which registers NO tunnels. The browser's boot
    // (`bootBattlefield`) registers the map's four routes, and tunnel state is in the
    // hash, so the browser's world -- and so this builder's -- hashes differently.
    // The browser path is the truth; that is its own pin. Registering the prepass's
    // types instead of the raw units moves nothing (checked both ways); the tunnels
    // are the whole difference (drop the loop and this reads 3296182002 again).
    // beit re-pinned 2026-10-22 for its versus seats (`versus-seats.ts`, seat 1 at (40,24)
    // rather than town_center): was 3043363756.
    for (const [map, pin] of [['beit_sahwan_outskirts', 1108074073], ['tel_marum', 1524988923]] as const) {
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
  it('spawns each side its faction force: the KDF on side 0 whichever seat hosts (LD1)', () => {
    for (const factions of [['sarim', 'kdf'], ['kdf', 'sarim']] as const) {
      const w = buildMatchWorld(config('tel_marum', [...factions]));
      const types = (ids: number[]) => new Set(ids.map((i) => w.sim.unitTypes[w.sim.state.typeIdx[i]].id));
      expect(w.factions).toEqual(['kdf', 'sarim']);
      expect(types(w.bySide[0]).has('mbt_lavi')).toBe(true);
      expect(types(w.bySide[1]).has('atgm_cell')).toBe(true);
      for (const side of [0, 1] as const) expect(w.bySide[side].every((i) => w.sim.state.side[i] === side)).toBe(true);
    }
  });
  it('host end follows the seat: a Sarim host is side 1 on the friendly anchor, with its camera there (LD1)', () => {
    for (const map of ['tel_marum', 'wadi_tarfan']) {
      const cfg = config(map, ['sarim', 'kdf']);
      const w = buildMatchWorld(cfg);
      const near = (side: 0 | 1, [ax, ay]: readonly [number, number]) => w.bySide[side].every((i) =>
        Math.max(Math.abs(w.sim.state.posX[i] / 65536 - ax), Math.abs(w.sim.state.posY[i] / 65536 - ay)) <= 11);
      // Within the force's own spread of its anchor (offsets reach 9 tiles along the line, plus placeOnOpen's search).
      expect(w.endOfSide).toEqual(['hostile', 'friendly']);
      expect(near(1, w.anchors.friendly), `${map}: Sarim side 1 on the friendly anchor`).toBe(true);
      expect(near(0, w.anchors.hostile), `${map}: KDF side 0 on the hostile anchor`).toBe(true);
      // The force CENTRE, tighter than the spread: within 3 tiles of its end's anchor.
      const centre = (side: 0 | 1) => {
        const ids = w.bySide[side];
        return [ids.reduce((a, i) => a + w.sim.state.posX[i], 0) / ids.length / 65536, ids.reduce((a, i) => a + w.sim.state.posY[i], 0) / ids.length / 65536];
      };
      const [fx, fy] = w.anchors.friendly;
      const [c1x, c1y] = centre(1);
      expect(Math.max(Math.abs(c1x - fx), Math.abs(c1y - fy)), `${map}: Sarim centre`).toBeLessThanOrEqual(3);
      // The host's camera (main.ts): its viewer side's end.
      expect(campOf(w.anchors, w.endOfSide[viewerSideOf(cfg, 0)])).toEqual(w.anchors.friendly);
      expect(campOf(w.anchors, w.endOfSide[viewerSideOf(cfg, 1)])).toEqual(w.anchors.hostile);
    }
  });
  it('a KDF host and a mirror keep side 0 on the friendly end', () => {
    expect(buildMatchWorld(config('tel_marum', ['kdf', 'sarim'])).endOfSide).toEqual(['friendly', 'hostile']);
    expect(buildMatchWorld(config('tel_marum', ['kdf', 'kdf'])).endOfSide).toEqual(['friendly', 'hostile']);
  });
  it('the side swap moves only the side labels: a Sarim host room spawns the KDF-host room\'s ids, types and tiles', () => {
    const read = (w: MatchWorld) => Array.from({ length: w.sim.entityCount }, (_, i) => [
      w.sim.unitTypes[w.sim.state.typeIdx[i]].id, w.sim.state.posX[i], w.sim.state.posY[i], w.sim.state.facing[i],
    ]);
    // Before LD1 a Sarim host was Sarim on side 0 at the friendly end: that world is
    // a config with seat 0 on side 0 playing Sarim, which `buildMatchWorld` still builds.
    const before = validateConfig({ ...config('tel_marum', ['sarim', 'kdf']), seats: [
      { ...config('tel_marum', ['sarim', 'kdf']).seats[0], side: 0 }, { ...config('tel_marum', ['sarim', 'kdf']).seats[1], side: 1 },
    ] });
    if (before === null) throw new Error('bad fixture');
    const old = buildMatchWorld(before);
    const now = buildMatchWorld(config('tel_marum', ['sarim', 'kdf']));
    expect(read(now)).toEqual(read(old));
    // The friendly end's force came first: Sarim, on side 1 now.
    expect(now.bySide[1][0]).toBe(0);
    expect(old.bySide[0][0]).toBe(0);
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
const MATCHED_TYPES = 36;
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

describe('the versus hold (GH-698)', () => {
  it('a room registers no held unit, on either side, whatever the kit', () => {
    const w = buildMatchWorld(config('wadi_tarfan', ['kdf', 'kdf']));
    expect(w.typeOf.has('heli_yanshuf')).toBe(false);
    expect(w.typeOfBySide[1].has('heli_yanshuf')).toBe(false);
    expect(w.sim.airCarrierLive).toBe(false);
  });
});

describe("seatKitTiers: a seat's claim as the world reads it", () => {
  const seat = (tiers: unknown, over: Partial<SeatConfig> = {}): SeatConfig =>
    ({ seat: 1, side: 1, faction: 'kdf', kit: 'brigade', tiers, unlocks: [], player: 'p', callsign: 'c', kind: 'human', ...over }) as SeatConfig;

  it('drops a claim on a unit the versus room holds out (GH-698, VERSUS_HELD_UNITS)', () => {
    expect(seatKitTiers(seat({ heli_yanshuf: { armour: 3 }, mbt_lavi: { armour: 1 } }))).toEqual({ mbt_lavi: { armour: 1 } });
  });

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
  const PINS = [['beit_sahwan_outskirts', 1108074073], ['tel_marum', 1524988923]] as const;
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

// N3 Task 3: a KDF-v-Sarim room boots the skirmish economy; a mirror room boots none.
describe('the economy runtime (N3 Task 3)', () => {
  const MATCHUP_MAPS = ['tel_marum', 'wadi_tarfan'] as const;
  /** Every match-world step through the ONE shared tick body, collecting the runtime's events. */
  const run = (w: MatchWorld, n: number, into: MissionEvent[] = []): MissionEvent[] => {
    for (let i = 0; i < n; i++) into.push(...matchTick(w).mission);
    return into;
  };

  it('a mirror room has no runtime', () => {
    for (const map of ['beit_sahwan_outskirts', ...MATCHUP_MAPS]) {
      expect(buildMatchWorld(config(map, ['kdf', 'kdf'])).runtime, map).toBeNull();
    }
  });

  it('a KDF-v-Sarim room, either host: one living line per side, each at its own end\'s camp, and each side its faction\'s purse', () => {
    for (const map of MATCHUP_MAPS) {
      for (const factions of [['kdf', 'sarim'], ['sarim', 'kdf']] as const) {
        const w = buildMatchWorld(config(map, [...factions]));
        const rt = w.runtime;
        if (rt === null) throw new Error(`${map}: no runtime`);
        // By side, and so by faction (LD1: KDF is side 0): never the seats' order.
        expect(rt.logisticsOf(0), `${map} ${factions.join('/')}`).toBe(doctrines.kdf.budget.logistics_start);
        expect(rt.logisticsOf(1), `${map} ${factions.join('/')}`).toBe(doctrines.sarim.budget.logistics_start);
        for (const side of [0, 1] as const) {
          const lines = rt.productionLines(side);
          expect(lines).toHaveLength(1);
          expect(lines[0].alive).toBe(true);
          expect(lines[0].anchor).toBeGreaterThanOrEqual(0);
          // The camp of the end this side stands at, from the rules file.
          const [cx, cy] = versusRules[map].ends[w.endOfSide[side]].camp.at;
          const [ex, ey] = lines[0].exit.map((v) => v / 65536);
          expect(Math.max(Math.abs(ex - cx), Math.abs(ey - cy)), `${map} side ${side} exit by its camp`).toBeLessThanOrEqual(4);
        }
      }
    }
  });

  it('versusUnitInfo: the asking side\'s menu only, its cost from the unit JSON, no unlock and no intel', () => {
    const info = versusUnitInfo([doctrines.kdf.menu, doctrines.sarim.menu]);
    expect(info('mbt_lavi', 0)).toEqual({ logistics: units.mbt_lavi.cost.logistics, buildTimeS: expect.any(Number), population: expect.any(Number) });
    expect(info('mbt_lavi', 1)).toBeNull();
    expect(info('atgm_cell', 1)).not.toBeNull();
    expect(info('atgm_cell', 0)).toBeNull();
    expect(info('no_such_unit', 0)).toBeNull();
    // A gated KDF unit (Conduct 90 in single-player) is simply buildable here: the menu is the gate.
    const lavi = info('mbt_lavi', 0);
    expect(lavi !== null && !('unlock' in lavi) && !('intel' in lavi)).toBe(true);
  });

  it('matchTick drains the commands the frame set aside before the tick runs', () => {
    const w = buildMatchWorld(config('tel_marum', ['kdf', 'sarim']));
    const rt = w.runtime;
    if (rt === null) throw new Error('no runtime');
    // Straight into the sim's set-aside list (the wire still drops `build` in versus).
    w.sim.queueCommand({ kind: 'build', side: 0, unit: 'inf_squad', line: 0 });
    matchTick(w);
    expect(rt.productionLines(0)[0].current).toBe('inf_squad');
    expect(rt.logisticsOf(0)).toBe(doctrines.kdf.budget.logistics_start - units.inf_squad.cost.logistics);
  });

  it('build and lose: the built KDF unit dies, the placed force lives, and the room keeps producing', () => {
    const w = buildMatchWorld(config('tel_marum', ['kdf', 'sarim']));
    const rt = w.runtime;
    if (rt === null) throw new Error('no runtime');
    const events: MissionEvent[] = [];
    const first = w.sim.entityCount;
    expect(rt.requestBuild('inf_squad', 0, 0)).toBe(true);
    run(w, 1200, events);
    const built: number[] = [];
    for (let i = first; i < w.sim.entityCount; i++) if (w.sim.state.side[i] === 0) built.push(i);
    expect(built.length).toBeGreaterThan(0);
    for (const id of built) w.sim.debugKill(id);
    run(w, 1, events);
    // Without `checkEnd`'s guard every `playerIds` entry is dead and the runtime ends a defeat here.
    expect(rt.result).toBe('ongoing');
    expect(events.some((e) => e.kind === 'missionEnd')).toBe(false);
    expect(w.bySide[0].some((id) => w.sim.state.alive[id] === 1)).toBe(true);
    const builtBefore = events.filter((e) => e.kind === 'built').length;
    expect(rt.requestBuild('inf_squad', 0, 0)).toBe(true);
    run(w, 1200, events);
    expect(events.filter((e) => e.kind === 'built').length).toBe(builtBefore + 1);
    expect(rt.result).toBe('ongoing');
  }, 60_000);

  it('never ends: 30,000 ticks (the 25-minute cap) with no orders, and a build at tick 29,000 starts', () => {
    const w = buildMatchWorld(config('wadi_tarfan', ['kdf', 'sarim']));
    const rt = w.runtime;
    if (rt === null) throw new Error('no runtime');
    const events = run(w, 29_000);
    expect(rt.result).toBe('ongoing');
    expect(rt.requestBuild('inf_squad', 0, 0)).toBe(true);
    expect(rt.requestBuild('atgm_cell', 0, 1)).toBe(true);
    run(w, 1000, events);
    expect(w.sim.tickCount).toBe(30_000);
    expect(rt.result).toBe('ongoing');
    expect(events.some((e) => e.kind === 'missionEnd')).toBe(false);
    expect(events.filter((e) => e.kind === 'built').map((e) => (e.kind === 'built' ? e.side : -1)).sort()).toEqual([0, 1]);
  }, 120_000);

  it('VERSUS_ECONOMY_PINS (born N3 Task 3): a KDF-host room on each matchup map, 200 ticks', () => {
    // LITERALS (CLAUDE.md). seed 20260727, KDF host, 200 ticks of `matchTick` with no orders,
    // matchDigest(sim.hash(), runtime.digest(), 0).
    // Re-pinned 22 Oct for GH-681 T3: the Sarim end's routes register in an economy room and route state
    // is hashed. Was -193936706 / -1815401533.
    // Re-pinned with the lead's start purses KDF 1500 / Sarim 2400 (22 Oct; db2803f0): the purse is folded by
    // runtime.digest(). Was -1014683486 / -1434364569.
    const VERSUS_ECONOMY_PINS = [['tel_marum', -568662276], ['wadi_tarfan', -274469750]] as const;
    for (const [map, pin] of VERSUS_ECONOMY_PINS) {
      const w = buildMatchWorld(config(map, ['kdf', 'sarim'], 20260727));
      run(w, 200);
      expect(matchDigest(w.sim.hash(), w.runtime?.digest() ?? NaN, 0), map).toBe(pin);
    }
  });
});

describe('the Sarim seat\'s routes (GH-681, T3)', () => {
  // [map, host factions, the END the Sarim side stands at, that end's route ids, their capacity (LITERALS)]
  const CASES = [
    ['tel_marum', ['kdf', 'sarim'], 'hostile', ['tm_n_west', 'tm_n_east'], 4],
    ['tel_marum', ['sarim', 'kdf'], 'friendly', ['tm_s_west', 'tm_s_east'], 3],
    ['wadi_tarfan', ['kdf', 'sarim'], 'hostile', ['wt_h_south', 'wt_h_east'], 4],
    ['wadi_tarfan', ['sarim', 'kdf'], 'friendly', ['wt_f_north', 'wt_f_west'], 4],
  ] as const;
  it.each(CASES)('%s, host %j: exactly the Sarim end\'s routes, owned by the Sarim side, pre-dug, at the capacity the file authors', (map, factions, end, ids, capacity) => {
    const w = buildMatchWorld(config(map, [factions[0], factions[1]], 7));
    const sarimSide = w.factions[0] === 'sarim' ? 0 : 1;
    expect(w.endOfSide[sarimSide]).toBe(end);
    expect(w.sim.tunnelCount).toBe(ids.length);
    expect(w.map.tunnels.map((t) => t.id)).toEqual([...ids]);
    for (let r = 0; r < w.sim.tunnelCount; r++) {
      expect(w.map.tunnels[r].id, `positional ${r}`).toBe(ids[r]);
      expect(w.sim.tunnelOwner(r)).toBe(sarimSide);
      expect(w.sim.tunnelCapacity(r)).toBe(capacity);
    }
    // Pre-dug: the vent is open from tick 0.
    for (let r = 0; r < w.sim.tunnelCount; r++) expect(w.sim.tnVentOpen[r]).toBe(1);
  });
  it('a mirror room registers none, and the shared parse is not mutated', () => {
    for (const map of ['tel_marum', 'wadi_tarfan']) {
      const w = buildMatchWorld(config(map, ['kdf', 'kdf'], 7));
      expect(w.sim.tunnelCount).toBe(0);
      expect(w.map.tunnels).toEqual([]);
    }
    // A Sarim-v-Sarim room is no economy room either: nothing registers.
    expect(buildMatchWorld(config('tel_marum', ['sarim', 'sarim'], 7)).sim.tunnelCount).toBe(0);
    const sarim = buildMatchWorld(config('tel_marum', ['kdf', 'sarim'], 7));
    expect(sarim.map.tunnels).toHaveLength(2);
    expect(buildMatchWorld(config('tel_marum', ['kdf', 'kdf'], 7)).map.tunnels).toHaveLength(0);
  });
  it('tunnelRouteOf carries owner and capacity when the parse has them, and nothing when it has not', () => {
    const base = { id: 'r', points: [[1, 1], [2, 2]] as [number, number][], digTilesPerS: 1, preDug: true };
    expect(tunnelRouteOf({ ...base, side: 1, capacity: 3 })).toEqual({ id: 'r', points: base.points, dig_tiles_per_s: 1, pre_dug: true, side: 1, capacity: 3 });
    expect(Object.keys(tunnelRouteOf(base)).sort()).toEqual(['dig_tiles_per_s', 'id', 'points', 'pre_dug']);
  });
  it('the economy runtime is handed the same array, in the sim\'s order', () => {
    const w = buildMatchWorld(config('tel_marum', ['kdf', 'sarim'], 7));
    const ctx = (w.runtime as unknown as { ctx: { tunnels?: { id: string }[] } }).ctx;
    expect(ctx.tunnels?.map((t) => t.id)).toEqual(w.map.tunnels.map((t) => t.id));
  });
});

describe('doctrine menus and the room roster (Task 3 review, M-a)', () => {
  it('every doctrine menu id is a unit a room registers, so a build can never reach a missing type', () => {
    const ids = new Set(versusRoster().map((u) => u.id));
    for (const d of Object.values(doctrines)) for (const id of d.menu) expect(ids.has(id), id).toBe(true);
  });
  it('a held unit on a menu is answered null, not passed on', () => {
    const held = units.mbt_lavi_camo === undefined ? null : 'mbt_lavi_camo';
    if (held === null) return;
    expect(versusUnitInfo([[held], []])(held, 0)).toBeNull();
  });
});

