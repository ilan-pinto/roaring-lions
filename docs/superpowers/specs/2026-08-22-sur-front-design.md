# The Sur front — design

**Date:** 2026-08-22
**Issues:** [#15](https://github.com/ilan-pinto/roaring-lions/issues/15) (Sarim roster and standoff doctrine), [#20](https://github.com/ilan-pinto/roaring-lions/issues/20) (Tel Marum and Umm Zeitoun missions)
**Status:** approved as a front design. Each slice below gets its own spec.

## The problem

Sur is the middle of the war and it does not exist. Two towns, zero missions, and a faction with **two units** where Ashwar has six and Rif has three. GDD §2 orders the war *proximity, then standoff, then source* — and the playable campaign jumps from the Marj to Naharin, skipping the middle entirely.

This is the design for the whole front, because building it piecemeal would decide its identity by accident. It is a milestone's worth of work, not a feature.

## Four findings that shape everything

Each was checked against the tree, not assumed.

### Sarim cannot out-range anybody

| unit | faction | longest weapon |
|---|---|---|
| `mortar_team` | **KDF** | 18 |
| `mortar_crew` | Ashwar | 16 |
| `sniper_team` | **KDF** | 15 |
| `mbt_lavi` | **KDF** | 12 |
| `atgm_cell` | **Sarim** | **10** |

The player's own mortars and snipers out-range Sarim's best weapon, and so do Ashwar's mortars. **"Standoff" cannot mean "we shoot from further away", because mechanically they do not.** Any design that leans on range is designing a front that does not exist.

### The mountain is a legend entry, not an engine feature

`losRay` returns `-1` for any blocked tile carrying no structure, so **sight-blocking terrain already works**. It is merely unauthorable: `TERRAIN_LEGEND` has no blocked entry at all, and every blocked tile in the game comes from `STRUCTURE_SYMBOLS`. A ridge today would have to be built from concrete *buildings* — destructible, garrisonable and ROE-scored, which is wrong on all three counts.

`Sim.setBlocked(x, y, b)` is already public and pathing already honours it. **One new terrain symbol makes mountains real.**

This answers #20's open question — *"elevation is not modelled — decide whether it needs to be, or whether range and LOS carry it"* — with: elevation does not need modelling, because sight-blocking terrain does the work elevation would.

### The existing `ambush` stance already carries the concealment

`ambush` holds fire at `AMBUSH_SIG` (0.5 — half signature) until an enemy closes inside its radius with line of sight, then springs. Ashwar authors it at 3 tiles. **Sarim authors it at 10** — the Kornet's full range.

Same mechanic, opposite distance: Ashwar springs when you are on top of them, Sarim springs at the edge of its reach having sat at quarter signature (0.5 unit × 0.5 ambush) the whole approach. You lose a Lavi to a 900-penetration missile from ground you had not looked at.

**Consequence: the front needs no sim change at all.** `hidden_setup` — declared on `atgm_cell`, `at_team`, `rpg_team` and `sniper_team` and read by nothing — stays dead, and #9 stays off this critical path. It can be revisited if the front measures thin.

### The dead-ability pattern is worth naming

`hidden_setup`, `tunnel_travel` and `breach` are all authored in unit data and honoured by nothing — the same shape `tunnel_travel` had before the tunnel subsystem. `mark_target` turned out to be live, but only as an intel generator (`mission.ts:719`), not as target designation. **A Sur design that assumed any of these worked would have been built on sand.**

## The doctrine

Three things, none of them range:

1. **Ambush at ten tiles, not three.** Concealed until it fires, at the edge of its reach.
2. **Rock that blocks sight.** Fields of fire and dead ground — the map becomes half the doctrine.
3. **A roster that can only fight at range.** If every Sarim unit is strong, few, and unwilling to fight close, then closing the distance is the player's problem to solve. That is the doctrine.

## The roster

Four new units alongside the existing `atgm_cell` (Kornet, range 10, penetration 900) and `loiter_drone` (kamikaze). Six total, matching Ashwar's depth.

| unit | role | why it exists |
|---|---|---|
| `rocket_battery` | indirect, ~20 tiles, heavy splash, very slow reload | GDD §2's *"rockets range onto Kedem's north"*. The front's signature and the thing you must physically reach to stop — it cannot be out-shot, only taken. |
| `sarim_rifles` | trained infantry: high suppression resistance and accuracy, expensive, few | "Best-trained" made mechanical. Where Ashwar's militia melts under fire, these hold, so ground must be *taken* rather than shocked. |
| `manpad_team` | anti-air at range | The front where the Peten and the drones stop being free. There is already a §5.7 AA target to measure it against. |
| `recoilless_team` | medium AT, cheaper than the 235-cost Kornet cell | Fills the gap between rifles and an ATGM, so a Sarim position is not all-or-nothing. |

All four must clear `validate_balance.py`'s ±18% cost band and leave `pnpm balance` unmoved on the five §5.7 targets. #15's stated extended target — *an ATGM cell firing from ≥8 tiles wins the cost exchange against an APS-equipped MBT over a three-missile engagement* — is the acceptance test for the doctrine as a whole.

**Deliberately not proposed: a spotter unit.** `mark_target` only generates player-side intel, so on an enemy unit it does nothing. It would be decoration.

## The ground

48×48, matching both existing campaign maps. Terrain theme `arid` reused rather than a third invented — the rock symbol carries the mountain read on its own, and a new theme is render work for no mechanical gain.

Shape: a valley floor you enter from, rock walls that block sight, and saddles that are the only ways through. **Dead ground matters as much as fields of fire**, because dead ground is where a force forms up before crossing the last three hundred metres.

## The two towns

Both follow the ascending-phase pattern the other towns already keep.

**Tel Marum — the gateway.** The pass into the mountains. Three missions: recon (find the firing positions before committing), foothold (hold a start line under rockets), clearance (take the pass). Opens at phase 2 like Wadi Halam, because you are never surprised again after First Light — but for the first time the enemy holds ground properly instead of melting.

**Umm Zeitoun — the source, and the front's climax.** Behind the mountain wall, where the rockets come from. Four missions: recon, **build-up** (phase 4 — only the second time in the war you prepare rather than react, and against Sarim you need it), clearance, then the batteries themselves.

## Slices

Each gets its own spec and plan. This document is the front, not the plan.

1. **Rock terrain.** Legend entry; blocked-terrain wiring into `main.ts`, `walk_world.ts` and `playtest.ts`; a render treatment; and a **bulk path** — `setBlocked` calls `recomputeFields()` on every call, so painting a ridge tile-by-tile at load would recompute flow fields hundreds of times. Independently useful and reusable by every later map.
2. **The Sarim roster.** Four units through the cost curve and the backtest. Closes #15.
3. **Tel Marum.** Map and three missions.
4. **Umm Zeitoun.** Map and four missions. Closes #20.
5. **The campaign re-sequenced.** Marj → Sur → Naharin, and the ending rewritten.

## What this does to the campaign's ending

`2026-08-21-campaign-storyline-design.md` ends the war on *"the corridor is cut and it is not decisive, because Sur was never contained"*, with Sur's absence as the ending's meaning. **Authoring Sur inverts that.** With Sur contained, cutting Naharin's corridor *is* decisive, which is the war GDD §2 actually describes.

That storyline spec is amended rather than discarded. Its progression fixes and its two story fields (`dispatch`, `aftermath`) stand unchanged; the `planned: true` flag drops away for Tel Marum and Umm Zeitoun as they are authored; only the ending's meaning inverts. **The storyline plan must not be executed as written while this front is being built.**

## Verification

- Every new unit through `python3 tools/validate_balance.py --units data/units` and `pnpm balance` with the five §5.7 figures unmoved.
- #15's ≥8-tile ATGM-versus-APS-MBT exchange, added to the backtest as the doctrine's acceptance.
- Every mission proven by the playtest harness, winnable *and* with a no-orders control that loses — the `c5e91dd` pair.
- `walk_mission` for each authored mission; the campaign walk from the storyline plan extended over the new towns.
- `pnpm test:determinism` unmoved. **Nothing in this front is sim code**, so any movement in the pin is a bug in the work.

## Scope

**In:** the doctrine, the roster, rock terrain, both towns' maps and missions, and the campaign re-sequencing.

**Out, deliberately:**

- **`hidden_setup` (#9).** The existing ambush stance carries the concealment. Revisit only if the front measures thin against the Marj.
- **A third terrain theme.** Rock reads as mountain without one.
- **Elevation.** #20 asked; sight-blocking terrain answers it.
- **A spotter unit and target designation.** `mark_target` does not designate, and building that is sim work this front does not need.
- **Khan Rafid and Deir Amun** (#19), the Marj's other two towns. A different front.
