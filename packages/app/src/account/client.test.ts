import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { accountsEnabled } from './enabled';
import { emptyAccount } from '@lions/economy';
import { createAccountClient, readReturnCode, readReturnProvider, RETURN_CODES, type CampaignOp, type SlotPutOp, type VictoryOp } from './client';
import { slotOf } from './fixtures';

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function make(query: string, reply: () => Response = () => json(200, {})) {
  const spy = vi.fn<(u: RequestInfo | URL, i?: RequestInit) => Promise<Response>>(() => Promise.resolve(reply()));
  let n = 0;
  const client = createAccountClient({ enabled: accountsEnabled(new URLSearchParams(query)), fetch: spy as unknown as typeof fetch, newOpId: () => `op${++n}` });
  return { spy, client };
}

const BODY = { ledger: {}, brigade: emptyAccount(), tutorialDone: false };
const VICTORY: VictoryOp = { kind: 'victory', opId: 'v1', missionId: 'm', stars: 2, start: 'n', campaign: BODY };
const CAMPAIGN: CampaignOp = { kind: 'campaign', opId: 'c1', campaign: BODY };
const SLOT_PUT: SlotPutOp = { kind: 'slot.put', opId: 'p1', slotId: 's1', slot: slotOf('s1', 'Name', 7), origin: 'conflict' };

async function callAll(c: ReturnType<typeof make>['client']): Promise<void> {
  await c.open();
  await c.me();
  await c.steamStart('steam-login');
  await c.logout();
  await c.logoutAll();
  await c.patchProfile({ showRecord: true });
  await c.deleteIdentity('x');
  await c.exportData();
  await c.deleteAccount({});
  await c.gone('a'.repeat(64));
  await c.state();
  await c.slot('s');
  await c.missionStart('m');
  await c.victory(VICTORY, 3);
  await c.putCampaign(CAMPAIGN, 3);
  await c.spend({ item: 'unit', unitId: 'u' });
  await c.coupon('code');
  await c.resetFree();
  await c.putSlot(SLOT_PUT);
  await c.deleteSlot({ kind: 'slot.delete', opId: 'd1', slotId: 's' });
}

describe('off means no request (A1-11)', () => {
  for (const q of ['', '?accounts&fresh']) {
    it(`never calls fetch for "${q}"`, async () => {
      const { spy, client } = make(q);
      await callAll(client);
      expect(spy).not.toHaveBeenCalled();
      expect(await client.me()).toEqual({ kind: 'off' });
      expect(await client.deleteAccount({})).toEqual({ error: 'off', status: 0 });
    });
  }
  it('?accounts: me() calls fetch once with the path and the header', async () => {
    const { spy, client } = make('?accounts', () => json(401, { error: 'signed_out' }));
    expect(await client.me()).toEqual({ kind: 'signedOut' });
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] ?? [];
    expect(url).toBe('/api/account/me');
    expect((init?.headers as Record<string, string>)['x-rl-account']).toBe('1');
    expect(init?.credentials).toBe('same-origin');
  });
});

describe('me copies the profile fields by name (GH-1075 P4)', () => {
  const WIRE = {
    publicId: 'ABCD2345',
    displayName: 'Ilan',
    showRecord: true,
    avatar: { kind: 'preset', id: 'crest-lion', chosen: true },
    createdDay: 20_000,
    fresh: true,
    identities: [],
  };
  it('avatar and createdDay survive the copy', async () => {
    const { client } = make('?accounts', () => json(200, WIRE));
    expect(await client.me()).toEqual({ kind: 'signedIn', ...WIRE });
  });
  it('patchProfile sends the avatar id, and null to reset', async () => {
    const { client, spy } = make('?accounts', () => json(200, {}));
    await client.patchProfile({ avatar: 'crest-claw' });
    await client.patchProfile({ avatar: null });
    const bodies = spy.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);
    expect(bodies[0]).toMatchObject({ avatar: 'crest-claw' });
    expect(bodies[1]).toMatchObject({ avatar: null });
  });
});

describe('sign out reports its result (A1 follow-up 1)', () => {
  it('a server failure is an error, a 401 (already signed out) is ok', async () => {
    expect(await make('?accounts', () => json(500, { error: 'boom' })).client.logout()).toEqual({ error: 'boom', status: 500 });
    expect(await make('?accounts', () => json(503, {})).client.logoutAll()).toMatchObject({ status: 503 });
    expect(await make('?accounts', () => json(401, { error: 'signed_out' })).client.logout()).toBe('ok');
    expect(await make('?accounts', () => json(401, { error: 'signed_out' })).client.logoutAll()).toMatchObject({ status: 401 });
    expect(await make('?accounts', () => json(200, {})).client.logoutAll()).toBe('ok');
    const net = createAccountClient({ enabled: true, fetch: (() => Promise.reject(new Error('x'))) as unknown as typeof fetch, newOpId: () => 'o' });
    expect(await net.logout()).toEqual({ error: 'network', status: 0 });
  });
});

describe('every body method sends content-type json (the worker answers 415 otherwise)', () => {
  it('POST, PATCH and DELETE, empty bodies as {}', async () => {
    const { spy, client } = make('?accounts');
    await client.logout();
    await client.logoutAll();
    await client.deleteAccount({});
    await client.patchProfile({ displayName: 'Abc' });
    await client.deleteIdentity('i1');
    await client.steamStart('steam-link');
    await client.gone('b'.repeat(64));
    expect(spy).toHaveBeenCalledTimes(7);
    for (const [, init] of spy.mock.calls) {
      expect((init?.headers as Record<string, string>)['content-type']).toBe('application/json');
      expect(typeof init?.body).toBe('string');
      expect(() => JSON.parse(String(init?.body))).not.toThrow();
    }
    const bodies = spy.mock.calls.map(([, i]) => JSON.parse(String(i?.body)) as Record<string, unknown>);
    expect(bodies[0]).toEqual({});
    expect(bodies[3]).toEqual({ op_id: 'op1', displayName: 'Abc' });
    expect(bodies[4]).toEqual({ op_id: 'op2' });
  });
  it('a GET has no body', async () => {
    const { spy, client } = make('?accounts');
    await client.exportData();
    expect(spy.mock.calls[0]?.[1]?.body).toBeUndefined();
  });
});

describe('results', () => {
  it('an error response carries the worker code and status', async () => {
    const { client } = make('?accounts', () => json(403, { error: 'reauth' }));
    expect(await client.deleteIdentity('i')).toEqual({ error: 'reauth', status: 403 });
    expect(await client.exportData()).toEqual({ error: 'reauth', status: 403 });
  });
  it('a thrown fetch is a network error, not a throw', async () => {
    const client = createAccountClient({ enabled: true, fetch: (() => Promise.reject(new Error('x'))) as unknown as typeof fetch, newOpId: () => 'o' });
    expect(await client.patchProfile({ showRecord: false })).toEqual({ error: 'network', status: 0 });
    expect(await client.me()).toEqual({ kind: 'off' });
    expect(await client.gone('c'.repeat(64))).toBe('unknown');
  });
  it('gone: 410 is deleted, 404 unknown', async () => {
    expect(await make('?accounts', () => json(410, { deleted: true })).client.gone('d'.repeat(64))).toBe('deleted');
    expect(await make('?accounts', () => json(404, {})).client.gone('d'.repeat(64))).toBe('unknown');
  });
  it('reads the r= return code, ignoring unknown values', () => {
    expect(readReturnCode(new URLSearchParams('accounts&r=linked'))).toBe('linked');
    expect(readReturnCode(new URLSearchParams('r=bogus'))).toBeNull();
    expect(readReturnCode(new URLSearchParams(''))).toBeNull();
  });
  it('knows the Google codes (GH-1075 G5)', () => {
    expect(readReturnCode(new URLSearchParams('r=google'))).toBe('google');
    expect(readReturnCode(new URLSearchParams('r=already'))).toBe('already');
    expect(RETURN_CODES).toHaveLength(12);
  });
  it('reads p= against an allow-list: an unknown or missing p is null', () => {
    expect(readReturnProvider(new URLSearchParams('r=ok&p=google'))).toBe('google');
    expect(readReturnProvider(new URLSearchParams('p=steam'))).toBe('steam');
    for (const q of ['p=discord', 'p=GOOGLE', 'p=', 'p=google%20', 'p=__proto__', 'r=ok', '']) expect(readReturnProvider(new URLSearchParams(q))).toBeNull();
  });
  it('providers() reads GET open and drops unknown names; a failure is an empty list', async () => {
    const a = make('?accounts', () => json(200, { open: true, providers: ['steam', 'discord', 'google', 7] }));
    expect(await a.client.providers()).toEqual(['google', 'steam']);
    expect(a.spy.mock.calls[0]?.[0]).toBe('/api/account/open');
    expect(await make('?accounts', () => json(200, { open: true })).client.providers()).toEqual([]);
    expect(await make('?accounts', () => json(200, { providers: 'google' })).client.providers()).toEqual([]);
    expect(await make('?accounts', () => json(503, { error: 'x' })).client.providers()).toEqual([]);
    const off = make('');
    expect(await off.client.providers()).toEqual([]);
    expect(off.spy).not.toHaveBeenCalled();
  });
  it('googleStart posts the purpose to google/start; a 503 is an AccountError', async () => {
    const ok = make('?accounts', () => json(200, { url: 'https://accounts.google.com/x' }));
    expect(await ok.client.googleStart('google-login')).toEqual({ url: 'https://accounts.google.com/x' });
    expect(ok.spy.mock.calls[0]?.[0]).toBe('/api/account/google/start');
    expect(JSON.parse(String(ok.spy.mock.calls[0]?.[1]?.body))).toEqual({ purpose: 'google-login' });
    expect(await make('?accounts', () => json(503, { error: 'provider_off' })).client.googleStart('google-link')).toEqual({ error: 'provider_off', status: 503 });
  });
});

describe('the A2 routes (GH-1075)', () => {
  it('each call names its route, method and body; base is the caller\'s', async () => {
    const { spy, client } = make('?accounts', () => json(200, { ok: true }));
    await client.state();
    await client.slot('a/b');
    await client.missionStart('m1');
    await client.victory(VICTORY, 3);
    await client.putCampaign(CAMPAIGN, 4);
    await client.spend({ item: 'tier', unitId: 'u', track: 'armor', tier: 2 });
    await client.coupon('CODE');
    await client.resetFree();
    await client.putSlot(SLOT_PUT);
    await client.deleteSlot({ kind: 'slot.delete', opId: 'd1', slotId: 's1' });
    await client.claim({ op_id: 'x', device_id: 'y', campaign: null, slots: [], wallet: {}, coupons: [] });
    await client.matches();
    await client.matches('1731400000.K7Q2');
    const seen = spy.mock.calls.map(([u, i]) => `${i?.method} ${String(u)}`);
    expect(seen).toEqual([
      'GET /api/account/state',
      'GET /api/account/slots/a%2Fb',
      'POST /api/account/mission/start',
      'POST /api/account/victory',
      'PUT /api/account/campaign',
      'POST /api/account/spend',
      'POST /api/account/coupon',
      'POST /api/account/reset-free',
      'PUT /api/account/slots/s1',
      'DELETE /api/account/slots/s1',
      'POST /api/account/claim',
      'GET /api/account/matches',
      'GET /api/account/matches?before=1731400000.K7Q2',
    ]);
    const body = (n: number): Record<string, unknown> => JSON.parse(String(spy.mock.calls[n]?.[1]?.body)) as Record<string, unknown>;
    expect(body(2)).toEqual({ op_id: 'op1', missionId: 'm1' });
    expect(body(3)).toMatchObject({ op_id: 'v1', missionId: 'm', stars: 2, start: 'n', base: 3 });
    expect(body(4)).toMatchObject({ op_id: 'c1', base: 4, tutorialDone: false });
    expect(body(5)).toEqual({ op_id: 'op2', item: 'tier', unitId: 'u', track: 'armor', tier: 2 });
    expect(body(8)).toMatchObject({ op_id: 'p1', name: 'Name', savedAt: 7, origin: 'conflict' });
    expect(spy.mock.calls[0]?.[1]?.body).toBeUndefined();
  });
  it('a 200 is ok with its body; any other status carries what the server said; a thrown fetch is status 0', async () => {
    expect(await make('?accounts', () => json(200, { a: 1 })).client.state()).toEqual({ ok: true, status: 200, body: { a: 1 } });
    expect(await make('?accounts', () => json(409, { error: 'busy' })).client.state()).toEqual({ ok: false, status: 409, body: { error: 'busy' } });
    expect(await make('?accounts', () => new Response('not json', { status: 502 })).client.state()).toEqual({ ok: false, status: 502, body: null });
    const net = createAccountClient({ enabled: true, fetch: (() => Promise.reject(new Error('x'))) as unknown as typeof fetch, newOpId: () => 'o' });
    expect(await net.state()).toMatchObject({ ok: false, status: 0 });
    expect(await make('', () => json(200, {})).client.state()).toMatchObject({ ok: false, status: 0 });
  });
});

describe('a source scan', () => {
  it('only account/client.ts names /api/account', () => {
    const root = join(__dirname, '..');
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && readFileSync(p, 'utf8').includes('/api/account')) hits.push(p.slice(root.length + 1));
      }
    };
    walk(root);
    expect(hits).toEqual(['account/client.ts']);
  });
});
