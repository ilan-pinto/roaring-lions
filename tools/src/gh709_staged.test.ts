// GH-709 special units: the staged drafts in docs/campaign/special_units/gh709.
//
// Nine credit-only units, approved and priced by the lead on 22 Oct 2026
// (docs/superpowers/specs/2026-10-22-special-units-design.md, "Lead rulings"). None has art
// yet, and five need an engine concept that is not built (E1 unit aura, E2 the `indirect`
// weapon flag, E3 submunitions), so all nine are STAGED: their JSON lives here, not in
// data/units/kdf, until the phase that lands each unit's art (and engine) moves it, in one
// commit. This spec is the E5 guard (`e5_staged.test.ts`) for this set:
//   - the staged set is exactly the nine the lead approved -- the AA team is held until E6
//     (GH-274) and the camouflaged rifle squad is not built, and neither may be staged;
//   - every draft parses against the shipped unit schema (so a draft that needs E1-E3 is
//     staged WITHOUT its engine field, which the schema would refuse, and gains it in its
//     engine phase);
//   - bought-only: `unlock` is exactly `{ price }`, inside the prices.md section 8 band;
//   - not half-landed: no staged id is already a shipped unit;
//   - the mirror pin: a LANDED id has no staged twin, is registered in `units`, is
//     bought-only in the same band, and is named in mesh-catalogue.ts and not held there.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import AjvModule from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { units } from '@lions/data';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STAGED = join(ROOT, 'docs', 'campaign', 'special_units', 'gh709');

const Ajv2020 = (AjvModule as unknown as { default?: typeof AjvModule }).default ?? AjvModule;
const ajv = new (Ajv2020 as unknown as new (o: object) => {
  addSchema: (s: object) => unknown;
  compile: (s: object) => ((d: unknown) => boolean) & { errors?: unknown };
})({ allErrors: true, strict: false });
ajv.addSchema(JSON.parse(readFileSync(join(ROOT, 'data', 'schemas', 'common.schema.json'), 'utf8')) as object);
const validate = ajv.compile(
  JSON.parse(readFileSync(join(ROOT, 'data', 'schemas', 'unit.schema.json'), 'utf8')) as object,
);

interface Staged {
  id: string;
  name: string;
  blurb: string;
  faction: string;
  unlock: Record<string, unknown>;
}

const files = readdirSync(STAGED).filter((f) => f.endsWith('.json')).sort();
const staged = files.map((f) => ({
  file: f,
  json: JSON.parse(readFileSync(join(STAGED, f), 'utf8')) as Staged,
}));

/** The nine the lead approved on 22 Oct. */
const GH709_IDS = [
  'air_medevac_heli',
  'at_nlos_team',
  'inf_grenadier',
  'inf_medic_squad',
  'mbt_lavi_camo',
  'spg_cluster',
  'spg_long_range',
  'ugv_recon_dog',
  'veh_ambulance',
] as const;
/** Ruled out of this set: Q3 holds the AA team until E6 (GH-274); Q9 drops the camo squad. */
const NOT_IN_SET = ['inf_aa_missile', 'inf_rifle_camo'] as const;

const shipped = units as unknown as Record<string, { unlock?: Record<string, unknown> }>;
const LANDED_IDS = GH709_IDS.filter((id) => id in shipped);
const CATALOGUE = readFileSync(join(ROOT, 'packages', 'app', 'src', 'mesh-catalogue.ts'), 'utf8');
const HELD_BLOCK = /HELD_MESH_FILES[^=]*=\s*\{([\s\S]*?)\n\};/.exec(CATALOGUE)?.[1] ?? '';

const BAND = [4000, 8000] as const;

describe('GH-709: staged and landed partition the nine approved units', () => {
  it('every approved unit is exactly one of staged or landed', () => {
    const stagedIds = staged.map((s) => s.json.id);
    expect([...stagedIds, ...LANDED_IDS].sort()).toEqual([...GH709_IDS].sort());
  });

  it('file names match ids', () => {
    for (const { file, json } of staged) expect(file).toBe(`${json.id}.json`);
  });

  it('the held AA team and the dropped camo squad are neither staged nor shipped', () => {
    const stagedIds = staged.map((s) => s.json.id);
    for (const id of NOT_IN_SET) {
      expect(stagedIds, id).not.toContain(id);
      expect(id in shipped, id).toBe(false);
    }
  });

  it('the held-mesh block was actually read (a vacuous regex would pass every landed pin)', () => {
    expect(HELD_BLOCK).toContain('officer_infantry.glb');
  });

  for (const id of LANDED_IDS) {
    it(`${id}: landed -- registered, bought-only, in band, catalogued, mesh not held`, () => {
      const u = shipped[id];
      expect(Object.keys(u?.unlock ?? {}), 'unlock must be price-only').toEqual(['price']);
      const price = u?.unlock?.price as number;
      expect(price).toBeGreaterThanOrEqual(BAND[0]);
      expect(price).toBeLessThanOrEqual(BAND[1]);
      expect(CATALOGUE).toContain(`${id}:`);
      expect(HELD_BLOCK).not.toMatch(new RegExp(`['/]${id}\\.glb'`));
    });
  }
});

describe('GH-709 staged special units', () => {
  it('stages the nine (none has landed yet)', () => {
    // Update this line, not the partition above, when a unit lands with its art.
    expect(staged.map((s) => s.json.id)).toEqual(GH709_IDS.filter((id) => !LANDED_IDS.includes(id)));
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
        expect(price as number).toBeGreaterThanOrEqual(BAND[0]);
        expect(price as number).toBeLessThanOrEqual(BAND[1]);
      });

      it('is not half-landed', () => {
        expect(json.id in shipped, `staged id ${json.id} is already in units`).toBe(false);
      });

      it('carries a player-facing name and blurb (no working placeholder)', () => {
        expect(json.name.trim().length).toBeGreaterThan(0);
        expect(json.blurb.trim().length).toBeGreaterThan(8);
      });
    });
  }
});
