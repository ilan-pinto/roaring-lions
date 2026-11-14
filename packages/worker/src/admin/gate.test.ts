/** GH-695 S2: the admin gate, whoami and the switch. Every gate here has a one-line mutation that turns it red (see the commit). */
import { describe, expect, it } from 'vitest';
import { adminWriteGate } from './gate';
import { NOW, adminKit, addMember, gameCookie } from './kit';
import { accountHarness } from '../account/test-kit';

const ADMIN = { id: 'adm', publicId: 'ADMQ0001', name: 'The Lead' };
const PLAYER = { id: 'plr', publicId: 'PQYR0002', name: 'Player Two' };

async function seeded() {
  const k = adminKit();
  await addMember(k.db, ADMIN);
  await addMember(k.db, PLAYER);
  await k.db.prepare("INSERT INTO admin_member VALUES ('adm', 1)").run();
  const admin = await gameCookie(k.db, 'adm');
  const player = await gameCookie(k.db, 'plr');
  const flag = (v: string | null) =>
    v === null ? k.db.prepare("DELETE FROM flags WHERE name = 'admin'").run() : k.db.prepare("INSERT OR REPLACE INTO flags VALUES ('admin', ?1, 1)").bind(v).run();
  const flagValue = async () => (await k.db.prepare("SELECT value FROM flags WHERE name = 'admin'").first<{ value: string }>())?.value ?? null;
  return { ...k, admin, player, flag, flagValue };
}

describe('the write gate needs every factor (S2, D1)', () => {
  it('each missing factor is refused, and only the full set closes the switch', async () => {
    const k = await seeded();
    await k.flag('open');
    const close = { body: { open: false } };
    expect((await k.call('POST', '/stats/api/members/switch', { ...close, stats: false, game: k.admin })).status).toBe(401); // no password session
    expect((await k.call('POST', '/stats/api/members/switch', { ...close })).status).toBe(401); // no game session
    expect((await k.call('POST', '/stats/api/members/switch', { ...close, game: 'garbage' })).status).toBe(401); // a forged game session
    expect((await k.call('POST', '/stats/api/members/switch', { ...close, game: k.player })).status).toBe(403); // a member who is not an admin
    expect(await k.flagValue()).toBe('open');
    const ok = await k.call('POST', '/stats/api/members/switch', { ...close, game: k.admin });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ open: false });
    expect(await k.flagValue()).toBe('closed');
    const act = await k.db.prepare('SELECT action, admin_id, member_id, reason FROM admin_action').all();
    expect(act.results).toEqual([{ action: 'switch', admin_id: 'adm', member_id: null, reason: 'closed' }]);
  });

  it('the admin row is what decides, not the session alone', async () => {
    const k = await seeded();
    await k.db.prepare("DELETE FROM admin_member WHERE member_id = 'adm'").run();
    expect((await k.call('POST', '/stats/api/members/switch', { body: { open: false }, game: k.admin })).status).toBe(403);
  });
});

describe('the page can close the switch and never open it (S2, D3)', () => {
  it('refuses anything but { open: false }', async () => {
    const k = await seeded();
    await k.flag('open');
    for (const body of [{ open: true }, { open: 'false' }, { open: 0 }, {}, { closed: true }]) {
      const res = await k.call('POST', '/stats/api/members/switch', { body, game: k.admin });
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect((await k.call('POST', '/stats/api/members/switch', { rawBody: '[false]', game: k.admin })).status).toBe(400);
    expect((await k.call('POST', '/stats/api/members/switch', { rawBody: 'not json', game: k.admin })).status).toBe(400);
    expect(await k.flagValue()).toBe('open');
    // Nothing was logged for a refusal.
    expect((await k.db.prepare('SELECT COUNT(*) AS n FROM admin_action').first<{ n: number }>())?.n).toBe(0);
  });

  it('closing works when it is already closed or has no row, and spends no day cap', async () => {
    const k = await seeded();
    await k.flag(null);
    expect((await k.call('POST', '/stats/api/members/switch', { body: { open: false }, game: k.admin })).status).toBe(200);
    expect(await k.flagValue()).toBe('closed');
    expect((await k.call('POST', '/stats/api/members/switch', { body: { open: false }, game: k.admin })).status).toBe(200);
    expect((await k.db.prepare("SELECT COUNT(*) AS n FROM rate_day WHERE scope = 'admin-writes'").first<{ n: number }>())?.n).toBe(0);
  });
});

describe('CSRF and transport (S2, D2)', () => {
  const post = (k: Awaited<ReturnType<typeof seeded>>, init: Parameters<typeof k.call>[2]) => k.call('POST', '/stats/api/members/switch', { body: { open: false }, game: k.admin, ...init });

  it('Origin must be exactly this Worker: missing, foreign, and an ALLOWED_ORIGINS entry all fail', async () => {
    const k = await seeded();
    await k.flag('open');
    k.env.ALLOWED_ORIGINS = 'https://friend.example';
    expect((await post(k, { origin: null })).status).toBe(403);
    expect((await post(k, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await post(k, { origin: 'https://friend.example' })).status).toBe(403); // originAllowed would let this through
    expect((await post(k, { origin: 'https://roaring-lions.pint12.workers.dev:8443' })).status).toBe(403);
    expect(await k.flagValue()).toBe('open');
    expect((await post(k, {})).status).toBe(200);
  });

  it('needs the JSON content type and the x-rl-admin header', async () => {
    const k = await seeded();
    await k.flag('open');
    expect((await post(k, { headers: { 'content-type': 'text/plain' } })).status).toBe(415);
    expect((await post(k, { headers: { 'content-type': 'application/x-www-form-urlencoded' } })).status).toBe(415);
    expect((await post(k, { headers: { 'content-type': 'application/jsonx' } })).status).toBe(415);
    expect((await post(k, { header: false })).status).toBe(403);
    expect((await post(k, { headers: { 'x-rl-admin': '0' } })).status).toBe(403);
    expect(await k.flagValue()).toBe('open');
    expect((await post(k, { headers: { 'content-type': 'application/json; charset=utf-8' } })).status).toBe(200);
  });

  it('is POST only, OPTIONS included, and the body is capped at 2 KiB', async () => {
    const k = await seeded();
    await k.flag('open');
    for (const m of ['GET', 'PUT', 'DELETE', 'OPTIONS', 'PATCH']) {
      const res = await k.call(m, '/stats/api/members/switch', { game: k.admin });
      expect(res.status, m).toBe(405);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    }
    const big = await post(k, { rawBody: JSON.stringify({ open: false, pad: 'x'.repeat(2100) }) });
    expect(big.status).toBe(413);
    expect(await k.flagValue()).toBe('open');
  });
});

describe('the kill switch (S2, D3)', () => {
  const gate = async (k: Awaited<ReturnType<typeof seeded>>, requireOpen = true) => {
    const req = new Request('https://roaring-lions.pint12.workers.dev/stats/api/members/x', {
      method: 'POST',
      headers: { origin: 'https://roaring-lions.pint12.workers.dev', 'content-type': 'application/json', 'x-rl-admin': '1', cookie: k.admin },
    });
    return adminWriteGate(req, k.env, NOW, { requireOpen, countsToDay: false });
  };

  it('only the value "open" lets a write through: a missing row, "closed" and garbage are closed', async () => {
    const k = await seeded();
    for (const v of [null, 'closed', 'OPEN', 'true', '', ' open']) {
      await k.flag(v);
      const res = await gate(k);
      expect(res instanceof Response ? res.status : 'writer', String(v)).toBe(503);
      if (res instanceof Response) expect(await res.json()).toEqual({ error: 'closed' });
    }
    await k.flag('open');
    const ok = await gate(k);
    expect(ok instanceof Response).toBe(false);
    expect(ok instanceof Response ? '' : ok.adminId).toBe('adm');
  });

  it('a write route that does not need it open (the switch) passes while closed', async () => {
    const k = await seeded();
    await k.flag(null);
    expect((await gate(k, false)) instanceof Response).toBe(false);
  });
});

describe('the day cap and the per-minute limit (S2, D10)', () => {
  it('50 counted writes a day, then 429; a refused write counts nothing more', async () => {
    const k = await seeded();
    await k.flag('open');
    const mk = () =>
      adminWriteGate(
        new Request('https://roaring-lions.pint12.workers.dev/stats/api/members/x', {
          method: 'POST',
          headers: { origin: 'https://roaring-lions.pint12.workers.dev', 'content-type': 'application/json', 'x-rl-admin': '1', cookie: k.admin },
        }),
        k.env,
        NOW,
        { requireOpen: true, countsToDay: true },
      );
    for (let i = 0; i < 50; i++) expect((await mk()) instanceof Response).toBe(false);
    const over = await mk();
    expect(over instanceof Response ? over.status : 0).toBe(429);
    expect((await k.db.prepare("SELECT n FROM rate_day WHERE scope = 'admin-writes'").first<{ n: number }>())?.n).toBe(50);
  });

  it('the per-minute binding answers 429 before any session is read', async () => {
    const h = accountHarness({ denyLimiter: ['ACCOUNT_OP_LIMIT'] });
    const res = await adminWriteGate(
      new Request('https://roaring-lions.pint12.workers.dev/stats/api/members/x', {
        method: 'POST',
        headers: { origin: 'https://roaring-lions.pint12.workers.dev', 'content-type': 'application/json', 'x-rl-admin': '1' },
      }),
      h.env,
      NOW,
      { requireOpen: true, countsToDay: false },
    );
    expect(res instanceof Response ? res.status : 0).toBe(429);
  });
});

describe('whoami (S2)', () => {
  it('says admin false until the row exists, then true, with the switch state', async () => {
    const k = await seeded();
    await k.db.prepare("DELETE FROM admin_member").run();
    const who = async (game?: string) => (await k.call('GET', '/stats/api/members/whoami', { game })).json();
    expect(await who()).toEqual({ admin: false, publicId: null, open: false });
    expect(await who(k.admin)).toEqual({ admin: false, publicId: 'ADMQ0001', open: false });
    await k.db.prepare("INSERT INTO admin_member VALUES ('adm', 1)").run();
    await k.flag('open');
    expect(await who(k.admin)).toEqual({ admin: true, publicId: 'ADMQ0001', open: true });
    expect(await who(k.player)).toEqual({ admin: false, publicId: 'PQYR0002', open: true });
  });

  it('needs the password session', async () => {
    const k = await seeded();
    expect((await k.call('GET', '/stats/api/members/whoami', { stats: false, game: k.admin })).status).toBe(401);
  });

  it('answers 503 without the accounts database and never reads env.DB', async () => {
    const k = adminKit({ noDb: true });
    k.env.ACCOUNTS = undefined as never;
    expect((await k.call('GET', '/stats/api/members/whoami')).status).toBe(503);
    const k2 = adminKit({ noDb: true });
    expect((await k2.call('GET', '/stats/api/members/whoami')).status).toBe(200); // DB undefined, ACCOUNTS bound
  });
});

describe('/stats/api/members/blank is untouched (S2)', () => {
  it('still blanks a display name by public id', async () => {
    const k = await seeded();
    const res = await k.call('POST', '/stats/api/members/blank', { body: { publicId: 'PQYR0002' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ changed: 1 });
  });
});
