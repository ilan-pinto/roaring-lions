// The versus map list, split out of `versus.ts` so the shell's entry can build `VersusDeps.maps` (and the arena setup's)
// without pulling the whole lobby screen into the boot closure; `versus.ts` re-exports it.
import { versusMapAllowed } from '@lions/net';
import { localizedMapManifest } from '../place-text';

/** The maps a room can be hosted on (R-B9): the free-play picker's maps that
 *  the lead opened for versus (GH-561, 2026-10-14) -- the ones measured close
 *  to even, `VERSUS_FAIR_MAPS` -- by their own names. The tile studies and the
 *  tutorial ground are not among them, and neither is a map nobody has
 *  measured; the Worker refuses those too (`versusMapAllowed`). The names are the synchronous manifest's (B6-6): a
 *  map's JSON is not loaded to list it. The default catalogue is the locale overlay's (`place-text.ts`, GH-1406), read at CALL time; the
 *  ids, the order and the filter are the manifest's. */
export function versusMaps(catalogue: Record<string, { name: string }> = localizedMapManifest()): { id: string; label: string }[] {
  return Object.keys(catalogue)
    .filter(versusMapAllowed)
    .map((id) => ({ id, label: catalogue[id].name }));
}
