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
// GH-153 lists "dedicated unit portrait icons" as its own open ticket, and this
// is honest about being the stand-in: idle sprites face one direction and read
// poorly at 40px. `unitIcon` below is the ticket's actual answer -- a cropped,
// resampled icon per sheet -- with this frame picker kept as its fallback for
// any sheet the icon pipeline has not (yet) produced one for.

import manifest from '../../../../assets/ui/icons/units/manifest.json';

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
  box: number[];
  extent: number[];
}

interface IconManifest {
  version: number;
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
  ICONS[sheet] = { url, size: 128, extent: [w, h] };
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
