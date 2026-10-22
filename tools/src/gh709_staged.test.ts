// GH-709 special units: the staged drafts in docs/campaign/special_units/gh709.
//
// Nine credit-only units, approved and priced by the lead on 22 Oct 2026
// (docs/superpowers/specs/2026-10-22-special-units-design.md, "Lead rulings"). Each is STAGED
// here, not in data/units/kdf, until the phase that lands its art (and engine) moves it, in one
// commit. Phase 2 landed `mbt_lavi_camo` and `spg_long_range`, Phase 3 `inf_grenadier`, Phase 7
// `at_nlos_team` and `spg_cluster`, Phase 8 `ugv_recon_dog`. LANDED besides: `veh_ambulance` and
// `air_medevac_heli` (GH-707 P2, 22 Oct), each with its GLB, its recipes and its catalogue entry;
// both are held out of versus (`VERSUS_HELD_UNITS`) because a `can_carry` type turns the wound
// hash fold on. `inf_medic_squad` landed after them (GH-707 P2, 22 Oct), the same way: its GLB,
// `tools/units/import_meshy_medic_team.py`, the `rescue.ts` motion step, its catalogue entry,
// and the same versus hold (a `rescue` block does the same to the hash). All nine have landed.
// This spec is the E5 guard (`e5_staged.test.ts`) for this set:
//   - the staged set is exactly the nine the lead approved -- the AA team is held until E6
//     (GH-274) and the camouflaged rifle squad is not built, and neither may be staged;
//   - every draft parses against the shipped unit schema (a draft that needs E1 is staged
//     WITHOUT its engine field until E1 lands; E2 and E3 have landed (GH-733), so
//     at_nlos_team carries `indirect` and spg_cluster its `submunitions` block);
//   - bought-only: `unlock` is exactly `{ price }`, inside the prices.md section 8 band;
//   - not half-landed: no staged id is already a shipped unit;
//   - the mirror pin: a LANDED id has no staged twin, is registered in `units`, is
//     bought-only in the same band, and is named in mesh-catalogue.ts and not held there.
import { spawnSync } from 'node:child_process';
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
  it('stages none: Phase 2 landed the Lavi Ambush Tank and the Te\'o Howitzer, Phase 3 the Chomet grenadiers, Phase 7 the Zaron Missile Team and the Te\'o Cluster Howitzer, Phase 8 the Chadaf robot, GH-707 P2 the ambulance, the medevac and the medic team', () => {
    // Update these lines, not the partition above, when a unit lands with its art. Named, so a
    // unit that vanished from both places cannot pass as "landed".
    expect([...LANDED_IDS]).toEqual([
      'air_medevac_heli', 'at_nlos_team', 'inf_grenadier', 'inf_medic_squad', 'mbt_lavi_camo',
      'spg_cluster', 'spg_long_range', 'ugv_recon_dog', 'veh_ambulance',
    ]);
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

// Phase 7 (GH-733's open finding): the cost curve reads E2's `indirect` reach and E3's
// bomblet block. tools/validate_balance.py is Python, so these specs run its functions in a
// subprocess against the landed units in data/units/kdf (both landed in Phase 7) and pin its
// mirrored sim constants to tuning.ts.
describe('validate_balance.py reads the E2 flag and the E3 bomblets', () => {
  const PROBE = String.raw`
import json, sys, copy
sys.path.insert(0, 'tools')
import validate_balance as v
st = 'docs/campaign/special_units/gh709/'
cl = json.load(open('data/units/kdf/spg_cluster.json'))  # landed in Phase 7 (GH-709)
nl = json.load(open('data/units/kdf/at_nlos_team.json'))  # landed in Phase 7
def off(u): return v.offense_score(u)
def mut(u, f):
    u = copy.deepcopy(u); f(u['weapons'][0]); return u
def dbl(w): w['submunitions']['damage'] *= 2
def parent(w): w['damage'] = 9999; w['splash_tiles'] = 4
def armour(w): w['submunitions']['damage'] = 1e9
def noflag(w): w.pop('indirect', None)
def asmortar(w): w.pop('indirect', None); w['type'] = 'mortar'
print(json.dumps({
  'scatterBase': v.SUB_SCATTER_BASE, 'softLimit': v.SUB_SOFT_ARMOR_LIMIT,
  'reach0': v.bomblet_reach(2.5, 0.8, 0.0, 0.0),
  'cluster': off(cl), 'clusterDbl': off(mut(cl, dbl)), 'clusterParent': off(mut(cl, parent)),
  'clusterHuge': off(mut(cl, armour)),
  'nlos': off(nl), 'nlosNoFlag': off(mut(nl, noflag)),
  'reach': [v.standoff_range(w['weapons'][0]) for w in (nl, mut(nl, noflag), mut(nl, asmortar))],
  'ranges': [nl['weapons'][0]['range_tiles'], nl['weapons'][0]['effective_range_tiles']],
  'cap': v.MAX_ENGAGE_RATE, 'mix': v.TARGET_MIX, 'supMax': v.SUP_MAX_VALUE,
  'standoff': 1 + __import__('math').log1p(cl['weapons'][0]['range_tiles']) * 0.25,
}))
`;
  const run = spawnSync('python3', ['-c', PROBE], { cwd: ROOT, encoding: 'utf8' });
  const r = JSON.parse(run.stdout || '{}') as {
    scatterBase: number; softLimit: number; reach0: number[]; cluster: number; clusterDbl: number;
    clusterParent: number; clusterHuge: number; nlos: number; nlosNoFlag: number; reach: number[];
    ranges: number[]; cap: number; mix: number[][]; supMax: number; standoff: number;
  };
  const tuning = readFileSync(join(ROOT, 'packages', 'sim', 'src', 'tuning.ts'), 'utf8');
  const fxConst = (name: string): number => {
    const m = new RegExp(`export const ${name} = (\\d+);`).exec(tuning);
    expect(m, name).not.toBeNull();
    return Number(m?.[1]) / 65536;
  };

  it('the probe ran', () => {
    expect(run.status, run.stderr).toBe(0);
  });

  it('mirrors SCATTER_BASE and SOFT_ARMOR_LIMIT from tuning.ts', () => {
    expect(r.scatterBase).toBe(fxConst('SCATTER_BASE'));
    expect(r.softLimit).toBe(fxConst('SOFT_ARMOR_LIMIT'));
  });

  it('a bomblet burst on the target reaches it with P = splash/scatter and mean falloff half that', () => {
    // radius U[0, scatter): P(r < splash) = 0.32, E[(1 - r/splash) 1{r < splash}] = 0.16.
    expect(r.reach0[0]).toBeCloseTo(0.32, 1);
    expect(Math.abs(r.reach0[0] - 0.32)).toBeLessThan(0.01);
    expect(Math.abs(r.reach0[1] - 0.16)).toBeLessThan(0.005);
  });

  it('the cluster round is priced on its bomblets, not on the unread parent damage and splash', () => {
    expect(r.clusterDbl).toBeGreaterThan(r.cluster);
    expect(r.clusterParent).toBe(r.cluster);
  });

  it('bomblets score against soft targets only: unbounded damage saturates on the soft share', () => {
    // Every class but the 8 mm infantry row is at or over the sim's 30 mm soft limit, so the
    // kill term tops out at the soft share of the cap; suppression adds at most supMax.
    const soft = r.mix.filter((row) => row[0] < r.softLimit).reduce((a, row) => a + row[2], 0);
    expect(soft).toBeCloseTo(0.4, 6);
    const ceiling = (soft * r.cap + r.supMax) * r.standoff;
    expect(r.clusterHuge).toBeLessThanOrEqual(ceiling + 1e-9);
    expect(r.clusterHuge).toBeGreaterThan(soft * r.cap * r.standoff);
  });

  it('an indirect weapon prices its whole range: the flag, or the mortar class, and not neither', () => {
    expect(r.nlos).toBeGreaterThan(r.nlosNoFlag);
    // The flag and the mortar class both read range_tiles (24); the bare atgm reads its
    // effective range (18), as every direct weapon does.
    expect(r.reach).toEqual([r.ranges[0], r.ranges[1], r.ranges[0]]);
    expect(r.ranges[0]).toBeGreaterThan(r.ranges[1]);
  });
});
