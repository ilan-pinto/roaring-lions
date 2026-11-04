# Nature sounds: wiring plan (GH-984 N4, step 2)

**For after the lead has picked.** Nothing here is built. Step 1 is `index.html` in this directory: the candidates for the lead's ear. This file turns design section 10 (`reactive nature` design, `_coord/nature-design/design.md`) into the work that follows a pick, so the pick can be small.

Each sound has an A/B/C to choose from. The choice is one of: a candidate, "none", or "redo". "None" for a family drops that family's rows below.

## What the design asks for

One pure, three-free module, `packages/render/src/nature-audio.ts`, called once per sim tick beside `updateEngines`, that decides which nature sounds start and what the looping ones do. It decides. `audio.ts` plays. The module reads the sim and writes nothing to it (invariant 4), and nothing it does is read back by the sim.

## Where it hooks

- `packages/app/src/main.ts:5724` calls `audio.updateEngines(sim, fogVisible)` once per sim tick, guarded by `!tickQuiet` (catch-up ticks are silent). The nature call goes on the next line with the same guard and the same fog closure, `renderer.isVisible`.
- `BattleAudio.updateEngines` (`audio.ts`) already computes `canSound = !muted && ctx running` and the viewer's side. `updateNature` is a sibling method that does the same, then calls `natureAudio.step(...)`.
- Engine loops are the precedent for the water loops: `EngineVoices` (`engines.ts`) picks the nearest `voice_cap` candidates within a radius (`ENGINE_RADIUS_TILES` 14, cap 4), places each through `host.place(dx, dy, radius)`, and fades slots in and out over `ENGINE_SLOT_FADE_S`. Water reuses that machinery as a second `EngineVoices`-shaped host rather than growing a new one.

## Module shape

`nature-audio.ts` is pure: numbers in, a list of requests out. No `AudioContext`, no `three`, no `Date`, no `Math.random`.

```
step(input: NatureInput): NatureOut
  input: tick, listener {x, y}, viewer side, unit table (positions, type facts,
         alive/removed), terrain facts (blocked/boulder/knoll/ridge/marsh, see
         "the open api.ts decision"), fogVisible(wx, wy), gust(tSec)
  out:   one-shots[]  { set, gain, rate, dx, dy }      (capped, see below)
         loops[]      { id, set, gain, dx, dy }        (water; the nearest K clusters)
         windGain                                      (0..1, one number)
```

`audio.ts` turns `one-shots` into `playSet`-style sources through the existing placement and bus code, and `loops` into voices, exactly as it does for engines.

## Dated to tick slots, seeded by (entity, slot)

The rule is the rotor wash's (`three/units/rotor-wash.ts`, `washSlotAt`, `washRand`; GH-391): a sound is a pure function of sim time, not of frames or of how many frames were drawn.

- Slot `k` is the instant `k * NATURE_SLOT_MS` of sim time (`sim.tickCount * 50`). Starting numbers: stones 400 ms per vehicle, rustle 350 ms per man.
- A unit emits at most one sound per slot it has not emitted yet. A paused or zero-time repaint has the same sim time, so it emits nothing.
- Per sound, the draw is `mulberry32(hash(entityId, slot))`: whether to sound at all (probability by speed), which variant, a pitch inside `+-3%` (the shipped sets use a small random rate too). No global stream; the same unit in the same slot sounds the same on every replay.
- A unit's per-slot state (last slot emitted) lives in a `Uint32Array` sized to the entity count, grown the way `EngineVoices.grow` does it; it is not in `hash()` and never reaches the sim.

## What triggers each sound

| Sound | Trigger | Set | Notes |
|---|---|---|---|
| Stones trickle | a tracked vehicle, speed share above ~0.15, whose tile is `b` (boulder field), `^` (ridge) or a knoll decor tile | `stones_trickle` (2-3 variants) | one per slot per vehicle; the slot is longer than the sound |
| Stones crunch | the same, for a vehicle whose `mobility.wheeled` is true and which is not tracked | `stones_crunch` | **"vehicle" is `mobility.wheeled`, an authored boolean** (CLAUDE.md): do not test `FOOT_ROLES` |
| Rustle | a foot unit (infantry, speed above ~0.3 tiles/s) on a tile the vegetation mask says is bush or reed | `rustle_*` (bush, reed or dry by tile kind) | needs the mask below |
| Water | the nearest K `~` marsh clusters on a map whose theme is wetland, within a radius | `water_*` loop, one voice each | positional, via the engine-loop host; `~` is legal on `wetland` maps only (`ein_qasab` is the only one today), so on every other map this is zero work |
| Wind | always, one voice | `wind_*` loop on the amb bus | gain follows the gust, below. The shipped ambience beds are off (`AMBIENCE_ENABLED = false` since 9 Oct, GH-483) and stay off; this is a separate voice, not a bed coming back (design decision 9: a bed returns only with an approved bed) |

Tracked or wheeled comes from the same `engineFamilyOf` / `by_type` data the engines already use (`data/audio.json` `engines`), so a vehicle that has no engine loop (an aircraft, a drone) has no stones either.

## Constraints, each with where it is enforced

1. **Fog-gated.** The same `audible(id)` as `updateEngines`: own side always, otherwise only where `fogVisible(wx, wy)` is true. A hidden enemy tank crossing gravel must not give itself away. Water clusters are terrain, not units, so they are heard wherever the listener is within radius, fogged or not (a marsh is not intelligence).
2. **Bus.** One-shots on the `sfx` bus (so the Effects slider, mute, the bark duck, the outcome fade and the pause menu hold them). Loops (water, wind) on the `amb` bus, under its own duck stage, so a bark leaves them alone and an announcement takes them down 3 dB.
3. **Pause and mute.** `setPaused(true)` calls `natureAudio.stopAll(attackS)` beside `engines.stopAll`; `canSound` false fades every nature voice and still advances the slot clocks, so an unmute does not replay a backlog. Wind (amb bus) follows `ambPaused` like the bed.
4. **Per-tick cap.** `NATURE_SOURCES_PER_TICK = 2` one-shots per tick, counted separately from `MAX_SOURCES_PER_TICK` (6) so nature never takes a slot from a gunshot, and a global `NATURE_VOICE_CAP = 6` live nature sources. When over, nearest the listener wins, ties by entity id (deterministic). Loops: water `K = 3` at most, wind 1.
5. **Distance.** Nothing starts beyond `AUDIBLE_TILES` (26) or, for stones and rustle, beyond ~12 tiles: they are quiet sounds.
6. **Catch-up and quiet ticks.** Not called while `tickQuiet`; the slot clock is a pure function of sim time, so the first loud tick after a catch-up starts no more than one slot per unit.
7. **Reduced motion** (design decision 6) says nothing about sound. Sound is not gated by it, but the Effects slider is.

## The wind bed follows the visual gust

`gustFactor(tSec, wet)` (`terrain/wind.ts`, N1's `WindField`) is a pure function of sim time. The sound gain is the same function mapped: 1 at rest, `GUST_SOUND_PEAK` at a gust's peak. This page's starting number is 1.6 (+4.1 dB), baked into the `wind_*_gust_follow` previews so the lead can judge it. The gain is set on a `GainNode` with `setTargetAtTime` once per tick, time constant ~0.25 s (a gust is 2.5 s wide, so it is not a step). Under rain the gust peaks at 3.0, so the mapping needs its own `GUST_SOUND_PEAK_WET`; decide it on a rain clip, not a guess. The wind is presentation: `nature-audio.ts` reads `presentationSimMs`, never `performance.now`, and a paused game is silent anyway.

The wind bed is quiet by design: a candidate whose own level wanders much more than ~1.5 dB over 1 s windows fights the gain. The page prints that number per file.

## Data and validators (when it ships)

- `data/audio.json` gets a `nature` section shaped like `engines` (`radius_tiles`, `voice_cap`, per-set `gain`, `file`, `alt`, `license: CC0-1.0`, `source: generated by tools/gen_audio.py`), and `tools/gen_audio.py` gains the picked recipes unchanged from `nature_candidates.py`, written under `assets/audio/nature/`. `pnpm validate:audio` already reads `ambience` and `engines`; it needs a `nature` section: shape, files, `loop_s` (the ambience range is 20 to 90 s, so the 10 s water and 15 s wind loops need their own range, as the 8 s engine loops have), peak, seam, and "heard at" loudness. **That validator change is part of step 2 and is not in this PR.**
- The picked files are encoded exactly as here (OGG q3 + M4A 160k, `-map_metadata -1 -fflags +bitexact`). `nature_manifest.json`'s hashes become the byte-for-byte check that `gen_audio.py` reproduces them.
- One-shot sets use `variants` (2-3), like the shipped sets.
- No VFX, no UI state, and no sim write is involved. The `nature` section of `data/audio.json` is app data like `ambience`; it is not in the sim's mission type.

## The open `api.ts` decision: the per-tile vegetation mask

The rustle needs to know whether a tile has bush or reed. `map.decor` (what `renderer.setDecor` is given) says only grove, knoll, ridge, ditch and marsh. Bushes and reeds are scatter: `decorPlacements` (`three/terrain/decor-place.ts`) places them from a seeded per-tile cluster roll, theme remaps (`wet_grass`, `shrub`) and a density factor. The renderer therefore knows what is drawn, and the sim and app do not.

Three ways, recommendation first:

1. **Recommended: a read-only readback on `Renderer` in `api.ts`**, `vegetationAt(tx: number, ty: number): 0 | 1 | 2 | 3` (none, bush, reed, dry). Built once per terrain build from the same `decorPlacements` the draw uses (one count per tile, bush and reed families), and rebuilt where a structure collapse splices the decor (`DECOR_SPLICE_RADIUS_TILES`). The sound then matches the picture: the man rustles where a bush is drawn. Cost: a `Uint8Array` of `width * height`, built where the placements are already walked. `main.ts` passes `(x, y) => renderer.vegetationAt(x, y)` into the nature call exactly as it passes `renderer.isVisible`. This is the one `api.ts` change, and by the dependency rule (`app -> render -> sim`) it is a method on the interface, never a `three` type.
2. A pure re-derivation in `nature-audio.ts` from `TerrainInput` through `decorPlacements`: no api.ts change, but it runs the placement a second time at boot (cost on a 96x96 map to be measured) and must be kept in step with the draw by a test.
3. Tile kind only: marsh tiles are reed, grove tiles are bush, open ground makes no sound. Cheapest, no `api.ts` change, but it rustles in a grove the player cannot see a bush in, and not in a field of drawn scrub. Acceptable as a first cut if the lead wants the rustle at all.

**Decision needed from the lead (or the lead's delegate for `api.ts`)**: 1, 2 or 3. If the lead picks "no rustle", this section and its row vanish and `api.ts` is untouched.

## Order of work after a pick

1. The lead's picks (one per family, or none).
2. `tools/gen_audio.py` gets the picked recipes, `assets/audio/nature/` the files, `validate:audio` the `nature` section; a test that the generated bytes equal `nature_manifest.json`.
3. `nature-audio.ts` and its tests, pure: slot dating (zero-time repaint emits nothing; same (entity, slot) draws the same), the cap (nearest wins, ties by id), the fog gate (an enemy on a hidden tile is silent, an own unit is not), the vehicle test (`mobility.wheeled`, not `FOOT_ROLES`).
4. The `BattleAudio` hook, the bus routing, pause and mute, and the `api.ts` decision.
5. A listen on a real map, driven through the UI (not `window.__lions`): the Lavi over boulders, a squad through reed on `ein_qasab`, a mission with the gust visible.

Each step has a test that fails for a constructed input, per CLAUDE.md.
