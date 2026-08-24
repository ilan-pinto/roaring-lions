# Contextual cursor — slice 1: one resolver, two callers

**Date:** 2026-08-24
**Slice:** 1 of 3. This slice ships **no visual change at all**.
**Issue:** #116
**Status:** approved, pending implementation plan.

## The feature, so the slice has a frame

`grep -rn cursor packages/app/src` finds only `pointer` and `not-allowed`, on HTML buttons. Over the map the cursor never changes — not for the selection, not for the target, ever. So the game's whole verb vocabulary is invisible: a player holding a `yahalom_squad` has no way to discover it can collapse a tunnel except by right-clicking one and seeing what happens.

The finished feature is a cursor that names the verb: move, attack, garrison, mount, demolish, breach, charge, smoke, and **a big X over anything ROE-protected**. Fourteen units each get at least one cursor of their own, composed as *base shape = the verb, badge = who is doing it*.

**None of that is in this slice.** This slice builds the thing all of it stands on.

## The problem this slice solves

A cursor is the click decision, run on hover instead of on click.

Today that decision is **inline in the `contextmenu` handler**, `packages/app/src/main.ts:809-882`: structure → identified tunnel → else attack-move, with the protected-ROE test written inline and the tunnel lookup done as a hand-rolled linear scan over `sim.tunnelCount`.

Two *inner* splits are already pure functions in `packages/app/src/input/intents.ts` — `sortStructureOrder` (`:131`) and `sortMount` (`:96`) — so the pattern this slice wants already exists in the file it will extend. The outer decision simply never joined it.

Three more verbs are not reachable from the mouse at all. `smoke` (`main.ts:942`), `mount` (`:918`) and `dismount` (`:929`) are keyboard branches, each with its own inline eligibility filter over `renderer.selection`.

And `armedSupport` (`main.ts:646`) is a **second, parallel state machine**: a module-level flag with its own early return in `pointerup`, whose only affordance today is a `data-armed` attribute on a button.

**If the cursor is written as a second code path, it will drift from the first**, and the failure mode is the worst kind: a cursor that confidently promises something the click does not do. Nothing would catch it — there are no tests over the click tree at all.

## The rule

**One pure resolver. Two callers.**

```
resolveIntent(ctx: IntentContext): Intent
```

Sink-free, deterministic, no sim mutation, no DOM. The `contextmenu` handler calls it and dispatches the result; slice 2's hover path calls it and draws the result. There is exactly one place that decides what a click means.

`Intent` is a tagged union carrying the verb, the actor split (which of the selected units do what — several verbs split one selection three ways), and the ROE tier.

The resolver **composes** `sortStructureOrder` and `sortMount` rather than replacing them; they are already the right shape.

### ROE arrives as a tier, not a boolean

The data supports three, and the cursor will need all three (`PROTECTED_ROE = 20`, `packages/sim/src/structures.ts:116`):

| Tier | What | Today's structures |
|---|---|---|
| `protected` | civilians, `roe_penalty >= PROTECTED_ROE`, anything inside a mission's `roe.flagged_zones` | `mosque` (30) |
| `costly` | attackable, and it scores against you | `apartment` (14), `house` (6), `shanty` (2), `warehouse`/`concrete` (3) |
| `free` | no penalty | `wall` (0), enemy units |

`flagged_zones` is per-mission (`beit_sahwan_breach` flags `clinic`), so the tier is mission-aware and cannot be a fixed table.

**This slice computes the tier and returns it. It changes no behaviour** — today attack-move never checks ROE at all, and that stays true here. Slice 2 acts on it.

## Three queries the sim does not expose

Each is read-only, integer-only, and replaces something the app currently does by hand:

- **`tunnelAt(x: number, y: number): number`** — the route id under a tile, or -1. Replaces the inline `for (r = 0; r < sim.tunnelCount; r++)` at `main.ts:857-862`. Mirrors `structureAt` (`sim.ts:1264`), which is already O(1) per tile.
- **`isProtected(structIdx: number): boolean`** — replaces the inline `structureTypes[typeIdx].roePenalty >= PROTECTED_ROE`, which forces the app to import a sim constant to ask a sim question.
- **`garrisonFree(structIdx: number): number`** — free slots, replacing inline arithmetic over `structures.occupants` and `garrisonSlots`.

**Invariant 2 is satisfied trivially:** these are integer lookups and comparisons that never touch `fx.*`. They add no state, so **the determinism pin must not move.**

## Click parity is the gate

This slice's entire success condition is that **nothing observable changes**.

The proof is a parity test over a matrix of selection composition × target kind, asserting the exact command sequence: a mixed selection of demolisher, garrisoner and rifle over a building splits three ways; the same selection over an identified tunnel splits two ways; over open ground it is one attack-move. Every case that reaches a `dispatch` today must reach an identical one after.

There are **no tests over the click tree today**, so these are new. They are also what makes slice 2 safe: once the resolver is under test, the cursor is a display of something already proven.

**A parity test that passes with the resolver returning a constant is worthless.** Each case must be shown to fail when the resolver is wrong — this project has produced four tests that passed with the code under test disabled, two of them on one branch, so the discrimination check is mandatory rather than advisable.

## Fold in the strays

- `smoke`, `mount` and `dismount` become resolver branches, so their eligibility rules stop being three independent inline filters. **Their keybindings keep working exactly as they do now** — this slice changes where the decision lives, not how it is triggered.
- `armedSupport` becomes a branch of the resolver: when a support call is armed, that is what the pointer means, and the resolver says so. The `pointerup` early return stays, but it asks the resolver rather than reading a flag directly.

## Performance

The resolver will run on every `pointermove` in slice 2, so its shape matters now.

`main.ts:717-762` already recomputes hover state on every move, including a full `for (i = 0; i < sim.entityCount; i++)` scan for the nearest enemy, unthrottled, with **no spatial index anywhere in the codebase**. `structureAt` is O(1); `tunnelAt` will be O(routes), bounded and tiny.

**The resolver must not add a second entity scan.** It takes what the existing hover loop already computed. Slice 2 extends that loop; it does not duplicate it.

## Verification

- **`pnpm test:determinism` — unmoved.** The sim gains three read-only queries and no state.
- Parity tests over the click matrix, each proved to fail when the resolver is wrong.
- Unit tests for the three new sim queries, including the empty cases (`tunnelAt` on a map with no tunnels, `garrisonFree` on a non-garrisonable structure).
- `pnpm test`, `typecheck`, `lint`, `validate:data`, `validate:ui`, `build`.
- `pnpm balance` and `pnpm playtest` unchanged — neither drives the mouse.

## Scope

**In:** `resolveIntent` and the `Intent` type in `packages/app/src/input/intents.ts`; the three sim queries; rewiring `contextmenu`, the three keyboard verbs and `armedSupport` to call it; the parity tests.

**Out, deliberately:**

- **Any visual change.** No CSS cursor, no overlay, no art. Slice 2.
- **The fourteen per-unit badges.** Slice 3.
- **Acting on the ROE tier.** The tier is computed and returned; the Shift-to-confirm gate on `protected` targets is slice 2, along with everything that draws the X.
- **A spatial index.** The existing hover scan is O(N) and unthrottled today; making it worse is out, making it better is its own slice, and CLAUDE.md already schedules a staggering sweep for detection before unit counts pass ~150.
- **New sim behaviour.** The three queries expose what the app already computes by hand. Nothing gains a rule it did not have.

## After this

Slice 2 draws it: CSS `cursor:` for the high-frequency states (move, attack, blocked), a Pixi `Container` added to `app.stage` **as a sibling after `world`** — every existing layer including `fogG` is inside `world` and pans and zooms with the camera, so a pointer-tracking overlay cannot live there — and cursor images generated from `data/palette.json` at build time, mirroring `vite-plugin-palette.ts`.

That generation step is not decoration. `validate:ui` scans `.ts`, `.css`, `.html` and `.svg` under `packages/app/src` and `assets/campaign` with no allowlist, so a CSS cursor cannot be an inline SVG data URI carrying a fill colour. Hand-authored image files would sit outside the palette discipline and silently desync from every other colour in the game the first time the palette moves.
