// The client half of POST /api/feedback (GH-464). The parts and the answers
// are the contract with the Worker (`packages/worker/src/feedback-ingest.ts`).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { feedbackBody, feedbackOpen, resetProbeForTest, sendFeedback, type FeedbackNote } from './client';
import { isClosed, resetClosedForTest } from './gate';
import type { FeedbackMeta } from './meta';

const meta = (o: Partial<FeedbackMeta> = {}): FeedbackMeta => ({
  v: 1,
  t: 1,
  source: 'pause',
  category: 'bug',
  text: 'the squad walked to the wrong wall',
  build: '0.122.0',
  context: { renderer: 'three', viewport: [1920, 1080], dpr: 1, locale: 'en', ua: 'x', route: '/mission/a', settings: { uiScale: 'auto', textSize: 1, motion: 'system', colorVision: 'default' }, errors: [] },
  ...o,
});
const shot = new Blob([new Uint8Array([0x52, 0x49, 0x46, 0x46])], { type: 'image/webp' });
const note = (o: Partial<FeedbackNote> = {}): FeedbackNote => ({ meta: meta(), shot, replay: '{"v":1}', ...o });
const answer = (status: number, body?: unknown) => vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status }));
const deps = (fetch: ReturnType<typeof answer>, sends = true) => ({ sends, url: 'https://x.test/api/feedback', fetch });

afterEach(() => {
  resetClosedForTest();
  resetProbeForTest();
});

describe('feedbackBody', () => {
  it('sends meta, the picture and the replay as three parts for a Bug from the pause form', async () => {
    const f = feedbackBody(note());
    expect([...new Set(f.keys())]).toEqual(['meta', 'shot', 'replay']);
    const m = f.get('meta') as Blob;
    expect(JSON.parse(await m.text()).category).toBe('bug');
    expect((f.get('shot') as Blob).type).toBe('image/webp');
    expect((f.get('shot') as File).name).toBe('shot.webp');
  });

  it('attaches the replay to a Bug only', () => {
    for (const category of ['balance', 'confusing', 'idea', 'praise'] as const) {
      const f = feedbackBody(note({ meta: meta({ category }) }));
      expect([category, f.has('replay')]).toEqual([category, false]);
    }
  });

  it('attaches nothing from the menu form, which has no picture or replay to give', () => {
    const f = feedbackBody(note({ meta: meta({ source: 'menu' }) }));
    expect([...new Set(f.keys())]).toEqual(['meta']);
  });
});

describe('sendFeedback', () => {
  it('is a dry run off a production host: no request leaves the machine', async () => {
    const fetch = answer(201, { ref: 'FB-0001' });
    expect(await sendFeedback(note(), deps(fetch, false))).toEqual({ kind: 'dry-run' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('answers 201 with the reference', async () => {
    const fetch = answer(201, { ref: 'FB-0042', id: 42 });
    expect(await sendFeedback(note(), deps(fetch))).toEqual({ kind: 'sent', ref: 'FB-0042' });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://x.test/api/feedback');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('passes on what the Worker stored a note WITHOUT (201 + dropped), and nothing else', async () => {
    expect(await sendFeedback(note(), deps(answer(201, { ref: 'FB-0043', id: 43, dropped: { picture: 'too_large' } })))).toEqual({
      kind: 'sent',
      ref: 'FB-0043',
      dropped: { picture: 'too_large' },
    });
    expect(
      await sendFeedback(note(), deps(answer(201, { ref: 'FB-0044', dropped: { picture: 'storage_full', replay: 'storage_full' } })))
    ).toEqual({ kind: 'sent', ref: 'FB-0044', dropped: { picture: 'storage_full', replay: 'storage_full' } });
    // An unknown reason or attachment is not a drop the form can name.
    expect(await sendFeedback(note(), deps(answer(201, { ref: 'FB-0045', dropped: { picture: 'cosmic_rays', note: 'too_large' } })))).toEqual({
      kind: 'sent',
      ref: 'FB-0045',
    });
  });

  it('reads 410 (the kill switch) and 403 as closed, calmly, for the rest of the session', async () => {
    for (const status of [410, 403]) {
      resetClosedForTest();
      expect(await sendFeedback(note(), deps(answer(status, { error: 'closed' })))).toEqual({ kind: 'closed' });
      expect([status, isClosed()]).toEqual([status, true]);
    }
  });

  it('reads any other failure as failed, and never as closed', async () => {
    for (const status of [400, 413, 500, 503]) {
      expect(await sendFeedback(note(), deps(answer(status, { error: 'x' })))).toEqual({ kind: 'failed', status });
    }
    expect(isClosed()).toBe(false);
  });

  it('passes a rate limit through with its wait, and never retries on its own', async () => {
    const fetch = answer(429, { retryAfter: 42 });
    expect(await sendFeedback(note(), deps(fetch))).toEqual({ kind: 'busy', retryAfter: 42 });
    const down = vi.fn(async () => {
      throw new TypeError('network');
    });
    expect(await sendFeedback(note(), { ...deps(answer(201)), fetch: down })).toEqual({ kind: 'failed', status: null });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(down).toHaveBeenCalledTimes(1);
  });

  it('reports an abort as aborted, not as a failure', async () => {
    const ac = new AbortController();
    ac.abort();
    const fetch = vi.fn(async () => {
      throw new DOMException('aborted', 'AbortError');
    });
    expect(await sendFeedback(note(), { ...deps(answer(201)), fetch, signal: ac.signal })).toEqual({ kind: 'aborted' });
  });
});

describe('feedbackOpen', () => {
  it('asks the switch once a session, and only where a send could happen', async () => {
    const fetch = answer(200, { open: false });
    expect(await feedbackOpen({ ...deps(fetch, false) })).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    expect(await feedbackOpen(deps(fetch))).toBe(false);
    expect(await feedbackOpen(deps(fetch))).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(isClosed()).toBe(true);
  });
});
