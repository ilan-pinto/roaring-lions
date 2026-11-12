// The versus map list, split out of `versus.ts` so the shell's entry can build `VersusDeps.maps` (and the arena setup's)
// without pulling the whole lobby screen into the boot closure; `versus.ts` re-exports it.
import { maps } from '@lions/data';
import { versusMapAllowed } from '@lions/net';

/** The maps a room can be hosted on (R-B9): the free-play picker's maps that
 *  the lead opened for versus (GH-561, 2026-10-14) -- the ones measured close
 *  to even, `VERSUS_FAIR_MAPS` -- by their own names. The tile studies and the
 *  tutorial ground are not among them, and neither is a map nobody has
 *  measured; the Worker refuses those too (`versusMapAllowed`). */
export function versusMaps(catalogue: Record<string, { name: string }> = maps): { id: string; label: string }[] {
  return Object.keys(catalogue)
    .filter(versusMapAllowed)
    .map((id) => ({ id, label: catalogue[id].name }));
}
