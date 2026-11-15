import { describe, expect, it } from 'vitest';
import type { CoinsView } from '@lions/economy';
import type { D1Like } from '../d1';
import { COINS_BODY_MAX, COINS_NOTE_MAX, COINS_PAGE_MAX } from './config';
import { memberTablesInMigration, accountHarness, seedWalletMember } from './test-kit';

const NOW = 1_790_000_000_000;
type H = ReturnType<typeof accountHarness>;

async function setup() {
  const h = accountHarness({ now: NOW });
  const m = await seedWalletMember(h.db, 'M', NOW);
  const o = await seedWalletMember(h.db, 'P', NOW);
  return { h, m, o };
}
let n = 0;
/** One journal row, written straight into the table (no route in between). Returns its id. */
async function jrow(db: D1Like, member: string, kind: string, delta: number, detail: unknown, op = `op-${++n}`, at = NOW + n): Promise<number> {
  const raw = typeof detail === 'string' ? detail : JSON.stringify(detail);
  await db.prepare('INSERT INTO coin_journal (member_id, at, kind, free_delta, detail, op_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6)').bind(member, at, kind, delta, raw, op).run();
  return (await db.prepare('SELECT MAX(id) AS id FROM coin_journal').first<{ id: number }>())?.id ?? 0;
}
const get = (h: H, cookie: string | undefined, qs = '') => h.call('GET', `/api/account/coins${qs}`, { cookie });
const view = async (res: Response): Promise<CoinsView> => (await res.json()) as CoinsView;

describe('GET coins (GH-1370 C1)', () => {
  it('T1 only the caller own rows, never a third member', async () => {
    const { h, m, o } = await setup();
    await jrow(h.db, 'M', 'earn', 10, { source: 'first_win', missionId: 'mine' });
    await jrow(h.db, 'P', 'earn', 10, { source: 'first_win', missionId: 'SENTINEL-OTHER-MISSION' });
    await jrow(h.db, 'P', 'admin', 5, { reason: 'x', note: 'SENTINEL-OTHER-NOTE' });
    const text = await (await get(h, m.cookie)).text();
    expect((JSON.parse(text) as CoinsView).rows.map((r) => r.what)).toEqual([{ kind: 'earn', source: 'first_win', missionId: 'mine' }]);
    expect(text).not.toContain('SENTINEL-OTHER');
    expect((await view(await get(h, o.cookie))).rows).toHaveLength(2);
  });

  it('T2 the allow-list: no audit field reaches the body', async () => {
    const { h, m } = await setup();
    await jrow(h.db, 'M', 'admin', 50, { mode: 'grant', reason: 'SENTINEL-REASON', before: 111, after: 161, by: 'SENTINEL-BY', note: 'hello' }, 'SENTINEL-OP-1');
    await jrow(h.db, 'M', 'claim', 405, { coupons: [{ id: 'SENTINEL-COUPON', credited: 405, capped: false }], ceilingCut: 7777, receipt: 'SENTINEL-RECEIPT' }, 'SENTINEL-OP-2');
    const text = await (await get(h, m.cookie)).text();
    for (const s of ['SENTINEL', 'reason', 'before', 'after', '"by"', 'receipt', 'op_id', 'ceilingCut', 'coupons', '7777', '111']) expect(text.includes(s), s).toBe(false);
    expect((JSON.parse(text) as CoinsView).rows).toEqual([
      { at: expect.any(Number), delta: 405, what: { kind: 'move' } },
      { at: expect.any(Number), delta: 50, what: { kind: 'team', note: 'hello' } },
    ]);
  });

  it('T3 the admin identity never appears', async () => {
    const { h, m } = await setup();
    await seedWalletMember(h.db, 'ADM', NOW);
    await h.db.prepare("UPDATE member SET public_id = 'ADMN4444' WHERE id = 'ADM'").run();
    await h.db.prepare('INSERT INTO admin_member VALUES (?1, ?2)').bind('ADM', NOW).run();
    await h.db.prepare("INSERT INTO admin_action (at, admin_id, member_id, action, mode, delta, before, after, reason, op_id) VALUES (?1, 'ADM', 'M', 'coins', 'grant', 50, 0, 50, 'r', 'adm-op')").bind(NOW).run();
    await jrow(h.db, 'M', 'admin', 50, { mode: 'grant', reason: 'r', by: 'ADM' }, 'adm-op');
    const text = await (await get(h, m.cookie)).text();
    expect((JSON.parse(text) as CoinsView).rows).toHaveLength(1);
    for (const s of ['ADMN4444', 'ADM', 'Callsign']) expect(text.includes(s), s).toBe(false);
  });

  it('T4 a note comes only from detail.note', async () => {
    const { h, m } = await setup();
    await jrow(h.db, 'M', 'admin', 5, { reason: 'audit only text' });
    await jrow(h.db, 'M', 'admin', 5, { reason: 'audit', note: 'for you' });
    const body = await view(await get(h, m.cookie));
    expect(body.rows[0]?.what).toEqual({ kind: 'team', note: 'for you' });
    expect(body.rows[1]?.what).toEqual({ kind: 'team' });
    expect('note' in (body.rows[1]?.what ?? {})).toBe(false);
  });

  it('T5 paging: 45 rows give 20, 20, 5 with no duplicate; 40 rows give no false More', async () => {
    const { h, m } = await setup();
    for (let i = 0; i < 45; i++) await jrow(h.db, 'M', 'earn', 1, { source: 'star', missionId: `x${i}` });
    const seen: string[] = [];
    const sizes: number[] = [];
    let before: string | null = null;
    let lastNext: string | null = 'unset';
    for (let page = 0; page < 5; page++) {
      const b: CoinsView = await view(await get(h, m.cookie, `?limit=20${before === null ? '' : `&before=${before}`}`));
      sizes.push(b.rows.length);
      for (const r of b.rows) seen.push((r.what as { missionId: string }).missionId);
      lastNext = b.next;
      if (b.next === null) break;
      expect(Number(b.next)).toBeLessThan(before === null ? Infinity : Number(before));
      before = b.next;
    }
    expect(sizes).toEqual([20, 20, 5]);
    expect(lastNext).toBeNull();
    expect(seen).toEqual(Array.from({ length: 45 }, (_, i) => `x${44 - i}`));
    expect(new Set(seen).size).toBe(45);

    const second = await setup();
    for (let i = 0; i < 40; i++) await jrow(second.h.db, 'M', 'earn', 1, { source: 'star', missionId: `y${i}` });
    const p1 = await view(await get(second.h, second.m.cookie, '?limit=20'));
    expect(p1.next).not.toBeNull();
    const p2 = await view(await get(second.h, second.m.cookie, `?limit=20&before=${p1.next}`));
    expect(p2.rows).toHaveLength(20);
    expect(p2.next).toBeNull();
  });

  it('T6 a zero move row is listed; a zero reset is not', async () => {
    const { h, m } = await setup();
    await jrow(h.db, 'M', 'backfill', 0, {});
    await jrow(h.db, 'M', 'reset', 0, {});
    await jrow(h.db, 'M', 'claim', 0, {});
    const body = await view(await get(h, m.cookie));
    expect(body.rows.map((r) => r.what.kind)).toEqual(['move', 'move']);
  });

  it('T7 moved marks a spend that shares an op id with a move row', async () => {
    const { h, m } = await setup();
    await jrow(h.db, 'M', 'backfill', 405, {}, 'claim-op');
    await jrow(h.db, 'M', 'unit', -60, { unitId: 'sniper_team' }, 'claim-op');
    await jrow(h.db, 'M', 'unit', -60, { unitId: 'at_team' }, 'plain-op');
    await jrow(h.db, 'M', 'tier', -20, { unitId: 'at_team', track: 'armor', tier: 2 }, 'plain-op-2');
    const body = await view(await get(h, m.cookie));
    expect(body.rows.map((r) => r.what)).toEqual([
      { kind: 'tier', unitId: 'at_team', track: 'armor', tier: 2, moved: false },
      { kind: 'unit', unitId: 'at_team', moved: false },
      { kind: 'unit', unitId: 'sniper_team', moved: true },
      { kind: 'move' },
    ]);
  });

  it('T8 query bounds', async () => {
    const { h, m } = await setup();
    await jrow(h.db, 'M', 'earn', 1, { source: 'star' });
    for (const qs of ['?limit=0', `?limit=${COINS_PAGE_MAX + 1}`, '?limit=x', '?limit=1e3', '?limit=-1', '?before=abc', '?before=-1', '?before=1234567890123456']) {
      const res = await get(h, m.cookie, qs);
      expect([qs, res.status, await res.json()]).toEqual([qs, 400, { error: 'query' }]);
    }
    for (const qs of ['', `?limit=${COINS_PAGE_MAX}`, '?limit=1', '?before=999999999999999']) expect((await get(h, m.cookie, qs)).status, qs).toBe(200);
  });

  it('T9 no cookie answers 401', async () => {
    const { h } = await setup();
    expect((await get(h, undefined)).status).toBe(401);
    expect((await get(h, '__Host-rl_session=nope')).status).toBe(401);
  });

  it('T10 the per-minute limiter answers this route 429', async () => {
    const h = accountHarness({ now: NOW, denyLimiter: ['ACCOUNT_OP_LIMIT'] });
    const m = await seedWalletMember(h.db, 'M', NOW);
    const res = await get(h, m.cookie);
    expect([res.status, await res.json()]).toEqual([429, { error: 'limit' }]);
  });

  it('T11 a GET writes nothing', async () => {
    const { h, m } = await setup();
    await jrow(h.db, 'M', 'earn', 3, { source: 'star' });
    const snap = async () => {
      const out: Record<string, number> = {};
      for (const t of [...memberTablesInMigration(), 'rate_day']) out[t] = (await h.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{ n: number }>())?.n ?? 0;
      return out;
    };
    const before = await snap();
    expect((await get(h, m.cookie)).status).toBe(200);
    expect(await snap()).toEqual(before);
    expect(before.rate_day).toBe(0);
  });

  it('T12 the cap: 50 rows with oversize notes fit COINS_BODY_MAX and the notes are dropped', async () => {
    const { h, m } = await setup();
    const four = '\u{1F981}'; // four bytes in UTF-8
    for (let i = 0; i < COINS_PAGE_MAX - 1; i++) await jrow(h.db, 'M', 'admin', 1, { note: four.repeat(200), unitId: 'u'.repeat(64) });
    await jrow(h.db, 'M', 'admin', 1, { note: four.repeat(COINS_NOTE_MAX) });
    const res = await get(h, m.cookie, `?limit=${COINS_PAGE_MAX}`);
    const text = await res.text();
    const body = JSON.parse(text) as CoinsView;
    expect(body.rows).toHaveLength(COINS_PAGE_MAX);
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(COINS_BODY_MAX);
    // Newest first: the exact-bound note survives, the 200-point ones are dropped whole.
    expect(body.rows[0]?.what).toEqual({ kind: 'team', note: four.repeat(COINS_NOTE_MAX) });
    expect(body.rows.slice(1).every((r) => !('note' in r.what))).toBe(true);
    // An over-long id or track is dropped too: the row words generically.
    await jrow(h.db, 'M', 'tier', -1, { unitId: 'u'.repeat(65), track: 't'.repeat(33), tier: 1 });
    const t = await view(await get(h, m.cookie, '?limit=1'));
    expect(t.rows[0]?.what).toEqual({ kind: 'tier', unitId: '', track: '', tier: 1, moved: false });
  });

  it('T13 a damaged detail still answers 200 with the kind only', async () => {
    const { h, m } = await setup();
    await jrow(h.db, 'M', 'unit', -5, '{not json');
    await jrow(h.db, 'M', 'earn', 5, 'SENTINEL-not-json');
    const res = await get(h, m.cookie);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('SENTINEL');
    expect((JSON.parse(text) as CoinsView).rows.map((r) => r.what)).toEqual([{ kind: 'earn', source: '' }, { kind: 'unit', unitId: '', moved: false }]);
  });
});
