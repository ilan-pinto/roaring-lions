# Elevation E3 — eyes above the dirt

**Date:** 2026-08-24
**Slice:** 3 of 3, and the last. **This closes the elevation milestone.**
**Status:** approved, pending implementation plan.

## The problem E2 left behind

E2 made `losRay` read terrain height, and it works. It is also harsher than anyone intended, because an observer's eyes sit **on the ground**. `h0` and `h1` are bare elevations, so a unit is modelled as a point at dirt level.

Measured during E2's final review:

| arrangement | result |
|---|---|
| two units at elevation 0, fourteen tiles apart, flat | **visible** |
| insert **one** column of elevation 1 between them | **invisible** |
| raise the observer to elevation 1 as well | **still invisible** |

That third row is the problem. Standing on ground level with the rise does not help, because the line descends from 1 to 0 and clips the rise's far shoulder. On a terraced map a unit sees nothing off its own terrace until it is adjacent to the drop.

That is geometrically correct for a zero-height observer. It is also nothing like what *"high ground sees over a rise"* promises, and Tel Marum would have been authored against it.

## The fix is one constant

```
EYE_HEIGHT = 1
```

added to both endpoint heights. Symmetric on purpose: you see a unit's body, and a body has height, so the target's end rises too.

The harsh case resolves exactly. Observer at elevation 1, target at 0, a rise of 1 between: the line now runs from 2 down to 1 and clears the rise rather than clipping it.

## The constraint that must not be broken

**`EYE_HEIGHT` must stay strictly below `BLOCK_RISE`.**

At `EYE_HEIGHT = 2` a flat-ground building becomes `(0 + 2) × total > 2 × total` — false — and **buildings stop blocking sight on every shipped map at once.** Not a subtle regression: every mission, immediately.

The relationship is invisible in the source, where the two sit as unrelated constants that a later tuning pass could move independently. **E3 therefore ships a test asserting `EYE_HEIGHT < BLOCK_RISE`**, with a comment naming what breaks otherwise. It is the cheapest possible guard on a coupling that is otherwise only in someone's head.

## Flat ground is untouched, and the pin proves it

**The determinism pin must NOT move. It reads `1639983699`.**

Verified case by case, as E2's was:

| flat-ground case | comparison | result |
|---|---|---|
| open ground | `0 × total > 1 × total` | false — no block ✓ |
| opaque blocked tile | `2 × total > 1 × total` | true — blocks ✓ |
| endpoint structure | rise 0 → `0 > 1 × total` | false — transparent ✓ |
| low-profile fence | rise 0 → `0 > 1 × total` | false — cover only ✓ |

Every path lands where it lands today. **A moved pin means E3 changed flat-ground sight**, which all eleven shipped missions depend on it not having done.

The pin is a live guard rather than a formality here: E2 established that setting `BLOCK_RISE = 0` makes `test:determinism` fail, so the replay genuinely walks this comparison.

The four rows above are really one fact, stated more strongly than the table lets on. On flat ground `h0 = h1 = EYE_HEIGHT`, so the `(h1 - h0) * k` term in `lineH` vanishes and `lineH = EYE_HEIGHT × total` at every step — the comparison reduces to `rise > EYE_HEIGHT`, independent of `total` and `k`. Since `rise` is either 0 (open ground, endpoint structures, fences) or `BLOCK_RISE` (opaque blocked tiles), flat-ground behaviour is provably identical for *any* `EYE_HEIGHT` in `0 ≤ EYE_HEIGHT < BLOCK_RISE` — not merely for `EYE_HEIGHT = 1`, the value this slice happens to ship. The table above is a sample of that guarantee, not the whole of it.

The lower bound is real rather than decorative: at a negative eye height the same reduction makes `0 > EYE_HEIGHT` true, and **open ground blocks**. The shipped test asserts only the upper bound, deliberately — that is the end a tuning pass could plausibly walk into, where nothing would ever write a negative one.

## What follows for authoring

A consequence worth stating plainly, because Tel Marum will be built against it:

**A single-level rise no longer blocks anyone.** With both endpoints lifted by 1, a one-level feature sits exactly at eye level and the comparison is `1 × total > 1 × total` — false. **Terrain needs two levels or more to obscure ground troops.**

So one-level features become cosmetic — texture, drainage, a terrace edge you can see over — and two-level features become tactical. That is a cleaner authoring vocabulary than E2's, where every bump was a wall, and it is the rule a map author needs before drawing rather than after.

## Two questions closed, not deferred a third time

### Aircraft get no exemption — permanently

Terrain blocks air observers exactly as it blocks ground ones. No `isAir` branch.

This was deferred once by the Sur front design and once by E2. It is now decided, and the reasoning is worth recording so nobody reopens it by accident:

- It is consistent with the two decisions already made — rock blocks everyone, and terrain blocks everyone.
- An exemption is **not pin-neutral**. For aircraft to clear a *building* their altitude must exceed `BLOCK_RISE`, which changes flat-ground sight on all four shipped maps, moves the pin, and requires `pnpm balance` re-run.
- It would be evaluated on maps with no relief. The feature exists for terrain that does not yet exist.

Revisiting it later is a deliberate new change with its own measurement, not an unfinished piece of this one.

### Sight range from elevation is cut

The milestone's original sketch called E3 "sight range" — a unit on high ground seeing *further*. It is cut, and the reasoning is recorded rather than the item silently vanishing:

- `sightSq` is precomputed per unit type and compared as `dSq > oType.sightSq` at three call sites. Making it read height means an effective range computed **per pair, inside the O(N²) detection loop**, in Q16.16 — where E2's rule got to stay in plain integers.
- E2's own profile already put `losRay` on that critical path, and CLAUDE.md schedules a staggering sweep for detection before unit counts pass ~150.
- **Seeing over things is the tactical content elevation was for.** Seeing further is realism, at a per-tick price, and nothing in the Sur front's doctrine asks for it.

If it is ever wanted, it wants its own slice and its own measurement.

## Verification

- `pnpm test:determinism` — **unmoved at `1639983699`**. The gate that matters.
- New relief tests: the three-case terracing measurement above, now with the middle case resolving to visible; and the `EYE_HEIGHT < BLOCK_RISE` assertion.
- `pnpm balance` — five §5.7 figures unchanged; its scenarios are synthetic and flat.
- `pnpm playtest` — red on exactly #96 and #97, its known baseline.
- `pnpm validate:data`, `validate:ui`, `typecheck`, `lint`, `build`.

No new performance measurement. E3 adds one addition to two values computed once per ray — not per tile — so it cannot move the number E2 measured at +1.65%.

## Scope

**In:** `EYE_HEIGHT`, its application to both endpoint heights, the constant-relationship test, the relief tests, and the documentation closing the aircraft and sight-range questions.

**Out, deliberately:**

- **Sight range from elevation.** Cut above, with reasoning.
- **An `isAir` exemption.** Closed above, with reasoning.
- **Slope movement cost.** Still the most invasive piece of elevation and still the least of what it is for. It changes `FlowField.compute`, the pathing core every unit uses every tick.
- **Downhill cover.** Being above someone ought to reduce what a low wall hides from you. A real question, and not this milestone's.
- **Eye height on endpoints that are not bodies.** `losRay` has nine call sites, and four of
  them target something with no body at all: a trail tile (`sim.ts:2333`), route tiles
  (`:2371`, `:2434`), and a building tile (`:2531`). Each now receives `+EYE_HEIGHT` anyway,
  because the constant is applied to both endpoints unconditionally. Inert on flat ground, so
  this slice ships nothing from it. On relief it produces a mild asymmetry: a route sitting in
  a hollow becomes slightly easier to spot, and a building is one level tall to a ray that
  targets it but two to any ray that merely passes it. Whether a route mouth or a building
  deserves a body's eye height is a question about what those rays *mean*, it changes relief
  behaviour, and it wants the measurement the rest of this milestone got rather than a
  same-day fix. Recorded here as a stated property — which is exactly how E2 handled the
  absence of eye height, one slice before E3 fixed it.
- **`raySmoke`'s elevation-blindness.** Smoke pooled in a valley blocks a ray passing six levels above it. Recorded in E2; still deferred.
- **E1's three relief gaps:** VFX are not lifted, extruded terrain cannot occlude units, and picking is untested mid-slope. All inert on flat maps, all recorded in E1's spec, and all first reachable when Tel Marum authors relief.

## After this

The elevation milestone is closed. **Tel Marum is next** — the first map with real ground, authored against a sight model that now has three properties worth knowing before drawing: relief needs two levels to obscure, blocked tiles stand two levels above their own ground, and nothing sees further for being higher.
