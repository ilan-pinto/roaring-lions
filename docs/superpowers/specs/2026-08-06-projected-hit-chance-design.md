# Projected hit chance on hover

**Date:** 2026-08-06
**Issue:** [#32](https://github.com/ilan-pinto/roaring-lions/issues/32)
**Status:** approved, ready for implementation planning

## Problem

GDD §5.8 says the combat model is shown, not hidden: *"Hovering a target shows
projected P(hit) with its dominant factors."* The overlay already reports every
factor of every shot — but only in the roll feed, after the round has left the
barrel. The player learns what a shot cost *after* paying for it.

The same section is blunt about why this matters: *"A probabilistic model the
player cannot read is indistinguishable from bad RNG."*

## What already exists

The sim computes the whole thing and throws most of it away.
`fireAt` (`packages/sim/src/sim.ts:1556`) derives six factors — `accuracy`,
`rangeFalloff`, `coverMod`, `motionMod`, `stanceMod`, `suppressionMod` — and
puts them on the `fire` event, which the overlay renders into the roll feed.

So this feature is not a calculation. It is exposing a calculation that already
runs, one moment earlier.

## The shape of `fireAt`

Lines 1566–1590 are pure: they read state and produce a probability. The RNG
roll lands at 1591, and everything from there is mutation — the roll, the
cooldown, the projectile slot, the event.

The split falls exactly on that boundary.

## Architecture

**`hitFactors(shooter, w, target)`** — private, pure, returns
`{ p, accuracy, rangeFalloff, coverMod, motionMod, stanceMod, suppressionMod }`.
Lifted verbatim from lines 1566–1590.

**`fireAt`** calls it, then does what it does today.

**`projectHit(shooter, target)`** — new public method on `Sim`, returning
`{ weaponId, pHit, breakdown, hurts } | null`.

### The one rule

`projectHit` must never touch `this.rng`.

The roll is `this.rng.nextU32(shooter)`. Invariant 3 makes randomness a seeded
per-entity stream; advancing it from a hover would desync every replay and move
the determinism hash as a function of mouse position. The roll stays exclusively
in `fireAt`. This is the single thing most likely to be got wrong, and it is
directly testable: project a thousand times and the state hash must not move.

The extraction itself is pure, so the determinism hash is also the proof that
the split changed no behaviour. If it moves, the refactor is wrong.

## Eligibility — the sim's rules, not new ones

`projectHit` returns `null` unless the shot is one the unit would actually take.
Those conditions are already written down in `selectTarget`
(`sim.ts:1340`), and the projection reuses them rather than inventing a parallel
set:

- target alive, hostile, and not a civilian (side > 1 is never a target)
- not garrisoned and not aboard a transport — a building is in the way
- **`contact >= IDENTIFIED_AT`** — the sim will not shoot at a contact it has
  not identified
- inside the weapon's range band: `dSq <= rangeSq` and `dSq >= minRangeSq`
- line of sight, unless the weapon's class is in `INDIRECT_MASK` (mortar,
  rocket), which needs only a side contact

The identified-only rule therefore falls out of the sim rather than being a
presentation policy. Showing a number for a shot the unit would refuse to take
would be the misleading option, and it would also leak cover and motion detail
about units the player has not yet identified.

`can_target` does **not** gate eligibility. It is not on `WeaponStats`; the JSON
field is parsed into `apsIneffectiveMask` and used for interception only.

## Which weapon

A `mbt_lavi` carries `gun_120` and `coax_mg`, so "the" hit chance is ambiguous.
`projectHit` evaluates every eligible weapon and returns the one with the
highest `pHit`.

Out of range returns `null`, not `0%`. "You cannot reach that" and "you will
almost certainly miss" are different facts, and the panel says which. A
`firepowerKilled` shooter likewise returns `null`.

## The penetration trap

`selectTarget` carries a one-line heuristic for whether a weapon can plausibly
hurt a target: `tType.isSoft || w.penetration >= tType.armorSide >> 2`.

A coaxial machine gun pointed at a tank's front will project a high P(hit) and
achieve nothing. Reporting 85% without qualification would be technically true
and practically a lie — exactly the "indistinguishable from bad RNG" failure
§5.8 warns about.

So `projectHit` returns that heuristic as a `hurts` boolean and the panel marks
rows where it is false. This is deliberately a flag and not a probability:
P(hit) and P(penetrate) are separate stages of the model (§5.2 and §5.3), and
folding them into one number would misrepresent both. The full penetration
model — angle, armour face, ERA, overmatch — stays out of scope.

## Presentation

Hovering an enemy adds a section to the overlay: one row per selected friendly
that can engage it.

Each row: unit name, weapon, `P(hit)` as a percentage, and the **two factors
furthest below 1.0**, named — range, cover, motion, stance, or suppression. Only
factors actually below 1.0 are listed, so a clean shot at close range against a
stationary target in the open lists none, which is itself the useful reading.

`accuracy` is reported separately rather than as a penalty. It is the weapon's
baseline, not a reason the shot is degraded, and listing it among the penalties
would imply the player could do something about it.

Rows cap at six with "and N more", so selecting the whole force does not bury
the map. Units in the selection that cannot engage are counted, not listed —
"3 cannot reach" is useful; three rows of nothing is not.

At `contact === 1` (suspected), the section reports that a firing solution
exists without the number. At `contact === 0` the unit is not drawn at all, so
there is nothing to hover.

This needs a `hoverEntity` field on the renderer, mirroring the existing
`hoverStructure` plumbing (`renderer.ts:177`, set from `main.ts:550`).

## Testing

The load-bearing test is agreement with the sim: for a given shooter, target and
tick, **`projectHit().pHit` must equal the `pHit` on the resulting `fire`
event**. That is what the issue's "reuses the sim's own hit calculation" asks
for, and it is the only test that catches the projection drifting away from the
real one later.

Also:

- projecting many times leaves `hash()` unchanged — the RNG rule
- the determinism golden hash is unmoved by the extraction
- out of range returns `null`; below `minRangeSq` returns `null`
- a `firepowerKilled` shooter returns `null`
- an unidentified target returns `null`
- a shooter with two weapons returns the higher-`pHit` one
- `hurts` is false for a machine gun against a tank and true for the same gun
  against infantry. Note the heuristic measures against `armorSide` whatever
  face is presented, so the test does not depend on facing

Combat maths requires tests; the overlay rendering does not (CLAUDE.md). No
tests for the panel's HTML.

## Non-goals

No penetration probability, for the reason given above.

No change to targeting or to what units choose to shoot. This is a read-only
view of a calculation that already happens.

No hover projection against buildings. `fireAtStructure` has its own simpler
path with no facing and almost no miss; if that wants surfacing it is a separate
piece of work.

No persistent display. The projection appears on hover and goes away, rather
than pinning to a selected target.
