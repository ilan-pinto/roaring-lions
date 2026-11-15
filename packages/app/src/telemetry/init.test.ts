// @vitest-environment jsdom
/** F2: a user who is not tracked must never get a player or tester id written
 *  to storage. Exercises `initTelemetry` end to end -- unlike index.test.ts,
 *  which drives `createTelemetry` directly with a fake `identity` already
 *  resolved -- because the bug was in the ordering initTelemetry itself does. */
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
});

