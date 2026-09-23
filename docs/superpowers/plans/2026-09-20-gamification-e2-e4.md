# Gamification E2 + E4 — "a roster cap with a reserve, and who replaced whom" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The cumulative roster stops growing without bound, and a unit's place in the brigade outlives the unit. Two work packages, one plan, because they are one mechanism: **a cap needs a total order over the roster to decide what falls, and the slot identity E4 invents is that order.** Written the other way round — a cap that sorts by veterancy alone has no tiebreak that survives a save, and a slot id with no cap is a number nothing reads. Both land app-side, on the ledger the sim hands back, and `packages/sim` is not opened by any task.

**Architecture:** Everything is inside `packages/app`, plus one pin and one printed measurement in `tools/src/backtest/playtest.ts` and two cross-package specs under `tools/src`. The pattern Phases 1–3 established holds: **a pure model module with its own `*.test.ts`, and a thin layer over it.** Four new pure modules — `ledger-store.ts` (the persistence seam), `roster-cap.ts` (the number and the split), `roster-slots.ts` (the durable slot and its carry), `roster-lost.ts` (the memorial and the pairing) — and three existing screens gain a line each. **`main.ts`'s `missionEnd` handler (`:3496-3554`) is the one wiring site**, the same seam that already post-processes the sim's raw roster through `assignNames` before persisting it. Nothing in this plan runs inside a tick, nothing writes to sim state, and nothing changes what `checkEnd` produces.

**Tech stack:** TypeScript strict (`packages/app`, `tools`), vitest, no new dependencies, no new tooling, no dev server, no browser except the capture pass in Tasks 6–8.

**Spec:** GitHub issues **#174** (WP-G-E2, "roster and reserve cap") and **#176** (WP-G-E4, "lost and replaced (roster slot identity)"), both Stage 1 · Lane B · EP M1, both gated on **G0 #12**, answered 18 Sep: *"measure first; cap above ★★★; reserve list"* (`docs/HANDOVER.md:38`).

The definitions this plan works to, from the gamification page's **Phase E · Close the loop** bullets:

> **The roster cap.** Cumulative rosters grow without bound (measured on Phase B); decide the reserve cap and what happens to the overflow.

> **"Lost and replaced."** A durable slot identity on the roster so a replacement remembers whose place it took; the memorial half of a service record.

And from the same page's "Decisions to take before anyone builds" table, the row that G0 #12 answers:

> | Roster and reserve cap | measure first | Growth was measured on Phase B; the cap should sit above what a ★★★ campaign accumulates, not below it. |

Two standing rules from that page bind every task here: *"Do not let a tier, a credit or a name reach the sim"* — a slot id is the fourth thing on that list — and *"Losses and elapsed time are shown, never graded"* (M2). A memorial record is a record. Nothing in this plan scores a loss, and nothing rewards avoiding one.

Related docs: `docs/HANDOVER.md` (the programme ledger; G0 #12 at line 38, lane B's next action at line 13), `docs/superpowers/plans/2026-09-19-shell-upgrade-phase-3-app.md` (the `DeployRosterView` seam, R-4 and Task 1 there), `docs/superpowers/plans/2026-09-19-gamification-e3.md` (the harness pins this plan must not move), `docs/campaign/economy/prices.md`.

---

## Baseline — measured this session, not quoted

`pnpm playtest`, run once in this worktree on `feat/gamification-e2e4` at `a567b892`, 2026-09-20, **exit 0**. Every number below is from the harness's own printed lines, read off the 83 `roster out N` it emits. Where the research brief and this run disagree, this run wins and the difference is called out.

**Roster growth, per town chain, plain `label === id` winning runs only:**

| Chain | `roster out` per mission | chain maximum |
|---|---|---|
| Beit Sahwan (breach → 1 → 2 → 3 → 4) | 14 → 19 → 22 → 24 → 25 | **25** |
| Wadi Halam (1 → 5) | 4 → 9 → 10 → 14 → 13 | **14** |
| Khan Rafid (1 → 3) | 6 → 9 → 11 | **11** |
| Deir Amun (1 → 3) | 6 → 12 → 12 | **12** |
| Tel Marum (1 → 3) | 7 → 7 → 10 | **10** |
| Qarn Hadid (1 → 3) | 13 → 19 → 24 | **24** |
| Umm Zeitoun (1 → 4) | 13 → 18 → 21 → 30 | **30** |

**The largest `roster out` anywhere in the harness is 30**, at `umm_zeitoun_4_clearance`, and it reads 30 on both the plain run and the max-tier replay. No control, gate-open probe or max-tier replay exceeds it (the next highest are `beit_sahwan_4_subterranean (max tier)` at 26 and `qarn_hadid_3_clearance (gate open)` at 25).

**Four corrections to the research brief's §2 table, measured.** The brief pooled probe lines with plain ones, and E3 has landed since it was written:

1. Beit Sahwan reads **14 → 19 → 22 → 24 → 25**, not `…23…26`. 23 is `beit_sahwan_2_foothold (max tier)` and 26 is `beit_sahwan_4_subterranean (max tier)`.
2. Wadi Halam ends at **13**, not 15. 15 is `wadi_halam_5_depot (gate open)`.
3. Deir Amun reads **6 → 12 → 12**, not `6 → 14 → 12`; Tel Marum reads **7 → 7 → 10**, not `7 → 9 → 10`.
4. Qarn Hadid ends at **24**, not 25. 25 is `qarn_hadid_3_clearance (gate open)`.

The brief's headline conclusion survives all four: the largest single threaded chain is Umm Zeitoun's, at 30.

**What the harness can and cannot measure, in its own words** (`playtest.ts:36-42`, the comment on `missionStars`): the chained ledgers *"do not reliably reach the three star gates — Khan Rafid and Deir Amun's plans, for instance, deliberately run on a bare `{}` ledger rather than chaining off Beit Sahwan… so no single threaded ledger ever accumulates the whole campaign's stars."* The roster numbers confirm it directly: Wadi Halam opens at 4, and `roster.surviving_units` only ever appends, so a true continuation could not drop. **No single continuous 26-mission roster total has ever been measured, and Task 2 does not invent one** — see R-10.

**The code facts every task rests on, each re-read in this worktree rather than taken from the brief:**

- `LedgerRosterEntry` is `{ type; veterancy; name?; missions?; kills? }` (`packages/sim/src/mission.ts:93-104`). `LedgerData['roster.surviving_units']` at `:105`.
- `checkEnd` (`mission.ts:1861-1887`) rebuilds a fielded survivor's entry **field by field** — `{ type, veterancy, missions, kills }` plus `if (origin?.name !== undefined) entry.name = origin.name`. **`name` is the only field that survives being fielded.** An entry that was never fielded is pushed with `{ ...left }` (`:1887`), a full spread, so **every** field survives on that path. This asymmetry is the whole reason Task 3 exists.
- `spawnPlacement` (`mission.ts:1254-1267`) draws `from_ledger` bodies by `findIndex((r) => r.type === p.unit)` + `splice`, first-match-in-pool-order, and substitutes exactly one fresh remnant (`drawn = [null]`) when the pool holds none of the type. It is blind to any identity field on the entries it draws.
- `entityRoster.set(id, origin)` (`mission.ts:1304`) stores **the app's own object**, and the map is never deleted from or cleared — only `.set` (`:1304`) and `.get` (`:795`, `:1874`) exist. `rosterEntryOf(id)` (`:793`) hands that object back as `Readonly`, **including after the entity dies**.
- **`unitLost` already exists and is already in the app's hands.** `MissionRuntime.step` emits `{ kind: 'unitLost'; tick; entity; side: 0; unit }` for every player-side `destroyed` event (`mission.ts:1018-1025`, `:351`), the shell Phase 2 alert layer consumes it (`ui/alerts.ts`), and `main.ts:3486` already iterates `missionEvents` with `runtime` in scope. **The research brief's recommendation to capture raw `destroyed` SimEvents is superseded**: the signal it asks for shipped with Phase 2 and is already side-filtered.
- The seam is `main.ts:3505-3528`: `const updatedLedger = { ...ledger, ...me.ledger }`, then on victory only, `assignNames(rosterIn, issuedIn, …)`, then `saveLedger(storage, updatedLedger)`. A defeat writes nothing (M4, no ironman).
- `assignNames` (`names.ts:52-67`) is `{ ...entry }` for an already-named entry and `{ ...entry, name }` for a new one — **both full spreads, so a `slot` already on an entry survives it untouched.** `nthName` is injective on the per-kind counter for every kind, so names are unique for the life of a save.
- **No screen reaches `localStorage` for campaign state today.** Every ledger/account read and write in `packages/app` goes through `main-keys.ts` (`loadLedger`/`saveLedger`, 5 sites in `main.ts`) or `brigade-account.ts` (`loadAccount`/`saveAccount`, 8 sites in `main.ts`), with `profile.ts` layered on both and `ui/saves.ts` layered on `profile.ts`. The only raw `localStorage` in UI source is the **renderer choice** (`ui/menu.ts:251,259`; `main.ts:1652,1655`) — see R-9.
- `packages/app/src/ui/deploy-roster.ts` **does not exist** on this branch (`ls`, confirmed). Phase 3's app half is still a plan document.
- `pnpm ui:shots` captures `03-brigade` (`shoot.ts:193-195`) and `17-debrief` (`:476-478`), both with and without `--pseudo`. All three of this plan's new chrome surfaces are already inside that walk.

---

## The cap, and the margin

**`ROSTER_CAP = 150`**, set in Task 2 beside the measurement that justifies it.

- **5.0× the measured maximum.** The largest roster any threaded chain in the harness produces is **30**.
- **1.19× a deliberately loose ceiling.** Summing every chain's own maximum as though a real campaign drew nothing forward between towns gives 25 + 14 + 11 + 12 + 10 + 24 + 30 = **126**. That sum is an over-estimate by construction: in a continuous campaign a later town's `from_ledger` placements draw veterans out of the pool instead of spawning fresh remnants, so each town adds *fewer* new bodies than it does in isolation, never more. 150 clears the over-estimate.
- **It is meant not to bind in normal play.** The page's own rule is *"the cap should sit above what a ★★★ campaign accumulates, not below it"*. This is a rail against unbounded growth from replays and long play, not a design constraint on one playthrough. A cap a campaign reaches would be a different feature and a different gate.
- **It is re-pinned when the ladder moves.** Task 2 puts `ROSTER_MAX` in the harness and makes `pnpm playtest` go red if the measured maximum ever reaches the cap. A number nothing checks is a number that rots.

---

## Global Constraints

Binding on every task.

- **`packages/sim` is untouched — byte for byte, tests included.** No task edits a file under `packages/sim/`. Every commit runs `/usr/bin/git diff --stat a567b892..HEAD -- packages/sim` and it must come back **empty**. The golden determinism hash therefore cannot move; `pnpm test:determinism` is run once, in Task 8's gate line, as evidence rather than claim. `pnpm balance` is out of scope: no tuning constant, no unit JSON stat and no map is touched.
- **The cap, the reserve, the slot and the memorial are applied to the ledger the sim RETURNS.** Invariant 4 both ways: nothing outside the sim mutates sim state, and nothing this plan computes feeds back into a tick. `rosterEntryOf` hands out the runtime's own object as `Readonly` precisely so a write is a compile error (`mission.ts:786-795`); no task here writes through it.
- **Three new ledger keys, all app-only, none in any mission's contract.** `roster.reserve`, `roster.lost` and `campaign.slots_issued` are declared on the app's own `CampaignLedger` (Task 1), never on `@lions/sim`'s `LedgerData`, and no mission JSON names one in `ledger.requires`/`produces`. `mission.schema.json:145`'s enum of legal ledger keys is therefore **not** touched, and `pnpm validate:data` would correctly reject a mission that named one. `checkEnd` builds `produced` from `produces` alone (`mission.ts:1944-1955`), so `{ ...ledger, ...me.ledger }` carries all three through the merge untouched.
- **The reserve is structurally undrawable, not conventionally.** `MissionRuntime` seeds `rosterPool` from `ctx.ledger['roster.surviving_units']` and nothing else (`mission.ts:550`). An entry moved to `roster.reserve` cannot be fielded because the sim never reads that key — not because a caller remembers to skip it.
- **Nothing is ever deleted.** #174's own words. Every pure function in this plan is length-preserving over the population it is given: `splitRoster` returns two arrays whose lengths sum to its input's, and `roster.lost` is append-only. Each has a spec that asserts exactly that, and each spec has a mutation that breaks it.
- **Every new player-facing string goes through `t()` at the render call**, with a new flat key in `packages/app/src/i18n/en.json`, never built up in a variable first — `validate_i18n.mjs`'s regex is anchored on a sink assignment with an adjacent quote and cannot see a string that arrives through a variable (CLAUDE.md, and its own header names the three defect classes it misses). `pnpm ui:shots -- --pseudo` is the instrument that finds them: **a plain unbracketed word in a pseudo capture is a string that never went through `t()`**.
- **Every check gets an input that makes it fail — constructed, and run** (CLAUDE.md). Each task names its falsification, runs it, watches the named line go red, restores, and says in the commit message that it was seen red.
- **`pnpm playtest` must exit 0 at every commit and must not move a pin.** It is in CI's `gates` job. The three star gates (`5 / 13 / 19` for `breach_team` / `scout_shachaf` / `apc_kipod`, measured on this HEAD), `credit ladder: 5849 over 26 missions`, the 13 passive controls at DEFEAT and `max tier: 26 of 26` must all read identically before and after every task in this plan. **Nothing here can legitimately move any of them** — the harness constructs its own ledgers and never runs the app's seam — so a moved pin is a bug to find, never a number to re-pin.
- **Gates before every commit:** `pnpm lint && pnpm typecheck && pnpm test && pnpm validate:data && pnpm validate:ui && pnpm playtest`. `typecheck` is not in CLAUDE.md's command list and is in CI — include it. `validate:ui` is included because every task after Task 4 adds an `en.json` key. Add `pnpm test:determinism` on Task 8. Nothing here needs `validate:assets`, `validate:meshes` or `validate:audio`.
- **Git hygiene:** commit with explicit pathspecs (`/usr/bin/git -C <worktree> add <paths>` then `commit -s -- <paths>`), **never `-A`** — other sessions share this checkout and one agent's `git add` lands in another's commit. Never `git checkout -- <file>`; undo the edit, not the file. Call `/usr/bin/git` by absolute path in a worktree. DCO `-s`, and a `Co-Authored-By:` trailer naming the model that actually did the work.
- **Do not kill the dev server.** Tasks 6–8 run `pnpm ui:shots`, which boots and stops its own. `pkill -f vite` has taken down the lead's server four times in one session; nothing in this package goes near it.

---

## Rulings

R-1…R-8 are the controller's, binding, recorded here with the evidence this session found for each. R-9…R-13 were taken while planning.

### R-1 — The `LedgerStore` adapter comes first, and it is the Steam roadmap's seam.

Task 1 and nothing before it. One app-side module through which the brigade account, the campaign ledger and the save slots are read and written; today's `localStorage` implementation behind it; every existing reader and writer moved onto it in that task, with a spec per method; **screens never touch `localStorage` again.** WP-ST6 (#205, server-authoritative ledger, gate G7 #199) replaces the implementation and opens no screen.

**What this session found that makes the task smaller and the ordering more important than it looks.** No screen touches `localStorage` for campaign state *today* — the three keys already have exactly one reader/writer pair each (`main-keys.ts`, `brigade-account.ts`, `profile.ts`), and every call site is in `main.ts` or behind `profile.ts`. So the adapter is a **consolidation, not a rescue**: it gives the three pairs one object, moves `safeStorage()`'s null-guard inside it, and gives `profile.ts` a `LedgerStore` instead of a `StorageLike`.

The reason it must still come first is not tidiness. **This plan adds three keys to the ledger and `@lions/sim`'s `LedgerData` may not learn about any of them** (R-2). Something has to own the app's own widened ledger type and the one `JSON.parse` cast that produces it, and that something is the adapter. A type the caster does not know is a cast it cannot make, so `CampaignLedger`, `RosterEntry` and `LostRecord` are declared in Task 1 even though Tasks 3–5 are what fill them.

### R-2 — The sim is untouched, and the slot survives the round trip by a stable app-side rule.

**Verified, against the code rather than the brief:** a new field on `LedgerRosterEntry` is dropped for every unit that is fielded and lives (`checkEnd` rebuilds the entry field by field, `mission.ts:1874-1883`), and survives for every unit that was never fielded (`{ ...left }`, `:1887`). So **there is no field the sim copies through untouched except `name`**, and the preferred option in the controller's ruling is not available.

The reattachment rule, which Task 3 pins with five specs:

> **`slot` and `name` are issued together, to the same entry, in the same pass, and only there.** An OUT entry carrying a `slot` is an unfielded pass-through and keeps it. An OUT entry carrying a `name` but no `slot` is the fielded survivor of the IN entry with that name — it takes that entry's slot. An OUT entry carrying neither is new this mission.

Three facts make the rule total rather than heuristic. Names are **unique for the life of a save** (`nthName` is injective on a per-kind counter that is never decremented, `names.ts:32-50`). The fielded and unfielded sets are **disjoint** — `spawnPlacement` splices a drawn entry out of `rosterPool`, so no entry can appear on both paths. And `assignNames` runs over the **whole** roster on every victory with a full spread, so after the first write there is no persisted entry without a name.

The one hole is named rather than papered over: an entry with a slot and no name cannot be reattached, and is treated as new. That state is unreachable once the pair is issued together, and Task 3's spec constructs it deliberately to prove the fallback does not throw or collide.

**The one-line `checkEnd` change (`entry.slot = origin?.slot`) was considered and refused.** It is smaller than the rule above and it is a diff under `packages/sim/`. This plan's Global Constraint is byte-for-byte, and a slot id is the fourth item on the gamification page's own *"do not let a tier, a credit or a name reach the sim"*. If a later session wants it, it is a deliberate, reviewed exception and it deletes `reattachSlots` — recorded in Out of scope.

### R-3 — Measure first, and the number is set beside the measurement.

Task 2 adds a printed `roster total` line per chain to `pnpm playtest`, pins the maximum as `ROSTER_MAX`, and sets `ROSTER_CAP` **above** it — stated in "The cap, and the margin" above with both margins (5.0× the measured 30, 1.19× the loose 126 ceiling). The harness asserts the relationship, so the cap is re-pinned by a red run rather than by memory.

### R-4 — Overflow goes to a reserve list, never deleted; newest-in falls first and veterans stay.

**The page is silent on which entries fall.** It says only *"decide the reserve cap and what happens to the overflow"* and *"the cap should sit above what a ★★★ campaign accumulates"*; #174 adds *"overflow goes to a reserve list and is never deleted."* The controller's fallback therefore applies, and Task 4 implements it as a total order:

> **veterancy descending, then `missions` descending, then `kills` descending, then `slot` ascending.** Keep the first `cap`; the tail is the reserve.

`slot` ascending is what makes "newest-in falls first" exact — a slot id is the chronology, which is the second reason E4's identity belongs in the same package as E2's cap. The order is **total** (no two active entries share a slot), so the split is deterministic and a save round-trips byte-identically.

**Two consequences, both deliberate.** The split is recomputed from the whole population — active plus reserve — on every write, so **a reserve entry comes back** when the active list falls below the cap through losses. That is what keeps "never deleted" from meaning "benched forever", and it costs nothing: the same function, one input. And it cannot churn — a reserve entry's veterancy, missions and kills never change while it is in reserve, so it can only move up when something above it dies.

**Replays still append, and the reserve absorbs it.** A replay is a new run; the ledger grows; the split takes the overflow. **The migration on load bounds nothing and deletes nothing** — the split is computed and applied only on a mission-end *write* (Task 4), never on a read, so opening an old save can never silently shorten a roster.

### R-5 — One human sentence on the brigade screen, and the deploy screen's `cap` stops being null.

The brigade screen's campaign line (`ui/brigade.ts:250-256`) is already `${t('garage.stars', …)} · ${t('garage.conduct', …)}` with a ternary picking `garage.conduct`/`garage.conduct.none`. Task 6 appends a third ` · ` clause on the same shape, through `t()` at the render call.

**It renders always, not only when the reserve is non-empty.** Two reasons: `pnpm ui:shots`'s `03-brigade` runs on a near-fresh ledger, so a sentence gated on overflow would never be photographed and would never be pseudo-checked; and a player needs to know the cap exists before they meet it.

**The wording is chosen to stop a collision the brief found.** The deploy screen already says `"{n} in reserve"` (`loading.brought.reserve`, `en.json:198`) about a completely different thing — the entries *this mission's* placements did not draw, a number that changes every mission. The brigade screen says **"stood down"** for the cap's overflow, which is a property of the whole roster. `loading.brought.reserve` is not touched.

### R-6 — A slot is a place in the order of battle, and a memorial record is what it remembers.

- A durable id, `slot`, assigned app-side on first fielding and persisted on the entry, from a monotone `campaign.slots_issued` counter that mirrors `campaign.names_issued` exactly.
- A lost unit's entry becomes a **memorial record** appended to `roster.lost`: kept, flagged by being in that array rather than the roster, **not counted against the cap** (the split runs over `roster.surviving_units` + `roster.reserve` only).
- **The replacement takes the lost slot's id.** That is the whole of "remembers whose place it took": no `replaces` field is needed on the entry, because the entry and the memorial record share a slot number. A slot therefore accumulates a *history* of who held it, and the card shows the most recent chapter.
- A vacancy is **derived, never flagged**: a memorial record is unfilled iff no entry in `roster.surviving_units` or `roster.reserve` carries its slot. No second piece of state to keep in sync.
- The unit card and the debrief both say "lost … replaced by …" through `t()`, in Tasks 7 and 8.

### R-7 — Save compatibility is a spec that loads a pre-change fixture.

Existing ledgers load with every new field defaulting: `roster.reserve` absent reads as empty, `roster.lost` absent reads as empty, `campaign.slots_issued` absent reads as 0, and an entry without a `slot` is issued one on the next write. `profile.ts`'s slots keep working because a `SaveSlot` snapshots `ledger` wholesale and `importSlot` validates only `isRecord(v.ledger)` — a new key rides along. Task 1 and Task 4 each carry a spec that parses a **verbatim pre-change save string** (a named, slotless, reserve-less roster) and asserts the full round trip. **One gap is documented rather than fixed (final review):** a save written before this branch has no slots during its first mission, so that mission's deaths leave no memorial.

### R-8 — Eight tasks; the adapter and the slot model at opus, the rest at sonnet.

Eight, each one or two production files plus its test, each with a named falsification that is run. **Task 1 (`LedgerStore`) and Task 3 (slot identity) run at opus** — one is a boundary that ST6 inherits, the other is an identity model whose failure mode is a save file the player cannot account for. Tasks 2, 4, 5, 6, 7, 8 run at **sonnet**.

### R-9 — `lions.settings` and `lions.renderer` are deliberately NOT behind the adapter.

R-1's scope is the brigade account, the campaign ledger and the save slots — the three keys a `SaveSlot` snapshots and the one key that holds them. `lions.settings` (`settings.ts`, the only reader and writer, holds video/audio/controls/accessibility/language) and `lions.renderer` (`renderer-choice.ts`, `ui/menu.ts:251,259`) are **facts about the person and the device, not about the campaign**. ST6 moves campaign state to a server; it does not move somebody's `--ui-scale` or which renderer their browser copes with, and a renderer choice that needed a network round trip before the menu could draw would be a regression. `menu.ts`'s existing guarded access (`window.localStorage?.getItem?.(…)`) stays as it is — it is right for a real browser with site data blocked, and it is the only thing that works in this vitest jsdom config, where `window.localStorage` is a bare `{}` with no `getItem`.

### R-10 — Task 2 measures per chain and says so. It does not fake a campaign-wide total.

The research brief offered two ways to get a true 26-mission roster figure: thread one ledger through every winning plan, or reconstruct one from recorded per-mission scalars. **Neither is taken.** Threading is precisely what `playtest.ts:36-42` records being tried and abandoned for stars, and a different roster composition changes which units a scripted plan controls, so a break would be a plan fragility masquerading as a measurement. Reconstruction cannot work because a roster is not a scalar: a mission's delta depends on the incoming pool it was never run against.

So Task 2 prints what the harness genuinely knows — **each chain's own maximum, and the global maximum over all of them** — and the cap is set above a loose sum-of-chains ceiling rather than above a fabricated total. The printed line says which it is. A measurement labelled as something it is not is worse than no measurement, and this is the same honesty `missionStars`'s own comment already practises.

### R-11 — The debrief's named list is a subset of its count, and the plan says so on screen.

`lostByType()` (`mission.ts:741-749`) counts **every** dead player entity, including a fresh remnant spawned this mission that never reached the roster and has no identity to memorialise. The named memorial list can only ever cover units drawn from the roster. Task 7 therefore keeps today's `{type, count}` aggregate as the total, unchanged, and adds the named list **beside** it rather than replacing it. A player who reads "Lost: rifle squad ×3" and then two names has not found a bug.

### R-12 — `DeployRosterView.cap` is filled if the file exists, and handed over if it does not.

`packages/app/src/ui/deploy-roster.ts` does not exist on this branch; Phase 3's app half is a plan document whose own R-4 says E2 *"changes `deployRosterView`'s implementation and fills the `cap` field this plan leaves `null`; it does not change the deploy screen"*, and whose head says it may land before, during or after this branch. Task 6 therefore begins with `ls packages/app/src/ui/deploy-roster.ts`:

- **If it exists**, Task 6 sets `cap: ROSTER_CAP` in `deployRosterView` and adds one spec that the field is non-null. The deploy screen itself is not touched.
- **If it does not**, Task 6 exports `ROSTER_CAP` from `roster-cap.ts` as the one public source of the number, and records in its report that Phase 3 Task 1 imports it. That is already the shape Phase 3's plan expects — its `cap` field is `number | null` and its own task builds the module.

Either way E2 never creates `deploy-roster.ts`, and never depends on it existing.

### R-13 — The order at the seam is fixed, and it is why Tasks 3 and 5 interleave.

One pipeline, in `main.ts`'s victory branch, replacing the single `assignNames` call:

```
1. before   = ledger['roster.surviving_units'] ?? []        (the roster sent IN)
2. out      = updatedLedger['roster.surviving_units']        (what checkEnd produced)
3. reattachSlots(out, before)        Task 3 — fielded survivors get their slot back
4. appendLost(lost, lostThisMission) Task 5 — this mission's memorial records
5. fillVacancies(out, lost)          Task 5 — a slotless entry takes a vacant slot of its type
6. issueSlots(out, issued)           Task 3 — anything still slotless gets a fresh id
7. assignNames(out, …)               unchanged
8. splitRoster(out, reserve, CAP)    Task 4 — active and stood-down
9. store.writeLedger(…)
```

Two things about it were decided rather than fallen into. **Steps 5 and 6 are separate functions, not one**, so Task 3 is complete and correct on its own commit (every entry gets a durable slot) and Task 5 only refines *which* slot a new entry gets. And **losses are appended before vacancies are filled**, so a slot vacated this mission can be filled this mission — which is what a brigade does, and which Task 5 tests in both directions.

---

## File structure

| File | Responsibility | Task |
|---|---|---|
| `packages/app/src/ledger-store.ts` (+test) | The persistence seam: `LedgerStore`, `browserLedgerStore`, `memoryLedgerStore`, and the app's own `CampaignLedger` / `RosterEntry` / `LostRecord` types | 1 |
| `packages/app/src/main-keys.ts`, `brigade-account.ts` | Unchanged in behaviour; they become the adapter's implementation rather than the app's API | 1 |
| `packages/app/src/profile.ts`, `ui/saves.ts` | Take a `LedgerStore` instead of a `StorageLike` | 1 |
| `tools/src/backtest/playtest.ts` | `missionRosterOut`, the per-chain `roster total` lines, `ROSTER_MAX`, and the cap cross-check | 2 |
| `packages/app/src/roster-cap.ts` (+test) | `ROSTER_CAP` and its derivation (2); `splitRoster` and the eviction order (4) | 2, 4 |
| `packages/app/src/roster-slots.ts` (+test) | `reattachSlots`, `issueSlots` — the durable slot and how it survives `checkEnd` | 3 |
| `tools/src/roster-carry.test.ts` | The cross-package pin: a slot survives into a live mission and is readable through `rosterEntryOf` | 3 |
| `packages/app/src/roster-lost.ts` (+test) | `captureLost`, `appendLost`, `fillVacancies`, `predecessorOf` | 5 |
| `packages/app/src/main.ts` — the `missionEnd` seam (3496-3554) and the tick loop (3486) | The one wiring site; R-13's pipeline | 1, 3, 4, 5 |
| `packages/app/src/ui/brigade.ts`, `campaign.ts` | The brigade sentence and the cap-aware campaign line | 6 |
| `packages/app/src/ui/debrief.ts` | The named memorial list and the "replaced" row | 7 |
| `packages/app/src/ui/hud.ts` | The unit card's "replaces …" line under `rl-card__record` | 8 |
| `packages/app/src/i18n/en.json` | `garage.brigade*`, `debrief.row.*`, `hud.card.replaces` | 6, 7, 8 |

---

### Task 1: One door to the save — the `LedgerStore` adapter

**Agent: `claude`, at opus.** The boundary WP-ST6 (#205) inherits, and the only place in the app that is allowed to know the campaign is a string in `localStorage`. Read R-1, R-7 and R-9 in full before starting.

Three single-purpose modules already exist and are already clean — `main-keys.ts` (`loadLedger`/`saveLedger`), `brigade-account.ts` (`loadAccount`/`saveAccount`) and `profile.ts` (save slots, built on both). What does not exist is **one object a caller holds**, and the consequence is that thirteen call sites in `main.ts` each pass a `Storage | null` around and each re-decide what a blocked store means. This task gives them one, keeps every existing function as its implementation, and moves `safeStorage()`'s guard inside it.

**It also gives the app its own ledger type.** `LedgerData` is `@lions/sim`'s and this plan may not add a key to it (R-2), so `CampaignLedger` is declared here — `LedgerData` plus the three optional app-only keys — and the adapter is the one place the `JSON.parse` cast that produces one happens. `RosterEntry` (`LedgerRosterEntry` widened with an optional `slot`) and `LostRecord` are declared here for the same reason: the caster cannot cast to a type it does not know. Tasks 3–5 fill them with meaning; this task only names them.

`RosterEntry`'s `slot` is **optional**, which is what makes the widening free: `Readonly<LedgerRosterEntry>` is assignable to `Readonly<RosterEntry>`, so `hud.ts`'s `rosterEntryOf` dep (`:175`) can widen in Task 8 with no cast and `main.ts:2439` is unchanged.

**Files:**
- Create: `packages/app/src/ledger-store.ts`
- Create: `packages/app/src/ledger-store.test.ts`
- Modify: `packages/app/src/main.ts` (the 13 persistence call sites: `:533`, `:835`, `:904`, `:957`, `:976`, `:985`, `:996`, `:1003`, `:1011`, `:1287`, `:3528`, `:3540-3541`, `:3736`), `packages/app/src/profile.ts`, `packages/app/src/ui/saves.ts`
- Test: `packages/app/src/profile.test.ts` (extend — its existing store fakes become `memoryLedgerStore`)

**Interfaces:**
- Produces (Tasks 3, 4, 5, 6, 7 and 8 consume these exact names):
  - `interface RosterEntry extends LedgerRosterEntry { slot?: number }`
  - `interface LostRecord { slot: number; name?: string; type: string; veterancy: number; missions: number; kills: number; missionId: string; tick: number }`
  - `interface CampaignLedger extends LedgerData { 'roster.surviving_units'?: RosterEntry[]; 'roster.reserve'?: RosterEntry[]; 'roster.lost'?: LostRecord[]; 'campaign.slots_issued'?: number }`
  - `interface LedgerStore { readonly available: boolean; readLedger(): CampaignLedger; writeLedger(l: CampaignLedger): void; readAccount(): BrigadeAccount; writeAccount(a: BrigadeAccount): void; tutorialDone(): boolean; setTutorialDone(done: boolean): void; readSlotsRaw(): string | null; writeSlotsRaw(json: string): void }`
  - `function browserLedgerStore(): LedgerStore` — calls `safeStorage()` itself; `available` is false when the property access throws
  - `function memoryLedgerStore(seed?: Partial<Record<string, string>>): LedgerStore` — the test double, and the only one the specs use
- Consumed unchanged: `loadLedger`/`saveLedger` (`main-keys.ts`), `loadAccount`/`saveAccount`/`migrateAccount`/`emptyAccount` (`brigade-account.ts`), `LEDGER_KEY`, `TUTORIAL_DONE_KEY`, `SAVES_KEY`.

**Not in the adapter, by R-9:** `lions.settings` and `lions.renderer`. Say so in the module header, with the reason, so the next reader does not "finish the job".

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/src/ledger-store.test.ts
import { describe, expect, it } from 'vitest';
import { browserLedgerStore, memoryLedgerStore, type CampaignLedger } from './ledger-store';
import { ACCOUNT_KEY } from './brigade-account';
import { LEDGER_KEY, TUTORIAL_DONE_KEY } from './main-keys';
import { SAVES_KEY } from './profile';

/** A save written by the build BEFORE this package: a named, cumulative roster,
 *  no `slot` anywhere, no `roster.reserve`, no `roster.lost`, no
 *  `campaign.slots_issued`. Verbatim, not built by a helper -- R-7's whole point
 *  is that the bytes a shipped build wrote still load. */
const PRE_CHANGE_LEDGER = JSON.stringify({
  'roster.surviving_units': [
    { type: 'inf_squad', veterancy: 2, name: 'Barkai', missions: 4, kills: 11 },
    { type: 'mbt_lavi', veterancy: 1, name: '1-2 Ayil', missions: 2, kills: 3 },
  ],
  'campaign.names_issued': { squad: 1, vehicle: 1, task: 0 },
  'campaign.completed_missions': ['beit_sahwan_breach', 'beit_sahwan_1_recon'],
  'roe.mission_ratings': { beit_sahwan_breach: 97 },
});

describe('LedgerStore — one method, one spec', () => {
  it('readLedger parses the stored ledger; writeLedger puts it back under LEDGER_KEY', () => {
    const store = memoryLedgerStore({ [LEDGER_KEY]: PRE_CHANGE_LEDGER });
    const led = store.readLedger();
    expect(led['roster.surviving_units']).toHaveLength(2);
    store.writeLedger({ ...led, 'campaign.slots_issued': 7 });
    expect(JSON.parse(store.raw(LEDGER_KEY)!)['campaign.slots_issued']).toBe(7);
  });

  it('readLedger answers {} for absent, unparseable and blocked storage', () => {
    expect(memoryLedgerStore().readLedger()).toEqual({});
    expect(memoryLedgerStore({ [LEDGER_KEY]: '{oh no' }).readLedger()).toEqual({});
    expect(memoryLedgerStore.blocked().readLedger()).toEqual({});
  });

  // The three new keys are the reason this module exists (R-1): they are app-only,
  // `@lions/sim`'s LedgerData does not declare them, and this is the one cast.
  it('carries the three app-only keys through a round trip untouched', () => {
    const store = memoryLedgerStore();
    const led: CampaignLedger = {
      'roster.surviving_units': [{ type: 'inf_squad', veterancy: 0, slot: 3 }],
      'roster.reserve': [{ type: 'mortar_team', veterancy: 1, slot: 9 }],
      'roster.lost': [
        { slot: 3, name: 'Barkai', type: 'inf_squad', veterancy: 2, missions: 4, kills: 11, missionId: 'beit_sahwan_2_foothold', tick: 3200 },
      ],
      'campaign.slots_issued': 12,
    };
    store.writeLedger(led);
    expect(store.readLedger()).toEqual(led);
  });

  it('readAccount migrates; writeAccount puts it back under ACCOUNT_KEY', () => {
    const store = memoryLedgerStore();
    expect(store.readAccount().balance).toBe(0);
    store.writeAccount({ ...store.readAccount(), balance: 450 });
    expect(JSON.parse(store.raw(ACCOUNT_KEY)!).balance).toBe(450);
    expect(memoryLedgerStore({ [ACCOUNT_KEY]: 'not json' }).readAccount().balance).toBe(0);
  });

  it('tutorialDone/setTutorialDone are one pair, and false removes the key', () => {
    const store = memoryLedgerStore();
    expect(store.tutorialDone()).toBe(false);
    store.setTutorialDone(true);
    expect(store.raw(TUTORIAL_DONE_KEY)).toBe('1');
    expect(store.tutorialDone()).toBe(true);
    store.setTutorialDone(false);
    expect(store.raw(TUTORIAL_DONE_KEY)).toBe(null);
  });

  // Slots move BYTES, not meaning: `profile.ts` keeps its own parse and its own
  // `importSlot` validation, because a damaged slot must still be skippable
  // without the adapter knowing what a slot is.
  it('readSlotsRaw/writeSlotsRaw pass the SAVES_KEY string through unparsed', () => {
    const store = memoryLedgerStore();
    expect(store.readSlotsRaw()).toBe(null);
    store.writeSlotsRaw('{"a":{"broken":true}}');
    expect(store.readSlotsRaw()).toBe('{"a":{"broken":true}}');
  });

  // The whole point of `available`: a blocked store is a quiet no-op everywhere,
  // never a throw and never a half-written campaign. `main.ts`'s `safeStorage()`
  // guard moves in here and stops being re-decided at thirteen call sites.
  it('a blocked store reports unavailable, reads empty and swallows every write', () => {
    const store = memoryLedgerStore.blocked();
    expect(store.available).toBe(false);
    expect(() => {
      store.writeLedger({ 'campaign.slots_issued': 1 });
      store.writeAccount({ ...memoryLedgerStore().readAccount(), balance: 9 });
      store.setTutorialDone(true);
      store.writeSlotsRaw('{}');
    }).not.toThrow();
    expect(store.readLedger()).toEqual({});
    expect(store.tutorialDone()).toBe(false);
    expect(store.readSlotsRaw()).toBe(null);
  });

  // jsdom's `window.localStorage` in THIS vitest config is a bare `{}` -- no
  // getItem, no setItem, no length (CLAUDE.md). `browserLedgerStore` must survive
  // that, not merely a property access that throws.
  it('browserLedgerStore survives a storage object with no methods', () => {
    expect(() => browserLedgerStore().readLedger()).not.toThrow();
  });
});
```

`memoryLedgerStore` exposes one extra method beyond the interface, `raw(key)`, for these specs alone; `memoryLedgerStore.blocked()` is the unavailable variant. Both are named in the module header as test-only surface. `pnpm vitest run packages/app/src/ledger-store.test.ts` — every case must fail before the implementation.

- [ ] **Step 2: Implement, then move every caller**

`ledger-store.ts` wraps, never reimplements: `readLedger` is `loadLedger(this.store) as CampaignLedger`, `writeLedger` is `saveLedger`, `readAccount` is `loadAccount(this.store) ?? emptyAccount()` guarded on `available`, and so on. The header says what this module is for — one door, ST6 replaces the implementation, G7 #199 — and what it deliberately excludes (R-9).

Then move the callers, and **change nothing else while doing it**:

- `main.ts`: `const store = browserLedgerStore()` once, beside where `safeStorage()` is called today. `accountState()` (`:525-545`) becomes `store.available ? store.readAccount() : null`-shaped; `loadLedger(safeStorage())` at `:835`, `:904`, `:957`, `:1287` becomes `store.readLedger()`; the brigade screen's `credits`/`onBuy`/`onBuyUpgrade`/`onReset` (`:976-1013`) gate on `store.available` instead of on a truthy `storage`; `saveLedger(storage, updatedLedger)` at `:3528` becomes `store.writeLedger(updatedLedger)`; `markTutorialDone(safeStorage())` at `:3736` becomes `store.setTutorialDone(true)`. `safeStorage()` itself moves into `ledger-store.ts` and is deleted from `main.ts`.
- `profile.ts`: every function takes `LedgerStore` in place of `StorageLike`. `readActive`/`writeActive` call the adapter's four methods; `readAll`/`writeAll` call `readSlotsRaw`/`writeSlotsRaw`. **`writeActive`'s ledger-then-account-then-flag order and its I2 throw-rather-than-swallow contract are preserved verbatim, comment included** — a blocked store is now `available: false` and writes nothing at all, which is a *different* case from a quota refusal partway down and must not be conflated with it. Say that in the comment.
- `ui/saves.ts`: `deps.store` changes type. Its `role="status"` error routing is unchanged.

**Do not add a method the adapter does not need.** `readRoster`/`writeRoster` convenience wrappers were considered and refused: the roster is read and written as part of one ledger object at one seam, and a second path to it is a second place for the cap to be forgotten.

- [ ] **Step 3: Gates, capture, falsify, commit**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm validate:data && pnpm validate:ui && pnpm playtest
/usr/bin/git -C <worktree> diff --stat a567b892..HEAD -- packages/sim     # must be empty
grep -rn "localStorage" packages/app/src --include="*.ts" | grep -v "test.ts"
```

That last grep is the acceptance, not decoration: after this task the only hits outside `ledger-store.ts` must be `renderer-choice.ts`, `ui/menu.ts` and `main.ts`'s two renderer lines (R-9), plus comments. Paste the grep's output into the task report.

`pnpm playtest` must read **identically** to the baseline — same three gate lines, same `credit ladder: 5849`, same 23 controls at DEFEAT, `max tier: 26 of 26`. The harness does not go near `packages/app`; if anything moved, something else did.

**Falsify, two named:**
1. Make `writeLedger` a no-op on an *available* store. The round-trip spec and the app-only-keys spec both go red; quote the lines. Without them the adapter could silently drop every save and every screen would still render. Restore.
2. Delete the `available: false` guard from `writeAccount` so it throws on a blocked store. The blocked-store spec goes red at `not.toThrow()`. That is the exact failure `safeStorage()` existed to prevent, now asserted in one place instead of re-decided in thirteen. Restore.

```bash
/usr/bin/git -C <worktree> add packages/app/src/ledger-store.ts packages/app/src/ledger-store.test.ts packages/app/src/main.ts packages/app/src/profile.ts packages/app/src/profile.test.ts packages/app/src/ui/saves.ts
/usr/bin/git -C <worktree> commit -s -- <the same paths>
```

Message:

```
refactor(app): one door to the save -- the LedgerStore adapter

The campaign ledger, the brigade account and the save slots go through one
object now, with today's localStorage behind it and safeStorage()'s null guard
inside it rather than re-decided at thirteen call sites in main.ts. Nothing
changes on disk: every key, every payload and writeActive's ledger-then-account
order are byte-identical, and the three existing reader/writer pairs became the
implementation rather than being rewritten.

It also gives the app its own CampaignLedger. E2 and E4 add three ledger keys
and @lions/sim's LedgerData may not learn about any of them, so the one
JSON.parse cast and the type it casts to live here. lions.settings and
lions.renderer stay out on purpose: they are facts about the person and the
device, and ST6 (#205, gate G7) moves the campaign, not somebody's ui-scale.

Seen red: writeLedger made a no-op on an available store, and the blocked-store
guard removed from writeAccount.
```

---

### Task 2: Measure the ladder, then name the number

**Agent: `playtest`, at sonnet.** Read R-3 and R-10 before starting. The harness is the instrument and it is also the pin.

`playtest.ts` already prints `roster out N` per run (`:263`) and already has the recorder idiom this needs: `missionStars`/`missionCredits`/`missionRoe` are three `Map<string, number>` populated inside one `if (expect === 'victory' && label === id)` block (`:276-283`) so that no control and no probe can contribute. A fourth map beside them costs three lines and gives a per-chain maximum with no new ledger plumbing at all.

**What it prints, and what it refuses to print.** One `roster total: <town> max N over M missions` line per town chain, then one `roster maximum: N at <missionId>` line over all of them, then `roster cap: 150 (max N, margin X)`. It does **not** print a campaign-wide total, because the harness's chained ledgers do not reach one (R-10) and a number labelled as something it is not is worse than no number. The `roster maximum` line carries a `ROSTER_MAX` pin in the `LADDER_CREDITS` idiom: a `!==` check, a `console.error`, `process.exitCode = 1`, and a comment block above it saying what moved it last.

**Files:**
- Create: `packages/app/src/roster-cap.ts`
- Create: `packages/app/src/roster-cap.test.ts`
- Modify: `tools/src/backtest/playtest.ts` (the recorder block at 276-283; a new section beside the `missionOrder` walk at 2556-2575; the pins beside `LADDER_CREDITS` at 2859)

**Interfaces:**
- Produces: `export const ROSTER_CAP = 150` from `packages/app/src/roster-cap.ts` — the single public source of the number, imported by the harness (Task 2), the split (Task 4), the brigade sentence (Task 6) and `deployRosterView` when it exists (R-12).
- Produces: `roster total:` / `roster maximum:` / `roster cap:` lines on `pnpm playtest`, and a red run when the measured maximum reaches the cap.
- Consumed unchanged: `missionOrder`'s construction from `world.regions.flatMap(towns)`; the `label === id` recorder guard.

`tools` importing a pure module out of `packages/app` is the established pattern, not a new one: `tools/src/meshes/gait-pass.ts:201` imports `RIGGED_UNIT_MESHES` from `packages/app/src/mesh-catalogue` and runs under `tsx`. `roster-cap.ts` must stay equally pure — no DOM, no `t()`, no import from anything that touches `window`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/src/roster-cap.test.ts
import { describe, expect, it } from 'vitest';
import { ROSTER_CAP } from './roster-cap';

describe('ROSTER_CAP', () => {
  // The page's rule: "the cap should sit above what a ★★★ campaign accumulates,
  // not below it." The largest roster any threaded chain in `pnpm playtest`
  // produces is 30 (umm_zeitoun_4_clearance, 2026-09-20); the loose
  // sum-of-chain-maxima ceiling, which assumes zero cross-chain draw-down and is
  // therefore an over-estimate, is 126. The harness re-checks the first of those
  // on every push; this pins the DECISION so a silent edit to the constant is a
  // red test rather than a shipped design change.
  it('is 150 -- above the measured 30 and above the loose 126 ceiling', () => {
    expect(ROSTER_CAP).toBe(150);
    expect(ROSTER_CAP).toBeGreaterThan(126);
  });
});
```

And in the harness, the pin itself, which is the check that can actually fail on new content:

```ts
// tools/src/backtest/playtest.ts -- beside LADDER_CREDITS
/** The largest `roster out` any winning plan produces, over every town chain.
 *  Measured 2026-09-20 at a567b892: 30, at `umm_zeitoun_4_clearance`. Per chain:
 *  Beit Sahwan 25 / Wadi Halam 14 / Khan Rafid 11 / Deir Amun 12 / Tel Marum 10 /
 *  Qarn Hadid 24 / Umm Zeitoun 30.
 *
 *  This is NOT a campaign-wide total and must not be read as one: the harness's
 *  chained ledgers do not thread one ledger through all 26 missions (see
 *  `missionStars`' own comment above), so no run here ever accumulates a whole
 *  campaign's roster. It is the largest SINGLE CHAIN, which is the most the
 *  instrument honestly knows. */
const ROSTER_MAX = 30;
```

Run `pnpm playtest` and confirm both new assertions exist and that the printed `roster maximum:` reads 30. **Then make each fail on purpose before implementing further** — see Step 3.

- [ ] **Step 2: Implement**

`roster-cap.ts` carries `ROSTER_CAP` and nothing else yet (Task 4 adds `splitRoster` to the same file). Its doc comment carries the derivation — the measured 30, the loose 126, both margins, the date and the commit — because a constant whose reasoning lives only in a plan is a constant nobody will dare move.

In `playtest.ts`:

```ts
/** This mission's own produced roster length, for the per-chain totals below.
 *  Same `label === id` + `expect === 'victory'` guard as `missionStars`, so a
 *  control's defeat (which writes nothing to a real ledger anyway) and a
 *  gate-open or max-tier probe can never contribute. */
const missionRosterOut = new Map<string, number>();
```

populated in the existing recorder block, then a walk beside `missionOrder`'s that prints one line per town and one maximum, and the cap cross-check:

```ts
console.log(`roster cap: ${ROSTER_CAP} (max ${rosterMax}, margin ${(ROSTER_CAP / rosterMax).toFixed(1)}x)`);
if (rosterMax >= ROSTER_CAP) {
  console.error(`roster cap: FAILED — the measured maximum ${rosterMax} has reached the cap ${ROSTER_CAP}`);
  process.exitCode = 1;
}
```

**Record the two facts that make this measurement honest in the same comment block**: a defeat writes nothing to the real ledger (`main.ts` gates the whole write on `me.result === 'victory'`), so a control's `roster out` is never a campaign's roster; and the harness reads `produced` straight out of `missionEnd` **before** any app-side post-processing (`playtest.ts:256`), so nothing in Tasks 3–8 can move these numbers.

- [ ] **Step 3: Gates, capture, falsify, commit**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm validate:data && pnpm validate:ui && pnpm playtest
/usr/bin/git -C <worktree> diff --stat a567b892..HEAD -- packages/sim     # must be empty
```

Paste into the task report: the seven `roster total:` lines, the `roster maximum:` line, the `roster cap:` line, and the unchanged `gate` / `credit ladder` / `max tier` lines.

**Falsify, three named, each seen red:**
1. Set `ROSTER_CAP` to 25 — below the measured 30. `pnpm playtest` goes red at `roster cap: FAILED — the measured maximum 30 has reached the cap 25`, and `roster-cap.test.ts` goes red on both assertions. Restore.
2. Set `ROSTER_MAX` to 29. `pnpm playtest` goes red at the `roster maximum:` pin. Restore. **This is the re-pin mechanism**: when content moves the ladder, this is the line that says so.
3. Delete the `roster maximum:` pin's `process.exitCode = 1` and re-run. The line still prints, the run stays green, and the ladder can move by any amount unnoticed — which is the silence this pin exists to break. Restore.

```bash
/usr/bin/git -C <worktree> add packages/app/src/roster-cap.ts packages/app/src/roster-cap.test.ts tools/src/backtest/playtest.ts
/usr/bin/git -C <worktree> commit -s -- <the same paths>
```

Message:

```
feat(campaign): measure the roster ladder, then name the cap

G0 #12 answered "measure a ★★★ ladder first; cap above it". The harness prints
what it honestly knows now: one `roster total` line per town chain and the
maximum over all of them, recorded through the same label === id guard the star
and credit ladders already use, so no control and no probe can contribute.
Measured at a567b892: 25 / 14 / 11 / 12 / 10 / 24 / 30, maximum 30 at
umm_zeitoun_4_clearance.

Deliberately NOT a campaign-wide total. The chained ledgers do not thread one
ledger through all 26 missions -- missionStars' own comment records that being
tried and abandoned -- so a 26-mission figure would be fabricated. The cap is
set above a loose sum-of-chains ceiling instead: 150, 5.0x the measured 30 and
1.19x the 126 that assumes zero cross-chain draw-down. It is meant not to bind
in normal play; it is a rail against unbounded growth, which is what the page
asked for.

Seen red: cap at 25, ROSTER_MAX at 29, and the maximum pin's exit code removed.
```

---

### Task 3: A slot is a place, not a body — the durable identity and how it survives the sim

**Agent: `claude`, at opus.** The model task, and the one whose failure mode is a save file the player cannot account for. Read R-2, R-6 and R-13 in full before starting; the choice between a `checkEnd` change and an app-side rule is **already made** and this task must not re-open it.

A unit's place in the brigade gets a number. It is issued once, from a monotone counter on the ledger, and it outlives the unit that holds it — that is the whole of "a replacement remembers whose place it took" (R-6), and Task 5 is what hands a vacant slot on.

**The problem this task solves is entirely the sim's rebuild.** `checkEnd` writes a fielded survivor's entry as a field-by-field literal (`mission.ts:1874-1883`) and copies exactly one thing beyond type/veterancy/missions/kills: `name`. So a `slot` put on an entry **survives being left in the pool** (`{ ...left }`, `:1887`) and **survives into a live mission** (`entityRoster` holds the app's own object, `:1304`) but is **dropped the moment its owner is fielded and comes home**. The app must put it back, and R-2's rule is how.

**Files:**
- Create: `packages/app/src/roster-slots.ts`
- Create: `packages/app/src/roster-slots.test.ts`
- Create: `tools/src/roster-carry.test.ts`
- Modify: `packages/app/src/main.ts` (R-13 steps 3 and 6, around the `assignNames` call at `:3524`)

**Interfaces:**
- Produces (Tasks 4, 5, 7 and 8 consume these exact names):
  - `function reattachSlots(out: readonly RosterEntry[], before: readonly RosterEntry[]): RosterEntry[]` — pure; R-2's rule, and nothing else
  - `function issueSlots(roster: readonly RosterEntry[], issued: number): { roster: RosterEntry[]; issued: number }` — the `assignNames` shape exactly, one counter, never decremented
  - `const SLOTS_ISSUED_KEY = 'campaign.slots_issued'`
- Consumes: `RosterEntry`, `CampaignLedger` (Task 1); `assignNames` (`names.ts`), unchanged and called after both.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/src/roster-slots.test.ts
import { describe, expect, it } from 'vitest';
import { issueSlots, reattachSlots } from './roster-slots';
import type { RosterEntry } from './ledger-store';

const e = (o: Partial<RosterEntry> & { type: string }): RosterEntry =>
  ({ veterancy: 0, missions: 1, kills: 0, ...o });

describe('reattachSlots — R-2\'s rule', () => {
  // `checkEnd` pushes an unfielded pool entry with `{ ...left }` (mission.ts:1887),
  // a FULL spread, so its slot is still on it. Nothing to reattach.
  it('leaves an unfielded pass-through alone', () => {
    const before = [e({ type: 'mortar_team', name: 'Nachshon', slot: 4 })];
    const out = [e({ type: 'mortar_team', name: 'Nachshon', slot: 4 })];
    expect(reattachSlots(out, before)).toEqual(out);
  });

  // The whole reason this function exists: a FIELDED survivor is rebuilt field by
  // field (mission.ts:1874-1883) and only `name` comes through, so the slot is
  // gone and the name is the only thing left to find it by.
  it('gives a fielded survivor its slot back, by name', () => {
    const before = [e({ type: 'inf_squad', name: 'Barkai', slot: 7, veterancy: 1, missions: 3 })];
    const out = [e({ type: 'inf_squad', name: 'Barkai', veterancy: 2, missions: 4, kills: 5 })];
    const got = reattachSlots(out, before);
    expect(got[0].slot).toBe(7);
    // ...and nothing else moves: the sim's own numbers win, not the ones sent in.
    expect(got[0]).toEqual({ type: 'inf_squad', name: 'Barkai', veterancy: 2, missions: 4, kills: 5, slot: 7 });
  });

  it('leaves a new body slotless for issueSlots to number', () => {
    const before = [e({ type: 'inf_squad', name: 'Barkai', slot: 7 })];
    const out = [e({ type: 'inf_squad', name: 'Barkai' }), e({ type: 'recon_drone' })];
    expect(reattachSlots(out, before)[1].slot).toBeUndefined();
  });

  // The hole R-2 names rather than papers over. Unreachable once slot and name
  // are issued together, and constructed here to prove the fallback neither
  // throws nor hands out somebody else's number.
  it('treats a slotted-but-nameless predecessor as unmatchable, not as a collision', () => {
    const before = [e({ type: 'inf_squad', slot: 7 })];
    const out = [e({ type: 'inf_squad' })];
    expect(reattachSlots(out, before)[0].slot).toBeUndefined();
  });

  it('never gives two out entries the same slot', () => {
    const before = [e({ type: 'inf_squad', name: 'Barkai', slot: 7 }), e({ type: 'inf_squad', name: 'Dekel', slot: 8 })];
    const out = [e({ type: 'inf_squad', name: 'Barkai' }), e({ type: 'inf_squad', name: 'Dekel' }), e({ type: 'inf_squad' })];
    const slots = reattachSlots(out, before).map((r) => r.slot);
    expect(slots).toEqual([7, 8, undefined]);
  });

  it('is length-preserving and deletes nothing', () => {
    const before = [e({ type: 'inf_squad', name: 'Barkai', slot: 7 })];
    const out = [e({ type: 'inf_squad' }), e({ type: 'mbt_lavi' }), e({ type: 'recon_drone' })];
    expect(reattachSlots(out, before)).toHaveLength(3);
  });
});

describe('issueSlots — a counter, never a reuse', () => {
  it('numbers only what is slotless and advances the counter by that many', () => {
    const got = issueSlots([e({ type: 'inf_squad', slot: 2 }), e({ type: 'mbt_lavi' }), e({ type: 'recon_drone' })], 5);
    expect(got.roster.map((r) => r.slot)).toEqual([2, 5, 6]);
    expect(got.issued).toBe(7);
  });

  it('is a no-op when everything already has a slot', () => {
    const got = issueSlots([e({ type: 'inf_squad', slot: 0 })], 9);
    expect(got.roster[0].slot).toBe(0);
    expect(got.issued).toBe(9);
  });

  // R-7: a save written before this package has no slots anywhere and no counter.
  // The first write after upgrade numbers everything, and no two agree.
  it('numbers a whole pre-change roster on the first pass, with no collisions', () => {
    const pre = [e({ type: 'inf_squad', name: 'Barkai' }), e({ type: 'mbt_lavi', name: '1-2 Ayil' }), e({ type: 'mortar_team', name: 'Nachshon' })];
    const got = issueSlots(pre, 0);
    expect(new Set(got.roster.map((r) => r.slot)).size).toBe(3);
    expect(got.issued).toBe(3);
  });

  // The counter is the chronology R-4's eviction order sorts by, so a reused id
  // would make "newest falls first" answer differently on two identical saves.
  it('never reuses an id across successive passes', () => {
    const first = issueSlots([e({ type: 'inf_squad' })], 0);
    const second = issueSlots([e({ type: 'mbt_lavi' })], first.issued);
    expect(second.roster[0].slot).not.toBe(first.roster[0].slot);
  });
});
```

And the cross-package pin, which is the one that proves R-2's premise rather than assuming it:

```ts
// tools/src/roster-carry.test.ts
//
// The sim half of the slot's round trip, measured rather than argued. Two facts
// this package rests on and neither is visible from `packages/app`:
//
//   1. `slot` reaches a live mission -- `entityRoster.set(id, origin)`
//      (mission.ts:1304) stores the APP'S OWN object and `rosterEntryOf` hands it
//      back, so the HUD card (Task 8) can read a field @lions/sim has never heard
//      of. If that ever stops being true the card silently shows nothing.
//   2. `checkEnd` DROPS it for a fielded survivor and KEEPS it for an unfielded
//      pool entry. That asymmetry is the entire reason `reattachSlots` exists;
//      if a future sim change spreads `origin` instead, this test goes red and
//      the app-side rule can be deleted rather than left running for nothing.
//
// Lives under tools/ and not packages/sim/ because this plan does not open that
// package, tests included. `first_light_fence.test.ts`'s `passiveResult()` is the
// sim-construction idiom followed here.
import { describe, expect, it } from 'vitest';
import { applyTerrain, maps, missions, parseMap, structures as structureCatalogue, units } from '@lions/data';
import { MissionRuntime, Sim, type MissionJson } from '@lions/sim';
import type { RosterEntry } from '../../packages/app/src/ledger-store';

describe('a slot survives the sim it was never declared to', () => {
  it('is readable through rosterEntryOf on a fielded unit, and dropped by checkEnd', () => {
    // Build the mission with a one-entry slotted roster, step until it ends, and
    // read both halves: the live entry during the run, the produced entry after.
    // Assert `rosterEntryOf(id).slot === 42` while alive, and that the produced
    // roster's fielded survivor has NO slot -- the drop this package repairs.
  });

  it('keeps a slot on an entry the mission never fields', () => {
    // Same runtime, a second entry of a type no `from_ledger` placement draws.
    // It comes back through `{ ...left }` with slot 43 intact.
  });
});
```

Fill both bodies against a real mission and a real `Sim` following `first_light_fence.test.ts:457-481`; the assertions above are the contract and must not be weakened to fit the harness. `pnpm vitest run packages/app/src/roster-slots.test.ts tools/src/roster-carry.test.ts` — every case must fail (or, for the round trip, be unwritten) before Step 2.

- [ ] **Step 2: Implement**

`roster-slots.ts` holds the two functions and a header that carries R-2's rule in full, with the three facts that make it total — names unique for the life of a save (`names.ts:32-50`, injective on a monotone per-kind counter), the fielded and unfielded sets disjoint (`spawnPlacement` splices), and `assignNames` running over the whole roster with a full spread. **Name the refused alternative in the header too** (`entry.slot = origin?.slot` in `checkEnd`), so the next reader knows the one-line version was weighed and why it lost, and knows exactly which function to delete if the decision is ever reversed.

Wire R-13's steps 3 and 6 into `main.ts`'s victory branch, with nothing between them yet:

```ts
const before = (ledger as CampaignLedger)['roster.surviving_units'] ?? [];
const rosterIn = updatedLedger['roster.surviving_units'];
if (Array.isArray(rosterIn)) {
  // R-13's pipeline. `slot` first and `name` after, because identity is what a
  // unit IS and the callsign is what it is CALLED -- and because reattachment
  // matches on the callsign set the PREVIOUS save wrote, which assignNames is
  // about to extend.
  const carried = issueSlots(reattachSlots(rosterIn, before), updatedLedger['campaign.slots_issued'] ?? 0);
  updatedLedger['campaign.slots_issued'] = carried.issued;
  const named = assignNames(carried.roster, issuedIn, …);   // unchanged
  …
}
```

- [ ] **Step 3: Gates, capture, falsify, commit**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm validate:data && pnpm validate:ui && pnpm playtest
/usr/bin/git -C <worktree> diff --stat a567b892..HEAD -- packages/sim     # must be empty
```

`pnpm playtest` unchanged from Task 2's output: the harness never runs `main.ts`'s seam, so a moved line here means something else moved.

**Falsify, three named, each seen red:**
1. Make `reattachSlots` match on `type` instead of `name`. The "never gives two out entries the same slot" spec goes red — two `inf_squad` survivors both take slot 7, which is a save with two units in one place in the order of battle and is the exact corruption this function exists to prevent. Restore.
2. Make `issueSlots` restart its counter at 0 on every call. The "never reuses an id across successive passes" spec goes red. Restore, and note in the report that nothing downstream would have caught it — R-4's eviction order would simply have answered differently on two identical saves.
3. Delete the second assertion from the round-trip test (the one that `checkEnd` drops the slot for a fielded survivor). Both tests still pass and the file no longer says why `reattachSlots` exists — the shape R-10 calls a check that stopped being able to fail. Restore.

```bash
/usr/bin/git -C <worktree> add packages/app/src/roster-slots.ts packages/app/src/roster-slots.test.ts tools/src/roster-carry.test.ts packages/app/src/main.ts
/usr/bin/git -C <worktree> commit -s -- <the same paths>
```

Message:

```
feat(campaign): a slot is a place in the brigade, and it outlives the unit

A durable id on every roster entry, issued once from campaign.slots_issued the
way campaign.names_issued already issues callsigns. It is what E2's eviction
order sorts by and what E4's replacement inherits, which is why both work
packages are one plan.

@lions/sim is not opened. Measured rather than assumed: checkEnd rebuilds a
FIELDED survivor's entry field by field and copies only `name`, while an
unfielded pool entry comes back through a full spread with everything intact,
and entityRoster hands the app's own object back to the HUD mid-mission. So a
slot survives two of the three paths by itself and the third needs a rule:
slot and name are issued together, so a survivor with a name and no slot is the
entry that had that name. Both halves of that asymmetry are pinned in
tools/src/roster-carry.test.ts against a real Sim, so a future sim change that
spreads `origin` turns this rule into deletable code instead of dead code.

Seen red: reattach matched on type, the counter restarted at zero, and the
round-trip test's drop assertion deleted.
```

---

### Task 4: The cap, the reserve and the one-time backfill

**Agent: `claude`, at sonnet.** Read R-4 and R-7 before starting. The number was chosen in Task 2 and the order is R-4's; this task is the function that applies them and the migration that lets an existing save through.

`splitRoster` takes the whole brigade — active plus whatever is already stood down — sorts it by one total order, and returns the first `cap` as active and the tail as reserve. It is **recomputed from the whole population on every write**, which is what lets a stood-down unit come back when the active list falls below the cap through losses, and what makes the function stateless enough to be its own spec.

**Why the reserve is a second array and not a flag.** `MissionRuntime` seeds `rosterPool` from `ctx.ledger['roster.surviving_units']` and nothing else (`mission.ts:550`), so an entry in `roster.reserve` is undrawable by construction. A `reserved: true` flag inside the one array would need the app to strip flagged entries before handing the ledger to the runtime and put them back after `checkEnd` returned, and every other reader — `broughtFor`, `campaignSummary`, `deployRosterView` — would have to agree to skip them. Three places to forget instead of none.

**The migration is on WRITE, never on load.** `readLedger` returns an old save untouched; the split runs in the `missionEnd` pipeline and only there. An existing roster larger than the cap is therefore split the first time the player finishes a mission, visibly, with the brigade screen's sentence (Task 6) saying so — never silently shortened by opening the game. Since the cap sits at 150 and the largest measured chain is 30, this should be a no-op for every real save; the spec constructs the case anyway, because "should be" is not a measurement.

**Files:**
- Modify: `packages/app/src/roster-cap.ts` (add `splitRoster`, `rosterOrder`), `packages/app/src/roster-cap.test.ts`
- Modify: `packages/app/src/main.ts` (R-13 step 8)

**Interfaces:**
- Produces (Tasks 5, 6, 7 consume these exact names):
  - `function rosterOrder(a: RosterEntry, b: RosterEntry): number` — the total order, exported for its own spec
  - `function splitRoster(active: readonly RosterEntry[], reserve: readonly RosterEntry[], cap?: number): { active: RosterEntry[]; reserve: RosterEntry[] }` — `cap` defaults to `ROSTER_CAP`
- Consumes: `RosterEntry`, `CampaignLedger` (Task 1); `ROSTER_CAP` (Task 2).

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/src/roster-cap.test.ts — append
import { ROSTER_CAP, rosterOrder, splitRoster } from './roster-cap';
import type { RosterEntry } from './ledger-store';

const e = (slot: number, o: Partial<RosterEntry> = {}): RosterEntry =>
  ({ type: 'inf_squad', veterancy: 0, missions: 1, kills: 0, slot, ...o });
const many = (n: number, from = 0): RosterEntry[] => Array.from({ length: n }, (_, i) => e(from + i));

describe('rosterOrder — veterans stay, newest-in falls first (R-4)', () => {
  it('sorts by veterancy, then missions, then kills, then slot ascending', () => {
    const rookie = e(9);
    const vet = e(1, { veterancy: 2 });
    const served = e(2, { missions: 6 });
    const killer = e(3, { kills: 40 });
    expect([rookie, vet, served, killer].sort(rosterOrder).map((r) => r.slot)).toEqual([1, 2, 3, 9]);
  });

  // The tiebreak is what makes "newest falls first" EXACT rather than a
  // sentiment: two identical rookies differ only by when they joined, and the
  // slot counter is the only chronology the roster carries (array order is not
  // -- checkEnd writes survivors first and the unfielded pool after).
  it('breaks a total tie by slot, oldest first', () => {
    expect([e(12), e(3), e(7)].sort(rosterOrder).map((r) => r.slot)).toEqual([3, 7, 12]);
  });

  it('is a total order: no two distinct entries compare equal', () => {
    const all = [e(1), e(2, { veterancy: 1 }), e(3, { missions: 4 }), e(4, { kills: 2 })];
    for (const a of all) for (const b of all) if (a.slot !== b.slot) expect(rosterOrder(a, b)).not.toBe(0);
  });
});

describe('splitRoster', () => {
  it('leaves a roster under the cap alone and reports an empty reserve', () => {
    const got = splitRoster(many(10), [], ROSTER_CAP);
    expect(got.active).toHaveLength(10);
    expect(got.reserve).toHaveLength(0);
  });

  // The off-by-one, both sides of it. `cap` entries is AT the cap and nothing
  // falls; `cap + 1` puts exactly one down.
  it('keeps exactly cap and stands down exactly the rest', () => {
    expect(splitRoster(many(5), [], 5).reserve).toHaveLength(0);
    expect(splitRoster(many(6), [], 5).active).toHaveLength(5);
    expect(splitRoster(many(6), [], 5).reserve).toHaveLength(1);
    expect(splitRoster(many(11), [], 5).reserve).toHaveLength(6);
  });

  it('stands down the newest and keeps the veterans', () => {
    const got = splitRoster([e(1), e(2), e(3, { veterancy: 3 })], [], 2);
    expect(got.active.map((r) => r.slot)).toEqual([3, 1]);
    expect(got.reserve.map((r) => r.slot)).toEqual([2]);
  });

  // #174's rule, as arithmetic rather than intent: nothing is ever deleted.
  it('is length-preserving over the whole population, always', () => {
    for (const [a, r, cap] of [[30, 0, 150], [200, 0, 150], [100, 100, 150], [0, 9, 150]] as const) {
      const got = splitRoster(many(a), many(r, 1000), cap);
      expect(got.active.length + got.reserve.length).toBe(a + r);
    }
  });

  // R-4: the split reads the WHOLE brigade, so "never deleted" also means "never
  // permanently benched". A veteran standing down while the active list is full
  // comes back the moment losses make room.
  it('recalls from reserve when the active list has fallen below the cap', () => {
    const got = splitRoster([e(1), e(2)], [e(3, { veterancy: 2 })], 3);
    expect(got.active.map((r) => r.slot)).toEqual([3, 1, 2]);
    expect(got.reserve).toHaveLength(0);
  });

  // ...and cannot churn: nothing about a stood-down entry changes while it is
  // stood down, so it can only ever move UP, and only when something above it dies.
  it('is idempotent — splitting its own output changes nothing', () => {
    const once = splitRoster(many(8), [], 5);
    const twice = splitRoster(once.active, once.reserve, 5);
    expect(twice).toEqual(once);
  });

  it('defaults to ROSTER_CAP when no cap is given', () => {
    expect(splitRoster(many(ROSTER_CAP + 3), []).reserve).toHaveLength(3);
  });

  // R-7. The bytes a pre-change build wrote, with slots already issued by Task 3
  // and no `roster.reserve` key at all: an absent reserve reads as empty and the
  // first WRITE is what splits, not the load.
  it('treats an absent reserve as empty and backfills on the first write', () => {
    const ledger: { 'roster.reserve'?: RosterEntry[] } = {};
    const got = splitRoster(many(7), ledger['roster.reserve'] ?? [], 5);
    expect(got.active).toHaveLength(5);
    expect(got.reserve.map((r) => r.slot)).toEqual([5, 6]);
  });
});
```

- [ ] **Step 2: Implement**

`rosterOrder` is four comparisons and a header that says which of them is the design and which is the tiebreak. `splitRoster` concatenates, sorts a copy (never in place — the input arrays are the ledger's and `main.ts` holds them), and slices. **`veterancy ?? 0`, `missions ?? 0`, `kills ?? 0` on every read**: all three are optional on `LedgerRosterEntry` and a pre-change entry can be missing the last two.

In `main.ts`, R-13 step 8, after `assignNames`:

```ts
// The cap (WP-G-E2). Computed over the WHOLE brigade -- active plus whatever is
// already stood down -- on every write, which is what lets a stood-down unit come
// back when losses make room, and what makes the migration for an existing save
// a normal write rather than a special path. Nothing is deleted: the two arrays'
// lengths always sum to what went in.
const split = splitRoster(named.roster, updatedLedger['roster.reserve'] ?? []);
updatedLedger['roster.surviving_units'] = split.active;
updatedLedger['roster.reserve'] = split.reserve;
```

**Do not touch `broughtFor` or `campaignSummary` in this task.** They read `roster.surviving_units`, which is now the active list, and that is the correct answer for both — the deploy panel should count what this mission can draw, and the menu strip should count who is on the books. Task 6 is where the reserve becomes visible.

- [ ] **Step 3: Gates, capture, falsify, commit**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm validate:data && pnpm validate:ui && pnpm playtest
/usr/bin/git -C <worktree> diff --stat a567b892..HEAD -- packages/sim     # must be empty
```

`pnpm playtest` unchanged again, and for a reason worth stating in the report: the harness builds its own ledgers and never runs the seam, so the cap cannot reach it. The `roster cap: 150 (max 30, margin 5.0x)` line from Task 2 is the only place the two numbers meet.

**Falsify, three named, each seen red:**
1. Change the slice to `cap - 1`. The "keeps exactly cap" spec goes red on the first assertion (`splitRoster(many(5), [], 5).reserve` becomes length 1). Restore. This is the off-by-one the research brief asked for by name.
2. Make `splitRoster` return `{ active: sorted.slice(0, cap), reserve: [] }` — the shape a careless implementation reaches for. The length-preserving spec goes red at every one of its four cases, and it is the exact defect #174 forbids: a cap that deletes. Restore.
3. Remove `slot` from `rosterOrder`'s comparisons. The "total order" spec goes red, and the report should say what would have shipped without it: two identical saves splitting differently depending on `Array.prototype.sort`'s stability over whatever order `checkEnd` happened to write. Restore.

```bash
/usr/bin/git -C <worktree> add packages/app/src/roster-cap.ts packages/app/src/roster-cap.test.ts packages/app/src/main.ts
/usr/bin/git -C <worktree> commit -s -- <the same paths>
```

Message:

```
feat(campaign): the roster has a cap, and the overflow stands down

Overflow goes to roster.reserve and is never deleted (#174). The order is
veterancy, then missions, then kills, then slot ascending -- veterans stay and
newest-in falls first, with the slot counter making "newest" exact, since array
order is not a chronology (checkEnd writes survivors first and the unfielded
pool after).

Two properties are asserted rather than intended. The split reads the WHOLE
brigade on every write, so a stood-down unit comes back when losses make room --
"never deleted" does not quietly mean "benched forever" -- and it cannot churn,
because nothing about a stood-down entry changes while it is stood down. And it
is length-preserving over every input, which is the arithmetic form of the
ticket's own rule.

The reserve is a second array and not a flag because MissionRuntime seeds
rosterPool from roster.surviving_units alone (mission.ts:550): a stood-down
entry is undrawable by construction rather than because three readers all
remember to skip it. The migration for an existing save is the ordinary write
path, so opening an old save can never shorten a roster.

Seen red: the slice off by one, the reserve dropped on the floor, and slot
removed from the order.
```

---

### Task 5: Who was lost, and who took their place

**Agent: `claude`, at sonnet.** Read R-6, R-11 and R-13. The capture half is three lines in a loop that already exists; the pairing half is the idea.

**The signal is already in the app's hands and the research brief's recommendation is superseded.** `MissionRuntime.step` emits `{ kind: 'unitLost'; tick; entity; side: 0; unit }` for every player-side death (`mission.ts:1018-1025`), shell Phase 2 shipped it, and `main.ts:3486` already iterates `missionEvents` with `runtime` in scope. So the capture is `runtime.rosterEntryOf(me.entity)` at that exact site — safe after death, because `entityRoster` is only ever added to (`mission.ts:1304`; no `delete`, no `clear` anywhere in the file).

**Only a unit with a slot gets a memorial record** (R-11). A fresh remnant spawned this mission and killed this mission never reached the roster, has no service record and no place in the order of battle, and a memorial for it would be a memorial for nobody. `lostByType()`'s aggregate still counts it, and Task 7 keeps that aggregate as the total beside the named list.

**A vacancy is derived, never flagged** (R-6): a memorial record is unfilled iff no entry in `roster.surviving_units` or `roster.reserve` carries its slot. So a slot accumulates a history — hold, loss, replacement, loss again — and `predecessorOf` answers with the most recent chapter. No second piece of state, and nothing to keep in sync.

**Files:**
- Create: `packages/app/src/roster-lost.ts`
- Create: `packages/app/src/roster-lost.test.ts`
- Modify: `packages/app/src/main.ts` (the `missionEvents` loop at `:3486`; R-13 steps 4 and 5)

**Interfaces:**
- Produces (Tasks 7 and 8 consume these exact names):
  - `function lostRecordFor(entry: Readonly<RosterEntry> | undefined, unit: string, missionId: string, tick: number): LostRecord | null` — null for a unit with no slot
  - `function appendLost(lost: readonly LostRecord[], fresh: readonly LostRecord[]): LostRecord[]` — append-only
  - `function fillVacancies(roster: readonly RosterEntry[], lost: readonly LostRecord[], reserve: readonly RosterEntry[]): RosterEntry[]`
  - `function predecessorOf(lost: readonly LostRecord[], slot: number): LostRecord | undefined`
- Consumes: `RosterEntry`, `LostRecord` (Task 1); `reattachSlots`/`issueSlots` (Task 3) — `fillVacancies` runs strictly between them (R-13).

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/src/roster-lost.test.ts
import { describe, expect, it } from 'vitest';
import { appendLost, fillVacancies, lostRecordFor, predecessorOf } from './roster-lost';
import type { LostRecord, RosterEntry } from './ledger-store';

const e = (o: Partial<RosterEntry> & { type: string }): RosterEntry => ({ veterancy: 0, missions: 1, kills: 0, ...o });
const rec = (slot: number, o: Partial<LostRecord> = {}): LostRecord =>
  ({ slot, type: 'inf_squad', veterancy: 1, missions: 2, kills: 3, missionId: 'beit_sahwan_2_foothold', tick: 100, ...o });

describe('lostRecordFor', () => {
  it('records the whole service record of a unit that had one', () => {
    const entry = e({ type: 'inf_squad', name: 'Barkai', veterancy: 2, missions: 4, kills: 11, slot: 7 });
    expect(lostRecordFor(entry, 'inf_squad', 'beit_sahwan_2_foothold', 3200)).toEqual({
      slot: 7, name: 'Barkai', type: 'inf_squad', veterancy: 2, missions: 4, kills: 11,
      missionId: 'beit_sahwan_2_foothold', tick: 3200,
    });
  });

  // R-11. A fresh remnant spawned and killed inside one mission never reached the
  // roster and has no place to leave vacant. `lostByType()` still counts it, which
  // is why the debrief keeps its aggregate beside the named list.
  it('refuses a unit with no slot, and a unit the sim never drew from the roster', () => {
    expect(lostRecordFor(e({ type: 'inf_squad', name: 'Barkai' }), 'inf_squad', 'm', 1)).toBe(null);
    expect(lostRecordFor(undefined, 'inf_squad', 'm', 1)).toBe(null);
  });
});

describe('appendLost', () => {
  it('appends and never removes, reorders or de-duplicates', () => {
    const before = [rec(1), rec(2)];
    const got = appendLost(before, [rec(3)]);
    expect(got.map((l) => l.slot)).toEqual([1, 2, 3]);
    expect(appendLost(got, [rec(3, { tick: 900 })]).map((l) => l.slot)).toEqual([1, 2, 3, 3]);
  });

  // A slot that is lost twice has two chapters, and both are kept. This is what
  // makes `roster.lost` a record rather than a lookup table.
  it('keeps two records for a slot that has been lost twice', () => {
    const twice = appendLost([rec(7, { name: 'Barkai' })], [rec(7, { name: 'Dekel', tick: 5000 })]);
    expect(twice.filter((l) => l.slot === 7)).toHaveLength(2);
  });
});

describe('fillVacancies — the replacement takes the lost slot (R-6)', () => {
  it('gives a new body of the same type the most recent vacant slot', () => {
    const got = fillVacancies([e({ type: 'inf_squad' })], [rec(7, { name: 'Barkai' })], []);
    expect(got[0].slot).toBe(7);
  });

  it('matches on type: a vacancy of another type is left open', () => {
    const got = fillVacancies([e({ type: 'mbt_lavi' })], [rec(7, { type: 'inf_squad' })], []);
    expect(got[0].slot).toBeUndefined();
  });

  // The brief's own falsification. Two losses of one type, one replacement:
  // exactly one pairing, and the older vacancy stays open for the next body.
  it('pairs one replacement to one vacancy, never two', () => {
    const lost = [rec(7, { name: 'Barkai' }), rec(8, { name: 'Dekel', tick: 900 })];
    const got = fillVacancies([e({ type: 'inf_squad' })], lost, []);
    expect(got.map((r) => r.slot)).toEqual([8]);
  });

  it('fills two vacancies newest-first when two bodies arrive', () => {
    const lost = [rec(7), rec(8, { tick: 900 })];
    const got = fillVacancies([e({ type: 'inf_squad' }), e({ type: 'inf_squad' })], lost, []);
    expect(got.map((r) => r.slot)).toEqual([8, 7]);
  });

  // A vacancy is DERIVED (R-6). A slot still held by a living entry -- in the
  // active list or stood down in reserve -- is not vacant, so a replacement can
  // never take a place somebody is standing in.
  it('will not take a slot an active or a stood-down entry still holds', () => {
    const lost = [rec(7), rec(8, { tick: 900 })];
    const held = fillVacancies([e({ type: 'inf_squad', slot: 8 }), e({ type: 'inf_squad' })], lost, []);
    expect(held[1].slot).toBe(7);
    const inReserve = fillVacancies([e({ type: 'inf_squad' })], lost, [e({ type: 'inf_squad', slot: 8 })]);
    expect(inReserve[0].slot).toBe(7);
  });

  it('leaves an entry that already has a slot alone', () => {
    const got = fillVacancies([e({ type: 'inf_squad', slot: 2 })], [rec(7)], []);
    expect(got[0].slot).toBe(2);
  });

  it('is length-preserving and never assigns one slot twice', () => {
    const lost = [rec(7), rec(8, { tick: 900 })];
    const got = fillVacancies([e({ type: 'inf_squad' }), e({ type: 'inf_squad' }), e({ type: 'inf_squad' })], lost, []);
    expect(got).toHaveLength(3);
    expect(new Set(got.map((r) => r.slot).filter((s) => s !== undefined)).size).toBe(2);
  });
});

describe('predecessorOf', () => {
  it('answers with the most recent chapter of that slot', () => {
    const lost = [rec(7, { name: 'Barkai', tick: 100 }), rec(7, { name: 'Dekel', tick: 5000 }), rec(9, { name: 'Nachshon' })];
    expect(predecessorOf(lost, 7)?.name).toBe('Dekel');
    expect(predecessorOf(lost, 9)?.name).toBe('Nachshon');
    expect(predecessorOf(lost, 3)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Implement**

`roster-lost.ts` holds the four functions. `fillVacancies` builds the held-slot set from `roster` **and** `reserve`, walks the lost list newest-first, and hands each vacancy to the first slotless entry of its type — consuming both as it goes, so nothing is assigned twice.

In `main.ts`, the capture, inside the loop that already exists at `:3486`:

```ts
// The memorial half of the service record (WP-G-E4). `unitLost` is already
// side-0-only (mission.ts:1018) and `entityRoster` is only ever added to, so the
// dead unit's ledger entry is still readable here -- which is the whole reason
// this can be a read at the event rather than a diff after checkEnd.
if (me.kind === 'unitLost' && runtime) {
  const record = lostRecordFor(runtime.rosterEntryOf(me.entity), me.unit, mission.id, me.tick);
  if (record) lostThisMission.push(record);
}
```

and R-13's steps 4 and 5 in the victory branch, between `reattachSlots` and `issueSlots`:

```ts
// Losses are appended BEFORE vacancies are filled, so a slot vacated this
// mission can be filled this mission. That is what a brigade does, and the
// alternative -- a one-mission delay -- would read as the replacement forgetting
// who it replaced.
const lost = appendLost(updatedLedger['roster.lost'] ?? [], lostThisMission);
updatedLedger['roster.lost'] = lost;
const filled = fillVacancies(reattachSlots(rosterIn, before), lost, updatedLedger['roster.reserve'] ?? []);
const carried = issueSlots(filled, updatedLedger['campaign.slots_issued'] ?? 0);
```

`lostThisMission` is a plain `let lostThisMission: LostRecord[] = []` beside the battlefield's other per-mission locals. **A defeat discards it with everything else** — `main.ts` writes nothing on defeat (M4, no ironman), so a lost unit on a losing run is not memorialised, which is correct: the run did not happen as far as the campaign is concerned.

- [ ] **Step 3: Gates, capture, falsify, commit**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm validate:data && pnpm validate:ui && pnpm playtest
/usr/bin/git -C <worktree> diff --stat a567b892..HEAD -- packages/sim     # must be empty
```

**Acceptance, driven rather than assumed.** `pnpm dev`, open `?mission=beit_sahwan_2_foothold`, `__lions.sim.debugKill(__lions.units()[0].id)` twice on two units of the same type, play to a victory, and read `JSON.parse(localStorage['lions.campaign.ledger'])['roster.lost']` — **two records, two distinct names, two distinct slots**, not one collapsed count. Record it in the task report. This is the research brief's named falsification and it is the one thing no unit test proves, because it is the event plumbing rather than the function.

**Falsify, three named, each seen red:**
1. Drop the `slot` guard in `lostRecordFor` so a slotless unit gets a record with `slot: undefined`. The "refuses a unit with no slot" spec goes red, and `fillVacancies` would then hand every fresh remnant's death a vacancy nobody left. Restore.
2. Have `fillVacancies` consume a vacancy without marking it taken. The "pairs one replacement to one vacancy, never two" and "never assigns one slot twice" specs both go red — two living units in one place in the order of battle. Restore.
3. Build the held-slot set from `roster` alone, omitting `reserve`. The second half of the "will not take a slot an active or a stood-down entry still holds" spec goes red. Say in the report why nothing else would have caught it: a stood-down veteran and their replacement would share a slot and the card would name a predecessor who is alive.

```bash
/usr/bin/git -C <worktree> add packages/app/src/roster-lost.ts packages/app/src/roster-lost.test.ts packages/app/src/main.ts
/usr/bin/git -C <worktree> commit -s -- <the same paths>
```

Message:

```
feat(campaign): a lost unit leaves a record, and a replacement takes the place

roster.lost is append-only and never counted against the cap. The capture is a
read at the unitLost event the shell's alert layer already consumes: side-0-only
by construction (mission.ts:1018) and safe after death, because entityRoster is
only ever added to, so the dead unit's own ledger entry is still there. No sim
change, and no post-hoc diff of two rosters.

The replacement takes the LOST SLOT'S id, which is the whole of "remembers whose
place it took" -- no `replaces` field, because the entry and the memorial record
share a number. A vacancy is derived rather than flagged: a record is unfilled
iff no active or stood-down entry carries its slot, so a slot accumulates a
history and nothing has to be kept in sync. Losses are appended before vacancies
are filled, so a place emptied this mission can be filled this mission.

Only a unit that HAD a slot gets a record. A fresh remnant spawned and killed
inside one mission never reached the roster; lostByType()'s aggregate still
counts it and the debrief keeps that aggregate as the total.

Seen red: the slot guard dropped, a vacancy consumed twice, and the held-slot
set built without the reserve.
```

---

### Task 6: The brigade screen says how many places there are, and who is stood down

**Agent: `claude`, at sonnet.** Read R-5 and R-12. One sentence, one `t()` call at the render site, and one conditional handover.

The garage header already carries a two-clause campaign line built by joining two `t()` calls with `" · "`, with a ternary picking `garage.conduct` or `garage.conduct.none` (`ui/brigade.ts:250-256`). This appends a third clause on exactly that shape.

**It renders always** (R-5). `pnpm ui:shots`'s `03-brigade` runs on a near-fresh ledger, so a clause gated on overflow would never be photographed and never pseudo-checked, and a player should meet the cap before they meet it. The reserve half of the sentence is what varies.

**The wording is chosen against a collision the brief found.** The deploy screen already says `"{n} in reserve"` (`loading.brought.reserve`, `en.json:198`) about a different thing entirely — the pool entries *this mission's* placements did not draw, a number that changes every mission. The brigade screen says **"stood down"**, which is a property of the whole roster. `loading.brought.reserve` is not touched and the deploy screen is not opened.

**Files:**
- Modify: `packages/app/src/ui/brigade.ts` (the campaign line at 250-256; `BrigadeOptions.ledger` widens to `CampaignLedger`), `packages/app/src/i18n/en.json`
- Modify: `packages/app/src/ui/brigade.test.ts` (extend; and the two existing exact-text assertions at `:109` and `:123` must move)
- Conditionally modify (R-12): `packages/app/src/ui/deploy-roster.ts` and its test, **only if they already exist**

**Interfaces:**
- Consumes: `ROSTER_CAP` (Task 2); `CampaignLedger` (Task 1).
- Produces: two `en.json` keys, `garage.brigade` and `garage.brigade.reserve`.
- Produces, for Phase 3 (`docs/superpowers/plans/2026-09-19-shell-upgrade-phase-3-app.md`, its R-4 and Task 1): `ROSTER_CAP` is the value its `DeployRosterView.cap` takes. Nothing else crosses.

- [ ] **Step 0: Which branch of R-12 is this**

```bash
ls packages/app/src/ui/deploy-roster.ts
```

Record the answer in the task report before doing anything else. Absent on this branch as of 2026-09-20; if Phase 3's app half has landed in the meantime, the last bullet of Step 2 applies and one extra spec is written.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/src/ui/brigade.test.ts — append, and fix the two existing
// `.rl-garage__campaign` assertions at :109 and :123 in the same edit.
import { ROSTER_CAP } from '../roster-cap';

describe('the brigade line — the cap and who is stood down', () => {
  // R-5: it renders on a fresh campaign too. A sentence that only appears once
  // the cap has been reached is a sentence `pnpm ui:shots` never photographs and
  // `--pseudo` never checks, and a rule the player meets for the first time by
  // breaking it.
  it('says how many places the brigade has, even with an empty roster', () => {
    mount({ ledger: {} });
    expect(text(host, '.rl-garage__campaign')).toContain(`0 of its ${ROSTER_CAP} places`);
  });

  it('counts the active roster, not the whole population', () => {
    mount({ ledger: { 'roster.surviving_units': [entry(1), entry(2)], 'roster.reserve': [entry(3)] } });
    expect(text(host, '.rl-garage__campaign')).toContain(`2 of its ${ROSTER_CAP} places`);
  });

  it('adds the stood-down clause only when somebody is', () => {
    mount({ ledger: { 'roster.surviving_units': [entry(1)] } });
    expect(text(host, '.rl-garage__campaign')).not.toContain('stood down');
    mount({ ledger: { 'roster.surviving_units': [entry(1)], 'roster.reserve': [entry(2), entry(3)] } });
    expect(text(host, '.rl-garage__campaign')).toContain('2 units are stood down');
  });

  it('pluralises one', () => {
    mount({ ledger: { 'roster.surviving_units': [entry(1)], 'roster.reserve': [entry(2)] } });
    expect(text(host, '.rl-garage__campaign')).toContain('1 unit is stood down');
  });

  // The collision the research brief named: two different "reserve"s in one
  // session, meaning two different things to the same player. The deploy screen
  // keeps `{n} in reserve` for what a mission did not draw; this screen must not
  // borrow the phrase.
  it('does not use the deploy screen\'s word for a different idea', () => {
    mount({ ledger: { 'roster.surviving_units': [entry(1)], 'roster.reserve': [entry(2)] } });
    expect(text(host, '.rl-garage__campaign')).not.toContain('in reserve');
  });
});
```

`entry(slot)` is a local helper on the file's existing fixture shape. `pnpm vitest run packages/app/src/ui/brigade.test.ts` — the five new cases must fail, and the two existing exact-text assertions must fail too, which is the proof that the clause renders unconditionally.

- [ ] **Step 2: Implement**

`en.json`, two flat keys beside `garage.conduct`:

```json
"garage.brigade": "The brigade holds {n} of its {cap} places.",
"garage.brigade.reserve": "The brigade holds {n} of its {cap} places, and {r, plural, one {# unit is} other {# units are}} stood down."
```

The ICU plural is the same construction `hud.card.record` already uses, so nothing new is asked of `t()`.

`brigade.ts`, appended to the existing join, `t()` called **at the render site** and never through a variable (`validate_i18n.mjs`'s regex cannot see the variable form, and that is how the garage's own three upgrade-track headings once shipped in English):

```ts
const active = opts.ledger['roster.surviving_units'] ?? [];
const stoodDown = opts.ledger['roster.reserve'] ?? [];
titles.appendChild(
  el(
    'div',
    'rl-garage__campaign',
    `${t('garage.stars', { n: starsEarned(opts.ledger), m: opts.possibleStars })} · ${
      roe !== null ? t('garage.conduct', { mean: roe.mean }) : t('garage.conduct.none')
    } · ${
      stoodDown.length > 0
        ? t('garage.brigade.reserve', { n: active.length, cap: ROSTER_CAP, r: stoodDown.length })
        : t('garage.brigade', { n: active.length, cap: ROSTER_CAP })
    }`
  )
);
```

`BrigadeOptions.ledger` widens from `LedgerData` to `CampaignLedger`; `main.ts:957` already passes what `readLedger()` returns, so the call site does not move.

**If `deploy-roster.ts` exists** (R-12): set `cap: ROSTER_CAP` where its `deployRosterView` returns `cap: null`, add one spec that the field is a number and equals `ROSTER_CAP`, and **do not open the deploy screen** — Phase 3's own R-4 reserves that. If it does not exist, write one line in the task report handing `ROSTER_CAP` to Phase 3's Task 1, and stop.

- [ ] **Step 3: Gates, capture, falsify, commit**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm validate:data && pnpm validate:ui && pnpm playtest
pnpm ui:shots -- --pseudo
/usr/bin/git -C <worktree> diff --stat a567b892..HEAD -- packages/sim     # must be empty
```

Open `03-brigade` from both the plain and the `--pseudo` run. **The pseudo shot is the check that matters**: every word of the new clause must be bracketed and accented. A plain unbracketed word there is a string that never went through `t()`, which `pnpm validate:ui` cannot see. Paste the overflow report's line for `.rl-garage__campaign` too — the clause makes that line longer and the report is the instrument that says by how much.

**Falsify, three named, each seen red:**
1. Count `active.length + stoodDown.length` instead of `active.length`. The "counts the active roster" spec goes red. Restore, and say in the report why it matters: the number the player reads must be the number a mission can draw from.
2. Build the sentence into a `const line = t(...)` first and append the variable. `pnpm validate:ui` stays **green** and the pseudo capture is what catches it — run both and record that the gate did not fire. This is CLAUDE.md's named i18n trap, demonstrated rather than quoted. Restore.
3. Gate the whole clause on `stoodDown.length > 0`. The first spec goes red and `03-brigade` shows nothing. Restore.

```bash
/usr/bin/git -C <worktree> add packages/app/src/ui/brigade.ts packages/app/src/ui/brigade.test.ts packages/app/src/i18n/en.json
/usr/bin/git -C <worktree> commit -s -- <the same paths>
```

Message: `feat(ui): the garage says how many places the brigade has, and who is stood down`, body recording that the clause renders unconditionally so `ui:shots` photographs it, that "stood down" is deliberately not the deploy screen's "in reserve" (two different ideas, one session), and that the i18n trap was demonstrated with `validate:ui` green and the pseudo capture red.

---

### Task 7: The debrief names the lost, and says who took the place

**Agent: `claude`, at sonnet.** Read R-11. Mechanical once Task 5 exists; the one judgement is that the aggregate stays.

Today the debrief prints one row: `Lost — {type} ×{count}`, from `lostByType()` (`debrief.ts:19`, `:87-91`, built at `main.ts:3595`). That row is the **total**, it counts fresh remnants that never reached the roster, and it does not move (R-11). Beside it go two new rows: who was lost by name, and who took a vacant place this mission.

**Files:**
- Modify: `packages/app/src/ui/debrief.ts` (`DebriefOptions`, and two `row(...)` calls beside the existing `lost` one), `packages/app/src/i18n/en.json`
- Modify: `packages/app/src/main.ts` (the `debrief` object built at `:3595`)
- Test: `packages/app/src/ui/debrief.test.ts` (extend)

**Interfaces:**
- Consumes: `LostRecord`, `predecessorOf` (Task 5); `lostByType()` (unchanged).
- Produces: `DebriefOptions` gains `lostNamed: { name?: string; type: string }[]` and `replacements: { name: string; predecessor: string }[]`, both defaulting to empty so every existing call site and every existing spec still compiles.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/src/ui/debrief.test.ts — append
describe('the memorial half of the service record', () => {
  // R-11: the named list is a SUBSET of the count. A fresh remnant killed on the
  // mission it spawned in has no service record to print, and a player who reads
  // "3 rifle squads" above "Barkai, Dekel" has not found a bug.
  it('keeps the aggregate as the total and names the roster units beside it', () => {
    mount({
      lost: [{ type: 'Rifle squad', count: 3 }],
      lostNamed: [{ name: 'Barkai', type: 'Rifle squad' }, { name: 'Dekel', type: 'Rifle squad' }],
    });
    expect(text(host, '.rl-debrief__lost')).toContain('×3');
    expect(text(host, '.rl-debrief__lostNamed')).toContain('Barkai');
    expect(text(host, '.rl-debrief__lostNamed')).toContain('Dekel');
  });

  it('says who took a vacant place', () => {
    mount({ replacements: [{ name: 'Gilad', predecessor: 'Barkai' }] });
    expect(text(host, '.rl-debrief__replaced')).toContain('Gilad');
    expect(text(host, '.rl-debrief__replaced')).toContain('Barkai');
  });

  // The zero paths, both of them. The existing "nobody" row must not regress,
  // and two rows that print an empty value are two rows of visual noise on the
  // screen a player sees most often.
  it('renders the existing nobody row unchanged and omits both new rows when empty', () => {
    mount({ lost: [], lostNamed: [], replacements: [] });
    expect(text(host, '.rl-debrief__lost')).toBe('nobody');
    expect(host.querySelector('.rl-debrief__lostNamed')).toBe(null);
    expect(host.querySelector('.rl-debrief__replaced')).toBe(null);
  });

  // A loss with no callsign is possible on a save written before names shipped.
  // It must read as a unit, never as "undefined".
  it('falls back to the type for a lost unit with no callsign', () => {
    mount({ lost: [{ type: 'Mortar team', count: 1 }], lostNamed: [{ type: 'Mortar team' }] });
    expect(text(host, '.rl-debrief__lostNamed')).toContain('Mortar team');
    expect(text(host, '.rl-debrief__lostNamed')).not.toContain('undefined');
  });
});
```

- [ ] **Step 2: Implement**

`en.json`:

```json
"debrief.row.lostNamed.label": "By name",
"debrief.row.replaced.label": "Replaced",
"debrief.row.replaced.value": "{name} took {predecessor}'s place"
```

`debrief.ts`, two `row(...)` calls immediately after the existing `lost` one, each guarded on a non-empty list and each joining with `', '` exactly as `lost` does. The value strings go through `t()` at the call, and a nameless record falls back to its type.

`main.ts` at `:3595`, beside the existing `lost:` line: `lostNamed` from this mission's captured records (Task 5's `lostThisMission`, mapped through the same `unitFor(type).name` lookup the aggregate already uses so both rows name the unit the same way), and `replacements` by walking the entries that gained a slot in this mission's `fillVacancies` pass and reading `predecessorOf(lost, slot)` for each. **A defeat passes both empty** — `lostThisMission` is discarded with the rest of the run (M4), and the debrief on a defeat must not claim a replacement that was never written.

- [ ] **Step 3: Gates, capture, falsify, commit**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm validate:data && pnpm validate:ui && pnpm playtest
pnpm ui:shots -- --pseudo
/usr/bin/git -C <worktree> diff --stat a567b892..HEAD -- packages/sim     # must be empty
```

`17-debrief` is a scripted `debugKill`-forced **defeat** (`shoot.ts:24`), so it photographs the empty path. Check both shots: the two new rows must be absent and the existing `Lost — nobody`/`×N` row unchanged. Then drive the non-empty path by hand — a victory on `beit_sahwan_2_foothold` after killing two named units — and record the two rows in the task report.

**Falsify, three named, each seen red:**
1. Replace the aggregate row with the named list instead of adding beside it. The "keeps the aggregate as the total" spec goes red, and the report should say what would have shipped: a mission that lost four units reporting two, because two of them were fresh remnants with no record.
2. Render both new rows unconditionally. The zero-path spec goes red at `toBe(null)`. Restore.
3. Drop the `?? type` fallback for a nameless record. The last spec goes red on `not.toContain('undefined')`. Restore.

```bash
/usr/bin/git -C <worktree> add packages/app/src/ui/debrief.ts packages/app/src/ui/debrief.test.ts packages/app/src/main.ts packages/app/src/i18n/en.json
/usr/bin/git -C <worktree> commit -s -- <the same paths>
```

Message: `feat(ui): the debrief names the lost, and says who took the place`, body recording that `lostByType()`'s aggregate stays as the total because the named list can only cover units that reached the roster, and naming the mutation seen red.

---

### Task 8: The unit card remembers whose place this is

**Agent: `claude`, at sonnet.** The last task, and the one that proves the whole round trip on screen: a field `@lions/sim` has never heard of, read off the runtime's own object, mid-mission.

`cardHtml` (`ui/hud.ts:1509-1526`) already reads `this.deps.rosterEntryOf?.(id)` for the callsign and the `rl-card__record` line. This adds one line under it when the selected unit's slot has a predecessor.

**Nothing new has to reach the sim for this to work**, and `tools/src/roster-carry.test.ts` (Task 3) is the pin that says so: `entityRoster.set(id, origin)` stores the app's own object and `rosterEntryOf` hands it back, so `entry.slot` is readable during the mission. The widening is free because `slot` is optional — `Readonly<LedgerRosterEntry>` is assignable to `Readonly<RosterEntry>`, so `main.ts:2439`'s `rosterEntryOf: (id) => runtime?.rosterEntryOf(id)` needs no cast and does not move.

**Files:**
- Modify: `packages/app/src/ui/hud.ts` (the `rosterEntryOf` dep type at `:172-175`; `cardHtml` at `:1519-1526`), `packages/app/src/i18n/en.json`
- Modify: `packages/app/src/main.ts` (one new HUD dep beside `rosterEntryOf` at `:2439`)
- Test: `packages/app/src/ui/hud.test.ts` (extend)

**Interfaces:**
- Consumes: `RosterEntry` (Task 1); `predecessorOf`, `LostRecord` (Task 5).
- Produces: `HudDeps` gains `predecessorOf?: (slot: number) => { name?: string; type: string; missionName?: string } | undefined` — a **closure over the ledger, not a snapshot**, exactly as `rosterEntryOf` is and for the same reason (the ledger `main.ts` holds is rebound at mission end).

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/src/ui/hud.test.ts — append to the single-unit card block
describe('the card\'s service record — whose place this is', () => {
  it('names the predecessor when this unit took a vacant slot', () => {
    const { hud, host } = mountCard({
      rosterEntryOf: () => ({ type: 'inf_squad', veterancy: 1, name: 'Gilad', missions: 1, kills: 0, slot: 7 }),
      predecessorOf: (slot) => (slot === 7 ? { name: 'Barkai', type: 'inf_squad', missionName: 'Foothold' } : undefined),
    });
    hud.select([0]);
    expect(text(host, '.rl-card__replaces')).toContain('Barkai');
  });

  // Do not regress the plain record line: a unit that has always held its own
  // place is the common case and must gain nothing.
  it('shows nothing extra for a unit whose slot has no history', () => {
    const { hud, host } = mountCard({
      rosterEntryOf: () => ({ type: 'inf_squad', veterancy: 0, name: 'Gilad', missions: 1, kills: 0, slot: 7 }),
      predecessorOf: () => undefined,
    });
    hud.select([0]);
    expect(host.querySelector('.rl-card__replaces')).toBe(null);
    expect(text(host, '.rl-card__record')).toContain('1 mission');
  });

  // A fresh spawn has no ledger entry at all (`drawn = [null]`, mission.ts:1264),
  // so there is no slot to look up and the lookup must not be attempted with
  // `undefined`.
  it('shows nothing for a fresh spawn with no roster entry', () => {
    const { hud, host } = mountCard({ rosterEntryOf: () => undefined, predecessorOf: () => { throw new Error('must not be called'); } });
    hud.select([0]);
    expect(host.querySelector('.rl-card__replaces')).toBe(null);
  });

  it('escapes a predecessor\'s name like every other name on the card', () => {
    const { hud, host } = mountCard({
      rosterEntryOf: () => ({ type: 'inf_squad', veterancy: 0, slot: 7 }),
      predecessorOf: () => ({ name: '<img src=x onerror=1>', type: 'inf_squad' }),
    });
    hud.select([0]);
    expect(host.querySelector('.rl-card__replaces img')).toBe(null);
  });
});
```

- [ ] **Step 2: Implement**

`en.json`: `"hud.card.replaces": "in {predecessor}'s place"` — short, because it sits under a record line on a card that is already dense, and it is the card's third line about the same unit.

`cardHtml`, immediately after the `record` line and on the same shape:

```ts
const predecessor = entry?.slot !== undefined ? this.deps.predecessorOf?.(entry.slot) : undefined;
const replaces =
  predecessor !== undefined
    ? `<div class="rl-card__replaces rl-dim">${t('hud.card.replaces', { predecessor: escapeHtml(predecessor.name ?? predecessor.type) })}</div>`
    : '';
```

`escapeHtml` is the file's own, and it is not optional: a name is player-visible data that arrives from a save file. `theme.css` needs no new colour — `rl-dim` is the same semantic token `rl-card__record` already carries.

`main.ts`, beside `rosterEntryOf: (id) => runtime?.rosterEntryOf(id)` at `:2439`:

```ts
// A closure, not a snapshot, exactly like `rosterEntryOf` above -- `ledger` is
// rebound at mission end and a captured array would answer about the campaign
// as it was when the battlefield booted.
predecessorOf: (slot) => predecessorOf(ledger['roster.lost'] ?? [], slot),
```

- [ ] **Step 3: Gates, capture, falsify, commit**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm validate:data && pnpm validate:ui && pnpm playtest && pnpm test:determinism
pnpm ui:shots -- --pseudo
/usr/bin/git -C <worktree> diff --stat a567b892..HEAD -- packages/sim     # must be empty
```

`pnpm test:determinism` is this package's closing evidence for the Global Constraint, not because this task goes near the sim. Confirm the golden hash is unmoved and say so in the report.

**Acceptance, driven.** The card is not in any golden-baseline scenario (`quiet`, `open-ground`, `vehicle`, `relief`, `combat` — none selects a unit, checked), so `pnpm golden-baseline` should not move; run it once and record that it did not. Then drive it: `pnpm dev`, a save with a replacement in it (from Task 5's acceptance run), select the replacement, and photograph the card showing all three lines — callsign, record, "in Barkai's place".

**Falsify, three named, each seen red:**
1. Look the predecessor up by `entry.type` instead of `entry.slot`. The first spec still passes and the second goes red — every unit of a type whose predecessor died would claim the place. Restore, and record that the type-keyed version is the version that looks right and is wrong.
2. Drop `escapeHtml`. The escaping spec goes red with a real `<img>` in the DOM. Restore.
3. Call `predecessorOf` unconditionally, without the `entry?.slot !== undefined` guard. The fresh-spawn spec goes red on its thrown sentinel. Restore.

```bash
/usr/bin/git -C <worktree> add packages/app/src/ui/hud.ts packages/app/src/ui/hud.test.ts packages/app/src/main.ts packages/app/src/i18n/en.json
/usr/bin/git -C <worktree> commit -s -- <the same paths>
```

Message:

```
feat(hud): the unit card remembers whose place this is

One line under the service record, from the memorial record that shares this
unit's slot. It is also the proof of the whole round trip: `slot` is a field
@lions/sim has never heard of, and the card reads it off the runtime's own
object mid-mission because entityRoster stores the app's array entry and
rosterEntryOf hands it back. tools/src/roster-carry.test.ts pins that; this is
where a player sees it.

Keyed on the SLOT and not the type. The type-keyed version is the one that looks
right -- and it tells every rifle squad on the map that it is standing in a dead
man's place. Determinism hash unmoved; no golden-baseline scenario selects a
unit, and the run confirms it did not move either.

Seen red: the lookup keyed on type, escapeHtml dropped, and the slot guard
removed.
```

---

## Deliberately not done here

- **A `slot` field on `LedgerRosterEntry` in `packages/sim`.** One line in `checkEnd` (`entry.slot = origin?.slot`, beside the existing `entry.name`) replaces `reattachSlots` entirely. It is smaller than the rule this plan ships and it is a diff under `packages/sim/`, against this plan's byte-for-byte constraint and against the gamification page's *"do not let a tier, a credit or a name reach the sim"*. If a later session takes it as a deliberate, reviewed exception, `tools/src/roster-carry.test.ts`'s second assertion goes red and tells it so, and `reattachSlots` and its seven specs are deleted rather than left running for nothing. Recorded, not hidden.
- **A true 26-mission roster measurement.** R-10. It needs one ledger threaded through every winning plan, which `playtest.ts:36-42` records being tried and abandoned for stars, and a roster composition change can move which units a scripted plan controls — so a break would be plan fragility reported as a measurement. Worth doing on its own, with its own falsification, when somebody wants the number for its own sake rather than to set a cap with.
- **Recall from reserve as a player action.** `splitRoster` already gives a stood-down unit back when losses make room, so nothing is permanently benched. A *chosen* recall — the player picking who comes back — is a deploy-screen decision and belongs with Phase 3's `deploy-roster.ts`, whose own R-3 already establishes that the screen permutes the pool rather than filtering it. Flagged for the lead below.
- **`campaignSummary`'s menu-strip line** (`campaign.ts:468-478`). It says `roster {n}` and after this package that `{n}` is the active count, which is correct but silent about the reserve. It is also the one player-facing string in this area that does not go through `t()` at all, so adding to it means i18n-ing it, which is a different change with a different gate. Named as an open question rather than smuggled in.
- **Retiring `broughtFor`'s hand-copy of the spawner's draw rule** (`loading.ts:118-130`). Phase 3's Task 1 moves it into `deploy-roster.ts` and has `broughtFor` call it. This package does not touch it, and does not need to: the cap changes what is *in* `roster.surviving_units`, never how a mission draws from it.
- **Per-veteran fittings.** The page's own next thing after this one — *"attach to the named roster entry and die with it"*. The slot is what they would attach to, and nothing here forecloses it.

---

## Open questions for the lead

1. **Is the cap meant to bind?** 150 is set to sit above anything a campaign produces (measured maximum 30; loose ceiling 126), which is what the page asked for — so in normal play no player ever sees a unit stand down. If the cap is meant to be a felt constraint rather than a rail, the number is a design decision and not a measurement, and it wants a different one. **Default taken:** the page's own wording, a rail.
2. **Replays fill the reserve, and that is now visible.** A replayed mission appends to the roster the way any run does, so a player who replays for a better grade will stand units down eventually. #174's *"overflow … never deleted"* reads as accepting that, and `splitRoster` gives them back when losses make room. **Confirm, or decide that a replay stops appending once at the cap** — which would be a change to what a replay means, not to this function.
3. **Should the player choose who comes back?** Today the order decides (veterans first), and a stood-down unit returns automatically when the active list falls below the cap. A chosen recall is a deploy-screen feature and belongs with Phase 3. **Default taken:** automatic, by the order.
4. **"Stood down" or another phrase?** The brigade screen cannot say "in reserve" — the deploy screen already uses those words for the pool entries a mission did not draw, and the two would appear in one session meaning different things. "Stood down" is army English for off the active list without being disbanded. **Default taken:** stood down. If the lead prefers different words, it is two `en.json` values and nothing else.
5. **Does the menu strip owe the reserve a number?** `campaignSummary` will read `roster 30` while units are stood down. Adding the reserve there means i18n-ing a line that has never been through `t()`. **Default taken:** leave it; it is the active count and it is not wrong.
6. **A slot's history is kept forever.** `roster.lost` is append-only by #174's own rule, and a long campaign with heavy churn accumulates one record per loss — hundreds, in a save that is a `localStorage` string. Nothing bounds it. **Default taken:** keep it all, on the page's rule; flagged because ST6 (#205) will eventually carry these bytes over a network and may want a bound then.
