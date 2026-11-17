// GH-1417 S2: the local word filter. The first half drives the matcher with a FIXTURE list of invented words, so each normalisation
// step is pinned by an input only that step catches (design section 7); the oracle is literal strings, never the module's own output.
// The second half reads the shipped lists.
import { describe, expect, it } from 'vitest';
import { chatFilters } from '@lions/data/chat-filters';
import { DEFAULT_CALLSIGN } from '@lions/net';
import { MASK, SUBSTRING_MIN, collapse, compileFilter, filterLine, foldChar, sameWord, screenName, shippedFilter, wordsOf, type FilterList } from './chat-filter';

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

  it('step 6, a lone word beside the spaced letters ("a", "I") does not join the run and hide the word (CR3)', () => {
    // Literal oracle: the run joined with its neighbour ("iblarg", "vexi", "avex") is no entry, so only the trimmed reading catches these.
    expect(shown('I b l a r g')).toBe('I ***');
    expect(shown('you are a b l a r g')).toBe('you are a ***');
    expect(shown('b l a r g I')).toBe('*** I');
    expect(hidden('v e x I')).toBe(true);
    expect(hidden('you are a v e x')).toBe(true);
    expect(hidden('a v e x I')).toBe(true);
    // a mask word written plainly next to a spaced one is still masked once each
    expect(shown('a b l a r g blarg')).toBe('a *** ***');
    // the trim only splits a LONE word off: a letter that is no word on its own still joins, and "convex" spelled out is no "vex"
    expect(shown('x b l a r g')).toBe('x b l a r g');
    expect(shown('c o n v e x')).toBe('c o n v e x');
    // the trim is a second READING of a received line; how a list entry compiles (`wordsOf`) is unchanged
    expect(wordsOf('I b l a r g').map((w) => w.norm)).toEqual(['iblarg']);
    // a run of two is never trimmed to one letter
    expect(shown('a b')).toBe('a b');
    // the Russian lone words split off too: "яvex" and "иblarg" are no entry, so only the trimmed reading catches these
    expect(hidden('я v e x')).toBe(true);
    expect(shown('и b l a r g')).toBe('и ***');
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
    // Literal oracle, so the loop below cannot pass by running over nothing (CR6).
    expect(chatFilters.map((c) => c.lang)).toEqual(expect.arrayContaining(['de', 'es-ES', 'fr', 'ru']));
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

  it('a short English hide entry spelled out behind "you are a " still hides (CR3)', () => {
    // Literal oracle: a ruled in-house entry, four letters, so step 9 cannot reach it inside "adyke".
    expect(filterLine(shipped, 'you are a d y k e', { mask: false })).toEqual({ kind: 'hide' });
    expect(filterLine(shipped, 'd y k e I said', { mask: false })).toEqual({ kind: 'hide' });
    // and every short single-word hide entry the same way (24 at the time of writing; the floor keeps the loop from passing empty)
    const short = en.hide.filter((e) => !e.includes(' ') && [...e].length < SUBSTRING_MIN);
    expect(short.length).toBeGreaterThanOrEqual(20);
    for (const e of short) expect(filterLine(shipped, `you are a ${[...e].join(' ')}`, { mask: false }).kind, e).toBe('hide');
  });

  it('a run of three trims to a two-letter entry: "you are a s m" masks s&m (CR3, the 3-letter boundary)', () => {
    // Literal oracle: a shipped two-letter mask entry; "asm" and "smi" are no entry, so only the trimmed reading catches these.
    expect(en.mask).toContain('s&m');
    expect(filterLine(shipped, 'you are a s m', { mask: true })).toEqual({ kind: 'show', text: 'you are a ***', masked: true });
    expect(filterLine(shipped, 's m I said', { mask: true })).toEqual({ kind: 'show', text: '*** I said', masked: true });
  });

  it('a Russian reader: a lone и or я before a spelled-out Russian mask entry is split off, and the entry masks', () => {
    const ru = chatFilters.find((c) => c.lang === 'ru');
    if (ru === undefined) throw new Error('no Russian list');
    // Literal oracle: a shipped ru mask entry; "ижопа" and "яжопа" are no entry, so only the trimmed reading catches these.
    expect(ru.mask).toContain('жопа');
    const reader = shippedFilter('ru');
    expect(filterLine(reader, 'и ж о п а', { mask: true })).toEqual({ kind: 'show', text: 'и ***', masked: true });
    expect(filterLine(reader, 'я ж о п а', { mask: true })).toEqual({ kind: 'show', text: 'я ***', masked: true });
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

  it('review of PR 1492, finding (iv): a short hide entry\'s plural hides too, in chat and in a name, and the plural idioms show', () => {
    // Literal oracle. Each singular is shorter than SUBSTRING_MIN, so it matches whole words only and never inside its plural: the
    // plural is caught by its own hide entry or by nothing.
    for (const [one, many] of [['chink', 'chinks'], ['mong', 'mongs'], ['pikey', 'pikeys'], ['shota', 'shotas']]) {
      expect([...one].length, one).toBeLessThan(SUBSTRING_MIN);
      for (const w of [one, many]) {
        expect(en.hide, w).toContain(w);
        expect(filterLine(shipped, `ok ${w} ok`, { mask: false }).kind, w).toBe('hide');
        expect(filterLine(shipped, `ok ${w} ok`, { mask: true }).kind, w).toBe('hide');
        expect(screenName(shipped, w), w).toBe(DEFAULT_CALLSIGN);
        expect(screenName(shipped, `${w[0].toUpperCase()}${w.slice(1)}`), w).toBe('Lion');
      }
      expect(en.in_house, many).toContain(many);
    }
    for (const s of ['found the chinks in their armour', 'chinks in the armor', 'chinks of light through the wall']) {
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
