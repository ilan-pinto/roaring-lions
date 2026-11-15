// Labels that end in one of these are replays held on the pinned seed only: `(max tier)` since the brigade economy's Task 5, and `(track replay)`
// (GH-1144), the nine bought units' tracks one at a time. The 30-seed plan sweep and the intel gate leave them out: a replay is judged against its
// own plain line, not swept. `(known passive win)` (GH-1385) is a no-orders control that is EXPECTED to win, pinned on all its seeds; it is
// a control and not a winning plan, so the plan sweep and the intel gate leave it out too. A module of its own so the intel gate (tests import it) does not load the harness to read one list.
export const PINNED_ONLY_SUFFIXES = ['(max tier)', '(track replay)', '(known passive win)'] as const;
export const isPinnedOnly = (label: string): boolean => PINNED_ONLY_SUFFIXES.some((suffix) => label.endsWith(suffix));
