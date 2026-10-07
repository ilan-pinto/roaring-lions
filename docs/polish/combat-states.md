# Combat states: readable suppression and damage (pass C2 + C4)

**Status:** mock checkpoint, 7 Oct 2026. **No code in this step.** Nothing is built until the
lead answers §9. **Plan:** [`commercial-polish-plan.md`](commercial-polish-plan.md) §6 (C2, C4),
§5 B4. **Audit:** [`commercial-polish-audit.md`](commercial-polish-audit.md), PA-15.
**Mocks:** [`combat-states/`](combat-states/).

**The goal.** At a glance, a player can tell "still alive, but losing effectiveness" apart from
"healthy" and from "dead". They can also tell healthy, damaged, suppressed, pinned, broken,
mobility-degraded, firepower-degraded and destroyed apart, without reading numbers. The design
does this with restraint, inside the standing rules:

- Status goes on the icons and the HUD, not over the map ("no status marks in the world").
- Posture is the strongest channel in the world.
- The infantry motion standard holds (#402/#403): right-shoulder grip, kneel to fire, wedge.

---

## 1. What the sim already exposes

Everything this design needs is already read-only on `sim.state` or in the event stream. **No
sim change is needed** (invariant 4; no Stage 4 item).

| Signal | Where | Meaning |
|---|---|---|
| `suppression` | `state.suppression` (Q16.16, 0 to 2.0) | Decays at λ = 0.15/s (`SUPP_DECAY`). The shooter's aim is multiplied by `1/(1 + 1.5·S)` (`SUPP_K`): S 0.15 costs −18%, S 0.45 costs −40%, S 0.70 costs −51% |
| `pinned` | `state.pinned` and events `pinned`/`unpinned` | Set above 0.70 (`PIN_AT`) and cleared below 0.45 (`UNPIN_AT`). While pinned, a unit holds fire and moves at ÷64 |
| `routed` | `state.routed` and events `routed`/`rallied` | A soft unit that is not immobilised breaks after 200 ticks (10 s) of continuous pin. It rallies when the pin lifts |
| `hp` | `state.hp` against `type.hp` | Field recovery stops at 70% (`REGEN_CAP`) |
| `mobilityKilled`, `firepowerKilled` | `state.*` and event `component` (`mobility_kill`, `firepower_kill`, `combat_ineffective`, `crew_shaken`, `catastrophic`) | Set by the hit component roll on a penetrated vehicle |
| `brace` | `state.brace` (#402) | Standing, dropping, kneeling or rising |
| `nearMiss` | event | A round lands within 1.2 tiles of a unit. Carries x/y and no target |

Two values the HUD wants can be derived app-side from the above. Neither is a sim change:

- **Seconds until the pin lifts once the fire stops:** `ln(S / 0.45) / 0.15`. S 1.06 gives ~6 s;
  S 1.70 gives ~9 s. A broken unit rallies at the same moment.
- **Seconds until a soft unit breaks:** `(200 − ticks pinned) / 20`. "Ticks pinned" counts from
  the unit's own `pinned` event tick. `pinnedTicks` itself is private to the sim, but the event
  carries the same clock.

## 2. What the player sees today

| Channel | Today | Problem |
|---|---|---|
| Unit card | `PINNED · suppression 170%`, `BROKEN · moving · suppression 170%`, `immobilised · guns out` | PA-15: a raw percentage over 100, with no meaning and no action. Nothing says what suppression costs, or when it ends |
| Chips | Broken › pinned › aboard › APS › moving › holding | **A gunless or tracked Lavi reads "APS 3/3".** Mobility and firepower kills never reach the chip |
| Fire panel | `Rifle Squad 4% rifles · cover −91% · suppressed −20%`; `Out of range or out of sight` | PA-15: "suppressed" is the **shooter's**, and it sits beside the target's cover. The no-solution line does not say which reason applies |
| World overlay | HP bar (damaged, selected or hovered); an amber suppression bar on **every** unit with S > 0.02, capped at 1.0 so the pin line is not marked; 3 px grey and red pips for mobility and firepower kills | The suppression bar is already an always-on world status mark. The pips cannot be read at gameplay zoom |
| Posture | Pinned and stopped-routed units play `down` (`clip.ts` `resolveClip`) | **See §2.1.** This is the biggest defect in the pass |
| Audio | `near_miss` SFX (positioned). `pinned` minor alert (first in 4 s). Pinned voice call on an order to a pinned unit (#262; text only until D5) | Broken, rallied and component kills on your own units are silent |

### 2.1 New defect: a pinned team lies in its corpse pose (proposed PA-31, P1)

`tools/units/rig.py`'s `build_death_clip` documents `down` and `wreck` as "otherwise IDENTICAL".
Measured on the shipped GLBs (a Blender read of every fcurve): **of the 20 infantry GLBs that
carry a `down` clip, 17 have a `down` bit-identical to `wreck`.** The 17 are `at_team`, `atgm_cell`, `breach_team`,
`charge_squad`, `demo_squad`, `digger_crew`, `manpad_team`, `militia_cell`, `mortar_crew`,
`mortar_team`, the three officers, `recoilless_team`, `recon_zikit`, `rpg_team` and
`sniper_team`. `moto_rpg` has no `down`.

`resolveClip` sends both pinned and stopped-routed to `down`. So a pinned team lies exactly as it
will lie dead. The only tells are the bars above it, and the HP bar draws only when a unit is
damaged, selected or hovered.

- [`01-today-pinned-reads-dead.jpg`](combat-states/01-today-pinned-reads-dead.jpg) shows this on
  the live renderer. Two pinned, living teams lie flat.
- The three Meshy bipeds have their own `down`, and they split:
  - `sarim_rifles`: a cower, which is close to right.
  - `inf_squad`: kneeling with both hands raised, which reads as **surrender** (proposed PA-32).
  - `yahalom_squad`: a squat with the arms out.

This is the inverse of the C2 goal, and it is the most common combat state in the game.

## 3. The state language

One ladder, highest first. Each state has one word, one colour and, for the severe states, one
mark on the unit's art. Everything else rides on existing surfaces.

| State | Sim source | Word | Colour | Mark (chip and card art) | Posture (infantry) | Audio |
|---|---|---|---|---|---|---|
| Destroyed | `alive = 0` | (unit leaves the selection) | | | fall, then wreck. **The only flat pose** | unchanged (`unitLost` tiers) |
| Broken | `routed` | **Broken** | `--bad-text` | flag (the strip's own) | the existing 1.6× run, pitched forward and rifle low. Stopped: the pinned huddle, **never** the corpse | **new:** important tier plus voice `common.broken` (§6) |
| Pinned | `pinned` | **Pinned** | `--hot` | the shipped pinned mark (#262) | **new authored pose:** huddled, head tucked, muzzle down | unchanged: minor alert, plus the call when ordered |
| Out of action | mobility and firepower kill | **Out of action** | `--bad-text` | gun-out | | **new:** important tier plus a crew call |
| Gun out | `firepowerKilled` | **Gun out** | `--bad-text` | gun-out (new) | | as above |
| Immobilised | `mobilityKilled` | **Immobilised** | `--bad-text` | immobilised (new) | | as above |
| Suppressed | S 0.45–0.70, not pinned | **Suppressed** | `--hot` | none | heads-down lean, still firing | none |
| Shaken | S 0.15–0.45 | **Shaken** | `--warn` | none | a lighter lean | none |
| Damaged / critical | hp < 50% / < 25% | a word beside the hp numbers | `--warn` / `--bad-text` | none | none (the HP bar already draws when damaged) | none |
| Healthy | otherwise | (holding / moving) | | | stand, wedge, kneel to fire (unchanged) | |

A note on the suppression bands. Hysteresis does the right thing with no extra rule: a unit
rising through 0.45 to 0.70 reads Suppressed; a unit unpinning at 0.45 drops straight to Shaken.

## 4. HUD

### 4.1 Unit card

See [`04-unit-card.jpg`](combat-states/04-unit-card.jpg). The layout is unchanged; only the
condition line changes, and one meter is added.

- **The condition line** leads with the state word in display caps, then says what the state
  costs, in plain words:
  - **Shaken:** "aim −32%".
  - **Suppressed:** "aim −48% · close to pinned".
  - **Pinned:** "can't move or fire · up ~9 s after the fire stops", plus "· may break in ~6 s"
    for soft units only.
  - **Broken:** "fleeing, takes no orders · rallies ~9 s after the fire stops".
  - **Vehicles:** "Immobilised: can still fire", "Gun out: can still drive", or "Out of action:
    can't move or fire". A pinned vehicle reads "crew buttoned up, holding fire" and has no
    break clock, because armour never breaks.
- **The suppression meter** appears only when S ≥ 0.15. It is two cells and the pin mark:
  shaken, then suppressed, then pinned. Each cell fills in `--hot`, and the mark lights at the
  pin. There is no percentage anywhere. Past the pin, the seconds-to-recover replaces the
  overflow that "170%" tried to express.
- **Hp** gains a word only below 50% ("damaged") and below 25% ("critical").
- `hud.card.suppression` (`suppression {pct}%`) is retired.

### 4.2 Selection chips

See [`05-selection-chips.jpg`](combat-states/05-selection-chips.jpg).

- **The precedence becomes:** broken › pinned › out of action › gun out › immobilised ›
  suppressed › shaken › aboard › APS › moving › holding.
- An optional muted second clause names the next state down, for example "1 PINNED · 1 shaken".
- The marks sit at the art's bottom-left, in the same slot and at the same size (12 px) as the
  shipped pinned mark.
- The strip at the top of the screen is unchanged.

**Two new marks** follow the G1 rules (filled shapes only, 24 box, `currentColor`):

- **Immobilised:** a road wheel struck through.
- **Gun out:** a barrel broken in two.

Both are candidates, drawn on the sheet at 40 px and at 12 px.

### 4.3 Projected-fire panel

See [`06-fire-panel.jpg`](combat-states/06-fire-panel.jpg).

- **Whose.** The factors are grouped under two small labels:
  - **them:** range, cover, target moving.
  - **us:** firing on the move, shaken or suppressed.

  "suppressed −20%" becomes "us shaken −20%".
- **The target's state in the heading.** When the hovered target is pinned, the heading adds
  "pinned · can't shoot back". This is the tutorial's own lesson (`hud.hint.first.pins`).
- **Which reason.** Today's line is "Out of range or out of sight". It splits into four, all
  derived app-side:
  - **Gun out:** `firepowerKilled`.
  - **Out of range:** "reach 8 tiles, it is 11 away", from the distance against the longest
    weapon's range.
  - **Too close:** the weapon's minimum range.
  - **No line of sight:** the remainder. Inside `projectHit`, once range and minimum range pass,
    the only check left in the weapon loop is `losRay`, so the remainder is exactly LOS.

### 4.4 i18n (all through `t()`, `en.json`)

**New keys:**

- `hud.state.{shaken,suppressed,pinned,broken,immobilised,gunOut,outOfAction}`
- `hud.state.aim` ("aim −{n}%")
- `hud.state.closeToPin`
- `hud.state.recover` ("up ~{s} s after the fire stops")
- `hud.state.breakIn` ("may break in ~{s} s")
- `hud.state.rally`
- `hud.state.vehiclePinned`
- `hud.hp.damaged`, `hud.hp.critical`
- `hud.fire.them`, `hud.fire.us`
- `hud.fire.targetPinned`
- `hud.fire.outOfRange` ("reach {n} tiles, it is {d} away")
- `hud.fire.noLos`, `hud.fire.tooClose`, `hud.fire.gunOut`
- `selection.chip.{gunOut,immobilised,outOfAction,suppressed,shaken}`

**Retired:** `hud.card.suppression`, `hud.fire.outOfReach`, `hud.card.immobilised` and
`hud.card.gunsOut`, which fold into the new state keys. Label tables use getters (the
module-load locale trap in CLAUDE.md).

## 5. Posture: the world channel

See [`02-posture-ladder.jpg`](combat-states/02-posture-ladder.jpg) (3/4 view, at zoomed and
gameplay size) and [`03-posture-ladder-side.jpg`](combat-states/03-posture-ladder-side.jpg)
(side view, both factions).

**How the mocks were made.** The renders use `tools/render_clip_pose.py`'s own rig: camera,
materials and the palette repaint. The proposed columns are the shipped `kneel` and `move` clips
with bone deltas added by a scratch script. They mock the pose; they are not the final clip.

**Infantry, in order of strength:**

1. **Pinned: a huddle, not a corpse.** Kneeling, folded about 50°, head tucked, weapon
   muzzle-down. It is low and compact, and nothing points at the enemy. At gameplay size it
   separates clearly from dead (flat and long) and from kneel-to-fire (where the rifle makes a
   horizontal line). This fixes PA-31 and PA-32. Sarim's existing `down` is the reference.
2. **Broken: the existing 1.6× run** (`ROUT_CADENCE`), pitched forward about 28° with the rifle
   carried low. A broken unit standing still shows the huddle.
3. **Suppressed and shaken: a continuous lean** of spine, neck and head, up to 18°/10°/12°. It
   scales with S from 0.15 to 0.70 and relaxes as S decays, so the deterioration is visible as it
   happens. The unit keeps kneeling and firing: the motion standard holds.
   - **Honest limit:** at gameplay zoom this lean is subtle, and on the sheet it barely separates
     from the plain kneel at 26 px. It is a secondary cue. The HUD and the huddle at the pin
     carry the read.
4. **Optional: a flinch on a near miss** within 1.2 tiles of a unit that is suppressed or
   pinned. It reuses the shipped recoil additive's shape, about 0.3 s, and is suppressed under
   `data-motion=reduced`.
5. **Destroyed is unchanged**, and becomes the only flat pose in the game.

**Implementation routes** (lead decision P1):

- **Pinned huddle:** an **authored `pinned` clip**, contract v5. The motion pass
  (`pnpm motion:meshes`) already authors `kneel` for 9 rigs, and 12 rigs have no `kneel`. A
  folded pose needs hip and knee bends that a runtime additive cannot keep grounded. If
  `mesh_gait.test.ts`'s facing and weapon-axis checks sweep this clip, it needs a named "muzzle
  down by design" exemption with its own numbers. `resolveClip` sends pinned and stopped-routed to `pinned` and
  falls back to `kneel`, never to `down`. `down` stays for evacuation and civilians.
- **Suppressed lean:** a **runtime additive** beside `applyFigureAdditives`' recoil, because it
  is continuous in S and cannot be a clip. Presentation only: it reads `state.suppression` and
  writes no sim state.
- **Broken lean:** the same additive, at a fixed weight while `routed` is set.

**Vehicles.** No crew figures and no separate barrel node: the turret moves as a whole on
`turret_pivot`. So posture says little, and the restrained read is:

- **Mobility, firepower or both:** a thin, persistent dark smoke wisp from the hull. It would be
  a `data/vfx/` emitter on palette keys, inside the reserved range. Dust and exhaust stop on a
  mobility kill. The kind of damage is told on the HUD, not in the world (decision P3; **it would
  be mocked before it is built**).
- **Firepower kill:** the turret stops tracking and rests where it stood.
- **Pinned:** no world change, only the HUD.

**The existing world marks** (decision P4):

- **Suppression bar:** gate it like the HP bar, drawn only for a selected or hovered unit, once
  posture carries the unselected read. It stops being an always-on status mark.
- **Mobility and firepower pips** (3 px): retire them once the chip and card marks and the smoke
  land.

## 6. Audio hooks (restrained)

These extend the audio plan's tiers (`audio-plan.md` §3) and add no new layer:

| Event (own units only) | Tier | Voice | Throttle |
|---|---|---|---|
| `routed` | #5 important | `common.broken`: he «נסוגים!», ar «انسحاب!», en "Falling back!" | per-unit 4 s, global 2.5 s (the death-call numbers) |
| `component` `mobility_kill` / `firepower_kill` / `combat_ineffective` on a vehicle | #5 important | `common.immobilised` "We're stuck, tracks are gone!" and `common.gunDown` "Main gun's out!" | per-unit 4 s |
| `rallied` | none | none: a feed line only, "Rifle Squad rallied" | n/a |
| `pinned` | #10 minor (shipped) | the #262 call on an order (shipped) | shipped |

**Deliberately not proposed:**

- No suppression stinger, no low-pass or duck on the mix "under fire", and no heartbeat.
- No camera shake, vignette or desaturation for suppression (plan §6 C4: "no overdone screen
  effects").
- New voice keys are drafts for D4's native review and play nothing until D5.

## 7. What this design leaves out, and why

- **No new world icons or overhead marks.** Status lives on the chip, the card and the posture.
  Two existing world marks shrink (§5).
- **No squad thinning** (figures dropping as hp falls). Field recovery regenerates hp to 70%, so
  a fallen figure would have to stand back up, and a down figure cannot follow a moving entity.
  Damage on infantry stays with the HP bar, which already draws on damage (A4).
- **No hp numbers removed.** The card keeps `122 / 520 hp`; only a word is added.

## 8. Stage 4 (sim) list

Nothing is required. Two items would only be tidier:

- A `noSolution` reason in `HitProjection`. The app derivation in §4.3 is exact today, but it
  must be re-checked if `projectHit` gains a check.
- Exposing `pinnedTicks`. The event-derived break clock is exact today.

## 9. Decisions for the lead

| # | Question | Recommended |
|---|---|---|
| D1 | The state words (Shaken / Suppressed / Pinned / Broken / Immobilised / Gun out / Out of action / damaged / critical) | as listed |
| D2 | The card's suppression meter (two cells and the pin mark) in place of the percentage | yes |
| D3 | The recovery and break clocks on the card ("up ~9 s after the fire stops", "may break in ~6 s") | yes. They are the two numbers a player can act on |
| D4 | Fire panel "them / us" grouping, the target-pinned note, and the split no-solution reason | yes |
| D5 | Chip precedence with gun out / immobilised / out of action, plus the two new marks (wheel struck through, broken barrel) | yes, marks as drawn |
| P1 | Pinned posture: an authored `pinned` clip (contract v5, all infantry GLBs re-exported through the motion pass), never `down` | **yes**. It fixes PA-31/32 |
| P2 | The suppressed and broken lean as a runtime additive scaled by suppression | yes. It is low cost, and subtle by design |
| P3 | Vehicle damage smoke for component kills (to be mocked before it is built) | yes, mock next |
| P4 | Gate the world suppression bar to selected or hovered, and retire the 3 px kill pips once P1 and P3 land | yes |
| P5 | Near-miss flinch on suppressed or pinned infantry | optional; off under reduced motion |
| A1 | The `routed` and vehicle component-kill alerts at the important tier, plus three new voice keys | yes, as drafts for D4 |
| R1 | Add PA-31 (pinned reads as dead, P1), PA-32 (`inf_squad` pinned reads as surrender, P2) and PA-33 (chips hide mobility and firepower kills, P2) to the audit | yes |

## 10. Build plan after approval (for reference)

1. **HUD (D1–D5).**
   - A pure `combatState(sim, id)` in `ui/` returns the state, the aim penalty and the clocks.
   - Unit tests pin the band edges at S 0.15, 0.45 and 0.70, the hysteresis, and the recovery
     formula against the sim's own decay over N ticks.
   - **Falsify:** move a band edge, or compute recovery from `PIN_AT`, and the tests go red.
   - Card, chips and fire panel read the function. `validate:ui` and `--pseudo` pass.
2. **Posture P1.**
   - Contract v5: a `pinned` clip in the motion pass for every infantry GLB.
   - `resolveClip` and its tests change.
   - `validate:meshes`, `mesh_gait.test.ts` (an explicit muzzle-down exemption with its own
     numbers), and a `render_clip_pose.py` sheet at 1400 px.
3. **Posture P2.** The additive, with a test that it is zero below 0.15 and maximal at 0.70.
4. **Audio A1.** `alertsForTick` gains tests; voice keys are added to `audio.json` with
   `variants: []`.
5. **P3 and P4** after their own mock.

The golden gate: `quiet`, `open-ground`, `vehicle` and `relief` have no suppressed units at
their capture ticks, and only `combat` (report-only) is expected to move. That claim is
confirmed on CI. **Local gates** are `pnpm test`, `typecheck`, `lint`, `validate:ui`,
`validate:data`, plus `validate:meshes` for P1. **`ui:routes` runs on CI only.**

---

## WORK PACKAGE: C2 + C4, mock checkpoint

- **Changed:** docs only. This file, plus six mock sheets in `combat-states/`.
- **Why:** PA-15. The new finding is that 17 of the 20 infantry GLBs that carry a `down` clip
  draw a pinned unit in its own corpse pose. On top of that, suppression is an unexplained percentage, and vehicle component
  kills never reach the chips.
- **Player-visible improvement (once built):**
  - Alive-but-degraded reads from posture.
  - The card says what a state costs and when it ends.
  - The fire panel says whose penalty is whose and why a shot is impossible.
- **Tests:** none (no code). The build-step tests are in §10.
- **Visual evidence and capture conditions:**
  - `01`: live renderer, `?sandbox=beit_sahwan_outskirts&sur`, tick 297, zoom 2.5, 1600×1000,
    headless Chromium on ANGLE/Metal (Apple M3 Pro), music off. The force was attack-moved by a
    queued command and stepped with `__lions.step` for the capture only; this is not a UI
    verification.
  - `02` and `03`: Blender 5.2, `render_clip_pose.py`'s rig plus a scratch bone-delta script,
    Cycles at 32 samples.
  - `04`–`06`: HTML mocks with the shipped fonts and palette values, the real portraits and the
    shipped pinned glyph.
  - The `down` = `wreck` claim comes from comparing every fcurve keyframe of the two actions in
    each `art/meshes/*.glb`.
- **Known remaining issues:**
  - The suppressed lean is subtle at gameplay size, by design.
  - Vehicle smoke is unmocked (P3).
  - The mocked poses are bone deltas on shipped clips; the authored clip will differ.
- **Next priority:** the lead's answers to §9, then build step 1 (HUD), which does not wait on
  any art.
