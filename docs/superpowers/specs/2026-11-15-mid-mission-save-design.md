# Save and resume in the middle of a mission (GH-1393) — design for the lead

**Date:** 2026-11-15 · **Status:** a proposal for the lead to approve before any build. Docs only: no code, no data. The
one possible sim change (§4.3) is named, small, and does not touch a column or the golden hash.
**Reads against:** the sim snapshot (`packages/sim/src/snapshot.ts`, `runtime-snapshot.ts`, the fork witness in
`snapshot-witness.ts`), the versus rejoin that already uses it (`packages/app/src/net/snapshot-producer.ts`,
`snapshot-rejoin.ts`), the save slots (`packages/app/src/profile.ts`, `@lions/economy`'s `SaveSlot`), the account sync
(GH-1075 A2, `account/outbox.ts`), the pause menu (`ui/pause.ts`).

---

## 0. The ask, and the three answers up front

The pause menu offers *Save and quit*; the menu offers *Resume*; the resumed sim's state hash equals the hash at the save;
a save from an older build is refused with a clear message; a storage refusal is surfaced. Constraints: **reuse the versus
rejoin snapshot, write no second serialiser**; `lions.saves` keeps its one reader and writer; the four invariants hold.

1. **The sim and the mission runtime are already serialisable and proven.** `encodeSim(sim, meta, runtime)` writes the
   whole match, runtime included, as canonical bytes; `restoreSim` validates everything before it writes a column. The fork
   witness already proves "restore at T, run 200 ticks, hash and encoding equal" at every 100 ticks of the golden economy
   replays, the relief replay and the sink world, with every `state` row poisoned before the restore. What is **new** is the
   shell around it (§2): the world must be rebuilt from the same inputs it was started from, and the app's own bookkeeping
   must come back.
2. **A save lives in its own key, not in `lions.saves`** (§5). `lions.saves` slots are synced to the server and validated
   as campaign slots; a mission snapshot is neither.
3. **Resume refuses rather than guesses.** Seven checks, each with a player-readable line and a mutation that turns it red
   (§6). A resume that cannot be proven the same match is a message, never a half-loaded mission.

## 1. What a save holds

One record, `lions.mission.suspend` (§5), JSON, with the snapshot bytes inside it as base64 of the gzip (the versus
producer already gzips: `gzipBytes`).

| Part | What | Source | Why it is needed |
|---|---|---|---|
| **Header** | `format`, `schemaDigest`, `runtimeSchemaDigest`, `contentDigest`, `build`, `frameTick`, `simTick` | `encodeSim`'s own header (the 44 fixed bytes plus `build`/`matchId`) | the refusals of §6; already there |
| **Sim state** | every `state` column, scalars, RNG state, the `aux` tail (events not yet drained, strikes, patrol legs, structure tiles, the command queue, the flow-field pool's keys) | `encodeSim` | the match |
| **Mission runtime** | triggers, objectives, waves, stances, production lines and queues, intel, garrisons, tunnels, wounded, the ledger-bound roster rows, corridor fields | `encodeRuntimeSection` (via `encodeSim`'s `runtime` argument) | the mission |
| **Start inputs** | the mission id, the **seed**, the deploy selection, and the **frozen campaign inputs at mission start**: the ledger, the brigade account and the Roar entitlements the world was built from, plus their digest | the app, at boot | `restoreSim` writes onto "a freshly built world"; the type table (`addUnitType` order, kit tiers through `applyUpgrades`, loaned units) must be rebuilt exactly or the restore refuses. The live stores may have moved since |
| **Mission digest** | a digest of the mission JSON and its map | the app | `shippedContentDigest` hashes `units`, `maps`, `doctrines`, `structures`, `formations` and the versus files but **not missions**; the runtime's `config` rows are rebuilt from the mission JSON, so an edited mission would resume into a different script |
| **Shell record** | the app's own state that no snapshot can hold: `MissionLog` (losses with their kill causes, deductions, objectives, kills, evacuated), `lostThisMission`, `narratedRoeReasons`, `deductions`, `evacuatedSoFar`, `deadlinesWarned`, `limitWarned`, the stall clock | `main.ts`'s battlefield scope | the debrief and the Conduct invoice are built from them at the end |
| **Presentation (best effort)** | camera position and zoom, control groups, selected ids, `gameSpeed` | the app | none of it can change an outcome; if it fails to parse it is dropped and the camera frames the player's force |
| **Self-check** | `hashAtSave`: `sim.hash()` folded with the runtime digest, the same figure the witness uses | `Sim.hash`, `MissionRuntime.digest` | the done-means: after the restore, before the first tick, the hash is recomputed and compared |

**What a save does not hold, on purpose.**

- **The account outbox.** `lions.account.outbox.<tabId>` is a per-tab queue of server writes (`campaign`, `victory`,
  `slot.put`, `slot.delete`). Suspending a mission queues no op, because nothing about the campaign has changed: the
  `victory` op is created at the real end, after a resume, exactly as today. Putting outbox ops in the save would send
  them twice.
- **The live ledger and the live Roar wallet.** They belong to the campaign, not to the mission. The mission carries a
  frozen copy of what it was *started* from; the campaign is written only by the existing both-or-neither victory write.
- **Renderer state, VFX, audio, voice cooldowns.** All derived from the sim clock and rebuilt (invariant 4).
- **Tutorial, sandbox and versus.** The tutorial is not saveable (it teaches one path, and `beit_sahwan_0_tutorial`
  pays nothing). The sandbox has no ledger. A versus room has its own mechanism, the rejoin.

## 2. The determinism guarantee

> Resume at tick T, then N ticks, equals the uninterrupted run's hash at T + N.

**What already proves it:** the fork witness (`forkWitness`, `snapshot-witness.ts`) restores a poisoned fresh world from
the bytes alone and holds two things at once: the hashes agree every 20 ticks, and the canonical encodings of A and B,
runtime section included, are byte-equal at the end. Hash equality alone was shown to miss real divergence (`fieldByGoal`
emptied left every hash equal), so the encoding comparison is the strong half. It runs in `pnpm test:determinism`.

**What is not yet proven, and is the new spec.** The witness builds B with the *test's own* world builder. A save is
restored by *the app's* builder from *frozen inputs*, then the shell record is applied. So the new witness, `mission
resume parity`, drives the **real shell path**:

1. Build a mission world exactly as `bootBattlefield` does (through one extracted function, `buildMissionWorld(inputs)`,
   which the boot and the resume both call; today that logic is inline in one closure of several thousand lines and is the main work of §8).
2. Run a scripted plan from `pnpm playtest`'s ladder (perfect information, orders in flight, production, garrisons, fire
   support, civilians) uninterrupted to T + N, recording the folded hash and the canonical encoding.
3. Run it again to T, call **the function the pause menu calls** (`suspendMission`), pass the record through
   `JSON.stringify`/`parse` and the gzip/base64 round trip as storage would, build a **fresh** world with
   `buildMissionWorld(record.inputs)`, `resumeMission(record)`, and run N ticks.
4. Require equal folded hashes every 20 ticks and byte-equal encodings at T + N, at T = 0, 100, 200 ... on at least three
   missions of different kinds (one with production lines, one with a tunnel/garrison, one with civilians and a time limit).

**Mutations that must turn it red** (the PR carries the red run): resume without restoring the RNG state; skip the shell
record's `lostThisMission` (the debrief's memorial row is missing, caught by a separate parity on the end-of-mission
write); build the resume world with the live ledger instead of the frozen one after a garage purchase; drop the `pendingEvents`
tail. A witness that only compared the hashes would not catch the third, so the spec compares encodings.

**The self-check at runtime** (`hashAtSave`) is the production form of the same idea: if the restored world's hash is not
the saved one, the resume is refused and the record is kept untouched, so a damaged or mismatched save never plays.

## 3. Storage, size and quotas

**Measured today** (`encodeSim` on the shipped sim, gzip via `node:zlib`, 15 Nov 2026):

| World | Raw | Gzip |
|---|---|---|
| An empty sim, 48x48, capacity 256 | 215 KB | 2.2 KB |
| An empty sim, 96x96, capacity 256 | 284 KB | 2.3 KB |
| The golden economy replay after 2,400 ticks (capacity 32, runtime included) | 127 KB | 2.9 KB |

The columns are mostly zeros, so they compress to almost nothing. A real mid-fight mission at capacity 256 is larger and
**is not measured yet; the first build ticket measures it on the shipped missions** before the cap below is fixed. The one
existing bound is the versus snapshot cap: `SNAPSHOT_MAX_COMPRESSED_BYTES` is **64 KiB**, and rooms produce and
upload their snapshots under it.

**Proposal.** Refuse to save a snapshot over **128 KiB gzipped** (twice the versus cap, so a mission with a large runtime
still fits), shown as a clear error, never a truncated write. Base64 adds a third, so the worst record is about 175 KB of
characters plus the frozen ledger (a campaign's ledger is a few tens of KB at the roster cap of 150) and the shell record.
That is under **250 KB**.

| Store | Verdict |
|---|---|
| **localStorage** (one key, `lions.mission.suspend`) | **Recommended.** Browsers allow about 5 MB per origin and differ on whether that counts characters or UTF-16 bytes, so assume the stricter, roughly 2.5 million characters: a worst-case save is about a tenth of it. It is what the rest of the game uses (`LedgerStore`), it is synchronous so *Save and quit* can verify the write before it quits, and it already has the guard patterns (every access try/caught, `QuotaExceededError` handled, `writeActive`'s byte snapshot and restore) |
| IndexedDB | Rejected for v1. Real binary, bigger quota, but asynchronous: the shell's storage door is synchronous and unit-tested around that; the sizes do not need it. Revisit if a measured snapshot passes ~1 MB |
| The server (GH-1075) | Rejected, §5 |

**One save.** A suspended mission is one record, overwritten by the next *Save and quit* and deleted at the end of any
mission (victory, defeat, abandon) and on *Discard*. Not one per slot: the menu says "Resume *Wadi Halam II*, saved 14
minutes ago", which is the whole UI. Keeping the older record on a failed write is the rule, below.

**A storage refusal is surfaced, not swallowed.** *Save and quit* writes the record, **reads it back and compares its
length and digest**, and only then quits. If the write throws (`QuotaExceededError`, a private window, site data blocked),
or the read-back differs, the pause menu stays open and shows a line ("This browser would not keep the save. Free some
space or turn off private browsing, then try again."), nothing is deleted and the game does not quit. The previous record
is untouched: `setItem` of one key is all-or-nothing, and the failed write restores the byte snapshot as `writeActive` does.
Done-means 3, with a spec that makes the store throw and a second that makes it return something other than what was written.

## 4. Versioning and refusals

### 4.1 What the header already refuses

`restoreSim` refuses, with a `reason`, on: a bad magic; a `format` other than `SNAPSHOT_FORMAT`; a differing **schema
digest** (the state table changed); a differing **runtime schema digest**; capacity, width, height or boulders that differ
from the rebuilt world; a runtime present on one side only; `tickCount` disagreeing with the header; a type or structure
index not registered; a truncated body; a tail that is not canonical JSON. These are the refusals the versus rejoin already
relies on. They are structural: they say "this state cannot be written onto this world".

### 4.2 What they do not catch, and the save adds

| Check | Why the header is not enough | Player-facing line |
|---|---|---|
| **Content digest** (`shippedContentDigest`) | structural checks pass when a unit's stats or a map's cover changed; the match would resume into different rules | "This save was made before an update changed the game's data." |
| **Mission digest** | missions are not in the content digest (§1) | "This mission was changed after you saved." |
| **Campaign digest** | the frozen inputs must still be the live campaign (§5.3) | "Your brigade has changed since you saved. Discard this save to carry on." |
| **Sim epoch / build** | a change to sim *code or tuning* with no state-table change leaves every digest equal and changes the outcome | "This save was made on an older version of the game." (§4.3) |
| **Hash at save** | a damaged record that still parses | "This save is damaged and cannot be resumed." |
| **Storage / parse** | JSON that does not parse, wrong `version` | "This save cannot be read." |

Every refusal keeps the record in storage so the message is repeatable and the player decides to *Discard*; a refused save is
never loaded and never deleted silently. `SnapshotRefused.reason` strings are developer text and must not reach the screen
(CLAUDE.md: an internal id is never player-facing; `player-wording.test.ts` guards the same rule for `withdrawn`): each maps to one of the catalogue lines above through `t()`.

### 4.3 The one open question: build strictness (decision D-S1)

The versus rejoin refuses unless the room's `build` equals the snapshot's. For a campaign save that means **any deploy
breaks every save**, and the game ships many times a day (v0.130.1 to v0.130.12 in two days of November). Two options:

- **(a) Exact build.** Nothing to write, simplest, and exactly "older build refused". A save survives a few hours.
- **(b) A sim epoch (recommended).** A `SIM_EPOCH` constant in `@lions/sim`, bumped by hand whenever the sim's behaviour
  changes, and a test that fails when it should have been: it hashes the golden pins (`ECONOMY_PIN`, `ECONOMY_PIN_RELIEF`,
  `WOUNDED_WORLD_PIN`, the determinism golden and the orders pin, which already change only when sim code or tuning changes
  deliberately, per CLAUDE.md) and asserts the result against an expected value stored beside the epoch, so changing a pin
  without touching the epoch is a red test. A save then survives every deploy that did not change the sim. It adds one
  constant and one test to `packages/sim`, moves no column and no hash, and keeps the four invariants. **Risk, stated:** the pins cover the worlds
  the tests drive, not every branch, so a sim change no pin sees would resume a save into slightly different behaviour. That
  is a drift, not corruption (the structure is validated), and the epoch is a one-line bump when a change is known to matter.

I recommend (b) with the build string still **recorded** in the save (shown in the Resume card's tooltip and used for
support), and (a) as the fallback if the lead prefers zero sim-package change in this slice.

## 5. The account, the server and `lions.saves`

### 5.1 Why not `lions.saves`

`lions.saves` is the campaign-slot table: each `SaveSlot` snapshots the three campaign keys, is validated by
`@lions/economy`'s `parseSlot` (a strict `SAVE_VERSION`), and **is synced**: a signed-in device queues `slot.put` /
`slot.delete` ops to the server (`account/outbox.ts`), where it is validated and held in D1. A mission snapshot does not
belong there: it is build-bound (the server would hold records no client can read after the next deploy), it is large next to
a slot, and the server's slot validation would need to learn a second shape. The constraint "`lions.saves` keeps its one
reader and writer" is honoured by not touching it. The new key has **its own single reader and writer**,
`packages/app/src/mission-save.ts`, and an eslint fence keeps everything else out of it, as `roar-wallet` is fenced.

### 5.2 Device-local, on purpose

The suspended mission is **never sent to the server** and never in the outbox, the account export, or a claim. Consequences:

- **Signing in** (the guest-to-account claim) merges campaigns and changes the campaign digest, so a suspended guest
  mission is refused ("your brigade has changed") and offered for discard. Acceptable: a claim is rare and deliberate.
- **Signing out / switching member** (`signOut`, `wipeDeleted`) clears the key with the other per-member local state.
- **Deleting the account** clears it (`wipeDeleted`).
- **Privacy:** nothing leaves the device, so the privacy page needs no change, and the sentence "everything held about an ID
  is deleted about 180 days after it was last seen" is untouched.
- **A second device** does not see it. That is the honest limit of v1; a cross-device save would need the server to hold
  build-bound binary, which is a different design.

### 5.3 Why the campaign digest, and what the garage says

The mission was built from the ledger, the brigade account and the Roar entitlements as they were at *start* (kit tiers
through `applyUpgrades`, owned units, loans). If the player spends credits in the garage while a mission is suspended, the
live inputs differ from the frozen ones. Two ways out: write the victory from the frozen start (and clobber the purchase), or
refuse. **Refuse** is the only safe one, so the garage and Stores show one line while a suspended mission exists ("Buying here
ends your saved mission"), and the resume checks the digest. This is a UI line and one comparison, not a coupling: the
garage reads `hasSuspended()` from the single module.

### 5.4 Two tabs

Resuming does **not** delete the record (a crash after a resume would lose both the progress and the save). The record is
deleted when the resumed mission ends or on *Discard*; *Save and quit* from the resumed mission overwrites it. Two tabs
resuming the same record is a fork; only the tab whose mission ends writes the campaign, through the existing victory
write and its send-base pinning (R17). It is the same exposure as two tabs playing one campaign today, and is not made worse.

## 6. The UI

**Pause menu** (`ui/pause.ts`): one new button between *Settings* and *Quit to campaign*, **Save and quit**, in a mission with
a ledger (not the tutorial, not a sandbox, not a versus room). It saves, verifies (§3), then leaves the way *Quit to
campaign* does, **without** the "this attempt is lost" confirm, because nothing is lost. A *Save* (no quit) is not offered in
v1: the only point of a save is to leave, and a silent checkpoint is decision D-S3. Errors show in the menu (§3).

**Menu and campaign board:** a *Resume* card on `/` and on `/campaign` when a record exists and is readable: the mission's
name (through the locale overlay), how long ago, and the mission clock ("saved at 4:20 of 7:00"), with **Resume** and
**Discard** (a `confirmDialog`). A refused record shows the card in its refused state with the §4 line and only *Discard*.
No path is spelled outside `shell/links.ts`'s `routes`; resume opens `/mission/<id>` with a `resume` flag the boot reads.

**On resume:** the world is rebuilt, restored, the hash verified, and the mission **lands paused** with the pause menu's
*Resume* focused, so the player is never dropped into a running fight. The intro, the briefing and the deploy screen are
skipped (they happened). Every string goes through `t()`; the pseudo capture and `validate:ui` cover the new copy.

**Telemetry:** none in v1. A `mission_resume` event would be a schema change to `telemetry_event.schema.json` and its
hand-written twin (and the field-health panel) and is not needed for the done-means.

## 7. Guards (each with the mutation that turns it red)

| # | Guard | Red by |
|---|---|---|
| G1 | **Resume parity** (§2): the shell path, three missions, T = 0, 100 ... ; hashes and encodings equal | skip the RNG restore; build with the live ledger; drop `pendingEvents` |
| G2 | **Each refusal of §4.2**, one spec per line, with the record untouched afterwards | stop checking the mission digest; stop checking the campaign digest; load a save whose content digest differs |
| G3 | **Refusal text is player-worded**: no `SnapshotRefused.reason` reaches the DOM (`player-wording.test.ts`'s pattern) | put `reason` in a title attribute |
| G4 | **A storage refusal is shown, nothing quits, the old record survives** | swallow the `QuotaExceededError`; quit before the read-back |
| G5 | **One reader and writer**: only `mission-save.ts` names `lions.mission.suspend` (a source scan, as `roar-wallet`'s); `lions.saves` is not touched by it | read the key from `main.ts` |
| G6 | **Never synced**: the outbox ops union has no suspend kind and `sync.ts` does not read the key | queue the record as a `slot.put` |
| G7 | **The record is dropped when the mission ends** (victory, defeat, abandon) | forget the delete on `missionEnd` |
| G8 | **Invariant 4**: the app reaches the sim only through `restoreSim`; no column is written (`snapshot-rejoin.ts`'s rule, a source scan over `mission-save.ts` and the resume builder) | write `sim.state.alive[i]` from `mission-save.ts` |
| G9 | **Sim epoch** (§4.3 b): changing a golden pin without the epoch is red | change `ECONOMY_PIN` and not the epoch |

## 8. How it slices

The sim side is done; the cost is the app. The honest estimate is **10–13 agent-days**, which is more than the issue's "M":
the long pole is S2.

| # | Ticket | Days | Notes |
|---|---|---|---|
| S0 | Measure real snapshot sizes on the shipped missions (mid-fight, capacity 256) and fix the cap; decide D-S1; add `SIM_EPOCH` and G9 if (b) | 1 | the only `packages/sim` change, if any |
| S1 | `mission-save.ts`: the record, `suspendMission`/`readSuspended`/`discard`, gzip/base64, the verified write, every refusal; G2, G3, G4, G5, G6 | 3 | pure, no DOM; every refusal tested |
| S2 | **Extract `buildMissionWorld(inputs)` from `bootBattlefield`** and add `resumeMission(record)`; land paused; the shell record applied; G7, G8 | 4 | the risk: boot is one closure of several thousand lines of state (`mission`, `runtime`, `loanedForce`, the dock, the intro, the deploy selection). The extraction must leave a normal boot byte-identical, so it goes first and alone, proven by the existing `ui:routes` and playtest |
| S3 | The witness: G1 on three missions, added to `pnpm test:determinism` beside the two snapshot-witness specs | 2 | red-then-green mutations in the commit |
| S4 | UI: the pause button, the Resume card (menu and campaign), the refused state, the garage line, strings, pseudo capture | 2 | |
| S5 | Docs: CLAUDE.md storage line (one key, one reader), `shell-and-ui.md`, `sim-and-orders.md`; the privacy page needs nothing | 0.5 | |

## 9. Decisions for the lead

| # | Decision | Recommendation |
|---|---|---|
| D-S1 | Build strictness: exact build, or a hand-bumped `SIM_EPOCH` guarded by the golden pins (§4.3) | **The epoch**, with the build recorded; exact build as the fallback |
| D-S2 | Device-local only, never synced, in its own key (§5) | **Yes**; a cross-device save is a separate design |
| D-S3 | A silent checkpoint on every pause (so a closed tab loses at most the time since the last pause)? | **Not in v1.** Add after S4 if testers lose missions; the encode is milliseconds, the cost is a bigger surface and a stale-save risk |
| D-S4 | One save, overwritten, deleted at mission end (§3) | **Yes** |
| D-S5 | A garage/Stores purchase while a mission is suspended ends it, with a warning line (§5.3) | **Yes**; the alternative corrupts the campaign write |
| D-S6 | The size cap: 128 KiB gzipped, fixed after S0 measures real missions | **Yes**, provisional |

## 10. What this does not do

- It does not save the tutorial, the sandbox or a versus room.
- It does not sync a mission across devices or hold one on the server.
- It does not make a save survive a change to the sim that its epoch (or the build) marks incompatible; it refuses with a message.
- It does not change a column, the hash, or the golden pins. If S0 adds `SIM_EPOCH`, that is a constant and a test.
- The tester criterion, if any, is the testers'; this note cannot meet it.
