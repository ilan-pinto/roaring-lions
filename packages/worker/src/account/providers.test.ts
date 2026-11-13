/** GH-1075 G5: `GET open` lists the providers that work, and `steam/start` is gated on its flag (spec U1, U3). */
import { describe, expect, it } from 'vitest';
import { accountHarness } from './test-kit';

type H = ReturnType<typeof accountHarness>;

const count = async (h: H, table: string): Promise<number> =>
  (await h.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())?.n ?? -1;

const listed = async (h: H): Promise<unknown> => ((await (await h.call('GET', '/api/account/open')).json()) as { providers: unknown }).providers;
const setFlag = (h: H, name: string, value: string) => h.db.prepare('INSERT OR REPLACE INTO flags VALUES (?1, ?2, 0)').bind(name, value).run();

function secrets(h: H, on: boolean): void {
  if (on) {
    h.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
    h.env.GOOGLE_CLIENT_SECRET = 'test-secret-sentinel';
  }
}

describe('GET open lists the providers that work (U1)', () => {
  // secrets x flag, for Google. Only secrets AND the flag list it.
  const CASES: [string, boolean, string | null, unknown][] = [
    ['no secrets, no flag row', false, null, []],
    ['no secrets, flag open', false, 'open', []],
    ['secrets, no flag row', true, null, []],
    ['secrets, flag closed', true, 'closed', []],
    ['secrets, flag open', true, 'open', ['google']],
  ];
  for (const [name, haveSecrets, flag, want] of CASES) {
    it(`google: ${name} -> ${JSON.stringify(want)}`, async () => {
      const h = accountHarness();
      secrets(h, haveSecrets);
      if (flag !== null) await setFlag(h, 'google', flag);
      expect(await listed(h)).toEqual(want);
    });
  }

  it('a blank client id counts as no secret', async () => {
    const h = accountHarness();
    h.env.GOOGLE_CLIENT_ID = '   ';
    h.env.GOOGLE_CLIENT_SECRET = 'x';
    await setFlag(h, 'google', 'open');
    expect(await listed(h)).toEqual([]);
  });

  it('steam: listed only when flags.steam is open; a missing row is not listed', async () => {
    const h = accountHarness();
    expect(await listed(h)).toEqual([]);
    await setFlag(h, 'steam', 'closed');
    expect(await listed(h)).toEqual([]);
    await setFlag(h, 'steam', 'open');
    expect(await listed(h)).toEqual(['steam']);
  });

  it('both, in a fixed order, and independent of flags.accounts', async () => {
    const h = accountHarness();
    secrets(h, true);
    await setFlag(h, 'steam', 'open');
    await setFlag(h, 'google', 'open');
    const res = await (await h.call('GET', '/api/account/open')).json();
    expect(res).toEqual({ open: false, providers: ['google', 'steam'] });
  });
});

describe('google/start ignores flags.google (the lead tests before opening)', () => {
  it('with secrets and the flag closed, start still answers 200 and writes a challenge', async () => {
    const h = accountHarness();
    secrets(h, true);
    await setFlag(h, 'google', 'closed');
    const res = await h.call('POST', '/api/account/google/start', { body: { purpose: 'google-login' } });
    expect(res.status).toBe(200);
    expect(await count(h, 'auth_challenge')).toBe(1);
  });
});

describe('steam/start is gated on flags.steam, before startBudget', () => {
  for (const flag of [null, 'closed']) {
    it(`flag ${flag ?? 'missing'}: 503 provider_off, no challenge, no budget spent`, async () => {
      const h = accountHarness();
      if (flag !== null) await setFlag(h, 'steam', flag);
      for (const purpose of ['steam-login', 'steam-link']) {
        const res = await h.call('POST', '/api/account/steam/start', { body: { purpose } });
        expect(res.status).toBe(503);
        expect(await res.json()).toEqual({ error: 'provider_off' });
      }
      expect(await count(h, 'auth_challenge')).toBe(0);
      expect(await count(h, 'rate_day')).toBe(0);
    });
  }

  it('flag open: start answers 200 and writes one challenge', async () => {
    const h = accountHarness();
    await setFlag(h, 'steam', 'open');
    const res = await h.call('POST', '/api/account/steam/start', { body: { purpose: 'steam-login' } });
    expect(res.status).toBe(200);
    expect(await count(h, 'auth_challenge')).toBe(1);
  });
});
