import { describe, expect, it } from 'vitest';
import { DEFAULT_CALLSIGN, MAX_CALLSIGN_CHARS, callsignOrDefault, cleanCallsign } from './callsign';

describe('cleanCallsign', () => {
  it('leaves an ordinary name alone, spaces inside included', () => {
    expect(cleanCallsign('Ari')).toBe('Ari');
    expect(cleanCallsign('Ari the Lion')).toBe('Ari the Lion');
    expect(cleanCallsign('שחר')).toBe('שחר');
    expect(cleanCallsign('Zoë')).toBe('Zoë');
  });

  it('turns control characters into a space (and collapses it), whichever kind', () => {
    expect(cleanCallsign('A\u0000B')).toBe('A B');
    expect(cleanCallsign('A\tB\nC\rD')).toBe('A B C D');
    expect(cleanCallsign('A\u007FB')).toBe('A B');          // DEL
    expect(cleanCallsign('A\u0085B')).toBe('A B');          // C1 NEL
    expect(cleanCallsign('A\u2028B\u2029C')).toBe('A B C'); // line and paragraph separators
    expect(cleanCallsign('\u0007\u0008Ari\u001B[31m')).toBe('Ari [31m');
  });

  it('drops format characters: bidi overrides and isolates, zero-width, BOM, soft hyphen', () => {
    expect(cleanCallsign('Ari\u202Egnp.exe')).toBe('Arignp.exe');
    expect(cleanCallsign('\u2066Bo\u2069')).toBe('Bo');
    expect(cleanCallsign('A\u200Bri')).toBe('Ari');
    expect(cleanCallsign('\uFEFFAri')).toBe('Ari');
    expect(cleanCallsign('A\u00ADri')).toBe('Ari');
    expect(cleanCallsign('Ari\u200E\u200F')).toBe('Ari');
  });

  it('drops private-use and lone surrogate code points', () => {
    expect(cleanCallsign('A\uE000B')).toBe('AB');
    expect(cleanCallsign('A\uD800B')).toBe('AB');
    expect(cleanCallsign('A\uDC00B')).toBe('AB');
  });

  it('normalises compatibility forms (NFKC) so a lookalike spelling is the plain one', () => {
    expect(cleanCallsign('ＡＲＩ')).toBe('ARI');   // fullwidth
    expect(cleanCallsign('ﬁrst')).toBe('first');            // ligature
    expect(cleanCallsign('e\u0301')).toBe('é');         // composed
    expect(cleanCallsign('Ａ\u200Bｒ')).toBe('Ar');
  });

  it('collapses whitespace runs and trims the ends', () => {
    expect(cleanCallsign('   Ari    Bo  ')).toBe('Ari Bo');
    expect(cleanCallsign('\u00A0\u3000Ari')).toBe('Ari');   // no-break and ideographic spaces
  });

  it('caps at 24 code points, never splitting an astral character, and trims what the cap leaves', () => {
    expect(cleanCallsign('x'.repeat(40))).toBe('x'.repeat(MAX_CALLSIGN_CHARS));
    const lions = '\u{1F981}'.repeat(30);                    // 2 UTF-16 units each
    const out = cleanCallsign(lions);
    expect(Array.from(out)).toHaveLength(MAX_CALLSIGN_CHARS);
    expect(out).toBe('\u{1F981}'.repeat(MAX_CALLSIGN_CHARS));
    expect(out).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    // The 24th character is a space: the cap does not leave it trailing.
    expect(cleanCallsign(`${'x'.repeat(23)} ${'y'.repeat(10)}`)).toBe('x'.repeat(23));
  });

  it('a Zalgo pile of combining marks is bounded by the cap', () => {
    const zalgo = `A${'\u0301\u0316\u0489'.repeat(50)}`;
    expect(Array.from(cleanCallsign(zalgo)).length).toBeLessThanOrEqual(MAX_CALLSIGN_CHARS);
  });

  it('anything that is not a string is nothing', () => {
    for (const v of [undefined, null, 5, {}, ['Ari'], true]) expect(cleanCallsign(v)).toBe('');
  });

  it('is idempotent over the awkward inputs', () => {
    const corpus = [
      'Ari', '  A\u200Bri  ', 'e\u200B\u0301', 'Ａ\u202Eｒ', '\u{1F981}'.repeat(30), `A${'\u0301'.repeat(40)}`,
      'ﬁ\u2028ﬁ', 'x'.repeat(23) + ' ' + 'y'.repeat(9), '\u0000\u0001', 'שחר\u200F',
    ];
    for (const raw of corpus) {
      const once = cleanCallsign(raw);
      expect(cleanCallsign(once), JSON.stringify(raw)).toBe(once);
    }
  });
});

describe('callsignOrDefault', () => {
  it('is Lion when nothing usable is left', () => {
    expect(DEFAULT_CALLSIGN).toBe('Lion');
    for (const v of [undefined, '', '   ', '\u0000\u200B', '\u202E', 5]) expect(callsignOrDefault(v)).toBe('Lion');
  });
  it('is the cleaned name otherwise', () => {
    expect(callsignOrDefault('  Ari\u202E ')).toBe('Ari');
  });
});
