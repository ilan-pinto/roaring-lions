// @vitest-environment jsdom
//
// The sandbox picker.
//
// What this screen exists to stop is a defect the project has now shipped
// twice: a capability the code has and the UI cannot reach. `&mesh` was
// opt-in for a whole phase and `ui/menu.ts` never appended it to a single
// link, so no player reached through the menu ever saw a mesh. The menu's one
// sandbox entry was the same shape -- `?sandbox=1`, one destination, out of
// five shipped maps and four flags. (The screen builds `/free-play/<map>` now;
// `?sandbox=` still redirects onto it.)
//
// So the assertions worth having here are not "it renders". They are that
// NEITHER list is written down in the UI: the maps must be the real
// enumeration and the flags must be SANDBOX_FLAGS, or the screen can drift
// away from what actually loads and be wrong in exactly the silent way the
// sandbox banner was built to prevent.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { maps } from '@lions/data';
import { SANDBOX_FLAGS, readFlags, unknownParams } from '../sandbox-help';
import { matchPath, stripBase } from '../shell/router';
import { showMenu, showSandbox } from './menu';
import { parseWorld } from '../campaign';
import worldJson from '../../../../data/campaign/world.json';

const render = (): HTMLElement => {
  const stage = document.createElement('div');
  showSandbox(stage);
  return stage;
};

const mapLinks = (stage: HTMLElement): HTMLAnchorElement[] =>
  Array.from(stage.querySelectorAll<HTMLAnchorElement>('a[data-map]'));

const hrefOf = (stage: HTMLElement, id: string): string =>
  // getAttribute, not `.href`: jsdom resolves the property against the
  // document base and would compare "http://localhost:3000/free-play/x"
  // against the base-relative URL the app actually navigates with.
  stage.querySelector(`a[data-map="${id}"]`)?.getAttribute('href') ?? '';

const toggle = (stage: HTMLElement, flag: string): void => {
  const box = stage.querySelector<HTMLInputElement>(`input[data-flag="${flag}"]`);
  if (!box) throw new Error(`no checkbox for &${flag}`);
  box.checked = !box.checked;
  box.dispatchEvent(new Event('change'));
};

describe('the heading', () => {
  it('reads "Free play", not the internal "sandbox" name', () => {
    expect(render().querySelector('.rl-menu__theatre')?.textContent).toBe('Free play');
  });
});

describe('the map list', () => {
  it('offers every map @lions/data enumerates', () => {
    // The guard against a hand-written list. It cannot fail while the screen
    // iterates `maps`, and goes red the moment anyone types the ids out.
    expect(mapLinks(render()).map((a) => a.dataset.map).sort()).toEqual(
      Object.keys(maps).sort()
    );
  });

  it('offers every map shipped in data/maps/, so a new one needs no edit here', () => {
    // The stronger form of the same rule, and the one that answers the
    // actual requirement: a map added to data/maps/ must reach this screen.
    // Read off disk rather than through the bundle, so it also catches a map
    // file that never made it into @lions/data's registry -- which would be
    // a map that ships, validates, and is unreachable from the UI.
    // Walked up from the cwd rather than derived from `import.meta.url`:
    // under `@vitest-environment jsdom` that URL is an http one and
    // `fileURLToPath` throws "The URL must be of scheme file".
    let root = process.cwd();
    for (let i = 0; i < 6 && !existsSync(join(root, 'data', 'maps')); i++) {
      root = dirname(root);
    }
    const dir = join(root, 'data', 'maps');
    expect(existsSync(dir), `no data/maps above ${process.cwd()}`).toBe(true);
    const onDisk = readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const json: unknown = JSON.parse(readFileSync(join(dir, f), 'utf8'));
        return (json as { id: string }).id;
      });
    expect(onDisk.length).toBeGreaterThan(0);
    expect(mapLinks(render()).map((a) => a.dataset.map).sort()).toEqual(onDisk.sort());
  });

  it('shows each map by its human name, never its id -- the id is what the URL takes, not what the player reads', () => {
    const stage = render();
    const tel = stage.querySelector('a[data-map="tel_marum"]');
    expect(tel?.textContent).toBe(maps.tel_marum.name);
    expect(tel?.textContent).not.toContain('tel_marum');
    // No shipped map name carries an underscore -- the tell of an id
    // standing in for a name -- so this also catches a name regressing to one.
    expect(tel?.textContent).not.toContain('_');
  });
});

describe('the flag list', () => {
  it('offers every flag SANDBOX_FLAGS declares, and only those', () => {
    const boxes = Array.from(
      render().querySelectorAll<HTMLInputElement>('input[data-flag]')
    );
    expect(boxes.map((b) => b.dataset.flag)).toEqual(SANDBOX_FLAGS.map((f) => f.name));
  });

  it("uses the table's own blurb rather than new prose that can drift from it", () => {
    const text = render().textContent ?? '';
    for (const f of SANDBOX_FLAGS) expect(text).toContain(f.blurb);
  });
});

describe('the launch URL', () => {
  it('is the bare map when nothing is ticked', () => {
    expect(hrefOf(render(), 'tel_marum')).toBe('/free-play/tel_marum');
  });

  it('carries a ticked flag onto every map link, not just the one below it', () => {
    const stage = render();
    toggle(stage, 'sur');
    for (const a of mapLinks(stage)) {
      expect(a.getAttribute('href')).toBe(`/free-play/${a.dataset.map}?sur`);
    }
  });

  it('combines flags, and drops one that is unticked again', () => {
    const stage = render();
    toggle(stage, 'tunnel');
    toggle(stage, 'sur');
    expect(hrefOf(stage, 'tel_marum')).toBe('/free-play/tel_marum?tunnel&sur');
    toggle(stage, 'tunnel');
    expect(hrefOf(stage, 'tel_marum')).toBe('/free-play/tel_marum?sur');
  });

  it('produces a URL the shell reads back as the same pick', () => {
    // The round trip is the assertion that matters: a URL this screen builds
    // and the router/`readFlags`/`unknownParams` disagree about is a picker
    // that looks like it works and silently launches something else. The map
    // is a PATH segment now, so the router's own matcher is what has to find
    // it -- pulling it back out with a second regex here would be an oracle
    // that agrees with itself.
    const stage = render();
    toggle(stage, 'roe');
    toggle(stage, 'nomesh');
    const url = new URL(hrefOf(stage, 'wadi_halam_basin'), 'http://localhost:3000');
    expect(matchPath('/free-play/:map', stripBase('/', url.pathname))).toEqual({
      map: 'wadi_halam_basin',
    });
    const params = url.searchParams;
    expect(readFlags(params)).toEqual({
      roe: true,
      tunnel: false,
      sur: false,
      civ: false,
      ditch: false,
      nomesh: true,
      decals: false,
    });
    expect(unknownParams(params)).toEqual([]);
  });

  // The URL used to be spelled out on screen (`?sandbox=MAP_ID&tunnel`) as a
  // dev readout. It is gone: a player reading this screen should see maps and
  // extras, never the query string those clicks build -- the same defect
  // class as a raw gate expression or a raw mission id reaching the DOM.
  it('never prints the URL it will navigate with, on the page or in a flag label', () => {
    const stage = render();
    toggle(stage, 'tunnel');
    expect(stage.querySelector('.rl-sandbox__url')).toBeNull();
    const text = stage.textContent ?? '';
    expect(text).not.toContain('/free-play/');
    expect(text).not.toContain('?sandbox=');
    expect(text).not.toContain('MAP_ID');
    // The flag's own name moved to the label's `title` (hover text, not
    // rendered text), so `&roe` and friends must not appear in the visible
    // text content either.
    for (const f of SANDBOX_FLAGS) expect(text).not.toContain(`&${f.name}`);
  });
});

describe('reaching it', () => {
  it('is where the menu’s sandbox entry points', () => {
    // The half of this feature that lives in the OTHER screen. A picker
    // nothing links to is the `&mesh` defect again, one level up.
    const stage = document.createElement('div');
    showMenu(stage, {
      base: '/',
      version: '0.0.0-test',
      world: parseWorld(worldJson),
      tutorial: { id: 'beit_sahwan_0_tutorial', name: 'Tutorial', done: true },
    });
    const hrefs = Array.from(stage.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/free-play');
  });

  it('offers a way back to the main menu', () => {
    const back = Array.from(render().querySelectorAll('a')).filter(
      (a) => a.dataset.kind === 'back'
    );
    expect(back.map((a) => a.getAttribute('href'))).toEqual(['/']);
  });
});
