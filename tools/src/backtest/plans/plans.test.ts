// The scripted plans in `plans/` are shared, not copied (GH-830).
//
// `wh_pacing.ts` once held a hand copy of the Wadi Halam plans. It drifted behind `playtest.ts` (it missed
// GH-421's 140 s screen order) and read Wadi Halam IV as a DEFEAT where `pnpm playtest` wins it, with
// nothing to say so but a banner. Neither `playtest.ts` nor `wh_pacing.ts` can be imported (each runs its
// whole script at import), so the guard has two halves, and a copy that drifts breaks at least one:
//
//   1. SOURCE. Each consumer takes its plan from `plans/` by name, and none keeps a local keyed table of
//      plan closures. This is what stops a copy being pasted back in.
//   2. BEHAVIOUR. `wh_pacing.ts` is run in a child process and its seed-424242 "xcheck" lines are held
//      against the same chain run through `playtest-run.ts`'s `run()`, the instrument `pnpm playtest`
//      uses: same plans, so the result, minutes, ROE, stars and credits must agree. This is what catches a
//      harness that has drifted, or a plan wrapped on the way in.
//
// Falsification (run when this was written, see the commit message): a one-line divergence in
// `wh_pacing.ts` turns the source half red, and a one-line change to its xcheck seed turns the behaviour
// half red with the source half still green.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LedgerData } from '@lions/sim';
import { ROOT } from '../../map_visibility';
import { missionCredits, run, runLog } from '../playtest-run';
import { firstLightPlan } from './beit_sahwan';
import { telMarum3Plan } from './tel_marum';
import {
  WADI_HALAM_CHAIN,
  WADI_HALAM_PLANS,
  wadiHalam1Plan,
  wadiHalam2Plan,
  wadiHalam3Plan,
  wadiHalam4Plan,
  wadiHalam5Plan,
} from './wadi_halam';

const BACKTEST = join(ROOT, 'tools/src/backtest');
const source = (rel: string): string => readFileSync(join(BACKTEST, rel), 'utf8');

describe('the shared plans: source', () => {
  it('the Wadi Halam table is the five exports, in chain order', () => {
    const named = [wadiHalam1Plan, wadiHalam2Plan, wadiHalam3Plan, wadiHalam4Plan, wadiHalam5Plan];
    expect(WADI_HALAM_CHAIN.map((id) => WADI_HALAM_PLANS[id])).toEqual(named);
    WADI_HALAM_CHAIN.forEach((id, k) => expect(WADI_HALAM_PLANS[id], id).toBe(named[k]));
  });

  it('playtest.ts runs every shared plan by name', () => {
    const src = source('playtest.ts');
    WADI_HALAM_CHAIN.forEach((id, k) => {
      expect(src, id).toMatch(new RegExp(`run\\(\\s*'${id}',\\s*wadiHalam${k + 1}Plan\\b`));
    });
    expect(src).toMatch(/run\(\s*'beit_sahwan_breach',\s*firstLightPlan\b/);
    expect(src).toMatch(/run\(\s*'tel_marum_3_clearance',\s*telMarum3Plan\b/);
    expect(src).toMatch(/from '\.\/plans\/wadi_halam'/);
  });

  it('wh_pacing.ts runs the Wadi Halam plans from plans/ and keeps no table of its own', () => {
    const src = source('wh_pacing.ts');
    expect(src).toMatch(/from '\.\/plans\/wadi_halam'/);
    expect(src).toMatch(/const OPTIMAL[^=]*= WADI_HALAM_PLANS;/);
    expect(src).toMatch(/const CHAIN = WADI_HALAM_CHAIN;/);
    // A pasted copy is a table keyed by mission id whose values are plan closures.
    expect(src).not.toMatch(/wadi_halam_\d_[a-z]+:\s*\(sim/);
  });

  it('fl_ladder.ts and enemy-production-probe.ts run the shared First Light and Tel Marum III plans', () => {
    expect(source('fl_ladder.ts')).toMatch(/firstLightPlan\(sim, rt, ids, at\)/);
    expect(source('fl_ladder.ts')).toMatch(/from '\.\/plans\/beit_sahwan'/);
    expect(source('enemy-production-probe.ts')).toMatch(/telMarum3Plan\(sim, rt, ids,/);
    expect(source('enemy-production-probe.ts')).toMatch(/from '\.\/plans\/tel_marum'/);
    expect(readFileSync(join(ROOT, 'tools/src/first_light_clock.test.ts'), 'utf8')).toMatch(/firstLightPlan\(sim, runtime, ids,/);
  });

  it('the plans are plain functions (a plan that is not callable would be a stub)', () => {
    for (const p of [firstLightPlan, telMarum3Plan, ...Object.values(WADI_HALAM_PLANS)]) expect(typeof p).toBe('function');
  });
});

describe('the shared plans: behaviour', () => {
  it("wh_pacing.ts's optimal rung reads what playtest-run reads at seed 424242, mission for mission", { timeout: 180_000 }, () => {
    // The instrument `pnpm playtest` uses, down the same chain: each mission on the ledger the last produced.
    // Not the seed-424242 default by accident: `PT_SEED` unset is 424242.
    expect(process.env.PT_SEED).toBeUndefined();
    const expected: string[] = [];
    let ledger: LedgerData = {};
    for (const id of WADI_HALAM_CHAIN) {
      ledger = run(id, WADI_HALAM_PLANS[id], ledger);
      const r = runLog[runLog.length - 1];
      expect(r.result, `${id} (a Wadi Halam plan lost: the comparison below would be of two defeats)`).toBe('victory');
      expected.push(`xcheck ${id}: ${r.result.toUpperCase()} in ${r.minutes.toFixed(1)} min, ROE ${r.roe}, stars ${r.stars}, credits ${missionCredits.get(id)}`);
    }
    expect(expected).toHaveLength(5);

    // wh_pacing.ts in a child (it runs its whole ladder at import), one seed: its xcheck lines come first.
    const tsx = join(ROOT, 'tools/node_modules/.bin/tsx');
    const child = spawnSync(tsx, [join(BACKTEST, 'wh_pacing.ts'), '1'], { cwd: join(ROOT, 'tools'), encoding: 'utf8', timeout: 150_000 });
    expect(child.status, child.stderr).toBe(0);
    const got = child.stdout
      .split('\n')
      .filter((l) => l.startsWith('xcheck '))
      .map((l) => l.replace(/, objectives .*$/, ''));
    expect(got).toEqual(expected);
  });
});
