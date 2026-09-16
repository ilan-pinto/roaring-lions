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
});
