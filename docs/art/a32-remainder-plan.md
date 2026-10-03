# WP-A3.2 remainder — plan and Meshy estimate (GH-185)

**Status: plan for the lead's approval, 2026-10-02. No Meshy call has been made;
every number below is from `pnpm meshy -- estimate` (free, no API call), the
committed ledger, or the tree at `origin/main` (`2b539784`).**

Picks up where the 1 Oct audit on GH-185 left the package: the ramp set and the
tunnel visuals landed (#314), the field works art landed (#311), and three items
stayed open. Same form as `meshy-prompts-ramp.md`: numbers table first, prompts
second, the calls only after the go. The lead's two standing rules apply — Fable
at high effort for the prompts, and **every model at maximum detail** (style
bible §4: `--tex 8k`, 15 credits, so a textured building is 40 credits, not 35).

## 0. What the audit left, checked against the tree today

| audit line | tree at `2b539784` | what this plan does |
|---|---|---|
| `relay` and `pump_house` (GH-157): no GLB | still no GLB; `BUILDING_MESHES` and `data/structures.json` have neither id. The relay hut IS authored already — two `#` (`concrete`) tiles at (15,7)–(16,7) on `umm_zeitoun.json` and `umm_zeitoun_4.json`, inside the `crest_top` zone `[12,5,5,5]`, and `umm_zeitoun_4_clearance` razes it as its secondary `bring_the_relay_down`. The pump house is `{ "type": "shanty", "at": [16,19], "size": [2,2] }` in `wadi_halam_2_laager.json`'s `structures[]`, next to the `pump_house` marker at [17,20]. **Not on Tel Marum**: `docs/campaign/tel_marum/design.md:548` puts it at `crest_top`, but `tel_marum.json`'s only `#` tiles are the town block at (24–26, 3–4); the hut lives on the Umm Zeitoun maps | §1: numbers and max-detail prompts, 40 credits each |
| damage states (GH-31) and wreck variants | every shipped building type has a `_wreck` (22 pairs in `art/meshes/buildings/`, the eight field-works pairs held in `HELD_MESH_FILES`). **A mesh building shows no damage until it dies**: `ThreeRenderer.updateBuildingMeshes` (~:7150) reads `st.alive` only; the HP darkening (`structureAliveAlpha`, `0.55 + 0.45 × integrity`, `units/structures.ts`) runs on the billboard path alone, which no mesh building takes | §2: procedural, 0 credits; no per-building Meshy identified |
| licensing: Meshy tier, Tiger sprites, Synty FBX, `JEEP_HULL` | the three retirements happened on 2026-09-25 (`30050389`, `38ea4a20`/`30b069c0`, `d23de1a8`) and are recorded in `docs/ASSET_PROVENANCE.md`; the Meshy tier is recorded as the lead's 2026-08-30 word and nothing in the repo verifies it | §3: findings per asset, 0 credits; one action for the lead |

---

## 1. `relay` and `pump_house`

### Shared rules (the ramp set's, unchanged — `meshy-prompts-ramp.md` "Buildings")

- Textured: `text --refine --tex 8k` as ONE call (the CLI has no standalone
  refine on a fresh preview; the preview cannot be judged before the refine
  spends), then `remesh` at the class target. The refine's bake survives the
  remesh (measured three times: Eitan, gun truck, B0b). The 8k bake is
  downscaled to `textured.TEXTURE_PX` = 2048 JPEG q85 at export — the 8k buys a
  sharper 2048, not a bigger file (B8's measurement).
- Exporter: two new `RampSpec` rows in `tools/buildings/export_meshy_ramp.py`
  (the spec-driven module built so "the second building cannot fork the
  first's code"), with their own `OUT_*` constants so `mesh_ownership.test.ts`
  can read what the script writes. Facing by the exporter's own rule: the yaw
  that puts the most dark-opening area on the camera half is chosen from the
  four candidates, printed, never eyeballed; the openings on that half become
  the `glass` role so `building_facing.py` can JUDGE the front (`concrete`
  reads 15.6x, `shanty` 840/0 by that route).
- The wreck is `render_building.collapse()` on the textured pieces — dice,
  punch, crush, spill, seed-free, UV-preserving. No second generation.
- Lists: both ids join `TEXTURED_BUILDING_TYPES` and `TEXTURED_BUILDING_EXEMPT`
  in the same change (`textured-building.test.ts` pins them equal);
  `BUILDING_MESHES` gains both pairs; `data/structures.json` gains two entries
  (schema: `name`, `hp_per_tile` required; no `symbol` for the pump house —
  see the wiring row). `pnpm validate:data` cross-checks every mission
  `structures[]` type against the catalogue, so the mission edits land in the
  same commit as the catalogue entries.
- Pixi and `&nomesh` draw the generic box for a type with no `BLD_*` sheet
  (`mesh-catalogue.ts:633`; the hall's precedent). No sheet is rendered.
- Disclosure: AI-generated (Meshy), per `CONTRIBUTING.md`; task ids into
  `docs/ASSET_PROVENANCE.md` as each lands.

### `relay` — Relay Hut (Adhal's signals post, Umm Zeitoun crest)

| item | number | source |
|---|---|---|
| footprint | **2 × 1 tiles, 6.0 × 3.0 m plan** — the two `#` tiles the map authors at (15,7)–(16,7); the dishes and the ladder may overhang the plan by 0.5 m, as the ramp camp overhangs by a quarter tile | `umm_zeitoun.json`, `umm_zeitoun_4.json` |
| height | **6.0 m** body (two storeys), mast to **10.0 m** — the one lever that separates it from `concrete` (3.6 × 5.3 × 9.0 m, no mast) at 64 px | `meshy-prompts-buildings.md` prompt 5; `ASSET_PROVENANCE.md` ramp table |
| remesh / cap | **8,000** / 20,000 | bible §3 building row; the ramp's `concrete` at 8,000 shipped 7,650 |
| textured | yes — `--tex 8k`, shipped at 2048 | lead's rule, 2 Oct |
| facing | **directional**: the steel door and the slit windows on the `+X` face only, the mast and both dishes on the `+X`/`+Z` corner so the silhouette reads from the camera; the ladder on `+Z` | `building_facing.py`, exporter step 2 |
| roles | `wall` (body), `roof`, `glass` (the `+X` openings, split by the luminance rule), `metal` (mast, dishes, ladder, if the remesh keeps them separable) | ramp rules |
| the mast risk | B0a measured that a remesh drops every thin whip; the camp lost its mast TIP at 10,000 while the Shachaf's mast survived at 5,000. The prompt asks for a lattice mast (a lattice has area a whip has not). If it comes back missing or as a stub, it is rebuilt in Blender as a kit `metal` cylinder at the numbers above and the dishes are `art/meshes/props/satellite_dish.glb` (180 tris, already shipped) parented to it — the bible's "a wrong preview is fixed in Blender", 0 credits | `meshy-prompts-ramp.md` outcome; prop table |
| nearest silhouette | `concrete` (IoU limit 0.88 at 64 px): the plan is 6 × 3 against 3.6 × 5.3 and the mast adds 4 m; `kdf_intel_centre` (held, palette, a dish on a box) is the other neighbour and is excluded from nothing — measure, do not assume | `validate_mesh_assets.py` |
| wreck | `collapse()`; the mast comes down with the roof band | ramp rules |
| wiring | **the only new-art item in this plan that touches a map.** Two options, the lead's call (Decisions, 1): (A) a new structure symbol — the next free letter against `TERRAIN_LEGEND` (`. 1 2 3 ^ b d n o r`) and the catalogue (`s h a w # = m c k f`), e.g. `y` — authored on the two `#` tiles of both Umm Zeitoun maps, so all four UZ missions stand the hut and `raze(crest_top)` snapshots it unchanged; (B) `structures[]` in `umm_zeitoun_4_clearance` only, with the two `#` tiles left as they are on UZ I–III. (A) is the shape the buildings doc's own rule prefers for a type several missions share off one map; (B) is the camp precedent. **Either way `data/structures.json` numbers copy `concrete`'s** (700 hp/tile, garrison 2, rubble 2, `roe_penalty` 3, `height_px` 20) so the raze and the playtest ladder do not move; `pnpm playtest` must stay byte-identical on `umm_zeitoun_4_clearance` | `validate_data.mjs:513` (mission-placed structures count for `raze`) |

Prompt (767 characters, under the CLI's 800):

```
A single low-poly game-ready small unmanned communications relay post, vernacular construction of a fictional arid river-basin region: a squat two-storey poured-concrete blockhouse with board-form marks, narrow slit windows and one heavy steel door on the front face, an external steel ladder to a flat roof with a low parapet, a tall steel lattice radio mast rising from the front corner of the roof carrying two small parabolic dishes and a conduit running down into the building. Real-world scale, 6 metres long, 3 metres deep, 6 metres tall, mast to 10 metres. Grey concrete, gunmetal steel, dust. Plain even lighting, no baked shadows, no ground, no base, no plinth, centred, one object, facing forward. No insignia, flags, patches, text or markings of any kind.
```

### `pump_house` — Pump House (the Rif forward store, Wadi Halam II)

| item | number | source |
|---|---|---|
| footprint | **2 × 2 tiles, 6.0 × 6.0 m** including the tank stand — the `size: [2,2]` shanty it replaces at [16,19] | `wadi_halam_2_laager.json:121` |
| height | **3.2 m** at the shed's eave, **3.8 m** at the high side of the single pitch; tank **2.8 m** to its crown on a 1.2 m stand. The shanty came back 6.9 m tall at a 9 m plan and had to be scaled by height to 4.2 — so the prompt here names the shed as "single-room, one storey, lower than it is long" and the exporter scales on HEIGHT (`size_axis: "z"`), the ramp's own lesson | `meshy-prompts-ramp.md` outcome |
| remesh / cap | **8,000** / 20,000 | bible §3; the shanty at 8,000 shipped 7,415 |
| textured | yes — `--tex 8k`, shipped at 2048 | lead's rule |
| facing | **directional**: plank door and one shuttered window on `+X`; the tank beside the shed on the `+Z` side so it is never hidden behind the roof from the camera | `building_facing.py` |
| roles | `wall`, `roof`, `glass` (door and window on `+X`), `metal` (tank, stand, pipework, if separable) | ramp rules |
| the tank risk | a cylinder on four legs is exactly the shape the remesh keeps (the shanty's and the concrete's rooftop tanks both survived at 8,000). If the stand merges into the wall it stays merged — at 25 px the tank is the tell, not its legs. `art/meshes/props/water_tank.glb` (220 tris) is the Blender fallback | ramp outcome; prop table |
| nearest silhouette | `shanty` (5.2 × 5.5 × 4.2 m, lean-to roof): the lever is the second mass — a tall cylinder beside a low shed — and the smaller shed. Then `kdf_workshop` / `militia_firing_position` (held). Measure | `validate_mesh_assets.py` |
| wreck | `collapse()`; the tank topples inside the plan (spill is clamped to the intact plan) | `render_building.collapse` |
| wiring | `data/structures.json` entry copying `shanty` (120 hp/tile, garrison 1, rubble 1, `roe_penalty` 2, `height_px` 11), **no symbol** — one mission, one marker, the camp precedent; `wadi_halam_2_laager.json:121` changes `"shanty"` to `"pump_house"`. `playtest` byte-identical on that mission is the gate that the numbers were copied right | `meshy-prompts-buildings.md` decision 3 |

Prompt (796 characters, under the CLI's 800):

```
A single low-poly game-ready small agricultural pump house, vernacular construction of a fictional arid river-basin region: a one-room single-storey breeze-block shed, lower than it is long, with a single-pitch corrugated metal roof weighted with stones, a plank door ajar and one shuttered window on the front face, beside the shed on its left a squat steel water tank on a steel stand, galvanised pipework from the tank into the shed wall, mineral scale streaking down from the overflow pipe. Real-world scale, 6 metres square, shed 3.5 metres tall, tank 2.8 metres. Grey block, rust-streaked corrugated metal, galvanised steel. Plain even lighting, no baked shadows, no ground, no base, no plinth, centred, one object, facing forward. No insignia, flags, patches, text or markings of any kind.
```

### Credits, from `pnpm meshy -- estimate` (run 2026-10-02, no API call)

```
estimate: text preview 20 credits + refine 15 credits = 35 credits (~$0.70 at $0.02/credit, https://docs.meshy.ai/en/api/pricing quoted 2026-09-18)
estimate: remesh 5 credits (~$0.10 at $0.02/credit, https://docs.meshy.ai/en/api/pricing quoted 2026-09-18)
```

| asset | calls | credits |
|---|---|---|
| `relay` | `text --refine --tex 8k` (35) + `remesh --polycount 8000` (5) | **40** |
| `pump_house` | same | **40** |
| two wrecks | `collapse()` in Blender | 0 |
| **planned** | | **80** (~$1.60) |

The pricing table is the CLI's own, quoted 2026-09-18; the ramp set's 260
estimated read 260 consumed, and the ledger's 1,610 estimated against 1,605
consumed over 135 tasks says the table has held.

---

## 2. Damage states (GH-31) and wreck variants

### What the renderer does today, measured in the source

- **Billboard path** (Pixi, `&nomesh`, and any type without a GLB):
  `structureAliveAlpha` darkens the sprite by `0.55 + 0.45 × integrity`;
  `grind.ts`'s `structureHpBand` cuts HP into eighths for the wear step and the
  overlay log.
- **Mesh path** (every shipped building on `three`, which is the default):
  `updateBuildingMeshes` consults `st.alive` and nothing else. A building at
  1 hp is pixel-identical to one at full HP until the tick it dies, when the
  idle clone is dropped, the `_wreck` clone stands up squashed and settles
  over `BUILDING_SETTLE_SECONDS`, and `beginCollapse` throws
  `structure_collapse` and the shroud. **GH-31's "buildings darken, which is
  the pattern to follow" describes the path nobody sees any more.**
- The one procedural precedent for a material state is the vehicle wreck's
  charring (`2026-09-14-vehicle-wreck-design.md` deviation 1): a palette mesh
  takes `rampMaterial(CHARRED_RAMP)` (`gunmetal` from index 1, lit face
  `#5C625F`); a textured mesh takes a clone of its loaded material with
  `color` set to `CHARRED_TINT_HEX` `0x6a5f55` and roughness 1, **memoised per
  distinct loaded material** (the Lavi's four meshes share one material; the
  first cut minted four clones). The lead chose that tint on a capture sheet
  ("a sooty dark grey that keeps the bakes' detail visible") after the
  near-black crushed 75.9% of a hull's pixels below luminance 8.

### The approach, every building, 0 credits

Three visible states on the living mesh plus the existing wreck, all
presentation on the frame clock, nothing read back by the sim, no new GLB:

| band (`structureHpBand`, eighths) | state | what changes | cost |
|---|---|---|---|
| 8–6 | clean | nothing — the template's own materials | 0 |
| 5–3 | scarred | the charring treatment at a FRACTION: `color` lerped from the material's own toward `CHARRED_TINT_HEX` by `(1 − integrity) × SCAR_MIX` (proposal: `SCAR_MIX` 0.6, so a building at band 3 sits 0.6 × 0.625 ≈ 0.38 of the way to the wreck tint), roughness lerped toward 1; palette types step their ramp index the same way. Stepped per BAND, not continuous: one memoised clone per (loaded material × band), so a type costs at most 5 extra materials for the whole map, not one per instance, and a frozen gate frame cannot drift | 0 |
| 2–1 | burning | the scarred treatment at full band plus ONE looping emitter, `data/vfx/structure_burning.json` (palette keys: `vfx.fire` / `vfx.ember` core, `dust`/`shadow` smoke) placed at the roof band's measured height from the template's own bounds — the way `CollapseShroudManager` sizes its cloud — and registered in `packages/data/src/index.ts`'s `vfxEmitters` (`index.test.ts` pins the directory against the array since the `catastrophic_kill` miss, so a file that ships unregistered is a red spec) | 0 |
| 0 | wreck | unchanged: the `_wreck` clone, the settle, the collapse FX; the burning emitter is handed to the wreck for `WRECK_BURN_SECONDS` (proposal 20 s) and then stops — a scorch decal is NOT available under the footprint because `stampGroundDecal` refuses a terrace centre (R-19) and every building tile is a terrace | 0 |

Two things that follow and are easy to get wrong. **Zero movement at full
HP by construction**: band 8 maps to the untouched template, so `quiet`,
`open-ground`, `vehicle`, `relief` and `aftermath` — none of which damages a
building before its capture tick — read 0 px, and no bless is expected; the
assertion is the PR's `visual` job, not this sentence. **`structureHit` is
the event to key on, not a per-frame HP scan**: `ThreeRenderer` already takes
`structureHit`/`structureDestroyed` to recompute one box (~:965), and
`cacheStructureAlpha` already records the on-screen integrity one frame
before death for `beginCollapse`; the band material swap hangs off the same
event and the same cache, so a kill from full health starts its fall clean
and a ground-down one starts charred — the divergence from Pixi that
`structureAliveAlpha`'s own comment argues for, kept.

**Vehicles.** GH-31's first acceptance line names vehicles ("sprite swap or
tint by damage band"). Out of A3.2's scope (buildings), but the band clone
above is the same `charredFor` table `mesh-vehicle.ts` already memoises, so
the vehicle half is the same change in a second file and costs 0 credits; it
is listed in the order of work as a follow-up, not folded in.

**Heat shimmer** (`ART_PIPELINE.md` §5 item 7): `heat_shimmer` is a schema
field read by nothing (CLAUDE.md, VFX bullet) and unblocked in three alone.
Not in this plan; the burning emitter is authored so a shimmer pass can be
attached to the same emitter later without re-placing it.

### Legibility is measured, not asserted

GH-31's third line is "legible at gameplay zoom without reading the bar". The
instrument: a capture sheet on `?sandbox=beit_sahwan_outskirts` at zoom 1.0 and
2.5, one row per band for `house` (textured), `concrete` (textured, ramp),
`kdf_outpost` (palette, held) — and the lead judges it, as the wreck tint was
judged. **It needs a dev hook that does not exist**: `Sim.debugDestroyStructure`
is public, `damageStructure` is private; a `debugDamageStructure(id, fraction)`
beside the former is one sim method, invariant-clean (it writes `hp` through
the same path a hit does), and lands with the sheet. A fallback for the gate
side: the burning emitter is the one layer no gated scenario can witness (the
same shape as `blast-light`), so it gets a `blast:capture`-style toggle reading
on the sheet rather than a `layerChecks` entry.

### Wreck variants: what exists, and the one art call

Every type that draws has its `_wreck`, four ways: the supplied destroyed
passes (`house`, `apartment`, `warehouse`, `clinic`, `hall`), `collapse()` on a
textured remesh (the ramp four, the two militia textured works), `collapse()`
on kit geometry (`fence`, the KDF works), and the two new types above take the
second route. **The hall wreck is the audit's open art call**: 20,992 tris and
3.8 MB raw (945 KB Draco) against the bible's 20,000 building cap, because the
supplied destroyed pass is thousands of small debris islands and five
decimation routes all floored at ~47k polys (`export_meshy_hall.py`); lighter
means deleting islands below a face count, which decides how much rubble
stays. Options for the lead (Decisions, 4): keep as shipped; or cut islands
under N faces to the cap, 0 credits, one Blender run, one capture.

### Where procedural cannot read — and why no Meshy is planned for it

The honest limit of the approach above is STRUCTURAL damage: a corner gone, a
roof holed, a wall breached, with the room behind it. The material treatment
cannot show that and `collapse()` only produces the end state. Three routes
were considered against the brief's "give per-building Meshy only where
procedural cannot read":

1. **Meshy text-to-3D of "a damaged X"** — returns a different building, not
   the shipped one damaged (every run on this pipeline honoured the silhouette
   and nothing finer: bible §8). Not a damage state of anything the player has
   seen standing. **0 planned.**
2. **Meshy image-to-3D from a render of the shipped model** — the same
   objection, plus the bake would not match the standing model's. **0.**
3. **A third GLB per type, `<type>_damaged.glb`, by `collapse()` at a
   milder setting** (a `COLLAPSE_CHUNK` / crush fraction that breaks the roof
   band and one wall and leaves the rest standing) — 0 credits, the same
   exporters, UV-preserving, honest to the standing model. Costs a GLB per
   type (~1–2 MB raw, ~300 KB Draco each, roster-driven so only fielded types
   download), a third `BUILDING_MESHES` slot, a third clone path in
   `updateBuildingMeshes`, and a crossfade at the band edge. This is the one
   route that can read, and it is **held back as option B** behind the
   material route, to be taken only where the lead judges the capture sheet
   unreadable — because it doubles the building download for a state the
   player sees for a few seconds per building, and the vehicle wreck design
   (D1) already ruled "structural damage is a later per-vehicle art pass".

So the Meshy credit estimate for damage states is **0**, and that is a finding
rather than a saving: nothing Meshy can generate is a damage state of a model
it did not make.

---

## 3. The licensing pass — repository facts, not guesses

| asset | status at `2b539784` (where it is recorded) | what replaces it | credits |
|---|---|---|---|
| `TNK_HULL`, `TNK_TURR` (Tiger-derived) | **retired 2026-09-25**, commit `30050389` "re-render TNK_* and JEEP_HULL from the units' own meshes": every frame re-rendered from `art/meshes/vehicles/mbt_lavi.glb` by `tools/render_vehicle_glb.py`, same sheet format, `realMetres` 6.32 kept; `render_tiger.py`/`render_tank.py` gone from HEAD. Manifest credit, read from the bytes: "Original work for Roaring Lions: rendered from art/meshes/vehicles/mbt_lavi.glb, AI-generated with Meshy (commercial plan) and reworked in Blender; see docs/ASSET_PROVENANCE.md". The old frames stay in history before that date — the lead's call, recorded under "History is kept" | nothing — done | 0 |
| `JEEP_HULL` (downloaded model, no licence) | **re-rendered the same day** from `art/meshes/vehicles/jeep_shoded.glb` (a supplied Meshy asset, "The supplied Meshy assets" table), `realMetres` 4.8; `art/src/jeep_shoded.blend` and `render_jeep.py` gone from HEAD; manifest credit as above, naming the jeep GLB. G0 #2 (18 Sep) said "retired with the sprite sheets in WP-A3.3" — overtaken: it is **verified**, and the sheet can stay until A3.3 retires sheets as a class | nothing — verified | 0 |
| `art/src/soldier_kolos.fbx` (Synty POLYGON texture path) | **deleted** (`38ea4a20` / `30b069c0`, "kit.py never read it"); never shipped — no sprite, mesh or build step read it; `CONTRIBUTING.md:30` names Synty as the example of what cannot be committed | nothing — done | 0 |
| `NAMER_HULL`, `NAMER_TURR` (Mutte, CC BY 3.0, BlendSwap #75225) | kept, the project's one permanent attribution: `credits-data.ts` carries title, author, licence URI, source URI and a modified-work line, pinned by `credits-data.test.ts` against `art/src/ifv_dmm08_LICENSE.html`. **Still live after B8 v2**: `ifv_namer.glb` is a Meshy Namer now (`1175fdef`), but the sprite sheet is still rendered from the Mutte model, so the credit stays until the sheet is re-rendered from the Meshy GLB (the TNK route) — a natural A3.3 line, and it would retire the attribution with it | optional: re-render `NAMER_*` from `ifv_namer.glb` (0 credits, the `render_vehicle_glb.py` route) | 0 |
| the Meshy commercial tier | `ASSET_PROVENANCE.md` "Commercial rights": "Confirmed by the project lead on 2026-08-30: the Meshy plan used permits commercial use" — recorded as his word, **unverified by anything in the repository**, and the doc itself asks for "one direct read of the plan's own terms before a paid release, since commercial use and redistribution as part of a shipped binary are occasionally separated". The CLI prices on an ASSUMED Pro plan ($20/1,000, `pricing.ts`, "stated as an estimate"); the ledger has 1,605 credits consumed over 135 tasks. The credits screen discloses Meshy as a class (`CREDITS.aiDisclosure`) and declares art "all rights reserved" | **lead action, docs only**: read the plan's terms once, then record in "Commercial rights" the plan NAME, the date read, and the two answers (commercial use; redistribution in a shipped binary). Nothing in this tree can do it for him | 0 |
| mesh provenance | every Meshy mesh since September has its task ids in `ASSET_PROVENANCE.md` and its prompt in `art/meshy/ledger.jsonl`; the doc's outstanding item 1 (a `credit` record per GLB, gated by `validate_mesh_assets.py` as `validate_audio.py` gates clips) is still open. Not in A3.2's file boundary beyond the doc | recorded, not done here | 0 |

**Credits screen**: no line changes. `codeLicence` = PolyForm Noncommercial
1.0.0, `artLicence` = all rights reserved, the Namer credit, the AI
disclosure — all current.

---

## 4. Budget and order of work

| item | credits planned | cap |
|---|---|---|
| §3 licensing pass | 0 | 0 |
| §2 damage states (code) + hall wreck call (Blender) | 0 | 0 |
| §1 `relay` | 40 | 80 |
| §1 `pump_house` | 40 | 80 |
| **total** | **80** (~$1.60) | **160** (~$3.20) |

The cap is one re-roll per building and nothing else, spent only on the
lead's own go after the first preview is shown — never speculatively (bible
§4). Against the plan's last two batches (B8 120 approved / 120 spent, the
ramp 295 / 260) this is the cheapest stream in the package.

**Order**, chosen so the two things that move no gate land before the one
that spends:

1. **Licensing pass** (docs only). `ASSET_PROVENANCE.md` gets a dated
   "A3.2 licensing pass" section carrying the §3 table; the lead's tier
   reading is a one-line edit to "Commercial rights" when it is done. No
   gate moves.
2. **Damage states** (one plan, ~6 tasks: the band-material table and its
   memo, the `structureHit` wiring, `debugDamageStructure`, the burning
   emitter and its registration, the capture sheet, the lead's capture gate).
   `pnpm test`, `typecheck`, `lint`; `visual` expected at 0 px on every gated
   scenario, confirmed by CI not by this plan. The hall wreck call rides
   with it if the lead takes option 4b.
3. **`relay` and `pump_house`** (the spend, after the go): `estimate` → one
   `text --refine --tex 8k` each → `remesh` → the two `RampSpec` rows →
   `pnpm encode:meshes` → `validate:meshes` (facing, IoU), `validate:assets`,
   `validate:data`, `test`, `typecheck`, `lint`, `playtest` byte-identical on
   `umm_zeitoun_4_clearance` and `wadi_halam_2_laager` → provenance with
   both task ids → captures on `?sandbox=umm_zeitoun` and
   `?sandbox=wadi_halam_basin`, music off, zoom 2.5 and 1.0, each beside the
   `concrete`/`shanty` it replaces → PR with the AI-art disclosure. Neither
   map is a gated scenario, so no bless is expected.
4. **Follow-ups named, not scheduled**: the vehicle half of GH-31 (same
   table, second file); heat shimmer on the burning emitter; `NAMER_*`
   re-rendered from the Meshy Namer, retiring the attribution; the mesh
   provenance gate (provenance item 1).

---

## Decisions for the lead

1. **Where the relay stands.** (A) a new map symbol on the two `#` tiles of
   `umm_zeitoun` and `umm_zeitoun_4`, so all four Umm Zeitoun missions show the
   hut — recommended; or (B) `structures[]` in UZ IV alone, the camp precedent,
   leaving a `concrete` block on the crest in UZ I–III.
2. **The lead's own prompt review.** Both prompts are max-detail per the 2 Oct
   rule and under 800 characters; the relay asks for a LATTICE mast because a
   whip does not survive a remesh. Approve, or amend, before the estimate
   becomes a call.
3. **Damage states: material route first (A), geometry route (B) only if the
   sheet is unreadable** — recommended. The alternative is to build B now for
   every type (22 more GLBs, 0 credits, roughly double the building download).
4. **The hall wreck**: (a) keep at 20,992 tris / 945 KB Draco as shipped;
   (b) cut debris islands below a face count to the 20,000 cap, one Blender
   run and one capture for you to judge.
5. **The Meshy tier**: one direct read of the plan's terms, and the plan name
   and date go into `ASSET_PROVENANCE.md`. Nothing here can do it; the
   provenance record stays "the lead's word" until it is done.
6. **Budget**: 80 planned, 160 cap. A re-roll is a stop and a report, as on
   every batch before it.
