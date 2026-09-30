# Meshy prompts — the A3.2 ramp set and the tunnel visuals

**WP-A3.2 (GH-185) + GH-227 · numbers table, written before any spend · 2026-09-30**

The lead's go (GH-185, 30 Sep): *"A3.2 ramp set approved for Meshy now (4 buildings +
4 vehicles textured, ~280 planned) with the tunnel visuals #227 (~50). Numbers table
first, then the calls."* The cap handed to this stream is **295 credits**. Same form as
`meshy-prompts-units.md` and `meshy-prompts-buildings.md`; the process is the style
bible's §4, one preview per concept, no re-roll without the lead's own go.

## The set, identified

GH-185 names the four ramp buildings **`concrete`, `shanty`, `wall`, `camp`** and the
four ramp vehicles **`apc_eitan`, `dozer_d9`, `apc_kipod`, `scout_shachaf`**. Two of
the vehicles are already done on `art/b0a-meshy` and are **skipped here**:

- `apc_kipod` — the brief says so (commit `67395cf0`, 35 credits, spent).
- `apc_eitan` — the same branch (commit `123996c2`, GH-286 B0a, 35 credits, spent).
  The brief counts "three remaining ramp vehicles"; the Eitan is the third and it is
  the one the Kipod was judged against, so generating a second Eitan would be a
  duplicate spend against a file the lead has already approved. Not spent.

So the stream is **four buildings, two vehicles, two tunnel props**, plus three
Blender-only pieces (spoil heap, two collapsed variants) and four Blender-only
building wrecks.

**What ships today, measured off the GLB bytes (2026-09-30, `art/meshes/`):**

| asset | tris | materials | bounds x × z (m) × tall | source |
|---|---|---|---|---|
| `buildings/concrete` (+ `_wreck` 3,118) | 720 | 0 | 7.03 × 6.93 × 8.98 | kit, `author_concrete.py`, palette |
| `buildings/shanty` (+ `_wreck` 1,220) | 460 | 0 | 8.93 × 7.10 × 3.05 | kit, `author_shanty.py`, palette |
| `buildings/wall` (+ `_wreck` 1,046) | 24 | 0 | 3.24 × 3.24 × 1.75 | kit, `author_wall.py`, palette |
| `buildings/camp` (+ `_wreck` 4,410) | 5,241 | 0 | 14.77 × 15.00 × 6.01 | supplied Meshy part-segmentation, palette (`export_meshy_camp.py`) |
| `vehicles/dozer_d9` | 3,610 | 0 | 6.83 × 3.29 × 3.44 | supplied Meshy part-segmentation, palette (`export_meshy_d9.py`) |
| `vehicles/scout_shachaf` | 248 | 0 | 4.60 × 2.08 × 2.87 | kit, `author_scout_shachaf.py`, palette |

**Tunnel visuals (GH-227): there are no mesh pieces for the renderer to read today.**
`packages/render/src/three/trail-mesh.ts` draws a route as tinted tiles and
`ThreeRenderer.onTunnelCollapsed` throws the `tunnel_collapse` VFX; nothing loads a
mouth, a vent or a spoil heap, so there are no node names to keep. The pieces below
are therefore NEW prop kinds (`art/meshes/props/`, the closed prop contract), and a
small render-side module places them from the sim's own reads — `tunnelPointAt(r, 0)`
for the mouth, `tunnelVent(r)` for the vent, `tunnelPointAt(r, tnProgress[r])` for the
dig head — gated on the SAME rule the trail uses (`collapsedRouteLevel` over
`tunnelContactLevel(0, r)`): nothing draws for a route the player's side has not
identified, and a collapsed route keeps only its residual. No sim or data change.

## Credits against the cap

| asset | class | calls | credits |
|---|---|---|---|
| `concrete` | textured building | `text --refine --tex 2k` (30) + `remesh` (5) | 35 |
| `shanty` | textured building | same | 35 |
| `wall` | textured building | same | 35 |
| `camp` | textured building | same | 35 |
| `dozer_d9` | textured vehicle | same | 35 |
| `scout_shachaf` | textured vehicle | same | 35 |
| `tunnel_mouth` | palette prop | `text` (20) + `remesh` (5) | 25 |
| `tunnel_vent` | palette prop | same | 25 |
| `spoil_heap`, `tunnel_mouth_collapsed`, `tunnel_vent_collapsed` | palette props, Blender from the two above | — | 0 |
| four building wrecks | `render_building.collapse()` on the textured mesh, as the kit does | — | 0 |
| **planned** | | | **260** |
| cap | | | 295 |
| unspent | the Eitan's 35, already spent on `art/b0a-meshy` | | 35 |

The 35 left is **not** a re-roll allowance. A re-roll or any extra call is a stop and
a report; the lead approves those separately.

One thing measured on B0a that changes how the calls read: the CLI has no standalone
`refine <preview-id>`, so a textured asset runs `text --refine` as ONE call (30) and the
preview cannot be judged before the refine spends. The remesh (5) is the step that can
still be withheld.

## Buildings — the shared rules

- Facade toward `+X`/`+Z` (`building_facing.py`); the openings on that half are split
  into a `glass` role from the bake (dark-opening sampling at UV centroids, the
  `export_meshy_warehouse.py` luminance signal), so the gate can JUDGE the front rather
  than name the type unchecked. `wall` and `camp` are glazed nowhere and read
  `symmetric`, like the shipped `warehouse`.
- Origin at the footprint anchor, ground at z = 0, real metres (a tile is 3 m).
- Texture: 2048 base colour JPEG q85 through `tools/buildings/textured.py`, normal and
  metallic-roughness kept at the same ceiling ("dont drop resolution").
- The wreck is `render_building.py`'s own `collapse()` (dice, punch, crush, spill)
  applied to the textured mesh — the same seed-free maths every kit wreck uses, and it
  keeps the UVs, so the rubble carries the photograph. No second generation.
- Lists: `TEXTURED_BUILDING_TYPES` + `TEXTURED_BUILDING_EXEMPT` gain all four (pinned
  by `textured-building.test.ts`); `render_building.py`'s `mesh_owner` for `concrete`,
  `shanty`, `wall` names the new exporter so `export_mesh_building.py -- all` cannot
  regenerate the kit pair over them; `camp` already names `export_meshy_camp.py` and
  moves to the new one.
- Roles: the bake carries the look; the mesh ships `wall` (body), `roof`, `glass` where
  there is a front, `metal` for fittings the remesh keeps separable. Fewer honest roles
  rather than invented boundaries (the house's own precedent).

### `concrete` — Concrete Structure (2 tiles, the tall narrow block)

| item | number | source |
|---|---|---|
| footprint / height | **6.9 × 6.9 m, 9.0 m tall** — three storeys; the kit's 7.03 × 6.93 × 8.98 kept so no map placement changes | GLB bytes |
| remesh / cap | **8,000** / 20,000 | bible §3 (building row) |
| textured | yes, 2048 | above |
| front | steel door and slit windows on the `+X` face, an external stair on `+Z`; `glass` split so the gate reads directional | `building_facing.py` |
| nearest silhouette | `apartment` (5 tiles, 30 px tall) and `house`; the lever is the plan — one narrow tower against a wide block. Kit read ~0.85 against its nearest before the textured neighbours arrived; the shape is kept | `author_concrete.py` |
| wreck | `collapse()`; standing stubs keep the tower's plan | `render_building.py` |

```
A single low-poly game-ready three-storey poured-concrete blockhouse, vernacular construction of a fictional arid river-basin region: bare grey poured concrete with board-form marks, narrow horizontal slit windows on every storey, a heavy steel door at ground level on the front face, an external concrete stair on one side, a flat roof with a low parapet, a rooftop water tank on steel legs, rebar stubs at the parapet corners, dust and weathering streaks. Real-world scale, 7 metres square and 9 metres tall. Grey concrete, gunmetal steel, dust. Plain even lighting, no baked shadows, no ground, no base, no plinth, centred, one object, facing forward. No insignia, flags, patches, text or markings of any kind.
```

### `shanty` — Breeze-block Shed (3 tiles, the low shed)

| item | number | source |
|---|---|---|
| footprint / height | **9.0 × 7.0 m, 3.2 m eave, 3.8 m at the ridge** — the kit's 8.93 × 7.10 × 3.05 with a shed-roof rise | GLB bytes |
| remesh / cap | **8,000** / 20,000 | bible §3 |
| textured | yes, 2048 | |
| front | a plank door and one shuttered window on `+X`; `glass` split | |
| nearest silhouette | `warehouse` (4 tiles, 22 px) — the lever is the SINGLE-pitch lean-to roof and the smaller plan against the warehouse's gable; `fence`/`wall` are far lower | `building_facing.py` table |
| wreck | `collapse()` | |

```
A single low-poly game-ready small single-room breeze-block shed, vernacular construction of a fictional arid river-basin region: unrendered grey breeze-block walls with mismatched patches of faded paint, a single-pitch corrugated metal roof sloping down toward the back, weighted with a few stones, a plank door standing ajar and one small shuttered window on the front face, a low rooftop water tank, a stack of crates against one side wall, dust and weathering. Real-world scale, 9 metres long, 7 metres deep, 3.5 metres tall. Grey block, rust-streaked corrugated metal, sun-bleached timber. Plain even lighting, no baked shadows, no ground, no base, no plinth, centred, one object, facing forward. No insignia, flags, patches, text or markings of any kind.
```

### `wall` — Compound Wall (1 tile, per-tile run)

| item | number | source |
|---|---|---|
| segment | **3.0 m long along `+X`, 0.5 m thick, 1.75 m high**, a 0.6 m square pier at each end rising to 1.95 m — the piers close a corner where two runs meet, which is the gap the kit's square-plan wall avoided and the fence accepts (`run-direction.ts`) | `author_wall.py`, `run-direction.ts` |
| remesh / cap | **3,000** / 20,000 — instanced on every tile of every run, so kept small | |
| textured | yes, 2048 (one template, cloned per tile) | |
| front | none — symmetric, no `glass`; the gate prints its ratio | `building_facing.py` |
| nearest silhouette | `fence` (the other per-tile type): the lever is mass — a solid rendered wall against a see-through wire panel; `wall_wreck` vs `fence_wreck` likewise | |
| wreck | `collapse()`; a breached run keeps stubs and a rubble apron inside its own tile | |

```
A single low-poly game-ready one segment of a rendered masonry compound wall, vernacular construction of a fictional arid river-basin region: a straight solid wall of sun-bleached limestone-coloured rendered masonry with a square pier at each end slightly taller than the wall, a plain flat coping course along the top, patches where the render has fallen away showing block beneath, dust staining at the base. Real-world scale, 3 metres long, half a metre thick, 1.75 metres tall, flat unornamented ends so it butts against an identical copy. Limestone render, dust. Plain even lighting, no baked shadows, no ground, no base, no plinth, centred, one object, facing forward. No insignia, flags, patches, text or markings of any kind.
```

### `camp` — Field Camp (placed 2 × 2 by every mission, `produces_for` KDF)

| item | number | source |
|---|---|---|
| footprint | **6 × 6 m placement, the ring allowed to 7.5 m across** (a quarter tile of apron). The shipped GLB is cut to 15 m because `export_meshy_camp.py` assumed a 5 × 5 footprint; every one of the six missions that place it uses `size: [2, 2]`, so it overhangs each placement by 1.5 tiles a side. The new one fits its tile | six `data/missions/*.json`, `export_meshy_camp.py` |
| height | 3.6 m at the tent ridge, sandbag ring 1.4 m, mast to ~6 m | |
| remesh / cap | **10,000** / 20,000 — a compound is many small objects | |
| textured | yes, 2048 | |
| front | none — a ring; `symmetric`, no `glass` | |
| nearest silhouette | `hall`/`clinic` (square plans) and its own `camp_wreck`; the lever is the low ring with a tall thin mast | |
| wreck | `collapse()` at a shallower crush (a sandbag ring does not fall far); the mast down | |
| colour | KDF olive is in the bake; the palette `olive.1` wall colour of the kit path no longer applies | |

```
A single low-poly game-ready small military field camp compound, a machine of a fictional army in plain matte olive-drab paint with dark gunmetal fittings, clean and military: a square ring of stacked sandbags and wire-mesh earth-filled barriers, one olive canvas command tent in the middle, a thin steel radio mast with a small dish at one corner, a small generator and a few jerry cans and crates inside the ring, one gap in the ring as the entrance on the front side. Real-world scale, 7 metres square, tent 3.5 metres tall, mast 6 metres. Olive canvas, tan sandbags, gunmetal. Plain even lighting, no baked shadows, no ground, no base, no plinth, centred, one object, facing forward. No insignia, flags, patches, text or markings of any kind.
```

## Vehicles — the shared rules

Contract v2 through a spec-driven exporter modelled on `art/b0a-meshy`'s
`tools/vehicles/export_meshy_apc.py` (not copied into this branch — that file lands
with B0a; this stream's `tools/vehicles/export_meshy_ramp.py` carries the same method
for its own two specs, so the two branches add different files and merge cleanly):
ledger's last remesh named for the unit → base-colour rename → `hull_rubber` split
(tyres by axle disc; tracks by a z-band) → nose `+X` measured → scale the longest axis
to the sprite manifest's `realMetres` (read, never typed) → ground at z = 0 → textures
at 2048 → export → `pnpm wreck:meshes -- --id=<unit>`. `mesh_owner` in
`export_mesh_vehicle.py` names the new script for both. Both join
`TEXTURED_VEHICLE_TYPES` + `TEXTURED_VEHICLE_EXEMPT` (pinned). Selection rings in
`readability.ts` re-measured from the export.

### `dozer_d9` — D9 Dov (KDF, tracked, unarmed)

| item | number | source |
|---|---|---|
| real size | **6.832 m** over the blade — `D9_HULL/manifest.json` `realMetres`, read at export | manifest |
| size class | `heavy_vehicle`, ×1.0 | `dimetric.py` |
| remesh / cap | **8,000** / 10,000 | bible §3 (heavy row, as the Eitan) |
| textured | yes | |
| pivots | **none** — unarmed; `turret_prefixes=()` today and no RWS. `wreck-recipes.ts` keeps `tracked` | `export_mesh_vehicle.py` |
| roles | `hull_hull`, `hull_rubber` (tracks, split by the lowest z-band under the belly line), `hull_metal` if the blade separates by geometry; else the blade stays hull | |
| the silhouette levers | `author_d9.py`'s four, kept in the prompt: blade clear of the tracks on push arms, tall set-back cab, exhaust stack breaking the roofline, ripper tine behind | `author_d9.py` |
| nearest silhouette | `mbt_lavi` (tracked, 6.32 m) and `ifv_namer` — the shipped D9 reads 0.724 against `apc_kipod`; the blade and stack keep it under 0.88 | B0a numbers |
| death | `pnpm wreck:meshes -- --id=dozer_d9` after export (the current file's `death_root` is regenerated) | |

```
A single low-poly game-ready armoured tracked bulldozer, a machine of a fictional army in plain matte olive-drab paint with dark gunmetal fittings, clean and military. At rest, level. A full-width steel dozer blade held clear of the tracks on two push arms at the front, a tall armoured cab with small slit windows set back over the rear third, a tall vertical exhaust stack beside the cab, and a single ripper tine projecting behind. Real-world scale, 6.8 metres long over the blade. Olive paint, gunmetal, dark track rubber. Plain even lighting, no baked shadows, no ground, no base, no plinth, centred, one object, facing forward. No insignia, flags, patches, text or markings of any kind.
```

### `scout_shachaf` — Shachaf Scout Car (KDF, wheeled 4 × 4, cupola MG, mast)

| item | number | source |
|---|---|---|
| real size | **4.6 m** — `SHACHAF_HULL/manifest.json` | manifest |
| size class | `light_vehicle`, ×1.0 | |
| remesh / cap | **5,000** / 8,000 | bible §3 (light row) |
| textured | yes | |
| pivots | **`turret_pivot`** on a small roof ring, carrying `kit.rws` at a reduced size (0.55, 0.45, 0.30 m, 0.7 m barrel) for the `cupola_mg` — the kit build had no pivot; `wreck-recipes.ts` gains `turretPivot` | unit data (`cupola_mg`, `hmg`) |
| the mast | the unit's whole tell (sight 16): a 1.05 m mast on the cab roof. Asked for in the prompt as a folded-down-looking thin mast; if the remesh drops it (it drops every whip — B0a), it is rebuilt in Blender as a kit `metal` cylinder at the same numbers as `author_scout_shachaf.py` | `author_scout_shachaf.py` |
| nearest silhouette | `jeep_shoded` (4.8 m, 4 wheels) and `technical` — the levers are the raised rear observation cab and the mast; the kit car reads 0.97 ring, ellipse 1.07 × 0.65 | `readability.ts` |
| death | `pnpm wreck:meshes -- --id=scout_shachaf` | |

```
A single low-poly game-ready light four-wheeled armoured scout car, a machine of a fictional army in plain matte olive-drab paint with dark gunmetal fittings, clean and military. At rest, level. Two axles with four large wheels, a low sleek sloped nose, a raised observation cab over the rear half with small vision blocks, a tall thin sensor mast standing up from the cab roof, and a small empty round mounting ring on the cab roof with no weapon fitted. Real-world scale, 4.6 metres long. Olive paint, gunmetal, black tyres. Plain even lighting, no baked shadows, no ground, no base, no plinth, centred, one object, facing forward. No insignia, flags, patches, text or markings of any kind.
```

## Tunnel props (GH-227) — palette, prop contract

New prop kinds in `PROP_KINDS`/`PROP_TRI_CAPS` (`prop-role.ts`, pinned against
`validate_mesh_assets.py`) and `PROP_MESHES`; roles from the closed prop set —
`rust` (the `dust` ramp from index 5: turned earth), `concrete` (sandbags),
`metal` (corrugated lining, hatch). Zero materials. Placed by a new
`packages/render/src/three/tunnel-props.ts` from the sim reads named above, refreshed on
the trail's own `fogTick` cadence. Sized against the 1.8 m figure.

| kind | what | size | remesh / cap | credits |
|---|---|---|---|---|
| `tunnel_mouth` | a sandbag-revetted shaft head in the ground with a corrugated-sheet lining and a timber frame, dirt apron | 2.4 m across, 0.9 m tall | 400 / 400 | 25 |
| `tunnel_vent` | a short corrugated pipe stub with an open steel hatch and a ring of turned earth | 1.2 m across, 0.8 m tall | 200 / 200 | 25 |
| `spoil_heap` | a low heap of freshly turned earth — Blender, `rust` only | 1.6 m across, 0.5 m tall | — / 150 | 0 |
| `tunnel_mouth_collapsed` | the mouth's frame broken, the shaft filled, sandbags slumped — Blender from the mouth remesh | — | — / 400 | 0 |
| `tunnel_vent_collapsed` | the pipe bent over and the ring caved — Blender from the vent remesh | — | — / 200 | 0 |

```
A single low-poly game-ready tunnel entrance dug into flat ground: a square shaft opening framed with rough timber beams and lined with corrugated metal sheet, a low ring of stacked sandbags around three sides, a spread of loose excavated earth around it. Real-world scale, 2.4 metres across, under one metre tall. Tan sandbags, rust-streaked corrugated metal, brown earth, grey timber. Plain even lighting, no baked shadows, no ground, no base, no plinth, centred, one object, facing forward. No insignia, flags, patches, text or markings of any kind.
```

```
A single low-poly game-ready tunnel air vent on flat ground: a short vertical corrugated metal pipe stub with a hinged steel hatch lid propped open, a ring of loose turned earth around its base. Real-world scale, 1.2 metres across, under one metre tall. Rust-streaked corrugated metal, brown earth. Plain even lighting, no baked shadows, no ground, no base, no plinth, centred, one object, facing forward. No insignia, flags, patches, text or markings of any kind.
```

## Order and gates

Buildings first (`concrete`, `shanty`, `wall`, `camp`), then the two vehicles, then
the tunnel pieces. Per asset: `estimate` → ONE `text` (with `--refine --tex 2k` where
the class ships a bake) → `remesh` at the target → Blender fit → export →
`pnpm encode:meshes` → `pnpm validate:meshes`, `pnpm validate:assets`, `pnpm test`,
`pnpm typecheck`, `pnpm lint` → lists → provenance with both task ids → commit → push.
Captures: `?sandbox=beit_sahwan_outskirts` (buildings, vehicles) and
`?sandbox=tel_marum&tunnel` (tunnel pieces), music off, zoom 2.5 and 1.0, each beside
the `origin/main` file it replaces.

## Disclosure

Everything generated here is AI-generated art (Meshy), disclosed per `CONTRIBUTING.md`;
task ids go to `docs/ASSET_PROVENANCE.md` per asset as it lands.
