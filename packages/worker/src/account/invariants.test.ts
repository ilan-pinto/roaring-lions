/**
 * The A2 invariants under random play (GH-1075 A2-8, A2-21). A seeded generator drives every A2 write route and the
 * invariants are checked after EVERY op, not at the end: the coin journal balances (`wallet.free` is the sum of its
 * `free_delta`), the free coins credited since the last `reset` never pass the 925 ceiling, and `earn_lifetime` never
 * goes down. A red run prints its seed and op list, so it replays.
 */
import { emptyAccount, parseWorld, sha256Hex, worldMissionIds } from '@lions/economy';
import { coupons, world } from '@lions/data';
import { describe, expect, it } from 'vitest';
import { handleAccount } from './routes';
import { accountHarness, seedWalletMember } from './test-kit';

const DAY = 86_400_000;
const T0 = 20_000 * DAY + 3_600_000;
const ids = worldMissionIds(parseWorld(world));
const CODE = 'TEST-CODE';
const TABLE = coupons.map((c) => ({ ...c, sha256: sha256Hex(CODE) }));
const COIN_ID = 'lead_roar_coins_100k';
const CEILING = 925;
const FLOORS = Object.fromEntries(ids.map((id) => [id, 1]));
const RICH = { coins: { free: 1_000_000, paid: 0 } };

/** A 32-bit LCG (Numerical Recipes constants). Never Math.random. */
function lcg(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 4_294_967_296;
  };
}

const ledgerOf = (wins: [string, number][]): Record<string, unknown> => ({
  'campaign.completed_missions': wins.map(([id]) => id),
  'campaign.mission_results': Object.fromEntries(wins.map(([id, stars]) => [id, { stars, roe: 0, ticks: 0, lost: 0 }])),
});
const FULL: [string, number][] = ids.map((id) => [id, 3]);
const FULL_EARN = { welcomed: true, campaignDone: true, backfilled: false, missions: Object.fromEntries(ids.map((id) => [id, { won: true, stars: 3 }])) };

type Kind = 'victory' | 'spend' | 'coupon' | 'reset' | 'claim' | 'campaign';
const KINDS: Kind[] = ['victory', 'victory', 'victory', 'spend', 'coupon', 'reset', 'claim', 'campaign'];

const opId = (n: number): string => `${String(n).padStart(8, '0')}-8888-4888-8888-888888888888`;
const dev = (n: number): string => `dddddddd-${String(n).padStart(4, '0')}-4ddd-8ddd-dddddddddddd`;

interface Landed { kind: Kind; status: number; paid: number }
interface Record_ { missions: Record<string, { won: boolean; stars: number }>; welcomed: boolean; campaignDone: boolean }

/** Runs `n` ops of seed `seed`; checks the invariants after each; returns what landed. Throws with the op list. */
async function play(seed: number, n: number, check: { journal: boolean; bound: boolean }) {
  const rand = lcg(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
  const clock = { t: T0 };
  const h = accountHarness({
    now: T0,
    handler: (req, env, at) => handleAccount(req, env, clock.t || at, { fetch: async () => new Response('no', { status: 500 }), minWinSeconds: FLOORS, coupons: TABLE }),
  });
  const { cookie } = await seedWalletMember(h.db, 'm1', T0);
  const q = h.db;
  const post = (route: string, body: object) => h.call('POST', `/api/account/${route}`, { cookie, body });
  let seq = 1;
  const log: string[] = [];
  const landed: Landed[] = [];
  let lifetime: Record_ = { missions: {}, welcomed: false, campaignDone: false };
  let maxCredited = 0;

  const revisionOf = async (): Promise<number> => (await q.prepare('SELECT revision FROM campaign_state').first<{ revision: number }>())?.revision ?? 0;

  async function one(kind: Kind): Promise<Landed> {
    if (kind === 'victory') {
      const mission = pick(ids);
      const stars = 1 + Math.floor(rand() * 3);
      const startOp = opId(seq++);
      const withStart = rand() < 0.85;
      if (withStart) await post('mission/start', { op_id: startOp, missionId: mission });
      clock.t += 2000;
      const sendCampaign = rand() < 0.3;
      const wins: [string, number][] = rand() < 0.2 ? FULL : ids.filter(() => rand() < 0.4).map((id) => [id, 1 + Math.floor(rand() * 3)] as [string, number]);
      log.push(`victory ${mission} stars=${stars} start=${withStart} campaign=${sendCampaign ? wins.length : 'null'}`);
      const r = await post('victory', {
        op_id: opId(seq++), missionId: mission, stars, start: withStart ? startOp : null, base: rand() < 0.8 ? await revisionOf() : 0,
        campaign: sendCampaign ? { ledger: ledgerOf(wins), brigade: emptyAccount(), tutorialDone: false } : null,
      });
      const b = (await r.json()) as { coins?: number };
      return { kind, status: r.status, paid: b.coins ?? 0 };
    }
    if (kind === 'spend') {
      const body = pick([
        { item: 'unit', unitId: 'dozer_d9' }, { item: 'unit', unitId: 'demo_squad' }, { item: 'unit', unitId: 'sniper_team' },
        { item: 'tier', unitId: 'dozer_d9', track: 'armour', tier: 1 },
      ]);
      log.push(`spend ${JSON.stringify(body)}`);
      const r = await post('spend', { op_id: opId(seq++), ...body });
      return { kind, status: r.status, paid: 0 };
    }
    if (kind === 'coupon') {
      log.push('coupon');
      const r = await post('coupon', { op_id: opId(seq++), code: CODE });
      return { kind, status: r.status, paid: 0 };
    }
    if (kind === 'reset') {
      log.push('reset');
      const r = await post('reset-free', { op_id: opId(seq++) });
      return { kind, status: r.status, paid: 0 };
    }
    if (kind === 'claim') {
      // Device 1 always carries the full ledger; 2 a random partial one; 3 a coupon and little else.
      const d = 1 + Math.floor(rand() * 3);
      const partial = ids.filter(() => rand() < 0.5).map((id) => [id, 1 + Math.floor(rand() * 3)] as [string, number]);
      const body = d === 1
        ? { campaign: { ledger: ledgerOf(FULL), brigade: emptyAccount(), tutorialDone: false }, wallet: { ...RICH, earn: FULL_EARN }, coupons: [] as string[] }
        : d === 2
          ? { campaign: { ledger: ledgerOf(partial), brigade: emptyAccount(), tutorialDone: false }, wallet: RICH, coupons: [] as string[] }
          : { campaign: null, wallet: RICH, coupons: [COIN_ID] };
      log.push(`claim device=${d}`);
      const r = await post('claim', { op_id: opId(seq++), device_id: dev(d), slots: [], ...body });
      const b = (await r.json()) as { coins?: number };
      return { kind, status: r.status, paid: b.coins ?? 0 };
    }
    const wins = ids.filter(() => rand() < 0.5).map((id) => [id, 1 + Math.floor(rand() * 3)] as [string, number]);
    log.push(`campaign wins=${wins.length}`);
    const r = await h.call('PUT', '/api/account/campaign', {
      cookie, body: { op_id: opId(seq++), base: rand() < 0.8 ? await revisionOf() : 0, ledger: ledgerOf(wins), brigade: emptyAccount(), tutorialDone: false },
    });
    return { kind, status: r.status, paid: 0 };
  }

  async function checks(): Promise<void> {
    const w = await q.prepare('SELECT free, earn_lifetime AS e FROM wallet').first<{ free: number; e: string }>();
    if (check.journal) {
      const sum = (await q.prepare('SELECT COALESCE(SUM(free_delta), 0) AS s FROM coin_journal').first<{ s: number }>())?.s ?? -1;
      expect(w?.free, 'the journal balances').toBe(sum);
    }
    const now = JSON.parse(w?.e ?? '{}') as Record_;
    if (check.bound) {
      expect(now.welcomed || !lifetime.welcomed, 'earn_lifetime never decreases: welcomed').toBe(true);
      expect(now.campaignDone || !lifetime.campaignDone, 'earn_lifetime never decreases: campaignDone').toBe(true);
      for (const [id, m] of Object.entries(lifetime.missions)) {
        const p = now.missions[id];
        expect(p?.won === true || !m.won, `earn_lifetime never decreases: ${id} won`).toBe(true);
        expect(p?.stars ?? 0, `earn_lifetime never decreases: ${id} stars`).toBeGreaterThanOrEqual(m.stars);
      }
      lifetime = now;
      // Free coins credited since the last reset by earn, backfill and claim, less the coupon coins a claim carried.
      const credited = (await q.prepare(
        `SELECT COALESCE(SUM(free_delta - COALESCE(json_extract(detail, '$.couponCoins'), 0)), 0) AS s
         FROM coin_journal WHERE member_id = 'm1' AND kind IN ('earn', 'backfill', 'claim')
           AND id > COALESCE((SELECT MAX(id) FROM coin_journal WHERE member_id = 'm1' AND kind = 'reset'), 0)`,
      ).first<{ s: number }>())?.s ?? -1;
      maxCredited = Math.max(maxCredited, credited);
      expect(credited, 'free coins credited since the last reset stay within the 925 ceiling').toBeLessThanOrEqual(CEILING);
    }
  }

  try {
    for (let i = 0; i < n; i++) {
      if (i > 0 && i % 40 === 0) clock.t += DAY;
      clock.t += 5000;
      const r = await one(pick(KINDS));
      landed.push(r);
      await checks();
    }
  } catch (e) {
    throw new Error(`seed ${seed} failed after ${log.length} ops:\n${log.map((l, i) => `  ${i + 1}. ${l}`).join('\n')}\n${e instanceof Error ? e.message : String(e)}`, { cause: e });
  }
  return { landed, maxCredited };
}

describe('invariants under random play', () => {
  it('the_journal_balances (A2-8): after every one of 200 ops, wallet.free is the journal sum, and every kind of op landed', async () => {
    const { landed } = await play(8, 200, { journal: true, bound: false });
    for (const kind of ['victory', 'spend', 'coupon', 'reset', 'claim', 'campaign'] as Kind[]) {
      expect(landed.some((l) => l.kind === kind && l.status === 200), `a ${kind} landed with 200`).toBe(true);
    }
    expect(landed.some((l) => l.kind === 'victory' && l.paid > 0), 'a victory paid').toBe(true);
    expect(landed.some((l) => l.kind === 'claim' && l.paid > 0), 'a claim paid').toBe(true);
    // The day budgets did not end the run: the 400-op budget never refused anything, and a claim was refused only
    // because five had already been made that day (a day is 40 ops).
    expect(landed.filter((l) => l.kind !== 'claim' && l.status === 429)).toEqual([]);
    for (let day = 0; day < 5; day++) {
      const claims = landed.slice(day * 40, day * 40 + 40).filter((l) => l.kind === 'claim');
      expect(claims.filter((l) => l.status === 429).length).toBe(Math.max(0, claims.length - 5));
    }
  }, 120_000);

  it('the_bound_holds (A2-21): over 50 seeds of 60 ops, 925 is never passed and earn_lifetime never decreases', async () => {
    let reached = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const { maxCredited } = await play(seed, 60, { journal: true, bound: true });
      reached = Math.max(reached, maxCredited);
    }
    // The full-ledger device gets there: the bound is met, not only approached.
    expect(reached).toBe(CEILING);
  }, 300_000);
});
