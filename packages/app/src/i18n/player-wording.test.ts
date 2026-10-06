// WP-P2 (PA-01): developer language must not reach a player.
//
// Every value in `en.json` is chrome a player can be shown, so every value is
// read here as a PLAYER would read it: ICU placeholders and plural/select
// syntax stripped, the branch text kept, HTML tags dropped. What is left must
// not carry a developer word ("debug", "ledger", "mesh", "sandbox", "flag",
// "manifest", "sheet", "console", "sprite", "synthesised", "id", "authored",
// "asset", "tick" and a few more), a raw
// snake_case token, or a placeholder that hands the player a data id
// (`{id}`, `{ids}`).
//
// Genuine uses go in `ALLOWED` by KEY, each with its reason, and an entry
// that no longer matches anything fails -- an exemption outlives its reason
// silently otherwise.
//
// What this cannot see is text that never goes through the catalogue: a
// data field (a unit name, a mission line) or a literal assigned through a
// variable (`validate_i18n.mjs`' own blind spots, named in its header). The
// pseudo-locale checks beside the HUD card and `weapon-name.test.ts` are the
// instrument for the first; this is the one for everything that IS here.
import { describe, expect, it } from 'vitest';
import en from './en.json';

/** The text of an ICU message as a reader sees it, plus its argument names. */
export function playerText(msg: string): { text: string; args: string[] } {
  const args: string[] = [];
  const readUntil = (s: string, i: number, stops: string): number => {
    while (i < s.length && !stops.includes(s[i])) i++;
    return i;
  };
  const parse = (s: string, start: number, nested: boolean): [string, number] => {
    let out = '';
    let i = start;
    while (i < s.length) {
      const ch = s[i];
      if (ch === '}' && nested) return [out, i + 1];
      if (ch === '{') {
        const j = readUntil(s, i + 1, ',}');
        args.push(s.slice(i + 1, j).trim());
        if (s[j] !== ',') {
          out += ' ';
          i = j + 1;
          continue;
        }
        const k = readUntil(s, j + 1, ',}');
        if (s[k] !== ',') {
          out += ' ';
          i = k + 1;
          continue;
        }
        // plural / select branches: `selector {text}` until the closing brace
        i = k + 1;
        for (;;) {
          while (i < s.length && /\s/.test(s[i])) i++;
          if (i >= s.length) break;
          if (s[i] === '}') {
            i++;
            break;
          }
          const open = readUntil(s, i, '{');
          const [branch, next] = parse(s, open + 1, true);
          out += ` ${branch} `;
          i = next;
        }
        continue;
      }
      out += ch === '#' ? ' ' : ch;
      i++;
    }
    return [out, i];
  };
  const [raw] = parse(msg, 0, false);
  return { text: raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), args };
}

const DENY_WORDS =
  /\b(debug(ging)?|ledger|mesh(es)?|sandbox(es)?|flags?|manifests?|sheets?|console|sprites?|synthesi[sz]ed|ids?|authored|assets?|pipeline|placeholder|ticks?|null|undefined|todo|json)\b/i;
const SNAKE = /\b[A-Za-z0-9]+_[A-Za-z0-9_]+\b/;
const ID_ARGS = new Set(['id', 'ids']);

/** A key whose value genuinely needs a denied word, and why. */
const ALLOWED: Readonly<Record<string, string>> = {
  // Empty at WP-P2: every hit the sweep found was reworded rather than
  // exempted. Add `key: 'reason'` here for a use a player genuinely needs.
};

/** Every reason a value would read as developer language, or [] if none. */
export function wordingProblems(msg: string): string[] {
  const { text, args } = playerText(msg);
  const out: string[] = [];
  const word = DENY_WORDS.exec(text);
  if (word) out.push(`developer word "${word[0]}"`);
  const snake = SNAKE.exec(text);
  if (snake) out.push(`raw snake_case "${snake[0]}"`);
  for (const a of args) if (ID_ARGS.has(a)) out.push(`hands the player a data id ({${a}})`);
  return out;
}

const catalogue = en as Record<string, string>;

describe('player-facing wording (PA-01)', () => {
  it('reads plural and select branches as text, and drops the syntax', () => {
    // The extractor is the instrument, so it is pinned first: a stripper that
    // dropped whole `{...}` spans would never see "sheet" inside a plural.
    expect(playerText('{n} / {m} {m, plural, one {sheet} other {sheets}}').text).toBe('/ sheet sheets');
    expect(playerText('<b>debug</b> {x, select, a {on} other {off}}').text).toBe('debug on off');
    expect(playerText('Build {build}').args).toEqual(['build']);
  });

  it('catches each defect class it names (falsification inputs, run every time)', () => {
    expect(wordingProblems('meshes only')).toEqual(['developer word "meshes"']);
    expect(wordingProblems('<b>campaign ledger updated</b>')).toEqual(['developer word "ledger"']);
    expect(wordingProblems('Toggle the debug overlay')).toEqual(['developer word "debug"']);
    expect(wordingProblems('{loaded} / {expected} {expected, plural, one {sheet} other {sheets}}')).toEqual([
      'developer word "sheet"',
    ]);
    expect(wordingProblems('flagged no-fire ground (a synthesised 4×4)')[0]).toMatch(/developer word/);
    expect(wordingProblems('{id} — {effective}/{range} tiles')).toEqual(['hands the player a data id ({id})']);
    expect(wordingProblems('fired gun_120')).toEqual(['raw snake_case "gun_120"']);
    expect(wordingProblems('sheets (NAMER_HULL)')).toEqual(['developer word "sheets"', 'raw snake_case "NAMER_HULL"']);
    // ...and leaves ordinary prose alone.
    expect(wordingProblems('Pinned — suppressed past the limit, holding fire')).toEqual([]);
    expect(wordingProblems('{n, plural, one {# unit} other {# units}} inbound')).toEqual([]);
  });

  it('every en.json value reads as a player would expect, bar named exemptions', () => {
    const offenders = Object.entries(catalogue)
      .filter(([key]) => ALLOWED[key] === undefined)
      .flatMap(([key, value]) => wordingProblems(value).map((p) => `${key}: ${p} -- ${JSON.stringify(value)}`));
    expect(offenders).toEqual([]);
  });

  it('every exemption still exempts something', () => {
    const stale = Object.keys(ALLOWED).filter(
      (key) => catalogue[key] === undefined || wordingProblems(catalogue[key]).length === 0
    );
    expect(stale).toEqual([]);
  });

  it('checks the whole catalogue (vacuity guard)', () => {
    expect(Object.keys(catalogue).length).toBeGreaterThan(500);
  });
});
