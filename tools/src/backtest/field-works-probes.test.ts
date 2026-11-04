// GH-277 Task 14: the §9 probes as tests. Each runs the probe on its fixed seeds and asserts the spec's band, which is
// fixed at G-NUM and never widened here. The recorded probes (`fw-workshop-pk`, `fw-op-saddle`) assert only what
// must stay true; their numbers live in docs/campaign/field_works/probes.md.
import { describe, expect, it } from 'vitest';
import { urbanBandPass } from './targets';
import { units } from './harness';
import {
  PROBES, HEAVY_RAID, LIGHT_RAID, raid, seeds, rate, medicLullPasses, destroyedStaysDead, buffedMilitia,
  urbanGarrisoned,
} from './field-works-probes';

const run = (id: string) => {
  const probe = PROBES.find(([name]) => name === id);
  if (probe === undefined) throw new Error(`no probe ${id}`);
  return probe[1]();
};

describe('the §9 probes (bands fixed at G-NUM)', () => {
  for (const id of ['fw-garrison-supp', 'fw-outpost-raid', 'fw-fp-assault', 'fw-medic-lull', 'fw-urban-garrisoned', 'fw-workshop-pk']) {
    it(id === 'fw-medic-lull' ? 'fw-medic-lull (recorded ceiling, not a gate on the station)' : id === 'fw-outpost-raid' ? 'fw-outpost-raid (HP only)' : id, () => {
      const r = run(id);
      expect(r.measured).not.toBe('');
      expect(r.pass, `${r.id}: ${r.measured}`).toBe(true);
    }, 600000);
  }
});

describe('the probes can fail', () => {
  it('the heavy raid is heavier than the light one: it holds less often', () => {
    const heavy = rate(seeds(101, 10).map((s) => raid(s, 'kdf_outpost', 3, HEAVY_RAID).held));
    const light = rate(seeds(101, 10).map((s) => raid(s, 'kdf_outpost', 3, LIGHT_RAID).held));
    expect(heavy).toBeLessThan(light);
  }, 300000);
  it('the medic band reads false for a lull (2:1 at 90%) and for a flat curve (2:1 within 15 pp of 3:1)', () => {
    expect(medicLullPasses({ '1:1': 0, '2:1': 0.9, '3:1': 1 })).toBe(false);
    expect(medicLullPasses({ '1:1': 0, '2:1': 0.7, '3:1': 0.8 })).toBe(false);
    expect(medicLullPasses({ '1:1': 0, '2:1': 0.7, '3:1': 1 })).toBe(true);
  });
  it('militia with 3x the hp and damage break the 5.7 urban band (fw-urban-garrisoned can fail): 3:1 reads 5%', () => {
    const base = units.militia_cell;
    const tough = { ...base, hull: { ...base.hull, hp: base.hull.hp * 3 }, weapons: base.weapons.map((w) => ({ ...w, damage: w.damage * 3 })) };
    const r = urbanGarrisoned(tough, 20);
    expect(urbanBandPass(r)).toBe(false);
    expect(r['3:1']).toBeLessThan(0.65);
  }, 600000);
  it('the stand-in bonus is the data x1.06, capped at ONE', () => {
    const base = buffedMilitia(1);
    const six = buffedMilitia();
    expect(six.weapons[0].accuracy).toBeCloseTo(Math.min(1, base.weapons[0].accuracy * 1.06), 10);
    expect(buffedMilitia(10).weapons[0].accuracy).toBe(1);
  });
  it('a destroyed hull stays destroyed beside a workshop', () => {
    expect(destroyedStaysDead()).toBe(true);
  });
});
