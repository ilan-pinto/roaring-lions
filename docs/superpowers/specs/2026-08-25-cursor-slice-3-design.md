# Contextual cursor — slice 3: the verb, and who is doing it

**Date:** 2026-08-25
**Slice:** 3 of 3. **This closes the cursor milestone.**
**Issue:** #116
**Builds on:** `docs/superpowers/specs/2026-08-25-cursor-slice-2-design.md`
**Status:** approved, pending implementation plan.

## What slices 1 and 2 left

The click decision is a pure resolver. Seven cursor names are drawn from palette-derived SVG, keyed `canvas[data-cursor='name']`. The X refuses an attack on a protected structure without Alt.

But **`cursorFor` is verb-blind**. It reads `armed`, `refused`, `intents.length`, `roe` and two hints — and never looks at what the intents *are*. Demolishing a building, garrisoning it, and attack-moving at it all render the same cursor. The verb identity is computed by the resolver and then thrown away.

So the game still cannot tell a player that the `yahalom_squad` they selected will collapse the tunnel under their pointer. That is the thing #116 opened for.

## This slice does two things

**Names the verb** — garrison, demolish, charge, mount, dismount, smoke join the seven existing names.

**Names who is doing it** — a role badge rides the reticle.

## Three of the ticket's promises cannot be kept, and here is why

Reading the roster against the code found the ticket asking for cursors that have nothing to attach to:

- **`mark_target` and `mark_tunnel` are passive.** No `PlayerIntent` consumes them; they are sim detection that happens because a carrier has line of sight. There is no click, so there can be no cursor. That removes the ticket's `recon_drone` "identify" cursor.
- **`breach` and `hidden_setup` are inert strings.** They appear in unit JSON and `unitTypeFromJson` maps **no boolean** for either. Nothing in the sim reads them. The ticket's `demo_squad` "breach over a wall" cursor needs sim work first, and that is not this slice's.
- **`kamikaze` is not a click verb either.** `isKamikaze` exists as a flag but no order triggers it, so `attack_drone`'s "one-way strike" cursor has no trigger to hang on.

Consequently **three units — `attack_drone`, `heli_peten`, `recon_drone` — have no click-triggerable ability at all.** They can only ever produce move and attack.

The requirement "every unit gets at least one cursor of its own" is therefore met **by badging the generic verbs too**, not only the special ones. A `heli_peten` ordered to move shows a move cursor wearing a gunship badge.

## The badge is a role, not a unit, and that is deliberate

A badge is roughly 10 px riding a 32 px reticle. **Fourteen shapes distinguishable at that size, in motion, while the player is busy, is not a real target** — and this codebase already reached that conclusion once: `packages/app/src/ui/hud.ts:391-403` buckets units into **seven role glyphs** for the inspect card, with a comment calling it a placeholder until the art pipeline produces portraits.

Seven buckets: kamikaze, drone, gunship, sniper, transport, soft, armour.

**The classifier is extracted and shared, not copied.** The HUD and the cursor must agree about what a unit is; two copies would let the cursor call something a transport while its inspect card calls it soft. Same reasoning as slice 2's `zoneContains`: one rule, two callers.

What is shared is the **bucket**, not the rendering. The HUD draws a Unicode glyph in the DOM; the cursor draws an SVG path in a data URI, because font availability inside a cursor image is not something to bet on. The two renderings must read as the same thing, and that is a design obligation the plan states rather than a mechanism.

**The honest cost:** two units in one bucket share a mark. This is a role cursor, not strictly a per-unit one.

## Mixed selections show the heaviest thing that will happen

One click can produce three verbs at once. `sortStructureOrder` splits a mixed selection over a building into demolishers, garrisoners and everyone else, and the resolver emits **demolish, then garrison, then attack-move** — all three, simultaneously.

There is one cursor. It shows the **most destructive** verb:

```
demolish > charge > attack > garrison > mount > dismount > smoke > move
```

The player always sees the worst outcome their click will cause. The cost, stated plainly: it hides that two other groups are also acting, so a player who reads the cursor as the whole story learns an incomplete model. The alternative — showing the first intent — would key the cursor to the resolver's dispatch order, which is an implementation detail rather than a design statement.

### The badge only appears when it is true

The winning verb's group may hold units from different buckets — an `inf_squad` and an `at_team` both garrison, and they are `soft` and… also `soft`. But an `apc_eitan` and an `ifv_namer` are both transports while a `demo_squad` smoking is `soft`.

**If the winning intent's units do not all share a bucket, the cursor shows the bare verb with no badge.** A badge asserts "this kind of unit is doing this"; when that is not one kind, saying nothing is better than picking one.

## Generated at build time, and the numbers say that is fine

Measured, not estimated: the current block is **3,857 bytes for 6 rules**, about **634 bytes each**, the encoded SVG being nearly all of it.

Badged states are role × verb where that role has a unit with the ability — around **36 rules**, roughly **23 KB** of injected style, and SVG text compresses hard. `default` keeps no rule. `blocked`, `costly`, `protected` and `support` take **no badge**: they describe the target or the mode, not the actor.

That is comfortably inside a sane inline-style budget, so **no canvas overlay**. The hybrid's second half is not needed — composition at build time buys the same result with zero lag, no `cursor: none` handling, and no screen-space layer in a renderer that has never had one.

## One thing carried from slice 2, to be closed here

`cursorFor`'s `refused` rung is guarded below but **not above `armed`**: hoisting it over the armed rung leaves every test green. It is unreachable today only because `resolvePointer` early-returns on `armed` before the structure branch can set `refused` — an *implementation* invariant, not a type one.

This slice reorders that chain to add verbs. **It closes the gap with a case pinning `armed` above `refused`.**

## Verification

- The destructiveness ordering, as a table-driven test over every pair.
- The badge-suppression rule: a winning group spanning two buckets gets no badge; a uniform group gets one.
- The shared classifier: one implementation, both callers, with a test proving the HUD and the cursor bucket the same unit identically.
- Every generated rule matches a real DOM node — the check that slice 2 lacked, which is why the cursor could never appear.
- **Mutation, not inspection.** Slice 2's plugin suite killed none of its four mutants. Every new generated rule and every new rung is proved by breaking it.
- Gates: pin unmoved at `1639983699`; `validate:ui` clean; `validate:data` 70; balance and playtest unchanged.

**Not testable, and named as such:** whether seven glyphs read at 10 px in motion, and whether a badge riding a reticle is legible or noise. That is the browser check, and it now has three slices of unverified visual work waiting for it.

## Scope

**In:** verb-aware cursor names; the destructiveness ordering; the shared role classifier extracted from `hud.ts`; badge suppression for mixed buckets; generated badged rules; the `armed`/`refused` guard.

**Out, deliberately:**

- **`breach`, `hidden_setup`, `mark_target`, `mark_tunnel`, `kamikaze` cursors.** Nothing to attach to. Fixing that means giving the sim click verbs it does not have.
- **Per-unit distinct marks.** Seven buckets, for legibility.
- **The canvas overlay.** Not needed once composition happens at build time.
- **Portrait art.** `hud.ts` already marks its glyphs as placeholders for the art pipeline; when portraits land, both callers change together — which is the point of sharing the classifier.
