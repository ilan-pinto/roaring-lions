// The command line of `pnpm locales:chrome-src`. pnpm 11 passes a literal `--` through to the script, so the documented form
// `pnpm locales:chrome-src -- de` reached it as `['--', 'de']` and was refused as if no language were given. Both forms must parse the same.
import { describe, expect, it } from 'vitest';
import { parseArgs, USAGE } from '../locales_chrome_src.mjs';

describe('locales_chrome_src parseArgs', () => {
  it('reads the language with no separator', () => {
    expect(parseArgs(['de'])).toEqual({ lang: 'de', write: false, rebless: [] });
  });

  it('drops the `--` pnpm 11 passes through, so both forms parse the same', () => {
    expect(parseArgs(['--', 'de'])).toEqual({ lang: 'de', write: false, rebless: [] });
    expect(parseArgs(['--', 'de'])).toEqual(parseArgs(['de']));
  });

  it('keeps the options after the separator', () => {
    expect(parseArgs(['--', 'es-ES', '--write', '--rebless=a.b,c.d'])).toEqual({ lang: 'es-ES', write: true, rebless: ['a.b', 'c.d'] });
    expect(parseArgs(['fr', '--', '--write'])).toEqual({ lang: 'fr', write: true, rebless: [] });
  });

  it('refuses a missing language, an option in its place, and en', () => {
    expect(parseArgs([])).toEqual({ error: USAGE });
    expect(parseArgs(['--'])).toEqual({ error: USAGE });
    expect(parseArgs(['--write', 'de'])).toEqual({ error: USAGE });
    expect(parseArgs(['--', 'en'])).toEqual({ error: USAGE });
  });
});
