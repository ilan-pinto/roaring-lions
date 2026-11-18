// packages/app/src/ui/chat-filter.ts
/**
 * The local word filter for versus chat (GH-1417 S2, `docs/superpowers/specs/2026-11-16-versus-chat-safety-design.md` section 3.3).
 *
 * The lists are DATA, `data/chat/filter.<lang>.json` through `@lions/data/chat-filters`, bundled with the game: nothing here asks
 * a server, so the filter works offline and nothing a player types leaves the browser.
 *
 * LAZY (the main-chunk guard, `pnpm --filter @lions/tools webgpu:bundle`): this module and the lists it imports are loaded on demand
 * by `chat-filter-gate.ts`, the only thing the entry path holds. Never import a value from here outside a test or the gate's dynamic
 * import; `chat-filter-wiring.test.ts` walks the entry's static imports and fails if they reach this file or a list. Until it has
 * loaded, the gate shows no received line and no typed name raw (it holds lines, and names read as the fallback name). Each entry is a plain word or phrase, never a
 * pattern, and this module builds no regular expression from one: matching is token equality and `indexOf`.
 *
 * Two tiers. A `hide` entry hides the WHOLE line, whatever the settings (lead ruling D2: a Settings toggle may turn `mask` off, never
 * `hide`). A `mask` entry replaces only its words with `***`. `allow` names innocent words that contain a long `hide` entry.
 *
 * Which lists apply (D4): every shipped list's `hide` tier, because a slur hides whichever language the reader plays in; and the `mask`
 * tier of English and of the reader's UI language only, because masking is where false positives live ("con", "bitte" and "gol" are
 * ordinary words in a language next door). Only `en` has a hide tier until a native reader reviews the others.
 *
 * Normalisation, both of the list and of the line, one code point at a time so every folded character remembers where it came from
 * and a mask lands on the original text:
 *  1. NFKC (a fullwidth or ligature spelling is the plain one; the room does it too, but a hand-built client skips the room's rules);
 *  2. case fold (`toLowerCase`);
 *  3. combining marks dropped, after NFD (accents, and stacked "zalgo" marks);
 *  4. invisible characters dropped (zero-width spaces and joiners, soft hyphen, BOM, variation selectors) WITHOUT splitting the word;
 *  5. look-alikes mapped: digits (0 1 3 4 5 7), Cyrillic and Greek letters that look Latin, and `@` `$` `!` inside or against a word.
 * Then the line is cut into words (letters and digits; an emoji is a word of its own; everything else separates), and:
 *  6. a run of single letters is one word ("f u c k", "f.u.c.k"); and when the run starts or ends with letters that are words on their
 *     own (`LONE_WORDS`: "a", "I"), the run without up to `MAX_LONE_EDGE` of them at each end is tried too, so "you are a f u c k",
 *     "u a f u c k" and "f u c k I" are still caught;
 *  7. a word matches an entry when equal, or when it is LONGER and equal once repeated letters collapse ("fuuuck"; "as" never
 *     matches "ass", because it is not longer);
 *  8. a phrase matches a run of words;
 *  9. a `hide` entry of `SUBSTRING_MIN` or more letters also matches INSIDE a word ("xslurx"), unless an `allow` word that holds
 *     it covers that spot ("therapist"), or its list names it in `whole_word`: the plural of a short entry, which must match whole
 *     words only as its singular does, or a name such as "HeadShotAssassin" would hide;
 * 10. an `allow` PHRASE excuses a whole-word `hide` hit lying inside it, when the phrase is longer than the hit: an idiom such as
 *     "chink in the armour" shows, the bare word still hides.
 *
 * Honest limit (design 3.3): a word list is a speed bump, not a guarantee. It misses new slang, other scripts and context.
 * Presentation only: nothing here touches a command, a frame or the sim (invariant 4).
 */
import { chatFilters, type ChatFilterJson } from '@lions/data/chat-filters';
import { DEFAULT_CALLSIGN } from '@lions/net';
import { currentLocale } from '../i18n/t';

/** What replaces a masked word or phrase. */
export const MASK = '***';
/** A `hide` entry this long or longer (in folded letters) also matches inside a longer word. Shorter ones match whole words only:
 *  five-letter ones sit inside too many ordinary words ("grapes", "Pakistan", "draped") for an allow list to keep up. */
export const SUBSTRING_MIN = 6;

/** The part of a list file the matcher reads. */
export type FilterList = Pick<ChatFilterJson, 'lang' | 'hide' | 'mask' | 'allow' | 'whole_word'>;

export type LineVerdict = { kind: 'hide' } | { kind: 'show'; text: string; masked: boolean };

interface Token {
  /** The folded word. */
  norm: string;
  /** UTF-16 offsets of the word in the ORIGINAL text, end exclusive. */
  start: number;
  end: number;
}

interface Term {
  /** The entry's folded words. */
  words: readonly string[];
  /** Those words run together, for the inside-a-word match. */
  joined: string;
}

export interface CompiledFilter {
  /** Terms by the collapsed form of their first word, so a line looks up only the terms that can start at a word. */
  readonly hide: ReadonlyMap<string, readonly Term[]>;
  readonly mask: ReadonlyMap<string, readonly Term[]>;
  /** `hide` terms long enough to match inside a word, less those their list names in `whole_word`. */
  readonly inside: readonly Term[];
  /** Folded `allow` words (every entry, its words run together), for step 9. */
  readonly allow: readonly string[];
  /** `allow` entries of two or more words, indexed like the tiers, for step 10. */
  readonly allowPhrases: ReadonlyMap<string, readonly Term[]>;
}

// --- 1-5: folding one code point -------------------------------------------------------------------------------------------------

const inRange = (cp: number, lo: number, hi: number): boolean => cp >= lo && cp <= hi;

function isMark(cp: number): boolean {
  return inRange(cp, 0x0300, 0x036f) || inRange(cp, 0x1ab0, 0x1aff) || inRange(cp, 0x1dc0, 0x1dff) || inRange(cp, 0x20d0, 0x20ff) || inRange(cp, 0xfe20, 0xfe2f);
}

function isInvisible(cp: number): boolean {
  return (
    cp === 0x00ad || cp === 0x034f || cp === 0x061c || cp === 0x115f || cp === 0x1160 || cp === 0x3164 || cp === 0xfeff || cp === 0xffa0 ||
    inRange(cp, 0x17b4, 0x17b5) || inRange(cp, 0x180b, 0x180f) || inRange(cp, 0x200b, 0x200f) || inRange(cp, 0x202a, 0x202e) ||
    inRange(cp, 0x2060, 0x206f) || inRange(cp, 0xfe00, 0xfe0f) || inRange(cp, 0xe0000, 0xe0fff)
  );
}

/** Letters that are read as another letter. Digits, and the Cyrillic and Greek letters that look Latin (lower case: folding runs first). */
const LOOKALIKE: Readonly<Record<string, string>> = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't',
  'а': 'a', 'в': 'b', 'е': 'e', 'ѕ': 's', 'і': 'i', 'ј': 'j', 'к': 'k', 'м': 'm', 'н': 'h', 'о': 'o', 'р': 'p', 'с': 'c', 'т': 't', 'у': 'y', 'х': 'x', 'ԁ': 'd',
  'α': 'a', 'β': 'b', 'ε': 'e', 'ι': 'i', 'κ': 'k', 'ν': 'v', 'ο': 'o', 'ρ': 'p', 'τ': 't', 'υ': 'u', 'χ': 'x',
};

/** Symbols read as a letter when they stand against a word (`@` `$`) or inside one (`!`): "$hit", "a$$", "sh!t", but not "wow!". */
const SYMBOL_LETTER: Readonly<Record<string, string>> = { '@': 'a', '$': 's', '!': 'i' };

/** Steps 1 to 5 for one code point. May return '' (an invisible or a mark) or more than one character (a ligature). */
export function foldChar(ch: string): string {
  let out = '';
  for (const c of ch.normalize('NFKC').toLowerCase().normalize('NFD')) {
    const cp = c.codePointAt(0) ?? 0;
    if (isMark(cp) || isInvisible(cp)) continue;
    out += LOOKALIKE[c] ?? c;
  }
  return out;
}

// --- cutting a line into words ---------------------------------------------------------------------------------------------------

type Kind = 'word' | 'solo' | 'sep';

function kindOf(c: string): Kind {
  const cp = c.codePointAt(0) ?? 0;
  if (cp < 0x80) return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') ? 'word' : 'sep';
  if (inRange(cp, 0x1f000, 0x1faff) || inRange(cp, 0x2600, 0x27bf)) return 'solo';
  if (inRange(cp, 0x80, 0xbf) || cp === 0xd7 || cp === 0xf7 || inRange(cp, 0x2b0, 0x2ff)) return 'sep';
  if (inRange(cp, 0x2000, 0x2bff) || inRange(cp, 0x2e00, 0x2e7f) || inRange(cp, 0x3000, 0x303f) || inRange(cp, 0xfe10, 0xfe6f)) return 'sep';
  return 'word';
}

interface Folded {
  ch: string;
  kind: Kind;
  start: number;
  end: number;
}

/** Folds `text` one code point at a time, each folded character tagged with the code point it came from. */
function foldText(text: string): Folded[] {
  const out: Folded[] = [];
  let at = 0;
  for (const cp of text) {
    const start = at;
    at += cp.length;
    for (const c of foldChar(cp)) out.push({ ch: c, kind: kindOf(c), start, end: at });
  }
  // `@`, `$` and `!` as letters: a run of `@`/`$` touching a word at either end, a run of `!` with a word at both ends.
  let i = 0;
  while (i < out.length) {
    if (SYMBOL_LETTER[out[i].ch] === undefined) {
      i++;
      continue;
    }
    let j = i;
    while (j < out.length && SYMBOL_LETTER[out[j].ch] !== undefined) j++;
    const before = i > 0 && out[i - 1].kind === 'word';
    const after = j < out.length && out[j].kind === 'word';
    const bang = out.slice(i, j).some((f) => f.ch === '!');
    if (bang ? before && after : before || after) {
      for (let k = i; k < j; k++) out[k] = { ...out[k], ch: SYMBOL_LETTER[out[k].ch] ?? out[k].ch, kind: 'word' };
    }
    i = j;
  }
  return out;
}

/** Length in code points, not UTF-16 units. */
const cpLength = (s: string): number => [...s].length;

type RawWord = Token & { solo: boolean };

/** `text` cut into words, folded, before step 6 joins the runs. */
function rawWordsOf(text: string): RawWord[] {
  const raw: RawWord[] = [];
  let cur: Token | null = null;
  for (const f of foldText(text)) {
    if (f.kind === 'word') {
      if (cur === null) cur = { norm: '', start: f.start, end: f.end };
      cur.norm += f.ch;
      cur.end = f.end;
      continue;
    }
    if (cur !== null) raw.push({ ...cur, solo: false });
    cur = null;
    if (f.kind === 'solo') raw.push({ norm: f.ch, start: f.start, end: f.end, solo: true });
  }
  if (cur !== null) raw.push({ ...cur, solo: false });
  return raw;
}

/**
 * Single letters (folded) that are ordinary words on their own in a shipped language: English "a", "I", "O"; Spanish "a", "e", "o",
 * "u", "y"; French "a" (and "à"), "y"; Russian "а", "в", "и", "к", "о", "с", "у", "я" (the look-alikes among them fold to Latin, step 5).
 * One of these at the edge of a run of single letters may be its own word ("you are a b l a r g"), not the spaced word's first or last
 * letter, so step 6 also tries the run without it.
 */
const LONE_WORDS: ReadonlySet<string> = new Set(['a', 'b', 'c', 'e', 'i', 'k', 'o', 'u', 'y', 'и', 'я']);

/** At most this many `LONE_WORDS` letters are split off each edge of a run (GH-1527: two, for "u a ...", "y a ...", "и я ..."). */
const MAX_LONE_EDGE = 2;

/** Step 6 over `raw`: each run of two or more single letters becomes one word, less up to `head` leading and `tail` trailing letters
 *  that are `LONE_WORDS`, while at least two letters are left; a letter split off stays a word of its own. */
function joinRuns(raw: readonly RawWord[], head: number, tail: number): Token[] {
  const out: Token[] = [];
  const one = (r: RawWord): void => {
    out.push({ norm: r.norm, start: r.start, end: r.end });
  };
  let i = 0;
  while (i < raw.length) {
    let j = i;
    while (j < raw.length && !raw[j].solo && cpLength(raw[j].norm) === 1) j++;
    if (j - i >= 2) {
      let a = i;
      let b = j;
      for (let n = 0; n < head && b - a >= 3 && LONE_WORDS.has(raw[a].norm); n++) a++;
      for (let n = 0; n < tail && b - a >= 3 && LONE_WORDS.has(raw[b - 1].norm); n++) b--;
      for (let k = i; k < a; k++) one(raw[k]);
      out.push({ norm: raw.slice(a, b).map((r) => r.norm).join(''), start: raw[a].start, end: raw[b - 1].end });
      for (let k = b; k < j; k++) one(raw[k]);
      i = j;
    } else {
      one(raw[i]);
      i++;
    }
  }
  return out;
}

/** The words of `text`, folded, with where each sits in the original; a run of single letters is one word (step 6). */
export function wordsOf(text: string): Token[] {
  return joinRuns(rawWordsOf(text), 0, 0);
}

/**
 * The readings of a received line that step 6 allows: the plain one (`wordsOf`) first, then, only where some run has a `LONE_WORDS`
 * letter at an edge, the readings with up to `MAX_LONE_EDGE` such letters split off the start, the end, or both. At most nine, each one
 * pass over the line, so the cost stays linear in its length; within one reading every run is trimmed the same way.
 */
function readingsOf(text: string): Token[][] {
  const raw = rawWordsOf(text);
  const plain = joinRuns(raw, 0, 0);
  const out: Token[][] = [plain];
  for (let head = 0; head <= MAX_LONE_EDGE; head++) {
    for (let tail = 0; tail <= MAX_LONE_EDGE; tail++) {
      if (head === 0 && tail === 0) continue;
      const r = joinRuns(raw, head, tail);
      if (r.length !== plain.length) out.push(r);
    }
  }
  return out;
}

/** Runs of one repeated character collapsed to one ("fuuuck" to "fuck", "ass" to "as"). */
export function collapse(s: string): string {
  let out = '';
  let last = '';
  for (const c of s) {
    if (c !== last) out += c;
    last = c;
  }
  return out;
}

/** Step 7: `word` is `entry`, or a stretched spelling of it (longer, and equal once repeats collapse). */
export function sameWord(word: string, entry: string): boolean {
  return word === entry || (cpLength(word) > cpLength(entry) && collapse(word) === collapse(entry));
}

// --- compiling the lists ---------------------------------------------------------------------------------------------------------

function termOf(entry: string): Term | null {
  const words = wordsOf(entry).map((w) => w.norm);
  return words.length === 0 ? null : { words, joined: words.join('') };
}

function index(entries: Iterable<string>): Map<string, Term[]> {
  const by = new Map<string, Term[]>();
  for (const e of entries) {
    const term = termOf(e);
    if (term === null) continue;
    const key = collapse(term.words[0]);
    const list = by.get(key);
    if (list === undefined) by.set(key, [term]);
    else list.push(term);
  }
  return by;
}

/** Builds the matcher: `hide` and `allow` from every list, `mask` from the lists `masks(lang)` names. */
export function compileFilter(lists: readonly FilterList[], masks: (lang: string) => boolean): CompiledFilter {
  const inside: Term[] = [];
  for (const l of lists) {
    // Exact entries, per list: `whole_word` keeps its own list's entry out of step 9, and nothing else.
    const whole = new Set(l.whole_word ?? []);
    for (const e of l.hide) {
      const t = termOf(e);
      if (t !== null && cpLength(t.joined) >= SUBSTRING_MIN && !whole.has(e)) inside.push(t);
    }
  }
  return {
    hide: index(lists.flatMap((l) => l.hide)),
    mask: index(lists.filter((l) => masks(l.lang)).flatMap((l) => l.mask)),
    inside,
    allow: lists.flatMap((l) => l.allow).map((a) => wordsOf(a).map((w) => w.norm).join('')).filter((a) => a !== ''),
    allowPhrases: index(lists.flatMap((l) => l.allow).filter((a) => wordsOf(a).length >= 2)),
  };
}

// --- matching --------------------------------------------------------------------------------------------------------------------

/** Steps 7-8: every [first, last) word range of `words` that some term in `by` matches. */
function phraseHits(words: readonly Token[], by: ReadonlyMap<string, readonly Term[]>): [number, number][] {
  const hits: [number, number][] = [];
  for (let i = 0; i < words.length; i++) {
    for (const term of by.get(collapse(words[i].norm)) ?? []) {
      const n = term.words.length;
      if (i + n > words.length) continue;
      let all = true;
      for (let k = 0; k < n && all; k++) all = sameWord(words[i + k].norm, term.words[k]);
      if (all) hits.push([i, i + n]);
    }
  }
  return hits;
}

/**
 * Step 9: a long `hide` term inside a word, at a spot no `allow` word covers.
 *
 * Cost: for each word, each long term, each place it occurs, every allow word is searched again, so the work grows with the square
 * of a word's length. That is bounded because a line is: the room relays only text through `cleanChat` (`packages/net/src/callsign.ts`,
 * called by `packages/worker/src/match/room-core.ts` on every chat message), capped at `CHAT_MAX_CHARS`, 280 UTF-16 units
 * (`packages/net/src/protocol.ts`, also refused above it by the protocol's own parse and kept by the input's `maxLength`); a callsign
 * is capped at `MAX_CALLSIGN_CHARS`, 24 code points, by `cleanCallsign` in the same file. Lift either cap and this wants an index.
 */
function insideHit(words: readonly Token[], f: CompiledFilter): boolean {
  for (const w of words) {
    for (const term of f.inside) {
      for (let at = w.norm.indexOf(term.joined); at >= 0; at = w.norm.indexOf(term.joined, at + 1)) {
        const end = at + term.joined.length;
        // A one-word term that IS the whole word is not "inside" it: that is step 8's whole-word hit, which an allow phrase may
        // excuse (step 10). A phrase run together ("grimslogan") has no step-8 hit, so it stays here.
        if (term.words.length === 1 && at === 0 && end === w.norm.length) continue;
        let excused = false;
        for (const a of f.allow) {
          for (let q = w.norm.indexOf(a); q >= 0 && !excused; q = w.norm.indexOf(a, q + 1)) excused = q <= at && end <= q + a.length;
          if (excused) break;
        }
        if (!excused) return true;
      }
    }
  }
  return false;
}

/**
 * What a received line becomes: hidden whole, or shown with its masked words replaced. `mask: false` (the Settings toggle) skips the
 * mask tier only; the hide tier is not an option here, so no setting can reach it.
 */
export function filterLine(f: CompiledFilter, text: string, opts: { mask: boolean }): LineVerdict {
  const readings = readingsOf(text);
  // Step 9 reads only the plain reading: splitting a letter off a run makes no substring the joined run did not already hold.
  if (insideHit(readings[0], f)) return { kind: 'hide' };
  for (const words of readings) {
    // Step 10: a hide hit lying wholly inside a LONGER allow phrase hit is excused.
    const allowed = phraseHits(words, f.allowPhrases);
    const excused = ([i, j]: [number, number]): boolean => allowed.some(([a, b]) => a <= i && j <= b && b - a > j - i);
    if (phraseHits(words, f.hide).some((h) => !excused(h))) return { kind: 'hide' };
  }
  if (!opts.mask) return { kind: 'show', text, masked: false };
  const spans = readings
    .flatMap((words) => phraseHits(words, f.mask).map(([a, b]): [number, number] => [words[a].start, words[b - 1].end]))
    .sort((x, y) => x[0] - y[0]);
  if (spans.length === 0) return { kind: 'show', text, masked: false };
  let out = '';
  let at = 0;
  let open: [number, number] | null = null;
  for (const s of spans) {
    if (open !== null && s[0] <= open[1]) {
      open[1] = Math.max(open[1], s[1]);
      continue;
    }
    if (open !== null) {
      out += MASK;
      at = open[1];
    }
    out += text.slice(at, s[0]);
    open = [s[0], s[1]];
  }
  if (open !== null) {
    out += MASK;
    at = open[1];
  }
  return { kind: 'show', text: out + text.slice(at), masked: true };
}

/**
 * A callsign as the other seat sees it: any hit, in either tier, gives the room's fallback name (`Lion`). A name is not a message: it
 * cannot be partly masked and still be a name, and the mask toggle governs chat lines only, so both tiers always apply here.
 */
export function screenName(f: CompiledFilter, raw: string): string {
  const v = filterLine(f, raw, { mask: true });
  return v.kind === 'hide' || v.masked ? DEFAULT_CALLSIGN : raw;
}

const SHIPPED = new Map<string, CompiledFilter>();

/** The shipped lists for a reader in UI language `lang` (the active catalogue's by default), compiled once per language. */
export function shippedFilter(lang: string = currentLocale()): CompiledFilter {
  let f = SHIPPED.get(lang);
  if (f === undefined) {
    f = compileFilter(chatFilters, (l) => l === 'en' || l === lang);
    SHIPPED.set(lang, f);
  }
  return f;
}

/** What the gate (`chat-filter-gate.ts`) holds once this module has loaded: a compiled filter's two questions, bound. */
export interface ChatFilterView {
  line(text: string, opts: { mask: boolean }): LineVerdict;
  name(raw: string): string;
}

/** `f`'s two questions, bound, for the gate and for tests that hand the inbox a fixture. */
export function viewOf(f: CompiledFilter): ChatFilterView {
  return { line: (text, opts) => filterLine(f, text, opts), name: (raw) => screenName(f, raw) };
}

const VIEWS = new Map<string, ChatFilterView>();

/** The shipped lists for a reader in UI language `lang`, as a view, compiled once per language. */
export function shippedView(lang: string = currentLocale()): ChatFilterView {
  let v = VIEWS.get(lang);
  if (v === undefined) {
    v = viewOf(shippedFilter(lang));
    VIEWS.set(lang, v);
  }
  return v;
}
