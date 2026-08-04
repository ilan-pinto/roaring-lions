# Unit Animation — Design

**Date:** 2026-08-04
**Status:** Approved, ready for planning
**Scope:** Spec A of two. Spec B (asset roster) is designed separately.

---

## Problem

Unit animation today is one state machine with two states:

```ts
// renderer.ts:574
if (st.moving[i] === 1 && atlas.frames > 1) {
  this.entityAnimFrame[i] += 0.12;
  frame = 1 + (Math.floor(this.entityAnimFrame[i]) % (atlas.frames - 1));
} else {
  this.entityAnimFrame[i] = 0;
}
```

Three defects follow from those six lines:

1. **Playback is framerate-coupled.** The counter advances per rendered frame, so infantry on a 30 fps machine walk at half the speed they do at 60 fps.
2. **Cadence is constant across unit types.** A mortar team and a technical animate identically regardless of how fast they actually move.
3. **Phase resets to zero on stop.** A squad ordered to move steps in perfect unison — clockwork, not troops.

Beyond playback, the state coverage is thin. Suppression is the game's highest-value mechanic (GDD §5.5) and has no postural expression. Firing produces muzzle puffs near a unit that is itself inert. Death is an instant vanish plus a two-line `X` drawn in `Graphics` (renderer.ts:533).

GDD §5.8 requires the combat model be *shown, not hidden*. Animation is an unused channel for exactly that.

## Goals

Legibility first — every clip answers a question the player actually has. Juice where it rides the same machinery for free.

**Non-goals:** authoring art (Spec B), audio, changing sim behaviour, wreckage-as-cover.

---

## Clip vocabulary

Five clips. This is the contract every future unit model must satisfy, so it is deliberately small — CLAUDE.md holds that adding a unit should mean adding JSON, and a large clip set makes every contribution expensive.

| Clip | Frames | Purpose |
|---|---|---|
| `idle` | 1 | Default. Also the fallback for any unauthored clip. |
| `move` | ~4, looping | Locomotion. Also serves rout, at elevated cadence. |
| `fire` | ~3, one-shot | The shot came from *this* unit. |
| `down` | 1 | Gone to ground. The suppression read. Also the dying pose. |
| `wreck` | 1 | Persistent destroyed form. No posing — cheapest clip to author. |

Deliberately excluded: a separate `run` clip (cadence sells panic; art does not), a distinct `death` clip (the dying transform does the work), per-weapon fire variants.

---

## Architecture

New module `packages/render/src/anim.ts`. `renderer.ts` is already 936 lines carrying terrain, fog, VFX, HUD, and units; animation does not belong in it. `anim.ts` owns which texture a unit shows this frame and what transform it gets. `renderer.ts` calls in and draws the result.

Dependency direction is unchanged: `app → render → sim`, read-only. Nothing here mutates sim state.

### SpriteAtlas

Loads a manifest, exposes `texture(clip, facing, frame)`. Knows nothing about the sim.

Requesting a clip the sheet lacks returns the `idle` texture. **This fallback is load-bearing** — it is what allows Spec B to land unit-by-unit without breaking units that have not been re-authored yet.

### AnimState

Per-entity playback state in struct-of-arrays form, matching the sim's convention: `Uint8Array` for clip id, `Float64Array` for phase and transform offsets. No per-entity object allocation, no per-frame allocation. The sim's SoA discipline exists because GC pauses are visible at 400 units; the renderer inherits that constraint.

### resolveClip

`resolveClip(state, i) → clip`. A pure function from sim state to clip id — no Pixi, no side effects, directly unit-testable.

---

## Manifest

Sprite configuration moves from a hardcoded `SPRITE_MAP` in `main.ts` into each sheet's `manifest.json`, which `render_*.py` already writes but nothing currently reads.

The motivating case: `facingOffset: 5, facingReverse: true` is currently a hand-measured constant with the comment *"Measured off the sheets themselves"*. The Blender rig that caused that offset knows it exactly. A human reading it off images by eye is a drift bug waiting to happen.

```json
{
  "unit": "infantry_soldier",
  "facings": 16,
  "size": 256,
  "facingOffset": 5,
  "facingReverse": true,
  "scale": 1.0,
  "clips": {
    "idle":  { "frames": 1, "fps": 0 },
    "move":  { "frames": 4, "fps": 10, "loop": true },
    "fire":  { "frames": 3, "fps": 20, "loop": false },
    "down":  { "frames": 1, "fps": 0 },
    "wreck": { "frames": 1, "fps": 0 }
  },
  "files": [
    { "clip": "move", "facing": 0, "frame": 1, "file": "move_f00_001.png" }
  ]
}
```

Filenames become `<clip>_f<NN>_<FFF>.png`.

**Legacy compatibility:** the loader accepts the current flat `f<NN>_<FFF>.png` layout as an implicit single-clip sheet — frame 0 as `idle`, remaining frames as `move`. Zero asset churn now; Spec B replaces these sheets anyway.

`SPRITE_MAP` in `main.ts` shrinks to unit-id → sheet-path. Adding a unit becomes: add unit JSON, add rendered assets.

---

## State resolution

Precedence chain, highest priority first:

| Priority | Condition | Clip |
|---|---|---|
| 1 | `alive[i] === 0` | `down` + death transform → hands off to `wreck` |
| 2 | `routed[i] === 1` | `move` at 1.6× cadence |
| 3 | `pinned[i] === 1` | `down` |
| 4 | `fire` clip latched and unexpired | `fire` |

The `fire` latch expires after the clip's own duration — `frames / fps` from the manifest — so a sheet controls how long its own muzzle animation holds without any renderer constant.
| 5 | `moving[i] === 1` | `move` |
| 6 | — | `idle` |

Notes on the ordering:

- **Rout reuses `move`.** Cadence sells panic and costs nothing.
- **`fire` is event-driven and one-shot**, latched from the existing `fire` event in `onEvents`, and it *loses* to pinned — a unit suppressed mid-animation drops to ground immediately, which is the correct read.
- **`down` covers pinned and dying.** They are distinguished by transform and glyph, not by separate art.
- **`mobilityKilled` needs no rule.** Such a unit never satisfies `moving`, so it correctly stops animating locomotion for free.

**Existing glyphs stay.** GDD §5.8 requires suppression and pinned readable on the unit plate at all times. Posture is a redundant second channel, not a replacement — a prone soldier is unreadable in a mass of units at gameplay zoom; the bar is not. The HP bar, suppression bar, pinned triangle, rout flag, and kill-state dots are all unchanged.

---

## Death and wreckage

Two phases, not one state:

1. **Dying** (~400 ms, from `alive[i] → 0`): plays `down` with the death transform — sink, fade, slight rotate. Still a live sprite in `spriteLayer`.
2. **Wreck** (permanent): the entity sprite returns to the pool; a static `wreck` sprite spawns at the death position, frozen at the unit's final facing, in a new `wreckLayer` beneath `spriteLayer`. Never updated again.

Layering means living units always draw over wreckage, and a wreck costs nothing per frame after creation.

**Fog rule.** A wreck is remembered terrain. It spawns regardless of visibility but draws only where `fog[tile] >= 1` (explored). You never see a kill you did not witness; a wreck you *have* seen persists after fog closes over it. This is consistent with existing explored-terrain behaviour and makes reconnaissance pay — a burnt column tells you a route was contested.

**Lifetime:** permanent for the mission. Pooled and capped at 256, oldest evicted. The battlefield accumulates a readable history of where fighting happened.

**Strictly cosmetic.** Wrecks do not provide cover, block movement, or affect pathing. `cover` and `blocked` are sim state; mutating them from the renderer would break invariant 4 outright. Wreckage-as-cover is a good mechanic and belongs in its own sim-side spec with balance validation — it is not smuggled in through the render layer.

**Tone.** Infantry wrecks are a subdued prone form in the existing restricted palette. No gore, no blood decals — `validate_assets.py`'s palette gate would reject red-spectrum additions regardless.

**Performance.** Static Sprites with no per-frame update; cost is draw calls, not logic. If profiling shows it matters, the fallback is baking `wreckLayer` into a `RenderTexture`. Not built until measured.

---

## Transform motion

Applied on top of whatever clip is playing. Rides the same `AnimState` arrays, needs no new art, and applies to units still on the procedural fallback.

### Playback timing (bug fixes)

- Advance by elapsed time, not rendered-frame count.
- Cadence derived from actual movement speed, not a constant.
- Phase seeded per entity from entity id rather than reset to 0 on stop.

### Motion tracks

| Trigger | Motion |
|---|---|
| `fire` event | Recoil — kick opposite the firing bearing over ~150 ms, ease back. Amplitude keyed off `type.isSoft`: ~1 px for soft units, ~3 px for vehicles. `onEvents` already branches on `isSoft` for muzzle-puff size, so recoil reuses that branch rather than inventing a new weapon field. |
| Turret traverse | Overshoot and settle rather than the current linear lerp. Mass, not a servo. |
| Death | Sink + fade + small rotate over ~400 ms, then hand off to the wreck. |
| `pinned === 1` | Low-amplitude tremble, backing the `down` posture. |
| `move`, infantry | Vertical bob keyed to the footfall frames. |
| `impact` + `penetrated` | Hit-flinch on the target — jolt along the incoming bearing. |

Recoil carries the most weight: a firing tank currently produces puffs *near* an inert vehicle. Recoil is what attributes the shot to the unit.

---

## Testing

CLAUDE.md: combat maths requires tests, rendering does not. Testing is therefore targeted.

- **`resolveClip` — unit tested.** A pure precedence chain over sim state. Precedence bugs hide well (a unit firing while pinned, a dead unit still walking) and are cheap to catch here.
- **Manifest parsing — unit tested**, including legacy flat-layout fallback and missing-clip fallback. That fallback is what makes Spec B safe to land incrementally, so it must actually work.
- **Transform motion — not tested.** Visual; assertions on the numbers would be unverifiable by reading them.
- **`pnpm test:determinism` — must pass with the hash unchanged.** The hash must not move. If it does, something leaked into the sim and the change is wrong by construction.

---

## Rollout

Each step independently shippable; the game stays playable throughout.

1. Playback timing fixes — bug fixes, immediately visible, zero risk.
2. Manifest loader with legacy fallback.
3. Clip resolution (`resolveClip` + `AnimState`).
4. Wreck layer.
5. Transform tracks.

Spec A ships with today's two sheets. INF's four walk frames become its `move` clip; TNK stays static — but gains recoil, death sink, and real wreckage.

---

## Spec B — asset roster (designed separately)

Recorded here as context for why Spec A's contract is shaped this way.

Current model coverage:

| Unit types | Model |
|---|---|
| `mbt_lavi` | tank |
| `inf_squad`, `at_team`, `mortar_team`, `rpg_team`, `atgm_cell`, `mortar_crew`, `militia_cell` | one shared soldier — seven identical silhouettes |
| `ifv_namer`, `apc_eitan`, `technical`, `recon_drone`, `demo_squad`, `civilians` | none — procedural `Graphics` fallback |

Seven unit types sharing a silhouette is a legibility hole independent of animation. The GDD's Ashwar validation target — *an unspotted RPG team gets its first volley off in ≥80% of engagements against a non-reconnoitred column* — only means something if the player can distinguish an RPG team from a rifle squad on sight.

Spec B produces, per unit, a distinct model **and** its full clip set in one render pass. Models and poses are not split into separate specs: a new model needs all its clips anyway, and splitting means rendering every sheet twice.

`validate_assets.py`'s silhouette IoU gate should compare wrecks against wrecks and live units against live units as separate groups. A destroyed tank resembling a destroyed IFV is acceptable; a destroyed tank reading like a *live* tank is not — that is the more valuable check to add.

---

## Deferred

- **Wreckage as cover** — real mechanic, sim-side, needs balance validation.
- **`RenderTexture` baking for the wreck layer** — only if profiling demands it.
- **Per-weapon fire clip variants** — clip-set inflation without a legibility payoff.
- **Garrison / `tunnel_travel` animation states** — neither subsystem exists in the sim yet (a known scaling debt).
