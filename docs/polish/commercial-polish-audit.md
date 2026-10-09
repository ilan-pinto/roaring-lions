# Roaring Lions: commercial polish audit (baseline)

**Date:** 6 Oct 2026 · **Build:** `79e528c4` (v0.121.5, `main` at the time of the walk) · **Plan:** [`commercial-polish-plan.md`](commercial-polish-plan.md), sections 1–2 only. No polish changes are in this branch.

---

## Status at 9 Oct 2026 (re-score after the 6–9 Oct lane)

**Build:** `efc36d4f` (`main`, CI green). **How this was judged:** a desk re-score from the merged PRs (their bodies and tests) and the code on `origin/main`. Nothing was re-walked by hand and no browser was run, so every DONE below means "landed with a test that was seen red first", not "re-photographed". The baseline text further down is unchanged, and the defect table (§5) now carries a Status column.

**Tally of PA-01..PA-33:** 30 DONE · 1 PARTIAL (PA-02, licences and recordings) · 0 OPEN · 2 DEFERRED (Stage 4: PA-08 #420, PA-10 #421) · 0 LEAD. Both P0s moved: PA-01 is closed; PA-02 is partial and now blocked only on licences and recordings. (Updated by `polish/first-timer`: PA-12 to DONE, PA-25 still PARTIAL with its feed and objective line done; PA-23 and PA-30 to DONE by `polish/captions-and-name`. Then PA-19 DONE (kill read) and the small batch: PA-27, PA-28, PA-29 DONE, PA-20 still PARTIAL on the "next operation" button.) Then #491 built the held victory/defeat beat and the First Light fill (PA-07, PA-24 DONE), and `polish/ux-small-2` closed PA-20 (the board's "Next: ..." button) and PA-25 (the Free Play picker as map cards, leave lands on `/free-play`) plus the #422 camera notes (middle-drag pan, zoom glide).

**Lane PRs since the audit (#419 onward):** #422 camera · #424 group selection and First Light clock · #425 wording · #426 audio cues and mix · #427 orders and badges · #428 alerts · #431 razing costs no Conduct · #432 P2 sweep · #434 end actions reachable · #437 visual register and error-state audit · #438 ambience · #439 briefing top reachable · #440 map occlusion gate · #441 replay replaces survivors · #442 Field order briefing, deploy and debrief · #444 buildings drawn to footprints · #445 suppression and damage states · #448 one type register · #449 and #452 register cleanup and palette fallbacks · #453 error states wave 2 · #454 one chrome register · #455 Deploy scrollbar · #456 small-screen notice · #457 lime move cursor · #459 amber friendly health, live colour-vision switch, speaker glyph · #460 explosion strength order · #461 minimap state and urgency · #466 and #467 in-game feedback · #474 memory gate · #475 hatched zone band · #476 tunnel x-ray · #478, #479 and #480 memory savings.

### Remaining work, by the audit's own priority

| Priority | ID | What is left | Proposed fix | Size |
|---|---|---|---|---|
| P0 | PA-02 | Voices: 36 of 40 keys have no take | AU-6: record or commission the reachable Hebrew and Arabic lines, then the announcer lines. Blocked on L6 (D5) | L |
| P0 | PA-02 | ~~One music track serves the whole game~~ DONE #493: calm and battle beds re-cut from the theme (AU-7). The theme's generator terms stay open (provenance item 3, L6) | — | — |
| P0 | PA-02 | ~~Voice director v2 not landed~~ DONE #497: the §5.1 rank ladder, the 300 ms no-cut floor, a shuffle bag per key, unit-lost coalescing over 2 s, the start/major/outcome silences, captions on the same ladder (AU-5) | — | — |
| P0 | PA-02 | ~~Provenance and credits for the new audio~~ DONE #497: the audio classes in ASSET_PROVENANCE, the credits' AI disclosure naming the theme, the music cut from it and the ElevenLabs placeholders, and `validate_audio.py --commercial-manifest` writing the manifest a commercial build ships without them (AU-10) | — | — |
| P1 | PA-08 | Targeted fire does not exist (DEFERRED, #420) | Stage 4 sim command. The move-only presentation half is L1 | L, SIM |
| P1 | PA-10 | Vehicles pile up in groups (DEFERRED, #421) | Stage 4 sim separation | L, SIM |
| P2 | PA-19 | ~~The vehicle-kill read (dust puff, dark wreck) is untouched~~ DONE: the fireball reads through the shroud | A kill-specific emitter, judged with `pnpm blast:capture` before/after | M |
| — | K-10 | Dock refusal says "insufficient logistics" for any refusal | Word it from the sim's refusal reason. Stage 4 (economy) | S |
| — | K-17 | Narrow portrait layout and touch verbs | Pass I; the notice is done (#456) | L |
| — | — | No campaign-complete line anywhere | Shai/Idit copy for the end of the last town | S |
| — | KS-06 | ~~Save/load reliability and keyboard-only navigation not assessed~~ WALKED by `polish/keyboard-and-saves` ([`keyboard-and-saves.md`](keyboard-and-saves.md)): five fixed (KS-01 Enter on the victory moment skipped the debrief into the next mission; KS-02 Tab escaped the debrief onto the hidden HUD; KS-03 saves list dropped focus; KS-04 a refused load left a mixed campaign, now undone byte for byte; KS-05 a refused account write at victory threw after the ledger recorded the win). Left: no keyboard move/attack order (KS-06), plus KS-07..KS-14 | KS-06 needs a lead call: keyboard reticle (L) or order-at-screen-centre (M). KS-07 Escape-goes-back and KS-08 focus on route mount are one S shell package | L / S |
| — | — | Not assessed in the baseline and not since: low-end performance, hearing the mix | Stage 7 release pass and the tester cohort (#302) | M |

### Lead decisions

| # | Item | Question | Recommended answer |
|---|---|---|---|
| L1 | PA-08 | Which input issues a move-only order (the sim's existing `move`), so a player can disengage? Today every right-click is attack-move. | An armed **Move** chip in the order row with its own hotkey (V), like Attack-move. Not a modifier: Alt already means "fire on a protected site" and Shift means queue. |
| L2 | PA-23 | Should captions be on by default? The voices are Hebrew and Arabic, and announcements already caption regardless (#426, A5). | Yes. Revise the D8 ruling for the default only. Existing saves keep their value. |
| L3 | PA-24 | **Done (#491).** May First Light's dawn light be lifted so the compound reads without rings? | Yes, mock first: a lifted fill for that mission only, keeping the dawn mood. Accept it if units inside the compound read at zoom 1 without their rings. |
| L4 | PA-29 | Remove the Mutte (CC BY 3.0) Namer credit from the credits screen? (ASSET_PROVENANCE item 6) | **Done (small-batch PR):** the credit is removed and `credits-data.test.ts` guards it. The sprite sheets are gone (#374), `git ls-files` finds no `NAMER_` file, and the Namer is a Meshy model. Keep the history in the provenance table. |
| L5 | PA-30 | Rename "Beit Sahwan 0 — Working Up", and where does the version string live? | Rename to "Working Up" (a data string; ids unchanged). Keep the version on the lockup: testers report against it. |
| L6 | PA-02 | The D5 voice licence and the music source for a commercial build. This is the only thing between PA-02 and done. | Audio-plan A3, A4, A6: the lead records the Hebrew barks, one native Arabic actor, announcers after the lines are approved; the four ElevenLabs takes stay out of a commercial build (`validate_audio.py --commercial` already fails them); re-cut the existing theme into beds first. |
| L7 | PA-12 | Ship the data-only tutorial interim now, or wait for targeted fire (#420)? | Ship it now. It is P1, it is data, and it makes the Conduct invoice reachable on the first session. |
| L8 | VR-13 | Are the 1–3 steel stars (G-P3, per CLAUDE.md) the final kit glyphs? `ui/kit-sign.ts` still calls its glyphs PLACEHOLDERS. | Confirm they are final; fix the comment and the SVGs' geometry rules. |
| L9 | VR-04, VR-05 | Neutral yellow carries nine meanings; olive is both KDF hull and arid foliage. Act now? | Wait for tester evidence (#302). Both are meaning and art-number calls, not defects anyone has reported. |

### Commercial polish score (plan §16)

The plan's §16 has no table, so the scores live here. Baseline is the first-pass table in §7 below. Target: no category below 4. These are desk scores (see above) and should be re-checked by a hand walk before they are believed.

| Category | 6 Oct | 9 Oct | Evidence for the new score |
|---|---|---|---|
| Input feel | 3 | **3.5** | Cursor reads "advance" and the panel says so (#427); a wall click resolves to its building (#427); refused ground clicks say so, with the deny cue (#453); move cursor matches its route (#457). Still one verb: no targeted fire (PA-08, Stage 4) and no move-only (L1). |
| Selection | 3.5 | **4** | One envelope and one route per group order, lightened primary ring (#424); group badge numeral legible (#427). |
| Camera | 2 | **4** | Time-based eased pan, map bounds, proportional zoom (#422), with before/after GIFs. Middle-mouse drag pans and a zoom step glides over 150 ms (instant under reduced motion) since `polish/ux-small-2`. |
| Combat feedback | 3 | **3.5** | Pinned and suppressed read as living, damage smoke, state words with costs (#445); effects strength in event order (#460); kill lines in the feed (#432). The kill's fireball now reads through its dust (PA-19). |
| HUD | 3 | **4** | No raw ids (#425); alerts with place, count and tier (#428); hint line retired (#428); one chrome register (#454); minimap state and urgency (#461); hatched zone band instead of a lime wash (#475). |
| Visual identity | 3.5 | **4** | One type register (#448) and one chrome register (#454); palette fallbacks derived from `palette.json` (#449, #452). Open: VR-04, VR-05, VR-13 (L8, L9). |
| Environment | 3.5 | **3.5** | Buildings drawn to their plots, worst stretch exactly 2.0 (#444); campaign-wide fight-visibility gate at 0.84 (#440). First Light's dawn is lifted by a fill for that mission alone (#491, PA-24), and three maps are named exemptions. |
| Audio | 2 | **3** | Eleven CC0 cues, tiers, a cue bus and duck table, music scenes (#426); ambience beds (#438, switched off since 9 Oct); calm and battle music beds (#493); voice director v2 and audio provenance (AU-5, AU-10). Still 4 of 40 voice keys, and those ElevenLabs takes barred from a commercial build (PA-02, L6). |
| Briefing | 3.5 | **4** | Field order: at-a-glance card, lit ground with marks, force as places with a bench, Deploy always on screen (#439, #442). |
| Debrief | 3 | **4** | After-action report: verdict, star ladder, three columns, losses and promotions by name, ground photograph with pins, one primary action (#442); actions always reachable at seven sizes (#434). |
| Campaign flow | 3.5 | **3.5** | First Light's hold clock returns (#424); the end screen says what the result means (#453, K-07). The board's pin labels and status line are fixed (PA-20, small batch) and it carries a primary "Next: <mission>" button (`polish/ux-small-2`); the end of the war is said on the board and in the report (#495). |
| Accessibility | 3 | **3.5** | Live colour-vision switch (#459); reduced motion honoured by the new flinch layer (#445); small-screen notice (#456). Captions are on by default since PA-23 (L2, 9 Oct). Keyboard-only use walked 9 Oct (`keyboard-and-saves.md`): every shell screen, the briefing, pause, settings and the debrief are reachable, and three focus defects are fixed; a battlefield move order still needs a pointer (KS-06). |
| Performance | 4 | **4** | Memory measured and gated in CI (#474); two retention leaks fixed; the heaviest mission fell from 2756–2927 to 2296–2464 MiB on CI (#478), and #479 and #480 save more. Low-end hardware still unmeasured. |

**Below 4:** Input feel 3.5 · Combat feedback 3.5 · Environment 3.5 · Audio 3 · Campaign flow 3.5 · Accessibility 3.5.

### Release blockers (plan §22)

| Blocker | State | Why |
|---|---|---|
| A first-timer cannot understand the basic objective | **Unmet** | Tutorial beats 6 and 9 now end on the lesson and beat 9 reaches the Conduct invoice (PA-12, `polish/first-timer`); the tester cohort (#302) is the real gate and has not reported. |
| Selection ambiguous | Met | #354, #424, #427. |
| Important commands lack feedback | Met | Acknowledgement, deny cue and refusal notes (#426, #453). Targeted fire is missing, which is a capability and not a feedback gap. |
| Major combat events hard to perceive | Met, one caveat | #445, #460, #432, PA-19. |
| HUD hierarchy inconsistent | Met | #428 tiers, #454 chrome register. |
| Visual styles vary across assets or screens | **Unmet** | Type and chrome are one register now, but VR-04, VR-05 and VR-13 are open lead calls, and unit and asset seams (D2) were not judged. |
| Transitions abrupt | **Unmet** | Briefing to battlefield (H3) has not been worked or walked. |
| Victory/defeat feels like a debug state | Met, borderline | Names, stinger, report (#425, #426, #442). The held victory/defeat beat landed in #491 (PA-07). |
| Debrief fails to communicate consequences | Met | #442. |
| Important audio missing or placeholder | **Unmet** | PA-02: 36 of 40 voice keys, and the four with a take are ElevenLabs placeholders a commercial build leaves out (D5). Music has calm and battle beds (#493); its source question is provenance item 3. |
| Save/load unreliable | Met for known defects | K-05, K-06, K-12 closed (#453). Not re-walked. |
| Settings or navigation confusing | **Not judged** | Back buttons are one register (#448); Escape/back and keyboard-only paths were never walked. |
| Visible stutters | **Not judged** | No known stutter; measured on an M3 Pro only. |
| Debug terminology reaches players | Met | #425, with a deny-list test over `en.json` and a pseudo-locale card check. |
| Gates bypassed | Met | Every lane PR names a red-first mutation; `main` is green at `efc36d4f`. |
| Regressions unresolved | Met | No open red on `main`. |

### Sibling documents

- **`visual-register.md` (VR-01..38):** resolved are VR-01, 03, 06, 08, 09, 10, 12, 14, 15 (the speaker glyph), 16–21 (#448, #454), 22, 23, 24–31 (#454), 33–38 (#457, #461). Open: VR-02 (latent, no shipped content), VR-04, VR-05, VR-13 (lead), VR-32 (the lime meaning stays by ruling), VR-07 and VR-11 (recorded follow-ups, likely stale after S3a and A3.3).
- **`error-states.md` (K-01..18):** all fixed except K-10 (Stage 4) and the missing campaign-complete line; K-17 is fixed as a notice only (touch verbs and a narrow layout stay open).


---

## Baseline audit (6 Oct 2026)

**How this was judged.** Every finding comes from looking at the game as a first-time player would, then confirming the cause in code. There were two capture passes, one browser at a time, both headless Chromium on ANGLE/Metal (Apple M3 Pro) at 1920×1080, DPR 1, music off:

- **`pnpm ui:shots`**: run once with `--res=1920x1080 --gpu=metal`. It covers the menu, campaign, brigade, settings, credits, saves, briefing, HUD states, pause, the scripted defeat and debrief, and the scripted victory.
- **A hand-driven walk** (scratch driver, not committed), with real mouse clicks and keys and no console shortcuts for play. `window.__lions` was used only to read state, such as where a unit sits on screen or which cursor key is applied. The frame loop was held between decisions, so the walk plays like a player who thinks instantly; game time ran only while the walk acted. The walk covered a new campaign from the menu, the whole tutorial, First Light, Beit Sahwan I up to the first orders, and the Free Play sandbox for group orders and a vehicle kill.

Two limits. The OS pointer cannot be photographed, so cursor states were read back with `__lions.cursorKey()`. The capture was headless, so no audio was heard; audio is judged from `data/audio.json` and `packages/render/src/audio.ts`.

All 66 captures are in [`before/`](before/), as JPEG at 1440 px wide and quality 48 (6.5 MB in all). `shots-*` files come from `ui:shots` and `play-*` files from the walk.

---

## 1. Executive assessment

Roaring Lions already looks and plays like a serious tactical RTS:

- The lit renderer, textured units and buildings, dawn and dusk light, and ground decals carry a coherent, grounded military look.
- Selection rings and contact marks read on busy terrain.
- The projected-fire panel answers "can I make this shot, and why not" in plain words.
- The briefing has real structure: situation, mission, execution, a commander portrait and a ground preview.
- The tutorial teaches the core verbs in about three and a half minutes, and First Light is a tight five-minute mission with two clear problems.
- The technical floor is excellent. Every local gate and both CI gates are green.

What separates it from "a finished RTS" is mostly finish, not features:

1. **Debug language reaches the player** on every selection and every briefing: raw weapon ids (`gun_120`, `mortar_60`), "MESHES ONLY", "Toggle the debug overlay", "campaign ledger updated", and developer flags on the Free Play screen. This is a §22 release blocker, and it is cheap to fix.
2. **Audio is placeholder.**
   - UI alerts and objective cues are oscillator beeps.
   - Victory and defeat have no sound.
   - 4 of 40 voice lines are recorded.
   - Announcements are caption-only.
   - One music track serves the whole game, and every SFX is procedurally generated.

   This is also a §22 blocker, but it needs assets and the D5 licence, not code.
3. **The camera feels unfinished.** Pan speed is per frame rather than per second, with no easing. A 1.5 s key hold in the tutorial's first beat threw the view off the map into empty space, and nothing keeps the camera on the map.
4. **The information arrives without place or time.**
   - Alerts stack as identical lines ("under fire — 1 unit" ×4) with no unit or direction.
   - Reinforcement notices give no direction.
   - First Light's last four and a half minutes have no visible countdown at all.
5. **Group commands are cluttered and not quite honest.**
   - A 14-unit selection draws 14 range rings and 14 order lines.
   - Vehicles in a group pile into each other.
   - Right-clicking an enemy does not target it; it is always attack-move to that tile, while the cursor says "attack".
6. **Endings lack ceremony.** Victory and defeat are small silent modals, with four different names for each outcome across the moment, the feed, the end panel and the debrief.

None of the top interaction and HUD problems needs a sim change, except targeted fire and vehicle separation, which are flagged for the lead in §7. The first two polish stages can start on presentation alone.

---

## 2. Baseline (plan §1)

### Local, on this worktree at `79e528c4`

| Check | Result | Time | Notes |
|---|---|---|---|
| `pnpm test` | **pass** | 142 s | 418 files, 8,561 tests. Expected stderr from `loading.test.ts` (video cases). |
| `pnpm test:determinism` | **pass** | 4 s | Golden hash unchanged. |
| `pnpm typecheck` | **pass** | 10 s | |
| `pnpm lint` | **pass** | 15 s | |
| `pnpm validate:data` | **pass** | <1 s | 131 files, palette keys resolved. |
| `pnpm validate:ui` | **pass** | 1 s | 140 files, 194 tokens; i18n: 135 files, no bare chrome strings. |
| `pnpm validate:meshes` | **pass** | 98 s | 87 mesh units, 28 decor, 12 props, 1 campaign world. Warnings only (see below). |
| `pnpm validate:audio` | **pass** | 1 s | 33 clips, 1 music track, 5 voice variants, all licensed. |
| `pnpm balance` | **pass** | 56 s | §5.7 targets met at base and max tier. |
| `pnpm playtest` | **pass** | 21 s | Every line as expected. Credit ladder 5,830 over 26 missions; roster max 31 (cap 150). |

Not run locally, by the adaptations: `pnpm ui:routes` and `pnpm golden-baseline`. They were read from CI instead.

### CI on `main`

- **Run 37510494347** (`79e528c4`, #415) and **run 37503056292** (`ae1b9820`, #413): every job is green — gates, determinism on Ubuntu, macOS and Windows, visual, and version.
- **`golden-baseline`, run 37510494347:**
  - All five gated scenarios PASS on `linux-x64-swiftshader`: `quiet` 0 px / 0.0001, `open-ground` 0 / 0.0000, `vehicle` 79 / 0.0058, `relief` 0 / 0.0000, `aftermath` 0 / 0.0000.
  - Every self-check PASS.
  - The campaign-board and menu-scene-host screen checks PASS.
  - `dusk` and `combat` are captured as report-only.
- **`ui:routes`:** "OK: one realm, two missions, no reload, nothing left behind".
- `main` has since moved to `d7cc3d60`, a v0.121.6 release commit only.

### Classification

- **A (pre-existing failures): none.** Every check passes locally and on CI. Warnings worth recording, none failing:
  - `validate:meshes` drops an unroled `Icosphere` from `at_team`, `atgm_cell` and `breach_team` before rendering.
  - The field-works buildings (`kdf_intel_centre`, `kdf_medic_station`, `kdf_outpost`, with their construction and wreck variants) have no `data/structures.json` entry, so their wall role defaults to `limestone.4`.
  - Several textured buildings carry no `glass` role, so the facing gate cannot judge them.
- **B (introduced by polish): none.** This branch changes no code.
- **C (polish defects): the 30 rows in §5.** They are the work items.

---

## 3. What has already landed, so this audit judges the current build

From HANDOVER §4, verified on screen where the walk reached it:

| Landed | Seen in the walk |
|---|---|
| **#342** fire link: pulse ring, hit flash, "Engaging: X" on the card, MG fire as streaks | Yes. The card's "Engaging" line, pulse rings and tracers ([play-08](before/play-08-first-firefight.jpg), [play-34](before/play-34-clicked-target-not-engaged.jpg)). |
| **#354** bigger rings and contact marks (GH-346) | Yes. Team rings read on sand and in shadow; red diamonds and chevrons mark contacts. |
| **#357 / #361 / #365** first session: 9 beats, First Light cut to two problems, Conduct invoice, defeat clarity, first-time hints | Yes. All nine beats were played. The invoice was **not** reached (PA-12). |
| **#364** commander HUD mock (lead chose B) | Mock only. The commander HUD (HERO #298) is not built, so B3 in the plan has no implementation to judge yet. |
| **#376** garage upgrade emblems, **#380** stale-image fix | Garage screens look finished ([shots-03](before/shots-03-brigade.jpg)). |
| **#382 / #387–#394** a distinct map for every mission | First Light (`marj_perimeter`), Recon and the tutorial ground were all different. |
| **#384** menu tiles (option B) | Yes ([shots-01](before/shots-01-menu.jpg), [play-38](before/play-38-menu-after-progress.jpg)). |
| **#386** dawn and dusk light rotation | First Light is at dawn. The compound sits in long shadow, which hurts unit readability (PA-24). |
| **#400–#415** infantry motion, halt and kneel to fire, ground contact | Kneeling fire and grounded feet were visible. No sliding infantry was seen. |

---

## 4. Before-screenshots (plan §2's list)

| State | Capture(s) |
|---|---|
| Main menu | [shots-01-menu](before/shots-01-menu.jpg) (first visit), [play-38](before/play-38-menu-after-progress.jpg) (after two missions) |
| Campaign | [shots-02-campaign](before/shots-02-campaign.jpg), [play-39](before/play-39-campaign-after-progress.jpg) |
| Brigade | [shots-03-brigade](before/shots-03-brigade.jpg) |
| Briefing | [play-01](before/play-01-tutorial-briefing-on-open.jpg) (as it opens), [play-18](before/play-18-first-light-briefing.jpg), [shots-05](before/shots-05-briefing.jpg) |
| Deployment | [play-27-deploy-roster-veterans](before/play-27-deploy-roster-veterans.jpg) |
| Battlefield idle | [shots-06-hud-idle](before/shots-06-hud-idle.jpg), [play-02](before/play-02-tutorial-first-frame.jpg), [play-19](before/play-19-first-light-first-frame.jpg), [play-37](before/play-37-free-play-first-frame.jpg) |
| Selected infantry | [play-04](before/play-04-select-squad-card.jpg), [shots-07](before/shots-07-hud-selection-squad.jpg) |
| Selected vehicle | [play-29](before/play-29-vehicle-selected.jpg) |
| Mixed / group selection | [shots-08](before/shots-08-hud-selection-mixed.jpg), [play-31](before/play-31-box-select-14-units.jpg) |
| Movement command | [play-05](before/play-05-move-cursor-before-order.jpg) → [play-06](before/play-06-order-ack-150ms.jpg) (infantry), [play-30](before/play-30-vehicle-move-ack.jpg) (vehicle), [play-32](before/play-32-group-advance-ring-clutter.jpg) (group) |
| Combat | [play-08](before/play-08-first-firefight.jpg), [play-23](before/play-23-first-light-late-fight.jpg), [shots-11](before/shots-11-hud-combat.jpg), [play-33](before/play-33-vehicles-interpenetrate.jpg) |
| Suppression / major event | [shots-28-pinned-card](before/shots-28-pinned-card.jpg), [play-22](before/play-22-alert-stack-broken-jeep.jpg) (BROKEN), [play-35](before/play-35-vehicle-kill-frame0.jpg) → [play-36](before/play-36-vehicle-kill-2s.jpg) (vehicle kill), [play-15](before/play-15-mortar-impact.jpg) |
| Objective update | [play-13](before/play-13-objective-complete-feed.jpg), [play-21](before/play-21-objective-complete-and-waves.jpg), [shots-19](before/shots-19-objectives.jpg) |
| Alert | [shots-18-hud-alert](before/shots-18-hud-alert.jpg), [play-22](before/play-22-alert-stack-broken-jeep.jpg) |
| Minimap | Every battlefield capture (bottom right), [shots-23-minimap-ping](before/shots-23-minimap-ping.jpg) |
| Pause | [shots-15-pause](before/shots-15-pause.jpg), [play-41](before/play-41-pause-in-mission.jpg) |
| Victory | [play-24](before/play-24-first-light-victory-moment.jpg) → [play-25](before/play-25-first-light-end-screen.jpg), [shots-24](before/shots-24-outcome-victory.jpg), [play-16](before/play-16-tutorial-victory-panel.jpg) |
| Defeat | [shots-25-outcome-defeat](before/shots-25-outcome-defeat.jpg) → [shots-16-end-defeat](before/shots-16-end-defeat.jpg) |
| Debrief | [play-26](before/play-26-first-light-debrief.jpg), [play-17](before/play-17-tutorial-debrief-overlaps-tooltip.jpg), [shots-17](before/shots-17-debrief.jpg) (defeat) |
| Veteran / unit info | [play-28-veteran-card](before/play-28-veteran-card.jpg), [play-27](before/play-27-deploy-roster-veterans.jpg) |
| Settings | [shots-12-settings](before/shots-12-settings.jpg) |
| Also | Keys card [shots-20](before/shots-20-keys.jpg) · tooltip [shots-21](before/shots-21-tooltip.jpg) · dock [shots-26](before/shots-26-dock-kitted.jpg) · Free Play [shots-04](before/shots-04-sandboxes.jpg) · credits [shots-13](before/shots-13-credits.jpg) · saves [shots-14](before/shots-14-saves.jpg) · order through a building [play-40](before/play-40-order-through-building.jpg) |

---

## 5. Defect table

**Priority** is player impact × frequency × visibility (plan §2):

- **P0** blocks commercial release.
- **P1** strongly damages perceived quality.
- **P2** is noticeable but not blocking.
- **P3** is minor.

**Cost:**

- **S** is under a day.
- **M** is a few days.
- **L** is a week or more, or needs assets.

**"SIM"** marks a defect whose root fix needs a sim change, which needs the lead's approval.

| ID | Area | Problem | Player impact | Frequency | Severity | Cost | Priority | Status (9 Oct) |
|---|---|---|---|---|---|---|---|---|
| PA-01 | Copy / HUD | Debug language reaches players. **Every unit card and fire panel** shows raw weapon ids: `gun_120`, `coax_mg`, `pintle_mg`, `rws_50`, `mortar_60` (`hud.card.weapon` prints `w.id`). **Every briefing** shows "MESHES ONLY" (the loading counter). F1 lists "Toggle the debug overlay". **Every victory** feeds "campaign ledger updated". Free Play's flag labels read "synthesised 4×4" and "the kit sign on the unit icons and the HUD card to walk". The fallbacks "{id} — no portrait" and "art failed to load … see the console" can also reach the player. | Reads as a dev build on the first selection. §22 blocker. | Always | High | S | **P0** | **DONE** #425: weapon names through `t()`, loading counter, F1 debug row, "ledger", Free Play flags; `player-wording.test.ts` deny-list. Dock raw id #428. |
| PA-02 | Audio | Important audio is placeholder or missing. `ui_alert` and `ui_objective` have no clips, so they play oscillator beeps (`audio.ts` `playUi`). Victory and defeat have no cue. 4 of 40 voice lines are recorded (D5 licence open). Announcements are caption-only. One music track serves the whole game. All 33 SFX clips come from `tools/gen_audio.py`. | The game sounds unfinished at the moments meant to feel biggest. §22 blocker. | Always | High | L (assets + D5) | **P0** | **PARTIAL**: tiered cues, victory/defeat/objective stingers, mix #426; ambience beds #438. Music beds #493 (AU-7); voice director v2 and audio provenance and credits #497 (AU-5, AU-10). Left: 36 of 40 voice takes (AU-6, blocked on recordings and D5). |
| PA-03 | Camera | Pan speed is per **frame** (`0.5 × cameraSpeed / zoom` tiles a frame in `main.ts`'s loop): it doubles on a 120 Hz display, and it starts and stops instantly. Measured: about 28 tiles a second on each axis. A 1.5 s hold of D in the tutorial's first beat crossed the whole 48-tile map ([play-03](before/play-03-pan-overshoots-off-map.jpg)). | The very first thing the tutorial asks for feels twitchy, and speed varies by machine. | Always | High | S | **P1** | **DONE** #422: time-based eased pan, same distance at any refresh rate. |
| PA-04 | Camera | Nothing keeps the camera on the map: no clamp exists anywhere in `main.ts` or the renderer. The view can be panned into empty space, and the minimap is the only way back ([play-03](before/play-03-pan-overshoots-off-map.jpg)). | Players lose the battlefield within the first minute. | Often | High | S | **P1** | **DONE** #422: view clamped to the map plus 96 px, on every player camera move. |
| PA-05 | Objectives | First Light has no visible countdown once the evacuation completes. `survive_relief` is `clock: false` (#357's one-countdown ruling), so its label shows a static "5:00". The strip, the centre clock and the pause menu all show no time for the last ~4:30 of the second mission every player meets ([play-21](before/play-21-objective-complete-and-waves.jpg), [play-41](before/play-41-pause-in-mission.jpg)). | The hold feels endless, and "5:00" reads like a broken timer. | Always (First Light) | High | S (needs the lead's ruling) | **P1** | **DONE** #424: the hold clock returns once the evacuation completes; static "5:00" dropped. |
| PA-06 | Alerts | The feed stacks identical lines ("under fire — 1 unit" ×4) with no unit name or place. "enemy reinforcements — N units inbound" gives no direction. Up to four lines pile up mid-bottom over the battlefield ([play-22](before/play-22-alert-stack-broken-jeep.jpg), [play-23](before/play-23-first-light-late-fight.jpg)). | Alerts are noise, not glanceable. The player cannot act on them. | Often | High | M | **P1** | **DONE** #428: repeats merge ("x4"), unit and bearing, wave entry point, three tiers, Space jump. Enemy-kill lines #432. |
| PA-07 | Outcome | Victory and defeat are small, silent modals. One outcome carries four names: victory is "OBJECTIVE SECURED" (moment), "MISSION ACCOMPLISHED" (feed), "Town is quiet" (end panel; also used for the training ground) and "Named in brigade orders" (debrief). Defeat is "ATTEMPT FAILED", "MISSION FAILED", "FAILED — every unit lost" and "Withdraw and regroup". | The win does not land, and the screens disagree. §22 "victory/defeat feels like a debug state". | Always | High | M | **P1** | **DONE**: one name per outcome #425; outcome cue #426; after-action report with one primary action #442; end actions always reachable #434; the held victory/defeat beat #491. |
| PA-08 | Input | Right-clicking an enemy does not target it. Every right-click is attack-move to a tile (`intents.ts`), and the sim chooses the target. A clicked AA gun truck got "Engaging: Militia Cell" ([play-34](before/play-34-clicked-target-not-engaged.jpg)), yet the cursor reads `attack-armour` over the enemy, and tutorial beats 6 and 9 say "right-click the target". There is no move-only verb, although the sim's `move` command exists. | The click does not do what the cursor promised. Disengaging is impossible. | Often | High | M; targeted fire is **SIM** | **P1** | **DEFERRED** Stage 4 #420 (targeted fire is SIM). Interim #427: cursor reads "advance", fire panel says each unit picks its own target. No move-only verb yet (Lead decisions, L1). |
| PA-09 | Selection | A group selection draws every unit's range ring and every order line: 14 overlapping grey rings plus 14 lime lines for one order ([play-31](before/play-31-box-select-14-units.jpg), [play-32](before/play-32-group-advance-ring-clutter.jpg), [shots-08](before/shots-08-hud-selection-mixed.jpg)). | It hides the ground the player is ordering onto. Multi-selection is not legible at a glance (A1). | Often | High | S | **P1** | **DONE** #424: one range envelope plus one preview, one route per order, primary ring lightened. |
| PA-10 | Movement | Vehicles in a group pile up and interpenetrate: Lavi, Namer and Eitan meshes clip through each other in a fight ([play-33](before/play-33-vehicles-interpenetrate.jpg), [play-36](before/play-36-vehicle-kill-2s.jpg)). | The most visible "prototype" tell in combat. | Often (armoured groups) | High | L, **SIM** (vehicle separation) | **P1** | **DEFERRED** Stage 4 #421 (vehicle separation is SIM). |
| PA-11 | Tutorial | The Conduct tooltip that beat 9 opens stays pinned over the end panel and the debrief header ([play-16](before/play-16-tutorial-victory-panel.jpg), [play-17](before/play-17-tutorial-debrief-overlaps-tooltip.jpg)). | A visible UI collision in the first four minutes. | Always (tutorial) | Med | S | **P1** | **DONE** #432: the Conduct invoice closes when the result is in. |
| PA-12 | Tutorial | Beats 6 and 9 end on their timers, not on the lesson. Beat 6 says "stay still": the squad is on attack-move and keeps "moving", so it cannot comply. In beat 9 the mortar walks toward the clinic instead of firing from range, so no Conduct event fires and the invoice, the beat's whole point, never appears. The tutorial then ends "Town is quiet — Victory" with "enemy forces withdrew (1)". | Two of nine lessons do not land, including the game's distinguishing mechanic (Conduct). | Often | High | M (data and app; full fix tied to PA-08) | **P1** | **DONE** (data-only interim, `polish/first-timer`): neither beat ends on a timer any more. Beat 6 says press H and clears on a halt, a hover the fire panel words with odds, and a shot. Beat 9's mortar arrives on the road inside its own sight of the clinic diggers and outside its minimum range; the beat says press H and clears on a halt or order, a Conduct line, and its 12 s floor. Headless walk: 30 of 30 seeds bill a round into `z_clinic` with the drone dead, 13–58 s after the beat opens; one Metal browser walk billed 26 s after the order, where the same walk on `main` took 74 s and needed the drone to spot ([after](after/first-timer/)). Left: the bill and the tutorial's end land together, so the invoice is read on the debrief, not in the field; targeted fire stays #420. |
| PA-13 | Briefing | The briefing opens scrolled. `deploy.focus()` on mount scrolls the page, so the "DEPLOYING" label and the top of the title sit above the viewport at 1920×1080 (measured top −29 px). An empty black video slot shows top right while loading ([play-01](before/play-01-tutorial-briefing-on-open.jpg), [play-18](before/play-18-first-light-briefing.jpg)). | The first screen after "Start" looks broken. | Always | Med | S | **P2** | **DONE** #439 (safe centring, `preventScroll`, sticky Deploy) and #442 (Field order sheet). |
| PA-14 | Input | Right-clicking a tall building's upper facade resolves to the ground behind it. The cursor reads `move`, and the unit drives behind the building ([play-40](before/play-40-order-through-building.jpg)). Garrison registers only on the lower footprint. Tutorial beat 7 took two clicks. | An urban order goes somewhere unseen. | Often (towns) | Med | M | **P2** | **DONE** #427: `structureAtScreen` resolves a wall click to its building. |
| PA-15 | HUD | Suppression shows as a raw percent over 100 ("suppression 170%", "106%"). Fire-panel factors do not say whose they are: "suppressed −20%" is the **shooter's**. "Out of range or out of sight" does not say which ([play-09](before/play-09-fire-panel-cover.jpg), [shots-28](before/shots-28-pinned-card.jpg)). | Internals are shown instead of a decision (B4). | Often | Med | S | **P2** | **DONE** #445: state words and costs ("aim -48%"), "them / us" factors, out-of-range split into five reasons. |
| PA-16 | HUD | Under every selection, in every mission, a permanent hint line reads "the order row above has what this selection can do · click a chip to narrow it". A controls strip sits under it. The selection card (460 px) plus the order row cover the bottom centre. | Tutorial scaffolding never leaves. Level-3 text sits in a level-1 position. | Always | Med | S | **P2** | **DONE** #428: the hint line retires after the first session that showed it. |
| PA-17 | HUD | The hold-zone overlay is a saturated lime fill over most of the screen, washing out units ([shots-26](before/shots-26-dock-kitted.jpg), Foothold). | The objective hides the fight inside it. | Sometimes (hold missions) | Med | S | **P2** | **DONE** #475: the 0.12 fill is gone; a depth-tested hatched band 0.5 tile inside the edge. |
| PA-18 | Selection | The control-group badge draws as a large lime disc on every grouped unit. The numeral is unreadable at the default zoom ([shots-07](before/shots-07-hud-selection-squad.jpg), [shots-09](before/shots-09-hud-zoom2.5.jpg)). | Blobs over the units. | Often (group users) | Med | S | **P2** | **DONE** #427: numeral draws above its disc (band 4.5), opaque disc with halo. |
| PA-19 | Combat feedback | A vehicle kill reads as a brown dust puff, then a dark wreck. No feed line marks enemy kills, and the fire panel lingers on the dead target ([play-35](before/play-35-vehicle-kill-frame0.jpg) → [play-36](before/play-36-vehicle-kill-2s.jpg)). | Major events are under-tiered (C3). | Often | Med | M | **P2** | **DONE**: enemy-kill feed line #432; explosion strength ladder and collapse flash #460; damage smoke #445; the kill's fireball now draws above its own dust shroud (band 5.5, like the collapse flash), and the fire panel and "Engaging" clear on the tick the target dies, not on the next 4 Hz rebuild (PA-19 PR, [before/after](kill-read/pa19-kill-fireball-before-after.jpg), [death tick](kill-read/pa19-ui-death-tick.jpg)). The wreck is still the same parts slumped and charred (D1, an art pass). |
| PA-20 | Campaign board | Pin labels overlap ("Qarn Hadid", "Umm Zeitoun") and sit on the terrain with no backing. The status line under the theatre cards is clipped behind the Main Menu button. Nearly all text is set in mono. There is no explicit "next operation" call to action ([shots-02](before/shots-02-campaign.jpg), [play-39](before/play-39-campaign-after-progress.jpg)). | The war map looks like a prototype board. | Always | Med | S–M | **P2** | **DONE**: campaign cards and prose in the body face #448. Small-batch PR: pin labels sit on a token-coloured plate, and the collision box now spans the ring, the 14 px offset and the label (no overlap at any of 12 bearings, 1440x900), and the status line is the footer's own row, above Main Menu at 720, 768, 900 and 1080 high (`after/pa20/`). Last: `polish/ux-small-2` added the one primary "Next: <mission name>" button to the footer (`nextOperation`, `campaign.ts`), hidden once the campaign is complete, and the status line's "worst ..." clause names the mission, not its id ([before](after/ux-small/before-board-1440x900.jpg), [after](after/ux-small/after-board-1440x900.jpg)). |
| PA-21 | Debrief / end | The end panel and debrief draw over the radio panel, and their text collides ([play-26](before/play-26-first-light-debrief.jpg), [shots-17](before/shots-17-debrief.jpg)). The rows "Marked", "Promoted" and "Nineteen still out." are unexplained. The "Lavi MBT available … (9 lines)" list does not say these are unlocked to buy, not deployable. "Remaining enemy forces withdrew (8)" is set in mono. | The debrief does not say clearly what changed (H5). | Always | Med | S–M | **P2** | **DONE** #442: opaque blurred backdrop, three columns, "Can now be bought ... not added to your force", losses and promotions by name. |
| PA-22 | Visual system | Three type families with no visible rule: display (Big Shoulders), body (Barlow), and mono (IBM Plex Mono) used for body copy on the board, the deploy panel and the end panel. End-screen buttons are lower case ("debrief", "next mission", "replay") while menus are upper case. | Screens look like they came from different passes (B2). | Always | Med | M (after the D1 register) | **P2** | **DONE** #448 (one register, VR-16..VR-21) and #454 (button case). |
| PA-23 | Accessibility | Unit voices are Hebrew and Arabic, but voice captions are **off** by default (`DEFAULT_SETTINGS.accessibility.captions: false`). Check the earlier D8 caption ruling before flipping it. | Voice lines carry no meaning for most players. | Always | Med | S | **P2** | **DONE** (9 Oct): `DEFAULT_SETTINGS.accessibility.captions` is `true`, a save that carries no `captions` key takes it, and a stored `false` stays (the player's own choice). Supersedes the D8 "off by default" ruling for the default only (lead L2, 2026-10-09); the toggle and the always-captioned announcements (A5) are unchanged. |
| PA-24 | Environment | First Light's dawn light leaves the compound interior in long, deep shadow. Units there read only by their rings ([play-22](before/play-22-alert-stack-broken-jeep.jpg), [play-23](before/play-23-first-light-late-fight.jpg)). | Mood at the cost of readability, in mission 2. | Always (First Light) | Med | S–M (exposure and haze per mission) | **P2** | **DONE** #491 (L3 answered yes): a lifted fill for First Light alone, keeping the dawn mood. |
| PA-25 | Free Play | The menu entry "Free play — any map" opens a list of developer flag checkboxes. In the sandbox the strip reads "ROARING LIONS", not the map name. There is no objective, and the feed stays empty while units die ([shots-04](before/shots-04-sandboxes.jpg), [play-37](before/play-37-free-play-first-frame.jpg)). | A player-facing mode presented as a dev tool. | Sometimes | Med | S | **P2** | **DONE**: strip names the map #432; options behind a disclosure #425; leave wording #453 (K-13); the strip says "Free play — no objectives · Escape for the menu" and the feed carries the alert layer's ordinary lines (under fire, enemy destroyed, lost), `polish/first-timer` ([after](after/first-timer/after-freeplay-1-after-fight.jpg)). Last: `polish/ux-small-2` made the picker a set of map cards (name, one line, the map painted a pixel a tile; the flags under a closed "Options" disclosure, labels named in the flag table) and a Free Play leave lands on `/free-play` ([before](after/ux-small/before-picker-1440x900.jpg), [after](after/ux-small/after-picker-1440x900.jpg)). |
| PA-26 | Deployment | "Confirm your force" rows do not say what a click does, and a dimmed row (slots full) is unexplained. "What you brought · Conduct 100" reads oddly. "Optional · no carry-over" is jargon ([play-27](before/play-27-deploy-roster-veterans.jpg), [play-01](before/play-01-tutorial-briefing-on-open.jpg)). | Deployment reads as a spreadsheet, not a decision (H2). | Always (campaign) | Low–Med | S | **P2** | **DONE** #442 (force cards and bench), #453 (why Deploy is locked, K-11), #425 (wording). |
| PA-27 | Error states | The code path still allows a lost click: the Deploy button is mounted, enabled and focused before its listener exists (`loading.ts` attaches it inside `done()`). CLAUDE.md records 7 lost early clicks on a warm cache. **Not observed now:** this walk's first click deployed, and every deploy gate in the last two CI runs cleared on 1 click. | A first click that would do nothing, if loading ever outlasts the reader. | Not observed | Med | S | **P3** | **DONE** (small-batch PR): the listener is attached where the button is made; a click before `done()` is kept and `done()` honours it. Seen red first. |
| PA-28 | Veterans | "Lost: Rifle Squad ×2, Shoded Jeep ×1" names types, not the named veterans the deploy screen just introduced. Promotions are a bare count ("Promoted 5"). On the unit card the veteran's name ("Sela") is a small amber word set before the much larger type ([play-28](before/play-28-veteran-card.jpg)). | Veteran identity breaks at the moment it should matter (H6). | Always | Low–Med | S | **P3** | **DONE**: losses and promotions by name in the report #442; small-batch PR: a named veteran now leads the unit card at the title size, the type beside it smaller. Built without a mock, so the lead's picture review of the card is still owed. |
| PA-29 | Credits | A stale credit says the Namer was "rendered into … sprite sheets (NAMER_HULL, NAMER_TURR)", but the sheets were deleted in A3.3. The OFL text is dumped raw ([shots-13](before/shots-13-credits.jpg)). | A licensing record that is wrong, plus visual noise. | Rare | Low | S | **P3** | **DONE** (small-batch PR): the Namer credit is removed on the lead's ruling (L4), and the OFL text is reflowed into paragraphs under a collapsible block, every word kept (a test compares each shipped file). |
| PA-30 | Menu | The first mission is named "Beit Sahwan 0 — Working Up" (ordinal 0). The audio toggle uses a lightning icon. The version string shows on the title lockup. | Small finish details. | Always | Low | S | **P3** | **DONE** (9 Oct, lead L5): the mission's shown `name` is "Working Up" (data string; id, file name, ledger, saves, telemetry and URLs unchanged), so the Start tile reads "Start — Working Up"; the version stays on the title lockup. The audio glyph is a speaker since #459. |
| PA-31 | Combat feedback | A pinned infantry team lies in its own corpse pose. `resolveClip` played `down` for pinned and for a broken unit standing still, and on 17 of the 20 infantry GLBs that carry `down` it is keyframe-identical to `wreck` (`rig.py`'s `build_death_clip`). The only tell is a bar over it ([combat-states 01](combat-states/01-today-pinned-reads-dead.jpg)). Added 7 Oct by pass C2/C4. | "Alive but losing effectiveness" reads as dead: the most common combat state in the game is misread. | Often | High | M | **P1** | **DONE** #445: a `pinned` huddle clip on 17 rigs; `living_not_wreck.test.ts` was red on 14 drawn files on main. |
| PA-32 | Combat feedback | The rifle squad's own `down` (a Meshy capture) kneels with both hands raised: pinned reads as surrender ([combat-states 02](combat-states/02-posture-ladder.jpg)). Added 7 Oct by pass C2/C4. | The player's own squad looks like it gave up. | Often | Med | S | **P2** | **DONE** #445: pinned no longer plays `down`, so the surrender pose is retired. |
| PA-33 | HUD | Selection chips never show a mobility or firepower kill: a Lavi with its gun knocked out reads "APS 3/3" in a group, and the world marks for both are 3 px dots ([combat-states 05](combat-states/05-selection-chips.jpg)). Added 7 Oct by pass C2/C4. | A vehicle that can no longer fight looks fine until it is selected alone. | Sometimes | Med | S | **P2** | **DONE** #445: chips lead with broken, pinned, out of action, gun out, immobilised; two new marks. |

Two observations made no row:

- Infantry motion and the menu scene host look finished.
- The garage is the most polished screen in the game. Its only visible nit is a specification list clipped by the description ([shots-03](before/shots-03-brigade.jpg)).

---

## 6. First ten minutes: friction log (plan §15)

New campaign from a clean profile, at 1920×1080, all through the UI. Times are game clock.

**0:00, menu.** The primary tile reads "START — BEIT SAHWAN 0 — WORKING UP", which is clear enough to click. "Beit Sahwan 0" is an odd name (PA-30).

**Briefing.**

- The page opens scrolled, with its header cut off.
- "MESHES ONLY" sits under the title.
- A black video box shows top right.
- MISSION and NOTES are empty for the first second, while beats fade in.
- The objective list says "Optional · no carry-over" (PA-13, PA-26, PA-01).

Clicking Deploy at about 1.5 s worked first time.

**Tutorial (finished at 3:28 by the debrief's clock):**

1. **Look around.** I held D for 1.5 s, and the map vanished: the camera flew past the edge into empty space ([play-03](before/play-03-pan-overshoots-off-map.jpg)). I clicked the minimap to recover, which the beat had suggested. Pan is fast, sudden and unbounded (PA-03, PA-04).
2. **Take command.** Clicking the squad selected it, and the card appeared with a weapon range polygon. Clear.
3. **Advance.** Right-click on the marked ring. Acknowledgement was immediate: a lime path line, a destination marker and a Hebrew voice line (no caption, PA-23). Good.
4. **Make contact.** The "Contact east, in the open" notice and the red contact mark were clear ([play-07](before/play-07-first-contact.jpg)). Right-clicking past him triggered "Four contacts on the range" and "Second rifle squad arrives". The beat completed within seconds.
5. **Read before you fire.** I hovered the four enemies. The panel was useful, but dense:
   - "Rifle Squad 4% rifles · cover −91% · suppressed −20%": whose suppression?
   - "Out of range or out of sight": which?

   Moving targets drift from under the cursor. It took about a minute (PA-15).
6. **Identify, then shoot.** I could not satisfy "stay still": my squad was still on its attack-move and the card said "moving". The beat ended on its 60 s timer (PA-12).
7. **Use the ground.** My first right-click on the house's upper wall was a `move`, not a garrison, and the squad started for the ground behind the house. The second click, lower on the footprint, garrisoned (PA-14; [play-10](before/play-10-garrison-misclick.jpg) → [play-11](before/play-11-garrisoned-jeep-arrives.jpg)).
8. **Bring them in.** Near the civilians the cursor showed `protected`, because the clinic stands beside them. That is alarming, but the order went through. The civilians ran, boarded and reached the refuge ([play-12](before/play-12-civilians-run.jpg)). "OBJECTIVE COMPLETE — Bring the two civilians to the refuge" landed as a satisfying moment.
9. **What a shot costs.** The panel gave the mortar 2% on the clinic digger ([play-14](before/play-14-mortar-fire-panel.jpg)). The mortar walked forward instead of firing from range, and no Conduct event happened. The invoice never opened, and the beat ended on its timer (PA-12, PA-08).

**Tutorial end.**

- The panel read "TOWN IS QUIET · VICTORY" with "Remaining enemy forces withdrew (1)".
- The Conduct tooltip stayed stuck over the debrief header (PA-11).
- The debrief rows "Marked 3", "Promoted 5" and "Nineteen still out." were not explained (PA-21).
- "next: Beit Sahwan — First Light →" was a clear next step.

**First Light (5:00).**

- The briefing reads well, and the NOTES line ("a family runs for the compound once one of ours is within four tiles") is the most useful sentence in the session.
- The first frame shows a title card, "2 PRIMARY OBJECTIVES", the radio, and two clocks: "4:30" in the strip and a large "4:30" in the centre. Clear.
- I sent the jeep and the APC to two villages ([play-20](before/play-20-first-light-evac-run.jpg)). Both loaded civilians on arrival, and "OBJECTIVE COMPLETE — Get two families inside the wire" came within about 25 s. A good moment.
- **From then on there was no clock anywhere.** The hold objective said "Hold until the relief column, 5:00" and did not count. I opened pause to check the time; it showed none either (PA-05).
- The feed stacked "under fire — 1 unit" four times, plus "enemy reinforcements — 5 units inbound" with no direction. The jeep went "BROKEN · suppression 170%" (PA-06, PA-15).
- The compound interior is in dawn shadow, and units read mostly by their rings (PA-24).
- Victory came at 5:00 with a dimmed screen and "OBJECTIVE SECURED · +180 credits", silent. The end panel then said "TOWN IS QUIET" (PA-07, PA-02).
- The debrief listed nine "X available" lines, which I took to mean I now had a Lavi. I did not: the next mission's force was fixed (PA-21).

**Beit Sahwan I.** The deployment panel showed four named veterans with stars and kill counts, a good start for H6. It did not say what clicking a row does (PA-26). In the mission:

- The veteran card showed "Sela · Rifle Squad ★ · 1 mission · 0 kills".
- The Lavi's card showed `gun_120 — 9.6/12 tiles · 1300mm pen` (PA-01).

**Did it meet §15?**

- **0–1 min:** what the game is and who I control was clear, but the camera fought me.
- **1–3 min:** select, move and attack all worked, with good immediate feedback.
- **3–5 min:** cover and threat were taught, but the "stay still" and "Conduct" lessons did not land.
- **5–10 min:** First Light gave a meaningful objective and a satisfying evacuation. Then four minutes of untimed holding, and a victory with no ceremony.

---

## 7. Commercial polish score, first pass (plan §16)

Target: no category below 4, most at 4.5 or above.

| Category | Score | Why |
|---|---|---|
| Input feel | **3** | Orders acknowledge instantly (path line, marker, voice). But there is one verb (attack-move), a right-click on an enemy is not a target, and building picks miss (PA-08, PA-14). |
| Selection | **3.5** | Team rings and contact marks read well on any ground (#354). Group selection is cluttered with rings, lines and lime badge blobs (PA-09, PA-18). |
| Camera | **2** | Frame-rate-dependent, instant, overshooting pan, with no map bounds (PA-03, PA-04). Zoom to cursor and minimap jump work. |
| Combat feedback | **3** | Tracers, hit flash, pulse ring, blasts and a readable fire panel. Kills are under-tiered, and suppression shows as raw percentages (PA-19, PA-15). |
| HUD | **3** | An edge-anchored, mostly calm layout. Raw ids, alerts with no place, a permanent hint line and a garish hold zone (PA-01, PA-06, PA-16, PA-17). |
| Visual identity | **3.5** | The lit renderer and textured assets give a coherent register. Typography has no rule across screens (PA-22). |
| Environment | **3.5** | Ground, props, haze and distinct maps are good. First Light's dawn shadow is answered by a lifted fill (#491, PA-24). |
| Audio | **2** | Placeholder UI tones, no outcome cue, 4/40 voices, one music track, procedural SFX (PA-02). |
| Briefing | **3.5** | Well structured, with portraits and a ground preview. It opens scrolled and clipped and shows "MESHES ONLY" (PA-13). |
| Debrief | **3** | Rich data (Conduct, time, losses, credits, unlocks). Cryptic rows, overlaps, type names instead of veterans (PA-21, PA-28). |
| Campaign flow | **3.5** | Continue tile, "next mission" and the board all connect. The board has a "Next" button (PA-20); First Light's clock returned in #424 (PA-05). |
| Accessibility | **3** | Text size, interface scale, alternate team colours, motion setting, captions and rebinding all exist. Captions are off by default for foreign-language voices (PA-23). |
| Performance | **4** | Measured on an M3 Pro (PERFORMANCE.md: beit z0.5 GPU p95 14.67 ms; Qarn Hadid 14.86 ms, over its 14.5 ms ceiling, lead accepted). Not measured on low-end hardware. |

---

## 8. Proposed first work packages (§17 Stages 1–2), presentation only

Each package names its acceptance check. In this repository a check is not trusted until it has been seen to fail, so each one lists the input that turns it red.

### WP-P1: Camera feel and bounds (Stage 1; PA-03, PA-04)

- Pan in **tiles per second** from the frame's `dtMs` (clamped as `frameDtMs` already is), with a short ease in and out.
- Clamp the camera focus to the map rectangle plus a small margin.
- Pure maths in `ui/camera-input.ts`; `main.ts`'s loop calls it.

**Acceptance:**

- A unit test holds a pan for 1 s at 60 Hz and at 144 Hz and gets the same distance within 2%. Falsified by restoring the per-frame formula, which gives a 2.4× ratio.
- A unit test pins the focus inside bounds after 10 s of panning into each edge.
- Before/after captures of the tutorial's first beat: hold D for 3 s, and the map is still in view.

### WP-P2: Player-facing language sweep (Stage 2; PA-01, P0)

- Weapon display names through `t('weapon.<id>')`, with every `weapon.id` in `data/units/**` covered.
- Drop the loading counter's "meshes only / reading manifests" from the briefing.
- Take the debug-overlay row out of the player's F1 list.
- "campaign ledger updated" becomes a player phrase.
- Plain-language Free Play flags.
- Fallbacks that never print an id or "see the console".

**Acceptance:**

- A test that every weapon id in shipped unit JSON has a `weapon.*` key.
- A deny-list test over `en.json` values (`ledger`, `manifest`, `mesh`, `sheet`, `debug`, `console`, `synthesised`, and `_` inside a word). Falsified by putting one raw string back.
- A `--pseudo` `ui:shots` pass shows no raw id on the unit card or the fire panel.

### WP-P3: Group selection without clutter (Stage 1; PA-09, PA-18)

- With more than one unit selected, draw the range ring for the hovered or primary unit only.
- Draw one order fan or one line per group to the destination, not one per unit.
- Make the group badge numeral legible, or draw a ring tint instead of a disc.
- Renderer and app only.

**Acceptance:**

- A model test: overlay count for a 14-unit selection is at most 2 rings and 1 order marker. Falsified against the current one-per-unit path.
- Before/after captures of the sandbox box-select at the same tick, camera and zoom ([play-31](before/play-31-box-select-14-units.jpg), [play-32](before/play-32-group-advance-ring-clutter.jpg)).

### WP-P4: Orders that tell the truth (Stage 1; PA-08 in part, PA-14)

- Over an enemy, the cursor and its tooltip say what will happen: "advance and engage", not a targeted attack.
- A **move-only** modifier, for example Alt+right-click, that issues the sim's existing `move` command, for disengaging.
- Facade picking that resolves a click on a building's upper wall to that building (garrison) or marks it `blocked`, never the hidden ground behind it.

**Acceptance:**

- `resolve.test.ts`/`intents.test.ts` cases: Alt+right-click gives `verb: 'move'`. Falsified by removing the branch.
- A screen-point-on-facade test resolves to the structure.
- A drive with `__lions.hover`/`cursorKey()` over [play-40](before/play-40-order-through-building.jpg)'s point reads `garrison` or `blocked`.

**Needs the lead:** the key binding for move-only. Targeted fire is **SIM**; see below.

### WP-P5: Alerts with a place and a count (Stage 2; PA-06, PA-16)

- Coalesce identical feed lines within a window ("under fire ×4").
- Name the unit or type and give a compass bearing from the camera.
- Say where a reinforcement wave enters (its spawn marker is mission data the app already reads).
- Space jumps to it.
- Retire the permanent hint line after the first session (`hint-model.ts` already knows first use).

**Acceptance:**

- A feed-model test: 4 identical events in 2 s produce one line "×4". Falsified by removing the merge.
- A wave notice test names the marker's bearing.
- Before/after captures of First Light at the same tick as [play-22](before/play-22-alert-stack-broken-jeep.jpg).

### Flagged for the lead, not presentation-only

- **PA-05, First Light's hold clock:** reverses part of #357's "one countdown" ruling. The proposal is to show the hold clock once the evacuation objective is done. App and data only, but it needs a ruling.
- **PA-08, targeted fire:** "attack this unit" needs a sim command. Today's sim has `move` and `attackMove` only.
- **PA-10, vehicle separation:** units sharing tiles is sim movement. Presentation can only soften it.
- **PA-12, tutorial beats 6 and 9:** a full fix depends on PA-08. A data-only interim (beat text plus a mortar placement already in range) is possible.
- **PA-02, audio:** needs assets and the D5 licence. It belongs to Stage 5, not the first packages.

### Not assessed in this pass

- Save, load and overwrite reliability (Saves screen only).
- Low-end performance and unusual resolutions beyond the three `ui:routes` checks.
- Keyboard-only navigation through the HUD.
- Hearing the audio mix.

These belong to the Stage 7 release pass and a non-headless session.
