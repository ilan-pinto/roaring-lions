# N2 prerequisites outside `packages/sim`: the versus-runtime decision, a short plan, and what N2 needs from Lane C

**Status:** proposal, docs only. Nothing here is ruled. Every "Lead decision needed" item states a
recommendation first.

**Spec:** `docs/superpowers/specs/2026-10-10-network-game-design.md`, §7.1 (sim changes), §9 (N2 row),
§10 (decisions 18, 19), §11b.3 (N4 rulings D7, D8), §11b.4 (N2's prerequisites, sim surfaces).
**Lane C:** `2026-10-04-stage4-order.md` (one plan in `packages/sim` at a time; order F1 → F3 → F2 →
F4 → vehicle spacing). **Read against** `main` `05492a63` (15 Oct): F1 landed (#625), the garrison
overhaul landed (#606), N4a landed (#619), F3 is in flight (`feat/gf3-pop-cap`), N4b is PR #632.

---

## 1. The question

§11b.4 item 5: **should a versus room run a `MissionRuntime`, and if so which one?** Today it runs
none, and the code says exactly what that means:

- **The boot.** `buildMatchWorld` (`packages/app/src/net/match-world.ts`) builds the sim, terrain,
  tunnels and the base-ladder types, then spawns both forces through `versusSpawns`. In `main.ts`,
  `runtime` stays `null` because `startMission` runs only `if (resolvedMission)`, and a room's kit is
  `bootKit = {}` (~L1483).
- **The hash.** `runFrames` (`net/frame-step.ts`) reports `matchDigest(sim.hash(), 0, config.dataDigest)`,
  with the runtime digest hard-coded to 0. The room mints `dataDigest: 0` (`packages/worker/src/match/match-room.ts`
  ~L372). `matchDigest` is in `packages/net/src/digest.ts`.
- **The result and the board.** `net/outcome.ts` (annihilation, stalemate, the 30,000-tick cap,
  force value) and `net/scoreboard.ts` read sim state only. No runtime is consulted.
- **Intel.** `SeatWorld.versus` drops `callStrike` and `reveal` (`packages/net/src/ownership.ts`),
  because only a runtime prices them (#559).
- **The arena.** Decision 19 and N4 D7 already score win rate and report the scoreboard in place of
  Conduct. N4b's arena needs no runtime.

What a runtime would bring is **single-sided by construction** (`packages/sim/src/mission.ts`):

- one purse (`logisticsValue`, `intelValue`, still JS floats; `economyHash` hashes their floor);
- `requestSupport` queues `reveal` with `side: 0` and takes its caller from `playerIds`;
- Conduct and ROE score side-0 actors only (`destroyed`, `nearMiss`, `strike`, `fire` handlers, ~L1636–1694);
- `unitLost`, `identifiedBy`, `routeFoundBy` and `contributed` are side-0 only (~L1216–1262);
- `checkEnd` never wins with no primaries and never wipes with an empty `playerIds`. Only an ROE
  collapse or `time_limit_s` ends it, which is a second end rule beside `outcome.ts`;
- patrols (`stepPatrols`) live in the runtime, so `setStance{patrol}` has no executor without one.

The per-side surfaces a two-seat runtime needs are arriving in Lane C anyway: F3 adds `popCaps` per
side, F2 adds a side-1 purse (`enemyLogisticsAcc`), and F4 adds production lines per anchor per side.

**And one side-0 rule bites in versus today, with no runtime involved.** `Sim.selectBreachTarget`
(`sim.ts` ~L3752) returns early for `side === 0`. So in a mirror match, seat 1's units auto-breach
walls and seat 0's never do. A seat-1 unit cuts a wall when all of these hold: it has no live target,
or only one across a low structure (the `distracted` test at the call site, ~L4124); it carries a
structure-damaging weapon (`STRUCT_DAMAGE[w.cls] !== 0`) with the wall in reach; the wall is
ungarrisonable, unoccupied, not protected, and inside `BREACH_RANGE_SQ`; and, if the unit is
moving on a live field, the detour test says going round costs more than `BREACH_DETOUR_SLACK`. A
unit **standing still** skips the detour test (the method's own "standing still is not a reason to
stop" half). That appears to **favour** seat 1, the reverse of §2.2's "mildly unfair to the side-1
seat". The effect on results has not been measured (P6).

## 2. Options

| | **A. Minimal versus runtime in N2** | **B. Seat-ready N2; versus runs no runtime until N3** | **C. Defer seat work to N3** |
|---|---|---|---|
| What N2 does | Synthesises a versus "mission" (no objectives, the room's forces, economy/ROE hooks), runs it in rooms, makes purse, support, Conduct and `unitLost` per side | Seat table in the sim (`humanHeld`, breach rule); `build`/`support`/`setStance` as `Command`s; `runtime.digest()`; integer purse. Single-player keeps side 0 as the human seat. A room still runs none | `runtime.digest()` and the commands only; side-0 rules untouched |
| Sim work | Largest: per-side purse and intel ahead of F2/F4, which build their own per-side state; two Conduct ledgers in a mirror; reconcile `checkEnd` with `outcome.ts` | Medium: one rule site in `sim.ts`, the side-0 sites in `mission.ts` re-keyed through a table whose default is today's behaviour, three command kinds, one digest | Small |
| Golden hash | Sim pins neutral (no golden replay builds a runtime), but every runtime pin and the versus mirror pins move, and N3 moves them again when F2–F4's per-side state replaces N2's | Expected **neutral** on the sim pins (the default table is today's rule). A new digest pin is born. The mirror pins move only if P6 finds a side-1 breach in their 200 ticks | Neutral |
| Protocol | `runtimeDigest` non-zero in every room from N2. A float purse becomes a desync surface unless F2 Task 1 lands first | Seam wired (P2) and folding 0 in rooms. Non-zero only when N3 starts a runtime | As B |
| UI | Purse, support menu and Conduct in versus HUD and debrief, all new in rooms | None in rooms. The command path replaces two direct calls in single-player | None |
| Arena (decision 19) | Conduct becomes reportable, but D7 already ruled the scoreboard in its place | Unchanged (D7) | Unchanged |
| Risk | Builds per-side state twice, once ahead of the plans that own it; a ROE "defeat" inside a match that `outcome.ts` says is ongoing | The seat table is exercised by single-player only until N3; the breach rule is the one live versus effect | The breach asymmetry stays in every versus match until N3 (Jan–Feb 2027); N3 grows |

**B departs from the spec's "the golden hash moves once"** (the §7.1 heading, the §9 N2 row and
§11b.4's "The pins" bullet). Under B, every sim-side change keeps today's behaviour for side 0 as the
human seat. The golden replay issues none of the new commands and builds no runtime. So the
expectation is that no sim pin moves. If one does, it is a defect to explain, not the planned move.
P7 corrects the spec.

## 3. Recommendation

**Lead decision needed (L1): option B.** N2 makes the sim seat-aware and the runtime
network-hashable. A versus room keeps running no `MissionRuntime`, and the first versus runtime is
N3's opening task, built on the per-side state F2–F4 deliver. The reasons:

- **A would build per-side economy twice.** F2 and F4 own the second purse and production per side,
  and N2 cannot start before F3 lands. A runtime in a mirror room today buys no gameplay either:
  decisions 24 and 25 settle a match on force value, and neither seat has production until F4.
- **C leaves a live defect.** The breach rule is the one side-0 literal that changes versus play now,
  and it is a one-site sim fix that N2 can land with the seat table.
- **B leaves N3 a short list:** a versus rules file, per-side purse and support on F2/F4's state, and
  the Conduct seat. The commands and the digest it needs are already in place and pinned.

Sub-points, each also needing the lead:

- **L2. Per-seat unit types leave N2 (recommended), if P5 confirms they need no sim code.**
  `Sim.addUnitType` (`sim.ts` ~L1430) appends with no id check, so seat 1's patched roster can be
  registered a second time under the same ids. `outcome.ts` and `scoreboard.ts` look costs up by
  `unitTypes[...].id`, which still resolves. What remains is app work (`buildMatchWorld`, a type map
  per side) and render work (`unitKitTiers` is keyed by type id), landed with "bring your brigade".
- **L3. `setStance` in N2 ships `hold` and `ambush` only (recommended).** `ambush` routes to
  `Sim.setAmbush` (`sim.ts` ~L1901). `patrol` needs the runtime's `stepPatrols`, so it moves to N3.
- **L4. The data digest is folded by each client from its own content (recommended)**, rather than
  minted by the room. The Worker imports `@lions/data` only for its telemetry subpath, never the
  unit, structure or map content a digest would cover. And a room-minted constant that both clients
  fold cannot catch two clients with different data. This rewords §11b.4's "the room's
  `dataDigest: 0` becomes a real digest".
- **L5. Schedule: N2 directly after F3, carrying F2 Task 1 as its first task (recommended).** F2
  then starts at its Task 2. See §5.
- **A restatement of CLAUDE.md's rule, not a new ruling:** when N3 builds the versus runtime, its rules are data (a schema-validated file, mission-shaped
  or its own), never a mission synthesised in TypeScript. CLAUDE.md: missions are declarative data.

## 4. Plan: the prerequisites that do not touch `packages/sim`

**Goal:** everything on option B's path that lives in `packages/net`, `packages/app`, `tools/` and
`docs/`, landed before N2's Lane C slot, so N2's sim PR only adds sim code and wires it.
**Constraints:** no file under `packages/sim/` changes. `pnpm test:determinism` and the versus mirror
pins (`versus-force.test.ts`: 580559085 / 1260439781) do not move. Single-player is byte-identical.
Git by absolute `/usr/bin/git` with a pathspec. No local `pnpm ui:routes`, and no dev server killed.
Each check arrives with its falsification, watched red.

**P1. The command whitelist is pinned both ways.** `packages/net/src/protocol.ts`.
`COMMAND_KINDS` is `satisfies readonly Command['kind'][]`, which catches a stray kind but not a
missing one. Add a type-level assertion that `Exclude<Command['kind'], (typeof COMMAND_KINDS)[number]>`
is `never`. This turns §11b.4 item 4 into a compile error for any Lane C plan, F4's `rally` if it
becomes a `Command`, and N2's three kinds.
*Check:* `tsc` green. *Falsify:* drop `'attack'` from the list, and `tsc` goes red naming it.

**P2. The runtime-digest seam.** `packages/app/src/net/frame-step.ts` (+ test) and the harness's
call site in `tools/src/net/agent-client.ts`. `FrameStep` gains `runtimeDigest?: () => number`, absent meaning 0, and
`runFrames` folds it in place of the literal `0`. N2 then wires `runtime.digest()` in one line.
*Check:* the two-client tests (`tools/src/net/two-client.test.ts`) and `frame-step.test.ts` stay
green, and the reported hashes are unchanged. *Falsify:* give one client a digest that returns the
tick, and the two-client test reports a desync at tick 19.

**P3. The data digest (L4).** A pure `contentDigest()` over the shipped unit, structure and map JSON,
in key-sorted order, beside `match-world.ts`. `runFrames` folds it in place of `config.dataDigest`.
*Check:* stable across two processes. Equal in browser and Node, with the browser half run by
CI's `net:engines` job (`tools/src/net/two-engine.ts`: Chromium, Firefox and WebKit), never by a
local `ui:routes`. *Falsify:* one client built
with one unit's `hp` changed desyncs at the first hash tick. Hash it in insertion order, and a
re-ordered but equal JSON turns the stability test red.

**P4. The seat table, net side.** A pure `seatRules(config: MatchConfig | null)` in `packages/net`,
returning `{ humanHeld: [boolean, boolean] }`. Single-player gives `[true, false]` (today's rule); a
versus room gives a seat's side `true`; a sandbox room gives `[true, false]`. N2's sim takes this
table as given; the sim never reads a config.
*Check:* the unit tests for each of the three modes. *Falsify:* return `[true, false]` for versus,
and the versus case goes red.

**P5. The per-seat types spike (L2).** A test only, in `packages/app/src/net/`. Register a second,
patched copy of the KDF roster for side 1 (one track at tier 1) and spawn the mirror through a
per-side type map. Assert three things: two runs give equal hashes; `forcesOf` and `scoreOf` still
price every unit; side 1's patched unit carries the patched HP.
*Falsify:* point side 1 at side 0's type ids, and the HP assertion goes red. **If any of it needs a
sim edit, stop:** the item stays in N2.

**P6. The breach asymmetry, measured.** `tools/src/backtest/versus-probe.ts` (report-only, as
today). Per mirror game, count the ticks on which a unit has a breach target (`state.curStructure`
set on a wall with no `demolish` order), by side. Also report whether any falls inside the mirror
pins' first 200 ticks.
*Check:* side 0 reads 0 by construction (`selectBreachTarget`'s early return). *Falsify:* count
`curStructure` on garrisonable structures too, and side 0 stops reading 0. Post the numbers on the
N2 issue: they say whether the N1 mirror readings (#596, #600) carry a side bias.

**P7. The spec follows the ruling.** After L1–L5 are ruled, update the spec to match: §7.1 (its
heading's "the golden hash moves once"), the §9 N2 row, §11b.4 item 4 ("before N2 adds its four":
three now, `build`, `support` and `setStance`, since F1 replaced `sweep`/`strike`), item 5,
§11b.4's "The pins" bullet, §2.2's breach wording (from P6's reading), and decision 19's note.
*Check:* grep every cited symbol against `main` and confirm each one is found.
*Falsify:* plant a citation to a symbol that does not exist (`MissionRuntime.noSuchMethod`), and the
grep reports it missing.

## 5. What N2 needs from Lane C

| # | What | Why N2 needs it | Owner | Order | Moves the sim pins? |
|---|---|---|---|---|---|
| 1 | Garrison overhaul (`losRay`, `stepGarrison`, `detectionPair`) | N2 starts from the tick it rewrote | #606 | **landed** 14 Oct | landed, done |
| 2 | `economyHash`, `ECONOMY_PIN*`, `requestSupport(kind)` and `SupportKind` | `runtime.digest()` composes `economyHash`. The `support` command wraps `requestSupport` (F1 replaced §7.1's `sweep`/`strike` pair) | F1 | **landed** #625 | landed, done |
| 3 | Pop cap: `requestBuild` and `buildBlockedReason` with the cap refusal, `popCaps` per side, economy re-pin | the `build` command wraps F3's `requestBuild`, not today's | F3 | **in flight**, N2 waits for it | economy pins once (F3's own) |
| 4 | Integer purse (`logisticsAcc` in 1/2400ths) | a float purse must not reach a network hash (§7.1) | F2 Task 1, carried as N2 Task 1 (L5) | with N2, before F2 Task 2 | no: golden builds no runtime; economy pins hash the floor; `playtest` byte-identical (F2 Task 1 Step 3) |
| 5 | No new `Command` kind in flight elsewhere | net's whitelist and ownership checks change in the same PR as the union | Lane C rule; P1 enforces it | throughout | — |
| 6 | Seat table in the sim: `humanHeld[side]`; `selectBreachTarget` asks it; triggers, waves and the commander skip a human-held side | breach parity in versus now; N3's Sarim seat later | N2 | after 3 and 4 | expected no (default table = today); versus mirror pins only if P6 finds a side-1 breach in 200 ticks |
| 7 | `mission.ts`'s side-0 sites re-keyed through the table (`unitLost`, `identifiedBy`, `routeFoundBy`, `contributed`, the Conduct actor, zone contest, `from_ledger`) | N3's versus runtime reads them per seat | N2 | with 6 | no (default table); runtime pins re-checked |
| 8 | `build`, `support`, `setStance` (`hold`/`ambush`, L3) as `Command`s, plus `COMMAND_KINDS`, `cleanCommand` and `validateCommand` in the same PR | the three direct runtime calls become tick-stamped input (§7.1) | N2 | after 3 (build) and 2 (support) | golden no (it issues none). A `build` applied at tick start rather than between ticks may shift `playtest` lines by one tick: measured, and stated in the commit |
| 9 | `MissionRuntime.digest()`: `economyHash` plus objectives, triggers, waves, Conduct and civilian latches, wired through P2 | the network hash must see runtime state once N3 runs one | N2 | with 8 | no; a new `RUNTIME_DIGEST_PIN` is born |
| 10 | Side-1 purse and held zones | a versus purse per seat | F2 (rest) | after N2 | not N2's need under B; N3's |
| 11 | Production lines per side | the Sarim `build` from the doctrine menu (§6.1) | F4 | after F2 | N3's |
| 12 | Per-seat unit types | "bring your brigade" | app and render, if P5 confirms (L2); else N2 | any time | no sim pin |

**Scheduling.** N2 cannot start until F3 has merged with `gates` and `determinism` green (rows 3 and
5). It needs nothing from F2 beyond Task 1 and nothing from F4 (rows 4, 10 and 11). **Recommended
(L5):** cut N2 from `main` straight after F3. It opens with F2 Task 1 (the integer purse,
hash-neutral) and then rows 6–9, and F2 resumes at its Task 2 after N2. On the stage 4 calendar that
puts N2 in F2's old slot and pushes F2, F4 and vehicle spacing back by N2's length (one plan,
roughly 8–10 tasks). If the lead would rather keep the economy on its dates, N2 goes after F2 and
skips row 4: nothing in rows 6–9 needs F2's zones. P1–P7 can all land before then, since none
touches `packages/sim`.
