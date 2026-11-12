// GH-1223: `ragdoll_push` in data/vfx/munitions.json. The schema accepts the shipped table and refuses a bad value.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import AjvModule from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
type Json = Record<string, unknown>;
const read = (f: string): Json => JSON.parse(readFileSync(join(ROOT, f), 'utf8')) as Json;
const classes = (t: Json): Record<string, Record<string, unknown>> => t.classes as Record<string, Record<string, unknown>>;
const Ajv2020 = (AjvModule as unknown as { default?: typeof AjvModule }).default ?? AjvModule;
const ajv = new (Ajv2020 as unknown as new (o: object) => { compile: (s: object) => (d: unknown) => boolean })({
  allErrors: true,
  strict: false,
});
const validate = ajv.compile(read('data/schemas/vfx_munitions.schema.json'));
const withPush = (push: unknown): unknown => {
  const t = read('data/vfx/munitions.json');
  classes(t).mortar.ragdoll_push = push;
  return t;
};

describe('munitions.json ragdoll_push', () => {
  it('the shipped table validates', () => {
    expect(validate(read('data/vfx/munitions.json'))).toBe(true);
  });
  it('accepts a well-formed push and a class with none', () => {
    expect(validate(withPush({ horizontal_m_s: 2.5, up_m_s: 0 }))).toBe(true);
    const t = read('data/vfx/munitions.json');
    delete classes(t).mortar.ragdoll_push;
    expect(validate(t)).toBe(true);
  });
  it.each([
    ['zero horizontal', { horizontal_m_s: 0, up_m_s: 1 }],
    ['negative horizontal', { horizontal_m_s: -1, up_m_s: 1 }],
    ['negative up', { horizontal_m_s: 1, up_m_s: -0.1 }],
    ['absurd horizontal', { horizontal_m_s: 50, up_m_s: 1 }],
    ['a string', { horizontal_m_s: '3', up_m_s: 1 }],
    ['a missing field', { horizontal_m_s: 3 }],
    ['an unknown field', { horizontal_m_s: 3, up_m_s: 1, spin: 2 }],
  ])('refuses %s', (_n, push) => {
    expect(validate(withPush(push))).toBe(false);
  });
});
