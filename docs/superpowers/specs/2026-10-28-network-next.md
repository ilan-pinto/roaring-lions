# Network lane: what remains of GH-191, and the next milestone

**Status:** a read-only audit and a proposal for the lead. No code changed. The lead's
decisions are in §5, each with its recommendation first.
**Read against:** `origin/main` `f945fca5` (28 Oct 2026).
**Sources:** GH-191, GH-190, GH-169, GH-687, GH-691 and their comments; the network game
design (`2026-10-10-network-game-design.md`, "the spec") and the snapshot design
(`2026-10-25-net-sim-snapshot-design.md`); the plans `2026-10-11-net-n0…` through
`2026-10-27-net-sim-snapshot-s4.md`; `packages/net/src`, `packages/worker/src/match`,
`packages/app/src/net`, `tools/src/net`; `docs/HANDOVER.md`'s net row; and the merged PRs
whose title contains "net", "versus", "seat", "snapshot" or "N3".

PRs are written "PR 543". Issues are written GH-NNN.

---

## 0. In one page

- **Most of GH-191 has shipped. It shipped as 1v1 versus, not as co-op.** The lockstep core,
  the transport, the lobby, reconnect, desync capture, the KDF-v-Sarim seat, tunnels, fair
  maps, the AI harness and snapshot rejoin are all on `main`. That is 30-odd PRs between
  12 and 27 Oct. Asymmetric 1v1 was meant to follow M4, and it landed first.
- **Co-op does not exist as a product.** The only form of it is N0's test room:
  `/free-play/<map>?net=new`. In that room two humans order one shared KDF force against the
  map's placed enemy. It has no mission, objectives, lobby or split ownership, and you can
  only reach it by typing the URL. A mission is refused in a room (`main.ts`: "a room runs
  Free Play only"). The lead ruled co-op out on 11 Oct (spec decision 2). G5 GH-169 records
  it as "not applicable".
- **Co-op is now cheap, because the hard parts were built for versus.** The mission runtime
  boots inside a room (N3). Its digest is folded into the hash (N2). The snapshot covers it
  (S2). Every rule in `mission.ts` that assumes "side 0 is the player" (ROE, fire support,
  field works, `unitLost`, Conduct) is right as it stands when both seats are on side 0.
  All 26 non-tutorial missions already boot from an empty ledger with their starting force
  on loan. That is the path `pnpm playtest` uses.
- **Recommended next milestone: N5, co-op against a mission.** Two friends on side 0 play
  any shipped mission against its scripted enemy, and each commands their own half of the
  force. Nothing is written to the campaign. It needs no AI commander, which is unbuilt
  (GH-187, GH-188), and no new balance work. It is the only way two friends can play
  together against the computer before WP-G-G lands. The first three tasks are in §4.
- **Before any code is written, the lead has three gates of his own to run** (§1.2). None
  needs code, and they are the cheapest evidence the lane can get.

---

## 1. GH-191's promised items

### 1.1 The table

GH-191's body promises the items marked "191". The spec re-scoped GH-191 to N1–N3 and added
the items marked "spec". Status means what is on `main`.

| # | Item | From | Status | Landed in |
|---|---|---|---|---|
| 1 | Tick-scheduled command frames; the room is the 20 Hz metronome | 191 | **Shipped** | PR 543 (N0) |
| 2 | Input-delay buffer: next room frame, clients 2 frames behind | 191 | **Shipped** | PR 543; measured on the lead's two-machine run, 14 Oct (GH-190) |
| 3 | Side-scoped command validation: ownership, map bounds, structure and route ids, command whitelist, flood caps | 191 | **Shipped** | PR 543, PR 554 (N1a), PR 566 (security review) |
| 4 | Hash exchange every N ticks, with a runtime digest and a per-client content digest | 191 | **Shipped** | PR 543, PR 644 (digest seams), PR 686 (N2) |
| 5 | Transport per G5: a Durable Object room in the existing Worker (Colyseus withdrawn, WebRTC rejected) | 191 | **Shipped** | PR 543; G5 answered in the spec and on GH-169, but **the issue is still open** |
| 6 | Lobby and session screens: room code and link, Ready, side pick, map card, "bring your brigade" | 191 | **Shipped** | PR 556 (N1b), PR 589, PR 649, PR 689 |
| 7 | Pause, surrender, chat, rejoin, forfeit on drop, stalemate and cap by force value | spec | **Shipped** | PR 556, PR 558, PR 579 |
| 8 | Fast reconnect from a sim snapshot | spec follow-on | **Shipped** | PR 808, PR 823, PR 842, PR 854, PR 855, PR 862 (S1–S4). A 24,000-tick rejoin now freezes the opponent for 343 ms instead of 3,657 ms |
| 9 | Desync tooling "on the recorder" | 191 | **Partial** | PR 556: the match halts at the first unequal hash, a Report button opens a prefilled form, and D1 `match_desync` keeps the config, the frames and both hashes. **Nothing replays a stored desync to find the first tick where the two sims part**, and the feedback replay recorder is withheld from a room's report (R-B16) |
| 10 | **Co-op on the existing missions: split the KDF force, share Conduct, share the grade and the credits** | 191 | **Missing** | Ruled out by spec decision 2 (11 Oct). See §2 |
| 11 | Asymmetric 1v1, "its own package after M4" | 191 | **Shipped, early** | PR 589 (quick version), PR 758 (N3: camps, purses, doctrine production, `patrol`), PR 737 + PR 762 (Sarim tunnels), PR 725, PR 775, PR 793, PR 796 (fair seats on all three versus maps) |
| 12 | "The Stage 5 commander as the practice opponent" | 191 | **Missing** | The doctrine commander is a spike only (GH-187: "no-go on the design as built"). N4b's `passive` and `rush` bots exist, but in tools only (`pnpm arena`). The lobby offers no computer seat |
| 13 | KDF v KDF mirror match | spec N1 | **Shipped** | PR 554, PR 596, PR 600. **It is placed force only.** `economyRoom` is true only when the two factions differ, so a mirror match has no production |
| 14 | AI harness (MCP, three scopes), advisor panel, arena | spec N4 | **Shipped** | PR 619, PR 632, PR 667. Its in-repo statistical gate passed: `rush` over `passive`, p = 0.019 |
| 15 | Match scoreboard (kills, losses, force value) | lead, 14 Oct | **Shipped** | PR 587 |
| 16 | Three-engine determinism in CI (Chromium, Firefox, WebKit) | spec §12 | **Shipped** | PR 678 |
| 17 | Pings between the seats (spec decision 15) | spec | **Missing** | `ping` reaches only the advisor channel (`net/advisor.ts`). The seat-to-seat relay message in §3.2.3 was never built |
| 18 | Speed set by the host (spec decision 17) | spec | **Missing** | Rooms are realtime, or paced for a bot. A human room has no speed setting |
| 19 | A UI verb for `patrol` | spec N3 | **Partial** | The command, the sim and the gate are built. "No UI verb issues it yet" (spec §6.1) |
| 20 | Sarim v Sarim | spec §0 | **Missing** | `matchupAllowed` offers the mirror (KDF v KDF) and KDF v Sarim only |
| 21 | Spectators, the insurgent toolkit, accounts (ST5), skirmish payouts, the remote arena | spec follow-ons | **Missing** | Each is named in the spec as having its own spec. None has one yet |

### 1.2 The gates still open

All three belong to the lead. None needs code.

| Gate | What it asks | State |
|---|---|---|
| N1 | Ilan and a friend play three matches to a result, and one deliberate desync is reported end to end | One match was played (14 Oct, "highly enjoyable"). No deliberate desync is recorded on any issue |
| N3 | Ilan plays five KDF v Sarim matches | Open. The start purses (KDF 1500 / Sarim 2400) are still marked provisional |
| N4 | An `assist` advisor finishes a match with Ilan, and a ten-seed arena runs between two models | Open. It needs a model key, which no subagent touches |

**Housekeeping found in passing:**

- GH-169 (G5) is still open, although the spec answers all three of its questions.
- M4 has not been re-dated. HANDOVER's milestone line reads 26 Mar 2027, and the spec
  proposes end of February.
- HANDOVER §2 still says "ST5 shares its Supabase/Postgres project with M4's Colyseus relay".
  The spec retired that pairing. HANDOVER is rewritten by the plan-refresh routine, so this
  file records it rather than editing HANDOVER.

---

## 2. Does co-op exist in any form?

**Not as a product. There is one crude dev form.**

| Form of co-op | Exists? | Where |
|---|---|---|
| Two humans on one side, sharing one force, on a map with a placed enemy | **Yes, dev-only** | N0's sandbox room: `/free-play/<map>?net=new&callsign=A`, then `?net=<CODE>` on the second machine. `mode: 'sandbox'`, both seats on side 0, `humanHeld [true, false]`. No lobby screen links to it. No mission, objectives or waves run. Either seat can order any unit. No forfeit rule and no snapshot producer |
| Two humans on one side, each with their own units | No | `validateCommand` checks ownership by side. Nothing assigns a unit to a seat within a side |
| Two humans playing a campaign mission together | No | `bootBattlefield` refuses a `missionId` in a room |
| Two humans against a skirmish AI | No | No skirmish AI commander exists (GH-187, GH-188). The arena bots cannot be reached from the lobby |
| 2v2 | No | GH-691, which needs a design first |

**Why co-op on a mission is now cheap.** The design ruled co-op out on product grounds:
the campaign stays single-player. Cost was not the reason. Since then, versus has built most
of what co-op needs:

- the runtime boots inside a room (N3, `buildMatchWorld`);
- `MissionRuntime.digest()` is folded on every hash tick (N2);
- the snapshot classifies and restores every `MissionRuntime` property (S2). Its coverage
  census fails on any property that has no class;
- every side-0 rule in `mission.ts` (ROE and Conduct, fire support, field works, the
  production anchor, `unitLost`) is right without change when both seats are on side 0;
- a mission boots from an empty ledger, with its starting force issued on loan, which is
  how `pnpm playtest` boots every mission.

What is genuinely new:

- a unit-to-seat table within one side;
- a room that ends on the mission's own result;
- a mission picker in the lobby;
- a guarantee that nothing reaches the ledger, the brigade or the saves;
- a drop rule that fits partners rather than opponents.

---

## 3. The gaps, ranked by value to the lead and by cost

Value is measured against the stated goal, "play with a friend". Cost: **S** is a few tasks,
**M** is one 8–12-task plan, **L** is several plans or new sim mechanics with balance behind
them.

| Rank | Gap | Value | Cost | Why this rank |
|---|---|---|---|---|
| 1 | **Run the three open gates** (N1, N3, N4) | High | S (the lead's evenings) | This is the only evidence of how real play goes. N3's purses are provisional until he has played. No code |
| 2 | **Co-op against a mission** (GH-191 item 10) | High | M | The original promise. It is the only together-against-the-computer mode reachable before WP-G-G, and it unlocks 26 missions of content |
| 3 | Seat-to-seat pings, and a `patrol` UI verb | Medium | S | Co-op needs "go here" more than versus does. Both are already designed |
| 4 | An economy in the mirror match (KDF v KDF with production) | Medium | S–M | This is the matchup the lead played. Production is what N3 made deep. It needs mirror rules files and a fairness reading at 48 seeds |
| 5 | A computer seat in the lobby (play the `rush` bot) | Medium | M | Practice, and play when no friend is online. The real commander is GH-188's, at cost L |
| 6 | 2v2, and 3–4 players (GH-691) | Medium | L | More friends at one table. A design comes first. Co-op's seat-within-a-side table is half of 2v2 |
| 7 | The insurgent toolkit (IEDs, crowd cover, `dig`, a Sarim ladder and fire support) | Medium | L | Gives the Sarim seat depth. New sim mechanics, with balance behind them |
| 8 | A desync bisector: replay a D1 `match_desync` row to its first divergent tick | Low–Medium | S | It matters only once a desync happens, and none has been reported |
| 9 | A separate relay Worker, so a deploy stops restarting live rooms | Low–Medium | S, plus a lead deploy action | Every merge deploys. Snapshot rejoin keeps the hiccup near 2 s, but an order in flight can still be lost (R36) |
| 10 | Spectators and match replays as a feature | Low | M | The frame log already makes them nearly free |
| 11 | Speed set by the host; Sarim v Sarim | Low | S each | Small asks nobody has made |
| 12 | Accounts, the server ledger, matchmaking (GH-204, GH-205, GH-687) | Low for friends | L | Product work for public play, not for a friend |

---

## 4. Recommended milestone: N5, co-op against a mission

**What it is.** Two friends join one room. Both are KDF on side 0, with matched kit. They
pick any shipped mission except the tutorial. Each commands their own half of the starting
force, against the mission's own scripted enemy, waves and triggers. The room ends on the
mission's own result: victory, defeat, or `withdrawn` at the time limit. The debrief shows
the objectives and the grade. **Nothing is written to the campaign ledger, the brigade
account, the saves or the credits.** That keeps the essence of decision 2.

**Touches:** `packages/net`, `packages/worker/src/match`, `packages/app`. It is expected to
change no sim file and move no sim pin. If a task finds that it must touch the sim, it stops
and raises it.

**Gate:**

- the lead and a friend finish three missions together, at least one won and one lost;
- hashes stay equal throughout;
- one reload mid-mission rejoins through the snapshot path;
- the campaign's `localStorage` keys (ledger, brigade account, tutorial flag, save slots)
  are byte-identical before and after a co-op win.

**The first three tasks:**

1. **A co-op room boots a mission identically on both machines.**
   - Add `mode: 'coop'` and a `mission` id to `MatchConfig` (`validateConfig`, `routes.ts`).
     The mission list is every shipped mission except `beit_sahwan_0_tutorial`, refused
     before a room exists, as `versusMapAllowed` does for maps.
   - Both seats are side 0, KDF, with matched kit. `seatRules` gives `[true, false]`.
   - `buildMatchWorld` boots the real mission JSON's runtime from ledger `{}`, through the
     fresh-ledger starting-force path, and skips the deploy screen's picks.
   - Witnesses:
     - `tools/src/net/two-client.test.ts` gains a co-op stream on two missions: one with
       civilians and waves, one with a tunnel. It is falsified by one frame delivered out
       of order, which must go red at that tick.
     - The snapshot witness gains a co-op arm.

2. **Each seat commands its own units.**
   - A deterministic unit-to-seat table lives in `@lions/net`. It is derived from config and
     spawn order only, never from either browser. The split rule is decision 2 below.
   - `validateCommand` refuses an order for the other seat's unit.
   - Selection, box-select and the HUD cards take your own units only.
   - Your friend's units draw in a second team-colour variant (`variantAwareResolver`).
   - Fire support, field works and Conduct stay shared on side 0 (decision 5).
   - Pins: an order for the friend's unit vanishes identically on both clients, falsified
     by removing the seat check.

3. **The lobby offers co-op, and the room ends on the mission's result.**
   - The `/versus` face-off lobby gains "Play a mission together", with a mission card and
     its briefing shown to both seats. Any new path is spelled only in `shell/links.ts`'s
     `routes`, and every string goes through `t()`.
   - The runtime's `checkEnd` result reaches `ended{result}` for both seats on the same tick.
   - The co-op drop rule (decision 4) replaces the versus forfeit.
   - The debrief takes a "write nothing" flag. A test boots a co-op win and asserts that
     `lions.campaign.ledger`, `lions.brigade.account`, `lions.tutorial.done` and
     `lions.saves` are byte-identical afterwards. It is
     falsified by calling the victory write.

**Later tasks in the same plan:**

- seat-to-seat pings (gap 3);
- a playtest arm that reads mission difficulty with two plans on one side (a report, not a
  tuning target);
- the lead's run sheet in `docs/net/`.

---

## 5. Decisions for the lead

The recommendation comes first in each.

1. **Open co-op now as N5, the next network milestone.** **Recommended: yes.** This amends
   decision 2 in part: a co-op room plays a mission and writes nothing to the campaign, the
   brigade, the saves or the credits, so the campaign itself stays single-player.
   Alternatives: keep decision 2 as it stands and make the next milestone the mirror economy
   plus pings (gaps 3–4); or wait for the doctrine commander and do co-op against the AI.
2. **How the force is split.** **Recommended: by placement.** Starting placements alternate
   seat 0, seat 1 in mission order, and each reinforcement goes to the seat with fewer living
   units, with ties to seat 0. Alternatives: one shared force, as in the N0 room, which is
   simplest but lets the two players fight over a unit; or the host splits it in the lobby.
3. **Kit and missions.** **Recommended: matched base kit, every shipped mission except the
   tutorial, an empty ledger, and no rebalance.** Two players will find most missions easier;
   the two-plan playtest arm measures that before anything is tuned. Alternatives: a curated
   three missions; or "bring your brigade" per seat, as in versus.
4. **When a partner drops.** **Recommended: after 60 s the remaining seat takes over the
   dropped seat's units, the mission goes on, and a rejoin hands them back.** Alternatives:
   void the mission; or forfeit, as versus does, which punishes the partner who stayed.
5. **What is shared.** **Recommended: fire support, field works and the Conduct score are
   shared, and either seat may call support.** Alternative: seat 0 alone calls support.
6. **Payout.** **Recommended: none in N5**, which matches versus decision 20. Credits for a
   co-op result is a later ST or G-G question.
7. **Order after N5.** **Recommended:**
   - the small batch next: pings, the `patrol` verb, the mirror economy;
   - then the 2v2 design (GH-691), which reuses co-op's seat-within-a-side table;
   - the computer seat in the lobby and the insurgent toolkit wait on WP-G-G's commander and
     on N3's matches.
8. **The lead's own actions, independent of the above:**
   - run the open N1, N3 and N4 gates (§1.2);
   - close GH-169: its co-op answer becomes "N5, a mission together, nothing written to the
     campaign" if decision 1 is yes;
   - re-date M4 on the plan page. **Recommended:** M4 is met for 1v1 once N3's five matches
     are played, and M4's co-op half is N5's gate.
9. **A separate relay Worker.** **Recommended: defer it until outside testers play.**
   Snapshot rejoin keeps a deploy's hiccup near 2 s. The fix is small: a `script_name`
   binding. But it is a production deploy change, so it is the lead's to schedule.
