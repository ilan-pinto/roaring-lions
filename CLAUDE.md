# CLAUDE.md

Working instructions for this repository. Read `docs/GDD.md` for *what the game is*; this file is *how to work here*.

---

## Project

**Roaring Lions** — open-source dimetric RTS in TypeScript + PixiJS. Deterministic simulation, data-driven content, realistic combat resolution.

---

## The four invariants

These are load-bearing. Violating any of them silently breaks replays, determinism, or future multiplayer, and the breakage will not surface for weeks.

1. **Sim runs at a fixed 20 Hz tick.** The renderer interpolates to 60 fps. Never drive simulation from frame time.
2. **`@lions/sim` uses Q16.16 fixed-point. No floating point.** `Math.*` and `Date.*` are banned inside the sim package and enforced by lint. Use `fx.mul`, `fx.div`, `fx.sin` (LUT-based) from `@lions/sim/fixed`.
3. **All randomness comes from a seeded per-entity PRNG.** `rng(entityId)` — never a global stream, never `Math.random()`. Per-entity streams keep determinism stable when entity counts change mid-mission.
4. **Data flows one direction: commands in → sim → state + events out.** The renderer and VFX subscribe to events. Nothing outside the sim may mutate sim state.

If a task appears to require breaking one of these, stop and raise it rather than working around it.

---

## Package layout

```
packages/
  sim/      deterministic core — imports NOTHING
  render/   Pixi renderer, VFX — imports sim types read-only
  data/     unit/building/mission/vfx JSON + schemas
  app/      shell, input, UI, campaign ledger
tools/      render rig, asset validator, balance sim
docs/       GDD, art pipeline
```

Dependency direction is strictly one-way: `app → render → sim`, and `data` is a leaf. A PR that adds an import from `sim` to anything else is wrong by construction.

---

## Commands

```bash
pnpm install
pnpm dev              # app with hot reload
pnpm test             # unit tests
pnpm test:determinism # replay 1000 ticks from seed, assert state hash
pnpm lint
pnpm validate:data    # JSON Schema check on all content
pnpm validate:assets  # palette + silhouette gate
pnpm validate:ui      # no colour literals in UI source
pnpm balance          # headless battle sim, prints win rates
```

`pnpm test:determinism` must pass before any commit touching `@lions/sim`. It is the canary for invariants 2 and 3.

---

## Code conventions

- TypeScript strict mode. No `any`. No non-null assertions in sim code.
- **Struct-of-arrays over typed arrays in the sim hot loop.** No per-entity object allocation per tick — GC pauses are visible at 400 units.
- Systems are pure functions over component arrays: `(state, dt) => events`.
- Content is JSON validated against `packages/data/schemas/`. Adding a unit means adding JSON, never engine code. If a new unit requires an engine change, that is a signal the data model is missing a concept — extend the schema.
- Tests colocate as `*.test.ts`. Combat maths requires tests; rendering does not.

---

## Adding content

**A unit:** JSON in `data/units/`, validated against `unit.schema.json`, must pass `pnpm balance` within the cost-curve tolerance band, and needs a `.blend` in `art/src/` that survives `pnpm validate:assets` (including the silhouette IoU check).

**A mission:** JSON in `data/missions/`, validated against `mission.schema.json`. Must declare its ledger contract — `requires` and `produces`. Target 12–20 minutes of play.

**A VFX emitter:** JSON in `data/vfx/`, validated against `vfx_emitter.schema.json`. Palette keys only, never raw hex.

**UI:** colour comes from `data/palette.json` like everything else. A Vite
plugin publishes it as `--rl-*` custom properties; `packages/app/src/ui/theme.css`
is the only file allowed to name one, mapping them to semantic tokens (`--ink`,
`--bad`, `--band-mission`). Everything else uses the semantic names or the
`.rl-good`/`.rl-bad` classes. `pnpm validate:ui` rejects a hex or `rgba()`
literal anywhere in UI source, with no allowlist — use `color-mix()` for
translucency. Fonts are self-hosted in `assets/fonts/`; never a CDN.

**A map:** JSON in `data/maps/`, validated against `map.schema.json`. A character grid (`.` open, `1`–`3` cover, `#` building) plus named markers and zones — authorable in a text editor. The loader is `parseMap` in `@lions/data`.

---

## What not to do

- Do not add a game engine, ECS library, or physics library. The sim is hand-written on purpose; determinism cannot be delegated.
- Do not add floating point to the sim, even "just for this one calculation."
- Do not let VFX, audio, or UI state influence simulation outcomes.
- Do not write mission logic as TypeScript. Missions are declarative data; if a mission needs a behaviour the schema cannot express, extend the schema.
- Do not use per-unit A* pathfinding. Flow fields only.
- Do not commit rendered sprites without their `.blend` source.
- Do not generate unit sprites with AI. See `CONTRIBUTING.md`.

---

## Current milestone

**M0 — done.** All four §5.7 targets pass in `pnpm balance`; the determinism hash is pinned.

**M1 — Beit Sahwan.** Three short missions, campaign ledger, ROE scoring, playable link in the README. Build order: map schema + loader → mission runtime (declarative objectives) → ledger → civilians + ROE → just-enough economy → three missions → shell UI. Design first, before code: the behaviour vocabulary (GDD §6) and the map format. No art-pipeline activation, audio, or VFX polish inside M1.

The combat model is the product. Everything else is scaffolding around it.

---

## Dev instruments

- Browser sandbox: `window.__lions.step(n)` fast-forwards n deterministic ticks; `__lions.sim` and `__lions.renderer` are exposed.
- `pnpm balance` runs the §5.7 backtest; `tools/src/backtest/urban-only.ts` is the fast urban-ratio calibration loop.
- The determinism golden hash lives in `packages/sim/src/determinism.test.ts`. It changes only when sim code or tuning changes deliberately — update it in the same commit and say why.
- Combat tuning lives in `packages/sim/src/tuning.ts`. §5.7 targets outrank §5 formula text.

---

## Known scaling debts

- Detection is O(N²) pairs per tick — stagger evaluation before unit counts pass ~150.
- `tunnel_travel` exists in unit data but not the sim; tunnels are a real subsystem the Marj missions need. (`garrison` is fully implemented in both sim and UI.)
