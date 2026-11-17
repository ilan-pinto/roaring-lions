// @vitest-environment jsdom
/** F2: a user who is not tracked must never get a player or tester id written
 *  to storage. Exercises `initTelemetry` end to end -- unlike index.test.ts,
 *  which drives `createTelemetry` directly with a fake `identity` already
 *  resolved -- because the bug was in the ordering initTelemetry itself does. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLAYER_KEY, TESTER_KEY, OPTOUT_KEY } from './identity';

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

function installStorage(init: Record<string, string> = {}): Storage {
  const store = memoryStorage(init);
  Object.defineProperty(window, 'localStorage', { value: store, configurable: true });
  return store;
}

async function freshInitTelemetry() {
  vi.resetModules();
  return (await import('./index')).initTelemetry;
}

beforeEach(() => {
  vi.stubGlobal('__APP_BUILD__', '0.0.0-test');
  window.history.pushState({}, '', 'http://localhost:3000/');
  Object.defineProperty(navigator, 'doNotTrack', { value: null, configurable: true });
  Object.defineProperty(navigator, 'globalPrivacyControl', { value: undefined, configurable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// Every `initTelemetry` in this file puts error listeners on the SAME jsdom window (GH-1410); take them off after each test so one test's instance cannot answer the next one's error.
const added: [string, EventListenerOrEventListenerObject][] = [];
const realAdd = window.addEventListener.bind(window);
beforeEach(() => {
  window.addEventListener = ((t: string, f: EventListenerOrEventListenerObject, o?: unknown) => {
    if (t === 'error' || t === 'unhandledrejection') added.push([t, f]);
    realAdd(t, f, o as never);
  }) as typeof window.addEventListener;
});
afterEach(() => {
  for (const [t, f] of added.splice(0)) window.removeEventListener(t, f);
  window.addEventListener = realAdd;
});

describe('initTelemetry (F2: opt-out gate runs before identity is minted)', () => {
  it('a dev/CI session (off by default on localhost) stores no player or tester id', async () => {
    const storage = installStorage();
    const initTelemetry = await freshInitTelemetry();
    initTelemetry({ dev: false });
    expect(storage.getItem(PLAYER_KEY)).toBeNull();
    expect(storage.getItem(TESTER_KEY)).toBeNull();
  });

  it('DNT stores no player id even with ?telemetry forcing the switch', async () => {
    const storage = installStorage();
    window.history.pushState({}, '', 'http://localhost:3000/?telemetry&tester=dani');
    Object.defineProperty(navigator, 'doNotTrack', { value: '1', configurable: true });
    const initTelemetry = await freshInitTelemetry();
    initTelemetry({ dev: false });
    expect(storage.getItem(PLAYER_KEY)).toBeNull();
    expect(storage.getItem(TESTER_KEY)).toBeNull();
  });

  it('GPC stores no player id even with ?telemetry forcing the switch', async () => {
    const storage = installStorage();
    window.history.pushState({}, '', 'http://localhost:3000/?telemetry&tester=dani');
    Object.defineProperty(navigator, 'globalPrivacyControl', { value: true, configurable: true });
    const initTelemetry = await freshInitTelemetry();
    initTelemetry({ dev: false });
    expect(storage.getItem(PLAYER_KEY)).toBeNull();
    expect(storage.getItem(TESTER_KEY)).toBeNull();
  });

  it('a previously opted-out visitor stores no new player or tester id', async () => {
    const storage = installStorage({ [OPTOUT_KEY]: '1' });
    window.history.pushState({}, '', 'http://localhost:3000/?telemetry&tester=dani');
    const initTelemetry = await freshInitTelemetry();
    initTelemetry({ dev: false });
    expect(storage.getItem(PLAYER_KEY)).toBeNull();
    expect(storage.getItem(TESTER_KEY)).toBeNull();
  });

  it('the enabled path is unchanged: ?telemetry with no privacy signal mints and stores a player id', async () => {
    const storage = installStorage();
    window.history.pushState({}, '', 'http://localhost:3000/?telemetry');
    const initTelemetry = await freshInitTelemetry();
    const tel = initTelemetry({ dev: false });
    expect(storage.getItem(PLAYER_KEY)).not.toBeNull();
    expect(() => tel.sessionStart('menu', 'three')).not.toThrow();
  });
});

// GH-1410: crashes are listened for only where telemetry is on.
describe('initTelemetry (GH-1410: client errors)', () => {

  it('a dev/CI session (off on localhost) adds no error listener and sends nothing for an error', async () => {
    installStorage();
    const add = vi.spyOn(window, 'addEventListener');
    const initTelemetry = await freshInitTelemetry();
    initTelemetry({ dev: false });
    expect(add.mock.calls.filter(([t]) => t === 'error' || t === 'unhandledrejection')).toEqual([]);
    add.mockRestore();
  });

  it.each([
    ['an opt-out', () => installStorage({ [OPTOUT_KEY]: '1' }), () => undefined],
    ['DNT', () => installStorage(), () => Object.defineProperty(navigator, 'doNotTrack', { value: '1', configurable: true })],
    ['GPC', () => installStorage(), () => Object.defineProperty(navigator, 'globalPrivacyControl', { value: true, configurable: true })],
  ])('%s adds no error listener even with ?telemetry', async (_why, store, signal) => {
    store();
    signal();
    window.history.pushState({}, '', 'http://localhost:3000/?telemetry');
    const add = vi.spyOn(window, 'addEventListener');
    const initTelemetry = await freshInitTelemetry();
    initTelemetry({ dev: false });
    expect(add.mock.calls.filter(([t]) => t === 'error' || t === 'unhandledrejection')).toEqual([]);
    add.mockRestore();
  });

  it('the enabled path listens for both, and an uncaught error reaches the sender as a client_error', async () => {
    installStorage();
    window.history.pushState({}, '', 'http://localhost:3000/?telemetry');
    const bodies: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: { body: string }) => { bodies.push(init.body); return new Response(null, { status: 204 }); }));
    const add = vi.spyOn(window, 'addEventListener');
    const initTelemetry = await freshInitTelemetry();
    initTelemetry({ dev: false });
    expect(add.mock.calls.filter(([t]) => t === 'error' || t === 'unhandledrejection').map(([t]) => t).sort()).toEqual(['error', 'unhandledrejection']);
    window.dispatchEvent(new ErrorEvent('error', { error: new RangeError('boom at /Users/dana/x/y'), message: 'boom' }));
    await Promise.resolve();
    const sent = bodies.flatMap((b) => (JSON.parse(b) as { events: { type: string; message?: string }[] }).events);
    expect(sent.find((e) => e.type === 'client_error')).toMatchObject({ message: 'boom at <path>' });
    add.mockRestore();
  });

  it('the Settings opt-out, set mid-session, stops the next event leaving', async () => {
    installStorage();
    window.history.pushState({}, '', 'http://localhost:3000/?telemetry');
    const bodies: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: { body: string }) => { bodies.push(init.body); return new Response(null, { status: 204 }); }));
    vi.resetModules();
    const mod = await import('./index');
    const tel = mod.initTelemetry({ dev: false });
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('first'), message: 'first' }));
    expect(bodies).toHaveLength(1);
    mod.telemetryOptOut.set(true);
    expect(mod.telemetryOptOut.get()).toBe(true);
    window.dispatchEvent(new ErrorEvent('error', { error: new TypeError('second'), message: 'second' }));
    tel.boot(100);
    expect(bodies).toHaveLength(1);
    mod.telemetryOptOut.set(false);
    expect(mod.telemetryOptOut.get()).toBe(false);
  });

  it('the Settings checkbox is the opt-out inverted: ON while reports are sent, and unchecking it opts out', async () => {
    const storage = installStorage();
    vi.resetModules();
    const mod = await import('./index');
    expect(mod.reportsSwitch.get()).toBe(true);
    mod.reportsSwitch.set(false);
    expect(storage.getItem(OPTOUT_KEY)).toBe('1');
    expect(mod.reportsSwitch.get()).toBe(false);
    mod.reportsSwitch.set(true);
    expect(storage.getItem(OPTOUT_KEY)).toBe('0');
    expect(mod.reportsSwitch.get()).toBe(true);
  });

  it('?notrack and the Settings switch are one setting: ?notrack leaves the checkbox OFF', async () => {
    installStorage();
    window.history.pushState({}, '', 'http://localhost:3000/?notrack');
    const initTelemetry = await freshInitTelemetry();
    initTelemetry({ dev: false });
    vi.resetModules();
    const mod = await import('./index');
    expect(mod.reportsSwitch.get()).toBe(false);
  });

  // The privacy review of GH-1410, REQUIRED: with site data blocked the stored opt-out cannot hold "off", so the switch must hold it in memory.
  function stubFetch(): string[] {
    const bodies: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: { body: string }) => { bodies.push(init.body); return new Response(null, { status: 204 }); }));
    return bodies;
  }
  const crashEvent = (msg: string) => new ErrorEvent('error', { error: new Error(msg), message: msg });
  const sentTypes = (bodies: string[]) => bodies.flatMap((b) => (JSON.parse(b) as { events: { type: string }[] }).events.map((e) => e.type));

  it('storage whose ACCESS throws (site data blocked): the switch turns off and STAYS off, and no client_error reaches fetch', async () => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('SecurityError: access denied'); }, configurable: true });
    window.history.pushState({}, '', 'http://localhost:3000/?telemetry');
    const bodies = stubFetch();
    vi.resetModules();
    const mod = await import('./index');
    const tel = mod.initTelemetry({ dev: false });
    window.dispatchEvent(crashEvent('first'));
    expect(sentTypes(bodies)).toEqual(['client_error']);
    expect(mod.reportsSwitch.get()).toBe(true);
    mod.reportsSwitch.set(false);
    expect(mod.reportsSwitch.get()).toBe(false); // the old code read ON again here
    window.dispatchEvent(crashEvent('second'));
    tel.boot(100);
    expect(sentTypes(bodies)).toEqual(['client_error']); // nothing more left
    mod.reportsSwitch.set(true);
    expect(mod.reportsSwitch.get()).toBe(true);
  });

  it('storage whose WRITE throws (quota, private mode): the switch still turns off and nothing more is sent', async () => {
    const store = installStorage();
    store.setItem = () => { throw new Error('QuotaExceededError'); };
    window.history.pushState({}, '', 'http://localhost:3000/?telemetry');
    const bodies = stubFetch();
    vi.resetModules();
    const mod = await import('./index');
    mod.initTelemetry({ dev: false });
    window.dispatchEvent(crashEvent('first'));
    expect(sentTypes(bodies)).toHaveLength(1);
    mod.reportsSwitch.set(false);
    expect(mod.reportsSwitch.get()).toBe(false);
    window.dispatchEvent(crashEvent('second'));
    expect(sentTypes(bodies)).toHaveLength(1);
  });

  it('a feedback note after a mid-session opt-out carries no ids: ids() is null once the switch is off', async () => {
    installStorage();
    window.history.pushState({}, '', 'http://localhost:3000/?telemetry&tester=dani');
    stubFetch();
    vi.resetModules();
    const mod = await import('./index');
    const tel = mod.initTelemetry({ dev: false });
    expect(tel.ids()).toMatchObject({ tester: 'dani' });
    mod.reportsSwitch.set(false);
    expect(tel.ids()).toBeNull();
    mod.reportsSwitch.set(true);
    expect(tel.ids()).toMatchObject({ tester: 'dani' });
  });
});


// GH-1431: "also delete my reports" at account deletion needs the browser's player id, and a player who switched reports off has `ids()` answering null.
describe('telemetryPlayerForDeletion: the id survives an opt-out, and reading it sends and stores nothing', () => {
  const PLAYER = '0f8fad5b-d9cb-469f-a165-70867728950e';
  function watch(): { bodies: string[]; fetch: ReturnType<typeof vi.fn> } {
    const bodies: string[] = [];
    const fetch = vi.fn(async (_u: string, init: { body: string }) => { bodies.push(init.body); return new Response(null, { status: 204 }); });
    vi.stubGlobal('fetch', fetch);
    return { bodies, fetch };
  }
  /** A storage that counts its writes, to prove a read stores nothing. */
  function counting(init: Record<string, string>): { store: Storage; writes: string[] } {
    const base = memoryStorage(init);
    const writes: string[] = [];
    const store = { ...base, getItem: base.getItem, setItem: (k: string, v: string) => { writes.push(k); base.setItem(k, v); } } as Storage;
    Object.defineProperty(window, 'localStorage', { value: store, configurable: true });
    return { store, writes };
  }

  it('opted out on an earlier visit: telemetry is off from boot, ids() is null, and the stored id is still named', async () => {
    const { writes } = counting({ [PLAYER_KEY]: PLAYER, [OPTOUT_KEY]: '1' });
    window.history.pushState({}, '', 'http://localhost:3000/?telemetry');
    const { fetch } = watch();
    vi.resetModules();
    const mod = await import('./index');
    const tel = mod.initTelemetry({ dev: false });
    expect(tel.ids()).toBeNull(); // today's source of the deletion id
    expect(mod.telemetryPlayerForDeletion()).toBe(PLAYER);
    expect(writes).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('switched off in this very session: ids() goes null, the id is still named, and nothing more leaves the page', async () => {
    counting({});
    window.history.pushState({}, '', 'http://localhost:3000/?telemetry');
    const { bodies } = watch();
    vi.resetModules();
    const mod = await import('./index');
    const tel = mod.initTelemetry({ dev: false });
    const player = tel.ids()?.player;
    expect(player).toMatch(/^[0-9a-f-]{36}$/);
    mod.reportsSwitch.set(false);
    expect(tel.ids()).toBeNull();
    const sentBefore = bodies.length;
    expect(mod.telemetryPlayerForDeletion()).toBe(player);
    tel.boot(100);
    expect(bodies.length).toBe(sentBefore);
  });

  it('site data blocked and switched off mid-session: the id the page minted in memory is still named', async () => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('SecurityError: access denied'); }, configurable: true });
    window.history.pushState({}, '', 'http://localhost:3000/?telemetry');
    watch();
    vi.resetModules();
    const mod = await import('./index');
    const tel = mod.initTelemetry({ dev: false });
    const player = tel.ids()?.player;
    mod.reportsSwitch.set(false);
    expect(tel.ids()).toBeNull();
    expect(mod.telemetryPlayerForDeletion()).toBe(player);
  });

  it('a browser that never held an id (GPC) names none, and the read mints and stores nothing', async () => {
    const { writes } = counting({});
    Object.defineProperty(navigator, 'globalPrivacyControl', { value: true, configurable: true });
    window.history.pushState({}, '', 'http://localhost:3000/?telemetry');
    watch();
    vi.resetModules();
    const mod = await import('./index');
    mod.initTelemetry({ dev: false });
    expect(mod.telemetryPlayerForDeletion()).toBeNull();
    expect(writes).toEqual([]);
  });

  it('a stored value that is not a player id is not sent', async () => {
    counting({ [PLAYER_KEY]: 'not-an-id; DROP TABLE', [OPTOUT_KEY]: '1' });
    watch();
    vi.resetModules();
    const mod = await import('./index');
    mod.initTelemetry({ dev: false });
    expect(mod.telemetryPlayerForDeletion()).toBeNull();
  });
});

describe('the profile screen is wired to it (GH-1431)', () => {
  it('main.ts hands the profile screen telemetryPlayerForDeletion, not ids(), which is null after an opt-out', () => {
    const main = readFileSync(join(__dirname, '..', 'main.ts'), 'utf8');
    expect(main).toMatch(/telemetryPlayer:\s*\(\)\s*=>\s*telemetryPlayerForDeletion\(\)/);
    expect(main).not.toMatch(/telemetryPlayer:[^\n]*ids\(\)/);
  });
});
