# The Roaring Lion insignia on KDF units (GH-1096): design

**Date:** 2026-11-12. **Status:** DESIGN ONLY, for the lead to approve. Nothing in this document has been rendered,
sent to Meshy or implemented. The one picture is a hand-drawn SVG mock,
`docs/art/mocks/gh1096-lion-insignia-MOCK.svg`, with palette hexes only.

**The ask (lead, 7 Nov):** every KDF unit carries the Roaring Lion logo, painted on the model like a real unit
insignia. It is never a floating world overlay: the lead has rejected those twice (the kit badge, the status marks).

**The answer in one paragraph.**
- **The emblem.** A front-facing roaring lion's head in a maned roundel. It is drawn once as a hand-authored SVG,
  and its two halves are mirror images.
- **The texture.** The SVG is baked into ONE shared 256 x 256 two-channel signed-distance texture of 0.33 MiB. It
  is loaded once per renderer and sits in no GLB.
- **How it is painted.** The texture is sampled inside the existing L3 team-mark hook (`units/team-mask.ts`), on a
  planar frame in each vehicle's mesh-local space. So it is painted on the hull, turns with a turret, costs +0 draw
  calls and +0 bytes in any GLB, and survives every clone through the one `carryTeamMark`.
- **Colour and LOD.** The colour is a fixed palette key, `limestone.1`, never the team slot. Below 5 screen px
  nothing draws. From 5 to 7.5 px the emblem is a clean roundel. From 11 to 15 px the lion's face cuts in. So it
  never becomes noise.
- **Scope.** Recommended: the 15 KDF vehicle and aircraft GLBs first, piloted on the Lavi. Infantry is deferred,
  because a shoulder patch is under 3 px at every gameplay zoom.

The numbered decisions are in section 12.

---

## 1. Constraints this design is held to

From GH-1096, CLAUDE.md and the memory notes:

- **On the model, never above it.** Nothing in world space floats. The insignia is paint on the hull, like the
  L3 team mark.
- **GLBs outside the `TEXTURED_*` sets ship zero materials.** This does not bind here: every KDF vehicle and
  aircraft GLB is already in `TEXTURED_VEHICLE_EXEMPT` (checked against `tools/validate_mesh_assets.py`), and so is
  every KDF infantry team except `wounded_kdf` (a palette figure, and unmarked in any case). The design adds no material and no image to any GLB.
- **The per-class texture budgets are a ratchet:** vehicle 80 MiB / 2560 px, building 64 / 2048, infantry 32 /
  3072. Those budgets count images embedded in a GLB. The insignia texture is not embedded anywhere, so no
  budget moves. `pnpm perf:memory` is the gate that sees its 0.33 MiB.
- **`Material.clone()` drops the hook.** One hook carried by one `carryTeamMark` (section 4.3) keeps the three
  clone sites honest: `mesh-death.ts:236`, `vehicle-damage.ts:136` and `running-gear-material.ts:158`.
- **A wreck takes no mark.** That stays true: `charredTexturedMaterial` never installs the hook, and the wreck twin
  is not in `liveTop`.
- **It reads at gameplay zoom without becoming noise.** Section 2 measures what "reads" can mean, and section 7
  gives the rule.
- **Art numbers come before any render or Meshy call.** This document IS the numbers. Nothing here needs Meshy.
  The only render in the plan is the garage close-up in slice S1, after approval.
- **Real sizes, not cartoon sizes** (`kit-gear-must-look-real`, `models-at-max-detail`). A real stencil is 0.4 to
  1.0 m across. Section 6 stays inside that.

---

## 2. Screen-size arithmetic: the numbers everything else follows

These come from `packages/render/src/three/camera.ts` and `project.ts`.
- One tile is `(TILE_W/2)/(1/sqrt2)` = 45.25 CSS px along view X at zoom 1.
- `MESH_UNITS_PER_TILE` = 3, so **one mesh-local metre is 15.08 px at zoom 1**.
- The camera is at 30 degrees elevation (`asin(TILE_H/TILE_W)`). A vertical flank therefore shows its height at
  x0.866, and a roof shows its depth at x0.5.
- Zoom runs from 0.35 to 2.5 (`camera-input.ts`); the default is 1.

So a flank emblem's SHORTER screen axis, seen broadside, is `D x 15.08 x 0.866 x zoom` px.

| Emblem diameter D | Short axis at zoom 1 | At zoom 2.5 | Roundel visible from (5 px) | Roundel full (7.5 px) | Lion starts (11 px) | Lion full (15 px) |
|---|---|---|---|---|---|---|
| 0.60 m (standard, section 6) | 7.8 px | 19.6 px | zoom 0.64 | **0.96** | **1.40** | **1.91** |
| 0.55 m | 7.2 px | 18.0 px | 0.70 | 1.04 | 1.53 | 2.09 |
| 0.45 m | 5.9 px | 14.7 px | 0.85 | 1.28 | 1.87 | 2.55 (never) |
| 0.40 m | 5.2 px | 13.1 px | 0.96 | 1.44 | 2.11 | never |
| 0.30 m (Peten flank) | 3.9 px | 9.8 px | 1.28 | 1.91 | 2.81 (never) | never |
| 0.09 m (infantry shoulder patch) | 1.2 px | 2.9 px | never (4.25) | never | never | never |

What this says, plainly:
- **At the default zoom, a real-size insignia on a tank is 8 px.** That is a roundel, not a lion. The lion's face
  is a reward for zooming in: it starts at 1.4 and is complete at 1.9. No realistic size changes that, because the
  Lavi's flank has 0.62 m of flat plate.
- An emblem big enough to show the face at zoom 1 would be 1.1 m tall, and none of these hulls has such a flat
  patch.
- **Infantry can never show it in the world.** The patch never reaches 5 px, even at maximum zoom. It would be
  seen only on the garage turntable, where a figure fills about 400 px.
- **The Peten pair** shows a roundel only from zoom 1.9, and never the lion.

---

## 3. The canonical flat logo

### 3.1 The form: a front-facing roaring head in a maned roundel

The mock's panel A shows it.
- **Mane.** 18 locks in two layers.
- **Face.** Set off from the mane by a 2.5% gap.
- **Detail.** A heavy brow, angled eyes, a broad nose pad, and an open roaring jaw with four fangs.

Why this form and not the others:
- **Bilateral symmetry is load-bearing.** The shader tests both flanks with one box mirrored in `|z|`, as the team
  band does. A symmetric emblem reads correctly on both flanks with no per-side mirroring and one texture. A profile
  lion, like the brigade flag's, would face backward on one flank, or need a mirrored second frame.
- **The roundel degrades gracefully.** Below about 11 px, the mane's outline alone is a clean "sunburst roundel",
  the way a real aircraft roundel reads at range. Detail is never smeared into a blob (section 7).
- **It is the lion the project already chose.** It is the same subject as the Roar coin's lion: the Meshy relief
  `roar-lion-relief-20261001-01a0f804`, front-facing, a full mane framing the face, jaws open.

What it is NOT:
- **The favicon** (`art/favicon/favicon.png`). `docs/ASSET_PROVENANCE.md` item 5 records no tool and no terms for it.
- **The Roar coin's traced SVGs** (`assets/ui/roar_coin/roar_coin_{16,24,48}.svg`). They are pixel traces at coin
  sizes, and they inherit the Meshy disclosure.
- **The brigade flag's lion.** It is a profile, made from axis-aligned rectangles.

### 3.2 How it is made

Each step is code or hand-authored vector work. None is a render.

1. **`art/src/insignia/roaring_lion.svg`, authored by hand.** It holds a 200 x 200 viewBox centred on (100, 100)
   and contains:
   - two named layers, `silhouette` and `cutouts`;
   - only straight segments and circular arcs, so the bake tool flattens it with no SVG library;
   - each outline written as its RIGHT half (x >= 100). The bake tool mirrors it, so symmetry holds by construction
     and a test can assert it.

   The relief thumbnail is the visual reference. The SVG is drawn, not traced, so its provenance row reads
   "project original, hand-authored" with no Meshy inheritance (decision 4). If the lead prefers a trace of the
   relief, the row inherits the Meshy disclosure, exactly as `roar_coin_*.svg` does.
2. **The feature rule.** No stroke, gap or cut-out is narrower than **2.5% of the diameter** (5 of 200 units, which
   is 6 texels at 256). Anything thinner vanishes in the distance field. The mock's thinnest features (the mane's
   layer gap, the face gap and the muzzle line) are all 5 units.
3. **`tools/insignia/bake_sdf.py`** uses numpy and PIL, which `tools/vehicles/lavi_mark.py` already imports. It:
   - flattens both layers;
   - rasterises each at 4096 x 4096 with PIL polygons;
   - runs a hand-rolled exact Euclidean distance transform (two-pass, numpy, no scipy dependency);
   - downsamples to 256 x 256 and maps signed distance to 0..255 (128 is the edge, a +/-8-texel spread);
   - writes `assets/textures/insignia/roaring_lion_sdf.png`. R is the silhouette's distance and G is the cut-outs'
     distance. B is 0 and A is 255.

   No randomness and no `mathutils`, so the bytes are deterministic, and a test re-runs the bake and compares
   them. The emblem disc spans 240 of the 256 texels, leaving an 8-texel border for the spread.
4. **The lead approves the SVG itself** (it is vector art, looked at in any viewer) before the bake is wired up.

### 3.3 Colour

**One colour from a palette ramp, fixed per faction, never the team slot.**
- In a versus room, KDF can be the HOSTILE seat. A team-coloured lion would turn red there and stop being an
  insignia.
- `reserved.team` is also "RUNTIME ONLY" by the palette's own note.
- The colour is resolved at runtime from its key (`paletteColor('limestone.1')`) and handed to the shader linear
  (`hexToLinear`), like every authored colour. There is no hex in TypeScript.

Candidates, scored against every team colour in all four colour-vision sets (CIEDE2000; 15 or more is clearly
distinct), and against the bakes they sit on (WCAG contrast ratio). The script is in the appendix.

| Candidate | kedem `#2F6FD9` | hostile `#D93A2B` | neutral `#E8C33A` | d/p neutral `#F0E442` | trit. neutral `#CC79A7` | min vs any team | on Lavi bake (median `#544F41`) | on olive.1 |
|---|---|---|---|---|---|---|---|---|
| **limestone.1 `#E6D8BE`** | 49.9 | 41.1 | 19.5 | 21.0 | 37.3 | **19.5** | **5.8:1** | 3.5:1 |
| gunmetal.0 `#C3C7C4` | 38.2 | 40.0 | 26.9 | 28.3 | 31.9 | **26.9** | 4.8:1 | 2.9:1 |
| limestone.2 `#D9C7A7` | 49.5 | 38.4 | 17.2 | 20.3 | 36.8 | 17.2 | 4.9:1 | 3.0:1 |
| dust.0 `#E0B87A` (a "gold" lion) | 54.7 | 36.2 | **11.4** | 18.3 | 41.4 | **11.4** | 4.4:1 | 2.7:1 |
| shadow.0 `#23241F` (black stencil) | 40.8 | 41.4 | 69.1 | 79.1 | 49.3 | 35.8 | **1.9:1** | 3.2:1 |

(The d/p kedem and hostile columns are omitted for width; every candidate clears 26 against them.)

- **Recommendation: `limestone.1`.** It is a warm sand-white, like real stencil paint after a season in the dust.
  It has the strongest contrast on the dark olive KDF bakes (all of them have a median near `#544F41`; the team-mark
  `luma` under the panels is 0.10 to 0.18 linear), and it sits 19.5 from the nearest team colour.
- **`gunmetal.0` is the safe alternative** if the lead wants more distance from the neutral yellow (26.9). It is
  cooler and greyer.
- **A gold lion (`dust.0`) is rejected.** At 11.4 from `team.neutral` it would read as the neutral team's mark.
- **A black stencil is rejected.** It is invisible on these bakes (1.9:1).

**One colour or two.** The texture has two channels whichever way the lead decides, so this costs nothing either
way.
- **One colour (recommended).** The cut-outs let the hull show through, the way a real stencil works. On a dark
  hull, the hull IS the second colour.
- **A second, dark keyline** (shadow.0, around the silhouette) would help only on a LIGHT surface, and there is
  none in the KDF fleet. If the lead wants one, it is a third channel (B) in the same PNG and one more `mix`, with no
  new mechanism.

**Paint rule:** the team mark's, unchanged. Strength 0.85 (the lead's 2 Nov ruling for the team mark), and the
paint keeps 30% of the bake's grime: `mix(1, luma(bake) / uInsLuma, 0.3)`. `uInsLuma` is the bake's mean linear
luminance under the emblem, measured by the probe. So the emblem is weathered, not a sticker.

---

## 4. The mechanism

### 4.1 Options compared

| | **A. SDF sampled in the existing mark hook (recommended)** | B. Decal mesh per emblem | C. Painted into each GLB's bake | D. Extruded emblem part grafted like kit |
|---|---|---|---|---|
| What it is | One shared 256 x 256 RG distance texture, sampled in the fragment shader on a planar frame in mesh-local space, inside the box test L3 already runs | A projected `DecalGeometry` quad per flank, parented to the hull or the turret pivot | The lion painted into each vehicle's base-colour image | A thin mesh lion added to the GLB |
| GPU memory | **0.33 MiB once** (RGBA8, 256 x 256 x 4 x 4/3 mips), outside every GLB | about 0, plus geometry | 0 new, but every edit re-exports the image | about 0 |
| Per-GLB texture budget | untouched | untouched | untouched in size; churned | untouched |
| Draw calls | **+0** (same meshes, same variant swap L3 does) | +1 per emblem per unit: two flanks on about 100 vehicles is +200. At about 0.1 ms per draw on ANGLE/Metal (`terrain-rendering.md`, "Chunks") that is about +20 ms a frame. Instanced per type, it is still about +15 draws, with turret-pivot and kit cases | +0 | +0 to +1 |
| Edge quality | crisp at any zoom (distance field, 1-px AA) | crisp | **ragged along UV islands**: exactly why the first L3 cut was rejected | crisp, but z-fights on lumpy Meshy hulls |
| Turns with turret | free (object-space attributes, as L3) | needs parenting under `turret_pivot` | free | needs parenting |
| Wreck takes none | free (no hook on the charred material) | must be removed on death | **fails**: the `WRECK_` twin shares the bake | must be stripped |
| LOD fade | per fragment, by its own screen size | needs a per-frame opacity | **impossible** | impossible |
| Clones | rides `carryTeamMark` | separate object to keep in sync | n/a | n/a |
| Node (WebGPU) twin | one more term on `unit-material.node.ts` | a second material type to port | n/a | n/a |
| Iteration cost per placement change | change one number, no binary touched (section 5) | small | re-bake and re-export 2 x 15 binaries | re-export |

**Recommendation: A.** It is the same mechanism L3 already ships (procedural, object-space, +0 draws). Its one
addition is the image the issue says a logo needs, and that costs 0.33 MiB once.

### 4.2 Option A in detail

**The texture.**
- File: `assets/textures/insignia/roaring_lion_sdf.png`, 256 x 256, R = silhouette distance, G = cut-out distance.
- It is data, so: `NoColorSpace`, no premultiply, `LinearMipmapLinearFilter`, mips on (averaged distances are
  still a usable distance field), `ClampToEdgeWrapping`.
- It is loaded once per renderer: `ThreeRenderer` and the garage each own one, released by their own disposer.
- Until it lands, a 1 x 1 placeholder (R = 0, "outside") is bound, and the uniform's `.value` is swapped on load
  with no recompile.
- If it fails to load: a `console.error` naming the file, and the placeholder stays bound, so the units draw
  exactly as today. Never a black box, never a throw. This is the GLB-failure rule's twin.

**The frame.** Each emblem is ONE entry per material, a flank pair mirrored about the centreline:

```
centre (cx, cy, cz)   metres, mesh-local (X forward, Y up, Z lateral); the pair sits at z = +cz and -cz
size   D              metres, the roundel's diameter
slab   [zlo, zhi]     |z| range a fragment must be in (keeps the far side and the interior out)
min_n  0.60           flank faces only: sign(z) * n.z > min_n, eased +/-0.04 like the team mark's normal test
luma                  the bake's mean linear luminance under the disc (the grime normaliser)
```

**The maths.** It is written once, against `Ops<T>`, as `insigniaOps`, the same pattern as `teamMarkOps`:

```
e        = ((p.x - cx) / D + 0.5, (p.y - cy) / D + 0.5)               emblem coordinate, 0..1 across the disc
inside   = cov(|p.z|, zlo, zhi) * soft(min_n, sign(p.z) * n.z) * cov(e.x, 0, 1) * cov(e.y, 0, 1)
px       = 1 / max(fwidth(e.x), fwidth(e.y)) / pixelRatio              the SHORTER screen axis, CSS px
sil      = edge(sdf.r)   cut = edge(sdf.g)                              AA over about one screen pixel (fwidth of the sample)
roundel  = smoothstep(5.0, 7.5, px)       detail = smoothstep(11.0, 15.0, px)
mask     = strength * inside * roundel * sil * (1 - detail * cut)
diffuse  = mix(diffuse, min(colour * mix(1, luma(diffuse) / luma_ref, 0.3), 1), mask)
```

**The `Ops<T>` boundary.**
- `Ops<T>` has no texture op and no derivative (`fog-ops.ts`: "a screen-space rate is graph-only, so a twin
  computes it in TSL and passes it IN").
- So the CALLER samples the texture and computes the three rates: `fwidth(e.x)`, `fwidth(e.y)`, and `fwidth` of
  the two samples. It passes them into `insigniaOps`, as the node twin already does for the team mark's rates.
- The number tests feed a bilinear CPU sample of the committed PNG.
- The derivatives and the sample stay OUTSIDE any branch (the road block's rule in `terrain/mesh.ts`), so a quad
  that straddles the box edge stays defined.

**Order.** The insignia is applied in the same `color_fragment` block, AFTER the team mark. They never overlap: the
emblem disc and both team boxes are disjoint, and that is tested (section 9).

**Kit.**
- The team mark multiplies by its UV-pin exclusion (`rlKit`). The insignia does NOT by default (decision 14).
- A kit plate standing in the emblem's box is painted, so the stencil sits on the outermost plate, as on a real
  skirt.
- The geometry test refuses a box in which any kit face fails the normal test, so a sensor box can never take a
  slice of lion.

### 4.3 One hook, not two

The insignia is a second term of the SAME hook, not a second `onBeforeCompile`.
- A second hook would need a second carry call at each of the three clone sites, and one would be missed.
- The program key moves from `rl-team-mark-2` to **`rl-unit-mark-3`**, and it names the features it actually
  patched: `|rl-unit-mark-3|team`, `|rl-unit-mark-3|ins`, `|rl-unit-mark-3|team+ins`. This keeps L3's rule that a
  key is only ever added together with its patch.
- The blocks sit behind `#define RL_TEAM_MARK` and `#define RL_INSIGNIA`. A material without the insignia compiles
  the team-mark program byte for byte as today, minus the key.

**Variants.**
- `VehicleTeamMaterials.materialFor` today returns `base` when the material declares no `rl_team_mark`.
- It becomes "a team mark OR an insignia". An insignia-only template gets ONE variant (the colour is
  faction-fixed, so there is nothing per slot), memoised under slot `-1`.
- The five team-marked templates in scope keep their three slot variants, and each carries the insignia too.
  The Ambush Tank keeps its team mark only (decision 3).
- **Draw calls: +0.** **Programs:** +1 per insignia-only template type (10 in scope), and the six team-marked
  templates recompile once under the new key.

**The garage.** `garage-view.ts:561` builds `VehicleTeamMaterials` only when `teamHex` is set. The insignia must not
depend on that, or the lead's close-up would not show it. The garage always builds the variant set, and an absent
team colour means "no team term", not "no materials".

**The node path.** `teamMarkTerms` gains an `rl-insignia-1` term: `T.texture(sdf, uv)` and
`T.fwidth(...)` in the caller, `insigniaOps` for the body, each uniform read from the legacy hook record (as
`teamHookOf` does today). `unported.test.ts` and `refresh-policy.node.test.ts` gain the segment.

**The debug layer.** `insignia`: one shared strength to 0 and back, exactly as `team-mask` works
(`setTeamMaskPass`). It is a uniform write that nothing per-frame re-asserts, so it is a real measurement.

---

## 5. Where the frames live (decision 16)

| | **Generated table (recommended)** | GLB material extras (`rl_insignia`), the L3 precedent |
|---|---|---|
| Where | `tools/vehicles/insignia.py` holds the lead-approved numbers (as `lavi_mark.py` holds `MARKS`). `--write` measures `luma` and writes `packages/render/src/three/units/insignia-frames.ts`, GENERATED and never hand-edited (the `ELLIPSE_BY_TYPE` precedent) | written into each GLB's material by a new pass |
| Binaries touched per placement change | **none** | 2 per vehicle (`art/meshes/` and the Draco copy in `assets/meshes/`), 30 for the fleet |
| Pipeline order | unchanged | `mark-pass` refuses kitted or wrecked files, so either a new extras-only pass after `damage:meshes` or a `peel-host.ts` round trip per vehicle (the carriers' precedent). Either one edits the load-bearing order in CLAUDE.md |
| Staleness | the table records a sha256 of each GLB's host hull POSITION accessors (the kit pass keeps them byte-identical). A re-exported mesh fails the test until it is re-measured | travels with the mesh |
| Iteration on the lead's close-up | change one number, regenerate, look again | re-run passes and re-encode |

Checked: `encode:meshes` does preserve material extras (`assets/meshes/vehicles/mbt_lavi.glb` carries
`rl_team_mark` and `rl_bake_luma`), so the extras route works. It is just heavier for something the lead will tune
by eye.

---

## 6. Placement per class, with sizes

**Rule:**
- **Both flanks**, on the hull flank or (where the hull has no room) the turret flank.
- **One standard stencil size, 0.60 m**, on every hull that can take it, and smaller only where the hull forces it.
  A standard size reads as one marking system across the force, like a real army's, and the roundel/lion transition
  then happens at the same zoom for every vehicle.
- **The roof stays the team's recognition panel.** Two marks on one roof would compete, and a roof emblem is
  foreshortened to half height anyway.

The numbers below come from an area-sampled geometry probe of each GLB's `rl_role: hull` meshes. It finds the
largest square of flank faces within about 40 degrees of +Z, in 0.05 m cells, with each kit tier's bounding box
optionally blocked (appendix). They are STARTING numbers.
- **Measured** means checked against the panel layout by hand (the Lavi line).
- **Probe** means a clear flat patch exists at that size.
- **To place** means the probe and the bake disagree, or kit bounds overlap, and slice S2's per-unit measurement
  decides.

A Meshy flank also carries baked detail (the Namer's vision blocks) that no geometry probe sees. The S2 test reads
the bake's luminance spread under each disc for that (section 9).

### 6.1 Ground vehicles (flank pair, both sides)

| GLB | Surface | Probe: largest flat square, kit ignored / kit avoided | **D** | **Centre (x, y)** | Kit interplay | Basis | Opacity at zoom 1 (broadside); roundel full / lion full at zoom |
|---|---|---|---|---|---|---|---|
| `mbt_lavi` (pilot) | hull flank, forward skirt panel | 1.00 / 0.40 m | **0.60** | **0.95, 1.00** | the tier-2 skirt (`kit_armour_2`, x -3.22..1.45, y 0.68..1.49) is flat plates with seams at x -1.4 and 0.5. The disc sits on the forward panel (x 0.5..1.4), on host and plate alike | measured | 100%; 0.96 / 1.91 |
| `officer_armour` | the same hull, no kit | 1.00 m | **0.60** | **0.95, 1.00** | none | measured | 100%; 0.96 / 1.91 |
| `apc_kipod` | upper hull flank | 0.80 / 0.65 m | **0.60** | **-0.38, 2.38** | clear of every tier's bounds | probe | 100%; 0.96 / 1.91 |
| `demo_tzav` | hull flank | 1.25 / 1.25 m | **0.60** | **-0.38, 2.27** | no kit | probe | 100%; 0.96 / 1.91 |
| `aa_remetz` | hull flank | 0.60 / 0.60 m | **0.55** | **0.15, 1.15** | no kit | probe | 96%; 1.04 / 2.09 |
| `dozer_d9` | body flank | 0.55 / 0.55 m | **0.50** | **1.43, 0.78** | clear of every tier's bounds | probe | 67%; 1.15 / 2.30 |
| `spg_long_range` | turret flank (turns with the turret) | 0.55 m | **0.50** | **0.83, 2.18** | no kit | probe | 67%; 1.15 / 2.30 |
| `spg_cluster` | turret flank | 0.55 m | **0.50** | **0.58, 2.18** | no kit | probe | 67%; 1.15 / 2.30 |
| `apc_eitan` | upper hull flank | 0.55 / under 0.15 m | **0.50** | **0.83, 2.23** | the tier-3 bounds span the whole flank. S2 checks whether a tier-3 plate stands there and is flat | to place | 67%; 1.15 / 2.30 |
| `jeep_shoded` | rear body flank | 0.75 / 0.35 m | **0.50** | **-1.28, 0.62** | the tier-3 side-armour bounds (x -2.01..2.50, y 0.42..1.68) overlap | to place | 67%; 1.15 / 2.30 |
| `ifv_namer` | lower aft flank, under the vision blocks | 0.40 / 0.35 m at 0.05 m cells (the 0.1 m map shows a wide flat flank at y 1.8..2.9) | **0.45** | **-1.80, 2.15** | the tier-2 band (y 1.89..2.41) covers it; the baked vision blocks (x -2.6..0.9) stand above it; the team band is at x 1.0..1.95 | to place | 28%; 1.28 / never |
| `scout_shachaf` | hull flank | 0.40 / 0.20 m | **0.40** | **-2.00, 1.45** | tier bounds overlap | to place | 2%; 1.44 / never |

**Read the opacity column before approving the sizes.** At the default zoom 1, seen broadside, the smaller emblems
sit partway through the 5 to 7.5 px fade:
- 0.50 m is at about 67%;
- the Namer's 0.45 m is at about 28%;
- the Shachaf's 0.40 m is at about 2%, so it is effectively absent until zoom 1.2.

A faint disc can read as a smudge. That is the case for decision 13's lower threshold, or for leaving the smallest
hulls unmarked in the world (garage only), rather than for a larger stencil. Any other yaw shrinks the short axis
further.

### 6.2 Aircraft (flank pair)

| GLB | Surface | Probe | **D** | **Centre (x, y)** | Basis | Opacity at zoom 1 (broadside); roundel full / lion full |
|---|---|---|---|---|---|---|
| `heli_yanshuf` | cabin flank, aft of the door | 0.70 m | **0.60** | **0.95, 0.70** | probe | 100%; 0.96 / 1.91 |
| `heli_peten` | fuselage flank under the cockpit | 0.30 m (kit ignored) | **0.30** | **0.30, 0.35** | to place: `kit_armour_3_hull_hull`'s bounds (x -0.05..1.67, y 0.11..0.54) overlap the disc | 0%; 1.91 / never. In the world a roundel only near maximum zoom; the lion only in the garage |
| `heli_peten_gunship` | the same (no kit) | 0.30 m | **0.30** | **0.30, 0.35** | probe | 0%; the same |

The Peten meshes are scaled to the game (a 4.97 m Apache), so their fuselage flank is small. A nose or tail emblem was
not measured for this spec; S3 probes the tail fin, and the 0.30 m flank stands until it finds more.

### 6.3 Not marked (decisions 2 and 3)

| Unit | Why |
|---|---|
| `attack_drone`, `recon_drone` | the largest flat flank is 0.20 / 0.10 m: 3 px at zoom 1 and invisible at any zoom. Expendable munitions |
| `ugv_recon_dog` | the infantry rig path, and smaller than a drone |
| `mbt_lavi_camo` (Ambush Tank) | it is under a net. A stencil painted on a net is wrong, and the probe's 1.00 m patch is the rear hull the net drapes over |
| `veh_ambulance`, `air_medevac_heli` | medical vehicles carry a protective medical marking, not a combat insignia. Putting the lion beside it blurs what that marking means |
| every KDF infantry team | a 0.09 m left-shoulder patch is 1.2 px at zoom 1 and 2.9 px at 2.5: never in the world (section 2). Slice S4 below, only on a later yes; the per-team numbers are in 6.4 |

### 6.4 Infantry, per team (deferred to S4)

| Team | Patch | Size | Zoom 1 / zoom 2.5 | Note |
|---|---|---|---|---|
| `inf_squad`, `inf_grenadier`, `at_team`, `at_nlos_team`, `mortar_team`, `sniper_team`, `breach_team`, `demo_squad`, `yahalom_squad`, `recon_zikit` | left shoulder, every figure | 0.09 m | 1.2 / 2.9 px | garage only |
| `officer_infantry`, `officer_fires`, `officer_engineer` | left shoulder | 0.09 m | 1.2 / 2.9 px | garage only |
| `inf_medic_squad` | left shoulder | 0.09 m | 1.2 / 2.9 px | it IS marked, unlike the ambulance: a soldier wears the unit tag whatever the role, and the team is armed (`medic_carbines`). The protective-marking question in decision 3 is about a vehicle marked as medical transport |
| `wounded_kdf` | none | | | a casualty figure; not textured |

**If infantry is approved later (S4), the numbers would be:**
- The patch: left shoulder (where real units wear the unit tag), **0.09 m** across, on the uniform part, centred on
  the deltoid in the bind pose.
- It needs a skinned-team variant path (`textured-infantry.ts`) and a frame per FIGURE, because a squad GLB holds
  several bodies.
- The object-space test reads the bind-pose `position` attribute, so the patch follows the shoulder bone through
  skinning, as a texture would.

---

## 7. Reading at gameplay zoom: the LOD rule

- **The measure is the emblem's own screen size, per fragment, on its shorter axis** in CSS px, as in section 4.2.
  It is not a camera-zoom constant. So:
  - the battlefield, the garage turntable and the kit-capture sheets all follow one rule;
  - a flank seen edge-on fades out by itself (its short axis collapses);
  - a small emblem (the Peten's) is automatically "garage only", with no special case.
- **The three bands** (uniforms, so the lead can tune them on the close-up with no re-bake):

  | Short axis | What draws | Why |
  |---|---|---|
  | under 5 px | nothing | a 4-px pale fleck on every tank is the noise the issue forbids |
  | 5 to 7.5 px | the silhouette (R) fades in to a solid roundel | a crisp sunburst disc reads as a marking, never as dirt |
  | 7.5 to 11 px | the roundel, solid | the cut-outs would be under 1 px: they would only grey the disc |
  | 11 to 15 px | the cut-outs (G) fade in | eyes, nose and jaw reach 1 to 2 px: the face forms |
  | over 15 px | the full lion | |

- **The size ladder** in the mock's panel B shows full detail at every size (top row) against this rule (bottom
  row), at 5 to 48 px.
- **Pixel ratio.** `fwidth` is in framebuffer pixels, and the shader divides by the renderer's pixel ratio
  (a shared uniform), so a 2x display does not switch bands at half the physical size. `fwidth` reads up to about
  1.4x small on a diagonal, and the thresholds are calibrated with that bias in place.
- **Quality presets.** The insignia is on at `high`, `medium` and `low`. Its cost is one texture fetch and about
  30 ALU on hull fragments, which are a few percent of the frame (decision 19). `high` stays pinned to the
  pre-preset constants: the insignia is a new term, not a preset change.

---

## 8. What it survives, case by case

| Case | How |
|---|---|
| `Material.clone()` (scar, running gear, death fade) | the one hook, the one `carryTeamMark` (section 4.3). Tests extend the three existing carry tests to an insignia-only material |
| The wreck twin | no hook on `charredTexturedMaterial`, and `deathRoot` is not in `liveTop`. Test: a wreck's materials carry neither key |
| Kit graft (`applyVehicleKit`) | kit is merged INTO the host geometry in the same mesh-local frame, so the object-space test sees kit faces where they stand. The outermost flat plate carries the lion (decision 14); the geometry test refuses a non-flat kit face in the box |
| Turret rotation | the frame is tested on the `position` attribute, which never sees `turret_pivot`'s node transform (as L3). The SPGs' turret-flank emblems turn with the turret |
| Team colour variants (four sets) and CVD modes | the insignia colour is NOT a slot colour, so `setTeamColors` never writes it. Test: a colour-vision switch leaves `uInsColor` unchanged. Separation from every team colour in every set is the table in section 3.3 |
| Versus, KDF as the hostile seat | it is faction identity, the same lion on either seat (the reason it is not team-coloured) |
| WebGL2 (legacy) path | the `#ifdef RL_INSIGNIA` block in the patched chunk |
| Node (WebGPU) path | the `rl-insignia-1` term, the same `insigniaOps` body, with the sample and rates passed in |
| The garage | always builds the variants, team colour or not (section 4.3) |
| Texture failure | the placeholder stays bound, a `console.error` names the file, and the units draw as today |
| Fog, shroud, smoke, occlusion outline | untouched: the insignia is part of the body colour, so whatever hides the body hides it |
| Portraits (`render_unit_portraits.py`) | not covered. A Blender portrait would need its own pass, which is a render and so needs separate approval (out of scope) |

---

## 9. Gates, and the failing input each one gets

Per CLAUDE.md's falsification rule, every check below names the one-line mutation that must turn it red. A check
that cannot be watched going red does not land.

1. **Presence:** `insignia-frames.test.ts`.
   - Every GLB in the approved scope has a frame. The scope is a LITERAL list in the test, never imported from the
     table it checks: 15 ids in v1.
   - The count is pinned, so an empty table cannot pass vacuously.
   - Falsify: delete `mbt_lavi`'s entry, and the test goes red.
2. **Geometry:** `tools/src/insignia.test.ts`, the twin of `mark-pass.test.ts`. An independent measurement that
   SUBDIVIDES each hull triangle (12 x 12, the carriers' lesson about huge Meshy triangles). It checks:
   - at least 90% of the disc's area lands on `rl_role: hull` faces that pass the normal test inside the slab;
   - the disc does not intersect either team-mark box;
   - no `rubber`, `metal` or `plate` face sits in the disc and slab;
   - every kit face (every tier) inside the disc and slab passes the normal test;
   - the bake's luminance standard deviation under the disc is under a measured ceiling, which catches baked
     windows and hatches.

   Falsify:
   - move the Lavi's centre to x 50, and the area check goes red;
   - put it on the team band (x -1.05, y 2.21), and the overlap check goes red;
   - shift it 0.3 m up onto the Namer's vision blocks, and the luminance check goes red.
3. **Maths:** `insignia.test.ts`, on `NUMBER_OPS` with a CPU bilinear sample of the committed PNG.
   - The disc centre at 30 px gets `mask = 0.85`.
   - At 4 px it gets 0.
   - At 9 px, a fragment in a cut-out still gets the silhouette.
   - At 20 px, a cut-out fragment gets 0.
   - The -z flank equals the +z flank.
   - A wrong-facing normal gets 0.
   - The GLSL chunk text is pinned to the `Ops` body, as `team-mask.test.ts` pins its own.

   Falsify: drop `(1 - detail * cut)`, and the 20 px case goes red.
4. **The node twin:** `insignia.node.test.ts`, the shape of `team-mask.node.test.ts`. Falsify: remove the term, and
   the segment check goes red.
5. **Clones and wrecks:** the three carry tests and the wreck test, extended. Falsify: comment out the insignia
   term's re-install in `carryTeamMark`, and the scar-clone test goes red.
6. **The bake is deterministic, and the logo is symmetric.** A test re-runs `bake_sdf.py` and compares bytes with
   the committed PNG, and asserts the SVG's right-half-only authoring. Falsify: edit one SVG vertex without
   re-baking, and the bytes differ.
7. **The visual gate.** An `insignia` layer check (`BaselineSpec.layerChecks`) on the gated `vehicle` scenario
   (beit_sahwan_outskirts, zoom 1, tick 140). Its frame holds the two Lavis (confirmed by the `team-mask` check's
   rationale), and likely others of `SANDBOX_KDF` (`packages/app/src/sandbox-force.ts`: the Namers, the Eitan, the jeep,
   the D9, the Peten). Which of those are in frame was not checked for this spec; S1 reads it off the capture.
   - At zoom 1, a 0.60 m flank is 7.8 px on its short axis: just inside the solid-roundel band. So the signal
     exists, but it is small.
   - Floors are a third of the smallest of three measured runs, and the magnitude floor carries it if it is under
     `SUB_THRESHOLD_PX`, the precedent the `team-mask` check set.
   - The same check goes on `kitted`, where the Lavi's lion sits on the tier-2 plate.
   - Watched going red: `setInsigniaPass` made a no-op must read 0 px there.
   - **If the measured zoom-1 signal is 0** (for example the yaws put every short axis under 5 px), the check does
     NOT land as a vacuous gate. That is a finding for the lead: either the thresholds drop, or a new gated framing is
     added (a lead call, since it costs a bless).
   - **The bless is from CI numbers only, never from the branch**, through the `visual-baseline-bless` workflow,
     and the picture is looked at.
8. **Memory:** `pnpm perf:memory` must show about +0.33 MiB and nothing else. `validate:meshes`' per-GLB texture
   census must be unchanged, which proves no GLB grew an image (decision 9).
9. **Colour:** the colour is resolved through its palette key. A test pins that the key exists in
   `data/palette.json` and is not in a `reserved` band. Falsify: set the key to `team.kedem`, and it goes red.
10. **The art gate:** `check_insignia_frames` in `validate_mesh_assets.py`, next to `check_team_marks` (so
    `pnpm validate:meshes`, in CI). With a LITERAL `INSIGNIA_REQUIRED` list pinned to the generated table (the
    `MARK_REQUIRED` / `MARK_RECIPES` precedent), it fails when:
    - a GLB in the list has no frame in the table;
    - the sha256 of its host hull POSITION accessors no longer matches the hash the table recorded.

    So a re-exported or re-shaped mesh is caught at the art gate, before any runtime test, and its emblem cannot
    silently float off a changed hull. Falsify: flip one byte of the recorded hash for `mbt_lavi`, and the gate
    goes red; delete `mbt_lavi` from the table, and it goes red.

---

## 10. Slices

Each slice is one PR. No slice starts a render before its numbers are approved.

- **S0. The logo, no runtime change.**
  - `art/src/insignia/roaring_lion.svg` (hand-drawn, right halves, two layers), `tools/insignia/bake_sdf.py`,
    `assets/textures/insignia/roaring_lion_sdf.png`, the determinism and symmetry test, and the provenance row.
  - The lead approves the SVG as vector art.
- **S1. The pilot: `mbt_lavi` alone.**
  - The hook term (WebGL2 and node), the variant rule, the garage change, the generated table with one entry, the
    debug layer, and gates 1 to 6 and 8 to 10.
  - Then ONE garage close-up sheet of the Lavi, through the existing kit-capture path: Metal, its own port, music
    off, one browser.
  - Then the `insignia` layer check on `vehicle` and `kitted`, and a CI bless.
  - The close-up is the lead's approval point for the look: size, colour and LOD bands.
- **S2. The rest of the ground fleet** (11 GLBs in 6.1).
  - Per-unit measurement fixes every "to place" row.
  - One close-up sheet per unit, then a CI bless.
- **S3. Aircraft** (3 GLBs in 6.2). The same, plus the Peten's "garage only" behaviour confirmed on its sheet.
- **S4 (only on a later yes). Infantry:** the skinned path, frames per figure, garage-only by the numbers in
  section 2.

---

## 11. Scope: the recommendation

**Vehicles and aircraft first (S1 to S3, 15 GLBs). Infantry is deferred, and drones, the UGV, the Ambush Tank and
the two medical vehicles are not marked.**

- The numbers in section 2 decide it, not taste: a shoulder patch never reaches 5 px in battle.
- So infantry work buys only the garage turntable, at the cost of a new skinned-material path and per-figure
  frames.
- Every vehicle and aircraft, by contrast, reuses the mechanism the Lavi pilot builds. After S1, each is one table
  entry, one measurement and one sheet.

---

## 12. For the lead: art numbers and decisions

Each item has my recommendation. "Yes" approves it as written.

1. **Scope.** Vehicles and aircraft first (15 GLBs: 12 ground, 3 air); infantry deferred to a later yes.
   *Recommend: yes.*
2. **Too small to mark.** `attack_drone`, `recon_drone` and `ugv_recon_dog` get no insignia (0.10 to 0.20 m
   surfaces, never visible). *Recommend: yes.*
3. **Deliberately unmarked.** The Ambush Tank (under a net), the Pered ambulance and the Nachlieli medevac (medical
   marking). The armed Nemala medic team would still wear the shoulder patch in S4 (section 6.4).
   *Recommend: yes.*
4. **The emblem.** A front-facing roaring lion's head in an 18-lock maned roundel, bilaterally symmetric, as in the
   mock. Hand-DRAWN with the Meshy relief as reference only, so it is project-original with no Meshy inheritance.
   Not the favicon (provenance unrecorded), not a profile lion. *Recommend: yes, drawn, not traced.*
5. **Colour.** `limestone.1` `#E6D8BE`, fixed for the faction, never the team colour. The alternative is
   `gunmetal.0` `#C3C7C4`. A gold or black lion is rejected (section 3.3). *Recommend: limestone.1.*
6. **One colour or two.** One-colour stencil, with the hull showing through the cut-outs; no dark keyline.
   *Recommend: one colour.*
7. **Paint strength and weathering.** 0.85, keeping 30% of the bake's grime: the team mark's ruling, reused.
   *Recommend: yes.*
8. **Mechanism.** A distance-field texture sampled inside the existing team-mark hook (one hook, program key
   `rl-unit-mark-3`). No decal meshes (+20 ms of draws at about 100 vehicles) and no painting into the bakes
   (ragged UV edges; wrecks would keep it). *Recommend: yes.*
9. **Texture.** 256 x 256, two channels, about 30 to 60 KB on disk, **0.33 MiB GPU, once**. Outside every GLB, so
   the per-class budgets are untouched; `perf:memory` sees it. *Recommend: yes.*
10. **Standard size.** One stencil size, **0.60 m**, on every hull that takes it, and smaller only where the hull
    forces it: Remetz 0.55; the D9, the two Te'o, the Eitan and the jeep 0.50; the Namer 0.45; the Shachaf 0.40;
    the Peten pair 0.30. Never larger than 0.60. At zoom 1 broadside the 0.50 m emblems are about 67% opaque, the
    Namer's about 28% and the Shachaf's about 2% (section 6.1). *Recommend: yes; revisit the smallest on the S2
    close-ups.*
11. **Surface.** Both flanks (hull, or turret on the two Te'o). The roof stays the team's recognition panel.
    *Recommend: yes.*
12. **Placements.** The per-unit centres in section 6 are starting numbers. The Lavi and the command Lavi are
    measured. The rest are fixed by S2's measurement and approved per unit on its garage close-up sheet.
    *Recommend: yes.*
13. **LOD bands** (CSS px on the emblem's shorter screen axis): nothing under 5; the roundel fades in over 5 to 7.5;
    the lion's face over 11 to 15. Consequence: at the default zoom 1, a 0.60 m emblem is a roundel; the face
    starts at zoom 1.4 and is complete at 1.9, and the emblems under 0.55 m are still fading in (section 6.1). The
    bands are uniforms, tunable on the close-up with no re-bake. *Recommend: yes.*
14. **Kit.** Unlike the team mark, the lion paints the outermost FLAT kit plate standing in its box (the Lavi's
    tier-2 skirt), so an upgraded tank keeps its insignia. The geometry test refuses any non-flat kit face in the
    box. *Recommend: yes.*
15. **Wrecks.** No lion on a wreck (the existing rule). *Recommend: keep.*
16. **Where the frames live.** A generated TypeScript table (numbers in `tools/vehicles/insignia.py`), with no GLB
    rewritten and no change to the mesh pipeline order. GLB extras are the alternative. *Recommend: the table.*
17. **The visual gate.** An `insignia` layer check on `vehicle` and `kitted` (zoom 1), watched red, blessed from CI.
    If the zoom-1 signal reads 0, no new gated scenario without asking first. *Recommend: yes.*
18. **Slices.** S0 logo, then S1 Lavi pilot plus close-up, then S2 ground fleet, then S3 aircraft. S4 infantry only
    on a later yes. *Recommend: yes.*
19. **Quality presets.** The insignia stays on at all three presets (about one texture fetch on hull fragments).
    *Recommend: yes.*

---

## Appendix A. How the numbers were measured

**No render, no browser, no Blender, and nothing written to the tree but this file and the mock.** Each line below
was run in the design worktree.

- **The roster.** `data/units/kdf/*.json` (32 types) and `art/meshes/vehicles/*.glb`.
  - Every KDF vehicle and aircraft GLB is in `TEXTURED_VEHICLE_EXEMPT`, and every KDF team in
    `TEXTURED_INFANTRY_EXEMPT`.
  - Six vehicles carry `rl_team_mark` today: `mbt_lavi`, `mbt_lavi_camo`, `officer_armour`, `ifv_namer`,
    `apc_eitan`, `apc_kipod`. CLAUDE.md's "Team mark" bullet still names the Lavi as the only one; the
    `mark-contract.ts` recipes and `mesh-units.md` are current.
- **Bounds.** Per-node POSITION accessor min/max from each GLB's JSON chunk.
- **The flat-patch probe.** For each `rl_role: hull` mesh (no `kit_*`, no `WRECK_*`), it:
  - sampled points uniformly over every triangle whose face normal is within about 40 degrees of +Z
    (`n.z > 0.75`), at 8,000 points per square metre, using numpy's seeded generator, with stochastic rounding of
    each triangle's sample count;
  - binned them in 0.05 m cells, treating a cell as flat if 70% of it was covered;
  - found the largest all-flat square by dynamic programming, with the team-mark band blocked, and each kit tier's
    POSITION bounds also blocked in the "kit avoided" column.

  Bounding boxes overstate what a kit tier covers, so "kit avoided" is a lower bound.
- **The Lavi's skirt.** The same sampling on `kit_armour_2_hull_hull` alone, at 0.1 m cells. It found flat plates at
  y 0.7..1.3 from x -3.2 to 1.5, with seams near x -1.4 and 0.5.
- **The bakes.** The median sRGB of each vehicle's first image, downsampled to 128 px. The Lavi is `#544F41` and the
  jeep `#414336`. Some first images are normal maps (the carriers keep theirs, `keepNormal`), and those medians were
  ignored.
- **Colour.** CIEDE2000 and WCAG ratios, implemented directly from the definitions (sRGB to linear to XYZ, D65, to
  Lab), over every team colour in `reserved.team.colors` and its three `variants`.
- **The mock.** `docs/art/mocks/gh1096-lion-insignia-MOCK.svg`, written as coordinates: outlines as right halves
  mirrored about x = 100, and the mane as two 18-point stars. It was rasterised once with `rsvg-convert` to check
  the layout, and that PNG was not committed.
