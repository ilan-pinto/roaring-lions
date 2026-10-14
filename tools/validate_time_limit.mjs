// #540: every mission's time limit (`time_limit_s`), checked against the house rule.
//
// The rule: at least twice the mission's own `target_minutes` (default 6, as the schema's), and at
// least DEADLINE_CLEARANCE_S past every PRIMARY deadline, so a mission that is losing on its own
// clock loses on that clock and never by the limit. Whether the limit also clears the slowest WIN
// is a measurement, so `pnpm playtest` holds that (tools/src/backtest/time-limit.ts), not this.
//
// Its own module because validate_data.mjs runs its whole sweep at import time and exits.

/** Twice the target, in seconds per target minute. */
export const LIMIT_PER_TARGET_MINUTE_S = 120;
/** How long before the limit a primary deadline must fire. */
export const DEADLINE_CLEARANCE_S = 60;
/** The primary clocks that run from mission start, with the runtime's own defaults
 *  (`stepObjectives`: survive_until 60 s, evacuate_before 300 s; raze/collapse have none). */
const DEADLINE_DEFAULT_S = { survive_until: 60, evacuate_before: 300, raze: undefined, collapse: undefined };

export function timeLimitFailures(mission, file) {
  const limit = mission?.time_limit_s;
  if (typeof limit !== 'number') {
    return [`${file}: declares no time_limit_s -- a stalled mission would never end (#540)`];
  }
  const out = [];
  const floor = (mission.target_minutes ?? 6) * LIMIT_PER_TARGET_MINUTE_S;
  if (limit < floor) {
    out.push(`${file}: time_limit_s ${limit} is under twice its target_minutes (${floor} s)`);
  }
  for (const o of mission.objectives ?? []) {
    if (o.primary !== true || !(o.type in DEADLINE_DEFAULT_S)) continue;
    const secs = o.seconds ?? DEADLINE_DEFAULT_S[o.type];
    if (secs === undefined) continue;
    if (limit < secs + DEADLINE_CLEARANCE_S) {
      out.push(
        `${file}: time_limit_s ${limit} does not clear primary "${o.id}"'s ${secs} s clock by ` +
          `${DEADLINE_CLEARANCE_S} s -- the mission would end by the limit instead of its own deadline`
      );
    }
  }
  return out;
}
