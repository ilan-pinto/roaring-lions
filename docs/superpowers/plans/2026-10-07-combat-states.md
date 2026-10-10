# Combat states: readable suppression and damage (pass C2/C4), build plan

**Spec:** [`docs/polish/combat-states.md`](../../polish/combat-states.md) (#435), approved by
the lead on 7 Oct 2026: D1–D5, P1–P5 (P5 optional, off under reduced motion), A1, R1.
**Branch:** `polish/combat-states`. Presentation only: nothing under `packages/sim` changes.

Each task ends with a review: the task's own diff is re-read against the spec line it
implements, the gates named in it are run, and any new check is shown red by a one-line
mutation before it is trusted. The review notes go in the commit message.

| # | Task | Spec | Gates | Review |
|---|---|---|---|---|
| 1 | Audit rows PA-31, PA-32, PA-33; this plan | R1 | none (docs) | rows match the audit table's columns and priority rule |
| 2 | **The pinned huddle.** `motion/pinned.ts` (`--step=pinned`), every infantry GLB with `down`/`wreck` regenerated motion → gait → encode; `resolveClip` plays `pinned` and never `down`; contract v6 | P1 | `living_not_wreck.test.ts` (red on main: 14 drawn files); `mesh_gait.test.ts` (facing, ground with `pinned` as a living clip); `validate:meshes`; `encode:meshes --check` | a pose sheet of every team, pinned beside wreck, rendered through `render_clip_pose.py`'s rig |
| 3 | **The suppression lean.** A runtime additive on spine, neck and head, weighted by suppression from 0.15 to 0.70, and a fixed forward pitch for a broken unit running | P2 | pure tests for the weight curve; render tests | the lean is zero below 0.15 and capped at 0.70; it never touches the legs (kneel and wedge intact) |
| 4 | **Damaged-vehicle smoke.** `data/vfx/damaged_smoke.json` (palette keys), registered in `vfxEmitters`; a living vehicle with a mobility or firepower kill trails thin smoke; dust and exhaust stop on a mobility kill | P3 | `index.test.ts` (emitter registered), `validate:data`, a pure cadence test | palette keys only; the reserved vfx range |
| 5 | **World overlays.** The suppression bar draws only for a selected or hovered unit; the 3 px mobility and firepower dots are retired | P4 | `overlays.test.ts` | nothing new drawn in the world |
| 6 | **Combat state model + card.** `ui/combat-state.ts` (bands, aim penalty, recovery and break clocks from sim constants and the `pinned` event tick); the card's condition line, suppression meter and hp words | D1–D3 | pure tests: band edges 0.15/0.45/0.70, hysteresis, recovery against the sim's own decay, the break clock; `validate:ui` | no percentage left on the card; every string through `t()` |
| 7 | **Chips and marks.** Two status marks (immobilised, gun out) in `symbol.ts`; chip precedence broken › pinned › out of action › gun out › immobilised › suppressed › shaken › …; the muted second clause | D5 | `selection-model.test.ts`, `symbol.test.ts` | marks follow the G1 rules (filled, 24 box, currentColor) |
| 8 | **Fire panel.** them / us grouping; the target-pinned note; the no-solution reason split (gun out, out of range, too close, no line of sight) | D4 | `fire-panel` tests | the split is derived app-side and is exact against `projectHit` |
| 9 | **Alerts and voice.** `routed` (own) and vehicle component kills at the `important` tier (#428/#426 names); voice keys `common.broken`, `common.immobilised`, `common.gunDown` as drafts with `variants: []` | A1 | `alerts.test.ts`, `validate:audio` | throttles as the death calls; no new screen or mix effect |
| 10 | **Near-miss flinch (optional).** A 0.3 s pitch pulse on a suppressed or pinned infantry figure within 1.2 tiles of a near miss; off under reduced motion | P5 | a pure test of the pulse | off under `data-motion=reduced` |
| 11 | Evidence (before/after GIFs: pinned vs dead, the lean, the broken run, the smoke), full gates, PR | — | `pnpm test`, `typecheck`, `lint`, `validate:ui`, `validate:data`, `validate:meshes`, `validate:audio`, `encode:meshes --check` | the visual gate is expected to move on CI; nothing is blessed |
