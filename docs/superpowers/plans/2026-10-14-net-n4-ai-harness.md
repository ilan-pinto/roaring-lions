# N4 · AI Harness and Arena Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An AI joins a versus room as another client. It is a headless Node
harness that keeps its own `Sim` in step from the room's frames. It serves MCP
over stdio (`observe`, `order`, `say` …) on top of the N1 JSON protocol, in
three scopes: `advise`, `assist` and `command`. The game's advisor panel is its
face. Two harnesses in a paced room are an arena, scored on win rate with
sides swapped.

**Architecture:** Nothing in `packages/sim` changes. The harness builds the
same world as the browser, from the same `MatchConfig`. To make that true, the
versus boot moves out of `main.ts` into one DOM-free function that both call.
The harness then runs frames through the same `runFrames` and
`validateCommand` the browser uses.

The room learns three things:
- a seat may be `kind: 'bot'`;
- `pace: 'paced'` rounds, gated on `done{round}`;
- an **advisor socket**: a third socket for a seat, admitted by a ticket that
  seat mints. It relays `advisor` messages to and from its own seat only, and
  never stamps an order.

An `assist` proposal becomes an order only when the human's browser sends it
as its own `cmd`. The arena runs on a **local relay**: the real Worker routes
and the real `MatchRoom`, hosted in Node over the existing `fake-do.ts`. It
writes no billed row, needs no secret and touches no network.

**Tech Stack:** TypeScript strict, vitest (node and jsdom), `@lions/net`, the
Worker's `MatchRoom` and routes, and two new tools-only dependencies, each
pinned to an exact version (decision D3):
- `ws` (Node WebSocket client and server, with an `Origin` header);
- `@modelcontextprotocol/sdk` (the MCP stdio server and, for tests, the client).

**Spec:** `docs/superpowers/specs/2026-10-10-network-game-design.md`. Read
§8 (the harness and arena), §3.2.7 (paced mode), §3.5 (security), §10
decisions 7, 8, 18 and 19, and **§11b (N1 as built, the rulings of 13–14 Oct,
and what N4 inherits). §11b outranks the older sections wherever they differ.**
Builds on `main` `f4b3ea2b` or later: N0 #543, N1a #554, N1b #556/#558,
#562/#563/#566, #579, #587, #589, #596 and #600.

## Global Constraints

- **No file under `packages/sim/` changes.** `pnpm test:determinism` stays
  green against the pins on the `main` this branch starts from. If a task seems
  to need a sim change, stop and raise it. That work is N2's (spec §11b.4).
- **The four invariants** (CLAUDE.md). The harness reads sim state and queues
  `Command`s only through `applyFrame`, the same path the browser uses.
  Nothing outside the sim mutates sim state.
- **Dependency direction.**
  - Shipped code: `app → render → sim`, `app → net → sim`, `worker → net`.
  - The Worker never imports `@lions/sim`.
  - Nothing in `packages/render` imports `packages/net`.
  - `tools/` may import `packages/app/src/**`, `packages/render/src/three/fog.ts`
    and `packages/worker/src/**` by relative path. `tools/src/net/*.test.ts`
    and `versus-probe.ts` already do. Decision D2 extends this to a
    non-test tool, the local relay.
- **No battle state on the wire, ever** (spec §7.3). An `advisor` message
  carries text, a tile ping, or a proposed `Command` cleaned by `cleanCommand`.
  The room never stores it and never stamps it into a frame.
- **Security caps from #566 hold for every new client and message** (spec
  §11b.2):
  - messages ≤ `MAX_MESSAGE_BYTES` (4,096);
  - ≤ `MAX_CMDS_PER_SEAT_PER_FRAME` (4) commands per frame; ≤ 12 pending;
    a 20/20 token bucket; ≤ 256 ids per command;
  - ≤ 2,000,000 characters of command JSON per room;
  - per socket: 160 messages at once and 80 a second;
  - ≤ `MAX_ROOM_SOCKETS` (8) live sockets a room; a hello within 10 s;
  - `Origin` required; the ticket rides in the first message, never in a URL;
  - `callStrike` and `reveal` dropped in versus.

  An advisor socket counts toward the 8 and spends the same per-socket bucket.
- **Workers Free row budget** (R-N12): 2.2 rows/s per match at one order a
  second from each seat. A bot seat must cost no more than a human:
  - at most one command flush per 20 ticks, of at most 4 commands (Task 3);
  - advisor traffic, `done` and the paced wait write **zero** rows;
  - Task 7 pins both with the room's own `rowsWritten`.
- **No secrets in the repo, ever.** The local relay mints its `TICKET_SECRET`
  in memory at start, from `crypto.randomBytes(32)`; it is never logged and
  never written. The arena never reads an API key: an external player command
  inherits the parent environment, and whatever auth that client uses stays
  the user's. Tickets the arena hands to child processes go in a temp
  directory with mode 0700, files 0600, removed at exit. No production URL,
  key or ticket in tests or docs examples; the examples use
  `https://<your-worker>` and `ABC123`.
- **No deploys, no production access, no `wrangler` remote command** from any
  task. A migration (Task 15 only) is a lead action stated in the PR body.
- **MCP stdout is the protocol channel.** The harness writes every log line to
  **stderr**. One stray `console.log` corrupts the session.
- UI: strings through `t()` in `packages/app/src/i18n/en.json`; colour only
  through semantic tokens; advisor and chat text reach the DOM through
  `textContent` only; `pnpm validate:ui` green.
- Git: `/usr/bin/git` by absolute path, one plain command per call. Commit with
  `/usr/bin/git commit -s -F <msgfile> -- <paths>`. Never `git add -A`, never
  `git stash`, never `git checkout -- <file>`, never rebase or force-push.
  Messages end with a blank line and
  `Co-Authored-By: Claude <model name> <noreply@anthropic.com>`.
- **Never start or kill a dev server or `wrangler dev` from a subagent.**
  Never `pkill`. `pnpm ui:routes` and `pnpm golden-baseline` run on CI only.
  Test browsers start with music off. The local relay is not a dev server: it
  is started and stopped by the test or the arena process that owns it, on an
  OS-assigned port (`listen(0)`).
- **Every check arrives with its falsification, watched red, in the task**
  (CLAUDE.md, "Every check gets an input that makes it fail"). The cheapest
  falsification is a one-line mutation of the implementation. Each task's
  commit message lists its mutations and what went red.
- Tasks are signed off one by one; the PRs merge without squashing.
- **Two PR series:**
  - N4a, Tasks 1–10: the harness, the room and the advisor.
  - N4b, Tasks 11–16: the arena.

  N4b starts after N4a has merged.

## Lead decisions (recommendation first; all ruled 14 Oct)

| # | Question | Recommendation and ruling |
|---|---|---|
| D1 | Who may invite an advisor, and is the opponent told? | Either seat invites its OWN advisor (the seat mints the advisor ticket from its own seat ticket); both seats see an "advisor: advise/assist" badge on each seat card and in the HUD. One advisor per seat. **Ruled 14 Oct (lead): accepted.** |
| D2 | May a non-test tool (`tools/src/net/local-relay.ts`) import `packages/worker/src/**`? CLAUDE.md says of `worker/` "Nothing imports it". | Yes, from `tools/` only. The alternative is moving the room into `packages/net`, a large refactor of shipped code for a dev tool. A test (Task 11) pins that no file under `packages/app`, `render`, `net` or `sim` imports `packages/worker`. **Ruled 14 Oct (lead): accepted.** |
| D3 | Two new tools-only devDependencies: `ws` and `@modelcontextprotocol/sdk`. | Yes, each at an exact version at least 14 days old, recorded in the commit. They live in `tools/package.json` only, and no shipped bundle gains a byte. The fallback for the SDK is a hand-rolled newline-delimited JSON-RPC server (~150 lines). **Ruled 14 Oct (lead): accepted.** |
| D4 | A bot seat's order cadence. | At most one flush per 20 ticks (1 s), of at most 4 commands; a queue of 12. Above that `order` answers `queue_full`. This holds a bot at the 2.2 rows/s the lead accepted for a human. **Ruled 14 Oct (lead): accepted.** |
| D5 | Paced mode rules. | The room mints `paced` only when at least one seat is `kind: 'bot'`; otherwise it mints `realtime`. Human seats are never waited for. `roundTicks` is clamped to 20–1,200 and `roundWallMs` to 1,000–600,000. **Ruled 14 Oct (lead): accepted.** |
| D6 | Remote arena results: the D1 `matches` table and `/stats/arena` (spec §8.5). | Not now. The arena runs locally and writes a JSONL file and a markdown table. Task 15 is gated on a later "yes", because it costs one D1 row per versus match and a migration. **Ruled 14 Oct (lead): accepted — not now; Task 15 is deferred.** |
| D7 | Arena scoring with no `MissionRuntime` in versus (so no Conduct). | Each seed is played twice with seats swapped. Score = (wins + ½ draws) / non-void games. Report per side and per faction, plus the scoreboard (decision 25) in place of Conduct. Tokens are reported when the external client prints them, never scored. **Ruled 14 Oct (lead): accepted.** |
| D8 | The built-in opponent until the doctrine commander (WP-G-G0) exists. | Two scripted, fog-respecting baselines: `passive` and `rush`. `rush` attack-moves on what it sees, else on the enemy camp, the anchor a human also knows from the map. They are the arena's controls, not a strong AI. **Ruled 14 Oct (lead): accepted.** |
| D9 | The Node harness sends an `Origin` header. | It sends the server's own origin. The Origin check is a browser cross-site guard, not authentication; the seat ticket is the authentication. The run protocol says so in one line. **Ruled 14 Oct (lead): accepted.** |
| D10 | An advisor's socket receives the full frame stream (like any client) while its `observe` view respects fog. | Accept, under the friends-only posture (decision 22). The harness enforces fog for the MODEL. A modified harness could see through fog, exactly as a modified browser can. **Ruled 14 Oct (lead): accepted.** |
| D11 | The veto key for an `assist` proposal. | `X` (free since #535; `N` is move-only and `V` stays free). Enter or a click on Accept takes it at once. **Ruled 14 Oct (lead): accepted.** |

## Review Focus

1. **A model orders an enemy's id, a fogged id, or a unit that died since its
   last `observe`.** Expected: `validateCommand` drops it on both machines.
   The order ledger reports it `dropped`. `observe` never names a unit the
   side cannot see. Pinned in Tasks 2, 3 and 8.
2. **A model calls `order` 100 times in one second.** Expected: the desk
   queues 12 and answers `queue_full` after that, and flushes 4 per second.
   The room's token bucket never trips, and rows per second stay inside the
   R-N12 bound. Pinned in Tasks 3 and 7.
3. **The harness runs from a different commit than the browser.** Expected:
   the room refuses its hello with `build_mismatch` (4002). The harness exits
   non-zero with a one-line message naming both builds. It never plays a match
   on a different world. Pinned in Task 4.
4. **An advisor socket sends `cmd`, `ready`, `pause`, `surrender`, `hash`,
   `ack` or `bye`, or a seat socket sends a `proposal`.** Expected: ignored,
   with no state change and no frame. An advisor's disconnect never stalls the
   room and never starts a forfeit. Pinned in Task 7.
5. **In a paced room the bot never sends `done`** (the model hung), or a human
   is the only other seat. Expected: the room releases the round after
   `roundWallMs`, and a human seat is never waited for. Pinned in Task 6.

---

## File Structure

**Create**
- `packages/app/src/net/match-world.ts`: `buildMatchWorld(config)`, the one
  versus world builder (browser and harness).
- `packages/net/src/advisor.ts`: `AdvisorMsg`, `cleanAdvisorMsg`,
  `advisorMayRelay`.
- `tools/src/net/fog-tracker.ts`: per-tick fog of one side, through
  render's `computeFog`.
- `tools/src/net/view.ts`: `sideView`, the fog-respecting JSON view of one
  side.
- `tools/src/net/test-config.ts`: the `versusConfig` fixture for every tools
  test.
- `tools/src/net/order-desk.ts`: the coalescing order queue and the order
  ledger.
- `tools/src/net/build-id.ts`: the `<version>+<commit>` build string, as
  vite makes it.
- `tools/src/net/node-socket.ts`: a `SocketLike` over `ws`, with `Origin`.
- `tools/src/net/agent-client.ts`: the headless client (seat or advisor).
- `tools/src/net/mcp-tools.ts`: the tool handlers, pure over an
  `AgentClient`.
- `tools/src/net/agent.ts`: the `pnpm agent` CLI and the MCP stdio server.
- `packages/app/src/ui/advisor.ts`: the advisor panel and proposal strip.
- `tools/src/net/local-relay.ts`: the Worker routes and `MatchRoom` in Node.
- `tools/src/net/players.ts`: the `passive` and `rush` baselines and the
  in-process player.
- `tools/src/net/arena-score.ts`: game records, tally with swapped sides.
- `tools/src/net/arena.ts`: the `pnpm arena` CLI.
- `tools/src/net/external-player.ts`: the `cmd:` player and its MCP config.
- `tools/src/net/arena-prompt.md`: the standing prompt an external model
  gets.
- `tools/src/net/test-mcp-client.ts`: a model-free MCP client for tests (the
  `rush` policy over MCP).
- `docs/net/N4-agent.md`: the run protocol (advisor with a friend, bot
  opponent, arena).

**Modify**
- `packages/app/src/main.ts`: the versus branch calls `buildMatchWorld`.
- `packages/app/src/net/frame-step.ts`: `beforeFrame?` hook.
- `packages/net/src/{protocol,ws-transport,index}.ts`.
- `packages/worker/src/match/{ticket,routes,room-core,match-room}.ts`.
- `packages/app/src/ui/versus.ts`, `packages/app/src/net/connect.ts`,
  `packages/app/src/i18n/en.json`, `packages/app/src/input/keymap.ts`.
- `tools/package.json`, root `package.json` (`agent`, `arena` scripts),
  `pnpm-lock.yaml`.
- Task 15 only, deferred (D6 ruled "not now", 14 Oct): `packages/worker/migrations/0006_matches.sql`,
  `packages/worker/src/stats.ts`, `packages/worker/QUERIES.sql`.

---

## Phase A: the headless client (no Worker change)

### Task 1: One versus world builder for the browser and the harness

The harness must build byte for byte the world the browser builds. Today the
versus boot is a sequence of statements in `bootBattlefield` (`main.ts`: `new
Sim` ~L1801, `applyTerrain`, `standMapStructures`, `sandboxAnchors` ~L1819,
the tunnel loop, the type registration from `upgradePrepass(roster,
{}).registered` ~L1476/L1857, `versusSpawns` ~L1961). A copy in `tools/` would
drift silently. Move it into one function, and have `main.ts` call it.

**Files:**
- Create: `packages/app/src/net/match-world.ts`
- Modify: `packages/app/src/main.ts` (the versus branch only)
- Test: `packages/app/src/net/match-world.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface MatchWorld {
    sim: Sim;
    typeOf: Map<string, number>;
    mapJson: MapJson;
    anchors: SandboxAnchors;
    factions: [Faction, Faction];
    /** Entity ids each side spawned with, by side. */
    bySide: [number[], number[]];
  }
  /** The world a versus room plays, from its config alone. Throws on a
   *  sandbox config or a map that is not shipped. */
  export function buildMatchWorld(config: MatchConfig): MatchWorld;
  ```

- [ ] **Step 1: Audit.** List every statement in `bootBattlefield` between
  `new Sim(` and the first `runFrames` call that WRITES sim state on a versus
  boot (`netConfig?.mode === 'versus'`, no mission, no sandbox flag). Put the
  list in the task report. Expected writers: `new Sim`, `applyTerrain`,
  `standMapStructures`, `addTunnel` (the map's own routes; `wantTunnel` is
  refused in a room), `addUnitType` in `prepass.registered` order, and
  `versusSpawns`. If anything else writes (for example a renderer `init()`
  that seeds a snapshot), stop. Either it belongs in `buildMatchWorld`, or it
  is presentation that writes no hashed state; prove which with `sim.hash()`
  before and after.
- [ ] **Step 2: The failing test.**

  ```ts
  // packages/app/src/net/match-world.test.ts
  import { describe, expect, it } from 'vitest';
  import { validateConfig, type MatchConfig } from '@lions/net';
  import { buildMatchWorld } from './match-world';

  function config(map: string, factions: ['kdf' | 'sarim', 'kdf' | 'sarim'], seed = 1234): MatchConfig {
    const seat = (s: 0 | 1) => ({ seat: s, side: s, faction: factions[s], kit: 'matched', tiers: {}, unlocks: [], player: `p${s}`, callsign: `c${s}`, kind: 'human' });
    const c = validateConfig({ matchId: 'M', code: 'ABCDEF', seed, map, mode: 'versus', seats: [seat(0), seat(1)], pace: { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: 'b', dataDigest: 0 });
    if (c === null) throw new Error('bad fixture');
    return c;
  }

  describe('buildMatchWorld', () => {
    it('reproduces the mirror pins versus-force.test.ts holds (beit, tel; 200 ticks)', () => {
      // LITERALS, copied from versus-force.test.ts at main f4b3ea2b (seed 20260727, 200 ticks).
      // An oracle that imports its expectation from the code under test cannot fail (CLAUDE.md).
      // If a sim change has re-pinned versus-force.test.ts since, copy its CURRENT values.
      for (const [map, pin] of [['beit_sahwan_outskirts', 580559085], ['tel_marum', 1260439781]] as const) {
        const w = buildMatchWorld(config(map, ['kdf', 'kdf'], 20260727));
        for (let i = 0; i < 200; i++) w.sim.tick();
        expect(w.sim.hash()).toBe(pin);
      }
    });
    it('is a function of the config alone: two builds agree, a different seed differs', () => {
      const a = buildMatchWorld(config('wadi_tarfan', ['kdf', 'sarim']));
      const b = buildMatchWorld(config('wadi_tarfan', ['kdf', 'sarim']));
      const c = buildMatchWorld(config('wadi_tarfan', ['kdf', 'sarim'], 99));
      for (const w of [a, b, c]) for (let i = 0; i < 100; i++) w.sim.tick();
      expect(a.sim.hash()).toBe(b.sim.hash());
      expect(c.sim.hash()).not.toBe(a.sim.hash());
    });
    it('spawns each side its faction force on its own anchor', () => {
      const w = buildMatchWorld(config('tel_marum', ['sarim', 'kdf']));
      const types = (ids: number[]) => new Set(ids.map((i) => w.sim.unitTypes[w.sim.state.typeIdx[i]].id));
      expect(types(w.bySide[0]).has('atgm_cell')).toBe(true);
      expect(types(w.bySide[1]).has('mbt_lavi')).toBe(true);
      expect(w.bySide[0].every((i) => w.sim.state.side[i] === 0)).toBe(true);
    });
    it('refuses a sandbox config', () => {
      expect(() => buildMatchWorld({ ...config('tel_marum', ['kdf', 'kdf']), mode: 'sandbox' })).toThrow(/versus/);
    });
  });
  ```
  The pin literals: if `versus-force.test.ts`'s pins were taken through
  `buildWorld` (the test helper, which registers `Object.values(units)` with
  no prepass) and `buildMatchWorld` registers `upgradePrepass(roster,
  {}).registered`, the first test tells you whether the two registrations
  agree. If they do not, the BROWSER's path (prepass) is the truth: record the
  new value as `buildMatchWorld`'s own pin, and say in the commit why it
  differs from the helper's.
- [ ] **Step 3: Run it red.** Run `pnpm vitest run
  packages/app/src/net/match-world.test.ts`. Expected: FAIL, "Cannot find
  module './match-world'".
- [ ] **Step 4: Implement.** Move the audited statements into
  `buildMatchWorld`, in their `main.ts` order:
  - `parseMap(maps[config.map])`;
  - `new Sim({ seed: config.seed, width, height, capacity: 256 })`;
  - `applyTerrain`, `standMapStructures`;
  - the map's tunnels, with the same `addTunnel(route) === i` assertion;
  - `upgradePrepass(Object.values(units), {}).registered` →
    `typeOf.set(r.id, sim.addUnitType(r))`;
  - `sandboxAnchors(mapJson)`;
  - `versusSpawns(sim, typeOf, anchors, factionsBySide(config))`.

  In `main.ts`, the versus branch calls it and takes `sim`, `typeOf`,
  `anchors` and `bySide[me]` from the result. The single-player and sandbox
  paths keep their own statements unchanged.
- [ ] **Step 5: Run green.** Run `pnpm vitest run packages/app/src/net
  tools/src/net && pnpm typecheck && pnpm test:determinism`. All pass, and
  the determinism pins are unmoved.
- [ ] **Step 6: Falsify.** Make each of these one-line mutations, watch it go
  red, then revert:
  - swap `applyTerrain` and `standMapStructures`: the pin test should go red
    (if it stays green, record that the order is commutative and that the pin
    does not guard it);
  - drop the tunnel loop: red on any map with tunnels (name the map, or record
    that no fair map has tunnels);
  - pass `['kdf','kdf']` instead of `factionsBySide(config)`: the faction test
    goes red;
  - `seed: 20260727` instead of `config.seed`: the seed test goes red.
- [ ] **Step 7: Commit.** Run `/usr/bin/git commit -s -F msg.txt --
  packages/app/src/net/match-world.ts packages/app/src/net/match-world.test.ts
  packages/app/src/main.ts`.

### Task 2: The fog-respecting view of one side

`observe` must show a model what the seat's player sees, and no more. The fog
rule lives in `packages/render/src/three/fog.ts` (`computeFog`, `hasSight`,
`isFogVisible`). Those are pure functions that import nothing, and the
renderer recomputes fog every fourth snapshot (`ThreeRenderer.snapshot`). The
harness reuses those functions by relative import rather than copying them
(spec §11, "the two must share one function"). Moving them to `net` would
make `render` import `net`, which spec §7.3 forbids.

**Files:**
- Create: `tools/src/net/fog-tracker.ts`, `tools/src/net/view.ts`
- Test: `tools/src/net/view.test.ts`

**Interfaces:**
- Consumes: `buildMatchWorld` (Task 1); `computeFog`, `isFogVisible`
  (`packages/render/src/three/fog.ts`); `scoreOf`, `scoreFor`
  (`packages/app/src/net/scoreboard.ts`).
- Produces:
  ```ts
  // fog-tracker.ts
  export class FogTracker {
    constructor(sim: Sim, viewerSide: 0 | 1);
    /** Call once after every sim tick. Recomputes on the renderer's cadence (every 4th call, from the first). */
    step(): void;
    visibleTile(x: number, y: number): boolean;
  }
  // view.ts
  export interface UnitLine { id: number; type: string; tile: [number, number]; hp: number; flags: string[] }
  export interface ContactLine { id: number; type: string; tile: [number, number]; hp: number }
  export interface HeldLine { structure: number; tile: [number, number]; side: 0 | 1 }
  export interface SideView {
    tick: number; clock: string; side: 0 | 1; faction: Faction; map: string; size: [number, number];
    camp: [number, number]; enemyCamp: [number, number];
    units: UnitLine[]; contacts: ContactLine[]; held: HeldLine[];
    score: { mine: SideScore; theirs: SideScore };
    result: string | null;
  }
  export function sideView(w: MatchWorld, side: 0 | 1, fog: FogTracker, result: string | null): SideView;
  ```
  - `hp` is an integer percent of the type's hull HP.
  - `flags` ⊆ `['moving', 'pinned', 'routed', 'garrisoned', 'carried',
    'buried', 'immobile', 'disarmed']`, read from `moving`, `pinned`,
    `routed`, `garrisonedIn`, `carriedBy`, `tunnelIn`, `mobilityKilled` and
    `firepowerKilled`.
  - Tiles are `posX >> 16`; there are never world units.
  - A contact is an enemy (side 0/1, not the viewer's) that is alive, is not
    garrisoned, carried or buried, and stands on a fog-visible tile. That is
    `unitIsObserved` with the fog predicate, the renderer's own draw gate.
  - `held` lists structures with a garrison whose tile is visible: the banner
    a human sees (#592).

- [ ] **Step 1: The failing tests.**
  ```ts
  // tools/src/net/view.test.ts
  import { describe, expect, it } from 'vitest';
  import { readFileSync } from 'node:fs';
  import { buildMatchWorld } from '../../../packages/app/src/net/match-world';
  import { FogTracker } from './fog-tracker';
  import { sideView } from './view';
  import { versusConfig } from './test-config';

  describe('sideView', () => {
    it('never names an enemy on a tile the side cannot see (spec §12, harness)', () => {
      const w = buildMatchWorld(versusConfig('tel_marum'));
      const fog = new FogTracker(w.sim, 0);
      for (let i = 0; i < 40; i++) { w.sim.tick(); fog.step(); }
      const v = sideView(w, 0, fog, null);
      // At t=2 s the two camps are ~30 tiles apart: side 0 sees none of side 1.
      expect(v.contacts).toEqual([]);
      expect(v.units.length).toBe(w.bySide[0].length);
    });
    it('names an enemy once it stands in sight, by id, type and tile', () => {
      const w = buildMatchWorld(versusConfig('tel_marum'));
      const enemy = w.bySide[1][0];
      // Move it next to a side-0 unit by the sim's own command path, then tick until it arrives.
      const [fx0, fy0] = [w.sim.state.posX[w.bySide[0][0]], w.sim.state.posY[w.bySide[0][0]]];
      w.sim.queueCommand({ kind: 'move', ids: [enemy], x: fx0 + (2 << 16), y: fy0, exact: true });
      const fog = new FogTracker(w.sim, 0);
      for (let i = 0; i < 1200 && !sideView(w, 0, fog, null).contacts.some((c) => c.id === enemy); i++) { w.sim.tick(); fog.step(); }
      expect(sideView(w, 0, fog, null).contacts.map((c) => c.id)).toContain(enemy);
    });
    it('is a pure read: viewing changes no sim hash', () => {
      const w = buildMatchWorld(versusConfig('wadi_tarfan'));
      const fog = new FogTracker(w.sim, 1);
      for (let i = 0; i < 20; i++) { w.sim.tick(); fog.step(); }
      const h = w.sim.hash();
      sideView(w, 1, fog, null);
      expect(w.sim.hash()).toBe(h);
    });
    it('render fog.ts stays importable headlessly: it imports nothing', () => {
      const src = readFileSync(new URL('../../../packages/render/src/three/fog.ts', import.meta.url), 'utf8');
      expect(src).not.toMatch(/^import /m);
    });
  });
  ```
  And the fixture this task creates, used by every later tools test:
  ```ts
  // tools/src/net/test-config.ts
  import { validateConfig, type Faction, type MatchConfig, type Pace } from '@lions/net';
  export function versusConfig(map: string, o: { factions?: [Faction, Faction]; seed?: number; pace?: Pace; kinds?: ['human' | 'bot', 'human' | 'bot'] } = {}): MatchConfig {
    const factions = o.factions ?? ['kdf', 'kdf'];
    const kinds = o.kinds ?? ['human', 'human'];
    const seat = (s: 0 | 1) => ({ seat: s, side: s, faction: factions[s], kit: 'matched', tiers: {}, unlocks: [], player: `p${s}`, callsign: `c${s}`, kind: kinds[s] });
    const c = validateConfig({ matchId: 'M', code: 'ABCDEF', seed: o.seed ?? 1234, map, mode: 'versus', seats: [seat(0), seat(1)], pace: o.pace ?? { kind: 'realtime' }, hashEveryTicks: 20, bufferTicks: 2, build: 'test', dataDigest: 0 });
    if (c === null) throw new Error('versusConfig: the fixture no longer validates');
    return c;
  }
  ```
- [ ] **Step 2: Run red.** Run `pnpm vitest run tools/src/net/view.test.ts`.
  Expected: FAIL, module not found.
- [ ] **Step 3: Implement.**
  - `FogTracker` builds the `FogInput` as `ThreeRenderer.recomputeFog` does:
    - `sightByType[i] = fx.toNumber(sim.unitTypes[i].sight)`;
    - `isLowProfile = (x, y) => { const s = sim.structureAt(x, y); return s >= 0 &&
      sim.structureTypes[sim.structures.typeIdx[s]].lowProfile; }`;
    - it starts from `new Uint8Array(w * h)` and keeps the previous fog
      (decay-before-reveal);
    - `step()` recomputes when `calls++ % 4 === 0`.
  - `sideView` walks `0..entityCount` once.
  - `clock` is `mm:ss` from `tickCount / 20`.
  - `camp` and `enemyCamp` come from `campOf(anchors, side)`.
  - `score` comes from `scoreFor(scoreOf(sim), side)`.
- [ ] **Step 4: Run green.** Run `pnpm vitest run tools/src/net/view.test.ts`.
- [ ] **Step 5: Falsify** (each red, then reverted):
  - drop the fog filter (every enemy becomes a contact): test 1 goes red;
  - read `side[i] === side` instead of `!==` for contacts: tests 1 and 2 go
    red;
  - recompute fog every call instead of every 4th: no test goes red. **Record
    that.** The cadence is fidelity to the renderer, not something a test
    guards. Add a test that `step()` called 3 times after one reveal leaves
    `visibleTile` unchanged, see it go red under the mutation, and keep it.
- [ ] **Step 6: Commit** `tools/src/net/{fog-tracker,view,test-config,view.test}.ts`.

### Task 3: The order desk: coalescing and the order ledger

A model can call `order` as fast as it likes. The room accepts 4 commands per
seat per frame, 12 pending and 20 a second. Each command frame also costs one
billed row. The desk turns a model's orders into at most one flush of at most
4 commands every 20 ticks (D4). It also reports what became of each order, so
a model learns its boundaries (spec §8.3).

**Files:**
- Create: `tools/src/net/order-desk.ts`
- Test: `tools/src/net/order-desk.test.ts`

**Interfaces:**
- Consumes: `validateCommand`, `SeatWorld`, `MAX_CMDS_PER_SEAT_PER_FRAME`
  (`@lions/net`).
- Produces:
  ```ts
  export const DESK_FLUSH_TICKS = 20;
  export const DESK_MAX_QUEUE = 12;          // = room-core MAX_PENDING_CMDS_PER_SEAT, pinned by test
  export const DESK_LOST_AFTER_TICKS = 40;   // = room-core STALL_BEHIND_TICKS, pinned by test
  export type OrderStatus = 'queued' | 'sent' | 'applied' | 'dropped' | 'lost';
  export interface OrderRecord { ref: number; cmd: Command; status: OrderStatus; queuedTick: number; sentTick: number | null; settledTick: number | null }
  export class OrderDesk {
    constructor(send: (cmd: Command) => void);
    submit(cmd: Command, tick: number): OrderRecord | { error: 'queue_full' };
    /** After each frame has run: flush when due. */
    onTick(tick: number): void;
    /** This seat's commands in a frame, in canonical order, with ownership's verdict on each. */
    onOwnCommands(cmds: readonly { cmd: Command; valid: boolean }[], tick: number): void;
    records(limit: number): OrderRecord[];   // newest first
  }
  ```
  Matching: an incoming own command settles the OLDEST `sent` record whose
  `JSON.stringify(cmd)` is equal (FIFO among equals). A `sent` record still
  unsettled `DESK_LOST_AFTER_TICKS` after `sentTick` becomes `lost`: the room
  refused it under its pending cap or its bucket, or a pause began.

- [ ] **Step 1: The failing tests.**
  ```ts
  // tools/src/net/order-desk.test.ts
  import { describe, expect, it } from 'vitest';
  import { MAX_CMDS_PER_SEAT_PER_FRAME } from '@lions/net';
  import { CMD_BUDGET, MAX_PENDING_CMDS_PER_SEAT, STALL_BEHIND_TICKS } from '../../../packages/worker/src/match/room-core';
  import { DESK_FLUSH_TICKS, DESK_LOST_AFTER_TICKS, DESK_MAX_QUEUE, OrderDesk } from './order-desk';
  import type { Command } from '@lions/sim';

  const halt = (id: number): Command => ({ kind: 'halt', ids: [id] });

  describe('OrderDesk', () => {
    it('matches the room it feeds (constants pinned against room-core, not copied)', () => {
      expect(DESK_MAX_QUEUE).toBe(MAX_PENDING_CMDS_PER_SEAT);
      expect(DESK_LOST_AFTER_TICKS).toBe(STALL_BEHIND_TICKS);
      expect(MAX_CMDS_PER_SEAT_PER_FRAME * (20 / DESK_FLUSH_TICKS)).toBeLessThanOrEqual(CMD_BUDGET.perSecond);
    });
    it('100 orders in one second: 12 queued, the rest refused, 4 sent per flush, one flush per 20 ticks', () => {
      const sent: Command[] = [];
      const desk = new OrderDesk((c) => sent.push(c));
      const results = Array.from({ length: 100 }, (_, i) => desk.submit(halt(i), 0));
      expect(results.filter((r) => 'error' in r).length).toBe(88);
      for (let t = 0; t < 60; t++) desk.onTick(t);
      expect(sent.length).toBe(12);
      const flushTicks = desk.records(12).map((r) => r.sentTick);
      expect(new Set(flushTicks)).toEqual(new Set([0, 20, 40]));
    });
    it('reports applied, dropped and lost', () => {
      const desk = new OrderDesk(() => {});
      const a = desk.submit(halt(1), 0) as { ref: number };
      const b = desk.submit(halt(2), 0) as { ref: number };
      const c = desk.submit(halt(3), 0) as { ref: number };
      desk.onTick(0);
      desk.onOwnCommands([{ cmd: halt(1), valid: true }, { cmd: halt(2), valid: false }], 3);
      for (let t = 1; t <= 41; t++) desk.onTick(t);
      const byRef = new Map(desk.records(10).map((r) => [r.ref, r.status]));
      expect([byRef.get(a.ref), byRef.get(b.ref), byRef.get(c.ref)]).toEqual(['applied', 'dropped', 'lost']);
    });
    it('two identical orders settle oldest first', () => {
      const desk = new OrderDesk(() => {});
      const a = desk.submit(halt(1), 0) as { ref: number };
      desk.onTick(0);
      const b = desk.submit(halt(1), 5) as { ref: number };
      desk.onTick(20);
      desk.onOwnCommands([{ cmd: halt(1), valid: true }], 21);
      const byRef = new Map(desk.records(10).map((r) => [r.ref, r.status]));
      expect([byRef.get(a.ref), byRef.get(b.ref)]).toEqual(['applied', 'sent']);
    });
  });
  ```
- [ ] **Step 2: Run red**, then implement (a ring of `OrderRecord`s, kept to
  the last 64; `lastFlush = -Infinity`), then run green.
- [ ] **Step 3: Falsify** (each red, then reverted):
  - flush 5 instead of `MAX_CMDS_PER_SEAT_PER_FRAME`;
  - `DESK_FLUSH_TICKS = 1`;
  - settle newest first;
  - never mark `lost`;
  - `DESK_MAX_QUEUE = 13`.
- [ ] **Step 4: Commit** `tools/src/net/order-desk.ts
  tools/src/net/order-desk.test.ts`.

### Task 4: The headless client, the build id and the Node socket

**Files:**
- Create: `tools/src/net/build-id.ts`, `tools/src/net/node-socket.ts`,
  `tools/src/net/agent-client.ts`
- Modify: `packages/app/src/net/frame-step.ts` (an optional `beforeFrame`),
  `tools/package.json` (add `ws` and `@types/ws`, exact versions, D3),
  `pnpm-lock.yaml`
- Test: `tools/src/net/agent-client.test.ts`,
  `packages/app/src/net/frame-step.test.ts`

**Interfaces:**
- Consumes: `buildMatchWorld`, `FogTracker`, `sideView`, `OrderDesk`;
  `WsTransport`, `validateCommand`, `matchDigest` (`@lions/net`);
  `runFrames`, `seatWorldFor`, `hashTickOutcome` and `reportOver`
  (`packages/app/src/net/*`).
- Produces:
  ```ts
  // build-id.ts: the same rule as packages/app/vite.config.ts appCommit()
  export function buildId(env?: NodeJS.ProcessEnv): string;   // `${rootPackage.version}+${commit}`
  // node-socket.ts
  export function nodeSocket(wsUrl: string, origin: string): SocketLike;
  // frame-step.ts (added field)
  beforeFrame?: (frame: Frame) => void;   // called with each frame BEFORE applyFrame; absent in the browser
  // agent-client.ts
  export interface AgentClientOptions {
    server: string; code: string; ticket: string; build: string;
    role: 'seat' | 'advisor'; seat: Seat;
    open?: () => SocketLike;          // tests pass a fake; default nodeSocket(<server>/api/match/<code>/ws, origin(server))
    log?: (line: string) => void;     // default: process.stderr
  }
  export class AgentClient {
    constructor(o: AgentClientOptions);
    readonly ready: Promise<MatchConfig>;   // resolves at `start` (or the first `log`)
    readonly desk: OrderDesk;                // null-sending for an advisor
    world(): MatchWorld | null;
    tick(): number;                          // frames run so far
    /** Runs up to `maxTicks` buffered frames; returns how many ran. */
    pump(maxTicks: number): number;
    view(): SideView;
    result(): MatchResult | null;
    readonly transport: WsTransport;
    close(): void;                           // `bye` for a seat (a surrender), a quiet detach for an advisor
  }
  ```

The pump body:
- `runFrames({ transport, sim, seatWorld: seatWorldFor(config, sim), runTick:
  () => { sim.tick(); fog.step(); }, config, beforeFrame, stopAfter })`.
- `beforeFrame` computes `validateCommand(s.cmd, s.seat, seatWorld)` for this
  seat's stamped commands and hands them to `desk.onOwnCommands`. Then
  `desk.onTick(f.tick)`.
- `stopAfter` asks `hashTickOutcome`. On a result it calls
  `transport.over(tick)`, seats only, as the browser does through
  `reportOver`.
- An advisor's transport sends no `ready`, `ack`, `hash` or `over` (the
  `role` option, Task 5).

- [ ] **Step 1: The failing tests.** In `agent-client.test.ts`, drive two
  `AgentClient`s and a `WsTransport` "browser" against the REAL `MatchRoom`
  over `fake-do.ts`. Use the same scaffolding as
  `tools/src/net/rejoin-catchup.test.ts` (`FakeState`, `openSocket`,
  `signTicket`, `vi.useFakeTimers`, `TICK_MS`), with an `open` that bridges
  `FakeSocket` to `SocketLike`. Cases:
  1. **Same world as the browser:** a seat-0 `AgentClient` and a seat-1
     `WsTransport` driven by `buildMatchWorld` + `runFrames` both run 200
     ticks. The room sends `hashOk` ≥ 9 times and never `desync`. (This is
     the in-process proof; the browser proof is the run protocol in Task 16.)
  2. **The desk feeds the room:** 30 `desk.submit` calls in one tick reach
     the room as ≤ 4 commands per frame, in frames ≥ 20 ticks apart. The
     ledger reads 12 `applied` and 18 `queue_full` refusals.
  3. **An enemy id is dropped:** submitting `halt([<a side-1 id>])` from seat
     0 ends `dropped`, and both sims' hashes still agree.
  4. **Build mismatch:** a client constructed with `build: 'other'` sees
     `error build_mismatch`. `ready` rejects with an `Error` whose message
     names both build strings, and `close()` was called.
  5. **`buildId`:** with `GITHUB_SHA=ABCDEF1234567` set, it returns
     `${version}+abcdef1234567`; with `GITHUB_SHA=nothex`, the commit part is
     `''` (the vite rule).
  6. **`beforeFrame`** (in `frame-step.test.ts`): called once per frame,
     before the frame's commands are queued, and never when the transport
     yields no frame.
- [ ] **Step 2: Run red.**
- [ ] **Step 3: Implement.**
  - `nodeSocket` wraps `new WebSocket(url, { origin })` from `ws`. It adapts
    `onopen`, `onmessage({data})` and `onclose({code})`, and stringifies
    `Buffer` data with `toString('utf8')`.
  - `buildId` reads the root `package.json` and repeats `appCommit()`'s
    order: `WORKERS_CI_COMMIT_SHA`, then `GITHUB_SHA`, then `git rev-parse
    HEAD`, lowercased and checked against `/^[0-9a-f]{7,40}$/`.
  - The `ready` rejection message is `the room refused build "<ours>"; it
    runs a different build. Check out that build's commit, or pass --build`.
    The room does not send its own build, so the message cannot name it; say
    so in the task report, and do not add a field to `error`.
- [ ] **Step 4: Run green.** Run `pnpm vitest run tools/src/net
  packages/app/src/net && pnpm typecheck && pnpm lint`.
- [ ] **Step 5: Falsify** (each red, then reverted):
  - `runTick` skips `fog.step()`: the view test in case 1 goes red (add a
    contact assertion to case 1 if it stays green);
  - `beforeFrame` after `applyFrame`: no test can see this, because queueing
    does not mutate state before the tick. Record that as a survivor;
  - `seatWorldFor(null, sim)`: case 3 goes red, because the seat is treated
    as side 0 and side-0 ids would read as own;
  - `buildId` reads `GITHUB_SHA` before `WORKERS_CI_COMMIT_SHA`: case 5 goes
    red (add a both-set case).
- [ ] **Step 6: Commit** the files above.

## Phase B: protocol and room

### Task 5: Protocol: advisor messages, `done`, the `round` stall, advisor tickets

**Files:**
- Create: `packages/net/src/advisor.ts`
- Modify: `packages/net/src/protocol.ts`, `packages/net/src/ws-transport.ts`,
  `packages/net/src/index.ts`, `packages/worker/src/match/ticket.ts`
- Test: `packages/net/src/advisor.test.ts`, `protocol.test.ts`,
  `ws-transport.test.ts`, `packages/worker/src/match/ticket.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // advisor.ts
  export type AdvisorScope = 'advise' | 'assist';
  export const ADVISOR_NOTE_MAX = 120;
  export type AdvisorMsg =
    | { kind: 'text'; text: string }                                  // cleanChat, ≤ CHAT_MAX_CHARS
    | { kind: 'ping'; x: number; y: number }                          // integer tiles, 0..255
    | { kind: 'proposal'; id: number; cmd: Command; note: string }    // cleanCommand; note cleanChat ≤ ADVISOR_NOTE_MAX
    | { kind: 'accept'; id: number }
    | { kind: 'veto'; id: number };
  export function cleanAdvisorMsg(v: unknown): AdvisorMsg | null;
  /** Who may send what: proposals only from an `assist` advisor; accept/veto only from the human; text and ping both ways. */
  export function advisorMayRelay(from: 'human' | 'advisor', scope: AdvisorScope, a: AdvisorMsg): boolean;
  // protocol.ts additions
  ClientMsg  |= { t: 'advisor'; a: AdvisorMsg } | { t: 'done'; round: number };
  ServerMsg  |= { t: 'advisor'; from: 'human' | 'advisor'; a: AdvisorMsg }
              | { t: 'advisors'; present: [AdvisorScope | null, AdvisorScope | null] };
  StallReason = 'behind' | 'gone' | 'round';
  // ws-transport.ts
  hooks: onAdvisor?(from, a), onAdvisors?(present)
  methods: advisor(a: AdvisorMsg): void; done(round: number): void
  constructor option: role?: 'seat' | 'advisor'   // advisor: reportTick, ready, over and close's `bye` send nothing
  NetStats.stalls gains a `round` entry
  // ticket.ts
  export interface Ticket { matchId: string; seat: Seat; player: string; exp: number; role?: 'seat' | 'advisor'; scope?: AdvisorScope }
  // verifyTicket: role absent ⇒ 'seat'; role 'advisor' requires a valid scope; anything else ⇒ null
  ```

- [ ] **Step 1: The failing tests.**
  - `advisor.test.ts`:
    - each kind round-trips through `cleanAdvisorMsg`;
    - a proposal with a 3 KB `pad` on its `cmd` comes back without it;
    - a `text` with a bidi override (U+202E) comes back without it;
    - a ping at x = 256 or 1.5 is null;
    - an `id` that is not an integer is null;
    - an unknown `kind` is null;
    - `advisorMayRelay`: an advise-scope proposal is false, an assist-scope
      proposal true, a human proposal false, an advisor accept false, text
      true both ways.
  - `protocol.test.ts`:
    - `parseClientMsg('{"t":"advisor","a":…}')` returns the cleaned message;
    - `{"t":"done","round":-1}` is null;
    - `parseServerMsg` accepts `advisors` with `[null,'assist']` and refuses
      `['command', null]`;
    - a `stall` with reason `round` parses.
  - `ws-transport.test.ts`:
    - a `role: 'advisor'` transport sends no `ack`, `hash`, `ready`, `over`
      or `bye` (assert on the fake socket's sent list after `reportTick(19,
      123)`, `ready()`, `over(5)` and `close()`);
    - `onAdvisor` and `onAdvisors` fire;
    - `stats().stalls.round` counts.
  - `ticket.test.ts`:
    - an advisor ticket round-trips with its scope;
    - a ticket signed with `role: 'advisor'` and no scope verifies to null;
    - a pre-N4 ticket (no role) verifies as `role: 'seat'`.
- [ ] **Step 2: Run red**, implement, then run green with `pnpm vitest run
  packages/net packages/worker/src/match/ticket.test.ts && pnpm typecheck`.
- [ ] **Step 3: Falsify** (each red, then reverted):
  - `advisorMayRelay` returns true for an advise proposal;
  - `cleanAdvisorMsg` passes `cmd` through without `cleanCommand`;
  - `verifyTicket` treats a missing scope as `advise`;
  - an advisor transport sends `ack`.
- [ ] **Step 4: Commit.**

### Task 6: Room core: paced rounds (pure)

Spec §3.2.7, never built (§11b.2). With `pace.kind === 'paced'` the room
mints `roundTicks` frames. Before the next it waits until every BOT seat has
sent `done{round}`, or until `roundWallMs` has passed since the round's last
frame. A human seat is never waited for.

**Files:**
- Modify: `packages/worker/src/match/room-core.ts`
- Test: `packages/worker/src/match/room-core.test.ts`

**Interfaces:**
- Produces, in `room-core.ts`:
  ```ts
  // RoomState additions (memory only; NOT in persistKey: zero rows)
  doneRound: [number, number];       // -1 before any
  roundClosedAtMs: number | null;    // when the last frame of the newest round was minted
  roundWait: Seat | null;            // the bot seat a round is waiting on, while it waits
  export function roundGate(st: RoomState, nowMs: number): Seat | null;
  ```
  In `clockTick`, after `recheckStall` and before minting a frame:
  ```ts
  const waitOn = roundGate(st, nowMs);
  if (waitOn !== null) {
    if (st.roundWait === null) { st.roundWait = waitOn; out.push({ kind: 'send', to: 'all', msg: { t: 'stall', reason: 'round', seat: waitOn } }); }
    return out;
  }
  if (st.roundWait !== null) { st.roundWait = null; out.push({ kind: 'send', to: 'all', msg: { t: 'resume' } }); }
  ```
  After minting: `if (paced && (frame.tick + 1) % roundTicks === 0)
  st.roundClosedAtMs = nowMs`.

  `roundGate` returns null unless the room is paced, `st.tick > 0` and
  `st.tick % roundTicks === 0`. Then, with `round = st.tick / roundTicks - 1`,
  it returns null once `nowMs - roundClosedAtMs >= roundWallMs`. Otherwise it
  returns the first seat whose config `kind === 'bot'` and whose `doneRound <
  round`, or null.

  `seatMessage` `done`: ignored unless the room is paced, the seat is a bot,
  `msg.round <= Math.floor(st.tick / roundTicks) - 1` and `msg.round >
  st.doneRound[seat]`; then it sets `doneRound[seat]`.

  `stallFor` skips the silence check while `st.roundWait !== null`: a model
  thinking for 40 s sends nothing, and that is not a dead socket.

  `revive` sets `doneRound` to the last closed round for both seats, and
  `roundWait` and `roundClosedAtMs` to null. A woken room releases the round
  at once rather than waiting a full `roundWallMs` for a `done` it lost.
  `createRoom` initialises the three fields.
- [ ] **Step 1: The failing tests** (pure, with a config minted with
  `pace: { kind: 'paced', roundTicks: 20, roundWallMs: 5000 }`):
  1. A bot seat 1 and a human seat 0:
     - 20 frames flow, then the 21st waits;
     - one `stall{round, seat:1}` is sent, not one per tick;
     - `done{0}` from seat 1 releases it with one `resume`.
  2. Bot seat 1 never sends `done`: at `roundClosedAtMs + 4999` no frame;
     at `+5000` the frame is minted.
  3. Both seats human: never gated. (The room mints `realtime` in that case,
     Task 7, but the core must not hang if handed it.)
  4. `done` refusals:
     - `done{1}` while round 0 is the newest closed round is ignored, and
       does not pre-release round 1;
     - a `done` from a human seat is ignored;
     - `done` in a realtime room is ignored.
  5. A 40-second gap with no message from the bot during the wait produces
     no `stall{gone}`.
  6. `persistKey` is identical before and after a round's wait and release:
     zero lifecycle writes.
- [ ] **Step 2: Run red, implement, run green** (`pnpm vitest run
  packages/worker/src/match/room-core.test.ts`).
- [ ] **Step 3: Falsify** (each red, then reverted):
  - `roundGate` ignores `kind` and waits on humans: case 1 or 3 goes red;
  - `>` instead of `>=` on `roundWallMs`: case 2 goes red;
  - no silence-skip: case 5 goes red;
  - `doneRound` added to `persistKey`: case 6 goes red;
  - accept a `done` for a future round: case 4 goes red.
- [ ] **Step 4: Commit.**

### Task 7: MatchRoom: bot seats, the paced config, advisor sockets, the `/advisor` route

**Files:**
- Modify: `packages/worker/src/match/match-room.ts`,
  `packages/worker/src/match/routes.ts`
- Test: `packages/worker/src/match/match-room.test.ts`, `routes.test.ts`,
  `room-loop.test.ts`

**Interfaces:**
- Consumes: Task 5 (`AdvisorMsg`, `advisorMayRelay`, `Ticket.role/scope`),
  Task 6.
- Produces:
  - `POST /api/match` accepts `kind?: 'bot'` (the host's seat kind) and
    `pace?: { kind: 'paced', roundTicks, roundWallMs }`. Both are clamped
    (D5) and stored in `RoomMeta` as `kinds: [SeatKind, SeatKind]` and
    `pace: Pace`.
  - `POST /api/match/:code/join` accepts `kind?: 'bot'`.
  - **`POST /api/match/:code/advisor`**, body `{ ticket, scope }`:
    - verifies the SEAT ticket (role `seat`, `matchId === code`, not
      expired);
    - answers `{ ticket }` for an advisor ticket `{ matchId, seat, player:
      'advisor', exp: <the seat ticket's exp>, role: 'advisor', scope }`;
    - `ROOM_LIMIT` applies;
    - 400 for a bad scope, 403 for a bad ticket;
    - the DO is not called and nothing is written.
  - `mintConfig`: `kind: meta.kinds[seat]`; `pace: meta.pace` when it is
    paced AND some seat is a bot, else `{ kind: 'realtime' }` (D5).
  - `SocketAttachment` gains `role?: 'advisor'` and `scope?: AdvisorScope`.
  - The DO's hello for an advisor ticket:
    - attach `{ seat, role: 'advisor', scope }`;
    - retire any previous advisor socket of that seat (one per seat, D1);
    - reply `lobby` (lobby) or the `logParts` plus a `paused` in force
      (running);
    - broadcast `advisors`;
    - **no `seatJoin`**.
  - `socketsFor(seat)` returns seat sockets only. `send('all')` reaches
    advisor sockets too (frames, stalls, `ended`, chat, `advisors`, `lobby`
    with `you` = its seat). Seat-targeted sends (`log` on rejoin,
    `cmdRefused`, `error`) do not.
  - The advisor socket's messages:
    - only `advisor` is acted on: relayed as `{ t: 'advisor', from:
      'advisor', a }` to its seat's sockets when `advisorMayRelay('advisor',
      scope, a)`;
    - every other kind is ignored, after the budget spend;
    - `ADVISOR_MIN_GAP_MS` = 250 per socket, memory only.
  - A seat socket's `advisor` message is relayed to that seat's advisor
    sockets as `from: 'human'` when `advisorMayRelay('human', scope, a)`, and
    never to the other seat.
  - An advisor socket's close broadcasts `advisors` and calls no
    `seatGone`.
  - `advisors` presence is computed from `ctx.getWebSockets()` attachments,
    so it survives hibernation with no state and no row.
- [ ] **Step 1: The failing tests** (`match-room.test.ts`, `routes.test.ts`):
  1. The route mints an advisor ticket from a seat ticket; refuses an
     advisor ticket as the input (403), a ticket for another code (403) and
     `scope: 'command'` (400).
  2. An advisor hello in a running match:
     - gets the log;
     - the seat's own socket count is unchanged;
     - both seats get `advisors: [ 'assist', null ]`.
  3. Advisor `cmd`, `ready`, `pause`, `surrender`, `hash`, `ack`, `over`
     and `bye` each change nothing: no frame carries a command, `pausesLeft`
     and `status` are unchanged, and no `ended` is sent.
  4. An `assist` advisor's proposal reaches seat 0's socket and NOT seat 1's;
     an `advise` advisor's proposal reaches nobody; seat 0's `accept` reaches
     its advisor only.
  5. Closing the advisor socket mid-match causes no `stall`, no `dropped`
     and no forfeit, and broadcasts `advisors: [null, null]`.
  6. A second advisor hello for seat 0 retires the first (close code 4000).
  7. Hibernation: after `FakeState.vanish` of the instance and a revive, the
     advisor socket still relays (presence comes from attachments).
  8. **Nine sockets:** 2 seats + 2 advisors + 4 in flight is 8; the 9th is
     closed 1008.
  9. A paced versus room with a `kind: 'bot'` join mints `pace.kind ===
     'paced'`. The same room with no bot mints `realtime`. `roundTicks: 5`
     is clamped to 20.
  10. **The row budget** (`room-loop.test.ts`, beside R-N12's existing
      `budget()`). A 60 s running match:
      - seat 1 is a bot fed by an `OrderDesk` with one `submit` every tick
        (flush cadence D4);
      - seat 0 sends one order a second;
      - an assist advisor sends 4 advisor messages a second.

      `rowsWritten - before` must be ≤ `bound(...)` (the existing
      `max(cmdFrames, seconds) + 0.2 × seconds`), and ≤ 2.2 × 60 + 1.
      Repeat the run with the advisor silent, and assert both runs have the
      same row count: the advisor costs zero rows.
- [ ] **Step 2: Run red, implement, run green.** Run `pnpm vitest run
  packages/worker && pnpm typecheck && pnpm lint`.
- [ ] **Step 3: Falsify** (each red, then reverted):
  - `socketsFor` includes advisors: case 4 goes red (the human gets its own
    proposal echoed), and so does the rejoin-log case;
  - the advisor hello calls `seatJoin`: case 2 or 5 goes red;
  - the advisor close calls `seatGone`: case 5 goes red;
  - relay a proposal to `'all'`: case 4 goes red;
  - the desk flush every tick in case 10: the budget goes red;
  - the advisor relay calls `saveIfChanged` with a changed key: case 10's
    equality goes red.
- [ ] **Step 4: Commit.** In the PR body, state the Worker change and that no
  migration and no new binding is needed.

## Phase C: MCP

### Task 8: The MCP server and `pnpm agent`

**Files:**
- Create: `tools/src/net/mcp-tools.ts`, `tools/src/net/agent.ts`
- Modify: `tools/package.json` (`@modelcontextprotocol/sdk`, exact version,
  D3; script `"agent": "tsx src/net/agent.ts"`), root `package.json`
  (`"agent": "pnpm --silent --filter @lions/tools agent"`), `pnpm-lock.yaml`
- Test: `tools/src/net/mcp-tools.test.ts`, `tools/src/net/agent.test.ts`

**Interfaces:**
- Consumes: `AgentClient` (Task 4), the advisor protocol (Task 5).
- Produces:
  ```ts
  export type Scope = 'advise' | 'assist' | 'command';
  export interface ToolResult { ok: boolean; text: string }   // `text` is JSON for the model
  export interface ToolDef { name: string; description: string; scopes: readonly Scope[]; schema: Record<string, unknown>; run(ctx: ToolContext, args: unknown): Promise<ToolResult> }
  export interface ToolContext { client: AgentClient; scope: Scope; inbox: string[]; proposals: Map<number, 'pending' | 'accepted' | 'vetoed'> }
  export const TOOLS: readonly ToolDef[];
  export function toolsFor(scope: Scope): ToolDef[];
  ```

The tools (spec §8.3, as built):

| Tool | Scopes | Does |
|---|---|---|
| `observe()` | all | `client.view()` plus `orders`: `desk.records(10)`, or the proposal statuses |
| `status()` | all | tick, clock, `transport.status()`, result, pace and round |
| `wait({ ticks })` | all | resolves after `ticks` (1–200) more frames have run, or on a result; never blocks past `ended` |
| `inbox()` | all | lines received since the last call: advisor `text` from the human (advise/assist), opponent `chat` (command); then cleared |
| `say({ text })` | all | an advisor `text` (advise/assist), or a room `chat` (command, visible to both seats) |
| `ping({ x, y })` | advise, assist | an advisor `ping` at an integer tile |
| `order({ verb, ids, x?, y?, target?, structure?, carrier?, tunnel? })` | assist, command | builds the `Command` (tiles → `fx.from(t + 0.5)`; verbs are `COMMAND_KINDS` minus `reveal` and `callStrike`, which versus drops); command scope: `desk.submit` → `{ ref, status }` or `queue_full`; assist scope: an advisor `proposal` with a fresh `id` → `{ proposal: id, status: 'pending' }` |
| `end_round()` | command, in a paced room | `transport.done(round)` for the newest round whose frames have all run |

- Every acting tool answers what was accepted, and why something was refused:
  `queue_full`, `not your unit`, `unknown verb`, `off the map`, `not in this
  scope`, `match over`.
- The pre-check uses `validateCommand` on the harness's own world. The answer
  is advisory: the authoritative drop happens in `applyFrame`, on both
  machines, and the ledger reports it.
- `agent.ts` takes:
  - `--server <url>`, `--code <code>`, `--scope <scope>`;
  - one of `--ticket-file <path>` (`-` for stdin) or `--join` (command
    scope: POST `/join` with `{ player: randomUUID(), callsign, kind: 'bot'
    }`);
  - `--callsign`, `--build` (default `buildId()`), `--origin` (default: the
    server's origin).
- It pumps frames every 10 ms. It serves stdio MCP with the SDK's `McpServer`
  and `StdioServerTransport`, registering `toolsFor(scope)`. **It writes logs
  to stderr only.** It exits 0 on `ended` or a result, 2 on `bad_ticket` or
  `build_mismatch`, and 3 on a desync, after printing the tick.
- [ ] **Step 1: The failing tests.**
  - `mcp-tools.test.ts`, against the Task 4 in-process room:
    1. `toolsFor('advise')` has no `order` and no `end_round`.
    2. `order` in command scope on an enemy id answers `ok: false`, `not
       your unit`. An own id answers a `ref`; after `wait({ticks: 40})`,
       `observe().orders` shows it `applied`.
    3. `order` in assist scope sends a `proposal` and NO `cmd`: the fake
       room's received list holds an advisor message and zero `cmd`s.
    4. `observe` output never contains an id that `sideView` would not list:
       a hidden enemy id does not appear anywhere in the JSON text.
    5. `wait` resolves after a result even if fewer ticks ran.
    6. `say` in command scope sends `chat`; in advise scope it sends an
       advisor `text`.
  - `agent.test.ts`: the CLI's argument parsing alone in this task (`--join`
    and `--ticket-file` exclusive, `--scope` checked, `--ticket` with a
    value refused with "use --ticket-file", exit codes mapped). The spawned
    end-to-end case needs a room reachable from a child process, so it lands
    in **Task 11, Step 1**: spawn `tsx tools/src/net/agent.ts` against the
    local relay, connect the SDK's `Client` over `StdioClientTransport`, list
    the tools and call `observe`. **Then assert the child's stdout carried
    only JSON-RPC frames:** parse every stdout line and require `jsonrpc ===
    '2.0'`.
- [ ] **Step 2: Run red, implement, run green** with `pnpm vitest run
  tools/src/net`.
- [ ] **Step 3: Falsify** (each red, then reverted):
  - `toolsFor` ignores scope: case 1 goes red;
  - assist `order` calls `desk.submit`: case 3 goes red;
  - `observe` includes all entities: case 4 goes red;
  - a `console.log('ready')` in `agent.ts`: the stdout-purity assertion goes
    red (run this one after Task 11 lands the spawned test, and record it in
    Task 11's commit);
  - `wait` ignores a result: case 5 times out red.
- [ ] **Step 4: Commit.**

## Phase D: the advisor in the game

### Task 9: The lobby: invite an advisor, and the advisor badge

**Files:**
- Modify: `packages/app/src/ui/versus.ts`, `packages/app/src/net/connect.ts`
  (`requestAdvisorTicket(code, seatTicket, scope)`),
  `packages/app/src/i18n/en.json`
- Test: `packages/app/src/ui/versus.test.ts`,
  `packages/app/src/net/connect.test.ts`

**Interfaces:**
- Consumes: the `/advisor` route (Task 7), `advisors` (Task 5),
  `ticket-store.ts`.
- Produces: in the lobby, per own seat, an "Invite an advisor" control with a
  scope choice (Advise / Assist). On success it shows:
  - the ready-to-paste command `pnpm agent -- --server <origin> --code <CODE>
    --scope <scope> --ticket-file -`, through `textContent`;
  - a "Copy ticket" button (`navigator.clipboard.writeText`). The ticket is
    never put into the command line or a URL;
  - a one-line note (`t('net.advisor.note')`): "Your advisor sees what your
    side sees. Your friend is told you have one."

  Each seat card shows a badge from `advisors` (`t('net.advisor.badge',
  {scope})`).
- [ ] **Step 1: The failing tests:**
  - the control renders only for the viewer's own seat;
  - the request carries the stored seat ticket in the BODY (assert the fetch
    URL has no `ticket=`);
  - the command string contains `--ticket-file -` and no ticket text;
  - the badge follows `advisors` for both seats;
  - a 403 shows `t('net.advisor.failed')`;
  - every new string goes through `t()` (`__lionsI18n.missingKeys()` is
    empty after a render).
- [ ] **Step 2: Run red, implement, run green.** Run `pnpm vitest run
  packages/app/src/ui/versus.test.ts packages/app/src/net/connect.test.ts &&
  pnpm validate:ui`.
- [ ] **Step 3: Falsify** (each red, then reverted):
  - the ticket in the query string;
  - the control on both seats;
  - the badge reads `present[0]` for both cards.
- [ ] **Step 4: Commit.**

### Task 10: The advisor panel and the proposal strip

**Files:**
- Create: `packages/app/src/ui/advisor.ts`
- Modify: `packages/app/src/main.ts` (mount in a versus room when `advisors`
  names the viewer's seat; dispose in the battlefield disposer),
  `packages/app/src/input/keymap.ts` (X = veto while a proposal shows, D11),
  `packages/app/src/i18n/en.json`
- Test: `packages/app/src/ui/advisor.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const PROPOSAL_MS = 2000;
  export const PROPOSAL_QUEUE = 3;
  export interface AdvisorPanelDeps {
    send(a: AdvisorMsg): void;                 // WsTransport.advisor
    queueCommand(cmd: Command): void;          // the battlefield's transport: the order goes out as THIS seat's cmd
    validate(cmd: Command): boolean;           // validateCommand(cmd, mySeat, seatWorld) on the live sim
    now(): number;
    describe(cmd: Command): string;            // "Move 3 units to (24, 31)", via t()
  }
  export interface AdvisorPanel {
    onAdvisor(from: 'human' | 'advisor', a: AdvisorMsg): void;
    onPresence(scope: AdvisorScope | null): void;
    frame(): void;                             // called from the frame loop: runs the 2 s timers
    veto(): boolean;                           // the X key; false when nothing shows
    dispose(): void;
  }
  export function mountAdvisorPanel(host: HTMLElement, deps: AdvisorPanelDeps): AdvisorPanel;
  ```
  - The feed: advisor `text` lines (`textContent`), and the human's own lines
    from a text box, sent as `text`.
  - Pings draw through the existing minimap/feed ping path if one exists.
    Otherwise they are a feed line with the tile, and the task report says so.
  - **The strip.** One proposal shows at a time, with its note and
    `describe(cmd)`, an Accept button and a "X to veto" hint, counting down
    `PROPOSAL_MS`.
  - **At the deadline, or on Accept,** it runs `validate(cmd)`:
    - true: `queueCommand(cmd)` then `send({kind:'accept', id})`;
    - false: `send({kind:'veto', id})`, and the feed says
      `t('net.advisor.stale')`.
  - **On X:** `send({kind:'veto', id})`.
  - A queue of `PROPOSAL_QUEUE`; a 4th arrival vetoes the oldest queued, not
    the one showing.
  - The panel mounts only while an advisor is present and is hidden in
    `advise` scope's strip, since an advise advisor cannot propose.
- [ ] **Step 1: The failing tests** (jsdom, fake `now`):
  1. A proposal not vetoed is queued as a command at exactly `PROPOSAL_MS`
     and not before (1999 ms: none; 2000 ms: one).
  2. X before the deadline: no command, one `veto`.
  3. A proposal whose `validate` is false at the deadline: no command, one
     `veto`, and a stale note.
  4. Note text `<img src=x onerror=alert(1)>` renders as literal text (query
     `img` → null).
  5. Four proposals in one tick: the second is vetoed, the first still
     shows, and queue order is kept.
  6. `dispose` clears timers: advancing time after dispose queues nothing.
  7. With no proposal showing, `veto()` returns false, so the keymap lets X
     through to whatever it does elsewhere.
- [ ] **Step 2: Run red, implement, run green.** Run `pnpm vitest run
  packages/app/src/ui/advisor.test.ts && pnpm validate:ui && pnpm typecheck`.
- [ ] **Step 3: Falsify** (each red, then reverted):
  - `>=` to `>` on the deadline: case 1 goes red;
  - skip `validate`: case 3 goes red;
  - `innerHTML` for the note: case 4 goes red;
  - drop the showing proposal on overflow: case 5 goes red;
  - no timer clear in `dispose`: case 6 goes red.
- [ ] **Step 4: UI proof without a dev server from the subagent.** The lead
  (or a session allowed to start one) runs the Task 16 protocol "advisor with
  a friend" once. `ui:routes` gains nothing here; the panel mounts only with
  an advisor present.
- [ ] **Step 5: Commit.**

**N4a ends here.** Open the PR. Its gate is the spec §9 N4 gate's first half:
"an `assist` advisor completes a match with Ilan", run by the lead from
`docs/net/N4-agent.md` (written in Task 16; for N4a, write its first two
sections in this task's commit).

## Phase E: the arena (N4b)

### Task 11: The local relay

The real Worker routes and the real `MatchRoom`, in a Node process, on
127.0.0.1. No Durable Object, no D1 and no billed row. No secret: the ticket
secret is minted in memory at start.

**Files:**
- Create: `tools/src/net/local-relay.ts`
- Modify: `packages/worker/src/match/match-room.ts`: an optional third
  constructor argument `opts?: { tickMs?: number; seed?: (code: string) =>
  number }`. workerd never passes it, so production keeps `TICK_MS` and the
  crypto seed.
- Test: `tools/src/net/local-relay.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface LocalRelay { url: string; origin: string; close(): Promise<void> }
  export function startLocalRelay(o?: { tickMs?: number; seedFor?: (code: string) => number; log?: (s: string) => void }): Promise<LocalRelay>;
  ```
  - An `http.createServer` on `127.0.0.1:0` (`listen(0)`) answers `POST
    /api/match*` by calling `handleMatch(new Request(...), env, Date.now())`.
  - `env` = `{ TICKET_SECRET: randomBytes(32).toString('base64url'), ROOMS:
    <a namespace mapping idFromName(code) to one MatchRoom over a FakeState
    each>, ALLOWED_ORIGINS: origin }`, with no limiters and no DB.
  - A `ws` `WebSocketServer({ noServer: true })` handles the `/ws` upgrade.
    Each accepted socket becomes a `FakeSocket` handed to
    `room.acceptSocket`:
    - `fake.onSend` → `ws.send`;
    - `ws.on('message')` → `room.webSocketMessage(fake.asSocket(), text)`;
    - `ws.on('close')` → `deliverClose(room, fake)`.
  - The relay's own `Origin` check passes through `handleMatch`'s, unchanged.
  - The relay binds only to 127.0.0.1.
- [ ] **Step 1: The failing tests:**
  - **the spawned MCP case deferred from Task 8:** `pnpm agent` as a child
    process, over stdio, against this relay: `tools/list` and `observe`
    answer, and every stdout line is JSON-RPC;
  - an `AgentClient` host creates a versus room through the relay's HTTP
    route and a second joins; both run 100 ticks with `hashOk` and no
    `desync`;
  - `tickMs: 2` runs 100 ticks in under 2 s wall time;
  - `seedFor: () => 7` makes `start.config.seed === 7`;
  - a request with `Origin: http://evil.example` is refused 403;
  - `close()` frees the port: a second `startLocalRelay` gets a new one, and
    the process has no open handles (check `close()` resolves and the test
    exits; vitest's `--reporter=hanging-process` names any leak);
  - **the boundary pin (D2):** a scan of every `.ts` file under
    `packages/{app,render,net,sim}/src` finds no import path containing
    `packages/worker` or `@lions/worker`;
  - **the secret pin:** the relay's stdout and stderr captured over the
    test contain no ticket secret. The test reads the secret back through a
    test-only accessor that exists only in `local-relay.test.ts`'s own
    construction of `env`; or restructure so the test passes its own secret
    in and asserts that string never appears in the logs.
- [ ] **Step 2: Run red, implement, run green.**
- [ ] **Step 3: Falsify** (each red, then reverted):
  - bind `0.0.0.0` (add a test reading `server.address().address`);
  - ignore `tickMs`;
  - log `env` at start (the secret pin goes red);
  - an `import` of `packages/worker` added to an app file (the boundary pin
    goes red).
- [ ] **Step 4: Commit.**

### Task 12: Baseline players and the in-process player

**Files:**
- Create: `tools/src/net/players.ts`
- Test: `tools/src/net/players.test.ts`

**Interfaces:**
- Produces:
  ```ts
  /** May be async: an external or slow policy is a promise; the in-process player never awaits past `roundWallMs`. */
  export type Policy = (view: SideView) => Command[] | Promise<Command[]>;
  export const passive: Policy;              // orders nothing
  export const rush: Policy;                 // attack-move every own unit on the centroid of visible contacts, else on view.enemyCamp
  export interface ArenaPlayer { readonly name: string; start(seat: SeatStart): Promise<RunningPlayer> }
  export interface SeatStart { server: string; origin: string; code: string; seat: Seat; ticket: string; build: string }
  export interface RunningPlayer { readonly client: AgentClient | null; done: Promise<PlayerReport>; stop(): Promise<void> }
  export interface PlayerReport { tokens: number | null; timeouts: number; errors: string[] }
  /** An in-process player: an AgentClient; once per round (paced) or every 100 ticks (realtime), policy(view) through the desk, then done(round). */
  export function inProcess(name: string, policy: Policy): ArenaPlayer;
  ```
  `rush` reads only `SideView`, so it cannot cheat fog. The tiles it issues
  are `fx.from(tile + 0.5)`.
- [ ] **Step 1: The failing tests** (on the local relay):
  1. **Fog honesty:** `rush` given a view with no contacts orders toward
     `enemyCamp`, never toward a hidden unit's tile. Construct a world where
     a side-1 unit is placed off the camp axis and unseen; assert no ordered
     point is within 3 tiles of it.
  2. **A control that must win:** `rush` versus `passive` on `tel_marum`,
     paced at 40 ticks, seed 1, both seat orders. `rush` wins both games, by
     annihilation or on forces at the cap.
  3. **A control that must draw or split:** `passive` versus `passive` ends
     `draw` at the arena cap with equal forces (mirror), or as a stalemate.
  4. **A model that hangs:** a policy that never returns (a promise that
     never resolves) at `roundWallMs: 1000` costs ~1 s per round, and the
     match still advances. `timeouts` counts the rounds.
- [ ] **Step 2: Run red, implement, run green.**
- [ ] **Step 3: Falsify** (each red, then reverted):
  - `rush` targets the enemy's TRUE centroid from `world().sim` (the cheat):
    case 1 goes red;
  - `rush` returns `[]`: case 2 goes red;
  - the in-process player never sends `done`: case 2 slows to `roundWallMs`
    per round. Assert the run takes under N × roundTicks × tickMs + slack,
    and see it go red.
- [ ] **Step 4: Commit.**

### Task 13: The arena: swapped sides, scoring, the report

**Files:**
- Create: `tools/src/net/arena-score.ts`, `tools/src/net/arena.ts`
- Modify: `tools/package.json` (`"arena": "tsx src/net/arena.ts"`), root
  `package.json` (`"arena": "pnpm --filter @lions/tools arena"`)
- Test: `tools/src/net/arena-score.test.ts`, `tools/src/net/arena.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // arena-score.ts
  export interface GameRecord {
    seed: number; map: string; matchup: Matchup;
    players: [string, string];                 // by SEAT
    factions: [Faction, Faction];              // by seat
    outcome: 'seat0' | 'seat1' | 'draw' | 'void';
    by: string;                                // annihilation | stalemate | time | cap | forfeit | surrender | desync
    ticks: number; score: MatchScore;          // by side, from seat 0's sim at the end
    reports: [PlayerReport, PlayerReport];
  }
  export interface Tally { player: string; games: number; wins: number; draws: number; losses: number; voids: number; score: number; bySeat: [number, number]; byFaction: Record<Faction, number> }
  export function tally(games: readonly GameRecord[]): Map<string, Tally>;
  export function markdownReport(games: readonly GameRecord[]): string;
  // arena.ts
  // pnpm arena -- --a <player> --b <player> --seeds 10 --map tel_marum [--matchup mirror|kdf|sarim]
  //               [--pace 60] [--round-wall-ms 120000] [--cap-ticks 12000] [--tick-ms 2] [--out arena-results/]
  ```
  - A player spec is `passive`, `rush`, or `cmd:<template>` (Task 14).
  - For seed `s` (seeds `1000 + 7919 n`, as the versus probe uses), play
    game 1 with A on seat 0, then game 2 with B on seat 0.
  - The map and matchup are checked with `versusMapAllowed` and
    `matchupAllowed`: the arena plays only what a room offers.
  - Score = `(wins + draws / 2) / (games - voids)` (D7).
  - The cap: at `--cap-ticks` the arena asks `outcomeOf(sim,
    MATCH_CAP_TICKS)` on seat 0's sim, the probe's rule, records `by:
    'cap'`, and stops both players.
  - A game in which the two players' sims report different results, or the
    room sends `desync`, is `void`.
  - Output files:
    - `arena-results/<date>-<a>-vs-<b>.jsonl`: one `GameRecord` per line;
    - `arena-results/<date>-<a>-vs-<b>.md`: per-player tally, by seat and
      by faction, the per-game table with the scoreboard columns, and tokens
      when present.

    `arena-results/` is git-ignored: add it to `.gitignore` in this task.
- [ ] **Step 1: The failing tests.**
  - `arena-score.test.ts`:
    1. **Credit follows the player, not the seat:** fake records where seat
       0 always wins, with A and B alternating seats. A and B each score
       0.5, and `bySeat` shows seat 0 = 1.0 for both.
    2. **Draws are half:** A wins 1, draws 1 of 2 → 0.75.
    3. **Voids** are excluded from the denominator and counted.
    4. **Faction split:** A wins every game as KDF and loses as Sarim → 0.5,
       with `byFaction.kdf = 1`.
  - `arena.test.ts`: `--a rush --b passive --seeds 1 --map tel_marum
    --pace 40 --tick-ms 1 --cap-ticks 6000`, in-process, writes a JSONL of
    exactly 2 records with `players` swapped between them and `rush`'s score
    1.0. A refused map (`qarn_hadid`) exits 2 before any room. `--matchup
    kdf --map milh_flats` exits 2 (mirror-only).
- [ ] **Step 2: Run red, implement, run green** (allow the arena test 120 s).
- [ ] **Step 3: Falsify** (each red, then reverted):
  - `tally` credits `players[0]` with seat 0's win regardless of who sat
    there: case 1 goes red;
  - draws count as losses: case 2 goes red;
  - voids in the denominator: case 3 goes red;
  - the arena plays both games with A on seat 0: the arena test's swap
    assertion goes red;
  - skip `matchupAllowed`: the milh_flats case goes red.
- [ ] **Step 4: Commit.**

### Task 14: External players: a model over MCP, with no key in the repo

**Files:**
- Create: `tools/src/net/external-player.ts`, `tools/src/net/arena-prompt.md`,
  `tools/src/net/test-mcp-client.ts`
- Test: `tools/src/net/external-player.test.ts`

**Interfaces:**
- Produces:
  ```ts
  /** `cmd:<template>`: placeholders {mcp} (path of an MCP config JSON naming the harness),
   *  {prompt} (path of the standing prompt), {seat}, {code}. Run with the parent's env, unchanged. */
  export function externalPlayer(name: string, template: string): ArenaPlayer;
  ```
  - Per game, the arena makes a temp directory (`mkdtemp`, mode 0700). It
    writes the seat ticket (0600), and an MCP config `{ "mcpServers": {
    "lions": { "command": "pnpm", "args": ["--silent", "agent", "--",
    "--server", url, "--code", code, "--scope", "command", "--ticket-file",
    "<path>"] } } }` (0600).
  - It renders the template, spawns it with `shell: false` (the template is
    split by a small quoted-argument parser; no shell expansion), and pipes
    its stdout and stderr to `<out>/<game>-<seat>.log`.
  - The directory is removed on exit, including on a thrown error.
  - `tokens`: if the child's last stdout line parses as JSON with
    `usage.input_tokens` and `usage.output_tokens`, their sum; else null.
  - `arena-prompt.md` is the standing prompt:
    - the game in ten lines;
    - the tools and their scopes;
    - "you are side N";
    - "call `observe`, decide, `order`, then `end_round`; repeat until
      `status` shows a result";
    - the fog rule;
    - the order cadence (4 a second at most; `queue_full` means wait).
  - An example template for Claude Code, in the run protocol only, never as
    a default: `cmd:claude -p --model <model-id> --mcp-config {mcp}
    --output-format json --allowedTools mcp__lions__* < {prompt}`. The `<`
    redirect means the parser must support a stdin-from-file token; implement
    `< {prompt}` as "pipe that file to stdin".
- [ ] **Step 1: The failing tests.**
  1. `test-mcp-client.ts` is an MCP client over the SDK that plays `rush`
     through the tools: `observe`, `order` and `end_round`, in a loop.
     `externalPlayer('fake', 'cmd:tsx tools/src/net/test-mcp-client.ts
     {mcp}')` versus `inProcess('passive')` wins both seat orders. This is
     model-vs-baseline end to end, with no model and no key.
  2. The temp directory and both 0600 files exist while the child runs, and
     are gone after (an injected throw in the middle of a game still removes
     them).
  3. The ticket appears in no argv: assert the spawned args array does not
     contain the ticket string.
  4. A template with `$(rm -rf ~)` is passed as literal arguments (the child
     `node -e "console.log(JSON.stringify(process.argv))"` shows it
     verbatim), never run by a shell.
  5. The environment passed to the child is `process.env` as is. The arena
     adds no variable whose name contains `KEY`, `TOKEN` or `SECRET`.
- [ ] **Step 2: Run red, implement, run green.**
- [ ] **Step 3: Falsify** (each red, then reverted):
  - `shell: true`: case 4 goes red;
  - the ticket in `--ticket <value>` instead of a file: case 3 goes red;
  - skip cleanup in `finally`: case 2 goes red;
  - the test client ignores `observe` and orders toward the true enemy
    centroid: no test can see this through MCP, because the harness only
    exposes the view. Record it as a survivor of a different kind: the fog
    guarantee lives in Tasks 2 and 8.
- [ ] **Step 4: Commit.**

### Task 15 (deferred, D6 ruled "not now" 14 Oct): Remote results, D1 `matches` and `/stats/arena`

**Deferred. Ruled 14 Oct (lead): D6 "not now".** Do not start this task in
N4b. Record the deferral in the N4b PR body and skip to Task 16. The task
stays here as the design for when D6 is reopened.

**Ruled 14 Oct (lead), the open point below: keep `over` unchanged in N4.**
When this task is built, results are recorded from the room's own end state:
its ending reason (`forfeit`, `surrender`, `left`, `void`, `expired`) and, for
`over`, "result reached" with no winner. A `winner`/`by` field on `over` is a
later protocol change, not part of N4.

**Files:**
- Create: `packages/worker/migrations/0006_matches.sql`
- Modify: `packages/worker/src/match/match-room.ts` (one `INSERT` on a
  versus room's end, awaited, under a daily budget like `writeDesync`'s),
  `packages/worker/src/stats.ts` (`/stats/arena`, behind the stats login),
  `packages/worker/QUERIES.sql`
- Test: `match-room.test.ts`, `stats.test.ts`

**Interfaces:**
- `matches(code TEXT PRIMARY KEY, map TEXT, seed INTEGER, matchup TEXT,
  kinds TEXT, winner INTEGER, by TEXT, length_ticks INTEGER, ended_at
  INTEGER)`.
  - **No player ids, no callsigns, no tokens** (the Worker never learns
    them).
  - `winner` is −1 for a draw or void.
  - The room records `by` and `winner` from its own ending reason only.
    The seats' `over` reports carry a tick but no result, and **stay that
    way in N4** (ruled 14 Oct, lead): an `over` ending is stored as
    `by: 'over'`, `winner: -1` ("result reached"). `over{tick, winner, by}`
    is a later protocol change.
- [ ] Steps:
  - the failing tests (when reopened): one row per ended versus room, none for a sandbox
    room; the daily budget refuses the 501st; `/stats/arena` 302s without a
    session;
  - red, implement, green;
  - falsify by dropping the budget check and writing for sandbox rooms.
- [ ] **Lead action in the PR body:** `npx wrangler d1 migrations apply
  roaring-lions-telemetry --remote` before merge. Cost: +1 D1 row per versus
  match.

### Task 16: The run protocol, the spec as built, and the gate

**Files:**
- Create: `docs/net/N4-agent.md`
- Modify: `docs/superpowers/specs/2026-10-10-network-game-design.md` (a
  dated "N4 as built" section after §11b; mark decisions 18 and 19 with
  what shipped)

**Content of `docs/net/N4-agent.md`:**
1. **An advisor with a friend.** In the lobby:
   - choose Invite an advisor → Assist, and copy the ticket;
   - in a terminal at the deployed build's commit, run `pnpm agent --
     --server https://<your-worker> --code ABC123 --scope assist
     --ticket-file -` and paste the ticket;
   - add it to your MCP client's config (example JSON).

   The panel shows the advisor; proposals show for 2 s, and X vetoes one.
   If the room says `build_mismatch`, check out the deployed commit.
2. **A bot opponent.** Create a versus room in the browser, then run `pnpm
   agent -- --server … --code … --scope command --join`. The bot takes seat
   1. Its orders are coalesced to at most one flush a second (D4).
3. **The arena.** `pnpm arena -- --a rush --b passive --seeds 10 --map
   tel_marum --pace 60` runs fully local: no rows, no secret, no network. For
   a model, use `--a "cmd:<your MCP client command with {mcp} and
   {prompt}>"`. The arena passes your environment through and never reads a
   key. Results are in `arena-results/`.
4. **What the Origin header is** (D9), and **why fog is a courtesy** (D10),
   in one line each.

- [ ] **Step 1:** Write the doc and the spec section. The spec section
  records, as built: the advisor socket, paced mode, the desk cadence, the
  local relay, the baselines and the scoring. It also records that D6 was
  ruled "not now" (Task 15 deferred).
- [ ] **Step 2: Gates.** Run `pnpm test && pnpm typecheck && pnpm lint &&
  pnpm validate:ui && pnpm validate:data && pnpm test:determinism` (all
  green; determinism unmoved), then `pnpm arena -- --a rush --b passive
  --seeds 10 --map tel_marum --pace 60 --tick-ms 2`. Paste the markdown table
  into the PR body. `rush` must score ≥ 0.9; if it does not, the controls are
  broken, not the bots.
- [ ] **Step 3: The spec §9 N4 gate,** run by the lead, not a subagent:
  - an `assist` advisor completes a match with Ilan (protocol §1);
  - a ten-seed arena run between two models (protocol §3, two `cmd:`
    players), its table posted on the N4 issue.
- [ ] **Step 4: Commit** the doc and the spec.

---

## Appendix: why the plan is shaped this way

- **The browser and the harness share one world builder (Task 1)** because a
  copy would agree today and drift silently. Spec §11 warned of exactly that
  for fog, and Task 2 applies the same rule there.
- **An `assist` order never comes from the advisor's socket.** The human's
  browser sends it as its own `cmd` after the veto window. So ownership,
  rate caps and the row budget see one seat's orders, exactly as now, and the
  room needs no "who issued this" field in a frame. That would be a protocol
  change touching every client, and a sim change in N2.
- **The arena runs on the real `MatchRoom`, not on a re-implementation.** A
  room-core-only relay would skip the DO's socket rules (advisor roles, the
  budget, hello timeouts), and those are the parts N4 adds.
- **N2 is not needed for any of this.** The verbs a model gets are exactly the
  ones a human gets in versus today. `set_stance`, `build` and `fire_support`
  from spec §8.3 arrive with N2/N3's commands, and a test in Task 8
  (`toolsFor` lists exactly the table above) makes their later addition a
  deliberate change.
- **N2's prerequisites** are in spec §11b.4: the garrison overhaul, F1 (and
  F2 Task 1 with it), no concurrent `Command` additions, and a ruling on
  whether a versus room runs a `MissionRuntime`, with the sim surfaces listed.
