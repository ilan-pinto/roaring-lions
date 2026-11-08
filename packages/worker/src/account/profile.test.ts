import { describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from './config';
import { createSession } from './session';
import { accountHarness, racingD1 } from './test-kit';

const DAY = 86_400_000;
const T0 = 20_000 * DAY + 3_600_000;
const op = (n: number): string => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
type H = ReturnType<typeof accountHarness>;

async function seed(h: H): Promise<string> {
  await h.db.prepare('INSERT INTO member (id, public_id, id_hash, user_handle, created_at, last_seen_day) VALUES (?1, ?2, ?3, ?4, ?5, 0)')
    .bind('m1', 'PUB1', 'hash1', 'uh1', T0).run();
  await h.db.prepare('INSERT INTO profile (member_id, display_name, show_record, updated_at) VALUES (?1, ?2, 0, ?3)').bind('m1', 'Callsign', T0).run();
  const s = await createSession(h.db, 'm1', T0);
  await h.db.batch(s.statements);
  return `${SESSION_COOKIE}=${s.token}`;
}
const patch = (h: H, ck: string, body: Record<string, unknown>) => h.call('PATCH', '/api/account/profile', { cookie: ck, body });
const nameOf = async (h: H): Promise<string> =>
  (await h.db.prepare("SELECT display_name FROM profile WHERE member_id = 'm1'").first<{ display_name: string }>())?.display_name ?? '';
const opRows = async (h: H): Promise<{ response: string }[]> =>
  (await h.db.prepare('SELECT response FROM account_op').all<{ response: string }>()).results;

describe('PATCH profile', () => {
  it('a retried op returns the first answer', async () => {
    const h = accountHarness({ now: T0 });
    const ck = await seed(h);
    const a = await patch(h, ck, { op_id: op(1), displayName: 'Alpha' });
    expect(a.status).toBe(200);
    const b = await patch(h, ck, { op_id: op(1), displayName: 'Bravo' });
    expect(await b.json()).toEqual(await a.json());
    expect(await nameOf(h)).toBe('Alpha');
  });

  it('a concurrent retry returns the committed answer', async () => {
    const h = accountHarness({ now: T0 });
    const ck = await seed(h);
    // Same database, raced: the Env's ACCOUNTS is the wrapped one.
    const env = { ...h.env, ACCOUNTS: racingD1(h.db, 2) };
    const { handleAccount } = await import('./routes');
    const go = (name: string) =>
      handleAccount(new Request('https://roaring-lions.pint12.workers.dev/api/account/profile', {
        method: 'PATCH',
        headers: { 'x-rl-account': '1', 'content-type': 'application/json', origin: 'https://roaring-lions.pint12.workers.dev', cookie: ck },
        body: JSON.stringify({ op_id: op(7), displayName: name }),
      }), env, T0);
    const [x, y] = await Promise.all([go('Alpha'), go('Bravo')]);
    expect([x.status, y.status]).toEqual([200, 200]);
    const bx = await x.json() as { displayName: string };
    expect(await y.json()).toEqual(bx);
    expect(await opRows(h)).toHaveLength(1);
    expect(await nameOf(h)).toBe(bx.displayName);
  });

  it('no secret in the op log', async () => {
    const h = accountHarness({ now: T0 });
    const ck = await seed(h);
    const res = await patch(h, ck, { op_id: op(2), displayName: 'Alpha' });
    expect(res.status).toBe(200);
    const rows = await opRows(h);
    expect(rows).toHaveLength(1);
    for (const r of rows) {
      expect(r.response).not.toContain('__Host-');
      expect(r.response).not.toContain(ck.split('=')[1] ?? 'x');
    }
  });

  it('display_name_counts_code_points', async () => {
    const h = accountHarness({ now: T0 });
    const ck = await seed(h);
    const status = async (n: number, name: string): Promise<number> => (await patch(h, ck, { op_id: op(n), displayName: name })).status;
    expect(await status(10, '🦁'.repeat(20))).toBe(200);
    expect(await status(11, '🦁'.repeat(21))).toBe(400);
    expect(await status(12, 'שלום עולם')).toBe(200);
    expect(await status(13, '​​​​')).toBe(400);
    expect(await status(14, 'ab')).toBe(400);
    expect(await status(15, 'abc')).toBe(200);
  });

  it('showRecord alone leaves the name; bad bodies answer 400', async () => {
    const h = accountHarness({ now: T0 });
    const ck = await seed(h);
    const res = await patch(h, ck, { op_id: op(20), showRecord: true });
    expect(await res.json()).toEqual({ displayName: 'Callsign', showRecord: true });
    expect((await patch(h, ck, { op_id: op(21), showRecord: 'yes' })).status).toBe(400);
    expect((await patch(h, ck, { op_id: op(22) })).status).toBe(400);
    expect((await patch(h, ck, { op_id: op(23), displayName: 42 })).status).toBe(400);
    expect((await patch(h, ck, { displayName: 'Alpha' })).status).toBe(400);
    expect((await patch(h, ck, { op_id: 'x', displayName: 'Alpha' })).status).toBe(400);
    expect(await nameOf(h)).toBe('Callsign');
  });

  it('needs a session, and the day budget stops it with 429', async () => {
    const h = accountHarness({ now: T0 });
    const ck = await seed(h);
    expect((await h.call('PATCH', '/api/account/profile', { body: { op_id: op(30), displayName: 'Alpha' } })).status).toBe(401);
    await h.db.prepare("INSERT INTO rate_day (scope, key, day, n) VALUES ('acct-ops', 'm1', ?1, 400)").bind(Math.floor(T0 / DAY)).run();
    expect((await patch(h, ck, { op_id: op(31), displayName: 'Alpha' })).status).toBe(429);
    expect(await nameOf(h)).toBe('Callsign');
  });
});
