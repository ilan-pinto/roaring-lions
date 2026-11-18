// GH-1395 slice 1 (design 2026-11-15-challenge-star-design.md §8, checks C3, C4, C5, C10): every amended mission of the
// pilot, at every posture and for every subset of its offers, pays no more credits than the same run unamended (each of
// creditsFor's inputs bounded ON ITS OWN, not their sum), passes the mission schema and the overlaid clock rule (D13),
// builds and starts a real runtime, and replays to one hash. Bounds use the sim's own `creditsFor`; nothing here
// re-derives a number the code under test computes.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import AjvModule from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import {
  amendmentOps,
  applyOverlays,
  missionChallenges,
  POSTURE_IDS,
  TICKS_PER_TARGET_MINUTE,
  type PostureId,
} from '@lions/data';
import { missions } from '@lions/data/content';
import { creditsFor, MissionRuntime, TICKS_PER_SECOND, type MissionJson } from '@lions/sim';
import { timeLimitFailures } from '../validate_time_limit.mjs';
import { missionStage } from './mission-harness';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f: string): object => JSON.parse(readFileSync(join(ROOT, 'data', 'schemas', f), 'utf8')) as object;
const Ajv2020 = (AjvModule as unknown as { default?: typeof AjvModule }).default ?? AjvModule;
const ajv = new (Ajv2020 as unknown as new (o: object) => {
  addSchema: (s: object) => unknown;
  compile: (s: object) => ((d: unknown) => boolean) & { errors?: unknown };
})({ allErrors: true, strict: false });
ajv.addSchema(read('common.schema.json'));
const validateMission = ajv.compile(read('mission.schema.json'));

const raw = (id: string): MissionJson => (missions as unknown as Record<string, MissionJson>)[id];
/** Every subset of a mission's three offers, the empty one first. */
const subsets = (offers: readonly string[]): string[][] =>
  Array.from({ length: 1 << offers.length }, (_, mask) => offers.filter((_, i) => (mask & (1 << i)) !== 0));
const play = (id: string, posture: PostureId, on: readonly string[]): MissionJson =>
  applyOverlays(raw(id), { posture, amendments: amendmentOps(on, id) });

/** `creditsFor`'s inputs a mission JSON fixes, each on its own: the authored starting bodies (`fielded`), the carrying
 *  secondaries, and the Conduct floor's `fail_below`. */
function payInputs(m: MissionJson): { fielded: number; carrying: number; failBelow: number | undefined } {
  return {
    fielded: (m.starting_force ?? []).reduce((n, p) => n + p.count, 0),
    carrying: m.objectives.filter((o) => !o.primary && o.carries === true).length,
    failBelow: m.roe?.fail_below,
  };
}
/** The most `creditsFor` can pay on this JSON: a win, every carrying secondary done, nobody lost, Conduct 100. */
const bestPay = (m: MissionJson): number => {
  const p = payInputs(m);
  return creditsFor({ result: 'victory', carryingComplete: p.carrying, fielded: p.fielded, lost: 0, roe: 100, failBelow: p.failBelow });
};

const cases = missionChallenges.flatMap((c) =>
  POSTURE_IDS.flatMap((posture) => subsets(c.offers).map((on) => ({ id: c.mission, posture, on, label: `${c.mission} at ${posture} [${on.join(', ') || 'none'}]` })))
);

it('the ticks a target minute is, pinned to the sim clock', () => {
  expect(TICKS_PER_TARGET_MINUTE).toBe(60 * TICKS_PER_SECOND);
});

it('covers the six pilot missions, three postures and eight subsets each (144 runs)', () => {
  expect(cases.length).toBe(6 * 3 * 8);
});

describe('C3: an amended win pays no more credits than the same run unamended, each input on its own (rule A2)', () => {
  it.each(cases.map((c) => [c.label, c] as const))('%s', (_, c) => {
    const plain = payInputs(play(c.id, c.posture, []));
    const amended = payInputs(play(c.id, c.posture, c.on));
    expect(amended.fielded).toBeLessThanOrEqual(plain.fielded);
    expect(amended.carrying).toBeLessThanOrEqual(plain.carrying);
    // fail_below is never lowered and never removed: a higher floor pays LESS Conduct credit.
    if (plain.failBelow === undefined) expect(amended.failBelow).toBeUndefined();
    else expect(amended.failBelow).toBeGreaterThanOrEqual(plain.failBelow);
    expect(bestPay(play(c.id, c.posture, c.on))).toBeLessThanOrEqual(bestPay(play(c.id, c.posture, [])));
  });
  it('the bound is not vacuous: Light order and Clean hands each pay strictly less at their best', () => {
    expect(bestPay(play('beit_sahwan_2_foothold', 'standard', ['light_order']))).toBe(bestPay(raw('beit_sahwan_2_foothold')) - 10);
    expect(bestPay(play('beit_sahwan_3_clearance', 'standard', ['clean_hands']))).toBe(bestPay(raw('beit_sahwan_3_clearance')) - 10);
  });
});

describe('A1: what an amendment moves, it moves the restricting way, and nothing else', () => {
  it.each(cases.map((c) => [c.label, c] as const))('%s', (_, c) => {
    const plain = play(c.id, c.posture, []);
    const amended = play(c.id, c.posture, c.on);
    // The clock is the posture's alone: the lead dropped Tight clock (PR 1524), so no amendment moves it at all.
    expect(amended.time_limit_s).toBe(plain.time_limit_s);
    const r = (m: MissionJson) => m.resources ?? {};
    expect(r(amended).logistics_start ?? 0).toBeLessThanOrEqual(r(plain).logistics_start ?? 0);
    expect(r(amended).logistics_rate_per_min ?? 0).toBeLessThanOrEqual(r(plain).logistics_rate_per_min ?? 0);
    expect(r(amended).intel_start ?? 0).toBeLessThanOrEqual(r(plain).intel_start ?? 0);
    const bodies = (m: MissionJson) => {
      const out = new Map<string, number>();
      for (const p of m.starting_force ?? []) out.set(p.unit, (out.get(p.unit) ?? 0) + p.count);
      return out;
    };
    for (const [unit, n] of bodies(amended)) expect(n, unit).toBeLessThanOrEqual(bodies(plain).get(unit) ?? 0);
    // Never touched (rule A3): objectives, the enemy, triggers, the map, the target.
    expect(amended.objectives).toStrictEqual(plain.objectives);
    expect(amended.enemy).toStrictEqual(plain.enemy);
    expect(amended.triggers).toStrictEqual(plain.triggers);
    expect(amended.map).toStrictEqual(plain.map);
    // Every tagged starting placement is still there, whole.
    expect((amended.starting_force ?? []).filter((p) => p.tag !== undefined)).toEqual((plain.starting_force ?? []).filter((p) => p.tag !== undefined));
  });
});

describe('every shipped mission at every posture passes the mission schema (PM review of PR 1504, hand-off 3)', () => {
  // Nothing else validates a mission AFTER the overlays: validate:data sees the authored files only.
  const all = Object.keys(missions);
  it('covers the 35 shipped missions', () => expect(all.length).toBe(35));
  it.each(POSTURE_IDS.flatMap((p) => all.map((id) => [`${id} at ${p}`, id, p] as const)))('%s', (_, id, p) => {
    const m = applyOverlays(raw(id), { posture: p });
    expect(validateMission(m), JSON.stringify(validateMission.errors)).toBe(true);
  });
  it('the check can fail: an overlaid wave with no at_seconds is refused', () => {
    const m = applyOverlays(raw('beit_sahwan_2_foothold'), { amendments: [[{ op: 'add_wave', wave: { units: [{ unit: 'sarim_rifles', count: 1 }] } as never }]] });
    expect(validateMission(m)).toBe(false);
  });
});

describe('C5: every amended mission passes the mission schema and the overlaid clock rule (D13)', () => {
  it.each(cases.map((c) => [c.label, c] as const))('%s', (_, c) => {
    const m = play(c.id, c.posture, c.on);
    expect(validateMission(m), JSON.stringify(validateMission.errors)).toBe(true);
    expect(timeLimitFailures(m, c.label, { overlaid: m !== raw(c.id) })).toEqual([]);
  });
  it('both checks can fail: a x3/4 clock on a 720 s mission breaks the schema floor, and x1/3 breaks the clock rule', () => {
    // Literal overlay ops, not an amendment: no amendment moves the clock (the lead dropped Tight clock, PR 1524), but a
    // posture can, so both checks stay and each needs an input it refuses. mission.schema.json's `time_limit_s` minimum
    // is 600 s: Beit Sahwan IV's 720 x 3/4 = 540 is refused by it while D13's 1x floor (360 s) would pass it.
    const short = applyOverlays(raw('beit_sahwan_4_subterranean'), { amendments: [[{ op: 'scale_time_limit', num: 3, den: 4 }]] });
    expect(short.time_limit_s).toBe(540);
    expect(validateMission(short)).toBe(false);
    expect(timeLimitFailures(short, 'x3/4', { overlaid: true })).toEqual([]);
    const third = applyOverlays(raw('beit_sahwan_4_subterranean'), { amendments: [[{ op: 'scale_time_limit', num: 1, den: 3 }]] });
    expect(third.time_limit_s).toBe(240);
    expect(timeLimitFailures(third, 'x1/3', { overlaid: true }).length).toBeGreaterThan(0);
  });
});

describe('C4: every amended mission builds and starts a real runtime, and fields no more than the plain one', () => {
  it.each(cases.map((c) => [c.label, c] as const))('%s', (_, c) => {
    const build = (m: MissionJson) => {
      const stage = missionStage(c.id);
      const rt = new MissionRuntime(stage.sim, m, stage.context({}));
      rt.start();
      for (let t = 0; t < 2 * TICKS_PER_SECOND; t++) rt.step(stage.sim.tick());
      return rt;
    };
    const plain = build(play(c.id, c.posture, []));
    const amended = build(play(c.id, c.posture, c.on));
    expect(amended.startingCount).toBeLessThanOrEqual(plain.startingCount);
    if (amendmentOps(c.on, c.id).flat().some((o) => o.op === 'remove_starting')) expect(amended.startingCount).toBeLessThan(plain.startingCount);
  });
});

describe('C10: an amended mission is deterministic', () => {
  it.each(missionChallenges.map((c) => c.mission))('%s with its challenge on: two runs, one hash', (id) => {
    const on = missionChallenges.find((c) => c.mission === id)?.challenge.amendments ?? [];
    const hashOf = () => {
      const stage = missionStage(id);
      const rt = new MissionRuntime(stage.sim, play(id, 'standard', on), stage.context({}));
      rt.start();
      for (let t = 0; t < 30 * TICKS_PER_SECOND; t++) rt.step(stage.sim.tick());
      return stage.sim.hash();
    };
    expect(JSON.stringify(play(id, 'standard', on))).toBe(JSON.stringify(play(id, 'standard', on)));
    expect(hashOf()).toBe(hashOf());
  });
});
