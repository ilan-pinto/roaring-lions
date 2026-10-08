// The garage's track close-ups (GH-238 plan 3, K11; parent spec §3.3): one
// 480x320 photograph per KDF type and upgrade track, taken through the bay's
// own turntable by `pnpm closeups:garage` (`tools/src/perf/garage-closeups.ts`)
// into `assets/ui/garage/closeups/<id>_<track>.jpg` with a `manifest.json`.
// The board's track head (`garage-board.ts`) draws one where its hatch was.
//
// Resolved the way `portrait.ts`'s `unitPlate` resolves a plate: the manifest
// must name the pair AND an eager glob must have found its file on disk, so a
// stale or partial run reads as absent -- the hatch -- rather than a broken
// `<img>`. The URL is a plain join, since the files ship through Vite's
// `publicDir` unhashed (`assets/` -> `/`).

import closeupManifestJson from '../../../../assets/ui/garage/closeups/manifest.json';

interface CloseupManifestEntry {
  readonly file: string;
  readonly unit: string;
  readonly track: string;
}

/** One close-up set: its manifest's entries and the files actually on disk. */
export interface CloseupCatalogue {
  readonly entries: Readonly<Record<string, CloseupManifestEntry>>;
  readonly files: ReadonlySet<string>;
}

const SHIPPED: CloseupCatalogue = {
  entries: (closeupManifestJson as unknown as { closeups: Record<string, CloseupManifestEntry> }).closeups,
  files: new Set(
    Object.keys(import.meta.glob('../../../../assets/ui/garage/closeups/*.jpg', { eager: true })).map((p) =>
      p.slice(p.lastIndexOf('/') + 1)
    )
  ),
};

/**
 * The close-up URL for `unitId`'s `track`, or `null` when none was
 * photographed (or its file is missing). `base` is the close-ups directory; a
 * trailing `/` is added if missing.
 */
export function trackCloseup(
  base: string,
  unitId: string,
  track: string,
  catalogue: CloseupCatalogue = SHIPPED
): string | null {
  const entry = catalogue.entries[`${unitId}_${track}`];
  if (entry === undefined || !catalogue.files.has(entry.file)) return null;
  return (base.endsWith('/') ? base : `${base}/`) + entry.file;
}
