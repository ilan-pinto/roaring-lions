/**
 * GH-984 N1: `map.schema.json`'s `wind` block is what `pnpm validate:data` enforces -- strength 0..2 and a
 * heading at most 30 degrees off the screen side. The schema is compiled here the way `validate_data.mjs`
 * does, and given a shipped map with a `wind` block grafted on, so a bound loosened in the schema goes red
 * here and not only in a hand-run of the gate.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AjvModule from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { WIND_SKEW_MAX_DEG, WIND_STRENGTH_MAX } from '@lions/data';
import {
  WIND_SKEW_MAX_DEG as RENDER_SKEW_MAX_DEG,
  WIND_STRENGTH_MAX as RENDER_STRENGTH_MAX,
} from '../../packages/render/src/three/terrain/wind';

const ROOT = join(__dirname, '../..');
const Ajv2020 = (AjvModule as unknown as { default?: typeof AjvModule }).default ?? AjvModule;
const ajv = new (Ajv2020 as unknown as new (o: object) => { compile: (s: object) => ((d: unknown) => boolean) & { errors?: unknown } })({ allErrors: true, strict: false });
const validate = ajv.compile(JSON.parse(readFileSync(join(ROOT, 'data/schemas/map.schema.json'), 'utf8')));
const base = JSON.parse(readFileSync(join(ROOT, 'data/maps/wadi_halam_basin.json'), 'utf8')) as Record<string, unknown>;
const ok = (wind: unknown): boolean => validate({ ...base, wind });

describe('map.schema.json wind block', () => {
  it('accepts the shipped map as it is, and every in-range block', () => {
    expect(validate(base)).toBe(true);
    expect(ok({})).toBe(true);
    expect(ok({ strength: 0 })).toBe(true);
    expect(ok({ strength: 2, side: 'west', skew_deg: 30 })).toBe(true);
    expect(ok({ strength: 1.3, side: 'east', skew_deg: -30 })).toBe(true);
  });
  it('refuses a skew past 30 degrees either way, a strength outside 0..2, an unknown side or key', () => {
    expect(ok({ skew_deg: 30.1 })).toBe(false);
    expect(ok({ skew_deg: -30.1 })).toBe(false);
    expect(ok({ skew_deg: 90 })).toBe(false);
    expect(ok({ strength: 2.1 })).toBe(false);
    expect(ok({ strength: -0.01 })).toBe(false);
    expect(ok({ side: 'north' })).toBe(false);
    expect(ok({ heading: 45 })).toBe(false);
  });
  it('agrees with the bounds @lions/data and the renderer clamp use', () => {
    expect(WIND_SKEW_MAX_DEG).toBe(30);
    expect(WIND_STRENGTH_MAX).toBe(2);
    expect(RENDER_SKEW_MAX_DEG).toBe(WIND_SKEW_MAX_DEG);
    expect(RENDER_STRENGTH_MAX).toBe(WIND_STRENGTH_MAX);
    const props = (JSON.parse(readFileSync(join(ROOT, 'data/schemas/map.schema.json'), 'utf8')) as { properties: { wind: { properties: Record<string, { minimum?: number; maximum?: number }> } } }).properties.wind.properties;
    expect(props.skew_deg).toMatchObject({ minimum: -WIND_SKEW_MAX_DEG, maximum: WIND_SKEW_MAX_DEG });
    expect(props.strength).toMatchObject({ minimum: 0, maximum: WIND_STRENGTH_MAX });
  });
});
