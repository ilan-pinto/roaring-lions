// GH-1394 slice 1: the shared overlay applier and the three postures as data.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { missions } from './index';
import {
  applyOps,
  applyOverlays,
  postureOps,
  postures,
  reliefTriggerIndices,
  POSTURE_IDS,
  RELIEF_TRIGGER_ID,
  type OverlayOp,
  type PostureId,
} from './overlays';

const ROOT = join(__dirname, '..', '..', '..');
type M = {
  id: string;
  ledger: { produces: readonly string[] };
  time_limit_s?: number;
  objectives: readonly { id: string; type: string; primary: boolean; carries?: boolean; seconds?: number }[];
  enemy?: { waves?: readonly { at_seconds: number; trigger?: string; units: readonly { unit: string; count: number; tag?: string }[] }[] };
  starting_force?: readonly unknown[];
  roe?: unknown;
  triggers?: readonly { id?: string; on: { kind: string; value?: number }; do: { kind: string; units?: readonly { unit: string; count: number }[] } }[];
};
const all = Object.values(missions) as unknown as M[];
const byId = (id: string): M => (missions as unknown as Record<string, M>)[id];
const at = (m: M, posture: PostureId): M => applyOverlays(m, { posture });

describe('the closed operation set', () => {
  it('the schema and the applier name the same operations (a new one is a change to both)', () => {
    const schema = JSON.parse(readFileSync(join(ROOT, 'data/schemas/overlay_ops.schema.json'), 'utf8'));
    const inSchema = (schema.$defs.op.oneOf as { properties: { op: { const: string } } }[]).map((o) => o.properties.op.const).sort();
    expect(inSchema).toEqual(['add_wave', 'reinforce_player', 'scale_time_limit', 'scale_waves', 'shift_waves', 'uncarry']);
    // Every one of them is handled: an op the switch does not know throws.
    expect(() => applyOps(byId('beit_sahwan_2_foothold'), [{ op: 'set_fail_below', value: 0 } as unknown as OverlayOp])).toThrow(/unknown operation/);
  });

  it('no posture names a field the designs keep out of reach (S2)', () => {
    const text = JSON.stringify(postures);
    for (const banned of ['fail_below', 'roe', 'tuning', 'ceiling', 'objective', '"tag"', 'starting_force', 'seconds_primary']) {
      expect(text.includes(banned), banned).toBe(false);
    }
  });
});

describe('Standard is the identity (S1)', () => {
  it.each(all.map((m) => m.id))('%s comes back by reference', (id) => {
    expect(at(byId(id), 'standard')).toBe(byId(id));
    expect(applyOverlays(byId(id), {})).toBe(byId(id));
  });
  it('the catalogue gives Standard no operations', () => {
    expect(postureOps('standard')).toEqual([]);
  });
});

describe('where a posture changes nothing, by literal (S12)', () => {
  // Recorded on main before the build (census in the design, F-3): the tutorial produces nothing (D12), and four
  // missions have no wave for Harder to push. Literals, never re-derived from the data.
  const IDENTITY: Record<PostureId, string[]> = {
    easier: ['beit_sahwan_0_tutorial'],
    standard: all.map((m) => m.id),
    harder: ['beit_sahwan_0_tutorial', 'beit_sahwan_1_recon', 'wadi_halam_2_laager', 'wadi_halam_4_village'],
  };
  for (const p of POSTURE_IDS) {
    it(`${p}: identity on exactly the recorded list`, () => {
      const same = all.filter((m) => at(m, p) === m).map((m) => m.id).sort();
      expect(same).toEqual([...IDENTITY[p]].sort());
    });
  }
});

describe('what Easier and Harder do, on Beit Sahwan II (literals read off the shipped file)', () => {
  const m = byId('beit_sahwan_2_foothold');
  it('the authored numbers this reads', () => {
    expect(m.time_limit_s).toBe(840);
    expect(m.enemy?.waves?.map((w) => w.at_seconds)).toEqual([45, 150, 260]);
    expect(m.enemy?.waves?.map((w) => w.units.map((u) => u.count))).toEqual([[2], [1, 2], [2, 1]]);
  });
  it('Easier: limit x5/4, wave bodies x3/4 with the remainder carried (never below 1 an entry) and 30 s later, one relief trigger at 90 s', () => {
    const e = at(m, 'easier');
    expect(e.time_limit_s).toBe(1050);
    expect(e.enemy?.waves?.map((w) => w.at_seconds)).toEqual([75, 180, 290]);
    // 8 wave bodies to 6: the running total is scaled, so a 2 can become a 1 (rounding each entry alone could not).
    expect(e.enemy?.waves?.map((w) => w.units.map((u) => u.count))).toEqual([[2], [1, 1], [1, 1]]);
    const relief = (e.triggers ?? []).filter((t) => t.id === RELIEF_TRIGGER_ID);
    expect(relief).toEqual([
      { id: RELIEF_TRIGGER_ID, on: { kind: 'timer_s', value: 90 }, do: { kind: 'reinforce', units: [{ unit: 'inf_squad', count: 1 }, { unit: 'inf_medic_squad', count: 1 }] } },
    ]);
    expect(reliefTriggerIndices(e)).toEqual([(e.triggers ?? []).length - 1]);
  });
  it('Harder: wave bodies x5/4 with the remainder carried and 15 s sooner; the limit as written', () => {
    const h = at(m, 'harder');
    expect(h.time_limit_s).toBe(840);
    expect(h.enemy?.waves?.map((w) => w.at_seconds)).toEqual([30, 135, 245]);
    // 8 wave bodies to 10; a grown entry keeps its count and its extra follows as its own entry at the same point.
    expect(h.enemy?.waves?.map((w) => w.units.map((u) => u.count))).toEqual([[2, 1], [1, 2], [2, 1, 1]]);
    expect(h.enemy?.waves?.[0].units).toEqual([m.enemy?.waves?.[0].units[0], { ...m.enemy?.waves?.[0].units[0], count: 1 }]);
    expect(reliefTriggerIndices(h)).toEqual([]);
  });
  it('across every shipped mission the wave bodies move by the ruled ratio, near enough (literal census)', () => {
    const bodies = (p: PostureId) =>
      all.reduce((n, x) => n + (at(x, p).enemy?.waves ?? []).reduce((k, w) => k + w.units.filter((u) => u.tag === undefined).reduce((j, u) => j + u.count, 0), 0), 0);
    // 175 authored; x3/4 floors at 1 an entry, so 143 rather than 131; x5/4 is 223 (219 exact, rounding half up per mission).
    expect([bodies('easier'), bodies('standard'), bodies('harder')]).toEqual([143, 175, 223]);
  });
  it('the earliest shipped wave (18 s) does not go below 0 under Harder', () => {
    expect(at(byId('beit_sahwan_breach'), 'harder').enemy?.waves?.[0].at_seconds).toBe(3);
  });
});

describe('what a posture never touches', () => {
  it.each(all.map((m) => m.id))('%s: starting force, Conduct, primaries’ clocks, objective ids and types, tagged counts', (id) => {
    const m = byId(id);
    for (const p of POSTURE_IDS) {
      const o = at(m, p);
      expect(o.starting_force).toBe(m.starting_force);
      expect(o.roe).toBe(m.roe);
      expect(o.objectives.map((x) => [x.id, x.type, x.primary, x.seconds])).toEqual(m.objectives.map((x) => [x.id, x.type, x.primary, x.seconds]));
      const tagged = (w: M) => (w.enemy?.waves ?? []).flatMap((x) => x.units.filter((u) => u.tag !== undefined).map((u) => [u.tag, u.count]));
      expect(tagged(o)).toEqual(tagged(m));
    }
  });
  it('the three missions with tagged wave units keep those counts under Easier and Harder (F-3)', () => {
    for (const id of ['wadi_halam_3_counterraid', 'ein_qasab_2_foothold', 'umm_zeitoun_2_buildup']) {
      const tags = (byId(id).enemy?.waves ?? []).flatMap((w) => w.units.filter((u) => u.tag !== undefined));
      expect(tags.length, id).toBeGreaterThan(0);
    }
  });
});

describe('Easier caps the grade at two stars: no secondary carries (D3, S5)', () => {
  it.each(all.map((m) => m.id))('%s', (id) => {
    expect(at(byId(id), 'easier').objectives.some((o) => o.carries === true)).toBe(false);
    // Harder and Standard leave every carry as written.
    expect(at(byId(id), 'harder').objectives.map((o) => o.carries)).toEqual(byId(id).objectives.map((o) => o.carries));
  });
});

describe('purity', () => {
  // Each op on its own (the mutation pass found an in-place shift_waves stayed green while the shipped postures
  // always copied the waves in scale_waves first).
  const one: OverlayOp[] = [
    { op: 'scale_time_limit', num: 5, den: 4 },
    { op: 'scale_waves', num: 5, den: 4, skip_tagged: true },
    { op: 'shift_waves', seconds: 30 },
    { op: 'reinforce_player', at_seconds: 90, label_key: 'k', units: [{ unit: 'inf_squad', count: 1 }] },
    { op: 'uncarry' },
    { op: 'add_wave', wave: { at_seconds: 1, units: [{ unit: 'sarim_rifles', count: 1 }] } },
  ];
  it.each(one.map((o) => o.op))('%s alone never mutates the authored JSON', (name) => {
    const op = one.find((o) => o.op === name) as OverlayOp;
    const before = JSON.stringify(missions);
    for (const m of all) applyOps(m, [op]);
    expect(JSON.stringify(missions)).toBe(before);
  });
  it('never mutates the authored JSON, and the same inputs give the same output', () => {
    const before = JSON.stringify(missions);
    const a = all.map((m) => JSON.stringify(at(m, 'easier')) + JSON.stringify(at(m, 'harder')));
    const b = all.map((m) => JSON.stringify(at(m, 'easier')) + JSON.stringify(at(m, 'harder')));
    expect(JSON.stringify(missions)).toBe(before);
    expect(a).toEqual(b);
  });
});

describe('a posture composes with amendments: the posture first, the amendments last (S13)', () => {
  const m = byId('beit_sahwan_2_foothold');
  const added = { at_seconds: 200, units: [{ unit: 'sarim_rifles', count: 4 }] };
  it('an amendment-added wave is not thinned or delayed by Easier', () => {
    const o = applyOverlays(m, { posture: 'easier', amendments: [[{ op: 'add_wave', wave: added }]] });
    expect(o.enemy?.waves?.at(-1)).toEqual(added);
    // ...and equals the two steps written out, in that order.
    expect(o).toEqual(applyOps(applyOps(m, postureOps('easier')), [{ op: 'add_wave', wave: added }]));
  });
  it('the order matters: the reverse order would thin the added wave', () => {
    const reversed = applyOps(applyOps(m, [{ op: 'add_wave', wave: added }]), postureOps('easier'));
    expect(reversed.enemy?.waves?.at(-1)).not.toEqual(added);
  });
  it('a tight clock amendment stacks on the posture, multiplied in that order', () => {
    const o = applyOverlays(m, { posture: 'easier', amendments: [[{ op: 'scale_time_limit', num: 3, den: 4 }]] });
    expect(o.time_limit_s).toBe(788); // ceil(ceil(840 * 5/4) * 3/4) = ceil(1050 * 3/4)
  });
});
