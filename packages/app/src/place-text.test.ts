// @vitest-environment jsdom
/**
 * GH-1406: map names and the campaign world's names resolve through a locale overlay. The overlays here are built IN MEMORY (no language
 * ships a places.json yet), which is the point: the machinery is proved before a translation exists. Each assertion was watched to fail
 * against a one-line mutation (named in the commit message).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mapManifest, type MapJson, type PlaceLocaleOverlay } from '@lions/data';
import { maps } from '@lions/data/content';
import worldJson from '../../../data/campaign/world.json';
import countriesJson from '../../../data/campaign/countries.json';
import { parseCountries, parseWorld } from './campaign';
import { loadPlaceOverlay, localizedMapManifest, localizedWorld, mapName, setPlaceOverlay } from './place-text';
import { worldMap } from './ui/worldmap';
import { showMenu, showSandbox } from './ui/menu';
import { versusMaps } from './ui/versus-maps';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const manifest = mapManifest as Readonly<Record<string, { readonly name: string }>>;
const mapIds = Object.keys(manifest);
const SOME = mapIds.find((id) => id === 'bir_tarsha') as string;
const OTHER = mapIds.find((id) => id !== SOME) as string;

/** A small overlay a translator might ship: the world, one region, one town, two maps. */
const FR: PlaceLocaleOverlay = {
  world: 'Le bassin du Sahar',
  regions: { marj: 'La bande de Marj' },
  towns: { beit_sahwan: 'Beit Sahwan (FR)' },
  maps: { [SOME]: 'Puits de Tarsha', tel_marum: 'Tertre de Marum' },
};

afterEach(() => {
  setPlaceOverlay(null);
  vi.unstubAllGlobals();
});

describe('mapName', () => {
  it('reads the manifest with no overlay, the fallback for a map nobody lists, and the id when there is no fallback', () => {
    expect(mapName(SOME)).toBe(manifest[SOME].name);
    expect(mapName('no_such_map', 'From the JSON')).toBe('From the JSON');
    expect(mapName('no_such_map')).toBe('no_such_map');
    expect(mapName('constructor')).toBe('constructor'); // an inherited key is not a map
  });
  it('reads the overlay AT CALL TIME, per map, and falls back per map', () => {
    setPlaceOverlay(FR);
    expect(mapName(SOME)).toBe('Puits de Tarsha');
    expect(mapName(OTHER)).toBe(manifest[OTHER].name);
    setPlaceOverlay({ maps: { [OTHER]: 'AUTRE' } });
    expect(mapName(SOME)).toBe(manifest[SOME].name);
    expect(mapName(OTHER)).toBe('AUTRE');
    setPlaceOverlay(null);
    expect(mapName(SOME)).toBe(manifest[SOME].name);
  });
  it('an overlay name wins over the fallback a caller holds', () => {
    setPlaceOverlay(FR);
    expect(mapName(SOME, 'the map JSON name')).toBe('Puits de Tarsha');
  });
});

describe('localizedMapManifest', () => {
  it('is the SAME object when nothing overlays it, and a renamed copy when something does', () => {
    expect(localizedMapManifest()).toBe(mapManifest);
    setPlaceOverlay({ world: 'Only the world' });
    expect(localizedMapManifest()).toBe(mapManifest);
    setPlaceOverlay(FR);
    const out = localizedMapManifest() as Readonly<Record<string, { readonly name: string }>>;
    expect(out).not.toBe(mapManifest);
    expect(out[SOME].name).toBe('Puits de Tarsha');
    expect(out.tel_marum.name).toBe('Tertre de Marum');
    expect(out[OTHER].name).toBe(manifest[OTHER].name);
    expect(Object.keys(out)).toEqual(mapIds); // same ids, same order: the sort the screens rely on
  });
  it('never writes into the manifest (the net content digest hashes the maps)', () => {
    const before = clone(mapManifest);
    const mapsBefore = JSON.stringify(maps);
    setPlaceOverlay(FR);
    localizedMapManifest();
    mapName(SOME);
    expect(clone(mapManifest)).toEqual(before);
    expect(JSON.stringify(maps)).toBe(mapsBefore);
    expect(manifest[SOME].name).not.toBe('Puits de Tarsha');
  });
});

describe('localizedWorld', () => {
  const raw = worldJson as unknown as Parameters<typeof localizedWorld>[0];
  it('is the SAME object when nothing overlays it (no overlay, or one that renames nothing in this world)', () => {
    const parsed = parseWorld(worldJson);
    expect(localizedWorld(parsed)).toBe(parsed);
    expect(localizedWorld(raw)).toBe(raw);
    setPlaceOverlay({ maps: { [SOME]: 'x' } });
    expect(localizedWorld(parsed)).toBe(parsed);
  });
  it('renames the world, a region and a town on a copy of the parsed world, with everything else carried', () => {
    const parsed = parseWorld(worldJson);
    const before = clone(parsed);
    setPlaceOverlay(FR);
    const out = localizedWorld(parsed);
    expect(out).not.toBe(parsed);
    expect(out.name).toBe('Le bassin du Sahar');
    expect(out.regions[0].name).toBe('La bande de Marj');
    expect(out.regions[0].towns[0].name).toBe('Beit Sahwan (FR)');
    // untouched: the other regions and towns keep their English, and ids, positions, missions and gates are the source's
    expect(out.regions[1].name).toBe(parsed.regions[1].name);
    expect(out.regions[0].towns[1].name).toBe(parsed.regions[0].towns[1].name);
    expect(out.regions.map((r) => r.id)).toEqual(parsed.regions.map((r) => r.id));
    expect(out.regions[0].towns[0].missions).toEqual(parsed.regions[0].towns[0].missions);
    expect(out.regions[0].towns[0].at).toEqual(parsed.regions[0].towns[0].at);
    expect(out.art).toBe(parsed.art);
    // and the source is exactly what it was, deep
    expect(clone(parsed)).toEqual(before);
    expect(parsed.name).toBe('The Sahar Basin');
  });
  it('does the same for the raw world JSON, which the net content digest and the validators read, and leaves it unmutated', () => {
    const before = clone(raw);
    setPlaceOverlay(FR);
    const out = localizedWorld(raw);
    expect(out.name).toBe('Le bassin du Sahar');
    expect(clone(raw)).toEqual(before);
    expect((worldJson as { name: string }).name).toBe('The Sahar Basin');
  });
});

describe('loadPlaceOverlay', () => {
  it('never fetches for en, nor for the pseudo-locales', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    for (const lang of ['en', 'pseudo', 'pseudo-rtl']) expect(await loadPlaceOverlay(lang, '/')).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
  it('asks for locales/<lang>/places.json under the base and returns the parsed overlay', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify(FR)));
    vi.stubGlobal('fetch', f);
    expect(await loadPlaceOverlay('fr', '/game/')).toEqual(FR);
    expect(f).toHaveBeenCalledWith('/game/locales/fr/places.json');
  });
  it('degrades to a null overlay on a 404 and on a network failure, never a boot failure', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ world: 'NOT FOUND PAGE' }), { status: 404 }));
    expect(await loadPlaceOverlay('fr', '/')).toBeNull();
    vi.stubGlobal('fetch', async () => {
      throw new Error('offline');
    });
    expect(await loadPlaceOverlay('fr', '/')).toBeNull();
  });
});

// --- every display site is routed through the overlay --------------------------------------------------------------------------------
// Each test installs an overlay and reads what the screen DRAWS, so reverting one site to the raw name turns exactly that test red.

describe('the display sites', () => {
  it('Free play: a map card shows the overlay name, and the unlisted maps stay unlisted', () => {
    setPlaceOverlay(FR);
    const stage = document.createElement('div');
    showSandbox(stage, maps as Record<string, MapJson>);
    const card = (id: string): string => stage.querySelector(`a[data-map="${id}"] .rl-mapcard__name`)?.textContent ?? '';
    expect(card(SOME)).toBe('Puits de Tarsha');
    expect(card('tel_marum')).toBe('Tertre de Marum');
    expect(card(OTHER)).toBe(manifest[OTHER].name);
    // the route is the id, not the displayed name
    expect(stage.querySelector(`a[data-map="${SOME}"]`)?.getAttribute('href')).toContain(SOME);
  });

  it('Free play with no overlay is the English it always was', () => {
    const stage = document.createElement('div');
    showSandbox(stage, maps as Record<string, MapJson>);
    expect(stage.querySelector(`a[data-map="${SOME}"] .rl-mapcard__name`)?.textContent).toBe(manifest[SOME].name);
  });

  it('the versus lobby list (and the arena setup it feeds) carries the overlay name, same ids and same order', () => {
    const english = versusMaps();
    setPlaceOverlay({ maps: { tel_marum: 'Tertre de Marum' } });
    const fr = versusMaps();
    expect(fr.map((m) => m.id)).toEqual(english.map((m) => m.id));
    expect(fr.find((m) => m.id === 'tel_marum')?.label).toBe('Tertre de Marum');
    expect(english.find((m) => m.id === 'tel_marum')?.label).toBe(manifest.tel_marum.name);
    expect(fr.filter((m) => m.id !== 'tel_marum')).toEqual(english.filter((m) => m.id !== 'tel_marum'));
  });

  it('the menu theatre line shows the world name the shell hands it (main.ts localizes it once)', () => {
    setPlaceOverlay(FR);
    const stage = document.createElement('div');
    showMenu(stage, {
      base: '/', version: '0.0.0', world: localizedWorld(parseWorld(worldJson)),
      tutorial: { id: 'beit_sahwan_0_tutorial', name: 'Tutorial', done: true },
    });
    expect(stage.querySelector('.rl-menu__theatre')?.textContent).toBe('Le bassin du Sahar');
  });

  it('the flat campaign board shows the region card and the town pin names of the world it is handed', () => {
    setPlaceOverlay(FR);
    const board = worldMap({
      base: '/', world: localizedWorld(parseWorld(worldJson)), countries: parseCountries(countriesJson), ledger: {},
      href: (id) => `/mission/${id}`,
    });
    expect(board.querySelector('[data-region-card="marj"] .rl-world__cardname')?.textContent).toBe('La bande de Marj');
    expect(board.querySelector('[data-town="beit_sahwan"]')?.textContent).toContain('Beit Sahwan (FR)');
    expect(board.querySelector('[data-region-card="sur"] .rl-world__cardname')?.textContent).toBe('Sur');
  });
});

/** Non-test source files under packages/app/src, as [path relative to it, code with comment lines blanked]. */
function appSources(): [string, string][] {
  const root = __dirname;
  const out: [string, string][] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.ts$/.test(name) && !/\.test\.ts$|\.test-helper\.ts$/.test(name)) {
        const code = readFileSync(p, 'utf8')
          .split('\n')
          .map((l) => (/^\s*(\/\/|\/\*|\*)/.test(l) ? '' : l))
          .join('\n');
        out.push([relative(root, p), code]);
      }
    }
  };
  walk(root);
  return out;
}

describe('main.ts hands the screens localized places (source guard; main.ts cannot be mounted in a unit test)', () => {
  const main = appSources().find(([f]) => f === 'main.ts')?.[1] ?? '';
  it('installs the overlay beside the unit overlay, from the locale chosen at boot', () => {
    expect(main).toMatch(/setUnitOverlay\(await loadUnitOverlay\(lang, BASE\)\);\s*(?:\/\/[^\n]*\n\s*)*setPlaceOverlay\(await loadPlaceOverlay\(lang, BASE\)\);/);
  });
  it('the menu and the campaign board are each given a localized world, once, where main.ts hands it over', () => {
    expect(main).toMatch(/showMenu\(host, \{[^]*?world: localizedWorld\(worldData\),/);
    expect(main).toMatch(/const boardWorld = localizedWorld\(parseWorld\(world\)\);/);
    expect(main.match(/localizedWorld\(/g)).toHaveLength(2);
  });
  it('the three places main.ts draws a map name read it through mapName, and none reads the map JSON name directly', () => {
    expect(main.match(/mapName\(mapJson\.id, mapJson\.name\)/g)).toHaveLength(3);
    expect(main.match(/mapJson\.name/g)).toHaveLength(3); // every read is inside one of the three calls
  });
});

describe('no screen reads a map name straight off the manifest (source guard)', () => {
  it('only place-text.ts and the manifest itself read `mapManifest[...].name`; the catalogue each screen reads is the localized one', () => {
    const direct = /(?<![.\w])\(?mapManifest(?:\s+as\s[^)]*\))?\[[^\]]*\]\??\.name\b/;
    expect(appSources().filter(([, code]) => direct.test(code)).map(([f]) => f)).toEqual([]);
    const sources = appSources();
    // the screens that list or print a map name take the localized catalogue / mapName
    expect(sources.find(([f]) => f === join('ui', 'menu.ts'))?.[1]).toContain('localizedMapManifest()');
    expect(sources.find(([f]) => f === join('ui', 'versus-maps.ts'))?.[1]).toContain('localizedMapManifest()');
    expect(sources.find(([f]) => f === join('ui', 'profile.ts'))?.[1]).toContain('mapName(m.map)');
    // none of them still imports the raw manifest to print a name from
    for (const f of [join('ui', 'versus-maps.ts'), join('ui', 'profile.ts')]) {
      expect(sources.find(([x]) => x === f)?.[1], f).not.toMatch(/\bmapManifest\b/);
    }
  });
  it('the pattern catches the shapes a raw read would take', () => {
    const direct = /(?<![.\w])\(?mapManifest(?:\s+as\s[^)]*\))?\[[^\]]*\]\??\.name\b/;
    expect(direct.test('const n = mapManifest[id].name;')).toBe(true);
    expect(direct.test('(mapManifest as Readonly<Record<string, { name: string }>>)[id]?.name')).toBe(true);
    expect(direct.test('localizedMapManifest()[id].name')).toBe(false);
  });
});
