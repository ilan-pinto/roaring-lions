# Roaring Lions

An open-source, single-player real-time strategy game in the Command & Conquer tradition — 2:1 dimetric, TypeScript + PixiJS — whose distinguishing claim is that combat **simulates real engagement odds** instead of trading hit points. Fights resolve through a detect → hit → penetrate → component-damage chain, and suppression, not damage, is the dominant battlefield force.

All geography and factions are fictional. Enemy forces are defined by military doctrine — tunnels and ambush, standoff fires, mobile raiding — never by ethnicity, nationality, or faith.

## Status — M0 complete

The combat model is the product, and it is calibrated: the backtest harness (`pnpm balance`) reproduces all four validation targets from the design document.

| GDD §5.7 target | Measured |
|---|---|
| Urban assault needs ≈3:1 attacker:defender | 1:1 = 0% · 2:1 = 40% · **3:1 = 85%** · 4:1 = 100% |
| ATGM Pk vs unprotected armour ≈ 0.7 | **0.67** |
| APS intercept 0.6–0.9 vs shaped charge | **0.73** |
| Lanchester's square law emerges | 12v6 → 12.0 survivors (square-law predicts 10.4) |

M1 — three short missions in Beit Sahwan, campaign ledger, ROE scoring, and a playable link here — is in progress.

## Play it

**<https://ilan-pinto.github.io/roaring-lions/>** — the current build, deployed
from `main` on every push (and only when `test:determinism` and the §5.7
backtest pass).

Pick a mission from the menu, or open the M0 sandbox. Left-drag selects,
right-click orders, right-click a building garrisons the infantry that can
enter it. Every roll the model makes is in the feed on the right; `o` hides it.

## Quickstart

```bash
pnpm install
pnpm dev          # M0 sandbox: click to select, right-click to attack-move
```

In the sandbox, every roll the model makes — detection probability, the six hit factors, penetration curve, component result, APS intercept, suppression — streams through the debug overlay. `window.__lions.step(n)` in the console fast-forwards n deterministic ticks.

| Command | What it does |
|---|---|
| `pnpm test` | unit tests |
| `pnpm test:determinism` | 1000-tick replay against a pinned state hash |
| `pnpm lint` | includes mechanical enforcement of the sim invariants |
| `pnpm validate:data` | JSON Schema gate on all content |
| `pnpm validate:assets` | palette + silhouette gate (needs `numpy`, `pillow`) |
| `pnpm balance` | headless backtest against the §5.7 targets |

## Architecture

pnpm workspace, one-way dependency direction: `app → render → sim`, with `data` as a leaf and `tools` alongside.

Four load-bearing invariants (see `CLAUDE.md`):

1. The sim runs a fixed 20 Hz tick; the renderer interpolates.
2. `@lions/sim` is Q16.16 fixed-point — no floats, no `Math.*`, enforced by lint. Trig/exp/Φ come from committed lookup tables.
3. All randomness is a seeded per-entity PRNG — entity counts can change mid-mission without reshuffling anyone's rolls.
4. Commands in → sim → state + events out. Nothing outside the sim mutates sim state.

Determinism is not aspirational: CI replays 1000 ticks on Linux, macOS, and Windows and asserts the same golden hash.

## Contributing

Read `CONTRIBUTING.md` first — units, missions, VFX, and maps are JSON gated by validators; art goes through a locked render rig with a 32-colour palette and a silhouette-readability check. The cost-curve and headless-battle gates mean balance arguments are had with evidence.

Design documents: [`docs/GDD.md`](docs/GDD.md) · [`docs/ART_PIPELINE.md`](docs/ART_PIPELINE.md)

## License

Code is MIT. Art and game data are CC BY-SA 4.0 (see `data/LICENSE.md`). All contributions require a DCO sign-off (`git commit -s`).
