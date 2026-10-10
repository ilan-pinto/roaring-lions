// E5 special forces: the staged drafts in docs/campaign/special_units/e5.
//
// Three bought-only units (Zikit, Tzav, Peten gunship), approved and priced. The Zikit and
// the Gunship LANDED (GH-181 part 2, 2026-10-01): their JSON is in data/units/kdf and their
// meshes are out of HELD_MESH_FILES. The Tzav stays staged here because its placed charge is
// sim work (E6 G1, Stage 4): a landed Tzav would be a bought carrier that cannot do its one
// job. "No art-less unit ships" and its mirror, "no unit ships without the rest of its seam",
// are why the move is one commit per unit. This spec keeps both halves honest:
//   - they parse against the shipped unit schema;
//   - they are bought-only (`unlock` is exactly `{ price }`, credits, nothing else);
//   - the price sits in the prices.md section 8 band;
//   - no staged id is already a shipped unit -- the "half-landed" pin. A file must
//     leave staging in the same commit that adds it to data/units/kdf;
//   - the mirror pin: a LANDED id has no staged twin, is registered in `units`, is bought-only
//     in the same band, and its mesh is out of HELD_MESH_FILES (a staged one is still held).
import { spawnSync } from 'node:child_process';
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

const E5_IDS = ['recon_zikit', 'demo_tzav', 'heli_peten_gunship'] as const;
const LANDED_IDS = E5_IDS.filter((id) => Object.keys(units).includes(id));
const CATALOGUE = readFileSync(join(ROOT, 'packages', 'app', 'src', 'mesh-catalogue.ts'), 'utf8');
const HELD_BLOCK = /HELD_MESH_FILES[^=]*=\s*\{([\s\S]*?)\n\};/.exec(CATALOGUE)?.[1] ?? '';
const MESH_FILE: Record<string, string> = {
  recon_zikit: 'recon_zikit.glb',
  demo_tzav: 'vehicles/demo_tzav.glb',
  heli_peten_gunship: 'vehicles/heli_peten_gunship.glb',
};

describe('E5 special forces: staged and landed partition the three approved units', () => {
  it('every approved unit is exactly one of staged or landed', () => {
    const stagedIds = staged.map((s) => s.json.id);
    expect([...stagedIds, ...LANDED_IDS].sort()).toEqual([...E5_IDS].sort());
  });

  it('the held-mesh block was actually read (a vacuous regex would pass every pin below)', () => {
    expect(HELD_BLOCK).toContain('officer_infantry.glb');
  });

  for (const id of E5_IDS) {
    const landed = LANDED_IDS.includes(id);
    it(`${id}: ${landed ? 'landed -- mesh un-held, bought-only, in band' : 'staged -- mesh still held'}`, () => {
      const held = HELD_BLOCK.includes(`'${MESH_FILE[id]}'`);
      expect(held, `${id} mesh held=${held}`).toBe(!landed);
      if (landed) {
        const u = (units as unknown as Record<string, { unlock?: Record<string, unknown> }>)[id];
        expect(Object.keys(u?.unlock ?? {}), 'unlock must be price-only').toEqual(['price']);
        const price = u?.unlock?.price as number;
        expect(price).toBeGreaterThanOrEqual(4000);
        expect(price).toBeLessThanOrEqual(8000);
        expect(staged.map((s) => s.json.id)).not.toContain(id);
        expect(CATALOGUE).toContain(`${id}:`);
      }
    });
  }
});

describe('E5 staged special-forces units', () => {
  it('stages the Tzav until E6 lands its placed charge', () => {
    expect(staged.map((s) => s.json.id)).toEqual(['demo_tzav']);
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

// `--also` overlapping `--units` (CI passes data/units to one and a staging dir to the other;
// an operator can pass the same dir to both) must not put a unit on the curve twice.
describe('validate_balance.py --also', () => {
  const sampleCount = (args: string[]): string | undefined => {
    const r = spawnSync('python3', ['tools/validate_balance.py', '--units', 'data/units', ...args], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    return /\(n=(\d+)\)/.exec(r.stdout)?.[1];
  };

  it('does not double-count a directory already under --units', () => {
    const plain = sampleCount([]);
    expect(plain).toBeDefined();
    expect(sampleCount(['--also', 'data/units'])).toBe(plain);
  });
});
