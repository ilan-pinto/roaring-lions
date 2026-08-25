// The generated cursor CSS.
//
// Colour comes from data/palette.json at inject time, so nothing on disk under
// a validate:ui root ever holds a literal -- the same reason vite-plugin-
// palette.ts injects rather than emitting a stylesheet.
//
// This file runs in the project's default `environment: 'node'` (see
// vitest.config.ts) -- switching the whole file to `environment: 'jsdom'` via
// the `@vitest-environment` docblock was tried and rejected: jsdom installs
// its own `URL` as the global, and `readFileSync(paletteUrl)` a few tests
// below (real `data/palette.json` on disk) then throws "The URL must be of
// scheme file", because Node's `fs` does not recognise jsdom's URL instance.
// Rather than touch the global config or route every URL through
// `fileURLToPath`, the one test below that needs a DOM builds its own via
// the `jsdom` package directly and never touches the global environment.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { unitTypeFromJson, type UnitTypeJson } from '@lions/sim';
import { describe, expect, it } from 'vitest';
import { cursorKey } from './src/input/cursor';
import { roleBucket, type RoleBucket } from './src/ui/role';
import { BADGED_VERBS, CENTER, cursorRules, deriveUiBand, resolvePalette } from './vite-plugin-cursors';

// Same relative path vite.config.ts uses from this same directory. Hoisted
// here (rather than inside a single describe) so both the real-palette
// describe below and the badged-rules describe can read the same `raw`
// fixture instead of each parsing the file a second time.
const paletteUrl = new URL('../../data/palette.json', import.meta.url);
const raw = JSON.parse(readFileSync(paletteUrl, 'utf8'));
const resolved = resolvePalette(paletteUrl);

/** Pulls the selector text for one cursor's rule out of the generated CSS,
 *  so tests can assert on the selector's real matching behaviour instead of
 *  on its spelling. */
function selectorFor(css: string, name: string): string {
  const rule = css.split('\n').find((l) => l.includes(`data-cursor='${name}'`));
  if (!rule) throw new Error(`no rule found for ${name}`);
  const brace = rule.indexOf('{');
  return rule.slice(0, brace).trim();
}

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

  it('gives every rule a hotspot at the shape\'s actual centre, not the top-left', () => {
    // `url(...) auto` with no coordinates points from 0,0, which is wrong for
    // every shape here and invisible in a screenshot. Matching against `\d+`
    // alone would accept "0 0" -- the exact wrong value this test is named
    // to reject -- so this asserts the hotspot equals CENTER on both axes,
    // the shape's real geometric middle.
    const rules = css.split('\n').filter((l) => l.includes('url('));
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule).toMatch(new RegExp(`\\)\\s+${CENTER}\\s+${CENTER}\\s*,\\s*auto`));
    }
  });

  it('declares the shape as the CSS cursor property, not some other property', () => {
    // A rule that draws the right picture under the wrong declaration (e.g.
    // `outline:` instead of `cursor:`) would leave the OS arrow on screen
    // just as surely as a dead selector would.
    for (const name of ['move', 'attack', 'blocked', 'costly', 'protected', 'support']) {
      const rule = css.split('\n').find((l) => l.includes(`data-cursor='${name}'`));
      expect(rule).toMatch(/\{\s*cursor:\s*url\(/);
    }
  });

  it('matches the real canvas element the app writes data-cursor onto', () => {
    // main.ts sets `canvas.dataset.cursor = name` on the <canvas> itself,
    // inside `#stage`. A descendant-combinator selector like
    // `[data-cursor='move'] canvas` asks for a canvas *inside* the
    // attribute-carrying element and can never match that shape -- this
    // builds the real structure and proves the emitted selector matches it.
    const dom = new JSDOM('<div id="stage"><canvas></canvas></div>');
    const { document } = dom.window;
    const canvas = document.querySelector('canvas')!;
    canvas.dataset.cursor = 'move';

    const selector = selectorFor(css, 'move');
    expect(canvas.matches(selector)).toBe(true);
    expect(document.querySelectorAll(selector).length).toBe(1);
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

describe('badged rules', () => {
  const css = cursorRules(deriveUiBand(raw));

  it('emits a rule for every reachable name-badge key', () => {
    for (const key of ['demolish-soft', 'demolish-armour', 'charge-soft', 'garrison-soft',
                       'mount-soft', 'dismount-transport', 'smoke-armour', 'move-drone',
                       'attack-gunship']) {
      expect(css).toContain(`canvas[data-cursor='${key}']`);
    }
  });

  it('emits no rule for a badge that bucket can never earn', () => {
    // A gunship cannot garrison and a drone cannot demolish. A rule for it
    // would be dead bytes shipped on every page load. `mount-transport` is
    // the one this exact review caught: idsOf returns `riders` for a mount,
    // never the carrier itself, so no transport-bucket unit ever issues one.
    expect(css).not.toContain("data-cursor='garrison-gunship'");
    expect(css).not.toContain("data-cursor='demolish-drone'");
    expect(css).not.toContain("data-cursor='mount-transport'");
  });

  it('leaves the target-describing states unbadged', () => {
    for (const key of ['blocked', 'costly', 'protected', 'support']) {
      expect(css).toContain(`canvas[data-cursor='${key}']`);
      expect(css).not.toContain(`data-cursor='${key}-`);
    }
  });

  it('every generated selector matches a real canvas node', () => {
    // The check slice 2 lacked, which is why the cursor could never appear:
    // the selector was `[data-cursor='x'] canvas` while the attribute was set
    // ON the canvas. A string assertion cannot see that; a DOM node can.
    // (JSDOM is already imported statically at the top of this file, so this
    // reuses that import rather than requiring the package a second time.)
    const dom = new JSDOM('<div id="stage"><canvas></canvas></div>');
    const canvas = dom.window.document.querySelector('canvas')!;
    const selectors = [...css.matchAll(/canvas\[data-cursor='([^']+)'\]/g)].map((m) => m[1]);
    expect(selectors.length).toBeGreaterThan(20);
    for (const key of selectors) {
      canvas.setAttribute('data-cursor', key);
      expect(`${key}:${canvas.matches(`canvas[data-cursor='${key}']`)}`).toBe(`${key}:true`);
    }
  });

  it('agrees with cursorKey about how a key is spelled', () => {
    // The contract nothing typechecks. If these two ever disagree the cursor
    // silently falls back to the OS arrow, which is what happened in slice 2.
    expect(css).toContain(`canvas[data-cursor='${cursorKey('demolish', 'soft')}']`);
    expect(css).toContain(`canvas[data-cursor='${cursorKey('move', null)}']`);
  });
});

// BADGED_VERBS is hand-written, and a hand-written table drifts: the reachable
// buckets for `mount` and `dismount` look symmetric but are not (idsOf returns
// `riders` for a mount and `carriers` for a dismount -- see BADGED_VERBS's own
// comment), and that exact asymmetry was inverted here until a review caught
// it. This derives the reachable set straight from the roster, mirroring the
// same fields unitTypeFromJson reads and cursor.ts's winningVerb/intentVerb
// dispatch on, and asserts it against BADGED_VERBS in both directions -- a
// verb the table claims reachable but no unit can produce (a dead rule, like
// the `mount-transport` this review found) and a verb/bucket a unit can
// produce that the table lacks (a badge that silently falls back to the OS
// arrow) are the same class of bug, and this one test catches both.
describe('BADGED_VERBS reachability is derived from the roster', () => {
  const unitsDir = fileURLToPath(new URL('../../data/units/kdf/', import.meta.url));
  const types = readdirSync(unitsDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => unitTypeFromJson(JSON.parse(readFileSync(`${unitsDir}${f}`, 'utf8')) as UnitTypeJson));

  /** Which verbs a unit type can actually produce. `move` and `attack` are
   *  universal; the rest gate on the same ability/hull flags
   *  unitTypeFromJson exposes -- canGarrison, canDemolish, canTunnelCharge,
   *  canEmbark (a rider boarding, i.e. `mount`), transportSlots > 0 (a
   *  carrier's own `dismount`), and canSmoke. */
  function verbsOf(type: ReturnType<typeof unitTypeFromJson>): (keyof typeof BADGED_VERBS)[] {
    const verbs: (keyof typeof BADGED_VERBS)[] = ['move', 'attack'];
    if (type.canGarrison) verbs.push('garrison');
    if (type.canDemolish) verbs.push('demolish');
    if (type.canTunnelCharge) verbs.push('charge');
    if (type.canEmbark) verbs.push('mount');
    if (type.transportSlots > 0) verbs.push('dismount');
    if (type.canSmoke) verbs.push('smoke');
    return verbs;
  }

  const derived = new Map<keyof typeof BADGED_VERBS, Set<RoleBucket>>();
  for (const type of types) {
    const bucket = roleBucket(type);
    for (const verb of verbsOf(type)) {
      if (!derived.has(verb)) derived.set(verb, new Set());
      derived.get(verb)!.add(bucket);
    }
  }

  it('matches BADGED_VERBS exactly, in both directions', () => {
    expect(types.length).toBeGreaterThan(0);
    const verbKeys = new Set<string>([...Object.keys(BADGED_VERBS), ...derived.keys()]);
    for (const verb of verbKeys) {
      const table = [...(BADGED_VERBS[verb as keyof typeof BADGED_VERBS] ?? [])].sort();
      const roster = [...(derived.get(verb as keyof typeof BADGED_VERBS) ?? [])].sort();
      expect({ verb, table }).toEqual({ verb, table: roster });
    }
  });
});
