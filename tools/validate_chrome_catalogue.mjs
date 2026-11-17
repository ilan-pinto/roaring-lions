// GH-1406: a non-English CHROME catalogue (packages/app/src/i18n/<id>.json, beside en.json) must carry exactly en.json's keys and the
// same message SHAPE in every value: the same {placeholders}, and for an ICU `plural` / `select` the same argument, kind and option
// keys. A translator may reorder placeholders and translate the text around and inside the options; nothing else.
//
// Pure function over plain data, like validate_narrative.mjs, so a test can call it against a bare fixture. validate_data.mjs runs it
// for every catalogue it finds. (Mission and unit text carry source hashes against an English edit, `validate_narrative.mjs`; chrome
// strings carry theirs in a SIDECAR, below.)

import { sourceHash } from './validate_narrative.mjs';

/** The shape of one message: a sorted list of `name` for a simple argument and `name:kind[opt,opt]{...inner shapes}` for ICU. */
export function messageShape(msg) {
  const out = [];
  const walk = (s, into) => {
    let i = 0;
    while (i < s.length) {
      if (s[i] !== '{') { i += 1; continue; }
      let depth = 1;
      let j = i + 1;
      while (j < s.length && depth > 0) {
        if (s[j] === '{') depth += 1;
        else if (s[j] === '}') depth -= 1;
        j += 1;
      }
      if (depth !== 0) { into.push('!unbalanced'); return; }
      const body = s.slice(i + 1, j - 1);
      const m = /^\s*([A-Za-z0-9_]+)\s*(?:,\s*(plural|select)\s*,([\s\S]*))?$/.exec(body);
      if (m === null) into.push(`!unparsed:${body}`);
      else if (m[2] === undefined) into.push(m[1]);
      else {
        // options: key {text} key {text} ...
        const opts = [];
        const rest = m[3];
        let k = 0;
        while (k < rest.length) {
          const km = /^\s*([^\s{]+)\s*\{/.exec(rest.slice(k));
          if (km === null) break;
          const start = k + km[0].length;
          let d = 1;
          let e = start;
          while (e < rest.length && d > 0) {
            if (rest[e] === '{') d += 1;
            else if (rest[e] === '}') d -= 1;
            e += 1;
          }
          const inner = [];
          walk(rest.slice(start, e - 1), inner);
          const hashes = (rest.slice(start, e - 1).match(/#/g) ?? []).length > 0 ? '#' : '';
          opts.push(`${km[1]}${hashes}${inner.length ? `(${inner.sort().join(',')})` : ''}`);
          k = e;
        }
        into.push(`${m[1]}:${m[2]}[${opts.sort().join('|')}]`);
      }
      i = j;
    }
  };
  walk(msg, out);
  return out.sort();
}

/**
 * Plural categories a language has BEYOND the `one` and `other` the English messages carry (CLDR; Intl.PluralRules agrees). Russian counts
 * 1 / 2-4 / 5-20 differently, so its messages say `one`, `few`, `many` and `other`. Every language not listed here keeps the strict rule:
 * exactly the English option keys. Adding a language with extra categories is one line here, and a test (validate_chrome_catalogue.test.ts)
 * holds that the table and the platform's plural rules agree.
 */
export const EXTRA_PLURAL_CATEGORIES = { ru: ['few', 'many'] };

/** The extra plural categories for a locale id such as `ru` or `es-ES` (matched on the language part). */
export function pluralExtrasFor(locale) {
  const lang = String(locale ?? '').split('-')[0].toLowerCase();
  return EXTRA_PLURAL_CATEGORIES[lang] ?? [];
}

/** `key {text}` options of the body after `arg, plural,`; the same reading as `messageShape`'s. */
function optionsOf(rest) {
  const out = [];
  let k = 0;
  while (k < rest.length) {
    const km = /^\s*([^\s{]+)\s*\{/.exec(rest.slice(k));
    if (km === null) break;
    const start = k + km[0].length;
    let d = 1;
    let e = start;
    while (e < rest.length && d > 0) {
      if (rest[e] === '{') d += 1;
      else if (rest[e] === '}') d -= 1;
      e += 1;
    }
    out.push([km[1], rest.slice(start, e - 1)]);
    k = e;
  }
  return out;
}

/**
 * Takes a translation's extra plural categories OUT of `msg`, so what is left can be compared with the English by the ordinary shape rule.
 * Every plural argument must carry each of `extras`, and each extra branch must hold the same placeholders (and `#`) as its `other` branch.
 * Returns the message without the extras and the problems found. With no `extras` it changes nothing.
 */
export function withoutExtraPlurals(msg, extras) {
  const problems = [];
  if (extras.length === 0) return { text: msg, problems };
  const walk = (s) => {
    let out = '';
    let i = 0;
    while (i < s.length) {
      const open = s.indexOf('{', i);
      if (open < 0) return out + s.slice(i);
      out += s.slice(i, open);
      let depth = 1;
      let j = open + 1;
      while (j < s.length && depth > 0) {
        if (s[j] === '{') depth += 1;
        else if (s[j] === '}') depth -= 1;
        j += 1;
      }
      if (depth !== 0) return out + s.slice(open);
      const body = s.slice(open + 1, j - 1);
      const m = /^\s*([A-Za-z0-9_]+)\s*,\s*(plural|select)\s*,([\s\S]*)$/.exec(body);
      if (m === null) out += `{${body}}`;
      else {
        const branches = optionsOf(m[3]).map(([k, t]) => [k, walk(t)]);
        if (m[2] === 'plural') {
          const other = branches.find(([k]) => k === 'other');
          for (const e of extras) {
            const b = branches.find(([k]) => k === e);
            if (b === undefined) problems.push(`plural "${m[1]}" has no "${e}" branch`);
            else if (other !== undefined && (messageShape(b[1]).join(' ') !== messageShape(other[1]).join(' ') || b[1].includes('#') !== other[1].includes('#'))) {
              problems.push(`plural "${m[1]}" branch "${e}" has different placeholders from "other"`);
            }
          }
          out += `{${m[1]}, plural, ${branches.filter(([k]) => !extras.includes(k)).map(([k, t]) => `${k} {${t}}`).join(' ')}}`;
        } else out += `{${m[1]}, select, ${branches.map(([k, t]) => `${k} {${t}}`).join(' ')}}`;
      }
      i = j;
    }
    return out;
  };
  return { text: walk(msg), problems };
}

/**
 * Failure strings; `[]` when `tr` has exactly `en`'s keys, each a non-empty string of the same shape.
 * `opts.locale` names the language (`ru`, `es-ES`): a language with extra plural categories (`EXTRA_PLURAL_CATEGORIES`) may, and must, carry
 * them in every plural; every other language must carry exactly the English option keys.
 */
export function chromeCatalogueFailures(file, en, tr, opts = {}) {
  const extras = pluralExtrasFor(opts.locale);
  const out = [];
  if (tr === null || typeof tr !== 'object' || Array.isArray(tr)) return [`${file}: not a JSON object of key -> text`];
  for (const key of Object.keys(en)) {
    if (!(key in tr)) { out.push(`${file}: missing key "${key}"`); continue; }
    const v = tr[key];
    if (typeof v !== 'string' || v.trim() === '') { out.push(`${file}: "${key}" is not a non-empty string`); continue; }
    const want = messageShape(en[key]).join(' ');
    const stripped = withoutExtraPlurals(v, extras);
    for (const p of stripped.problems) out.push(`${file}: "${key}": ${p}`);
    const got = messageShape(stripped.text).join(' ');
    if (want !== got) out.push(`${file}: "${key}" has the wrong placeholders (English: ${want || 'none'}; here: ${got || 'none'})`);
  }
  for (const key of Object.keys(tr)) if (!(key in en)) out.push(`${file}: "${key}" is not a key of en.json`);
  return out;
}

/**
 * The stale-translation guard for chrome (GH-1406, the sidecar). A chrome string cannot carry its own hash (the catalogue is a flat
 * key -> text file the app loads as is), so each locale keeps `data/locales/<id>/chrome.src.json`: `{ "<key>": "<8 hex of the English it
 * was translated from>" }`, `sourceHash` of the English string, the same hash mission and unit overlays carry. An English chrome edit
 * after translation then fails here until someone re-translates the string and sets the new hash. Never read at runtime.
 *
 * Fails on: a translated key with no hash, a stale hash (both printed), a malformed hash, and a hash for a key the catalogue lacks.
 */
export function chromeSourceFailures(file, en, tr, src) {
  const out = [];
  if (src === null || typeof src !== 'object' || Array.isArray(src)) return [`${file}: not a JSON object of key -> source hash`];
  for (const key of Object.keys(tr ?? {})) {
    if (!(key in en)) continue; // chromeCatalogueFailures names it
    const want = sourceHash(en[key]);
    const have = src[key];
    if (have === undefined) out.push(`${file}: "${key}" is translated but carries no source hash: set it to ${want}`);
    else if (typeof have !== 'string' || !/^[0-9a-f]{8}$/.test(have)) out.push(`${file}: "${key}" source hash ${JSON.stringify(have)} is not 8 hex characters`);
    else if (have !== want) out.push(`${file}: "${key}" is stale: it was translated from English ${have}, and the English is now ${want}; re-translate it, then set the hash to ${want}`);
  }
  for (const key of Object.keys(src)) if (!(key in (tr ?? {}))) out.push(`${file}: has a source hash for "${key}", which this catalogue does not translate`);
  return out;
}

/**
 * The sidecar for a catalogue: every translated key's hash. Entries already in `existing` are KEPT (a stale one stays stale and red,
 * so building never blesses an English edit by accident); keys in `rebless` take the current hash; the rest, new keys, take it too.
 */
export function buildChromeSource(en, tr, existing = {}, rebless = []) {
  const out = {};
  for (const key of Object.keys(en)) {
    if (!(key in tr)) continue;
    out[key] = rebless.includes(key) || existing[key] === undefined ? sourceHash(en[key]) : existing[key];
  }
  return out;
}
