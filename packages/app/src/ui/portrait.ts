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
// poorly at 40px.

/** The subset of a sheet manifest this needs. Structural, so a test can hand it
 *  an object rather than a file. */
export interface SheetManifest {
  files?: { clip?: string; facing: number; frame: number; file: string }[];
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
  const pick =
    pool.find((f) => f.facing === PORTRAIT_FACING && f.frame === 0) ??
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
