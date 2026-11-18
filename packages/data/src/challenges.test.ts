// GH-1395 slice 1: the amendment operations, the library, the pilot index and the challenge predicate. Literals read
// off the shipped files; nothing here re-derives a number the code under test computes.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { missions } from './content';
import { applyOps, applyOverlays, POSTURE_IDS, FAIL_BELOW_CEILING, type OverlayMission } from './overlays';
import {
  amendmentOps,
  amendments,
  betterMark,
  challengeArmed,
  challengeMet,
  challengeMissionIds,
  challengeOf,
  hasChallenge,
  missionChallenges,
  type ChallengeRun,
} from './challenges';

const ROOT = join(__dirname, '..', '..', '..');
type M = OverlayMission & {
  id: string;
  time_limit_s?: number;
  roe?: { fail_below?: number; enabled?: boolean };
  starting_force?: readonly { unit: string; count: number; tag?: string; from_ledger?: boolean }[];
  resources?: { logistics_start?: number; logistics_rate_per_min?: number; intel_start?: number; income_zones?: unknown[] };
};
const byId = (id: string): M => (missions as unknown as Record<string, M>)[id];
const all = Object.values(missions) as unknown as M[];

describe('the pilot (D9): six missions, one per phase, pinned to the directory', () => {
  it('the index is exactly the six, sorted', () => {
    expect(challengeMissionIds).toEqual([
      'beit_sahwan_1_recon',
      'beit_sahwan_2_foothold',
      'beit_sahwan_3_clearance',
      'beit_sahwan_4_subterranean',
      'beit_sahwan_breach',
      'umm_zeitoun_2_buildup',
    ]);
  });
  it('carries every per-mission file on disk (amendments.json is the library, not a mission)', () => {
    const onDisk = readdirSync(join(ROOT, 'data/challenges'))
      .filter((f) => f.endsWith('.json') && f !== 'amendments.json')
      .map((f) => JSON.parse(readFileSync(join(ROOT, 'data/challenges', f), 'utf8')).mission as string)
      .sort();
    expect([...challengeMissionIds].sort()).toEqual(onDisk);
  });
  it('the coin rules\' index (challenge-ids.ts, kept off the entry chunk) is the catalogue\'s, mission for mission', () => {
    expect(challengeMissionIds).toEqual(missionChallenges.map((c) => c.mission));
    for (const c of missionChallenges) expect(hasChallenge(c.mission)).toBe(true);
  });
  it('one per phase: breach, recon, foothold, buildup, clearance, subterranean', () => {
    const phases = challengeMissionIds.map((id) => (byId(id) as unknown as { phase: string }).phase).sort();
    expect(phases).toEqual(['breach', 'buildup', 'clearance', 'foothold', 'recon', 'subterranean']);
  });
  it('three offers each (D8), and the challenge needs only offered ones', () => {
    for (const c of missionChallenges) {
      expect(c.offers.length, c.mission).toBe(3);
      for (const a of c.challenge.amendments) expect(c.offers, c.mission).toContain(a);
    }
  });
  it('hasChallenge reads the index', () => {
    expect(hasChallenge('beit_sahwan_2_foothold')).toBe(true);
    expect(hasChallenge('khan_rafid_1_recon')).toBe(false);
    expect(hasChallenge('beit_sahwan_0_tutorial')).toBe(false);
  });
});

describe('C1: no amendments is the identity, by reference, at every posture', () => {
  it.each(all.map((m) => m.id))('%s', (id) => {
    const m = byId(id);
    // Standard and no amendments: the mission itself. Easier and Harder: exactly the posture's own mission.
    expect(applyOverlays(m, { amendments: amendmentOps([], id) })).toBe(m);
    expect(applyOverlays(m, { posture: 'standard', amendments: amendmentOps([]) })).toBe(m);
    for (const p of POSTURE_IDS) {
      expect(applyOverlays(m, { posture: p, amendments: amendmentOps([]) })).toStrictEqual(applyOverlays(m, { posture: p }));
    }
  });
});

describe('the amendment operations, on literals read off the shipped files', () => {
  it('raise_fail_below: Beit Sahwan III 40 to 50; a mission with no fail_below is left alone; never past 80', () => {
    expect(byId('beit_sahwan_3_clearance').roe?.fail_below).toBe(40);
    expect(applyOps(byId('beit_sahwan_3_clearance'), [{ op: 'raise_fail_below', by: 10 }]).roe?.fail_below).toBe(50);
    expect(byId('beit_sahwan_2_foothold').roe?.fail_below).toBeUndefined();
    expect(applyOps(byId('beit_sahwan_2_foothold'), [{ op: 'raise_fail_below', by: 10 }])).toBe(byId('beit_sahwan_2_foothold'));
    expect(FAIL_BELOW_CEILING).toBe(80);
    const high = { ...byId('beit_sahwan_3_clearance'), roe: { enabled: true, fail_below: 75 } };
    expect(applyOps(high, [{ op: 'raise_fail_below', by: 10 }]).roe?.fail_below).toBe(80);
    const top = { ...byId('beit_sahwan_3_clearance'), roe: { enabled: true, fail_below: 80 } };
    expect(applyOps(top, [{ op: 'raise_fail_below', by: 10 }])).toBe(top);
  });
  it('remove_starting: from the last untagged placement; a placement brought to 0 is dropped', () => {
    const bs2 = byId('beit_sahwan_2_foothold');
    const rifles = (m: M) => (m.starting_force ?? []).filter((p) => p.unit === 'inf_squad').map((p) => p.count);
    expect(rifles(bs2)).toEqual([2]);
    const cut = applyOps(bs2, [{ op: 'remove_starting', unit: 'inf_squad', count: 1 }]);
    expect(rifles(cut)).toEqual([1]);
    expect((cut.starting_force ?? []).length).toBe((bs2.starting_force ?? []).length);
    // First Light fields four single rifle squads: the LAST one goes, whole.
    const breach = byId('beit_sahwan_breach');
    expect(rifles(breach)).toEqual([1, 1, 1, 1]);
    const b = applyOps(breach, [{ op: 'remove_starting', unit: 'inf_squad', count: 1 }]);
    expect(rifles(b)).toEqual([1, 1, 1]);
    expect((b.starting_force ?? []).length).toBe((breach.starting_force ?? []).length - 1);
    expect(b.starting_force?.slice(0, 3)).toEqual(breach.starting_force?.slice(0, 3));
  });
  it('remove_starting never takes a tagged placement, and throws when there is not enough to take', () => {
    const m = { ...byId('beit_sahwan_2_foothold'), starting_force: [{ unit: 'inf_squad', count: 2, tag: 'blades' }, { unit: 'inf_squad', count: 1 }] };
    expect(applyOps(m, [{ op: 'remove_starting', unit: 'inf_squad', count: 1 }]).starting_force).toEqual([{ unit: 'inf_squad', count: 2, tag: 'blades' }]);
    expect(() => applyOps(m, [{ op: 'remove_starting', unit: 'inf_squad', count: 2 }])).toThrow(/untagged inf_squad/);
  });
  it('scale_resources: Beit Sahwan II 400 + 120/min to 200 + 60/min, income zones untouched', () => {
    const bs2 = byId('beit_sahwan_2_foothold');
    // The held-ground zone is dev's (GH-1386 batch 3); the purse halves, the zone's own rate does not.
    const zones = [{ zone: 'terrace_crest', rate_per_min: 48 }];
    expect(bs2.resources).toEqual({ logistics_start: 400, logistics_rate_per_min: 120, income_zones: zones });
    const halved = applyOps(bs2, [{ op: 'scale_resources', num: 1, den: 2 }]).resources;
    expect(halved).toEqual({ logistics_start: 200, logistics_rate_per_min: 60, income_zones: zones });
    expect(halved?.income_zones).toBe(bs2.resources?.income_zones);
    const uz2 = byId('umm_zeitoun_2_buildup');
    const r = applyOps(uz2, [{ op: 'scale_resources', num: 1, den: 2 }]).resources;
    expect([r?.logistics_start, r?.logistics_rate_per_min, r?.intel_start]).toEqual([250, 75, 150]);
    expect(r?.income_zones).toBe(uz2.resources?.income_zones);
    // Rounded DOWN: 3/4 of 150 is 112.5, paid as 112.
    expect(applyOps(uz2, [{ op: 'scale_resources', num: 3, den: 4 }]).resources?.logistics_rate_per_min).toBe(112);
    expect(applyOps(byId('beit_sahwan_breach'), [{ op: 'scale_resources', num: 1, den: 2 }])).toBe(byId('beit_sahwan_breach'));
  });
  it('set_intel_start: Umm Zeitoun II 150 to 0; only ever down; absent is left alone', () => {
    const uz2 = byId('umm_zeitoun_2_buildup');
    expect(uz2.resources?.intel_start).toBe(150);
    expect(applyOps(uz2, [{ op: 'set_intel_start', value: 0 }]).resources?.intel_start).toBe(0);
    expect(applyOps(uz2, [{ op: 'set_intel_start', value: 500 }])).toBe(uz2);
    expect(applyOps(byId('beit_sahwan_2_foothold'), [{ op: 'set_intel_start', value: 0 }])).toBe(byId('beit_sahwan_2_foothold'));
  });
});

describe('amendmentOps', () => {
  it('library order, duplicates dropped: one set of ids is one mission (D10)', () => {
    const ab = amendmentOps(['light_order', 'no_medic'], 'beit_sahwan_2_foothold');
    const ba = amendmentOps(['no_medic', 'light_order', 'no_medic'], 'beit_sahwan_2_foothold');
    expect(ba).toEqual(ab);
    expect(ab.length).toBe(2);
    expect(ab[0]).toBe(amendments.amendments.find((a) => a.id === 'light_order')?.ops);
    expect(ab[1]).toBe(amendments.amendments.find((a) => a.id === 'no_medic')?.ops);
  });
  it('a mission-specific amendment (D8) is known only to its mission: First Light without the jeep', () => {
    const breach = byId('beit_sahwan_breach');
    const jeeps = (m: M) => (m.starting_force ?? []).filter((p) => p.unit === 'jeep_shoded').length;
    expect(jeeps(breach)).toBe(1);
    expect(jeeps(applyOverlays(breach, { amendments: amendmentOps(['breach_no_jeep'], 'beit_sahwan_breach') }))).toBe(0);
    expect(() => amendmentOps(['breach_no_jeep'])).toThrow(/no amendment/);
    expect(() => amendmentOps(['breach_no_jeep'], 'beit_sahwan_2_foothold')).toThrow(/no amendment/);
  });
  it('refuses an unknown id and an id the mission does not offer', () => {
    expect(() => amendmentOps(['double_pay'])).toThrow(/no amendment/);
    expect(() => amendmentOps(['no_eyes'], 'beit_sahwan_2_foothold')).toThrow(/does not offer/);
    expect(() => amendmentOps(['light_order'], 'khan_rafid_1_recon')).toThrow(/does not offer/);
    // The lead dropped Tight clock (PR 1524): it is no longer an amendment anywhere.
    expect(() => amendmentOps(['tight_clock'])).toThrow(/no amendment/);
  });
});

describe('every offer bites on its mission (an offer that changes nothing would be a lie on the deploy screen)', () => {
  it.each(missionChallenges.map((c) => c.mission))('%s', (id) => {
    const c = challengeOf(id);
    for (const a of c?.offers ?? []) {
      expect(applyOverlays(byId(id), { amendments: amendmentOps([a], id) }), `${id} ${a}`).not.toBe(byId(id));
    }
  });
});

describe('C7: the predicate, on the stored row, at its boundaries', () => {
  const run = (o: Partial<ChallengeRun>): ChallengeRun => ({ roe: 100, ticks: 0, lost: 0, carriesAll: true, ...o });
  it('lost_at_most 0 is met by 0 and not by 1', () => {
    expect(challengeMet({ lost_at_most: 0 }, run({ lost: 0 }), 7)).toBe(true);
    expect(challengeMet({ lost_at_most: 0 }, run({ lost: 1 }), 7)).toBe(false);
    expect(challengeMet({ lost_at_most: 2 }, run({ lost: 2 }), 7)).toBe(true);
    expect(challengeMet({ lost_at_most: 2 }, run({ lost: 3 }), 7)).toBe(false);
  });
  it('ticks_at_most_target: 7 minutes is 8400 ticks, met at 8400 and not at 8401', () => {
    expect(challengeMet({ ticks_at_most_target: true }, run({ ticks: 8400 }), 7)).toBe(true);
    expect(challengeMet({ ticks_at_most_target: true }, run({ ticks: 8401 }), 7)).toBe(false);
    expect(challengeMet({ ticks_at_most_target: true }, run({ ticks: 6000 }), 5)).toBe(true);
    expect(challengeMet({ ticks_at_most_target: true }, run({ ticks: 6001 }), 5)).toBe(false);
  });
  it('conduct_at_least 80 is met by 80 and not by 79', () => {
    expect(challengeMet({ conduct_at_least: 80 }, run({ roe: 80 }), 7)).toBe(true);
    expect(challengeMet({ conduct_at_least: 80 }, run({ roe: 79 }), 7)).toBe(false);
  });
  it('carries_all reads the flag', () => {
    expect(challengeMet({ carries_all: true }, run({ carriesAll: true }), 7)).toBe(true);
    expect(challengeMet({ carries_all: true }, run({ carriesAll: false }), 7)).toBe(false);
  });
  it('every named field must hold', () => {
    const win = { lost_at_most: 0, ticks_at_most_target: true as const };
    expect(challengeMet(win, run({ lost: 0, ticks: 8400 }), 7)).toBe(true);
    expect(challengeMet(win, run({ lost: 1, ticks: 8400 }), 7)).toBe(false);
    expect(challengeMet(win, run({ lost: 0, ticks: 8401 }), 7)).toBe(false);
  });
});

describe('D7: armed when every named amendment is on; extras allowed', () => {
  const c = challengeOf('beit_sahwan_2_foothold');
  it('Quiet Souk needs light_order and no_medic', () => {
    if (c === undefined) throw new Error('no Beit Sahwan II challenge');
    expect(c.challenge.amendments).toEqual(['light_order', 'no_medic']);
    expect(challengeArmed(c, ['light_order', 'no_medic'])).toBe(true);
    expect(challengeArmed(c, ['no_medic', 'light_order', 'thin_purse'])).toBe(true);
    expect(challengeArmed(c, ['no_medic'])).toBe(false);
    expect(challengeArmed(c, [])).toBe(false);
  });
});

describe('betterMark: faster, then higher Conduct', () => {
  it('orders by ticks, then roe', () => {
    expect(betterMark({ id: 'x', roe: 50, ticks: 100, lost: 0 }, { id: 'x', roe: 90, ticks: 101, lost: 0 })).toBe(true);
    expect(betterMark({ id: 'x', roe: 90, ticks: 100, lost: 0 }, { id: 'x', roe: 80, ticks: 100, lost: 0 })).toBe(true);
    expect(betterMark({ id: 'x', roe: 80, ticks: 100, lost: 0 }, { id: 'x', roe: 80, ticks: 100, lost: 0 })).toBe(false);
  });
});
