# PA-07: the held victory/defeat moment (as built)

This is the lead's ruling on the #485 mock (9 Oct): **B with A's band**.

[`sheet.jpg`](sheet.jpg) is shot from the built code on real First Light endings:

- victory at 5:00, by the playtest plan's orders;
- defeat at 4:30, on the evacuation deadline.

Each ending is shown at full motion and at reduced motion, at 0 / 0.5 / 1.5 / 3 s. The frames are real time on the live frame loop, taken within 8 ms of their mark; [`frames.txt`](frames.txt) has the readings. Capture: Metal, 1440x900, music off.

- **The beat.** The HUD steps back and letterbox bars slide in. The verdict ("Mission accomplished" / "Mission failed") lands on the full-width mission band in the lower bar, with a 3 px rule in `--good` or `--bad`. Under the band: the reward, or the failure reason in the report's defeat tone, then the closing and radio lines.
- **Camera and time.** The camera eases to the deciding ground over 1.8 s and zooms in 35%. Presentation time eases to 0.25x. The stinger plays at 0 s, the hold is unchanged (2.6 s), and then the report slides in from the right.
- **The sim.** The beat neither slows nor ticks it. The tick accumulator is held for the whole beat; `frames.txt` reads 6000 and 5400 at 0, 0.5 and 1.5 s. Only the renderer's frame clock is scaled.
- **Reduced motion.** A straight cut to the band, with no camera ease, no time slow and no entrance animation. The hold keeps its length, then the report follows.
- **Skip.** Escape, any key or a click skips to the report, as before.
- **Where the code is.**
  - `ui/outcome-beat.ts`: the pose, the camera, the focus rule, the beat-to-report hand-off and `hideForBeat`.
  - `ui/outcome-moment.ts`: the letterbox and the band.
  - `main.ts`: the frame-loop wiring.

  `.rl-outcome[data-outcome]` and `.rl-outcome__skip` are kept, so `pnpm ui:shots`' outcome guard finds the moment as before.
