// @vitest-environment jsdom
/**
 * GH-1406: "a complete pseudo-locale loads with no unbracketed chrome string". `validate:ui`'s i18n regex cannot see a string that reaches a
 * DOM sink through a VARIABLE (`const label = 'Foo'; el.textContent = label`), and the pseudo capture that would catch it needs a browser,
 * which CI runs only as a report. This is the part of that check a jsdom mount can do: each shell screen is mounted under the pseudo-locale
 * (`en` through `pseudo`, which brackets every string that goes through `t()`), and every text node and every accessible-name attribute that
 * carries letters and no bracket (⟦ ⟧) did NOT go through `t()`.
 *
 * What may stay unbracketed is named below, with the reason, and the list must be exact in BOTH directions: an unbracketed string that is on no
 * list fails (a new chrome string that bypassed `t()`), and a listed one that is no longer unbracketed fails (an entry that has become false is
 * deleted, so the list cannot go stale). Screens that need a running world (the HUD, the debrief, the versus lobby) are not mountable here: the
 * report-only `ui:shots --pseudo` capture remains the check for them.
 */
import { describe, expect, it, vi } from 'vitest';
import { mapManifest } from '@lions/data';
import { DEFAULT_SETTINGS, type Settings } from '../settings';
import { LOCALES } from '../i18n/locales';
import { setCatalogue } from '../i18n/t';
import en from '../i18n/en.json';
import { pseudo } from '../i18n/pseudo';
import { memoryLedgerStore } from '../ledger-store';
import { showSettings } from './settings-panel';
import { showMenu, showSandbox } from './menu';
import { showSaves } from './saves';

type Hit = string;

/** Every text node and accessible-name attribute under `root` with two or more letters and no bracket: a string `t()` never saw. */
export function unbracketed(root: HTMLElement): Hit[] {
  const out: Hit[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    const s = (n.textContent ?? '').trim();
    if (/[A-Za-z]{2,}/.test(s) && !/[⟦⟧]/.test(s)) out.push(s);
  }
  for (const el of root.querySelectorAll('[aria-label],[title],[placeholder],[alt]')) {
    for (const a of ['aria-label', 'title', 'placeholder', 'alt']) {
      const v = el.getAttribute(a);
      if (v !== null && /[A-Za-z]{2,}/.test(v) && !/[⟦⟧]/.test(v)) out.push(v);
    }
  }
  return out;
}

/** The brand lockup (`mark.ts`: "401st Ari'im Brigade" and the game's name) and the version line under it: a proper name, not chrome. */
const BRAND = new Set(['Roaring Lions', 'st', "Ari'im Brigade"]);
/** A language is shown in its own language (`LOCALES[].name`), by design: "English" must read "English" under every locale. */
const ENDONYMS = new Set(LOCALES.map((l) => l.name));
/** The names of the maps (`@lions/data`'s `mapManifest`), shown in Free play as the data has them. THERE IS NO MAP-NAME OVERLAY YET, so these
 *  are English under every locale: a gap of GH-1406, listed here until a map overlay exists (the test below fails when the first one is
 *  translated, so this category is then deleted). */
const MAP_NAMES = new Set(Object.values(mapManifest).map((m) => m.name));
/** The campaign world's own name in this test's fixture (`showMenu`'s `world`), data like a map name. */
const FIXTURE_WORLD = 'The Sahar Basin';
/** The version line the menu prints under the lockup: the unit's name, a middle dot and the build. */
const VERSION_LINE = /^Ari'im Brigade · V \S+$/;
/** The developer flags of the Free play form (`&roe`, `&tunnel`, ...): sandbox-only tools, shown as their URL parameter. */
const DEV_FLAG = /^&[a-z]+$/;

function allowed(h: Hit): string | null {
  if (BRAND.has(h)) return 'brand';
  if (ENDONYMS.has(h)) return 'endonym';
  if (MAP_NAMES.has(h)) return 'map name';
  if (h === FIXTURE_WORLD) return 'world name';
  if (VERSION_LINE.test(h)) return 'version line';
  if (DEV_FLAG.test(h)) return 'dev flag';
  return null;
}

function mountEverything(): Record<string, HTMLElement> {
  setCatalogue('pseudo', en as Record<string, string>, pseudo);
  let settings: Settings = structuredClone(DEFAULT_SETTINGS);
  const settingsDeps = {
    get: () => settings,
    set: vi.fn((next: Settings) => { settings = next; }),
    fullscreen: null,
    audio: { setGains: vi.fn() },
    locales: LOCALES,
    keymap: null,
    build: '0.68.0',
    commit: '0123456789abcdef0123456789abcdef01234567',
    onChange: () => () => {},
    back: '/',
  };
  const screens: Record<string, HTMLElement> = {};
  const mount = (name: string, show: (stage: HTMLElement) => unknown): void => {
    const stage = document.createElement('div');
    show(stage);
    screens[name] = stage;
  };
  mount('settings', (s) => showSettings(s, settingsDeps));
  mount('menu', (s) => showMenu(s, { base: '/', version: '0.0.0', world: { name: FIXTURE_WORLD } as never, tutorial: { id: 'beit_sahwan_0_tutorial', name: 'Tutorial', done: true } }));
  mount('free play', (s) => showSandbox(s, {}));
  mount('saves', (s) => showSaves(s, { store: memoryLedgerStore(), build: '0.68.0', now: () => 1_700_000_000_000, back: '/', download: () => {}, pickFile: async () => null, onChanged: () => {} }));
  return screens;
}

describe('the pseudo-locale brackets every string on the shell screens that mount in jsdom (GH-1406)', () => {
  const screens = mountEverything();

  it('mounts real screens (so an empty scan cannot pass)', () => {
    for (const [name, stage] of Object.entries(screens)) {
      expect((stage.textContent ?? '').length, name).toBeGreaterThan(50);
      // at least one string DID go through t(): the pseudo transform is live
      expect(stage.textContent, name).toMatch(/⟦/);
    }
  });

  it('every string with letters is bracketed or on the named list', () => {
    const offenders = Object.entries(screens).flatMap(([name, stage]) => unbracketed(stage).filter((h) => allowed(h) === null).map((h) => `${name}: ${h}`));
    expect(offenders).toEqual([]);
  });

  it('each category on the list is still true: a name that has become bracketed means its entry is deleted', () => {
    const seen = new Set(Object.values(screens).flatMap((stage) => unbracketed(stage).map((h) => allowed(h)).filter((c): c is string => c !== null)));
    for (const category of ['brand', 'endonym', 'map name', 'world name', 'version line', 'dev flag']) expect(seen, category).toContain(category);
  });

  it('the scanner can fail: a string that bypassed t() is found, in a text node and in an accessible name', () => {
    const stage = document.createElement('div');
    stage.innerHTML = '<p>⟦Ŝáṽé⟧</p><p>Save game</p><button aria-label="Close panel">x</button><span title="⟦Ŝáṽé⟧">y</span>';
    expect(unbracketed(stage)).toEqual(['Save game', 'Close panel']);
  });
});
