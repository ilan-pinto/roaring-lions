// packages/app/src/i18n/format.ts
/**
 * A small ICU-shaped message format: `{name}`, `{n, plural, …}`, `{s, select,
 * …}`, one level of nesting. Not the whole of ICU — no offsets, no number
 * formats, no dates — because nothing in the shell needs them yet and a
 * dependency for the rest is a licence line and 40 kB for four features.
 * Plural categories come from Intl.PluralRules for the locale, which is what
 * makes Hebrew's `two`/`many` and Arabic's six a data change later.
 */
export type Params = Readonly<Record<string, string | number>>;

function splitTopLevel(body: string): { arg: string; kind: string | null; rest: string } {
  const first = body.indexOf(',');
  if (first < 0) return { arg: body.trim(), kind: null, rest: '' };
  const second = body.indexOf(',', first + 1);
  if (second < 0) return { arg: body.slice(0, first).trim(), kind: body.slice(first + 1).trim(), rest: '' };
  return { arg: body.slice(0, first).trim(), kind: body.slice(first + 1, second).trim(), rest: body.slice(second + 1).trim() };
}

/** `one {# unit} other {# units}` → [['one', '# unit'], ['other', '# units']] */
function branches(rest: string): [string, string][] {
  const out: [string, string][] = [];
  let i = 0;
  while (i < rest.length) {
    while (i < rest.length && /\s/.test(rest[i])) i++;
    const open = rest.indexOf('{', i);
    if (open < 0) break;
    const sel = rest.slice(i, open).trim();
    let depth = 0;
    let j = open;
    for (; j < rest.length; j++) {
      if (rest[j] === '{') depth++;
      else if (rest[j] === '}' && --depth === 0) break;
    }
    out.push([sel, rest.slice(open + 1, j)]);
    i = j + 1;
  }
  return out;
}

function pluralCategory(n: number, locale: string): string {
  try {
    return new Intl.PluralRules(locale).select(n);
  } catch {
    return n === 1 ? 'one' : 'other';
  }
}

export function format(message: string, params: Params, locale: string): string {
  let out = '';
  let i = 0;
  while (i < message.length) {
    const open = message.indexOf('{', i);
    if (open < 0) {
      out += message.slice(i);
      break;
    }
    out += message.slice(i, open);
    let depth = 0;
    let j = open;
    for (; j < message.length; j++) {
      if (message[j] === '{') depth++;
      else if (message[j] === '}' && --depth === 0) break;
    }
    if (j >= message.length) {
      out += message.slice(open);
      break;
    }
    const body = message.slice(open + 1, j);
    const { arg, kind, rest } = splitTopLevel(body);
    const value = params[arg];
    if (kind === null) {
      out += value === undefined ? `{${arg}}` : String(value);
    } else if (kind === 'plural' && typeof value === 'number') {
      const bs = branches(rest);
      const exact = bs.find(([s]) => s === `=${value}`);
      const cat = pluralCategory(value, locale);
      const pick = exact ?? bs.find(([s]) => s === cat) ?? bs.find(([s]) => s === 'other');
      out += pick ? format(pick[1].replace(/#/g, String(value)), params, locale) : `{${arg}}`;
    } else if (kind === 'select') {
      const bs = branches(rest);
      const pick = bs.find(([s]) => s === String(value)) ?? bs.find(([s]) => s === 'other');
      out += pick ? format(pick[1], params, locale) : `{${arg}}`;
    } else {
      out += `{${body}}`;
    }
    i = j + 1;
  }
  return out;
}
