// The dock's rules, without a browser (GH-153 slice 3).
//
// `production.test.ts` proves the DOM join; this file proves the arithmetic
// and the two string derivations that a screenshot can only ever check for one
// unit at a time.

import { describe, expect, it } from 'vitest';
import { units } from '@lions/data';
import { unlockReason } from '@lions/sim';
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
  it('keeps the ROE gate’s number, which is the one thing a tile can act on', () => {
    expect(lockLabel('requires campaign ROE 55 (no missions rated yet)')).toBe('ROE ≥ 55');
    expect(lockLabel('requires campaign ROE 90 (currently 71)')).toBe('ROE ≥ 90');
  });

  it('falls back to one word for a reason with no number in it', () => {
    expect(lockLabel('field camp destroyed — no production')).toBe('locked');
    expect(lockLabel('no field camp — production needs one standing')).toBe('locked');
    expect(lockLabel('not available in the field')).toBe('locked');
    expect(lockLabel('requires clearing beit_sahwan_1_recon')).toBe('locked');
  });

  // The point of this one: `lockLabel` PARSES a sentence another package
  // writes. Hand-written inputs above would keep passing forever if
  // `unlockReason` reworded itself, and the tile would silently degrade to
  // `locked` for every gated unit at once. This feeds it the real thing.
  it('reads the sentence @lions/sim actually produces, not a copy of it', () => {
    const why = unlockReason({ roeMin: 55 }, { 'roe.mission_ratings': { a: 20 } });
    expect(why).not.toBe(null);
    expect(lockLabel(why ?? '')).toBe('ROE ≥ 55');
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

  it('carries both the short lock and the runtime’s own sentence', () => {
    const state = tileState(
      unit(),
      view({ buildBlockedReason: () => 'requires campaign ROE 60 (currently 41)' })
    );
    expect(state.lock).toEqual({
      short: 'ROE ≥ 60',
      full: 'requires campaign ROE 60 (currently 41)',
    });
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
