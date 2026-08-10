# Enemy technical — design

**Date:** 2026-08-10
**Status:** phase 1 built; phase 2 (mounted delivery) not started

## What this is

The enemy gets its armed pickup drawn, and declares the transport capacity that
makes it a threat rather than a gun platform.

`technical` already existed in `data/units/enemy/technical.json` — an "Armed
Technical", faction `rif`, DShK-class HMG (25 mm penetration, 40 damage, 9 tiles),
600 hp, 15/10/10 armour, crew 3, cost 331, and the fastest thing on the field at
2.6 tiles/s against the Eitan's 1.8. What it lacked was any art at all: it is
spawned in the M0 sandbox and in all four Beit Sahwan missions, and with no
`SPRITE_MAP` entry it drew as the renderer's procedural blob.

So this is not a new unit. It is the sprite that unit never had, plus
`transport_slots: 3`.

## Scope, and the split

The request — "a white tender truck with a machine gun that can load 3 infantry" —
decomposes into two pieces with very different risk profiles:

1. **The vehicle** (this spec). Art, art tooling, and one renderer fix. No sim.
2. **Mounted delivery** (deferred). Making "carries 3" mean anything for an
   AI-driven unit.

The second is deferred because `transport_slots` on an enemy unit is **currently
inert**, and that was established on evidence rather than assumed:

- `placement` in `mission.schema.json` accepts `unit, count, at, marker,
  facing_deg, group, tag, stance` — no passengers.
- `stance.kind` is only `hold_position | ambush | patrol | garrison`.
- the sole code path that increments `passengers[]` (`sim.ts:2339`) sits inside the
  player's `load` command.

So a mission cannot say "this technical starts loaded, drives to X, and
dismounts". Making it able to is a schema plus sim change — which per CLAUDE.md is
the correct route ("if a mission needs a behaviour the schema cannot express,
extend the schema"), not mission logic in TypeScript. It touches the determinism
canary and deserves its own spec.

**`transport_slots: 3` is declared now anyway**, so the roster states the intent,
with this spec as the record that nothing fills those seats yet. Two things to
settle when it becomes real: three squads is more than the Eitan APC's two, and
cost stays 331 here only because nothing functional changed.

## The vehicle

Authored in a live Blender session from `tools/vehicles/kit.py` primitives, to a
late-1970s single-cab light pickup supplied as **visual reference only** — no
geometry, texture or file from it enters the repository.
`tools/vehicles/author_technical.py` builds the base; the `.blend` is the
authority for anything refined afterwards, same contract as the APC hero asset.

5.02 × 2.10 × 2.15 m, 120 parts. `real_metres: 5.0`, `size_class:
light_vehicle` — a step above the jeep's 4.8 in the same class.

What the reference decided, against the rounder truck first built:

- **Slab flanks with squared arch cut-outs**, not bulging round fenders. The body
  side is one flat panel and the wheel opening is a notch in its bottom edge, so
  `prism` (extrude an X–Z profile along Y) does the work and boxes do not.
- **An upright windscreen**, ~26° off vertical. The first pass raked it near 35
  and the cab read as a wedge.
- **A level bonnet into a flat rectangular nose**, wide grille with the headlights
  inboard of it, straight bumper, no bull bar.
- **Cab plus bonnet about equal to the bed.** The first pass gave the cab a third
  of the body and the truck read as a flatbed.
- **Tyres nearly filling their openings.** The first pass left the arch top 0.20
  above the tyre, which read as sagging inside oversized arches.

### The gun

A heavy 14.5 mm on a pintle, at the front of the bed. 40 parts, and it took three
passes to read:

1. Barrel axis at 1.58 with the cab spanning 0.78–1.95 — the barrel ran *through
   the rear window* and the truck read as unarmed.
2. Raised clear but built entirely from boxes, so it read as a dark blocky cluster.
   Fixed by using **cylinders and a cone** where a gun is round: perforated barrel
   jacket, flat drum magazine, conical muzzle brake, stepped breech.
3. DShK-sized, which read modest. Scaled up: barrel reach 1.75 m from the breech
   against 1.07, jacket 0.21 m across, on a deliberately **short post** so the
   weapon dominates the mount rather than perching on it.

Height is set by clearing the cab roof and no more. An earlier version at
`BED_FLOOR + 1.42` stood 2.62 m — taller than the Eitan APC — and read as a mast
vehicle. The cure was never height; it was making the weapon big and the post
short.

### Colour

The body is `limestone.0` (#F2E8D5), a sun-bleached off-white, whose declared ramp
role already includes "sun-bleached surfaces". This also separates the factions by
palette rather than by insignia, which is the right way round given
`CONTRIBUTING.md`: the `olive` ramp's declared role is literally "KDF vehicle
hulls".

The risk was that the terrain's *primary* ramp is limestone too, so a pale hull
could vanish on pale ground where every olive vehicle reads clearly. Checked
against a limestone ground plane in `tools/vehicles/preview_technical.py` rather
than guessed: it reads, with the dark roles and the cast shadow carrying it. The
dark accents are therefore load-bearing, not decoration.

| role | palette |
|---|---|
| `hull` | `limestone.0` |
| `plate` | `limestone.2` |
| `metal` | `gunmetal.2` |
| `rubber` | `shadow.0` |
| `glass` | `gunmetal.3` |
| `recess` | `shadow.1` |

## Three tooling changes

**Per-role vehicle materials.** `render_vehicle.py` flattened every model to one
flat olive. `render_team.py` and `render_building.py` had already grown per-`rl_role`
materials, so this is a port, not an invention. Opt-in via
`VehicleSpec.role_palette`; left unset, every existing sheet is byte-identical.

**`palette_linear` moved to `dimetric.py`.** It was copied in `render_building.py`
and `render_team.py`, whose own comment said to split it out when a third caller
appeared. `render_vehicle.py` is that caller. It cannot live in either: importing
`render_building` runs a full building render at import time. Verified colour-neutral
across all 44 palette keys before switching the two callers over.

**`turretAxisPx` — the renderer fix.** The real finding of this piece of work.

A turret sheet is composited at the *hull's* screen position (`renderer.ts:1342`)
while its frame is chosen independently from where the weapon is aiming. So the
turret is drawn as though the whole vehicle had turned: the station orbits the
rig's pivot, which is the model's **median vertex**.

Nobody had noticed, because every turret so far is centre-mounted — the Eitan's
station measures 4.2% of hull length from its pivot, about 4 px drawn. A pintle gun
on a pickup bed measured **16.2%**, roughly 16 px, and the incentive runs
backwards: a long barrel built from 14-segment cylinders drags the median forward,
so the better the gun, the worse the pivot. Chasing it by moving the gun just moves
the median again.

The fix records the truth instead. `render_vehicle.py` projects the declared
`turret_axis` for each of the 16 facings and writes `turretAxisPx` to the turret
manifest; `turretAxisOffset(sheet, hullIdx, turretIdx)` returns
`axis[hull] − axis[turret]`, which is zero when they agree and exactly the
correction when they do not. A missing or malformed field yields `[0, 0]`, so every
existing sheet keeps its current behaviour and a short array cannot silently offset
some facings and not others.

## Verification

- **Silhouette.** `TECH_HULL vs JEEP_HULL = 0.423` — the collision that was the
  design's stated worry is one of the *loosest* pairs. Tightest is 0.547 against
  the tank, far clear of the 0.88 limit. The raised gun breaking the roofline and
  the open bed did the separating.
- **Facing offset 12.** Prow on +X and the rig constant is −90°, so
  `(c − phi)/22.5 = −4 ≡ 12`, matching the Eitan. Derivation in
  `tools/render_eitan.py`.
- **`turretAxisPx` validated non-circularly.** Overlaying the rig's own axis onto
  the hull frames puts the crosshair on the bed's front bulkhead against the cab in
  every facing — where the pintle physically mounts. Compositing the shipped sheets
  with and without the correction shows the gun parked over the cab before and
  sitting on its socket after. A marker probe agrees in x within a few px and in y
  with a constant offset (spread 1.44 px), which is the deliberately omitted z term
  — invariant under a Z-axis rotation, so it cancels in the difference.
- **Gates.** 295 tests (12 new, covering the axis parse and offset), determinism
  4/4 with the hash unmoved, data 43 files, art 2150 sprites / 21 units, `balance`
  all four §5.7 targets met, `validate:ui` and `lint` clean.

## One hazard found the hard way

`render_technical.py` guards `main()` behind `if __name__ == "__main__"`, unlike the
older vehicle scripts which render at module scope. A probe script imported this one
to read its `SPEC`, and the import silently re-rendered all 48 frames over the
quantized ones — the art gate then failed on off-palette wreck frames with nothing
in the diff to explain it.

## Not done

- Mounted delivery, per the split above. Until then the 3 slots stay empty in play.
- The bed is 53% of the body; the reference is nearer 45%.
- `render_eitan.py`, `render_namer.py`, `render_jeep.py`, `render_tank.py` and
  `render_tiger.py` still render at import scope.
