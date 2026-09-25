// packages/app/src/shell/links.test.ts
//
// The one table every href in the shell comes from. These assertions are the
// spelling contract: `router.ts`'s `matchPath` patterns and these strings are
// the two halves of one URL, and nothing else in the app is allowed to write a
// path. The round-trip test at the bottom is the one that matters -- a href
// this table builds that `legacyRedirect`/`stripBase`/`matchPath` disagree
// with is a link that looks right and lands nowhere.
import { describe, expect, it } from 'vitest';
import { routes } from './links';
import { matchPath, stripBase } from './router';
import { readFlags, unknownParams } from '../sandbox-help';

describe('routes', () => {
  it('spells every route once, under the base', () => {
    expect(routes.menu()).toBe('/');
    expect(routes.campaign()).toBe('/campaign');
    expect(routes.brigade()).toBe('/brigade');
    expect(routes.freePlay()).toBe('/free-play');
    expect(routes.settings()).toBe('/settings');
    expect(routes.credits()).toBe('/credits');
    expect(routes.saves()).toBe('/saves');
  });

  it('encodes a mission id and carries the tutorial replay flag', () => {
    expect(routes.mission('beit_sahwan_1_recon')).toBe('/mission/beit_sahwan_1_recon');
    expect(routes.mission('a b')).toBe('/mission/a%20b');
    expect(routes.mission('x', { tutorial: true })).toBe('/mission/x?tutorial=1');
  });

  it('carries the fresh flag, and both flags together, in a stable order', () => {
    expect(routes.mission('x', { fresh: true })).toBe('/mission/x?fresh=1');
    expect(routes.mission('x', { tutorial: true, fresh: true })).toBe('/mission/x?tutorial=1&fresh=1');
    // An explicitly-false option is absent, not `=0`: `readFlags`-style
    // presence tests read `=0` as on, and `main.ts` reads `tutorial` with
    // `!== null`.
    expect(routes.mission('x', { tutorial: false, fresh: false })).toBe('/mission/x');
  });

  it('builds a sandbox href with bare flags in table order, like sandboxUrl did', () => {
    expect(routes.sandbox('tel_marum')).toBe('/free-play/tel_marum');
    expect(routes.sandbox('tel_marum', { sur: true, tunnel: true })).toBe('/free-play/tel_marum?tunnel&sur');
    // Table order, not call order -- `SANDBOX_FLAGS` declares roe before
    // tunnel before sur, and a picker that reordered them per click would
    // produce two different URLs for one pick.
    expect(routes.sandbox('tel_marum', { sur: true, roe: true })).toBe('/free-play/tel_marum?roe&sur');
    expect(routes.sandbox('tel_marum', { sur: false })).toBe('/free-play/tel_marum');
  });

  it('round-trips through the router and the flag parser it was built for', () => {
    // Not "it looks like a URL": the href has to survive the same three
    // readers the running app puts it through.
    const href = routes.sandbox('wadi_halam_basin', { roe: true, nomesh: true });
    const url = new URL(href, 'http://localhost:5173');
    expect(matchPath('/free-play/:map', stripBase('/', url.pathname))).toEqual({
      map: 'wadi_halam_basin',
    });
    expect(readFlags(url.searchParams)).toEqual({
      roe: true,
      tunnel: false,
      sur: false,
      civ: false,
      ditch: false,
      nomesh: true,
      decals: false,
    });
    expect(unknownParams(url.searchParams)).toEqual([]);

    const mission = new URL(routes.mission('beit_sahwan_0_tutorial', { tutorial: true }), 'http://x');
    expect(matchPath('/mission/:id', stripBase('/', mission.pathname))).toEqual({
      id: 'beit_sahwan_0_tutorial',
    });
    expect(unknownParams(mission.searchParams)).toEqual([]);
  });
});
