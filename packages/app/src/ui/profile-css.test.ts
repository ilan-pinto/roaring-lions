import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./theme.css', import.meta.url), 'utf8');
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
    // A name ending in `-` is a template stub (`tile--${k}`): the loop below covers its expansions.
    const missing = used.filter((c) => !c.endsWith('-') && !hasRule(c) && !NO_RULE_BY_DESIGN.has(c));
    expect(missing).toEqual([]);
  });

  it('the by-design list names nothing that has since gained a rule', () => {
    expect([...NO_RULE_BY_DESIGN].filter((c) => c !== 'rl-profile__' && hasRule(c))).toEqual([]);
  });
});

describe('the templated state classes have a rule each', () => {
  it.each(['won', 'lost', 'drawn'])('%s', (k) => {
    // Drawn keeps the plain digit colour, so it has no tile rule.
    if (k !== 'drawn') expect(hasRule(`rl-profile__tile--${k}`)).toBe(true);
    expect(hasRule(`rl-profile__result--${k}`)).toBe(true);
  });
});

describe('the account page accents (GH-1367 S1)', () => {
  it('colours the record digits and the checkboxes', () => {
    expect(body('.rl-profile__tile--won .rl-profile__tile-n')).toContain('var(--good)');
    expect(body('.rl-profile__tile--lost .rl-profile__tile-n')).toContain('var(--bad-text)');
    expect(body('.rl-profile__show-record input,\n.rl-profile__telemetry input')).toContain('accent-color: var(--accent)');
  });
  it('rules the header card in gold and backs the chips solid', () => {
    expect(body('.rl-profile__card--head')).toContain('var(--accent)');
    expect(body('.rl-profile__result')).toContain('var(--panel-bg-solid)');
    expect(body('.rl-profile__identity-state')).toContain('var(--panel-bg-solid)');
  });
  it('out-ranks the 1em symbol rule for the avatar glyph', () => {
    expect(css).toContain('.rl-avatar .rl-avatar__glyph.rl-sym {');
  });
});
