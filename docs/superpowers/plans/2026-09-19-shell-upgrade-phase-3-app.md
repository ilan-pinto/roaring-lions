# Shell Upgrade Phase 3 — "one register", the APP HALF — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the shell's two unengineered moments into engineered ones, and give the whole product one drawn vocabulary. Deploying stops being a button under a paragraph and becomes a decision the player makes about named veterans; winning and losing stop being a 26.25rem panel floating over the corpse of the battlefield and become a held full-screen moment; the menu, the board and the briefing stop being one centred column at every width and become composed layouts at 1920 and 2560; the campaign board's pins answer the cursor the way the flat board's already do; and three unrelated glyph systems plus a dozen raw dingbats become one drawn family at one weight.

**Architecture:** Everything in this plan lives inside `packages/app`, plus one exported checker in `tools/validate_ui_palette.mjs`, two capture states in `tools/src/ui-review/shoot.ts`, and one integration test in `tools/src`. The pattern Phases 1 and 2 established holds and is not varied: **a pure model module with its own `*.test.ts`, and a thin DOM layer over it.** New pure modules are `ui/deploy-roster.ts` (the adapter: what deploy is allowed to know about the brigade), `ui/deploy-select.ts` (the choice, and the permutation it becomes), `ui/map-preview.ts` (the terrain canvas, extracted from `Minimap`'s private `paintTerrain`), `ui/pin-hover.ts` (what a hovered pin says), `ui/escape-html.ts` (the one escaper, replacing two copies) and — gated — `ui/symbol.ts` (the twelve glyphs). New DOM layers are `ui/outcome-moment.ts` (the held victory/defeat moment) and `ui/focus-trap.ts` (one Tab cycle for all four overlays). `main.ts` keeps `bootBattlefield` (D-18) and gains the wiring; nothing new mounts outside the battlefield's own disposer.

**Tech Stack:** TypeScript strict, vitest (jsdom for DOM files, node for pure ones), Vite, Playwright (tools only). No three.js in this plan and no file under `packages/render/**`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-16-shell-upgrade-design.md` — §6 "Phase 3 — one register" (its eight bullets and its three acceptance clauses), Decision 4 (deploy as a decision), §5 constraints, §7 testing and evidence, §8 out of scope, §10 status and the parallel-work boundary, and the Deviations D-10…D-27. The spec is the binding authority; this plan argues from it and records where it departs, below. Execution-plan package: **WP-S3e (#178)**, app half. One branch, one landing.

**Execution timing — this plan is written now and runs in Stage 2.** It is queued behind two things and neither is in this branch's control. `docs/HANDOVER.md` §1 gives Lane A's next action as: *"when WP-A1.2 #172 is on main: … run [Phase 2] Tasks 15 (annulus range rings) and 16 (minimap on the lit ground) …; **then S3e #178 app half**."* Phase 2's own Global Constraints say those two tasks "run only after the art lane's blast package WP-A1.2 has landed on `main`" (`2026-09-18-shell-upgrade-phase-2.md:16`), and WP-A1.2 (#172) and WP-A1.3 (#177) were both **open** when this plan was written. **Task 1 does not start until Phase 2 Tasks 15–16 are on `main` and this branch has merged `origin/main`.** Two consequences the implementer must act on rather than read past: those tasks touch `ui/minimap.ts` (Task 15 replaces its painted terrain with the map's lit albedo) and `three/units/overlays.ts`, so **Task 3 of this plan must re-read `minimap.ts` before extracting anything from it** — the function this plan names may have moved or gained a source; and every file:line citation below was taken at `1e584bfa` and should be re-grepped, not trusted, if weeks have passed.

**Tasks 11 and 12 are gated on G1 (#165, due 2 Oct)** and are ordered last so that everything above them can run the day Stage 2 opens. See "The gated tasks".

## Global Constraints

Copied from the spec §5 and §10, binding on every task:

- **The sim is untouched.** §5: "`packages/sim/**` changes in no phase except by a TYPE-ONLY addition that mirrors a schema field." This plan makes no such addition either: **`git diff --stat <base>..HEAD -- packages/sim` must be EMPTY at landing**, and every task's gate line says so. Deploy-as-a-decision looks like it needs a sim change and does not — see R-3. `pnpm test:determinism` is in the gate line of Tasks 2 and 4 anyway, because "cannot move" is a claim and the gate is the evidence.
- **Colour comes from the palette.** `packages/app/src/ui/theme.css` remains the only file naming an `--rl-*` variable; new tokens are semantic (`--outcome-scrim`, `--deploy-rule`); `pnpm validate:ui` stays at an **empty allowlist** (`tools/validate_ui_palette.mjs:9-13`); translucency is `color-mix()`; no hex, `rgb()` or `rgba()` literal anywhere in UI source. Every SVG this plan draws fills with `currentColor` (the rule `ui/role.ts:183` already follows) or a semantic token (`--mark-1/2/3`, `theme.css:177-179`).
- **Fonts are self-hosted, never a CDN.** This plan adds no font file.
- **Three only under `packages/render/src/three/**`.** **No task in this plan opens a file under `packages/render/`.** The campaign board reaches three through the existing dynamic-import door (`@lions/render/three-campaign`, `worldmap3d.ts:188`) and Task 8 widens only the app's own restated `MountedView` interface (`worldmap3d.ts:97-101`), never `world-view.ts`.
- **The execution-plan boundary (spec §10).** The art session owns `three/units/mesh-*.ts`, `three/ThreeRenderer.ts`, `sheet.ts`, `tools/src/mesh_gait*`, `tools/units/rig.py`, the four Meshy importers, `art/meshes/**`, `assets/meshes/**` and CLAUDE.md's "Mesh units" section. **This plan touches none of them.** `packages/app/vite-plugin-cursors.ts` is app-owned and is opened only by gated Task 12.
- **No `any`. No non-null assertion in new code.** Strict TypeScript; tests colocated as `*.test.ts`; every DOM test file opens with `// @vitest-environment jsdom`; `window.localStorage` in that environment is a bare `{}` — guard every access the way `menu.ts`'s `storedRenderer()` does, or take a `StorageLike` parameter and test with a Map-backed fake.
- **The visual gate is blessed, never widened — and it DOES see the HUD.** `docs/HANDOVER.md:50` records Phase 2's landing finding: *"the plan's `hideHudExceptCanvas` claim was wrong — the HUD IS in the frame — but the picture held."* So the Phase 2 plan's assurance that no HUD change can move `quiet`/`open-ground`/`relief`/`vehicle` is retired. **Tasks 10 and 12 touch `ui/hud.ts` and must run `pnpm golden-baseline` in their own gate step and expect a possible bless.** Every other task touches only screens no gated scenario photographs. **One bless is budgeted.** From CI numbers only, artifact downloaded and looked at, one in flight at a time; never widen a threshold to clear a red run (D-27).
- **Screens are pure functions.** Every `show*(stage, opts)` returns a disposer; nothing reads `window.location` inside a screen. The outcome moment mounts on `document.body` and is therefore torn down by the mission's own disposer chain (`screenDisposers`, drained by `bootBattlefield`'s `teardown`) exactly as `showEndScreen` and `showDebrief` already are (`main.ts:3691`, `:3700`) — D-10's rule, unchanged. **`pnpm ui:routes` is the instrument**: it asserts the body returns to the menu's own child count after three missions and after an Escape from the deploy screen (`routes-check.ts:296, :311, :355, :391`).
- **Every player-facing string is human and goes through `t()`.** No mission id, map id, URL flag, gate expression, objective-status enum or roster key reaches the DOM. New keys land in `packages/app/src/i18n/en.json`; `tools/validate_i18n.mjs` (inside `pnpm validate:ui`) fails a bare chrome literal. It has two known blind spots — module-load-time freezing, and a sink-adjacent-literal-only regex — so **any new label table resolves lazily the way `ui/role.ts`'s `ROLE_LABEL` does, never with a module-level `t()` call.** The only text a mission can show stays `name`, `briefing`, `objectives[].text` and a trigger `label`.
- **UI scale is one number.** `rem` throughout; a new `px` ≥ 4 in UI CSS fails `pnpm validate:ui` unless the line carries `/* px-ok */` (`tools/validate_ui_palette.mjs:80-83`). The two breakpoint media queries are themselves `px-ok`-tagged (`theme.css:294-295`) because they SET the scale rather than consume it; Task 7 follows that precedent for anything it adds.
- **Every check gets an input that makes it fail — constructed, and run** (CLAUDE.md). Each task's Step 3 names the mutation that turns it red; the commit message says it was seen red. This binds hardest on gated Task 11, whose whole product is a check.
- **The tool contracts stay whole:** `window.__lions` keeps `sim`, `renderer`, `runtime`, `audio`, `help`, `step`, `goto`, `sel`, `units`, `cursorKey`, `hover` with today's semantics; the frame loop stays armed through the bare global `requestAnimationFrame` so `FREEZE_FRAME_LOOP_STATEMENTS` still freezes it; `.rl-loading`, `.rl-loading__deploy`, `.rl-loading__count`, `.rl-world[data-board]`, `.rl-world__canvas canvas`, `.rl-endnav`, `.rl-endnav__debrief`, `.rl-debrief`, `.rl-obj-panel--tracker` keep their names — **`shoot.ts` and `routes-check.ts` both select on them.** This plan adds no sandbox/URL flag; a task that reaches for one must add it to `packages/app/src/sandbox-help.ts`'s flag table and should reconsider first.
- **Gates before every commit:** `pnpm lint && pnpm typecheck && pnpm test && pnpm validate:data && pnpm validate:ui`. Plus `pnpm test:determinism` on Tasks 2 and 4; `pnpm ui:routes` on Tasks 3, 4, 6 and 9; `pnpm ui:shots` wherever a task names a capture; `pnpm golden-baseline` on Tasks 10 and 12. Nothing here needs `validate:assets`, `validate:meshes`, `balance` or `playtest`.
- **Git hygiene:** commit with explicit paths (`git add <paths>` / `git commit -s -- <paths>`), never `-A` — other sessions share this working tree; never `git checkout -- <file>`; `/usr/bin/git` by absolute path in a worktree; the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` verbatim, and DCO `-s`.

## Rulings taken while planning

Each narrows or departs from §6 Phase 3's text; each is written into the spec's Deviations at landing as `D-40`…`D-50` with what the executing session measured.

- **R-1 — This plan is the APP HALF of WP-S3e and nothing else.** §6 Phase 3 lists eight bullets. Five are here: deploy as a decision, victory and defeat moments, the symbol family's app-side consumption, composed layouts at 1920 and 2560, and the board pins' hover language. Three are not, and each is named in Out of scope with its owner: the **scene host** (`packages/render/src/three/front/`, plus `ThreeRenderer.ts`) is a separate later plan that cannot start until WP-A1.3 (#177) lands, because spec §10 allows only one lane on that file at a time; the **campaign board on the lit pipeline** and its basin re-author are render/art-lane work in `world-view.ts`/`world-material.ts`; and **portraits, key art and the garage's art pass** are art-lane file-for-file replacements that, by D-20, need no code change here at all.
- **R-2 — Execution starts in Stage 2, after Phase 2's Tasks 15–16 land; Tasks 11–12 start after G1 answers.** Stated in the head above with the two issue numbers and the HANDOVER line. The gating is an **entry condition, not a date**: the issue body's own words are "The sheet is approved at G1 before anything consumes it", so Tasks 11 and 12 check for the approved sheet rather than for 2 October. Tasks 1–10 are a complete, landable branch on their own; if G1 slips, land them and take 11–12 as a second landing.
- **R-3 — Deploy chooses WHO goes, never HOW MANY, and it does it by PERMUTING the roster pool, never by filtering it.** This is the ruling the whole deploy half rests on and it is the one that keeps the sim untouched. Three facts, measured: (a) `MissionRuntime.spawnPlacement` draws `from_ledger` bodies with `this.rosterPool.findIndex((r) => r.type === p.unit)` and `splice` (`mission.ts:1259-1262`) — **first matching entry of the type, in pool order**, up to the placement's own `count`; (b) whatever is left in `rosterPool` is written back into the produced ledger unchanged (`mission.ts:1887`: `for (const left of this.rosterPool) roster.push({ ...left })`), with the comment naming the silent deletion that guard exists to prevent; (c) `starting_force` has no field that could bench a placement — `mission.schema.json` pins its keys. So **removing an entry from the ledger the runtime reads would delete that unit from the campaign permanently**, which is not a decision, it is data loss. What the app can do without touching the sim is **reorder the pool**: chosen entries of a type first, benched entries behind them. The draw then takes exactly the chosen ones, the benched ones stay in `rosterPool`, and the produced ledger is identical to today's for the same multiset. Spec §8 authorises exactly this scope and no more: *"Phase 3 shows and chooses the force the roster already computes; new rules are the economy work's."*
- **R-4 — One named adapter, `DeployRosterView`, and the draw replay lives in exactly one place.** WP-G-E2 (#174, Lane B, running in parallel) changes `reserve` from a number to a reserve list with a cap (`docs/HANDOVER.md:38`, G0 #12: *"measure a ★★★ ladder first; cap above it; overflow to a reserve list"*), and may land before, during or after this branch. Deploy therefore reads the brigade through **one read-only interface** (Task 1), never through `ledger['roster.surviving_units']` directly and never through `BroughtPanel.reserve`'s bare count. **E2 owns the other side of that seam**: it changes `deployRosterView`'s implementation and fills the `cap` field this plan leaves `null`; it does not change the deploy screen. And because `broughtFor` (`loading.ts:118-130`) *already* replays the spawner's draw order by hand, the replay **moves into `deploy-roster.ts` and `broughtFor` calls it** — one answer to one question, the same rule Phase 2's R-7 applied to the objective list. Two hand-written copies of a sim rule drifting apart is the failure this closes.
- **R-5 — `new MissionRuntime` and `runtime.start()` move to after `await loading.done()`.** They run at `main.ts:1500` and `:1520` today, 400 lines and one player decision BEFORE the deploy screen exists, so the roster pool is snapshotted (`mission.ts:550`) and the starting force spawned before the player can choose anything. Measured, and this is why the move is cheap rather than a refactor: **nothing between `main.ts:1521` and `:2148` reads `runtime` or `sim.state`** (three matches for `runtime` in that range are all inside comments; zero for `sim.`), and the asset plan that drives the loading bar is derived from the **mission JSON**, not from the sim — `meshRoster` is `missionUnitTypes(mission, …)` (`main.ts:1668`) and feeds `spriteSheetPlan` (`main.ts:2010`). A permutation cannot change which types a mission fields, so **the progress bar, the sheet plan and the deploy gate are all byte-identical before and after.** `resolveUpgrades` stays where it is at `main.ts:1495`, because `broughtFor` and the objective list both read `resolvedMission` before the screen is built.
- **R-6 — The outcome moment is a dialog, it is presentation, and it does not delay the ledger write.** §6: "Victory and defeat moments: full-screen, held, before the debrief." It mounts on `document.body` between the ledger write (`main.ts:3528` `saveLedger`, `:3540` `payMission`) and `showEndScreen` (`main.ts:3691`) — so the campaign is already saved when the moment appears and a player who closes the tab mid-moment loses nothing. It joins `isDialogOpen()`'s selector (`confirm.ts:56`) and installs a capture-phase key guard mirroring `pause.ts:238`, so the game's own keyboard handler defers to it the way it already defers to the pause menu and F1. It is **held and skippable by any key or click regardless of the hold**, `titleCard`'s rule (`motion.ts:96-107`), and the hold is driven from JS so `prefers-reduced-motion` keeps the duration and drops only the animation. The `missionEnd` handler is synchronous and must stay so: the moment is created, its `dismiss` pushed onto `screenDisposers`, and `showEndScreen` runs from `.then()` behind a `disposed` guard.
- **R-7 — 1280 is a FIT FLOOR, not a breakpoint, and D-8's number is picked here.** Grepping `theme.css` for `1280` finds nothing; it appears only twice in the Phase 2 plan as an informal fit-check width. The real breakpoints are `@media (min-width: 1900px) { --ui-scale: 1.15 }` and `@media (min-width: 2400px) { --ui-scale: 1.4 }` (`theme.css:294-295`), which every `rem` then multiplies (`:296`). Task 7 **keeps those two and adds no third**: a composed layout is a grid change, not a scale change, and a third scale step would move every screen in the product to buy two. 1280 stays the floor as a fit check in the task's own acceptance, unenforced by CSS, exactly as it is today. **D-8 is discharged in Task 7 with a number**: Phase 0 shipped the three-step scale instead of a continuous formula and explicitly deferred the 28%-menu-column-at-2560 acceptance — *"Phase 3's acceptance owns the number."* Task 7 sets it and records the measurement; punting again is not an option this plan leaves open.
- **R-8 — The pins' hover previews the sentence a click would say, and never navigates.** The flat board already has the pattern (`worldmap.ts:154-157`, `:192-195`: `mouseenter`/`mouseleave`/`focusin`/`focusout` toggling `data-hover`); the diorama's pins (`worldmap3d.ts:249-275`) have no pointer listener at all, and the one feedback line — `speak()` into an `aria-live` region — fires only on click (`onPick`, `:345-378`). Task 9 gives the pins the flat board's four listeners, and previews `onPick`'s own branch text without its side effects: **no `point()`, no `navigate()`.** The `opening` branch is the reason the split matters — on click it navigates, and a hover that navigated would make the board unusable. The region under the cursor comes from the view's **existing** `hovered` getter (`world-view.ts:128`, already public on the seam), read inside the `onFrame` callback the screen already receives; the only edit outside `worldmap3d.ts` is one line added to the app's own restated `MountedView` interface (`worldmap3d.ts:97-101`). **No file under `packages/render/` is opened.**
- **R-9 — The four Phase 2 leftovers are two tasks, and here is which.** `docs/HANDOVER.md:50` assigns the strip's 250 ms focus reset to Phase 3 explicitly; the other three come out of Phase 2's review. **Task 8** takes the missing focus trap — `pause.ts:230`, `confirm.ts:207` and `keys-overlay.ts:146` each let `'Tab'` through their capture-phase guard uncaught, and the objective tracker (`.rl-obj-panel--tracker`) is a fourth overlay that `isDialogOpen()` does not even know about (`main.ts:2332`) — as one shared helper for all four, and folds in `keys-overlay.ts:98`'s keycap composition (`` `${t('keymap.modifier.ctrl')}${key}` ``, the known concatenation-around-`t()` shape) because that file is already open. **Task 10** takes the state-preserving strip render and the two `innerHTML` sinks, because both live in `renderStrip`/`note` and the fix is one pass over the same 200 lines. The outcome moment (Task 5) is built with the trap from the start rather than retrofitted, so Task 8 runs before it.
- **R-10 — The symbol family's acceptance is the twelve PLUS whatever the addendum approves, and the check is code.** §6's acceptance is absolute — *"no dingbat glyph remains in the UI source"* — and the twelve glyphs G1 approves (seven roles, five verbs) do not cover what a grep finds. The plan therefore (a) submits a **utility-glyph addendum** to G1 as an open question, enumerated with file:line in "Open questions for G1" below; (b) makes gated Task 11 ship an exported `dingbatFailures(file, src)` in `tools/validate_ui_palette.mjs` — the same idiom `pxFailures` already uses (`:78`), so a test can import it without running the sweep — over a **named list**, not a Unicode block range, because `°` in the campaign board's bearing readout and `·` in a dozen separators are typography rather than iconography and a range would eat both; and (c) makes the acceptance "no LISTED dingbat remains", where the list is the twelve's sites plus whatever the lead approves. The falsification is putting one back.
- **R-11 — `ROLE_GLYPH` is dead and is deleted rather than redrawn.** `ui/role.ts:42-50` is a seven-entry Unicode table (`✹ ⬡ ✈ ✛ ▤ ▲ ■`) whose only importer in the whole tree is `role.test.ts:9`. Its consumers moved to `roleBadgeSvg` when the inspect card was redrawn and nobody removed it. It is the cheapest third of the "three inconsistent drawn styles" the brief found, and gated Task 12 deletes it and the test line that keeps it alive — which is not a loss of coverage, because the test only asserted each entry was truthy.
- **R-12 — Nothing in this plan captures a victory today, and Task 6 fixes that rather than working around it.** `shoot.ts`'s `16-end-defeat` is scripted with `debugKill` and its own comment says a victory "needs those satisfied for real and stays a manual capture" (`shoot.ts:460-462`). The moment differs by outcome, so a defeat-only capture photographs half the feature. And the moment breaks the existing capture by construction: `16-end-defeat` waits on `.rl-endnav` (`shoot.ts:474`), which now sits behind a held full-screen dialog. Task 6 dismisses the moment before that wait and adds `24-outcome-victory`, driven through `MissionRuntime`'s own objectives on `beit_sahwan_1_recon` rather than through a debug win, because there is no `debugWin`.

## File structure

| File | Responsibility | Task |
|---|---|---|
| `packages/app/src/ui/deploy-roster.ts` (+test) | Pure: the `DeployRosterView` adapter, and the one copy of the spawner's draw replay | 1 |
| `packages/app/src/ui/loading.ts` (+test) | `broughtFor` calls the shared replay; then the two-column spread | 1, 3 |
| `packages/app/src/ui/deploy-select.ts` (+test) | Pure: the selection, its invariants, and the pool permutation it becomes | 2 |
| `packages/app/src/ui/map-preview.ts` (+test) | Pure: the terrain canvas, extracted from `Minimap.paintTerrain` | 3 |
| `packages/app/src/ui/minimap.ts` | Its private `paintTerrain` becomes a call to the shared one | 3 |
| `packages/app/src/main.ts` | The runtime moves past the deploy gate; the moment; the capture hooks | 4, 6 |
| `tools/src/deploy_choice.test.ts` | The integration guard: a real `Sim` + `MissionRuntime` over a permuted pool | 4 |
| `packages/app/src/ui/outcome-moment.ts` (+test) | The held full-screen victory/defeat moment | 5 |
| `packages/app/src/ui/focus-trap.ts` (+test) | One Tab cycle for all four overlays | 8 |
| `packages/app/src/ui/pause.ts`, `ui/confirm.ts`, `ui/keys-overlay.ts` (+tests) | The trap wired in; the keycap made one `t()` call | 8 |
| `packages/app/src/ui/pin-hover.ts` (+test) | Pure: what a hovered pin or region says | 9 |
| `packages/app/src/ui/worldmap3d.ts` (+test) | The four hover listeners, and the preview line | 9 |
| `packages/app/src/ui/escape-html.ts` (+test) | The one escaper; two copies deleted | 10 |
| `packages/app/src/ui/hud.ts` (+test) | Focus survives the 250 ms rebuild; two `innerHTML` sinks escape their input | 10 |
| `packages/app/src/ui/symbol.ts` (+test) | **Gated.** The twelve glyphs as one sprite at one weight | 11 |
| `tools/validate_ui_palette.mjs` (+test) | **Gated.** `dingbatFailures`, over the approved list | 11 |
| `packages/app/src/ui/role.ts`, `ui/selection-model.ts`, `ui/production.ts`, `vite-plugin-cursors.ts` (+tests) | **Gated.** Three drawn styles become one | 12 |
| `packages/app/src/ui/theme.css` | Every new surface; the composed grid; the two breakpoints | 3, 5, 7, 9, 11 |
| `packages/app/src/i18n/en.json` | Every new string | 1–12 |
| `tools/src/ui-review/shoot.ts` | `24-outcome-victory`; the composed-layout pass at 1920 and 2560 | 6, 7 |

---

### Task 1: What deploy is allowed to know — the `DeployRosterView` adapter

The E2 seam (R-4) and the one copy of the spawner's draw (R-3), in one pure module. Nothing in this task is visible; it exists so that Tasks 2–4 can be written against a shape WP-G-E2 (#174) is free to reimplement behind.

Two things it must get right. **The replay is the sim's, not a lookalike.** `broughtFor` (`loading.ts:118-130`) hand-copies `MissionRuntime.spawnPlacement`'s draw (`mission.ts:1256-1263`) and its own doc comment says so ("deliberately step for step"). A second hand-copy in the selection model would be a third place for that rule to drift. So the replay moves here, `broughtFor` calls it, and the module's header carries the `mission.ts` line range it mirrors. **And `reserve` stops being a number at this boundary.** `BroughtPanel.reserve` (`loading.ts:81`) is `pool.length` — right for a one-line panel, useless to a screen that must let the player swap a named veteran in. `DeployRosterView` carries entries; `BroughtPanel` keeps its count, computed from them.

**Files:**
- Create: `packages/app/src/ui/deploy-roster.ts`
- Modify: `packages/app/src/ui/loading.ts` (`broughtFor` at 105-158; the `BroughtPanel` doc at 73-85)
- Test: `packages/app/src/ui/deploy-roster.test.ts`, `packages/app/src/ui/loading.test.ts` (extend)

**Interfaces:**
- Consumes: `LedgerData`, `LedgerRosterEntry` (`@lions/sim`, `mission.ts:93-104`), `MissionJson['starting_force']`.
- Produces (Tasks 2, 3 and 4 consume these exact names):
  - `interface DeployEntry { readonly poolIndex: number; readonly type: string; readonly typeName: string; readonly veterancy: number; readonly name?: string; readonly missions: number; readonly kills: number }`
  - `interface DeployRosterView { readonly eligible: readonly DeployEntry[]; readonly demand: ReadonlyMap<string, number>; readonly benchable: readonly DeployEntry[]; readonly cap: number | null }`
  - `function deployRosterView(mission, ledger, unitName): DeployRosterView | null`
  - `function drawFromPool(pool, starting_force): readonly number[]` — the shared replay; returns pool INDICES in draw order

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/src/ui/deploy-roster.test.ts
import { describe, expect, it } from 'vitest';
import type { LedgerRosterEntry } from '@lions/sim';
import { deployRosterView, drawFromPool } from './deploy-roster';

const pool = (): LedgerRosterEntry[] => [
  { type: 'inf_squad', veterancy: 2, name: '1-1 Erez', missions: 4, kills: 7 },
  { type: 'inf_squad', veterancy: 0, missions: 1, kills: 0 },
  { type: 'inf_squad', veterancy: 3, name: '1-3 Nachshon', missions: 9, kills: 21 },
  { type: 'at_team', veterancy: 1, name: '2-1 Gachelet', missions: 3, kills: 5 },
  { type: 'recon_drone', veterancy: 0, missions: 2, kills: 0 },
];

// beit_sahwan_2_foothold's own shape, read from the file: two ledger-drawn
// inf_squad, one ledger-drawn at_team, and four placements that draw nothing.
const force = [
  { unit: 'apc_eitan', count: 1 },
  { unit: 'inf_squad', count: 2, from_ledger: true },
  { unit: 'at_team', count: 1, from_ledger: true },
  { unit: 'mortar_team', count: 1 },
];
const mission = { ledger: { requires: ['roster.surviving_units'] }, starting_force: force };
const name = (id: string): string => id.replace(/_/g, ' ');

describe('drawFromPool', () => {
  // The oracle is mission.ts:1256-1263: findIndex by type, splice, up to
  // `count`, placements in array order. Indices, not entries, because the
  // selection is expressed as a permutation of the pool and an index is the
  // only handle that survives one.
  it('reproduces the spawner draw order, as indices into the pool', () => {
    expect(drawFromPool(pool(), force)).toEqual([0, 1, 3]);
  });

  it('a placement that is not from_ledger draws nothing', () => {
    expect(drawFromPool(pool(), [{ unit: 'inf_squad', count: 2 }])).toEqual([]);
  });

  it('a second placement of the same type continues where the first stopped', () => {
    const two = [
      { unit: 'inf_squad', count: 1, from_ledger: true },
      { unit: 'inf_squad', count: 1, from_ledger: true },
    ];
    expect(drawFromPool(pool(), two)).toEqual([0, 1]);
  });

  it('stops short rather than inventing an index when the pool runs dry', () => {
    const thin: LedgerRosterEntry[] = [{ type: 'inf_squad', veterancy: 0 }];
    expect(drawFromPool(thin, force)).toEqual([0]);
  });
});

describe('deployRosterView', () => {
  it('is null when the mission reads nothing from the ledger', () => {
    expect(deployRosterView({ ledger: { requires: [] } }, {}, name)).toBeNull();
  });

  it('eligible is one row per BODY, in pool order, for every drawable type', () => {
    const v = deployRosterView(mission, { 'roster.surviving_units': pool() }, name);
    expect(v?.eligible.map((e) => e.poolIndex)).toEqual([0, 1, 2, 3]);
    expect(v?.eligible.map((e) => e.type)).toEqual(['inf_squad', 'inf_squad', 'inf_squad', 'at_team']);
  });

  it('demand is the mission’s own counts — deploy chooses who, never how many', () => {
    const v = deployRosterView(mission, { 'roster.surviving_units': pool() }, name);
    expect([...(v?.demand ?? [])]).toEqual([
      ['inf_squad', 2],
      ['at_team', 1],
    ]);
  });

  // The drone is in the pool and no placement can draw it. It is shown as
  // reserve and is never selectable: there is no slot for it.
  it('benchable is what no placement can draw', () => {
    const v = deployRosterView(mission, { 'roster.surviving_units': pool() }, name);
    expect(v?.benchable.map((e) => e.type)).toEqual(['recon_drone']);
  });

  it('carries the name, stripes and record a player picks by, humanised', () => {
    const v = deployRosterView(mission, { 'roster.surviving_units': pool() }, name);
    expect(v?.eligible[2]).toEqual({
      poolIndex: 2,
      type: 'inf_squad',
      typeName: 'inf squad',
      veterancy: 3,
      name: '1-3 Nachshon',
      missions: 9,
      kills: 21,
    });
  });

  // WP-G-E2 (#174) fills this. It is present and null rather than absent so
  // that the screen's "of N" line is written once, against a shape that will
  // not change when the cap arrives.
  it('reports no cap today, and says so as a value rather than by omission', () => {
    const v = deployRosterView(mission, { 'roster.surviving_units': pool() }, name);
    expect(v?.cap).toBeNull();
  });

  it('a missing roster key is an empty view, not a throw', () => {
    const v = deployRosterView(mission, {}, name);
    expect(v?.eligible).toEqual([]);
    expect(v?.benchable).toEqual([]);
  });
});
```

- [ ] **Step 2: Implement, and make `broughtFor` the adapter's second reader**

`deploy-roster.ts` holds `drawFromPool` (the replay, with `mission.ts:1256-1263` quoted in its header as the thing it mirrors and the instruction to re-read it if the spawner changes) and `deployRosterView` on top of it. Then `loading.ts`'s `broughtFor` deletes its own `findIndex`/`splice` loop (`:118-130`) and calls `drawFromPool`, deriving `fielded` from the returned indices and `reserve` as `pool.length - fielded.length`. **`BroughtPanel`'s shape and every existing `loading.test.ts` assertion stay exactly as they are** — this is a substitution behind an unchanged interface, and the proof is that no existing test changes. Add one `loading.test.ts` case pinning that the panel's roster is unchanged for a pool where two entries of a type exist and one is drawn, which is the case a wrong index mapping would break.

- [ ] **Step 3: Gates, falsify, commit**

Falsify: change `drawFromPool` to search from the END of the pool (`findLastIndex`) — the `[0, 1, 3]` test and the "continues where the first stopped" test both go red, and so does `broughtFor`'s own name assertion in `loading.test.ts`, which is the point: the two are one rule now.

```
pnpm lint && pnpm typecheck && pnpm test && pnpm validate:data && pnpm validate:ui
git diff --stat -- packages/sim   # must be empty
```

```bash
/usr/bin/git add packages/app/src/ui/deploy-roster.ts packages/app/src/ui/deploy-roster.test.ts packages/app/src/ui/loading.ts packages/app/src/ui/loading.test.ts
/usr/bin/git commit -s -- <the same paths>
```

Message: `feat(shell): one copy of the roster draw, behind the adapter deploy reads`, body recording that the replay was hand-copied in two places and is now in one, that `BroughtPanel` is unchanged, and the mutation seen red.

---

### Task 2: The choice, and the permutation it becomes

**Opus.** The model the whole deploy half rests on, and the one place where getting it wrong deletes a player's veterans (R-3).

The player's choice is "which of my three `inf_squad` go, given the mission fields two". The sim's draw is "first two `inf_squad` in pool order". So the choice IS an ordering, and the model's whole job is to turn a set of picks into a **permutation of the pool that contains every original entry exactly once.** Anything less is data loss (`mission.ts:1887` writes the residue straight back into the campaign ledger).

**Files:**
- Create: `packages/app/src/ui/deploy-select.ts`
- Test: `packages/app/src/ui/deploy-select.test.ts`

**Interfaces:**
- Consumes: `DeployRosterView`, `DeployEntry`, `drawFromPool` (Task 1), `LedgerRosterEntry`.
- Produces (Tasks 3 and 4 consume these exact names):
  - `interface DeploySelection { readonly chosen: ReadonlySet<number> }` — pool indices
  - `function defaultSelection(view: DeployRosterView): DeploySelection`
  - `function toggleEntry(view: DeployRosterView, sel: DeploySelection, poolIndex: number): DeploySelection`
  - `function slotsLeft(view: DeployRosterView, sel: DeploySelection, type: string): number`
  - `function isComplete(view: DeployRosterView, sel: DeploySelection): boolean`
  - `function permutePool(pool: readonly LedgerRosterEntry[], sel: DeploySelection): readonly LedgerRosterEntry[]`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/src/ui/deploy-select.test.ts
import { describe, expect, it } from 'vitest';
import type { LedgerRosterEntry } from '@lions/sim';
import { deployRosterView, drawFromPool } from './deploy-roster';
import {
  defaultSelection,
  isComplete,
  permutePool,
  slotsLeft,
  toggleEntry,
} from './deploy-select';

const pool = (): LedgerRosterEntry[] => [
  { type: 'inf_squad', veterancy: 2, name: '1-1 Erez', missions: 4, kills: 7 },
  { type: 'inf_squad', veterancy: 0, missions: 1, kills: 0 },
  { type: 'inf_squad', veterancy: 3, name: '1-3 Nachshon', missions: 9, kills: 21 },
  { type: 'at_team', veterancy: 1, name: '2-1 Gachelet', missions: 3, kills: 5 },
  { type: 'recon_drone', veterancy: 0, missions: 2, kills: 0 },
];
const force = [
  { unit: 'inf_squad', count: 2, from_ledger: true },
  { unit: 'at_team', count: 1, from_ledger: true },
];
const mission = { ledger: { requires: ['roster.surviving_units'] }, starting_force: force };
const name = (id: string): string => id;
const view = () => {
  const v = deployRosterView(mission, { 'roster.surviving_units': pool() }, name);
  if (!v) throw new Error('fixture: the view must exist');
  return v;
};

describe('defaultSelection', () => {
  // Opening the screen and touching nothing must field exactly what the
  // mission fields today. Anything else is a silent balance change.
  it('is what the spawner would have drawn with no screen at all', () => {
    expect([...defaultSelection(view()).chosen].sort((a, b) => a - b)).toEqual(
      [...drawFromPool(pool(), force)].sort((a, b) => a - b)
    );
  });
});

describe('toggleEntry', () => {
  it('benching a chosen entry frees exactly one slot of its own type', () => {
    const v = view();
    const s = toggleEntry(v, defaultSelection(v), 0);
    expect(s.chosen.has(0)).toBe(false);
    expect(slotsLeft(v, s, 'inf_squad')).toBe(1);
    expect(slotsLeft(v, s, 'at_team')).toBe(0);
  });

  it('fields a benched entry into a free slot of its own type', () => {
    const v = view();
    const s = toggleEntry(v, toggleEntry(v, defaultSelection(v), 0), 2);
    expect([...s.chosen].sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(isComplete(v, s)).toBe(true);
  });

  // The count is the mission's. A screen that let the player field a third
  // squad would be authoring `starting_force` from the UI (spec §8).
  it('refuses a third body of a type the mission fields two of', () => {
    const v = view();
    const s = toggleEntry(v, defaultSelection(v), 2);
    expect([...s.chosen].sort((a, b) => a - b)).toEqual([0, 1, 3]);
  });

  it('refuses an entry no placement can draw', () => {
    const v = view();
    const before = defaultSelection(v);
    expect(toggleEntry(v, before, 4)).toBe(before);
  });

  it('never returns a mutated input', () => {
    const v = view();
    const before = defaultSelection(v);
    toggleEntry(v, before, 0);
    expect([...before.chosen].sort((a, b) => a - b)).toEqual([0, 1, 3]);
  });
});

describe('isComplete', () => {
  it('is false while a slot is empty — the screen may not deploy short', () => {
    const v = view();
    expect(isComplete(v, toggleEntry(v, defaultSelection(v), 0))).toBe(false);
  });

  // A pool with fewer bodies than the mission asks for is the case
  // `spawnPlacement` handles by substituting one fresh remnant
  // (mission.ts:1264). The screen must not block on it.
  it('is true when the pool simply cannot fill a slot', () => {
    const thin = [{ type: 'inf_squad', veterancy: 0 }];
    const v = deployRosterView(mission, { 'roster.surviving_units': thin }, name);
    if (!v) throw new Error('fixture');
    expect(isComplete(v, defaultSelection(v))).toBe(true);
  });
});

describe('permutePool', () => {
  const same = (a: readonly LedgerRosterEntry[], b: readonly LedgerRosterEntry[]): boolean => {
    const key = (e: LedgerRosterEntry): string => JSON.stringify(e);
    return [...a].map(key).sort().join('|') === [...b].map(key).sort().join('|');
  };

  // THE invariant. mission.ts:1887 writes whatever is left in rosterPool
  // straight back into the campaign ledger, so an entry dropped here is a
  // veteran deleted from the player's brigade forever.
  it('is a permutation: every entry survives, exactly once', () => {
    const v = view();
    const p = pool();
    const out = permutePool(p, toggleEntry(v, toggleEntry(v, defaultSelection(v), 0), 2));
    expect(out).toHaveLength(p.length);
    expect(same(out, p)).toBe(true);
  });

  it('the spawner’s own draw over the permutation takes exactly the chosen entries', () => {
    const v = view();
    const p = pool();
    const sel = toggleEntry(v, toggleEntry(v, defaultSelection(v), 0), 2);
    const out = permutePool(p, sel);
    const drawn = drawFromPool(out, force).map((i) => out[i]);
    expect(drawn.map((e) => e.name)).toEqual(['1-3 Nachshon', undefined, '2-1 Gachelet']);
  });

  it('a benched veteran is still in the pool the runtime will hand back', () => {
    const v = view();
    const p = pool();
    const sel = toggleEntry(v, toggleEntry(v, defaultSelection(v), 0), 2);
    const out = permutePool(p, sel);
    const left = out.filter((_, i) => !drawFromPool(out, force).includes(i));
    expect(left.map((e) => e.name)).toContain('1-1 Erez');
  });

  it('the default selection permutes to the identity draw', () => {
    const v = view();
    const p = pool();
    const out = permutePool(p, defaultSelection(v));
    expect(drawFromPool(out, force).map((i) => out[i])).toEqual(
      drawFromPool(p, force).map((i) => p[i])
    );
  });
});
```

- [ ] **Step 2: Implement**

`permutePool` builds the output by type: for each type the view has demand for, the chosen entries of that type in pool order, then the unchosen entries of that type in pool order; types with no demand keep their relative order and follow. Entries are copied by reference — they are treated as immutable everywhere and `mission.ts:1887` spreads them anyway. `slotsLeft` is `demand.get(type) - count(chosen of that type)`; `isComplete` is `slotsLeft <= 0` for every demanded type **or** the pool has no more of that type to give.

- [ ] **Step 3: Gates, falsify, commit**

Falsify twice, because this model has two independent ways to be wrong. (a) Make `permutePool` emit only the chosen entries — the permutation test and the benched-veteran test both go red. (b) Make `toggleEntry` ignore the slot limit — the third-body test goes red. Both mutations must be constructed and seen red; the commit says so.

Gate line includes `pnpm test:determinism` — not because this file can move the hash, but because it is the first task whose output feeds the ledger the sim reads, and the claim "cannot move it" is worth one 40-second measurement.

```bash
/usr/bin/git add packages/app/src/ui/deploy-select.ts packages/app/src/ui/deploy-select.test.ts
/usr/bin/git commit -s -- <the same paths>
```

Message: `feat(shell): the deploy choice is a permutation of the pool, never a filter`, body quoting `mission.ts:1887` and recording both mutations seen red.

---

### Task 3: The briefing becomes a two-column spread, with the ground it is about

Decision 4, the visible half: *"the briefing as a two-column spread — portrait and orders left, the roster's force and a map preview right — with the force chosen, not merely shown."* The screen is `showLoading` (`loading.ts:189-238`) and it keeps every contract it has: `briefingHoldsDeployment` still decides whether it holds at all (`:33-35`), `done()` still resolves on Deploy and rejects on `dispose()` (`:538-605`), `onBack` still takes Escape back to the campaign (`:579-583`), and the objectives still mount through `objectivesPanel` (`objectives.ts:51`), never a second list.

The map preview is the one new piece of art on the screen and it needs no `Sim`. `Minimap.paintTerrain` (`minimap.ts:766-786`) reads only `deps.map` and `deps.tones` and builds a 1-px-per-tile canvas — but `Minimap`'s constructor demands a full `MinimapDeps` including a mandatory `sim: Sim` (`minimap.ts:125`), so the class cannot be built off-mission. **The twenty-line loop is extracted, not copied**, and `Minimap` calls the extraction. `main.ts` already holds `map` and the `TerrainTones` before boot.

**Re-read `minimap.ts` before starting.** Phase 2's Task 15 replaces its painted terrain with the map's lit albedo and lands immediately before this plan (R-2); the function may have moved or gained a source argument.

**Files:**
- Create: `packages/app/src/ui/map-preview.ts`
- Modify: `packages/app/src/ui/minimap.ts` (`paintTerrain` at 766-786), `packages/app/src/ui/loading.ts` (the box at 189-238, 266-460), `packages/app/src/ui/theme.css` (`.rl-loading__box--brief` at 2930), `packages/app/src/i18n/en.json`
- Test: `packages/app/src/ui/map-preview.test.ts`, `packages/app/src/ui/loading.test.ts` (extend), `packages/app/src/ui/minimap.test.ts` (extend)

**Interfaces:**
- Consumes: `DeployRosterView`, `DeploySelection`, `defaultSelection`, `toggleEntry`, `slotsLeft`, `isComplete` (Tasks 1–2); `TerrainTones` (`@lions/render`); `objectivesPanel` (`./objectives`); `t`.
- Produces:
  - `function paintMapTerrain(map, tones: TerrainTones): HTMLCanvasElement` (`map-preview.ts`)
  - `showLoading` gains two appended optional parameters: `deploy?: { view: DeployRosterView; onChange(sel: DeploySelection): void }` and `preview?: { map; tones: TerrainTones }` — **appended after `paysCredits`**, so no existing call site's argument order moves.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/src/ui/map-preview.test.ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { paintMapTerrain } from './map-preview';

const tones = {
  open: '#000001', blocked: '#000002', rock: '#000003',
  cover: ['#000004', '#000005', '#000006'],
} as const;

// 3x2: one open, one building, one boulder / one cover-1, one cover-3, one open
const map = {
  width: 3, height: 2,
  blocked: Uint8Array.from([0, 1, 0, 0, 0, 0]),
  boulder: Uint8Array.from([0, 0, 1, 0, 0, 0]),
  cover: Uint8Array.from([0, 0, 0, 1, 3, 0]),
};

const at = (c: HTMLCanvasElement, x: number, y: number): string => {
  const g = c.getContext('2d');
  if (!g) throw new Error('no 2D context');
  const [r, gg, b] = g.getImageData(x, y, 1, 1).data;
  return `#${[r, gg, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
};

describe('paintMapTerrain', () => {
  it('is one pixel per tile, at the map’s own dimensions', () => {
    const c = paintMapTerrain(map, tones);
    expect([c.width, c.height]).toEqual([3, 2]);
  });

  it('blocked wins over boulder wins over cover wins over open', () => {
    const c = paintMapTerrain(map, tones);
    expect(at(c, 0, 0)).toBe(tones.open);
    expect(at(c, 1, 0)).toBe(tones.blocked);
    expect(at(c, 2, 0)).toBe(tones.rock);
    expect(at(c, 0, 1)).toBe(tones.cover[0]);
    expect(at(c, 1, 1)).toBe(tones.cover[2]);
  });

  it('clamps a cover tier above 3 rather than reading off the end', () => {
    const odd = { ...map, cover: Uint8Array.from([0, 0, 0, 0, 0, 9]) };
    expect(at(paintMapTerrain(odd, tones), 2, 1)).toBe(tones.cover[2]);
  });

  it('needs no Sim — it is called here with none', () => {
    expect(() => paintMapTerrain(map, tones)).not.toThrow();
  });
});
```

```ts
// packages/app/src/ui/loading.test.ts — append a new describe block
describe('the deploy spread', () => {
  it('draws one selectable row per eligible body and marks the default force', () => {
    const s = showLoading(host, 'Foothold', BRIEFING, undefined, undefined, undefined,
      () => {}, [], false, { view: VIEW, onChange: () => {} }, PREVIEW);
    const rows = [...document.querySelectorAll<HTMLElement>('.rl-deploy__row')];
    expect(rows).toHaveLength(4);
    expect(rows.filter((r) => r.dataset.chosen === '1')).toHaveLength(3);
    s.dispose();
  });

  it('a click benches one and frees a slot, and the count says so', () => {
    const seen: number[] = [];
    const s = showLoading(host, 'Foothold', BRIEFING, undefined, undefined, undefined,
      () => {}, [], false, { view: VIEW, onChange: (sel) => seen.push(sel.chosen.size) }, PREVIEW);
    document.querySelector<HTMLElement>('.rl-deploy__row[data-chosen="1"]')?.click();
    expect(seen.at(-1)).toBe(2);
    expect(document.querySelector('.rl-deploy__slots')?.textContent).toContain('1');
    s.dispose();
  });

  it('Deploy is disabled while a slot is empty, and enabled again when it is filled', () => {
    const s = showLoading(host, 'Foothold', BRIEFING, undefined, undefined, undefined,
      () => {}, [], false, { view: VIEW, onChange: () => {} }, PREVIEW);
    const deploy = document.querySelector<HTMLButtonElement>('.rl-loading__deploy');
    document.querySelector<HTMLElement>('.rl-deploy__row[data-chosen="1"]')?.click();
    expect(deploy?.disabled).toBe(true);
    document.querySelector<HTMLElement>('.rl-deploy__row[data-chosen="0"]')?.click();
    expect(deploy?.disabled).toBe(false);
    s.dispose();
  });

  // A sandbox and a no-briefing mission keep the bare progress screen they
  // have always had: `holds` gates the spread exactly as it gates the orders
  // paragraph and the commander line (loading.ts:266).
  it('a screen that does not hold shows no spread and no preview', () => {
    const s = showLoading(host, 'M0 sandbox', undefined, undefined, undefined, undefined,
      undefined, undefined, false, { view: VIEW, onChange: () => {} }, PREVIEW);
    expect(document.querySelector('.rl-deploy')).toBeNull();
    expect(document.querySelector('.rl-deploy__map')).toBeNull();
    s.dispose();
  });

  it('the beat count is unchanged by the spread — it is a sibling, never a beat', () => {
    const withOut = showLoading(host, 'Foothold', BRIEFING);
    const n = document.querySelectorAll('.rl-loading__beat').length;
    withOut.dispose();
    const withIn = showLoading(host, 'Foothold', BRIEFING, undefined, undefined, undefined,
      () => {}, [], false, { view: VIEW, onChange: () => {} }, PREVIEW);
    expect(document.querySelectorAll('.rl-loading__beat')).toHaveLength(n);
    withIn.dispose();
  });

  it('Escape still goes back, and Deploy still settles done()', async () => {
    let back = 0;
    const s = showLoading(host, 'Foothold', BRIEFING, undefined, undefined, undefined,
      () => { back++; }, [], false, { view: VIEW, onChange: () => {} }, PREVIEW);
    const done = s.done();
    document.querySelector<HTMLButtonElement>('.rl-loading__deploy')?.click();
    await expect(done).resolves.toBeUndefined();
    expect(back).toBe(0);
    s.dispose();
  });
});
```

`en.json` (lazily resolved, never at module load):

```json
  "deploy.title": "Confirm your force",
  "deploy.slots": "{n} left to assign",
  "deploy.slots.full": "Force assigned",
  "deploy.reserve": "In reserve · {n}",
  "deploy.record": "{missions} missions · {kills} kills",
  "deploy.map": "Ground"
```

- [ ] **Step 2: Implement**

`map-preview.ts` takes the loop out of `minimap.ts:766-786` verbatim — same tier order, same clamp — and `Minimap.paintTerrain` becomes `return paintMapTerrain(this.deps.map, this.deps.tones)`. Extend `minimap.test.ts` with one case asserting the class still paints what it painted, so the extraction is proved rather than assumed.

`loading.ts` gains `.rl-deploy` under the orders, gated on the same `holds` (`:266`) as everything else conditional on this screen: one `<ul>` of `.rl-deploy__row[data-chosen][data-pool-index]` per `view.eligible` carrying name-or-type, `'★'.repeat(veterancy)` (unchanged from `:350` — the star is outside this plan's glyph scope, see Open questions), and the record line; a `.rl-deploy__slots` line from `slotsLeft`; a `.rl-deploy__reserve` line from `view.benchable`; and `.rl-deploy__map` holding `paintMapTerrain`'s canvas scaled by CSS to the column width with `image-rendering: pixelated`. Rows are `<button type="button">` so the keyboard reaches them with no extra code; the whole spread is a `<fieldset>` with a `<legend>` of `t('deploy.title')`. Deploy's `disabled` tracks `isComplete`.

`theme.css` widens `.rl-loading__box--brief` and gives it `display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr)` above a `min-width` the single-column layout keeps below — one media query, and Task 7 owns the composed-layout numbers, so keep this one modest and note the handoff in a comment.

- [ ] **Step 3: Gates, capture, falsify, commit**

Falsify: make the spread a beat (append it to the beats container) — the beat-count test goes red, which is the specific regression `loading.test.ts` was built to catch. Falsify the preview: drop the `Math.min(cover, 3)` clamp — the clamp test goes red with an `undefined` fill.

Run `pnpm ui:routes` in this task's gate line: it escapes out of a deploy screen and asserts the body returns to the menu's own child count (`routes-check.ts:391`), which is the one existing instrument that can see a spread that fails to tear down. Then `pnpm ui:shots -- --pseudo` and read the new `05-briefing` at all three widths: the spread is the most text-dense thing added to the shell since the garage, and the garage is precisely what the pseudo set missed in Phase 1.

```bash
/usr/bin/git add packages/app/src/ui/map-preview.ts packages/app/src/ui/map-preview.test.ts packages/app/src/ui/minimap.ts packages/app/src/ui/minimap.test.ts packages/app/src/ui/loading.ts packages/app/src/ui/loading.test.ts packages/app/src/ui/theme.css packages/app/src/i18n/en.json
/usr/bin/git commit -s -- <the same paths>
```

Message: `feat(shell): the briefing is a spread, and the force on it is chosen`, body naming the extraction (one loop, two callers), the pseudo pass, and both mutations seen red.

---

### Task 4: The chosen force reaches the field

**Opus.** The ordering change R-5 describes, and the only task in this plan whose output the sim reads.

`new MissionRuntime` runs at `main.ts:1500` and `runtime.start()` at `:1520` — four hundred lines and one player decision before `showLoading` exists at `:1918`, and six hundred before `await loading.done()` at `:2148`. The runtime copies the pool at construction (`mission.ts:550`) and `start()` spawns immediately, so today a choice made on the deploy screen could not possibly reach the map. The block moves.

Why the move is contained rather than a refactor, measured at `1e584bfa`: **nothing between `main.ts:1521` and `:2148` reads `runtime`** (three textual matches in that range are all inside comments) **or `sim.state`** (zero matches for `sim.`), and the loading bar's own workload is derived from the mission JSON — `meshRoster` is `missionUnitTypes(mission, …)` (`:1668`), feeding `spriteSheetPlan` (`:2010`) and `loading.total(...)` (`:2029`). A permutation cannot change which unit types a mission fields, so the sheet plan, the progress count and the deploy gate are **byte-identical before and after**. `resolveUpgrades` stays at `:1495` — `broughtFor` and the objective list both read `resolvedMission` while building the screen.

**Files:**
- Modify: `packages/app/src/main.ts` (the `if (mission)` block at 1495-1521; the `showLoading` call at 1918-1932; the `await loading.done()` at 2148)
- Create: `tools/src/deploy_choice.test.ts`

**Interfaces:**
- Consumes: `deployRosterView` (Task 1), `defaultSelection`/`permutePool` (Task 2), `showLoading`'s new `deploy` parameter (Task 3).
- Produces: nothing exported. The contract is behavioural and the integration test is the statement of it.

- [ ] **Step 1: Write the failing integration test**

This is the guard that matters, and it runs against a real `Sim` and a real `MissionRuntime` on a shipped map and a shipped mission, mirroring `tools/src/first_light_fence.test.ts:460-490`'s idiom (which is the only harness in the tree that builds both). `beit_sahwan_2_foothold` is the fixture because it draws `inf_squad ×2` and `at_team ×1` from the ledger, so a pool of three squads makes the choice real.

```ts
// tools/src/deploy_choice.test.ts
// Deploy-as-a-decision, against the real spawner.
//
// The app never filters the roster pool -- it PERMUTES it, and the sim's own
// draw (mission.ts:1256-1263, findIndex by type + splice) takes the front of
// each type. This file proves both halves against the shipped mission rather
// than against a replica: the chosen veterans are the ones on the map, and
// the benched one comes back out of `rosterPool` (mission.ts:1887) into the
// produced ledger. A permutation that dropped an entry would delete a
// veteran from the player's brigade permanently, which is why this is a
// tools test with a real runtime and not a jsdom test with a fake one.
import { describe, expect, it } from 'vitest';
import { permutePool, toggleEntry, defaultSelection } from '../../packages/app/src/ui/deploy-select';
import { deployRosterView } from '../../packages/app/src/ui/deploy-roster';
import type { LedgerData, LedgerRosterEntry } from '@lions/sim';
import { missionWorld } from './mission-harness'; // built in Step 2, see below

const POOL: LedgerRosterEntry[] = [
  { type: 'inf_squad', veterancy: 2, name: '1-1 Erez', missions: 4, kills: 7 },
  { type: 'inf_squad', veterancy: 0, name: '1-2 Dekel', missions: 1, kills: 0 },
  { type: 'inf_squad', veterancy: 3, name: '1-3 Nachshon', missions: 9, kills: 21 },
  { type: 'at_team', veterancy: 1, name: '2-1 Gachelet', missions: 3, kills: 5 },
];

const namesOnMap = (ledger: LedgerData): string[] => {
  const w = missionWorld('beit_sahwan_2_foothold', ledger);
  const out: string[] = [];
  for (const id of w.runtime.playerEntityIds()) {
    const n = w.runtime.rosterNameOf(id);
    if (n) out.push(n);
  }
  return out.sort();
};

describe('the deploy choice, against the real spawner', () => {
  it('fields the default force when nothing is chosen', () => {
    expect(namesOnMap({ 'roster.surviving_units': POOL })).toEqual(
      ['1-1 Erez', '1-2 Dekel', '2-1 Gachelet'].sort()
    );
  });

  it('fields the veteran the player picked, and not the one they benched', () => {
    const view = deployRosterView(
      { ledger: { requires: ['roster.surviving_units'] }, starting_force: MISSION_FORCE },
      { 'roster.surviving_units': POOL },
      (id) => id
    );
    if (!view) throw new Error('fixture: the mission draws from the ledger');
    const sel = toggleEntry(view, toggleEntry(view, defaultSelection(view), 0), 2);
    const ordered = permutePool(POOL, sel);
    expect(namesOnMap({ 'roster.surviving_units': ordered })).toEqual(
      ['1-2 Dekel', '1-3 Nachshon', '2-1 Gachelet'].sort()
    );
  });

  it('the benched veteran is still in the ledger the mission produces', () => {
    const view = deployRosterView(
      { ledger: { requires: ['roster.surviving_units'] }, starting_force: MISSION_FORCE },
      { 'roster.surviving_units': POOL },
      (id) => id
    );
    if (!view) throw new Error('fixture');
    const sel = toggleEntry(view, toggleEntry(view, defaultSelection(view), 0), 2);
    const w = missionWorld('beit_sahwan_2_foothold', {
      'roster.surviving_units': permutePool(POOL, sel),
    });
    const produced = w.runToEnd();
    const roster = produced['roster.surviving_units'] ?? [];
    expect(roster.map((r) => r.name)).toContain('1-1 Erez');
    // Benched, so it served no mission and earned nothing.
    const erez = roster.find((r) => r.name === '1-1 Erez');
    expect(erez).toEqual(POOL[0]);
  });

  it('the produced ledger holds every body of the pool, permuted or not', () => {
    const view = deployRosterView(
      { ledger: { requires: ['roster.surviving_units'] }, starting_force: MISSION_FORCE },
      { 'roster.surviving_units': POOL },
      (id) => id
    );
    if (!view) throw new Error('fixture');
    const sel = toggleEntry(view, toggleEntry(view, defaultSelection(view), 0), 2);
    const w = missionWorld('beit_sahwan_2_foothold', {
      'roster.surviving_units': permutePool(POOL, sel),
    });
    expect((w.runToEnd()['roster.surviving_units'] ?? []).length).toBeGreaterThanOrEqual(POOL.length - 3);
  });
});
```

Two notes for the implementer. `playerEntityIds`/`rosterNameOf` may not exist on `MissionRuntime` — **do not add them to `packages/sim`** (the sim is untouched); read the names off `sim.state` and the runtime's public surface the way `first_light_fence.test.ts` reads objectives, or drop the two helpers and assert against the produced ledger alone, which is the half that matters. `MISSION_FORCE` is read from `data/missions/beit_sahwan_2_foothold.json` at test time, never transcribed — a transcription would pass after the mission changed.

- [ ] **Step 2: Implement**

Build the harness first: extract the twenty lines of `first_light_fence.test.ts:460-490` into `tools/src/mission-harness.ts` (`missionWorld(missionId, ledger)` → `{ sim, runtime, runToEnd(): LedgerData }`) and have that file call it, so there is one recipe rather than two. If that extraction turns out to churn the fence test's numbers, leave it alone and inline the recipe in the new file with a comment pointing at its source — the extraction is a convenience, not the task.

Then in `main.ts`: move the `if (mission) { runtime = new MissionRuntime(…); runtime.start(); }` block from `:1495-1521` to immediately after the `try { await loading.done(); }` at `:2148` and before `if (req.signal.aborted) abandon('left before deploy')` — the abandon check must still be able to run without a runtime. `resolveUpgrades` stays where it is. Hold the selection in a `let deploySelection` written by `showLoading`'s `onChange`, and build the runtime's `ledger` argument as `{ ...ledger, 'roster.surviving_units': permutePool(pool, deploySelection) }` when a view and a selection exist, and as `ledger` unchanged otherwise. **The object handed to `MissionRuntime` is a shallow copy; the `ledger` the rest of `bootBattlefield` reads is untouched**, because `broughtFor`, the debrief and `saveLedger`'s merge all read the original and a permuted copy leaking into any of them would reorder the player's saved brigade for a cosmetic reason.

- [ ] **Step 3: Gates, drive, falsify, commit**

Gate line: the standard five, plus `pnpm test:determinism` (the golden replay lays no roster and cannot move, and that is a claim worth one run), plus `pnpm ui:routes` (the mission boot order changed; the walk plays two missions and soft-boots a third).

Drive it: `pnpm dev`, `/mission/beit_sahwan_2_foothold` with a campaign ledger carrying three `inf_squad`, bench the default first squad, field the third, deploy, and read the names on the field through `__lions.units(0)`. Then finish the mission and read `localStorage['lions.ledger']` back: the benched squad is present and unchanged. Record both in the task report.

Falsify: hand `MissionRuntime` the ledger with the chosen entries only, instead of the permutation — the "benched veteran is still in the ledger" test goes red, which is the data-loss failure R-3 exists to prevent.

```bash
/usr/bin/git add packages/app/src/main.ts tools/src/deploy_choice.test.ts tools/src/mission-harness.ts
/usr/bin/git commit -s -- <the same paths>
```

Message: `feat(shell): the force the player chose is the force that spawns`, body recording that `new MissionRuntime` moved past the deploy gate, that nothing in between read it (the grep), that the sheet plan is derived from mission JSON and therefore unmoved, and the mutation seen red.

---

### Task 5: The victory and defeat moment

**Opus.** §6: "Victory and defeat moments: full-screen, held, before the debrief." Nothing in the tree is that. `showEndScreen` (`menu.ts:522-609`) is a floating panel at `top:62%;…width:min(26.25rem,90vw)` over the still-visible battlefield; `showDebrief` (`debrief.ts:50-58`) is another at `top:6%;…width:min(45rem,94vw)`. The closest precedent for *held* is `titleCard` (`motion.ts:65-108`) and it is not full-screen. So this is a model-and-DOM pair, sized as one (R-6).

Four rules it inherits from `titleCard` verbatim, because each was already argued there: the hold is `setTimeout`-driven so `prefers-reduced-motion` keeps the DURATION and drops only the animation (`motion.ts:104-105`); it is **skippable by any pointerdown or keydown regardless of the hold** (`:106-107`); `dismiss` is idempotent and takes both `window` listeners and the timer off (`:96-103`); and it returns its element as well as its dismisser, because a caller tearing down needs the node (`:57-63`).

Three rules it does not inherit. It is **full-viewport** and therefore a dialog: `role="dialog"`, `aria-modal="true"`, `.rl-outcome` joins `isDialogOpen()`'s selector (`confirm.ts:56`), and it installs a capture-phase key guard mirroring `pause.ts:238` so the game's handler defers to it rather than racing it. It carries a **focus trap** — Task 8 ships the helper and this is its first new user, rather than a fifth overlay without one. And it resolves a **promise**, because `main.ts` shows the end screen behind it.

**Files:**
- Create: `packages/app/src/ui/outcome-moment.ts`
- Modify: `packages/app/src/ui/confirm.ts` (the `isDialogOpen` selector at 56 and its doc), `packages/app/src/ui/theme.css`, `packages/app/src/i18n/en.json`
- Test: `packages/app/src/ui/outcome-moment.test.ts`, `packages/app/src/ui/confirm.test.ts` (extend)

**Interfaces:**
- Consumes: `panel` (`./panel`), `focusTrap` (Task 8), `t`, `Disposer` (`shell/router.ts`).
- Produces (Task 6 consumes these exact names):
  - `interface OutcomeMomentOptions { outcome: 'victory' | 'defeat'; title: string; line?: string; holdMs?: number }`
  - `interface OutcomeMoment { el: HTMLElement; done: Promise<void>; dismiss(): void }`
  - `function outcomeMoment(host: HTMLElement, o: OutcomeMomentOptions): OutcomeMoment`
  - `const OUTCOME_HOLD_MS: number`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/src/ui/outcome-moment.test.ts
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isDialogOpen } from './confirm';
import { OUTCOME_HOLD_MS, outcomeMoment } from './outcome-moment';

let host: HTMLElement;
beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('outcomeMoment', () => {
  it('covers the viewport and names the outcome in the DOM, not in a colour alone', () => {
    const m = outcomeMoment(host, { outcome: 'victory', title: 'Foothold taken' });
    expect(m.el.dataset.outcome).toBe('victory');
    expect(m.el.classList.contains('rl-outcome')).toBe(true);
    expect(m.el.getAttribute('role')).toBe('dialog');
    expect(m.el.getAttribute('aria-modal')).toBe('true');
    m.dismiss();
  });

  it('is a dialog to the game’s own handler-wide guard', () => {
    expect(isDialogOpen()).toBe(false);
    const m = outcomeMoment(host, { outcome: 'defeat', title: 'Position lost' });
    expect(isDialogOpen()).toBe(true);
    m.dismiss();
    expect(isDialogOpen()).toBe(false);
  });

  it('holds, then resolves on its own', async () => {
    const m = outcomeMoment(host, { outcome: 'victory', title: 'x' });
    let settled = false;
    void m.done.then(() => { settled = true; });
    vi.advanceTimersByTime(OUTCOME_HOLD_MS - 1);
    await Promise.resolve();
    expect(settled).toBe(false);
    vi.advanceTimersByTime(2);
    await Promise.resolve();
    expect(settled).toBe(true);
  });

  // titleCard's rule (motion.ts:106-107): a held card the player cannot skip
  // is a held card the player resents.
  it('any key skips it, at once, regardless of the hold', async () => {
    const m = outcomeMoment(host, { outcome: 'victory', title: 'x' });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q' }));
    await expect(m.done).resolves.toBeUndefined();
  });

  it('a click skips it too', async () => {
    const m = outcomeMoment(host, { outcome: 'defeat', title: 'x' });
    window.dispatchEvent(new PointerEvent('pointerdown'));
    await expect(m.done).resolves.toBeUndefined();
  });

  // The game's Escape opens the pause menu. While this is up it must not.
  it('stops a key from reaching the game at all', () => {
    const seen: string[] = [];
    window.addEventListener('keydown', (e) => seen.push(e.key));
    const m = outcomeMoment(host, { outcome: 'victory', title: 'x' });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(seen).toEqual([]);
    m.dismiss();
  });

  it('dismiss is idempotent, takes the node off, and settles done()', async () => {
    const m = outcomeMoment(host, { outcome: 'victory', title: 'x' });
    m.dismiss();
    m.dismiss();
    await expect(m.done).resolves.toBeUndefined();
    expect(host.childElementCount).toBe(0);
  });

  // A teardown mid-hold must not leave a pending promise that nothing settles
  // -- the failure `loading.ts`'s own `dispose()` doc comment describes.
  it('a teardown during the hold settles rather than hangs', async () => {
    const m = outcomeMoment(host, { outcome: 'defeat', title: 'x' });
    vi.advanceTimersByTime(OUTCOME_HOLD_MS / 2);
    m.dismiss();
    await expect(m.done).resolves.toBeUndefined();
  });

  // prefers-reduced-motion drops the animation and keeps the duration
  // (motion.ts:104-105) -- the hold is a JS timer, so it cannot be a
  // CSS transition that a media query switches off.
  it('holds for the same time with reduced motion', async () => {
    const m = outcomeMoment(host, { outcome: 'victory', title: 'x', holdMs: 1000 });
    let settled = false;
    void m.done.then(() => { settled = true; });
    vi.advanceTimersByTime(999);
    await Promise.resolve();
    expect(settled).toBe(false);
  });

  it('shows the mission’s own line when there is one, and nothing when there is not', () => {
    const a = outcomeMoment(host, { outcome: 'victory', title: 'x', line: 'The town is ours.' });
    expect(a.el.querySelector('.rl-outcome__line')?.textContent).toBe('The town is ours.');
    a.dismiss();
    const b = outcomeMoment(host, { outcome: 'victory', title: 'x' });
    expect(b.el.querySelector('.rl-outcome__line')).toBeNull();
    b.dismiss();
  });

  it('traps Tab inside itself', () => {
    const m = outcomeMoment(host, { outcome: 'victory', title: 'x' });
    const skip = m.el.querySelector<HTMLElement>('.rl-outcome__skip');
    skip?.focus();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
    expect(m.el.contains(document.activeElement)).toBe(true);
    m.dismiss();
  });
});
```

`en.json`:

```json
  "outcome.victory": "Objective secured",
  "outcome.defeat": "Attempt failed",
  "outcome.skip": "Continue"
```

- [ ] **Step 2: Implement**

`.rl-outcome` is `position: fixed; inset: 0` with a `--outcome-scrim` background built by `color-mix()` from `--panel-bg-solid` — no literal, and no new palette row. The title uses `--font-display` at `--t-xl`, the line at `--t-m`, both `rem`. `data-outcome` carries `victory`/`defeat` and CSS reads it for the band colour, so the outcome is in the DOM as well as in the colour (the CVD rule G0 #3 relabelled but did not relax). A visible `.rl-outcome__skip` button gives the moment a focusable element, a keyboard path and a stated affordance — Phase 4's "no hover-only affordance without a keyboard path" applies to skip-on-click too.

`confirm.ts`'s selector becomes `'.rl-confirm, .rl-pause, .rl-keys, .rl-outcome'`, with its doc comment extended the way `.rl-keys` extended it in Phase 2 — one paragraph, naming the same reason.

- [ ] **Step 3: Gates, falsify, commit**

Falsify: make the hold a CSS transition instead of a timer — the reduced-motion test goes red under fake timers because nothing settles. Falsify again: register the skip listeners on `m.el` instead of `window` — the any-key test goes red, which is the exact difference between "skippable" and "skippable if you happened to be focused inside it".

```bash
/usr/bin/git add packages/app/src/ui/outcome-moment.ts packages/app/src/ui/outcome-moment.test.ts packages/app/src/ui/confirm.ts packages/app/src/ui/confirm.test.ts packages/app/src/ui/theme.css packages/app/src/i18n/en.json
/usr/bin/git commit -s -- <the same paths>
```

Message: `feat(shell): a held full-screen moment for the two outcomes that matter`, body recording which four `titleCard` rules were inherited and which three were not, and both mutations seen red.

---

### Task 6: The moment in the mission, and a victory the harness can photograph

The wiring, and the capture debt R-12 names. `main.ts`'s `missionEnd` handler (`:3675-3704`) already closes the pause menu, the tracker and F1 before pushing `showEndScreen`; the moment goes in front of `showEndScreen` and behind the ledger write.

Two facts fix the insertion point exactly. The ledger is saved at `main.ts:3528` and the brigade paid at `:3540`, both before `showEndScreen` at `:3691` — so **the moment cannot delay a write that has already happened** (R-6), and a player who closes the tab during the hold loses nothing. And the handler is synchronous inside the event loop, so the moment is created, its `dismiss` pushed onto `screenDisposers`, and `showEndScreen` called from `.then()` behind a `disposed` guard — the same ordering rule D-23 states for `bootBattlefield`'s eight guards, for the same reason.

**And it breaks `shoot.ts` by construction.** `16-end-defeat` waits on `.rl-endnav` (`shoot.ts:474`), which is now behind a held dialog; without a dismissal that capture times out at 15 s. This task fixes that and adds the victory the header comment says "stays a manual capture" (`:460-462`).

**Files:**
- Modify: `packages/app/src/main.ts` (3675-3704), `tools/src/ui-review/shoot.ts` (the end block at 455-479)
- Test: no new unit test file — `main.ts` has none and gains none (D-18). The evidence is the driven check and the two captures.

**Interfaces:**
- Consumes: `outcomeMoment`, `OutcomeMoment` (Task 5); `me.result`, `debrief` (already in scope at `main.ts:3660-3666`).
- Produces: capture states `16-end-defeat` (unchanged name, new preceding step) and `24-outcome-victory`.

- [ ] **Step 1: Write the failing capture, then the wiring**

There is no unit seam here, so the failing artefact is the capture script. Extend `shoot.ts`'s end block:

```ts
    // The moment (Task 5) is a held full-screen dialog in front of the end
    // screen. Photograph it FIRST, then skip it -- without the skip the
    // `.rl-endnav` wait below times out, which is how this line was found.
    await page.waitForSelector('.rl-outcome', { timeout: 15000 });
    await shot(page, dir, '25-outcome-defeat');
    await page.click('.rl-outcome__skip');
    await page.waitForSelector('.rl-endnav', { timeout: 15000 });
    await shot(page, dir, '16-end-defeat');
```

and add a victory pass of its own. There is no `debugWin`, and adding one would be a sim change; the victory is driven through the mission's own objectives on `beit_sahwan_1_recon`, whose primaries are reconnaissance positions the harness can reach by waypoint the way `playtest.ts`'s own recon plan does. If that proves too long for the capture pass's budget, the fallback stated here and taken deliberately is: capture the victory from a mission whose primary is `survive_until`, by `__lions.step(n)` past its clock with no enemy contact. **What is not acceptable is leaving victory uncaptured**, because the moment differs by outcome and a defeat-only pass photographs half the feature.

- [ ] **Step 2: Implement the wiring**

```ts
            const moment = outcomeMoment(document.body, {
              outcome: me.result === 'victory' ? 'victory' : 'defeat',
              title: t(me.result === 'victory' ? 'outcome.victory' : 'outcome.defeat'),
              line: debrief?.text,
            });
            screenDisposers.push(() => moment.dismiss());
            void moment.done.then(() => {
              if (disposed) return;
              screenDisposers.push(showEndScreen(document.body, { /* unchanged */ }));
            });
```

`debrief?.text` is the mission's own authored line, already resolved at `:3660-3666` and already shown by `showEndScreen`; passing it here means the moment says something specific rather than a generic word, and it goes through `textContent`, never `innerHTML`.

- [ ] **Step 3: Gates, drive, falsify, commit**

Gate line: the standard five plus `pnpm ui:routes` (a new `document.body` child on the mission's disposer chain is exactly what that walk counts) and `pnpm ui:shots` (the two captures above, at all three resolutions).

Drive it: `pnpm dev`, play `beit_sahwan_1_recon` to a real victory, watch the moment hold and skip it, and confirm the end screen and then the debrief appear in that order. Then lose one deliberately and confirm the defeat moment. Both in the task report.

Falsify: remove the `disposed` guard from the `.then()` and leave a mission during the hold — the end screen mounts on a body the router has already cleared and `ui:routes` counts one child too many. Construct it, see it red, restore it.

```bash
/usr/bin/git add packages/app/src/main.ts tools/src/ui-review/shoot.ts
/usr/bin/git commit -s -- <the same paths>
```

Message: `feat(shell): the outcome moment runs before the debrief, and the pass photographs both`, body recording that the ledger write precedes it, that `16-end-defeat`'s wait had to be taught to skip, and the mutation seen red.

---

### Task 7: Composed layouts at 1920 and 2560, and D-8's number

§6's last bullet, and the acceptance clause that is a measurement: *"the capture pass shows one colour register across menu, board, briefing and mission (measured: the plate's and the mission's mean luminance and saturation within 10% of each other)"* — the luminance half of which belongs to the scene host and the art pass, and the **layout** half of which is here.

Three things are settled before any CSS is written (R-7). The two breakpoints stay two: `1900px → --ui-scale: 1.15` and `2400px → 1.4` (`theme.css:294-295`), both `px-ok`-tagged because they set the scale rather than consume it. **1280 is a fit floor, not a breakpoint** — it appears nowhere in `theme.css` and is enforced by nothing; this task's acceptance checks it and adds no query for it. And **D-8 gets a number here**: Phase 0 explicitly deferred the menu-column-at-2560 acceptance with "Phase 3's acceptance owns the number", and punting a third time is not an option this plan leaves.

The candidates, listed rather than assumed, and the task's first job is to choose among them with a capture rather than an argument: (a) grid-area composition of the menu over the diorama, against today's centred column; (b) a `max-width` keyed to the `--ui-scale` bands rather than to raw `vw`; (c) revisiting `--menu-col` (`theme.css:2396`, `min(28.75rem, 92vw)`) now that Phase 3 supplies a background the Phase 0/1 formula did not have. **Take the capture first**: `pnpm ui:shots` at 1920 and 2560 on `01-menu`, `02-campaign` and `05-briefing`, look at the three, then write the rule.

**Files:**
- Modify: `packages/app/src/ui/theme.css`, `tools/src/ui-review/shoot.ts` (if a state is added)
- Test: `packages/app/src/ui/theme.test.ts` (extend, or create alongside the existing `brigade.test.ts` precedent of reading `theme.css` off disk)

**Interfaces:** none exported. The contract is the acceptance number and the capture.

- [ ] **Step 1: Write the failing test**

The type floor is already gated from disk by `brigade.test.ts`, and this is that pattern's second user: a test that reads `theme.css`, so the number becomes a gate rather than a note.

```ts
// packages/app/src/ui/theme.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./theme.css', import.meta.url), 'utf8');

describe('composed layouts (D-8)', () => {
  // The scale is one number and it has two steps. A third would move every
  // screen in the product to buy two, which is what R-7 refuses.
  it('has exactly two --ui-scale breakpoints, both tagged px-ok', () => {
    const steps = [...css.matchAll(/@media \(min-width: (\d+)px\)[^{]*\{\s*:root \{ --ui-scale/g)];
    expect(steps.map((m) => m[1])).toEqual(['1900', '2400']);
    for (const m of steps) {
      const line = css.slice(0, m.index).split('\n').length;
      expect(css.split('\n')[line - 1]).toContain('/* px-ok */');
    }
  });

  // D-8: Phase 0 deferred the number with "Phase 3's acceptance owns the
  // number". This is it, and it is in the file rather than in a plan.
  it('declares the composed menu column, and says what it is a fraction of', () => {
    expect(css).toMatch(/--menu-col-wide:/);
    expect(css).toMatch(/D-8/);
  });

  it('the composed grid is declared for the wide band only — 1280 stays one column', () => {
    const wide = css.slice(css.indexOf('@media (min-width: 1900px)'));
    expect(wide).toMatch(/grid-template-columns/);
  });
});
```

- [ ] **Step 2: Implement**

Whatever the capture chose, with the number written into `theme.css` as a comment naming D-8 and the measurement that set it (the menu column's own width as a fraction of 2560, at the scale in force there). If the answer turns out to be that the current formula is already right at 2560 — which the capture may show, since `--ui-scale: 1.4` multiplies `28.75rem` into a genuinely wide column — **say that, with the measured fraction, and discharge D-8 with "no change, and here is why"**. That is a discharge; "still open" is not.

- [ ] **Step 3: Gates, capture, falsify, commit**

`pnpm ui:shots` at all three widths, plus `pnpm ui:shots -- --pseudo` at 2560 specifically: the wide band is where a 40%-padded locale has the most room and the least excuse, and the overflow probe's bottom line (`shoot.ts`'s final `console.log`) goes in the task report even at zero, because "no overflow reported" and "the probe never ran" look identical otherwise.

Fit-check 1280 by hand at the end and record the result; nothing enforces it and this task does not add enforcement.

Falsify: add a third `--ui-scale` breakpoint — the first test goes red.

```bash
/usr/bin/git add packages/app/src/ui/theme.css packages/app/src/ui/theme.test.ts tools/src/ui-review/shoot.ts
/usr/bin/git commit -s -- <the same paths>
```

Message: `feat(shell): composed layouts at 1920 and 2560, and D-8 gets its number`, body carrying the measured fraction, the 1280 fit result, the overflow-probe line and the mutation seen red.

---

### Task 8: One focus trap, four overlays — and a keycap that survives the pseudo-locale

R-9's first half. Three overlays each let `'Tab'` through their capture-phase guard uncaught and say so in a comment — `pause.ts:230`, `confirm.ts:207` (whose own comment names Tab and Shift+Tab as "the browser's" to handle), `keys-overlay.ts:146` — and each restores focus to its opener on close but nothing cycles Tab while it is open. The objective tracker is a fourth: `main.ts:2332` records that `isDialogOpen()` "does not know about `.rl-obj-panel--tracker`". Phase 2 deferred a real trap explicitly (`keys-overlay.ts:145`, "a full focus trap is deferred, this is just give the keyboard back"). One helper closes all four, and Task 5's moment is built on it rather than becoming a fifth.

Folded in because the file is already open: `keys-overlay.ts:98` composes a keycap as `` `${t('keymap.modifier.ctrl')}${key}` `` — the concatenation-around-`t()` shape the i18n validator's sink-adjacent regex cannot see and a pseudo pass renders as a bracketed fragment glued to a bare letter. It becomes one catalogue key with two params.

**Files:**
- Create: `packages/app/src/ui/focus-trap.ts`
- Modify: `packages/app/src/ui/pause.ts` (230-238), `packages/app/src/ui/confirm.ts` (200-210), `packages/app/src/ui/keys-overlay.ts` (98, 140-155), `packages/app/src/main.ts` (the tracker mount at 2358), `packages/app/src/i18n/en.json`
- Test: `packages/app/src/ui/focus-trap.test.ts`, `packages/app/src/ui/pause.test.ts`, `packages/app/src/ui/confirm.test.ts`, `packages/app/src/ui/keys-overlay.test.ts` (extend all three)

**Interfaces:**
- Produces: `function focusTrap(root: HTMLElement): Disposer` — installs a capture-phase `keydown` on `window` that cycles Tab/Shift+Tab within `root`'s focusable descendants and does nothing else.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/src/ui/focus-trap.test.ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { focusTrap } from './focus-trap';

const build = (): HTMLElement => {
  const outside = document.createElement('button');
  outside.textContent = 'outside';
  const box = document.createElement('div');
  box.innerHTML =
    '<button id="a">a</button><button id="b" disabled>b</button>' +
    '<a id="c" href="#x">c</a><input id="d">';
  document.body.append(outside, box);
  return box;
};
afterEach(() => document.body.replaceChildren());

const tab = (shift = false): void => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, cancelable: true }));
};

describe('focusTrap', () => {
  it('wraps from the last focusable to the first', () => {
    const box = build();
    const off = focusTrap(box);
    box.querySelector<HTMLElement>('#d')?.focus();
    tab();
    expect(document.activeElement?.id).toBe('a');
    off();
  });

  it('wraps backwards from the first to the last', () => {
    const box = build();
    const off = focusTrap(box);
    box.querySelector<HTMLElement>('#a')?.focus();
    tab(true);
    expect(document.activeElement?.id).toBe('d');
    off();
  });

  it('skips a disabled control rather than parking focus on it', () => {
    const box = build();
    const off = focusTrap(box);
    box.querySelector<HTMLElement>('#a')?.focus();
    tab();
    expect(document.activeElement?.id).toBe('c');
    off();
  });

  // The bug this exists for: Tab from inside an open dialog reaching the
  // page behind it.
  it('pulls focus back in when it has escaped to the page', () => {
    const box = build();
    const off = focusTrap(box);
    document.querySelector<HTMLElement>('button')?.focus();
    tab();
    expect(box.contains(document.activeElement)).toBe(true);
    off();
  });

  it('leaves every other key alone', () => {
    const box = build();
    const off = focusTrap(box);
    let seen = 0;
    window.addEventListener('keydown', () => seen++);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(seen).toBe(1);
    off();
  });

  it('a root with nothing focusable is a no-op, not a throw', () => {
    const empty = document.createElement('div');
    document.body.appendChild(empty);
    const off = focusTrap(empty);
    expect(() => tab()).not.toThrow();
    off();
  });

  it('the disposer takes the listener off and is idempotent', () => {
    const box = build();
    const off = focusTrap(box);
    off();
    off();
    document.querySelector<HTMLElement>('button')?.focus();
    tab();
    expect(box.contains(document.activeElement)).toBe(false);
  });
});
```

And one test per existing overlay, in its own file, of the same shape: open it, focus its last control, Tab, assert focus is still inside. Plus, in `keys-overlay.test.ts`:

```ts
  it('composes a Ctrl keycap as one catalogue entry, not by concatenation', () => {
    const h = mount({ bindings: () => ({ ...BINDINGS, groupAssign: 'Digit1' }) });
    const caps = [...h.el.querySelectorAll('.rl-keys__cap')].map((e) => e.textContent);
    expect(caps.some((c) => c?.includes('Ctrl'))).toBe(true);
    // The failure this pins: under the pseudo-locale the modifier is
    // bracketed and the key is not, so a concatenation reads as two words.
    expect(caps.every((c) => c !== null && !/\]\w/.test(c))).toBe(true);
    h.dispose();
  });
```

`en.json`:

```json
  "keymap.cap.modified": "{modifier}{key}"
```

- [ ] **Step 2: Implement**

`focus-trap.ts` queries `root` for `'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'` **at keypress time, not at install time** — every one of these four overlays rebuilds its body (the tracker repaints from a thunk; F1 re-renders on a rebind) and a list captured at install goes stale silently. The listener is capture-phase on `window`, matching the guard each file already installs, and it `preventDefault()`s only when it moves focus.

Wire it: `pause.ts` after its panel is built, `confirm.ts` beside its `opener` capture, `keys-overlay.ts` in place of the deferral comment (which is deleted, not left contradicting the code), and `main.ts`'s tracker mount at `:2358`. Each file's existing `'Tab'` pass-through comment is rewritten to say the trap now handles it; **do not leave a comment claiming Tab is the browser's job.**

- [ ] **Step 3: Gates, falsify, commit**

Falsify: query the focusables at install time instead of at keypress — the trap still passes its own tests and goes red on the tracker's test after a `refresh()`, which is the whole reason for the choice. Construct it, see it red.

`pnpm ui:shots -- --pseudo` for the keycap, and read `20-keys` at 1400 specifically.

```bash
/usr/bin/git add packages/app/src/ui/focus-trap.ts packages/app/src/ui/focus-trap.test.ts packages/app/src/ui/pause.ts packages/app/src/ui/pause.test.ts packages/app/src/ui/confirm.ts packages/app/src/ui/confirm.test.ts packages/app/src/ui/keys-overlay.ts packages/app/src/ui/keys-overlay.test.ts packages/app/src/main.ts packages/app/src/i18n/en.json
/usr/bin/git commit -s -- <the same paths>
```

Message: `fix(shell): one focus trap for four overlays, and a keycap the pseudo-locale can read`, body naming the three deferral comments deleted and the mutation seen red.

---

### Task 9: The board's pins answer the cursor

R-8. The flat board has had the pattern since Phase 1 — `mouseenter`/`mouseleave`/`focusin`/`focusout` toggling `data-hover`, on region groups (`worldmap.ts:154-157`) and on town markers (`:192-195`), each gated on "is this really a control". The diorama board has none: its pins (`worldmap3d.ts:249-275`) get no pointer listener at all, and `speak()` fires only from `onPick` (`:345-378`), on click.

Two halves, both app-side. The **pins** get the flat board's four listeners and a preview of the sentence a click would say — without `point()` and without `navigate()`, because the `opening` branch navigates and a hover that navigated would make the board unusable. The **ground** gets its preview from the view's existing `hovered` getter (`world-view.ts:128`), read inside the `onFrame` callback the screen already receives (`:441`); the only edit outside `worldmap3d.ts` is one line added to the app's own restated `MountedView` interface (`:97-101`). No file under `packages/render/` is opened.

The hover sentence and the click sentence must not be the same string with the same tone, or the player cannot tell a preview from a commitment. `pin-hover.ts` is the pure model that decides both.

**Files:**
- Create: `packages/app/src/ui/pin-hover.ts`
- Modify: `packages/app/src/ui/worldmap3d.ts` (the `MountedView` interface at 97-101; the pin loop at 249-275; `onPick` at 345-378; `onFrame` at 385+), `packages/app/src/ui/theme.css`, `packages/app/src/i18n/en.json`
- Test: `packages/app/src/ui/pin-hover.test.ts`, `packages/app/src/ui/worldmap3d.test.ts` (extend)

**Interfaces:**
- Produces:
  - `interface PinState { status: RegionStatus; regionName: string; lockedBecause?: string; nextMissionName?: string }`
  - `function hoverLine(s: PinState): { key: string; params: Record<string, string>; tone: 'hint' | 'good' | 'bad' | 'info' }`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/src/ui/pin-hover.test.ts
import { describe, expect, it } from 'vitest';
import { hoverLine } from './pin-hover';

describe('hoverLine', () => {
  // The locked reason is the one thing a click already says that a player
  // most wants BEFORE clicking: the ground is one canvas, so a click that
  // resolves to "you cannot" is a wasted click.
  it('previews the reason a locked region is locked', () => {
    expect(hoverLine({ status: 'locked', regionName: 'Sahar', lockedBecause: 'Conduct 70' })).toEqual({
      key: 'world3d.hover.locked',
      params: { region: 'Sahar', reason: 'Conduct 70' },
      tone: 'bad',
    });
  });

  it('falls back to a human reason rather than saying nothing', () => {
    expect(hoverLine({ status: 'locked', regionName: 'Sahar' }).params.reason).toBeTruthy();
  });

  it('says a region is empty rather than leaving it silent', () => {
    expect(hoverLine({ status: 'empty', regionName: 'Marj' }).key).toBe('world3d.hover.empty');
  });

  it('names the mission a click would open', () => {
    expect(
      hoverLine({ status: 'live', regionName: 'Sahar', nextMissionName: 'Foothold' })
    ).toEqual({
      key: 'world3d.hover.opening',
      params: { region: 'Sahar', mission: 'Foothold' },
      tone: 'good',
    });
  });

  // A preview and a commitment must not read identically -- the click
  // sentence says "opening", the hover says "opens".
  it('is a different catalogue key from the click sentence, for every status', () => {
    for (const s of ['locked', 'empty', 'live', 'done'] as const) {
      expect(hoverLine({ status: s, regionName: 'x' }).key).toMatch(/^world3d\.hover\./);
    }
  });

  it('a cleared region says so and does not promise a mission', () => {
    const l = hoverLine({ status: 'done', regionName: 'Sahar' });
    expect(l.key).toBe('world3d.hover.cleared');
    expect(l.params.mission).toBeUndefined();
  });
});
```

```ts
// packages/app/src/ui/worldmap3d.test.ts — append
  it('a hovered pin marks itself and previews, and never navigates', async () => {
    const nav: string[] = [];
    const h = await mount3d({ navigate: (u: string) => nav.push(u) });
    const pin = h.el.querySelector<HTMLElement>('.rl-world__town');
    pin?.dispatchEvent(new MouseEvent('mouseenter'));
    expect(pin?.dataset.hover).toBe('1');
    expect(h.el.querySelector('.rl-world__say')?.textContent).not.toBe(HINT);
    expect(nav).toEqual([]);
    pin?.dispatchEvent(new MouseEvent('mouseleave'));
    expect(pin?.dataset.hover).toBeUndefined();
    h.dispose();
  });

  it('leaving a pin puts the hint back rather than leaving the last preview up', async () => {
    const h = await mount3d({});
    const pin = h.el.querySelector<HTMLElement>('.rl-world__town');
    pin?.dispatchEvent(new MouseEvent('mouseenter'));
    pin?.dispatchEvent(new MouseEvent('mouseleave'));
    expect(h.el.querySelector('.rl-world__say')?.textContent).toBe(HINT);
    h.dispose();
  });

  // Keyboard parity, the rule Phase 4 depends on: no hover-only affordance.
  it('focus previews exactly as hover does', async () => {
    const h = await mount3d({});
    const pin = h.el.querySelector<HTMLElement>('.rl-world__town');
    pin?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(pin?.dataset.hover).toBe('1');
    h.dispose();
  });

  // A click's own sentence is a commitment and must survive a hover that
  // happened a frame earlier.
  it('a click still says the click sentence, not the preview', async () => {
    const h = await mount3d({});
    h.pick('sahar');
    const said = h.el.querySelector('.rl-world__say')?.textContent;
    expect(said).toBeTruthy();
    expect(said).not.toContain(HOVER_MARKER);
    h.dispose();
  });
```

`en.json`: five `world3d.hover.*` keys mirroring the five `world3d.say.*` ones, phrased as previews.

- [ ] **Step 2: Implement**

`pin-hover.ts` is a switch over `RegionStatus` returning a key/params/tone triple — deliberately the same shape `alerts.ts` returns, so `speak()` takes it unchanged. In `worldmap3d.ts` the pin loop gains the four listeners, gated on the same condition the `<a>` wrapper already is (`next !== null && p.status !== 'locked'` is the *link* gate; the hover gate is broader — a locked pin's reason is the most useful preview there is, so hover is gated on "the pin exists" and the tone carries the difference). Leaving restores `HINT`. `onFrame` reads the view's `hovered` and previews the region under the cursor the same way, debounced to changes only — `onFrame` runs every frame and rewriting an `aria-live` region 60 times a second would make a screen reader unusable.

`MountedView` gains `readonly hovered: string | null`. Check `worldmap3d.test.ts` for the existing subset assertion the file header mentions and extend it rather than adding a second.

- [ ] **Step 3: Gates, drive, falsify, commit**

Drive it: `pnpm dev`, `?campaign`, hover a locked town and read the reason without clicking; Tab to the same pin and confirm the identical line. Confirm a hover never navigates — that is the one failure that would make the screen worse than it is today.

Falsify: make `hoverLine` reuse the `world3d.say.*` keys — the "different catalogue key" test goes red.

`pnpm ui:routes` is in the gate line: this touches the campaign screen, which the walk passes through twice.

```bash
/usr/bin/git add packages/app/src/ui/pin-hover.ts packages/app/src/ui/pin-hover.test.ts packages/app/src/ui/worldmap3d.ts packages/app/src/ui/worldmap3d.test.ts packages/app/src/ui/theme.css packages/app/src/i18n/en.json
/usr/bin/git commit -s -- <the same paths>
```

Message: `feat(shell): the diorama's pins answer the cursor the way the flat board's do`, body recording that no render file was opened, that hover never navigates, and the mutation seen red.

---

### Task 10: The strip keeps its focus, and two `innerHTML` sinks stop trusting their input

R-9's second half, and the last ungated task. **This one touches `ui/hud.ts`, so it runs `pnpm golden-baseline` and may need the branch's one bless** — Phase 2's landing proved the plan text wrong on this and HANDOVER records it: "the HUD IS in the frame".

**Focus.** `Hud.onTick` calls `renderStrip` at 4 Hz (`hud.ts:786-787`) and `renderStrip` `innerHTML`s the whole strip body (`:969-1010`). Keyboard focus inside it therefore lasts at most 250 ms. `paintChipFocus` (`:728-734`) is the one place already patched around it, and its own comment says why — "Tab has to answer on the keystroke, not on the next 4 Hz rebuild 250 ms later" — with a `dataset` flag standing in for real focus. The fix is general: `renderStrip` records the focused descendant's stable identity before the swap and restores it after.

**Escaping.** `renderStrip` interpolates `${m.name}` raw into `innerHTML` (`:977`) while the `title` attribute on the very same line goes through `escapeAttr`; the objective row interpolates `${primary.text}` raw (`:998`). Both are mission-authored strings — `name` and `objectives[].text` are two of the three fields a mission may show — so this is not a security boundary so much as a correctness one: an apostrophe-free ampersand in a mission name renders as an entity today. `hud.note(html: string, …)` (`:844`) takes raw HTML by name and every caller passes a `t()` result, some with unit and mission names interpolated. And `escapeHtml` exists twice (`hud.ts:1637`, `mission-notice.ts:98`), a recorded Phase 1 deferred minor. One module, both copies deleted, the sinks fixed.

**Files:**
- Create: `packages/app/src/ui/escape-html.ts`
- Modify: `packages/app/src/ui/hud.ts` (`renderStrip` 969-1010, `note` 844, `escapeHtml` 1637), `packages/app/src/ui/mission-notice.ts` (98)
- Test: `packages/app/src/ui/escape-html.test.ts`, `packages/app/src/ui/hud.test.ts` (extend)

**Interfaces:**
- Produces: `function escapeHtml(s: string): string`, `function escapeAttr(s: string): string` — one module, both, with the doc comment `hud.ts:1625` already carries about why the two differ (`>` versus `"`).

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/src/ui/hud.test.ts — append
describe('the strip does not eat the keyboard', () => {
  it('keeps focus on the same control across a rebuild', () => {
    const h = rig({ mission: mission({ roe: 80 }) });
    const conduct = h.el.querySelector<HTMLElement>('[data-tip="conduct"]');
    conduct?.focus();
    h.hud.onTick();
    for (let i = 0; i < 5; i++) h.hud.onTick();
    expect(document.activeElement?.getAttribute('data-tip')).toBe('conduct');
    h.dispose();
  });

  it('keeps focus on an objective row identified by its own id, not by index', () => {
    const h = rig({ mission: mission({ objectives: TWO_OBJECTIVES }) });
    h.el.querySelector<HTMLElement>('[data-obj="hold_town"]')?.focus();
    for (let i = 0; i < 5; i++) h.hud.onTick();
    expect(document.activeElement?.getAttribute('data-obj')).toBe('hold_town');
    h.dispose();
  });

  it('does not steal focus when nothing in the strip had it', () => {
    const h = rig({ mission: mission({ roe: 80 }) });
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    for (let i = 0; i < 5; i++) h.hud.onTick();
    expect(document.activeElement).toBe(outside);
    h.dispose();
  });

  it('drops focus cleanly when the control it was on is gone', () => {
    const h = rig({ mission: mission({ objectives: TWO_OBJECTIVES }) });
    h.el.querySelector<HTMLElement>('[data-obj="hold_town"]')?.focus();
    h.setMission(mission({ objectives: [] }));
    for (let i = 0; i < 5; i++) h.hud.onTick();
    expect(document.activeElement).toBe(document.body);
    h.dispose();
  });
});

describe('the strip and the feed escape what a mission authored', () => {
  it('renders an ampersand in a mission name as one character', () => {
    const h = rig({ mission: mission({ name: 'Rest & Refit' }) });
    expect(h.el.querySelector('.rl-strip__name')?.textContent).toBe('Rest & Refit');
    h.dispose();
  });

  it('does not let an objective’s own text open a tag', () => {
    const h = rig({ mission: mission({ objectives: [{ ...OBJ, text: 'Hold <b>the</b> line' }] }) });
    const row = h.el.querySelector('.rl-strip__obj');
    expect(row?.querySelector('b')).toBeNull();
    expect(row?.textContent).toContain('<b>');
    h.dispose();
  });

  it('a note carrying a unit name renders it as text', () => {
    const h = rig({});
    h.hud.note(escapeHtml('D9 <Doobi>'), 'info');
    expect(h.el.querySelector('.rl-notice')?.textContent).toBe('D9 <Doobi>');
    h.dispose();
  });
});
```

```ts
// packages/app/src/ui/escape-html.test.ts
import { describe, expect, it } from 'vitest';
import { escapeAttr, escapeHtml } from './escape-html';

describe('escapeHtml', () => {
  it('escapes the four that open a tag or an entity', () => {
    expect(escapeHtml('<a & "b" \'c\'>')).toBe('&lt;a &amp; "b" \'c\'&gt;');
  });
  it('escapes the ampersand first, so nothing is double-escaped', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });
  it('leaves ordinary text alone', () => {
    expect(escapeHtml('Rest and Refit')).toBe('Rest and Refit');
  });
});

describe('escapeAttr', () => {
  // The two differ and hud.ts:1625 already says how: one escapes `>`, the
  // other `"`, and swapping them is a silent hole.
  it('escapes the quote an attribute is delimited by', () => {
    expect(escapeAttr('a "b" c')).toBe('a &quot;b&quot; c');
  });
  it('is not escapeHtml', () => {
    expect(escapeAttr('<')).not.toBe(escapeHtml('<'));
  });
});
```

- [ ] **Step 2: Implement**

`renderStrip` gains, around the `innerHTML` assignment: read `document.activeElement`; if it is inside the strip, remember the value of whichever of `data-obj` / `data-tip` / `data-act` it carries, plus its tag; after the swap, query for the same selector and `focus()` it if it exists. Nothing else. **Do not** cache the element itself — it is about to be destroyed — and **do not** focus anything when nothing in the strip was focused, which is the test above that would otherwise catch a strip that steals the keyboard from the game every 250 ms.

`escape-html.ts` takes `hud.ts:1637`'s body and `escapeAttr`'s beside it; both old copies are deleted and their importers re-pointed. `renderStrip`'s two raw interpolations become `escapeHtml(...)`. `note`'s signature and its `innerHTML` stay — it is named `html` and some callers legitimately pass markup — but every `main.ts` call site interpolating a unit or mission name wraps that value in `escapeHtml`, and `note`'s doc comment gains the sentence saying so.

- [ ] **Step 3: Gates, capture, bless, falsify, commit**

`pnpm golden-baseline`. If the four gated scenarios move, read the numbers, download the `visual-baseline-bless-captures` artifact, look at the picture, and take **the branch's one bless** from CI numbers per the protocol. If they do not move, say so with the numbers — that is the more likely outcome, since the strip's content is unchanged and only its escaping and focus behaviour differ, but "should not move" is not a measurement.

`pnpm ui:shots` for `06-hud-idle` and `18-hud-alert` before and after.

Falsify: restore the focus by INDEX instead of by `data-obj` — the objective-row test goes red as soon as an objective completes and the row order changes, which is the specific failure the id-keyed version exists for.

```bash
/usr/bin/git add packages/app/src/ui/escape-html.ts packages/app/src/ui/escape-html.test.ts packages/app/src/ui/hud.ts packages/app/src/ui/hud.test.ts packages/app/src/ui/mission-notice.ts
/usr/bin/git commit -s -- <the same paths>
```

Message: `fix(hud): the strip keeps the keyboard, and stops trusting what a mission authored`, body carrying the golden numbers (moved or unmoved), the two `escapeHtml` copies deleted, and the mutation seen red.

---

## The gated tasks — after G1 approves the symbol sheet

Both of these consume the twelve-glyph sheet, and the issue body's own words are: **"The sheet is approved at G1 before anything consumes it."** That is an **entry condition, not a date** — G1 (#165) is due 2 October but what gates these is the answer, not the calendar.

**Before starting either one:**

```bash
gh issue view 165                                  # is the symbol sheet answered?
/usr/bin/git fetch origin
/usr/bin/git log --oneline origin/main -20         # has anything landed under packages/app?
/usr/bin/git merge origin/main                     # merge, do not rebase; resolve on this branch
pnpm install && pnpm test                          # the merged tree is green before a line is written
```

If G1 has not answered the sheet, **stop and report** rather than inventing twelve glyphs. Tasks 1–10 are a complete, landable branch on their own and these two can follow in a second landing. The addendum in "Open questions for G1" below must be answered in the same breath, because it decides whether the sheet is twelve glyphs or nineteen.

---

### Task 11: The symbol sheet, and the check that keeps the dingbats out

§6: "Twelve drawn glyphs at one weight derived from the chevron's angles, as an SVG sprite: seven roles and five verbs, tested at 10 px over lit sand."

The geometry's DNA is `ui/mark.ts`'s `chevron(x)` (`mark.ts:10-12`, `M${x} 2 L${x+12} 2 L${x+26} 26 L${x+12} 50 L${x} 50 L${x+14} 26 Z` in an 86×52 viewBox), the sole primitive behind the game's own mark (`markSvg`, `:20-30`) — its sweep angle is the shared weight the twelve inherit. The sprite mechanism is SVG-string constants in the module, `role.ts`/`mark.ts`'s own pattern: both that and an inline `<symbol>` set in `index.html` pass `pnpm validate:ui`'s scan (`.ts/.css/.html/.svg`, `validate_ui_palette.mjs:48`) provided fills stay `currentColor`, and constants keep the twelve in one file with their tests.

The check is the acceptance clause made mechanical (R-10): an exported `dingbatFailures(file, src)` in `tools/validate_ui_palette.mjs`, over a **named list**, not a Unicode range — `°` in the board's bearing readout and `·` in a dozen separators are typography, and a range would eat both.

**The `★` exception, and where it stands** (added by the final review's fix wave, ruling 7). `★` is NOT on the named list: it is a repeated countable mark (`'★'.repeat(n)`), not an icon, so the list's comment must name it as an approved exception — with its sites, so the next reader can tell a decision from an oversight — unless G1 answers otherwise (see "Open questions for G1"). Every site that renders one, re-verified on `feat/shell-phase-3-app` at `4397e7c7`:

- `packages/app/src/ui/loading.ts:166-176` — `commendation()`, the one `★` site in that file (its doc comment at 166-172, the glyph at 176), serving both the brought panel's rows and the deploy spread's rows;
- `packages/app/src/ui/hud.ts:1752` — the single-unit card's veterancy stripe (1737 before the fix wave added `suppressEndBanner` above it);
- `packages/app/src/ui/debrief.ts:74` — a won mission's stars; `debrief.ts:167` — a promotion's stars;
- `packages/app/src/ui/worldmap.ts:210` — a town pin's earned/possible stars; `worldmap.ts:317` — the ledger line's veteran count;
- `packages/app/src/ui/worldmap3d.ts:301` — the diorama pin's earned/possible stars;
- `packages/app/src/campaign.ts:473` — `campaignSummary`'s veteran count, which reaches the strip's campaign tooltip through `main.ts`'s `getMission`. Found by the re-verification, not in the fix wave's list, and inside `validate_ui_palette.mjs`'s scan root (`packages/app/src`), so the check will see it.
- `packages/app/src/i18n/en.json:402` — `dock.lock.stars` (`"★ ≥{n}"`), a locked dock tile's star gate, rendered through `ui/dock-model.ts:114` (`lockLabel`);
- `packages/app/src/i18n/en.json:445` — `gate.short.stars` (`"{n}★"`), the short star gate, rendered through `gate-sentence.ts:116`.

**The two catalogue sites are invisible to the validator as it stands**: `validate_ui_palette.mjs`'s `EXTS` is `.ts`, `.css`, `.html` and `.svg`, so `.json` is never read, and the `.ts` lines that render them (`dock-model.ts:114`, `gate-sentence.ts:116`) hold only a `t()` key. A `dingbatFailures` pass over today's file set would report neither, so the named list must record them by key, or the check must read `en.json` too. (These two and the comment below were added by the re-review after the fix wave; each line re-read on this branch after `dd3939c4`.)

Four more `★` are prose inside comments and render nothing: `roster-cap.ts:4`, `campaign.ts:494`, `gate-sentence.ts:92`, and `ui/theme.css:3654` (3643 at `dd3939c4`; the fix wave's `.rl-endaftermath` rule landed above it) — the last in a `.css` file, which IS a scanned type. Test files are outside the scan. If the list's check reads comments, it must skip these rather than fail on them.

**Files:**
- Create: `packages/app/src/ui/symbol.ts`
- Modify: `tools/validate_ui_palette.mjs`, `packages/app/src/ui/theme.css`
- Test: `packages/app/src/ui/symbol.test.ts`, `tools/validate_ui_palette.test.mjs` (extend, or create alongside the existing exported-checker precedent)

**Interfaces:**
- Produces: `type SymbolId = RoleBucket | OrderId`; `function symbolSvg(id: SymbolId, size: number): string`; `const SYMBOL_IDS: readonly SymbolId[]`; `export function dingbatFailures(file, src)` in the validator.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/src/ui/symbol.test.ts
import { describe, expect, it } from 'vitest';
import { SYMBOL_IDS, symbolSvg } from './symbol';

describe('the symbol family', () => {
  it('is twelve — seven roles and five verbs', () => {
    expect(SYMBOL_IDS).toHaveLength(12);
    expect(new Set(SYMBOL_IDS).size).toBe(12);
  });

  it('every glyph fills with currentColor and names no palette variable', () => {
    for (const id of SYMBOL_IDS) {
      const svg = symbolSvg(id, 16);
      expect(svg).toContain('currentColor');
      expect(svg).not.toMatch(/#[0-9a-fA-F]{3}/);
      expect(svg).not.toContain('var(--');
    }
  });

  it('shares one viewBox, so twelve glyphs sit on one baseline', () => {
    const boxes = new Set(SYMBOL_IDS.map((id) => /viewBox="([^"]+)"/.exec(symbolSvg(id, 16))?.[1]));
    expect(boxes.size).toBe(1);
  });

  it('honours the size it is asked for', () => {
    expect(symbolSvg('armour', 10)).toContain('width="10"');
    expect(symbolSvg('armour', 24)).toContain('width="24"');
  });

  // §6: "tested at 10 px over lit sand". A glyph whose ink is a hairline
  // vanishes at that size, so the proxy is stroke/path weight relative to
  // the shared viewBox -- measured, not eyeballed.
  it('carries enough ink to read at 10 px', () => {
    for (const id of SYMBOL_IDS) {
      const svg = symbolSvg(id, 10);
      const w = /stroke-width="([\d.]+)"/.exec(svg);
      if (w) expect(Number(w[1])).toBeGreaterThanOrEqual(MIN_STROKE);
    }
  });

  it('is derived from the chevron’s own sweep, not redrawn per glyph', () => {
    // The shared angle appears in every path that has a diagonal at all.
    const withDiagonals = SYMBOL_IDS.map(symbolAt16).filter((s) => /L\d+ \d+/.test(s));
    expect(withDiagonals.length).toBeGreaterThan(0);
    for (const s of withDiagonals) expect(s).toContain(CHEVRON_SWEEP);
  });
});
```

```js
// tools/validate_ui_palette.test.mjs — append
describe('dingbatFailures', () => {
  it('names a listed dingbat, with its line', () => {
    const out = dingbatFailures('ui/hud.ts', 'info.push("▣ " + x);\n');
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('ui/hud.ts:1');
  });

  it('is silent on typography that is not iconography', () => {
    expect(dingbatFailures('ui/worldmap3d.ts', 'b.textContent = "000°";')).toEqual([]);
    expect(dingbatFailures('ui/hud.ts', 'parts.join(" · ")')).toEqual([]);
  });

  it('is silent on a file that draws the glyph instead', () => {
    expect(dingbatFailures('ui/symbol.ts', 'export const SYMBOL_IDS = [];')).toEqual([]);
  });

  it('does not scan a test file — a test may quote what it forbids', () => {
    expect(dingbatFailures('ui/hud.test.ts', 'expect(x).toBe("▣");')).toEqual([]);
  });
});
```

- [ ] **Step 2: Implement**

Twelve SVG-string constants at one weight, one viewBox, `currentColor`, plus `symbolSvg(id, size)`. The list the validator checks is the sites gated Task 12 replaces, **plus whatever the lead approves in the addendum** — and the list is a named constant in the validator with a comment pointing at the G1 answer, so the next reader can tell an approved exception from an oversight.

The sweep is the sheet's, not this plan's. Whatever G1 approves is what ships; the tests above pin the *properties* (one viewBox, one weight, `currentColor`, legible at 10 px, the chevron's sweep where a diagonal exists) rather than the paths, so approving a different drawing does not rewrite the test file.

- [ ] **Step 3: Gates, falsify, commit**

**The falsification is the point of this task** (R-10, and CLAUDE.md's "every check gets an input that makes it fail"): put a listed dingbat back into a UI source file, run `pnpm validate:ui`, see it fail by name and line, and remove it. Record the exact output in the commit message. A check that has never been seen red is a check nobody has shown works.

```bash
/usr/bin/git add packages/app/src/ui/symbol.ts packages/app/src/ui/symbol.test.ts tools/validate_ui_palette.mjs tools/validate_ui_palette.test.mjs packages/app/src/ui/theme.css
/usr/bin/git commit -s -- <the same paths>
```

Message: `feat(shell): twelve glyphs at one weight, and a gate that keeps them there`, body quoting the failing validator output verbatim and naming the G1 answer the list came from.

---

### Task 12: Three drawn styles become one

§6: the twelve are "used by dock, cursor badge, order row and minimap". The brief found **three inconsistent systems plus raw Unicode**, and the inventory below is what this task retires.

1. **`roleBadgeShapes`** (`role.ts:117-166`) — seven bespoke hand-built SVG geometries, already `currentColor` and already palette-clean, wrapped by `roleBadgeSvg` (`:178-185`). Consumers: `production.ts:186, :293`; `hud.ts:1448, :1496, :1583`; `brigade.ts:375, :506`. Each shape is replaced by `symbolSvg`; **`roleBadgeSvg`'s signature does not change**, so the seven call sites are untouched and the diff stays readable.
2. **`ROLE_GLYPH`** (`role.ts:42-50`) — a second, Unicode, seven-entry role table (`✹ ⬡ ✈ ✛ ▤ ▲ ■`) whose only importer in the entire tree is its own test (`role.test.ts:9`). **Deleted** (R-11), along with the test line asserting each entry is truthy.
3. **`ORDERS[].glyph`** (`selection-model.ts:67-72`) — the five verbs as raw Unicode (`⟶ ■ ◌ ⤓ ⤒`), rendered as literal text at `hud.ts:1373`. The field's own comment says *"Unicode for now — GH-153 lists a drawn glyph set as its own ticket."* The field becomes an `OrderId` lookup through `symbolSvg` and the comment is deleted, not left stale.
4. **The cursor badge** (`packages/app/vite-plugin-cursors.ts`, 740 lines, its own "Tiberian heavy housing" system at `:16-24`, a role badge inset at `:42-48`) — it already reuses `RoleBucket` as *data* through `badgeFor`/`cursorKey` (`input/cursor.ts:288, :312`) and draws its own geometry inside the housing. The housing stays; the badge geometry becomes `symbolSvg`'s. This file is outside the palette scan root and is app-owned, so it is in scope — but it is the one place a mistake is invisible until a cursor is drawn, so `__lions.cursorKey()` (a DOM read-back by design, per CLAUDE.md) is the drive check.
5. **The minimap** — and here the brief found a hole worth reporting rather than filling. `dotShape(side)` (`minimap.ts:412-416`) is shape-coded by SIDE (square/triangle/circle), an accessibility channel (G0 decision #3), unrelated to role or verb; objectives draw a plain diamond (`:962`); **no dingbat and no role/verb badge exists anywhere in `minimap.ts`.** §6's "used by … minimap" matches nothing found there. **Re-check after Phase 2's Tasks 15–16 land** (they rewrite that file's terrain) and, if it is still true, record it as a spec bullet with no site rather than inventing one.

**Files:**
- Modify: `packages/app/src/ui/role.ts`, `packages/app/src/ui/selection-model.ts`, `packages/app/src/ui/hud.ts` (1373, 1045, 1048), `packages/app/src/ui/production.ts` (73-83, 252), `packages/app/vite-plugin-cursors.ts`
- Test: `packages/app/src/ui/role.test.ts`, `packages/app/src/ui/selection-model.test.ts`, `packages/app/src/ui/hud.test.ts`, `packages/app/src/ui/production.test.ts` (extend all)

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/src/ui/role.test.ts — replace the ROLE_GLYPH block
describe('the role badge is the symbol family', () => {
  it('draws every bucket from the shared sheet', () => {
    for (const b of BUCKETS) expect(roleBadgeSvg(b, 16)).toBe(symbolSvg(b, 16));
  });
  it('no longer exports a Unicode table', async () => {
    const mod = await import('./role');
    expect('ROLE_GLYPH' in mod).toBe(false);
  });
});
```

```ts
// packages/app/src/ui/selection-model.test.ts — append
it('every order’s mark is a drawn glyph, not a character', () => {
  for (const o of ORDERS) {
    expect(orderGlyphSvg(o.id, 16)).toContain('<svg');
    expect(orderGlyphSvg(o.id, 16)).toContain('currentColor');
  }
});
it('carries no Unicode glyph field at all', () => {
  for (const o of ORDERS) expect('glyph' in o).toBe(false);
});
```

```ts
// packages/app/src/ui/hud.test.ts — append
it('the order row draws glyphs and the strip carries no listed dingbat', () => {
  const h = rig({ selection: SQUAD });
  expect(h.el.querySelectorAll('.rl-order svg')).toHaveLength(5);
  for (const d of LISTED_DINGBATS) expect(h.el.innerHTML).not.toContain(d);
  h.dispose();
});
```

- [ ] **Step 2: Implement**

Swap each site to `symbolSvg`. `roleBadgeSvg` keeps its signature. `OrderSpec.glyph` is deleted and `hud.ts:1373` renders `orderGlyphSvg(row.id, size)`. `hud.ts:1045` and `:1048` (the `▣`/`◎` logistics and intel readouts) and `production.ts:73, :80` (`◎` sweep, `✸` strike) are replaced **only if the addendum approved glyphs for them**; if it did not, they stay and the validator's list does not name them — and the commit says which, so the next reader can tell a decision from an omission.

`vite-plugin-cursors.ts`'s badge inset takes `symbolSvg`'s path data. The housing (`:16-24`) is unchanged.

- [ ] **Step 3: Gates, capture, bless, drive, falsify, commit**

`pnpm golden-baseline` — this touches `ui/hud.ts` and, per the Global Constraints, the HUD is in the frame. Numbers in the report; a bless only if Task 10 did not already take the branch's one, and from CI numbers.

Drive it: `pnpm dev`, select a squad and read the five order marks; hover a hostile and read `__lions.cursorKey()` back for each of the thirteen `CursorName` states, confirming the badge draws. `pnpm ui:shots` for `06-hud-idle`, `07-hud-selection-squad` and `21-tooltip` at all three widths.

Falsify: restore one `ORDERS[].glyph` Unicode character and render it — `pnpm validate:ui` fails on the listed dingbat, and the hud test's `LISTED_DINGBATS` assertion goes red. Two checks, one mutation, both seen red.

```bash
/usr/bin/git add packages/app/src/ui/role.ts packages/app/src/ui/role.test.ts packages/app/src/ui/selection-model.ts packages/app/src/ui/selection-model.test.ts packages/app/src/ui/hud.ts packages/app/src/ui/hud.test.ts packages/app/src/ui/production.ts packages/app/src/ui/production.test.ts packages/app/vite-plugin-cursors.ts
/usr/bin/git commit -s -- <the same paths>
```

Message: `feat(shell): one drawn vocabulary replaces three, and the dingbats are gone`, body listing every site retired, naming which addendum items the lead approved and which were left, recording the minimap finding, and the mutation seen red.

---

## Out of scope

Each of these is Phase 3 work and none of it is in this plan. Named with its owner so nobody treats the omission as an oversight.

- **The scene host** — `packages/render/src/three/front/` (a new door in eslint's bundle rule) plus `ThreeRenderer.ts`: a held diorama behind the menu column on the mission pipeline, slow parallax on mouse, and the campaign screen's no-WebGL2 fallback pattern reused. **A separate later plan**, which cannot start until **WP-A1.3 (#177)** lands, because spec §10 allows one lane on `ThreeRenderer.ts` at a time. It also owns §7's "screens check gains the menu route: the scene host must report `data-host=live` on a WebGL2 runner".
- **The campaign board on the lit pipeline**, and its biome re-authored to the basin (Decision 2) — `world-view.ts` / `world-material.ts`, render lane. This worktree's CLAUDE.md confirms the board is still on `LinearSRGBColorSpace` and unmoved. Task 9 gives its pins a hover language without touching either file, which is the whole of the app's share of that bullet.
- **Portraits re-rendered through `lighting.ts`'s rig at full colour depth, and key art recomposited from engine renders** — art lane, and GH-153 for the Blender portraits. File-for-file replacements: no app code changes.
- **The garage's art pass** — turntable renders replacing `assets/ui/plates/units/` file for file, a bay backdrop from the diorama pipeline, veterancy marks and service records, and `pnpm icons:units` re-cropped from the new renders. D-20 is explicit: "Phase 3 replaces the plate FILES and nothing else", and `unitIcon`'s and the garage's callers see the new art with no code change.
- **Drawing the twelve glyphs.** Tasks 11–12 consume the sheet G1 approves; authoring it is a design task on the art lane.
- **The economy's loadout rules behind deploy-as-a-decision** — spec §8, verbatim: "Phase 3 shows and chooses the force the roster already computes; new rules are the economy work's". R-3 holds this plan to exactly that line: the player chooses WHO fills the mission's own draws and never how many.
- **The roster cap and the reserve list** — WP-G-E2 (#174), Lane B. Task 1's `DeployRosterView` is the seam; E2 owns the other side and fills the `cap` field this plan leaves `null`.
- **§7's two remaining blind-spot instruments** — a motion capture (a frame series over the menu entrance and the first thirty seconds of a mission) and one observed unassisted first-player session, both owed "before Phase 3's acceptance". Neither is code and neither is in this branch; both belong to whoever closes Phase 3, and the fourth blind spot (a reading pass against shipped RTS shells) is a reading task the spec assigns to Phase 3's plan author and is recorded here as unstarted.
- **`packages/sim/**`** — untouched, and `git diff --stat -- packages/sim` is empty at landing.

## Open questions for G1 (#165)

**The utility-glyph addendum — how wide is "no dingbat glyph remains in the UI source"?** §6's acceptance is absolute and the twelve do not cover what a grep finds. The sheet is twelve glyphs or nineteen depending on the answer, so it is wanted **before** authoring, not after. The full inventory, taken at `1e584bfa`:

| Site | Glyph | What it means | Suggested |
|---|---|---|---|
| `ui/hud.ts:1045` | `▣` | Logistics, in the strip's readout | **Draw it** — it sits beside the twelve, at the same size, in the same strip |
| `ui/hud.ts:1048` | `◎` | Intel, same readout | **Draw it**, same reason |
| `ui/production.ts:73` | `◎` | `sweep` support action in the dock | **Draw it** — and note it collides with intel's `◎` today, which is itself an argument |
| `ui/production.ts:80` | `✸` | `strike` support action in the dock | **Draw it** |
| `ui/worldmap3d.ts:296-297` | `↺` `↻` | The diorama's two rotate buttons | **Draw them** — they are the only controls on that screen and they are the one place the board's own weight is visible |
| `ui/role.ts:42-50` | `✹ ⬡ ✈ ✛ ▤ ▲ ■` | `ROLE_GLYPH`, a dead second role table | **Delete, do not draw** (R-11) — its only importer is its own test |
| `loading.ts:166-176`, `hud.ts:1752`, `debrief.ts:74, :167`, `worldmap.ts:210, :317`, `worldmap3d.ts:301`, `campaign.ts:473` — **re-verified at `4397e7c7`** — and the catalogue's `en.json:402` (`dock.lock.stars`, via `dock-model.ts:114`) and `en.json:445` (`gate.short.stars`, via `gate-sentence.ts:116`), which the validator cannot see because `.json` is outside its `EXTS` (the rest of this table is still as taken at `1e584bfa`) | `★` | Veterancy stripes, mission stars and star gates, ten sites | **Named exception, not drawn** — it is a repeated countable mark (`'★'.repeat(n)`), not an icon, and a drawn sprite repeated nine times is a different problem. But it must be NAMED, because the acceptance sentence is absolute and an unnamed survivor reads as an oversight. The list with what each site draws is in Task 11's "The `★` exception" |

So the question in one line: **does the sheet cover the six utility marks in rows 1–5 (bringing it to eighteen), and is `★` an approved exception?** The plan's default if G1 answers nothing: draw the six, name `★` as the exception, delete `ROLE_GLYPH`.

**Three more, smaller:**

- **Does "used by … minimap" (§6) name a real site?** `minimap.ts` carries no dingbat and no role or verb badge; its only shape coding is `dotShape(side)`, which is the accessibility channel G0 decision #3 kept and is unrelated. If the bullet meant that channel, the answer is "already drawn, nothing owed"; if it meant something else, it has no site. Re-checked after Phase 2's Tasks 15–16, which rewrite that file.
- **D-8's number is set in Task 7 by capture.** If the lead has a view on the menu column at 2560 — Phase 0's retired acceptance was 28% — it is cheaper to hear it before the capture than after.
- **Does `★` stay `'★'.repeat(n)` in the deploy spread?** Task 3 renders veterancy on every roster row, which multiplies the star's site count by the length of a campaign roster. If the lead wants pips there instead (the garage's own tier pips already exist, `ad4e65f`), that is a small change made cheaply in Task 3 and expensively afterwards.

## Self-review

**Spec coverage (§6 Phase 3), bullet by bullet.**

| §6 bullet | Task |
|---|---|
| Deploy as a decision — two-column spread, portrait and orders left, roster and map preview right | **3** |
| Deploy as a decision — "the force chosen, not merely shown" | **1** (the adapter), **2** (the choice), **4** (it reaches the field) |
| Victory and defeat moments: full-screen, held, before the debrief | **5** (the moment), **6** (the wiring and the captures) |
| Composed layouts at 1920 and 2560 | **7**, discharging D-8 |
| Campaign board — a hover language for the pins | **9** (the app's share; the lit pipeline is out of scope, R-1) |
| Symbol family — twelve drawn glyphs at one weight, as an SVG sprite | **11** (gated) |
| Symbol family — used by dock, cursor badge, order row and minimap | **12** (gated; the minimap has no site and that is reported, not invented) |
| Scene host | **out of scope** (R-1) — a separate plan after WP-A1.3 |
| Campaign board on the lit pipeline, basin re-author | **out of scope** — render/art lane |
| Portraits, key art, the garage's art pass | **out of scope** — art lane, D-20 |
| §7 — unit tests for every pure function | **1, 2, 3, 5, 8, 9, 10, 11** |
| §7 — `pnpm ui:shots` as the review instrument | **3, 6, 7, 8, 10, 12** |
| Phase 2 leftovers (R-9) — focus trap, keycap | **8** |
| Phase 2 leftovers (R-9) — strip focus, `innerHTML` escaping | **10** |

**Acceptance (§6 Phase 3), clause by clause.** *"One colour register across menu, board, briefing and mission (measured: the plate's and the mission's mean luminance and saturation within 10% of each other)"* — the **layout** half is Task 7's composed grid, measured by `ui:shots` at 1920 and 2560; the **luminance** half needs the scene host and the art pass and is therefore **not met by this plan and must not be claimed as met**. *"The board draws the basin"* — Decision 2, art lane, out of scope. *"No dingbat glyph remains in the UI source"* — gated Tasks 11 and 12, met for the twelve plus whatever the addendum approves, and enforced by `dingbatFailures` rather than asserted.

**Placeholder scan.** No `TBD`, no "add tests", no "similar to task N". Every test step carries real code; every reused helper is named at its own file and line — `rig`/`mission` (`hud.test.ts:66, :93`), `deps()` (`pause.test.ts:10`), the mission harness (`first_light_fence.test.ts:460-490`), `objectivesPanel` (`objectives.ts:51`), `panel` (`panel.ts:37`), `titleCard` (`motion.ts:65`), `isDialogOpen` (`confirm.ts:56`), `pxFailures` (`validate_ui_palette.mjs:78`). Three tasks extend an existing harness rather than adding a second and each says how.

**Type consistency.** `DeployEntry`/`DeployRosterView` (Task 1) are consumed by name in Tasks 2, 3 and 4 and nowhere else. `DeploySelection` (Task 2) is the only thing crossing from the screen to `main.ts`. `LedgerRosterEntry` is `@lions/sim`'s throughout — never a local restatement, because the whole permutation argument rests on it being the same object the runtime writes back. `Disposer` is `shell/router.ts`'s in Tasks 5, 8 and 9. `Tone` is `hud-model.ts`'s in Tasks 5 and 9 — never a colour. `RegionStatus` is `worldmap`'s own in Task 9. `RoleBucket`/`OrderId` are `role.ts`'s and `selection-model.ts`'s in Tasks 11 and 12, unchanged — the family is a new *drawing* of an existing vocabulary, not a new vocabulary.

**Model tiering for the executor.** **Opus** for Task 2 (the permutation, where a mistake silently deletes a player's veterans), Task 4 (the boot-order change and the only output the sim reads), Task 5 (a new modal primitive with a promise, a hold, a trap and a key guard) and Task 1 (the E2 seam, and the sim rule that now has one copy). **Sonnet** for Tasks 3, 6, 7, 8, 9, 10, 11 and 12 — each is a pure model plus a thin DOM layer, or a table swap, with the tests written out. **Haiku** for scoped re-reviews of a fix round. **Opus** for the final whole-branch review. Nothing here should inherit opus by default: the execution plan's own note is that workflows do that silently, and eight of these twelve do not need it.

**R-n → D-n at landing.** R-1 → D-40 (the app half's boundary, with the three exclusions and their owners). R-2 → D-41 (the Stage 2 entry condition and the G1 gate as a condition rather than a date). R-3 → D-42 (permute, never filter, with `mission.ts:1887` as the measurement). R-4 → D-43 (`DeployRosterView`, and the draw replay reduced from two copies to one). R-5 → D-44 (the runtime moves past the deploy gate, with the grep that made it cheap). R-6 → D-45 (the moment is presentation and the ledger is already written). R-7 → D-46 (1280 is a fit floor; two breakpoints stay two; D-8 discharged with its number). R-8 → D-47 (hover previews, never navigates; the region comes from the existing `hovered` getter). R-9 → D-48 (the four Phase 2 leftovers, and which task took each). R-10 → D-49 (the acceptance is the twelve plus the addendum, and the check is a named list rather than a Unicode range). R-11 → D-50 (`ROLE_GLYPH` deleted, not redrawn). R-12 → D-51 (victory was never captured; `16-end-defeat` had to be taught to skip the moment).

**Execution order.** 1 → 2 → 3 → 4 (the deploy chain, in dependency order: the adapter, the model, the screen, the field). Then **8** before **5**, because the moment is built on the focus trap rather than retrofitted with one. Then 5 → 6. Then 7, 9 and 10 in any order — none depends on another. Then, only after G1 answers the sheet and this branch has merged `origin/main`, **11** and **12**. Tasks 1–10 are a complete, landable branch on their own.

**One bless is budgeted.** Tasks 10 and 12 are the only two that touch `ui/hud.ts`, and Phase 2's landing proved the HUD is in the gated frame. Everything else in this plan changes screens no gated scenario photographs. A red `visual` run on any other task is a regression to find, not a threshold to widen (D-27).
