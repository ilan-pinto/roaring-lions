import { describe, it, expect } from 'vitest';
import { TESTER_PATTERN, TELEMETRY_ORDER_VERBS } from '@lions/data/telemetry';
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

describe('STATS_HTML: accounts and loadouts (GH-254)', () => {
  it('has the three tables under their headings, after Missions and before Testers', () => {
    const at = (s: string) => STATS_HTML.indexOf(s);
    for (const id of ['id="accounts"', 'id="loadout-units"', 'id="loadout-orders"']) expect(STATS_HTML).toContain(id);
    expect(at('<h2>Missions</h2>')).toBeLessThan(at('<h2>Brigade accounts</h2>'));
    expect(at('<h2>Brigade accounts</h2>')).toBeLessThan(at('<h2>Loadouts</h2>'));
    expect(at('<h2>Loadouts</h2>')).toBeLessThan(at('<h2>Testers</h2>'));
  });

  it('loads both new endpoints with the same filter as the rest of the page', () => {
    expect(STATS_HTML).toContain("get('accounts')");
    expect(STATS_HTML).toContain("get('loadouts')");
  });

  it('drift guard: the verb columns are generated from TELEMETRY_ORDER_VERBS, not a hand-copied list', () => {
    expect(STATS_HTML).toContain(`const VERBS=${JSON.stringify(TELEMETRY_ORDER_VERBS)};`);
  });

  it('every value the new tables print goes through esc() or fmt()', () => {
    const block = STATS_HTML.slice(STATS_HTML.indexOf('/*gh254*/'), STATS_HTML.indexOf('/*/gh254*/'));
    expect(block.length).toBeGreaterThan(0);
    // Every `r.` / `u.` / `a.` read inside a cell is wrapped.
    expect(block).not.toMatch(/'<td>'\+(?!esc\(|fmt\()/);
  });
});
