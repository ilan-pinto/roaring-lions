// The chrome register (register items VR-20, VR-24..VR-31; `docs/polish/
// visual-register.md`). One treatment per job, read back off disk the way
// `type-register.test.ts` reads the type register (jsdom computes no
// stylesheet). What it holds:
//
//   VR-20  case follows face: display face is capitals, body face is not;
//          tiles, tabs and stamps are display, every other button is .rl-btn
//   VR-24  each panel() wears the rank its job names; band tokens colour a
//          band, the mission stamp and the briefing's own voice, nothing else
//   VR-25  one colour per currency: credits --commend, logistics/intel --info
//   VR-26  one "selected" (--selected/--selected-fill), one "on" (--on)
//   VR-27  one disabled: --disabled-opacity and `not-allowed`
//   VR-28  one focus ring: nothing turns it off or redraws it
//   VR-29  every duration, easing, radius and rung-sized space is a token
//   VR-30  one type halo: --halo
//   VR-31  --accent means "interactive" and nothing else
//
// Every spec below was falsified by a one-line mutation of the implementation;
// the mutations and their red results are in the PR that landed this file.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BAR_GROW_MS, STAMP_MS } from './garage-model';

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf8');

const raw = read('packages/app/src/ui/theme.css');
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');

interface Rule {
  index: number;
  selectors: string[];
  body: string;
}

// Leaf rules only (`selector { body }` with no brace inside the body), in file
// order. A media query's wrapper never matches; the rules inside it do.
const rules: Rule[] = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m, index) => ({
  index,
  selectors: m[1].split(',').map((s) => s.replace(/\s+/g, ' ').trim()),
  body: m[2],
}));
const root = rules.find((r) => r.selectors.includes(':root') && r.body.includes('--ink:'));
const rootBody = root?.body ?? '';
const isKeyframeStep = (sel: string): boolean => /^(from|to|\d+%)$/.test(sel);
// Rules a component owns: not :root's token block, not a keyframe step.
const styled = rules.filter((r) => r !== root && !r.selectors.every(isKeyframeStep) && !r.selectors.includes('@font-face'));

const decl = (body: string, prop: string): string[] =>
  [...body.matchAll(new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;]+)`, 'g'))].map((m) => m[1].trim());

/** The selector's own last compound, with `:not(...)` arguments removed, so
 *  `button:hover:not([disabled])` is not read as a disabled-state rule. */
const lastCompound = (sel: string): string => {
  const parts = sel.replace(/:not\([^)]*\)/g, '').split(/\s*[\s>+~]\s*/);
  return parts[parts.length - 1] ?? '';
};

const rulesFor = (selector: string): Rule[] => styled.filter((r) => r.selectors.includes(selector));

function face(selector: string): string | null {
  let f: string | null = null;
  for (const r of rulesFor(selector)) {
    for (const v of [...decl(r.body, 'font-family'), ...decl(r.body, 'font')]) {
      const m = /--font-(display|body|mono)/.exec(v);
      if (m) f = m[1];
    }
  }
  return f;
}
const caps = (selector: string): boolean =>
  rulesFor(selector).some((r) => decl(r.body, 'text-transform').includes('uppercase'));

/** A `:root` token's value. */
const token = (name: string): string => new RegExp(`${name}:\\s*([^;]+);`).exec(rootBody)?.[1].trim() ?? '';
const ms = (v: string): number => (v.endsWith('ms') ? Number(v.slice(0, -2)) : Number(v.slice(0, -1)) * 1000);

describe('the chrome register: theme.css', () => {
  it('scans a real sheet', () => {
    expect(rules.length).toBeGreaterThan(800);
    expect(rootBody).toContain('--selected:');
  });

  describe('VR-20: one button register', () => {
    const DISPLAY_CAPS = [
      // tiles
      '.rl-menu__item',
      // tabs and view toggles
      '.rl-garage__tab',
      '.rl-garage__sort',
      '.rl-menu--garage .rl-garage__view',
      '.rl-menu--garage .rl-stores__shelf',
      '.rl-pause__tabs .rl-btn',
      // stamps
      '.rl-loading__deploy',
      '.rl-garage__buy',
      '.rl-menu--garage .rl-stores__buy',
      '.rl-aar__nav .rl-aar__primary',
    ];

    it('sets every tile, tab and stamp in the display face, in capitals', () => {
      const off = DISPLAY_CAPS.filter((s) => face(s) !== 'display' || !caps(s));
      expect(off).toEqual([]);
    });

    it('sets the action button (.rl-btn) in the body face, sentence case', () => {
      expect(face('.rl-btn')).toBe('body');
      expect(caps('.rl-btn')).toBe(false);
    });

    it('lets case follow face: no rule capitalises a button without the display face', () => {
      // A rule that uppercases a `.rl-btn`, or anything clickable, must name
      // the display face itself. `.rl-aar__nav .rl-btn` did not, which is how
      // the debrief's plain buttons were body face in capitals.
      const offenders = styled
        .filter((r) => decl(r.body, 'text-transform').includes('uppercase'))
        .filter((r) => r.selectors.some((s) => /\.rl-btn\b/.test(lastCompound(s))) || /cursor:\s*pointer/.test(r.body))
        .filter((r) => {
          const fam = [...decl(r.body, 'font-family'), ...decl(r.body, 'font')].join(' ');
          return !fam.includes('--font-display');
        })
        .map((r) => r.selectors.join(', '));
      expect(offenders).toEqual([]);
    });
  });

  describe('VR-24: band ranks', () => {
    it('lets the band tokens colour only a band, the mission stamp and the briefing voice', () => {
      const allowed = new Set([
        '.rl-panel__band',
        ".rl-panel[data-rank='mission'] .rl-panel__band",
        ".rl-panel[data-rank='alert'] .rl-panel__band",
        // the briefing's own voice: the radio's open frame, its bar and its track
        ".rl-cmd[data-open='1'] .rl-cmd__face",
        '.rl-cmd__bar',
        '.rl-cmd__track > i',
        // the briefing screen's loading bar
        '.rl-loading__fill',
        // the mission stamp
        '.rl-loading__deploy',
        '.rl-loading__deploy:hover',
        '.rl-loading__deploy:focus-visible',
        '.rl-loading__deploy:disabled',
        '.rl-aar__nav .rl-aar__primary',
      ]);
      const offenders = styled
        .filter((r) => /var\(--band-(mission|inspect|alert)\)/.test(r.body))
        .flatMap((r) => r.selectors)
        .filter((s) => !allowed.has(s));
      expect(offenders).toEqual([]);
    });
  });

  describe('VR-25: one colour per currency', () => {
    const colourOf = (selector: string): string => {
      const c = rulesFor(selector).flatMap((r) => decl(r.body, 'color'));
      return c[c.length - 1] ?? '';
    };

    it('shows brigade credits in --commend everywhere', () => {
      const credits = [
        '.rl-dock__credits',
        '.rl-outcome__credits-figure',
        '.rl-outcome__credits-total',
        '.rl-menu--garage .rl-stores__credits',
        '.rl-garage__rung-price',
        '.rl-garage__buy',
      ];
      expect(credits.map((s) => [s, colourOf(s)])).toEqual(credits.map((s) => [s, 'var(--commend)']));
    });

    it("shows this mission's logistics and intel prices in --info, the strip's colour for them", () => {
      expect(colourOf('.rl-tile__cost')).toBe('var(--info)');
      expect(colourOf('.rl-tip__cost')).toBe('var(--info)');
      expect(colourOf('.rl-info')).toBe('var(--info)');
    });

    it('never puts a price or a balance in --good or --accent', () => {
      const offenders = styled
        .filter((r) => r.selectors.some((s) => /(cost|price|credits(?!__)|wallet)/.test(lastCompound(s)) && !/rl-credits__/.test(s)))
        .filter((r) => /var\(--(good|accent)\)/.test(decl(r.body, 'color').join(' ')))
        .map((r) => r.selectors.join(', '));
      expect(offenders).toEqual([]);
    });
  });

  describe('VR-26: one selected, one on', () => {
    const SELECTED = /\[aria-selected='true'\]|\[aria-pressed='true'\]|\[data-chosen='1'\]/;
    const COLOUR_PROPS = ['color', 'background', 'background-color', 'border-color', 'border-bottom-color', 'border-left-color'];
    const colours = (body: string): string[] => COLOUR_PROPS.flatMap((p) => decl(body, p));

    it('draws every pick-one-of-a-set control in --selected and --selected-fill only', () => {
      const states = styled.filter((r) =>
        r.selectors.some((s) => SELECTED.test(lastCompound(s)) || s === ".rl-pause__tabs button[data-on='1']")
      );
      // The scan must find the controls it guards.
      expect(states.length).toBeGreaterThanOrEqual(7);
      const offenders = states
        .filter((r) => colours(r.body).some((v) => !['var(--selected)', 'var(--selected-fill)', 'var(--ink)'].includes(v)))
        .map((r) => `${r.selectors.join(', ')} { ${colours(r.body).join('; ')} }`);
      expect(offenders).toEqual([]);
    });

    it('draws a live mission state in --on only', () => {
      for (const s of [".rl-strip__chip[data-on='1']", ".rl-btn[data-armed='1']"]) {
        const c = rulesFor(s).flatMap((r) => colours(r.body));
        expect(c.length).toBeGreaterThan(0);
        expect(c.filter((v) => v !== 'var(--on)')).toEqual([]);
      }
    });
  });

  describe('VR-27: one disabled', () => {
    const DISABLED = /:disabled|\[disabled\]|\[aria-disabled='true'\]/;
    const DIMMED = /:disabled|\[disabled\]|\[aria-disabled='true'\]|\[data-locked='1'\]|\[data-poor='1'\]|\[data-inert='1'\]|\[data-paused='1'\]/;

    it('dims every unusable state to --disabled-opacity, never a number of its own', () => {
      const dims = styled.filter((r) => r.selectors.some((s) => DIMMED.test(s.replace(/:not\([^)]*\)/g, ''))));
      const offenders = dims.flatMap((r) =>
        decl(r.body, 'opacity')
          .filter((v) => v !== 'var(--disabled-opacity)')
          .map((v) => `${r.selectors.join(', ')}: ${v}`)
      );
      expect(offenders).toEqual([]);
    });

    it('gives every disabled control the dim and `not-allowed`, not a colour swap', () => {
      const own = styled.filter((r) => r.selectors.some((s) => DISABLED.test(lastCompound(s))));
      expect(own.length).toBeGreaterThanOrEqual(6);
      const offenders = own
        .filter((r) => !decl(r.body, 'opacity').includes('var(--disabled-opacity)') || !decl(r.body, 'cursor').includes('not-allowed'))
        .map((r) => r.selectors.join(', '));
      expect(offenders).toEqual([]);
    });

    it('never shows the default cursor on a disabled state', () => {
      const offenders = styled
        .filter((r) => r.selectors.some((s) => DIMMED.test(s.replace(/:not\([^)]*\)/g, ''))))
        .filter((r) => decl(r.body, 'cursor').some((v) => v !== 'not-allowed'))
        .map((r) => r.selectors.join(', '));
      expect(offenders).toEqual([]);
    });
  });

  describe('VR-28: one focus ring', () => {
    const ringRules = styled.filter((r) => r.selectors.includes(':focus-visible'));

    it('draws exactly one ring, in the interactive colour', () => {
      expect(ringRules).toHaveLength(1);
      expect(decl(ringRules[0].body, 'outline')).toEqual(['2px solid var(--accent)']);
    });

    it('lets no focus rule turn the ring off or redraw it (only move it inward, by name)', () => {
      const MAY_INSET = new Set(['.rl-garage__model:focus-visible', '.rl-garage__card:focus-visible', '.rl-garage__rung:focus-visible']);
      const offenders: string[] = [];
      for (const r of styled) {
        if (r === ringRules[0]) continue;
        if (!r.selectors.some((s) => /:focus/.test(s))) continue;
        for (const p of ['outline', 'outline-color', 'outline-style', 'outline-width']) {
          for (const v of decl(r.body, p)) offenders.push(`${r.selectors.join(', ')}: ${p}: ${v}`);
        }
        if (decl(r.body, 'outline-offset').length > 0 && !r.selectors.every((s) => MAY_INSET.has(s))) {
          offenders.push(`${r.selectors.join(', ')}: outline-offset`);
        }
      }
      expect(offenders).toEqual([]);
    });

    it('turns the outline off nowhere but .country-hit, which the ring outranks by order', () => {
      const off = styled.filter((r) => decl(r.body, 'outline').some((v) => v === 'none' || v === '0'));
      expect(off.map((r) => r.selectors.join(', '))).toEqual(['.country-hit']);
      expect(off[0].index).toBeLessThan(ringRules[0].index);
    });
  });

  describe('VR-29: tokens, not literals', () => {
    it('names a rung for every duration and delay (the reduced-motion collapse excepted)', () => {
      const offenders = styled.flatMap((r) =>
        ['transition', 'animation', 'transition-duration', 'animation-duration', 'animation-delay', 'transition-delay']
          .flatMap((p) => decl(r.body, p))
          .filter((v) => /(?<![\w-])\d*\.?\d+m?s\b/.test(v) && !/^1ms !important$/.test(v))
          .map((v) => `${r.selectors.join(', ')}: ${v}`)
      );
      expect(offenders).toEqual([]);
    });

    it('moves on --ease or --ease-steady, never a keyword easing', () => {
      const offenders = styled.flatMap((r) =>
        ['transition', 'animation', 'transition-timing-function', 'animation-timing-function']
          .flatMap((p) => decl(r.body, p))
          .filter((v) => /\b(ease-in-out|ease-in|ease-out|linear|ease)\b(?!-)/.test(v.replace(/var\(--ease(-steady)?\)/g, '')))
          .map((v) => `${r.selectors.join(', ')}: ${v}`)
      );
      expect(offenders).toEqual([]);
    });

    it('keeps corners square: a radius is 0 or a round shape (50%)', () => {
      const offenders = styled.flatMap((r) =>
        decl(r.body, 'border-radius')
          .filter((v) => v !== '0' && v !== '50%')
          .map((v) => `${r.selectors.join(', ')}: ${v}`)
      );
      expect(offenders).toEqual([]);
    });

    it('spends no raw space within 7% of a rung', () => {
      const rungs = [...rootBody.matchAll(/--s\dh?:\s*([\d.]+)rem;/g)].map((m) => Number(m[1]));
      expect(rungs.length).toBeGreaterThanOrEqual(9);
      const offenders: string[] = [];
      for (const r of styled) {
        for (const p of ['padding', 'margin', 'gap', 'row-gap', 'column-gap', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'padding-block', 'padding-inline', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'margin-block', 'margin-inline']) {
          for (const v of decl(r.body, p)) {
            // Positive rem lengths only: a negative margin is a geometric
            // offset (centring a spinner), not a space.
            for (const m of v.matchAll(/(?<![-\w.])(\d*\.?\d+)rem\b/g)) {
              const n = Number(m[1]);
              const near = rungs.find((g) => Math.abs(n - g) / g <= 0.07);
              if (near !== undefined) offenders.push(`${r.selectors.join(', ')}: ${p}: ${m[0]} (rung ${near}rem)`);
            }
          }
        }
      }
      expect(offenders).toEqual([]);
    });

    it('keeps the CSS half of each garage timer equal to the JS half that ends it', () => {
      expect(ms(token('--dur-stamp'))).toBe(STAMP_MS);
      expect(ms(token('--dur-long'))).toBe(BAR_GROW_MS);
      const enlist = /const ENLIST_MS = (\d+);/.exec(read('packages/app/src/ui/brigade.ts'))?.[1];
      expect(ms(token('--dur-lift'))).toBe(Number(enlist));
    });
  });

  describe('VR-30: one type halo', () => {
    it('sets every text halo through --halo, which is the --type-shadow tone alone', () => {
      const shadows = styled.flatMap((r) => decl(r.body, 'text-shadow').map((v) => ({ sel: r.selectors.join(', '), v })));
      expect(shadows.length).toBeGreaterThanOrEqual(8);
      expect(shadows.filter((s) => s.v !== 'var(--halo)')).toEqual([]);
      const halo = token('--halo');
      expect(halo).toContain('var(--type-shadow)');
      expect(halo.replace(/var\(--type-shadow\)/g, '')).not.toMatch(/var\(/);
    });
  });

  describe('VR-31: --accent means "interactive"', () => {
    it('uses --accent only on a hover, focus or selected state', () => {
      const offenders = styled
        .filter((r) => /var\(--accent\)/.test(r.body))
        .filter((r) => !r.selectors.every((s) => /:hover|:focus/.test(s)))
        .map((r) => r.selectors.join(', '));
      expect(offenders).toEqual([]);
      expect(token('--selected')).toBe('var(--accent)');
    });

    it('never dresses an interactive state in --commend (earned) or --kit (bought)', () => {
      const offenders = styled
        .filter((r) => r.selectors.some((s) => /:hover|:focus|\[aria-selected='true'\]|\[aria-pressed='true'\]/.test(lastCompound(s))))
        .filter((r) => /var\(--(commend|kit|roar)\)/.test(r.body))
        .map((r) => r.selectors.join(', '));
      expect(offenders).toEqual([]);
    });
  });
});

describe('the chrome register: panel ranks (VR-24)', () => {
  const rankAt = (rel: string): string[] =>
    [...read(rel).matchAll(/panel\(\{(?:\s*\/\/[^\n]*)*\s*rank:\s*([^,\n]+),/g)].map((m) => m[1].trim());

  it('gives each panel the rank its job names', () => {
    expect(rankAt('packages/app/src/ui/debrief.ts')).toEqual(["'mission'"]);
    expect(rankAt('packages/app/src/tutorial/panel.ts')).toEqual(["'mission'"]);
    // PA-07 (lead ruling 9 Oct): the verdict band is the mission band, the
    // report's own rank, for both outcomes (A's stamp on B's held beat).
    expect(rankAt('packages/app/src/ui/outcome-moment.ts')).toEqual(["'mission'"]);
    expect(rankAt('packages/app/src/ui/confirm.ts')).toEqual(["opts.danger ? 'alert' : 'inspect'"]);
    for (const f of ['pause', 'settings-panel', 'saves', 'keys-overlay', 'credits', 'objectives']) {
      expect([f, rankAt(`packages/app/src/ui/${f}.ts`)]).toEqual([f, ["'inspect'"]]);
    }
  });
});
