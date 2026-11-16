/**
 * GH-1510: the Settings screen follows the account page (GH-1075 P7, GH-1367). jsdom computes no stylesheet, so this
 * reads theme.css the way `profile-css.test.ts` does. It pins what a capture alone would otherwise have to judge: the
 * same width as the profile, the borrowed cards' title strips in the profile's role tokens (whose 4.5:1 pairs that file
 * already checks), the borders out-ranking the profile's own `border`, and the container query that drops to one
 * column when the panel is narrow (the pause menu's tab), not only when the window is.
 *
 * Falsified by one-line mutations of theme.css (see the PR): the container query's two-class selector cut to one; the
 * `container` declaration dropped; `.rl-settings` back to 32rem; the Privacy strip pointed at a raw ramp step; a border
 * rule cut to one class. Each turned its case red, and each was put back by re-editing.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./theme.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const ts = readFileSync(new URL('./settings-panel.ts', import.meta.url), 'utf8');

/** The rule whose selector STARTS a line, so `.rl-settings` is not found inside `.rl-pause__settings .rl-settings`. */
function body(selector: string): string {
  const i = css.indexOf(`\n${selector} {`);
  expect(i, `no rule for ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(i, css.indexOf('}', i));
}

/** The section keys settings-panel.ts can draw, read off its `SectionKey` union. */
const keys = ((): string[] => {
  const m = /type SectionKey = ([^;]+);/.exec(ts);
  return [...(m?.[1] ?? '').matchAll(/'([a-z]+)'/g)].map((x) => x[1] ?? '');
})();

/** The account page's role tokens a strip may wear (GH-1367 S3). */
const ROLE_TOKENS = ['--card-head-record', '--card-head-history', '--card-head-signin', '--card-head-data'];

describe('the settings screen wears the account page (GH-1510)', () => {
  it('is as wide as the profile', () => {
    const want = /width: (min\(64rem, 94vw\))/.exec(body('.rl-menu--profile'))?.[1];
    expect(want).toBe('min(64rem, 94vw)');
    expect(body('.rl-settings')).toContain(`width: ${want ?? ''}`);
  });

  it('gives every section key a title strip in one of the profile role tokens', () => {
    expect(keys).toEqual(['video', 'audio', 'accessibility', 'controls', 'privacy', 'chat', 'language']);
    const strips = [...css.matchAll(/([^{}]*\.rl-profile__card-title[^{}]*)\{([^{}]*)\}/g)].filter((m) => (m[1] ?? '').includes('.rl-settings__card--'));
    for (const k of keys) {
      const rule = strips.find((m) => new RegExp(`\\.rl-settings__card--${k} \\.rl-profile__card-title(?![\\w-])`).test(m[1] ?? ''));
      expect(rule, `no strip for ${k}`).toBeDefined();
      const bg = /background: var\((--[a-z-]+)\)/.exec(rule?.[2] ?? '')?.[1];
      expect(ROLE_TOKENS, `${k}: ${bg ?? 'none'}`).toContain(bg);
    }
    // The limestone strip takes its own dark ink, as the profile's sign-in card does.
    expect(body('.rl-settings__card--accessibility .rl-profile__card-title')).toContain('color: var(--card-head-signin-ink)');
  });

  it('out-ranks the profile card border, which comes later in the file', () => {
    expect(css.indexOf('.rl-profile__card {')).toBeGreaterThan(css.indexOf('.rl-settings__card--audio'));
    const borders = [...css.matchAll(/([^{}]*)\{[^{}]*border-color[^{}]*\}/g)].map((m) => (m[1] ?? '').trim()).filter((s) => s.includes('.rl-settings__card--'));
    expect(borders.length).toBeGreaterThan(0);
    for (const sel of borders) for (const part of sel.split(',')) expect(part.trim()).toMatch(/^\.rl-profile__card\.rl-settings__card--[a-z]+$/);
  });

  it('drops to one column when the panel is narrow, by a container query that out-ranks the profile grid', () => {
    expect(body('.rl-settings__content')).toContain('container: rl-settings / inline-size');
    const q = /@container rl-settings \(max-width: 48rem\) \{\s*\.rl-profile__cols\.rl-settings__cols \{\s*grid-template-columns: minmax\(0, 1fr\);/.exec(css);
    expect(q).not.toBeNull();
    // The profile's grid, which the query must beat, is ruled later in the file.
    expect(css.indexOf('.rl-profile__cols {')).toBeGreaterThan(q?.index ?? Infinity);
  });

  it('stands on the warm ground only as the stage screen, never in the pause menu', () => {
    expect(css).toContain('#stage:has(> .rl-settings) {');
    expect(css).not.toMatch(/\.rl-pause[^{}]*\{[^{}]*--profile-ground/);
  });
});
