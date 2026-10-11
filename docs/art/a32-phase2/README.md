# A3.2 phase 2 -- before/after sheets (GH-185, 2026-10-11)

The lead's rulings on `docs/art/a32-phase1-plan.md` §8, built: the KDF fleet
on one olive, the shanty regenerated as the corrugated lean-to the prompt
asked for, the concrete and wall warm pass, and a gunmetal texel in five
bakes so the kit's metal reads as metal.

| sheet | top row | bottom row |
|---|---|---|
| `fleet.jpg` | `origin/main` (`87d213e6`): Eitan, Kipod, D9, Shachaf, Namer, Lavi, jeep | this branch |
| `shanty.jpg` | `origin/main`: shanty v1, house (reference), concrete, wall | this branch |

**Capture conditions** (every number on a sheet was read under these):
headless Blender 5.2.0, Eevee 64 samples, `render_rig.frame_camera` (the
locked dimetric camera, each asset framed to its own bounds), one sun toward
azimuth 135 / altitude 55 in the camera frame (`lighting.ts`'s
`SUN_DIRECTION`), limestone.0 at 3.2, the portraits' sky/bounce hemisphere
at 0.7 / pi, `Standard` view transform, film transparent; the shipped GLB
with its own bake, kit hidden, wreck twin hidden; material-less role meshes
in the game's `liftTone(rampForVehicleRole)` (`roles.json`, from
`tools/src/portrait-roles.ts`). An approximation of the game's light for a
side-by-side judgement, not a golden capture. Per tile: the 512 px still,
the 64 px gameplay-zoom tile, and mean luminance / HSV saturation /
circular-mean hue over the opaque pixels.

**Register, before -> after** (the Kipod is the fleet reference, unchanged):

| asset | L | sat | hue (deg) |
|---|---|---|---|
| `apc_eitan` | 0.173 -> 0.183 | 0.269 -> 0.348 | **95 -> 72** |
| `apc_kipod` | 0.172 | 0.352 | 72 |
| `dozer_d9` | 0.155 | **0.401 -> 0.362** | 71 -> 70 |
| `scout_shachaf` | 0.171 | 0.231 | 76 |
| `ifv_namer` | 0.202 | 0.326 | 65 |
| `shanty` | 0.255 -> 0.305 | 0.301 -> 0.255 | 41 -> 36 |
| `concrete` | 0.323 -> 0.327 | **0.098 -> 0.271** | **60 -> 42** |
| `wall` | **0.405 -> 0.372** | 0.277 -> 0.329 | 40 -> 38 |
| `house` (reference) | 0.351 | 0.224 | 35 |

Measured in the bakes themselves (`bake_probe.py`, paint band = sat > 0.22,
hue 40-165, sRGB-encoded texels): the Eitan's paint went from hue 101.5 /
sat 0.299 / val 0.341 to **70.2 / 0.427 / 0.357** against the Kipod's
70.2 / 0.427 / 0.361; the D9's saturation from 0.520 to 0.444.

Re-make: `render_ref.py` (Blender, `--meshes-dir` for a `git show`
extraction of the other revision), then `composite_ba.py <before> <after>
<out>`. No RNG, no `mathutils.noise`.
