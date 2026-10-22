// #540: the time-limit rule. Its own module for the reason every validate_*.mjs is one:
// validate_data.mjs runs its whole sweep at import time and exits, so a test cannot import it.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { timeLimitFailures } from '../validate_time_limit.mjs';

const ROOT = join(__dirname, '..', '..');
const base = {
  target_minutes: 7,
  time_limit_s: 840,
  objectives: [{ id: 'evac', type: 'evacuate_before', primary: true, seconds: 300 }],
};

describe('timeLimitFailures', () => {
  it('passes twice the target with every deadline cleared', () => {
    expect(timeLimitFailures(base, 'm')).toEqual([]);
  });
  it('refuses a mission with no limit', () => {
    expect(timeLimitFailures({ ...base, time_limit_s: undefined }, 'm')).toEqual([
      'm: declares no time_limit_s -- a stalled mission would never end (#540)',
    ]);
  });
  it('refuses a limit under twice the target, and reads the default target of 6', () => {
    expect(timeLimitFailures({ ...base, time_limit_s: 839 }, 'm')).toHaveLength(1);
    expect(timeLimitFailures({ ...base, target_minutes: undefined, time_limit_s: 719 }, 'm')).toHaveLength(1);
    expect(timeLimitFailures({ ...base, target_minutes: undefined, time_limit_s: 720 }, 'm')).toEqual([]);
  });
  it('refuses a limit that does not clear a primary deadline by 60 s, defaults included', () => {
    const late = { ...base, target_minutes: 5, time_limit_s: 600 };
    expect(timeLimitFailures({ ...late, objectives: [{ id: 'x', type: 'raze', primary: true, seconds: 541 }] }, 'm')).toHaveLength(1);
    expect(timeLimitFailures({ ...late, objectives: [{ id: 'x', type: 'raze', primary: true, seconds: 540 }] }, 'm')).toEqual([]);
    // The runtime's defaults: survive_until 60 s, evacuate_before 300 s.
    expect(timeLimitFailures({ ...late, time_limit_s: 600, objectives: [{ id: 'x', type: 'evacuate_before', primary: true }] }, 'm')).toEqual([]);
    expect(
      timeLimitFailures({ ...late, target_minutes: 1, time_limit_s: 359, objectives: [{ id: 'x', type: 'evacuate_before', primary: true }] }, 'm')
    ).toHaveLength(1);
  });
  it('ignores a secondary deadline and a hold clock', () => {
    const m = { ...base, objectives: [
      { id: 'a', type: 'raze', primary: false, seconds: 900 },
      { id: 'b', type: 'hold_for', primary: true, seconds: 900 },
    ] };
    expect(timeLimitFailures(m, 'm')).toEqual([]);
  });
});

describe('the shipped limits', () => {
  // Literals, not 120 * target re-derived: this is the table the plan measured on 13 Oct
  // (docs/superpowers/plans/2026-10-13-mission-time-limit.md). Raising one is a decision.
  const EXPECTED: Record<string, number> = {
    beit_sahwan_0_tutorial: 1440, beit_sahwan_breach: 600, beit_sahwan_1_recon: 840,
    beit_sahwan_2_foothold: 840, beit_sahwan_3_clearance: 840, beit_sahwan_4_subterranean: 720,
    wadi_halam_1_fords: 720, wadi_halam_2_laager: 840, wadi_halam_3_counterraid: 720,
    wadi_halam_4_village: 840, wadi_halam_5_depot: 840, khan_rafid_1_recon: 720,
    khan_rafid_2_foothold: 840, khan_rafid_3_clearance: 840, deir_amun_1_recon: 720,
    deir_amun_2_foothold: 840, deir_amun_3_subterranean: 840, tel_marum_1_recon: 840,
    tel_marum_2_foothold: 720, tel_marum_3_clearance: 840, qarn_hadid_1_recon: 720,
    qarn_hadid_2_foothold: 840, qarn_hadid_3_clearance: 840, umm_zeitoun_1_recon: 720,
    umm_zeitoun_2_buildup: 840, umm_zeitoun_3_clearance: 840, umm_zeitoun_4_clearance: 840,
  };
  const dir = join(ROOT, 'data/missions');
  const shipped = readdirSync(dir).filter((n) => n.endsWith('.json'));

  it('every shipped mission is in the table, and the table names nothing else', () => {
    expect(shipped.map((f) => f.replace('.json', '')).sort()).toEqual(Object.keys(EXPECTED).sort());
  });
  it.each(shipped)('%s declares its measured limit and passes the rule', (f) => {
    const m = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    expect(m.time_limit_s).toBe(EXPECTED[m.id]);
    expect(timeLimitFailures(m, f)).toEqual([]);
  });
});
