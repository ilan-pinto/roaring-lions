# Retire Pixi and the sprite sheets (WP-A3.3, GH-189). Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One renderer. Delete the PixiJS backend, `?renderer=pixi`, the `&nomesh` billboard path, the
sprite wrecks, `SPRITE_MAP`, the 43 sheets under `assets/sprites/` (72 MB), the cropped sprite icons and
the cross-backend harnesses. The flat campaign board stays as the no-WebGL2 fallback.

**Decision:** the lead, at G2 on 4 Oct (#166): "Retire Pixi — yes (start with the 9 missing enemy
portraits, then the A3.3 retirement plan)." Evidence: `docs/superpowers/specs/2026-10-04-g2-decision-sheet.md` §1 (PR #368).

**Step 1 is done** on `feat/retire-pixi-prep`, in the PR that adds this plan. The nine enemy types that
fell back to a sprite crop (`charge_squad`, `digger_crew`, `gun_truck`, `militia_cell`, `mortar_crew`,
`moto_rpg`, `paramotor`, `rpg_team`, `technical`) now have Blender portraits. `spriteCropIcon` and the
runtime crop catalogue are deleted, and `unitIcon(typeId, slot)` no longer takes a sheet path. The
`&nomesh` path never needed the crop: an icon is DOM and keyed by unit id, so it is the same picture on
every render path. The crop PNGs, `crop_unit_icons.py` and `unit_icons.test.ts` still exist; nothing in
the app reads them. Task 8 deletes them.

**Base:** measured on `main` `690ee4cb` (4 Oct). Locate code by symbol; line numbers drift.

**Shape:** 11 tasks. Lane A's file boundary: `packages/render`, `packages/app`, `tools`, `assets`,
`.github/workflows`, `CLAUDE.md`, `docs/`. The sim is untouched. The determinism hash, `pnpm balance` and
`pnpm playtest` must read byte-identical after every task. Run them as a tripwire, not as evidence.

**Order is load-bearing.** The entry points close first (Tasks 2 and 5), then the code behind them goes
(Tasks 3, 6, 7), then the assets (Task 8). Each step leaves `main` shippable. Deleting a sheet while a
reachable path can still request it turns into a 404 that the SPA fallback answers with `index.html` at
HTTP 200. That is the GH-147 failure shape (a JSON error in a loader, naming a file nobody touched).

---

## Census at `690ee4cb` (what the plan stands on)

| question | answer | how measured |
|---|---|---|
| Unit types in `data/units/` | 35 | `id` walk over every JSON |
| Types with a GLB | 34. All but `civilians`, and `civilians` draws from 4 variant GLBs (`art/meshes/civilians/{civilian_child,civilian_woman,farm_worker,office_worker}.glb`, `mesh-catalogue.ts` GH-149, faction `civilian`) | `ls art/meshes`, `mesh-catalogue.ts` |
| Types with a Blender portrait | 34. All but `civilians`, which shows the role mark on the hatch. Pinned by `portrait.test.ts` "unit portrait coverage" | `assets/ui/portraits/units/manifest.json` |
| Vehicle GLBs carrying a `wreck` clip | **18 of 18** in `art/meshes/vehicles/` (the two drones, `gun_truck`, `technical`, `paramotor` and `rocket_battery` included) | parse each GLB's `animations` |
| Structure types in `STRUCTURE_SPRITES` with a building mesh | 6 of 6 (`shanty`, `house`, `warehouse`, `apartment`, `concrete`, `wall`), each with a `_wreck` GLB | `mesh-catalogue.ts` `spriteSheetPlan` header, `art/meshes/buildings/` |
| Files mentioning Pixi | 121 `.ts`/`.json` (G2 sheet). `packages/render/src/renderer.ts` is 2,635 lines | `rg -il pixi` |
| `three/units` files mentioning billboards, atlases or `&nomesh` | 36 under `three/` (about 18 of them carry real billboard code, not just a comment) | `grep -rli 'billboard\|nomesh\|atlas'` |

So **every unit already draws as a mesh on the default path**, civilians included. On the default path,
the sprite sheets serve only three things: a mesh vehicle's sprite wreck, which no shipped vehicle
reaches any more because all 18 carry `wreck`; a deferred KDF buildable's few placeholder frames before
its GLB lands; and the HUD's sheet-frame portrait fallback (`portraitFile`/`portraitUrl`), which no type
with a portrait reaches. Everything else in the sheets is `&nomesh` and Pixi.

**Stale comment to fix in passing (Task 5):** `spriteSheetPlan`'s header says `attack_drone` and
`recon_drone` have no mesh. Both are in `VEHICLE_UNIT_MESHES` (`vehicles/*.glb`) since B0a.

---

## Tasks

### Task 1: Before-numbers and the precondition spec (no deletion)

- [ ] Measure `pnpm perf:load -- --mission=<id> --serve=preview` on `main` for `beit_sahwan_1_recon`,
      `tel_marum_2_foothold` and `wadi_halam_2_laager`, cold, three runs each. Record requests, bytes,
      sprite-sheet requests, and time to the deploy button. Record `pnpm build`'s total `dist/` size and
      the size of the `@lions/render/pixi` chunk. These are the "before" numbers Task 10 compares
      against.
- [ ] Add `tools/src/mesh_roster.test.ts`, the precondition gate for Tasks 5 to 8. It reads off disk,
      not the code under test: every `data/units` id has a GLB under the mesh catalogue's paths (or,
      for `civilians`, its four variant GLBs). Every vehicle GLB carries `idle` and `wreck`. Every
      rigged team GLB carries `down` or `wreck`. Every `STRUCTURE_SPRITES` type has a building GLB and
      a `_wreck` GLB. The vacuity guard is >30 unit ids.
- [ ] Falsify it: move `art/meshes/vehicles/technical.glb` aside, then strip `wreck` from one GLB's
      animations in a scratch copy, then drop `civilian_child.glb`. Each must go red, naming the file.
      Record all three in the commit message.

**Gates:** `pnpm test`, typecheck, lint.

### Task 2: Remove `?renderer=pixi` and the renderer-choice persistence

- [ ] Delete `packages/app/src/renderer-choice.ts` and its test. Remove its readers: `main.ts` (around
      line 198, and the backend choice near 1790), `ui/menu.ts`, `ui/scene-host.ts`,
      `ui/scene-host-model.ts`, `ui/garage-viewer.ts` (`PlateReason` loses `'pixi'`), `ui/worldmap3d.ts`,
      `ui/minimap.ts`, and the key list comment in `ledger-store.ts`.
- [ ] A returning player may still hold `localStorage['lions.renderer'] = 'pixi'`. Remove that key once
      at boot, inside `try/catch` (jsdom's bare `{}` storage, and blocked site data). Never read it.
- [ ] `?renderer=` and `&renderer=pixi` become accepted-and-ignored, the way `&mesh` is, so bookmarks
      and old doc links do not trip the unknown-parameter warning. Pin that in `sandbox-help.test.ts`.
- [ ] **The flat campaign board stays.** After this task it is reached only by no WebGL2, a GLB that
      will not load, or a scene graph that fails the campaign contract. Re-point `worldmap.test.ts` and
      `worldmap3d.test.ts` at those three causes. Do not delete them. `screens-check.ts` still asserts
      `data-board=live`.
- [ ] The scene host keeps its plate for **reduced motion** and for failures. The `pixi` plate reason
      goes. D-54's rule stands: reduced motion gates parallax off on its own, whatever the path.
- [ ] Telemetry: `session_start.renderer` is typed `'three' | 'pixi'`. Keep the field and always send
      `'three'`, so `packages/worker/QUERIES.sql` and old D1 rows stay comparable. Narrow the type.
- [ ] The Pixi backend still compiles and is now unreachable. Task 3 deletes it.

**Gates:** `pnpm test`, typecheck, lint, `pnpm validate:ui` (the garage and scene-host strings),
`pnpm ui:routes` (the scene-host leaves still release their context), `pnpm golden-baseline` (the
screens check: board `live`, host `live`).

### Task 3: Delete the Pixi backend and the `pixi.js` dependency

- [ ] Delete `packages/render/src/renderer.ts`, `pixi.ts`, `renderer.reseed.test.ts`, the `./pixi`
      export in `packages/render/package.json`, and `pixi.js` from its dependencies. Regenerate
      `pnpm-lock.yaml` and commit only that file's diff. Remove the `./pixi` door from `eslint.config.mjs`'s
      bundle rule.
- [ ] Pixi-only shared modules: `cursor-ownership.ts` (only `renderer.ts` imports it). Remove
      `vfx/particles.ts`'s `draw(g: Graphics)` path and its `import type { Graphics } from 'pixi.js'`.
      Three steps the same `ParticleSystem` and draws it through its own instancer. Split
      `conformance.ts` so the projection properties run against `three/camera.ts` alone.
      `project.ts` **stays**: 20 three files import it.
- [ ] Keep `anim.ts`, `clip.ts`, `sheet.ts`, `grind.ts`, `trail.ts` and `tile-hash.ts`. Three imports
      each of them (measured: `sheet.ts` has 9 three-side importers, because mesh clips share its clip
      vocabulary).
- [ ] Delete `packages/app/src/terrain-parity.test.ts` (a Pixi-vs-three parity spec). Remove the
      `pixi.js` credit from `credits-data.ts` and its test.
- [ ] Update `packages/render/package.json`'s `description` ("PixiJS renderer and VFX").

**Gates:** `pnpm test`, typecheck, lint, `pnpm build` (record the `dist/` size against Task 1), and
`rg -il 'pixi' packages` shows comments only. Each surviving comment is either history or fixed in
Task 9.

### Task 4: Retire the cross-backend harnesses

- [ ] Delete `tools/src/ci/golden-diff-gate.ts`, `golden-diff/expected-differences.ts`, the `pixiUrl`
      half of `golden-diff/capture-protocol.ts`, and the `golden-diff:compare` scripts in both
      `package.json` files. `golden-diff/diff.ts` (two PNGs in, a metric out) can stay if anything
      still calls it. Otherwise delete it.
- [ ] `tools/src/perf/backend-curve-gate.ts` and `perf/three-units.ts`: delete `measurePixi` and the
      billboard stand-in (`SPRITE_MAP_PATHS`, the literal copy of `SPRITE_MAP`). **Keep the Node-CLI
      sim-tick half**, which is `pnpm perf:units` in `ci.yml`'s `gates` job. Rewrite the ci.yml comment
      that calls it "the three-vs-Pixi scaling claim".
- [ ] `tools/src/perf/art-captures.ts`: drop the `06-nomesh-billboards` shot.
- [ ] `docs/PERFORMANCE.md`: mark the Pixi and billboard curves historical. Do not delete the
      measurements.
- [ ] `three-baseline-gate.ts` and `baseline.ts`: their comments cite the cross-backend history. Keep
      it as history and remove any live code path that still names Pixi.

**Gates:** typecheck, lint, `pnpm test`, `pnpm perf:units` (still green on CI's shape),
`pnpm golden-baseline` (unchanged: it was always three-vs-three).

### Task 5: Remove `&nomesh` and make the mesh path unconditional in `app`

- [ ] Run Task 1's `mesh_roster.test.ts` first. It must be green, or stop.
- [ ] `sandbox-help.ts`: `nomesh` moves to accepted-no-effect, with a blurb saying meshes are the only
      path. Pin it in `sandbox-help.test.ts` and `sandbox-menu.test.ts`. The `/free-play` checkbox
      list loses it, because it builds from the same table.
- [ ] `main.ts`: delete `wantMesh`/`meshPathActive` and the `&nomesh` civilian warning around line
      2090. `mission-start.ts` loses its `&nomesh` turret-facing branch. `spriteSheetPlan` loses
      `meshPath: false`. Fix its stale drone line.
- [ ] **A GLB that fails to load.** Today the unit falls back to its billboard. After this task, the
      deploy gate must fail loudly: name the file, keep the loading screen, and offer a retry. It must
      not deploy a unit that draws nothing. Write the spec as a red test first, with a fetch stub that
      404s one GLB.
- [ ] **Deferred KDF buildables.** Today a buildable is a billboard for a few frames until its GLB
      lands. Decide (the lead) between two options: load buildable GLBs before the build button
      enables, or accept an invisible unit for those frames. The first option is the recommendation;
      measure what it adds to `perf:load` time-to-deploy.
- [ ] `tools/src/perf/blast-captures.ts`: delete the `blast_nomesh` subject and its floors. The
      `blast-light` and `scorch` floors stand on the mesh subjects, which already carry them.

**Gates:** `pnpm test`, typecheck, lint, `pnpm ui:routes`, `pnpm golden-baseline`, `pnpm blast:capture`
(floors hold on the mesh subjects).

### Task 6: Remove the billboard unit and structure drawing from `three` (part 1: bodies)

- [ ] `units/atlas.ts`, the unit billboard instancers in `units/instances.ts`, and
      `structures.ts`'s billboard structures. Remove `Renderer.loadSprites` and `loadStructureSprite`
      from `api.ts`, so the compiler finds every caller. That covers `main.ts`, `tools/src/perf/unit-plates.ts`
      `NO_MESH_SPRITE_PATHS`, and `spike-rig.ts`.
- [ ] **Do not delete `frame-state.ts` whole.** `walkFps` and `cadenceScale` are what the mesh gait
      multiplies by (CLAUDE.md, "Mesh units": a routed mesh rifleman and a routed billboard had to
      agree). Move the mesh-side readers to `mesh-anim.ts`, then delete the billboard remainder.
- [ ] `instances.ts` is 1,120 lines and also feeds FX instancers. Delete by caller, not by file.
- [ ] `ThreeRenderer.unitsDebugHidden` and the `units` debug layer: the layer now hides mesh units and
      mesh vehicles only. Re-run the `vehicle` scenario's toggle. It read 23147 to 23152 px against a
      floor of 7700, so a drop of a few hundred px from the billboard instancers is fine. A drop below
      the floor means the flag stopped reaching the meshes.

**Gates:** typecheck, lint, `pnpm test` (the render specs that build billboard fixtures:
`atlas.test.ts`, `instances.test.ts`, `structures.test.ts`, `ThreeRenderer.*.test.ts`),
`pnpm golden-baseline` (all 22 layer checks hold, and every gated scenario reads inside its noise).

### Task 7: Billboard part 2 (silhouette, FX anchors) and the sprite wrecks

- [ ] `units/silhouette.ts`: delete the billboard path (atlas alpha dilation and the fixed 0.75 depth
      bias). The mesh path's `2.5 × silhouetteOutlineWorldWidth(zoom)` bias stays. This retires the
      recorded pre-existing defect (75 to 432 false px along a billboard Lavi's hull base) because its
      path is gone, not because it was fixed. Say so in the commit.
- [ ] `muzzle-flash.ts`, `explosion-burst.ts`, `collapse-shroud.ts`, `mesh-death.ts`,
      `mesh-vehicle-death.ts`, `rigid-mesh-fixture.ts`: remove the sprite-anchored branches.
- [ ] **Wrecks.** Delete `ThreeRenderer.addWreck`'s sprite path, `this.wrecks`, `MAX_UNIT_WRECKS` and the
      wreck instancer. The CLAUDE.md trap ("do NOT add `vehicleMeshTemplates` to that guard
      unconditionally") stops applying, because there is no sprite wreck left to delete. Replace it
      with a load-time assertion: a vehicle template with no `wreck` clip throws, naming the GLB. That
      is the same shape as `TEXTURED_MESH_EXEMPT`'s throw.
- [ ] **What remains for wrecks, stated rather than solved:** a civilian has `down` and no wreck, and
      fades by design. Real damaged geometry (D1 in the vehicle-wreck spec) is still a per-vehicle art
      pass. `heli_peten`'s rigid rotor still cannot droop. None of these is a sprite dependency.

**Gates:** typecheck, lint, `pnpm test` (`ThreeRenderer.vehicle-mesh-death.test.ts`, `blast.test.ts`),
`pnpm blast:capture`, `pnpm golden-baseline`.

### Task 8: Delete the sheets, `SPRITE_MAP`, the icon crops and the sprite gates

- [ ] Delete `assets/sprites/` (43 sheets, 72 MB), `SPRITE_MAP` and `STRUCTURE_SPRITES` in `main.ts`,
      and every reader the compiler names: `mesh-catalogue.ts`, `ui/hud.ts`, `ThreeRenderer.ts`,
      `frame-state.ts`, `terrain/ground.ts` (comment only), `encode-meshes.ts` (comment only), and the
      tools.
- [ ] `ui/portrait.ts`: delete `portraitFile`, `portraitUrl`, `PORTRAIT_FACING` and `SheetManifest`.
      `main.ts`'s `loadBrigadePortrait` and the HUD portrait loop lose their sheet-manifest fetch. A type
      with no portrait (`civilians`) gets the hatch, as it does today.
- [ ] Delete `assets/ui/icons/units/`, `tools/crop_unit_icons.py`, `pnpm icons:units`,
      `tools/src/unit_icons.test.ts`, `portrait.test.ts`'s "unit icon manifest pin", and `ci.yml`'s
      `crop_unit_icons.py --check` step.
- [ ] `tools/validate_assets.py`: the sheet-completeness and sprite palette/silhouette checks have
      nothing left to walk. Find out what PNGs it still guards (commander portraits? UI art?) before
      cutting. If nothing remains, retire `pnpm validate:assets` from `ci.yml` in the same commit, and
      say so. `tools/validate_mesh_assets.py`: silhouette IoU becomes mesh-vs-mesh only. Delete the
      "own retired sprite" exclusion (`own_sprite_dirs`). Its import of `quantize_sprites` must keep
      working for the mesh palette check.
- [ ] **Keep `tools/render_rig.py`.** `render_mesh_gate.py`, `render_unit_portraits.py`'s lineage and
      `render_clip_pose.py` all use its camera. The per-unit sprite renderers (`render_team.py`,
      `render_eitan.py`, `render_technical.py` and others) lose their output. Delete them, or move them
      to an `art/legacy` note. Never leave them writing into a deleted directory.
- [ ] `sw-policy.test.ts` fixtures and `vite-plugin-asset-watch.ts`: the watcher derives its
      directories from source, so `assets/sprites` drops out of the boot banner by itself. Check the
      banner.
- [ ] Closed by this task: G0 #2 (the `JEEP_HULL` sheet licence, D-26). Record it in HANDOVER.

**Gates:** typecheck, lint, `pnpm test`, `pnpm validate:data`, `pnpm validate:meshes`,
`pnpm validate:ui`, `pnpm build`, `pnpm ui:routes`, and `pnpm golden-baseline`. A 404 on `/sprites/`
in any harness's console is a failure. `ui:routes` already fails on console errors.

### Task 9: Rewrite CLAUDE.md

Sections and facts to rewrite. Each item is either deleted, or kept as one line of history where a later
reader would otherwise reintroduce the thing.

- [ ] **Project** (top): "Two renderer backends live behind one interface... PixiJS still ships" becomes
      one backend. The `Renderer` seam in `api.ts` stays: it is still what keeps `app` off
      backend-only members.
- [ ] **Package layout:** `render/` "renderer + VFX", with no `PixiRenderer`.
- [ ] **Commands:** `validate:assets` (Task 8's outcome) and `icons:units` (gone).
- [ ] **Adding content → A unit:** "needs a `.blend` in `art/src/` that survives `pnpm validate:assets`
      (including the silhouette IoU check)" becomes a GLB that passes `pnpm validate:meshes`, plus a
      Blender portrait from `render_unit_portraits.py`. Fix the staged-unit sentence to match.
- [ ] **What not to do:** "Do not commit rendered sprites without their `.blend` source" becomes the
      mesh equivalent. Keep the paid-pack rule and the AI-art rule.
- [ ] **Dev instruments:** the shell's flag table (`&nomesh` gone), `&civ`'s "under `&nomesh` or on
      Pixi spawns a crowd that draws nothing", the `ui:shots`/`ui:routes` notes that mention Pixi, and
      the `SPRITE_MAP` "Art existing is not art drawing" bullet (delete it; the failure mode cannot
      recur without the map).
- [ ] **The three.js backend:** the opening ("Pixi is the escape hatch"), the frozen-`renderer.ts`
      paragraph, "VFX no longer owe Pixi parity", "Overlays scale with zoom... on BOTH backends", the
      render-order note that cites Pixi's `unitsG`/`fogG` order (keep the band values and drop the
      Pixi justification), the **cross-backend Pixi-vs-three diff** bullet (delete), and the
      silhouette's billboard half.
- [ ] **Mesh units:** the `&nomesh` escape hatch paragraph, the `SPRITE_MAP`/sheet-plan load-cost
      paragraph (replace it with Task 10's numbers), "Mesh units are outside `validate:assets`",
      "`kit.py` changed without the sprite sheets being re-rendered", the `render_team.py --probe`
      bullet, the elevation-debts walk's Pixi halves, "A unit spawned mid-mission draws correctly on
      three and not on Pixi", "A renderer choice persists per ORIGIN", the `addWreck` guard
      paragraph, and the "three art styles in half a second" history.
- [ ] **The campaign board:** "The flat PNG board is not a fallback... it IS the Pixi path" is now
      false. It is the fallback, for three named causes.
- [ ] **The scene host:** "Pixi and reduced motion both get the plate" becomes reduced motion and
      failures. Delete D-54's Pixi half and the "Pixi at default motion slides the plate by design" line.
- [ ] **Known scaling debts:** the Pixi-only VFX-elevation paragraph and the billboard boulder-bias
      split (`&nomesh draws no decor at all`).
- [ ] Every bare mention left over: `rg -n -i 'pixi|nomesh|billboard|SPRITE_MAP|sprite sheet' CLAUDE.md`
      must return only lines you chose to keep as history. Paste the remaining count in the PR.

**Gates:** none mechanical. A reviewer reads the diff against the `rg` list.

### Task 10: Measure, bless if needed, land

- [ ] Re-run Task 1's `perf:load` protocol: same missions, cold, three runs. Expect sprite-sheet
      requests to be 0 and bytes down by the sheets the default path still fetched (vehicle wreck
      sheets after the first frame, and deferred buildables). Record before and after in
      `docs/PERFORMANCE.md` and in the PR. Also record `dist/` size and repository size
      (`du -sh assets`).
- [ ] `pnpm golden-baseline` locally, then CI's `visual` job. **Expected: no gated frame moves.** No
      gated scenario draws a billboard or a sprite wreck: `vehicle` parks a meshed force, and `aftermath`
      has no unit. If CI moves, locate the clusters first. A cluster at a unit's feet points at the
      silhouette change from Task 7. Bless only from CI numbers, through the restored review-PR route
      (G2 answer 3; it needs the repo setting flipped by the lead), and one bless in flight at a time.
- [ ] `pnpm ui:shots -- --pseudo` across all screens: no `/sprites/` 404, and no screen reads its
      "pixi" copy.
- [ ] HANDOVER §1 and §4: WP-A3.3 landed. G0 #2 and G0 #4 (the Pixi WebGL leak on soft leave, D-25) are
      closed by deletion.

**Gates:** everything in `gates` and `visual`, `determinism` green, `pnpm playtest` and `pnpm balance`
byte-identical.

### Task 11: Whole-branch review and one fix wave

- [ ] A fresh reviewer reads the whole branch against this plan's census and risk list, then one fix
      wave. Then the PR. The lead merges.

---

## Gates per task, at a glance

| task | test/tc/lint | validate | ui:routes | golden-baseline | other |
|---|---|---|---|---|---|
| 1 | yes | — | — | — | `perf:load` before; mesh_roster falsified ×3 |
| 2 | yes | ui | yes | yes (screens check) | — |
| 3 | yes | — | — | — | `pnpm build`, size |
| 4 | yes | — | — | yes | `perf:units` |
| 5 | yes | — | yes | yes | `blast:capture`; GLB-404 spec red first |
| 6 | yes | — | — | yes (22 toggles) | `vehicle` units toggle ≥ 7700 px |
| 7 | yes | — | — | yes | `blast:capture` |
| 8 | yes | data, meshes, ui | yes | yes | `build`; no `/sprites/` 404 |
| 9 | — | — | — | — | `rg` count in PR |
| 10 | all | all | yes | CI `visual` | `perf:load` after; `ui:shots --pseudo` |

## Risks

1. **CLAUDE.md is full of Pixi-only facts** (35 lines name Pixi; more name `&nomesh`, billboards or
   `SPRITE_MAP`). Several are traps written as rules ("do NOT add `vehicleMeshTemplates` to that
   guard"). If one survives Task 9, a later agent will follow it into dead code. Task 9's `rg` count is
   the guard.
2. **A failed GLB load becomes an invisible unit.** The billboard was the silent fallback for every
   mesh. Task 5 must turn that case into a loud deploy failure before Task 6 removes the billboard.
3. **Deferred buildables lose their placeholder** (Task 5 lead decision). Loading buildable GLBs before
   deploy costs `perf:load` time. Measure it, do not guess.
4. **`frame-state.ts` and `instances.ts` are shared.** The mesh gait reads `walkFps`/`cadenceScale`, and
   FX instancers live in `instances.ts`. Delete by caller. `mesh_gait.test.ts` and the gait specs
   (`ThreeRenderer.gait.test.ts`) are the tripwire.
5. **Harnesses use `?sandbox=` and `?mission=` URLs, and some assume billboards.** `art-captures.ts`
   (a `&nomesh` shot), `blast-captures.ts` (`blast_nomesh`), `unit-plates.ts` (`NO_MESH_SPRITE_PATHS`
   for the drones, now stale since the drones have GLBs), and `perf/three-units.ts` (a billboard
   stand-in, in CI as `perf:units`). `ui:routes` and the golden capture build `?sandbox=`/`?mission=`
   URLs only and never set `&nomesh`, so their frames are already mesh-only. Their console-error
   rule is what catches a `/sprites/` 404.
6. **The visual gate's `units` layer floor.** Hiding `units` also hid the billboard instancers. The
   floor (7700 px) sits at a third of 23147 px, so this should hold, but re-read it in Task 6.
7. **The flat campaign board's tests assume "Pixi" as the cause** (`worldmap.test.ts`, and its known
   inert "does not write to localStorage" spec, which compares two `undefined`s). Re-point them; do not
   delete the board.
8. **`validate:assets` may have nothing left to guard.** Retiring a CI gate is a decision. State it in
   the PR rather than letting the step go green on an empty walk. A gate that walks nothing and prints
   PASS is the `groundTextureCheck` failure.
9. **Telemetry continuity.** `session_start.renderer` stays as a field so old D1 rows and
   `QUERIES.sql` still group correctly.
10. **The sim.** Nothing here may touch `packages/sim`. If a task finds a reason to, stop and raise it.
11. **The determinism golden hash** should never move. If it does, a renderer change leaked into a sim
    import, which breaks invariant 4.
12. **Repository size.** Deleting 72 MB of PNGs does not shrink clone size, because history keeps them.
    Not a goal of this plan. Do not rewrite history.
