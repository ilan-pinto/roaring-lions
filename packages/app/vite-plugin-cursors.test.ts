// The generated cursor CSS.
//
// Colour comes from data/palette.json at inject time, so nothing on disk under
// a validate:ui root ever holds a literal -- the same reason vite-plugin-
// palette.ts injects rather than emitting a stylesheet.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cursorRules, resolvePalette } from './vite-plugin-cursors';

const PALETTE = {
  ramps: { limestone: { colors: ['#EEE', '#DDD', '#CCC', '#BBB', '#AAA', '#999', '#888'] } },
  reserved: { ui: { colors: { bad: '#C0392B', good: '#27AE60', ink: '#111111' } } },
};

describe('cursorRules', () => {
  const css = cursorRules(PALETTE);

  it('emits a rule for every cursor name the app can ask for', () => {
    // 'default' deliberately has no rule: it is the OS arrow.
    for (const name of ['move', 'attack', 'blocked', 'costly', 'protected', 'support']) {
      expect(css).toContain(`[data-cursor='${name}']`);
    }
  });

  it('gives every rule a hotspot rather than defaulting to the top-left', () => {
    // `url(...) auto` with no coordinates points from 0,0, which is wrong for
    // every shape here and invisible in a screenshot.
    const rules = css.split('\n').filter((l) => l.includes('url('));
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule).toMatch(/\)\s+\d+\s+\d+\s*,\s*auto/);
    }
  });

  it('takes its colours from the palette it is given', () => {
    // Proves the palette is actually read rather than the colours hardcoded:
    // a colour from PALETTE must appear, URL-encoded.
    expect(css).toContain(encodeURIComponent('#C0392B').toLowerCase().replace('%23', '%23'));
  });

  it('encodes the SVG so it survives a CSS url()', () => {
    // A raw '#' inside a data URI terminates it and the cursor silently
    // becomes the default arrow.
    expect(css).not.toMatch(/data:image\/svg\+xml,[^"]*[^%]#/);
  });

  it('changes when the palette changes', () => {
    const other = cursorRules({
      ...PALETTE,
      reserved: { ui: { colors: { bad: '#00FF00', good: '#27AE60', ink: '#111111' } } },
    });
    expect(other).not.toBe(css);
  });
});

// cursorRules above is exercised only against an invented `reserved.ui` band
// -- a shape that never occurs in the real data/palette.json, which has only
// `vfx`, `team` and `group`. cursorsPlugin's read()/deriveUiBand translation
// from the real bands into that shape is otherwise untested: a rename of
// team.hostile or scrub[0] would leave every test above green and only break
// at build time (or worse, silently emit `undefined` as a colour). This
// closes that seam by running the real translation against the real file.
describe('deriveUiBand against the real data/palette.json', () => {
  // Same relative path vite.config.ts uses from this same directory.
  const paletteUrl = new URL('../../data/palette.json', import.meta.url);
  const raw = JSON.parse(readFileSync(paletteUrl, 'utf8'));
  const resolved = resolvePalette(paletteUrl);

  it("derives ui.bad and ui.good from the real palette's team.hostile and scrub[0]", () => {
    expect(resolved.reserved.ui.colors.bad).toBe(raw.reserved.team.colors.hostile);
    expect(resolved.reserved.ui.colors.good).toBe(raw.ramps.scrub.colors[0]);
  });

  it('carries those real colours into cursorRules, percent-encoded', () => {
    const css = cursorRules(resolved);
    expect(css).toContain(encodeURIComponent(raw.reserved.team.colors.hostile.toLowerCase()));
    expect(css).toContain(encodeURIComponent(raw.ramps.scrub.colors[0].toLowerCase()));
  });
});
