# The three star-gated special units — design

**Date:** 2026-09-13 · **Status:** proposal for the lead. Written against this worktree at `main` 15a2b5c;
every number was produced this session and its command is cited. **Brief:**
`docs/superpowers/specs/2026-09-10-motivation-layer-design.md` D3 / §4.6 — stars unlock *special units
designed for this purpose*, not stat perks and not roster repairs. **Downstream:** `balance-analyst`
(envelopes), `blender-art` (three meshes), `sim-guard` (two schema fields), `mission-author` (placements),
`playtest` (the re-measure).

## 1. Premise and the two sets

The reward has to be shaped like the thing it rewards. Stars are earned by winning with Conduct intact and the
carrying secondaries done, so a star must make *that* easier — not make destruction cheaper. Two thresholds in
`packages/sim/src/mission.ts` decide whether a weapon is ROE-free at all, and they are the whole design
constraint: `STRUCTURAL_COLLATERAL` = 0.3 (`mission.ts:369`) — a near miss inside a `roe.flagged_zones`
rectangle costs a deduction only if the firing weapon's `collateral_risk` is ≥ 0.3; `HEAVY_COLLATERAL` = 0.5
(`mission.ts:366`) — a shot within 2 tiles of a civilian is "danger close" only at ≥ 0.5.

**Set A — three enablers (recommended).** A close-entry team, a ground eye, a screening carrier. Every weapon
in the set sits *below both thresholds*, so all three can fire inside a flagged zone and beside civilians and
cost nothing. None can penetrate armour (max 26 mm), so the set raises no lethality ceiling: what it buys is
information, suppression, and getting people out.

**Set B — three hunters (rejected).** An 8-tile `heat` wall-breaker for the Marj; a 20-tile guided mortar to
out-range the Sarim Grad (`rocket_battery` is range 20; KDF indirect tops out at `mortar_team`'s 18 at
accuracy 0.5); a fast gun car to catch a `technical` (2.6 tiles/s, `moto_rpg`
3.4, and the fastest thing the KDF can send is `jeep_shoded` at 2.9 with 14 mm of front). Each
closes a real gap, and all three must sit above 0.3 collateral by construction — a wall-breaker that does not
damage structures is not one. Set B makes the reward for restraint a better set of tools for abandoning it.
Rejected on that ground, not on balance.

**Killing my own favourite.** Drop the Shachaf and the arc survives — the Tzinah still says "empty it, do not
level it" and the Kipod "carry them out". The Sur slot is the weakest of the three and is where a hybrid
belongs (Set B's mortar is its only unit whose ROE story holds: precision indirect is *less* collateral than
the 0.7 mortar already shipped).

## 2. The gates, with the arithmetic

`data/missions/*.json` holds 27 missions, of which `beit_sahwan_0_tutorial` produces no result — **26
gradable, 78 stars ceiling**. Campaign order from `data/campaign/world.json`: Marj = 1–11 (Beit Sahwan 5, Khan
Rafid 3, Deir Amun 3), Sur = 12–21 (Tel Marum 3, Qarn Hadid 3, Umm Zeitoun 4), Naharin = 22–26 (Wadi Halam 5).
`pnpm playtest`, run this session: **26 winning plans, 25 at two stars and `qarn_hadid_1_recon` at three** —
53 of 78 cumulative. (`beit_sahwan_3_clearance` reports 2; its `picture` flag was pulled on 2026-09-11.)

| gate | ★★ reaches it (2/mission) | ★★★ reaches it (3/mission) | shipped optimal ladder | ★★★ lead |
|---|---|---|---|---|
| **12** Tzinah | mission 6, `khan_rafid_1_recon` | mission 4, `beit_sahwan_3_clearance` | mission 6 (12) | 2 missions |
| **30** Shachaf | mission 15, `qarn_hadid_1_recon` | mission 10, `deir_amun_2_foothold` | mission 15 (31) | 5 missions |
| **44** Kipod | mission 22, `wadi_halam_1_fords` | mission 15, `qarn_hadid_1_recon` | mission 22 (45) | 7 missions |

Each ★★ opening leaves missions in its own act to spend it in: 5 Marj after 12, 6 Sur after 30, 4 Naharin
after 44. The ★★★ lead widens 2 → 5 → 7, the right shape for a reward. All three open at the exact mission the
*shipped optimal ladder* reaches them, so `pnpm playtest` can assert the gate opens with no re-tuning. **The
spec's provisional 55 is unreachable and must not ship:** a pure ★★ ceiling is 2 × 26 = 52, and a pure ★
ceiling is 26, so 30 and 44 are closed to a careless winner — intended, and the lead's to confirm (§9.1). A
1.7-star average reaches 44 only at mission 26, so the Kipod is for ★★-consistent play.

## 3. Unit I — Marj · `breach_team` "Tzinah Breach Team" · `stars_min: 12`

**The gap.** `support` is empty in the KDF (shipped roles: apc ×2, ifv, mbt, engineer ×3, infantry, at_team,
sniper, artillery, drone ×2, gunship). Functionally, nothing the KDF fields can *empty* a garrisoned building:
`demo_squad` brings it down (charges at 0.6, ROE 50), `mortar_team` shells it (0.7), and `ifv_namer`'s
`cannon_30` at 0.35 arms the zone penalty — it cost Beit Sahwan III 55 of 61 Conduct points once already.
Ashwar doctrine is militia *inside* the houses, a flagged clinic block and `fail_below` 40–55. Entry guns at
**0.08** are below every sustained-fire weapon shipped (`rifles` 0.1, `carbines` 0.1, `coax_mg` 0.2);
suppression 110 at 150 rpm; 26 mm of penetration, enough for infantry and light-vehicle crews and nothing
else. Thermal, optics 1.3 and `firing_signature_mult` 2.5 (lowest of any KDF foot unit) also make it the
counter-ambush unit, which is Act I's question. *Tzinah* — a body shield: shields, short guns, a pole charge
they never have to use.

```json
{ "id": "breach_team", "name": "Tzinah Breach Team",
  "blurb": "Empties a garrisoned house instead of levelling it. No sustained fire costs Conduct less.",
  "faction": "kdf", "role": "support",
  "cost": { "logistics": 306, "build_time_s": 20, "population": 1 },
  "unlock": { "stars_min": 12 },
  "hull": { "hp": 440, "armor": { "front": 10, "side": 10, "rear": 10 },
            "crew": 6, "suppression_resistance": 0.7 },
  "mobility": { "speed_tiles_s": 0.95 },
  "sensors": { "optics": 1.3, "sight_tiles": 10, "thermal": true,
               "signature": 0.5, "firing_signature_mult": 2.5 },
  "abilities": ["garrison", "smoke", "mark_target"],
  "weapons": [{ "id": "entry_guns", "type": "small_arms", "range_tiles": 5,
    "effective_range_tiles": 4.5, "accuracy": 0.72, "penetration": 26, "damage": 30,
    "suppression": 110, "rof_per_min": 150, "can_target": ["ground"], "collateral_risk": 0.08 }] }
```

**Priced against `inf_squad` (292) and `demo_squad` (300)** — better than a rifle squad on all three axes (hp
440 vs 400; `suppression_resistance` 0.7, the highest of any foot unit, sniper is 0.6; thermal), and its cost
is reach: 5 tiles against 8, so it must stand next to the house. Measured **306, expected 303, +1.1%** (§6).

**Where it appears.** Buildable at every camp the moment the gate opens — 19 missions declare `resources` and
`buildBlockedReason` (`mission.ts:553`) gates production on `unlock` alone. Placed via `upgrades_to` where the
ROE margin is tightest: `khan_rafid_3_clearance` (Conduct 86 optimal) and `deir_amun_2_foothold` (70 against a
floor of 60 — the campaign's tightest ★★ margin, spec §4.1), each as `{ "unit": "inf_squad", "count": 1,
"upgrades_to": "breach_team" }`. **Both are new placements and so a force change `playtest` must re-measure**:
neither mission has a fresh (non-`from_ledger`) `inf_squad` to swap, so Act I has no zero-cost option.

## 4. Unit II — Sur · `scout_shachaf` "Shachaf Scout Car" · `stars_min: 30`

**The gap.** `recon` is empty roster-wide. The KDF's only long eye that moves is `recon_drone` (sight 16, hp
120, `domain: air`) and the enemy fields **nine `manpad_team` garrisons**; `sniper_team` also sees 16 but
moves at 0.45 and reveals itself at `firing_signature_mult` 6.0. Act II asks "can you reach?", and Sur's
doctrine is that `rocket_battery` is range 20 / sight 6 — it fires on what someone else sees, so the exchange
is eyes for eyes. The Shachaf is an eye a MANPAD cannot touch, survives a burst, and carries `mark_tunnel` as
well as `mark_target`, which matters because `intel.marked_positions` cannot pre-reveal a route and
identification is live, held only while a carrier keeps a sight line. *Shachaf* — a gull; animal register,
beside Lavi, Namer, Peten, Dov.

```json
{ "id": "scout_shachaf", "name": "Shachaf Scout Car",
  "blurb": "A ground eye that sees sixteen tiles and cannot be shot down. Carries a mast, not a gun.",
  "faction": "kdf", "role": "recon",
  "cost": { "logistics": 410, "build_time_s": 24, "population": 1 },
  "unlock": { "stars_min": 30 },
  "hull": { "hp": 900, "armor": { "front": 130, "side": 75, "rear": 50, "top": 25 },
            "crew": 3, "suppression_resistance": 0.7, "can_embark": false },
  "mobility": { "speed_tiles_s": 2.0, "turn_rate_deg_s": 140 },
  "sensors": { "optics": 1.9, "sight_tiles": 16, "thermal": true,
               "signature": 0.45, "firing_signature_mult": 1.6 },
  "abilities": ["mark_target", "mark_tunnel", "smoke"],
  "weapons": [{ "id": "cupola_mg", "type": "hmg", "range_tiles": 6,
    "effective_range_tiles": 5, "accuracy": 0.6, "penetration": 18, "damage": 26,
    "suppression": 55, "rof_per_min": 200, "can_target": ["ground","air"], "collateral_risk": 0.12 }] }
```

**Priced against `heli_peten` (402) and `apc_eitan` (520).** Sight 16 equals the roster maximum and does not
exceed it; optics 1.9 sits under `recon_drone`'s 2.0; 130 mm of front is a fifth of `mbt_lavi`'s 700;
penetration 18 cannot reliably touch a `technical` (15 mm) and nothing heavier at all, so it is not a gun
line. Measured **410, expected 404, +1.5%.** It is wheeled, so Tel Marum's boulder corridor stays closed to it
and the drone still flies that flank: the Shachaf buys standoff, not a new route.

**Where it appears.** Buildable at the camps in `qarn_hadid_2_foothold` (500 / 130 per min) and
`umm_zeitoun_2_buildup` (500 / 150). Placed as `{ "unit": "jeep_shoded", "count": 1, "upgrades_to":
"scout_shachaf" }` in `qarn_hadid_3_clearance` and `umm_zeitoun_3_clearance` — new placements, re-measure.
Deliberately **not** an upgrade of the `recon_drone ×1` every Act II mission fields: swapping an air unit for
a wheeled one is a downgrade on terrain, and the rule is no downgrades.

## 5. Unit III — Naharin · `apc_kipod` "Kipod Screen Carrier" · `stars_min: 44`

**The gap.** Functionally new though `apc` is filled: nothing the KDF fields is *protected capacity*. Seats
total nine (`jeep_shoded` 2, `apc_eitan` 2, `ifv_namer` 5) and the two that carry meaningfully are the two
needed forward as guns. Act III asks "can you stop?", and four of Wadi Halam's five missions hang a
**failable** `evacuate_before` primary on getting people out under `technical`, `moto_rpg` and `rpg_team`
fire. Six seats behind reactive plate, `smoke`, and a gun that suppresses at 70 a round and **cannot kill a
truck** — 16 mm against a `technical`'s 15 mm front and nothing above it. It is also the first unit in the
game to declare `hull.era`, a live mechanic (`sim.ts:3735`, `ERA_SHAPED_MULT` 1.5 vs shaped charges) that no
shipped unit uses: the right counter to an RPG-heavy corridor, and why the Kipod survives the road the D9 must
be walked down. *Kipod* — a hedgehog; carries its protection, curls up rather than fights.

```json
{ "id": "apc_kipod", "name": "Kipod Screen Carrier",
  "blurb": "Six seats behind reactive plate, and a gun that pins people without killing a truck.",
  "faction": "kdf", "role": "apc",
  "cost": { "logistics": 562, "build_time_s": 30, "population": 2 },
  "unlock": { "stars_min": 44 },
  "hull": { "hp": 1750, "armor": { "front": 260, "side": 160, "rear": 100, "top": 45 },
            "era": true, "crew": 2, "transport_slots": 6, "suppression_resistance": 0.75 },
  "mobility": { "speed_tiles_s": 1.7, "turn_rate_deg_s": 95 },
  "sensors": { "optics": 1.0, "sight_tiles": 10, "signature": 0.85, "firing_signature_mult": 2.0 },
  "abilities": ["smoke", "mark_target"],
  "weapons": [{ "id": "remote_mg", "type": "hmg", "range_tiles": 7,
    "effective_range_tiles": 5.6, "accuracy": 0.62, "penetration": 16, "damage": 24,
    "suppression": 70, "rof_per_min": 260, "can_target": ["ground","air"], "collateral_risk": 0.1 }] }
```

**Priced against `apc_eitan` (520) and `ifv_namer` (630)**, sitting between them on every axis: hp 1750 (1600
/ 2200), front 260 (220 / 420), seats 6 (2 / 5). ERA takes effective front armour against shaped charges to
390 — under `mbt_lavi`'s 700, the maximum the brief forbids exceeding. Measured **562, expected 571, −1.5%.**

**Where it appears.** The only one needing **no new placement at all**: `wadi_halam_4_village` and
`wadi_halam_5_depot` each already field a fresh `jeep_shoded ×1`, and each gets `"upgrades_to": "apc_kipod"`
on that existing entry. Both are about not levelling the village and not bleeding out on the depot hold, where
six seats and reactive plate dominate the jeep's 2.9 speed. Deliberately **not** in
`wadi_halam_3_counterraid`, whose briefing calls catching Hallaq "a mobility problem, not a firepower one" —
there the jeep's speed is the point and the swap is a downgrade. Buildable at both camps (400 / 80), where 562
logistics is about two minutes of income: a real choice against a second `demo_squad`.

## 6. Balance evidence

`python3 tools/validate_balance.py --units <roster+3> --report`, on a scratch copy of `data/units`:

```
fitted curve: cost = 282.317 * power^0.465  (n=32)
apc_kipod      power 4.6  cost 562  expected 571  -1.5%
scout_shachaf  power 2.2  cost 410  expected 404  +1.5%
breach_team    power 1.2  cost 306  expected 303  +1.1%
balance gate passed: 32 units within +/-18%
```

The curve refits from the whole roster every run, so adding three moves it: `272.861 * power^0.464` (n=29) →
`282.317 * power^0.465` (n=32), and **every existing unit stayed inside the band** — the tightest,
`attack_drone`, went +16.9% → +16.7%. That unit is the standing risk; a fourth addition must be re-checked,
not assumed. **Roster maxima, none exceeded** (`jq` over `data/units/kdf` + `enemy`): armour front 700
(`mbt_lavi`) vs 260; penetration 1300 (`gun_120`) vs 26; `rof_per_min` 800 (`zu23_twin`), 625 KDF
(`chain_gun_30`) vs 260; APS — only `mbt_lavi` declares one, none of the three does. `pnpm balance` cannot
move: `tools/src/backtest/targets.ts` names six ids (`at_team`, `gun_truck`, `heli_peten`, `inf_squad`,
`mbt_lavi`, `militia_cell`) and never enumerates the roster. **Schema:** all three validate against the
shipped `unit.schema.json` as written (same `ajv/dist/2020.js` `validate_data.mjs` uses: PASS ×3), while
adding `"unlock": { "stars_min": 12 }` is **REJECTED — must NOT have additional properties**, so the schema
edit is a measured prerequisite. `cost.population` is read by nothing in the sim; declared for consistency.

## 7. Asset manifest

| row | state | path / gate and pipeline |
|---|---|---|
| unit JSON ×3 | MISSING | `data/units/kdf/{breach_team,scout_shachaf,apc_kipod}.json` · `pnpm validate:data` (after the schema edit), `tools/validate_balance.py` |
| `breach_team` mesh | MISSING | `art/meshes/breach_team.glb` · builder in `tools/units/teams.py` `TEAMS`, figures in `tools/units/rig.py` `TEAM_FIGURES` **and** `SUPPORTED_TEAMS` (`_check_team_figures_against_teams` asserts they match), then `tools/export_mesh_team.py -- breach_team`. Gate `pnpm validate:meshes`. **Named risk:** silhouette IoU ≤ 0.88 against 46 meshes and 36 sprites, nearest neighbours `demo_squad.glb` and `yahalom_squad.glb`. The shield and pole charge must separate it, not the texture |
| `breach_team` sheet | MISSING | `assets/sprites/INF_BREACH/` · `tools/render_team.py` · `pnpm validate:assets`. Pixi and `&nomesh` only |
| `scout_shachaf` mesh | MISSING | `art/meshes/vehicles/scout_shachaf.glb` · `tools/export_mesh_vehicle.py` (whose only shipped output is `apc_eitan.glb`) or a supplied Meshy `.blend` exported as the textured buildings are. Gate `pnpm validate:meshes` |
| — supplied source | PRESENT, **not usable as-is** | `/Users/ilpinto/dev/roaring-lions/art/blend/KDF/Shodeed jeep/Meshy_AI_military_utility_vehi_0907064115_image-to-3d-texture.blend`, censused this session. Reusing it collides with `jeep_shoded.glb` on IoU — a starting point for a distinct hull with a mast, not a drop-in. No scout-car or carrier `.blend` exists anywhere in `art/blend/` |
| `apc_kipod` mesh | MISSING | `art/meshes/vehicles/apc_kipod.glb` · same pipeline. Reactive plate must read in a 64 px black silhouette or it is invisible doctrine |
| both vehicles' wreck | MISSING, **no gate exists** | Mesh vehicles declare zero animations; `updateVehicleMeshes` prunes the clone at `alive == 0` and `addWreck` falls back to a billboard `UnitWreck`. With no sheet, a destroyed Shachaf or Kipod leaves **only the grey cross** — shipped `mbt_lavi` behaviour. Ship the sheet or ship wreck geometry; `blender-art` + `render-vfx` |
| `SPRITE_MAP` ×3 | MISSING | `packages/app/src/main.ts:999`. Art existing is not art drawing — three complete sheets once shipped and drew nothing |
| mesh-catalogue ×3 | MISSING | `packages/app/src/mesh-catalogue.ts` `RIGGED_UNIT_MESHES` (Tzinah) / `VEHICLE_UNIT_MESHES` (Shachaf, Kipod); pinned by `mesh-catalogue.test.ts` |
| unit names | MISSING | `data/campaign/names.json` `kinds.vehicle_roles` is `[apc, ifv, mbt]`, so `scout_shachaf` (role `recon`) would be named as a **squad**. Add `recon`. `apc_kipod` is covered; `breach_team` correctly falls through to `squads` |
| audio, portraits | MISSING, out of scope | No unit in the tree has a bark or a portrait (GH-110); the dock's portrait frame degrades to `null` by design |

## 8. Engine and schema gaps, with owners

| # | gap | smallest proposal | owner |
|---|---|---|---|
| G1 | `unlock.stars_min` does not exist: `unlock` is `additionalProperties: false` and `UnlockGate` (`packages/sim/src/unlock.ts:6`) has two fields | Add `stars_min` (integer ≥ 0) to the schema and `UnlockGate`; `unlockReason` sums `stars` over `campaign.mission_results`, integer addition only | `sim-guard` |
| G2 | `upgrades_to` does not exist, and **`spawnPlacement` never consults `unlock`** (a known hole — Wadi Halam V hands out a ROE-60 D9 unconditionally). Resolving it in the sim would hand every star unit out free | Resolve it in the app, where `unlockReason` is already called with the ledger (`packages/app/src/campaign.ts:502`), and hand the resolved id to the mission. Reject `upgrades_to` on a `from_ledger: true` placement — a survivor's veterancy cannot survive a type swap | `sim-guard` |
| G3 | `lockLabel` (`packages/app/src/ui/dock-model.ts:89`) parses only the Conduct sentence, so a star gate reads as the bare word `locked` in the dock | A second regex and a `★12` label | `render-vfx` |
| G4 | The brigade screen (spec §4.6) does not exist, so a locked unit has nowhere to say what opens it | Step 3's own work; these three are its first content | `render-vfx` |
| G5 | Eight of sixteen schema `abilities` are read by nothing (`hidden_setup`, `breach`, `defuse`, `deploy`, `call_strike`, `repair`, `resupply`, `tunnel_travel`), and `mobility.reshapes_terrain`, weapon `magazine`/`reload_s` and `can_target: "subterranean"` are inert. **No unit here leans on any of them** — this row exists so nobody proposes a `repair` support unit | recorded | — |
| G6 | A dedicated AA unit was considered and rejected on measurement: enemy air is 4 garrison placements and 4 wave entries across 27 missions (`paramotor` 2+2, `loiter_drone` 2+2). Near-dead content | recorded | — |
| G7 | `pnpm playtest` asserts `result` and `stars` only, and four of the six `upgrades_to` sites are **new placements**, i.e. force changes | A plan per affected mission plus a gate-opens assertion at missions 6, 15 and 22, which the shipped totals already satisfy (12, 31, 45) | `playtest` |

## 9. Open decisions for the lead

1. **A careless winner gets one of three.** A pure ★ player tops out at 26 stars, so the Shachaf
   (30) and the Kipod (44) are permanently closed to them. That is the design — Conduct is the
   second score — but two of three rewards are then invisible to a whole play style. Confirm, or
   ask for a mixed rule; lowering the gates does not fix it (★ reaches 26 only at mission 26).
2. **Set A whole, or the hybrid?** Replacing the Shachaf with Set B's guided mortar gives Act II a
   counter-battery answer at 0.3 collateral — *on* the threshold, not below it. Recommendation:
   **Set A whole**; revisit the mortar as ordinary content.
3. **Names owe a rule-3 screen.** *Tzinah*, *Shachaf*, *Kipod* are single common nouns in the
   materiel register and none is a real platform name to my knowledge, but storyline §2.4 rule 3
   requires a search before each is written into JSON — `narrative-designer` owns it. While there:
   `heli_peten`'s shipped `name` is **"AH-64 Peten"**, a real platform designation inside the
   fiction, and the supplied blend directory is named for it too.
4. **Three units cost three meshes and two have no wreck path.** A star-gated unit that ships
   without a mesh is not shippable (§4.6). If art capacity is one vehicle, ship the Tzinah and the
   Kipod and hold the Shachaf.
