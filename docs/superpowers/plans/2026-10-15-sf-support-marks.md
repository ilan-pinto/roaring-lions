# S-F: distinct marks for the mortar barrage and the smoke screen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The barrage and the smoke screen stop borrowing the strike's and the smoke order's marks:
each gets its own dock glyph, arming cursor and aim-ring style, as the lead approved on 15 Oct.

**Architecture:** Two PRs, ring first (mock Q9): **Task 1** (branch `render/support-rings`) gives the
renderer's `aimFootprint` a per-kind style — the barrage adds an inner dashed `vfx.ember` scatter ring,
the smoke screen's ring is recoloured to `limestone.0` — in the existing overlay band 4 (Q7). **Task 2**
(branch `app/support-marks`, stacked on Task 1) adds two new order sights and symbols (`barrage`
"Bursts", `smokeScreen` "Rounds to screen"), points `SUPPORT[kind].mark/.cursor` at them and removes
their `CURSOR_ALIAS` entries.

**Spec:** the approved mock `/Users/ilpinto/dev/roaring-lions-ep/_coord/support-marks-mock/`
(`proposal.md` for the exact geometry, keys, widths and timings of barrage **B** + ring **C** and smoke
screen **A** + ring **A**; `questions.md` Q1–Q10, every recommendation taken; `scripts/` holds the
mock's SVG source for both marks and their cursor frames — the build transcribes them into
`order-sight.ts`'s phase model). Lead's approval: 15 Oct, via the coordinator.

## Global Constraints

- Drone sweep and precision strike: unchanged (Q8).
- Palette keys / tokens only: barrage accent `vfx.ember` (Q5), strike keeps `vfx.fire`; smoke screen in
  the obscurant family (`limestone.0`, `--order-obscurant`). `pnpm validate:ui` passes; `validate:meshes`
  is not involved.
- Rings stay in `OVERLAY_RENDER_ORDER` (band 4) through existing `OverlayBatch.dashedEllipseRing`; no new
  band (Q7). **Record** in a code comment and the PR that a smoke-screen ring aimed into standing smoke
  draws under `SmokeMesh` (band 5), veiled up to 0.72.
- Rings are static (reduced motion untouched). Barrage: outer 2.5-tile dashed `vfx.fire` (today) + inner
  dashed `vfx.ember` at the 1.5-tile scatter (`ROUNDS.mortar_barrage.scatterFx`), 1.5 px, dash 3 gap 3,
  over the `shadow.1` halo. Smoke screen: today's geometry recoloured to `limestone.0`. Strike: unchanged.
- Order sights keep the "phases[0] = rest pose = reduced-motion frame = HUD mark" rule (Q6: the smoke
  screen's cycle keeps each round drawn above its puff after it lands, so frame 0 IS the static mark).
- Colour-vision variants checked by test (`tools/src/cvd.ts` `simulate`/`labDistance`): under
  deuteranopia, protanopia and tritanopia the barrage's two ring tones (`vfx.fire` outer, `vfx.ember`
  inner) and the smoke screen's `limestone.0` vs the strike's `vfx.fire` stay separable, and the new
  marks' accents stay separable from their mains — pin the measured ΔE values with a floor at the
  just-noticeable difference the repo already uses (2.3, D-22) and report them.
- Every new check is seen red by a one-line mutation. App/render only; no sim edits.

## Review Focus

1. **Reduced motion** (`data-motion='reduce'` / the media query): the new cursors show frame 0, the tile
   glyph equals frame 0, the rings do not animate.
2. **The cursor plugin's generated CSS**: every new cursor key has a rule (the plugin test that compares
   `cursorKey` names against generated rules), and no stale alias rule remains for `barrage`/`smokeScreen`.
3. **A smoke screen armed over standing smoke**: the ring still draws (under the smoke), no error.
4. **Pseudo-locale / i18n**: no new strings expected; if any (e.g. a sheet label), through `t()`.

---

### Task 1: per-kind aim rings (branch `render/support-rings`)

**Files:** `packages/render/src/api.ts` (`aimFootprint` gains `kind?: 'strike' | 'barrage' | 'smoke'`
and `scatter?: number` tiles — exact shape the implementer's call, documented), `packages/render/src/three/ThreeRenderer.ts`
(~L10291 ring drawing: style per kind), the ring constants beside `AIM_FOOTPRINT_STYLE`,
`packages/app/src/input/support-call.ts` (`aimFootprint(kind, at)` passes kind + scatter from
`ROUNDS`), tests (a ThreeRenderer overlay test capturing `dashedEllipseRing` calls, `support-call.test.ts`,
and the CVD test in `tools/src/`).

- [ ] Tests: strike → one dashed ring in `vfx.fire` (unchanged); barrage → the 2.5 outer in `vfx.fire` AND
  a 1.5-tile inner in `vfx.ember` with the inner style; smoke screen → one ring in `limestone.0`; sweep →
  none; the CVD separability pins. See red by mutation (drop the inner ring; revert the smoke colour).
- [ ] Gates: `pnpm lint && pnpm typecheck && pnpm test && pnpm validate:ui && pnpm build`. Commit
  `render, app: per-kind aim rings — the barrage's scatter, the smoke screen's obscurant ring (S-F)`.

### Task 2: the barrage and smoke-screen marks and cursors (branch `app/support-marks`, stacked)

**Files:** `packages/app/src/ui/order-sight.ts` (`SightOrderId` gains `barrage` and `smokeScreen`;
`ORDER_SIGHT` entries with families `offensive`/`obscurant`, main/accent keys, phases and periods from
the mock), `packages/app/src/ui/symbol.ts` (`ORDER_IDS`, the mark crop), `packages/app/src/ui/support-kinds.ts`
(`SUPPORT.mortar_barrage.mark/.cursor` → `barrage`, `SUPPORT.smoke_screen.mark/.cursor` → `smokeScreen`),
`packages/app/src/input/cursor.ts` (remove the two `CURSOR_ALIAS` entries; `SIGHT_OF` and
`ANIMATED_CURSORS` gain the two), `packages/app/vite-plugin-cursors.ts` (if it enumerates sights), tests
(`order-sight.test.ts`, `symbol.test.ts`, `cursor.test.ts`, `vite-plugin-cursors.test.ts`,
`support-kinds.test.ts`, chrome/type registers as needed).

- [ ] Tests: each new sight's phases[0] is its HUD mark (Q6); family colours from `ORDER_FAMILY_COLOR_KEY`
  except the barrage accent `vfx.ember` (Q5); the plugin generates a rule per new cursor key and none for
  the removed aliases (Review Focus 2); `SUPPORT` points at the new ids; the four tiles' glyph ids are four
  distinct ids. See red by mutation.
- [ ] Gates as Task 1 plus `pnpm exec vitest run packages/app/vite-plugin-cursors.test.ts`. Commit
  `app: the barrage's Bursts and the smoke screen's Rounds-to-screen marks and cursors (S-F)`.

## Controller close-out

- UI proof on Umm Zeitoun IV (one browser, free port, music off): arm each call (Z Q C V), read
  `canvas.dataset.cursor`, `renderer.aimFootprint`, and photograph the dock row and each armed ring at
  1400x900 and 1920x1080, plus true-size crops of the 18 px tiles and the 32 px cursor frames for Q10's
  picture check (posted in the PR for the lead).
- Golden: no gated scenario arms a call or shows the dock; expect no band to move.
