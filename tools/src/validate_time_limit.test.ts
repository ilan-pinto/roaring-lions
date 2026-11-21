// #540: the time-limit rule. Its own module for the reason every validate_*.mjs is one:
// validate_data.mjs runs its whole sweep at import time and exits, so a test cannot import it.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { timeLimitFailures } from '../validate_time_limit.mjs';
import { applyOverlays, POSTURE_IDS } from '@lions/data';
import { missions } from '@lions/data/content';

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
  it('GH-1394 D6 / GH-1395 D13: an overlaid mission may go down to once its target, never below, and keeps the clearance', () => {
    expect(timeLimitFailures({ ...base, time_limit_s: 420 }, 'm', { overlaid: true })).toEqual([]);
    expect(timeLimitFailures({ ...base, time_limit_s: 419 }, 'm', { overlaid: true })).toHaveLength(1);
    // The authored rule is untouched: 420 is still under twice the target.
    expect(timeLimitFailures({ ...base, time_limit_s: 420 }, 'm')).toHaveLength(1);
    // The clearance holds for an overlaid run too: 300 s evacuation + 60 s > 359.
    expect(
      timeLimitFailures({ ...base, target_minutes: 5, time_limit_s: 359 }, 'm', { overlaid: true })
    ).toEqual(['m: time_limit_s 359 does not clear primary "evac"\'s 300 s clock by 60 s -- the mission would end by the limit instead of its own deadline']);
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
    ein_qasab_1_recon: 720, ein_qasab_2_foothold: 840, ein_qasab_3_buildup: 840,
    qasr_liwan_1_recon: 720, qasr_liwan_2_foothold: 840, qasr_liwan_3_buildup: 840,
    qasr_liwan_4_clearance: 840, qasr_liwan_5_subterranean: 840,
    bir_tarsha_1_recon: 720, bir_tarsha_2_foothold: 900, bir_tarsha_3_clearance: 720, bir_tarsha_4_clearance: 840, bir_tarsha_5_subterranean: 840,
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

describe('GH-1394: every shipped mission under every posture passes the overlaid clock rule', () => {
  const ids = Object.keys(missions) as (keyof typeof missions)[];
  it('covers the whole shipped list', () => {
    expect(ids.length).toBe(40); // Was 35 (30 before Qasr Liwan's five): Bir Tarsha I to V
  });
  for (const posture of POSTURE_IDS) {
    it.each(ids)(`%s at ${posture}`, (id) => {
      const m = applyOverlays(missions[id] as never, { posture }) as { time_limit_s?: number };
      expect(timeLimitFailures(m, id, { overlaid: true })).toEqual([]);
      // A posture never shortens the backstop (F-1: every shipped limit sits on the authored floor).
      expect(m.time_limit_s ?? 0).toBeGreaterThanOrEqual((missions[id] as { time_limit_s?: number }).time_limit_s ?? 0);
    });
  }
});
