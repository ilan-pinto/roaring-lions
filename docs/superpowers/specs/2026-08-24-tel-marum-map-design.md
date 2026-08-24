# Tel Marum — the first map with ground

**Date:** 2026-08-24
**Slice:** the map. Its three missions are a separate spec and a separate slice.
**Status:** approved, pending implementation plan.

## Why the map comes first

The Sur front design already decided what Tel Marum is:

> **"Tel Marum — the gateway."** The pass into the mountains. Three missions: recon (find the
> firing positions before committing), foothold (hold a start line under rockets), clearance
> (take the pass).

It also decided the ground: *"a valley floor you enter from, rock walls that block sight, and
saddles that are the only ways through."* What it could not do was author it, because until the
elevation milestone closed there was no height to author.

**The saddles are the doctrine.** Sarim cannot out-range anybody — the front design measured
that and said so plainly: their best weapon is the `atgm_cell`'s Kornet at 10 tiles, against
KDF's `mortar_team` at 18 and `sniper_team` at 15, so *"'standoff' cannot mean 'we shoot from
further away', because mechanically they do not."* What Sarim has instead is ambush at ten tiles
from ground the player cannot see into, which makes the map *"half the doctrine"*.

If the saddles are wrong, three missions built on them are wrong too. So the ground ships and
gets proven first, and the missions follow once it can be walked.

## The ground

48×48, arid, entered from the south. The valley floor is elevation 0; the pass at the north edge
is what the arc is for. Rock walls (`^`) run the east and west flanks at elevation 3–4 —
impassable, sight-blocking, no HP, no garrison, no ROE penalty. Per E2 every blocked tile stands
`BLOCK_RISE` (2) above its own ground, so a wall on an elevation-3 tile reads as height 5 to any
ray crossing it.

Relief stays inside 0–4, which the schema names the practical authoring range: *"deeper relief
reads as a wall rather than as terrain — but 0–9 is legal so a dramatic peak needs no format
change."*

Four features carry the doctrine.

### The hollow

A patch of elevation 0 behind a **two-level lip**, roughly a third of the way up the valley.
This is dead ground: a force forming up here is invisible to everything on the overwatch
shoulders. It is the Sur front's stated premise made literal — *"dead ground is where a force
forms up before crossing the last three hundred metres."*

**The lip is two levels because it has to be.** E3 gave observers `EYE_HEIGHT = 1`, so a
one-level rise sits exactly at eye level and hides nothing: **terrain needs two levels or more
to obscure ground troops.** A lip authored one level shallow would look identical in the JSON
and do nothing at all. That is the single easiest way to author this map wrong, so it gets a
test that fails at 1 and passes at 2.

**Two levels is the floor, not the guarantee.** That rule is stated for a ground-level observer.
The overwatch shoulders are at elevation 3, and a ray from an observer at sight height 4 down to
a target at 1 clears a 2-level lip comfortably when the lip sits near the observer's end of the
line — `lineH` is still high there. Concealment therefore depends on **where the lip sits along
each sight line**, not only on how tall it is: the lip has to be close to the hollow, so the ray
is already descending past it. The map is authored to satisfy the assertions below rather than
the rule of thumb, and if a lip has to go to 3 to hold both shoulders off, it goes to 3.

### The wide saddle

Centre-north, elevation 2, about five tiles across. The obvious way through, and covered:
`atgm_cell` positions sit on elevation-3 shoulders either side at roughly ten tiles — exactly
Kornet's reach. Crossing it in the open is the mistake the map is built to punish.

### The narrow saddle

Northwest, elevation 3, two tiles wide, with a rock spur between it and the eastern overwatch.
Reachable, slower, and outside the covered arc.

**Two saddles, deliberately unequal.** A spike earlier in this milestone measured the standoff
advantage at roughly 30% through a single saddle and 23% through two — the doctrine dilutes when
the defender cannot cover the approaches. That dilution came from two *equivalent* routes.
Unequal ones do not average the same way: the decision becomes *pay in time or pay in vehicles*
rather than *pick either*, and the defender's arc still covers the route most players take first.

One saddle would bite harder and read as a corridor rather than as terrain — and it would leave
the recon mission with nothing to discover, since the only way through is visible from the start
line. Three or more would end the doctrine outright.

### The battery position

Beyond the pass, at the town's edge. The `rocket_battery` is the front's signature weapon, and
the front design is explicit that it *"must physically reach to stop, only taken"* — so it sits
where nothing short of taking the pass will silence it.

### Markers and zones

The map declares the anchors its three missions will need, so the missions slice adds no map
edits: `start_line`, `hollow`, `saddle_wide`, `saddle_narrow`, `pass`, `battery_position`,
`overwatch_east`, `overwatch_west`, `town_edge`; zones `valley_floor`, `pass`, `overwatch_east`,
`overwatch_west`.

## Terrain has to be able to hide things

E1 drew elevation and E2 taught sight to read it, but **the renderer cannot occlude a unit
behind a ridge.** On a flat map that is invisible. On this one it makes dead ground look like a
drawing error: a force in the hollow is correctly unseen by the enemy and incorrectly drawn on
top of the lip that hides it.

### The gap is a layer, not an algorithm

Units are *already* depth-sorted against buildings. Unit bodies go into the sortable
`spriteLayer` keyed by tile depth; only HP bars, suppression bars and selection rings live in
the always-on-top `unitsG`. The renderer says why:

> Depth sorting: a unit behind a building must be drawn before it, so the building covers it.

Terrain simply never joined that layer. Flat ground, extruded tops and side faces all draw into
`terrainG`, which is added to the world **before** `spriteLayer` and therefore sits beneath
everything unconditionally.

### Depth bands

Raised terrain moves into the sorted layer. One display object per raised tile would mean up to
~2,000 on a 48×48 map, so elevated tiles are instead **bucketed by diagonal (`x + y`): one
`Graphics` per depth band**, added to `spriteLayer` at that band's `zIndex`. A 48×48 map has at
most 95 bands — fewer objects than the building sprites already there — and correctness is
identical, because every tile in a band sits at the same view depth.

**Flat ground stays in `terrainG`.** It cannot occlude anything, so it does not need sorting,
and leaving it batched keeps the draw cost on all four shipped maps exactly where it is today.

Two details the plan must handle rather than discover:

- A unit standing **on** a raised tile must sort above its own tile's band. Buildings solve the
  same problem with a `+1` on their depth key.
- The fog layer stays above everything, so unobserved ground and the units standing on it keep
  hiding together.

**Out of this slice:** VFX are still not lifted to terrain height, and picking is still untested
mid-slope. Both are subtler than occlusion and neither lies about where a unit is. `raySmoke`'s
elevation-blindness stays deferred with them.

## The gate cannot see a broken elevation grid

`tools/validate_data.mjs` re-implements its grid checks instead of calling `parseMap` —
deliberately, so the gate stays a standalone Node script with no build dependency. But it checks
`rows` only. The elevation dimension checks live **only** inside `parseMap`:

```
map ${id}: elevation has N rows, declared height M
map ${id}: elevation row Y has N tiles, declared width M
```

The gate never calls it. **A malformed elevation grid passes `pnpm validate:data` green** and
throws later at load — in the app, in `pnpm playtest`, or in any test that parses the map.

Unreachable until now, because no shipped map has an `elevation` key. Tel Marum makes it
reachable, and a hand-authored 48-row grid of 48 digits is precisely the artifact that gets one
row wrong.

**Fixed in the shape the file already uses:** row-count, row-length and digit-range checks for
`elevation` beside the `rows` checks already there. And the new check is proven by failing —
a test feeds the gate a deliberately broken grid and asserts rejection. This milestone produced
three tests that passed with the code under test fully disabled; a validation check that has
never rejected anything is the same defect wearing a different hat.

## Verification

**The doctrine is the test suite.** Every claim the ground makes becomes an assertion against
the real map file, each blocking claim paired with the arrangement that *should* see — "cannot
see" alone also passes for a broken spawn, too short a sight range, or too few ticks:

| claim | paired positive |
|---|---|
| the pass is not visible from the start line | it is visible from the wide saddle's crest |
| the hollow is unseen from both overwatch shoulders | the open floor beside it is seen from both |
| the eastern overwatch does not cover the narrow saddle | it does cover the wide saddle |
| the battery is visible from the wide saddle's crest | it is not visible from the hollow |

**The lip gets its own test at both depths** — obscuring at 2, transparent at 1 — because that
is the E3 rule the entire dead-ground idea rests on.

**The renderer gets driven, not asserted.** A throwaway sandbox mission loads the map with a
handful of units and is walked in the browser: units into the hollow, over each saddle, along
the ridge line. Occlusion is a thing you look at. **The sandbox mission is deleted before the
branch merges** — a half-authored mission left in `data/missions/` would later have to be
reconciled with the real recon mission, and this project has a standing rule that console-level
verification does not count for anything you can drive.

**Gates:**

- `pnpm test:determinism` — **unmoved at `1639983699`**. The pinned replay runs on its own flat
  map and a new content file has no path into it. A moved pin means something touched the sim.
- `pnpm validate:data` — 69 → **70 files**, with the new elevation checks live.
- `pnpm balance` — five §5.7 figures unchanged. No unit data changes.
- `pnpm playtest` — red on exactly #96/#97, its known baseline, and gaining nothing: no missions
  yet.
- `pnpm test`, `typecheck`, `lint`, `validate:ui`, `build`.

## Scope

**In:** `data/maps/tel_marum.json` with its elevation grid, markers and zones; the depth-band
occlusion change in `packages/render`; the `elevation` checks in `tools/validate_data.mjs` and
the test that proves they reject; the line-of-sight tests above; a throwaway sandbox mission
used to walk the ground and deleted before merge.

**Out, deliberately:**

- **The three missions.** Their own spec and their own slice, authored against ground that can
  be walked.
- **VFX lifted to terrain height**, and **picking mid-slope**. E1 gaps, both still inert enough
  to defer: neither misplaces a unit.
- **`raySmoke`'s elevation-blindness.** Smoke pooled in a valley still blocks a ray passing six
  levels above it. Recorded in CLAUDE.md; unchanged here.
- **Slope movement cost** and **downhill cover.** Both cut from E3 with reasoning. Slope cost
  touches `FlowField.compute`, the pathing core every unit uses every tick.
- **Eye height on non-body endpoints.** Recorded in E3's spec, unchanged here.
- **`beit_sahwan_3_clearance`.** `world.json` unlocks Sur `after_mission:
  "beit_sahwan_3_clearance"`, and that mission is one of the two `pnpm playtest` is red on. It
  predates the tunnel subsystem — checking out `066445f` reproduces it byte-identically — and it
  blocks the *missions* slice's campaign contract, not the authoring of ground. Named here so
  the missions slice meets it as a known predecessor rather than a surprise.

## After this

Tel Marum's three missions: recon, foothold, clearance. They inherit a map whose sight lines are
already asserted, and they will need bespoke `playtest.ts` plans — three of them, plus three
no-orders controls proving each mission is losable, which is the harness's existing convention.

**The first thing that slice must reckon with: the two saddles are unequal by more than design
intended.** Driving the real `Sim` from all eighteen overwatch tiles found that the narrow
saddle is not merely slower than the wide one — it is free. A force can go hollow → west flank
→ narrow saddle → battery without ever standing on a tile that either overwatch pocket can both
see *and* reach at the `atgm_cell`'s Kornet range of 10 tiles. The whole cost of taking the
narrow route over the wide one is +9 tiles: 38 against 47. Nine tiles is not a price, and unless
a mission slices the cost some other way, the doctrine this map was built to enforce never
fires — every player takes the free path and nothing ever shoots at them.

This is not a terrain defect. The ground is correct, two independent reviews validated the sight
lines, and re-cutting it now would invalidate the fourteen assertions above to fix a problem
that only exists once missions exist to expose it — it is a constraint the missions slice
inherits, not a bug in this one. Whichever mission first uses the narrow saddle needs to charge
for it some other way: a reinforcement wave timed to arrive while the force is strung out on the
west flank, an objective timer that penalizes the slower route on its own terms, or a spotter
placed on the west flank so the narrow saddle is watched even though neither overwatch pocket
reaches it.
