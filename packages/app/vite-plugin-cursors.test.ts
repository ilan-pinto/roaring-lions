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
import { ANIMATED_CURSORS, badgeFor, cursorFor, cursorKey, type BadgeHints, type CursorHints } from './src/input/cursor';
import { resolvePointer, type IntentWorld } from './src/input/intents';
import { roleBucket, type RoleBucket } from './src/ui/role';
import {
  BADGED_VERBS,
  CENTER,
  SIZE,
  UNWIRED_BODIES,
  cursorRules,
  deriveUiBand,
  paletteColors,
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

// Eight invented colours, one per drawn value, all distinct so a test can tell
// which one a body used. Deliberately NOT the real palette's values -- the
// point of this fixture is that cursorRules is a pure function of what it is
// handed, and the real translation is covered separately by the deriveUiBand
// describe below.
const PALETTE = {
  ramps: { limestone: { colors: ['#EEE', '#DDD', '#CCC', '#BBB', '#AAA', '#999', '#888'] } },
  reserved: {
    ui: {
      colors: {
        ink: '#111111',
        dim: '#222222',
        bad: '#C0392B',
        warn: '#D4AC0D',
        hot: '#E67E22',
        amber: '#B7950B',
        info: '#5DADE2',
        live: '#7DCEA0',
      },
    },
  },
};

describe('cursorRules', () => {
  const css = cursorRules(PALETTE);

  it('draws on the 32-unit grid every path literal in the plugin assumes', () => {
    // Every payload path in vite-plugin-cursors.ts ("M11,21V11H16V16H21V21Z"
    // and its dozen siblings) is authored against this canvas, and bracketAt's
    // mirror arithmetic subtracts from it. Changing SIZE alone would leave the
    // brackets correct and every payload silently off-centre -- art that still
    // renders, still passes every other test here, and is wrong. Pinned so
    // that change has to be deliberate.
    expect(SIZE).toBe(32);
    expect(CENTER).toBe(16);
  });

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
      reserved: {
        ui: { colors: { ...PALETTE.reserved.ui.colors, bad: '#00FF00' } },
      },
    });
    expect(other).not.toBe(css);
  });

  it('draws with seven of the eight declared colours, and invents none', () => {
    // The chosen set widened paletteColors from four values to eight. A body
    // that silently fell back to a colour it already had would still render
    // and would still pass every shape test here -- this is what catches it.
    // Asserted as a set equality in both directions, so an invented colour
    // fails just as loudly as a missing one.
    //
    // SEVEN, not eight, and the gap is worth knowing: `amber` is used by
    // `mount` and `dismount` alone, and those two earn no rule (the hover
    // ticker never emits their intent -- see the Important 1 test above). So
    // the eighth colour is derived, drawn by a real body, and shipped by
    // nothing. It is spelled out here rather than quietly excluded, because
    // "a declared colour that reaches no rule" is otherwise indistinguishable
    // from a body that forgot to use the colour it was given.
    const used = new Set(
      [...css.matchAll(/%23([0-9a-f]{6})/g)].map((m) => `#${m[1]}`.toUpperCase())
    );
    const { amber, ...shipped } = PALETTE.reserved.ui.colors;
    expect([...used].sort()).toEqual(Object.values(shipped).map((c) => c.toUpperCase()).sort());
    expect(used.has(amber.toUpperCase())).toBe(false);
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
  /** Every source location the eight drawn colours come from, spelled out
   *  against the real file. A rename or a reordered ramp step lands here and
   *  nowhere else -- cursorRules itself only ever sees the `ui` band. */
  const SOURCES: Record<string, () => string> = {
    ink: () => raw.ramps.limestone.colors[0],
    dim: () => raw.ramps.gunmetal.colors[1],
    amber: () => raw.ramps.dust.colors[0],
    info: () => raw.ramps.water.colors[0],
    bad: () => raw.reserved.team.colors.hostile,
    warn: () => raw.reserved.team.colors.neutral,
    hot: () => raw.reserved.vfx.colors.fire,
    live: () => raw.reserved.vfx.colors.tracer,
  };

  it('derives all eight drawn colours from the real palette', () => {
    for (const [name, source] of Object.entries(SOURCES)) {
      const value = source();
      expect({ name, value: resolved.reserved.ui.colors[name] }).toEqual({ name, value });
      expect({ name, defined: typeof value }).toEqual({ name, defined: 'string' });
    }
    expect(Object.keys(resolved.reserved.ui.colors).sort()).toEqual(Object.keys(SOURCES).sort());
  });

  it('carries the seven shipped ones into cursorRules, percent-encoded, and amber into none', () => {
    // `amber` is real, derived and drawn -- by `mount` and `dismount`, the two
    // bodies that earn no rule -- so it reaches the sheet through nothing. See
    // the "seven of the eight" test above for why that is asserted rather than
    // excluded.
    const css = cursorRules(resolved);
    for (const [name, source] of Object.entries(SOURCES)) {
      const encoded = encodeURIComponent(source().toLowerCase());
      expect({ name, drawn: css.includes(encoded) }).toEqual({ name, drawn: name !== 'amber' });
    }
  });

  it("declines the palette's olive, and that is a decision rather than an omission", () => {
    // scrub[0] (#6B8A4A) is the one colour in the brief the chosen set does
    // not use: it sits about 30 RGB from `dim` and photographs as mud at 32px
    // on limestone ground, so `live` (vfx.tracer) carries the affirmative
    // states instead. The previous set DID draw `support` in it, so this would
    // have passed vacuously before and does not now -- it is pinned so that
    // re-adding it is a deliberate act with a rendered check behind it, not a
    // reflex when somebody notices a palette entry going unused.
    expect(raw.ramps.scrub.colors[0]).toBe('#6B8A4A');
    const css = cursorRules(resolved);
    expect(css).not.toContain(encodeURIComponent(raw.ramps.scrub.colors[0].toLowerCase()));
    expect(Object.values(resolved.reserved.ui.colors)).not.toContain(raw.ramps.scrub.colors[0]);
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

  it('emits no rule at all for mount, dismount or smoke -- Important 1', () => {
    // The hover ticker feeds only resolvePointer, which never emits a mount,
    // dismount or smoke intent -- those come solely from the keyboard path
    // (resolveKeyVerb), whose result never reaches the cursor. A rule for
    // them, bare or badged, would be dead bytes shipped on every page load:
    // `mount-soft`, `mount-sniper`, `dismount-transport`, `smoke-transport`,
    // `smoke-soft` and `smoke-armour` used to be nine such rules with the
    // three bare ones.
    for (const key of ['mount', 'dismount', 'smoke']) {
      expect(css).not.toContain(`data-cursor='${key}'`);
      expect(css).not.toContain(`data-cursor='${key}-`);
    }
  });

  it('keeps drawable bodies for those three without shipping a byte of them', () => {
    // The previous set DELETED mount/dismount/smoke's drawings when their
    // rules were withdrawn, and re-deriving three payloads that have already
    // been drawn and looked at is the expensive half of the work. The chosen
    // set keeps them, because in this vocabulary each is the shared housing
    // plus one payload literal. Both halves are pinned: they really draw
    // (a bare housing with no payload would pass a "returns a string" check),
    // and they really ship nothing.
    const c = paletteColors(deriveUiBand(raw));
    for (const [name, body] of Object.entries(UNWIRED_BODIES)) {
      const markup = body(c);
      expect({ name, housing: markup.includes('M3,6L6,3H10V6H6V10H3Z') }).toEqual({ name, housing: true });
      // ...and something beyond the housing: each carries a second <path>.
      expect({ name, paths: markup.split('<path').length - 1 }).toEqual({ name, paths: 2 });
      expect(css).not.toContain(encodeURIComponent(markup));
    }
    expect(Object.keys(UNWIRED_BODIES).sort()).toEqual(['dismount', 'mount', 'smoke']);
  });

  it('emits no bare rule for charge -- Minor 2', () => {
    // yahalom_squad is the only unit with canTunnelCharge, so a charging
    // group is always uniformly `soft` and the bare `charge` key can never
    // compose -- only `charge-soft` is reachable.
    expect(css).not.toContain("data-cursor='charge']");
    expect(css).toContain("data-cursor='charge-soft']");
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

/** The chosen art's one integration decision, made by the project lead: the
 *  role badge lands exactly on the housing's bottom-right bracket, so a badged
 *  key OMITS that bracket and the badge becomes the fourth corner plate. The
 *  rejected alternatives were drawing the badge on top of the bracket (two
 *  shapes in one place) and moving it to a mid-edge gap (a sticker, not a
 *  plate). All three of those render, so nothing but an assertion separates
 *  the shipped one from either. */
describe('the badge is the housing\'s fourth plate', () => {
  const css = cursorRules(deriveUiBand(raw));

  /** The decoded SVG for one key's frame-0 rule. */
  function art(key: string): string {
    const line = css
      .split('\n')
      .find((l) => l.includes(`data-cursor='${key}']`) && !l.includes('data-cursor-frame'));
    if (!line) throw new Error(`no rule found for ${key}`);
    return decodeURIComponent(line.match(/url\("data:image\/svg\+xml,([^"]+)"\)/)![1]);
  }

  // bracketAt('br', {inset:3, arm:7, thickness:3, chamfer:3}) -- the exact
  // subpath the generator emits for the bottom-right corner at the default
  // housing shape, which is the shape every badged verb uses. Spelled out
  // rather than imported so this test would still fail if `bracketAt` itself
  // started emitting something different for that corner.
  const BR = 'M29,26L26,29H22V26H26V22H29Z';
  // `protected` is the one state drawn on a heavier housing (arm 8, thickness
  // 4, chamfer 4) -- the extra weight is what separates it from `support`, the
  // other X-shaped state, at 32px -- so its own bottom-right plate is a
  // different subpath. It is unbadged, so it can never lose it.
  const BR_HEAVY = 'M29,25L25,29H21V25H25V21H29Z';

  it('draws that bracket on every BARE key and on none of the badged ones', () => {
    // Both directions matter and they fail differently: a badged key that
    // kept the bracket draws the badge and the plate in the same 7px square
    // (the collision the decision exists to resolve), and a bare key that lost
    // it draws a three-cornered housing with nothing standing in for the
    // fourth, which is just a broken frame.
    for (const key of ['move', 'attack', 'garrison', 'demolish', 'blocked', 'costly', 'support']) {
      expect({ key, hasBr: art(key).includes(BR) }).toEqual({ key, hasBr: true });
    }
    expect({ key: 'protected', hasBr: art('protected').includes(BR_HEAVY) })
      .toEqual({ key: 'protected', hasBr: true });
    const badged = [...css.matchAll(/canvas\[data-cursor='([a-z]+-[a-z]+)'\] /g)].map((m) => m[1]);
    expect(badged.length).toBe(19); // move x7, attack x7, garrison x2, demolish x2, charge x1
    for (const key of badged) {
      expect({ key, hasBr: art(key).includes(BR) }).toEqual({ key, hasBr: false });
    }
  });

  it('puts the badge on the vacated plate rather than beside it', () => {
    // "The badge takes its place" is a geometric claim, so it is checked
    // geometrically: the badge's own box must sit centred on the bracket's
    // footprint. bracketAt('br') spans x22-29, y22-29 -- centre 25.5 -- and
    // `armour` is the one bucket whose mark is a plain axis-aligned rect, so
    // its four numbers ARE the badge box and can be read straight out of the
    // markup. Off-centring the badge (it rode at 24,24 before this set, which
    // welded it to garrison's portal wall) fails here rather than only in a
    // screenshot nobody takes.
    const rect = art('move-armour').match(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/);
    expect(rect).not.toBeNull();
    const [x, y, w, h] = rect!.slice(1).map(Number);
    expect({ cx: x + w / 2, cy: y + h / 2 }).toEqual({ cx: 25.5, cy: 25.5 });
  });

  it('gives the badge the housing\'s own colour, so it reads as a plate and not a sticker', () => {
    // A contrasting badge would read as one plate painted differently, which
    // is exactly what demolish's beacon means -- and two things cannot mean it
    // at once. Checked per verb against the colour that verb's housing is
    // drawn in, so a future re-colour of any state has to update both halves.
    const c = paletteColors(deriveUiBand(raw));
    const expected: Record<string, string> = {
      'move-armour': c.ink,
      'attack-armour': c.bad,
      'garrison-soft': c.info,
      'charge-soft': c.bad,
    };
    for (const [key, colour] of Object.entries(expected)) {
      const badge = art(key).match(/<(?:rect|path)[^>]*fill="(#[0-9a-f]{6})"[^>]*\/><\/svg>$/);
      expect({ key, badge: badge?.[1] }).toEqual({ key, badge: colour.toLowerCase() });
    }
  });
});

/** Same idea as selectorFor above, but for one animation frame of `key` --
 *  and it models the CASCADE, not the rule list, because what a test about
 *  animation should assert is what the browser DRAWS at frame N, not which
 *  rules happen to exist.
 *
 *  Frame 0 is deliberately NOT a `[data-cursor-frame='0']` selector -- it is
 *  the pre-existing bare/badged rule with no frame attribute at all (see the
 *  "never emits an explicit frame-0 rule" test below). And a frame >= 1 whose
 *  markup would equal frame 0's emits no rule either (cursorRules elides it),
 *  so it too resolves to that same lower-specificity rule -- exactly as the
 *  browser resolves it when the driver writes that index. Falling back rather
 *  than throwing is therefore faithful, not lenient: `assertNoStaticTick`
 *  below keeps asserting real drawn output across an elided frame. */
function frameLineFor(css: string, key: string, frame: number): string {
  const lines = css.split('\n');
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

// Three of the thirteen CursorName values (`attack`, `charge`, `demolish`)
// additionally animate -- see ANIMATED_CURSORS's own comment in cursor.ts,
// and the plugin's top comment. Every non-frame property of those keys'
// rules (hotspot, the `cursor:` property, palette colours, encoding, DOM
// matching, reachability) is already covered, unmodified, by the describes
// above -- this covers only what the frame slice adds on top.
describe('animated cursor frames', () => {
  const css = cursorRules(deriveUiBand(raw));

  it('animates exactly attack, charge and demolish, and nothing else', () => {
    // Pins the "three of the thirteen" claim the plugin's own top comment
    // makes -- a silent fourth entry (or the loss of one of these three)
    // would otherwise only surface as a visual difference nobody happened to
    // look for. `demolish` earns its place from ANIMATED_CURSORS' own rule
    // (an order that holds a unit on the spot while a sim timer runs:
    // demolitionTicks, the same shape as charge's tunnelChargeTicks);
    // `support` was considered against that rule and rejected.
    expect(Object.keys(ANIMATED_CURSORS).sort()).toEqual(['attack', 'charge', 'demolish']);
  });

  /** Every frame 1..N-1 of `key` either emits its own rule, or draws frame
   *  0's markup and is deliberately elided -- and nothing outside that range
   *  is ever emitted.
   *
   *  Stated as "emits a rule IFF the markup differs from frame 0" rather than
   *  the flat "a rule for every frame" this used to assert, because both
   *  pulses return to rest at their midpoint and shipping a byte-identical
   *  second copy of frame 0 was 16.5% of the whole injected sheet. Written
   *  against CONTENT so it still fails on the thing that matters: a frame
   *  that should have moved and did not is caught by assertNoStaticTick
   *  below, and a frame silently dropped by index is caught here. */
  function assertFrameRules(key: string, frames: number): void {
    for (let frame = 1; frame < frames; frame++) {
      const selector = `canvas[data-cursor='${key}'][data-cursor-frame='${frame}']`;
      const redundant =
        markupOf(frameLineFor(css, key, frame)) === markupOf(frameLineFor(css, key, 0));
      expect({ key, frame, emitted: css.includes(selector) }).toEqual({
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

  it('emits a frame rule for attack and every reachable attack badge exactly when it differs from frame 0', () => {
    const keys = ['attack', ...(BADGED_VERBS.attack ?? []).map((bucket) => `attack-${bucket}`)];
    expect(keys.length).toBe(1 + 7); // the bare cursor plus all seven role buckets
    for (const key of keys) assertFrameRules(key, ANIMATED_CURSORS.attack!.frames);
  });

  it('emits a frame rule for demolish and both reachable demolish badges exactly when it differs from frame 0', () => {
    // demolish reaches only `soft` and `armour` -- BADGED_VERBS is derived
    // from the roster, so this follows it rather than restating it.
    const keys = ['demolish', ...(BADGED_VERBS.demolish ?? []).map((b) => `demolish-${b}`)];
    expect(keys.length).toBe(1 + 2);
    for (const key of keys) assertFrameRules(key, ANIMATED_CURSORS.demolish!.frames);
  });

  it('elides attack\'s midpoint, elides nothing of demolish\'s sweep, and leaves no duplicate anywhere', () => {
    // The saving, pinned as a fact rather than a comment: attack's housing
    // returns to its rest inset at frame 2 (ATTACK_INSETS 3, 6, 3, 1), so all
    // eight of its keys drop that rule. What makes that safe is that the
    // cascade draws frame 0's image for them, which frameLineFor models and
    // the assertion below checks directly.
    for (const key of ['attack', 'attack-soft', 'attack-armour']) {
      expect(css).not.toContain(`canvas[data-cursor='${key}'][data-cursor-frame='2']`);
      expect(markupOf(frameLineFor(css, key, 2))).toBe(markupOf(frameLineFor(css, key, 0)));
    }
    // demolish USED to be elided here too and is not any more, which is the
    // point of writing the rule as content rather than as an index: the art
    // changed from a pulse that returns to rest into a beacon that visits a
    // different plate on each of four frames, and the elision loop needed no
    // edit to stop firing. Its three keys now emit all three frames.
    for (const key of ['demolish', 'demolish-soft', 'demolish-armour']) {
      for (let frame = 1; frame < ANIMATED_CURSORS.demolish!.frames; frame++) {
        expect({ key, frame, emitted: css.includes(`canvas[data-cursor='${key}'][data-cursor-frame='${frame}']`) })
          .toEqual({ key, frame, emitted: true });
      }
    }
    // charge's spark moves down the fuse on every tick, so none of its frames
    // is elidable either.
    for (let frame = 1; frame < ANIMATED_CURSORS.charge!.frames; frame++) {
      expect(css).toContain(`canvas[data-cursor='charge-soft'][data-cursor-frame='${frame}']`);
    }
    // And the whole sheet carries no duplicate image at all: every rule draws
    // something no other rule draws. This is the general statement the per-key
    // assertions above are instances of -- it would go red if any future frame
    // table reintroduced a redundant rule anywhere.
    const images = css.split('\n').map((l) => markupOf(l));
    expect(new Set(images).size).toBe(images.length);
  });

  it('emits frames 1..N-1 for charge-soft, and no bare charge frame rule at all', () => {
    const { frames } = ANIMATED_CURSORS.charge!;
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

  it('touches no key outside attack, demolish, their badges, and charge-soft', () => {
    // The complement of the tests above: every key that DOES receive a frame
    // rule belongs to one of the three ANIMATED_CURSORS names -- proving the
    // ten other CursorName states (move, blocked, costly, protected, support,
    // garrison, plus default/mount/dismount/smoke, which draw no rule at all)
    // never pick up a data-cursor-frame selector, without enumerating them by
    // hand. `support` is in that list on purpose: it is the state most likely
    // to be added next by someone reading only the cursor art, and
    // ANIMATED_CURSORS' comment records why it was rejected.
    const frameKeys = new Set(
      [...css.matchAll(/canvas\[data-cursor='([^']+)'\]\[data-cursor-frame='\d+'\]/g)].map((m) => m[1])
    );
    expect(frameKeys.size).toBeGreaterThan(0);
    const animated = Object.keys(ANIMATED_CURSORS);
    for (const key of frameKeys) {
      const base = key.split('-')[0];
      expect({ key, animated: animated.includes(base) }).toEqual({ key, animated: true });
    }
    expect(frameKeys.has('support')).toBe(false);
  });

  it('gives every frame-specific rule the same centred hotspot as every other rule', () => {
    const frameLines = css.split('\n').filter((l) => l.includes('data-cursor-frame'));
    expect(frameLines.length).toBeGreaterThan(0);
    for (const line of frameLines) {
      expect(line).toMatch(new RegExp(`\\)\\s+${CENTER}\\s+${CENTER}\\s*,\\s*auto`));
    }
  });

  /** Not "every frame pairwise distinct": ATTACK_PULSE deliberately returns
   *  attack's frame 2 to the exact geometry of frame 0 -- its own comment
   *  reads "rest, converge, rest, release", i.e. the pulse's midpoint is a
   *  real rest, not a fifth arbitrary shape, so frames 0 and 2 draw
   *  byte-identical bodies on purpose. What would be a real defect is a
   *  timer tick that changes nothing on screen -- so the actual contract is
   *  that no two ADJACENT frames in the cycle (including the wrap from the
   *  last frame back to the first) are identical, checked for both animated
   *  cursors so a future retune of either can't silently flatten a step. */
  function assertNoStaticTick(css: string, key: string, frames: number): void {
    const bodies = Array.from({ length: frames }, (_, frame) => markupOf(frameLineFor(css, key, frame)));
    for (let frame = 0; frame < frames; frame++) {
      const next = bodies[(frame + 1) % frames];
      expect({ frame, changes: bodies[frame] !== next }).toEqual({ frame, changes: true });
    }
  }

  it('changes what it draws on every tick of the attack cycle -- no adjacent-frame step (including the wrap) is a no-op', () => {
    assertNoStaticTick(css, 'attack', ANIMATED_CURSORS.attack!.frames);
  });

  it('changes what it draws on every tick of the charge-soft cycle -- no adjacent-frame step (including the wrap) is a no-op', () => {
    assertNoStaticTick(css, 'charge-soft', ANIMATED_CURSORS.charge!.frames);
  });

  it('changes what it draws on every tick of the demolish cycle -- no adjacent-frame step (including the wrap) is a no-op', () => {
    // Runs through the elided frame 2, so it also proves the elision did not
    // flatten a tick: frameLineFor resolves that index the way the cascade
    // does, and 12 -> 14 -> 12 -> 10 still steps four times.
    assertNoStaticTick(css, 'demolish', ANIMATED_CURSORS.demolish!.frames);
    assertNoStaticTick(css, 'demolish-armour', ANIMATED_CURSORS.demolish!.frames);
  });

  it("pins demolish's still core against attack's moving housing -- the one thing that keeps two animated reticles apart in motion", () => {
    // Both states are a chamfered housing that changes every 300ms, so what
    // separates them at a glance is WHICH part moves. demolish holds a core
    // dead still and rotates a bone-white beacon around the plates; attack has
    // no core at all and moves the whole housing inward. Swap either half and
    // the two become the same animation in two colours.
    //
    // Read off the emitted markup rather than off the tables, so re-tuning a
    // table without re-reading this comment goes red.
    const CORE = 'M11,21V11H16V16H21V21Z';
    const at = (frame: number, key = 'demolish') =>
      decodeURIComponent(markupOf(frameLineFor(css, key, frame)));

    // 1. demolish's core is byte-identical on all four frames.
    for (let frame = 0; frame < ANIMATED_CURSORS.demolish!.frames; frame++) {
      expect({ frame, still: at(frame).includes(CORE) }).toEqual({ frame, still: true });
    }
    // 2. ...and the beacon really does move: a different corner is drawn in
    //    `ink` on each of the four, clockwise. The lit corner is the one
    //    bracket that is NOT in the `hot` path, so each frame's ink subpath is
    //    distinct and there are four of them.
    const c = paletteColors(deriveUiBand(raw));
    const beacons = Array.from({ length: 4 }, (_, frame) => {
      const lit = at(frame).match(new RegExp(`<path fill="${c.ink.toLowerCase()}" d="([^"]+)"`));
      return lit?.[1];
    });
    expect(beacons.filter((b) => typeof b === 'string').length).toBe(4);
    expect(new Set(beacons).size).toBe(4);

    // 3. attack, by contrast, carries NO core at all and moves its housing:
    //    the four insets are 3, 6, 3, 1, and the top-left bracket's own
    //    subpath is what shows it.
    for (let frame = 0; frame < ANIMATED_CURSORS.attack!.frames; frame++) {
      expect({ frame, core: at(frame, 'attack').includes(CORE) }).toEqual({ frame, core: false });
    }
    expect(at(1, 'attack')).toContain('M6,9L9,6'); // inset 6 -- converged
    expect(at(3, 'attack')).toContain('M1,4L4,1'); // inset 1 -- released
    expect(at(0, 'attack')).toContain('M3,6L6,3'); // inset 3 -- rest
  });

  it("lights the badge on the one frame the beacon reaches its plate, and only on a badged key", () => {
    // The badge IS the bottom-right plate on a badged key, so the sweep has to
    // include it. Skipping it would leave a quarter of every demolish-soft /
    // demolish-armour cycle with no plate lit at all -- a tick that changes
    // almost nothing, wearing the costume of a deliberate beat. BEACON_SWEEP
    // is clockwise (tl, tr, br, bl), so `br` is frame 2.
    const c = paletteColors(deriveUiBand(raw));
    const ink = c.ink.toLowerCase();
    const badgeColourAt = (key: string, frame: number): string | undefined => {
      const art = decodeURIComponent(markupOf(frameLineFor(css, key, frame)));
      return art.match(/<(?:rect|path)[^>]*fill="(#[0-9a-f]{6})"[^>]*\/><\/svg>$/)?.[1];
    };
    for (const key of ['demolish-soft', 'demolish-armour']) {
      const litFrames = [0, 1, 2, 3].filter((f) => badgeColourAt(key, f) === ink);
      expect({ key, litFrames }).toEqual({ key, litFrames: [2] });
      // and on the other three it is the same `hot` the rest of the plates are
      expect({ key, rest: badgeColourAt(key, 0) }).toEqual({ key, rest: c.hot.toLowerCase() });
    }
    // The bare key has a real bracket there instead, so nothing about it is
    // a badge -- its frame-2 ink subpath is the bracket's own path.
    expect(decodeURIComponent(markupOf(frameLineFor(css, 'demolish', 2))))
      .toContain(`<path fill="${ink}" d="M29,26L26,29H22V26H26V22H29Z"/>`);
  });

  it('returns attack\'s midpoint to its own rest pose on purpose -- frame 2 is frame 0, not a fifth shape', () => {
    // Provenance for the weaker adjacency check above: this is *why* a
    // strict "every frame pairwise distinct" assertion would be wrong here,
    // proven directly rather than only argued about in a comment.
    expect(markupOf(frameLineFor(css, 'attack', 2))).toBe(markupOf(frameLineFor(css, 'attack', 0)));
  });

  it('matches a real canvas once main.ts\'s own pairing writes both data-cursor and a mid-cycle data-cursor-frame', () => {
    // Frame 1, not 2: frame 2 is the elided midpoint and has no rule of its
    // own to match any more (the elision test above pins that), so it is the
    // wrong exemplar for "the frame rule engages". Frame 1 is a real emitted
    // override and is what this test was always about.
    const dom = new JSDOM('<div id="stage"><canvas></canvas></div>');
    const canvas = dom.window.document.querySelector('canvas')!;
    canvas.dataset.cursor = 'attack';
    canvas.dataset.cursorFrame = '1';
    const selector = selectorOf(frameLineFor(css, 'attack', 1));
    expect(canvas.matches(selector)).toBe(true);
  });

  it('the frame-0 (bare) rule matches regardless of what data-cursor-frame holds -- the fail-safe the plugin comment promises', () => {
    // ruleFor's selector names only data-cursor, so it matches whether
    // data-cursor-frame is absent or holds any value at all -- CSS attribute
    // selectors are independent of attributes they do not name. main.ts's
    // ensureCursorAnim always pairs the two writes in one synchronous call
    // today, so an unpaired write does not currently arise from normal
    // play -- but the CSS itself does not depend on that pairing discipline,
    // which is what makes an absent or not-yet-written frame attribute (a
    // future caller, or a debugging instrument, setting data-cursor alone)
    // fall back to this rule instead of to the OS arrow. Checked against a
    // real canvas node rather than trusted from selector syntax alone -- a
    // string assertion cannot see a match; a DOM node can.
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
    // The failure the fail-safe exists to prevent, exercised as a sequence
    // rather than asserted from selector syntax: the pointer leaves a hostile
    // mid-cycle and lands on something else while data-cursor-frame still
    // holds the old index. ensureCursorAnim resets it today, but the CSS must
    // not depend on that -- so this writes the stale index by hand and asks
    // which rules a real node matches.
    //
    // Three cases, each a different way the index can be wrong, and in every
    // one the art that wins must be a CORRECT frame of the cursor now named.
    const dom = new JSDOM('<div id="stage"><canvas></canvas></div>');
    const canvas = dom.window.document.querySelector('canvas')!;
    const winner = (key: string): string => {
      // Later rules win at equal specificity and the two-attribute selector
      // outranks the one-attribute rule, so the last matching line is what
      // the browser draws.
      const matching = css.split('\n').filter((l) => canvas.matches(selectorOf(l)));
      expect({ key, matched: matching.length > 0 }).toEqual({ key, matched: true });
      return markupOf(matching[matching.length - 1]);
    };

    // 1. Stale index onto a NON-animated cursor. `move` emits no frame rules
    //    at all, so only its bare rule can match -- frame 0 art, correct.
    canvas.dataset.cursor = 'move-soft';
    canvas.dataset.cursorFrame = '3'; // left over from an attack cycle
    expect(winner('move-soft')).toBe(markupOf(frameLineFor(css, 'move-soft', 0)));

    // 2. Stale index onto an animated cursor at an ELIDED frame. attack's
    //    frame 2 has no rule, so the bare rule wins -- and frame 2's art IS
    //    frame 0's art, so the elision costs nothing here. This is the case
    //    that would regress if the elision were ever done by index rather
    //    than by content.
    canvas.dataset.cursor = 'attack-soft';
    canvas.dataset.cursorFrame = '2';
    expect(winner('attack-soft')).toBe(markupOf(frameLineFor(css, 'attack-soft', 0)));

    // 3. Stale index onto a DIFFERENT animated cursor that does emit that
    //    frame. demolish-soft frame 3 is real art, so the player sees a
    //    demolish burst mid-cycle rather than an attack reticle or the OS
    //    arrow -- out of phase for one tick at most, never wrong art.
    canvas.dataset.cursor = 'demolish-soft';
    canvas.dataset.cursorFrame = '3';
    const drawn = winner('demolish-soft');
    expect(drawn).toBe(markupOf(frameLineFor(css, 'demolish-soft', 3)));
    expect(drawn).not.toBe(markupOf(frameLineFor(css, 'attack-soft', 3)));
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

  const HINT_COMBOS: CursorHints[] = [
    { hostile: false, blocked: false },
    { hostile: true, blocked: false },
    { hostile: false, blocked: true },
    { hostile: true, blocked: true },
  ];

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
    // unreachable) and would redden on Important 1 if a mount/dismount/smoke
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
