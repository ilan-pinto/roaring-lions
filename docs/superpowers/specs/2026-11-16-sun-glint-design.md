# Sun glint: the sun's reflection on metal, glass and water (GH-1361)

Status: design and mock only. No production code is in this PR, and none is written until the lead has picked. 16 Nov 2026.
Owner: renderer lane. Mock sheet: `2026-11-16-sun-glint-mock.png` (beside this file).

The sheet uses the brief's zooms, 0.6 / 1.0 / 2.5; the issue's suggestion was 0.5 / 1 / 1.6. The mock was rendered from a
throwaway local prototype that was **not committed**. That prototype, its capture script and the raw
captures exist only outside the repo. Every number below gives its capture conditions.

## 0. The answer in one paragraph

With this camera and this sun, **a flat surface can never mirror the sun to the viewer**: not a puddle, not a marsh, not a roof, not a
window. The surfaces that can are tilted 38 to 63 degrees toward the sun-camera bisector, plus anything curved (gun barrels, helmets,
canopies, rifles), and their glint moves as the unit turns.

The candidate that reads at battle zoom without touching anything else is **G, an analytic sun-glint lobe**. It is an extra, wider
specular lobe on the real directional sun, applied to the `glass` and `gunmetal` unit surfaces only, shadowed by the sun's own shadow
map, with its brightness on one HDR gain in `hdr-gains.ts`.

On the prototype G put a hot point on every gun barrel and launcher whose geometry lines up. It bloomed (pre-bloom peak 4.2 to 4.7
against the 1.0 threshold) and moved the arid `quiet` framing by 352 px / 0.0000.

The obvious alternative, **A, a sun disc in the environment map**, produced no glint on the arid map at any zoom (pre-bloom peak
unchanged at 0.61). It washed every environment-receiving surface instead. On the rain map it did cross 1.0, as a soft sheen along a
barrel and a brighter wash on the rain-treated KDF figures, but never as a point (section 3).

Water can only glint through a stylised term. **W**, sparse "facets" on rain-ruffled water that catch the sun, reads clearly. Its
prototype leaked through the fog of war, and a production version must be gated by visibility. The lead decides whether a sun belongs
on an overcast map at all (decision D3).

## 1. What was asked, and what is there today

The lead (15 Nov 2026): add a sun glint, the sun's reflection on water, glass and metal, that reads at battle zoom. The issue's prep
note (15 Nov) listed where a lobe could live and what each option would move.

Today:

- **The sky (`environment.ts`)** is a CPU gradient: the preset sky key overhead, its sun key at the horizon and `dust.4` below. It has
  no sun disc, and is PMREM-baked once per preset. The header says why: "the directional sun already supplies the sun's specular
  lobe, and a disc here would count it twice".
- **Classes that see the environment (`environment-classes.ts`):** `unitMetal` 0.6, `glass` 0.6, `unitDielectric` 0.3, `prop` 0.3,
  `building` 0.2. Ground, decals, smoke, FX and the backdrop get none, an exact zero.
- **Unit surfaces (`units/unit-surface.ts`):** `glass` roughness 0.2, `gunmetal` 0.42 with metal capped at 0.7 with the environment,
  `armour` 0.78.
- **Water (`terrain/mesh.ts`, THEME_WET).** Puddles and marsh mix a constant `uWetSky` into the albedo (0.35 / 0.25) at roughness
  0.08. Only `wetland` maps have water, and every wetland map rains (`TERRAIN_WEATHER`), with the sun at `RAIN_SUN_SCALE` 0.46.
- **Bloom (`bloom-spec.ts`)** thresholds scene-referred luminance 1.0, on `high` only (`medium` and `low` are `bloom: 'off'`).

## 2. The geometry, which decides the design

The camera is orthographic: a fixed `VIEW_DIRECTION` (0.612, 0.5, 0.612), 30 degrees down. A surface mirrors the sun to the camera
only where its normal equals the half-vector H between the to-sun and to-camera directions. Because the camera is orthographic, H is
the same at every pixel, so **a glint depends on the surface normal alone, never on where the surface is on screen**.

H computed from `sunDirectionFor(preset)` and `VIEW_DIRECTION` (node script, 16 Nov):

| preset | to-sun L | H | H off vertical (flat water, roofs) | H off a `+Z` wall (screen-left face) | H off a `+X` wall |
|---|---|---|---|---|---|
| dawn | (-0.913, 0.375, 0.161) | (-0.249, 0.725, 0.641) | 43.5 deg | 50.1 deg | 104 deg |
| day  | (-0.406, 0.819, 0.406) | (0.123, 0.786, 0.607) | 38.2 deg | 52.7 deg | 82.9 deg |
| dusk | (-0.165, 0.309, 0.937) | (0.248, 0.448, 0.859) | 63.4 deg | 30.8 deg | 75.6 deg |

What follows from the table:

- **No flat surface glints at any preset.** A roughness-0.08 puddle would need its normal within about a degree of H, and H is
  38 to 63 degrees off vertical. A ripple tilts 8 degrees at most (`RIPPLE_TILT_DEG`). A true mirror glint on water needs the sun
  behind the scene (contre-jour), and that is the retired lighting rule (`lighting.ts`).
- **No vertical window glints either.** Building windows face `+X` or `+Z`, and the nearest case is 31 degrees off, at dusk. A
  vertical mirror seen from 30 degrees above reflects the ground (`dust.4`), not the sky and not the sun.
- **What does glint** is tilted surfaces (sloped plates, windscreens, turret roofs) and curved ones. A cylinder whose axis lies near
  the plane perpendicular to H shows a bright line: by day a horizontal barrel within about ±16 degrees of the right heading glints
  with a 10-degree cone (computed, not measured). A sphere always has one glint point (helmets, canopies, domes).
- **Because a glint depends only on the normal, it moves as the unit turns.** That is the "glint as it turns" ask, and it comes
  free with any physical term.
- **A "stage" light for flat surfaces is a brightening, not a glint.** A highlight placed at the flat-reflection direction
  (option B in the prep note) gives every flat pixel of a class the same value at once, because the camera is orthographic. It
  lifts every flat top and never sparkles.

**Why today shows no glint, although the physics is already there.** Glass at roughness 0.2 under the 2.6 sun already peaks at about
5.5 linear where N equals H, which would bloom (computed from three's GGX by hand, not measured). But the GGX half-width at that
roughness is about ±1.5 degrees of normal (also computed), so a
flat facet catches it over about 3 degrees of heading, and the facets are mostly not near H. Measured, prototype off:

- **Pre-bloom peak.** On the arid map the brightest pixel before bloom is 0.61 at the force's zoom-1 view and 0.75 at the recon drone
  at zoom 2.5, so nothing reaches the 1.0 threshold.
- **The rain map is different.** There it already reads 1.28 to 1.29 at zoom 2.5. The brightest pixels sit on the KDF figures, whose
  rain treatment multiplies their albedo by `RAIN_KDF_EXPOSURE` 6. That is a broad lift of the figures, not a glint.
- **Why the physical term cannot do it.** It couples the width of the highlight to its peak through roughness. A glint that reads
  at battle zoom needs both a wider acceptance (about ±6 to 10 degrees) and an HDR peak, and that is exactly what option G
  decouples.

**Glass inventory: what can carry a glass glint.** Census of the shipped GLBs' role nodes:

- **Vehicles with glass.** Only seven vehicle types have a `glass` node: `aa_remetz`, `attack_drone`, `gun_truck`, `heli_peten`,
  `heli_peten_gunship`, `recon_drone` and `veh_ambulance`.
- **Vehicles without glass.** The Lavi, Namer, Eitan, Kipod, Shachaf, the jeep and the technical have none. On those a glint can
  only come from `metal` parts.
- **Optics.** No `optic` role exists anywhere.
- **Buildings.** Building glass is `roughness 0.85` (`WORLD_ROUGHNESS`) in the `building` environment class. On the textured types it
  is inside the shared bake material. So windows cannot glint without a material split (decision D4), and section 2 says a split
  still would not make them catch this sun.

## 3. Candidates

Each was prototyped behind a URL flag, except S. Composition in every case:

- **Bloom.** Linear radiance is lifted over 1.0 only where the term fires, so bloom affects only those pixels (the CLAUDE.md rule).
- **Tone mapping.** ACES in `OutputPass` then rolls the core to near white. That is why a glint still reads on `medium` and `low`,
  where there is no bloom: as a small clipped point without a halo (sheet, row "MEDIUM").

### A: a sun disc in the environment map

- **Technique.** A disc at `sunDirectionFor(preset)` is painted into `skyEquirectFloats` before the PMREM bake. Prototype: 4-degree
  radius, soft edge to 6.4 degrees, radiance 40 x the preset sun key, linear.
- **Backends.** Both get it for free, because the node bake takes the same `skyHalfImage`.
- **Cost.** No shader change and zero per-frame cost; it repaints only on a preset change.
- **What it did on the arid map.** Nothing that reads as a glint, at any zoom or preset. The pre-bloom peak was unchanged: 0.61 day
  and 0.58 dusk.
  - It brightened every environment-receiving surface instead: vehicles, trees, rocks and buildings.
  - The arid day force at zoom 2.5 moved 344,157 px over 2/255, but only 487 px got more than 40/255 brighter.
  - The arid `quiet` framing moved 19,136 px / 0.0005 by day and 119,436 px / 0.0006 at dusk.
- **What it did on the rain map.** It did cross the threshold: the pre-bloom peak went 0.74 to 1.30 at the force's zoom 1, 1.28 to
  2.40 at zoom 2.5, 1.20 to 1.99 at the recon drone and 1.29 to 2.62 at the Peten.
  - The lifted pixels are the rain-treated KDF figures (albedo x6, so any added light is magnified) and a soft sheen along the length
    of a barrel. The rain's wet surface table also lowers gunmetal roughness to 0.32.
  - That sheen lies on the same barrel G glints on (sheet, row "where A changes most"). This is consistent with the disc sitting at
    the sun's position, but it is not proof.
  - **The disc's orientation is reasoned from three's `equirectUv` convention, not measured.** If it were wrong, A's arid null result
    would mean nothing. A slice-1 check on a mirror sphere would settle it, and is owed only if A is chosen.
- **Why it fails.** The PMREM blurs the disc by each material's roughness: at gunmetal 0.42 it smears into a broad lobe, and on
  armour (0.78) and buildings into a sun-side wash. That is the double count the header warned about.
- **Further faults.**
  - It is unshadowed: an environment lookup ignores the shadow map, so a hull in a building's shadow would glint.
  - Under rain the environment sky is still the CLEAR preset's gradient (`EnvironmentRegistry` is built from `timeOfDay`, not from
    the rain lights), so a disc would put a full clear-sky sun into an overcast map.
- **Verdict.** Rejected as the glint. Only one disc size and one radiance were tried (4 degrees, x40). Restricting it to a second PMREM for
  `glass` and `unitMetal` would end the wash but keep the blur coupling and the missing shadow.

### B: a disc at the flat-reflection ("stage") direction

- **Technique.** The same code as A, with the disc at (-0.612, 0.5, -0.612): the camera's far side, 30 degrees up.
- **What it did.** No glint (pre-bloom peak 0.61). It lifted flat tops: 11,927 px got more than 40/255 brighter at zoom 2.5, against
  487 for A. It cannot reach water, because the ground takes no environment (an exact zero, pinned by `environment-leak.test.ts`).
- **Verdict.** Rejected: a highlight where no light is, the same on every flat top of a class (section 2). It is not on the sheet.

### G: an analytic sun-glint lobe (recommended)

The technique is the shader term below, applied as listed after it.

```glsl
// After #include <lights_physical_pars_fragment>: wrap the physical direct term.
void RE_Direct_Glint(IncidentLight directLight, ...) {
  RE_Direct_Physical(directLight, ...);                 // today's term, untouched
  if (directLight is the sun) {                          // prototype: direction == directionalLights[0].direction
    vec3 h = normalize(directLight.direction + geometryViewDir);
    float lobe = smoothstep(uGlintCos, mix(uGlintCos, 1.0, 0.6), saturate(dot(geometryNormal, h)));
    reflectedLight.directSpecular += directLight.color * (uGlintGain * lobe * step(0.0, dot(geometryNormal, directLight.direction)));
  }
}
#undef RE_Direct
#define RE_Direct RE_Direct_Glint
```

- **Where it is applied.** On the unit surface clones of class `glass` and `gunmetal` only (`surfaceMaterialFor`), as a compile-time
  variant with its own program key, chained the way `applyRainRim` chains.
- **Shadow.** The lobe should be shadowed by construction, with no extra cost: `directLight.color` already carries the sun's
  shadow (three multiplies it in `lights_fragment_begin` before calling `RE_Direct`), and unit meshes set `receiveShadow`. **This
  capture does not show it.** No glinting part stood clearly in shadow, so slice 1's Metal check must park a hull in a building's
  shadow and see no glint there.
- **Colour.** It carries the preset's sun colour (a palette key) and the rain's 0.46 scale.
- **Gain and cone.** The gain becomes one entry in `HDR_GAINS` (`sunGlint`). The cone (`uGlintCos`) and gain live in one shared
  uniform set, the rain-rim pattern.

What it did (day, high, zoom 1 force view):

- **Bloom.** Pre-bloom peak 4.33 (0.61 today), so the glint blooms.
- **Wash.** Mean frame luma 0.4308 to 0.4313, with no wash.
- **Pixel counts.** 35,880 px over 2/255, almost all of it the bloom halo. On `medium`, which has no bloom, the same view moves
  957 px.
- **Dusk.** The glint is warm, because it takes the dusk sun key. The pre-bloom peak is 1.85, since the dusk sun is weaker (1.8
  against 2.6) and lower.
- **The Peten.** Its canopy did not catch the sun at its parked heading; the barrels beside it did (sheet). That is the geometry
  working, not a fault.

Sweep at the zoom 1 force view (pre-bloom peak): gain 1 gives 2.37, gain 2 gives 4.33, gain 4 gives 8.26. A cone of cos 0.97 / 0.985
/ 0.995 gives 4.33 / 4.33 / 3.88 (wider cones catch more facets at the same peak). The raw sweep frames are kept with the prototype.

### W: water glitter (rain maps)

- **Technique.**
  - Inside the THEME_WET ground program, on water fragments (`rlWetCov`) only.
  - The water plane is cut into 0.07-tile cells. Each cell draws, per epoch, whether its "facet" catches the sun: probability
    `uGlitP`, on the SIM clock (`uRippleTimeSec`, the ripples' clock) with a short attack and decay.
  - A firing cell adds `directLight.color x uGlitGain` through the same `RE_Direct` wrapper, so it is shadowed and carries the rain's
    0.46 sun.
  - Physical motivation: raindrop crowns make steep, short-lived facets, and only a steep facet can reach H (section 2).
  - Prototype: gain 3, p 0.05.
- **What it did.** Clear white sparkles on the marsh and the road puddles (pre-bloom peak 2.03 to 2.04).
  - At zoom 2.5 on the marsh, mean luma went 0.2426 to 0.2917.
  - At gain 3 the bloom turns each cell into a round sparkle. At gain 1.5 the sparkles are dim and the square cells show (sheet, last
    row).
  - p 0.02 is noticeably calmer than 0.05.
- **The defect.** The prototype's sparkles **show through the fog-of-war shroud** (sheet, row "in the SHROUD"). An HDR value of 2
  survives the shroud's darkening. In production the glitter, and the G lobe too, must be multiplied by fog visibility (or clamped to
  LDR under the shroud) before bloom.
- **What it costs.** Per-pixel ALU (two hashes and a few ops) on every water fragment, inside a program that once missed its
  `medium` budget (`WET_PROGRAM_TIERS`). So it belongs on the `full` wet tier (high) only.
- **Rules a production W must keep.**
  - Its GLSL lives in flat `#ifdef THEME_WET` blocks with no nested conditional; the prototype nested one and is not shippable as
    written.
  - Every term needs a TS mirror in `wet-shading.ts`.
  - Arid's program must stay byte for byte (`theme-identity.test.ts`).
  - The facet cell must be a round sub-cell dot, not a square cell.

### S: a window twinkle (not prototyped)

A stylised, sim-clock twinkle on sun-facing building glass. Section 2 shows no physical term reaches a vertical window, so this would
be a pure effect. It also needs the material split of decision D4. It is listed so the lead can say no explicitly.

## 4. Surfaces, by candidate

| surface | G | A | W | note |
|---|---|---|---|---|
| unit gunmetal (barrels, RWS, rifles, launchers) | **yes**: line and point glints as geometry allows | wash only | - | includes every infantry weapon: 25 infantry GLBs carry `metal`/`weapon` (D2) |
| unit glass (7 vehicle types: canopies, cabs, drone domes) | **yes**, heading-dependent | wash only | - | the Lavi, Namer, Eitan and jeep have no glass node (D8) |
| vehicle armour (`hull`, dielectric 0.78) | no (not in the class list) | wash | - | could be added; real armour paint is matte (D2) |
| building windows | no: vertical, cannot catch this sun | wash (class `building`) | - | D4 |
| water / puddles (rain maps) | - | no: the ground has no environment | **yes** (stylised) | D3; fog gating required |
| wet ground off the water | - | - | no | the lead removed open-ground puddles at S-L1 |
| swarm drones, support aircraft | no: adopted as `unitDielectric` in one material | wash | - | D7 |

## 5. Measurements, with conditions

All rows come from ONE headless Chromium run: `ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro)`, read through
`WEBGL_debug_renderer_info`, SwiftShader refused.

**Capture conditions:**

- 1400x900 CSS at DPR 2 (2800x1800 device px); quality `high` unless marked; music off (`musicOffInitScript`).
- Own Vite server on port 5193, started from the worktree and stopped by its own process group.
- Sandbox maps `beit_sahwan_outskirts` (`&tod=day` and `&tod=dusk`) and `ein_qasab` (rain, its own preset).
- Every page stepped to tick 140, frame loop frozen, `renderer.frame(1, 0)` twice, HUD hidden.
- The gated framings were reproduced by hand: `vehicle` at tile (4.5, 20.5) zoom 1, and `quiet` at `town_center` zoom 1. Both were
  taken at tick 140, not the gate's 200, so they are indicative.

**Controls:**

- **Zero-repaint.** 0 px / 0.0000 on every control view (arid day, dusk, medium and rain).
- **Boot-to-boot.** Measured between the `today` and `A` page loads on rectangles where A cannot act:
  - arid shrouded ground (1200x500 device px): 0 of 600,000 pixels differ;
  - rain grass with rain streaks falling over it (800x650): 0 of 520,000.
  - So the loads are deterministic and each arm's diff is the arm itself. Rectangles holding props or rocks do differ, because
    those take the environment.

**Pixel counts.** "px" is the count over 2/255 mean channel delta (this script, not pixelmatch), and "mad" the mean absolute channel
delta.

| framing | today pre-bloom max | A | G | note |
|---|---|---|---|---|
| arid day, force zoom 0.6 | 0.61 | 0.61, 37,153 px / 0.0002 | **4.53**, 828 px / 0.0000 | |
| arid day, force zoom 1 | 0.61 | 0.61, 84,992 px / 0.0003 | **4.33**, 35,880 px / 0.0005 | G halo is most of the px |
| arid day, force zoom 2.5 | 0.69 | 0.69, 344,157 px / 0.0013 | **4.73**, 250,618 px / 0.0036 | |
| arid day, `vehicle` framing | 0.61 | 92,334 px / 0.0004 | 33,271 px / 0.0005 | gate ceiling 40 px / 0.004 |
| arid day, `quiet` framing | 0.61 | 19,136 px / 0.0005 | **352 px / 0.0000** (86 px over 24/255, beside the town hall where a hostile figure's red occlusion outline is; not confirmed mesh by mesh) | gate ceiling 40 px / 0.004 |
| arid dusk, `quiet` framing | 0.56 | 119,436 px / 0.0006 | 78 px / 0.0000 | the `graded` and `dusk` scenarios' preset |
| arid day medium, `quiet` / `vehicle` | 0.61 | - | 66 px / 974 px | no bloom on medium |
| rain force zoom 1 | 0.74 | **1.30**, 153,204 px / 0.0006 | G+W 2.12, 933,746 px / 0.0091 | A: figures and barrel sheen |
| rain force zoom 2.5 | 1.28 | **2.40**, 369,523 px / 0.0014 | G+W 2.60, 770,017 px / 0.0081 | today's 1.28 is the KDF rain exposure |
| rain marsh zoom 1 | 0.61 | 0.69, 145,902 px / 0.0007 | G+W **2.03**, 1,177,617 px / 0.0116 | W covers the water |
| rain marsh zoom 2.5 | 0.30 | 0.46 | G+W 2.04; mean luma 0.2426 to 0.2917 | |

Pre-bloom values are `debugPreBloomLuminance(2)`, linear, the buffer bloom thresholds at 1.0.

**Frame cost: no delta could be resolved, and this read is NOT a cost number.**

- **Method.** One readPixels-synced read per arm (80 frames after 15 warm-up, rAF frozen).
- **Load.** The machine was carrying other sessions, at a load average of 25 to 194 during the run.
- **Arid day, force zoom 1.** today 53.6 ms (load 72), A 58.9, B 60.8, G 58.5 (load 165).
- **Arid dusk.** today 58.2, A 58.8, G 60.9.
- **Rain, marsh zoom 1.** today 66.1, A 65.6, G+W 68.5.
- **Medium.** today 50.2 ms (load 105) against G 43.2 ms (load 32). G "cheaper" than today shows the load, not the arm, sets these
  numbers.
- **CPU submit.** 9.8 to 13.6 ms everywhere, flat across arms.
- **What is owed.** A clean read is gate **G-cost** of slice 1: `pnpm perf:fx -- --breakdown`, toggling the `glint` layer, on a
  quiet machine. The estimate below is reasoned, not measured.

## 6. Per-preset cost (estimate, to be measured at G-cost)

| preset | G | W | A (if chosen) |
|---|---|---|---|
| high | about 15 ALU on glass/gunmetal fragments only (a few % of the screen at most): expected < 0.05 ms. Programs: +1 variant per hooked surface program (glass, gunmetal, and their rim/mark/wounded combinations), compiled at load. Bloom: no new pass; the existing quarter-res bloom picks the glint up | about 25 ALU per WATER fragment on the `full` wet tier; a wetland view is often half water: budget 0.3 ms at DPR 2, to be measured; +0 programs (a variant of the one wet program) | 0 per frame; one disc paint (512x256 loop, about 1 ms CPU) per preset change |
| medium | same as high; reads as a clipped point without bloom | **off** (`lite` wet tier) | 0 |
| low | same; the cheapest preset can afford it, and it is the one thing that makes metal read without bloom | off (`minimal`) | 0 |

**Off switches.**

- **Player.** None needed for G (cost about 0). W rides `quality.rain.ground === 'full'`. If the lead wants one, a `glint` field on
  `RenderQuality` with `high`/`medium`/`low` = on/on/on.
- **Reduced motion.** It stills W's twinkle (W is animated). G only moves with units, so it stays.
- **A/B switch.** A sandbox flag `&glint=0`, the `&envlight=0` pattern.

## 7. Debug layer and the layer check that gates it

- **New debug layer `glint`** (`debug-layers.ts`): the shared gain uniform goes to 0 and back.
  - It is a FLAG the per-frame writes consult, the `unitsDebugHidden` / rain-rim `passOn` standard, so it holds across frames and is
    a real measurement.
  - W's term reads the same flag: one layer for G and W. A second `glitter` layer is optional if the lead wants them apart.
- **Gate (reference-free).**
  - A `glint` layer check on `vehicle`, whose barrels line up at tick 140 in this capture, and on `kitted` (the same framing with
    kit).
  - The floor is a third of the smallest of three CI-protocol runs (`relief-read-signal.ts --layers=glint`), measured at slice time.
    This mock's one run is indicative only.
  - Falsifier: make the GLSL lobe a no-op (`lobe = 0.0`), which must turn the check red. The inverse mutation (the lobe on the
    `armour` class too) must move `quiet` past its 40 px ceiling. Both are to be written into the commit message.
- **W has no witness today.** No gated scenario frames a wetland map, so the existing `wet`, `marsh`, `ripples` and `rain` layers have
  none either.
  - A gated `wetland` scenario (`ein_qasab`, the marsh edge by the force, an absolute `targetTick`) would give W, and those four
    layers, a check (D9).
  - Without it, W is report-only through its own capture tool.

## 8. What moves in the golden baselines

- **G moves every scenario with unit metal in the cone.** That is `vehicle`, `kitted`, `graded` (dusk), `fogged` (zoom 0.5, small),
  `combat`, `dusk` and `ragdoll`, plus `quiet`, which moved 352 px / 0.0000 in this capture (86 px over 24/255). The move sits beside
  the town hall, where a hostile figure's red occlusion outline is; the source was not confirmed mesh by mesh.
  - `quiet`'s ceiling is 40 px / 0.004, so expect the issue's "quiet must not move on arid" to need the lead's acceptance, or a
    narrower class list (D2: vehicles only would probably leave it alone, if the source is that figure's weapon).
  - `open-ground`, `relief`, `aftermath` and `rubble` frame no unit metal and should not move: confirm on CI.
- **The bloom census's claim changes.** `tools/src/perf/bloom-census.ts` holds every shipped map's quiet frame under 0.9, the claim
  `quality.ts` rests on. G makes that true only where no unit metal is in the cone. The census must be re-run and its wording
  narrowed in the same PR.
- **The environment layer floors do not move with G** (it adds no environment). They would all move with A.
- **The `theme-identity` digests.** G moves the `scene`/`program` digests only where a hooked unit program is built (the harness builds
  no GLBs: confirm). W moves the wetland `program` digest deliberately, with a `Was`, and arid's must not move.
- **The census-solved hemisphere** (`ENV_HEMISPHERE_INTENSITY`) is untouched by G: mean luma moved under 0.1%. A would need it
  re-solved.
- **Blessing** happens from CI numbers only, after the lead has looked at the bless PR's pictures, never from the branch.

## 9. Risks

1. **Sparkle everywhere.** Every infantry rifle is `gunmetal`; a squad at zoom 2.5 glints on several figures at once (sheet, the Spike
   team). Mitigation: D2 (vehicles first), a lower gain, a narrower cone.
2. **Fog-of-war leak.** An HDR glint survives the shroud's darkening (W proved it). Every glint term must be multiplied by fog
   visibility before bloom, and that must be tested by a fogged capture. Units drawn under the shroud must never glint, or the glint
   becomes a tell.
3. **The node (WebGPU) twin is real work.** A shadowed direct-light term in TSL means a custom lighting model (a
   `PhysicalLightingModel` subclass whose `direct()` adds the lobe) composed with the unit twin's hook terms. Until then the twin
   lists the segment as unported (`rlUnportedTerms`), which the migration allows. A would have been free on the node backend; G and W
   are not.
4. **The sun test in the wrapper.** The prototype tells the sun from a point light by comparing directions, which is fragile.
   Production should restrict the term to the directional loop explicitly (or accept that muzzle-flash point lights also glint,
   which is physical; a lead call if anyone notices).
5. **Shadow acne on thin barrels** could flicker a glint at the shadow edge. Watch for it in the slice-1 Metal check.
6. **Rain.** A sun glint on an overcast map contradicts the weather (D3). The prototype's sparkles are the rain-scaled sun, and
   still read bright.
7. **Program count.** One more variant per hooked surface program means a little more compile time at mission boot. Count it with
   `perf:load`.

## 10. Slices (after the lead picks)

1. **G on WebGL2.** The `RE_Direct` wrapper, the class list, `HDR_GAINS.sunGlint`, the cone constant, the `glint` debug layer, fog
   gating, tests (a pure TS mirror of the lobe with literal oracles; the class list pinned; the falsifiers). Then one Metal check with
   a turning-hull frame strip, and G-cost.
2. **The bless PR from CI**, after the lead looks: `vehicle`, `kitted`, `graded`, `quiet`, `fogged`, `combat`, `dusk`, `ragdoll`.
3. **W** (if D3 says so), the wetland scenario (if D9 says so), and its cost read.
4. **The node twins** of G and W.

## 11. Lead decisions

Each is one question; the recommended default is in bold.

- **D1. Technique for metal and glass?** (a) **G, the analytic sun lobe**; (b) A, an env-map disc; (c) both; (d) no glint.
- **D2. Which unit surfaces glint in v1?** (a) vehicle `gunmetal` and `glass` only (no infantry weapons); (b) **every `gunmetal` and
  `glass` surface, infantry weapons included, as on the sheet**; (c) (b) plus vehicle armour hulls.
  - (a) is the safe fallback if the lead finds squads too sparkly, or wants `quiet` to stay put.
- **D3. Water on rain maps?** (a) no water glint: rain stays overcast; (b) **W glitter on `high` only, at the calmer 2% density,
  fog-gated, round dots**; (c) a soft sky sheen with no sun (no bloom), on all presets.
- **D4. Building windows?** (a) **no window glint: vertical glass cannot catch this sun**; (b) a stylised twinkle (S) on sun-facing
  windows; (c) a material split only, so windows get glass roughness and class and read as glass, but no glint.
- **D5. Glint strength?** (a) gain 1 (peak about 2.4, a faint halo); (b) **gain 2, cone cos 0.985 (about 10 degrees), as on the
  sheet**; (c) gain 4 (peak about 8, a strong halo).
- **D6. Which presets get G?** (a) **all three: about zero cost, and it reads without bloom**; (b) high only; (c) high and medium.
- **D7. Swarm drones and support aircraft?** (a) **leave them out for now** (one-material batches tagged `unitDielectric`);
  (b) split their metal and glass now.
- **D8. Optics on the main tanks and IFVs (no glass node today)?** (a) **metal only for now**; (b) a later art task (`blender-art`)
  to add `glass` sight and periscope nodes to the Lavi, Namer, Eitan and jeep. Military "glint" is optics.
- **D9. A gated witness for W?** (a) **a new gated `wetland` scenario on `ein_qasab`**, which also gives the `wet`, `marsh`, `ripples`
  and `rain` layers their first check; (b) report-only captures.
- **D10. Baselines?** (a) **bless from CI after you have looked at the bless PR's pictures, in its own PR**; (b) hold G behind a flag
  until a later polish pass.
