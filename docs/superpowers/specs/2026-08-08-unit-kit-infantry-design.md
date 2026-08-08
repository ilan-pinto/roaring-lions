# The unit kit, and nine infantry that stop being one sprite

**Date:** 2026-08-08
**Status:** approved, ready for implementation
**Depends on:** `2026-08-07-unit-rig-contract-design.md` (Spec C), which made scale
derived so this can be authored against a contract that has stopped moving.
**Scope:** Spec D of three. Spec E replaces the vehicles and adds `technical` and
`attack_drone`.

## The bug this fixes

Seven unit types resolve to the same sprite directory in
`packages/app/src/main.ts`:

```
inf_squad  at_team  mortar_team  militia_cell  rpg_team  atgm_cell  mortar_crew
```

A KDF rifle squad and an enemy militia cell are the same PNG. Two more types,
`sniper_team` and `demo_squad`, have no art at all and fall back to procedural
shapes.

`ART_PIPELINE.md` §4 calls the pairwise silhouette check the one that matters
most, "the check that keeps the game readable when forty units are on screen and
everything is on fire". It has never fired on any of these seven, because they
are not separate sheets to compare. The gate cannot catch a collision between a
file and itself.

Team colour does not rescue it either: `renderer.ts` applies `teamColors` only to
rings, pips and markers, never to sprite pixels. So today a player distinguishes
a rifle squad from a militia cell by a ring, and cannot distinguish an AT team
from a mortar team at all.

## Nine sheets, and figure count is a representation

Each of the nine gets its own sheet. Figure counts are informed by `hull.crew`
but are deliberately not literal — 8 riflemen will not fit on a tile, and one
figure standing for a 3-crew team is already an abstraction. What the count must
do is *order* roughly with crew while carrying silhouette load.

| unit | crew | figures | posture | weapon signature | uniform |
|---|---|---|---|---|---|
| `inf_squad` | 8 | 3 | all standing, wide line | plain rifles | olive |
| `demo_squad` | 5 | 2 | 1 kneeling over a charge, 1 standing | low box + cable reel | olive |
| `at_team` | 3 | 2 | 1 kneeling, 1 standing spotter | **horizontal** launcher tube | olive |
| `mortar_team` | 3 | 3 | 2 kneeling around the tube | **vertical** tube, tallest spike | olive |
| `sniper_team` | 2 | 2 | **both prone** | long low rifle, bipod | olive |
| `militia_cell` | 6 | 2 | standing, close pair, no helmets | rifles | dust |
| `rpg_team` | 3 | 2 | 1 standing, 1 loader | tube angled **steeply up** | dust |
| `atgm_cell` | 3 | 2 | both kneeling | **wide low tripod** | dust |
| `mortar_crew` | 3 | 2 | 1 kneeling at the tube | vertical tube, shorter, 2 not 3 | dust |

KDF in the `olive` ramp and enemy in `dust` is a second, independent channel on
top of the marker ring. Both ramps are already in the palette, and no team-band
colour enters the art — the reserved bands stay reserved, which the gate enforces
by name.

## No armature. Poses are compositions.

`tools/units/kit.py`, in the shape of `tools/buildings/kit.py`: primitives
assembled by `from_pydata`, each part carrying an `rl_role` custom property.

Figure parts — `legs`, `torso` with plate-carrier bulk, `head` (helmet or cloth
wrap), `arms`. Weapon parts — `rifle`, `sniper_rifle`, `rpg_tube`,
`atgm_tripod`, `mortar_tube` + `baseplate`, `demo_charge`, `cable_spool`,
`binoculars`.

A posture is a different arrangement of the same parts, not a deformation of one
rig. That is cheaper, fully deterministic, reviewable as code, and it drops the
`soldier_kolos.fbx` dependency whose licence is unverified — one of the three
CONTRIBUTING.md violations Spec C recorded.

It is also enough. `ART_PIPELINE.md` §0 states the governing constraint: at
40–80 px, model quality is nearly irrelevant. Spec C measured infantry at 25 px
wide. Blocky is not a compromise at that size; it is the correct budget.

## Clips

Five per sheet, matching the layout the manifest parser and `resolveClip`
already expect: `idle` (1), `move` (4, 10 fps, loop), `fire` (1), `down` (1),
`wreck` (1). Eight frames per facing, 128 files per sheet, 1152 in total.

Two honest limitations, recorded rather than hidden:

- **Crew-served weapons stay deployed during `move`.** A mortar team really
  walks with the tube shouldered, which would mean authoring a carried state and
  a deployed state for every crew weapon — roughly doubling the work for
  something invisible at 25 px. The legs cycle and the weapon stays put. This is
  what `render_soldier.py` already does, layering leg swing over a fixed upper
  body so the rifle stays up.
- **`sniper_team` is already prone, so its `down` needs a different idea.** It
  presses flatter and tighter rather than dropping, or the clip is
  indistinguishable from idle. Every other type crouches.

## The risk that actually decides this spec

Nine human figures plus the existing sheets take the matrix to roughly **190
pairs**, all of which must clear 0.88, and the previous round proved that similar
massing clusters hard. Spec C already moved one pair the wrong way — jeep vs
Namer went 0.703 → 0.765 as tighter framing made them normalise more alike.

The lesson from the building set is the governing one: **the frame is sized to
each unit's own reach, so downsampling normalises absolute height away.** Only
proportion and outline survive. Height is not a lever; aspect ratio, holes in the
outline, and limb spread are.

So the levers, strongest first: **posture** (prone is a wide flat smear that
nothing else can imitate), **weapon axis** (vertical tube against horizontal tube
against wide tripod), **figure count**, and **spacing** (line against pair
against cluster).

Named collision risks, with the fallback decided now rather than under pressure:

| pair | why it is close | fallback |
|---|---|---|
| `inf_squad` / `militia_cell` | both upright riflemen | widen the squad's line, tighten the cell to a touching pair |
| `mortar_team` / `mortar_crew` | both a vertical tube | drop the crew to 2 figures and shorten its tube; lengthen the team's |
| `at_team` / `rpg_team` | both a tube and two figures | hold the tube angle apart — level against steeply up — and posture apart |
| `atgm_cell` / `demo_squad` | both low and bulky | keep demo's standing figure; widen the tripod |

**Distinctness is validated before the renders, not after.** One facing per type
renders first, its IoU matrix is measured, and the massing is fixed while a fix
costs a minute. Only then do the full 16-facing, 5-clip renders run. Rendering
1152 sprites and *then* discovering two types collide would waste an hour and
tempt a limit change instead of a massing change.

## Verification

- The **full IoU matrix printed and recorded**, every pair under 0.88. If a pair
  will not separate, the massing is wrong and gets changed — the limit does not
  move.
- `pnpm validate:assets` — palette, binary alpha, minimum fill and framing on all
  1152 new sprites. Minimum fill is a live risk for `sniper_team`: two prone
  figures are a thin shape, and `MIN_FILL` is 0.06.
- `python3 tools/test_dimetric.py` — the sun guard must still pass, so the new
  author scripts take lighting from `build_lights()`.
- `pnpm test`, `pnpm test:determinism` (4/4, hash unmoved — no sim change),
  `pnpm typecheck`, `pnpm lint`, `pnpm validate:data`.
- `main.ts` maps all nine types to their own sheets, and **the seven-way shared
  `FOOT` entry is deleted** — leaving it would silently mask a sheet that failed
  to load.
- **Drive all three missions**, confirming each type is distinguishable on screen
  and that KDF and enemy infantry no longer read as the same unit.

## Out of scope

- **Vehicles**, `technical` and `attack_drone` — Spec E.
- **Carried states for crew-served weapons.** Reasoned above.
- **Damage states beyond `wreck`.** `ART_PIPELINE.md` §10 wants clean / scarred /
  burning; no sheet in the repository has `scarred` and adding it here would be a
  new axis across nine sheets at once.
- **Deleting `soldier_kolos.fbx` and `render_soldier.py`.** They stop being used
  when `inf_squad` gets its own sheet, but removing them is cleanup that should
  not ride along with 1152 new sprites.
- **The reference images.** Style reference only; nothing from them enters the
  repository, and their real-force insignia and faction identity do not transfer
  — CONTRIBUTING.md keeps factions fictional and defined by doctrine.
