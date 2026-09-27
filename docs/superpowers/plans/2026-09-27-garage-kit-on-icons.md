# The Garage Uplift, Plan 2b: the Kit Sign on the Unit Icons

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the kit mark from the world, and put the kit sign on the unit's icons instead. Every icon the player uses to pick or read one of their own units gets the kit sign in its top-right corner, when the unit's type carries kit (level 1–3). The sign is plan 1's own glyph, `kitSymbolSvg('kit', …, L)`, which the garage bay already draws. So the icon shows exactly what the player saw when they bought the kit. During a mission, every sign reads its level from the one `upgradePrepass` result, `unitKit`. That is the same loop that patches the unit types the sim runs and fills the HUD card's pips. Nothing re-derives it.

**Why this plan exists.** Plan 2 (`2026-09-26-garage-tier-mark.md`) built the world mark as Tasks 1–5 on this branch:
- `587f0095`, `f7339314`, `99164c5b` and `93d49ae9`: the steel plate over the HP bar, in `OverlayBatch`, with `RendererOptions.unitKit` and a `kit-mark` debug layer;
- `0d85f00f`: `upgradePrepass → unitKit` and the sandbox kit ladder;
- `bbe36807`: the `&kit` flag.

Plan 2 measured the mark at +0 draw calls. At the picture gate (G-P, 2026-09-27) the lead rejected it, verbatim: *"The mark is ugly maybe it should only show on the icons"*.

The controller's rulings are binding on this plan:
- No kit mark in the world at all.
- The sign goes on the icons, and reuses plan 1's `kit-sign.ts`.
- Tasks 4–5 stay (the prepass `unitKit`, the ladder and `&kit`), because they now feed the icons.
- The world-mark code goes out through new revert commits, never a history rewrite. `ThreeRenderer.ts`, `api.ts`, `debug-layers.ts` and `render-order.ts` go back to `main`'s bytes, and the renderer lane is freed.

**Architecture:** This plan works entirely in `packages/app` and `tools`. After Task 1, `packages/render` is byte-identical to `origin/main`.
- `ui/kit-sign.ts` gains `KIT_ICON_SIGN`, `kitIconSignHtml(level)` and `withKitSign(iconHtml, level)`. At level 0 they return `''` and the icon unchanged, so an unkitted icon's DOM is byte-identical to today's.
- `theme.css` gains one block for the sign. It is absolute and top-right, steel through `.rl-kit-mark`'s `currentColor`, with a one-pixel `--kit-edge` halo.
- `main.ts` builds one accessor over `prepass.unitKit`, called `kitLevelOf`. It hands `kitLevelOf` to the HUD, for the chips and the card frame, and hands the level to each dock tile.
- The garage rail reads its own `kitSummary`: it is the account, and there is no mission prepass behind it.
- `tools/src/ui-review/kit-icons.ts` is the pure verdict that `ui:routes` drives. `ui:shots` gains three states.

**The sign is DOM, so it draws on both backends.** `?renderer=pixi` shows it exactly as three does. The world mark could never have done that (plan 2's R-8).

**Tech Stack:** TypeScript strict, vitest (jsdom for UI specs), Playwright (tools only). No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-25-garage-uplift-design.md` (WP-S3g, #238). The lead's G-P rejection amends §3.4 option A and §8's "Plan 2". Everything else in the spec stands:
- D2: the summary level on the icon, and all three tracks on the card and in the garage;
- D3: steel;
- the placeholder glyphs until G1.

**Status and entry.** Branch `feat/garage-tier-mark`, worktree `/Users/ilpinto/dev/roaring-lions-ep/s3g-mark`, `HEAD` `bbe36807`, `origin/main` `165eb966`. Every `file:line` below was read at `bbe36807`. The ledger is `.superpowers/sdd/2026-09-27-garage-kit-on-icons/progress.md`. It is git-ignored, and it is mirrored to the session scratchpad, because clean worktrees get removed. Evidence goes under `.superpowers/garage-icons/`.

## Global Constraints

These bind every task.

- **Lane A only after Task 1.** Tasks 2–8 write only these files:
  - `packages/app/src/{main,upgrade-prepass,sandbox-force,sandbox-help}.ts`;
  - `packages/app/src/ui/{kit-sign,kit-sign.test,hud,hud.test,selection-model,selection-model.test,production,production.test,dock-model,brigade,brigade.test}.ts`;
  - `packages/app/src/ui/theme.css`;
  - `tools/src/ui-review/{kit-icons,kit-icons.test,routes-check,shoot}.ts`;
  - the Task 8 docs.
- **Byte-identical from Task 1 on, at every commit.** The check is `/usr/bin/git diff --stat origin/main -- packages/render packages/sim`, and it must print NOTHING. Two things hold because of it:
  - Invariant 4. The sign reads what `main.ts` already computed before the sim ran.
  - The renderer lane is free. A later A2 plan may take `ThreeRenderer.ts` the moment Task 1 lands.
- **One source for a level during a mission.** Every icon on the battlefield reads `prepass.unitKit` through `kitLevelOf` (`main.ts`). No icon calls `kitLevel` or `kitSummary`. Plan 2 T4's test (`upgrade-prepass.test.ts:44-49`) pins that `unitKit[id] === kitByType.get(id).level`, so the card's pips and its frame sign cannot disagree. In the garage, the rail reads the `kitSummary` its own pips already read (`brigade.ts:489`).
- **Colour from tokens only.** The sign uses `--kit` (`gunmetal-0`) for the glyph, through `.rl-kit-mark`, and `--kit-edge` (`shadow-0`) for the halo. Both are already defined (`theme.css:156-157`). `pnpm validate:ui` rejects any hex or `rgba()`, with no allowlist. It also rejects a layout `px` value, so write sizes and insets in rem. The 1 px halo is a hairline inside `filter`, which the px check exempts.
- **Level 0 draws nothing, and changes no byte.** An unkitted icon's markup must equal today's (Task 3 pins this, and Tasks 4–6 pin it per surface). The visual gate depends on it: every gated scenario boots a fresh account.
- **Side 0 only.** An enemy, or a chip that holds any unit that is not the player's, carries no sign.
- **Every check has an input that makes it fail, and that input has been run.** Each task ends with its mutations. Apply each one, see it red, and undo it **by reverting the edit, never `git checkout -- <file>`**. The commit body says what was seen red. A browser-only red goes in the ledger with its capture.
- **Two approval gates are hard stops.**
  - **G-N2** (Task 2): the lead approves the numbers table and the mock before any icon code is committed.
  - **G-P2** (end of Task 7): the lead sees the `ui:shots` captures of the real screens before the PR opens.
- **Servers.** Use ports **5193–5199** only, always with an explicit `--port`. `ui:routes` defaults to 5177, which is the lead's, so always pass `-- --port=5195`. `claimPort` refuses a busy port with exit 2. Never kill a process you did not start, and never `pkill`.
- **The golden gate.** The local darwin baseline is stale (since 2026-09-03), so a local comparison is not evidence. CI's `visual` job on the PR is. This plan expects no gated scenario to move (see "The visual gate" below). No bless is made from this branch.
- **Gates before every commit:** `pnpm lint && pnpm typecheck && pnpm test && pnpm validate:data && pnpm validate:ui`, plus whatever the task names, plus the byte-identical check above.
- **Git hygiene.**
  - Call `/usr/bin/git` by absolute path, one command per call.
  - Stage with `git add <paths>` and commit with `git commit -s -F <msgfile> -- <paths>`.
  - Never use `-A`, `git checkout -- <file>`, `stash`, `reset`, or `--amend`, and never push from a task.
  - End every message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Size.** Each task touches at most five authored files and about 400 changed lines, tests included.

## Rulings taken while planning

- **R-1: the revert is one commit for the renderer, plus one hand-removed line.** Plan 2 T5 (`bbe36807`) put `unitKit: prepass.unitKit` into `main.ts`'s `RendererOptions` literal (`main.ts:1637-1640`). Reverting T2 removes that field from `api.ts`. The literal is typed, so leaving the line in is a `tsc` error. Task 1 therefore reverts plan 2's `587f0095`, `f7339314`, `99164c5b` and `93d49ae9` together, and deletes those four lines from `main.ts` in the same commit, so every commit typechecks. The rest of `bbe36807`, the flag itself, stays. The wording that still names a world mark changes in a second, docs-only commit, so the first commit stays a pure revert.
- **R-2: `RendererOptions.unitKit` goes, and so does the `main.ts` line.** Nothing in `packages/render` reads the field once `ThreeRenderer`'s mark is reverted, and Pixi never read it. A dead optional option is a lure for the next person who wants a world mark. The ruling says there is none.
- **R-3: `unitKit` stays on `UpgradePrepass`, and becomes the icons' source.** The brief requires this. It also makes `kitLevelOf` a one-line read of the object that registered the sim's types, rather than a projection of `kitByType`.
- **R-4: the sign is the garage's glyph, not a new drawing.** `kitSymbolSvg('kit', px, L)` (`kit-sign.ts:67-74`) is what the bay stamps at 48 px (`brigade.ts:797`). When G1 approves the family sheet, the one `KIT_SYMBOLS` line (`kit-sign.ts:64`) changes, and every icon follows with no edit.
- **R-5: one size and one corner on every surface.** The size is 1.25 rem. The corner is top-right, because it is the only corner free on all four surfaces (see the census). One rule is easier to learn than four.
- **R-6: the size is set by legibility, and a test enforces it.** The glyph sits in a 24-unit box:
  - The plate stroke is 2.5 units, its bottom edge sits at y = 22, and its inner edge at 20.75.
  - Each bar is 3 units tall. The lowest bar ends at 19.5, and the gaps between bars are 1.5 units.

  At `s` px, the lowest bar clears the plate by `1.25 × s ÷ 24` px. That is under 1 px for any `s` below 19.2, where the level-1 bar fuses into the plate's base. This is the same fault that plan 2 R-2 refused on the map. At 1 rem, the sign is 16 px at `--ui-scale` 1 (0.83 px of clearance) and 18.4 px at 1.15 (0.96 px): both fail. At 1.25 rem it is 20, 23 and 28 px (1.04, 1.20 and 1.46 px): all pass. Task 3's test computes this from the markup itself. Shrinking the sign or redrawing the glyph turns it red.
- **R-7: the halo, not a plate behind the sign.** The lead called a plated mark ugly. A one-pixel `--kit-edge` `drop-shadow` lifts steel off a sand-coloured icon without adding a second shape. G-N2 shows the plated variant beside it, so the lead chooses with both in view.
- **R-8: a locked dock tile hides its sign.** A locked tile asks "what do I earn next". Its art is already drained (`theme.css:2598-2601`), and a steel sign on grey art reads as a fault. The sign stays in the DOM and the stylesheet hides it, so it reappears the instant a lock lifts, with no rebuild. The garage rail keeps the sign on a locked card: kit a gate re-locked is kept, dormant (`garage.locked.kitKept`), and the rail is where the player reads what they own.
- **R-9: the chip needs a host, and the card and tile do not.** `.rl-card__frame` (`theme.css:2218`) and `.rl-tile` (`theme.css:2490`) are already `position: relative`. `.rl-chip__art` and `.rl-garage__card-art` are bare flex items. `withKitSign` wraps them in a `span.rl-kit-host`, sized by the art, **only at L ≥ 1**, so an unkitted chip's DOM does not change.
- **R-10: `&kit` cannot reach the dock.** The dock mounts only on a mission with `resources` (`main.ts:2912`), and `&kit` is sandbox-only (`bootTiers`, never on a mission). The two proofs are therefore:
  - the ladder on chips and the card (sandbox);
  - plan 1's `garageSeedScript` account on `beit_sahwan_breach`, for the dock, chips and card. That mission `requires: []`, carries `resources`, and fields `inf_squad` and `at_team`.

## The icon census

This census covers every place `packages/app` draws a picture of one of the player's own units. Lines were read at `bbe36807`.

| # | Surface | Where it is drawn | Icon box (rem → px at `--ui-scale` 1 / 1.15 / 1.4) | Corners already taken | Carries the sign? |
|---|---|---|---|---|---|
| S1 | **Selection chips**: multi-select, one chip per type | `hud.ts:1574-1627` (`renderChips`); art from `artHtml` `hud.ts:1653-1673`, called at `:1611`; CSS `.rl-chip__art` `theme.css:2108-2118` | 2.5 → 40 / 46 / 56 | none (the role badge is inline with the name, `:1618`) | **Yes.** The player picks sub-groups here, and one chip is one type, so one level. |
| S2 | **HUD unit card**: single select | `hud.ts:1680-1795` (`cardHtml`); frame `:1765-1772`, art `:1766`, role badge `:1770-1771`, pips `:1779`; CSS `.rl-card__frame` `theme.css:2218-2229`, `.rl-card__badge` `:2238-2244` | frame 4.5 → 72 / 83 / 101 | top-left (role badge, 3 px) | **Yes, on the frame.** The pips stay beside the name (D2: the tracks on the card). |
| S3 | **Reinforcement dock tiles** | `production.ts:218-297` (`buildUnitTile`), art `:227-243`; fed by `main.ts:2908-2950` (`sprite` `:2940`), mounted only when `runtime && mission?.resources` (`:2912`); CSS `.rl-tile` `theme.css:2490-2505`, `.rl-tile__art` `:2528-2538` | tile 3.75 → 60 / 69 / 84 (art 3.5 → 56) | top-left (countdown `:2571`), bottom-right (cost `:2556`), bottom edge (lock `:2602`, bar `:2579`) | **Yes.** The player picks a type to build, and kit is type-wide, so the unit that deploys carries it. Hidden on a locked tile (R-8). |
| S4 | **Garage rail cards** | `brigade.ts:471-558` (`renderCards`), art `:494-513`, pips `:538-542`; CSS `.rl-garage__card-art` `theme.css:4058-4061` | 3 → 48 / 55 / 67 | none | **Yes (recommended).** Here the player learns the sign, beside the pips that sum to it. The lead may strike this row at G-N2 (then Task 6 is dropped). |
| S5 | Garage bay plate | `brigade.ts:792-800` (`kitSymbolSvg('kit', 48, L)` with a `Kit I–III` label) | 3 rem mark on the plate | n/a | **Unchanged.** It already carries the sign, and it is the reference the other rows match. |
| S6 | Control-group bar | `group-bar.ts:1-60`: slot number, count, a health track | no icon at all | n/a | **No.** There is no picture to carry a sign, and a group mixes types, so it has no single level. |
| S7 | Deploy spread rows | `loading.ts:237-317` (`deploySpread`): name, type, `★`, record, all text | no icon | n/a | **No.** These are text rows, and the ruling is "on the icons". Adding a sign would be a new surface; see Out of scope. |
| S8 | Brought panel | `loading.ts:524-560`: text rows | no icon | n/a | **No**, as S7. |
| S9 | Commander, speaker and villain faces | `loading.ts:464-475`, `menu.ts:527-536` | people, not units | n/a | **No.** |
| S10 | Tooltips (chip, dock tile) | `hud.ts:1638-1641`, `production.ts:346+` | text | n/a | **No.** |

**Recommendation.** S1, S2 and S3 in a mission, and S4 in the garage. Those are every surface where the player picks or reads a unit through its picture. At 1.25 rem the sign is 20 px or more on all of them (R-6).

## G-N2: the numbers the lead approves before any icon code is committed

**G-N2 FINAL — the lead, 2026-09-27, quoted verbatim (after seeing the B-halo
L1 crops):** *"B, but 20 px on the chip."* Read with the ledger's fuller
record of the same answer: halo style (no plate), top-right corner, the
plan's own insets, own units at level ≥ 1, hidden on a locked tile — all as
recommended below — but the **size splits by surface**: the selection chip
keeps **1.25 rem** (20 px at `--ui-scale` 1); the card frame, the dock tile
and the garage rail all drop to **1 rem** (16 px). The garage rail is kept.
I2 and I3 below are amended in place to record the split; every other row is
unchanged from the recommendation.

| # | Item | Number (recommended) | Alternatives shown in the mock | Reason |
|---|---|---|---|---|
| I1 | Glyph | `kitSymbolSvg('kit', 20, L)`: the garage bay's own bevelled plate with L bars, unchanged | none | R-4 |
| I2 | Size | **Final: per surface.** Chip **1.25 rem** (20 / 23 / 28 px at `--ui-scale` 1 / 1.15 / 1.4); card frame, dock tile and garage rail **1 rem** (16 / 18.4 / 22.4 px) | A (1.25 rem on every surface) was the G-N2 recommendation; B (1 rem on every surface) is the alternative the lead split from | R-6, refined by the lead's own split after the B-halo L1 crop |
| I3 | Legibility at `--ui-scale` 1 | **Chip** (1.25 rem): stroke 2.08 px; bars 2.5 px; gaps 1.25 px; lowest bar to plate 1.04 px — clears R-6's ≥ 1 px floor. **Card frame / dock tile / garage rail** (1 rem): stroke 1.67 px; bars 2 px; gaps 1 px; lowest bar to plate **0.83 px** — under the floor; the lead saw this fuse in the crop and chose it anyway for these three surfaces | none | Task 3's test enforces the chip's ≥ 1 px floor and records the smaller size's 0.83 px as the lead's accepted number, not a requirement |
| I4 | Corner | **top-right on every surface** | none | R-5; the census's "corners already taken" |
| I5 | Insets (from the padding edge) | chip 0; rail 0; card frame 0.1875 rem (3 px, the role badge's own margin); dock tile 0.125 rem (2 px, the art's own inset) | none | Each sits where that surface's own corner mark sits |
| I6 | Colour | glyph `--kit` (`gunmetal-0` #C3C7C4) through `.rl-kit-mark`; a 1 px `--kit-edge` (`shadow-0` #23241F) `drop-shadow` halo; **no box** | C: plated, a `--well` square with a 1 px `--kit-edge` border behind the glyph | R-7; D3 steel, clear of gold (veterancy, credits), team blue and lime selection |
| I7 | Who | side 0 only; L ≥ 1 only; a chip only when every unit in it is the player's; a locked dock tile hides it | none | Global Constraints; R-8 |
| I8 | Share of the icon | chip 25% of its art; rail 17%; dock tile 13% of its art; card frame 8% | B: 16 / 11 / 8 / 5% | So the lead can judge weight, not only legibility |
| I9 | Layout | zero: absolute, and a kitted chip or card is exactly as tall as an unkitted one | none | `ui:routes` measures it (Task 7) |
| I10 | Source | mission: `prepass.unitKit` through `kitLevelOf`; garage: its own `kitSummary` | none | R-3 |
| I11 | Surfaces | S1 chips, S2 card frame, S3 dock tiles, **S4 garage rail (recommended; strike to drop Task 6)** | none | census |
| I12 | Inspection | `&kit` shows the ladder on S1 and S2: L1 on `inf_squad`, `apc_eitan` and `jeep_shoded`; L2 on `at_team`, `ifv_namer`, `recon_drone` and `heli_peten`; L3 on `mortar_team`, `mbt_lavi` and `dozer_d9` (`SANDBOX_KIT_LEVELS`, `sandbox-force.ts:148-159`). The account's levels show everywhere else. | none | R-10 |

---

## G-P3: Steel Stars of David (I1 and I6 above superseded)

G-N2 approved a glyph and a colour: `kitSymbolSvg('kit', …, L)` — the garage
bay's own bevelled plate with L bars — in `--kit` steel, no box, a
`--kit-edge` halo. After Task 7's `ui:shots` captures went to the lead at
G-P2, the lead asked to reopen the glyph itself: *"what about using the Stars
(maybe Golden David Stars) design in Meshy + changing the chip color for
upgraded units?"* That is a redesign of I1 and a new ask (a chip tint), not
what G-N2 approved, so it reopened as **G-P3** rather than landing on the
G-P2 nod.

**G-P3 decisions, the lead, 2026-09-27, quoted verbatim in order:**
1. *"Steel Stars of David"* — the icon sign becomes 1–3 six-pointed Stars of
   David, one per kit level, drawn **steel** (`--kit`/`--kit-edge`, the same
   tokens I6 set), never gold — gold stays veterancy's stars and the credits
   readout (D3). Only the icon sign's glyph changes; the garage bay keeps its
   own plate-and-bars mark (`kitSymbolSvg('kit', …)`) unchanged.
2. *"Tinted border"* — a kitted chip's own border also carries the level, a
   `color-mix(in srgb, var(--kit) …%, var(--kit-edge))` border-colour rule
   keyed on `data-kit`, stronger at each step (40% / 70% / 100%). Nothing
   else about the chip changes: not its fill, not its size.
3. *"SVG now"* — the stars are hand-drawn SVG paths (`starOfDavidPath`),
   not a Meshy render: a 3D medal downsampled to a 16–20 px flat glyph
   blurs, an SVG stays crisp at any `--ui-scale`, and Meshy credits are the
   October budget's anyway. A Meshy medal look stays open to revisit once
   those credits land.
4. *"Bigger stars"* (recommended, after judging the first stars capture) —
   each star drawn its own full sign height rather than shrunk to fit inside
   G-N2's square box: **10 px tall on the chip, 8 px on the card frame, the
   dock tile and the garage rail**, at `--ui-scale` 1. The row grows
   **leftward from the top-right corner** as the level rises — the corner
   star holds still and the sign's width follows the count
   (`kitSignAspect(level)`) rather than staying a fixed square. `KIT_ICON_SIGN`
   carries the two heights only; the width is derived, never a third stored
   number.
5. *"Approve"* — on the re-shot captures at the bigger size, closing G-P3.

I2–I5, I7–I12 above are unchanged: surfaces, corner, insets, sizing method
(now heights, not a square edge) and who gets the sign all still read as
G-N2 recorded them. Only the glyph (I1) and the colour row (I6, which gains
the border tint alongside the unchanged halo) move under G-P3.

---

## File structure

| File | Responsibility | Task | Est. lines |
|---|---|---|---|
| the four plan-2 render commits, reverted, and `main.ts` −4 | the world mark out; `packages/render` back to `origin/main` | 1 | −700 |
| `main.ts`, `upgrade-prepass.ts`, `sandbox-force.ts`, `sandbox-help.ts` | comments and one blurb that still name a world mark | 1 | 20 |
| `.superpowers/garage-icons/mock/**` (git-ignored) | the G-N2 mock: a static HTML page and its PNGs | 2 | not committed |
| `ui/kit-sign.ts` (+test), `ui/theme.css` | `KIT_ICON_SIGN`, `kitIconSignHtml`, `withKitSign`; the sign's CSS | 3 | 190 |
| `ui/selection-model.ts` (+test), `ui/hud.ts`, `ui/hud.test.ts`, `main.ts` | chip `own`; the chip and card-frame sign; `kitLevelOf` | 4 | 170 |
| `ui/dock-model.ts`, `ui/production.ts` (+test), `main.ts` | `DockUnit.kit`; the tile's sign | 5 | 70 |
| `ui/brigade.ts` (+test) | the rail's sign | 6 | 60 |
| `tools/src/ui-review/kit-icons.ts` (+test), `routes-check.ts`, `shoot.ts` | the verdict, the routes legs, three `ui:shots` states | 7 | 380 |
| `CLAUDE.md`, the spec, plan 2's status line | docs | 8 | 40 |

---

### Task 0: Entry

This is not a code task. The coordinator runs it, and it needs no model.

- [ ] **Step 1: Check whether `main` moved.** Run `/usr/bin/git -C /Users/ilpinto/dev/roaring-lions-ep/s3g-mark fetch origin`, then `/usr/bin/git -C /Users/ilpinto/dev/roaring-lions-ep/s3g-mark log --oneline HEAD..origin/main`. If it lists anything, `/usr/bin/git merge origin/main`, and re-read every `file:line` above that the merge touched before Task 1. From here on the byte-identical reference is `origin/main`, whichever commit that is.
- [ ] **Step 2: Check the tree.** Run `/usr/bin/git worktree list`, `/usr/bin/git status --short` and `/usr/bin/git diff --cached --name-only`. The tree must be clean apart from this plan, and the index must be empty.
- [ ] **Step 3: Record the baseline** in the ledger:
  - the spec count from `pnpm lint && pnpm typecheck && pnpm test && pnpm validate:data && pnpm validate:ui`;
  - the wall clock of `pnpm ui:routes -- --port=5195`, which Task 7 compares against;
  - `/usr/bin/git diff --stat origin/main -- packages/render`, which must list the six world-mark paths now. That is the byte-identical check seen red.
- [ ] **Step 4: Archive plan 2 T6's uncommitted tool.** The controller has already ruled on the `kit-captures` work. Confirm that `.superpowers/garage-mark/t6/` and the sdd-archive hold it, and that `git status` shows no `tools/src/perf/kit-captures*`.

---

### Task 1: The world mark out, by revert

**Model:** sonnet. The work is mechanical, but it runs in a git state (a revert in progress) where one wrong command costs the branch.

**Files:**
- Revert (commit A): `packages/render/src/api.ts`, `packages/render/src/three/ThreeRenderer.ts`, `packages/render/src/three/ThreeRenderer.kit-mark.test.ts` (deleted), `packages/render/src/three/debug-layers.ts`, `packages/render/src/three/debug-layers.test.ts`, `packages/render/src/three/units/kit-mark.ts` (deleted), `packages/render/src/three/units/kit-mark.test.ts` (deleted), `packages/render/src/three/units/render-order.ts`. Hand-edit: `packages/app/src/main.ts`, lines 1637–1640 only.
- Modify (commit B): `packages/app/src/main.ts` (the comment at `:1253-1256`), `packages/app/src/upgrade-prepass.ts` (the header `:1-14` and the doc on `unitKit` `:26-27`), `packages/app/src/sandbox-force.ts` (the doc on `SANDBOX_KIT_LEVELS` `:144-147`), `packages/app/src/sandbox-help.ts` (the `kit` blurb `:57`).

**Interfaces:** `RendererOptions.unitKit` ceases to exist. `UpgradePrepass.unitKit`, `SANDBOX_KIT_LEVELS`, `sandboxKitTiers`, `bootTiers` and the `kit` flag are unchanged.

- [ ] **Step 1: See the byte-identical check red.** Run `/usr/bin/git diff --stat origin/main -- packages/render`. It lists the eight paths above. Record the output.
- [ ] **Step 2: Revert, without committing.** Run `/usr/bin/git revert --no-commit 93d49ae9 99164c5b f7339314 587f0095`. The order is newest first, so each patch applies to the state its successor left.
  - If it stops on a conflict, **stop and report**. Plan 2 left no later edit in these files, so a conflict means the tree is not what this plan read.
  - Then run `/usr/bin/git status`. If it reports a revert in progress, run `/usr/bin/git revert --quit`. That keeps the index and the working tree, and makes the path-limited commit in Step 6 legal: git refuses a partial commit during a revert.
- [ ] **Step 3: See `tsc` red, then remove the orphaned line.** Run `pnpm typecheck`. It fails in `main.ts` on the `RendererOptions` literal: `'unitKit' does not exist in type 'RendererOptions'`. Record it. Then delete exactly these four lines from `main.ts`, and nothing else:

```ts
    // The same per-type loop that fed the sim's tiers and the HUD card's kit
    // (`bootKit`/`prepass`, above) -- so the mark on a unit always agrees with
    // both.
    unitKit: prepass.unitKit,
```

- [ ] **Step 4: Prove the renderer is `main`'s again.**
  - `/usr/bin/git diff --stat origin/main -- packages/render packages/sim` must print **nothing**.
  - `test ! -e packages/render/src/three/units/kit-mark.ts && test ! -e packages/render/src/three/ThreeRenderer.kit-mark.test.ts && test ! -e packages/render/src/three/units/kit-mark.test.ts` must exit 0.
  - `grep -rn "unitKit\|kit-mark\|kitMark" packages/render` must print nothing.
  - `/usr/bin/git diff origin/main -- packages/app/src/main.ts` must show only plan 2 T5's `bootTiers` hunks (the import, and the `roster`/`bootKit`/`prepass` lines at `:1253-1258`), and no `unitKit`.
- [ ] **Step 5: Gates.** Run `pnpm lint && pnpm typecheck && pnpm test && pnpm validate:data && pnpm validate:ui && pnpm test:determinism`. The spec count must be Task 0's count minus exactly the tests in the three deleted files and the `debug-layers.test.ts` cases `99164c5b` added. Record both counts and the difference.
- [ ] **Step 6: Commit A.** Stage with `/usr/bin/git add packages/app/src/main.ts`; the revert already staged the render paths. Check that `/usr/bin/git diff --cached --name-only` lists exactly the nine paths above. Commit those nine paths with this message:

```
revert(render): the world kit mark -- rejected at the picture gate (WP-S3g plan 2b T1)

This reverts commits 587f0095, f7339314, 99164c5b and 93d49ae9 (plan 2
Tasks 1-3 and its review round): the steel plate over each own kitted
unit's HP bar in OverlayBatch, RendererOptions.unitKit, and the kit-mark
debug layer. The lead at G-P, 2026-09-27: "The mark is ugly maybe it
should only show on the icons".

main.ts loses the four lines that fed RendererOptions.unitKit (added by
bbe36807), because the field no longer exists; bbe36807 is otherwise kept
(the &kit flag, bootTiers before the one prepass).

packages/render is byte-identical to origin/main (165eb966) after this
commit: `git diff --stat origin/main -- packages/render packages/sim` is
empty; it listed eight paths before. Seen red: tsc on the orphaned
unitKit line before it was removed. Spec count <before> -> <after>
(<n> tests left with the three deleted files and the
debug-layers cases 99164c5b added).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

- [ ] **Step 7: See the stale wording, then fix it (commit B).** First run `grep -n "map mark\|renderer's mark\|overlay radii\|kit scenario\|the kit mark and the HUD card" packages/app/src/{main,upgrade-prepass,sandbox-force,sandbox-help}.ts`. It lists all four files: seen red. Then rewrite:
  - **`main.ts:1253-1256`:** "…so the swap reaches the sim, the HUD card and the unit icons together; a mission never takes it (`bootTiers`)."
  - **`upgrade-prepass.ts` header:** replace "and the renderer's mark over each own-side unit (WP-S3g plan 2)" with "and the kit sign on each own unit's icon (WP-S3g plan 2b)". Replace "the card, or the mark," with "the card, or an icon,".
  - **`upgrade-prepass.ts`, the `unitKit` doc:** "The kit sign's level on every unit icon (chips, card frame, dock tiles) -- from the same summary the card draws; every KDF type, bought or not, and no other faction. The world mark this once fed was rejected (plan 2b)."
  - **`sandbox-force.ts:144-147`:** "`&kit` (sandbox only, WP-S3g plan 2b): a fixed kit level per type the sandbox force fields, so one selection shows all three levels on the unit icons at once (N12). The dock never shows it: the dock is mission-only, and `&kit` never reaches a mission."
  - **`sandbox-help.ts:57` blurb:** `'the sandbox force pre-kitted, level 1–3 by type — the kit sign on the unit icons and the HUD card to walk'`.

  Rerun the grep: it must print nothing. Run the gates line. Commit the four paths with the message `docs(app): &kit and unitKit now feed the unit icons, not a world mark (WP-S3g plan 2b T1)`, with a body that names the grep seen red.

---

### Task 2: The numbers and the mock, approved (G-N2)

**Model:** sonnet builds the mock. The coordinator puts it to the lead. **Nothing is committed in this task, and no icon code (Task 3 on) is committed before the lead's words are in the ledger.**

**Files (git-ignored, never committed):** `.superpowers/garage-icons/mock/gen.ts`, `.superpowers/garage-icons/mock/kit-icons.html`, `.superpowers/garage-icons/g-n2/*.png`.

- [ ] **Step 1: Generate the page** from a scratch `gen.ts` that `npx tsx` runs from the repo root. It must use real inputs, so the lead judges the thing that will ship:
  - **The glyph:** `import { kitSymbolSvg } from '../../../packages/app/src/ui/kit-sign'`, at 20 px (A) and 16 px (B). Do not hand-copy the markup.
  - **The icons:** the shipped PNGs, by relative `src`: `assets/ui/icons/units/INF_SQUAD.png`, `INF_AT.png`, `NAMER_HULL.png`, `TNK_HULL.png` and `D9_HULL.png`.
  - **Colours:** `gunmetal[0]` and `shadow[0 and 1]` read from `data/palette.json`'s `ramps`. The page is a mock outside `packages/app/src`, so hex is allowed here and nowhere else.
  - **Surfaces:** each surface at its real box on its real ground:
    - a chip: a 40 px art box, then the name, `×2` and a track, on the panel ground `shadow-1`;
    - the card frame: 72 px, with the role badge top-left;
    - a dock tile: 60 px, with the countdown top-left and the cost bottom-right, plus a **locked** tile with its art drained;
    - a rail card: 48 px, with its pips.
  - **Variants:** every surface at L1, L2 and L3, in three variants side by side: **A-halo** (recommended), **B-halo**, and **A-plated** (C).
  - **Scales:** the whole grid at `--ui-scale` 1 and 1.15. The root font-size is 16 and 18.4 px, and sizes are written in rem so the scale is honest.
- [ ] **Step 2: Photograph it.** Run a Playwright script in the same scratch folder. It is `file://`, so it needs no server. Take 1400 × 900 at DPR 1, which is the truth a player sees, plus ×4 nearest-neighbour crops of the chip and the tile at L1 for each variant. Write the PNGs to `.superpowers/garage-icons/g-n2/`.
- [ ] **Step 3: The gate.** The coordinator gives the lead the G-N2 table, the DPR-1 PNG and the L1 crops, and asks:
  1. A, B or plated?
  2. Keep or strike S4, the garage rail?
  3. Is the recommended corner and inset right?

  Record the lead's words verbatim in the ledger. **If the lead changes a number**, change it in the G-N2 table in this plan (a docs commit of this plan file only), in `KIT_ICON_SIGN` and the Task 3 tests, and nowhere else. If the lead picks B, Task 3's legibility test is **wrong by design**. Stop, and bring the lead R-6's fused-bar crop before writing any code. If the lead strikes S4, drop Task 6 and the `rail` rows in Task 7.

---

### Task 3: The sign, sized for an icon

**Model:** sonnet.

**Files:**
- Modify: `packages/app/src/ui/kit-sign.ts`, `packages/app/src/ui/kit-sign.test.ts`, `packages/app/src/ui/theme.css`

**Interfaces (Tasks 4–6 consume these):**
- `const KIT_ICON_SIGN: { readonly rem: 1.25; readonly px: 20 }`: the G-N2 size. `px` is the size at `--ui-scale` 1, written into the svg's attributes. The stylesheet's rem rule wins, so the sign follows the UI scale.
- `function kitIconSignHtml(level: KitLevel): string`: `''` at 0; otherwise `<span class="rl-kit-icon rl-kit-mark" data-kit="L" role="img" aria-label="Kit I|II|III">` + `kitSymbolSvg('kit', KIT_ICON_SIGN.px, L)` + `</span>`.
- `function withKitSign(iconHtml: string, level: KitLevel): string`: the icon, untouched, at 0; otherwise `<span class="rl-kit-host">` + icon + sign + `</span>`.

- [ ] **Step 1: Write the failing tests.** Append to `kit-sign.test.ts`. Add `readFileSync`, `fileURLToPath` and the three new exports to its imports:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { KIT_ICON_SIGN, kitIconSignHtml, withKitSign } from './kit-sign';

const THEME = readFileSync(fileURLToPath(new URL('./theme.css', import.meta.url)), 'utf8');

/** A rule's body by its exact selector at the start of a line, so
 *  `.rl-kit-icon` never matches `.rl-kit-icon svg` or `.rl-tile > .rl-kit-icon`. */
function ruleBody(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&');
  const body = new RegExp(`\\n${esc}\\s*\\{([^}]*)\\}`).exec(THEME)?.[1];
  if (body === undefined) throw new Error(`fixture: theme.css has no rule "${selector}"`);
  return body;
}

/** The mark's own geometry, read back out of the markup the garage draws --
 *  never restated -- in the sheet's 24-unit box: the plate's inner bottom
 *  edge, and each bar's [top, bottom]. */
function markGeometry(level: 1 | 2 | 3): { plateInnerBottom: number; bars: [number, number][] } {
  const svg = kitSymbolSvg('kit', 24, level);
  const d = /<path d="([^"]+)"/.exec(svg)?.[1];
  const stroke = Number(/stroke-width="([\d.]+)"/.exec(svg)?.[1]);
  if (d === undefined || !Number.isFinite(stroke)) throw new Error('fixture: the kit mark has no stroked plate');
  const ys = [...d.matchAll(/[ML]\s*[\d.]+\s+([\d.]+)/g)].map((m) => Number(m[1]));
  const bars = [...svg.matchAll(/<rect x="[\d.]+" y="([\d.]+)" width="[\d.]+" height="([\d.]+)"/g)].map(
    (m): [number, number] => [Number(m[1]), Number(m[1]) + Number(m[2])]
  );
  return { plateInnerBottom: Math.max(...ys) - stroke / 2, bars };
}

describe('the kit sign on a unit icon (plan 2b, G-N2)', () => {
  const ICON = '<img class="rl-chip__art" src="/x.png" alt="" draggable="false">';

  it('is the approved size, and the stylesheet draws it at exactly that size', () => {
    expect(KIT_ICON_SIGN).toEqual({ rem: 1.25, px: 20 });
    expect(KIT_ICON_SIGN.px).toBe(KIT_ICON_SIGN.rem * 16);
    const svg = ruleBody('.rl-kit-icon svg');
    expect(svg).toMatch(new RegExp(`width:\\s*${KIT_ICON_SIGN.rem}rem`));
    expect(svg).toMatch(new RegExp(`height:\\s*${KIT_ICON_SIGN.rem}rem`));
  });

  it('keeps every bar a clear pixel apart, and off the plate, at the smallest UI scale (R-6)', () => {
    const scale = KIT_ICON_SIGN.px / 24; // --ui-scale 1: the smallest the sign is ever drawn
    for (const level of [1, 2, 3] as const) {
      const { plateInnerBottom, bars } = markGeometry(level);
      expect(bars).toHaveLength(level);
      const lowestFirst = [...bars].sort((a, b) => b[0] - a[0]);
      expect((plateInnerBottom - lowestFirst[0][1]) * scale, `L${level}: lowest bar to plate`).toBeGreaterThanOrEqual(1);
      for (let i = 1; i < lowestFirst.length; i++) {
        expect((lowestFirst[i - 1][0] - lowestFirst[i][1]) * scale, `L${level}: gap ${i}`).toBeGreaterThanOrEqual(1);
      }
      for (const [top, bottom] of bars) expect((bottom - top) * scale, `L${level}: bar height`).toBeGreaterThanOrEqual(2);
    }
  });

  it('draws nothing at level 0, and leaves an unkitted icon byte-identical', () => {
    expect(kitIconSignHtml(0)).toBe('');
    expect(withKitSign(ICON, 0)).toBe(ICON);
  });

  it('is the garage’s own mark, at the level asked, and names the level for a screen reader', () => {
    for (const level of [1, 2, 3] as const) {
      const host = document.createElement('div');
      host.innerHTML = kitIconSignHtml(level);
      const sign = host.querySelector<HTMLElement>('.rl-kit-icon');
      expect(sign?.dataset.kit).toBe(String(level));
      expect(sign?.classList.contains('rl-kit-mark')).toBe(true); // --kit through currentColor
      expect(sign?.getAttribute('role')).toBe('img');
      expect(sign?.getAttribute('aria-label')).toBe(kitLevelLabel(level));
      expect(sign?.innerHTML).toBe(kitSymbolSvg('kit', KIT_ICON_SIGN.px, level));
      expect(sign?.querySelectorAll('rect')).toHaveLength(level);
    }
  });

  it('wraps a kitted icon in a host the sign can sit in, icon first', () => {
    const host = document.createElement('div');
    host.innerHTML = withKitSign(ICON, 2);
    const wrap = host.firstElementChild;
    expect(wrap?.className).toBe('rl-kit-host');
    expect(wrap?.children).toHaveLength(2);
    expect(wrap?.children[0]?.className).toBe('rl-chip__art');
    expect(wrap?.children[1]?.className).toBe('rl-kit-icon rl-kit-mark');
  });

  it('sits top-right, coloured by tokens only, and never changes an icon’s size', () => {
    const sign = ruleBody('.rl-kit-icon');
    expect(sign).toMatch(/position:\s*absolute/);
    expect(sign).toMatch(/top:\s*0/);
    expect(sign).toMatch(/right:\s*0/);
    expect(sign).not.toMatch(/\b(left|bottom):/);
    expect(sign).toMatch(/drop-shadow\([^)]*var\(--kit-edge\)\)/);
    expect(sign).toMatch(/pointer-events:\s*none/);
    expect(ruleBody('.rl-kit-host')).toMatch(/position:\s*relative/);
    expect(ruleBody('.rl-card__frame > .rl-kit-icon')).toMatch(/top:\s*0\.1875rem;\s*right:\s*0\.1875rem/);
    expect(ruleBody('.rl-tile > .rl-kit-icon')).toMatch(/top:\s*0\.125rem;\s*right:\s*0\.125rem/);
    expect(ruleBody(".rl-tile[data-locked='1'] > .rl-kit-icon")).toMatch(/display:\s*none/);
  });
});
```

- [ ] **Step 2: Run the tests; they fail** on the missing exports. Command: `npx vitest run packages/app/src/ui/kit-sign.test.ts`, from the root.
- [ ] **Step 3: Implement.**
  - **`kit-sign.ts`:** add `KitLevel` to the `@lions/data` type import (it is already imported for `kitSummary`). Then add, after `kitSymbolSvg`:

```ts
/** G-N2 (plan 2b): the kit sign on a unit's ICON -- one size on every
 *  surface. `px` is the size at --ui-scale 1, written into the svg's own
 *  attributes; `theme.css`'s `.rl-kit-icon svg` rule sets the rem value and
 *  wins, so the sign follows the UI scale. 1.25rem is the smallest size at
 *  which the level-1 bar clears the plate by a whole pixel (plan 2b R-6);
 *  `kit-sign.test.ts` computes that from the markup, not from this comment. */
export const KIT_ICON_SIGN = { rem: 1.25, px: 20 } as const;

/** The garage bay's own mark (`kitSymbolSvg('kit')`), sized for an icon's
 *  corner. Nothing at level 0 -- an unkitted icon must not change by a byte
 *  (every gated golden frame boots a fresh account). */
export function kitIconSignHtml(level: KitLevel): string {
  if (level === 0) return '';
  return (
    `<span class="rl-kit-icon rl-kit-mark" data-kit="${level}" role="img" ` +
    `aria-label="${escapeHtml(kitLevelLabel(level))}">` +
    kitSymbolSvg('kit', KIT_ICON_SIGN.px, level) +
    `</span>`
  );
}

/** An icon that is a bare flex item (the chip's, the rail's) gets a host the
 *  sign can be absolute inside, sized by the art itself -- at L >= 1 only,
 *  so an unkitted icon's markup is returned untouched (plan 2b R-9). */
export function withKitSign(iconHtml: string, level: KitLevel): string {
  return level === 0 ? iconHtml : `<span class="rl-kit-host">${iconHtml}${kitIconSignHtml(level)}</span>`;
}
```

  - **`theme.css`:** add this block **directly after** the `.rl-kit-mark` rule (`theme.css:3850-3852`), so every sign rule lives in one place:

```css
/* The kit sign on a unit's ICON (WP-S3g plan 2b, G-N2): the garage bay's own
   mark (`kit-sign.ts`'s `kitIconSignHtml`) in the icon's top-right corner --
   the one corner free on every surface it sits on (the card's role badge and
   the dock's countdown hold top-left, the dock's price bottom-right, its lock
   and bar the bottom edge). Steel through `.rl-kit-mark`'s currentColor,
   lifted off the art by a one-pixel --kit-edge halo and NOT a plate: a plated
   mark over each unit on the map was built and rejected by the lead as ugly
   (2026-09-27). Absolute, so a kitted chip or card is exactly as tall as an
   unkitted one (`ui:routes` measures it). */
.rl-kit-icon {
  position: absolute;
  top: 0;
  right: 0;
  line-height: 0;
  pointer-events: none;
  filter: drop-shadow(0 0 1px var(--kit-edge));
}
.rl-kit-icon svg {
  width: 1.25rem;
  height: 1.25rem;
}
/* The chip's and the rail's art are bare flex items: a host the size of the
   art, drawn only for a kitted icon (`withKitSign`). */
.rl-kit-host {
  position: relative;
  flex: 0 0 auto;
  display: block;
  line-height: 0;
}
/* The card frame and the dock tile are already positioned; the sign steps in
   by the margin that surface's own corner mark uses -- the role badge's 3 px,
   the art's 2 px. */
.rl-card__frame > .rl-kit-icon { top: 0.1875rem; right: 0.1875rem; }
.rl-tile > .rl-kit-icon { top: 0.125rem; right: 0.125rem; }
/* A locked tile asks what to earn next, and its art is already drained (plan
   2b R-8). Hidden, not removed: it is back the moment the lock lifts. */
.rl-tile[data-locked='1'] > .rl-kit-icon { display: none; }
```

- [ ] **Step 4: Run the tests; they pass.** Run the gates line. `validate:ui` must pass: the block names no hex, `rgba()` or layout `px`.
- [ ] **Step 5: Falsify, then commit.** Each must be seen red, then undone by reverting the edit:
  - (a) `KIT_ICON_SIGN = { rem: 1, px: 16 }` and the CSS at `1rem`. The R-6 test goes red on `L1: lowest bar to plate`, at 0.83.
  - (b) CSS `width: 1rem` alone. The size test goes red.
  - (c) `withKitSign` wraps at level 0. The byte-identical test goes red.
  - (d) `kitIconSignHtml` passes `16` to `kitSymbolSvg`. "The garage's own mark" goes red.
  - (e) The halo's `var(--kit-edge)` becomes `var(--kit)`. The token test goes red.
  - (f) The halo becomes `drop-shadow(0 0 1px #23241F)`. `pnpm validate:ui` goes red.

  Commit the three paths with the message `feat(app): the kit sign sized for a unit icon -- the garage's mark, top-right, 1.25rem (WP-S3g plan 2b T3, G-N2)`. The body quotes the lead's G-N2 words from the ledger.

---

### Task 4: The chips and the unit card, from the one prepass

**Model:** sonnet.

**Files:**
- Modify: `packages/app/src/ui/selection-model.ts`, `packages/app/src/ui/selection-model.test.ts`, `packages/app/src/ui/hud.ts`, `packages/app/src/ui/hud.test.ts`, `packages/app/src/main.ts`

**Interfaces:**
- `UnitFacts.own?: boolean`: side 0. When it is absent, the unit reads as not own, so a chip never claims kit it cannot prove.
- `ChipView.own: boolean`: true iff every unit in the chip is own.
- `HudDeps.kitLevelOf?: (typeId: string) => KitLevel`: the level every HUD icon reads. It is asked only about side 0, and when absent it reads as 0 everywhere.
- In `main.ts`, the local `kitLevelOf(typeId: string): KitLevel` is `prepass.unitKit[typeId] ?? 0`.

- [ ] **Step 1: Write the failing tests.**
  - Append to `selection-model.test.ts`, which already has the `unit()` helper:

```ts
describe('a chip’s own-side reading (the kit sign, plan 2b)', () => {
  it('is own only when every unit in it is the player’s', () => {
    const chips = groupChips([
      unit({ typeId: 'inf_squad', own: true }),
      unit({ typeId: 'inf_squad', own: true }),
      unit({ typeId: 'ifv_namer', name: 'Namer', bucket: 'armour', own: true }),
      unit({ typeId: 'ifv_namer', name: 'Namer', bucket: 'armour', own: false }),
      unit({ typeId: 'mbt_lavi', name: 'Lavi', bucket: 'armour' }),
    ]);
    expect(chips.map((c) => [c.typeId, c.own])).toEqual([
      ['inf_squad', true],
      ['ifv_namer', false],
      ['mbt_lavi', false],
    ]);
  });
});
```

  - Append to `hud.test.ts`. It uses `makeForce` and `clusterRig`, which are already in the file; add `KitLevel` from `@lions/data` as a type import:

```ts
describe('the kit sign on the HUD’s icons (WP-S3g plan 2b)', () => {
  const levels =
    (map: Record<string, KitLevel>) =>
    (typeId: string): KitLevel =>
      map[typeId] ?? 0;
  const signOf = (el: Element | null | undefined): string | null =>
    el?.querySelector<HTMLElement>('.rl-kit-icon')?.dataset.kit ?? null;
  const chipOf = (r: ClusterRig, type: string): HTMLElement | undefined =>
    r.chips().find((c) => c.dataset.type === type);

  it('puts each chip’s type level on its icon, and nothing on an unkitted type', () => {
    const world = makeForce();
    const r = clusterRig(
      () => [...world.squads, world.at, world.namer],
      { kitLevelOf: levels({ inf_squad: 1, at_team: 3 }) },
      world
    );
    expect(signOf(chipOf(r, 'inf_squad'))).toBe('1');
    expect(signOf(chipOf(r, 'at_team'))).toBe('3');
    expect(signOf(chipOf(r, 'ifv_namer'))).toBeNull();
    // On the icon, not in the text column.
    expect(chipOf(r, 'inf_squad')?.querySelector(':scope > .rl-kit-host > .rl-chip__art + .rl-kit-icon')).not.toBeNull();
  });

  it('leaves an unkitted selection’s chips byte-identical to a HUD with no kit at all', () => {
    const a = makeForce();
    const plain = clusterRig(() => [...a.squads, a.at], {}, a).chips().map((c) => c.outerHTML).join('');
    const b = makeForce();
    const zero = clusterRig(() => [...b.squads, b.at], { kitLevelOf: () => 0 }, b).chips().map((c) => c.outerHTML).join('');
    expect(zero).toBe(plain);
  });

  it('never signs a chip that holds a unit the player does not command', () => {
    const world = makeForce();
    const enemy = world.sim.spawn(world.sim.state.typeIdx[world.namer], 1, fx.from(6), fx.from(6));
    const r = clusterRig(
      () => [world.squads[0], world.namer, enemy],
      { kitLevelOf: levels({ inf_squad: 2, ifv_namer: 3 }) },
      world
    );
    expect(signOf(chipOf(r, 'inf_squad'))).toBe('2');
    expect(signOf(chipOf(r, 'ifv_namer'))).toBeNull(); // mixed sides: the chip cannot prove it
  });

  it('puts the level on the single-unit card’s frame, opposite its role badge', () => {
    const world = makeForce();
    const r = clusterRig(() => [world.namer], { kitLevelOf: levels({ ifv_namer: 2 }) }, world);
    const frame = r.host.querySelector('.rl-card__frame');
    expect(frame?.querySelector<HTMLElement>(':scope > .rl-kit-icon')?.dataset.kit).toBe('2');
    expect(frame?.querySelector(':scope > .rl-card__badge')).not.toBeNull();
    expect(r.host.querySelectorAll('.rl-card .rl-kit-icon')).toHaveLength(1);
  });

  it('draws an unkitted card exactly as before, and never signs a unit the player does not command', () => {
    const a = makeForce();
    const plain = clusterRig(() => [a.namer], {}, a).host.querySelector('.rl-card')?.outerHTML;
    const b = makeForce();
    const zero = clusterRig(() => [b.namer], { kitLevelOf: () => 0 }, b).host.querySelector('.rl-card')?.outerHTML;
    expect(zero).toBe(plain);
    const world = makeForce();
    const enemy = world.sim.spawn(world.sim.state.typeIdx[world.namer], 1, fx.from(6), fx.from(6));
    const r = clusterRig(() => [enemy], { kitLevelOf: levels({ ifv_namer: 3 }) }, world);
    expect(r.host.querySelector('.rl-card .rl-kit-icon')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests; they fail.** Command: `npx vitest run packages/app/src/ui/selection-model.test.ts packages/app/src/ui/hud.test.ts`.
- [ ] **Step 3: Implement.**
  - **`selection-model.ts`:**
    - Add to `UnitFacts`: `/** Side 0 -- the player's own. Absent reads as not own, so a chip never claims kit it cannot prove (plan 2b). */ own?: boolean;`
    - Add to `ChipView`: `/** Every unit in the chip is the player's -- the kit sign's guard (plan 2b). */ own: boolean;`
    - In `groupChips`'s return: `own: group.every((u) => u.own === true),`.
  - **`hud.ts`:**
    - Imports: `import type { KitLevel } from '@lions/data';`, and add `kitIconSignHtml` and `withKitSign` to the `./kit-sign` import.
    - `HudDeps`, beside `kitOf`: `/** The kit level every HUD icon carries (plan 2b): main.ts's one read of upgradePrepass.unitKit. Asked about side 0 only; absent reads as 0 everywhere. */ kitLevelOf?: (typeId: string) => KitLevel;`
    - A private helper: `private kitLevel(typeId: string): KitLevel { return this.deps.kitLevelOf?.(typeId) ?? 0; }`
    - `renderChips`: add `own: st.side[i] === 0,` to each fact. Replace `this.artHtml(c.typeId, c.bucket, 'rl-chip__art', CHIP_MARK) +` (`:1611`) with `withKitSign(this.artHtml(c.typeId, c.bucket, 'rl-chip__art', CHIP_MARK), c.own ? this.kitLevel(c.typeId) : 0) +`.
    - `cardHtml`: after the role-badge conditional (`:1770-1772`), and before the frame's closing `</div>`, add `kitIconSignHtml(st.side[id] === 0 ? this.kitLevel(type.id) : 0) +`. Give it a one-line comment: the frame's summary level, beside the name's three-track pips (D2).
  - **`main.ts`:**
    - Add `type KitLevel` to the `@lions/data` import (`:64`).
    - After `const kitByType = prepass.kitByType;` (`:1259`), add:

```ts
  /** The one level every unit ICON reads (WP-S3g plan 2b): the prepass's own
   *  `unitKit`, never re-derived -- the loop that registered the sim's types
   *  and filled the card's pips. 0 for any type the prepass did not see. */
  const kitLevelOf = (typeId: string): KitLevel => prepass.unitKit[typeId] ?? 0;
```

    - In the HUD deps, after `kitOf:` (`:2601`), add `kitLevelOf,`.
- [ ] **Step 4: Run the tests; they pass.** Run the gates line and the byte-identical check.
- [ ] **Step 5: Falsify, then commit.** Each must be seen red, then undone:
  - (a) Drop `own: st.side[i] === 0` from `renderChips`. The first chip test goes red: no chip is own.
  - (b) `groupChips` uses `some` for `every`. The selection-model test goes red, and so does the mixed-sides HUD test.
  - (c) The card drops its `st.side[id] === 0` guard. The enemy-card assertion goes red.
  - (d) `kitLevel` returns `?? 1`. Both byte-identical tests go red.

  Commit the five paths with the message `feat(app): the kit sign on the selection chips and the unit card, from the one prepass (WP-S3g plan 2b T4)`.

---

### Task 5: The reinforcement dock's tiles

**Model:** haiku. The change is mechanical, and every test is written out below.

**Files:**
- Modify: `packages/app/src/ui/dock-model.ts`, `packages/app/src/ui/production.ts`, `packages/app/src/ui/production.test.ts`, `packages/app/src/main.ts`

**Interfaces:** `DockUnit.kit?: KitLevel` is the type's kit level this mission. It is absent or 0 for none.

- [ ] **Step 1: Write the failing tests.** Append to `production.test.ts`:

```ts
describe('the kit sign on a tile (WP-S3g plan 2b)', () => {
  it('signs a kitted type’s tile with its level, as the tile’s own child, and leaves the others alone', () => {
    const r = rig([
      dockUnit({ kit: 1 }),
      dockUnit({ id: 'mbt_lavi', name: 'Lavi MBT', kit: 3 }),
      dockUnit({ id: 'at_team', name: 'Spike AT' }),
    ]);
    expect(r.tile('inf_squad').querySelector<HTMLElement>(':scope > .rl-kit-icon')?.dataset.kit).toBe('1');
    expect(r.tile('mbt_lavi').querySelector<HTMLElement>(':scope > .rl-kit-icon')?.dataset.kit).toBe('3');
    expect(r.tile('at_team').querySelector('.rl-kit-icon')).toBeNull();
  });

  it('builds an unkitted tile exactly as before', () => {
    const plain = rig([dockUnit()]).tile('inf_squad').outerHTML;
    const zero = rig([dockUnit({ kit: 0 })]).tile('inf_squad').outerHTML;
    expect(zero).toBe(plain);
  });

  it('keeps one sign through the 4 Hz repaint', () => {
    const r = rig([dockUnit({ kit: 2 })]);
    r.dock.refresh();
    r.dock.refresh();
    expect(r.tile('inf_squad').querySelectorAll('.rl-kit-icon')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests; they fail.** Command: `npx vitest run packages/app/src/ui/production.test.ts`. They fail on `kit` not existing on `DockUnit`, as a type error under vitest's transform, and on the missing sign.
- [ ] **Step 3: Implement.**
  - **`dock-model.ts`:** add `import type { KitLevel } from '@lions/data';`. Add to `DockUnit`: `/** The type's kit level this mission (plan 2b) -- main.ts's kitLevelOf, the same read the chips and the card make. Absent or 0: no sign. */ kit?: KitLevel;`
  - **`production.ts`:** import `kitIconSignHtml` from `./kit-sign`. In `buildUnitTile`, after the art branch (`:227-243`) and before `const cost`, add `el.insertAdjacentHTML('beforeend', kitIconSignHtml(unit.kit ?? 0));`. At 0 that is `''` and inserts nothing. Add a one-line comment naming R-8: the stylesheet hides it on a locked tile.
  - **`main.ts`:** in the dock's unit map (`:2930-2950`), after `spriteIsIcon`, add `kit: kitLevelOf(u.id),` with the comment "the same one read the chips and the card make".
- [ ] **Step 4: Run the tests; they pass.** Run the gates line and the byte-identical check.
- [ ] **Step 5: Falsify, then commit.**
  - (a) Use `unit.kit ?? 1`. The byte-identical test goes red.
  - (b) Insert the sign twice (a second call in `refresh`). The repaint test goes red.
  - (c) This one is for the browser: drop `kit: kitLevelOf(u.id)` from `main.ts`. Task 7's K4 turns red on every dock tile. Record it in the ledger when Task 7 runs it.

  Commit the four paths with the message `feat(app): the kit sign on the reinforcement dock's tiles (WP-S3g plan 2b T5)`.

---

### Task 6: The garage rail's icons (S4, unless struck at G-N2)

**Model:** haiku.

**Files:**
- Modify: `packages/app/src/ui/brigade.ts`, `packages/app/src/ui/brigade.test.ts`

- [ ] **Step 1: Write the failing tests.** Append to `brigade.test.ts`. The helpers `mount`, `mountLive` and `units` are already in the file:

```ts
describe('showBrigade — the kit sign on the rail’s icons (WP-S3g plan 2b)', () => {
  const portrait = (id: string): string => `/ui/icons/units/${id}.png`;
  const card = (host: HTMLElement, id: string): Element | null => host.querySelector(`.rl-garage__card[data-unit="${id}"]`);

  it('signs a kitted card’s icon with the level its own pips sum to, and no other card', () => {
    const host = mount({ units, ledger: {}, possibleStars: 78, portrait, owned: { inf_squad: { armour: 1 } } });
    const sign = card(host, 'inf_squad')?.querySelector<HTMLElement>(':scope > .rl-kit-host > .rl-garage__card-art + .rl-kit-icon');
    expect(sign?.dataset.kit).toBe('1');
    expect(sign?.dataset.kit).toBe(card(host, 'inf_squad')?.getAttribute('data-kit'));
    expect(card(host, 'ifv_namer')?.querySelector('.rl-kit-icon')).toBeNull();
  });

  it('leaves an unkitted rail byte-identical', () => {
    const a = mount({ units, ledger: {}, possibleStars: 78, portrait });
    const b = mount({ units, ledger: {}, possibleStars: 78, portrait, owned: {} });
    expect(b.querySelector('.rl-garage__cards')?.innerHTML).toBe(a.querySelector('.rl-garage__cards')?.innerHTML);
    expect(a.querySelector('.rl-garage__cards .rl-kit-host')).toBeNull();
  });

  it('stamps the sign the moment a purchase lifts the level', () => {
    let owned: Record<string, Record<string, number>> = {};
    const { host, dispose } = mountLive({
      units,
      ledger: {},
      possibleStars: 78,
      portrait,
      credits: 999,
      owned,
      onBuyUpgrade: (id, track, tier) => {
        owned = { [id]: { [track]: tier } };
        return { units, credits: 799, owned };
      },
    });
    expect(card(host, 'inf_squad')?.querySelector('.rl-kit-icon')).toBeNull();
    host.querySelector<HTMLButtonElement>('.rl-garage__track[data-track="armour"] .rl-garage__buy-tier')?.click();
    expect(card(host, 'inf_squad')?.querySelector<HTMLElement>('.rl-kit-icon')?.dataset.kit).toBe('1');
    dispose();
  });
});
```

- [ ] **Step 2: Run the tests; they fail.** Command: `npx vitest run packages/app/src/ui/brigade.test.ts`.
- [ ] **Step 3: Implement.** In `renderCards` (`brigade.ts:494-513`), build the art (the `img`, or the hatch `div`) into a local `art` instead of appending it at once. Then:

```ts
      // The kit sign on the icon (plan 2b), from the SAME `kit` this card's
      // pips and `data-kit` read -- the garage is the account itself, so
      // there is no mission prepass here. Wrapped only at L >= 1: an
      // unkitted card's markup is unchanged (R-9).
      if (kit.level !== 0) {
        const host = el('span', 'rl-kit-host');
        host.append(art);
        host.insertAdjacentHTML('beforeend', kitIconSignHtml(kit.level));
        card.appendChild(host);
      } else {
        card.appendChild(art);
      }
```

  Add `kitIconSignHtml` to the `./kit-sign` import (`brigade.ts:61`).
- [ ] **Step 4: Run the tests; they pass.** Run the gates line.
- [ ] **Step 5: Falsify, then commit.**
  - (a) Wrap at every level. The byte-identical test goes red.
  - (b) Sign with `kitSummary(merged, {})`. The first and third tests go red.
  - (c) Append the sign to `card`, not to the host. The `:scope > .rl-kit-host > …` selector goes red.

  Commit the two paths with the message `feat(app): the kit sign on the garage rail's icons (WP-S3g plan 2b T6)`.

---

### Task 7: Proof by driving the UI: `ui:routes` legs, `ui:shots` states, and the lead's look (G-P2)

**Model:** sonnet.

**Files:**
- Create: `tools/src/ui-review/kit-icons.ts`, `tools/src/ui-review/kit-icons.test.ts`
- Modify: `tools/src/ui-review/routes-check.ts`, `tools/src/ui-review/shoot.ts`

**Interfaces:**
- `interface Rect { readonly x: number; readonly y: number; readonly w: number; readonly h: number }`
- `interface IconRead { readonly surface: 'chip' | 'card' | 'tile' | 'rail'; readonly type: string; readonly kit: string | null; readonly sign: Rect | null; readonly icon: Rect; readonly locked?: boolean }`. `sign` is null when the sign is absent or not drawn (`display: none` reads as width 0). `icon` is the chip or rail host, or the art when unkitted, or the card frame, or the tile.
- `const SIGN_INSET: Readonly<Record<IconRead['surface'], { rem: number; px: number }>>` gives chip `{0, 0}`, rail `{0, 0}`, card `{0.1875, 1}` and tile `{0.125, 1}`. The `px` is each positioned box's 1 px border, since `top`/`right` measure from the padding edge.
- `function kitIconFailures(reads: readonly IconRead[], expected: Readonly<Record<string, number>>, rootPx: number): string[]`: every failure in words, `[]` when all is well, and `['no icons were read']` on an empty read.

- [ ] **Step 1: Write the failing tests** in `kit-icons.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { kitIconFailures, type IconRead } from './kit-icons';

const ROOT = 16;
const chip = (over: Partial<IconRead> = {}): IconRead => ({
  surface: 'chip',
  type: 'inf_squad',
  kit: '1',
  icon: { x: 100, y: 50, w: 40, h: 40 },
  sign: { x: 120, y: 50, w: 20, h: 20 },
  ...over,
});

describe('kitIconFailures', () => {
  it('passes a sign of the right level, size and corner', () => {
    expect(kitIconFailures([chip()], { inf_squad: 1 }, ROOT)).toEqual([]);
  });

  it('names a wrong level', () => {
    expect(kitIconFailures([chip({ kit: '2' })], { inf_squad: 1 }, ROOT)).toEqual(['chip inf_squad: kit 2, want 1']);
  });

  it('names a missing sign, and a sign where none is due', () => {
    expect(kitIconFailures([chip({ kit: null, sign: null })], { inf_squad: 1 }, ROOT)).toEqual([
      'chip inf_squad: no sign, want kit 1',
    ]);
    expect(kitIconFailures([chip()], {}, ROOT)).toEqual(['chip inf_squad: a sign drawn, want none']);
  });

  it('names a sign drawn at the wrong size for this rem', () => {
    expect(kitIconFailures([chip({ sign: { x: 124, y: 50, w: 16, h: 16 } })], { inf_squad: 1 }, ROOT)).toEqual([
      'chip inf_squad: sign 16x16 px, want 20 (1.25rem at 16 px)',
    ]);
    // --ui-scale 1.15: 20 px is now too small.
    expect(kitIconFailures([chip()], { inf_squad: 1 }, 18.4)).toEqual([
      'chip inf_squad: sign 20x20 px, want 23 (1.25rem at 18.4 px)',
    ]);
  });

  it('names a sign out of the top-right corner', () => {
    expect(kitIconFailures([chip({ sign: { x: 100, y: 50, w: 20, h: 20 } })], { inf_squad: 1 }, ROOT)).toEqual([
      'chip inf_squad: sign top-right at (120,50), want (140,50)',
    ]);
  });

  it('steps the card and the tile in by their border and their own corner margin', () => {
    const card: IconRead = {
      surface: 'card',
      type: 'mbt_lavi',
      kit: '3',
      icon: { x: 0, y: 0, w: 72, h: 72 },
      sign: { x: 48, y: 4, w: 20, h: 20 }, // 72 - 1 border - 3 margin - 20
    };
    const tile: IconRead = {
      surface: 'tile',
      type: 'mbt_lavi',
      kit: '3',
      icon: { x: 0, y: 0, w: 60, h: 60 },
      sign: { x: 37, y: 3, w: 20, h: 20 }, // 60 - 1 - 2 - 20
    };
    expect(kitIconFailures([card, tile], { mbt_lavi: 3 }, ROOT)).toEqual([]);
    expect(kitIconFailures([{ ...card, sign: { x: 52, y: 0, w: 20, h: 20 } }], { mbt_lavi: 3 }, ROOT)).toEqual([
      'card mbt_lavi: sign top-right at (72,0), want (68,4)',
    ]);
  });

  it('requires a locked tile to draw no sign, whatever its type carries', () => {
    const locked: IconRead = {
      surface: 'tile',
      type: 'mbt_lavi',
      kit: '3',
      locked: true,
      icon: { x: 0, y: 0, w: 60, h: 60 },
      sign: { x: 37, y: 3, w: 20, h: 20 },
    };
    expect(kitIconFailures([locked], { mbt_lavi: 3 }, ROOT)).toEqual(['tile mbt_lavi: a sign drawn, want none']);
    expect(kitIconFailures([{ ...locked, sign: null }], { mbt_lavi: 3 }, ROOT)).toEqual([]);
  });

  it('refuses to pass on nothing read', () => {
    expect(kitIconFailures([], { inf_squad: 1 }, ROOT)).toEqual(['no icons were read']);
  });
});
```

- [ ] **Step 2: Run; they fail** on the missing module. Command: `npx vitest run tools/src/ui-review/kit-icons.test.ts`.
- [ ] **Step 3: Implement `kit-icons.ts`.**
  - Its header comment says what it is: the reference-free verdict `routes-check.ts` drives, holding every rule it judges by, so each rule can be falsified without a browser.
  - Checks run in order, one failure per read: presence, then level, then size, then corner.
  - `want = read.locked === true ? 0 : (expected[read.type] ?? 0)`.
  - Size: `wantPx = 1.25 * rootPx`. Pass when `|w − wantPx| ≤ 1` and `|h − wantPx| ≤ 1`. The message prints `Math.round(wantPx)` and `rootPx` as given.
  - Corner: `inset = SIGN_INSET[s].rem * rootPx + SIGN_INSET[s].px`. The wanted top-right is `(icon.x + icon.w − inset, icon.y + inset)`. The actual top-right is `(sign.x + sign.w, sign.y)`. Pass within ±1 on each axis. Print both points with `Math.round`.
  - `1.25` is `KIT_ICON_SIGN.rem`, imported from `../../../packages/app/src/ui/kit-sign`. `garage-seed.ts` already imports app sources this way, so this adds no second constant.
- [ ] **Step 4: Run; they pass.**
- [ ] **Step 5: The `ui:routes` legs.** Add them to `routes-check.ts` before the closing `console errors` check, as one block headed `// --- the kit sign on every icon (WP-S3g plan 2b, T7) ---`. They use `SANDBOX_KIT_LEVELS` (import from `../../../packages/app/src/sandbox-force`), `GARAGE_SEED_ACCOUNT` (already importable from `./garage-seed`), and `kitLevel` and `units` from `@lions/data` for the account oracle. The oracle computes the levels independently; the app reads the prepass. Read the DOM with one string script (string, not function, per this file's own `__name` rule):

```ts
const READ_ICONS =
  '(() => { var out = [];' +
  ' var box = function (e) { if (!e) return null; var r = e.getBoundingClientRect();' +
  '  return r.width > 0 ? { x: r.x, y: r.y, w: r.width, h: r.height } : null; };' +
  ' var sign = function (host) { var s = host ? host.querySelector(".rl-kit-icon") : null;' +
  '  return s ? { kit: s.getAttribute("data-kit"), rect: box(s) } : { kit: null, rect: null }; };' +
  ' document.querySelectorAll(".rl-chip").forEach(function (c) { var s = sign(c);' +
  '  out.push({ surface: "chip", type: c.getAttribute("data-type"), kit: s.kit, sign: s.rect,' +
  '   icon: box(c.querySelector(".rl-kit-host") || c.querySelector(".rl-chip__art")) }); });' +
  ' document.querySelectorAll(".rl-card").forEach(function (c) { var f = c.querySelector(".rl-card__frame"); var s = sign(f);' +
  '  out.push({ surface: "card", type: c.getAttribute("data-type"), kit: s.kit, sign: s.rect, icon: box(f) }); });' +
  ' document.querySelectorAll(".rl-tile[data-unit]").forEach(function (t) { var s = sign(t);' +
  '  out.push({ surface: "tile", type: t.getAttribute("data-unit"), kit: s.kit, sign: s.rect, icon: box(t),' +
  '   locked: t.getAttribute("data-locked") === "1" }); });' +
  ' return { reads: out, rootPx: parseFloat(getComputedStyle(document.documentElement).fontSize) }; })()';
const SELECT_ALL_OWN =
  '(() => { var L = window.__lions; if (!L) return 0; var ids = L.units().map(function (u) { return u.id; });' +
  ' L.sel(ids); return ids.length; })()';
```

  The legs follow. Each opens a **new context**, so a seed never leaks into a later leg (the isolation `garageStates` already uses). Each waits for `window.__lions`, then 400 ms for the 4 Hz HUD rebuild. Each prints its verdict line with `[${TAG}]`, and feeds every failure to `expect(false, …)`.
  - **K1, the ladder on the chips, at 1400 × 900 and at 1920 × 1080.** Use a fresh account and `/free-play/beit_sahwan_outskirts?kit`, then `SELECT_ALL_OWN`. `kitIconFailures(chipReads, SANDBOX_KIT_LEVELS, rootPx)` must be `[]`. At least eight chips must be read. At 1920 the root is 18.4 px, which is the check that the sign follows `--ui-scale`.
  - **K2, the card.** On the same page, select one `mbt_lavi` (`L.units().find(… 'mbt_lavi')`). The card read must pass with `{ mbt_lavi: 3 }`, and the card must hold nine `.rl-kit-pips__pip[data-on="1"]`: the pips and the sign agree. Then select `L.units(1)[0]`, an enemy. The card read must pass with `{}`, meaning no sign.
  - **K3, no layout change.** Two contexts on the same map, one with `?kit` and one without, both with `SELECT_ALL_OWN`. For every chip type in both, the `.rl-chip` heights must be EQUAL, not close. Then do the same for the card on one `mbt_lavi`. This extends the existing "card does not jump" leg (`routes-check.ts:1451-1491`) to the sign.
  - **K4, the account pass, on a mission with a dock.** Use `addInitScript(garageSeedScript())` and `/mission/beit_sahwan_breach`, then `dismissDeployGate(page, TAG)`, then `__lions.step(40)`, then `SELECT_ALL_OWN`. The expected levels are `{ [id]: kitLevel(units[id], tiers) }` for every entry in `GARAGE_SEED_ACCOUNT.upgrades`, which is `mbt_lavi` 3, `inf_squad` 1 and `at_team` 1. The tile, chip and card reads must all pass, with at least one tile read.
  - **K5, a dev flag never changes a mission.** Use a fresh account and `/mission/beit_sahwan_1_recon?kit`, deploy, and `SELECT_ALL_OWN`. `document.querySelectorAll(".rl-kit-icon").length` must be `0`.
  - **K6, what the golden gate sees.** Use a fresh account and `/free-play/beit_sahwan_outskirts` without the flag, then `SELECT_ALL_OWN`. The count must be `0`.
- [ ] **Step 6: The `ui:shots` states.** In `shoot.ts`'s `garageStates`, after `07c`, reuse its seeded page and `LionsWindow` type:
  - `07d-hud-chips-kitted`: `/free-play/beit_sahwan_outskirts?kit`, every own unit selected. This is the ladder, so every level is on the chips at once.
  - `07e-hud-card-kit-sign`: the same page, one `mbt_lavi` selected, with the camera on it.
  - `26-dock-kitted`: `/mission/beit_sahwan_breach` on the seed, deployed with `dismissDeployGate`, `step(40)`, with the dock in frame.

  Update the header's state list and count. Keep each state's skip-on-timeout behaviour.
- [ ] **Step 7: Run it for real.**
  - Run `pnpm ui:routes -- --port=5195`. It must exit 0. Record the wall clock against Task 0's, and the added seconds.
  - Run `pnpm ui:shots -- --only=garage --port=5196 --res=1400x900,1920x1080`. The new states and the moved `03b` (rail signs) and `07c` (card-frame sign) land in `.superpowers/ui-shots/`.
  - Both tools start and stop their own server. Kill nothing else.
- [ ] **Step 8: Falsify in the browser.** Each must be seen red, with the run's output in the ledger:
  - (a) Task 5's (c): drop `kit: kitLevelOf(u.id)`. K4 names every dock tile.
  - (b) `renderChips` drops `own`. K1 names every chip.
  - (c) `.rl-kit-icon svg { width: 1rem }`. K1 fails on size at both resolutions.
  - (d) `bootTiers` always takes the ladder (`mission: false`). K5 counts signs.
  - (e) `.rl-kit-icon { position: static }`. K3's heights differ.

  Undo each by reverting the edit.
- [ ] **Step 9: G-P2.** The coordinator shows the lead `03b`, `07c`, `07d`, `07e` and `26` at 1400 and 1920, with a ×3 crop of one chip and one tile. Record the lead's words. A "no" goes back to G-N2's numbers, never to a world mark.
- [ ] **Step 10: Commit** the four paths with the message `test(ui): ui:routes and ui:shots drive the kit sign on every icon (WP-S3g plan 2b T7)`. The body carries K1–K6's lines, the wall-clock delta, and the seen-red list.

---

### Task 8: Docs, including the rejection and why

**Model:** sonnet.

**Files:**
- Modify: `CLAUDE.md`, `docs/superpowers/specs/2026-09-25-garage-uplift-design.md`, `docs/superpowers/plans/2026-09-26-garage-tier-mark.md` (its status line only)

- [ ] **Step 1: `CLAUDE.md`.**
  - In "Dev instruments", in the flag-reasoning list, add one sentence for `&kit`. It replaces the account's tiers with `SANDBOX_KIT_LEVELS` before the one `upgradePrepass`, so the sim, the HUD card and the unit icons all see the ladder. A mission never takes it (`bootTiers`). It cannot reach the reinforcement dock, which is mission-only, so the dock's sign is proved on plan 1's garage seed instead.
  - Under "The three.js backend", add one bullet: **"There is no kit mark in the world, on purpose."** It records all of the following:
    - It was built (plan 2 T1–T3: a steel plate over the HP bar in `OverlayBatch`, measured at +0 draw calls) and rejected by the lead at the picture gate: *"The mark is ugly maybe it should only show on the icons"*.
    - It was reverted by a new commit (name the sha from Task 1), and `packages/render` is `main`'s bytes.
    - Kit reads on the unit ICONS (chips, card frame, dock tiles, garage rail) through `kitIconSignHtml`, from `upgradePrepass.unitKit`.
    - The sign is DOM, so both backends draw it.
    - Do not reintroduce a world overlay for kit without the lead.
  - Change nothing else.
- [ ] **Step 2: The spec.**
  - Status line: "plan 1 landed; plan 2 built on `feat/garage-tier-mark`, its world mark **rejected at G-P (2026-09-27)** and reverted; plan 2b puts the sign on the unit icons (`docs/superpowers/plans/2026-09-27-garage-kit-on-icons.md`)".
  - Under §3.4's table, add one line: option A was built and rejected on sight, and the kit reads on the icons, at the numbers the lead approved at G-N2 (link this plan's table). This does not affect option B (the kitted GLBs of plan 3, the art phase).
- [ ] **Step 3: Plan 2's status line.** At the top of `2026-09-26-garage-tier-mark.md`, add: "**Superseded in part (2026-09-27).** Tasks 1–3 were built and reverted after the lead rejected the world mark at G-P; Tasks 6–8 were never run; Tasks 4–5 stand and feed plan 2b (`2026-09-27-garage-kit-on-icons.md`)." Do not otherwise edit the plan: it is the record.
- [ ] **Step 4: Check it.**
  - `grep -n "kit mark in the world\|only show on the icons" CLAUDE.md` must find the bullet.
  - `grep -rn "unitKit" CLAUDE.md` must name only `upgradePrepass.unitKit`, never `RendererOptions`.
  - Seen red: before the edit, the first grep prints nothing.
- [ ] **Step 5: Commit** the three paths with the message `docs: the world kit mark was built and rejected; kit reads on the unit icons (WP-S3g plan 2b T8)`.

---

## The visual gate

**What it compares.** The golden gate's captures include the HUD strip, and they boot a **fresh account** in every scenario:
- `quiet`, `open-ground`, `vehicle` and `relief` (sandbox), and `aftermath` (sandbox, `&decals`);
- `combat`, which is report-only and on a mission, `beit_sahwan_3_clearance`.

No scenario selects a unit, so neither chips nor the card are in frame. `combat`'s mission carries `resources`, so its dock is in frame, but at level 0.

**What this branch changes there: nothing, by construction.**
- Task 1 returns `packages/render` to `origin/main`'s bytes, which the current baselines were blessed at (`165eb966`, "re-bless the golden baseline").
- Tasks 3–6 add no element and no byte at level 0. Five byte-identical tests pin this (Tasks 3, 4 twice, 5 and 6), and K6 counts it in the browser.
- No task adds `&kit` or a seed to a scenario (plan 2's R-6 `kit` scenario was never built).

**Expected CI `visual` result:** all five gated scenarios inside their calibrated noise, `combat` reported as usual, and no bless. **If any gated scenario moves, that is a defect in "level 0 draws nothing", not a picture to bless.** Find the byte. Any future bless, for example if the lead later wants a kitted HUD in the gate, is made from CI numbers only, after merge. The local darwin baseline is stale and is never evidence.

**The review captures that DO move:**
- `ui:shots` `03b-brigade-kitted`: the rail signs on `mbt_lavi`, `inf_squad` and `at_team`;
- `07c-hud-card-kitted`: `inf_squad`'s frame at L1;
- the three new states.

These are review evidence (G-P2), not a gate.

## Out of scope

- **Any kit mark in the world**, in any form. This is the lead's ruling.
- **Deploy-spread and brought-panel rows** (S7, S8). They are text rows with no icon. A sign there would be a new surface, which is the lead's call. It would read the account (the prepass has not run at deploy time), so it would need its own source ruling.
- **The control-group bar** (S6). It has no icon, and a group mixes types.
- **Kitted GLBs, plates and close-ups**: spec plan 3, the art phase, after the October Meshy credits.
- **G1's approved sheet** replacing the placeholder glyph. That is one line, `KIT_SYMBOLS`, and every icon follows.
- **A tooltip line naming the kit** on the chip or the dock tile. The sign's `aria-label` carries it for assistive tech. A visible line is a separate copy decision.
- **`HANDOVER.md`'s lane table** (the `ThreeRenderer.ts` lane freed). The controller records it at landing, from a main worktree.

## Self-review

**Brief coverage.**

| Brief item | Where |
|---|---|
| 1. Icon census with `file:line`; recommendation; numbers table approved before code (G-N2) with a mock | the census; G-N2; Task 2 |
| 2. Task 1 is the removal, by revert, byte-identical to `origin/main`, its tests gone | Task 1 Steps 1–6; R-1, R-2 |
| 3. The level from the ONE prepass (`unitKit`), never re-derived; `&kit` shows every level; a mission shows the account's | Global Constraints; Task 4 (`kitLevelOf`); Task 5; Task 7 K1, K2, K4, K5 |
| 4. `ui:routes` and `ui:shots` legs that drive the UI; the visual-gate consequence | Task 7; "The visual gate" |
| 5. Docs: built, rejected, why | Task 8 |
| Keep plan 2 T4 and T5's flag; drop `RendererOptions.unitKit` and the `main.ts` line | R-1, R-2, R-3; Task 1 |

**Every check has an input that makes it fail**, named in its task:
- Task 1: 3 (the byte-identical diff before, `tsc` on the orphaned line, the stale-wording grep);
- Task 3: 6;
- Task 4: 4;
- Task 5: 3 (one of them in the browser, run in Task 7);
- Task 6: 3;
- Task 7: 5 (browser), plus the verdict's own 8 specs;
- Task 8: 1.

**Type consistency.**
- `KitLevel` (`@lions/data`) runs through `UpgradePrepass.unitKit` → `kitLevelOf` → `HudDeps.kitLevelOf` → `DockUnit.kit` → `kitIconSignHtml` and `withKitSign`.
- `KIT_ICON_SIGN.rem` is read by `theme.css` (a test ties the two together) and by `kit-icons.ts` (imported, not restated).
- `ChipView.own` is produced by `groupChips` and read by `renderChips`.

**Placeholder scan.** Two values are filled in from the runs themselves: Task 1's before and after spec counts, and Task 7's wall-clock delta. Each task says where it records them. Nothing is TBD.

**Model tiering.**
- **sonnet:** Tasks 1, 2, 3, 4, 7 and 8.
- **haiku:** Tasks 5 and 6. Their tests are written out and their edits are one insertion each.
- **opus:** the final whole-branch review only, which checks R-6's arithmetic, the byte-identical claims and the five level-0 pins.

Nothing inherits opus by default.

## Execution order

0 → 1 → 2 (**G-N2**) → 3 → 4 → 5 → 6 → 7 (**G-P2**) → 8 → final review (opus) → PR, serially, on this one branch.

- Task 1 runs before G-N2. It is the controller's ruling, it adds no icon code, and it frees the renderer lane as early as possible.
- Tasks 3–8 wait for the lead's G-N2 words. If S4 is struck, skip Task 6 and the `rail` surface.
- Task 4 follows Task 3, because it consumes `withKitSign` and `kitIconSignHtml`. Tasks 5 and 6 are independent of each other, but stay serial, because parallel agents race on the git index.
- Task 7 needs 4–6 on disk. Its browser falsification (a) is Task 5's (c).
- The PR description carries the seen-red record, the G-N2 and G-P2 words, and CI's `visual` numbers. The lead merges.
