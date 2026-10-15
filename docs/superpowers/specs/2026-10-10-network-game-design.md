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
  sim seat work in December after M2; N3 the Sarim seat with WP-G-G in
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
  dataDigest: string;         // FNV over the unit, map and doctrine JSON the build ships
  rules: { win: 'annihilation'; capMinutes: 25; tiebreak: 'held_ground_seconds' };
}

interface Seat {
  seat: 0 | 1;
  side: 0 | 1;                // sim side; civilians stay side 2
  faction: 'kdf' | 'sarim';
  kit: 'matched' | 'brigade'; // Decision 5
  tiers: Record<string, number>;   // empty for matched kit and for sarim
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
is refused, and `build` + `commit` + `dataDigest` must match on both clients
or the lobby refuses to start and says which differs.

### 2.2 Seat versus side

Sides in the sim stay what they are: 0 and 1 are combatants, 2 is civilians,
and the contact arrays are sized `2 × capacity` (sim.ts:1256-1263). A
**faction is a property of the seat's roster, not of the side index**: a
KDF v KDF match registers the KDF catalogue and spawns it on side 1 for the
second seat. The rules that hard-code "side 0 is the player" today (no
auto-breach at sim.ts:3415; ROE, production anchor, sweeps, strikes,
`unitLost` in mission.ts) become seat or faction rules in N2 (§7.1). Until
N2 those rules are mildly unfair to the side-1 seat in a mirror match and
the N1 lobby says so.

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
- `config.ts` — `MatchConfig`, its validator, and `dataDigest`.
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
  they are commands (`build`, `sweep`, `strike`) applied in `applyFrame`
  (N1 wraps them in the net layer; N2 makes them sim commands, §7.1). The
  tutorial's `completeObjective` does not exist in a match.
- **The replay recorder** (`feedback/replay.ts`) records frames instead of
  intents, which closes its three documented gaps (the direct calls, float
  coordinates, runtime-issued commands are no longer needed because frames
  are the only input) and makes a bug report's replay the same artefact as a
  match log.

### 3.4 Desync (Decision 10)

Every `hashEveryTicks` (20) each client sends `hash{tick, h}` where `h` is
`digest(sim.hash(), runtime.digest(), dataDigest)`. The room compares when
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
group; the data digest covers the type table; the others are derived or
inert and are left out on purpose, stated in `digest.ts`.

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
runtime state (N2 for the state; N1 shows the match clock, pop and purse of
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
- `build{camp, unit}` from the doctrine's menu at the Sarim camp, through
  Stage 4 F4's production line, spending the per-match budget (G3 Q7, 1.6×,
  doctrine data). Until F4 exists, N1's mirror match has no production on
  either side.
- Tunnels stay map-authored: diggers dig on their own, stocked fighters vent
  as today, and the player may order fighters into a mouth and out at a vent.
- On a human-held side no scripted trigger fires, no wave spawns and the
  doctrine commander does not run. Civilians stay on side 2 and the ROE
  scoring still charges the KDF seat (Conduct is a KDF doctrine, not a
  symmetric score; the Sarim seat sees no Conduct panel).

### 6.2 What it costs

Two new `Command` members and one sim rule ("this side is human-held: skip
triggers, waves and the commander"), all in N2/N3. Nothing else in the tick.

### 6.3 The follow-on: the full insurgent toolkit

Player-dug tunnels, IED placement, crowd-cover orders, a Sarim upgrade
ladder, a Sarim fire-support menu. Each is a sim mechanic with balance behind
it, and nothing here exists. It is its own package after N3, and §2.1's
`Seat` and §3.2.3's protocol leave room for it (a `setStance` with more
stances, a `build` menu that grows, a `dig` command).

---

## 7. What changes, what must not, and the audit

### 7.1 Sim (N2, all additive; the golden hash moves once)

| Change | Where | Why |
|---|---|---|
| `MissionRuntime.digest()` | mission.ts | the network hash must see objectives, triggers, waves, purse, Conduct, build queue, civilian latches |
| Integer purse | mission.ts:1063, 1078 | `logisticsValue`/`intelValue` accrue in doubles; F2 Task 1 already makes them integer, and that is the one deliberate hash move, stated in its commit |
| Side-0 rules → seat rules | sim.ts:3415 (auto-breach), mission.ts:655-692, 1022-1054, 1287, 1338, 1377 | a side is no longer "the player"; the rule asks the seat table |
| Per-seat unit types | `addUnitType` callers, mission-start.ts | "bring your brigade" needs two KDF seats with different tiers; a seat's roster registers as its own variants |
| `build`, `sweep`, `strike` as `Command`s | sim.ts command union, mission.ts:653-694 | the three direct runtime calls become tick-stamped input |
| `setStance` | sim.ts, mission.ts | the Sarim seat's verb (§6) |
| `humanHeld[side]` | mission.ts | triggers, waves and the commander skip a human-held side |
| `Sim.seatOf(entity)` read; issuer-aware `queueCommand(cmd, seat)` later | sim.ts | the ownership check moves from the net layer into the sim when Stage 4's lane C slot opens |

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
   Closed by §2.1: the config is the only input, and build/data digests must
   match.
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

Known-good and relied upon: static roster order gives type indices, so the
data digest must cover the roster file order; `SIM_SEED` is a constant and
the match seed replaces it through the config; boot ordering is synchronous.

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
| **N2 · sim seat work** | 1–19 Dec, after M2 | sim (lane C slot) | runtime digest, integer purse (with F2), seat rules, per-seat types, direct calls as commands, `setStance`, `humanHeld`; golden hash moves once | determinism green with the new pins; mirror match re-played on N2 bytes with equal hashes |
| **N3 · the Sarim seat** | Jan–Feb 2027, with WP-G-G | sim, data, app | KDF v Sarim on the skirmish rules (zones, pop caps, doctrine production), the lobby's side pick live, `build` from the doctrine menu | G5 #169 closed 5 Feb with this spec's answers; Ilan plays five KDF v Sarim matches |
| **N4 · AI harness and arena** | Jan–Mar 2027, in parallel from N1's protocol | net, tools, worker | `pnpm agent` (MCP, three scopes), advisor panel, `pnpm arena`, `/stats/arena` | an `assist` advisor completes a match with Ilan; a ten-seed arena run between two models reported |
| Follow-ons | after N3/N4 | | insurgent toolkit (§6.3), sim snapshot (§3.2.6), spectators as a feature, accounts via ST5, skirmish payouts | own specs |

**Beside Stage 4.** N0 and N1 touch no sim file, so lane C (WP-G-F, from
2 Nov) is undisturbed. `ThreeRenderer.ts` is the one shared file: `viewerSide`
is a single PR in N1 scheduled against the polish lane's own touches of it.
N2's sim work takes the lane C slot after M2 (27 Nov) and lands the integer
purse together with F2 Task 1 rather than beside it. N3 rides on WP-G-G,
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
| 18 | Unattended bot seat | the doctrine commander. **Not built yet** (WP-G-G0 has not landed); N4 ships scripted baseline bots instead (§11b, N4 plan) |
| 19 | Arena scoring | win rate over the seed set with sides swapped; Conduct and tokens reported only. A versus room runs no `MissionRuntime`, so there is no Conduct to report until N2/N3; the arena reports the scoreboard (decision 25) in its place (§11b) |
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
  `build_mismatch`, close code 4002.
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
   ownership check before N2 adds its four.
5. **A decision on whether a versus room runs a `MissionRuntime` at all.**
   Today it runs none: no economy, no ROE, no Conduct. Without one, N2's
   seat rules have nothing to act on until N3. N2 either builds a minimal
   versus runtime or only re-keys the side-0 rules for N3 to use.

**Sim surfaces N2 touches.** Locate them by symbol; line numbers are as of
`f4b3ea2b`.

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
- **The direct runtime calls** `requestSweep`, `requestStrike` and
  `requestBuild` (~L664–690) become tick-stamped `Command`s (§7.1).
- **`sim.ts` `selectBreachTarget`**: "side 0 never auto-breaches" (~L3694;
  the spec's L3415 has drifted) becomes a per-seat rule.
- **The `Command` union** (`sim.ts` ~L606) gains `build`, `sweep`, `strike`
  and `setStance`. In `@lions/net`, `COMMAND_KINDS` and `cleanCommand` (whose
  `never` default makes `tsc` fail until the kind is handled) and
  `validateCommand` (an exhaustive switch) must each handle them in the same
  PR. `SeatWorld.versus`'s blanket drop of `callStrike`/`reveal` is
  re-decided once a runtime prices them in versus.
- **The network hash:** `frame-step.ts` passes `runtimeDigest = 0` to
  `matchDigest` (~L51). N2 supplies `runtime.digest()` there, and the room's
  `dataDigest: 0` becomes a real digest.
- **Per-seat unit types:** `main.ts` builds every room with `bootKit = {}`
  (~L1476). "Bring your brigade" needs per-seat registration (§7.1).
- **`humanHeld[side]`:** triggers, waves and the commander skip a human-held
  side.
- **The pins:** the three sim pins in `determinism.test.ts`, F1's economy pin,
  and the versus-force mirror pins (`versus-force.test.ts`) each move once, and
  the commit says why.

Item 5's decision memo, the non-sim prerequisite plan and what N2 needs from Lane C: `docs/superpowers/plans/2026-10-15-net-n2-prereqs.md` (15 Oct; L1–L5 ruled 15 Oct (coordinator, lead-delegated): option B, per-seat types in app/render if P5 confirms, `setStance` hold and ambush only, client-computed data digest, N2 after F3 carrying F2 Task 1).

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
