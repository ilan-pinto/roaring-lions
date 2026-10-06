# Stage 4 order: Lane C, 2–27 November 2026

One page that orders every Stage 4 plan in Lane C, so that each re-pin has exactly one reason and
lands in its own commit. Stage 4 runs **Mon 2 Nov – Fri 27 Nov** (M2, "an economy with decisions in
it", 27 Nov). The **week of 23 Nov is the buffer** and is not free for new scope (execution plan,
"Buffers").

## Changed since 4 Oct

Refreshed 6 Oct against `main` `b44df7aa`. Each plan below carries its own "Changed since 4 Oct"
section; this one covers the schedule.

**What landed:**
- **#402, halt and kneel to fire (6 Oct), a sim change outside this order.**
  - It moved both sim pins: flat 2109596329 → **922714084**, relief 1425295494 → **3200430224**.
    #291 therefore re-pins from those values.
  - It moved `LADDER_CREDITS` 5844 → **5830** (with `CAMPAIGN_CREDITS`) and `ROSTER_MAX` 33 → **31**.
  - It added `mobility.halts_to_fire` to the schema, with an explicit override on `manpad_team`:
    the unit #247 is about.
  - Its kneel is **0.2 s, final**: the lead chose it on 6 Oct after 0.3 s failed the smoke gate.
    It adds no further re-pin.
  - The lead approved it as a one-off. `packages/sim` stays closed until 2 Nov.
- **GH-382 (5 Oct) re-grounded every mission II and later, and Tel Marum I.** It moved
  `LADDER_CREDITS` seven times, from 5736 to 5844, before #402. **#330 moved nothing**: it landed
  as `packages/app/src/campaign-pay.ts`.
- **Every October G-NUM probe now runs on new maps under halt to fire.** The four plans quote G3
  numbers (M at `751b6742`) that predate both changes.

**New interactions:**
- Every plan's G-F rule now meets kneeling infantry and the closing rule: an arrived attack-mover
  walks toward an identified enemy it cannot reach, and the player's right-click is always an
  attack-move. Each plan's own section names the cases:
  - F1: high ground held 10 s;
  - F2: a zone holder walking off its zone, and patrols that halt on contact;
  - F3: `halts_to_fire` follows the type fielded;
  - F4: a rally `move` holds fire on the way.
- **#247 and #402 edit the same file,** `data/units/enemy/manpad_team.json`.
  `tools/src/halt_to_fire_roster.test.ts` pins manpad's `halts_to_fire: true` and says the
  derivation "calls it wheeled". #247's `wheeled: false` makes the override redundant and that
  comment false, though the test stays green.

### For the lead
1. **An offer, not an assumption: an earlier landing.** #402 was a lead-approved one-off sim
   change. The rest of `packages/sim` stays closed until Stage 4 opens on 2 Nov, so the calendar
   below is unchanged: #291 and #279 stay on 2–3 Nov. If the lead wants either in October instead,
   the sim-fix plan is ready. Tasks 1–3 are hash-neutral and Task 4 is its only re-pin.
   **Ruled 6 Oct:** #291 and #279 stay on 2–3 Nov.
2. **#247 and the manpad override.** #402's spec §7.3 leaves manpad's wheeled quirk to the lead.
   When #247 lands `wheeled: false`, should it also drop the now-redundant `halts_to_fire: true`
   override (and re-word the roster test), or keep it?
   **Ruled 6 Oct:** #247 drops the redundant override and re-words the test.
3. **The shared root of four plan questions** (F1 item 5, F2 item 11, F4 items 19 and 20): the
   player has no order that keeps a unit in place against the closing rule.
   **Ruled 6 Oct (lead): add a "Hold position" order.**
   - The player issues it with hotkey H or a HUD button.
   - Units stay put and kneel, fire at anything in range, and never advance, chase or close.
   - It is a sim command with a new flag, landing in Stage 4.
   - The rally point and the enemy's bought units issue Hold on arrival, and F2's held zones are
     kept by Hold.

   Plan: `2026-10-06-hold-position.md`, scheduled Wed 4 Nov below.

**Rules that make the order matter:**
- Lane C is one lane: one plan in flight in `packages/sim` at a time, landed through a PR with `gates`
  and `determinism` green before the next branch is cut from `main`.
- Each pin moves at most once per plan, in its own commit, with the reason in the message: the two
  sim pins (`determinism.test.ts`, flat and relief; `922714084` and `3200430224` since #402), the
  economy pins F1 creates (`ECONOMY_PIN`, `ECONOMY_PIN_RELIEF`), and `LADDER_CREDITS` (5830),
  `ROSTER_MAX` (31) and `GATES` in `playtest.ts`. `ROSTER_MAX` was not named on 4 Oct. It is a pin
  in the same idiom: #402 moved it 33 → 31, and F3's L-1 is the G-F change most likely to move it.
- The agreed order (lead, 30 Sep, #183): **#291 → the G-F plans → (Stage 5) FW Task 2 → E6 →
  officers.** #330 goes between #291 and F1, as the G3 sheet requires ("first or last in the Stage 4
  order, never folded into a G-F plan").
- Hold position (lead, 6 Oct) goes between #291 and F1, on the day #330 freed. F2 and F4 consume
  it, and F1's high-ground test uses it.

## The calendar

| dates | plan | what lands | pins it moves |
|---|---|---|---|
| **before 2 Nov** (October, no sim code) | the four G-NUM halts: F1 Task 2, F2 Task 2, F3 L-1 (Task 7 Step 1's request), F4 Task 1 | read-only probes on scratch copies, posted on #183 for the lead | none |
| **Mon 2 – Tue 3 Nov** | Stage 4 sim fixes (`2026-09-29-stage4-sim-fixes.md`, #296) | Task 1 (Tel Marum I shepherd), Tasks 2–3 (#279 sim half), **Task 4 (#291)** | **sim pins, once** (#291's three hashed columns) |
| Tue 3 Nov | FW Task 1 (#280, `2026-09-29-field-works.md`), and #247 (`manpad_team` wheeled) | garrison suppression cover (opt-in field); the `mobility.wheeled: false` data line in `data/units/enemy/manpad_team.json` (the issue names `data/units/manpad_team.json`) and its pin test, beside `tools/src/boulders.test.ts`'s `rocket_battery` pin. The same file has carried #402's `halts_to_fire: true` override since 6 Oct (For the lead, item 2) | none expected. #247 moves pathing: if it moves the sim pins it is a **separate** re-pin with its own commit, after #291's, never folded in |
| **Wed 4 Nov** | **Hold position** (`2026-10-06-hold-position.md`, lead ruling 6 Oct) | the `hold` command and its `holdPos` column; nothing reads it yet but the closing rule's skip | **sim pins, once** (one hashed per-unit column), after #291's (and #247's, if any) |
| ~~Wed 4 Nov~~ **landed in October** | #330 (a fresh campaign pays again) | moved out of Lane C by the lead on 5 Oct: it edits `packages/app` and the harness, never `packages/sim` or `credits.ts` (`2026-10-04-credits-reachability.md`); shipped as `packages/app/src/campaign-pay.ts` | **none**: #330 moved no pin. `LADDER_CREDITS` read 5736 when it landed and is **5830** on 6 Oct, moved by GH-382 and #402. The harness's two-campaign walk is relative to it |
| **Thu 5 – Mon 9 Nov** | **F1** fire support and intel by doing (`2026-10-04-gf1-fire-support-intel.md`) | the economy pins born; the trickle deleted; high ground; barrage and smoke screen; the four-item menu; the intel gates | economy pins born, then **re-pinned once**; `LADDER_CREDITS` only if Task 9's spending plan moves |
| **Tue 10 – Wed 11 Nov** | **F3** population cap and "on loan" (`2026-10-04-gf3-population-cap-on-loan.md`) | the cap (off in the campaign); the loan predicate; the "on loan" mark (on the in-mission unit card and selection chip since the 6 Oct ruling, not the deploy screen); L-1 if confirmed | economy pins once; roster lines and possibly `LADDER_CREDITS` through L-1 |
| **Thu 12 – Mon 16 Nov** | **F2** held-ground income and corridors (`2026-10-04-gf2-held-ground-income.md`) | the integer purse; zones; corridors; four missions authored (BS II left D7, ruled 6 Oct); holders kept by Hold; banking gates | economy pins once; the four D7 missions' playtest lines; `LADDER_CREDITS` only through a moved grade |
| **Tue 17 – Fri 20 Nov** | **F4** production at the camp (`2026-10-04-gf4-camp-production.md`) | serial lines; the contested pause; rally points that issue Hold on arrival; the enemy's spender; plan re-proofs | economy pins once; the three building plans' lines; `LADDER_CREDITS` only through a moved grade |
| **Mon 23 – Fri 27 Nov** | **buffer** | overflow from F2/F4 only; WP-S-F's last landings and their bless; R2 at M2 on Fri 27 Nov | — |

**Why F3 sits before F2 and F4.** It is the smallest, it moves no campaign outcome unless L-1 does,
and F4's queue reservation is written against it. **Why F2 sits before F4.** F4's enemy spender reads
side 1's purse, and F2 is what fills it from held ground; the G3 sheet also asks that the two land
together, so they are adjacent and F4 is the plan the buffer protects.

## Lane A beside it (WP-S-F #184)

S-F trails Lane C by one landing and never edits `packages/sim`:

| after | S-F lands |
|---|---|
| Hold position (from Thu 5 Nov) | the H binding (today `halt`'s key), the HUD button, the "holding" mark on the unit card and selection chip (`2026-10-06-hold-position.md`, Task 3) |
| F1 (from Tue 10 Nov) | the four-item fire-support menu, charge timer and announcement (GH-113), the intel counter (GH-77) and the earn feed line |
| F3 (from Thu 12 Nov) | used/cap (hidden in the campaign), the cap reason on the dock; "on loan" on the unit card and selection chip, if F3's Task 8 did not land with F3 |
| F2 (from Tue 17 Nov) | zone holders on the minimap, the income readout, corridor alerts; the supply-line overlay **after its mock is approved** |
| F4 (week of 23 Nov) | the dock per camp, "contested: production paused", the rally order and its marker **after its mock is approved**, the tutorial's economy step |

One visual bless per landing, one in flight at a time, from CI numbers.

## The re-pin order, as a list

0. (Landed 6 Oct, before Stage 4.) #402: both sim pins, `LADDER_CREDITS`/`CAMPAIGN_CREDITS` and
   `ROSTER_MAX`. Everything below rebases onto it.
1. #291: sim pins.
2. (#247, only if it moves them: sim pins again, its own reason.)
2a. Hold position (Wed 4 Nov): sim pins, for its one hashed column. It is not a G-F plan, so the
    rule below does not apply to it.
3. ~~#330: `LADDER_CREDITS`.~~ Landed in October and moved no pin. From here on, each `LADDER_CREDITS`
   re-pin also moves `CAMPAIGN_CREDITS` (`packages/app/src/ui/stores-model.ts`), which
   `tools/src/campaign_credits.test.ts` holds equal to it. GH-382 and #402 did exactly that (both
   read 5830 on 6 Oct).
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
