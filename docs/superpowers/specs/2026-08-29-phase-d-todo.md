# What still stands between here and Phase D

**Date:** 2026-08-29 · **Branch:** `feat/three-renderer`
**Source:** `.superpowers/d-readiness-audit.md` plus everything found since.

Phase D is "flip the default". The audit's verdict was **not ready**. This is
the running list, with what has since closed. Ranked by what would hurt a
player most if it shipped wrong.

---

## Blocking the flip

| # | Item | State |
|---|---|---|
| 1 | Five unit types render as nothing | **3 of 5 done** — `sarim_rifles`, `recoilless_team`, `manpad_team` shipped and wired. `attack_drone` (the tutorial hands it to the player) and `rocket_battery` in flight. |
| 2 | Smoke not drawn at all | **done** — verified 29 sim tiles → 29 instances |
| 3 | Air units flush on ground | **done** — lift AND the shadow ellipse (`ThreeRenderer.ts:2645`). The audit said the shadow was never ported and this list repeated it; a five-map walk found a flown `heli_peten` casting it correctly. Corrected 2026-08-29. |
| 4 | Objective zone not drawn | **done** |
| 5 | Three rendered on 1 of 5 maps | **done** — found the scatter defect (#20, since fixed) |
| 21 | `tel_marum`'s five dormant elevation gaps | **done, and NONE is a three-only regression.** Verified against the real elevation-4 walls, reading ground truth from live `sim.elevation`/`sim.blocked` rather than the map text: (1) `raySmoke` is sim-level shared code, cannot be three-only by construction; (2) **VFX-not-lifted is PIXI's bug** — `renderer.ts:2599` uses a flat `isoY(...)-4` with no elevation term, while three's `TracerBatch` was deliberately fixed post-B3.14 to lift by the higher endpoint's ground height. Three is the correct one; (3) extruded terrain fails to occlude units **identically in both** — neither does volumetric occlusion, only per-tile depth-stacking; (4) mid-slope picking works in both, tested with a real click rather than `sel()`; (5) wreck/fx sorting is architecturally real but staged at the map's steepest 4-level drop produced **no visible artifact in either backend**. |
| 20 | **Open-ground scatter renders as flat diamonds** | **open, highest-harm visual defect found so far** — Pixi draws layered blob-plus-highlight rock marks; three draws flat diamonds. Affects the non-`sward` branch, so **4 of 5 maps and every mission on them**. `sim.cover` is identical, so purely visual — but it turns rocky desert into flat plain. Missed by the golden diff because that only ever measured one quiet scene with no open ground at zoom. Start at `three/terrain/scatter.ts`'s `DECOR_KNOLL`/stone-grain branches against `tones.ts`. |
| 6 | Six unported overlay passes | **done** — all six ported and all six seen driving the real server |
| 7 | Escape hatch `?renderer=pixi` | **done and clicked** |

## Instruments that lie

| # | Item | State |
|---|---|---|
| 8 | Golden-diff CI budget is 1.3%, calibrated on a quiet scene | **open** — combat measures 2.1–3.4%; the gate is green only where it was calibrated |
| 9 | Golden diff has never gated a real regression | **open** |
| 10 | `conformance.test.ts` still binds the flat helpers | **open** — B1 said "rewrite the instant elevation is drawn"; elevation has been drawn since B2 |
| 11 | The corrected B4 perf measurement is in a gitignored dir | **open** — the doc telling you not to cite the old table points at a file that is not in the repo |

## Not wired, though the art exists

| # | Item | State |
|---|---|---|
| 12 | Vehicle meshes (`apc_eitan`, `dozer_d9`) | **exported, not wired** — no runtime path, contract extension for hull/turret proposed but not pinned |
| 13 | Building meshes (7 types × standing/wreck) | **exported, not wired** — same |
| 14 | Mesh contract extension | **needs a decision** — hull/turret pivot, and standing/wreck as sibling files |

## Deferred by measurement, not by neglect

| # | Item | State |
|---|---|---|
| 15 | VAT for >460 units | not needed yet — submission is the bottleneck, ceiling measured at ~420–460 |
| 16 | Bundle inverts after the flip | Pixi is a 619 kB static import, three a 652 kB lazy chunk; post-flip every player downloads both |
| 17 | Collapse `MeshBasicMaterial` ground-clip exposure | documented in place, unmeasured |
| 18 | Sticky fog gate on wrecks | fix landed; the "stays visible after fog closes" half is unproven live |
| 19 | Renderer choice persists per ORIGIN, not per tab | observed live; a hazard for a player with two tabs |

---

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
