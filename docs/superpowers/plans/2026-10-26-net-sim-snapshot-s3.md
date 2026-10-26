# Net sim snapshot, stage 3 (the room): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The `MatchRoom` accepts a snapshot only when both seats upload the same decompressed bytes
for a snapshot tick whose match digest the room has already seen agreed, and only when the digest in
the snapshot's header equals that agreed value. It keeps the latest accepted snapshot in one row and
hands it to a seat on request. A `hello` may carry `from`, and the room then answers with the log
from that tick only. A content mismatch is reported to D1 and never voids the match (D3). The
client (the producer and the rejoin path) is S4's. S3 ships only the one-line client half of D6.

**Architecture:**
- **`packages/net`** carries everything both ends share:
  - the config field `snapshotEveryTicks` and `isSnapshotTick` (`config.ts`);
  - `hello.from` and the `log.from` echo (`protocol.ts`);
  - a new `snapshot-wire.ts` with the caps, a capped gunzip, SHA-256 and a fixed-offset header
    reader. The room never decodes a snapshot.
  - Compression and SHA-256 live here, outside the sim, as §3.2 and §8 require. S4's client reuses
    them.
- **`packages/worker/src/match`** holds the room's side:
  - `snapshot-intake.ts` is a pure module with the tick rules and the pending book, like
    `room-core.ts`;
  - `match-room.ts` gains the `POST`/`GET /snapshot` handlers, the one-row `snapshot` table,
    `readLogFrom` and the memory-only agreed digests;
  - `room-core.ts` gains one `Effect` kind, `agreed`, and the `from` echo in `logParts`;
  - `snap-mismatch-log.ts` writes the D1 row;
  - `routes.ts` gains the public route.
- **Where the work happens.** The Worker route checks Origin, the rate limit, the ticket (a seat of
  this code) and the compressed size, before any Durable Object wakes. The DO checks all of them
  again, then inflates under a ceiling, hashes, reads two header words at fixed offsets, and decides.
  The spec (§5.1) puts the SHA in the DO, and the DO is what the `fake-do` tests drive.

**Tech Stack:** TypeScript strict, vitest, `@lions/net`, the Worker's `fake-do.ts` and `test-d1.ts`
(node:sqlite). Web platform only: `DecompressionStream`, `CompressionStream` and `crypto.subtle`
exist in workerd, browsers and Node 22+. No new dependency.

**Spec:** `docs/superpowers/specs/2026-10-25-net-sim-snapshot-design.md` (lead-approved, D1–D7 as
recommended):
- the binding sections are §4.2, §5.1–§5.5, §7 and the §9 S3 row;
- §12.3 and §13.3 hold the sizes: 16.1 KiB gzipped measured sim-only, about 18 KiB with the runtime
  by addition, so **the cap is never 16 KiB**;
- §13.2 items 6 and 7 are S4's, recorded under "Handed to S4" below.

**Base:** `origin/main` `a5f70364` (v0.128.2, S1 and S2 landed: PRs 808 and 823). Line numbers are
hints only, so find code by its symbol. No GH issue exists for the snapshot work (spec header). Write
`GH-NNN` if the lead opens one.

**History checked (26 Oct):**
- `gh pr list --state all --search snapshot` finds the spec (799), S1 (808) and S2 (823), all
  merged. Nothing of S3 exists.
- No open PR touches `packages/worker/src/match`, `packages/net/src/protocol.ts` or `config.ts`.

---

## Global Constraints (bind every task and every child)

- **G-1. No sim change, no pin moves.**
  - Nothing under `packages/sim/` is edited. The frame-tick offset is derived in `net` and pinned
    against the real `encodeSim` (Task 3), so `sim` needs no new export.
  - The golden, economy, runtime-digest, versus, mirror and net pins, the snapshot format pin
    (3686246844), `pnpm balance`, `pnpm playtest`, `LADDER_CREDITS` and `ROSTER_MAX` stay where
    they are. If one moves, STOP and report.
  - `pnpm test:determinism` still runs before every commit, because `net` imports `sim`.
- **G-2. The room stays a relay.**
  - It reads exactly four header fields: the magic, `format`, `matchDigest` (offset 10) and
    `frameTick` (offset 18).
  - It never parses anything further, never imports the sim decoder, and never runs a sim.
  - `encodeSim` appears only in `packages/net` tests.
- **G-3. A public write endpoint.**
  - Origin is required.
  - A per-IP rate limit (`SNAP_LIMIT`) applies.
  - Auth is a **seat** ticket of this match code in `Authorization: Bearer <ticket>`. It is never in
    the query string, never an advisor ticket, and is checked in the Worker and again in the DO.
  - Caps: 64 KiB compressed, 1 MiB inflated.
  - **No storage write before acceptance.** A held, refused or mismatched upload writes zero DO
    rows.
  - A code with no room touches no storage at all (GH-559 H-1: `hasTable` stays false and
    `rowsWritten` stays 0).
  - The DO holds at most two snapshot ticks × two seats of pending bytes in memory, 256 KiB at
    most.
- **G-4. Workers Free budget.**
  - An accepted snapshot costs exactly one DO row (`INSERT OR REPLACE`, one row per room, replaced
    each time), and the wipe deletes it.
  - D1 rows are bounded per room instance and per day (Task 9).
  - The R-N12 bounds in `room-loop.test.ts` are re-measured with uploads running (Task 13).
- **G-5. Back-compat.**
  - A `hello` without `from` gets today's log, byte for byte (a pinned test).
  - A config without `snapshotEveryTicks` is valid and means "off". A room persisted before this
    change keeps working.
  - Old clients ignore the new optional fields. No `MatchConfig` literal elsewhere in the tree needs
    editing: there are 27 files with one.
- **G-6. Concurrency in the DO.** A non-storage `await` (body read, inflate, SHA, HMAC) releases the
  input gate. Every check that guards a write is **re-run after the last await**, against `this.st`
  and the instance's own memory, never against a local read before it. The `/create` and `/join`
  comments in `match-room.ts` record why.
- **G-7. Every new check gets an input that makes it fail**, constructed, run and seen red, then
  reverted by an edit. The commit message names the falsification and quotes its red line. A
  one-line mutation of the implementation is the preferred form. Oracles take literals, never values
  imported from the code under test.
- **G-8. House rules**, in every brief:
  - never pkill or killall;
  - port 5177 is off-limits;
  - no browser, no `ui:routes`, `golden-baseline` or `ui:shots`;
  - never `git add -A`, so commit with `git commit -m "…" -- <paths>`;
  - never `git checkout <file>`;
  - write issue refs as GH-NNN;
  - **no deploys, no secrets, no `wrangler` command, no D1 migration applied anywhere but the
    node:sqlite test DB**;
  - commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **G-9. The repo is public.**
  - Code comments, commit messages and the PR state what a limit is and that it is tested, never
    how to defeat it.
  - Security-review findings go to the ledger (`_coord/net-snapshot-s3-progress.md`), not the repo.
- **G-10. Children and tests.**
  - One Sonnet implementer per task, `model` passed explicitly, in the foreground, and it dispatches
    no subagents.
  - One Sonnet reviewer per task. An Opus reviewer runs Task 14 (security) and the final review.
  - No sim-guard is needed, because nothing in `packages/sim` changes. If a diff ever touches it,
    add one.
  - Every implementer runs the **full `pnpm test`** before reporting, not only its own files (the
    S2 lesson: a guard stayed red for three tasks).
  - Every heavy new test gets an explicit, measured timeout.

---

## The wire contract (decided here; every task builds to it)

**Public routes** (`routes.ts`; `withSecurityHeaders` wraps both as today):

| Route | Auth | Body / reply |
|---|---|---|
| `POST /api/match/:code/snapshot` | Origin; `SNAP_LIMIT`; `Authorization: Bearer <seat ticket for :code>`; `X-Snapshot-Tick: <frame tick>` | body: the gzip bytes (`application/octet-stream`), at most `SNAPSHOT_MAX_COMPRESSED_BYTES` |
| `GET /api/match/:code/snapshot` | Origin; `SNAP_LIMIT`; `Authorization: Bearer <seat ticket for :code>` | `204` none; `200` with the stored gzip bytes, `X-Snapshot-Tick`, `X-Snapshot-Sha` (64 lowercase hex characters of the **inflated** bytes) and `X-Snapshot-Digest` (the agreed match digest as an unsigned decimal), plus `Cache-Control: no-store`. No `Content-Encoding`: the client inflates the bytes itself. |

The Worker forwards to the DO as `https://room/snapshot`, with the same method, the
`Authorization` and `X-Snapshot-Tick` headers, and the body bytes.

**DO checks for a POST, in this order (cheap before costly; no write before the end):**

| # | Check | Refusal |
|---|---|---|
| 1 | a room exists (`route` already answers `404` for no `st`) | 404, no storage touched |
| 2 | `Authorization` is present and `Bearer ` prefixed | 401 |
| 3 | `verifyTicket` passes, `matchId === st.matchId`, `role === 'seat'` | 403 |
| 4 | `st.status` is `running` or `stalled`, `config !== null`, `snapshotEvery(config) > 0` | 409 `not_running` |
| 5 | `X-Snapshot-Tick` is a decimal integer | 400 |
| 6 | `admitTick` (Task 8): a snapshot tick, `< st.tick`, `> storedTick`, inside the window | 409 `stale` |
| 7 | no pending upload from this seat for this tick | 409 `duplicate` |
| 8 | declared `Content-Length` ≤ cap, then `readCapped(cap)` | 413 |
| 9 | `gunzipCapped(body, SNAPSHOT_MAX_RAW_BYTES)` | 413 (`too_large`) or 400 (`bad_gzip`) |
| 10 | `readSnapshotHeader`: magic, `format === SNAPSHOT_FORMAT`, `frameTick === declared tick` | 400 |
| 11 | `sha256Hex(inflated)` | — |
| 12 | **re-run checks 4, 6 and 7** (G-6), then record the pending upload | as above |
| 13 | `decide` (Task 8): `stored` (one row written), `held`, or `mismatch` (D1 row, both dropped) | 201 / 202 / 409 `mismatch` |

---

## Rulings on spec ambiguity (made in this plan; the lead may overturn any)

1. **The SHA and the inflate run in the DO**, as §5.1 says. The Worker also refuses bad Origin, rate,
   ticket and size first, so a forged request never wakes a DO.
2. **The tick travels in `X-Snapshot-Tick`** and is cross-checked against the `frameTick` inside the
   bytes (offset 18). The declared value lets the stale and duplicate refusals run before any
   inflate. The offset is `SNAPSHOT_MATCH_DIGEST_OFFSET + 8` (`contentDigest` sits between), pinned
   in `net` against the real encoder. No sim edit.
3. **The agreed digest reaches the DO as a new `Effect`**, `{ kind: 'agreed', tick, h }`, emitted by
   `room-core`'s `hash` case when a pair agrees on a snapshot tick. It is memory only, and the DO
   keeps the two newest. An eviction forgets it. That tick can then never be accepted, and the next
   cadence can. §5.1 says "one integer"; two cover an upload that lands after the next agreement.
4. **The stale window.** Only the two newest snapshot ticks below `st.tick` are admissible. An older
   one is `stale`, which also refuses an S4 client still catching up.
5. **Signedness.** The room's hash values are signed int32 (`Math.imul`), and the header's
   `matchDigest` is a u32. They are compared as `(h >>> 0) === headerDigest`. S4 must write
   `meta.matchDigest = digest >>> 0`, because `u32Meta` refuses a negative.
6. **`snapshotEveryTicks` is optional on the wire**: absent is 0, which is off. The room mints
   `SNAPSHOT_EVERY_TICKS` (1,200) in **every** room, sandbox included. `MatchRoomOptions` gains
   `snapshotEveryTicks` for tests and the local relay. workerd never passes it.
7. **Seat 0's compressed body is the one stored.** Both inflate to the same SHA, and the choice is
   arbitrary but fixed.
8. **A digest mismatch also writes a D1 row.** That is when the SHAs are equal but the header
   digest differs from the agreed one. The table has a `kind` column, `sha` or `digest`. §5.2 names
   only the SHA case. The digest case is the same kind of bug, an encoder or caller fault.
9. **The D1 budget.** At most 3 `snap_mismatch` rows per room instance and 100 a day in all, kept
   180 days (`RETENTION_MS`) and purged by the daily cron beside `purgeDesyncs`.
10. **`from` is honoured at all three log sites**: a seat's `hello`, an advisor's `hello`, and the
    ended-room replay (`mayReplay`).
    - `from > st.tick` answers one empty part, because an eviction can leave the room behind a
      client (`revive` re-mints empty ticks).
    - A `log` answered from `from` echoes `from` in every part, so S4 can tell a trimmed log from a
      full one.
11. **The D6 client half is in S3.** `WsTransport` sends `from: clock.newest + 1` on a reconnect that
    still holds its clock. D6 rules "Yes, in S3", and `room-loop.test.ts` is the only end-to-end
    witness of the room's half. §9's table lists `ws-transport.ts` under S4 for the reload path,
    which stays S4's.
12. **Its own rate limiter**, `SNAP_LIMIT`, at 12 a minute per IP, not `ROOM_LIMIT`'s 6. Two seats
    behind one home NAT upload once a minute each, plus a rejoin's GET and a retry.
13. **`GET` is seat-only.** An advisor ticket is refused. A seat may GET while the row exists, which
    includes an ended room before its wipe. A lobby answers 204. The bytes hold nothing a seat's own
    log does not already give it: lockstep clients hold the full state.
14. **The caps are §7's**: 64 KiB compressed and 1 MiB inflated.
    - 64 KiB is 4× the 16.1 KiB measured (§12.3) and about 3.5× the ~18 KiB with the runtime (§13.3).
    - Task 13 gates the headroom: measured ≤ cap / 2 at the browser's default gzip level.

---

## Pre-flight conflict table

| Pair / task | Produces → consumes | Finding | Ruling |
|---|---|---|---|
| T1 → T7, T8 | `snapshotEvery`, `isSnapshotTick`, `SNAPSHOT_EVERY_TICKS` | consistent | — |
| T2 → T5, T6 | `hello.from`, `log.from` | consistent | — |
| T3 → T8, T10, T11, T12, T13 | caps, `gunzipCapped`, `sha256Hex`, `readSnapshotHeader` | consistent | — |
| T4 → T5, T10, T11 | fake SQL must match the room's SQL **verbatim** | risk: a string drift throws "unsupported SQL" | the SQL text is fixed in Task 4 and copied, never retyped |
| T5 vs T10 | both edit `match-room.ts` `load()` and `route()` | overlap | sequential: T5 before T10; T10 rebases on T5 |
| T7 vs T10 | T7 changes `apply()`'s effect chain; T10 calls `tryAccept` from it | overlap | T7 makes the chain explicit (no `else` catch-all) and leaves a no-op hook `onAgreed(tick, h)`, which T10 fills |
| T7 risk | today `apply()`'s final `else` treats ANY unknown effect as `close`, which retires sockets | **a new `agreed` effect would retire the seat's sockets** | T7 makes every branch explicit, with a test that an `agreed` effect leaves every socket open |
| T9 → T10 | `writeSnapMismatch` | consistent | — |
| T10, T11 → T12 | the DO paths `/snapshot` POST and GET | consistent | — |
| T12 vs `wrangler.jsonc` | a new ratelimit binding ships at merge, and merge is a deploy | needs the lead (below) | added, flagged in the PR body |
| T9 migration `0006` | another lane might also add `0006_*.sql` | low (no open PR adds one) | rename to the next free number on rebase; `test-d1.ts` applies them in sorted order |
| `protocol.ts` vs other lanes | versus-tunnels (GH-681) and net-n3 add Command kinds in `cleanCommand` | low | S3 edits only the `hello`/`log` lines and the two unions |
| `ws-transport.ts` (T6) vs S4 | S4 extends the same `connect()` | none now | T6 changes one line and adds a test |
| T13 tools test vs the snapshot witness | both import `tools/src/net/snapshot-witness.ts` builders | read-only use | never run beside the witness CLI (S2 load lesson) |

---

## Task 1: `snapshotEveryTicks` in the config (net)

**Files:** `packages/net/src/config.ts`, `packages/net/src/config.test.ts`.

- [ ] Add `snapshotEveryTicks?: number` to `MatchConfig`. Its doc says: frame ticks between
  snapshots, a multiple of `hashEveryTicks`; absent or 0 is off; the room mints it (§4.2).
- [ ] Add these exports:
  - `SNAPSHOT_EVERY_TICKS = 1200` (D2);
  - `SNAPSHOT_EVERY_TICKS_MAX = 72_000`;
  - `snapshotEvery(c) = c.snapshotEveryTicks ?? 0`;
  - `isSnapshotTick(tick, every)`, which is `every > 0 && tick >= 0 && (tick + 1) % every === 0`.
- [ ] `validateConfig`: when the field is present it must be an integer in
  `0..SNAPSHOT_EVERY_TICKS_MAX`, and either 0 or a multiple of `hashEveryTicks`. Otherwise the whole
  config is refused (`null`).
- [ ] Tests:
  - absent, 0 and 1,200 are valid with `hashEveryTicks` 20;
  - 1,210, −20, 1.5, `'1200'` and 72,020 are refused;
  - `isSnapshotTick` is true at (1199, 1200) and (2399, 1200), and false at (1200, 1200),
    (0, 1200), (1199, 0) and (−1, 1200).
- [ ] Falsifications:
  - delete the multiple-of-hash clause, and the 1,210 case goes red;
  - write `tick % every === 0`, and the 1,199 case goes red.
- [ ] Commit `feat(net): snapshotEveryTicks and isSnapshotTick (snapshot S3)`.

## Task 2: `hello.from` and the `log.from` echo (net protocol)

**Files:** `packages/net/src/protocol.ts`, `packages/net/src/protocol.test.ts`.

- [ ] `ClientMsg` `hello` gains `from?: number`: "the first frame tick this client lacks; the room
  answers the log from it". `parseClientMsg` accepts `from` only as an integer in
  `0..0x7fffffff`, and refuses the whole message otherwise. The parsed message carries a `from`
  key **only** when one was sent.
- [ ] `ServerMsg` `log` gains `from?: number`, parsed by the same rule.
- [ ] Tests:
  - a `hello` without `from` parses to exactly `{ t, ticket, build }`, with no `from` key (G-5);
  - `from` 0, 1,200 and `0x7fffffff` round-trip;
  - −1, 1.5, `'5'`, `null` and 2^31 are refused;
  - a `log` with `from` round-trips, and one without it is unchanged.
- [ ] Falsifications:
  - drop the range check, and the −1 case goes red;
  - drop the copy of `from` into the result, and the round trip goes red.
- [ ] Commit `feat(net): hello.from and the log's from echo (snapshot S3)`.

## Task 3: `snapshot-wire.ts`: caps, capped gunzip, SHA-256, header reader (net)

**Files:** create `packages/net/src/snapshot-wire.ts` and `packages/net/src/snapshot-wire.test.ts`;
modify `packages/net/src/index.ts` (one `export *` line).

- [ ] **Constants**, each with a comment citing its measurement:
  - `SNAPSHOT_MAX_COMPRESSED_BYTES = 64 * 1024`. The comment cites §12.3 (16.1 KiB) and §13.3
    (~18 KiB with the runtime) and says "never 16 KiB".
  - `SNAPSHOT_MAX_RAW_BYTES = 1024 * 1024`;
  - `SNAPSHOT_FRAME_TICK_OFFSET = SNAPSHOT_MATCH_DIGEST_OFFSET + 8`, importing
    `SNAPSHOT_MATCH_DIGEST_OFFSET` and `SNAPSHOT_FORMAT` from `@lions/sim`. Both are already
    exported. `net` already imports values from `sim`.
- [ ] **`readSnapshotHeader(raw)`** returns `{ format, matchDigest, frameTick } | null`:
  - null when shorter than `SNAPSHOT_FRAME_TICK_OFFSET + 4`, or without the magic `RLSS`;
  - every value is read little-endian through a `DataView`, unsigned;
  - nothing past offset 22 is read.
- [ ] **`gunzipCapped(gz, max)`** returns `{ ok: true, bytes } | { ok: false, reason: 'too_large' |
  'bad_gzip' }`, through `DecompressionStream('gzip')`:
  - the output is counted **per chunk, before it is kept**;
  - past `max`, it cancels the reader and returns `too_large`, without concatenating;
  - a stream error or an empty output is `bad_gzip`.
- [ ] **`sha256Hex(bytes)`**: `crypto.subtle.digest('SHA-256')`, 64 lowercase hex characters.
- [ ] **Tests (literal oracles):**
  - **Header.** `encodeSim(new Sim({ seed: 1, width: 8, height: 8, capacity: 4 }), { matchDigest:
    0xdeadbeef, frameTick: 1199, build: 'b', matchId: 'ABCDEF' })` reads back
    `{ format: 1, matchDigest: 3735928559, frameTick: 1199 }`. Also: a wrong magic, a truncated
    header, and offset 21 with no room for the word.
  - **Gunzip.** Exactly 1,048,576 inflated bytes is ok. One more byte is `too_large`. A 4 MiB
    all-zero payload, about 4 KiB gzipped (the bomb), is `too_large`, and the test asserts no
    `ArrayBuffer` past `max + one chunk` was ever allocated by wrapping the reader. Truncated gzip,
    garbage and an empty body are `bad_gzip`.
  - **SHA.** `sha256Hex('abc')` equals the FIPS 180-2 vector
    `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`.
- [ ] Falsifications:
  - `SNAPSHOT_FRAME_TICK_OFFSET = …+ 4`, and the header test goes red (it reads `contentDigest`);
  - count after appending and compare `>=` against `max + 1`, and the exact-boundary case goes red;
  - remove the cancel, and the allocation assertion goes red.
- [ ] Commit `feat(net): snapshot wire helpers, capped gunzip, SHA-256, header words (snapshot S3)`.

## Task 4: the fake DO learns the snapshot table and the windowed log read (worker, test harness)

**Files:** `packages/worker/src/match/fake-do.ts`; create `packages/worker/src/match/snapshot-sql.ts`,
`packages/worker/src/match/snapshot-fixture.ts` (a non-test helper, like `fake-do.ts`) and
`packages/worker/src/match/fake-do.test.ts`.

- [ ] The SQL, **verbatim**, exported as constants from a new `packages/worker/src/match/snapshot-sql.ts`
  so the room and the fake share one spelling:
  ```
  SNAP_CREATE_SQL = 'CREATE TABLE IF NOT EXISTS snapshot (id INTEGER PRIMARY KEY CHECK (id = 0), frame_tick INTEGER NOT NULL, sha TEXT NOT NULL, digest INTEGER NOT NULL, bytes BLOB NOT NULL)'
  SNAP_PUT_SQL    = 'INSERT OR REPLACE INTO snapshot (id, frame_tick, sha, digest, bytes) VALUES (0, ?, ?, ?, ?)'
  SNAP_TICK_SQL   = 'SELECT frame_tick FROM snapshot WHERE id = 0'
  SNAP_GET_SQL    = 'SELECT frame_tick, sha, digest, bytes FROM snapshot WHERE id = 0'
  LOG_FROM_SQL    = 'SELECT first_tick, frames FROM batch WHERE first_tick > ? ORDER BY first_tick'
  ```
- [ ] `FakeStorage`:
  - **The snapshot table.** It has its own `snapshotTable` flag. A query on it before its CREATE
    throws "no such table: snapshot", as SQLite does.
  - **The put.** It validates its bindings: integer, 64-hex string, integer in `0..2^32-1`, and an
    `ArrayBuffer`, the BLOB type workerd binds. It counts **one** `rowsWritten`, and clones the
    bytes.
  - **The reads.** The two SELECTs return 0 or 1 rows, with `bytes` as an `ArrayBuffer`.
  - **The windowed log read.** `LOG_FROM_SQL` takes one integer binding.
  - **A `rowsRead` meter**, counted per row returned by any SELECT.
  - **The wipe.** `deleteAll` clears the snapshot table and its flag, and counts its row.
  - The CREATE statements count no rows, as today.
- [ ] `snapshot-fixture.ts` holds test helpers. **Its header words are written at the net constants,
  which Task 3 pinned against the real encoder.**
  - `snapshotBytes({ frameTick, matchDigest, fill })` returns synthetic inflated bytes: the magic,
    `format` 1, the two words at their offsets, then `fill` bytes (varying `fill` varies the SHA);
  - `gzip(bytes)` uses `CompressionStream`;
  - `bomb(n)` gzips `n` zero bytes.
- [ ] `fake-do.test.ts`:
  - an unknown statement still throws;
  - the snapshot SELECTs throw before the CREATE;
  - the put counts one row;
  - `deleteAll` counts the snapshot row and removes the table;
  - `LOG_FROM_SQL` returns only `first_tick > binding`.
- [ ] Falsification: make the fake's windowed SELECT ignore its binding, and the window test goes red.
- [ ] Commit `test(worker): fake DO storage learns the snapshot table and the windowed log read (snapshot S3)`.

## Task 5: the trimmed log reply (worker)

**Files:** `packages/worker/src/match/match-room.ts`, `packages/worker/src/match/room-core.ts`,
`packages/worker/src/match/match-room.test.ts`, `packages/worker/src/match/room-core.test.ts`.

- [ ] `room-core.ts` `logParts(config, frames, maxChars = LOG_PART_CHARS, from?: number)`. When
  `from` is given, every part carries `from` (Ruling 10). Nothing else changes: `seatJoin` already
  takes `readLog` as a closure.
- [ ] `match-room.ts` `readLogFrom(from)`:
  - `LOG_FROM_SQL` bound to `from - BATCH_TICKS`. A batch holds at most `BATCH_TICKS` frames, so
    any batch that can hold a tick `>= from` starts after `from - BATCH_TICKS`;
  - then the open batch, with `readLog`'s rule that the memory copy supersedes its own partial row;
  - then `filter(f => f.tick >= from)`.

  `from === undefined` keeps `readLog()` exactly as today.
- [ ] The three call sites use the hello's `from`:
  - `hello` passes `() => this.readLogFrom(msg.from)` to `seatJoin`, plus `from` to `logParts`;
  - `advisorHello`;
  - the ended-room `mayReplay` branch.
- [ ] `match-room.test.ts`, a `describe('hello.from (D6, snapshot S3)')` block with these cases:
  1. **No `from`.** The log messages are deep-equal to today's, byte for byte (`ws.sent` strings),
     with no `from` key (G-5).
  2. **`from` 0.** The frames equal the full log's.
  3. **`from` mid-batch.** Step the room so that one batch spans `from`, with commands in frames
     on both sides. The frames are exactly `full.filter(t >= from)`, and `from` is echoed.
  4. **`from` inside the open (unflushed) batch.**
  5. **`from === st.tick` and `from > st.tick`.** One part with no frames.
  6. **After an eviction**, with the revived room's `st.tick` below the client's `from`: one empty
     part, then the re-minted ticks arrive as `frame` messages.
  7. **An advisor's `hello` with `from`**, and an ended room's replay with `from`.
  8. **Rows read.** A `from` rejoin 1,200 ticks before the end of a 2,400-tick match reads exactly
     the batch rows with `first_tick > from - BATCH_TICKS` (`rowsRead`, counted against the fake's
     table in the test), and fewer than half of the full rejoin's rows.
- [ ] Falsifications:
  - `first_tick >= from` in the bind, and case 3 goes red: it misses the head of the spanning batch;
  - drop the tick filter, and case 3 goes red;
  - drop the open-batch dedupe, and case 4 goes red: a duplicate frame.
- [ ] Commit `feat(worker): hello.from answers the log from that tick (D6, snapshot S3)`.

## Task 6: the client sends `from` on a drop without a reload (net, D6 client half)

**Files:** `packages/net/src/ws-transport.ts`, `packages/net/src/ws-transport.test.ts`,
`packages/worker/src/match/room-loop.test.ts`.

- [ ] `connect()`'s `onopen`: when `this.config !== null && this.clock.newest >= 0`, the `hello`
  carries `from: this.clock.newest + 1`. Otherwise it is unchanged: a first connect, or a reload
  with no clock, still gets the whole log, and that path is S4's.
- [ ] `ws-transport.test.ts`:
  - a first connect sends no `from`;
  - a reconnect after frames 0..41 sends `from: 42`;
  - a reconnect in the lobby (no config) sends no `from`.
- [ ] `room-loop.test.ts`, one case. Run 600 ticks, drop seat 1's socket without a reload, run 100
  more, reconnect. Seat 1's log parts hold only ticks `>= its newest + 1`, and it stays in lockstep
  through the next 200 ticks: equal `taken`, and `hashOk`. The log's characters received are under
  10% of the full-log reconnect's (measured in the same test).
- [ ] Falsifications:
  - send `newest + 2`, and the lockstep assertion goes red: the clock refuses a gap;
  - omit `from`, and the size assertion goes red.
- [ ] Commit `feat(net): a reconnect that kept its clock asks for the log from its next tick (D6, snapshot S3)`.

## Task 7: the room mints the cadence and learns agreed snapshot digests (worker)

**Files:** `packages/worker/src/match/room-core.ts`, `packages/worker/src/match/match-room.ts`,
`packages/worker/src/match/room-core.test.ts`, `packages/worker/src/match/match-room.test.ts`.

- [ ] `mintConfig` adds `snapshotEveryTicks: this.snapshotEveryTicks`.
  - `MatchRoomOptions.snapshotEveryTicks?: number` defaults to `SNAPSHOT_EVERY_TICKS`. It is
    accepted only when it is a non-negative multiple of 20, else it falls back to the default.
  - The constructor doc says workerd never passes it.
- [ ] `Effect` gains `{ kind: 'agreed'; tick: number; h: number }`. In `seatMessage`'s `hash` case,
  when the pair agrees (`a === b`) and `isSnapshotTick(msg.tick, snapshotEvery(st.config))`, the
  case returns it **before** `hashOk`. It is never emitted on a mismatch, on a half pair, or when
  the cadence is 0.
- [ ] `match-room.ts` `apply()`:
  - **Rewrite the effect chain as explicit `kind` branches**: `frame`, `send`, `shut`, `close`,
    `agreed`. An exhaustive `never` default makes `tsc` fail on a new kind (the conflict table's
    risk).
  - `agreed` calls a private `onAgreed(tick, h)`. It stores `h` in a memory-only
    `Map<number, number>` (`agreedDigests`) and keeps the 2 newest ticks.
  - `onAgreed` holds a `// Task 10: tryAccept(tick)` hook and does nothing else yet.
- [ ] Tests:
  - **room-core.** `agreed` comes at 1,199 and 2,399 with `snapshotEveryTicks` 1,200. It is absent
    at 19, on a disagreeing pair (the desync path is unchanged), with no config cadence, and on a
    replayed hash.
  - **match-room.** The minted `start` config carries `snapshotEveryTicks: 1200`. The option makes
    it 40. An `agreed` effect leaves both seats' sockets open and unretired (`closed === null`) and
    writes no row. `agreedDigests` keeps two entries after three agreements.
- [ ] Falsifications:
  - emit on every agreed hash tick, and the "absent at 19" case goes red;
  - leave the old `else` catch-all and send an `agreed` effect through it, and the sockets test goes
    red (a seat's socket closed with `REPLACED_CLOSE_CODE`);
  - keep three entries, and the bound test goes red.
- [ ] Commit `feat(worker): the room mints snapshotEveryTicks and keeps agreed snapshot digests (snapshot S3)`.

## Task 8: `snapshot-intake.ts`, the pure acceptance rules (worker)

**Files:** create `packages/worker/src/match/snapshot-intake.ts` and
`packages/worker/src/match/snapshot-intake.test.ts`.

- [ ] `admitTick(tick, { every, roomTick, storedTick })` returns `'ok' | 'stale'`. It is ok iff:
  - `isSnapshotTick(tick, every)`;
  - `tick < roomTick`;
  - `tick > storedTick` (`storedTick` is −1 for none);
  - `tick >= newestSnapshotTickBelow(roomTick, every) - every`, the two-tick window of Ruling 4.
- [ ] `PendingBook`, memory only:
  - `has(seat, tick)`;
  - `put(seat, tick, { sha, digest, body })`;
  - `drop(tick)`;
  - `dropThrough(tick)`, which drops every pending tick up to and including `tick`;
  - it never holds more than 2 distinct ticks. A put for a third, newer tick drops the oldest.
- [ ] `decide(pending, tick, agreed)` returns one of:
  - `{ kind: 'held' }`, while a seat is missing or `agreed` is undefined and the SHAs are equal;
  - `{ kind: 'mismatch', why: 'sha' | 'digest', shas: [a, b], digest }`. A differing SHA is a
    mismatch whether or not the digest is agreed yet: there is no point waiting.
  - `{ kind: 'accept', sha, digest, body }`, when both SHAs are equal and
    `(agreed >>> 0) === digest` (Ruling 5). `body` is seat 0's (Ruling 7).
- [ ] Tests, with literal ticks and hex:
  - `admitTick` for every boundary: 1,199 ok, 1,200 no, `roomTick` equal no, stored equal no,
    window edge in and one interval out;
  - book bounds;
  - every `decide` branch, including a negative `agreed` (−559038737) that equals 0xdeadbeef.
- [ ] Falsifications:
  - compare `agreed === digest` without `>>> 0`, and the negative case goes red;
  - `tick >= storedTick`, and the "stored equal" case goes red;
  - drop the window clause, and the "one interval out" case goes red.
- [ ] Commit `feat(worker): snapshot intake rules, pure (snapshot S3)`.

## Task 9: the D1 `snap_mismatch` row (worker)

**Files:** create `packages/worker/migrations/0006_snap_mismatch.sql`,
`packages/worker/src/match/snap-mismatch-log.ts` and its test; modify `packages/worker/src/index.ts`
(`scheduled`) and `packages/worker/QUERIES.sql` (one query, for the lead's dashboard reading).

- [ ] The migration, with the existing "Apply before merge" header comment. Applying it is the
  lead's job (G-8).
  ```sql
  CREATE TABLE match_snap_mismatch (code TEXT NOT NULL, tick INTEGER NOT NULL, kind TEXT NOT NULL,
    sha_a TEXT NOT NULL, sha_b TEXT NOT NULL, digest INTEGER NOT NULL, created_at INTEGER NOT NULL,
    PRIMARY KEY (code, tick));
  ```
- [ ] `writeSnapMismatch(db, rec)`, shaped like `writeDesync`:
  - it checks a daily budget `SNAP_MISMATCH_BUDGET = { rowsPerDay: 100 }` over the last 24 hours;
  - it uses `INSERT OR IGNORE`;
  - it returns false when the budget is spent.
- [ ] `SNAP_MISMATCH_PER_ROOM = 3` is exported here and enforced by the DO (Task 10).
- [ ] `purgeSnapMismatches(db, now)` uses `RETENTION_MS`, and is added to `scheduled`'s
  `Promise.allSettled` list.
- [ ] Tests (`openTestD1`):
  - one row written with its fields;
  - a second write for the same `(code, tick)` is ignored;
  - the 101st in a day returns false and writes nothing;
  - the purge deletes a row older than retention and keeps a young one;
  - `scheduled` calls the purge.
- [ ] Falsifications:
  - set the budget check to `>` instead of `>=`, and the 101st case goes red;
  - drop the purge from `scheduled`, and its test goes red.
- [ ] Commit `feat(worker): D1 snap_mismatch rows with a daily budget and retention (snapshot S3)`.

## Task 10: the DO accepts uploads (worker)

**Files:** `packages/worker/src/match/match-room.ts`, `packages/worker/src/match/match-room.test.ts`.

- [ ] **Store:**
  - `ensureSnapshotTable()` is memoised per instance. It runs `SNAP_CREATE_SQL` at `/create` and
    lazily in `load()` when a room exists, which covers a room created before this change.
  - `storedTick` is read once with `SNAP_TICK_SQL` after `ensureSnapshotTable()`, and −1 when
    there is no row.
  - **Neither runs for a code with no room** (G-3).
- [ ] **`POST /snapshot`**, the wire contract's checks 1–13, in order. Steps 8–11 are awaits, and
  step 12 re-runs checks 4, 6 and 7 against `this.st`, `storedTick` and the book (G-6). Then:
  - **`accept`:** `SNAP_PUT_SQL` (one row), `storedTick = tick`, `pending.dropThrough(tick)`,
    `agreedDigests` entries `<= tick` dropped. 201.
  - **`held`:** 202.
  - **`mismatch`:**
    - `pending.drop(tick)`;
    - unless this instance has already written `SNAP_MISMATCH_PER_ROOM` rows, `await
      writeSnapMismatch(...)` inside a try/catch that ends in `console.error`, as `logDesync` does;
    - a missing table (migration not yet applied) is caught, never thrown;
    - 409 `mismatch`.
- [ ] `onAgreed(tick, h)` (Task 7's hook) runs the same `decide` and the same three outcomes. It
  needs no response. It is awaited by `apply`, because a D1 write must not be cancelled at
  hibernation.
- [ ] `purge()` clears the book, `agreedDigests` and `storedTick`. The wipe already drops the table.
- [ ] `match-room.test.ts`, a `describe('snapshot upload (snapshot S3)')` block over `fake-do`, with
  `snapshotEveryTicks: 40` through the option. Uploads come from `snapshot-fixture.ts`, with the
  digest equal to the hash both seats sent. Every refusal asserts **no row written** (`rowsWritten`
  unchanged) and, where it applies, that the previous snapshot is kept.
  - **accept, agreed first:** both seats hash tick 39, then both upload. 202 then 201, and one row
    with the tick, the SHA, the digest and seat 0's bytes.
  - **accept, agreed last:** both upload (202, 202), then the hash pair agrees. The row is written
    inside `apply`.
  - **one seat only:** 202, then no row after 200 more ticks. The book never exceeds 2 ticks.
  - **SHA mismatch:** 409. No DO row, the previous row is kept, one D1 row of `kind: 'sha'` with
    both SHAs, and the fourth mismatch in one instance writes no D1 row.
  - **digest mismatch** (same bytes, header digest ≠ agreed): 409, a D1 row of `kind: 'digest'`.
  - **oversize:** a declared `Content-Length` of 64 KiB + 1 gets 413 before any read. An undeclared
    body of 64 KiB + 1 gets 413. Exactly 64 KiB of valid gzip is admitted.
  - **bomb** (`bomb(4 MiB)`): 413. Not gzip: 400. A header with the wrong magic or format: 400.
    A header `frameTick` ≠ `X-Snapshot-Tick`: 400.
  - **advisor ticket:** 403. Another match's seat ticket: 403. No or malformed `Authorization`:
    401. An expired ticket: 403.
  - **stale tick:**
    - not a snapshot tick (40): 409;
    - not yet minted (`>= st.tick`): 409;
    - equal to the stored tick: 409;
    - older than the window: 409;
    - a duplicate from the same seat for the same tick: 409 `duplicate`.
  - **lifecycle:** lobby 409, ended 409, cadence 0 (option) 409, no room 404 with
    `storage.hasTable === false` and `rowsWritten === 0` (G-3).
  - **race (G-6):** two uploads from the same seat for the same tick, started together
    (`Promise.all`). Exactly one is recorded and the other gets 409 `duplicate`.
  - **eviction mid-upload:**
    1. seat 0 uploads (202);
    2. `evict()` and revive (a new `MatchRoom` over the same `FakeState`);
    3. seat 1 uploads the same tick (202, because seat 0's pending is gone), and no row follows;
    4. the next cadence, both seats, is accepted (201).
  - **eviction after an accept:** the revived instance reads `storedTick` from SQL and refuses an
    upload for the same tick as stale.
- [ ] Falsifications, each one line in `match-room.ts`:
  - skip the step-12 re-check, and the race test goes red;
  - store seat 1's bytes, and the "seat 0's bytes" assertion goes red;
  - write the row on `held`, and "one seat only" goes red on `rowsWritten`;
  - skip the per-room D1 cap, and the fourth-mismatch case goes red;
  - read `storedTick` only from memory, and "eviction after an accept" goes red.
- [ ] Commit `feat(worker): the room accepts a snapshot on two equal SHAs and the agreed digest (snapshot S3)`.

## Task 11: the DO serves the snapshot (worker)

**Files:** `packages/worker/src/match/match-room.ts`, `packages/worker/src/match/match-room.test.ts`.

- [ ] **`GET /snapshot`:**
  - checks 1–3 of the contract (an advisor ticket is 403);
  - then `SNAP_GET_SQL`;
  - no row (or a lobby) is 204;
  - a row is 200 with its bytes and the three `X-Snapshot-*` headers as the contract says,
    `Content-Type: application/octet-stream`, `Cache-Control: no-store`.
  - It writes nothing, and runs in any status while the room exists.
- [ ] Tests:
  - 204 before any accept;
  - 200 after one, where the bytes equal seat 0's upload exactly, `X-Snapshot-Sha` equals
    `sha256Hex(inflate(bytes))` computed in the test, `X-Snapshot-Digest` is the unsigned agreed
    value, and `X-Snapshot-Tick` is the tick;
  - after a second accept, the GET returns the newer one (the row is replaced, never two);
  - an ended room before its wipe still serves it, and after `PURGE_AFTER_MS` the code is 404;
  - an advisor gets 403, and no ticket gets 401;
  - `rowsWritten` is unchanged by every GET.
- [ ] Falsifications:
  - omit `>>> 0` on the digest header, and the unsigned assertion goes red, because the fixture's
    digest is chosen above 2^31;
  - allow advisors, and the 403 case goes red.
- [ ] Commit `feat(worker): GET the room's snapshot (snapshot S3)`.

## Task 12: the public route (worker)

**Files:** `packages/worker/src/match/routes.ts`, `packages/worker/src/match/routes.test.ts`,
`packages/worker/src/match/body-cap.test.ts`, `packages/worker/src/d1.ts` (`SNAP_LIMIT?:
RateLimiter`), `wrangler.jsonc` (one ratelimit binding).

- [ ] The route regex gains `snapshot`. The `snapshot` action:
  1. Origin, already checked first for every match route;
  2. method `POST` or `GET`, else 405;
  3. `limited(req, env.SNAP_LIMIT)` gives 429;
  4. the `Authorization: Bearer` ticket is verified (`role === 'seat'`, `matchId === code`), else
     401 or 403, **before any stub is made**. A `?ticket=` query is never read;
  5. for a POST, the declared `Content-Length` must be at most the cap, and then
     `readCapped(SNAPSHOT_MAX_COMPRESSED_BYTES)`, else 413;
  6. forward to the stub as `https://room/snapshot`, with the method, `Authorization`,
     `X-Snapshot-Tick` and the bytes, and return the room's response.
- [ ] `wrangler.jsonc` gains `{ "name": "SNAP_LIMIT", "namespace_id": "1006", "simple": { "limit":
  12, "period": 60 } }` with a comment citing Ruling 12. **Shipping it is the lead's merge.**
- [ ] `routes.test.ts`, using the existing `fakeRooms()`:
  - a POST and a GET reach `https://room/snapshot` with the headers and bytes intact;
  - a missing or foreign Origin is 403, and no stub is called;
  - a limited IP is 429 and no stub is called;
  - a ticket in the query string only is 401, with no stub;
  - an advisor ticket and another code's ticket are 403, with no stub;
  - a lower-case code reaches the same room;
  - PUT is 405.
- [ ] `body-cap.test.ts`:
  - the snapshot cap's literal, 65,536, is pinned with its measurement comment, which cites
    §12.3, §13.3 and Task 13's headroom test;
  - a declared 65,537 is 413 before a stub;
  - an undeclared 65,537 is 413;
  - 65,536 passes.
- [ ] Falsifications:
  - read the ticket from `url.searchParams` as a fallback, and the query case goes red;
  - drop the limiter, and the 429 case goes red;
  - forward before verifying, and the "no stub" assertions go red.
- [ ] Commit `feat(worker): POST/GET /api/match/:code/snapshot, origin, rate, seat ticket, size cap (snapshot S3)`.

## Task 13: the budgets re-measured, and the cap's headroom (worker, tools)

**Files:** `packages/worker/src/match/room-loop.test.ts`, `packages/worker/src/match/match-room.ts`
(header comment only); create `tools/src/net/snapshot-size.test.ts`.

- [ ] **Rows.** In `room-loop.test.ts`, run `budget()` again with the room's option
  `snapshotEveryTicks: 200`: six cadences in 60 s. At each snapshot tick, after both clients have
  hashed it, both seats POST identical fixture bytes, whose digest is the harness's `sameHash(tick)`.
  Then:
  - `rows <= bound(b) + accepted`;
  - `accepted === 6`;
  - a run where seat 1 uploads different bytes gives `rows <= bound(b)` exactly, with zero DO rows
    from snapshots;
  - print the measured rows per minute in the test name output.
- [ ] Update `match-room.ts`'s storage header comment (R-N12): plus one row a minute per accepted
  snapshot, zero for held or refused, and one row deleted at the wipe.
- [ ] **Headroom** (`tools/src/net/snapshot-size.test.ts`, with an explicit measured timeout):
  - encode `stressWorld('tel_marum', 1000)` at tick 600 and the economy cell `wadi_tarfan`
    KDF/Sarim 8919 at tick 1,200, with its runtime;
  - gzip each with `zlib.gzipSync` at the **default level** (6, which is what `CompressionStream`
    uses, not §12.3's level 9);
  - require each at most `SNAPSHOT_MAX_COMPRESSED_BYTES / 2`, and print both sizes.
  - Never run it beside `pnpm snapshot:witness` (S2 load lesson). If it adds more than 15 s to
    `pnpm test`, move it into the witness CLI and say so in the commit.
- [ ] Falsifications:
  - count no row for the accept in the bound, and the rows case goes red;
  - set the cap literal to 16 KiB in a scratch edit, and the headroom test goes red: half of it is
    8 KiB, and the stress world measured 15.4 KiB even at level 9.
- [ ] Commit `test(worker,tools): row budget with snapshots running, and the snapshot cap's headroom (snapshot S3)`.

## Task 14: security review (Opus, read-only), then fixes

**Files:** none for the review; each fix is its own small commit with a test.

- [ ] An Opus reviewer reads the branch diff (`git diff origin/main...HEAD`) and the wire contract,
  and checks at least:
  - **auth:** a seat of THIS code only, in the header, re-checked in the DO, advisors refused,
    expiry honoured, nothing from the ticket logged;
  - **Origin** on both methods;
  - **rate**, and what one IP can make one DO do per minute;
  - **sizes:** the declared and the undeclared body, the inflate ceiling, allocation before the cap;
  - **DO memory bound**, and the eviction behaviour;
  - **no write before acceptance;** no storage for a probed code;
  - **race windows across awaits** (G-6);
  - SQL bound parameters only;
  - D1 growth bounds;
  - a griefing seat: it can deny snapshots to its own room, forcing a full replay. Accepted under
    D3, and reported, not hidden;
  - information disclosure of the GET against the log a seat already receives;
  - response headers (`no-store`, no `Content-Encoding`);
  - error bodies that leak nothing;
  - workerd's CPU per request for an inflate of up to 1 MiB plus a SHA-256. Measure it in Node and
    flag that the deployed number is unmeasured (lead).

  It may run the `security-review` skill over the diff in addition.
- [ ] Findings go to `_coord/net-snapshot-s3-progress.md` **only** (G-9), each as Critical,
  Important or Minor with a ruling.
  - Each Critical or Important finding becomes a fix commit with a test that fails first.
  - The PR body says only "security review: N findings, all fixed or ruled", with no detail.
- [ ] A Sonnet reviewer checks each fix. The Opus reviewer re-reads the fixes once.

## Task 15: gates, "S3 as built", and the PR

- [ ] Gates, all on the branch tip, never beside the witness CLI:
  - `pnpm test:determinism`;
  - `pnpm lint`;
  - `pnpm typecheck`;
  - the full `pnpm test`;
  - `pnpm validate:data`;
  - `pnpm validate:ui` (the `#NNN` rule);
  - `pnpm balance`;
  - `pnpm playtest`;
  - `pnpm snapshot:witness -- --self-check`.

  No pin moved (G-1).
- [ ] Append "## 14. S3 as built" to the spec. It records:
  - the wire contract as landed;
  - every ruling above with its outcome;
  - the measured row budget per minute;
  - the headroom sizes at level 6;
  - the Node CPU per upload;
  - the list in "Handed to S4" below;
  - any deviation.

  Commit it as docs.
- [ ] Open the PR to `main`, not a draft and not merged. The body:
  - lists every falsification with its red line;
  - carries **the lead's actions** (below);
  - says nothing exploit-level (G-9);
  - ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

---

## Handed to S4 (from §12.2, §13.2 and this plan)

- **Producer.**
  - Catch any `encodeSim` throw (§12.2 item 10, §13.2 item 6), log it, and skip that cadence.
  - Never upload while catching up: the room refuses it as stale anyway (Ruling 4).
  - Write `meta.matchDigest = digest >>> 0` (Ruling 5), `frameTick` = the snapshot tick, and send
    the same value in `X-Snapshot-Tick`.
  - Compress with `CompressionStream('gzip')`; the headroom test measures that level.
- **Rejoin.**
  - GET, then check `X-Snapshot-Sha` against `sha256Hex` of the inflated bytes (use `net`'s
    helpers).
  - **Check `build` and `matchDigest` and `frameTick` before `restoreSim`**, because it checks
    neither (§13.2 item 7).
  - Restore onto a freshly built world (§12.2 item 12).
  - Send `hello{ from: frameTick + 1 }`, and assert the reply's `log.from` echo. A log without the
    echo means "full log": drop frames `< from`.
  - Every failure falls back to a `hello` without `from` (§5.4).
- **Local relay** (`tools/src/net/local-relay.ts`). Its `requestFor` copies only `origin` and
  `content-type` and passes the body as UTF-8 text. An AI-harness rejoin that opts into snapshots
  needs `Authorization`, `X-Snapshot-Tick` and binary bodies forwarded, plus the `X-Snapshot-*`
  response headers copied.
- **Wrecks and bodies** (D4) and the first browser measurement of today's rejoin stay S4's first
  tasks (§9).

## For the lead (the PR body repeats these)

1. **Apply `0006_snap_mismatch.sql` to production before merging.** Merge deploys. The code catches
   a missing table, so an unapplied migration loses mismatch rows but breaks nothing.
2. **A new ratelimit binding**, `SNAP_LIMIT`, namespace 1006, 12/min/IP, ships with the merge.
3. **A new public write endpoint** stores at most 64 KiB per room, in one row, replaced, and wiped
   with the room. Approve the endpoint and the caps.
4. **The CPU per upload on workerd** (inflate ≤ 1 MiB plus SHA-256) is measured only in Node. Read
   it once after deploy against the plan's CPU limit.
5. **No GH issue exists for the snapshot work.** Open one if you want the series tracked.

---

## Pin table (expected: nothing moves)

| Pin | File | Expected |
|---|---|---|
| golden, relief, order-done, economy and wounded hashes | `packages/sim/src/determinism.test.ts` | unchanged |
| snapshot format pin 3686246844 | `packages/sim/src/snapshot-witness.test.ts` | unchanged (no sim edit) |
| runtime-digest, economy, versus, mirror, net, two-client | sim, net, app and tools tests | unchanged |
| `pnpm balance`, `pnpm playtest` (outcomes, `LADDER_CREDITS`, `ROSTER_MAX`) | tools | unchanged |
| R-N12 row bounds | `packages/worker/src/match/room-loop.test.ts` | unchanged without uploads; plus exactly one row per accepted snapshot (Task 13) |
| `MATCH_BODY_MAX_BYTES` 3584 | `packages/worker/src/match/routes.ts` | unchanged; the snapshot cap is a separate literal |
