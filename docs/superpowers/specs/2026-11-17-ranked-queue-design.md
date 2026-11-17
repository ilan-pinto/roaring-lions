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
## 2. The leaver penalty
## 3. Matchmaking inside the relay design
## 4. The D1 schema and the migration plan (ACCOUNTS)
## 5. Abuse cases
## 6. What /privacy must say, and retention
## 7. Cost against the D1, KV and Durable Object budgets
## 8. Slices and falsifiable checks
## 9. Open questions for the lead
