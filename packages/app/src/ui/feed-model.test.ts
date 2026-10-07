import { describe, expect, it } from 'vitest';
import { FEED_MERGE_WINDOW_MS, FeedModel } from './feed-model';

describe('FeedModel: a repeated line merges with a count', () => {
  it('four identical lines in two seconds are one line, ×4', () => {
    const feed = new FeedModel();
    const pushes = [0, 600, 1300, 2000].map((t) => feed.push('under fire — Rifle Squad · in view', t));
    expect(pushes.map((p) => p.kind)).toEqual(['new', 'merged', 'merged', 'merged']);
    expect(new Set(pushes.map((p) => p.line.id)).size).toBe(1);
    expect(pushes[3].line.count).toBe(4);
  });

  it('a different line keeps its own slot', () => {
    const feed = new FeedModel();
    const a = feed.push('under fire — Rifle Squad · in view', 0);
    const b = feed.push('under fire — Rifle Squad · north-east', 100);
    expect(b.kind).toBe('new');
    expect(b.line.id).not.toBe(a.line.id);
  });

  it('the window runs from the LAST repeat, so a sustained report stays one line', () => {
    const feed = new FeedModel();
    // A unit pinned for half a minute re-reports every five seconds.
    let last = feed.push('k', 0);
    for (let t = 5000; t <= 30000; t += 5000) last = feed.push('k', t);
    expect(last.kind).toBe('merged');
    expect(last.line.count).toBe(7);
  });

  it('a repeat after the window is a new line', () => {
    const feed = new FeedModel();
    feed.push('k', 0);
    const late = feed.push('k', FEED_MERGE_WINDOW_MS + 1);
    expect(late.kind).toBe('new');
    expect(late.line.count).toBe(1);
  });

  it('a line that left the feed cannot be merged into', () => {
    const feed = new FeedModel();
    const first = feed.push('k', 0);
    feed.drop(first.line.id);
    expect(feed.push('k', 10).kind).toBe('new');
  });

  it('dropping a stale id leaves its live replacement alone', () => {
    const feed = new FeedModel();
    const old = feed.push('k', 0);
    const fresh = feed.push('k', FEED_MERGE_WINDOW_MS + 1);
    feed.drop(old.line.id);
    expect(feed.push('k', FEED_MERGE_WINDOW_MS + 2).line.id).toBe(fresh.line.id);
  });
});
