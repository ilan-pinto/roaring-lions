// GH-1395 slice 1: the report-only challenge reading's pure judgement, on literals.
import { describe, expect, it } from 'vitest';
import { challengeMissionIds, missions } from '@lions/data';
import { challengeLimit, challengeLine, tallyChallenge, winTerms } from './challenge-reading';

describe('tallyChallenge', () => {
  it('counts runs, wins and challenge wins; a missing seed is not a run; a loss that "met" is not a win', () => {
    const t = tallyChallenge([
      { result: 'victory', minutes: 6.5, challenge: { met: true } },
      { result: 'victory', minutes: 7.25, challenge: { met: false } },
      { result: 'defeat', minutes: 3, challenge: { met: true } },
      undefined,
      { result: 'victory', minutes: 5 },
    ]);
    expect(t).toEqual({ ran: 4, wins: 3, met: 1, slowestMin: 7.25, held: {} });
  });
  it('nothing ran: all zero', () => {
    expect(tallyChallenge([undefined, undefined])).toEqual({ ran: 0, wins: 0, met: 0, slowestMin: 0, held: {} });
  });
});

describe('tallyChallenge: the terms, counted on WINS only', () => {
  it('a term held on two of three wins reads 2; a term held on a loss is not counted; a term failing every win reads 0', () => {
    const terms = (hvt: boolean, lost: boolean) => [
      { term: 'lost_at_most' as const, held: lost },
      { term: 'objective_done' as const, held: hvt },
    ];
    const t = tallyChallenge([
      { result: 'victory', minutes: 4, challenge: { met: false, terms: terms(true, false) } },
      { result: 'victory', minutes: 4.2, challenge: { met: false, terms: terms(false, false) } },
      { result: 'victory', minutes: 4.1, challenge: { met: false, terms: terms(true, false) } },
      { result: 'defeat', minutes: 14, challenge: { met: false, terms: terms(true, true) } },
    ]);
    expect(t.held).toEqual({ lost_at_most: 0, objective_done: 2 });
    expect(t.wins).toBe(3);
  });
});

describe('winTerms', () => {
  it('prints each named term in the closed set\'s order, with its value', () => {
    expect(winTerms({ objective_done: 'hvt_seen' })).toEqual(['objective_done hvt_seen']);
    expect(winTerms({ objective_done: 'x', carries_all: true, ticks_at_most_target: true, lost_at_most: 0, conduct_at_least: 90 })).toEqual([
      'conduct_at_least 90',
      'lost_at_most 0',
      'ticks_at_most_target',
      'carries_all',
      'objective_done x',
    ]);
  });
});

describe('challengeLimit', () => {
  it('the amended limit at Standard is the authored one: no challenge moves the clock (the lead dropped Tight clock, PR 1524)', () => {
    expect(challengeLimit('beit_sahwan_2_foothold')).toBe(840);
    expect(challengeLimit('beit_sahwan_3_clearance')).toBe(840);
    expect(challengeLimit('beit_sahwan_4_subterranean')).toBe(720);
    expect(challengeLimit('beit_sahwan_breach')).toBe(600);
    expect(challengeLimit('khan_rafid_1_recon')).toBeUndefined();
    const authored = missions as unknown as Record<string, { time_limit_s?: number }>;
    expect(challengeMissionIds.length).toBe(6);
    for (const id of challengeMissionIds) expect(challengeLimit(id), id).toBe(authored[id]?.time_limit_s);
  });
});

describe('challengeLine', () => {
  it('names the challenge, its amendments, the counts and the limit, and says report only', () => {
    const line = challengeLine('beit_sahwan_2_foothold', 'beit_sahwan_2_foothold', { ran: 7, wins: 6, met: 2, slowestMin: 6.04, held: {} }, 8);
    expect(line).toBe(
      'challenge beit_sahwan_2_foothold quiet_souk [light_order, no_medic] {lost_at_most 0, ticks_at_most_target}: the plain plan wins 6/8 amended, beats the challenge on 2/8, slowest win 6.0 min of 840 s, 1 seed(s) with no run (report only)'
    );
  });
  it('Whole Picture: names its objective_done term and how often it held on the wins', () => {
    const line = challengeLine('beit_sahwan_1_recon', 'beit_sahwan_1_recon', { ran: 8, wins: 8, met: 5, slowestMin: 4.18, held: { objective_done: 5 } }, 8);
    expect(line).toBe(
      'challenge beit_sahwan_1_recon whole_picture [recon_no_drone] {objective_done hvt_seen}: the plain plan wins 8/8 amended, beats the challenge on 5/8 (held on wins: objective_done 5/8), slowest win 4.2 min of 840 s (report only)'
    );
  });
});
