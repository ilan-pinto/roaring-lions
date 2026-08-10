# The carry-over spine — design

**Date:** 2026-08-10
**Status:** approved, not built
**Part of:** campaign structure, piece 1 of 4 (see *Sequencing* at the end)

## The problem

The GDD is unambiguous that carry-over *is* the campaign: "Phases are not independent
set-pieces… This is one system expressed five ways, not five minigames." It gives the
canonical example — "Beit Sahwan III reads `tunnel_mouths_marked`. If Mission I went
badly the list is short and the player finds shafts under fire."

None of that exists. `LedgerData` understands three keys — `roster.surviving_units`,
`roe.cumulative_rating`, `campaign.completed_missions` — and no mission declares or
consumes any `intel.*` key. Recon quality propagates as survivors and a rating, which
are outcomes of *any* mission, not of reconnaissance. So the four missions are four
standalone levels that share a save file, and every mission added before this is fixed
adds to that rather than to a campaign.

The runtime is at least honest about it. `stepLedger` writes the three keys it knows
and comments the rest: "Unknown keys: declared for the future, produced by nothing yet."

## The key idea: intel is a set of authored tags

Entities do not persist between missions — mission II spawns its own units, with its own
entity ids. So carry-over cannot reference anything the runtime created. It has to
reference something the *author* wrote.

`placement` already has an optional `tag`, used today by `eliminate_hvt`. That is the
handle. Intel is a list of tags.

This is the whole design. Everything below follows from it.

## Producing

Mission I's enemy placements carry tags:

```json
{ "unit": "rpg_team", "count": 1, "marker": "rp_alley", "tag": "ambush_west",
  "stance": { "kind": "ambush", "tiles": 3 } }
```

When the detection model resolves any unit of a tagged placement to **identified**, that
tag joins `intel.marked_positions`. On exit, the ledger carries the list.

Nothing new is needed to earn it. `MissionRuntime` already accumulates `identified` from
`contact` events at `identified` level (`mission.ts:461`), which is how the `locate`
objective works today. Intel is that same signal, recorded against authored names instead
of entity ids.

**Why automatic rather than an explicit mark action.** `mark_target` and `mark_tunnel`
exist as unit abilities, and `canMarkTarget` is even parsed off the former, but nothing
consumes either. Implementing a mark verb would need a command, an intent, cursor UI and
a tutorial lesson — and it would reward clicking over ground already seen rather than
rewarding the sweep. Earning intel from detection rests the mechanic on the combat model,
which the GDD calls the product.

## Consuming

On `start()`, for each placement whose `tag` appears in the incoming
`intel.marked_positions`:

| effect | what changes |
|---|---|
| **pre-reveal** | its units spawn already in `identified`, so they are visible from tick one instead of being found under fire |
| **disarm** | a `stance.kind: "ambush"` spawns as `hold_position` — knowing where an ambush is removes the surprise, not the enemy |

Everything untagged, and every tag not in the list, spawns exactly as authored.

The consequence worth having: **one mission file plays differently by ledger.** There are
no per-outcome variants to author and no branching to maintain. The author writes the
hard version and good recon softens it.

`disarm` is the effect with teeth. The GDD says `ambush` "is the entire reason recon
quality matters by Phase 4", so downgrading it is the mechanical expression of that
sentence. It also needs no new vocabulary — only a stance substitution at spawn.

## Partial credit falls out

Sweep half the ground and half the tags are marked. The list length *is* the grade. No
thresholds, no grading rules, no tuning constants, and no way for the grade to disagree
with what the player actually did.

## Two deliberate deviations from the GDD

**`intel.marked_positions`, not `intel.tunnel_mouths_marked`.** There are no tunnels in
the sim — `tunnel_travel` and `mark_tunnel` are strings in unit data, and CLAUDE.md lists
tunnels as a known debt. A ledger key naming something unbuildable would be a lie in the
save file. Tags are forward-compatible: when tunnels arrive they get tagged placements
like any other emplacement, and the key does not change.

**`mark` stays unimplemented.** With automatic intel, `mark` and `locate` are the same
predicate — "are these identified?" — and two names for one predicate is worse than a
gap. Intel accrues from detection whether or not an objective asks for it; `locate`
remains how a mission tells the player to go and look. The schema keeps `mark` in its
enum, where the runtime already throws `objective type "mark" is not supported by the
runtime yet`, so no mission can use it by accident.

## Scope

**In:** the `intel.marked_positions` key, produced from tagged placements and consumed as
pre-reveal and ambush-disarm; a `validate_data.mjs` check; tests; and tagging Beit Sahwan
I, II and III so the spine carries something real.

**Out:** `intel.civilian_zones_flagged` and the ROE half — a natural second key, but
neither chosen effect needs it. Skipping the `locate` step on marked targets, which
removes gameplay rather than changing it. Any mark verb. Tunnels.

## Validation

JSON Schema cannot see across a mission's own fields well enough for this, so
`validate_data.mjs` gains one check: **a mission declaring
`requires: ["intel.marked_positions"]` must have at least one tagged placement.**
Otherwise the requirement silently does nothing — which is precisely the failure this
spec exists to remove, and it would be invisible in play.

## Determinism

Intel is derived from `contact` events, which are deterministic, and consumption only
alters spawn state. A given ledger therefore yields a given mission exactly.

The golden hash in `determinism.test.ts` runs a synthetic world with no ledger, so it
must not move. Assert that rather than assume it — and if it does move, the fault is in
the consumption path touching state it should not.

## Verification

**Tests** in `mission.test.ts`, colocated as always:

- a tagged placement identified during a mission appears in the produced ledger
- an untagged placement never does, however thoroughly it is seen
- a tag in the incoming ledger spawns its units already identified
- a tag in the incoming ledger downgrades `ambush` to `hold_position`
- an absent tag leaves both alone, so a fresh campaign plays the authored version
- a partial list produces a partial effect, with the untouched placements still ambushing

**A world-state walk**, with `tools/src/walk_mission.ts`, of Beit Sahwan I feeding II.
No unit test sees a mission whose tags fail to line up between two files, and that is the
most likely authoring error this design introduces. The walk tool exists because judging
this class of thing by eye already failed three times in one sitting.

**Gates:** the full ten-command CI list, not the seven that are easy to remember.

## Sequencing

This is piece 1 of 4. The others, in order, each getting its own spec:

2. **Beit Sahwan completed** — the build-up and subterranean phases, so one town is five
   missions and becomes the template. After this piece, because phase 5's whole premise
   is reading what phase 1 marked.
3. **The campaign shell** — mission graph, unlocks, town progression, and the ledger's
   lifetime across a town boundary.
4. **Sur and Naharin** — the two remaining doctrines. Last, because the GDD's reason for
   three doctrines is to give contributors three templates to pattern-match, which needs
   one complete template first.
