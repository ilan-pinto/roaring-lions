# Roof cutaway: see units inside and under buildings (GH-1225)

**Status:** ruled 10 Nov (GH-1225). Option A is chosen; L2 to L8 are accepted decisions; B stays only as a rejected alternative. This document adds no code.
**Scope** (coordinator ruling, 11 Nov): TWO triggers only, the selected unit and the garrisoned unit.
**Mock:** [`2026-11-11-roof-cutaway-mock.svg`](2026-11-11-roof-cutaway-mock.svg). It shows both options in section.
**Depends on:** GH-1197 P4 (PR 1221, real holes). That PR provides the per-building material clones, the shared uniform
set, the cut shadow and the interior shade, all reused here. The cutaway lands after P4 merges.

## Decision

**The cut:** cut a vertical cylinder out of a building above a waist-high cut height, with a soft slope band at its edge.
- **Where:** around every selected unit near a building, and over the whole of any building with a garrison the viewer
  knows about.
- **Look:** the cut wall tops get a light section cap; the far walls show P4's interior shade.
- **Shadows:** the shadow is cut too.

**The materials:** the cut is a term in the P4 hook, `rl-cut`, written once as `Ops<T>` maths. It has a WebGL2
`onBeforeCompile` body and a TSL twin. It runs on a per-building clone that exists only while that building is cut, so
an uncut building, and every gated frame, binds nothing new.

## The triggers

1. **Selected unit.**
   - **Which units:** every unit in the viewer's selection whose tile is within 1.25 t of a standing building's drawn
     footprint, up to the volume cap.
   - **The cut:** centred on the unit's drawn position.
2. **Garrisoned unit.**
   - **Which buildings:** any building holding a garrison that the viewer is allowed to know about. That is the
     viewer's own garrison, or an enemy garrison the viewer can see, by the same test that decides whether the
     garrison banner shows (`bannerEntries`).
   - **Never revealed:** a fogged enemy garrison. Fog stays fog.
   - **The cut:** one volume at the footprint centre, wide enough to cover the whole drawn footprint.

**Dropped:** the camera-focus trigger. It overlaps the other two (a unit worth revealing is either selected or
garrisoned). Measured on `main`, it would also move a gated frame: in `quiet` (zoom 1) the clinic stands 2.0 t from
the camera focus and the apartment 3.6 t.

## The numbers

1 t = 1 tile = 3 m. In the data, a storey is about 1 t (`floors` per type in `structures.json`): house 2, apartment 3,
warehouse 2, shanty 1.

| What | Value | Why |
|---|---|---|
| Cut height | ground + **0.4 t** (1.2 m) | Waist high on a 0.6 t figure. The wall stub left in front hides only what is less than 0.7 t behind it at the 30° camera. |
| Floors cut | everything above the cut height | House: the roof and 1.6 storeys. Apartment: the roof and 2.6. Garrisoned units stand on the ground inside (the sim puts them at the footprint centre), so any shallower cut would hide them. |
| Selection radius R | **1.25 t** | Bigger than a squad's spread (the figure slots run about ±0.8 t). Small enough to keep most of a 4 x 4 t house standing. |
| Garrison radius | the footprint's half-diagonal + 0.25 t | Covers the whole building. A 3 x 3 house gives 2.4 t. |
| Edge band W | **0.5 t** | Over the band the cut height slopes linearly back up to the roof, so the edge reads as a broken section rather than a stencil. No dither and no blending. |
| Section cap | 0.03 t below the cut, the wall ramp's lightest key | The cut wall tops read as cut, like an architect's section drawing. |
| Interior | P4's back-face shade (the wall ramp's darkest key, 0.6 toward `gunmetal.2`) | Already built and pinned. |
| Open | R grows 0 → full over **250 ms**, ease-out | An iris. Frame clock: the trigger is UI state (selection, a garrison the viewer sees), and it must work while the sim is paused. The sim-clock rule covers WORLD animation (wet effects, foliage sway, rain), which must freeze with the sim; a UI-driven reveal is not that, so there is no conflict. |
| Close | hold **1.0 s** after the trigger ends, then shrink over **400 ms** | Stops flicker when a selection changes or a garrison steps out. |
| Volume cap | **8** active at once: garrisons first, then selected units nearest the camera focus | A fixed shader loop. |
| Garrison figures | spread to the type's `garrison_slots` stations, hashed inside the footprint inset by 0.3 t, **ONLY while that building is cut** | Today all garrisoned figures stack at the centre. The uncut draw is unchanged, so the golden baselines stay still. This only changes where they are drawn; the sim is not touched. |

## Option A (chosen) and Option B (rejected): cost for each

**Option A, the vertical cylinder (chosen).** A fragment is cut when all three hold:
- its horizontal distance ρ from the centre is under R + W;
- it is above the volume's cut height;
- it is above the band's slope.

Cost and effect:
- **ALU:** about 12 operations per volume, so about 100 per fragment at the cap of 8. This applies only to fragments of
  cut buildings: their clones exist only while they are cut.
- **CPU:** under 0.05 ms per frame. That covers building the at most 8 volumes from the selection and the garrison
  table, and writing one shared `vec4[8] x 2` uniform block.
- **Draw calls:** none added. A cut swaps the material on meshes that already draw.
- **Programs:** one extra variant per band material (`<base>|rl-cut`, combined `<base>|rl-holes|rl-cut` when the
  building also has holes). To be prewarmed with the P4 variants.
- **Shadow:** the same term on the building's depth material.

**Option B, the view-line cylinder (rejected).** The cylinder's axis runs along the fixed 30° camera ray through the unit. Only
fragments between the unit and the camera are cut.

Cost and effect:
- **ALU:** about 18 operations per volume (a projection onto the ray as well as the radial test), about 150 at the cap.
- **CPU and draw calls:** the same as A.
- **Stability:** the camera never rotates, so the slot does not swim as the camera pans.
- **What it keeps:** more of the building.
- **What it costs:**
  - a slanted cut that reads as a slot, not a floor plan;
  - a garrison needs a slot per figure station, so up to 4 volumes per building;
  - the shadow cut makes no sense for B (it is a view-dependent shape), so B leaves the shadow whole.

**Reads sim state, writes none; nothing feeds back into the sim.** The cutaway is presentation only (invariant 4).

The cutaway costs nothing until the lead turns on a trigger: no material, program or uniform exists before the first
cut.

## WebGL2 path

- **Maths:** `units/building-cutaway.ts` holds the constants, the volume table (`CutVolume { cx, cz, r, w, yCut, yTop }`)
  and `cutawayOps<T>` (the cut test, the band slope, the cap band) written against `Ops<T>`.
- **The GLSL:** spells the same constants. It is pinned line for line in its test, the way P4 pins `rlHoleEdge`.
- **The hook:** `holed-material.ts`'s hook gains an `rl-cut` term. Its parts:
  - one global uniform block `uRlCutV[8]`, `uRlCutN`, shared by reference by every cut clone and depth material;
  - the discard and the cap tint, run after the hole test;
  - interior shading reused on back faces.
- **The clone:** `BuildingHoleMaterials` becomes `BuildingCutMaterials`. A building gets its clone on its first hole OR
  its first cut. When its cutaway closes and it has no holes, it returns to its band material and the clones are
  released, so "no trigger" leaves the scene as it is on `main`.
- **Space:** world space, P4's ruling: a standing building never moves.
- **Colour:** the section cap and interior colours are palette keys resolved through `hexToLinear` (vertex and uniform colours must be LINEAR), never a raw hex.
- **AO pre-pass:** the cut is consistent with it. The AO occluder uses the building's depth material, which carries the same `rl-cut` mask, so a cut building does not occlude the units inside it. (The `rlAoExempt` opt-out in `ao-occluder.ts` is not used.)
- **`photographGround` (the minimap):** EXEMPT, stated explicitly. The minimap is a map-wide photograph and shows the uncut footprint; `photographGround` suppresses the cut (volume count forced to 0 for the photograph, restored after, as the rain batch is hidden and restored there).

## TSL twin (WebGPU)

`units/building-cut.node.ts` is a `MeshStandardNodeMaterial` twin of a band material's cut clone (key `rl-cut`), in the
pattern of the `T9` tunnel x-ray and the `P3` unit twins:
- **Discard:** the cut is a `maskNode`.
- **Colour:** the cap and interior are a `colorNode` term chosen by `faceDirection`.
- **Maths:** `cutawayOps` is handed over through `MATERIAL_MATHS`, so the two backends cannot drift.
- **Uniforms:** the volume block is a `uniformArray` over the legacy record's `Float32Array`, by reference.
- **Shadow:** `castShadowNode` carries the same mask. That must be pinned by test on r186 before building on it.
- **Census:** `rl-cut` joins `PORTED_MATERIAL_KEYS` in the PR that lands the twin.
- **Holes:** P4 holes have no twin today (P4 ruling Q3). Porting `rl-holes` into the same twin is decision L7.

## Gates and falsifiers

- **No trigger, no change.**
  - **Nothing selected:** the capture already asserts `renderer.selection.length === 0`.
  - **No garrison:** the sandbox force garrisons nobody (`grep -i garrison packages/app/src/sandbox-force.ts` finds nothing; `sandbox-force.test.ts` is where to pin it).
  - **A new assertion:** a precondition `renderer.cutawayCount() === 0` beside the selection one (`capture-protocol.ts` line 852, the `renderer.selection.length !== 0` throw).
  - **Result:** every gated scenario mints no cut material. 8 on `main`: `SCENARIOS` in `tools/src/golden-diff/capture-protocol.ts` lists 10, and `combat` and `dusk` are report-only.
  - **Falsifier:** a cut on every building as it stands up turns the "no trigger mints nothing" test red.
- **Unit tests (Node):**
  - the cut height, the slope, the cap band and the 8-volume cap (literal oracles);
  - the open and close timings, two frames either side of each edge;
  - a fogged enemy garrison cuts nothing;
  - a garrison's figures land on distinct stations inside the footprint;
  - the GLSL against the TS maths, by text;
  - the twin compiled on GLSL and WGSL.
- **Falsification, one line each (constructed and run, then put back):**
  - open and close timings: change the open duration constant 250 to 251 (or the hold 1.0 s to 1.1 s); the edge test two frames either side goes red.
  - GLSL-vs-TS text pin: edit one constant in the GLSL (the edge band `0.5` to `0.6`) and leave the TS; the text pin goes red.
  - twin compile test: rename one uniform in the TSL twin (`uRlCutV` to `uRlCutX`); the GLSL and WGSL compile test goes red.
  - `cutawayCount() === 0` precondition: force one cut (select a unit beside a house in the scenario) and the capture throws "precondition violated".
- **Mutations to show red:**
  - the cap at 9;
  - a fogged garrison cut;
  - the band removed (a hard cut);
  - the shadow left whole;
  - the clone kept after the cut closes.
- **Sandbox flag.** `&cutaway` is added to the `SANDBOX_FLAGS` table in `packages/app/src/sandbox-help.ts` (and `SandboxFlagName`), marked sandbox-only: it garrisons a house for the capture and never changes how a real mission scores. `sandbox-help.test.ts` pins the table.
- **A new gated `cutaway` scenario.** It shows a sandbox-only `&cutaway` garrison on a house at the capture tick, with
  the iris long finished. PENDING floors until CI reads it, in the `rubble` and `ragdoll` pattern. No local bless.

## Lead decisions (ruled 10 Nov, GH-1225)

| # | Decision | Ruling |
|---|---|---|
| L1 | Cut shape: Option A (vertical cylinder) or Option B (view-line slot) | **A chosen**: one shape serves both triggers, it reads as a floor plan, and it can cut the shadow |
| L2 | Cut height: ground + 0.4 t, or only the top storey | **Accepted: 0.4 t**: garrisoned units stand on the ground inside |
| L3 | Selection radius 1.25 t, band 0.5 t | **Accepted: Yes** |
| L4 | Open 250 ms, hold 1.0 s, close 400 ms, on the frame clock | **Accepted: Yes** |
| L5 | Cut the shadow with the building | **Accepted: Yes**: units inside read lit. P4 already cuts the shadow for holes |
| L6 | Spread garrison figures to slot stations (presentation only) | **Accepted: Yes**: otherwise the cut shows one stack at the centre |
| L7 | Port P4's holes into the same twin | **Accepted: Yes**: one twin, one hook, and the WebGPU holes gap closes |
| L8 | At most 8 volumes, garrisons first | **Accepted: Yes** |

## Risks

- **Ordering:** P4 (PR 1221) must merge first, and the hook grows one more term.
- **Look:** a hollow shell over the dark `underBuilding` ground. The units read well against it (olive at 0.16 luminance
  against about 0.02), but the lead should see it at zoom 1.0 and 2.2 before it ships.
- **Shadow pop:** selecting a unit beside a house cuts its shadow. The 250 ms iris softens that.
