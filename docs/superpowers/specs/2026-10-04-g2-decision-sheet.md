# G2 decision sheet: milestone 1 review (GH-166, due 30 Oct 2026)

Prepared 4 Oct 2026 at main `751b6742`, read-only evidence. Answers are copied into `docs/HANDOVER.md` section 3 with the date, then #166 closes.

| # | Question | Default | Recommendation |
|---|---|---|---|
| 1 | Retire Pixi and the sprite sheets (WP-A3.3, #189) | Go, scheduled in Stage 5 | **Go**, Stage 5, with one named prerequisite (nine portraits) |
| 2 | The Steam page | Schedule the product track deliberately | **Schedule it**; the page cannot go live at M1, so fix the ST1 date now |
| 3 | The visual bless path | Restore the review PR | **Restore the PR**, with a stated trade-off on the repo setting |
| 4 | Platform (shell Phase 4: Deck, controller) | Unscheduled until the demo exists | **Keep unscheduled**; name the trigger |

## 1. Retire Pixi and the sprite sheets (WP-A3.3, #189)

**Default.** Go, scheduled in Stage 5. #189 waits on A3.1 complete, S3a portraits and this answer. Size: one plan, six tasks. It touches `packages/render`, `packages/app` and tools.

**Precondition: meshes cover the roster AND portraits come from Blender.**
- **Meshes.** Met. Of 35 unit JSONs, 34 have a GLB in `art/meshes/`. All nine "crop fallback" enemy types have one (`charge_squad`, `digger_crew`, `militia_cell`, `mortar_crew`, `moto_rpg`, `rpg_team` as team GLBs; `gun_truck`, `technical`, `paramotor` as vehicles). The two drones also have vehicle GLBs. The one exception is `civilians`, which has no GLB and no `SPRITE_MAP` entry either (CLAUDE.md: it draws nothing under `&nomesh`). That is not a sprite dependency, but it is a roster gap to close or accept. The A3.1 checklists (#179 #181 #185 #286) are still OPEN per HANDOVER, so "mostly complete" stands until someone ticks them.
- **Portraits.** Not fully met. #338/#340 shipped Blender portraits in `assets/ui/portraits/units/`. Nine enemy types still use the sprite crop: `charge_squad`, `digger_crew`, `gun_truck`, `militia_cell`, `mortar_crew`, `moto_rpg`, `paramotor`, `rpg_team`, `technical`. They have meshes, so this is a render-and-wire task, not new art. It is the one real blocker.

**What still depends on sprite sheets (the delete list for #189).**
- `SPRITE_MAP` in `packages/app/src/main.ts` (line ~668), read by `mesh-catalogue.ts`, `ui/portrait.ts` (`spriteCropIcon`), `ui/hud.ts`, `render/api.ts`, `ThreeRenderer.ts`, `frame-state.ts`, `terrain/ground.ts`, and tools (`encode-meshes.ts`, `unit-plates.ts`, `perf/three-units.ts`).
- 43 sheets under `assets/sprites/` (72 MB): 31 `INF_*`/vehicle/drone units plus `BLD_*` buildings.
- `&nomesh` (the billboard path on three): `sandbox-help.ts`, `main.ts`, `mission-start.ts`, `mesh-catalogue.ts`, and about 18 `three/units/*` files plus `debug-layers.ts`.
- Wreck sprites: a mesh vehicle's wreck sprite, loaded after the first frame, and the procedural-wreck fallback guard (`addWreck` steps aside only when the template has a `wreck` clip).
- Icon fallbacks: the nine crops above, and `pnpm icons:units` / `crop_unit_icons.py --check` / `unit_icons.test.ts`.
- Pixi itself: `packages/render/src/renderer.ts`, `pixi.ts`, the `./pixi` export and the `pixi.js` dependency, `?renderer=pixi` and `renderer-choice.ts`. 121 `.ts`/`.json` files mention Pixi.
- Harnesses: the cross-backend `golden-diff:compare` (already report-only), `backend-curve-gate.ts`, `routes-check.ts` Pixi legs, and `validate:assets` sprite-sheet completeness plus the silhouette IoU against sprites in `validate:meshes`.
- Sprite-era debts that retire with them: G0 #2 (`JEEP_HULL` sheet licence, D-26), G0 #4 (Pixi WebGL leak on soft leave, D-25), the Pixi spawn-from-(0,0) slide, and the frozen `renderer.ts`.

**Must stay.** The flat campaign board is the no-WebGL2 fallback (`ui/worldmap.ts`, `worldmap.test.ts`, `data/campaign/world.json`). Today CLAUDE.md calls the flat board "the Pixi path". After retirement it is only the no-WebGL2 / GLB-failure / scene-contract-failure path, so its tests need re-pointing, not deleting. The Draco and screens-check legs that assert `data-board=live` stay.

**What each answer costs.**
- **Go now (schedule Stage 5).** About six tasks of render-lane time, plus one visual bless (the picture should barely move; `&nomesh` is not gated). Gains: one backend, about 72 MB fewer assets, no second-binary download for a desktop wrapper (ST2), shorter CI (no cross-backend leg), and the two Pixi debts close. Risk: no `&nomesh` escape hatch for a player whose GPU chokes on meshes. That path is already unmaintained (no decor, no gated frames).
- **Defer.** Keeps the hatch. Costs: every render change in Stages 3–4 still has to keep Pixi compiling (the frozen `renderer.ts` rule), sprites drift from `kit.py` further, and the desktop build would ship both renderers.
- **Flag.** (Retire only Pixi, keep sheets.) Not recommended: the sheets exist for Pixi and `&nomesh`, so there is nothing for them to serve.

**Recommendation.** Go, Stage 5. Make the first task of #189 "render the nine missing portraits and delete `spriteCropIcon`", and tick the four A3.1 checklists before the plan opens. Decide on `civilians` (accept "no mesh" explicitly, or add a GLB under A3.1).

## 2. The Steam page

**Default.** Schedule the product track deliberately (packaging, page, demo) rather than start it in a spare hour.

**Evidence.**
- The art precondition (phases 0–2) is met at M1.
- ST1 #200 (Steamworks account, Steam Direct fee, tax and bank forms) is the lead's own action and is OPEN. On 30 Sep the lead set "ST1 later, not this week". Valve's verification takes calendar time, not work time.
- ST4 #203 (store page) waits on ST1 (the app ID) and on art Phases 2–3. It was scheduled for the end of Stage 4 so the trailer and capsules show the lit renderer and Meshy roster. Its "Coming Soon" page must start gathering wishlists against the plan's 7,000 floor.
- Devlog #301 drafts but does not post until the page exists. HANDOVER: "No wishlist engine".

**What each answer costs.**
- **ST1 now (1 Nov).** Costs a lead afternoon plus the fee; unlocks the app ID, so ST2/ST3 and the page can proceed in parallel with Stage 3. The page still should not go up before the capsules exist.
- **ST1 at G2 (30 Oct).** The page goes live late in Stage 4 at the earliest, and Valve verification time is added on top. Wishlists accrue later against a fixed 7,000 floor.
- **No date.** The default's "deliberately" fails: the page then has no owner and the floor has no clock.

**Recommendation.** Schedule it. Ask the lead to name a start date for ST1 at G2 (the earlier of "after M1" or "when verification lead time exceeds the Stage 4 remainder"), and keep ST4 at the end of Stage 4 so the capsules show the new look.

## 3. The visual bless path

**Default.** Restore the review PR.

**Evidence.**
- Since 2 Sep the `visual-baseline-bless` workflow commits straight to `main` (`df582647`, the lead's call "instead of PR merge to main and push"). Nobody sees the picture unless whoever dispatched it downloads the `visual-baseline-bless-captures` artifact.
- The repo setting "Allow GitHub Actions to create and approve pull requests" is OFF (`can_approve_pull_request_reviews: false`, read via the API on 4 Oct). That is what blocked the PR route originally. It is a repository setting, so only the lead can flip it.
- A bot push triggers no `ci.yml` run, so `main`'s `visual` status stays stale until the next real push.
- Blesses this week: `318bcea6`, `6143eb65`, `ecc70e28`, `76d154d0` and `4c89b6e1`. Each was checked from CI numbers, with the diff clusters located first, then re-blessed. The process worked because it is manual and disciplined, not because the workflow enforces it. HANDOVER parks that rule as "a manual step, not in `three-baseline-gate.ts`".
- From here the art phases (A3.2 remainder, A4 readability follow-ups, Stage 3 onward) move whole frames, which is the default's reason.

**What each answer costs.**
- **Keep direct-to-main.** Zero change, fastest, matches current practice. Cost: the only review is the dispatcher's own, one mistaken bless becomes the reference with nothing to revert but a bot commit, and a dispatch while `main` is moving retries the push three times.
- **Restore the PR.** Flip one setting (lead), swap the workflow's last step back to `gh pr create`. Gains: a diff reviewed before it is the reference, and the PR runs `ci.yml`, so `visual` goes green on the new baseline instead of staying stale. Cost: one extra merge per bless (the lead merges anyway), the setting also lets Actions approve PRs in general (mitigate: leave branch protection requiring a human review), and a second landing in flight needs rebasing. The five blesses this week would each have been one more PR.
- **Middle path.** Keep direct-to-main but make the "capture twice" and "locate the clusters" rule code in `three-baseline-gate.ts`. Cheaper than the PR; does not give a human look at the picture.

**Recommendation.** Restore the PR. The cost is one merge click per bless; the benefit is that a human looks at the picture before it becomes the reference, which is the point of the gate. Pair it with a PR-body template that carries the cluster table (scenario, px, mean delta, bounding box) so the check done by hand this week travels with the PR.

## 4. Platform (shell Phase 4)

**Default.** Unscheduled until the demo exists.

**Evidence.** The old "Phase 4, not scheduled" is now ST2 #201 (desktop wrapper) and ST3 #202. G0 #4 (Pixi leak, one mission per tab) is moot under a wrapper, and #189 gives retirement one more reason (a second renderer is a second download). The demo does not exist; no controller input layer exists; the HUD is designed for mouse and keyboard (Commander's HUD, M1).

**What each answer costs.**
- **Schedule now.** A controller scheme, focus navigation (HANDOVER already parks "keyboard focus on the strip resets every 250 ms") and a Deck-sized layout pass land before the HUD has settled, and risk rework when Stage 3 changes screens.
- **Unscheduled.** No cost today. The risk is that "after the demo" never gets a date.

**Recommendation.** Keep unscheduled, with a trigger written into HANDOVER: it is scheduled when the demo build exists and ST2 is done. Fix the keyboard-focus reset (Phase 3 debt) first, since controller navigation needs it anyway.

## Answers (to fill in at the review)

| # | Answer | Date |
|---|---|---|
| 1 | | |
| 2 | | |
| 3 | | |
| 4 | | |
