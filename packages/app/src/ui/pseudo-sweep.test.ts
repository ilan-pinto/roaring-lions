// @vitest-environment jsdom
/**
 * GH-1406: "a complete pseudo-locale loads with no unbracketed chrome string". `validate:ui`'s i18n regex cannot see a string that reaches a
 * DOM sink through a VARIABLE (`const label = 'Foo'; el.textContent = label`), and the pseudo capture that would catch it needs a browser,
 * which CI runs only as a report. This is the part of that check a jsdom mount can do: each shell screen is mounted under the pseudo-locale
 * (`en` through `pseudo`, which brackets every string that goes through `t()` in ⟦ ⟧), and every letter on a text node or an accessible-name
 * attribute that lies OUTSIDE those brackets did NOT go through `t()`: a bracket elsewhere in the same string excuses nothing, so
 * `t('x') + ' raw English'` is caught.
 *
 * What may stay unbracketed is named below, one exact string per entry with its reason, and the list must be exact in BOTH directions: a string
 * outside the brackets that is no entry fails (a new chrome string that bypassed `t()`), and an entry that no swept screen still shows
 * unbracketed fails (an entry that has become false is deleted, so the list cannot go stale). Screens that need a running world (the HUD, the
 * debrief, the versus lobby) are not mountable here: the report-only `ui:shots --pseudo` capture remains the check for them.
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
import { freePlayMapIds, showMenu, showSandbox } from './menu';
import { SANDBOX_FLAGS } from '../sandbox-help';
import { showSaves } from './saves';

type Hit = string;

/** Every LETTER, in any script: outside a pseudo span there should be none, an accented one included (the transform only writes those inside). */
const LETTER = /\p{L}/u;
/** One whole pseudo span with no span inside it (`pseudo()` writes `⟦…⟧`; a `t()` string passed as another's parameter nests one). */
const SPAN = /⟦[^⟦⟧]*⟧/g;
/** Joins a screen's text nodes, so a span that a tag splits across nodes (`innerHTML` around translated text) still pairs up; never in copy. */
const NODE_BREAK = '\uE000';

/**
 * The pieces of `s` that lie outside every pseudo span, trimmed, that carry a letter: a string `t()` never saw. Spans are removed innermost
 * first until none is left, so a nested span goes too; a bracket with no partner is itself reported, as the piece it starts or ends.
 * `t('x') + ' raw English'` yields `raw English`: a bracket anywhere in the string no longer excuses the rest of it.
 */
export function outsideSpans(s: string): Hit[] {
  let rest = s;
  for (let prev = ''; prev !== rest; ) {
    prev = rest;
    rest = rest.replace(SPAN, NODE_BREAK);
  }
  return rest.split(NODE_BREAK).map((piece) => piece.trim()).filter((piece) => LETTER.test(piece));
}

/** Every text node (read together, in document order) and accessible-name attribute under `root`, reduced to what lies outside the pseudo spans. */
export function unbracketed(root: HTMLElement): Hit[] {
  const texts: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) texts.push(n.textContent ?? '');
  const out = outsideSpans(texts.join(NODE_BREAK));
  for (const el of root.querySelectorAll('[aria-label],[title],[placeholder],[alt]')) {
    for (const a of ['aria-label', 'title', 'placeholder', 'alt']) {
      const v = el.getAttribute(a);
      if (v !== null) out.push(...outsideSpans(v));
    }
  }
  return out;
}

/** The fixture's menu version, printed on the lockup's version line. */
const FIXTURE_VERSION = '0.0.0';
/** The campaign world's own name in this test's fixture (`showMenu`'s `world`), data like a map name. */
const FIXTURE_WORLD = 'The Sahar Basin';

/**
 * What may stay unbracketed: each ENTRY is one exact string with its reason, never a pattern, and the list is exact in both directions. A string
 * outside the spans that is no entry fails (a chrome string that bypassed `t()`), and an entry that no swept screen shows fails (it has become
 * false, so it is deleted). The derived entries are expanded one per string for the same reason: every endonym is on the settings screen and
 * every Free play map card's name is on the picker, so a single map name moved under `t()` turns its own entry red.
 */
const ALLOWED: ReadonlyMap<string, string> = new Map<string, string>([
  // The brand lockup (`mark.ts`: "401st Ari'im Brigade" and the game's name): a proper name, not chrome. "st" is the ordinal's own <span>.
  ['Roaring Lions', 'brand'],
  ['st', 'brand'],
  ["Ari'im Brigade", 'brand'],
  // The lockup's version line under the menu's mark: the unit's name, a middle dot and "V" with the build (`mark.ts`, not a catalogue string).
  [`Ari'im Brigade · V ${FIXTURE_VERSION}`, 'version line'],
  [FIXTURE_WORLD, 'world name'],
  // A language is shown in its own language (`LOCALES[].name`), by design: "English" must read "English" under every locale.
  ...LOCALES.map((l): [string, string] => [l.name, 'endonym']),
  // The names of the maps on the Free play cards (`freePlayMapIds()`, `mapManifest[id].name`), as the data has them. THERE IS NO MAP-NAME
  // OVERLAY YET, so these are English under every locale: a gap of GH-1406, listed until a map overlay exists.
  ...freePlayMapIds().map((id): [string, string] => [mapManifest[id as keyof typeof mapManifest].name, 'map name']),
  // The developer flags of the Free play options (`&roe`, `&tunnel`, ...), on each box's title: sandbox-only tools, shown as their URL
  // parameter. A flag Free play has by default gets no box (`freePlayDefault`), so no title either.
  ...SANDBOX_FLAGS.filter((f) => f.freePlayDefault !== true).map((f): [string, string] => [`&${f.name}`, 'dev flag']),
]);

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
  mount('menu', (s) => showMenu(s, { base: '/', version: FIXTURE_VERSION, world: { name: FIXTURE_WORLD } as never, tutorial: { id: 'beit_sahwan_0_tutorial', name: 'Tutorial', done: true } }));
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

  it('every string with letters is inside a pseudo span or is an entry on the named list', () => {
    const offenders = Object.entries(screens).flatMap(([name, stage]) => unbracketed(stage).filter((h) => !ALLOWED.has(h)).map((h) => `${name}: ${h}`));
    expect(offenders).toEqual([]);
  });

  it('each entry on the list is still true: an entry no swept screen shows unbracketed is deleted', () => {
    const seen = new Set(Object.values(screens).flatMap((stage) => unbracketed(stage)));
    const stale = [...ALLOWED].filter(([entry]) => !seen.has(entry)).map(([entry, why]) => `${why}: ${entry}`);
    expect(stale).toEqual([]);
  });

  it('the scanner can fail: a string that bypassed t() is found, in a text node and in an accessible name', () => {
    const stage = document.createElement('div');
    stage.innerHTML = '<p>⟦Ŝáṽé⟧</p><p>Save game</p><button aria-label="Close panel">x</button><span title="⟦Ŝáṽé⟧">y</span>';
    expect(unbracketed(stage)).toEqual(['Save game', 'x', 'y', 'Close panel']);
  });

  it('a bracket no longer excuses the rest of its string: raw text beside a span, a nested span, a span split by a tag, a lone bracket', () => {
    expect(outsideSpans('⟦Ŝáṽéš⟧ and your old games')).toEqual(['and your old games']);
    expect(outsideSpans('Load ⟦Ŝáṽéš⟧')).toEqual(['Load']);
    expect(outsideSpans('⟦Ļöáð ⟦Ŝļöţ⟧ ñöŵ⟧')).toEqual([]);
    expect(outsideSpans('⟦ á · 4 ⟧ ⟦ƀ⟧ 12')).toEqual([]);
    expect(outsideSpans('Close ⟧')).toEqual(['Close ⟧']);
    expect(outsideSpans('⟦Ŝáṽé')).toEqual(['⟦Ŝáṽé']);
    // A span a tag splits across text nodes still pairs up. The known limit: a node placed INSIDE a translated span is read as part of it
    // ("the" below), which only DOM surgery on a `t()` string could produce; a parameter is accented by the transform itself.
    const split = document.createElement('div');
    split.innerHTML = '<p>⟦Ŝéé <b>ţĥé</b> ɱáþ⟧</p><p>⟦Ŝéé <b>the</b> ɱáþ⟧ raw</p>';
    expect(unbracketed(split)).toEqual(['raw']);
  });
});
