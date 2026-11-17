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
import { PLAYER_KEY, TESTER_KEY, resolveIdentity, safeStorage } from './identity';
import { testerLabel } from '../feedback/gate';

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
// Every `initTelemetry` adds a pagehide listener to the one jsdom window; taken down after each test, or a later test's pagehide would
// also flush an earlier test's (module-reset) instance and its queue.
let pagehides: EventListenerOrEventListenerObject[] = [];
const addListener = window.addEventListener.bind(window);

beforeEach(() => {
  pagehides = [];
  vi.spyOn(window, 'addEventListener').mockImplementation((type: string, fn: EventListenerOrEventListenerObject | null, o?: boolean | AddEventListenerOptions) => {
    if (fn === null) return;
    if (type === 'pagehide') pagehides.push(fn);
    addListener(type, fn, o);
  });
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
  for (const fn of pagehides) window.removeEventListener('pagehide', fn);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

type Sent = { type: string; player: string; session: string; tester?: string };
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
  // A copy of main.ts's wiring for these four deps (pinned below by a source check).
  const deps: ProfileDeps = {
    client: client(answer),
    store: null,
    query: new URLSearchParams(),
    telemetryPlayer: () => mod.telemetryPlayerForDeletion(),
    rotateTelemetry: () => mod.rotateTelemetryPlayer(),
    pauseTelemetry: () => mod.pauseTelemetrySends(),
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

  // Review finding 1 (PR 1532): events QUEUED in the Sender before the rotation still carry the old id. Left there, the reload's pagehide
  // beacon (or the next flush, sharing one POST with new-id events) sends them after the server deleted the old id's rows.
  it.each(['flush', 'pagehide'] as const)('events queued before the rotation are dropped, unsent, and the next event carries the new id (%s)', async (via) => {
    const beacons: Blob[] = [];
    Object.defineProperty(navigator, 'sendBeacon', { value: (_u: string, b: Blob) => { beacons.push(b); return true; }, configurable: true });
    vi.resetModules();
    const mod = await import('./index');
    const tel = mod.initTelemetry({ dev: false });
    const old = tel.ids();
    expect(old?.player).toBe(PLAYER);
    // Queued, not yet sent: neither event flushes on its own.
    tel.sessionStart('menu', 'three');
    tel.boot(100);
    expect(bodies).toEqual([]);
    mod.rotateTelemetryPlayer();
    // The rotation itself sends nothing, by fetch or by beacon.
    expect(bodies).toEqual([]);
    expect(beacons).toEqual([]);
    if (via === 'flush') tel.clientError(describeError(new Error('after'))); // pushes, then flushes over fetch
    else window.dispatchEvent(new Event('pagehide')); // the reload's beacon
    for (const b of beacons) bodies.push(await b.text());
    const all = sent();
    const stored = storage.getItem(PLAYER_KEY);
    expect(stored).toMatch(ID_PATTERN);
    expect(stored).not.toBe(PLAYER);
    expect(all.filter((e) => e.player === PLAYER || e.session === old?.session)).toEqual([]);
    if (via === 'pagehide') {
      expect(all).toEqual([]);
      tel.clientError(describeError(new Error('after')));
    }
    const next = sent().at(-1);
    expect(next?.type).toBe('client_error');
    expect(next?.player).toBe(stored);
    expect(next?.session).toMatch(ID_PATTERN);
    expect(next?.session).not.toBe(old?.session);
    expect(sent().every((e) => e.player === stored)).toBe(true);
  });

  // Review finding 2 (PR 1532): the tester branch of `ids()` (a `?tester` label set) must answer the NEW id too, or a tester's feedback
  // note after a delete would carry the deleted account's telemetry id. Lead ruling T2: the label itself is dropped by the rotation.
  it('with a ?tester label, ids() after the rotation answers the new player and session, and no label', async () => {
    window.history.pushState({}, '', 'http://localhost:3000/?telemetry&tester=alice');
    vi.resetModules();
    const mod = await import('./index');
    const tel = mod.initTelemetry({ dev: false });
    const before = tel.ids();
    expect(before).toMatchObject({ player: PLAYER, tester: 'alice' });
    mod.rotateTelemetryPlayer();
    const after = tel.ids();
    const stored = storage.getItem(PLAYER_KEY);
    expect(stored).toMatch(ID_PATTERN);
    expect(stored).not.toBe(PLAYER);
    expect(after).toEqual({ player: stored, session: expect.stringMatching(ID_PATTERN) });
    expect(after?.session).not.toBe(before?.session);
  });

  it('main.ts wires the profile screen to the telemetry module\'s rotation and pause', () => {
    const main = readFileSync(join(__dirname, '..', 'main.ts'), 'utf8');
    expect(main).toMatch(/rotateTelemetry:\s*\(\)\s*=>\s*rotateTelemetryPlayer\(\)/);
    expect(main).toMatch(/pauseTelemetry:\s*\(\)\s*=>\s*pauseTelemetrySends\(\)/);
  });
});

/**
 * Lead ruling T2, 17 Nov 2026: a SUCCESSFUL account delete also forgets the stored `?tester` label (through `identity.ts`'s own remover), so
 * no label links the deleted account's telemetry id to the next one: not in storage, not on a later event of this page, not on the next boot.
 */
describe('a successful account delete clears the stored ?tester label (T2)', () => {
  beforeEach(() => {
    window.history.pushState({}, '', 'http://localhost:3000/?telemetry&tester=alice');
  });

  it('the stored label is removed, later events carry none, and neither the feedback reader nor the next boot finds it', async () => {
    const { before, after, reloads } = await deleteWith(async () => 'ok');
    expect(reloads).toBe(1);
    expect(before.tester).toBe('alice');
    expect(storage.getItem(TESTER_KEY)).toBeNull();
    expect(after.tester).toBeUndefined();
    expect(after.player).toBe(storage.getItem(PLAYER_KEY));
    // The reload lands without `?tester` (it is not a sticky key): neither reader of the stored label finds one.
    const store = safeStorage(() => window.localStorage);
    expect(testerLabel({ query: new URLSearchParams(), storage: store })).toBeUndefined();
    expect(resolveIdentity(store, new URLSearchParams(), () => 'unused').tester).toBeUndefined();
  });

  it.each<[string, AccountError]>([
    ['reauth', { error: 'reauth', status: 403 }],
    ['server', { error: 'server', status: 500 }],
  ])('a failed delete (%s) keeps the stored label', async (_why, err) => {
    const { after } = await deleteWith(async () => err);
    expect(storage.getItem(TESTER_KEY)).toBe('alice');
    expect(after.tester).toBe('alice');
  });

  it('a browser that never held a player id still forgets a stored label', async () => {
    storage = memoryStorage({ [TESTER_KEY]: 'alice' });
    Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
    Object.defineProperty(navigator, 'globalPrivacyControl', { value: true, configurable: true });
    vi.resetModules();
    const mod = await import('./index');
    mod.initTelemetry({ dev: false });
    mod.rotateTelemetryPlayer();
    expect(storage.getItem(TESTER_KEY)).toBeNull();
    expect(storage.getItem(PLAYER_KEY)).toBeNull();
    expect(bodies).toEqual([]);
  });
});

/**
 * Lead ruling T1, 17 Nov 2026: the report queue PAUSES before the delete request is sent. While it is in flight no send leaves (the 30 s
 * interval flush, a crash's immediate flush, the pagehide beacon). On success the queue is dropped with the rotation and sends resume under
 * the new id; on failure sends resume under the old id with nothing lost.
 */
describe('the telemetry queue pauses while an account delete is in flight (T1)', () => {
  let beacons: Blob[] = [];
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    beacons = [];
    Object.defineProperty(navigator, 'sendBeacon', { value: (_u: string, b: Blob) => { beacons.push(b); return true; }, configurable: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(navigator, 'sendBeacon', { value: undefined, configurable: true });
  });

  const posted = async (): Promise<Sent[]> => {
    for (const b of beacons.splice(0)) bodies.push(await b.text());
    return sent();
  };

  /** Boots telemetry with two events QUEUED (not sent), mounts the profile screen and confirms a delete whose answer the test gives. */
  async function inFlight(): Promise<{ mod: typeof import('./index'); tel: ReturnType<typeof import('./index')['initTelemetry']>; answer: (r: 'ok' | AccountError) => Promise<void>; reloads: () => number }> {
    vi.resetModules();
    const mod = await import('./index');
    const { showProfile } = await import('../ui/profile');
    const tel = mod.initTelemetry({ dev: false });
    tel.sessionStart('menu', 'three');
    tel.boot(100);
    expect(bodies).toEqual([]);
    let settle: (r: 'ok' | AccountError) => void = () => undefined;
    const pending = new Promise<'ok' | AccountError>((r) => (settle = r));
    let reloads = 0;
    const stage = document.createElement('div');
    document.body.appendChild(stage);
    showProfile(stage, {
      client: client(() => pending),
      store: null,
      query: new URLSearchParams(),
      telemetryPlayer: () => mod.telemetryPlayerForDeletion(),
      rotateTelemetry: () => mod.rotateTelemetryPlayer(),
      pauseTelemetry: () => mod.pauseTelemetrySends(),
      navigate: () => undefined,
      reload: () => void reloads++,
    });
    await flush();
    const del = [...stage.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === t('profile.delete'));
    if (!del) throw new Error('no delete button');
    del.click();
    (document.querySelector('.rl-confirm__yes') as HTMLButtonElement).click();
    await flush();
    return { mod, tel, answer: async (r) => { settle(r); await flush(); }, reloads: () => reloads };
  }

  /** Every send path, tried while the request is in flight: a crash (push + immediate flush), the 30 s interval, the pagehide beacon. */
  async function tryEverySend(tel: { clientError: (e: ReturnType<typeof describeError>) => void }): Promise<void> {
    tel.clientError(describeError(new Error('during')));
    vi.advanceTimersByTime(30_000);
    window.dispatchEvent(new Event('pagehide'));
    expect(await posted()).toEqual([]);
  }

  it('while the request is in flight nothing is sent; on success the old queue is dropped and sends resume under the new id', async () => {
    const { tel, answer, reloads } = await inFlight();
    await tryEverySend(tel);
    await answer('ok');
    expect(reloads()).toBe(1);
    const stored = storage.getItem(PLAYER_KEY);
    expect(stored).toMatch(ID_PATTERN);
    expect(stored).not.toBe(PLAYER);
    // Resumed, and nothing of the old id was left to send.
    vi.advanceTimersByTime(30_000);
    expect(await posted()).toEqual([]);
    tel.clientError(describeError(new TypeError('after')));
    const all = await posted();
    expect(all.map((e) => e.type)).toEqual(['client_error']);
    expect(all[0]?.player).toBe(stored);
  });

  it.each<[string, AccountError]>([
    ['server', { error: 'server', status: 500 }],
    ['network', { error: 'network', status: 0 }],
    ['reauth', { error: 'reauth', status: 403 }],
  ])('on a failure (%s) sends resume under the old id, and nothing queued before or during the request is lost', async (_why, err) => {
    const { tel, answer, reloads } = await inFlight();
    const old = tel.ids();
    await tryEverySend(tel);
    await answer(err);
    expect(reloads()).toBe(0);
    expect(storage.getItem(PLAYER_KEY)).toBe(PLAYER);
    // Resuming sends nothing by itself: the next scheduled flush carries the whole queue, under the old ids.
    expect(await posted()).toEqual([]);
    vi.advanceTimersByTime(30_000);
    const all = await posted();
    expect(all.map((e) => e.type)).toEqual(['session_start', 'boot', 'client_error']);
    expect(all.every((e) => e.player === PLAYER && e.session === old?.session)).toBe(true);
  });

  it('a release resumes only its own hold, once', async () => {
    vi.resetModules();
    const mod = await import('./index');
    const tel = mod.initTelemetry({ dev: false });
    const a = mod.pauseTelemetrySends();
    const b = mod.pauseTelemetrySends();
    a();
    a();
    tel.clientError(describeError(new Error('held')));
    expect(await posted()).toEqual([]);
    b();
    vi.advanceTimersByTime(30_000);
    expect((await posted()).map((e) => e.type)).toEqual(['client_error']);
  });
});
