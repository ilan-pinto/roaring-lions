// GH-1438 E10: the authored-entity budget (docs/campaign/civilian-drama.md §10.2, G-10 a; the lead: 160). Its own
// module for the reason every validate_*.mjs is one: validate_data.mjs runs its whole sweep at import time and exits,
// so a test cannot import it.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUTHORED_ENTITY_BUDGET, authoredEntityCount, entityBudgetFailures } from '../validate_entity_budget.mjs';
import { amendmentOps, applyOverlays, challengeOf, POSTURE_IDS } from '@lions/data';
import { missions } from '@lions/data/content';

const ROOT = join(__dirname, '..', '..');

/** A mission of exactly `n` authored bodies, one per source, so every source is on the count. */
function fixture(n: number): Record<string, unknown> {
  // 4 (the ledger draw) + 3 + (2 + 2 x 3) + 5 + (1 + 1 x 2) = 23 fixed bodies; the first force row makes up the rest.
  return {
    starting_force: [
      { unit: 'inf_squad', count: n - 23 },
      { unit: 'inf_squad', count: 4, from_ledger: true },
    ],
    civilians: { groups: [{ unit: 'civilians', count: 3, marker: 'home' }] },
    enemy: {
      garrison: [{ unit: 'technical', count: 2, at: [1, 1], passengers: [{ unit: 'militia_cell', count: 3 }] }],
      waves: [{ at_seconds: 10, units: [{ unit: 'militia_cell', count: 2, from: 'w' }, { unit: 'rpg_team', count: 3, from: 'w' }] }],
    },
    triggers: [
      { id: 'a', on: { kind: 'timer_s', seconds: 5 }, do: { kind: 'spawn', units: [{ unit: 'technical', count: 1, at: [2, 2], passengers: [{ unit: 'rpg_team', count: 2 }] }] } },
      // Not a spawn: a `remove` names a group, and its `units` (none here) would never be read.
      { id: 'b', on: { kind: 'timer_s', seconds: 6 }, do: { kind: 'remove', group: 'x' } },
    ],
  };
}

describe('authoredEntityCount', () => {
  it('counts every source by the runtime arithmetic, a carrier with its whole load', () => {
    // Literals, not re-derived: 137 + 4 force, 3 civilians, 2 + 6 garrison, 5 wave, 3 trigger.
    expect(authoredEntityCount(fixture(160))).toEqual({
      total: 160,
      parts: { starting_force: 141, civilians: 3, garrison: 8, waves: 5, triggers: 3 },
    });
  });
  it('counts every carrier of a count>1 placement with the whole declared load (spawnPlacement)', () => {
    const m = { enemy: { garrison: [{ unit: 'technical', count: 3, passengers: [{ unit: 'a', count: 2 }, { unit: 'b', count: 1 }] }] } };
    expect(authoredEntityCount(m).total).toBe(12);
  });
  it('counts a reinforce trigger as it counts a spawn, and no other trigger kind', () => {
    const units = [{ unit: 'inf_squad', count: 7 }];
    const t = (kind: string) => ({ triggers: [{ id: 't', on: { kind: 'timer_s', seconds: 1 }, do: { kind, units } }] });
    expect(authoredEntityCount(t('reinforce')).total).toBe(7);
    expect(authoredEntityCount(t('spawn')).total).toBe(7);
    expect(authoredEntityCount(t('commit')).total).toBe(0);
  });
  it('reads an empty mission as zero', () => {
    expect(authoredEntityCount({}).total).toBe(0);
  });
});

describe('entityBudgetFailures', () => {
  it('passes a mission at 160 and refuses one at 161', () => {
    expect(AUTHORED_ENTITY_BUDGET).toBe(160);
    expect(entityBudgetFailures(fixture(160), 'm')).toEqual([]);
    expect(entityBudgetFailures(fixture(161), 'm')).toEqual([
      'm: authors 161 entities, over the budget of 160 (GH-1438 E10) -- starting_force 142, civilians 3, garrison 8, ' +
        "waves 5, spawn/reinforce 3; the sim's 256 are for the mission's whole life, and a late spawn that does not fit " +
        'is skipped silently',
    ]);
  });
  it('a passenger alone tips a mission over (the load is counted, not just the carrier)', () => {
    const m = fixture(160) as { enemy: { garrison: { passengers: { count: number }[] }[] } };
    m.enemy.garrison[0].passengers[0].count = 3; // unchanged: 160
    expect(entityBudgetFailures(m, 'm')).toEqual([]);
    m.enemy.garrison[0].passengers[0].count = 4; // two carriers x one more seat: 162
    expect(entityBudgetFailures(m, 'm')).toHaveLength(1);
  });
});

describe('the shipped missions', () => {
  const dir = join(ROOT, 'data/missions');
  const shipped = readdirSync(dir).filter((n) => n.endsWith('.json'));

  it.each(shipped)('%s is inside the budget', (f) => {
    const m = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    expect(entityBudgetFailures(m, f)).toEqual([]);
  });

  it("the breach counts what the design doc counted by hand: 9 force + 11 civilians + 7 garrison + 27 wave = 54", () => {
    // The independent oracle: docs/campaign/civilian-drama.md §11.1.1 ("the shipped total is 54"), counted from the
    // JSON by the level-scripter, not by this module. The breach pilot's road crowd moves it (script count 143).
    const m = JSON.parse(readFileSync(join(dir, 'beit_sahwan_breach.json'), 'utf8'));
    expect(authoredEntityCount(m)).toEqual({
      total: 54,
      parts: { starting_force: 9, civilians: 11, garrison: 7, waves: 27, triggers: 0 },
    });
  });

  // A posture's relief and a challenge's amendments are authored data too, and they spawn at runtime, where an
  // overflow is skipped silently (the Easier relief is the case §10.2 E15 names).
  const ids = Object.keys(missions) as (keyof typeof missions)[];
  it('covers the whole shipped list', () => {
    expect(ids.length).toBe(shipped.length);
  });
  for (const posture of POSTURE_IDS) {
    it.each(ids)(`%s at ${posture}, with and without every amendment it offers`, (id) => {
      const offers = challengeOf(id)?.offers ?? [];
      for (const on of offers.length > 0 ? [[], offers] : [[]]) {
        const m = applyOverlays(missions[id] as never, { posture, amendments: amendmentOps(on, id) });
        expect(entityBudgetFailures(m, `${id}@${posture}+${on.join('+')}`)).toEqual([]);
      }
    });
  }
});
