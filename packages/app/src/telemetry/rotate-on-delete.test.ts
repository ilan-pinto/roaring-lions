// @vitest-environment jsdom
/**
 * The lead's ruling of 17 Nov 2026: a SUCCESSFUL account delete rotates this browser's telemetry id, client side only. Driven end to end:
 * the real `initTelemetry` against a memory localStorage, the real profile screen's delete button and confirm, and a stub account client.
 * A failed delete (any non-success) leaves the id exactly as it was.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ID_PATTERN } from '@lions/data/telemetry';
import type { AccountClient, AccountError, MeResult } from '../account/client';
import { unusedA2Client } from '../account/fixtures';
import { t } from '../i18n/t';
import type { ProfileDeps } from '../ui/profile';
import { describeError } from './errors';
import { PLAYER_KEY } from './identity';

function memoryStorage(init: Record<string, string> = {}): Storage {
  const data = { ...init };
  return {
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => { data[k] = v; },
    removeItem: (k: string) => { delete data[k]; },
    clear: () => { for (const k of Object.keys(data)) delete data[k]; },
    key: (i: number) => Object.keys(data)[i] ?? null,
    get length() { return Object.keys(data).length; },
  } as Storage;
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

const signedIn: MeResult = { kind: 'signedIn', publicId: 'ABCD2345', displayName: 'Ilan', showRecord: false, avatar: { kind: 'preset', id: 'crest-chevrons', chosen: false }, createdDay: 0, fresh: true, identities: [] };

function client(deleteAccount: AccountClient['deleteAccount']): AccountClient {
  return {
    enabled: true,
    open: async () => true,
    me: async () => signedIn,
    steamStart: async () => ({ url: 'https://steam.example/login' }),
    providers: async () => ['steam'],
    googleStart: async () => ({ url: 'https://google.example/login' }),
    logout: async () => 'ok',
    logoutAll: async () => 'ok',
    patchProfile: async () => 'ok',
    deleteIdentity: async () => 'ok',
    exportData: async () => new Blob(['{}']),
    deleteAccount,
    gone: async () => 'unknown',
    ...unusedA2Client,
    matches: async () => ({ ok: true, status: 200, body: { matches: [], next: null, record: { won: 0, lost: 0, drawn: 0 } } }),
    coins: async () => ({ ok: true, status: 200, body: { rows: [], next: null } }),
  };
}

const PLAYER = '0f8fad5b-d9cb-469f-a165-70867728950e';
let bodies: string[] = [];
let storage: Storage = memoryStorage();

beforeEach(() => {
  vi.stubGlobal('__APP_BUILD__', '0.0.0-test');
  window.history.pushState({}, '', 'http://localhost:3000/?telemetry');
  Object.defineProperty(navigator, 'doNotTrack', { value: null, configurable: true });
  Object.defineProperty(navigator, 'globalPrivacyControl', { value: undefined, configurable: true });
  storage = memoryStorage({ [PLAYER_KEY]: PLAYER });
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
  bodies = [];
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init: { body: string }) => { bodies.push(init.body); return new Response(null, { status: 204 }); }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

type Sent = { type: string; player: string; session: string };
const sent = (): Sent[] => bodies.flatMap((b) => (JSON.parse(b) as { events: Sent[] }).events);

/** Boots telemetry, mounts the profile screen as main.ts wires it, and answers the delete confirm with yes. */
async function deleteWith(answer: () => Promise<'ok' | AccountError>, onConfirmed: (dispose: () => void) => Promise<void> = flush): Promise<{ before: Sent; after: Sent; reloads: number }> {
  vi.resetModules();
  const mod = await import('./index');
  const { showProfile } = await import('../ui/profile');
  const tel = mod.initTelemetry({ dev: false });
  tel.boot(100);
  tel.clientError(describeError(new Error('before')));
  const before = sent().at(-1);
  if (before === undefined) throw new Error('no event before the delete');
  const stage = document.createElement('div');
  document.body.appendChild(stage);
  let reloads = 0;
  // A copy of main.ts's wiring for these three deps (pinned below by a source check).
  const deps: ProfileDeps = {
    client: client(answer),
    store: null,
    query: new URLSearchParams(),
    telemetryPlayer: () => mod.telemetryPlayerForDeletion(),
    rotateTelemetry: () => mod.rotateTelemetryPlayer(),
    navigate: () => undefined,
    reload: () => void reloads++,
  };
  const dispose = showProfile(stage, deps);
  await flush();
  const del = [...stage.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === t('profile.delete'));
  if (!del) throw new Error('no delete button');
  del.click();
  (document.querySelector('.rl-confirm__yes') as HTMLButtonElement).click();
  await onConfirmed(dispose);
  tel.clientError(describeError(new TypeError('after')));
  const after = sent().at(-1);
  if (after === undefined || after === before) throw new Error('no event after the delete');
  return { before, after, reloads };
}

describe('a successful account delete rotates the telemetry id (lead ruling, 17 Nov)', () => {
  it('the stored id changes to a fresh well-formed id, and later events carry it and a new session', async () => {
    const { before, after, reloads } = await deleteWith(async () => 'ok');
    expect(reloads).toBe(1);
    expect(before.player).toBe(PLAYER);
    const stored = storage.getItem(PLAYER_KEY);
    expect(stored).not.toBe(PLAYER);
    expect(stored).toMatch(ID_PATTERN);
    expect(after.player).toBe(stored);
    expect(after.session).not.toBe(before.session);
    expect(after.session).toMatch(ID_PATTERN);
  });

  it('the player left the screen while the delete was in flight: a delete the server confirmed still rotates', async () => {
    let answer: (r: 'ok') => void = () => undefined;
    const pending = new Promise<'ok'>((r) => (answer = r));
    const { after, reloads } = await deleteWith(() => pending, async (dispose) => {
      await flush();
      dispose();
      answer('ok');
      await flush();
    });
    expect(reloads).toBe(0);
    const stored = storage.getItem(PLAYER_KEY);
    expect(stored).not.toBe(PLAYER);
    expect(stored).toMatch(ID_PATTERN);
    expect(after.player).toBe(stored);
  });

  it.each<[string, AccountError]>([
    ['reauth', { error: 'reauth', status: 403 }],
    ['network', { error: 'network', status: 0 }],
    ['server', { error: 'server', status: 500 }],
    ['off', { error: 'off', status: 0 }],
  ])('a failed delete (%s) leaves the id and the session unchanged', async (_why, err) => {
    const { before, after, reloads } = await deleteWith(async () => err);
    expect(reloads).toBe(0);
    expect(storage.getItem(PLAYER_KEY)).toBe(PLAYER);
    expect(after.player).toBe(PLAYER);
    expect(after.session).toBe(before.session);
  });

  it('a browser that never held an id (GPC: telemetry off) is given none by the rotation', async () => {
    storage = memoryStorage();
    Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
    Object.defineProperty(navigator, 'globalPrivacyControl', { value: true, configurable: true });
    vi.resetModules();
    const mod = await import('./index');
    mod.initTelemetry({ dev: false });
    mod.rotateTelemetryPlayer();
    expect(storage.getItem(PLAYER_KEY)).toBeNull();
    expect(bodies).toEqual([]);
  });

  it('an id stored before an opt-out is rotated too, and nothing is sent', async () => {
    storage.setItem('lions.telemetry.optout', '1');
    vi.resetModules();
    const mod = await import('./index');
    mod.initTelemetry({ dev: false });
    mod.rotateTelemetryPlayer();
    const stored = storage.getItem(PLAYER_KEY);
    expect(stored).not.toBe(PLAYER);
    expect(stored).toMatch(ID_PATTERN);
    expect(bodies).toEqual([]);
  });

  it('site data blocked (the storage ACCESS throws): the rotation does not throw, and the live session takes the new id', async () => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('SecurityError: access denied'); }, configurable: true });
    vi.resetModules();
    const mod = await import('./index');
    const tel = mod.initTelemetry({ dev: false });
    const before = tel.ids();
    expect(() => mod.rotateTelemetryPlayer()).not.toThrow();
    const after = tel.ids();
    expect(after?.player).toMatch(ID_PATTERN);
    expect(after?.player).not.toBe(before?.player);
    expect(after?.session).not.toBe(before?.session);
  });

  it('main.ts wires the profile screen to the telemetry module\'s rotation', () => {
    const main = readFileSync(join(__dirname, '..', 'main.ts'), 'utf8');
    expect(main).toMatch(/rotateTelemetry:\s*\(\)\s*=>\s*rotateTelemetryPlayer\(\)/);
  });
});
