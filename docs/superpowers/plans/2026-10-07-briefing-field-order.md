# Plan: briefing, deploy and debrief, Field order (GH-417)

The lead ruled on 7 Oct: direction **A, "Field order"**, with B's map pins. The
PM ruled L-2 to L-8 as recommended in
`docs/superpowers/specs/2026-10-07-briefing-debrief-directions.md` (PR #430):

- L-2: capture the ground live during the briefing.
- L-3: derive "at a glance" from existing mission data.
- L-4: per-slot counts on deploy. The brigade total already lives on the Brigade
  screen (`garage.brigade`).
- L-6: an app-side event log.
- L-7: fold the end panel into the after-action report.
- L-8: show attached units.

The small layout fixes (B-01 to B-04) landed separately as PR #439.

This plan is presentation only: no change under `packages/sim`. Every string goes
through `t()` and every colour is a semantic token. Each task gets a review
before the next one depends on it.

## Tasks

1. **Glance model** (`ui/briefing-glance.ts`, pure, with tests). Derives the
   five rows from data the mission already declares:
   - **Where:** map name · time of day · target minutes.
   - **What happened:** the first beat of the Situation section, or else of the
     briefing.
   - **Objective:** the first primary, plus "and N more".
   - **What matters:** the star rules, i.e. the Conduct floor for ★★ and the
     carrying secondaries for ★★★.
   - **Avoid:** flagged ROE zones by place name, the Conduct fail line, and
     deadline objectives.

   A row with nothing to say is omitted rather than padded.
2. **Ground marks** (`ui/ground-marks.ts`, pure, plus `ui/ground-overlay.ts`, an
   SVG in tile units drawn with tokens only). Marks:
   - the player's start;
   - objective target zones, labelled with their objective and clock;
   - evacuation and refuge zones;
   - flagged no-fire zones, labelled with their place name.

   **No hostile positions and no wave origins.** A briefing must not hand out
   intel that recon missions exist to find, or spoil a trigger.
3. **Live ground photograph.** `LoadingScreen.setGroundPhoto(img)` swaps the
   painted preview for the renderer's `captureGroundAlbedo` once the art gate
   settles. Rows are flipped with `minimap.ts`'s `flipRows`. The painted tiles
   stay as the instant placeholder and as the Pixi path. The marks overlay both.
4. **Field-order layout.** A head bar (deploying label, name, meta, progress, back)
   over two columns:
   - left: the commander's line, the glance card, the objectives (tagged by kind
     and clock), and "Full orders", the beats and sections in a disclosure;
   - right: the ground and its legend.

   The force bar sits at the bottom with Deploy at its end. The reachability
   instrument from #439 (`briefing-reach.ts`) must stay green at 1400, 1920 and
   2560.
5. **Force bar.** One slot per demanded body, holding the body
   `defaultSelection` picks, built on `deploy-select.ts`'s unchanged rules.
   - Each slot shows the unit portrait, name, stars, record and the veteran
     effect (`VET_ACC_BONUS` / `VET_SUPP_BONUS`, copied and pinned against
     `tuning.ts` as text), plus "⇄ N", the other bodies of its type.
   - Clicking a slot opens the bench drawer, ranked by stripes, then missions,
     then kills, then pool order. Unrecorded bodies collapse to one line.
   - Attached (non-ledger) placements appear as fixed cards.
   - The global reserve line is removed.
6. **Mission log** (`mission-log.ts`, app-side, pure reducer with tests), fed from
   `main.ts`'s existing event loop. It records:
   - friendly losses, with name or type, tile and tick;
   - Conduct deductions, with tile when the reason names a zone;
   - objective outcomes with ticks;
   - the enemy kill count.

   It reads sim state only, never writes it.
7. **After-action model** (`ui/after-action.ts`, pure, with tests). Turns the
   debrief options and the log into:
   - the verdict and its reason;
   - the star ladder (the `starsFor` rules);
   - three lists: Done well, Cost you, What changed.

   Losses are listed by name, and promotions by name (the roster diff). Unlocks
   say "can now be bought in the garage". A defeat says that nothing was written
   to the campaign.
8. **After-action view and the fold.** `debrief.ts` becomes the report, and
   `main.ts` goes from the outcome moment straight to it; the end panel's speaker
   line and aftermath move into the verdict band.
   - Layout: the band, the ladder, the ground with pins (losses and deductions),
     the three columns, and the nav with one primary action.
   - An opaque backdrop covers the live HUD.
   - Keyboard: focus starts on the primary action, and a held Enter does not
     count. This follows #434's behaviour and reuses `mountEndPanel` once that
     PR lands.
9. **Tools and captures.** Update `ui:shots`' end and debrief steps (its
   `.rl-endnav__debrief` click goes away). Take before and after captures at
   1400, 1920 and 2560 into `docs/polish/after/h-field/`. Run the full gate set.

## Reviews

Each task gets a fresh review agent over its diff, its tests and this plan. The
review looks for correctness, strings outside `t()`, colour literals, checks that
cannot fail, and invariant 4. Findings are fixed before the task is ticked.
