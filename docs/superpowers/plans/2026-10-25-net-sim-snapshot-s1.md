# Net sim snapshot, stage 1 (the sim): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `Sim` can be encoded at a frame boundary into canonical bytes and restored onto a world
freshly built from the same setup. The restored world must then step byte-identical to the
uninterrupted one. A witness proves that across seeds, maps and fork ticks, and a coverage census
names every state column the witness never exercised.

**Architecture:**
- **`packages/sim/src/snapshot-schema.ts`** is ONE table naming every own property of `Sim`, and of
  the objects it owns, with exactly one class (spec §3.1):
  - `state`: encoded and written back;
  - `config`: rebuilt by the world's own setup;
  - `derived`: rebuilt from `state` (the flow-field pool only);
  - `scratch`: overwritten before any read;
  - `boundary`: must be empty at the cut, and the encoder refuses otherwise.
- **`packages/sim/src/snapshot.ts`** holds `encodeSim(sim, meta) → Uint8Array` and
  `restoreSim(sim, bytes) → SnapshotMeta`.
  - It uses a `DataView` writer and reader, little-endian, and the typed-array columns in schema
    order at full length.
  - The irregular `state` (pending events, pending strikes, `stTiles`, `patrolLegIds`, the
    field-pool keys and each domain's goal-map order) goes in one canonical-JSON tail. Keys are
    sorted, values must be integers, strings, booleans, null, or arrays and objects of those, and
    anything else refuses to encode.
  - It reaches private columns through ONE accessor, `internals(sim)` (a cast to
    `Record<string, unknown>`, commented). The schema test pins every name's runtime type, so no
    edit to `sim.ts`'s data members is needed. The only `sim.ts` edits are the field-pool rebuild
    method (Task 4) and a comment (Task 6). Both are small, because other lanes are in `sim.ts` now.
- **The proof is a fork witness** (spec §6.1):
  - restore at T, step to T+N with the same inputs;
  - require `sim.hash()` equal on every hash tick;
  - require **`encodeSim` byte-equal at T+N**;
  - require `encode(restore(S)) == S`.
  - It also runs the poison check (`scratch` and `derived` filled with garbage), the config check
    and the coverage census.

**Tech Stack:** TypeScript strict, vitest, `@lions/sim`, the versus probe's world builders in
`tools/`. No new dependency. `TextEncoder`/`TextDecoder` for the JSON tail (Node and browsers).

**Spec:** `docs/superpowers/specs/2026-10-25-net-sim-snapshot-design.md` (approved 25 Oct, D1–D7 as
recommended). Stage 1 is the §9 S1 row. The runtime half (S2) and the room (S3) are out of scope.
The one exception is a TEST-ONLY runtime carry in Task 7 (below), which lets the economy rooms
exercise the sim columns now.

**Base:** `origin/main` at branch time. Line numbers are hints, so find code by symbol.

---

## Rules for this plan

- **R-1. No pin moves.** The golden hashes in `determinism.test.ts`, the economy, runtime-digest,
  versus, mirror and net pins, `pnpm balance`, `pnpm playtest`, `LADDER_CREDITS`, `ROSTER_MAX`: if
  any one moves, STOP and report. Nothing here edits `hash()`, `digest()` or `economyHash()`, and
  nothing adds an instance property to `Sim`.
- **R-2. A doubtful property is `state`** (spec §3.1). `scratch` and `derived` need a passing poison
  check.
- **R-3. Every check arrives with its falsification run and seen red**, recorded in the commit
  message. These are the spec's own findings, and each must turn the witness red:
  - restoring without the per-domain goal maps (`fieldByGoal`);
  - resetting `fieldLastIssued`;
  - leaving `rng.state` at the fresh seed;
  - resetting `trail` in a world that digs;
  - resetting `stProducesFor` in an economy room.

  They are applied to the RESTORED world by the test through `internals()`, never through a seam
  in production code.
- **R-4. Invariants.**
  - The encoder and decoder live in `packages/sim` under its lint: no `Math`, no `Date`, integers
    only.
  - `restoreSim` is the sim's own entry point, and nothing outside the sim writes a column.
  - Compression and SHA-256 are S3/S4, outside the sim.
- **R-5. Children.** A Sonnet implementer per task. An Opus sim-guard reviews every task that
  touches `packages/sim`. Every child runs in the FOREGROUND, with the hard rules in its brief:
  - no pkill;
  - port 5177 is off-limits;
  - no browser;
  - never `git add -A`, so commit with `git commit -- <paths>`;
  - never `git checkout <file>`.

---

## Task 1: The golden worlds become importable (test helper, verbatim)

**Files:** create `packages/sim/src/golden-worlds.test-helper.ts`, modify `packages/sim/src/determinism.test.ts`.

- [ ] Move the fixtures and builders the three runtime-free golden replays use, **verbatim**: the
  unit and structure JSON, `ROUTE`/`ROUTE_SE`, `run`, `relief` and `orders`. Each builder splits
  into `setup(seed, …)`, which returns the world at tick 0 plus the ids, and `drive(t)`, which
  queues tick t's commands. The existing `run`/`relief`/`orders` signatures are kept as thin
  wrappers, so every `it` in `determinism.test.ts` reads exactly as before.
- [ ] Also export the wounded world and the economy replay's setup, for Task 7's census. The economy
  replay builds a `MissionRuntime`, so S1 uses its sim half only through the test carry.
- [ ] Run `pnpm test:determinism`: **every pin unchanged**. That run is the falsification. Make a
  one-character change to one moved command's tick and watch the pinned hash go red, then revert
  the edit (with an edit, never `git checkout`).
- [ ] Commit `test(sim): golden replay worlds importable, verbatim (snapshot S1)`.

## Task 2: The schema table and the completeness test

**Files:** create `packages/sim/src/snapshot-schema.ts` and `packages/sim/src/snapshot-schema.test.ts`.

- [ ] The table is `SIM_SNAPSHOT_SCHEMA`: an ordered array of `{ name, cls, kind }`.
  - `kind` is the typed-array constructor name and its length rule, or `scalar`, `rng`, or `aux`
    (one of the JSON-tail items).
  - The order is the encoding order. **Append-only within a format version.**
  - The starting classification was measured at `f946bb16`'s 239 properties.

  **config:**
  - `width`, `height`, `capacity`, `seed`, `unitTypes`, `structureTypes`, `boulder`,
    `hasBoulders`, `openGrid`, `humanHeldBySide`, `tnPoints`, `tnTiles`;
  - the views `state`, `structures`, `works`.

  **derived:** `fields` (the pool's FlowFields; rebuilt in Task 4).

  **scratch:**
  - `seenThisTick`, `bestObserver`, `bestObserverP`, `bestObserverStructure`;
  - `detP`, `detStrength`, `detSig`, `detOccl`, `detDistSq`;
  - `aimTurned`, `aimDesired`, `aimFrom`, `braceWant`;
  - `sealQueue`, `sealStamp`, `fieldLive`, `approachField`;
  - `snapX`, `snapY`, `presentedArc`, `engageDSq`, `engageOX`, `engageOY`, `eyeX`, `eyeY`,
    `spreadTiles`.

  **boundary:** `commandQueue`, `runtimeQueue`.

  **state:** everything else. That includes:
  - `rng`, `trail`, `removed`, `fieldRef`;
  - `fieldByGoal`, `fieldGoalKey`, `fieldDomain`, `fieldLastIssued`;
  - `stProducesFor`, `constructedAt`, `sealGen`, `blockedVehicleMask`;
  - the structure geometry and the tunnel tables;
  - `pendingEvents`, `pendingStrikes`, `patrolLegIds`, `stTiles`;
  - every latch, counter and scalar.
- [ ] Owned objects get their own row sets: `Rng` (`state`: state), and `FlowField` inside the pool
  (derived as a whole).
- [ ] Add a test, `completeness`. It reflects over the own properties of four worlds:
  - a bare `new Sim`;
  - the 1000-tick golden world at tick 0 and at tick 500;
  - a world from `buildMatchWorld` of a versus mirror config.

  It fails, naming the property, on any own property with no row, and on any row naming a property
  that no world has. It also checks that each row's `kind` matches the property's runtime type and
  length rule (`capacity × k`, `width × height`, a fixed literal, or scalar).
- [ ] Falsification: add `private probeField = 0;` to `Sim` and watch it go red, then rename a row
  and watch it go red. Revert both by edit.
- [ ] sim-guard review. Commit `feat(sim): snapshot schema, every Sim property classed (snapshot S1)`.

## Task 3: Encode and restore

**Files:** create `packages/sim/src/snapshot.ts` and `packages/sim/src/snapshot.test.ts`; modify
`packages/sim/src/index.ts` (export `encodeSim`, `restoreSim`, `SnapshotMeta`, `SNAPSHOT_FORMAT`).

- [ ] **Header**, spec §3.2:
  - magic `RLSS` and `SNAPSHOT_FORMAT` (1);
  - **a schema digest**, the sim's own `hashWord` folded over each row's name, class and kind, so a
    build whose table differs refuses;
  - the caller's `meta`: `build`, `contentDigest`, `matchId`, `frameTick`, `matchDigest`, all
    optional in S1 with S3 filling them;
  - `simTick`, `capacity`, `width`, `height`.
- [ ] **Columns:** every `state` typed array in schema order, full length, as `u32` length then
  elements, through `DataView` setters (little-endian). Then the scalars. Then `rng.state`.
- [ ] **JSON tail:** a canonical `stringify` with sorted keys. It refuses non-integer numbers,
  `undefined`, functions, and nested non-plain objects, and writes `-0` as `0`. It holds
  `pendingEvents` (every kind generically, so a new event kind needs no encoder code),
  `pendingStrikes`, `patrolLegIds`, `stTiles`, and the pool keys (Task 4).
- [ ] **Boundary:** `encodeSim` throws when `commandQueue` or `runtimeQueue` is non-empty. A
  snapshot is cut between frames only.
- [ ] **`restoreSim(sim, bytes)`:**
  1. Check the magic, format, schema digest, capacity, width and height **before writing anything**.
  2. Write every typed array **in place** (`.set`, which keeps the views aliased), after checking
     each length equals the target's.
  3. Assign the scalars.
  4. Rebuild the tail containers.
  5. Call Task 4's pool rebuild.

  It refuses rather than clamps. On refusal it throws a `SnapshotRefused` with a reason. The target
  is then half-written and must be discarded, and the docstring says so (spec §5.5: restore onto a
  world built for the purpose).
- [ ] **Tests:**
  - round trip, `encode(restore(fresh, S)) == S`, at ticks 0, 1, 137 and 500 of the 1000-tick world;
  - `restoreSim` refuses a different capacity, width, height, schema digest and format;
  - a **fuzz** test: 2,000 seeded mutations (truncation, a bit flip, an oversized length word, a
    garbage tail). Each must throw `SnapshotRefused` or round-trip to a valid world, never throw
    anything else, and never allocate past 4 MiB.
- [ ] Falsification:
  - write one column big-endian and watch the round trip go red;
  - skip the length check and watch the fuzz case go red.
- [ ] sim-guard review. Commit `feat(sim): encodeSim/restoreSim, canonical bytes (snapshot S1)`.

## Task 4: The flow-field pool, rebuilt from its keys

**Files:** modify `packages/sim/src/sim.ts` (one small method pair beside `fieldFor`) and
`packages/sim/src/snapshot.ts`.

- [ ] `Sim.fieldPoolKeys()` returns `{ watermark: fields.length, slots: [{ goal, domain,
  lastIssued }], order: [domain0 slot list, domain1, domain2] }`, with each domain's list in
  `fieldByGoal` insertion order.
- [ ] `Sim.restoreFieldPool(keys)` checks that every goal is on the map, every domain is under
  `DOMAIN_COUNT`, slots are within the watermark, and the order lists exactly match the keyed slots.
  It then:
  1. grows `fields` to the watermark with fresh `FlowField`s;
  2. leaves unkeyed slots zeroed (their bytes are unobservable, the field's own comment);
  3. recomputes each keyed slot with `compute(pathMaskFor(domain), domain === DOMAIN_AIR ? openGrid
     : elevation, gx, gy)`, AFTER the masks are restored;
  4. restores `fieldGoalKey`, `fieldDomain` and `fieldLastIssued`;
  5. refills each domain's Map in the encoded order.
- [ ] Test: in the 1000-tick world (a shed collapses at about tick 300, so the masks change mid-run),
  after a restore at 250, 320 and 700, every keyed slot's `dirs` equals the source's byte for byte.
- [ ] Falsification:
  - recompute against the vehicle mask for every domain and watch it go red;
  - skip the Map refill and watch it go red.
- [ ] sim-guard review. Commit `feat(sim): flow-field pool rebuilt from its keys (snapshot S1)`.

## Task 5: The fast witness, in `test:determinism`

**Files:** `packages/sim/src/snapshot.test.ts`, root `package.json` (`test:determinism` runs both files).

- [ ] Run the fork witness on the three runtime-free golden worlds:
  - for T = 0, 50, 100, … up to the replay's end − 200: encode A at T;
  - `B = setup(seed)`, then `restoreSim(B, S)`;
  - drive both 200 ticks with `drive(t)`;
  - require `hash` equal every 20 ticks and `encodeSim` byte-equal at the end.
- [ ] **Poison check**, at three T per world:
  - after restore, fill every `scratch` typed array with `0x5a` and every `scratch` scalar with
    `0x5a5a`;
  - set `approachField` to a FlowField full of garbage;
  - fill every unkeyed pool slot with `0xee`;
  - then fork. The witness must stay green.
- [ ] **Config check:** at every T, every `config` row of A equals B's after the restore (a deep
  compare; `unitTypes` by JSON).
- [ ] **Self-checks that must stay red** (spec §6.2, R-3), as permanent tests. Each applies one
  mutation to B after the restore and asserts that the witness **fails**:
  - `fieldByGoal` emptied: the encoding differs by the end of the fork (the probe saw `fieldRef`
    diverge while every hash stayed equal);
  - `fieldLastIssued` zeroed;
  - `rng.state` reset to the fresh seed: the hash fails at the first hash tick;
  - `trail` zeroed, at T ≥ 100 of the 1000-tick world, which digs from tick 0.

  Each test also prints whether the HASH alone noticed. That line is information only, never
  asserted, because the hash's blindness depends on the world.
- [ ] **The format pin**: `hashWord` folded over `encodeSim` of the 1000-tick world at tick 500,
  pinned with a comment. It moves only in a commit that changes the format or the state set on
  purpose, saying "Was <n>." and why.
- [ ] Root `package.json`: `"test:determinism": "vitest run packages/sim/src/determinism.test.ts
  packages/sim/src/snapshot.test.ts"`. Measure the added time and state it in the commit (the
  budget is a few seconds).
- [ ] Falsification: for each self-check, remove its mutation and watch the self-check go red,
  because the witness then passes. Class `trail` as `scratch` and watch the poison check go red.
- [ ] sim-guard review. Commit `test(sim): snapshot fork witness in test:determinism (snapshot S1)`.

## Task 6: The `trail` hash comment

**Files:** `packages/sim/src/sim.ts` (comments only).

- [ ] `hash()`'s tunnel comment calls `trail` "derived state that tnProgress already determines".
  Rewrite it to say what is true:
  - it is determined by the HISTORY of `tnProgress`, not by its value at a tick;
  - it is read by `trailStrengthFor`;
  - so a snapshot must carry it, and the snapshot schema classes it `state`;
  - it is still left out of the hash, on purpose, for the reason given (tuning churn).
- [ ] Do the same for `stProducesFor`'s declaration comment (state, read by the runtime's route and
  rear caches; poisoning it diverged runtime state with every hash equal, spec §3.1).
- [ ] `pnpm test:determinism` green and no pin moved (comments only). Commit
  `docs(sim): trail and stProducesFor are snapshot state, not derived (snapshot S1)`.

## Task 7: The full witness and the coverage census (tools)

**Files:**
- create `tools/src/net/snapshot-witness.ts`: the matrix, as a CLI and a library;
- create `tools/src/net/snapshot-witness.test.ts`: a small slice that runs inside `pnpm test`;
- create `tools/src/net/snapshot-runtime-carry.ts`: TEST-ONLY, removed by S2;
- modify `tools/package.json` and root `package.json` (`snapshot:witness`) and `.github/workflows/ci.yml`
  (one step in `gates`, beside `pnpm playtest`).

- [ ] **The worlds:**
  - versus **mirror** rooms on the four fair maps × 2 seeds, through `buildMatchWorld` and
    `matchTick`, with the versus probe's driver (`order` every 400 ticks);
  - the three **economy** cells of the spec's §2 (tel_marum KDF/Sarim 1000, wadi_tarfan KDF/Sarim
    8919, wadi_tarfan Sarim/KDF 16838), with `planRound`;
  - the **tunnels arm** (`TunnelPlan`, `answer` cell);
  - a **capacity stress**: a mirror world filled to 256 (the spec's probe);
  - the golden worlds and the wounded world.
- [ ] **The test-only runtime carry.** An economy world needs its `MissionRuntime` restored too.
  Until S2, `snapshot-runtime-carry.ts` deep-copies the source runtime's data onto the fresh world's
  runtime by reflection. That is the spec's §2.3 prototype, typed arrays by `.set`, accessors and
  functions skipped. The file's header says it is a stand-in, is never imported outside tests, and
  is deleted when S2's encoder lands. The witness's byte comparison covers the SIM. For the runtime
  it compares `runtime.digest()`, plus a reflective deep-equal at the end of each fork.
- [ ] **The matrix:**
  - snapshot every 1,200 ticks to 24,000, plus at the prime offsets 97, 1,013, 4,999 and 11,003;
  - each fork runs 1,200 ticks;
  - one long tail per world: restore at 600 and run to 24,000 (to 3,000 for the golden worlds);
  - the poison check and the config check at every fork point.

  Measure the wall time and record it. The target is at most 120 s, and the slice in `pnpm test` at
  most 15 s.
- [ ] **The coverage census.** For each `state` row, record whether any snapshot point held a value
  different from that world's value at tick 0.
  - Print every row that never moved.
  - **Fail unless it is in `SNAPSHOT_COVERAGE_EXEMPT`** (in the witness file), as
    `{ name, reason }`. Expected entries: the latches and columns of systems no witness world uses
    yet (field works, placed charges, beams, air carriers, mobility kills, patrol). Each needs a
    reason naming the world that would cover it.
  - **Fail on any exemption that HAS moved** ("delete this exemption"), as `mesh_gait.test.ts`'s
    demotion rule does.
- [ ] **Mutations that must turn the full witness red** (R-3), run by the CLI's `--self-check`:
  - **`stProducesFor` reset** in an economy cell. The spec saw every hash stay equal while runtime
    state diverged, so the sim encoding must now catch it at the restore tick, since `stProducesFor`
    is `state`.
  - **`fieldByGoal` emptied** in a mirror cell.
  - **`trail` zeroed** in the tunnels arm.

  `--self-check` exits 0 only when all three go red and the clean run is green. CI runs
  `pnpm snapshot:witness -- --self-check`.
- [ ] Falsification:
  - remove an exemption and watch the census go red;
  - add an exemption for a column that moves and watch the demotion go red;
  - neuter one self-check mutation and watch `--self-check` exit non-zero.
- [ ] Review by a Sonnet reviewer (tools only). Commit `test(net): snapshot witness matrix and coverage census (snapshot S1)`.

## Task 8: Gates, the spec's "S1 as built", and the PR

- [ ] Run the gates. The PR is red until all of them pass:
  - `pnpm test:determinism`;
  - `pnpm lint`;
  - `pnpm typecheck`;
  - `pnpm test`;
  - `pnpm validate:data`;
  - `pnpm balance`;
  - `pnpm playtest`;
  - `pnpm snapshot:witness -- --self-check`.

  **No pin moved** (R-1).
- [ ] Add a short section to the spec: "S1 as built". It records the measured sizes of the real
  encoding (not the probe's estimate), the witness's wall time, the census's exemptions, and
  anything that differs from §3. Commit it as docs.
- [ ] Open the PR to `main`: not a draft, not merged. The body lists every falsification with its
  red result and ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

---

## Pin table (expected: nothing moves)

| Pin | File | Expected |
|---|---|---|
| golden 1000-tick, relief, order-done, economy, wounded hashes | `packages/sim/src/determinism.test.ts` | unchanged |
| runtime-digest, economy digest | sim and net tests | unchanged |
| versus-force, match-world, per-seat-types, two-client | `packages/app/src/net`, `tools/src/net` | unchanged |
| `pnpm balance`, `pnpm playtest` (outcomes, `LADDER_CREDITS`, `ROSTER_MAX`) | tools | unchanged |
| **snapshot format pin** | `packages/sim/src/snapshot.test.ts` | **born in Task 5** |
