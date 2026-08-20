# Beit Sahwan IV — design

**Date:** 2026-08-20
**Issue:** [#91](https://github.com/ilan-pinto/roaring-lions/issues/91)
**Part of:** subterranean warfare, piece 2 of 2. The subsystem it stands on is
`2026-08-18-tunnel-subsystem-design.md`, slices 1–3. This is slice 4.
**Status:** approved, not yet built.

## The problem

`subterranean` has been in `mission.schema.json`'s phase enum and in the GDD's
six-phase spine since the format was written, and no mission has ever used it. The
other five phases all have at least one. The tunnel subsystem shipped in
`feat/tunnel-subsystem` and its final task wired both content keys — a placement's
`digs` assigns a route's digger, a `mark_tunnel` carrier with a sight line
identifies one — so the engine can now dig, find and collapse a route from mission
JSON alone. What is missing is a mission.

This is that mission. It is also the fifth in Beit Sahwan, which takes the town to
GDD §6's stated ceiling of three to five.

## What the issue promised that the engine does not do

#91 justifies itself with GDD §4's headline carry-over example: *thorough recon →
tunnel mouths pre-marked; rushed recon → shafts found under fire.* It proposed to
make that literal by having the mission `require` `intel.marked_positions`.

The engine does not support it, and after the subsystem's playtest it should not.

`intel.marked_positions` pre-reveals **units by tag** (`mission.ts:942`), and the
code exempts buried placements explicitly: *"last mission's recon saw where the
route ran, not who is inside it today."* `identifyTunnelTo` has exactly one caller,
`markerSeesRoute` inside `stepDetection`. There is no path from the ledger to a
route's contact state.

More decisive: the subsystem's post-playtest reversal made tunnel visibility
**live**. A route is identified only while a living `mark_tunnel` carrier of that
side holds a clear sight line to it; unwatched, the contact decays back down the
ladder. The owner's phrase for the rule is *detectors, not cartographers*. A route
"pre-revealed at t=0" would fade within seconds of nobody watching it. Ledger
pre-reveal is not merely unbuilt — it contradicts the rule the subsystem settled on.

**Resolution.** The mission keeps
`requires: [roster.surviving_units, intel.marked_positions]`, and the marked tags
pre-reveal the **surface ambushers guarding the routes** — the ordinary behaviour
that already makes a marked ambusher hold position instead of springing. Good recon
still visibly pays off. Finding the tunnels themselves stays the drone's live job,
which is what the shipped rule says it should be. No engine change.

## A second promise with nothing behind it

`mission.schema.json`'s wave `from` reads *"Spawn point or tunnel id. Tunnels keep
producing until located and collapsed."* `mission.ts:1307` resolves `from` through
`markerPos` only; a tunnel id there is an unknown marker. Tunnel-sourced
reinforcement waves do not exist.

This design does not use them and does not build them. Underground pressure comes
from `in_tunnel` garrisons surfacing at their vents, which is the loop the subsystem
was actually built around. The schema text should be corrected or the feature built,
but that is neither this mission's job nor its blocker.

## Geography

The map is the existing 48×48 `beit_sahwan_outskirts`, shared with Beit Sahwan I,
II and III. Route geometry is map data, so everything here is visible to those three
missions too, and that constrains the design more than it first appears.

Four routes, every mouth inside the `town` zone (`[19, 9, 22, 31]` — x 19–40,
y 9–39), every mouth on open ground rather than under a footprint.

| Route | Mouth | Waypoint | Vent | State in this mission |
|---|---|---|---|---|
| `bs_tn_west` *(exists)* | `[30,22]` | `[24,22]`, `[18,22]` | `[7,22]` | re-dug live by a `digger_crew` |
| `bs_tn_north` *(new)* | `[27,13]` | `[30,17]` | `[33,21]` | `pre_dug`, stocked |
| `bs_tn_souk` *(new)* | `[22,29]` | `[24,26]` | `[27,23]` | `pre_dug`, stocked |
| `bs_tn_clinic` *(new)* | `[35,26]` | `[33,23]` | `[31,21]` | `pre_dug`, stocked |

Coordinates are indicative. The exact tiles get settled against `walk_mission`
during implementation; what is load-bearing is the shape — mouths at the district's
edges, vents on the axes the player must cross, and no polyline running under a
large building footprint, because a trail tile under one can park a charge team just
out of range where it latches without ever completing.

### `pre_dug` is map state, not mission state

The three new routes are `pre_dug` in Beit Sahwan I, II and III as well. They are
inert there — no digger, no occupants, nothing surfaces — and the one visible effect
is that a recon drone flying the district in I or III draws their faint identified
line at alpha 0.18. That already happens with `bs_tn_west` today. It reads as
foreshadowing rather than a defect: the network is under the town from the first
mission, and only a detector can read it.

`bs_tn_west` stays *not* `pre_dug`. It cannot be: Beit Sahwan II digs it, and
`validate_data.mjs` refuses a `digs` placement naming a pre_dug route — nothing left
to excavate.

### The collision with Beit Sahwan II, and the fix

Beit Sahwan II already carries a **secondary `collapse` over the `town` zone**. A
`collapse` snapshots every mouth in its zone at mission start, and all map routes
register unconditionally whether or not a mission references them. So any route
added inside `town` silently expands Beit Sahwan II's secondary from one route to
four, against the same single Yahalom and the same twelve minutes.

`validate_data.mjs` would not catch it. It checks that mouths exist in the zone, not
that their number is what the author intended.

The fix is one new map zone, `tunnel_mouth_west` — a tight rect around `[30,22]` —
and Beit Sahwan II's secondary retargeted from `town` to it. This preserves exactly
what that objective means today; its own text says *"the tunnel Ashwar is digging"*,
singular. It also makes the objective immune to every future route added to the
district, which is the actual point.

## The mission

`beit_sahwan_4_subterranean`, phase `subterranean`, `target_minutes: 6`.

You hold Beit Sahwan. The network under it is still live.

### Where the player starts, and why it matters

**`player_start: [26, 34]`** — the southern approach road, coming up into the
district.

This is not decoration. `bs_tn_west`'s polyline runs the length of the western half
of the map, so from any start in the west it passes within a tile of the spawn and
its collapse is free before the mission begins. From the east, `bs_tn_west` and
`bs_tn_clinic` both fall inside a Yahalom's sight-8 at t=0 and are identified for
nothing. From the south the shanty block at x 22–24, y 30–32 breaks the sight line
to the nearest route tile, so **no route is identified for free** and finding is
work the player does.

### Starting force

| Unit | Count | Notes |
|---|---|---|
| `yahalom_squad` | 2 | in `starting_force`, never buildable-only |
| `recon_drone` | 1 | the detector that makes finding cheap if flown well |
| `inf_squad` | 3 | `from_ledger` |
| `ifv_namer` | 1 | `from_ledger` |
| `apc_eitan` | 1 | |

Two Yahalom, not one. `starting_force` never consults a unit's `unlock` gate, but
`requestBuild` does, and `yahalom_squad` is gated at `roe_rating_min: 55` — so a
player whose ROE has slipped cannot replace the one unit the primary depends on.
That is precisely the trap Wadi Halam V has with its demolishers (#93). A spare in
the opening force is the answer, and the `seconds` deadline is the backstop: as
built, `collapse` fails on the clock and on nothing else (`mission.ts:1355`). The
subsystem spec's design text said it would fail "when no living unit can carry a
charge"; that check was never implemented, so the deadline is the only thing that
turns a Yahalom wipe into a loss rather than a mission that can neither be won nor
lost.

### The two discovery channels are the teaching spine

`bs_tn_west` is being re-dug, so it lays spoil — disturbed earth any unit can see,
leading the player to a route. The three `pre_dug` routes never stamp trail, so only
the drone or a Yahalom with eyes on can read them.

That contrast is `trail.ts`'s own sentence made into the mission's structure:
*anyone can see dirt, only a detector reads the route.* It is why the drone is worth
flying, and it is the one thing this mission can teach that no other mission can.

`stepDigging` checks only that the assigned digger is alive, never where it stands,
so the `digger_crew` sits deep in the north block behind the garrison rather than
exposed at the mouth. Killing it stops the dig; it does not collapse the route, and
the charge is still owed. Counterplay, not a shortcut.

### Objectives

| id | type | primary | target | notes |
|---|---|---|---|---|
| `bring_it_down` | `collapse` | yes | `town` | deadline set by measurement, ~300s |
| `read_the_ground` | `locate` | no | — | count 3 |

One primary. Wadi Halam V carries three at once, two of them serial, and #93 is the
measurement of what that does to a time budget. A primary `collapse` must declare
`seconds`, for the same reason `raze` must: losing every unit that can work a charge
makes it permanently impossible, and without a deadline to fail on the mission is
unwinnable and unlosable at once.

The deadline is set from what the walk measures, not from what this document guesses.

### Enemy

Ashwar. Surface garrison kept light and tagged, because the tunnels are the fight
and the garrison is the reason crossing the district costs something:

- `militia_cell` garrisoned in the shanty, covering the souk mouth
- `militia_cell` garrisoned in the north house block, covering the digger
- `rpg_team` in `ambush` on the main road
- `charge_squad` in `ambush` at the crossroads — their engineers against yours
- `digger_crew` with `digs: bs_tn_west`, behind the north block

Stocked below, via `in_tunnel`: RPG and militia in the three `pre_dug` routes,
surfacing at their vents as the player crosses their axis. Buried placements take no
tag, so they never count toward `locate` — the runtime exempts them from both books
deliberately, and identifying a body through three metres of earth would complete an
objective against a unit nobody can see or reach.

Two waves, at 150s and 240s. Sized against #90's finding that Wadi Halam's holds run
two thirds of their length with no contact at all, rather than copied from them.

Civilians present with `civ_refuge`; `roe.enabled` with `clinic` flagged and
`fail_below: 40`, matching Beit Sahwan III. No `evacuate_before` objective — the
civilians are ROE risk, not an escort task, which also keeps the mission clear of
the stranded-passenger latch recorded in CLAUDE.md.

### Resources

`logistics_start: 500`, `logistics_rate_per_min: 90`. A replacement Yahalom costs
260, so one is affordable early — for a player whose ROE still permits it.

## What this touches

| File | Change |
|---|---|
| `data/maps/beit_sahwan_outskirts.json` | three new `pre_dug` routes; new `tunnel_mouth_west` zone |
| `data/missions/beit_sahwan_2_foothold.json` | secondary `collapse` retargeted to `tunnel_mouth_west` |
| `data/missions/beit_sahwan_4_subterranean.json` | new |
| `data/campaign/world.json` | mission appended to the Beit Sahwan town list |
| `packages/data/src/index.ts` | mission imported and registered |
| `tools/src/backtest/playtest.ts` | scripted winnable run, plus a no-orders control |

No `packages/sim` change. No `packages/render` change. If either turns out to be
required, that is a finding to raise rather than a task to absorb.

## Verification

- `pnpm validate:data` — including the three tunnel checks the subsystem added: an
  `in_tunnel` naming an undeclared route, a `collapse` whose `target` is not a zone,
  and a `collapse` over a zone containing no mouths.
- `pnpm typecheck`. CI runs it and CLAUDE.md omits it; literal-union fields in
  mission JSON break JSON-module call sites and nothing but `tsc` catches it.
- `walk_mission` over a full run, showing the chain end to end: the dig advancing and
  stamping spoil, routes moving up the contact ladder, charges completing, mouths
  falling out of the `collapse` tally.
- `tools/src/backtest/playtest.ts` gains a scripted plan proving the mission winnable
  inside its budget **and** a no-orders control proving a passive force does not win
  it — the pair `c5e91dd` established for the Wadi Halam arc.
- Measured against 6 minutes, and the `seconds` deadline set from the measurement.
  Mission difficulty must be measured; the other four Beit Sahwan missions are 10–12
  against a 5–7 target (#84) precisely because `target_minutes` was a claim rather
  than a number anyone checked.
- `pnpm test:determinism` unmoved. Nothing here is sim code, so any movement in the
  pin is a bug in this work.
- Beit Sahwan II re-walked after its `collapse` retarget, confirming its secondary
  still resolves against exactly one route.

## Scope

**In:** the map's three new routes and the `tunnel_mouth_west` zone, the Beit Sahwan
II retarget, the mission, its registration, and its playtest pair.

**Out, deliberately:**

- **Ledger pre-reveal of routes.** Contradicts the live-visibility rule; see above.
- **Tunnel-sourced waves.** The schema promises them, `mission.ts` does not
  implement them, and building that is a subsystem change.
- **Bringing the other four Beit Sahwan missions into the 5–7 band.** That is #84,
  and this mission is authored to target rather than to their precedent.
- **ROE cost for collapsing a route under a civilian structure.** Explicitly out of
  the subsystem spec, and still out.
- **The two artless units.** `digger_crew` and `yahalom_squad` ship without sprites;
  that is #92.
