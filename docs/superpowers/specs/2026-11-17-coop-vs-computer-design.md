# Co-op against the computer (GH-1392): two players against the commander — design for the lead

**Date:** 2026-11-17 · **Status: HOLD FOR LEAD.** Docs only: no code, data, schema, config or deploy is changed by this document.
**Issue:** GH-1392 ("Two players in a friend room start a match against one or two computer seats; reconnect and desync capture behave as
in 1v1. The mode is offered in the lobby with no flag. When team play (GH-691) lands, computer seats can fill any empty seat.")
**Reads against** `origin/dev` at `5b56e907b`: `packages/net/src/{config,ownership,frames,lockstep,digest,protocol,seat-rules,bot-model}.ts`,
`packages/app/src/net/computer/*` (the `ComputerSeat`), `packages/app/src/net/{offline-match,offline-slot,match-world,versus-force,
versus-formations,outcome,snapshot-gate}.ts`, `packages/worker/src/match/{routes,match-room,room-core,record}.ts`,
`packages/worker/migrations-accounts/0001_members.sql`, `packages/worker/src/privacy-page.ts`, `packages/app/src/ui/chat-inbox.ts`; and
these documents and branches:
- the relay split design `2026-11-15-relay-worker-split-design.md` (hard-cut text, PR 1482, merged), and PR 1550 (R1 to R4, open);
- PR 1549 (GH-1389, computer levels as data, open, HOLD FOR LEAD) and its three reviews;
- PR 1558 (GH-1390, the commander coverage probe, open): **the computer seat builds nothing**;
- GH-1391 (make the commander scout, counter and defend; blocked on the lead unparking balance);
- the chat safety design `2026-11-16-versus-chat-safety-design.md` (GH-1417) and what landed of it (S1 inbox and mute, S1b quick chat, D11);
- the A3 versus-records notes (`docs/agent-notes/shell-and-ui.md`, "Accounts A3");
- **the N5 co-op plan `docs/superpowers/plans/2026-10-28-coop-n5.md`** and its spec `2026-10-28-network-next.md` §4–5. The lead approved
  N5 on 28 Oct with decisions 2 to 6 as recommended. N5 has not been executed: there is no `coop.ts` in `@lions/net` on `dev`.

Issue refs are written GH-NNN; PRs as "PR NNNN".

---

## 0. The answers up front

1. **It is a versus room with a third seat, not a new mode.** The room keeps `mode: 'versus'`, so every versus rule (intel and fire
   support dropped, formations by room kind, the outcome rule, the match cap, the snapshot cadence) applies unchanged. The config gains
   a third `SeatConfig` and one marker, `coop: true`. Seats 0 and 1 are the two humans, on the same side; seat 2 is the computer, on the
   other side. N5's mission co-op (`mode: 'coop'`) is a different product and keeps its own mode (§2.1).
2. **The two humans share ONE side and split ONE placed force.** The friendly end's placed force is split by placement, alternating
   seat 0, seat 1 (N5's approved decision 2). The computer fields one placed force at the hostile end, cut by its level's `withhold`
   (PR 1549). That keeps the measured mirror world: the spawn ground, the anchors and the cap are the 1v1 mirror's. Two humans against
   one force will win more than one human does; the co-op ladder measures by how much before a handicap is chosen (§4.4, Q2).
3. **Each human commands only the units they control.** N5's seat-within-a-side table (`CoopSeats`: owner per entity, a handover flag
   per seat) gates `validateCommand` deterministically on every client. Side-scoped orders (production, set-up) are shared. A partner
   who drops for 60 s hands their units to the one who stayed, and a rejoin hands them back (N5's approved decision 4).
4. **The computer runs on ONE human's client, its "runner", and its orders travel through the room as seat 2's** — stamped into the
   frame log like any human order. Determinism therefore never depends on the computer's code: every client applies the same log, and
   the `ComputerSeat`'s floating point (`Math.hypot`, the fog tracker) never reaches a hash. The partner runs a warm standby copy
   that sends nothing and takes over at once if the runner drops (§3.2). Running it in the Durable Object (the room would have to step a
   sim) or in every client (the commander would have to become fixed-point and part of the snapshot) are compared and not recommended.
5. **The price of (4) is that the runner can puppet the enemy.** A modified client can send any seat-2 order. That is acceptable only
   because **a co-op match carries no stake**: no Roar coins, no brigade credits, and **no W-L record** in v1 (§4). If co-op results ever
   pay or rank, the computer must move to the deterministic option first (Q1).
6. **Desync detection is the two humans' hashes**, compared as today; the computer sends none (it is not a separate sim). Reconnect is
   the snapshot path, opened for this room shape (`snapshot-gate.ts` today refuses any room with a bot seat).
7. **The lobby gets a third button beside "Play with a friend" and "Play the computer": "Play together against the computer".** The host
   picks the map (the mirror maps), the level (easy, medium, hard from PR 1549), shares the code, and the friend joins. The ROOM mints
   the computer seat; no client can claim it.
8. **Chat is between the two allies only, through the existing inbox** (mute, chat off, quick chat), plus N5's pings. The computer reads
   no chat, ever. The room stores no chat. `/privacy` gains two sentences; telemetry records nothing new.
9. **Dependencies: the commander must build first (GH-1391).** A co-op room can be built and tested on the mirror before that, behind a
   dev flag. It is **offered in the lobby with no flag only after** the commander plays production (PR 1558 finding A) and the relay split
   is cut (GH-1397), because co-op adds relay code and a relay deploy ends live rooms. Slices C0 to C9 are in §7.
10. **Fourteen questions for the lead** are in §10. The ones that carry the most weight: Q1 (where the computer runs, and so whether
    co-op can ever carry a stake), Q2 (the handicap for two against one), Q3 (one force split, or one force each).

---

## 1. What exists today (facts)

| Fact | Where |
|---|---|
| A versus config has exactly **two** seats. `Seat` is `0 \| 1`; `seats: [SeatConfig, SeatConfig]`; `validateConfig` refuses any other length; the wire's `isSeat` is `v === 0 \|\| v === 1` | `packages/net/src/config.ts`, `protocol.ts` |
| `SeatConfig` carries `seat, side, faction, kit, tiers, unlocks, player, callsign, kind` (`human` or `bot`); PR 1549 adds `withhold`, accepted only on a bot seat of a versus config, and minted only by `offlineConfig` (the room never mints one) | `config.ts`; PR 1549 diff and reviews |
| **There is no separate config digest.** The network hash is `matchDigest(sim.hash(), runtimeDigest, contentDigest)`. `config.dataDigest` is minted 0 and folded nowhere since ruling L4. Each client folds the digest of its OWN content | `digest.ts`, `config.ts` (`dataDigest` comment), PR 1549 reviews ("I found no separate config digest") |
| **Ownership is by side, not by seat.** `validateCommand`'s `own(id)` is `sideOfEntity(id) === sideOfSeat(seat)`. The sandbox room (N0, dev only) puts two humans on side 0, and either can order any unit | `ownership.ts`; `2026-10-28-network-next.md` §2 |
| The order every client applies is `(seat, seq)`; arrival order is not an order | `frames.ts` `canonicalOrder` |
| The `ComputerSeat` (GH-1388) is the arena's `rush` script plus a straggler sweep. It reads a fog-honest `SideView` built from its OWN `FogTracker`, and hands `Command`s to an `OrderDesk` (at most one flush of four commands every 20 ticks). It decides every 100 ticks. **It runs offline only**: `OfflineMatchTransport` is the whole "room", the human is seat 0, the computer seat 1, and its orders go into the frame of the tick they were decided for | `computer/computer-seat.ts`, `computer/policy.ts`, `offline-match.ts` |
| The computer's code uses floating point: `Math.hypot` in `rush`, float centroids in `sweepStragglers`, `fx.toNumber` sight and the renderer's `computeFog` in `FogTracker`, `Math.round`/`Math.sqrt` in the view. Harmless offline (one machine); it would be a desync risk on two | the same files |
| **The computer seat builds nothing.** On 992 probe games the commander issues a median of 2 orders a game; 180 of 192 KDF-v-Sarim economy games ended on the clock; points and flag goals are not played; it loses to a passive opponent in 45% of games | PR 1558, `docs/net/commander-coverage.md` |
| The lobby offers the computer on the **mirror pairing only**, annihilation only, with no level picker | `ui/versus.ts` (`playComputer`), `offline-match.ts` (`offlineConfig` throws on any other matchup) |
| Three computer levels exist as data on PR 1549: easy leaves both Lavis home (72.8% of the force's value), medium one (86.4%), hard none (100%). The ladder: pooled computer win rate 1-1.4% / 12-17% / 42-54% against scripted single players | PR 1549 |
| Withholding a Lavi shifts the ids, and so the RNG streams, of every later unit of THAT side. The human's ids are stable only because the friendly end spawns first | PR 1549 reviews, finding 1 |
| Per-seat kit is app-side: `buildMatchWorld` registers side 0's roster, then a second copy of each KDF type whose cleaned claim differs on side 1, and spawns each side through its own table (`typeOfBySide`, `kitBySide`). The sim keys nothing on a type's id | `match-world.ts`, `per-seat-types.test.ts` |
| `economyRoom` and `roomKindOf` compare **`seats[0]` with `seats[1]`**, and `formationsOpenIn` returns `true` for any mode that is not `'versus'` | `config.ts`, `versus-formations.ts` |
| `seatResultOf` names the winner as `config.seats.find((s) => s.side === result.side).seat`: the LOWEST seat of the winning side | `outcome.ts` |
| The snapshot producer runs only when every seat is human | `snapshot-gate.ts` (`config.seats.every((s) => s.kind === 'human')`) |
| The room is two-seat throughout: `RoomState.seats`, `over`, `overResults`, `pausesLeft`, `lastChatMs`, `cmdTokens`, `doneRound`, the `hashes` pair, `settleOver`'s `[0, 1]`, the forfeit (the dropped seat loses, "the other seat wins"), and the `desync`, `paused` and `advisors` messages are pairs | `room-core.ts`, `protocol.ts` |
| A3 records only an AGREED result: both seats' `over` carry the same tick and result, with a compared hash within one cadence of it. `match_seat.seat` and `match_record.winner_seat` are `CHECK (… IN (0, 1))` | `room-core.ts` `recordOf`, `record.ts`, `0001_members.sql` |
| Versus pays 0 coins and writes no wallet or journal row; brigade credits pay only for a campaign mission | A3 notes; CLAUDE.md "Brigade credits" |
| A net room sends no match telemetry: `missionTelemetry` is built only on the mission branch | `main.ts` (`missionStarted`) |
| Chat: one inbox in front of both sinks, per-match mute, chat off (S1); twelve quick-chat ids (S1b); spectators hear none (D11). No word filter, block or report yet | `ui/chat-inbox.ts`, `protocol.ts` `QUICK_CHAT_IDS`, PRs 1479, 1488, 1490 |
| The relay is moving to its own Worker by a hard cut (D-R1). After the cut the relay is deployed only when relay code changes, and **a relay deploy still restarts every live room**; `room-core.ts` and `@lions/net` (31 sim modules) are relay code | relay design §0, PR 1550 |
| N5 (approved 28 Oct, not executed) designed the pieces co-op needs inside one side: a seat table split by placement, reinforcements to the seat with fewer living units, `controls` in `validateCommand`, `sys` events in a frame (handover, handback), the 60 s handover, a co-op digest fold, a seat block in the snapshot, a partner team colour and pings | `2026-10-28-coop-n5.md` Rulings 5 to 9, 14, 15, 17 |

**What is genuinely new here, beyond N5:** a third seat that no human holds; a place for the computer to run in a networked room; a
computer whose orders arrive by the room like a human's; and a room that ends, scores and stores as a team against a computer.

---

## 2. Seats

### 2.1 The room's shape

**Recommended: `mode: 'versus'`, three seats, `coop: true`.**

| Seat | Who | Side | Faction (C1) | Kit | Spawns |
|---|---|---|---|---|---|
| 0 | the host (human) | 0 | KDF | the host's (`matched`, or `brigade` with the host's own tiers) | friendly end, alternate placements from the first |
| 1 | the friend (human) | 0 | KDF | the friend's own | friendly end, alternate placements from the second |
| 2 | the computer (bot, minted by the room) | 1 | KDF | `matched`, `tiers: {}`, `unlocks: []`, `withhold` from the level | hostile end |

Why versus and not a new mode: the 31 `mode` reads N5 had to classify (N5 plan, point 9) all want their **versus** answer here: intel and
fire support dropped, formations judged by room kind, the outcome rule and cap, the snapshot cadence, the forfeit family. A new mode would
fall into every "not versus means sandbox" branch N5 found. What changes is not the mode but **the number of seats on a side**, which is
exactly what GH-691 (2v2) changes too. So the predicate is `teamRoom(config) = config.seats.length > 2`, and the marker `coop: true` says
which team shape it is (two humans against the computer). GH-691 later adds `coop` absent with four seats.

Why the humans are on side 0 and the computer at the hostile end: PR 1549's reviews found that withholding a unit shifts the ids of every
later unit of that side, and that the human side is stable only because the friendly end spawns first. Putting the computer second keeps the
humans' ids, and the split below, independent of the level. A test pins it (§9, T-4).

Faction (C1): the mirror only, for the same reason the offline computer is mirror-only. Any KDF-v-Sarim pairing is an economy room
(`economyRoom`), and an economy room against a commander that never builds never ends (PR 1558 A). C8 opens a faction pairing once the
commander builds (§7). Which faction the humans then take is Q11.

### 2.2 How the force is split

**Recommended: one placed force for the two humans, split by placement (N5 decision 2, already approved for mission co-op).**

- `versusForceOf('kdf')` placement k goes whole to seat `k % 2` (a carrier with its passengers). Today's `VERSUS_KDF` (15 placements)
  gives seat 0 a Lavi, a Namer, the Eitan, a rifle squad, the Spike team, the jeep, the D9 and the extra Spike team (8), and seat 1 a Lavi,
  a Namer, two rifle squads, the mortar, the drone and the Peten (7). A test pins the split from the list, never from a literal (§9, T-3).
- Spawned order is unchanged (the friendly end spawns as today), so in a `matched` room the world is byte-identical to a one-human mirror
  room with the same seed and level; only the table that says who may order what is new (a `brigade` room adds seat 1's kitted type
  copies, §2.4, after every roster type, as today's per-side copies are). That table is net-layer state, outside the sim (invariant 4).
- Anything spawned later on side 0 (a Store special's unit, production in C8) goes to the seat that **owns** fewer living side-0 units,
  ties to seat 0 (N5 Ruling 5). A special is spawned for the seat whose claim brought it, which is the one exception: see §2.4.

The alternative is **one force each** (two `VERSUS_KDF` forces on side 0): every player keeps a whole army. It needs a second friendly
anchor on every map, a new spawn layout per map and a fairness read per map (the anchors were measured for one force), and the computer
then faces twice its force. That is GH-691's problem (2v2 needs two forces a side). Q3.

### 2.3 Ownership and control

Reuse N5's `CoopSeats` (`@lions/net`, pure, no sim import): `owner: Uint8Array(capacity)` (`0`, `1` or `0xff`), `handedOver: [bool, bool]`,
`scanned`, and `controllerOf(id)` (the owner, unless the owner is handed over, then the partner). The computer seat owns nothing in the table:
its side's units are all its own, and the side rule already says so.

`validateCommand`'s `own(id)` becomes `sideOfEntity(id) === side && (world.controls?.(seat, id) ?? true)` (N5 Task 5). `controls` is wired
only in a team room, so every 1v1 rule is today's. For seat 2, `controls` answers true for every side-1 id.

### 2.4 What each player can command

| Command kind | Seat 0 / seat 1 (humans) | Seat 2 (computer) |
|---|---|---|
| `move`, `attackMove`, `halt`, `smoke`, `setStance`, `unload`, `garrison`, `demolish`, `chargeTunnel`, `rescue` | units it **controls** only | its side's units |
| `attack` | units it controls, on any other-side target (the partner's units are not a target) | its side's units on a side-0 target |
| `load` | its own carrier only (N5 Q2: no riding in the partner's carrier) | its own |
| `build`, `cancelBuild`, `setRally`, `clearRally` | **shared**: either human, side 0 (only in an economy room, C8) | side 1 (C8) |
| `setupReady`, `fortify`, `unfortify` | shared (flag set-up rooms only; not offered in C1) | side 1 |
| `support`, `callStrike`, `reveal`, `raiseWorks`, `cancelWorks` | dropped, as in every versus room | dropped |
| formation orders | as the room kind allows (§5.4); members must all be controlled | the commander sends none today |

A built unit in C8 is a reinforcement under N5's batch rule (to the seat with fewer), not "to the seat that queued it" (N5 Q1).

**Kit: "co-op uses only what each player earned" (GH-1392's constraint).** In a `brigade` co-op room each human's half fields that
human's own tiers, and their own Store specials, and never the partner's. Today's per-seat types are keyed by SIDE (`typeOfBySide`). They
become keyed by SEAT (`typeOfBySeat`): side 0's roster registered once with seat 0's kit, a copy of each KDF type whose kit differs for
seat 1, and the computer's side through its own table. Still no sim code: the sim keys nothing on a type id (`per-seat-types.test.ts`).
A special (GH-1102) spawns under the seat whose claim it was, so the owner rule for specials is "the claimant", not "the seat with fewer".
The computer brings nothing: `matched`, no tiers, no specials.

---

## 3. Lockstep with three seats

### 3.1 Frames and input delay with two remote humans

Nothing changes in the clock. The room emits one frame every 50 ms; a command enters the next frame after it arrives; each client runs
`bufferTicks` (2) behind the newest frame; the room stalls everyone when any human is 40 ticks behind (`STALL_BEHIND_TICKS`) or silent for
2 s (`STALL_SILENT_MS`).

What two remote humans change:
- **Each human feels their own latency**, one round trip to the room plus at most one frame plus the 2-tick buffer (about 150 to 250 ms at
  home, the network design's figure). The room is a star, so the far human does not slow the near one's orders.
- **The far human can stall both.** That is the 1v1 rule and stays. The Durable Object sits near the request that created it, so the host
  is usually the near one.
- **The computer has a human's latency**, its runner's. Offline its orders land in the frame of the tick it decided on (zero delay); in a room
  they land one round trip later. Its decisions are every 5 s, so this costs little, but the co-op ladder must be measured at relay
  latency, as the arena's realtime player was (§9, T-12), never borrowed from the offline numbers.
- **No change to `bufferTicks`, `hashEveryTicks` (20), `MAX_CMDS_PER_SEAT_PER_FRAME` (4) or `CMD_BUDGET`**: each is per seat, and the
  computer gets its own budget as seat 2 (it uses about 2 orders a game today, PR 1558).

### 3.2 Where the computer runs

| Option | How | Determinism | Cost | Integrity |
|---|---|---|---|---|
| **A. A runner client (recommended)** | One human's client runs the `ComputerSeat` against its own sim and sends the orders as seat 2's through the room; the room stamps them into frames like any order | **Safe by construction.** Only the frame log reaches a sim, so the commander's floats never reach a hash; a replay needs no commander | Small: the `ComputerSeat` already exists; a `RoomComputerRunner` wraps it over the room transport | The runner can puppet the enemy (§8, X-1) |
| B. Every client, locally ("lockstep-local") | Each client runs the commander inside its frame step; its orders never travel | Only if the commander becomes **fixed-point** (no `Math.hypot`, no float fog), is fenced like the sim, and its state (fog memory, desk queue, sequence) travels in the snapshot | Large, and permanent: every GH-1391 behaviour becomes lockstep-critical code | No client can puppet without desyncing itself; the best integrity |
| C. In the room (Durable Object) | The relay steps a full sim per room at 20 Hz and runs the commander | Safe | The relay would run the sim (CPU per room every 50 ms, billing, the 31-module closure becomes live code), break "the room never learns a position", and pull the renderer's fog into the relay bundle | Good |
| D. A headless bot client somewhere | The arena's way: a process that joins as a seat | Safe (like A) | Needs a server to run on; the project has none outside Cloudflare | Depends on the host |

**Recommended: A, with a warm standby.**
- **The runner is the host (seat 0) by default.** Both human clients construct the `ComputerSeat` and step its fog tracker every tick; only
  the runner's desk sends. The standby's decisions are computed and thrown away, so it is warm (its fog has history) and can take over at
  once.
- **Its orders are ordinary `cmd` messages carrying `as: 2`.** The room accepts `as: 2` only from the socket of the current runner, charges
  it to seat 2's budget and pending queue, and stamps it `{ seat: 2, seq, cmd }`. Every other check is the existing one (`cleanCommand`,
  `applyFrame`'s `validateCommand`, the sim's own).
- **Who runs is the room's to say, not a frame fact.** It changes nothing in any sim (the orders are already in the log), so it is NOT a
  `sys` event and is not folded into any hash. The room tells both humans with a new `commander { runner: Seat }` message at start and at
  every change.
- **Handoff.** The runner's socket drops: the room makes the partner the runner immediately (not after 60 s: a commander silent for a
  minute is a passive opponent, which is the cheapest win there is) and says so. The old runner, back, becomes the standby; the runner does
  not move back (no flapping). Both gone: nobody runs it, and the room is stalled anyway.
- **Decision timing.** The runner calls `commandsFor(tick)` for every local tick it runs, catch-up included, exactly as the offline
  transport does; the desk paces as today. A decision taken at local tick T lands in a later frame, so the computer is a human-latency
  player (§3.1).
- **What a cold takeover loses.** A runner that took over after its own reload starts a fresh `FogTracker`. The view lists contacts only
  while they stand in sight, so after its first fog step the view is the warm one's; it loses only the fog tracker's decay history, which no
  rule of `rush` reads. A behaviour change at most, never a desync.

**Why not B now.** B is the right answer once a co-op result carries a stake (a leaderboard, coins), because it is the only option where
no player can steer the enemy. It costs a fixed-point commander and a snapshot block for its state, and makes every future commander change
(GH-1391 is an L epic) part of the lockstep. Q1 asks whether to accept A's puppet risk now and keep B as the condition for any stake.

### 3.3 Desync detection across three seats

- **Two hash reporters, as today.** The computer seat is not a separate sim and sends no hash. The room compares the two humans' hashes per
  hash tick, exactly as it compares two seats now; `desync` is broadcast and the compacted log goes to D1 `match_desync` as today. The
  `desync` message's `hashes` becomes one entry per seat (`null` for the computer), so the three-seat shape is visible in the row.
- **The hash covers the seat table.** A co-op client reports `matchDigest(sim.hash(), teamDigest(runtimeDigest, seats.digest(),
  configDigest), contentDigest)` (§3.6). Two clients whose seat tables diverge (a missed `sys` event, a bad split) go red at the next hash
  tick, not ten minutes later when a refused order shows the difference.
- **A stretch with one human is unverified.** While a partner is handed over, only one hash arrives; the room keeps up to
  `MAX_OPEN_HASHES` (16) open ticks and the rejoiner's catch-up reports are compared against them. Anything older is not compared. That is
  stated, not fixed: two humans are the only witnesses there are.
- **The runner cannot hide a desync.** A puppeted order is in the log both humans apply, so it desyncs nobody; a runner that applies a
  different log than it sent desyncs itself and is caught.

### 3.4 Reconnect, and the fate of a player who drops

| Event | Rule | Basis |
|---|---|---|
| A human reloads | Snapshot rejoin, as 1v1. The snapshot gate opens for a room with two human seats and a room-minted bot (`snapshot-gate.ts`), and the snapshot carries N5's seat block after the sim bytes (owner table, handover flags, `scanned`), covered by the room's existing SHA pair | N5 Rulings 8, 9 |
| A human is gone 60 s | **Handover**, not forfeit: a `sys { k: 'handover', seat }` in the next frame; the partner controls those units; frames keep flowing (the handed-over seat stalls nothing) | N5 decision 4, Ruling 6 |
| It comes back and catches up | `sys { k: 'handback', seat }` in the next frame | N5 Ruling 6 |
| The runner drops | The partner becomes runner at once (§3.2); the 60 s handover of its units runs separately | new |
| A human leaves (`bye`) | Immediate handover; the match goes on for the partner | N5 Ruling 10 |
| Both humans gone 60 s | The versus forfeit, applied to the SIDE: the room ends `forfeit` naming the longer-gone seat; side 0 lost; nothing is recorded (§4) | today's forfeit, by side |
| More than `MAX_SYS_EVENTS` (64) handovers | No more are minted; units stay with whoever controls them | N5 Ruling 6 (anti-churn) |

`HANDOVER_MS` is 60 000, named apart from `FORFEIT_MS` (N5). The `dropped` message carries the time to handover; the HUD words it as "your
partner's units pass to you in…", never as a forfeit.

### 3.5 `SeatConfig`, `MatchConfig` and validation

- `Seat` becomes `0 | 1 | 2`. GH-691 widens it to `0 | 1 | 2 | 3`; the code should loop over `config.seats`, never spell `[0, 1]` (the
  checklist of two-seat sites is the §1 row; C1 classifies each, as N5 Task 0 did for `mode`).
- `MatchConfig.seats` becomes `readonly SeatConfig[]` of length 2 or 3, and `MatchConfig.coop?: true`.
- The wire's `isSeat` accepts 0 to 2 (a frame is parsed before its config is consulted). A seat-2 stamp in a two-seat room is then
  refused where every bad order is: `sideOfSeat(2)` names no side, so `validateCommand` drops it identically on both clients, and the room
  never stamps one there in the first place. A test holds both halves.
- `MatchConfig.coopLevel?: 'easy' | 'medium' | 'hard'`, informational (the lobby's label and a replay's), **never read by the world**: the
  world reads the resolved `withhold` counts on seat 2, as PR 1549 does, so two clients with different `levels.json` still build one world.
- `validateConfig`, in addition to today's rules, refuses:
  - three seats without `coop: true`, and `coop: true` without exactly three seats;
  - `coop` outside `mode: 'versus'`;
  - in a co-op config: seat 0 or 1 not `human`, seat 2 not `bot`; seats 0 and 1 on different sides or factions; seat 2 on the humans'
    side; `withhold` on any seat but 2; `tiers`, `unlocks` or a `brigade` kit on seat 2; `winMode` or `flagSetup` present (C1 plays
    annihilation only); a faction pairing (C1; lifted in C8).
- `economyRoom`, `roomKindOf`, `factionsBySide` and `endOfSeat` read **by side**, never `seats[0]` against `seats[1]`: in a co-op config
  those two are allies, so today's `economyRoom` would call a KDF-and-KDF-against-Sarim room a mirror. `endOfSeat` becomes `endOfSide` in a
  team room (side 0 friendly). Each gets a test with a three-seat config that the two-seat reading gets wrong (§9, T-2).
- `formationsOpenIn(mode)` returns `true` for every mode that is not `'versus'`; a team room stays `'versus'`, so it is judged, but a test
  pins that a co-op config is never judged as open by default.
- The computer seat's `callsign` is a fixed token (`computer`), never a `t()` result: the offline path writes the host's localised
  `t('versus.cpu.callsign')` into the config, which two humans on two languages would disagree on. The HUD renders `t()` from `kind: 'bot'`.
- Labels stay out of the config (A3 §0.14): member names travel in the `lobby` message only.

### 3.6 The digest

There is no config digest today, and 1v1 needs none: both seats run one config the room minted. A team room adds net-layer state that
gates orders, so it folds two things more, and only in a team room, so **no versus, mirror, net or two-client pin moves**:

```
teamDigest = fold(fold(fold(DIGEST_SEED, runtimeDigest), seats.digest()), configDigest)
reported   = matchDigest(sim.hash(), teamDigest, contentDigest)          // a team room
reported   = matchDigest(sim.hash(), runtimeDigest, contentDigest)       // every other room, unchanged
```

- `seats.digest()` is N5's FNV fold of `owner[0..scanned)`, `handedOver` and `scanned`.
- `configDigest` is `fnv1a32(canonicalJson(config))`, computed once at boot over the config **as minted** (labels are not in it). It
  catches a client that validated the config but built from a different reading of it (a field one build ignores), at the first hash
  tick rather than wherever the first divergent unit happens to matter.
- The runner's identity and the commander's internal state are not folded: they reach the sim only as orders in the log.
- The snapshot header's `matchDigest` carries the same team composition, and the post-restore check computes it the same way (N5 Ruling 8).

---

## 4. Scoring and results

### 4.1 Victory and defeat are shared

The outcome is by SIDE, as today (`outcomeOf`). Both humans win or lose together. `seatResultOf` already names the lowest seat of the
winning side, so both humans report `{ winner: 0, by }` for a team win and `{ winner: 2, by }` for the computer's, with no code change and no
way for the two to disagree honestly. The match-over panel shows one result and both callsigns.

Surrender: one human's Surrender would end the match for both. **Recommended:** in a co-op room Surrender becomes **Leave** (an immediate
handover to the partner, N5 Q3); the last human in the room may surrender for the side. Q6.

### 4.2 Coins and credits: none

- **Roar coins: 0**, as versus (A3 ruling). The wallet is not touched.
- **Brigade credits: 0.** Credits pay only for improvement within a campaign mission; a room is not one.
- **The ledger, the brigade account, the saves and the tutorial flag** are not written (N5's G-5 storage pin applies to a co-op room too).
- The reason is the same as versus's and stronger: under §3.2 option A the runner can steer the enemy, so a co-op win is evidence of nothing.

### 4.3 Agreed results with two humans, and records

How A3's agreement reads with two humans and a computer:
- Agreement needs **both human seats'** first `over` reports to carry the same tick and the same result, plus a compared hash pair within one
  cadence of that tick, and an `over` only on a hash-window tick. The computer reports nothing; it has no socket and no sim of its own.
- A handed-over seat that is gone cannot report; the stayer's lone report is unconfirmed (`agreed = 0`), as a lone report is today.
- The room's own close (L-1) arms on the two humans' reports, or on one report with the other human gone.
- A room-decided end (the side forfeits because both humans left) names side 1.

**Recommended: write no record in C1 to C8.** No `match_record`, no `match_seat`, no W-L. Reasons: the puppet risk (§8, X-1) makes any
result meaningless as a record; `match_seat.seat` and `winner_seat` are `CHECK (… IN (0, 1))`, so a third seat needs a table rebuild on the
`ACCOUNTS` database; and W-L "counts every agreed result" (A3 ruling 1), which would let a pair farm wins. The agreement rule above is still
built, because the room's close needs it and a later record (Q8) would. If the lead wants a member's co-op history later, it is its own
table (`coop_record`: map, level, result, the two member seats, no W-L), not a third row in `match_seat`.

### 4.4 Balance: two against one

A human with a whole force beats hard about half the time against scripted plans (PR 1549 ladder, 42-54% for the computer). Two humans
sharing that force with twice the attention will win more. The co-op ladder (§9, T-12) plays two scripted plans on side 0, each ordering its
own half, against each level on every open map at relay latency, 30 seeds a cell, and reports the computer's win rate. **No handicap is
chosen before it runs.** If even hard is under the bar the lead sets, PR 1549's open question ("should hard stay an even force, or should a
stated force bonus exist?") becomes a co-op question: a stated `reinforce` on a level (extra placements, never income or vision, in the same
closed schema), or a co-op-only "hard" that withholds from the HUMANS' force. Q2.

---

## 5. The lobby

### 5.1 Inviting a friend

The `/versus` face-off lobby gains a third entry beside "Play with a friend" and "Play the computer": **"Play together against the
computer"**. The flow is today's friend-room flow:
1. The host picks map and level and presses Create. `POST /api/match` carries `mode: 'versus'`, `coop: true`, `level`, the map, and the host's
   kit claim (`matched` or `brigade`). The route checks the map (`versusMapAllowed`, mirror), refuses `matchup`, `winMode` and `kind: 'bot'`
   for a co-op create, and checks `level` against `COMPUTER_LEVELS`, a twin of `data/computer/levels.json` in `@lions/net` (the Worker
   imports `net`, not `data`; a test holds the twin to the file both ways, as `WIN_MODE_FAIR_MAPS` and `MAP_CAP_MINUTES` are held).
2. The room mints seat 2 itself, with the level's `withhold` counts. **This is the first time the room mints a `withhold`**; PR 1549's
   security reading ("the room never mints one") changes to "the room mints one only from a listed level, on a seat it created".
3. The host shares the code or the copy-link, as today. The friend joins as seat 1 (`kind` forced to `human`). A third join answers `full`
   (409): seat 2 is not joinable.
4. Both press Ready; the room starts. The lobby shows both callsigns (and a member's name and Player ID, as A3), the map, the level's label
   and blurb (`t()` at render time, never at module load), and "The computer" as the third seat.

Every new string is an `en.json` key; any new path is spelled once in `shell/links.ts`'s `routes`. No new path is needed: the room is a
`?net=<code>` battlefield like any versus room.

### 5.2 Choosing the level (PR 1549)

The level picker PR 1549 left as a follow-up is built once and shared by "Play the computer" and the co-op entry. Default **medium**
until the co-op ladder reads (Q2). The level is a host choice, shown to the friend before Ready.

### 5.3 Maps and win modes

- **Maps:** the mirror list, `VERSUS_FAIR_MAPS` (seven today), because the split uses the measured one-force spawn ground. The co-op ladder
  reports per map; a map where the computer never wins at any level (today `wadi_tarfan_l` against a passive single player) is listed for
  the lead, not removed by the agent.
- **Win modes:** annihilation only in C1. The commander does not play points or flag goals (PR 1558 B). `camp` is reached by `rush`, so it is
  the first mode to try once the co-op ladder reads it (Q10).

### 5.4 The room kind for formations (`formations_closed_in`)

`roomKindOf` reads a co-op config **by side** (§3.5): KDF humans against a KDF computer is `mirror`; once C8 opens faction pairings, a KDF
side against a Sarim computer is `economy`. The one predicate, `formationsOpenIn(mode, open, map, roomKindOf(config))`, then needs no
change, and a map's `formations_closed_in` closes the co-op room of that kind too: Tel Marum's `["economy"]` would close its co-op economy
room. **Recommended: no fourth room kind.** The S4 gate that opened formations asks whether one end gains from them; against a computer that
sends no formation order the question is the humans' own, and the existing kinds answer it conservatively. Q12 offers a `coop` kind instead.

---

## 6. Privacy, chat and telemetry

### 6.1 Chat between the two allies

- Chat and quick chat are relayed to **the two human seats only**. The computer seat has no socket, receives nothing and reads nothing: no
  chat line, quick phrase or ping is ever in its view (a model-driven commander later must keep that: a teammate's text would be a prompt
  to it).
- Every received line goes through `ChatInbox` (chat off, per-match mute). Mute works on the partner's seat as on an opponent's.
- Quick chat's twelve ids fit allies already (`attack`, `defend`, `help`, `wait`). N5's ping (`ping{x, y}`, relayed to the partner only,
  rate-limited like chat) is the co-op verb that matters most; it is presentation only and never in a frame.
- The word filter (S2), report (S3) and block (S5) land when GH-1417 lands them; co-op adds no requirement of its own, because a co-op room
  is a code room between people who exchanged a code (GH-1417 D1: chat on, filter on when it exists). The `CHAT_CLOSED` kill switch (S4)
  applies to co-op rooms the same way.

### 6.2 What `/privacy` must add

The page today names versus records and nothing about rooms. Two sentences, lawyer-reviewed with the rest of GH-1417's S6, and
`PRIVACY_UPDATED` changed with them:
- "In a co-op match your partner sees your callsign (and, if you are signed in, your display name and Player ID), your chat, your quick
  phrases and your map pings. The computer opponent receives none of it. Chat is not stored."
- "Co-op matches against the computer are not recorded on your account." (If Q8 later records them, this sentence becomes the list of
  what is kept, as the versus item is.)

`privacy-page.test.ts` pins the text, as it pins the A3 item.

### 6.3 What telemetry records

**Nothing new.** A room sends no match telemetry today (`missionTelemetry` is the mission branch's), and co-op adds no event: no
`missionStarted`, no `campaignProgress`, no `account`. The existing session, perf and error reports are unchanged and already on the page.
If the lead wants co-op counted for the D4 audit (how many co-op matches, how long, which level won), that is a new `coop_end` event
(map, level, result, duration, no ids beyond the existing anonymous one), and the privacy page's report list gains it in the same PR (Q9).

---

## 7. Dependencies and slices

### 7.1 Dependencies

| Dependency | Why | Blocks |
|---|---|---|
| **The commander builds: GH-1391 (and GH-1390 finding A)** | PR 1558: the computer never builds, so an economy room never ends, and a commander that commits once and stops loses to a passive player 45% of the time; two humans would find the "trick that always works" in one game. GH-1391's done-means (scouts, counters, defends, builds) is what makes the mode worth offering | **C8** (economy pairings) and **C9** (offered with no flag). C0 to C7 can land before it behind `?coop` |
| GH-1391 is itself blocked until the lead unparks sim balance | its own constraint | the same |
| **The relay split is cut: GH-1397** (PR 1550 merged, then the lead's cut) | GH-1392's constraint: "a deploy must not restart a live match". Co-op changes `room-core.ts` and `@lions/net`, which are relay code; before the cut every game merge restarts every room, co-op ones included | C9 |
| **Computer levels: PR 1549** merged, with the lead's ruling on its handicaps | the level picker, `withhold` on seat 2, `COMPUTER_LEVELS` | C3, C6 |
| **N5's seat-within-a-side pieces** (`CoopSeats`, `controls`, `sys` events, handover, seat snapshot block, partner colour, pings) | co-op against the computer is the second consumer; whichever lands first builds them once in `@lions/net` and `packages/app/src/net/`, and the other reuses them (G-3, one body) | C2 |
| GH-691 (team play) | GH-1392's last done-means ("computer seats can fill any empty seat") | after C9; out of this design's scope except that nothing here spells two humans or one computer as a constant |
| GH-1417 S2/S3/S6 | filter, report, privacy text | not blocking: chat is a code room's |

### 7.2 Slices

Each slice keeps `pnpm test:determinism` green with the golden hash unmoved (none touches `packages/sim`), and each new check arrives
with its falsification in the commit message.

| Slice | What | Package | Size |
|---|---|---|---|
| **C0** | Pre-flight: classify every two-seat site (the §1 row) and every `seats[0]`/`seats[1]` read with its team answer, as N5 Task 0 did for `mode`. No commit | all | S |
| **C1** | The three-seat config: `Seat` widened, `seats` of 2 or 3, `coop`, `coopLevel`, validation (§3.5), the by-side readings (`economyRoom`, `roomKindOf`, `factionsBySide`, `endOfSide`), `COMPUTER_LEVELS` twin and its pin | `net`, `app/net` | M |
| **C2** | N5's seat table, `controls`, `sys` events and the team digest (§2.3, §3.6), shared with N5 | `net`, `app/net` | M (S if N5 landed) |
| **C3** | The world: `buildMatchWorld` for three seats; split by placement; `typeOfBySeat` per-seat kit; seat 2's `withhold`; the computer at the hostile end | `app/net` | M |
| **C4** | The room: per-seat arrays of length 3; the computer as a virtual seat (no socket, no stall, no pause, no chat); the runner and `as: 2`; the `commander` message; hashes from human seats; handover; forfeit by side when both humans are gone; `over` agreement from the two humans; the snapshot pair from the two humans' uploads; mint seat 2 from the level; refuse a co-op `kind: 'bot'`; no record | `worker/match`, `net/protocol` | L |
| **C5** | The client runner: `RoomComputerRunner` over the room transport, warm standby, handoff on `commander`; the offline path unchanged | `app/net` | M |
| **C6** | The app: selection, box, groups and order sinks by `controlledByMe`; partner colour (`team.partner`, four CVD variants); seat labels; the handover in the HUD; pings; Surrender as Leave; the lobby entry and the level picker; the snapshot gate for team rooms | `app`, `render`, `data/palette.json` | L |
| **C7** | Instruments (§9): the three-seat two-client stream, the replay-without-commander check, the snapshot witness arm, the relay end-to-end handoff, the co-op ladder (report), the security review, the run sheet `docs/net/coop-vs-computer.md`; the lead's gate (§9.3) | `tools`, `docs` | M |
| **C8** | After GH-1391 builds: economy pairings (KDF side against a Sarim computer, or the reverse, Q11) on `FACTION_MATCHUP_MAPS`, shared production on side 0, built units by the batch rule; the co-op ladder re-read | `net`, `app/net` | M |
| **C9** | Open: drop `?coop`, offer the mode in the lobby with no flag, after the relay cut and C8's read | `app` | S |

C0 → C1 → (C2 ∥ C3) → C4 → C5 → C6 → C7, then C8 and C9 when their dependencies clear. Never two slices on `main.ts`, `room-core.ts` or
`match-room.ts` at once.

---

## 8. Abuse cases

| # | Case | What stops it, or why it is accepted |
|---|---|---|
| X-1 | **The runner puppets the computer** (a modified client sends seat-2 orders: march the enemy into fire, or never attack) | Accepted under option A **because nothing is at stake**: no coins, credits, record or W-L (§4). The room limits it to the runner's socket and seat 2's normal budget. Option B removes it (Q1). Stated in the run sheet so nobody later attaches a reward to co-op without moving to B |
| X-2 | The non-runner sends `as: 2` | The room refuses it (not the runner's socket); a test |
| X-3 | A human orders the partner's units | `validateCommand`'s `controls`; the order vanishes identically on both clients; a test per kind (N5 Task 5's table) |
| X-4 | A forged `over` to close the room early | A3's rules: only a hash-window tick, both humans must agree, a compared hash; nothing is recorded anyway |
| X-5 | Handover churn (leave and rejoin to flip units) | `MAX_SYS_EVENTS` (64) per room; handback only once caught up |
| X-6 | A client claims `kind: 'bot'`, a level that is not listed, or `withhold` counts | The route and the room refuse a co-op `kind: 'bot'` and an unlisted level; `withhold` comes only from `COMPUTER_LEVELS` on the room-minted seat; `validateConfig` refuses `withhold` on seats 0 and 1 |
| X-7 | A third person with the code | `full` (409); seat 2 is not joinable |
| X-8 | A code posted publicly seats a stranger as your partner | As any code room; chat defaults and controls are GH-1417's (mute today; filter, report, block later; D10 keeps public listing closed) |
| X-9 | Chat or pings used to harass the partner | Per-match mute (works on a guest), chat off; ping rate-limited like chat; report when S3 lands |
| X-10 | Flooding through seat 2 | Seat 2 has the per-seat token bucket, the pending cap (12) and the per-frame cap (4) of any seat, and its characters count against the room's log cap |
| X-11 | Text aimed at a model commander (prompt injection through chat) | The commander's view contains no chat, quick phrase or ping; a source guard pins that `computer/` imports nothing from the chat modules |
| X-12 | A forged snapshot from one human | The room's existing SHA pair compare between the two humans' uploads |
| X-13 | Watching a co-op room to scout | Spectators are admitted only into bot-versus-bot rooms; a co-op room has humans, so none |
| X-14 | The runner griefs its own partner by steering the enemy onto the partner's half | Same as X-1: a friends' room with no stake. The partner can mute and leave (their units pass to the runner, so in practice the match is over for them). Stated, not engineered |

All Worker changes get the security review in C7 before the PR, as N5 Task 20 planned. Per G-9 of the N5 plan, the public repository's
commits say what a limit is and that it is tested, never how to defeat it.

---

## 9. Test plan

Every check below is falsified by a constructed input or a one-line mutation, run red and restored, before it is trusted.

### 9.1 Determinism with three seats

| ID | Test | Falsification |
|---|---|---|
| T-1 | **Three-seat two-client stream** (`tools/src/net/two-client.test.ts` gains it): two human clients and a runner-produced seat-2 stream through the local relay; both clients' `reported` digests equal at every hash tick for 6 000 ticks on two maps; at least one seat-2 order applied (positive evidence) and the seat table differs between seats at least once | deliver one seat-2 command to one client only: red at that tick; sort seat 2 before seat 1 in one client's `canonicalOrder`: red |
| T-2 | **The by-side readings**: a three-seat config with KDF humans and a Sarim computer reads `economy`; the mirror reads `mirror`; `endOfSide` puts both humans at the friendly end | revert `economyRoom` to `seats[0]` vs `seats[1]`: the economy case goes red |
| T-3 | **The split** derives from `VERSUS_KDF` and gives each seat its alternate placements, passengers included; each seat owns at least one unit | ties to seat 1, or drop the passenger term: red |
| T-4 | **Level independence of the humans**: the humans' entity ids, types and `rng.state` words are identical at easy, medium and hard (PR 1549 review's ask, now for two humans) | spawn the computer's end first: red |
| T-5 | **Replay without the commander**: a recorded co-op frame log replayed headless, with no `ComputerSeat` constructed, ends on the same hash as the live run | construct and run the commander in the replayer too (its orders doubled): red |
| T-6 | **Runner handoff**: the runner's socket drops at tick 1 500; the partner becomes runner; seat-2 orders resume from the new runner; both clients' hashes stay equal | let the room keep accepting `as: 2` from the old seat after handoff: the "refused" assertion goes red; never hand off: the "orders resume" assertion goes red |
| T-7 | **Snapshot arm**: a reload mid-match rejoins by `path === 'snapshot'` with the seat block, and the restored fork matches the uninterrupted run | strip the seat block: refused, falls back to the full log (and the test asserts which path) |
| T-8 | **The team digest** moves when one owner byte differs; no versus, mirror, net or two-client pin moves | fold the seat digest into every room: the versus pins go red |
| T-9 | `pnpm test:determinism` passes with the golden hash unmoved after every slice | n/a: no sim edit is expected; a slice that needs one STOPS |

### 9.2 Room, config and app

| ID | Test | Falsification |
|---|---|---|
| T-10 | `validateConfig` table: each refusal in §3.5 on a literal config; every existing `config.test.ts` case unchanged | drop the "seat 2 is bot" check: its row goes red |
| T-11 | Room (`room-core.test.ts`, fake clock): seat 2 never stalls, pauses or chats; `as: 2` only from the runner; hashes compared from the two humans; handover at 60 000 ms and not at 59 999; both humans gone ends `forfeit` for the side; a co-op `bye` hands over; `full` on a third join; no `match_record` written; every existing two-seat test unchanged | count seat 2 in `stallFor`: the "frames flow" case goes red |
| T-12 | **The co-op ladder** (report only, `pnpm coop:ladder`): two scripted plans on side 0 (passive, rush, sensible, each on its own half) against each level, every mirror map, 30 seeds a cell, at relay latency; the computer's win rate per cell and pooled | a plan that orders the partner's half: refused by `controls`, so its cell reads like a one-half force (asserted) |
| T-13 | Selection takes only controlled units; the partner colour follows control; a handed-over partner's units become selectable | select by side instead of controller: red |
| T-14 | `/privacy` text pinned; storage keys byte-identical before and after a co-op win (`lions.campaign.ledger`, `lions.brigade.account`, `lions.saves`, `lions.tutorial.done`, `lions.roar`) | call the victory write: red |
| T-15 | Chat: a line from seat 2 is impossible (no socket); the partner's line goes through `ChatInbox`; the commander's view source imports no chat module | add a direct `chatFeedLine` call: the inbox guard goes red |
| T-16 | Lobby: the co-op entry, the level picker through `t()` at render, `validate:ui` clean, a pseudo-locale capture with no unbracketed word | a bare string: red |

### 9.3 The lead's gate (manual, after C7)

The lead and a friend, on two machines and two networks: three co-op matches on two maps, at two levels, with at least one won and one lost;
hashes equal throughout; one reload mid-match rejoins by snapshot; one partner leaves and the other plays on with both halves; one runner
reload with the commander still ordering afterwards. Written in the run sheet.

---

## 10. Questions for the lead

The recommendation comes first in each.

1. **Q1. Where the computer runs.** **Recommended: on a runner client (option A), with a warm standby on the partner, and co-op carries no
   stake for as long as that holds.** The alternative is a fixed-point commander run on every client (option B): no puppeting, but a large,
   permanent cost on GH-1391's work. Is "no stake" acceptable for the first version, and is B the condition for any later reward or ranking?
2. **Q2. The handicap for two against one.** **Recommended: measure first** (the co-op ladder, T-12) and decide after; default the lobby to
   medium meanwhile. Options after the read: a stated `reinforce` on the computer's levels; a co-op-only handicap on the humans' force; or
   none. What win rate should hard reach against two players?
3. **Q3. One force split, or one force each.** **Recommended: one force split by placement** (N5 decision 2), which keeps the measured mirror
   ground. One force each needs a second anchor, a new spawn layout and a fairness read per map, and is GH-691's work.
4. **Q4. One computer seat or two.** GH-1392 says "one or two". **Recommended: one in this design.** A second computer seat on a split force
   is a second runner with nothing to decide differently; it becomes meaningful with one force each (Q3) or a second policy, and belongs to
   GH-691.
5. **Q5. The runner.** **Recommended: the host, handing off at once on a drop, and not moving back.** The alternative is the human with the
   lower measured round trip to the room.
6. **Q6. Surrender.** **Recommended: Surrender becomes Leave (a handover) while the partner is present; the last human may surrender for
   the side.** The alternative is a vote: both must press within 30 s.
7. **Q7. Both humans gone.** **Recommended: the versus forfeit, by side, after 60 s; nothing recorded.** The alternative is void.
8. **Q8. Records.** **Recommended: none in this design** (no W-L, no `match_record`). If a member history of co-op is wanted later, its own
   table with no W-L, under Q1's condition.
9. **Q9. Telemetry.** **Recommended: nothing new.** If co-op counts are wanted for the D4 audit, a `coop_end` event, with the privacy page
   changed in the same PR.
10. **Q10. Win modes.** **Recommended: annihilation only until the co-op ladder reads `camp`;** points and flag wait for a commander that plays
    goals (PR 1558 B).
11. **Q11. Factions after the commander builds (C8).** Which side do the humans take in a KDF-v-Sarim co-op room: KDF (the GDD's player
    faction, and the Sarim computer gets tunnels), Sarim, or the host's choice? **Recommended: the host's choice, as the 1v1 lobby's.**
12. **Q12. Formations room kind.** **Recommended: reuse `mirror`/`placed`/`economy` read by side, no `coop` kind.** The alternative adds a
    fourth kind so a map can close formations in co-op alone.
13. **Q13. Brigade kit in co-op.** **Recommended: allowed, each human's own tiers and specials on their own half** (GH-1392's "only what
    each player earned"), the computer matched. The alternative is matched kit only in co-op.
14. **Q14. Ordering against N5.** Co-op against the computer and N5 (co-op against a mission) share C2. **Recommended: whichever the lead
    schedules first builds the shared pieces once;** if co-op against the computer goes first, N5's plan is amended to reuse them rather
    than re-plan them.

---

*Written by Claude Code for the lead's decision. Nothing here is implemented.*
