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
| 3 | Air units flush on ground | **half done** — lift is a real world height now; **the shadow ellipse was never ported** |
| 4 | Objective zone not drawn | **done** |
| 5 | Three rendered on 1 of 5 maps | **in flight** — `tel_marum` (the only elevation map) has never been drawn by this backend |
| 6 | Six unported overlay passes | **open** — weapon envelopes, shepherd radius, engagement reticles, building integrity + garrison pips, demolition/tunnel-charge progress ring, mobility/firepower-kill pips |
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
