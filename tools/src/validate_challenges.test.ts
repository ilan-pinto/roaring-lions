// GH-1395 slice 1: the cross-file rules tools/validate_challenges.mjs holds over data/challenges/. The shipped files
// pass; each rule has a failing fixture made from a shipped file by one change.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import AjvModule from 'ajv/dist/2020.js';
import { challengeFailures, restrictionFailure } from '../validate_challenges.mjs';

const ROOT = join(__dirname, '..', '..');
const readJson = (p: string): unknown => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const library = readJson('data/challenges/amendments.json') as { amendments: { id: string; ops: Record<string, unknown>[] }[] };
const missions: Record<string, unknown> = {};
for (const f of readdirSync(join(ROOT, 'data/missions'))) {
  const m = readJson(`data/missions/${f}`) as { id: string };
  missions[m.id] = m;
}
type Doc = { mission: string; offers: string[]; own?: { id: string; label: string; blurb: string; ops: Record<string, unknown>[] }[]; challenge: { id: string; amendments: string[]; label: string; blurb: string } };
const shipped = readdirSync(join(ROOT, 'data/challenges'))
  .filter((f) => f !== 'amendments.json')
  .map((f) => ({ file: `data/challenges/${f}`, doc: readJson(`data/challenges/${f}`) as Doc }));
const bs2 = (): { file: string; doc: Doc } => structuredClone(shipped.find((s) => s.doc.mission === 'beit_sahwan_2_foothold') as { file: string; doc: Doc });
const run = (o: { lib?: unknown; files?: { file: string; doc: unknown }[] } = {}) => challengeFailures({ library: o.lib ?? library, files: o.files ?? shipped, missions });

describe('challengeFailures', () => {
  it('the shipped files are clean', () => {
    expect(shipped.length).toBe(6);
    expect(run()).toEqual([]);
  });
  it('refuses a ratio of 1 or more (rule A1)', () => {
    const lib = structuredClone(library);
    (lib.amendments[0].ops[0] as { num: number }).num = 5;
    expect(run({ lib }).some((f) => /not below 1/.test(f))).toBe(true);
  });
  it('refuses an operation that only adds, in the library or a mission\'s own', () => {
    const lib = structuredClone(library);
    lib.amendments[0].ops = [{ op: 'uncarry' }];
    expect(run({ lib }).some((f) => /not a restriction/.test(f))).toBe(true);
    const breach = structuredClone(shipped.find((s) => s.doc.mission === 'beit_sahwan_breach') as { file: string; doc: Doc });
    (breach.doc.own ?? [])[0].ops = [{ op: 'reinforce_player', at_seconds: 30, label_key: 'x', units: [{ unit: 'inf_squad', count: 1 }] }];
    expect(run({ files: [breach] }).some((f) => /not a restriction/.test(f))).toBe(true);
  });
  it('refuses an offer that is not in the library nor the mission\'s own', () => {
    const f = bs2();
    f.doc.offers[2] = 'double_pay';
    expect(run({ files: [f] }).some((x) => /double_pay/.test(x))).toBe(true);
  });
  it('refuses a challenge that needs an amendment the mission does not offer', () => {
    const f = bs2();
    f.doc.challenge.amendments = ['no_eyes'];
    expect(run({ files: [f] }).some((x) => /does not offer/.test(x))).toBe(true);
  });
  it('refuses an offer that changes nothing on its mission (Clean hands on a mission with no fail_below)', () => {
    const f = bs2();
    f.doc.offers[1] = 'clean_hands';
    expect(run({ files: [f] }).some((x) => /changes nothing/.test(x))).toBe(true);
  });
  it('refuses a file named for another mission, an unknown mission, and the tutorial', () => {
    const named = bs2();
    named.file = 'data/challenges/beit_sahwan_1_recon.json';
    expect(run({ files: [named] }).some((x) => /but the file is/.test(x))).toBe(true);
    const tut = bs2();
    tut.doc.mission = 'beit_sahwan_0_tutorial';
    tut.file = 'data/challenges/beit_sahwan_0_tutorial.json';
    tut.doc.offers = ['light_order', 'tight_clock', 'thin_purse'];
    tut.doc.challenge.amendments = ['tight_clock'];
    expect(run({ files: [tut] }).some((x) => /produces no ledger key/.test(x))).toBe(true);
  });
  it('refuses a duplicate challenge id, an empty label, and the word "withdrawn" (PA-01)', () => {
    const a = bs2();
    const b = structuredClone(shipped.find((s) => s.doc.mission === 'beit_sahwan_3_clearance') as { file: string; doc: Doc });
    b.doc.challenge.id = a.doc.challenge.id;
    expect(run({ files: [a, b] }).some((x) => /is also/.test(x))).toBe(true);
    const k = bs2();
    k.doc.challenge.label = ' ';
    expect(run({ files: [k] }).some((x) => /no label text/.test(x))).toBe(true);
    const w = bs2();
    w.doc.challenge.blurb = 'Hold until the column is withdrawn.';
    expect(run({ files: [w] }).some((x) => /PA-01/.test(x))).toBe(true);
  });
  it('refuses an own amendment that shadows a library id or is not offered', () => {
    const breach = structuredClone(shipped.find((s) => s.doc.mission === 'beit_sahwan_breach') as { file: string; doc: Doc });
    (breach.doc.own ?? [])[0].id = 'light_order';
    expect(run({ files: [breach] }).some((x) => /shadows the library/.test(x))).toBe(true);
    const unoffered = structuredClone(shipped.find((s) => s.doc.mission === 'beit_sahwan_breach') as { file: string; doc: Doc });
    unoffered.doc.offers = ['light_order', 'no_medic', 'tight_clock'];
    expect(run({ files: [unoffered] }).some((x) => /is not offered/.test(x))).toBe(true);
  });
});

// PM review of PR 1504 (hand-off 2): the schema's `ratio` allows 1..16 for both terms, so a schema-valid amendment could
// scale the clock x16/1 or the waves x1/16. `restrictionFailure` is the per-operation direction check, for every
// operation of the closed set, and the shipped catalogue passes it.
describe('restrictionFailure: every operation of the closed set has a written direction', () => {
  const schema = readJson('data/schemas/overlay_ops.schema.json') as { $defs: { op: { oneOf: { properties: { op: { const: string } } }[] } } };
  const ops = schema.$defs.op.oneOf.map((o) => o.properties.op.const).sort();
  const wave = { at_seconds: 60, units: [{ unit: 'sarim_rifles', count: 2 }] };
  const restricting: Record<string, unknown> = {
    scale_time_limit: { op: 'scale_time_limit', num: 3, den: 4 },
    scale_resources: { op: 'scale_resources', num: 1, den: 2 },
    scale_waves: { op: 'scale_waves', num: 5, den: 4, skip_tagged: true },
    shift_waves: { op: 'shift_waves', seconds: -15 },
    raise_fail_below: { op: 'raise_fail_below', by: 10 },
    remove_starting: { op: 'remove_starting', unit: 'inf_squad', count: 1 },
    set_intel_start: { op: 'set_intel_start', value: 0 },
    add_wave: { op: 'add_wave', wave },
  };
  const easing: Record<string, unknown> = {
    scale_time_limit: { op: 'scale_time_limit', num: 16, den: 1 },
    scale_resources: { op: 'scale_resources', num: 2, den: 1 },
    scale_waves: { op: 'scale_waves', num: 1, den: 16, skip_tagged: true },
    shift_waves: { op: 'shift_waves', seconds: 30 },
    raise_fail_below: { op: 'raise_fail_below', by: 0 },
    remove_starting: { op: 'remove_starting', unit: 'inf_squad', count: 0 },
    set_intel_start: { op: 'set_intel_start', value: -1 },
    add_wave: { op: 'add_wave', wave: { at_seconds: 60, units: [] } },
    reinforce_player: { op: 'reinforce_player', at_seconds: 90, label_key: 'k', units: [{ unit: 'inf_squad', count: 1 }] },
    uncarry: { op: 'uncarry' },
  };
  it('the table covers the schema: every operation has an easing case, and none is unknown', () => {
    expect(Object.keys(easing).sort()).toEqual(ops);
    for (const op of ops) expect(restrictionFailure(easing[op]), op).not.toBeNull();
    expect(restrictionFailure({ op: 'set_any_path' })).toMatch(/no written direction/);
  });
  it.each(Object.keys(restricting))('%s the restricting way passes', (op) => {
    expect(restrictionFailure(restricting[op])).toBeNull();
  });
  it('a ratio of exactly 1 is not a restriction either way', () => {
    expect(restrictionFailure({ op: 'scale_time_limit', num: 4, den: 4 })).not.toBeNull();
    expect(restrictionFailure({ op: 'scale_waves', num: 4, den: 4, skip_tagged: true })).not.toBeNull();
  });
  it('the shipped library and every own amendment pass it', () => {
    const all = [...library.amendments, ...shipped.flatMap((s) => s.doc.own ?? [])];
    expect(all.length).toBe(7);
    for (const a of all) for (const op of a.ops) expect(restrictionFailure(op), `${a.id} ${String(op.op)}`).toBeNull();
  });
  it('validate:data refuses a library x16/1 clock', () => {
    const lib = structuredClone(library);
    lib.amendments[0].ops = [{ op: 'scale_time_limit', num: 16, den: 1 }];
    expect(run({ lib }).some((f) => /not below 1, so it is not a restriction/.test(f))).toBe(true);
  });
});

// Hand-off 3: `add_wave.wave` is mission.schema.json's wave shape by $ref, so a malformed wave in a mission's `own`
// amendment is refused at the schema, before any overlay applies it.
describe('add_wave carries mission.schema.json\'s wave shape', () => {
  const schemaOf = (f: string): object => readJson(`data/schemas/${f}`) as object;
  const Ajv2020 = (AjvModule as unknown as { default?: typeof AjvModule }).default ?? AjvModule;
  const ajv = new (Ajv2020 as unknown as new (o: object) => {
    addSchema: (s: object) => unknown;
    compile: (s: object) => (d: unknown) => boolean;
  })({ allErrors: true, strict: false });
  for (const f of ['common.schema.json', 'mission.schema.json', 'overlay_ops.schema.json', 'amendments.schema.json']) ajv.addSchema(schemaOf(f));
  const validate = ajv.compile(schemaOf('challenge.schema.json'));
  const withWave = (wave: unknown) => {
    const f = structuredClone(shipped.find((s) => s.doc.mission === 'beit_sahwan_breach') as { file: string; doc: Doc });
    (f.doc.own ?? [])[0].ops = [{ op: 'add_wave', wave }];
    return f.doc;
  };
  it('the shipped files pass the schema', () => {
    for (const s of shipped) expect(validate(s.doc), s.file).toBe(true);
  });
  it('a wave in the mission shape passes; one with no at_seconds, or a field the mission schema does not know, does not', () => {
    expect(validate(withWave({ at_seconds: 60, units: [{ unit: 'sarim_rifles', count: 2 }] }))).toBe(true);
    expect(validate(withWave({ units: [{ unit: 'sarim_rifles', count: 2 }] }))).toBe(false);
    expect(validate(withWave({ at_seconds: 60, units: [], double_pay: true }))).toBe(false);
  });
});
