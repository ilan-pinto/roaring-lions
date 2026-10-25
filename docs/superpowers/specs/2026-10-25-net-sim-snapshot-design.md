# Sim snapshot for faster reconnect (network follow-on)

**Status: approved.** The lead ruled D1–D7 as recommended on 25 Oct (§11). Stage 1's plan is
`docs/superpowers/plans/2026-10-25-net-sim-snapshot-s1.md`.

**Read against:** `origin/main` `f946bb16` (25 Oct). Line numbers are hints only, so find code by
its symbol.

**Inputs:**
- `2026-10-10-network-game-design.md`:
  - §3.2.6 (Reconnect), which names "a periodic snapshot that shortens this to under a second" as a
    follow-on;
  - §9's follow-ons row ("sim snapshot (§3.2.6) … own specs");
  - §11's risk "Replay-from-zero reconnect";
  - §11b.2 (decision 23, the 60 s forfeit, and the chunked `log` as built).
- The code as built: `packages/worker/src/match/{match-room,room-core}.ts`, `packages/net/src/{protocol,ws-transport,lockstep}.ts`,
  `packages/app/src/net/{frame-step,catch-up,match-world}.ts`, and `packages/sim/src/{sim,mission,rng,flowfield}.ts`.
- A measurement probe written for this spec. It is untracked, because it reaches private sim fields by reflection; S5's witness replaces it (§2.1, §6.4).

No issue or PR existed for this before this spec. It should get its own issue when the lead
approves it, written as GH-NNN in the plan.

---

## 0. The design in one page

- **What it buys.** When a seat reloads mid-match it has no world left. Today it rebuilds the world
  from tick 0 and replays the whole frame log, and **the other seat is frozen for that whole time**.
  The room behind-stalls on the rejoiner because a reload keeps its old ack (`catch-up.ts` I-1). A
  snapshot lets the rejoiner load the world at tick T and replay only the frames after T. The cap
  on that replay is one snapshot interval, not the length of the match.
- **The snapshot is small.** A real 20-minute versus match measured **77–107 KiB raw and 2.3–4.5
  KiB gzipped** for the sim. The economy runtime adds about **3.5 KiB** gzipped. The worst case
  measured was a world filled to its 256-entity capacity and fighting: **231 KiB raw, at most 15.2
  KiB gzipped** (§2). For comparison, the 20-minute frame log is about 565 KiB of JSON.
- **Rebuild from config, then overwrite the state.** The restoring client builds the world from
  `MatchConfig` exactly as it does at boot (`buildMatchWorld`). That rebuild gives every unit type,
  map mask, route and closure. The client then overwrites the mutable state from the snapshot.
  - The flow-field pool is **rebuilt from its keys, never serialised**: 0.7–2.8 MiB of it costs
    9–90 ms to recompute.
  - Every own property of `Sim` and `MissionRuntime` falls in exactly one of four classes: `state`,
    `config`, `derived` or `scratch`. A test fails on any property that has no class.
- **The proof is restore-then-step against the uninterrupted run.** Restore at T and step to
  T + N, then compare with the run that never stopped. Two things must hold:
  - the match digest is equal on every hash tick;
  - **the canonical encodings are byte-equal at T + N**.

  The hash alone is not enough. The probe dropped unhashed columns from a reflection prototype of
  this design, and in every case the hashes **stayed equal for the whole 1,200-tick fork while the
  world had already diverged** (§6.2).
- **Producer: both clients.** Every `snapshotEveryTicks` (1,200 = 60 s), both seats encode the
  snapshot at a hash tick and upload it. The room never runs the sim. It accepts a snapshot only
  when three things hold:
  - the SHA-256 of both seats' decompressed bytes is the same;
  - that tick's match digest was already agreed;
  - the digest carried in the snapshot's header equals the agreed one.

  The room keeps the latest accepted snapshot in one row.
- **Trust.** The frame log stays the authority. A snapshot is only a shortcut: every failure falls
  back to today's full replay. The rejoiner checks the content SHA and then recomputes the match
  digest after the restore. A seat cannot get a forged snapshot accepted on its own, because the
  other seat would have to upload the same bytes.
- **No versioning problem, because there is no cross-version snapshot.** A snapshot belongs to one
  room (`matchId`), one build string (already enforced: `build_mismatch`, 4002) and one format
  version. It dies with the room. No snapshot is ever migrated, and save-games stay out of scope.
- **No pin moves.** `sim.hash()`, `runtime.digest()` and `economyHash()` are untouched. A new
  *format* pin is born with S1 (§9).

---

## 1. The facts this rests on

### 1.1 Reconnect as built

There are two reconnect cases, and a snapshot changes only the second.

1. **A socket drop without a reload.** The client keeps its sim. It reconnects with the same ticket
   (`hello`), and the room answers with the **whole** log in `log` parts of at most `LOG_PART_CHARS`
   (256 KiB, `room-core.ts` `logParts`). `LockstepClock` discards the head it already ran. No
   replay happens, but at 20 minutes about 565 KiB is sent for nothing.
2. **A reload, or a new tab.** The client has no world. It rebuilds from `config` and pushes every
   frame into the clock. The battlefield then runs them down at the raised cap:
   - `roomTickCap` and `catchUpTicks` allow as many ticks as fit in a 12 ms budget per animation
     frame, at the measured cost of a tick;
   - `CatchUpQuiet` mutes the presentation while a tick is more than 20 frames behind.

   The room keeps the old `lastAck`, so it behind-stalls on the rejoiner and **the other seat waits
   for the whole replay**. That stall cost belongs to the snapshot design, and the spec's "12–50 s"
   (written before N1) was never re-measured in a browser.

The forfeit clock (decision 23, `FORFEIT_MS` = 60 s of wall time) is cancelled by the `hello`, so
a long replay does not forfeit the match. It freezes the opponent instead. §3.2.6's "120 s, then
claim or wait" is superseded (§11b.2).

### 1.2 What `MatchRoom` stores

| Where | What | Written |
|---|---|---|
| DO KV `meta` | code, map, factions, build, seat tokens | on create and join |
| DO KV `state` | `RoomState`: status, config, seats, tick, pause, counters | on a lifecycle change only (`persistKey`, R37) |
| DO SQLite `batch(first_tick, frames TEXT)` | the frame log, as JSON batches | one row a second, or at once on a frame that carries a command (R36): about 1.2 rows/s idle, 2.2 busy |
| memory | pending commands, acks, the open batch, `hashes` (only the open pairs; pruned at `lastHashTick`) | never persisted |
| D1 (on desync) | both logs and hash series | at the end of the match |

Two things follow for this design.
- The room **forgets agreed hash values** once a pair matches. To vouch for a snapshot's digest it
  must keep the agreed value of each snapshot tick: one integer.
- Free-plan limits:
  - a row, string or BLOB may be at most 2 MB;
  - an account may write 100,000 rows a day;
  - an account may store 5 GB;
  - a received WebSocket message may be at most 32 MiB.

  All four come from the Cloudflare DO limits and pricing pages, read 25 Oct. The room's own cap
  on a client message is 4,096 bytes (`MAX_MESSAGE_BYTES`), so a snapshot does not travel inside
  the WebSocket protocol (§5).

### 1.3 The command log

`Frame { tick, cmds: Stamped[] }` comes in the canonical order `(tick, seat, seq)`, one frame per
tick for every tick, empty frames included. A 20-minute log has 24,000 frames, and the 25-minute
cap (`MATCH_CAP_TICKS`) gives 30,000. Hashes are keyed by the frame's tick:
- ticks 19, 39, … at `hashEveryTicks` 20 are hash ticks;
- the digest is `matchDigest(sim.hash(), runtimeDigest, shippedContentDigest())`, folded in
  `runFrames`.

### 1.4 The sim's state

- **Struct of arrays.** `Sim` has **239 own properties** at `f946bb16`, counted by reflection on a
  live world:
  - about 200 are typed arrays sized by `capacity` (256 in every room, `buildMatchWorld`);
  - some are sized by the map (48×48 = 2,304 cells);
  - the rest are small fixed tables: tunnels 16, projectiles 1,024, sites 8, evac points 8.

  `spawn` never reuses a dead slot, so `count` is the lifetime spawn count, and dead entities keep
  their slots.
- **RNG.** `Rng.state` is one `Uint32Array(capacity)` of mulberry32 words, seeded per
  `(seed, id)`. The whole stream state is those 1,024 bytes.
- **The hash.** `sim.hash()` covers most mutable columns. Eight blocks are **deferred folds**: they
  are folded only once a latch is set (`fwLive`, `placedLive`, `mobLive`, `airLive`, `beamLive`,
  `woundLive`, `tnOrderLive`, `patrolLive`; `unitAuraLive` is a latch too). It deliberately leaves
  out:
  - `removed`, outside the wound block;
  - `trail`;
  - the flow-field pool and `fieldRef`;
  - `aimTurned`, `aimDesired`, `aimFrom` and `braceWant`;
  - the structure geometry;
  - `stProducesFor`;
  - the tunnel geometry;
  - `pendingStrikes.by`;
  - the queues.
- **The flow-field pool** (`fields`, `fieldByGoal[3]`, `fieldGoalKey`, `fieldDomain`,
  `fieldLastIssued`) holds up to `MAX_FLOW_FIELDS` 128 fields of 11,520 B each on a 48×48 map. It
  can grow past 128 when every field is live: the capacity stress read **256 fields, 2.8 MiB**.
  Every field still keyed in `fieldByGoal` equals `compute(currentMask, elevation, goal)`:
  - `recomputeFields` recomputes every live keyed field;
  - it drops the key of every field that is not live;
  - an unkeyed slot's bytes are unobservable (its own comment).

  So **a keyed field can be rebuilt exactly from (slot, goal, domain)**, and an unkeyed slot can be
  left as zeros. The probe confirmed both (§2.3).
- **The cut point.** Between two frames, after `runFrames` has run and reported frame f, and
  before `applyFrame` of f+1:
  - `commandQueue` is empty, because `applyCommands` drains it;
  - `runtimeQueue` is empty, because it is cleared at the top of `applyCommands` (R-3);
  - **`pendingEvents` is not always empty.** In an economy room the runtime's production spawns
    units inside `runtime.step`, after `sim.tick()`. Their `spawn` events wait for the next tick's
    return. The probe counted **13–20 boundaries per 20-minute economy match** with pending `spawn`
    events, and none in mirror rooms. They are state, and the snapshot carries them.
- **The runtime.** `MissionRuntime` has **98 own properties**. An economy room (KDF v Sarim, N3)
  runs one. A mirror room runs none (`buildMatchWorld`: `economy ? economyRuntime(...) : null`).
  The runtime holds:
  - Maps and Sets whose insertion order can matter;
  - `ProductionLine` and `CivilianFlight` objects;
  - closures (`holdView`, `routeSource`);
  - caches (`corridorFields` with its own FlowFields and stamps, `seen*` grids, `zoneRoutes`,
    `rear*`, `terrainVersion`).

  `runtime.digest()` folds the economy, objectives, Conduct and the rest, but not its caches.
- **No module-level state** that persists between calls. The only module-level `let`s in
  `packages/sim` are scratch (`flowfield.ts` `scratchTile`/`scratchCost` and `corridor.ts`
  `scratch*`), resized and overwritten per call.

---

## 2. What a snapshot weighs (measured)

### 2.1 How it was measured

The probe (`tools/src/net/snapshot-measure.ts`, untracked) builds real rooms with `buildMatchWorld`
(`roomConfig` of `versus-probe.ts`) and plays them with the versus probe's deterministic drivers:
- `planRound` rebuilds each side's doctrine mix every 20 s;
- every living unit then attack-moves on the enemy's centroid.

Each game ran to **24,000 ticks (20 minutes) without stopping at an outcome**. Five cells: the
three KDF-v-Sarim economy cells (tel_marum seed 1000, wadi_tarfan seeds 8919 and 16838, with the
seats swapped in the last) and two mirror cells (tel_marum 1000, milh_flats 8919). A second run,
`--stress`, filled a mirror world to its 256-entity capacity before tick 0 (tel_marum and
wadi_tarfan, 239–250 living and fighting at tick 100).

Conditions: macOS, Apple M3 Pro, Node 25.9.0, a single process, no browser. "Raw" is the sum of
the typed arrays' `byteLength`, either at full length or cut to the `[0, count)` prefix of every
per-entity column. Compressed sizes are `zlib.gzipSync` at level 9 and `brotliCompressSync` of the
prefix concatenation. Runtime is a JSON rendering of its own properties without `sim`, `mission`
or `ctx`.

### 2.2 Results

| Case (at tick 24,000 unless noted) | count / living | Sim raw: full / prefix | Sim gzip / brotli | Runtime raw → gzip | Flow pool | Log (JSON) |
|---|---|---|---|---|---|---|
| tel_marum KDF/Sarim | 76 / 32 | 231.0 / 101.0 KiB | 3.6 / 3.0 KiB | 42.1 → 2.7 KiB | 128 fields, 1.41 MiB | ~565 KiB |
| wadi_tarfan KDF/Sarim | 84 / 39 | 231.0 / 106.7 KiB | 4.5 / 3.7 KiB | 44.5 → 3.5 KiB | 128, 1.41 MiB | ~566 KiB |
| wadi_tarfan Sarim/KDF | 72 / 30 | 231.0 / 98.1 KiB | 4.3 / 3.6 KiB | 44.4 → 3.5 KiB | 125, 1.37 MiB | ~565 KiB |
| tel_marum mirror | 43 / 11 | 231.0 / 77.1 KiB | 2.3 / 2.0 KiB | none | 62, 0.68 MiB | ~563 KiB |
| milh_flats mirror | 48 / 6 | 231.0 / 80.7 KiB | 3.5 / 3.0 KiB | none | 81, 0.89 MiB | ~564 KiB |
| **stress tel_marum, t=600** | 256 / 150 | 231.0 / 231.0 KiB | **14.5 / 10.9 KiB** | none | **256, 2.81 MiB** | — |
| **stress wadi_tarfan, t=1200** | 256 / 136 | 231.0 / 231.0 KiB | **15.2 / 11.3 KiB** | none | 256, 2.81 MiB | — |

Notes on the table:
- **The full raw size is a constant: 231.0 KiB for any room** at capacity 256 on a 48×48 map. It
  includes scratch columns the snapshot will not carry (§3.1), so it is an upper bound. Compressed
  sizes track how much is going on, not how long the match has run. Across one match from 5 to 20
  minutes the gzip read moved by under 1 KiB.
- **The bot matches are small.** The probe's economies stop growing: `count` peaks at 72–84 and
  living at 30–44. A human match will sit between those rows and the stress rows, so **budget for
  the stress figure: 16 KiB compressed for the sim, plus about 4 KiB for the runtime.**
- **The log estimate** is 22 characters per empty frame plus the JSON of the probe's commands. It
  is dominated by empty frames and grows linearly. The snapshot does not grow.
- **Sim cost per tick**, Node, sim only: 0.01–0.09 ms a tick averaged over a 20-minute bot match.
  At capacity under fire it is 2.2–4.0 ms, falling to 0.32–0.45 ms averaged over 24,000 ticks as the
  units die. So a Node replay of a 20-minute log costs about 0.25–2.2 s for the bot matches and
  about 8–11 s for the stress. The browser adds per-tick presentation and runs inside a 12 ms
  budget per frame. **The browser's rejoin replay time at 20 minutes was not measured here.**
  Measuring it is S4's first task (§9), with the existing `rejoin-catchup` harness and one Metal
  check on its own port.

### 2.3 Restore cost, and the reflection prototype

The probe also ran a reflection prototype of the restore in §3:
1. Build a fresh world from the same config.
2. Deep-clone the source world.
3. Overwrite the fresh world's data properties in place. Typed arrays use `.set` so the read-only
   `state`/`structures`/`works` views stay aliased; functions and closures stay the fresh world's.

**Plain restore costs 1.3–5.1 ms.** A second variant **poisoned the scratch columns** (filled with
`0x5a`) and **rebuilt the flow-field pool from its keys alone**: every slot was filled with garbage
first, then only the keyed slots were recomputed. It costs 10–68 ms, almost all of it the field
rebuild (the field rebuild alone read 9–90 ms at the checkpoints).

Forks ran at ticks 1,200, 4,800, 9,600 and 14,400 in all five cells, and at 300 and 1,200 in both
stress worlds: 24 fork points, both variants, 48 restores in all. Every restored world was stepped
1,200 ticks beside its source with the same drivers. **All 48 matched the source on every hash
tick, and their whole data graphs were equal at the end** (the scratch columns excluded). This
shows three things:
- the object graph of `Sim` + `MissionRuntime` is the whole state, with no hidden module or closure
  state;
- the field pool is exactly rebuildable from its keys;
- the restore is fast.

---

## 3. Serialise and restore

### 3.1 The four classes

Every own property of `Sim`, of `MissionRuntime`, and of every object they own (`Rng`,
`CivilianFlight`, `ProductionLine`, the income-zone records, the works records) is named in **one
schema table** (`packages/sim/src/snapshot-schema.ts`) with exactly one class.

| Class | Meaning | On restore | How it is proved |
|---|---|---|---|
| `state` | changes during a match and is read later | encoded and written back | the fork witness's encoding equality (§6.1) |
| `config` | fixed by `MatchConfig` at boot: `width`, `height`, `capacity`, `seed`, `unitTypes`, `structureTypes`, `boulder`, `openGrid`, `humanHeldBySide`, the runtime's `mission`/`ctx`/`holdView`/`routeSource`, route geometry | rebuilt by `buildMatchWorld` | a **config check**: at every snapshot point of the witness, each `config` property equals the freshly built world's |
| `derived` | a pure function of `state`, too large to send: **the flow-field pool's contents only**, at first | rebuilt from `state` by a named function | a **poison check**: fill with garbage, rebuild, fork, and require equality |
| `scratch` | overwritten before any read, every use: `seenThisTick`, `bestObserver*`, `det*`, `fieldLive`, `spreadTiles`, `sealQueue`/`sealStamp`, `snapX/Y`, `eyeX/Y`, `engage*`, `presentedArc`, `approachField`, `aimTurned`/`aimDesired`/`aimFrom`, `braceWant`, and so on | left at the fresh world's value | a **poison check**: fill with garbage and fork |

**The rule for a doubtful property: `state`.** Encoding a small array (2.3 KiB at most for a grid)
costs a few compressed bytes. A wrong `derived` or `scratch` class costs a desync. So only the flow
fields are `derived` at first, and `scratch` needs a passing poison check. The probe has already
shown that the hash comments are not a safe guide here:
- **`trail` is "derived state that tnProgress already determines"** by its hash comment. Poisoning
  it **diverged the hash within 20 ticks** in every economy cell, because `trailStrengthFor` reads
  it. It is `state`.
- **`stProducesFor`** is unhashed and poisoning it kept every hash equal for 1,200 ticks. But the
  runtime's `incomeZoneList[].route` and `rearOk` had diverged by the end, because `runtime.digest()`
  does not fold them. It is `state`. A hash-only witness would have passed it.
- `aimTurned`/`aimDesired`/`aimFrom`, `braceWant` and `constructedAt` survived poisoning. The first
  four are real scratch (each comment says so). `constructedAt` survived because versus never uses
  field works, so it is **unexercised, not proved**. That is what the coverage census (§6.3) is for.

**Completeness gate.** A test reflects over a freshly built world, an economy world and a world with
every deferred latch set. It fails on any own property missing from the table, and on any table
entry naming a property that no longer exists. Falsification: add one field to `Sim` and watch it
go red, then rename one and watch it go red.

### 3.2 The encoding

The format is binary, little-endian, and built through a `DataView`. Typed-array memory is never
copied raw, because a typed array's byte order is the platform's. The encoding is **canonical**:
one state gives one byte string, on any engine. The format version starts at 1.

```
header   magic "RLSS" u32 | format u16 | build (len-prefixed UTF-8) | contentDigest u32
         matchId (len-prefixed) | frameTick u32 | simTick u32 | capacity u16 | width u16 | height u16
         count u16 | structureCount u16 | tunnelCount u8 | matchDigest u32 | latches u16
sim      every `state` column, in schema order, FULL length
         (no count prefix: zeros compress to nothing, and nothing is assumed about slots past count)
         scalars (count, tickCount, evacCount, deliverId, sealGen ...)
         pendingStrikes: n, then {x, y, by, readyTick, profile} each
         pendingEvents: n, then each event by a per-kind encoder; an unknown kind refuses to encode
         stTiles: per structure, n then tiles
         the field pool's KEYS: length (the watermark), per slot {goalKey i32, domain u8, lastIssued i32},
         and each domain's fieldByGoal insertion order
runtime  absent in a mirror room; else every `state` member of MissionRuntime and its objects, in schema
         order: typed arrays as above, Map and Set in insertion order, strings (unit ids) by index into
         the registered type table where one exists, else length-prefixed UTF-8
```

Five choices in this format need saying.
- **Full-length columns, not the `[0, count)` prefix.** The prefix saves nothing once compressed,
  and it would rest on an unproved claim that no column past `count` (the RNG words included) is
  ever written. Full length removes the claim.
- **Every deferred-fold column is encoded whatever its latch.** The latches are encoded as scalars.
  Mirroring the hash's conditional folds would add eight branches, any of which could be wrong, to
  save bytes that compress to almost nothing.
- **Map and Set insertion order is kept**, including in `fieldByGoal`. It is cheaper to keep it
  than to prove that no iteration anywhere depends on it.
- **The runtime is encoded by explicit per-member encoders** generated from the schema table, never
  by generic reflection. Reflection is the test's tool, used to check the table.
- **Integers only.** Every column is an integer typed array and every scalar is an integer or a
  boolean. The encoder and decoder live in `packages/sim` under its lint (no `Math`, no `Date`).
  Compression and SHA-256 live outside the sim, in `packages/net` and the app.

### 3.3 Restore, in order

1. Check the header against this client and this room before allocating anything: format, build,
   contentDigest (`shippedContentDigest()`), matchId, capacity, width and height.
2. `buildMatchWorld(config)`, exactly as at boot. That gives every `config` property, the closures
   and the views. Every snapshot of this room is restored onto the same build of the same config.
3. `Sim.restoreState(reader)`, a sim method so that nothing outside the sim writes a column
   (invariant 4). It writes every `state` column **in place**, which keeps the read-only views
   aliased, plus the scalars, the strike and event lists, `stTiles` and the RNG words. It checks
   every length against the schema and every count against capacity, and refuses rather than clamps
   (§7).
4. `Sim.rebuildFieldPool(keys)`:
   - grow `fields` to the encoded watermark;
   - recompute each keyed slot with `compute(pathMaskFor(domain), domain === AIR ? openGrid :
     elevation, goal)`;
   - leave each unkeyed slot zeroed;
   - restore `fieldGoalKey`, `fieldDomain`, `fieldLastIssued` and each domain's Map in its encoded
     order.

   The masks are `state` and were restored in step 3. The pool's eviction order is
   `fieldLastIssued`, and the probe showed it matters: resetting it changed which slot the next goal
   took.
5. `MissionRuntime.restoreState(reader)` in an economy room. Caches whose class is still `state`
   are written back as they are. Moving a runtime cache to `derived` (marking `corridorsDirty` and
   bumping `terrainVersion`, say) needs its own poison check first.
6. Recompute `matchDigest(sim.hash(), runtime?.digest() ?? 0, shippedContentDigest())` and compare
   it with the header's `matchDigest`, which the room has vouched for (§5.3). A mismatch throws, and
   the caller falls back to the full log (§5.4).

---

## 4. Producer and cadence

### 4.1 Options

| Producer | For | Against |
|---|---|---|
| **Both clients (recommended)** | the room stays a relay and never imports the sim (§3.1 of the network spec); a client already holds the state; the encode costs a few ms a minute | the room must not trust what it is handed (§5) |
| The Durable Object, running a headless sim | the room could vouch for content itself, a step towards an authoritative server | it doubles the Worker bundle; a 20 Hz sim inside the DO is real CPU on the free plan for every match; it breaks "the Worker never imports `sim`"; and a DO restart (every deploy) would have to restore its own sim from a snapshot, which is circular. Not now. |
| One client only (seat 0) | half the upload | the room cannot tell an honest upload from a doctored one |

### 4.2 Cadence

`MatchConfig` gains `snapshotEveryTicks`, minted by the room: **1,200** (60 s), a multiple of
`hashEveryTicks`, with 0 meaning off. A snapshot tick is a frame tick f where `(f + 1) %
snapshotEveryTicks === 0`, so it is always a hash tick.

After `runFrames` reports frame f:
1. Encode (sim + runtime).
2. Compress with `CompressionStream('gzip')`, which is asynchronous and keeps the frame loop free.
3. `POST` the bytes (§5.1).

The first snapshot is at frame 1,199. The cost to a client is one encode a minute, a few ms at
most (the plain restore, the inverse, measured 1.3–5.1 ms), plus at most 16 KiB of upload.

Why 60 s:
- A rejoiner replays at most 1,200 ticks plus whatever passed during its own download.
- At the stress tick cost that is under 5 s in Node, and for a normal match a fraction of a second.
- A shorter interval buys little and costs a row write each time.

The cadence is a lead decision (§11, D2).

---

## 5. Trust and the room's side

### 5.1 Upload: `POST /api/match/:code/snapshot`

The route is HTTP, not WebSocket, because the socket protocol caps a client message at 4,096 bytes.
Splitting 16 KiB of base64 into frames would fight the per-socket rate limit for nothing.
- **Authentication.** The seat's ticket rides in an `Authorization` header and never in the query
  string (§3.5 of the network spec: query strings are logged). `Origin` is required. The route is
  rate-limited like `/join`.
- **Who may upload.** Seat tickets only. Advisor and bot-advisor tickets may not.
- **Limits.**
  - The body is at most 64 KiB compressed. That is four times the measured worst case.
  - It is decompressed through a counting stream with a 1 MiB ceiling, so a decompression bomb
    is refused, not inflated.
  - At most one pending upload per seat per snapshot tick.
  - The tick must be a snapshot tick, newer than the stored snapshot, and already minted
    (`< st.tick`).
- **Acceptance.** The Worker never decodes the snapshot. The DO computes SHA-256 of the
  *decompressed* bytes, because two browsers' gzip output need not match. It then holds the upload
  in memory until all three of these hold:
  1. **Both seats** have uploaded for that tick and the two SHA-256 values are equal.
  2. The room has seen that frame tick's hash pair **agree**. It now keeps the agreed value for
     snapshot ticks, one integer, where today it prunes it.
  3. The `matchDigest` in the header (read at a fixed offset, never parsed further) equals that
     agreed value.

  When all three hold, it writes **one row**, `snapshot(id = 0, frame_tick, sha, digest, bytes BLOB)`,
  replacing the previous row. It keeps exactly one snapshot, so storage stays constant at about
  16 KiB a room, and the row goes with the room's `deleteAll`.
- **Cost.** One accepted snapshot a minute is about one row write plus an index write. Today a room
  writes 72–132 rows a minute (R-N12), so this adds about 1–3%. Two POSTs a minute per room is
  negligible against the free plan's 100,000 requests a day.

### 5.2 What a mismatch means

The hashes can agree while the two content SHAs differ. That means the two worlds diverged in state
the hash does not cover (or the encoder is not canonical, which is a bug of the same kind). Under
decision 10 a desync is a bug, never resynchronised. **Recommended: report only at first.**
- The room drops both uploads.
- It keeps the previous snapshot.
- It writes one `snap_mismatch` row to D1 with the tick and both SHAs.

**Voiding the match on a mismatch** is the stricter option, but it should wait until telemetry has
shown it never fires on honest play (§11, D3). Either way, while one seat is gone no new snapshot
can be accepted, because agreement needs both seats. The rejoiner uses the last snapshot made while
it was present, which is exactly the one it needs.

### 5.3 Rejoin

1. `GET /api/match/:code/snapshot`, with the ticket in the header and `Origin` required. It answers
   `204` when there is none, else `{frameTick, sha, digest}` with the compressed bytes.
2. The client checks the decompressed bytes' SHA-256 against `sha`, then restores (§3.3). Step 6 of
   the restore compares the recomputed match digest with `digest`.
3. The client sends `hello{ticket, build, from: frameTick + 1}`, the one new protocol field. The
   room answers with `log` parts **from that tick**:
   - `SELECT … WHERE first_tick > from - BATCH_TICKS`, then trim;
   - this also cuts rows read per rejoin from about 1,200–2,640 to at most about 60.
4. `LockstepClock` starts at `from`. The behind-stall the room raises on the rejoiner lasts as long
   as at most 1,200 ticks plus the download, not the whole match.

`from` also serves **a socket drop with no reload** (§1.1, case 1). The client sends its newest tick
+ 1 and gets only the frames it lacks, not the whole log again. That is a separate, small win, and
it is S3's (§11, D6).

### 5.4 The fallback is today's path

At any failure the client sends `hello` without `from` and replays from tick 0 exactly as now:
- no snapshot, or a fetch error;
- a SHA mismatch;
- any header check failing;
- a decode refusal;
- a digest mismatch after the restore.

The full log stays in the DO for the room's lifetime. Desync reports, the arena and any spectator
read it. A snapshot is never the only copy of anything.

### 5.5 Security

- **The room trusts a snapshot only through agreement.** A seat alone cannot get one accepted,
  because the other seat's SHA would differ. Agreement plus the agreed digest means the stored bytes
  are the state both honest clients computed. Two colluding seats gain nothing: they are the only
  players in the room.
- **The rejoiner verifies twice:** the SHA the room vouched for, then the match digest recomputed
  from the restored world. It trusts the room as it already trusts the room's frames.
- **The decoder treats every byte as hostile:**
  - every length must equal the schema's;
  - every count must be at most capacity, every id in range, and every event kind and string index
    known;
  - a typed array is never sized from a decoded field;
  - the decoder refuses rather than clamps;
  - it never yields a half-written world, because restore writes into a world built for this
    purpose that is discarded on refusal.

  A fuzz test feeds truncated, bit-flipped and oversized inputs and requires a clean refusal every
  time.
- **No secrets and no personal data in a snapshot.** It holds sim state, matchId and build. Seat
  tokens and callsigns stay in the config, which the room already sends.
- **Limits** are named in §5.1. Exploit-level detail of the threat model stays out of this public
  repo, as the network spec does.

---

## 6. The proof

### 6.1 The core gate: restore-then-step equals the uninterrupted run

For each witness world W, each snapshot tick T and a horizon N:

```
A = W run uninterrupted to T + N                       (frames as recorded)
S = encode(A at T)
B = buildMatchWorld(config); restore(B, S)              (a fresh world in the same process; S is bytes,
                                                         so nothing is shared)
step B with A's frames T+1 .. T+N
require: matchDigest(A, t) == matchDigest(B, t)         at every hash tick t in (T, T+N]
require: encode(A at T+N) == encode(B at T+N)           byte for byte
require: encode(decode(S)) == S                          round trip, at T
```

The second requirement carries the weight. **Hash equality is not enough**, and the probe proved it
by mutation (§6.2). The encoding covers every `state` property, hashed or not, so it sees a
divergence in `fieldRef`, `trail`, `stProducesFor` or a runtime route cache on the tick it happens.
Comparing encodings, not raw object graphs, keeps `scratch` columns (stale by design) from raising
false alarms. The raw-graph comparison in the probe did exactly that on `aimDesired`.

### 6.2 What the reflection prototype already showed, by mutation

Each line is a one-line mutation of the restore, run in the probe. It is **not** a test of the
production code, which does not exist yet. It shows what kinds of check this design needs.

| Mutation | Hash over the 1,200-tick fork | Full-state comparison |
|---|---|---|
| leave `rng.state` at the fresh seed | **diverged at the restore tick** | — |
| drop the per-domain goal maps (`fieldByGoal`) | **equal on every hash tick** | **differs** (`fieldRef[39]`) |
| reset `fieldLastIssued` | equal on every hash tick | **differs** (the field pool) |
| poison `trail` (economy cells) | **diverged within 20 ticks** | — |
| poison `stProducesFor` | **equal on every hash tick** | **differs** (`runtime.incomeZoneList[].route`, `rearOk`) |
| reset `trail` to the fresh world's value at T = 2,000, tel_marum KDF/Sarim | equal | **equal**: no route was dug in that window, so the mutation tested nothing |
| poison `aimTurned`/`aimDesired`/`aimFrom`, `braceWant` | equal | equal (scratch) |

The `trail` reset row is the lesson of CLAUDE.md's "Every check gets an
input that makes it fail". A mutation that changes nothing in the sampled worlds is not evidence.
§6.3 exists for it.

### 6.3 The coverage census

The witness records, for every `state` property, whether **any** snapshot point in the matrix held
a value different from the freshly built world's. A property that never left its fresh value was
never tested by the witness. The census:
- **prints every such property by name;**
- **fails unless it is in a named exemption list**, with a reason;
- fails, like `mesh_gait.test.ts`'s demotion rule, on any exemption that has become exercised, and
  tells you to delete it.

The matrix (§6.4) is built to leave that list nearly empty: each deferred latch needs a world that
sets it.

### 6.4 The witness matrix

| Tier | Where | Worlds | Snapshot ticks × horizon | Budget |
|---|---|---|---|---|
| **fast** | `packages/sim/src/snapshot.test.ts`, inside `pnpm test:determinism` | the four golden replays already pinned (the 1000-tick replay, relief, order-done, the 2400-tick economy replay) | every 50 ticks, N = 200 | a few seconds |
| **full** | `tools/src/net/snapshot-witness.test.ts`, its own CI step (`pnpm snapshot:witness`) | the four fair versus maps × mirror and economy rooms × 2 seeds; the tunnels arm (GH-681); a wounds world (GH-707); a field-works mission; an air-carrier world; a capacity stress; `patrol`, `beam`, `placed` and mobility-kill worlds where content allows | every 1,200 ticks to 24,000 plus 7 prime offsets (97, 1,013, …), N = 1,200; one long tail per world (restore at 600, run to the end) | estimated 60–120 s. The probe's five 20-minute cells plus 40 forks took 13 s of wall time, and the stress pair 39 s. |
| **cross-engine** | `pnpm net:engines`'s two-engine harness | one economy cell | a V8 snapshot restored under Firefox and WebKit | optional, S5 |

Every check above arrives with its falsification in the commit message, run and seen red:
- drop one `state` column from the encoder;
- class one `state` column `scratch`;
- skip the field rebuild;
- reorder one Map;
- reset the RNG.

A format pin (§9) moves only in a commit that changes the format or the state set on purpose,
saying "Was <n>." and why.

---

## 7. Constraints

- **Size.** Budget 64 KiB compressed per snapshot: four times the measured maximum (16 KiB sim,
  plus about 4 KiB runtime). The decompressed ceiling is 1 MiB, four times the 231 KiB full sim plus
  the runtime. Storage is one row per room, at most 64 KiB, well under the 2 MB row limit. It is
  freed with the room.
- **Bandwidth.**
  - Upload: two seats × at most 16 KiB a minute.
  - Rejoin, today: about 565 KiB of log at 20 minutes (about 700 KiB at the 25-minute cap).
  - Rejoin, with a snapshot: at most 16 KiB of snapshot plus at most 60 s of log, about 26 KiB of
    empty frames plus commands.
- **CPU, client.**
  - Encode: a few ms a minute, plus asynchronous gzip and SHA-256.
  - Restore: 1.3–5.1 ms for the state, plus 9–90 ms of field rebuild. That is Node on an M3 Pro,
    and a slower machine may take two or three times as long.
  - Then at most about 1,200 ticks of quiet catch-up.
- **CPU, room.** One SHA-256 over at most 1 MiB and one gzip inflate per upload. Nothing per tick.
- **Rows.** About 1 accepted snapshot a minute, against 72–132 frame rows a minute today. Rows
  read per rejoin fall (§5.3).
- **What the rejoiner does not get back: presentation history.** A replay from 0 lays every crater
  and scorch mark and builds every wreck as it goes. A restore at T starts from the state alone, so
  the decals, the feed and the minimap flashes from before T are absent:
  - **Wrecks and bodies can be rebuilt**: a dead entity keeps its slot, position, facing and type.
  - **Craters and scorch cannot.** Nothing in the sim remembers where a shell landed.

  The scoreboard is unaffected, because it is read from state (§11b.2). This is a lead decision
  (§11, D4).
- **The AI harness** (`tools/src/net`) keeps rejoin-from-0 unless it opts in. Its `fog-tracker`
  memory is the harness's own and is not in a snapshot.

---

## 8. Invariants: none move

1. **Fixed 20 Hz tick.** The snapshot is cut at a frame boundary and restored before the next
   frame's tick. Its cadence is keyed by frame tick, never by wall time. Restore advances no tick
   and reads no clock.
2. **Q16.16, no floats in the sim.** Every encoded value is an integer from an integer column, or a
   boolean. The encoder and decoder live under the sim's lint. Compression and SHA-256 live in
   `net`/`app`.
3. **Seeded per-entity RNG.** `Rng.state` is carried word for word at full length. Every stream
   continues exactly where it was, and nothing is re-seeded. A different seed would be refused at
   the header (`matchId`/config) before any column was read.
4. **One-way data flow.** The bytes enter the sim through the sim's own `restoreState`, called by
   the net layer before the first post-restore tick, the same category as the constructor and the
   placements. Nothing outside the sim writes a column. The renderer starts from the restored state
   and subscribes to events as before. Chat, pings, the advisor and the snapshot bytes cannot become
   commands.

**Pins.** `sim.hash()`, `runtime.digest()`, `economyHash()` and `matchDigest` are not edited, so
every golden, versus, mirror, net, economy and runtime-digest pin stays where it is. The encoder
adds no hashed property. The completeness test reflects over own properties, so a helper must not
be stored on the instance.

---

## 9. Staged plan outline

Each stage is one plan of a handful of tasks, one PR series, with `gates` and `determinism` green
and the sim pins unmoved. It is scheduled against the lanes on the sim and the net today
(versus-tunnels, net-n3, wounded-p2, special-units-*): S1 and S2 touch `sim.ts` and `mission.ts`
only additively, and S3 touches the worker and net protocol.

| Stage | Touches | Delivers | Gate |
|---|---|---|---|
| **S1 · sim snapshot** | `packages/sim`: `snapshot-schema.ts`, `snapshot.ts` (encode, decode, `restoreState`, `rebuildFieldPool`), tests | the four-class table for `Sim` and its objects; the canonical encoder; the completeness test; the fast witness in `test:determinism`; a decoder fuzz test; **the format pin is born** (SHA-256 of the 1000-tick golden replay's snapshot at tick 500) | the fast witness green on all four golden replays; each falsification in §6.4 seen red; no sim pin moved |
| **S2 · runtime snapshot** | `packages/sim/src/mission.ts` (+ production, civilians, income) | the runtime half of the table and encoder; pending events across the boundary; the economy golden replay in the fast witness | the economy fork equal by encoding; `stProducesFor`/route-cache falsification red |
| **S3 · the room** | `packages/worker/src/match`, `packages/net/src/protocol.ts`, `config.ts` | `snapshotEveryTicks` in the config; `POST` and `GET /api/match/:code/snapshot`; acceptance by two-seat SHA plus agreed digest; the one-row store; `hello.from` and the trimmed log reply; the D1 `snap_mismatch` row | `match-room.test.ts` over `fake-do`: acceptance, refusal (one seat, SHA mismatch, digest mismatch, oversize, bomb, advisor ticket, stale tick), `from` replies, an eviction mid-upload; row budget re-measured |
| **S4 · the client** | `packages/app/src/net`, `packages/net/src/ws-transport.ts` | the producer after `runFrames`; the rejoin path (fetch, verify, restore, `hello.from`) with the full-log fallback; wreck and body rebuild if D4 says so; **first the browser measurement of today's rejoin** (time to live, opponent frozen time) | `rejoin-catchup.test.ts` extended: a snapshot rejoin's stall is at most 1,200 + ε ticks; every fallback branch exercised; one Metal check on its own port, music off |
| **S5 · the full witness and the report** | `tools/src/net/snapshot-witness.test.ts`, CI | the full matrix of §6.4 with the coverage census; optional cross-engine restore; a short report on the issue with sizes from real matches | the census list empty or each entry reasoned; the lead plays two matches with a forced reload in each |

S1 and S2 can run in parallel with S3, because the room treats the snapshot as opaque bytes. S4
needs all three.

---

## 10. Risks

- **Canonical encoding across engines.** The `DataView` encoding is exact by construction, so the
  risk sits in the runtime's string and order handling. The cross-engine row of §6.4 tests it, and
  the content-SHA comparison flags it on live matches (§5.2).
- **A future column added without a class.** The completeness gate fails the build.
- **A column added as `state` that no witness world exercises.** The coverage census names it.
- **The runtime is large and growing** (98 properties). S2 may find caches whose `state`
  encoding is awkward, such as FlowFields inside `corridorFields`. The fallback is to encode their
  keys and rebuild them, like the pool, with a poison check.
- **Presentation gaps** after a snapshot rejoin (D4) may surprise a player. The end panel and the
  scoreboard are unaffected.
- **The `trail` and `stProducesFor` results** show that the hash comments call things derived that
  the snapshot cannot treat as derived. None of this changes the hash, and none of it is a desync
  today, because both clients run the same history. It matters only to a restore.

---

## 11. Decisions for the lead (ruled 25 Oct)

The lead approved this design on 25 Oct 2026 and ruled every decision as recommended.

| # | Question | Recommendation | Ruling |
|---|---|---|---|
| D1 | Who makes the snapshot? | **Both clients upload; the room accepts on two equal SHA-256s plus the agreed digest.** A DO-run sim is rejected for now: it doubles the bundle, costs CPU on every match, and breaks "the Worker never imports sim". | **Ruled by the lead, 25 Oct: as recommended.** |
| D2 | How often? | **Every 1,200 ticks (60 s)**, which bounds a rejoin's replay to one minute of ticks. | **Ruled by the lead, 25 Oct: as recommended.** |
| D3 | The content SHAs differ while the hashes agree. | **Report only at first** (a D1 row, previous snapshot kept). Voiding the match on it comes later, once telemetry shows it never fires on honest play. | **Ruled by the lead, 25 Oct: as recommended.** |
| D4 | What the rejoiner sees of the past | **Rebuild wrecks and bodies from the dead slots. Accept that craters, scorch and the feed from before T are gone.** | **Ruled by the lead, 25 Oct: as recommended.** |
| D5 | Scope of the first version | **Mirror and economy rooms together (S1 + S2).** KDF v Sarim is the headline match, and it runs the runtime. | **Ruled by the lead, 25 Oct: as recommended.** |
| D6 | Use `hello.from` for a socket drop without a reload | **Yes, in S3.** It stops re-sending the whole log (about 565 KiB at 20 minutes) to a client that already has it. | **Ruled by the lead, 25 Oct: as recommended.** |
| D7 | Cross-version snapshots, or save-games built on this | **Never in this design.** A snapshot is scoped to one room and one build, and it dies with the room. A save-game format would need migrations, and that needs its own spec. | **Ruled by the lead, 25 Oct: as recommended.** |

---

## 12. S1 as built (25 Oct 2026)

Stage 1 is the sim half of the snapshot for the sim alone: the schema, the canonical codec, the
pool rebuild, the fork witness and the format pin. The runtime half (`MissionRuntime`) is S2. Where
a section above says otherwise, this one wins. The deviations (§12.2) are the part S2, S3 and S4
must read.

### 12.1 What landed

**Schema** (`packages/sim/src/snapshot-schema.ts`). All 239 own properties of `Sim` have exactly one
row, in creation order, and `Rng` has its own table.

| Class | Rows | Of which |
|---|---|---|
| `state` | 197 | 167 typed arrays, 19 scalars, 6 `aux` (JSON tail), 4 `pool`, 1 `rng` |
| `config` | 15 | rebuilt by the setup that built the target |
| `scratch` | 26 | left at the fresh world's value |
| `derived` | 1 | `fields`, the flow-field pool's contents |

The `boundary` class that an earlier draft carried is gone (§12.2). A completeness test reflects
over a bare world, the golden world at tick 0 and 500 and the wounded world, in both directions
(every property has a row, every row names a property, and each row's kind matches the live value).
The match-world half, a mirror room and an economy room at tick 0 and 300, is in
`tools/src/net/snapshot-witness.test.ts`, because `sim` cannot import `app`.

**Codec** (`packages/sim/src/snapshot.ts`). `encodeSim(sim, meta)` and `restoreSim(sim, bytes)`.
- The header is fixed-width first (39 bytes), strings last: `RLSS`, format u16, schema digest u32,
  `matchDigest` u32, `contentDigest` u32, `frameTick` u32, `simTick` i32, capacity, width and height
  u32, `hasBoulders` u8, then `build` and `matchId` (u16 length, UTF-8, at most 256 bytes each).
  `matchDigest` sits at `SNAPSHOT_MATCH_DIGEST_OFFSET` (10), so the room can read it without a
  decoder (§5.1).
- The schema digest is the sim's own `hashWord` folded over every row's name, class and kind, in
  order. A build whose table differs in any row, or in their order, writes another number and
  `restoreSim` refuses it.
- Then every `state` typed array at **full length** (u32 length, then elements), the scalars (i32,
  or u8 for a boolean), the RNG words, and a tail: u32 length, then canonical JSON (sorted keys, no
  floats, depth at most 16, at most 4 MiB) of the six `aux` rows and the pool's keys.
- Every refusal is a `SnapshotRefused` with a reason. The header is checked before the first write;
  a refusal after that leaves the target half-written, so the caller discards it and builds another.
  The decoder bounds every allocation by the target's own lengths and never sizes one from a decoded
  field. It does not range-check every id column (ruling, Task 3): the bytes come from two seats
  that agreed on them, and the digest is re-checked before the first tick.

**The pool is rebuilt from its keys** (`Sim.fieldPoolKeys`, `Sim.restoreFieldPool`). All slots'
`{goalKey, domain, lastIssued}` are carried, unkeyed slots included, because eviction compares the
stale `lastIssued` of unkeyed slots and that decides a later `fieldRef`. Each domain's `fieldByGoal`
order is carried. The decoder bounds the watermark by restore memory, not by capacity:
`watermark * width * height * 5 bytes` (a `Uint8Array` dir and an `Int32Array` cost per cell) must be
at most `POOL_RESTORE_BUDGET_BYTES`, 64 MiB, which is about 5,800 slots on a 48×48 map. Capacity was
the wrong bound. Group orders create a field per unit per order, `fields` never shrinks, and a probe
grew a 256-capacity world's pool to 293 slots in five orders of 60 units. A capacity bound would have
made that match unsnapshottable.

**The fork witness** (`packages/sim/src/snapshot-witness.ts`: `forkWitness`, `forkWitnessSeries`).
It is a non-test module so that `tools` runs the same proof. A runs uninterrupted. At each cut tick
T, B is a fresh world from the same build, and:
1. every `state` row of B is **poisoned before the restore** (`poisonState`), the pool included
   (three junk slots with bogus keys), so a restore that skips a row leaves garbage and shows;
2. B is restored from A's bytes alone, and **re-encoded at T**: it must give back exactly the bytes
   it was restored from (round trip at T);
3. every `config` row of A is compared with B's (`configDiff`, Sets and Maps by content);
4. both worlds are driven with the same inputs for the horizon, with the match hash compared at T
   and every 20 ticks;
5. the two canonical encodings must be **byte-equal at the end**.

`pnpm test:determinism` is now `determinism.test.ts` plus `snapshot-witness.test.ts` (83 tests, 2.7
s before, 3.5 s after). That file holds the fast witness, a fork every 50 ticks with N = 200 on
three golden replays (the 1000-tick battle, relief, orders), the self-checks that must stay red, the
series runner and the format pin. `snapshot.test.ts` (round trips, refusals, fuzz) runs in `pnpm
test` only.

**The tools witness** (`tools/src/net/snapshot-witness.ts`, `pnpm snapshot:witness`; CI runs
`pnpm snapshot:witness -- --self-check` in `gates`, right after `pnpm playtest`).

| World group | Worlds | Cuts |
|---|---|---|
| mirror rooms | four fair maps × seeds 1000 and 8919, 24,000 ticks | every 1,200 ticks and 97, 1,013, 4,999, 11,003, N = 1,200; a tail from 600 |
| economy rooms | the three KDF/Sarim cells of §2.1, 24,000 ticks | the same, plus one cut at a boundary with a queued command |
| tunnels arm | tel_marum KDF/Sarim 1000 with the tunnel plan (`answer`) | the same |
| capacity stress | tel_marum, 256 of 256 entities, 6,000 ticks; the pool reaches 256 slots | the same, asserted by `exercised` |
| golden replays | battle, relief, orders, wounded, economy | every 25 ticks (50 for the economy replay) and 97, N = 300; a tail from 100 |

Wall time is **77–117 s** over the runs made (CLI with `--self-check`, 77 s on a quiet machine,
the high end with a load average of 35–47 from other lanes), and the pnpm-test slice
(`snapshot-witness.test.ts` in `tools`) is 4.6–7.6 s. The three self-checks are mutations of B right
after the restore that must turn their world red (`stProducesFor` reset, `fieldByGoal` emptied,
`trail` zeroed), each preceded by the same series run clean; the CLI fails if a mutation is not red
at any cut.

**The coverage census** (§6.3). Of 197 `state` rows, **116 moved** in the matrix and **81 are
exempt**, each with a reason naming the world that would cover it. The census fails if an exempt row
moves. The groups:
- **30 rows written only at build** (`elevation`, the structure and tunnel tables, evacuation
  points, `stProducesFor`, `woundLive`, `veterancy` and others). A and a fresh B come from one
  config, so B already holds A's value. The pre-restore poison proves the restore writes them in
  every fork; what is missing is a world that holds a non-build value at a cut.
- **19 field-works rows** (sites, `buildSite`, `fwLive`, the aura rows); a field-works mission.
- **placed charges** (`placedLive`, `stChargeTicks`, `stChargeBy`); **beam units** (six rows); the
  **attack order** (`focusTarget`, `focusLost`); **appended waypoints** (five rows); **embarking**
  (`boardGoal`); **ambush and patrol** (eight rows); **smoke and fire support** (`smoke`,
  `smokeCooldown`, `pendingStrikes`, player UI only); **air carriers** (`airWant`, GH-698);
  **a unit or projectile aimed at a structure** (`curStructure`, `prStructure`).
- `runtimeQueue`: never non-empty at any boundary of any witness world (scanned at every tick of
  all five runtime worlds).

The matrix of §6.4 listed more worlds (wounds, field works, air carrier, patrol, beam, placed,
mobility kill); S1 did not build them, and the exemption list is the record of what that leaves
unproved.

**The format pin** (`snapshot-witness.test.ts`): `hashWord` folded over every byte of `encodeSim`
(default, all-zero meta) of the 1000-tick golden battle at tick 500, unsigned: **923693936**. It was
born at 2172139112 and moved once, "Was 2172139112.", when the two queues became `state` (§12.2). The
later header reorder left it unchanged: the pin encodes zero meta, so the permuted header fields are
the same zero bytes in another order. No sim, economy, versus, runtime-digest or net pin moved.

### 12.2 Deviations from §1–§9

1. **The queues are state, and the `boundary` class is gone.** §3.1's assumption that the command and
   runtime queues are empty at the cut is false in an economy room: `MissionRuntime.step` queues the
   rally `attackMove` of a unit it has just delivered after the tick, so about 14 frame boundaries
   per 6,000 ticks hold a queued command, and a producer that skipped them would miss its cadence.
   `commandQueue` and `runtimeQueue` are `state`/`aux` rows in the tail, order preserved, and the
   "commands are still queued" refusal is deleted. `encodeSim` throws a plain `Error` above 64
   queued commands or for a command the decoder would refuse.
2. **`runtimeQueue` never held a command** at any boundary of any witness world, so it is carried
   but unproved dynamically (exempt, with a reason).
3. **Restore is a free function, `restoreSim(sim, bytes)`, not `Sim.restoreState`.** It reaches the
   private fields through one `internals()` cast in `snapshot.ts`. Why: `sim.ts`, shared with other
   lanes, stays nearly untouched. Cost: a renamed private field fails the completeness test and not
   `tsc`. The witness exports are not on the `@lions/sim` index; `tools` imports them by relative path.
4. **The format pin is a 32-bit `hashWord` fold, not SHA-256**: the sim has no SHA-256, and the
   SHA-256 of §5.1 belongs to the net layer (S3 and S4).
5. **The fast witness covers three golden replays, not four.** The economy replay needs a runtime,
   which `snapshot-witness.test.ts` cannot carry across a restore. It is forked only in the tools
   witness, through `tools/src/net/snapshot-runtime-carry.ts`, a **test-only reflection copy** of the
   runtime (and of stateful drivers such as `TunnelPlan`) from A to B after the restore. S2's encoder
   replaces the runtime half; the driver half stays until drivers are stateless. The carry once
   wrote A's sim columns into B through the runtime's `holdView` aliases and repaired eight poisoned
   rows; it rebinds every sim column to B's own now.
6. **The header carries the schema digest and `hasBoulders`.** `count`, `structureCount`,
   `tunnelCount` and the latches are body scalars, not header fields.
7. **The aux rows are canonical JSON, not per-kind binary lists.** `pendingEvents`, strikes, patrol
   leg ids, `stTiles`, the queues and the pool keys share one tail. The tail compresses to 0.9–1.5
   KiB (§12.3).
8. **`trail` and `stProducesFor` are `state`** (§3.1 said so; the sim's `hash()` comment calling
   `trail` derived was wrong and is fixed). `trail` is proved only on the golden battle: the versus
   routes are pre-dug, so no tunnels-arm world stamps it in 24,000 ticks, and a restore bug on a
   versus-only trail path would be unproved until versus routes are dug.
9. **`UnitType.woundedTypeIdx` is a lazy cache written on the `unitTypes` config objects** at the
   first fall. After a wound A's config differs from a fresh B's. It is a pure function of the
   registered types; the witness calls the sim's own resolver on B before `configDiff`. The config
   check is therefore blind to that one cached field.
10. **`encodeSim` can throw a plain `Error`** on a contract fault of its own (a queue over the cap, a
    scalar that is not an i32, a meta string over 256 bytes or with an unpaired surrogate, a meta
    number that is not a u32, an `aux` row with no codec). The S4 producer must catch it, log it and
    skip that cadence, and never let it reach the tick loop.
11. **`SNAPSHOT_FORMAT` stays 1.** No snapshot was ever written in an earlier layout outside this
    branch's tests; the pinned bytes did not move at the header reorder.
12. **`restoreSim`'s "target at tick 0" is a documented precondition, not an enforced one.** S4
    always restores onto a freshly built world; the match digest check catches a misuse.

### 12.3 What a snapshot weighs, as built

Measured on 25 Oct 2026: macOS, Apple M3 Pro, Node 25.9.0, `tsx`, one process, no browser, the
machine otherwise quiet (1-minute load average 3.2 at the start). The worlds are the witness's own
builders (`economyWorld`, `mirrorWorld`, `stressWorld`, `goldenBattle`), played as `playEconomy` and
the versus probe play them, 24,000 ticks without stopping at an outcome. The meta was a 12-byte build
and a 6-byte matchId. The bytes are the **sim alone**: the runtime of an economy room is S2's, so
the economy rows exclude the 2.7–3.5 KiB gzipped §2.2 measured for it. Gzip is `zlib` level 9,
brotli is quality 11.

| Case | Tick | count / cap | Pool | Raw | gzip -9 | brotli | §2.2 estimate: gzip / brotli |
|---|---|---|---|---|---|---|---|
| golden battle (1000-tick replay) | 500 | 26 / 128 | 20 | 147.0 KiB | 2.5 KiB | 2.2 KiB | none |
| economy tel_marum KDF/Sarim 1000 | 24,000 | 84 / 256 | 128 | 207.2 KiB | 6.3 KiB | 4.9 KiB | 3.6 / 3.0 |
| economy wadi_tarfan KDF/Sarim 8919 | 24,000 | 108 / 256 | 128 | 207.4 KiB | 8.7 KiB | 6.7 KiB | 4.5 / 3.7 |
| economy wadi_tarfan Sarim/KDF 16838 | 24,000 | 78 / 256 | 128 | 207.5 KiB | 7.2 KiB | 5.6 KiB | 4.3 / 3.6 |
| mirror tel_marum 1000 | 24,000 | 46 / 256 | 89 | 205.3 KiB | 4.9 KiB | 3.8 KiB | 2.3 / 2.0 |
| mirror milh_flats 8919 | 24,000 | 45 / 256 | 96 | 205.6 KiB | 5.7 KiB | 4.6 KiB | 3.5 / 3.0 |
| stress tel_marum 1000 | 600 | 256 / 256 | 256 | 212.6 KiB | 15.4 KiB | 11.3 KiB | 14.5 / 10.9 |
| stress tel_marum 1000 | 1,200 | 256 / 256 | 256 | 212.7 KiB | 15.7 KiB | 11.3 KiB | none |
| stress wadi_tarfan 8919 | 600 | 256 / 256 | 256 | 212.8 KiB | 15.6 KiB | 11.4 KiB | none |
| stress wadi_tarfan 8919 | 1,200 | 256 / 256 | 256 | 212.9 KiB | **16.1 KiB** | 11.6 KiB | 15.2 / 11.3 |

(The table's economy and mirror counts differ from §2.2's, 76/84/72/43/48, because the witness's
drivers are the `playEconomy` ones and the probe's were its own.)

- **Raw is 205–213 KiB against §2.2's 231 KiB "full".** The 231 included the scratch columns, which
  the snapshot does not carry. The prefix figures of §2.2 (77–107 KiB) do not apply: S1 writes full
  length.
- **Compressed, the small matches are 1.6–2.1× the probe's gzip, and the stress world is 1.06×.**
  The stress world has `count` = capacity, where the probe's prefix and S1's full length are the
  same bytes, so the small-match gap fits §3.2's choice of full-length columns plus the tail. I did
  not bisect it further. In the economy tel_marum cell the columns alone gzip to 5.1 KiB and the
  JSON tail (raw 6.1 KB, of which the pool keys are 5.9 KB) to 0.9 KiB; in the stress world 13.5 and
  1.4 KiB (separate streams; the whole snapshot compresses to a little less than their sum).
- **The 16 KiB budget of §2.2 holds with no margin.** The largest reading, wadi_tarfan at t = 1,200,
  is 16.1 KiB gzipped and 11.6 KiB brotli. S3 must not size its cap at exactly 16 KiB. The room's
  limits (2 MB a row) are far away.
- **Cost, median of 5, same conditions:**

| Case | `encodeSim` | `restoreSim` including the pool rebuild | Pool |
|---|---|---|---|
| golden battle, tick 500 | 0.94 ms | 5.1 ms | 20 slots |
| economy tel_marum, tick 24,000 | 1.16 ms | 19.4 ms | 128 slots |
| stress tel_marum, tick 600 | 1.25 ms | 39.0 ms | 256 slots |
| stress tel_marum, tick 1,200 | 1.23 ms | 38.0 ms | 256 slots |

  The restore time tracks the pool's slot count (5, 19 and 39 ms at 20, 128 and 256 slots), and §2.3's
  restore without the pool was a few ms. §2.3's 10–68 ms for a poisoned restore is the same range. The restored world's hash
  equalled A's in every timed restore. These are Node timings of the sim alone; the browser's cost
  is S4's to measure (§2.2).


## 13. S2 as built (25 Oct 2026)

Stage 2 is the runtime half: `MissionRuntime` and everything it owns, encoded into the snapshot and
restored from it, with the fork witness and the tools witness carrying it. After S2, an economy room
(the KDF v Sarim headline match) is snapshottable end to end. Where §12 or an earlier section says
otherwise, this one wins. The deviations (§13.2) are the part S3 and S4 must read.

### 13.1 What landed

**Schema** (`packages/sim/src/runtime-snapshot-schema.ts`). Every one of the 98 own properties of
`MissionRuntime` has exactly one row, in creation order, and the 18 records it owns each have a row
set (`RUNTIME_ROW_SETS`). A completeness test reflects over the live runtime in both directions, as
S1's does for `Sim`, and checks each row's kind against the live value.

| Table | Rows | state | config | scratch | derived |
|---|---:|---:|---:|---:|---:|
| `MissionRuntime` | 98 | 70 | 20 | 8 | 0 |
| 18 owned row sets | 81 | 39 | 35 | 6 | 1 |
| All | 179 | 109 | 55 | 14 | 1 |

The owned row sets, with their row counts: `ObjectiveState` 4, `PatrolState` 3, `CivilianFlight` 4,
`ZoneIncomeState` 9, `ConvoyRoute` 3, `ConvoyEntry` 2, `CorridorField` 2, `HoldView` 14,
`RouteSource` 5, `TileScratch` 2, `IncomeRead` 3, `WorksEntry` 2, `WorksOffer` 6, `WorksCharge` 6,
`WorksStructure` 3, `ProductionLine` 6, `LineItem` 5 and `Rally` 2. The one `derived` row is
`CorridorField.field`, a `FlowField`. The kind union reuses S1's `typed` and `scalar` and adds
`array`, `set`, `map`, `record`, `ref`, `string`, `number` (a display float, scratch only), `flowfield`,
`json` and `aux`. A `scalar` can be a boolean, and ten rows are; a `ref` can name a Sim column, and
ten rows do. Every `scratch` row and every `config`
row carries its evidence (a `mission.ts` read/write argument) in the schema's comments, and the rule
for a doubtful property is the one S1 used: `state`.

**The 24 reference rules** (`RUNTIME_REF_RULES`). The runtime aliases heavily, and a copy that
breaks an alias is a silent divergence. A census walks the runtime along its schema, every class,
against everything reachable from the Sim, the mission and the context, and names any object reached
by two paths unless a rule owns it. A rule is `{ path, owner, key, into?, identity?, note }`, and the
24 split as:

| `key` | Rules | Meaning |
|---|---:|---|
| `config` | 16 | the other side is the Sim, the mission, the context or a config row: rebuilt by the constructor, never encoded (`HoldView` and `RouteSource` columns, `zoneRects`, `ObjectiveState.def`, the constructor arguments) |
| `self` | 3 | the alias IS the owner (`ConvoyRoute.route`, `ConvoyRoute.cutSpan`, `ZoneIncomeState.cutSpan`) |
| `index` | 2 | an element of the owner array (`ZoneIncomeState.route` into `zoneRoutes`, `WorksEntry.offer` into `worksOfferList`) |
| `ctxIndex` | 2 | a state row whose values are objects of the context's ledger roster: `rosterPool` and `entityRoster` |
| `closure` | 1 | a function captures the owner: `RouteSource.fieldFor` closes over `corridorFields` |

`ctxIndex` came out of review. The roster rows are state (the pool is spliced, the map grows), but
their values are the very objects of `ctx.ledger['roster.surviving_units']`, which the runtime never
mutates. They are encoded as indices into that array and re-linked to the rebuilt context's elements
on restore, which preserves identity and loses no state. `identity: 'in-place'` on the closure rule
says that `corridorFields` must be cleared and refilled, never reassigned, because
`routeSource.fieldFor` holds the Map object. `probeClosures` proves it on a restored runtime: it asks
the closure for a field and requires the entry to land in the runtime's own Map. A spec reads
`mission.ts` and requires the constructor's captures to be exactly that one.

**The runtime section** (`packages/sim/src/runtime-snapshot.ts`). After S1's tail, `u32 length` and
canonical JSON of the runtime's `state` rows, only when `hasRuntime` is 1; at most
`MAX_RUNTIME_BYTES`, 4 MiB. It is built by walking the schema, never by reflection. Records are
sorted-key objects, typed arrays are integer arrays, and Maps and Sets are written in **insertion
order**, never sorted: iteration order is part of the shape (a Map filled in reverse restores in
reverse, which a dedicated spec pins, because no replay iterates those Maps in a way the hash sees).
References are written as the rules say (an index, an "is the owner" boolean, or a ledger index).
Config rows are never written. `corridorFields` is written as `[goal tile, { stamp }]` pairs; the
`FlowField` is derived and not written.

**Header** (`packages/sim/src/snapshot.ts`). The fixed block grows from 39 to **44 bytes**: `hasRuntime`
u8 and the runtime schema digest u32, after `hasBoulders`. `matchDigest` is still at
`SNAPSHOT_MATCH_DIGEST_OFFSET` (10), and a spec pins both numbers. The runtime digest is 0 when there
is no runtime, so a sim-only snapshot does not depend on the runtime table. The digest is the sim's
own `hashWord` folded over every `MissionRuntime` row, every owned row set and every reference rule,
computed lazily and cached because `snapshot.ts` and `runtime-snapshot.ts` import each other.

**Restore is plan-then-apply.** `restoreSim(sim, bytes, runtime?)` runs the S1 steps, then:
1. the header checks, before any write: `hasRuntime` is a flag, present in both snapshot and target
   or in neither (two distinct reasons), digest 0 on a sim-only snapshot, the digest equals this
   build's, and the runtime is this sim's own;
2. the framing: a length word under the cap, exactly that many bytes, then S1's "trailing bytes";
3. `planRuntime` decodes and validates the **whole** section against the target before its first
   runtime write, and refuses with `SnapshotRefused` on: wrong rows, a non-canonical text, wrong record
   fields, a kind mismatch (boolean for integer, a closed string set, i32 range), typed-array length
   by its rule and element range by constructor, array counts the target's own setup fixes
   (objectives, income zones, triggers, waves, lines, works), repeated Set members and Map keys,
   entity ids outside `0..capacity-1`, score and zone state ranges, patrol waypoints, `ventsKnown`
   within the tunnel count, route tiles within the map, corridor keys and stamps, reference indices
   in range, ledger indices inside the ledger, objective ids and unit ids the world knows (the unit
   catalogue is asked per **side**), and works offers' `left` within `0..max`;
4. `apply()` writes: contents replaced, identity kept (Maps and Sets cleared and refilled, typed
   arrays `set`, arrays resized in place, records written field by field), then references re-linked,
   then `corridorFields` rebuilt.

A runtime section refused at plan time leaves the target runtime byte-equal (a spec). The S1 sim
half has already been written by then, so a refusal still means "discard the target and build
another", as in §12.1. A seeded fuzz of 1,000 mutations over a snapshot (truncation, bit flips,
oversized lengths, garbage with a consistent length, appended bytes, random JSON edits, header flips)
is each a clean `SnapshotRefused` or a world whose re-encoding is the mutated bytes, with no
`ArrayBuffer` growth past 4 MiB.

**Encode validates itself.** `encodeSim` plans the section it has just written against the source. A
section the decoder would refuse is a plain `Error`, never a snapshot.

**`corridorFields` stays `state`** and is rebuilt on restore over the runtime's own mask copies. The
runtime computes every corridor field inside `recheckCorridors`, right after `syncTerrain()`, i.e.
over `seenVehicle` and `seenElevation`, not over the Sim's masks. The first cut of the restore used
the Sim's masks and was wrong: a works site staked and cancelled inside one 20-tick recheck window
moves the Sim's masks without bumping `terrainVersion`, and the field contents are not encoded, so no
byte comparison and no fork saw it until a spec built that window. The restore now computes with the
same `compute` call `fieldFor` makes, over the restored copies, for each entry whose stamp equals the
restored `terrainVersion`; a stale entry stays uncomputed because `fieldFor` recomputes it whole
before any read. A plan-time check refuses corridor entries in a world that keeps no mask copies.
Whether `corridorFields` could be `derived` (cleared and refilled on demand) was measured, not
argued: clearing it in B keeps the match hash and the runtime digest equal for 200–250 ticks at the
golden economy, the relief economy and the sink world, including the staking window, so clearing is
neutral **today**. It stays `state` because the rule for a doubtful property is `state`, because the
neighbouring shape (a current entry left uncomputed) does diverge, and because a restore that
computes over the wrong masks is invisible to the bytes. A switch to `derived` needs a positive
control the neutrality spec does not have yet (the schema row's comment says what).

**The fork witness carries the runtime** (`packages/sim/src/snapshot-witness.ts`). A world may hold a
`runtime`; the default hash folds `runtime.digest()` into the sim's hash. B's runtime `state` rows are
**poisoned before the restore** (95 schema paths over six world cuts; the ten it cannot reach are
rows of records that are Map values, replaced wholesale), the round trip at T and the end comparison
cover the runtime, every `config` row of A is compared with B's (`runtimeConfigDiff`, nested rows
included), and with `poison: true` the runtime's `scratch` rows and any stale corridor field are
garbled after the restore and must not matter. A B that cannot be encoded is a red verdict, not an
exception. The runtime joined the fast witness: the golden economy and relief economy replays are
forked in `pnpm test:determinism` (every 100 ticks to 2,200, horizon 200, poison on), which grew
from 83 to 107 tests and from about 3.5 s to about 7 s of wall time. Six self-checks that must stay red: a purse reset, a
line queue emptied, `entityRoster` and `rosterPool` re-linked to copies (red through the encoder's
refusal, with the hash blind), a `civFlight` latch cleared, and `corridorFields` cleared (red through
the encodings, with the hash blind in all four worlds).

**The tools witness uses the real restore** (`tools/src/net/snapshot-witness.ts`). The reflection
copy of the runtime from A to B (§12.2 item 5) is deleted: the five runtime worlds (the three economy
cells and the tunnels arm at 24,000 ticks, and the golden economy) run their forward runs on the real
restore. Only a *driver* carry remains (`snapshot-driver-carry.ts`, formerly `-runtime-carry`), for
stateful drivers such as `TunnelPlan`, with a guard: it throws before writing into any typed array
the target's runtime or Sim reaches. A fourth self-check there empties a production line's queue on
B. The census (§6.3) now counts the runtime's rows: **267 state rows (197 sim, 70 runtime), 156
moved, 111 exempt (81 sim, 30 runtime)**. The 30 exempt runtime rows are the ones no witness world
ever moves (placement groups, tags, patrol stances; civilian flight; the ROE score and promotion
tally; field works; the side-1 buy cursor, intel marks, wound rescue and high-ground rises; the
ledger roster; the mission script and its end), each with a reason naming the world that would
cover it. Their restore is still proved in every fork by the pre-restore poison. The exemption's
demotion rule is S1's: an exempt row that moves fails.

**The format pin** (`snapshot-witness.test.ts`) moved once, in its own commit: **Was 923693936.**,
now **3686246844**. The pinned world has no runtime, so only five new zero bytes (offsets 39–43)
entered the encoding; cutting exactly those five bytes from the new encoding and re-hashing gives
923693936 (checked, not assumed). No sim, economy, versus, runtime-digest, balance, playtest or net
pin moved.

### 13.2 Deviations from §1–§12

1. **`worksList` and `worksOfferList` are built lazily by a UI read** (`worksOffers()`, the dock's
   per-frame read), so two peers can differ only by whether the dock was read. Both are encoded
   canonically as the **built** form: an unbuilt list encodes as the freshly built default, through
   the runtime's own builder, without building the source. Restore builds with `works()` and writes
   the offers' `left`. Peers' bytes agree whatever the dock did, which D1's two-seat SHA needs. If
   the lazy build ever depends on state, this stops being sound; the planner throws a plain `Error`
   if either record gains a state reference row, because it plans against a throwaway build.
2. **Strings are JSON, not type-table indices.** Unit ids, objective ids and event kinds are written
   as text in the canonical JSON. An indexed form would be smaller raw; it was not built because the
   section is 15.7–18.9 KiB raw and compresses to 1.1–2.1 KiB gzipped (§13.3).
3. **Restore is a free function pair, `planRuntime(...).apply()`, not `MissionRuntime.restoreState`.**
   Same reason as §12.2 item 3: `mission.ts` is shared with other lanes. The codec reaches private
   members by casts; a renamed private member fails the completeness test and not `tsc`, **and the
   codec relies on production builds not mangling property names**.
4. **One change to `mission.ts`: `works()` now stores the result of a new private pure `buildWorks()`**
   (same body, locals instead of stores, offers pushed after the loop). It is reachable from tick
   code but behaviour-identical, and no pin moved.
5. **`SNAPSHOT_FORMAT` stays 1 though the header grew**, by §12.2 item 11's reasoning (no snapshot
   was ever written in the old layout outside this branch's tests). `snapshot.test.ts` pins it.
6. **`encodeSim` can throw** for a runtime it cannot encode (a re-linked alias, a section the decoder
   would refuse, one over 4 MiB), as it can for the sim (§12.2 item 10). **S4's producer must catch
   it, log it and skip that cadence**, never let it reach the tick loop.
7. **`restoreSim` does not check `build` or `matchDigest`.** Both are the caller's job (§5.1: the
   room reads `matchDigest` at offset 10 without a decoder; `build` is meta), and S4 must do them
   before any restore.
8. **A codec range change does not move the runtime schema digest.** The digest folds names,
   classes, kinds and rules. The semantic range tables in `runtime-snapshot.ts` (`ENTITY_PATHS`,
   `NONNEG_PATHS`, `FIXED_RANGE`, `ENTITY_CAPPED`, `FIXED_COUNT_PATHS`) are not in it. A change to
   one of them that accepts or refuses a different set does not move the digest, so **the `build`
   check, not the digest, scopes a snapshot to the codec that wrote it**. A new runtime row with an
   entity-id scalar needs an entry in the tables or is validated only as an i32.
9. **The tools census sees top-level runtime rows only.** Rows nested in records (a production
   line's `rally`, a zone's `cut`) are not named by it; nested runtime rows are S5's.
10. **§12.2 item 5 is superseded.** The reflection carry of the runtime is gone, and the economy
    replay is forked in the fast witness. What remains of the carry is the driver half.
11. **Found by the witness, fixed in S2:** `planRuntime` asked `ctx.unitInfo(unit)` without a side,
    and a versus room's catalogue keys its menus by side, so every versus economy cell crashed on its
    first restore. No Task 3 spec restored a versus room's runtime. The catalogue is asked per side
    now, with a spec.

### 13.3 What a snapshot weighs, with the runtime

Measured on 25 Oct 2026: macOS, Apple M3 Pro, Node 25.9.0, `tsx`, one process, no browser. **The
machine was not quiet**: the 1-minute load average was 48–63 at the start of the two runs (other
sessions' lanes), 61–80 at the end, so the **times** below are inflated, perhaps 2–4× against §12.3's
quiet run. The sizes do not depend on load. The worlds are §12.3's builders (`economyWorld`, played as
`playEconomy` plays them, 24,000 ticks without stopping at an outcome) and the golden economy
replay at its end (tick 2,400); the meta is a 12-byte build and a 6-byte matchId. Gzip is `zlib`
level 9. "Sim only" is `encodeSim(sim, meta)`; "whole" is `encodeSim(sim, meta, runtime)`; "runtime"
is `encodeRuntimeSection`, which the whole contains.

| Case | Tick | Sim only: raw / gz | Whole: raw / gz | Runtime: raw / gz | Fields | Pool |
|---|---:|---|---|---|---:|---:|
| economy tel_marum KDF/Sarim 1000 | 1,200 | 205.3 / 5.9 KiB | 223.1 / 7.6 KiB | 17.7 / 1.5 KiB | 1 | 89 |
| | 6,000 | 207.2 / 6.3 | 224.3 / 7.8 | 17.1 / 1.4 | 1 | 128 |
| | 24,000 | 207.2 / 6.3 | 224.3 / 7.9 | 17.1 / 1.4 | 1 | 128 |
| economy wadi_tarfan KDF/Sarim 8919 | 1,200 | 206.1 / 7.2 | 224.9 / 9.5 | 18.8 / 2.0 | 5 | 102 |
| | 6,000 | 207.4 / 8.8 | 225.7 / 10.9 | 18.2 / 1.9 | 5 | 128 |
| | 24,000 | 207.4 / 8.7 | 225.7 / 10.8 | 18.3 / 1.9 | 5 | 128 |
| economy wadi_tarfan Sarim/KDF 16838 | 1,200 | 206.1 / 7.0 | 225.1 / 9.3 | 18.9 / 2.1 | 5 | 103 |
| | 6,000 | 207.5 / 7.2 | 226.0 / 9.4 | 18.5 / 2.0 | 5 | 128 |
| | 24,000 | 207.5 / 7.2 | 226.0 / 9.4 | 18.5 / 2.0 | 5 | 128 |
| golden economy replay | 2,400 | 105.1 / 1.5 | 120.8 / 2.7 | 15.7 / 1.1 | 1 | 7 |

("Fields" is `corridorFields.size`; "Pool" is the flow-field pool's slot count.)

- **The runtime adds 15.7–18.9 KiB raw and 1.1–2.1 KiB gzipped.** The whole snapshot is 7.6–10.9 KiB
  gzipped in the economy cells, 2.7 KiB for the replay. §2.2 estimated 2.7–3.5 KiB gzipped for the
  runtime; the as-built section is smaller than that, by about a third.
- **The §2.2 budget of 16 KiB gzipped holds for the economy matches measured** (10.9 KiB at worst).
  S1's 16.1 KiB gzipped stress world has no runtime, and none was measured at capacity with one;
  adding the runtime's roughly 2 KiB gives about 18 KiB, by addition and not by measurement. **S3
  must not size its cap at 16 KiB**: that is §12.3's warning, now with a number behind it.
- **Cost, median of 5 per cell, two runs:**

| Case (tick 24,000 unless stated) | `encodeSim` with runtime | `restoreSim` with runtime, including the pool and corridor fields |
|---|---|---|
| economy tel_marum | 1.85–1.97 ms | 43.6–48.3 ms |
| economy wadi_tarfan KDF/Sarim | 4.07–4.47 ms | 89.5–120.5 ms |
| economy wadi_tarfan Sarim/KDF | 1.89–7.74 ms | 142.9 ms in both runs |
| golden economy replay, tick 2,400 | 1.27–1.67 ms | 3.6–18.0 ms |

  Under that load the figures scatter (the 1,200-tick wadi_tarfan Sarim/KDF restore read 80.8 and
  127.8 ms in the two runs, and 32.6 ms at 6,000 ticks in the first), so read the encode as 1–8 ms and
  the restore as a few tens of milliseconds, dominated by the pool rebuild as in §12.3, not as the
  figures. The quiet-machine numbers of §12.3 (restore 19 ms at 128 slots) are the better estimate
  for the browser-side budget, which is S4's to measure. The runtime's own share is the self-validation
  in `encodeSim` (the section is planned against the source) and the JSON, about 0.8 ms in the
  replay on a quiet machine.
- `pnpm test:determinism` runs 107 tests (3 files) in about 7 s of wall time (6.8 s by vitest, 7.6 s
  by the clock). `pnpm snapshot:witness -- --self-check` is in §13.4.

### 13.4 Gates

All run on the branch tip, alone (never beside the witness CLI), on the same loaded machine as §13.3
(load average 14–84 over the runs). No pin moved: the format pin is 3686246844, and the golden, relief,
order-done, economy, wounded, runtime-digest, versus and net pins are unchanged.

| Gate | Result |
|---|---|
| `pnpm test` | 828 files, 16,074 passed, 1 skipped, 0 failed (111 s on the passing run; one earlier run under load 60 failed `tools/src/net/arena-signal.test.ts`, which passes alone and again in the full run, and touches nothing of this branch) |
| `pnpm test:determinism` | 107 passed (3 files), 11 s wall under load, 7 s quiet |
| `pnpm lint`, `pnpm typecheck` | clean |
| `pnpm validate:data` | 169 files, passed |
| `pnpm balance` | all targets met |
| `pnpm playtest` | exit 0 |
| `pnpm snapshot:witness -- --self-check` | exit 0, **86 s wall** (84.6 s by its own clock, 6.6 s of it the four self-checks, all RED as required with a clean control green) at a load average of 84; 267 state rows (197 sim, 70 runtime), 30 runtime rows exempt |
