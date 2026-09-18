# Shell Upgrade Phase 2 — "the HUD a commander needs" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the HUD from a set of readouts into a command surface. A player learns that a unit is dying, where, and gets there in one key; reads every objective of a five-objective mission without leaving the field, and reads what a secondary is worth; drives the camera from the minimap and gives orders on it; keeps control groups and finds an idle squad; discovers a verb from the screen rather than from this repository; and sees a weapon's reach as a shape on the ground instead of three competing hoops.

**Architecture:** Everything except the last two tasks lives inside `packages/app`, plus one sim EVENT the spec's §5 sanctions and one public method on `BattleAudio`. The pattern Phase 1 established holds: a pure model module with its own `*.test.ts` and a thin DOM layer over it. New pure modules are `ui/alerts.ts` (classify, coalesce, cool down), `ui/objective-reward.ts` (what a secondary pays, from the credits rule the sim already owns), `ui/hint-model.ts` (which hint the hint line owes), `ui/idle.ts` (is this unit idle), `ui/camera-input.ts` (edge-pan vector, zoom-to-cursor anchor), and `three/units/overlay-geometry.ts`'s new annulus fill. New DOM layers are `ui/tooltip.ts` (one tooltip for the app, promoted from `production.ts`'s private `bindTip`), `ui/objectives.ts` (the tracker, mounted on the briefing, in-mission and from the pause menu), `ui/keys-overlay.ts` (F1) and `ui/group-bar.ts`. `main.ts` keeps `bootBattlefield` (D-18) and gains the wiring; nothing new mounts outside the battlefield's own disposer.

**Tech Stack:** TypeScript strict, vitest (jsdom for DOM files, node for pure ones), Vite, Playwright (tools only), three.js r1xx (last two tasks only), Python 3 (`tools/validate_audio.py` only). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-16-shell-upgrade-design.md` — §6 "Phase 2 — the HUD a commander needs" (the bullets and the three acceptance clauses), §5 constraints, §7 testing and evidence, §10 status and the parallel-work boundary, and the Deviations D-10…D-27 that Phase 1 left standing. The spec is the binding authority; this plan argues from it and records where it departs, below. Execution-plan packages: **WP-S2a (#170)** — alerts, objectives, hotkeys, tooltips, chips — and **WP-S2b (#171)** — minimap control, control groups, idle finder, edge pan, zoom to cursor, range rings, discoverability, the tutorial hover step. One branch, one landing, one bless if the picture moved.

## Global Constraints

Copied from the spec §5 and §10, binding on every task:

- **The sim is untouched except by one EVENT.** §5: "A HUD need that seems to require sim change is a missing sim EVENT, and the fix is an event the sim already has the information for, raised in its own change." Task 1 is that change and the only file it touches under `packages/sim/**` is `mission.ts` (plus its test). It adds no `Sim` state, no RNG draw, no player-input branch and no rule; **`pnpm test:determinism` is in its gate line and the golden hash must not move.** Every other task's diff under `packages/sim/` is empty, and `git diff --stat <base>..HEAD -- packages/sim` at landing must name `mission.ts`/`mission.test.ts` and nothing else.
- **Colour comes from the palette.** `packages/app/src/ui/theme.css` remains the only file naming an `--rl-*` variable; new tokens are semantic; `pnpm validate:ui` stays at an empty allowlist; translucency is `color-mix()`; no hex or `rgb()` literal anywhere in UI source. In the renderer, a new colour is a `data/palette.json` entry reached through `RendererOptions.resolveColor`, or a value DERIVED from one at draw time — never a literal (see Ruling R-5 for the range-ring fill, which is the only new colour this phase adds).
- **Fonts are self-hosted, never a CDN.** This phase adds no font file.
- **Three only under `packages/render/src/three/**`**, and `packages/app` reaches a renderer only through `packages/render/src/api.ts` or the dynamic-import doors named in `eslint.config.mjs`. Nothing in this plan adds a door. Note the eslint rule's `paths` entry does not catch subpath imports (`three/addons/...`) — keep those inside by discipline.
- **The execution-plan boundary (spec §10).** The art session owns `packages/render/src/three/units/mesh-*.ts`, `packages/render/src/three/ThreeRenderer.ts`, `packages/render/src/sheet.ts`, `tools/src/mesh_gait*`, `tools/units/rig.py`, the four Meshy importers, `art/meshes/**`, `assets/meshes/**` and CLAUDE.md's "Mesh units" section until it lands. **Tasks 1–14 touch none of those.** The range rings are the one Phase 2 item the spec itself puts outside `packages/app`; with the minimap's lit ground they are **Tasks 15 and 16, the LAST tasks**, they touch `packages/render/src/api.ts`, `three/ThreeRenderer.ts`, `three/units/overlays.ts` and `three/units/overlay-geometry.ts`, and they run only after the art lane's blast package **WP-A1.2** has landed on `main` and this branch has merged `origin/main`. Everything else stays inside `packages/app` (plus Task 1's sim event, Task 3's `packages/render/src/audio.ts` + `data/audio.json` + `tools/validate_audio.py`, and Task 14's `tools/src/ui-review/shoot.ts`).
- **No `any`. No non-null assertion in new code.** Strict TypeScript; tests colocated as `*.test.ts`; every DOM test file opens with `// @vitest-environment jsdom`; `window.localStorage` in that environment is a bare `{}` — guard every access the way `menu.ts`'s `storedRenderer()` does, or take a `StorageLike` parameter and test with a Map-backed fake.
- **The visual gate is blessed, never widened.** The four gated scenarios (`quiet`, `open-ground`, `relief`, `vehicle`) are captured with `hideHudExceptCanvas()` (`capture-protocol.ts:769-775`), so no HUD or minimap DOM change in Tasks 1–14 can move them; and no gated scenario selects a unit, so Task 16's ring redesign should not move them either. **One bless is budgeted and none is expected.** If a CI `visual` run goes red on a Task 1–14 commit, that is a defect in the task, not a bless — D-27 says the next phase should read a red `visual` job as a real regression rather than as drift. Do not widen a threshold to clear a red run.
- **Screens are pure functions.** Every `show*(stage, opts)` returns a disposer; nothing reads `window.location` inside a screen. Anything this phase mounts on `document.body` (the tracker, the F1 overlay, the tooltip, the group bar) registers its teardown where it is created and is drained by `bootBattlefield`'s `teardown`, the way `Hud.destroy()` and `minimap.destroy()` already are (`main.ts:2428`).
- **Every player-facing string is human and goes through `t()`.** No mission id, map id, URL flag, gate expression, objective-status enum or intent kind reaches the DOM. New keys land in `packages/app/src/i18n/en.json`; `tools/validate_i18n.mjs` (inside `pnpm validate:ui`) fails a bare chrome literal. The only text a mission can show stays `name`, `briefing`, `objectives[].text` and a trigger `label`.
- **UI scale is one number.** `rem` throughout; a new `px` ≥ 4 in UI CSS fails `pnpm validate:ui` unless the line carries `/* px-ok */` (`tools/validate_ui_palette.mjs:80-83`).
- **Every check gets an input that makes it fail — constructed, and run** (CLAUDE.md). Each task's test step names the mutation that turns it red; the commit message says it was seen red.
- **The tool contracts stay whole:** `window.__lions` keeps `sim`, `renderer`, `runtime`, `audio`, `help`, `step`, `goto`, `sel`, `units`, `cursorKey`, `hover` with today's semantics; the frame loop stays armed through the bare global `requestAnimationFrame` so `FREEZE_FRAME_LOOP_STATEMENTS` (`tools/src/golden-diff/capture-protocol.ts:624`) still freezes it; `.rl-loading`, `.rl-loading__deploy`, `.rl-loading__count`, `.rl-world[data-board]`, `.rl-world__canvas canvas`, `.rl-endnav`, `.rl-debrief` keep their names; **every new sandbox/URL flag must be added to `packages/app/src/sandbox-help.ts`'s flag table** (it is the single source for `readFlags`, `sandboxHelp`, `unknownParams` and the `?sandboxes` picker) — this plan adds none, and a task that reaches for one should reconsider.
- **Gates before every commit:** `pnpm lint && pnpm typecheck && pnpm test && pnpm validate:data && pnpm validate:ui`. Plus `pnpm test:determinism` on Task 1, `pnpm validate:audio` on Task 3, and `pnpm ui:shots` wherever a task names a capture. Nothing here needs `validate:assets`, `validate:meshes`, `balance` or `playtest`.
- **Git hygiene:** commit with explicit paths (`git add <paths>` / `git commit -s -- <paths>`), never `-A` — other sessions share this working tree; never `git checkout -- <file>`; the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` verbatim, and DCO `-s`.

## Rulings taken while planning

Each narrows or departs from §6 Phase 2's text; each is written into the spec's Deviations at landing as `D-28`…`D-37` with what the executing session measured.

- **R-1 — The tutorial's ECONOMY step is deferred to Stage 4; only the hover step is in this plan.** §6's last bullet asks for "a hover step and a first economy step". The economy that step would teach does not exist where the tutorial runs: `data/missions/beit_sahwan_0_tutorial.json` declares **no `resources` block at all**, so `MissionView.logistics`/`intel` are `undefined` (`main.ts:2174-2177`), the strip prints neither field, and `production.ts`'s dock has nothing to spend. The brigade economy that does exist (`brigade-account.ts`'s credits, the garage) is a between-missions screen the tutorial never reaches. A step awaiting a `built` event on a mission that can build nothing is a step that stalls the tutorial silently — the exact failure `runtime.ts`'s nested-`all_of` comment already warns about. The execution plan schedules it at Stage 4 with the mission economy; Task 13 ships the hover step alone.
- **R-2 — The control-group BAR is a visible surface over the control groups that already exist, not a new mechanism.** `main.ts:2979-3020` already assigns on Ctrl/Cmd+digit, recalls on the bare digit, stamps `renderer.unitGroup[i]`, holds `groups: Map<number, number[]>` (`main.ts:2850`), dispatches `{kind:'group', slot, action}` and centres the camera on a double-tap inside 400 ms. Task 11 changes none of it: the bar reads that same `Map`, and a click on a chip runs the identical recall path (the same three writes, in the same order) rather than a second copy of it. `input/keymap.ts`'s own header says the digits are deliberately outside `ACTIONS` and the digit keys are refused as bindings (`unassignable`, keymap.ts:69) — that stays true.
- **R-3 — "The key on every order button" already ships; the tooltip is what is left.** `hud.ts:1137` renders `<b class="rl-dim">${this.deps.keyFor?.(row.key) ?? row.key}</b>` on every one of the five buttons, and `main.ts:2302` resolves it through the LIVE bindings (`keyFor: (id) => isAction(id) ? keyLabel(bindings[id]) : id`), so a rebind is honoured. Phase 1's Task 5 did this. What Phase 2 owes the order row is the shared tooltip (Task 7) — today `btn.title` is the label again (`hud.ts:1139`), which says nothing the button does not already say.
- **R-4 — "Under attack" is derived app-side from `SimEvent`s; only "unit lost" is a sim change.** `MissionEvent` (`mission.ts:304-353`) has nine kinds and none of them is an under-fire kind, and it needs none: `main.ts:3038-3042` already hands every tick's `SimEvent[]` to `renderer.onEvents` and `audio.onEvents`, so `ui/alerts.ts` reads `fire`/`impact`/`nearMiss` whose `target` is a side-0 entity from the same array, with no sim change whatever. Putting it in the sim would move a HUD cadence decision — the per-entity cooldown — inside the tick. The one thing the app genuinely cannot derive is a loss: `SimEvent`'s `destroyed` (`sim.ts:651`) carries `{entity, by}` and no side or type, and the app would have to read `sim.state` after the fact to learn them, which is the sim telling the HUD nothing and the HUD guessing. Task 1 raises it properly.
- **R-5 — The range-ring fill is DERIVED from the resolved team hex at draw time, not a new `data/palette.json` entry.** G0 decision #3 (issue #164) keeps the colour-vision variants, relabels them "alternate team colours" and says any new colour — the range-ring fill is named — "rides through the existing team-colour resolver and makes no accessibility claim". A palette entry would need **four** rows (`reserved.team.colors` plus the three `reserved.team.variants.*` blocks), and choosing three variant values is exactly an accessibility claim. So Task 16 adds a pure `desaturateHex(hex, toward)` to `overlay-geometry.ts`, node-tested, applied to `this.opts.teamColors[side]` — which `main.ts:1538` already resolves per variant through `paletteTeamColors(cvdVariant)`. One helper, no new palette rows, and the variant follows the setting for free.
- **R-6 — The minimap's ground from the map's lit albedo cannot be done inside `packages/app`, so it is Task 15, beside the rings.** §6 asks for "a one-off render of the ground mesh to a texture at map load". `Minimap.paintTerrain` (`minimap.ts:401-423`) builds its own 1px-per-tile canvas from `map.blocked`/`boulder`/`cover` and `TerrainTones`; the lit albedo is the three.js ground mesh's material under `terrain/ground.ts`, and `Renderer` (`api.ts:285-333`) has no seam that hands a rendered texture to the app. Getting one means a render target and a new optional method on `ThreeRenderer` — `ThreeRenderer.ts`, which the art session holds. So it waits for WP-A1.2 with the rings, and Task 10 ships every other minimap item against today's painted terrain.
- **R-7 — The in-mission objective tracker is one component mounted three ways, not three screens.** §6 asks for the full list "on the briefing", a tracker "toggled from the strip's `+N` and from the pause menu". `ui/pause.ts:141-184` already lists every objective with `objectiveStatusLabel`, and duplicating that list in a second module is how two answers to one question appear. `ui/objectives.ts` exports one `objectivesPanel(host, deps)` in `settingsPanel`'s exact shape (`{ el, dispose }`); the briefing mounts it (Task 5), the strip's `+N` and the pause menu's Objectives tab both open the same component (Task 6). The pause menu's own `<ol>` is replaced by it, so the list exists once.
- **R-8 — A secondary's reward is stated from the rule that already pays it, never authored.** §6 says "secondaries with rewards named". Nothing in `mission.schema.json` carries a reward field and none is added (spec §8 puts mission content out of scope). The reward for a carrying secondary is already exact and already in the sim: `CREDIT_WEIGHTS.carryingSecondary = 40` (`packages/sim/src/credits.ts:16-20`), paid by `creditsFor` on victory, plus `grade.ts`'s third star, which `mission.schema.json`'s own `carries` description states ("The third star (Ari'im citation) needs every carrying secondary complete"). `ui/objective-reward.ts` reads `objectiveList[].carries` and the mission's `ledger.produces` and says so in words. It names credits **only when `mission.ledger.produces.length > 0`**, the same gate `main.ts:3105` puts on `payMission` — the tutorial produces nothing and is paid nothing, so promising it credits would be a lie the screen tells.
- **R-9 — Edge pan and zoom-to-cursor ship with their settings rows in the same tasks, and `cameraSpeed` is reused unchanged.** This is D-12 discharged: `Settings.controls` is `{ cameraSpeed, bindings }` today (`settings.ts:30`) because "a setting for a feature that does not exist is a lie". Task 12 adds `edgePan: boolean` and `zoomToCursor: boolean` to `Settings.controls` AND the two rows in `settings-panel.ts`'s Controls section AND the behaviour, in one commit. Edge pan reuses `cameraSpeed` rather than adding a second speed number — one number the player has already met, and `main.ts:3672` is the one place a pan speed is computed.
- **R-10 — The minimap's ping is local, silent to the sim, and not a command.** §6 says "a ping". This plan's ping is a fading mark on the minimap and a matching world marker through the EXISTING `renderer.addOrderMarker` — no `PlayerIntent` kind, no `Command`, no `MissionEvent`, no network. There is no multiplayer to signal (spec §8 puts networking out of scope), so a ping that queued anything would be a mechanism with no second player to receive it. Alt+click on the minimap places it; it is drawn by `Minimap` itself from a local array with a wall-clock fade, which is presentation and cannot touch determinism.
- **R-11 — A squad wipe coalesces per TICK and per unit TYPE, app-side, and `removedNotice`'s "no count is coalesced" stays true of `removed`.** `ui/mission-notice.ts:35,68` records that `removed` and `evacuated` deliberately emit one line each. Task 2 does not change either; it coalesces the NEW `unitLost` kind, inside the tick's own `MissionEvent[]` array, keyed by unit type — so three riflemen lost in one tick read as one line with a count of three, and a rifleman and a tank read as two. Nothing tick-scoped is threaded through `main.ts`: `alertsForTick` takes the whole array and returns the whole answer.
- **R-12 — the range rings' "designed arc" is the fill's outer BOUNDARY, not a facing sector.** §6's "a desaturated low-alpha fill of the team hue with a designed arc" reads most naturally as a sector centred on the unit's heading, and that would be wrong: it draws a rule the model does not have. `selectTarget` (`sim.ts:2887`) gates a shot on identification and range and never on bearing, and no weapon in `data/units/` declares a traverse limit — so a sector would tell the player "this unit can only shoot this way", which is false, and a player who believed it would manoeuvre against a constraint that does not exist. The shape is therefore a filled ANNULUS from minimum range to effective range, whose outer edge is drawn as a brighter arc over the fill — reach that fades out at a line, instead of the three competing hoops that ship today (`ThreeRenderer.ts:6127-6131`).

## File structure

| File | Responsibility | Task |
|---|---|---|
| `packages/sim/src/mission.ts` (+test) | The `unitLost` `MissionEvent`, built from the `destroyed` `SimEvent` `step()` already iterates | 1 |
| `packages/app/src/ui/alerts.ts` (+test) | Pure: classify a tick into alerts, coalesce wipes, cool down under-fire, pick the jump target | 2 |
| `packages/render/src/audio.ts` (+test), `data/audio.json`, `tools/validate_audio.py` | `BattleAudio.playUi(setName)`; the `ui_alert`/`ui_objective` sets and the validator's `ui` event | 3 |
| `packages/app/src/main.ts` | Every wiring: the alert loop, the briefing's objective list, the tracker, the F1 overlay, the hint facts, the minimap input, the group bar, the idle finder, the camera, the tutorial hover, the ring preview | 1, 4, 5, 6, 8, 9, 10, 11, 12, 13, 15, 16 |
| `packages/app/src/ui/minimap.ts` (+test) | The alert flash; then click-to-jump, drag-to-pan, right-click-to-order, ping, frame, hostile mark; then the lit ground | 4, 10, 15 |
| `packages/app/src/input/keymap.ts` (+test) | Three new rebindable actions: `jumpToAlert`, `keysOverlay`, `idleNext` | 4, 8, 11 |
| `packages/app/src/ui/objective-reward.ts` (+test) | What a secondary pays, from `CREDIT_WEIGHTS` and `ledger.produces` | 5 |
| `packages/app/src/ui/objectives.ts` (+test) | The one objective panel: briefing, in-mission, pause menu | 5, 6 |
| `packages/app/src/ui/loading.ts` (+test) | The full objective list on the briefing | 5 |
| `packages/app/src/ui/hud.ts` (+test) | The strip's `+N` becomes a button; order/Conduct/chip tooltips; the chip name slot; the hint line | 6, 7, 9 |
| `packages/app/src/ui/pause.ts` (+test) | Its `<ol>` becomes the shared panel | 6 |
| `packages/app/src/ui/tooltip.ts` (+test) | One tooltip for the app, promoted from `production.ts`'s private `bindTip` | 7 |
| `packages/app/src/ui/production.ts` (+test) | Its private `bindTip` is deleted and its four call sites use the shared one | 7 |
| `packages/app/src/ui/keys-overlay.ts` (+test) | F1: every binding from `ACTIONS`, plus the three keys that are not in it | 8 |
| `packages/app/src/ui/hint-model.ts` (+test) | Which hint the hint line shows, and which first-use hints are still owed | 9 |
| `packages/app/src/ui/group-bar.ts` (+test) | A chip per assigned control group: number, count, health | 11 |
| `packages/app/src/ui/idle.ts` (+test) | Pure: is this unit idle; cycle to the next one | 11 |
| `packages/app/src/ui/camera-input.ts` (+test) | Pure: the edge-pan vector and the zoom-to-cursor anchor shift | 12 |
| `packages/app/src/settings.ts` (+test), `ui/settings-panel.ts` (+test) | `controls.edgePan`, `controls.zoomToCursor` and their two rows (D-12) | 12 |
| `packages/app/src/tutorial/runtime.ts` (+test), `data/schemas/tutorial.schema.json`, `data/tutorial/beit_sahwan_0.json`, `CLAUDE.md` | The hover input, the `hover` predicate, the step, the step count | 13 |
| `packages/app/src/ui/theme.css` | Every new surface's rules; the chip name slot | 5–12 |
| `packages/app/src/i18n/en.json` | Every new string | 1–13 |
| `tools/src/ui-review/shoot.ts` | States 18–23: alert, tracker, tooltip, F1, group bar, minimap ping | 14 |
| `packages/render/src/api.ts` | `captureGroundAlbedo?()`; `rangeRingPreview?` | 15, 16 |
| `packages/render/src/three/ThreeRenderer.ts` | The albedo render target; the rewritten ring block | 15, 16 |
| `packages/render/src/three/units/overlays.ts`, `units/overlay-geometry.ts` (+test) | `ellipseAnnulusFill` and `desaturateHex`/`hexSaturation`; the stale `overlays.ts` header | 16 |

---

### Task 1: The missing sim event — a side-0 unit lost

This is the spec's sanctioned exception, and the only file under `packages/sim/**` this phase touches. §5: "A HUD need that seems to require sim change is a missing sim EVENT, and the fix is an event the sim already has the information for, raised in its own change." It is that change, on its own, reviewed as a sim change by the **sim-guard** agent before it is committed.

Why the app cannot derive it: `SimEvent`'s `destroyed` (`sim.ts:651`) is `{ kind, tick, entity, by }` — no side, no type. The app would have to read `sim.state.side[e.entity]` and `sim.unitTypes[sim.state.typeIdx[e.entity]].id` after the tick to learn both, which is the HUD reaching into sim state for facts the runtime already holds — the same argument the `removed` `MissionEvent`'s own doc comment (`mission.ts:328-334`) makes for carrying `side` and `unit`. This event mirrors that shape exactly.

**What it does not do, stated so the review can check it:** it adds no field to `Sim`, no array, no branch on player input, no RNG draw, and no rule. It is built inside the loop `MissionRuntime.step()` already runs over `simEvents` (`mission.ts:971-991`), from an event the loop already reads, and appended to the `MissionEvent[]` that `step()` already returns. `MissionEvent`s are not hashed — `determinism.test.ts` hashes sim state — so the hash cannot move; **`pnpm test:determinism` is in the gate line anyway**, because "cannot move" is a claim and the gate is the evidence.

**Files:**
- Modify: `packages/sim/src/mission.ts` (the union at 304-353, `MISSION_EVENT_KINDS` at 356-358, the `simEvents` loop at 971-991)
- Test: `packages/sim/src/mission.test.ts` (extend; `makeWorld`/`baseMission` at 104-143 are the helpers)

**Interfaces:**
- Consumes: `SimEvent` `destroyed` (`sim.ts:651`), `this.sim.state.side`, `this.sim.state.typeIdx`, `this.sim.unitTypes`.
- Produces (Tasks 2 and 4 consume these exact names):
  - `{ kind: 'unitLost'; tick: number; entity: number; side: number; unit: string }` on `MissionEvent`
  - `'unitLost'` in `MISSION_EVENT_KINDS`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/sim/src/mission.test.ts  — append a new describe block
describe('unitLost', () => {
  it('reports a side-0 death with its entity, side and type id', () => {
    const w = makeWorld(
      baseMission({
        starting_force: [{ unit: 'm_squad', count: 2, at: [3, 5] }],
        enemy: { garrison: [{ unit: 'm_tank', count: 1, at: [24, 5] }] },
      })
    );
    w.sim.debugKill(0);
    const { mission } = w.step(1);
    const lost = mission.filter((e) => e.kind === 'unitLost');
    expect(lost).toEqual([
      { kind: 'unitLost', tick: w.sim.tickCount, entity: 0, side: 0, unit: 'm_squad' },
    ]);
  });

  it('is silent for an enemy and for a civilian', () => {
    const w = makeWorld(
      baseMission({
        starting_force: [{ unit: 'm_squad', count: 1, at: [3, 5] }],
        enemy: { garrison: [{ unit: 'm_tank', count: 1, at: [24, 5] }] },
        civilians: { groups: [{ count: 1, at: [12, 6] }] },
      })
    );
    const enemy = 1;
    const civ = 2;
    expect(w.sim.state.side[enemy]).toBe(1);
    expect(w.sim.state.side[civ]).toBe(2);
    w.sim.debugKill(enemy);
    w.sim.debugKill(civ);
    const { mission } = w.step(1);
    expect(mission.filter((e) => e.kind === 'unitLost')).toEqual([]);
  });

  // `debugKill` destroys with `by === -1`, and so does anything the sim kills
  // with no shooter. The existing veterancy branch in step() is gated on
  // `by >= 0`; this one must NOT be, or a unit lost to a collapse or a mine
  // dies with no alert at all.
  it('fires when nothing killed it -- by === -1 is still a loss', () => {
    const w = makeWorld(baseMission({ starting_force: [{ unit: 'm_squad', count: 1, at: [3, 5] }] }));
    const seen: SimEvent[] = [];
    w.sim.debugKill(0);
    const { sim, mission } = w.step(1);
    seen.push(...sim);
    expect(seen.some((e) => e.kind === 'destroyed' && e.by === -1)).toBe(true);
    expect(mission.some((e) => e.kind === 'unitLost' && e.entity === 0)).toBe(true);
  });

  // The loss is reported ONCE. `destroy()` clears `alive` before the event is
  // pushed (sim.ts:4833-4847), so a second tick has nothing to report -- but
  // the assertion is what stops a future reader moving the push somewhere that
  // runs per tick rather than per event.
  it('reports each loss exactly once', () => {
    const w = makeWorld(baseMission({ starting_force: [{ unit: 'm_squad', count: 1, at: [3, 5] }] }));
    w.sim.debugKill(0);
    const first = w.step(1).mission.filter((e) => e.kind === 'unitLost').length;
    const second = w.step(20).mission.filter((e) => e.kind === 'unitLost').length;
    expect(first).toBe(1);
    expect(second).toBe(0);
  });

  it('is in MISSION_EVENT_KINDS', async () => {
    const { MISSION_EVENT_KINDS } = await import('./mission');
    expect(MISSION_EVENT_KINDS).toContain('unitLost');
  });
});
```

The last test is the cheap half of the guard; the expensive half is the compile check that already exists (`MissionEventKindsAreExhaustive`, `mission.ts:361-364`), which fails typecheck if the kind is added to the union and not to the list.

- [ ] **Step 2: Run to see them fail, then implement**

`pnpm vitest run packages/sim/src/mission.test.ts -t unitLost`. Then, in `mission.ts`:

Add to the union, directly under the `removed` member and carrying its own doc comment — the two are neighbours because they are the two ways a unit leaves the board, and a reader has to be able to tell them apart:

```ts
  /**
   * One of the player's own units is dead.
   *
   * Mirrors `removed`'s field shape (`entity`, `side`, `unit`) for the same
   * reason it carries them: the HUD needs to word the line without reaching
   * into sim state, and `SimEvent`'s own `destroyed` carries neither. `side`
   * is always 0 -- it is on the event anyway so the two neighbouring kinds
   * read identically at a call site, and so a future "enemy lost" is a filter
   * rather than a second kind.
   *
   * Emitted for a DEATH, never for a `remove` trigger (that is `removed`
   * above, which is not a death and is never scored) and never for a
   * civilian evacuation (`evacuated`). Unlike the veterancy branch beside it,
   * it is NOT gated on `by >= 0`: a unit killed by nothing in particular --
   * a building collapse, `debugKill` -- is still a unit the player lost.
   */
  | { kind: 'unitLost'; tick: number; entity: number; side: number; unit: string }
```

Add `'unitLost'` to `MISSION_EVENT_KINDS` (`mission.ts:356-358`).

In `step()`'s `simEvents` loop, leave the existing `destroyed` branch exactly as it is and add a second one beside it:

```ts
      if (e.kind === 'destroyed' && e.by >= 0) {
        this.kills.set(e.by, (this.kills.get(e.by) ?? 0) + 1);
        if (this.sim.state.side[e.by] === 0) this.contributed.add(e.by);
      }
      // Deliberately a SECOND branch rather than an `else`/extension of the
      // one above: that one answers "who gets the kill" and is rightly gated
      // on there being a killer; this one answers "what did the player lose"
      // and must fire for a death with no killer at all. `destroy()` clears
      // `alive` but leaves `side` and `typeIdx` untouched (sim.ts:4833-4847),
      // so both are still readable here, one tick's-worth of statements later.
      if (e.kind === 'destroyed' && this.sim.state.side[e.entity] === 0) {
        out.push({
          kind: 'unitLost',
          tick,
          entity: e.entity,
          side: 0,
          unit: this.sim.unitTypes[this.sim.state.typeIdx[e.entity]].id,
        });
      }
```

- [ ] **Step 3: The feed line, so the event is never silent**

`main.ts`'s `describeMissionEvent` (`main.ts:347`) is a `switch` with a `default: return null`, so a new kind is silently unreported unless a case is added. Task 2 owns the coalesced alert line, but a kind that reaches `main.ts` and says nothing between these two tasks is a half-landed feature. Add the single-event case now and let Task 4 supersede it:

```ts
    case 'unitLost':
      return [t('mission.notice.unitLost', { unit: e.unit }), 'bad'];
```

with `"mission.notice.unitLost": "<b>Lost</b> — {unit}"` in `en.json`. Task 4 removes this case when the alert layer takes over the line (and says so in its own commit), which is the only reason it is acceptable to write a line here that names a raw type id: it lives for two commits. If Task 4 slips, this is still better than silence.

- [ ] **Step 4: Gates, sim review, falsify, commit**

Full gate line **plus `pnpm test:determinism`**. Then:

```bash
pnpm test:determinism            # the golden hash, unmoved
/usr/bin/git diff --stat -- packages/sim    # must name mission.ts and mission.test.ts only
```

Ask the **sim-guard** agent to review the diff against the four invariants before committing; its verdict goes in the task report. Falsify: gate the new branch on `e.by >= 0` — the third test ("by === -1 is still a loss") goes red; restore. Then:

```bash
git add packages/sim/src/mission.ts packages/sim/src/mission.test.ts packages/app/src/main.ts packages/app/src/i18n/en.json
git commit -s -- packages/sim/src/mission.ts packages/sim/src/mission.test.ts packages/app/src/main.ts packages/app/src/i18n/en.json
```

Message:

```
feat(sim): a MissionEvent for a player unit lost

The one sim change Phase 2 takes, and the shape spec §5 sanctions: an event the
runtime already has the information for, raised on its own. Built inside step()'s
existing destroyed loop from state destroy() leaves readable; no Sim state, no RNG
draw, no rule, no player-input branch. Determinism hash unmoved and test:determinism
green. Seen red: gating the new branch on by >= 0, which loses every death with no
killer.
```

---

### Task 2: The alert model — classify, coalesce, cool down

Pure, node-tested, no DOM and no `Sim`. §7 names "the alert coalescing" as a unit-tested pure function by name, so this is the function it means.

**Files:**
- Create: `packages/app/src/ui/alerts.ts`
- Test: `packages/app/src/ui/alerts.test.ts`

**Interfaces:**
- Consumes: `SimEvent`, `MissionEvent` (types only, from `@lions/sim`), `Tone` (`./hud-model`).
- Produces (Task 4 consumes these exact names):
  - `interface AlertLine { key: string; params: Readonly<Record<string, string | number>>; tone: Tone }`
  - `interface Alert { kind: 'unitLost' | 'underFire' | 'objective'; line: AlertLine | null; sound: 'ui_alert' | 'ui_objective' | null; at: { x: number; y: number } | null; count: number }`
  - `interface AlertWorld { posOf(entity: number): { x: number; y: number } | null; sideOf(entity: number): number; unitName(typeId: string): string; objectiveAt(id: string): { x: number; y: number } | null }`
  - `interface AlertState { readonly lastUnderFire: ReadonlyMap<number, number> }`
  - `const UNDER_FIRE_COOLDOWN_TICKS = 100`
  - `function initAlertState(): AlertState`
  - `function alertsForTick(state: AlertState, sim: readonly SimEvent[], mission: readonly MissionEvent[], world: AlertWorld, tick: number): { state: AlertState; alerts: Alert[] }`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/src/ui/alerts.test.ts
import { describe, expect, it } from 'vitest';
import type { MissionEvent, SimEvent } from '@lions/sim';
import { UNDER_FIRE_COOLDOWN_TICKS, alertsForTick, initAlertState, type AlertWorld } from './alerts';

const world: AlertWorld = {
  posOf: (e) => (e < 0 ? null : { x: e + 0.5, y: 10.5 }),
  sideOf: (e) => (e < 10 ? 0 : 1),
  unitName: (id) => (id === 'inf_squad' ? 'Rifle squad' : id === 'mbt_lavi' ? 'Lavi' : id),
  objectiveAt: (id) => (id === 'take_town' ? { x: 24, y: 24 } : null),
};
const lost = (entity: number, unit: string): MissionEvent =>
  ({ kind: 'unitLost', tick: 0, entity, side: 0, unit }) as MissionEvent;
const fire = (target: number): SimEvent =>
  ({ kind: 'fire', tick: 0, shooter: 99, target, weaponId: 'w', pHit: 0, roll: 0, willHit: false,
     breakdown: { accuracy: 0, rangeFalloff: 0, coverMod: 0, motionMod: 0, stanceMod: 0, suppressionMod: 0 } }) as SimEvent;

describe('alertsForTick — losses', () => {
  it('coalesces a squad wipe of one type into one line with a count', () => {
    const { alerts } = alertsForTick(initAlertState(), [], [lost(0, 'inf_squad'), lost(1, 'inf_squad'), lost(2, 'inf_squad')], world, 40);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      kind: 'unitLost',
      count: 3,
      sound: 'ui_alert',
      line: { key: 'alert.unitLost', params: { name: 'Rifle squad', n: 3 }, tone: 'bad' },
    });
  });

  it('does not coalesce across unit types', () => {
    const { alerts } = alertsForTick(initAlertState(), [], [lost(0, 'inf_squad'), lost(1, 'mbt_lavi')], world, 40);
    expect(alerts.map((a) => a.line?.params.name)).toEqual(['Rifle squad', 'Lavi']);
    expect(alerts.every((a) => a.count === 1)).toBe(true);
  });

  it('jumps to the first body of the group', () => {
    const { alerts } = alertsForTick(initAlertState(), [], [lost(3, 'inf_squad'), lost(4, 'inf_squad')], world, 40);
    expect(alerts[0].at).toEqual({ x: 3.5, y: 10.5 });
  });
});

describe('alertsForTick — under fire', () => {
  it('raises one alert for the tick however many rounds land', () => {
    const { alerts } = alertsForTick(initAlertState(), [fire(1), fire(1), fire(2)], [], world, 40);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: 'underFire', count: 2, sound: 'ui_alert' });
    expect(alerts[0].line).toEqual({ key: 'alert.underFire', params: { n: 2 }, tone: 'warn' });
  });

  it('holds its tongue for the cooldown, then speaks again', () => {
    const a = alertsForTick(initAlertState(), [fire(1)], [], world, 40);
    expect(a.alerts).toHaveLength(1);
    const b = alertsForTick(a.state, [fire(1)], [], world, 40 + UNDER_FIRE_COOLDOWN_TICKS - 1);
    expect(b.alerts).toHaveLength(0);
    const c = alertsForTick(b.state, [fire(1)], [], world, 40 + UNDER_FIRE_COOLDOWN_TICKS);
    expect(c.alerts).toHaveLength(1);
  });

  it('cools down per entity, not globally', () => {
    const a = alertsForTick(initAlertState(), [fire(1)], [], world, 40);
    const b = alertsForTick(a.state, [fire(2)], [], world, 41);
    expect(b.alerts).toHaveLength(1);
  });

  it('ignores a round aimed at an enemy, at a building, or at nobody', () => {
    const { alerts } = alertsForTick(initAlertState(), [fire(11), fire(-1)], [], world, 40);
    expect(alerts).toEqual([]);
  });

  // The loss is the louder fact and the shot that killed him lands in the same
  // tick. Two lines for one event is the noise this whole model exists to stop.
  it('says nothing about under fire for a unit lost in the same tick', () => {
    const { alerts } = alertsForTick(initAlertState(), [fire(0)], [lost(0, 'inf_squad')], world, 40);
    expect(alerts.map((a) => a.kind)).toEqual(['unitLost']);
  });
});

describe('alertsForTick — objectives', () => {
  it('sounds and jumps, and writes no line -- describeMissionEvent owns that', () => {
    const ev = { kind: 'objective', tick: 0, id: 'take_town', status: 'complete' } as MissionEvent;
    const { alerts } = alertsForTick(initAlertState(), [], [ev], world, 40);
    expect(alerts).toEqual([
      { kind: 'objective', line: null, sound: 'ui_objective', at: { x: 24, y: 24 }, count: 1 },
    ]);
  });

  it('an objective the map cannot place still sounds', () => {
    const ev = { kind: 'objective', tick: 0, id: 'survive', status: 'complete' } as MissionEvent;
    const { alerts } = alertsForTick(initAlertState(), [], [ev], world, 40);
    expect(alerts[0]).toMatchObject({ sound: 'ui_objective', at: null });
  });

  it('is quiet on a tick with nothing in it, and returns the same state object', () => {
    const s = initAlertState();
    const out = alertsForTick(s, [], [], world, 40);
    expect(out.alerts).toEqual([]);
    expect(out.state).toBe(s);
  });
});
```

- [ ] **Step 2: Run to see them fail, then write `alerts.ts`**

The module in full, in this order:

1. `UNDER_FIRE_COOLDOWN_TICKS = 100` — five seconds at 20 Hz, with the comment saying why a number and not "once per engagement": an engagement has no end the app can see, and a fixed window is the only thing a pure function can answer with.
2. `initAlertState()` returns `{ lastUnderFire: new Map() }`.
3. `alertsForTick`:
   - Walk `mission` once. Collect `unitLost` into `Map<string /*unit type*/, number[] /*entities in order*/>`; collect `objective` events (any status) into a list.
   - Walk `sim` once. For `fire` and `impact` take `e.target`; skip `target < 0` (a round aimed at a building — `fire`'s own field doc, `sim.ts:594-596`), skip `world.sideOf(target) !== 0`, skip a target that appears in the tick's `unitLost` set. Collect the survivors into an ordered, de-duplicated list. **`nearMiss` is deliberately not read: it carries `shooter`, `weaponId`, `x`, `y` and no `target` at all (`sim.ts:624`), so it cannot name a victim without a spatial query the model has no world for.**
   - Filter the under-fire list by the cooldown: keep an entity only when `tick - (lastUnderFire.get(e) ?? -Infinity) >= UNDER_FIRE_COOLDOWN_TICKS`. Stamp every kept entity with `tick` in a NEW map (copy-on-write; the old state object is returned unchanged when nothing was stamped, which the last test pins).
   - Emit, in this order: one `unitLost` alert per type (`at` = `world.posOf(firstEntity)`, `count` = group length, `line.params.name` = `world.unitName(typeId)`), then at most one `underFire` alert (`at` = `posOf` of the first kept entity, `count` = kept length), then one `objective` alert per objective event (`line: null`, `at` = `world.objectiveAt(id)`).
4. Tone: `'bad'` for a loss, `'warn'` for under fire. Both are `Tone` from `./hud-model` — never a colour (that file's own rule).

No `t()` call anywhere in this file: it returns catalogue KEYS and params, the convention `selection-model.ts`'s `ORDERS[].label` and `keymap.ts`'s `ACTIONS[].label` already use and for the identical reason (a table resolved at import time freezes the locale).

- [ ] **Step 3: Falsify, gate, commit**

Falsify: drop the "lost in the same tick" exclusion — the `['unitLost']` test goes red with `['unitLost','underFire']`. Restore. Falsify again: make the cooldown map global rather than per entity — the per-entity test goes red. Restore. Gates, then:

```bash
git add packages/app/src/ui/alerts.ts packages/app/src/ui/alerts.test.ts
git commit -s -- packages/app/src/ui/alerts.ts packages/app/src/ui/alerts.test.ts
```

Message: `feat(hud): the alert model -- classify a tick, coalesce a wipe, cool down under fire`, body naming both mutations seen red and recording that `nearMiss` is excluded because it names no target.

---

### Task 3: A UI cue the mixer can play — `playUi`, and two sets

`BattleAudio` has no way to play anything that is not at a place on the map: `playSet` is private and early-outs past `AUDIBLE_TILES` (`audio.ts:453-462`). An alert is about the player, not about a tile, so it needs an unpositioned path.

**Files:**
- Modify: `packages/render/src/audio.ts` (`playSet` at 453, the `out()`/`tone`/`sweep` helpers at 503-536, the public surface)
- Modify: `data/audio.json` (`sets`), `tools/validate_audio.py` (`KNOWN_EVENTS` at ~line 50)
- Test: `packages/render/src/audio.test.ts` (extend)

**Interfaces:**
- Consumes: nothing new.
- Produces (Task 4 calls this): `BattleAudio.playUi(setName: string): void`, and the pure helper `export function uiSetGain(manifestSetGain: number): number` exported for the test.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/render/src/audio.test.ts — append
import { BattleAudio, uiSetGain } from './audio';

describe('playUi', () => {
  it('is on the public surface and is safe before attach()', () => {
    const a = new BattleAudio();
    expect(() => a.playUi('ui_alert')).not.toThrow();   // no AudioContext yet
    expect(() => a.playUi('nope')).not.toThrow();       // no such set
  });

  it('clamps a manifest gain the sanity check would have let through', () => {
    expect(uiSetGain(0.6)).toBeCloseTo(0.6);
    expect(uiSetGain(1.5)).toBe(1);
    expect(uiSetGain(-1)).toBe(0);
  });
});
```

and, in a new `tools/src/audio-manifest.test.ts` (node, reads the file from disk — the shape `credits-data.test.ts` established for "a data file and the code that reads it cannot drift"):

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const manifest = JSON.parse(readFileSync(path.join(__dirname, '../../data/audio.json'), 'utf8')) as {
  sets: Record<string, { event: string; gain?: number; variants: unknown[] }>;
};

describe('the UI cue sets', () => {
  it('declares ui_alert and ui_objective on the ui event', () => {
    expect(manifest.sets.ui_alert?.event).toBe('ui');
    expect(manifest.sets.ui_objective?.event).toBe('ui');
  });
  it('ships no files yet, so both fall back to the synth', () => {
    expect(manifest.sets.ui_alert.variants).toEqual([]);
    expect(manifest.sets.ui_objective.variants).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to see them fail, then implement**

`data/audio.json`, two new entries under `sets`, both with an empty `variants` array — legal and expected (the validator's own header: "Empty variant lists are legal and expected: BattleAudio falls back to its procedural synth"). No audio file is committed in this phase; the synth is the shipped sound and a real clip lands later with its licence and source URL like any other:

```json
    "ui_alert":     { "event": "ui", "gain": 0.5, "variants": [] },
    "ui_objective": { "event": "ui", "gain": 0.4, "variants": [] }
```

`tools/validate_audio.py`: add `"ui"` to `KNOWN_EVENTS`, with a comment saying it is the one event that is not a thing happening on the map — the mixer plays it unpositioned, so it has no weapon class and no distance.

`audio.ts`:

```ts
/** A UI cue's gain, clamped. The manifest's own sanity check allows up to
 *  MAX_GAIN (1.5) because a battlefield one-shot is attenuated by distance
 *  before it is heard; a UI cue is not attenuated by anything, so 1.5 here is
 *  1.5 in the player's ears. */
export function uiSetGain(manifestSetGain: number): number {
  return Math.max(0, Math.min(1, manifestSetGain));
}
```

and the method, public, beside `onEvents`:

```ts
  /**
   * Play a cue that is about the PLAYER rather than about a place -- an alert,
   * an objective landing. No panner, no distance attenuation and no lowpass:
   * every one of those asks "where is this", and the answer for a HUD cue is
   * "nowhere". That is the whole reason this is not `playSet` with a listener
   * position of its own -- `playSet`'s first act is a distance early-out
   * (`dist > AUDIBLE_TILES`), so a cue routed through it would go silent the
   * moment the camera was far from the origin.
   *
   * Falls back to the synth when the set ships no clips, exactly as every
   * battlefield event already does. Safe before `attach()`: with no context
   * there is nothing to play and nothing to complain about.
   */
  playUi(setName: string): void {
    const ctx = this.ctx;
    const sfx = this.sfx;
    if (!ctx || !sfx) return;
    const set = this.sets.get(setName);
    if (set && set.buffers.length > 0) {
      const src = ctx.createBufferSource();
      src.buffer = set.buffers[Math.floor(this.rand() * set.buffers.length)];
      const g = ctx.createGain();
      g.gain.value = uiSetGain(set.gain);
      src.connect(g).connect(sfx);
      src.start();
      return;
    }
    // Two shapes, so the player can tell the two apart with their back to the
    // screen: an alert falls, an objective rises.
    if (setName === 'ui_objective') {
      this.tone(660, 0.09, 'sine', 0.05);
      window.setTimeout(() => this.tone(990, 0.12, 'sine', 0.045), 70);
    } else {
      this.tone(520, 0.08, 'triangle', 0.06);
      window.setTimeout(() => this.tone(390, 0.16, 'triangle', 0.05), 60);
    }
  }
```

The two `setTimeout`s are the only wall-clock in this file and they are presentation with nothing observing them; if the mixer is torn down between them, `tone()`'s own `if (!ctx || !dst) return` covers it.

- [ ] **Step 3: Gates, falsify, commit**

Gate line **plus `pnpm validate:audio`**. Falsify: give `ui_alert` an `event` of `"alert"` — `pnpm validate:audio` goes red with `set 'ui_alert': unknown event 'alert'`; restore. Falsify again: set `ui_alert`'s gain to `1.4` and assert `uiSetGain` clamps — already covered.

```bash
git add packages/render/src/audio.ts packages/render/src/audio.test.ts data/audio.json tools/validate_audio.py tools/src/audio-manifest.test.ts
git commit -s -- packages/render/src/audio.ts packages/render/src/audio.test.ts data/audio.json tools/validate_audio.py tools/src/audio-manifest.test.ts
```

Message: `feat(audio): playUi -- a cue about the player, not about a place`, body recording that both sets ship with no clips and the synth is the shipped sound, and that the validator was seen red on an unknown event.

---

### Task 4: The alert layer — a feed line, a sound, a minimap flash, and a key that takes you there

The spec's first acceptance clause: *a scripted mission in which a unit dies produces an alert line, a sound and a minimap flash within one frame of the event.* All four sinks are driven from one place, in the tick loop, from Task 2's output.

**Files:**
- Modify: `packages/app/src/ui/minimap.ts` (the class at 346-515: `flash`, the fade, `draw`)
- Modify: `packages/app/src/input/keymap.ts` (`Action`, `ACTIONS`)
- Modify: `packages/app/src/main.ts` (the tick loop at 3038-3068; the keydown switch at ~2930-2977; `describeMissionEvent`)
- Modify: `packages/app/src/i18n/en.json`, `packages/app/src/ui/theme.css`
- Test: `packages/app/src/ui/minimap.test.ts`, `packages/app/src/input/keymap.test.ts` (extend both)

**Interfaces:**
- Consumes: `alertsForTick`, `initAlertState`, `Alert` (Task 2); `BattleAudio.playUi` (Task 3).
- Produces:
  - `Minimap.flash(points: readonly MinimapPoint[], nowMs: number): void`
  - `export const FLASH_MS = 1400` and `export function flashAlpha(ageMs: number): number` (pure, exported for the test)
  - `Action` gains `'jumpToAlert'`; `ACTIONS` gains `{ id: 'jumpToAlert', label: 'keymap.jumpToAlert', key: 'space', rebindable: true }`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/src/ui/minimap.test.ts — append
import { FLASH_MS, flashAlpha } from './minimap';

describe('the alert flash', () => {
  it('is full strength at the event and gone at the end', () => {
    expect(flashAlpha(0)).toBe(1);
    expect(flashAlpha(FLASH_MS / 2)).toBeCloseTo(0.5);
    expect(flashAlpha(FLASH_MS)).toBe(0);
    expect(flashAlpha(FLASH_MS + 1000)).toBe(0);
  });
  // The flash is a TILE, not an entity: the unit the alert is about is usually
  // dead, so an entity-keyed flash would have nothing to draw at.
  it('draws a mark for a point whose unit no longer exists', () => {
    const { minimap } = mount(() => true);           // minimap.test.ts:187
    const strokesBefore = recorder.strokes().length; // the file's own Recorder, minimap.test.ts:66-76
    minimap.flash([{ x: 12, y: 12 }], 1000);
    minimap.onTick();
    expect(recorder.strokes().length).toBeGreaterThan(strokesBefore);
  });
});
```

`mount(visible, over)` (`minimap.test.ts:187`) and the `recorder` installed by `installContext()` (`minimap.test.ts:76-120`) are this file's own harness — a fake 2D context that records every `fillRect`, `stroke` and `drawImage`. Use them; do not add a second probe.

```ts
// packages/app/src/input/keymap.test.ts — append
it('jumpToAlert is bound, rebindable and free of the existing letters', () => {
  const b = bindingsFrom({});
  expect(b.jumpToAlert).toBe('space');
  expect(resolveKey(b, { key: ' ', ctrlKey: false, metaKey: false })).toBe('jumpToAlert');
  const taken = ACTIONS.filter((a) => a.key === 'space' && a.modifier === undefined);
  expect(taken).toHaveLength(1);
});
it('a rebind onto a taken key is still refused, with the new action in the table', () => {
  expect(rebind(bindingsFrom({}), 'jumpToAlert', 'h')).toEqual({ ok: false, takenBy: 'halt' });
});
```

Note `' '` is the physical key and `keyLabel` already maps it to `Space` (`keymap.ts:167`). Store it as `'space'` and normalise: `norm()` lower-cases, so `' '` must be mapped. **This is the one change `keymap.ts` needs beyond the table** — add `' '` to the normalisation so the stored spelling and the event agree:

```ts
const norm = (key: string): string => (key === ' ' ? 'space' : key.toLowerCase());
```

with a test that `resolveKey` answers for both spellings, and `keyLabel('space')` returning `Space` (extend `LABELS` from `' '` to `'space'`).

- [ ] **Step 2: Implement the minimap flash**

In `minimap.ts`, above the class:

```ts
/** How long an alert mark stays on the minimap. Long enough to catch an eye
 *  that was elsewhere when it landed, short enough that three in a row do not
 *  become a permanent decoration. */
export const FLASH_MS = 1400;

/** Linear, because the thing being judged is "is it still there", not a
 *  brightness curve -- and linear is the one shape a reader can check against
 *  the number above without running it. */
export function flashAlpha(ageMs: number): number {
  if (ageMs <= 0) return 1;
  if (ageMs >= FLASH_MS) return 0;
  return 1 - ageMs / FLASH_MS;
}
```

On the class: `private readonly flashes: { p: MinimapPoint; at: number }[] = []`, a `flash(points, nowMs)` that pushes each point and drops any entry older than `FLASH_MS` (so the array cannot grow), and a `drawFlashes(nowMs)` called from `draw()` AFTER the unit dots and BEFORE `drawViewport()` — a mark the player must see over the dots, under the frame that says where they are looking. Draw it as an expanding stroked ring in `CHROME.objective`'s amber at `flashAlpha` — reuse `resolveChrome`'s existing key rather than adding a fifth (an alert is the same "look here" the objective diamond already means; a new token would be a second amber).

`draw()` currently takes no clock. Give it `draw(nowMs = performance.now())` and have `onTick()` pass `performance.now()` — the minimap redraws at 4 Hz (`minimap.ts:395`), so a 1400 ms flash gets about six frames, which is a visible fade. Say that in the comment: the flash is a presentation clock and cannot touch the sim (invariant 4), which is why it is wall time and not ticks.

- [ ] **Step 3: Wire the four sinks in `main.ts`**

Beside the tick loop's existing `runtime.step(events)` block (`main.ts:3044-3068`), one call and four consequences:

```ts
      const { state: nextAlerts, alerts } = alertsForTick(alertState, events, missionEvents, alertWorld, sim.tickCount);
      alertState = nextAlerts;
      for (const a of alerts) {
        if (a.line) hud.note(t(a.line.key, a.line.params), a.line.tone);
        if (a.sound) audio.playUi(a.sound);
        if (a.at) {
          minimap.flash([a.at], performance.now());
          lastAlertAt = a.at;
        }
      }
```

`alertWorld` is built once, beside `intentWorld`, from `sim` and the mission — `posOf` from `sim.state.posX/posY` through `fx.toNumber` (guarding `entity < 0` and `>= sim.entityCount`), `sideOf` from `sim.state.side`, `unitName` from `units[typeId]?.name ?? typeId` (the same lookup `broughtFor`'s caller already uses, `main.ts:1893`), `objectiveAt` from `runtime?.objectiveList`'s `zone` resolved through the map's `zones`/`markers` — the same resolution `minimap.ts`'s `objectivePoints` (`minimap.ts:245-293`) does, and it should CALL that rather than repeat it: export a single-objective helper from `minimap.ts` and use it in both places.

`lastAlertAt: { x: number; y: number } | null` is a plain local. The key, in the keydown switch:

```ts
      case 'jumpToAlert':
        if (lastAlertAt) {
          renderer.camera.x = lastAlertAt.x;
          renderer.camera.y = lastAlertAt.y;
        } else {
          hud.note(t('hud.jump.nothing'), 'mute');
        }
        break;
```

The `else` is not padding: a key that does nothing and says nothing is indistinguishable from a key that is broken, which is the lesson the campaign board's locked-ground `aria-live` line records.

Finally, delete Task 1's temporary `case 'unitLost'` from `describeMissionEvent` — the alert layer owns that line now, with the coalesced count and the name instead of the raw type id — and say so in the commit.

- [ ] **Step 4: Gates, capture, falsify, commit**

Falsify: comment out the `minimap.flash` call — the acceptance drive below shows the line and the sound with no mark; restore. Falsify the pure half: make `flashAlpha` return 1 always — the first test goes red.

**Acceptance (a), driven, not assumed.** `pnpm dev`, open a mission, `__lions.sim.debugKill(__lions.units(0)[0].id)`, then `__lions.step(1)`: within one frame the feed carries the line, the cue plays, and the minimap shows the mark at that tile. Record it in the task report; Task 14 makes it a capture.

```bash
git add packages/app/src/ui/minimap.ts packages/app/src/ui/minimap.test.ts packages/app/src/input/keymap.ts packages/app/src/input/keymap.test.ts packages/app/src/main.ts packages/app/src/i18n/en.json packages/app/src/ui/theme.css
git commit -s -- <the same paths>
```

Message: `feat(hud): alerts -- a line, a cue, a mark on the minimap and a key that takes you there`, body naming the mutation seen red and recording that `describeMissionEvent`'s temporary `unitLost` case is superseded here.

---

### Task 5: The objective tracker — one panel, and what a secondary is worth

§6: "The full list on the briefing; an in-mission tracker toggled from the strip's `+N` and from the pause menu; secondaries with rewards named." This task builds the reward model and the panel, and mounts it on the briefing. Task 6 mounts it the other two ways (R-7: one component, three mounts).

**Files:**
- Create: `packages/app/src/ui/objective-reward.ts`, `packages/app/src/ui/objectives.ts`
- Modify: `packages/app/src/ui/loading.ts` (the `showLoading` signature at 188-230), `packages/app/src/ui/theme.css`, `packages/app/src/i18n/en.json`, `packages/app/src/main.ts` (the `showLoading` call at 1888)
- Test: `packages/app/src/ui/objective-reward.test.ts`, `packages/app/src/ui/objectives.test.ts`, `packages/app/src/ui/loading.test.ts` (extend)

**Interfaces:**
- Consumes: `CREDIT_WEIGHTS` (`@lions/sim`, `credits.ts:16`), `objectiveStatusLabel` (`./objective-status`), `objectiveGlyph` (`./hud-model`), `panel` (`./panel`), `t`.
- Produces (Task 6 consumes these exact names):
  - `interface RewardInput { primary: boolean; carries: boolean; paysCredits: boolean }`
  - `interface Reward { key: string; params: Readonly<Record<string, string | number>> }`
  - `function rewardFor(o: RewardInput): Reward | null`
  - `interface ObjectiveRow { id: string; text: string; primary: boolean; carries: boolean; status: ObjectiveStatus; ticksLeft?: number }`
  - `interface ObjectivesDeps { rows(): readonly ObjectiveRow[]; paysCredits: boolean; onClose?: () => void }`
  - `function objectivesPanel(host: HTMLElement, deps: ObjectivesDeps): { el: HTMLElement; refresh(): void; dispose: Disposer }`

- [ ] **Step 1: Write the failing reward tests**

```ts
// packages/app/src/ui/objective-reward.test.ts
import { describe, expect, it } from 'vitest';
import { CREDIT_WEIGHTS } from '@lions/sim';
import { rewardFor } from './objective-reward';

describe('rewardFor', () => {
  it('names nothing for a primary -- a primary is the mission, not a reward', () => {
    expect(rewardFor({ primary: true, carries: false, paysCredits: true })).toBeNull();
    expect(rewardFor({ primary: true, carries: true, paysCredits: true })).toBeNull();
  });

  it('a carrying secondary pays credits and the third star', () => {
    expect(rewardFor({ primary: false, carries: true, paysCredits: true })).toEqual({
      key: 'objective.reward.carries',
      params: { credits: CREDIT_WEIGHTS.carryingSecondary },
    });
  });

  // The tutorial produces no ledger keys, so `payMission` never runs for it
  // (main.ts gates on `mission.ledger.produces.length > 0`). Promising credits
  // there would be the screen telling the player something the code will not do.
  it('a carrying secondary on a mission that pays nothing names the star only', () => {
    expect(rewardFor({ primary: false, carries: true, paysCredits: false })).toEqual({
      key: 'objective.reward.carriesNoCredits',
      params: {},
    });
  });

  it('a non-carrying secondary says so rather than saying nothing', () => {
    expect(rewardFor({ primary: false, carries: false, paysCredits: true })).toEqual({
      key: 'objective.reward.none',
      params: {},
    });
  });

  // The number is not copied. It is the one the sim will actually pay.
  it('quotes the credit weight rather than a literal', () => {
    const r = rewardFor({ primary: false, carries: true, paysCredits: true });
    expect(r?.params.credits).toBe(CREDIT_WEIGHTS.carryingSecondary);
  });
});
```

`en.json`:

```json
  "objective.reward.carries": "Carries forward · +{credits} credits · needed for the third star",
  "objective.reward.carriesNoCredits": "Carries forward · needed for the third star",
  "objective.reward.none": "Optional · no carry-over"
```

- [ ] **Step 2: Write the failing panel tests, then `objectives.ts`**

```ts
// packages/app/src/ui/objectives.test.ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { objectivesPanel, type ObjectiveRow } from './objectives';

const rows: ObjectiveRow[] = [
  { id: 'a', text: 'Take the crossroads', primary: true, carries: false, status: 'active' },
  { id: 'b', text: 'Hold it', primary: true, carries: false, status: 'complete' },
  { id: 'c', text: 'Do not level the clinic', primary: true, carries: false, status: 'failed' },
  { id: 'd', text: 'Mark the cache', primary: false, carries: true, status: 'active' },
  { id: 'e', text: 'Bring the jeep home', primary: false, carries: false, status: 'active' },
];

describe('objectivesPanel', () => {
  it('shows every objective of a five-objective mission, primaries first', () => {
    const host = document.createElement('div');
    const p = objectivesPanel(host, { rows: () => rows, paysCredits: true });
    const items = [...p.el.querySelectorAll('.rl-obj')];
    expect(items).toHaveLength(5);
    expect(items.map((el) => el.getAttribute('data-primary'))).toEqual(['1', '1', '1', '0', '0']);
    expect(items.map((el) => el.querySelector('.rl-obj__text')?.textContent)).toEqual(rows.map((r) => r.text));
    p.dispose();
  });

  it('names the reward on a secondary and never on a primary', () => {
    const host = document.createElement('div');
    const p = objectivesPanel(host, { rows: () => rows, paysCredits: true });
    const reward = (id: string): string | null =>
      p.el.querySelector(`.rl-obj[data-id="${id}"] .rl-obj__reward`)?.textContent ?? null;
    expect(reward('a')).toBeNull();
    expect(reward('d')).toContain('40');
    expect(reward('e')).toBe('Optional · no carry-over');
    p.dispose();
  });

  it('a status word is the catalogue label, never the sim enum', () => {
    const host = document.createElement('div');
    const p = objectivesPanel(host, { rows: () => rows, paysCredits: true });
    const words = [...p.el.querySelectorAll('.rl-obj__status')].map((el) => el.textContent);
    expect(words).not.toContain('complete');
    expect(words).toContain('Complete');
    p.dispose();
  });

  it('refresh() repaints from the thunk without remounting', () => {
    const host = document.createElement('div');
    let live = rows;
    const p = objectivesPanel(host, { rows: () => live, paysCredits: true });
    const el = p.el;
    live = [{ ...rows[0], status: 'complete' }];
    p.refresh();
    expect(p.el).toBe(el);
    expect(p.el.querySelectorAll('.rl-obj')).toHaveLength(1);
    p.dispose();
  });

  it('dispose takes it off the host and is idempotent', () => {
    const host = document.createElement('div');
    const p = objectivesPanel(host, { rows: () => rows, paysCredits: true });
    p.dispose();
    p.dispose();
    expect(host.childElementCount).toBe(0);
  });
});
```

`objectives.ts` builds a `panel({ rank: 'inspect', title: t('objectives.title') })`, one `<li class="rl-obj" data-id data-primary data-status>` per row carrying `objectiveGlyph(status)`, `.rl-obj__text`, `.rl-obj__status` (`objectiveStatusLabel`), a `.rl-obj__clock` when `ticksLeft !== undefined` (formatted by `hud-model.ts`'s existing clock text — export it if it is private, one line, rather than a second `m:ss`), and `.rl-obj__reward` from `rewardFor`. Sort primaries first, stable within each half — the same `sort((a, b) => Number(b.primary) - Number(a.primary))` `pause.ts:144` already uses. `onClose`, when given, renders a close button; the briefing passes none.

- [ ] **Step 3: The briefing shows the full list**

`showLoading` takes a further optional parameter, **appended after `onBack`** so no existing call site's argument order moves:

```ts
  /** Every objective the mission declares, shown under the orders. The
   *  briefing is the one place the player can read the whole contract before
   *  committing; the strip shows one primary and a count (`stripObjectives`),
   *  which is right on the field and wrong here. Absent for a sandbox. */
  objectives?: readonly ObjectiveRow[],
  /** Whether this mission pays credits at all -- `ledger.produces.length > 0`,
   *  the same gate `main.ts` puts on `payMission`. */
  paysCredits?: boolean
```

Gated on `holds` (`briefingHoldsDeployment`) exactly as the orders paragraph and the commander line are, and mounted as a sibling of the beats — never a beat — so `loading.test.ts`'s beat counts are unaffected. `main.ts` passes `resolvedMission?.objectives.map(...)` and `mission.ledger.produces.length > 0`. Extend `loading.test.ts`: a five-objective briefing shows five rows and the beat count is unchanged; a sandbox shows none.

- [ ] **Step 4: Gates, capture, falsify, commit**

Falsify: make `rewardFor` return the carrying reward for a primary too — the first test goes red. Falsify the panel: sort secondaries first — the `['1','1','1','0','0']` test goes red.

**Acceptance (b), half of it:** `pnpm dev`, open `/mission/umm_zeitoun_4_clearance` (five objectives, the smallest mission that exercises the clause) and read all five on the briefing before deploying. Task 6 finishes the clause in-mission.

```bash
git add packages/app/src/ui/objective-reward.ts packages/app/src/ui/objective-reward.test.ts packages/app/src/ui/objectives.ts packages/app/src/ui/objectives.test.ts packages/app/src/ui/loading.ts packages/app/src/ui/loading.test.ts packages/app/src/ui/theme.css packages/app/src/i18n/en.json packages/app/src/main.ts
git commit -s -- <the same paths>
```

Message: `feat(shell): the objective panel, and what a secondary is actually worth`, body recording that the reward number is `CREDIT_WEIGHTS.carryingSecondary` read from the sim rather than copied, and the mutation seen red.

---

### Task 6: The tracker in the mission — the strip's `+N`, and the pause menu

`stripObjectives` (`hud-model.ts:170-193`) already computes `primaryOpen`/`secondaryOpen` and `hud.ts:865-870` already prints them as two dim spans. They become the control. The pause menu's own `<ol>` (`pause.ts:141-160`) is replaced by the same panel, so the list exists once (R-7).

**Files:**
- Modify: `packages/app/src/ui/hud.ts` (`renderStrip` 819-898; the constructor's root list at 549), `packages/app/src/ui/pause.ts` (141-184), `packages/app/src/main.ts`, `packages/app/src/ui/theme.css`, `packages/app/src/i18n/en.json`
- Test: `packages/app/src/ui/hud.test.ts`, `packages/app/src/ui/pause.test.ts` (extend both)

**Interfaces:**
- Consumes: `objectivesPanel`, `ObjectiveRow` (Task 5).
- Produces:
  - `HudDeps` gains `openObjectives?: () => void`
  - `PauseDeps.objectives()` widens from `{ text, primary, status }[]` to `readonly ObjectiveRow[]`, and `PauseDeps` gains `paysCredits: boolean`
  - `Hud.setObjectivesOpen(open: boolean): void` — so the strip's control can paint its own state

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/src/ui/hud.test.ts — append
it('the +N counts are a button, and clicking one opens the tracker', () => {
  const opened: number[] = [];
  const { hud, host } = rig(mission(), { openObjectives: () => opened.push(1) });  // hud.test.ts:66, :93
  hud.onTick();
  const btn = host.querySelector<HTMLButtonElement>('.rl-strip__more');
  expect(btn).not.toBeNull();
  expect(btn?.tagName).toBe('BUTTON');
  btn?.click();
  expect(opened).toEqual([1]);
});

it('with nothing left open there is no control at all, not a disabled one', () => {
  const { hud, host } = rig(mission({ objectives: [{ id: 'a', text: 'Done', primary: true, status: 'complete' }] }));
  hud.onTick();
  expect(host.querySelector('.rl-strip__more')).toBeNull();
});

// `renderStrip` innerHTMLs `stripBody` four times a second (hud.ts:894). A
// listener bound to the button itself would be dropped 4 Hz and the first
// click would land only if it beat the next rebuild.
it('the control survives a rebuild -- the click is delegated', () => {
  const opened: number[] = [];
  const { hud, host } = rig(mission(), { openObjectives: () => opened.push(1) });
  hud.onTick();
  for (let i = 0; i < 10; i++) hud.onTick();
  host.querySelector<HTMLButtonElement>('.rl-strip__more')?.click();
  expect(opened).toEqual([1]);
});
```

```ts
// packages/app/src/ui/pause.test.ts — append.
// `deps()` (pause.test.ts:10) grows `id`/`carries` on its own objective rows
// and a `paysCredits: true` field in this task; every existing test there
// keeps working, because the two new fields are additive.
it('the Objectives tab is the shared panel, with rewards on the secondaries', () => {
  pauseMenu(document.body, {
    ...deps(),
    objectives: () => [
      { id: 'a', text: 'Take it', primary: true, carries: false, status: 'active' as const },
      { id: 'd', text: 'Mark the cache', primary: false, carries: true, status: 'active' as const },
    ],
    paysCredits: true,
  });
  expect(document.body.querySelectorAll('.rl-obj')).toHaveLength(2);
  expect(document.body.querySelector('.rl-obj[data-id="d"] .rl-obj__reward')?.textContent).toContain('40');
  expect(document.body.querySelector('.rl-pause__list')).toBeNull();   // the old <ol> is gone
});
```

- [ ] **Step 2: Implement**

`hud.ts`: `renderStrip` replaces the two `<span class="rl-dim">` counts with **one** `<button type="button" class="rl-strip__more" data-open-objectives>` carrying `t('hud.strip.open', { primary, secondary })` — one control, not two, because two buttons that open the same panel is two answers to one question. Bind the listener ONCE, in the constructor, delegated on `this.strip` (`ev.target.closest('[data-open-objectives]')`) — `renderStrip` innerHTMLs `stripBody` at 4 Hz and a per-button listener would be dropped with it, which is the lesson that file's own constructor comment records about the speed chips. `setObjectivesOpen` writes `data-open` on the strip so CSS can mark the control while the panel is up.

`pause.ts`: delete the `<ol>` and its loop; mount `objectivesPanel(objectivesPane, { rows: deps.objectives, paysCredits: deps.paysCredits })` in its place, disposed with the modal. Keep `showTab`'s `hidden` toggling — it now hides the panel's element. `objectiveStatusLabel` moves inside `objectives.ts` with the list, so `pause.ts` stops importing it.

`main.ts`: one `objectivesPanel` mounted lazily on `document.body` for the in-mission tracker, behind a toggle — `openObjectives` creates it on first use, calls `refresh()` and shows it; a second call hides it. It is registered in `onDispose` where it is created, and `refresh()` is called from the same 4 Hz point the HUD repaints at (beside `hud.onTick()` in the tick loop) but **only while it is open**, so a closed tracker costs nothing. `rows` is `runtime?.objectiveList ?? []` — which already carries `carries` and `ticksLeft` (`mission.ts:781-823`), so nothing is derived twice. `paysCredits` is `(mission?.ledger.produces.length ?? 0) > 0`.

- [ ] **Step 3: Gates, capture, falsify, commit**

Falsify: bind the strip's click to the button instead of delegating — the "survives a rebuild" test goes red. Restore.

**Acceptance (b), the rest of it:** `/mission/umm_zeitoun_4_clearance`, deploy, click the strip's count: all five objectives readable without leaving the field; Escape → Objectives shows the same five. Record it; Task 14 captures it.

```bash
git add packages/app/src/ui/hud.ts packages/app/src/ui/hud.test.ts packages/app/src/ui/pause.ts packages/app/src/ui/pause.test.ts packages/app/src/main.ts packages/app/src/ui/theme.css packages/app/src/i18n/en.json
git commit -s -- <the same paths>
```

---

### Task 7: One tooltip for the app, the first ten, and the chip name slot

§6: "a shared tooltip component and the first ten tooltips, Conduct first". Today `production.ts:267-284` has a private `bindTip` with `.rl-tip` CSS, and everything else uses a bare `title=` — which is unstyled, slow to appear, invisible to touch and unreachable by keyboard.

**Files:**
- Create: `packages/app/src/ui/tooltip.ts`
- Modify: `packages/app/src/ui/production.ts` (the private `bindTip`, its four call sites), `packages/app/src/ui/hud.ts` (`renderStrip`'s Conduct span, `renderOrders`' `btn.title`, `renderChips`' chip `title`), `packages/app/src/ui/theme.css` (`.rl-tip` at 2036-2078, `.rl-chip__name > span` at 1576)
- Test: `packages/app/src/ui/tooltip.test.ts`, `packages/app/src/ui/hud.test.ts` and `production.test.ts` (extend)

**Interfaces:**
- Produces:
  - `function bindTip(el: HTMLElement, html: () => string, opts?: { host?: HTMLElement }): Disposer`
  - `function closeTip(): void` (for a teardown that happens while one is showing)

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/src/ui/tooltip.test.ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { bindTip, closeTip } from './tooltip';

afterEach(() => closeTip());
const tip = (): HTMLElement | null => document.querySelector('.rl-tip');

describe('bindTip', () => {
  it('shows on hover and on focus, and hides on both partners', () => {
    const el = document.createElement('button');
    document.body.appendChild(el);
    const off = bindTip(el, () => '<b>Conduct</b>');
    expect(tip()?.hidden ?? true).toBe(true);
    el.dispatchEvent(new Event('mouseenter'));
    expect(tip()?.hidden).toBe(false);
    expect(tip()?.innerHTML).toBe('<b>Conduct</b>');
    el.dispatchEvent(new Event('mouseleave'));
    expect(tip()?.hidden).toBe(true);
    el.dispatchEvent(new Event('focus'));
    expect(tip()?.hidden).toBe(false);
    el.dispatchEvent(new Event('blur'));
    expect(tip()?.hidden).toBe(true);
    off();
  });

  it('calls the thunk on every show, so live numbers are live', () => {
    const el = document.createElement('button');
    document.body.appendChild(el);
    let n = 0;
    const off = bindTip(el, () => `${++n}`);
    el.dispatchEvent(new Event('mouseenter'));
    el.dispatchEvent(new Event('mouseleave'));
    el.dispatchEvent(new Event('mouseenter'));
    expect(tip()?.innerHTML).toBe('2');
    off();
  });

  it('Escape closes it, because a tooltip a keyboard cannot dismiss is a trap', () => {
    const el = document.createElement('button');
    document.body.appendChild(el);
    const off = bindTip(el, () => 'x');
    el.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(tip()?.hidden).toBe(true);
    off();
  });

  it('the disposer removes every listener and hides a tip it was showing', () => {
    const el = document.createElement('button');
    document.body.appendChild(el);
    const off = bindTip(el, () => 'x');
    el.dispatchEvent(new Event('mouseenter'));
    off();
    expect(tip()?.hidden).toBe(true);
    el.dispatchEvent(new Event('mouseenter'));
    expect(tip()?.hidden).toBe(true);
  });

  it('describes its element for a screen reader while it is up, and stops after', () => {
    const el = document.createElement('button');
    document.body.appendChild(el);
    const off = bindTip(el, () => 'x');
    el.dispatchEvent(new Event('focus'));
    expect(el.getAttribute('aria-describedby')).toBe(tip()?.id);
    el.dispatchEvent(new Event('blur'));
    expect(el.hasAttribute('aria-describedby')).toBe(false);
    off();
  });
});
```

- [ ] **Step 2: Write `tooltip.ts`, and move `production.ts` onto it**

One lazily-created `.rl-tip` element on `document.body` (or `opts.host`, which is how `production.ts` keeps its tip inside the dock's own stacking context), `id="rl-tip"`, `role="tooltip"`, `hidden` when idle. `show` sets `innerHTML` from the thunk, writes `--tip-x`/`--tip-y` from `el.getBoundingClientRect()` (above the element, clamped so the tip never leaves the viewport), unhides, and sets `aria-describedby`. One `window` `keydown` listener for Escape, registered on first show and removed on last hide — not one per bound element.

`theme.css`: `.rl-tip` moves from `position: absolute; left: var(--tip-x); bottom: 100%` to `position: fixed; left: var(--tip-x); top: var(--tip-y)`, and **declares `--tip-y: 0` beside the existing `--tip-x: 0`** — an undeclared custom property is a `pnpm validate:ui` failure, which that block's own comment already records.

`production.ts`: delete the private `bindTip`, import the shared one, and keep its four call sites unchanged except that each now records the returned disposer in the dock's own teardown. `production.test.ts`'s existing tip assertions should pass unmodified; if one reads `--tip-x` off the element, update it to the new positioning and say so.

- [ ] **Step 3: The first ten tooltips, Conduct first**

Ten, each replacing a `title=` or nothing at all, each a catalogue key:

1. **Conduct** (`hud.ts:831`) — `conductDefinition()` verbatim, which is already written and currently hidden inside a `title`. This is the one §6 names, and the strip's ROE numeral is the least self-explanatory thing on screen.
2. **Logistics** (`hud.ts:885`) — what it is and what the mission pays per minute.
3. **Intel** (`hud.ts:889`).
4. **Pinned** and 5. **Broken** (`hud.ts:893-894`) — two states a player sees before they have a name for them.
6–10. **The five order buttons** (`renderOrders`, `hud.ts:1139`): what the verb does, its key (already rendered on the face — the tooltip says what it DOES), and, when `row.inert`, why it is inert. `btn.title` goes away.

Plus the chip: `renderChips`' `title` attribute (`hud.ts:1180`) becomes a bound tip with the unit's name and count — bound in the constructor's delegated listener rather than per chip, since the chips are innerHTML'd at 4 Hz. Where a tip is bound to a rebuilt element, the binding is delegated on the container by `data-tip="<key>"` and one `mouseover`/`focusin` listener; state that in `tooltip.ts`'s header as the second supported shape.

- [ ] **Step 4: The chip name slot stops ellipsising**

`.rl-chip__name > span` ellipsises because `--chip-w` is `9.375rem` (`theme.css:205`) and several unit names are longer — `hud.ts:1184`'s own comment records "AH-64 Peten" being cut. §6 asks for the name to read. Widen `--chip-w` to `11.5rem` and let the name wrap to a second line rather than clip: `white-space: normal; overflow-wrap: break-word;` on `.rl-chip__name > span`, `text-overflow` removed. A test in `hud.test.ts` reads the computed style back from `theme.css` (the shape `brigade.test.ts` established for the type floor) and asserts `text-overflow` is not `ellipsis` on that selector. Check the widened row at 1280 CSS px in the capture pass: six chips at 11.5rem still fit inside the cluster, and Task 14's `07`/`08` states are where that is judged.

- [ ] **Step 5: Gates, capture, falsify, commit**

Falsify: make `bindTip` cache the thunk's first result — the "live numbers are live" test goes red. Falsify the CSS assertion by putting `text-overflow: ellipsis` back — it goes red.

```bash
git add packages/app/src/ui/tooltip.ts packages/app/src/ui/tooltip.test.ts packages/app/src/ui/production.ts packages/app/src/ui/production.test.ts packages/app/src/ui/hud.ts packages/app/src/ui/hud.test.ts packages/app/src/ui/theme.css packages/app/src/i18n/en.json
git commit -s -- <the same paths>
```

---

### Task 8: F1 — every binding, from the table settings rebinds

§6: "an F1 overlay listing every binding from the same table settings rebinds". The table is `ACTIONS` (`keymap.ts:34-49`), and `settings-keymap.ts` already renders one row per action from it. The overlay reads the same array, so a binding that exists and is not listed is not expressible.

**Files:**
- Create: `packages/app/src/ui/keys-overlay.ts`
- Modify: `packages/app/src/input/keymap.ts` (`Action`, `ACTIONS`), `packages/app/src/main.ts`, `packages/app/src/ui/theme.css`, `packages/app/src/i18n/en.json`
- Test: `packages/app/src/ui/keys-overlay.test.ts`, `packages/app/src/input/keymap.test.ts` (extend)

**Interfaces:**
- Produces:
  - `Action` gains `'keysOverlay'`; `ACTIONS` gains `{ id: 'keysOverlay', label: 'keymap.keysOverlay', key: 'f1', rebindable: true }`
  - `interface KeysOverlayDeps { bindings(): Bindings; onClose(): void }`
  - `function showKeysOverlay(host: HTMLElement, deps: KeysOverlayDeps): Disposer`
  - `const UNBOUND_KEYS: readonly { label: string; keys: string }[]` — the three things that are deliberately NOT in `ACTIONS`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/src/ui/keys-overlay.test.ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { ACTIONS, bindingsFrom, keyLabel } from '../input/keymap';
import { UNBOUND_KEYS, showKeysOverlay } from './keys-overlay';

const mount = () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const closed: number[] = [];
  const dispose = showKeysOverlay(host, { bindings: () => bindingsFrom({}), onClose: () => closed.push(1) });
  return { host, closed, dispose };
};

describe('showKeysOverlay', () => {
  // The whole point: not "a list of keys" but "THE list", derived.
  it('lists every action in ACTIONS and nothing invented', () => {
    const { host, dispose } = mount();
    const ids = [...host.querySelectorAll('.rl-keys__row')].map((el) => el.getAttribute('data-action'));
    expect(ids).toEqual(ACTIONS.map((a) => a.id));
    dispose();
  });

  it('prints the LIVE binding, so a rebind shows here', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dispose = showKeysOverlay(host, { bindings: () => bindingsFrom({ halt: 'k' }), onClose: () => undefined });
    const cap = host.querySelector('.rl-keys__row[data-action="halt"] .rl-keys__cap')?.textContent;
    expect(cap).toBe(keyLabel('k'));
    dispose();
  });

  it('shows the modifier a modified action needs', () => {
    const { host, dispose } = mount();
    expect(host.querySelector('.rl-keys__row[data-action="selectAll"] .rl-keys__cap')?.textContent)
      .toMatch(/Ctrl/);
    dispose();
  });

  // The control groups and the two mouse buttons are real bindings that
  // deliberately are not in ACTIONS (keymap.ts's own header says why for the
  // digits). An overlay that omitted them would be complete and useless.
  it('lists what is bound outside the table too', () => {
    const { host, dispose } = mount();
    const extra = [...host.querySelectorAll('.rl-keys__row--fixed')];
    expect(extra).toHaveLength(UNBOUND_KEYS.length);
    expect(UNBOUND_KEYS.length).toBeGreaterThanOrEqual(3);
    dispose();
  });

  it('Escape and a click on the scrim both close it', () => {
    const a = mount();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(a.closed).toEqual([1]);
    a.dispose();
    const b = mount();
    b.host.querySelector<HTMLElement>('.rl-keys')?.click();
    expect(b.closed).toEqual([1]);
    b.dispose();
  });

  it('dispose leaves the document as it found it', () => {
    const { host, dispose } = mount();
    dispose();
    expect(host.childElementCount).toBe(0);
  });
});
```

- [ ] **Step 2: Implement**

`keymap.ts`: the new action, and nothing else. **Check for a collision before choosing the key** — `f1` is free, and `unassignable` refuses only digits, the four arrows and the empty string, so `f1` is also rebindable-onto, which is correct.

`keys-overlay.ts`: a scrim + `panel({ rank: 'inspect' })`, one `.rl-keys__row[data-action]` per `ACTIONS` entry with `t(a.label)` and a keycap built from `keyLabel(bindings()[a.id])` prefixed with the modifier when `a.modifier === 'ctrl'` (`t('keymap.modifier.ctrl')`, so the Mac/Windows wording is a catalogue decision and not a hardcoded word). Then `UNBOUND_KEYS`, a short table of the three bindings outside `ACTIONS`, each `.rl-keys__row--fixed`:

```ts
/** Real bindings that are deliberately NOT in `ACTIONS`, and why each is
 *  outside it. `keymap.ts`'s own header states the rule for the first: every
 *  RTS player expects control groups on exactly those keys, so the digits are
 *  refused as rebind targets. The two mouse buttons are not keys at all, so
 *  there is nothing for a keyboard table to hold. A player does not care about
 *  any of that and needs all three listed. */
export const UNBOUND_KEYS: readonly { label: string; keys: string }[] = [
  { label: 'keys.groups.assign', keys: 'keys.cap.ctrlDigit' },
  { label: 'keys.groups.recall', keys: 'keys.cap.digit' },
  { label: 'keys.select', keys: 'keys.cap.lmb' },
  { label: 'keys.order', keys: 'keys.cap.rmb' },
];
```

(Both fields are catalogue keys, resolved at render — the table-at-module-load trap CLAUDE.md names.)

`main.ts`: the `keysOverlay` case in the keydown switch toggles it; the overlay mounts on `document.body` and registers its teardown with `onDispose` where it is created. It must **not** open over the pause menu (`isDialogOpen()`), and it must call `ev.preventDefault()` — F1 is the browser's own help key.

- [ ] **Step 3: Gates, capture, falsify, commit**

Falsify: hardcode the row list instead of mapping `ACTIONS` and add one action — the first test goes red naming the missing id. Restore.

```bash
git add packages/app/src/ui/keys-overlay.ts packages/app/src/ui/keys-overlay.test.ts packages/app/src/input/keymap.ts packages/app/src/input/keymap.test.ts packages/app/src/main.ts packages/app/src/ui/theme.css packages/app/src/i18n/en.json
git commit -s -- <the same paths>
```

---

### Task 9: The hint line, unhidden — and the two things nobody finds

§6: "the hint line no longer hidden by a selection", and "projected fire and the dock made discoverable". `renderHint` (`hud.ts:922-935`) hides the line the moment anything is selected, which is exactly when a new player most needs it. Projected fire (`renderFire`) appears only while hovering a hostile WITH a selection, and the dock is behind `b` — neither announces itself.

**Files:**
- Create: `packages/app/src/ui/hint-model.ts`
- Modify: `packages/app/src/ui/hud.ts` (`renderHint` 922-935), `packages/app/src/main.ts`, `packages/app/src/i18n/en.json`
- Test: `packages/app/src/ui/hint-model.test.ts`, `packages/app/src/ui/hud.test.ts` (extend)

**Interfaces:**
- Produces:
  - `interface HintFacts { selected: number; hoveringHostile: boolean; sawProjectedFire: boolean; sawDock: boolean; dockAvailable: boolean }`
  - `function hintFor(f: HintFacts): { key: string; params?: Readonly<Record<string, string | number>> } | null`
  - `const FIRST_USE_KEY = 'lions.seen'` and `function loadSeen(store: StorageLike | null): { projectedFire: boolean; dock: boolean }`, `function markSeen(store: StorageLike | null, what: 'projectedFire' | 'dock'): void`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/src/ui/hint-model.test.ts
import { describe, expect, it } from 'vitest';
import { hintFor, loadSeen, markSeen } from './hint-model';

const base = { selected: 0, hoveringHostile: false, sawProjectedFire: true, sawDock: true, dockAvailable: true };

describe('hintFor', () => {
  it('teaches the controls with nothing selected, as it always did', () => {
    expect(hintFor(base)?.key).toBe('hud.controlHint');
  });

  // The inversion this task exists for.
  it('still says something with a selection -- the line is no longer hidden', () => {
    expect(hintFor({ ...base, selected: 3 })).not.toBeNull();
    expect(hintFor({ ...base, selected: 3 })?.key).toBe('hud.hint.selected');
  });

  it('a first-time player hovering a hostile is told what the panel beside it is', () => {
    expect(hintFor({ ...base, selected: 2, hoveringHostile: true, sawProjectedFire: false })?.key)
      .toBe('hud.hint.projectedFire');
  });

  it('and is told once -- after that the ordinary line comes back', () => {
    expect(hintFor({ ...base, selected: 2, hoveringHostile: true, sawProjectedFire: true })?.key)
      .toBe('hud.hint.selected');
  });

  it('names the dock only on a mission that has one', () => {
    expect(hintFor({ ...base, sawDock: false, dockAvailable: true })?.key).toBe('hud.hint.dock');
    expect(hintFor({ ...base, sawDock: false, dockAvailable: false })?.key).toBe('hud.controlHint');
  });

  // Two first-use hints can be owed at once; one line can hold one.
  it('shows the hint the player is closest to needing, never two', () => {
    const h = hintFor({ ...base, selected: 2, hoveringHostile: true, sawProjectedFire: false, sawDock: false });
    expect(h?.key).toBe('hud.hint.projectedFire');
  });
});

describe('first-use memory', () => {
  const store = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };
  it('round-trips and defaults to unseen', () => {
    const s = store();
    expect(loadSeen(s)).toEqual({ projectedFire: false, dock: false });
    markSeen(s, 'dock');
    expect(loadSeen(s)).toEqual({ projectedFire: false, dock: true });
  });
  it('survives a store that is missing, blocked, or holding rubbish', () => {
    expect(loadSeen(null)).toEqual({ projectedFire: false, dock: false });
    const bad = { getItem: () => '{{{', setItem: () => { throw new Error('blocked'); } };
    expect(loadSeen(bad)).toEqual({ projectedFire: false, dock: false });
    expect(() => markSeen(bad, 'dock')).not.toThrow();
  });
});
```

The store tests are written against a Map-backed fake because `window.localStorage` in this vitest jsdom config is a bare `{}` (CLAUDE.md).

- [ ] **Step 2: Implement**

`hint-model.ts`: `hintFor` as a priority list — projected fire (owed, hovering a hostile, something selected) → dock (owed, available) → selected (something selected) → controls. `loadSeen`/`markSeen` over a single `lions.seen` JSON object, guarded exactly the way `settings.ts:108-124` guards its own store, and with a comment saying why this is not a `Settings` field: it is not a preference, nobody would look for it in a settings screen, and adding it there would mean a settings reset erasing a tutorial memory.

`hud.ts`: `renderHint` stops early-returning on a selection and instead asks `this.deps.hint?.()` — a thunk `main.ts` supplies from `hintFor(...)` — falling back to `t('hud.controlHint')` when absent, which is exactly today's behaviour for a HUD built without the dep. `HudDeps` gains `hint?: () => { key: string; params?: Readonly<Record<string, string | number>> } | null`.

`main.ts`: builds the facts (selection length, `renderer.hoverEntity >= 0`, the two `seen` flags, `mission?.resources !== undefined` for the dock), and marks each seen the first time the thing is actually USED — `markSeen(storage, 'projectedFire')` when the fire panel has been on screen for a few consecutive frames, `markSeen(storage, 'dock')` inside the `production` action's handler. Marking on SHOWING the hint rather than on using the feature would teach nobody: the hint would vanish the first time it appeared.

- [ ] **Step 3: Gates, capture, falsify, commit**

Falsify: put the `selected > 0` early return back in `renderHint` — the "still says something with a selection" test goes red.

```bash
git add packages/app/src/ui/hint-model.ts packages/app/src/ui/hint-model.test.ts packages/app/src/ui/hud.ts packages/app/src/ui/hud.test.ts packages/app/src/main.ts packages/app/src/i18n/en.json
git commit -s -- <the same paths>
```

---

### Task 10: The minimap becomes a control

§6: "Click to jump, drag to pan, right-click to order, a ping, a frame, a shape-coded hostile mark". The constructor's own comment (`minimap.ts:372-376`) says the canvas deliberately swallows clicks "until click-to-jump exists". It exists now. Ground from the lit albedo is Task 15 (R-6).

**Files:**
- Modify: `packages/app/src/ui/minimap.ts`, `packages/app/src/main.ts` (the mount at 2417-2428), `packages/app/src/ui/theme.css`
- Test: `packages/app/src/ui/minimap.test.ts` (extend)

**Interfaces:**
- Consumes: `resolvePointer`, `applyIntent`, `PointerContext` (`input/intents.ts`), `Renderer.addOrderMarker`.
- Produces:
  - `function boxToTile(p: MinimapProjection, bx: number, by: number, w: number, h: number): MinimapPoint` — the inverse of `tileToBox`, clamped to the map
  - `type DotShape = 'square' | 'triangle' | 'circle'`; `function dotShape(side: number): DotShape`
  - `const PING_MS = 2500`; `function linearFade(ageMs: number, spanMs: number): number` (Task 4's `flashAlpha` becomes `linearFade(age, FLASH_MS)`)
  - `interface MinimapInput { jumpTo(x: number, y: number): void; order(x: number, y: number, mods: { append: boolean; confirm: boolean }): void; ping(x: number, y: number): void }`
  - `MinimapDeps` gains `input?: MinimapInput` (optional, so every existing test mounts unchanged)
  - `Minimap.ping(x: number, y: number, nowMs: number): void`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/src/ui/minimap.test.ts — append
import { PING_MS, boxToTile, dotShape, linearFade, minimapProjection, tileToBox } from './minimap';

describe('boxToTile', () => {
  const p = minimapProjection(48, 48, 210);
  it('is the inverse of tileToBox', () => {
    for (const [tx, ty] of [[0, 0], [12.5, 30.25], [47.9, 47.9]] as const) {
      const b = tileToBox(p, tx, ty);
      const back = boxToTile(p, b.x, b.y, 48, 48);
      expect(back.x).toBeCloseTo(tx, 5);
      expect(back.y).toBeCloseTo(ty, 5);
    }
  });
  it('clamps a point in the letterbox to the map, never off it', () => {
    const wide = minimapProjection(48, 24, 210);      // a hypothetical non-square map
    expect(boxToTile(wide, 105, 0, 48, 24)).toEqual({ x: 24, y: 0 });
    expect(boxToTile(wide, -50, 999, 48, 24)).toEqual({ x: 0, y: 24 });
  });
});

describe('dotShape', () => {
  it('gives each side its own silhouette, so colour is not the only channel', () => {
    expect(dotShape(0)).toBe('square');
    expect(dotShape(1)).toBe('triangle');
    expect(dotShape(2)).toBe('circle');
    expect(dotShape(7)).toBe('circle');
  });
});

// jsdom has no `PointerEvent` and its `offsetX`/`offsetY` are read-only zeros,
// so the events are plain `MouseEvent`s carrying `clientX`/`clientY` -- which
// is why the IMPLEMENTATION must read `clientX - rect.left`, the way
// `main.ts`'s own `canvasXY` does, rather than `offsetX`. One convention for
// pointer coordinates in this app, and a testable one.
const at = (kind: string, x: number, y: number, init: MouseEventInit = {}): MouseEvent =>
  new MouseEvent(kind, { bubbles: true, cancelable: true, clientX: x, clientY: y, ...init });
const noopInput = { jumpTo: () => undefined, order: () => undefined, ping: () => undefined };
const canvasOf = (): HTMLCanvasElement => {
  const el = document.body.querySelector<HTMLCanvasElement>('canvas.rl-minimap');
  if (!el) throw new Error('no minimap canvas');
  return el;
};

describe('minimap input', () => {
  it('a left click jumps the camera to that tile', () => {
    const jumps: MinimapPoint[] = [];
    mount(() => true, { input: { ...noopInput, jumpTo: (x, y) => jumps.push({ x, y }) } });
    const c = canvasOf();
    c.dispatchEvent(at('pointerdown', 105, 105, { button: 0 }));
    c.dispatchEvent(at('pointerup', 105, 105, { button: 0 }));
    expect(jumps).toHaveLength(1);
    expect(jumps[0].x).toBeCloseTo(24, 1);
  });

  // Drag and click are ONE path: a click is a drag of zero length. Two code
  // paths here would be two answers to "where did the player point".
  it('a drag keeps jumping while the button is down, and stops on release', () => {
    const jumps: MinimapPoint[] = [];
    mount(() => true, { input: { ...noopInput, jumpTo: (x, y) => jumps.push({ x, y }) } });
    const c = canvasOf();
    c.dispatchEvent(at('pointerdown', 20, 20, { button: 0 }));
    c.dispatchEvent(at('pointermove', 60, 60));
    c.dispatchEvent(at('pointermove', 100, 100));
    c.dispatchEvent(at('pointerup', 100, 100));
    c.dispatchEvent(at('pointermove', 140, 140));
    expect(jumps).toHaveLength(4);      // down + two moves + up, and nothing after
  });

  it('a right click orders, with the modifiers, and never jumps', () => {
    const orders: { mods: { append: boolean; confirm: boolean } }[] = [];
    const jumps: number[] = [];
    mount(() => true, {
      input: { ...noopInput, jumpTo: () => jumps.push(1), order: (x, y, mods) => orders.push({ mods }) },
    });
    canvasOf().dispatchEvent(at('contextmenu', 105, 105, { shiftKey: true, altKey: true }));
    expect(jumps).toEqual([]);
    expect(orders).toEqual([{ mods: { append: true, confirm: true } }]);
  });

  it('alt+left pings instead of jumping', () => {
    const pings: MinimapPoint[] = [];
    const jumps: number[] = [];
    mount(() => true, { input: { ...noopInput, jumpTo: () => jumps.push(1), ping: (x, y) => pings.push({ x, y }) } });
    canvasOf().dispatchEvent(at('pointerdown', 105, 105, { button: 0, altKey: true }));
    expect(pings).toHaveLength(1);
    expect(jumps).toEqual([]);
  });

  // The pre-existing promise the constructor makes (minimap.test.ts's own
  // subject, `minimap.ts:372-376`): a click must never fall through to the
  // battlefield underneath.
  it('still swallows every pointer event it handles', () => {
    mount(() => true, { input: noopInput });
    const ev = at('contextmenu', 10, 10);
    canvasOf().dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('with no input wired the canvas is inert, exactly as it was', () => {
    mount(() => true);
    expect(() => canvasOf().dispatchEvent(at('pointerdown', 10, 10, { button: 0 }))).not.toThrow();
  });
});

describe('the ping', () => {
  it('fades over PING_MS and then is gone', () => {
    expect(linearFade(0, PING_MS)).toBe(1);
    expect(linearFade(PING_MS, PING_MS)).toBe(0);
  });
});
```

- [ ] **Step 2: Implement the minimap half**

`boxToTile` and `dotShape` are pure and go above the class. The dots loop in `draw()` (`minimap.ts:468-472`) switches on `dotShape(d.side)` — a square is today's `fillRect`, a triangle is a 6px-tall equilateral drawn as a path, a circle is an `arc` + `fill`. **Colour is unchanged** and the shape is added beside it, not instead of it: G0 decision #3 says the team colours were measured not to collapse, so this is redundancy, not a replacement, and the plan should not claim otherwise. **The test file's fake context has no `arc` and no `fill`** (`installContext`, `minimap.test.ts:76-120`, which records `fillRect`, `stroke` and `drawImage` only) — extend it with the same op-recording shape, and add a `dots()`-style reader beside `fills()`/`strokes()` so a test can ask which SHAPE was drawn rather than only which colour.

The frame is CSS on `.rl-minimap`: `border: 1px solid var(--panel-frame)` — a 1px hairline, which is what `validate:ui`'s px rule is written to allow.

Pointer handling on `this.el`, all of it `preventDefault()`ing: `pointerdown` (button 0) sets a dragging flag and calls `jumpTo` (or `ping` when `altKey`), `pointermove` calls `jumpTo` while dragging, `pointerup` calls it once more and clears the flag, `contextmenu` calls `order`. Two implementation details that are not free choices:

- **Coordinates are `ev.clientX - rect.left`, not `ev.offsetX`.** `main.ts`'s own `canvasXY` already does it that way, so this is the app's one convention rather than a second; and `offsetX` in jsdom is a read-only zero, which would make every input test above pass for the wrong reason. No DPR scaling: the backing store is `MINIMAP_SIZE * dpr` but the CSS size is `MINIMAP_SIZE`, and `boxToTile` works in CSS pixels.
- **`setPointerCapture` is called optionally** (`this.el.setPointerCapture?.(ev.pointerId)`), so a drag that leaves the canvas keeps panning in a browser and the same code runs under jsdom, which implements neither that method nor `PointerEvent`.

`destroy()` releases the listeners with the element.

The ping is `{ p, at }[]` drawn in `draw()` after the flashes, as an expanding ring plus a static centre dot in `CHROME.story`, `linearFade(age, PING_MS)`; entries older than `PING_MS` are dropped on push so the array cannot grow.

- [ ] **Step 3: Wire it in `main.ts` — and the order goes through the existing resolver**

```ts
    input: {
      jumpTo: (x, y) => {
        renderer.camera.x = x;
        renderer.camera.y = y;
      },
      // The SAME resolver and the SAME adapter the canvas contextmenu uses
      // (main.ts:2811-2837). Not a second implementation: a minimap order that
      // resolved differently from the identical click on the field is two
      // answers to one question, and `resolvePointer`'s own doc comment is
      // about exactly that failure.
      order: (x, y, mods) => {
        const mine = renderer.selection.filter((i) => sim.state.side[i] === 0 && sim.state.alive[i] === 1);
        const res = resolvePointer(intentWorld, { ids: mine, x, y, append: mods.append, armed: null, confirm: mods.confirm });
        for (const intent of res.intents) dispatch(intent);
        if (res.note) hud.note(res.note.text, res.note.tone);
        if (res.marker) renderer.addOrderMarker(x, y);
      },
      // Local and silent to the sim (R-10): a mark here and a marker on the
      // field, nothing queued, nothing dispatched, no intent kind. There is no
      // second player to signal.
      ping: (x, y) => {
        minimap.ping(x, y, performance.now());
        renderer.addOrderMarker(x, y);
      },
    },
```

`minimap` is referenced inside its own options object, so build the options after the instance or use a `let`; say which in the implementation and keep it obvious.

- [ ] **Step 4: Gates, capture, falsify, commit**

Falsify: make `order` call `sim.queueCommand` directly instead of `resolvePointer` — the protected-structure case then differs between a field right-click and a minimap right-click; the assertion that catches it is a new `intents.test.ts`-style check that both paths produce the identical `Resolution` for the same tile, which this task adds. Falsify the drag: stop listening to `pointermove` — the four-jump test goes red.

Drive it: `/free-play/tel_marum`, click across the box (camera follows), drag (camera follows continuously), right-click on ground with a squad selected (an order lands and a marker drops), alt+click (a mark, no order).

```bash
git add packages/app/src/ui/minimap.ts packages/app/src/ui/minimap.test.ts packages/app/src/main.ts packages/app/src/ui/theme.css
git commit -s -- <the same paths>
```

---

### Task 11: The control-group bar, and the idle-unit finder

R-2: the bar is a surface over the groups `main.ts:2979-3020` already keeps. The idle finder is new, and is the one thing in §6's "control groups, idle finder, edge pan, zoom to cursor" that does not exist in any form.

**Files:**
- Create: `packages/app/src/ui/group-bar.ts`, `packages/app/src/ui/idle.ts`
- Modify: `packages/app/src/input/keymap.ts`, `packages/app/src/main.ts`, `packages/app/src/ui/theme.css`, `packages/app/src/i18n/en.json`
- Test: `packages/app/src/ui/group-bar.test.ts`, `packages/app/src/ui/idle.test.ts`, `packages/app/src/input/keymap.test.ts` (extend)

**Interfaces:**
- Produces:
  - `interface GroupChip { slot: number; count: number; hpPct: number }`; `function groupChips(groups: ReadonlyMap<number, readonly number[]>, facts: (id: number) => { alive: boolean; hp: number; hpMax: number } | null): GroupChip[]`
  - `interface GroupBarDeps { chips(): readonly GroupChip[]; onRecall(slot: number): void; groupColor(slot: number): string }`; `function groupBar(host: HTMLElement, deps: GroupBarDeps): { el: HTMLElement; refresh(): void; dispose: Disposer }`
  - `interface IdleFacts { alive: boolean; side: number; moving: boolean; waypoints: number; curTarget: number; curStructure: number; demoTarget: number; carriedBy: number; garrisonedIn: number }`; `function isIdle(f: IdleFacts): boolean`; `function nextIdle(ids: readonly number[], after: number, idle: (id: number) => boolean): number`
  - `Action` gains `'idleNext'`; `ACTIONS` gains `{ id: 'idleNext', label: 'keymap.idleNext', key: 'i', rebindable: true }`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/src/ui/idle.test.ts
import { describe, expect, it } from 'vitest';
import { isIdle, nextIdle } from './idle';

const busy = { alive: true, side: 0, moving: false, waypoints: 0, curTarget: -1, curStructure: -1, demoTarget: -1, carriedBy: -1, garrisonedIn: -1 };

describe('isIdle', () => {
  it('a living player unit doing nothing is idle', () => {
    expect(isIdle(busy)).toBe(true);
  });
  it('every one of these is work', () => {
    expect(isIdle({ ...busy, moving: true })).toBe(false);
    expect(isIdle({ ...busy, waypoints: 2 })).toBe(false);
    expect(isIdle({ ...busy, curTarget: 4 })).toBe(false);
    expect(isIdle({ ...busy, curStructure: 4 })).toBe(false);
    expect(isIdle({ ...busy, demoTarget: 4 })).toBe(false);
  });
  // A unit in a vehicle or in a building is not "idle and forgotten" -- it is
  // where the player put it, and offering to jump to it would walk the player
  // through the same three passengers every time they pressed the key.
  it('a passenger and a garrison are posted, not idle', () => {
    expect(isIdle({ ...busy, carriedBy: 3 })).toBe(false);
    expect(isIdle({ ...busy, garrisonedIn: 3 })).toBe(false);
  });
  it('the dead and the enemy are never idle', () => {
    expect(isIdle({ ...busy, alive: false })).toBe(false);
    expect(isIdle({ ...busy, side: 1 })).toBe(false);
  });
});

describe('nextIdle', () => {
  const idle = (id: number) => id % 2 === 0;
  it('walks forward from the last one and wraps', () => {
    expect(nextIdle([0, 1, 2, 3, 4], -1, idle)).toBe(0);
    expect(nextIdle([0, 1, 2, 3, 4], 0, idle)).toBe(2);
    expect(nextIdle([0, 1, 2, 3, 4], 4, idle)).toBe(0);
  });
  it('is -1 when nobody is idle, rather than looping forever', () => {
    expect(nextIdle([1, 3], -1, idle)).toBe(-1);
  });
  it('starts from the front when the remembered unit is gone from the list', () => {
    expect(nextIdle([0, 2], 99, idle)).toBe(0);
  });
});
```

```ts
// packages/app/src/ui/group-bar.test.ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { groupBar, groupChips } from './group-bar';

const facts = (id: number) => ({ alive: id < 10, hp: 50, hpMax: 100 });

describe('groupChips', () => {
  it('one chip per assigned slot, in slot order, with the living count', () => {
    const g = new Map([[3, [1, 2, 11]], [1, [4]]]);
    expect(groupChips(g, facts)).toEqual([
      { slot: 1, count: 1, hpPct: 0.5 },
      { slot: 3, count: 2, hpPct: 0.5 },
    ]);
  });
  it('a slot whose members are all dead shows nothing -- not an empty chip', () => {
    expect(groupChips(new Map([[2, [11, 12]]]), facts)).toEqual([]);
  });
  it('an unassigned slot is absent, never a placeholder', () => {
    expect(groupChips(new Map(), facts)).toEqual([]);
  });
});

describe('groupBar', () => {
  it('draws the slot number and recalls on click', () => {
    const host = document.createElement('div');
    const recalled: number[] = [];
    const bar = groupBar(host, {
      chips: () => [{ slot: 2, count: 3, hpPct: 0.8 }],
      onRecall: (s) => recalled.push(s),
      groupColor: () => 'var(--live)',
    });
    const chip = bar.el.querySelector<HTMLButtonElement>('.rl-group[data-slot="2"]');
    expect(chip?.textContent).toContain('2');
    expect(chip?.textContent).toContain('3');
    chip?.click();
    expect(recalled).toEqual([2]);
    bar.dispose();
  });
  it('refresh() rebuilds from the thunk, and the click still works after', () => {
    const host = document.createElement('div');
    const recalled: number[] = [];
    let live = [{ slot: 1, count: 1, hpPct: 1 }];
    const bar = groupBar(host, { chips: () => live, onRecall: (s) => recalled.push(s), groupColor: () => 'var(--live)' });
    live = [{ slot: 5, count: 2, hpPct: 0.4 }];
    bar.refresh();
    bar.el.querySelector<HTMLButtonElement>('.rl-group[data-slot="5"]')?.click();
    expect(recalled).toEqual([5]);
    bar.dispose();
  });
});
```

The refresh test is the one that matters: like the HUD's chips, this bar is rebuilt on a cadence, so the click must be delegated on the container rather than bound per chip.

- [ ] **Step 2: Implement**

`idle.ts` takes a facts struct, never a `Sim` — so it is a node test with no world. `main.ts` builds the facts from `sim.state` and `sim.waypointCount(id)` (`sim.ts:1527`).

`group-bar.ts` mounts a row of `.rl-group` buttons on `document.body` beside the HUD's own panes, slot number in the display face, living count, and a `.rl-track` health bar in `groupColor(slot)` — `main.ts` passes `opts.groupColors[slot - 1]`, the same nine palette entries `renderer.unitGroup` already draws the badge with (`main.ts:1540-1550`), so the bar and the badge over the unit's head are the same colour by construction.

`main.ts`: `refresh()` beside `hud.onTick()`; `onRecall(slot)` calls **the same recall path the digit key runs** — extract that block (`main.ts:3004-3020`) into a local `recallGroup(slot)` and have both the keydown case and the bar call it, so R-2's "not a second mechanism" is true in the code and not only in this plan. The `idleNext` case: `nextIdle` over the living side-0 ids, then `renderer.selection = [id]`, `dispatch({ kind: 'select', ids: [id], via: 'click' })` and a camera jump; with nobody idle, `hud.note(t('hud.idle.none'), 'mute')` — the same "say why" rule Task 4's jump key follows.

- [ ] **Step 3: Gates, capture, falsify, commit**

Falsify: make `isIdle` ignore `waypoints` — the "every one of these is work" test goes red on the waypoint case. Falsify the bar: bind the click per chip instead of delegating — the refresh test goes red.

```bash
git add packages/app/src/ui/group-bar.ts packages/app/src/ui/group-bar.test.ts packages/app/src/ui/idle.ts packages/app/src/ui/idle.test.ts packages/app/src/input/keymap.ts packages/app/src/input/keymap.test.ts packages/app/src/main.ts packages/app/src/ui/theme.css packages/app/src/i18n/en.json
git commit -s -- <the same paths>
```

---

### Task 12: Edge pan and zoom to cursor, with the settings rows that make them honest

R-9, and D-12 discharged: the features and their settings land together. Today the wheel zooms about the screen centre (`main.ts:3030-3033`) and there is no edge pan at all.

**Files:**
- Create: `packages/app/src/ui/camera-input.ts`
- Modify: `packages/app/src/settings.ts`, `packages/app/src/ui/settings-panel.ts` (the Controls section at 324-342), `packages/app/src/main.ts` (the wheel listener at 3030-3033; the pan block at 3672-3695), `packages/app/src/i18n/en.json`
- Test: `packages/app/src/ui/camera-input.test.ts`, `packages/app/src/settings.test.ts`, `packages/app/src/ui/settings-panel.test.ts` (extend both)

**Interfaces:**
- Produces:
  - `const EDGE_MARGIN_PX = 16`, `const ZOOM_MIN = 0.35`, `const ZOOM_MAX = 2.5`
  - `function clampZoom(z: number): number`
  - `function edgeVector(px: number, py: number, w: number, h: number, marginPx: number): { right: number; down: number }`
  - `function panDelta(right: number, down: number, speed: number): { dx: number; dy: number }`
  - `function zoomAnchor(cam: { x: number; y: number }, before: { x: number; y: number }, after: { x: number; y: number }): { x: number; y: number }`
  - `Settings.controls` gains `edgePan: boolean` (default `false`) and `zoomToCursor: boolean` (default `true`)

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/src/ui/camera-input.test.ts
import { describe, expect, it } from 'vitest';
import { EDGE_MARGIN_PX, ZOOM_MAX, ZOOM_MIN, clampZoom, edgeVector, panDelta, zoomAnchor } from './camera-input';

describe('edgeVector', () => {
  const v = (x: number, y: number) => edgeVector(x, y, 1000, 800, EDGE_MARGIN_PX);
  it('is zero in the middle', () => expect(v(500, 400)).toEqual({ right: 0, down: 0 }));
  it('is full strength at an edge and ramps across the margin', () => {
    expect(v(0, 400)).toEqual({ right: -1, down: 0 });
    expect(v(1000, 400)).toEqual({ right: 1, down: 0 });
    expect(v(500, 0)).toEqual({ right: 0, down: -1 });
    expect(v(992, 400).right).toBeCloseTo(0.5);
  });
  it('a corner pushes both ways', () => expect(v(0, 0)).toEqual({ right: -1, down: -1 }));
  // A pointer that has left the window must not pan forever.
  it('is zero outside the surface entirely', () => {
    expect(v(-40, 400)).toEqual({ right: 0, down: 0 });
    expect(v(500, 900)).toEqual({ right: 0, down: 0 });
  });
});

describe('panDelta', () => {
  // The WASD pan (main.ts:3679-3694) IS the reference. Screen-up is (-s,-s),
  // screen-right is (+s,-s) -- if this function disagrees, edge pan and the
  // keys move the camera differently and the player feels it immediately.
  it('reproduces each WASD direction exactly', () => {
    expect(panDelta(0, -1, 2)).toEqual({ dx: -2, dy: -2 });  // up
    expect(panDelta(0, 1, 2)).toEqual({ dx: 2, dy: 2 });     // down
    expect(panDelta(-1, 0, 2)).toEqual({ dx: -2, dy: 2 });   // left
    expect(panDelta(1, 0, 2)).toEqual({ dx: 2, dy: -2 });    // right
  });
  it('a corner is the sum of its two edges', () => {
    expect(panDelta(1, 1, 2)).toEqual({ dx: 4, dy: 0 });
  });
});

describe('zoomAnchor', () => {
  it('shifts the camera so the world point under the cursor does not move', () => {
    expect(zoomAnchor({ x: 10, y: 10 }, { x: 14, y: 6 }, { x: 12, y: 8 })).toEqual({ x: 12, y: 8 });
  });
  it('is a no-op when the point did not move', () => {
    expect(zoomAnchor({ x: 10, y: 10 }, { x: 14, y: 6 }, { x: 14, y: 6 })).toEqual({ x: 10, y: 10 });
  });
});

describe('clampZoom', () => {
  it('holds the range main.ts has always clamped to', () => {
    expect(clampZoom(99)).toBe(ZOOM_MAX);
    expect(clampZoom(0)).toBe(ZOOM_MIN);
    expect(clampZoom(1)).toBe(1);
  });
});
```

```ts
// packages/app/src/settings.test.ts — append
it('controls carries edgePan and zoomToCursor, with tolerant parsing', () => {
  expect(DEFAULT_SETTINGS.controls.edgePan).toBe(false);
  expect(DEFAULT_SETTINGS.controls.zoomToCursor).toBe(true);
  const s = parseSettings(JSON.stringify({ version: 1, controls: { edgePan: 'yes', zoomToCursor: false } }));
  expect(s.controls.edgePan).toBe(false);      // a bad value falls back, field by field
  expect(s.controls.zoomToCursor).toBe(false);
  expect(s.controls.cameraSpeed).toBe(1);      // and its neighbour survives
});
```

```ts
// packages/app/src/ui/settings-panel.test.ts — append.
// `deps()` (settings-panel.test.ts:7) passes `keymap: null` by default and the
// Controls section only renders when it is truthy (settings-panel.ts:324) --
// so this test supplies a real one through the same `keymapRows` factory
// `pause.test.ts` already imports. That also means the file's existing
// "four sections" assertion is untouched: with `keymap: null` there is still
// no Controls section at all.
it('the Controls section offers both new toggles and writes them through set()', () => {
  const { d, set } = deps({ keymap: keymapRows({ bindings: () => bindingsFrom({}), set: () => {} }) });
  const { el } = settingsPanel(document.body, d);
  const edge = el.querySelector<HTMLInputElement>('input[name="edgePan"]');
  if (!edge) throw new Error('no edgePan control');
  expect(edge.type).toBe('checkbox');
  edge.checked = true;
  edge.dispatchEvent(new Event('change', { bubbles: true }));
  expect(set.mock.calls.at(-1)?.[0].controls.edgePan).toBe(true);
  expect(el.querySelector('input[name="zoomToCursor"]')).not.toBeNull();
});
```

No non-null assertion: `if (!edge) throw` is the narrowing this file already uses (`settings-panel.test.ts:40`), and the Global Constraints forbid the `!` form in new code.

- [ ] **Step 2: Implement**

`camera-input.ts` as above. `edgeVector` ramps linearly across `marginPx` and returns 0 for a pointer outside the surface — that last clause is the one that matters, because a `pointerleave` that never fires (a browser losing focus mid-drag) would otherwise pan the camera off the map forever.

`settings.ts`: two `bool(...)` fields beside `cameraSpeed` in `parseSettings`'s `controls` block and in `DEFAULT_SETTINGS`. Defaults chosen and stated: **edge pan off** (it fights a player reaching for the minimap or the dock, and an RTS that starts scrolling when the mouse nears the HUD reads as broken), **zoom to cursor on** (it is what every map application does, and the alternative is what ships today).

`settings-panel.ts`: two checkbox rows in the Controls section, each with a one-line hint, both inside the existing `if (deps.keymap)` block that already gates that section.

`main.ts`: the wheel listener reads the world point under the cursor, applies `clampZoom`, reads it again, and writes `zoomAnchor(...)` — but only when `settings.get().controls.zoomToCursor`; otherwise it is today's two lines exactly. The rAF loop adds, after the four `held(...)` blocks and reading the same `panSpeed`:

```ts
    if (req.settings.get().controls.edgePan && pointerInside) {
      const e = edgeVector(lastCursor.x, lastCursor.y, canvas.clientWidth, canvas.clientHeight, EDGE_MARGIN_PX);
      const d = panDelta(e.right, e.down, panSpeed);
      renderer.camera.x += d.dx;
      renderer.camera.y += d.dy;
    }
```

`pointerInside` is set by `pointerenter`/`pointerleave` on the canvas, and cleared on `blur` — a window that loses focus must stop panning even if the pointer is technically over it.

- [ ] **Step 3: Gates, capture, falsify, commit**

Falsify: change `panDelta`'s `dy` sign — the WASD-reproduction test goes red on all four directions, which is the cheapest possible proof that this function and the key handler agree. Falsify the settings parse: make `bool` accept a string — the tolerant-parse test goes red.

Drive: edge pan ON, push the pointer to each edge and each corner; zoom to cursor ON, put the pointer on a distinctive building and wheel both ways — the building stays under the pointer.

```bash
git add packages/app/src/ui/camera-input.ts packages/app/src/ui/camera-input.test.ts packages/app/src/settings.ts packages/app/src/settings.test.ts packages/app/src/ui/settings-panel.ts packages/app/src/ui/settings-panel.test.ts packages/app/src/main.ts packages/app/src/i18n/en.json
git commit -s -- <the same paths>
```

---

### Task 13: The tutorial learns to watch the cursor

§6's last bullet, minus the economy step (R-1). The tutorial's vocabulary has four input kinds and six predicate kinds and none of them can see a hover — so the one thing the projected-fire panel needs the player to do cannot be taught.

**Files:**
- Modify: `packages/app/src/tutorial/runtime.ts` (`PredicateJson` 18-31, `TutorialInput` 45-49, `matches` 76-127), `data/schemas/tutorial.schema.json` (both `kind` enums, lines 46 and 76), `data/tutorial/beit_sahwan_0.json`, `packages/app/src/main.ts` (`updateHover`, 3510-3610), `CLAUDE.md`
- Test: `packages/app/src/tutorial/runtime.test.ts`, `packages/app/src/tutorial/steps.test.ts` (extend both)

**Interfaces:**
- Produces:
  - `TutorialInput` gains `{ kind: 'hover'; entity: number; structure: number; sideOf: (entity: number) => number }`
  - `PredicateJson.kind` gains `'hover'`; `PredicateJson` gains `target?: 'enemy' | 'structure' | 'any'`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/src/tutorial/runtime.test.ts — append
const hover = (entity: number, structure = -1): TutorialInput =>
  ({ kind: 'hover', entity, structure, sideOf: (e) => (e >= 100 ? 1 : 0) });

describe('the hover predicate', () => {
  it('matches a hover over an enemy and not over one of your own', () => {
    const p = { kind: 'hover', target: 'enemy' } as PredicateJson;
    expect(matches(p, hover(101), 0, 0)).toBe(true);
    expect(matches(p, hover(1), 0, 0)).toBe(false);
    expect(matches(p, hover(-1), 0, 0)).toBe(false);
  });
  it('matches a hover over a building when asked for one', () => {
    const p = { kind: 'hover', target: 'structure' } as PredicateJson;
    expect(matches(p, hover(-1, 4), 0, 0)).toBe(true);
    expect(matches(p, hover(-1, -1), 0, 0)).toBe(false);
  });
  it('`any` takes either, and the default is `any`', () => {
    expect(matches({ kind: 'hover', target: 'any' } as PredicateJson, hover(1), 0, 0)).toBe(true);
    expect(matches({ kind: 'hover' } as PredicateJson, hover(-1, 4), 0, 0)).toBe(true);
    expect(matches({ kind: 'hover' } as PredicateJson, hover(-1, -1), 0, 0)).toBe(false);
  });
  it('no other input kind satisfies it', () => {
    expect(matches({ kind: 'hover' } as PredicateJson, { kind: 'tick' }, 0, 0)).toBe(false);
  });
  it('a hover input satisfies no other predicate kind', () => {
    expect(matches({ kind: 'intent', intent: 'select' } as PredicateJson, hover(101), 0, 0)).toBe(false);
    expect(matches({ kind: 'sim', event: 'fire' } as PredicateJson, hover(101), 0, 0)).toBe(false);
  });
});
```

```ts
// packages/app/src/tutorial/steps.test.ts — append (this file validates the shipped JSON)
it('the tutorial teaches the hover, and every step id is still unique', () => {
  const ids = STEPS.map((s) => s.id);
  expect(ids).toContain('read_before_you_fire');
  expect(new Set(ids).size).toBe(ids.length);
  expect(STEPS).toHaveLength(14);
});
```

- [ ] **Step 2: Implement**

`runtime.ts`: the input kind, the predicate kind, the `target` field, and one `case 'hover'` in `matches`:

```ts
    case 'hover': {
      if (input.kind !== 'hover') return false;
      const want = pred.target ?? 'any';
      const onEnemy = input.entity >= 0 && input.sideOf(input.entity) === 1;
      const onStructure = input.structure >= 0;
      if (want === 'enemy') return onEnemy;
      if (want === 'structure') return onStructure;
      return onEnemy || onStructure;
    }
```

`tutorial.schema.json`: `'hover'` in BOTH `kind` enums (`predicate` at line 46 and `nestedPredicate` at line 76 — a hover step is a perfectly good `any_of` child, so it belongs in both), and a `target` property with its own `enum` and a description in both blocks, matching the file's existing convention of naming the owning kind first ("hover only: …").

`data/tutorial/beit_sahwan_0.json`: one step, inserted between `eyes_before_guns` and `what_a_shot_costs` — because it teaches reading the enemy and the step after it teaches what firing costs:

```json
    {
      "id": "read_before_you_fire",
      "title": "Read before you fire",
      "teach": "Hold the cursor over a hostile with your squad selected. The panel beside it is the chance each of your units has to hit, and why -- range, cover, movement.",
      "await": {
        "kind": "any_of",
        "of": [
          { "kind": "hover", "target": "enemy" },
          { "kind": "elapsed_s", "seconds": 40 }
        ]
      },
      "focus": { "kind": "none" },
      "nudge_after_s": 18,
      "nudge": "Put the cursor on an enemy and read the panel."
    }
```

The `elapsed_s` escape is not padding: a player with no enemy in sight must not be stuck, and every teaching step in this file that depends on the world already carries one.

`main.ts`: at the end of `updateHover`, once `renderer.hoverEntity` and `renderer.hoverStructure` are written, dispatch — **but only when the hover CHANGED**, because `updateHover` runs every frame and an unchanged hover is not a new thing the player did:

```ts
  if (tut && (he !== lastHoverEntity || hs !== lastHoverStructure)) {
    lastHoverEntity = he;
    lastHoverStructure = hs;
    tut = advance(tut, { kind: 'hover', entity: he, structure: hs, sideOf: (e) => sim.state.side[e] }, performance.now());
  }
```

`CLAUDE.md`, "Adding content → A mission": the tutorial's length is **14** teaching steps, not 13. One clause of one sentence; edit that section only, never the file wholesale (spec §10).

- [ ] **Step 3: Gates, capture, falsify, commit**

`pnpm validate:data` is the gate that reads the tutorial JSON against its schema — falsify by spelling the new kind `hovering` in the JSON and watch it refuse; restore. Falsify the runtime: make `target: 'enemy'` accept side 0 — the first test goes red.

Drive it: `/mission/beit_sahwan_0_tutorial`, reach the step, hover an enemy, watch it advance.

```bash
git add packages/app/src/tutorial/runtime.ts packages/app/src/tutorial/runtime.test.ts packages/app/src/tutorial/steps.test.ts data/schemas/tutorial.schema.json data/tutorial/beit_sahwan_0.json packages/app/src/main.ts CLAUDE.md
git commit -s -- <the same paths>
```

---

### Task 14: The capture pass photographs every new surface

§7: `pnpm ui:shots` is the review instrument for every phase — evidence, not a gate. Today it takes seventeen states (`shoot.ts:184-358`); Phase 2 adds six, and one of them is the acceptance evidence for the alert clause.

**Files:**
- Modify: `tools/src/ui-review/shoot.ts`

- [ ] **Step 1: Add the states, in the existing walk's order**

After `06-hud-idle` and before the existing `15-pause`:

- **`18-hud-alert`** — `__lions.sim.debugKill(__lions.units(0)[0].id)` then `__lions.step(1)`, settle 400 ms, shoot. The feed line and the minimap mark are both in frame; the cue is not photographable and is recorded in the report instead. This is acceptance (a)'s standing capture.
- **`19-objectives`** — click `.rl-strip__more`, settle, shoot. Run this state against `MISSION` as configured; note in the console line how many objectives that mission declares, so a reader can tell a short list from a broken panel.
- **`20-keys`** — `page.keyboard.press('F1')`, settle, shoot, press Escape.
- **`21-tooltip`** — hover the Conduct span (`.rl-strip [data-roe]`) with `page.hover`, settle 300 ms, shoot.
- **`22-groups`** — select six units (`__lions.sel(...)`, the existing `08` helper), `page.keyboard.press('Control+1')`, settle, shoot: the group bar with one chip.
- **`23-minimap-ping`** — alt+click the minimap at its centre (`page.mouse.click` with `{ modifiers: ['Alt'] }` over `.rl-minimap`), settle 300 ms, shoot while the ping is still up (`PING_MS` is 2500, so 300 ms is comfortably inside it).

Each follows the file's existing shape exactly: `await settle(page, ms); await shot(page, dir, '<name>');`. The overflow probe runs on each automatically.

- [ ] **Step 2: Run it both ways and read the sheets**

`pnpm ui:shots` and `pnpm ui:shots -- --pseudo`, at all three resolutions. Put the 1920 and 2560 sheets in the task report and check by eye: the tracker's five rows and their rewards, the F1 table's keycaps, the tooltip over Conduct, the widened chips (Task 7) still fitting six across at 1280, the group chip's colour matching the badge over the unit. **Under `--pseudo`, a plain unbracketed word is a string that never went through `t()`** — name any in the report; the overflow probe's total goes in too, even at zero.

- [ ] **Step 3: Commit**

```bash
git add tools/src/ui-review/shoot.ts
git commit -s -- tools/src/ui-review/shoot.ts
```

Message: `test(ui): the capture pass photographs the alert, the tracker, F1, a tooltip, the group bar and a ping`, body carrying the pseudo-pass findings and the overflow total.

---

## The last two tasks — the renderer, after WP-A1.2

Both of these touch `packages/render/src/three/ThreeRenderer.ts`, which the art session holds until the blast package **WP-A1.2** lands (spec §10: "Phase 2's range rings (band 4) and Phase 3's scene host are the two items that touch `ThreeRenderer.ts`, and they wait for the art landing or arrive through a merge from `main`, never both in flight on that file"). **Before starting either one:**

```bash
/usr/bin/git fetch origin
/usr/bin/git log --oneline origin/main -20        # confirm WP-A1.2 has landed
/usr/bin/git merge origin/main                    # merge, do not rebase; resolve on this branch
pnpm install && pnpm test                         # the merged tree is green before a line is written
```

If WP-A1.2 has not landed, **stop and report** rather than writing into that file; Tasks 1–14 are a complete, landable branch on their own and the two renderer tasks can follow in a second landing.

---

### Task 15: The minimap's ground is the map's own lit albedo

R-6: this cannot be done inside `packages/app`. `Minimap.paintTerrain` (`minimap.ts:401-423`) invents a 1px-per-tile picture from `blocked`/`boulder`/`cover` and `TerrainTones`; the ground the player is actually looking at is a lit, textured, Catmull-Rom surface under `three/terrain/`. §6 asks for "a one-off render of the ground mesh to a texture at map load".

**Files:**
- Modify: `packages/render/src/api.ts`, `packages/render/src/three/ThreeRenderer.ts`, `packages/app/src/ui/minimap.ts`, `packages/app/src/main.ts`
- Test: `packages/app/src/ui/minimap.test.ts`, `packages/render/src/api.test.ts` (extend both)

**Interfaces:**
- Produces:
  - `Renderer` gains `captureGroundAlbedo?(sizePx: number): ImageData | null` — optional, so Pixi (frozen) implements nothing and the app's fallback is the shipped behaviour
  - `MinimapDeps` gains `groundImage?: () => ImageData | null`
  - `function flipRows(data: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray` (pure, in `minimap.ts`)

- [ ] **Step 1: The seam, and why the readback is legal**

`api.ts`:

```ts
  /**
   * A top-down photograph of THIS map's ground, rendered once, for the
   * minimap. `sizePx` is the square the caller wants; the backend fits the
   * map's own tile extent into it, matching `minimapProjection`'s letterbox.
   *
   * `ImageData` rather than a texture or a canvas: it is the one shape that
   * crosses this seam without either side learning about the other's
   * rendering stack, and it is exactly what a 2D `putImageData` takes.
   *
   * Returns null before the terrain exists, and on a backend that has no
   * ground mesh to photograph. Optional on the interface: `renderer.ts` is
   * frozen and implements nothing, so `?renderer=pixi` keeps the painted
   * terrain, which is not a degradation -- it is what shipped.
   *
   * NOTE for anyone reading the `preserveDrawingBuffer` rule (CLAUDE.md, "the
   * three.js backend"): that rule is about the DRAWING BUFFER and stays off.
   * This reads a `WebGLRenderTarget` with `readRenderTargetPixels`, which is a
   * different buffer, is always readable, and is unaffected by it.
   */
  captureGroundAlbedo?(sizePx: number): ImageData | null;
```

Extend `api.test.ts`'s existing conformance check to assert the member is optional (i.e. a `Renderer` with no such method still typechecks) — that file already pins the seam's shape.

- [ ] **Step 2: Implement it in `ThreeRenderer`**

One private method, called once, from the same place `terrainDirty` is cleared, and memoised per map:

- An `OrthographicCamera` looking straight down (`position.set(cx, high, cz)`, `up` along `-Z`, `lookAt(cx, 0, cz)`), its frustum exactly the map's tile extent, so the result lands on `minimapProjection`'s own linear tile→pixel mapping with no second convention.
- A `WebGLRenderTarget(sizePx, sizePx)`.
- Render **only** the terrain: hide the unit, decor, FX, overlay and silhouette groups for this one call and restore them after, through the existing `debug-layers.ts` seam where it already names a group (`ground-albedo`, `scatter`, `decor`, `buildings`) rather than a second list of scene objects — reuse it, do not duplicate it.
- `readRenderTargetPixels` into a `Uint8ClampedArray`, dispose the target, restore the visibility and the main camera, and return `new ImageData(pixels, sizePx, sizePx)`.
- The rows come back bottom-up (WebGL's origin), so the app flips them — deliberately on the app side, in a pure function with a test, rather than in an untestable GL method.

Guard it: if `this.terrainGroup` is absent or `sizePx <= 0`, return null. A throw here would take the whole HUD down for a picture.

- [ ] **Step 3: The minimap prefers it, and falls back**

```ts
// packages/app/src/ui/minimap.test.ts — append
describe('the lit ground', () => {
  it('blits the renderer image when there is one', () => {
    // The recorder (minimap.test.ts:76-120) records every `drawImage`; the
    // question is which SOURCE was blitted, so the fake context gains a
    // `source` field on its DrawImage op in this task.
    const img = new ImageData(new Uint8ClampedArray(48 * 48 * 4).fill(200), 48, 48);
    const { minimap } = mount(() => true, { groundImage: () => img });
    minimap.onTick();
    expect(recorder.images().at(-1)?.source).toBe('ground-albedo');
  });
  it('falls back to the painted terrain when there is none -- which is what Pixi gets', () => {
    const { minimap } = mount(() => true, { groundImage: () => null });
    minimap.onTick();
    expect(recorder.images().at(-1)?.source).toBe('painted');
  });
  it('asks once, not every redraw', () => {
    let calls = 0;
    const { minimap } = mount(() => true, { groundImage: () => { calls++; return null; } });
    for (let i = 0; i < 40; i++) minimap.onTick();
    expect(calls).toBe(1);
  });
});

describe('flipRows', () => {
  it('reverses row order and leaves each row intact', () => {
    const src = new Uint8ClampedArray([1, 1, 1, 1, 2, 2, 2, 2]);   // 1x2 RGBA
    expect([...flipRows(src, 1, 2)]).toEqual([2, 2, 2, 2, 1, 1, 1, 1]);
  });
  it('is an involution', () => {
    const src = new Uint8ClampedArray(Array.from({ length: 48 }, (_, i) => i));
    expect([...flipRows(flipRows(src, 3, 4), 3, 4)]).toEqual([...src]);
  });
});
```

`Minimap`'s constructor calls `deps.groundImage?.() ?? null` **once** and, when it gets one, `putImageData` it onto an offscreen canvas of that size and uses that canvas as `this.terrain`; `paintTerrain()` runs only when it gets null. Everything downstream — the `drawImage` blit, the `saturate(0.4)` filter, `imageSmoothingEnabled = false` — is untouched, so the desaturation and the letterbox keep working. The one thing to reconsider by eye and record: `imageSmoothingEnabled = false` was right for a 48px source blown up 4.375x and is wrong for a 210px photograph; turn it on for the photographed path only, and say so in the comment.

`main.ts` passes `groundImage: () => renderer.captureGroundAlbedo?.(MINIMAP_SIZE) ?? null`, wrapped in the flip.

- [ ] **Step 4: Gates, capture, falsify, commit**

Falsify: return an unflipped buffer — the involution test is not enough on its own, so ALSO photograph it: a map with an obvious asymmetry (`tel_marum`'s ridge across the north) is upside down by eye. Record both. Falsify the "asks once" behaviour by moving the call into `draw()` — that test goes red.

**Check the visual gate explicitly here**, even though the minimap is hidden in every capture (`hideHudExceptCanvas`): this task renders into a render target and restores scene visibility, and a restore that misses a group would show up as a missing layer in `quiet`/`open-ground`/`relief`/`vehicle`. Run `pnpm golden-baseline` locally and put the deltas in the report; they must be inside the noise.

```bash
git add packages/render/src/api.ts packages/render/src/api.test.ts packages/render/src/three/ThreeRenderer.ts packages/app/src/ui/minimap.ts packages/app/src/ui/minimap.test.ts packages/app/src/main.ts
git commit -s -- <the same paths>
```

---

### Task 16: The range rings — one readable shape instead of three hoops

The last task. §6: "range rings redrawn as a desaturated low-alpha fill of the team hue with a designed arc (renderer overlay work, band 4)". Acceptance (c): "the capture pass at zoom 2.5 shows no saturated ring fill."

Today `ThreeRenderer.ts:6113-6131` draws three strokes per selected unit — max range at alpha 0.28, effective at 0.5, minimum in **hostile red** at 0.35 — all through `ellipseRing`. With six units selected they overlap into eighteen hoops.

**Files:**
- Modify: `packages/render/src/three/units/overlay-geometry.ts` (+its test), `packages/render/src/three/units/overlays.ts` (the primitives at 456-551, and the stale header at 15-17), `packages/render/src/three/ThreeRenderer.ts` (6106-6131), `packages/render/src/api.ts`, `packages/app/src/main.ts`
- Test: `packages/render/src/three/units/overlay-geometry.test.ts` (extend)

**Interfaces:**
- Produces:
  - `function pushEllipseAnnulusFillPx(soup, anchor, rIn, uIn, rOut, uOut, color, alpha, segments?): void`
  - `function desaturateHex(hex: string, amount: number): string` (pure; `amount` 0 = unchanged, 1 = grey)
  - `function hexSaturation(hex: string): number` (pure, HSL saturation 0..1 — the acceptance clause's own instrument)
  - `const RANGE_FILL_DESATURATE = 0.6`, `const RANGE_FILL_ALPHA = 0.14`, `const RANGE_ARC_ALPHA = 0.55`
  - `OverlayBatch.ellipseAnnulusFill(...)`
  - `Renderer` gains `rangeRingPreview?: number` (entity id, or -1)

- [ ] **Step 1: The shape, from R-12**

Read R-12 above before writing anything. The shape it fixes, restated so this task is self-contained: a filled ANNULUS from minimum range to effective range in the desaturated team hue at `RANGE_FILL_ALPHA`, its outer edge drawn as a brighter arc at `RANGE_ARC_ALPHA` — "reach fades out at this line" — with the maximum-range hoop kept as today's faint stroke and the hostile-red inner ring deleted (its job is now the hole in the annulus, which cannot be mistaken for an enemy's ring). **It is not a facing sector**, and R-12 has the reason.

- [ ] **Step 2: Write the failing geometry tests**

```ts
// packages/render/src/three/units/overlay-geometry.test.ts — append
import { desaturateHex, hexSaturation, pushEllipseAnnulusFillPx, pushEllipseRingPx } from './overlay-geometry';

describe('pushEllipseAnnulusFillPx', () => {
  it('writes two triangles per segment, like the ring it generalises', () => {
    const soup = createTriangleSoup(256);         // overlay-geometry.test.ts:53
    pushEllipseAnnulusFillPx(soup, ANCHOR, 4, 2, 10, 5, RED, 1, 8);
    expect(soup.count).toBe(8 * 2 * 3);
  });
  it('a zero inner radius is a disc, and no vertex lands outside the outer radius', () => {
    const soup = createTriangleSoup(256);
    pushEllipseAnnulusFillPx(soup, ANCHOR, 0, 0, 10, 5, RED, 1, 16);
    // No vertex further from the anchor than the outer radius, in the anchor's
    // own local frame -- `billboardPoint(ANCHOR, 0, 0)` is the centre.
    expect(maxOffsetFromAnchor(soup, ANCHOR)).toBeLessThanOrEqual(10.001);
  });
  // The simplification that makes this safe to land: one piece of geometry,
  // two callers. If the ring drifts from the annulus, every existing ring test
  // in this file goes red rather than the rings quietly changing shape.
  it('pushEllipseRingPx is this function with a stroke width, vertex for vertex', () => {
    const a = createTriangleSoup(256);
    const b = createTriangleSoup(256);
    pushEllipseRingPx(a, ANCHOR, 10, 5, 2, RED, 1, 16);
    pushEllipseAnnulusFillPx(b, ANCHOR, 9, 4, 11, 6, RED, 1, 16);
    expect([...a.position.slice(0, a.count * 3)]).toEqual([...b.position.slice(0, b.count * 3)]);
  });
});

describe('desaturateHex', () => {
  it('0 changes nothing and 1 is grey', () => {
    expect(desaturateHex('#2F6FD9', 0)).toBe('#2f6fd9');
    expect(hexSaturation(desaturateHex('#2F6FD9', 1))).toBeCloseTo(0, 5);
  });
  it('holds luminance while it drains colour', () => {
    const luma = (hex: string): number => {
      const n = parseInt(hex.slice(1), 16);
      return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
    };
    expect(luma(desaturateHex('#D93A2B', 0.6))).toBeCloseTo(luma('#D93A2B'), 1);
  });
  // Acceptance (c), as a number rather than as a look at a picture.
  it('every shipped team colour, of every variant, is unsaturated at the shipped amount', () => {
    for (const hex of teamHexesFromPalette()) {   // below: read off data/palette.json
      expect(hexSaturation(desaturateHex(hex, RANGE_FILL_DESATURATE))).toBeLessThan(0.35);
    }
  });
});
```

`teamHexesFromPalette()` is a local helper in that test file reading `data/palette.json` from disk with `readFileSync` (the shape `textured-building.test.ts` already uses to parse a Python set, and `credits-data.test.ts` to read `package.json`) and returning `reserved.team.colors`'s three hexes plus each of the three `reserved.team.variants.*` blocks' three — twelve in all. Read, never pasted (`reserved.team.colors` plus the three `reserved.team.variants.*` blocks) rather than pasted — so a new variant is covered the day it is added, and a variant with a colour this ruling cannot desaturate fails here rather than on screen.

- [ ] **Step 3: Implement the geometry, then the draw**

`overlay-geometry.ts`: `pushEllipseAnnulusFillPx` exactly as `pushEllipseRingPx` is written today (`overlay-geometry.ts:304-330`) but taking four radii, and `pushEllipseRingPx` reduced to a call into it with `r ∓ strokeWidthPx / 2`. `desaturateHex`/`hexSaturation` are plain sRGB-byte maths with no `THREE` import, which is what keeps this file node-testable — the module's own top comment says it is the pure half. The `pushEllipseFanPx` doc comment (`overlay-geometry.ts:259-275`) already anticipates "a future PARTIAL arc … knows which convention it is extending": the annulus is a full sweep and inherits the same y-down winding, so add one sentence there recording that this is the function that arrived and that it did not need the partial case after all.

`overlays.ts`: `ellipseAnnulusFill` beside `ellipseRing`, one line, `cachedHexToLinear` like every neighbour. **And fix the stale header** (`overlays.ts:15-17): it still says the weapon-envelope rings "are NOT ported — out of this phase's named scope", which stopped being true when Phase C's successor drew them and is actively misleading to anyone reading this file to find where rings live.

`ThreeRenderer.ts`, replacing 6113-6131:

```ts
      const w0 = type.weapons[0];
      const teamHex = this.opts.teamColors[st.side[i]];
      const fillHex = desaturateHex(teamHex, RANGE_FILL_DESATURATE);
      const eff = fx.toNumber(w0.effectiveRange);
      const min = Math.sqrt(fx.toNumber(w0.minRangeSq));
      const outer = tileRadiusToEllipsePx(eff, TILE_W, TILE_H);
      const inner = tileRadiusToEllipsePx(min, TILE_W, TILE_H);
      const a = previewing ? RANGE_FILL_ALPHA * 0.6 : RANGE_FILL_ALPHA;
      this.overlayBatch.ellipseAnnulusFill(envelopeAnchor, inner.rightR, inner.upR, outer.rightR, outer.upR, fillHex, a);
      this.overlayBatch.ellipseRing(envelopeAnchor, outer.rightR, outer.upR, 1.5, fillHex, previewing ? RANGE_ARC_ALPHA * 0.6 : RANGE_ARC_ALPHA);
      ring(fx.toNumber(w0.range), fillHex, 1, 0.22);   // maximum reach, still a faint hoop
```

`min` is 0 for most weapons, and `pushEllipseAnnulusFillPx` with a zero inner radius is a disc — so the mortar case needs no branch.

**The hover preview** follows the garrison-hover pattern exactly (`ThreeRenderer.ts:6329-6358`): `api.ts` gains `rangeRingPreview?: number`, `main.ts`'s `updateHover` writes `renderer.hoverEntity` when it is one of the player's own living units **and not already selected** (a selected unit already draws its rings at full strength), and the ring loop runs over `this.selection` and then, if `rangeRingPreview >= 0` and not in the selection, once more for that entity with `previewing = true`. Optional on the seam, so Pixi ignores it.

- [ ] **Step 4: Gates, capture, falsify, commit**

Falsify the geometry: change `pushEllipseRingPx` to keep its own loop and shift one radius — the vertex-for-vertex test goes red. Falsify the colour: set `RANGE_FILL_DESATURATE` to 0 — the "every shipped team colour" test goes red naming the hex.

**Acceptance (c), measured and photographed.** The numeric half is the saturation test above. The pictorial half is `pnpm ui:shots`'s `09-hud-zoom2.5` (six units selected, zoom 2.5 — the state that exists for exactly this) at all three resolutions, before and after, in the task report.

**The visual gate:** no gated scenario selects a unit, so `quiet`, `open-ground`, `relief` and `vehicle` should not move. Run `pnpm golden-baseline` locally and put the four deltas in the report. If one moves, that is a defect in this task — the rings are drawn per selected entity and there are none — not a bless.

```bash
git add packages/render/src/three/units/overlay-geometry.ts packages/render/src/three/units/overlay-geometry.test.ts packages/render/src/three/units/overlays.ts packages/render/src/three/ThreeRenderer.ts packages/render/src/api.ts packages/app/src/main.ts
git commit -s -- <the same paths>
```

Message: `feat(render): range rings as one readable area instead of three hoops`, body carrying the measured saturation of the shipped fill, the four golden deltas, and the mutation seen red.

---

## Self-review

**Spec coverage (§6 Phase 2), bullet by bullet.**

| §6 bullet | Task |
|---|---|
| Alerts — from existing sim events, "any missing event is a sim change raised separately" | **1** (the missing event, raised separately, reviewed as a sim change) |
| Alerts — a squad wipe coalesces to one line | **2** (`alertsForTick`, per tick per unit type; R-11) |
| Alerts — a feed line, an SFX, a minimap flash, a jump-to-event key | **3** (the cue) + **4** (the other three) |
| Objectives — the full list on the briefing | **5** |
| Objectives — an in-mission tracker toggled from the strip's `+N` and from the pause menu | **6** (R-7: one component, three mounts) |
| Objectives — secondaries with rewards named | **5** (`rewardFor`, from `CREDIT_WEIGHTS` and `ledger.produces`; R-8) |
| Minimap — click to jump, drag to pan, right-click to order, a ping, a frame, a shape-coded hostile mark | **10** (R-10 for the ping) |
| Minimap — ground from the map's lit albedo | **15** (R-6: it cannot be done inside `packages/app`) |
| Control groups | **11** (R-2: a surface over the existing mechanism) |
| Idle finder | **11** |
| Edge pan, zoom to cursor | **12**, with their settings rows (R-9, D-12 discharged) |
| Discoverability — the key on every order button | **already shipped** (R-3, `hud.ts:1137`); the tooltip is **7** |
| Discoverability — an F1 overlay from the same table settings rebinds | **8** |
| Discoverability — the hint line no longer hidden by a selection | **9** |
| Discoverability — a shared tooltip component and the first ten tooltips, Conduct first | **7** |
| Per-squad chips on `unitIcon`, consumed unchanged | **7** (the chip's art path is untouched; only `--chip-w` and the name slot change) |
| Range rings — desaturated low-alpha fill of the team hue with a designed arc, band 4 | **16** (R-5 for the colour, R-12 for the arc) |
| Projected fire and the dock made discoverable | **9** (first-use hints, marked on USE) + **7** (the order-row tooltips) |
| The tutorial gains a hover step | **13** |
| The tutorial gains a first economy step | **deferred to Stage 4** (R-1, with the file fact) |
| §7 — unit tests for every pure function, alert coalescing named | **2**, and also 5, 9, 10, 11, 12, 16 |
| §7 — `pnpm ui:shots` as the review instrument | **14** |

**Acceptance (§6 Phase 2), clause by clause, and what proves each.**

1. *A scripted mission in which a unit dies produces an alert line, a sound and a minimap flash within one frame of the event.* — Task 1's `unitLost` tests (the event fires on the tick of the death), Task 2's coalescing tests (the line and the sound are decided in the same call), Task 4's `flashAlpha`/flash tests and its **driven check** (`debugKill` + `step(1)`, all three observed in one frame), and Task 14's standing capture `18-hud-alert`. The sound is the one part no capture can hold; it is recorded in the task report as driven.
2. *All objectives of a five-objective mission are readable in-mission.* — Task 5's panel test uses a five-row fixture with all three statuses and both secondary kinds; Task 6's pause test and strip test open it two ways; the drive is `/mission/umm_zeitoun_4_clearance`, which declares exactly five; Task 14's `19-objectives` photographs it.
3. *The capture pass at zoom 2.5 shows no saturated ring fill.* — Task 16's `hexSaturation(desaturateHex(hex, RANGE_FILL_DESATURATE)) < 0.35` over **every** team colour of **every** variant read from `data/palette.json`, plus `pnpm ui:shots`'s `09-hud-zoom2.5` before and after in the task report. The number is the gate; the picture is the check that the number measures the right thing.

**Placeholder scan.** No `TBD`, no "add tests", no "similar to task N". Every test step carries real code, and every reused helper is named at its own file and line — `rig`/`mission` (`hud.test.ts:66, :93`), `mount`/`installContext`'s `recorder` (`minimap.test.ts:187, :76`), `deps()` (`pause.test.ts:10`, `settings-panel.test.ts:7`), `createTriangleSoup`/`ANCHOR`/`RED` (`overlay-geometry.test.ts:11, :27, :28`), `makeWorld`/`baseMission` (`mission.test.ts:104, :133`). Three tasks extend an existing harness rather than adding a second one, and each says exactly how: Task 10 and Task 15 add `arc`/`fill` and a `source` field to `minimap.test.ts`'s fake context; Task 16 adds `maxOffsetFromAnchor` and `teamHexesFromPalette` to `overlay-geometry.test.ts`. Every implementation step names the file and the line range it edits and the identifiers it adds.

**Type consistency.** `Alert`/`AlertLine`/`AlertWorld`/`AlertState` (Task 2) are consumed by name in Task 4 and nowhere else. `ObjectiveRow` (Task 5) is the shape `MissionRuntime.objectiveList` already returns, narrowed — so Task 6's `PauseDeps.objectives()` widening is a widening of the same rows, not a conversion. `Disposer` is `shell/router.ts`'s throughout (Tasks 7, 8, 11, 15). `StorageLike` is `brigade-account.ts`'s in Task 9, as in `settings.ts`. `Tone` is `hud-model.ts`'s in Tasks 2, 4 and 5 — never a colour. `Bindings`/`Action`/`ActionSpec` are `input/keymap.ts`'s in Tasks 4, 8 and 11, and all three new actions go through `ACTIONS` so `settings-keymap.ts` renders their rebind rows with no change at all. `MinimapPoint`/`MinimapProjection` are `minimap.ts`'s own in Tasks 4, 10 and 15. `PointerContext`/`Resolution` are `input/intents.ts`'s in Task 10 — the same objects the canvas uses. `TriangleSoup`/`OverlayColor` are `overlay-geometry.ts`'s in Task 16.

**Model tiering for the executor.** **Opus** for Task 1 (a sim change, even a small one, and the sim-guard review is part of it), Task 2 (the model the whole alert layer rests on, and the one §7 names), Task 4 (four sinks, `main.ts`'s tick loop, and a key), Task 10 (pointer semantics on a canvas plus the resolver seam), Task 15 and Task 16 (three.js, a render target, geometry, and the one acceptance clause that is a measurement). **Sonnet** for Tasks 3, 5, 6, 7, 8, 9, 11, 12, 13, 14 — each is a pure model plus a thin DOM layer, or a table edit, with the tests written out. **Haiku** for scoped re-reviews of a fix round. **Opus** for the final whole-branch review. Nothing here should inherit opus by default: the execution plan's own note is that workflows do that silently, and ten of these sixteen tasks do not need it.

**R-n → D-n at landing.** R-1 → D-28 (the tutorial's economy step deferred, with `beit_sahwan_0_tutorial`'s missing `resources` block as the measurement). R-2 → D-29 (the group bar is a surface, and `recallGroup` is the one path both callers run). R-3 → D-30 (the order-button keys already shipped in Phase 1; record it so the next reader does not "fix" it twice). R-4 → D-31 (under-fire is app-side; `nearMiss` excluded because it names no target). R-5 → D-32 (the ring fill is derived, not a palette row, with G0 #3 quoted). R-6 → D-33 (the lit minimap ground needs `ThreeRenderer`). R-7 → D-34 (one objective panel, three mounts; `pause.ts`'s `<ol>` deleted). R-8 → D-35 (rewards stated from `CREDIT_WEIGHTS`, gated on `ledger.produces`). R-9 → D-36 (D-12 discharged: the two settings ship with their features, `cameraSpeed` reused). R-10 → D-37 (the ping is local; no intent, no command, no network). R-11 → D-38 (wipes coalesce per tick per type; `removed`/`evacuated` unchanged). R-12 → D-39 (the designed arc is a boundary, not a facing sector, because the sim has no traverse rule).

**Execution order.** 1 → 2 → 3 → 4 (the alert chain, in dependency order: the event, the model, the cue, the layer). Then 5 → 6 (the reward model and panel before its two openers). Then 7 → 8 → 9 (the tooltip before the tooltips; the F1 overlay and the hint line are independent of each other and of 5/6). Then 10, 11, 12, 13 in any order — none depends on another. Then **14**, which photographs everything above it, which is why it is not earlier. Then, only after `origin/main` carries **WP-A1.2** and this branch has merged it, **15** and **16**. Tasks 1–14 are a complete, landable branch on their own: if WP-A1.2 slips, land them, bless nothing (they cannot move the gate), and take 15 and 16 as a second landing.

**One bless is budgeted and none is expected.** Nothing in Tasks 1–14 can move a gated capture (`hideHudExceptCanvas`). Task 15 restores scene visibility after a render target and Task 16 draws only for selected units, of which the gated scenarios have none — so both should read unmoved, and each names `pnpm golden-baseline` in its own gate step so the claim is measured rather than assumed. A red `visual` run on this branch is a regression to find, not a threshold to widen (D-27).
