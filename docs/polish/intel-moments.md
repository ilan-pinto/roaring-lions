# Intel ability moments (#113): mock for approval

Status: **mock. Nothing is built.** Waiting on the lead's decisions below.

`docs/polish/intel-moments/sheet.jpg` shows today and two directions side by side, for four
things: readiness, the sweep, the strike, and a strike that costs Conduct.

The issue asks for three things, "no fireworks":

- a charge timer the player can read;
- an announcement when a call is ready and when it fires;
- presentation only. The sim is not touched, and invariant 4 holds.

## How the sheet was made

- **Mission.** `umm_zeitoun_4_clearance`. It is the only mission that starts with enough intel
  for both calls (252). `umm_zeitoun_2_buildup` starts with 150.
- **Build.** A patched local build. A throwaway diff exposed `hud`, `minimap` and `production`
  on `__lions`, and added two taps: one on the tick's events and one on the support call.
  `main.ts` is back to `main`'s bytes.
- **Capture.** One Metal browser at 1920×1080, DPR 1. Music off through `musicOffInitScript()`.
  Own vite on port 5196, stopped by process group afterwards.
- **What is the game's own.** Every feed line, caption and minimap ring in the sheet is the
  HUD's own `note()`, `caption()` and `flash()`, so tiers, tones and the merge rule are real.
- **What is mock DOM.** The tile clock, the ring, the order-row chip and the footprint are DOM
  drawn only in theme tokens (`--info`, `--hot`, `--warn`, `--mark-edge`, `--halo`).
- **Cursor.** The sight is the canvas's own computed `cursor` image, drawn at the pointer,
  because a headless screenshot leaves the OS cursor out.
- **Frames.** Real time from the click. The "ready" frames fast-forward the sim with
  `__lions.step` until the intel crosses 150 (about 1,700 ticks), after the feed has emptied.
- **Scripts.** Throwaway and not committed.

## What the captures found (measured, not assumed)

1. **On most missions, the clock would never finish.** Intel accrues 8/min for a drone and
   5/min for each *holding* `mark_target` unit (`mission.ts:1066`). That includes every
   `inf_squad`.
   - Umm Zeitoun IV read **+25/min** with the force holding at the start, and +19 to +28 later.
   - 16 of the 18 missions with a dock start with 0 intel. A sweep there needs 150 ÷ rate:
     about 6 minutes with everyone holding and 19 minutes on a drone alone. Missions target
     5–7 minutes.
   - So on most missions an honest clock reads "6:22" and never completes. This is a sim-data
     question (Stage 4), listed below. The mock only makes it visible.
2. **What the sweep reveals is drawn nowhere.** The sweep on the depot identified 8 contacts:
   5 rifle squads, a recoilless, an ATGM cell and the rocket battery, with 4 civilians in the
   circle. None of them appears in the world or on the minimap.
   - The renderer skips any hostile the player does not observe (`ThreeRenderer.ts`, the
     contact-mark loop), and the minimap uses the same fog rule.
   - Today the only trace anywhere is the debug overlay's roll feed. The readout is the only
     place the player learns what 150 intel bought.
3. **The strike on the west crest hit 4 rifle squads, killed none and pinned none.** The
   readout has to handle "hit, nothing down" without inflating it. The lethality is a balance
   question and out of scope.
4. **The costly strike is already priced, loudly.** In the depot yard, 2 porters were killed
   and Conduct fell by 19. The existing ROE lines ("Civilians killed −8 · Conduct 89", twice)
   and the announcer's "Check your fire." both fire on the impact tick. A readout that repeats
   the Conduct number says it a third time.
5. **Today's moment of use** is these four things:
   - "X armed — click the map to place it";
   - "X called on (33, 10)", grid coordinates no player reads;
   - the lime order-marker rings at the target;
   - the impact VFX.

   Then nothing. The tile dims until the intel is back, with no clock.

## The two directions

| | A — the tile keeps the clock | B — two places, one clock |
|---|---|---|
| **Readiness** | Build-bar language on the support tile: a 3 px `--info` bar filling toward the cost, m:ss in the corner. The strip gains `+25/min` beside intel, as logistics already has. | A ring round the tile's glyph, plus the same ring as two chips in the order row ("Sweep 1:39", "Strike ready"). Same strip rate. |
| **Ready** | Tile border lights for 1.6 s. Minor feed line "Satellite sweep ready". Announcer "Sweep is up." | The same, with an important feed line. The chip flips to "ready". |
| **Aim** | Today's sight only. | A footprint under the armed cursor: the sweep's 7.7-tile circle (`--info`, dashed) or the strike's 2-tile splash (`--hot`, dashed). It goes on the click. |
| **Call** | "Precision strike inbound — 3 s" or "Satellite sweep on the way" replaces "called on (x, y)". Announcer "Strike inbound. Three seconds." Minimap: important ring, warn for a strike and info for a sweep. | The line without the "3 s": the strike chip counts "impact 3 · 2 · 1" instead. Minimap: a major ring for the strike. |
| **Result** | One line, 0.7 s after the impact: "Sweep: 8 contacts identified" (info), "Strike: 4 hit" (warn), or "Strike: 1 hit · building hit · 2 civilians killed" (bad). | A major line plus a minor breakdown: "5 sarim rifles · 1 recoilless team · 1 atgm cell · 1 rocket battery · 4 civilians in the area" / "no civilians in the blast". A caption ("Eight contacts marked.", "Rounds complete."). A minor info ring on the minimap at each identified contact. |

Neither direction adds a sound beyond the voice line, a shake, or anything that stays in the
world after the moment.

## Decisions for the lead

1. **Intel rate in the strip** (`+25/min`), both directions.
   - It can be derived in `app` from intel deltas over about 20 s, which is read-only and safe
     for invariant 4.
   - A runtime getter would be tidier, but it is a `packages/sim` change, so it is listed for
     Stage 4.
2. **Where the clock lives.** A: the tile alone. B: the tile plus order-row chips.
   - **Recommend A.** The order row exists only while something is selected, so the chips
     vanish with the selection.
   - The chips would also put two company assets in a row that #427 built for the selected
     units' own orders.
   - The dock is on screen for the whole mission.
3. **Clock format.** At the live rate, m:ss jitters by about a minute as units start and stop:
   5:17, 6:25 and 5:23 within 3 s in the chip strip.
   - **Propose:** m:ss under 2:00; "~6 min" rounded above that; "—" when the rate is 0 (no
     drone, everyone moving).
4. **Charging look.** Do not dim the whole tile: the bar and clock would dim with it, the
   defect the build bar already fixed. Dim the glyph and word to 0.5, and keep the bar and
   clock at full strength.
5. **Ready moment.**
   - The border lights for 1.6 s.
   - A feed line, minor (A) or important (B).
   - One announcer line.
   - **Recommend minor:** it is good news the player is waiting for, not an alarm.
6. **Footprint under the armed cursor** (B). It is an order preview rather than a status mark,
   but it is new in the world, so it is the lead's call.
   - **Recommend the strike footprint only.** It shows whose building is inside the splash,
     which is the restraint pillar doing its job.
   - Skip the sweep's 15-tile circle across the board.
7. **Call line.** Replace "called on (x, y)" with "inbound — 3 s" or "on the way" (A). The
   chip countdown (B) only works with decision 2 = B.
8. **Minimap call ping.** Important for both calls, info for the sweep and warn for the strike.
   - **Recommend against B's major ring for the strike**: the player called it, so it is not
     news to him.
9. **Sweep readout.** Because of finding 2, **recommend B's**: the major line, the breakdown,
   and a transient ring on each identified contact.
   - Without it, the sweep shows the player nothing at all.
   - The rings are 1 s marks on the minimap only, never in the world.
10. **Strike readout.** **Recommend A's single line**:
    - "4 hit", "1 down · 3 hit", "no effect";
    - amber (`warn`), never lime, because lime reads as a win;
    - `bad` when a civilian is killed.

    Name civilians only when it is non-zero. Saying "no civilians in the blast" after every
    strike (B) is reassurance that can turn into a reward. That is the lead's call.
11. **Never repeat the Conduct number in the readout.** The ROE lines on the same tick price it.
12. **New announcer rows** in `data/audio.json` `voices.announcements`, caption-only until the
    lead records them (`he.common.announce_<event>`):

    | event | caption | priority | cooldown |
    |---|---|---|---|
    | `support_ready` | "Sweep is up." / "Strike package ready." | normal | 20 s |
    | `support_inbound` | "Sweep requested." / "Strike inbound. Three seconds." | high | 2 s |
    | `sweep_result` (B only) | "{n} contacts marked." | low | 4 s |
    | `strike_result` (B only) | "Rounds complete." | low | 4 s |

    A result line at `low` is silenced by the hold after "Check your fire.", which is the
    order wanted in the costly case.

## Recommendation

**A as the base, plus two pieces from B:**

- From A: the tile clock with the strip rate, one call line, one minimap ping at the target,
  and a one-line strike readout.
- From B: the strike footprint (decision 6), and the sweep breakdown with per-contact minimap
  rings (decision 9), because the sweep otherwise shows nothing.

Leave out the order-row chips, major-tier lines, result captions and the impact countdown
chip. With this set, the player gets four things per call: the call is announced once, the
wait is readable, the strike's reach is shown before it lands, and the result is said once,
in the feed.

## Not this lane (listed for Stage 4)

- **Intel economy (finding 1).** Without `intel_start`, no mission reaches a sweep inside its
  5–7 minutes unless the whole force holds still. The fix is either more missions with
  `intel_start`, or the rates.
- **Strike lethality against squads (finding 3).** STRIKE_DAMAGE 600 hit four rifle squads and
  put none down.
- **Read-only intel rate.** An `intelPerMin` on `MissionRuntime`, if deriving it in `app` is not
  wanted (decision 1).
