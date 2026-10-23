# Versus tunnels T3–T6: routes in the rules files, the Sarim seat's HUD, the probe's tunnel arm

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In a KDF-v-Sarim room the Sarim seat owns two authored, pre-dug routes at its end of
the map, can send foot units below, sees them travel, and brings them up to raid or to stay; the
KDF seat sees nothing of a route it has not identified; and the versus probe measures whether
that is fair.

**Spec:** `docs/superpowers/specs/2026-10-22-versus-tunnels-design.md` (GH-681). The lead
accepted all twelve §9 recommendations (22 Oct). In particular: Q1 the fairness bar as written,
Q2 all eight strawman routes for the first probe run, Q3 vents at least 18 tiles from the
opposing anchor, Q4 capacity 4 a route, Q9 `outcomeOf` unchanged (the turtle control decides).

**Base:** `feat/net-n3` `e634c65c` (N3, PR GH-758, not yet merged; it carries T1+T2, GH-737).
Branch `feat/versus-tunnels-t3`. Line numbers are hints; locate code by symbol.

**Order:** T3 → T5 → T4 → T6. The probe (T5) is the fairness gate and the lead's STOP point, so it
runs before the HUD work (T4) is spent.

---

## Pre-flight against `e634c65c`

| # | Finding | Consequence |
|---|---|---|
| P-1 | T1+T2 are in: `enterTunnel`/`vent` commands, `tnOwner`, `capacity`, `tunnelEta`, the humanHeld surfacing gate, `tnOrderLive`, the net whitelist and ownership checks, `factionOfSeat`/`tunnelOwner` on `SeatWorld`. | No sim or net mechanics are written here. |
| P-2 | `data/versus/{tel_marum,wadi_tarfan}.json` exist (N3 Task 1), validated by `versus_rules.schema.json` and `tools/validate_versus_rules.mjs`. `contentDigest` already folds `versusRules`. | The `tunnels` block is one more key; the digest covers it with no code change. |
| P-3 | A KDF-v-Sarim room is always an **economy room** (`economyRoom`: the two seats' factions differ). `buildMatchWorld` registers `map.tunnels` (none on either matchup map), then the forces, then the runtime. | The routes register only in an economy room, so no mirror byte moves. |
| P-4 | The economy probe arm (`--economy`) runs `buildMatchWorld` + `matchTick`, decided by `outcomeOf` with production counted. Shipped 1500/2400 purses: all four economy cells 52–54 % at 48 seeds (N3 ledger, Task 7b). | The tunnel arm is built on the economy arm: that is the room the Sarim seat plays. |
| P-5 | `tools/src/net/versus-tunnels-two-client.test.ts` adds the strawman `tm_n_east` route by hand (`sim.addTunnel`) on top of `buildMatchWorld`. | After T3 the route is already registered; the test must use the registered one or it registers a duplicate. |
| P-6 | `main.ts`'s room path takes `versusWorld.map` and `versusWorld.sim`; it does not register tunnels itself (`versusWorld === null` guard). | T3 keeps one positional array: `MatchWorld.map.tunnels` lists the map's routes then the rules routes, in sim route order. |
| P-7 | Pins on the base: `VERSUS_ECONOMY_PINS` tel_marum -193936706 / wadi_tarfan -1815401533 (KDF-host economy room, 200 ticks). Mirror pins (`match-world` 1108074073 / 1524988923, `versus-force`, per-seat-types) are mirror rooms. | Registering a route can move only the economy pins (a route's state is hashed). Each moves in its own commit with "Was <n>." Any OTHER pin moving is a STOP. |

---

## Pin table

| Pin | May move? | Where |
|---|---|---|
| `VERSUS_ECONOMY_PINS` (both maps) | yes, T3, own commit | `packages/app/src/net/match-world.test.ts` |
| any other versus economy-room digest (two-client, two-engine readings) | yes, named in the commit | tools/src/net |
| determinism golden, ECONOMY_PIN(_RELIEF), RUNTIME_DIGEST_PIN(_RELIEF), WOUNDED_WORLD_PIN, mirror pins, per-seat-types, LADDER_CREDITS, ROSTER_MAX | **no: STOP** | |
| playtest outcomes, `pnpm balance` §5.7 | **no: STOP** | |

---

## Task 3: the routes in the rules files

**Files:** `data/schemas/versus_rules.schema.json`, `data/versus/{tel_marum,wadi_tarfan}.json`,
`packages/data/src/versus.ts` (+ test), `tools/validate_versus_rules.mjs` (+ `.d.mts`, test),
`packages/app/src/net/match-world.ts` (+ test), `tools/src/net/versus-tunnels-two-client.test.ts`.

- [ ] **Schema.** An optional `tunnels` object with optional `friendly` and `hostile` arrays (by
  END, like `ends`). Each route: `{ id, points, capacity }`; `id` `^[a-z0-9_]+$`; `points` 2–8
  integer `[x, y]` pairs, mouth first, vent last; `capacity` integer 1–8. No `side`, no `pre_dug`
  in the file: the owner is the room's call and every versus route is pre-dug (spec §2.4, §6.1).
- [ ] **Data: the eight strawman routes** (spec §6.3), capacity 4 each. *(As built: the strawman
  set failed the bar in T5 and was re-authored on the lead's ruling, 22 Oct; the shipped points
  and capacities are in spec §6.3. The list below is the strawman set the task started from.)* Ends: on `tel_marum`
  `friendly` is the south anchor (24,46) and `hostile` the north (28,16); on `wadi_tarfan`
  `friendly` is `versus_0` (10,10), `hostile` `versus_1` (37,37).
  - `wadi_tarfan` friendly: `wt_f_north` (12,12)→(18,14)→(24,17); `wt_f_west` (12,12)→(15,19)→(19,26).
  - `wadi_tarfan` hostile: `wt_h_south` (35,35)→(29,33)→(23,30); `wt_h_east` (35,35)→(32,28)→(28,21).
  - `tel_marum` hostile (north): `tm_n_west` (26,10)→(16,12)→(14,22); `tm_n_east` (30,10)→(36,14)→(36,24).
  - `tel_marum` friendly (south): `tm_s_west` (22,44)→(14,38)→(12,30); `tm_s_east` (26,44)→(34,40)→(38,34).
- [ ] **Loader** (`@lions/data`, pure, copies only): `versusTunnelsOf(rules, end, side)` →
  `TunnelRouteJson`-shaped routes (`dig_tiles_per_s: 1`, `pre_dug: true`, `side`, `capacity`),
  in file order. `@lions/data` cannot import `@lions/sim`'s type; restate the shape as the loader's
  own interface, as `versusMissionOf` does.
- [ ] **`validate:data`** (`versusRulesFailures`), each new check with its falsification run:
  every point inside the map; mouth and vent on a tile in `OPEN_SYMBOLS` (passable, not a
  building); vent at least `VENT_MIN_DIST` = 18 tiles (Euclidean, to the tile centre) from the
  OPPOSING end's anchor; `capacity` 1..8; route ids unique within the file and not a map route's
  id; the map's routes plus the larger end's count at most `MAX_TUNNELS` (16).
- [ ] **Registration** in `buildMatchWorld`, in the existing tunnel block, AFTER the map's routes:
  only in an `economyRoom(config)`; the Sarim side is the side whose faction is `sarim`; its END
  is `endOfSide[sarimSide]`; register `versusTunnelsOf(rules, end, sarimSide)` with the same
  positional assert. Append the same routes to the returned `map.tunnels` (a new `ParsedMap`
  object, never mutating the shared parse) so every positional reader agrees with the sim. If the
  economy runtime's `MissionContext` takes `tunnels`, hand it the same array.
  - Order inside `buildMatchWorld` does not move entity ids (a route is not an entity), but read
    the code and say whether the hash moves; it is expected to (route state is hashed).
- [ ] **Tests:** a Sarim-host and a KDF-host room on each map register exactly that map's
  Sarim-end routes, owned by the Sarim side (`sim.tunnelOwner`), pre-dug, capacity 4; a mirror
  room registers none; `map.tunnels[r].id` equals the sim's route `r` id for every r. Falsify:
  register the KDF end's routes instead, watch the end test go red.
- [ ] **Two-client test** (P-5): use the registered `tm_n_east` (a Sarim-HOST config if the north
  end is the guest's; read the end from the config, do not guess) instead of `addTunnel` by hand.
  It must still exercise enter → arrive → raid → exit → re-enter and stay equal every tick.
- [ ] **Pins:** run the match-world test. If `VERSUS_ECONOMY_PINS` moves, re-pin in its OWN
  commit, the comment saying "Was -193936706 / -1815401533." and why. Anything else moving: STOP.
- [ ] **Gates:** test:determinism, lint, typecheck, pnpm test, validate:data, validate:ui,
  balance, playtest (identical to `_coord/tunnels-t3-run/base/` apart from timing).

## Task 5: the probe's tunnel arm, and per-route containment

**Files:** `tools/src/backtest/versus-probe.ts` (+ test), a new
`tools/src/versus_tunnel_routes.test.ts`. Reviewer: balance-analyst.

- [ ] **`--tunnels`** on top of `--economy` (it implies it). Faction cells only, both rules-file
  maps, both spawn orders. Four cells per map and spawn order (spec §7.2):
  1. **off**: today's economy arm, routes registered but never ordered (must equal the plain
     `--economy` reading game for game, because an unordered route is inert; this is a check, not
     a hope: compare and print it);
  2. **on, no answer**: Sarim tunnel plan, KDF today's plan;
  3. **on, answer**: Sarim tunnel plan, KDF answer plan;
  4. **turtle**: every Sarim foot unit goes below and stays below to the cap; KDF answer plan.
- [ ] **Sarim tunnel plan** (spec §7.1), commands through the same path the arm already uses
  (`sim.applyCommands` / the runtime's queue, exactly as a room frame would apply them):
  - at tick 0, up to each route's capacity of the Sarim side's non-wheeled, non-air ground units
    take `enterTunnel` on the Sarim end's routes, split across the two routes, nearest first; the
    rest play the arm's existing plan; built foot units are fed into a route with room the same way
    at each 20 s round;
  - an ARRIVED buried unit (`tunnelEta` 0) raids (`vent raid`) when a KDF unit stands within its
    best weapon's max range of the vent and in sight from it; after the raid it is back below and
    may raid again;
  - once the KDF centroid has passed the vent (nearer the Sarim anchor than the vent is), arrived
    units `vent exit` and join the attack-move.
- [ ] **KDF answer plan:** the placed `recon_drone` sweeps the midfield (waypoints between the two
  anchors, through the Sarim routes' midpoints; the probe may read route geometry, it is the
  answer an informed player gives); the production plan queues one `yahalom_squad` first (it is on
  the KDF menu, GH-684); a living squad `chargeTunnel`s any Sarim route its side has IDENTIFIED
  (`tunnelContactLevel(0, r) === 2`), and otherwise moves with the drone.
- [ ] **Turtle:** as cell 2's entry, then never vents. Decided at the cap by `outcomeOf` unchanged
  (Q9).
- [ ] **Self-check (exit 2):** cell 2 must count at least one `surfaced` event per map and spawn
  order over the run, and cell 1 must equal plain `--economy` game for game. Falsify: make
  `enterTunnel` a no-op in the sim (one line), watch exit 2, restore. Say so in the commit.
- [ ] **Per-route containment test:** for each of the eight routes on a real `buildMatchWorld`
  room, bury a Sarim foot unit there by order and let it arrive; then fire on the route's tiles,
  smoke them, order the buried unit to `move` from the KDF seat and from its own seat; it must keep
  full HP and stay below; then a Yahalom `chargeTunnel` on the identified route kills it. Falsify:
  delete the containment strip for one kind and watch it go red.
- [ ] **Run:** `pnpm versus:probe -- --tunnels --seeds=48` (plus the 25-minute cap reading if the
  10-minute cap ends most games on value, as N3 Task 7 did). Save to
  `_coord/tunnels-t3-run/task5/`.
- [ ] **STOP and report** (do not tune) if: any cell 3 is outside 60/40; cell 2 shows no Sarim
  edge over cell 1 in both spawn orders on a map; cell 4 wins for Sarim (more than half its
  games). Report the four tables as they stand.

## Task 4: the Sarim seat's app and HUD, and the KDF fog audit

**Files:** `packages/app/src/input/{intents,cursor}.ts`, a "Below ground" strip under
`packages/app/src/ui/`, `packages/app/src/i18n/en.json`, `packages/render/src/three/ThreeRenderer.ts`
(`xrayFrame`, the route draw), `packages/app/src/ui/minimap.ts`, a sim read accessor if one is
missing (sim-guard reviews any sim line).

- [ ] **`routeLevelFor(sim, viewer, r)`**, one helper: 2 when `sim.tunnelOwner(r) === viewer`,
  else `sim.tunnelContactLevel(viewer, r)`. Every route read in the renderer and the minimap goes
  through it.
- [ ] **Enter:** right-click on an own route's mouth or vent tile (within one tile) with foot
  units selected queues `enterTunnel`; a wheeled or air unit in the selection attack-moves to the
  tile instead. `cursorKey()` reads `tunnel-enter`, or `blocked` when nobody selected can enter.
  Only the Sarim seat on its own routes (T-R4); single-player and the KDF seat never see it.
- [ ] **"Below ground" strip:** one chip per own buried unit: unit icon, route name, arrival time
  (`tunnelEta` in seconds) or "at the vent"; selecting chips offers **Vent: raid** and **Vent:
  exit**, disabled for a unit still travelling, with the reason. Mounted and torn down in the
  battlefield disposer (the disposer contract). Every string through `t()`.
- [ ] **Fog audit** (spec §4.3), under `viewerSide`: unit draw, picking, minimap dots, `xrayFrame`
  (keep only routes the viewer is at level 2 on, through `routeLevelFor`), HUD target reads,
  `intel-moments`, `hold-outside`, and the `surfaced`/`submerged` events (reach the KDF
  presentation only when the vent tile is in its sight). Write what each read does in the commit.
- [ ] **Witness test:** a KDF-viewer renderer (or the narrowest unit that owns the read) over a
  room with a Sarim unit buried on an unidentified route: zero unit draws, zero x-ray occupants,
  zero minimap marks. Falsify by deleting the x-ray filter.
- [ ] **One Metal browser check** on your own port (not 5177), music off: a Sarim-host room on
  `tel_marum` (or the sandbox path that reaches the same code), enter, arrive, raid, exit, by
  driving the UI. Screenshots to `_coord/tunnels-t3-run/task4/`.
- [ ] **Gates:** as Task 3, plus `validate:ui`.

## Task 6: the browser engines on a route map

**Files:** `tools/src/net/two-engine.ts` (and whatever `net:engines` reads).

- [ ] `net:engines` plays the T3 two-client tunnel stream (enter → arrive → raid → exit →
  re-enter on a registered `tel_marum` route) in Chromium, Firefox and WebKit and compares every
  hash with Node's. It runs in CI only (common rules: no local heavy browser walks); run its Node
  half and its unit tests locally.
- [ ] Falsify: a one-line mutation that makes the browser stream differ (drop the vent frame on
  the browser side) must make the comparison red in the Node-side test.

---

## Report

The PR (to `main` once GH-758 merges; until then based on `feat/net-n3`), the four probe tables
per map and spawn order, every pin read back, and any STOP.
