import { describe, expect, it } from 'vitest';
import { ZONE_CONTESTED, ZONE_EMPTY } from '@lions/sim';
import { ZONE_STATE_CONTESTED, pointsViewOf, type PointsRuntime, type PointsRules } from './points-view';

const RULES: PointsRules = { target: 600, zones: [{ zone: 'ford', per_min: 30 }, { zone: 'tell', per_min: 20 }, { zone: 'knoll', per_min: 10 }, { zone: 'mill', per_min: 5 }] };
/** Four zones: side 0 holds the ford, side 1 the tell, the knoll is fought over, the mill is empty. */
const RT: PointsRuntime = {
  scoreOf: (side) => (side === 0 ? 210 : 175),
  incomeZones: [
    { zone: 'ford', rect: [20, 20, 8, 8], state: 0, holder: 0 },
    { zone: 'tell', rect: [6, 6, 10, 10], state: 1, holder: 1 },
    { zone: 'knoll', rect: [9, 23, 7, 7], state: ZONE_CONTESTED, holder: -1 },
    { zone: 'mill', rect: [1, 1, 3, 3], state: ZONE_EMPTY, holder: -1 },
    { zone: 'unlisted', rect: [0, 0, 1, 1], state: 0, holder: 0 },   // a zone the rules do not name is not on the board
  ],
};

describe('pointsViewOf (GH-976 P2)', () => {
  it('reads both scores, the target, each zone\'s holder and what each side\'s zones pay a minute, from the viewer\'s side', () => {
    expect(pointsViewOf(RT, RULES, 0)).toEqual({
      target: 600, mine: 210, theirs: 175, mineRate: 30, theirsRate: 20,
      zones: [
        { zone: 'ford', at: [20, 20, 8, 8], perMin: 30, holder: 'mine' },
        { zone: 'tell', at: [6, 6, 10, 10], perMin: 20, holder: 'theirs' },
        { zone: 'knoll', at: [9, 23, 7, 7], perMin: 10, holder: 'contested' },
        { zone: 'mill', at: [1, 1, 3, 3], perMin: 5, holder: 'none' },
      ],
    });
  });

  it('the other seat reads the same board from its own side: mine and theirs swap, nothing else moves', () => {
    const a = pointsViewOf(RT, RULES, 0);
    const b = pointsViewOf(RT, RULES, 1);
    expect([b.mine, b.theirs, b.mineRate, b.theirsRate]).toEqual([a.theirs, a.mine, a.theirsRate, a.mineRate]);
    const flip = { mine: 'theirs', theirs: 'mine', contested: 'contested', none: 'none' } as const;
    expect(b.zones.map((z) => z.holder)).toEqual(a.zones.map((z) => flip[z.holder]));
    expect(b.zones.map((z) => z.zone)).toEqual(a.zones.map((z) => z.zone));
  });

  it('a contested zone pays nobody, whatever holder the runtime last wrote', () => {
    const rt: PointsRuntime = { ...RT, incomeZones: [{ zone: 'knoll', rect: [9, 23, 7, 7], state: ZONE_CONTESTED, holder: 0 }] };
    const v = pointsViewOf(rt, RULES, 0);
    expect(v.zones.map((z) => z.holder)).toEqual(['contested']);
    expect([v.mineRate, v.theirsRate]).toEqual([0, 0]);
  });

  it('restates the sim\'s contested state, and that is pinned to it', () => {
    expect(ZONE_STATE_CONTESTED).toBe(ZONE_CONTESTED);
    expect(ZONE_STATE_CONTESTED).toBe(-2);
  });
});
