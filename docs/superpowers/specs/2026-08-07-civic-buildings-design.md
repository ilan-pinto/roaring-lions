# The civic buildings — market, school, hospital

**Date:** 2026-08-07
**Issue:** [#38](https://github.com/ilan-pinto/roaring-lions/issues/38) follow-on
**Status:** approved, ready for implementation
**Depends on:** `2026-08-07-town-terrain-design.md` (Spec A), which laid the street
these front and made structure symbols data-driven.

Three civic types, and the reason the hospital exists is not decoration.

## The hospital fixes a content bug

Mission 3's briefing says: *"the district is not empty: residents shelter among the
buildings and the clinic on the southern block is protected. Heavy ordnance near
either will be judged."* Its ROE block flags a zone by name:

```json
"roe": { "flagged_zones": ["clinic"] }
```

The `clinic` zone is `[29, 23, 6, 6]` — tiles x29–34, y23–28. What actually stands
there, measured:

```
y23: '222222'
y24: '2wwww2'   <- the warehouse
y25: '2wwww2'
y26: '2wwww2'
y27: '2wwww2'
y28: '222222'
```

A **warehouse**, `roe_penalty` 3 — the cheapest thing on the map to flatten. So a
player reads "the clinic is protected", looks at the southern block, and is shown an
industrial shed the game charges almost nothing to level. The briefing, the ROE data
and the map disagree, and the ROE mechanic is the thing GDD §5.8 says must be
legible.

So the warehouse moves out of the clinic block and the hospital moves in. An
industrial shed in a residential clinic block was the wrong content anyway.

## The three types

Values chosen against the existing ladder — shanty 2, warehouse 3, concrete 3,
house 6, apartment 14, mosque 30 — so the ROE ordering is a statement about what
the game protects:

| | `market` | `school` | `hospital` |
|---|---|---|---|
| symbol | `b` (bazaar) | `k` | `c` (clinic) |
| `hp_per_tile` | 180 | 320 | 420 |
| `garrison_slots` | 3 | 4 | 3 |
| `rubble_cover` | 1 | 2 | 2 |
| `height_px` | 13 | 20 | 24 |
| `color` | `dust.2` | `limestone.2` | `limestone.1` |
| `roe_penalty` | 10 | 26 | **32** |

`b`, `k` and `c` are free of both the terrain symbols (`. 1 2 3 r o n`) and the
declared structure symbols (`s h a w # m`). Spec A's `validate_data.mjs` cross-check
now enforces that, so a collision fails the data gate rather than surprising the
loader.

**The hospital is 32, above the mosque's 30**, making it the most protected
structure in the game. Medical facilities hold the strongest protection there is,
and it is the only structure the mission data flags as a zone in its own right.

**All three are garrisonable**, and that is deliberate rather than an oversight. A
militia cell firing from a school is precisely the dilemma the ROE system exists to
pose: the player must choose between the objective and the score, and a protected
building nobody can occupy poses no dilemma at all.

## Placement, solved against the grid

| what | plot | note |
|---|---|---|
| `market` | x25–30, y19–20 (6×2) | long and thin, fronting the east–west street from the north |
| `school` | x20–24, y13–16 (5×4) | west of town, its own block |
| `hospital` | x30–33, y24–27 (4×4) | exactly the warehouse's old footprint, inside the `clinic` zone |
| `warehouse` | x36–39, y26–29 (4×4) | moved east, near the road the convoy uses |

Checked, not assumed: every plot is free of buildings, inside the `town` zone
`[19, 9, 22, 31]`, clear of all `r` street tiles, and clear of the
`kdf_assembly`, `town_center`, `mortar_line` and `civ_refuge` markers. The
hospital's 4×4 sits wholly inside the 6×6 clinic zone, keeping the `2` cover ring
that already surrounds that block.

## Art, and the risk that actually matters

Three more buildings take the pairwise silhouette matrix from **15 pairs to 36**,
all of which must clear the gate's 0.88 and the 0.85 ceiling this set works to. The
previous round established the hard lesson: the render frame is sized to each
building's own reach, so downsampling to 64px **normalises absolute height away**.
Only proportion and outline survive. Height is not a lever.

The occupied niches, by height over projected width:

```
shanty     0.28   low sprawl, pitched
warehouse  0.41   wide and squat, gabled
house      0.45   medium rectangle, parapet
apartment  0.66   tall and wide, stepped setback
concrete   0.85   tall and narrow, heavy cornice
mosque      --    dome and minaret
```

So each new building needs a shape, not a size:

- **market** — a long open **arcade**: a row of pointed arches under a flat awning
  roof, on a 6×2 plan. Its plan aspect alone (3:1) is unlike anything in the set,
  and an arcade is a silhouette with regular holes in it.
- **school** — a **courtyard**. Two ranges around an open middle, so the silhouette
  has a hole in it. Nothing else in the set does, and it is the strongest single
  lever available for separating another flat-roofed masonry building from the house
  and the apartment.
- **hospital** — a wide block with a **projecting portico** and a cluster of
  rooftop plant, on a 4×4. Distinguished from the house by the portico breaking the
  facade line and from the apartment by being wide rather than tall.

Fallbacks named now rather than under pressure: deepen the market's arcade and
lengthen it to 7×2; open the school's courtyard wider and drop one range to single
storey; raise the hospital's portico and add a second roof-plant cluster.

New kit parts needed: `arcade` (a run of arched openings under a lintel),
`awning_roof`, and `portico`. Everything else composes from the existing 18.

## Verification

- The **36-pair IoU table**, printed and recorded, every pair under 0.85. This is
  the gate on the whole spec: if a pair will not separate, the massing is wrong and
  gets changed, not the limit.
- `pnpm validate:assets` with 361 sprites and 15 comparable sheets.
- `pnpm validate:data` — the three new symbols pass the cross-check; a deliberate
  collision fails it.
- `pnpm test`, `pnpm test:determinism` (4/4, hash unmoved — no sim change here),
  `pnpm typecheck`, `pnpm lint`.
- **Drive all three missions**: each loads, the three new buildings render on their
  plots, and mission 3's clinic zone now contains a hospital.
- Report the **blocked-tile delta**, since three new buildings change pathing:
  count before against after, and confirm units still path from `kdf_assembly` to
  `town_center`.

## Out of scope

- **Changing mission 3's ROE data.** The `clinic` zone already flags the right
  tiles; putting a hospital in them is the fix. No mission JSON needs to change,
  which is the point.
- **Civilian entities inside these buildings.** The briefing's "residents shelter
  among the buildings" is the civilians-and-ROE system, not this.
- **Sprite variants.** One sprite per type, as before.
