# Roaring Lions: error states and edge cases (pass K)

**Date:** 7 Oct 2026 (wave 2: 8 Oct) · **Base:** `62a7f3d3` (`main`) · **Plan:** [`commercial-polish-plan.md`](commercial-polish-plan.md) §14.

**The bar** (plan §14): every error says **what happened, why, and what to do next**, with no debug language. Each case below is judged against those three questions.

## How each case was checked

**Code.** Every case was traced from the input to the string the player reads, and each string was resolved through `packages/app/src/i18n/en.json`.

**Browser.** One browser walk covered the cases a code read cannot settle:

- one headless Chromium on ANGLE/Metal (M3 Pro), music off (`musicOffInitScript`)
- its own dev server on :5241, stopped by process group afterwards
- one context per case, `beit_sahwan_1_recon` as the mission

The faults were injected without touching the tree:

- **GLB 404:** `page.route` answered every `.glb` with 404.
- **Audio 404:** the same, for every audio file.
- **No WebGL2:** an init script made `getContext('webgl2')` return `null`.
- **Storage refusal:** `Storage.setItem` threw for `lions.saves`.
- **Resolutions:** viewport size; the resize case was a `setViewportSize` mid-mission.

The walk was run twice: on the base, then on this branch. Captures are in [`k/`](k/). The scratch driver is not committed.

**Not checked:**

- A real touch device.
- A GPU context lost mid-mission.
- Hearing the audio.

---

## Results

| # | Case | What the player got on `62a7f3d3` | Verdict | Now |
|---|---|---|---|---|
| 1 | No selection: right-click | Nothing: no intents, no sound, no note (`input/intents.ts:244`). The idle hint line already says "click/drag select · right-click attack-move …". | OK (the hint says what to do) | — |
| 1b | No selection: hotkeys | `f` "nothing selected that carries smoke", `g` "select a transport and the infantry to load". **`h` (halt) and `u` (unload) did nothing at all**, which reads as a dead key. | Defect K-04 | **Fixed** |
| 2 | Invalid command: impassable or off-map click | The hover cursor reads `blocked` (`input/pointer.ts:171`), but the click still drops an order marker with no note and no deny sound (`intents.ts:304-308`). Off the map the cursor even reads `move`. | Defect K-08 | **Fixed** (wave 2) |
| 2b | Invalid command: protected site | "protected site — hold Alt to order fire on it" plus `ui.deny`. | OK | — |
| 3 | Unavailable action: inert order chip | Tooltip "{label} — nothing in the selection would act on it right now" says *what*, not *why* (`ui/hud.ts:1904`). The inert halt and unload handlers were silent (see 1b). | Partial: K-09 | Handlers fixed; **tooltip fixed**: each inert verb says why ("no one is aboard", "nobody selected is moving or has a route queued", "no selected unit can board a transport") |
| 3b | Unavailable action: dock, locked unit | "**{name}** is locked — {reason}" from the gate copy. Gateless locks fall back to the sim's English. | OK | — |
| 3c | Unavailable action: dock, can't afford | "cannot build {name} — insufficient logistics" (`ui/production.ts:334`). It can be wrong: `requestBuild` also refuses on intel or an ended mission. No amount is shown, nothing says how long to wait, and there is no deny sound. | Defect K-10 | Open |
| 4 | Empty or full deploy slot | "{n} left to assign"; Deploy is `disabled` with no reason. A dimmed row (that type is full) refuses the click in silence (`ui/loading.ts:288, 322`). | Defect K-11 (PA-26) | **Fixed** (wave 2) |
| 5 | Save | New slot under a fresh id; overwrite cannot happen. Success printed **nothing**. | Defect K-05 | **Fixed** |
| 5b | Load | The confirm read "Replace your current campaign and brigade with this save?", without saying unsaved progress is lost. Success printed nothing. A storage refusal part-way said "the save may be incomplete", which is wrong for a load: the *active* campaign is what may be half-written. | Defect K-05 | **Fixed** |
| 5c | Delete or import refusal | Same "the save may be incomplete" line for every action. | Defect K-05 | **Fixed** |
| 5d | Corrupt slot | Skipped in silence; a corrupt whole blob reads "No saves yet." **The next save or delete rewrites only the slots that parsed, so a damaged slot is deleted for good** (`profile.ts:84-133`). | Defect K-12, data loss | **Fixed** (wave 2) |
| 5e | Storage unavailable (private window) | Saves screen: "Saves unavailable" / "This browser has no local storage this game can reach.", with no why and no next step. | Defect K-06 | **Fixed** |
| 5f | Storage unavailable: after a victory | The feed still said "**campaign saved** — survivors and Conduct carry forward" (`main.ts:3934`). A quota throw from `writeLedger` there was uncaught and could take the end screen with it. | Defect K-06 | **Fixed** |
| 6 | Leaving a mission (HUD leave, pause Quit) | "Leave the mission?" / "This attempt is lost. The campaign keeps everything from before it." Restart: "This attempt is lost." | OK. Free play also lands on the campaign map, where "the campaign keeps everything" means nothing. | K-13, minor | **Fixed** (wave 2): the wording; where leaving lands is still PA-25's |
| 7 | Victory | "Mission accomplished" plus summary plus "next mission". **At the end of a town, "next mission" just disappeared**, with nothing saying what to do (`campaign.ts` `nextMissionAfter` returns undefined). There is no campaign-complete line anywhere. | Defect K-07 | **Fixed** (town done); campaign complete open |
| 7b | Defeat and retry | "Mission failed" plus "try again". **The end screen never said why**: the cause ("Every unit lost · 3:12") appeared only in the transient outcome moment and the feed. Nothing said the campaign was unchanged. | Defect K-07 | **Fixed** |
| 8 | Missing optional audio | A 404 or undecodable clip falls back to the synth in silence (`packages/render/src/audio.ts:805-817`). A failing music track skips. An autoplay refusal is swallowed. Walk: one console 404 and nothing visible. | OK (audio is optional). The comment at `audio.ts:679` claims misses are "logged"; they are not. | K-14, comment, **fixed** |
| 9 | Asset load failure: a unit GLB | Proxy box, plus the feed line "**{name}** did not load and is drawn as a plain marker". | OK | — |
| 9b | Asset load failure: a building, decor, VFX or prop GLB | **The boot fails.** On a direct load, a mono page in failure red: "Boot failed", `Error: fetch for "http://localhost:5241/meshes/buildings/house.glb" responded with 404: Not Found`, a stack frame into `node_modules/.vite/deps`, and a browser-default blue underlined link ([before](k/before-glb-404.jpg)). **On a soft navigation** (a menu click, "next mission") the router rejected into `void router.navigate(…)` and left **an empty black stage with no words at all** (`shell/router.ts:347-352`). | Defect K-01, K-02 | **Fixed** ([after](k/after-glb-404.jpg), [soft nav](k/after-softnav-glb-404.jpg)) |
| 9c | Asset load failure: the wait | Every model downloads before `showLoading` (`main.ts:1827` vs 1957), so the stage is blank for the whole download, and the bar reads "Ready" at once. | Defect K-15 | **Fixed** (wave 2) ([after](k/after-download-progress.jpg)) |
| 10 | No WebGL2: menu, campaign board | The menu keeps its poster plate. The board falls back to the flat map ([capture](k/nogl2-campaign-flat-board.jpg)). Both are fully usable; console note only. | OK | — |
| 10b | No WebGL2: mission | `new ThreeRenderer` threw: "Boot failed" plus "Error: Error creating WebGL context." plus a seven-frame three.js stack ([before](k/before-nogl2-mission.jpg)), or a blank stage in-app. Nothing said what WebGL2 is or what to try. | Defect K-03 | **Fixed** ([after](k/after-nogl2-mission.jpg)) |
| 10c | Context lost mid-mission | No `webglcontextlost` handler anywhere, so a silent black canvas. | Defect K-16 | **Fixed** (wave 2); now reproduced with `loseContext()` ([after](k/after-context-lost.jpg)) |
| 11 | Browser resize mid-mission | The renderer follows its host (ResizeObserver). At 1920×1080 → 1100×1300 the HUD reflows and the objective ellipsises ([capture](k/resize-mid-1100x1300.jpg)). | OK | — |
| 11b | 1280×720 | Menu and mission fit; no horizontal scroll ([capture](k/mission-1280x720.jpg)). | OK | — |
| 11c | 3440×1440 | `--ui-scale` 1.4 (the 2400 px breakpoint). The HUD fits. At default zoom the map is a small island in a wide field of fog ([capture](k/mission-3440x1440.jpg)). | OK; composition note for pass E | — |
| 11d | 390×844 portrait | The menu overflows by 17 px. **The mission page scrolls sideways (821 px wide)**: the strip runs off the right edge, and the commander bar and the feed are cut off ([capture](k/mission-390x844.jpg)). There is no touch input for right-click or edge pan, and nothing says the game needs a mouse and a wider screen. | Defect K-17 | Open: **mock** ([mock](k/mock-k17-small-screen.jpg)), awaiting the lead |
| 12 | Unknown path | "No such screen" / "Nothing lives at {path}." plus a menu link, with no next step, on the same debug-looking page as 9b ([before](k/before-unknown-path.jpg)). | Defect K-02 | **Fixed** ([after](k/after-unknown-path.jpg)) |
| 12b | Unknown mission id | "Mission not found" / "This link points at a mission that does not exist in this build." | OK; restyled and given a next step with K-02 | **Fixed** |
| 12c | Unknown map in `/free-play/<id>` | A **different map loaded in silence**; the only word was a `console.warn`, and the sandbox strip names no map. | Defect K-18 | **Fixed** ([after](k/after-unknown-map.jpg)) |

---

## Fixed in this PR

All presentation, all in `packages/app`; no `packages/sim` change. Each check was seen red under a one-line mutation of the implementation, then green.

| ID | Fix | Files | Test, and the mutation that turned it red |
|---|---|---|---|
| **K-01** | A failed screen boot shows a card, not the exception. `bootFailureKind` sorts the error into `graphics`, `download` or `unknown`, and `bootFailureCard` words each as title, what-and-why, and next step. The full error still goes to the console. Applies to the direct-load path (`main().catch`) and to both battlefield routes. | `ui/boot-failure.ts` (new), `main.ts`, `en.json` | `ui/boot-failure.test.ts`: the three kinds, and a deny-list on the card text (`Error:`, URLs, `.glb`, `webgl`, `context`, stack frames). Card body set to the raw error → 4 red. Probe ignored → 1 red. |
| **K-02** | Soft-navigation boot failures no longer leave a blank stage. `guardBoot` answers a failed mount with the card. A superseded mount still rethrows to the router, as before. | `ui/boot-failure.ts`, `main.ts` | `guardBoot` specs. Always rethrow → 1 red. Verified in the browser: a menu click into a mission with GLB 404s now shows the download card. |
| **K-02b** | The error page is part of the game. Display-face title in `--bad-text`, body face in `--ink`, the next step in `--ink-mute`, and **Reload** and **main menu** as ordinary `.rl-btn`. No mono, no browser-blue link. Reload is offered only where trying again can help. The same card serves "No such screen", "Mission not found" and "Saves unavailable", each now with a next step. | `theme.css` (`.rl-boot-error*`), `en.json` | `mountErrorCard` specs (role `alert`, actions, no reload on a graphics failure). |
| **K-03** | No WebGL2 at mission start says so in plain words: "This browser cannot draw the battlefield … Turn on hardware acceleration … or open the game in a current version of Chrome, Edge, Firefox or Safari. Your campaign is kept on this device." It uses the probe the board and the scene host already ask (`ui/webgl-probe.ts`). | as K-01 | as K-01 |
| **K-04** | `h` with nothing of ours selected says "nothing of yours selected to halt — select units first". `u` with no loaded carrier says "nothing selected is carrying troops — select a loaded transport to unload". Mount and smoke already explained themselves. | `input/intents.ts` (`haltNote`, the dismount branch), `main.ts`, `en.json` | `input/resolve.test.ts`, two new cases. Both notes removed → 2 red. |
| **K-05** | The saves screen confirms what it did ("Saved as …", "Loaded … — it is now your campaign.", "Deleted …", "Imported …"). A storage refusal is worded per action: a load says the active campaign may be mixed and how to recover; a delete says the slot is still there. The load confirm adds "Progress that is not in a save is lost." | `ui/saves.ts`, `en.json` | `ui/saves.test.ts`, three assertions added. Refusal always worded as a save → 1 red. Success line removed → 1 red. |
| **K-06** | "Campaign saved" only when the write landed. With no storage, or a refused write (now caught, so the end screen still comes up), the feed says "**progress not saved** — this browser is not keeping site data … Allow this site to store data to keep it." | `main.ts`, `ui/mission-notice.ts` (`ledgerSavedNotice`), `en.json` | `mission-notice.test.ts`. Always "saved" → 1 red. |
| **K-07** | The end screen says what the result means. On a defeat: the cause, then "Nothing from before this attempt is lost. Try again with a new plan, or step back to the campaign map." On a victory with no next mission: "This town's operations are done. Choose the next one on the campaign map." | `ui/menu.ts` (`endScreenLines`, `EndScreenOptions.reason`), `main.ts`, `theme.css` (`.rl-endreason`), `en.json` | `ui/menu.test.ts`, two cases. Reason dropped → 1 red. |
| **K-18** | An unknown free-play map still loads the default ground (the stated design), but the feed says so: "The link names a map that is not in this build — showing **Beit Sahwan — Outskirts** instead. Pick a map from Free Play to change it." The id is not echoed back (PA-01). | `ui/mission-notice.ts` (`unknownSandboxMapNotice`), `main.ts`, `en.json` | `mission-notice.test.ts`, three cases. Always null → 2 red. |
| **K-08** | A click on rock, a wall or past the map's edge no longer confirms an order the ground refuses: no marker, the deny cue, a note ("that ground is impassable — pick open ground to move there" / "that is off the map — pick a tile on the map"), and the `blocked` cursor (off the map it read `move`). A selection with a drone in it keeps the order; a building on a blocked tile is still ordered onto. `packages/sim` and the order's handling are untouched. | `input/intents.ts` (`IntentWorld.groundAt`/`flies`, `Resolution.groundRefused`), `input/pointer.ts`, `input/cursor.ts`, `en.json` | `intents.test.ts`, `pointer.test.ts` (real `Sim`, real projection), `cursor.test.ts`. Ground branch disabled → 5 red; the `flies` exemption removed → 2 red; the cursor rung removed → 3 red. |
| **K-11** | A locked Deploy says why, in a line above the button, in its tooltip and through `aria-describedby`: "Deploy is locked: choose 1 more unit for the force first." The plain spread's dimmed full row carries a title and a refused click prints the reason; in the Field order a place with no one to swap and a body already going elsewhere each carry a title. All from the slot counts the screen already holds. | `ui/deploy-reason.ts` (new), `ui/loading.ts`, `ui/force-bar.ts`, `theme.css`, `en.json` | `force-bar.test.ts`, `loading.test.ts`. Reason returning null → 2 red; refused-click reason removed → 1 red; lone-place title removed → 1 red. |
| **K-12** | **Data loss closed.** A slot that fails to validate is held verbatim and written back with every save and delete; an unparseable whole blob is filed as one entry holding its raw text. The saves screen lists each as "Damaged save N / Damaged, cannot load" with **Export** (the kept text) and **Delete** (confirmed), the only way one is ever discarded. Good neighbours are never lost. ([after](k/after-damaged-save.jpg)) | `profile.ts` (`listDamaged`, `damagedRaw`, `DAMAGED_BLOB_ID`), `ui/saves.ts`, `theme.css`, `en.json` | `profile.test.ts` (corrupt slot → new save → raw still there; unparseable blob; non-object blob), `ui/saves.test.ts`. The damaged table dropped from `writeAll` → 4 red. |
| **K-13** | The leave and quit confirms word themselves for a sandbox ("Leave the sandbox? / This sandbox run ends. Nothing in your campaign changes."); the mission wording is unchanged. Where leaving lands (the campaign map) is not changed here. | `ui/leave-copy.ts` (new), `ui/hud.ts`, `main.ts`, `en.json` | `hud.test.ts`. `leaveCopy` ignoring its argument → 1 red; the HUD ignoring `freePlay` → the same red. |
| **K-15** | The stage shows the loading screen's own bar while models download: the label, the mission name and "Loading n of N", one step per model, no Deploy. It comes down when the batch settles, success or failure. Its count never reads `data-state="ready"`, which `perf:load` takes to mean the deploy gate is open. Measured live with models held back: "Loading 0 of 24" at 1.5 s. ([after](k/after-download-progress.jpg)) | `ui/loading.ts` (`showDownloadProgress`, shared `paintProgress`), `main.ts` | `loading.test.ts`. Allowed to read ready → 1 red; `step()` not counting → 1 red. |
| **K-16** | A lost graphics context raises the boot-failure card over the mission ("The picture stopped"; what happened, what next; Reload and main menu) and holds the battle. The listener is removed in the screen's disposer, which runs before the renderer's teardown releases the context deliberately. Verified live: a forced `loseContext()` raises the card, and a normal leave afterwards leaves no scrim. ([after](k/after-context-lost.jpg)) | `ui/boot-failure.ts` (`watchContextLoss`, `mountInterrupted`, kind `interrupted`), `main.ts`, `theme.css`, `en.json` | `boot-failure.test.ts`. Listener never added → 1 red; remover made a no-op → 1 red. |

## Open

Listed rather than fixed: each needs the lead, a new look, sim data, or more than a contained change.

| ID | Case | Problem | Why not fixed here | Suggested owner |
|---|---|---|---|---|
| K-08 | Impassable or off-map right-click | The order marker confirms an order the ground refuses. The `blocked` cursor vanishes on click, and off the map the cursor reads `move`. | **Fixed (wave 2):** the click refuses visibly; the sim's handling of an order is untouched. See the Fixed table. | done |
| K-09 | Inert order-chip tooltip | It says the chip would do nothing, not why ("nobody is moving", "no one aboard"). | Needs per-verb reasons from the selection model. Small, but it is HUD wording for B4. | **Fixed** (`OrderView.inertReason`, from the counts `orderRow` already reads) |
| K-10 | Dock refusal | "insufficient logistics" is also shown for an intel shortfall or an ended mission. No amount, no wait time, no deny sound. | The refusal reason lives in `requestBuild` (`packages/sim/src/mission.ts:671`). Wording it truthfully means reading it from the sim's result. | Stage 4 (economy) |
| K-11 | Deploy slots | A disabled Deploy and a dimmed full row do not say why or how ("bench a {type} to field this one"). | **Fixed (wave 2):** the reason is shown on both deploy surfaces. See the Fixed table. | done |
| K-12 | Corrupt save slot | Skipped in silence. **The next save or delete permanently drops it.** | **Fixed (wave 2):** unreadable slots are kept verbatim, listed as damaged, exportable and deletable only on purpose. See the Fixed table. | done |
| K-13 | Free play leave | The confirm talks about "the campaign", and leaving lands on the campaign map. | **Fixed (wave 2), wording only:** the confirm is mode-aware. Leaving a sandbox still lands on the campaign map; changing that is free play's place in the menu, PA-25's package. | PA-25 (destination) |
| K-14 | Audio misses | Fall back in silence (correct for players). The comment at `audio.ts:679` says they are logged; they are not. | Render package; comment only. **Fixed:** the comment now says misses are skipped in silence. | Pass F follow-up |
| K-15 | Model download wait | A blank stage while every model downloads, then a loading bar that reads "Ready" at once. | **Fixed (wave 2), progress only:** the loading screen's bar now shows during the download. The briefing itself still waits for the download; showing it earlier touches the deploy gate (PA-27) and the level-load design. | PA-27 / level-load (briefing earlier) |
| K-16 | GPU context lost mid-mission | A silent black canvas. | **Fixed (wave 2):** the card and Reload, no in-place recovery. Restoring a lost context without a reload would need a renderer recovery design. | Pass J (recovery, optional) |
| K-17 | Narrow portrait (390×844) | The page scrolls sideways, and the HUD and feed are cut off. No touch verbs, and nothing says a mouse and a wider screen are needed. | A "use a larger screen" notice is a new UI element: **mocked in wave 2, not built** ([mock](k/mock-k17-small-screen.jpg)). Touch input is out of polish scope. | Lead, then pass I |
| — | Campaign complete | No end-of-campaign line exists in `en.json`. | Narrative copy; Shai/Idit voice. | Narrative designer |

## K-17 mock: narrow portrait (not built)

[`k/mock-k17-small-screen.jpg`](k/mock-k17-small-screen.jpg): the real mission at 390×844, with the notice composed from the game's own pieces (`.rl-boot-scrim`, `.rl-boot-error`, `.rl-btn`; no new look) and injected for the capture only. Nothing of it is in the source.

**What the notice says.** Title "Best on a larger screen". Body: it is played with a mouse on a wide screen, and held upright a phone cannot fit the command strip or the feed. Next step: rotate the device or open it on a computer; carrying on is allowed, with part of the screen cut off. Two controls: "Carry on anyway" and "main menu". Shown once per session on a narrow portrait viewport, on the mission and the menu screens.

**A measurement that changes the brief.** On `/`, `/free-play` and `/saves` the page is 407 px wide at 390, and on a mission 821 px. But `html` and `body` already compute `overflow-x: hidden` on every screen (checked on all six routes), so a desktop browser does not scroll sideways; the content is *clipped* (the strip and the feed run off the right edge, as in the capture). The audit's "scrolls sideways" is therefore a width measurement, not a reproduced scroll. A touch browser that ignores `overflow: hidden` on the root (Safari has done so) is untested here. The proposed fix is in two parts: the notice above, and `touch-action: pan-y` plus `overscroll-behavior-x: none` on the root so a phone cannot be dragged sideways either. A real narrow layout for the strip and the feed is the larger job and belongs to pass I.

## Before and after

| Case | Before | After |
|---|---|---|
| Building GLB 404, direct load | [before-glb-404](k/before-glb-404.jpg): "Boot failed", the raw fetch URL, a stack frame, a blue link | [after-glb-404](k/after-glb-404.jpg) |
| Building GLB 404, soft navigation from the menu | blank black stage, nothing on it (traced in code; the router's rejection is `void`ed) | [after-softnav-glb-404](k/after-softnav-glb-404.jpg) |
| No WebGL2, mission | [before-nogl2-mission](k/before-nogl2-mission.jpg): "Error creating WebGL context." plus seven stack frames | [after-nogl2-mission](k/after-nogl2-mission.jpg) |
| Unknown path | [before-unknown-path](k/before-unknown-path.jpg) | [after-unknown-path](k/after-unknown-path.jpg) |
| Unknown free-play map | a different map, no word | [after-unknown-map](k/after-unknown-map.jpg) |
| Model download wait | a blank stage | [after-download-progress](k/after-download-progress.jpg) |
| Lost graphics context | a silent black canvas | [after-context-lost](k/after-context-lost.jpg) |
| Corrupt save slot | skipped, then deleted by the next save | [after-damaged-save](k/after-damaged-save.jpg) |

The end screen, the saves lines, the hotkey notes, the move refusal and the deploy and leave wording are pinned by unit tests rather than photographed. CI's `ui:shots` walk covers the defeat end screen.
