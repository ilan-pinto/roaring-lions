// packages/app/src/ui/objective-reward.test.ts
import { describe, expect, it } from 'vitest';
import { CREDIT_WEIGHTS } from '@lions/sim';
import { rewardFor } from './objective-reward';

describe('rewardFor', () => {
  it('names nothing for a primary -- a primary is the mission, not a reward', () => {
    expect(rewardFor({ primary: true, carries: false, paysCredits: true })).toBeNull();
    expect(rewardFor({ primary: true, carries: true, paysCredits: true })).toBeNull();
  });

  it('a carrying secondary pays credits and the third star', () => {
    expect(rewardFor({ primary: false, carries: true, paysCredits: true })).toEqual({
      key: 'objective.reward.carries',
      params: { credits: CREDIT_WEIGHTS.carryingSecondary },
    });
  });

  // The tutorial produces no ledger keys, so `payMission` never runs for it
  // (main.ts gates on `mission.ledger.produces.length > 0`). Promising credits
  // there would be the screen telling the player something the code will not do.
  it('a carrying secondary on a mission that pays nothing names the star only', () => {
    expect(rewardFor({ primary: false, carries: true, paysCredits: false })).toEqual({
      key: 'objective.reward.carriesNoCredits',
      params: {},
    });
  });

  it('a non-carrying secondary says so rather than saying nothing', () => {
    expect(rewardFor({ primary: false, carries: false, paysCredits: true })).toEqual({
      key: 'objective.reward.none',
      params: {},
    });
  });

  // The number is not copied. It is the one the sim will actually pay.
  it('quotes the credit weight rather than a literal', () => {
    const r = rewardFor({ primary: false, carries: true, paysCredits: true });
    expect(r?.params.credits).toBe(CREDIT_WEIGHTS.carryingSecondary);
  });
});
