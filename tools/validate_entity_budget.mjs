// GH-1438 E10 (docs/campaign/civilian-drama.md §10.2, G-10 a; the lead's ruling: 160): the
// authored-entity budget. The sim's capacity is 256 entities for the LIFETIME of a mission
// (`packages/app/src/main.ts`, `tools/src/backtest/playtest-run.ts`): dead bodies are never freed,
// and every wounded man a squad sheds (`fallMan`), every production purchase and every runtime
// spawn takes a slot. A runtime spawn that does not fit is skipped whole (`spawnPlacement`'s
// `soft` path), so an over-full mission does not crash: its late relief silently never arrives.
// The rule keeps at least 96 slots clear for that by holding what the JSON itself places to 160.
//
// What counts is what the JSON spawns, each body once, by the runtime's own arithmetic
// (`spawnPlacement`: a placement is `count` bodies plus `count` x each passenger row's `count`,
// because every carrier of a count>1 placement gets the whole declared load):
//   - `starting_force` (a `from_ledger` placement counts its `count`: the most it can draw);
//   - `civilians.groups`;
//   - `enemy.garrison`, passengers included;
//   - every `enemy.waves[].units` row (a wave spawns once, `spawnedWaves`; `stepWaves` passes no
//     passengers, so a wave row is its `count`);
//   - the `units` of every `spawn` and `reinforce` trigger, passengers included (a trigger fires
//     once, `firedTriggers`).
// NOT counted: production purchases, fire-support aircraft and shed wounded, which are the runtime
// headroom the 96 slots are for, not authoring. `structures[]` raise structures, not entities.
// An overlay (a difficulty posture, a challenge amendment) is judged on the overlaid mission by the
// test, which applies every shipped posture; this module only counts the object it is given.
//
// Its own module because validate_data.mjs runs its whole sweep at import time and exits.

/** The cap on authored entities a mission (lead/PM ruling, GH-1438 E10). */
export const AUTHORED_ENTITY_BUDGET = 160;

/** Bodies one placement spawns: its count, plus each carrier's whole declared load. */
function placementBodies(p) {
  const count = typeof p?.count === 'number' ? p.count : 0;
  let bodies = count;
  for (const q of p?.passengers ?? []) bodies += count * (typeof q?.count === 'number' ? q.count : 0);
  return bodies;
}

/** The authored entity count, split by source (for the failure message and the report). */
export function authoredEntityCount(mission) {
  const parts = { starting_force: 0, civilians: 0, garrison: 0, waves: 0, triggers: 0 };
  for (const p of mission?.starting_force ?? []) parts.starting_force += placementBodies(p);
  for (const p of mission?.civilians?.groups ?? []) parts.civilians += placementBodies(p);
  for (const p of mission?.enemy?.garrison ?? []) parts.garrison += placementBodies(p);
  for (const w of mission?.enemy?.waves ?? []) {
    for (const u of w?.units ?? []) parts.waves += typeof u?.count === 'number' ? u.count : 0;
  }
  for (const t of mission?.triggers ?? []) {
    const kind = t?.do?.kind;
    if (kind !== 'spawn' && kind !== 'reinforce') continue;
    for (const p of t.do.units ?? []) parts.triggers += placementBodies(p);
  }
  const total = parts.starting_force + parts.civilians + parts.garrison + parts.waves + parts.triggers;
  return { total, parts };
}

export function entityBudgetFailures(mission, file, budget = AUTHORED_ENTITY_BUDGET) {
  const { total, parts } = authoredEntityCount(mission);
  if (total <= budget) return [];
  return [
    `${file}: authors ${total} entities, over the budget of ${budget} (GH-1438 E10) -- ` +
      `starting_force ${parts.starting_force}, civilians ${parts.civilians}, garrison ${parts.garrison}, ` +
      `waves ${parts.waves}, spawn/reinforce ${parts.triggers}; the sim's 256 are for the mission's ` +
      `whole life, and a late spawn that does not fit is skipped silently`,
  ];
}
