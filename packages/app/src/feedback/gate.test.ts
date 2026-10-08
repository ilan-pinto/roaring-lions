// The one gate (GH-464): who sees feedback, and where a note may leave the
// machine. Every spec here was seen red under a one-line mutation of
// `gate.ts` (listed in the commit that landed it).
import { afterEach, describe, expect, it } from 'vitest';
import { FEEDBACK_FLAG_KEY, FEEDBACK_FOR_EVERYONE, feedbackSends, feedbackShown, isClosed, markClosed, resetClosedForTest, testerLabel, type FeedbackEnv } from './gate';
import { TESTER_KEY, type StorageLike } from '../telemetry/identity';

const store = (init: Record<string, string> = {}): StorageLike & { data: Record<string, string> } => {
  const data = { ...init };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
};
const env = (o: Partial<FeedbackEnv> & { q?: string } = {}): FeedbackEnv => ({
  prod: o.prod ?? true,
  hostname: o.hostname ?? 'roaring-lions.pint12.workers.dev',
  query: new URLSearchParams(o.q ?? ''),
  storage: o.storage ?? store(),
});

afterEach(() => resetClosedForTest());

describe('feedbackShown', () => {
  it('is the lead\'s v1 ruling: every player, tester or not, on a production build', () => {
    expect(FEEDBACK_FOR_EVERYONE).toBe(true);
    expect(feedbackShown(env())).toBe(true);
    expect(feedbackShown(env({ q: 'tester=dana' }))).toBe(true);
  });

  it('turned off by the one flag, falls back to testers and ?feedback only', () => {
    expect(feedbackShown(env(), false)).toBe(false);
    expect(feedbackShown(env({ q: 'tester=dana' }), false)).toBe(true);
    expect(feedbackShown(env({ storage: store({ [TESTER_KEY]: 'dana' }) }), false)).toBe(true);
    expect(feedbackShown(env({ q: 'feedback' }), false)).toBe(true);
  });

  it('stays hidden in dev, in tests and on any local host unless ?feedback asks', () => {
    expect(feedbackShown(env({ prod: false }))).toBe(false);
    for (const hostname of ['localhost', '127.0.0.1', '[::1]', 'box.local', 'app.localhost', 'game.test']) {
      expect([hostname, feedbackShown(env({ hostname }))]).toEqual([hostname, false]);
    }
    expect(feedbackShown(env({ prod: false, hostname: 'localhost', q: 'feedback' }))).toBe(true);
  });

  it('persists ?feedback, so the lead can try it without a label', () => {
    const s = store();
    expect(feedbackShown(env({ prod: false, hostname: 'localhost', q: 'feedback', storage: s }))).toBe(true);
    expect(s.data[FEEDBACK_FLAG_KEY]).toBe('1');
    expect(feedbackShown(env({ prod: false, hostname: 'localhost', storage: s }))).toBe(true);
  });

  it('stands every entry point down once the server said closed', () => {
    expect(isClosed()).toBe(false);
    markClosed();
    expect(isClosed()).toBe(true);
    expect(feedbackShown(env())).toBe(false);
    expect(feedbackShown(env({ q: 'feedback' }))).toBe(false);
  });
});

describe('feedbackSends', () => {
  it('sends only from a production build on a real host', () => {
    expect(feedbackSends({ prod: true, hostname: 'roaring-lions.pint12.workers.dev' })).toBe(true);
    expect(feedbackSends({ prod: false, hostname: 'roaring-lions.pint12.workers.dev' })).toBe(false);
    expect(feedbackSends({ prod: true, hostname: 'localhost' })).toBe(false);
    expect(feedbackSends({ prod: true, hostname: '127.0.0.1' })).toBe(false);
  });
});

describe('testerLabel', () => {
  it('reads the label from the URL or storage and never writes one', () => {
    const s = store();
    expect(testerLabel({ query: new URLSearchParams('tester=dana'), storage: s })).toBe('dana');
    expect(s.data[TESTER_KEY]).toBeUndefined();
    expect(testerLabel({ query: new URLSearchParams(''), storage: store({ [TESTER_KEY]: 'eli' }) })).toBe('eli');
    expect(testerLabel({ query: new URLSearchParams('tester=no spaces'), storage: s })).toBeUndefined();
  });
});
