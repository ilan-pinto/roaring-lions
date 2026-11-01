// The town-level unlock gate's cross-file rules (GH-912 G1, T8). Its own module because
// validate_data.mjs runs its sweep at import time and exits, so a test cannot import it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AjvModule from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { townGateFailures } from '../validate_world.mjs';

interface Town {
  id: string;
  name: string;
  at: number[];
  missions: string[];
  unlock?: { after_mission: string };
}
interface World {
  regions: { id: string; towns: Town[] }[];
}

const ROOT = join(__dirname, '..', '..');
const real = JSON.parse(readFileSync(join(ROOT, 'data/campaign/world.json'), 'utf8')) as World;

const town = (id: string, missions: string[], after?: string): Town => ({
  id,
  name: id,
  at: [0, 0],
  missions,
  ...(after !== undefined ? { unlock: { after_mission: after } } : {}),
});
const world = (...regions: Town[][]): World => ({
  regions: regions.map((towns, i) => ({ id: `r${i}`, towns })),
});

describe('townGateFailures (GH-912 G1)', () => {
  it('a clean gate on an earlier region fails nothing', () => {
    const w = world([town('a', ['a1'])], [town('b', ['b1'], 'a1')]);
    expect(townGateFailures(w)).toEqual([]);
  });

  it('a clean gate on an earlier town of the same region fails nothing', () => {
    const w = world([town('a', ['a1']), town('b', ['b1'], 'a1')]);
    expect(townGateFailures(w)).toEqual([]);
  });

  it('refuses a gate on a mission of the same town', () => {
    const w = world([town('a', ['a1', 'a2'], 'a1')]);
    const f = townGateFailures(w);
    expect(f).toHaveLength(1);
    expect(f[0]).toContain('same town');
  });

  it('refuses a gate in a later region', () => {
    const w = world([town('a', ['a1'], 'b1')], [town('b', ['b1'])]);
    const f = townGateFailures(w);
    expect(f).toHaveLength(1);
    expect(f[0]).toContain('not earlier');
  });

  it('refuses a gate on a mission no town lists', () => {
    const w = world([town('a', ['a1'])], [town('b', ['b1'], 'ghost')]);
    const f = townGateFailures(w);
    expect(f).toHaveLength(1);
    expect(f[0]).toContain('no town lists');
  });

  it('refuses a cycle of two towns gating each other', () => {
    const w = world([town('a', ['a1'], 'b1'), town('b', ['b1'], 'a1')]);
    const f = townGateFailures(w);
    expect(f.length).toBeGreaterThan(0);
    expect(f.every((m) => m.includes('cycle'))).toBe(true);
  });

  it('terminates on, and reports once per town, a cycle the first town only leads into', () => {
    const w = world([town('a', ['a1'], 'b1'), town('b', ['b1'], 'c1'), town('c', ['c1'], 'b1')]);
    const f = townGateFailures(w);
    expect(f).toHaveLength(2);
    expect(f.every((m) => m.includes('cycle'))).toBe(true);
  });

  it('the real world.json has no failing town gate', () => {
    expect(townGateFailures(real)).toEqual([]);
  });
});

describe('world.schema.json town unlock (GH-912 G1)', () => {
  const Ajv2020 = (AjvModule as unknown as { default?: typeof AjvModule }).default ?? AjvModule;
  const ajv = new (Ajv2020 as unknown as new (o: object) => { compile: (s: object) => (d: unknown) => boolean })({
    allErrors: true,
    strict: false,
  });
  const validate = ajv.compile(JSON.parse(readFileSync(join(ROOT, 'data/schemas/world.schema.json'), 'utf8')) as object);
  const withTownUnlock = (unlock: unknown): unknown => {
    const w = structuredClone(real) as World;
    (w.regions[0]!.towns[0] as unknown as { unlock: unknown }).unlock = unlock;
    return w;
  };

  it('accepts a town unlock in the region unlock shape', () => {
    expect(validate(withTownUnlock({ after_mission: 'wadi_halam_3_counterraid' }))).toBe(true);
    expect(validate(withTownUnlock({ roe_rating_min: 60 }))).toBe(true);
  });

  it('refuses an unknown key or an out-of-range rating on a town unlock', () => {
    expect(validate(withTownUnlock({ after: 'x' }))).toBe(false);
    expect(validate(withTownUnlock({ roe_rating_min: 101 }))).toBe(false);
  });
});
