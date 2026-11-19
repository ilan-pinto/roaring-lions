// Bir Tarsha IV's escort tolerance (GH-1439, GH-1438): the four blades (tagged dozer_d9) must reach the far gate, and the mission is lost the
// tick TWO of them are gone (`fail_after_losses` 2). The harness asks of the hand-off (author-handoff.md section 4, item 3), each run through
// the real mission runtime with the shipped winning plan, and each with a control that makes the claim fail:
//   - the winning plan wins with all four blades;
//   - one blade lost at tick 0 still wins (the tolerance is real);
//   - two blades lost at tick 0 is a DEFEAT whose cause is the escort (`objective:blades`), not the clock or the ceiling;
//   - a naive attack-move of the whole force to the far gate loses the mission, and loses a blade on the way.
// The scenarios kill with `debugKill` at tick 0 (the repository's way to isolate a unit: kill it, never remove its entry).
import { describe, expect, it } from 'vitest';
import type { LedgerData } from '@lions/sim';
import { run, runLog, type Plan } from './backtest/playtest-run';
import { BIR_TARSHA_CHAIN, BIR_TARSHA_PLANS, M, bt4Plan } from './backtest/plans/bir_tarsha';

const ID = 'bir_tarsha_4_clearance';

/** The ledger the mission is played on: what the scripted plans of I, II and III produce, as `pnpm playtest` chains them. */
function ledger(): LedgerData {
  let led: LedgerData = {};
  for (const prior of BIR_TARSHA_CHAIN.slice(0, BIR_TARSHA_CHAIN.indexOf(ID))) led = { ...led, ...run(prior, BIR_TARSHA_PLANS[prior], led, 'victory', prior) };
  return led;
}

interface Outcome {
  result: string;
  cause: string | undefined;
  /** The fewest blades alive at any 5 s sample. */
  fewest: number;
}

/** Plays IV with `plan` after `kill` blades have been shot at tick 0. */
function play(led: LedgerData, plan: Plan, expectation: 'victory' | 'defeat', kill = 0): Outcome {
  let fewest = 4;
  const wrapped: Plan = (sim, rt, ids, at) => {
    at(0, () => {
      for (const id of ids('dozer_d9').slice(0, kill)) sim.debugKill(id);
    });
    for (let s = 0; s < 840; s += 5) at(s, () => { fewest = Math.min(fewest, ids('dozer_d9').filter((i) => sim.state.alive[i] === 1).length); });
    plan(sim, rt, ids, at);
  };
  run(ID, wrapped, led, expectation, `${ID} (blades test, kill ${kill})`);
  const r = runLog[runLog.length - 1];
  return { result: r.result, cause: r.cause, fewest };
}

describe('Bir Tarsha IV: the escort tolerance', () => {
  const led = ledger();
  it('the winning plan wins with all four blades', () => {
    const o = play(led, bt4Plan, 'victory');
    expect(o.result).toBe('victory');
    expect(o.fewest).toBe(4);
  }, 300_000);
  it('one blade lost at tick 0 still wins: the tolerance is real', () => {
    const o = play(led, bt4Plan, 'victory', 1);
    expect(o.fewest).toBeLessThanOrEqual(3);
    expect(o.result).toBe('victory');
  }, 300_000);
  it('two blades lost at tick 0 is a defeat, and the cause is the escort', () => {
    const o = play(led, bt4Plan, 'defeat', 2);
    expect(o.result).toBe('defeat');
    expect(o.cause).toBe('objective:blades');
  }, 300_000);
  it('a naive attack-move of the whole force to the far gate loses the mission, and a blade with it', () => {
    const naive: Plan = (sim, _rt, ids, at) => {
      at(0, () => {
        const all = [...ids('dozer_d9'), ...ids('ifv_namer'), ...ids('mbt_lavi'), ...ids('inf_squad'), ...ids('yahalom_squad'), ...ids('sniper_team')];
        sim.queueCommand({ kind: 'attackMove', ids: all, ...M(42.5, 26.5) });
      });
    };
    const o = play(led, naive, 'defeat');
    expect(o.result).toBe('defeat');
    expect(o.fewest).toBeLessThan(4);
  }, 300_000);
});
