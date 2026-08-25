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
import { badgeFor, cursorFor, cursorKey, type BadgeHints, type CursorHints } from './src/input/cursor';
import { resolvePointer, type IntentWorld } from './src/input/intents';
import { roleBucket, type RoleBucket } from './src/ui/role';
import { BADGED_VERBS, CENTER, cursorRules, deriveUiBand, resolvePalette } from './vite-plugin-cursors';

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
