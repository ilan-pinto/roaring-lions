# Weapon-fire VFX — differentiated shot signatures

**Date:** 2026-08-05
**Status:** approved, ready for implementation planning

## Problem

Every shot in the game looks the same, give or take one binary.
`onEvents` branches on `type.isSoft` — a property of the *shooter*, not the
*weapon* — and produces either one small puff or three large ones. Recoil
does the same thing: `isSoft ? 1px : 3px`.

The consequence is that `mbt_lavi` firing its 120mm main gun
(`penetration 1300`) and its coaxial machine gun (`penetration 20`) produce
an identical muzzle flash and an identical recoil. A player watching a
firefight cannot tell what is being shot at them, which contradicts GDD §5.8:
the combat model is meant to be shown, not hidden.

## Goal

A player should be able to tell a rifle from a shell from a mortar at a
glance, and a more powerful shot should present a bigger event.

## What already exists

Three things make this cheaper than it looks.

`data/schemas/vfx_emitter.schema.json` already specifies this feature. It has
a `weapon_fire` trigger, `screen_shake`, `light`, `hit_stop_ms`, four render
layers, `budget_priority`, and particles with `cone_deg`, `gravity_tiles_s2`,
`drag`, `size_over_life` and `color_over_life` on palette keys. One instance
exists — `data/vfx/catastrophic_kill.json`. It is validated by
`pnpm validate:data` and loaded by nothing. The schema was designed and the
runtime was never built.

The `fire` event already carries `weaponId`.

`WeaponStats` already carries `cls`, `penetration`, `damage`, `splash` and
`suppPerMiss`, and `WEAPON_CLASS` is exported from `@lions/sim`.

So this needs no sim change and no data-model change beyond one schema field.

## Architecture

A new module, `packages/render/src/vfx.ts`. It stays out of `renderer.ts`,
which is already about a thousand lines and carries terrain, fog, HUD and
units.

**`EmitterLibrary`** loads `data/vfx/*.json` and indexes by trigger. It knows
nothing about the sim. A missing emitter falls back to the existing generic
puff, so the feature degrades instead of breaking and can land one class at a
time.

**`ParticleSystem`** holds struct-of-arrays pools — a `Float64Array` per
field, matching the sim's convention — and exposes `spawn(emitter, x, y,
dirTurns, magnitude)`, `step(dt)` and `draw(g)`. Capacity is fixed, and
`budget_priority` decides what is culled when the pool is full, as the schema
already prescribes.

**`firePower(weapon) → 0..1`** is a pure function over `WeaponStats`. No Pixi,
no state, no I/O, so it is directly unit-testable.

### Binding emitters to weapon classes

The schema can say an emitter triggers on `weapon_fire` but not *which*
weapon it serves. Add an optional `weapon_class` property to
`vfx_emitter.schema.json`, validated against the `WEAPON_CLASS` vocabulary.

CLAUDE.md is explicit that a missing concept means extending the schema
rather than working around it, so this is a schema change rather than a
filename convention like `weapon_fire_apfsds.json`.

### Data flow

Unchanged in direction, per invariant 4:

```
fire event (weaponId)
  → WeaponStats on the shooter's UnitType
  → cls selects the emitter, firePower() sets magnitude
  → spawn at the muzzle along the firing bearing
```

Nothing in the VFX path reads or writes sim state.

## The power scalar

```
weight = penetration + damage + 300·splash_tiles + 2·suppression
power  = (ln weight − ln 100) / (ln 1900 − ln 100),  clamped to 0..1
```

Log-compressed because raw weight spans roughly nineteen-fold across the
roster. The bounds are fixed named constants rather than derived from the
loaded roster: deriving them would mean that adding one large gun silently
resized every existing effect.

Across the current roster:

| Weapon | class | weight | power |
|---|---|---|---|
| `gun_120` | apfsds | 1900 | 1.00 |
| `warhead` | heat | 1500 | 0.92 |
| `kornet`, `spike_atgm` | atgm | 1320 | 0.88 |
| `mortar_82` | mortar | 1025 | 0.79 |
| `mortar_60` | mortar | 930 | 0.76 |
| `charges` | demolition | 930 | 0.76 |
| `rpg7` | rpg | 890 | 0.74 |
| `amr` | small_arms | 365 | 0.44 |
| `cannon_30` | autocannon | 300 | 0.37 |
| `coax_mg`, `dshk`, `rws_50` | hmg | 175 | 0.19 |
| `pintle_mg` | hmg | 156 | 0.15 |
| `rifles` | small_arms | 112 | 0.04 |
| `carbines` | small_arms | 100 | 0.00 |

The bounds 100 and 1900 are the current roster's actual extremes, chosen so
the scale spans it exactly. They stay fixed as the roster grows; anything
outside clamps. `charges` earns a power value but never uses it, since
`demolition` renders no muzzle effect.

Mortars rank high on splash and suppression despite negligible penetration.
That is the point of the composite, and precisely what a penetration-only
scalar would have got backwards — `mortar_60` would have ranked below
`coax_mg`.

The anti-materiel rifle sits just above the autocannon. This is defensible: a
.50 AMR has a genuinely larger muzzle event than a single 30mm round, and it
still reads as small-arms *character* because character comes from the class,
not the scalar.

`power` modulates flash radius, particle count, light radius, screen-shake
amplitude and recoil distance.

## The nine signatures

Class sets character; `power` sets magnitude. Each emitter is JSON in
`data/vfx/`, palette keys only, never raw hex.

The design rule is that a signature must answer a question the player is
actually asking, not merely look distinct.

| Class | Signature | What it tells the player |
|---|---|---|
| `small_arms` | Single small sharp flash, no smoke, very short life | Someone is shooting; it is no threat to armour |
| `hmg` | Brighter flash, two or three sparks, faint smoke wisp | Sustained automatic fire — the suppression source |
| `autocannon` | Bright flash, short smoke, brief light | Light armour is being engaged |
| `apfsds` | Large white-hot flash, wide cone, muzzle dust ring on the ground, heavy smoke, screen shake | A tank gun fired — the loudest event on the field |
| `heat` | Large flash, fire-toned, splash-tinted | Shaped charge inbound |
| `rpg` | Launch flash plus rear backblast cone | An AT team just revealed itself |
| `atgm` | Modest launch flash, long persistent smoke, backblast | Standoff missile — look for the launch point |
| `mortar` | Low upward puff, large soft smoke ring, minimal flash | Indirect fire, possibly from somewhere unseen |
| `demolition` | No muzzle effect at all | Nothing was shot at you |

The backblast on `rpg` and `atgm` carries the most value. It points backwards
along the firing bearing, so the shape of the signature identifies the weapon
on its own. That serves the GDD's Ashwar validation target directly — an
unspotted RPG team getting its first volley off matters only if the player can
tell what just fired at them, which is what makes recon quality legible.

`demolition` rendering nothing is deliberate. `charges` are placed by
`demo_squad`, not fired, and a muzzle flash would misrepresent what happened.

The three classes with no current user — `he`, `rocket`, `interceptor` — fall
through to the generic puff, so a future unit adopting one breaks nothing.

## Testing

CLAUDE.md holds that combat maths requires tests and rendering does not, so
testing is targeted rather than blanket.

`firePower` gets unit tests. It is pure, and its ordering *is* the design:
assert `gun_120 > mortar_82 > coax_mg > rifles`; assert clamping holds for a
weapon beyond the constants; assert a zero-stat weapon yields neither `NaN`
nor a negative radius. An ordering regression here would be invisible on
screen and still wrong.

Emitter loading gets tests, including the missing-emitter fallback — that
fallback is what makes incremental rollout safe.

`pnpm validate:data` must pass with the extended schema, and every new
emitter must validate against it.

Particle motion gets no tests. It is visual, and asserting numbers nobody can
eyeball proves nothing.

The determinism hash must not move. Nothing here touches sim state; if the
hash moves, something has leaked and the change is wrong by construction.

## Rollout

Each step is independently shippable and leaves the game playable.

1. Extend `vfx_emitter.schema.json` with `weapon_class`; confirm validation.
2. `firePower` with its tests.
3. `EmitterLibrary`, with the generic-puff fallback.
4. `ParticleSystem` with fixed pools and budget culling.
5. Author the nine emitters.
6. Wire recoil magnitude to `power`, replacing the `isSoft` binary.

## Non-goals

No audio. M1 excludes it and the audio module is separate regardless.

No impact, penetration or kill effects. This spec covers `weapon_fire` alone,
though the runtime it builds is what `catastrophic_kill.json` will need later.

No `hit_stop_ms`. The schema supports it, but freezing the frame on every shot
would be unbearable at four hundred units.

## Performance

At around four hundred units in sustained contact, weapon fire is the
highest-frequency effect in the game. Pools are fixed, `budget_priority`
culls under pressure, and `small_arms` is deliberately the cheapest emitter
because it will be the overwhelming majority of spawns.

## Scope note

CLAUDE.md scopes M1 as excluding VFX polish. This work was requested
explicitly with that flagged, and is recorded here so the deviation is
visible rather than silent.
