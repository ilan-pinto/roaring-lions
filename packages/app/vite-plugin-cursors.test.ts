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
// The parity test below is the one place this suite reads @lions/data: the
// plugin mirrors its `teamColorsFor` rather than importing it (Q9), and this
// is what keeps the mirror honest.
import { paletteTeamColors, variantAwareResolver, type ColorVisionVariant } from '@lions/data';
import { describe, expect, it } from 'vitest';
import {
  ANIMATED_CURSORS,
  SIGHT_OF,
  badgeFor,
  cursorFor,
  cursorKey,
  type BadgeHints,
  type CursorHints,
} from './src/input/cursor';
import { resolvePointer, type IntentWorld } from './src/input/intents';
import { HOTSPOT, ORDER_SIGHT, SIGHT_BOX, SIGHT_KEYS, sightFrame, type SightOrderId } from './src/ui/order-sight';
import { roleBucket, type RoleBucket } from './src/ui/role';
import { symbolBody } from './src/ui/symbol';
import {
  BADGED_VERBS,
  CENTER,
  SIZE,
  UNWIRED_BODIES,
  SIGHT_HOTSPOT,
  cursorImages,
  cursorRules,
  decodeSvgUri,
  deriveUiBand,
  encodeSvgUri,
  paletteColors,
  resolveKey,
  resolvePalette,
} from './vite-plugin-cursors';

// Same relative path vite.config.ts uses from this same directory. Hoisted
// here (rather than inside a single describe) so both the real-palette
// describe below and the badged-rules describe can read the same `raw`
// fixture instead of each parsing the file a second time.
const paletteUrl = new URL('../../data/palette.json', import.meta.url);
const raw = JSON.parse(readFileSync(paletteUrl, 'utf8'));
const resolved = resolvePalette(paletteUrl);

// The real roster, read once and shared by the reachability describe below
// and the composer/selector census after it -- both need "every unit type
// data/units/kdf actually has," and reading it twice would risk the two
// describes drifting on which units exist.
const unitsDir = fileURLToPath(new URL('../../data/units/kdf/', import.meta.url));
const unitTypes = readdirSync(unitsDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => unitTypeFromJson(JSON.parse(readFileSync(`${unitsDir}${f}`, 'utf8')) as UnitTypeJson));

/** Pulls the selector text for one cursor's rule out of the generated CSS,
 *  so tests can assert on the selector's real matching behaviour instead of
 *  on its spelling. */
function selectorFor(css: string, name: string): string {
  const rule = css.split('\n').find((l) => l.includes(`data-cursor='${name}'`));
  if (!rule) throw new Error(`no rule found for ${name}`);
  const brace = rule.indexOf('{');
  return rule.slice(0, brace).trim();
}

/** The hex a palette key resolves to under `variant`, lowercased the way
 *  the plugin bakes it. */
const hexOf = (key: string, variant = 'default'): string => resolveKey(raw, variant, key).toLowerCase();

/** Every rule line the DEFAULT colour-vision setting sees: no `data-cvd`
 *  prefix. The colour-vision overrides are covered by their own describe. */
const defaultLines = (css: string): string[] => css.split('\n').filter((l) => !l.includes('data-cvd'));

describe('cursorRules', () => {
  const css = cursorRules(resolved);

  it('draws on the 32-unit grid every path literal in the plugin assumes', () => {
    // Every housing path in vite-plugin-cursors.ts ("M11,21V11H16V16H21V21Z"
    // and its siblings) is authored against this canvas, and bracketAt's
    // mirror arithmetic subtracts from it. Changing SIZE alone would leave the
    // brackets correct and every payload silently off-centre -- art that still
    // renders, still passes every other test here, and is wrong. Pinned so
    // that change has to be deliberate. The sights draw on their own 24-box
    // and are scaled onto the same 32 px canvas, so the hotspot is 16 16 for
    // both.
    expect(SIZE).toBe(32);
    expect(CENTER).toBe(16);
  });

  it("puts the sights' hotspot where order-sight's HOTSPOT lands on the canvas, which is CENTER", () => {
    // Derived, not assumed: SIGHT_HOTSPOT is HOTSPOT x SIZE / SIGHT_BOX. The
    // aim is drawn around (12, 12) on the 24-box, so a moved HOTSPOT moves
    // the emitted hotspot with it -- and this, and every 16 16 assertion
    // below, goes red, since the housing and the sights share one centre by
    // design.
    expect(SIGHT_HOTSPOT).toEqual({ x: (HOTSPOT.x * SIZE) / SIGHT_BOX, y: (HOTSPOT.y * SIZE) / SIGHT_BOX });
    expect(SIGHT_HOTSPOT).toEqual({ x: CENTER, y: CENTER });
  });

  it('emits a rule for every cursor name the app can ask for', () => {
    // 'default' deliberately has no rule: it is the OS arrow.
    for (const name of ['move', 'attack', 'blocked', 'costly', 'protected', 'sweep', 'strike', 'smoke']) {
      expect(css).toContain(`canvas[data-cursor='${name}']`);
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
    for (const name of ['move', 'attack', 'blocked', 'costly', 'protected', 'sweep', 'strike', 'smoke']) {
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
    // the sight aim's steel must appear, URL-encoded.
    expect(css).toContain(encodeSvgUri(hexOf(SIGHT_KEYS.aim)));
  });

  it('encodes the SVG so it survives a CSS url()', () => {
    // A raw '#' inside a data URI terminates it and the cursor silently
    // becomes the default arrow.
    expect(css).not.toMatch(/data:image\/svg\+xml,[^"]*[^%]#/);
  });

  it('encodes lightly and losslessly: single-quoted attributes, only % # < > escaped', () => {
    // encodeSvgUri replaced encodeURIComponent (Task 4 fix round 1): the
    // quotes become single so the CSS string's double quotes stay closed,
    // and nothing but the four characters that can break a data URI is
    // escaped. Every image of every variant round-trips to its markup.
    for (const line of css.split('\n')) {
      const body = line.match(/url\("data:image\/svg\+xml,([^"]+)"\)/)?.[1] ?? '';
      expect(body.length).toBeGreaterThan(0);
      expect(body).not.toMatch(/[#<>"]/);
      // every percent sign starts one of the four escapes and nothing else
      expect(body.replace(/%(25|23|3C|3E)/g, '')).not.toContain('%');
    }
    for (const variant of ['default', ...Object.keys(raw.reserved.team.variants)]) {
      for (const [key, frames] of cursorImages(resolved, variant)) {
        frames.forEach((markup, frame) => {
          expect(markup.includes("'")).toBe(false); // what makes the quote swap reversible
          expect({ variant, key, frame, ok: decodeSvgUri(encodeSvgUri(markup)) === markup }).toEqual({
            variant,
            key,
            frame,
            ok: true,
          });
        });
      }
    }
  });

  it('changes when the palette changes -- a ramp key, a vfx key and a team key alike', () => {
    const edited = (edit: (p: typeof raw) => void): string => {
      const copy = JSON.parse(JSON.stringify(raw));
      edit(copy);
      return cursorRules(deriveUiBand(copy));
    };
    expect(edited((p) => (p.ramps.gunmetal.colors[0] = '#010203'))).not.toBe(css);
    expect(edited((p) => (p.reserved.vfx.colors.interceptor = '#010203'))).not.toBe(css);
    expect(edited((p) => (p.reserved.team.colors.hostile_text = '#010203'))).not.toBe(css);
  });

  it('draws with exactly the colours the housing and the wired sights name, and invents none', () => {
    // A body that silently fell back to a colour it already had would still
    // render and would still pass every shape test here -- this is what
    // catches it. Asserted as a set equality in both directions, so an
    // invented colour fails just as loudly as a missing one.
    //
    // The housing (Q1: garrison, demolish, charge, blocked, costly,
    // protected) draws in six of the `ui` band's seven; `amber` is used by
    // `mount` and `dismount` alone, which earn no rule. The sights draw the
    // aim, the halo, the warm beat and each WIRED order's main and accent --
    // load and unload's transport lime and grass.0 are drawn by bodies that
    // ship no rule (Q2), and halt's team.neutral happens to be the housing's
    // `warn` as well.
    const used = new Set(
      defaultLines(css).flatMap((l) => [...l.matchAll(/%23([0-9a-f]{6})/g)].map((m) => `#${m[1]}`))
    );
    const c = paletteColors(resolved);
    const wired: SightOrderId[] = ['move', 'attackMove', 'sweep', 'strike', 'smoke'];
    const expected = new Set([
      ...[c.ink, c.dim, c.bad, c.warn, c.hot, c.info].map((h) => h.toLowerCase()),
      hexOf(SIGHT_KEYS.aim),
      hexOf(SIGHT_KEYS.halo),
      hexOf(SIGHT_KEYS.hot),
      ...wired.flatMap((id) => [hexOf(ORDER_SIGHT[id].main), hexOf(ORDER_SIGHT[id].accent)]),
    ]);
    expect([...used].sort()).toEqual([...expected].sort());
    for (const unshipped of [c.amber, raw.reserved.vfx.colors.tracer, raw.ramps.grass.colors[0]]) {
      expect({ unshipped, used: used.has(unshipped.toLowerCase()) }).toEqual({ unshipped, used: false });
    }
  });
});

// The housing reads a derived `reserved.ui` band -- a shape that never occurs
// in the real data/palette.json, which has only `vfx`, `team` and `group`.
// deriveUiBand's translation from the real bands into that shape is pinned
// here source by source: a rename of team.hostile or scrub[0] would otherwise
// only break at build time (or worse, silently emit `undefined` as a colour).
describe('deriveUiBand against the real data/palette.json', () => {
  /** Every source location the seven housing colours come from, spelled out
   *  against the real file. A rename or a reordered ramp step lands here and
   *  nowhere else. */
  const SOURCES: Record<string, () => string> = {
    ink: () => raw.ramps.limestone.colors[0],
    dim: () => raw.ramps.gunmetal.colors[1],
    amber: () => raw.ramps.dust.colors[0],
    info: () => raw.ramps.water.colors[0],
    bad: () => raw.reserved.team.colors.hostile,
    warn: () => raw.reserved.team.colors.neutral,
    hot: () => raw.reserved.vfx.colors.fire,
  };

  it('derives all seven housing colours from the real palette', () => {
    for (const [name, source] of Object.entries(SOURCES)) {
      const value = source();
      expect({ name, value: resolved.reserved.ui.colors[name] }).toEqual({ name, value });
      expect({ name, defined: typeof value }).toEqual({ name, defined: 'string' });
    }
    expect(Object.keys(resolved.reserved.ui.colors).sort()).toEqual(Object.keys(SOURCES).sort());
  });

  it('carries six of them into cursorRules, percent-encoded, and amber into none', () => {
    // `amber` is real, derived and drawn -- by `mount` and `dismount`, the two
    // bodies that earn no rule -- so it reaches the sheet through nothing. See
    // the colour-set test above for why that is asserted rather than
    // excluded.
    const css = cursorRules(resolved);
    for (const [name, source] of Object.entries(SOURCES)) {
      const encoded = encodeSvgUri(source().toLowerCase());
      expect({ name, drawn: css.includes(encoded) }).toEqual({ name, drawn: name !== 'amber' });
    }
  });

  it("declines the palette's olive, and that is a decision rather than an omission", () => {
    // scrub[0] (#6B8A4A) is the one colour in the housing's brief the chosen
    // set does not use: it sits about 30 RGB from `dim` and photographs as mud
    // at 32px on limestone ground. An earlier set DID draw `support` in it --
    // pinned so that re-adding it is a deliberate act with a rendered check
    // behind it, not a reflex when somebody notices a palette entry going
    // unused.
    expect(raw.ramps.scrub.colors[0]).toBe('#6B8A4A');
    const css = cursorRules(resolved);
    expect(css).not.toContain(encodeSvgUri(raw.ramps.scrub.colors[0].toLowerCase()));
    expect(Object.values(resolved.reserved.ui.colors)).not.toContain(raw.ramps.scrub.colors[0]);
  });

  it("routes the housing's bad and warn through the colour-vision path (Q9)", () => {
    // They are team.hostile and team.neutral, and before S3e they were
    // hard-wired to the default hex whatever the player's setting.
    for (const variant of Object.keys(raw.reserved.team.variants)) {
      const ui = deriveUiBand(raw, variant).reserved.ui.colors;
      expect({ variant, bad: ui.bad, warn: ui.warn }).toEqual({
        variant,
        bad: raw.reserved.team.variants[variant].hostile,
        warn: raw.reserved.team.variants[variant].neutral,
      });
      // ...and nothing else in the band moves with the setting.
      const others = (band: Record<string, string>): Record<string, string> =>
        Object.fromEntries(Object.entries(band).filter(([k]) => k !== 'bad' && k !== 'warn'));
      expect({ variant, rest: others(ui) }).toEqual({ variant, rest: others(resolved.reserved.ui.colors) });
    }
  });
});

describe('badged rules', () => {
  const css = cursorRules(deriveUiBand(raw));

  it('emits a rule for every reachable name-badge key', () => {
    for (const key of ['demolish-soft', 'demolish-armour', 'charge-soft', 'garrison-soft',
                       'move-drone', 'attack-gunship']) {
      expect(css).toContain(`canvas[data-cursor='${key}']`);
    }
  });

  it('emits no rule for a badge that bucket can never earn', () => {
    // A gunship cannot garrison and a drone cannot demolish. A rule for it
    // would be dead bytes shipped on every page load.
    expect(css).not.toContain("data-cursor='garrison-gunship'");
    expect(css).not.toContain("data-cursor='demolish-drone'");
  });

  it('emits no rule at all for mount or dismount, and no badged smoke -- Important 1', () => {
    // The hover ticker feeds only resolvePointer, which never emits a mount
    // or dismount intent -- those come solely from the keyboard path
    // (resolveKeyVerb), whose result never reaches the cursor. A rule for
    // them, bare or badged, would be dead bytes shipped on every page load.
    // `smoke` now reaches the cursor through the armedSmoke hint (Q2) and
    // earns its bare sight; nothing ever badges it.
    for (const key of ['mount', 'dismount']) {
      expect(css).not.toContain(`data-cursor='${key}'`);
      expect(css).not.toContain(`data-cursor='${key}-`);
    }
    expect(css).toContain("canvas[data-cursor='smoke']");
    expect(css).not.toContain("data-cursor='smoke-");
    for (const key of ['load', 'unload', 'halt']) expect(css).not.toContain(`data-cursor='${key}`);
  });

  it('keeps drawable bodies for the five unwired states without shipping a byte of them', () => {
    // mount and dismount keep their housing drawings; load, unload and halt
    // are approved sights with no hover path to reach them (Q2: halt is
    // instant, and load/unload come from the keyboard). Both halves are
    // pinned: they really draw (a bare housing, or a bare aim, would pass a
    // "returns a string" check), and they really ship nothing.
    const p = deriveUiBand(raw);
    for (const name of ['mount', 'dismount'] as const) {
      const markup = UNWIRED_BODIES[name](p);
      expect({ name, housing: markup.includes('M3,6L6,3H10V6H6V10H3Z') }).toEqual({ name, housing: true });
      // ...and something beyond the housing: each carries a second <path>.
      expect({ name, paths: markup.split('<path').length - 1 }).toEqual({ name, paths: 2 });
      expect(css).not.toContain(encodeSvgUri(markup));
    }
    for (const name of ['load', 'unload', 'halt'] as const) {
      const markup = UNWIRED_BODIES[name](p);
      const paint = {
        aim: hexOf(SIGHT_KEYS.aim),
        main: hexOf(ORDER_SIGHT[name].main),
        accent: hexOf(ORDER_SIGHT[name].accent),
        hot: hexOf(SIGHT_KEYS.hot),
      };
      expect({ name, drawn: markup.includes(sightFrame(name, 0, paint)) }).toEqual({ name, drawn: true });
      expect({ name, viewBox: markup.includes('viewBox="0 0 24 24"') }).toEqual({ name, viewBox: true });
      expect(css).not.toContain(encodeSvgUri(markup));
    }
    expect(Object.keys(UNWIRED_BODIES).sort()).toEqual(['dismount', 'halt', 'load', 'mount', 'unload']);
  });

  it('emits no bare rule for charge -- Minor 2', () => {
    // yahalom_squad is the only unit with canTunnelCharge, so a charging
    // group is always uniformly `soft` and the bare `charge` key can never
    // compose -- only `charge-soft` is reachable.
    expect(css).not.toContain("data-cursor='charge']");
    expect(css).toContain("data-cursor='charge-soft']");
  });

  it('leaves the target-describing states, the armed calls and armed smoke unbadged', () => {
    for (const key of ['blocked', 'costly', 'protected', 'sweep', 'strike', 'smoke']) {
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

/** The decoded SVG for one key's frame-0 rule in the DEFAULT sheet. */
function artOf(css: string, key: string): string {
  const line = defaultLines(css).find(
    (l) => l.includes(`data-cursor='${key}']`) && !l.includes('data-cursor-frame')
  );
  if (!line) throw new Error(`no rule found for ${key}`);
  const m = line.match(/url\("data:image\/svg\+xml,([^"]+)"\)/);
  if (!m) throw new Error(`no data URI in the rule for ${key}`);
  return decodeSvgUri(m[1]);
}

/** The fill of the last shape in a housing badge -- the badge closes the
 *  markup inside its own `<g>`. */
const HOUSING_BADGE_FILL = /<path[^>]*fill="(#[0-9a-f]{6})"[^>]*\/><\/g><\/svg>$/;

/** The housing's one integration decision, made by the project lead: the
 *  role badge lands exactly on the bottom-right bracket, so a badged key
 *  OMITS that bracket and the badge becomes the fourth corner plate. Q1 keeps
 *  the housing for garrison, demolish, charge, blocked, costly and protected
 *  -- and with it this rule. Only the badge's DRAWING changed: it is the G1
 *  sheet's APP-6 role mark now (`symbolBody`), placed on the same plate. */
describe('the badge is the housing\'s fourth plate', () => {
  const css = cursorRules(deriveUiBand(raw));

  // bracketAt('br', {inset:3, arm:7, thickness:3, chamfer:3}) -- the exact
  // subpath the generator emits for the bottom-right corner at the default
  // housing shape, which is the shape every badged verb uses. Spelled out
  // rather than imported so this test would still fail if `bracketAt` itself
  // started emitting something different for that corner.
  const BR = 'M29,26L26,29H22V26H26V22H29Z';
  // `protected` is the one state drawn on a heavier housing (arm 8, thickness
  // 4, chamfer 4), so its own bottom-right plate is a different subpath. It
  // is unbadged, so it can never lose it.
  const BR_HEAVY = 'M29,25L25,29H21V25H25V21H29Z';

  it('draws that bracket on every BARE housing key and on none of the badged ones', () => {
    for (const key of ['garrison', 'demolish', 'blocked', 'costly']) {
      expect({ key, hasBr: artOf(css, key).includes(BR) }).toEqual({ key, hasBr: true });
    }
    expect({ key: 'protected', hasBr: artOf(css, 'protected').includes(BR_HEAVY) })
      .toEqual({ key: 'protected', hasBr: true });
    const badged = [...new Set(
      [...css.matchAll(/canvas\[data-cursor='((?:garrison|demolish|charge)-[a-z]+)'\]/g)].map((m) => m[1])
    )];
    expect(badged.length).toBe(5); // garrison x2, demolish x2, charge x1
    for (const key of badged) {
      expect({ key, hasBr: artOf(css, key).includes(BR) }).toEqual({ key, hasBr: false });
    }
  });

  it('draws the APP-6 role mark on the vacated plate, scaled from the 24-box onto BADGE_CX/CY/R', () => {
    // BADGE_CX/CY 25.5, BADGE_R 4.5: the 24-box lands on 21..30 at scale
    // 9/24 = 0.375, centred on the plate the omitted bracket spanned (22-29).
    const c = paletteColors(resolved);
    for (const [key, bucket, colour] of [
      ['garrison-soft', 'soft', c.info],
      ['garrison-sniper', 'sniper', c.info],
      ['charge-soft', 'soft', c.bad],
      ['demolish-armour', 'armour', c.hot],
    ] as const) {
      const expected =
        '<g transform="translate(21 21) scale(0.375)">' +
        symbolBody(bucket).replaceAll('currentColor', colour.toLowerCase()) +
        '</g>';
      expect({ key, badge: artOf(css, key).includes(expected) }).toEqual({ key, badge: true });
    }
    expect(21 + 12 * 0.375).toBe(25.5);
  });

  it('gives the badge the housing\'s own colour, so it reads as a plate and not a sticker', () => {
    const c = paletteColors(deriveUiBand(raw));
    const expected: Record<string, string> = {
      'garrison-soft': c.info,
      'charge-soft': c.bad,
    };
    for (const [key, colour] of Object.entries(expected)) {
      const badge = artOf(css, key).match(HOUSING_BADGE_FILL);
      expect({ key, badge: badge?.[1] }).toEqual({ key, badge: colour.toLowerCase() });
    }
  });
});

/** Every `<path .../>` in a markup string, in order. */
const pathsOf = (markup: string): string[] => [...markup.matchAll(/<path [^>]*\/>/g)].map((m) => m[0]);

/** The same path with its paint stripped, so a halo and the ink it outlines
 *  compare equal on geometry and opacity alone. */
const geometryOf = (path: string): string =>
  path
    .replace(/ fill="[^"]*"/, '')
    .replace(/ stroke="[^"]*"/, '')
    .replace(/ stroke-width="[^"]*"/, '')
    .replace(/ stroke-linejoin="[^"]*"/, '');

describe('the stadia sights -- the approved G1 r5 order cursors', () => {
  const css = cursorRules(resolved);
  const SIGHTS = Object.entries(SIGHT_OF) as [keyof typeof SIGHT_OF, SightOrderId][];

  /** Every key the default sheet draws for a sight name: bare, plus badges. */
  const keysOf = (name: string): string[] => [
    name,
    ...((BADGED_VERBS as Partial<Record<string, RoleBucket[]>>)[name] ?? []).map((b) => `${name}-${b}`),
  ];

  /** The default sheet's image for key at frame, as the cascade draws it. */
  const drawn = (key: string, frame: number): string => decodeSvgUri(markupOf(frameLineFor(css, key, frame)));

  it('wires exactly move, attack, sweep, strike and smoke (Q2)', () => {
    expect(SIGHTS.map(([n]) => n).sort()).toEqual(['attack', 'move', 'smoke', 'strike', 'sweep']);
  });

  it('draws every frame of every wired sight on the 24-box at 32 px, with the hotspot at 16 16', () => {
    // 12 units of 24 x 32/24 = 16: the aim's hotspot (HOTSPOT, 12 12) is the
    // same canvas pixel the housing's centre is.
    for (const [name] of SIGHTS) {
      for (const key of keysOf(name)) {
        for (let frame = 0; frame < (ANIMATED_CURSORS[name]?.frames ?? 1); frame++) {
          const line = frameLineFor(css, key, frame);
          const svg = decodeSvgUri(markupOf(line).slice('data:image/svg+xml,'.length));
          expect({ key, frame, head: svg.slice(0, svg.indexOf('>') + 1) }).toEqual({
            key,
            frame,
            head: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24">',
          });
          expect(line).toMatch(/\)\s+16\s+16\s*,\s*auto/);
        }
      }
    }
  });

  it('draws each frame through sightFrame itself, at that frame\'s phase', () => {
    for (const [name, id] of SIGHTS) {
      const spec = ORDER_SIGHT[id];
      const paint = { aim: hexOf(SIGHT_KEYS.aim), main: hexOf(spec.main), accent: hexOf(spec.accent), hot: hexOf(SIGHT_KEYS.hot) };
      for (let frame = 0; frame < spec.phases.length; frame++) {
        expect({ name, frame, ok: drawn(name, frame).includes(sightFrame(id, frame, paint)) }).toEqual({
          name,
          frame,
          ok: true,
        });
      }
    }
  });

  it('draws the dark halo first: every ink path is preceded by its own shadow.0 outline, in equal counts', () => {
    // A CSS cursor takes no `filter`, so r4's drop-shadow halo has to be
    // geometry: each ink path re-emitted beneath all of the ink, filled and
    // stroked in shadow.0, keeping its own opacity.
    const halo = hexOf(SIGHT_KEYS.halo);
    for (const [name] of SIGHTS) {
      for (const key of keysOf(name)) {
        for (let frame = 0; frame < (ANIMATED_CURSORS[name]?.frames ?? 1); frame++) {
          const paths = pathsOf(drawn(key, frame));
          const isHalo = (p: string): boolean => p.includes(`fill="${halo}" stroke="${halo}"`);
          const haloPaths = paths.filter(isHalo);
          const inkPaths = paths.filter((p) => !isHalo(p));
          expect({ key, frame, halo: haloPaths.length }).toEqual({ key, frame, halo: inkPaths.length });
          expect(inkPaths.length).toBeGreaterThan(0);
          // halo first, all of it, and path for path the same geometry
          expect({ key, frame, order: paths.map(isHalo) }).toEqual({
            key,
            frame,
            order: [...haloPaths.map(() => true), ...inkPaths.map(() => false)],
          });
          expect(haloPaths.map(geometryOf)).toEqual(inkPaths.map(geometryOf));
          for (const h of haloPaths) expect(h).toContain('stroke-linejoin="round"');
        }
      }
    }
  });

  it('keeps the aim in gunmetal.0 and the family main colour on every frame', () => {
    const aim = hexOf(SIGHT_KEYS.aim);
    expect(aim).toBe(raw.ramps.gunmetal.colors[0].toLowerCase());
    for (const [name, id] of SIGHTS) {
      const main = hexOf(ORDER_SIGHT[id].main);
      for (let frame = 0; frame < ORDER_SIGHT[id].phases.length; frame++) {
        const art = drawn(name, frame);
        expect({ name, frame, aim: art.includes(`fill="${aim}"`), main: art.includes(`fill="${main}"`) }).toEqual({
          name,
          frame,
          aim: true,
          main: true,
        });
      }
    }
    // attack and strike are the offensive family: team.hostile_text, the
    // readable red, resolved from the real palette.
    expect(hexOf(ORDER_SIGHT.attackMove.main)).toBe(raw.reserved.team.colors.hostile_text.toLowerCase());
  });

  it('badges move and attack with the APP-6 role mark in aim steel, in the free bottom-right quadrant (Q8)', () => {
    const aim = hexOf(SIGHT_KEYS.aim);
    const badge = (bucket: RoleBucket): string =>
      '<g transform="translate(15 15) scale(0.375)">' + symbolBody(bucket).replaceAll('currentColor', aim) + '</g>';
    expect(drawn('move-armour', 0)).toContain(badge('armour'));
    for (const name of ['move', 'attack'] as const) {
      for (const bucket of BADGED_VERBS[name] ?? []) {
        for (let frame = 0; frame < (ANIMATED_CURSORS[name]?.frames ?? 1); frame++) {
          expect({ name, bucket, frame, ok: drawn(`${name}-${bucket}`, frame).includes(badge(bucket)) }).toEqual({
            name,
            bucket,
            frame,
            ok: true,
          });
        }
      }
    }
    // ...and the unbadged key carries none.
    expect(drawn('move', 0)).not.toContain('translate(15 15)');
  });
});

/** Same idea as selectorFor above, but for one animation frame of `key` in
 *  the DEFAULT sheet -- and it models the CASCADE, not the rule list, because
 *  what a test about animation should assert is what the browser DRAWS at
 *  frame N, not which rules happen to exist.
 *
 *  Frame 0 is deliberately NOT a `[data-cursor-frame='0']` selector -- it is
 *  the pre-existing bare/badged rule with no frame attribute at all (see the
 *  "never emits an explicit frame-0 rule" test below). And a frame >= 1 whose
 *  markup would equal frame 0's emits no rule either (cursorRules elides it),
 *  so it too resolves to that same lower-specificity rule -- exactly as the
 *  browser resolves it when the driver writes that index. The colour-vision
 *  overrides have their own resolver, `winnerFor`, below. */
function frameLineFor(css: string, key: string, frame: number): string {
  const lines = defaultLines(css);
  const bare = lines.find(
    (l) => l.includes(`data-cursor='${key}']`) && !l.includes('data-cursor-frame')
  );
  const line =
    frame === 0
      ? bare
      : (lines.find((l) => l.includes(`data-cursor='${key}'][data-cursor-frame='${frame}']`)) ??
        bare);
  if (!line) throw new Error(`no rule found for ${key} frame ${frame}`);
  return line;
}

function selectorOf(line: string): string {
  return line.slice(0, line.indexOf('{')).trim();
}

/** The encoded SVG data URI out of one CSS rule line, so a test can compare
 *  what two frames actually DRAW rather than only that their selectors
 *  differ -- the selectors differ by construction (one has an extra
 *  attribute), so that alone would never catch a copy-paste bug where every
 *  frame drew frame 0's body. */
function markupOf(line: string): string {
  const match = line.match(/url\("(data:image\/svg\+xml,[^"]+)"\)/);
  if (!match) throw new Error(`no data URI found in: ${line}`);
  return match[1];
}

// Seven CursorName values animate: the five wired sights (move, attack,
// sweep, strike, smoke -- G1 r4/r5) and the housing's charge and demolish --
// see ANIMATED_CURSORS's own comment in cursor.ts, and the plugin's top
// comment. Every non-frame property of those keys' rules (hotspot, the
// `cursor:` property, palette colours, encoding, DOM matching, reachability)
// is already covered, unmodified, by the describes above -- this covers only
// what the frame slice adds on top.
describe('animated cursor frames', () => {
  const css = cursorRules(deriveUiBand(raw));

  it('animates exactly the five wired sights plus charge and demolish, and nothing else', () => {
    // A silent eighth entry (or the loss of one) would otherwise only
    // surface as a visual difference nobody happened to look for.
    expect(Object.keys(ANIMATED_CURSORS).sort()).toEqual(
      ['attack', 'charge', 'demolish', 'move', 'smoke', 'strike', 'sweep']
    );
  });

  /** Every frame 1..N-1 of `key` either emits its own rule, or draws frame
   *  0's markup and is deliberately elided -- and nothing outside that range
   *  is ever emitted.
   *
   *  Stated as "emits a rule IFF the markup differs from frame 0" rather than
   *  a flat "a rule for every frame", because shipping a byte-identical
   *  second copy of frame 0 was once 16.5% of the whole injected sheet.
   *  Written against CONTENT so it still fails on the thing that matters: a
   *  frame that should have moved and did not is caught by assertNoStaticTick
   *  below, and a frame silently dropped by index is caught here. */
  function assertFrameRules(key: string, frames: number): void {
    const direct = cursorImages(resolved, 'default').get(key);
    if (!direct) throw new Error(`no images for ${key}`);
    for (let frame = 1; frame < frames; frame++) {
      const selector = `canvas[data-cursor='${key}'][data-cursor-frame='${frame}']`;
      const redundant = direct[frame] === direct[0];
      expect({ key, frame, emitted: defaultLines(css).some((l) => l.startsWith(selector)) }).toEqual({
        key,
        frame,
        emitted: !redundant,
      });
    }
    // Neither end of the range gets an explicit rule: frame 0 is the existing
    // bare/badged rule (see the frame-0 test below), and nothing beyond
    // frames-1 was ever authored.
    expect(css).not.toContain(`canvas[data-cursor='${key}'][data-cursor-frame='0']`);
    expect(css).not.toContain(`canvas[data-cursor='${key}'][data-cursor-frame='${frames}']`);
  }

  it('emits a frame rule for every animated key exactly when it differs from frame 0', () => {
    const keys = [...cursorImages(resolved, 'default').keys()].filter(
      (k) => ANIMATED_CURSORS[k.split('-')[0] as keyof typeof ANIMATED_CURSORS]
    );
    // move x8, attack x8, sweep, strike, smoke, demolish x3, charge-soft
    expect(keys.length).toBe(8 + 8 + 3 + 3 + 1);
    for (const key of keys) {
      const anim = ANIMATED_CURSORS[key.split('-')[0] as keyof typeof ANIMATED_CURSORS];
      if (!anim) throw new Error(key);
      assertFrameRules(key, anim.frames);
    }
  });

  it('elides nothing of the housing sweeps and leaves no duplicate image anywhere', () => {
    for (const key of ['demolish', 'demolish-soft', 'demolish-armour']) {
      for (let frame = 1; frame < (ANIMATED_CURSORS.demolish?.frames ?? 0); frame++) {
        expect({ key, frame, emitted: css.includes(`canvas[data-cursor='${key}'][data-cursor-frame='${frame}']`) })
          .toEqual({ key, frame, emitted: true });
      }
    }
    for (let frame = 1; frame < (ANIMATED_CURSORS.charge?.frames ?? 0); frame++) {
      expect(css).toContain(`canvas[data-cursor='charge-soft'][data-cursor-frame='${frame}']`);
    }
    // And the whole sheet -- default and colour-vision rules alike -- carries
    // no duplicate image at all: every rule draws something no other rule
    // draws.
    const images = css.split('\n').map((l) => markupOf(l));
    expect(new Set(images).size).toBe(images.length);
  });

  it('emits frames 1..N-1 for charge-soft, and no bare charge frame rule at all', () => {
    const frames = ANIMATED_CURSORS.charge?.frames ?? 0;
    for (let frame = 1; frame < frames; frame++) {
      expect(css).toContain(`canvas[data-cursor='charge-soft'][data-cursor-frame='${frame}']`);
    }
    expect(css).not.toContain(`canvas[data-cursor='charge-soft'][data-cursor-frame='0']`);
    expect(css).not.toContain(`canvas[data-cursor='charge-soft'][data-cursor-frame='${frames}']`);
    // charge draws no bare rule at all (Minor 2, same invariant as the
    // "badged rules" describe above) -- that stays true frame by frame too.
    expect(css).not.toContain(`data-cursor='charge'][data-cursor-frame`);
  });

  it('never emits an explicit frame-0 rule anywhere -- frame 0 always falls through to the existing bare/badged rule', () => {
    expect(css).not.toMatch(/\[data-cursor-frame='0'\]/);
  });

  it('touches no key outside the seven animated names and their badges', () => {
    // The complement of the tests above: every key that DOES receive a frame
    // rule belongs to one of the ANIMATED_CURSORS names -- proving blocked,
    // costly, protected and garrison never pick up a data-cursor-frame
    // selector, without enumerating them by hand.
    const frameKeys = new Set(
      [...css.matchAll(/canvas\[data-cursor='([^']+)'\]\[data-cursor-frame='\d+'\]/g)].map((m) => m[1])
    );
    expect(frameKeys.size).toBeGreaterThan(0);
    const animated = Object.keys(ANIMATED_CURSORS);
    for (const key of frameKeys) {
      const base = key.split('-')[0];
      expect({ key, animated: animated.includes(base) }).toEqual({ key, animated: true });
    }
    for (const still of ['blocked', 'costly', 'protected', 'garrison']) {
      expect([...frameKeys].some((k) => k.split('-')[0] === still)).toBe(false);
    }
  });

  it('gives every frame-specific rule the same centred hotspot as every other rule', () => {
    const frameLines = css.split('\n').filter((l) => l.includes('data-cursor-frame'));
    expect(frameLines.length).toBeGreaterThan(0);
    for (const line of frameLines) {
      expect(line).toMatch(new RegExp(`\\)\\s+${CENTER}\\s+${CENTER}\\s*,\\s*auto`));
    }
  });

  /** What would be a real defect is a timer tick that changes nothing on
   *  screen -- so the contract is that no two ADJACENT frames in the cycle
   *  (including the wrap from the last frame back to the first) are
   *  identical, so a future retune can't silently flatten a step. */
  function assertNoStaticTick(css: string, key: string, frames: number): void {
    const bodies = Array.from({ length: frames }, (_, frame) => markupOf(frameLineFor(css, key, frame)));
    for (let frame = 0; frame < frames; frame++) {
      const next = bodies[(frame + 1) % frames];
      expect({ key, frame, changes: bodies[frame] !== next }).toEqual({ key, frame, changes: true });
    }
  }

  it('changes what it draws on every tick of every animated cycle -- no adjacent-frame step (including the wrap) is a no-op', () => {
    for (const key of ['move', 'move-soft', 'attack', 'attack-armour', 'sweep', 'strike', 'smoke']) {
      const anim = ANIMATED_CURSORS[key.split('-')[0] as keyof typeof ANIMATED_CURSORS];
      if (!anim) throw new Error(key);
      assertNoStaticTick(css, key, anim.frames);
    }
    assertNoStaticTick(css, 'charge-soft', ANIMATED_CURSORS.charge?.frames ?? 0);
    assertNoStaticTick(css, 'demolish', ANIMATED_CURSORS.demolish?.frames ?? 0);
    assertNoStaticTick(css, 'demolish-armour', ANIMATED_CURSORS.demolish?.frames ?? 0);
  });

  it("pins demolish's still core under its moving beacon", () => {
    // demolish holds a core dead still and rotates a bone-white beacon around
    // the plates. Read off the emitted markup rather than off the tables, so
    // re-tuning a table without re-reading this comment goes red.
    const CORE = 'M11,21V11H16V16H21V21Z';
    const at = (frame: number, key = 'demolish') =>
      decodeSvgUri(markupOf(frameLineFor(css, key, frame)));

    // 1. demolish's core is byte-identical on all four frames.
    for (let frame = 0; frame < (ANIMATED_CURSORS.demolish?.frames ?? 0); frame++) {
      expect({ frame, still: at(frame).includes(CORE) }).toEqual({ frame, still: true });
    }
    // 2. ...and the beacon really does move: a different corner is drawn in
    //    `ink` on each of the four, clockwise.
    const c = paletteColors(deriveUiBand(raw));
    const beacons = Array.from({ length: 4 }, (_, frame) => {
      const lit = at(frame).match(new RegExp(`<path fill="${c.ink.toLowerCase()}" d="([^"]+)"`));
      return lit?.[1];
    });
    expect(beacons.filter((b) => typeof b === 'string').length).toBe(4);
    expect(new Set(beacons).size).toBe(4);
    // 3. no sight carries the core.
    for (let frame = 0; frame < (ANIMATED_CURSORS.attack?.frames ?? 0); frame++) {
      expect({ frame, core: at(frame, 'attack').includes(CORE) }).toEqual({ frame, core: false });
    }
  });

  it("lights the badge on the one frame the beacon reaches its plate, and only on a badged key", () => {
    // The badge IS the bottom-right plate on a badged key, so the sweep has to
    // include it. BEACON_SWEEP is clockwise (tl, tr, br, bl), so `br` is
    // frame 2.
    const c = paletteColors(deriveUiBand(raw));
    const ink = c.ink.toLowerCase();
    const badgeColourAt = (key: string, frame: number): string | undefined =>
      decodeSvgUri(markupOf(frameLineFor(css, key, frame))).match(HOUSING_BADGE_FILL)?.[1];
    for (const key of ['demolish-soft', 'demolish-armour']) {
      const litFrames = [0, 1, 2, 3].filter((f) => badgeColourAt(key, f) === ink);
      expect({ key, litFrames }).toEqual({ key, litFrames: [2] });
      // and on the other three it is the same `hot` the rest of the plates are
      expect({ key, rest: badgeColourAt(key, 0) }).toEqual({ key, rest: c.hot.toLowerCase() });
    }
    // The bare key has a real bracket there instead, so nothing about it is
    // a badge -- its frame-2 ink subpath is the bracket's own path.
    expect(decodeSvgUri(markupOf(frameLineFor(css, 'demolish', 2))))
      .toContain(`<path fill="${ink}" d="M29,26L26,29H22V26H26V22H29Z"/>`);
  });

  it('matches a real canvas once main.ts\'s own pairing writes both data-cursor and a mid-cycle data-cursor-frame', () => {
    const dom = new JSDOM('<div id="stage"><canvas></canvas></div>');
    const canvas = dom.window.document.querySelector('canvas')!;
    canvas.dataset.cursor = 'attack';
    canvas.dataset.cursorFrame = '1';
    const line = frameLineFor(css, 'attack', 1);
    expect(line).toContain("[data-cursor-frame='1']");
    expect(canvas.matches(selectorOf(line))).toBe(true);
  });

  it('the frame-0 (bare) rule matches regardless of what data-cursor-frame holds -- the fail-safe the plugin comment promises', () => {
    // ruleFor's selector names only data-cursor, so it matches whether
    // data-cursor-frame is absent or holds any value at all -- CSS attribute
    // selectors are independent of attributes they do not name. That is what
    // makes an absent or not-yet-written frame attribute fall back to this
    // rule instead of to the OS arrow. Checked against a real canvas node
    // rather than trusted from selector syntax alone.
    const dom = new JSDOM('<div id="stage"><canvas></canvas></div>');
    const canvas = dom.window.document.querySelector('canvas')!;
    const baseSelector = selectorOf(frameLineFor(css, 'attack', 0));
    const frame1Selector = selectorOf(frameLineFor(css, 'attack', 1));

    canvas.dataset.cursor = 'attack'; // data-cursor-frame not written at all yet
    expect(canvas.matches(baseSelector)).toBe(true);
    expect(canvas.matches(frame1Selector)).toBe(false);

    canvas.dataset.cursorFrame = '1'; // now mid-cycle
    expect(canvas.matches(baseSelector)).toBe(true); // unaffected by the extra attribute
    expect(canvas.matches(frame1Selector)).toBe(true); // and the more specific rule engages too
  });

  it('draws the right art when data-cursor-frame is STALE from a different cursor', () => {
    // The failure the fail-safe exists to prevent, exercised as a sequence:
    // the pointer leaves one cursor mid-cycle and lands on another while
    // data-cursor-frame still holds the old index. In every case the art that
    // wins must be a CORRECT frame of the cursor now named.
    const dom = new JSDOM('<div id="stage"><canvas></canvas></div>');
    const canvas = dom.window.document.querySelector('canvas')!;
    const winner = (key: string): string => {
      // Later rules win at equal specificity and the two-attribute selector
      // outranks the one-attribute rule, so the last matching line is what
      // the browser draws (default sheet only: data-cvd is not set here).
      const matching = defaultLines(css).filter((l) => canvas.matches(selectorOf(l)));
      expect({ key, matched: matching.length > 0 }).toEqual({ key, matched: true });
      return markupOf(matching[matching.length - 1]);
    };

    // 1. Stale index onto a NON-animated cursor. garrison emits no frame
    //    rules at all, so only its own rule can match -- frame 0 art, correct.
    canvas.dataset.cursor = 'garrison-soft';
    canvas.dataset.cursorFrame = '3'; // left over from an attack cycle
    expect(winner('garrison-soft')).toBe(markupOf(frameLineFor(css, 'garrison-soft', 0)));

    // 2. Stale index PAST the end of a shorter cycle. strike has six frames
    //    and sweep four; leaving strike at frame 5 for sweep matches no sweep
    //    frame rule, so sweep's frame 0 draws.
    canvas.dataset.cursor = 'sweep';
    canvas.dataset.cursorFrame = '5';
    expect(winner('sweep')).toBe(markupOf(frameLineFor(css, 'sweep', 0)));

    // 3. Stale index onto a DIFFERENT animated cursor that does emit that
    //    frame -- out of phase for one tick at most, never wrong art.
    canvas.dataset.cursor = 'demolish-soft';
    canvas.dataset.cursorFrame = '3';
    const drawn = winner('demolish-soft');
    expect(drawn).toBe(markupOf(frameLineFor(css, 'demolish-soft', 3)));
    expect(drawn).not.toBe(markupOf(frameLineFor(css, 'attack-soft', 3)));
  });
});

/** One selector out of the sheet, parsed into what it asks of the page. */
interface ParsedSelector {
  cvd: string | null;
  key: string;
  frame: number | null;
  /** Class-level specificity: the canvas type selector is common to all. */
  spec: number;
  order: number;
  url: string;
}

/** Parses the emitted CSS into (selector, url) pairs. Every selector must be
 *  one of the four shapes the plugin is allowed to emit -- anything else
 *  throws, so a new shape cannot slip past the resolver below unmodelled. */
function parseSheet(css: string): ParsedSelector[] {
  const out: ParsedSelector[] = [];
  css.split('\n').forEach((line, order) => {
    const url = markupOf(line);
    for (const sel of selectorOf(line).split(',').map((x) => x.trim())) {
      const m = sel.match(
        /^(?::root\[data-cvd='([a-z]+)'\] )?canvas\[data-cursor='([^']+)'\](?:\[data-cursor-frame='(\d+)'\])?$/
      );
      if (!m) throw new Error(`unmodelled selector: ${sel}`);
      const cvd = m[1] ?? null;
      const frame = m[3] === undefined ? null : Number(m[3]);
      // [data-cursor] 1; [data-cursor-frame] +1; :root + [data-cvd] +2.
      out.push({ cvd, key: m[2], frame, spec: 1 + (frame === null ? 0 : 1) + (cvd === null ? 0 : 2), order, url });
    }
  });
  return out;
}

/** The url the cascade picks for a canvas carrying `key` and `frame` under a
 *  root carrying `data-cvd=cvd`: highest specificity, then latest in source. */
function winnerFor(sheet: ParsedSelector[], cvd: string, key: string, frame: number): string | undefined {
  let best: ParsedSelector | undefined;
  for (const s of sheet) {
    if (s.key !== key) continue;
    if (s.cvd !== null && s.cvd !== cvd) continue;
    if (s.frame !== null && s.frame !== frame) continue;
    if (!best || s.spec > best.spec || (s.spec === best.spec && s.order > best.order)) best = s;
  }
  return best?.url;
}

describe('colour-vision variants -- team.* follows the setting (Q9)', () => {
  const css = cursorRules(resolved);
  const sheet = parseSheet(css);
  const variants = Object.keys(raw.reserved.team.variants);

  it('resolves every team.* key exactly as @lions/data does, for every variant', () => {
    expect(variants.length).toBeGreaterThan(0);
    for (const variant of ['default', ...variants]) {
      const lions = variantAwareResolver(variant as ColorVisionVariant);
      for (const name of Object.keys(raw.reserved.team.colors)) {
        const key = `team.${name}`;
        expect({ variant, key, hex: resolveKey(raw, variant, key) }).toEqual({ variant, key, hex: lions(key) });
      }
      expect({ variant, three: ['kedem', 'hostile', 'neutral'].map((n) => resolveKey(raw, variant, `team.${n}`)) })
        .toEqual({ variant, three: paletteTeamColors(variant as ColorVisionVariant) });
    }
  });

  it('draws, under every variant, every key at every frame exactly as that variant would draw it', () => {
    // The specificity trap this exists for: a variant's frame-0 rule
    // (:root[data-cvd] canvas[data-cursor], 0,3,1) outranks the DEFAULT
    // frame-k rule (0,2,1), so a variant that overrode only frame 0 would
    // freeze the cursor on its first frame under that setting.
    const def = cursorImages(resolved, 'default');
    for (const variant of ['default', ...variants]) {
      const images = cursorImages(resolved, variant);
      expect({ variant, keys: [...images.keys()] }).toEqual({ variant, keys: [...def.keys()] });
      for (const [key, frames] of images) {
        frames.forEach((markup, frame) => {
          const want = `data:image/svg+xml,${encodeSvgUri(markup)}`;
          expect({ variant, key, frame, drawn: winnerFor(sheet, variant, key, frame) === want }).toEqual({
            variant,
            key,
            frame,
            drawn: true,
          });
        });
      }
    }
  });

  it('turns attack and strike to the variant readable red under deuteranopia, and leaves them alone under tritanopia', () => {
    const deut = hexOf('team.hostile_text', 'deuteranopia');
    expect(deut).toBe('#f2a15c');
    expect(hexOf('team.hostile_text', 'tritanopia')).toBe(hexOf('team.hostile_text'));
    const art = (variant: string, key: string, frame: number): string =>
      decodeSvgUri(winnerFor(sheet, variant, key, frame) ?? '');
    for (const key of ['attack', 'attack-soft', 'strike']) {
      expect({ key, deut: art('deuteranopia', key, 0).includes(`fill="${deut}"`) }).toEqual({ key, deut: true });
      expect(art('deuteranopia', key, 0)).not.toContain(`fill="${hexOf('team.hostile_text')}"`);
    }
    // No tritanopia rule names attack or strike at all: their markup is
    // identical to the default's there, so the default rules already draw it.
    const tritKeys = sheet.filter((s) => s.cvd === 'tritanopia').map((s) => s.key.split('-')[0]);
    expect(tritKeys).not.toContain('attack');
    expect(tritKeys).not.toContain('strike');
    // tritanopia swaps only team.neutral, which the housing's warn draws.
    expect(new Set(tritKeys)).toEqual(new Set(['costly', 'charge']));
  });

  it('merges variants whose markup is byte-identical into one selector list', () => {
    // deuteranopia and protanopia share every team hex, so every rule that
    // names one names the other in the same selector list -- one image, not
    // two copies of it.
    const lines = css.split('\n').filter((l) => l.includes('data-cvd'));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const deut = line.includes(":root[data-cvd='deuteranopia']");
      const prot = line.includes(":root[data-cvd='protanopia']");
      expect({ line: selectorOf(line), deut, prot }).toEqual({ line: selectorOf(line), deut: prot, prot: deut });
    }
    // and no variant emits a rule that draws what the default already draws
    for (const s of sheet.filter((x) => x.cvd !== null)) {
      const same = sheet.some((d) => d.cvd === null && d.key === s.key && d.frame === s.frame && d.url === s.url);
      expect({ key: s.key, frame: s.frame, same }).toEqual({ key: s.key, frame: s.frame, same: false });
    }
  });

  it('emits nothing for a key none of whose frames change under any variant', () => {
    const variantKeys = new Set(sheet.filter((s) => s.cvd !== null).map((s) => s.key));
    for (const key of ['move', 'move-armour', 'sweep', 'smoke', 'blocked', 'garrison-soft', 'demolish']) {
      expect({ key, overridden: variantKeys.has(key) }).toEqual({ key, overridden: false });
    }
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
  /** Which verbs a unit type can actually produce, restricted to the ones
   *  BADGED_VERBS tracks. `move` and `attack` are universal; `garrison`,
   *  `demolish` and `charge` gate on the same ability flags
   *  unitTypeFromJson exposes -- canGarrison, canDemolish, canTunnelCharge.
   *  Deliberately does NOT push 'mount', 'dismount' or 'smoke' even though
   *  canEmbark, transportSlots > 0 and canSmoke are real roster flags: those
   *  three verbs are reachable from the data but not from the pointer feed
   *  the cursor uses (Important 1), so BADGED_VERBS has no entry for them
   *  and this derivation must not invent one either, or this "both
   *  directions" check would flag a mismatch against a table that is
   *  correct on purpose. */
  function verbsOf(type: ReturnType<typeof unitTypeFromJson>): (keyof typeof BADGED_VERBS)[] {
    const verbs: (keyof typeof BADGED_VERBS)[] = ['move', 'attack'];
    if (type.canGarrison) verbs.push('garrison');
    if (type.canDemolish) verbs.push('demolish');
    if (type.canTunnelCharge) verbs.push('charge');
    return verbs;
  }

  const derived = new Map<keyof typeof BADGED_VERBS, Set<RoleBucket>>();
  for (const type of unitTypes) {
    const bucket = roleBucket(type);
    for (const verb of verbsOf(type)) {
      if (!derived.has(verb)) derived.set(verb, new Set());
      derived.get(verb)!.add(bucket);
    }
  }

  it('matches BADGED_VERBS exactly, in both directions', () => {
    expect(unitTypes.length).toBeGreaterThan(0);
    const verbKeys = new Set<string>([...Object.keys(BADGED_VERBS), ...derived.keys()]);
    for (const verb of verbKeys) {
      const table = [...(BADGED_VERBS[verb as keyof typeof BADGED_VERBS] ?? [])].sort();
      const roster = [...(derived.get(verb as keyof typeof BADGED_VERBS) ?? [])].sort();
      expect({ verb, table }).toEqual({ verb, table: roster });
    }
  });

  it('has real mount/dismount/smoke capability that this table deliberately does not track', () => {
    // Provenance for Important 1: these three verbs ARE reachable from the
    // roster -- units really can embark, carry passengers, and smoke -- so
    // their absence from BADGED_VERBS is a wiring decision, not an accident
    // of "no unit happens to have it".
    expect(unitTypes.some((t) => t.canEmbark)).toBe(true);
    expect(unitTypes.some((t) => t.transportSlots > 0)).toBe(true);
    expect(unitTypes.some((t) => t.canSmoke)).toBe(true);
    expect(Object.keys(BADGED_VERBS)).not.toContain('mount');
    expect(Object.keys(BADGED_VERBS)).not.toContain('dismount');
    expect(Object.keys(BADGED_VERBS)).not.toContain('smoke');
  });
});

// Reachability-from-data (the describe above) and reachability-from-code are
// different questions. The describe above never asks what cursorFor and
// badgeFor actually COMPOSE -- and that is exactly where Critical 1
// (`protected-armour`, a key the composer produced with no rule) and
// Critical 2 (`move-gunship`, a key the plugin generated with no way to
// compose it) both lived, invisible to a roster-vs-table comparison because
// neither cursorFor nor badgeFor was in the loop.
//
// This drives the real resolvePointer -- the only feed the app's hover
// ticker has -- over the real roster (every single unit, every pair, so a
// mixed-bucket group can null out a badge) and a spread of real click
// situations (open ground, a costly building, a protected mosque with and
// without Alt, a flagged no-fire zone with no structure, an identified
// tunnel open and inside a flagged zone, plus an armed support call), each
// under all four hostile/blocked hint combinations. Not a re-derived table:
// every key comes from calling cursorFor and badgeFor themselves.
describe('the composer and the plugin agree on every key -- Important 2', () => {
  function fakeWorld(over: Partial<IntentWorld>): IntentWorld {
    return {
      structureAt: () => -1,
      tunnelAt: () => -1,
      isProtected: () => false,
      structureRoePenalty: () => 0,
      garrisonFree: () => 99,
      canDemolish: (id) => unitTypes[id].canDemolish,
      canGarrison: (id) => unitTypes[id].canGarrison,
      canTunnelCharge: (id) => unitTypes[id].canTunnelCharge,
      inFlaggedZone: () => false,
      ...over,
    };
  }

  const SCENARIOS: { world: IntentWorld; confirms: boolean[] }[] = [
    { world: fakeWorld({}), confirms: [false] },
    { world: fakeWorld({ structureAt: () => 0, structureRoePenalty: () => 5 }), confirms: [false, true] },
    {
      world: fakeWorld({ structureAt: () => 0, isProtected: () => true, structureRoePenalty: () => 30 }),
      confirms: [false, true],
    },
    { world: fakeWorld({ inFlaggedZone: () => true }), confirms: [false] },
    { world: fakeWorld({ tunnelAt: () => 0 }), confirms: [false] },
    { world: fakeWorld({ tunnelAt: () => 0, inFlaggedZone: () => true }), confirms: [false] },
  ];

  // Each hostile/blocked pair twice: once plain, once with the smoke order
  // armed (Q2's armedSmoke hint, which main.ts passes from `armedOrder`).
  // And each of those with the whole order pinned (GH-262's `pinned` hint,
  // which main.ts passes when every id of the order intent is pinned) -- the
  // one path to the `pinned` rule, so without it that rule reads as dead.
  const HINT_COMBOS: CursorHints[] = [false, true].flatMap((pinned) =>
    [false, true].flatMap((armedSmoke) => [
      { hostile: false, blocked: false, armedSmoke, pinned },
      { hostile: true, blocked: false, armedSmoke, pinned },
      { hostile: false, blocked: true, armedSmoke, pinned },
      { hostile: true, blocked: true, armedSmoke, pinned },
    ])
  );

  function allPairs(n: number): [number, number][] {
    const pairs: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) pairs.push([i, j]);
    }
    return pairs;
  }

  const selections: number[][] = [
    [],
    ...unitTypes.map((_, i) => [i]),
    ...allPairs(unitTypes.length),
  ];

  const badges: BadgeHints = { bucketOf: (id) => roleBucket(unitTypes[id]) };

  /** Every key the real cursorFor + badgeFor can produce, over the scenario
   *  matrix above plus the armed-support call (the one Resolution shape
   *  the scenario loop can't reach, since ctx.armed is null there). */
  function composedKeys(): Set<string> {
    const keys = new Set<string>();
    for (const { world, confirms } of SCENARIOS) {
      for (const confirm of confirms) {
        for (const ids of selections) {
          const res = resolvePointer(world, { ids, x: 5, y: 5, append: false, armed: null, confirm });
          for (const hints of HINT_COMBOS) {
            const name = cursorFor(res, hints);
            keys.add(cursorKey(name, badgeFor(res, hints, badges, name)));
          }
        }
      }
    }
    const openGround = SCENARIOS[0].world;
    for (const armed of ['strike', 'sweep'] as const) {
      const res = resolvePointer(openGround, { ids: [], x: 5, y: 5, append: false, armed, confirm: false });
      for (const hints of HINT_COMBOS) {
        const name = cursorFor(res, hints);
        keys.add(cursorKey(name, badgeFor(res, hints, badges, name)));
      }
    }
    return keys;
  }

  const css = cursorRules(deriveUiBand(raw));
  const generated = new Set(
    [...css.matchAll(/canvas\[data-cursor='([^']+)'\]/g)].map((m) => m[1])
  );
  const produced = composedKeys();
  // 'default' is the one name that deliberately has no rule at all (the OS
  // arrow) -- exclude it from the "must have a rule" side, the same way
  // cursorRules itself never emits one for it.
  const producedWithRules = new Set([...produced].filter((k) => k !== 'default'));

  it('emits a rule for every key the real cursorFor/badgeFor can compose', () => {
    // Reddens on Critical 1: 'protected-armour', 'protected-soft' and
    // friends used to be produced here with no matching rule.
    const missing = [...producedWithRules].filter((k) => !generated.has(k));
    expect(missing).toEqual([]);
  });

  it('generates no rule the real cursorFor/badgeFor can never compose', () => {
    // Reddens on Critical 2 (every move-<bucket> rule was generated but
    // unreachable) and would redden on Important 1 if a mount/dismount
    // rule ever came back without resolveKeyVerb being wired into the
    // ticker.
    const dead = [...generated].filter((k) => !producedWithRules.has(k));
    expect(dead).toEqual([]);
  });

  it('actually produces move and attack badges for every bucket -- the coverage this milestone exists for', () => {
    // Guards against a vacuously-passing set-equality check (an empty
    // `produced` set trivially satisfies both directions above).
    const moveAndAttackBadges = [...producedWithRules].filter(
      (k) => k.startsWith('move-') || k.startsWith('attack-')
    );
    expect(moveAndAttackBadges.length).toBeGreaterThanOrEqual(14); // 7 buckets x {move, attack}
  });
});

// GH-262 Task 6: the pinned cursor is a housing state -- the standard four
// brackets in `hot` (vfx.fire), with the G-PIN mark A ("pressed flat") inside,
// placed where `costly`'s payload sits and clear of the 16 16 hotspot.
describe('the pinned cursor', () => {
  const css = cursorRules(deriveUiBand(raw));
  const c = paletteColors(resolved);
  const BR = 'M29,26L26,29H22V26H26V22H29Z';

  it('has a rule of its own, bare, at the housing hotspot', () => {
    const line = defaultLines(css).find((l) => l.includes("canvas[data-cursor='pinned']"));
    expect(line).toBeDefined();
    expect(line).toMatch(new RegExp(`\\)\\s+${CENTER}\\s+${CENTER}\\s*,\\s*auto`));
    expect(css).not.toContain("data-cursor='pinned-");
    expect(css).not.toContain("data-cursor='pinned'][data-cursor-frame");
  });

  it("draws the pinned mark's own path, baked to hot, inside the full housing in hot", () => {
    const art = artOf(css, 'pinned');
    const mark = symbolBody('pinned').replaceAll('currentColor', c.hot.toLowerCase());
    expect(art).toContain(mark);
    expect(art).toContain(BR);
    expect(art).toContain(`<path fill="${c.hot.toLowerCase()}" d="M3,6L6,3`);
  });

  it("scales the 24-box mark onto costly's payload span, centred on the hotspot", () => {
    // costly's triangle spans x 7..25; the mark's 24-box lands on 7..25 at
    // 0.75, so the box centre (12, 12) -- empty between the bar and the
    // chevron -- sits on CENTER, and the hotspot pixel is never painted.
    expect(artOf(css, 'pinned')).toContain('<g transform="translate(7 7) scale(0.75)">');
  });
});
