# A ranked 1v1 queue: rating, leaver penalty, matchmaking (GH-1399) — design for the lead

**Date:** 2026-11-17 · **Status:** HOLD FOR LEAD. Docs only: no code, no migration file, no config, no deploy, nothing run against
Cloudflare. GH-1399 itself is blocked until the lead unparks sim balance, and the queue must not open before GH-205; this note is
the design that work would follow, so the rulings can come before the slices.
**Builds on (does not replace):** the public matchmaking design (`2026-10-28-public-matchmaking-design.md`, "the PM design"; the
lead's ruling on GH-687 of 28 Oct: park it, and if built, pair strangers on a hidden server-held rating from agreed results, matched
kit, 12 public matches a day on Free, a no-deploy kill switch). What changed since: accounts exist (GH-1075 A1 to A3, Google sign-in),
versus records are written from agreed results only (`recordOf`), and the relay is being split into its own Worker (GH-1397).
**Reads against:** `origin/dev` `e049ba7`; `packages/worker/src/match/{room-core,match-room,record,routes,desync-log}.ts`;
`packages/worker/src/account/{tables,sweep,config}.ts`; `packages/worker/src/cron-budget.test.ts`; `packages/worker/src/privacy-page.ts`;
`packages/worker/migrations-accounts/0001..0004`; `packages/net/src/{config,protocol,ws-transport}.ts`; the relay split design
(`2026-11-15-relay-worker-split-design.md`, as rewritten to the hard cut in PR 1482, `fc98475`) and its implementation in PR 1550
(`claude/gh1397-relay-split`, `97c4b54`); `docs/agent-notes/shell-and-ui.md` ("Accounts A1", "Accounts A3"); GH-954 (arena); GH-205; GH-687.

Issues are written GH-NNN and pull requests "PR NNN".

---

## 0. In one page

1. **Rating: Glicko-2, updated after every game, hidden.** On the same seeded simulation a new player's mean error falls under 100
   rating points after **8** games with Glicko-2, against **23 to 27** for the Elo variants worth considering, and in a small pool
   with churn and improving players Elo **deflates by 60 to 80 points** over 180 days where Glicko-2 stays within about 30 (§1.3).
   Ten placement games before a visible rank; the visible rank is the conservative `r − 2·RD`, so idling lowers it and play restores
   it, with no rating decay that moves points (§1.5).
2. **Leaving is a loss, and leaving badly also costs queue time.** The room already tells a deliberate leave (`bye`) from a drop (a
   socket that closes and does not return within `FORFEIT_MS`, 60 s). Ranked adds two facts the room can see today but discards
   (the close code, and whether both seats dropped together) and one rule: **a seat that leaves before 3 minutes loses rating, and
   its opponent gains none**, which is what stops win trading through instant leaves. Incidents earn points; points buy a lock from
   5 minutes to 72 hours; a point fades every 48 hours and with every completed ranked match (§2).
3. **A finding to fix first.** Under A3's `recordOf`, a loser whose client withholds its `over` report and then leaves turns the
   winner's agreed win into an unconfirmed claim, so in ranked it would escape the loss. Ranked needs its own pure rule,
   `rankedOutcomeOf`, beside `recordOf`, with an end table that has no such hole (§2.2). A3's W-L record can stay as it is (Q4).
4. **One matchmaker Durable Object, `Matchmaker`, in the GAME Worker**, minting rooms in the relay through the same `roomsOf(env)` as
   every match route, so the `ROOMS_NEW` lever of the relay split covers ranked rooms too. Blind accept (no opponent, map or rating
   shown before both accept), a rating band that widens with waiting, region as a soft preference only, and two seats from one
   network address never paired (§3).
5. **KDF v Sarim is not ranked in season 1.** The mirror is fair by construction once seats are drawn at random. A faction cell joins
   ranked later with a per-cell advantage term in the expected score (the chess white-advantage idea), once the lead unparks balance
   (§3.4, Q5).
6. **Two member tables and one season table on ACCOUNTS** (§4, the SQL). The deletion cascade must remove them, and the cron pin
   (`cron-budget.test.ts`: 48 of 50 statements in the worst run) leaves room for **one** more delete statement, not two. So the two
   member tables are removed by `ON DELETE CASCADE` from `member`, listed in `MEMBER_TABLES` as cascade rows with a test that proves
   the cascade (§4.4, Q11).
7. **Cost is the matches, not the rating.** A ranked match adds about 12 D1 rows written and 7 read to a match that writes 1,440 to
   2,640 Durable Object rows. The rating adds **zero** statements to the daily cron (every season and decay rule is lazy). The ceiling
   stays the PM design's 12 public matches a day on Free (§7).
8. **Nineteen questions for the lead** (§9). The ones that carry the most weight: Q1 (is the A3 agreed path the "server-authoritative
   path" GH-1399 asks for), Q5 (no KDF v Sarim in season 1), Q8 (ranked requires a Google or Steam identity), Q11 (cascade deletion).

### 0.1 What exists today (facts this design stands on)

| Fact | Where |
|---|---|
| A versus record is written once, by the room, into `match_record` + two `match_seat` rows on ACCOUNTS, only when at least one seat is a member; `agreed = 1` means both seats reported the same `over{tick, result}` with a compared hash pair within one cadence, or the room decided it (`surrender`, `forfeit`, a started `left`) with no settled report | `room-core.ts` `recordOf`, `record.ts` `writeMatchRecord` |
| A lone report is written `agreed = 0`; two reports that differ void the record; `void` and `expired` write nothing | `recordOf` |
| `bye` in a started match ends it `left`, naming the leaver; the client sends `bye` only from `transport.close()` (a deliberate leave), never from `detach()` (a reload or a hand-off) | `room-core.ts:413`, `ws-transport.ts:449-462` |
| A seat disconnected for `FORFEIT_MS` (60 s) loses (`forfeit`); a reconnect inside it cancels the clock; both seats gone at the **same instant** (a deploy, `reconcileSockets`) voids | `forfeitIfDue`, `protocol.ts:45` |
| A hash mismatch voids the match and writes a `match_desync` row (config + compacted frames, ≤ 256,000 chars, ≤ 50 rows a day) to the telemetry `DB` | `room-core.ts:411`, `desync-log.ts` |
| An `over` is accepted only on a hash-window tick, once per seat, for a minted tick | `room-core.ts:461` |
| `webSocketClose(ws)` reads no close code | `match-room.ts:1209` |
| The seat's member comes from the session cookie (`seatMemberOf`) in `routes.ts`, never from the body | "Accounts A3" |
| The relay Worker (`roaring-lions-relay`) will host `MatchRoom` only; every `/api/match*` route stays in the game Worker and reaches the class through `roomsOf(env)`; `ROOMS_NEW=0` with `ROOMS_LEGACY` bound is the no-deploy rollback | relay design §4, §7; PR 1550 R2 |
| The relay's watch paths include `packages/sim/src/*`, so every sim or tuning PR redeploys the relay | PR 1550, "For the lead" |
| One `scheduled()` run is held to 50 D1 statements (a batch counted per statement, stricter than the platform); the static worst case is pinned at **48**, of which the account cron is `ACCOUNT_CRON_STATEMENTS` = 5 + 1 + 3 + 17 + 1 = 27, and the member delete batch is 17 statements | `cron-budget.test.ts`, `account/sweep.ts:32`, `account/tables.ts` |
| D1 enforces foreign keys; the delete path nevertheless deletes table by table, child first | `0001_members.sql` header, `tables.ts` |
| A deletion writes the KV tombstone `tomb:<sha256(public_id)>` (90 days) first, then one D1 batch | "Accounts A1" |
| The whole account holds about 38 busy 20-minute matches a day on Free (DO SQLite rows written are the binding limit) | PM design §3.1 |
| Versus maps: `VERSUS_FAIR_MAPS` (7); a KDF v Sarim pairing only on `FACTION_MATCHUP_MAPS` (`tel_marum`, `wadi_tarfan`, `wadi_tarfan_l`), each read inside 60/40 by the bot probes; `Matchup` has no Sarim mirror | `packages/net/src/config.ts:330-455` |
| Quick chat (preset phrase ids) is "the only chat a future public room would allow" | `protocol.ts:22` |

## 1. The rating system

### 1.1 The population this has to work for

There is no measured ranked population, so the design is sized for the one that the budgets and the lead's own words imply:

- **"Players are a handful"** (the lead, D-R1 of GH-1397, 16 Nov). Accounts have been on by default on the real host since 13 Nov.
- **The Free plan caps ranked at about 12 matches a day** (PM design §3.1, ruled on GH-687): 24 player-games a day, whoever plays them.
- **So the working assumption is 10 to 50 ranked members in season 1, about 30 active**, at about 0.8 ranked games a member a day.
  Everything below is checked at that size. A larger population only makes each choice safer.

Three things go wrong with ratings in a pool that small, and each choice below answers one of them:

| Problem in a small pool | What it does | Answer |
|---|---|---|
| **Slow convergence** | at 0.8 games a day, a system that needs 25 games to place a player needs a month | a system that is confident about how unsure it is (RD), §1.3 |
| **Deflation and inflation** | in a zero-sum system, points that improving players win are taken from the pool, and points that weak newcomers lose stay in it when they quit; with few players nothing averages it out | not zero-sum: an established player barely moves against a newcomer, §1.3 |
| **A rank on too little evidence** | after 3 games a lucky newcomer can sit at the top of a 30-player list | ten placement games, and a visible rank on `r − 2·RD`, §1.5 |

### 1.2 The candidates

| | Elo | Glicko-2 |
|---|---|---|
| State per player | rating `r` | rating `r`, deviation `RD` (how unsure the rating is), volatility `σ` (how erratic the player is) |
| Update | `r += K · (S − E)`, `E = 1 / (1 + 10^((r_opp − r)/400))` | Glickman's algorithm (his note "Example of the Glicko-2 system"): a step scaled by the player's own RD and discounted by the opponent's |
| New player | starts at 1500; a provisional K (e.g. 40 for 20 games) is the only lever | starts at 1500, RD 350: the first games move them a lot, and their opponents very little |
| Idle player | unchanged | RD grows back with idle time, so the next games move them more |
| Zero-sum | yes, which is what drifts in a small pool | no |
| Cost | trivial | trivial: about ten iterations of a root find per update, microseconds of CPU, well inside the Free 10 ms |
| Used by | chess federations | Lichess runs Glicko-2 with an update after every game, the shape recommended here |

**Choices for each.**
- **Elo:** a flat K = 32 (common online); a provisional K = 40 for 20 games, then 20 (the FIDE shape); a flat K = 16 (slow and stable).
- **Glicko-2:** `r₀` 1500, `RD₀` 350, `σ₀` 0.06, `τ` 0.5 (Glickman's middle value; τ 0.3 gave identical numbers below, because volatility
  hardly moves on consistent results), `RD` capped at 350 and floored at 45, **one game per rating period**, and RD inflated before each
  update by idle **days**: `RD* = min(350, √(RD² + c²·days))` with `c = 14.4` rating points per √day. Glicko-2's own `σ` growth is per
  rating period, so with a game per period an idle player's RD would never grow; the day term replaces it. With `c = 14.4`, an RD of 50
  grows to 63 after a week idle, 93 after 30 days, 145 after 90 and 200 after 180 (chosen so that half a year away is "unsure again").

### 1.3 Worked numbers

**Method.** A seeded Monte Carlo (`random.Random(1399)` and `(7)`, 4,000 runs a row; a scratch script, not committed): a new player of
true strength 1800 (or 1200) starts at 1500 and plays opponents the matchmaker finds at exactly their current rating, each opponent
rated correctly with RD 60. The true win chance is the logistic of the true difference. The Glicko-2 implementation reproduces
Glickman's published example to the last digit (r′ 1464.05, RD′ 151.52, σ′ 0.05999, which slice K1's literal test pins).

**Convergence for a new player** (true 1800 from 1500; the 1200 case is the mirror image to within 2 points):

| System | Mean error after 5 / 10 / 20 / 40 / 60 games | Games until mean error < 150 / < 100 / < 60 | RD after 10 / 20 / 60 |
|---|---|---|---|
| Elo K = 32 | 247 / 201 / 130 / 62 / 47 | 17 / 27 / 41 | — |
| Elo K = 40 for 20 games, then 20 | 235 / 180 / 105 / 64 / 44 | 14 / 23 / 44 | — |
| Elo K = 16 | 273 / 247 / 202 / 131 / 84 | 34 / 52 / 76 | — |
| **Glicko-2** (τ 0.5 or 0.3) | **122 / 87 / 63 / 46 / 39** | **2 / 8 / 23** | **108 / 81 / 62** |

At 0.8 games a day: Glicko-2 places a new player within 100 points in about **10 days**; Elo K = 32 in about **34 days**.

**What a single game moves** (Glicko-2):

| Game | Before | After |
|---|---|---|
| A newcomer's first game, a win, against 1500/60 | 1500 / RD 350 | **1675** / RD 249 (a loss: 1325) |
| The established opponent of that game, losing it | 1500 / RD 60 | **1493** (a win: 1507), RD 60 |
| A player after 10 games beats an equal | 1600 / RD 108 | 1630 / RD 104 |
| Two established players, even game | 1500 / RD ≈ 60 (the steady state of a game a period) | ±10.1 |
| An established 1500 loses to an established 1300 | 1500 / RD 60 | 1484 |

The second row is the whole case for Glicko-2 in a small pool: the newcomer moves 175 points and the established player 7, so a
newcomer's early luck does not leak into everyone else's number.

**Drift in a small pool.** The same script runs a pool of 30 players (true strengths N(1500, 200)) for 180 days at the 12-matches-a-day
cap, each pairing at the nearest rating. Every second day the weakest of a noisy draw quits and a newcomer of true strength N(1350, 150)
arrives at 1500 (newcomers are weaker, and weak players quit), and every player improves 1.5 points a game for their first 100 games.
Forty seeds; the number is the mean of `rating − true` over players with at least 10 games:

| | Day 30 | Day 90 | Day 180 |
|---|---|---|---|
| Elo K = 32 | **−72** | **−79** | **−60** |
| Glicko-2 (with the idle term) | −4 | +4 | +31 |

Elo deflates because improvement is paid for out of the pool and the pool is too small to refill it. Glicko-2's slight late inflation
is the departing newcomers' points not all coming back; at +31 over half a year it is well inside one season's RD floor (§1.6).

### 1.4 Recommendation

**Glicko-2, as parameterised in §1.2, updated after every ranked game, held by the server, hidden.** Elo would need a month of play
to place a new player in this pool and drifts by more than a player's own RD over a season. The PM design reached the same choice and
the lead's ruling on GH-687 already says "a hidden server-held rating"; this section is the numbers behind it.

Two rules on top of plain Glicko-2, both used again in §2 and §5:
- **A weight per game, `w` in [0, 1].** The update's sums (`Σ g²E(1−E)` and `Σ g(S − E)`) are multiplied by `w`, so a game of weight
  0.5 counts as half a game, and weight 0 changes nothing but is still journaled. It is how repeat pairs are damped (§5.1) and how an
  early leave rates one side only (§2.3).
- **An advantage term, `a`, per cell** (a map, a room kind and which faction holds which seat): `E = 1 / (1 + exp(−g(φ_opp)·(μ + a − μ_opp)))`
  for the side the cell favours and `−a` for the other. It is 0 for every mirror cell, which is all of season 1 (§3.4).

The maths runs in the Worker in ordinary JavaScript doubles. It is not the sim: none of the four invariants applies, and the journal
stores every input and output, so any update can be re-derived and checked.

### 1.5 Provisional period, minimum games and the visible rank

- **Placement: 10 games.** Until then the player sees "Placement 4 of 10" and no rank. At 10 games the simulated mean error is 87
  points and RD about 108. Lichess calls a rating provisional above RD 110 for the same reason. Ten is reached in about two weeks at
  0.8 games a day; Q13 asks whether that is too long.
- **The visible rank is `r − 2·RD`** (a conservative estimate: the player is very likely at least this good), cut into named bands
  shown through `t('ranked.band.<id>')`. A player cannot rise by playing less, and a lucky streak at high RD shows less than it seems.
- **No rating decay that moves points.** Idle time grows RD (§1.2), which lowers the visible rank by about 2 × 33 = 66 points after a
  month away and gives it back within a few games. The number itself never changes without a game. That is the "decay", and it costs
  no write and no cron (it is computed at read time from `last_game_at`).
- **The number is never shown**, to the player or anyone else, in season 1. The player sees their band and their placement progress.
  The PM design's Q10 recommended the same; Q12 asks again, with accounts now existing.

### 1.6 Seasons

- **A season is a row in `ranked_season`** (§4): an id, a start, an optional end, and the RD floor its start applies. Season 1 has no
  end date until the lead sets one (Q14); the recommendation for later seasons is 12 weeks.
- **The reset is soft and lazy.** At a season's start nothing runs. The first time a member's row is read in a new season (their next
  queue join, or the profile), the read applies the reset in the same batch as anything else it writes: the season's counters move into
  one journal row of kind `season` (the final rating, RD, games, wins and best visible rank), `RD` is raised to at least the season's
  floor (recommended 120), and `r` is **kept**. A member who never returns keeps their last season's row as it was, which is itself the
  season result. So a season change adds no statement to the daily cron (§7.3).
- **Why not pull ratings toward 1500.** In a pool of 30, a pull to the mean throws away the only evidence there is and makes everyone
  re-place against each other at once. Raising RD to 120 lets three to five games correct a rating that has gone stale, at no cost to
  a rating that has not.

## 2. The leaver penalty

### 2.1 Telling a disconnect from a quit

The Worker cannot know intent. It can know five facts, three of which exist today:

| Fact | Today | What ranked adds |
|---|---|---|
| **`bye`**: the client said it is leaving | yes: only `transport.close()` sends it, the deliberate leave; a reload or a hand-off uses `detach()`, which does not | nothing |
| **A reconnect inside `FORFEIT_MS`** | yes: it cancels the forfeit clock completely | nothing: a reload, a wifi blip or a laptop lid under 60 s is no incident at all |
| **How the socket closed** | read nowhere: `webSocketClose(ws)` ignores its arguments | record, per seat and in memory, `goneHow`: `clean` for code 1000 or 1001 with `wasClean` (a tab or window closed, a navigation away), `lost` for anything else (1006, an error, or the room's own silent-stall detection, `STALL_SILENT_MS` 2 s, seeing the seat go quiet first) |
| **Both seats gone together** | voids only on the **same instant** (`reconcileSockets` after a restart) | ranked also voids when the two seats went within `INFRA_WINDOW_MS` (5 s) of each other, or the room was revived from storage and reconciled its sockets: an outage or a relay deploy, nobody's fault |
| **The result reports and the hash pair** | yes: `over{tick, result}` per seat and `lastHashTick` | the end table below, and an `OVER_CONFIRM_MS` (10 s) wait for the second report (§2.2, row J) |

So a deliberate quit is `bye` or `surrender`; an abandon is a `clean` close that does not come back; a drop is a `lost` close that does
not come back. The residual error is known and small: a player who pulls a cable reads as a drop, and a crash reads as a drop. Both
are one point apart on the ladder (§2.4), and both still lose the match, as the lead ruled on 13 Oct ("the player who drops loses").

### 2.2 The end table: `rankedOutcomeOf`

**The finding.** `recordOf` (A3) treats one case in a way ranked cannot use. If seat X reports `over` naming itself the winner and seat
Y, which has not reported, then leaves or forfeits, the record is X's **unconfirmed** claim (`agreed = 0`), not the room's own decision
that the leaver loses: `lone` is tested before `gaveUp` (`room-core.ts:714-723`). An honest client reports `over` automatically on the
hash-window tick where its sim decides, before its player can react, so the losing seat that never reports is a modified client (or a
crash in the same second). Under A3's rule, that client turns its loss into an unrated match by withholding one message and leaving.
For W-L this was a deliberate, conservative choice; for a rating it is a hole.

**The rule.** A pure `rankedOutcomeOf(st, seatFacts)` in `room-core.ts`, beside `recordOf` and in its style (no effect, no I/O, called
once the room has ended). Its result is `{rated: [w0, w1] | null, winner, incident: [class | null, class | null], dispute: boolean}`.
`EARLY_TICKS` is 3,600 (three minutes at 20 Hz): before it, a game is no evidence of the remaining player's skill.

| # | How the ranked match ended | Rating | Incident (§2.4) |
|---|---|---|---|
| A | Both seats reported the same `over` tick and result, with a fresh compared hash (A3's agreed rule) | rated, weight `w` (repeat damping, §5.1) | none |
| B | The reports differ, or the hashes differ (a desync) | **void** for both: a `void` journal row of weight 0 each | none, but a **dispute** for both (§5.3) |
| C | X surrendered at or after `EARLY_TICKS` | X loses, Y wins, weight `w` | none: conceding is what ranked wants players to do |
| D | X left (`bye`) at or after `EARLY_TICKS`, X had not reported `over` | as C | none (Q6 asks whether it should be 1 point) |
| E | X forfeited (gone 60 s), `goneHow` = `clean` | X loses, Y wins, weight `w` | X: **abandon** |
| F | X forfeited, `goneHow` = `lost` | as E | X: **drop** |
| G | X ended it before `EARLY_TICKS` by any of C to F | X loses at weight 1; **Y unchanged** (a weight-0 row: "no contest") | X: **early** (a `lost` forfeit: **drop**) |
| H | Both seats gone within `INFRA_WINDOW_MS`, or the room was revived and reconciled both | **void** | none |
| I | X reported `over` naming X the winner; Y never reported and then left, forfeited or was gone at the close | **X wins, Y loses**, weight `w` (the room's own decision, which the claim agrees with) | Y: by its exit, abandon or drop |
| I′ | As I, but X's claim names **Y** the winner | **void** (the claim and the room disagree) | dispute for both |
| J | X reported `over`; Y is still connected and acking but has not reported within `OVER_CONFIRM_MS` (10 s) | **void, disputed**: the room cannot tell X forging from Y withholding without running the sim | dispute for both; the evidence row is written (§5.3) |
| K | X reported `over`, then X left before Y reported | X's exit is **not** a leave (X was done); Y's report or silence decides, as A or J | none for X |
| L | After both accepted, a seat never said `hello` within `NOSHOW_MS` (30 s), or left during the face-off before tick 0 | none: no game was played | the absent or leaving seat: **dodge** (no-show) or **early** (face-off exit) |
| M | `expired` (the 6 h TTL), or the room voided its own log (#559 H-1) | void | none |

Rows I and J are what close the hole: a withheld report either matches the room's decision (I, rated) or makes the match a dispute
that nobody gains from (J). The match cap is not a row of its own: both sims decide it on a hash tick and report it, which is row A.

The room writes rows A to K in **one D1 batch** on ACCOUNTS, in its own invocation (the relay's; §7.2): the record and seats as today,
the two `ranked_member` updates, the two `rating_journal` rows and the incident points. Row L is written by the room at the no-show
deadline; a decline (§2.4) by the matchmaker.

### 2.3 The rating effect

- **A leave is an ordinary loss: `S = 0`, weight 1.** No extra points are taken. The rating stays an estimate of skill, which is what
  makes it useful for pairing; the penalty for leaving badly is time, not rating (§2.4). An extra point penalty would also make
  a leaver's rating wrong in the direction that sends them to easier opponents, which is the opposite of a penalty.
- **The opponent of an early leaver gains nothing** (row G). That is the rule that stops two accounts trading a win a minute by
  leaving at once, and it costs an honest opponent at most three minutes. The leaver still loses at full weight, so a trade is a pure
  loss for whoever gives the win.
- **A void, a dispute, a no-show and an infrastructure drop move no rating.** They are journaled at weight 0 so the history is whole.

### 2.4 Incidents, the cooldown ladder and decay

**Points per incident:** early exit 2, abandon 2, drop 1, dodge 1 (a decline at `found`, letting the 15 s accept lapse while the queue
socket is connected, or a no-show). A dispute earns no points: it is counted separately, by distinct opponent (§5.3).

**The lock is read from the points the incident leaves:**

| Points after the incident | Queue lock |
|---|---|
| 1 | none: the next queue join shows one line ("Leaving early locks the ranked queue") |
| 2 | 5 minutes |
| 3 | 15 minutes |
| 4 | 1 hour |
| 5 | 4 hours |
| 6 | 24 hours |
| 7 or more (cap 12) | 72 hours, and the member appears on the read-only ranked review list of `/stats/members` |

**Decay.** Points fall by one for every full 48 hours since the last incident, computed when they are read (`effective = max(0, points
− floor((now − leave_at) / 48 h))`, no cron), and by one for each completed ranked match (rows A, C, D and I for both seats, written in
the record batch). Only the queue reads them; an incident never changes a rating by itself.

**What it looks like.**
- A player whose wifi drops out of one match a week never locks: one point, gone in 48 hours.
- A rage-closer who closes the tab twice in an evening: 2 points (5 minutes), then 4 (1 hour).
- A dodger who declines three offers in a row: no lock, 5 minutes, 15 minutes. One clean match then takes a point off.
- The PM design's separate decline cooldown (1 minute doubling to 15, forgiven after an hour) is replaced by this one ladder, so a
  dodger and a leaver are held by the same rule.

The ladder's numbers are starting values, chosen against nothing measured; §8's gate is the first 200 ranked results, as in the PM
design.

## 3. Matchmaking inside the relay design

### 3.1 Where the queue lives: a `Matchmaker` Durable Object in the game Worker

The PM design's shape stands: **one** matchmaker object (a small pool is made smaller by sharding), hibernating WebSockets, no
`setInterval`, an alarm only for the next moment a pair can become feasible. What is new is the relay split, which makes "which
Worker hosts it" a real choice.

| | **In the game Worker** (recommended) | In the relay Worker |
|---|---|---|
| Minting rooms | through `roomsOf(env)`, like every `/api/match*` route, so the `ROOMS_NEW=0` lever moves ranked rooms with friend rooms | through the relay's own `MatchRoom` namespace, which the lever does not reach: after a flip, the game Worker's upgrade route would look for a ranked room in the legacy namespace and find nothing |
| The relay's import closure (F8) | unchanged: the relay hosts `MatchRoom` only (D-R2, PR 1550's `relay.ts`: "Keep this file to these two exports") | grows by the matchmaker; F8's ceiling and the watch paths move |
| Ticket signing | stays in the game Worker, as the relay design requires (§2.1 there) | the relay would start signing tickets |
| What a deploy costs | every merge to `main` restarts it and drops every queue socket | only a relay deploy, which is every sim or tuning PR anyway (PR 1550) |

**The cost on the left is cheap to carry.** A queue socket holds no game. On a drop the client reconnects (the same backoff as the
room's transport) and presents a **requeue token** the matchmaker gave it at join: `{enqueuedAt, nonce, mac}`, where `mac` is an HMAC
under `TICKET_SECRET` over the member id, `enqueuedAt` and the nonce. The member id is an input to the MAC and never in the token, so it
never leaves the server (A3's rule). A token younger than 10 minutes restores the waited time; anything else starts afresh. An offer in
flight at the moment of a deploy is simply lost: both players are requeued, and **neither gets a dodge**, because a dodge is written
only for a decline the object received or an accept window that lapsed while the socket stayed connected.

`wrangler.jsonc` gains a binding `QUEUE` to class `Matchmaker` and a migration `{ tag: 'mm-v1', new_sqlite_classes: ['Matchmaker'] }`
(the PM design's tag), and a rate limiter `RANKED_LIMIT`. **The PM design's namespace id 1007 is now `ACCOUNT_LIMIT`**; the next free
id is 1009.

### 3.2 The shape

```
browser ──WS /api/ranked/ws──▶ game Worker: Origin rule, RANKED_LIMIT, seatMemberOf (a member is REQUIRED), flags.ranked
                                  │   forwards the upgrade with: member id, request.cf.continent, a daily keyed hash of the address
                                  ▼
                             Matchmaker DO "mm:ranked"  (game Worker; hibernating sockets; entries live in socket attachments)
                                  │ pair → found (blind) → both accept → draw map, seats, cell
                                  │ roomsOf(env).get(idFromName(code)).fetch('https://room/create-ranked', …)   (tickets signed here)
                                  ▼
                             MatchRoom (relay Worker, `roaring-lions-relay`), ranked: true, both seats pre-assigned to members
browser ◀── matched{code, seat, ticket} ── queue socket closed ── room socket opened (today's path, net/handoff.ts)
```

- **The member comes from the cookie, never the body** (A3 §0.13). A guest gets `closed{reason: 'signin'}`.
- **What travels to the object** is three fields set by the game Worker, never by the client: the internal member id, the coarse
  continent (`request.cf.continent`), and `netKey`, the day's keyed hash of the connecting address made with the same `ipSecret` the
  account budgets already use. All three live in the socket attachment for the length of the wait and are **never written to storage**.
- **What the client sends** in `join` is rebuilt field by field: `build`, `sides` (season 1: KDF only, §3.4), `veto` (at most one map),
  and the requeue token if it has one. No callsign: the room shows the profile's display name, as A3 already does for members.
- **Messages to the client:** `queued{position: 'few' | 'some' | 'many'}`, `band{stage}`, `found{deadline}`, `matched{code, seat, ticket}`,
  `requeued`, and `closed{reason, until?}` with reasons `cap`, `switch`, `full`, `build`, `locked`, `busy` (already in a ranked match),
  `signin`, `identity` (Q8) and `new` (Q9).
- **Eligibility at join** costs one D1 read on ACCOUNTS (`ranked_member`, the member's providers and `created_at` in one query): the
  lock, `active_code` (a member in a live ranked room cannot queue; the profile offers "Rejoin your ranked match" instead), the season's
  lazy reset (§1.6), Q8 and Q9.

### 3.3 Pairing and the widening band

**Feasible pair.** Two entries pair only when: their builds match (the room would refuse a mismatch anyway); their `netKey`s differ (two
seats from one address are never paired, §5.1); neither is the other's previous ranked opponent, unless nobody else has been feasible
for 60 s; and the rating gap fits **both** entries' bands. Each entry's band is the PM design's (`max(100, RD)`, `max(200, RD)`,
`max(400, RD)`, `max(700, RD)` at 0, 15, 30 and 60 s), with one change for ranked: **"unbounded" after 120 s is replaced by a floor on
the weaker player's expected score**, 0.10 after 120 s and 0.05 after 300 s. At established RDs that is a gap of about 380 and 510
points. A pairing the rating predicts at 97 to 3 teaches the rating nothing and the weaker player only that ranked is not for them.

**Choosing among feasible pairs:** the smallest gap, and inside the first 30 s, a pair on one continent before one across two. Region is
never a hard filter (the PM design's P3 rule).

**Pairing is not instant.** After the event that makes a pair feasible, the object pairs at an alarm set 2 to 6 s later, at a random
point, among every entry then feasible. One alarm per pairing is already in the PM design's budget (§7.2). It is what makes timing a join
to catch one particular player unreliable (§5.5).

**What a player waits, in this pool.** Thirty members who each queue twice an evening, spread over six evening hours, arrive at about ten
an hour: a lone searcher waits about six minutes on average for the next arrival, and with the band at its 120 s floor nearly any two of
them are feasible. The screen therefore says what it knows ("Widening the search", "Few players are searching now"), and Q15 asks
whether a fixed "ranked hour" would serve a pool this small better.

**Daily cap and kill switch.** The PM design's public-match cap (12 a day, counted in the object's storage, `closed{cap, until}`) and its
total-rooms breaker apply to ranked, which is the only public queue. The kill switch is a `flags` row on ACCOUNTS, `ranked`, read at
join with a 60 s cache in memory: `'open'` opens it, anything else including no row is closed, as `accounts`, `admin` and `records`
already behave. Closing it needs no deploy and leaves rooms already minted to finish and be rated.

### 3.4 Which map, which faction, and the KDF v Sarim asymmetry

**Season 1 is the mirror only: KDF against KDF.**
- **Maps:** the 25-minute fair maps, `beit_sahwan_outskirts`, `tel_marum`, `wadi_tarfan` and `milh_flats`. The three 35-minute large maps
  cost 1.4 times the rows of a match (§7) and are out of season 1 (Q16).
- **Rules:** placed forces, annihilation (no win mode), matched kit, `pace: realtime`, formations as `formationsOpenIn` says for a
  mirror room. One rule set, so a rating means one thing (Q16).
- **The map is drawn** uniformly from the pool minus each player's one veto (a veto can never empty it), and **shown only at the
  face-off**, after both accepted (§5.4).
- **The seats are drawn at random.** The mirror's measured seat lean (wadi_tarfan west 45 / east 51 at 96 seeds, inside the lead's
  60/40) then falls on each player half the time, and the rating's advantage term for a mirror cell is 0.

**Why not KDF v Sarim yet.** The faction cells were opened for friend rooms on bot probes reading "within 60/40": wadi_tarfan's placed
cell is "Sarim-friendly about 56 pooled over 768" (`config.ts:376`). In rating terms an edge of `p` is `400·log10(p / (1 − p))` points:

| Edge | 52/48 | 56/44 | 60/40 |
|---|---|---|---|
| Rating points | 14 | **42** | **70** |

A steady-state game moves a rating about 10 points (§1.3), so an unadjusted 56/44 cell would carry a Sarim specialist about 40 points
above their skill, permanently. GH-1399 says the same in product terms ("ranked play makes seat bias a product defect").

**The options when the lead unparks balance (Q5):**

| Option | How | Cost |
|---|---|---|
| **(a) Mirror only** (season 1, recommended) | no faction cell in the pool | Sarim is not ranked |
| **(b) A faction cell with an advantage term** (recommended next) | §1.4's `a`: start at the probe's value shrunk halfway to 0 (bot readings are not human readings), journal it with every game, refit per cell at a season's end by a logistic fit of the residuals, published in the PR that changes it | at 12 matches a day the evidence is slow: a cell's win rate is ±7 points at 95% after 200 games and ±3.5 after 800, i.e. ±50 and ±24 rating points, so `a` leans on the probe for months |
| (c) A rating per faction | two numbers per member | halves the evidence in a pool of 30; rejected |
| (d) A ranked set: two games, sides swapped | the asymmetry cancels exactly | twice the rows and the time of a match; possible later, on the paid plan |

When a faction cell opens, each player ticks KDF, Sarim or both, and the queue never seats a player on a side they did not tick
(the PM design's standing rule). Sarim v Sarim does not exist (`Matchup` has no Sarim mirror).

### 3.5 How a match room is minted from the queue

1. **Pair.** Both entries get `found{deadline}` with 15 s to accept, and **nothing else**: no opponent, rating, map or side.
2. **Both accept.** A decline or a lapsed window while connected is a dodge (§2.4); the one who accepted is requeued with the waited time
   kept.
3. **Draw.** The object draws the map, the seats and (later) the cell with a random source tests can inject (the Worker, not the sim).
4. **Mint.** It mints a code with the existing `match/code.ts` and calls the room through `roomsOf(env)`, with
   `locationHint` from the pair's continents (one continent: its hint; two: the table's choice for the pair), at the internal path
   `https://room/create-ranked`. The request carries, field by field: the map, the factions by seat, `kit: 'matched'`,
   `pace: 'realtime'`, the build, `ranked: {season, cell, adv, offerId}`, and both seats' `SeatMemberInfo` (as `routes.ts` builds it
   today). A room that already exists answers 409, and the object mints again, at most three times.
5. **Tickets.** The object signs both seat tickets with `TICKET_SECRET` (it runs in the game Worker, where signing stays) and writes
   both members' `active_code` in one batch.
6. **Hand-off.** Each socket gets `matched{code, seat, ticket}` and is closed; the page opens the room socket through the existing
   hand-off (`net/handoff.ts`) and shows the lobby read-only as a 10 s face-off: both display names, the map, the sides. No Ready
   step: accepting was the ready.
7. **The member must match.** The upgrade route resolves the cookie's member as it does for create and join, and a ranked room
   refuses a `hello` whose member is not the seat's (`ranked_member_mismatch`). A leaked ticket is useless.
8. **What a ranked room refuses:** `/join` (both seats are assigned), `/advisor` in either scope (an `assist` advisor is an AI playing a
   seat), `kit: 'brigade'` (never in a public or ranked room, network design decision 5), a seat of kind `bot`, and free-text chat
   (quick chat only, the use `protocol.ts` names for it). Pauses: one of 60 s a seat (the PM design's Q5; Q17 here).
9. **The end** is §2.2, written in one batch that also clears both `active_code`s. A room that never starts (row L) clears them at its
   own end. `active_code` older than `ROOM_TTL_MS` is ignored when read, so a lost write cannot strand a member.

## 4. The D1 schema and the migration plan (ACCOUNTS)

**Nothing here is a migration file, and nothing has been run.** The SQL below is what slice K2 would add as
`packages/worker/migrations-accounts/0005_ranked.sql`, applied by the lead before its PR merges (merging deploys), exactly as
`0001` to `0004` were. It adds three tables and one column, rebuilds nothing, and needs no `defer_foreign_keys`.

### 4.1 The SQL

```sql
-- GH-1399 K2 (spec 2026-11-17-ranked-queue-design.md §4). Applied to production by the LEAD before the PR merges (merging deploys):
--   npx wrangler d1 migrations apply roaring-lions-accounts --remote
-- Three new tables and one plain ADD COLUMN: no rebuild. The two member tables are removed by ON DELETE CASCADE from member,
-- not by statements of the delete batch, because the cron pin has room for one more statement and not two (§4.4).

-- One row per season. No member data. Season 1 is inserted by the lead when ranked opens (§4.3), never by this migration.
CREATE TABLE ranked_season (
  id            INTEGER PRIMARY KEY,           -- 1, 2, ...: what ranked_member.season and the journal name
  starts_at     INTEGER NOT NULL,              -- epoch ms
  ends_at       INTEGER,                       -- NULL: open until the lead sets it
  rd_floor      INTEGER NOT NULL DEFAULT 120 CHECK (rd_floor BETWEEN 45 AND 350),   -- the lazy reset raises RD to this (§1.6)
  created_at    INTEGER NOT NULL,
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);

-- A member's ranked state: one row, so a rated game is one row written per seat. The journal below is the history.
CREATE TABLE ranked_member (
  member_id     TEXT PRIMARY KEY REFERENCES member (id) ON DELETE CASCADE,
  season        INTEGER NOT NULL REFERENCES ranked_season (id),   -- the season these counters belong to (lazy reset, §1.6)
  r             REAL NOT NULL DEFAULT 1500 CHECK (r BETWEEN 0 AND 4000),
  rd            REAL NOT NULL DEFAULT 350 CHECK (rd BETWEEN 45 AND 350),
  sigma         REAL NOT NULL DEFAULT 0.06 CHECK (sigma > 0 AND sigma < 0.2),
  games         INTEGER NOT NULL DEFAULT 0,    -- rated games THIS season (placement is games_total < 10)
  wins          INTEGER NOT NULL DEFAULT 0,
  losses        INTEGER NOT NULL DEFAULT 0,
  voids         INTEGER NOT NULL DEFAULT 0,    -- no-result games this season (rows B, H, I', J, M)
  games_total   INTEGER NOT NULL DEFAULT 0,    -- every rated game ever: placement and the visible rank read it
  best_shown    INTEGER,                       -- this season's best r - 2*RD after placement, whole points
  last_game_at  INTEGER,                       -- the idle RD term reads it (§1.2); NULL before the first game
  leave_points  INTEGER NOT NULL DEFAULT 0 CHECK (leave_points BETWEEN 0 AND 12),
  leave_at      INTEGER,                       -- the last incident; decay is read from it (§2.4)
  lock_until    INTEGER,                       -- the queue refuses a join before this
  active_code   TEXT,                          -- the live ranked room, set at mint and cleared at its end (§3.5)
  active_since  INTEGER,
  revision      INTEGER NOT NULL DEFAULT 0,    -- compare-and-swap for every write (the room's record, the queue's incidents)
  updated_at    INTEGER NOT NULL,
  CHECK (wins + losses <= games),
  CHECK ((active_code IS NULL) = (active_since IS NULL))
);

-- Append-only. Every change to a member's rating or leave points is a row, with its inputs, so any update can be re-derived.
-- No opponent id: the opponent is reached through match_seat (code, started_at, the other seat), the A3 tables, and only server-side.
CREATE TABLE rating_journal (
  id            INTEGER PRIMARY KEY,
  member_id     TEXT NOT NULL REFERENCES member (id) ON DELETE CASCADE,
  season        INTEGER NOT NULL,
  at            INTEGER NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('match', 'void', 'dodge', 'season')),
  code          TEXT,                          -- the match (kinds 'match' and 'void'); NO foreign key to match_record (§4.4)
  started_at    INTEGER,
  seat          INTEGER CHECK (seat IN (0, 1)),
  end_row       TEXT,                          -- the §2.2 row letter that decided it: 'A' .. 'M'
  score         REAL CHECK (score IN (0, 0.5, 1)),
  weight        REAL NOT NULL DEFAULT 1 CHECK (weight BETWEEN 0 AND 1),
  adv           REAL NOT NULL DEFAULT 0,       -- the cell's advantage term, in rating points (0 for every mirror cell)
  opp_r         REAL,                          -- the opponent's rating and RD AS USED, numbers only
  opp_rd        REAL,
  r_before      REAL NOT NULL,
  rd_before     REAL NOT NULL,                 -- after the idle term (§1.2), i.e. the RD the update used
  sigma_before  REAL NOT NULL,
  r_after       REAL NOT NULL,
  rd_after      REAL NOT NULL,
  sigma_after   REAL NOT NULL,
  incident      TEXT CHECK (incident IN ('early', 'abandon', 'drop', 'dodge')),
  points_after  INTEGER,                       -- leave_points after this row
  op_id         TEXT NOT NULL,                 -- 'm:<code>.<started_at>', 'd:<offer id>', 's:<season>': a retry is ignored
  UNIQUE (member_id, op_id)
);
CREATE INDEX rating_journal_member ON rating_journal (member_id, id);

-- A3's record learns which matches were ranked. A plain ADD COLUMN on a WITHOUT ROWID table: existing rows read 0.
ALTER TABLE match_record ADD COLUMN ranked INTEGER NOT NULL DEFAULT 0 CHECK (ranked IN (0, 1));
```

The SQL was checked in a scratch in-memory SQLite on top of `0001` to `0004` with foreign keys on (not committed): it applies; a
duplicate `(member_id, op_id)` is refused; deleting a `member` row empties both ranked tables for that member and leaves the other
member's journal; and with foreign keys **off** the same delete leaves the rows behind, which is the input that turns check K2-c red (§8).

`ranked_member.season` references `ranked_season`, so the migration must run before season 1's row exists; the lead's opening
command inserts the season row first (§4.3). The journal's `season` is a plain integer, not a foreign key, so a season row can never
be blocked from correction by its history.

### 4.2 What each write is

| Write | Who | Statements (one batch) |
|---|---|---|
| A rated or no-result ranked match (§2.2 rows A to K, M) | the room, relay invocation | the A3 four (`match_record` with `ranked = 1`, two `match_seat`, the `acct-all` bump) **plus** two `ranked_member` UPDATEs (compare-and-swap on `revision`, clearing `active_code`) and two `rating_journal` INSERTs: **8**, after 3 reads (the `records` flag, the day count, both members' rows in one SELECT) and one more for repeat damping (§5.1) |
| Row L (no-show, face-off exit) | the room | one `ranked_member` UPDATE per seat (incident on one, `active_code` cleared on both) and one journal row: **3** |
| A dodge at `found` | the matchmaker | one UPDATE and one INSERT: **2** |
| Mint | the matchmaker | two UPDATEs setting `active_code`: **2** |
| The lazy season reset (§1.6) | whichever of the above reads the row first in a new season | one journal row of kind `season`, folded into that batch: **+1** |

**A no-result ranked match is recorded too.** Today `void` and `expired` write nothing. A ranked room writes its `match_record` for
every match that started, with `agreed = 0` and `winner_seat` NULL for the no-result rows, and `reason` naming why (`dispute`,
`void`, `infra`, added to the validated reason list in code, not in the schema). Two reasons: a member's history shows "No result
(disputed)" instead of a match that silently vanished, and the dispute counter of §5.3 needs the opponent, which only `match_seat`
knows. W-L is unaffected: `memberRecord` counts `agreed = 1` only.

**The compare-and-swap.** The room reads both rows with their `revision`, computes both updates, and writes `UPDATE ranked_member SET
... , revision = revision + 1 WHERE member_id = ?1 AND revision = ?2`; a miss re-reads and retries, `CAS_TRIES` (3) times, the
`budgetedOp` pattern. The room's own `recorded` flag, saved before the write (A3), stays the guard against writing a match twice, and
the journal's `UNIQUE (member_id, op_id)` is the second.

### 4.3 The migration plan

| Step | Who | What |
|---|---|---|
| M1 | lead | Apply `0005_ranked.sql` to production, then merge slice K2 (merging deploys; a Worker reading tables that do not exist fails) |
| M2 | agent PRs, lead merges | Slices K3 to K6 (§8). Ranked stays closed: no `flags` row `ranked` means closed |
| M3 | lead | **Open season 1:** `npx wrangler d1 execute roaring-lions-accounts --remote --command "INSERT INTO ranked_season (id, starts_at, ends_at, rd_floor, created_at) VALUES (1, unixepoch() * 1000, NULL, 120, unixepoch() * 1000)"` |
| M4 | lead | **Open the queue:** the `flags` command of "Accounts A1" with the name `ranked` and the value `'open'`. Close: the same with `'closed'`. No deploy either way. The agent never runs either |
| M5 | lead | A later season: insert its row, then set the previous row's `ends_at`. Nothing else: the reset is lazy |

**After a D1 Time Travel restore** of ACCOUNTS, the A1 rule applies (close `accounts` first, re-apply the deletions), and **close
`ranked` too**: a restore rewinds every rating to the restore point, and the `match_record` rows rewind with it, so the two stay
consistent, but a member's `active_code` may name a room that has since ended. Reopen only after the deletions are re-applied.

### 4.4 With the existing tables, member deletion and the tombstones

**The deletion cascade must remove ranked rows, and the cron pin decides how.**
- `deleteStatements()` emits one statement per `MEMBER_TABLES` row, plus `RATE_DAY_SQL` and the orphan sweep: 17 today. The account
  cron runs **one** member delete per run in its worst case (`ACCOUNT_CRON_STATEMENTS` = 27), and the whole run's static worst case is
  pinned at **48 of 50** (`cron-budget.test.ts`, "sums under the limit", which asserts `toBe(48)` and `toBeLessThan(50)`).
- Two explicit `DELETE FROM ranked_member/rating_journal WHERE member_id = ?1` statements would make it **50**, which fails the pin's
  `< 50`. One would fit (49), with no room left for anything after it.
- **Recommended: the two ranked tables are removed by `ON DELETE CASCADE` from `member`** (D1 enforces foreign keys; the SQL above
  declares the cascade). `MemberTable` gains `cascade: true` with `deleteSql: null`; `deleteStatements()` emits nothing for such a row,
  so the batch stays 17 and the pin stays 48. Test A1-8 (every table with a `member_id` column is listed) keeps both tables listed, so
  export still finds them, and a new test proves the cascade (§8, check K2-c). The same holds for the idle-member sweep, which deletes
  through the same batch.
- *Alternatives (Q11):* one explicit statement for `rating_journal` and the cascade for `ranked_member` (49); or free two statements
  elsewhere in the cron before adding two. The existing table-by-table rule ("the delete path still deletes table by table") was a
  choice for clarity, not a platform need, and the cascade keeps it testable.

**The rest of the interaction:**

| Existing thing | Effect |
|---|---|
| `match_seat` / `match_record` | A deleted member's seat becomes `deleted` (A1), so the opponent's record and **the opponent's journal** survive. The journal has no foreign key to `match_record`, so the orphan sweep (`MATCH_ORPHAN_SWEEP_SQL`, which drops a record with no member seat left) is never blocked; it can only fire once both members are gone, and then both journals are already gone by cascade |
| The opponent's journal | keeps `opp_r` and `opp_rd` of a deleted member as numbers: a rating at a moment, not an identity, and needed to re-derive the opponent's own update |
| A member deleted mid-match | the room's record writes `deleted` for that seat (A3, §0.25); the deleted seat's rating UPDATE affects no row and its journal INSERT is written as `INSERT ... SELECT ... WHERE EXISTS (SELECT 1 FROM member WHERE id = ?1)` (the `match_seat` pattern), so the batch never fails on the foreign key; **the opponent is still rated** |
| A member deleted while queued | the queue reads `ranked_member` at pair time; a missing member row drops the entry. The page's own deletion flow closes the queue socket (`wipeMember`, then a hard reload) |
| Tombstones (`ACCOUNT_TOMBSTONES`) | unchanged: ranked rows hold nothing the tombstone needs, and the tombstone holds nothing ranked could read. A deleted member who returns with a new account is a new player (§5.2, Q10) |
| Export (`GET export`) | both tables gain `exportSql`: the whole `ranked_member` row except `revision` and `active_code`, and every journal row |
| `admin_action` / `/stats/members` | slice K6 adds a read-only ranked block to the member card. Correcting a rating is out of scope: it would need `'rating'` in `admin_action.action`'s CHECK, which is a table rebuild (as `0004_admin.sql` did for `coin_journal`) and its own design (Q18) |
| `rate_day` | ranked writes count against `acct-all` (`OPS_ALL` 20,000 a day): `RECORD_ROWS` becomes 8 for a ranked record (§7.1). No new scope |

## 5. Abuse cases

As in the PM design (§3.3 there), this public document names policies and the tests that hold them, not methods for beating them.
Each case below has a mitigation and the check that pins it (§8). None of them protects against a client that sees through fog: fog
is a client-side courtesy in lockstep (network design §1), and the ranked screen says so in one line, as the friend lobby does.

### 5.1 Win trading

Two accounts, or two friends, feeding each other wins.

| Mitigation | How |
|---|---|
| Blind, jittered pairing | nobody chooses an opponent: `found` carries no identity, and pairing happens at a random 2 to 6 s alarm among everyone feasible (§3.3) |
| One network, never paired | two entries with the same `netKey` (the day's keyed hash of the address) are never a feasible pair. A shared household or a carrier NAT is merely never paired with itself; nobody is punished |
| **Repeat damping** | the n-th rated game between the same two members within 7 days has weight `0.5^(n−1)`: 1, 0.5, 0.25, … The room reads it at record time with one query over `match_seat` ⋈ `match_record` (`ranked = 1`), by the existing `match_seat_member` index. Seven days of trading are worth at most two games of rating |
| No win from an instant leave | row G: before 3 minutes the leaver loses and the stayer gains nothing |
| No rematch on demand | the queue does not re-pair the previous opponent unless nobody else has been feasible for 60 s |
| Concentration review | a member with 8 or more of their last 20 ranked games against one opponent appears on the read-only review list (K6) |

### 5.2 Smurfing

A strong player on a fresh account, to play weaker players.

| Mitigation | How |
|---|---|
| A new account starts in the middle, never at the bottom | 1500 / RD 350, never a value from a claim (the PM design's rule). A smurf meets the middle of the pool first |
| It climbs out in a handful of games | +175 for a first win (§1.3); mean error under 100 after 8 games. The smurf's time among weaker players is short, and their opponents lose little: an established player's rating moves 7 points against a newcomer |
| An identity that costs something (Q8) | ranked requires a linked Google (or Steam) identity. `UNIQUE (provider, subject)` already makes that one member per Google account. A passkey-only member is free to mint and is not eligible |
| A day's wait (Q9) | `member.created_at` at least 24 hours before the first ranked join |
| Minting is already capped | `NEW_PER_IP` 5 and `NEW_ALL` 500 new members a day (A1) |
| Delete and return | a deleted member who signs up again starts at 1500 / RD 350 like anyone. That is accepted: 1500 is the middle, and carrying a rating across a deletion would mean keeping something about a deleted account (Q10) |

### 5.3 A modified client claiming results (only agreed results count)

| Attempt | What happens | Check |
|---|---|---|
| Report a false win | the other seat reports the truth: two reports that differ, row B: **void**, nobody rated | T1 |
| Report a false hash | the hashes differ: row B: void, the desync row is written | T2 |
| Withhold its own `over` and leave | row I: the room's own decision, **rated** as a loss | T3 |
| Withhold its own `over` and stay | row J: **disputed**, void, nobody gains | T4 |
| Forge an `over` on a non-hash tick, or tick 0 | refused by the room already (A3, PR 1280) | existing |
| Write a rating directly | there is no route: `ranked_member` and `rating_journal` are written only by the room's record module and the matchmaker. A source scan pins it, in the style of `admin_action`'s append-only test | K2-w |

So a modified client can **void** a match, never win one. What stops it voiding every match it is losing:
- **Disputes are counted by distinct opponent.** Rows B, I′ and J add a dispute to both seats. An honest player's rare disputes are
  each with a different cheater; a cheater's are with everyone. **Three disputes against three distinct opponents in 30 days lock the
  member out of ranked for 72 hours and put them on the review list.** The count is one query over `match_seat` (the no-result ranked
  records of §4.2 are what make it possible).
- **The evidence is kept.** A ranked room's dispute or desync writes the existing `match_desync` row with the **whole** order log
  (`compactLog` with a cap high enough for a 25-minute match; the daily `DESYNC_BUDGET` of 50 rows and 4,000,000 characters already
  bounds it), and it is purged after 180 days with the rest.
- **The lead can settle it.** A replay of that row through the sim tells which seat's report or hash was the sim's. That is seconds of
  CPU, so it runs on the lead's machine through the arena's replay path (GH-954, `tools/src/net/arena-replay.ts`), never in the
  Worker, whose Free CPU budget is 10 ms. Applying the answer (reversing a void into the right result) is Q18.

### 5.4 Dodging

| Dodge | Mitigation |
|---|---|
| Declining an opponent you do not like | impossible to aim: `found` is blind. Declining at all is a dodge, 1 point |
| Declining a map or side you do not like | the map is shown only at the face-off, after both accepted; leaving there is an early exit, 2 points, no rating change |
| Leaving in the first minutes once you see the opponent's opening | row G: a loss at full weight, 2 points |
| Not showing up after accepting | row L: a dodge, 1 point |
| Queue, cancel, queue again to fish | cancelling before `found` is free and gains nothing, because what you would be fishing for is never shown |

### 5.5 Queue sniping

Joining at a chosen moment to be paired with a particular player: a friend (to trade), a known weak player, or someone streaming.

- **Nothing in the queue names anyone.** `queued` says only `few`, `some` or `many`; no names, no ratings, no "who is searching".
- **The pairing moment is random** (2 to 6 s after the event that makes a pair feasible), among everyone feasible then.
- **The pair is blind until both accept**, and the same-network rule, repeat damping and the no-rematch rule bound what a successful
  snipe is worth.
- **What cannot be stopped:** in a queue of two, the second joiner gets the first. Repeat damping is what limits the gain.

### 5.6 Rating manipulation through leavers

| Manipulation | Mitigation |
|---|---|
| Win trading by instant leaves | row G |
| Escaping a loss by withholding the result and leaving | row I (the finding of §2.2) |
| Escaping a loss by stalling silently after the opponent's result | row J: void, a dispute, and the distinct-opponent lock |
| Escaping a loss by timing your own drop to an outage | the infrastructure window is 5 s and needs **both** seats to go; a player cannot drop the opponent. Game deploys no longer drop rooms at all after the relay cut |
| Sandbagging: leaving on purpose to sink, then beating weaker players | every leave is a full loss **and** points (a lock from the second); Glicko-2's volatility rises on erratic results, so the sandbagger's next wins move them back up fast; and the review list shows a member whose losses are mostly leaves. A rating floor (the season's best visible rank minus 400) is the extra lever if the first 200 results show it is needed; it is not recommended at the start, because a floor makes the rating wrong by design |
| Leaving during placement to protect a high early number | an early exit still loses at weight 1, and placement needs 10 rated games, not 10 games survived |

## 6. What /privacy must say, and retention

The page is `packages/worker/src/privacy-page.ts`; its tests (`privacy-page.test.ts`) pin each data item by name, and the text and
`PRIVACY_UPDATED` change together. The text below is proposed for slice K6 and ships **in the same PR that can first write a ranked
row**, not before (GH-1399: "the store and lobby copy describe ranked only once it is open"). It follows the page's existing voice:
short items, plain words, no term of art without its meaning.

### 6.1 The proposed text

**In "What is stored for a signed-in player"**, three new items after the versus item:

> - If you play ranked: your ranked rating, as three numbers (the rating, how sure it is, and how steady your results have been); your
>   ranked games, wins, losses and games with no result this season; your best rank this season; when you last played ranked; and the
>   ranked match you are playing now, if any.
> - If you play ranked: a history of every change to your rating, with the match it came from, how that match ended, your rating
>   before and after, and your opponent's rating at that moment (a number, never their name or Player ID). For each season you played,
>   the rating and rank you finished it with.
> - If you play ranked: when you leave a ranked match in its first three minutes, close it and do not come back within 60 seconds, lose
>   your connection and do not come back, or decline or miss a match you were offered, a count of points, the time of the latest, and
>   any wait it put on your ranked queue. The points fade, one every 48 hours and one for each ranked match you finish. Each of these is
>   also in your rating history.

**The versus item** gains one sentence at its end:

> A ranked match is marked as ranked, and a ranked match that ends without a result is kept too, with the reason.

**A new section, after "What the team can see":**

> **Ranked play**
> - Ranked play is only for signed-in players who choose to join the ranked queue.
> - While you wait in the queue, our server holds these in memory and never writes them down: the sides and map you chose, your game
>   version, the continent Cloudflare places your connection in, and a code made from your connection's address that changes every day
>   and cannot be turned back into the address. The code is used only so that two players on the same network are not matched with each
>   other. All of it is gone when you leave the queue.
> - Ranked results are worked out on our server, from what both players' games agree on. Your rating is never shown to other players.
>   They see your display name and Player ID during a ranked match, as in any versus match.
> - If the two players' games disagree about a ranked match, its settings and orders are kept for 180 days, so that the team can replay
>   it and see which game was right. They hold no name, Player ID or account, but they carry the match's code, which your ranked history
>   also holds.

**In "What the team can see"**, one item (with slice K6's member-card block):

> - For ranked play, the team can see your rating, its history and your leave points, to look into reports of cheating or of leaving
>   matches.

**In "For how long"**, two items:

> - Your ranked rating, its history, your season results and your leave points stay while your account does, and are deleted with it.
> - A disputed ranked match's settings and orders are deleted after 180 days.

### 6.2 The retention periods

| Data | Where | Kept | Removed by |
|---|---|---|---|
| `ranked_member` (rating, counters, leave points, lock, live room) | ACCOUNTS | while the account | the member delete (cascade, §4.4); the 36-month idle sweep through the same batch |
| `rating_journal` (every change, season results, incidents) | ACCOUNTS | while the account | the same |
| `match_record` / `match_seat` of a ranked match | ACCOUNTS | while either player keeps an account (A3, unchanged) | A1's orphan sweep |
| Leave points' **effect** | — | fades by one every 48 h and per finished match | computed when read; no write |
| Dispute and desync evidence (`match_desync`) | telemetry `DB` | 180 days (`RETENTION_MS`) | the existing `purgeDesyncs` in the daily cron, unchanged |
| A queue entry: sides, maps, build, continent, `netKey`, the internal member id | the matchmaker's socket attachment | the wait | the socket's close; **never** written to storage |
| The requeue token | the player's browser memory | 10 minutes of use | expiry; it holds no identifier |
| The matchmaker's daily public-match counter | its own storage | the day | overwritten the next day; no member data |
| `ranked_season` | ACCOUNTS | indefinitely | no member data |

## 7. Cost against the D1, KV and Durable Object budgets

### 7.1 D1 (ACCOUNTS)

| Per ranked match | Statements | Rows written (indexes included) | Rows read |
|---|---|---|---|
| Two queue joins (eligibility, §3.2) | 2 reads | 0 | about 6 |
| Mint (`active_code` × 2) | 1 batch of 2 | 2 | 0 |
| The record (§4.2) | 4 reads + 1 batch of 8 | about 16: the record 1, the seats 2 + index 2, `rate_day` 1, members 2, the journal 2 + its two indexes 4, plus the `ranked` flag counted once | about 30, most of them the damping query's `match_seat_member` range |
| **Total** | **≈ 7 reads, 2 batches** | **≈ 18** | **≈ 36** |

At the 12-a-day cap that is about **220 rows written a day** against D1's 100,000 (0.2%), and about 430 read against 5,000,000. Inside
one invocation the record is 12 statements by this repository's per-statement policy, well under 50. `RECORD_ROWS` becomes 8 for a
ranked record against `OPS_ALL` (20,000 a day), so the accounts breaker sees it.

### 7.2 Durable Objects

| | Per unit | At the expected size (30 members, 2 joins each a day, 12 matches) |
|---|---|---|
| **The matchmaker**, per queue entry (the PM design's estimate, plus the jittered pairing alarm) | about 1 Worker request, 2.2 DO requests, 1 to 2 DO rows, 0.0125 GB-s | about 60 Worker requests, 130 DO requests, 120 DO rows, 1 GB-s a day |
| **The match room**, per ranked match (unchanged by ranked) | 1,440 to 2,640 DO rows for 20 minutes (up to about 3,300 at the 25-minute cap), 150 GB-s | the 12-a-day cap: at most about 40,000 DO rows and 2,300 GB-s |
| Free allowances (PM design §3.1; re-read the pricing page before K5) | 100,000 DO requests, 13,000 GB-s, 100,000 DO rows, a day, **for the whole account** | |

**The matches are the cost, as the PM design found.** The rating adds about 1% to a match's own writes, and the matchmaker is noise.
With the relay split the room's rows are written by the relay's script, but the allowances are the account's, so friend rooms and
ranked rooms still share one ceiling of about 38 busy matches a day; the 12-a-day ranked cap is what keeps two-thirds of it for friend
play. On Workers Paid (5 USD a month, the lead's choice, not this note's) the cap is a `vars` value and can rise without code.

### 7.3 The cron budget pins

- **Zero statements are added to `scheduled()`.** The season reset, the idle RD term and the leave-point decay are all computed when a
  row is read (§1.5, §1.6, §2.4), and nothing ranked is swept by the cron: the journal is kept while the account is, and the dispute
  evidence rides the existing `purgeDesyncs`.
- **The member delete batch stays 17 statements** with the cascade (§4.4), so `ACCOUNT_CRON_STATEMENTS` stays 27 and the static worst
  case stays **48 of 50**: `cron-budget.test.ts` does not change. Two explicit deletes would make it 50 and turn that test red, which is
  why the cascade is recommended rather than chosen for neatness.
- **If ranked ever needs periodic work** (trimming old incidents, closing a season with a snapshot), it runs in the matchmaker's own
  alarm, a separate invocation with its own 50, never in the game Worker's `scheduled()`.
- The relay design's fact 6 holds: the room's D1 writes run in the object's invocation, not in a Worker invocation.

### 7.4 KV and the rest

- **KV: nothing.** No new namespace, no read and no write. Tombstones are unchanged; the requeue token is a MAC, not a stored key; the
  KV Free allowance (1,000 writes a day) stays for tombstones.
- **One rate limiter**, `RANKED_LIMIT` (namespace 1009), on the upgrade: a binding, no D1 or KV.
- **CPU:** a Glicko-2 update is about ten iterations of a root find, microseconds, inside the Free 10 ms with three orders of margin.

## 8. Slices and falsifiable checks

Every check arrives with the input that turns it red, run once and named in its commit (`falsification-casebook.md`); oracles take
literals. No slice touches `@lions/sim`, the golden hash or the tuning.

**Before K1:** the lead's rulings here; the lead unparks balance (GH-1399's block); GH-205 lands or Q1 rules it unnecessary for
versus; the relay cut (GH-1397 P2) is done (Q19).

| Slice | What | Size |
|---|---|---|
| K1 | `packages/worker/src/ranked/glicko2.ts`, pure: the update, the weight, the advantage term, the idle term, the visible rank | S |
| K2 | `0005_ranked.sql` (§4.1), `MEMBER_TABLES` cascade rows, export, the write-site scan | S |
| K3 | `rankedOutcomeOf` (§2.2) and the incident ladder, pure, in `room-core.ts`; the tamper tests | M |
| K4 | The room: `create-ranked`, the member-must-match hello, the refusals, the close code, the infrastructure window, the record batch, row L | M |
| K5 | The `Matchmaker` DO, `/api/ranked/ws`, `QUEUE` binding and `mm-v1` migration, `RANKED_LIMIT`, the `ranked` flag | L |
| K6 | The shell screen, the profile's band and history, `/privacy` (§6), the `/stats/members` read-only block, `ui:routes` arm (CI only) | M |

| # | Check | The input that must turn it red |
|---|---|---|
| K1-a | Glickman's example as literals: 1500/200 beats 1400/30, loses to 1550/100 and 1700/300, τ 0.5 → r′ 1464.05, RD′ 151.52, σ′ 0.05999 | change 173.7178; change τ |
| K1-b | A game of weight 0 changes nothing; weight 0.5 moves less than 1 and more than 0 | drop the weight from either sum |
| K1-c | With `a > 0` the favoured side gains less for a win than with `a = 0` | flip the sign of `a` for one side |
| K1-d | Idle 30 days from RD 50 gives 93 (literal); never above 350 | use hours for days; drop the cap |
| K2-c | Deleting a `member` (harness with `foreignKeys: true`) leaves no `ranked_member` or `rating_journal` row of that member and keeps the other member's | run the harness with `foreignKeys: false`; delete the `ON DELETE CASCADE` from the test's copy of the migration |
| K2-p | `cron-budget.test.ts` unchanged: the worst case is still 48 | give a ranked table an explicit `deleteSql`: `toBe(48)` goes red |
| K2-e | Export returns both tables, without `revision` and `active_code` | drop a table's `exportSql`; select `*` |
| K2-w | Only the room's record module and the matchmaker contain a write to `ranked_member` or `rating_journal`; no `/api/account/*` route does | add an `UPDATE ranked_member` to `account/profile.ts` |
| T1 | A seat reporting itself the winner while the other reports the opposite: no rating moves (the issue's tamper test) | rate on the first report |
| T2 | A false hash: void, no rating moves, the evidence row is written | skip the hash comparison in the ranked path |
| T3 | Withhold `over` and leave: rated as a loss (row I) | use `recordOf`'s lone rule for ranked |
| T4 | Stay silent after the opponent's `over` for `OVER_CONFIRM_MS`: a dispute for both, void | treat it as row I |
| T5 | A leave before 3,600 ticks: the leaver loses at weight 1, the stayer is unchanged | give the stayer weight 1; compare with `>` instead of `>=` at the boundary |
| T6 | Both seats gone 4 s apart: void; 6 s apart: the first gone forfeits | keep today's same-instant rule only |
| T7 | Points and locks at the ladder's literal edges; decay after 48 h and per finished match | off-by-one at 48 h; decay on a void |
| K4-a | A ranked `hello` from another member's session is refused | drop the member comparison |
| K4-b | A ranked room refuses `/join`, `/advisor` (both scopes), `kit: 'brigade'`, a bot seat, free-text chat | delete each refusal in turn: five reds |
| K4-c | The record batch writes both members' rows and journal rows, or none (a failing statement rolls all back) | split the batch in two |
| K5-a | `found` carries only `deadline` | add the opponent's name: a test that lists the message's keys goes red |
| K5-b | Two entries with one `netKey` are never paired, over 10,000 seeded draws | drop the `netKey` comparison |
| K5-c | A locked member, a member with a live `active_code`, a guest and (Q8) a passkey-only member get `closed` with the right reason | remove each guard in turn |
| K5-d | A requeue token restores the wait; a forged or 11-minute-old one does not; the token contains no member id | accept any token; put the member id in it (a scan of the token for the literal id goes red) |
| K5-e | Repeat damping: the 3rd game between one pair in 7 days has weight 0.25 | remove the damping |
| K5-f | At most one alarm per pairing; no `setInterval` (fake-DO counters) | a periodic alarm; a 1 s heartbeat |
| K6-a | `/privacy` names the ranked data (`names_the_ranked_data`), and `PRIVACY_UPDATED` moved | drop one item |
| K6-b | The lobby shows "Find a ranked match" only while `GET /api/ranked/open` says open | render it unconditionally |

**Gates.** The lead and a friend, both signed in with Google, on two machines and the deployed build: three ranked matches (one won,
one surrendered after 3 minutes, one left in the first minute), and the expected rating rows and lock read back in the profile; the lead
closes `ranked` and both see `closed{switch}` with no deploy. Then the first 200 ranked results are read in `/stats` (waits by band
stage, the gap at pairing, leave and dispute rates) and the §2.4 and §3.3 constants are revisited, not before.

## 9. Open questions for the lead

The recommendation comes first in each.

1. **The authoritative path.** Is A3's agreed rule (two matching reports with a compared hash, or a room-decided end), extended by §2.2,
   the "server-authoritative path" GH-1399 asks for? **Recommended: yes.** The Worker cannot run the sim on Free, so an agreed lockstep
   result is the strongest versus authority available; GH-205's server ledger is about coins and the campaign. *Alternative:* ranked
   waits for all of GH-205.
2. **Glicko-2** with §1.2's parameters (an update every game, RD inflated by idle days at c = 14.4). *Alternative:* Elo with a
   provisional K of 40 for 20 games, then 20.
3. **Placement and the visible rank:** 10 rated games, then a named band from `r − 2·RD`; the number never shown. About two weeks at
   the expected pace. *Alternative:* 5 placement games.
4. **A3's W-L rule.** Leave `recordOf` as it is and add `rankedOutcomeOf` beside it. **Recommended**, then align `recordOf`'s lone-report
   case (§2.2) in its own small PR. *Alternative:* change `recordOf` now, which moves existing W-L semantics.
5. **KDF v Sarim.** Season 1 is the mirror only; a faction cell joins with the advantage term once balance is unparked and the lead
   accepts a starting `a` per cell. *Alternative:* open `tel_marum` and `wadi_tarfan` faction cells at once with probe-based `a`.
6. **A menu Leave after 3 minutes** is a concession like a surrender: a loss, no incident. *Alternative:* 1 point.
7. **The early-leave rule:** before 3 minutes the leaver loses and the stayer gains nothing. *Alternative:* the stayer gains at half
   weight (which reopens a slower form of win trading).
8. **Ranked requires a linked Google or Steam identity.** *Alternative:* any member, passkey-only included (smurfing then costs nothing).
9. **A member must be 24 hours old** before their first ranked join. *Alternative:* no age rule.
10. **Deletion is deletion:** a returning player starts at 1500 / RD 350. *Alternative:* keep a peppered hash of the Google subject for
    90 days to carry a rating floor across a deletion, which `/privacy` would then have to state as data kept after deletion.
11. **Cascade deletion** for the two ranked tables, keeping the cron pin at 48. *Alternative:* one explicit statement (49, no room left).
12. **No leaderboard in season 1**: each player sees only their own band. *Alternative:* an opt-in board by display name, keyed on
    `profile.show_record` or a new opt-in.
13. **Seasons:** season 1 open-ended until you set its end; later seasons 12 weeks; the reset keeps `r` and raises RD to 120.
    *Alternative:* a pull toward 1500 at each reset.
14. **A fixed "ranked hour"** to concentrate a small pool. **Recommended: not at first**; decide from the first 200 results' waits.
15. **Season 1 maps and rules:** the four 25-minute fair maps, placed forces, annihilation, matched kit. *Alternative:* add the three
    35-minute large maps (1.4 times the rows) or a win mode.
16. **Pauses and chat in a ranked room:** one pause of 60 s a seat, quick chat only. *Alternative:* the friend rules.
17. **The daily cap:** ranked is the only public queue and uses the PM design's 12 public matches a day. *Alternative:* a higher cap
    with the paid plan.
18. **Settling a dispute.** Season 1: lock and review only, no rating correction. *Alternative:* an admin route that reverses a void into
    the adjudicated result, which needs `'rating'` in `admin_action`'s CHECK (a table rebuild) and its own design.
19. **Order of opening:** ranked opens only after the relay cut (GH-1397 P2), so that no stranger loses a rated match to a game deploy.
    **Recommended: yes.**
20. **Where the matchmaker lives:** the game Worker, minting through `roomsOf(env)` so the `ROOMS_NEW` lever covers ranked rooms.
    *Alternative:* the relay Worker (fewer queue drops; the lever and the relay's closure rule would both need changing).
