// GH-707, the lead's ruling of 30 Oct: every campaign mission's starting force fields ONE loaned
// Nemala Medic Team (`inf_medic_squad`), as First Light does (PR 843). The coordinator excluded the
// tutorial, `beit_sahwan_0_tutorial`, which teaches the basics and fields no gated unit. Seven more
// missions were first measured and left out; their plans were re-solved (GH-707, the last seven) and `LEFT_OUT`, below, is empty.
//
// What this pins, read off the SHIPPED data (the missions and maps the app loads):
//   - exactly one medic placement per campaign mission, count 1, not `from_ledger`;
//   - it is on LOAN on an empty ledger (the unit is priced, so a fresh campaign has not earned it),
//     which is why `ROSTER_MAX` does not grow;
//   - it stands on clear ground (`missionWorld` throws on a placement inside a wall);
//   - the map has a `wounded_evac` marker on passable ground, the carried man's destination: without
//     it the medic treats a man, seats him, and holds still carrying (PR 843).
// And the tutorial fields none and its map has no evacuation point.
//
// The ids and the exclusion are literals, not read off the data, so deleting a placement fails here.
import { describe, expect, it } from 'vitest';
import { missions, units } from '@lions/data';
import { loanedPlacements, resolveUpgrades, type UnlockGate } from '../../packages/sim/src';
import { kdfUnlockGate } from './backtest/playtest-run';
import { missionWorld } from './mission-harness';

const TUTORIAL = 'beit_sahwan_0_tutorial';
// Missions the medic team was MEASURED into and then left out (the lead's stop rule: a plan below 30 of 30,
// a slowest win past its margin, or a star or credit outcome that drops). Each is listed with why, and
// `LEFT_OUT` is the one place to delete a name when its plan is re-solved and the medic goes in.
const LEFT_OUT: Readonly<Record<string, string>> = {};
const MEDIC = 'inf_medic_squad';

const gateOf = (id: string): UnlockGate | undefined => {
  const u = (units as Record<string, Parameters<typeof kdfUnlockGate>[0] | undefined>)[id];
  return u ? kdfUnlockGate(u) : undefined;
};

const ids = Object.keys(missions).sort();
const campaign = ids.filter((id) => id !== TUTORIAL);
const fielded = campaign.filter((id) => LEFT_OUT[id] === undefined);

describe('the medic team in every campaign mission', () => {
  it('covers all 29 campaign missions: 29 field the team, 0 are listed as measured and left out', () => {
    expect(ids).toHaveLength(30);
    expect(campaign).toHaveLength(29);
    expect(ids).toContain(TUTORIAL);
    expect(Object.keys(LEFT_OUT).every((id) => campaign.includes(id))).toBe(true);
    expect(fielded).toHaveLength(29);
    expect(Object.keys(LEFT_OUT)).toHaveLength(0);
  });

  for (const id of fielded) {
    it(`${id}: one loaned medic team on clear ground and an evacuation point on its map`, () => {
      const w = missionWorld(id, {});
      const force = w.mission.starting_force ?? [];
      const at = force.map((p, i) => ({ p, i })).filter(({ p }) => p.unit === MEDIC);
      expect(at).toHaveLength(1);
      expect(at[0].p.count ?? 1).toBe(1);
      expect(at[0].p.from_ledger).not.toBe(true);
      // Loan indices are into the RESOLVED force (a `gate_only` upgrade can drop a placement).
      const resolved = resolveUpgrades(w.mission, {}, gateOf).starting_force ?? [];
      const loaned = loanedPlacements(w.mission, {}, gateOf).map((i) => resolved[i].unit);
      expect(loaned.filter((u) => u === MEDIC)).toHaveLength(1);
      const evac = w.map.markers['wounded_evac'];
      expect(evac, 'wounded_evac marker').toBeDefined();
      const [x, y] = evac as readonly [number, number];
      expect(w.sim.blocked[y * w.map.width + x]).toBe(0);
    });
  }

  // A demotion assertion: when a left-out mission is re-solved and gets its medic, this goes red and
  // the name leaves `LEFT_OUT`, so the list cannot go stale.
  for (const [id, why] of Object.entries(LEFT_OUT)) {
    it(`${id} is still left out (${why})`, () => {
      const w = missionWorld(id, {});
      expect((w.mission.starting_force ?? []).some((p) => p.unit === MEDIC)).toBe(false);
    });
  }

  it('the tutorial fields no medic team and its map has no evacuation point', () => {
    const w = missionWorld(TUTORIAL, {});
    expect((w.mission.starting_force ?? []).some((p) => p.unit === MEDIC)).toBe(false);
    expect(w.map.markers['wounded_evac']).toBeUndefined();
  });
});
