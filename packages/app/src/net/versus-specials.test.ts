// GH-1102: every Store special a player owns joins that player's starting force in a
// brigade room; a matched room is byte-identical; a bot seat and a Sarim seat field none;
// no special stands in a wall. Oracles are LITERALS, never read from the code under test.
import { describe, expect, it } from 'vitest';
import { units } from '@lions/data';
import { FACTION_MATCHUP_MAPS, VERSUS_FAIR_MAPS, sidesOfFactions, validateConfig, type MatchConfig } from '@lions/net';
import { DOMAIN_VEHICLE, Sim } from '@lions/sim';
import { buildMatchWorld, type MatchWorld } from './match-world';
import { versusUnitTypes } from './versus-force';
import { versusRoster } from './versus-roster';
import { ownedStoreSpecials, seatSpecials, SPECIAL_SLOTS, spawnSpecials, STORE_SPECIAL_IDS } from './versus-specials';

/** The twelve Store specials in `units` order (literal). */
const STORE = ['recon_zikit', 'heli_peten_gunship', 'inf_medic_squad', 'veh_ambulance', 'air_medevac_heli', 'mbt_lavi_camo', 'spg_long_range', 'ugv_recon_dog', 'spg_cluster', 'at_nlos_team', 'inf_grenadier', 'demo_tzav'];
/** The nine that come into a versus room (literal): the twelve less the ambulance, the medevac and the cluster SPG. */
const COMING = ['recon_zikit', 'heli_peten_gunship', 'inf_medic_squad', 'mbt_lavi_camo', 'spg_long_range', 'ugv_recon_dog', 'at_nlos_team', 'inf_grenadier', 'demo_tzav'];
/** Of the nine, the five the base roster holds out (`VERSUS_HELD_UNITS`), so a room registers them only when one comes (literal). */
const APPENDED = ['mbt_lavi_camo', 'spg_long_range', 'ugv_recon_dog', 'at_nlos_team', 'demo_tzav'];
/** `match-world.test.ts`'s literals: the matched room's type count and its tel_marum pin (seed 20260727, 200 ticks). */
const MATCHED_TYPES = 39;
const TEL_MATCHED_PIN = 2541694446;
const BEIT_MATCHED_PIN = 701662394;
const BRIGADE_CAMO_PIN = 422407671;

type Kit = 'matched' | 'brigade';
interface SeatOpts { kit?: Kit; unlocks?: string[]; kind?: 'human' | 'bot' }
function room(map: string, seats: [SeatOpts, SeatOpts], opts: { factions?: ['kdf' | 'sarim', 'kdf' | 'sarim']; seed?: number } = {}): MatchConfig {
  const factions = opts.factions ?? ['kdf', 'kdf'];
  const sides = sidesOfFactions(factions);
  const seat = (s: 0 | 1) => ({ seat: s, side: sides[s], faction: factions[s], kit: seats[s].kit ?? 'brigade', tiers: {}, unlocks: seats[s].unlocks ?? [], player: `p${s}`, callsign: `c${s}`, kind: seats[s].kind ?? 'human' });
  const c = validateConfig({ matchId: 'M', code: 'ABCDEF', seed: opts.seed ?? 1234, map, mode: 'versus', seats: [seat(0), seat(1)], pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: 'b', dataDigest: 0 });
  if (c === null) throw new Error('bad fixture');
  return c;
}
const idOf = (w: MatchWorld, i: number): string => w.sim.unitTypes[w.sim.state.typeIdx[i]].id;
const idsOf = (w: MatchWorld, side: 0 | 1): string[] => w.bySide[side].map((i) => idOf(w, i));
const hashAfter = (w: MatchWorld, ticks: number): number => {
  for (let i = 0; i < ticks; i++) w.sim.tick();
  return w.sim.hash();
};
const count = (xs: readonly string[], id: string): number => xs.filter((x) => x === id).length;

describe('the Store specials (GH-1102)', () => {
  it('are the twelve bought-only KDF units, in units order, and every one has a slot', () => {
    expect([...STORE_SPECIAL_IDS]).toEqual(STORE);
    expect(SPECIAL_SLOTS.length).toBeGreaterThanOrEqual(STORE.length);
    expect(new Set(SPECIAL_SLOTS.map(([dx, dy]) => `${dx},${dy}`)).size).toBe(SPECIAL_SLOTS.length);
  });
  it("the claim is the account's bought units that are Store specials, and nothing else", () => {
    // apc_kipod and sniper_team are bought through earned gates: not Store specials.
    expect(ownedStoreSpecials(new Set(['demo_tzav', 'apc_kipod', 'sniper_team', 'recon_zikit', 'mbt_lavi']))).toEqual(['recon_zikit', 'demo_tzav']);
    expect(ownedStoreSpecials(new Set())).toEqual([]);
  });
});

describe('seatSpecials: a seat\'s specials as the world fields them', () => {
  const seat = (over: Partial<MatchConfig['seats'][number]>) => ({ ...room('tel_marum', [{}, {}]).seats[0], ...over });
  it('a human KDF seat in a brigade room fields its Store specials in units order, less the refused three, each once', () => {
    expect(seatSpecials(seat({ unlocks: [...STORE].reverse() }))).toEqual(COMING);
    expect(seatSpecials(seat({ unlocks: ['demo_tzav', 'demo_tzav', 'mbt_lavi_camo'] }))).toEqual(['mbt_lavi_camo', 'demo_tzav']);
  });
  it('a forged id, a non-store unit and a prototype key field nothing', () => {
    expect(seatSpecials(seat({ unlocks: ['forged_super_tank', 'mbt_lavi', 'sarim_rifles', '__proto__', 'constructor'] }))).toEqual([]);
  });
  it('a matched seat, a bot seat and a Sarim seat field none, whatever their unlocks say', () => {
    expect(seatSpecials(seat({ kit: 'matched', unlocks: STORE }))).toEqual([]);
    expect(seatSpecials(seat({ kind: 'bot', unlocks: STORE }))).toEqual([]);
    expect(seatSpecials(seat({ faction: 'sarim', unlocks: STORE }))).toEqual([]);
    expect(seatSpecials(undefined)).toEqual([]);
  });
});

describe('buildMatchWorld: a brigade room fields each seat\'s owned specials', () => {
  it('a brigade room spawns each owned special once, on its owner\'s side; the friend\'s join the friend\'s force', () => {
    const w = buildMatchWorld(room('tel_marum', [{ unlocks: ['mbt_lavi_camo', 'inf_grenadier', 'spg_cluster'] }, { unlocks: ['demo_tzav'] }]));
    const s0 = idsOf(w, 0);
    const s1 = idsOf(w, 1);
    expect([count(s0, 'mbt_lavi_camo'), count(s0, 'inf_grenadier'), count(s0, 'demo_tzav'), count(s0, 'spg_cluster')]).toEqual([1, 1, 0, 0]);
    expect([count(s1, 'mbt_lavi_camo'), count(s1, 'inf_grenadier'), count(s1, 'demo_tzav')]).toEqual([0, 0, 1]);
    for (const side of [0, 1] as const) expect(w.bySide[side].every((i) => w.sim.state.side[i] === side && w.sim.state.alive[i] === 1)).toBe(true);
    expect(w.specialsBySide).toEqual([['mbt_lavi_camo', 'inf_grenadier'], ['demo_tzav']]);
    // The mesh plan draws them.
    const plan = versusUnitTypes(w.factions, w.specialsBySide);
    for (const id of ['mbt_lavi_camo', 'inf_grenadier', 'demo_tzav']) expect(plan.has(id), id).toBe(true);
  });
  it('a seat that owns every special fields the nine that may come, and the room registers the held five after the roster', () => {
    const w = buildMatchWorld(room('tel_marum', [{ unlocks: STORE }, {}]));
    expect(w.specialsBySide).toEqual([COMING, []]);
    const s0 = idsOf(w, 0);
    for (const id of COMING) expect(count(s0, id), id).toBe(1);
    for (const id of ['veh_ambulance', 'air_medevac_heli', 'spg_cluster']) expect(w.typeOf.has(id), id).toBe(false);
    expect(w.sim.unitTypes.length).toBe(MATCHED_TYPES + APPENDED.length);
    // Appended in units order, after every roster type: no roster type's index moved.
    expect(APPENDED.map((id) => w.typeOf.get(id))).toEqual([39, 40, 41, 42, 43]);
    const matched = buildMatchWorld(room('tel_marum', [{ kit: 'matched' }, { kit: 'matched' }]));
    for (const u of versusRoster()) expect(w.typeOf.get(u.id), u.id).toBe(matched.typeOf.get(u.id));
  });
  it("an appended special wears its owner's upgrade tiers, and a friend's different kit gets its own copy after it", () => {
    // demo_tzav: hull.hp 2600, armour tier 1 adds 180 (data/units/kdf/demo_tzav.json); Q16.16 literals.
    const BASE = 170393600;
    const ARMOUR1 = 182190080;
    const tzavHp = (w: MatchWorld, side: 0 | 1) => w.bySide[side].filter((i) => idOf(w, i) === 'demo_tzav').map((i) => w.sim.state.hp[i]);
    const seat = (tiers: Record<string, Record<string, number>>) => ({ unlocks: ['demo_tzav'], tiers });
    const cfg = room('tel_marum', [{}, {}]);
    const both = validateConfig({ ...cfg, seats: [{ ...cfg.seats[0], ...seat({}) }, { ...cfg.seats[1], ...seat({ demo_tzav: { armour: 1 } }) }] });
    if (both === null) throw new Error('bad fixture');
    const w = buildMatchWorld(both);
    expect([tzavHp(w, 0), tzavHp(w, 1)]).toEqual([[BASE], [ARMOUR1]]);
    // Side 0's demo_tzav first (after the 39 roster types), then side 1's kitted copy.
    expect([w.typeOfBySide[0].get('demo_tzav'), w.typeOfBySide[1].get('demo_tzav')]).toEqual([39, 40]);
    expect(w.sim.unitTypes.length).toBe(41);
    // The same kit on both seats: one type, shared.
    const same = validateConfig({ ...cfg, seats: [{ ...cfg.seats[0], ...seat({ demo_tzav: { armour: 1 } }) }, { ...cfg.seats[1], ...seat({ demo_tzav: { armour: 1 } }) }] });
    if (same === null) throw new Error('bad fixture');
    const s = buildMatchWorld(same);
    expect([tzavHp(s, 0), tzavHp(s, 1)]).toEqual([[ARMOUR1], [ARMOUR1]]);
    expect(s.sim.unitTypes.length).toBe(40);
  });
  it('the placed force keeps its entity ids, types and tiles: the specials come after everything else', () => {
    const read = (w: MatchWorld, n: number) => Array.from({ length: n }, (_, i) => [idOf(w, i), w.sim.state.posX[i], w.sim.state.posY[i], w.sim.state.facing[i]]);
    for (const factions of [['kdf', 'kdf'], ['kdf', 'sarim']] as const) {
      const base = buildMatchWorld(room('wadi_tarfan', [{ kit: 'matched' }, { kit: 'matched' }], { factions: [...factions] }));
      const w = buildMatchWorld(room('wadi_tarfan', [{ unlocks: ['mbt_lavi_camo', 'recon_zikit'] }, { unlocks: ['demo_tzav'] }], { factions: [...factions] }));
      expect(read(w, base.sim.entityCount), factions.join('/')).toEqual(read(base, base.sim.entityCount));
      expect(w.sim.entityCount - base.sim.entityCount, factions.join('/')).toBe(factions[1] === 'kdf' ? 3 : 2);
    }
  });
  it('pins the brigade world a special joins (tel_marum, seed 20260727, seat 0 brings the camo Lavi; 200 ticks)', () => {
    // NEW pin (GH-1102), no prior value: the first brigade world with a Store special in it. It moves when the
    // placement, the slot table, the registration order or the special's own data moves; the matched pin beside it must not.
    expect(hashAfter(buildMatchWorld(room('tel_marum', [{ unlocks: ['mbt_lavi_camo'] }, {}], { seed: 20260727 })), 200)).toBe(BRIGADE_CAMO_PIN);
  });
  it('two builds of one brigade config hash equal; swapping who owns the special builds a different world', () => {
    const cfg = room('tel_marum', [{ unlocks: ['mbt_lavi_camo'] }, {}], { seed: 20260727 });
    const a = hashAfter(buildMatchWorld(cfg), 200);
    expect(hashAfter(buildMatchWorld(cfg), 200)).toBe(a);
    expect(a).not.toBe(TEL_MATCHED_PIN);
    expect(hashAfter(buildMatchWorld(room('tel_marum', [{}, { unlocks: ['mbt_lavi_camo'] }], { seed: 20260727 })), 200)).not.toBe(a);
  });
});

describe('buildMatchWorld: a matched room spawns no special, and its bytes do not move', () => {
  it('a matched config whose seats carry unlocks builds the matched pins (beit, tel; 200 ticks)', () => {
    for (const [map, pin] of [['beit_sahwan_outskirts', BEIT_MATCHED_PIN], ['tel_marum', TEL_MATCHED_PIN]] as const) {
      const w = buildMatchWorld(room(map, [{ kit: 'matched', unlocks: STORE }, { kit: 'matched', unlocks: STORE }], { seed: 20260727 }));
      expect(w.specialsBySide, map).toEqual([[], []]);
      expect(w.sim.unitTypes.length, map).toBe(MATCHED_TYPES);
      for (const side of [0, 1] as const) for (const id of STORE) expect(count(idsOf(w, side), id), `${map} ${id}`).toBe(['inf_medic_squad'].includes(id) ? count(idsOf(buildMatchWorld(room(map, [{ kit: 'matched' }, { kit: 'matched' }])), side), id) : 0);
      expect(hashAfter(w, 200), map).toBe(pin);
    }
  });
  it('a brigade room where nobody brings a special builds the matched pins too', () => {
    expect(hashAfter(buildMatchWorld(room('tel_marum', [{}, {}], { seed: 20260727 })), 200)).toBe(TEL_MATCHED_PIN);
  });
});

describe('buildMatchWorld: the bot seat gets the standard force', () => {
  it('a bot seat whose config carries unlocks fields none; the human opposite keeps hers', () => {
    const w = buildMatchWorld(room('tel_marum', [{ unlocks: ['demo_tzav'] }, { kind: 'bot', unlocks: ['mbt_lavi_camo', 'demo_tzav'] }]));
    expect(w.specialsBySide).toEqual([['demo_tzav'], []]);
    expect(count(idsOf(w, 1), 'mbt_lavi_camo') + count(idsOf(w, 1), 'demo_tzav')).toBe(0);
    expect(w.typeOf.has('mbt_lavi_camo')).toBe(false);
    const botHost = buildMatchWorld(room('tel_marum', [{ kind: 'bot', unlocks: STORE }, {}]));
    expect(botHost.sim.unitTypes.length).toBe(MATCHED_TYPES);
    expect(botHost.specialsBySide).toEqual([[], []]);
  });
});

describe('spawnSpecials: never in a wall', () => {
  const footOrVehicleMask = (w: MatchWorld, i: number): Uint8Array =>
    w.sim.unitTypes[w.sim.state.typeIdx[i]].pathDomain === DOMAIN_VEHICLE ? w.sim.blockedVehicle : w.sim.blocked;
  it('on every versus map, from either end, each special stands on a tile its own mobility can stand on, and on no unit', () => {
    const maps = [...new Set([...VERSUS_FAIR_MAPS, ...FACTION_MATCHUP_MAPS])];
    for (const map of maps) {
      for (const owner of [0, 1] as const) {
        const seats: [SeatOpts, SeatOpts] = owner === 0 ? [{ unlocks: STORE }, {}] : [{}, { unlocks: STORE }];
        const w = buildMatchWorld(room(map, seats));
        const specials = w.bySide[owner].slice(-COMING.length);
        expect(specials.map((i) => idOf(w, i)), `${map} ${owner}`).toEqual(COMING);
        const tiles = new Map<number, number>();
        for (let i = 0; i < w.sim.entityCount; i++) {
          const t = (w.sim.state.posY[i] >> 16) * w.sim.width + (w.sim.state.posX[i] >> 16);
          tiles.set(t, (tiles.get(t) ?? 0) + 1);
        }
        for (const i of specials) {
          const t = (w.sim.state.posY[i] >> 16) * w.sim.width + (w.sim.state.posX[i] >> 16);
          expect(footOrVehicleMask(w, i)[t], `${map} seat ${owner}: ${idOf(w, i)} at tile ${t}`).toBe(0);
          expect(tiles.get(t), `${map} seat ${owner}: ${idOf(w, i)} shares tile ${t}`).toBe(1);
        }
      }
    }
  });
  it('a slot in a wall, or a boulder field under a vehicle, moves the special to open ground beside it', () => {
    // A 24x24 open sim, friendly anchor (12,12) facing a hostile anchor east of it: slot 0 is (-4,-6),
    // so the first special's slot tile is (8,6). Wall it, and boulder the slot of the second, a vehicle.
    const sim = new Sim({ seed: 1, width: 24, height: 24, capacity: 16 });
    const all = units as unknown as Record<string, never>;
    const typeOf = new Map<string, number>([['inf_grenadier', sim.addUnitType(all.inf_grenadier)], ['mbt_lavi_camo', sim.addUnitType(all.mbt_lavi_camo)]]);
    sim.setBlocked(8, 6, true);
    sim.setBoulder(8, 10, true); // slot 1 is (-4,-2): (8,10)
    const anchors = { friendly: [12, 12] as const, hostile: [20, 12] as const };
    const [ids] = spawnSpecials(sim, [typeOf, typeOf], anchors, ['friendly', 'hostile'], [['inf_grenadier', 'mbt_lavi_camo'], []]);
    const tileOf = (i: number): [number, number] => [sim.state.posX[i] >> 16, sim.state.posY[i] >> 16];
    expect(ids).toHaveLength(2);
    // The grenadier's slot is a wall: it stands beside it, on foot ground.
    expect(tileOf(ids[0])).not.toEqual([8, 6]);
    expect(sim.blocked[tileOf(ids[0])[1] * 24 + tileOf(ids[0])[0]]).toBe(0);
    // The camo Lavi's slot is a boulder field: a wall to a tracked hull, so it stands off it too.
    expect(tileOf(ids[1])).not.toEqual([8, 10]);
    expect(sim.blockedVehicle[tileOf(ids[1])[1] * 24 + tileOf(ids[1])[0]]).toBe(0);
    // Both one ring out: the search takes the nearest open tile, not just any.
    for (const [i, [sx, sy]] of [[ids[0], [8, 6]], [ids[1], [8, 10]]] as const) {
      const [x, y] = tileOf(i);
      expect(Math.max(Math.abs(x - sx), Math.abs(y - sy))).toBe(1);
    }
  });
});
