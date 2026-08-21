// The shipped structure catalogue against the engine's protected-site
// threshold.
//
// `packages/sim` imports nothing, so it cannot see `data/structures.json`, and
// `demolition.test.ts` proves the mechanic against a fixture shrine it declares
// itself. That leaves the load-bearing fact unguarded: whether the buildings we
// actually ship sit on the side of PROTECTED_ROE their design intends. Tune the
// mosque's roe_penalty from 30 down to 18 and every protection silently lapses
// -- selectStructureTarget will fire on it, the demolition auto-search will eat
// it, selectBreachTarget will cut through it, and the app will fold it into a
// bulk right-click order -- with the entire suite still green.
//
// tools/ is the only place that may look at both, which is why this lives here.
import { describe, expect, it } from 'vitest';
import { structures } from '@lions/data';
import { PROTECTED_ROE } from '../../packages/sim/src/structures';

const types = structures as Record<string, { roe_penalty?: number }>;
const penalty = (id: string): number => types[id]?.roe_penalty ?? 0;

describe('protected sites in the shipped catalogue', () => {
  it('protects the mosque, the one building worth a third of an ROE budget', () => {
    expect(penalty('mosque')).toBeGreaterThanOrEqual(PROTECTED_ROE);
  });

  it('leaves ordinary buildings unprotected, so a raze objective stays playable', () => {
    // A raze or a breach has to be able to level these on a unit's own
    // initiative; protecting them would make demolition missions unwinnable
    // without hand-designating every structure.
    for (const id of ['house', 'warehouse', 'concrete', 'shanty', 'wall']) {
      expect(penalty(id)).toBeLessThan(PROTECTED_ROE);
    }
  });
});
