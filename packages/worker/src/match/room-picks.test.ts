/**
 * GH-1384, the net slice, with the branch switch CLOSED (as shipped): a room's branch picks. The cleaner
 * (`seatPicksField`) is pure and runs whatever the switch; everything a room path WRITES is dev's bytes while closed:
 * the routes forward no `picks` to a room, the room stores none in its meta and mints no `picks` key, whatever the
 * bodies claim. Oracles are literals: dev's `SeatConfig` keys, and the meta keys dev stores. The open behaviour is
 * `room-picks-open.test.ts`'s.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BRANCHES_OPEN } from '@lions/data';
import { KIT_TRACKS } from './kit-tracks';
import { picksOpen, seatPicksField, seatTiersField } from './room-fields';
import { NOW, createdRoom, forwardedBodies, startedConfig, storedMeta } from './room-picks.test-helper';

beforeEach(() => { vi.useFakeTimers({ now: NOW }); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

/** Every key a dev SeatConfig carries, in dev's order (`mintConfig` at origin/dev 4a28bc105). */
const DEV_SEAT_KEYS = ['seat', 'side', 'faction', 'kit', 'tiers', 'unlocks', 'player', 'callsign', 'kind'];
/** Every key dev stores in a versus room's meta (`/create`, then `/join`), sorted. */
const DEV_META_KEYS = ['botModels', 'build', 'callsigns', 'claims', 'kinds', 'kit', 'map', 'members', 'mode', 'owned', 'pace', 'seat1Reserved', 'seed', 'tokens'];

const LAVI3 = { mbt_lavi: { firepower: 3, armour: 2 } };
const LAVI_B2 = { mbt_lavi: { firepower: 2, armour: 1 } };

describe('seatPicksField: a seat\'s picks, cleaned against the branched tracks and its own cleaned tiers', () => {
  const clean = (picks: unknown, tiers: unknown) => seatPicksField(picks, seatTiersField(tiers));
  it('keeps a 1 or a 2 on a branched track held at its last tier, per (unit, track)', () => {
    expect(clean({ mbt_lavi: { firepower: 2 } }, LAVI3)).toEqual({ mbt_lavi: { firepower: 2 } });
    expect(clean({ mbt_lavi: { firepower: 1 }, apc_kipod: { armour: 2 } }, { ...LAVI3, apc_kipod: { armour: 3 } })).toEqual({ mbt_lavi: { firepower: 1 }, apc_kipod: { armour: 2 } });
  });
  it('drops a pick below the branched tier, on an unbranched track, on a non-KDF or unknown id, and any other leaf', () => {
    expect(clean({ mbt_lavi: { firepower: 2 } }, { mbt_lavi: { firepower: 2 } })).toEqual({});
    expect(clean({ mbt_lavi: { firepower: 2 } }, {})).toEqual({});
    expect(clean({ mbt_lavi: { armour: 2 } }, { mbt_lavi: { armour: 3 } })).toEqual({});           // the Lavi's armour is not branched
    expect(clean({ sarim_rifles: { firepower: 1 }, no_such: { firepower: 1 } }, LAVI3)).toEqual({});
    for (const leaf of [0, 3, 1.5, '1', null, true, [1]]) expect(clean({ mbt_lavi: { firepower: leaf } }, LAVI3), String(leaf)).toEqual({});
    expect(clean('junk', LAVI3)).toEqual({});
    expect(clean([{ mbt_lavi: { firepower: 1 } }], LAVI3)).toEqual({});
    expect(clean({ mbt_lavi: 2 }, LAVI3)).toEqual({});
  });
  it('a tier clamped DOWN to the last tier still carries its pick (the tier is cleaned first, then the pick against it)', () => {
    expect(clean({ mbt_lavi: { firepower: 2 } }, { mbt_lavi: { firepower: 99 } })).toEqual({ mbt_lavi: { firepower: 2 } });
    expect(KIT_TRACKS.mbt_lavi.firepower).toBe(3);
  });
  it('reads own data properties only: no prototype key, no inherited name, no getter', () => {
    expect(clean(JSON.parse('{"__proto__":{"firepower":1}}'), LAVI3)).toEqual({});
    expect(clean(Object.create({ mbt_lavi: { firepower: 1 } }) as unknown, LAVI3)).toEqual({});
    expect(clean({ mbt_lavi: Object.create({ firepower: 1 }) as unknown }, LAVI3)).toEqual({});
    let reads = 0;
    expect(clean({ mbt_lavi: { get firepower() { reads++; return 1; } } }, LAVI3)).toEqual({});
    expect(reads).toBe(0);
    const out = clean({ mbt_lavi: { firepower: 1 } }, LAVI3);
    expect(Object.getPrototypeOf(out)).toBeNull();
    expect(Object.getPrototypeOf(out.mbt_lavi)).toBeNull();
  });
});

describe('the switch closed: every room path writes dev\'s bytes, whatever the bodies claim', () => {
  it('the switch is closed here, and the Worker reads it through picksOpen', () => {
    expect(BRANCHES_OPEN).toBe(false);
    expect(picksOpen()).toBe(false);
  });
  it('a brigade room minted from two bodies with picks carries no `picks` key on either seat: dev\'s SeatConfig', async () => {
    const { room } = await createdRoom({ mode: 'versus', kit: 'brigade', tiers: LAVI3, picks: { mbt_lavi: { firepower: 2 } }, joinTiers: LAVI3, joinPicks: { mbt_lavi: { firepower: 1 } } });
    const c = await startedConfig(room);
    expect(c.seats.map((s) => Object.keys(s))).toEqual([DEV_SEAT_KEYS, DEV_SEAT_KEYS]);
    expect(c.seats.map((s) => s.tiers)).toEqual([{ mbt_lavi: { firepower: 3, armour: 2 } }, { mbt_lavi: { firepower: 3, armour: 2 } }]);
  });
  it('...and stores no `picks` in its meta, at /create or at /join: dev\'s keys', async () => {
    const { state } = await createdRoom({ mode: 'versus', kit: 'brigade', tiers: LAVI3, picks: { mbt_lavi: { firepower: 2 } }, joinTiers: LAVI_B2, joinPicks: { mbt_lavi: { firepower: 1 } } });
    expect(Object.keys(await storedMeta(state)).sort()).toEqual(DEV_META_KEYS);
  });
  it('the routes forward no `picks` to the room at /create or at /join', async () => {
    const got = await forwardedBodies({ mode: 'versus', kit: 'brigade', tiers: LAVI3, picks: { mbt_lavi: { firepower: 2 } } }, { tiers: LAVI3, picks: { mbt_lavi: { firepower: 1 } } });
    expect(Object.keys(got.create)).not.toContain('picks');
    expect(Object.keys(got.join)).not.toContain('picks');
    // The claim they DO forward is today's, so the bodies really were read.
    expect(got.create.tiers).toEqual({ mbt_lavi: { firepower: 3, armour: 2 } });
    expect(got.join.tiers).toEqual({ mbt_lavi: { firepower: 3, armour: 2 } });
  });
});
