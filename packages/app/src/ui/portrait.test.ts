// Which picture stands in for a unit in the HUD and the garage: the Blender
// portraits (`unitIcon`) and the garage plates (`unitPlate`). The sheet-frame
// picker (`portraitFile`/`portraitUrl`) and the cropped-icon manifest pin
// went with the sprite sheets (WP-A3.3).

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { KIT_PLATE_LEVEL, portraitIds, unitIcon, unitPlate, type PlateCatalogue, type UnitPortraits } from './portrait';

describe('unitIcon (GH-153: the Blender portrait, or nothing)', () => {
  const portraits: Record<string, UnitPortraits> = {
    inf_squad: {
      full: { url: '/p/inf_squad.png', size: 192, extent: [160, 170] },
      lead: { url: '/p/lead/inf_squad.png', size: 192, extent: [60, 170] },
    },
    mbt_lavi: { full: { url: '/p/mbt_lavi.png', size: 192, extent: [177, 110] } },
  };

  it('gives a chip the lead figure, and every larger slot the whole team', () => {
    expect(unitIcon('inf_squad', 'chip', portraits)?.url).toBe('/p/lead/inf_squad.png');
    expect(unitIcon('inf_squad', 'full', portraits)?.url).toBe('/p/inf_squad.png');
  });

  it('gives a chip the whole portrait when the type has no lead figure (a vehicle)', () => {
    expect(unitIcon('mbt_lavi', 'chip', portraits)?.url).toBe('/p/mbt_lavi.png');
  });

  it('is null for a type with no portrait -- no sheet crop is consulted any more', () => {
    expect(unitIcon('civilians', 'full', portraits)).toBeNull();
    expect(unitIcon('militia_cell', 'chip', portraits)).toBeNull();
  });

  it('reads the shipped portraits by default, lead figure included', () => {
    expect(unitIcon('inf_squad', 'full')?.url).toContain('inf_squad');
    expect(unitIcon('inf_squad', 'chip')?.url).toContain('lead');
    expect(unitIcon('recon_zikit', 'full')?.size).toBe(192);
    // The last nine: once sprite-crop fallbacks, Blender portraits since 4 Oct.
    expect(unitIcon('militia_cell', 'chip')?.url).toContain('lead');
    expect(unitIcon('technical', 'chip')?.url).toContain('technical');
  });
});

// Every unit in `data/units` must have a picture or be NAMED as not having
// one. Read off disk -- the content directory, the portrait manifest, the
// shipped PNGs -- so a unit added to `data/units` with no portrait, or a
// portrait PNG deleted, is a red spec rather than a quiet hatch in the HUD.
// Falsified 2 Oct by moving `mbt_lavi.png`, then `lead/at_team.png`, aside:
// red both times, naming the file.
describe('unit portrait coverage (GH-153)', () => {
  const ROOT = path.join(__dirname, '../../../..');
  /** Types with no picture at all: the HUD draws the role mark on the hatch. */
  const NO_PICTURE = new Set(['civilians']);
  /** Figure teams with a portrait: each must also ship the one-figure chip
   *  variant. A literal, not derived from the manifest under test. */
  const FIGURE_TEAMS = [
    'inf_squad',
    'at_team',
    'mortar_team',
    'sniper_team',
    'demo_squad',
    'breach_team',
    'yahalom_squad',
    'recon_zikit',
    'sarim_rifles',
    'atgm_cell',
    'manpad_team',
    'recoilless_team',
    // A3.3 step 1 (4 Oct). `moto_rpg` and `digger_crew` are one-figure rigs
    // (one root each) and ship the team picture only, so they are not here.
    'militia_cell',
    'rpg_team',
    'mortar_crew',
    'charge_squad',
  ];
  /** One-figure rigs: a team portrait and deliberately NO lead variant. */
  const ONE_FIGURE = ['moto_rpg', 'digger_crew'];

  const unitFiles = (dir: string): string[] =>
    fs
      .readdirSync(dir, { withFileTypes: true })
      .flatMap((e) =>
        e.isDirectory() ? unitFiles(path.join(dir, e.name)) : e.name.endsWith('.json') ? [path.join(dir, e.name)] : []
      );
  const unitIds = unitFiles(path.join(ROOT, 'data/units'))
    .flatMap((f) => {
      const j = JSON.parse(fs.readFileSync(f, 'utf8')) as { id?: string } | { id?: string }[];
      return Array.isArray(j) ? j : [j];
    })
    .map((u) => u.id)
    .filter((id): id is string => typeof id === 'string');
  const shipDir = path.join(ROOT, 'assets/ui/portraits/units');
  const manifest = (
    JSON.parse(fs.readFileSync(path.join(shipDir, 'manifest.json'), 'utf8')) as {
      portraits: Record<string, { file: string; lead?: { file: string } }>;
    }
  ).portraits;

  it('every unit has a Blender portrait on disk -- no sprite-crop fallback remains', () => {
    // Vacuity guard: 19 KDF + 15 enemy + civilians today.
    expect(unitIds.length).toBeGreaterThan(30);
    const bad: string[] = [];
    for (const id of unitIds) {
      if (NO_PICTURE.has(id)) continue;
      const entry = manifest[id] as { file: string } | undefined;
      if (entry === undefined) bad.push(`${id}: no portrait`);
      else if (!fs.existsSync(path.join(shipDir, entry.file))) bad.push(`${id}: ${entry.file} missing`);
    }
    expect(bad).toEqual([]);
  });

  it('a type named as having no picture really has none', () => {
    const stale = [...NO_PICTURE].filter((id) => id in manifest);
    expect(stale, 'delete these from NO_PICTURE').toEqual([]);
  });

  it('a one-figure rig ships its team portrait and no lead variant', () => {
    const bad = ONE_FIGURE.filter((id) => {
      const entry = manifest[id] as { file: string; lead?: { file: string } } | undefined;
      return entry === undefined || entry.lead !== undefined;
    });
    expect(bad, 'one-figure rigs with no portrait, or with a lead variant').toEqual([]);
  });

  it('every figure-team portrait ships its one-figure chip variant, on disk', () => {
    const bad = FIGURE_TEAMS.filter((id) => {
      const lead = (manifest[id] as { lead?: { file: string } } | undefined)?.lead;
      return lead === undefined || !fs.existsSync(path.join(shipDir, lead.file));
    });
    expect(bad, 'figure teams with no lead-figure chip portrait').toEqual([]);
  });

  it('the module catalogue sees every manifest entry', () => {
    expect(portraitIds().sort()).toEqual(Object.keys(manifest).sort());
  });
});

describe('unitPlate', () => {
  // The real shape `tools/src/perf/unit-plates.ts` writes to
  // `assets/ui/plates/units/manifest.json` (and, with `--kit`, to `kit/`).
  const fakeManifest = {
    mbt_lavi: { file: 'mbt_lavi.jpg', width: 1800, height: 1200, extent: [636, 448] },
    inf_squad: { file: 'inf_squad.jpg', width: 1800, height: 1200, extent: [154, 230] },
  };
  const fakeKitManifest = {
    mbt_lavi: { file: 'mbt_lavi.jpg', width: 1800, height: 1200, extent: [690, 470] },
  };
  const cat = (baseFiles: string[], kitFiles: string[] = []): PlateCatalogue => ({
    base: { manifest: fakeManifest, files: new Set(baseFiles) },
    kit: { manifest: fakeKitManifest, files: new Set(kitFiles) },
  });
  const both = cat(['mbt_lavi.jpg', 'inf_squad.jpg'], ['mbt_lavi.jpg']);
  const BASE_LAVI = { url: '/ui/plates/units/mbt_lavi.jpg', size: [1800, 1200], extent: [636, 448] };
  const KIT_LAVI = { url: '/ui/plates/units/kit/mbt_lavi.jpg', size: [1800, 1200], extent: [690, 470] };

  it('resolves a known id from the manifest shape', () => {
    expect(unitPlate('/ui/plates/units/', 'mbt_lavi', 0, both)).toEqual(BASE_LAVI);
  });

  it('accepts a base with no trailing slash too', () => {
    expect(unitPlate('/ui/plates/units', 'mbt_lavi', 0, both)).toEqual(BASE_LAVI);
    expect(unitPlate('/ui/plates/units', 'mbt_lavi', 3, both)).toEqual(KIT_LAVI);
  });

  it('returns null for an id the manifest never names', () => {
    expect(unitPlate('/ui/plates/units/', 'nope', 0, both)).toBeNull();
    expect(unitPlate('/ui/plates/units/', 'nope', 3, both)).toBeNull();
  });

  it('returns null for a manifest entry whose file the glob never captured', () => {
    // A manifest that outran a partial `pnpm plates:units` run -- the id is
    // named, but its JPEG was never written (or was deleted). Reads exactly
    // like an unknown id, deliberately: a broken `<img>` is worse than no
    // picture at all.
    expect(unitPlate('/ui/plates/units/', 'mbt_lavi', 0, cat([]))).toBeNull();
  });

  // Parent spec §3.1: a kitted plate, where one exists, replaces the base at
  // L >= 2.
  it('gives the base plate at kit level 0 and 1', () => {
    expect(KIT_PLATE_LEVEL).toBe(2);
    expect(unitPlate('/ui/plates/units/', 'mbt_lavi', 0, both)).toEqual(BASE_LAVI);
    expect(unitPlate('/ui/plates/units/', 'mbt_lavi', 1, both)).toEqual(BASE_LAVI);
    expect(unitPlate('/ui/plates/units/', 'mbt_lavi', undefined, both)).toEqual(BASE_LAVI);
  });

  it('gives the kitted plate at kit level 2 and 3', () => {
    expect(unitPlate('/ui/plates/units/', 'mbt_lavi', 2, both)).toEqual(KIT_LAVI);
    expect(unitPlate('/ui/plates/units/', 'mbt_lavi', 3, both)).toEqual(KIT_LAVI);
  });

  it('gives the base plate at L3 to a type with no kitted plate', () => {
    expect(unitPlate('/ui/plates/units/', 'inf_squad', 3, both)?.url).toBe('/ui/plates/units/inf_squad.jpg');
  });

  it('falls back to the base plate when the kitted file is not on disk', () => {
    expect(unitPlate('/ui/plates/units/', 'mbt_lavi', 3, cat(['mbt_lavi.jpg']))).toEqual(BASE_LAVI);
  });

  it('reads the real shipped catalogue by default', () => {
    // No catalogue argument: exercises the module's own `import.meta.glob` +
    // `manifest.json` join against whatever `pnpm plates:units` actually
    // wrote under `assets/ui/plates/units/`.
    const plate = unitPlate('/ui/plates/units/', 'mbt_lavi');
    expect(plate).not.toBeNull();
    expect(plate?.url).toContain('mbt_lavi');
    expect(plate?.extent[0]).toBeGreaterThan(0);
    expect(plate?.extent[1]).toBeGreaterThan(0);
    // `size` is the frame the footprint was measured in -- the garage's bay
    // divides one by the other (`ui/plate-fit.ts`), so a footprint without its
    // own frame is a number that means nothing.
    expect(plate?.size[0]).toBeGreaterThan(plate?.extent[0] ?? 0);
    expect(plate?.size[1]).toBeGreaterThan(plate?.extent[1] ?? 0);
  });

  // `pnpm plates:units --kit` (GH-238 plan 3 Task 9): one kitted plate per
  // kitted vehicle. The list is a literal, not `KIT_VEHICLE_TYPES`, so a type
  // dropped from both sides at once still fails here.
  const KITTED = [
    'apc_eitan',
    'apc_kipod',
    'dozer_d9',
    'heli_peten',
    'ifv_namer',
    'jeep_shoded',
    'mbt_lavi',
    'scout_shachaf',
  ];

  it('ships a kitted plate, on disk and in the kit manifest, for exactly the eight kitted vehicles', () => {
    const dir = path.resolve(__dirname, '../../../../assets/ui/plates/units/kit');
    const kitManifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as {
      plates: Record<string, { file: string; width: number; height: number; extent: number[] }>;
    };
    expect(Object.keys(kitManifest.plates).sort()).toEqual(KITTED);
    for (const id of KITTED) {
      const e = kitManifest.plates[id];
      expect(fs.existsSync(path.join(dir, e.file)), e.file).toBe(true);
      expect([e.width, e.height], id).toEqual([1800, 1200]);
      expect(e.extent[0], id).toBeGreaterThan(0);
      expect(e.extent[1], id).toBeGreaterThan(0);
      // Through the module's own catalogue, at L3: the kitted file, not the base.
      expect(unitPlate('/ui/plates/units/', id, 3)?.url, id).toBe(`/ui/plates/units/kit/${e.file}`);
      expect(unitPlate('/ui/plates/units/', id, 1)?.url, id).toBe(`/ui/plates/units/${id}.jpg`);
    }
  });
});

// Minor 8 (final review): nothing pinned "every KDF unit has a plate". All 17
// are covered today and a missing one degrades quietly to the reserved hatch,
// which is exactly the `SPRITE_MAP` failure mode CLAUDE.md names -- "art
// existing is not art drawing", and here, art NOT existing and nothing saying
// so. The garage's whole bay is this picture.
//
// Read off disk rather than through `unitPlate`'s glob, because the question is
// about the shipped FILES: a manifest entry whose JPEG never landed passes a
// glob-free check and fails the player.
describe('unit plate coverage', () => {
  it('every KDF unit has a plate entry and a file on disk', () => {
    const dir = path.join(__dirname, '../../../../assets/ui/plates/units');
    const manifest = (
      JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as {
        plates: Record<string, { file: string; width: number; height: number; extent: [number, number] }>;
      }
    ).plates;
    // The roster read from the CONTENT directory, not from a bundled
    // catalogue: "every KDF unit" means every file a content author dropped in
    // `data/units/kdf/`, and a unit added there is exactly the case this test
    // exists to catch on the day it ships without a plate.
    const unitDir = path.join(__dirname, '../../../../data/units/kdf');
    const kdf = fs
      .readdirSync(unitDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => (JSON.parse(fs.readFileSync(path.join(unitDir, f), 'utf8')) as { id: string }).id);
    // Vacuity guard: an empty roster would make every loop below pass.
    expect(kdf.length).toBeGreaterThan(10);

    const missing = kdf.filter((id) => manifest[id] === undefined);
    expect(missing, `KDF units with no plate: ${missing.join(', ')}`).toEqual([]);

    const noFile = kdf.filter((id) => !fs.existsSync(path.join(dir, manifest[id].file)));
    expect(noFile, `plates named in the manifest but not on disk: ${noFile.join(', ')}`).toEqual([]);
  });
});
