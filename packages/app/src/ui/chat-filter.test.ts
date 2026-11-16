// GH-1417 S2: the local word filter. The first half drives the matcher with a FIXTURE list of invented words, so each normalisation
// step is pinned by an input only that step catches (design section 7); the oracle is literal strings, never the module's own output.
// The second half reads the shipped lists.
import { describe, expect, it } from 'vitest';
import { chatFilters } from '@lions/data/chat-filters';
import { DEFAULT_CALLSIGN } from '@lions/net';
import { MASK, SUBSTRING_MIN, collapse, compileFilter, filterLine, foldChar, sameWord, screenName, shippedFilter, wordsOf, type FilterList, preloadChatFilter } from './chat-filter';

// The lists are a lazy chunk; load them before anything is collected (a describe body reads shippedFilter at collection time).
await preloadChatFilter();

const FIXTURE: FilterList[] = [
  { lang: 'en', hide: ['zorgon', 'grim slogan', 'vex'], mask: ['blarg', 'rude phrase', 'phrase', 'snit', 'sludge', 'mutt'], allow: ['azorgonite', 'zorgon tide'] },
  { lang: 'xx', hide: ['quorlax'], mask: ['merdex'], allow: [] },
];
const f = compileFilter(FIXTURE, (l) => l === 'en');
const on = (text: string) => filterLine(f, text, { mask: true });
const hidden = (text: string): boolean => on(text).kind === 'hide';
const shown = (text: string): string => {
  const v = on(text);
  if (v.kind !== 'show') throw new Error(`hidden: ${text}`);
  return v.text;
};

describe('the matcher, on a fixture list', () => {
  it('hides a line with a hide word and masks only the mask word, keeping the rest of the text as typed', () => {
    expect(hidden('you are a zorgon')).toBe(true);
    expect(shown('you Blarg, go')).toBe(`you ${MASK}, go`);
    expect(shown('Hello there, Friend')).toBe('Hello there, Friend');
    expect(on('Hello').kind === 'show' && on('Hello')).toEqual({ kind: 'show', text: 'Hello', masked: false });
  });

  it('step 1, NFKC: a fullwidth spelling is the plain one', () => {
    expect(hidden('ｚｏｒｇｏｎ')).toBe(true);
  });

  it('step 2, case fold: upper case is caught', () => {
    expect(hidden('ZORGON!')).toBe(true);
  });

  it('step 3, marks: accents and stacked marks are dropped', () => {
    expect(hidden('zörgön')).toBe(true);
    expect(hidden('z̶o̷r̸gon')).toBe(true);
  });

  it('step 4, invisibles: a zero-width space or soft hyphen inside a word neither hides it nor splits it', () => {
    expect(hidden('zor​gon')).toBe(true);
    expect(hidden('zor­g⁠on')).toBe(true);
  });

  it('step 5, look-alikes: digits, Cyrillic and Greek letters, and @ $ ! against or inside a word', () => {
    expect(hidden('z0rg0n')).toBe(true);
    expect(hidden('zоrgοn')).toBe(true); // Cyrillic o, Greek omicron
    expect(shown('bl@rg')).toBe(MASK);
    expect(shown('$ludge')).toBe(MASK);
    expect(shown('sn!t')).toBe(MASK);
    // a trailing ! is punctuation, not a letter: the word before it is still the mask word, and the ! stays
    expect(shown('snit!')).toBe(`${MASK}!`);
    expect(shown('wow! $5')).toBe('wow! $5');
  });

  it('step 6, spaced-out letters: a run of single letters is one word', () => {
    expect(hidden('z o r g o n')).toBe(true);
    expect(shown('ok b.l.a.r.g ok')).toBe(`ok ${MASK} ok`);
  });

  it('step 7, repeated letters: a LONGER stretched spelling matches, a shorter word never does', () => {
    expect(hidden('zorrrgoooon')).toBe(true);
    expect(shown('blaaaarg')).toBe(MASK);
    expect(shown('muttt')).toBe(MASK);
    expect(shown('mut')).toBe('mut');
    expect(sameWord('mut', 'mutt')).toBe(false);
    expect(sameWord('muttt', 'mutt')).toBe(true);
    expect(collapse('muttt')).toBe('mut');
  });

  it('word boundaries: a mask word or a short hide word inside a longer word is left alone', () => {
    expect(shown('blargh and blargs')).toBe('blargh and blargs');
    expect(shown('a convex vexing hill')).toBe('a convex vexing hill');
    expect(hidden('vex')).toBe(true);
  });

  it(`step 9, inside a word: a hide word of ${SUBSTRING_MIN}+ letters is caught inside another, unless an allow word covers it`, () => {
    expect(hidden('megazorgonx')).toBe(true);
    expect(hidden('a piece of azorgonite')).toBe(false);
    // the allow word excuses only the spot it covers: a second, uncovered hit still hides
    expect(hidden('azorgonitezorgon')).toBe(true);
  });

  it('step 10, allow phrases: a hide word inside a longer allow phrase shows; the bare word, or the words out of order, still hide', () => {
    expect(hidden('the Zorgon Tide rises')).toBe(false);
    expect(hidden('the zorgon rises')).toBe(true);
    expect(hidden('tide zorgon')).toBe(true);
    // the phrase excuses only the hit it holds: a second zorgon on the same line still hides it
    expect(hidden('zorgon tide, zorgon')).toBe(true);
    // an allow phrase no longer than the hit excuses nothing: a hide phrase cannot be allowed by naming itself
    const self = compileFilter([{ lang: 'en', hide: ['grim slogan'], mask: [], allow: ['grim slogan'] }], () => true);
    expect(filterLine(self, 'the grim slogan', { mask: true })).toEqual({ kind: 'hide' });
  });

  it('phrases: a run of words matches across spaces and punctuation, and a long hide phrase run together is caught', () => {
    expect(shown('such a rude, phrase.')).toBe(`such a ${MASK}.`);
    expect(hidden('the grim slogan')).toBe(true);
    expect(hidden('#grimslogan')).toBe(true);
    expect(shown('grim weather')).toBe('grim weather');
  });

  it('overlapping and repeated mask hits merge into one mask each', () => {
    expect(shown('blarg blarg ok')).toBe(`${MASK} ${MASK} ok`);
    expect(shown('rude phrase')).toBe(MASK);
  });

  it('mask off (the Settings toggle) shows mask words as typed and STILL hides a hide word', () => {
    expect(filterLine(f, 'you blarg', { mask: false })).toEqual({ kind: 'show', text: 'you blarg', masked: false });
    expect(filterLine(f, 'you zorgon', { mask: false })).toEqual({ kind: 'hide' });
  });

  it('every list\'s hide tier applies; a mask tier only for the languages asked for', () => {
    expect(hidden('quorlax')).toBe(true);
    expect(shown('merdex')).toBe('merdex');
    const fr = compileFilter(FIXTURE, () => true);
    expect(filterLine(fr, 'merdex', { mask: true })).toEqual({ kind: 'show', text: MASK, masked: true });
  });

  it('empty lists hide and mask nothing', () => {
    const none = compileFilter([{ lang: 'en', hide: [], mask: [], allow: [] }], () => true);
    for (const s of ['zorgon', 'blarg', 'z o r g o n', '']) expect(filterLine(none, s, { mask: true })).toEqual({ kind: 'show', text: s, masked: false });
  });

  it('a callsign with a hide or a mask word is the fallback name; a clean one is kept as typed', () => {
    expect(screenName(f, 'xX_Zorgon_Xx')).toBe(DEFAULT_CALLSIGN);
    expect(screenName(f, 'Blarg')).toBe(DEFAULT_CALLSIGN);
    expect(screenName(f, 'Desert Fox')).toBe('Desert Fox');
  });

  it('folding and cutting: an emoji is a word of its own, and a word knows where it sat in the original', () => {
    expect(foldChar('Ｚ')).toBe('z');
    expect(foldChar('​')).toBe('');
    const w = wordsOf('Hi 🖕there');
    expect(w.map((x) => x.norm)).toEqual(['hi', '🖕', 'there']);
    expect(w.map((x) => [x.start, x.end])).toEqual([[0, 2], [3, 5], [5, 10]]);
  });
});

describe('the shipped lists', () => {
  const en = chatFilters.find((c) => c.lang === 'en');
  if (en === undefined) throw new Error('no English list');
  const shipped = shippedFilter('en');

  it('ships English with a hide tier, and every other language with an empty one until a native reader reviews it (D3, D4)', () => {
    expect(en.hide.length).toBeGreaterThan(20);
    expect(en.mask.length).toBeGreaterThan(100);
    for (const c of chatFilters.filter((x) => x.lang !== 'en')) {
      expect(c.hide, c.lang).toEqual([]);
      expect(c.review, c.lang).toBe('none');
      expect(c.mask.length, c.lang).toBeGreaterThan(0);
    }
  });

  it('hides a line with each English hide entry and masks each English mask entry, written plainly in a sentence', () => {
    for (const e of en.hide) expect(filterLine(shipped, `well ${e} then`, { mask: true }).kind, e).toBe('hide');
    for (const e of en.mask) {
      const v = filterLine(shipped, `well ${e} then`, { mask: true });
      expect(v, e).toEqual({ kind: 'show', text: `well ${MASK} then`, masked: true });
    }
  });

  it('leaves ordinary RTS chat alone: dropped entries, allow words, and short hide words inside longer ones', () => {
    for (const s of [
      'escort the convoy', 'that sucks', 'total domination', 'our tanks are tied up', 'rifle butt', 'snatch the hill',
      'my therapist says hi', 'scraping by', 'fire retardant', 'draping the net', 'do not snigger',
      'among us', 'spicy food', 'Pakistan', 'grapes', 'draped', 'scraped', 'Hmong', 'the parapet', 'raccoon', 'a cocoon', 'Niger', 'take the conn', 'as you were',
      'classic assault on the pass', 'title fight', 'analysis', 'cumulative', 'Scunthorpe',
    ]) {
      expect(filterLine(shipped, s, { mask: true }), s).toEqual({ kind: 'show', text: s, masked: false });
    }
  });

  it('every allow entry excuses something: a word holds a hide entry long enough to match inside it, a phrase holds a hide word', () => {
    for (const a of en.allow) {
      const words = wordsOf(a).map((w) => w.norm);
      if (words.length === 1) expect(shipped.inside.some((t) => words[0].includes(t.joined)), a).toBe(true);
      else expect(words.some((w) => filterLine(shipped, w, { mask: true }).kind === 'hide'), `${a} holds a hide word`).toBe(true);
      expect(filterLine(shipped, a, { mask: true }).kind, a).toBe('show');
    }
  });

  it('the lead\'s rulings of 16 Nov: these hide, kys masks, and the ordinary uses next to them still show', () => {
    // Literal oracle: the ruled words, not read back from the file.
    for (const w of ['lolita', 'shota', 'fucktards', 'neonazi', 'swastika', 'chink', 'dyke', 'dykes', 'gypsy', 'ching chong', 'heil hitler']) {
      expect(en.hide, w).toContain(w);
      expect(en.mask, w).not.toContain(w);
      expect(filterLine(shipped, `ok ${w} ok`, { mask: false }).kind, w).toBe('hide');
    }
    for (const w of ['chink', 'dyke', 'dykes', 'gypsy', 'ching chong', 'heil hitler', 'kys']) expect(en.in_house, w).toContain(w);
    expect(en.mask).toContain('kys');
    expect(filterLine(shipped, 'just kys', { mask: true })).toEqual({ kind: 'show', text: `just ${MASK}`, masked: true });
    expect(filterLine(shipped, 'HEIL   HITLER!!', { mask: true }).kind).toBe('hide');
    for (const s of [
      'a chink in the armour', 'found a chink in their armour', 'a chink of light', 'the gypsy moth', 'a chinkara herd',
      'the Hitler era', 'heil', 'Ching was here', 'keys', 'lolly', 'shot at', 'a nazi bunker',
    ]) {
      expect(filterLine(shipped, s, { mask: true }), s).toEqual({ kind: 'show', text: s, masked: false });
    }
  });

  it('masks a launch language\'s words only for a reader in that language; English masks for everyone', () => {
    const fr = chatFilters.find((c) => c.lang === 'fr');
    if (fr === undefined) throw new Error('no French list');
    expect(fr.mask).toContain('bitte');
    expect(filterLine(shippedFilter('en'), 'bitte', { mask: true })).toEqual({ kind: 'show', text: 'bitte', masked: false });
    expect(filterLine(shippedFilter('fr'), 'bitte', { mask: true })).toEqual({ kind: 'show', text: MASK, masked: true });
    expect(filterLine(shippedFilter('fr'), 'well shit', { mask: true })).toEqual({ kind: 'show', text: `well ${MASK}`, masked: true });
  });

  it('ships no Chinese list (held out until segmentation is decided)', () => {
    expect(chatFilters.some((c) => c.lang.startsWith('zh'))).toBe(false);
  });
});
