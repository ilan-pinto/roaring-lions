// The dock's rules, without a browser (GH-153 slice 3).
//
// `production.test.ts` proves the DOM join; this file proves the arithmetic
// and the two string derivations that a screenshot can only ever check for one
// unit at a time.

import { describe, expect, it } from 'vitest';
import { units } from '@lions/data';
import {
  LINE_QUEUE_CHIPS,
  MAX_TAGS,
  RALLY_FLASH_MS,
  buildLine,
  lineView,
  linesShown,
  rallyMarks,
  doctrineTags,
  lockLabel,
  queueFor,
  tileState,
  worksTileState,
  type DockUnit,
  type DockView,
  type LineSnapshot,
} from './dock-model';

function unit(over: Partial<DockUnit> = {}): DockUnit {
  return {
    id: 'inf_squad',
    name: 'Rifle Squad',
    logistics: 292,
    buildTimeS: 15,
    bucket: 'soft',
    sprite: '/sprites/INF_SQUAD/idle_f03_000.png',
    tags: ['soft'],
    ...over,
  };
}

function view(over: Partial<DockView> = {}): DockView {
  return {
    logistics: 1000,
    production: [],
    buildBlockedReason: () => null,
    ...over,
  };
}

describe('lockLabel', () => {
  // Reads the STRUCTURED gate through `conductAtLeast`/`starsEarned` now --
  // the same predicates `gateSentence` and the brigade's own `bindingGate`
  // use -- rather than a regex over `unlockReason`'s sentence. That sentence
  // never reaches this function at all any more.
  it('keeps the Conduct gate’s number, which is the one thing a tile can act on', () => {
    expect(lockLabel({ roeMin: 55 }, {})).toBe('Conduct ≥55');
    expect(lockLabel({ roeMin: 90 }, { 'roe.mission_ratings': { a: 71 } })).toBe('Conduct ≥90');
  });

  it('falls back to one word for a gate with no number to show, or none at all', () => {
    expect(lockLabel(undefined, {})).toBe('locked');
    expect(lockLabel({ afterMission: 'beit_sahwan_1_recon' }, {})).toBe('locked');
  });

  it('does not name a gate the ledger has already cleared', () => {
    // A unit can decline `roeMin` while still failing `starsMin` (or vice
    // versa); the label must name whichever one is ACTUALLY binding, the same
    // precedence `gateSentence` checks in.
    expect(lockLabel({ roeMin: 40, starsMin: 12 }, { 'roe.mission_ratings': { a: 90 } })).toBe('★ ≥12');
  });

  it('renders the stars gate as a star count', () => {
    expect(lockLabel({ starsMin: 12 }, {})).toBe('★ ≥12');
  });

  // A gate with no earned field at all is bought-only (D1, the special forces
  // shape): its number is the price. A gate that also declares an earned field
  // is never bought-only per `isBoughtOnly` -- the price is an alternative to
  // an EMPTY earned path, not a discount on a real one -- so an unmet Conduct
  // or stars floor still wins the label even when the gate carries a price too.
  it('labels a bought-only lock by its price, and an earned lock by its earned number even when a price is set too', () => {
    expect(lockLabel({ price: 600 }, {})).toBe('600 cr');
    expect(lockLabel({ starsMin: 12, price: 600 }, {})).toBe('★ ≥12');
    expect(lockLabel({ roeMin: 55, price: 400 }, {})).toBe('Conduct ≥55');
  });
});

describe('doctrineTags', () => {
  // The spec's own tooltip, drawn against the shipped unit's real abilities.
  it('draws the spec’s line for the unit the spec drew it for', () => {
    const yahalom = units.yahalom_squad;
    expect(doctrineTags('soft', yahalom.abilities)).toEqual(['soft', 'demolition', 'garrisons']);
  });

  it('leads with the bucket, always', () => {
    expect(doctrineTags('armour', [])).toEqual(['armour']);
    expect(doctrineTags('transport', ['smoke'])).toEqual(['transport', 'smoke']);
  });

  it('stops at three so the line fits the tooltip', () => {
    const tags = doctrineTags('soft', [
      'demolish',
      'breach',
      'garrison',
      'hidden_setup',
      'mark_target',
    ]);
    expect(tags).toHaveLength(MAX_TAGS);
    expect(tags).toEqual(['soft', 'demolition', 'breach']);
  });

  it('says demolition once for a unit that can do it two ways', () => {
    expect(doctrineTags('soft', ['demolish', 'tunnel_charge', 'garrison'])).toEqual([
      'soft',
      'demolition',
      'garrisons',
    ]);
  });

  // `kamikaze` is a bucket, not an ability tag — an entry for it in the table
  // would make the shipped attack_drone read `kamikaze · one-way`.
  it('does not repeat the bucket back as an ability', () => {
    expect(doctrineTags('kamikaze', units.attack_drone.abilities)).toEqual([
      'kamikaze',
      'spots',
    ]);
  });

  it('prefers what is rare to what every rifleman has', () => {
    // recon_drone: mark_target and mark_tunnel. Only one unit type in the KDF
    // roster can find a tunnel; most of the infantry can spot.
    expect(doctrineTags('drone', units.recon_drone.abilities)).toEqual([
      'drone',
      'finds tunnels',
      'spots',
    ]);
  });
});

describe('queueFor', () => {
  it('is null when nothing of that type is building', () => {
    expect(queueFor(view({ production: [{ unit: 'mbt_lavi', ticksLeft: 40, doneTicks: 10, totalTicks: 50 }] }), 'inf_squad')).toBe(null);
  });

  it('counts the seconds up, so a part-second still reads as a second left', () => {
    const q = queueFor(
      view({ production: [{ unit: 'inf_squad', ticksLeft: 281, doneTicks: 19, totalTicks: 300 }] }),
      'inf_squad'
    );
    expect(q?.secs).toBe(15); // 281 / 20 = 14.05
  });

  it('reports progress as a percentage of the whole build', () => {
    const q = queueFor(
      view({ production: [{ unit: 'inf_squad', ticksLeft: 114, doneTicks: 186, totalTicks: 300 }] }),
      'inf_squad'
    );
    expect(q?.percent).toBeCloseTo(62, 5);
  });

  it('treats a zero-length build as finished rather than un-started', () => {
    const q = queueFor(
      view({ production: [{ unit: 'inf_squad', ticksLeft: 0, doneTicks: 0, totalTicks: 0 }] }),
      'inf_squad'
    );
    expect(q?.percent).toBe(100);
  });

  // The tile promises when the NEXT one arrives. Reading array order instead
  // would make that promise depend on how MissionRuntime happens to push.
  it('reads the one nearest to done, not the first in the array', () => {
    const q = queueFor(
      view({
        production: [
          { unit: 'inf_squad', ticksLeft: 240, doneTicks: 60, totalTicks: 300 },
          { unit: 'inf_squad', ticksLeft: 30, doneTicks: 270, totalTicks: 300 },
        ],
      }),
      'inf_squad'
    );
    expect(q?.secs).toBe(2);
    expect(q?.count).toBe(2);
  });

  it('counts only its own type', () => {
    const q = queueFor(
      view({
        production: [
          { unit: 'inf_squad', ticksLeft: 100, doneTicks: 200, totalTicks: 300 },
          { unit: 'mbt_lavi', ticksLeft: 100, doneTicks: 200, totalTicks: 300 },
        ],
      }),
      'inf_squad'
    );
    expect(q?.count).toBe(1);
  });
});

describe('tileState', () => {
  it('affords a unit it can pay for exactly', () => {
    expect(tileState(unit({ logistics: 292 }), view({ logistics: 292 })).affordable).toBe(true);
    expect(tileState(unit({ logistics: 292 }), view({ logistics: 291 })).affordable).toBe(false);
  });

  // The runtime's own sentence (`buildBlockedReason`) is what decides THAT a
  // tile is locked, but never what it SAYS: when the unit carries its own
  // structured `unlock`, both the short label and the full sentence come from
  // `gateSentence`, recomputed from the gate and the ledger -- the sim's raw
  // wording is never shown, even though the fake runtime here still returns it
  // (proving the recompute path is actually taken, not merely available).
  it('recomputes the lock sentence from the unit’s own gate, never the runtime’s raw wording', () => {
    const state = tileState(
      unit({ unlock: { roeMin: 60 } }),
      view({ buildBlockedReason: () => 'requires campaign Conduct 60 (currently 41)' }),
      { 'roe.mission_ratings': { a: 41 } }
    );
    expect(state.lock).toEqual({
      short: 'Conduct ≥60',
      full: 'Needs a campaign Conduct of 60 or better',
    });
  });

  // A unit with no structured gate at all can still be blocked -- a destroyed
  // field camp, say -- and that text is plain English already, never the
  // sim's `requires ...` gate phrasing, so it is shown as-is.
  it('falls back to the runtime’s own text for a block with no gate behind it', () => {
    const state = tileState(unit(), view({ buildBlockedReason: () => 'field camp destroyed — no production' }));
    expect(state.lock).toEqual({ short: 'locked', full: 'field camp destroyed — no production' });
  });

  it('reports no lock when the runtime has none', () => {
    expect(tileState(unit(), view()).lock).toBe(null);
  });

  it('asks the runtime about THIS unit', () => {
    const asked: string[] = [];
    tileState(
      unit({ id: 'dozer_d9' }),
      view({
        buildBlockedReason: (id) => {
          asked.push(id);
          return null;
        },
      })
    );
    expect(asked).toEqual(['dozer_d9']);
  });

  // ---- population (F3 Lane A, S-F) ----

  const pop = (used: number, cap: number): Pick<DockView, 'populationView'> => ({ populationView: () => ({ used, cap }) });

  it('marks a unit the runtime says is population-capped, and does not lock it', () => {
    const state = tileState(
      unit({ population: 1 }),
      view({ buildBlockedReason: () => 'population cap reached (12/12)', popCapped: () => true, ...pop(12, 12) })
    );
    expect(state.lock).toBe(null);
    expect(state.capped).toEqual({
      short: 'pop full',
      full: 'Population 12/12. A unit must fall first.',
      title: 'Population 12/12. A unit must fall first.',
    });
  });

  it('is not capped when the runtime does not say so, however the reason reads', () => {
    expect(tileState(unit(), view()).capped).toBe(null);
    // A fallen camp outranks the cap in the runtime (`popCapped` is false), and the tile reads the camp's own reason.
    const fallen = tileState(unit(), view({ buildBlockedReason: () => 'field camp destroyed — no production', popCapped: () => false }));
    expect(fallen.capped).toBe(null);
    expect(fallen.lock?.full).toBe('field camp destroyed — no production');
    // A view that predates the cap has no popCapped at all.
    expect(tileState(unit(), view({ buildBlockedReason: () => 'field camp destroyed — no production' })).capped).toBe(null);
  });

  // Review Focus 3.
  it('lets a campaign lock outrank the cap: a locked unit over the cap reads its lock', () => {
    const state = tileState(
      unit({ unlock: { roeMin: 55 } }),
      view({ buildBlockedReason: () => 'population cap reached (12/12)', popCapped: () => true, ...pop(12, 12) }),
      {}
    );
    expect(state.capped).toBe(null);
    expect(state.lock?.short).toBe('Conduct ≥55');
  });

  // Review Focus 4.
  it('names what the unit needs when room is left but not enough for it', () => {
    const state = tileState(
      unit({ name: 'Eitan APC', population: 2 }),
      view({ buildBlockedReason: () => 'population cap reached (11/12)', popCapped: () => true, ...pop(11, 12) })
    );
    expect(state.capped?.full).toBe('Population 11/12. Eitan APC needs 2.');
    // The nameless twin, for a label that opens with the name already.
    expect(state.capped?.title).toBe('Population 11/12; needs 2.');
    expect(state.capped?.short).toBe('pop full');
  });

  it('never shows the sim’s English when the view cannot say how full: the full line is the short label', () => {
    const state = tileState(
      unit(),
      view({ buildBlockedReason: () => 'population cap reached (12/12)', popCapped: () => true })
    );
    expect(state.capped).toEqual({ short: 'pop full', full: 'pop full', title: 'pop full' });
    expect(JSON.stringify(state)).not.toContain('population cap reached');
  });

  it('reads the unit population as 1 when the caller gives none', () => {
    const state = tileState(
      unit({ name: 'Rifle Squad' }),
      view({ buildBlockedReason: () => 'x', popCapped: () => true, ...pop(11, 12) })
    );
    expect(state.capped?.full).toBe('Population 11/12. Rifle Squad needs 1.');
  });

  it('never calls the runtime’s capped answer for a unit it does not name', () => {
    const asked: string[] = [];
    tileState(
      unit({ id: 'recon_drone' }),
      view({
        buildBlockedReason: () => 'x',
        popCapped: (id) => {
          asked.push(id);
          return false;
        },
      })
    );
    expect(asked).toEqual(['recon_drone']);
  });
});

// ---------------------------------------------------------------------------
// F4: one row per camp (direction B, the lead's ruling 18 Oct).
// ---------------------------------------------------------------------------

const FX = 65536;
function line(over: Partial<LineSnapshot> = {}): LineSnapshot {
  return { exit: [10 * FX, 4 * FX], current: null, items: [], progress: 0, ticksLeft: 0, contested: false, rally: null, alive: true, ...over };
}

describe('linesShown', () => {
  it('hides the rows for one idle camp with no rally -- today\'s dock, to the pixel', () => {
    expect(linesShown([line()])).toBe(false);
    expect(linesShown([])).toBe(false);
  });
  it('shows them for one camp with an item, a queue or a rally', () => {
    expect(linesShown([line({ current: 'inf_squad' })])).toBe(true);
    expect(linesShown([line({ items: ['inf_squad'] })])).toBe(true);
    expect(linesShown([line({ rally: [3 * FX, 3 * FX] })])).toBe(true);
  });
  it('always shows them for two camps, idle or not', () => {
    expect(linesShown([line(), line()])).toBe(true);
  });
});

describe('lineView', () => {
  it('words a building line: countdown in whole seconds, percent from the 0-1000 progress', () => {
    const v = lineView(line({ current: 'inf_squad', progress: 375, ticksLeft: 25 }), 1);
    expect(v).toMatchObject({ index: 1, state: 'building', current: { unit: 'inf_squad', percent: 37.5, secs: 2 } });
  });
  it('a contested line with an item is paused; a contested idle line is idle', () => {
    expect(lineView(line({ current: 'inf_squad', contested: true }), 0).state).toBe('paused');
    expect(lineView(line({ contested: true }), 0).state).toBe('idle');
  });
  it('a fallen camp is lost, whatever it held', () => {
    expect(lineView(line({ alive: false }), 0).state).toBe('lost');
  });
  it('draws the first chips with their queue index and folds the rest into a count', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    const v = lineView(line({ current: 'x', items }), 0);
    expect(v.chips).toEqual(items.slice(0, LINE_QUEUE_CHIPS).map((unit, index) => ({ unit, index })));
    expect(v.more).toBe(items.length - LINE_QUEUE_CHIPS);
    expect(lineView(line({ items: ['a'] }), 0).more).toBe(0);
  });
  it('reports a rally', () => {
    expect(lineView(line({ rally: [1, 1] }), 0).hasRally).toBe(true);
    expect(lineView(line(), 0).hasRally).toBe(false);
  });
});

describe('buildLine', () => {
  it('omits the line when nothing is pinned -- the runtime\'s shortest queue', () => {
    expect(buildLine(null, [line(), line()])).toBeUndefined();
  });
  it('names the pinned line', () => {
    expect(buildLine(1, [line(), line()])).toBe(1);
    expect(buildLine(0, [line(), line()])).toBe(0);
  });
  it('drops a pin on a fallen camp or a line that does not exist', () => {
    expect(buildLine(1, [line(), line({ alive: false })])).toBeUndefined();
    expect(buildLine(3, [line(), line()])).toBeUndefined();
  });
});

describe('rallyMarks (R3, on demand only)', () => {
  const lines = [line({ rally: [6 * FX, 28 * FX] }), line({ exit: [16 * FX, 18 * FX], rally: [20 * FX, 23 * FX] }), line()];
  const none = { pinned: null, hovered: null, focused: null, armed: null, flashUntil: new Map<number, number>() };
  it('draws nothing with no focus -- never a standing mark', () => {
    expect(rallyMarks(lines, none, 0)).toEqual([]);
  });
  it('draws a line\'s rally, exit to point in tiles, while its row is pinned, hovered, focused or armed', () => {
    const want = [{ from: { x: 16, y: 18 }, to: { x: 20, y: 23 } }];
    expect(rallyMarks(lines, { ...none, pinned: 1 }, 0)).toEqual(want);
    expect(rallyMarks(lines, { ...none, hovered: 1 }, 0)).toEqual(want);
    expect(rallyMarks(lines, { ...none, focused: 1 }, 0)).toEqual(want);
    expect(rallyMarks(lines, { ...none, armed: 1 }, 0)).toEqual(want);
  });
  it('draws a rally for a few seconds after it is set, and not after', () => {
    const flashUntil = new Map([[0, 1000 + RALLY_FLASH_MS]]);
    expect(rallyMarks(lines, { ...none, flashUntil }, 1000)).toHaveLength(1);
    expect(rallyMarks(lines, { ...none, flashUntil }, 1000 + RALLY_FLASH_MS)).toEqual([]);
  });
  it('draws nothing for a focused line with no rally, or a fallen camp', () => {
    expect(rallyMarks(lines, { ...none, pinned: 2 }, 0)).toEqual([]);
    expect(rallyMarks([line({ rally: [1, 1], alive: false })], { ...none, pinned: 0 }, 0)).toEqual([]);
  });
});

describe('worksTileState (#277)', () => {
  const offer = { typeId: 'kdf_medic_station', name: 'Medic Station', max: 2, left: 1, logistics: 250, intel: 0 };
  it('maps each reason to its state and carries the counts', () => {
    const cases: [Parameters<typeof worksTileState>[1], string][] = [
      [null, 'ready'],
      ['locked', 'locked'],
      ['unaffordable', 'unaffordable'],
      ['none_left', 'none_left'],
      ['needs_engineers', 'needs_engineers'],
      ['not_listed', 'locked'],
    ];
    for (const [reason, state] of cases) {
      expect(worksTileState(offer, reason)).toEqual({ typeId: 'kdf_medic_station', state, left: 1, max: 2, logistics: 250 });
    }
  });
});
