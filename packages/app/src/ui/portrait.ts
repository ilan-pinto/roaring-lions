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
// that landed in PR 338 and is wired below: `unitIcon` returns that portrait.
// Since A3.3 step 1 (4 Oct) every unit with a mesh has one, so the cropped
// sheet icon is no longer read at runtime at all -- the crop pipeline and its
// PNGs stay on disk only until the sprite sheets themselves are retired
// (docs/superpowers/plans/2026-10-04-retire-pixi.md).
// `UnitIcon { url, size, extent }` is unchanged.

import plateManifestJson from '../../../../assets/ui/plates/units/manifest.json';
import portraitManifestJson from '../../../../assets/ui/portraits/units/manifest.json';

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

// --- the icon shape ----------------------------------------------------------
//
// `tools/crop_unit_icons.py` (`pnpm icons:units`) still crops each hull sheet's
// `portraitFile` frame to `assets/ui/icons/units/`, and `portrait.test.ts`
// still pins its Python picker against `portraitFile`, but nothing in the app
// reads those crops any more: the runtime fallback (`spriteCropIcon`) was
// deleted with its last user on 4 Oct, when the nine enemy types it served got
// Blender portraits. A `&nomesh` run never needed it either -- an icon is DOM,
// keyed by unit id, and draws the same picture on every render path.

/** One icon: the URL to draw, its fixed pixel size, and the unit's own alpha
 *  bounding box inside it (for a caller that wants to know how much of the
 *  frame is actually filled). */
export interface UnitIcon {
  url: string;
  size: number;
  extent: readonly [number, number];
}

// --- Blender unit portraits (GH-153, S3a) -----------------------------------
//
// `tools/render_unit_portraits.py` renders each unit's own shipped GLB at one
// three-quarter angle under the garage's lights
// (docs/superpowers/specs/2026-10-01-unit-portraits-numbers.md) and writes a
// 192 px PNG per unit id to `assets/ui/portraits/units/`, plus, for a figure
// team, a ONE-figure variant under `lead/` -- the team's front man, fitted to
// the frame alone. `tools/portrait_manifest.py` records each file's size and
// alpha extent, and CI's `--check` holds the manifest to the PNGs.
//
// Which picture a slot gets is the lead's call (2 Oct): at chip size (40 px,
// <= 48) a figure team shows its lead figure, because three men in a 40 px
// square are three 13 px smudges; every larger slot -- the unit card, the dock
// tile, the brigade screen -- shows the whole team, whose composition is what
// identifies its type there.
//
// Keyed by unit id rather than sprite sheet, so a type with no sheet at all
// (`recon_zikit`, `heli_peten_gunship`, `dozer_d9`) still gets a picture. The
// images are DOM, not canvas, so both backends -- and `&nomesh` -- draw the
// same ones.

/** Which slot a picture is for. `chip` is the HUD selection chip, the one
 *  slot at or under 48 px; `full` is everything larger. */
export type PortraitSlot = 'chip' | 'full';

interface PortraitManifestFile {
  file: string;
  extent: number[];
}

interface PortraitManifest {
  version: number;
  size: number;
  portraits: Record<string, PortraitManifestFile & { lead?: PortraitManifestFile }>;
}

// The same `unknown` cast the two manifests above take, for the same reason.
const portraitManifest = portraitManifestJson as unknown as PortraitManifest;

/** Every portrait PNG the glob found, by path relative to the portraits
 *  directory (`inf_squad.png`, `lead/inf_squad.png`) -- the manifest's own
 *  `file` key. */
const portraitUrlByFile: Record<string, string> = {};
for (const [path, url] of Object.entries(
  import.meta.glob('../../../../assets/ui/portraits/units/**/*.png', {
    eager: true,
    query: '?url',
    import: 'default',
  }) as Record<string, string>
)) {
  const marker = '/portraits/units/';
  portraitUrlByFile[path.slice(path.indexOf(marker) + marker.length)] = url;
}

/** One unit's portraits: the whole team, and the lead figure where one was
 *  rendered (figure teams only). */
export interface UnitPortraits {
  full: UnitIcon;
  lead?: UnitIcon;
}

function portraitIcon(entry: PortraitManifestFile, url: string): UnitIcon {
  const [w, h] = entry.extent;
  return { url, size: portraitManifest.size, extent: [w, h] };
}

/** Built once at module load: every manifest entry whose PNG the glob above
 *  actually captured, so a stale entry reads as absent, never a broken img. */
const PORTRAITS: Record<string, UnitPortraits> = {};
for (const [id, entry] of Object.entries(portraitManifest.portraits)) {
  const url = portraitUrlByFile[entry.file];
  if (url === undefined) continue;
  const leadUrl = entry.lead === undefined ? undefined : portraitUrlByFile[entry.lead.file];
  PORTRAITS[id] =
    entry.lead !== undefined && leadUrl !== undefined
      ? { full: portraitIcon(entry, url), lead: portraitIcon(entry.lead, leadUrl) }
      : { full: portraitIcon(entry, url) };
}

/** Every unit id with a Blender portrait -- for a caller that must offer a
 *  picture to a type its sprite map does not name. */
export function portraitIds(catalogue: Readonly<Record<string, UnitPortraits>> = PORTRAITS): string[] {
  return Object.keys(catalogue);
}

/**
 * The picture a unit type shows in a UI slot: its Blender portrait (the lead
 * figure in a `chip` slot, when the type has one), otherwise null -- and the
 * caller falls back to a sheet frame or the hatch, as before. Every unit with
 * a mesh has a portrait since 4 Oct; `civilians` is the one null.
 */
export function unitIcon(
  typeId: string,
  slot: PortraitSlot = 'full',
  portraits: Readonly<Record<string, UnitPortraits>> = PORTRAITS
): UnitIcon | null {
  const p = portraits[typeId];
  if (p === undefined) return null;
  return slot === 'chip' ? (p.lead ?? p.full) : p.full;
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
 *  broken `<img>`, the same rule the `PORTRAITS` catalogue enforces by only
 *  ever recording files its glob actually captured. */
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
