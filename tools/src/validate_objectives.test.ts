// GH-2 and GH-4: the authoring-time objective checks, on literal fixtures (each rule seen red) and on the shipped tree.
// The sim-guard review of PR 1240 noted that the starts-inside mirror had no test of its own: a mutation of it stayed green.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { objectiveFailures } from '../validate_objectives.mjs';

const map = { zones: { dest: [20, 2, 5, 7], other: [0, 0, 3, 3] } };
type Obj = Record<string, unknown>;
const hold: Obj = { id: 'hold', type: 'survive_until', primary: true, seconds: 60 };
const escort = (extra: Obj = {}): Obj => ({ id: 'vip', type: 'escort', primary: true, target: 'vip', zone: 'dest', ...extra });
const ceiling = (extra: Obj = {}): Obj => ({ id: 'clean', type: 'no_collateral_above', primary: false, threshold: 30, ...extra });
const force = (...p: Obj[]): Obj[] => p;
/** Failures for objective `o` in a mission with `rest` as its other objectives and `m` as the other mission fields. */
const run = (o: Obj, rest: Obj[] = [hold], m: Obj = {}): string[] =>
  objectiveFailures(o, { id: 'fx', starting_force: force({ unit: 'u', count: 1, at: [3, 5], tag: 'vip' }), objectives: [o, ...rest], ...m }, map, 'fx.json');

describe('escort', () => {
  it('passes a tagged unit that starts outside a known zone', () => {
    expect(run(escort())).toEqual([]);
  });
  it('refuses an unknown or missing zone', () => {
    expect(run(escort({ zone: 'nowhere' }))).toEqual(['fx.json: escort "vip" references unknown zone "nowhere"']);
    expect(run(escort({ zone: undefined }))).toHaveLength(1);
  });
  it('refuses a tag no starting_force placement carries, or none at all', () => {
    expect(run(escort({ target: 'nobody' }))[0]).toContain('needs a tag on a starting_force placement');
    expect(run(escort({ target: undefined }))[0]).toContain('needs a tag on a starting_force placement');
  });
  it('refuses a single unit that starts on a tile inside the zone: it would complete on the first tick', () => {
    const m = { starting_force: force({ unit: 'u', count: 1, at: [21, 5], tag: 'vip' }) };
    expect(run(escort(), [hold], m)).toEqual(['fx.json: escort "vip" starts inside zone "dest", so it would complete on the first tick']);
  });
  it('holds the starts-inside edges exactly: the corner tiles are inside, the tile beyond each side is not', () => {
    const at = (x: number, y: number) => run(escort(), [hold], { starting_force: force({ unit: 'u', count: 1, at: [x, y], tag: 'vip' }) });
    for (const [x, y] of [[20.5, 2.5], [24.5, 2.5], [20.5, 8.5], [24.5, 8.5]]) expect(at(x, y), `(${x}, ${y})`).toHaveLength(1);
    for (const [x, y] of [[19.5, 5.5], [25.5, 5.5], [22.5, 1.5], [22.5, 9.5]]) expect(at(x, y), `(${x}, ${y})`).toEqual([]);
  });
  it('does not flag what only the runtime can judge: a larger placement, or one tagged unit inside and one outside', () => {
    expect(run(escort(), [hold], { starting_force: force({ unit: 'u', count: 3, at: [21, 5], tag: 'vip' }) })).toEqual([]);
    expect(
      run(escort(), [hold], { starting_force: force({ unit: 'u', count: 1, at: [21, 5], tag: 'vip' }, { unit: 'u', count: 1, at: [3, 5], tag: 'vip' }) }),
    ).toEqual([]);
  });
  it('refuses a zone on any other type', () => {
    expect(run({ ...hold, zone: 'dest' }, [])).toEqual(['fx.json: objective "hold" is a survive_until, which takes no zone (only escort does)']);
  });
});

describe('escort through the work (GH-1439): R1 to R7, the same literals the runtime refuses', () => {
  const work: Obj = { id: 'work', type: 'raze', primary: true, target: 'dest', seconds: 300 };
  const four = { starting_force: force({ unit: 'u', count: 4, at: [3, 5], tag: 'vip' }) };
  it('passes a well-formed escort with both fields', () => {
    expect(run(escort({ fail_after_losses: 2, until: ['work'] }), [work], four)).toEqual([]);
    expect(run(escort({ fail_after_losses: 4 }), [hold], four)).toEqual([]);
  });
  it('R1: neither field belongs to any other type', () => {
    expect(run({ ...work, fail_after_losses: 1 }, [hold])).toEqual(['fx.json: objective "work" is a raze, which takes no fail_after_losses (only escort does)']);
    expect(run({ ...work, until: ['hold'] }, [hold])).toEqual(['fx.json: objective "work" is a raze, which takes no until (only escort does)']);
  });
  it('R2: fail_after_losses is a whole number of at least 1', () => {
    for (const v of [0, -1, 1.5, '2']) {
      expect(run(escort({ fail_after_losses: v }), [hold], four), String(v)).toEqual([`fx.json: escort "vip" needs a whole fail_after_losses of at least 1, not ${String(v)}`]);
    }
  });
  it('R3: fail_after_losses cannot exceed the units tagged, counted over placements and passengers', () => {
    expect(run(escort({ fail_after_losses: 5 }), [hold], four)).toEqual(['fx.json: escort "vip" fail_after_losses 5 cannot exceed the 4 units tagged "vip"']);
    const split = { starting_force: force({ unit: 'u', count: 2, at: [3, 5], tag: 'vip' }, { unit: 'u', count: 1, at: [3, 8], tag: 'vip' }, { unit: 'v', count: 3, at: [3, 9] }) };
    expect(run(escort({ fail_after_losses: 3 }), [hold], split)).toEqual([]);
    expect(run(escort({ fail_after_losses: 4 }), [hold], split)).toEqual(['fx.json: escort "vip" fail_after_losses 4 cannot exceed the 3 units tagged "vip"']);
    // a tagged carrier with tagged passengers: 1 + 2 = 3 (the validator's older "needs a tag on a placement" check still wants the
    // placement itself tagged, which a passengers-only tag does not satisfy; that is the existing behaviour and not this slice's)
    const carried = { starting_force: force({ unit: 'c', count: 1, at: [3, 5], tag: 'vip', passengers: [{ unit: 'r', count: 2, tag: 'vip' }] }) };
    expect(run(escort({ fail_after_losses: 3 }), [hold], carried)).toEqual([]);
    expect(run(escort({ fail_after_losses: 4 }), [hold], carried)).toEqual(['fx.json: escort "vip" fail_after_losses 4 cannot exceed the 3 units tagged "vip"']);
  });
  it('R3: every carrier of a placement gets the whole declared load (2 carriers x 2 riders + 2 carriers = 6)', () => {
    const two = { starting_force: force({ unit: 'c', count: 2, at: [3, 5], tag: 'vip', passengers: [{ unit: 'r', count: 2, tag: 'vip' }] }) };
    expect(run(escort({ fail_after_losses: 6 }), [hold], two)).toEqual([]);
    expect(run(escort({ fail_after_losses: 7 }), [hold], two)).toEqual(['fx.json: escort "vip" fail_after_losses 7 cannot exceed the 6 units tagged "vip"']);
  });
  it('R3: a tolerance above 1 is refused when the tag is carried by a from_ledger placement, and 1 or absent is not', () => {
    const led = { starting_force: force({ unit: 'u', count: 4, at: [3, 5], tag: 'vip', from_ledger: true }) };
    expect(run(escort({ fail_after_losses: 2 }), [hold], led)).toEqual([expect.stringContaining('tag "vip" is carried by a from_ledger placement')]);
    expect(run(escort({ fail_after_losses: 2 }), [hold], led)[0]).toContain('fx.json: escort "vip"');
    expect(run(escort({ fail_after_losses: 1 }), [hold], led)).toEqual([]);
    expect(run(escort(), [hold], led)).toEqual([]);
  });
  it('R4: until is a non-empty list of distinct ids of objectives of this mission, never the escort itself', () => {
    expect(run(escort({ until: [] }), [work])).toEqual(['fx.json: escort "vip" needs an until of one or more distinct objective ids']);
    expect(run(escort({ until: ['work', 'work'] }), [work])).toEqual(['fx.json: escort "vip" needs an until of one or more distinct objective ids']);
    expect(run(escort({ until: ['ghost'] }), [work])).toEqual(['fx.json: escort "vip" until names unknown objective "ghost"']);
    expect(run(escort({ until: ['vip'] }), [work])).toEqual(['fx.json: escort "vip" until names itself']);
  });
  it('R5: every until id is a primary', () => {
    expect(run(escort({ until: ['side'] }), [{ ...work, id: 'side', primary: false }, hold])[0]).toContain('until waits on a secondary ("side")');
  });
  it('R6: no until id is another escort, a ceiling or a score', () => {
    const other = { id: 'other', type: 'escort', primary: true, target: 'vip', zone: 'dest' };
    const cap = { id: 'cap', type: 'no_collateral_above', primary: true, threshold: 30 };
    const score = { id: 'sc', type: 'score', primary: true };
    for (const w of [other, cap, score]) {
      expect(run(escort({ until: [w.id] }), [w, work])[0], w.type).toContain(`until waits on a type that waits on it ("${w.id}" is ${w.type === 'escort' ? 'an' : 'a'} ${w.type})`);
    }
  });
  it('R7: a protect-in-place escort (an until, and the units already in the zone) is legal; without the until it is still refused', () => {
    const inside = { starting_force: force({ unit: 'u', count: 1, at: [21, 5], tag: 'vip' }) };
    expect(run(escort({ until: ['work'] }), [work], inside)).toEqual([]);
    expect(run(escort(), [work], inside)).toEqual(['fx.json: escort "vip" starts inside zone "dest", so it would complete on the first tick']);
  });
});

describe('an escort whose tag only a passenger carries (GH-1439 follow-up)', () => {
  // The runtime tags a rider like any spawn (`escort (GH-2)` "an escort carried by a carrier"); the validator used to refuse it with
  // "needs a tag on a starting_force placement" because it looked at the placements alone.
  const riders = (extra: Obj = {}): Obj => ({ unit: 'carrier', count: 1, at: [3, 5], passengers: [{ unit: 'rider', count: 2, tag: 'vip' }], ...extra });
  const withForce = (...p: Obj[]): Obj => ({ starting_force: force(...p) });
  it('accepts a tag carried by a passenger and by no placement', () => {
    expect(run(escort(), [hold], withForce(riders()))).toEqual([]);
  });
  it('still refuses a tag no placement and no passenger carries', () => {
    expect(run(escort(), [hold], withForce(riders({ passengers: [{ unit: 'rider', count: 2, tag: 'other' }] })))[0]).toContain('needs a tag on a starting_force placement');
    expect(run(escort(), [hold], withForce(riders({ passengers: [{ unit: 'rider', count: 2 }] })))[0]).toContain('needs a tag on a starting_force placement');
  });
  it('counts the riders for fail_after_losses (R3): two riders allow 2 and refuse 3', () => {
    expect(run(escort({ fail_after_losses: 2 }), [hold], withForce(riders()))).toEqual([]);
    expect(run(escort({ fail_after_losses: 3 }), [hold], withForce(riders()))).toEqual(['fx.json: escort "vip" fail_after_losses 3 cannot exceed the 2 units tagged "vip"']);
  });
  it('does not call the starts-inside fault on a rider-only tag, even when the carrier stands in the zone (the runtime reads the bodies)', () => {
    expect(run(escort(), [hold], withForce(riders({ at: [21, 5], passengers: [{ unit: 'rider', count: 1, tag: 'vip' }] })))).toEqual([]);
    // control: the same position on a DIRECTLY tagged single unit is still the fault
    expect(run(escort(), [hold], withForce({ unit: 'u', count: 1, at: [21, 5], tag: 'vip' }))).toEqual(['fx.json: escort "vip" starts inside zone "dest", so it would complete on the first tick']);
  });
  it('a directly tagged carrier with tagged riders still gets the starts-inside check on the carrier', () => {
    expect(run(escort(), [hold], withForce({ unit: 'carrier', count: 1, at: [21, 5], tag: 'vip', passengers: [{ unit: 'rider', count: 1, tag: 'vip' }] }))).toHaveLength(1);
  });
});

describe('no_collateral_above', () => {
  it('passes a whole threshold from 0 to 100 beside another primary', () => {
    for (const threshold of [0, 30, 100]) expect(run(ceiling({ threshold }), [hold]), String(threshold)).toEqual([]);
  });
  it('refuses a missing, fractional or out-of-range threshold', () => {
    for (const threshold of [undefined, 12.5, -1, 101]) {
      expect(run(ceiling({ threshold }), [hold])[0], String(threshold)).toContain('needs a whole threshold from 0 to 100');
    }
  });
  it('refuses a mission that switches ROE off', () => {
    expect(run(ceiling(), [hold], { roe: { enabled: false } })).toEqual(['fx.json: no_collateral_above "clean" reads the ROE score, which this mission switches off']);
  });
  it('needs a primary that is not itself a ceiling: two ceilings would wait on each other', () => {
    const c2 = ceiling({ id: 'clean2', primary: true });
    expect(run(ceiling({ primary: true }), [c2])[0]).toContain('needs another primary objective (not a ceiling)');
    expect(run(ceiling(), [hold, c2])).toEqual([]);
    expect(run(ceiling({ primary: true }), [])[0]).toContain('needs another primary objective (not a ceiling)');
  });
  it('refuses a threshold on any other type', () => {
    expect(run({ ...hold, threshold: 10 }, [])).toEqual(['fx.json: objective "hold" is a survive_until, which takes no threshold (only no_collateral_above does)']);
  });
});

describe('E3: evacuate_before group', () => {
  const evac = (extra: Obj = {}): Obj => ({ id: 'out', type: 'evacuate_before', primary: true, target: 'dest', count: 1, seconds: 300, ...extra });
  const civ = { civilians: { refuge: 'r', groups: [{ unit: 'c', count: 2, at: [3, 5], group: 'north' }, { unit: 'v', count: 1, at: [4, 5], group: 'cart', passengers: [{ unit: 'c', count: 1, group: 'riders' }] }] } };
  it('passes a scope of declared civilian groups, a passenger group among them, and an unscoped evacuation', () => {
    expect(run(evac({ group: 'north' }), [hold], civ)).toEqual([]);
    expect(run(evac({ group: ['north', 'cart', 'riders'] }), [hold], civ)).toEqual([]);
    expect(run(evac(), [hold], civ)).toEqual([]);
  });
  it('refuses a name no civilian placement declares, one message per name', () => {
    expect(run(evac({ group: ['north', 'south'] }), [hold], civ)).toEqual(['fx.json: evacuate_before "out" names group "south", which no civilian placement declares']);
    expect(run(evac({ group: 'south' }), [hold], civ)).toHaveLength(1);
  });
  it('refuses a name only a soldier placement carries', () => {
    const m = { ...civ, starting_force: force({ unit: 'u', count: 1, at: [3, 5], tag: 'vip', group: 'troop' }) };
    expect(run(evac({ group: 'troop' }), [hold], m)).toEqual(['fx.json: evacuate_before "out" names group "troop", which no civilian placement declares']);
  });
  it('refuses a group on any other type', () => {
    expect(run({ ...hold, group: 'north' }, [], civ)).toEqual(['fx.json: objective "hold" is a survive_until, which takes no group (only evacuate_before does)']);
  });
});

describe('the shipped missions', () => {
  it('pass the same checks (no stray `zone` or `threshold`, and any escort or ceiling that ships is well formed)', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const dir = join(root, 'data', 'missions');
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) {
      const m = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { map: { file: string }; objectives: Obj[] };
      const mp = JSON.parse(readFileSync(join(root, 'data', 'maps', `${m.map.file}.json`), 'utf8')) as typeof map;
      // A mission with no objectives would skip every check below and report success.
      expect(m.objectives.length, `${f}: objectives`).toBeGreaterThan(0);
      for (const o of m.objectives) {
        expect(objectiveFailures(o, m, mp, f), f).toEqual([]);
      }
    }
  });
});
