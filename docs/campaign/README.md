# The campaign design pipeline

How a story becomes a mission here, and which agent owns each step. `docs/GDD.md`
§2 and §4 hold the setting and the phase spine; `docs/campaign/storyline.md` holds
the story itself. This file is the **contract** the four campaign agents write
against. When it disagrees with the code, the code wins and this file is what
needs fixing — the dated digest beside it (`research-YYYY-MM-DD.md`) records what
was true when it was written, and the census commands below are how you check.

## The pipeline

```
premise ──► campaign-designer ──► Mission Design Document      docs/campaign/<town>/design.md
                 │
                 ▼
            narrative-designer ──► Narrative Trigger Sheet     docs/campaign/<town>/narrative.md
                 │                 + name / briefing / briefing_video / objective text in the mission JSON
                 ▼
            level-scripter ──────► Level Script                docs/campaign/<town>/script.md
                 │                 ECA rows in schema shapes, AI cadence, twists, gap report
                 ▼
            mission-author ──────► data/missions/<id>.json     validated, world-walked
                 │
                 ▼
            playtest ────────────► plan ladder, time in band, stuck-vs-lost
```

The first three are **design** agents and produce documents. `mission-author`
alone writes `data/missions/`. `playtest` alone says whether it is a mission.
Engine gaps the documents surface go to `sim-guard` (mission runtime, schema),
`render-vfx` (HUD surfaces, overlays), `blender-art` (art), `content-validator`
(gates). The global storyline is `docs/campaign/storyline.md`; its character
bible is canon once the lead approves it, and `narrative-designer` keeps GDD §11
in step with it.

## What this game is, for anyone arriving from a Command & Conquer brief

- **A mission is 5–7 minutes and is led by ONE phase** of the GDD's six
  (`breach | recon | foothold | buildup | clearance | subterranean`). A town is
  3–5 missions in ascending phase order. The classic "Phase 1 beachhead → Phase 2
  resources → Phase 3 destroy command" structure is the **town arc** here, never
  one mission.
- **No base building, no harvester, no credits, no tech tree.** Two resources:
  Logistics (a per-minute rate, spent on production at a `camp` structure the
  author places) and Intel (earned by doing, with no per-minute term: 8 per enemy
  first identified by a real observer, 40 per objective completed, 30 per
  high-ground rise held 10 s; `resources.intel_start` is the only authored grant,
  and there is no `intel_rate_per_min`). Intel is fire-support currency only: a
  smoke screen 100, a mortar barrage 120, a drone sweep 150, an air strike 250
  (rates and prices ruled by the lead on 15 Oct: 8/40/30, smoke 100; GDD §3,
  `docs/campaign/economy/fire-support-numbers.md`). A drone or a still scout
  no longer earns by standing there: write a recon mission's intel as
  *identifications*, not minutes. 18 of 27 shipped missions declare a
  `resources` block. Unit availability is gated by campaign ROE rating, completed
  missions and earned stars, not by tiers.
- **Held-ground income is in the schema and in four missions** (F2, GH-183; the lead approved the
  table on 15 Oct: `docs/campaign/economy/income-numbers.md`). `resources.income_zones` is a list of `{ zone, rate_per_min }` (a zone of the
  mission's own map, an integer rate of at least 1, no zone twice); `resources.supply_entry` is
  a marker of the map, where the supply convoy enters. A zone pays its rate, on top of
  `logistics_rate_per_min`, to the side that holds it (a living surface ground unit of that
  side inside and none of the other side; contested and empty pay nobody) and **half while its
  own supply line is cut** (no wheeled route; an uncontested enemy within 2 tiles of the route;
  an open hostile vent within 3 tiles: GDD §3). The base rate halves only on a mission that
  says `supply_corridor: true` and names a `supply_entry`, and only while the line from that
  entry to the player's rear (the camp's exit, else `player_start`) is cut. `validate:data`
  (`tools/validate_income.mjs`) refuses, by mission id: a zone the map does not declare, the
  same zone twice, `supply_corridor: true` with no `supply_entry`, and an entry the map does
  not declare. `umm_zeitoun_2_buildup` and `umm_zeitoun_4_clearance` set `supply_corridor` and name
  `supply_entry` (UZ II at the west rim (3,31), UZ IV at (24,47)); the pending exemption that excused
  them is deleted. `tools/src/income_census.test.ts` holds every authored zone and convoy to a wheeled
  route at t=0 (`horn_west` on UZ III must not be authored as a zone without opening its boulders).
  **Choose an
  income zone for ground both sides want**: the plan crosses it and the enemy also marches
  on it. A zone that holds the starting force pays a passive player by construction, and
  `pnpm playtest` holds side 0's zone income in the four no-orders controls at 0
  (`ZONE_PASSIVE_INCOME`); pick rates by the 40%-of-the-phase-anchor rule in
  `docs/campaign/economy/income-numbers.md`, where the approved table for Umm Zeitoun II and
  IV, Deir Amun II and Wadi Halam II (and its measurement over 30 seeds) is the shipped one.
- **The player force is placed, not built.** `starting_force` plus ledger
  survivors (`from_ledger`), plus authored `reinforce` triggers and waves.
  The issued force is the brigade's to lend. A placement may field a unit whose
  gate is closed; it is on loan for that mission and returns afterwards (its mark
  on the unit card, selection chip and Field order card lands with WP-S-F #184;
  a loaned survivor never joins `roster.surviving_units`; a gated unit that arrives by a `reinforce` trigger is on loan too (GH-801, the lead, 25 Oct 2026) -- today only `wadi_halam_5_depot`'s second `demo_squad`). Gates govern what you
  build and what you upgrade to. Restraint shapes the issued force through
  `upgrades_to` and `gate_only` (lead, G3 Q5, 4 Oct). There is **no population
  cap in the campaign**: `resources.pop_cap` exists for skirmish and co-op
  (through the doctrine, never equal across doctrines: G3 Q4/Q7), and
  `validate:data` refuses it on any mission that declares a town, which is every
  campaign mission. Do not author one.
  Credits (the brigade account) are not a ledger key: a mission never reads or
  produces them, and nothing in mission JSON can reference the balance. Credits
  also buy a unit's upgrade tiers, which the sim sees only as a patched type,
  never as a tier a mission could gate on.
- **Production is a line per camp, and the enemy can buy (F4, GH-183).** `structures[].side` (`0 | 1`) overrides a structure type's `produces_for`, so a `camp` placed with `side: 1` is the enemy's; at most 4 production structures a side (`validate:data`). `enemy.production` is `{ menu, logistics_start, logistics_rate_per_min, rally, group }`: `menu` is Sarim/enemy unit ids, `logistics_start` is capped at 894784, `rally` a marker, and **`group`** is the name given to every unit it buys so a trigger can `commit` it. It needs a side-1 camp; the enemy spends down (buys the next affordable menu item whenever its line is idle, never banking). **D7: no campaign mission authors an enemy camp in Stage 4, and `validate:data` refuses `enemy.production` on any shipped mission while D7 stands**: the shipped `unitInfo` (app, playtest, harness) answers KDF only, so side 1 cannot build until N3's loader or an enemy-roster lookup (R-F4-5); `buildEnemyMenu` would throw at `start()`. The mechanism is proved on fixtures and a report-only probe (Tel Marum III with a camp at (27,7): 2 units bought, plan 29/30 against 30/30 without). Numbers and the D-list: `docs/campaign/economy/production-numbers.md`.
- **The enemy is stances, one-shot triggers and waves.** One stance per placement
  (`hold_position | ambush(tiles) | patrol | garrison`), four trigger conditions ×
  five actions, waves on a clock or on an objective completing. That is the whole
  AI. Design inside it and name what falls outside as a gap.
- **Nine live objective types.** `locate eliminate_hvt capture hold_for
  survive_until destroy_all raze collapse evacuate_before`. Three more are in the
  schema and the runtime throws on them (`mark escort no_collateral_above`).
- **ROE is the second score, and the player calls it Conduct.** 0–100, `flagged_zones` from map zones, `fail_below`
  loses the mission. Since 2026-09-10 the HUD, the deduction notice, the lock label,
  the end screen and the board all print **Conduct**, never the acronym, and authored
  lines should say Conduct too; `ROE` stays the design and ledger term. Restraint must
  be the mechanically superior play. A villain's
  job is to make the player want to break it.
- **The third star is the carrying secondaries.** `carries: true` marks a secondary a later
  mission reads (spec 2026-09-10 §4.1); the Ari'im citation needs every one complete, and a
  mission with none caps at two stars. As of 2026-09-11 only **six** missions can reach three
  stars — Beit Sahwan I, Deir Amun I, Khan Rafid I, Qarn Hadid I, Umm Zeitoun I and Umm
  Zeitoun III — and every other mission in the campaign caps at two. No foothold, build-up,
  subterranean or breach mission carries anything. Tel Marum I and Wadi Halam I are recon
  missions and still cap: both make every `locate` a PRIMARY, which leaves a bare
  `survive_until` screen as their only secondary, and a clock the passive control also
  completes is exactly what must never be flagged. Giving a mission a third star means
  authoring a secondary something later actually reads, never flagging a clock — and the
  something later has to survive `pnpm playtest`: Beit Sahwan III's `picture` lost its flag
  on 2026-09-11 because making III produce the `intel.marked_positions` it claimed to carry
  put Beit Sahwan IV's whole roster in the ground. `pnpm playtest` prints each plan's stars
  and asserts the authored expectation.
- **Everything is fictional and defined by doctrine.** Kedem, the KDF 401st
  "Ari'im" Brigade, the Sahar Basin. Ashwar Front (tunnels, ambush), Sarim
  Brigades (rockets, ATGMs, standoff), Rif Cells (technicals, raids, smuggling).
  Never a people, a faith, a real place, or a real insignia.

## The narrative surface contract

Every line a designer writes names its **channel**, and every channel has a
status. A line written for an unbuilt channel is fine — the lead has approved
EVA announcements, voice audio and a radio overlay as targets — but its status
must say so, because otherwise a sheet full of lines nobody can hear reads as
finished.

| channel | what the player sees or hears | speaker | when | status | where |
|---|---|---|---|---|---|
| `brief` | deploy-screen beats, then the in-mission commander bar (◂/▸ paging); optionally under named sections (`briefing_sections`: `situation`, `mission`, `execution`, `notes`, in that order, texts joined must spell `briefing`) with a section `image` and a mission `briefing_image` (one path or a pool) from `assets/ui/portraits/` or `assets/ui/plates/` | Shai / Idit | start | **live**, one hard-coded speaker; sections and image live since 2026-10-04 (GH-119), exemplars `beit_sahwan_1_recon` and the tutorial | `ui/loading.ts` `briefingBeats`, `ui/briefing-sections.ts`, `ui/hud.ts` `COMMANDER`, `renderCommander`, `tools/validate_briefing.mjs` |
| `video` | deploy-screen cinematic above the beats: `briefing_video`, a short mp4/webm under `assets/video/` (no mission declares one since 2026-10-11, when the Tel Marum II and III cuts were removed at the lead's request; a file lives under `assets/video/` named `<mission>_briefing.mp4`); autoplays with sound after the mission click, falls back to muted autoplay with controls; never holds Deploy | the lead's cut | start | **live** since 2026-09-06 | `ui/loading.ts`, `mission.schema.json` `briefing_video`, `validate_data.mjs` (file must exist, and since 2026-10-11 carry a `data/video.json` provenance entry inside the size budget: `tools/validate_video.mjs`, `docs/cinematics/README.md`) |
| `toast` | notice feed, 4 lines, 9 s | system | on `MissionEvent` | **live**, strings hard-coded; only `objectives[].text` and the raw `trigger.id` are authored | `main.ts` `describeMissionEvent`, `hud.note` |
| `title` | title card | system | start | **live**: `name` + "N primary objective(s)" | `hud.announce` |
| `dispatch` | story line on the title card | narrator | start | **specced, unbuilt** (2026-08-21 storyline spec) | — |
| `aftermath` | story line on the victory banner | narrator | end | **specced, unbuilt** | — |
| `debrief` | end-screen text | Shai / Idit | end | **needed** — the end screen has zero authorable text | `ui/menu.ts` `showEndScreen` |
| `radio` | mid-mission transmission overlay: speaker, portrait, line | Shai / Idit / villain | on trigger, objective, wave, event | **approved target, unbuilt** — needs a `say` field on `triggers[].do` / objectives and an overlay | `sim/mission.ts` `stepTriggers`, `render-vfx` |
| `eva` | announcements: objective complete/failed, unit lost, reinforcements | the brigade net | on `MissionEvent` | **approved target, unbuilt** — GH-110; `audio.schema.json` needs a non-weapon set kind | `render/audio.ts` |
| `bark` | order acknowledgements and death calls, one line per gesture | units, keyed by voice class; KDF in Hebrew, the three doctrines in Arabic | on an order intent; on a death | **engine live, lines unrecorded** (WP-AU1): every key plays nothing until the asset plan lands (D5) | `app/src/voice/`, `render/audio.ts` `playVoice`, `data/audio.json` `voices` |
| `board` | campaign map text | — | between missions | **live**: region `faction · doctrine`, town done/total; `world.json` `blurb` is authored and rendered nowhere | `ui/worldmap.ts` |
| `tutorial` | step machine: `title`/`teach`/`nudge`, `await` predicates over intent, sim and mission events, camera `focus` | — | mid-mission | **live, gated to the tutorial** — the only condition-gated mid-mission text engine; the seed for `radio` | `tutorial/runtime.ts`, `data/schemas/tutorial.schema.json` |

Limits that are code, not taste: a `brief` beat is at most two sentences and 240
characters (`briefingBeats`); a tutorial `title` is ≤60, `teach` ≤240, `nudge`
≤160; the shipped briefings run 385–1,225 characters; a trigger's `label` is
≤ 48 characters with no full stop (`mission.schema.json`) -- what the player
reads in the feed when it fires. An unlabelled trigger shows nothing, `remove`
triggers are silent, and `validate:data` refuses a shipped non-`remove`
trigger without one.

## The two voices and the villain

- **Shai Hammai** — the commander and the player's officer. Captain at First
  Light, Colonel by the end. Orders voice: decisions, costs, restraint. The dead
  of First Light are his motive and ROE is his discipline; he never says the
  first aloud.
- **Idit Zohar** — intelligence officer, a First Light survivor, grows beside him.
  Intel voice: what is known, how well, what knowing more will cost. She never
  gives an order.
- **One villain per front**, introduced by an atrocity at the front's opening and
  captured or killed at its end. Named in the fictional register the towns use;
  characterised by doctrine (the digger, the observer, the smuggler), never by a
  people. He speaks through what he does.

A briefing is a two-hander: Idit's picture, Shai's plan, alternating beats.
Spellings are decided (2026-09-03): Shai Hammai, Idit Zohar; the villains are
Nadir Sahim, Karim Adhal and Jubran Hallaq, with SPADE, LANTERN and FERRY as
Idit's file names for them (`storyline.md` §2.3).

## Census before you claim

Never assert content exists from memory or from this file. Run the census:

```bash
ls data/units/kdf data/units/enemy data/units/civilians.json   # 17 KDF units as of 2026-09-13: the fourteen shipped plus the three star-gated units (breach_team, scout_shachaf, apc_kipod; docs/campaign/special_units/design.md)
ls art/meshes art/meshes/vehicles art/meshes/buildings art/meshes/decor art/meshes/civilians
ls assets/sprites assets/audio assets/ui assets/campaign assets/textures
jq -r '.id' data/maps/*.json
jq -r '.[] | .id' data/structures.json 2>/dev/null || jq 'keys' data/structures.json
jq -r '.objectives[].type' data/missions/*.json | sort | uniq -c
grep -n "kind ===" packages/sim/src/mission.ts | head -40     # live objective / trigger kinds
```

Then say PRESENT with the path, or MISSING with the gate the asset must pass
(`validate:assets`, `validate:meshes`, `validate:audio`, `validate:data`,
`validate:ui`) and the pipeline that produces it. `art/blend/` in the main
checkout holds supplied sources that may not yet be exported; census it before
calling anything missing (see `docs/ASSET_PROVENANCE.md`).

## Rules that apply to every document

1. Orders voice and story voice stay separate. `briefing` is orders; `dispatch`,
   `aftermath`, `debrief` are story.
2. Doctrine, never a people. Fictional names only. No real insignia.
3. Restraint is mechanical. Write consequences, not sermons.
4. Every mission must answer "what does the player decide here?" A mission a
   passive player wins is not a mission (`playtest` proves this with a passive
   probe).
5. Every twist is classified: **expressible today / schema field / engine work**,
   with the smallest proposal and its owner.
6. Every asset row is PRESENT (path) or MISSING (gate + pipeline). Every unit,
   structure, map, marker and zone id resolves to a file or is listed as new.
7. Missions target 5–7 minutes and one phase; phases ascend within a town; new
   content never authors against a stale schema ceiling. Every mission declares
   `time_limit_s`, at least twice its `target_minutes` (#540); a design that needs more
   must show the measured win that needs it.
8. Nothing here touches `packages/sim/src/tuning.ts`. Difficulty is measured by
   `playtest`, not estimated.
9. Unit names come from `data/campaign/names.json` only (storyline §2.4 rule 4): single
   common nouns in the materiel register, screened and dated, issued in table order by a
   counter on the ledger. Never write a name into a mission, a line or a briefing; the
   player's units are named by the app, and a name the table does not hold does not exist.
10. Maps keep the fight visible: 84% of the fight tiles in view of the default camera
   (below, and `ground-ladder.md` §15). Measure it; do not judge it by eye.

## Maps keep the fight visible

A map is built so the player can see the fight (the lead, GH-416): at least **84%** of
the passable tiles near its objectives and along its main routes must be visible to the
default camera, with no building's mesh over more than half of a rifleman standing there.
`tools/src/map_visibility.test.ts` gates every campaign map; a map under the floor needs a
named exemption with a reason, and the exemption is a ratchet. Run
`npx tsx tools/src/map_visibility.ts --draw=<map id>` while authoring: a building hides the
ground up-screen of it (north-west on the grid), about 1.2 tiles per world unit of
height. Buildings are drawn fitted to their footprints (a house on a 2×2 is about 2 units
tall and hides about 2.5 tiles; nothing draws under 1.2), so streets go on the camera side
of tall buildings and most of a town is low. The geometry and the four authoring rules are in
`ground-ladder.md` §15.

## Verification for narrative content

```bash
pnpm validate:data          # after any edit to data/missions/*.json
pnpm test                   # loading.test.ts covers briefingBeats
npx tsx tools/src/walk_mission.ts <mission-id> 0 60 180   # the world the text describes
```
