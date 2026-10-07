# Kitted vehicles, in game (GH-238 plan 3)

The eight KDF vehicles photographed through the running game with their kit
merged at load, before (L0) and after (L1-L3). Kit level L means every track
the vehicle declares at tier L, clamped to the track's length (the D9 has no
firepower track).

## Files

| File | What it is |
|---|---|
| `zoom1.0.png` | 8 rows (vehicles) x 4 columns (L0 L1 L2 L3) at the game's zoom 1.0; each cell 200x160 CSS px |
| `zoom2.5.png` | the same grid at zoom 2.5; each cell 380x320 CSS px |
| `cells/<id>_z<zoom>_L<L>.png` | the 64 cells the two sheets are built from (8 vehicles x 2 zooms x 4 levels) |
| `garage-<id>.png` | the garage bay's turntable for each of the eight at L3, at yaw 0 (Home) and yaw 180 (End) |
| `garage-mbt_lavi-L0.png` | the Lavi's bay at L0, the "before" for `garage-mbt_lavi.png` (no kit drawn) |

## Conditions

- **Art:** commit `915cc013` (the final kit, including the jeep re-placement in
  `75231fd9`); the capture tool as of `cae7f143`, whose only change over
  `915cc013` is the spawn tick below.
- **GPU:** ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro), `kit:capture`'s
  Metal default on macOS. **DPR 1**, the gate's `CAPTURE_VIEWPORT`.
- **Sheets:** `/free-play/beit_sahwan_outskirts` WITHOUT `&kit`. The tiers
  reach the renderer from a seeded brigade account, the way a player's do
  (`bootTiers` -> `upgradePrepass` -> `RendererOptions.unitKitTiers`). The
  sandbox force is struck, the frame loop is frozen, the eight are spawned at
  tick 200 and photographed at **tick 240**, with a zero-time repaint. Fog,
  overlays and wind are hidden. **Facing 0.5781 turns** (208.1 deg in the sim):
  the nose points up-screen and left at 121.2 deg from screen-right, so the
  camera sees the flank and the rear (where the slat and the stowage sit).
- **Garage:** `/brigade`, each vehicle's card selected, the turntable focused
  (which stops the auto-turn), Home and End.
- Before any cell is trusted, the tool checks the merge from the renderer
  itself against the served GLB's `kit_*` nodes: **merge check PASS, 8
  vehicles x 4 levels.** Kit triangles at L1 / L2 / L3: Lavi 826 / 2,278 /
  4,740; Namer 686 / 2,204 / 3,282; Eitan 730 / 2,094 / 3,266; Kipod 858 /
  2,092 / 3,222; jeep 736 / 1,428 / 2,264; Shachaf 474 / 1,112 / 1,906; D9 564 /
  1,294 / 2,758; Peten 388 / 832 / 1,434. Every L0 draws 0 kit triangles.

## Re-running

```bash
rm -rf docs/art/sheets/kitted-vehicles/final     # keep this README aside first
pnpm kit:capture -- --port=5232                  # the sheets and the 64 cells
pnpm kit:capture -- --garage --port=5232         # the nine garage captures
```

Each run boots its own dev server on the given port, refuses a port something
else holds, seeds music off, opens one browser at a time and stops the server
on exit. `--only=<id>[,<id>]` captures a subset; `--gpu=swiftshader` switches
backend (and the pictures are then not pixel-comparable with these).
