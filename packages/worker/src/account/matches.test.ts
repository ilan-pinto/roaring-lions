import { describe, expect, it } from 'vitest';
import type { D1Like } from '../d1';
import { accountHarness, seedWalletMember } from './test-kit';

const NOW = 1_790_000_000_000;
type Seat = { m: string | null; kind: 'member' | 'guest' | 'bot' | 'deleted'; label?: string | null };

async function setup(foreignKeys = true) {
  const h = accountHarness({ now: NOW, foreignKeys });
  const a = await seedWalletMember(h.db, 'A', NOW);
  const b = await seedWalletMember(h.db, 'B', NOW);
  return { h, a, b };
}

/** One match: seat 0 and seat 1 as given; `winner` is a seat or null. */
async function seed(db: D1Like, code: string, startedAt: number, s0: Seat, s1: Seat, winner: number | null, agreed = 1): Promise<void> {
  await db.prepare("INSERT INTO match_record VALUES (?1, ?2, ?3, 'm', 'x', NULL, 'k', 'annihilation', ?4, 10, 'b', ?5)").bind(code, startedAt, startedAt + 1000, winner, agreed).run();
  for (const [i, s] of [s0, s1].entries()) {
    await db.prepare("INSERT INTO match_seat VALUES (?1, ?2, ?3, ?4, ?5, 'kdf', ?6)").bind(code, startedAt, i, s.m, s.kind, s.label ?? null).run();
  }
}
const mem = (m: string): Seat => ({ m, kind: 'member' });
const guest: Seat = { m: null, kind: 'guest' };
const get = async (h: Awaited<ReturnType<typeof setup>>['h'], cookie: string, qs = '') => h.call('GET', `/api/account/matches${qs}`, { cookie });
type Body = { matches: { code: string; agreed: boolean; opponent: Record<string, unknown> }[]; next: string | null; record: { won: number; lost: number; drawn: number } };

describe('GET matches (GH-1075 A3)', () => {
  it('deleting_a_keeps_b_history (A3-5)', async () => {
    const { h, a, b } = await setup();
    await seed(h.db, 'AB1', 1000, mem('A'), mem('B'), 0);
    await seed(h.db, 'AB2', 2000, mem('B'), mem('A'), 0);
    await seed(h.db, 'BG', 3000, mem('B'), guest, 0);
    await seed(h.db, 'AG', 4000, mem('A'), guest, 0);
    const before = (await (await get(h, b.cookie)).json()) as Body;
    expect(before.record).toEqual({ won: 2, lost: 1, drawn: 0 }); // AB2 and BG won; AB1 lost
    expect(before.matches).toHaveLength(3);
    const del = await h.call('POST', '/api/account/delete', { cookie: a.cookie, body: {} });
    expect(del.status).toBe(200);
    const after = (await (await get(h, b.cookie)).json()) as Body;
    expect(after.matches).toHaveLength(3);
    expect(after.record).toEqual(before.record);
    expect(after.matches.filter((m) => m.opponent.kind === 'deleted').map((m) => m.code).sort()).toEqual(['AB1', 'AB2']);
    expect(after.matches.find((m) => m.code === 'BG')?.opponent).toEqual({ kind: 'guest' });
    // The seat rows survive as anonymous 'deleted' rows: a missing row would also read as deleted in the view.
    expect(await h.db.prepare("SELECT COUNT(*) AS n FROM match_seat WHERE kind = 'deleted' AND code IN ('AB1', 'AB2')").first<{ n: number }>()).toEqual({ n: 2 });
    expect(await h.db.prepare("SELECT COUNT(*) AS n FROM match_record WHERE code = 'AG'").first<{ n: number }>()).toEqual({ n: 0 });
  });

  it('a_bot_shows_its_declared_model', async () => {
    const { h, a } = await setup();
    const labels = ['other:MyNet v3', 'id:claude-opus-5-5', null, 'junk'];
    for (const [i, label] of labels.entries()) await seed(h.db, `BOT${i}`, 1000 * (i + 1), mem('A'), { m: null, kind: 'bot', label }, 0);
    const body = (await (await get(h, a.cookie)).json()) as Body;
    const by = Object.fromEntries(body.matches.map((m) => [m.code, m.opponent]));
    expect(by.BOT0).toEqual({ kind: 'bot', model: { id: 'other', name: 'MyNet v3' } });
    expect(by.BOT1).toEqual({ kind: 'bot', model: { id: 'claude-opus-5-5' } });
    expect(by.BOT2).toEqual({ kind: 'bot', model: null });
    expect(by.BOT3).toEqual({ kind: 'bot', model: null });
  });

  it('guest_and_bot_wins_count', async () => {
    const { h, a } = await setup();
    await seed(h.db, 'G', 1000, mem('A'), guest, 0);
    await seed(h.db, 'B', 2000, { m: null, kind: 'bot', label: 'id:scripted' }, mem('A'), 1);
    const body = (await (await get(h, a.cookie)).json()) as Body;
    expect(body.record).toEqual({ won: 2, lost: 0, drawn: 0 });
  });

  it('a_rename_follows', async () => {
    const { h, a, b } = await setup();
    await seed(h.db, 'AB', 1000, mem('A'), mem('B'), 0);
    const first = (await (await get(h, a.cookie)).json()) as Body;
    expect(first.matches[0]?.opponent).toEqual({ kind: 'member', name: 'Callsign', publicId: 'PUB-B' });
    expect((await h.call('PATCH', '/api/account/profile', { cookie: b.cookie, body: { op_id: '11111111-1111-4111-8111-111111111111', displayName: 'Renamed' } })).status).toBe(200);
    const second = (await (await get(h, a.cookie)).json()) as Body;
    expect(second.matches[0]?.opponent).toEqual({ kind: 'member', name: 'Renamed', publicId: 'PUB-B' });
  });

  it('a_guest_is_only_guest', async () => {
    const { h, a } = await setup();
    await seed(h.db, 'G', 1000, mem('A'), guest, 0);
    const body = (await (await get(h, a.cookie)).json()) as Body;
    expect(body.matches[0]?.opponent).toStrictEqual({ kind: 'guest' });
  });

  it('unconfirmed_is_listed_not_counted', async () => {
    const { h, a } = await setup();
    await seed(h.db, 'U', 1000, mem('A'), guest, 0, 0);
    const body = (await (await get(h, a.cookie)).json()) as Body;
    expect(body.matches).toHaveLength(1);
    expect(body.matches[0]?.agreed).toBe(false);
    expect(body.record).toEqual({ won: 0, lost: 0, drawn: 0 });
  });

  it('paging', async () => {
    const { h, a } = await setup();
    for (let i = 1; i <= 45; i++) await seed(h.db, `M${i}`, i * 1000, mem('A'), guest, 0);
    const seen: string[] = [];
    let before: string | null = null;
    const sizes: number[] = [];
    const nexts: (string | null)[] = [];
    for (let page = 0; page < 5; page++) {
      const body = (await (await get(h, a.cookie, `?limit=20${before === null ? '' : `&before=${before}`}`)).json()) as Body;
      sizes.push(body.matches.length);
      nexts.push(body.next);
      seen.push(...body.matches.map((m) => m.code));
      expect(body.record.won).toBe(45);
      if (body.next === null) break;
      before = body.next;
    }
    expect(sizes).toEqual([20, 20, 5]);
    expect(nexts[2]).toBeNull();
    expect(nexts[0]).not.toBeNull();
    expect(new Set(seen).size).toBe(45);
  });

  it('ties_at_a_page_edge_are_neither_skipped_nor_repeated', async () => {
    const { h, a } = await setup();
    for (const code of ['T1', 'T2', 'T3']) await seed(h.db, code, 5000, mem('A'), guest, 0);
    const p1 = (await (await get(h, a.cookie, '?limit=2')).json()) as Body;
    expect(p1.matches.map((m) => m.code)).toEqual(['T3', 'T2']);
    expect(p1.next).not.toBeNull();
    const p2 = (await (await get(h, a.cookie, `?limit=2&before=${encodeURIComponent(p1.next ?? '')}`)).json()) as Body;
    expect(p2.matches.map((m) => m.code)).toEqual(['T1']);
    expect(p2.next).toBeNull();
  });

  it('another_members_history_is_not_reachable', async () => {
    const { h, a } = await setup();
    await seed(h.db, 'AG', 1000, mem('A'), guest, 0);
    await seed(h.db, 'BG', 2000, mem('B'), guest, 0);
    const body = (await (await get(h, a.cookie, '?member=B&member_id=B&publicId=PUB-B')).json()) as Body;
    expect(body.matches.map((m) => m.code)).toEqual(['AG']);
  });

  it('bad_query', async () => {
    const { h, a } = await setup();
    for (const qs of ['?limit=0', '?limit=51', '?before=abc', '?limit=1.5', '?before=5', '?before=5.', '?before=.A', '?before=x.A']) expect((await get(h, a.cookie, qs)).status, qs).toBe(400);
    expect((await get(h, a.cookie, '?limit=50&before=5.A')).status).toBe(200);
    expect((await h.call('GET', '/api/account/matches')).status).toBe(401);
  });
});
