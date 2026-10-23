// GH-705 smoke uplift P2: the flipbook layer's new schema members -- the `spark`
// type, `oil` (0..1) and `low_fraction` -- accepted when well-formed and refused
// when not. Falsify: delete "spark" from the enum, or the `maximum` on `oil`, and
// the matching case goes red.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import AjvModule from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const Ajv2020 = (AjvModule as unknown as { default?: typeof AjvModule }).default ?? AjvModule;
const ajv = new (Ajv2020 as unknown as new (o: object) => { compile: (s: object) => (d: unknown) => boolean })({
  allErrors: true,
  strict: false,
});
const validate = ajv.compile(JSON.parse(readFileSync(join(ROOT, 'data', 'schemas', 'vfx_emitter.schema.json'), 'utf8')) as object);

const layer = (extra: object): object => ({
  type: 'smoke',
  count: 4,
  delay_ms: [0, 0],
  duration_ms: [100, 200],
  scale: { base: 1 },
  velocity: { radial: [0, 0], up: [0, 0] },
  ...extra,
});
const shipped = JSON.parse(readFileSync(join(ROOT, 'data', 'vfx', 'catastrophic_kill.json'), 'utf8')) as object;
const emitter = (l: object): object => ({ ...shipped, flipbook: [l] });

it('the shipped kill recipe itself validates (the fixtures below differ from it in one member)', () => {
  expect(validate(shipped)).toBe(true);
});

describe('vfx_emitter flipbook layer (P2 members)', () => {
  it('accepts spark, oil and low_fraction', () => {
    expect(validate(emitter(layer({ type: 'spark' })))).toBe(true);
    expect(validate(emitter(layer({ oil: 1 })))).toBe(true);
    expect(validate(emitter(layer({ oil: 0.01 })))).toBe(true);
    expect(validate(emitter(layer({ low_fraction: 0.5 })))).toBe(true);
  });
  it('refuses oil above 1 or below 0, a bad low_fraction, and an unknown type', () => {
    expect(validate(emitter(layer({ oil: 1.01 })))).toBe(false);
    expect(validate(emitter(layer({ oil: -0.1 })))).toBe(false);
    expect(validate(emitter(layer({ oil: 0 })))).toBe(false);
    expect(validate(emitter(layer({ low_fraction: 0 })))).toBe(false);
    expect(validate(emitter(layer({ low_fraction: 1.5 })))).toBe(false);
    expect(validate(emitter(layer({ type: 'plasma' })))).toBe(false);
  });
});
