# Combat formations P1b: the march, the drills and the calls (GH-859). Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax.

**Design:** `docs/superpowers/specs/2026-10-28-combat-formations-design.md`. Read §0, §2.1 (the two shared
behaviours), §2.2 F1–F3, §3.2 (the aircraft call behaviour), §4.3–4.8, §6, §7.3, §8 and §9 first.
**What shipped:** the P1a plan `docs/superpowers/plans/2026-10-28-formations-p1a.md`, PR 900 (P1a) and PR 901 (the
follow-ups: a drag disarms, truer ambush copy, `drill.spring` wired). The as-built facts are in
`docs/agent-notes/sim-and-orders.md`, "Formations (GH-859 P1a)". The P1a ledger is
`/Users/ilpinto/dev/roaring-lions-ep/_coord/formations-p1a-progress.md`. The S4 diagnosis is
`/Users/ilpinto/dev/roaring-lions-ep/_coord/formations-p1a/t6/s4-diagnosis.md`. The P1a final review is
`/Users/ilpinto/dev/roaring-lions-ep/formations-p1a/.superpowers/sdd/2026-10-28-formations-p1a/final-review-report.md`.

**Rulings this plan builds on.**
- **Coordinator, 27 Oct (PR 860, under the lead's grant):** spec decisions 1–19 are taken as the spec recommends.
  For P1b that means:
  - pace matched to the slowest ground member, held through contact in Attack (D4);
  - checkpoints every 8 tiles with a 3 s dress (D5);
  - the call is the troops' own contact and casualties, automatic (D6);
  - Column halts on contact and does not resume by itself (D9);
  - medics answer at once, and their losses are measured (D18).
- **The lead, 28 Oct:** the P0 HUD mock is approved as drawn. Its card line "In column — checkpoint N of M", the
  pace-setter line beneath it, and the chip "N in column · cp 3/5" were cut from P1a (P1a Q1) and return here.
- **The lead, 29 Oct (GH-859 comment, on S4):**
  - formations stay OFF in versus rooms until P1b passes a re-gated S4;
  - P1b's layout work starts with the two measured levers: the Sarim gun-truck line width (one 14-tile rank) and
    the 13-tile KDF aircraft standoff. **Hulls do not go behind the infantry**: that measured worse;
  - S4 is re-gated per cell against that cell's own no-formation baseline, seed by seed, at 192 or more seeds,
    with a second seed set for any cell within 5 pp of the bar;
  - the bars stay at 60/40 and 65%.
- **The lead's standing taste** (memories `infantry-motion-standard`, `mission-difficulty-must-be-measured`):
  - infantry halt and kneel to fire and never fire on the run, and a squad moves as a squad;
  - losses compound in this sim, so no layout or march number is reasoned out: it is measured, seed for seed.

**Base:** `origin/main` `d203f0237` (v0.129.12), which carries PR 900 and PR 901. Re-read every pin and every named
site at pre-flight. Find code by symbol, never by line: `applyMove`, `templateFor`, `fmJoin`, `fmForget`,
`fmArrived`, `fmPend`, `stepFormationSpring`, `stepFormationFacing`, `finishLeg`, `stepMovement`,
`reservedTilesFor`, `applySuppression`, `fireAt`, `fireAtStructure`, `fallMan`, `woundCrossings`, `stepMedics`,
`medicIdle`, the `rescue` branch of `applyCommands`, `haltUnit`, `hash()`, `assignTemplate`, `templateOffsets`,
`compileFormation`, `VERSUS_FORMATIONS_OPEN`, `seatWorldFor`, `roomOrderSink`.

**History checked (30 Oct).**
- `gh pr list --state open` is empty. The last merges are PR 901 and PR 900 (this feature) and PR 898 (Wetland P2).
- One other lane is in flight: Wetland P4 (`feat/wetland-p4`, plan only so far). It is render-only. Its plan says
  "nothing under `packages/sim/` is edited". It shares `CLAUDE.md`, `packages/data/src/index.ts` (it adds a
  `vfxEmitters` entry; this plan touches the `formations` array only if a lever adds a file, and it does not) and
  the golden visual baseline. See the conflict table.
- GH-859 has three comments: the mock made, the mock approved, and the S4 ruling. All three are above.

**Goal.** A formation order now keeps its shape on the way, and its support answers.
- A Column marches at the pace of its slowest ground member and re-forms at a checkpoint every 8 tiles. It halts,
  faces and returns fire on contact. An Attack presses on through contact without leaving its infantry. An Ambush
  walks to its ring at one pace.
- Aircraft hold their station and fly a sortie to the contact when the group calls. Medics answer a member's
  casualty and come back to their slot.
- Every order without a formation is byte-identical to today.
- Versus opens to formations only if the re-gated S4 passes.

**Architecture.**
- **Pure geometry first.** The route walk and checkpoint spacing are pure functions over a flow field's `dirs`.
  `aircraftCallOf` derives an aircraft's call behaviour from its JSON. Both go beside `assignTemplate`.
- **State.** Ten per-row and four per-unit columns are appended behind the existing `fmLive` latch. They fold into
  `hash()` there, as the P1a columns do, and are snapshot `state` rows.
- **The march is waypoints.** At order time the group's route is walked once. Each checkpoint gets the formation's
  slots, written as ordinary per-unit waypoints. `finishLeg` holds a member at an unreleased checkpoint, and
  `stepFormationMarch` releases it. The pace is one `min` in `stepMovement`.
- **Contact is P1a's one hook, widened.** `fmPend` already marks a group. It now also runs at every `fire` site, and
  it carries the contact point. `stepFormationSpring` becomes `stepFormationContact` and runs the drill: `halt`,
  `press` or `spring`.
- **Calls are the sim acting on its own members,** like `stepSweep`. A strike aircraft gets an attack-move, a spot
  aircraft a move. A medic gets the `rescue` order's own internals. Ten seconds of quiet sends them home.
- **Versus.** The re-gate is a new paired tool, `s4-gate.ts`. Versus opens with one constant, only after it passes.
- **UI.** The approved card and chip lines return. They are joined by the pace setter, "On call" and "Answering a
  call", two alerts, the P1b tooltip clauses, and the P1a final review's UI minors.

**Tech stack:** TypeScript strict, vitest, Ajv (validate:data). No new dependencies.

---

## Scope

**In P1b** (spec §10, "P1b, march and calls"):
- route checkpoints, pace, dress, and the final-checkpoint reservation;
- the `halt` and `press` drills and the contact hooks;
- the aircraft and medic calls;
- the events, alerts, card lines and tooltip clauses;
- the S4 re-gate and the two layout levers;
- versus ON, only if S4 passes;
- the P1a final-review minors M3, M5, M6, M7, M8 and M10.

Measured: §8.3 (every MVP arm), §8.4 (calls), §8.5 (playtest variants), §8.6 (perf), §8.7 (versus, re-gated) and
§8.9 (separation overlap).

**Not in P1b:**
- P2: the other eight formations; `vee`, `echelon`, `slots` and `bound`; manual calls (`formationCall`); the ground
  ghost; drag-to-face; U and L ambush shapes;
- P3: enemy use, mission waves in formation, and eight-way templates;
- the Lanchester Line-against-Column claim of §8.3, because Line (F5) is P2.

---

## Global Constraints (bind every task and every child)

- **G-1. The four invariants.**
  - Integers, Q16.16 `Fx` and u16 angles only in `packages/sim`. No `Math.*`, no `Date.*`, no float literal.
  - Distances are compared squared, in `Fx` through `distSqFx` or in integer tiles. A route is integer tiles.
    Spacing is `ceil` by the remainder-first idiom (`(a + b - 1 - ((a + b - 1) % b)) / b`). A facing is an
    eighth-turn from `eighthToward`. A pace is a `min` of `Fx` steps.
  - **No random draw anywhere.** Every tie breaks by id, then tile index. No per-entity stream is touched, so
    no later unit's RNG shifts.
  - Nothing outside the sim writes the group table. Calls and sorties are goals the sim writes for its own
    members, identically on every machine (the `stepSweep` precedent). They are never commands.
  - Everything runs in the 20 Hz tick. The dress and quiet clocks count ticks.
- **G-2. Byte identity without a formation.** A world that never orders a formation (`fmLive` false) takes
  today's code path in every function this plan touches.
  - Every new read of a new column, and every new branch in `finishLeg`, `stepMovement`, `reservedTilesFor`,
    `fallMan`, `medicIdle` and the fire sites, sits behind `this.fmLive`.
  - Refactors (`advanceLeg` out of `finishLeg`, `beginRescue` out of the `rescue` branch) are byte-identical. The
    golden orders pin and `WOUNDED_WORLD_PIN` are their witnesses.
  - The only pins allowed to move are the snapshot format pin (new `state` rows, encoded empty) and
    `FORMATION_WORLD_PIN`. **The golden hash is the canary: if it moves, that is S1.**
- **G-3. Cost.** No per-tick allocation.
  - Pace is one compare per moving member, behind `fmLive && fmGroup[i] >= 0`.
  - A contact mark is O(1) per fire or suppression event.
  - `stepFormationContact` and `stepFormationMarch` are O(rows) per tick.
  - A drill, a release, a call or a return is one O(count) scan per EVENT, never per tick. A release happens about
    every 8 tiles of march; a drill once in a group's life.
  - Everything else is order-time: one route walk (at most w × h steps) and one `assignTemplate` per checkpoint
    (at most 9).
- **G-4. Pins move only as the pin table says, each in its own commit**, carrying "Was <n>." and the reason. That
  commit comes straight after the commit that moved the pin, and the branch is never pushed between the two. A
  move this plan does not predict is S1.
- **G-5. Every new check is seen red** by a one-line mutation of the implementation. The commit message names the
  mutation and quotes its red line, and the mutation is undone by an edit. **Oracles take literals**: routes,
  checkpoint lists, call classes, pace values, release ticks and sign-test p-values are written out by hand
  (casebook: "the oracle imported its arguments"). A count of checked cases is asserted, so an empty table
  cannot pass (casebook: "the empty array").
- **G-6. No loosened test.** No existing assertion changes, with two named exceptions:
  - The `FORMATION_WORLD_PIN` world's own literal facts (`groups`, `members`, `ringFacing`, `seen`, `sprungBy`) and
    the fork witness's scouting ticks (`[196, 344, 404]`) describe a world this plan deliberately changes. Each
    is re-read in the re-pin commit with its "Was" and the reason. None is deleted or weakened, and the new
    behaviours get new assertions beside them.
  - A P1a test in `formation-group.test.ts` that reds because P1b changed the exact behaviour it pins, and that
    behaviour is named in this plan's rulings (the final-checkpoint frame, the rest-facing gate, the `travel`
    facing), is re-derived in the same commit. Its literal is re-read and the reason given, and it is listed in
    the ledger.
  - Any other red is S1.
- **G-7. Gates before every commit touching the sim:** `pnpm test:determinism && pnpm lint && pnpm typecheck &&
  pnpm test`.
  - Before a sim task reports, also run `pnpm validate:data`, `pnpm validate:ui`, `pnpm balance`,
    `pnpm playtest`, and `pnpm snapshot:witness -- --self-check`. P1a's PR went red on that last one in CI.
  - Record every output in `/Users/ilpinto/dev/roaring-lions-ep/_coord/formations-p1b-progress.md` (not committed).
- **G-8. House rules, in every brief.**
  - Never pkill or killall, and never kill a dev server. Port 5177 is off-limits.
  - **No browser in this plan.** No local `ui:routes`, `golden-baseline` or `ui:shots`: CI runs them. The UI is
    proved in jsdom and node tests, and the pseudo-locale check is a test.
  - Test harnesses start with music off (`tools/src/ui-review/music-off.ts`). Never write `lions.settings` by hand.
  - Git: `/usr/bin/git`, one plain command per call. Commit with `git commit -F <msg> -- <paths>`. Never `-A`,
    `git checkout <file>`, `git stash`, rebase or force-push. Merge `origin/main` with a normal merge commit when it
    moves.
  - Issue refs are written GH-NNN, never with a hash mark (the UI palette gate reads one as a hex colour).
  - No deploys, secrets or production. The repo is public: no exploit details in commits or PR text.
  - Commits end with `Co-Authored-By: Claude <model> <noreply@anthropic.com>`. The PR body ends with the Claude
    Code line. The lead merges.
  - Run everything in the FOREGROUND. **Never run two heavy instruments at once**: `pnpm balance`,
    `pnpm playtest`, `pnpm versus:probe`, `s4:gate`, `snapshot:witness`, or a probe over 48 seeds.
- **G-9. Children and models.**
  - Every child runs in the foreground, with `model` passed explicitly.
  - **Sonnet implements and reviews every task.** The `sim-guard` reviewer of the sim diff is Sonnet
    (`sim-guard` agent type, `model: sonnet`). Measurements run on Sonnet (`balance-analyst` agent type,
    `model: sonnet`).
  - **Opus is used once: the final review** (Task 13).
  - One reviewer per task.
- **G-10. Shared files.** `sim.ts`, `snapshot-schema.ts`, `en.json`, `hud.ts`, `main.ts`, `CLAUDE.md` and
  `docs/HANDOVER.md` are high-churn. Edit only the named sites, merge on conflict, and never take another lane's
  hunk.
- **G-11. Data discipline (CLAUDE.md).**
  - The formation JSON carries i18n keys, never text.
  - JSON-typed interfaces use `string` fields. `compileFormation` and `aircraftCallOf` check values and throw,
    naming the id (memory: "CI runs typecheck").
  - Labels are read through accessors at render time, never resolved at module load.
  - A layout lever is a JSON edit, never engine code. If a lever needs a per-faction layout, the sim needs
    side-to-faction data first. That is a missing concept and a STOP (S4), not a workaround.

---

## Rulings on ambiguity (made in this plan; the lead may overturn any)

1. **The lead domain and the route.**
   - The route is walked on the vehicle domain when any template member is a ground vehicle, and on the foot
     domain otherwise.
   - Its start is the template members' integer centroid (the remainder-first divide P1a uses), snapped to an open
     tile of that domain with the same snap the click uses. Its goal is that domain's snapped click (`vgx/vgy` or
     `fgx/fgy`).
   - The field is the pool's `fieldFor(goal, domain)`, read once at order time and never stamped on a unit. That
     is the spec's "one route field per order".
   - The walk follows `dirs` (`DIR_DX`/`DIR_DY`) from the start until it reaches the goal, meets `DIR_NONE`, or
     takes `w × h` steps. Anything but reaching the goal gives **no march**: one checkpoint, the click, which is
     P1a's behaviour with pace.
2. **Checkpoint spacing.**
   - With L route steps and `legTiles` T, the spacing is S = max(T, ceil(L / 9)). Nine is `MAX_WAYPOINTS` (8) plus
     the goal, the budget of a fresh order.
   - Checkpoints sit at route steps S, 2S, … below L, and the last one is always the click. A route of L ≤ T is one
     checkpoint.
   - **An appended (shift) formation order gets no march**: one checkpoint at its end, as in P1a. The queue it
     appends to already holds the route the player drew. Q5.
   - `march.legs: false` compiles to "one checkpoint", with pace still applied.
3. **Ambush marches without checkpoints.** `ambush.json` gains `"legs": false`.
   - A ring at every intermediate checkpoint would encircle each 8-tile mark of the route.
   - Pace still applies, so the ring's hulls walk with its infantry.
   - This is data, as the schema already allows. Cost if wrong: one JSON value back.
4. **Slots per checkpoint.**
   - Checkpoint k's slots come from `assignTemplate` with `click` = the checkpoint tile and `from` = checkpoint k−1
     (the route start for k = 1). The frame is axis-quantised (P1a, D17).
   - Intermediate checkpoints use an all-zero reservation mask, allocated once per order: "an intermediate
     checkpoint reserves nothing". The final checkpoint uses `reservedTilesFor` as P1a does.
   - Ground and air members take checkpoint k's slot as waypoint k. Waypoint 1 is the goal, and 2…n are
     `wpX/wpY/wpAttack/wpSweep`.
5. **The final-checkpoint reservation.** `reservedTilesFor` reserves a same-side formation member's LAST queued
   tile when it has one (`fmLive && fmGroup[j] >= 0 && wpCount[j] > 0`), and its goal or position otherwise. That
   is spec §4.4's one array read per member, and it closes Deviation 1 for formation orders only.
6. **Dress: a waiting member keeps its leg live.**
   - `fmLeg[i]` is the checkpoint member i is heading to. No member gets past `fgRelease + 1`, because that is where
     it waits.
   - On arrival at k = `fgRelease + 1` with k below `fgLegs`, `finishLeg` does not advance. It sets `fmDuty[i] =
     FM_DUTY_WAIT`, adds one to `fgAtCp`, and returns with `moving` still 1 and the goal unchanged.
   - While held, it re-arrives each tick and `finishLeg` returns at once. That is one compare per held member.
   - Why `moving` stays 1: every system that acts on `moving === 0` then leaves a waiting member alone.
     - `stepSweep` would walk an idle attack-mover off (`haltUnit`'s comment measured 9–28 tiles).
     - `stepMedics`' idle pick would take a medic off the march.
     - `stepFormationFacing` would turn hulls at every checkpoint. The P1a final review named this.
     - A move-order infantryman keeps holding fire, as a road march does. Contact is what halts him (the drill).
   - A member arriving at k ≤ `fgRelease` advances at once (`advanceLeg`, the `queued > 0` branch of `finishLeg`,
     extracted unchanged).
7. **Release.**
   - `stepFormationMarch` releases checkpoint `fgRelease + 1` of a `MARCH` row in either case:
     - `fgAtCp + fgAway >= fgMembers`: every member present is waiting, or away on a call;
     - `fgDress >= dressTicks`: the clock runs from the first arrival and counts ticks while `fgAtCp > 0`.
   - On release:
     - `fgRelease++`, then `fgDress = 0` and `fgAtCp = 0`;
     - one O(count) scan advances every `WAIT` member (`advanceLeg`, duty `NONE`);
     - the same scan re-reads `fgPace`;
     - one `formationReleased` event.
   - Release runs after `stepMovement`'s arrivals, in the next tick's `stepFormationMarch`. That is a one-tick delay,
     the same for every member, and deterministic.
8. **Pace.**
   - `fgPace` is the minimum, over living ground members not on a call, of `stepPerTick × speedMul`, with
     `mobilityDamaged`'s integer percent applied. It is computed by the same expression `stepMovement` uses,
     extracted as `baseStep(i)`, a byte-identical refactor.
   - It is read at order time and at every release. `march.pace: none` gives 0, meaning no cap.
   - In `stepMovement`, after the mobility-damage percent and before the rout and pin shifts:
     `if (this.fmLive) { const g = this.fmGroup[i]; if (g >= 0 && this.fgPace[g] > 0 && !air && this.fmDuty[i] < FM_DUTY_OUT && step > this.fgPace[g]) step = this.fgPace[g]; }`.
   - Aircraft are exempt and follow the checkpoints. So is a member on a call (D4).
   - Pace holds through contact (`press`); `halt` stops everyone anyway.
   - The pace setter is not state: a read API recomputes it on demand (argmin step, lowest id).
9. **Rest facing waits for the final leg.**
   - `stepFormationFacing` acts on a member only when it is in no group, or `fmLeg[i] === fgLegs[g]` (it is on its
     final checkpoint), or its row is in `CONTACT`.
   - `front` faces the final frame's axis-quantised forward (P1a's meaning when the route is one leg).
   - **`travel` now means the march direction:** `eighthToward(click − checkpoint n−1)`, which is eight-way, so a
     column that came in diagonally faces along its road. `inward` and `outward` are unchanged.
   - Cost if wrong: one branch in `fmJoin`.
10. **Contact is `fmPend(id, x, y)`.**
    - It is called at P1a's two sites: `stepCombat`'s spring, with the member's own position, and
      `applySuppression`'s hostile branch, with the source point.
    - It is called at **every site that pushes a `fire` event** (`fireAt`, `fireAtStructure`), with the target's
      position or the structure's aim point. The implementer greps `kind: 'fire'` and lists the sites in the ledger.
      The beam needs no extra site if its dwell emits through `fireAt`; the implementer checks, and the ledger
      records the answer.
    - On every call for a live row: `fgQuiet = 0`. Then:
      - a row in `MARCH` not yet pending sets `fgPending = FM_PEND_DRILL` and stores `fgCallX/Y`;
      - a row in `CONTACT` or `SPRUNG` with `fgCalled === 0` (its sorties have come home) sets
        `fgPending = FM_PEND_CALL` and the new point.
    - `FM_PEND_*` are bits: `FM_PEND_DRILL` 1 (P1a's single value) and `FM_PEND_CALL` 2. A spring with no call
      therefore writes exactly what P1a writes.
    - **Call reach.** When the contact point is more than `callRadius` from the member that reported it, the call
      bit is not set: the drill still runs, but nobody is called. The radius is measured from the CALLER, not from
      the aircraft. Attack's aircraft stand 13 tiles back, behind a 12-tile radius, and measured from the aircraft
      they could never answer. Q3.
11. **Drills** run in `stepFormationContact`, which is P1a's `stepFormationSpring` renamed, at the same tick
    position (before `stepCombat`):
    - `spring`: P1a, unchanged, plus `fgRelease = fgLegs − 1`, which ends dressing.
    - `halt`: `haltUnit` on every ground member, and on every aircraft that will not be called (`stay`, or out of
      reach). `fgAtCp = 0`. Vehicles' `restFacing = eighthToward(call point − own anchor)`. State `FM_CONTACT`. One
      `formationContact` event. Infantry then kneel to fire under the existing halt-to-fire rule.
    - `press`: state `FM_CONTACT`, `fgRelease = fgLegs − 1`, the `WAIT` members advanced. Pace stays. One
      `formationContact`.
    - Then, when the call bit is set, the calls run (Ruling 12). `fgPending = 0`.
12. **The aircraft call.**
    - `UnitType.fmCall` is config, from `aircraftCallOf(json)`:
      - a weapon that can target `ground`, no `kamikaze` ability, no `swarm` block and no seats → `strike`;
      - no ground weapon → `spot`;
      - seats, `kamikaze` or `swarm` → `stay`.
      - A swarm is spent by diving, like a loitering munition (D6). Cost if wrong: one rule.
    - Every `strike` or `spot` aircraft member with `fmDuty < FM_DUTY_OUT`, at any distance (it is the group's own),
      gets:
      - `fmHome` = its goal if moving, else its position;
      - goal = the call point's tile centre, on the air field;
      - `attackMove` 1 for strike, 0 for spot, and `sweepOrder` 0;
      - `fmDuty = FM_DUTY_OUT`, `fgAway++` and `fgCalled = 1`.
    - **Its waypoint queue is left intact.** `finishLeg` on an `OUT` member stops it (`moving = 0`) and never
      advances the queue.
    - One `formationCall` event per answerer.
13. **The return.**
    - `stepFormationMarch` counts `fgQuiet` up for every row with `fgCalled`. At `quietTicks`, one scan sends every
      `OUT` member home: goal = `fmHome`, `attackMove` 0 (a gunship flying home as an attack-mover would stop at
      every target and never arrive), `fmDuty = FM_DUTY_RETURN`. Then `fgCalled = 0`.
    - `finishLeg` on a `RETURN` member sets `fmDuty = NONE`, `fgAway--` and `attackMove` = the formation's verb,
      then runs the ordinary march logic (Ruling 6). It rejoins its checkpoints from where it left them.
    - A `halt` drill has already cleared the queue, so a returning aircraft stops at home.
14. **The medic call.**
    - In `fallMan`, when the wounded is spawned and `fmLive`, the hook reads the parent's group.
      `woundCrossings` captures `fmGroup[target]` BEFORE `destroy`, which forgets it, and passes it down. So the
      last man of a squad is called for too. The spec's "parent is a member" would miss him, because his parent is
      −1. Cost if wrong: drop the captured argument.
    - The nearest group member with a `rescue` block answers, by `distSqFx`, ties by id. It must be on foot, free
      (`fmDuty < FM_DUTY_OUT`), not routed, carried or below ground, and within `callRadius` of the wounded.
    - It gets `beginRescue(m, w, keepQueue = true)`: the `rescue` branch's writes after its `fmForget`, extracted,
      with `wpCount = 0` skipped when `keepQueue`. Then `fmHome`, `fmDuty = OUT` and `fgAway++`.
    - The `rescue` command keeps calling `fmForget`, then `beginRescue(id, w, false)`: byte-identical.
    - `medicIdle` sends home a member medic that is `OUT`, not routed and carrying nobody (`fmReturnHome`). The
      ambulance and the medevac never answer: they are the CCP.
    - **A medic out of reach does not answer.** A Column's tail medics may not reach its head. The medic probe
      reports how often that happens (D18).
15. **The exit funnel grows.** `fmForget` also handles the new columns:
    - `WAIT` → `fgAtCp--`; `OUT` or `RETURN` → `fgAway--`;
    - then clears `fmDuty`, `fmLeg` and `fmHome`;
    - a freed row zeroes all fourteen new row columns.

    No new exit site is needed: every exit already calls `fmForget`. A player order to a member on a sortie takes it
    out of the group (the spec's manual override).
16. **Counted members.** `tCount` counts distinct ids (M6): `[a, a]` no longer meets `min_members` 2. It is a
    template-branch-only change.
17. **States.** `FM_CONTACT` is 3. 2 (`ARRIVED`) stays reserved and unused: "arrived" is read per member from
    `fmLeg`, never stored. `fmPend`'s spring guard stays `state === FM_MARCH`.
18. **The new columns.**
    - Per row (`{ fixed: FORMATION_ROWS }`):
      - `fgLegs` (`Uint8Array`), the checkpoint count;
      - `fgRelease` (`Uint8Array`), the highest checkpoint released;
      - `fgDress` and `fgQuiet` (`Uint16Array`), the two tick clocks;
      - `fgAtCp` and `fgAway` (`Uint16Array`), the dress counters;
      - `fgCalled` (`Uint8Array`), sorties out;
      - `fgPace`, `fgCallX` and `fgCallY` (`Int32Array`, `Fx`).
      - The spec's table lacks the three counters (`fgAtCp`, `fgAway`, `fgCalled`). Spec §4.4 asks for arrivals
        "counted incrementally", which needs them.
    - Per unit (`'capacity'`):
      - `fmLeg` (`Uint8Array`), the checkpoint it is heading to;
      - `fmDuty` (`Uint8Array`): `NONE` 0, `WAIT` 1, `OUT` 2, `RETURN` 3. This is the spec's `fmSortie`, widened by
        `WAIT`;
      - `fmHomeX` and `fmHomeY` (`Int32Array`, `Fx`).
    - All are `state`. They are appended after `fgMembers`, in this order, in the declaration, the snapshot table
      and the hash block. The hash block gets a second marker word, `0x464d0002` ('FM' P1b), before them.

---

## Data changes (exact)

- `data/formations/ambush.json`: `"march": { "legs": false, "leg_tiles": 8, "pace": "slowest_ground", "dress_s": 3 }`
  (Ruling 3). Task 3.
- `data/formations/attack.json`: the layout levers, Task 9 only, and only as measured. Nothing else changes before
  Task 9.
- `packages/app/src/i18n/en.json`, the P1b keys (copy in Task 10, validator keys in Task 4):
  - `hud.formation.drill.halt` "Halts and returns fire on contact."
  - `hud.formation.pace` "Pace follows the slowest unit."
  - `hud.formation.call.contact` "Aircraft hold back until called."
  - `hud.formation.call.casualty` "Medics answer casualties."
- `tools/validate_formations.mjs`:
  - `drill.halt` loses its exemption (P1a Ruling 16 kept it out until it was true);
  - `hud.formation.pace` is required when `march.pace` is not `none`;
  - `hud.formation.call.<on_call>` is required for every `on_call` other than `none`.

---

## Pin table

Values read on `d203f0237`. Re-read every one at pre-flight.

| Pin | File | T2 (state) | T3 (march) | T4 (drills) | T5 (calls) | T9 (levers) | T11 (versus on) |
|---|---|---|---|---|---|---|---|
| golden flat `1258746094`, relief `1483138559`, orders `2559269335` | `packages/sim/src/determinism.test.ts` | unchanged | unchanged | unchanged | unchanged | unchanged | unchanged |
| `ECONOMY_PIN` `904873885` / `_RELIEF` `2771311510`, `RUNTIME_DIGEST_PIN` `2037118941` / `_RELIEF` `1884258391` | same | unchanged | unchanged | unchanged | unchanged | unchanged | unchanged |
| `WOUNDED_WORLD_PIN` `3748305113` | same | unchanged | unchanged | unchanged | **unchanged: the `beginRescue` refactor's witness** | unchanged | unchanged |
| `fire-support.test.ts` `HASH` `3036459314` | `packages/sim/src/` | unchanged | unchanged | unchanged | unchanged | unchanged | unchanged |
| **snapshot format pin `3512584427`** | `packages/sim/src/snapshot-witness.test.ts` | **moves** (fourteen `state` rows, encoded empty; cut-rows proof reads `3512584427`) | unchanged from T2 | unchanged | unchanged | unchanged | unchanged |
| **`FORMATION_WORLD_PIN` `2129900778`** | `determinism.test.ts` | unchanged (the new columns hold their empty values in a world that moves none of them; asserted) | **moves** (march, pace, dress, `ambush.json` legs, world extended) | **moves** (drills; the side-1 Column now halts) | **moves** (calls; world extended with an aircraft, a drone, a medic and wounds) | **moves** per lever kept (the world uses the shipped files) | unchanged |
| versus `match-world.test.ts` `PINS` beit `1075203618` / tel_marum `4263437644`; `VERSUS_ECONOMY_PINS` tel_marum `-87577684` / wadi_tarfan `955375532`; `per-seat-types.test.ts` `1311563748`; `versus-breach.test.ts` `4158212441` / `1075203618` / `4263437644` | app, tools | unchanged | unchanged | unchanged | unchanged | unchanged (no formation is ordered in them) | unchanged (opening orders nothing) |
| `shippedContentDigest()` | no literal | — | moves (`ambush.json`) | — | — | moves per lever | — |
| `snapshot-rejoin.test.ts` mirror-seed premise ("a NEGATIVE signed digest") | `packages/app/src/net/` | — | may re-roll | — | — | may re-roll | — |
| `pnpm playtest`: every plan 30/30, `LADDER_CREDITS` = `CAMPAIGN_CREDITS` `5973`, `ROSTER_MAX` `30` | `tools/src/backtest/playtest.ts`, `stores-model.ts` | byte-identical | byte-identical | byte-identical | byte-identical | byte-identical | byte-identical |
| `pnpm balance` §5.7 | `tools/src/balance` | identical | old lines identical; `urbanAttackFormation` re-read (S2) | same | same | same, re-read | — |
| versus offered cells, no-formation arm | report-only | identical | identical | identical | identical | identical | identical |
| golden visual | `tools/golden-baselines/` | unchanged (captures assert no selection, so no formation row or card draws) | unchanged | unchanged | unchanged | unchanged | unchanged |

About the `snapshot-rejoin.test.ts` row: P1a's precedent (`6fc859e9`) re-picks the seed and never touches the sim.
The file's own header prescribes that.

**The golden hash is not expected to move.** No golden world orders a formation, so `fmLive` stays false there. If
it moves, a new branch has leaked outside the latch, or a refactor was not byte-identical. That is S1, found by
undoing one edit at a time.

---

## Snapshot-witness coverage (P1a's CI red, not repeated)

P1a's PR failed `pnpm snapshot:witness -- --self-check` in CI with "FAILED (10)". The coverage census found ten
formation rows that never moved in any witness world, because no versus room orders a formation. It was fixed by
running the golden formation world in the matrix (`goldenFormations`, `tools/src/net/snapshot-witness.ts`). P1b's
rows get the same treatment, **task by task**, so that no push between tasks leaves the census red:

- **T2** appends the fourteen rows. Each one goes into `SNAPSHOT_COVERAGE_EXEMPT` with the reason "GH-859 P1b: moved
  by the formation world from Task <n>; delete then", naming the task that will move it.
  - T3: `fmLeg fgLegs fgRelease fgDress fgAtCp fgPace`.
  - T4: `fgQuiet fgCallX fgCallY`.
  - T5: `fmDuty fmHomeX fmHomeY fgAway fgCalled`.
  - The census fails an exemption whose row moved ("delete this exemption"). So each later task MUST delete its own
    entries, or its `--self-check` goes red. That is the falsification for free.
- **T3 deletes the existing `wpX wpY wpAttack wpSweep wpCount` exemption** ("no witness driver appends an order"),
  because the formation world's checkpoints now write waypoints. Its reason text is no longer true.
- **The formation world** (`formationSetup`/`formationDrive`, `golden-worlds.test-helper.ts`, shared by
  `FORMATION_WORLD_PIN`, the sim fork witness and the tools matrix) is extended so that every row moves:
  - T3: the Column's route gets at least two checkpoints and a slow member (the test-local mortar), so pace binds
    and a dress waits;
  - T4: the side-1 Column halts on contact, and the Attack meets a side-1 post, so it presses;
  - T5: the Attack takes a strike aircraft and a spot drone, and the Column a medic. The riflemen take a wound
    block with a test-local `wounded` type, so the casualty call runs.
  - The world may lengthen to at most 1200 ticks. Record the CI time delta of the `snapshot:witness` step.
- **The sim fork witness** (`snapshot-witness.test.ts`, "the formation world"). Each task re-scouts its cut ticks
  and asserts the state AT the cut, as P1a's T = 404 asserts `fgPending` 1. The cuts:
  - mid-dress: a member `WAIT` and `fgDress > 0`;
  - mid-pace: `fgPace > 0`, members moving;
  - pending: `fgPending` set;
  - in contact: state 3;
  - mid-sortie: an `OUT` aircraft with an intact queue;
  - mid-return;
  - a medic `OUT`.
  - Each cut gets a self-check: zero the asserted column in B, and the fork must go red. Keep P1a's rule: a cut
    whose zeroing is not red does not see the column and is re-picked.
- The **exercised** probe of `goldenFormations` gains the assertion that the world reached state 3 and at least
  one `OUT`. Otherwise "the formation world stopped calling".
- If versus opens (T11), the tools matrix gains one **versus mirror world with Attack orders**, so the room path
  (`buildMatchWorld` registration plus a formation order) is witnessed on the real restore.

---

## Pre-flight conflict table

| Pair / task | Produces → consumes | Finding | Ruling |
|---|---|---|---|
| T1 → T3/T5 | `routeWalk`, `checkpointsOf`, `aircraftCallOf`, `templateOffsets().ringRadius` | pure and unwired | T1 lands first, hash-neutral |
| T2 → T3–T5 | columns, constants, hash block, snapshot rows, temporary exemptions | T2 changes no behaviour | T2's byte identity, the format pin aside, is its proof |
| T3 → T4 → T5 | `finishLeg`'s hold, `advanceLeg`, `stepFormationMarch`, `fmPend(id, x, y)` | all three edit `finishLeg`, `fmPend`, `stepFormationContact` and the world helper | sequential, one implementer at a time on `sim.ts` |
| T5 → T7/T8 | the behaviour the probes read | — | sequential |
| T7 → T8 → T9 | `s4-gate.ts`, `--seed-from`, `--tunnel-cell`, the probes | T9 reuses T0's baselines (byte identity) | T0 takes the 192 + 192 baselines once |
| T5/T9 → T10 | read APIs, events, final copy | the UI reads, never re-derives | T10 may start after T5 against the APIs; its tooltip copy is final after T9 |
| T9 → T11 | the S4 verdict | versus opens only on PASS | T11 is conditional; it does not run on a STOP |
| this branch vs Wetland P4 (`feat/wetland-p4`) | `CLAUDE.md` (three three.js lines there, two sim lines here), the golden visual baseline (P4 moves it, P1b must not), `packages/data/src/index.ts` (`vfxEmitters` there; untouched here) | text-only overlap; P4 edits no sim and no app source | named sites only; merge `origin/main` before T13; a visual red after P4 lands is P4's bless, not ours (read the scenario) |
| this branch vs any new sim lane | `sim.ts`, `snapshot-schema.ts`, `determinism.test.ts`, `golden-worlds.test-helper.ts`, `tools/src/net/snapshot-witness.ts` | none open on 30 Oct | T0 re-runs `gh pr list --state open` and lists `_coord/*-progress.md`. On overlap, merge and re-read every pin |
| this branch vs the net lanes | `versus-formations.ts`, `frame-step.ts`, `room-pause.ts`, `mcp-tools.ts`, `two-client.test.ts` | none open | T11 edits only the closed-gate sites named in `sim-and-orders.md` |

---

## Task 0: pre-flight (record in `_coord/formations-p1b-progress.md`)

**Model:** Sonnet. No commit.

- [ ] **1. Worktree.** `/Users/ilpinto/dev/roaring-lions-ep/formations-p1b`, branch `feat/formations-p1b` (made with
  this plan). Run `pnpm install` once.
  - Run `git log d203f0237..origin/main --oneline -- packages/sim packages/net packages/app/src/net
    packages/app/src/ui packages/app/src/input data tools/src/net tools/src/backtest`, and record what moved.
  - A change at any named site means re-reading this plan's rulings before Task 2.
- [ ] **2. Pins.** Re-read every literal in the pin table:
  `grep -rnE 'toBe\([0-9]{8,}\)|_PIN = |PINS = |LADDER_CREDITS =|CAMPAIGN_CREDITS =|ROSTER_MAX =|const HASH' packages tools`.
  Note any value that differs.
- [ ] **3. Baselines** to `_coord/formations-p1b/baseline/`:
  - `pnpm test:determinism`, the full `pnpm test`, `pnpm balance` (both tiers), `pnpm playtest`,
    `pnpm snapshot:witness -- --self-check` (record its time), and `pnpm formations:probe` (the P1a S3 table on
    this base).
- [ ] **4. The S4 no-formation baselines, once, per seed.** They are byte-identical on the branch (G-2), so
  everything after reuses them.
  - Run them only after Task 7 has added `--seed-from`, `--tunnel-cell` and `--per-seed`. Until then, record only
    the cell list.
  - Cells: every offered cell under `sim-and-orders.md`'s bar invocation:
    - the mirror on the four fair maps (`kdf/kdf`);
    - KDF v Sarim placed on `tel_marum` and `wadi_tarfan`, both orders;
    - `--economy`, both maps and both orders;
    - `--tunnels` cell 3 (`answer`), both maps and both orders.
    - Record the exact list the probe prints. About 16 cells are expected.
  - Seed sets: n = 0..191 (set A) and n = 192..383 (set B), `seedOf(n)`.
  - Time the set-A base run per arm family. Those numbers size Task 8 and Task 9 (each S4 arm is three times a
    base).
- [ ] **5. Censuses.** Both run as scratch scripts outside the repo.
  - **Aircraft calls.** Run Ruling 12's rule over every `mobility.domain: "air"` unit. Expected:
    - `heli_peten` and `heli_peten_gunship`: strike;
    - `heli_yanshuf`: stay (seats);
    - `recon_drone`: spot;
    - `attack_drone` and `loiter_drone`: stay (kamikaze);
    - `drone_swarm`: stay (swarm);
    - `paramotor`: strike.
    - Record the JSON field that carries seats.
    - A disagreement is a Q-level report. Do not invent an override.
  - **Wound content.** List the shipped units carrying `wounds` (`inf_squad` and `inf_medic_squad` at least), and
    whether any shipped mission or versus room places them. The medic call is reachable in play only where they
    are placed.
- [ ] **6. Other streams.** Run `gh pr list --state open`, list `_coord/*-progress.md`, and check whether Wetland P4
  has a branch diff yet. Fill in the conflict table's overlap rows.

---

## Task 1: the pure march geometry, the aircraft call class, and two P1a minors (unwired, hash-neutral)

**Model:** Sonnet implementer; Sonnet reviewer. The `sim-guard` review is Task 6.

**Files:**
- `packages/sim/src/formation-template.ts`:
  - `routeWalk`, `checkpointsOf`, `aircraftCallOf`;
  - `FM_CALL_STRIKE|SPOT|STAY`;
  - `CompiledFormation.legs` (a boolean; `false` compiles to one checkpoint);
  - `templateOffsets` also returns `ringRadius` (M3, the sim half);
- `packages/sim/src/formation-template.test.ts`;
- `packages/sim/src/index.ts`: export the new pure API, plus `FM_MARCH`, `FM_CONTACT` and `FM_SPRUNG`. The app
  copies the number 4 today; Task 10 drops the copy.

**Interfaces.**

```ts
export const FM_CALL_STAY = 0; export const FM_CALL_STRIKE = 1; export const FM_CALL_SPOT = 2;
/** Follow a flow field's dirs (DIR_DX/DIR_DY) from (sx, sy) to (gx, gy), one tile per step. Returns the tiles AFTER the
 *  start, the goal last, or null when the walk meets DIR_NONE or takes w*h steps without arriving (Ruling 1). */
export function routeWalk(dirs: Uint8Array, w: number, h: number, sx: number, sy: number, gx: number, gy: number): Int32Array | null;
/** Indices into the route (0-based) of each checkpoint: spacing S = max(legTiles, ceil(L / budget)), the last always L - 1
 *  (Ruling 2). legTiles 0 (legs false) gives [L - 1]. L 0 gives []. */
export function checkpointsOf(routeLength: number, legTiles: number, budget: number): number[];
/** Ruling 12. Throws `unit <id>: ...` on a value it cannot read. */
export function aircraftCallOf(json: UnitCallJson): number;
```

- [ ] **Step 1: failing tests.** Every expected value is a literal.
  - **`routeWalk`**:
    - a hand-built 6 × 6 dirs grid with a dog-leg: the literal tile list;
    - the start on the goal: an empty list;
    - a `DIR_NONE` cell on the path: `null`;
    - a 2-cell cycle: `null` at w × h steps.
  - **`checkpointsOf`** (budget 9): L 0 → `[]`; 1 → `[0]`; 8 → `[7]`; 9 → `[7, 8]`; 16 → `[7, 15]`;
    17 → `[7, 15, 16]`; 100 → spacing 12 → `[11, 23, 35, 47, 59, 71, 83, 95, 99]`. Also `legTiles` 0 with L 30 →
    `[29]`, and a count assertion over the table (eight rows).
  - **`aircraftCallOf`**: the T0 census table, written out for every shipped air unit, read from
    `../../../data/units/**` by relative path. A count assertion of the air units.
  - **`templateOffsets().ringRadius`**: Ambush with 6 ring members → 3, with 17 → 4. Column → 0.
  - **M7b:** for the 50 units of P1a's class table, also assert `unitTypeFromJson(json).fmClass` (or the sim's own
    type builder) against the same literal table. A `FOOT_ROLES` change then reaches the test.
  - **Compile:** `legs: false` compiles to `legTiles` 0. `ambush.json` still compiles (its edit is Task 3).
- [ ] **Step 2: implement.** Nothing in `sim.ts` changes.
- [ ] **Step 3: gates (G-7).** `test:determinism` unchanged. `balance` and `playtest` byte-identical.
- [ ] **Step 4: mutations** (G-5), each red and quoted:
  - M-1a: `routeWalk` swaps `DIR_DX` and `DIR_DY` (the dog-leg list reds);
  - M-1b: `checkpointsOf` drops the `ceil` (floor: L 100 gives spacing 11; the 100 row reds);
  - M-1c: `checkpointsOf` drops the forced last checkpoint (the 17 row reds);
  - M-1d: `aircraftCallOf` ignores the `swarm` block (`drone_swarm` reds);
  - M-1e: `templateOffsets` returns `ringRadius` 0 (reds);
  - M-1f: remove `'sniper'` from the sim's `FOOT_ROLES` (the M7b assertion reds on `sniper_team`, where the old
    literal-only test stayed green).
- [ ] **Step 5: commit** `sim: formation march geometry and aircraft call class, pure (GH-859 P1b)`.

---

## Task 2: the state — fourteen columns, constants, hash fold, snapshot rows, exemptions (no behaviour)

**Model:** Sonnet implementer (`sim-guard` agent type, `model: sonnet`).

**Files:**
- `packages/sim/src/sim.ts`: the columns of Ruling 18, after `fgMembers`; `UnitType.fmCall` set in the type
  builder; `FM_CONTACT`, `FM_DUTY_*` and `FM_PEND_*`; the hash block;
- `packages/sim/src/snapshot-schema.ts`: fourteen rows, appended;
- `packages/sim/src/snapshot-schema.test.ts` and `snapshot.test.ts`: the tail column names, as P1a did. That
  follows the table's tail; no assertion is loosened;
- `tools/src/net/snapshot-witness.ts`: the temporary exemptions (see "Snapshot-witness coverage");
- `packages/sim/src/snapshot-witness.test.ts`: the format pin, in its own commit.

- [ ] **Step 1: the completeness gate goes red first.** Add the columns without schema rows, run
  `snapshot-schema.test.ts`, and quote the red. Then add the rows.
- [ ] **Step 2: tests** (`formation-state.test.ts`):
  - A world with the formations registered and multi-unit moves without `formation` hashes, over 600 ticks, equal
    to its unregistered twin. This is P1a's twin, extended by the new columns.
  - **Each new column feeds the hash while `fmLive`.** Order one formation, then write a value into each new column
    through `internals`. The hash changes, column by column. That is fourteen assertions plus a count.
  - **The P1a formation world leaves every new column at its empty value** at tick 600 on T2's code. That is the
    reason `FORMATION_WORLD_PIN` must not move in this task.
  - `fmCall` reads the T1 table for three units.
- [ ] **Step 3: gates (G-7).**
  - Every determinism pin is unchanged, `FORMATION_WORLD_PIN` included.
  - The format pin reds. Prove the move is exactly the new rows: cut them from the table in a scratch edit, read
    `3512584427`, and undo the edit. Record both numbers.
  - `snapshot:witness -- --self-check` is green with the temporary exemptions.
- [ ] **Step 4: mutations.**
  - M-2a: the P1b arrays folded outside the `fmLive` guard. The golden flat pin reds (zeros folded).
  - M-2b: `fgCallY` left out of the hash block. Its "feeds the hash" assertion reds.
  - M-2c: one exemption deleted early (`fgDress`). The census reds: "never moved".
- [ ] **Step 5: commits.**
  - `sim: formation march and call state, latched and unhashed until ordered (GH-859 P1b)`;
  - then, alone, `test(sim): snapshot format pin, the P1b formation rows (GH-859 P1b)`, carrying
    "Was 3512584427." and the cut-rows proof.

---

## Task 3: the march — route, checkpoints, dress, pace, final reservation, facing on the final leg

**Model:** Sonnet implementer (`sim-guard` agent type, `model: sonnet`).

**Files:**
- `packages/sim/src/sim.ts`;
- `packages/sim/src/formation-march.test.ts` (new);
- `data/formations/ambush.json` (Ruling 3);
- `golden-worlds.test-helper.ts`, `determinism.test.ts` and `snapshot-witness.test.ts` (world, pin, cuts);
- `tools/src/net/snapshot-witness.ts`: delete T3's exemptions and the `wp*` one.

**Sites, by symbol.**
1. **`applyMove`, template branch.** After `assignTemplate` is replaced by the per-checkpoint loop (Rulings 1, 2
   and 4):
   - route field, `routeWalk`, `checkpointsOf`;
   - one `assignTemplate` per checkpoint;
   - the final checkpoint with `reservedTilesFor`.
   - The write loop writes goal = checkpoint 1 and waypoints 2…n, each with the order's `attack` and `sweep`.
   - `fmJoin` then also writes `fgLegs`, `fgRelease = 0`, `fmLeg = 1`, `fgPace` (Ruling 8), and the `travel`
     facing (Ruling 9).
   - **With `tplIdx === -1` nothing here runs.** The P1a fast-path for `append` stays one checkpoint (Ruling 2).
   - M6: `tCount` over distinct ids (Ruling 16).
2. **`finishLeg`.**
   - Extract the `queued > 0` branch as `advanceLeg(i)`, byte-identical.
   - Prepend `if (this.fmLive && this.fmGroup[i] >= 0 && this.fmMarchHold(i)) return;`. `fmMarchHold` implements
     Ruling 6 and keeps `fmLeg` in step: `fmLeg++` on every advance.
3. **`stepMovement`.**
   - Extract the base-step expression as `baseStep(i)`, byte-identical.
   - Add Ruling 8's cap after it.
4. **`reservedTilesFor`.** Ruling 5's read.
5. **`stepFormationMarch()`.** New. It runs right after `stepMovement()` in `tick()`, behind `fmLive`:
   - advance `fgDress` on `MARCH` rows with `fgAtCp > 0`;
   - release per Ruling 7.
   - The quiet clock is Task 5's.
6. **`stepFormationFacing`.** Ruling 9's gate.
7. **Event.** `| { kind: 'formationReleased'; tick: number; side: number; group: number; leg: number; legs: number }`.
   `tsc` lists every exhaustive consumer, the `EVENT_KINDS` list among them.
8. **Read APIs,** scalar and allocation-free:
   - `formationLegOfGroup(g)`: the checkpoint now dressing, `fgRelease + 1`, capped at `fgLegs`;
   - `formationLegsOfGroup(g)`;
   - `formationPaceOfGroup(g)`: `Fx`, 0 for none;
   - `formationPaceSetterOf(g)`: the id, recomputed (argmin `baseStep` over living ground members not on a call,
     lowest id), or −1.

- [ ] **Step 1: failing tests** in `formation-march.test.ts`. Hand-built maps, literal expectations.
  - **Byte identity.** P1a's registered-twin case, re-run (no formation: identical).
  - **Route and checkpoints.** A 6-unit Column ordered 30 tiles up an open map:
    - `formationLegsOfGroup` = 4 (spacing 8: steps 7, 15, 23, 29);
    - every member's goal is checkpoint 1's slot, and its `wpCount` is 3;
    - the slot tiles are literals.
  - **The street.** The same Column through a one-tile corridor: one file at every checkpoint (literal tiles).
  - **No route.** A click with no path from the centroid gives one checkpoint and P1a's slots, read back.
  - **Budget.** A 100-tile route (a 64-wide map) gives 9 checkpoints and `wpCount` 8.
  - **Append.** A shift-appended formation order adds one waypoint per member (P1a).
  - **Pace.**
    - A Lavi and a test-local slow team in one Column: after 100 ticks, the Lavi's distance travelled equals the
      slow team's within one step, and equals `formationPaceOfGroup` × ticks (literal `Fx`).
    - The same pair in a plain move: the Lavi is far ahead (literal).
    - `formationPaceSetterOf` names the slow team.
    - An aircraft member is not capped.
  - **Dress.**
    - Four members, one held back by a hand-placed blocking hull: the three arrivals read `WAIT` and keep
      `moving` 1. Release comes `dressTicks` (60) after the first arrival, plus the one-tick delay (literal tick).
    - With nothing in the way, release comes on the tick after the last arrival (literal).
    - A straggler arriving after release passes straight through (`fmLeg` advances in the same tick).
  - **No stray walk.** A waiting attack-mover with a remembered contact does not move during the hold. That is the
    `stepSweep` hazard of Ruling 6, pinned.
  - **Facing.** A Column hull holds its travel facing through a dress halt (no turn), and turns to its rest facing
    only on the final checkpoint.
  - **`travel`.** A Column arriving diagonally faces the eighth-turn of its last leg (literal 8192 for a
    south-east approach), not the axis.
  - **Final reservation.** A plain order issued while a Column marches cannot put a slot on a member's final tile
    (read back).
  - **Exits.** For each P1a exit, a `WAIT` member leaving decrements `fgAtCp` (literal before and after), and a
    freed row zeroes every new column.
  - **M6.** `[a, a]` does not meet `min_members` 2, so it is a plain order (`formationGroupOf === −1`).
- [ ] **Step 2: implement.**
- [ ] **Step 3: the world, the pin and the cuts** (see "Snapshot-witness coverage", T3).
  - Extend the world. Re-read the P1a world facts per G-6, then add assertions: legs per group, one dress released
    by timeout, and the Column's pace equal to the mortar's step.
  - Re-scout the fork cuts and add mid-dress and mid-pace.
- [ ] **Step 4: gates (G-7).**
  - Every pin except `FORMATION_WORLD_PIN` is unchanged, and the golden hash especially.
  - `balance` old lines and `playtest` are byte-identical.
  - `snapshot:witness -- --self-check` is green, with T3's exemptions and the `wp*` one deleted.
- [ ] **Step 5: mutations**, each red and quoted:
  - M-3a: `fmMarchHold` always false (the dress cases red);
  - M-3b: the pace cap removed (the pace case reds);
  - M-3c: release on timeout disabled (the blocked-hull case never releases);
  - M-3d: `fgAtCp` incremented on every re-arrival tick, not once (an early release reds);
  - M-3e: Ruling 5's read removed (the final-reservation case reds);
  - M-3f: Ruling 9's gate removed (the hull turns at the dress halt);
  - M-3g: `travel` as the axis frame (the diagonal case reds);
  - M-3h: `waiting members keep moving 1` replaced by `moving = 0` (the stray-walk case reds);
  - M-3i: `tCount` over raw ids (the M6 case reds);
  - M-3j: `checkpointsOf` called with budget 10 (the budget case reds).
- [ ] **Step 6: commits.**
  - `sim: formations march — checkpoints, dress, pace, final reservation (GH-859 P1b)`;
  - then, alone, `test(sim): FORMATION_WORLD_PIN, the march (GH-859 P1b)`, with "Was 2129900778." and every
    re-read world fact.

---

## Task 4: contact and the drills — `halt`, `press`, the widened hook, the quiet clock

**Model:** Sonnet implementer (`sim-guard` agent type, `model: sonnet`).

**Files:**
- `packages/sim/src/sim.ts`;
- `packages/sim/src/formation-contact.test.ts` (new);
- `tools/validate_formations.mjs` and `tools/src/validate_formations.test.ts` (the `drill.halt` key);
- `packages/app/src/i18n/en.json` (`hud.formation.drill.halt` only, so `validate:data` stays green);
- the world, the pin and the cuts;
- `tools/src/net/snapshot-witness.ts` (T4's exemptions deleted).

**Sites.**
1. `fmPend(id, x, y)` (Ruling 10). Every caller passes a point. The grepped `fire` sites are listed in the ledger.
2. `stepFormationSpring` is renamed `stepFormationContact` (Ruling 11). Its position in `tick()` is unchanged.
3. `stepFormationMarch`: `fgQuiet` counts on rows in `CONTACT` or `SPRUNG`. Only Task 5 reads it.
4. **Event.** `| { kind: 'formationContact'; tick: number; side: number; group: number; entity: number; x: Fx; y: Fx; drill: number }`.

- [ ] **Step 1: failing tests.**
  - **Halt.** A 6-unit Column marching past a side-1 rifle post:
    - on the tick after the first hostile hit, every ground member reads `moving` 0 and `wpCount` 0, and state 3;
    - the vehicles' `restFacing` is the eighth toward the post (literal);
    - one `formationContact`, naming the first member hit;
    - the march does not resume after 30 s of quiet (D9);
    - infantry members brace to fire (`BRACE_*` seen).
  - **Contact by firing first.** The same, with the post placed so that a Column member fires before it is hit.
    The fire site marks it.
  - **Press.** An Attack reaching a post:
    - state 3, and no member `WAIT` afterwards;
    - pace unchanged (literal);
    - every member continues to its final slot;
    - one `formationContact`.
  - **Spring.** P1a's springing-together cases, unchanged, plus: a ring found while marching releases dressing.
  - **Friendly fire is not contact.** A friendly mortar's splash on a Column member marks nothing (P1a's M-4b,
    kept).
  - **Quiet.** `fgQuiet` resets on a later hit while in `CONTACT` (literal reads before and after).
  - **Reach.** A sniper hitting the Column from 15 tiles marks the drill and leaves the call bit clear.
  - **Validator.** A fixture with `drill: halt` and no `hud.formation.drill.halt` key fails.
- [ ] **Step 2: implement.**
- [ ] **Step 3: the world, the pin and the cuts** (T4).
  - The side-1 Column halts. The Attack meets a side-1 post and presses.
  - Re-read the world facts; add state 3 for both groups and two `formationContact` events.
  - Add a cut at "in contact".
- [ ] **Step 4: gates (G-7).** As in Task 3.
- [ ] **Step 5: mutations**, each red and quoted:
  - M-4a: no `fmPend` at `fireAt` (the fire-first case reds);
  - M-4b: `applySuppression` passes (0, 0) as the point (the halt facing reds);
  - M-4c: `halt` keeps the queue (the halt case reds);
  - M-4d: `press` keeps dressing (a `WAIT` member remains);
  - M-4e: the hostility test dropped (the friendly case reds);
  - M-4f: `fgQuiet` not reset by later contacts (reds);
  - M-4g: the reach measured from the aircraft (the sniper case reds: the bit is set);
  - M-4h: the validator keeps the `halt` exemption (the fixture passes).
- [ ] **Step 6: commits.**
  - `sim: formation contact — halt, press, the widened contact hook (GH-859 P1b)`;
  - then, alone, the `FORMATION_WORLD_PIN` re-pin.

---

## Task 5: the calls — aircraft sorties and their return, the medic's answer

**Model:** Sonnet implementer (`sim-guard` agent type, `model: sonnet`).

**Files:**
- `packages/sim/src/sim.ts`;
- `packages/sim/src/formation-calls.test.ts` (new);
- the world, the pin and the cuts;
- `tools/src/net/snapshot-witness.ts` (the last exemptions deleted).

**Sites.**
1. **`stepFormationContact`.** With the call bit set (Ruling 12): the aircraft sorties, then `fgPending = 0`.
2. **`finishLeg`.** Before `fmMarchHold`:
   - an `OUT` member stops and returns, keeping its queue;
   - a `RETURN` member becomes `NONE` (Ruling 13) and falls through to the march logic.
3. **`stepFormationMarch`.** The quiet return (Ruling 13).
4. **`woundCrossings` and `fallMan`.** The captured group, and the casualty call (Ruling 14).
5. **The `rescue` branch.** Extract `beginRescue(id, w, keepQueue)`, byte-identical for the command.
6. **`medicIdle`.** `fmReturnHome` for a member medic that is `OUT`.
7. **`fmForget`.** The counters (Ruling 15).
8. **Event.** `| { kind: 'formationCall'; tick: number; side: number; group: number; entity: number; call: 'strike' | 'spot' | 'casualty' | 'return' }`.
9. **Read API.** `formationDutyOf(id)`.

- [ ] **Step 1: failing tests.**
  - **Strike.** An Attack with a test-local strike helicopter at standoff meets a post:
    - the next tick, the helicopter's goal is the call point's tile centre, with `attackMove` 1 and `sweepOrder` 0;
    - `fmDuty` `OUT`, its `wpCount` unchanged, `fmHome` its old goal (literal);
    - one `formationCall`.
  - **Spot.** A test-local unarmed drone gets the same with `attackMove` 0.
  - **Stay.** A seated helicopter and a kamikaze drone in the same Attack do not move.
  - **Arrival.** The striking helicopter stops at the point. It does not fly on to its next checkpoint (read 40
    ticks later).
  - **Return.** 10 s after the last contact (literal tick):
    - goal `fmHome`, `attackMove` 0, duty `RETURN`;
    - on arrival, duty `NONE`, and it continues its queue to its final slot.
  - **Recall.** A new contact after the return calls again. A contact while a sortie is out does not call twice.
  - **Override.** A player move to the helicopter on its sortie takes it out of the group: `fgAway` decrements and
    the row's counts are literal.
  - **Medic.** A Column of riflemen (wound block, test-local `wounded` type) with a medic at the tail:
    - a member's man falls, and the nearest free medic within 12 gets the rescue (`medTarget` = the wounded),
      duty `OUT`, keeping its queue;
    - after delivery it returns home and rejoins;
    - the squad's last man is answered too (Ruling 14);
    - a medic 13 tiles away does not answer;
    - the ambulance never moves.
  - **The `rescue` command is unchanged.** `WOUNDED_WORLD_PIN` holds, and the existing `wounded.test.ts` is green,
    untouched.
- [ ] **Step 2: implement.**
- [ ] **Step 3: the world, the pin and the cuts** (T5).
  - Add a strike aircraft and a spot drone to the Attack, and a medic with wound content to the Column.
  - Add assertions: at least one `OUT` of each kind, one return, one casualty answered.
  - Add cuts at mid-sortie, mid-return and medic `OUT`.
  - The `goldenFormations` exercised probe gains "state 3 and at least one `OUT`".
- [ ] **Step 4: gates (G-7).** `snapshot:witness -- --self-check` green, with no P1b exemption left.
- [ ] **Step 5: mutations**, each red and quoted:
  - M-5a: strike sent as a move (`attackMove` 0, reds);
  - M-5b: `stay` aircraft sortie (reds);
  - M-5c: the `OUT` intercept removed from `finishLeg` (the helicopter flies on);
  - M-5d: the quiet return never sent (reds);
  - M-5e: the return as an attack-move (the return case reds: it stops at the post);
  - M-5f: the farthest medic picked (reds);
  - M-5g: `beginRescue` keeps `wpCount` for the command too (`WOUNDED_WORLD_PIN` or `wounded.test.ts` reds);
  - M-5h: `fgAway` not decremented in `fmForget` (the override case: the row never frees);
  - M-5i: no captured group in `woundCrossings` (the last man goes unanswered).
- [ ] **Step 6: commits.**
  - `sim: formation calls — strike and spot sorties, the medic's answer, the quiet return (GH-859 P1b)`;
  - then, alone, the `FORMATION_WORLD_PIN` re-pin.

---

## Task 6: `sim-guard` review of Tasks 1–5

**Model:** Sonnet (`sim-guard` agent type, `model: sonnet`). It reads Tasks 1–5 as one diff, with this plan.

- [ ] **Review focus**:
  - the invariants;
  - the latch: every new read behind `fmLive`;
  - byte identity: every refactor, every branch;
  - the exit funnel and the counters: `fgAtCp`, `fgAway` and `fgMembers` never drift; it constructs one case
    each;
  - per-tick cost: no O(count) per tick outside an event;
  - snapshot classes, and the census deletions;
  - the G-6 re-reads, each justified.
- [ ] Fix the findings in their own commits, each with its falsification. Re-run G-7 and
  `snapshot:witness -- --self-check`. Record the findings and fixes in the ledger.

---

## Task 7: the instruments — the paired S4 gate, probe flags, the call, Ashwar, march and perf probes

**Model:** Sonnet (`balance-analyst` agent type, `model: sonnet`); Sonnet reviewer.

**Files:**
- `tools/src/backtest/versus-probe.ts`:
  - `--seed-from=<n>` (seeds n…n+seeds−1, `seedOf` unchanged);
  - `--tunnel-cell=<off|noAnswer|answer|turtle>` (one cell, no routeless twin);
  - `--per-seed=<file>`: per cell, per seed, the winner end, how it ended, and the ticks, as JSON.
- `tools/src/backtest/s4-gate.ts` (new) and `s4-gate.test.ts`. `tools/package.json` gains
  `"s4:gate": "tsx src/backtest/s4-gate.ts"`.
- `tools/src/backtest/formation-probes.ts` and `.test.ts`: the new arms below.
- `tools/src/backtest/vehicle-overlap-probe.ts`: a `--formation=column` arm.
- `tools/src/perf/formation-march.ts` (new; sim-only, node): `pnpm --filter @lions/tools perf:formations`.
- `tools/src/backtest/formation-playtest.ts` (new; report-only, §8.5). The shipped plans stay untouched, so
  `pnpm playtest` stays byte-identical.

**The S4 gate (`s4-gate.ts`): the lead's ruling, made exact.** Q1 asks the lead to confirm this reading.
- It reads base per-seed files (Task 0, sets A and B) and plays the arms on the same seeds. The arms are:
  - (b) both ends in `--formation=attack`;
  - (c) `--formation-end=friendly`;
  - (c) `--formation-end=hostile`.
- A share is wins over all seeds, as the probe defines it (a draw is no one's).
- **(b), per cell.** S is the arm's leading-end share, B the same end's base share on the same seeds.
  - S ≤ 55% → PASS.
  - 55% < S ≤ 65% at set A → RERUN: play set B and judge the pooled 384 seeds. Pooled S ≤ 60 → PASS; above that,
    the baseline clause.
  - S > 65% at set A → the baseline clause.
  - **Baseline clause:** TRIP, unless B is itself above 60% for that end and the paired sign test does not show a
    shift toward that end (two-sided p ≥ 0.05, or more flips away than toward). That cell was outside before any
    formation, and the formation did not make it worse.
- **(c), per cell and formed end.** S is the formed end's share, B the same end's base share.
  - S ≤ 60 → PASS.
  - 60 < S ≤ 70 → RERUN at set B, judged pooled against 65.
  - S > 70 → the baseline clause against 65.
- **The sign test.** Exact two-sided binomial over the discordant seeds (a toward, b away):
  p = min(1, 2 · Σ_{k ≤ min(a,b)} C(a+b, k) / 2^(a+b)).
- **The output.** Per cell and arm:
  - set and seeds, B, S, Δ, flips toward and away, p;
  - the verdict: `PASS`, `RERUN`, `TRIP`, or `PASS (baseline outside, not worse)`.
  - The exit code is 0 when everything passes, 1 on any TRIP, and 3 when a RERUN is still unplayed.
- **Pairing guard.** The gate refuses (exit 2) when an arm's seed list differs from its base's. So does a base file
  whose cell list differs from the arm's.

**The probes (report-only, §8.3, 8.4, 8.6, 8.9).**
- **Medic (§8.4).** F2 Attack and F1 Column with riflemen carrying wounds and two medics, against a rifle post, 60
  seeds. Paired arms: the formation, and the same force with no formation. Report:
  - time from `woundedDown` to treatment start;
  - bleed-outs;
  - medic losses per engagement;
  - the share of casualties no medic was in reach of (Ruling 14).
- **Air (§8.4).** A gunship on call in an Attack, against the same gunship ordered in the hull rank (no formation),
  both facing a MANPAD team, 60 seeds. Report the sortie response time (contact to the first gunship shot) and
  aircraft survival.
- **Ashwar (§8.3, GDD §5.7).** An unspotted RPG team in `ambush(3)` on a road, against a four-vehicle F1 Column, 60
  seeds. Paired with the same force on a plain move. Report the share of engagements where the team's first volley
  is fired before it is identified (target ≥ 80%; report-only).
- **Ambush re-run (§8.3).** P1a's three arms and three geometries, with march and calls live. Report P1a's
  columns, plus aircraft sorties.
- **Overlap (§8.9).** `vehicle-overlap-probe` transit pair-ticks for an F1 march against the same group without a
  formation.
- **Perf (§8.6).** 300 units in 15 groups of 20 marching F1 on `qarn_hadid`. Three runs. Report:
  - the median tick-time delta against the same orders without `formation`;
  - the worst checkpoint-activation tick;
  - the `flowFieldCount` peak.
  - The proposed bars are ≤ 1 ms median and ≤ 5 ms worst.
- **Playtest variants (§8.5).** Beit Sahwan IV (`beit_sahwan_4_subterranean`), Tel Marum II
  (`tel_marum_2_foothold`) and Qarn Hadid III (`qarn_hadid_3_clearance`). The scripted plan's main-body order
  carries each MVP formation in turn, at 30 seeds. Report the verdict, minutes and ROE.

- [ ] **Step 1: failing tests.**
  - `s4-gate.test.ts`, on fabricated per-seed tables:
    - 74% with flips 21/7 → TRIP, with p printed as `0.0125` (literal, 4 dp);
    - 54% → PASS;
    - 58% at set A → RERUN; pooled 59% → PASS; pooled 62% with base 49% → TRIP;
    - base 67% and arm 68% with flips 6/7 → PASS (baseline outside, not worse); with flips 20/5 → TRIP;
    - (c) 66% → RERUN; 71% → TRIP;
    - mismatched seeds → exit 2.
    - Sign test literals: (21, 7) → 0.01254; (0, 0) → 1; (5, 0) → 0.0625; (3, 3) → 1.
    - A count assertion over the case table.
  - `versus-probe.test.ts`:
    - `--seed-from=192 --seeds=2` plays `seedOf(192)` and `seedOf(193)`, and a set-B game differs from set A's game
      at the same index;
    - `--tunnel-cell=answer` plays one cell;
    - `--per-seed` writes one row per seed.
  - `formation-probes.test.ts`: non-vacuity only.
    - The medic arm reads at least one treatment.
    - The air arm reads at least one sortie.
    - The Ashwar arm reads at least one engagement and both outcomes across its seeds.
    - The A/B arms are different games.
  - The perf probe's test: the formed arm really formed (15 groups live at tick 1), and the plain arm formed none.
- [ ] **Step 2: implement.**
- [ ] **Step 3: mutations.**
  - M-7a: the rerun band ignored (the 58% case passes at once);
  - M-7b: the baseline clause ignored (the 67/68 case trips);
  - M-7c: a one-sided sign test (the (21, 7) literal reads 0.0063);
  - M-7d: `--seed-from` ignored (the set-B game equals set A's);
  - M-7e: the pairing guard removed (the mismatch case exits 0).
- [ ] **Step 4: commit** `tools: the paired S4 gate, probe seed sets, call, Ashwar, march and perf probes
  (GH-859 P1b)`.

---

## Task 8: measurement, run 1 — byte identity, urban, the probes, and S4 on the shipped layouts

**Model:** Sonnet (`balance-analyst` agent type, `model: sonnet`). Sequential, one heavy run at a time. Outputs go to
`_coord/formations-p1b/t8/`.

- [ ] **1. Byte identity (S1).** Diff the branch head against Task 0's baselines:
  - `test:determinism`, `pnpm test`, `balance` (old lines) and `playtest`;
  - the no-formation `versus:probe` on every offered cell at set A, through `--per-seed`, diffed seed for seed.
  - Then apply P1a's verb-matched M-4a in a scratch edit ("absent formation = the verb's formation"), re-run the
    Beit mirror at 12 seeds, and quote the move. Undo the edit.
- [ ] **2. Urban in Attack (S2; gated with the existing band).** `pnpm balance`, both tiers.
  `urbanAttackFormation` must stay inside `urbanRatio`'s band with 2:1 ≥ 15 pp below 3:1.
  - Now pace and dress can act. Report whether the arm still equals the plain one seed for seed. The M7a note: if
    it still does, the PR says the gate still cannot fail through placement.
  - A failure is S2: stopped for the lead, never retuned.
- [ ] **3. The probes (S3, report-only):** medic, air, Ashwar, the ambush re-run, overlap, perf (S6) and the
  playtest variants.
- [ ] **4. S4, layout L0** (the shipped files). Run `s4:gate` on every offered cell at set A, with each RERUN
  played at set B.
  - Record the table and, for every cell that is not a plain PASS, the S4 diagnosis's mechanism read: the Namer
    kill accounting through `trace`, re-run on that cell.
  - **If L0 passes, skip Task 9's lever arms.** Task 9 then only records "no lever needed".

---

## Task 9: the layout levers (the lead's two, in order; data only)

**Model:** Sonnet (`balance-analyst`, `model: sonnet`) measures. A Sonnet implementer makes the data edit and the
re-pin. Outputs go to `_coord/formations-p1b/t9/`.

**The levers.** They are edits to `data/formations/attack.json`, and both factions share the file (G-11, Q4).
- **L1, the gun-truck line.**
  - The `light_vehicle, recon` element: `max_lateral` 6 → 2. A rank of 3 (lateral 0, ±2), so 6 trucks stand in 2
    ranks 3 deep and not 1 rank 12 wide. This is the diagnosis's "trucks 3 wide", which recovered about half of the
    wadi_tarfan shift.
- **L2, the aircraft standoff.** The `aircraft` element: `standoff` 13 → 7, and 13 → 0, where the aircraft stack
  behind the medics by `gap` only.
  - The diagnosis measured "aircraft in the hull rank" as worth 9–10 pp either way. With P1b's calls, a closer
    station also shortens the sortie.
- **Forbidden:** hulls behind the infantry (the lead's ruling), widening any bar, any lever not named here, and
  any engine change.

- [ ] **1. Screen** at set A, on the cells that were not a plain PASS at L0 plus the four mirror cells. The arms
  are L1, L2 at 7, L2 at 0, L1 + L2 at 7, and L1 + L2 at 0, each made in memory, the way the diagnosis's `run2.ts`
  did. Record the table.
- [ ] **2. Pick** the arm with no TRIP and the fewest RERUNs on the screen. Ties go to the smaller edit: L1 alone,
  then L2 alone. **No arm clean → S4: STOP for the lead**, with the screen table and the per-cell mechanism.
- [ ] **3. Apply** the pick to `attack.json`. Then:
  - `formations_place.test.ts` (spacing, no tile twice, the 345 count) must stay green, untouched;
  - `validate:data`;
  - the urban arm (S2) re-run;
  - the ambush probe is unaffected (another file).
  - Commit `data: attack formation layout, lever <L> (GH-859 P1b)`, carrying the screen numbers. Then, alone, the
    `FORMATION_WORLD_PIN` re-pin. Re-pick the `snapshot-rejoin` seed if its premise re-rolls (P1a precedent).
- [ ] **4. The full re-gate:** `s4:gate` on EVERY offered cell, at set A plus set B for each RERUN, on the committed
  file. **PASS on every cell → Task 11 runs. Any TRIP → S4.**

---

## Task 10: the UI — card, chip, pace and call lines, alerts, tooltip clauses, and the P1a minors

**Model:** Sonnet (`render-vfx` agent type, `model: sonnet`); Sonnet reviewer.

**Files:**
- `packages/app/src/ui/formation-model.ts`, `formation-view.ts` and `formation-sim.ts`, with their tests;
- `packages/app/src/ui/hud.ts`, `alerts.ts` and their tests;
- `packages/app/src/input/formation.ts`, `formation-arming.ts` and their tests;
- `packages/app/src/i18n/en.json`;
- `tools/src/net/mcp-tools.ts` and its test (M8).

**Lines** (the approved mock, now true):
- `hud.card.formation.column.cp` "In column — checkpoint {n} of {m}", and `…attack.cp` "In attack formation —
  checkpoint {n} of {m}". These replace P1a's plain lines while marching; the plain lines stay for a one-checkpoint
  group;
- `hud.card.formation.pace` "Pace {pace} t/s, set by {unit}", dim, beneath. The unit name comes through the
  existing unit-label accessor, and the pace from `formationPaceOfGroup` (`Fx` × 20 / 65536, one decimal);
- `hud.card.formation.onCall` "On call" for an aircraft or medic member at its station;
  `hud.card.formation.answering` "Answering a call" for duty `OUT` or `RETURN`;
- `hud.card.formation.contact.column` "Column in contact"; `…contact.attack` "In contact — pressing on";
- `hud.card.formation.degraded` "In formation (no march)" for a template member with no group (a full table);
- `selection.chip.formation.column.cp` "{n} in column · cp {k}/{m}", and the same for attack;
- the alerts, own side only, one line per event, matching the family's casing: `alert.formationContact`
  "column in contact" (a `halt` group only), and `alert.formationCall` "{unit} answering the call" (strike and spot
  only; a medic's answer raises none);
- the tooltip composes its lines from the compiled file: `drill.<drill>`, plus `hud.formation.pace` when pace is
  not none, plus `hud.formation.call.<on_call>` for each element that has one.

**The P1a final-review minors:**
- **M3:** `schematicRing` draws `templateOffsets().ringRadius` (Task 1), never a hard-coded 3..6.
- **M5:** `formationIds` filters `routed`, and the resolver counts class ≠ none. The row and the sim then agree on
  "too few".
- **M8:** the agent `order` tool's description says formations are refused in versus rooms while closed. The
  refusal carries a named detail `formations-closed-in-versus`, not a bare `invalid`.
- **M10:**
  - R/T/Y with no row post nothing;
  - a press on an inert key leaves another armed formation armed;
  - the arm note is retired on spend and on disarm;
  - `hud.formation.inert.needsTwo` becomes `hud.formation.inert.needsMin` "Needs {n, plural, one {# free unit}
    other {# free units}}", with n = `min_members`.
- The copied `4` for sprung goes. The app reads `FM_SPRUNG` and `FM_CONTACT` from `@lions/sim`.

- [ ] **Step 1: failing tests** (jsdom and node):
  - each card line in its state, from a stepped sim: a marching Column, a dressing Column, a halted Column, an
    Attack pressing, an aircraft on call and then answering, a medic answering, a degraded member;
  - the chip "6 in column · cp 2/4";
  - the pace line names the slow team;
  - each alert once per event, and none for the enemy side;
  - the tooltip clauses per file;
  - M3, M5, M8 and M10, one case each;
  - the pseudo check: every new text node is bracketed;
  - labels are accessors: switching the catalogue between two calls changes the lines.
- [ ] **Step 2: implement.**
- [ ] **Step 3: gates.** G-7 and `pnpm validate:ui`. No browser.
- [ ] **Step 4: mutations.**
  - M-10a: the card ignores `fmLeg`/`fgRelease` (the checkpoint line reds);
  - M-10b: the pace line reads the first member, not the setter (reds);
  - M-10c: the contact alert fires for the enemy side (reds);
  - M-10d: a literal "On call" in `hud.ts` (the pseudo test reds);
  - M-10e: `schematicRing` back to 3..6 (the M3 case reds with a radius-8 fixture);
  - M-10f: `formationIds` keeps routed units (the M5 case reds).
- [ ] **Step 5: commit** `app: formation march and call lines, alerts, tooltip clauses, P1a minors (GH-859 P1b)`.

---

## Task 11: versus ON — only if Task 9 step 4 (or Task 8.4 at L0) passed S4 on every cell

**Model:** Sonnet implementer; Sonnet reviewer. **Skipped entirely on a STOP.** The ledger then reads "versus stays
off: S4 <cells>", and the PR ships P1b single-player only (Q6).

**Files:** exactly the closed-gate sites `sim-and-orders.md` names.
- `packages/app/src/net/versus-formations.ts`: `VERSUS_FORMATIONS_OPEN = true`.
- Re-aim, never delete:
  - `versus-formations.test.ts` ("the gate ships closed" becomes "the gate ships open", and the predicate table);
  - `room-pause.test.ts` W1 (three cases);
  - `frame-step.test.ts` W3;
  - `tools/src/net/two-client.test.ts` "GATE CLOSED";
  - the first two cases of `tools/src/net/mcp-tools.test.ts`' "order: the formation field".
  - The open-path twins, driven by the injectable `versusOpen` argument, already exist. The closed path stays
    tested through that argument.
- `tools/src/net/snapshot-witness.ts`: one versus mirror world whose driver sends Attack formation orders (see
  "Snapshot-witness coverage").
- `mcp-tools.ts`: the M8 description now reads "accepted in versus rooms".

- [ ] **Step 1:** flip the constant. Quote the six reds P1a's M-6Vd predicted. Re-aim each.
- [ ] **Step 2:** the versus witness world. Run `snapshot:witness -- --self-check`: green, and the census sees the
  formation rows in a room world.
- [ ] **Step 3: gates.** G-7. The versus pins are unchanged (opening orders nothing). `two-client` agrees on both
  clients with a formation move, and its hash moves.
- [ ] **Step 4: mutation.** M-11a: the constant back to false. The re-aimed open tests and the room witness world
  red.
- [ ] **Step 5: commit** `net: formations open in versus rooms, S4 passed (GH-859 P1b)`. Carry the S4 table summary
  (cells, verdicts, the lever kept).

---

## Task 12: docs

**Model:** Sonnet.

- [ ] `CLAUDE.md`, "Sim rules worth knowing from outside the sim". Replace P1a's formations bullet, or add one if
  P1a added none, with the P1b facts:
  - a formation order marches on waypoint checkpoints;
  - `finishLeg` holds a member at an unreleased checkpoint with `moving` 1, and `stepFormationMarch` releases it;
  - pace is a `min` in `stepMovement`;
  - calls are sim-written goals, never commands;
  - every exit goes through `fmForget`;
  - the census needs the formation world to move every row.
  - Keep it to two bullets (G-10).
- [ ] `docs/agent-notes/sim-and-orders.md`: a "Formations P1b" section with the as-built facts:
  - the march, dress and pace rules, and the call rules (the caller-measured reach, the strike/spot/stay class, the
    return);
  - the counters and the exit funnel;
  - the fire sites;
  - the readings from Tasks 8 and 9;
  - the S4 gate's exact verdict rule and its tool;
  - and either "versus is open" or "versus stays closed, because …".
  - The "To open versus" paragraph is updated to what happened.
- [ ] `docs/HANDOVER.md`: one row, keeping the file under 200 lines (P1a's M1).
- [ ] Commit `docs: formations P1b as built (GH-859)`.

## Task 13: final gates, the Opus final review, and the PR

**Model:** Sonnet runs the gates. **Opus** does the final review: the whole diff against this plan's rulings, the
pin table, the coverage plan, the casebook shapes, and the S4 reading.

- [ ] Merge `origin/main` (a normal merge). Re-read every pin, and re-run S1 if `packages/sim` moved on main.
- [ ] **Gates on the branch head,** with exit codes recorded:
  - `pnpm test:determinism`, `pnpm lint`, `pnpm typecheck`, `pnpm test`;
  - `pnpm validate:data`, `pnpm validate:ui`;
  - `pnpm balance` (both tiers), `pnpm playtest`;
  - `pnpm snapshot:witness -- --self-check`;
  - and the final `s4:gate` table (from Task 9 step 4, not re-run unless `packages/sim` or `data/formations`
    moved).
- [ ] **Every pin** at its pin-table value, each move in its own commit with "Was <n>." (`git log --format=%s
  origin/main..HEAD`).
- [ ] **The PR to main**, not a draft: `Formations P1b: the march, the drills and the calls (GH-859)`. The body
  includes:
  - the rulings;
  - the pin table, was → now;
  - the byte-identity proof;
  - urban in Attack at both tiers (with the M7a sentence);
  - the probes (medic, air, Ashwar, ambush, overlap, perf, playtest variants);
  - the S4 tables at L0 and at the kept lever, every cell and verdict;
  - versus on or off;
  - every falsification (M-1a…M-11a);
  - the coverage census result;
  - the questions.

  It refs GH-859 and does not close it (P2 and P3 remain). It ends with the Claude Code line.
- [ ] **CI.** Run `gh run list` after the push. `visual` falls under S5, `snapshot:witness` under S1. The lead
  merges.

---

## STOP gates (where the lead sees numbers)

| Gate | Where | Trips when | Report |
|---|---|---|---|
| **S1** | T1–T6, T8.1, T13 | any pin outside the pin table moves (**the golden hash above all**); a playtest, `balance` (old lines) or no-formation versus cell differs from T0 (timing aside); the format pin's move is not exactly the new rows; or `snapshot:witness` is red for a reason a world cannot fix | the diff, and which edit caused it (bisect by undoing one edit at a time) |
| **S2** | T8.2, T9.3 | urban in Attack outside `urbanRatio`'s band at either tier, or 2:1 within 15 pp of 3:1 (D10) | both arms, seed-paired, per ratio, both tiers. Never retune |
| **S3** | T8.3 | always (report-only), before the PR | medic losses and reach, sortie response and aircraft survival, the Ashwar rate against ≥ 80%, the ambush arms and fratricide (> 10% flags D7's P2 trigger), overlap, the playtest variants |
| **S4** | T8.4, T9.2, T9.4 | `s4:gate` reports any TRIP on an offered cell, or no screened lever arm is clean, or a lever would need a per-faction layout (G-11) | the full cell table (B, S, Δ, flips, p, verdict), the lever screen, and the per-cell mechanism. **Versus stays off**; the lead decides between more layout work and shipping single-player (Q6) |
| **S5** | T10, T13 | CI `visual` red on a gated scenario | the log's scenario and band reading. Bless only through the CI workflow, only if the lead agrees, and only for our change (Wetland P4 may move it first) |
| **S6** | T8.3 | perf over the proposed bars (median > 1 ms or worst > 5 ms) | the three runs and the `flowFieldCount` peak. The spec's remedy, raising `leg_tiles`, is a data change the lead approves first |

## Task order and batches

- T0 → T1 → T2 → T3 → T4 → T5 → T6. These are sequential: they share `sim.ts`, the world helper and the pins.
- T7 may start after T5, in parallel with T6. It touches only `tools/`.
- T10 may start after T5 against the read APIs and events. Its tooltip copy is final after T9.
- Then T8 → T9 → T11 (conditional) → T12 → T13.
- **Heavy runs are sequential.** S4 at 192 seeds is about three times the T0 base per offered cell, plus set B for
  each RERUN. T0 step 4 records the minutes. Budget for T8.4 and T9.4 from those numbers, and do not start anything
  heavy beside them.

## Review focus

1. **Byte identity.** Does any new read, branch or refactor run with `fmLive` false? The proofs are the golden hash,
   `WOUNDED_WORLD_PIN` (`beginRescue`), the golden orders pin (`advanceLeg`), and the registered twin.
2. **The counters.** Do `fgAtCp + fgAway ≤ fgMembers` hold at every tick? Construct a case for every exit, every
   duty change and a freed row.
3. **The hold.** Is a waiting member untouched by `stepSweep`, the medic idle pick and the rest facing, and does it
   stay one compare per tick?
4. **The census and the cuts.** Does every new row move, is every exemption gone, and does each cut's zeroing go red?
5. **The S4 tool.** Is the pairing real (same seeds), is the verdict rule exactly the ruled one, and does the sign
   test take literals?
6. **The levers.** Only the two named, only in data, measured before they are kept.

---

## For the lead (the PR body repeats these; recommendation first)

1. **Q1. The S4 verdict rule** (Task 7, "The S4 gate").
   - **Recommendation:** read your ruling as this. The bar stays on the arm's reading, 60/40 for (b) and 65% for
     (c), with 192 paired seeds.
     - A reading within 5 pp of the bar plays a second set of 192 and is judged on the pooled 384.
     - A cell trips unless its own no-formation baseline was already outside the bar AND the paired sign test shows
       the formation did not push it further.
   - **Alternative:** gate on the paired shift alone. That is, trip when the formation moves a cell by a significant
     margin, whatever the absolute reading. That is closer to "against its own baseline", but it no longer holds
     60/40 itself.
2. **Q2. S4 measures Attack only.** The probe's plan attack-moves, and Column and Ambush are `move` formations it
   cannot carry.
   - **Recommendation:** open all three in versus on Attack's pass. Column and Ambush differ from a plain move only
     on the march and at arrival.
   - **Alternative:** open Attack only, and add a "Column approach" plan to the probe before opening the other two.
3. **Q3. The call's reach is measured from the member that reported contact, not from the aircraft** (Ruling 10).
   - Measured from the aircraft, Attack's aircraft, 13 tiles back behind a 12-tile radius, could never answer.
   - **Recommendation:** accept. Every strike or spot aircraft of the group answers wherever its station is.
   - **Alternative:** keep the spec's wording and raise `call_radius_tiles` to 16 in `attack.json`.
4. **Q4. The levers apply to both factions.** The sim knows sides, not factions, and both share `attack.json`. The
   diagnosis measured the truck width on the Sarim end only.
   - **Recommendation:** accept a both-faction edit. If the both-faction edit does not recover the Sarim-only gain,
     that is S4 and a P2/P3 per-faction design, never a hidden engine rule.
5. **Q5. A shift-appended formation order gets no march** (Ruling 2). It forms its shape at its end only, as in P1a.
   - **Recommendation:** accept. The player's own waypoints are the route.
6. **Q6. If S4 does not pass, ship P1b single-player** with versus still off, and continue layout work after.
   - **Recommendation:** yes. The march and the calls do not depend on versus.

---

## Ledger (filled in by the executor)

- Task 0: base, moved sites, pins, baselines (with times), the S4 cell list and base files (sets A and B, with
  times), the aircraft-call census, the wound-content census, other streams: _pending_.
- Task 2: the format pin's new value and the cut-rows proof: _pending_.
- Tasks 3–5: the fire sites found, each `FORMATION_WORLD_PIN` move with its re-read world facts, the cut ticks, the
  census deletions: _pending_.
- Task 6: `sim-guard` findings and fixes: _pending_.
- Task 8: byte identity, S2, the probe tables, S4 at L0: _pending_.
- Task 9: the screen table, the lever kept (or the STOP), S4 at the kept lever: _pending_.
- Task 11: versus on, or why not: _pending_.
- Task 13: gates with exit codes, the PR URL, CI: _pending_.
