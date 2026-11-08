import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { accountsEnabled } from './enabled';
import { createAccountClient, readReturnCode } from './client';

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function make(query: string, reply: () => Response = () => json(200, {})) {
  const spy = vi.fn<(u: RequestInfo | URL, i?: RequestInit) => Promise<Response>>(() => Promise.resolve(reply()));
  let n = 0;
  const client = createAccountClient({ enabled: accountsEnabled(new URLSearchParams(query)), fetch: spy as unknown as typeof fetch, newOpId: () => `op${++n}` });
  return { spy, client };
}

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
