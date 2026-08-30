# What still stands between here and Phase D

**Date:** 2026-08-29, re-audited 2026-08-30 · **Branch:** `feat/three-renderer`
**Source:** `.superpowers/d-readiness-audit.md` plus everything found since, plus
`.superpowers/phase-d-readiness.md`'s 2026-08-30 re-audit (evidence for every row
below states how it was checked — read that report for the full derivation of
anything terse here).

Phase D is "flip the default". The audit's original verdict was **not ready**.
This list had drifted from the tree: two entries it still marked open (#1, #20)
were closed, and the 2026-08-30 pass found the rest of the "blocking" table
closed too, each **verified by driving a real headless browser against this
worktree's own HEAD**, not by re-reading the commits that claimed the fix.

**2026-08-30 verdict: nothing in the "blocking the flip" table still blocks it.**
Every row below is closed, with fresh evidence from this session. What remains
open is entirely outside that table — see the bottom of this file.

---

## Blocking the flip — all closed

| # | Item | State |
|---|---|---|
| 1 | Five unit types render as nothing | **done** — `attack_drone` and `rocket_battery` both carry `SPRITE_MAP` entries (`packages/app/src/main.ts`) and were spawned side-by-side with the rest of the sandbox force under `?renderer=three`, screenshotted, and visually match the Pixi capture pixel-for-shape (a small drone with rotors; a flatbed with a rocket rack). All 5 originally-listed types are now confirmed drawing something. |
| 2 | Smoke not drawn at all | **done** — re-verified: wrote directly into `sim.smoke` (25 tiles), captured both backends. Three draws the same soft grey/white diamond screen Pixi does, obscuring the units and terrain under it. |
| 3 | Air units flush on ground | **done** — re-verified: a `recon_drone` in frame casts a clear grey shadow ellipse on the ground beneath it; a `heli_peten` flown into frame shows its rotor blades and hull lifted, matching Pixi. |
| 4 | Objective zone not drawn | **done** — re-verified live in `beit_sahwan_3_clearance`: the zone's red boundary outline and the `CONTESTED` HUD banner both draw under three, alongside HP bars, toast log lines and fog-of-war, matching the Pixi capture at the identical sim tick. |
| 5 | Three rendered on 1 of 5 maps | **done** — found the scatter defect (#20, since fixed). `terrain-parity.test.ts` (part of `pnpm test`) renders and palette-checks all 5 shipped maps; this session additionally rendered `beit_sahwan_outskirts`, `tutorial_ground` and `tel_marum` live under three with no error. |
| 20 | **Open-ground scatter renders as flat diamonds** | **done** — `scatter.ts`'s stone-fleck pass now composites `tones.rock`/`tones.rockLit` (never `baseHex` against itself) exactly as the historical fix (`d9fd1c7`) describes. Re-verified two ways this session: (a) a live capture on `tutorial_ground` at zoom 3 shows genuinely textured, multi-tone ground, not flat colour; (b) the bug was **reintroduced** in this tree (the pre-fix `scatter.ts` checked out from `d9fd1c7~1`), the golden-diff gate was run, `open-ground`'s `groundTextureCheck` **failed exactly as designed** (0.9588 ≥ 0.95 budget), the file was reverted, and the gate was re-run to confirm it passes again (0.9408). See item #9 below — this is also the regression-catching proof that item asked for. |
| 21 | `tel_marum`'s five dormant elevation gaps | **done, and NONE is a three-only regression** (unchanged from the 2026-08-29 finding). Re-verified this session: `camera.test.ts`'s `screenToWorldThree is elevation-aware (bugfix)` suite — which reproduces `tel_marum`'s real elevation grid verbatim and asserts three matches Pixi's own elevation-corrected `screenToWorld` tile-for-tile across all 2116 interior tiles, level by level — is gated in `pnpm test` and passes. A live render of `tel_marum` under three (fog live, real relief) produced no error and drew terrain/roads correctly. |
| 6 | Six unported overlay passes | **done** — all six are implemented in `three/units/overlays.ts` (weapon-envelope rings, shepherd radius, engagement reticles, building status, charge progress ring, mobility/firepower-kill pips). Re-verified live: selecting an `mbt_lavi` under three draws both weapon-envelope rings and the selection reticle, matching Pixi's capture at the same tick (Pixi's are smooth ellipses, three's are polygon-approximated rings — a known, deliberate no-antialiasing difference, not a missing feature). |
| 7 | Escape hatch `?renderer=pixi` | **done and re-clicked this session** — live 4-step navigation test: `?renderer=three` boots `ThreeRenderer`; a bare `?sandbox` afterward still boots `ThreeRenderer` (persisted choice survives a link that drops the param); `?renderer=pixi` boots `PixiRenderer`; a bare `?sandbox` afterward boots `PixiRenderer`. Exactly the fix `renderer-choice.ts` describes, confirmed by driving it, not by reading `resolveRendererChoice`'s tests alone. |

## Instruments that lie

| # | Item | State |
|---|---|---|
| 8 | Golden-diff CI budget is 1.3%, calibrated on a quiet scene | **fixed this session** — two new scenarios added to `tools/src/golden-diff/capture-protocol.ts` (`VEHICLE_SCENARIO`, `COMBAT_SCENARIO`) and calibrated in `tools/src/ci/golden-diff-gate.ts` against real headless measurements on this HEAD: `vehicle` (several `beit_sahwan_outskirts` sandbox vehicles at native zoom, tick-aligned) measured 0.774–0.780%/4.747 clean, budgeted 2.4%/12; `combat` (`beit_sahwan_3_clearance`, a real deterministic `attackMove` fight with kills and wrecks) measured 3.70–4.11%/6.85–7.15 clean across three runs, budgeted 7%/14. All four scenarios (`quiet`, `open-ground`, `vehicle`, `combat`) pass together on current HEAD. |
| 9 | Golden diff has never gated a real regression | **proven this session** — the scatter no-op (#20) was reintroduced in the live tree, the gate was run, and `open-ground`'s `groundTextureCheck` failed (0.9588 ≥ 0.95) while the ordinary pixi-vs-three `diffPixelPct` check did **not** discriminate it (2.02% vs a 3% budget — reproducing the documented architectural trap: Pixi's own anti-aliased-blob softness swamps this specific defect's marginal contribution). The bug was then reverted and the gate re-confirmed green. This is the harness catching a real, historical regression, live, in this session's tree — not reused evidence from an old report. |
| 10 | `conformance.test.ts` still binds the flat helpers | **literally still true, substantively closed elsewhere** — `conformance.test.ts` itself was not rewritten and still asserts only `screenToWorldFlat`/flat-mode `screenToWorldThree`. But the gap that sentence exists to name — "screenToWorld conformance on relief has no test" — is closed: `camera.test.ts`'s elevation-aware suite (added by `7695088`, well before this session, but re-run and confirmed passing here) does exactly what B1 asked for, reproducing `tel_marum`'s real relief and pinning exact per-level tile-hit counts against Pixi's own elevation-corrected inverse. It lives in a different file than the sentence names, which is why the literal claim survives even though the concern behind it does not. Left as-is (out of this session's explicit scope to relocate/rewrite `conformance.test.ts` itself). |
| 11 | The corrected B4 perf measurement is in a gitignored dir | **closed 2026-08-30** — `docs/PERFORMANCE.md` now holds a fresh, reproducible measurement of both backends at 65/150/300/400 units (`tools/src/perf/backend-curve-gate.ts`, new this session, drives real headless Chromium against `tools/src/perf/three-units.ts`'s existing `runBackendCurve` harness plus a new `measureThreeMesh` export). Post-flip, post-mesh-wiring, post-vehicle-FX: three beats Pixi's render p95 by 2.3-4.5x at every checkpoint including the GDD's 300-unit target, with or without real mesh units in the scene, reproduced across two independent runs with real hardware GPU confirmed (not the "5-25x" figure quoted below — that number described Pixi's OWN spread between a lightly-loaded and a genuinely-loaded run, a different measurement than a three-vs-Pixi ratio, and should not be conflated with it). Read `docs/PERFORMANCE.md`'s own capture-conditions section before citing either number. |

## Not wired, though the art exists

| # | Item | State |
|---|---|---|
| 12 | Vehicle meshes (`apc_eitan`, `dozer_d9`) | **exported, not wired** — no runtime path, contract extension for hull/turret proposed but not pinned. Not blocking: unaffected units keep their billboard, which is the default path. |
| 13 | Building meshes (7 types × standing/wreck) | **exported, not wired** — same. |
| 14 | Mesh contract extension | **needs a decision** — hull/turret pivot, and standing/wreck as sibling files. |

## Deferred by measurement, not by neglect

| # | Item | State |
|---|---|---|
| 15 | VAT for >460 units | not needed yet — submission is the bottleneck, ceiling measured at ~420–460. **Re-measured 2026-08-30** (`docs/PERFORMANCE.md`): same stand-in harness, real hardware GPU confirmed (headless Chromium defaults to software SwiftShader and must be launched with explicit ANGLE/Metal args to avoid it — cost one full mismeasurement while producing that doc), reproduced across two runs — render budget crossed around ~1,150 figures, not lower than 420–460. Still not needed; more margin than previously recorded, not less. |
| 16 | Bundle inverts after the flip | Pixi is a 619 kB static import, three a 652 kB lazy chunk; post-flip every player downloads both. Not a rendering-parity blocker, but a real page-weight regression worth costing before or shortly after the flip. |
| 17 | Collapse `MeshBasicMaterial` ground-clip exposure | documented in place, unmeasured |
| 18 | Sticky fog gate on wrecks | fix landed; the "stays visible after fog closes" half is unproven live |
| 19 | Renderer choice persists per ORIGIN, not per tab | observed live; a hazard for a player with two tabs. Unchanged this session. |

---

## Verdict, 2026-08-30

**Nothing in the "blocking the flip" table blocks the flip.** Every row was
re-verified this session by driving a real headless Chromium against this
worktree's own HEAD (`d2a8635` plus this session's uncommitted instrument
changes) — screenshots taken, gates run, tests executed, not inferred from
commit messages. `pnpm test` (93 files / 1548 tests), `pnpm typecheck`,
`pnpm lint`, and `pnpm validate:ui` are all green on the current tree.

What is NOT resolved, and is worth naming so the flip decision is made with
eyes open rather than because this list went quiet:

- **The four licensing items** below (`soldier_kolos.fbx`, `mbt_lavi`,
  `jeep_shoded`, `ifv_namer`) are unchanged — not engineering problems, and
  explicitly the project lead's call, not something a flip should wait on
  silently.
- **#11** (perf evidence gap) is real and unaddressed — the flip changes what
  the DEFAULT player's GPU has to render, and the only published cost claim
  at scale is qualitative. Re-running `runBackendCurve` at 300/400 units with
  fog live, before or immediately after the flip, is cheap insurance this
  session did not spend the time on.
- **#16** (bundle inversion) is a real, quantified, unaddressed page-weight
  regression the flip introduces on day one.
- **#19** (renderer choice per-origin) is a minor, known UX rough edge for a
  two-tab player, not a correctness issue.

None of the above is a rendering-parity defect. They are the honest list of
what a "flip is not blocked" verdict does not, by itself, also mean.

## The palette guarantee has a hole, and it is on the Pixi side

**`validate:ui` does not cover `packages/render/src/renderer.ts`.** Its roots
are `packages/app/src` and `assets/campaign`, plus exactly two named files
(`packages/app/index.html`, `packages/render/src/overlay.ts`). The renderer that
actually draws the game is not among them.

**Six off-palette hex literals ship there today:** `#6B6355`, `#1E1F1A`,
`#3A3C33`, `#2E2F28`, `#8B1E12`, `#C9CBC4` — 6 of 19 distinct literals in the
file, checked against all 58 palette entries.

This is not the migration's bug; it predates it. But it has two consequences
that are:

- **Three inherits them by porting faithfully.** `smoke-mesh.ts`'s
  `SMOKE_COLOR` is `#C9CBC4` verbatim, chosen deliberately ("porting Pixi's
  colour choice, not redesigning it"). So the backend whose whole palette
  guarantee is *structural* — a LUT that makes off-palette output
  unrepresentable — now carries an off-palette constant by hand. Nearest entry
  is `gunmetal.0` (`#C3C7C4`), squared distance **52**, which is imperceptible.
- **Any correction becomes a golden-diff difference**, so it wants deciding
  before Phase D rather than after.

The clean fix is to extend `validate:ui`'s roots to `packages/render/src` and
correct Pixi — but `renderer.ts` is byte-identical while the migration is in
flight, so this is recorded rather than done.

## Licensing — four unresolved, and they are the project lead's call

Not engineering problems. Work has been routed around all four; that is not the
same as resolving them.

1. **`art/src/soldier_kolos.fbx`** — embeds a **Synty POLYGON Military** texture
   path. `CLAUDE.md` forbids Synty by name. Committed; nothing builds on it.
2. **`mbt_lavi`** — the main battle tank. Its source
   (`tiger_tank_rigged.blend`, "The BlendSwap Tiger Tank (2013)") is absent
   from disk **and** from git. Its two sheets are **the only 2 of 35 with no
   `credit`**, and — found while porting wrecks — **the only two with no
   `clips` key at all**. Three independent signs those sheets came from a path
   nothing else in this repo used.
3. **`jeep_shoded`** — `render_jeep.py` states *"LICENCE UNVERIFIED — downloaded
   without licence, readme or attribution. Do not redistribute until the terms
   are established."* That text **ships**, threaded into the manifest credit.
4. **`ifv_namer`** — source neither git-tracked nor on disk.

Three of the four ship today.
