# Public matchmaking: pairing strangers of similar level (GH-687)

**Status:** a design for the lead's review. No code. Nothing is scheduled: GH-687 says it follows
ST5 (GH-204) and ST6 (GH-205), and §6 asks whether part of it should not wait for them.
**Read against:** `origin/main` `7c79207f` (28 Oct 2026).
**Sources:** GH-687 (no comments, no linked PRs), GH-204, GH-205, GH-191 and its rulings; the
network game design (`2026-10-10-network-game-design.md`, "the network spec"), the snapshot design
(`2026-10-25-net-sim-snapshot-design.md`), the GH-191 audit (`2026-10-28-network-next.md`, PR 877);
`docs/agent-notes/shell-and-ui.md`; `packages/worker/src/match/` (`routes.ts`, `room-core.ts`,
`match-room.ts`, `ticket.ts`, `kit-tracks.ts`), `wrangler.jsonc`, `packages/net/src/config.ts`,
`packages/app/src/brigade-account.ts`, `packages/app/src/net/match-world.ts`
(`seatKitTiers`, `upgradePrepass`), `packages/app/src/ui/versus.ts`, `packages/app/src/net/player-id.ts`.
**Out of scope:** co-op (N5 is postponed), 2v2 (GH-691), spectators, a leaderboard, payouts for a
result (network spec decision 20), an authoritative server sim, and any Steam work.

Issues are written GH-NNN and pull requests "PR NNN".

---

## 0. In one page

- **"Brigade level" cannot be trusted, and it does not need to be.** The account lives in
  `localStorage` and can be edited. ST6 can make *bought* items trustworthy, but not *earned* ones:
  verifying a single-player result means running the sim on the server, and the Worker never
  imports the sim. Public rooms are matched kit only (network spec decision 5), so a player's
  brigade does not change the fight. It only predicts experience, and predicts it poorly.
- **Pair on a hidden versus rating that the server holds** (Glicko-2). It is computed only from
  results the room has seen both seats agree on. Brigade level becomes a tie-break in the first,
  unrated phase, and is never a constraint.
- **One matchmaker Durable Object**, in the Worker we already run. It uses hibernating WebSockets.
  It has no `setInterval`, and it sets an alarm only for the next moment a pair could become
  possible. Players pick their sides freely (KDF, Sarim, or both) and untick maps they do not want.
  The matchmaker pairs them only on a side pair and map that the existing `matchupAllowed` and
  `versusMapAllowed` rules allow.
- **The Workers Free plan can run the queue but not the matches it would make.** A running match
  writes 1,440 to 2,640 SQLite rows. That puts the whole account's ceiling at **about 38 busy
  20-minute matches a day**, friend rooms included. The queue therefore carries a **daily cap on
  public matches**, recommended at 12, and closes politely when the cap is spent. It also has a
  kill switch, `QUEUE_CLOSED`, which needs no app deploy.
- **Four phases.**
  - P0 records match results and adds a daily room budget. It opens no queue.
  - P1 opens the unrated queue.
  - P2 adds the hidden rating.
  - P3 keys the rating on ST5's verified id and adds region placement.

  P0 to P2 need neither ST5 nor ST6. That is the first lead question (§6).

---

## 1. What "brigade level" can mean, and whether to pair on it

### 1.1 The candidates

Every number below is read from `lions.brigade.account` (`brigade-account.ts`). It is the only
reader and writer of that key, and it runs in the player's browser.

| Candidate | Read from | What it measures | Inflatable without editing? |
|---|---|---|---|
| Credits on hand | `balance` | spending habits | yes: hold credits back |
| Lifetime earned | `earned_total` | campaign play, including replays | partly: the improvement rule limits replays, but a new campaign pays again (GH-330) |
| **Service record** | `Σ paid[m]`, the lifetime best payout per mission | how much of the ladder the player has cleared, once each | **no**: each mission counts at most its best, and the whole ladder pays under 10,000 (`LADDER_CREDITS`) |
| Kit owned | `upgrades` + `unlocks` | what the player has bought | yes, with coupons and test coins |
| Versus rating | the server (P2) | results against other people | only by winning, or by colluding (§3.4) |

If a brigade number is used at all, it should be the **service record**. It is
`Σ paid[m] / LADDER_CREDITS`, cut into five bands, 0 to 4. It is the closest thing the account has
to "how far into the game is this player", and grinding cannot raise it.

### 1.2 Is it trustworthy enough to pair on?

**No, as a constraint. Yes, as a tie-break.**

- **Editing is trivial.** Anyone can change a `localStorage` value. The server can check a claim
  only for structure, as `seatTiersField` does for kit today (decision 22): a band must be an
  integer from 0 to 4. Nothing can check that the band is true.
- **The lie that does harm is claiming a low level.** An experienced player who claims band 0 gets
  paired with new players. Claiming a high level only costs the liar their own games. Any rule
  where a lower claim widens the pool of easy opponents will be exploited.
- **It measures the wrong thing.** The service record measures single-player progress, not versus
  skill. Versus kit is matched in a public room, so a band-4 brigade fields exactly what a band-0
  one does.
- **ST6 does not fix this.** WP-ST6 makes the server authoritative "for anything bought with
  money". Earned credits come from single-player missions that only the client ran. To verify one,
  the server would have to replay the mission's command log through `@lions/sim`. The Worker never
  imports the sim (network spec §3.1). Workers Free also allows 10 ms of CPU per request, and a
  replay is seconds of CPU. So even after ST6, an earned brigade level is a claim.

Hence the recommendation. P1 uses the band only to choose between pairs that are **already
feasible**: the closest band wins a tie. That way a lie changes nothing that matters. From P2 the
band is retired from pairing, and the player sees it on their own screen only.

### 1.3 What a server-held rating needs

1. **A result the server trusts.** Today the room knows who won only when it decided the result
   itself: `surrender`, `forfeit` and `left` name a seat. An annihilation, a stalemate or the
   25-minute cap is decided in each client by `net/outcome.ts`. The `over{tick}` message carries
   only the tick. P0 adds the result to it, as `over{tick, result}`, and the room records a result
   only when:
   - both seats report the same result on the same tick; and
   - the last hash pair at or before that tick agreed.

   If the two seats disagree, the match is void and unrated. Two honest lockstep sims always agree,
   because the outcome is read from hashed state on hash ticks. A modified client can therefore
   void a match, but it cannot win one by lying.
2. **An identity for the rating.** Before ST5 this is the anonymous `lions.versus.player` UUID. The
   server never stores the raw UUID. It stores `pid = HMAC-SHA256(RATING_PEPPER, "pid:" + uuid)`,
   truncated to 16 bytes. The pepper is a new secret, set by the lead and kept apart from
   `TICKET_SECRET`, so rotating either one leaves the other alone. Seat tokens in `start` and `log`
   are already per-match (network spec §11b.2), so an opponent never learns your UUID.
3. **Somewhere to keep it.** Use the matchmaker Durable Object's own SQLite, with one table:
   `rating(pid PRIMARY KEY, r, rd, sigma, games, last_at)`. A single object is strongly
   consistent, needs no D1 round trip on a queue join, and costs two rows written per rated match.
   D1 gets one `match_result` row per ended room, for `/stats`, and no rating.
4. **A rule for new and returning ids.** A new pid starts at Glicko's default, r 1500 and RD 350.
   It never starts at a value derived from a claim. Because an id costs nothing to mint, a fresh id
   is a fresh provisional player. RD grows back over idle time, as Glicko-2 intends. This makes a
   smurf start in the middle of the pool rather than at the bottom, and a high RD lets them climb
   out of it within a few games. That is the best a free identity can do. ST5 is what makes an
   identity cost something (P3).
5. **A statement of what the rating does not protect.** Fog is a client-side courtesy in lockstep
   (network spec §1). A rating chooses who you play. It does nothing about a modified client that
   sees through fog. The public screen states this in one line, as the friend lobby does.

---

## 2. The queue on the existing Durable Object relay

### 2.1 Shape

```
browser ──WS /api/queue──▶ Worker ──▶ Matchmaker DO "mm:global"   (hibernating sockets, SQLite: rating, budget, penalty)
                                         │  pair + accept
                                         ├──▶ MatchRoom DO (new code, created pre-seated, public: true)
                                         ◀── two seat tickets, signed with TICKET_SECRET
browser ◀── found{code, ticket} ── closes the queue socket ── opens the room socket (today's path)
```

- **Routes.** `GET /api/queue/ws` is a WebSocket upgrade. It sits under the existing `/api/*`
  `run_worker_first` entry. Origin is required, as on every `/api/match*` route. The first message
  is `join{…}` (§2.6). Nothing travels in the query string, because
  `observability.redact_query_string` is false. There is no HTTP polling route, because polling
  would spend a request every few seconds per queuer (§3.1).
- **One new Durable Object class, `Matchmaker`.** It needs a migration tag `mm-v1` with
  `new_sqlite_classes: ["Matchmaker"]`. Like `net-v1`, that tag applies only on `wrangler deploy`
  from `main`. The branch's "Workers Builds" check goes red until the merge, exactly as it did for
  N0.
- **No new platform.** The same Worker, D1 and rate-limit bindings are used. R2 stays unused.

### 2.2 One matchmaker or sharded: **one**

- **The population is small, and sharding makes it smaller.** A shard per region or per build
  splits a pool that is already thin. Waits get longer and matches get worse.
- **One object has the headroom.** A hibernated socket costs memory only for its attachment, which
  is at most 2 KiB. A thousand queuers produce roughly 80 events a second (§3.1), within one
  object's throughput.
- **Pairing must not scan every pair.** On each event, the object keeps entries sorted by rating
  and checks each entry's neighbours, which is O(n log n). It never checks all n² pairs.
- **Name it for the future.** Call the object `mm:global` (`idFromName`). If sharding is ever
  needed, the key becomes `mm:<bucket>` and ratings move to D1. Nothing else changes.

### 2.3 Widening the band over time

Each entry has its **own** band, which is a half-width in rating points. A pair is feasible only
when the rating gap fits inside **both** bands. A newcomer is therefore not handed to a veteran
just because the veteran has waited a long time.

| Waited | Half-width (P2) | P1, unrated |
|---|---|---|
| 0–15 s | `max(100, RD)` | any feasible pair, closest service band first |
| 15–30 s | `max(200, RD)` | same |
| 30–60 s | `max(400, RD)` | same |
| 60–120 s | `max(700, RD)` | same |
| > 120 s | unbounded | same |

These constants are starting values, to be revisited when the first 200 rated results exist
(§5, P2). They are not tuned against anything, because no population exists yet. With a handful
of players online, nearly every wait reaches "unbounded". The screen says so honestly ("Widening
the search", then "Any opponent").

**Wake-ups cost a row each, so the object never polls.** Each `setAlarm` is a row written
(R-N12, `match-room.ts`). After every event the object computes **the earliest moment at which
some unpaired pair becomes feasible**: the next band step of the pair with the smallest gap. It
sets one alarm for that moment, or none when no pair can ever become feasible, for example two
players who both want only Sarim. The alarms in a day are then about one per pairing, rather than
one per period.

### 2.4 Side pick: free, as a standing rule

- **The player picks a set of sides:** KDF, Sarim, or both. At least one must be ticked. The queue
  **never assigns a side the player did not tick.**
- **Feasibility comes from `@lions/net`'s own predicates.** A side pair is offered only where
  `matchupAllowed` allows it:
  - KDF v KDF on any fair map;
  - KDF v Sarim on `FACTION_MATCHUP_MAPS` only (`tel_marum`, `wadi_tarfan`);
  - Sarim v Sarim never, because `matchupAllowed` does not offer it.

  A player who ticks only Sarim can meet only someone who ticked KDF, on two maps. The setup
  screen says so under the Sarim choice, and §6 asks whether that is acceptable.
- **Seats are drawn at random.** Which player takes seat 0 is chosen at random, so the west/east
  spawn order is drawn too. The KDF-west reading on both matchup maps is Sarim 60.4% (network spec
  §11b.2), so a fixed order would carry that lean into every game.
- **One build per pair.** Entries are pooled by build string, so two builds are never paired. Today
  the room would refuse a mismatch with `build_mismatch`. The queue catches it before a room
  exists, and tells the stale client "Update available, reload".

### 2.5 Map choice from the opened versus maps

- **The server's list wins.** The candidate maps are the intersection of both players' ticked
  maps with the server's `VERSUS_FAIR_MAPS`. A stale client therefore cannot bring back a closed
  map.
- **Map and sides are drawn together.** The queue draws uniformly among the feasible
  `(sideA, sideB, map)` triples, with a random source that tests can inject. This is the Worker,
  not the sim, so the four invariants do not apply. A tie-break prefers a triple that matches each
  player's *only* tick, when they have one.
- **Each map is checked twice.** It must pass `versusMapAllowed`, and the side pair must pass
  `matchupAllowed`, both at the matchmaker and again at the room's create. The room's own refusal
  stays the last word, as it is for friend rooms.
- **Defaults:** every fair map ticked. A player may untick maps, but at least one must stay ticked.

### 2.6 The protocol

Client to matchmaker:
- `join{player, callsign, build, sides, maps, band}`. Every field is rebuilt field by field, in
  the `cleanCommand` style, and an unknown field is dropped.
- `accept`
- `decline`
- `leave`

Matchmaker to client:
- `queued{position: 'few' | 'some' | 'many'}`, a coarse count of searchers, pushed at most every
  10 s;
- `band{stage}`;
- `found{deadline}`;
- `matched{code, seat, ticket}`;
- `requeued`;
- `closed{reason: 'cap' | 'switch' | 'full' | 'build' | 'cooldown', until?}`.

**The accept step comes before a room exists.** On a pair, both players get `found` with 15 s to
accept. The room is created only when both accept, so an idle player never costs a room. Someone
who declines or times out gets a cooldown (§3.2). The player who accepted goes back into the queue
with their waited time kept.

**The public room.** The matchmaker creates the room through an internal
`https://room/create-public` call, with:
- the map, the factions by seat, and both seats already assigned to their pids and callsigns;
- `kit: 'matched'` and empty `tiers`;
- `pace: realtime`;
- `public: true`.

The room refuses the following for a public room:
- `/join` (no third party can take a seat by guessing a code);
- `/advisor` (both scopes; an `assist` advisor would be an AI playing a seat);
- `kit: 'brigade'` ("never in a public or ranked room", network spec decision 5).

The room skips the friend lobby's Ready step, because accepting was the ready. It shows a 10 s
face-off: both callsigns, both sides and the map. Decision 23 (dropping loses after 60 s) and
decision 24 (force value settles a stalemate and the cap) apply unchanged. Chat and pauses in a
public room are lead questions (§6).

---

## 3. Abuse and cost on Workers Free

### 3.1 The budget

**The Free plan's daily allowances**, as published by Cloudflare and used throughout this repo's
specs:

| Resource | Daily allowance |
|---|---|
| Worker requests | 100,000 |
| Durable Object requests | 100,000 (an incoming WebSocket message counts as 1/20 of a request) |
| DO duration | 13,000 GB-s (a DO is billed at 128 MB; an object that is idle and able to hibernate is not billed) |
| DO SQLite rows written | 100,000 |
| D1 rows written | 100,000, separately |

Re-read the pricing page before P1 is scheduled. P0's gate does that against the live dashboard.

**What one 20-minute match costs**, using the room as it is built:

| Resource | Per match | Basis | Free ceiling, matches a day |
|---|---|---|---|
| SQLite rows written | 1,440 idle, 2,640 busy | measured: 1.2 to 2.2 rows/s (R-N12) | **69 idle, 38 busy** |
| Duration | 150 GB-s | the room's `setInterval` keeps it active: 0.125 GB × 1,200 s | 86 |
| DO requests | about 460 | estimate: about 7 incoming messages a second (acks, hashes, orders) ÷ 20, plus snapshot POSTs | about 215 |
| Worker requests | about 44 | 2 upgrades, plus 2 snapshot POSTs a minute | about 2,270 |

**Rows written are the binding limit.** The whole account holds about **38 busy matches a day**,
friend rooms included. The network spec's "about 80 matches a day" counted duration only.

**What the queue alone costs per entry** (an estimate; P0 measures it in `fake-do.ts`). Assume a
mean wait of 60 s and five events per entry: join, the coarse count, found, accept, close.

| Resource | Per entry |
|---|---|
| Worker requests | 1, the upgrade |
| DO requests | about 2.2: the upgrade, about 4 messages ÷ 20, half a room create, at most half an alarm |
| Rows written | about 1: half a budget-counter row and at most half an alarm row; entries live in socket attachments, never in storage |
| Duration | about 0.0125 GB-s: five events of up to 20 ms of wall time each |

Keepalive goes through `setWebSocketAutoResponse`, which does not wake the object. This design
assumes it is not billed. If it is, at 20:1, a 30 s ping adds about 0.1 requests per queuer per
minute.

**Sustained concurrency.** C queuers in the queue at once, with W = 60 s, make 60·C entries an
hour:

| Concurrent queuers | Entries an hour | Queue alone: hours of Free a day | Matches the queue would make | Time to spend the account's ~38 busy matches |
|---|---|---|---|---|
| **10** | 600 | all day (14,400 Worker req; 31,700 DO req; 14,400 rows; 180 GB-s) | 5 a minute | **about 8 minutes** |
| **100** | 6,000 | about 7.5 h (DO requests run out first) | 50 a minute | **about 45 seconds** |
| **1,000** | 60,000 | about 45 min (DO requests), 1.7 h (Worker requests) | 500 a minute | **about 5 seconds** |

**Conclusion.** The queue is cheap: one hibernating object costs almost nothing. **The matches it
makes are what Free cannot afford.** So the queue must not pair past a daily **public-match cap**:

- **The cap.** It is counted in the matchmaker's storage and resets at 00:00 UTC. Recommended at
  **12 a day**, which is about 32,000 rows and leaves roughly two-thirds of the row budget for
  friend rooms, feedback and snapshots. It is a `vars` value, so changing it needs no code change.
- **When the cap is spent,** every `join` gets `closed{reason: 'cap', until}`. The client remembers
  `until` and does not retry before it, and the screen offers "Play with a friend" instead.
- **A second breaker counts all rooms,** friend rooms included (P0). Past a total of, say, 30 rooms
  a day, a new public room is refused first. Friend rooms keep the rest of the budget.
- **The kill switch is `QUEUE_CLOSED`.** It is a secret or a D1 `flags` row, like
  `FEEDBACK_CLOSED`, so it needs no app deploy, and it gives `closed{reason: 'switch'}`.

**There is a lever if 12 a day is too few** (not recommended here). A busy room writes 2.2 rows a
second because every frame that carries a command closes its batch (R36). Closing a batch at most
once a second, even with commands, gives 1.2 rows/s, which is 1,440 a match and roughly 69 matches
a day. It widens the window of orders that a Durable Object restart can lose. Snapshot rejoin
(PR 808–862) makes that cheaper than it was, but it is the network lane's call, and it is not
taken here.

**On the paid plan**, which is not the lead's choice and is recorded only for comparison: Workers
Paid at 5 USD a month includes 400,000 GB-s, which is about 2,600 matches a month. Beyond that, a
match costs roughly half a US cent in duration plus rows. §6 asks at what demand that changes.

### 3.2 Rate limits and caps

Each limit is in the place where it is cheapest to apply.

| Limit | Where | Value (starting) |
|---|---|---|
| `QUEUE_LIMIT`, a new rate-limit namespace (id 1007), per connecting IP, on the upgrade | Worker, before any DO | 6 per 60 s; the IP is never stored, as with `ROOM_LIMIT` |
| One live queue socket per pid; a second `join` replaces the first | Matchmaker | 1 |
| Queue size | Matchmaker | 500 entries, then `closed{full}` |
| Messages per socket | Matchmaker | a burst of 8, then 1 a second (the room's token bucket, smaller) |
| Joins per pid per day | Matchmaker | 60 |
| Decline or time out at `found` | Matchmaker | cooldown 1 min, doubling to 15 min, forgiven after an hour without one; one row per penalty |
| Leave a started public match | Room (decision 23) | a loss now; a rated loss from P2 |
| Public matches a day | Matchmaker | 12 (§3.1) |
| Message size | Both | 4,096 bytes, the room's `MAX_MESSAGE_BYTES` |

Cloudflare's rate-limit binding is approximate and counted per location. It is a first filter, not
a guarantee. The caps inside the object are exact.

### 3.3 No personal data

- **What a request carries.** A `join` carries only these fields:
  - the anonymous player UUID;
  - a cleaned callsign (`cleanCallsign`);
  - the build string;
  - side and map sets;
  - a band from 0 to 4.

  There is no name, no email, no IP in a body, and nothing in a URL.
- **What the server stores.** It stores `pid`, the peppered HMAC (§1.3), and never the UUID. The
  `match_result` row holds the two pids, the map, the factions, the reason, the tick count, the
  build and a date. It holds no callsign. A callsign is typed by a person and may be a real name,
  so it lives only in the room for the match and in the matchmaker's memory for the wait.
- **Region.** If region is used (P3), it is Cloudflare's coarse `request.cf.continent`. It is read
  server-side, kept in memory for the life of the entry, never sent by the client, and never
  logged.
- **The public repo.** This document and the code name limits and policies, never a method for
  defeating them. A defence whose detail would teach an attack is described as "a server-side
  check" in public docs. It is pinned by a test, and the reasoning stays in the PR review.

### 3.4 Abuse that a rating invites (P2)

These are stated as policy only (§3.3).
- **Two ids of one person trading wins.** Repeat results between the same two pids within a day
  move the rating less and less. The queue avoids an immediate rematch with the same pid unless no
  one else is waiting.
- **Voiding matches you are losing.** A disagreement voids the match and leaves it unrated
  (§1.3). Voids are counted per pid, and repeated voids raise the same cooldown as declines.
- **Dropping instead of losing.** Decision 23 already makes a drop a loss, and P2 rates it.

---

## 4. What the shell needs

- **Route.** `/versus/public`, spelled only in `shell/links.ts` as `routes.versusPublic()`. It is
  registered in `main.ts` **before** `/versus/:code`. `PUBLIC` is six characters and could look
  like a code, but it can never be minted as one, because the code alphabet has no `I`. A test pins
  that `/versus/public` mounts the queue screen and not a lobby.
- **Entry point.** A third choice on `/versus`, beside Host and Join: "Find an opponent". The main
  menu stays as it is.
- **Screens.** These are four states of one `showVersusPublic`, not four routes.
  1. **Set up.** Side checkboxes, each with its reach ("Sarim plays on two maps"). Map checkboxes,
     using the existing `mapCard` pictures. The callsign. A notice: "Public: matched kit only.
     You'll play a stranger. Fog is a courtesy."
  2. **Searching.** The time waited. The band stage in words ("Looking for a close match",
     "Widening the search", "Any opponent"). The coarse searcher count. Cancel.
  3. **Found.** The opponent's callsign, the sides and the map, Accept and Decline, and a 15 s
     countdown.
  4. **Closed.** The reason ("Public matches are closed for today, back at 02:00", "Update
     available", "Cooling down: 2 min") and a link to "Play with a friend".

  After Accept, the room's 10 s face-off reuses the existing lobby screen in a read-only public
  form. It is reached through `net/handoff.ts` exactly as a hosted room is.
- **i18n.** Every string goes through `t()`, with new keys under `versus.public.*` in `en.json`.
  Times and counts are ICU plurals. No label table is resolved at module load: side reach and band
  stage use accessor functions, the `ui/role.ts` pattern. A pseudo capture in CI's `ui:shots` is
  the check, because `validate:ui`'s regex cannot see a string that reaches the DOM through a
  variable. Callsigns reach the DOM through `textContent` only.
- **The disposer contract.**
  - **Who owns what.** The queue screen owns the queue socket, the countdown interval and the
    elapsed-time interval. Each teardown is registered where its thing is created, through
    `onWindow`/`onAbort`.
  - **The disposer** sends `leave`, then closes the socket. It is idempotent and identity-scoped.
  - **Late arrivals.** A `matched` or `found` that arrives after disposal consults `disposed` and
    is dropped. The matchmaker treats the closed socket as a leave. The room, if one was already
    created, sees nobody's hello and ends `expired` when the lobby times out. That case is pinned.
  - **Ownership hand-off.** On `matched` the screen opens the room socket, parks it in
    `pendingLobby` under its code, closes the queue socket, and navigates. From then on the
    lobby's disposer owns the room, as today.
  - **Dialogs.** A Decline confirm uses `confirmDialog`'s `close`, which `Router.unmount()` also
    calls.
- **Storage.** One new key, `lions.versus.public.prefs`, holds the ticked sides and maps. Every
  access is guarded, because with site data blocked even reading the property throws. A refusal
  falls back to the defaults. The cooldown and the cap's `until` come from the server and are held
  in memory, with one optional guarded copy so a reload does not retry early.
- **Telemetry** (production builds only, as today):
  - `queue_join`;
  - `queue_matched{wait_s, stage}`;
  - `queue_left{phase}`;
  - `queue_closed{reason}`.

  None carries an id beyond the existing anonymous telemetry UUID.
- **CI walks.** `pnpm ui:routes` gains an arm: open `/versus/public`, start searching, cancel,
  leave, and assert that the body child count and the socket count are back to the menu's. That
  arm runs in CI only, never locally.

---

## 5. Phased plan

Each phase is one plan of 8–12 tasks, landed through a pull request with `gates` and
`determinism` green. No phase touches `@lions/sim`. A task that finds it must touch the sim stops
and raises it. Every new check below names its falsification: the one-line mutation that must turn
it red, run once and then put back (`falsification-casebook.md`). Oracles take literals.

### P0: results and budget. No queue.

| Check | What it pins | Falsification |
|---|---|---|
| Agreed result | The room writes a `match_result` row only when both seats send the same `over{tick, result}` and the hash at or before that tick agreed | Make the room accept the first report: the test where one seat claims the win must go red, because a row is written |
| No raw id stored | The row holds `pid` (the HMAC) and never the UUID | Write the raw UUID: a test that searches the written row for the literal UUID string goes red |
| Room budget breaker | Past `ROOM_DAY_CAP` rooms a day, a new room is refused with a 503, and public rooms are refused first | Change `>=` to `>` in the check. With a cap of 2, the third create must fail and does not |
| Queue cost model | `tools/src/net/queue-budget.ts` drives the matchmaker core in `fake-do.ts` with 10, 100 and 1,000 synthetic queuers and prints rows, requests and alarms (a report). A test pins **rows written per pairing ≤ 2** and **alarms per pairing ≤ 1** | Persist each entry on `join` (one `put`), or replace the next-feasible alarm with a 5 s period: the pinned counts go red |

**Gate.** The lead plays one friend match. He then reads the live dashboard's rows written,
duration and requests for that day. These must be within 2× of §3.1's per-match figures. If they
are not, §3.1 is redone before P1.

### P1: the open queue, unrated

| Check | What it pins | Falsification |
|---|---|---|
| Pair legality | Over every combination of side sets ({K}, {S}, {K,S}) × map sets (the 15 non-empty subsets of the four fair maps) for both players, no pair is Sarim v Sarim, no KDF v Sarim is off `tel_marum`/`wadi_tarfan`, no side is outside a player's ticks, and no map is outside both sets. The oracle is a **literal table** in the test, never an import of `matchupAllowed` | Replace the matchmaker's use of `matchupAllowed` with `() => true`: red |
| Free side pick | A player who ticked only KDF is never seated as Sarim, across 10,000 draws with a seeded test random source | Make the side fall back to `'sarim'` when KDF is infeasible: red |
| Build pools | Two builds never pair | Drop the build from the pool key: red |
| Accept before room | No room is created unless both players accept; a decline requeues the accepter with their wait kept | Create the room at `found`: the count of room creates in the decline test goes red |
| Public room refusals | A public room refuses `/join`, `/advisor` and `kit: 'brigade'` | Delete each refusal in turn: three reds |
| Daily cap and kill switch | After 12 public rooms, `join` gets `closed{cap}`; with `QUEUE_CLOSED` set, `closed{switch}` | Off-by-one on the cap; read the switch from the wrong name: red |
| Hibernation | The matchmaker never calls `setInterval`, and a keepalive does not reach `webSocketMessage` (fake-DO counters) | Add a 1 s `setInterval` heartbeat: red |
| Join cleaning | `cleanQueueJoin` keeps exactly the six fields of §3.3. An unknown field, an oversize callsign or a band of 7 does not survive. A client test asserts the upgrade URL has no query string | Pass the body through: red. Append `?player=` in the client: red |
| Disposer | Leaving the screen mid-search sends `leave` and closes the socket. A `matched` delivered after dispose opens no room socket (jsdom) | Remove the close from the disposer: red |
| Route order | `/versus/public` mounts the queue screen | Swap the two route registrations: red |
| i18n | `__lionsI18n.missingKeys()` is empty after walking the four states; CI's pseudo `ui:shots` shows no unbracketed word on the screen | Hard-code one label: the missing-key test catches a key typo, the pseudo capture an English literal |

**Gates.**
- The lead and a friend, on two machines and the deployed build, are paired through the queue three
  times: KDF v KDF, KDF v Sarim, and Sarim v KDF.
- One of them declines once and sees the cooldown.
- The lead sets `QUEUE_CLOSED` and both see `closed`, with no app deploy.

**Before P1 opens to strangers,** the lead decides about the separate relay Worker (§6, Q9).

### P2: the hidden rating

| Check | What it pins | Falsification |
|---|---|---|
| Glicko-2 arithmetic | Glickman's published worked example, as literals. A player at r 1500, RD 200 plays three games: beats 1400/30, loses to 1550/100, loses to 1700/300, with τ 0.5. The result must be r′ ≈ 1464.06, RD′ ≈ 151.52, σ′ ≈ 0.05999 | Change the scale constant 173.7178, or τ: red |
| Rated only when agreed and public | A friend room, a void match, or a disagreement changes no rating | Rate every ended room: red |
| Repeat damping | The tenth result between the same two pids in a day moves the rating less than the first | Remove the damping factor: red |
| Band | A pair 300 apart is not feasible before 15 s and is feasible by 60 s; the mutual rule holds (a 5 s newcomer is not paired with a veteran who has waited 5 min); band edges at the literal table values | Freeze the band at 100, or use `max` instead of `min` of the two bands: red |
| Rating separates skill | `pnpm arena` drives `rush` against `passive` for 200 games through the matchmaker core (in-process, local relay). Afterwards `rush`'s pid rates above `passive`'s by more than 2·RD | Swap the result's winner when it is recorded: `rush` rates below and the check goes red |

**Gate.** The first 200 rated public results are read in `/stats`: the mean gap at pairing by band
stage, and the wait by stage. The §2.3 constants are revisited then, and not before.

### P3: after ST5 (GH-204)

- **Identity.** `pid` is derived from the Steam id that ST5 validates, not from the anonymous
  UUID. A one-time claim carries an anonymous rating over on first sign-in (Q7).
- **Region placement.** Place the room with `locationHint`, from the two players' continents.
  Region becomes a band axis only if waits allow it.
- **A trusted badge.** ST6 (GH-205) can show the "kit owned" from §1.1 trustworthily, for bought
  items. It stays a badge and never pairs.
- **Two queues.** Rated and unrated queues split only when the waits measured in P2 allow it.

**Checks.** An anonymous-only pid cannot claim an id that a Steam id already holds (falsify: allow
a second claim, which must go red). Region never makes a feasible pair infeasible after 60 s
(falsify: a hard region filter must go red).

---

## 6. Questions for the lead

The recommendation comes first in each.

1. **Should P0–P2 wait for ST5 and ST6, as GH-687 says?** **Recommended: no.** P0 and P1 need
   neither. P2 runs on the anonymous id with a provisional rating, which is honest about what a
   free identity can carry. ST5 is what P3 waits for. *Alternative:* keep the issue's order, so
   that nothing starts before ST5 and ST6.
2. **What "similar brigade level" means.** **Recommended: a hidden versus rating held by the
   server, with brigade level shown only on your own screen.** Brigade level is a P1 tie-break and
   never a constraint. *Alternative:* pair on the service-record band as the lead first put it,
   accepting that a player who claims a low band will be paired with new players.
3. **The daily public-match cap on Free.** **Recommended: 12 a day**, with the queue closing
   politely when the cap is spent, and a total room breaker that protects friend play.
   *Alternatives:* 20 a day, which uses about half the row budget; or take the paid plan
   (5 USD a month) when the cap is hit on three days in a week.
4. **Chat with strangers.** **Recommended: off in public rooms.** Strangers see only the other
   player's callsign and the end-of-match panel. *Alternatives:* the friend rooms' 280-character
   chat; or a short list of preset phrases (a new message kind).
5. **Pauses in public rooms.** **Recommended: one 60-second pause per seat**, instead of the friend
   rooms' three of 90 s, because a stranger can use pauses to grief. *Alternative:* the friend
   rule unchanged.
6. **Sides that cannot always meet.** A player who ticks only Sarim can meet only a KDF ticker, on
   two maps. **Recommended: accept it, and say so on the set-up screen.** *Alternative:* offer
   Sarim v Sarim, which first needs a fairness reading at 48 seeds per spawn order
   (`pnpm versus:probe`).
7. **Anonymous ratings at ST5.** **Recommended: carry an anonymous rating over once, on first
   Steam sign-in, by presenting the old UUID.** *Alternative:* reset everyone at ST5.
8. **Results from friend rooms.** **Recommended: record them in `match_result` for `/stats`, but
   never rate them**, because two friends can trade wins. *Alternative:* do not record them either.
9. **A separate relay Worker before strangers play.** **Recommended: yes, before P1 opens beyond
   the lead's own testers.** Every merge to `main` restarts every live room. A friend forgives a
   hiccup; a stranger who loses a rated match to a deploy will not. The change is a `script_name`
   binding, and since it is a production deploy change it is the lead's to schedule.
   (PR 877's decision 9 deferred it "until outside testers play"; public matchmaking is that
   moment.) *Alternative:* keep one Worker and pause merges during peak hours.
10. **A rating that strangers can see.** **Recommended: hidden in P2.** Show your own rating as a
    word band ("Recruit" to "Veteran"), and show no leaderboard on Free. *Alternative:* show the
    number. A leaderboard waits for ST5.
