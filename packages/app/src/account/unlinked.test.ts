// @vitest-environment jsdom
//
// A1-10, the app half: telemetry, the feedback context and the match bodies never carry an account identifier.
// The four sentinels sit in the binding store, in a signed-in `me`, and in a display-name field; the corpus is every
// body those three sources produce, and none may contain one.
import { describe, expect, it } from 'vitest';
import type { MissionEvent } from '@lions/sim';
import type { TelemetryEvent } from '@lions/data/telemetry';
import { collectContext, type ContextInput } from '../feedback/context';
import { connectMatch, openRoom } from '../net/connect';
import { createTelemetry, type RuntimeView, type TelemetryDeps } from '../telemetry';
import { resolveIdentity } from '../telemetry/identity';
import { ACCOUNT_BINDING_KEY, readBinding } from './binding';
import type { AccountClient } from './client';
import { resolveSignedIn } from './signed-in';

const SENTINELS = ['ZZZZ9999', 'SentinelName', '76561197960287930', 'tok-sentinel'] as const;

function memStore() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    m,
  };
}

const me = {
  kind: 'signedIn' as const,
  publicId: 'ZZZZ9999',
  displayName: 'SentinelName',
  showRecord: true,
  fresh: true,
  identities: [{ id: 'tok-sentinel', provider: 'steam', label: null, createdAt: 1, lastUsedDay: null, steamId: '76561197960287930' }],
};
const client: AccountClient = {
  enabled: true,
  open: async () => true,
  me: async () => me,
  steamStart: async () => ({ url: 'https://steam.example/?tok-sentinel' }),
  logout: async () => 'ok',
  logoutAll: async () => 'ok',
  patchProfile: async () => 'ok',
  deleteIdentity: async () => 'ok',
  exportData: async () => new Blob([]),
  deleteAccount: async () => 'ok',
  gone: async () => 'unknown',
};

async function corpus(): Promise<{ bodies: Record<string, string[]>; store: ReturnType<typeof memStore> }> {
  const store = memStore();
  // The signed-in state is real: resolveSignedIn writes the binding the way the profile screen does.
  await resolveSignedIn(client, store);
  expect(readBinding(store)?.publicId).toBe('ZZZZ9999');
  store.setItem('lions.account.session', 'tok-sentinel');
  expect(store.m.get(ACCOUNT_BINDING_KEY)).toContain('ZZZZ9999');
  // Also in the page's own storage, where a code path reading `window.localStorage` would find it.
  try {
    window.localStorage.setItem(ACCOUNT_BINDING_KEY, store.m.get(ACCOUNT_BINDING_KEY) ?? '');
  } catch {
    /* a jsdom without a real Storage: the store handed to the code under test still holds it */
  }

  const bodies: Record<string, string[]> = { telemetry: [], context: [], create: [], join: [], connect: [] };

  // Telemetry: session_start, mission_start, mission_end, account.
  const sent: TelemetryEvent[] = [];
  const deps: TelemetryDeps = {
    identity: resolveIdentity(store, new URLSearchParams(), () => '0f8fad5b-d9cb-469f-a165-70867728950e'),
    newSession: () => '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    build: '0.0.0',
    dev: false,
    now: () => 1000,
    viewport: () => [1440, 900],
    visible: () => true,
    setInterval: () => 0,
    clearInterval: () => {},
    onPagehide: () => {},
    sink: { push: (e) => void sent.push(e), flush: () => {} },
  };
  const tel = createTelemetry(deps);
  const state: RuntimeView = { tick: 100, result: 'victory', defeatCause: undefined, roe: 100, fielded: 5, lost: 0, objectives: [{ id: 'hold', type: 'hold_for', primary: true, status: 'active' }] };
  tel.sessionStart('menu', 'three');
  const m = tel.missionStarted('m1', false, () => state);
  m.onEvent({ kind: 'missionEnd', tick: 100, result: 'victory', roeRating: 90, survivors: [], ledger: {} } as MissionEvent);
  m.end();
  tel.account('reset', { balance: 0, earned_total: 0, unlocks: [], upgrades: {} });
  bodies.telemetry = sent.map((e) => JSON.stringify(e));
  expect(new Set(sent.map((e) => e.type))).toEqual(new Set(['session_start', 'mission_start', 'mission_end', 'account']));

  // The feedback context.
  const input: ContextInput = {
    renderer: 'three',
    viewport: [1920, 1080],
    dpr: 2,
    locale: 'en',
    ua: 'ua',
    route: '/profile',
    settings: { uiScale: 'auto', textSize: 1, motion: 'system', colorVision: 'default' },
    errors: [],
  };
  bodies.context.push(JSON.stringify(collectContext(input)));

  // The match bodies: a create and a join through openRoom, a create through connectMatch. The fetch stub records and
  // answers 500, so each call ends in a refusal after its request.
  const record = (into: string[]) => async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    into.push(String(init?.body ?? ''));
    return new Response('{}', { status: 500 });
  };
  const open = (into: string[]) => ({ fetch: record(into) as typeof fetch, origin: 'https://x.example', openSocket: () => { throw new Error('no socket'); }, store, session: null });
  await openRoom({ kind: 'create', map: 'beit_sahwan_outskirts', callsign: 'Cs' }, 'b', open(bodies.create)).catch(() => undefined);
  await openRoom({ kind: 'join', code: 'ABCD', callsign: 'Cs' }, 'b', open(bodies.join)).catch(() => undefined);
  await connectMatch(new URLSearchParams('net=new'), 'beit_sahwan_outskirts', 'b', {
    ...open(bodies.connect),
    replaceUrl: () => {},
    note: () => {},
  }).catch(() => undefined);
  return { bodies, store };
}

describe('telemetry, feedback and match stay unlinked from the account (A1-10)', () => {
  it('no sentinel appears in any body, and every source produced one', async () => {
    const { bodies } = await corpus();
    for (const [source, list] of Object.entries(bodies)) {
      expect(list.length, `${source} produced no body`).toBeGreaterThan(0);
      for (const body of list) {
        expect(body.length, `${source} body is empty`).toBeGreaterThan(2);
        for (const s of SENTINELS) expect(body, `${source} carries ${s}`).not.toContain(s);
      }
    }
  });
});
