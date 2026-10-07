# Briefing, deploy and debrief: audit and directions (GH-417)

Polish lane pass H: H1 briefing, H2 deployment, H4 mission end, H5 debrief.
This is a mock checkpoint. **No app code changes.** Nothing gets built until the
lead picks a direction and answers the decisions at the end.

- **Mock:** `docs/superpowers/mocks/2026-10-07-briefing-debrief.html`. Open it
  from the checkout so the relative font, portrait and ground paths resolve.
- **Mock screenshots** (1400 × 900 each), in
  `docs/superpowers/mocks/2026-10-07-briefing-debrief/`:
  `mock-a1.jpg` (A briefing and deploy), `mock-a1b.jpg` (A bench drawer),
  `mock-a2.jpg` (A debrief, victory), `mock-a3.jpg` (A debrief, defeat),
  `mock-b1.jpg`, `mock-b2.jpg` (B), `mock-c1.jpg`, `mock-c2.jpg`, `mock-c3.jpg` (C).
- **Audit captures** (before): `docs/polish/before/h/`, the briefing,
  end panel, defeat debrief and victory debrief at 1400, 1920 and 2560.

## WORK PACKAGE: H-MOCK (GH-417)

**Changed.** Docs only. One audit with measurements, one static mock with three
directions, nine screenshots, two reference photographs (the lit ground of
`wadi_halam_5` and a field frame), and twelve before captures.

**Why.** The lead's screenshot of `/mission/wadi_halam_5_depot` showed a broken
briefing. The audit confirms it, and finds that two of the defects are worse than
they look (B-01, B-02).

**Player-visible improvement.** None yet. This is the mock checkpoint.

**Tests.** None apply to a doc-only change. `validate:ui`, `validate:data` and
`lint` were run and are green on this tree. `validate:ui` scans
`packages/app/src` only, so the `--rl-*` hex block in the mock is outside it, as
in #364's mock.

**Visual evidence.** Listed above.

**Known remaining issues.** See "Decisions for the lead".

**Next priority.** Build the chosen direction behind `ui:shots`' existing
`05-briefing`, `16-end-defeat` and `17-debrief` shots. The first commit is the
P0 layout fix (B-01), which is independent of the direction.

## Capture conditions

- Worktree at `origin/main` 62a7f3d3, `vite` dev server on its own port.
- One headless Chromium, ANGLE/Metal (`gpuLaunchArgs('metal')`), music off
  (`musicOffInitScript`).
- The mission is `wadi_halam_5_depot`. The ledger was seeded with a 125-entry
  cumulative roster: 33 bodies of the four demanded types, some named with
  stripes, plus 92 of other types. This reproduces the lead's "119 in reserve"
  (the seed reads 120).
- Briefing: a fresh page load at each resolution, measured 0.5 s after mount and
  again after 7 s.
- End panel and defeat debrief: deploy, then `debugKill` every unit, captured at
  1920, then resized to 1400 and 2560.
- **Victory debrief: harness-injected.** No scripted plan wins this mission, so the
  shipped `showDebrief` was imported and called with realistic Wadi Halam V
  options over the same field. The "MISSION FAILED" text behind it in those three
  captures is the defeat it was injected over. That text is not a defect.

## Audit

Priorities follow the polish plan §2: player impact × frequency × visibility.
IDs are local to this pass (B = briefing and deploy, D = end and debrief), with
the PA rows they extend.

### Briefing and deploy (H1, H2)

| ID | Problem | Measured | Player impact | Pri |
|---|---|---|---|---|
| B-01 | **The top of the screen cannot be reached.** `.rl-loading` is `display:flex; align-items:center; overflow:auto`. When the box is taller than the viewport, centring pushes its top into negative overflow, which no scroll reaches. The `deploy.focus()` scroll (PA-13) adds to it. | Box height 1160 / 1464 / 1780 px against viewports of 900 / 1080 / 1440. Title top **−210 / −211 / −136 px**, portrait top −119 / −107 / −11 px, and the container already scrolled 104 / 47 / 0 px. Same at 0.5 s and at 7 s. | The mission name, the "deploying" label and the commander's face are cut off and unreachable at every size, on every mission with a long briefing. It looks broken on the first screen after Start. | **P0** |
| B-02 | **The primary action is below the fold.** | Deploy top at 838 px (1400, visible), **1123 px at 1920 and 1488 px at 2560** (off screen). | At the two most common desktop sizes, the one thing to do is not on screen. | **P1** |
| B-03 | **Execution is overlapped by the Objectives bar.** The beats sit in a nested scroll box (`max-height: min(42vh, 27.5rem)`), and its hard cut lands flush on the objectives header. | "Notes" heading at 901 px (1400) and 997 px (1920), hidden inside the box. | Reads as a layout collision, and hides that more text exists. | **P1** |
| B-04 | **Objectives read "In progress" before the mission starts.** The HUD's objectives panel is reused with live status labels. | 4 of 4 rows at every size. | Says the clock is running when it is not, and buries the useful part (primary, optional, timed, carries). | **P1** |
| B-05 | **"120 in reserve".** The deploy spread prints `eligible + undrawable − chosen`: the whole cumulative pool minus the five fielded. | 120 with the seed, 119 for the lead. | A number the player cannot act on, and it reads like a bug. See "Roster and reserve". | **P1** |
| B-06 | **The force is a spreadsheet.** One toggle row per body of a demanded type in a small scroll box. "Force assigned" is the header shown while the list is scrolled away. Dimmed rows are unexplained (PA-26). | 33 rows: 1,813 / 2,087 / 2,498 px of content in a 306 / 367 / 448 px box. | H2 fails: no slots, no roles, no consequences. Choosing means scrolling a list. | **P1** |
| B-07 | **The ground map is a flat pastel tile painting** (`map-preview.ts`, one palette pixel per tile). It is a different visual language from the lit 3D world, and nothing is marked on it: no start, objective, no-fire zone, routes or threats. | Wadi Halam reads as light green blocks. | It does not answer "where" or "what to avoid", which is its whole job. | **P1** |
| B-08 | **Flat hierarchy.** Situation, Mission, Execution and Notes are 11 px labels over equal-weight prose. Nothing gives the answer at a glance, and mono and display type are mixed with no rule (PA-22). | — | H1 fails: where, what happened, the objective, what matters and what to avoid are spread through four paragraphs. | **P1** |
| B-09 | **Empty margin beside the portrait.** The rank and plate sit alone to the right of a 200 × 250 face, leaving a 400–600 px void. The image slot (a sand-ground still) sits beside the force on a green map. | — | Looks unfinished, and the two pictures disagree about the ground. | **P2** |
| B-10 | **Attached units are invisible.** Non-ledger placements (the D9, engineers, jeep) never appear on the deploy screen. | — | The D9 is the mission's key unit, and the player meets it for the first time in the field. | **P2** |
| B-11 | **Veteran stripes show no consequence.** Stars and records are shown, but not what a stripe does (`VET_ACC_BONUS` +6% aim, `VET_SUPP_BONUS` −8% suppression per level). | — | The choice has no visible stakes (H2, H6). | **P2** |
| B-12 | **"What you brought · Conduct 88"** is a lone line under an orphaned header (PA-26). | — | Noise beside the decision. | **P3** |

### End panel and debrief (H4, H5)

| ID | Problem | Measured | Player impact | Pri |
|---|---|---|---|---|
| D-01 | **The end panel and debrief sit on a live HUD.** The radio quote shows through and beside the debrief, feed lines ("lost — Combat Engineers") collide with the end panel, and the dock, objective strip and hint line all stay up (PA-21). | Every size; worst at 1400. | The result moment is cluttered. Text overlaps text. | **P1** |
| D-02 | **The debrief does not answer "well / poorly / changed".** It is one flat grid: Conduct, Time, Lost, By name, Replaced, Marked, Promoted. The deductions table, secondaries and unlocks follow ungrouped. | — | H5 fails. The player has to work out the story. | **P1** |
| D-03 | **Stars without their rule.** ★★ is shown, but not what earned each star or what the third needs (`grade.ts` `starsFor`: a win; Conduct at `fail_below + 20`; every carrying secondary). | — | No reason to replay, and no lesson. | **P1** |
| D-04 | **A defeat debrief gives no reason.** The reason appears only on the end panel ("Every unit lost · 0:04"). The debrief shows Conduct, Time and Lost, plus "Nineteen still out." with no explanation. | — | "Why did I lose" is unanswered on the screen meant to answer it. | **P1** |
| D-05 | **Losses as types,** wrapping to two lines at 1400 ("Eitan APC ×1, Namer IFV ×1, Rifle Squad ×2, …"). Named losses are a separate row (PA-28). | — | Veterans stop being people at the moment it matters (H6). | **P2** |
| D-06 | **"X available"** unlock lines read as granted, not as buyable (PA-21). | — | A false promise about the next mission's force. | **P2** |
| D-07 | **Type scale.** The debrief body is 12 px at 1400 (13.8 px at 1920) in a 720 px panel. "+180 credits" is the loudest thing on it. The title repeats as band plus tier line. | — | The wrong thing reads first. | **P2** |
| D-08 | **Navigation.** Lower-case equal buttons ("next: …", "replay", "campaign map", "menu"), with no primary (PA-22). | — | No obvious next action. | **P2** |
| D-09 | **Four copies of the outcome at once** on the end screen: the strip's red "MISSION FAILED", the centre title, the feed line and the panel band (PA-07). | 2560 capture. | The moment reads as noise rather than a verdict. | **P2** |
| D-10 | "Marked 0" shown on a mission with no recon, and the withdrew line set dim. | — | Minor noise. | **P3** |

## The three directions

All three share the fixes that do not depend on taste:

- no nested scroll and no off-screen top;
- objectives labelled by kind and clock;
- a slot-based force;
- the lit ground with markings;
- one primary action;
- the after-action report replacing the flat grid.

- **A, Field order (recommended).** An operation order on one sheet. On the left,
  the commander's line, a five-row "at a glance" card (Where, What happened,
  Objective, What matters, Avoid) and the objectives. On the right, the lit ground
  with intent drawn on it. Along the bottom, the force as slots with the one
  primary action at the end. The full briefing is one click away as a panel over
  the map. The debrief is an after-action report: a verdict band with its reason, a
  star ladder, then three fixed columns (Done well, Cost you, What changed). The
  defeat uses the same layout.
- **B, Map table.** The ground is the screen. The orders and the force float over
  it as commander-HUD panels (#364), in the dock's tile grammar. Objectives,
  threats and the no-fire zone are pinned in place. The debrief returns to the
  table and pins where people were lost and where Conduct was spent. It looks the
  best, but needs per-map framing, pin collision handling and an app-side position
  log.
- **C, Dossier.** Two steps. Orders: a full-height portrait with the beats as the
  commander's speech. Force: one column per demanded type, plus a "what rides on
  it" panel. The debrief is a roll call of the people. It reads best and is the
  most H6-forward, but adds a click before every mission. It fits best if pass F
  voices the beats.

**Why A.** It is the only one of the three that answers all five H1 questions and
the H2 decision on one 1400 × 900 screen, with no scroll anywhere. It also reuses
the most shipped parts:

- `objectivesPanel`, with a pre-mission status mode;
- the unit portraits;
- `deploy-select.ts`'s selection rules, unchanged;
- `roster-cap.ts`'s `rosterOrder` for the bench;
- the minimap's ground photograph.

B's pins can join A's ground view later at no layout cost.

**"At a glance" needs no authoring.** Every row is derived from data the mission
already declares:

- **Where:** the map name, `time_of_day` and `target_minutes`.
- **What happened:** the briefing's first beat, the Situation section from
  `briefing-sections.ts`.
- **Objective:** the primaries, with their `seconds`.
- **What matters:** the carrying secondaries, the star Conduct floor and the
  objective-critical units.
- **Avoid:** `roe.flagged_zones` and deadline failures.

An authored override is decision L-3.

## The ground map

The renderer already takes the picture. `ThreeRenderer.captureGroundAlbedo(size)`
is public on `Renderer` (`api.ts:459`) and the minimap uses it today. It renders
the lit scene from straight above into a render target, through the real
`OutputPass`, with units and overlays hidden and buildings stood up. The ground in
every mock frame is that call, taken from the running game at 960 px. Its rows must
be flipped as `minimap.ts`'s `flipRows` does: the raw `ImageData` is bottom-up.

The renderer is constructed before the briefing exists (`main.ts`: `new
ThreeRenderer` at :1769, `showLoading` at :1957). So:

- **G1 (recommended): live capture.** Keep today's painted preview as the instant
  placeholder and as the Pixi and no-WebGL path. Once the art gate settles, swap in
  `captureGroundAlbedo(~640)` with a short crossfade. The cost is one orthographic
  render per briefing, memoised by the renderer. The capture must wait for the
  building GLBs, or the town photographs as pads.
- **G2: baked plates.** A `pnpm plate:ground` tool, in the shape of `plate:host`,
  writes one JPEG per map to `assets/ui/plates/maps/`, and `validate:data` checks
  that each one is present. There is no runtime cost, but it adds about 200 KB × 26
  maps of assets and goes stale when a map changes.
- A lit oblique overview (the dimetric camera framed on the objective) is more
  cinematic. It needs per-mission framing and a fog rule, so it is left for later.

The markings are drawn from data the mission already has:

- markers (`kdf_crossing`, `depot_gate`, `rif_east`, `rif_south`);
- zones (`depot`, `hall_block`);
- `roe.flagged_zones`;
- objective targets;
- wave `from` points.

The two "route" lines in the mock (river road, straight road) are an exception:
the briefing describes them in prose, so drawing them needs either authored
waypoints or a road trace. That is decision L-3.

## Roster and reserve

### What is on screen, and why

The deploy spread's reserve line counts every pool entry this mission does not
field, including types it cannot field at all. `roster.surviving_units` is
cumulative. Every victory appends its fresh survivors, and replaying a mission
appends again. So a campaign that has been replayed reaches three figures.

The lead's 119 is within today's cap. **CLAUDE.md is stale here.** It says "the
roster itself is not capped, deliberately", but WP-G-E2 shipped `ROSTER_CAP = 150`
(`packages/app/src/roster-cap.ts`). That cap is a rail, set at 5× the measured
ladder maximum of 30 (32 since GH-382). Overflow moves to `roster.reserve` and is
never deleted. A long or replayed campaign can sit anywhere under 150 without the
cap binding.

### The presentation fix (no rule change; ships with the chosen direction)

1. **Deploy never prints the global reserve.** Each slot shows how many
   alternatives of its own type exist (⇄ 19), the only number the decision uses.
   Types the mission cannot field are not mentioned.
2. **The bench is ranked and collapsed.** Swapping a slot opens a drawer ranked by
   `rosterOrder` (stripes, then missions, then kills). Every body with a record
   gets a row, and unrecorded bodies collapse to one line ("and 16 fresh Rifle
   Squads with no record yet"). In the seeded case, the 33-row list becomes 5
   slots and a 5-row drawer.
3. **The brigade total moves to the Brigade screen.** It reads as "Brigade 125 ·
   150 places", where the cap already lives (`garage.brigade`). Direction C's
   consequences panel may say "the rest stay at base" without the number.

This needs no ledger or sim change. `deploy-roster.ts`'s `DeployRosterView`
already carries `eligible`, `demand` and `cap`.

### The cap decision (a game rule, so the lead's call; not implemented)

- **R-1, keep the rail at 150 and stop there.** The presentation fix alone hides
  the symptom. The save keeps growing toward 150 on replays.
- **R-2, a replay replaces instead of appending (recommended).** On a victory
  replay, the fresh survivors this mission spawned replace the ones its previous
  run added, rather than joining them. This is app-side in `roster-carryover.ts`.
  It needs each roster entry to remember which mission enlisted it: `RosterEntry`
  has no `missionId` today, though `LostRecord` does. It fixes the cause. A
  first-time campaign is unchanged.
- **R-3, a binding brigade strength,** for example `ROSTER_CAP = 40` (above the
  measured 32, with margin). The eviction order is the one that already exists:
  veterans stay, and the newest unrecorded places go to reserve first. This makes
  scarcity a mechanic and asks the garage to show "40 / 40".
- **R-4, discharge the unfought.** A fresh remnant that was never fielded, with no
  record and no stripes, is not written to the roster at all. It is simple, but it
  changes what "survivors" means.

R-2, R-3 and R-4 all change what a campaign save holds, so each needs its own
measurement in `pnpm playtest`'s roster lines before it lands.

## Decisions for the lead

- **L-1. Direction.** A (recommended), B, C, or A with B's pins.
- **L-2. Ground.** Live capture G1 (recommended) or baked plates G2.
- **L-3. "At a glance" source.** Derived from existing mission data (recommended,
  no authoring), or an optional authored `glance` block, which would be a
  `mission.schema.json` change. The same question covers drawing named routes on
  the ground.
- **L-4. The reserve on deploy.** Per-slot counts only, with the brigade total on
  the Brigade screen (recommended), or keep a single reserve line.
- **L-5. The roster cap rule.** R-1, R-2 (recommended), R-3 or R-4. Each is a game
  rule and lands separately from the polish.
- **L-6. Debrief data.** A3's "what went wrong" cause line and B2's map pins need a
  small app-side log of objective-relevant events and loss positions, fed from sim
  events with no sim change. Approve that scope, or drop those lines from the
  build.
- **L-7. End panel and debrief.** Keep the outcome moment, then go straight to the
  after-action report, folding today's end panel into its verdict band
  (recommended: it removes a screen and one of PA-07's four names). The
  alternative is to keep both screens.
- **L-8. Attached units.** Show non-ledger placements (the D9 here) on the deploy
  screen as "attached by brigade" slots (recommended).

## What is independent of the choice

B-01 is a P0 and a one-rule fix: `align-items: safe center` (or `margin: auto`
on the box) plus `focus({ preventScroll: true })`. It can land first, under any
direction, with its own failing check: a spec measuring that the title's top is ≥ 0
at 1400 × 900 with a long briefing, seen red on today's CSS. B-03 and B-04 are
equally small. They are listed here so the lead can release them ahead of the
redesign if wanted.
