import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import palette from '../../../../data/palette.json';

// Comments are stripped first: a selector named only in a comment is not a rule.
const css = readFileSync(new URL('./theme.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const ts = (f: string): string => readFileSync(new URL(f, import.meta.url), 'utf8');

/** Hooks the markup sets for tests and structure that deliberately have no rule of their own. */
const NO_RULE_BY_DESIGN = new Set([
  'rl-profile__',
  'rl-profile__avatar-change',
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
    { name: 'drawn', ruled: true },
  ],
  'rl-profile__result--': [
    { name: 'won', ruled: true },
    { name: 'lost', ruled: true },
    { name: 'drawn', ruled: true },
  ],
  'rl-profile__link--': [
    { name: 'google', ruled: true },
    { name: 'steam', ruled: true },
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
  it('colours the checkboxes', () => {
    expect(body('.rl-profile__show-record input,\n.rl-profile__telemetry input')).toContain('accent-color: var(--selected)');
  });
  it('rules the header card in gold', () => {
    // S4: the rule takes the crest's rim, and --crest-rim falls back to the same gold when no crest is read.
    const head = body('.rl-profile__card--head');
    expect(head).toContain('--crest-rim: var(--title-accent)');
    expect(head).toContain('border-left: 0.1875rem solid var(--crest-rim)');
  });
  it('pins the lifted card, the rim, the link, the tag, the status and the perk marker', () => {
    expect(css).toMatch(/--card-bg: color-mix\(in srgb, var\(--rl-shadow-0\) 70%, transparent\)/);
    expect(body('.rl-profile__card')).toContain('background: var(--card-bg)');
    expect(body('.rl-profile__avatar .rl-avatar')).toContain('border: 0.1875rem solid var(--crest-rim');
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

// ---- GH-1367 S3: colour per card ------------------------------------------------------------------------------
// jsdom computes no stylesheet, so this reads theme.css the way the S1 and S2 pins do, and computes the WCAG ratios
// from data/palette.json. Falsified by hand (see the PR): each role colour reverted one step, each pin red.
type Rgb = [number, number, number];
const hex = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
const rampHex = (name: string, i: number): Rgb => {
  const r = (palette.ramps as Record<string, { colors: string[] }>)[name];
  const h = r?.colors[i];
  if (h === undefined) throw new Error(`no ${name}.${i}`);
  return hex(h);
};
/** `color-mix(in srgb, a p%, b)`: plain channel interpolation in sRGB, as the browser does. */
const mix = (a: Rgb, p: number, b: Rgb): Rgb => a.map((v, i) => p * v + (1 - p) * (b[i] ?? 0)) as Rgb;
const lum = (c: Rgb): number => {
  const [r, g, b] = c.map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: Rgb, b: Rgb): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};
const shadow1 = rampHex('shadow', 1);
const ink = rampHex('limestone', 0);
const good = rampHex('scrub', 0);
const hostileColours = palette.reserved.team.colors as Record<string, string>;
const hostileVariants = palette.reserved.team.variants as Record<string, Record<string, string>>;
const hostiles: [string, Rgb][] = [
  ['default', hex(hostileColours['hostile'] ?? '')],
  ...Object.entries(hostileVariants).map(([k, v]) => [k, hex(v['hostile'] ?? '')] as [string, Rgb]),
];

/** The token's declaration in `:root`, whitespace collapsed. */
function token(name: string): string {
  const m = new RegExp(`\\n\\s*${name}:\\s*([^;]+);`).exec(css);
  expect(m, `no ${name}`).not.toBeNull();
  return (m?.[1] ?? '').replace(/\s+/g, ' ').trim();
}

describe('card colour roles (GH-1367 S3)', () => {
  it('gives each card its role colour', () => {
    expect(token('--card-head-record')).toBe('var(--rl-olive-2)');
    expect(token('--card-head-history')).toBe('var(--rl-gunmetal-2)');
    expect(token('--card-head-signin')).toBe('var(--rl-limestone-5)');
    expect(token('--card-head-signin-ink')).toBe('var(--rl-shadow-1)');
    expect(token('--card-head-data')).toBe('color-mix(in srgb, var(--rl-water-1) 80%, var(--rl-shadow-1))');
    expect(token('--card-head-danger')).toBe('color-mix(in srgb, var(--bad) 55%, var(--rl-shadow-1))');
    expect(body('.rl-profile__card--record .rl-profile__card-title')).toContain('background: var(--card-head-record)');
    expect(body('.rl-profile__card--history .rl-profile__card-title')).toContain('background: var(--card-head-history)');
    const signin = body('.rl-profile__card--signin .rl-profile__card-title');
    expect(signin).toContain('background: var(--card-head-signin)');
    expect(signin).toContain('color: var(--card-head-signin-ink)');
    expect(body('.rl-profile__card--data .rl-profile__card-title')).toContain('background: var(--card-head-data)');
    const danger = body('.rl-profile__card--danger .rl-profile__card-title');
    expect(danger).toContain('background: var(--card-head-danger)');
    expect(danger).toContain('color: var(--band-ink)');
  });
  it('fills the record tiles, the result chips and the LINKED chip', () => {
    expect(token('--tile-won')).toBe('color-mix(in srgb, var(--good) 55%, var(--rl-shadow-1))');
    expect(token('--tile-lost')).toBe('color-mix(in srgb, var(--bad) 50%, var(--rl-shadow-1))');
    expect(token('--tile-drawn')).toBe('var(--rl-gunmetal-3)');
    expect(token('--tile-ink')).toBe('var(--rl-limestone-0)');
    for (const [base, kinds] of [
      ['.rl-profile__tile', ['won', 'lost', 'drawn']],
      ['.rl-profile__result', ['won', 'lost', 'drawn']],
    ] as const) {
      for (const k of kinds) expect(body(`${base}--${k}`)).toContain(`background: var(--tile-${k})`);
    }
    expect(body('.rl-profile__tile-n')).toContain('color: var(--tile-ink)');
    expect(body('.rl-profile__tile-label')).toContain('color: var(--tile-ink)');
    expect(body('.rl-profile__result')).toContain('color: var(--tile-ink)');
    expect(body('.rl-profile__identity-state')).toContain('background: var(--tile-won)');
    expect(body(".rl-profile__identity-state[data-state='paused']")).toContain('background: var(--tile-drawn)');
  });
  it('colours Steam slate-blue and leaves Google on its dark neutral', () => {
    expect(token('--steam-fill')).toBe('color-mix(in srgb, var(--rl-water-1) 75%, var(--rl-shadow-1))');
    expect(body('.rl-profile__steam,\n.rl-profile__link--steam')).toContain('background: var(--steam-fill)');
    const g = body('.rl-profile__google,\n.rl-profile__link--google');
    expect(g).toContain('background: var(--google-fill)');
    expect(g).toContain('border-color: var(--google-stroke)');
    expect(g).toContain('color: var(--google-text)');
    expect(token('--google-fill')).toBe('var(--rl-brand-google-fill)');
    expect(token('--google-stroke')).toBe('var(--rl-brand-google-stroke)');
    expect(token('--google-text')).toBe('var(--rl-brand-google-text)');
  });
  it("sets Google's dark button by its guidelines: palette brand colours, 40px, 12/10/12 padding, 14/20 type", () => {
    const brand = (palette as { brand: { google: { colors: Record<string, string> } } }).brand.google.colors;
    expect(brand).toEqual({ fill: '#131314', stroke: '#8E918F', text: '#E3E3E3' });
    const g = body('.rl-profile__google,\n.rl-profile__link--google');
    for (const d of ['height: 2.5rem', 'padding: 0 var(--s3)', 'gap: var(--s2h)', 'font-size: 0.875rem', 'line-height: 1.25rem']) expect(g).toContain(d);
    expect(body('.rl-profile__g')).toContain('width: 1.25rem');
    expect(ts('profile.ts')).toContain('img.width = 20;');
  });
  it('keeps the 12 and 10 px rungs the Google padding rides on', () => {
    expect(token('--s3')).toBe('0.75rem');
    expect(token('--s2h')).toBe('0.625rem');
  });
  it('pins the tokens the contrast pairs assume to the literals they use', () => {
    expect(token('--ink')).toBe('var(--rl-limestone-0)');
    expect(token('--ink-mute')).toBe('var(--rl-limestone-4)');
    expect(token('--band-ink')).toBe('var(--rl-limestone-0)');
    expect(token('--good')).toBe('var(--rl-scrub-0)');
    expect(token('--title-accent')).toBe('var(--rl-dust-0)');
    expect(token('--panel-bg-solid')).toMatch(/shadow-1/);
  });
  it('never uses terracotta, which is the Roar coin', () => {
    // The member's own crest may be terracotta (claw, reticle: GH-1367 S4); that is their crest, not the coin.
    const profileRules = [...css.matchAll(/([^{}]*\.rl-profile__[^{}]*)\{([^{}]*)\}/g)]
      .filter((m) => !/data-avatar=|rl-profile__coins-n/.test(m[1] ?? '')) // the coin count is the one rightful --roar
      .map((m) => m[2] ?? '');
    expect(profileRules.length).toBeGreaterThan(40);
    expect(profileRules.filter((b) => /terracotta|--roar/.test(b))).toEqual([]);
    for (const t of ['--card-head-danger', '--tile-lost']) expect(token(t)).not.toMatch(/terracotta|roar/);
  });
  it('holds 4.5:1 on every small text pair', () => {
    const pairs: [string, Rgb, Rgb][] = [
      ['record head', ink, rampHex('olive', 2)],
      ['history head', ink, rampHex('gunmetal', 2)],
      ['sign-in head', shadow1, rampHex('limestone', 5)],
      ['data head', ink, mix(rampHex('water', 1), 0.8, shadow1)],
      ['won tile', ink, mix(good, 0.55, shadow1)],
      ['drawn tile', ink, rampHex('gunmetal', 3)],
      ['paused chip', rampHex('limestone', 4), rampHex('gunmetal', 3)],
      ['steam button', ink, mix(rampHex('water', 1), 0.75, shadow1)],
      ['sign-up and headline gold', rampHex('dust', 0), mix(rampHex('shadow', 0), 0.7, shadow1)],
    ];
    for (const [v, bad] of hostiles) {
      pairs.push([`danger head (${v})`, ink, mix(bad, 0.55, shadow1)], [`lost tile (${v})`, ink, mix(bad, 0.5, shadow1)]);
    }
    const low = pairs.filter(([, fg, bg]) => ratio(fg, bg) < 4.5).map(([n, fg, bg]) => `${n}: ${ratio(fg, bg).toFixed(2)}`);
    expect(low).toEqual([]);
    expect(pairs.length).toBe(17);
  });
});
