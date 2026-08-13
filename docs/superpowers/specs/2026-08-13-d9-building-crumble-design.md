# D9 building crumble — design

**Date:** 2026-08-13
**Status:** designed; not implemented

## What this is

A D9 levelling a building does not touch it. `stepDemolition` counts ticks and calls
`destroyStructure` directly; the structure's HP never moves and no `structureHit`
event ever fires. The building stands pristine for two seconds and then vanishes.

This adds the missing notion — the blade *hits* the building — so it visibly crumbles
as the dozer works, and so damage the building has already taken counts toward
bringing it down.

The machinery mostly exists. Buildings carry HP; `damageStructure`
(`packages/sim/src/sim.ts:2674`) emits `structureHit` and collapses the structure at
zero; the renderer already darkens a battered building along an alpha ramp
(`packages/render/src/renderer.ts:1229`) and throws dust. Demolition is simply the one
path that bypasses all of it.

## The engine changes

### Schema

One new optional top-level key in `data/schemas/unit.schema.json`, which is
`additionalProperties: false` and so must declare it:

```json
"demolition_method": {
  "enum": ["charges", "blade"],
  "default": "charges",
  "description": "How this unit takes a building apart. `charges` sets satchels and the building goes down at once when the timer expires. `blade` grinds: it drains structural HP every tick, so the building crumbles as it works and damage it has already taken counts. Absent means `charges`, which is what every demolisher did before the field existed."
}
```

`dozer_d9.json` gains `"demolition_method": "blade"`. Every other unit is untouched
and resolves to `charges`.

This is the concept the data model was missing — *how* a unit takes a building apart,
alongside the `demolition_time_s` that says how long it takes. Branching on role, or
on the unit having no weapons, would be engine code encoding a content distinction,
which CLAUDE.md names as the signal that the schema is short a concept.

Sappers keep their all-or-nothing collapse deliberately. A satchel charge visibly
nibbling a wall for five seconds reads wrong, and the demo squad's tension — hold
station under fire with nothing to show for it until it blows — is the point of the
unit.

### The blade path

Everything above target selection is unchanged: the `PROTECTED_ROE` guard, the
friendly-garrison skip, the `demolish` designation, and move-cancels-designation all
sit earlier in `stepDemolition` and apply to both methods. Only the tail splits.

Each tick a blade demolisher holds station on structure `s`:

```
bite = fx.div(maxHp[s], fx.fromInt(type.demolitionTicks))
damageStructure(s, bite, i)
```

`fxDiv` is exact and truncates toward zero at these magnitudes, so the bite is stable
and identical on every machine. Attribution, ROE, and collapse all flow through the
path `damageStructure` already owns.

**The timer still fires.** On reaching `demolitionTicks` the structure is destroyed
outright, exactly as today. This is not redundant: because the bite truncates, N bites
sum to slightly *under* `maxHp`, and without the timer the building would survive an
extra tick or two and the pinned 40-tick contract would drift. The timer stays
authoritative for *when it falls*; the HP drain is the visible consequence of it
falling.

**A pre-damaged building falls early.** One shot down to 40% dies at tick 16 of 40,
through `damageStructure`'s own `hp <= 0` check. No new code — it is what scaling the
bite to `maxHp` rather than remaining HP buys.

**Damage persists; the timer does not.** A dozer that grinds a house to 60% and drives
off leaves a 60% house standing. `demoTicks` resets as it does today, so returning
restarts the timer, but the HP is already gone and the second visit finishes in 24
ticks rather than 40. Charges keep today's behaviour: walk away and the work is lost.

### `demolitionProgress`

Branches with the method. Blade reports `1 - hp/maxHp` of its current target; charges
keep the timer ratio. For a fresh building the two are identical, so nothing visibly
changes — but on a pre-damaged one the blade's bar correctly starts partway along
instead of promising two more seconds of work that will not happen.

### Events stay truthful

The sim emits a `structureHit` every tick the blade is working, because that is what
is happening. Banding and throttling are presentation policy and live in the renderer;
pushing them into the sim would put display concerns behind invariant 4's one-way data
flow.

## Presentation

### Banded terrain redraw

`structureHit` currently sets `terrainDirty` unconditionally, and `drawTerrain` clears
and rebuilds every tile plus all building, decor, and wreck sprites. At 20 Hz that is a
full map rebuild every tick for the length of the demolition.

Track a last-drawn integrity band per structure (eighths) and dirty terrain only when
the band changes. This is a strict improvement beyond the D9 — a shell shaving 2% off a
warehouse stops forcing a full rebuild too. Eight steps across the existing `1.0 → 0.55`
alpha ramp is fine-grained enough to read as continuous crumbling.

### Dust from the blade, not the roof

The renderer must tell blade work from shellfire without the sim leaking presentation
into its events. It already reads `sim.state` arrays read-only, so expose `demoTarget`
there. When `state.demoTarget[e.by] === e.structure`, the hit is blade work: puff at
the dozer, throttled to roughly every fourth tick, jittered with the existing
deterministic `h2`. Shellfire keeps its current puff at the building centre.

"Every fourth tick" is counted per structure, not per emitting unit, so two dozers on
one building do not double the dust.

### Combat log

`overlay.ts` logs a line per `structureHit`, which at tick rate is forty lines of
`"house takes 30 — 570 left"` for one demolition. Coalesce: accumulate damage per
structure and emit a line only on a band crossing — the same eighths the renderer
uses, so there is one notion of a band — with the suppressed hits summed:
`"house takes 300 — 900 left"`. A 2 s demolition yields eight lines instead of forty.

## Tests

Sim-side, in `packages/sim/src/demolition.test.ts`. Rendering stays untested per
CLAUDE.md; the banding and dust are verified by driving the running app.

- A blade unit still levels a fresh building in exactly 40 ticks — the timing contract
  survives the rewrite.
- HP drains monotonically while it works, and `structureHit` events fire.
- A building pre-damaged to 40% falls proportionally early, attributed to the dozer.
- Partial work persists: grind, order away, HP stays down; return and it finishes in
  the remaining ticks rather than a fresh 40.
- A `charges` unit's target holds full HP until the moment it collapses. This is the
  regression guard on the split — without it, a later refactor that unified the two
  paths would pass everything else.
- The protected-site guard still holds on the blade path: a blade demolisher parked
  beside a shrine does not grind it down on its own initiative.

### Determinism

No existing unit resolves to `blade`, so `pnpm test:determinism` must pass with the
golden hash **unchanged**. A hash change here means something leaked into the charges
path — that is a bug to fix, not a hash to update.

`pnpm validate:data` covers the schema addition. `pnpm balance` should be unaffected —
the D9 carries no weapons — but this is to be confirmed by running it rather than
assumed.

## Out of scope

- **No new art.** Crumbling is the existing alpha ramp, not mid-damage sprite frames.
  Authoring a damaged frame for each of the six buildings is a render session apiece
  plus manifest and loader work, and CLAUDE.md scopes M1 as no art-pipeline activation.
- **No per-tile collapse.** A footprint shrinking tile by tile as the dozer eats it
  would touch flow fields, cover values, and garrison capacity. The whole structure
  crumbles as one.
- **Garrison behaviour is unchanged.** Occupants still die on collapse with no chance
  to bail as the building comes apart around them. That is already true today, so it is
  not a regression — but it is now more visible, and worth naming rather than fixing
  here.
- **No audio.**

## Alternatives considered

- **Flat blade DPS**, authored as damage per second or a `demolition`-class weapon.
  Physically more honest — a shanty falls fast, a concrete block takes real work — but
  `demolition_time_s` loses its meaning, the two pinned demolition tests need
  rewriting, and the D9 needs a fresh balance pass. Rejected as a larger change than
  the bug warrants; the door stays open, since the bite is computed in one place.
- **Cosmetic-only crumble**: keep the timer authoritative and emit `structureHit`
  carrying the timer's progress purely so the renderer can dim. Cheapest, no balance
  risk, but HP would be a lie — a half-demolished building shot by a tank would still
  report full integrity, and the pre-damage interaction would not exist.
- **Everything grinds**, with no schema field. One code path and no per-unit branch,
  but it gives satchel charges a visible nibble and leaves a partially-charged building
  permanently damaged after the sapper walks away.
