# Materials, lighting and the matching checklist

Part 2 of the Roaring Lions RTS art research (2026-11-09). It covers PBR materials, outdoor
lighting, tone mapping, and how to make baked and generated assets sit in one world. It ends with
a step-by-step checklist an agent can follow for every new asset or effect.

**Notation.** `[S#]` points to the Sources list. **(est.)** marks an estimate or rule of thumb.
**(inference)** marks my own reasoning. **(snippet)** marks a search-summary-only source. Linear
values are scene-referred linear sRGB/Rec.709. "sRGB" means 8-bit display-encoded values. Luminance
is `0.2126 R + 0.7152 G + 0.0722 B` on linear values.

## Contents

1. [The metal/roughness workflow and energy conservation](#1-the-metalroughness-workflow-and-energy-conservation)
2. [Real albedo ranges (table)](#2-real-albedo-ranges)
3. [Roughness by material and wear](#3-roughness-by-material-and-wear)
4. [When metalness is wrong, and why an RTS caps metal](#4-when-metalness-is-wrong-and-why-an-rts-caps-metal)
5. [Edge wear, dirt and dust consistency](#5-edge-wear-dirt-and-dust-consistency)
6. [Baked AO versus runtime AO](#6-baked-ao-versus-runtime-ao)
7. [Texel density, and normal maps at RTS distance](#7-texel-density-and-normal-maps-at-rts-distance)
8. [Stylised PBR that stays physically consistent](#8-stylised-pbr-that-stays-physically-consistent)
9. [Outdoor daylight: sun, sky and fill ratios](#9-outdoor-daylight-sun-sky-and-fill-ratios)
10. [Exposure and the tone mapper](#10-exposure-and-the-tone-mapper)
11. [Environment lighting](#11-environment-lighting)
12. [Shadows, time of day and dusk](#12-shadows-time-of-day-and-dusk)
13. [Matching a baked or generated asset to scene lighting](#13-matching-a-baked-or-generated-asset-to-scene-lighting)
14. [One world: the look-dev rig and reference values](#14-one-world-the-look-dev-rig-and-reference-values)
15. [The matching checklist](#15-the-matching-checklist)
16. [Sources](#sources)

---

## 1. The metal/roughness workflow and energy conservation

- **Three numbers do most of the work:** base colour, metallic and roughness. Epic's shading
  model, from the SIGGRAPH 2013 PBS course, is the industry reference for this parameterisation
  [S1]. Filament documents the same model for real-time use [S2].
- **Metallic is binary** for pure surfaces: 0 for a dielectric, 1 for a metal. Intermediate values
  are for transitions, such as metal to rust or dust on metal. A metallic mask for paint over
  metal should contain only black and white [S2], [S3].
- **Dielectric specular is about 4%** at normal incidence (F0 0.04, "specular 0.5"). Do not set it
  to zero on diffuse materials; raise the roughness instead [S3]. Filament: never below 2%
  [S2].
- **Base colour has two meanings.** For a dielectric it is the diffuse albedo. For a metal it is
  the specular colour, and the metal has no diffuse term at all. Filament's ranges: a dielectric
  base colour of sRGB 50-240 (strict) or 30-240 (tolerant); a metal of 170-255 sRGB [S2].
- **Energy conservation.** A surface cannot reflect more than it receives. In the metal/roughness
  model, diffuse and specular are traded against each other by the metallic parameter and
  Fresnel, so an artist cannot break conservation by hand except through base colour out of range
  [S1], [S2]. The practical rule: **the albedo range is the conservation rule.** An albedo above
  about 0.9 linear, or a texture that bakes a highlight into the base colour, is where assets break
  it.
- **Roughness is perceptual.** Shaders square it (α = roughness²). Filament clamps it at about
  0.089 for half-float precision, and the clamp also reduces specular aliasing [S2].

## 2. Real albedo ranges

Measured and published values. Linear values come from the Physically Based database [S4] and
Unreal's material guide [S3]. The sRGB column is the standard sRGB encoding of the linear value
(computed here). "Luma" is linear luminance.

| Material | Linear RGB (or intensity) | Luma | sRGB 8-bit | Source |
|---|---|---|---|---|
| Charcoal | 0.02 | 0.020 | 39, 39, 39 | [S3], [S4] |
| Coal (community chart) | 0.04 | 0.040 | 56 | [S5] (snippet) |
| Fresh asphalt | 0.043, 0.041, 0.040 | 0.042 | 58, 57, 56 | [S4] |
| Worn asphalt | 0.08 | 0.080 | 80 | [S3] |
| Tyre rubber | 0.023 | 0.023 | 42, 42, 42 | [S4] |
| Bare soil | 0.13 | 0.130 | 101 | [S3] |
| Grass | 0.105, 0.133, 0.041 | 0.120 | 91, 102, 57 | [S4] |
| Green grass (UE) | 0.21 | 0.210 | 126 | [S3] |
| Grey card | 0.18 | 0.180 | 118, 118, 118 | [S4] |
| Brick | 0.262, 0.095, 0.061 | 0.128 | 140, 87, 70 | [S4] |
| Clay | 0.256, 0.118, 0.091 | 0.145 | 138, 96, 85 | [S4] |
| Terracotta | 0.555, 0.212, 0.110 | 0.278 | 196, 127, 93 | [S4] |
| Desert sand (UE) | 0.36 | 0.360 | 162 | [S3] |
| Sand | 0.440, 0.386, 0.231 | 0.386 | 177, 167, 132 | [S4] |
| Fresh concrete | 0.51 | 0.510 | 189, 189, 189 | [S3], [S4] |
| Limestone (est.) | about 0.35-0.60, warm | about 0.35-0.60 | about 160-205 | No measured value found. Limestone is "buff-white", high albedo [S6]; marble is 0.83 / 0.79 / 0.75 [S4] |
| Fresh snow | 0.81-0.85 | 0.85 | 232-237 | [S3], [S4] |
| Painted steel, olive drab (FS 34087 swatch) | about 0.125, 0.117, 0.037 | about 0.11 | 99, 96, 54 (#636036) | [S7] (swatches disagree: #675C2E, #574A3A) |
| Painted steel, desert tan (FS 33446 swatch) | about 0.457, 0.337, 0.216 | about 0.35 | 180, 157, 128 (#B49D80) | [S7] |
| Rust (a dielectric oxide, metallic 0) | 0.181, 0.057, 0.017 | 0.080 | 118, 68, 35 | [S4] |
| Glass (soda-lime), transmissive | 0.98, 1.0, 1.0 (transmission colour) | n/a | n/a | [S4] |
| Glass seen as an opaque game surface (est.) | 0.02-0.05 base colour, roughness 0.05-0.2 | 0.02-0.05 | 39-63 | (inference: an RTS window shows a dark reflective surface, not its transmission colour) |
| Skin, mid tones | 0.623, 0.433, 0.343 / 0.436, 0.227, 0.131 | 0.47 / 0.27 | 207, 176, 158 / 176, 131, 101 | [S4] (Skin III, IV) |
| Iron (metal F0) | 0.560, 0.570, 0.580 | about 0.57 | 197, 198, 200 | [S3] (PB: 0.53, 0.51, 0.49) |
| Stainless steel (metal F0) | 0.669, 0.639, 0.598 | 0.64 | 214, 209, 203 | [S4] |
| Aluminium (metal F0) | 0.913-0.916, 0.92, 0.92 | 0.92 | 245, 246, 246 | [S3], [S4] |
| Chromium (metal F0) | 0.55-0.65, 0.56-0.69, 0.55-0.70 | 0.56-0.68 | 194-218 | [S3], [S4] (sources differ) |

Notes:

- **The brief's "charcoal 0.04" is high.** Both measured sources give 0.02. A community chart
  gives 0.04 for coal [S5]. Use 0.02-0.04 as the darkest dielectric band.
- **Paint swatches are not measurements.** Military paint chips come from modelling-paint sites,
  and they disagree [S7]. Treat the olive and tan rows as a band, about ±0.03 luma. Note that
  olive drab is a very dark paint, about 0.11 luma: darker than bare soil. A game that draws it
  lighter is making a readability choice, and should say so (see `game-mapping.md` §2).
- **Real roughness for these materials is not in the databases.** The Physically Based database
  lists nominal roughness values (sand 1.0, concrete 0.5, tyre 0.7, rust 1.0) [S4]. Use them as
  starting points only; §3 gives the wear ranges.

## 3. Roughness by material and wear

These are working ranges (est.), consistent with the database's nominal values [S4] and the
Unreal guide's description of roughness [S3]. Shift them per asset only with a reason.

| Material | New | Worn / dusty | Notes |
|---|---|---|---|
| Matte military paint (CARC-like) | 0.70-0.85 | 0.85-0.95 | Matte by design, so a low roughness reads as plastic |
| Gloss or civilian vehicle paint | 0.25-0.45 | 0.5-0.7 | The clear coat dulls under dust |
| Bare steel at a wear edge | 0.30-0.45 (metal 1) | 0.45-0.6 | A thin bright line, never a large area |
| Gunmetal / blued weapon steel | 0.35-0.5 (metal 1) | 0.5-0.6 | |
| Rubber, tyres, tracks | 0.85-0.95 | 0.95-1.0 | Dust raises it to 1 |
| Glass | 0.05-0.15 | 0.2-0.4 | Dust and grime on windscreens |
| Fabric, webbing | 0.85-0.95 | 0.95-1.0 | |
| Skin | 0.45-0.6 | 0.6-0.7 | |
| Wood (weathered) | 0.75-0.9 | 0.9-1.0 | |
| Concrete, limestone, render | 0.8-0.95 | 0.9-1.0 | |
| Sand, soil, dust | 0.95-1.0 | 1.0 | |
| Wet versions | subtract 0.3-0.5, darken albedo 10-30% (est.) | | Wetness both lowers roughness and darkens albedo |

**Wear direction.** Dust and dirt raise roughness and pull albedo toward the ground's colour. Use
and abrasion lower roughness and expose the layer beneath (inference).

## 4. When metalness is wrong, and why an RTS caps metal

**Wrong metalness, by symptom:**

1. **Painted surfaces marked metal.** A painted hull is a dielectric, metallic 0, whatever is under
   the paint. Only exposed bare metal is metallic [S3].
2. **Rust marked metal.** Rust is an oxide, a dielectric (metallic 0 in [S4]).
3. **A metal with a dark base colour.** A metal's base colour is its F0, at least about 0.5 linear
   and 170 sRGB [S2]. A dark metal reads as a black hole with no diffuse term.
4. **Grey metalness values used as a "half shiny" control.** That is a roughness job. Grey
   metalness is physically a mix of the two classes, valid only at transitions [S2], [S3].

**Why an RTS often caps metal** (inference, consistent with the sources):

- A metal has no diffuse term, so it is only as bright as what it reflects. With weak or no
  environment light, a fully metallic surface goes near-black in shade. Roaring Lions measured
  exactly this. Its metal cap is 0.45 without an environment and 0.7 with the sky environment
  (`environment-classes.ts`).
- At 25-125 px, a mirror-like metal shows aliasing sparkle as the camera pans, because its highlight
  is narrower than a pixel. Filament's roughness clamp exists partly for this [S2].
- Metal takes its colour from the environment, which pulls hue away from the authored palette.
  That weakens faction and value reads.
- **Recommendation.** Keep metals rough (≥0.35) and small in area: weapons, wear edges, tracks,
  antennas. Keep painted hulls dielectric. If the cap stays below 1, document it as a deliberate
  stylisation. A capped metal is no longer physically a metal, so its base colour can sit a little
  lower than 170 sRGB (inference).

## 5. Edge wear, dirt and dust consistency

The goal is one wear grammar across all assets (inference unless cited):

- **Define it once, per theme.** A theme has one dust colour (in Roaring Lions, a ramp key per
  theme: `dust.*` arid, `karst.*` highland, `mud.*` wetland). Every asset's lower third, wheel
  wells and horizontal surfaces take that colour. Driving it from the terrain the unit stands on,
  as Company of Heroes 3 does [S8], keeps a unit consistent with every map.
- **Wear amount by class** (est.): vehicles 5-15% of the visible surface, infantry kit 3-8%,
  buildings 10-25% (weathering, not chips). Edge chips are one to two pixels wide at game zoom or
  they vanish. Use a few large wear areas, not many small ones.
- **Gravity and exposure.** Dust collects on upward-facing surfaces and in crevices. Streaks run
  down. Wear happens on edges that are touched or struck. Snow-on-top logic is the template:
  Company of Heroes 2 lays snow on upward normals and masks it from a top-down depth map [S9].
- **Prefer runtime wear to baked wear.** Company of Heroes 3 stopped baking wear and accumulates
  grime from the terrain crossed [S8]. A runtime mask (world-up normal × noise × a per-unit
  amount) costs one shader term and stays consistent across assets (inference).
- **Match the albedo shift to the ground.** A dusty panel's albedo should move toward the ground's
  albedo, not toward grey. Its roughness should move toward 1.

## 6. Baked AO versus runtime AO

- **Where AO goes.** Ambient occlusion should darken only indirect (ambient and environment)
  light, not direct sunlight [S10]. A baked AO multiplied into the albedo darkens the sunlit side
  too. That is the classic "dirty" baked look, and it fights the real sun.
- **Combine scales with `min`, not a product.** Medium-scale AO is baked, large-scale AO comes from
  screen space, and `min(AO_baked, AO_screen)` avoids double darkening [S10].
- **StarCraft II ignored baked AO when SSAO was on** [S11]. That is a strong precedent for
  dropping baked AO from units once a runtime AO pass exists.
- **Specular occlusion.** Without it, cavities still reflect the sky. Filament's horizon fade
  (`horizon = min(1 + dot(r, n), 1)`, squared) is a cheap fix for reflections that point into the
  surface [S10].
- **Recommendation for an RTS with GTAO** (inference). Bake only micro-cavity AO, a "cavity map"
  with a very short trace distance [S3], and route it through the glTF occlusion slot. Never
  multiply it into the base colour. The runtime AO handles contact between unit and ground.

## 7. Texel density, and normal maps at RTS distance

- **Texel density.** Hold one texels-per-metre target per class, so neighbours do not show
  different sharpness (est.). Roaring Lions' budgets imply one already: vehicles 2560 px, buildings
  2048 px, infantry 3072 px (`CLAUDE.md`, team mark section). For a 7 m vehicle unwrapped at
  about 60% efficiency on a 2048 map, that is about 175 texels per metre (est.). At gameplay zoom a
  vehicle is about 100-125 px long, so it has about 15-20 screen pixels per metre. Every texel above
  roughly 2-4 per screen pixel at the closest zoom is spent only on download and memory (inference).
- **Normal maps at distance.** At 25 px a soldier's normal-map detail is below a pixel. The mips
  average normals toward flat, and the detail disappears. Roaring Lions' lead judged normal/ORM
  maps on the Lavi "invisible" at +42.7 MiB of GPU memory, and shipped base colour alone (`CLAUDE.md`).
  This is the expected result, not a failure.
- **What reads instead:** geometric bevels that catch the sun (`webgpu-and-blender.md` §5.1),
  value painted into large panels, and roughness differences between material classes.
- **When normal maps do pay.** On buildings and large props seen at close zoom, on terrain
  (through triplanar or detail maps), and in the garage close-up. Consider a normal map only for
  the garage LOD (inference).
- **Specular aliasing.** Where normal maps are kept, raise roughness with mip level (Toksvig-style
  or Filament's clamp) to stop sparkle [S2].

## 8. Stylised PBR that stays physically consistent

A stylised game can stay physically consistent by stylising its inputs, not its maths (inference
from [S1], [S2], [S12]):

1. **Keep the BRDF and the light units.** Stylise base colour (palette ramps), shape (exaggeration,
   bevels) and grading (the LUT), not the shading model.
2. **Compress the albedo range, do not break it.** Roaring Lions draws authored colour from a
   palette. Keep every diffuse albedo within Filament's tolerant 30-240 sRGB range [S2] and within
   the ground's band per §2.
3. **Use one light rig for every asset.** One sun, one sky and one exposure. No per-asset lights.
4. **Stylise the frame, not the asset.** Colour grading after the tone mapper keeps every asset
   moving together. AgX is described as "a better foundation for color grading" [S13].
5. **Exaggerate with value contrast, not with fake light.** A painted highlight or painted AO is
   baked lighting, which a rotating unit carries with it (style bible §1).

## 9. Outdoor daylight: sun, sky and fill ratios

**Measured illuminance on a clear day** (Filament, California, March) [S2]:

| Time | Sun (lux) | Sky (lux) | Sun : sky |
|---|---|---|---|
| 10:00 | 100,000 | 20,000 | 5.0 : 1 |
| 12:00 | 105,000 | 25,000 | 4.2 : 1 |
| 17:30 | 81,000 | 9,000 | 9.0 : 1 |

So the 4:1 to 10:1 band in the brief is right for clear skies. Lower ratios mean haze or overcast.
Higher ratios come with low sun and clear dry air, such as a desert evening.

**In an RTS frame** (inference):

- **Key** is the sun. It is set for the camera, not for realism: a **side** light from the
  camera's left gives every box a lit face and a shaded face, and drops shadows beside the
  caster. Roaring Lions settled this in its `SUN_DIRECTION`.
- **Fill** is the sky dome. Its colour sets the colour of the shade: blue at day, warm gunmetal at
  dusk. A lit-to-shade ratio of about 3:1 to 6:1 on vertical faces keeps form readable at 25 px
  (est.). Above about 8:1 the shaded faces of dark olive units approach black.
- **Bounce** is ground-coloured light from below. It is small, but it ties the unit to the ground's
  hue.
- **Rim** has no physical source outdoors. In an RTS it is a readability tool, and is best
  restricted to a gameplay state (Roaring Lions uses one for KDF figures in rain).

## 10. Exposure and the tone mapper

**Exposure.** In physical units, exposure is `1 / (1.2 × 2^EV100)` [S10]. A sunny day sits around
EV100 15 (the "sunny 16" rule; est., Filament's excerpt does not give it). three.js scenes rarely
use physical units. They pick light intensities near 1-3 and keep exposure at 1.0, which is fine
as long as one exposure serves every scene. Never tune exposure per asset (inference).

**The tone mapper decides how saturated colours survive.**

| Tone mapper | Character | Effect on saturated team and VFX colour |
|---|---|---|
| ACES Filmic (three's fit) | Boosts contrast and tends to darken [S13]. Built for a dark theatre, with three.js adjustments for a brighter room [S13] | Changes hue, not just intensity: at high intensity "oranges will end up yellow" and water turns cyan [S13]. Limited reach for bright yellow, green and cyan on sRGB, so objects can look washed out [S14] |
| AgX | A deliberately low-contrast default look [S13], with bright colours going toward white "similar to real cameras" [S15]. Less saturated than ACES by design [S16] | Best preservation of hue in highlights, at the cost of saturation. Needs a grade (contrast and saturation) to look finished [S13], [S16] |
| Khronos PBR Neutral (`NeutralToneMapping`) | Made for faithful base-colour reproduction under grey light [S14]. No hue shifts, and exact reproduction for base colours with channels in 0.08-0.8 (output = input − F90) [S17] | Best for keeping authored palette and team colour exact. Highlights compress later and desaturate (K_d 0.15) [S17]. One user found it a little over-saturated [S13] |

**For an RTS with authored palette colour and saturated team colours** (inference):

- The choice matters most at the top of the range: effects above 1.0, sunlit team panels, bright
  ground. Below about 0.6 linear, all three keep hue roughly.
- **Neutral** keeps the palette closest to authored values, which suits a palette-driven game, but
  it needs a grade for mood.
- **ACES** gives contrast "for free" but skews saturated team blues and fire oranges. If ACES
  stays, measure every team colour (and its colour-vision variants) after the output transform,
  under every time of day, and gate the delta.
- **Switching tone mappers moves every pixel.** In Roaring Lions it would need a full re-bless and
  the lead's approval. Run it as an A/B mock first, never as a fix.

## 11. Environment lighting

- **Image-based light (IBL)** gives a material's specular something to reflect, and gives the
  shade the sky's colour. A material with no environment shows only the sun's specular lobe
  (inference, measured in Roaring Lions: metals went near-black without it).
- **A hemisphere light** is the cheapest sky: sky colour from above, ground colour from below, no
  specular. It is fine for diffuse fill, but metal and glass need a real environment.
- **Per-class environment strength.** Diffuse ground textures already carry their own shading
  ratio, and an environment washes them out. Decals, smoke and FX should not take one either.
  Roaring Lions hands out its environment per material class, with an exact zero for ground,
  decals, smoke, FX and the backdrop. It avoids `scene.environment`, because three.js 0.186 reads
  one global intensity from it (`environment-classes.ts`). This is a sound, project-specific
  practice.
- **Procedural over downloaded skies.** A sky gradient built from palette keys keeps the
  environment in the palette, with no licence question. That is Roaring Lions' approach. A real
  HDRI would bring hue the palette does not hold.
- **Specular occlusion** stops cavities from reflecting sky (§6).

## 12. Shadows, time of day and dusk

- **Camera-fitted box versus cascades.** For an orthographic or dimetric camera, depth range across
  the view is small and roughly uniform, so one shadow box fitted to the view gives even texel
  density. Cascades exist for perspective cameras, where near objects need more texels than far
  ones (inference). Roaring Lions' view-fitted 4096² box, snapped to whole texels to stop crawl, is
  the right choice. three.js offers cascaded shadows as `CSM` for `WebGLRenderer` and
  `CSMShadowNode` for `WebGPURenderer` only [S18], should a perspective camera ever arrive.
- **Bias.** `normalBias` offsets the lookup along the surface normal [S19]. Community starting
  points: bias about −0.0005 with `normalBias` about 0.02 [S19] (third-party). These are exactly
  Roaring Lions' values in `lighting.ts`. Raise `normalBias` on curved surfaces. Check for detached
  ("Peter Pan") shadows at unit contact at the closest zoom.
- **Softness.** Contact shadows are sharp and get softer with distance from the caster. A uniform
  blur radius on a single map cannot reproduce that. PCSS-style variable penumbra costs a blocker
  search (est. 1-3 ms at 4096² on mid GPUs). At RTS distance a small fixed radius plus AO usually
  reads well enough (inference).
- **Dusk.** The sun drops (Roaring Lions: elevation 18° at dusk, 22° at dawn) and shadows lengthen
  by about 3× (1/tan 18° ≈ 3.1 against 0.7 at 55°). The sun warms and the sky cools, and the
  sun-to-sky ratio rises toward the 9:1 in the table above. Long shadows can hide units, so keep the
  shadow intensity under 1 on dusk maps, or raise the fill (inference). Roaring Lions already has a
  per-mission `light.fill` and `light.shadow` override.

## 13. Matching a baked or generated asset to scene lighting

AI-generated textures (Meshy) and photogrammetry share a problem: lighting baked into the
albedo. Meshy's retexture API has `remove_lighting`, default true. It removes highlights and
shadows from the base colour [S20]. A third-party guide says some model versions ignore it or
reject it [S21] (unverified), so check every bake.

**De-lighting procedure** (inference, after Unity's de-lighting tool, which uses AO, normal and
bent-normal maps to remove baked light from scans [S22]):

1. **Measure first.** Render the asset's base colour unlit and compute luminance statistics: mean,
   5th and 95th percentile, per material role (hull, rubber, metal, glass).
2. **Remove baked AO.** Bake the asset's own AO in Blender. Where the albedo correlates with that
   AO, divide it out: `albedo / mix(1, ao, k)`, with `k` fitted so the correlation reaches about 0.
   Clamp the result.
3. **Remove baked directional light.** Bake a world-space normal map. If luminance correlates with
   one direction (the top or one side is brighter), fit `luma ≈ a + b·dot(n, d)` and divide the
   term out. A good de-lit bake has no correlation between luminance and normal direction.
4. **Remove highlights.** Clip or inpaint texels whose luminance exceeds the 99th percentile of
   their role.
5. **Normalise luminance per role.** Scale each role so its mean lands on the target albedo band
   (§2 or the palette ramp it maps to), keeping hue. Roaring Lions already normalises the ground's
   albedo as a ratio to its measured mean, and records a vehicle bake's luma as `rl_bake_luma`.
6. **Check under the game's light.** Render the asset with the game's sun, sky and tone mapper
   beside a palette-coloured neighbour. Rotate it 360°. A remaining baked shadow rotates with the
   hull and gives itself away.

## 14. One world: the look-dev rig and reference values

Every asset is judged in the same rig before it is approved (inference; this is standard VFX and
games practice, and Filament's calibration notes use a grey card and colour checker [S10]):

- **A grey ball** at 18% albedo: linear 0.18, sRGB 118 [S4]. It shows the key-to-fill ratio and the
  shadow colour.
- **A chrome ball:** metallic 1, roughness about 0.05. It shows the environment and the sun's
  position.
- **A 24-patch colour chart** (ColorChecker). Neutral 5 is sRGB #7A7A7A (122, 122, 122), about
  18-20% reflectance [S23]. Under the game light and tone mapper, the chart's neutrals must stay
  neutral, and its row must keep its order.
- **The game's own references.** Add a palette swatch board: each ramp as a matte card, both team
  colours as matte panels, and the reference unit for the class (style bible §1, the rifleman,
  `technical` and `mbt_lavi`).
- **The same light as the game.** The same sun direction and colour per time of day, the same sky
  gradient, hemisphere and intensities, the same exposure and tone mapper.
- **The same camera.** Dimetric at 30° elevation, azimuth 225°, at default, minimum and maximum
  zoom, at the target pixel sizes. Add a close turntable only for the garage.
- **Readings to record:** the lit and shaded luminance of the grey ball, the chart's Neutral 5
  value after the tone mapper, and the asset's lit-top luminance against the ground under it.

## 15. The matching checklist

Follow it in order for any new asset or effect. Each step names what to record. Respect the
project's rules throughout: palette keys for authored colour, presentation only, no new libraries
without the lead, the lead approves art numbers before any render, and every change passes the
visual gate.

**A. Before any render (numbers for the lead)**

1. **Class and neighbours.** Name the class and the reference asset for it (style bible §1), plus
   the two closest neighbours the asset will stand beside in play.
2. **Reference values.** Read the neighbours' base-colour luminance per role, their roughness and
   metalness from `SURFACE_PARAMS` or the GLB, and their texel density. Write them down.
3. **Albedo band.** Map each role to a palette ramp key and its linear luminance. Check it against
   §2 (a matte paint is a dielectric between 0.04 and 0.6) and Filament's 30-240 sRGB [S2].
4. **Roughness and metal.** Assign a surface class per role. Painted surfaces are dielectric.
   Metal is only bare metal, capped at the project's metal cap. Use §3 for roughness.
5. **Team colour.** Decide where the mark goes (top surfaces, about 2-6% of a vehicle, one element
   on infantry) and confirm it is a runtime mask, not paint.
6. **Budget.** Triangles for the class (style bible §3), texture size against the class budget,
   draw calls.
7. **Get the lead's approval of these numbers** before generating or rendering.

**B. Build**

8. Model at real metres with bevels that catch the sun (`webgpu-and-blender.md` §5.1).
9. No baked lighting: no painted highlights, AO or shadows in the albedo. For a Meshy texture, use
   `remove_lighting` and then de-light (§13).
10. Split the roles into named nodes so the runtime surface table can find them.

**C. Test under the game's light**

11. Put the asset in the look-dev rig (§14): game sun, sky and environment class, ACES at exposure
    1.0, the grade for each time of day.
12. Check the grey ball and chart readings match the recorded rig values, so the rig itself is
    right.
13. Check the asset's role luminances after the tone mapper against its neighbours. Each role
    should stay within one palette ramp step of its neighbour's matching role unless it is meant
    to stand out.
14. Rotate it 360° to check for baked light, and look for black metal in shade.

**D. Test in the game**

15. Sandbox the asset on each theme it will appear on (`?sandbox=<map>`), at default, minimum and
    maximum zoom, at dawn, day and dusk, and in rain where relevant. Use one Metal browser check on
    your own port, with music off.
16. **Squint test.** Desaturate and blur the capture. The unit must separate from the ground, and
    its role must be readable from its silhouette (`readability-and-direction.md` §3).
17. **Busiest frame.** Repeat with smoke, fire and an explosion near it.
18. **Team colour.** Check own, hostile and neutral, and every colour-vision variant, after the
    output transform.
19. **Effects** (for a VFX): only effects exceed 1.0, gains come from `hdr-gains.ts`, the quiet
    frame stays under the bloom census, and duration is inverse to brightness.

**E. Gate**

20. `pnpm validate:meshes` for silhouette IoU, palette and budgets. `pnpm validate:data` for
    emitters.
21. Visual gate: expect movement where the asset appears. Bless from CI numbers only, after
    looking at the picture.
22. Record the readings from steps 2, 12, 13 and 16 in the PR description, so the next asset can
    match this one.

---

## Sources

- [S1] Self Shadow, SIGGRAPH 2013 course "Physically Based Shading in Theory and Practice" (Karis, "Real Shading in Unreal Engine 4"; Hoffman's background notes) — https://blog.selfshadow.com/publications/s2013-shading-course/
- [S2] Filament, "Physically Based Rendering in Filament" (materials, roughness clamp, sun and sky illuminance) — https://google.github.io/filament/Filament.md.html
- [S3] Epic Games, "Physically Based Materials in Unreal Engine" — https://dev.epicgames.com/documentation/en-us/unreal-engine/physically-based-materials-in-unreal-engine
- [S4] Physically Based database, materials API v2 (fetched 2026-11-09) — https://api.physicallybased.info/v2/materials (site: https://physicallybased.info/)
- [S5] Community albedo chart (coal 0.04; snippet) — https://blog.csdn.net/cubesky/article/details/106095521
- [S6] Reflectance spectroscopy introduction (limestone "buff-white, high albedo") — https://ser.im-ldi.com/SPECTRA/intro.html
- [S7] Paint swatches for FS 34087 and FS 33446 (modelling-paint references, approximate) — https://scalemates.com/ro/colors/model-master--650/1911-olive-drab-fs34087-enamel-matt--10195 and https://wheelswingshobbies.com/akirc885-ak-interactive-real-colors-carc-tan-686a-fs-33446-17-ml/
- [S8] TheSixthAxis, CoH3 art and authenticity dev diary — https://www.thesixthaxis.com/2022/04/22/company-of-heroes-3-dev-diary-trailer-art-and-authenticity/
- [S9] Daniel Barrero, CoH2 rendering technology — https://www.slideshare.net/proyZ/daniel-barrero-coh2renderingtech
- [S10] Filament (exposure, diffuse and specular occlusion, horizon occlusion), second half of [S2] — https://google.github.io/filament/Filament.md.html
- [S11] Filion and McNaughton, "StarCraft II: Effects & Techniques" — https://www.advances.realtimerendering.com/s2008/SIGGRAPH2008%20-%20StarCraftII.pdf
- [S12] Lagarde, "Feeding a physically based shading model" (referenced via search; original not opened) — https://seblagarde.wordpress.com/2011/08/17/feeding-a-physical-based-lighting-mode/
- [S13] three.js forum, "Tone mapping overview" — https://discourse.threejs.org/t/tone-mapping-overview/75204
- [S14] Khronos, PBR Neutral tone mapper press release — https://www.khronos.org/news/press/khronos-pbr-neutral-tone-mapper-released-for-true-to-life-color-rendering-of-3d-products
- [S15] Blender 4.0 release notes, colour management (AgX) — https://developer.blender.org/docs/release_notes/4.0/color_management/
- [S16] three.js forum, "Is AgX tonemapping implemented correctly?" (snippet) — https://discourse.threejs.org/t/is-agx-tonemapping-implemented-correctly/60609
- [S17] KhronosGroup/ToneMapping, PBR Neutral README — https://github.com/KhronosGroup/ToneMapping/blob/main/PBR_Neutral/README.md
- [S18] three.js docs, CSMShadowNode (WebGPURenderer only) — https://threejs.org/docs/pages/CSMShadowNode.html
- [S19] three.js docs, LightShadow (`normalBias`); bias starting points from a community article — https://threejs.org/docs/pages/LightShadow.html and https://salivity.github.io/three.js/article/three-js-shadow-bias-for-directional-lights
- [S20] Meshy API, retexture (`remove_lighting`, `enable_pbr`) — https://docs.meshy.ai/api/retexture.md
- [S21] Third-party Meshy 6 retexture guide (unverified claims about model versions) — https://aiidelist.com/blog/meshy-6-retexture.md
- [S22] Unity blog, experimental De-Lighting tool — https://blog.unity.com/en/technology/experimental-feature-de-lighting-tool
- [S23] Wikipedia, ColorChecker (Neutral 5 #7A7A7A); BabelColor RGB coordinates — https://en.wikipedia.org/wiki/ColorChecker and https://mail.babelcolor.com/index_htm_files/RGB%20Coordinates%20of%20the%20Macbeth%20ColorChecker.pdf
- Project facts (read-only, `origin/main` on 2026-11-09): `CLAUDE.md`, `docs/art/style-bible.md`, `packages/render/src/three/environment-classes.ts`, `units/unit-surface.ts`, `time-of-day.ts`, `lighting.ts`.
