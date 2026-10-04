# Stage 4 order: Lane C, 2–27 November 2026

One page that orders every Stage 4 plan in Lane C, so that each re-pin has exactly one reason and
lands in its own commit. Stage 4 runs **Mon 2 Nov – Fri 27 Nov** (M2, "an economy with decisions in
it", 27 Nov). The **week of 23 Nov is the buffer** and is not free for new scope (execution plan,
"Buffers").

**Rules that make the order matter:**
- Lane C is one lane: one plan in flight in `packages/sim` at a time, landed through a PR with `gates`
  and `determinism` green before the next branch is cut from `main`.
- Each pin moves at most once per plan, in its own commit, with the reason in the message: the two
  sim pins (`determinism.test.ts`, flat and relief), the economy pins F1 creates
  (`ECONOMY_PIN`, `ECONOMY_PIN_RELIEF`), `LADDER_CREDITS` and `GATES` in `playtest.ts`.
- The agreed order (lead, 30 Sep, #183): **#291 → the G-F plans → (Stage 5) FW Task 2 → E6 →
  officers.** #330 goes between #291 and F1, as the G3 sheet requires ("first or last in the Stage 4
  order, never folded into a G-F plan").

## The calendar

| dates | plan | what lands | pins it moves |
|---|---|---|---|
| **before 2 Nov** (October, no sim code) | the four G-NUM halts: F1 Task 2, F2 Task 2, F3 L-1 (Task 7 Step 1's request), F4 Task 1 | read-only probes on scratch copies, posted on #183 for the lead | none |
| **Mon 2 – Tue 3 Nov** | Stage 4 sim fixes (`2026-09-29-stage4-sim-fixes.md`, #296) | Task 1 (Tel Marum I shepherd), Tasks 2–3 (#279 sim half), **Task 4 (#291)** | **sim pins, once** (#291's three hashed columns) |
| Tue 3 Nov | FW Task 1 (#280, `2026-09-29-field-works.md`), and #247 (`manpad_team` wheeled) | garrison suppression cover (opt-in field); the `mobility.wheeled: false` data line and its pin test | none expected. #247 moves pathing: if it moves the sim pins it is a **separate** re-pin with its own commit, after #291's, never folded in |
| ~~Wed 4 Nov~~ **landed in October** | #330 (a fresh campaign pays again) | moved out of Lane C by the lead on 5 Oct: it edits `packages/app` and the harness, never `packages/sim` or `credits.ts` (`2026-10-04-credits-reachability.md`) | **none**: `LADDER_CREDITS` stays 5736; the harness's two-campaign walk is relative to it |
| **Thu 5 – Mon 9 Nov** | **F1** fire support and intel by doing (`2026-10-04-gf1-fire-support-intel.md`) | the economy pins born; the trickle deleted; high ground; barrage and smoke screen; the four-item menu; the intel gates | economy pins born, then **re-pinned once**; `LADDER_CREDITS` only if Task 9's spending plan moves |
| **Tue 10 – Wed 11 Nov** | **F3** population cap and "on loan" (`2026-10-04-gf3-population-cap-on-loan.md`) | the cap (off in the campaign); the loan predicate; the deploy mark; L-1 if confirmed | economy pins once; roster lines and possibly `LADDER_CREDITS` through L-1 |
| **Thu 12 – Mon 16 Nov** | **F2** held-ground income and corridors (`2026-10-04-gf2-held-ground-income.md`) | the integer purse; zones; corridors; five missions authored; banking gates | economy pins once; the five D7 missions' playtest lines; `LADDER_CREDITS` only through a moved grade |
| **Tue 17 – Fri 20 Nov** | **F4** production at the camp (`2026-10-04-gf4-camp-production.md`) | serial lines; the contested pause; rally points; the enemy's spender; plan re-proofs | economy pins once; the three building plans' lines; `LADDER_CREDITS` only through a moved grade |
| **Mon 23 – Fri 27 Nov** | **buffer** | overflow from F2/F4 only; WP-S-F's last landings and their bless; R2 at M2 on Fri 27 Nov | — |

**Why F3 sits before F2 and F4.** It is the smallest, it moves no campaign outcome unless L-1 does,
and F4's queue reservation is written against it. **Why F2 sits before F4.** F4's enemy spender reads
side 1's purse, and F2 is what fills it from held ground; the G3 sheet also asks that the two land
together, so they are adjacent and F4 is the plan the buffer protects.

## Lane A beside it (WP-S-F #184)

S-F trails Lane C by one landing and never edits `packages/sim`:

| after | S-F lands |
|---|---|
| F1 (from Tue 10 Nov) | the four-item fire-support menu, charge timer and announcement (GH-113), the intel counter (GH-77) and the earn feed line |
| F3 (from Thu 12 Nov) | used/cap (hidden in the campaign), the cap reason on the dock; "on loan" if F3's Task 8 did not land with F3 |
| F2 (from Tue 17 Nov) | zone holders on the minimap, the income readout, corridor alerts; the supply-line overlay **after its mock is approved** |
| F4 (week of 23 Nov) | the dock per camp, "contested: production paused", the rally order and its marker **after its mock is approved**, the tutorial's economy step |

One visual bless per landing, one in flight at a time, from CI numbers.

## The re-pin order, as a list

1. #291: sim pins.
2. (#247, only if it moves them: sim pins again, its own reason.)
3. ~~#330: `LADDER_CREDITS`.~~ Landed in October and moved no pin. From here on, each `LADDER_CREDITS`
   re-pin also moves `CAMPAIGN_CREDITS` (`packages/app/src/ui/stores-model.ts`), which
   `tools/src/campaign_credits.test.ts` holds equal to it.
4. F1: economy pins born, then re-pinned; ladder only via one spending plan.
5. F3: economy pins; roster and ladder via L-1.
6. F2: economy pins; playtest; ladder via grades.
7. F4: economy pins; playtest; ladder via grades.
8. Stage 5: FW Task 2 (sim pins, every FW array at once), E6, officers.

No G-F plan is expected to move the sim pins (G3 sheet, "one correction": every G-F change lives in
`MissionRuntime`, which no golden replay constructs). A G-F commit that moves them is a defect to
find, not a re-pin to take.

## Exit (execution plan, Stage 4)

Sweep and strike affordable where they are designed to be (F1's `INTEL_WINNERS_ONE_SWEEP`), every
passive control still loses, every plan still wins, the §5.7 targets pass, and the ladder is
re-pinned with one reason per commit.
