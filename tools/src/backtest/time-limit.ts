// #540: does every mission's time limit clear the slowest win the harness has seen?
//
// `validate:data` holds the rule (twice the target, clear of every primary deadline). This holds
// the MEASUREMENT: over every winning run on every seed, the limit must clear the slowest by
// HEADROOM_S and by HEADROOM_RATIO, whichever is larger. A limit below a win already shows up as a
// missed seed; this catches the one that is merely too close, before a re-scripted plan crosses it.

export const HEADROOM_S = 120;
export const HEADROOM_RATIO = 1.2;

export interface WinTime {
  id: string;
  label: string;
  seconds: number;
}

export function limitHeadroom(
  wins: readonly WinTime[],
  limitOf: (id: string) => number | undefined
): { lines: string[]; failures: string[] } {
  const slowest = new Map<string, WinTime>();
  for (const w of wins) {
    const s = slowest.get(w.id);
    if (!s || w.seconds > s.seconds) slowest.set(w.id, w);
  }
  const lines: string[] = [];
  const failures: string[] = [];
  for (const [id, w] of [...slowest].sort(([a], [b]) => a.localeCompare(b))) {
    const limit = limitOf(id);
    const secs = w.seconds.toFixed(0);
    if (limit === undefined) {
      failures.push(`${id}: FAILED — wins in ${secs} s (${w.label}) and declares no time_limit_s`);
      continue;
    }
    lines.push(`time limit ${id}: ${limit} s, slowest win ${secs} s (${w.label}), headroom ${(limit - w.seconds).toFixed(0)} s`);
    if (limit < Math.max(w.seconds + HEADROOM_S, w.seconds * HEADROOM_RATIO)) {
      failures.push(
        `${id}: FAILED — time_limit_s ${limit} does not clear the slowest win (${secs} s, ${w.label}) ` +
          `by ${HEADROOM_S} s and ${Math.round((HEADROOM_RATIO - 1) * 100)}%`
      );
    }
  }
  return { lines, failures };
}
