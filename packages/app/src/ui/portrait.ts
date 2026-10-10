// Which picture stands in for a unit in the HUD, the dock, the brigade roster
// and the garage.
//
// `unitIcon` is GH-153's answer: the Blender portraits
// (`tools/render_unit_portraits.py`, PR 338), whole team or one lead figure,
// resolved from the bundle with no fetch. Since A3.3 step 1 (4 Oct) every
// unit with a mesh has one; `civilians`, the one without, draws its role mark
// on the reserved hatch. `unitPlate` is the garage bay's photograph
// (`pnpm plates:units`).
//
// Until WP-A3.3 retired the sprite sheets this file also picked a FRAME of a
// unit's sheet (`portraitFile`/`portraitUrl`, facing `PORTRAIT_FACING` = 3,
// read from the sheet's own manifest) as the fallback, and `pnpm icons:units`
// cropped those frames into `assets/ui/icons/units/`. Both are gone with the
// sheets. `UnitIcon { url, size, extent }` is unchanged.

import plateManifestJson from '../../../../assets/ui/plates/units/manifest.json';
import kitPlateManifestJson from '../../../../assets/ui/plates/units/kit/manifest.json';
import portraitManifestJson from '../../../../assets/ui/portraits/units/manifest.json';

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
// mapping a mission uses. One JPEG per unit id, flat under
// `assets/ui/plates/units/<id>.jpg` (a plate is the whole capture, not a
// frame picked out of a manifest of many), alongside a manifest
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

/** Every plate file an eager glob actually found on disk, by filename -- the
 *  manifest can name an id `pnpm plates:units` has not (yet) photographed for
 *  this checkout, and a stale entry should read as absent rather than a
 *  broken `<img>`, the same rule the `PORTRAITS` catalogue enforces by only
 *  ever recording files its glob actually captured. */
function basenames(glob: Record<string, unknown>): Set<string> {
  return new Set(Object.keys(glob).map((p) => p.slice(p.lastIndexOf('/') + 1)));
}

// --- kitted plates (GH-238, plan 3 Task 9) ------------------------------------
//
// `pnpm plates:units --kit` photographs the eight kitted vehicles the same
// way, each wearing every track it declares at that track's top tier, into
// `kit/` under the plates directory with a manifest of its own in the same
// shape. Parent spec §3.1: "a kitted plate, where one exists, replaces the
// base at L >= 2". Its one reader is the bay's no-WebGL2 fallback -- with a
// live turntable the model already wears the bought kit (kitted spec §1).

/** The kit level (`kitLevel`, `@lions/data`: 0-3) from which a kitted plate
 *  replaces the base one. */
export const KIT_PLATE_LEVEL = 2;

/** One plate set: its manifest's entries and the files actually on disk. */
export interface PlateSet {
  readonly manifest: Readonly<Record<string, PlateManifestEntry>>;
  readonly files: ReadonlySet<string>;
}

/** The base set and the kitted set, side by side. */
export interface PlateCatalogue {
  readonly base: PlateSet;
  readonly kit: PlateSet;
}

const kitPlateManifest = kitPlateManifestJson as unknown as PlateManifest;

const SHIPPED_PLATES: PlateCatalogue = {
  base: {
    manifest: plateManifest.plates,
    files: basenames(import.meta.glob('../../../../assets/ui/plates/units/*.jpg', { eager: true })),
  },
  kit: {
    manifest: kitPlateManifest.plates,
    files: basenames(import.meta.glob('../../../../assets/ui/plates/units/kit/*.jpg', { eager: true })),
  },
};

function plateFrom(set: PlateSet, id: string, dir: string): UnitPlate | null {
  const entry = set.manifest[id];
  if (entry === undefined || !set.files.has(entry.file)) return null;
  const [w, h] = entry.extent;
  return { url: dir + entry.file, size: [entry.width, entry.height], extent: [w, h] };
}

/**
 * The engine-rendered plate for a KDF unit id, or null when none was
 * photographed for it.
 *
 * `base` is the plates directory (a trailing `/` is added if missing); `id`
 * is the unit's own id (`data/units/kdf/<id>.json`'s filename). The whole set
 * sits flat under one directory keyed by id, and the kitted set under its
 * `kit/` subdirectory.
 *
 * `kitLevel` is the unit's kit level as the garage computes it (`kitSummary`
 * -> `kitLevel`, 0-3). At `KIT_PLATE_LEVEL` and above, the KITTED plate is
 * returned when one exists for this id; otherwise -- below that level, or a
 * type with no kitted plate (every team, the drones) -- the base plate.
 *
 * The URL is a plain join of `base` and the manifest's own `file` name.
 * Plates ship through Vite's `publicDir` unhashed
 * (`packages/app/vite.config.ts`: `assets/` -> `/`, "Serve repo-root assets/
 * statically"), so string-joining is exactly what serves them. Resolution is
 * still gated on the manifest naming the id AND the eager glob above having
 * actually found that file on disk, so an id the manifest outran (a build
 * whose `pnpm plates:units` run is stale or partial) reads as absent rather
 * than a broken image, exactly as `unitIcon` reads a manifest entry its own
 * glob never captured.
 */
export function unitPlate(
  base: string,
  id: string,
  kitLevel = 0,
  catalogue: PlateCatalogue = SHIPPED_PLATES
): UnitPlate | null {
  const dir = base.endsWith('/') ? base : `${base}/`;
  if (kitLevel >= KIT_PLATE_LEVEL) {
    const kitted = plateFrom(catalogue.kit, id, `${dir}kit/`);
    if (kitted !== null) return kitted;
  }
  return plateFrom(catalogue.base, id, dir);
}
