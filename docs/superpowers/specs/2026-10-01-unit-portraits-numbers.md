# Unit portraits: the rig numbers (GH-153, G1 item 6)

**Status: PROPOSAL. Nothing has been rendered.** The lead approves art numbers
before a render (G1 #165, item 6). This page holds the numbers and nothing
else. Once they are approved, the pass is one Blender script and one manifest
`--check`. A row the lead changes is changed here first.

## What the portraits replace, and where they are drawn

Today a unit's picture is `tools/crop_unit_icons.py` cropping one frame of its
directional sprite sheet (`PORTRAIT_FACING` 3, `packages/app/src/ui/portrait.ts`)
into a 128×128 icon. Three faults show at chip size:

- the sheets predate the meshes, so the icon and the unit on the map are
  different models;
- facing 3 is a different view per sheet, because the sheets were authored
  facing different ways (`TNK_HULL` reads head-on, `NAMER_HULL` and
  `DRONE_RECON` read three-quarter);
- the sheets are lit by the rig's back-lit lamp (`lighting.ts`, retired
  alternative 1), so every icon has a bright top over two dark sides.

Since #323 the garage draws a 3D turntable, so it no longer needs a portrait.
The portraits are for the three icon sites only. Each size below is CSS px at
`--ui-scale` 1, read from `theme.css`.

| Site | Element | Drawn at | Worst case (UI scale 1.15, DPR 2) |
|---|---|---|---|
| HUD selection chip | `.rl-chip__art` | 40 px | 92 px |
| HUD unit card | `.rl-card__art` | 68 px | 156 px |
| Reinforcements dock tile | `.rl-tile__art` | 56 px | 129 px |
| Brigade roster row | `brigade.ts`, through `unitIcon` | the chip's 40 px | 92 px |

## The roster: 17 KDF types, all from shipped GLBs

The source is `art/meshes/`, the same bytes the map and the garage draw.
`attack_drone` and `recon_drone` now ship in `art/meshes/vehicles/` and need
no sprite fallback.

- **Figures (7):** `inf_squad`, `at_team`, `mortar_team`, `sniper_team`,
  `demo_squad`, `breach_team`, `yahalom_squad`. The separate
  `yahalom_engineer` GLB gets no portrait of its own.
- **Ground vehicles (7):** `mbt_lavi`, `ifv_namer`, `apc_eitan`, `apc_kipod`,
  `jeep_shoded`, `scout_shachaf`, `dozer_d9`.
- **Air (3):** `heli_peten`, `attack_drone`, `recon_drone`.

## The numbers

| # | Parameter | Proposed | Why |
|---|---|---|---|
| 1 | **Facing** | Three-quarter front, nose toward **screen-left**, the unit's forward turned **35°** off the camera axis. One facing for the whole roster. | Screen-left is the sun's side (`lighting.ts`: azimuth 135° is the camera's left), so the lit face is the front. 35° shows a vehicle's length and a figure's face. Head-on (0°) flattens a hull into a rectangle. 90° hides the face and the weapon. |
| 2 | **Pose** | Figures: the `idle` clip at frame 0. Vehicles: the `idle` clip (live body, wreck hidden), turret and gun at rest along the hull, rotors still. | This is what the unit is when it is standing in the dock. A firing pose would put a muzzle across the next tile. |
| 3 | **Team or lead figure** | The **whole team** as the GLB lays it out (for example 3 figures for `inf_squad`). | The team's composition is what identifies its type at 40 px: the tube in `mortar_team`, the launcher in `at_team`. **Alternative for the lead:** the lead figure only, which is larger in the chip but loses the composition. |
| 4 | **Camera** | Perspective, vertical FOV **30°**. Elevation **12°** for figures and **18°** for vehicles and air. Aimed at the centre of the posed model's bounding box. | These are the garage turntable's approved numbers (`garage-frame.ts`, 1 Oct). One register: the portrait matches what the garage shows, frozen at one yaw. |
| 5 | **Framing** | Fit the posed model's projected silhouette to **88%** of the square on its longer axis, centred on the silhouette's own box. Each unit is scaled to fill its frame, with **no shared scale** across the roster. | A chip identifies a type. It does not compare sizes; the garage does that. A shared scale draws a drone as a 6 px speck. 88% leaves room for the kit stars in the top-right corner (`.rl-kit-icon`). |
| 6 | **Materials** | Exactly what the game draws: a role's `liftTone(ramp)` as a flat albedo with roughness 0.85 and metalness 0 (`world-materials.ts`); `uniform` and `webbing` take the **KDF** faction slice. A Meshy-baked mesh keeps its own bake. | The portrait must show the unit that is on the map. Do NOT port `render_team.py`'s `ROLE_PALETTE` or `LIT_GAIN`. They compensated for a multiply-style light that this rig does not have. |
| 7 | **Key light** | Sun lamp, **3.2**, colour `limestone.0`. **40°** off the camera axis on the screen-left (sun) side, **50°** up. Angle 1.5° (`dimetric.SUN_ANGLE`). | These are the garage's key numbers and keys. |
| 8 | **Fill light** | Sun lamp, **0.7**, colour `water.0`. **55°** to the screen-right, **20°** up. | The garage's fill. It keeps the shadow side of a hull legible against a dark chip. |
| 9 | **Ambient** | World colour mixing `water.0` (sky) and `dust.4` (bounce), strength **0.7**. | The garage's hemisphere. |
| 10 | **Ground, shadow and rim** | No ground plane, no shadow catcher, no rim light. | At 40 px a contact shadow reads as a smudge under the unit. The chip and the tile draw their own backdrop. |
| 11 | **Background** | **Transparent** (Film → Transparent), RGBA. | The three sites put the icon on three different panel tones. |
| 12 | **Colour management** | View transform **Standard**, look None, exposure **+0.14 EV**. | This is the garage's 1.1 exposure, written as EV. Standard, not AgX or Filmic, because a Meshy bake is already graded sRGB (`render_portrait.py`'s own invariant). The game's ACES curve is not available in Blender, so a check is run before the batch (row 16). |
| 13 | **Engine** | EEVEE, **64** samples, soft shadows on, filter 1.5 px. Same seed every run. Never `mathutils.noise`. | Deterministic, and fast enough to re-run the whole roster on every re-export (not yet timed). Two runs of the same GLB must give the same bytes, so the `--check` in row 15 cannot flicker. |
| 14 | **Output sizes** | Master **512×512**, kept out of `assets/` (not shipped). Shipped **192×192** RGBA PNG, Lanczos-downsampled from the master, at `assets/ui/portraits/units/<unit_id>.png`. | 192 covers the worst case in the sites table (156 px) with headroom. The masters let a later size change re-sample without re-rendering. Files are keyed by **unit id** rather than sheet name, because the sheets are the thing being retired. |
| 15 | **Manifest** | `assets/ui/portraits/units/manifest.json`, with `size`, the per-unit silhouette `extent`, the source GLB's SHA-256 and the rig numbers above. `unitIcon`'s `UnitIcon { url, size, extent }` contract is unchanged. | A re-exported GLB with no re-render fails `--check` in CI, the same mechanism `crop_unit_icons.py --check` uses today. |
| 16 | **Gate before the batch** | Render **3 units only** (`inf_squad`, `mbt_lavi`, `recon_drone`). Put each beside the garage turntable at the same yaw, at 40 px and at 156 px. The lead looks before the other 14 render. | This is the place where a Standard-vs-ACES mismatch or an unreadable facing would show. It costs 3 renders, not 17. |

## What this proposal does not decide

- **Enemy portraits.** `crop_unit_icons.py` also cuts icons for Sarim and Rif
  types (`INF_SARIM`, `TECH_HULL` and others). This proposal covers KDF only.
  The enemy icons stay sprite crops until the lead asks for them.
- **The commander portraits** (`render_portrait.py`, the 60 px Commander frame
  in #153's layout). That rig is a different one and is unchanged.
- **Retiring `crop_unit_icons.py`.** It stays while any site still reads a
  sheet. That covers the enemy types above, and the billboard path under
  `&nomesh`.
