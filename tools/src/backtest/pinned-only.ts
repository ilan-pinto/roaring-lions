// Labels that end in one of these are replays held on the pinned seed only: `(max tier)` since the brigade economy's Task 5, and `(track replay)`
// (GH-1144), the nine bought units' tracks one at a time. The 30-seed plan sweep and the intel gate leave them out: a replay is judged against its
// own plain line, not swept. (`(known passive win)`, GH-1385, was retired by GH-1378 Q12: no control is expected to win now.) A module of its own so the intel gate (tests import it) does not load the harness to read one list.
export const PINNED_ONLY_SUFFIXES = ['(max tier)', '(track replay)'] as const;
export const isPinnedOnly = (label: string): boolean => PINNED_ONLY_SUFFIXES.some((suffix) => label.endsWith(suffix));

/** GH-1384: the label of a plain victory's branch-2 max-tier replay (`<id> branch 2 (max tier)`). It still ends in `(max tier)`, so it
 *  is pinned-only like the branch-1 one. */
export const branchTwoMaxTierLabel = (id: string): string => `${id} branch 2 (max tier)`;
/** GH-1384, the lead's ruling on PR 1584: the branch-2 max-tier replays are REPORT-ONLY for the win floor (`min_win_seconds`). The floor
 *  counts the runs it counted before branched tiers, the branch-1 `(max tier)` replay included, so the floors stay as they are. */
export const isFloorReportOnly = (label: string): boolean => label.endsWith(' branch 2 (max tier)');
