// @vitest-environment jsdom
//
// The "Next: ..." button hides on `campaign-close.ts`'s definition of a
// finished campaign, not a second one of its own: with `campaignComplete`
// forced true the button is gone even on an empty ledger, where the next
// open mission would otherwise be named. (Falsified by dropping the
// `campaignComplete(...) ?` clause in `showCampaign`.)
import { describe, expect, it, vi } from 'vitest';

vi.mock('../campaign-close', async (orig) => ({
  ...(await orig<typeof import('../campaign-close')>()),
  campaignComplete: () => true,
}));

import worldJson from '../../../../data/campaign/world.json';
import countriesJson from '../../../../data/campaign/countries.json';
import { parseCountries, parseWorld } from '../campaign';
import { showCampaign } from './menu';

describe('the next-operation button', () => {
  it('is hidden whenever campaign-close says the campaign is complete', () => {
    const stage = document.createElement('div');
    showCampaign(stage, { base: '/', world: parseWorld(worldJson), countries: parseCountries(countriesJson), ledger: {} });
    expect(stage.querySelector('[data-kind="primary"]')).toBeNull();
    expect(stage.querySelector('[data-kind="back"]')).not.toBeNull();
  });
});
