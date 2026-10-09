# Keyboard-only walk and save/load reliability

**Date:** 9 Oct 2026 · **Branch:** `polish/keyboard-and-saves`, from `main` at
`670347fb` · **Closes:** the "not assessed" row of
[`commercial-polish-audit.md`](commercial-polish-audit.md) for these two areas
(low-end performance and the audio mix stay open).

## WORK PACKAGE: keyboard-only walk and save/load reliability

- **Changed:** five defects fixed (KS-01 to KS-05 below). Each fix arrived
  with a test that was seen red first. Nine more findings are listed with
  sizes (KS-06 to KS-14).
- **Why:** the audit had never walked either area. Both walks found real
  dead ends. The worst: a keyboard player who pressed Enter to leave the
  victory moment skipped the debrief and was dropped straight into the next
  mission.
- **Player-visible improvement:** Enter on "Continue" now lands on the
  debrief, and Tab stays inside it. Focus stays in the saves list after a
  load or a delete. A load the browser refuses changes nothing and says so,
  where before it left a mixed campaign. A refused write at victory no longer
  records the win without the pay.
- **Tests:** `save-reliability.test.ts` (new, 13 specs), plus new specs in
  `outcome-moment.test.ts`, `debrief.test.ts` and `ui/saves.test.ts`. Full
  `pnpm test` passes: 505 files, 9807 tests.
- **Visual evidence:** none needed. No look changed. The walk transcript
  below is the evidence.
- **Known remaining issues:** KS-06 to KS-14. The large one is KS-06: there
  is no keyboard way to give a move order.
- **Next priority:** KS-06 needs a lead decision (see below). KS-07 and KS-08
  are one small shell package.

## How the walk was run

The walk used one headless Chromium on Metal at 1440x900, with music off
(`musicOffInitScript()`), against this worktree's own Vite server on port
5191. The player's input was **keyboard only**, through Playwright
`page.keyboard`. After every key, a probe read back `document.activeElement`
(tag, label, whether `:focus-visible` drew a ring, whether it was on screen)
and the route.

There were two deliberate exceptions, and both are noted where they happen:
- **Reaching a victory was scripted.** Recon I's drone route from `ui:shots`
  was queued with `__lions.sim.queueCommand` and `step()`. The scripting was
  needed because of KS-06: a keyboard cannot give a move order.
- **A few `eval`s were used to read state:** the selection, the status line,
  the feed. Nothing was clicked that way.

Both servers and the browser were stopped by PID afterwards.

## Walk transcript

| # | Where | Keys | What happened | Verdict |
|---|---|---|---|---|
| 1 | `/?fresh` menu | Tab ×10 | Nine items in order: Start, Campaign, Brigade, Free play, Saves, Settings, New campaign, audio, Credits. Then `<body>`, then it wraps. Every item draws its ring. | OK. Focus starts on `<body>` (KS-08). |
| 2 | menu → `/brigade` | Enter on Brigade | Mounts. Focus is on `<body>`, and the first Tab goes to the view toggle. Filter, sort, card, model ("turn with arrow keys"), stats, the three track heads, campaign map, menu and reset are all reachable. | OK |
| 3 | `/brigade` | Escape | Nothing happens. | KS-07 |
| 4 | `/brigade` → menu | Shift+Tab to "menu", Enter | Lands on the menu with focus on `<body>`. The next Tab goes to "Start", not "Brigade". | KS-08 |
| 5 | `/saves` | Tab | Order is name field, Save, Import, back. Saving says "Saved as …". | OK |
| 6 | `/saves` | Shift+Tab to Load, Enter | The confirm opens on Cancel and Tab cycles inside it. Escape closes it and focus goes back to Load. | OK |
| 7 | `/saves` | Load, Tab, Enter (yes) | The load says "Loaded …", but **focus drops to `<body>`**. | **KS-03, fixed** |
| 8 | `/campaign` | Tab ×14 | Canvas, 3 open town links, 4 locked town names, spin left, bearing, spin right, "Next: Beit Sahwan — First Light", main menu. | OK |
| 9 | board → `/mission/beit_sahwan_breach` | Enter on Next | The briefing mounts with **Deploy focused**. "Full orders" opens the three sections, and each is focusable, so the long text scrolls by Tab. | OK |
| 10 | deploy | Enter | The mission runs. Focus is on `<body>`. With nothing selected, Tab walks the strip: leave, Conduct, the objectives, Objectives, pause, 1×, 2×, audio, radio next. | OK |
| 11 | mission | Ctrl+A, Ctrl+1, Tab, Tab | Selects all 8 units. Tab now walks the lime frame along the chips: focus stays on `<body>` and the key is swallowed. | OK (KS-11) |
| 12 | mission | Escape | The pause menu opens on Resume. Tab cycles Resume, Restart, Settings, Quit, then the Objectives and Settings tabs. The Settings tab reaches every control, and rebind works by keyboard ("press a key…", Escape cancels). | OK (KS-10) |
| 13 | pause | Resume | Focus goes back to `<body>` and the game keys work again. | OK |
| 14 | mission | Tab to leave, Enter | The confirm opens. Escape closes it and focus goes back to "leave". | OK |
| 15 | mission | F1 | The key card opens on Close. Tab is trapped. Escape closes it and focus goes back. | OK |
| 16 | mission | Tab to Objectives, Enter | The tracker opens, but **focus stays on the strip**. The first Tab enters it (Close, Show refuge). Escape closes it, and focus goes to `<body>`. | KS-09 |
| 17 | pause | Quit to campaign, Tab, Enter (Leave) | Lands on `/campaign`. | OK |
| 18 | `/mission/beit_sahwan_1_recon` | Enter (Deploy), *scripted plan*, victory | The outcome moment shows with Continue focused. | OK |
| 19 | outcome | **Enter** | **The route changes to `/mission/beit_sahwan_breach`: the debrief is never seen.** The keydown skipped the moment, the debrief mounted and focused "Next", and the same press's default action then activated it. | **KS-01, fixed** |
| 20 | outcome, hold left to run out | Tab ×14 | The debrief focuses "Next". Tab then walks **out of it onto the HUD strip behind the backdrop** (leave, pause, 1×, 2×, audio, next), which is invisible and still live. | **KS-02, fixed** |
| 21 | `/free-play`, `/credits`, `/settings` | Tab | Every control is reachable with a ring, and every page has a back link at the end. No dead ends. | OK |
| 22 | *after the fixes* outcome | Enter | Stays on Recon I and the debrief shows "Next" focused. Tab cycles Replay, campaign map, menu, Next. | fixed |
| 23 | *after the fixes* `/saves` | load, delete | After a load, focus stays on that slot's Load. Deleting the last slot puts focus on the name field. | fixed |
| 24 | *after the fixes* mission | I, Ctrl+2, Ctrl+A, 2, H, Space | I selects the idle unit `[0]`. Ctrl+A selects all 9 units. 2 recalls group 2, which is `[0]`. H halts. Space jumps to the alert. | OK |

## Defects fixed

| ID | Area | Problem | Fix | Red first |
|---|---|---|---|---|
| KS-01 | Outcome → debrief | Enter on "Continue" skipped the moment on keydown. `finish()` then let the debrief mount and focus its primary, and the browser applied that press's default activation to the newly focused "Next: …". A keyboard player went straight into the next mission and never saw the debrief. | `outcome-moment.ts`: an Enter or Space that skips calls `preventDefault()`. Other keys keep their default, so browser shortcuts still work during the hold. | Spec "an Enter or Space that skips it spends the key…": `defaultPrevented` was false. |
| KS-02 | Debrief | The report sits on a backdrop that hides the live HUD, but had no focus trap, so Tab walked onto the strip behind it. | `debrief.ts`: `focusTrap(p.el)`, released in the report's own disposer, which `main.ts` already registers in `screenDisposers`. | Spec "keeps Tab inside itself…": focus left the report. The spec file now disposes every report it mounts, because a leaked trap from an earlier test was what first made the "released" half fail. |
| KS-03 | Saves screen | A confirmed load or delete re-renders the list. The confirm had just returned focus to a button that the re-render then threw away, so the next Tab started from `<body>`. | `ui/saves.ts`: `refocus()` puts focus on the same slot's Load after a load. After a delete it goes to the row that took the deleted one's place, or to the name field when the list is empty. Rows and buttons carry `data-slot` and `data-action`. | Spec "keeps focus in the list…": `activeElement` was `<body>`. |
| KS-04 | Load | `writeActive` writes three keys with no transaction, so a quota refusal on the account or the tutorial flag left a **mixed campaign**: the slot's ledger married to the old brigade account. The screen could only say "may be mixed". | `LedgerStore` gains `snapshotCampaign()` and `restoreCampaign()`, which handle the three keys **as stored bytes**. `writeActive` takes a snapshot first and restores it on any refusal, then rethrows: the load failed and nothing changed. Putting back bytes that fitted before cannot need more room. If the restore is refused as well, it throws the coded `saves.error.storage.loadMixed`, which is now the only path that says "may be mixed". The `saves.error.storage.load` message now reads "nothing was changed". | Mutation: restore as a no-op made both "puts the active campaign back exactly…" specs and the victory spec fail. Mutation: dropping the coded key made the screen's mixed spec fail. Mutation: `throw err` in place of the coded throw made "says so in its own words" fail. |
| KS-05 | Victory write | The handler wrapped only the ledger write. A refused **account** write threw out of the victory handler after the ledger had recorded the win: a won mission with no pay, and the rest of the handler (the end screen) skipped. | `ledger-store.ts`'s `writeVictory(store, ledger, account)` writes both or neither, using the same snapshot. It answers `saved`, `refused` or `unavailable` and never throws. `main.ts` computes the payout first, writes once, and sends the payout telemetry only on `saved`. | Spec "a refused account write puts the ledger back…": the function was missing. Then the restore mutation above failed it. |

## Save/load reliability: what was exercised

All of this runs through `memoryLedgerStore()`, the shipping `overStorage`
implementation over a `Map`. CLAUDE.md warns that the jsdom `localStorage` is a
bare `{}` here, so no spec depends on it.

| Scenario | Result | Where |
|---|---|---|
| Save, win the next mission, load: is the active campaign byte-identical to save time? | Yes, all three keys. | `save-reliability.test.ts` |
| Load a slot, then continue: do the menu's Continue and the board's "Next" point at the slot's next mission, and does winning it pay into the slot's account? | Yes (`continueTarget`, `nextOperation`, `payVictory`). The live screens read the store fresh on every mount, so nothing is cached past a load. | same |
| A quota refusal on each of the three writes during a load | Nothing changes. The original error goes to the status line ("nothing was changed"). | same, and `ui/saves.test.ts` |
| A quota refusal on the restore as well | `saves.error.storage.loadMixed`, the old honest "may be mixed" line. | same |
| A blocked store (no storage at all) | Writes nothing and throws nothing. The saves screen is refused upstream (`mountSaves`). | same |
| A damaged slot next to good ones (K-12, #453) | The good slots list and load. The damaged one is kept and never loads, and it survives the load. | same |
| A slot from an older build: version-1 account, no `build`, `savedAt` or `tutorialDone`, a roster with no `slot` or `enlisted` | Lists as `savedAt 0`, `build ''`. Loads with the account migrated to version 2, `campaign_paid` taken from the slot's **own** ledger (GH-330), the roster kept as written, and the tutorial flag removed. | same |
| `?fresh` next to the brigade account | Ledger and tutorial flag removed. Balance kept, `campaign_paid` cleared, and `lions.saves` byte-identical. | same |
| A quota refusal on the victory write | Both keys back as they were. "Not saved" in the HUD. No throw. | same (KS-05) |

## Defects left, with size

| ID | Area | Problem | Proposed fix | Size |
|---|---|---|---|---|
| KS-06 | Battlefield orders | No move, attack-move or smoke order can be given without a pointer: each needs a world position, and smoke quick-casts at the cursor. Selection (Ctrl+A, I, the groups), halt, load and unload, the camera (WASD and arrows), the alert jump, pause and the HUD buttons all work by keyboard. Basic play cannot. | A lead decision is needed between two options. (a) A keyboard order reticle: the arrows steer a ground cursor while an order is armed, Enter confirms. (b) "Order at the screen centre": an armed verb plus Enter targets the camera's focus tile, so a player pans with WASD and then confirms. (b) is smaller and reuses `armOrder`. | L (a) / M (b) |
| KS-07 | Shell screens | Escape does nothing on Brigade, Saves, Settings, Credits, Free Play or the campaign board. The only way back is tabbing to the back link at the end of the page. | A router-level Escape goes to the screen's back route when no dialog is open (`isDialogOpen()`) and the screen is not a mission. The garage viewer's own key handling must be checked first. | S |
| KS-08 | Router | Every soft navigation leaves focus on `<body>`. Coming back to the menu, the first Tab lands on "Start" rather than the item you left from. There is no skip link or heading focus. | On mount, focus the screen's heading (`tabindex=-1`). On a back navigation to `/`, focus the menu item for the route just left. | S |
| KS-09 | Objectives tracker | Opening it from the strip leaves focus on the strip button, so the first Tab enters the tracker. Closing it sends focus to `<body>`. That second part is deliberate: the game keys need it. | Focus the tracker's first control on open. | XS |
| KS-10 | Controls settings | All 14 rebind buttons are named "Change". A sighted keyboard player sees the row, but a screen reader hears "Change" fourteen times. | `aria-label` = "Change {action}" through `t()`. | XS |
| KS-11 | HUD | With units selected, Tab walks the selection chips, so the strip's buttons can be reached by Tab only when nothing is selected. This is by design (the RTS convention) and recorded here for the release pass. | None proposed. Escape opens pause, which reaches the same controls. | — |
| KS-12 | Debrief after KS-05 | When the victory write is refused, the HUD says "not saved", but the outcome moment and the debrief still show the computed pay as paid. | Pass `writeVictory`'s answer into `creditsReward` and show an "unsaved" line instead of `+N`. | S |
| KS-13 | Saves form | The default name is computed when the screen mounts and when a save succeeds, but not after a delete. Delete one of two slots and the next default is "Save 3" while one slot is listed. Seen as "Save 2" in step 23. | Recompute `nameInput.value` after a delete when the player has not typed. | XS |
| KS-14 | Debrief on short windows | Not measured. The report's body scrolls inside the panel, and `focusTrap`'s selector does not include a focusable scroller, so on a short window a keyboard player may not be able to scroll the body. At 1440x900 nothing scrolled. | Give the body `tabindex=0` and include it in the trap. Measure at 1280x600 first (`end-panel:check`). | XS |
