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
    expect(STATS_HTML).toContain("getOr('accounts',[])");
    expect(STATS_HTML).toContain("getOr('loadouts',[])");
  });

  it('drift guard: the verb columns are generated from TELEMETRY_ORDER_VERBS, not a hand-copied list', () => {
    expect(STATS_HTML).toContain(`const VERBS=${JSON.stringify(TELEMETRY_ORDER_VERBS)};`);
  });

  it('every value the page prints in a table cell goes through esc() or fmt(), everywhere on the page (not just the new tables)', () => {
    const gh254 = STATS_HTML.slice(STATS_HTML.indexOf('/*gh254*/'), STATS_HTML.indexOf('/*/gh254*/'));
    expect(gh254.length).toBeGreaterThan(0);
    // Any string literal that opens (or re-opens, fused onto a preceding
    // </td> or <tr>) a <td tag -- with or without attributes -- must be
    // immediately followed by esc(...) or fmt(...), never a raw read.
    // Catches '<td>'+x, '<td class="n">'+x, '</td><td>'+x, '<tr><td>'+x,
    // wherever on the page it appears, not only inside the gh254 markers.
    const rawTdValue = /'[^']*<td(?:\s[^>']*)?>'\+(?!esc\(|fmt\()/;
    expect(STATS_HTML).not.toMatch(rawTdValue);
  });

  it('load() guards the accounts and loadouts fetches with getOr, not a bare get(), so a missing migration or bad row cannot blank the existing tables', () => {
    expect(STATS_HTML).toMatch(/getOr\('accounts',\[\]\)/);
    expect(STATS_HTML).toMatch(/getOr\('loadouts',\[\]\)/);
  });

  it('getOr resolves to the given fallback when the underlying fetch fails, and to the real value when it succeeds', async () => {
    const getOrSrc = STATS_HTML.match(/const getOr=(\([\s\S]*?\));/);
    expect(getOrSrc).not.toBeNull();
    const makeGetOr = (mockGet: (path: string) => Promise<unknown>) =>
      new Function('get', `return (${getOrSrc![1]});`)(mockGet) as (path: string, fallback: unknown) => Promise<unknown>;

    const failing = makeGetOr(() => Promise.reject(new Error('boom')));
    await expect(failing('accounts', [])).resolves.toEqual([]);

    const throwingSync = makeGetOr(() => {
      throw new Error('synchronous failure, e.g. building the query string');
    });
    await expect(throwingSync('loadouts', [])).resolves.toEqual([]);

    const succeeding = makeGetOr(() => Promise.resolve([{ player: 'x' }]));
    await expect(succeeding('accounts', [])).resolves.toEqual([{ player: 'x' }]);
  });

  it('regression: the real accountRow rendering shows a readable Upgrades cell for a tier, never a stray comma', () => {
    // Extracts esc/fmt/accountRow verbatim from the page script (the
    // testerLink precedent above) and runs them with sample data, so this
    // exercises the actual runtime code rather than a re-implementation.
    const escSrc = STATS_HTML.match(/const esc=(\([\s\S]*?\));/);
    const fmtSrc = STATS_HTML.match(/const fmt=(\([\s\S]*?\));/);
    const rowSrc = STATS_HTML.match(/function accountRow\(a\)\{[\s\S]*?\n\}/);
    expect(escSrc).not.toBeNull();
    expect(fmtSrc).not.toBeNull();
    expect(rowSrc).not.toBeNull();
    const accountRow = new Function(`
      const esc=${escSrc![1]};
      const fmt=${fmtSrc![1]};
      ${rowSrc![0]}
      return accountRow;
    `)() as (a: {
      player: string;
      tester: string | null;
      credits: number;
      earned: number;
      unlocks: string[];
      tiers: string[];
      lastSeen: number;
    }) => string;
    const row = accountRow({
      player: 'a1b2c3d4',
      tester: 'dani',
      credits: 100,
      earned: 200,
      unlocks: ['inf_squad'],
      tiers: ['inf_squad.armour.1'],
      lastSeen: 1700000000000,
    });
    expect(row).toContain('inf_squad armour 1');
    expect(row).not.toContain('<td>,</td>');
  });
});
