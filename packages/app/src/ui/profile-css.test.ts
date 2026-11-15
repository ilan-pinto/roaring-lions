import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Comments are stripped first: a selector named only in a comment is not a rule.
const css = readFileSync(new URL('./theme.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const ts = (f: string): string => readFileSync(new URL(f, import.meta.url), 'utf8');

/** Hooks the markup sets for tests and structure that deliberately have no rule of their own. */
const NO_RULE_BY_DESIGN = new Set([
  'rl-profile__',
  'rl-profile__avatar-change',
  'rl-profile__card--data',
  'rl-profile__card--history',
  'rl-profile__card--record',
  'rl-profile__card--signin',
  'rl-profile__closed',
  'rl-profile__col--main',
  'rl-profile__col--side',
  'rl-profile__content',
  'rl-profile__link',
  'rl-profile__copy',
  'rl-profile__deleted',
  'rl-profile__done',
  'rl-profile__more',
  'rl-profile__reauth',
  'rl-profile__signed',
  'rl-profile__signed-out',
  'rl-avatar-picker__cancel',
  'rl-avatar-picker__default',
  'rl-avatar-picker__group',
  'rl-avatar-picker__save',
]);

/** Each templated class stub in the TS, with every expansion it can produce and whether theme.css must rule it. */
const TEMPLATED: Record<string, { name: string; ruled: boolean }[]> = {
  'rl-profile__tile--': [
    { name: 'won', ruled: true },
    { name: 'lost', ruled: true },
    { name: 'drawn', ruled: false }, // keeps the plain digit colour
  ],
  'rl-profile__result--': [
    { name: 'won', ruled: true },
    { name: 'lost', ruled: true },
    { name: 'drawn', ruled: true },
  ],
  'rl-profile__link--': [
    { name: 'google', ruled: true },
    { name: 'steam', ruled: false }, // the plain button
  ],
};

function hasRule(cls: string): boolean {
  return new RegExp(`\\.${cls}(?![\\w-])`).test(css);
}

function body(selector: string): string {
  const i = css.indexOf(`${selector} {`);
  expect(i, `no rule for ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(i, css.indexOf('}', i));
}

describe('profile and avatar-picker classes have a rule in theme.css', () => {
  it.each([
    ['profile.ts', 'rl-profile__'],
    ['avatar-picker.ts', 'rl-avatar-picker__'],
  ])('%s', (file, prefix) => {
    const used = [...new Set(ts(file).match(new RegExp(`${prefix}[a-z0-9-]*(?:--[a-z0-9-]+)?`, 'g')) ?? [])];
    expect(used.length).toBeGreaterThan(3);
    // A name ending in `-` is a template stub (`tile--${k}`); it must be named in TEMPLATED, never skipped.
    const stubs = used.filter((c) => c.endsWith('-') && c !== 'rl-profile__');
    expect(stubs.filter((c) => !(c in TEMPLATED))).toEqual([]);
    const missing = used.filter((c) => !c.endsWith('-') && !hasRule(c) && !NO_RULE_BY_DESIGN.has(c));
    expect(missing).toEqual([]);
  });

  it('the by-design list names nothing that has since gained a rule', () => {
    expect([...NO_RULE_BY_DESIGN].filter((c) => c !== 'rl-profile__' && hasRule(c))).toEqual([]);
  });
});

describe('the templated classes have a rule each', () => {
  it.each(Object.entries(TEMPLATED).flatMap(([stub, xs]) => xs.map((x) => [stub + x.name, x.ruled] as const)))('%s', (cls, ruled) => {
    expect(hasRule(cls)).toBe(ruled);
  });
});

describe('the account page accents (GH-1367 S1)', () => {
  it('colours the record digits and the checkboxes', () => {
    expect(body('.rl-profile__tile--won .rl-profile__tile-n')).toContain('var(--good)');
    expect(body('.rl-profile__tile--lost .rl-profile__tile-n')).toContain('var(--bad-text)');
    expect(body('.rl-profile__show-record input,\n.rl-profile__telemetry input')).toContain('accent-color: var(--selected)');
  });
  it('rules the header card in gold and backs the chips solid', () => {
    expect(body('.rl-profile__card--head')).toContain('border-inline-start: 0.1875rem solid var(--title-accent)');
    expect(body('.rl-profile__result')).toContain('var(--panel-bg-solid)');
    expect(body('.rl-profile__identity-state')).toContain('var(--panel-bg-solid)');
  });
  it('pins the lifted card, the rim, the link, the tag, the status and the perk marker', () => {
    expect(css).toMatch(/--card-bg: color-mix\(in srgb, var\(--rl-shadow-0\) 70%, transparent\)/);
    expect(body('.rl-profile__card')).toContain('background: var(--card-bg)');
    expect(body('.rl-profile__avatar .rl-avatar')).toContain('border-width: 2px');
    expect(body('.rl-profile__privacy-link')).toContain('color: var(--ink-dim)');
    expect(body('.rl-avatar-picker__tag')).toContain('background: var(--avatar-tag-ground)');
    expect(body('.rl-profile__status')).toContain('color: var(--good)');
    const perk = body('.rl-profile__perks li::before');
    expect(perk).toContain("content: '\\203A\\00a0'");
    expect(perk).toContain('color: var(--title-accent)');
    expect(perk).toContain('font-weight: 600');
  });
  it('out-ranks the 1em symbol rule for the avatar glyph', () => {
    expect(css).toContain('.rl-avatar .rl-avatar__glyph.rl-sym {');
  });
});

describe('the warm ground (GH-1367 S2)', () => {
  it('is painted only on a stage that holds the profile column', () => {
    const rules = [...css.matchAll(/([^{}]*)\{[^{}]*var\(--profile-ground\)[^{}]*\}/g)];
    expect(rules.length).toBe(1);
    expect(rules[0]?.[1]?.trim()).toBe('#stage:has(> .rl-menu--profile)');
  });
  it('drops the menu column\'s own box on the profile screen only', () => {
    expect(css).toMatch(/\n\.rl-menu--profile \{\n {2}background: transparent;\n {2}border-color: transparent;/);
    expect(css).not.toMatch(/\n\.rl-menu \{[^}]*transparent/);
  });
  it('never animates', () => {
    expect(body('#stage:has(> .rl-menu--profile)')).not.toMatch(/animation|transition/);
  });
});
