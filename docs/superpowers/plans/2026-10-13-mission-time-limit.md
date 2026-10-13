# Mission time limit: a stalled mission ends as "withdrawn" (GH-540). Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every shipped mission declares `time_limit_s`. When the limit runs out with a primary still
open, `checkEnd` ends the mission as a defeat whose cause is `withdrawn`, and the feed, the outcome card
and the debrief say so.

**Why (issue #540; lead ruling 2026-10-11).** Once a mission's timed primaries resolve, nearly every
mission has a primary that can never fail (`locate`, `capture`, `hold_for`, `eliminate_hvt`). It then
ends only in a win, a wipe or an ROE collapse. A player who cannot finish waits forever. Before #542 the
scripted plans stalled on Khan Rafid I 10/30, Umm Zeitoun I 9/30 and Beit Sahwan IV 2/30. #541 put an
interim stall hint in the feed; this is the real fix.

**Architecture:**
- **One optional field and one latch in `@lions/sim`.** `MissionJson.time_limit_s?: number`. In
  `checkEnd`, `timedOut = !won && limit !== undefined && tick >= limit * TICKS_PER_SECOND` joins
  `lost`. A private `withdrawnValue` latches when the limit is the ONLY reason the mission was lost.
  `DefeatCause` gains `'withdrawn'`; `result` stays `'ongoing' | 'victory' | 'defeat'`. A getter,
  `timeLimitTicksLeft`, feeds the app's one-minute warning.
- **No new `MissionEvent` kind.** `missionEnd` already carries `result: 'defeat'`. The app reads the
  cause through `MissionRuntime.defeatCause`, as it does for every other defeat. None of the four
  places a new kind touches in `packages/app` move.
- **The schema requires the field; `validate:data` enforces the house rule.** The limit is at least
  twice `target_minutes`, and at least 60 s past every primary deadline.
- **`pnpm playtest` proves the numbers on 30 seeds.** Every winning plan still wins inside its limit
  with headroom (new report lines). The 23 controls still lose on their own deadlines, never by the
  limit. Two new witnesses lose BY the limit on all 30 seeds.
- **App:** one feed line a minute before the limit, the `withdrawn` wording in `failureReason`
  (feed, outcome card, debrief), and the telemetry cause.

**Tech Stack:** TypeScript (strict), vitest, ajv (JSON Schema 2020-12), the headless playtest harness
(`tsx`), Playwright for the one browser check.

**Spec:** GitHub issue #540, and `docs/superpowers/plans/2026-10-04-stage4-order.md`, "Rulings (lead,
2026-10-11)", item 4. No separate design doc; this plan's "Measured" section is the per-mission
derivation the issue asks for.

## Global Constraints

- **Lands Wed 4 Nov, right before F1** (ruling 4). It edits `packages/sim/src/mission.ts`, which F1, F3
  and F4 also edit (`start()`/`stepRoe`). Rebase onto `main` the day it starts; never copy line numbers
  from this plan.
- **No sim pin moves.** Read from `main` `ff9d0c8f` (13 Oct): flat `1202444260`, relief `2051106457`
  (after #570), orders `2737216487` (`packages/sim/src/determinism.test.ts`). None of the three replays
  builds a `MissionRuntime`, the limit writes nothing to `Sim` state, and the earliest limit is 600 s
  (12,000 ticks) against replays of 900-1000 ticks. `pnpm test:determinism` must pass unchanged.
- **No playtest number moves.** `LADDER_CREDITS` = `CAMPAIGN_CREDITS` = **5972** (after #572), 36/36
  winning plans win 30/30 seeds, the 12 unlock gates hold 30/30, the 23 controls lose 30/30 on their
  own deadlines. `playtest` only GAINS lines: two witness controls and 26 "time limit" lines.
- **"withdrawn" is a defeat REASON, not a result.** `result` keeps exactly three values. No ledger,
  star or credit rule changes: a withdrawn mission is a defeat like any other.
- **Invariant 2:** no float and no `Math.*` in `packages/sim`. The limit is integer seconds times
  `TICKS_PER_SECOND`, the same arithmetic `stepObjectives` uses for deadlines.
- **The limit counts SIM ticks** (`sim.tickCount`), so a paused game does not spend it.
- **The stall hint (#541, `ui/stall-hint.ts`) stays unchanged** as the warning before the limit.
- **Every player-facing string goes through `t()` and `en.json`.** Wording is in "Lead decisions" D1
  and must be approved before Task 1 lands. `player-wording.test.ts` must stay green.
- **Polish-lane rules** (`/Users/ilpinto/dev/roaring-lions-ep/polish-rules.md`) apply: own worktree,
  `/usr/bin/git commit -s -F <msgfile> -- <paths>` (never `git add -A`, never `git checkout <file>`),
  every new check seen RED by a one-line mutation named in its commit message, no local `ui:routes`,
  `golden-baseline` or `ui:shots`, music off in every browser, never port 5177, stop what you start by
  PID.
- **No visual bless expected.** The golden captures hide `.rl-feed` and photograph no outcome card;
  the strip does not change (D2).
- **Paths in this plan:** `<worktree>` is the executor's own worktree (polish rule 4); `<scratch>` is
  the executor's own scratchpad subfolder (polish rule 14). Every command runs from `<worktree>`.
- Gates before the PR: `pnpm test`, `pnpm test:determinism`, `pnpm typecheck`, `pnpm lint`,
  `pnpm validate:data`, `pnpm validate:ui`, `pnpm playtest`.

## Review Focus

1. **A primary completes on the limit tick.** The player won; the mission must read VICTORY, not
   withdrawn. Pinned in Task 1 (`survive_until` ending on the limit tick).
2. **Another loss lands on the limit tick** (a deadline primary fails at the same second). The cause
   must stay that objective, so the debrief names the right failure. Pinned in Task 1.
3. **A mission with no `time_limit_s`** (test fixtures, Free Play, the versus core, any future
   `MissionJson` built in code) must never time out. Pinned in Task 1.
4. **A control that starts losing by the limit instead of its own deadline** reads as a pass if the
   harness only compares `result`. Task 3 makes the sweep report `withdrawn` apart from `defeat`, and
   falsifies it.
5. **The warning while paused or after the end.** The limit is sim time, so a pause freezes it; the
   warning fires once, never after the mission has ended, never in the tutorial. Pinned in Task 4's
   pure function; the wiring is checked in the browser step.

---

## Measured (13 Oct, `main` `ff9d0c8f`, headless)

`PT_PLAN_WORKERS=4 PT_SWEEP_WORKERS=4 pnpm playtest`, exit 0, 54.7 s wall clock. Seeds 424242 and
1..29, each seed walking its own chained ledgers (#539/#542). "Slowest win" is the slowest VICTORY of
every winning plan for that mission (base, `(gate open)`, `(bought)`, `(price-only closed)`, and the
424242 `(max tier)` replay), in whole seconds as Task 3's own `time limit` lines print it. "No-orders control" is when each of the
23 controls loses (D30 on every one; 424242's run line). "Latest primary deadline" is the largest
`seconds` of any primary `survive_until`/`evacuate_before`/`raze`/`collapse`. Headroom's "×" is the
limit over the slowest win.

**Prototyped before writing.** Tasks 1-3 and Task 4's tests were applied to a throwaway worktree off
`ff9d0c8f` (deleted after; nothing of it is in this PR): the new sim, app and tools tests pass,
`typecheck` is clean, `test:determinism` passes with all three pins unmoved, and `pnpm playtest` exits
0 with `credit ladder: 5972`, 36/36 plans on 30/30 seeds, the 23 controls `DEFEAT on 30/30`, both
witnesses `WITHDRAWN on 30/30` (424242: `DEFEAT in 14.0 min … cause withdrawn`), and the seconds below.

**The rule: `time_limit_s = 120 × target_minutes`** (twice the declared target). It is derived from
`target_minutes`, it is not fitted to any one mission, and every mission clears it with room:

| mission | target (min) | `time_limit_s` | slowest 30-seed win | headroom | latest primary deadline | no-orders control |
|---|---|---|---|---|---|---|
| beit_sahwan_0_tutorial | 10 | 1200 (20:00) | — (ends by its steps, ≤ 600 s) | — | 600 s | — |
| beit_sahwan_breach | 5 | 600 (10:00) | 300 s | 300 s (2.00×) | 300 s | 4.5 min |
| beit_sahwan_1_recon | 7 | 840 (14:00) | 31 s | 809 s (27.10×) | — | STUCK → witness |
| beit_sahwan_2_foothold | 7 | 840 (14:00) | 318 s | 522 s (2.64×) | — | — |
| beit_sahwan_3_clearance | 7 | 840 (14:00) | 177 s | 663 s (4.75×) | — | STUCK → witness |
| beit_sahwan_4_subterranean | 6 | 720 (12:00) | 355 s | 365 s (2.03×) | 300 s | 4.0 min |
| wadi_halam_1_fords | 6 | 720 (12:00) | 425 s | 295 s (1.69×) | 300 s | 5.0 min |
| wadi_halam_2_laager | 7 | 840 (14:00) | 439 s | 401 s (1.91×) | 300 s | 5.0 min |
| wadi_halam_3_counterraid | 6 | 720 (12:00) | 328 s | 392 s (2.20×) | 300 s | 5.0 min |
| **wadi_halam_4_village** | 7 | 840 (14:00) | 679 s (gate open) | 161 s (1.24×) | 300 s | 5.0 min |
| wadi_halam_5_depot | 7 | 840 (14:00) | 354 s (gate open) | 486 s (2.37×) | 300 s | 5.0 min |
| khan_rafid_1_recon | 6 | 720 (12:00) | 59 s | 661 s (12.20×) | 240 s | 4.0 min |
| khan_rafid_2_foothold | 7 | 840 (14:00) | 267 s | 573 s (3.15×) | 300 s | 5.0 min |
| khan_rafid_3_clearance | 7 | 840 (14:00) | 58 s | 782 s (14.48×) | 300 s | 5.0 min |
| deir_amun_1_recon | 6 | 720 (12:00) | 53 s | 667 s (13.58×) | 240 s | 4.0 min |
| deir_amun_2_foothold | 7 | 840 (14:00) | 376 s (gate open) | 464 s (2.23×) | 240 s | 4.0 min |
| deir_amun_3_subterranean | 7 | 840 (14:00) | 93 s | 747 s (9.03×) | 300 s | 5.0 min |
| tel_marum_1_recon | 7 | 840 (14:00) | 67 s | 773 s (12.54×) | 300 s | 5.0 min |
| tel_marum_2_foothold | 6 | 720 (12:00) | 251 s | 469 s (2.87×) | 300 s | 5.0 min |
| tel_marum_3_clearance | 7 | 840 (14:00) | 141 s | 699 s (5.96×) | 300 s | 5.0 min |
| qarn_hadid_1_recon | 6 | 720 (12:00) | 76 s | 644 s (9.47×) | 240 s | 4.0 min |
| qarn_hadid_2_foothold | 7 | 840 (14:00) | 208 s | 632 s (4.04×) | 300 s | 5.0 min |
| qarn_hadid_3_clearance | 7 | 840 (14:00) | 216 s | 624 s (3.89×) | 300 s | 5.0 min |
| umm_zeitoun_1_recon | 6 | 720 (12:00) | 170 s | 550 s (4.24×) | 240 s | 4.0 min |
| umm_zeitoun_2_buildup | 7 | 840 (14:00) | 320 s | 520 s (2.62×) | 300 s | 5.0 min |
| umm_zeitoun_3_clearance | 7 | 840 (14:00) | 182 s | 658 s (4.62×) | 300 s | 5.0 min |
| umm_zeitoun_4_clearance | 7 | 840 (14:00) | 255 s | 585 s (3.29×) | 300 s | 5.0 min |

**The stated margin**, held by `pnpm playtest` from Task 3 on: a limit must clear its mission's slowest
win by **at least 120 s AND at least 20%**. The tightest is Wadi Halam IV with its gate open: 679 s
against 840 s, so 161 s and 24%. Every limit is at least 600 s, so it clears every primary deadline
(≤ 300 s; the tutorial's backstop is 600 against 1200) by 300 s or more: **every control loses on its
own deadline 5-10 minutes before any limit could reach it.**

**Why not a tighter rule.** "Target + N minutes" needs N ≥ 6.6 to clear Wadi Halam IV with the 20%
margin (815 s against 679 s), and that gives a 5-minute mission an 11.6-minute limit, looser than 2× (10:00) where missions are
shortest. A per-mission value fitted to each slowest win would be the fitted number GH-84 forbids, and
every plan re-scripted to run slower would need a data change. 2× moves only when `target_minutes`
does.

**The two witnesses** (measured the same day, 30 seeds each, no orders, `{}` ledger): Beit Sahwan I
(one `locate` primary) and Beit Sahwan III (`eliminate_hvt` + `capture`) ran STUCK at the 20-minute cap
on **30/30** seeds, the force alive throughout. With the limit, both must end `withdrawn` at 14:00 on
every seed. Beit Sahwan II with no orders WINS (its hold completes at 5.4 min), so it is not a witness.

**The latent case in the issue** (a `locate` target that dies unidentified, so `complete` can never be
reached) is ended by the limit like any other stall. A rule that fails or completes such a `locate`
directly is a separate sim behaviour change, not in this plan.

**Determinism.** No replay is long enough, and none could see it: the three pinned replays build a bare
`Sim` (no `MissionRuntime`), and `checkEnd` writes nothing to `Sim` state. Task 1 adds a test that a
world ended by the limit hashes exactly as the same world with no limit. One thing does change: a
feedback replay (`feedback/replay.ts`) of a pre-#540 session that ran past its mission's limit stops
issuing mission orders (waves, triggers) at the limit on a post-#540 build. Replays are triaged on
their own recorded commit, so this is a note, not a fix.

## Lead decisions

- **D1 (wording, needed before Task 1 lands).** Proposed, in the existing `outcome.failed.*` style
  ("Objective failed: {text} · {at}"):
  - `outcome.failed.withdrawn`: **"Withdrawn, out of time: {text} · {at}"**, naming the first open
    primary. Example: "Withdrawn, out of time: Identify six garrison positions · 14:00". Shown in the
    feed, on the outcome card and as the debrief's reason.
  - `outcome.failed.withdrawnBare`: **"Withdrawn, out of time · {at}"**, if no open primary is on the
    list (cannot happen with shipped data; kept so the line never shows an id).
  - `hud.withdraw.warn`: **"{left} left — then the force is withdrawn"**, one feed line at 1:00, in
    the style of `hud.deadline.warn` ("{left} left — {text}"), with the same alert chime.
  - No voice line: none is recorded, so the warning is caption only (the deadline warning's
    `voice.onMission` call is not copied).
  - Note: `aar.well.withdrew` ("{n} withdrew") already means ENEMIES who withdrew from a lost fight, on
    a victory only. The two never appear on the same screen.
- **D2 (HUD clock).** Recommended: **no standing clock.** A limit at twice the target is a backstop,
  and a clock from 0:00 would turn every mission into a timed one. The player gets the stall hint
  (#541) after 60 s of no progress and the 1:00 feed line above. Alternative, if the lead wants a
  clock: show "Withdrawal 0:59" in the strip's deadline slot during the last minute only. That is a
  `stripObjectives` change, moves no gated frame, and would be a fourth task in Task 4; it is not
  planned here.
- **D3 (the rule).** Recommended: **`time_limit_s = 120 × target_minutes`**, with `validate:data`
  holding it as a FLOOR (a mission may declare more, never less), and `playtest` holding the 120 s/20%
  margin over the slowest win. The alternative and why it is worse are under "Why not a tighter rule".
- **Not a decision, flagged:** no real player's mission length has ever been measured (CLAUDE.md,
  GH-84). Wadi Halam IV is a search mission whose optimal plan already takes 11.3 minutes. After
  release, `/stats`' "Top loss cause" column will show `withdrawn`; that is the first real reading of
  whether 2× is enough.

## File structure

| file | change | task |
|---|---|---|
| `packages/sim/src/mission.ts` | `time_limit_s` on `MissionJson`; `'withdrawn'` in `DefeatCause`; `withdrawnValue`; `checkEnd`; `defeatCause`; `timeLimitTicksLeft` | 1 |
| `packages/sim/src/mission.test.ts` | `describe('time limit (#540)')` | 1 |
| `packages/app/src/ui/mission-failure.ts` | `failureReason` 'withdrawn' branch (typecheck forces it in Task 1); `withdrawalDue`, `withdrawalWarningLine` | 1, 4 |
| `packages/app/src/ui/mission-failure.test.ts` | wording tests; warning tests; Beit Sahwan I end-to-end | 1, 4 |
| `packages/app/src/i18n/en.json` | three keys | 1, 4 |
| `data/schemas/mission.schema.json` | `time_limit_s` property, in `required` | 2 |
| `tools/validate_time_limit.mjs` + `.d.mts` (new) | `timeLimitFailures(mission, file)` | 2 |
| `tools/validate_data.mjs` | call it per mission | 2 |
| `tools/src/validate_time_limit.test.ts` (new) | fixtures + the shipped table pinned as literals | 2 |
| `data/missions/*.json` (27) | `"time_limit_s": <120 × target>` after `target_minutes` | 2 |
| `tools/src/backtest/playtest-run.ts` | `causeText`, `sweepOutcome`; `cause` on `RunRecord`, `measured` and the run line | 3 |
| `tools/src/backtest/passive-sweep.ts`, `passive-sweep-worker.ts` | `'withdrawn'` expectation; report `withdrawn` apart from `defeat` | 3 |
| `tools/src/backtest/time-limit.ts` + `time-limit.test.ts` (new) | `limitHeadroom` | 3 |
| `tools/src/backtest/plan-sweep.ts` | print the headroom lines, fail on a miss | 3 |
| `tools/src/backtest/playtest.ts` | the two witness controls | 3 |
| `packages/app/src/main.ts` | one-minute warning wiring | 4 |
| `data/schemas/telemetry_event.schema.json`, `packages/data/src/telemetry.ts` (+ test), `packages/app/src/telemetry/events.test.ts` | accept `withdrawn` as a cause | 5 |
| `CLAUDE.md`, `docs/campaign/README.md` | the authoring rule | 6 |

---

### Task 1: The sim ends a stalled mission as "withdrawn", and the debrief says so

**Files:**
- Modify: `packages/sim/src/mission.ts` (`MissionJson`, `DefeatCause`, the `resultValue` field, `defeatCause`, a new getter after `get result()`, `checkEnd`)
- Modify: `packages/sim/src/mission.test.ts` (new `describe` right after `describe('defeatCause', …)`, inside the same outer `describe` so `civWorld` and `REFUGE_CTX` are in scope)
- Modify: `packages/app/src/ui/mission-failure.ts` (`failureReason`)
- Modify: `packages/app/src/ui/mission-failure.test.ts` (section 1)
- Modify: `packages/app/src/i18n/en.json` (after `"outcome.failed.conduct"`)

**Interfaces:**
- Produces: `MissionJson.time_limit_s?: number`; `type DefeatCause = 'force_destroyed' | 'roe_collapse' | 'withdrawn' | { objective: string }`; `MissionRuntime.timeLimitTicksLeft: number | undefined` (getter; `undefined` with no limit, never negative); `failureReason(cause, objectives: readonly { id: string; text: string; primary?: boolean; status?: string }[], tick): string | null`.

- [ ] **Step 1: Write the failing sim tests.** In `packages/sim/src/mission.test.ts`, after the closing `});` of `describe('defeatCause', …)`:

```ts
  describe('time limit (#540)', () => {
    const LIMIT_S = 10;
    /** A capture nobody is standing on and no enemy at all: the one primary stays open forever,
     *  which is exactly the stall the limit exists for. */
    const stalled = (over: Partial<MissionJson> = {}): World =>
      makeWorld(
        baseMission({
          starting_force: [{ unit: 'm_squad', count: 1, at: [3, 5] }],
          objectives: [{ id: 'take', type: 'capture', primary: true, target: 'obj', seconds: 3 }],
          time_limit_s: LIMIT_S,
          ...over,
        }),
        { zones: { obj: [19, 3, 5, 5] } }
      );

    it('ends a stalled mission as a defeat, cause withdrawn, on the limit tick', () => {
      const w = stalled();
      w.step(LIMIT_S * TICKS_PER_SECOND - 1);
      expect(w.runtime.result).toBe('ongoing');
      const { mission } = w.step(1);
      expect(mission.find((e) => e.kind === 'missionEnd')).toMatchObject({
        kind: 'missionEnd',
        tick: LIMIT_S * TICKS_PER_SECOND,
        result: 'defeat',
      });
      expect(w.runtime.defeatCause).toBe('withdrawn');
      // The limit ends the mission; it does not fail the objective.
      expect(w.runtime.objectiveList.find((o) => o.id === 'take')?.status).toBe('active');
    });

    it('never ends a mission that declares no limit', () => {
      const w = stalled({ time_limit_s: undefined });
      w.step(3 * LIMIT_S * TICKS_PER_SECOND);
      expect(w.runtime.result).toBe('ongoing');
      expect(w.runtime.timeLimitTicksLeft).toBeUndefined();
    });

    it('a primary completing on the limit tick wins', () => {
      const w = stalled({ objectives: [{ id: 'clock', type: 'survive_until', primary: true, seconds: LIMIT_S }] });
      w.step(LIMIT_S * TICKS_PER_SECOND);
      expect(w.runtime.result).toBe('victory');
      expect(w.runtime.defeatCause).toBeUndefined();
    });

    it('a primary failing on the limit tick keeps its own cause', () => {
      // The existing 'a failed primary evacuation loses the mission outright' fixture, limit = deadline.
      const w = civWorld(
        {
          starting_force: [{ unit: 'm_squad', count: 1, at: [24, 2] }],
          civilians: { groups: [{ unit: 'm_civ', count: 1, at: [20, 6] }], refuge: 'refuge' },
          objectives: [
            { id: 'evac', type: 'evacuate_before', primary: true, target: 'refuge_zone', count: 1, seconds: 5 },
          ],
          time_limit_s: 5,
        },
        REFUGE_CTX
      );
      w.step(5 * TICKS_PER_SECOND);
      expect(w.runtime.result).toBe('defeat');
      expect(w.runtime.defeatCause).toEqual({ objective: 'evac' });
    });

    it('counts down in sim ticks and stops at zero', () => {
      const w = stalled();
      expect(w.runtime.timeLimitTicksLeft).toBe(LIMIT_S * TICKS_PER_SECOND);
      w.step(TICKS_PER_SECOND);
      expect(w.runtime.timeLimitTicksLeft).toBe((LIMIT_S - 1) * TICKS_PER_SECOND);
      w.step(LIMIT_S * TICKS_PER_SECOND);
      expect(w.runtime.timeLimitTicksLeft).toBe(0);
    });

    it('writes nothing to the sim: a withdrawn world hashes as the same world with no limit', () => {
      const a = stalled();
      const b = stalled({ time_limit_s: undefined });
      a.step(LIMIT_S * TICKS_PER_SECOND + 20);
      b.step(LIMIT_S * TICKS_PER_SECOND + 20);
      expect(a.runtime.defeatCause).toBe('withdrawn');
      expect(b.runtime.result).toBe('ongoing');
      expect(a.sim.hash()).toBe(b.sim.hash());
    });
  });
```

- [ ] **Step 2: Run them; they fail.**
Run: `pnpm vitest run packages/sim/src/mission.test.ts -t "time limit"`
Expected: FAIL. `typecheck` also fails on `time_limit_s` not being on `MissionJson`, and vitest
reports `ongoing` where `defeat` is expected.

- [ ] **Step 3: Implement in `packages/sim/src/mission.ts`.**

On `MissionJson`, after `debrief?`:

```ts
  /** #540: the mission's time limit, in seconds of SIM time. When it runs out with a primary still
   *  open, `checkEnd` ends the mission as a defeat whose cause is `'withdrawn'`. Absent means no limit
   *  (test fixtures, Free Play, the versus core); every shipped mission declares one, enforced by
   *  mission.schema.json and tools/validate_time_limit.mjs. */
  time_limit_s?: number;
```

`DefeatCause`:

```ts
export type DefeatCause = 'force_destroyed' | 'roe_collapse' | 'withdrawn' | { objective: string };
```

Beside `private resultValue …`:

```ts
  /** #540: set by `checkEnd` when the time limit was the ONLY reason the mission was lost. */
  private withdrawnValue = false;
```

In `get defeatCause()`, first line after the `resultValue !== 'defeat'` guard:

```ts
    // Latched, not re-derived: nothing in the world records that the clock ran out.
    if (this.withdrawnValue) return 'withdrawn';
```

After `get result()`:

```ts
  /** #540: ticks until the time limit withdraws the force; undefined when the mission declares none.
   *  Sim ticks, so a paused game (no ticks) does not spend it. Never negative. */
  get timeLimitTicksLeft(): number | undefined {
    const limit = this.mission.time_limit_s;
    if (limit === undefined) return undefined;
    const left = limit * TICKS_PER_SECOND - this.sim.tickCount;
    return left > 0 ? left : 0;
  }
```

In `checkEnd`, replace the two lines `const lost = …` / `if (!lost && !won) return;` and the
`this.ended = true;` line after them with:

```ts
    // #540: the time limit. With every timed primary resolved, a mission whose open primaries
    // cannot fail (`locate`, `capture`, `hold_for`, `eliminate_hvt`) ends only in a win, a wipe or
    // an ROE collapse, and a player who cannot finish waits forever. A win on the same tick wins;
    // any other loss on the same tick keeps its own cause.
    const limit = this.mission.time_limit_s;
    const timedOut = !won && limit !== undefined && tick >= limit * TICKS_PER_SECOND;
    const lost = wiped || this.roeFailed || failedPrimary || timedOut;
    if (!lost && !won) return;

    this.ended = true;
    this.withdrawnValue = timedOut && !wiped && !this.roeFailed && !failedPrimary;
```

- [ ] **Step 4: Add the debrief wording (typecheck needs it now).** `failureReason` reads
`cause.objective` after the two string branches, and `'withdrawn'` is a string, so `pnpm typecheck` is
red until the branch exists. In `packages/app/src/i18n/en.json`, after `"outcome.failed.conduct"`:

```json
  "outcome.failed.withdrawn": "Withdrawn, out of time: {text} · {at}",
  "outcome.failed.withdrawnBare": "Withdrawn, out of time · {at}",
```

In `packages/app/src/ui/mission-failure.ts`, widen the parameter and add the branch:

```ts
export function failureReason(
  cause: DefeatCause | undefined,
  objectives: readonly { id: string; text: string; primary?: boolean; status?: string }[],
  tick: number
): string | null {
  if (cause === undefined) return null;
  const at = clockText(tick);
  if (cause === 'force_destroyed') return t('outcome.failed.force', { at });
  if (cause === 'roe_collapse') return t('outcome.failed.conduct', { at });
  if (cause === 'withdrawn') {
    // #540: the limit ends the mission with its primaries still active; name the first one, so the
    // debrief says what was left undone and not just that time ran out.
    const open = objectives.find((o) => o.primary === true && o.status === 'active');
    return open ? t('outcome.failed.withdrawn', { text: open.text, at }) : t('outcome.failed.withdrawnBare', { at });
  }
  const text = objectives.find((o) => o.id === cause.objective)?.text ?? cause.objective;
  return t('outcome.failed.objective', { text, at });
}
```

Add a sentence to the file header's point 1: "A mission the time limit ends (#540) names the first
primary still open."

In `packages/app/src/ui/mission-failure.test.ts`, inside `describe('1. failureReason…')`, after
`'a wiped force and a Conduct collapse'`:

```ts
  it('a withdrawal names the first primary still open, never a secondary', () => {
    const rows = [
      { id: 'scout', text: 'Find the column', primary: false, status: 'active' },
      { id: 'hold_the_crest_line', text: 'Hold the crest line for four minutes', primary: true, status: 'complete' },
      { id: 'level_the_stone_post', text: 'Level the post on the stone knoll inside five minutes', primary: true, status: 'active' },
    ];
    expect(failureReason('withdrawn', rows, 840 * S)).toBe(
      'Withdrawn, out of time: Level the post on the stone knoll inside five minutes · 14:00'
    );
  });
  it('a withdrawal with no open primary on the list still says why, and shows no id', () => {
    expect(failureReason('withdrawn', objs, 840 * S)).toBe('Withdrawn, out of time · 14:00');
  });
```

- [ ] **Step 5: Run everything that reads it; all green.**
Run: `pnpm vitest run packages/sim/src/mission.test.ts packages/app/src/ui/mission-failure.test.ts packages/app/src/i18n && pnpm test:determinism && pnpm typecheck`
Expected: PASS. The three pins are unchanged (`1202444260`, `2051106457`, `2737216487`).

- [ ] **Step 6: Falsify, one mutation at a time, then restore by undoing the edit (never `git checkout <file>`).**
  1. `tick >= limit * TICKS_PER_SECOND` → `tick > limit * TICKS_PER_SECOND`: "ends … on the limit tick" goes red (ends one tick late).
  2. Drop `!won &&` from `timedOut`: "a primary completing on the limit tick wins" goes red (reads defeat).
  3. `this.withdrawnValue = timedOut;`: "keeps its own cause" goes red (reads `withdrawn`).
  4. Delete the `if (this.withdrawnValue) return 'withdrawn';` line: "ends … on the limit tick" goes red (cause `undefined`).
  5. Insert `this.sim.debugKill(this.playerIds[0]);` after the latch: "writes nothing to the sim" goes red.
  6. In `failureReason`, drop `o.primary === true &&`: "never a secondary" goes red.

- [ ] **Step 7: Commit.**

```bash
cat > <scratch>/t1.txt <<'EOF'
sim: a stalled mission ends as a "withdrawn" defeat at its time limit (#540)

MissionJson gains time_limit_s. checkEnd ends a mission whose limit has run out with a primary
still open; result stays 'defeat', and defeatCause reads 'withdrawn' only when the limit was the
sole reason. A win on the limit tick wins; another loss on it keeps its own cause.
failureReason words it for the feed, outcome card and debrief.

No sim pin moves: no pinned replay builds a MissionRuntime, and a test proves a withdrawn
world hashes as the same world with no limit.

Seen red: > for >=; !won dropped; the latch made unconditional; the defeatCause line deleted;
a debugKill in the latch; the primary filter dropped in failureReason.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
/usr/bin/git commit -s -F <scratch>/t1.txt -- packages/sim/src/mission.ts packages/sim/src/mission.test.ts packages/app/src/ui/mission-failure.ts packages/app/src/ui/mission-failure.test.ts packages/app/src/i18n/en.json
```

---

### Task 2: Every mission declares its limit, and `validate:data` holds the rule

**Files:**
- Modify: `data/schemas/mission.schema.json` (`required`; a `time_limit_s` property after `target_minutes`)
- Create: `tools/validate_time_limit.mjs`, `tools/validate_time_limit.d.mts`
- Create: `tools/src/validate_time_limit.test.ts`
- Modify: `tools/validate_data.mjs` (import; one call in the per-mission loop beside `triggerLabelFailures`)
- Modify: all 27 `data/missions/*.json`

**Interfaces:**
- Consumes: `MissionJson.time_limit_s` (Task 1).
- Produces: `timeLimitFailures(mission: unknown, file: string): string[]`; `LIMIT_PER_TARGET_MINUTE_S = 120`; `DEADLINE_CLEARANCE_S = 60`; every shipped mission carries `time_limit_s` (read by Task 3's headroom check and Task 4's end-to-end test).

- [ ] **Step 1: Write the failing test** `tools/src/validate_time_limit.test.ts`:

```ts
// #540: the time-limit rule. Its own module for the reason every validate_*.mjs is one:
// validate_data.mjs runs its whole sweep at import time and exits, so a test cannot import it.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { timeLimitFailures } from '../validate_time_limit.mjs';

const ROOT = join(__dirname, '..', '..');
const base = {
  target_minutes: 7,
  time_limit_s: 840,
  objectives: [{ id: 'evac', type: 'evacuate_before', primary: true, seconds: 300 }],
};

describe('timeLimitFailures', () => {
  it('passes twice the target with every deadline cleared', () => {
    expect(timeLimitFailures(base, 'm')).toEqual([]);
  });
  it('refuses a mission with no limit', () => {
    expect(timeLimitFailures({ ...base, time_limit_s: undefined }, 'm')).toEqual([
      'm: declares no time_limit_s -- a stalled mission would never end (#540)',
    ]);
  });
  it('refuses a limit under twice the target, and reads the default target of 6', () => {
    expect(timeLimitFailures({ ...base, time_limit_s: 839 }, 'm')).toHaveLength(1);
    expect(timeLimitFailures({ ...base, target_minutes: undefined, time_limit_s: 719 }, 'm')).toHaveLength(1);
    expect(timeLimitFailures({ ...base, target_minutes: undefined, time_limit_s: 720 }, 'm')).toEqual([]);
  });
  it('refuses a limit that does not clear a primary deadline by 60 s, defaults included', () => {
    const late = { ...base, target_minutes: 5, time_limit_s: 600 };
    expect(timeLimitFailures({ ...late, objectives: [{ id: 'x', type: 'raze', primary: true, seconds: 541 }] }, 'm')).toHaveLength(1);
    expect(timeLimitFailures({ ...late, objectives: [{ id: 'x', type: 'raze', primary: true, seconds: 540 }] }, 'm')).toEqual([]);
    // The runtime's defaults: survive_until 60 s, evacuate_before 300 s.
    expect(timeLimitFailures({ ...late, time_limit_s: 600, objectives: [{ id: 'x', type: 'evacuate_before', primary: true }] }, 'm')).toEqual([]);
    expect(
      timeLimitFailures({ ...late, target_minutes: 1, time_limit_s: 359, objectives: [{ id: 'x', type: 'evacuate_before', primary: true }] }, 'm')
    ).toHaveLength(1);
  });
  it('ignores a secondary deadline and a hold clock', () => {
    const m = { ...base, objectives: [
      { id: 'a', type: 'raze', primary: false, seconds: 900 },
      { id: 'b', type: 'hold_for', primary: true, seconds: 900 },
    ] };
    expect(timeLimitFailures(m, 'm')).toEqual([]);
  });
});

describe('the shipped limits', () => {
  // Literals, not 120 * target re-derived: this is the table the plan measured on 13 Oct
  // (docs/superpowers/plans/2026-10-13-mission-time-limit.md). Raising one is a decision.
  const EXPECTED: Record<string, number> = {
    beit_sahwan_0_tutorial: 1200, beit_sahwan_breach: 600, beit_sahwan_1_recon: 840,
    beit_sahwan_2_foothold: 840, beit_sahwan_3_clearance: 840, beit_sahwan_4_subterranean: 720,
    wadi_halam_1_fords: 720, wadi_halam_2_laager: 840, wadi_halam_3_counterraid: 720,
    wadi_halam_4_village: 840, wadi_halam_5_depot: 840, khan_rafid_1_recon: 720,
    khan_rafid_2_foothold: 840, khan_rafid_3_clearance: 840, deir_amun_1_recon: 720,
    deir_amun_2_foothold: 840, deir_amun_3_subterranean: 840, tel_marum_1_recon: 840,
    tel_marum_2_foothold: 720, tel_marum_3_clearance: 840, qarn_hadid_1_recon: 720,
    qarn_hadid_2_foothold: 840, qarn_hadid_3_clearance: 840, umm_zeitoun_1_recon: 720,
    umm_zeitoun_2_buildup: 840, umm_zeitoun_3_clearance: 840, umm_zeitoun_4_clearance: 840,
  };
  const dir = join(ROOT, 'data/missions');
  const shipped = readdirSync(dir).filter((n) => n.endsWith('.json'));

  it('every shipped mission is in the table, and the table names nothing else', () => {
    expect(shipped.map((f) => f.replace('.json', '')).sort()).toEqual(Object.keys(EXPECTED).sort());
  });
  it.each(shipped)('%s declares its measured limit and passes the rule', (f) => {
    const m = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    expect(m.time_limit_s).toBe(EXPECTED[m.id]);
    expect(timeLimitFailures(m, f)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it; it fails** (module not found).
Run: `pnpm vitest run tools/src/validate_time_limit.test.ts`

- [ ] **Step 3: Write `tools/validate_time_limit.mjs`.**

```js
// #540: every mission's time limit (`time_limit_s`), checked against the house rule.
//
// The rule: at least twice the mission's own `target_minutes` (default 6, as the schema's), and at
// least DEADLINE_CLEARANCE_S past every PRIMARY deadline, so a mission that is losing on its own
// clock loses on that clock and never by the limit. Whether the limit also clears the slowest WIN
// is a measurement, so `pnpm playtest` holds that (tools/src/backtest/time-limit.ts), not this.
//
// Its own module because validate_data.mjs runs its whole sweep at import time and exits.

/** Twice the target, in seconds per target minute. */
export const LIMIT_PER_TARGET_MINUTE_S = 120;
/** How long before the limit a primary deadline must fire. */
export const DEADLINE_CLEARANCE_S = 60;
/** The primary clocks that run from mission start, with the runtime's own defaults
 *  (`stepObjectives`: survive_until 60 s, evacuate_before 300 s; raze/collapse have none). */
const DEADLINE_DEFAULT_S = { survive_until: 60, evacuate_before: 300, raze: undefined, collapse: undefined };

export function timeLimitFailures(mission, file) {
  const limit = mission?.time_limit_s;
  if (typeof limit !== 'number') {
    return [`${file}: declares no time_limit_s -- a stalled mission would never end (#540)`];
  }
  const out = [];
  const floor = (mission.target_minutes ?? 6) * LIMIT_PER_TARGET_MINUTE_S;
  if (limit < floor) {
    out.push(`${file}: time_limit_s ${limit} is under twice its target_minutes (${floor} s)`);
  }
  for (const o of mission.objectives ?? []) {
    if (o.primary !== true || !(o.type in DEADLINE_DEFAULT_S)) continue;
    const secs = o.seconds ?? DEADLINE_DEFAULT_S[o.type];
    if (secs === undefined) continue;
    if (limit < secs + DEADLINE_CLEARANCE_S) {
      out.push(
        `${file}: time_limit_s ${limit} does not clear primary "${o.id}"'s ${secs} s clock by ` +
          `${DEADLINE_CLEARANCE_S} s -- the mission would end by the limit instead of its own deadline`
      );
    }
  }
  return out;
}
```

`tools/validate_time_limit.d.mts`:

```ts
// Types for validate_time_limit.mjs, so tools/src/validate_time_limit.test.ts typechecks.
export declare const LIMIT_PER_TARGET_MINUTE_S: number;
export declare const DEADLINE_CLEARANCE_S: number;
export declare function timeLimitFailures(mission: unknown, file: string): string[];
```

In `tools/validate_data.mjs`, import beside the others (`import { timeLimitFailures } from
'./validate_time_limit.mjs';`) and, right after `failures.push(...triggerLabelFailures(mi, rel(file)));`:

```js
    // #540: the time limit, twice the target and clear of every primary deadline.
    failures.push(...timeLimitFailures(mi, rel(file)));
```

- [ ] **Step 4: Add the schema field.** Append `"time_limit_s"` to the root `required` array, and after
the `target_minutes` property:

```json
    "time_limit_s": {
      "type": "integer",
      "minimum": 600,
      "description": "#540: seconds of sim time before a mission with a primary still open ends as a defeat whose cause is 'withdrawn' (MissionRuntime.checkEnd). The house rule is 120 x target_minutes, a floor enforced by tools/validate_time_limit.mjs together with a 60 s clearance over every primary deadline; pnpm playtest holds a 120 s and 20% margin over the slowest 30-seed win. 600 is twice the smallest target (5)."
    },
```

- [ ] **Step 5: Write the 27 values,** one line after each `"target_minutes": N,`, preserving each
file's own formatting (no JSON re-serialisation):

```bash
cd <worktree> && perl -0pi -e 's/^(  "target_minutes": (\d+),\n)/$1 . "  \"time_limit_s\": " . ($2 * 120) . ",\n"/me' data/missions/*.json
/usr/bin/git diff --stat -- data/missions   # 27 files, 27 insertions
```

- [ ] **Step 6: Run; green.**
Run: `pnpm vitest run tools/src/validate_time_limit.test.ts tools/src/validate_briefing.test.ts && pnpm validate:data && pnpm typecheck`
Expected: PASS; `validate:data` reports the same mission count as before.

- [ ] **Step 7: Falsify, then restore.**
  1. Set `wadi_halam_4_village.json`'s `time_limit_s` to 839: `validate:data` exits 1 naming "under twice its target_minutes", and the table test goes red.
  2. Delete the line from `beit_sahwan_1_recon.json`: `validate:data` fails twice (the schema's `required`, and "declares no time_limit_s").
  3. In the module, `secs + DEADLINE_CLEARANCE_S` → `secs`: the "by 60 s" fixture goes red.

- [ ] **Step 8: Commit** (message: `data: every mission declares time_limit_s, twice its target (#540)`, the three
mutations named, the Co-Authored-By line) with
`/usr/bin/git commit -s -F <msgfile> -- data/schemas/mission.schema.json tools/validate_time_limit.mjs tools/validate_time_limit.d.mts tools/validate_data.mjs tools/src/validate_time_limit.test.ts data/missions`.

---

### Task 3: `pnpm playtest` proves the limits on 30 seeds

**Files:**
- Modify: `tools/src/backtest/playtest-run.ts`
- Modify: `tools/src/backtest/passive-sweep.ts`, `tools/src/backtest/passive-sweep-worker.ts`
- Create: `tools/src/backtest/time-limit.ts`, `tools/src/backtest/time-limit.test.ts`
- Modify: `tools/src/backtest/plan-sweep.ts` (`drainPlanSweeps`)
- Modify: `tools/src/backtest/playtest.ts` (two witness lines, just above `// I — Recon:`)

**Interfaces:**
- Consumes: `MissionRuntime.defeatCause` incl. `'withdrawn'` (Task 1); `time_limit_s` in every mission (Task 2).
- Produces: `causeText(c: DefeatCause | undefined): string | undefined`; `sweepOutcome(result, cause): string`; `RunRecord.cause?: string`; `limitHeadroom(wins: readonly WinTime[], limitOf: (id: string) => number | undefined): { lines: string[]; failures: string[] }`; `HEADROOM_S = 120`; `HEADROOM_RATIO = 1.2`.

- [ ] **Step 1: Write the failing test** `tools/src/backtest/time-limit.test.ts` (literal oracle):

```ts
import { describe, expect, it } from 'vitest';
import { limitHeadroom } from './time-limit';
import { sweepOutcome } from './playtest-run';

const at = (id: string, label: string, seconds: number) => ({ id, label, seconds });

describe('limitHeadroom (#540)', () => {
  it("passes Wadi Halam IV's measured slowest win under 840 s, and says so", () => {
    const r = limitHeadroom([at('wh4', 'wh4', 408), at('wh4', 'wh4 (gate open)', 679)], () => 840);
    expect(r.failures).toEqual([]);
    expect(r.lines).toEqual(['time limit wh4: 840 s, slowest win 679 s (wh4 (gate open)), headroom 161 s']);
  });
  it('fails a limit inside 120 s of a short win, where 120 s is the larger margin', () => {
    expect(limitHeadroom([at('a', 'a', 300)], () => 419).failures).toHaveLength(1);
    expect(limitHeadroom([at('a', 'a', 300)], () => 420).failures).toEqual([]);
  });
  it('fails a limit inside 20% of a long win, where 20% is the larger margin', () => {
    expect(limitHeadroom([at('a', 'a', 700)], () => 839).failures).toHaveLength(1);
    expect(limitHeadroom([at('a', 'a', 700)], () => 840).failures).toEqual([]);
  });
  it('fails a mission that wins and declares no limit', () => {
    expect(limitHeadroom([at('a', 'a', 60)], () => undefined).failures).toHaveLength(1);
  });
});

describe('sweepOutcome (#540)', () => {
  it('reports a defeat by the limit apart from any other defeat', () => {
    expect(sweepOutcome('defeat', 'withdrawn')).toBe('withdrawn');
    expect(sweepOutcome('defeat', 'objective:evac')).toBe('defeat');
    expect(sweepOutcome('ongoing', undefined)).toBe('ongoing');
  });
});
```

- [ ] **Step 2: Run; fails** (module and export missing).
Run: `pnpm vitest run tools/src/backtest/time-limit.test.ts`

- [ ] **Step 3: Write `tools/src/backtest/time-limit.ts`.**

```ts
// #540: does every mission's time limit clear the slowest win the harness has seen?
//
// `validate:data` holds the rule (twice the target, clear of every primary deadline). This holds
// the MEASUREMENT: over every winning run on every seed, the limit must clear the slowest by
// HEADROOM_S and by HEADROOM_RATIO, whichever is larger. A limit below a win already shows up as a
// missed seed; this catches the one that is merely too close, before a re-scripted plan crosses it.

export const HEADROOM_S = 120;
export const HEADROOM_RATIO = 1.2;

export interface WinTime {
  id: string;
  label: string;
  seconds: number;
}

export function limitHeadroom(
  wins: readonly WinTime[],
  limitOf: (id: string) => number | undefined
): { lines: string[]; failures: string[] } {
  const slowest = new Map<string, WinTime>();
  for (const w of wins) {
    const s = slowest.get(w.id);
    if (!s || w.seconds > s.seconds) slowest.set(w.id, w);
  }
  const lines: string[] = [];
  const failures: string[] = [];
  for (const [id, w] of [...slowest].sort(([a], [b]) => a.localeCompare(b))) {
    const limit = limitOf(id);
    const secs = w.seconds.toFixed(0);
    if (limit === undefined) {
      failures.push(`${id}: FAILED — wins in ${secs} s (${w.label}) and declares no time_limit_s`);
      continue;
    }
    lines.push(`time limit ${id}: ${limit} s, slowest win ${secs} s (${w.label}), headroom ${(limit - w.seconds).toFixed(0)} s`);
    if (limit < Math.max(w.seconds + HEADROOM_S, w.seconds * HEADROOM_RATIO)) {
      failures.push(
        `${id}: FAILED — time_limit_s ${limit} does not clear the slowest win (${secs} s, ${w.label}) ` +
          `by ${HEADROOM_S} s and ${Math.round((HEADROOM_RATIO - 1) * 100)}%`
      );
    }
  }
  return { lines, failures };
}
```

- [ ] **Step 4: Carry the cause through `run()`** (`tools/src/backtest/playtest-run.ts`). Add
`type DefeatCause` to the `@lions/sim` import. After `outcomeName`:

```ts
/** A defeat's cause in one word, as telemetry flattens it: `withdrawn`, `force_destroyed`,
 *  `roe_collapse` or `objective:<id>`. */
export function causeText(c: DefeatCause | undefined): string | undefined {
  if (c === undefined) return undefined;
  return typeof c === 'string' ? c : `objective:${c.objective}`;
}

/** What a swept control reports (#540): a defeat by the time limit is `withdrawn`, anything else its
 *  result. A control expecting `defeat` must lose on its own deadline, so a run the limit ended is a
 *  miss, and a witness expecting `withdrawn` must lose by the limit. */
export function sweepOutcome(result: 'ongoing' | 'victory' | 'defeat', cause: string | undefined): string {
  return result === 'defeat' && cause === 'withdrawn' ? 'withdrawn' : result;
}
```

`RunRecord` gains `cause?: string;` (doc: "The defeat's cause (`causeText`); undefined unless lost.").
`measured`'s type gains `cause?: string;`. In `run()`, right after the tick loop:

```ts
  const cause = rt.result === 'defeat' ? causeText(rt.defeatCause) : undefined;
```

append `+ (cause !== undefined ? `, cause ${cause}` : '')` to `runLine` before the `fielded` term, add
`cause` to the `runLog.push({...})` object, and `measured.cause = cause;` beside the other `measured`
writes.

- [ ] **Step 5: Let a control expect `withdrawn`.** In `passive-sweep.ts`:
`type Expect = 'defeat' | 'ongoing' | 'withdrawn';`, import `sweepOutcome` from `./playtest-run`, and
in `runInline`:

```ts
    run(id as Parameters<typeof run>[0], () => {}, ledger, expect === 'withdrawn' ? 'defeat' : expect, label, 0, undefined, new Set(), undefined, undefined, m);
  } finally {
    setSweep(undefined, false);
  }
  return sweepOutcome(m.result, m.cause);
```

In `passive-sweep-worker.ts`: `expect: 'defeat' | 'ongoing' | 'withdrawn';` on `SweepJob`, the same
`job.expect === 'withdrawn' ? 'defeat' : job.expect` in the `run(...)` call, and
`result: sweepOutcome(m.result, m.cause)` in the reply. `drainPassiveSweeps` already compares the
reported string with `c.expect`, so a control that now loses by the limit prints
`missed on 7 (withdrawn)` and sets exit 1.

- [ ] **Step 6: Print and enforce the headroom** (`plan-sweep.ts`). Import `missions` from
`@lions/data` and `limitHeadroom, type WinTime` from `./time-limit`. Add:

```ts
/** #540: one line per mission with a winning plan, and exit 1 if a limit sits too close to a win. */
function reportLimitHeadroom(runSets: Iterable<readonly RunRecord[]>): void {
  const wins: WinTime[] = [];
  for (const runs of runSets) {
    for (const r of runs) if (r.result === 'victory') wins.push({ id: r.id, label: r.label, seconds: r.minutes * 60 });
  }
  const limits = missions as Record<string, { time_limit_s?: number } | undefined>;
  const { lines, failures } = limitHeadroom(wins, (id) => limits[id]?.time_limit_s);
  for (const l of lines) console.log(l);
  for (const f of failures) console.error(f);
  if (failures.length > 0) process.exitCode = 1;
}
```

Change `drainPlanSweeps`' first line from
`if (PLAN_CHILD || process.env.PT_PLAN_SWEEP === '0') return;` to:

```ts
  if (PLAN_CHILD) return;
  if (process.env.PT_PLAN_SWEEP === '0') {
    reportLimitHeadroom([runLog]);
    return;
  }
```

and call `reportLimitHeadroom(bySeed.values());` after the gate loop. `bySeed` holds this process's
own `runLog` for 424242 (the `(max tier)` replays included) and each child's runs for 1..29.

- [ ] **Step 7: Add the two witnesses** in `playtest.ts`, just above `// I — Recon:`:

```ts
// #540: the time limit's witnesses on shipped data. Beit Sahwan I's one primary is a `locate` and
// Beit Sahwan III's are `eliminate_hvt` and `capture`: none can fail, so with no orders both ran
// STUCK at the 20-minute cap on all 30 seeds (measured 13 Oct at ff9d0c8f, force alive throughout).
// With the limit both must lose BY it, `withdrawn`, on every seed. `{}` ledger, as measured.
passiveAcrossSeeds('beit_sahwan_1_recon', 'beit_sahwan_1_recon (no orders)', 'withdrawn');
passiveAcrossSeeds('beit_sahwan_3_clearance', 'beit_sahwan_3_clearance (no orders)', 'withdrawn');
```

- [ ] **Step 8: Run the harness; green, and nothing it already printed moves.**
Run: `pnpm vitest run tools/src/backtest && PT_PLAN_WORKERS=4 PT_SWEEP_WORKERS=4 pnpm playtest > <scratch>/after.out; echo $?`
Expected: exit 0, and in `after.out`:
- `beit_sahwan_1_recon (no orders): WITHDRAWN on 30/30 seeds` and the same for `beit_sahwan_3_clearance`; their 424242 run lines read `DEFEAT in 14.0 min … cause withdrawn`.
- The 23 existing controls `DEFEAT on 30/30 seeds`; their run lines end `cause objective:<id>`.
- `plan sweep: 36 of 36 winning plans win on all 30 seeds`; all 12 gates 30/30.
- `credit ladder: 5972 over 26 missions`.
- 26 `time limit …` lines; the smallest headroom is `wadi_halam_4_village` (840 s against 679 s, 161 s).
- Diff the old and new outputs with the run lines' new `, cause …` suffix stripped: only the two witnesses and the headroom lines are new.

- [ ] **Step 9: Falsify, then restore.**
  1. `sweepOutcome` → `return result;`: both witnesses read `missed on … (defeat)`, exit 1.
  2. `wadi_halam_4_village.json` `time_limit_s` → 700 (playtest only, not committed): `wadi_halam_4_village: FAILED — time_limit_s 700 does not clear the slowest win`, exit 1.
  3. `khan_rafid_2_foothold.json` `time_limit_s` → 240: its control reads `missed on … (withdrawn)`, exit 1. (`validate:data` refuses both values too; this proves the harness on its own.)
  4. In `limitHeadroom`, `Math.max(…)` → `w.seconds + HEADROOM_S`: the 20% test goes red; → `w.seconds * HEADROOM_RATIO`: the 120 s test goes red.

- [ ] **Step 10: Commit** (`tools: playtest holds every time limit on 30 seeds (#540)`, the four mutations
named) with `-- tools/src/backtest/playtest-run.ts tools/src/backtest/passive-sweep.ts tools/src/backtest/passive-sweep-worker.ts tools/src/backtest/time-limit.ts tools/src/backtest/time-limit.test.ts tools/src/backtest/plan-sweep.ts tools/src/backtest/playtest.ts`.

---

### Task 4: A minute out, the feed warns once

**Files:**
- Modify: `packages/app/src/ui/mission-failure.ts`, `packages/app/src/ui/mission-failure.test.ts`
- Modify: `packages/app/src/i18n/en.json` (after `"hud.deadline.warn"`)
- Modify: `packages/app/src/main.ts` (beside `deadlinesWarned` and the deadline-warning block)

**Interfaces:**
- Consumes: `MissionRuntime.timeLimitTicksLeft` (Task 1); `DEADLINE_WARN_TICKS` (exists); Beit Sahwan I's `time_limit_s` 840 (Task 2).
- Produces: `withdrawalDue(ticksLeft: number | undefined, warned: boolean): boolean`; `withdrawalWarningLine(ticksLeft: number): string`.

- [ ] **Step 1: Write the failing tests** — a new section at the end of `mission-failure.test.ts`
(add `withdrawalDue, withdrawalWarningLine` to the import):

```ts
describe('4. the time limit warns once, a minute out (#540)', () => {
  it('fires at 1:00 and not at 1:01, and never once warned', () => {
    expect(withdrawalDue(DEADLINE_WARN_TICKS + 1, false)).toBe(false);
    expect(withdrawalDue(DEADLINE_WARN_TICKS, false)).toBe(true);
    expect(withdrawalDue(DEADLINE_WARN_TICKS, true)).toBe(false);
  });
  it('never without a limit, and never once it has run out', () => {
    expect(withdrawalDue(undefined, false)).toBe(false);
    expect(withdrawalDue(0, false)).toBe(false);
  });
  it('words the line', () => {
    expect(withdrawalWarningLine(DEADLINE_WARN_TICKS)).toBe('1:00 left — then the force is withdrawn');
  });

  it("Beit Sahwan I with no orders: the runtime's own cause words the withdrawal at 14:00", () => {
    const mission = missions.beit_sahwan_1_recon as unknown as MissionJson;
    const map = parseMap(maps[mission.map.file as keyof typeof maps]);
    const sim = new Sim({ seed: 424242, width: map.width, height: map.height, capacity: 256 });
    applyTerrain(map, sim);
    standMapStructures(sim, map);
    const typeOf = new Map<string, number>();
    for (const u of Object.values(units)) typeOf.set(u.id, sim.addUnitType(u as never));
    const rt = new MissionRuntime(sim, mission, {
      typeIdOf: (u) => typeOf.get(u) as number,
      markers: map.markers,
      zones: map.zones,
      tunnels: [],
      ledger: {},
      unitInfo: () => null,
    });
    rt.start();
    let end = -1;
    let warnedAt = -1;
    for (let t = 0; t < 900 * S && end < 0; t++) {
      if (warnedAt < 0 && withdrawalDue(rt.timeLimitTicksLeft, false)) warnedAt = sim.tickCount;
      for (const e of rt.step(sim.tick())) if (e.kind === 'missionEnd') end = e.tick;
    }
    expect(warnedAt).toBe(780 * S);
    expect(end).toBe(840 * S);
    expect(rt.defeatCause).toBe('withdrawn');
    expect(failureReason(rt.defeatCause, rt.objectiveList, end)).toBe(
      'Withdrawn, out of time: Identify six garrison positions · 14:00'
    );
  });
});
```

- [ ] **Step 2: Run; fails** (exports missing).
Run: `pnpm vitest run packages/app/src/ui/mission-failure.test.ts`

- [ ] **Step 3: Implement.** `en.json`, after `"hud.deadline.warn"`:

```json
  "hud.withdraw.warn": "{left} left — then the force is withdrawn",
```

`mission-failure.ts`, after `deadlineWarningLine` (and a point 4 in the header: "the time limit warns
once, a minute out, through the same feed line and chime"):

```ts
/** #540: whether the one feed line before the time limit is due -- once, at a minute or less, never
 *  once the limit has run out. `ticksLeft` is `MissionRuntime.timeLimitTicksLeft` (sim ticks, so a
 *  pause holds it); the caller keeps `warned`. */
export function withdrawalDue(ticksLeft: number | undefined, warned: boolean): boolean {
  return !warned && ticksLeft !== undefined && ticksLeft > 0 && ticksLeft <= DEADLINE_WARN_TICKS;
}

/** The feed line for the time-limit warning. */
export function withdrawalWarningLine(ticksLeft: number): string {
  return t('hud.withdraw.warn', { left: clockText(ticksLeft) });
}
```

`main.ts`: extend the import from `./ui/mission-failure` with `withdrawalDue, withdrawalWarningLine`;
after `let deadlinesWarned … = new Set();` add

```ts
  // #540: the time limit's one-minute warning, once per mission.
  let withdrawalWarned = false;
```

and inside the existing `if (runtime && runtime.result === 'ongoing' && sim.tickCount % 5 === 0) {`
block, after its `for (const row of due.warn) { … }` loop:

```ts
      // #540: not in the tutorial, whose own step machine ends it long before its limit.
      if (stepList === undefined && withdrawalDue(runtime.timeLimitTicksLeft, withdrawalWarned)) {
        withdrawalWarned = true;
        hud.note(escapeHtml(withdrawalWarningLine(runtime.timeLimitTicksLeft ?? 0)), 'warn');
        audio.playCue(ALERT_CUE.important);
      }
```

- [ ] **Step 4: Run; green.**
Run: `pnpm vitest run packages/app/src/ui/mission-failure.test.ts packages/app/src/i18n && pnpm typecheck && pnpm lint && pnpm validate:ui`

- [ ] **Step 5: Falsify, then restore.** `ticksLeft <= DEADLINE_WARN_TICKS` → `<`: "fires at 1:00"
goes red and `warnedAt` reads 780.05 s. Drop `ticksLeft > 0 &&`: "never once it has run out" goes red.

- [ ] **Step 6: Drive the real UI once** (memory: console shortcuts skip the code that breaks). One
browser, Metal, music off, own port, closed after. Start the dev server itself (not through `pnpm`, so the PID is vite's own) on a free port that is
not 5177:

```bash
cd <worktree>/packages/app && (./node_modules/.bin/vite --port 5193 --strictPort > <scratch>/vite.log 2>&1 & echo $! > <scratch>/vite.pid)
```

Save as `<worktree>/tools/src/.scratch-540/check-540.ts` (inside the tools package so `playwright` resolves;
untracked, deleted after, never committed) and run it with
`pnpm --filter @lions/tools exec tsx src/.scratch-540/check-540.ts`:

```ts
import { chromium } from 'playwright';
import { musicOffInitScript } from '../ui-review/music-off';
import { gpuLaunchArgs } from '../ui-review/gpu';
import { dismissDeployGate } from '../golden-diff/capture-guard';

const browser = await chromium.launch({ args: gpuLaunchArgs('metal') });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(musicOffInitScript());
  await page.goto('http://localhost:5193/?mission=beit_sahwan_1_recon');
  await dismissDeployGate(page, 'check-540');
  await page.waitForFunction(() => (window as unknown as { __lions?: unknown }).__lions !== undefined);
  await page.evaluate(() => (window as any).__lions.step(780 * 20 - (window as any).__lions.sim.tickCount));
  await page.waitForTimeout(500);
  console.log('feed:', await page.locator('.rl-feed').innerText());
  await page.evaluate(() => (window as any).__lions.step(61 * 20));
  await page.waitForTimeout(1500);
  console.log('reason:', await page.locator('.rl-outcome__reason').innerText());
} finally {
  await browser.close();
}
```

Expected: the feed shows "1:00 left — then the force is withdrawn"; the outcome card's reason reads
"Withdrawn, out of time: Identify six garrison positions · 14:00". Then `kill $(cat <scratch>/vite.pid)`, `rm -r <worktree>/tools/src/.scratch-540`,
and confirm with `lsof -i :5193` that nothing is listening.

- [ ] **Step 7: Commit** (`polish: the feed warns a minute before the time limit (#540)`, both mutations
and the browser reading named) with `-- packages/app/src/ui/mission-failure.ts packages/app/src/ui/mission-failure.test.ts packages/app/src/i18n/en.json packages/app/src/main.ts`.

---

### Task 5: Telemetry accepts the new cause

**Files:**
- Modify: `data/schemas/telemetry_event.schema.json` (the `mission_end` `cause` pattern)
- Modify: `packages/data/src/telemetry.ts` (`CAUSE_PATTERN` and its doc comment)
- Modify: `packages/data/src/telemetry.test.ts` (`VALID`)
- Modify: `packages/app/src/telemetry/events.test.ts` ('flattens a defeat cause')

**Interfaces:**
- Consumes: `DefeatCause` incl. `'withdrawn'` (Task 1). `causeString` needs no change: a string cause passes through.

Without this, the app sends `cause: "withdrawn"` and the Worker (same deploy, same `packages/data`
guard) drops the whole `mission_end` event.

- [ ] **Step 1: Failing tests.** Add to `VALID` in `packages/data/src/telemetry.test.ts`:

```ts
  { ...ENV, type: 'mission_end', mission: 'khan_rafid_1_recon', result: 'defeat', cause: 'withdrawn', tick: 14400, roe: 100, fielded: 6, lost: 1, objectivesDone: 1, objectivesTotal: 2 },
```

and to 'flattens a defeat cause' in `events.test.ts`: `expect(ev.causeString('withdrawn')).toBe('withdrawn');`
Run: `pnpm vitest run packages/data/src/telemetry.test.ts` — FAIL (schema and guard both reject).

- [ ] **Step 2: Implement.** In both places the pattern becomes
`^(force_destroyed|roe_collapse|withdrawn|objective:[A-Za-z0-9_.-]{1,64})$`; the doc comment on the
`cause` field reads "`force_destroyed`, `roe_collapse`, `withdrawn` (#540) or `objective:<id>`; defeats only."

- [ ] **Step 3: Green.** `pnpm vitest run packages/data/src/telemetry.test.ts packages/app/src/telemetry packages/worker`

- [ ] **Step 4: Falsify.** Revert the schema pattern only: the new fixture fails `validate` while
`isTelemetryEvent` passes. Revert the guard only: the reverse. Restore both.

- [ ] **Step 5: Commit** (`telemetry: "withdrawn" is a defeat cause (#540)`) with
`-- data/schemas/telemetry_event.schema.json packages/data/src/telemetry.ts packages/data/src/telemetry.test.ts packages/app/src/telemetry/events.test.ts`.

---

### Task 6: The authoring rule is written down

**Files:**
- Modify: `CLAUDE.md` ("Adding content", the **A mission** paragraph)
- Modify: `docs/campaign/README.md` ("Rules that apply to every document", rule 7)

- [ ] **Step 1: CLAUDE.md.** After the paragraph's last sentence ("…the schema is the only thing that
checks it."), add:

> **And it declares `time_limit_s` (#540), twice `target_minutes` at least.** When it runs out with a
> primary still open, `checkEnd` ends the mission as a defeat whose `defeatCause` is `withdrawn` (not a
> new `result`); the feed warns once a minute out, and the outcome card and debrief name the first
> primary still open. `validate:data` (`tools/validate_time_limit.mjs`) holds the floor and a 60 s
> clearance over every primary deadline, so a losing mission still loses on its own clock;
> `pnpm playtest` holds a 120 s and 20% margin over the slowest 30-seed win and prints one
> `time limit` line per mission. The tightest is Wadi Halam IV (840 s against an 11.3-minute win with
> its gate open, 13 Oct). The limit counts sim ticks and lives in the runtime, so it moves no sim pin;
> two no-orders witnesses (Beit Sahwan I and III) lose by it on all 30 seeds.

- [ ] **Step 2: docs/campaign/README.md** rule 7 gains: "Every mission declares `time_limit_s`, at least
twice its `target_minutes` (#540); a design that needs more must show the measured win that needs it."

- [ ] **Step 3: Commit** (`docs: the mission time limit, for authors (#540)`) with `-- CLAUDE.md docs/campaign/README.md`.

---

## Before the PR

- [ ] `pnpm test && pnpm test:determinism && pnpm typecheck && pnpm lint && pnpm validate:data && pnpm validate:ui && pnpm playtest` — all green; pins and 5972 unchanged.
- [ ] `ps`/`lsof` on the worktree path and port 5193: nothing left running.
- [ ] PR body: the per-mission table from "Measured", the playtest diff summary (two witnesses and 26 headroom lines added, nothing moved), the browser reading, "no bless expected", and the line "🤖 Generated with [Claude Code](https://claude.com/claude-code)". Do not merge.

## Self-review (done while writing)

- **Issue scope:** schema field (T2), `checkEnd` (T1), debrief line (T1), `validate:data` rule (T2),
  per-mission value derived from `target_minutes` and measured (Measured + T2 + T3), the latent
  `locate` case (Measured: ended by the limit; a direct rule is out of scope).
- **Ruling 4:** right before F1 (Global Constraints); no sim pin (T1 Step 5, the hash test); a defeat
  reason, not a result (T1); clears the slowest 30-seed win and every control's deadline (Measured, T2
  rule, T3 harness); the stall hint stays (untouched; T4 adds the minute warning beside it).
- **Names used across tasks:** `time_limit_s`, `timeLimitTicksLeft`, `'withdrawn'`, `withdrawalDue`,
  `withdrawalWarningLine`, `timeLimitFailures`, `causeText`, `sweepOutcome`, `limitHeadroom`, keys
  `outcome.failed.withdrawn`, `outcome.failed.withdrawnBare`, `hud.withdraw.warn`. Each is defined in
  the task that produces it and used under the same name after.
