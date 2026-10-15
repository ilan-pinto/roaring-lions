# Intel ability moments (GH-113): as built

> **2026-10-15 (S-F, F-Q11):** the strip's intel `+N/min` and the support tile's clock described
> below are retired. Intel is earned in lumps by doing now (F1), so the strip shows the last
> earn ("+30 high ground") for 30 s instead, and the feed gets one line per identification and
> one for a high ground rise. Logistics keeps its own `+N/min`. The rest of this page is as built
> on 2026-10-11.

Status: **approved by the lead on 2026-10-11 and built.** The approved set is direction A of
the mock, plus two pieces of direction B: the strike footprint while aiming, and the sweep
breakdown with a minimap ring per contact. The mock's sheet and its full note are on draft
PR #522, closed in favour of this one.

`docs/polish/intel-moments/sheet.jpg` puts the built UI beside `main`, row by row, for four
moments: readiness, the sweep, the strike, and a strike that costs Conduct. It was shot on
Umm Zeitoun IV:

- 1920×1080, in one Metal browser on its own port (5197), with music off;
- real clicks on the dock and the map, with no hooks added;
- a sim fast-forward through `__lions.step` for the "ready again" frame.

## What shipped

| | |
|---|---|
| **Readiness** | Each support tile gets a 3 px `--info` charge bar and a clock in its corner, the build bar's own language. The clock reads m:ss under 2:00, `~N min` above, and `—` when no intel is coming in. While charging, the tile keeps full strength: only the glyph and word dim, so the bar and clock never dim with them. The strip shows `+N/min` beside intel, as it already does for logistics. The tile's accessible name says when the call is ready. |
| **Ready** | The tile border lights for 1.6 s, and the feed gets one minor line ("Drone sweep ready"). The announcer says `sweep_ready` / `strike_ready` ("Sweep is up." / "Strike package ready."). |
| **Aim** | While a call is armed, its footprint is drawn on the ground under the cursor as a dashed `vfx.fire` ring over the world halo (`Renderer.aimFootprint`): the strike 2.0 tiles, the barrage 2.5, the smoke screen 4.5. It is static and disappears the frame the call is spent or cancelled. The drone sweep draws no footprint. *(S-F, 2026-10-15: the barrage and smoke screen join the strike; before it only the strike drew a ring.)* |
| **Call** | "Precision strike inbound — 3 s" / "Drone sweep on the way" replaces "called on (x, y)". The announcer says `strike_inbound` / `sweep_inbound` at high priority. The minimap shows an important ring at the target: warn for a strike, info for a sweep. *(S-F, 2026-10-15: the barrage has its own inbound line, "Mortar barrage inbound — N s", and the smoke screen "Smoke screen inbound — N s".)* |
| **Sweep result** | A major line, "Drone sweep — 8 contacts identified", where the count is the sim's own `revealed` count. A minor breakdown line follows: "Sarim Rifles ×5 · ATGM Cell · Recoilless Team · Rocket Battery · 4 civilians in the area". The minimap gets a minor info ring on every contact identified. |
| **Strike result** | One line 0.7 s after the round, on the sim clock, saying what the splash hit: "Strike: 4 hit", "1 down · 3 hit" or "no effect". It is amber, and `--bad` when a civilian is killed, with civilians named only when non-zero. Conduct is never repeated: the ROE lines on the same tick already price it.  *(S-F, 2026-10-15: the barrage gets one such readout, "Barrage: …", after its sixth round, in the same words; the smoke screen has no readout.)* |

Nothing else was added to the world. There is no sound beyond the voice lines, and the four
announcements are caption-only until the lead records them.

## The answers to the mock's twelve decisions

Each decision took the mock's recommendation:

1. The rate is measured in `app` from the runtime's floored intel, by timing its integer
   crossings. It is never re-derived from the sim's accrual rule.
2. The clock lives on the tile alone, with no order-row chips.
3. m:ss under 2:00, `~N min` above, `—` at zero.
4. While charging, the glyph and word dim; the bar and clock stay at full strength.
5. Ready is a minor feed line.
6. Only the strike gets a footprint.
7. "inbound — 3 s" and "on the way" replace the grid coordinates.
8. Both call pings are important tier.
9. The sweep readout uses B's lines and rings.
10. The strike readout is A's single amber line.
11. No Conduct number appears in any readout.
12. Two announcer rows per call (ready, inbound), with no result line.

**Reduced motion:** a minimap alert ring now holds one radius for its whole life and only
fades. A ring that would settle inward holds near its small end, and one that would spread
outward holds at its large end, so the second channel beside colour (GH-461) survives as size.
The footprint and the ready border were already static.

## The numbers it depends on

`ui/intel-moments.ts` copies `SWEEP_RADIUS_SQ`, `STRIKE_SPLASH` and `STRIKE_DELAY_TICKS` from
`tuning.ts` rather than importing them, which keeps the sim package untouched.
`intel-moments.test.ts` reads `tuning.ts` as text and fails if any of them drifts.

## Listed for Stage 4 (sim data, not this lane)

1. **Intel economy.** 16 of the 18 dock missions start with 0 intel. Income is 8/min for a
   drone plus 5/min for each holding `mark_target` unit, which measured +19 to +28 on Umm
   Zeitoun IV. At those rates a sweep needs 6 to 19 minutes, against 5–7 minute missions, so on
   most missions the new clock reads `~6 min` or more and never completes. The fix is either
   `intel_start` on more missions or higher rates.
2. **Strike lethality against squads.** STRIKE_DAMAGE 600 hit four rifle squads on the west
   crest and put none down.
3. **A read-only `intelPerMin` on `MissionRuntime`**, if measuring the rate in `app` is ever
   not wanted. It would be a `packages/sim` change.
