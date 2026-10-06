# Kitted vehicles — design (GH-238, garage uplift plan 3)

**Date:** 2026-10-06 · **Status:** design for the lead's approval; nothing is modelled yet ·
**Builds on:** `2026-09-25-garage-uplift-design.md` §3.3–3.5, the plan 3 line in §8, and §9's
textured-vehicle risk · **The lead, 6 Oct:** *"an upgraded unit should look different, in the
garage and in the game."* · **Not in scope:** a mark or badge of any kind on the map (rejected at
G-P, 2026-09-27; kit reads on the icons through plan 2b and that stays as it is); infantry kit
(§9 of the parent spec: it cannot read at 8 px).

**What this asks the lead to approve:** the 69 kit parts in §3 (8 vehicles × 3 tracks × 3 tiers,
less the D9's firepower), the two rules they follow (§2), how a variant is built at load (§5),
how kit sits on the textured hulls (§6), how parts are sourced (§7) and the purchase sound
(§8). The decisions are collected in §10.

**The mock:** `docs/art/sheets/kitted-vehicles/`. One sheet per vehicle at kit level 0/1/2/3,
two headings, at the game's own pixel scale for camera zoom 1.0 and 2.5; `overview-zoom1.png`
and `overview-zoom2.5.jpg` put the eight side by side; `legend-by-track.jpg` colours level 3 by
track; `colour-study.png` shows three tones for the kit on four hulls (§6); `audio/` holds three
candidate purchase sounds (§8). Every number below was measured from those renders or from a
browser on this machine, and says so.

---

## 1. What has changed since the parent spec

- **All eight vehicles are textured now, not four.** §9 named `mbt_lavi`, `ifv_namer`,
  `heli_peten` and `jeep_shoded`. Since then `apc_eitan` and `apc_kipod` (B0a, GH-286,
  30 Sep), `dozer_d9` and `scout_shachaf` (the A3.2 ramp set, GH-185, 30 Sep) and a re-made
  `ifv_namer` (B8, GH-179, 2 Oct) all ship a Meshy bake (`TEXTURED_VEHICLE_TYPES`,
  `packages/render/src/three/units/textured-vehicle.ts`). So every kit part in this design
  lands inside a textured GLB, and §6 is a decision about all eight.
- **Two kit-on-a-bake precedents now exist, and both are the same trick.** `officer_armour`
  (GH-298) is `mbt_lavi.glb` with a cupola, a mast and whips UV-pinned to the Lavi's bake and
  JOINED into its four nodes (`tools/vehicles/export_officer_armour.py`); `heli_peten_gunship`
  (E5) is `heli_peten.glb` with stub wings, pods and a mast dome pinned the same way
  (`export_meshy_apache_gunship.py`). Neither touches a texel of the supplied bake.
- **The garage bay is a live turntable** (GH-316, `ui/garage-viewer.ts`) built through the
  shipped `buildVehicleMeshTemplate`. Kit therefore appears in the garage the same way it
  appears in a mission, and a kitted plate (`plates:units --kit`) is only needed for the
  bay's no-WebGL2 fallback.
- **Two more KDF vehicle types exist** (E5, 1 Oct): `heli_peten_gunship` and the held
  `officer_armour`. Both are left out of plan 3 (§10, K9); this design keeps the kitted Lavi
  and the kitted Peten clear of them (§4).

## 2. The rules every part follows

### 2.1 One place per track, on every vehicle

A player who has seen one kitted vehicle should be able to read the next one. So each track
owns a region and a kind of shape, and tiers grow in that region:

| Track | Where | Tier 1 | Tier 2 | Tier 3 |
|---|---|---|---|---|
| **Armour** | the faces that take fire | bolt-on mass on the front | the flanks (skirts, modules, ERA rows) | a stand-off cage that changes the outline (slat, grille, chain curtain) |
| **Sensors** | on top, looking out | a sight head | a camera or radar array | a raised head on a mast or pedestal |
| **Firepower** | at the main weapon | its sight | its barrel and ammunition | its housing or magazine |

`legend-by-track.jpg` shows the rule on all eight (armour steel, sensors teal, firepower red,
mock colours only). Parts of different tracks never share space, so every one of the 64 tier
combinations a vehicle can hold (4 × 4 × 4) is a valid model; tiers are **cumulative within a
track** (tier 3 shows tiers 1 and 2 as well).

### 2.2 A part shows what its tier buys, and nothing else

Kit is the only place the player SEES an upgrade, so it should not lie about one. A track
patches only what `UPGRADE_PATHS` (`packages/data/src/upgrades.ts`) allows: `hull.hp`,
`hull.armor.*`, `hull.suppression_resistance`, `sensors.optics`, `sensors.sight_tiles`, and a
weapon's `accuracy` and `penetration`. Every firepower track on these eight patches
the vehicle's main weapon, `weapons[0]` (the D9 has none; the gunship's patches
`weapons[1]`). So:

- **armour** parts are protection: plates, ERA, slat, grilles, chains;
- **sensors** parts look out: sights, cameras, radars, masts;
- **firepower** parts improve the gun that is already there: its sight, its barrel, its
  ammunition, its housing.

**Four of the brief's examples are not used, by this rule.** An *extra MG mount* or a
launcher draws a weapon the sim never fires (the first draft of this mock had a twin ATGM pod
on the Lavi and a 40 mm grenade launcher on the Kipod; both were replaced). *Smoke-launcher
banks* and a *jerrycan rack*: no track buys smoke or endurance. *APS radar panels*: the APS is a
base property of the Lavi alone (`hull.aps` in `mbt_lavi.json`) and no track buys it, so panels
on any vehicle would show a system it either always had or never has. The flat panels in the
mock that look like APS radars are **camera heads** (situational-awareness sensors), which the
sensors track does buy. If the lead wants the decorative versions anyway, that is K4.

### 2.3 Maximum detail, inside a measured budget

The lead's standing rule (2 Oct) is maximum detail, simplified only to a measured budget. The
budget here is measured three ways, and draw calls are the only one that binds:

- **Draw calls: +0**, measured in §5, by merging every kit part into a node the vehicle already
  has. This is the real constraint (`docs/PERFORMANCE.md`: rendering is submission-bound), and
  §5's mechanism exists to meet it.
- **Download: 4.6–11.3 bytes a triangle**, measured on the eight shipped Draco GLBs
  (`assets/meshes/vehicles/*.glb`: geometry bytes over unique triangles; the bakes are
  61–98% of every file). The largest kit below, 4,880 triangles, is 22–55 KiB at those rates,
  on files of 0.5–2.4 MiB.
- **Frame triangles:** a frame already draws ~5.2 M triangles on the ground-plan maps
  (`docs/PERFORMANCE.md`, `ground:capture`); thirty Lavis at full kit add 146 k, 2.8%.

So the budget comes from the other end, **the smallest feature anyone sees**. The closest the
kit is ever drawn is the garage turntable: the bay is 42vh tall at 3:2 and `fitCamera` fills
0.94 of it, so a vehicle draws at roughly **80–220 px a metre** (1080p at DPR 1 to 1440p at
DPR 2; an estimate from the CSS box and the fit, not a capture). One pixel there is about
**1 cm** (half that on the high-DPI end), so every part is modelled down to 1 cm features (bevels, bolt heads, hinges, lifting
eyes, lens recesses) and nothing below. The per-part budgets in §3 are what that costs; the
largest vehicle total is **4,880** and every vehicle stays **≤ 5,000** at maximum kit, which
plan 3 makes a `validate:meshes` check.

At gameplay zoom the same parts are coarse: one pixel is **6.6 cm at zoom 1.0** and
**2.7 cm at zoom 2.5** (15.085 and 37.712 px/m, from `SILHOUETTE_PX_PER_WORLD_UNIT` over 3 m a
tile, DPR 1). A 30 mm slat bar is under a pixel at zoom 1 and about one at 2.5; §4 says what
that means.

### 2.4 Units and placement

Real metres, `+X` forward, the vehicle contract's own convention. Every part is placed against
the hull's own surfaces, measured by ray casts against the shipped GLB's live nodes
(`tools/vehicles/kit_blockout.py`, `Hull`), never typed from a real vehicle. The Peten is the
exception that has to be stated: its model is **4.37 m** long with a 4.1 m rotor (about 0.28 of
a real airframe, per `export_meshy_apache_gunship.py`), so its parts are given in the model's
metres.

## 3. The parts

How to read the tables. **Host** is the live node the part is merged into at load (§5).
**Tris** is the blockout's own count (boxes and bars, no detail), then the proposed budget at
maximum detail. **Outline** is the silhouette pixels the part adds over the shipped vehicle;
**seen** is the pixels where the part is the front-most surface, inside the outline as well as
outside it (a plate laid on a glacis changes no outline pixel at all). Both are the mean of
eight headings (0°, 45° … 315°), and the figure in brackets is the **solid** share: the pixels
that survive a 3 × 3 morphological opening, i.e. belong to a shape at least 3 px thick. A whip,
a slat bar or a thin plate edge adds pixels a player cannot read as a shape; the solid figure
is the part that reads. Masks are Blender Workbench at 8× AA, alpha > 127, through the game's
dimetric camera (azimuth 225°, elevation 30°) at the game's px/m; tiers are cumulative, so
`A3` includes A1 and A2. The `L` rows are kit level L with every track at tier L.

#### `mbt_lavi`

| | Part | Where it mounts | Size (m) | Host node | Tris: blockout → budget | Zoom 1.0: outline / seen | Zoom 2.5: outline / seen |
|---|---|---|---|---|---|---|---|
| A1 | Turret cheek wedge modules (2) | turret front quarters, angled 22° back | 0.95 × 0.42 × 0.40 each | `turret_hull` | 24 → 300 | +60 (53) / 202 (197) | +378 (372) / 1228 (1220) |
| A2 | Hull skirt modules (5 a side) | over the upper track run, 0.06 proud of the skirt | 0.80 × 0.10 × 0.56 each | `hull_hull` | 120 → 900 | +117 (80) / 560 (505) | +585 (517) / 3296 (3227) |
| A3 | Rear slat cage + ball-and-chain curtain | cage 0.42 behind the hull, returning 1.28 along each side; 13 chains under the turret bustle | cage 3.24 × 1.0 high, 30 mm bars at 120 mm; chains 0.30 drop over 1.7 | `hull_hull` + `turret_hull` | 1756 → 1,800 | +360 (141) / 935 (622) | +2109 (1039) / 5478 (4057) |
| S1 | Commander's panoramic sight | turret roof, left of centre | head 0.40 × 0.32 × 0.28 on a Ø0.24 pedestal (top 2.6) | `turret_metal` | 56 → 260 | +16 (15) / 47 (46) | +105 (102) / 290 (290) |
| S2 | Panoramic camera heads (4) | turret side faces, canted 20° | 0.46 × 0.08 × 0.38 each | `turret_hull` | 48 → 320 | +60 (55) / 173 (163) | +361 (355) / 1028 (1022) |
| S3 | Raised 360° EO/IR drum + 4 hull-corner cameras | turret left-rear, on a 0.55 pedestal; hull corners | drum Ø0.50 × 0.22 (top 2.89); cameras 0.16 × 0.16 × 0.14 | `turret_metal` + `hull_hull` | 144 → 480 | +102 (87) / 255 (225) | +617 (597) / 1513 (1500) |
| F1 | Barrel thermal sleeve + muzzle reference sensor | the 120 mm barrel | Ø0.21 over 2.1, three clamp bands; MRS 0.14 × 0.10 × 0.10 | `turret_metal` | 144 → 260 | +9 (0) / 74 (65) | +52 (12) / 436 (414) |
| F2 | Enlarged gunner's primary sight + crosswind sensor | turret front-right; turret rear-right | sight 0.55 × 0.40 × 0.36; pole 0.55 with a 0.30 T-head | `turret_metal` | 68 → 300 | +48 (29) / 153 (131) | +298 (233) / 910 (862) |
| F3 | Armoured ready-round container | on the turret bustle | 0.80 × 1.40 × 0.42 with lid | `turret_hull` | 24 → 260 | +190 (172) / 404 (392) | +1168 (1110) / 2496 (2464) |
| **L1** | every track at tier 1 | | | | | +81 (64) / 317 (304), silhouette +3.2% | +509 (461) / 1919 (1895) |
| **L2** | every track at tier 2 | | | | | +189 (135) / 804 (726), silhouette +8.0% | +1016 (888) / 4755 (4642) |
| **L3** | every track at tier 3 | | | | | +557 (356) / 1446 (1151), silhouette +22.9% | +3330 (2358) / 8608 (7324) |

Kit at max: blockout 2,384 tris, **budget 4,880** on a live vehicle of 8,346. The shipped vehicle covers 2468 px at zoom 1.0 (mean of eight headings).

The Lavi changes most: level 3 grows its outline by 22.9%, because the cage and the bustle
container stand outside a compact hull. Its sensors stay low on purpose: the drum tops out at
2.89 m, under the Lavi's own antenna stubs (3.14 m), so a kitted Lavi never borrows the
command Lavi's 4.8 m mast (IoU against `officer_armour` is 0.526 shipped and 0.474–0.512
kitted: the kit moves the Lavi further from it, not closer). The barrel sleeve (F1) adds no solid outline at zoom 1; it reads at 2.5 and in
the garage. The chains hang from the turret, so they merge into `turret_hull` and turn with it;
the cage merges into `hull_hull`.

#### `ifv_namer`

| | Part | Where it mounts | Size (m) | Host node | Tris: blockout → budget | Zoom 1.0: outline / seen | Zoom 2.5: outline / seen |
|---|---|---|---|---|---|---|---|
| A1 | Glacis applique wedges (2) | on the 31° glacis | 1.30 × 1.40 × 0.14 each | `hull_hull` | 24 → 280 | +42 (3) / 430 (413) | +282 (262) / 2670 (2659) |
| A2 | ERA bricks along the upper sides (7 a side) | upper hull side, tilted 12° with it | 0.74 × 0.18 × 0.46 each | `hull_hull` | 168 → 980 | +51 (10) / 887 (867) | +330 (307) / 5456 (5444) |
| A3 | Rear slat cage | 0.45 behind the ramp, returning 1.8 along each side | 4.10 × 1.70 high | `hull_hull` | 684 → 800 | +316 (100) / 1609 (1178) | +1991 (827) / 9368 (6721) |
| S1 | Commander's sight head | roof, beside the RWS | head 0.40 × 0.32 × 0.30 on a Ø0.24 pedestal | `hull_hull` | 56 → 260 | +17 (16) / 51 (50) | +107 (106) / 310 (309) |
| S2 | Panoramic camera heads (4) | roof corners, turned 45° | 0.50 × 0.10 × 0.40 each | `hull_hull` | 48 → 320 | +88 (75) / 196 (175) | +549 (541) / 1194 (1189) |
| S3 | Folding EO mast with sensor ball | rear roof, right | 1.15 mast, Ø0.42 ball (top 4.6) | `hull_hull` | 188 → 320 | +120 (96) / 252 (210) | +728 (716) / 1521 (1511) |
| F1 | Gunner's thermal sight block | on the 30 mm RWS | 0.40 × 0.28 × 0.28 | `turret_metal` | 12 → 160 | +9 (7) / 40 (39) | +53 (50) / 227 (226) |
| F2 | 30 mm barrel thermal shroud + muzzle-velocity radar | the RWS barrel | Ø0.17 over 1.1; radar 0.20 × 0.16 × 0.14 | `turret_metal` | 144 → 220 | +11 (7) / 79 (59) | +74 (50) / 458 (450) |
| F3 | Armoured dual-feed ammunition magazine | RWS left side, with feed chute | 0.95 × 0.42 × 0.50 | `turret_metal` | 24 → 240 | +34 (28) / 188 (166) | +221 (195) / 1118 (1109) |
| **L1** | every track at tier 1 | | | | | +68 (27) / 520 (502), silhouette +1.1% | +441 (417) / 3206 (3193) |
| **L2** | every track at tier 2 | | | | | +144 (92) / 1146 (1095), silhouette +2.4% | +908 (864) / 7012 (6991) |
| **L3** | every track at tier 3 | | | | | +453 (233) / 2016 (1550), silhouette +7.6% | +2816 (1665) / 11777 (9155) |

Kit at max: blockout 1,348 tris, **budget 3,580** on a live vehicle of 7,810. The shipped vehicle covers 5964 px at zoom 1.0 (mean of eight headings).

The Namer is the largest hull (7.30 × 4.12 m), so the same kit is a smaller share: level 3 is
+7.6%. Its glacis plates and ERA rows sit inside the outline (A1 adds 3 solid outline pixels
and 413 solid seen pixels at zoom 1): they read by tone, not shape, so this hull is where §6's
tone decision matters most.

#### `apc_eitan`

| | Part | Where it mounts | Size (m) | Host node | Tris: blockout → budget | Zoom 1.0: outline / seen | Zoom 2.5: outline / seen |
|---|---|---|---|---|---|---|---|
| A1 | Nose applique plates + bow plate | front deck (2 plates, gap for the driver); bow | 0.95 × 1.05 × 0.09 each; bow 2.30 × 0.10 × 0.50 | `hull_hull` | 36 → 360 | +47 (17) / 372 (353) | +276 (230) / 2234 (2222) |
| A2 | Upper-side armour modules (4 a side) | between the wheel arches, tilted 8° | 1.05 × 0.12 × 0.50 each | `hull_hull` | 96 → 880 | +118 (47) / 776 (716) | +801 (749) / 4712 (4676) |
| A3 | Slat cage, sides and rear | 0.47 outboard of each side (above the wheels), 0.38 behind the rear | sides 6.3 × 1.1 high; rear 4.0 × 1.6 | `hull_hull` | 660 → 1,100 | +537 (105) / 1853 (1151) | +3527 (1217) / 10723 (6481) |
| S1 | Commander's sight head | roof front-left | 0.38 × 0.30 × 0.28 on a Ø0.22 pedestal | `hull_hull` | 56 → 250 | +16 (14) / 46 (44) | +96 (95) / 268 (267) |
| S2 | Panoramic camera heads (4) | roof corners, turned 45° | 0.46 × 0.10 × 0.38 each | `hull_hull` | 48 → 320 | +54 (45) / 172 (154) | +331 (325) / 1006 (1000) |
| S3 | Telescopic sensor mast | rear right roof | 2.0 mast in three stages, head 0.50 × 0.38 × 0.30 (top 4.9) | `hull_hull` | 120 → 360 | +125 (102) / 264 (228) | +803 (796) / 1597 (1592) |
| F1 | Thermal sight block | outboard side of the .50 RWS, below its top | 0.32 × 0.24 × 0.24 | `turret_metal` | 12 → 140 | +4 (0) / 20 (16) | +20 (19) / 114 (112) |
| F2 | .50 barrel heat shroud + ammunition box with feed chute | RWS barrel; RWS left side | Ø0.10 shroud; box 0.52 × 0.24 × 0.36 | `turret_metal` | 156 → 240 | +8 (2) / 45 (37) | +47 (42) / 266 (248) |
| F3 | Armoured cowl round the weapon station | front plate and two cheeks | 0.95 wide × 1.05 long × 0.46 high | `turret_metal` | 36 → 200 | +19 (4) / 151 (121) | +116 (106) / 894 (867) |
| **L1** | every track at tier 1 | | | | | +66 (31) / 432 (408), silhouette +1.6% | +390 (344) / 2572 (2558) |
| **L2** | every track at tier 2 | | | | | +171 (94) / 961 (885), silhouette +4.3% | +1131 (1076) / 5798 (5745) |
| **L3** | every track at tier 3 | | | | | +646 (222) / 2210 (1493), silhouette +15.8% | +4234 (2078) / 12861 (8763) |

Kit at max: blockout 1,220 tris, **budget 3,850** on a live vehicle of 7,961. The shipped vehicle covers 4113 px at zoom 1.0 (mean of eight headings).

The Eitan's slat cage is the largest single change of the eight (+537 outline px at zoom 1,
1,853 seen), the caged wheeled-APC look. **One gate near-miss was found here and fixed in the
mock:** with the F1 sight on top of the weapon station, the station's bounds grew 0.24 m, the
gate's own-bounds framing moved, and the mesh gate's IoU against `gun_truck` read **0.8804**
against the 0.88 limit (0.8353 at base). Hung on the station's outboard side, below its top, it
reads 0.8326. Plan 3 gates every variant (§5) for exactly this reason.

#### `apc_kipod`

| | Part | Where it mounts | Size (m) | Host node | Tris: blockout → budget | Zoom 1.0: outline / seen | Zoom 2.5: outline / seen |
|---|---|---|---|---|---|---|---|
| A1 | ERA bank on the nose slope (2 rows of 4) | front slope, 25° | 0.55 × 0.62 × 0.13 each | `hull_hull` | 96 → 560 | +11 (0) / 340 (328) | +85 (48) / 2055 (2035) |
| A2 | Second ERA row (6 a side) | lower-upper side band | 0.78 × 0.16 × 0.42 each | `hull_hull` | 144 → 840 | +21 (0) / 684 (647) | +157 (106) / 3995 (3963) |
| A3 | Rear slat cage | 0.40 behind the hull, returning 1.6 along each side | 4.10 × 1.85 high | `hull_hull` | 720 → 800 | +413 (134) / 1341 (904) | +2638 (694) / 7769 (5071) |
| S1 | Commander's sight head | roof front | 0.38 × 0.30 × 0.28 on a Ø0.22 pedestal | `hull_hull` | 56 → 250 | +13 (9) / 45 (44) | +86 (80) / 271 (270) |
| S2 | Ground-surveillance radar | roof front-right, on a 0.40 pedestal | antenna 0.92 × 0.10 × 0.44 | `hull_hull` | 56 → 220 | +56 (48) / 128 (122) | +356 (346) / 770 (767) |
| S3 | Telescopic mast with EO drum | rear roof | 1.7 mast, drum Ø0.44 × 0.26 (top 4.9) | `hull_hull` | 168 → 340 | +107 (80) / 208 (170) | +662 (649) / 1248 (1244) |
| F1 | Thermal sight block | on the remote MG station | 0.32 × 0.24 × 0.24 | `turret_metal` | 12 → 140 | +6 (3) / 27 (26) | +38 (37) / 163 (163) |
| F2 | Barrel heat shroud + ammunition box with feed chute | station barrel; station left side | Ø0.09 shroud; box 0.50 × 0.24 × 0.34 | `turret_metal` | 156 → 240 | +10 (3) / 63 (58) | +63 (54) / 372 (364) |
| F3 | Armoured cowl round the weapon station | front plate and two cheeks | 0.95 × 1.05 × 0.44 | `turret_metal` | 36 → 200 | +28 (9) / 172 (152) | +176 (168) / 1015 (1004) |
| **L1** | every track at tier 1 | | | | | +31 (12) / 409 (394), silhouette +0.6% | +209 (165) / 2466 (2445) |
| **L2** | every track at tier 2 | | | | | +87 (51) / 870 (823), silhouette +1.9% | +575 (506) / 5107 (5065) |
| **L3** | every track at tier 3 | | | | | +542 (223) / 1706 (1219), silhouette +11.4% | +3448 (1512) / 9951 (7266) |

Kit at max: blockout 1,444 tris, **budget 3,590** on a live vehicle of 8,052. The shipped vehicle covers 4816 px at zoom 1.0 (mean of eight headings).

The Kipod already carries reactive plate, so its armour adds a second layer: the nose bank and
side row are interior (0 solid outline px at zoom 1, 328 and 647 solid seen) and the cage is its
outline read. Its sensors are a ground radar (S2) and a mast with an EO drum (S3); a
counter-IED jammer was in the first draft and was dropped, because nothing in the sensors track
buys jamming.

#### `jeep_shoded`

| | Part | Where it mounts | Size (m) | Host node | Tris: blockout → budget | Zoom 1.0: outline / seen | Zoom 2.5: outline / seen |
|---|---|---|---|---|---|---|---|
| A1 | Door armour kits (2 a side) | over the four doors | 0.78 × 0.06 × 0.58 each | `hull_hull` | 48 → 360 | +9 (0) / 144 (120) | +49 (35) / 834 (802) |
| A2 | Gunner's shield | round the roof MG ring | front 0.95 × 0.55; two wings 0.48 × 0.50 at 40° | `hull_metal` | 36 → 300 | +63 (48) / 282 (253) | +384 (362) / 1667 (1631) |
| A3 | Bull-bar grille, bed armour, windscreen louvres | nose; rear bed sides; windscreen | grille 1.9 × 0.57; bed 0.92 × 0.46 a side; louvres 1.70 × 0.40 | `hull_hull` | 144 → 560 | +112 (50) / 491 (400) | +682 (458) / 2817 (2427) |
| S1 | EO ball on a post | cab roof, rear right | Ø0.28 ball on a 0.24 post | `hull_hull` | 124 → 200 | +6 (4) / 19 (12) | +33 (32) / 106 (104) |
| S2 | Surveillance pod on a roof rack | cab roof | pod 0.55 × 0.36 × 0.32; rack 0.90 × 0.90 | `hull_hull` | 24 → 220 | +14 (12) / 119 (110) | +89 (84) / 699 (686) |
| S3 | Telescopic mast with radar head | rising from the rear bed | 2.3 mast, head 0.42 × 0.30 × 0.26 (top 3.36) | `hull_hull` | 120 → 300 | +65 (45) / 193 (150) | +393 (369) / 1137 (1107) |
| F1 | MG sight + two ready ammunition cans | on the MG; at the ring | sight 0.26 × 0.14 × 0.16; cans 0.30 × 0.13 × 0.20 | `hull_metal` | 36 → 220 | +11 (2) / 40 (32) | +69 (64) / 230 (225) |
| F2 | Barrel shroud + 400-round box | MG barrel; ring right | Ø0.08 shroud; box 0.40 × 0.22 × 0.30 | `hull_metal` | 144 → 200 | +19 (4) / 82 (66) | +124 (96) / 469 (459) |
| F3 | Heavy-barrel conversion | the roof MG | barrel Ø0.10 × 1.35; receiver shroud 0.65 × 0.26 × 0.26 | `hull_metal` | 56 → 200 | +37 (8) / 123 (94) | +254 (219) / 756 (748) |
| **L1** | every track at tier 1 | | | | | +26 (6) / 202 (164), silhouette +1.4% | +150 (131) / 1168 (1129) |
| **L2** | every track at tier 2 | | | | | +88 (62) / 442 (404), silhouette +5.1% | +540 (506) / 2629 (2580) |
| **L3** | every track at tier 3 | | | | | +197 (102) / 751 (614), silhouette +11.0% | +1226 (978) / 4410 (3999) |

Kit at max: blockout 732 tris, **budget 2,560** on a live vehicle of 43,935. The shipped vehicle covers 1806 px at zoom 1.0 (mean of eight headings).

The smallest ground vehicle. The gunner's shield (A2) is its clearest single read at zoom 1
(+48 solid outline px). Its bake is the darkest of the four hulls in the colour study (median
paint luminance 0.059 linear, against 0.085–0.096 for the other three), so paint-toned kit nearly
vanishes into it (`colour-study.png`, bottom rows).

#### `scout_shachaf`

| | Part | Where it mounts | Size (m) | Host node | Tris: blockout → budget | Zoom 1.0: outline / seen | Zoom 2.5: outline / seen |
|---|---|---|---|---|---|---|---|
| A1 | Nose plate + door plates | nose slope; both doors | nose 1.00 × 1.10 × 0.08; doors 0.82 × 0.06 × 0.58 | `hull_hull` | 36 → 280 | +25 (6) / 224 (207) | +163 (138) / 1364 (1346) |
| A2 | Side panels between the wheels + arch guards | body sides; over the four wheels | panels 1.90 × 0.08 × 0.66; guards 0.80 × 0.30 × 0.06 | `hull_hull` | 72 → 360 | +56 (24) / 480 (439) | +349 (302) / 2860 (2828) |
| A3 | Grille cage | along both body sides; across the nose | sides 2.9 × 0.8 high; front 1.3 × 0.6 | `hull_hull` | 360 → 600 | +157 (29) / 752 (507) | +1053 (534) / 4441 (3475) |
| S1 | Laser-rangefinder/thermal box | beside the existing mast head | 0.32 × 0.22 × 0.20 | `hull_hull` | 12 → 160 | +15 (9) / 21 (18) | +94 (90) / 124 (123) |
| S2 | Ground-surveillance radar | under the mast head | 0.78 × 0.10 × 0.34 | `hull_hull` | 12 → 140 | +28 (14) / 60 (54) | +159 (146) / 339 (337) |
| S3 | Second mast stage with stacked head | on top of the existing mast | 1.0 stage, head 0.46 × 0.32 × 0.30 (top 4.4) | `hull_hull` | 84 → 300 | +86 (58) / 120 (99) | +523 (503) / 710 (702) |
| F1 | Thermal sight block | on the cupola MG station | 0.28 × 0.20 × 0.20 | `turret_metal` | 12 → 120 | +6 (3) / 19 (16) | +35 (30) / 106 (104) |
| F2 | Barrel shroud + ammunition box | station barrel; station left | Ø0.08 shroud; box 0.44 × 0.22 × 0.30 | `turret_metal` | 144 → 200 | +15 (6) / 50 (42) | +91 (84) / 284 (281) |
| F3 | Armoured cowl round the weapon station | front plate and two cheeks | 0.80 × 0.85 × 0.40 | `turret_metal` | 36 → 180 | +35 (21) / 130 (118) | +216 (204) / 778 (764) |
| **L1** | every track at tier 1 | | | | | +46 (19) / 261 (240), silhouette +2.3% | +290 (258) / 1579 (1560) |
| **L2** | every track at tier 2 | | | | | +88 (43) / 562 (515), silhouette +4.6% | +545 (485) / 3340 (3306) |
| **L3** | every track at tier 3 | | | | | +252 (117) / 953 (709), silhouette +13.0% | +1637 (1183) / 5654 (4760) |

Kit at max: blockout 768 tris, **budget 2,340** on a live vehicle of 5,076. The shipped vehicle covers 1906 px at zoom 1.0 (mean of eight headings).

The scout's sensors build on the mast it already has: a rangefinder box, a radar under the
head, and a second stage that makes it the tallest of its class (4.4 m). Its nearest neighbour
at S3 is `officer_armour` at 0.642, the only other unit defined by a mast, and well clear.

#### `dozer_d9`

| | Part | Where it mounts | Size (m) | Host node | Tris: blockout → budget | Zoom 1.0: outline / seen | Zoom 2.5: outline / seen |
|---|---|---|---|---|---|---|---|
| A1 | Cab window grilles | both cab sides | 1.24 × 0.80 each, 25 mm bars at 100 mm | `hull_hull` | 288 → 400 | +8 (0) / 149 (116) | +58 (0) / 698 (160) |
| A2 | Slat cage round the cab | ~0.35 off the cab sides and rear | sides 1.75, rear 3.24, 1.1 high | `hull_hull` | 492 → 700 | +131 (31) / 540 (307) | +759 (226) / 2939 (1503) |
| A3 | Track-top skirt plates + rear slat round the ripper | over the upper track run (5 a side); behind the engine | plates 0.90 × 0.08 × 0.60; slat 2.8 × 1.1 | `hull_hull` | 288 → 1,300 | +298 (154) / 1213 (860) | +1830 (1218) / 6972 (5035) |
| S1 | Work-light bar with IR camera heads | cab roof front | bar 1.80 × 0.22 × 0.12; four heads 0.14 × 0.22 × 0.16 | `hull_hull` | 60 → 300 | +7 (0) / 105 (102) | +43 (38) / 609 (606) |
| S2 | Remote-operation camera mast | cab roof rear-left | 0.80 mast, Ø0.32 camera ball (top 4.2) | `hull_hull` | 152 → 260 | +28 (9) / 138 (117) | +166 (157) / 805 (800) |
| S3 | Forward obstacle radar + second camera mast | cab roof front; cab roof rear-right | radar 0.85 × 0.10 × 0.36; 1.3 mast, drum Ø0.36 × 0.22 | `hull_hull` | 172 → 400 | +66 (34) / 215 (175) | +396 (370) / 1261 (1242) |
| **L1** | every track at tier 1 | | | | | +15 (0) / 254 (218), silhouette +0.3% | +97 (38) / 1304 (767) |
| **L2** | every track at tier 2 | | | | | +155 (48) / 674 (432), silhouette +3.2% | +899 (395) / 3719 (2317) |
| **L3** | every track at tier 3 | | | | | +355 (198) / 1420 (1049), silhouette +7.3% | +2166 (1590) / 8174 (6284) |

Kit at max: blockout 1,452 tris, **budget 3,360** on a live vehicle of 7,901. The shipped vehicle covers 4843 px at zoom 1.0 (mean of eight headings).

Armour reads (cab cage, track skirts, rear slat); the sensors are small against a 4.56 m wide
machine. The cab grilles (A1) are bars over glass and read only as texture: 0 solid outline px
even at zoom 2.5, 116 solid seen at zoom 1. The D9 has no firepower track and gets no firepower
kit. A jammer was in the first draft and was replaced by an obstacle radar and a second camera
mast, for §2.2's reason.

#### `heli_peten`

| | Part | Where it mounts | Size (m) | Host node | Tris: blockout → budget | Zoom 1.0: outline / seen | Zoom 2.5: outline / seen |
|---|---|---|---|---|---|---|---|
| A1 | Cockpit side armour panels | either side of the cockpit | 0.55 × 0.03 × 0.22 each | `hull_hull` | 24 → 120 | +0 (0) / 7 (3) | +1 (0) / 35 (22) |
| A2 | Engine-bay armour panels | on both engine nacelles | 0.55 × 0.18 × 0.16 each | `hull_hull` | 24 → 160 | +12 (2) / 41 (29) | +73 (55) / 237 (214) |
| A3 | Armoured sponson fairings + floor plate | sponsons; belly | 0.90 × 0.12 × 0.20 each; floor 1.30 × 0.42 × 0.05 | `hull_hull` | 36 → 240 | +32 (3) / 81 (50) | +191 (144) / 477 (434) |
| S1 | Enlarged nose sensor turret | the nose | Ø0.28 × 0.30 | `hull_glass` | 52 → 200 | +6 (0) / 15 (10) | +32 (21) / 83 (78) |
| S2 | Warning-sensor heads (4) + sensor pods (2) | fuselage corners; low on the sides | heads 0.10 cube; pods 0.36 × 0.08 × 0.08 | `hull_hull` | 72 → 240 | +13 (0) / 31 (10) | +78 (57) / 172 (150) |
| S3 | Sensor ball on the boom + roof sensor fairing | tail boom; engine hump | ball Ø0.24; fairing 0.36 × 0.20 × 0.10 | `hull_hull` | 92 → 220 | +23 (6) / 43 (16) | +135 (105) / 242 (208) |
| F1 | Chin-gun barrel extension with shroud | the 30 mm chin gun | Ø0.06 × 0.55 | `hull_metal` | 160 → 180 | +5 (0) / 8 (0) | +31 (0) / 49 (13) |
| F2 | Ammunition magazine pod + feed chute | under the fuselage | 0.70 × 0.24 × 0.17; chute 0.50 | `hull_metal` | 24 → 160 | +10 (0) / 14 (0) | +60 (21) / 85 (41) |
| F3 | Enlarged chin-turret housing | under the nose | Ø0.34 × 0.26 | `hull_metal` | 60 → 160 | +12 (0) / 19 (0) | +79 (33) / 111 (62) |
| **L1** | every track at tier 1 | | | | | +10 (0) / 27 (14), silhouette +1.2% | +59 (24) / 152 (110) |
| **L2** | every track at tier 2 | | | | | +33 (2) / 82 (40), silhouette +4.2% | +206 (136) / 474 (400) |
| **L3** | every track at tier 3 | | | | | +58 (9) / 130 (67), silhouette +7.3% | +359 (262) / 760 (663) |

Kit at max: blockout 544 tris, **budget 1,680** on a live vehicle of 41,031. The shipped vehicle covers 796 px at zoom 1.0 (mean of eight headings).

**The Peten does not read at zoom 1**: level 3 adds 9 solid outline pixels and 67 solid seen
pixels, because from this camera the rotor disc covers most of the fuselage. It reads at 2.5
(+262 / 663) and in the garage. Its kit avoids stub wings, pods and a mast dome on purpose,
since those are the gunship's identity: its IoU against `heli_peten_gunship` goes from 0.671
at base to 0.726 at worst. The first draft gave its firepower track Hellfire racks; they were
removed because the track patches the chin gun (`weapons[0]`), not the missiles. See K5.

## 4. How it reads at gameplay zoom

Kit level L, every track at tier L, zoom 1.0 unless stated. Each cell is **solid outline px /
solid seen px** (§3's definitions, mean of eight headings). IoU is the mesh gate's own
(`validate_assets.silhouette` + `iou`: 256 px renders framed to the variant's own bounds,
64 px masks) against every shipped vehicle's base, worst over the variants measured (12 a vehicle, 9 for
the D9).

| Vehicle | Shipped px | L1 | L2 | L3 | L3 outline growth | L3 at zoom 2.5 | Nearest IoU: shipped → worst variant |
|---|---|---|---|---|---|---|---|
| `mbt_lavi` | 2468 | 64 / 304 | 135 / 726 | 356 / 1151 | +22.9% | 2358 / 7324 | `scout_shachaf` 0.700 → L2 vs `scout_shachaf` 0.726 |
| `ifv_namer` | 5964 | 27 / 502 | 92 / 1095 | 233 / 1550 | +7.6% | 1665 / 9155 | `dozer_d9` 0.843 → F1 vs `dozer_d9` 0.855 |
| `apc_eitan` | 4113 | 31 / 408 | 94 / 885 | 222 / 1493 | +15.8% | 2078 / 8763 | `demo_tzav` 0.836 → A1 vs `gun_truck` 0.841 |
| `apc_kipod` | 4816 | 12 / 394 | 51 / 823 | 223 / 1219 | +11.4% | 1512 / 7266 | `apc_eitan` 0.820 → A3 vs `gun_truck` 0.829 |
| `jeep_shoded` | 1806 | 6 / 164 | 62 / 404 | 102 / 614 | +11.0% | 978 / 3999 | `gun_truck` 0.843 → L1 vs `gun_truck` 0.845 |
| `scout_shachaf` | 1906 | 19 / 240 | 43 / 515 | 117 / 709 | +13.0% | 1183 / 4760 | `gun_truck` 0.788 → L2 vs `gun_truck` 0.817 |
| `dozer_d9` | 4843 | 0 / 218 | 48 / 432 | 198 / 1049 | +7.3% | 1590 / 6284 | `ifv_namer` 0.843 → A3 vs `ifv_namer` 0.868 |
| `heli_peten` | 796 | 0 / 14 | 2 / 40 | 9 / 67 | +7.3% | 262 / 663 | `heli_peten_gunship` 0.671 → F3 vs `heli_peten_gunship` 0.726 |

What that says:

1. **Level 3 reads at zoom 1 on every ground vehicle**: the outline grows 7–23% and
   614–1,550 px of kit face the camera as solid shapes. The cage (armour 3) and the mast
   (sensors 3) carry most of it, which is the grammar of §2.1 doing its job.
2. **Levels 1 and 2 are mostly inside the outline.** At level 1 the outline moves by 0–64
   solid px but 164–502 solid px of kit face the camera. Inside the outline a part reads by
   tone and by the sun on its edges, not by shape, so **§6's tone decision decides whether
   levels 1 and 2 read at zoom 1.** `colour-study.png` (level 3, four hulls) is the evidence:
   paint-toned kit is plain on the olive hulls at 2.5 and faint inside the outline at 1.0;
   steel kit stands out at both.
3. **Firepower on the four weapon-station vehicles is small at zoom 1** (Namer, Eitan, Kipod,
   Shachaf: F3 adds 4–28 solid outline px, 118–166 solid seen). That is the honest size of a
   sight, a shroud and a cowl on a half-metre station. It reads at 2.5 and in the garage (K6).
4. **The Peten does not read at zoom 1** (9 / 67), for the rotor (K5).
5. **Slat at gameplay zoom is a frame, not bars.** A 30 mm bar is 0.45 px at zoom 1 and
   1.1 px at 2.5. The cage tiers keep 62–73% of their seen pixels solid against 92–98% for
   the plate tiers (the jeep's thin door plates, 83%, are the exception). The cage holds its
   outline through its posts and rails, so the mock draws those at 48 mm (1.6× the bar) and
   plan 3 keeps that ratio; the bars stay at a real 120 mm pitch and read as texture from
   zoom 2.5 and in the garage. Thicker or sparser bars would read at zoom 1 and would stop
   looking like slat armour up close.
6. **No variant crosses the gate's 0.88**; the closest is the D9 at A3 against the Namer,
   0.868 (0.843 at base). The kit moves the gate's numbers through FRAMING as much as
   through shape: a 0.24 m box on top of the Eitan's station moved its IoU against
   `gun_truck` by 0.045 (§3, Eitan). The Lavi stays clear of `officer_armour` (0.526 at base,
   0.474–0.512 kitted) and the Peten of the gunship (0.671 → 0.726).

## 5. How a variant is picked at load

### 5.1 The key is the three tiers, not the kit level

`kitLevel` (`@lions/data`) is a SUMMARY: `ceil(3 × owned ÷ available)`. It cannot say WHICH
parts to draw: a Lavi with armour 3 and nothing else is 3/9, level 1, and so is a Lavi with
one tier of each track. They are different vehicles, and §2.2 says the model must show the
one the player bought. The per-track tiers are already in hand: `upgradePrepass` reads them
for every KDF type (`packages/app/src/upgrade-prepass.ts`) to patch the sim's types. So the
renderer gets them directly, one new optional field, three-only, Pixi ignores it:

```ts
// packages/render/src/api.ts, RendererOptions
unitKitTiers?: Readonly<Record<string /* typeId */, Readonly<Record<string /* track */, number>>>>;
```

Tiers are type-wide and fixed for a mission (brigade D3), so a type's model is decided once,
at template build. `kitLevel` keeps its job (icons, HUD, garage chip).

### 5.2 Three ways to build the model, measured

| | One GLB per kit level (M1) | One GLB, kit nodes toggled (M3) | **One GLB, kit nodes merged at load (M2)** |
|---|---|---|---|
| Can show the bought tiers | only a fixed bundle per level; per track would be 64 files a type | yes | **yes** |
| Draw calls per vehicle per frame | 12 (kit joined at export) | **39** (13 meshes × 3 passes) | **12** |
| Files and bytes | 4 files a type; +3 copies of each bake, **+28.0 MiB** in `assets/meshes/vehicles/` for the eight (the bakes are 61–98% of every file) | 1 file, ≤ 55 KiB | **1 file, ≤ 55 KiB** |
| Fetches per mission | 1 per type | 1 | **1** |
| Load cost | none | none | **0.1–0.7 ms a type, once** |
| A purchase in the garage | fetch the next file | flip visibility | **re-merge from the cached GLB, 0.1–0.7 ms** |
| Pipeline | wreck, encode and mesh gate on 32 files | 8 files | **8 files** |

**Measured** in headless Chromium on ANGLE/Metal (Apple M3 Pro), three r170, twenty clones of
each vehicle under a shadow-casting sun, with the AO pre-pass as a second render with an
override material (`docs/art/sheets/kitted-vehicles/measure/kit-drawcalls.mts`, results in
`drawcalls.jsonl`). The shipped vehicle is 4 meshes and 12 submissions a frame (main, shadow,
AO; the D9 is 2 and 6); the blockout's nine kit nodes as separate meshes made it **39 on every
vehicle** (+225%; the D9 24); merged into their hosts it is **12 again, on all eight**, with
the merge itself taking **0.1–0.7 ms** a type. One trap the harness hit and the plan inherits:
three r170 resets `renderer.info` AFTER the shadow pass, so `autoReset` hides every shadow
draw; any draw-call assertion in plan 3 must reset by hand, as the harness does.

**Recommended: M2.** One GLB per type carrying every part as its own node; at template build
the renderer keeps the nodes the type's tiers own, merges each into its host's geometry, and
deletes the rest. A toggled node is +3 submissions a vehicle a frame; a merged one is +0.

### 5.3 The contract (plan 3 writes it into `mesh-unit-contract.md`)

- A kit part is a node named `kit_<track>_<tier>_<host>` (`kit_armour_3_turret_hull`) with
  `extras.rl_kit = { track, tier, host }` and an `rl_role` from `kit.py`'s six. One node per
  (track, tier, host).
- The host is a live node of the same vehicle with the same material (a UV-pinned part on a
  bake host, §6). A turret part's host is a turret node, so it turns with the turret.
- `buildVehicleMeshTemplate(gltf, id, textured, tiers)`: keep the kit nodes whose tier is at
  or below the type's tier on that track; for each host geometry, merge the kept parts in the
  host's space and swap the new geometry onto EVERY mesh that shared the old one, which is
  the live node and its `WRECK_` twin, so the wreck carries its kit; delete all kit nodes.
  `silhouette.ts` merges after this and needs no change. The garage view calls the same
  builder, so a purchase re-merges from the cached GLB.
- `pnpm wreck:meshes` learns `kit_*`: a kit node's wreck twin takes its HOST's displacement
  and is never a recipe group of its own.
- `pnpm validate:meshes` learns kit: hide `kit_*` for the shipped render; add a maximum-kit
  render and the twelve variants measured here, each IoU-checked against every unit; check
  every host exists with the same material; check every `rl_kit.track` is a track the unit's
  own JSON declares (no firepower part on the D9); and hold the kit at ≤ 5,000 triangles.
  Every one of those checks gets its failing input in the commit that adds it (CLAUDE.md).
- The golden gate cannot see kit (every gated scenario boots a fresh account, parent §9).
  `&kit` already seeds `SANDBOX_KIT_LEVELS` before boot, so a `kitted` scenario is the
  sandbox `vehicle` scenario plus `&kit`, blessed once from CI numbers (K8).

## 6. Kit on a textured hull — options for the lead

All eight vehicles ship a supplied bake under the lead's "as is" rule, so this is the one
decision that touches every part. Four ways to do it:

| | How | Calls | Bytes | The bake | Precedent |
|---|---|---|---|---|---|
| **T1. Pin and join** | each part's UVs pinned to ONE texel of the vehicle's own bake, joined into its host | +0 | +0 texture | untouched | `officer_armour`, `heli_peten_gunship` |
| T2. Extend the atlas | bake the parts' own texture (paint, edge wear) in Blender and append it as a strip beside the bake (e.g. 2048 × 2048 → 2048 × 2304) | +0 | +150–300 KiB a vehicle (estimate) | its pixels untouched, the image grows | the infantry crew-weapon atlases (`import_meshy_crew_team.py`) |
| T3. Palette material | the parts take ramp roles (`rampForVehicleRole`) in a separate material | **+3 a role a vehicle**, unless merged into the palette weapon station (Namer, Eitan, Kipod, Shachaf only, and that turns with the turret) | +0 | untouched | the Eitan's RWS; rejected for the gunship as "a second register on one hull" |
| T4. Meshy-textured parts | each part generated with its own bake | +1 material a vehicle unless atlas-composed (then it is T2) | +texture, + credits | untouched | none on a vehicle |

**Recommended: T1**, the established path, +0 calls and +0 bytes, with two rules the
precedents did not need: pin to texels whose **normal-map value is neutral** (a pinned part
takes one normal-map texel over its whole surface, and a tilted one would tilt its shading), and
take the part's detail from geometry, which is why §2.3 budgets bevels and bolt heads. **T2**
is the upgrade path if the lead wants painted wear on the kit after seeing T1; it needs the
lead's word because it changes the supplied file's image, though not one of its pixels.

**Under T1, which texel? (K3).** `colour-study.png` draws level 3 on the Lavi, the Eitan, the
Kipod and the jeep three ways, the parts flat-coloured exactly as a pinned texel would draw
them under the game's sun:

- **Match:** the hull's median paint texel (the gunship's rule). Kit reads by shape and edge
  light only; on the Lavi's camouflage the median falls on a blue-grey stripe and the kit
  reads as a different paint scheme.
- **Shade (recommended):** the hull's 25th-percentile paint texel, same hue, darker: the kit
  reads as add-on panels in base paint, which is what real add-on kit looks like, and stays in
  the bake's own register. Metal parts (masts, sights, shrouds) take the bake's own metal
  texel under both Match and Shade.
- **Steel:** `gunmetal.0`, the garage's kit colour. The kit stands out at zoom 1 and the world
  kit would echo the garage's steel. Two things count against it: it reads as a colour code,
  which is close to the "status mark in the world" the lead rejected, and no bake carries
  that grey, so it is not a T1 option at all; it would need T2's atlas strip or T3's palette
  material (+3 calls a vehicle per role).

## 7. Sourcing the parts

**Blender, at maximum detail, for all 69.** Every part is hard-surface: plates, ERA bricks, slat
frames, chains, masts, sight and camera heads, shrouds, magazines, cowls. Plan 3 builds them in
a parts module beside `tools/vehicles/kit.py` (bevelled panels, bolt heads, hinges, lifting
eyes, lens recesses, chain links) and one exporter that re-opens each SHIPPED GLB the way
`export_officer_armour.py` does, places the parts with the blockout's own ray casts, pins and
writes the `kit_*` nodes. The blockout script in this PR (`tools/vehicles/kit_blockout.py`) is
the placement half of that exporter already, every part's position measured off the hull.

**Meshy: 0 credits recommended.** Under T1 a part draws one texel, so a Meshy bake would be
thrown away, and a Meshy remesh at 400–600 triangles (the bible's crew-weapon row) gives a
softer hard-surface shape than a modelled one at these sizes. Meshy earns its place only under
T2/T4, where a photographed surface would show: then the four parts with the most seen pixels
per piece at zoom 2.5 are worth it (the sight head, the 360° drum, the camera head and the ERA
brick, each reused across vehicles), at preview 20 + refine 8k 15 + remesh 5 = **40 credits
each, 160 credits, about $3.20** at the CLI's $0.02/credit estimate (not confirmed against the
dashboard). Nothing is spent without the lead's go, per the Meshy policy.

Provenance: Blender-built parts are not AI art and need no disclosure; the bakes they pin to
are the vehicles' existing disclosed Meshy bakes, recorded in `docs/ASSET_PROVENANCE.md`.

## 8. The purchase sound: "kit fitted"

Plan 1 shipped `ui_purchase` (a unit) and `ui_upgrade` (a tier), both from
`tools/gen_audio.py`, the generator behind the game's 33 CC0 sound effects. Plan 3 adds one
set, **`ui_kit_fitted`**, played **instead of** `ui_upgrade` when the tier bought adds a part
to one of these eight (every tier does), at the moment the part appears on the turntable: a
third `PurchaseCue` (`'kit'`) in `ui/garage-model.ts`, a synth branch in `audio.ts`'s `playUi`
so a missing clip never falls to the alert, and a manifest entry. Same rules as the other two
UI voices: RNG-free, ≤ 250 ms, mono, peak −6 dBFS (`UI_PEAK`), CC0.

Three candidates, built only from `gen_audio.py`'s own primitives, are in
`docs/art/sheets/kitted-vehicles/audio/` with the script that made them; measured beside the two
shipped cues:

| Candidate | What it is | Parameters | Length · tail to −40 dB · centroid |
|---|---|---|---|
| **A. Bolt-on** (recommended) | an impact-wrench rattle, then a plate clank | 5 square-wave pawl clicks 25 ms apart, 2.6 → 2.36 kHz, gain 0.35 → 0.47; at 150 ms an inharmonic strike (420, 1130, 2090, 3310 Hz at 1.0/0.55/0.35/0.2, decays 90/63/45/32 ms) over a 120 → 70 Hz thud | 240 ms · 219 ms · 3.9 kHz |
| B. Plate set | a low thud under a bright plate ring, then one note | 95 → 55 Hz thud, 70 ms; ring 760/1910/3150 Hz (0.6/0.4/0.25), 130 ms; at 135 ms a 1140 Hz sine, 100 ms | 245 ms · 215 ms · 1.1 kHz |
| C. Torque and lock | the upgrade ratchet speeding up, ending on a struck ting | 5 clicks at 0/40/71/95/113 ms (gaps 40 → 18 ms), 1.8 → 2.3 kHz; at 130 ms a 1760 Hz ting with 4858 and 980 Hz partials, 110 ms | 245 ms · 226 ms · 5.5 kHz |
| *shipped `ui_upgrade`* | ratchet then a high note | 3 clicks 30 ms apart at 1.8 kHz, 880 Hz at 100 ms | 240 ms · 217 ms · 4.8 kHz |
| *shipped `ui_purchase`* | low clunk, rising pair | 110 → 70 Hz, 330 then 494 Hz | 240 ms · 218 ms · 290 Hz |

A is recommended because it says what happened (something bolted on), and its rattle-then-clank
is a different shape from `ui_upgrade`'s click-then-note, so the two never blur. B is the heavier
choice if the lead wants weight over metal; C is the closest to `ui_upgrade` and the easiest to
confuse with it. The lead chooses by ear (K10).

## 9. Plan 3, revised

The parent §8 named ten tasks. With the turntable in place and this design approved:

1. **Numbers** (this document) approved, with the K-decisions.
2. **The parts module and exporter, Lavi only**, at maximum detail under the chosen §6 option;
   the picture gate on the Lavi (turntable stills, zoom 1.0 and 2.5 in `?sandbox&kit`) before
   any other vehicle is built.
3. **The other seven**, the same exporter.
4. **Contract and tools**: `kit_*` nodes, `wreck:meshes`, `encode:meshes`, `validate:meshes`'
   kit checks, each falsified in its commit.
5. **Runtime**: `unitKitTiers`, the merge in `buildVehicleMeshTemplate`, the garage view; a draw
   call test that resets `renderer.info` by hand and reads +0.
6. **Golden**: the `kitted` scenario (K8), blessed from CI numbers.
7. **Sound**: `ui_kit_fitted` in `gen_audio.py`, the `'kit'` cue, the synth branch.
8. **Kitted plates** for the no-WebGL2 fallback only (`plates:units --kit`).
9. **Track close-ups** (parent §3.3): from the turntable's own camera rather than a second rig,
   if still wanted (K11).
10. **Provenance, docs, CLAUDE.md** ("Mesh units": kit nodes and the merge).

## 10. Decisions for the lead

| # | Question | Recommended |
|---|---|---|
| K1 | The 69 parts in §3, and §2.1's one-place-per-track grammar | approve; name any part to change |
| K2 | How a variant is built | **M2**: one GLB, kit nodes merged at load, keyed by the three tiers (+0 calls measured) |
| K3 | Kit on the textured hulls | **T1** pin-and-join; tone **Shade** (25th-percentile paint, metal parts on the bake's metal); T2 later if wanted |
| K4 | Decorative kit the sim does not model (extra MG, launchers, smoke banks, jerrycans, APS panels) | **no** (§2.2) |
| K5 | The Peten reads only from zoom 2.5 and in the garage | accept; the alternative is parts larger than an airframe carries, or wings that read as the gunship |
| K6 | Firepower on the four weapon-station vehicles is small at zoom 1 | accept (honest size); it reads at 2.5 and in the garage |
| K7 | Slat: real bars at 120 mm pitch with a 1.6× frame | yes (§4, point 5) |
| K8 | A gated `kitted` golden scenario (`vehicle` + `&kit`), one bless | yes |
| K9 | `heli_peten_gunship` and `officer_armour` | out of plan 3; the gunship can take the Peten's armour and sensors parts later at no design cost |
| K10 | The purchase sound | **A, Bolt-on**; B or C by ear |
| K11 | The 49 track close-ups of parent §3.3, now the bay turns | render them from the turntable's camera, or drop them |
| K12 | Meshy | **0 credits**; 160 only if K3 becomes T2/T4 |

## 11. How this was made, and how to re-run it

```bash
# blockout: masks, gate renders, mock stills, kit coverage, colour study, kit GLBs
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
  --python tools/vehicles/kit_blockout.py -- --out <dir> --coverage --export
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
  --python tools/vehicles/kit_blockout.py -- --out <dir> \
  --only mbt_lavi,apc_eitan,apc_kipod,jeep_shoded --skip-masks --skip-gate --colour-study
# the gate's neighbours (base renders only)
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
  --python tools/vehicles/kit_blockout.py -- --out <dir2> --skip-mock --skip-masks \
  --only attack_drone,demo_tzav,gun_truck,heli_peten_gunship,loiter_drone,officer_armour,paramotor,recon_drone,rocket_battery,technical
# numbers and sheets
python3 tools/vehicles/kit_blockout_measure.py --run <dir> --neighbours <dir2> --sheets <out> --json <json>
# draw calls (headless Chromium, no server, music off)
tools/node_modules/.bin/tsx docs/art/sheets/kitted-vehicles/measure/kit-drawcalls.mts <dir>/glb
# the sound candidates
python3 docs/art/sheets/kitted-vehicles/audio/kit_fitted_candidates.py docs/art/sheets/kitted-vehicles/audio
```

Conditions: Blender 5.2.0 headless (Cycles CPU, 24 samples, for the stills; Workbench for
masks), macOS on an M3 Pro, 2026-10-06, at `origin/main` 79e528c4. The camera is
`tools/render_clip_pose.py`'s (the `dimetric.py` vector its `frame_camera` places: azimuth 225°,
elevation 30°, orthographic), but not that script itself: it needs an armature and a clip, which
no vehicle has, and it fits the frame to the model, where a gameplay-zoom measurement needs the
game's fixed px/m. The sun is the game's (azimuth 135°, altitude 55°), not `build_lights`' rig
lamp, whose convention bug puts it at 45° (CLAUDE.md, "The colour pipeline"). The raw numbers are in
`docs/art/sheets/kitted-vehicles/measure/` (`measurements.json`, `drawcalls.jsonl`,
`parts.txt`). Nothing here ships: the blockout geometry is a measuring instrument, and every
shipped part is built again at detail in plan 3.
