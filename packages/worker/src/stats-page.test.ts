import { describe, it, expect } from 'vitest';
import { TESTER_PATTERN } from '@lions/data/telemetry';
import { STATS_HTML } from './stats-page';
import { testerLink } from './tester-link';

describe('STATS_HTML: Share with a tester (issue #230)', () => {
  it('renders the name input, Create link button and a read-only output', () => {
    expect(STATS_HTML).toContain('id="share-name"');
    expect(STATS_HTML).toContain('id="share-make"');
    expect(STATS_HTML).toMatch(/<input[^>]*id="share-out"[^>]*readonly/);
  });

  it('renders the helper copy about the link labelling the browser it is opened on', () => {
    expect(STATS_HTML).toContain('sticks to the browser');
    expect(STATS_HTML).toContain('Send each tester their own link.');
  });

  it('each Testers row gets a Share button distinguishable from the timeline button via data-share', () => {
    expect(STATS_HTML).toContain('data-share');
    // the timeline click delegation must be able to tell the two apart
    expect(STATS_HTML).toMatch(/if\(b\.dataset\.share!==undefined\)shareFor\(b\.dataset\.t\);else showTimeline\(b\.dataset\.t\)/);
  });

  it('the origin is read from location.origin, never hardcoded', () => {
    expect(STATS_HTML).toContain('location.origin');
  });

  it('drift guard: the page script is generated from testerLink.toString(), not a hand-copied twin', () => {
    // If this ever fails, someone hand-edited the inline copy instead of
    // regenerating it from tester-link.ts -- the two must never be free to
    // drift apart, per issue #230.
    expect(STATS_HTML).toContain(testerLink.toString());
  });

  it('drift guard: the pattern testerLink enforces is still exactly @lions/data/telemetry TESTER_PATTERN', () => {
    expect(STATS_HTML).toContain(TESTER_PATTERN.source);
  });

  it('the injected copy still validates like the real TESTER_PATTERN (extracted from the page and evaluated)', () => {
    const match = STATS_HTML.match(/const testerLink=(function testerLink\([\s\S]*?\n\});/);
    expect(match).not.toBeNull();
    const rebuilt = new Function(`return (${match![1]});`)() as typeof testerLink;
    expect(rebuilt('https://g.dev/', 'dani')).toEqual({ ok: true, url: 'https://g.dev/?tester=dani' });
    expect(rebuilt('https://g.dev', 'bad name').ok).toBe(false);
  });
});
