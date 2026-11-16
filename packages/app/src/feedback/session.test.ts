// Who a note is sent as (GH-464, spec §7 and the lead's v1 ruling).
import { describe, expect, it, vi } from 'vitest';
import { createFeedbackSession, type SessionDeps } from './session';
import { TESTER_KEY, type StorageLike } from '../telemetry/identity';
import type { FeedbackContext } from './context';

const PLAYER = '0b0b0b0b-1111-4222-8333-444444444444';
const SESSION = '0c0c0c0c-1111-4222-8333-444444444444';
const store = (init: Record<string, string> = {}): StorageLike => {
  const d = { ...init };
  return { getItem: (k) => d[k] ?? null, setItem: (k, v) => void (d[k] = v) };
};
const context = { renderer: 'three', viewport: [1, 1], dpr: 1, locale: 'en', ua: '', route: '/', settings: { uiScale: 'auto', textSize: 1, motion: 'system', colorVision: 'default' }, errors: [] } as FeedbackContext;
const deps = (o: Partial<SessionDeps> & { q?: string; storage?: StorageLike } = {}): SessionDeps => ({
  env: { prod: true, hostname: 'game.example', query: new URLSearchParams(o.q ?? ''), storage: o.storage ?? store() },
  optedOut: o.optedOut ?? false,
  build: '0.122.0',
  url: 'https://game.example/api/feedback',
  fetch: o.fetch ?? vi.fn(async () => new Response(JSON.stringify({ ref: 'FB-0001' }), { status: 201 })),
  ids: o.ids ?? (() => ({ player: PLAYER, session: SESSION })),
  now: () => 5,
});
const metaOf = async (fetch: ReturnType<typeof vi.fn>): Promise<Record<string, unknown>> => {
  const body = (fetch.mock.calls[0] as [string, RequestInit])[1].body as FormData;
  return JSON.parse(await (body.get('meta') as Blob).text()) as Record<string, unknown>;
};
const send = (s: ReturnType<typeof createFeedbackSession>) =>
  s.send({ source: 'pause', category: 'idea', text: 'more smoke', where: { context } });

describe('createFeedbackSession', () => {
  it('sends a tester with the label, the player and the session', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ref: 'FB-0002' }), { status: 201 }));
    const s = createFeedbackSession(deps({ storage: store({ [TESTER_KEY]: 'dana' }), ids: () => ({ player: PLAYER, session: SESSION, tester: 'dana' }), fetch }));
    expect(s.who).toEqual({ tester: 'dana', anonymous: false });
    await send(s);
    expect(await metaOf(fetch)).toMatchObject({ tester: 'dana', player: PLAYER, session: SESSION });
  });

  it('sends an untagged player anonymously, with the session id alone', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ref: 'FB-0003' }), { status: 201 }));
    const s = createFeedbackSession(deps({ fetch }));
    expect(s.who).toEqual({ anonymous: true });
    await send(s);
    const m = await metaOf(fetch);
    expect(m.session).toBe(SESSION);
    expect('player' in m || 'tester' in m).toBe(false);
  });

  it('sends an opt-out (?notrack, GPC, DNT) with no id at all, tester or not', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ref: 'FB-0004' }), { status: 201 }));
    const s = createFeedbackSession(deps({ optedOut: true, q: 'tester=dana', fetch }));
    expect(s.who).toEqual({ anonymous: true });
    await send(s);
    const m = await metaOf(fetch);
    expect('player' in m || 'session' in m || 'tester' in m).toBe(false);
  });
});

// GH-1417 S3: a report is sent as the session alone, whoever the player is.
describe('sendReport', () => {
  const report = { seat: 0 as const, reportedSeat: 1 as const, reason: 'abuse' as const, note: '', lines: [{ seat: 1 as const, text: 'rude' }], reportedPublicId: 'ABCDEFG1' };

  it('sends a TESTER as the session id alone: no tester label, no player id', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ref: 'FB-0009' }), { status: 201 }));
    const s = createFeedbackSession(deps({ storage: store({ [TESTER_KEY]: 'dana' }), ids: () => ({ player: PLAYER, session: SESSION, tester: 'dana' }), fetch }));
    expect((await s.sendReport(report)).kind).toBe('sent');
    const m = await metaOf(fetch);
    expect(m).toMatchObject({ source: 'match', category: 'report', session: SESSION });
    for (const k of ['tester', 'player', 'contact']) expect(k in m, k).toBe(false);
  });

  it('sends an opt-out with no id at all, and an untagged player with the session alone', async () => {
    const out = vi.fn(async () => new Response(JSON.stringify({ ref: 'FB-0010' }), { status: 201 }));
    await createFeedbackSession(deps({ optedOut: true, fetch: out })).sendReport(report);
    expect('session' in (await metaOf(out))).toBe(false);
    const anon = vi.fn(async () => new Response(JSON.stringify({ ref: 'FB-0011' }), { status: 201 }));
    await createFeedbackSession(deps({ fetch: anon })).sendReport(report);
    expect((await metaOf(anon)).session).toBe(SESSION);
  });

  it('is a dry run where feedback does not send, with no request', async () => {
    const fetch = vi.fn();
    const s = createFeedbackSession({ ...deps({ fetch }), env: { prod: false, hostname: 'localhost', query: new URLSearchParams(), storage: store() } });
    expect((await s.sendReport(report)).kind).toBe('dry-run');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('never makes a request for a report that cannot be built (nothing to point at)', async () => {
    const fetch = vi.fn();
    const s = createFeedbackSession(deps({ fetch }));
    expect(await s.sendReport({ ...report, lines: [] })).toEqual({ kind: 'failed', status: null });
    expect(fetch).not.toHaveBeenCalled();
  });
});

