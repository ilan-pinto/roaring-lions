# PA-07: the held victory/defeat moment (mock)

**Status:** mock for the lead. Nothing here ships. [`sheet.jpg`](sheet.jpg) shows today and three directions, each on a real First Light ending, at 0 / 0.5 / 1.5 / 3 s.

- **Victory, 5:00.** The playtest plan's own orders (`playtest.ts`, `beit_sahwan_breach`).
- **Defeat, 4:30.** The passive control, which loses on the evacuation deadline. That is a real loss with a real reason line. No `debugKill` was needed.
- **Build.** A patched local build ([`prototype.patch`](prototype.patch): `ui/outcome-beat-mock.ts`, a 20-line switch in `main.ts` on `?outcomeMock=A|B|C`, and the capture harness). 1440x900, Metal, music off.
- **Frame timing.** The A/B/C frames are exact: the harness seeks the beat's clock and the sim by the ticks owed. The "today" row is real time, ±3 ms.

## What is held constant

- **One name per outcome.** The beat says what the report's band already says: `outcome.victory` "Mission accomplished" and `outcome.defeat` "Mission failed" (#425). The moment adds no new word and no new string. Every line is a catalogue key or mission data.
- **The cue.** It is today's `OUTCOME_CUE` stinger at 0 s. `victory_01`/`defeat_01` are both 2.45 s long and peak at 0, so every direction lands the verdict inside `--dur-stamp` (240 ms) and hands to the report as the stinger decays (2.45 to 2.85 s). Today's hold is 2.6 s, so the length barely moves.
- **Colour.** The band is `--band-mission` for both outcomes, as on the report (VR-24: a defeat never borrows the alert band). The outcome shows in the word and in a 3 px rule: `--good` for victory, `--bad` for defeat. Credits are `--commend`, the reason is `--bad-text`. No new token.
- **Skip.** Any key or click skips, as today (`outcome-moment.ts` rules 1 to 4).

## The three directions

| | A: Stamp | B: Held beat | C: Dispatch |
|---|---|---|---|
| World | dims under a 55% scrim | stays lit; **time eases to 0.25x** in 300 ms; **camera eases to the deciding ground** (1.8 s, +35% zoom) | desaturates and darkens over 1.5 s, at full speed |
| HUD | fades out (300 ms) | fades out (300 ms); a 9 vh / 15 vh letterbox slides in | fades out (400 ms) |
| Verdict | full-width band at 38% height, display face at up to 7 rem, slams in (scale 1.25 to 1) | in the lower letterbox bar, display face at up to 5 rem | the report's own panel band, dropped from the top at 12 vh |
| Under it | mission · clock · credits (or the reason), then the closing line | mission · clock · credits (or the reason) | credits or reason, then the closing line, unfolding |
| Hand-off | the stamp lifts, the report rises 6 vh | the bars open, the report slides in from the right | the band is replaced in place by the report's band |

## Recommendation: B, the held beat

It is the only direction where the **ground** stays the subject. The mission was about the compound, and B ends looking at it rather than at a card. It also answers §22's "abrupt transitions" with continuous motion: time, camera and HUD all ease, and nothing cuts.

A reads loudest but hides the world behind a second scrim just before the report brings its own. C is the quietest, and its band-becomes-report hand-off is elegant, but the desaturated world reads as "paused", not "won".

B ships with these rules:

- **Focus.** Victory: the zone of the last primary to complete; if it has no zone, the zone a primary targets (First Light: `compound`); else the centroid of the living force. Defeat: the failed primary's zone; for `evacuate_before`, the uncounted civilian nearest its target (as shot: the family at 15,18); for "every unit lost", where the last unit fell.
- **Time.** Time scales through `gameSpeed`, the wall-clock accumulator, never the tick (invariant 1). The result is already decided, and the ledger is written before the moment mounts (unchanged).
- **Reduced motion.** The bars and the verdict stay. The camera holds, nothing zooms, and time stays at 1x. The 2.45 s length does not shrink, as today's rule 1 already requires.
- **Lead decision B-1.** Should the verdict in the bar sit on A's olive band (the brief's "mission band colour"), or stay as `--good`/`--bad` display type on the bar, as shot? The mock shows type. The band is a one-rule change.
- **Gates.** No gated golden scenario reaches a mission end. `ui:shots`' `25-outcome-defeat` / `outcome-guard.ts` look for `.rl-outcome`, so the build keeps that class on the new root.

**Reproduce:** `git apply docs/polish/outcome-moment/prototype.patch`, then `cd tools && npx tsx src/ui-review/mock/outcome-beat-captures.ts --out=<dir>` (port 5233; one Metal browser), then `python3 src/ui-review/mock/sheet.py`. `packages/app` typechecks with the patch applied. The patch is a prototype, not lint-clean.
