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
## 4. The D1 schema and the migration plan (ACCOUNTS)
## 5. Abuse cases
## 6. What /privacy must say, and retention
## 7. Cost against the D1, KV and Durable Object budgets
## 8. Slices and falsifiable checks
## 9. Open questions for the lead
