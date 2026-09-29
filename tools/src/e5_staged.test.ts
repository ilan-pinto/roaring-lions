// E5 special forces: the staged drafts in docs/campaign/special_units/e5.
//
// The three units (Zikit, Tzav, Peten gunship) are approved and priced but have no art
// yet, and "no art-less unit ships". So their JSON lives outside data/units until the
// landing task moves each file in together with its GLB, sheet and catalogue entry.
// This spec keeps the staged files honest in the meantime:
//   - they parse against the shipped unit schema;
//   - they are bought-only (`unlock` is exactly `{ price }`, credits, nothing else);
//   - the price sits in the prices.md section 8 band;
//   - no staged id is already a shipped unit -- the "half-landed" pin. A file must
//     leave staging in the same commit that adds it to data/units/kdf.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import AjvModule from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { units } from '@lions/data';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STAGED = join(ROOT, 'docs', 'campaign', 'special_units', 'e5');

const Ajv2020 = (AjvModule as unknown as { default?: typeof AjvModule }).default ?? AjvModule;
const ajv = new (Ajv2020 as unknown as new (o: object) => {
  compile: (s: object) => ((d: unknown) => boolean) & { errors?: unknown };
})({ allErrors: true, strict: false });
const validate = ajv.compile(
  JSON.parse(readFileSync(join(ROOT, 'data', 'schemas', 'unit.schema.json'), 'utf8')) as object,
);

interface Staged {
  id: string;
  faction: string;
  unlock: Record<string, unknown>;
}

const files = readdirSync(STAGED).filter((f) => f.endsWith('.json')).sort();
const staged = files.map((f) => ({
  file: f,
  json: JSON.parse(readFileSync(join(STAGED, f), 'utf8')) as Staged,
}));

describe('E5 staged special-forces units', () => {
  it('stages at least the three approved units', () => {
    expect(staged.map((s) => s.json.id)).toEqual(
      expect.arrayContaining(['recon_zikit', 'demo_tzav', 'heli_peten_gunship']),
    );
  });

  for (const { file, json } of staged) {
    describe(file, () => {
      it('validates against unit.schema.json', () => {
        expect(validate(json), JSON.stringify(validate.errors)).toBe(true);
      });

      it('is KDF', () => {
        expect(json.faction).toBe('kdf');
      });

      it('is bought-only: unlock must be price-only', () => {
        expect(Object.keys(json.unlock), 'unlock must be price-only').toEqual(['price']);
      });

      it('is priced inside the 4000-8000 band', () => {
        const price = json.unlock.price;
        expect(typeof price).toBe('number');
        expect(price as number).toBeGreaterThanOrEqual(4000);
        expect(price as number).toBeLessThanOrEqual(8000);
      });

      it('is not half-landed', () => {
        expect(
          Object.keys(units).includes(json.id),
          `staged id ${json.id} is already in units`,
        ).toBe(false);
      });
    });
  }
});
