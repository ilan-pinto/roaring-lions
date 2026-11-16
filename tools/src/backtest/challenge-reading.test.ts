// GH-1395 slice 1: the report-only challenge reading's pure judgement, on literals.
import { describe, expect, it } from 'vitest';
import { challengeLimit, challengeLine, tallyChallenge } from './challenge-reading';

describe('tallyChallenge', () => {
  it('counts runs, wins and challenge wins; a missing seed is not a run; a loss that "met" is not a win', () => {
    const t = tallyChallenge([
      { result: 'victory', minutes: 6.5, challenge: { met: true } },
      { result: 'victory', minutes: 7.25, challenge: { met: false } },
      { result: 'defeat', minutes: 3, challenge: { met: true } },
      undefined,
      { result: 'victory', minutes: 5 },
    ]);
    expect(t).toEqual({ ran: 4, wins: 3, met: 1, slowestMin: 7.25 });
  });
  it('nothing ran: all zero', () => {
    expect(tallyChallenge([undefined, undefined])).toEqual({ ran: 0, wins: 0, met: 0, slowestMin: 0 });
  });
});

describe('challengeLimit', () => {
  it('the amended limit at Standard: Quiet Souk is Tight clock, 840 to 630; Clean Sweep has no clock amendment', () => {
    expect(challengeLimit('beit_sahwan_2_foothold')).toBe(630);
    expect(challengeLimit('beit_sahwan_3_clearance')).toBe(840);
    expect(challengeLimit('khan_rafid_1_recon')).toBeUndefined();
  });
});

describe('challengeLine', () => {
  it('names the challenge, its amendments, the counts and the limit, and says report only', () => {
    const line = challengeLine('beit_sahwan_2_foothold', 'beit_sahwan_2_foothold', { ran: 7, wins: 6, met: 2, slowestMin: 6.04 }, 8);
    expect(line).toBe(
      'challenge beit_sahwan_2_foothold quiet_souk [tight_clock, light_order]: the plain plan wins 6/8 amended, beats the challenge on 2/8, slowest win 6.0 min of 630 s, 1 seed(s) with no run (report only)'
    );
  });
});
