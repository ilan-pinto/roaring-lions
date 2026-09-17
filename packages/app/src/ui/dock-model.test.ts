// The dock's rules, without a browser (GH-153 slice 3).
//
// `production.test.ts` proves the DOM join; this file proves the arithmetic
// and the two string derivations that a screenshot can only ever check for one
// unit at a time.

import { describe, expect, it } from 'vitest';
import { units } from '@lions/data';
import {
  MAX_TAGS,
  doctrineTags,
  lockLabel,
  queueFor,
  tileState,
  type DockUnit,
  type DockView,
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
});
