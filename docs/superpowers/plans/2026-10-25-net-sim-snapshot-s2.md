# Net sim snapshot, stage 2 (the runtime): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An economy room's `MissionRuntime` (with the `CivilianFlight`, production lines, income
zones and works it owns) is encoded into the same canonical snapshot as its `Sim` and restored onto a
world freshly built from the same config. Restore-then-step must be byte-identical to the
uninterrupted run, sim and runtime alike. The test-only runtime carry from S1 is deleted.

**Architecture:**
- **`packages/sim/src/runtime-snapshot-schema.ts`** is ONE table naming every own property of
  `MissionRuntime` and of every object it owns. That includes `CivilianFlight`, `ProductionLine` and
  its `LineItem`s, the income-zone records, the works records, patrols and objectives. Each property
  has exactly one class, as in S1: `state`, `config`, `derived` or `scratch`. A doubtful property is
  `state`.
- **The runtime section rides in the S1 snapshot.** `encodeSim(sim, meta, runtime?)` appends a
  runtime section after the sim tail. A header byte says whether one is present, and a runtime
  schema digest goes beside the sim's. `restoreSim(sim, bytes, runtime?)` restores both, the sim
  first. A snapshot with a runtime refuses to restore onto a world without one, and the other way
  round. The header layout changes, so **the format pin moves once, in its own commit**.
- **The section is canonical JSON with explicit containers.** A `Map` is an array of `[key, value]`
  pairs **in insertion order**, never sorted. A `Set` is an array in insertion order. A typed array is
  an integer array. A record is an object with sorted keys, through the S1 `canonicalJson` rules.
  Insertion order is kept because the runtime iterates its Maps and Sets: it is cheaper to keep the
  order than to prove that no iteration depends on it.
- **Shared references are encoded as references.** Some runtime objects are reachable by two paths,
  for example an `entityRoster` value that is the same object as an entry of `rosterPool`. The
  encoder writes such a value as `{ ref: [<owner path>, <index>] }`, and the restore re-links it to
  the restored owner, never to a copy. Task 2's **aliasing census** finds every such class from the
  live graph, and a test fails on any shared reference with no rule.
- **Caches.** A runtime cache that holds a `FlowField` (`corridorFields`) is encoded as its keys plus
  stamps and rebuilt, like the S1 pool. It is `state` unless a poison check proves that clearing it
  is neutral, in which case it is `derived` with "invalidate" as its rebuild. The other caches are
  `state`: `seen*` grids, `zoneRoutes`, `rear*`, `terrainVersion`, `convoyRouteCache`. Each such
  grid is a few KiB before compression.
- **The proof is S1's fork witness, extended.** A world may carry a runtime. The witness's hash folds
  `runtime.digest()`, and its encoding comparison covers the runtime section. The config check covers
  the runtime's `config` rows, and the pre-restore poison covers its `state` and `scratch` rows. The
  economy golden replays join `test:determinism`. The tools witness uses the real restore and keeps
  only the DRIVER carry (`TunnelPlan`, the golden economy's `run` record).

**Tech Stack:** TypeScript strict, vitest, `@lions/sim` (mission.ts, production.ts, civilians.ts,
income.ts, snapshot*.ts), the tools witness. No new dependency.

**Spec:** `docs/superpowers/specs/2026-10-25-net-sim-snapshot-design.md`. The binding sections are
§3 and §6, the §9 S2 row, and §12 ("S1 as built"), whose deviations S2 inherits. D5 rules mirror and
economy rooms together; mirror rooms run no runtime, so S2 is the economy half.

**Base:** `origin/main` with S1 landed (`8eb5c79d`). Line numbers are hints only, so find code by its
symbol.

---

## Rules for this plan

- **R-1. No pin moves** other than the snapshot format pin, which moves once, in its own commit.
  That covers the golden, economy, runtime-digest, versus, mirror and net pins, `pnpm balance`,
  `pnpm playtest`, `LADDER_CREDITS` and `ROSTER_MAX`. If one moves, STOP and report. Nothing edits
  `hash()`, `digest()` or `economyHash()`, and nothing adds an instance property to `Sim` or
  `MissionRuntime`. The S1 completeness tests and the new one reflect over own properties.
- **R-2. A doubtful property is `state`.** `scratch` and `derived` need a passing poison check.
- **R-3. Every check arrives with its falsification run and seen red**, recorded in the commit
  message. Each of the following mutations must turn the witness red, applied to the RESTORED world
  by the test:
  - the `purse` reset;
  - one production line's `queue` emptied;
  - `entityRoster` re-linked to copies, which breaks the aliasing;
  - `corridorFields` cleared. This one is red only if the cache is `state`: if a poison check proves
    clearing neutral, this item becomes that proof instead;
  - a `civFlight` latch cleared.
- **R-4. Invariants.**
  - The encoder and decoder live in `packages/sim` under its lint: no Math, no Date, integers only.
  - Restore is the sim package's own entry point, and nothing outside the sim writes a runtime or
    sim field.
  - The tick code of `mission.ts` is not edited. Methods and types for the codec are allowed;
    instance properties are not.
- **R-5. Children.** A Sonnet implementer per task. An Opus sim-guard reviews every task that touches
  `packages/sim`. Every child runs in the FOREGROUND, under the House rules in CLAUDE.md.

---

## Task 1: The runtime schema and its completeness test

**Files:** create `packages/sim/src/runtime-snapshot-schema.ts` and
`packages/sim/src/runtime-snapshot-schema.test.ts`.

- [ ] `RUNTIME_SNAPSHOT_SCHEMA` covers the 98 own properties of `MissionRuntime`, in creation order.
  Add one row set per owned class or record shape: `CivilianFlight`, `ProductionLine`, `LineItem`,
  the income-zone record, the works records, `PatrolState`, `ObjectiveState`, and whatever else the
  graph holds.
  - Each row is `{ name, cls, kind }`. The kind is typed, scalar, `map`, `set`, `array`, `record` or
    `ref`, reusing S1's union shape where it fits.
  - `config` rows include `sim`, `mission`, `ctx`, `holdView`, `routeSource`, and the zone and convoy
    geometry built from the map.
- [ ] The completeness test reflects over these worlds, in both directions, and checks each row's
  kind against the live value:
  - the golden economy replay's runtime (`economySetup`, at tick 0 and stepped);
  - the relief economy replay's runtime;
  - a runtime from a versus economy room. That world lives in tools, so this part of the test lives
    in `tools/src/net/snapshot-witness.test.ts`, as S1 did for the match world.
- [ ] Falsifications: add a property to `MissionRuntime` and see red; rename a row and see red;
  re-class a row's kind and see red.
- [ ] sim-guard review. Commit `feat(sim): runtime snapshot schema, every MissionRuntime property classed (snapshot S2)`.

## Task 2: The aliasing census

**Files:** `packages/sim/src/runtime-snapshot-schema.ts` (the rules) and a test.

- [ ] A test-side walker records every object reached twice in the runtime graph. Walk from the
  runtime, skipping `config` rows. The test covers the economy replays at several ticks, and the
  versus economy rooms in the tools test. Every object reached by two or more paths must match a
  **reference rule** in the schema, `{ path, owner, key }`, which says which path owns the value and
  how the other paths address it (an index or a key into the owner). Also flag an alias between a
  runtime path and a SIM column, the S1 `holdView` lesson. It must be `config` (a view) or fail.
- [ ] Falsification: delete one rule and see the census name the unruled alias.
- [ ] sim-guard review. Commit `test(sim): runtime aliasing census and reference rules (snapshot S2)`.

## Task 3: Encode and restore the runtime

**Files:** create `packages/sim/src/runtime-snapshot.ts`; modify `packages/sim/src/snapshot.ts` (the
header and the call into the runtime codec), `packages/sim/src/index.ts`, and the tests.

- [ ] **The header** gains `hasRuntime` (u8) and the runtime schema digest (u32), in the
  fixed-width block. `SNAPSHOT_MATCH_DIGEST_OFFSET` stays 10, and a test pins it.
- [ ] **The section** is the canonical JSON object described under Architecture, built by walking
  the schema, with references written per Task 2's rules. Pending intel and mission events are
  encoded generically, as S1 encodes pending sim events.
- [ ] **The restore** order is:
  1. the sim, exactly as S1;
  2. the runtime: replace every `state` container's contents, keeping identity where the runtime
     relies on it, and keeping Map and Set insertion order;
  3. re-link the references;
  4. rebuild `corridorFields` from its keys and stamps (or invalidate it, per Task 4's proof).

  Validate shapes, kinds, counts within bounds, and entity ids within capacity. Refuse with
  `SnapshotRefused`, never clamp, and never size an allocation from a decoded number without a bound.
- [ ] **Tests:**
  - `encode(restore(fresh, S)) == S` at several ticks of both economy replays, including a tick
    with a pending production spawn event and a tick with a queued rally order;
  - refusal when the runtime is present and the target lacks one, and the reverse;
  - refusal on a runtime schema digest mismatch;
  - a runtime fuzz: 1,000 seeded mutations, each either `SnapshotRefused` or a valid round trip.
- [ ] **The format pin moves** in its OWN commit: "Was 923693936." and the reason (header gains
  `hasRuntime` and the runtime schema digest). The pinned world has no runtime, so only the header
  bytes move.
- [ ] Falsifications:
  - encode one Map sorted instead of in insertion order, and see the round trip or the fork go red;
  - drop a reference rule and encode the value by copy, and see a test go red;
  - skip the runtime length check, and see the fuzz go red.
- [ ] sim-guard review. Commit `feat(sim): runtime snapshot encode/restore (snapshot S2)`.

## Task 4: The witness carries the runtime (sim)

**Files:** `packages/sim/src/snapshot-witness.ts`, its tests, and the root `package.json` if the
test list changes.

- [ ] `WitnessWorld` gets an optional `runtime`. The default hash folds `runtime.digest()`. The
  encoding comparison, the round trip at T and the config check all include the runtime. The
  pre-restore poison covers the runtime's `state` and `scratch` rows, `stateRowsMoved` reports
  runtime rows too (prefixed `runtime.`), and `configDiff` compares runtime `config` rows.
- [ ] Add the golden economy replay and the relief economy replay to the fork witness in
  `test:determinism`, with `T` every 100 and horizon 200. State the time this adds; the budget is a
  few seconds.
- [ ] **A poison check for every runtime `scratch` and `derived` row.** For `corridorFields`, decide
  between `state` with rebuild and `derived` with invalidate from the poison result. Write the
  decision and its evidence into the schema row's comment.
- [ ] **Self-checks (R-3)**, as permanent tests. Each applies one mutation to B after the restore and
  requires the witness red:
  - the purse reset;
  - a line queue emptied;
  - `entityRoster` re-linked to copies;
  - a `civFlight` latch cleared;
  - `corridorFields` cleared, or its neutrality proof.
- [ ] Falsifications: neuter each self-check's mutation and see it go red; re-class a runtime `state`
  row as `scratch` and see the poison check go red.
- [ ] sim-guard review. Commit `test(sim): the fork witness carries the runtime (snapshot S2)`.

## Task 5: The tools witness uses the real restore

**Files:** `tools/src/net/snapshot-witness.ts`, `tools/src/net/snapshot-runtime-carry.ts` (cut to the
driver carry and renamed to `snapshot-driver-carry.ts`), and the tools test.

- [ ] Runtime worlds restore their runtime through `restoreSim(..., runtime)`. Delete the reflection
  copy of the runtime. The driver carry stays: `TunnelPlan`, and the golden economy's `run` record.
  Its header says it stays until drivers are stateless.
- [ ] The census gains the runtime rows. Every runtime `state` row that never moves is printed and
  fails unless it is exempt with a reason; the demotion rule applies as in S1.
- [ ] Add a CLI self-check: one production line's `queue` emptied in an economy cell must be red.
- [ ] The versus economy room schema completeness check (Task 1's tools half) lives here.
- [ ] Gates:
  - the full `pnpm test`;
  - `pnpm test:determinism`;
  - lint and typecheck;
  - `pnpm validate:data`, `pnpm balance` and `pnpm playtest`;
  - `pnpm snapshot:witness -- --self-check`, which must exit 0. Report its wall time.
- [ ] Falsifications:
  - remove one runtime exemption and see the census go red;
  - neuter the new self-check and see `--self-check` exit non-zero.
- [ ] Review (tools: Sonnet; Opus if it touches the sim). Commit `test(net): the snapshot witness restores the real runtime (snapshot S2)`.

## Task 6: "S2 as built", sizes and the PR

- [ ] Measure the runtime section's raw and gzipped size, and the encode and restore times, on the
  three economy cells at 20 minutes and the golden economy replay. State the machine and Node
  version.
- [ ] Append "S2 as built" to the spec: what landed, the deviations, the census and aliasing results,
  and the sizes.
- [ ] Open the PR to `main`: not a draft, not merged. The body lists every falsification with its red
  result and ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Write issue
  refs as GH-NNN.

---

## Pin table (expected: only the snapshot format pin moves)

| Pin | Expected |
|---|---|
| golden, relief, order-done, economy and wounded hashes; the runtime-digest and economy digests | unchanged |
| versus-force, match-world, per-seat-types, two-client | unchanged |
| `pnpm balance`, `pnpm playtest` | unchanged |
| snapshot format pin (923693936) | **moves once in Task 3** (header) |
