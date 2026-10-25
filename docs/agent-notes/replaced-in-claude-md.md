# Passages of CLAUDE.md replaced when it was slimmed

Moved verbatim from `CLAUDE.md` (origin/main `f946bb16`, 2026-10-25) when that file was slimmed to its rules.
The rules distilled from these passages stay in `CLAUDE.md`; this file keeps the measurements, history,
reasoning and superseded statements behind them, unedited. Nothing here has been pruned yet.

<!-- CLAUDE.md lines 55-77, section "Commands / Current milestone" -->

## Commands

```bash
pnpm install
pnpm dev              # app with hot reload
pnpm test             # unit tests
pnpm test:determinism # replay 1000 ticks from seed, assert state hash
pnpm lint
pnpm validate:data    # JSON Schema check on all content
pnpm validate:meshes  # the art gate: palette + silhouette IoU on art/meshes/**, rendered headlessly
pnpm kit:meshes       # graft art/parts/kit/<id>.glb into the vehicle GLBs (then wreck:meshes, damage:meshes, encode:meshes)
pnpm damage:meshes    # cut real damage into the WRECK_ twins (after wreck:meshes, before encode:meshes)
pnpm kit:capture      # in-game kitted-vehicle sheets, the `kit` toggle reading, the garage turntables
pnpm validate:ui      # no colour literals AND no bare chrome strings in UI source
pnpm ui:routes        # drive the shell: one JS realm, two missions, no reload (60-74 s local, ~130 s on CI: no GPU there)
pnpm balance          # headless battle sim, prints win rates
pnpm versus:probe     # report-only: who wins a versus map when both seats attack-move (west/east, KDF/Sarim); the bar for opening a map (#561)
```

`pnpm test:determinism` must pass before any commit touching `@lions/sim`. It is the canary for invariants 2 and 3.

---


<!-- CLAUDE.md lines 197-206, section "Commands / Current milestone" -->

## Current milestone

**M0 — done.** All four §5.7 targets pass in `pnpm balance`; the determinism hash is pinned.

**M1 — Beit Sahwan.** Three short missions, campaign ledger, ROE scoring, playable link in the README. Build order: map schema + loader → mission runtime (declarative objectives) → ledger → civilians + ROE → just-enough economy → three missions → shell UI. Design first, before code: the behaviour vocabulary (GDD §6) and the map format. No art-pipeline activation, audio, or VFX polish inside M1.

The combat model is the product. Everything else is scaffolding around it.

---
