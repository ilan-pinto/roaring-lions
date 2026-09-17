import { describe, expect, it } from 'vitest';
import { gateSentence } from './gate-sentence';

const names = (id: string): string | undefined => ({ beit_sahwan_2_foothold: 'Foothold' })[id];

describe('gateSentence', () => {
  it('is null for no gate and for an open gate', () => {
    expect(gateSentence(undefined, {}, names)).toBeNull();
    expect(
      gateSentence(
        { afterMission: 'beit_sahwan_2_foothold' },
        { 'campaign.completed_missions': ['beit_sahwan_2_foothold'] },
        names
      )
    ).toBeNull();
  });
  it('names the mission, never its id', () => {
    expect(gateSentence({ afterMission: 'beit_sahwan_2_foothold' }, {}, names)).toBe('Clear Foothold first');
  });
  it('falls back to a neutral sentence when the mission is unknown to the catalogue', () => {
    expect(gateSentence({ afterMission: 'zz' }, {}, names)).toBe('Clear an earlier mission first');
  });
  it('speaks Conduct as a standing, not a number to reach', () => {
    expect(gateSentence({ roeMin: 35 }, {}, names)).toBe('Needs a campaign Conduct of 35 or better');
  });
  it('counts stars', () => {
    expect(gateSentence({ starsMin: 3 }, {}, names)).toBe('Needs 3 stars (you have 0)');
  });
  it('is null for a bought gate, regardless of what price or an earned field would otherwise say', () => {
    expect(gateSentence({ price: 600, bought: true }, {}, names)).toBeNull();
    expect(gateSentence({ roeMin: 90, price: 600, bought: true }, {}, names)).toBeNull();
  });
  it('speaks a price-only gate (D1, no earned field at all) as a Buy sentence', () => {
    expect(gateSentence({ price: 600 }, {}, names)).toBe('Buy for 600 credits');
  });
  it('keeps the binding earned sentence for a gate that is both priced and Conduct/stars/mission-gated', () => {
    expect(gateSentence({ roeMin: 40, price: 600 }, {}, names)).toBe('Needs a campaign Conduct of 40 or better');
    expect(gateSentence({ starsMin: 3, price: 600 }, {}, names)).toBe('Needs 3 stars (you have 0)');
    expect(gateSentence({ afterMission: 'beit_sahwan_2_foothold', price: 600 }, {}, names)).toBe('Clear Foothold first');
  });
});
