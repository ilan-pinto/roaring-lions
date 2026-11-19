/**
 * GH-1384, the net slice, with the branch switch FLIPPED OPEN (`vi.mock` of the one module that holds it): a seat's
 * branch picks travel exactly as its tiers do (the lead's Q10, "the same as tiers (D4). Matched rooms carry
 * neither."). The routes forward them cleaned, the room stores them cleaned and cleans them again on revive, and the
 * mint writes them on every seat, the claim for a KDF seat in a brigade room and `{}` everywhere else. Literal oracles
 * throughout. `room-picks.test.ts` holds the closed build to dev.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../data/src/branches-open', () => ({ BRANCHES_OPEN: true }));

const { validateConfig } = await import('@lions/net');
const { picksOpen } = await import('./room-fields');
const { NOW, createdRoom, forwardedBodies, revived, startedConfig, storedMeta } = await import('./room-picks.test-helper');

beforeEach(() => { vi.useFakeTimers({ now: NOW }); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

const HOST = { mbt_lavi: { firepower: 3, armour: 2 }, apc_kipod: { armour: 3 } };
const HOST_PICKS = { mbt_lavi: { firepower: 2, armour: 1 }, apc_kipod: { armour: 1 }, sarim_rifles: { firepower: 1 } };
const GUEST = { mbt_lavi: { firepower: 3 }, inf_squad: { firepower: 2 } };
const GUEST_PICKS = { mbt_lavi: { firepower: 1 }, inf_squad: { firepower: 2 } };
/** What `seatPicksField` keeps of each: the Lavi's armour is not branched, sarim_rifles is not KDF, inf_squad sits at tier 2. */
const HOST_CLEAN = { mbt_lavi: { firepower: 2 }, apc_kipod: { armour: 1 } };
const GUEST_CLEAN = { mbt_lavi: { firepower: 1 } };

const picksOf = (c: { seats: readonly { picks?: unknown }[] }) => c.seats.map((s) => s.picks);

describe('the switch open: a room carries each seat\'s picks the way it carries its tiers', () => {
  it('the flip reached the Worker\'s one reader', () => {
    expect(picksOpen()).toBe(true);
  });
  it('a brigade room mints each seat\'s own picks, cleaned, beside its tiers, and the config validates', async () => {
    const { room } = await createdRoom({ mode: 'versus', kit: 'brigade', tiers: HOST, picks: HOST_PICKS, joinTiers: GUEST, joinPicks: GUEST_PICKS });
    const c = await startedConfig(room);
    expect(picksOf(c)).toEqual([HOST_CLEAN, GUEST_CLEAN]);
    expect(c.seats.map((s) => s.tiers)).toEqual([{ mbt_lavi: { firepower: 3, armour: 2 }, apc_kipod: { armour: 3 } }, { mbt_lavi: { firepower: 3 }, inf_squad: { firepower: 2 } }]);
    expect(validateConfig(JSON.parse(JSON.stringify(c)))).not.toBeNull();
  });
  it('a matched room carries neither: tiers {} and picks {} on both seats, whatever the bodies say', async () => {
    for (const kit of ['matched', undefined]) {
      const { room } = await createdRoom({ mode: 'versus', ...(kit === undefined ? {} : { kit }), tiers: HOST, picks: HOST_PICKS, joinTiers: GUEST, joinPicks: GUEST_PICKS });
      const c = await startedConfig(room);
      expect(c.seats.map((s) => [s.kit, s.tiers, s.picks])).toEqual([['matched', {}, {}], ['matched', {}, {}]]);
    }
  });
  it('a Sarim seat in a brigade room mints picks {}; its KDF opponent keeps its own', async () => {
    const { room } = await createdRoom({ mode: 'versus', matchup: 'kdf', kit: 'brigade', tiers: HOST, picks: HOST_PICKS, joinTiers: GUEST, joinPicks: GUEST_PICKS });
    const c = await startedConfig(room);
    expect(c.seats.map((s) => [s.faction, s.picks])).toEqual([['kdf', HOST_CLEAN], ['sarim', {}]]);
  });
  it('a sandbox room is always matched: picks {}', async () => {
    const { room } = await createdRoom({ kit: 'brigade', tiers: HOST, picks: HOST_PICKS, joinTiers: GUEST, joinPicks: GUEST_PICKS });
    const c = await startedConfig(room);
    expect(c.mode).toBe('sandbox');
    expect(picksOf(c)).toEqual([{}, {}]);
  });
  it('the meta stores the cleaned pair, recorded whatever the kit rule (as the claims are)', async () => {
    const { state } = await createdRoom({ mode: 'versus', kit: 'matched', tiers: HOST, picks: HOST_PICKS, joinTiers: GUEST, joinPicks: GUEST_PICKS });
    expect((await storedMeta(state)).picks).toEqual([HOST_CLEAN, GUEST_CLEAN]);
  });
  it('a room stored before the picks revives with none; stored picks are cleaned again on revive', async () => {
    const old = await createdRoom({ mode: 'versus', kit: 'brigade', tiers: HOST, picks: HOST_PICKS, joinTiers: GUEST, joinPicks: GUEST_PICKS });
    const meta = await storedMeta(old.state);
    delete meta.picks;
    await old.state.storage.put('meta', meta);
    expect(picksOf(await startedConfig(revived(old.state)))).toEqual([{}, {}]);

    const forged = await createdRoom({ mode: 'versus', kit: 'brigade', tiers: HOST, joinTiers: GUEST });
    const m2 = await storedMeta(forged.state);
    // A pick on a tier the stored claim does not hold, a non-branch leaf and a prototype key are all dropped.
    m2.picks = [JSON.parse('{"mbt_lavi":{"firepower":2},"__proto__":{"firepower":1},"apc_kipod":{"armour":3}}'), { inf_squad: { firepower: 1 }, mbt_lavi: { firepower: 2 } }];
    await forged.state.storage.put('meta', m2);
    expect(picksOf(await startedConfig(revived(forged.state)))).toEqual([{ mbt_lavi: { firepower: 2 } }, { mbt_lavi: { firepower: 2 } }]);

    const junk = await createdRoom({ mode: 'versus', kit: 'brigade', tiers: HOST, picks: HOST_PICKS, joinTiers: GUEST, joinPicks: GUEST_PICKS });
    const m3 = await storedMeta(junk.state);
    m3.picks = 'junk';
    await junk.state.storage.put('meta', m3);
    expect(picksOf(await startedConfig(revived(junk.state)))).toEqual([{}, {}]);
  });
  it('the routes forward each seat\'s picks cleaned against its own cleaned tiers, at /create and at /join', async () => {
    const got = await forwardedBodies({ mode: 'versus', kit: 'brigade', tiers: HOST, picks: HOST_PICKS }, { tiers: GUEST, picks: GUEST_PICKS });
    expect(got.create.picks).toEqual(HOST_CLEAN);
    expect(got.join.picks).toEqual(GUEST_CLEAN);
  });
});
