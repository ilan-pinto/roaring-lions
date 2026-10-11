# Blast capture sheet -- after

14 frame(s) over 2 subject(s): penetration_d9, aps_lavi.
Ladder: 51 rungs, 0..10000 ms every 200 ms.

| subject | mode | t (ms) | age (ms) | FX age (ms) | zoom | tick | file |
|---|---|---|---|---|---|---|---|
| `penetration_d9` | strike | 0 | 0 | 0 | 1 | 95 | `penetration_d9-strike-establish-after-z1.jpg` |
| `penetration_d9` | strike | 0 | 0 | 0 | 2.5 | 95 | `penetration_d9-strike-00000ms-after-z2.5.jpg` |
| `penetration_d9` | strike | 50 | 50 | 50 | 2.5 | 95 | `penetration_d9-strike-00050ms-after-z2.5.jpg` |
| `penetration_d9` | strike | 100 | 100 | 100 | 2.5 | 95 | `penetration_d9-strike-00100ms-after-z2.5.jpg` |
| `penetration_d9` | strike | 200 | 200 | 200 | 2.5 | 95 | `penetration_d9-strike-00200ms-after-z2.5.jpg` |
| `penetration_d9` | strike | 400 | 400 | 400 | 2.5 | 95 | `penetration_d9-strike-00400ms-after-z2.5.jpg` |
| `penetration_d9` | strike | 800 | 800 | 800 | 2.5 | 95 | `penetration_d9-strike-00800ms-after-z2.5.jpg` |
| `aps_lavi` | aps | 0 | 0 | 0 | 1 | 157 | `aps_lavi-aps-establish-after-z1.jpg` |
| `aps_lavi` | aps | 0 | 0 | 0 | 2.5 | 157 | `aps_lavi-aps-00000ms-after-z2.5.jpg` |
| `aps_lavi` | aps | 50 | 50 | 50 | 2.5 | 157 | `aps_lavi-aps-00050ms-after-z2.5.jpg` |
| `aps_lavi` | aps | 100 | 100 | 100 | 2.5 | 157 | `aps_lavi-aps-00100ms-after-z2.5.jpg` |
| `aps_lavi` | aps | 200 | 200 | 200 | 2.5 | 157 | `aps_lavi-aps-00200ms-after-z2.5.jpg` |
| `aps_lavi` | aps | 400 | 400 | 400 | 2.5 | 157 | `aps_lavi-aps-00400ms-after-z2.5.jpg` |
| `aps_lavi` | aps | 800 | 800 | 800 | 2.5 | 157 | `aps_lavi-aps-00800ms-after-z2.5.jpg` |

## Capture conditions

Every number in this sheet was taken under exactly these, and none of them is a default
left unexamined -- a first golden-diff run once read 6.5x high purely from screenshot
downscaling and a font-load race.

- machine: darwin-arm64, node v25.9.0
- GL backend: ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version)
- viewport: 1400x900, deviceScaleFactor 1, headless chromium
- map: `beit_sahwan_outskirts` sandbox, `&renderer=three`, dev server on :5191
- zooms: 1 establishing still (full frame), 2.5 ladder
  (600x400 crop, lifted 50 px)
- frame loop: frozen (FREEZE_FRAME_LOOP_SCRIPT); every ladder frame pumped by hand at 16 ms
- `step(1)` frame jump: 8.10 ms, measured at boot (see the module header)
- settle before the freeze: until 5 consecutive frames <= 150 ms at 320x200, ceiling 30000 ms (the default) -- per-group frames in the notes
- mode: full ladder

## Layer toggles (R-M)

A zero is a FAILURE here, not a note: a layer that resolves to no objects
produces a zero delta, and a check that passed on zero would read a deleted
layer as a healthy one. Floors are a third of the measured signal.

| subject | layer | available | votes | verdict | diff px | mean abs channel delta | note |
|---|---|---|---|---|---|---|---|

Floors in force:

- `decals`: pixel count does not gate this layer -- the tone column votes / 0.07 at the 2000 ms rung (a third of 0 px / 0.2092 over 3 runs)
- `blast-light`: 1750 px / 1.75 at the 200 ms rung (a third of 5169 px / 5.2263 over 3 runs)

## Notes

- beit_sahwan_outskirts||penetration_d9: settle reached 5 frames <= 150 ms after 47 ms and 5 frame(s); over the band: none; last 5: 8.4, 7.6, 9.1, 7.8, 8.9 ms
- beit_sahwan_outskirts||penetration_d9: step(1) advances the FX clock by 8.10 ms.
- penetration_d9: impact cannon_30 penetrated=true on tick 94 after 70 hand ticks, last round down 11 frame(s) of 16 ms later
- beit_sahwan_outskirts||aps_lavi: settle reached 5 frames <= 150 ms after 74 ms and 5 frame(s); over the band: none; last 5: 8.4, 24.9, 16.7, 7.5, 9.2 ms
- beit_sahwan_outskirts||aps_lavi: step(1) advances the FX clock by 4.10 ms.
- aps_lavi: aps on tick 156 after 134 hand ticks
