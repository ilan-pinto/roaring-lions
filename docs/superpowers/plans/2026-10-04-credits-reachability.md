# GH-330: a fresh campaign pays again, so everything coins sell can be reached by play. Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore finite reachability for the credit catalogue (Roar coin design #329, F1 and
recommendation R1), so guard G1 can let coins sell every item, without opening a farm.

| | today (`main` `434cad99`) | after this plan |
|---|---|---|
| what a won mission pays | `value − paid[m]`, floored at 0; `paid` is a **lifetime** record that survives "New campaign" (spec 2026-09-15 §4.1, D4) | `value − campaign_paid[m]`, floored at 0, for a mission that is **open** in this campaign. `campaign_paid` is cleared by "New campaign". `paid` stays, as the lifetime best |
| replay inside one campaign | improvement only | **improvement only, unchanged** (recommended, see D2) |
| lifetime credits | bounded at one campaign: **5,736** (M) | unbounded; **5,736 more per campaign** at base tier, 5,859 at max tier (M) |
| catalogue reached | **never**: 8.2% of 70,345 (M) | in **12.3 campaigns** (13 whole), ~53 h on the design's 10-minute assumption (M) |
| G1 (`stores-model.ts`) | `demo_tzav` 6,500 and `heli_peten_gunship` 8,000 are `offSale`; `LIFETIME_CREDITS` is a stale **5,849** that nothing pins | nothing in the credit catalogue is `offSale`; the per-campaign figure is pinned to `LADDER_CREDITS` |

**Architecture.** None of this is sim code. `creditsFor` (`packages/sim/src/credits.ts`) computes
what a run is WORTH and does not change. The improvement rule is `payMission`, in
`packages/app/src/brigade-account.ts`, and the reset belongs to `purgeCampaign` in
`packages/app/src/main.ts`. The harness gains a walk through the real `payMission`. So **no golden
hash moves, `pnpm balance` cannot move, and `LADDER_CREDITS` does not move** (it measures one
campaign's values, which are unchanged). This corrects the Stage 4 order, which put the change in
`credits.ts` and expected one `LADDER_CREDITS` re-pin. See "Placement in the Stage 4 order".

**Tech stack:** TypeScript strict, vitest (jsdom for the store screen), `pnpm playtest`.

**Refs:**
- GH-330; the Roar coin shop design `docs/superpowers/specs/2026-10-01-roar-coin-shop-design.md`
  §1.1 (catalogue table), §1.2 (F1 and R1–R4), §1.7 (G1), §5 D3.
- The brigade economy spec `docs/superpowers/specs/2026-09-15-brigade-economy-design.md` §4.1 (the
  account survives `?fresh`), §4.2 D2 (improvement rule).
- The Stage 4 order `docs/superpowers/plans/2026-10-04-stage4-order.md` (#373).
- `tools/src/backtest/playtest.ts`: `LADDER_CREDITS` (5736), the max-tier replay pass.

**Base:** read against `main` `434cad99` (v0.117.0). (M) is measured by the throwaway probe below;
(R) is reasoned.

---

## Measured numbers (the probe)

A throwaway probe outside the repository
(`probe.mjs` in the session scratchpad, not committed) parsed one `pnpm playtest` run at
`434cad99` (exit 0, `credit ladder: 5736 over 26 missions`) and the priced JSON. Nothing in the tree
was changed. Re-run it, or its successor Task 6, before quoting any number below in a commit.

**Catalogue.** Shipped JSON: 15 priced unit unlocks (28,480, including the staged `demo_tzav`) plus
168 upgrade rungs (41,610) = **70,090**. The coin design's table says **70,345** over 166 items
(it counts 147 rungs and the four designed field commanders, 6,900, that have no JSON). The two
differ by 0.4%; this plan uses 70,345, the larger, and Task 6 prints both.

**Campaigns to the whole catalogue.**

| | per campaign | campaigns | hours, 10-min assumption | hours, plan clock + 1.5 min a run |
|---|---|---|---|---|
| **before** | 5,736 once, then 0 | **never** (8.2%) | — | — |
| **after, base tier** | 5,736 | **12.26 → 13** | 53 | 26 |
| after, max tier (upper bound: later campaigns field a bought-up brigade) | 5,859 | 12.01 → 13 | 52 | 26 |

The 10-minute figure is the coin design's labelled assumption. The plan clock (89.8 minutes over 26
missions) is the optimal plans' own clock and is a **floor** on real play: the recon plans hold
perfect information (CLAUDE.md, "A scripted plan proves a mission WINNABLE"). No real-player
duration has ever been measured.

**Farming** (credits per minute = credits ÷ (plan minutes + 1.5 minutes of menu, briefing, deploy
and debrief), so every rate here is an UPPER bound on a skilled player):

| loop | credits per hour | catalogue in | vs a full campaign |
|---|---|---|---|
| a full campaign, start to finish | 2,672 | 26.3 h | 1.0x |
| **openers loop**: "New campaign", then the three Marj openers (`beit_sahwan_breach` 160, `khan_rafid_1_recon` 310, `deir_amun_1_recon` 270), repeat | 3,895 | 18.1 h | **1.46x** (1.10x on the 10-minute assumption) |
| **URL loop**: "New campaign", then `/mission/khan_rafid_1_recon` by address, repeat | **9,300** | **7.6 h** | **3.5x** |

The URL loop exists because the mission route does not check that a mission is open (`main.ts`
boots any `/mission/<id>`), and `khan_rafid_1_recon` pays 310 for a 0.5-minute plan. With today's
lifetime rule that costs nothing (the second run pays 0). A plain per-campaign reset would turn it
into the fastest earner in the game, four times faster than playing the campaign. **That needs a
guard (G-A, Task 3).** The openers loop is a smaller edge and is the lead's call (D3).

---

## Decisions

- **D1. The mechanism: a per-campaign improvement record, kept beside the lifetime one, in the
  brigade account.** `campaign_paid: Record<string, number>`, cleared by `purgeCampaign` (the "New
  campaign" button and the `?fresh` landing both run it). `paid` stays as the lifetime best and is
  still raised on a better run; the store's mean-pay line keeps reading it. **Not in the campaign
  ledger**, although that would reset itself: a `/mission/<id>?fresh` victory overwrites the stored
  ledger with that one mission's keys (`{ ...{}, ...me.ledger }`, `main.ts`), so a record kept there
  is erased by a URL, and that is a farm.
- **D2. Replay inside one campaign stays improvement-only** (recommended, as the issue and R1 say).
  Otherwise the opener of any campaign is an infinite tap with no "New campaign" step at all, and
  the debrief's "no improvement over your best" stays true, only scoped to the campaign.
- **G-A. A reset pays only for a mission open in this campaign.** At victory, a mission pays against
  `campaign_paid` only if, in the ledger read at boot, it is done or is its town's next mission in a
  region that is not locked (`nextMissionOf`, `regionProgress`, `campaign.ts`). Otherwise it pays
  against the lifetime `paid`, exactly today's rule, so nobody earns less than today and a locked
  mission played by address cannot repeat. Kills the URL loop (9,300 → the openers loop's 3,895 at
  most). Taken default; it is a guard, not a rule change, because the board never offers a locked
  mission.
- **D3 (for the lead). The openers loop.** 1.46x a campaign on the plan clock, 1.10x on the
  10-minute assumption. Recommended: **accept**. It is real play of real missions, coins are meant to
  be "faster across the board" anyway, and 18 h of the same three missions is not an attractive
  route. The ready alternative, **G-B ("a round lock")**: a mission pays its per-campaign value only
  while the number of campaigns it has paid in is ≤ the number of whole rounds the brigade has
  completed (every `world.json` mission paid since the last round). That caps the openers loop at
  one payout per round and costs a player who restarts mid-campaign nothing they have today. Task 4
  carries G-B behind a flag only if the lead picks it.
- **D4. Existing saves: no back-pay.** Version 1 → 2. `campaign_paid` starts as `paid` restricted
  to the missions done in the CURRENT ledger (`campaign.mission_results`). A mission won in this
  campaign therefore pays nothing extra, and a mission not yet won in this campaign pays in full when
  it is won. Campaigns a player abandoned before this ships are not repaid.
- **D5. G1 for credit items retires its "unreachable" branch**: every credit price is finite and is
  now reachable across campaigns. The `unreachable` honest line and the `offSale` state stay in the
  type (R2 and future coin-only shapes may need them) but no credit item reaches them.

---

## Global Constraints

- **No sim change.** `packages/sim/**` is untouched, so `pnpm test:determinism` cannot move. If it
  moves, that is a defect for `sim-guard`.
- `credits.ts` is untouched: `CREDIT_WEIGHTS` and `creditsFor` stay as they are.
- Account arithmetic stays integer. The wall clock is taken by the caller, as `payMission` does today.
- `brigade-account.ts` stays the only reader and writer of `lions.brigade.account`.
- One commit per task. Every new check lands with its falsification in the commit message.
- Test servers start with music off (`lions.settings` `audio.music = 0`). Never `pkill` a dev server.
- Commit with `git commit -- <paths>`; the tree is shared.

## File structure

| file | change |
|---|---|
| `packages/app/src/brigade-account.ts` | `campaign_paid`, version 2, `payMission` gains a scope argument, `startCampaign` |
| `packages/app/src/ledger-store.ts` | `readAccount` migrates with the active ledger; `startCampaign` seam op |
| `packages/app/src/campaign.ts` | `missionOpen(world, id, ledger)`, a pure predicate (G-A) |
| `packages/app/src/main.ts` | `purgeCampaign` clears `campaign_paid`; the payout call passes the scope |
| `packages/app/src/ui/stores-model.ts` | `LIFETIME_CREDITS` → `CAMPAIGN_CREDITS = 5736`, pinned; G1 credit branch retired |
| `packages/app/src/i18n/en.json` | `debrief.credits.none` names the campaign; the store's campaigns line |
| `tools/src/backtest/playtest.ts` | the two-campaign walk through the real `payMission` (relations, not a new pin) |
| `tools/src/campaign_credits.test.ts` (new) | `CAMPAIGN_CREDITS` against `LADDER_CREDITS`, read as text |
| `docs/superpowers/specs/2026-10-01-roar-coin-shop-design.md`, `CLAUDE.md` | the record of the change |

---

## Task 1: the per-campaign record in the account (version 2)

- [ ] **Step 1: Test first** (`brigade-account.test.ts`). `emptyAccount()` has `campaign_paid: {}`
  and `version: 2`. `payMission(account, m, value, at, 'campaign')` pays `value − campaign_paid[m]`,
  raises both `campaign_paid[m]` and `paid[m]` (the latter only when higher), writes one `earned`
  grant of the paid amount; `'lifetime'` scope is today's behaviour byte for byte (existing tests
  keep passing unedited, with the argument defaulted to `'lifetime'`). `startCampaign(account)`
  returns `campaign_paid: {}` and touches nothing else (balance, `earned_total`, `paid`, unlocks,
  upgrades, grants identical).
- [ ] **Step 2: Implement.** `campaign_paid` beside `paid`; `migratePaid` reused for it.
- [ ] **Step 3: The `migrateAccount` bound still holds**: `balance ≤ Σ grants` is unchanged, since a
  campaign payout writes a grant like any other. Add the case: a v2 account paid twice for one
  mission across two campaigns still migrates to its own balance.
- **Falsify:** (a) make `'campaign'` subtract `paid[m]` → the second-campaign test reads 0, red;
  (b) make `startCampaign` also clear `paid` → the "lifetime best survives" assertion red; (c) drop
  the grant on a campaign payout → the migration bound halves the balance, red.
- **Gates:** `pnpm test`, `pnpm typecheck`, `pnpm lint`.

## Task 2: migrating existing saves (D4)

- [ ] **Step 1: Test first.** `migrateAccount(rawV1, ledger)`: `campaign_paid` = `paid` restricted to
  the keys of `ledger['campaign.mission_results']`. `migrateAccount(rawV1)` with no ledger:
  `campaign_paid = { ...paid }` (conservative: pays nothing new). A v2 save round-trips unchanged. A
  hand-edited `campaign_paid` above `paid` for some mission is clamped to `paid` (a per-campaign best
  can never exceed the lifetime best).
- [ ] **Step 2:** `ledger-store.ts`'s `readAccount` passes the active ledger. Save-slot loads
  (`profile.ts`) write the ledger before the account, so the next read migrates against the slot's
  own ledger; add a `profile.test.ts` case that loads a v1 slot and reads the migrated record.
- **Falsify:** (a) ignore the ledger and start `campaign_paid` at `{}` → the "mid-campaign player
  gets no windfall" case pays 5,736 on replay, red; (b) remove the clamp → the hand-edit case red;
  (c) swap the slot write order in the test fixture → the slot case red (proves the order is read).
- **Gates:** `pnpm test`, `pnpm typecheck`.

## Task 3: the open-mission guard (G-A)

- [ ] **Step 1: Test first** (`campaign.test.ts`). `missionOpen(world, id, ledger)` is true for a
  done mission, true for a town's next mission in a live region, false for a later mission in the
  same town, false for any mission in a locked region (`sur` before `deir_amun_3_subterranean`),
  false for an id outside `world.json` (the tutorial; it pays nothing anyway, R5).
- [ ] **Step 2: Wire it.** In `main.ts`'s payout block the scope is
  `missionOpen(parseWorld(world), missionId, ledger) ? 'campaign' : 'lifetime'`, where `ledger` is
  the one read at boot (before this victory's write). The tutorial gate (`produces.length > 0`)
  stays in front of it.
- [ ] **Step 3: An app-level walk test** (jsdom, a memory ledger store, no browser): fresh campaign,
  win `khan_rafid_1_recon` (pays 310), "New campaign", win it again (pays 310), win
  `khan_rafid_3_clearance` by address with an empty ledger (scope `lifetime`; pays only if above the
  lifetime best), "New campaign", win `khan_rafid_3_clearance` again (pays 0).
- **Falsify:** (a) `missionOpen` returns true always → the URL case pays twice, red; (b) read the
  ledger AFTER the victory write → the town's next mission is now "done" and an unopened mission
  reads open; the walk catches it, red; (c) drop the region check → the Sur case red.
- **Gates:** `pnpm test`, `pnpm typecheck`, `pnpm lint`.

## Task 4: "New campaign" starts a new record

- [ ] **Step 1:** `purgeCampaign` calls `ledgerStore.startCampaign()` after `clearLedger()` and
  `setTutorialDone(false)`. A blocked store is a no-op, as for the other two.
- [ ] **Step 2: Drive the UI** (memory: console shortcuts skip the code that breaks). Extend
  `pnpm ui:routes` or a Playwright spec: seed an account with `campaign_paid` set, click "New
  campaign" and confirm, read `localStorage['lions.brigade.account']` back: `campaign_paid` is `{}`,
  `balance` and `paid` unchanged. Repeat through the `?fresh` landing. And a `/mission/<id>?fresh`
  landing must NOT clear it (it does not run the purge).
- [ ] **Step 3 (only if the lead picks G-B in D3):** the round lock behind a constant, with its own
  test: openers loop pays once per round; a player who restarts at mission 10 of a never-finished
  round is paid exactly what today's rule pays.
- **Falsify:** (a) delete the `startCampaign` call → the button case reads the old record, red;
  (b) call it from the mission `?fresh` path too → the third case red.
- **Gates:** `pnpm test`, `pnpm ui:routes`, `pnpm lint`.

## Task 5: the store and the copy (G1, D5)

- [ ] **Step 1:** `LIFETIME_CREDITS` (5,849, stale since GH-345 moved the ladder to 5,736) becomes
  `CAMPAIGN_CREDITS = 5736`. New `tools/src/campaign_credits.test.ts` reads `playtest.ts` as TEXT and
  requires `CAMPAIGN_CREDITS === LADDER_CREDITS`, the way `units/missiles.ts`' copied `PROJ_SPEED` is
  pinned against `tuning.ts`. Every later ladder re-pin (F1–F4) then moves this constant in the same
  commit, or goes red.
- [ ] **Step 2:** the two `> LIFETIME_CREDITS` branches in `unitItem`/`tierItem` are removed for
  credit items; a bought-only item priced above one campaign reads `locked` with a new honest line
  `{ kind: 'campaigns', n }` (n = whole campaigns at `CAMPAIGN_CREDITS`, computed, never copy):
  "About 2 campaigns of play" for the gunship. `stores-model.test.ts`'s gunship case changes from
  `unreachable` to that.
- [ ] **Step 3:** `debrief.credits.none` → "no improvement on your best this campaign, nothing paid".
  The brigade screen's account card names the per-campaign rule where it names "survives a new
  campaign". `pnpm validate:ui` and a `--pseudo` `ui:shots` pass of the store and debrief.
- **Falsify:** (a) set `CAMPAIGN_CREDITS = 5849` → the text pin red; (b) restore the `offSale` branch
  → the gunship case red; (c) hard-code n = 2 → a test with a 12,000 item expecting 3 goes red.
- **Gates:** `pnpm test`, `pnpm validate:ui`, `pnpm typecheck`, `pnpm lint`.

## Task 6: the harness walks two campaigns through the real `payMission`

`playtest.ts` today sums `creditsFor` per winning plan; it never calls `payMission`, so it cannot see
this change. The walk is added as **relations to `LADDER_CREDITS`, not a new pinned number**, so no
later plan has a second figure to chase.

- [ ] **Step 1:** after the ladder sum, replay the recorded per-mission values in `world.json` order
  through `payMission` (imported from `packages/app/src/brigade-account.ts`, as the ui-review tools
  already import app modules), with `missionOpen` deciding the scope against a ledger built up in the
  same order: campaign 1, `startCampaign`, campaign 2. Assert, in the `LADDER_CREDITS` idiom (`!==`,
  `console.error`, `process.exitCode = 1`):
  - campaign 1 pays exactly `LADDER_CREDITS`;
  - replaying every mission again inside campaign 1 pays **0** (D2);
  - campaign 2 pays exactly `LADDER_CREDITS` (base tier);
  - the openers loop is visible and bounded: after a third `startCampaign` with an empty ledger,
    `khan_rafid_1_recon` (a town opener, so open) pays its value once and then 0 until the next
    `startCampaign`. G-A does not stop this loop, by design; D3 is the lead's.
- [ ] **Step 2: Report lines, not pins.** Print `credits: campaign 2 at max tier N` from the max-tier
  pass's credits (5,859 at `434cad99`), and `catalogue: <shipped JSON total> credits, <n> campaigns at
  base tier, <m> at max tier`, read from `data/units/kdf/*.json` and the staged E5 JSON. These are the
  numbers the coin design quotes; they move with F1–F4 and are not gated.
- [ ] **Step 3: Farming report.** Print credits per plan-minute for every winning plan and the
  openers-loop and full-campaign rates (the table above), labelled "plan clock: an upper bound on a
  player". Not a gate (a threshold on it would be a fitted number).
- **Falsify:** (a) revert Task 4 Step 1's semantics in the harness by skipping `startCampaign` →
  campaign 2 pays 0, red; (b) make `payMission` ignore the scope → the in-campaign replay pays
  5,736, red; (c) make `missionOpen` always true → nothing here goes red by construction (every
  mission is walked in order), which is why Task 3 Step 3 owns G-A; state that in the commit.
- **Gates:** `pnpm playtest` exit 0 with `credit ladder: 5736` unchanged; `pnpm balance` unchanged;
  `pnpm test:determinism` unchanged (no sim file touched).

## Task 7: the record

- [ ] The coin design §1.2 and §5 D3: R1 landed, the numbers above, G-A and the D3 ruling.
- [ ] `CLAUDE.md`'s brigade-account paragraph: "a victory pays only for improvement over what that
  mission paid before" → "... over what it has paid in THIS campaign; the lifetime best is kept
  beside it". Name G-A and the `?fresh` mission-path caveat.
- [ ] The Stage 4 order: #330 moves no pin (see below).
- **Gates:** `pnpm lint` (markdown is not linted; this is the check that nothing else changed).

---

## Re-pins

| pin | moves? | why |
|---|---|---|
| sim pins (`determinism.test.ts`, flat and relief) | **no** | no sim file |
| `pnpm balance` §5.7 win rates | **no** | no combat change |
| `LADDER_CREDITS` (5736) | **no** | one campaign's values are unchanged; the reset changes what a SECOND campaign pays |
| `GATES`, roster pins | **no** | no outcome moves |
| `CAMPAIGN_CREDITS` (new, app) | born at 5736 | tied to `LADDER_CREDITS` by text, so it moves only with it |
| economy pins (F1's `ECONOMY_PIN*`) | not born yet | — |

## Placement in the Stage 4 order, and F1–F4

- **#330 is not a Lane C change.** It edits `packages/app` and `tools`, never `packages/sim`, and
  moves no pin. The order's 4 Nov slot expected a `credits.ts` edit and one `LADDER_CREDITS` re-pin;
  neither happens. **Decision for the lead (D6): land it in October, before Stage 4 opens**, through
  Lane A's app review, which also frees 4 Nov for F1. The G3 sheet's "first or last, never folded
  into a G-F plan" is satisfied either way: it is still first and still its own PR.
- **F1–F4 re-pin `LADDER_CREDITS` exactly as their plans say**, and each such commit also moves
  `CAMPAIGN_CREDITS` (Task 5's text pin forces it). The two-campaign walk is relative, so it follows
  for free: a ladder that moves to N makes campaign 2 pay N.
- **F2 (held-ground income) and F4 (production) pay into the mission purse, not the brigade
  account.** Neither touches `payMission`. If a later plan makes purse income feed credits, it must
  go through `payMission`'s scope too, or it reopens the farm this plan closes.
- **F1's `INTEL_WINNERS_ONE_SWEEP`** and F3's L-1 can move a grade or `unitHome`, hence a mission's
  value, hence the ladder: same rule as above, nothing new.
- After F4, re-run Task 6's catalogue and farming report and quote it on #330 and #183 (the
  campaigns-to-catalogue figure the coin design and G1 cite).
