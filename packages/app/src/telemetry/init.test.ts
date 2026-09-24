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
