// The type register (audit PA-22, register items VR-16..VR-19 and VR-21).
//
// CSS has no unit tests, so this reads `theme.css` and the five back-button
// call sites back off disk (jsdom computes no stylesheet, and under its
// environment `import.meta.url` is an http: URL, so paths resolve from the
// repo root like `brigade.test.ts`'s type-floor spec). The register it holds:
//
//   display  titles, bands, tiles, strip names
//   body     ALL prose -- Barlow, which ships 400 and 600 and nothing else
//   mono     only where figures are the point: clocks, prices, wallets,
//            stat numbers, key caps, counts, identifiers
//
// Every spec below was falsified by a one-line mutation of the implementation;
// the mutations and their red results are in the PR that landed this file.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf8');

const css = read('packages/app/src/ui/theme.css').replace(/\/\*[\s\S]*?\*\//g, '');

interface Rule {
  selectors: string[];
  body: string;
}

// `selector { body }`, leaf rules only: the body pattern excludes braces, so a
// media query's own wrapper never matches and the rules inside it do.
const rules: Rule[] = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selectors: m[1].split(',').map((s) => s.replace(/\s+/g, ' ').trim()),
  body: m[2],
}));

const decl = (body: string, prop: string): string[] =>
  [...body.matchAll(new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*([^;]+)`, 'g'))].map((m) => m[1].trim());

/** The font family a rule NAMES for its own selector, longhand or shorthand. */
function familyOf(body: string): string | null {
  const longhand = decl(body, 'font-family');
  if (longhand.length > 0) return longhand[longhand.length - 1];
  const short = decl(body, 'font');
  const last = short[short.length - 1];
  const named = last === undefined ? null : /var\(--font-(?:display|body|mono)\)/.exec(last);
  return named === null ? null : named[0];
}

/** The weights a rule asks for, longhand or the leading number of `font:`. */
function weightsOf(body: string): string[] {
  const out = decl(body, 'font-weight');
  for (const s of decl(body, 'font')) {
    const m = /^(?:italic\s+)?(bold|bolder|\d{3})\b/.exec(s);
    if (m !== null) out.push(m[1]);
  }
  return out;
}

/** The face the LAST rule naming this exact selector gives it. */
function faceOf(selector: string): string | null {
  let face: string | null = null;
  for (const r of rules) {
    if (!r.selectors.includes(selector)) continue;
    const f = familyOf(r.body);
    if (f !== null) face = /--font-(display|body|mono)/.exec(f)?.[1] ?? null;
  }
  return face;
}

describe('the type register: theme.css', () => {
  it('scans a real sheet', () => {
    // A scan that matched nothing would report zero offenders forever.
    expect(rules.length).toBeGreaterThan(800);
  });

  it('ships exactly the weights it asks the body and mono faces for', () => {
    // Barlow and IBM Plex Mono are static cuts (400, 600); only the display
    // face is a variable axis. Derive that from the @font-face blocks rather
    // than hardcoding it, so adding a 700 cut is a one-line, visible change.
    const shipped: Record<string, number[]> = {};
    for (const r of rules) {
      if (!r.selectors.includes('@font-face')) continue;
      const fam = /font-family:\s*'([^']+)'/.exec(r.body)?.[1] ?? '';
      const w = /font-weight:\s*(\d+)(?:\s+(\d+))?/.exec(r.body);
      if (w === null) continue;
      (shipped[fam] ??= []).push(Number(w[2] ?? w[1]));
    }
    expect(Math.max(...(shipped['Barlow'] ?? [0]))).toBe(600);
    expect(Math.max(...(shipped['IBM Plex Mono'] ?? [0]))).toBe(600);
    expect(Math.max(...(shipped['Big Shoulders Display'] ?? [0]))).toBeGreaterThan(600);
  });

  it('asks no weight above 600 of a face that does not ship it (VR-18)', () => {
    // 700 is only honest where the rule names the variable display face. A
    // rule that names no face inherits an unknown one, so it may not ask for
    // it either: it takes 600, the heaviest cut Barlow and Plex ship.
    // One named exception: `.rl-panel__title` sets 800 and no family of its
    // own, because it sits in `.rl-panel__band`, which is the display face
    // (asserted below, so the exemption cannot outlive its reason).
    const inheritsDisplay = new Set(['.rl-panel__title']);
    expect(faceOf('.rl-panel__band')).toBe('display');
    const offenders: string[] = [];
    for (const r of rules) {
      for (const w of weightsOf(r.body)) {
        const heavy = w === 'bold' || w === 'bolder' || Number(w) > 600;
        if (!heavy) continue;
        if (r.selectors.every((s) => inheritsDisplay.has(s))) continue;
        const f = familyOf(r.body);
        if (f === null || !f.includes('--font-display')) {
          offenders.push(`${r.selectors.join(', ')}: ${w}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('sets prose in the body face, not mono (VR-16) or display (VR-17)', () => {
    const prose = [
      '.rl-menu',
      '.rl-loading',
      '.rl-outcome__aftermath',
      '.rl-outcome__reason',
      '.rl-outcome__radio',
      '.rl-bigbanner__aftermath',
      '.rl-titlecard__sub',
      '.rl-endaftermath',
      '.rl-saves__sub',
      '.rl-saves__msg',
      '.rl-credits__font summary',
      '.rl-credits__licence-text',
      '.rl-tutorial .rl-panel__body',
    ];
    const wrong = prose.filter((s) => faceOf(s) !== 'body').map((s) => `${s} -> ${faceOf(s)}`);
    expect(wrong).toEqual([]);
  });

  it('keeps mono on the figures inside a container that went to the body face', () => {
    // `.rl-menu` and `.rl-loading` are body now; these children name mono
    // themselves, or they would silently lose their tabular figures.
    const figures = [
      '.rl-loading__count',
      '.rl-world__stars',
      '.rl-obj__clock',
      '.rl-keys__cap',
      '.rl-keymap__key',
      '.rl-garage__wallet-n',
      '.rl-garage__stat-n',
      '.rl-garage__rung-price',
      '.rl-aar__mark',
    ];
    const wrong = figures.filter((s) => faceOf(s) !== 'mono').map((s) => `${s} -> ${faceOf(s)}`);
    expect(wrong).toEqual([]);
  });

  it('lets no NEW selector set its text in mono without being named here', () => {
    // The sanctioned mono uses. A new prose rule reaching for mono is the
    // regression VR-16 was filed for; a new numeric one adds its name here.
    const allowed = new Set([
      '.rl-obj__clock',
      '.rl-keys__cap',
      '.rl-sandbox__flag',
      '.rl-aar__mark',
      '.rl-loading__count',
      '.rl-world__stars',
      '.rl-garage__wallet-n',
      '.rl-menu--garage .rl-stores__wallet-n',
      '.rl-menu--garage .rl-stores__pack-price',
      '.rl-menu--garage .rl-stores__coin-n',
      '.rl-menu--garage .rl-stores__credits',
      '.rl-garage__stat-n',
      '.rl-garage__rung-price',
      '.rl-settings__control select',
      '.rl-keymap__key',
      '.rl-saves__form input[type=\'text\']',
      '.rl-credits__uri',
      // feedback (GH-464): the character count, an attachment's size, the
      // send shortcut's keycaps, the reference, and the 1-5 scale
      '.rl-feedback__count',
      '.rl-feedback__sub',
      '.rl-feedback__hint',
      '.rl-feedback__ref',
      '.rl-rate__n',
      ':root',
    ]);
    const seen: string[] = [];
    const extra: string[] = [];
    for (const r of rules) {
      const f = familyOf(r.body);
      if (f === null || !f.includes('--font-mono')) continue;
      for (const s of r.selectors) {
        seen.push(s);
        if (!allowed.has(s)) extra.push(s);
      }
    }
    expect(seen.length).toBeGreaterThan(10); // vacuity guard
    expect(extra).toEqual([]);
  });

  it('defines every --t-* size it references at :root (VR-19)', () => {
    const defined = new Set<string>();
    for (const r of rules) {
      if (!r.selectors.includes(':root')) continue;
      for (const m of r.body.matchAll(/(--t-[\w-]+)\s*:/g)) defined.add(m[1]);
    }
    const used = new Set([...css.matchAll(/var\(\s*(--t-[\w-]+)/g)].map((m) => m[1]));
    expect(used.size).toBeGreaterThan(8); // vacuity guard
    expect([...used].filter((n) => !defined.has(n))).toEqual([]);
  });

  it('declares no private type scale of its own (VR-19)', () => {
    // The garage's `--t-title/-h2/-h3/-small` are gone; the only `--t-*` a
    // non-root rule may declare is the garage's `--t-body` re-point.
    const own: string[] = [];
    for (const r of rules) {
      if (r.selectors.includes(':root')) continue;
      for (const m of r.body.matchAll(/(?:^|[;\s])(--t-[\w-]+)\s*:/g)) {
        if (m[1] !== '--t-body') own.push(`${r.selectors.join(', ')}: ${m[1]}`);
      }
    }
    expect(own).toEqual([]);
  });
});

describe('the type register: back buttons (VR-21)', () => {
  // Every way back is the plain `.rl-btn`. The menu TILE is for going forward.
  // Since GH-498 every screen footer builds its way back through `foot.ts`'s
  // `footBack` (whose own default class is read too); the briefing's is still
  // built by hand. The count is the sites, so a screen that stops building
  // one, or builds it some third way, fails here rather than passing on
  // fewer matches.
  const sites: Array<[string, RegExp]> = [
    ['packages/app/src/ui/foot.ts', /export function footBack\([^)]*className = '([^']+)'/g],
    ['packages/app/src/ui/settings-panel.ts', /footBack\([^;]*?, '([^']+)'\)/g],
    ['packages/app/src/ui/saves.ts', /footBack\([^;]*?, '([^']+)'\)/g],
    ['packages/app/src/ui/credits.ts', /footBack\([^;]*?, '([^']+)'\)/g],
    ['packages/app/src/ui/loading.ts', /back\.className = '([^']+)'/g],
  ];
  const defaultSites: Array<[string, number]> = [
    // the campaign board and Free Play
    ['packages/app/src/ui/menu.ts', 2],
    ['packages/app/src/ui/brigade.ts', 1],
    // the campaign map, or the main menu once the campaign is done
    ['packages/app/src/ui/debrief.ts', 2],
  ];

  it('are all `.rl-btn` and none is a `.rl-menu__item` tile', () => {
    let count = 0;
    const wrong: string[] = [];
    for (const [file, re] of sites) {
      for (const m of read(file).matchAll(re)) {
        count++;
        const classes = m[1].split(/\s+/);
        if (!classes.includes('rl-btn') || classes.includes('rl-menu__item')) wrong.push(`${file}: ${m[1]}`);
      }
    }
    // foot.ts's default, settings, saves, credits, the briefing
    expect(count).toBe(5);
    expect(wrong).toEqual([]);
    // ...and the screens that take footBack's default class.
    for (const [file, n] of defaultSites) {
      expect([file, [...read(file).matchAll(/footBack\(t\('[\w.]+'\), [^,()]+(?:\(\))?\)/g)].length]).toEqual([file, n]);
    }
  });

  it('is the base button in the stylesheet: body face, no tile override', () => {
    expect(faceOf('.rl-btn')).toBe('body');
    // No rule may style a back control as a tile.
    const tile = rules.filter((r) =>
      r.selectors.some((s) => /rl-menu__item\[data-kind='back'\]/.test(s)),
    );
    expect(tile).toEqual([]);
  });
});
