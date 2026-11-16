// GH-1395 slice 1: the cross-file rules tools/validate_challenges.mjs holds over data/challenges/. The shipped files
// pass; each rule has a failing fixture made from a shipped file by one change.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { challengeFailures } from '../validate_challenges.mjs';

const ROOT = join(__dirname, '..', '..');
const readJson = (p: string): unknown => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const en = readJson('packages/app/src/i18n/en.json') as Record<string, string>;
const library = readJson('data/challenges/amendments.json') as { amendments: { id: string; ops: Record<string, unknown>[] }[] };
const missions: Record<string, unknown> = {};
for (const f of readdirSync(join(ROOT, 'data/missions'))) {
  const m = readJson(`data/missions/${f}`) as { id: string };
  missions[m.id] = m;
}
type Doc = { mission: string; offers: string[]; own?: { id: string; label_key: string; blurb_key: string; ops: Record<string, unknown>[] }[]; challenge: { id: string; amendments: string[]; label_key: string; blurb_key: string } };
const shipped = readdirSync(join(ROOT, 'data/challenges'))
  .filter((f) => f !== 'amendments.json')
  .map((f) => ({ file: `data/challenges/${f}`, doc: readJson(`data/challenges/${f}`) as Doc }));
const bs2 = (): { file: string; doc: Doc } => structuredClone(shipped.find((s) => s.doc.mission === 'beit_sahwan_2_foothold') as { file: string; doc: Doc });
const run = (o: { lib?: unknown; files?: { file: string; doc: unknown }[] } = {}) => challengeFailures({ library: o.lib ?? library, files: o.files ?? shipped, missions, en });

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
    expect(run({ lib }).some((f) => /not a restricting operation/.test(f))).toBe(true);
    const breach = structuredClone(shipped.find((s) => s.doc.mission === 'beit_sahwan_breach') as { file: string; doc: Doc });
    (breach.doc.own ?? [])[0].ops = [{ op: 'reinforce_player', at_seconds: 30, label_key: 'x', units: [{ unit: 'inf_squad', count: 1 }] }];
    expect(run({ files: [breach] }).some((f) => /not a restricting operation/.test(f))).toBe(true);
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
  it('refuses a duplicate challenge id and a missing en.json key', () => {
    const a = bs2();
    const b = structuredClone(shipped.find((s) => s.doc.mission === 'beit_sahwan_3_clearance') as { file: string; doc: Doc });
    b.doc.challenge.id = a.doc.challenge.id;
    expect(run({ files: [a, b] }).some((x) => /is also/.test(x))).toBe(true);
    const k = bs2();
    k.doc.challenge.label_key = 'challenge.nowhere.label';
    expect(run({ files: [k] }).some((x) => /not an en.json key/.test(x))).toBe(true);
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
