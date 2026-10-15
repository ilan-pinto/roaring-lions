# Network game — design (play against a friend)

**Status:** design approved in conversation by Ilan, 10–11 Oct 2026, in four
parts; this file is the written spec for his review. Nothing ships until he
approves the file. Decisions 1–9 are his answers; decisions 10–22 are defaults
recorded with the recommendation and open to being overturned in review.
**Work packages:** re-scopes WP-G-H0 #190 (the two-machine test, now October)
and WP-G-H #191 (play with a friend); answers gate G5 #169; supersedes the
Colyseus half of #132. New packages are proposed in §9.
**Brainstormed in:** session "Roaring Lions network game design", worktree
`network-game-design`. The "Roaring lion project manager" session confirmed on
10 Oct that it recorded nothing for the network game; this is the only spec.
**Reads first:** CLAUDE.md (the four invariants), `docs/HANDOVER.md`,
`docs/GDD.md` §7 and §10, issues #132 #190 #191 #169 #204 #205 #187 #188,
`docs/superpowers/specs/2026-09-24-telemetry-design.md` (the Worker),
`docs/superpowers/specs/2026-10-08-in-game-feedback-design.md` §4.3 (the
replay recorder), `docs/superpowers/specs/2026-10-04-g3-decision-sheet.md`
(the economy the skirmish reuses).

---

## 0. The design in one page

- **The first network game is a 1v1 skirmish.** Each player picks KDF or Sarim
  in the lobby, so KDF v Sarim, KDF v KDF and Sarim v Sarim are all legal. The
  campaign stays single-player: no co-op, no shared ledger, no shared account,
  no shared saves. (Decisions 1, 2.)
- **Deterministic lockstep over a command relay.** Both browsers run the same
  `@lions/sim` from one `MatchConfig`; only commands cross the wire, about
  40 bytes each; the room never learns a unit position. (Invariants 1–4 are
  what make this possible, and this spec is the cash-in GDD §10 promised.)
- **The relay is a Cloudflare Durable Object in the Worker we already run**,
  not Colyseus and not WebRTC. The room is the metronome: it emits one frame
  per tick and the clients follow it. (Decision 3.)
- **Invite by code and link, no accounts.** A six-character room code, a seat
  ticket signed by the Worker, a callsign typed in the lobby. The ticket
  carries a `player` field that is the anonymous UUID today and the
  Steam-validated id when ST5 lands. (Decision 4.)
- **Matched kit by default; "bring your brigade" is a friends-only lobby
  toggle.** (Decision 5.)
- **Friendly rules:** stall everyone with a banner, three 90-second pauses
  each, a 120-second reconnect window replayed from the frame log, quit is
  surrender. (Decision 6.)
- **Desync is halted and reported, never resynchronised.** Hash every 20
  ticks, `sim.hash()` plus a mission-runtime digest. (Decision 10.)
- **An AI joins as another client of the room.** A headless harness in Node
  serves MCP (`observe`, `order`, `say` …) over a documented JSON protocol,
  with the game's own advisor panel as its in-game face; two harnesses in a
  paced room are the AI-versus-AI arena. (Decisions 7, 8.)
- **The Sarim seat ships minimal**: the KDF verbs plus `setStance` and
  `build`; the full insurgent toolkit is a named follow-on. (Decision 9.)
- **Five stages, none blocking Stage 4:** N0 two-machine test in October (no
  rule changes); N1 the mirror 1v1 by end of November (no sim change); N2 the
  sim seat work in December after M2 (since 15 Oct: directly after F3, L5,
  §9); N3 the Sarim seat with WP-G-G in
  January–February; N4 the AI harness and arena in parallel from January.
  M4 "play with a friend" moves from 16 Apr 2027 to end of February 2027.

---

## 1. Why, and what it is not

Ilan's stated must-have for Roaring Lions is network play with a friend, in a
game with many units and upgrades and trigger-driven strategy. Issue #132 and
gate G5 carried a Colyseus relay and a co-op-first order as *defaults*; neither
was ever answered. This spec answers them.

Three framings were put to Ilan and he chose the first game deliberately:

| Option | What it is | Verdict |
|---|---|---|
| Asymmetric 1v1, KDF v Sarim | one commands the brigade, one the insurgency | **chosen, with a free side pick** |
| Symmetric 1v1, KDF v KDF | both field the brigade | **chosen as the same lobby with both seats on KDF** |
| Co-op on the campaign | both on side 0 through the missions | **not in this design** (Decision 2) |

**Not in this design:** co-op campaign missions and every shared-progress
rule they imply; ranked matchmaking; server-authoritative anti-cheat;
spectators as a product feature (the frame log makes them nearly free later,
§8.5); more than two combatant seats; the full insurgent toolkit (§6.3); a
sim snapshot for faster reconnect (§3.2.6); payouts of brigade credits for a
skirmish result (Decision 20); any Steam work.

**What a lockstep sim buys and what it does not.** Every client runs the whole
world, so fog is a client-side courtesy: a modified client sees everything.
This is a play-with-friends feature and the lobby says so in one line. A
cheat-resistant build would need an authoritative headless sim on the server,
which is a separate decision this spec does not take.

---

## 2. What a match is

### 2.1 `MatchConfig`

The whole input to both simulations. Both browsers, every bot and every
advisor build their `Sim` from this blob and nothing else.

```ts
interface MatchConfig {
  matchId: string;            // room id, also the D1 key
  code: string;               // six characters, unambiguous alphabet
  seed: number;               // shown in the lobby; per match, never SIM_SEED
  map: string;                // a shipped map id, skirmish-marked (§2.3)
  mode: 'versus';             // the only mode in this spec
  seats: [Seat, Seat];
  pace: { kind: 'realtime' } | { kind: 'paced'; roundTicks: number; roundWallMs: number };
  inputDelayTicks: 0;         // informational: the room clock sets the delay (§3.2.2)
  hashEveryTicks: 20;
  bufferTicks: 2;
  build: string;              // app version
  commit: string;
  dataDigest: number;         // room-minted 0, kept on the wire and never folded (L4, below)
  rules: { win: 'annihilation'; capMinutes: 25; tiebreak: 'held_ground_seconds' };
}

interface Seat {
  seat: 0 | 1;
  side: 0 | 1;                // sim side; civilians stay side 2
  faction: 'kdf' | 'sarim';
  kit: 'matched' | 'brigade'; // Decision 5
  tiers: Record<string, Record<string, number>>;   // typeId -> track -> tier, the account's own shape; empty for matched kit and for sarim (16 Oct, see §7.1)
  unlocks: string[];               // empty for matched kit
  player: string;             // anonymous UUID today, Steam id after ST5
  callsign: string;
  kind: 'human' | 'bot';
  advisor: 'none' | 'advise' | 'assist';   // §8.2
}
```

**Nothing from the browser reaches the sim in a match.** The audit (§7.4)
found five paths by which local state becomes a sim input today: the
campaign ledger, the brigade account and coin wallet, the tutorial flag, the
sandbox flags and the stale-build case. In a match the ledger is `{}`, the
tier map is the seat's (empty under `matched`; under `brigade` the client
sends **what it owns, earned and bought alike** — the lead's ruling of 11 Oct,
which supersedes the 1 Oct earned-only rule for friends' rooms; the room
records the claim and it stays client-trusted until ST6's server ledger; the
toggle is never offered outside a friends' room), the tutorial is absent, every sandbox flag
is refused, and `build` + `commit` must match on both clients or the lobby
refuses to start and says which differs. (This line first read
`build` + `commit` + `dataDigest`, a room-minted digest compared at the lobby;
that design is retired, next paragraph.)

**The data digest is the client's own, not the room's. Ruled 15 Oct
(coordinator, lead-delegated) (L4), built in N2-P3 (`e877c8e7`).** The room
mints `dataDigest: 0` and the field stays in the wire format (`validateConfig`
still requires it), but no client folds it: the Worker carries no unit,
structure or map content to vouch for, and one number handed to both seats
cannot tell two clients' data apart. Each client instead folds
`shippedContentDigest()` (`packages/app/src/net/content-digest.ts`):
`fnv1a32` over `canonicalJson` of its own `{maps, structures, units}`, every
object's keys sorted, so a loader's insertion order never reaches the hash.
Two clients on different data therefore desync at the first hash tick (19),
even while their sims still agree. The lobby compares only the build string
(`<package version>+<commit>`, §11b.2), and **that build check, not the
digest, is what covers roster ORDER**: `units` is keyed by id and the digest
sorts its keys, so it cannot see the order that assigns type indices (§7.4),
while two clients on one build ship one bundle and so one order.

### 2.2 Seat versus side

Sides in the sim stay what they are: 0 and 1 are combatants, 2 is civilians,
and the contact arrays are sized `2 × capacity` (sim.ts:1256-1263). A
**faction is a property of the seat's roster, not of the side index**: a
KDF v KDF match registers the KDF catalogue and spawns it on side 1 for the
second seat. The rules that hard-code "side 0 is the player" today (no
auto-breach in `Sim.selectBreachTarget`; ROE, production anchor, fire
support, `unitLost` in mission.ts) become seat or faction rules (§7.1).
**As built (N2, 16 Oct 2026):** the breach rule is the one that moved. It
asks `Sim.isHumanHeld(side)` (`SimConfig.humanHeld`, default `[true, false]`,
today's rule; `963d6613`, `810ca26c`), and a versus room holds both seats
(`[true, true]`, `3689dd9f`), so neither auto-breaches. The mission.ts
sites (`unitLost`, ROE, production anchor, fire support) are **N3's**, not
N2's (D1, ruled 16 Oct by the lead; §7.1). A versus room runs no
`MissionRuntime` until N3 (L1, §11b.4), so of these only the breach rule acts
in a match today.

**The breach rule, measured (N2-P6, `c5826d1c`/`6e1a3596`,
`tools/src/backtest/versus-breach.ts`).** This line used to say the side-0
rules are "mildly unfair to the side-1 seat"; for the breach rule the
asymmetry runs the other way (seat 1 auto-breaches, seat 0 never does) and
its effect on results is nil within measurement. It can fire only on a map
with ungarrisonable walls or fences: of the four fair maps that is
`milh_flats` and `wadi_tarfan`; `beit_sahwan_outskirts` and `tel_marum` have
no walls, so it never fires there. Over 800 paired seeds on the walled maps
(every seed played twice with only the side label swapped), result flips
went 9 for the side carrying the rule and 12 against (p = 0.66), end-value
margin 35 up and 43 down (p = 0.43), a pooled 95% interval on the win-rate
shift of about −1.5 to +0.8 percentage points (a paired-flip interval: net
−3 of 800 pairs, 9 for minus 12 against, standard error √21 / 800 = 0.57
points, so −0.375 ± 1.96 × 0.57). It costs side 1 about 9
unit-seconds a game on `milh_flats` halted at walls under the probe's attack-move play; a
player who routes along walls will breach more, so the behaviour is real and
policy-dependent, and only its outcome effect is null. Nothing breaches in
the mirror pins' first 200 ticks. **It is therefore a parity item for N2,
not a live fairness bug**: N2 makes the rule ask the seat table, and the
lobby needs no warning about it (N1 built none).

**The parity, measured as built (N2 Task 2, `3689dd9f`;
`tools/src/backtest/versus-breach.ts`, 12 seeds, normal arm, breach
unit-ticks side 0 / side 1).** Base, the single-player table: `milh_flats`
0 / 3214; `wadi_tarfan` kdf/kdf 0 / 12, kdf/sarim 0 / 1132, sarim/kdf 0 / 0.
With `--rules=room` every cell reads 0 / 0 in both arms, and all 12 games are
identical across the arms. The three sim pins did not move under `[true,
true]` either: the golden replays hold no side-1 breach (Task 1, mutation
M5), and the mirror pins' first 200 ticks hold none.

### 2.3 Map and win rule

A skirmish map declares two camps (one per seat), two camera starts and its
income zones. The G3 decisions already fix the skirmish economy: zones only,
contested pays nobody, pop cap per side through `MissionContext.popCaps`,
Sarim budget 1.6× from doctrine data. Those arrive with Stage 4 (F2–F4) and
WP-G-G; this spec does not redesign them. Until they exist, N1 plays on a
placed-force sandbox map with no economy (§9).

First-version win rule (Decision 12): a seat loses when it has no combat unit
alive and no production that can produce one, or when it surrenders. At 25
minutes the match ends and the seat with more held-ground seconds wins; a
tie is a draw. Richer rules (points, objectives) plug into `rules` later.

---

## 3. Architecture

### 3.1 `packages/net`

A new package, the lockstep core, with no DOM and no three.js, so it runs in
the browser, in Node (harness, arena, CI) and in the Worker (types and
protocol only). Dependency direction: `app → net → sim` (types read-only),
`worker → net` (protocol and config types only; the Worker never imports
`sim`, it has no reason to and the bundle would double).

Contents:

- `protocol.ts` — every message in §3.2.3, as types plus a `parse` that
  refuses anything over 4 KB or of unknown kind.
- `config.ts` — `MatchConfig`, its validator, and `dataDigest` (a wire
  field the room mints as 0 and no client folds; the folded data digest is
  each client's own, `packages/app/src/net/content-digest.ts`, §2.1, L4).
- `frames.ts` — `Frame { tick, cmds: Stamped[] }`, `Stamped { seat, seq,
  cmd: Command }`, the canonical order `(tick, seat, seq)`.
- `lockstep.ts` — `LockstepClock`: buffers frames, yields "ticks runnable
  now" to the app's loop, holds the stall state.
- `ownership.ts` — `validate(cmd, seat, sideOf)`: a command naming an entity
  not on the seat's side is dropped, deterministically, on every client.
- `digest.ts` — the network hash: `sim.hash()` folded with
  `runtime.digest()` and the data digest.
- `transport.ts` — the `MatchTransport` interface and `LocalTransport`
  (single-player: frames are produced locally with zero delay, so one code
  path serves both; the sandbox and the campaign never notice).
- `ws-transport.ts` — the WebSocket client of the room, reconnect included.
- `view.ts` — a fog-respecting text view of one side for the harness
  (§8.3); pure over sim arrays, no renderer.

### 3.2 `MatchRoom`, the Durable Object

One per match, in `packages/worker/src/match/`. Bindings added to
`wrangler.jsonc`: `durable_objects.bindings[{ name: "ROOMS", class_name:
"MatchRoom" }]`, `migrations[{ tag: "net-v1", new_sqlite_classes:
["MatchRoom"] }]` (separate from the D1 `migrations_dir`), a rate-limit
namespace `ROOM_LIMIT` (id 1004, 6 per 60 s per IP), and a `TICKET_SECRET`.
`nodejs_compat` stays off; WebSocket hibernation and Web Crypto need nothing
from it. Durable Objects are on the free plan since April 2025.

#### 3.2.1 Routes (all under the existing `/api/*` `run_worker_first` entry)

| Route | Does |
|---|---|
| `POST /api/match` | creates a room: mints the code, stores an empty config, answers `{code, ticket}` for seat 0 |
| `POST /api/match/:code/join` | `{callsign}` → `{ticket}` for seat 1, or an advisor/bot ticket when the host enabled one; 404 for an unknown code, 409 for a full room |
| `GET /api/match/:code/ws` | `Upgrade: websocket`; Origin required; the first message is `hello{ticket}` |
| `GET /api/match/:code/log` | the frame log for a reconnecting client, a spectator or the arena; needs a ticket |

#### 3.2.2 The clock

The room is the metronome. While a match is `running` it emits one
`frame{tick, cmds}` every 50 ms (a Durable Object `setInterval`; the object
stays active for the match, which is the whole of its cost, §3.6). A command
that arrives between two frames is placed in the next frame, so the perceived
order latency is one round trip plus at most one frame: about 100–150 ms on a
home connection, which is where G5's "3 ticks" default came from, now
measured rather than configured. Clients run `bufferTicks` (2) behind the
newest frame as a jitter buffer and never advance a tick without its frame.

The clock **stops** when: a seat has not acknowledged within 40 ticks of the
newest frame (`ack` is sent every 10 ticks); a seat's socket is gone for 2 s;
a seat pauses; in paced mode, a round is complete and not every bot seat has
sent `done`. It resumes when the condition clears. Every stop is a
`stall{reason, seat}` broadcast and every resume a `resume`. Speed is a
lobby setting applied to the metronome (frames per second), so no client
ever runs at its own speed.

Every tick, every seat; the frame log is complete by construction. An empty
frame is still a frame, which is how a client knows tick N happened with no
orders.

#### 3.2.3 Messages (JSON; the full union is `packages/net/src/protocol.ts`)

Client → room: `hello{ticket}` · `lobby.set{side|kit|pace|map|callsign|ready}`
· `cmd{seq, cmd}` · `ack{tick}` · `hash{tick, h}` · `pause` · `resume` ·
`surrender` · `chat{text}` · `ping{x, y}` · `advisor{...}` (§8.4) ·
`done{round}` · `bye`.

Room → client: `lobby{config, seats, you}` · `start{config}` ·
`frame{tick, cmds}` · `stall{reason, seat}` · `resume` ·
`paused{seat, until}` · `hashOk{tick}` · `desync{tick, hashes}` ·
`chat{seat, text}` · `ping{seat, x, y}` · `advisor{...}` · `ended{result}`
· `log{config, frames}` · `error{code}`.

Chat, pings and advisor traffic are **relay messages, never frame contents**:
they cannot change the sim because nothing in a client turns them into a
`Command`.

#### 3.2.4 Storage

Durable Object SQLite: `match(config, status, startedAt, endedAt, result)`,
`seat(seat, player, callsign, connected, lastAck)`, `frame(tick, cmdsJson)`,
`hash(tick, seat, h)`. A 20-minute match is 24,000 frames, most empty, well
under a megabyte. On `ended` the room writes one row to D1 `matches` (§8.5)
and, on desync, the two frame logs and hash series into D1 beside the
feedback tables, then the Durable Object's own rows expire with the room
(six hours after creation). **Nothing goes to R2**: the account has no
payment method and R2 is not enabled.

#### 3.2.5 Pause and surrender (Decision 6)

`pause` from a seat with pauses left stops the clock and broadcasts
`paused{seat, until}`; the pauser may `resume` early; the room resumes at
`until` (90 s). Three per seat per match. `surrender` ends the match with the
other seat as winner. A client's Quit button is surrender, confirmed. There
is no local pause in a match: Escape opens the pause menu as today, and its
Resume is a room message.

#### 3.2.6 Reconnect

A reconnecting client sends `hello` with the same ticket; the room answers
`log{config, frames}` and the client rebuilds the sim from the config and
applies every frame at full speed, then joins the live stream. Measured sim
cost is 0.5–2 ms a tick depending on unit count (`docs/PERFORMANCE.md`), so a
20-minute match replays in 12–50 s, inside the 120-second window. The sim
has no snapshot or serialize today (there is no `Sim.save()` anywhere), so a
periodic snapshot that shortens this to under a second is a named follow-on,
not part of this design. After 120 s the room offers the remaining seat
`claim` (win) or `wait`.

#### 3.2.7 Paced mode (Decision 8)

With `pace.kind === 'paced'`, the room emits `roundTicks` frames, then waits
for `done{round}` from every bot seat (or `roundWallMs`), then emits the next
round. Human seats, if any, are never waited for. The frame log of a paced
match is identical in shape to a real-time one, so a paced match replays in
the browser at any speed.

### 3.3 Lockstep in the client

- **One transport seam.** `bootBattlefield` receives a `MatchTransport`;
  single-player gets `LocalTransport`. The battlefield has no "network mode"
  branches: it asks the transport for runnable ticks and gives it commands.
- **The tick loop.** `advanceClock` (shell/clock.ts) today yields ticks from
  a wall-clock accumulator clamped at 250 ms. It becomes: yield up to the
  newest buffered frame minus `bufferTicks`, at most 4 ticks per animation
  frame while catching up, zero while stalled. `__lions.step` is undefined in
  a match.
- **Commands.** `dispatch → applyIntent` (input/intents.ts:50) produces sim
  `Command`s as today; they go to `transport.send(cmd)` instead of
  `sim.queueCommand`. Coordinates are quantised to `Fx` on the issuing client
  (already true: `fx.from` at intents.ts:56-57) and the integers travel.
  `applyFrame` runs `validate` (§3.1) and then `queueCommand` in canonical
  order, before `sim.tick()`.
- **The three direct runtime calls** (`requestBuild` from the dock at
  ui/production.ts:330, `requestSweep` and `requestStrike` at
  main.ts:3612-3613) mutate `MissionRuntime` at event time today. In a match
  they are commands applied in `applyFrame` (N1 wraps them in the net layer;
  N2 makes them sim commands, §7.1). Since F1 the sweep and the strike are
  two kinds of one call, `requestSupport(kind)` (main.ts still reaches it
  through the `requestSweep`/`requestStrike` wrappers), so N2's kinds are
  `build` and `support`, plus `setStance` (L3). The
  tutorial's `completeObjective` does not exist in a match.
- **The replay recorder** (`feedback/replay.ts`) records frames instead of
  intents, which closes its three documented gaps (the direct calls, float
  coordinates, runtime-issued commands are no longer needed because frames
  are the only input) and makes a bug report's replay the same artefact as a
  match log.

### 3.4 Desync (Decision 10)

Every `hashEveryTicks` (20) each client sends `hash{tick, h}` where `h` is
`matchDigest(sim.hash(), runtimeDigest, contentDigest)`, folded in
`runFrames` (`packages/app/src/net/frame-step.ts`). **Ruled 15 Oct
(coordinator, lead-delegated):** the third term is the client's own
`shippedContentDigest()`, never the room-minted `config.dataDigest` (L4,
§2.1); the second is the `FrameStep.runtimeDigest` seam (N2-P2,
`3dd5c86a`), absent meaning 0. N2 wires `runtime.digest()` into it in one
line, and it folds non-zero only once a room runs a runtime, which is N3's
(L1). The room compares when
both arrive. On mismatch: `desync{tick, hashes}` to both, the match is
`void`, both frame logs and hash series go to D1, and each client shows a
banner naming the tick with a one-click report that reuses the feedback
endpoint (`category: 'desync'`, the log as the replay attachment). The sim
never attempts to resynchronise: for a lockstep sim a desync is a bug, and
hiding it converts a reproducible failure into an unreproducible one.

`sim.hash()` (sim.ts:5521-5646) covers the unit columns, terrain, projectiles,
structures, tunnels and RNG state. It does **not** cover `MissionRuntime` at
all (objectives, fired triggers, waves, the purse, Conduct, the build queue,
the civilian latches) nor `removed`, the flow-field pool, `pendingStrikes.by`
or the registered unit-type table. `runtime.digest()` (N2) covers the first
group; the data digest covers the type table's content (its ORDER is
covered by the lobby's build check, §2.1); the others are derived or inert
and are left out on purpose, stated in `digest.ts`.

### 3.5 Security

- A ticket is `b64url(HMAC-SHA256(TICKET_SECRET, "match:" + matchId + ":" +
  seat + ":" + player + ":" + exp))` plus its fields, the same Web Crypto
  pattern as `auth.ts`'s stats cookie but **never the same secret** (rotating
  `STATS_PASSWORD` is how dashboard sessions are revoked). Tickets expire with
  the room.
- The ticket rides in the first WebSocket message, never in the URL:
  `observability.redact_query_string` is `false`, so a `?ticket=` would be
  persisted in Cloudflare's logs.
- Every socket requires an `Origin` equal to the Worker's own or one in
  `ALLOWED_ORIGINS` (the `/api/feedback` rule, not the `/api/events` one,
  which tolerates a null Origin for `sendBeacon`).
- Limits: `ROOM_LIMIT` on create and join; messages over 4 KB dropped;
  at most 32 commands per seat per frame; rooms expire six hours after
  creation; a `hello` with a used ticket from a second socket replaces the
  first (that is the reconnect path) and the first is closed.
- A match never touches `lions.campaign.ledger`, `lions.brigade.account` or
  `lions.saves`.

### 3.6 Cost and deploy

A running room is one active Durable Object: 128 MB × 1,200 s ≈ 150 GB-s per
20-minute match against the free plan's 13,000 GB-s a day (about 80 matches
a day), and WebSocket messages bill at a twentieth of a request. The paid
plan (5 USD a month) is the fallback if friends multiply. The room ships
inside the existing Worker, so every push to `main` restarts live rooms
(Workers Builds deploys from `main`); the reconnect path is what makes that
survivable, and the lobby's "update available, finish your match first"
line is the honest version of it. A separate Worker for the relay is the
later answer if restarts hurt, and needs only a `script_name` binding.

### 3.7 Why not Colyseus, why not WebRTC

Colyseus cannot run on Workers: it is a long-lived Node process, so it means a
second platform (Fly.io, Render or a VM) with its own deploy, secrets and bill,
and HANDOVER tied it to a Supabase project that does not exist either. What it
would have bought (rooms, reconnect tokens, a client) is about 300 lines
here. WebRTC data channels give the lowest latency but need a TURN server for
a share of home connections, which is a paid service again, and leave no
neutral place for the frame log that reconnect, spectators and the arena all
rely on. A Durable Object is the one option that is already deployed.

---

## 4. Inviting a friend, the lobby, identity (Decision 4)

**Entry.** "Play with a friend" on the main menu (beside Campaign and
Brigade), route `/versus`, and a direct `/versus/<code>` for a guest. Both go
through `shell/links.ts`'s `routes` like every other path.

**Host.** `POST /api/match` → code and host ticket. The lobby shows the code
large and a copy-link button for `/versus/ABC123`. Codes use
`ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no 0/O/1/I), six characters, checked for
collision against live rooms.

**Guest.** Opens the link or types the code and a callsign (kept in
`lions.versus.callsign`, local only) → seat ticket → the same lobby.

**Lobby screen** (`ui/versus-lobby.ts`): two seat cards (callsign, connection
dot, side pick KDF/Sarim, ready toggle), the map, the kit mode (host-set,
guest-visible), the pace (host-set; `paced` only offered when a seat is a
bot), the seed, the build line, the one-line "friends only, fog is a
courtesy" notice, and host-only controls to add a bot seat or an advisor slot
per seat (§8). `start` fires when both seats are ready; the browsers boot
the mission behind the existing loading screen, whose deploy button becomes a
"both ready" barrier the room resolves. A seat that drops in the lobby
reopens by the same link.

**Identity.** The `player` field is the anonymous telemetry UUID
(`telemetry/identity.ts`), minted on first versus use even when telemetry is
off (a second key, `lions.versus.player`, so the telemetry opt-out stays
honest). When ST5 #204 lands, the ticket mint validates a Steam session
ticket and writes the Steam id into the same field; the room, the protocol
and the lobby do not change. There is no login, no email, no password.

---

## 5. What each player sees

### 5.1 `viewerSide`

Today the renderer and app assume the human is side 0 in about 70 places
across 22 files (the survey is in §7.4). `RendererOptions.viewerSide`
replaces every literal: fog (`three/fog.ts:101`), the draw gate
(`units/observed.ts:49`, `ThreeRenderer.ts:8660`), the seven tunnel reads,
contact marks, HP-bar colours, chevrons, the fire link, the silhouette slot,
the music intensity; and in the app `myLiving` (main.ts:2503), box select,
select-all, idle, control groups, hover, cursor, the minimap, alerts, the
voice director, the unit card and "Engaging". One relation helper,
`slot = side === viewer ? 0 : side === 2 ? 2 : 1`, maps a side onto the
three colour slots so the Sarim player sees their own force in the friendly
colour. `hullColors`/`infantryColors` stay indexed by faction, as they are
uniforms.

Two leaks close with it: `pickUnit` lets a click select a fogged enemy and
show its route and range (must-fix in N1), and tracers and muzzle flashes
draw outside fog (fixed in the same pass).

### 5.2 HUD, camera, briefing

Objectives, Conduct, logistics and intel become per-side views of per-side
runtime state (N3 for the state, since no versus runtime exists through N2 (L1); N1 shows the match clock, pop and purse of
the viewer's side only). Each seat's camera starts at its own camp. The
Shai/Idit briefing beats do not play in a match; the lobby is the briefing.
The pause menu keeps Resume, Settings and Quit; Restart is gone, Quit is
surrender.

### 5.3 Pings and chat (Decisions 15, 16)

Alt-click on the minimap sends `ping{x, y}`; it draws for the sender and the
sender's advisor only, never for the opponent. Text chat is a room relay
with a 280-character cap, drawn in the feed; an opponent's chat is visible
to both seats, an advisor's only to its own seat. Neither enters the sim.

### 5.4 Stall and desync banners

A stall over 500 ms shows "Waiting for <callsign>" with the reason (behind,
disconnected, paused with the countdown and who paused). A desync shows the
tick and the report button. Both are `aria-live` lines, through `t()`.

---

## 6. The Sarim seat (Decision 9)

### 6.1 What the first version gives a human on Sarim

- The KDF verbs that already work on any side: `move`, `attackMove`, `halt`,
  `garrison`, `load`/`unload`, `smoke` where the unit has it.
- `setStance{ids, stance: 'hold' | 'ambush' | 'patrol', waypoints?}` — a new
  `Command` that routes to the existing `setAmbush` and patrol machinery
  (today reachable only from mission JSON, mission.ts:1392-1398, 1558).
  **As built (N2, `7bd5d7c8`, `d84d2df2`): `hold` and `ambush` only.** `hold`
  is a halt on a free unit and leaves garrisoned and carried units alone
  (D2); `ambush` takes an integer Q16.16 radius in (0, `AMBUSH_RADIUS_MAX` = 655360], up to ten
  tiles; absent means `AMBUSH_RADIUS_DEFAULT` (196608), three tiles (R-1). `patrol` is N3's (L3).
- `build{camp, unit}` from the doctrine's menu at the Sarim camp, through
  Stage 4 F4's production line, spending the per-match budget (G3 Q7, 1.6×,
  doctrine data). Until F4 exists, N1's mirror match has no production on
  either side.
- Tunnels stay map-authored: diggers dig on their own, stocked fighters vent
  as today, and the player may order fighters into a mouth and out at a vent.
- On a human-held side no scripted trigger fires, no wave spawns and the
  doctrine commander does not run. **N3's, not N2's (D1, ruled 16 Oct by the
  lead):** the meaning is the versus-rules design (a `reinforce` trigger
  spawns on side 0 by definition, so "skip a human-held side" cannot mean
  "skip every trigger"), and no versus runtime exists to skip anything
  through N2. Civilians stay on side 2 and the ROE
  scoring still charges the KDF seat (Conduct is a KDF doctrine, not a
  symmetric score; the Sarim seat sees no Conduct panel).

### 6.2 What it costs

Two new `Command` members and one sim rule ("this side is human-held: skip
triggers, waves and the commander"), all in N2/N3. Nothing else in the tick.
**As built:** N2 shipped `setStance`, `build` and `support` and the breach
half of the seat rule (§7.1); the trigger, wave and commander half is N3's.

### 6.3 The follow-on: the full insurgent toolkit

Player-dug tunnels, IED placement, crowd-cover orders, a Sarim upgrade
ladder, a Sarim fire-support menu. Each is a sim mechanic with balance behind
it, and nothing here exists. It is its own package after N3, and §2.1's
`Seat` and §3.2.3's protocol leave room for it (a `setStance` with more
stances, a `build` menu that grows, a `dig` command).

---

## 7. What changes, what must not, and the audit

### 7.1 Sim (N2, all additive; the sim pins are expected not to move)

**Ruled 15 Oct (coordinator, lead-delegated): option B (L1).** This heading
first read "the golden hash moves once". Under option B every sim-side change
keeps today's behaviour for side 0 as the human seat (the seat table's
default is today's rule), the golden replay issues none of the new commands
and builds no runtime, and a versus room still runs no `MissionRuntime` until
N3. So the three sim pins in `determinism.test.ts`, F1's `ECONOMY_PIN` and
`ECONOMY_PIN_RELIEF` and the versus mirror pins are **expected not to move** in N2; if one does, it is
a defect to explain, not a planned move. One pin is BORN: a runtime-digest
pin for `MissionRuntime.digest()`. Decision memo and the non-sim
prerequisites (P1–P7): `docs/superpowers/plans/2026-10-15-net-n2-prereqs.md`.

**As built (N2, 16 Oct 2026, plan `docs/superpowers/plans/2026-10-16-net-n2-sim.md`,
branch `feat/net-n2-sim`, base `7512c8b9`).** Tasks 1 to 6 landed; Task 8
(the mission.ts seat sites) was not run and moved to N3 (D1). Every sim pin
was read back unmoved (flat 935671699, relief 2842924511, orders 3272041047,
`ECONOMY_PIN` 275731552, `ECONOMY_PIN_RELIEF` 145368021, and the mirror
pins), and two were born with the digest (`a5c0deab`): `RUNTIME_DIGEST_PIN`
2984314042 and `RUNTIME_DIGEST_PIN_RELIEF` 3060732596. `pnpm balance` and
`pnpm playtest` are identical to the pre-flight baselines bar the timing
line. The "Built" column below names the commit that made each row true.

| Change | Where | Why | Built |
|---|---|---|---|
| `MissionRuntime.digest()` | mission.ts, composing F1's `economyHash` | the network hash must see objectives, triggers, waves, purse, Conduct, build queue, civilian latches. Wired through the `FrameStep.runtimeDigest` seam (N2-P2); non-zero in a room only from N3 | `a5c0deab`: folds `economyHash()` first, then objectives, triggers, waves, the ROE score and the civilian latches; wired at `main.ts`'s `frameStep`, 0 in every room until N3. Two pins born |
| Integer purse | mission.ts, `logisticsValue`/`intelValue` | they accrue in doubles; F2 Task 1, carried as N2's first task (L5), makes them integer. Hash-neutral: the golden replay builds no runtime and the economy pin hashes the floor | F2 Task 1, `df48a80c` (#666, `f0c2a52c` on main), before N2 began: per side, in 1/2400ths. Intel is integer by construction (pre-flight step 4) |
| Side-0 rules → seat rules | `Sim.selectBreachTarget` (auto-breach); mission.ts's side-0 sites (`unitLost`, `identifiedBy`, `routeFoundBy`, `contributed`, the Conduct actor, zone contest, `from_ledger`) | a side is no longer "the player"; the rule asks the seat table, whose default is today's rule. The breach rule is a parity item, not a live fairness bug (§2.2, P6) | **Breach half built** (`963d6613`, `810ca26c`; `3689dd9f`): `Sim.isHumanHeld`. **The mission.ts sites are N3's** (D1, ruled 16 Oct): no versus runtime exists to need them |
| `build`, `support`, `setStance` as `Command`s | sim.ts `Command` union; mission.ts `requestBuild`, `requestSupport` | the direct runtime calls become tick-stamped input. F1 replaced the `sweep`/`strike` pair with `requestSupport(kind: SupportKind)` (`requestSweep`/`requestStrike` survive as wrappers over it), so N2 adds three kinds, not four | `setStance` `7bd5d7c8`, `d84d2df2`. `build` and `support` `fe9a42d7`, `fe29e6ba`: the runtime prices them (`canBuild`, `canSupport`, `applyQueued`; `Sim.takeRuntimeCommands`), the sim sets them aside, and a versus room drops both. The dock and the support click dispatch them (D3, check then send; `a5f7e6b4`) |
| `setStance` `hold` and `ambush` only | sim.ts (`ambush` → `Sim.setAmbush`) | the Sarim seat's verb (§6). **Ruled 15 Oct (coordinator, lead-delegated) (L3):** `patrol` needs the runtime's `stepPatrols` and moves to N3 | `7bd5d7c8`, `d84d2df2`. `hold` is a halt on a free unit; garrisoned and carried units are untouched (D2). `ambush` radius an integer Q16.16 in (0, `AMBUSH_RADIUS_MAX` = 655360], up to ten tiles; absent means `AMBUSH_RADIUS_DEFAULT` (196608), three tiles (R-1) |
| `humanHeld[side]` | mission.ts | triggers, waves and the commander skip a human-held side. The table arrives from `seatRules` in `@lions/net` (N2-P4); the sim never reads a config | The table and `Sim.isHumanHeld` are built (`963d6613`); `seatRules` feeds them (`3689dd9f`). **"Triggers, waves and the commander skip a human-held side" is N3's** (D1, ruled 16 Oct) |
| `Sim.seatOf(entity)` read; issuer-aware `queueCommand(cmd, seat)` later | sim.ts | the ownership check moves from the net layer into the sim when Stage 4's lane C slot opens | **N3 or later** (D4, ruled 16 Oct): ownership stays in `@lions/net` (`validateCommand`), which N2 extended for the three kinds (`7bd5d7c8`, `fe9a42d7`) |

**Per-seat unit types are no longer sim work. Ruled 15 Oct (coordinator,
lead-delegated) (L2), confirmed by N2-P5 (`b375d07c`, `bf76cc77`,
`packages/app/src/net/per-seat-types.test.ts`).** This table carried a
"per-seat unit types" row (`addUnitType` callers, mission-start.ts). The
spike needed no sim edit: `Sim.addUnitType` appends with no id check and the
sim never resolves a type by id, so side 1's patched roster
(`upgradePrepass`/`applyUpgrades`, same ids) registers a second time and
spawns through a per-side type map; unused copies move no hash; side 1's
units carry, fire with and are hit through their own patched stats; and
`forcesOf`/`scoreOf` still price every unit. The work moves to app and render
with "bring your brigade", and the spike names three follow-ups: **patched
copies keep the base id** (a distinct id prices at 0 through the `costOf`
lookup, `unitCost` by default);
**the render/HUD kit tables** (`unitKitTiers`, `kitByType`, `unitKit`) are
keyed by type id and need per-side keys; and **both seats build the per-side
tiers from the shared config**, or their worlds diverge.

**Per-seat kit, as built (16 Oct 2026, plan `docs/superpowers/plans/2026-10-16-net-per-seat-kit.md`,
branch `feat/net-seat-kit`).** All three follow-ups are done and no file
under `packages/sim/` changed; the versus and match-world pins did not move
(a `matched` room, and a `brigade` room whose seats hold equal or empty tiers,
register exactly today's type list and hash today's bytes).
- **Rulings, three lead decisions taken as recommended. Ruled 16 Oct
  (coordinator, lead-delegated).** (1) *Base-cost pricing:* a kitted unit is
  priced at its base id's cost (`forcesOf`/`scoreOf` need no mapping), so
  decision 24's surviving-value tiebreak favours the seat with the stronger
  units at equal value; recorded, revisited with N3's economy. (2) *Nested
  tiers:* `SeatConfig.tiers` is `Record<typeId, Record<track, number>>`, the
  account's `ownedTiers` shape and the one `upgradePrepass` takes; a matched
  room mints `{}`, so nothing on the wire changes for it. (3) *Structural
  checks only* (decision 22): the room cleans what is malformed or
  impossible (unknown or non-KDF types, unknown tracks and prototype-style
  keys are dropped; tiers are truncated and clamped to 0..max; the output is
  bounded by the track table; nothing is refused), records the cleaned claim,
  and cannot check it against an account until ST6. `unlocks`
  stays `[]` until N3's production can field one.
- **Wire.** `POST /api/match` takes `kit` (`matched` | `brigade`; only a
  versus room can be `brigade`) and `tiers`; `POST .../join` takes `tiers`.
  Both are cleaned against a plain list of the shipped tracks
  (`packages/worker/src/match/kit-tracks.ts`, pinned to the data by a test)
  and minted into the config at the start: a `brigade` room mints each KDF
  seat's own claim; a Sarim seat and a matched room mint `{}`. The lobby
  message names the rule (`kit`, only when it is `brigade`; absent is
  `matched`) so both seats see it before Ready.
- **The world comes from the config alone.** `buildMatchWorld` registers a
  patched roster per side from `SeatConfig.tiers` (each leaf clamped to the
  track's maximum, own keys only), `main.ts` and the HUD read each side's kit
  from the world, and the renderer takes plain per-side tables
  (`unitKitTiersBySide`) with one vehicle template per differing tier set.
  No room path reads `accountState()` or `bootTiers` to build anything; the
  local account is read once, to fill the create/join body, and never goes
  in a URL.
- **Lobby.** The host's create form has a "Bring your brigade" checkbox,
  default off, host only, labelled friends-only through the catalogue; the
  room screen shows the rule to both seats. It must not be offered in any
  public or ranked room.

Everything else in the tick is untouched. `pnpm test:determinism` must pass
before every commit here, and the two-client CI test (§12) beside it.

### 7.2 App and render

`MatchTransport` seam and `LocalTransport`; the tick loop (§3.3); dispatch to
the transport; `viewerSide` (§5.1); the recorder on frames; the versus entry,
lobby, banners, advisor panel, match debrief (writes nothing); the direct
runtime calls wrapped as commands in N1. `packages/render` reads
`viewerSide` and nothing else about the network.

### 7.3 What must not change

- The four invariants. The sim never reads the clock, the network, or a
  float; every command is a serialisable integer record.
- **No replicated unit state on the wire, ever.** The room never learns a
  position, an HP value or a fog tile. A PR that adds a state schema to the
  room is wrong by construction, the way a `sim → render` import is.
- Nothing in `packages/render` imports `packages/net`.
- No sandbox flag, `__lions.step`, `debugKill` or console mutator is
  reachable in a match; `__lions` exposes read-only `sim` and `renderer` and
  nothing that steps.
- No campaign ledger, brigade account or save is read by or written from a
  match.
- No Colyseus, no second platform, no R2, no Supabase for this feature.
- No per-unit A*, no engine library, no floating point in the sim.

### 7.4 The non-determinism audit (10 Oct 2026, read-only, five agents)

The sim core is clean: no transcendental `Math` (trig comes from committed
LUTs), every division an exact-integer idiom, every sort a total order,
Map/Set iteration in authored order, no eslint-disable in non-test sim
files, all `addUnitType` calls synchronous from the static roster, no boot
dependence on fetch order. The risks are all at the boundary, and this is
what the design above closes, most dangerous first:

1. **Per-player browser state reaches the sim** — ledger (roster, veterancy,
   pre-revealed enemies, build gates), account and coin wallet (tiers,
   bought units), tutorial flag, `?fresh`, a stale service-worker build.
   Closed by §2.1: the config is the only input, the build must match at
   the lobby, and each client's own data digest must agree at the first hash
   tick (L4).
2. **Three direct runtime calls at event time** (`requestBuild`,
   `requestSweep`, `requestStrike`) and the tutorial's wall-clock
   `completeObjective`. Closed by §3.3.
3. **The hash misses the runtime** and the purse is float. Closed by §3.4 and
   §7.1.
4. **The frame accumulator** (250 ms clamp, local pause, local speed,
   context-loss speed 0). Closed by §3.3 and §3.2.2.
5. **Sandbox boot uses `Math.atan2` and `Math.hypot`** (main.ts:421-422,
   sandbox-anchors.ts:56, 93-99): a near-tie could pick a different anchor
   on a different engine. N0 runs on the sandbox, so N0 replaces them with
   `fx.atan2` and integer squared distances.
6. **Commands carry no issuer and are never ownership-checked**
   (sim.ts:1784, 2029-2517). Closed by `validate` (§3.1) and later the
   issuer-aware entry (§7.1).
7. **No cross-engine CI**: the determinism job runs three OSes, all Node 22,
   all V8. §12 adds the two-client test under Firefox and WebKit through
   Playwright, which the visual job already has.
8. **`Fx` is not a brand** (`fixed.ts:19`, `type Fx = number`), so the type
   checker cannot stop a float entering. A branded `Fx` is recommended as a
   lint-adjacent follow-up and is not required by this design.
9. **`window.__lions.step`** and the sandbox flags: refused in a match
   (§7.3).

Known-good and relied upon: static roster order gives type indices, so
something must cover the roster file order. **Ruled 15 Oct (coordinator,
lead-delegated) (L4):** the data digest does not: it is key-sorted
(`canonicalJson`) and `units` is keyed by id, so the lobby's build check
covers the order instead (one build, one bundle, one order; §2.1).
`SIM_SEED` is a constant and the match seed replaces it through the config;
boot ordering is synchronous.

---

## 8. The AI harness and the arena (Decisions 7, 8)

### 8.1 Shape

An AI is another client of the room. `pnpm agent -- --room ABC123 --seat 1
--scope advise|assist|command [--model <id>]` runs a headless client in
Node (`tools/src/net/agent.ts` over `packages/net`): it joins with a ticket
the host issued from the lobby, keeps its own `Sim` in step from the frame
stream, and serves **MCP over stdio** so Claude Code, Claude Desktop or any
MCP-capable model connects to it. Under the MCP server is a documented JSON
protocol (the same WebSocket messages plus `advisor{...}`), so a non-MCP bot
or a later in-browser panel writes against the wire directly.

### 8.2 Scopes

| Scope | May read | May act | Seen by the human as |
|---|---|---|---|
| `advise` | its seat's fog view | `say`, `ping` | messages in the advisor panel, pings on the map |
| `assist` | same | every seat verb, **with veto**: an order is relayed to the human's client first, drawn highlighted for two seconds, cancellable with one key, then enters a frame | highlighted orders, messages, pings |
| `command` | same | every seat verb, no veto | a bot seat; the human may spectate it |

An unattended bot seat with no model attached is driven by the sim's own
doctrine commander (WP-G-G0's, deterministic and cheap: about 0.02 ms a tick
at 300 units; it does not yet punish a bad plan, so the first 1v1 depends on
no strong built-in opponent).

### 8.3 Tools

`observe()` → a fog-respecting text view of the seat's side built by
`net/view.ts` from the sim arrays: own units (id, type, tile, hp, state,
order), contacts the side has (through `contactLevel(side, i)`), zones and
who holds them, purse and pop, the last N events for the side, the match
clock. Coordinates in tiles, never world units. `inbox()` → messages the
human typed in the advisor panel since the last call. `say(text)`.
`order(verb, ids, x, y)`, `set_stance`, `build`, `fire_support`, `ping`,
and in paced mode `end_round()`. Every acting tool returns what the room
accepted and what `validate` dropped, so a model learns its boundaries.

### 8.4 The advisor channel

`advisor{to: seat, from: 'human'|'advisor', kind: 'text'|'proposal'|'veto'|'accept', ...}`,
relayed by the room between a seat's browser and that seat's harness only.
The in-game **advisor panel** (`ui/advisor.ts`): a feed, a text box, and the
proposal strip where an `assist` order shows for two seconds with Accept and
Veto. One brain, two faces: the model runs in the player's own tool, the
conversation lives in the game.

### 8.5 The arena

`pnpm arena -- --a <model> --b <model> --seeds 10 --map <id> [--pace 60]`
creates paced rooms, attaches two harnesses in `command` scope, swaps sides
per seed, and writes each result to D1 `matches(matchId, map, seed, seatA,
seatB, winner, lengthTicks, conductA, conductB, tokensA, tokensB, logRef,
endedAt)`. `/stats/arena` (behind the stats password) shows win rate by
model, by side and by seed, average Conduct, median length and tokens.
"Better" means win rate over the seed set with sides swapped; Conduct and
tokens are reported, not scored. Pacing makes a benchmark reproducible:
every model gets the same number of decisions whatever its latency, and the
frame log replays the match in the browser afterwards, which is also the
cheap spectator mode. StarCraft II's research benchmarks (SC2Arena,
TextStarCraft II) pace model agents the same way, macro decisions over text
summaries at a fixed cadence; the bot-only AI Arena ladder is the other
model, scripted bots in real time, and is what `command` scope with no model
is.

---

## 9. Staged plan

Dates assume a start on 12 Oct 2026. Each stage is one spec section above,
one plan of 8–12 tasks, and one PR series with `gates` and `determinism`
green, per the working rules on every WP issue.

| Stage | When | Lane / touches | Delivers | Gate |
|---|---|---|---|---|
| **N0 · two-machine test** (re-scoped #190) | 12–31 Oct | new `packages/net`, `MatchRoom` DO, `MatchTransport`, tick loop; `wrangler.jsonc` bindings | two laptops in one sandbox room, both ordering the KDF force (no ownership, no sides), hashes compared every 20 ticks for ten minutes; the two-client CI test; a report with RTT, stall count, replay time | hashes equal on 10/10 ten-minute runs across two machines; report on #190 |
| **N1 · versus, mirror** | 2–27 Nov, beside Stage 4 | app, render (`viewerSide`), worker; no sim | code and link, lobby, tickets, pause/stall/reconnect, desync report, chat and pings, `pickUnit` leak closed; **KDF v KDF on a placed-force sandbox map** | Ilan and a friend play three matches to a result; one deliberate desync reported end to end |
| **N2 · sim seat work** | directly after F3 (L5) | sim (lane C slot) | F2 Task 1 first (integer purse), then runtime digest, seat rules (`humanHeld`, the breach rule), `build`/`support`/`setStance` (`hold`, `ambush`) as commands. A room still runs no runtime (L1); per-seat types are app/render work (L2). **Ruled 15 Oct (coordinator, lead-delegated)**; this row first read "per-seat types … golden hash moves once": under option B the sim pins are expected not to move | determinism green with the sim pins unmoved and the new runtime-digest pin born; `tools/src/net/two-client.test.ts` shows equal hashes over the versus frame stream, the `setStance` frame included, and the mirror pins are unmoved (versus-force, match-world, per-seat-types); a live two-client replay is CI/N3's. **Met 16 Oct 2026** (branch `feat/net-n2-sim`, head `a5c0deab`; §7.1 "As built"). Not built, moved to N3 (D1): the mission.ts seat sites |
| **N3 · the Sarim seat** | Jan–Feb 2027, with WP-G-G | sim, data, app | KDF v Sarim on the skirmish rules (zones, pop caps, doctrine production), the lobby's side pick live, `build` from the doctrine menu | G5 #169 closed 5 Feb with this spec's answers; Ilan plays five KDF v Sarim matches |
| **N4 · AI harness and arena** | Jan–Mar 2027, in parallel from N1's protocol | net, tools, worker | `pnpm agent` (MCP, three scopes), advisor panel, `pnpm arena`, `/stats/arena` | an `assist` advisor completes a match with Ilan; a ten-seed arena run between two models reported |
| Follow-ons | after N3/N4 | | insurgent toolkit (§6.3), sim snapshot (§3.2.6), spectators as a feature, accounts via ST5, skirmish payouts | own specs |

**Beside Stage 4.** N0 and N1 touch no sim file, so lane C (WP-G-F, from
2 Nov) is undisturbed. `ThreeRenderer.ts` is the one shared file: `viewerSide`
is a single PR in N1 scheduled against the polish lane's own touches of it.
N2's sim work comes directly after F3 (L5; ruled 15 Oct, coordinator,
lead-delegated), carrying F2 Task 1 (the integer purse) as its first task
rather than landing beside it. N3 rides on WP-G-G,
whose zones, pop caps and production are the skirmish rules the Sarim seat
plays.

**Milestones and issues.** M4 "play with a friend" moves from 16 Apr 2027
to end of February 2027, with the mirror match playable in November. #190
is re-scoped to N0 now; #191 to N1–N3; #169 is answered from this spec
(transport: Durable Object room; input delay: the room clock, measured in
N0; co-op rules: not applicable, skirmish only); #132 is marked superseded
in its Colyseus half with a pointer here; new issues open for N2, N3, N4 and
the toolkit. HANDOVER is rewritten twice a day by the plan-refresh routine,
so the record lives in this file and on the issues.

---

## 10. Decisions

Answered by Ilan, 10–11 Oct 2026:

| # | Question | Answer |
|---|---|---|
| 1 | What is the first network game? | A 1v1 skirmish; each seat picks KDF or Sarim; the asymmetric and the mirror match share one lobby |
| 2 | Co-op on the campaign? | No. Skirmish only; campaign, account, Conduct and saves stay single-player |
| 3 | Where does the relay run? | A Durable Object in the existing Worker. Colyseus (G5 default) withdrawn; WebRTC rejected |
| 4 | Invite and identity | Room code plus link, no accounts; ticket shaped so ST5's Steam id slots into `player` |
| 5 | What each player brings | Matched kit by default; "bring your brigade" a friends-only lobby toggle that brings anything the player owns, earned or bought (11 Oct ruling; never in a public or ranked room); Sarim has no tier ladder yet |
| 6 | Lag, pause, disconnect | Friendly: stall everyone with a banner, three 90-s pauses each, 120-s reconnect from the log, quit is surrender. **Disconnect half superseded 13 Oct by decision 23** (§11b) |
| 7 | How an AI connects | A headless harness serving MCP over a documented JSON protocol, with the game UI as the advisor's face |
| 8 | AI versus AI | Real time and paced, a `pace` field; arena scores win rate with sides swapped, Conduct and tokens reported |
| 9 | How much Sarim seat | Minimal now (KDF verbs + `setStance` + `build`); the insurgent toolkit as a named follow-on |

Defaults recorded with the recommendation; overturn any in review:

| # | Decision | Default |
|---|---|---|
| 10 | Desync policy | hash every 20 ticks (`sim.hash()` + runtime digest + data digest); halt, name the tick, store both logs in D1, one-click report; never resync |
| 11 | Clock model | the room is the metronome at 20 Hz; clients run 2 frames behind; stall at 40 ticks behind or 2 s silent |
| 12 | Win rule, version one | annihilation or surrender; 25-minute cap settled by held-ground seconds; tie is a draw. **Tiebreak superseded 13 Oct by decision 24** (§11b) |
| 13 | Pause budget | 3 × 90 s per seat; only the pauser resumes early |
| 14 | Reconnect | 120 s, then the other seat may claim or wait. **Superseded 13 Oct by decision 23** (§11b): 60 s, then an automatic forfeit, no claim |
| 15 | Pings | sender and sender's advisor only |
| 16 | Chat | text, 280 characters, relay only, in version one |
| 17 | Speed | host-set in the lobby, applied by the room; never local |
| 18 | Unattended bot seat | the doctrine commander. **Not built yet** (WP-G-G0 has not landed); N4 ships scripted baseline bots instead (§11b, N4 plan). **Shipped in N4b** (§11c.5): `passive` and `rush`, fog-respecting, in-process only; `rush` scores 0.750 against `passive` on `tel_marum` over ten seeds, and 0.675 over the gate's twenty (p 0.019, §11c.7). A bot seat with a model attached is `pnpm agent --scope command --join` |
| 19 | Arena scoring | win rate over the seed set with sides swapped; Conduct and tokens reported only. A versus room runs no `MissionRuntime`, so there is no Conduct to report until N3 (**Ruled 15 Oct (coordinator, lead-delegated), L1**: N2 keeps rooms runtime-free; this note first read "until N2/N3"); the arena reports the scoreboard (decision 25) in its place (§11b). **N2 kept the rooms runtime-free as ruled** (`a5c0deab` wires `runtime.digest()` into `frameStep`, and it folds 0 in every room until N3). **Shipped in N4b** (§11c.6, D7): (wins + ½ draws) / non-void games, overall, per seat and per faction, each seed played twice with the seats swapped; the scoreboard per game; tokens when the client prints them, never scored; a game the room desyncs or the two sims disagree on is void. Results go to local files, not D1 (D6 "not now") |
| 20 | Skirmish payout | none in version one; earned credits for a result is a later ST/G-G question |
| 21 | Storage | Durable Object SQLite for the room, D1 for results and desync logs; nothing in R2 |
| 22 | Cheat posture | friends only, stated in the lobby; no authoritative sim in this design |

---

## 11. Risks and open questions

- **Cross-engine determinism is unmeasured.** Every determinism run so far is
  V8. §12's two-client test under Firefox and WebKit is the first time the
  claim is tested; if it fails, the fix is in the boundary (§7.4), not the
  sim, and N0 exists to find it.
- **Deploy restarts live rooms.** Acceptable for friends with the reconnect
  path; a separate relay Worker is the later answer.
- **Replay-from-zero reconnect** can take up to ~50 s on a large match. A sim
  snapshot is the follow-on; the 120-s window covers it until then.
- **The Sarim seat's balance** is unknown until N3 and depends on WP-G-G's
  rules; the mirror match in N1 is why a playable 1v1 does not wait for it.
- **"Bring your brigade" trusts the client** until ST6's server ledger: an
  edited local store can claim units never owned. It brings what the player
  owns, earned or bought (the lead's 11 Oct ruling, overriding the 1 Oct
  earned-only rule for friends' rooms), is labelled friends-only, defaults
  off, and must never be offered in any later public or ranked room. The
  monetisation plan (draft PR #520) lands that guard, "never outside a
  friends' room", with N1; this spec adopts it.
- **The `Fx` brand** and a `Math` ban in `packages/data` are recommended and
  not required; both are one-line lint changes that would make §7.4 hold by
  the compiler.
- **A bot's `observe` fog** is computed in Node by `net/view.ts` from the
  sim's per-side contact arrays and a sight pass identical to `three/fog.ts`'s
  rule; the two must share one function or they will disagree about what a
  bot may see. The design moves the sight rule into `net/view.ts` and has the
  renderer call it.

---

## 11a. N0 outcome and what N1 inherits (11 Oct 2026)

N0 landed as PR #543 (`feat/net-n0`, twelve tasks, subagent-driven, CI
green; the red "Workers Builds" check on the branch is `versions upload`
refusing the pending `net-v1` Durable Object migration, which only
`wrangler deploy` from `main` applies). The ledger of its 42 rulings and the
final review live in the project-manager session's scratchpad
(`net-n0/progress.md`, `final-review.md`). A simulated match wrote about one
SQLite row a second, inside the Workers Free plan. Deferred to N1, and owned
by this design:

- **Coordinate range checks on commands** — `validateCommand` checks ownership
  only; a `move` to a point off the map is still queued and the sim clamps it.
  N1 adds a map-bounds check in `ownership.ts`.
- **Ownership of structure and tunnel ids** — `garrison`, `demolish` and
  `chargeTunnel` check the unit ids, not the target; N1 adds "the structure
  exists" and "the route exists" to the same check.
- **Seat tiers onto the sim** — `SeatConfig.tiers` is carried and not applied;
  N1's per-seat type registration (§7.1) is where it lands, for `brigade` kit.
- **A Durable Object alarm instead of the ack heartbeat** (ruling R38) — the
  ack is what detects a silent seat today; an alarm detects it without a
  client's help and survives hibernation.
- **Re-sent copies after a DO restart** (ruling R36) — the frame log can hold
  duplicate copies of up to 19 ticks when the object restarts mid-frame;
  `LockstepClock` discards them as `'duplicate'`, so no client runs one twice,
  and N1 dedupes the log on write.
- **Headless Firefox on CI has no WebGL2**, so the three-engine check reports
  Chromium and WebKit only; a Firefox reading needs either a software GL flag
  or a headed runner, and until then the cross-engine claim is two engines.

## 11b. The lead's rulings of 13–14 Oct, N1 as built, and what N4 and N2 inherit (14 Oct 2026)

Recorded here rather than in `docs/HANDOVER.md`, which a routine rewrites
twice a day. Read against `main` `f4b3ea2b` (14 Oct). Everything below is
what the code does; where it differs from the ruling as it was put, the
difference is named.

### 11b.1 Rulings (decisions 23–27)

| # | Ruling (the lead) | When | Landed in |
|---|---|---|---|
| 23 | **The player who drops loses**, after 60 s of grace; **leaving a started match is a surrender** | 13 Oct | #579 |
| 24 | **Stalemate and the cap are settled by force value**: when neither side can move any unit, or at 25 minutes, the side with the higher total surviving unit value wins; equal value is a draw | 13 Oct | #579 |
| 25 | **A scoreboard**: kills and losses, each with its value | 14 Oct | #587 |
| 26 | **KDF vs Sarim is allowed in friend matches** on the fair-map list | 14 Oct | #589, narrowed by #596 and #600 (below) |
| 27 | **Dedicated versus maps**, Wadi Tarfan and Milh Flats; **Milh Flats is mirror-only** | 14 Oct | #600 |

Decision 23 supersedes decision 14 and the disconnect half of decision 6;
decision 24 supersedes decision 12's held-ground tiebreak. Both are marked in
§10's tables.

### 11b.2 As built

**#579, dropping and leaving (decision 23).**
- A versus seat disconnected for `FORFEIT_MS` = 60,000 ms of WALL time loses:
  the room ends `forfeit` naming it (`room-core.ts` `forfeitIfDue`). A
  reconnect inside 60 s cancels the clock completely, the ~4 s reload rejoin
  included; a later drop starts a fresh 60 s. Both seats see
  `dropped{seat, remainingMs}` and `back{seat}`.
- A pause does not shelter a dropped seat: the forfeit is asked before the
  pause in `clockTick`.
- Both seats gone: the one gone LONGER loses; both gone at the same instant
  (a deploy dropping every socket) voids the match. The check runs before any
  hello, so who reconnects first does not change the answer.
- `bye` in a started match ends it `left` naming the leaver, who loses at
  once; closing the tab is a disconnect (the 60 s rule), not a `bye`. A `bye`
  in the lobby closes the room for both and names nobody.
- Not applied to a sandbox room (both seats on one side), to the lobby, or once
  the result is settled (the `over` close is armed).
- Cost: no alarm of its own; 0.28 rows/s over the 60 s wait, measured.
- **Differs from §3.2.6**, which said 120 s and then the remaining seat may
  `claim` or `wait`: there is no claim; the room decides at 60 s.

**#579, stalemate and the cap (decision 24).** `packages/app/src/net/outcome.ts`,
read from hashed sim state only and asked only on hash ticks, so both seats
decide on the same tick:
- **Annihilation:** a side with no living ARMED unit (a weapon, and
  `firepowerKilled` not set) has lost; both on one tick is `draw mutual`. There
  is no production clause, because a versus room has no production.
- **Stalemate:** every living unit of sides 0 and 1 is permanently immobile
  (`mobilityKilled[i] === 1`, or a type whose `stepPerTick` is 0). Pinned,
  garrisoned, carried, buried, braced and halted units are NOT immobile. So
  "neither side can move any unit" is read as *can never move again*, not
  *is not moving now*.
- **Cap:** `MATCH_CAP_TICKS` = 25 × 60 × 20 = 30,000 sim ticks.
- **Value:** each side's sum of `cost.logistics` over its living units
  (`unitCost`; a type the data does not know counts 0). Higher wins, equal
  draws. The end panel prints "won on remaining forces (x vs y)".

**#587, the scoreboard (decision 25).** `packages/app/src/net/scoreboard.ts`.
- Per side: units **lost** (count and value, a mission's `removed` excluded),
  units **destroyed**, and **force left** (`forcesOf`, the number decision 24
  settles on).
- **"Kills" are not attributed to a shooter.** A side's destroyed is the other
  side's lost, read from state, so a rejoin replays into the same board. A unit
  killed by its own side's splash therefore counts as a kill for the enemy, on
  both screens alike. (Sim `destroyed` events do carry `by`; the board does not
  read events, on purpose.)
- HUD table under the strip in versus rooms only; the full table on the
  match-over panel; nothing mounted in single-player or a sandbox room.

**#589 + #596 + #600, KDF vs Sarim (decision 26).**
- The host picks a **matchup** at `/create`: `mirror` (KDF v KDF, the default),
  `kdf` (host KDF, guest Sarim) or `sarim`. The room keeps `factions` by seat
  and mints them into `SeatConfig.faction`. There is no in-lobby side change
  after creation (no `lobby.set`).
- The Sarim force is placed, with no production: `VERSUS_SARIM`, 14
  `atgm_cell`, 6 `gun_truck`, 2 `manpad_team`, 2 `rocket_battery`, 2
  `sarim_rifles`. Its value is 6,736, against the KDF versus force's 6,664.
  No unit stat was touched and there was no sim change.
- **Narrower than the ruling as put.** KDF vs Sarim is not offered on the whole
  fair-map list. It is offered on `FACTION_MATCHUP_MAPS` = `tel_marum`,
  `wadi_tarfan` only. `beit_sahwan_outskirts` leans KDF (~69%) and
  `milh_flats` is mirror-only. The route AND the room's `/create` answer 400 to
  a non-mirror matchup anywhere else (`matchupAllowed`).
- Both offered maps read **Sarim 60.4% (29 of 48) in the KDF-west spawn
  order**. That is outside the probe's strict 60/40 bar by one game, and the
  ruling stands on that reading (#596, #600).

**#596, the fair-map list.**
- A versus room is offered only on `VERSUS_FAIR_MAPS` =
  `beit_sahwan_outskirts`, `tel_marum`, `wadi_tarfan`, `milh_flats`. The
  route and the room's `/create` refuse others with 400.
- A sandbox room is not limited. A room already open keeps playing.
- The bar for re-opening a map: per-map fair start points, measured within
  60/40 at 48 seeds per spawn order by `pnpm versus:probe`. The probe is
  report-only and exits 2 only on its own failed self-check. #561 stays open.

**#600, the dedicated maps (decision 27).**
- `wadi_tarfan` (The Three Fords) and `milh_flats` (Bir Milh): 48×48 and
  point-symmetric. Their seats are the markers `versus_0`/`versus_1`, which
  `sandboxAnchors` reads by name.
- Mirror reads: wadi_tarfan west 22 / east 25 / 1 draw; milh_flats 24 / 24.
- Milh Flats is mirror-only: with Sarim on the west seat, KDF wins 33 of 48.

**What N1 left differently from §2.1 and §3.2.3. N4 builds on these as they
are, not as the spec drew them.**
- `MatchConfig` has no `rules`, `commit`, `inputDelayTicks` or per-seat
  `advisor`.
- The room mints `dataDigest: 0`. The lobby compares only the build string
  (`<package version>+<commit>`, `hello.build`), and a mismatch is
  `build_mismatch`, close code 4002. **Since N2-P3 (`e877c8e7`; Ruled 15 Oct
  (coordinator, lead-delegated), L4)** the minted 0 stays on the wire and is
  never folded: each client folds its own key-sorted content digest
  (`shippedContentDigest()`), so different data is a desync at tick 19, and
  roster ORDER, which a key-sorted digest cannot see, is covered by this
  build check (§2.1).
- `pace` is always minted `realtime`, and **paced mode is not implemented**:
  `room-core.ts` reads no `pace`.
- Seat `kind` is always `human`. `/join` hands out seat 1 only; there is no bot
  or advisor ticket.
- Client messages are `hello`, `ready`, `cmd`, `ack`, `hash`, `bye`, `pause`,
  `resume`, `surrender`, `chat`, `over`. There is **no** `lobby.set`, `ping`,
  `advisor` or `done`.
- Server messages add `cmdRefused`, `dropped`, `back` and a chunked `log`.
- There is no `GET /api/match/:code/log` route: a rejoin is a `hello` with
  the same ticket.
- `start`/`log` carry per-match seat tokens in `seats[i].player`, never the
  persistent anonymous id.
- **Security caps from #566** that every new client (the harness included)
  meets:
  - messages ≤ 4,096 bytes;
  - ≤ 4 of a seat's commands per frame, ≤ 12 pending, and a token bucket of
    20 at once and 20 a second;
  - ≤ 256 ids per command;
  - ≤ 2,000,000 characters of command JSON per room, past which the match is
    void;
  - per socket: 160 messages at once and 80 a second, with advancing acks and
    hashes free;
  - ≤ 8 live sockets a room; a hello within 10 s or the socket is closed (1008);
  - `WS_LIMIT` 60 upgrades a minute per IP; `ROOM_LIMIT` on create and join;
  - `Origin` required on every route, the upgrade included;
  - `callStrike` and `reveal` dropped in versus (`SeatWorld.versus`);
  - commands rebuilt field by field (`cleanCommand`); chat and callsigns
    cleaned (`cleanChat`, `cleanCallsign`).
- **Row budget** (R-N12, accepted): a command frame closes its batch, which is
  one row. So a match writes `max(command frames a second, 1)` rows a second,
  plus 0.2 for the watchdog: about 1.2 idle and **2.2 with one order a second
  from each seat**.
- **Per-seat kit (16 Oct 2026), the as-built note for item 12 of §11b.4.**
  The three rulings above (base-cost pricing; nested `SeatConfig.tiers`;
  structural-only trust) are recorded in §7.1 with the wire, the world and
  the lobby. What a later reader will otherwise get wrong: `tiers` is the
  account's nested per-type shape and no longer the flat `Record<string,
  number>` this section's `Seat` block once declared; the lobby message now
  carries `kit` for a `brigade` room; and the claim is client-trusted, so
  `brigade` is never to be offered outside a friends' room.

### 11b.3 What N4 inherits, and the shape its plan takes

N4 needs no sim change and starts now
(`docs/superpowers/plans/2026-10-14-net-n4-ai-harness.md`). Four points of
that plan revise this spec, and each one is a lead decision listed there:

- **The advisor is a third socket of its seat**, admitted by an advisor ticket
  that the seat itself mints. It is not a seat. An `assist` proposal travels to
  the human's browser, and the browser sends it as its own `cmd` after two
  seconds unless vetoed. The room never stamps an order from an advisor, so
  ownership stays per seat.
- **The arena runs on a local relay**: `room-core.ts` hosted in Node on
  127.0.0.1, with an in-memory ticket secret. It writes no Durable Object or D1
  rows and needs no secret and no network. A remote arena against the Worker,
  and `/stats/arena`, are a separate gated step.
- **A bot's orders are coalesced** to at most one command frame a second and
  4 commands a flush. A bot seat therefore costs the same rows as the human the
  2.2 rows/s budget assumes.
- **The built-in opponent is a scripted, fog-respecting baseline**, until the
  doctrine commander exists.

**Ruled 14 Oct (lead): the N4 plan's eleven decisions, D1–D11, are accepted
as recommended.**
- **D1:** each seat may invite its own advisor, one per seat, and both seats
  see a badge.
- **D2:** `tools/` may import `packages/worker`, for the local relay only.
- **D3:** `ws` and `@modelcontextprotocol/sdk` as tools-only devDependencies,
  at exact versions.
- **D4:** a bot's orders are coalesced to at most one flush of 4 commands per
  20 ticks, with a queue of 12.
- **D5:** paced mode is minted only when a seat is a bot, and human seats are
  never waited for. `roundTicks` is clamped to 20–1,200 and `roundWallMs` to
  1–600 s.
- **D6 is "not now":** no D1 `matches` table and no `/stats/arena` in N4. The
  arena reports locally.
- **D7:** score = (wins + ½ draws) / non-void games, with seats swapped per
  seed. The scoreboard is reported in place of Conduct, and tokens are
  reported, never scored.
- **D8:** the `passive` and `rush` scripted baselines stand in until the
  doctrine commander exists. This answers decision 18 for now.
- **D9:** the Node harness sends the server's own `Origin`.
- **D10:** an advisor's socket receives the full frame stream while the
  model's view is fogged, under the friends-only posture.
- **D11:** X is the veto key.

**Ruled 14 Oct (lead): `over` stays unchanged in N4.** Any result the room
records comes from its own end state (its ending reason). A `winner` field on
`over` is a later protocol change.

### 11b.4 N2's prerequisites (to be scheduled after the garrison overhaul and F1)

N2 is sim work, and Lane C allows one sim plan in flight. It cannot start
until all of these hold:

1. **The garrison overhaul has landed**
   (`docs/superpowers/plans/2026-10-14-garrison-overhaul.md`). **Met: it
   landed on 14 Oct as #606**, and the versus mirror pins did not move. It rewrites
   `losRay`/`raySmoke`, `applySuppression`, `detectionPair` and
   `stepGarrison` in `sim.ts`, and moves the three sim pins.
2. **WP-G-F1 has landed** (`2026-10-04-gf1-fire-support-intel.md`). Its Task 1
   adds `MissionRuntime.economyHash()`, which N2's `runtime.digest()` must
   compose with rather than duplicate. Its Task 8 reshapes
   `requestSweep`/`requestStrike` around `SupportKind`. N2 turns those calls
   into `Command`s, so it must start from F1's shape, not today's.
3. **F2 Task 1 (the integer purse) lands with or before N2.** §7.1 already
   ties them: `logisticsValue += rate / 1200` is a float accrual that a
   network hash must not see.
4. **No other Lane C plan is adding a `Command` kind at the same time.**
   Targeted fire (`attack`, #591) has landed, and Hold's sim command was
   retired by the lead's ruling of 11 Oct (stage 4 order, ruling 1). Any new
   kind that lands in the meantime must be in `@lions/net`'s whitelist and
   ownership check before N2 adds its three: `build`, `support` and
   `setStance` (this item first said four; F1 replaced the `sweep`/`strike`
   pair with `requestSupport(kind: SupportKind)`). **Built in N2:**
   `setStance` `7bd5d7c8`, `build` and `support` `fe9a42d7`, each with
   `COMMAND_KINDS`, `cleanCommand` and `validateCommand` in the same commit. Since N2-P1 (`d407f8e3`)
   the whitelist is pinned both ways: `COMMAND_KINDS` is checked against
   `Command['kind']` by `MissingCommandKind` in
   `packages/net/src/protocol.ts`, so a kind missing from the list is a
   compile error naming it, not a silent drop.
5. **A decision on whether a versus room runs a `MissionRuntime` at all.**
   **Resolved: Ruled 15 Oct (coordinator, lead-delegated), L1, option B.**
   A versus room keeps running none through N2. N2 makes the sim seat-aware
   (the seat table, the breach rule, the side-0 sites re-keyed with today's
   rule as the default) and the runtime network-hashable
   (`runtime.digest()`, the three commands; both built, §7.1 "As built"), and the first versus runtime is
   N3's opening task, built on the per-side state F2–F4 deliver. Its rules
   will be data, never a mission synthesised in TypeScript. The memo, the
   options and the reasons: `docs/superpowers/plans/2026-10-15-net-n2-prereqs.md`.

**Sim surfaces N2 touches.** Locate them by symbol; line numbers are as of
`f4b3ea2b`.

**As built (N2, 16 Oct 2026).** The breach rule and the three commands are
built; the digest is born and wired. The mission.ts seat sites below (the
first five bullets, and the trigger/wave/commander half of `humanHeld`) are
**not built and are N3's** (D1, ruled 16 Oct by the lead): no versus runtime
runs until N3, so each is reachable only by a synthetic test. Commits are
named per bullet.

- **`MissionRuntime.step`, `unitLost`** (`mission.ts` ~L1071) is emitted for
  side 0 only, with `side: 0` hard-coded. It becomes per side, or per seat.
- **The same digest loop:**
  - `identified`/`identifiedBy` count only side-0 observers of side-1 targets
    (~L1044);
  - `routeFoundBy` counts only side 0's tunnel identifications (~L1058);
  - `kills`/`contributed` credit only side-0 killers (~L1061–1064).
- **Conduct and ROE scoring** judge only side-0 actors (~L1453–1511:
  `structureDestroyed`, `destroyed`, `nearMiss`, `strike`, `fire`). Per §6.1,
  Conduct stays a KDF doctrine: it becomes "the KDF seat's side", not
  literally 0.
- **Zone presence and contest** count side 1 against side 0 (~L1600–1614).
- **Placement:** `from_ledger` applies to side 0 only (~L1309), and
  `playerIds`/`enemyIds`/`civIds` are bucketed by side (~L1360).
- **The direct runtime calls** `requestSupport(kind)` (F1; `requestSweep`
  and `requestStrike` are wrappers over it) and `requestBuild` (~L803–846 at
  `c8123109`) become tick-stamped `Command`s (§7.1). **Built** (`fe9a42d7`, `fe29e6ba`; the app path `a5f7e6b4`).
- **`sim.ts` `selectBreachTarget`**: "side 0 never auto-breaches" (~L3752 at
  `c8123109`; the spec's L3415 has drifted) becomes a per-seat rule. N2-P6
  measured it: a parity item with no measurable outcome effect, firing only
  on the walled maps (§2.2). **Built** (`963d6613`, `810ca26c`):
  `Sim.isHumanHeld`.
- **The `Command` union** (`sim.ts` ~L623 at `c8123109`) gains `build`,
  `support` and `setStance` (`hold` and `ambush` only: **Ruled 15 Oct
  (coordinator, lead-delegated), L3**; `ambush` routes to `Sim.setAmbush`,
  and `patrol`, which needs the runtime's `stepPatrols`, moves to N3).
  **Built** (`7bd5d7c8`, `fe9a42d7`); `build` and `support` are runtime
  commands: `Sim.takeRuntimeCommands` hands them to `applyQueued`, which
  checks them with `canBuild` and `canSupport` and prices them, and the sim
  discards whatever is left at the tick (R-3). In
  `@lions/net`, `COMMAND_KINDS` and `cleanCommand` (whose `never` default
  makes `tsc` fail until the kind is handled) and `validateCommand` (an
  exhaustive switch) must each handle them in the same PR; N2-P1's
  `MissingCommandKind` makes a kind missing from `COMMAND_KINDS` a compile
  error too. `SeatWorld.versus`'s blanket drop of `callStrike`/`reveal`
  stays: no runtime prices them in versus until N3.
- **The network hash:** `runFrames` (`frame-step.ts`) folds
  `matchDigest(sim.hash(), step.runtimeDigest?.() ?? 0, step.dataDigest ??
  shippedContentDigest())`. N2-P2 (`3dd5c86a`) built the runtime-digest seam,
  `FrameStep.runtimeDigest` (absent = 0, asked once per hash tick after that
  tick ran; the harness passes it through `AgentClientOptions.runtimeDigest`),
  so N2 wires `runtime.digest()` in one line (**done**, `a5c0deab`, at
  `main.ts`'s `frameStep`). **Ruled 15 Oct (coordinator,
  lead-delegated), L4**, built in N2-P3 (`e877c8e7`): this bullet first said
  "the room's `dataDigest: 0` becomes a real digest"; instead each client
  folds its own key-sorted content digest and the room's 0 stays on the
  wire, unfolded (§2.1). Roster order is covered by the build check.
- **Per-seat unit types:** `main.ts` builds every room with `bootKit = {}`
  (~L1484). **Ruled 15 Oct (coordinator, lead-delegated), L2; confirmed by
  N2-P5:** they need no sim code and leave N2 for app and render, with "bring
  your brigade" (§7.1 lists the three follow-ups).
- **`humanHeld[side]`:** triggers, waves and the commander skip a human-held
  side. N2-P4 (`c7626ffe`) built the table on the net side,
  `seatRules(config)` in `packages/net/src/seat-rules.ts`: a versus room
  (human or bot seats) gives `humanHeld` `[true, true]`, and single-player
  (`null`) or a sandbox room gives `[true, false]`, today's rule. N2's sim
  takes the table as given and never reads a config (**built**:
  `SimConfig.humanHeld` and `Sim.isHumanHeld`, `963d6613`; every world names
  its table, `3689dd9f`). The trigger, wave and commander skip is N3's (D1).
- **The pins. Ruled 15 Oct (coordinator, lead-delegated), L1:** this bullet
  first said the three sim pins in `determinism.test.ts`, F1's
  `ECONOMY_PIN`, `ECONOMY_PIN_RELIEF` and the versus-force mirror pins (`versus-force.test.ts`,
  580559085 / 1260439781; `match-world.test.ts`, 3043363756 / 1260439781)
  "each move once". Under option B they are **expected not to move**: the
  seat table's default is today's rule, the golden replay issues no new
  command and builds no runtime, F2 Task 1 is hash-neutral, and N2-P6 found
  no breach in the mirror pins' first 200 ticks (a future versus pin on
  `wadi_tarfan` or `milh_flats` that issues orders could be moved by breach
  parity). A pin that moves is a defect to explain. One pin is born: the
  runtime digest's. **As built:** none of the listed pins moved
  (read back by Tasks 1 to 6), and `RUNTIME_DIGEST_PIN` 2984314042 and
  `RUNTIME_DIGEST_PIN_RELIEF` 3060732596 were born in `a5c0deab`.

**N3 follow-ups recorded by N2 (16 Oct 2026).**
- The mission.ts seat sites (D1): the trigger, wave and commander skip on a
  human-held side, and the side-0 scoring sites (`unitLost`, `identifiedBy`,
  `routeFoundBy`, `contributed`, the Conduct actor, zone contest,
  `from_ledger`). The design is kept as Task 8 of the N2 plan, marked N3.
- `mcp-tools.ts`'s `ORDER_VERBS` excludes `setStance`, `build` and `support`
  (`7bd5d7c8`, `fe9a42d7`); a model verb for each is an N3/N4 follow-up.
- `patrol` is N3's, with the runtime's `stepPatrols`.
- The first versus runtime's rules file is data, never TypeScript.
- `cmdSink`'s room branch (`a5f7e6b4`) would mis-note a buy if a room with a
  runtime is paused: the dock pre-check should consult the room status
  (`ordersWait(room.status())`). Unreachable today: a room holds no runtime.

Item 5's decision memo, the non-sim prerequisite plan and what N2 needs from Lane C: `docs/superpowers/plans/2026-10-15-net-n2-prereqs.md` (15 Oct; L1–L5 ruled 15 Oct (coordinator, lead-delegated): option B, per-seat types in app/render (P5 confirmed: no sim code), `setStance` hold and ambush only, client-computed data digest, N2 after F3 carrying F2 Task 1).

## 11c. N4 as built: the harness, the advisor and the arena (15 Oct 2026)

N4 landed in two PR series from the plan
`docs/superpowers/plans/2026-10-14-net-n4-ai-harness.md`: **N4a** (Tasks
1–10, PR #619: the harness, the room's new sockets and the advisor) and
**N4b** (Tasks 11–14 and 16, stacked on it: the local relay, the baselines and
the arena). Task 15 is deferred (D6, below). No file under `packages/sim`
changed, and neither the determinism pins nor the versus mirror pins moved.
The run protocol, for a player, is `docs/net/N4-agent.md`. As in §11b,
everything below is what the code does, and where it differs from §8 or the
plan the difference is named.

### 11c.1 The harness

- **`pnpm agent`** (`tools/src/net/agent.ts`) is a headless client of one
  versus room serving MCP over stdio. Flags: `--server`, `--code`, `--scope
  advise|assist|command`, and either `--ticket-file <path>` or `--join` (a
  `command` bot asking the room for the free seat), plus `--build` and
  `--origin`. It is not §8.1's `--room --seat [--model]`: the seat comes from
  the ticket, and the model is whatever MCP client drives it.
- **The world is the browser's.** `buildMatchWorld`
  (`packages/app/src/net/match-world.ts`) is the one builder the battlefield
  and the harness share, and the harness's fog (`tools/src/net/view.ts`) calls
  the renderer's own sight and draw-gate predicates, so a model and a human on
  the same seat see the same units (§11's "must share one function").
  Building it in Node also required the world-builder pin of N4b Task 1: the
  browser path registers a map's tunnels with the sim, and the builder must do
  the same or the two worlds diverge (`beit_sahwan_outskirts` is pinned at hash
  3043363756, `tel_marum` at 1260439781, in `match-world.test.ts`).
- **The ticket is never on a command line or in a URL.** `--ticket-file`
  reads a private file (a leading `~/` is expanded by the agent itself, since an
  MCP client does not). `--ticket-file -` reads stdin and works only from a
  terminal: under an MCP client stdin is the protocol. The lobby prints `pnpm
  --silent agent -- … --ticket-file ~/.roaring-lions/advisor-ticket` and
  copies the ticket to the clipboard only (an N4a ruling, overriding the
  plan's `--ticket-file -`).
- **stdout is the MCP channel.** Every log line goes to stderr. A spawned
  test reads every raw stdout line of a real agent and requires each to be
  JSON-RPC (Task 11), beside N4a's static source scan. `pnpm --silent` is in
  every documented command because a package manager's own banner on stdout
  corrupts the session.
- **Exit codes:** 0 the match ended or reached a result, 1 a failure (a world
  the checkout cannot build included), 2 `bad_ticket` or `build_mismatch`, 3
  a desync. `build_mismatch` names only the harness's own build: the room
  sends none.
- **Tools** (`mcp-tools.ts`, `toolsFor(scope)`): `observe`, `status`,
  `wait`, `inbox` and `say` in every scope; `ping` in `advise` and `assist`;
  `order` in `assist` and `command`; `end_round` in `command`. `set_stance`,
  `build` and `fire_support` (§8.3) arrive with N2/N3's commands, and the
  test pinning `toolsFor` makes that a deliberate change. `order` takes an
  optional boolean `sweep` on `attackMove` only (refused on every other verb),
  in `command` scope only when both seats are bots, so an arena model can ask
  for the same sweep the in-process `rush` uses (§11c.8, ruled 15 Oct).
- **The order desk** (`order-desk.ts`, decision D4) is the bot's cadence: at
  most one flush every `DESK_FLUSH_TICKS` = 20 ticks, of at most 4 commands,
  from a queue of `DESK_MAX_QUEUE` = 12; a thirteenth `order` answers
  `queue_full`. Each order is normalised through `cleanCommand` before it is
  queued (one the room would refuse answers `invalid` and is never sent; an
  `advise` desk answers `not in this scope`), and is then reported
  `queued`, `sent`, `applied`, `dropped` (refused by `validateCommand` on both
  machines) or `lost` (no echo `DESK_LOST_AFTER_TICKS` = 40 ticks after it was
  sent). A bot seat therefore writes the same 2.2 rows/s the R-N12 budget
  accepted for a human, pinned with the room's own `rowsWritten`.
- **`bye` on close is a surrender.** Closing the agent or its MCP client
  mid-match sends `bye`, which decision 23 reads as leaving. After a result
  or the room's end it detaches without one (N4a final review F6: a `bye`
  after `over` made the room record the winner as the leaver).

### 11c.2 The advisor socket (decisions D1, D10, D11)

- **A third socket of its seat, not a seat.** `POST
  /api/match/:code/advisor` trades a seat ticket for an advisor ticket on the
  same seat (`role: 'advisor'`, `scope: 'advise'|'assist'`); an advisor ticket
  cannot mint another. One advisor per seat: a newer hello retires the older
  socket. It counts toward `MAX_ROOM_SOCKETS` (8) and spends the same
  per-socket budget.
- **The room relays only `advisor` messages**, between a seat's own sockets
  and that seat's advisor, never to the other seat, stores nothing and stamps
  nothing into a frame. At most one relayed advisor message per
  `ADVISOR_MIN_GAP_MS` = 250 ms per advisor socket. An advisor's `cmd`,
  `ready`, `pause`, `resume`, `surrender`, `hash`, `ack`, `bye` and `chat` are
  ignored with no state change, and its disconnecting never stalls the room or
  starts a forfeit.
- **An `assist` order never comes from the advisor's socket.** The human's
  browser shows the proposal (the note, the order in words, a two-second
  countdown that counts only frames that run) and sends it as its own `cmd`
  unless vetoed, after re-checking that it still makes sense: an order naming
  a unit that has since died is dropped, and the feed says so. `PROPOSAL_QUEUE` = 3
  counts the proposal being shown: three are held, two of them waiting, and a
  fourth vetoes the oldest waiting one, never the one on screen.
  **X** (D11), the **Veto** button, or **Escape** in the advisor's text box
  veto it; the **Accept** button takes it at once. **Enter does not accept**
  (the coordinator's ruling of 15 Oct, on #619): Enter opens the chat, so
  reaching for chat never takes an order by accident. This revises D11's
  "Enter or a click on Accept takes it at once".
- **Both seats are told** (D1): the lobby shows an "Advisor: advise/assist"
  badge on each seat card, and the versus HUD carries an **advisor chip** per
  seat that has one under the running scoreboard ("You" or the other seat's
  callsign, then the badge), text only, hidden when nobody advises (N4a final
  review F2, built rather than deferred). The room sends `advisors` to every
  seated socket when one joins or leaves, and again to a seat that rejoins;
  the transport clears stale badges on a relink, and replays the last
  `advisors` it heard to an `onAdvisors` hook that arrives later (the
  battlefield's, after the lobby's).
- **Fog is the harness's courtesy** (D10): the advisor's socket receives the
  full frame stream like any client, and `observe` is fogged. A modified
  harness could see through fog exactly as a modified browser can, under the
  friends-only posture (decision 22).
- **`Origin`** (D9): the harness sends the server's own origin; it is a
  browser's cross-site guard, not authentication. The seat ticket is the
  authentication.

### 11c.3 Paced mode (decision 8, D5; revises §3.2.7)

- **Minted only with a bot seat.** `POST /api/match` and `/join` accept
  `kind: 'bot'`; the room mints `pace: {kind: 'paced', roundTicks,
  roundWallMs}` only when at least one seat is a bot, otherwise `realtime`.
  `roundTicks` is clamped to 20–1,200 and `roundWallMs` to 1,000–600,000. A
  malformed `pace` is silently `realtime`, so the arena checks the start
  config before trusting a run.
- **The room waits at a round boundary** (`room-core.ts` `roundGate`), only
  for a bot seat that has not sent `done` for the round just closed, and never
  past `roundWallMs` from that round's last frame. **A human seat is never
  waited for.** While it waits, every seat hears `stall{reason: 'round'}`; a
  round wait is not silence, so it does not make a seat `gone`, and on release
  every seat's last-seen time is reset. `done`, the wait and the release are
  memory only and write zero rows; a woken room releases the round at once.
- **`done` is only ever deliberate.** The harness sends `done(round)` when
  the model calls `end_round` (or the in-process player after its policy has
  answered and its orders were flushed), never on receiving a frame, so a hung
  model really is waited for, up to `roundWallMs`. A `done` for the round
  still being minted is ignored.
- **The paced `WsTransport` release** (`packages/net`, a shipped change): in a
  paced room the transport releases frames up to the newest closed round
  boundary regardless of `bufferTicks`, so a bot runs a round's last frame
  before it decides; a closed round's frames are final. Realtime behaviour is
  byte-for-byte unchanged. Orders flushed before `done` are stamped into the
  first frame of the next round (pinned: sent at tick 39, applied at 40).

### 11c.4 The local relay (decision D2; revises §8.5's D1 path)

`tools/src/net/local-relay.ts` hosts the real Worker routes (`handleMatch`)
and the real `MatchRoom` in Node on `127.0.0.1`, `listen(0)`, over `ws`.
`startLocalRelay` mints the `TICKET_SECRET` in memory from `randomBytes(32)`,
never logged and never written; `serveLocalRelay(secret)` is the same relay
with the secret supplied, which the specs use to pin that the chosen secret
never reaches a log; the env has no D1 (a desync's D1 write fails with a logged
error, and the desync still reaches both clients) and no rate limiters. The
upgrade passes `handleMatch`'s Origin, code and method checks first. Alarms
are a 250 ms poll; a room's socket messages, socket closes and alarm run on
one chain per room, in arrival order, each to completion -- stricter than
workerd's input gate, which serializes only across storage awaits; `fetch`,
`acceptSocket` and the room's own clock are not on the chain (§11c.8); `close()` terminates every socket, clears every interval
and frees the port. `MatchRoom` gained one optional constructor argument,
`{tickMs?, seed?(code)}`, which workerd never passes: production keeps
`TICK_MS` and its crypto seed, pinned by a characterization test. Only
`tools/` imports `packages/worker`; a test fails on any file under
`packages/{app,render,net,sim}/src` that does.

### 11c.5 The baselines (decision D8; answers decision 18 for now)

- **`passive`** orders nothing. **`rush`** orders only its own units that are
  `idle` (the app's own idle finder) **and within 10 tiles of its camp**, an
  attack-move with `sweep` on the centroid of the contacts it can see, else on
  the enemy camp. It **never breaks off an engagement**: a unit that is
  shooting (`engaging`, the HUD card's own flag) or still moving is never
  re-ordered, because the sim's move handler clears `engaging` and `stance` on
  every new order, and a rush that re-ordered its whole force every round lost
  to `passive`. Both read only the fogged `SideView`; `engaging` and `idle`
  are computed for the viewer's own units only.
- **Its measured strength:** on `tel_marum` at pace 60 and a 12,000-tick
  cap, **0.750** against `passive` on held-out seeds 2–21 (30-0-10, both seat
  orders), and **0.750** on the arena's own ten seeds (15-5). The west seat
  wins 17 of 20; the east, attacking through the pass into a force waiting
  below it, wins 13 of 20. Sixteen fog-honest variants were measured (Task
  12's table) and none reached 0.9; the shipped one ties for best and is the
  stateless reading faithful to D8. A stronger control would be a stateful
  attacker that gathers its force before moving, which is a lead decision.
- **The in-process player** (`players.ts` `inProcess`) runs a `Policy` on an
  `AgentClient` in the arena's own process: it pumps to the round boundary,
  asks the policy, submits through the desk, flushes, then sends `done`. A
  policy that has not answered in `roundWallMs` is abandoned and counted as a
  timeout. At its cap tick it stops by itself (so the reading seat's sim can be read on
  exactly that tick) and detaches without a `bye`.

### 11c.6 The arena and its scoring (decision D7; D6 "not now")

- **`pnpm arena -- --a <player> --b <player> [--seeds 10] [--map
  tel_marum] [--matchup mirror|kdf|sarim] [--pace 60] [--round-wall-ms
  120000] [--cap-ticks 12000] [--tick-ms 2] [--out arena-results/]
  [--gate]`.** A
  player is `passive`, `rush` or `cmd:<template>`. Seed *n* is `1000 + 7919
  n` (the versus probe's sequence), each played twice with the seats swapped,
  every game on its own local relay with two bot seats in a paced room. Only a
  map and matchup a room offers are played (`versusMapAllowed`,
  `matchupAllowed`; exit 2 otherwise), and a game is trusted only once the
  room's start config names the requested pace, seed, map and factions.
- **The cap is the arena's, not the room's**: at `--cap-ticks` (default
  12,000, not `MATCH_CAP_TICKS`' 30,000) the game is settled by `capOutcome`,
  the room's own decision-24 rule (`outcomeOf(sim, MATCH_CAP_TICKS)`: the
  larger surviving force value wins), on the reading seat's sim (seat 0's when
  it runs in the arena's process, else seat 1's, else the observer's),
  recorded `by: 'cap'`.
- **Score** = (wins + ½ draws) / non-void games, overall, per seat and per
  faction; a cut with no non-void game reads `—`, never 0. The per-game table
  carries the scoreboard (decision 25: lost and destroyed with their value,
  force left) in place of Conduct. Tokens are reported when an external
  client's last stdout line carries them, never scored.
- **Void, and why.** `void/desync`: the room sent `desync` (read before the
  arena stops the players, since a stop overwrites the transport's status).
  `void/disagree`: the two sims the game was judged by report different
  results, or one decided and the other did not with no room ending. `void`
  named for the room's closed reason (e.g. `expired`), `void/unfinished` as the
  arena's own fallback when the room did not close (not a room reason), and
  `void/timeout` past the game's wall-time backstop. The full `by` vocabulary
  of a record: `annihilation`, `stalemate`, `time`, `cap`, `forfeit`,
  `surrender`, `left` or `mutual` for a result, and `desync`, `disagree`,
  `timeout`, `unfinished` or a room's closed reason for a void. A void is a result: the
  arena exits 0 unless a game could not be played at all (exit 1).
- **A over B, and `--gate`** (ruled 15 Oct, coordinator, lead-delegated;
  §11c.7). stdout and the report's "Head to head" table read `--a` against
  `--b`: `n` (non-void games between the two), A's score and the one-sided
  exact binomial `p` that A is better. `--gate` passes iff p < 0.05, prints
  `gate: PASS|FAIL  <A> over <B>  n=<n>  score=<s>  p=<p>` and exits **3** on
  FAIL; a run that ends 1 is not judged and stays 1. Without `--gate` the exit
  codes are 0, 1 and 2 as above.
- **External players** (`external-player.ts`): per game and external seat, a
  0700 temp directory with three 0600 files (the seat's `ticket`, `mcp.json`
  naming this checkout's harness in `command` scope by absolute `tsx` and
  `agent.ts`, and `prompt.md`, the standing prompt with the seat filled in),
  removed when the child exits, and on SIGINT/SIGTERM too: the arena's
  handler SIGTERMs (then SIGKILLs) every external child, removes every such
  directory, stops the players, closes the relay and exits 130/143
  (§11c.8). `LIONS_ARENA_TMPDIR` (test-only, absolute paths only; anything
  else is ignored with a warning) overrides where the directories are made
  (`os.tmpdir()` by default). The template is split by the arena with no
  shell (`$VAR`, `$(...)`, `;`, `|`, `>` and globs stay literal) and fills
  `{mcp}`, `{prompt}`, `{seat}`, `{code}`; a standalone `< {prompt}` is the
  child's stdin. The child inherits the parent environment unchanged; the
  arena never reads a key. Its output goes to a per-seat log under `--out`.
- **The observer.** When neither seat runs in the arena's process
  (`cmd:` against `cmd:`), the arena reads the game through seat 0's own
  advisor (`advise` scope, minted from seat 0's ticket), which keeps its own
  sim in step and sends nothing the room acts on. Any game with an external
  seat has **one judging sim** (the in-process seat's, or the observer's), so
  it cannot read `void/disagree`; a desync between the two
  players is still caught by the room's hash check. It takes seat 0's one
  advisor slot.
- **A cap-decided game** stops the in-process side at once but gives an
  external client a 10 s grace to finish and print its usage line before
  SIGTERM, then SIGKILL, each through the child's own handle. The model plays,
  and spends tokens, during the grace.
- **Output:** `<out>/<date>-<a>-vs-<b>.jsonl` (one record per game, appended
  as it ends) and `.md`; an existing pair is never overwritten.
  `arena-results/` is git-ignored.
- **D6 was ruled "not now" (14 Oct).** There is no D1 `matches` table and no
  `/stats/arena`: the arena runs locally and reports to files. Task 15 (the
  table, its migration and the stats page, one D1 row per versus match) is
  deferred until a later "yes". §8.5's remote arena is not built.

### 11c.7 The N4 gate

**Ruled 15 Oct (coordinator, lead-delegated): the gate is statistical, not a
fitted bar.** It asks whether the arena can tell a better player from a worse
one. On `tel_marum`, over **40 games** (20 seeds × 2 seat orders), `rush` must
beat `passive` with a **one-sided exact binomial p < 0.05**:

- p = P(X ≥ k) for X ~ Bin(n, ½), the chance that a player no better than its
  opponent scores k or more; n = the non-void games between the two;
  k = wins + ½ draws (D7). A half-point k takes the **mean of P(X ≥ ⌊k⌋) and
  P(X ≥ ⌈k⌉)**, which lies between the draw-as-loss and draw-as-win readings
  (`binomialP`, exact in BigInt). The pass is strict, p < 0.05.
- The command is `pnpm arena -- --a rush --b passive --seeds 20 --map
  tel_marum --pace 60 --tick-ms 2 --gate`; it prints `gate: PASS|FAIL  <A>
  over <B>  n=<n>  score=<s>  p=<p>` and exits 3 on FAIL (§11c.6).
- Its falsification is the players swapped (`--a passive --b rush`), which
  must FAIL. `rush` and the map were not tuned for it.

**Read on 15 Oct (pace 60, cap 12,000, tick 2 ms, mirror; every game played,
none void):**

| Run | n | W-D-L (A) | Score (A) | p | Verdict | Wall |
|---|---|---|---|---|---|---|
| `--a rush --b passive` | 40 | 27-0-13 | 0.675 | 0.01924 | **PASS**, exit 0 | 749 s |
| `--a passive --b rush` (falsification) | 40 | 13-0-27 | 0.325 | 0.9917 | **FAIL**, exit 3 | 742 s |

Rush scores 0.850 from seat 0 (west) and 0.500 from seat 1 (east, through
the pass); 21 games went to the cap and 19 ended in annihilation. The
swapped run replayed the same 40 games (identical records as a set, only the
order differs). The first
ten seeds reproduce the earlier 10-seed run game for game (15-5); seeds
10-19 read 12-8. Both p values agree with an independent computation
(Python, `math.comb` over `fractions.Fraction`): P(X ≥ 27 | 40) =
0.019239 and P(X ≥ 13 | 40) = 0.991705.

**History: the bar this ruling replaced.** The plan's Step 2 gate was `pnpm
arena -- --a rush --b passive --seeds 10 --map tel_marum --pace 60 --tick-ms
2`, with `rush ≥ 0.9` read as "the controls work". **Read on 15 Oct: rush
0.750 (15-0-5, no void), so the gate was red as written.** The bar, the map and rush were left as they are (ruling
N4); the reading equals Task 12's measurement game for game. Rush wins 0.900
from the west seat and 0.600 from the east. For the lead's decision, the same
run on the other versus maps (mirror, ten seeds, pace 60, cap 12,000; every
game played, none void):

| Map | Rush vs passive | W-D-L | Rush on seat 0 | Rush on seat 1 |
|---|---|---|---|---|
| `tel_marum` (the gate) | 0.750 | 15-0-5 | 0.900 | 0.600 |
| `beit_sahwan_outskirts` | 0.400 | 8-0-12 | 0.200 | 0.600 |
| `wadi_tarfan` | 0.600 | 12-0-8 | 0.600 | 0.600 |
| `milh_flats` | 0.650 | 13-0-7 | 0.700 | 0.600 |

No versus map reaches 0.9. The arena ran every game and the room voided
none, so the gap is the control's strength (a stateless rush into a force
that holds its ground), not a broken control path. That choice (a lower bar,
another gate map or a stronger, stateful control) was answered by the ruling
above: a statistical gate on the same map with the same rush.

Spec §9's N4 gate itself, an `assist` advisor completing a match with Ilan and
a ten-seed arena run between two models, is the lead's to run (run protocol
§1 and §3); no subagent runs a model or reads a key.

### 11c.8 What later work inherits

- **N2** adds `set_stance`, `build` and `fire_support` to the harness's tools
  with its `Command` kinds; `toolsFor`'s pin goes red until they are listed.
- **WP-G-G0's doctrine commander**, when it lands, replaces `rush` as the
  arena's opponent and answers decision 18 as written.
- **A remote arena** against the Worker and `/stats/arena` wait on D6.
- **Parked minors**, none load-bearing. Three were closed in the N4b minors
  pass (15 Oct, `fix/net-n4b-minors`); two stay parked.
  - **Closed:** the MCP `order` had no `sweep`. It is legal for the agent
    seat: `attackMove` is in `COMMAND_KINDS`, `cleanCommand` already carries
    its `sweep`, and `validateCommand` checks an `attackMove` only for owned
    ids and the map edge; the versus drop (#559 F1) is fire support,
    `callStrike` and `reveal`, and `sweep` is a movement flag, not fire
    support. **Ruled 15 Oct (coordinator, lead-delegated window):** the
    human UI never sends `sweep` (the lead's 11 Oct ruling that a clicked
    tile means that tile), so an agent able to send it would hold a
    capability a human seat lacks. In `command` scope it is accepted only
    when BOTH seats of the room's `MatchConfig` are `kind: 'bot'` (the arena:
    parity with the in-process `rush`), and refused with
    `not available against a human seat` when either is human; in `assist`
    it is always refused (`not in this scope`), since a human would be
    accepting a sweep the strip does not describe. Any value, `false`
    included, counts as asking. Where it is allowed, `order` takes an
    optional boolean `sweep` on `attackMove` only and builds it into the
    command; on any other verb it answers `invalid` (`sweep is for
    attackMove only`), and a non-boolean answers `invalid` (`sweep is true or
    false`). `mcp-tools.ts` and `arena-prompt.md` carry the ruling. Pinned by
    `mcp-tools.test.ts`: bot against bot, `sweep: true` is on the cmd seat 0
    sent, on the frame both seats heard, and on the command both sims
    queued, and `sweep` on `move`/`halt` is refused; with a human in either
    seat (or both) it is refused and nothing carrying it is sent; in assist
    it is refused even bot against bot, with no proposal sent. Red with the
    field dropped from the built command, with the verb guard removed, with
    the human-seat check removed, with the assist refusal removed, and with
    the gate refusing bot against bot too.
  - **Closed:** SIGINT/SIGTERM on the arena cleaned nothing (the signal skips
    every `finally`, leaving the 0700 temp directory and its 0600 ticket).
    `installSignalCleanup`, installed by the CLI entry only, now SIGTERMs
    every external child (SIGKILL after 2 s), removes every seat's temp
    directory (`abortExternalPlayers`, over a registry of live seats), stops
    every running player, closes every relay, each step bounded at 5 s, and
    exits 130 (SIGINT) or 143 (SIGTERM). The first abort also sets a one-way
    stop latch: a seat is refused before its `mkdtemp`, and `runArena` starts
    no further game, so nothing spawned while the cleanup awaits can outlive
    `process.exit` (a seat's latch check, `mkdtemp`, registration and `spawn`
    have no await between them, which is why one sweep suffices and the
    second sweep was dropped). A SECOND signal during the cleanup exits at
    once with the same code, cleanup unfinished: the escape hatch a second
    Ctrl-C means. The run's own exit code never overtakes the signal's, and
    the seat's own `finally` removes with `force`, so whichever runs second
    finds nothing. `LIONS_ARENA_TMPDIR` is test-only and must be absolute.
    Pinned by `arena-signal.test.ts` (the arena as a real child process in
    its own process group, with a sleeping `cmd:` player; red with the
    handler not installed, with `abortExternalPlayers` emptied, with the
    SIGKILL escalation removed, and with the second signal ignored rather
    than exiting), `arena-latch.test.ts` (red with either latch check
    removed) and `external-player.test.ts` (red with the absolute-path check
    removed).
  - **Closed:** the local relay did not serialize a room's events across
    sockets. Its socket messages, socket closes and alarm now run on ONE
    promise chain per room, in arrival order, each to completion; it was a
    chain per socket, so two sockets and the alarm could interleave across
    any await. This is stricter than workerd, whose input gate serializes
    only across storage awaits, so the relay can hide an interleaving a real
    Durable Object allows but never produce one it forbids. `fetch`,
    `acceptSocket` and the room's own clock are not on the chain. An alarm's
    due time is re-read when its turn comes, not when it is queued; a handler
    that throws is logged and the chain goes on. Pinned by
    `local-relay.test.ts`: two sockets of one room with a 40 ms handler read
    strict in/out alternation in arrival order (red with a gate per socket);
    an alarm falling due mid-handler fires after it (red with the alarm off
    the chain); an alarm the handler cleared does not fire (red without the
    re-read); a throwing handler does not jam the next message (red without
    the chain's `.catch`).
  - Parked: a cap game costs an external client up to 10 s of grace.
  - Parked: a model's `end_round` still accepts a stale mid-round `done`
    after a wall release (harmless).

## 12. Testing and gates

Every check here arrives with its falsification, per CLAUDE.md.

- **Two-client determinism (CI, from N0):** two `Sim`s in one Node process
  fed one frame stream, hashes asserted equal every tick for 1,000 ticks on
  the determinism replay and on a real skirmish map. Falsified by feeding the
  second sim one frame out of order (must go red at that tick) and by
  dropping one command from one stream.
- **Two-engine determinism (CI, from N0):** the same frame stream through
  Chromium, Firefox and WebKit via Playwright in the `visual` job, final hash
  compared. Falsified by injecting a `Math.sin` into a sim path in a scratch
  run and watching the engines disagree.
- **Ownership:** a frame carrying seat 0's order for a side-1 unit is dropped
  on both clients and the hash stays equal. Falsified by disabling `validate`
  (the order must then execute).
- **Room unit tests (vitest, pure):** ordering `(tick, seat, seq)`, the clock
  stop conditions, pause budget, paced rounds, ticket verify (constant-time,
  fails closed, refuses the stats secret), code alphabet. Room logic is kept
  pure so it tests under node without `vitest-pool-workers`; one smoke test
  under `wrangler dev` exercises the real Durable Object.
- **Desync end to end (N1 gate):** a client with a deliberate one-off
  perturbation (`?netdev=perturb`, dev build only) produces a `desync` at the
  expected tick, two logs in D1 and a prefilled report. Falsified by removing
  the perturbation.
- **Replay equivalence:** a match's frame log replayed headlessly reproduces
  the final hash recorded by the room. Falsified by editing one frame.
- **viewerSide:** the golden gate's existing scenarios do not move (viewer
  is 0 there); a new report-only capture at `viewerSide: 1` on the mirror map
  is photographed for the lead, not voted.
- **`ui:routes`** gains the versus lobby as a fourth screen on CI, never
  locally.
- **Harness:** `observe` on a seat never names an entity the side has no
  contact with; falsified by removing the contact filter and asserting on a
  known hidden unit.
