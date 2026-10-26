# Net sim snapshot, stage 4 (the client): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A versus seat that reloads mid-match loads the room's latest accepted snapshot, replays at most
one snapshot interval of frames, and stays in lockstep. The other seat is frozen for that replay rather
than for the whole match. Both seats produce the snapshot: they encode it after `runFrames` reports a
snapshot tick, gzip it and upload it once. Every failure falls back to today's full replay from tick 0.
The first task measures today's rejoin in a real browser before anything is built, so the payoff is
known first.

**Architecture:**
- **`packages/net`** gains two small things:
  - in `snapshot-wire.ts`, a meta reader for `build`, `matchId` and `contentDigest`, plus a gzip helper;
  - in `lockstep.ts` and `ws-transport.ts`, a clock that can start at `from`, and a transport that can
    throw away a trimmed log and start again from tick 0.
- **`packages/app/src/net`** holds the client. Each piece is a module with no DOM, so the AI harness and the
  tests run the same code the browser runs:
  - `snapshot-link.ts`: the HTTP half (GET, POST, timeouts, capped reads) and the checks made **before
    the `hello`**;
  - `snapshot-rejoin.ts`: the checks made **after the `hello`**, then build, restore and digest;
  - `snapshot-producer.ts`: encode at the boundary, then gzip and one upload;
  - `connect.ts` and `main.ts`: the wiring, a handful of lines each.
- **`packages/render`** gains one optional `Renderer` method, `settleDead()`. It draws the wrecks and
  bodies of entities that were already dead when the world was restored (D4).
- **`packages/worker`** changes one rule: a same-origin `GET /snapshot` passes without `Origin` (Ruling 3).
- **`tools`**:
  - `local-relay.ts` forwards the snapshot headers and binary bodies, and takes two options;
  - `AgentClient` produces and rejoins by snapshot, opt-in;
  - `rejoin-catchup.test.ts` gets the stall bound and the fallback table;
  - a new `rejoin-measure.ts` is the one Metal instrument.

**Tech Stack:** TypeScript strict, vitest, `@lions/net`, `@lions/sim` (`encodeSim`, `restoreSim`,
`SnapshotRefused`, already on the index), the Worker's `fake-do.ts`. Web platform only:
`CompressionStream`, `DecompressionStream`, `crypto.subtle`, `fetch`. Playwright (already a tools dependency)
for the one browser run. No new dependency.

**Spec:** `docs/superpowers/specs/2026-10-25-net-sim-snapshot-design.md` (lead-approved, D1–D7 as
recommended):
- the binding sections are the §9 S4 row, §2.2's last note, §3.3, §5.3–§5.5 and §7;
- §12.2 items 10 and 12, §13.2 items 6 and 7, and §14.4 are the hand-offs to S4;
- the S3 plan's "Handed to S4" list (`docs/superpowers/plans/2026-10-26-net-sim-snapshot-s3.md`) binds
  too, and so do the S3 ledger's notes (`_coord/net-snapshot-s3-progress.md`).

**Base:** `origin/main` `3a6e27d2` (S3 merged: PR GH-842). Line numbers are hints only, so find code by
its symbol. No GH issue exists for the snapshot work. Write `GH-NNN` if the lead opens one.

**History checked (27 Oct):**
- `gh pr list --state all --search snapshot` finds the spec (GH-799), S1 (GH-808), S2 (GH-823), the S3 plan
  (GH-833) and S3 (GH-842), all merged. Nothing of S4 exists.
- One PR is open, GH-850 (wounded ring). It touches `ThreeRenderer.ts` in another region (see the
  conflict table).

---

## What the code says, and what it changes about the spec's picture

Read before any task. Each point was checked against `3a6e27d2`.

1. **The reload path today** (`connect.ts` `connectMatch` → `awaitStart`). A stored ticket opens a
   `WsTransport` at once, and its `hello` has no `from`. The `log` carries the config, `begin(config)`
   makes a clock at tick 0, and the battlefield builds the world from that config (`buildMatchWorld`,
   `main.ts`).
2. **The config arrives only with the `log`.** The room's config is not known before the `hello`, so
   `restoreSim` (which needs `buildMatchWorld(config)`) cannot run before the `hello`.
   - So the rejoin is split. The checks that need no config run before the `hello`: the SHA, the header,
     the build and the content digest. A failure there is today's path exactly: a `hello` with no `from`.
   - The checks that need the config run after the `log`: the mode, the cadence, the matchId, the
     restore and the digest. A failure there must throw away the trimmed log and ask for the whole one
     (`WsTransport.restartFromZero`, Task 3).
3. **The room is frozen while the rejoiner downloads.** A reload closes the socket, so the seat is
   `connected: false`, and `stallFor` stalls the room as `gone` at its next tick. The GET runs before
   the `hello`, so **no frames are minted while it runs**. So ε does not grow with download time.
   - The download still counts against the forfeit clock (`FORFEIT_MS`, 60 s, `protocol.ts`).
   - Hence a 5 s fetch timeout (Ruling 5).
4. **The behind-stall after the `hello`.** `seatJoin` keeps the seat's old `lastAck` (`room-core.ts`), and
   `stallFor` stalls on `st.tick - 1 - lastAck >= STALL_BEHIND_TICKS` (40). So after a `from` rejoin the
   room stalls on the rejoiner until it has run about `st.tick - from` frames. That is the "1,200 + ε".
5. **A browser sends no `Origin` on a same-origin GET.** The Fetch standard adds `Origin` to a request
   only for CORS-tainted requests, WebSockets, and methods other than GET or HEAD.
   - S3's route (`handleMatch` → `originAllowed`) refuses a request with no `Origin` header. So the
     browser's `GET /api/match/:code/snapshot` would get **403 on every rejoin**, and the fallback would
     hide it.
   - S3's tests passed because Node lets a test set `Origin` by hand.
   - Task 6 fixes it (Ruling 3). The POST is unaffected, because a same-origin POST carries `Origin`.
6. **The renderer makes a wreck only from a death it saw happen.** `updateMeshUnits` and the vehicle
   path turn a live entity whose `alive` went to 0 into a dying one, then a wreck (`mesh-death.ts`,
   `pushMeshWreck`). `seedFromSim` seeds positions, fog, trail and terrain, and nothing else.
   - So a world restored at T draws **no** wreck or body for anything killed before T.
   - D4 is needed (Ruling 10, Task 14).
7. **The renderer's explored-ground memory is presentation state.** It is the `fog` latch that
   `isExplored` reads. A replay from 0 rebuilds it; a restore at T does not, so ground explored before T
   reads as never-seen.
   - D4 did not name this. It is reported to the lead (Ruling 11), not fixed.
8. **`buildMatchWorld` refuses a sandbox config.** A sandbox room's world is built by `main.ts`'s own
   path, and no witness covers it. Snapshots are for versus rooms only (Ruling 2).
9. **`restoreSim` returns the header meta only after it has written.** `build`, `matchId` and
   `contentDigest` sit after the 44-byte fixed header, so the client needs its own reader to check them
   first (Task 2). `SNAPSHOT_FIXED_HEADER_BYTES` is not on the `@lions/sim` index, so the offset is pinned
   in `net` against the real encoder, as S3 pinned `frameTick`'s.

---

## Global Constraints (bind every task and every child)

- **G-1. No sim change, no pin moves.**
  - Nothing under `packages/sim/` is edited. S4 uses `encodeSim`, `restoreSim`, `SnapshotRefused`,
    `SNAPSHOT_FORMAT` and `SNAPSHOT_MATCH_DIGEST_OFFSET`, all on the index. If a task finds it needs a sim
    edit, STOP and report.
  - These do not move: the golden, relief, order-done, economy, wounded, runtime-digest, versus, mirror,
    net and two-client pins; the snapshot format pin (3686246844); `pnpm balance`; `pnpm playtest`;
    `LADDER_CREDITS`; `ROSTER_MAX`; the R-N12 row bounds; `bot-row-budget.test.ts`. If one moves, STOP and
    report.
  - `pnpm test:determinism` runs before every commit, because `net` and `app` import `sim`.
- **G-2. The frame log stays the authority.** A snapshot is only a shortcut.
  - Every failure falls back to a full replay. A fallback is never an error a player sees: it is one
    `console.warn` naming the reason, never the ticket.
  - A world that a refused restore touched is discarded, and a fresh `buildMatchWorld(config)` replaces
    it (§12.1: a refusal can leave the target half-written).
- **G-3. Invariant 4.** Snapshot bytes reach the sim only through `restoreSim`. It is called by the net
  layer before the first post-restore tick, onto a world built for the purpose. Nothing else writes a
  column. The renderer and the producer read the sim, and never write it.
- **G-4. Each snapshot is verified twice before any frame runs on it.**
  - **Before the `hello`:**
    - the SHA-256 of the inflated bytes equals `X-Snapshot-Sha` (§14.4: a griefing seat can upload junk
      that its own room then holds);
    - the header's `frameTick` equals `X-Snapshot-Tick`;
    - its `matchDigest` equals `X-Snapshot-Digest`;
    - `format === SNAPSHOT_FORMAT`;
    - `build` equals this client's build;
    - `contentDigest` equals `shippedContentDigest()`;
    - `matchId` equals the room code.
  - **After the `log`:**
    - a versus config with a cadence;
    - `isSnapshotTick(frameTick, every)`;
    - `matchId === config.matchId`;
    - `restoreSim` succeeds;
    - `(matchDigest(sim.hash(), runtime?.digest() ?? 0, shippedContentDigest()) >>> 0) === header
      matchDigest`.
- **G-5. Back-compat.**
  - A room that sends no `from` echo is handled: the clock starts at `from` and drops older frames as
    duplicates.
  - Every existing `connect.test.ts`, `ws-transport.test.ts`, `rejoin-catchup.test.ts` and
    `agent-client.test.ts` case passes **unchanged**. A reload whose fetch throws must be today's reload,
    byte for byte on the socket.
  - The AI harness keeps rejoin-from-0 unless it opts in (§7).
- **G-6. Budgets.**
  - **Upload:** at most one attempt per seat per snapshot tick, never retried (the lead's ruling of 26
    Oct). At most one upload in flight. At most `SNAPSHOT_MAX_COMPRESSED_BYTES` per upload, checked before
    the POST.
  - **Rejoin:** one GET, with a 5 s timeout. The body is read under the compressed cap and inflated under
    `SNAPSHOT_MAX_RAW_BYTES`.
- **G-7. Every new check gets an input that makes it fail**, constructed, run and seen red, then
  reverted by an edit.
  - The commit message names the falsification and quotes its red line.
  - A one-line mutation of the implementation is the preferred form.
  - Oracles take literals, never values imported from the code under test.
  - **A green snapshot test must prove the snapshot path ran** (`rejoin.path === 'snapshot'` and the `from`
    it sent). A test that falls back silently and still passes is the casebook's "empty array" shape.
- **G-8. House rules**, in every brief:
  - never pkill or killall, and never kill a dev server;
  - port 5177 is off-limits;
  - no `ui:routes`, `golden-baseline` or `ui:shots`;
  - **exactly two browser runs in the whole plan**, Task 1C and Task 16. Each is one Chromium on Metal, on
    the tool's own port (`claimPort`), with music off (`musicOffInitScript()`), and with one browser at a
    time;
  - never `git add -A`, so commit with `git commit -m "…" -- <paths>`;
  - never `git checkout <file>`;
  - write issue refs as GH-NNN;
  - no deploys, no secrets, no `wrangler` command;
  - commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **G-9. The repo is public.**
  - Comments, commit messages and the PR say what a limit is and that it is tested, never how to defeat
    it.
  - Security findings go to `_coord/net-snapshot-s4-progress.md` only.
- **G-10. Children and tests.**
  - One Sonnet implementer per task, with `model` passed explicitly. It runs in the foreground and
    dispatches no subagents.
  - One Sonnet reviewer per task. An Opus reviewer runs Task 15 (security) and the final review.
  - No sim-guard is needed, because nothing in `packages/sim` changes. Add one if a diff touches it.
  - Every implementer runs the **full `pnpm test`** before reporting.
  - Every heavy new test gets an explicit, measured timeout.
  - Fake-timer tests that inflate pass an injected yield (`gunzipCapped`'s `yieldTurn`, the room's
    `inflateYield`), because the default zero-delay timer hangs under fake timers (S3 ledger).
- **G-11. Shared files.**
  - `main.ts`, `ThreeRenderer.ts`, `api.ts`, `routes.ts` and `local-relay.ts` are shared with other lanes.
    Keep each edit to the named sites.
  - Rebase on conflict; never take another lane's hunk.

---

## The client contract (decided here; every task builds to it)

**Rejoin, in order** (a reload with a stored ticket, `connectMatch`):

| # | Step | On failure |
|---|---|---|
| 1 | `GET ${origin}/api/match/:code/snapshot`, `Authorization: Bearer <ticket>`, `cache: 'no-store'`, 5 s timeout | pre-hello fallback |
| 2 | 204: no snapshot | pre-hello fallback (`none`) |
| 3 | 200: parse `X-Snapshot-Tick` (decimal u32), `X-Snapshot-Sha` (64 lowercase hex), `X-Snapshot-Digest` (decimal u32) | `bad_headers` |
| 4 | read the body under `SNAPSHOT_MAX_COMPRESSED_BYTES`, then `gunzipCapped(…, SNAPSHOT_MAX_RAW_BYTES)` | `too_large`, `bad_gzip` |
| 5 | `sha256Hex(raw) === X-Snapshot-Sha` | `sha_mismatch` |
| 6 | `readSnapshotHeader` + `readSnapshotMeta`: magic, format, `frameTick === X-Snapshot-Tick`, `matchDigest === X-Snapshot-Digest`, `build`, `contentDigest`, `matchId === code` | one reason each |
| 7 | `new WsTransport(…, { from: frameTick + 1 })`: the `hello` carries `from`, and the clock starts at `from` | — |
| 8 | the `log` arrives with the config (`onStart`). `restoreForRejoin(config, verified)`: versus, cadence, snapshot tick, `matchId`, `buildMatchWorld`, `restoreSim`, digest | post-hello fallback: a FRESH world plus `transport.restartFromZero()` |
| 9 | the battlefield boots on the restored world; `renderer.settleDead?.()` (D4) | — |

A **pre-hello fallback** is today's path: a `hello` with no `from`. A **post-hello fallback** closes the
socket and reconnects at once with no `from`, on a fresh clock at tick 0, keeping the config. The room
answers with the whole log.

**Fallback reasons** are one exported table, `FALLBACK_REASONS` (`snapshot-link.ts`), each tagged `pre` or
`post`:

| Reason | Where |
|---|---|
| `fetch_failed`, `timeout`, `http_status`, `none`, `bad_headers`, `too_large`, `bad_gzip`, `sha_mismatch`, `bad_header`, `format`, `tick_mismatch`, `digest_mismatch`, `build_mismatch`, `content_mismatch`, `match_mismatch` | pre |
| `not_versus`, `cadence_off`, `not_snapshot_tick`, `config_match_mismatch`, `build_failed`, `refused`, `digest_after_restore`, `restore_threw` | post |

A census test (Task 12) fails on any reason with no case.

**Produce** (each seat, `SnapshotProducer.onFrame(tick, digest)`, called by `runFrames` after it reports
frame `tick`). Skip, logging the reason once, when any of these holds:
- not `isSnapshotTick(tick, every)`;
- `digest === null`;
- `tick <= lastAttempt`;
- `transport.behind() > every` (catching up: the room refuses it as stale anyway, S3 Ruling 4);
- an upload is in flight;
- the config is not versus.

Otherwise:
1. `lastAttempt = tick`.
2. `encodeSim(sim, { build, contentDigest: shippedContentDigest(), matchId: config.matchId, frameTick: tick,
   matchDigest: digest >>> 0 }, runtime ?? undefined)`. This runs **synchronously, inside the loop**: it
   sees the state after frame `tick`, before frame `tick + 1`. A throw is caught and logged, and the
   cadence is skipped.
3. Async: `gzipBytes(raw)`. Over the cap, log and skip.
4. One `POST` with `Authorization: Bearer`, `X-Snapshot-Tick` and `Content-Type: application/octet-stream`.
   The outcomes are 201 `stored`, 202 `held`, 409 `duplicate` (which means "recorded", §14.4),
   `refused` (any other status) and `failed` (a network error). **None is retried.**

---

## Rulings on ambiguity (made in this plan; the lead may overturn any)

1. **The GET comes before the `hello`, and the config comes with the `log`.** The pre/post split of the
   contract follows.
   - The other option was to store the config in `sessionStorage` at the start and restore before the
     `hello`. It was rejected: it adds a storage key that holds the room's config, and a stored config
     must still be checked against the room's, which brings the restart path back anyway.
2. **Versus rooms only.** A sandbox room (`mode: 'sandbox'`) produces nothing and restores nothing.
   - `buildMatchWorld` refuses it, and no witness covers `main.ts`'s sandbox boot.
   - A sandbox reload that fetched a snapshot falls back with `not_versus` (post-hello). It never receives
     one in practice, because no seat of a sandbox room uploads.
3. **A same-origin `GET /snapshot` passes without `Origin` when `Sec-Fetch-Site: same-origin`.** This
   applies to that one route and method only. Everything else keeps `originAllowed` as it is.
   - Why it is safe: the GET is authorised by a seat ticket in `Authorization`, a header a cross-site page
     cannot send without a CORS preflight, and the Worker answers none.
   - A browser that sends neither header gets 403 and falls back.
   - **Lead to confirm:** it changes a public route's rule. The alternative is a POST-shaped fetch, which
     changes S3's wire contract.
4. **`AgentClient` produces and rejoins by snapshot only when opted in** (`snapshots: { produce, rejoin }`,
   both default false).
   - This keeps the arena's, `bot-row-budget.test.ts`'s and the relay's behaviour unchanged (G-1).
   - Consequence: a room with a bot seat gets no accepted snapshot unless the bot opts in, because
     acceptance needs both seats.
   - **For the lead:** whether a deployed `pnpm agent` should produce by default.
5. **The fetch timeout is 5 s** (`SNAPSHOT_FETCH_TIMEOUT_MS`): the room is `gone`-stalled and the forfeit
   clock runs while the rejoiner fetches. A slower answer is the `timeout` fallback.
6. **One reason table, tagged pre or post** (the contract above). `restoreForRejoin` and `prepareRejoin`
   return reasons. They never throw.
7. **Upload outcomes are never retried** (the lead, 26 Oct; S3 §14.2). An upload still in flight at the
   next cadence makes the producer skip that cadence. At 60 s apart this never happens unless something
   hangs, and the fetch carries a 10 s timeout (`SNAPSHOT_UPLOAD_TIMEOUT_MS`).
8. **The producer is off while far behind** (`behind() > every`). A rejoiner replaying a full log does
   not encode 20 snapshots the room would refuse.
9. **ε = 42 ticks**: `STALL_BEHIND_TICKS` (40) plus `bufferTicks` (2).
   - A snapshot of frame f is accepted once both seats have run f and uploaded, and the room has seen
     f's hash pair agree. No seat can be more than 40 ticks behind the room without stalling it, and the
     room is frozen (`gone`) from the drop to the `hello`.
   - So the frames a rejoiner must run are at most `every + 42` when every cadence was accepted.
   - A cadence that was lost (a mismatch, or a refused upload) doubles the bound to `2 × every + 42`. That
     is tested too (Task 12).
   - The test writes 1,242 and 2,442 as literals, with this derivation in a comment.
10. **D4 (wreck and body rebuild) is needed, and it is built.**
    - The lead ruled D4 as recommended: rebuild wrecks and bodies from the dead slots, and accept that
      craters, scorch and the feed from before T are gone.
    - The code confirms it is needed (point 6 above): without it, a restored world draws nothing at all
      where a vehicle or a team died before T.
    - **Rebuilt:** every slot with `alive === 0`, `removed === 0`, a type that is not `isKamikaze` and has
      no `swarm`. Each is drawn **settled**: the wreck clip or the lying pose, with no fade, burst, sound
      or smoulder. Fog applies: a wreck shows once its tile is explored, through the existing
      `updateMeshWrecks` latch.
    - **Not rebuilt, and reported as gaps** (Task 14 confirms each by reading the code):
      - a unit killed underground. `releaseTunnel` clears `tunnelIn` at death, so no state tells it apart
        (GH-770 draws no body for it live);
      - passengers killed aboard an airborne carrier (GH-698);
      - a swarm's fallen members;
      - a kamikaze shot down rather than detonated (state cannot tell the two apart, so both are left
        out).
    - Structures need no work: rubble and collapse are drawn from state (`updateStructures`, the terrain
      rebuild `seedFromSim` marks dirty). Task 14 pins that with one assertion.
11. **Explored-ground memory before T is lost** (point 7 above). This is not fixed in S4. It is reported to
    the lead beside D4.
12. **No CORS** for a client on a non-same-origin `ALLOWED_ORIGINS` entry (§14.4). Its POST and GET fail
    the preflight, and it falls back. The game is served same-origin.
13. **`matchId` is checked twice**: against the room code before the `hello` (the room mints `matchId:
    code`, `routes.ts`), and against `config.matchId` after.
14. **Positive evidence.** `__lions.net()` gains:
    - `rejoin: { path: 'snapshot' | 'full', reason?, from?, restoreMs? }`;
    - `snapshot: { encodes, lastEncodeMs, stored, held, recorded, refused, failed, skipped: Record<reason,
      number> }`.

    The Metal run and every end-to-end test assert `path === 'snapshot'`.
15. **A post-hello restart reconnects at once**, not after `RECONNECT_DELAY_MS`, because the opponent is
    frozen while it waits.
16. **The measurement instrument uses the local relay**, not `wrangler dev` (G-8). The dev server's
    `/api` proxy target becomes overridable by `LIONS_API_TARGET`; the default stays
    `http://localhost:8787`. The relay gains `extraOrigins`, so it accepts the dev server's origin.
17. **The STOP gate after Task 1.** If Task 1C measures today's replay phase at 24,000 ticks under 2 s on
    Metal, the snapshot cannot save more than about 2 s. STOP and report before Task 2: the lead may
    rather spend S4 elsewhere.

---

## Pre-flight conflict table

| Pair / task | Produces → consumes | Finding | Ruling |
|---|---|---|---|
| T1B → T10 | both edit `local-relay.ts` (`serveLocalRelay` options, then `requestFor`) | overlap | sequential: T1B before T10; T10 rebases on it |
| T1C → T16 | `rejoin-measure.ts` | T16 adds the `on` mode | T1C writes the `--modes=` flag with `off` only, and T16 adds `on` |
| T2 → T5, T7, T11 | `readSnapshotMeta`, `gzipBytes`, `LockstepClock` start | consistent | — |
| T3 → T8, T9, T11, T12 | `WsTransport` `from` option, `restartFromZero` | consistent | the constructor gains ONE trailing optional `opts` object, so the 70 existing `new WsTransport(` sites (tests included) are unchanged |
| T4 → T9, T11 | `FrameStep.afterFrame`, `SnapshotProducer` | consistent | — |
| T5 → T8, T11, T12 | `SnapshotLink`, `prepareRejoin`, `FALLBACK_REASONS` | consistent | — |
| T7 → T9, T11, T13 | `restoreForRejoin`, `settleRejoin` | consistent | — |
| T6 vs S3 | `routes.ts` snapshot handler, just merged | none open | minimal edit in `handleMatch`'s Origin line only |
| T8 vs existing reload tests | the reload path now fetches first | **risk:** tests whose `fetch` is `noSocket` (throws synchronously) | `prepareRejoin` catches synchronous throws too; every existing case passes unchanged (G-5) |
| T9 (`main.ts`) vs other lanes | tutorial-economy, wounded-p2 and special-units touch `main.ts` | high churn file | four named sites only (Task 9); rebase |
| T14 vs open PR GH-850 | `ThreeRenderer.ts`: wounded ring (selection and readability) vs unit death and wreck | different regions | rebase; `settleDead` is a new method plus one pending-set read in `updateMeshUnits`/`updateVehicleMeshes` |
| T14 vs `api.ts` | a 22nd method (optional) | the header comment counts members | update the count in the same commit |
| T11 vs `bot-row-budget.test.ts` | an agent that produced by default would add rows | off by default (Ruling 4) | unchanged |
| T12/T13 vs the witness CLI | heavy tools tests | load | never run beside `pnpm snapshot:witness` (S2 load lesson) |
| net-n3, versus-tunnels (GH-681) | `protocol.ts`, `match-world.ts`, `versus-seats.ts` | S4 edits none of them | — |

---

## Task 1: measure today's rejoin (FIRST; three parts, three implementers, in order)

The spec's first S4 task (§2.2, §9): time to live and the opponent's frozen time for a reload today, in
Node with the existing `rejoin-catchup` harness and in one Metal browser. Nothing of the snapshot client
exists yet.

### Task 1A: the harness baseline (tools)

**Files:** `tools/src/net/rejoin-catchup.test.ts`.

- [ ] Add `describe('baseline: the full-log reload (snapshot S4 T1)')`. It reuses the file's `Loop` and
  `Seat` and changes the I-1 case not at all. Run the reload at `PLAYED` = 1,200 and 6,000. For each,
  record:
  - `replayed`: the rejoiner's `behind()` right after its `log`;
  - `frozenRoomTicks`: the room ticks during which seat 0's status was `stalled`, from the drop until
    the rejoiner is live with `behind() <= 2`;
  - `catchUpRoomTicks`: room ticks from the `hello` to live.
- [ ] Assertions, on literals:
  - `replayed >= PLAYED - 10` (the whole log);
  - `frozenRoomTicks(6000) > 3 * frozenRoomTicks(1200)`: frozen time grows with the log, the property S4
    removes;
  - print all six numbers in the test name.
- [ ] An explicit timeout, measured (run it twice, and set the timeout to twice the slower run).
- [ ] Falsification: make the 6,000 run's rejoin a socket drop **without** a reload. It keeps its
  transport, so S3's D6 answers it from `newest + 1` and it replays nothing. The growth assertion goes
  red. Revert.
- [ ] Commit `test(tools): rejoin baseline, frozen room ticks grow with the log (snapshot S4 T1)`.

### Task 1B: the relay and the dev proxy can host a browser seat (tools, app config)

**Files:** `tools/src/net/local-relay.ts`, `tools/src/net/local-relay.test.ts`, `packages/app/vite.config.ts`.

- [ ] `LocalRelayOptions` gains:
  - `extraOrigins?: readonly string[]`, appended to `env.ALLOWED_ORIGINS` after the relay's own origin;
  - `snapshotEveryTicks?: number`, passed to each `MatchRoom` (`MatchRoomOptions.snapshotEveryTicks`,
    S3 Task 7).
- [ ] `vite.config.ts`: `proxy: { '/api': { target: process.env.LIONS_API_TARGET ?? 'http://localhost:8787',
  ws: true } }`, with a comment that only `tools/src/net/rejoin-measure.ts` sets it. **The default is
  unchanged.**
- [ ] `local-relay.test.ts`:
  - with `extraOrigins: ['http://127.0.0.1:5999']`, a `POST /api/match` carrying that `Origin` is 201;
  - an unlisted `Origin` is still 403;
  - `snapshotEveryTicks: 0` mints a config whose `snapshotEveryTicks` is 0.
- [ ] Falsification: drop the append, and the 201 case goes red (403).
- [ ] Commit `feat(tools): the local relay takes extra origins and a snapshot cadence (snapshot S4 T1)`.

### Task 1C: `rejoin-measure`, the Metal instrument, and its one run (tools)

**Files:**
- create `tools/src/net/rejoin-measure.ts` and `tools/src/net/rejoin-measure.test.ts`;
- `tools/package.json` and the root `package.json` gain the script `net:rejoin-measure`;
- `tools/src/ui-review/port-census.test.ts` needs no edit if the tool calls `claimPort` with a new key.

- [ ] The CLI: `pnpm net:rejoin-measure -- [--port=5251] [--ticks=6000,24000] [--modes=off]`. It never
  runs in CI, and the header says so. In order:
  1. `claimPort('rejoin-measure', 'REJOIN_MEASURE_PORT', 5251)`.
  2. For each mode, start a local relay (`tickMs` 50, real time) with `extraOrigins` set to the dev
     server's origin. For `off`, pass `snapshotEveryTicks: 0`.
  3. Set `process.env.LIONS_API_TARGET` to the relay's URL, then `ensureDevServer(port, REPO, TAG)`. The
     child inherits the variable.
  4. For each tick count, create a **KDF v Sarim `tel_marum`** room through the relay's HTTP API, and seat
     two `AgentClient`s.
     - Their players are the arena's `rush`, so the log carries orders and the world fights.
     - The builds come from `buildId()`, which equals the dev server's.
     - All rooms pre-play **concurrently**, in Node; no browser is open yet.
  5. When a room reaches its tick count, the tool records seat 0's `transport.stats()`, then detaches
     seat 1's `AgentClient` (no `bye`: a reload).
  6. Within 5 s, one browser rejoins as seat 1:
     - `launchCaptureBrowser()` (Metal ANGLE), with `readUnmaskedRenderer` printed;
     - `musicOffInitScript()`;
     - an init script that stores seat 1's ticket under `lions.versus.seat.<CODE>` in `sessionStorage`;
     - `page.goto('/free-play/tel_marum?net=<CODE>&seat=1')`.
  7. Poll every 50 ms with `page.evaluate`:
     - `bootMs` is when `window.__lions` is first defined;
     - `liveMs` is when `__lions.net().status` is `live` with `behind <= 2`.
  8. Frozen ms is the longest gap, inside the window, between two new frames reaching seat 0. Get it by
     polling seat 0's transport for its newest tick every 10 ms. Frozen room ticks are seat 0's newest tick
     just before that gap. Print seat 0's `stats().stalls.gone` and `.behind` beside them as a cross-check;
     they hold maxima, not sums, so they are not the number itself.
  9. Close the page (one browser, reused for the next room). After the last room, close the browser, stop
     the dev server (`stopDevServer`) and close the relays. Exit, as the house rule on harness scripts
     requires.
- [ ] It prints, per (mode, ticks):
  - time to live (`liveMs` from navigation);
  - `bootMs`;
  - the replay phase (`liveMs - bootMs`);
  - the opponent's frozen ms and room ticks;
  - the frames replayed;
  - the GPU string;
  - the load average at the start and the end.

  It writes the same as JSON to `--out` (default under the scratchpad, never the repo).
- [ ] `rejoin-measure.test.ts` covers the pure parts only: the argument parser (defaults, a bad
  `--ticks`, an unknown `--modes`) and the phase arithmetic, from a recorded timeline literal.
  - Falsification: compute the replay phase as `liveMs` alone, and the arithmetic case goes red.
- [ ] **The one run (G-8):** `pnpm net:rejoin-measure -- --ticks=6000,24000 --modes=off`, on Metal, on a
  quiet machine. It takes about 21 minutes, nearly all of it Node pre-play.
  - Record the table in `_coord/net-snapshot-s4-progress.md` and in this plan's ledger section. The PR
    body repeats it.
  - Apply the STOP gate (Ruling 17).
- [ ] Commit `feat(tools): net:rejoin-measure, today's reload measured on Metal (snapshot S4 T1)`. Put the
  measured table in the commit body.

## Task 2: wire helpers, the meta reader, gzip, and a clock that starts at `from` (net)

**Files:**
- `packages/net/src/snapshot-wire.ts` and `snapshot-wire.test.ts`;
- `packages/net/src/lockstep.ts` and `lockstep.test.ts`.

- [ ] **`readSnapshotMeta(raw)`** returns `{ build, matchId, contentDigest } | null`:
  - `contentDigest` is the u32 at `SNAPSHOT_MATCH_DIGEST_OFFSET + 4`;
  - `build` sits at `SNAPSHOT_META_OFFSET = SNAPSHOT_MATCH_DIGEST_OFFSET + 34` (44): a u16 length, then
    UTF-8. `matchId` follows the same way;
  - each length is at most 256, inside the buffer, and fatal-decoded (`new TextDecoder('utf-8', { fatal:
    true })`). Anything else is null.
- [ ] **`gzipBytes(raw)`**: `CompressionStream('gzip')`, at the default level (what S3's headroom test
  measured).
- [ ] **`LockstepClock`**: `constructor(bufferTicks, start = 0)` sets `nextTick = start` and `newest = start
  - 1`. Nothing else changes: a frame below `start` is `duplicate`, and a frame above `start` with nothing
  before it is `gap`.
- [ ] Tests (literal oracles):
  - `encodeSim(new Sim({ seed: 1, width: 8, height: 8, capacity: 4 }), { build: 'b-1', matchId: 'ABCDEF',
    contentDigest: 0xcafebabe, frameTick: 1199, matchDigest: 0xdeadbeef })` reads back
    `{ build: 'b-1', matchId: 'ABCDEF', contentDigest: 3405691582 }`;
  - a length past the end, a length of 257, and invalid UTF-8 each read null;
  - `gzipBytes` round-trips through `gunzipCapped`;
  - the clock at start 2,400: 2,399 is `duplicate`, 2,400 is `ok`, and 2,402 straight after start is
    `gap`; `behind()` is 0 at start and 1 after 2,400.
- [ ] Falsifications:
  - `SNAPSHOT_META_OFFSET = … + 30`, and the meta test goes red;
  - `newest = start` in the clock, and the "2,400 is ok" case goes red (gap).
- [ ] Commit `feat(net): snapshot meta reader, gzip helper, a clock that starts at from (snapshot S4)`.

## Task 3: `WsTransport` starts at `from`, and can start again from zero (net)

**Files:** `packages/net/src/ws-transport.ts`, `packages/net/src/ws-transport.test.ts`.

- [ ] The constructor gains a trailing optional `opts: { from?: number } = {}`, after `role`. The
  existing positional parameters are unchanged.
- [ ] **The first `hello`** carries `from` when `opts.from` is given and no clock is held yet. Every later
  reconnect keeps S3's rule (`newest + 1`).
- [ ] **`begin(config)`** makes `new LockstepClock(config.bufferTicks, this.startFrom ?? 0)`. A `log` with
  or without the `from` echo is then pushed as today: the clock drops any frame below `from`.
- [ ] **`restartFromZero()`**, for the post-hello fallback:
  1. clear `startFrom`;
  2. set `clock = new LockstepClock(config.bufferTicks)`;
  3. `droppedAt ??= now()`;
  4. null the current socket's handlers and close it;
  5. `connect()` at once, with no timer (Ruling 15).

  The next `hello` has no `from`, because `newest` is −1. `onStart` does not fire again, because the
  config is held. It is a no-op once the transport is terminal or closed.
- [ ] Tests:
  - with `from: 2400`, the first `hello` is `{ t, ticket, build, from: 2400 }`;
  - a `log` with frames 2,400..2,450 makes `behind()` 51, and `take` yields 2,400 first;
  - a `log` without the echo, holding frames 0..2,450, yields 2,400 first as well;
  - after `restartFromZero()`, exactly one new socket opens, its `hello` has no `from`, a full log of
    0..2,450 yields 0 first, and `onStart` was called once in all;
  - a drop **after** a `from` start reconnects with `from: newest + 1` (S3's D6 rule still holds);
  - every existing case passes unchanged.
- [ ] Falsifications:
  - build the clock at 0 in `begin`, and the "2,400 first" case goes red (`gap`, the socket closes);
  - leave `startFrom` set in `restartFromZero`, and its `hello` carries `from` again (red);
  - schedule the reconnect on `RECONNECT_DELAY_MS`, and the "exactly one new socket at once" case goes red.
- [ ] Commit `feat(net): WsTransport starts at from, and restarts from zero on a failed restore (snapshot S4)`.

## Task 4: the producer, after `runFrames` (app)

**Files:**
- `packages/app/src/net/frame-step.ts` and `frame-step.test.ts`;
- create `packages/app/src/net/snapshot-producer.ts` and `snapshot-producer.test.ts`.

- [ ] `FrameStep.afterFrame?: (tick: number, digest: number | null) => void`. `runFrames` computes the
  digest once into a local, passes it to `reportTick`, then calls `afterFrame(f.tick, digest)`, then
  `stopAfter`. It is absent everywhere today, so behaviour is unchanged.
- [ ] `SnapshotProducer`. Its constructor takes:
  - `{ config, build, sim, runtime }`;
  - `behind: () => number`;
  - `upload: (tick, gz) => Promise<UploadOutcome>`;
  - `log: (line) => void`;
  - injectable `encode` (default `encodeSim`), `gzip` (default `gzipBytes`) and `now`.

  `onFrame(tick, digest)` implements the contract's produce rules exactly. `stats()` returns the counters
  of Ruling 14.
- [ ] Tests, with a real `Sim` and an injected `upload` that records its calls:
  - **frame-step:** in a three-frame batch, `afterFrame(f)` sees `sim.tickCount === f + 1` (the boundary),
    is called once per frame, gets `null` on a non-hash tick and the reported digest on a hash tick, and
    runs before `stopAfter`;
  - **digest sign:** a digest of −559038737 at tick 1,199 uploads bytes whose `readSnapshotHeader(…)
    .matchDigest` is 3735928559;
  - **only snapshot ticks:** ticks 1,198 and 1,200 upload nothing; 1,199 and 2,399 upload once each;
  - **encode throws:** an `encode` that throws at 1,199 logs once, counts `skipped.encode`, does not
    throw out of `onFrame` or `runFrames`, and 2,399 still uploads;
  - **one attempt:** an `upload` answering `failed` or `refused` is not called again for that tick, even
    if `onFrame(1199, d)` is called twice; 409 counts as `recorded`;
  - **in flight:** an upload that never settles makes the next cadence `skipped.inFlight`;
  - **behind:** `behind()` 1,201 with every 1,200 is `skipped.behind`;
  - **oversize:** a `gzip` returning 65,537 bytes is `skipped.tooLarge`, with no upload;
  - **mirror and economy:** the runtime is passed when the world has one (the upload's bytes restore onto
    a fresh economy world without `SnapshotRefused`).
- [ ] Falsifications, each one line:
  - drop `>>> 0`, and the digest-sign case goes red (`encodeSim` refuses a negative, so nothing is
    uploaded);
  - remove the try/catch, and the encode-throws case goes red (the throw escapes `runFrames`);
  - set `lastAttempt` after the upload settles instead of before, and the one-attempt case goes red (two
    calls);
  - call `afterFrame` after the loop, and the boundary case goes red.
- [ ] Commit `feat(app): the snapshot producer, encoded at the frame boundary and uploaded once (snapshot S4)`.

## Task 5: `SnapshotLink` and the pre-hello checks (app)

**Files:** create `packages/app/src/net/snapshot-link.ts` and `snapshot-link.test.ts`.

- [ ] `snapshotLink({ fetch, origin, code, ticket, signal?, yieldTurn? })` returns:
  - `upload(tick, gz) → UploadOutcome`: a POST with a 10 s timeout;
  - `latest() → Fetched | { fallback: PreReason }`.

  The ticket only ever goes into the `Authorization` header: never into a URL, never into a log line.
- [ ] `latest()`:
  - a GET with `cache: 'no-store'` and a 5 s timeout, combined with `signal`;
  - a synchronous or asynchronous throw is `fetch_failed`, and the timer firing is `timeout`;
  - 204 is `none`; any status other than 200 is `http_status`;
  - headers are parsed strictly (decimal digits only for the tick and digest, 64 lowercase hex for the
    SHA), else `bad_headers`;
  - the body is read as a stream capped at `SNAPSHOT_MAX_COMPRESSED_BYTES` (a declared `Content-Length`
    over it is refused before reading), else `too_large`;
  - then `gunzipCapped(…, SNAPSHOT_MAX_RAW_BYTES, yieldTurn)`.
- [ ] `verifyFetched(fetched, { code, build, contentDigest })` runs contract steps 5–6 in order and
  returns `{ ok: true, verified: { raw, frameTick, matchDigest } } | { ok: false, reason }`.
- [ ] `prepareRejoin(link, ctx)` returns `{ path: 'snapshot', verified } | { path: 'full', reason }`. It
  never throws.
- [ ] `FALLBACK_REASONS` is exported, as in the contract.
- [ ] Tests, with a fake `fetch` returning crafted `Response`s. The bytes are real `encodeSim` output of a
  tiny `Sim` with real meta, gzipped by `gzipBytes`.
  - The success case is `path: 'snapshot'` with `frameTick` 1,199.
  - **One case per pre reason**, each built from that success by one change: a throwing fetch, a fetch
    that never answers (fake timers, with the timeout advanced), 403, 204, a missing header, a 63-character
    SHA, 65,537 bytes declared and undeclared, garbage gzip, a bit flipped in the raw bytes (so the SHA
    differs), wrong magic, format 2, tick 1,198 in the header, the digest off by one, another build,
    another content digest, another matchId.
  - The request carries `authorization: Bearer <ticket>`, and its URL contains no ticket.
- [ ] Falsifications:
  - skip the SHA comparison, and the bit-flip case goes red: it reaches the header checks and passes,
    because the flip is in the body;
  - parse the tick with `Number()`, and a `'1199abc'` header case goes red;
  - drop the declared-length pre-check, and the declared case goes red on its "no body read" spy.
- [ ] Commit `feat(app): SnapshotLink, the GET and POST, and every check before the hello (snapshot S4)`.

## Task 6: a same-origin snapshot GET without `Origin` (worker)

**Files:** `packages/worker/src/match/routes.ts`, `packages/worker/src/match/routes.test.ts`.

- [ ] In `handleMatch`, the first line becomes: refuse unless `originAllowed(req, env)` holds, **or** the
  request is `GET` on `/api/match/:code/snapshot` with no `Origin` header and `Sec-Fetch-Site:
  same-origin`. It is a named helper, `sameOriginSnapshotGet(req)`, with a comment citing Ruling 3 and the
  Fetch standard's rule.
- [ ] Tests (`fakeRooms()`):
  - a GET with no `Origin` and `Sec-Fetch-Site: same-origin` reaches the stub with the seat ticket;
  - the same with `cross-site`, `same-site` or `none`, or with no `Sec-Fetch-Site`, is 403 with no stub;
  - a **POST** with no `Origin` and `same-origin` is still 403;
  - a GET with no `Origin` to `/join`, `/ws` or `/advisor` is still 403;
  - a foreign `Origin` plus `same-origin` is still 403, because a present `Origin` is judged as today.
- [ ] Falsifications:
  - drop the method check, and the POST case goes red;
  - drop the path check, and the `/join` case goes red.
- [ ] Commit `fix(worker): a same-origin snapshot GET carries no Origin; accept it by Sec-Fetch-Site (snapshot S4)`.

## Task 7: `restoreForRejoin` and `settleRejoin`, the post-hello half (app)

**Files:** create `packages/app/src/net/snapshot-rejoin.ts` and `snapshot-rejoin.test.ts`.

- [ ] `restoreForRejoin(config, verified, deps?)` returns `{ ok: true, world, restoreMs } | { ok: false,
  reason }`. `deps` is injectable: `build` (default `buildMatchWorld`), `restore` (default `restoreSim`) and
  `now`. In order:
  1. `config.mode === 'versus'`, else `not_versus`;
  2. `snapshotEvery(config) > 0`, else `cadence_off`;
  3. `isSnapshotTick(frameTick, every)`, else `not_snapshot_tick`;
  4. `readSnapshotMeta(raw).matchId === config.matchId`, else `config_match_mismatch`;
  5. `build(config)` in a try, else `build_failed`;
  6. `restore(world.sim, raw, world.runtime ?? undefined)`; a `SnapshotRefused` is `refused`, and any other
     throw is `restore_threw`;
  7. the recomputed digest `>>> 0` equals `verified.matchDigest`, else `digest_after_restore`.
- [ ] `settleRejoin(config, prepared, transport, deps?)` returns `{ world: MatchWorld | null, rejoin }` for
  the battlefield:
  - no snapshot: `buildMatchWorld` for a versus config (null otherwise), and `rejoin.path = 'full'` with
    the pre reason;
  - a snapshot that restores: the restored world, and `path = 'snapshot'`;
  - a snapshot that does not: a **fresh** `build(config)` (null for a sandbox config), then
    `transport.restartFromZero()`, and `path = 'full'` with the post reason. The touched world is never
    returned (G-2).
- [ ] Tests, with a real economy world (KDF v Sarim `tel_marum`, the app's own config helpers in
  `economy-stream.test-helper.ts` or `versus-world.test-helper.ts`) and a mirror world. Each is played
  1,200 ticks and encoded at 1,199 with real meta.
  - **Success, both rooms:** `ok`; the restored world's digest equals the source's. Step both 200 ticks
    with the same empty frames through `runFrames`: every hash-tick digest is equal, and the two
    `encodeSim`s at 1,399 are byte-equal.
  - **One case per post reason:**
    - a sandbox config;
    - `snapshotEveryTicks` 0;
    - frame tick 1,198 (re-encoded);
    - another `matchId` in the config;
    - a `build` that throws;
    - `refused`: the verified bytes cut short by 16 bytes. `restoreForRejoin` does not re-hash, because
      the SHA was checked before the `hello`, so the test hands it changed bytes directly;
    - `digest_after_restore`: the source world encoded after one living entity was killed with
      `debugKill`, with the header's `matchDigest` kept at the untouched world's value;
    - a `restore` that throws a plain `Error`.
  - **`settleRejoin`:** a post failure calls `restartFromZero` exactly once (spy), returns a world at
    tick 0 that is not the touched one (identity), and sets the reason. A success never calls it.
- [ ] Falsifications:
  - return the touched world on failure, and the identity case goes red;
  - drop the digest check, and the `debugKill` case goes red: it reports `ok`;
  - compare the digest without `>>> 0`, and the success case goes red for a negative digest. Pick the
    seed's world so its digest is negative, and assert that premise first;
  - skip `restartFromZero`, and the spy case goes red.
- [ ] Commit `feat(app): restore for a rejoin after the hello, with a fresh world on any refusal (snapshot S4)`.

## Task 8: the reload path asks for a snapshot (app)

**Files:** `packages/app/src/net/connect.ts`, `packages/app/src/net/connect.test.ts`.

- [ ] In `connectMatch`, the stored-ticket branch runs `prepareRejoin(snapshotLink({ fetch: deps.fetch,
  origin: deps.origin, code, ticket, signal: deps.signal }), { code, build, contentDigest:
  shippedContentDigest() })` before `awaitStart`. `awaitStart` gains the `from` and hands it to the
  `WsTransport`'s new `opts`.
- [ ] `Connected` gains:
  - `rejoin?: Prepared`, the pre-hello result (absent on every non-reload path);
  - `snapshots?: SnapshotLink`, a link for the producer, built for the handed-over, stored-ticket and
    fresh create and join paths alike, whenever this tab knows the seat's ticket.
- [ ] Tests:
  - **every existing case unchanged** (G-5), including the reload cases whose `fetch` throws or answers
    nothing useful: their socket traffic is byte-identical;
  - a reload whose GET succeeds sends `hello{ from: 1200 }` and resolves with `rejoin.path ===
    'snapshot'`;
  - a reload whose GET is 204 sends no `from` and resolves with `rejoin.path === 'full'`, reason `none`;
  - an abort during the GET rejects with the `AbortError`, as an abort during the socket wait does today;
  - `snapshots` is present on the handed, reload and create paths, and absent for a `LocalTransport`.
- [ ] Falsifications:
  - call `awaitStart` without `from`, and the success case goes red;
  - let `prepareRejoin` throw on a synchronous `fetch` throw, and an existing reload case goes red.
- [ ] Commit `feat(app): a reload fetches the room's snapshot before its hello (snapshot S4)`.

## Task 9: the battlefield boots on the restored world and produces (app)

**Files:**
- `packages/app/src/main.ts`, four sites only;
- `packages/app/src/net/net-report.ts` and `net-report.test.ts`.

- [ ] **Site 1** (the `versusWorld` line): `const settled = netConfig !== null && room !== null ?
  settleRejoin(netConfig, match.rejoin, room) : null;` then `const versusWorld = versusRoom ?
  settled?.world ?? (netConfig !== null ? buildMatchWorld(netConfig) : null) : null;`.
  - A sandbox room with a snapshot rejoin restarts inside `settleRejoin` and keeps its own boot.
  - Log one line: `[net] rejoin: snapshot from <tick> in <ms> ms`, or `[net] rejoin: full log (<reason>)`.
- [ ] **Site 2** (`frameStep`): `afterFrame: (tick, digest) => producer?.onFrame(tick, digest)`.
  - The `producer` is built when `versusWorld !== null && room !== null && snapshotEvery(netConfig) > 0 &&
    match.snapshots`.
  - It reads `versusWorld.sim` and `versusWorld.runtime` (the restored ones on a rejoin), and
    `behind: () => room.behind()`.
- [ ] **Site 3** (after the renderer's `init`): `if (settled?.rejoin.path === 'snapshot')
  renderer.settleDead?.();` (Task 14 fills it; until then the optional call is a no-op).
- [ ] **Site 4** (`__lions.net`): `netReport` takes `extra: { rejoin?, snapshot? }`, and the battlefield
  passes `settled?.rejoin` and `producer?.stats()`.
- [ ] `net-report.test.ts`: the two fields appear when given and are absent otherwise.
  - Falsification: drop the spread, and the "appear" case goes red.
- [ ] No other `main.ts` edit. The Metal run (Task 16) is this task's end-to-end witness, because
  `main.ts` has no unit test.
- [ ] Commit `feat(app): boot a rejoin on the restored world, and produce snapshots in a versus room (snapshot S4)`.

## Task 10: the local relay forwards the snapshot route (tools)

**Files:** `tools/src/net/local-relay.ts`, `tools/src/net/local-relay.test.ts`.

- [ ] `requestFor`:
  - copies `origin`, `content-type`, `authorization`, `x-snapshot-tick` and `sec-fetch-site`;
  - passes the body as bytes (`new Uint8Array(body)`), never `toString('utf8')`.

  The JSON routes are unaffected, because their bytes are the same.
- [ ] The response copies `x-snapshot-tick`, `x-snapshot-sha`, `x-snapshot-digest` and `cache-control`
  beside `content-type`.
- [ ] `readBody`'s cap stays 64 KiB, the same as `SNAPSHOT_MAX_COMPRESSED_BYTES`. Assert that equality in
  the test, as a literal 65,536 on both sides.
- [ ] Tests, over the real relay:
  - both seats POST the same real gzip through HTTP: 202 then 201 once the hash pair agrees. Seat the
    room with two headless transports that hash a fixed value, as `local-relay.test.ts` already seats
    them;
  - a GET returns bytes equal to seat 0's upload, an `X-Snapshot-Sha` equal to `sha256Hex` of the
    inflated bytes, and the tick and digest headers;
  - a GET with no `Origin` and `Sec-Fetch-Site: same-origin` reaches the room (Task 6);
  - a GET with neither header is 403.
- [ ] Falsifications:
  - decode the body as UTF-8, and the POST goes red (`bad_gzip`, or a SHA mismatch: 409);
  - drop `authorization`, and the POST goes red (401);
  - drop the response header copy, and the GET case goes red.
- [ ] Commit `fix(tools): the local relay forwards snapshot headers and binary bodies (snapshot S4)`.

## Task 11: `AgentClient` produces and rejoins by snapshot, opt-in (tools)

**Files:** `tools/src/net/agent-client.ts`, `tools/src/net/agent-client.test.ts`.

- [ ] `AgentClientOptions.snapshots?: { produce?: boolean; rejoin?: boolean; link?: SnapshotLink }`, all
  off by default (Ruling 4).
  - `link` defaults to `snapshotLink({ fetch, origin: server, … })` with Node's `fetch` and the `Origin`
    header set to `origin(server)`.
  - `produce` wires a `SnapshotProducer` into its `runFrames` call (`afterFrame`).
  - `rejoin` runs `prepareRejoin` before the transport, and `settleRejoin` at `onStart`.
- [ ] Tests (`test-room.ts`'s `newRoom`, `Loop` and `play`):
  - **default off:** no request is made at any snapshot tick (a spy `fetch`), and the existing cases are
    unchanged;
  - **produce:** both seats opted in, with a cadence of 1,200, play 1,300 ticks. The room's `GET` (through
    `room.fetch`) returns 200 at tick 1,199 with the agreed digest;
  - **rejoin:** after 2,500 ticks seat 1 detaches, and a new `AgentClient` for seat 1 with `rejoin: true`
    rejoins:
    - its `rejoin.path` is `snapshot`, from 2,400;
    - it runs at most 1,242 frames before live;
    - 400 more ticks pass with `hashOk` growing and no desync.
- [ ] Falsifications:
  - default `produce` to true, and the default-off case goes red;
  - drop `settleRejoin` (restore skipped, world at tick 0), and the rejoin case goes red on a desync.
- [ ] Commit `feat(tools): AgentClient produces and rejoins by snapshot when asked (snapshot S4)`.

## Task 12: `rejoin-catchup.test.ts`, the stall bound and every fallback branch (tools)

**Files:** `tools/src/net/rejoin-catchup.test.ts`.

- [ ] Its room runs the production cadence, 1,200 (the `MatchRoom` default), with `inflateYield` injected.
  The file's `Seat` gains `upload(tick)`: at each snapshot tick it runs, it POSTs, through `room.fetch`, the
  gzip of `encodeSim(tinySim, { build: BUILD, matchId: CODE, contentDigest: shippedContentDigest(),
  frameTick: tick, matchDigest: 0x5eed })`. That is the same digest the file's seats already hash, so the
  room accepts it.
- [ ] **The rejoiner is built by the real code:**
  - `prepareRejoin(snapshotLink({ fetch: routed to room.fetch, … }), ctx)`;
  - `new WsTransport(…, { from })`;
  - at `onStart`, `settleRejoin` with an injected `restore` that returns `ok`, since the file's seats run
    no sim. Task 13 covers the real restore.
- [ ] **The stall bound:**
  - The worst case: seat 1 drops after running frame 3,598, before its upload for 3,599. The latest
    accepted snapshot is then 2,399.
  - Assert, on literals:
    - `rejoin.path === 'snapshot'` and `from === 2400` (G-7: the path ran);
    - `behind()` right after the `log` is at most **1,242** (Ruling 9) and at least 1,150 (the worst case
      was reached, so the test is not vacuous);
    - the rejoiner ends live with frames from 2,400 equal to seat 0's;
    - seat 0's frozen room ticks are under half of Task 1A's baseline, measured at the same `PLAYED` in
      the same test.
- [ ] **A lost cadence:** seat 1 uploads different bytes for 2,399 (a mismatch, both dropped, D3). The
  rejoin uses 1,199, `from === 1200`, and `behind() <= 2,442`.
- [ ] **Every fallback branch.**
  - A table over `FALLBACK_REASONS`. Each `pre` reason is produced by its one-change fake on the routed
    `fetch` (as Task 5). Each `post` reason is produced by an injected `restore` or `build`, or by a config
    field. The room's config is a sandbox one here, so `not_versus` arises naturally.
  - For each reason assert:
    - `rejoin.path === 'full'` with that reason;
    - for `pre`: the `hello` had no `from`. For `post`: exactly one restart, and the second `hello` had no
      `from`;
    - the rejoiner ends live with frames 0..N equal to seat 0's (the whole log).
  - **The census:** the test fails on any reason in `FALLBACK_REASONS` with no row, and on any row whose
    reason is not in it.
- [ ] Measured timeouts: run twice, and set each timeout to twice the slower run. If the file then passes
  60 s in all, split the fallback table into `rejoin-fallbacks.test.ts` and say so in the commit.
- [ ] Falsifications:
  - the rejoiner ignores `from` (it constructs the transport without `opts`), and the bound goes red: it
    replays about 3,600;
  - seat 0 does not upload, so the room never accepts. The bound goes red on `path` (`none`);
  - remove one table row, and the census goes red;
  - the post branch skips `restartFromZero`, and its row goes red (a gap; the rejoiner never lives).
- [ ] Commit `test(tools): a snapshot rejoin stalls at most 1,242 ticks, and every fallback reaches the full log (snapshot S4)`.

## Task 13: real sims, end to end (tools)

**Files:** create `tools/src/net/snapshot-rejoin.test.ts`.

- [ ] Two `AgentClient`s with `snapshots: { produce: true }` play a **KDF v Sarim `wadi_tarfan`** room (an
  economy runtime, production running) and a **mirror `tel_marum`** room, each to 3,000 ticks with the
  arena's `rush` orders. Then seat 1 detaches, and a fresh seat-1 `AgentClient` with `rejoin: true`
  rejoins.
- [ ] Assert, per room:
  - `rejoin.path === 'snapshot'` from 2,400;
  - after 600 more ticks, `hashOk` grew on both seats with no desync;
  - **at a common frame tick 3,599, `encodeSim` of seat 0's world and of the rejoiner's world are
    byte-equal.** This is §6.1's encoding equality across a real rejoin, and it is stronger than the
    hash.
- [ ] One more case per room: an injected `restore` that refuses. The rejoiner restarts from zero,
  replays 0..N, and reaches the same byte equality at 3,599. The fallback is correct, not just taken.
- [ ] A measured explicit timeout. Never run it beside the witness CLI.
- [ ] Falsifications:
  - restore the runtime half as absent (`restore(world.sim, raw)` with no runtime), and the economy room
    goes red at the restore (`refused`, so the path is `full`). Assert the path;
  - send `from: frameTick` instead of `+ 1`, and the byte equality goes red: one frame runs twice.
- [ ] Commit `test(tools): a real-sim snapshot rejoin stays byte-equal with the seat that never left (snapshot S4)`.

## Task 14: D4, settled wrecks and bodies for the dead before T (render, app)

**Files:**
- `packages/render/src/api.ts` (one optional method, and the member count in the header comment);
- `packages/render/src/three/ThreeRenderer.ts`;
- create `packages/render/src/three/ThreeRenderer.settle-dead.test.ts` (modelled on
  `ThreeRenderer.reseed.test.ts`'s stand-ins);
- `main.ts` Site 3 is already in Task 9.

- [ ] `Renderer.settleDead?(): void`. Its doc:
  - after a snapshot restore, draw every entity that was dead before this renderer's first frame as a
    settled wreck or body;
  - it reads the sim and writes nothing (invariant 4);
  - it is never called on a normal boot, so no visual baseline moves.
- [ ] `ThreeRenderer.settleDead()` records the qualifying slots of Ruling 10 into a pending set.
  `updateMeshUnits` and the vehicle path consume an entry once that type's template is ready:
  1. create the entity exactly as the live path would;
  2. hand it straight to the existing death path in a **settled** form: the end pose of the wreck clip
     (or lying pose), pushed through `pushMeshWreck`, with no fade, no burst, no light, no sound and no
     smoulder entry;
  3. delete the entry.

  Each slot is drawn exactly once. The direction is the facing (`killerX` is NaN).
- [ ] Before writing it, the implementer confirms each gap of Ruling 10 by reading the sim, and records
  the findings in the commit body:
  - `releaseTunnel` at death;
  - the airborne-carrier passengers;
  - `isKamikaze`;
  - `type.swarm`.
- [ ] Tests:
  - a sim with a vehicle and an infantry team killed before seeding (`debugKill`), a removed unit, and a
    kamikaze type. After `seedFromSim()`, `settleDead()` and the frames that load the templates:
    - the wreck count is 2;
    - nothing is mid-death (`meshDying` and `vehicleDying` are empty);
    - no burst was spawned;
    - the removed unit and the kamikaze leave nothing;
  - a slot already drawn is not drawn again on later frames (the count stays 2);
  - fog: a wreck on unexplored ground is hidden until its tile is explored;
  - a collapsed structure at seed time draws as rubble with no `settleDead` call (the structure half of
    Ruling 10);
  - read through a debug readback (`debugWreckCount()` or similar, not on `api.ts`, like
    `debugVehicleTransform`).
- [ ] Falsifications:
  - skip the pending set's consumption, and the wreck count goes red (0);
  - drop the `removed` exclusion, and the "removed leaves nothing" case goes red;
  - push into `meshDying` instead of the settled path, and the "nothing mid-death" case goes red.
- [ ] Commit `feat(render): settled wrecks and bodies for entities dead before a snapshot restore (D4, snapshot S4)`.

## Task 15: security review (Opus, read-only), then fixes

**Files:** none for the review; each fix is its own small commit with a test.

- [ ] An Opus reviewer reads `git diff origin/main...HEAD` and the client contract, and checks at least:
  - **trust order:**
    - nothing from the GET reaches `restoreSim` before the SHA, header, build, content and matchId checks;
    - the touched world is never used after a refusal;
    - the digest check runs before the first post-restore tick;
  - **the decoder's input bound:** the compressed read cap, the inflate cap, and no allocation sized from
    the response;
  - **the ticket:** in `Authorization` only, never in a URL, a log line or `__lions.net()`;
  - **Ruling 3:** what a no-`Origin`, `same-origin` GET lets a non-browser client do that it could not
    before. The expected answer is nothing, because it still needs a seat ticket of this code;
  - **timeouts against the forfeit clock;** no retry anywhere; one upload in flight;
  - **a griefing seat:** junk the room holds forces the other seat's rejoin to the full log (D3, accepted).
    Confirm it can force nothing worse;
  - **CPU on the client:** an encode a minute on the frame, and a restore at boot. Measured in Task 16;
  - **the relay forwarding** stays loopback-only and copies no header it should not.
- [ ] Findings go to `_coord/net-snapshot-s4-progress.md` only (G-9), each Critical, Important or Minor
  with a ruling.
  - Each Critical or Important finding becomes a fix commit with a test that fails first.
  - The PR says only "security review: N findings, all fixed or ruled".
- [ ] A Sonnet reviewer checks each fix. The Opus reviewer re-reads the fixes once.

## Task 16: the payoff on Metal, gates, "S4 as built", and the PR

- [ ] `rejoin-measure.ts` gains the `on` mode:
  - both `AgentClient`s run with `snapshots: { produce: true }`;
  - the browser's rejoin must report `__lions.net().rejoin.path === 'snapshot'`, or the run exits 1 naming
    the reason (G-7);
  - it also prints the browser's `restoreMs` and `snapshot.lastEncodeMs` (read from `__lions.net()` after
    one cadence live).
- [ ] **The second and last browser run (G-8):** `pnpm net:rejoin-measure -- --ticks=6000,24000
  --modes=off,on`, on Metal, on a quiet machine. Record the table beside Task 1C's (same machine, GPU
  string and conditions, stated). The payoff is the `on` row against the `off` row, in time to live and in
  opponent frozen time.
- [ ] Gates, all on the branch tip, never beside the witness CLI:
  - `pnpm test:determinism`;
  - `pnpm lint`;
  - `pnpm typecheck`;
  - the full `pnpm test`;
  - `pnpm validate:data`;
  - `pnpm validate:ui`;
  - `pnpm balance`;
  - `pnpm playtest`;
  - `pnpm snapshot:witness -- --self-check`.

  No pin moved (G-1).
- [ ] Append "## 15. S4 as built" to the spec. It records:
  - the client contract as landed;
  - every ruling with its outcome;
  - Task 1C's and Task 16's tables, with their conditions;
  - D4 as built and its gaps;
  - the explored-memory gap;
  - any deviation.

  Commit it as docs.
- [ ] Open the PR to `main`, not a draft and not merged. The body:
  - lists every falsification with its red line;
  - carries the lead's list below;
  - says nothing exploit-level (G-9);
  - ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

---

## For the lead (the S4 PR body repeats these)

1. **Ruling 3 changes a public route's rule**: a same-origin `GET /snapshot` with no `Origin` passes on
   `Sec-Fetch-Site: same-origin`. Without it, every browser rejoin would fall back. Approve, or choose the
   POST-shaped fetch, which changes S3's contract.
2. **D4's gaps.** Bodies killed underground, passengers lost with an airborne carrier, swarm members and
   kamikazes are not rebuilt, because no state distinguishes them. Accept, or ask for a sim column in a
   later stage. That would move the format pin.
3. **The explored-ground memory** from before T is lost on a snapshot rejoin: ground the seat had explored
   reads as never-seen. Accept beside D4, or rule a reveal rule.
4. **Bots do not produce by default** (Ruling 4). A human-vs-bot room therefore never holds an accepted
   snapshot. Rule whether the deployed `pnpm agent` should opt in.
5. **The STOP gate** (Ruling 17), if Task 1C trips it.
6. **No deploy-time action.** S4 adds no binding, no migration and no secret. Merge deploys the client and
   Ruling 3's route change.

---

## Pin table (expected: nothing moves)

| Pin | File | Expected |
|---|---|---|
| golden, relief, order-done, economy, wounded hashes | `packages/sim/src/determinism.test.ts` | unchanged |
| snapshot format pin 3686246844 | `packages/sim/src/snapshot-witness.test.ts` | unchanged (no sim edit) |
| runtime-digest, economy, versus, mirror, net, two-client | sim, net, app, tools tests | unchanged |
| `pnpm balance`, `pnpm playtest` (outcomes, `LADDER_CREDITS`, `ROSTER_MAX`) | tools | unchanged |
| R-N12 row bounds; `bot-row-budget.test.ts` | worker, tools | unchanged (agents opt in; Ruling 4) |
| visual baselines | `tools/golden-baselines/` | unchanged: `settleDead` runs only after a restore |
| `MATCH_BODY_MAX_BYTES` 3584; `SNAPSHOT_MAX_COMPRESSED_BYTES` 65,536 | worker, net | unchanged |

---

## Task order and batches

T1A → T1B → T1C (the STOP gate) → T2 → T3 → T4, T5, T6 (independent) → T7 → T8 → T9 → T10 → T11 → T12 →
T13 → T14 → T15 → T16.

T4, T5 and T6 touch disjoint files and may run as one batch. T14 depends only on T9's Site 3, and may run
beside T10–T13 in a separate worktree if the lead wants speed. Every other step is sequential.

## Ledger (filled in by the executor)

- Task 1C measured table: _pending_.
- Task 16 measured table: _pending_.
