// Which starting-force placements are on loan, read off the SHIPPED data (GH-183 F3 Task 6, D5).
//
// packages/sim tests read no shipped JSON, so the feature's canonical case lives here:
// `wadi_halam_5_depot` on an empty ledger hands out a `dozer_d9` (Conduct 87) and a
// `demo_squad` (Conduct 77) that a fresh campaign has not earned. Its `ifv_namer` is
// `from_ledger` (the brigade's own body) and its `jeep_shoded` upgrades to `apc_kipod`
// (44 stars), which the empty ledger has not earned either, so the jeep is fielded: ungated,
// not on loan. Expected indices and ids are literals, not read back off the mission.
//
// The gate lookup is the harness's own (`kdfUnlockGate`, playtest-run.ts), which main.ts's
// version mirrors; the runtime half builds through `missionStage`, the app's own world.
import { describe, expect, it } from 'vitest';
import { units } from '@lions/data';
import { MissionRuntime, loanedPlacements, loanedReinforcements, resolveUpgrades, type UnlockGate } from '../../packages/sim/src';
import { missionStage } from './mission-harness';
import { kdfUnlockGate } from './backtest/playtest-run';

const gateOf = (id: string): UnlockGate | undefined => {
  const u = (units as Record<string, Parameters<typeof kdfUnlockGate>[0] | undefined>)[id];
  return u ? kdfUnlockGate(u) : undefined;
};

describe('wadi_halam_5_depot on an empty ledger', () => {
  const stage = missionStage('wadi_halam_5_depot');

  it('lends the D9 and the demolition squad, and nothing else', () => {
    const resolved = resolveUpgrades(stage.mission, {}, gateOf).starting_force ?? [];
    const loaned = loanedPlacements(stage.mission, {}, gateOf);
    expect(loaned).toEqual([4, 5]);
    expect(loaned.map((i) => resolved[i].unit)).toEqual(['dozer_d9', 'demo_squad']);
    // Not lent: the brigade's own ifv_namer, and the jeep, which stays a jeep_shoded (apc_kipod is closed on an empty ledger).
    expect(resolved.map((p) => p.unit)).toContain('ifv_namer');
    expect(resolved[6].unit).toBe('jeep_shoded');
  });

  it('the runtime answers isOnLoan for exactly those bodies', () => {
    const loaned = loanedPlacements(stage.mission, {}, gateOf);
    const resolved = resolveUpgrades(stage.mission, {}, gateOf);
    const rt = new MissionRuntime(stage.sim, resolved, { ...stage.context({}), loaned });
    rt.start();
    const byType = (name: string): number[] => {
      const t = stage.context({}).typeIdOf(name);
      const ids: number[] = [];
      for (let id = 0; id < stage.sim.entityCount; id++) {
        if (stage.sim.state.alive[id] === 1 && stage.sim.state.typeIdx[id] === t && stage.sim.state.side[id] === 0) ids.push(id);
      }
      return ids;
    };
    const d9 = byType('dozer_d9');
    const demo = byType('demo_squad');
    const namer = byType('ifv_namer');
    expect(d9.length).toBe(1);
    expect(demo.length).toBe(1);
    expect(namer.length).toBe(1);
    expect(rt.isOnLoan(d9[0])).toBe(true);
    expect(rt.isOnLoan(demo[0])).toBe(true);
    expect(rt.isOnLoan(namer[0])).toBe(false);
    // The jeep is fielded as itself (apc_kipod is closed) and is ungated: not on loan.
    const jeep = byType('jeep_shoded');
    expect(jeep.length).toBe(1);
    expect(rt.isOnLoan(jeep[0])).toBe(false);
  });

  // GH-801: the second demo_squad (trigger 1, placement 0) sits behind the same Conduct 77 gate as
  // the loaned starting one, and now goes back to the lender with it. Literals, not read off the data.
  it('lends the second engineer team too, until Conduct 77 is earned', () => {
    expect([...loanedReinforcements(stage.mission, {}, gateOf)]).toEqual(['1:0']);
    const earned = { 'roe.mission_ratings': { a: 77 } };
    expect([...loanedReinforcements(stage.mission, earned, gateOf)]).toEqual([]);
  });
});
