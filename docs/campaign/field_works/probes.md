# Field works: the §9 probes and what they measured (GH-277 Task 14)

**The bands in this file are frozen.** They are the spec's (`docs/superpowers/specs/2026-09-29-field-works-design.md` §9),
approved at G-NUM on 29 Sep 2026. A red probe is content to retune on the lead's call. It is never a band to widen, and
never a reason to touch `packages/sim/src/tuning.ts`.

Run: `pnpm fw:probes` (all), `pnpm fw:probes -- --only=outpost` (one). The same probes run as tests in
`tools/src/backtest/field-works-probes.test.ts`; `fw-tunnel-radius` is `tools/src/fw_tunnel_radius.test.ts`. Every seed
is fixed and every structure type is read from `data/structures.json`, never from a literal. Measured 4 Nov 2026 on
`feat/field-works-content` (main `95f3e6b28`).

| probe | band | measured | kind |
|---|---|---|---|
| `fw-garrison-supp` | a 2x2 garrison kills more than 0 against a raid (GH-280's pin) | 2 `inf_squad` in a 2x2 house vs 8 `militia_cell`, 20 seeds: **1.95 kills/run**, held 100% | test |
| `fw-outpost-raid` | 3 `inf_squad` in an outpost: heavy-raid hold 40-80% (G-NUM measured 63%) | 30 seeds: heavy raid (12 `militia_cell` + 3 `rpg_team`) **hold 60%**; light raid (8 militia) hold 100% | test |
| `fw-fp-assault` | 4 inf + AT against the militia firing position: it falls >= 80% | 30 seeds, 300 s: 4 inf + AT **falls 83%**; 4 inf + mortar falls 73% | test |
| `fw-medic-lull` | with a station behind the attacker: 2:1 <= 85% and >= 15 pp under 3:1 | 60 seeds: unscripted 0 / 30 / 100%; fall-back pulse, no station 0 / 2 / 100%; fall-back pulse, station **0 / 17 / 100%** (1:1 / 2:1 / 3:1) | test |
| `fw-urban-garrisoned` | x1.06 on every defender still passes the §5.7 urban band | 60 seeds: **0 / 25 / 100 / 100%** (1:1 .. 4:1); the §5.7 reading at the time of the spec was 0 / 42 / 100 / 100 | test |
| `fw-workshop-pk` | recorded; a destroyed hull never returns | below | recorded |
| `fw-op-saddle` | recorded; the lead's design call (L5) | below | recorded |
| `fw-tunnel-radius` | no allow-listed mission has a flat 2x2 pad whose `tunnel_radius` covers a route a primary needs | 5 missions list the intel centre; none of their maps has a tunnel route, so 0 of 5 walks has anything to cover | test |

## Scenarios (these are mine to define; the spec gave the question and the band)

- **Raids.** The raiders attack-move from the east onto a 2x2 building at (20,30) on open ground; the defenders are
  garrisoned first. A hold is at least one defender alive at 120 s. The *light* raid is the GH-280 raid (8 `militia_cell`).
  The *heavy* raid had to be found: 8 or 12 militia alone never dislodge three squads in an outpost (100% hold at 16
  militia), 8 `sarim_rifles` + 4 `rpg_team` holds 25%. 12 militia + 3 `rpg_team` holds 60-70% and was fixed on 30 seeds
  at 60%, next to the 63% the spec quotes. The RPG teams are what kill the garrison, by killing the building.
- **Firing position.** Three `militia_cell` garrisoned in a 2x2 `militia_firing_position` at (40,30); the attackers start
  at x = 8-10 and sweep to (40,31). "Falls" is every defender dead inside 300 s (a first 240 s window read 77%: the Spike's
  reload is the clock, and the 300 s matches `urbanAssault`'s).
- **Medic lull.** `targets.ts`'s `urbanAssault` (the §5.7 town) with a hook (`UrbanHooks`; absent, the function is
  byte-for-byte what `urbanRatio` always measured and `pnpm balance` is unchanged). The scripted fall-back is a PULSE per
  assault group: under 60% of its hp it walks to (20.5,15.5) beside a `kdf_medic_station` at (20,12), stays until 95% of its
  hp, until it stops healing for 40 s, or 120 s, then sweeps again. The same orders run with and without the station.
  A first version pulled single squads out and fragmented the groups: 2:1 read 0-2% either way.
- **Urban garrisoned.** The x1.06 of a workshop reaches a defender only inside four tiles of the work, and a work in the
  town's own lanes would move the fight, so the probe applies the same x1.06 to the defenders' weapon `accuracy` (what
  `hitFactors` multiplies by, capped at ONE) in an in-memory copy of `militia_cell`. It reads the SAME `urbanBandPass` as
  `urbanRatio`.
- **Workshop.** One Lavi, static, shot by three `atgm_cell` for 40 s; then the cells are killed (`debugKill`) and the hull
  is watched for 120 s.

## `fw-workshop-pk` (recorded)

30 seeds each, the same seeds in every arm, 36 Spike penetrations in each:

| arm | hulls with a mobility or firepower kill at 40 s | of those, fighting again within 120 s |
|---|---|---|
| no workshop | 10 | 3 (field repair) |
| workshop 3 tiles away | 2 | 2 |
| workshop 12 tiles away | 10 | 3 |

So with the workshop at 3 tiles 2 hulls are still crippled at 40 s where the other arms leave 10, and both of those come back;
at 12 tiles the workshop is out of reach and reads exactly the no-workshop arm. `destroy`
stays final: a hull killed outright beside a workshop is still dead 120 s later (asserted).

## `fw-op-saddle` (recorded; L5 is the lead's)

`saddle-price.ts --op=x,y` stands a `militia_observation_post` (1x1, sight 9, optics 1.2) on a tile of `tel_marum_3_clearance`.
The attack-move arm is the price a player who fights his way up pays; 10 seeds; foot losses a run:

| post | pass | defile, plain move (trap) | defile, attack-move |
|---|---|---|---|
| none (baseline) | 0.00 | 3.90 | 0.30 |
| (9,14), west of the defile's north end | 0.00 | 1.90 | 0.30 |
| (12,14), east of the north end | 0.00 | 2.00 | 0.10 |
| (13,13) | 0.00 | 3.90 | 0.60 |

Nothing moves outside the noise of ten seeds (the foot loses 0.1 to 0.6 a run in the arm that matters, baseline 0.3).
The post adds no price to the corridor: the shipped `tm_spotter_narrow` already stands at its north end, and a post that sees
the corridor stands inside the weapons the flank is carrying. **The plan's rule stands: no OP in `tel_marum_3_clearance`
without the lead's call.**

## What each check was seen to do when its input was broken

| check | broken input | reading |
|---|---|---|
| `fw-garrison-supp` | `applySuppression` reads the tile's cover under a garrisoned man, not `garrison_cover` (GH-280 reverted) | kills **0.00** a run: red |
| `fw-fp-assault` | `militia_firing_position` `range_bonus` 0 -> 1 | AT arm **83% -> 7%**: red |
| `fw-outpost-raid` | `kdf_outpost` `hp_per_tile` 400 -> 800 | heavy hold **60% -> 100%**: red (above the 80% ceiling) |
| `fw-outpost-raid` | the plan's named mutation, `range_bonus` 0 -> 2 | **57%: does not move.** The raid is won by RPG teams that kill the building, not by who shoots first, so the outpost's reach is not what this probe measures. The HP mutation above is the one that proves the ceiling. |
| `fw-urban-garrisoned` | defenders with 3x the hp and damage | 3:1 reads **5%**: red (the x1.06 itself does not move the band: 0 / 25 / 100 / 100) |
| `fw-tunnel-radius` | `kdf_intel_centre` added to `deir_amun_2_foothold`'s list | **172 of 1,037** pads cover the pump route: red |
| `fw-medic-lull` | `heal_per_s` 0.01 -> 0.03 (the plan's named mutation) | 2:1 **17%**: **does not move** |

### Two honest findings

1. **`fw-medic-lull` cannot be turned red by the station's heal rate.** The medic changes the fight a little (2:1 with
   the pulse: 2% without a station, 17% with one) but a faster station (`heal_per_s` 0.03, 0.3 and 5.0, tried at the hook, 40 seeds) reads 17-22%
   all the same, and defenders with zero accuracy only reach 70%. The clock and the pulse's lost time bind, not the heal.
   The probe is a CEILING on the lull (2:1 may not become a walkover), and the shipped station sits at 17% against an
   85% ceiling. Its band logic is pinned with literal inputs (`medicLullPasses`). The spec's `hold_for` wave replay half of
   this probe is **not built here**: it needs a mission, and Task 15's playtest of the foothold plans is the instrument
   (the endure-clock band, 0.70-1.00 of target, with a plan that builds).
2. **`fw-tunnel-radius` is true by absence.** None of the five missions that list the intel centre has a tunnel route on
   its map, so the radius covers nothing there. The test keeps it from passing on nothing: it pins `checked === 5`, walks
   every legal pad of each (a mission whose walk saw no pad fails), and runs `deir_amun_2_foothold` with the centre as a
   control that MUST find covering pads.
