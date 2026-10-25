// E6 (GH-274) item 2: the unit schema accepts the `swarm` block and refuses a half-declared or
// nonsensical one. Engine only: no shipped unit carries one yet (drone_swarm is a later step).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import AjvModule from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f: string): object => JSON.parse(readFileSync(join(ROOT, 'data', 'schemas', f), 'utf8')) as object;
const Ajv2020 = (AjvModule as unknown as { default?: typeof AjvModule }).default ?? AjvModule;
const ajv = new (Ajv2020 as unknown as new (o: object) => {
  addSchema: (s: object) => unknown;
  compile: (s: object) => (d: unknown) => boolean;
})({ allErrors: true, strict: false });
ajv.addSchema(read('common.schema.json'));
const validateUnit = ajv.compile(read('unit.schema.json'));

const swarm = { count: 12, member_hp: 15, spread_tiles: 3 };
const base = {
  id: 'probe_swarm',
  name: 'Probe',
  faction: 'sarim',
  role: 'drone',
  cost: { logistics: 240 },
  mobility: { speed_tiles_s: 2.6, domain: 'air' },
  sensors: { optics: 1.2, sight_tiles: 10 },
  hull: { hp: 180, armor: { front: 5, side: 5, rear: 5 } },
  swarm,
};
const without = (o: Record<string, unknown>, k: string): object => {
  const rest = { ...o };
  delete rest[k];
  return rest;
};

describe('unit schema: swarm (E6 item 2)', () => {
  it('accepts the approved drone swarm numbers, and a unit with no block', () => {
    expect(validateUnit(base)).toBe(true);
    expect(validateUnit(without(base, 'swarm'))).toBe(true);
  });
  it('refuses a block missing any of its three numbers, an unknown key, or nonsense', () => {
    for (const k of Object.keys(swarm)) expect(validateUnit({ ...base, swarm: without(swarm, k) })).toBe(false);
    expect(validateUnit({ ...base, swarm: { ...swarm, extra: 1 } })).toBe(false);
    expect(validateUnit({ ...base, swarm: { ...swarm, count: 0 } })).toBe(false);
    expect(validateUnit({ ...base, swarm: { ...swarm, count: 2.5 } })).toBe(false);
    expect(validateUnit({ ...base, swarm: { ...swarm, member_hp: 0 } })).toBe(false);
    expect(validateUnit({ ...base, swarm: { ...swarm, spread_tiles: 0 } })).toBe(false);
  });
  it('hit_mult (E6 N2) is optional and lives in (0, 1]', () => {
    expect(validateUnit({ ...base, swarm: { ...swarm, hit_mult: 0.08 } })).toBe(true);
    expect(validateUnit({ ...base, swarm: { ...swarm, hit_mult: 1 } })).toBe(true);
    for (const bad of [0, -0.1, 1.01, '0.08']) expect(validateUnit({ ...base, swarm: { ...swarm, hit_mult: bad } })).toBe(false);
  });
});
