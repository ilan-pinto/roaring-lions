// packages/app/src/i18n/pseudo.test.ts
import { describe, expect, it } from 'vitest';
import { escapeHtml } from '../ui/escape-html';
import en from './en.json';
import { pseudo } from './pseudo';
import { setCatalogue, t } from './t';

describe('pseudo', () => {
  it('accents every letter, pads by about a third, and brackets the result', () => {
    const p = pseudo('Deploy');
    expect(p.startsWith('⟦') && p.endsWith('⟧')).toBe(true);
    expect(p).not.toContain('Deploy');
    expect(p.length).toBeGreaterThanOrEqual('Deploy'.length + 2 + 2);
  });
  it('leaves interpolated values alone', () => {
    expect(pseudo('Conduct 88')).toContain('88');
  });
  it('is stable for the same input', () => {
    expect(pseudo('Campaign')).toBe(pseudo('Campaign'));
  });
  it('leaves HTML tags alone but still accents the text between them', () => {
    const p = pseudo('<b>Enemy reinforcements</b> inbound');
    expect(p).toContain('<b>');
    expect(p).toContain('</b>');
    expect(p.startsWith('⟦') && p.endsWith('⟧')).toBe(true);
    expect(p).not.toContain('Enemy');
    expect(p).not.toContain('reinforcements');
    expect(p).not.toContain('inbound');
  });

  // Final review, ruling 4. A caller that builds `innerHTML` escapes a
  // parameter BEFORE `t()` sees it, and the transform runs on the formatted
  // string -- so under `?pseudo=1` an escaped `&amp;` reached this function
  // as prose and came out `&ámþ;`, which the parser shows as those five
  // characters instead of `&`. An entity is markup exactly as a tag is.
  it('copies an escaped entity verbatim, the way it copies a tag', () => {
    expect(pseudo('Salt &amp; pepper')).toContain('&amp;');
    for (const entity of ['&lt;', '&gt;', '&quot;', '&#39;', '&#x27;']) {
      expect(pseudo(`a${entity}b`)).toContain(entity);
    }
    // Still prose on either side of it.
    expect(pseudo('Salt &amp; pepper')).not.toContain('Salt');
  });

  // Only a whole entity is markup. A bare `&` is prose, and whatever follows
  // it up to the next `;` is prose too -- an `indexOf(';')` span, the shape
  // the `<…>` branch uses, would copy "& pepper;" verbatim and leave a real
  // word unaccented, which reads as a string that never went through `t()`.
  it('still accents the words after a bare ampersand', () => {
    const p = pseudo('Salt & pepper; then more');
    expect(p).toContain('&');
    expect(p).not.toContain('pepper');
  });

  it('keeps an escaped parameter an entity through t() under the pseudo-locale', () => {
    setCatalogue('pseudo', { 'hud.fire.heading': 'Projected fire on {target}' }, pseudo);
    try {
      const out = t('hud.fire.heading', { target: escapeHtml('Fish & <b>Chips</b>') });
      expect(out).toContain('&amp;');
      expect(out).toContain('&lt;');
      expect(out).toContain('&gt;');
      expect(out).not.toContain('Fish');
    } finally {
      setCatalogue('en', en);
    }
  });
});
