# WP-A3.1 remaining work — audit and Meshy estimate (GH-179)

**Status: audit for the lead, 2026-10-05. Read-only. No Meshy call was made;
every credit figure comes from the CLI's own estimator, `estimateCredits` in
`tools/src/meshy/pricing.ts`. That function is pure (no network, no I/O), and it
was called directly: preview 20, refine 8k 15, refine 2k 10, remesh 5,
rigging 5. Tree: `origin/main` at `81a6e999`.**

## 0. Summary

- **Every unit type has a Meshy-based GLB.** That covers 34 types in
  `data/units/kdf` and `data/units/enemy`, plus `civilians`. No unit body is
  still a `kit.py`/Blender primitive. The last kit hulls were `apc_eitan` and
  `apc_kipod` (B0a) and the last kit teams were `breach_team` (B5) and
  `moto_rpg` (B6). B7 replaced the remaining supplied teams.
- **GH-179's open checklist is fully done** (see §3), so the issue can be
  closed against its own contents.
- **What remains is kit-built PARTS on Meshy bodies, plus the four untextured
  parts the bible's classes chose before the lead's max-detail rule
  (2 Oct).** The parts are the hand weapons, launchers, the ATGM post, the
  enemy mortar and the KDF remote weapon station. The four untextured parts
  are the three drones and the `moto_rpg` bike.
- **Estimate: 440 credits planned for the A3.1 items, 480 with the optional
  RWS.** The ceiling, with one 20-credit re-roll per item, is **720**.
  Against the ~3,045 balance this leaves **2,565** at plan or **2,325** at
  the ceiling. The planned spend is 16% of the balance.

## 1. Every unit type

Sources:
- "Meshy (supplied)" means the lead's own Meshy exports (`docs/ASSET_PROVENANCE.md`,
  "The supplied Meshy assets").
- "Meshy (CLI)" means `pnpm meshy` text-to-3D, logged in `art/meshy/ledger.jsonl`.
- "Textured" means the unit is in `TEXTURED_INFANTRY_TYPES` or `TEXTURED_VEHICLE_TYPES`.
- "Kit parts" lists `kit.py` primitives that are still in the shipped GLB.

Mission counts are files in `data/missions/` (27) that name the type. The
figure in brackets is the number of placement references.

| unit | side | shipped GLB | current source | textured | A3.1 status | kit parts still in the GLB | what's left |
|---|---|---|---|---|---|---|---|
| `inf_squad` | KDF | `inf_squad.glb` 8,664 tris | Meshy (CLI) B7 figure, rig.py | yes (2k) | done (B7, #334–337) | none (baked carbine) | — |
| `at_team` | KDF | `at_team.glb` | Meshy (CLI) B0b figure | yes (2k) | done (#313) | `kit.launcher` Spike tube | Spike launcher part |
| `demo_squad` | KDF | `demo_squad.glb` | Meshy (CLI) B0b | yes (2k) | done (#313) | `kit.demo_charge`, `kit.cable_spool` | — (small props, low value) |
| `mortar_team` | KDF | `mortar_team.glb` 10,743 | Meshy (CLI) B7 crew + B8 Meshy mortar (8k) | yes | done (B7, B8 #339) | No.3's kit rifle | KDF rifle part (shared) |
| `sniper_team` | KDF | `sniper_team.glb` 8,012 | Meshy (CLI) B7 + B8 Meshy rifle and scope (8k) | yes | done (B7, B8) | none | — |
| `yahalom_squad` | KDF | `yahalom_squad.glb` 12,410 | Meshy (CLI) B7, rig.py `work` | yes (2k) | done (B7) | kit packs, mast, yah_b's rifle | KDF rifle part (shared) |
| `breach_team` | KDF | `breach_team.glb` | Meshy (CLI) B5 | yes (2k) | done (#324) | cover pole | — |
| `recon_zikit` | KDF | `recon_zikit.glb` 7,997 | Meshy (CLI) E5 | yes (2k) | out of scope (E5 #181) | kit rifle, whip, tripod scope | — (E5's) |
| `recon_drone` | KDF | `vehicles/recon_drone.glb` 881 | Meshy (CLI) B0a v2, preview + remesh only | **no** (palette) | done as planned (B0a) | 4 rotor-guard rings | **textured re-make (max detail)** |
| `attack_drone` | KDF | `vehicles/attack_drone.glb` 706 | Meshy (CLI) B0a, preview + remesh | **no** | done as planned (#310) | — | **textured re-make** |
| `apc_eitan` | KDF | `vehicles/apc_eitan.glb` 7,961 | Meshy (CLI) B0a, refine 2k | yes | done (B0a) | `kit.rws` | RWS part (optional, shared) |
| `apc_kipod` | KDF | `vehicles/apc_kipod.glb` 8,052 | Meshy (CLI) B0a ruling, refine 2k | yes | done (B0a ruling) | `kit.rws` | RWS part (shared) |
| `ifv_namer` | KDF | `vehicles/ifv_namer.glb` 7,810 | Meshy (CLI) B8 v2, refine 8k | yes | done (B8 v2, `1175fdef`) | `kit.rws` (22 tris) | RWS part (shared) |
| `mbt_lavi` | KDF | `vehicles/mbt_lavi.glb` | Meshy (supplied) | yes | outside A3.1 | — | — |
| `jeep_shoded` | KDF | `vehicles/jeep_shoded.glb` | Meshy (supplied) | yes | outside A3.1 | — | — |
| `dozer_d9` | KDF | `vehicles/dozer_d9.glb` 7,901 | Meshy (CLI) A3.2 ramp set | yes | outside A3.1 (A3.2) | — | — |
| `scout_shachaf` | KDF | `vehicles/scout_shachaf.glb` 5,076 | Meshy (CLI) A3.2 ramp set | yes | outside A3.1 (A3.2) | `kit.rws` | RWS part (shared) |
| `heli_peten` | KDF | `vehicles/heli_peten.glb` | Meshy (supplied) | yes | outside A3.1 | — | — |
| `heli_peten_gunship` | KDF | `vehicles/heli_peten_gunship.glb` 41,771 | supplied Peten plus Blender stores | yes | outside A3.1 (E5) | — | — |
| `militia_cell` | Ashwar | `militia_cell.glb` | Meshy (CLI) B3; the Sarim body | yes (2k) | done (#315) | 2 kit rifles | **Sarim rifle part** |
| `rpg_team` | Ashwar | `rpg_team.glb` | Meshy (CLI) B3 | yes (2k) | done (#315, arms #358) | kit RPG tube, loader's kit rifle | **RPG part** and Sarim rifle |
| `charge_squad` | Ashwar | `charge_squad.glb` | Meshy (CLI) B4 | yes (2k) | done (#321) | — | — |
| `digger_crew` | Ashwar | `digger_crew.glb` | Meshy (CLI) B4 | yes (2k) | done (#321) | kit tool handle | — (low value) |
| `mortar_crew` | Ashwar | `mortar_crew.glb` | Meshy (CLI) B4 | yes (2k) | done (#321) | `rig._mortar_crew_extras` kit tube | mortar: reuse the B8 Meshy mortar (0 credits) |
| `paramotor` | Ashwar | `vehicles/paramotor.glb` | Meshy (supplied) | yes | outside A3.1 | — | — |
| `sarim_rifles` | Sarim | `sarim_rifles.glb` 12,898 | the B3 Sarim body (ruling 2 Oct) | yes (2k) | done (B7) | 3 kit rifles | **Sarim rifle part** |
| `atgm_cell` | Sarim | `atgm_cell.glb` | Meshy (CLI) B3 | yes (2k) | done (#315) | `rig._atgm_extras` kit tripod post | **ATGM post part** |
| `manpad_team` | Sarim | `manpad_team.glb` 11,440 | the B3 Sarim body (ruling 2 Oct) | yes | done (B7; arms #358) | kit MANPAD tube, kit binoculars | MANPAD part |
| `recoilless_team` | Sarim | `recoilless_team.glb` 12,432 | Meshy (CLI) B2 figure, refine B7 | yes (2k) | done (B7) | kit recoilless tube, 2 kit rounds | recoilless part |
| `loiter_drone` | Sarim | `vehicles/loiter_drone.glb` 630 | Meshy (CLI) B2, preview + remesh | **no** | done as planned (#312) | — | **textured re-make** |
| `rocket_battery` | Sarim | `vehicles/rocket_battery.glb` | Meshy (supplied) | yes | outside A3.1 | — | — |
| `gun_truck` | Rif | `vehicles/gun_truck.glb` 4,857 | Meshy (CLI) B2, refine 2k | yes | done (#312) | — | — |
| `moto_rpg` | Rif | `moto_rpg.glb` | Meshy (CLI) B6; the bike is preview + remesh, riders from B3 | riders only; the bike has no UV | done as planned (#324) | `kit.tube` wheels, kit RPG | **textured bike**, plus the RPG part |
| `technical` | Rif | `vehicles/technical.glb` | Meshy (supplied) | yes | outside A3.1 | — | — |
| `civilians` | civilian | `civilians/*.glb` (4) | Meshy (supplied), bake kept B7 (0 credits) | yes | done (B7) | — | — |

Held art that is not yet a unit type (`officer_*`, `demo_tzav`) belongs to
GH-298 and E6, not A3.1.

## 2. Remaining work, ranked (most visible in play first)

Visibility is judged on three things: how many missions field the type, how
many of it stand on a map, and whether the player commands it or looks at it.
A shared part is ranked by the units that carry it.

Every item follows the lead's two standing rules:
- every model at **maximum detail**: a detailed prompt naming the gear, the
  refine at `--tex 8k`, and simplification only down to a measured budget;
- every prompt written by a **Fable 5.1 agent at high effort**.

Each item uses the B8 flow: a preview first, judged before anything else is
spent, then `refine <preview-id> --tex 8k`, then a remesh at the class target.
Under that flow a bad preview costs 20 credits, not 40. All prices come from
`estimateCredits`: preview 20 + refine 8k 15 + remesh 5 = **40** per item.

| # | item | carried by (missions / refs) | why at this rank | steps | credits |
|---|---|---|---|---|---|
| 1 | **Sarim rifle part** (AK-pattern), shared | `militia_cell` 15/81, `sarim_rifles` 10/62, `rpg_team` loader 14/43 | The most numerous figures on enemy maps all hold a kit tube rifle | preview + refine 8k + remesh 400 | 40 |
| 2 | **`recon_drone` textured re-make** | 20 missions; player-commanded; usually opens the mission | The only untextured palette body on a unit the player steers | preview + refine 8k + remesh 800 | 40 |
| 3 | **Spike launcher part** | `at_team` 25/26 | The third most-fielded KDF team; the kit tube is its tell | preview + refine 8k + remesh 400 | 40 |
| 4 | **RPG launcher part**, shared | `rpg_team` 14/43, `moto_rpg` 9/20 | Two enemy types, many on screen | preview + refine 8k + remesh 400 | 40 (0 if the Ashwar RPG-7 source of `export_meshy_rpg.py` is still on disk) |
| 5 | **KDF RWS part** (optional; on vehicles, not an A3.1 line) | `apc_eitan` 26, `ifv_namer` 17, `scout_shachaf`, `apc_kipod`, `demo_tzav` | A kit box on the KDF's most-fielded hull | preview + refine 8k + remesh 400 | 40 |
| 6 | **ATGM tripod post part** | `atgm_cell` 14/19 | A kit post from `rig._atgm_extras` | preview + refine 8k + remesh 400 | 40 |
| 7 | **`moto_rpg` textured bike** | 9/20 | A palette bike with kit cylinder wheels under textured riders | preview + refine 8k + remesh 1,500 | 40 |
| 8 | **Recoilless rifle part** | `recoilless_team` 9/18 | Kit tube and rounds | preview + refine 8k + remesh 400 | 40 |
| 9 | KDF rifle part, shared | `mortar_team` No.3 15, `yahalom_squad` 5, `breach_team` 2 | One man per team; `inf_squad` already has a baked carbine | preview + refine 8k + remesh 400 | 40 |
| 10 | MANPAD tube part | `manpad_team` 8/9 | One tube | preview + refine 8k + remesh 400 | 40 |
| 11 | `loiter_drone` textured re-make | 4 missions | Small and airborne, enemy | preview + refine 8k + remesh 800 | 40 |
| 12 | `attack_drone` textured re-make | 0 missions; a garage unlock (price 320) | Seen only when it is bought | preview + refine 8k + remesh 800 | 40 |
| 13 | `mortar_crew` mortar | 8 | Reuse the B8 Meshy mortar part through the same atlas path | Blender only | 0 |

Zero-credit work, in Blender or bookkeeping:
- Bring the B7 teams back toward the bible's 8,000-tri team cap, or record
  the exception. Every B7 team is over the cap: 8,664 to 12,898.
- Close GH-179's checklist (§3).

**Not recommended:** re-refining the 2k teams at 8k. That would cover the 14
distinct figures B0b–B7 refined at 2k (B0b 2, B3 3, B4 3, B5 1, B7 5), at
refine 15 + remesh 5 = 20 each, **280 credits**. Every
figure's bake ships at 1024 in a shared atlas (bible §15), so 8k buys a
sharper source that is then downsampled away. If the lead wants the max-detail
rule applied retroactively, do it per team after a side-by-side capture, not
as a batch.

**A possible saving, untested:** a refine on a preview that already exists
(`pnpm meshy -- refine <preview-id>`) worked on a one-day-old preview in B7.
The drone previews date from 30 Sep. If Meshy still holds them, items 2, 11
and 12 cost refine 15 + remesh 5 = **20** each instead of 40, saving 60
credits. That would mean keeping their current shapes, which the lead already
judged. Try `refine` first on each; whether a refused one is charged is not
measured.

## 3. Credit total against the balance

| line | credits |
|---|---|
| items 1–4, 6–12 (A3.1 parts, drones, bike) | 11 × 40 = **440** |
| item 5, RWS (optional) | +40 → **480** |
| item 13, mortar reuse | 0 |
| one re-roll per item, preview only (20), lead's go each | +12 × 20 = 240 |
| **planned (with RWS)** | **480** (~$9.60 at $0.02/credit) |
| **ceiling** | **720** (~$14.40) |
| balance (lead's figure, after A3.2's relay and pump house, 3 Oct) | ~3,045 |
| left at plan / at ceiling | **2,565 / 2,325** |
| possible saving (drone refines on old previews, Ashwar RPG-7 reuse) | −60, −40 |

Batch shape (the bible's three per session):
- C1: items 1–3
- C2: items 4–6
- C3: items 7–9
- C4: items 10–12

Bless after C2 and after C4.

## 4. Already done that GH-179 still lists as open

The issue's last comment (the corrected audit) lists four open items. Every
one of them is on `origin/main`:

1. **`manpad_team` and `recoilless_team` textured bakes.** These landed in
   B7 (#334–337, 1 Oct), and both are in `TEXTURED_INFANTRY_TYPES`. Since the
   lead's ruling of 2 Oct, `manpad_team` uses the textured B3 Sarim body
   rather than its own refined figure.
2. **The infantry fall trim (G0 #13).** This is moot. B7 deleted every
   supplied `fall`/`fallAlt` clip, and rig.py figures topple in 0.5 s at
   runtime. `mesh_gait.test.ts` pins "no shipped rig carries fall or fallAlt".
   #358 recorded this ("fall trim already done by B7"). The `docs/HANDOVER.md`
   G0 #13 row still reads "trim in A3.1" and should say so.
3. **`inf_squad`, `mortar_team`, `sniper_team`, `yahalom_squad`,
   `sarim_rifles` textured.** All landed in B7. `mortar_team` and
   `sniper_team` also gained Meshy weapon parts in B8 (#339).
4. **`civilians` textured.** Landed in B7 at 0 credits, with the supplied
   bake kept.

Also stale in the issue body: "Waits on: G1 credit budget (balance 454 on
18 Sep ...)". G1 is answered and the October credits arrived. And the
"twelve kit-built infantry teams" are all replaced.
