# PA-24: First Light's dawn fill (mock)

**Status:** mock for the lead (L3). Nothing here ships. [`sheet.jpg`](sheet.jpg) shows `beit_sahwan_breach` at the shipped dawn and under three lifted lights. Each light is shot at the same two instants: tick 300, with the force in the compound, and tick 3600, mid-fight on the playtest plan's orders. The crops are 1:1 at zoom 1, with rings and HUD off, because the acceptance test is "units read without their rings".

**How it was made.** Each option was applied to the live, shipped renderer: the hemisphere (fill) intensity, `sun.shadow.intensity` (three r170), and the haze re-derived from the new lights exactly as `applyHaze` does for a preset. Each frame was then repainted at zero elapsed time, so all four options are one instant. Every frame was also taken with the `units` debug layer hidden, which isolates the unit pixels and the ground under them.

**Tools.** The harness is `tools/src/ui-review/mock/dawn-fill-captures.ts` and the measurement is `dawn_measure.py`, both in [`../outcome-moment/prototype.patch`](../outcome-moment/prototype.patch). The raw numbers are in [`numbers.json`](numbers.json). The capture was Metal, 1440x900.

## Numbers

Luma 0–255, given as tick 300 / tick 3600. "In shade" means unit pixels standing where the shipped dawn leaves the ground below luma 70.

| Option | Fill (hemi) | Sun shadow | Unit contrast in shade | In-shade unit px ≥ 20 luma | Unit luma median | Shaded ground p10 | Highlights p90 | Frame mean |
|---|---|---|---|---|---|---|---|---|
| shipped dawn | 0.75 | 1.0 | 29.0 / 21.8 | 0.65 / 0.44 | 34.8 / 56.1 | 48.3 / 49.1 | 109.7 / 111.0 | 52.7 / 57.5 |
| fill 1.00 | 1.00 | 1.0 | 34.5 / 28.2 | 0.67 / 0.59 | 39.5 / 70.0 | 57.6 / 58.2 | 119.2 / 120.4 | 58.5 / 63.4 |
| fill 1.25 | 1.25 | 1.0 | 39.3 / 32.6 | 0.67 / 0.62 | 43.6 / 82.2 | 65.8 / 66.1 | 127.3 / 128.9 | 63.9 / 68.9 |
| **fill 0.90 + shadow 0.70** | 0.90 (day's) | 0.70 | **39.2 / 34.1** | **0.67 / 0.63** | 39.3 / 81.3 | 59.5 / 59.3 | **115.5 / 116.7** | 56.9 / 61.7 |

## Recommendation: fill 0.90 + shadow 0.70, for First Light only

It buys the same in-shade gain as fill 1.25: +10 / +12 luma of unit-against-ground contrast, and in-shade unit pixels that read rise from 0.44 to 0.63 mid-fight. But it lifts the highlights by +6 rather than +18, and the frame mean by +4 rather than +11.

The low warm sun, the long wall shadows and the dawn haze all stay; the shadows are only less black. Fill 1.25 reads as a hazy midday. Fill 1.00 is too little: mid-fight it moves in-shade contrast by only +6.

Over the whole compound, unit-against-ground contrast barely moves under any option (66 / 51 shipped, against 63 to 71 / 46 to 52). The defect is local to wall shade, which is exactly where this option acts.

**How to build it:** add an optional, presentation-only light override to the mission's `map` block, beside `time_of_day`, for example `"light": { "fill": 0.9, "shadow": 0.7 }`.

- The app reads it the way `timeOfDayOf` reads `time_of_day` and hands it to `RendererOptions`.
- `presetLights` takes the fill, `createSceneLights` sets `sun.shadow.intensity`, and `applyHaze` already follows the lights.
- No sim type changes (R-12 keeps the sim out of light), and no global change to the `dawn` preset.

That is the only dawn mission today. A preset edit would also bind every future dawn mission, which the brief rules out. No gated golden scenario uses this mission, so there is no bless.

**What this does not fix:** the darkest ground in the audit's [play-22](../before/play-22-alert-stack-broken-jeep.jpg) and [play-23](../before/play-23-first-light-late-fight.jpg) is the fog-of-war shroud around the compound, not the dawn light, and no light setting touches it. A lifted fill makes the compound read; it will not make the shroud lighter.
