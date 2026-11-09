/**
 * The ONE place the Worker learns what arena results are bundled (GH-954 P3). `null` until the first publication
 * (P4): `data/arena/results.json` does not exist yet, and a static JSON import of a missing file would break the
 * Worker build. The publication PR (which only the lead merges, D-P2) replaces this line with
 *   import results from '../../../data/arena/results.json';  export const ARENA_RESULTS = results as ArenaResults;
 * `arena-results.test.ts` goes red if the file exists while this still says `null`, so that step cannot be forgotten.
 */
import type { ArenaResults } from '../../../tools/src/net/arena-publish';

export const ARENA_RESULTS: ArenaResults | null = null;
