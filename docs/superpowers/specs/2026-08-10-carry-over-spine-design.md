# The carry-over spine — design

**Date:** 2026-08-10
**Status:** built. Five corrections to what is written below are recorded in
*As built*, at the end.
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

This is piece 1 of 4, and the sequence now follows the arc in
[#65](https://github.com/ilan-pinto/roaring-lions/issues/65) rather than treating towns
as interchangeable.

That issue's shape is **catastrophe → regroup → foothold → grinding clearance → the
tunnels underneath**: the campaign opens with the player *losing* a perimeter, and
everything after is the phased reconquest of the Marj. Its mission 2, *Cold Ground*, is
recon over ground that is now hostile and "marks tunnel mouths and civilian-occupied
structures for the whole rest of the campaign" — which is this spec, and is why the spine
comes first.

The pieces, each getting its own spec:

1. **This one.** `intel.marked_positions`, produced from tagged placements and consumed as
   pre-reveal and ambush-disarm, wired through Beit Sahwan I → II → III.
2. **The Marj arc** — eight missions across *three* towns (Beit Sahwan, Khan Rafid, Deir
   Amun), not one town padded to five. This supersedes an earlier plan to "finish Beit
   Sahwan to five missions", which treated towns as parallel and gave the campaign no
   shape. Absorbs #19 and #65's missions 2–8, and needs the build-up and subterranean
   phases, which nothing has exercised.
3. **The campaign shell** — #22 and #36: mission graph, unlocks, town progression, and the
   ledger's lifetime across a town boundary.
4. **Sur and Naharin** — #20, #21, #15, #16. Last, because the GDD wants three doctrines to
   give contributors three templates to pattern-match, which needs one complete arc first.

### One decision this does not make

#65's opening mission fits **none** of GDD §4's five phases, because all five assume the
player is advancing. It offers a sixth `breach` phase in the schema's enum, reusable by
any doctrine opening on the back foot, or a Foothold variant with the corridor pre-cut and
reinforcement disabled. Either is a GDD §4 change and wants deciding before mission 1 is
authored — it is out of scope here, and nothing in this spec depends on the answer.

---

## As built

Five things above are wrong or incomplete. The design holds; these are the corrections.

**1. The spine runs I → III, not I → II.** The plan said "wired through Beit Sahwan
I → II → III". Mission II is a `hold_for` on different ground with two enemies at
positions mission I never contains, so tagging it would create requirements no mission
can satisfy — the exact dead requirement the new data gate exists to catch. Missions I
and III were already authored over the *same* emplacements at the same coordinates, which
is the GDD's canonical example sitting in the repository waiting to be connected. So the
tags key on position and the pair is I → III.

Mission II does not need to relay the key: `main.ts` saves with
`saveLedger({ ...ledger, ...produced })`, a merge rather than a replace, so a key
survives any mission that ignores it. Worth knowing before piece 3 designs the campaign
graph — carry-over is currently additive and permanent, and nothing can un-know a thing.

**2. Pre-reveal needed a sim change after all.** The claim was that consumption "only
alters spawn state" and needs nothing new. It needs `Sim.identifyTo(side, target)`.

`MissionRuntime.identified` and the sim's contact state are two different books.
The first is the runtime's own bookkeeping, which is what `locate` objectives read; the
second is what the renderer draws and the combat model shoots at. Writing only the first
gave a pre-marked emplacement that satisfied its objective and stayed invisible on
screen, with the test green — because the test asked the runtime, which was the half that
worked. `identifyTo` is the per-entity body of the existing `reveal` command, extracted so
there is one definition of "this side has identified that", and the runtime now writes
both books.

Contact decay is deliberately not special-cased: an unobserved pre-revealed contact fades
like any other, so intel tells you where they *were*.

**3. Tag names are campaign-global, so they carry a town prefix.** The ledger is one flat
list that accumulates across towns. An unprefixed `ambush_west_alley` reused in Khan
Rafid would arrive already disarmed because Beit Sahwan marked a different alley of the
same name. All nine tags are `bs_*`, including the pre-existing `hvt_atgm`, whose
`locate` and `eliminate_hvt` targets moved with it. **Every tag added from here must
carry its town's prefix.**

**4. Intel is cumulative; contact is not.** The produced list means "identified at some
point", taken from the runtime's set, not "currently visible". Sampling live contact at
the end of a sweep under-reports badly — 1 tag against the 5 actually earned, because
contact decays every tick a target is unobserved.

**5. The walk tools were building a world with no cover and no buildings.** Both omitted
`setCover` and `addStructure`, so any mission with a `garrison` stance died on start with
`no building at (28,12)` — and the house is right there in the map rows. The tool reported
`beit_sahwan_3_clearance` as broken content when the tool was what was broken. Setup now
lives in `tools/src/walk_world.ts`, shared, mirroring `main.ts`. A walk tool is only worth
trusting if its world matches the one the game loads.

### What the walk shows

`npx tsx tools/src/walk_carryover.ts` plays the real recon and feeds its real ledger to
the real clearance mission:

```
mission ended t=78s: victory, produced 5 tag(s)
marked 5 of 9 authored tags
  tag                       fresh  carried
  bs_ambush_market_lane     0      2
  bs_ambush_west_alley      0      2
  bs_cell_centre            0      0
  ...
ambushes: 2 authored, 2 disarmed by this ledger
OK: 9 tagged emplacements; fresh all unknown, carried match the 5 marked
```

Partial credit is real and falls out of the sweep, as designed: four positions stay hidden
because that recon never looked at them.

### One thing found and not fixed

**Mission I is winnable in 78 seconds** against a 12–20 minute target. Its only primary
objective is `locate` with `count: 6`, and `identified.size >= 6` counts every enemy seen
anywhere — with ten placements on the map, a force that pushes east satisfies it before
reconnoitring most of the town. Pre-existing, unrelated to this spec, and now visible
because the walk plays the mission for real. It belongs with the Marj arc in piece 2,
where the recon mission is redesigned as *Cold Ground*; the honest fix is probably that a
recon objective should count *tagged* positions, which is a change to `locate`.
