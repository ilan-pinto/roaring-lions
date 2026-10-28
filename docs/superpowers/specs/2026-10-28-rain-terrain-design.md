# Rain: a wet, overcast terrain look (GH-871). Design, numbers for approval

**Date:** 2026-10-28. **Status:** design only, for the lead. Nothing is rendered, built, exported or sent to Meshy.
**Lane:** B. **Written against:** `main` at `2871c04b`. Every engine fact below was read from the tree that day.

**The decisions are in section 10.** Each one leads with its recommendation. Sections 1–9 hold the numbers they rest on.

**The short version:**

- **Rain is a weather layer over an existing terrain theme, not a fourth `terrain` value.** It is a mission field,
  `map.weather: "rain"`, read by the app the way `time_of_day` is, with a sandbox flag `&weather=rain`.
- **Highland and green maps first; arid is refused until a wet-desert set is asked for.**
- **Presentation only.** No sim rule, so `pnpm balance`, `pnpm playtest`, the versus probe and the determinism hash
  do not move.
- **The look** is wet tone bundles (two new `theme_only` ramps, `mud` and `overcast`), puddles drawn as an authored
  stand-in, falling rain as one instanced batch, an overcast light built from the existing preset and `LightOverride`
  machinery, and heavier haze in the fog pass.
- **Estimated cost:** +0.6 to +1.15 ms gross at `high` on DPR 2, or about +0.1 to +1.05 ms net of a softer shadow map.
  Budget proposed: <= +1.0 ms.
- **Art:** 0 Meshy credits and no new model. At most one Blender-baked texture, and only if a capture shows the need.

---

## 0. What the engine already gives us (read, not assumed)

| Fact | Where | Why it matters here |
|---|---|---|
| A map's `terrain` is `arid` / `green` / `highland`: a tone bundle, a ground texture and a decor species. It is presentation only. | `map.schema.json`, `packages/app/src/terrain-themes.ts` | A fourth theme would copy species and scatter that rain does not change (section 1) |
| Ground albedo images are **ratios** to their own mean, retinted by the theme's tone. They are `NoColorSpace` with plain `RepeatWrapping`. | `terrain/mesh.ts` `GROUND_ALBEDOS`, `terrain/surface.ts` | Wet ground is mostly a new TONE, not a new image. Never mirror-tile. |
| A `theme_only` ramp is invisible to every theme that does not name it in `TerrainTones.paletteRamps`. | `data/palette.json` `karst`, `terrain/tones.ts` | New wet ramps cannot move a dry map. `terrain-defaults.test.ts` already pins every map. |
| The control map's A and B channels are all used. B holds the road distance and the rut noise. The `uMacro` field and the ground's world `y` are already sampled. | `terrain/control-map.ts` | A puddle mask can be derived with **no new texture** (section 2.3) |
| The haze sits in the fog pass, before the shroud mix. Its tint is scene-referred. It has `hazeFar` and `hazeKey` per preset and a low-lying term keyed to the map's median level. | `three/haze.ts`, `fog-pass.ts` | Rain haze is a value change, plus one optional term in the same splice |
| `LightPreset` holds the sun, the sky, `hazeFar` and `hazeKey`. `LightOverride` holds `fill` and `shadow`. | `three/time-of-day.ts` | An overcast light is a function over the existing preset: no new light |
| The `day` preset's lights are pinned bit-identical. | `time-of-day.test.ts` | Clear weather must stay byte-identical (section 8.3) |
| Foliage sway runs on the SIM clock, `presentationSimMs`. Decals age on sim time. | `terrain/sway.ts`, `decal-pool.ts` | Rain animates on the same clock, so a frozen gate frame repeats exactly |
| Unit surface classes have roughness and metalness. Metal is capped at 0.45 because there is no environment map. | `units/unit-surface.ts` | Unit wetness is roughness only, inside the cap |
| `high` / `medium` / `low` carry `fxDetail` and `smokeBillboardGain` as optional knobs whose absence is the old behaviour | `packages/render/src/quality.ts` | `weatherDetail` follows the same shape |
| At `high`, DPR 2, on the Wadi Halam maps, a synced frame takes 16.4–21.0 ms. The live rAF cadence holds 16.7 ms. No pass dominates: shadow 1.3–1.9 ms, fog 0.2–0.8 ms. `medium` takes 12.0–16.0 ms. | GH-829, `docs/PERFORMANCE.md` | Every cost below is a delta on top of that existing miss. GH-829 stays its own ticket. |
| `&tod=` is a value flag in `KNOWN_PARAMS`. A mission's own value wins over it. An unknown value falls back and warns. | `packages/app/src/time-of-day.ts`, `sandbox-help.ts` | `&weather=` copies this exactly |
| `dusk` is a report-only golden scenario: the `quiet` framing plus a value flag | `capture-protocol.ts` `DUSK_SCENARIO` | Rain scenarios use the same pattern |

**One finding shapes the whole look.** The camera is orthographic and the sun is directional, so N, V and L are
the same on every flat fragment. The specular term on flat ground is therefore one constant across the screen.

Worked through for the shipped sun `(-0.406, 0.819, 0.406)` and the 30-degree camera, the half-vector stands 38
degrees off the flat-ground normal. GGX then puts essentially no specular on flat ground at any roughness:

| roughness | flat-ground specular, against the diffuse | what you see |
|---|---|---|
| 0.6 | about 0.4% | nothing |
| 0.1 | about 0% | nothing |

**So lowering the ground's roughness does not make it look wet.** A puddle at roughness 0.05 photographs as a
dark patch, because there is no environment map for it to reflect. Wetness has to be authored: a darker, more
saturated tone, a puddle stand-in that reflects the sky, ripples that move, and specular only where normals vary.
Normals vary on relief, on ripple normals, and on curved unit and vehicle surfaces. A curved hull does catch the
sun's lobe, which is why unit wetness is worth a roughness change (section 2.6).

## 1. Where rain lives: a weather layer, not a theme

| | A. `map.weather` over a theme (recommended) | B. a fourth `terrain: "wet"` theme |
|---|---|---|
| What it changes | tones, air, light, the falling rain | everything a theme owns: ground image, species, scatter |
| "Tel Marum in the rain" | yes: same map, a different mission or the sandbox | needs a copy of the map with a different `terrain` |
| Art | two wet tone bundles (highland-wet, green-wet) | a third bundle plus a species and scatter call for each |
| Where it is read | the APP, like `time_of_day` | the map loader, like `terrain` |
| Future weather (a khamsin dust storm on arid, a storm) | another enum value | another theme each time |

**Recommend A.** The lead's words were "another terrain type". A wet highland **is** a different terrain to look at,
so the player gets one. What rain does not change is the species, the scatter or the map, and a theme would force
all three to be duplicated.

## 2. The look

### 2.1 Palette: two new `theme_only` ramps

Both ramps run light to dark, like every ramp. They are `theme_only`, so no dry map's quantised terrain moves.
`terrain-defaults.test.ts` keeps pinning that, and the implementation watches it go red by dropping the flag
(section 8.4).

| Ramp | 0 | 1 | 2 | 3 | 4 | Role | Why no existing ramp carries it |
|---|---|---|---|---|---|---|---|
| `mud` | `#A06C48` L116 | `#85543A` L93 | `#6A402D` L72 | `#502F22` L53 | `#382019` L37 | wet earth, churned tracks, ruts, mud prints | `dust` is yellow (hue 35°) and stops at L82. Wet terra rossa is redder (hue 14–25°) and goes darker. Steps are 30–39 RGB apart, like `grass`. |
| `overcast` | `#C4C8C9` L199 | `#A3A9AC` L168 | `#83898D` L136 | `#656B70` L106 | `#4A4F54` L78 | overcast sky, rain haze, the puddle's sky reflection, the streak tint, wet limestone | `karst` is a WARM grey (hue 39°). `water` is too saturated (0.19) and has two steps. `gunmetal` is blue-cast and jumps from L97 to L147. A cool neutral is what an overcast sky is. |

Two things to check by eye:
- `mud.1` is 15 RGB from `dust.5`. It earns its place by hue, not by value.
- `overcast` sits 15–22 RGB from `karst`, step for step. It is the cool twin of a warm ramp, and highland-wet
  names both.

### 2.2 The wet tone bundles

A wet bundle is a `TerrainTones` derived from its theme. It changes only the fields below; species, scatter and
the ground images stay the theme's own.

| Field | highland (dry -> wet) | green (dry -> wet) |
|---|---|---|
| `open` | `dust.5` L99 -> `mud.1` L93 (redder, -6) | `grass.2` L177 -> `grass.3` L161 (-16) |
| `cover` 1/2/3 | `olive.1/2/3` -> `olive.2/3`, `shadow.0` | `grass.4`, `scrub.0/1` -> `scrub.0/1`, `olive.3` |
| `road` / `rut` | `karst.3` / (theme) -> `mud.2` / `mud.3` | `dust.3` / (theme) -> `mud.1` / `mud.2` |
| `rock` / `rockLit` | `karst.3` / `karst.2` -> `overcast.3` / `karst.3` | `limestone.6` / (theme) -> `limestone.7` / `limestone.6` |
| `earth`, `spoil` | `terracotta.2` -> `mud.3` | `dust.5` -> `mud.2` |
| leaves | one step darker on each of `leafDark/Mid/Lit` | one step darker |
| `haze` | `karst.0` -> `overcast.1` | `limestone.1` -> `overcast.1` |
| `macroHue` | `[karst.0, terracotta.2]` -> `[overcast.1, mud.3]` | (default) -> `[overcast.1, mud.2]` |
| `paletteRamps` | `[karst, mud, overcast]` | `[mud, overcast]` |
| `decorColors` | grass and bush tufts one step darker | same |

**Readability bound (decision 5).** Wet open ground stays within -20 luminance of the dry tone it replaces.
- It is the ground every unit silhouette was tuned against: `grass.2` was chosen to sit within 5 of `limestone.3`.
- KDF `olive.1` (L112) on wet green `grass.3` keeps a 49-point gap; the dry gap is 65.
- Highland is already low-contrast dry (13 points), and wet it is 19, slightly better because the hue moves off olive.

A test pins these numbers against **literal** oracles, not values imported from the bundle.

### 2.3 Wet ground, puddles and their stand-in

The terms below go into the ground shader under a `WEATHER_RAIN` define, so a clear map compiles today's program
byte for byte (section 8.3).

| Term | Rule | Numbers (for approval) |
|---|---|---|
| Wetness | the wet bundle's tones; no shader darkening on top | — |
| Puddle mask, roads | in the ruts: B's road distance inside the rut band, times the rut noise | 25–35% of road area |
| Puddle mask, open ground | the macro field (`uMacro`) thresholded on FLAT ground, where the normal's y is above 0.985 | 4–8% of open ground |
| Puddle mask, low ground | boosted where the ground lies below the map's median open level, the same `hazeReferenceLevel` the haze reads | +6% at 2 levels below |
| Never a puddle | a terrace top, a `^` rock top, a building pad, a slope over 10 degrees, a crown | — |
| Puddle surface | the darker wet tone, mixed toward the overcast sky colour (`overcast.0` scene-referred, the haze's own factor) by an AUTHORED reflectance | albedo x 0.55; reflectance 0.35 (physical Fresnel at this camera would be 0.05, which reads as nothing) |
| Puddle edge | a 0.06-tile soft rim of darker mud | `mud.3` |
| Ripples | rings on puddle fragments only, on the sim clock. Each ring cell is a `tileHash` stream, never `Math.random`. They modulate the sky reflection by ±15% and tilt the normal by at most 8 degrees. | 0.12-tile rings, 0.9 s life, 2 per cell, 0.5-tile cells |
| Roughness | open 1.0 -> 0.62, road mud 0.45, puddle 0.08, rock top 0.55 | Honest note: on flat ground this shows almost nothing (section 0). It is there for relief faces and ripple normals. |

The cheap stand-in is the recommendation. Three dearer options were considered and not recommended:

| Alternative | Cost | Why not |
|---|---|---|
| Screen-space reflections in the fog pass | about +0.6 to +1.2 ms at `high`; needs a puddle mask in the frame (the alpha of the HalfFloat target, which nothing reserves today) | Over budget on a frame that already misses (GH-829) |
| A constant overcast environment map | +1 program per material class | Would reopen the 0.45 metal cap game-wide, which is a renderer decision, not a weather one |
| Planar mirrors | — | Impossible on a bicubic ground |

### 2.4 Falling rain and splashes

**Recommended: one world-space instanced batch, `units/rain-batch.ts`.** It follows the flipbook pool's pattern:
one `InstancedMesh`, GPU-aged, main pass only. It has no `normal` attribute and `castShadow` is false, so the AO
pre-pass and the shadow pass never see it, exactly as with the decal pools.

- **How a drop lives.** Each instance is a hashed seed. Its position is `hash(i) + fall(presentationSimMs)`,
  wrapped inside a box that follows the camera focus, the same idea as the view-fitted shadow box.
- **Panning.** Drops stay fixed in the WORLD as the camera pans; the rain is never glued to the screen.
- **Splashes.** When a drop reaches the ground it draws, in the same instance and the same draw call, as a flat
  splash ring for its last 150 ms.
- **Ground height.** The drop's ground height comes from an R16F height texture, 4 texels a tile (37 KB on a 48x48
  map). It is baked at boot from `ground-height.ts`'s own sampler, so it is the drawn surface, not a tile corner.
- **Buildings.** Buildings hide drops through the depth test. Drops do not write depth.
- **Fog of war.** Because drops write no depth, the fog pass shrouds a streak by the ground behind it. Rain over
  unexplored ground is dimmed like that ground. Rain is uniform, so it leaks nothing about what is there.

| Number (for approval) | Value | Why |
|---|---|---|
| Fall speed | 4.0 wu/s (12 m/s), slant 12 degrees down-wind | Real rain falls at about 9 m/s; a little faster reads as rain rather than snow |
| Streak | 0.42 wu long, 1.5 CSS px wide at every zoom (the silhouette's constant-pixel rule), alpha 0.28 | It is read as motion blur |
| Colour | `overcast.0` x the haze's scene-referred light factor | It never exceeds 1.0, so it never blooms (`hdr-gains.ts` gets no entry) |
| Splash | ring radius 0.04 -> 0.10 wu over 150 ms, alpha 0.35 -> 0, `overcast.1` | — |
| Spawn height | 6 wu above the box floor (fall time about 1.5 s) | Above every roof |
| Count | `high` 6,000 / `medium` 3,500 / `low` 1,500 | Section 3 |
| Render order | a new `RAIN_RENDER_ORDER` in `render-order.ts`, in the FX-above band (3) | Over units, under overlays (4), smoke (5) and the occlusion outline (6) |
| Reduced motion (`data-motion`) | no falling rain, no ripples; wet ground and light stay | The rain is ambient motion |
| Pause | the rain freezes in the air | The sim-clock rule's consequence, the same as sway. Decision 12. |
| Minimap | `photographGround` hides the rain batch; the wet tones and puddles draw | The minimap is a ground photograph |

| Alternative | Verdict |
|---|---|
| Screen-space streaks in the fog pass (0 draw calls, about +0.1 to +0.3 ms) | Not recommended. No occlusion by buildings, and anchoring to the world on a pan is fiddly. A possible `low` fallback. |
| Splash particles in the flipbook pool | Not recommended. It needs a third atlas, for a 150 ms ring. |

### 2.5 Light, exposure, haze, low cloud and lightning

**The overcast light is a pure function, `rainLight(preset)`**, in a new `three/weather.ts` next to
`time-of-day.ts`. It uses no `three`. It keeps the preset's sun DIRECTION (rain at dawn is still dawn) and changes
the rest:

| Quantity | `day` today | rain over `day` | Rule |
|---|---|---|---|
| Sun intensity | 2.6 | 1.2 | x0.46 on any preset |
| Sun colour | `limestone.0` | `overcast.0` | — |
| Fill (hemisphere) | 0.9 | 1.35 | a `LightOverride.fill`; a mission's own `map.light` still wins |
| Sky key | `water.0` | `overcast.1` | — |
| Shadow strength | 1 | 0.45 | a `LightOverride.shadow` |
| Shadow map | 4096 / 2048 / 1024 | 2048 / 1024 / 1024 | One step down. Overcast shadows are soft, and blur reads right. |
| `hazeFar` / `hazeKey` | 0.12 / theme | 0.26 / `overcast.1` | max(preset, 0.26) |
| Exposure | ACES 1.0 | **ACES 1.0, unchanged** | The colour-pipeline rule. The dimming comes from the lights. |

**Open-ground irradiance** is `(sun * sun.y + fill) / pi`. It falls from 0.964 to 0.742, a drop of 23%. That is
moody without a black frame. Stacked with the -6 to -16 luminance of the wet tones, the bound in 2.2 is what keeps
units readable.

**Haze.** No new term is needed for the far haze. The low-lying term (`HAZE_LOW`) rises from 0.06 to 0.10 under
rain, so valleys fill with murk. Its cap: units stay readable.
- `hazeFar` does not go above 0.26.
- A report reads unit-on-ground contrast at the far ramp point, on the `rain` capture.
- Rain must not visually hide what the sim lets the player see. Presentation-only weather that LOOKS like
  concealment is a lie the player acts on.

**Low cloud shade (optional, phase 5).** A slow-drifting value-noise multiply of ±6% luminance in the fog pass,
before the shroud and the haze.
- 14-tile cells, drifting at 0.4 tiles/s down-wind, on the sim clock.
- The noise is hand-rolled from `terrain/noise.ts`.
- It is a ratio, so it never hides a unit more than the light already does.

**Lightning: recommend none in phases 1–4.** If wanted in phase 5:
- a sky-only flash: fill x1.4 for 120 ms, with no bolt geometry and no `PointLight`;
- at most once per 20 s, scheduled from a `tileHash` stream on sim time;
- off under reduced motion, and well inside the three-flashes-a-second photosensitivity line;
- it stays under the bloom threshold.

### 2.6 Foliage, units, decals and VFX

| Subject | Under rain | Cost |
|---|---|---|
| Foliage | wet tones (2.2); sway amplitude x1.5 and gust gain 1.4 -> 1.8, still on the sim clock | 0: uniforms |
| Units | roughness only: cloth 0.92 -> 0.80, armour 0.78 -> 0.52, plate 0.70 -> 0.48, gunmetal 0.42 -> 0.32, rubber unchanged. Metalness unchanged (cap 0.45). No albedo darkening, because the team and role tones carry readability. | 0: values on materials already cloned; +0 programs |
| Buildings | roughness of roof and wall classes x0.8 (phase 3, optional) | 0 |
| Decals | tread and tyre prints take `mud.3` in place of `dust.5`. A crater holds water: the crater shader's own `craterHeight` below a threshold takes the puddle surface. | about 0 |
| `vehicle_dust.json` | a rain variant: a low, short mud spray (`mud.2`, life x0.5, no rising column). A blast's dust column is shortened in the same way. | 0 net: a swap |
| Smoke | unchanged. Smoke is a sim fact (section 4). | 0 |

**No status marks in the world.** Rain adds no badge, icon or "muddy" mark to any unit. If a sim rule ever lands
(section 4), it is told on the briefing and the HUD unit card, in DOM, never in the world.

## 3. Frame cost, per element and per preset

All figures are **estimates**, by analogy with measured neighbours:
- the relief-read ALU, +0.15 ms (GH-804);
- the fog pass, 0.2–0.8 ms;
- the smoke billboard's fill cost;
- the shadow pass, 1.3–1.9 ms (GH-829).

They are to be MEASURED in phase 4 under GH-829's conditions:
- `tools/src/perf/fx-cost.ts` with a `weather` layer A/B;
- M3 Pro, ANGLE/Metal confirmed, 1440x900 at DPR 2;
- `tel_marum` and `wadi_halam_basin`, zoom 0.5 / 1 / 2.5;
- 12 interleaved rounds of 20 synced frames, median and p95, own port, music off.

| Element | `high` | `medium` | `low` | Draw calls | Fallback, in order |
|---|---|---|---|---|---|
| Wet tones, light, haze values, foliage, unit roughness | 0 | 0 | 0 | 0 | — |
| Ground wetness and puddles (ALU, `WEATHER_RAIN` define) | +0.10 to +0.20 | +0.10 to +0.20 | +0.10 to +0.20 | 0 | drop the low-ground and open-ground masks (roads only) |
| Ripples | +0.05 to +0.10 | +0.05 to +0.10 | off | 0 | off |
| Falling rain and splash (6,000 / 3,500 / 1,500 drops; about 75 device px each, 6–9% of the frame blended) | +0.30 to +0.60 | +0.20 to +0.35 | +0.10 to +0.15 | +1 | count ladder x1.0 -> x0.6 -> x0.35, then no falling rain (the wet ground stays) |
| Decals and the crater puddle | about +0.05 | about +0.05 | about +0.05 | 0 | — |
| Cloud shade (phase 5, optional) | +0.10 to +0.20 | +0.10 to +0.20 | off | 0 | off |
| **Gross** | **+0.60 to +1.15** | **+0.50 to +0.90** | **+0.25 to +0.40** | **+1** | |
| Shadow map one step down (a saving) | -0.10 to -0.50 | -0.05 to -0.30 | 0 | 0 | — |
| **Net** | **+0.10 to +1.05** | **+0.20 to +0.85** | **+0.25 to +0.40** | **+1** | |

| Other resource | Amount |
|---|---|
| Programs | +1 (rain), plus one ground permutation, built only on a rain map |
| Textures | +1: the 37 KB height texture. A mud image would be +1 more (decision 11). |
| GPU memory | about 0.1 MB for instances and the height texture |
| Load | no GLB. Under 5 ms for the height bake and one compile. |
| Tick time | 0 |

**Budget proposed (decision 13):** a delta, measured on the median and the p95:

| Preset | Budget |
|---|---|
| `high` | <= +1.0 ms |
| `medium` | <= +0.7 ms |
| `low` | <= +0.4 ms |

If `high` misses, the count ladder steps first and the ripples second. A fight frame (smoke plus rain overdraw) is
read once as well, with `blast:capture`'s method, and reported rather than gated.

## 4. Presentation or rules

**Recommend presentation only for this issue.** Any sim rule should be a separate, later issue, and its first
candidate would be smoke decay.

Every option below must hold to the same conditions:
- It is deterministic and in data: a `data/weather/rain.json` read through `@lions/data`, in Q16.16 or integers.
- It is folded into `hash()` only when weather is live, the `woundLive` precedent, so no golden pin moves on a
  clear map.
- It reaches the sim through a sim-facing mission field of its own. `map.weather` stays app-read, like
  `time_of_day`, and is never added to the sim's `map` type.

| Option | What it does | `pnpm balance` (§5.7) | `pnpm playtest` | Versus probe | Engine work |
|---|---|---|---|---|---|
| **A. Presentation only (recommended)** | nothing in the sim | unmoved | byte-for-byte on a carrier mission | unmoved | none |
| B. Sight x0.85 | detection and identification range shrink | The §5.7 urban targets were calibrated on identification range (13 tiles for a max-tier squad), so they need a rain row and likely a retune | Recon missions are BUILT on measured sight: four `locate` primaries on Tel Marum I, Umm Zeitoun's "out to thirteen tiles", and the sight facts in the Tel Marum and Qarn Hadid doctrine tests. Their slack moves and a clock can be lost. | Asymmetric: the side that fires on others' eyes (the battery, sight 6) loses more. A re-run on every map. | a Q16.16 multiply in detection; cheap |
| C. Mud slows vehicles off-road (x0.7) and the flow field prices it | "vehicle" is `mobility.wheeled`, which includes tracked hulls, so every tank slows; routes reorder onto roads | **Blind**: the backtest has no movement, so it would not see the rule at all | Vehicle-escort and clock missions (Wadi Halam V's D9) move | KDF armour against technicals: asymmetric. A re-run per map. | a new per-tile, per-mobility cost concept, more flow-field pressure (`MAX_FLOW_FIELDS`), a doctrine test per map |
| D. Rain beats smoke down: `SMOKE_DECAY` 1 -> 2 per tick (12.75 s -> 6.4 s of concealment) | a laid screen lasts half as long | "max-tier 2:1 urban assault with smoke" (86–96%) falls; needs a rain row | missions that lean on smoke get harder | roughly symmetric | one integer; the cheapest |

**Why A:**

1. The issue is a mood. Rules change every measured mission they touch.
2. The lead's standing bar is that the §5.7 targets and the versus bar hold. B and C each need a balance campaign of
   their own, and C's would be invisible to `pnpm balance`.
3. D is honest and cheap: the player SEES rain thin the smoke. If the lead wants rain to matter, it is the one rule
   to try, on a mission designed for it, after the look lands.

**One rule binds A:** the look must not imply concealment the sim does not grant (the haze cap, 2.5).

## 5. Data: where it is authored and read

| Piece | Rule |
|---|---|
| Mission field | `map.weather`: an `enum ["clear", "rain"]` in `mission.schema.json`, beside `time_of_day` and `light`. Absent means `clear`. App-read only. **Never added to `packages/sim/src/mission.ts`'s `map` type.** |
| `validate:data` | refuses `"rain"` on a mission whose map's `terrain` is `arid` until a wet-arid bundle exists (decision 3). Falsified by authoring it once and watching it go red. |
| App | a new `packages/app/src/weather.ts`, `weatherOf(mission, params)`, mirroring `timeOfDayOf`: a mission's value wins and never reads `&weather=`. With no mission, it reads the flag. An unknown value returns `clear` and a warning. Rain on an arid map in the sandbox returns `clear` and a warning naming why. |
| Sandbox | `&weather=clear\|rain`, a value flag in `sandbox-help.ts`'s `KNOWN_PARAMS`, beside `tod`, shown in `__lions.help()` and the boot banner. Sandbox only. It composes with `&tod=`. |
| Free Play picker | not in phases 1–5. At phase 6, a "Rain" option whose label is a catalogue key (`freePlay.option.rain`, through `t()`) (decision 15). |
| Renderer | `RendererOptions.weather?: 'clear' \| 'rain'`, read at boot like the quality preset, so it is not live. `RenderQuality.weatherDetail?: 0 \| 1 \| 2` (low / medium / high), optional; absent reads 2. |
| Versus | not in phases 1–6. Presentation can differ per client without a desync, but a room should not hand one seat a darker screen. If wanted, `data/versus/<map>.json` gets the field later. |
| Audio | a rain bed and thunder are the audio lane's, a separate call. The sourcing rules apply (redistribution rights, no paid packs). Tests stay silent (`SILENT_AUDIO`). |

**Which maps can take it, with no new map:**

| Theme | Maps |
|---|---|
| green (6) | `tile_green`, `wadi_halam_basin`, `wadi_halam_2`–`5` |
| highland (11) | `tel_marum` (x4), `umm_zeitoun` (x4), `qarn_hadid` (x3) |

**Recommended first carrier mission (phase 6):** `umm_zeitoun_1_recon`, "Cold Ground".
- It authors no `time_of_day` today, so it has no light of its own to clash with.
- It is a highland basin, where terra-rossa mud reads best.
- Its title already says the weather.
- It is not a Wadi Halam map, so GH-829's miss is not compounded on the first mission.
- `narrative-designer` may add one briefing clause. It is optional, because the look carries it.

`wadi_halam_2_laager` (green pasture and bunds) is the second candidate, after the phase 4 cost read on a Wadi
Halam map.

**A new map is not needed for presentation only.** The storyline's ending says the Marj has been quiet "since the
winter" (`storyline.md` section 5), so the war spans a winter and a wet Act II needs no new canon. A purpose-built map is worth
designing only if a mud rule (option C) is ever chosen. It would be mud flats where roads are the only fast lanes,
and it goes through `campaign-designer` and the distinctness gate.

## 6. Art pipeline

| Asset | Tool | Credits | Note |
|---|---|---|---|
| Palette ramps, tone bundles | data | 0 | numbers in 2.1 and 2.2 |
| Puddles, ripples, rain streaks, splashes, cloud shade | shader / procedural | 0 | hashes from `tile-hash.ts`, noise from `terrain/noise.ts`; no `Math.random` in a seeded path |
| Height texture | baked at boot from `ground-height.ts` | 0 | not an art asset |
| Mud ratio image (only if decision 11 asks for it) | **Blender**, `tools/terrain/bake_mud_tile.py`: periodic hand-rolled value noise, so it is seamless by construction (never `mathutils.noise`) | 0 | 1024², JPEG, `NoColorSpace`, a mean measured into `GROUND_ALBEDOS`, a repeat of 2 tiles, an edge-to-adjacent ratio of at least 0.9 (the sand tile measured 0.95). It carries no ruts: the road SDF draws those. |
| *Considered, not recommended:* a Meshy-made mud texture | Meshy | about 10–15 | It cannot be proven seamless, and the colour is off-palette. The ratio form throws its colour away anyway. |
| New models | none | 0 | rain changes no species, prop or unit |

**Recommended Meshy spend: 0 credits.** The "max detail" rule applies to the mud tile if it is built: a 4096² master
baked down to 1024, with the cap disclosed in its report.

**The art numbers the lead approves before anything is captured** are the tables in sections 2.1–2.6: ramp hexes,
tone mapping, puddle coverage and reflectance, ripple, streak, splash, counts, light, haze, sway and roughness.
Nothing is rendered in Blender, because there is no mesh to render.

The first image is an in-engine capture in phase 2, behind `&weather=rain`, on the agent's own port, in one Metal
browser with music off. It is shown A/B against clear, at zoom 1 and 2.5, and the lead judges it zoomed in.

**Mood board (phase 1, reference study only).**
- About 16 references in `roaring-lions-ep/_coord/rain-look/refs/`, outside the repo. They are never committed,
  never fed to Meshy, never traced, never shipped.
- Each reference is recorded with its source URL and licence.
- No personal data goes into any search.
- One sheet, `_coord/rain-look/board.html`, annotates each reference with the number in this spec that it argues
  for.

| Category | Count | What to take from it |
|---|---|---|
| Mediterranean winter overcast over limestone hills and terra rossa | 3 | sky value, haze depth, how dark wet red earth goes |
| Dirt tracks churned by vehicles, water in the ruts | 2 | puddle coverage on roads, edge darkening |
| Wet limestone, scree and outcrops | 2 | wet rock value and coolness |
| Green pasture and bunds in rain | 2 | the green-wet bundle |
| Puddles at about 30 degrees, reflecting a grey sky | 2 | the authored reflectance (0.35) and ripple scale |
| Rain in top-down and isometric strategy games, studied for mechanics only | 3 | streak density, length and alpha, splash size, how unit readability survives |
| Wet cedar and olive foliage, low cloud on a ridge | 2 | leaf darkening, cloud-shade scale |

## 7. The visual gate

| Scenario | Framing | Status | Layer checks recorded (report) |
|---|---|---|---|
| `rain` | `relief`'s framing: `tel_marum` (highland), tile (10, 15), zoom 2, `targetTick` 500, the same drone order, plus `weather=rain` through `sandboxFlags` | **report-only** (`gated: false`), like `dusk` | `rain`, `wet`, `ripples`, and `cloud-shade` from phase 5 |
| `rain-green` | `wadi_halam_basin`, a road and pasture framing clear of the force, zoom 1.6, an absolute `targetTick` | **report-only** | `rain`, `wet` |

- **New debug layers** (`three/debug-layers.ts`): `rain` (the batch's visibility flag), `wet` (the puddle and wet
  terms' amplitude uniform to 0, which leaves the wet TONES, by design), `ripples`, `cloud-shade`. Each is a flag or
  uniform that no per-frame write re-asserts, the `unitsDebugHidden` standard.
- **Repeatability first.** Rain is on the sim clock, so a frame frozen at tick 0 elapsed is deterministic. Three
  fresh-process captures of one commit must read 0 px / 0.0000 before any floor is written. A bimodal reading is a
  bug, not a band. `lateFreezeRefusal` and `guardCapture` apply unchanged.
- **Promotion to gated** is a later lead call (decision 14). The condition is a third of the smallest of three runs,
  per layer. **The thresholds of the existing scenarios do not move.**
- **No baseline moves.** No gated scenario sets a weather, and clear compiles today's program (8.3).
- The bloom census (`pnpm perf:bloom-census`) adds both rain framings. A quiet rain frame stays under 0.9.

## 8. Build phases

| Phase | What | Output | Gate before the next |
|---|---|---|---|
| P0 | this spec | the decisions in section 10 | the lead's answers |
| P1 | mood board, reference study only | `_coord/rain-look/board.html`; the numbers revised if the board argues for it | the lead approves the numbers (sections 2.1–2.6) |
| P2 | data and air: schema field, `weatherOf`, `&weather=`, `RendererOptions.weather`, `rainLight`, haze values, the `mud` and `overcast` ramps, the two wet bundles, unit roughness, foliage sway gain, and the `rain` / `rain-green` report-only scenarios registered | first in-engine A/B captures, own port, Metal, music off | the lead's look |
| P3 | wet ground: the puddle mask, the stand-in, ripples, ground roughness, crater puddles, mud prints, the `vehicle_dust` rain variant; decision 11 (mud image) is read here | captures; `wet` and `ripples` layer readings | the lead's look |
| P4 | falling rain: the batch, splash, height texture, the `weatherDetail` ladder, reduced motion; **the cost run** (section 3) | the cost table measured; ladder steps if over budget | inside budget, or the lead's call |
| P5 | optional mood: cloud shade; lightning only if decision 8 says so | captures and cost | the lead's look |
| P6 | carrier: `umm_zeitoun_1_recon` gets `weather: "rain"`; the Free Play option | `pnpm playtest` byte-for-byte for that mission; `validate:data` | — |
| P7 | only if decision 2 asks for a rule: smoke decay through `balance-analyst` and `sim-guard`, a rain row in the backtest, the golden hash folded only when live | balance and probe tables | the lead |

### 8.3 Clear weather is byte-identical

The pin, and how it is shown to work:
- `RendererOptions.weather` absent, and `'clear'`, both build exactly today's programs and uniforms.
- A test compares the compiled ground shader source and the light values, bit for bit.
- Falsification: compile `WEATHER_RAIN` unconditionally once, and watch both that test and the `quiet` golden go red.

### 8.4 Every new check, with the input that makes it fail (run, then put back)

| Check | Falsifying input |
|---|---|
| Wet tones against literal luminance oracles | change `mud.1`'s hex |
| `theme_only` isolation (`terrain-defaults.test.ts`) | drop `theme_only` from `mud` |
| `weatherOf`: a mission wins over the flag | read `params` first |
| `validate:data` refuses rain on arid | author it on `beit_sahwan_1_recon` |
| Rain on the sim clock | drive the batch from `performance.now()`; the frozen repaint must differ |
| The `rain` layer contributes | hide the batch with nothing else changed: the reading must be non-zero |
| Constant-pixel streak width | drop the `MESH_UNITS_PER_TILE`-style rescale; the width test goes red |
| The streak never blooms | give it an `hdr-gains` entry; the census goes over 0.9 |

## 9. What this does not cover

- Snow, a khamsin dust storm, or rain that starts and stops mid-mission. The enum leaves room, and a mid-mission
  change would need a live renderer switch that the boot-time preset model does not have.
- Real players' readability. The contrast numbers are a floor, not a playtest.
- Any GPU but the M3 Pro.

## 10. Decisions for the lead (recommendation first)

1. **A weather layer, not a fourth theme.** Recommend a mission field `map.weather: "rain"` over the map's existing
   `terrain`. The alternative, a `terrain: "wet"` theme, duplicates species and scatter and cannot put rain on a
   shipped map.
2. **Presentation or rules.** Recommend presentation only for GH-871. If rain should matter later, try one rule
   first: rain halves smoke's life (`SMOKE_DECAY` 1 -> 2), through `balance-analyst`, on a mission designed for it.
   Sight and mud are not recommended: sight breaks the measured recon missions, and mud is invisible to
   `pnpm balance` and slows every tank.
3. **Themes in scope.** Recommend highland and green. Rain on an arid map is refused by `validate:data` and warned
   in the sandbox until a wet-desert set is asked for.
4. **Palette.** Recommend adding `mud` (`#A06C48 #85543A #6A402D #502F22 #382019`) and `overcast`
   (`#C4C8C9 #A3A9AC #83898D #656B70 #4A4F54`), both `theme_only`.
5. **How dark wet ground goes.** Recommend within -20 luminance of the dry tone: green -16, highland -6 and redder.
   Pinned by a test. Darker reads wetter and costs unit readability.
6. **Puddles.** Recommend the authored stand-in: dark wet tone, overcast sky at reflectance 0.35, and ripples. No
   SSR and no environment map: SSR would cost +0.6 to +1.2 ms on a frame that already misses, and an environment
   map would reopen the metal cap game-wide.
7. **Falling rain.** Recommend one world-space instanced batch, streak and splash in one draw: 6,000 / 3,500 / 1,500
   drops, constant 1.5 px width, alpha 0.28. None under reduced motion.
8. **Lightning.** Recommend none through P4. If wanted at P5: a sky-only flash, at most once per 20 s, off under
   reduced motion, never a bolt.
9. **Overcast shadows.** Recommend keeping the shadow pass, at strength 0.45 with the map one step down. Units stay
   grounded on `medium` and `low`, which have no GTAO. Dropping the pass on rain would save 1.3–1.9 ms at `high`,
   and units would float on the presets with no GTAO.
10. **Low cloud shade.** Recommend building it at P5, on `high` and `medium` only, and only after the P4 cost read
    shows room.
11. **A mud image.** Recommend none at first: mud is the existing ratio images under `mud` tones. A Blender-baked,
    seamless 1024² mud tile only if the P3 capture reads flat. Meshy: 0 credits.
12. **The rain's clock.** Recommend the sim clock, like sway and decals. The gate repeats exactly, and pausing
    freezes the rain mid-air. A wall clock would make every rain capture noisy.
13. **Frame budget.** Recommend approving <= +1.0 ms at `high`, <= +0.7 at `medium` and <= +0.4 at `low`, median
    and p95, measured as a delta at DPR 2. GH-829's existing miss stays its own ticket.
14. **The visual gate.** Recommend two report-only scenarios, `rain` (Tel Marum, highland) and `rain-green` (Wadi
    Halam I). Promote `rain` to gated only after three bit-identical fresh-process runs and your look.
15. **First carrier and the picker.** Recommend `umm_zeitoun_1_recon` ("Cold Ground") at P6, with no new map, and a
    "Rain" option in Free Play at the same time.
16. **Versus.** Recommend no rain in versus rooms for now. If wanted, it becomes a per-map rules field later, the
    same for both seats.
17. **Go for P1.** Recommend approving the mood board as reference study only: no render, no Meshy, no browser.
