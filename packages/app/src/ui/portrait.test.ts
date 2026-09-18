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
  portraitUrl,
  unitIcon,
  unitPlate,
  type SheetManifest,
  type UnitIcon,
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

describe('unitIcon', () => {
  const fakeCatalogue: Record<string, UnitIcon> = {
    INF_SQUAD: { url: '/ui/icons/units/INF_SQUAD.png', size: 128, extent: [111, 105] },
  };

  it('resolves a known sheet from its base path', () => {
    expect(unitIcon('/sprites/INF_SQUAD/', fakeCatalogue)).toEqual({
      url: '/ui/icons/units/INF_SQUAD.png',
      size: 128,
      extent: [111, 105],
    });
  });

  it('accepts a base path with no trailing slash too', () => {
    expect(unitIcon('/sprites/INF_SQUAD', fakeCatalogue)).toEqual(fakeCatalogue.INF_SQUAD);
  });

  it('returns null for a sheet the catalogue never built one for', () => {
    // A building sheet: no icon is ever cropped for `BLD_*`, so this reads
    // exactly like an unknown sheet -- there is nothing that distinguishes
    // the two cases here, and there does not need to be.
    expect(unitIcon('/sprites/BLD_HOUSE/', fakeCatalogue)).toBeNull();
  });

  it('returns null for a sheet this catalogue does not know at all', () => {
    expect(unitIcon('/sprites/TNK_HULL/', fakeCatalogue)).toBeNull();
  });

  it('reads a real cropped icon off the shipped catalogue by default', () => {
    // No catalogue argument: exercises the module's own `import.meta.glob` +
    // manifest join against the real `assets/ui/icons/units/` output.
    const icon = unitIcon('/sprites/INF_SQUAD/');
    expect(icon).not.toBeNull();
    expect(icon?.size).toBe(128);
    expect(icon?.url).toContain('INF_SQUAD');
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
