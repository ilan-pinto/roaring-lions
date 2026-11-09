# Roaring Lions against the research: what is right, the gaps, and the best WebGPU bets

Part 4 of the Roaring Lions RTS art research (2026-11-09). This file compares the shipped game
(`origin/main` at 49bb60cfe, read only) with the other four files. It lists what the game already
does right, ranks the art and lighting gaps by visual impact, maps the twelve principles of
`leading-rts-best-practices.md` §13 onto the game, and names the WebGPU techniques with the best
gain for the cost.

It is for context and planning. **Nothing here is approved.** Every proposal below needs the
lead's approval of its art numbers before any render, must stay presentation-only, must take
authored colour from palette keys, adds no library without the lead, and must pass the visual gate
(blessed from CI numbers, after looking at the picture).

**Notation.** **(est.)** marks an estimate. **(inference)** marks my own reasoning. The research
files are cited by name. Project facts cite their file on `origin/main`.

## Contents

1. [What the game already does right](#1-what-the-game-already-does-right)
2. [Measured: the palette's values against real albedo and the ground](#2-measured-the-palettes-values-against-real-albedo-and-the-ground)
3. [The lighting rig, in the research's terms](#3-the-lighting-rig-in-the-researchs-terms)
4. [Gaps ranked by visual impact](#4-gaps-ranked-by-visual-impact)
5. [The twelve principles: followed or gap](#5-the-twelve-principles-followed-or-gap)
6. [WebGPU techniques with the biggest visible gain for the cost](#6-webgpu-techniques-with-the-biggest-visible-gain-for-the-cost)
7. [Sources](#7-sources)

---

## 1. What the game already does right

Each row is a practice the research recommends that the game already follows, with where it lives.

| Practice (research file) | In the game | Where |
|---|---|---|
| A standard, linear colour pipeline (materials §1, §10) | sRGB output, ACES at exposure 1.0 in `OutputPass`, linear vertex and uniform colours (`hexToLinear`), every world material a `MeshStandardMaterial` | `CLAUDE.md`, `renderer.md` |
| Data textures are not colours (webgpu §5.3) | Ground albedo textures are `NoColorSpace` ratios to their own mean, and every base-colour map is sRGB | `CLAUDE.md`, `terrain-rendering.md` |
| The sun chosen for the camera (materials §9) | A side light, `SUN_DIRECTION (-0.406, 0.819, 0.406)`, from the camera's left, so every box has a lit and a shaded face and shadows land beside casters | `renderer.md` |
| A camera-fitted shadow box for an orthographic view (materials §12) | A 4096² box refit to the view, snapped to texels, about one texel a screen pixel, with map-wide depth. Bias −0.0005 and normalBias 0.02 are the standard starting values | `shadow-fit.ts`, `lighting.ts` |
| An environment for metals, exact zeros for ratio surfaces (materials §11) | Per-class `envMap` and intensity (unit metal 0.6, dielectric 0.3, building 0.2, glass 0.6, prop 0.3; ground, decal, smoke, FX and backdrop none). `scene.environment` held null by a test | `environment-classes.ts`, `environment.ts` |
| A procedural sky from palette keys (materials §11) | A CPU gradient (preset sky key, sun key at the horizon, `dust.4` below), PMREM-filtered, no downloaded HDRI | `environment.ts` |
| Hemisphere strength solved by measurement, not by eye (materials §15) | The census solved 0.70 / 0.82 / 0.65 so the frame's brightness did not move when the ground lost its environment | `environment-classes.ts` |
| Metal capped for a measured reason (materials §4) | 0.45 with no environment (metal went near-black), 0.7 with it. Painted classes are dielectric | `unit-surface.ts`, `environment-classes.ts` |
| Roughness per material role (materials §3) | cloth 0.92, rubber 0.96, gunmetal 0.42, glass 0.2, armour 0.78, plate 0.7, skin 0.6, wood and gear 0.8, leather 0.7. Wet values for rain | `unit-surface.ts` |
| No baked light in assets (materials §13) | The style bible forbids painted highlights, AO and shadows, and asks Meshy for `remove_lighting` | `docs/art/style-bible.md` §1 |
| Silhouette first, gated (readability §2) | IoU < 0.88 at 64 px between every pair of units. Roles told apart by posture, weapon angle and mass. Size changes only through `SIZE_CLASS` | style bible §1, `validate:meshes` |
| Saturated hue and brightness reserved for effects (readability §7) | A reserved VFX band, bloom only above 1.0, HDR gains in one table, quiet frames held under 0.9 by `perf:bloom-census` | `palette.json`, `hdr-gains.ts`, `renderer.md` |
| A small team mark on top surfaces (readability §5) | The Lavi's procedural mark, about 2% of the surface: a roof panel and turret flank bands, in object space, keeping 30% of the bake's grime | `team-mask.ts` |
| Status marks off the world mesh (readability §8) | Kit reads on icons, not in the world (the lead's ruling) | `CLAUDE.md` |
| The ground records the fight (best practices P5) | A decal pool aged on the sim clock, ratio-multiplied onto the lit ground, crater rims with normals, procedural wrecks with cut damage | `renderer.md`, `CLAUDE.md` |
| What is seen equals what the sim does (P3) | The relief read, crowns and haze are derived from the sim's own grid; smoke keeps own outlines and hides enemy ones | `terrain-rendering.md`, `CLAUDE.md` |
| Capped effect cost (P11) | GTAO at half resolution, bloom at quarter, presets that drop them | `renderer.md` |
| Weight and motion (P9) | Vehicle weight, conform and running gear; an infantry motion standard | `CLAUDE.md`, memory |
| A grade per time of day, with a team-colour gate planned (materials §8) | `data/grades/dawn.json` and `dusk.json`, a LUT pass with dither, a planned delta-E gate on team colours | look-uplift spec §3, §8 |
| Banding fixed at the source (webgpu §4) | The output dither runs every frame on both paths | `webgpu-backend.md` |
| Texture memory as a ratchet (materials §7) | Per-class budgets (vehicle 80 MiB / 2560 px, building 64 / 2048, infantry 32 / 3072), and normal/ORM maps rejected as invisible at +42.7 MiB | `CLAUDE.md` |
| Every gate falsified (checklist step 21) | Layer checks set at a third of the smallest measured run, each watched going red | `CLAUDE.md`, `visual-gate.md` |

This is a strong base. The rig is calibrated, measured and gated, which most of the research
only recommends.

## 2. Measured: the palette's values against real albedo and the ground

Linear luminance of each palette entry, computed from `data/palette.json` with the sRGB decode
(ramps run light to dark):

| Ramp | Linear luminance per entry |
|---|---|
| limestone | 0.814, 0.697, 0.584, 0.471, 0.373, 0.276, 0.193, 0.130, 0.081 |
| dust | 0.515, 0.418, 0.333, 0.252, 0.184, 0.132, 0.089 |
| olive (KDF hulls, uniforms) | 0.279, 0.163, 0.082, 0.036 |
| gunmetal | 0.564, 0.290, 0.118, 0.042 |
| scrub | 0.218, 0.089 |
| grass | 0.713, 0.569, 0.450, 0.370, 0.280 |
| karst | 0.597, 0.382, 0.236, 0.143, 0.077 |
| fen | 0.300, 0.116 |
| mud | 0.178, 0.111, 0.066, 0.036, 0.019 |
| team: kedem / hostile / neutral | 0.170 / 0.180 / 0.565 |
| VFX: white_hot / fire / tracer | 0.917 / 0.542 / 0.824 |

Readings (inference):

1. **The ramps cover real albedo well.** Dust spans 0.09-0.52, around real sand at 0.36-0.39 and
   concrete at 0.51 (`materials-and-lighting.md` §2). Mud covers wet soil and charcoal-dark bands.
2. **`limestone.0` (0.814) is snow-bright.** Real limestone was not found measured; marble is 0.79.
   Used as a large lit roof, it sits near the top of the tone curve. The bloom census keeps quiet
   frames under 0.9, so it is safe today; any brighter sun or grade would clip it first.
3. **KDF olive is lighter than real olive drab, on purpose or not.** `olive.1` at 0.163 is about
   1.5× the real FS 34087 swatch (about 0.11). That helps readability, so it is a good choice to
   write down rather than "correct".
4. **Olive on scrub is a value tie.** `olive.1` 0.163 against `scrub.0` 0.218 and `dust.4` 0.184: a
   KDF hull on scrub or mid-dust differs from the ground by under 30% in luminance. It separates by
   hue and by its shadow, not by value. This is the main squint-test risk on arid maps.
5. **Team colours are darker than the desert.** Kedem blue 0.170 and hostile red 0.180 sit below
   most of the dust and limestone ground. On arid maps team colour reads by hue and saturation
   only, never by value. In the greyscale squint test a team mark vanishes. Under ACES the
   saturated blue's hue also shifts at high intensity (`materials-and-lighting.md` §10).
6. **The grass ramp is the brightest, most saturated ground** (0.28-0.71, the most chroma of any
   ground ramp). Green maps are where the ground most competes with units, as the wetland's own
   figure-ground metric already anticipates.

## 3. The lighting rig, in the research's terms

Computed from `time-of-day.ts`, the palette and the census values (est.; it assumes three.js's
physical light convention, see `webgpu-and-blender.md` §5.6):

- **Day sun on horizontal ground:** 2.6 × sun.y 0.819 × the luminance of `limestone.0` (0.814) ≈
  **1.73**.
- **Day sky on horizontal ground:** hemisphere 0.82 × the luminance of `water.0` (0.525) ≈ **0.43**.
- **Sun to sky ≈ 4:1.** That is the clear-noon end of Filament's measured 4.2:1-9:1 band. It is a
  soft, readable fill: shaded faces stay well clear of black.
- **Lit to shaded vertical face** (a face turned to the sun's azimuth against one turned away) ≈
  (1.21 + 0.29) : 0.29 ≈ **5:1** (est.). That is inside the 3:1-6:1 band
  `materials-and-lighting.md` §9 suggests for form at 25 px.
- **Calibration.** Lit open ground displays at about `(2.13 + 0.82) / π ≈ 0.94` × albedo before the
  tone mapper, so the scene's albedo and its displayed linear value are nearly the same. That
  makes palette values directly comparable to the frame (inference).
- **Dusk** has the sun at 18°, so shadows are about 3× longer, with a warm `dust.0` sun at 1.8 and
  a `gunmetal.1` sky. The sun-to-sky ratio is lower than day, because the sun is lower and dimmer,
  where the real world goes the other way. That is a readability choice, and long dusk shadows
  make it a good one.

## 4. Gaps ranked by visual impact

Ranked by how much the frame would improve, then by cost. "Visual impact" is my judgement from
the research. Each proposal needs the lead's approval of its numbers first.

1. **No value gate between units and ground** (high impact, low cost). IoU guards shape, but
   nothing guards value. §2 shows `olive.1` on scrub and dust under 30% apart, and team colours
   below the ground's value. **Proposal:** a report-only instrument, then a gate. For each unit
   class on each theme at default zoom, measure the linear-luminance step between the unit's lit
   top and the ground ring around it. Falsify it with a unit recoloured to the ground's key.
   (Principle P1, readability §2-§3.)

2. **Two asset families, two looks: Meshy bakes against palette-role meshes** (high impact, medium
   cost). Most shipped vehicles, buildings and several infantry teams are textured exemptions with
   Meshy bakes (`TEXTURED_*_EXEMPT`, `validate_mesh_assets.py`). The rest are coloured at runtime
   from role ramps. `validate:meshes` does not palette-check the exempt types. A bake with residual
   baked light, a different mean luminance or a different saturation sits in a different world
   from its palette neighbour. **Proposal:** a per-role luminance and saturation report for every
   bake against its palette role's band, plus the de-lighting checks (`materials-and-lighting.md`
   §13: luminance against normal-direction correlation, AO correlation, highlight clipping). Then
   normalise per role with the lead's approval. `rl_bake_luma` already records one number per
   vehicle; extend it per role.

3. **Team colour reaches only one vehicle body** (high impact, medium cost). The L3 mark ships
   on the Lavi alone. Every other vehicle, and every infantry figure, carries team colour only
   through rings, outlines, the minimap and icons. **Proposal:** roll the mark out by vehicle
   class (a table per vehicle, like `lavi_mark.py`), and find a one-element infantry equivalent
   (a helmet band or pack panel through the same object-space test) for the lead to judge on a
   mock. Gate team colour after the output transform and every grade.

4. **No runtime dust, mud or wear by theme** (medium-high impact, medium cost). Bakes carry
   their own grime, and role-coloured meshes carry none, so a unit looks the same on sand, karst
   and marsh. **Proposal:** one shared material term (world-up mask × noise × amount) that pulls
   albedo toward the theme's dust key and raises roughness. Keyed by theme, never by map id, like
   the rain rule. On the node path it is a TSL function (`webgpu-and-blender.md` §4.1). On legacy
   it is one more `onBeforeCompile` segment. (Principles P5, P8; CoH2 and CoH3 precedents.)

5. **No vehicle tracks or ruts on the ground** (medium impact, low-medium cost). Craters and
   scorch exist and tracks do not. **Proposal:** a decal kind in the existing pool, stamped from
   positions the renderer already interpolates, aged on the sim clock, ratio-multiplied like
   every decal. Theme-dependent strength: strong in mud and sand, faint on rock. (P5.)

6. **Environment coverage is incomplete** (medium impact on the screens affected, low cost). The
   garage view, campaign board and menu diorama materials, tunnel props, garrison banners, proxy
   boxes and field works take no environment. Aircraft and swarm drones take the dielectric class
   on their metal parts (`renderer.md`, L1 known gaps). The garage close-up is where the lead
   judges art, so a unit there is lit differently from the battlefield. **Proposal:** adopt those
   materials through the same registry.

7. **The tone mapper has not been checked against team colours** (medium impact, measurement
   only). ACES shifts saturated hue at high intensity (`materials-and-lighting.md` §10). The planned
   delta-E gate covers grades. **Proposal:** extend it to the bare ACES transform on lit team
   panels at day intensity, and hold a Neutral-tone-mapper A/B mock in reserve. Changing the tone
   mapper is not proposed: it moves every pixel and every baseline.

8. **No night preset** (medium impact for night missions, high cost). Night resolves to dusk
   (D10). A real night needs local light sources (fires, muzzle flashes, vehicle lights,
   lanterns) and the same unit-to-ground value gate as day (Total War: Three Kingdoms' clear night
   battles against Iron Harvest's drab night maps, best practices §8 and §10).

9. **Shadow softness is uniform** (low-medium impact). One radius for every shadow. Contact
   hardening and screen-space contact shadows would anchor infantry at 25 px
   (`webgpu-and-blender.md` §4.5). Low priority: GTAO already gives contact.

10. **Thin parts and bevels are not gated** (low-medium impact, low cost). Antennas, rifles and
    barrels can fall under one pixel at default zoom. **Proposal:** a report-only check in
    `validate:meshes`: the projected width of each `weapon`/`metal` part at default zoom, flagged
    under about 1.5 px (est.). Also a bevel guideline in the style bible (about 3-6 cm on
    vehicles, weighted normals).

## 5. The twelve principles: followed or gap

From `leading-rts-best-practices.md` §13.

| # | Principle | Status in Roaring Lions | Note |
|---|---|---|---|
| P1 | Silhouette and value first, for the shipped camera | **Partial** | Silhouette gated (IoU); value not gated (gap 1) |
| P2 | The ground serves the units | **Partial** | Desaturated arid ramps; figure-ground share measured on the wetland only; green maps at risk (§2 reading 6) |
| P3 | What the player sees equals what the sim does | **Followed** | Relief, crowns, haze and smoke derived from sim data; invariant 4 |
| P4 | Team colour as a tuned budget on top surfaces | **Partial** | The Lavi only; infantry none; post-tone-map check missing (gaps 3, 7) |
| P5 | The ground records the battle | **Partial** | Craters, scorch and wrecks yes; tracks no (gap 5) |
| P6 | Brightness and saturated hue reserved for effects | **Followed** | Bloom above 1.0, `hdr-gains.ts`, reserved VFX band, bloom census |
| P7 | Zoom as a design axis with an icon handoff | **Not applicable yet** | Zoom is bounded; plan icons, LOD and impostors together if a strategic zoom is added |
| P8 | Grime and damage grow from play | **Gap** | Wear is baked into Meshy textures or absent; damage is cut into wrecks only (gap 4) |
| P9 | Weight and believable motion | **Followed** | Vehicle weight and running gear; infantry motion standard |
| P10 | Lighting legible at every time of day | **Partial** | Dawn, day and dusk graded; no night (gap 8) |
| P11 | Effects cost capped | **Followed** | GTAO half resolution, bloom quarter, presets |
| P12 | A UI that shares the world's language and stays out of the way | **Followed** | Token theme, no world status marks; off-screen attack notices not reviewed here |

## 6. WebGPU techniques with the biggest visible gain for the cost

Ordered by visible gain per unit of cost, for this game's camera and tone. Costs are estimates
(`webgpu-and-blender.md` §4.12); measure each before deciding.

1. **Shared TSL material layers: dust and mud by theme, team mask, wetness** (high gain,
   about 0 ms). The node port already writes material maths once (`Ops<T>`), so a layer written
   that way serves both paths. It closes gaps 3 and 4 together, and removes the
   `onBeforeCompile`-on-clone hazard the team mark documents. This is the best value on the list.
2. **GPU compute particles for explosions, debris and dust** (high gain; about 0.1-0.3 ms
   update plus overdraw, drawn at half resolution). Explosions are the genre's signature. Keep the
   flipbook path as the WebGL2 fallback and as the gate's reference; never let particles feed the
   sim. WebGPU only.
3. **Vehicle tracks through the decal pool** (medium-high gain, low cost, both backends). Not a
   WebGPU feature, but the cheapest visible step on the list.
4. **Height-blend contrast tuning** (medium gain, about 0 ms, both backends). `HEIGHT_BLEND` is
   0.15 today. Tune it per slot pair on a mock.
5. **TRAA in place of SMAA on the node path** (medium gain: shimmer on foliage, barrels and wires
   at 25-125 px; about 0.3-0.8 ms). Watch for ghosting behind fast units and projectiles. Gate it
   with a moving-unit capture.
6. **Volumetric dust and light shafts at dawn and dusk** (medium gain on those presets, about
   1-4 ms, WebGPU compute). Cap haze opacity at combat range so it never hides what the sim shows.
7. **VAT for infantry** (performance, not look: it lifts the 1,150-figure ceiling). It is already
   L4 in the look-uplift spec, with its gates written.
8. **Not recommended now:** SSGI (2-6 ms, noisy, and the hemisphere ground bounce already gives
   most of its look outdoors), SSR (little to reflect top-down except on wet maps), and impostors
   (little value at a bounded zoom).

## 7. Sources

- Research files in this folder: `readability-and-direction.md`, `materials-and-lighting.md`,
  `webgpu-and-blender.md`, `leading-rts-best-practices.md`, each with its own Sources list.
- Project files read from `origin/main` (49bb60cfe, 2026-11-09): `CLAUDE.md`;
  `docs/agent-notes/renderer.md`, `terrain-rendering.md`, `webgpu-backend.md`;
  `docs/art/style-bible.md`; `docs/superpowers/specs/2026-11-01-look-uplift-design.md` (headings and
  gates table); `data/palette.json`; `data/grades/`;
  `packages/render/src/three/units/unit-surface.ts`, `environment-classes.ts`, `environment.ts`,
  `time-of-day.ts`, `lighting.ts`, `units/hdr-gains.ts`, `units/team-mask.ts`,
  `terrain/ground-maths.ts`; `tools/validate_mesh_assets.py` (the `TEXTURED_*_EXEMPT` sets).
- Every luminance in §2 and every ratio in §3 was computed here from those files (sRGB decode,
  Rec.709 luminance). They are calculations, not renders.
