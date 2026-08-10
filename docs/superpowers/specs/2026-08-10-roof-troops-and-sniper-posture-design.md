# Roof troops and sniper posture — design

**Date:** 2026-08-10
**Status:** approved, not built

Two small presentation faults, unrelated except that both are "the sprite does not
show what the sim knows".

## 1. Occupied buildings should show their troops

**Today.** A held building draws a house badge in the holder's colour with one pip per
man inside ([renderer.ts:1523](../../packages/render/src/renderer.ts)). The garrisoned
units themselves are not drawn at all — they vanish on entry and reappear on exit. So
a building with a rifle squad in it and one with an ATGM cell look identical, and
whether the occupants are shooting is invisible.

**Change.** Draw the occupants on the roof, and keep the pips.

- **Anchor: `badgeTopPx`**, already in every building manifest (140.86 for the house)
  and already used to place the badge. The roof line is therefore known and needs no
  new data, no new field, and no change to `render_building.py`.
- **Up to two sprites**, spread laterally about the building centre. The pips stay
  authoritative for the count — a warehouse with five men inside shows five pips and
  two figures, because five overlapping sprites on one roof is mush.
- **Clip comes from sim state**, through the existing `resolveClip`. A garrisoned squad
  that is firing shows `fire`; one that is pinned shows `down`. That is the whole point:
  the roof is where the player reads whether the building is fighting back.
- **Facing is the unit's own**, so a garrison visibly covers an arc rather than staring
  in a fixed direction.
- **Sorted above its building**: `depthZ(building) + 1`, the same trick the turret
  sprite uses to stay above its hull.

**No sim change.** `garrisonedIn` is already on the state view; this reads it and draws.
Invariant 4 holds by construction — nothing here can influence a simulation outcome.

**Why the roof rather than in the windows.** Windows would be more literal, but a
building sprite is one flat image with no window geometry the renderer knows about, so
there is nowhere to anchor. The roof is a real, already-calibrated anchor, and a figure
on a roof reads as "this building is held" from further away than a figure in a window
would.

## 2. The sniper team crawls when it should walk

**Today.** `sniper_team()` in `tools/units/teams.py:228` passes `posture="prone"` for
*every* clip, so the team crawls prone when it moves. Reported as "sniper should walk
when walking and only [be prone] when idle, pinned to drop on the ground".

**Change.** Posture becomes a function of the clip:

| clip | posture | why |
|---|---|---|
| `idle` | prone | on the scope; this is the sniper's identity |
| `move` | standing, with stride | a sniper team relocates on its feet |
| `fire` | prone | and `fire` must not change a figure's height — an existing rule in that file, because `resolveClip` latches it per shot and a height change makes the team bob through a firefight |
| `down` | prone, closed up | unchanged; `down` cannot be "go prone" for a team that starts prone, so it flattens instead |
| `wreck` | prone | unchanged |

The rifle and binoculars already take `posture`, so they follow.

**The collision worry is unfounded, and it is worth writing down why.** That file
records the prone idle as "the only prone idle in the game… a wide flat smear is a
shape nothing else can produce", which reads as an argument against changing the
sniper's posture. It is not: the silhouette gate compares **only** `idle_f00_000.png`
and refuses to run on anything else
([validate_assets.py:189](../../tools/validate_assets.py)). `idle` stays prone, so the
gate sees exactly what it sees today. Making `move` upright cannot affect it.

A standing sniper in `move` will resemble other infantry at those frames. That is
acceptable — a walking two-man team *should* look like a walking two-man team, and the
gate's question is "do these read as the same unit", which is answered by the idle.

## Scope

In: the renderer's garrison drawing, `sniper_team()`, and a re-render of `INF_SNIPER`.

Out: window-level placement; drawing garrison occupants for buildings with no sheet
(they keep the procedural extrusion and the badge); any change to how garrisoning
works in the sim.

## Verification

- **Roof troops** by driving the UI: garrison a squad in the tutorial, screenshot the
  roof, order it to fire and confirm the clip changes, then unload and confirm the
  figures leave. Console shortcuts are the wrong instrument here — they skip the code
  that breaks.
- **Sniper** by re-rendering `INF_SNIPER` and inspecting `move` against `idle` at
  gameplay zoom, then `pnpm validate:assets` for the palette, alpha, fill and
  silhouette gates.
- **Gates**: the full CI list, which is ten commands — `typecheck`, `lint`, `test`,
  `test:determinism`, `validate:data`, `validate:assets`, `validate:ui`,
  `validate:audio`, `build`, `balance`. Running the seven I remembered is how a
  `typecheck` failure reached CI earlier today.
- **Determinism** should not move: no sim code is touched. Assert it rather than assume
  it.

## Risks

- **Roof sprites at small zoom.** Two figures on a shanty roof at low zoom may be a few
  pixels and read as noise. Mitigation is that the badge and pips stay, so nothing is
  lost if the figures are only legible when zoomed in.
- **A building holding two different unit types.** The drawn pair is whichever two the
  scan finds first, which is deterministic but arbitrary. The pips already do not
  distinguish types, so this is no worse than today.
