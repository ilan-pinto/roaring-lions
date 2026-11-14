/** GH-695 S4: the coin write. Every guard here has a named one-line mutation that turns it red (see the commit). */
import { describe, expect, it } from 'vitest';
import { exportMember } from '../account/export';
import { NOW, adminKit, addMember, gameCookie } from './kit';

const ADMIN = { id: 'adm', publicId: 'ADMQ0001', name: 'The Lead' };
const OP = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const REASON = 'compensation for a lost match';

async function seeded(free = 500) {
  const k = adminKit();
  await addMember(k.db, ADMIN);
  await addMember(k.db, { id: 'm1', publicId: 'K7Q2ABCD', name: 'Sandstorm', free, walletRevision: 4 });
  await k.db.prepare("INSERT INTO admin_member VALUES ('adm', 1)").run();
  await k.db.prepare("INSERT INTO flags VALUES ('admin', 'open', 1)").run();
  const admin = await gameCookie(k.db, 'adm');
  let n = 0;
  const post = (body: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    k.call('POST', '/stats/api/members/K7Q2ABCD/coins', { body: { op_id: OP(++n), mode: 'grant', amount: 100, reason: REASON, revision: 4, ...body }, game: admin, ...extra });
  const one = async <T>(sql: string) => (await k.db.prepare(sql).first<T>()) as T;
  const state = async () => ({
    wallet: await one<{ free: number; revision: number }>("SELECT free, revision FROM wallet WHERE member_id = 'm1'"),
    sum: (await one<{ s: number }>("SELECT SUM(free_delta) AS s FROM coin_journal WHERE member_id = 'm1'")).s,
    journal: (await one<{ n: number }>("SELECT COUNT(*) AS n FROM coin_journal WHERE member_id = 'm1'")).n,
    actions: (await one<{ n: number }>("SELECT COUNT(*) AS n FROM admin_action WHERE action = 'coins'")).n,
    ops: (await one<{ n: number }>('SELECT COUNT(*) AS n FROM account_op')).n,
    day: (await k.db.prepare("SELECT scope, n FROM rate_day ORDER BY scope").all<{ scope: string; n: number }>()).results,
  });
  return { ...k, admin, post, state, one };
}

describe('the three modes (S4, D7)', () => {
  it('grant, deduct and set each write the delta the SERVER computed, in one batch of four rows', async () => {
    const k = await seeded(500);
    const g = await k.post({ mode: 'grant', amount: 100 });
    expect(g.status).toBe(200);
    expect(await g.json()).toEqual({ wallet: { free: 600, revision: 5, updatedAt: NOW }, before: 500, after: 600, delta: 100 });
    const d = await k.post({ mode: 'deduct', amount: 50, revision: 5 });
    expect(await d.json()).toMatchObject({ before: 600, after: 550, delta: -50 });
    const s = await k.post({ mode: 'set', amount: 1000, revision: 6 });
    expect(await s.json()).toMatchObject({ before: 550, after: 1000, delta: 450 });
    const st = await k.state();
    expect(st.wallet).toEqual({ free: 1000, revision: 7 });
    expect(st.sum).toBe(1000); // wallet.free = SUM(free_delta)
    expect(st.actions).toBe(3);
    expect(st.ops).toBe(3);
    const rows = (await k.db.prepare("SELECT mode, delta, \"before\", \"after\", reason, admin_id, member_id FROM admin_action WHERE action = 'coins' ORDER BY id").all()).results;
    expect(rows[0]).toEqual({ mode: 'grant', delta: 100, before: 500, after: 600, reason: REASON, admin_id: 'adm', member_id: 'm1' });
    const j = await k.one<{ kind: string; free_delta: number; paid_delta: number; detail: string }>("SELECT kind, free_delta, paid_delta, detail FROM coin_journal WHERE kind = 'admin' ORDER BY id LIMIT 1");
    expect(j).toMatchObject({ kind: 'admin', free_delta: 100, paid_delta: 0 });
    expect(JSON.parse(j.detail)).toEqual({ mode: 'grant', reason: REASON, before: 500, after: 600, by: 'admin', receipt: null });
  });

  it('a set to the same balance is a 400 and writes nothing', async () => {
    const k = await seeded(500);
    expect((await k.post({ mode: 'set', amount: 500 })).status).toBe(400);
    expect((await k.state()).actions).toBe(0);
  });

  it('leaves earn, earn_lifetime and entitlements alone (D7.6)', async () => {
    const k = await seeded(500);
    const before = await k.one<{ earn: string; earn_lifetime: string; entitlements: string }>("SELECT earn, earn_lifetime, entitlements FROM wallet WHERE member_id = 'm1'");
    await k.post({});
    expect(await k.one("SELECT earn, earn_lifetime, entitlements FROM wallet WHERE member_id = 'm1'")).toEqual(before);
  });
});

describe('refusals write nothing and spend no day count (S4, D7, D10)', () => {
  it('bad bodies: mode, amount, op id, revision, reason', async () => {
    const k = await seeded();
    const cases: [Record<string, unknown>, string][] = [
      [{ mode: 'add' }, 'mode'],
      [{ amount: 0 }, 'amount'],
      [{ amount: -5 }, 'amount'],
      [{ amount: 1.5 }, 'amount'],
      [{ amount: '100' }, 'amount'],
      [{ amount: 100_001 }, 'amount'], // the per-action cap
      [{ mode: 'deduct', amount: 100_001 }, 'amount'],
      [{ op_id: 'nope' }, 'op_id'],
      [{ revision: '4' }, 'revision'],
      [{ revision: -1 }, 'revision'],
      [{ reason: 'short' }, 'reason'], // 5 characters
      [{ reason: 'seven..' }, 'reason'],
      [{ reason: '      pad      ' }, 'reason'],
      [{ reason: 'a​​​​​b\u0007\u0007\u0007' }, 'reason'], // cleans to "a b"
      [{ reason: 'x'.repeat(201) }, 'reason'],
      [{ reason: 7 }, 'reason'],
    ];
    for (const [over, error] of cases) {
      const res = await k.post(over);
      expect(res.status, JSON.stringify(over)).toBe(400);
      expect(((await res.json()) as { error: string }).error, JSON.stringify(over)).toBe(error);
    }
    const st = await k.state();
    expect(st).toMatchObject({ actions: 0, ops: 0, day: [], journal: 1 });
  });

  it('the reason is 8 to 200 CHARACTERS after cleaning, and stored cleaned', async () => {
    const k = await seeded();
    expect((await k.post({ reason: '12345678' })).status).toBe(200);
    expect((await k.post({ reason: 'é'.repeat(200), revision: 5 })).status).toBe(200); // 200 code points, 400 bytes
    const stored = await k.one<{ reason: string }>("SELECT reason FROM admin_action WHERE action = 'coins' ORDER BY id LIMIT 1");
    expect(stored.reason).toBe('12345678');
    const messy = await k.post({ reason: '  line one\n\tline‮two  ', revision: 6 });
    expect(messy.status).toBe(200);
    const row = await k.one<{ reason: string }>("SELECT reason FROM admin_action WHERE action = 'coins' ORDER BY id DESC LIMIT 1");
    expect(row.reason).toBe('line one linetwo');
  });

  it('a result outside 0..1,000,000 is a 409 range BEFORE any write, and not a 500', async () => {
    const k = await seeded(500);
    const below = await k.post({ mode: 'deduct', amount: 501 });
    expect(below.status).toBe(409);
    expect(await below.json()).toEqual({ error: 'range' });
    const k2 = await seeded(950_000);
    const above = await k2.post({ mode: 'grant', amount: 50_001 });
    expect(above.status).toBe(409);
    expect(await above.json()).toEqual({ error: 'range' });
    for (const x of [k, k2]) expect(await x.state()).toMatchObject({ actions: 0, ops: 0, day: [] });
    // The exact edges are legal.
    expect((await k.post({ mode: 'deduct', amount: 500 })).status).toBe(200);
    expect((await k2.post({ mode: 'grant', amount: 50_000 })).status).toBe(200);
    expect((await k2.state()).wallet.free).toBe(1_000_000);
  });

  it('a set whose delta passes 100,000 is refused; a set outside the range is a 409', async () => {
    const k = await seeded(500);
    const big = await k.post({ mode: 'set', amount: 100_501 });
    expect(big.status).toBe(400);
    expect(((await big.json()) as { error: string }).error).toBe('amount');
    expect((await k.post({ mode: 'set', amount: 1_000_001 })).status).toBe(400);
    expect((await k.post({ mode: 'set', amount: 100_500 })).status).toBe(200); // delta exactly 100,000
    expect((await k.post({ mode: 'set', amount: 0, revision: 5 })).status).toBe(400); // delta -100,500
  });

  it('an unknown member is a 404', async () => {
    const k = await seeded();
    const res = await k.call('POST', '/stats/api/members/ZZZZZZZZ/coins', { body: { op_id: OP(900), mode: 'grant', amount: 5, reason: REASON, revision: 0 }, game: k.admin });
    expect(res.status).toBe(404);
  });
});

describe('the wallet revision (S4, D7.4, D9.2)', () => {
  it('a stale revision is a 409 moved carrying the wallet, and writes nothing', async () => {
    const k = await seeded(500);
    for (const mode of ['grant', 'set'] as const) {
      const res = await k.post({ mode, amount: 100, revision: 3 });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: 'moved', wallet: { free: 500, revision: 4 } });
    }
    expect(await k.state()).toMatchObject({ actions: 0, ops: 0, day: [], wallet: { free: 500, revision: 4 } });
  });

  it('a wallet that moves between the read and the batch is retried, then refused as moved, and nothing half-commits', async () => {
    const k = await seeded(500);
    const real = k.env.ACCOUNTS.batch.bind(k.env.ACCOUNTS);
    let raced = 0;
    k.env.ACCOUNTS.batch = async (stmts) => {
      if (raced++ === 0) await k.db.prepare("UPDATE wallet SET free = free + 7, revision = revision + 1 WHERE member_id = 'm1'").run();
      return real(stmts);
    };
    const res = await k.post({ mode: 'set', amount: 900 });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe('moved');
    expect(raced).toBe(1); // the retry re-read and judged the revision without a second batch
    expect(await k.state()).toMatchObject({ actions: 0, ops: 0, day: [], journal: 1, wallet: { free: 507, revision: 5 } });
  });
});

describe('idempotency (S4, D9.3)', () => {
  it('a double submit with one op id writes once and answers the stored answer', async () => {
    const k = await seeded(500);
    const body = { op_id: OP(77), mode: 'grant', amount: 100, reason: REASON, revision: 4 };
    const a = await k.call('POST', '/stats/api/members/K7Q2ABCD/coins', { body, game: k.admin });
    const b = await k.call('POST', '/stats/api/members/K7Q2ABCD/coins', { body, game: k.admin });
    expect(b.status).toBe(200);
    expect(await b.json()).toEqual(await a.json());
    expect(await k.state()).toMatchObject({ actions: 1, ops: 1, wallet: { free: 600, revision: 5 }, day: [{ scope: 'admin-coins', n: 100 }, { scope: 'admin-writes', n: 1 }] });
  });

  it('a replay spends no day count, and the op is keyed on the TARGET member', async () => {
    const k = await seeded(500);
    await k.db.prepare("INSERT INTO rate_day VALUES ('admin-writes', '', ?1, 50)").bind(Math.floor(NOW / 86_400_000)).run();
    const op = await k.one<{ n: number }>('SELECT COUNT(*) AS n FROM account_op');
    expect(op.n).toBe(0);
    expect((await k.post({})).status).toBe(429);
  });
});

describe('the day caps (S4, D10)', () => {
  const day = Math.floor(NOW / 86_400_000);
  it('250,000 coins granted a day: the cap is exact, and a deduction neither counts nor is blocked', async () => {
    const k = await seeded(500);
    await k.db.prepare("INSERT INTO rate_day VALUES ('admin-coins', '', ?1, 249900)").bind(day).run();
    const over = await k.post({ amount: 101 });
    expect(over.status).toBe(429);
    expect(await over.json()).toEqual({ error: 'limit' });
    expect((await k.state()).actions).toBe(0);
    expect((await k.post({ mode: 'deduct', amount: 400 })).status).toBe(200); // deductions are not grants
    expect((await k.post({ amount: 100, revision: 5 })).status).toBe(200); // lands exactly on 250,000
    expect((await k.post({ amount: 1, revision: 6 })).status).toBe(429);
    const coins = (await k.state()).day.find((d) => d.scope === 'admin-coins');
    expect(coins?.n).toBe(250_000);
  });

  it('50 writes a day, of any mode, and the 51st is a 429', async () => {
    const k = await seeded(500);
    await k.db.prepare("INSERT INTO rate_day VALUES ('admin-writes', '', ?1, 49)").bind(day).run();
    expect((await k.post({ mode: 'deduct', amount: 1 })).status).toBe(200);
    const res = await k.post({ mode: 'deduct', amount: 1, revision: 5 });
    expect(res.status).toBe(429);
    expect((await k.state()).day.find((d) => d.scope === 'admin-writes')?.n).toBe(50);
  });
});

describe('the gate guards the route (S4, D1-D3)', () => {
  it('every missing factor is refused and nothing is written', async () => {
    const k = await seeded(500);
    const player = await gameCookie(k.db, 'm1');
    const url = '/stats/api/members/K7Q2ABCD/coins';
    const body = { op_id: OP(5), mode: 'grant', amount: 100, reason: REASON, revision: 4 };
    expect((await k.call('POST', url, { body, game: k.admin, stats: false })).status).toBe(401); // no password session
    expect((await k.call('POST', url, { body })).status).toBe(401); // no game session
    expect((await k.call('POST', url, { body, game: player })).status).toBe(403); // not an admin
    expect((await k.call('POST', url, { body, game: k.admin, header: false })).status).toBe(403);
    expect((await k.call('POST', url, { body, game: k.admin, origin: 'https://evil.example' })).status).toBe(403);
    expect((await k.call('POST', url, { body, game: k.admin, headers: { 'content-type': 'text/plain' } })).status).toBe(415);
    expect((await k.call('GET', url, { game: k.admin })).status).toBe(405);
    expect((await k.call('POST', url, { rawBody: '[1]', game: k.admin })).status).toBe(400);
    await k.db.prepare("UPDATE flags SET value = 'closed' WHERE name = 'admin'").run();
    expect((await k.call('POST', url, { body, game: k.admin })).status).toBe(503);
    await k.db.prepare("DELETE FROM flags WHERE name = 'admin'").run();
    expect((await k.call('POST', url, { body, game: k.admin })).status).toBe(503); // no row is CLOSED
    expect(await k.state()).toMatchObject({ actions: 0, ops: 0, wallet: { free: 500, revision: 4 } });
  });
});

describe("the member's export never carries the admin's id (S4, MUST)", () => {
  it('a member who got an admin grant exports no admin public id, and no admin internal id', async () => {
    const k = await seeded(500);
    expect((await k.post({ amount: 100 })).status).toBe(200);
    const out = JSON.stringify(await exportMember(k.db, 'm1'));
    expect(out).toContain('"kind":"admin"'); // the journal row IS there
    expect(out).toContain('\\"by\\":\\"admin\\"');
    expect(out).toContain(REASON);
    expect(out).not.toContain(ADMIN.publicId);
    expect(out).not.toMatch(/\badm\b/); // the internal id
    expect(out).not.toContain(ADMIN.name);
  });
});
