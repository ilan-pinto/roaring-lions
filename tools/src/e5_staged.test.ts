// E5 special forces: the staged drafts in docs/campaign/special_units/e5.
//
// Three bought-only units (Zikit, Tzav, Peten gunship), approved and priced. The Zikit and
// the Gunship LANDED (GH-181 part 2, 2026-10-01): their JSON is in data/units/kdf and their
// meshes are out of HELD_MESH_FILES. The Tzav stayed staged until its placed charge landed
// (E6 G1, PR 778: a landed Tzav would have been a bought carrier that cannot do its one job)
// and then landed with its probes, its tracks and its plate (GH-274, closing GH-156), so
// staging is empty and only `numbers.md` is left in the directory. "No art-less unit ships"
// and its mirror, "no unit ships without the rest of its seam", are why the move is one
// commit per unit. This spec keeps both halves honest:
//   - they parse against the shipped unit schema;
//   - they are bought-only (`unlock` is exactly `{ price }`, credits, nothing else);
//   - the price sits in the prices.md section 8 band;
//   - no staged id is already a shipped unit -- the "half-landed" pin. A file must
//     leave staging in the same commit that adds it to data/units/kdf;
//   - the mirror pin: a LANDED id has no staged twin, is registered in `units`, is bought-only
//     in the same band, and its mesh is out of HELD_MESH_FILES (a staged one is still held).
//
// Since GH-1382 this file also holds the GENERIC staging guard, over every directory under
// docs/campaign/special_units (e5, gh709, gh1382, and any added later): every staged JSON parses
// against the unit schema, is named for its id, is not half-landed, and is fitted on the cost
// curve inside the band; and CI's every staged `--also` invocation names every directory. Then
// the GH-1382 set's own pins (the three new Sarim units: curve-priced, unbuyable, no `unlock`).
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import AjvModule from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { units } from '@lions/data';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STAGED = join(ROOT, 'docs', 'campaign', 'special_units', 'e5');

const Ajv2020 = (AjvModule as unknown as { default?: typeof AjvModule }).default ?? AjvModule;
const ajv = new (Ajv2020 as unknown as new (o: object) => {
  addSchema: (s: object) => unknown;
  compile: (s: object) => ((d: unknown) => boolean) & { errors?: unknown };
})({ allErrors: true, strict: false });
// unit.schema.json refers to the shared unlock def by relative $ref (common.schema.json).
ajv.addSchema(JSON.parse(readFileSync(join(ROOT, 'data', 'schemas', 'common.schema.json'), 'utf8')) as object);
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
  it('has nothing left in staging: all three E5 units landed', () => {
    expect(staged.map((s) => s.json.id)).toEqual([]);
  });

  // The Tzav's one job, as the numbers the lead approved on 29 Sep (numbers.md, Q1 and Q4),
  // read from the SHIPPED unit. The literals are the oracle: they are not imported from the
  // JSON they judge.
  it('the landed Tzav carries the approved placed charge', () => {
    const t = units.demo_tzav as unknown as {
      demolition_method: string;
      demolition_time_s: number;
      placed_charge: Record<string, number>;
      abilities: string[];
    };
    expect(t.demolition_method).toBe('placed');
    expect(t.demolition_time_s).toBe(3.0);
    expect(t.placed_charge).toEqual({ fuse_s: 8, blast_tiles: 2.5, damage: 300, suppression: 120, withdraw_tiles: 4 });
    expect(t.abilities).toContain('demolish');
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

// ---------------------------------------------------------------------------------------------
// The generic staging guard (GH-1382): every staged directory, whatever set it belongs to.
// ---------------------------------------------------------------------------------------------
const SPECIAL = join(ROOT, 'docs', 'campaign', 'special_units');
const STAGED_DIRS = readdirSync(SPECIAL)
  .filter((d) => statSync(join(SPECIAL, d)).isDirectory())
  .sort();
const ALL_STAGED = STAGED_DIRS.flatMap((dir) =>
  readdirSync(join(SPECIAL, dir))
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => ({
      dir,
      file,
      json: JSON.parse(readFileSync(join(SPECIAL, dir, file), 'utf8')) as { id: string },
    })),
);
const BAND_TOLERANCE = 0.18; // validate_balance.py's default --tolerance, which CI runs at.
// The ids ON DISK under data/units, read from the files: `units` is the registered list, so a
// file copied into data/units without its registration would slip past a pin on `units` alone.
const UNIT_FILE_IDS = (readdirSync(join(ROOT, 'data', 'units'), { recursive: true }) as string[])
  .filter((f) => f.endsWith('.json'))
  .map((f) => (JSON.parse(readFileSync(join(ROOT, 'data', 'units', f), 'utf8')) as { id: string }).id);

describe('every staged directory under docs/campaign/special_units', () => {
  it('the directory walk found the known sets (an empty walk would pass every pin below)', () => {
    expect(STAGED_DIRS).toEqual(expect.arrayContaining(['e5', 'gh709', 'gh1382']));
    expect(UNIT_FILE_IDS).toEqual(expect.arrayContaining(['sarim_rifles', 'mbt_lavi']));
  });

  it("is named by every one of CI's staged --also cost-curve invocations", () => {
    const ci = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
    const lines = ci.split('\n').filter((l) => /validate_balance\.py/.test(l) && /--also/.test(l));
    // The plain one and the two max-tier ones (--branch=1, --branch=2).
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const line of lines) {
      for (const dir of STAGED_DIRS) {
        expect(line, `ci.yml does not fit ${dir}: ${line.trim()}`).toContain(
          `--also docs/campaign/special_units/${dir}`,
        );
      }
    }
  });

  for (const { dir, file, json } of ALL_STAGED) {
    describe(`${dir}/${file}`, () => {
      it('validates against unit.schema.json', () => {
        expect(validate(json), JSON.stringify(validate.errors)).toBe(true);
      });
      it('is named for its id', () => {
        expect(file).toBe(`${json.id}.json`);
      });
      it('is not half-landed: neither registered in units nor a file under data/units', () => {
        expect(Object.keys(units).includes(json.id), `staged id ${json.id} is already in units`).toBe(false);
        expect(UNIT_FILE_IDS, `staged id ${json.id} already has a file under data/units`).not.toContain(json.id);
      });
    });
  }

  // One fit over the shipped roster plus every staged directory, as CI's plain --also line does.
  // Each staged id must appear as a row (a glob that misses the files would otherwise pass) and
  // sit inside the band.
  it('fits every staged unit on the cost curve inside the band', () => {
    const r = spawnSync(
      'python3',
      [
        'tools/validate_balance.py',
        '--units',
        'data/units',
        ...STAGED_DIRS.flatMap((d) => ['--also', `docs/campaign/special_units/${d}`]),
        '--report',
      ],
      { cwd: ROOT, encoding: 'utf8' },
    );
    const dev = new Map<string, number>();
    for (const m of r.stdout.matchAll(/^(\S+)\s+[\d.]+\s+\d+\s+\d+\s+([+-][\d.]+)%$/gm)) {
      dev.set(m[1] as string, Number(m[2]) / 100);
    }
    expect(dev.size, r.stdout + r.stderr).toBeGreaterThan(0);
    for (const { json } of ALL_STAGED) {
      const d = dev.get(json.id);
      expect(d, `${json.id} is not on the fitted curve`).toBeDefined();
      expect(Math.abs(d as number), `${json.id} is ${((d as number) * 100).toFixed(1)}% off the curve`).toBeLessThanOrEqual(
        BAND_TOLERANCE,
      );
    }
  });
});

// ---------------------------------------------------------------------------------------------
// GH-1382: the three new Sarim units (docs/superpowers/specs/2026-11-17-sarim-roster-design.md
// §2.3, the lead's rulings of 19 Nov). Staged until their art lands; then each moves to
// data/units/enemy in the commit that adds its GLB. They land UNBUYABLE (Q7): the Sarim menu
// is not edited until GH-1381's probe ruling (slice S5), so no doctrine menu may name them.
// The literals below are the oracle: they are the lead's numbers, not read from the JSON.
// ---------------------------------------------------------------------------------------------
const GH1382_IDS = ['hmg_team', 'observer_team', 'sarim_carrier'] as const;
const GH1382_STAGED = ALL_STAGED.filter((s) => s.dir === 'gh1382').map(
  (s) => s.json as unknown as Record<string, unknown> & { id: string },
);
const GH1382_LANDED = GH1382_IDS.filter((id) => Object.keys(units).includes(id));
const DOCTRINES = join(ROOT, 'data', 'doctrines');
const MENUS = readdirSync(DOCTRINES)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(DOCTRINES, f), 'utf8')) as { id: string; menu: string[] });

describe('GH-1382: staged and landed partition the three new Sarim units', () => {
  it('every new unit is exactly one of staged or landed', () => {
    expect([...GH1382_STAGED.map((s) => s.id), ...GH1382_LANDED].sort()).toEqual([...GH1382_IDS]);
  });

  it('the doctrine menus were actually read', () => {
    expect(MENUS.map((m) => m.id).sort()).toEqual(['kdf', 'sarim']);
    expect(MENUS.find((m) => m.id === 'sarim')?.menu).toContain('sarim_rifles');
  });

  it('no doctrine menu names one (Q7: they land unbuyable; the menu waits for GH-1381)', () => {
    for (const m of MENUS) for (const id of GH1382_IDS) expect(m.menu, `${m.id} menu`).not.toContain(id);
  });

  for (const id of GH1382_LANDED) {
    it(`${id}: landed -- catalogued`, () => {
      expect(CATALOGUE).toContain(`${id}:`);
    });
  }
});

describe('GH-1382 staged Sarim units', () => {
  for (const u of GH1382_STAGED) {
    describe(u.id, () => {
      it('is Sarim', () => {
        expect(u.faction).toBe('sarim');
      });
      it('is curve-priced, not bought: no unlock, no upgrades (kdf only)', () => {
        expect(u).not.toHaveProperty('unlock');
        expect(u).not.toHaveProperty('upgrades');
        expect((u.cost as { logistics: number }).logistics).toBeGreaterThan(0);
      });
      it('carries a player-facing name and blurb', () => {
        expect(String(u.name).trim().length).toBeGreaterThan(0);
        expect(String(u.blurb).trim().length).toBeGreaterThan(8);
      });
    });
  }

  it('the two teams author wheeled: false (recon is not a FOOT_ROLE)', () => {
    for (const u of GH1382_STAGED.filter((s) => s.id !== 'sarim_carrier')) {
      expect((u.mobility as { wheeled?: boolean }).wheeled, u.id).toBe(false);
    }
  });

  it('the carrier is the ruled HMG Tracked Carrier (Q3): armour 130/70/45, two seats, 445 logistics', () => {
    const c = GH1382_STAGED.find((s) => s.id === 'sarim_carrier');
    if (!c) return; // landed: data/units carries it, and the partition above says so
    const hull = c.hull as { armor: Record<string, number>; transport_slots: number };
    expect(hull.armor).toEqual({ front: 130, side: 70, rear: 45 });
    expect(hull.transport_slots).toBe(2);
    expect((c.cost as { logistics: number }).logistics).toBe(445);
    expect(c.name).toBe('Tracked Carrier');
  });
});
