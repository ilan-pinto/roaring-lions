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
                 │                 + name / briefing / objective text in the mission JSON
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
  author places) and Intel (drones and stationary markers earn it; it buys a
  satellite sweep or a precision strike). Only 6 of 14 shipped missions declare
  any economy. Unit availability is gated by campaign ROE rating and completed
  missions, not by tiers.
- **The player force is placed, not built.** `starting_force` plus ledger
  survivors (`from_ledger`), plus authored `reinforce` triggers and waves.
- **The enemy is stances, one-shot triggers and waves.** One stance per placement
  (`hold_position | ambush(tiles) | patrol | garrison`), four trigger conditions ×
  five actions, waves on a clock or on an objective completing. That is the whole
  AI. Design inside it and name what falls outside as a gap.
- **Nine live objective types.** `locate eliminate_hvt capture hold_for
  survive_until destroy_all raze collapse evacuate_before`. Three more are in the
  schema and the runtime throws on them (`mark escort no_collateral_above`).
- **ROE is the second score.** 0–100, `flagged_zones` from map zones, `fail_below`
  loses the mission. Restraint must be the mechanically superior play. A villain's
  job is to make the player want to break it.
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
| `brief` | deploy-screen beats, then the in-mission commander bar (◂/▸ paging) | Shai / Idit | start | **live**, one hard-coded speaker | `ui/loading.ts` `briefingBeats`, `ui/hud.ts` `COMMANDER`, `renderCommander` |
| `toast` | notice feed, 4 lines, 9 s | system | on `MissionEvent` | **live**, strings hard-coded; only `objectives[].text` and the raw `trigger.id` are authored | `main.ts` `describeMissionEvent`, `hud.note` |
| `title` | title card | system | start | **live**: `name` + "N primary objective(s)" | `hud.announce` |
| `dispatch` | story line on the title card | narrator | start | **specced, unbuilt** (2026-08-21 storyline spec) | — |
| `aftermath` | story line on the victory banner | narrator | end | **specced, unbuilt** | — |
| `debrief` | end-screen text | Shai / Idit | end | **needed** — the end screen has zero authorable text | `ui/menu.ts` `showEndScreen` |
| `radio` | mid-mission transmission overlay: speaker, portrait, line | Shai / Idit / villain | on trigger, objective, wave, event | **approved target, unbuilt** — needs a `say` field on `triggers[].do` / objectives and an overlay | `sim/mission.ts` `stepTriggers`, `render-vfx` |
| `eva` | announcements: objective complete/failed, unit lost, reinforcements | the brigade net | on `MissionEvent` | **approved target, unbuilt** — GH-110; `audio.schema.json` needs a non-weapon set kind | `render/audio.ts` |
| `bark` | acknowledgement and selection responses | units, keyed by role | on intent | **approved target, unbuilt** — GH-110 | — |
| `board` | campaign map text | — | between missions | **live**: region `faction · doctrine`, town done/total; `world.json` `blurb` is authored and rendered nowhere | `ui/worldmap.ts` |
| `tutorial` | step machine: `title`/`teach`/`nudge`, `await` predicates over intent, sim and mission events, camera `focus` | — | mid-mission | **live, gated to the tutorial** — the only condition-gated mid-mission text engine; the seed for `radio` | `tutorial/runtime.ts`, `data/schemas/tutorial.schema.json` |

Limits that are code, not taste: a `brief` beat is at most two sentences and 240
characters (`briefingBeats`); a tutorial `title` is ≤60, `teach` ≤240, `nudge`
≤160; the shipped briefings run 385–1,225 characters; a trigger `id` is shown
to the player verbatim as `enemy reacts (<id>)`, so name it as prose.

## The two voices and the villain

- **Shai Hamami** — the commander and the player's officer. Captain at First
  Light, Colonel by the end. Orders voice: decisions, costs, restraint. The dead
  of First Light are his motive and ROE is his discipline; he never says the
  first aloud.
- **Idit** — intelligence officer, a First Light survivor, grows beside him.
  Intel voice: what is known, how well, what knowing more will cost. She never
  gives an order.
- **One villain per front**, introduced by an atrocity at the front's opening and
  captured or killed at its end. Named in the fictional register the towns use;
  characterised by doctrine (the digger, the observer, the smuggler), never by a
  people. He speaks through what he does.

A briefing is a two-hander: Idit's picture, Shai's plan, alternating beats.
Spellings and surnames are listed as open decisions in `storyline.md` until the
lead confirms them.

## Census before you claim

Never assert content exists from memory or from this file. Run the census:

```bash
ls data/units/kdf data/units/enemy data/units/civilians.json
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
   content never authors against a stale schema ceiling.
8. Nothing here touches `packages/sim/src/tuning.ts`. Difficulty is measured by
   `playtest`, not estimated.

## Verification for narrative content

```bash
pnpm validate:data          # after any edit to data/missions/*.json
pnpm test                   # loading.test.ts covers briefingBeats
npx tsx tools/src/walk_mission.ts <mission-id> 0 60 180   # the world the text describes
```
