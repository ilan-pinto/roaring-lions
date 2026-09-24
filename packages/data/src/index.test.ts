import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  maps,
  missions,
  paletteColor,
  paletteTeamColors,
  tutorials,
  units,
  variantAwareResolver,
  vfxEmitters,
} from './index';

const DATA_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data');

/**
 * The vfx sweep generalised (fix wave item 3): reads every `.json` file
 * under `dir` (recursively, since `data/units/` splits into `kdf/` and
 * `enemy/` subdirectories plus one flat file), pulls each one's own `id`
 * field, and returns the sorted list -- the same "read the directory back"
 * technique `vfxEmitters is pinned to the directory it comes from` above
 * uses, so a file that ships without being registered in `index.ts`'s
 * hand-kept import list is a red spec rather than an effect nobody can see.
 * Verified to apply cleanly: every file under `data/maps/`, `data/missions/`,
 * `data/units/` and `data/tutorial/` carries an `id` equal to its own
 * filename (checked by hand before writing this, 2026-09-20) -- unlike
 * `data/campaign/`, which has no such scheme at all (`commander.json` and
 * `names.json` carry no `id`, and `world.json`'s `id` is the campaign's own
 * id, `sahar_basin`, not a match for its filename `world`) and is swept
 * separately below, by filename against `index.ts`'s own import lines.
 */
function idsOnDisk(dir: string): string[] {
  const files = (readdirSync(dir, { recursive: true }) as string[]).filter((f) => f.endsWith('.json'));
  return files.map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')).id as string).sort();
}

// Task 12 fix round 1: `variantAwareResolver` is what closes the gap
// `paletteTeamColors` alone left open -- most of the renderer's team-coloured
// draws (the occlusion silhouette, the HP bar, the objective-zone tint, the
// min-range ring) ask `resolveColor('team.hostile')` by STRING KEY rather
// than reading the `teamColors` tuple, so `main.ts` passing plain
// `paletteColor` as `resolveColor` left every one of them on the default
// palette regardless of the player's setting. These two functions read the
// same palette entry (`teamColorsFor`, index.ts), so a mismatch between them
// is not expressible.
describe('paletteTeamColors', () => {
  it('default returns the plain reserved.team.colors triple', () => {
    expect(paletteTeamColors('default')).toEqual([
      paletteColor('team.kedem'),
      paletteColor('team.hostile'),
      paletteColor('team.neutral'),
    ]);
  });

  it('deuteranopia returns the variant triple, distinct from default', () => {
    const [kedem, hostile, neutral] = paletteTeamColors('deuteranopia');
    expect(kedem).toBe('#0072B2');
    expect(hostile).toBe('#D55E00');
    expect(neutral).toBe('#F0E442');
  });
});

describe('variantAwareResolver', () => {
  it("deuteranopia routes every team.* key through the variant's own entry", () => {
    const resolve = variantAwareResolver('deuteranopia');
    expect(resolve('team.kedem')).toBe('#0072B2');
    expect(resolve('team.hostile')).toBe('#D55E00');
    expect(resolve('team.neutral')).toBe('#F0E442');
    expect(resolve('team.hostile_text')).toBe('#F2A15C');
  });

  it('leaves every non-team key on the plain palette, unaffected by the variant', () => {
    const resolve = variantAwareResolver('deuteranopia');
    expect(resolve('vfx.tracer')).toBe(paletteColor('vfx.tracer'));
    expect(resolve('shadow.1')).toBe(paletteColor('shadow.1'));
    expect(resolve('dust.0')).toBe(paletteColor('dust.0'));
  });

  it('default resolves all four team.* keys identically to paletteColor', () => {
    const resolve = variantAwareResolver('default');
    for (const key of ['team.kedem', 'team.hostile', 'team.neutral', 'team.hostile_text']) {
      expect(resolve(key)).toBe(paletteColor(key));
    }
  });
});

// Minor 18 (final review): `teamColorsFor` indexed `team.variants[variant]`
// and the caller then read `.kedem` off the result. That is an index into JSON
// on disk, not into a type -- a variant the palette has not grown yet reads
// `undefined` and the read throws. Unreachable through the typed path today,
// which is why the cast is deliberate here: the point is what happens when the
// union and the file part company, and the only way to ask that question is to
// widen past the union the way a stale palette would.
describe('an unknown colour-vision variant', () => {
  it('falls back to the default team colours instead of throwing', () => {
    const unknown = 'monochromacy' as Parameters<typeof paletteTeamColors>[0];
    expect(() => paletteTeamColors(unknown)).not.toThrow();
    expect(paletteTeamColors(unknown)).toEqual(paletteTeamColors('default'));
    const resolve = variantAwareResolver(unknown);
    for (const key of ['team.kedem', 'team.hostile', 'team.neutral', 'team.hostile_text']) {
      expect(resolve(key)).toBe(paletteColor(key));
    }
  });
});

describe('vfxEmitters is pinned to the directory it comes from', () => {
  // WHY THIS EXISTS, and it is the `SPRITE_MAP` failure in a second place.
  // `data/vfx/catastrophic_kill.json` shipped, validated against the schema,
  // and was read by name from `ThreeRenderer` -- and was never imported here,
  // so `emitterLibrary.byName('catastrophic_kill')` answered null in the real
  // app and the blast's light, screen shake and hit-stop were all silent
  // no-ops on every vehicle kill. Nothing caught it: `validate:data` walks the
  // FILES, the renderer's own suite calls `useEmitters` with the JSON
  // directly, and this array is a hand-kept list of exactly the kind CLAUDE.md
  // warns about. A hand-kept list stays correct only if something reads the
  // directory back.
  //
  // The directory is read at TEST TIME rather than at build time on purpose:
  // an import glob would make the array derive from the directory and this
  // check vacuous, and the array is a deliberate declaration (each entry's
  // lookup contract is documented beside it). This asserts the two agree.
  const vfxDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data/vfx');

  it('carries every emitter file on disk, by id', () => {
    const onDisk = readdirSync(vfxDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(path.join(vfxDir, f), 'utf8')).id as string)
      .sort();
    expect(onDisk.length).toBeGreaterThan(0);
    const registered = vfxEmitters.map((e) => (e as { id: string }).id).sort();
    expect(registered).toEqual(onDisk);
  });

  it('registers each of them exactly once', () => {
    const ids = vfxEmitters.map((e) => (e as { id: string }).id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('carries the blast emitter with the three blocks the blast reads', () => {
    // Named rather than left to the sweep above: these three fields are what
    // `blastLightSpec`, `blastShake` and `blastHitStopMs` scale, and each of
    // those returns null/0 for a missing block -- so an emitter registered but
    // stripped of them would be the same silent failure with a green sweep.
    const blast = vfxEmitters.find((e) => (e as { id: string }).id === 'catastrophic_kill') as
      | { light?: unknown; screen_shake?: unknown; hit_stop_ms?: unknown }
      | undefined;
    expect(blast).toBeDefined();
    expect(blast?.light).toBeDefined();
    expect(blast?.screen_shake).toBeDefined();
    expect(blast?.hit_stop_ms).toBeDefined();
  });
});

// Fix wave item 3: the vfx sweep above generalised to every other hand-kept
// import list in this file. `maps`/`missions`/`units`/`tutorials` are all
// shaped as an object KEYED BY id, unlike `vfxEmitters`'s array of objects
// each carrying its own `.id` -- so each sweep below compares
// `Object.keys(...)` against the directory instead of mapping `.id` off the
// registered values, but the underlying question and the directory-read
// technique are identical.

describe('maps is pinned to the directory it comes from', () => {
  const mapsDir = path.join(DATA_ROOT, 'maps');

  it('carries every map file on disk, by id', () => {
    const onDisk = idsOnDisk(mapsDir);
    expect(onDisk.length).toBeGreaterThan(0);
    expect(Object.keys(maps).sort()).toEqual(onDisk);
  });
});

describe('missions is pinned to the directory it comes from', () => {
  const missionsDir = path.join(DATA_ROOT, 'missions');

  it('carries every mission file on disk, by id', () => {
    const onDisk = idsOnDisk(missionsDir);
    expect(onDisk.length).toBeGreaterThan(0);
    expect(Object.keys(missions).sort()).toEqual(onDisk);
  });
});

describe('units is pinned to the directory it comes from', () => {
  const unitsDir = path.join(DATA_ROOT, 'units');

  it('carries every unit file on disk, by id, including the kdf/ and enemy/ subdirectories', () => {
    const onDisk = idsOnDisk(unitsDir);
    expect(onDisk.length).toBeGreaterThan(0);
    expect(Object.keys(units).sort()).toEqual(onDisk);
  });
});

describe('tutorials is pinned to the directory it comes from', () => {
  const tutorialDir = path.join(DATA_ROOT, 'tutorial');

  it('carries every tutorial file on disk, by id', () => {
    const onDisk = idsOnDisk(tutorialDir);
    expect(onDisk.length).toBeGreaterThan(0);
    expect(Object.keys(tutorials).sort()).toEqual(onDisk);
  });
});

describe('campaign data files are all imported by index.ts', () => {
  // `data/campaign/` is not a single id-keyed collection like the four
  // sweeps above -- `world`/`countries`/`commander`/`names` are four
  // independent named exports, one per file, and there is no shared id
  // scheme to compare against: `commander.json` and `names.json` carry no
  // `id` field at all, and `world.json`'s own `id` ("sahar_basin") names the
  // campaign, not the file. So this sweep asks the one question that still
  // generalises -- is every file physically on disk referenced by an import
  // in `index.ts` -- the same failure mode (a file that ships but is never
  // wired in, exactly how `catastrophic_kill.json` shipped unregistered) the
  // other four sweeps catch by id instead.
  const campaignDir = path.join(DATA_ROOT, 'campaign');
  const indexSrc = readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'index.ts'),
    'utf8'
  );

  it('imports every campaign JSON file on disk', () => {
    const onDisk = readdirSync(campaignDir).filter((f) => f.endsWith('.json'));
    expect(onDisk.length).toBeGreaterThan(0);
    for (const f of onDisk) {
      expect(indexSrc, `index.ts imports data/campaign/${f}`).toContain(`data/campaign/${f}`);
    }
  });
});

// `data/front/` is the same shape of hazard as `data/campaign/`: a lone file
// per named export rather than an id-keyed collection (today, exactly one --
// the menu diorama), so it is swept the same way -- is every file on disk
// referenced by an import in index.ts -- rather than by id. This is the check
// CLAUDE.md's own note for this task asks for: `catastrophic_kill.json`
// shipped, validated, and was never imported here, so it was unregistered in
// the running app despite passing `validate:data` -- the failure mode this
// sweep exists to catch a second time.
describe('front data files are all imported by index.ts', () => {
  const frontDir = path.join(DATA_ROOT, 'front');
  const indexSrc = readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'index.ts'),
    'utf8'
  );

  it('imports every front JSON file on disk', () => {
    const onDisk = readdirSync(frontDir).filter((f) => f.endsWith('.json'));
    expect(onDisk.length).toBeGreaterThan(0);
    for (const f of onDisk) {
      expect(indexSrc, `index.ts imports data/front/${f}`).toContain(`data/front/${f}`);
    }
  });
});
