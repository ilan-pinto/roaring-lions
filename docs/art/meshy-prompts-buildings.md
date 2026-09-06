# Meshy prompts — buildings

Queued backlog item behind "next I would like to improve buildings" (the lead,
2026-09-06): suggest Meshy prompts for the building types the campaign wants
and does not have, grounded in what ships. Sibling of
`meshy-prompts-characters.md` and `meshy-prompts-ashwar.md`, and it follows
their form: read-this-first, numbers to approve, a shared paragraph, the five
things every prompt asks for, one prompt per asset, what lands where,
disclosure. Nothing here has been generated or rendered — this is a spec, not
a render, per `.claude/agents/blender-art.md`'s pre-render gate.

Written against `feat/story-act-1` at this session's checkout. Every claim
about what ships cites a path. The read-only census of `art/blend/` is against
the main checkout (`/Users/ilpinto/dev/roaring-lions/art/blend/`), where the
supplied Meshy sources actually live — that directory does not exist in this
worktree at all (`docs/ASSET_PROVENANCE.md`: gitignored, per-checkout).

---

## Read this before generating anything

**All eight declared structure types already ship, textured or not, wreck
included.** `data/structures.json` (`shanty house apartment warehouse concrete
wall mosque camp`) is confirmed complete against `art/meshes/buildings/` — 16
GLBs, idle + wreck for every type, all eight wired into
`packages/app/src/mesh-catalogue.ts`'s `BUILDING_MESHES` and loaded by
`packages/app/src/main.ts` on the roster-driven mesh path. `docs/campaign/
storyline.md` §6.1 confirms the same count independently: *"Structures — all 8
… are PRESENT in `data/structures.json` with idle + wreck GLBs."* **This
document is not about filling gaps in those eight — there are none.** It is
about the building the campaign asks for that has no type at all (the clinic),
the one type that violates GDD §2 outright (the mosque), and a short list of
set-pieces the design docs describe but the map currently fakes with a
building that reads wrong.

**Reuse beats generation, twice over in this batch.** The Ashwar document's
central lesson — `militia_cell` needed no new Meshy art, only a different
arrangement of a figure already shipped — has a building-side echo here: Sur's
battery revetment (Tel Marum) needs no new asset either. `camp.glb` is already
a sandbag/HESCO earthwork with a command tent (`tools/buildings/
export_meshy_camp.py`'s own census: 375 objects, three roles, zero materials).
A building has no faction colour (`data/structure.schema.json` has no
`produces_for` owner for the seven civilian types — *"neutral terrain and
carry no owner at all"*), so the identical GLB reads as a dug-in gun position
regardless of which side stands it. See prompt 4 below: it asks for nothing.

**A photograph beats a palette ramp for anything with a door or a window, and
that is a measured finding, not a preference.** `units/textured-building.ts`'s
own top comment: on `concrete.glb`, the `glass` role — the only thing standing
in for a window on the palette path — is **1.3% of visible pixels**. On the
textured `house` the windows and the door are part of the photograph. That is
why the clinic and the civic-hall redesign below are proposed as textured
generations, following `house`/`apartment`/`warehouse`, not as kit-built
palette boxes following `mosque`/`shanty`/`concrete`/`wall`.

**Numbers already measured on this pipeline, corrected against a stale figure.**
The sibling documents' texture-budget line ("ask 2048, ship ≤ 1024") is a
*figure* number and does not transfer. The real building budget, measured on
the house's own 19,445-vert intact mesh with geometry held constant
(`tools/buildings/textured.py`'s own docstring table):

```
4096 px  12,681,368 B   (texture ~11.4 MB -- absurd)
2048 px   1,766,504 B   (texture ~526 KB)  <- TEXTURE_PX, the shipped pick
1024 px   1,381,460 B   (texture ~141 KB)
 512 px   1,277,380 B   (texture ~37 KB)
```

2048 is shipped, not 1024 — it holds the mortar lines between masonry courses
and the window-shutter slats that 1024 blurs (`textured.py`, `JPEG_QUALITY =
85`). Shipped GLB totals for the three textured types: `house.glb` 1.83 MiB,
`apartment.glb` 1.40 MiB, `warehouse.glb` 1.19 MiB (`ls -la art/meshes/
buildings/`, this session). Decimation: `DECIMATE_RATIO = 0.02` for house
(`tools/buildings/export_meshy_house.py:327`), `0.01` for apartment and
warehouse (`tools/buildings/export_meshy_apartment.py:387`,
`tools/buildings/export_meshy_warehouse.py:301`). Any new textured type in
this batch should ask for and ship the same numbers — there is no case in this
pipeline for a different one, and inventing one would be an untested
departure from the only two data points this project has measured.

**The role vocabulary for a building is a closed set of eight, distinct from a
unit's ten.** `packages/render/src/three/units/building-mesh-role.ts`:
`wall, roof, trim, dome, wood, glass, metal, rust`. A part named outside that
list gets no colour on the palette path (`buildBuildingMeshTemplate` throws:
*"no ramp for rl_role"*) — this only binds a **kit-built / palette** type; a
**textured** type's mesh takes the texture branch before role lookup even
runs (`mesh-building.ts`'s own comment: "Deliberately checked BEFORE
`isBuildingMeshRole`").

**The textured exemption is a list on both sides, and adding a type here means
extending both.** `TEXTURED_BUILDING_TYPES` (`packages/render/src/three/
units/textured-building.ts`) and `TEXTURED_MESH_EXEMPT`
(`tools/validate_mesh_assets.py:150`, currently `{"house", "apartment",
"warehouse"}`) must stay in lockstep — `textured-building.test.ts` parses the
Python set and pins them against each other. A GLB outside the list that
ships a texture anyway **throws**, not silently upgrades.

**The facing gate, per shipped type — read before asking for a front on
anything.** `tools/building_facing.py`'s own measured table (module
docstring):

| type | camera px / hidden px | verdict |
|---|---|---|
| `mosque`, `mosque_wreck` | 3071/198, 2939/186 | directional, correct |
| `house` | 5708/0 | directional, correct |
| `shanty_wreck` | 607/130 | directional, correct |
| `shanty` (idle) | 1215/922 | **symmetric** (1.32x, below `FRONT_MARGIN=2.0`) |
| `warehouse` | 1946/1757 | symmetric — roller doors on both gable ends, genuinely no front |
| `concrete`, `concrete_wreck` | 1080/1080, 333/370 | symmetric |
| `apartment`, `camp`, `wall`, `house_wreck` | — | **no `glass` role at all — unchecked**, named on the passing path |

`apartment`'s windows are painted into its bake with no separate pane, so it
has no `glass` role and the gate cannot see a front on it at all — not a
defect, a known limit (`CLAUDE.md`'s "Mesh units" section says the same). Any
new type this document proposes as **textured** needs an actual `glass` mesh
(a modelled pane, not a painted one) if it wants the gate to judge its facing
at all; otherwise it ships in the same "unchecked, and named as such" bucket
`apartment` already occupies, which is acceptable but should be a stated
choice, not an accident.

**Textured replacements for the five kit-built types: not recommended for
four of them, and the fifth (`mosque`) is the redesign below, not a like-for-
like swap.** `shanty` and `wall` are too small on screen for a photograph to
buy anything — the same "model quality is nearly irrelevant at 40-80px" rule
`docs/ART_PIPELINE.md` §0 states for units applies here, and both are the
smallest footprints in the catalogue (1 and 3 tiles). `concrete`'s flatness is
the point, in the export script's own words (`tools/render_building.py`'s
`CONCRETE` spec comment: *"Poured concrete, so no coursing — and the
blankness is the point"*) — texturing it would undo the one thing it was
authored to be. `camp` already ships AI-sourced geometry
(`export_meshy_camp.py`) with **zero materials, zero images, zero UV
layers** by its own census; it draws at the same tiny scale as a soldier, and
nothing has measured a photograph reading better there than the current
vertex-colour role split does. `mosque` is not "left kit-built" — see the O10
prompt below, which proposes replacing it outright, and asks the lead to pick
between a kit-built and a textured redesign explicitly rather than defaulting
either way.

---

## What campaign design asks for and lacks

Ranked by how many shipped or designed missions would actually draw it, not
by how interesting the prop is.

| rank | ask | grounding | what exists today |
|---|---|---|---|
| 1 | **A clinic type** | `data/missions/beit_sahwan_3_clearance.json` briefing: *"the clinic on the southern block is protected … Sahim … holds a position inside the clinic block itself"*; the `clinic` zone is `flagged_zones` in **four** mission files — `beit_sahwan_3_clearance.json:136`, `beit_sahwan_4_subterranean.json:92`, `beit_sahwan_breach.json:173`, and `beit_sahwan_0_tutorial.json:62` (as `z_clinic`) | The zone `[29,23,6,6]` in `data/maps/beit_sahwan_outskirts.json` is a 4×4 block of the **`w` (warehouse)** symbol surrounded by cover-2 (rows 24–27: `2wwww2`). The player is told a clinic and shown a warehouse |
| 2 | **A doctrine-neutral civic type, replacing `mosque`** | `docs/campaign/storyline.md` O10: *"A structure type named for a place of worship of a real faith (`roe_penalty` 30, on three maps) — GDD §2 says never a faith"*; three maps carry the `m` tile — `beit_sahwan_outskirts` (9), `wadi_halam_basin` (9), `marj_perimeter` (4), corrected count per `storyline.md`'s own census note | `mosque` — dome, minaret, `data/structures.json` entry named for the real building type, `roe_penalty: 30`, the highest in the catalogue |
| 3 | **A lighter perimeter fence, distinct from `wall`** | GDD §5.7 Breach mission: *"holding a walled perimeter with the road still open behind it"* (`docs/GDD.md:87`); `CLAUDE.md`'s own elevation discussion already reaches for "a low-profile obstacle like a fence" as the canonical example of something that never blocks sight — a fence is discussed here as a *concept* and has never shipped as a type | `wall` — a masonry compound wall, `hp_per_tile: 200`, `standing_cover: 2`. Nothing lighter exists, and three supplied, **unexported** Meshy fence sources already sit on disk (see below) |
| 4 | **A dug-in gun position for Sur's battery** | `docs/campaign/map-variants-design.md`: *"the battery revetment `b`: berm at y=5, x=22–26"* (line 529), *"the gun sits in the revetment it has been firing from all [the fight]"* (line 489) | Nothing — the revetment is authored today as a terrain berm (`b`, boulder-field mask), not a structure. No structure stands at `battery_position` at all |
| 5 | **A relay hut, visually distinct from a plain blockhouse** | `docs/campaign/tel_marum/design.md:535`: *"`crest_top` — two `#` tiles, one concrete structure: Adhal's relay hut"* | `concrete` — a 2-tile poured-concrete block with no distinguishing feature. Mechanically fine; reads as an anonymous bunker, not a signals post |
| 6 | **A pump house, visually distinct from a shed** | `docs/campaign/wadi_halam/design.md:136`: *"his forward store at the pump house"*; the mission text (`data/missions/wadi_halam_2_laager.json`): *"Burn the forward store at the pump house"* | `shanty` — placed via `structures[]` at `[16,19]`, 2×2 (`data/missions/wadi_halam_2_laager.json`'s `structures` array). Mechanically fine; reads as a generic shed |
| 7 | Market stalls, a water tower, garages | **Not found in any campaign design document searched** (`docs/campaign/*.md`, `docs/campaign/*/*.md`) — these read as plausible town-vernacular filler rather than a cited need. Recorded because the orchestrating brief named them, not because a mission asks for them | — |
| 8 | Rubble footings for map variants | `docs/campaign/map-variants-design.md` uses `b` (the boulder/vehicle-block mask) to represent a building that "came down" in a variant (e.g. line 668: *"reduced to `b` rubble — a building that came down"*), reusing the natural-boulder decor mesh for man-made debris | The `boulder` decor family (`art/meshes/decor/boulder_*.glb`) already covers the mechanical need (impassable to vehicles, open to foot); it was modelled as natural rock, not masonry debris |

Not carried forward from the orchestrating brief as separate asks, because
census found they are already solved: **stock pens** are already a `shanty`
placement (`map-variants-design.md:394`: *"stock pen `s` 2×2 … a `shanty`,
120 hp/tile"*); **"the depot"** and **"the hamlet"** are zones built entirely
from the seven existing civilian types (`wadi_halam/design.md`'s depot: 3
`warehouse`, 2 `concrete`, 2 `shanty`; Tel Marum's `stockpile`: `w`×9, `#`×6,
`s`×2) and need no new geometry, only more of what ships; **wells** and
**"a stone post"** (`tel_marum/design.md:507,523`) are markers/zones with no
building on them at all — `uz_wells` and `post_stone` are a 2-tile `shanty`
plus terrain, not an unbuilt type.

---

## Numbers to approve before generating anything

Ranks 1–6 only — 7 and 8 are not proposed as full building-type generations
(see their own notes below).

| type (proposed id) | footprint (tiles) | real size | placement | texture budget | decimation | schema/data changes |
|---|---|---|---|---|---|---|
| `clinic` | 4×4, matching the `w` block it replaces | ~12m × 12m, single storey, ~4.5m eave | **new symbol**, `k` (free — not in `TERRAIN_SYMBOLS` or any `data/structures.json` `symbol`) | ask 2048, ship 2048 JPEG q85 (`house`/`apartment`/`warehouse` precedent, not the figure-document's 1024) | ~0.01–0.02, matching `apartment`/`warehouse` | new `structure.schema.json`-conformant entry; add to `TEXTURED_BUILDING_TYPES` + `TEXTURED_MESH_EXEMPT`; map edit to `beit_sahwan_outskirts.json` (owned by the concurrent map/mission agent — **not touched here**) |
| `hall` (O10 redesign) | 3×3, unchanged from `mosque`'s own `footprint_tiles=3` | unchanged silhouette scale from shipped `mosque.glb`; height is the artist's call once the appearance brief (below) is fixed | **reuses the existing `m` symbol** — no map edit needed on any of the three maps that already author it | if textured: 2048/JPEG q85 as above. If kept kit-built: no texture, palette-painted per the existing `mosque` pipeline | if textured: ~0.01–0.02. If kit-built: none (procedural mesh, no decimation step in `tools/render_building.py`'s pipeline) | rename/replace the `mosque` id **or** add a new id and retire `mosque` — the lead's call, see Open Decisions. Either way, `art/meshes/buildings/mosque.glb`+`_wreck` are regenerated in place if the id is kept, or `BUILDING_MESHES`/`data/structures.json` gain a new id if it is not |
| `fence` | 1, `per_tile: true` (matches `wall`'s own shape) | 3m run × ~2.0m high, ~0.05m thick mesh/wire | **new symbol**, `f` (free) | none — palette-painted, no texture requested from Meshy for this one (a wire fence has no facade to photograph; see prompt) | light — these sources are already low-poly `3d`-mode generations, not photogrammetry scans | new `structure.schema.json` entry, `per_tile: true`, `low_profile: true`, `standing_cover: 1` (lighter than `wall`'s 2 — see Open Decisions), `hp_per_tile` well under `wall`'s 200 |
| revetment (Sur battery) | 2×2 | unchanged — **reuses `camp.glb`/`camp_wreck.glb` as-is** | `structures[]` in the owning Tel Marum mission (camp precedent) — **no new symbol** | n/a — no new asset | n/a | **none to `structures.json`** (the `camp` entry already exists); only a mission JSON edit (owned by the concurrent agent — **not touched here**) |
| `relay` | 2×2, matching the existing `concrete` footprint at `crest_top` | ~2 storeys (~6m) blockhouse + a ~4m mast/dish on the roof | `structures[]` in the owning Tel Marum mission, replacing the 2×2 `concrete` placed there today — **no new symbol** | ask 2048, ship 2048 if textured (a mast/dish reads better as a modelled silhouette than a texture — recommend **kit-built palette**, not textured, since the whole distinguishing feature is shape, not surface) | n/a (kit-built) | new `structure.schema.json` entry; mission JSON edit (not touched here) |
| `pump_house` | 2×2, matching the existing `shanty` footprint at `pump_house` | ~3m shed + a ~2.5m tank | `structures[]` in the owning Wadi Halam mission, replacing the 2×2 `shanty` placed there today — **no new symbol** | recommend kit-built palette, same reasoning as `relay` | n/a (kit-built) | new `structure.schema.json` entry; mission JSON edit (not touched here) |

---

## The shared paragraph — put this in every building prompt in this batch

Repeat verbatim at the top of every prompt below, the way the Ashwar document
repeats its shared fighter and the character document repeats the KDF
paragraph. Names nothing real, per GDD §2 and `CONTRIBUTING.md`:

> Vernacular construction of a fictional, arid river-basin region: flat
> poured-concrete or breeze-block roofs, rendered masonry walls the colour of
> sun-bleached limestone and dust ochre, visible rebar stubs at unfinished
> corners, a patina of dust and weathering, mismatched external paint,
> satellite dishes and water tanks on the roofline, tangled low-voltage wiring
> strung between buildings, external rooftop water tanks on steel legs. No
> signage, text, or symbol in any real-world script or language, anywhere on
> the structure. No flags, no religious iconography, no national or
> paramilitary insignia of any kind.

## Every building prompt asks for the same five things

> Separable named parts using this exact eight-role vocabulary: `wall`,
> `roof`, `trim`, `dome`, `wood`, `glass`, `metal`, `rust` — a part named
> outside this set draws no colour in-engine, so name every mesh with one of
> these. Flat, unornamented ends on any face that must butt against an
> identical copy of itself in a repeating run. No ground plane, no base
> plinth, no baked shadows, no separate stand — the model's own world origin
> at ground level is the anchor point the game places it by. Any entrance,
> door, window or other opening modelled facing the model's **+X and +Z**
> axes — the building is placed once and never turns, so whichever side is
> generated facing forward is the side the player always sees. Real-world
> scale in metres. **If this is a textured generation**, a single base-colour
> bake with no metallic, roughness or normal map — there is no PBR lighting
> rig in this engine to consume them.

And, because the collapse shroud needs geometry to reveal rather than a
repaint (`packages/render/src/three/units/mesh-building.ts`'s own
`BUILDING_SETTLE_SECONDS` grows a wreck in from a squashed pile — it has
nothing to grow into if the wreck is just the idle mesh recoloured):

> Generate a destroyed/wreck variant of the same building in the same
> session: the roof collapsed inward or gone entirely, at least one wall
> section down or breached, structural members exposed and bent, a rubble
> footing spilling outward at the base — visibly the same building, fallen.

---

## Prompt 1 — Clinic (`clinic`)

> *[the shared vernacular paragraph]*
>
> A small rural clinic or dispensary, single storey, rectangular, flat roof:
> rendered masonry walls a slightly cleaner, more recently whitewashed
> off-white than the surrounding vernacular, a shaded concrete awning or
> covered porch running the length of the entrance side, a wheelchair ramp
> beside the front steps, external oxygen or gas cylinders racked and chained
> beside a side door, a small rooftop water tank on steel legs, a rooftop
> HVAC condenser unit, external electrical conduit and a small backup
> generator housing at one corner, shuttered windows along the front facade
> at regular intervals, a double entrance door under the awning. No medical
> cross, crescent, or any other real-world symbol anywhere on the building —
> the cleaner whitewash and the awning/ramp/cylinders are what read as
> "clinic," not an emblem.
>
> *[the five things]*
>
> Footprint approximately 12m × 12m (a 4×4-tile block), single storey, eave
> height approximately 4.5m. Ask for a 2048 base-colour bake.

**Why no medical symbol.** A red cross or crescent is a real-world protected
emblem tied to a real convention; GDD §2 already forbids depicting a real
faith or people, and a protected-medical emblem carries the identical
problem one step removed. The awning, ramp, whitewash and cylinder rack do
the work the mosque's dome does for that building — reading unmistakably as
one type of civic structure — without naming any real institution.

## Prompt 2 — Civic Hall, replacing `mosque` (`hall`, O10)

**This prompt is deliberately incomplete until the lead answers Open Decision
1 below** (a name, and kit-built vs. textured). What follows is the shape of
the ask either way.

> *[the shared vernacular paragraph]*
>
> A large civic hall — the settlement's biggest communal building, for
> gathering rather than worship: a broad rectangular masonry hall with a
> raised, gently pitched or flat roof, a modest bell-less clock tower or
> plain square watchtower at one corner in place of a minaret, a wide
> colonnaded portico across the entrance facade with three or four masonry
> archways, a small paved forecourt, no dome. Coursed masonry to match the
> other civic buildings in this vernacular. The tower is for sight and
> presence, not for any religious call — plain, square, flat-topped, no
> ornament that reads as sacred architecture of any faith.
>
> *[the five things]*
>
> Footprint unchanged from the shipped `mosque` — a 3×3-tile block. Ask for a
> 2048 base-colour bake if generated as a textured replacement (recommended,
> given the measured 1.3% `glass`-role pixel coverage on the palette path);
> if the lead prefers to keep this kit-built and palette-painted like
> `shanty`/`concrete`/`wall`, drop the texture ask entirely and build it in
> `tools/buildings/kit.py` instead, the way `mosque.blend` predates that kit
> today.

**Why a tower and not nothing.** The mosque's dome and minaret are the
silhouette that makes it identifiable at 64px and that earns its
`roe_penalty: 30` — the highest in the catalogue, because it reads as
unmistakably protected. Removing every distinguishing feature would produce
a building nobody hesitates to level, which defeats the mechanical purpose
the type exists for. A plain civic tower keeps the silhouette height and the
"this matters" read without keeping anything that names a real faith.

## Prompt 3 — Perimeter fence (`fence`)

**No Meshy generation needed.** Three sources already exist, supplied and
unexported (main checkout, read-only census this session):

```
art/blend/terrain object/fences/Meshy_AI_fence_segment_v1_3d_0901144739_image-to-3d-texture.blend
art/blend/terrain object/fences/Meshy_AI_fence_segment_v2_3d_0901144931_image-to-3d-texture.blend
art/blend/terrain object/fences/Meshy_AI_fence_segment_v3_3d_0901145002_image-to-3d-texture.blend
```

All three are `3d`-mode generations (not `part-segmentation`), so unlike
`camp`'s vertex-colour role split, these likely need hand-authored role
naming on import rather than a hue-bucket classifier — inspect each file's
object count and material state before writing the export script; do not
assume the `camp` pipeline transfers unmodified.

**The three-variant question is real and unresolved.** `wall`'s own
`per_tile: true` mechanic draws one sprite per occupied tile, and the current
mesh-building pipeline (`ThreeRenderer.loadBuildingMesh`) loads exactly one
idle template and one wreck template per structure **type**, with no
per-instance variant selection. Two honest paths:

1. **Pick one of the three supplied variants as the canonical `fence.glb`.**
   Ships today, no engine work, and is exactly what `wall` already does (one
   look, repeated).
2. **Extend the building-mesh path to select a variant per placed tile**
   (the `boulder_0/1/2` decor precedent). More faithful to a real fence run,
   real engine work, not scoped here.

Recommend (1) for a first pass; flag (2) as a stretch item rather than block
on it, matching this pipeline's own effort-conscious precedent (Ashwar's
`militia_cell` shipping with zero new art rather than waiting on a perfect
solution).

If a fresh generation is ever wanted instead of the supplied three, the
prompt would read:

> *[the shared vernacular paragraph]*
>
> A single run of chain-link perimeter fencing on steel posts, roughly 3
> metres between posts, galvanised wire mesh sagging slightly between posts,
> a single strand of barbed wire angled outward along the top, rust streaks
> at the base of each post, a section that has been crudely patched with
> wire in one place. No gate, no signage, no razor wire in coils.
>
> *[the five things, but without a texture ask — a wire fence has no facade
> to photograph, and this is proposed as a palette-painted `wall`/`shanty`-
> class type, not a textured one]*
>
> One post-to-post segment, 3m long, ~2.0m tall including the barbed-wire
> strand, flat/planar at both ends so it butts cleanly against a repeated
> copy of itself.

## Prompt 4 — Sur's battery revetment: no prompt

Reuse `art/meshes/buildings/camp.glb` / `camp_wreck.glb` exactly as shipped.
`data/structures.json`'s `camp` entry is already ownerless — the seven
civilian types (and `camp`) carry no `produces_for` side, so the identical
sandbag/HESCO earthwork reads correctly for either faction; nothing about the
GLB says "KDF". Wiring is a single `structures[]` entry in the Tel Marum
mission that owns `battery_position`, sized to the 2×2 the mission already
uses for `camp` elsewhere (`data/missions/beit_sahwan_2_foothold.json`'s own
precedent). **Not touched here** — mission JSON is the concurrent agent's
territory.

## Prompt 5 — Relay hut (`relay`)

Recommended **kit-built and palette-painted**, not textured — the
distinguishing feature the design doc asks for is a silhouette (a mast or
dish on a blockhouse), not a surface, and `concrete`'s own export comment
already states the principle this shares: a poured-concrete surface with
nothing on it is not a failure to texture, it is the correct look for
military-utilitarian construction in this vernacular.

> *[the shared vernacular paragraph]*
>
> A small unmanned communications relay post: a squat two-storey poured-
> concrete blockhouse with narrow slit windows, a external steel ladder
> bolted to one wall running to the flat roof, a tall thin lattice or
> monopole mast rising from the roof with two small parabolic dishes and a
> whip antenna mounted on it, a junction box and cable conduit running down
> the mast to the building, a small rooftop solar panel angled toward the
> sky. No markings, no call sign, no flag.
>
> *[the five things — role-tagged for the palette path: the blockhouse body
> is `wall`, the roof deck `roof`, the mast and dishes `metal`, the ladder
> `metal`, any rust streaking `rust`]*
>
> Blockhouse footprint 2×2 tiles (6m × 6m), body height ~6m, mast rising a
> further ~4m above the roofline for a ~10m total silhouette. No texture
> requested.

## Prompt 6 — Pump house (`pump_house`)

Recommended kit-built and palette-painted, same reasoning as `relay`.

> *[the shared vernacular paragraph]*
>
> A small agricultural pump house: a single-room breeze-block shed with a
> corrugated-metal shed roof, a squat cylindrical steel water tank on a
> raised steel-legged stand beside it, exposed galvanised pipework running
> from the tank into the shed wall and out again toward the field, an
> external electrical box and conduit, a puddle stain and mineral scale
> streaking down from the tank's overflow pipe, a single plank door standing
> ajar.
>
> *[the five things — the shed body is `wall`, roof `roof`, tank and pipework
> `metal`, door `wood`, staining `rust`]*
>
> Footprint 2×2 tiles (6m × 6m) including the tank stand, shed height ~3m,
> tank height ~2.5m including its stand. No texture requested.

## What was not prompted, and why

**Ranks 7 and 8 are not written as full building-type generations.** Market
stalls, a water tower and garages have no citation in any campaign design
document searched this session — writing a full numbers-and-prompt entry for
an unconfirmed need would be inventing a requirement rather than reporting
one. If the lead confirms a town scene wants them, they read as **decor
scatter** (`art/meshes/decor/`, the `DECOR_MESHES` table in
`packages/app/src/mesh-catalogue.ts`), not `data/structures.json` types —
none of the three needs HP, a garrison, or a ROE penalty, which is the entire
mechanical reason a `structures.json` entry exists. Rubble footings for map
variants are the identical case: the mechanical need (impassable to
vehicles, open to foot, no HP) is already met by the `boulder` decor family,
and the only gap is that boulder decor was modelled as natural rock, so a
variant with masonry-debris silhouette (broken block, rebar, a shattered
lintel) rather than a rock silhouette would read more honestly as "a building
came down here" — worth a decor-team follow-up, not a structures.json type.

---

## What lands where

| type | `art/blend/` source | export script | GLB output | `structures.json` | placement | gates |
|---|---|---|---|---|---|---|
| `clinic` | new Meshy generation, once approved | new `tools/buildings/export_meshy_clinic.py`, modelled on `export_meshy_house.py`'s role-split/decimate/join pattern | `art/meshes/buildings/clinic.glb` + `_wreck.glb` | new entry, symbol `k` | map edit to `beit_sahwan_outskirts.json` swapping the clinic zone's `w` tiles to `k` (not touched here — concurrent agent) | `pnpm validate:meshes` (facing gated only if a modelled `glass` pane is included; silhouette IoU always runs); `pnpm validate:data` (new symbol cross-check, `tools/validate_data.mjs`) |
| `hall` (O10) | new Meshy generation, or a `tools/buildings/kit.py` build, per the lead's choice | new `export_meshy_hall.py` (textured path) **or** extend `render_building.py`'s `BUILDINGS` + `export_mesh_building.py` (kit-built path) | replaces or supersedes `art/meshes/buildings/mosque.glb` + `_wreck.glb` | rename/replace the `mosque` entry, symbol unchanged (`m`) | none — the three maps that already author `m` need no edit | same as above; the facing gate's existing `mosque`/`mosque_wreck` "directional, correct" verdict must be re-measured against new geometry, not assumed to carry over |
| `fence` | supplied, `art/blend/terrain object/fences/*.blend` (three variants, unexported) | new `tools/buildings/export_meshy_fence.py` | `art/meshes/buildings/fence.glb` + `_wreck.glb` | new entry, symbol `f`, `per_tile: true`, `low_profile: true` | new map symbol, authorable directly in any map's rows | `pnpm validate:meshes`; `pnpm validate:data` (symbol cross-check) |
| revetment | none — reuses shipped `camp.glb`/`camp_wreck.glb` | none | none | none (existing `camp` entry) | `structures[]` in the owning Tel Marum mission (not touched here) | none beyond what `camp` already clears |
| `relay` | new kit-built geometry in `tools/buildings/kit.py`/`render_building.py`, or a small Meshy generation if the lead prefers photographed metal | extend `export_mesh_building.py`'s `BUILDINGS` table (kit-built path) | `art/meshes/buildings/relay.glb` + `_wreck.glb` | new entry | `structures[]` in the owning Tel Marum mission, replacing the `concrete` placed at `crest_top` today (not touched here) | `pnpm validate:meshes`; `pnpm validate:data` (no new symbol needed) |
| `pump_house` | new kit-built geometry, same reasoning as `relay` | extend `export_mesh_building.py`'s `BUILDINGS` table | `art/meshes/buildings/pump_house.glb` + `_wreck.glb` | new entry | `structures[]` in the owning Wadi Halam mission, replacing the `shanty` placed at `pump_house` today (not touched here) | same as `relay` |

Every new textured type must be added to **both** `TEXTURED_BUILDING_TYPES`
(`packages/render/src/three/units/textured-building.ts`) and
`TEXTURED_MESH_EXEMPT` (`tools/validate_mesh_assets.py:150`) in the same
change — `textured-building.test.ts` fails if the two lists disagree, and a
GLB shipping a texture outside both lists throws at load
(`buildBuildingMeshTemplate`'s `smuggled` check).

---

## Disclosure

Every prompt above, if generated, is AI-generated art and the PR that ships
it must say so (`CONTRIBUTING.md`, `.claude/agents/blender-art.md`). The
three supplied fence sources are already AI-generated (Meshy) and already
covered by the same disclosure obligation the moment they are exported —
disclosure attaches to the asset entering the game, not to the moment of
generation.

**Licensing note specific to this batch.** `docs/ART_PIPELINE.md` §8: art and
data are now all-rights-reserved (changed 2026-08-30, ahead of a planned
commercial release), and `docs/ASSET_PROVENANCE.md` records the Meshy plan in
use as confirmed for commercial use by the lead. Nothing here changes that
provenance question; it is recorded here only so a reader does not have to
re-derive it while wiring a new type.

---

## Open decisions for the lead

1. **The O10 name and appearance.** "Civic Hall" (`hall`) is this document's
   proposal, not a decision — the lead may want a different register (a
   council house, a market hall, something with no echo of "hall of
   gathering" either). Separately: **kit-built or textured?** The four
   remaining kit-built types are cheap to keep because texture buys nothing
   at their scale or against their intended blankness; `mosque` is the
   opposite case — it is the tallest, most detailed civilian building in the
   catalogue, and a photograph would likely read as well here as it does on
   `house`. Recommend textured, but it is a real cost (a fresh 2048 bake,
   ~1.2–1.8 MiB GLB) against a kit-built alternative that costs nothing
   beyond geometry authoring time.
2. **Do fences block movement?** `wall` fully blocks (a compound wall you
   cannot walk through). A real chain-link fence does not stop a person
   climbing it, but it should probably still stop a *vehicle*, which is
   exactly the `b`/`d` mechanical shape (open to foot, impassable to wheels
   and tracks) rather than `wall`'s. This document's numbers table proposes
   `low_profile: true` with a full block (the `wall` shape) as the simpler
   first cut, but the `b`/`d` shape is arguably the more honest one and
   would need a new terrain-symbol-style mask rather than a `structure.
   schema.json` field, since `per_tile` structures block absolutely today.
   Recording the balance consequence rather than picking it: a fully-
   blocking fence around a KDF perimeter (First Light) makes that compound
   read as more defensible than intended if a wall this thin should not be
   read as full masonry cover.
3. **Does every new type get a map symbol?** This document recommends symbols
   only for types a base map authors directly and that multiple missions
   share off one map (`clinic`, reused by four missions off one map;
   `fence`, intended for reuse across any compound). It recommends
   `structures[]` placement with **no** symbol for anything that is a
   single named set-piece tied to one mission's own marker (`relay`,
   `pump_house`, the Sur revetment) — following the `camp` precedent exactly
   (`docs/campaign/storyline.md` §6.1: *"the one building type that reaches
   the map from mission JSON rather than from a map symbol"*). The lead may
   prefer symbols for all of them regardless, trading a mission-JSON edit
   for a map-grid edit.
