// packages/app/src/i18n/pseudo.ts
/**
 * The pseudo-locale transform: every ASCII letter through a fixed accented
 * table, `{…}` interpolation spans, `<…>` HTML tags, `&…;` character
 * entities and digit runs left untouched -- touching any of those would
 * desync a captured screenshot from the params that produced it, break
 * `format()`'s own `{…}` parsing, or turn markup into something no longer
 * parseable as markup -- then
 * padded by about a third and bracketed. `?pseudo=1` (see `locales.ts`)
 * wraps the `en` catalogue in this: a screen that never calls `t()` at all
 * reads as conspicuously plain English against everything that does, and a
 * screen whose translated text is too long to fit shows it before a real
 * translator ever sees the string.
 */
const TABLE: Readonly<Record<string, string>> = {
  a: 'á',
  b: 'ƀ',
  c: 'ç',
  d: 'ð',
  e: 'é',
  f: 'ƒ',
  g: 'ĝ',
  h: 'ĥ',
  i: 'î',
  j: 'ĵ',
  k: 'ķ',
  l: 'ļ',
  m: 'ɱ',
  n: 'ñ',
  o: 'ö',
  p: 'þ',
  q: 'ɋ',
  r: 'ř',
  s: 'š',
  t: 'ţ',
  u: 'ü',
  v: 'ṽ',
  w: 'ŵ',
  x: 'ẍ',
  y: 'ý',
  z: 'ž',
};

const LETTER = /[A-Za-z]/;

/** A whole character reference -- named (`&amp;`), decimal (`&#39;`) or hex
 *  (`&#x27;`) -- anchored at the `&` (sticky). Only a WHOLE one: a bare `&`
 *  is prose, and so is everything after it up to the next `;`. */
const ENTITY = /&(?:[A-Za-z][A-Za-z0-9]*|#[0-9]+|#[xX][0-9A-Fa-f]+);/y;

function accent(ch: string): string {
  const lower = ch.toLowerCase();
  const mapped = TABLE[lower];
  if (mapped === undefined) return ch;
  return ch === lower ? mapped : mapped.toUpperCase();
}

export function pseudo(s: string): string {
  let out = '';
  let letters = 0;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '{') {
      // A `{…}` span is a format() placeholder, not prose -- copy it
      // untouched, unterminated braces included, so a malformed message
      // still round-trips through pseudo() the same way format() itself
      // falls back to raw text on one.
      const close = s.indexOf('}', i);
      const end = close < 0 ? s.length : close + 1;
      out += s.slice(i, end);
      i = end;
      continue;
    }
    if (ch === '<') {
      // An HTML tag -- name and attributes copied verbatim, exactly the way
      // a `{…}` placeholder is above. A caller that builds `innerHTML` around
      // translated text (mission-notice.ts's markup, a future rich hint)
      // needs its tags to stay parseable; accenting `<b>` into `<ƀ>` would
      // silently stop the browser recognising it as an element at all rather
      // than merely looking odd, which is a worse failure than the one this
      // transform exists to surface.
      const close = s.indexOf('>', i);
      const end = close < 0 ? s.length : close + 1;
      out += s.slice(i, end);
      i = end;
      continue;
    }
    if (ch === '&') {
      // A character entity is markup for the same reason a tag is (final
      // review, ruling 4). Every caller that builds `innerHTML` escapes a
      // parameter BEFORE `t()` formats it, and this transform runs on the
      // formatted string -- so an escaped `&amp;` arrives here looking like
      // prose, and accenting it (`&ámþ;`) stops the parser reading it as an
      // entity at all: the player sees five characters where one belonged.
      // Unlike `<…>` this is a pattern and not an `indexOf(';')` span, because
      // a bare `&` is ordinary punctuation and the words after it are prose.
      ENTITY.lastIndex = i;
      const entity = ENTITY.exec(s);
      if (entity !== null) {
        out += entity[0];
        i += entity[0].length;
        continue;
      }
    }
    if (LETTER.test(ch)) {
      out += accent(ch);
      letters++;
    } else {
      out += ch;
    }
    i++;
  }
  const pad = '·'.repeat(Math.ceil(letters * 0.3));
  return `⟦${out}${pad}⟧`;
}
