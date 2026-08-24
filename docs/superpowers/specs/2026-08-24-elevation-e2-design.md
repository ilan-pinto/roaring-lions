# Elevation E2 — line of sight reads height

**Date:** 2026-08-24
**Slice:** 2 of 3 in the elevation milestone (E1 data + render, **E2 line of sight**, E3 sight range)
**Status:** approved, pending implementation plan.

## The problem

E1 gave the game a height dimension and drew it. Nothing reads it. A unit on a four-level ridge sees exactly what a unit in the valley sees, and a force forming up behind a mountain is as visible as one crossing open ground.

**E2 is where mountains start playing rather than merely looking right.** It is also the first slice of this milestone that changes an outcome.

## The rule

`losRay` walks Bresenham from observer to target. At each intervening tile it now compares that tile's **sight height** against the **sight line's interpolated height**, and blocks when the terrain is higher.

The interpolation needs no division and no fixed point. Cross-multiply instead:

```
elev[t] * total  >  h0 * total + (h1 - h0) * k
```

`h0` and `h1` are the endpoint sight heights, `total` is the ray's step count, `k` is steps taken so far. Elevations are 0–9, buildings add 2, and maps are at most 128 wide — so every term stays under about 1,400, four orders of magnitude inside the safe integer range. Invariant 2 is satisfied trivially rather than carefully: these are plain integers that never combine with a `fx.*` quantity, so there is nothing fractional to represent.

`total = max(|dx|, |dy|)` is well-defined because this is classical two-branch Bresenham — the major axis advances exactly once per iteration. `total` is zero only when both endpoints are the same tile, and that ray returns before reaching the comparison. **That safety currently rests on control flow rather than an explicit guard**, so the implementation carries a comment saying so; a future refactor that changed the early return would otherwise divide the design's assumption out from under it.

## Sight height per tile

| tile | sight height |
|---|---|
| open ground | `elevation[t]` |
| **any blocked tile — rock or building** | `elevation[t] + BLOCK_RISE` (2) |
| a structure at either endpoint of the ray | transparent, unchanged |
| low-profile structures (fences) | add cover, never block, unchanged |

### Why one rule for all blocked tiles

The design first gave rock `elevation[t]` alone, on the reasoning that rock's drawn height *is* its elevation — a `^` tile at elevation 3 draws 30 px up with a flat top, so a blocking bonus would claim height the renderer does not draw, which is the exact lie E1 existed to end.

**That rule had a latent bug.** Two units on a plateau at elevation 3, with a rock outcrop also at elevation 3 between them, would see straight through it: `3 > 3` is false. A solid, impassable ridge becomes transparent. It is inert against the four shipped maps — none contains a `^` tile — and wrong the moment Tel Marum is authored.

Giving every blocked tile the same `+2` fixes it and simplifies the design to one rule:

- rock at elevation 3 blocks units standing on that same plateau (`5 > 3`);
- from a peak at elevation 4, a ridge down in the valley is still see-over-able, because the sight line to a low target passes above `0 + 2`.

It is also honest to the drawing. Rock's scatter blobs sit proud of their tile and a building draws 18 px above its own — about two levels at E1's 10 px per level, which is where the constant comes from.

## Aircraft are not exempt

Terrain blocks air observers exactly as it blocks ground ones. No `isAir` branch, no altitude constant, nothing in the hot loop.

This is consistent with the Sur front's existing decision that rock blocks everyone, and with its reasoning: recon into Sur should mean crossing the ridge into MANPAD range rather than standing off behind it. Realism is the cost — a drone at altitude would see over a ridge — and the doctrine leans on the player *not* having looked.

Revisit in E3, which already touches sight and elevation, and by then Tel Marum exists to measure whether the drone is dead weight or merely repositioned.

## Flat ground comes out bit-identical, and that is the gate

**The determinism pin must NOT move.** It reads `1639983699`.

This is the inverse of E1, which moved the pin once because a new array joined the hash while behaviour held. E2 changes behaviour only where relief exists, and the pinned 1000-tick replay runs on a flat map.

The reasoning, verified branch by branch rather than asserted:

- Every shipped map omits `elevation`, so all elevations are 0.
- Open ground: the right-hand side interpolates between two endpoint heights that are each ≥ 0, so it is never negative, and `0 > RHS` is never true. Open ground never blocks.
- Buildings: `2 × total > RHS` holds whenever `total > 0`, which is always, so buildings block exactly as today.
- No shipped map contains a `^` tile, so rock's changed semantics touch nothing.
- The endpoint-transparency rule, `lowProfile`, the smoke early-return, cover accumulation, and same-tile or adjacent-tile rays are all untouched paths.

**So a moved pin means E2 changed flat-ground sight, which is a bug — not a value to update.**

## The fixture is mandatory, not advisable

E1's ledger recorded that E2 would need relief in the test corpus. The section above sharpens that from advice into a requirement: **on flat ground E2's new code path is provably never taken.** `pnpm test`, `pnpm balance` and `pnpm playtest` would all pass with the rule implemented backwards, because the input is uniformly zero everywhere it could be read.

E2's tests therefore construct relief explicitly and assert **both directions**:

- a unit on high ground sees a target that a unit on the valley floor cannot;
- a ridge between two low units blocks them;
- two units on a plateau are blocked by rock at their own elevation — the case that falsified the first rock rule;
- a peak sees over a low ridge, the property the whole design is for.

`packages/sim/src/elevation.test.ts` already builds relief and is the natural home.

## What this buys

Dead ground becomes real. A force forms up in a valley unseen; a unit on a ridge sees the approach and the valley floor does not see it back. That is the Sur front's stated premise — *"fields of fire and dead ground, because dead ground is where a force forms up before crossing the last three hundred metres"* — and E2 is the first time the game will actually have it.

## Verification

- `pnpm test:determinism` — **unmoved at `1639983699`**. The gate that matters.
- `pnpm balance` — five §5.7 figures unchanged; its scenarios are synthetic and flat.
- `pnpm playtest` — red on exactly #96 and #97, its known baseline.
- New tests proving both directions of the rule on authored relief.
- `pnpm validate:data`, `validate:ui`, `typecheck`, `lint`, `build`.
- **Measured cost.** `losRay` is called from ten sites including `detectionPair`, inside a detection loop the project's own notes flag as O(N²) per tick.
  - **300 units:** 4.8613 ms/tick with the height check, 4.7826 without → **+1.65%**
  - **65 units** (the largest authored mission's size): 0.19235 vs 0.1877 ms/tick → **+2.48%**
  - **Verdict: noise.** Both deltas are smaller than the observed run-to-run spread — about ±5% at 300 units and ±15–20% at 65. No action.

  Three qualifications, because a number without its conditions is not a measurement:

  1. **The comparison is clean, and here is why it is.** The "without" reading was taken by commenting out the height checks. On a flat map `lineH` is 0 and the open-ground condition reduces to `0 > 0`, which is always false — so the check never returns early there, and both configurations walk exactly the same tile sequence. The only difference measured is the added multiply-and-compare.
  2. **On relief the cost should fall, not rise.** Once maps carry elevation, the check *can* return early, letting the walk skip tiles it would otherwise cross. That narrows the gap rather than widening it. Note also that no shipped map has an `elevation` field today, so the flat scenario is fully representative of current content.
  3. **A weakness worth stating.** The two configurations were separate process launches with no interleaving, so systematic drift between passes — thermal, background load — is mitigated by wide measurement windows but not ruled out. The machine was shared and unquiet.

## Scope

**In:** the `losRay` height comparison, `BLOCK_RISE`, the `total > 0` comment, and the relief tests.

**Out, deliberately:**

- **E3 — sight range reading height.** A unit on high ground seeing *further*, as opposed to seeing *over*. Its own slice.
- **Slope movement cost.** Still the most invasive piece and still the least of what elevation is for.
- **An `isAir` exemption.** Decided above; revisit in E3.
- **Cover behaving differently when shooting downhill.** A real question — being above someone ought to reduce what a low wall hides — and not this slice's.
- **`raySmoke` reading height.** Smoke is checked before the height comparison and is itself elevation-blind: smoke pooled on a valley floor blocks a sight line passing six levels above it, and smoke sitting on a peak does not blanket the valley below it. Real, and not this slice's.
- **The deferred E1 items:** VFX are not lifted, extruded terrain cannot occlude units, and picking is untested mid-slope. All inert until relief ships and all recorded in E1's spec.

## There is no eye height

`h0` and `h1` in `losRay` are bare ground elevations — an observer's eyes sit at ground level, not some fraction of a tile above it. Measured directly:

- Two units at elevation 0, fourteen tiles apart, flat ground: **visible.**
- Insert one column of elevation 1 between them: **invisible.**
- Raise the observer to elevation 1 as well, level with that column: **still invisible** — the line now descends from 1 to 0, and it clips the rise's far shoulder on the way down.

So on a terraced map a unit standing on its own terrace sees nothing on the terrace below until it walks up to the drop and looks over the edge. That is the geometrically correct consequence of a zero-height observer, and it reads as considerably harsher than "high ground sees over a rise" suggests — the schema's own authoring guidance of a 0–4 elevation range will produce this constantly, not as an edge case.

This is a stated property of E2, not a defect in it. Giving observers a nonzero eye height is a balance change, and it belongs with E3 — where sight range is on the table too — measured against a real authored map rather than the synthetic fixtures here. Whoever authors Tel Marum should meet the terrace behaviour above as a known rule, not as a surprise to debug.
- **Any map authoring.** Tel Marum comes after E3.
