// F3 Task 2 (GH-183): `resources.pop_cap` is OFF in the campaign (lead, G3 Q4, 4 Oct; D4).
// Its own module for the reason every validate_*.mjs is one: validate_data.mjs runs its whole
// sweep at import time and exits. `town` is schema-required, so a town-less fixture can only
// reach the pure rule, not the full gate (which would refuse it for the missing town first).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import AjvModule from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { popCapFailures } from '../validate_pop_cap.mjs';

const ROOT = join(__dirname, '..', '..');

const Ajv2020 = (AjvModule as unknown as { default?: typeof AjvModule }).default ?? AjvModule;
const ajv = new (Ajv2020 as unknown as new (o: object) => {
  compile: (s: object) => ((d: unknown) => boolean) & { errors?: unknown };
})({ allErrors: true, strict: false });
const schema = JSON.parse(readFileSync(join(ROOT, 'data', 'schemas', 'mission.schema.json'), 'utf8')) as {
  properties: { resources: object };
};
// The `resources` sub-schema alone: the full mission schema needs a whole valid mission to say
// anything about one field, and what is under test is this field's own constraint.
const validateResources = ajv.compile(schema.properties.resources);

describe('popCapFailures', () => {
  it('refuses pop_cap on a mission with a town, by name, citing G3 Q4', () => {
    const out = popCapFailures({ town: 'beit_sahwan', resources: { pop_cap: 18 } }, 'data/missions/m.json');
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('data/missions/m.json');
    expect(out[0]).toContain('pop_cap');
    expect(out[0]).toContain('G3 Q4');
  });
  it('passes the same pop_cap on a mission with no town', () => {
    expect(popCapFailures({ resources: { pop_cap: 18 } }, 'm')).toEqual([]);
  });
  it('passes a campaign mission that sets no pop_cap, or no resources at all', () => {
    expect(popCapFailures({ town: 'beit_sahwan', resources: { logistics_start: 3 } }, 'm')).toEqual([]);
    expect(popCapFailures({ town: 'beit_sahwan' }, 'm')).toEqual([]);
  });
  it('refuses pop_cap 0 on a town mission too (a present key is a set cap, whatever its value)', () => {
    expect(popCapFailures({ town: 'beit_sahwan', resources: { pop_cap: 0 } }, 'm')).toHaveLength(1);
  });
  it('no shipped mission sets one', () => {
    const dir = join(ROOT, 'data', 'missions');
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
      const m = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Record<string, unknown>;
      expect(popCapFailures(m, f), f).toEqual([]);
    }
  });
});

describe('validate_data.mjs wiring', () => {
  // The sweep runs at import time, so the call site cannot be imported; pin it as text.
  it('imports and calls popCapFailures on each mission', () => {
    const src = readFileSync(join(ROOT, 'tools', 'validate_data.mjs'), 'utf8');
    expect(src).toContain("from './validate_pop_cap.mjs'");
    expect(src).toContain('failures.push(...popCapFailures(mi, rel(file)))');
  });
});

describe('mission.schema.json resources.pop_cap', () => {
  it('accepts a positive integer', () => {
    expect(validateResources({ pop_cap: 18 })).toBe(true);
    expect(validateResources({ pop_cap: 1 })).toBe(true);
  });
  it('refuses 0, a negative, and a non-integer', () => {
    expect(validateResources({ pop_cap: 0 })).toBe(false);
    expect(validateResources({ pop_cap: -3 })).toBe(false);
    expect(validateResources({ pop_cap: 1.5 })).toBe(false);
  });
});
