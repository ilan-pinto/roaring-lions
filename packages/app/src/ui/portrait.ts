// Which frame of a unit's sprite sheet stands in for the unit in the HUD.
//
// The selection chip and the unit card show a unit's own art rather than a
// glyph, and the art the pipeline produces is a directional sheet, not a
// portrait. So a portrait here is a CHOICE of frame, and the choice has to be
// made from the sheet's own manifest rather than from a filename template:
// there are two naming conventions in `assets/sprites/` already —
// `idle_f03_000.png` for anything with clips, and a bare `f03_000.png` for the
// sheets whose manifest declares none (TNK_HULL is the shipped example) — and a
// third will arrive the next time a rig changes. The manifest is the file the
// renderer itself reads; reading the same one is what keeps this from going
// stale the way a hand-kept map would.
//
// GH-153 asked for "dedicated unit portrait icons". `unitIcon` below is that
// ticket's build-time answer: `pnpm icons:units` (`tools/crop_unit_icons.py`)
// crops each sheet's own `portraitFile` frame to the unit's alpha extent --
// compositing a paired turret sheet at rest first -- and writes the result to
// `assets/ui/icons/units/<SHEET>.png`, gated by `tools/src/unit_icons.test.ts`
// in `pnpm test` and by CI's `crop_unit_icons.py --check`. This frame picker
// is now the FALLBACK: `portraitFile`/`portraitUrl` below hand back a raw
// sheet frame only for a sheet the crop pipeline has not (yet) produced an
// icon for. GH-153's dedicated Blender-rendered portraits are the later step
// that replaces the PNGs under `assets/ui/icons/units/` with hand-composed art
// -- `unitIcon`'s contract (`UnitIcon { url, size, extent }`) does not change
// when that lands, only what `pnpm icons:units` writes into it.

import manifest from '../../../../assets/ui/icons/units/manifest.json';
import plateManifestJson from '../../../../assets/ui/plates/units/manifest.json';

/** The subset of a sheet manifest this needs. Structural, so a test can hand it
 *  an object rather than a file. */
export interface SheetManifest {
  files?: { clip?: string; facing: number; frame: number; file: string }[];
  /** A sheet's own portrait facing, overriding `PORTRAIT_FACING`. Written by
   *  the renderer for the one team whose figures line up along the view axis
   *  at facing 3 (`INF_BREACH`: two figures in file, the shield hidden behind
   *  the point man), and absent from every other manifest. */
  portraitFacing?: number;
}

/**
 * The facing every portrait is taken at.
 *
 * Chosen by rendering all sixteen facings of six sheets at the real 40px chip
 * size and looking at them, not by reasoning about angles. Facing 3 is the only
 * one that reads across the roster: infantry stand as three distinguishable
 * figures rather than one overlapping column (which is what 5 and 13 give),
 * while the tank, the Namer, the Grad truck and the quadcopter all present a
 * three-quarter view with their length visible (which 2 and 10 flatten into a
 * head-on rectangle — the rocket battery at facing 10 is a bare vertical bar).
 *
 * Exported because the reinforcements dock is going to want the same frame, and
 * a dock that picked its own would put two different pictures of one unit on
 * screen at once.
 */
export const PORTRAIT_FACING = 3;

/**
 * The portrait file for a sheet, or null if the manifest lists none.
 *
 * Falls back twice rather than throwing: a sheet with a clip list but no
 * `idle`, and a sheet whose facings do not reach `PORTRAIT_FACING`, both still
 * produce a picture. A unit with no picture at all is a case the HUD has to
 * handle anyway — `civilians` ships no sheet — so failing softly here costs
 * nothing and keeps one degradation path instead of two.
 */
export function portraitFile(manifest: SheetManifest): string | null {
  const files = manifest.files ?? [];
  if (files.length === 0) return null;
  // `clip` absent means the sheet has no clips at all, and every frame in it is
  // the idle pose — not that the frame belongs to some other clip.
  const idle = files.filter((f) => (f.clip ?? 'idle') === 'idle');
  const pool = idle.length > 0 ? idle : files;
  // The roster-wide facing unless the sheet names its own: a two-figure team
  // in file stacks into one column at facing 3 and hides its tell, and the
  // renderer that knows the formation is the right place to say so.
  const facing = manifest.portraitFacing ?? PORTRAIT_FACING;
  const pick =
    pool.find((f) => f.facing === facing && f.frame === 0) ??
    pool.find((f) => f.frame === 0) ??
    pool[0];
  return pick.file;
}

/** The portrait's URL, given the sheet's base path (which always ends in `/`,
 *  as `SPRITE_MAP` writes them). */
export function portraitUrl(basePath: string, manifest: SheetManifest): string | null {
  const file = portraitFile(manifest);
  return file === null ? null : basePath + file;
}

// --- cropped unit icons (GH-153 follow-up) ----------------------------------
//
// `tools/crop_unit_icons.py` (`pnpm icons:units`) walks every hull sheet under
// `assets/sprites/`, picks this exact frame (the Python reimplements
// `portraitFile`'s rule, and `portrait.test.ts` pins the two against each
// other from the shipped manifests), composites a paired turret sheet at rest
// and crops to the unit's own alpha extent -- a 40px chip showing a whole
// 256px frame is a 20px smudge; the icon fills its frame instead. Icons live
// under `assets/ui/icons/units/`, not `assets/sprites/`, so `pnpm
// validate:assets` never walks them and the palette/silhouette gates are
// unaffected.
//
// The catalogue is an eager `import.meta.glob` of the icon PNGs, the same
// shape `portrait-catalogue.ts` uses for commander portraits, joined against
// the icon manifest for each sheet's declared `extent`. A manifest entry whose
// PNG the glob did not capture is skipped -- this is a listing of what
// actually exists on disk, the same "paths are data, a glob is a function"
// rule, not a hand-kept map that could drift from what shipped.

/** One cropped icon: the URL to draw, its fixed pixel size, and the unit's own
 *  alpha bounding box inside it (for a caller that wants to know how much of
 *  the frame is actually filled, not yet used by anything in this app). */
export interface UnitIcon {
  url: string;
  size: number;
  extent: readonly [number, number];
}

/** The manifest's own JSON shape -- `box`/`extent` are plain arrays on disk
 *  (JSON has no tuple type), narrowed to the fixed-length tuple `UnitIcon`
 *  promises only where a value is actually read, below. */
interface IconManifestEntry {
  file: string;
  sources: { path: string; sha256: string }[];
  facing: number;
  /** Only present on a composited (hull+turret) entry, and always equal to
   *  `facing` -- `crop_unit_icons.py` raises rather than shipping a mismatch. */
  turretFacing?: number;
  box: number[];
  extent: number[];
}

interface IconManifest {
  version: number;
  /** Every icon's pixel width and height -- the one place this is recorded;
   *  read back here rather than a hardcoded literal kept in sync by hand. */
  size: number;
  icons: Record<string, IconManifestEntry>;
}

// `manifest` is a JSON module import, so its inferred type is the literal
// shape of today's file (each entry's exact key set), not the general
// `IconManifest` shape a future entry still has to match -- `unknown` first
// is the honest way to say "structurally compatible, not identical".
const iconManifest = manifest as unknown as IconManifest;

const iconUrlBySheet: Record<string, string> = {};
for (const [path, url] of Object.entries(
  import.meta.glob('../../../../assets/ui/icons/units/*.png', {
    eager: true,
    query: '?url',
    import: 'default',
  }) as Record<string, string>
)) {
  const file = path.slice(path.lastIndexOf('/') + 1);
  const sheet = file.slice(0, -'.png'.length);
  iconUrlBySheet[sheet] = url;
}

/** Built once at module load: every manifest entry whose PNG the glob above
 *  actually captured. The default `unitIcon` catalogue -- a test hands its
 *  own instead, so it needs no glob. */
const ICONS: Record<string, UnitIcon> = {};
for (const [sheet, entry] of Object.entries(iconManifest.icons)) {
  const url = iconUrlBySheet[sheet];
  if (url === undefined) continue;
  const [w, h] = entry.extent;
  ICONS[sheet] = { url, size: iconManifest.size, extent: [w, h] };
}

/**
 * The cropped icon for a sheet, or null when none was built for it --
 * `BLD_*` sheets, `*_TURR` sheets (composited into their hull's own icon, not
 * given one of their own) and any sheet the icon pipeline has not reached yet
 * all read the same way: no icon, fall back to the sheet frame.
 *
 * `basePath` is a `SPRITE_MAP` path, always ending in `/`; its last segment is
 * the sheet name the icon manifest keys on.
 */
export function unitIcon(
  basePath: string,
  catalogue: Readonly<Record<string, UnitIcon>> = ICONS
): UnitIcon | null {
  const trimmed = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  const sheet = trimmed.slice(trimmed.lastIndexOf('/') + 1);
  return catalogue[sheet] ?? null;
}

// --- engine-rendered unit plates (Task 15, GH-153's garage) -----------------
//
// `tools/src/perf/unit-plates.ts` (`pnpm plates:units`) photographs each KDF
// unit through the running game itself -- the same camera, sun and tone
// mapping a mission uses -- rather than compositing one from a sprite-sheet
// frame the way the cropped icon above does. One JPEG per unit id, flat under
// `assets/ui/plates/units/<id>.jpg` (there is no per-unit sheet DIRECTORY the
// way `assets/sprites/<SHEET>/` has one -- a plate is not a frame picked out
// of a manifest of many, it is the whole capture), alongside a manifest
// recording each plate's own measured pixel footprint (`extent`): the
// bounding box of pixels that differ from the empty-ground reference frame
// captured at the same camera, not an alpha channel -- a JPEG plate carries
// none.

/** One engine-rendered plate: the URL to draw, the plate's own pixel size, and
 *  the unit's own measured pixel footprint inside it. The two together are what
 *  `ui/plate-fit.ts` needs: a footprint alone says nothing without the frame it
 *  was measured in, and handing them back as one object is what stops a caller
 *  pairing one plate's footprint with another plate's size. */
export interface UnitPlate {
  url: string;
  size: readonly [number, number];
  extent: readonly [number, number];
}

/** The manifest's own JSON shape -- `extent` is a plain array on disk (JSON
 *  has no tuple type), narrowed to the fixed-length tuple `UnitPlate` promises
 *  only where a value is actually read, below. */
interface PlateManifestEntry {
  file: string;
  width: number;
  height: number;
  extent: number[];
}

interface PlateManifest {
  version: number;
  camera: { zoom: number; dpr: number; gpu: string };
  plates: Record<string, PlateManifestEntry>;
}

// `manifest` is a JSON module import, so its inferred type is the literal
// shape of today's file, not the general `PlateManifest` shape a future entry
// still has to match -- `unknown` first is the honest way to say
// "structurally compatible, not identical" (the same cast `unitIcon`'s own
// manifest import uses above).
const plateManifest = plateManifestJson as unknown as PlateManifest;

/** Every plate file the eager glob actually found on disk, by filename -- the
 *  manifest can name an id `pnpm plates:units` has not (yet) photographed for
 *  this checkout, and a stale entry should read as absent rather than a
 *  broken `<img>`, the same rule `unitIcon`'s own `ICONS` catalogue enforces
 *  by only ever recording sheets its glob actually captured. */
const PLATE_FILES = new Set<string>(
  Object.keys(
    import.meta.glob('../../../../assets/ui/plates/units/*.jpg', { eager: true })
  ).map((p) => p.slice(p.lastIndexOf('/') + 1))
);

/**
 * The engine-rendered plate for a KDF unit id, or null when none was
 * photographed for it.
 *
 * `base` is the plates directory, always ending in `/` (mirrors `unitIcon`'s
 * `basePath`); `id` is the unit's own id (`data/units/kdf/<id>.json`'s
 * filename) rather than something parsed back out of a path the way
 * `unitIcon` parses a sheet name out of `basePath` -- a plate is not filed
 * under a per-unit directory of its own the way a sprite sheet is, the whole
 * set sits flat under one directory keyed by id, so the caller already has
 * the id in hand and there is nothing to derive from a path.
 *
 * The URL is a plain join of `base` and the manifest's own `file` name.
 * Plates ship through Vite's `publicDir` unhashed
 * (`packages/app/vite.config.ts`: `assets/` -> `/`, "Serve repo-root assets/
 * statically"), so string-joining is exactly what serves them -- the same
 * convention `portraitUrl` above uses for a sprite frame, rather than
 * `unitIcon`'s glob-resolved URL, which exists to survive a bundler renaming
 * the file and is not needed for an asset that is never hashed. Resolution is
 * still gated on the manifest naming the id AND the eager glob above having
 * actually found that file on disk, so an id the manifest outran (a build
 * whose `pnpm plates:units` run is stale or partial) reads as absent rather
 * than a broken image, exactly as `unitIcon` reads a manifest entry its own
 * glob never captured.
 */
export function unitPlate(
  base: string,
  id: string,
  manifest: Readonly<Record<string, PlateManifestEntry>> = plateManifest.plates,
  knownFiles: ReadonlySet<string> = PLATE_FILES
): UnitPlate | null {
  const entry = manifest[id];
  if (entry === undefined || !knownFiles.has(entry.file)) return null;
  const trimmedBase = base.endsWith('/') ? base : `${base}/`;
  const [w, h] = entry.extent;
  return { url: trimmedBase + entry.file, size: [entry.width, entry.height], extent: [w, h] };
}
