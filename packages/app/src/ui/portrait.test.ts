// Which frame stands in for a unit in the HUD.
//
// The manifests these read are real shapes taken from `assets/sprites/`: the
// two conventions that actually ship (a sheet with clips, and TNK_HULL's
// clipless one) are the two cases a filename template would get wrong.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PORTRAIT_FACING,
  portraitFile,
  portraitIds,
  portraitUrl,
  unitIcon,
  unitPlate,
  type SheetManifest,
  type UnitPortraits,
} from './portrait';

/** A sheet with clips, as INF_SQUAD's manifest is shaped. */
const withClips = {
  files: [
    { clip: 'down', facing: 3, frame: 0, file: 'down_f03_000.png' },
    { clip: 'idle', facing: 0, frame: 0, file: 'idle_f00_000.png' },
    { clip: 'idle', facing: 3, frame: 0, file: 'idle_f03_000.png' },
    { clip: 'idle', facing: 3, frame: 1, file: 'idle_f03_001.png' },
    { clip: 'move', facing: 3, frame: 0, file: 'move_f03_000.png' },
  ],
};

/** TNK_HULL: no `clips` key at all, so no `clip` on any file. */
const clipless = {
  files: [
    { facing: 0, frame: 0, file: 'f00_000.png' },
    { facing: 3, frame: 0, file: 'f03_000.png' },
  ],
};

describe('portrait frame', () => {
  it('takes the idle frame at the chosen facing', () => {
    expect(portraitFile(withClips)).toBe(`idle_f0${PORTRAIT_FACING}_000.png`);
  });

  it("honours a sheet's own portraitFacing over the roster-wide one", () => {
    // INF_BREACH: two figures in file, so facing 3 stacks them into one
    // column with the shield hidden. Its manifest names facing 5 instead,
    // and the picker must follow the manifest, not the constant.
    const inFile = {
      portraitFacing: 5,
      files: [
        { clip: 'idle', facing: 3, frame: 0, file: 'idle_f03_000.png' },
        { clip: 'idle', facing: 5, frame: 0, file: 'idle_f05_000.png' },
        { clip: 'idle', facing: 5, frame: 1, file: 'idle_f05_001.png' },
      ],
    };
    expect(portraitFile(inFile)).toBe('idle_f05_000.png');
    // A sheet that names a facing it does not carry still gets a picture.
    expect(portraitFile({ ...inFile, portraitFacing: 9 })).toBe('idle_f03_000.png');
  });

  it('never takes a death or movement frame as the portrait', () => {
    // `down_f03_000.png` is first in the list and matches the facing exactly.
    // Filtering by clip is the only thing keeping a corpse out of the chip.
    expect(portraitFile(withClips)).not.toContain('down');
    expect(portraitFile(withClips)).not.toContain('move');
  });

  it('reads a sheet that declares no clips at all', () => {
    // Absent `clip` means "this sheet has one pose and every frame is it",
    // not "this frame belongs to some other clip". Treating it as the latter
    // gives the shipped tank no picture.
    expect(portraitFile(clipless)).toBe('f03_000.png');
  });

  it('reads an unclipped frame as the idle one even where a clipped frame precedes it', () => {
    // The line above passes either way, because a sheet with NO idle frames
    // falls back to the whole file list and lands on the same picture. This is
    // the case where treating an absent `clip` as "some other clip" actually
    // costs something: the fallback would hand back the wreck, because it
    // comes first and matches the facing.
    expect(
      portraitFile({
        files: [
          { clip: 'wreck', facing: 3, frame: 0, file: 'wreck_f03_000.png' },
          { facing: 3, frame: 0, file: 'f03_000.png' },
        ],
      })
    ).toBe('f03_000.png');
  });

  it('falls back to another facing, and still to that facing’s first frame', () => {
    // Two rungs, and the second is only load-bearing when the list does not
    // happen to open on frame 0 — a sheet whose facing this build does not
    // reach must still show a settled pose rather than whatever frame of the
    // idle loop the manifest listed first.
    expect(
      portraitFile({
        files: [
          { clip: 'idle', facing: 7, frame: 2, file: 'idle_f07_002.png' },
          { clip: 'idle', facing: 7, frame: 0, file: 'idle_f07_000.png' },
        ],
      })
    ).toBe('idle_f07_000.png');
  });

  it('falls back past the clip filter when a sheet has no idle', () => {
    expect(portraitFile({ files: [{ clip: 'wreck', facing: 3, frame: 0, file: 'wreck_f03_000.png' }] })).toBe(
      'wreck_f03_000.png'
    );
  });

  it('returns null for a manifest that lists no files', () => {
    expect(portraitFile({})).toBeNull();
    expect(portraitFile({ files: [] })).toBeNull();
  });
});

describe('portrait url', () => {
  it('joins the sheet path the SPRITE_MAP already carries', () => {
    expect(portraitUrl('/sprites/INF_SQUAD/', withClips)).toBe('/sprites/INF_SQUAD/idle_f03_000.png');
  });

  it('stays null when there is no frame, so the HUD can draw its own gap', () => {
    expect(portraitUrl('/sprites/NOTHING/', {})).toBeNull();
  });
});

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
  // `assets/ui/plates/units/manifest.json`.
  const fakeManifest = {
    mbt_lavi: { file: 'mbt_lavi.jpg', width: 1800, height: 1200, extent: [636, 448] },
  };
  const fakeKnownFiles = new Set(['mbt_lavi.jpg']);

  it('resolves a known id from the manifest shape', () => {
    expect(unitPlate('/ui/plates/units/', 'mbt_lavi', fakeManifest, fakeKnownFiles)).toEqual({
      url: '/ui/plates/units/mbt_lavi.jpg',
      size: [1800, 1200],
      extent: [636, 448],
    });
  });

  it('accepts a base with no trailing slash too', () => {
    expect(unitPlate('/ui/plates/units', 'mbt_lavi', fakeManifest, fakeKnownFiles)).toEqual({
      url: '/ui/plates/units/mbt_lavi.jpg',
      size: [1800, 1200],
      extent: [636, 448],
    });
  });

  it('returns null for an id the manifest never names', () => {
    expect(unitPlate('/ui/plates/units/', 'nope', fakeManifest, fakeKnownFiles)).toBeNull();
  });

  it('returns null for a manifest entry whose file the glob never captured', () => {
    // A manifest that outran a partial `pnpm plates:units` run -- the id is
    // named, but its JPEG was never written (or was deleted). Reads exactly
    // like an unknown id, deliberately: a broken `<img>` is worse than no
    // picture at all.
    expect(unitPlate('/ui/plates/units/', 'mbt_lavi', fakeManifest, new Set())).toBeNull();
  });

  it('reads the real shipped catalogue by default', () => {
    // No manifest/catalogue argument: exercises the module's own
    // `import.meta.glob` + `manifest.json` join against whatever
    // `pnpm plates:units` actually wrote under `assets/ui/plates/units/`.
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

describe('unit icon manifest pin', () => {
  // The Python picker in `tools/crop_unit_icons.py` reimplements
  // `portraitFile`'s exact rule rather than sharing code with it (there is no
  // TS the build step can call from Python) -- so this reads BOTH manifests
  // straight off disk and proves the two choices agree, for every icon
  // actually shipped. A drift here means the icon was cropped from a
  // different frame than the one this app would have shown as the fallback.
  it('agrees with portraitFile on every shipped icon’s chosen frame and facing', () => {
    const iconManifestPath = path.join(__dirname, '../../../../assets/ui/icons/units/manifest.json');
    const iconManifest = JSON.parse(fs.readFileSync(iconManifestPath, 'utf8')) as {
      icons: Record<string, { facing: number; turretFacing?: number; sources: { path: string }[] }>;
    };
    const sheets = Object.keys(iconManifest.icons);
    expect(sheets.length).toBeGreaterThan(0);

    for (const [sheet, entry] of Object.entries(iconManifest.icons)) {
      const sheetManifestPath = path.join(__dirname, `../../../../assets/sprites/${sheet}/manifest.json`);
      const sheetManifest = JSON.parse(fs.readFileSync(sheetManifestPath, 'utf8')) as SheetManifest;
      // `sources[0]` is always the hull frame -- the icon script composites a
      // paired turret sheet's frame ON TOP of it, but the frame CHOICE and its
      // facing are the hull's own, exactly what `portraitFile` picks when
      // called on the hull's own manifest.
      const expectedFile = entry.sources[0].path.split('/').pop();
      expect(portraitFile(sheetManifest)).toBe(expectedFile);
      const picked = (sheetManifest.files ?? []).find((f) => f.file === expectedFile);
      expect(picked?.facing).toBe(entry.facing);
      // A composited (hull+turret) entry carries a second source and must
      // record the turret's own resolved facing too -- crop_unit_icons.py
      // raises rather than shipping a mismatch, so this is the fixture-level
      // proof that promise holds for every icon actually shipped.
      if (entry.sources.length > 1) {
        expect(entry.turretFacing, `${sheet}: composited entry missing turretFacing`).toBe(entry.facing);
      }
    }
  });
});
