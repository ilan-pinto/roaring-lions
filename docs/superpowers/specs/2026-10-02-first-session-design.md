# First session: tutorial strip, First Light cut, fire panel and Conduct invoice (GH-345)

**Status:** design, for the lead's approval. Nothing here is built.
**Covers:** playtest critique items 1 and 3 (2 Oct).
**Mock:** `2026-10-02-first-session-mock.html`, which shows the first three beats before and after, the fire-panel states, and the invoice. The captures are in `assets/first-session/`.

## 0. What a new player sees today (measured)

Both missions played on `origin/main` (`76d154d0`), 1440x900, ANGLE/Metal, music off, by a scratch Playwright walk: real mouse clicks for selection and orders, `__lions.step` for time, the DOM read at each beat.

- **Tutorial, first frame:** seven surfaces before the first click. Strip (leave, name, Conduct, objective with a 10:00 countdown, Objectives, speed, mute), clock plate, radio, minimap, controls hint, and the step panel, which covers the radio's own text.
- **Correction to the critique:** the tutorial mounts **no dock**. Its mission declares no `resources`, and `ReinforcementDock` is built only on a `resources` mission. "Dock, 18 locked units" is **First Light's** first frame: 21 tiles, 15 locked behind Conduct, stars or credits.
- **Tutorial, first combat:** step 2's right-click toward the wall put the squad in range of the two courtyard militia, which garrison from t=0. At 9:33 it was **BROKEN, 92/400 hp**, while the panel still taught step 3.
- **Right-click is the only movement verb, and it is attack-move** (`input/intents.ts`).
- **The fire panel** appears only over a VISIBLE hostile with a selection. In a First Light hover sweep, the commonest answer was a bare **"no unit can engage"** (out of range, or no line of sight; it does not say which). Factors print as **multipliers**: "suppressed 97%" means almost no penalty.
- **"Cannot penetrate" is unreachable against any shipped enemy:** `projectHit` needs `penetration < armorSide >> 2`. The highest enemy side armour is 10 (threshold 2), and the lightest KDF weapon has 8 mm.
- **First Light, first frame:** dock, two countdowns (4:59 relief, 4:29 families), logistics, intel, radio, title card, three notices and 11 units. Behind them: 4 objectives, a mortar crew with a paramotor spotter, 7 waves (5 more paramotors), 6 triggers and 11 civilians. Passive play loses at 4:30 on `evac_settlements`, with Conduct 100. The flagged `clinic` zone sits at [37,2], away from all play.
- **The Conduct record exists but is unreadable.** `main.ts` collects every `roe` event in `deductions`. The feed prints the sim's raw reason ("Conduct −5 (fire into protected structure (z_clinic)) → 95"). The strip tooltip is definition-only, and the end screen reads "Conduct 100 · 9 units walking out". The debrief lists raw reasons, and its Lost row prints type ids.

## (a) The tutorial beat ladder

Rules:
- One verb per beat.
- Each beat reveals at most one HUD element, and the reveal happens when the beat OPENS.
- No hostile exists until the beat that needs it. Beat 4's spawns by trigger. The courtyard garrison at t=0 is gone.
- The radio is hidden for the whole tutorial. The step panel moves into the radio's slot (top left), which ends the overlap.

Nine beats, down from fourteen:

| # | Beat (verb) | Reveals | Trigger (opens when) | Success (`await`) | Text (≤240 chars) |
|---|---|---|---|---|---|
| 1 | Look around (**pan**) | minimap | deploy | **new** `camera`, `tiles: 6` from the start position | "This is the training ground. Move the view with WASD or the arrow keys, or click the small map in the corner." |
| 2 | Take command (**select**) | selection card | beat 1 done | `intent select` | "Click the rifle squad. The card at the bottom says what you have selected and what it carries." |
| 3 | Advance (**right-click ground**) | order row, controls hint | beat 2 done | `intent order` (any verb) | "Right-click the marked ground. Your men go there and fight whatever they meet on the way. H halts them." |
| 4 | Make contact (**attack-move into a hostile**) | feed | squad enters `z_field`; a trigger spawns one militia cell in the open, ~9 tiles east | `sim fire side:1` (we fired on side 1) | "Someone is in the open ahead. Right-click past him: your squad stops and fires when it has a shot." |
| 5 | Read before you fire (**hover**) | fire panel | the militia dies, or 40 s pass; entering `z_wall` spawns the four staged contacts (see below) | `all_of` four `hover target:enemy` children, each with **new** `projection:` `unidentified` / `cover` / `moving` / `out_of_reach` | "Select your squad and hold the cursor over each enemy. The panel says whether you can shoot and why: not identified, in cover, moving, out of reach." |
| 6 | Identify, then shoot (**hold and fire**) | nothing new | beat 5 done | `any_of`: `sim destroyed side:1 by_unit:inf_squad`; `elapsed_s 60` | "The far one is only suspected. Keep it in sight and stay still until the panel gives odds, then take the shot the panel likes best." |
| 7 | Use the ground (**cover or garrison**) | Pinned/Broken status counters | beat 6 done | `any_of`: `sim garrison`; **new** `mission trigger id:enter_wall` | "Rocks are cover and walls are better. Move into the rocks or right-click the house. Where you stand beats any order you give." |
| 8 | Bring them in (**shepherd**) | strip objective + Objectives | a trigger delivers the jeep at `rp_road` | `mission evacuated` (emitted only under an `evacuate_before`, so the tutorial gains a secondary one: count 2, a 4x4 zone round `civ_refuge`) | "Two civilians are hiding south of the road. Drive the jeep within four tiles of them and they run for the refuge. Speed is the whole trick." |
| 9 | What a shot costs (**Conduct**) | Conduct field and its invoice (opened for the beat) | a trigger delivers the mortar team | `any_of`: `mission roe`; `elapsed_s 45` | "Fire the mortar near the flagged house and watch the invoice. Conduct is how cleanly you fight, and under the mission floor you lose." |

The clock, speed, mute, dock, logistics, intel and group bar never appear in the tutorial. Skipping or finishing the tutorial reveals everything.

**Beat 5 staging.** Four militia cells, each authored to stand in one projection state when the squad reaches `z_wall`:
- **A, unidentified:** visible but only suspected, at the edge of sight in the olive grove.
- **B, in cover:** on a cover-3 tile authored into `tutorial_ground` near the house.
- **C, moving:** `stance: patrol` across open ground.
- **D, out of reach:** beyond the rifles' 8 tiles but in sight.

Positions are **measured** in the browser, not reasoned: A must stay suspected for at least 10 s from `z_wall`. A, B and D take `stance: ambush, tiles: 2` so their weapons stay cold; C shoots back, which is its point and what beat 6 resolves. **"Cannot penetrate" is left out** (§0): it waits for the first armoured enemy type.

**What is cut, and where each lesson goes.** Each goes to the first mission that needs it, as a first-use hint through `hint-model.ts`'s existing one-liner slot:

| Cut step | Moves to |
|---|---|
| `move_as_one` (box select, shift waypoints) | Beat 3's hint already names shift; becomes a Mission I hint |
| `cover_is_terrain`'s `o` roll feed | Settings / keys overlay only |
| `fire_pins` (suppression) | Mission II, first enemy pinned |
| `reach_and_patience` (sniper) | Mission I (recon) |
| `mount_up` (g/u) | Mission I, first carrier with an empty seat |
| `armour_has_a_back` (facing, smoke) | Mission III (first `mbt_lavi`) |
| `and_armour_dies` (AT team) | First Light's own technicals at 160 s; the AT team shoots them unaided |
| `eyes_before_guns` (drones) | Mission I (recon drone) |
| `command_groups` (ctrl+N) | Mission II, the first force over 8 units |

Tutorial mission data:
- The courtyard, grove, road and ATGM garrisons are replaced by triggered spawns.
- The reinforcement triggers keep only the second squad (beat 7), the jeep (beat 8) and the mortar team (beat 9).
- The `survive_until 600` backstop stays, so `target_minutes: 10` still declares it, but the clock is never shown.
- Nine beats should run about 5 minutes; only a real player can measure that.

## (b) HUD progressive disclosure, in data

**One vocabulary**, `HudElement`, defined once in a new `packages/app/src/ui/hud-elements.ts` and mirrored as a schema enum. Its members:

`minimap, card, orders, hint, feed, fire, status, objective, objectives, clock, conduct, logistics, intel, speed, mute, radio, dock, groups`

A test pins the TS array against both schema enums, as `steps.test.ts` already does for `INTENT_KINDS`.

**Schema changes:**
1. `tutorial.schema.json`: a top-level `hud_start: HudElement[]` (what is visible at deploy; everything else is hidden), and a step-level `reveal: HudElement[]` (added when the step opens, cumulative). The predicate gains:
   - kind `camera` with `tiles`
   - `hover.projection` (`unidentified | cover | moving | out_of_reach | shot`)
   - `mission.id`, which matches a trigger or objective id on `trigger` and `objective` events.

   `all_of` stays top-level only.
2. `mission.schema.json`:
   - an optional `hud: { hidden: HudElement[] }` for a whole mission. It is the hook for any later mission that wants a quieter cockpit. First Light does not need it once its `resources` go.
   - an optional objective field `clock: false`, which keeps that objective's countdown out of the strip.

   Both are **app-read only**. `packages/sim/src/mission.ts`'s `MissionJson` type is not touched. That is the same path `map.time_of_day` took (R-12).

**Runtime.** A pure `hudVisibility(state, tutorialJson, missionJson): ReadonlySet<HudElement>` beside `tutorial/runtime.ts`, tested without a DOM; `Hud`, `Minimap` and `ReinforcementDock` take an `isShown(el)` dependency. "Hidden" means **inert, not just invisible**: the `production` key, ctrl+N and the Conduct tooltip consult the same set. The tutorial's set overrides the mission's; with no tutorial running, the mission's `hud.hidden` applies, and by default nothing is hidden, so every other mission and every sandbox renders exactly as today.

## (c) First Light, cut to two problems

**Keep: (1) hold the yard until relief, (2) bring two families inside before the ring closes.** These are `survive_relief` and `evac_settlements`, both already primary.

`evac_settlements` is the only objective a passive player loses on (restored as a primary for exactly that; passive still DEFEATs at 4:30 today), "hold" is the premise, and beats 7 and 8 teach both. Contacts + civilians has no win condition; hold + outpost lets passivity win.

| Removed | Why | Deferred to |
|---|---|---|
| `resources` (dock, logistics, intel) | a third problem with 21 tiles of UI | Beit Sahwan II, the first mission that already declares `resources` |
| `mortar_crew` + `paramotor` spotter, and the paramotor waves at 50 s and 250 s | the "mortar you can't see" and air units most of the force cannot shoot | a later Beit Sahwan mission that is about counter-battery |
| outpost section, `hold_outpost`, `they_take_the_section` | a second position to hold | none; the section starts inside at [21,18], the tile the plan already withdraws it to |
| `hold_compound` (secondary) | it duplicates "hold" | none |
| `sniper_team`, `mortar_team`, `demo_squad` | the sniper's job was the spotter; the mortar is a danger-close liability beside the families; nothing to demolish | Mission III draws `mortar_team` `from_ledger`; a gutted roster fields one fresh remnant (`mission.ts:1265-1279`), so nothing breaks |
| `clinic` flagged zone | at [37,2], unreachable in play; Conduct here is about civilians | none (`roe.enabled` stays) |

**One countdown.** `survive_relief` takes `clock: false`, and its text names the time ("Hold until the relief column, 5:00"). The strip then counts down the one deadline that can fail.

**What survives:** 4 rifle squads, 2 AT teams, the APC and the jeep (8 units); the four village triggers (the evacuation pressure); the militia, technical, RPG and moto waves.

**Measured, not reasoned.** The cut removes the enemy's mortar and five paramotors, and the player's 400 + 200/min logistics (about seven bought squads in today's plan) and three units; the net is unknown. The `playtest` agent runs the passive / naive / sensible / optimal ladder before and after, and waves are trimmed until optimal wins inside 5 minutes, sensible wins most seeds, and passive loses.

## (d) The Conduct invoice

**One pure model:** `ui/conduct-invoice.ts`, with `invoiceLines(deductions, mission) → { label, count, total, times }[]`.
- It groups deductions by cause and place.
- It names the place: the zone id is resolved to its structure type through the map (`z_clinic` → "Clinic"), with a fallback to the zone id. Labels go through `t()`.
- It classifies the sim's five reason templates in `stepRoe`: structure destroyed, civilian casualties, fire into a protected structure, strike into a protected structure, danger-close.

A test lists every template literally, and mutating any template in `mission.ts` must turn it red: the classifier parses data it does not own.

Where it shows:
1. **Feed, as it happens:** "**Clinic struck −5** · Conduct 95". `roeNotice` keeps its warn and lost tiers, but the head changes.
2. **Strip, on hover or click of Conduct:** the running ledger (cause, first time, total). The tooltip's definition becomes the empty-state line. Beat 9 opens it automatically.
3. **End screen** (`ui/menu.ts`, `menu.end.summary`): "Conduct 85 · Clinic struck ×2 −10 · +1 more", which replaces the bare "Conduct 100".
4. **Debrief:** a cause / when / cost table in place of `rl-debrief__deductions`' raw lines. The Lost row prints unit names, not type ids (same grid, one line).

## (e) What it costs

**Sim: no change required.** Everything reads existing read-only state: `projectHit`, `contactLevel`, `MissionEvent` and unit data. Two improvements would want the sim, and both are flagged for Stage 4, not this work:
- a reason on `noSolution` (range versus line of sight), which panel state D works around by checking weapon reach from unit data;
- a structured `category`/`zone` on the `roe` event, which would replace the reason-string classifier.

**Files.** Data: `data/tutorial/beit_sahwan_0.json` (rewritten), the tutorial and First Light mission JSON, `data/maps/tutorial_ground.json` (beat 5 cover tile, spawn markers), both schemas, `data/locales/*/missions.json`. App: `tutorial/{runtime,panel}.ts`; new `ui/hud-elements.ts` and `ui/conduct-invoice.ts`; `ui/hud.ts`, `ui/minimap.ts`, `ui/production.ts`, `ui/roe-notice.ts`, `ui/menu.ts`, `ui/debrief.ts`; `i18n/en.json`; `main.ts` (camera and hover-projection inputs, `isShown` wiring).

**Gates that move:**
- `pnpm playtest`: First Light's optimal plan (`led0`) loses its `requestBuild` loop and must be re-proven. The passive control must still be DEFEAT. `LADDER_CREDITS` (5849) will move if First Light's stars change, and must be re-pinned with the reason in the commit.
- `tools/src/first_light_fence.test.ts`: its passive-control and wave-route pins re-read against the new waves.
- `pnpm ui:routes`: leg K4 uses `beit_sahwan_breach` as "a mission with a dock" and moves to `beit_sahwan_2_foothold`. The soft-boot leg clicks the board's first card (First Light) and needs no dock, so it is unaffected.
- `pnpm ui:shots`: shot `26-dock-kitted` drives First Light for the same reason and moves to Mission II.
- `pnpm golden-baseline`: gated scenarios are `sandbox=` frames (and report-only `combat` on Mission III), where nothing is hidden, so **no bless is expected**; the PR's `visual` job confirms it.
- `steps.test.ts` and `runtime.test.ts` grow the new predicate kinds. `validate:data` and `validate:ui` get the new keys.
- Telemetry: `tutorialStep(index, length)` changes meaning (14 → 9), so the `/stats` funnel needs a version cut.

## Decisions for the lead

1. **The fire beat teaches four states, without "cannot penetrate".** *Default: yes.* It is unreachable against every shipped enemy. Adding an armoured enemy is separate content.
2. **The two problems kept in First Light are hold and evacuate.** *Default: yes.* Passivity still loses on `evac_settlements`.
3. **First Light loses `resources`, so the dock first appears in Mission II.** *Default: yes.* Keeping logistics with a collapsed dock makes it a third problem again.
4. **Right-click stays the only movement verb; "move" is taught as "Advance" (beat 3) and "attack-move" as "Make contact" (beat 4).** *Default: yes.* Adding a plain move verb is a controls change outside this issue.
5. **Factors print as penalties ("cover −86%"), not multipliers.** *Default: yes.* The number is unchanged; only the wording and sign change.
6. **The invoice classifies the sim's reason strings in the app, with a mutation-tested template list, until a Stage 4 sim change adds a structured category.** *Default: yes.*
7. **First Light shows one countdown (`clock: false` on `survive_relief`).** *Default: yes.* A global "soonest deadline only" rule would change every mission.
8. **The radio is hidden for the whole tutorial, and the step panel takes its slot.** *Default: yes.* Shai's 1/3 briefing lines are already on the deploy screen.
9. **The beat 5 contact positions are fixed by a measured browser walk before the build is approved, not by this document.** *Default: yes.*
