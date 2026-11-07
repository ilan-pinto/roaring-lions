# Capture the flag, redesigned: a defended flag with a set-up phase (GH-976)

6 Nov 2026 · design only, nothing built · base origin/main · Opus design agent, saved by the coordinator.
Binding: the lead's ruling of 6 Nov (GH-976): "I suspect that my flag was placed behind the enemy line, so it was very easy for the enemy to get to my flag. At flag combat, each side should have 30 minutes to design and protect the camp."

## Summary
1. Rules: raid-and-hold (the engine already has it), not carry-home. Your flag is 6-12 path tiles behind your own seat. Validator: path(own seat -> own flag) <= 0.5 x path(enemy seat -> own flag). Shipped wadi_tarfan_l flags read 51 vs 27 and must fail.
2. Hold: 45 s in one go. Only ground units hold or contest; any enemy ground unit in the flag ground resets to 0. New `ground_only` on `capture` keeps aircraft out.
3. Set-up (recommended B): 3:00 inside a 30-minute flag match, with an early bell when both press Ready. A literal 30-min prep is refused: a mode room has a placed 15-unit force and no economy, so there is nothing to do after about 3 min.
4. Enforcement, all sim: `setupUntil` + `ready` Command (`readyMask`, bell 5 s after both); per-side region clamp at the perpendicular bisector of the seats with a band (8 tiles on 48x48, 12 on 80/96); weapons tight until the bell; flag objectives wait for the bell. Hash fold behind `setupLive`; new `SETUP_WORLD_PIN`.
5. Fortify: a fixed per-side kit placed instantly in set-up only, owned by the placer: hesco 12, sandbag_post 4, t_wall 2 (`fortify`/`unfortify`, footprint `placementReason` incl. passage seal, one `recomputeFields` per tick). Field works stay off in versus (turning them on: ~4 agent-days + reversing a standing rule).
6. Maps: refit the five point-symmetric maps first (wadi_tarfan, milh_flats, rujm_sawda, wadi_tarfan_l, milh_flats_l). tel_marum and beit_sahwan_outskirts wait (no seat markers, no symmetry). A corner window behind each seat exists on all seven maps (path ratios 0.10-0.28).
7. Set-up validator rules S1-S4: spawns inside own region; an 11x11 apron round each flag inside its owner's region; each flag >= 17 tiles from every enemy-region tile (air sight 16 + 1); band >= 8 / 12. Cap 30 min held by a test.
8. Probe v2: scripted defend (~40% value) / raid split with a kit template. Arms ACTIVE, TURTLE, NOSETUP, RUSH, PASSIVE. Bars: leader <= 60% (all and decisive); >= 70% goal-decided; median bell-to-goal 4-10 min (48) / 6-15 min (80/96), <= 5% at cap; p10 >= 2:00 / 3:00; RUSH end <= 50%; TURTLE end <= 10%; NOSETUP end loses >= 60%; PASSIVE loses every game by the goal. Mutations M5-M8 seen red. Seeds: fit 40000-40191 (24-seed screen first), read once 41000-41287, PR review 42000-42287. Games ~5-8x longer: run on CI or at low load.
9. Bot and HUD: DEFEND / RAID labels (`hud.flag.defend`, `hud.flag.raid`), set-up banner with countdown and Ready, dashed line and own-region tint, "Holding at the line" chip, kit dock reusing works placement. `observe.setup {secondsLeft, line, kit, ready}`; verbs `fortify`, `unfortify`, `ready`; prompt lines for the hold rule, defend, and set-up.
10. Interim: YES, pull flag from the lobby now: `WIN_MODE_FAIR_MAPS.flag = []` plus the pinning tests. Engine, mode files and probe stay.

## Facts (origin/main)
- A mode room is goals-only with placed forces (`economyRoom` false when `winMode` is set; `MissionRuntime` `goalsOnly`: no purse, line or rally). Forces are `VERSUS_KDF`, 15 units each incl. one `dozer_d9`. Flag is offered in the mirror only.
- Today's win: one `capture` per side on the OTHER end's 5x5 zone, `hold_s` 30; any living, surface, not-down unit counts, aircraft included (`livingIn`/`contestedIn` never test `isAir`); contact resets; fire from outside contests nothing.
- Flag-centre distance, owner seat / raider seat: beit_sahwan_outskirts 24/13, tel_marum 17/12, rujm_sawda 44/35, wadi_tarfan_l 52/26, wadi_tarfan 22/29, milh_flats 25/32, milh_flats_l 39/46. On four maps the flag is nearer its raider; on three the margin is thin.
- Field works: `raiseWorks`/`cancelWorks` are dropped in every versus room (`net/ownership.ts`); `requestConstruct` charges `purse[0]`; works apply only for side 0; every buildable is `owner: 0`.
- Available: `Sim.addStructure(type, tiles, {owner, progress})`, `Sim.placementReason` (four rules incl. the passage-seal flood; needs a `buildable` block today). `hesco` (600 hp, cover 3), `sandbag_wall`, `sandbag_post` (garrison 1), `t_wall` (900 hp, tall) exist with meshes, 1x1 `per_tile`, not buildable.
- Infantry 0.9 t/s; ground sight max 12 (Lavi); air sight max 16 (recon drone).

## 1. Rules
R1. Your flag stands behind your own line. 5x5, all open (no `#`, `^`, `b`, `d`, `~`, no structure). Foot paths: 4-neighbour BFS on the foot mask from each seat marker.
- G-ratio: own path <= 0.5 x enemy path. Falsify on the shipped wadi_tarfan_l (ratio 1.9).
- G-depth: own path 6-12; enemy path >= 45 (48x48) or >= 80 (80/96).
- G-edge: zone >= 3 tiles from the map edge.
- Kept: point-mirrored flags; no spawn on a flag at tick 0; flags and camps do not overlap.

R2. Raid and hold, not carry home. The engine has it all (`capture` with `side`, contest reset, `completeTick`, `flag-view.ts`, `observe`); a visible contestable hold gives the defender a clock. Carry home needs a new entity class (pick-up, carrier, drop, return, snapshot rows, verbs), rewards the fastest unit (jeep 2.9 t/s, Peten 3.4), and would collapse the goal share in a 15-unit force with no reinforcements.

R3. Hold 45 s in one go; the probe may fit 30-60, one value per size class.

R4. Contest: hold needs >= 1 raiding ground unit (living, surface, not down) inside and no enemy ground unit inside. The contest is the shipped rule, `Mission.contestedIn`: an enemy unit within `CONTEST_RADIUS_SQ` (6 tiles) of one of yours, both standing in the zone. A 5x5 zone's diagonal is 7.07 tiles, so the radius covers it except between two units each within about 0.7 tile of OPPOSITE corners (up to 7.06 apart): those two do not contest. **Open (WP2 decides, with the lead):** keep the v1 rule as it is (the probe measures it), or let the set-up hold test presence of both sides in the zone with no radius; either way WP2 adds an opposite-corner test that pins the choice. An enemy ground unit inside, or the raiders leaving, resets to 0. Aircraft neither hold nor contest (`ground_only: true`, set by `versusModeMissionOf`; no mission sets it, so no pin moves). Annihilation, the cap and the same-tick double capture (a draw) are unchanged.

## 2. The set-up phase
| option | what | for | against |
|---|---|---|---|
| A | 90 s set-up inside the map cap (25/35 min) | cheapest | tight on a 96x96 map |
| **B (recommended)** | **3:00 set-up (`setup.seconds` 180), early bell on both Ready; flag match capped at 30 min on every map** | matches the lead's figure as the match length; a real design window | a mode-specific cap twin in `@lions/net` |
| C | literal 30-min set-up | the words as written | nothing to do after ~3 min; cap 45-60 min; bot token budgets. Refused |

Allowed in set-up: move, garrison, stance, formations (where open), load/unload, `fortify`/`unfortify`, `ready`. Not allowed: firing, crossing the line, production, rally. Fire support and field works stay dropped in every versus room.

The kit: `fortify {side, piece, x, y}` / `unfortify {side, x, y}`, allowance as data `modes.flag.setup.kit` = `{hesco: 12, sandbag_post: 4, t_wall: 2}`. Raised at once (`addStructure`, progress ONE, owner = side), no builder, no price. Accepted only in set-up, inside own region, with allowance, not in a flag zone or under a unit, and passing a footprint-generalised `placementReason` (the seal keeps every flag reachable on foot). One `recomputeFields` per tick (~9-19 ms a call). Owned pieces are targets once seen; the dozer can `demolish`. `unfortify` refunds, set-up only.

Field works instead would cost ~4 agent-days plus a ruling: side-parameterised works (purse, offer, site table, owner from the command), a works budget in a goals-only runtime, `stepWorks` under `goalsOnly`, one builder per side (~3-4 works in 3:00), the ownership gate opened, the `fwLive` fold and snapshot rows, an aura fairness read, and amending CLAUDE.md. Defer (Q2).

Enforcement (sim only):
1. Clock: `Sim.setupUntil` = `setup.seconds x 20`; `ready` sets a bit in `readyMask`; both set -> bell 100 ticks later. Folded behind `setupLive`, snapshot rows; room pause pauses it.
2. Region clamp: each side's half-plane of the seat bisector minus half `setup.band_tiles` (8 / 12), computed in `@lions/data` with exact integers (doubled coordinates, squared comparisons). `buildMatchWorld` hands both masks to a setup-only `Sim.setSetupRegions` (throws after tick 0). `stepMovement`: before the bell a unit (ground or air) whose next tile is outside its mask does not advance; its order stands. Masks are static config outside `hash()`.
3. Weapons tight: before the bell `stepCombat` fires nothing (no shot, beam, demolish, charge); detection still runs.
4. Runtime: flag objectives do not step before the bell.
5. Net: `cleanCommand` carries the three verbs; `validateCommand` admits them only in a flag room with a set-up, for the seat's own side.
A sight-blocked half was rejected: fog is drawn by the renderer and stops nothing.

## 3. Map refit
v1: the five point-symmetric maps. tel_marum and beit_sahwan_outskirts are unlisted for flag until a separate fit.

Candidate windows (friendly end; final tiles from the fit, 3 tiles off the edge):
| map | candidate | own path | enemy path |
|---|---|---|---|
| wadi_tarfan | (4,0)-(2,2), mirror (41,41) | 12 | 66 |
| milh_flats | (2,43)-(0,41) | 12 | 70 |
| rujm_sawda | around (4,4) | 12 | 122 |
| wadi_tarfan_l | (16-18, 6-8) | 12 | 122 |
| milh_flats_l | (16-18, 83-85) | 12 | 122 |
| tel_marum | (12-14, 43) | 10-12 | 41-43 |
| beit_sahwan_outskirts | (0-2, 8-10) | 12 | 49 |

The line is the bisector with its band, never authored. Rules S1-S4 in `validate_versus_modes.mjs` and its test (which builds the world). `modes.flag.cap_minutes` 30, held equal to the `@lions/net` twin. Falsify: band 2 -> S3 red on wadi_tarfan; one flag moved a tile -> mirror check red.

## 4. Probe v2 (`pnpm versus:probe -- --mode=flag`)
Roles latched at tick 0 by placement order: DEFEND ~40% value (mortar, 2nd AT team, 3rd rifle squad, the Eitan, 2nd Lavi), RAID the rest, the dozer home. Set-up: one rifle squad in the flag zone (contest anchor); AT team and Lavi at radius 4 facing the enemy; mortar at radius 6 behind; kit template = hesco arc at radius 6 with a 2-tile gap, sandbag posts at radius 5 +-45 degrees, T-walls flanking the gap (refused pieces skipped in a fixed order); raiders stage at the point of own region nearest the enemy flag. Bell read two ways: Ready at 20 s, and no early Ready. After the bell: raiders attack-move on the enemy flag every 20 s; defenders re-take posts every 20 s; when `flags.mine` leaves `open`, every defender within 10 tiles attack-moves home.
Arms and bars as in the summary (G1-G7); the PR 1078 timing line re-based on the bell. Mutations: M5 kit aimed at the enemy -> 0 pieces; M6 clamp off -> unit outside region before the bell; M7 weapons tight off -> damage before the bell; M8 shipped flags -> G-ratio red; M1-M4 stay. Seeds = 1000 + 7919n; ranges above avoid every range used so far. Choice rule fixed before the read: the candidate whose smallest margin to a bar is largest.

## 5. Bot and HUD
HUD: DEFEND (mine) / RAID (theirs); `NetFlags` rows "Defend: open", "Raid: holding 12 of 45 s"; banner "Set-up 2:41 · weapons tight · hold behind the line" with Ready and "Enemy ready"; a "Contact" toast at the bell; dashed line, own-region tint and the "Holding at the line" chip, all removed at the bell; kit dock reusing works arm-and-click placement (tint from a pure read of `placementReason` + region; right-click lifts in set-up). All strings via `t()`; presentation only.
`observe.setup: { secondsLeft, line: {a, b}, kit: {hesco, sandbag_post, t_wall}, ready: {mine, theirs} } | null`; verbs `fortify {piece, x, y}`, `unfortify {x, y}`, `ready` in `mcp-tools` and the order desk. Prompt (`tools/src/net/win-rule.ts`): generalise the renumbering ("twelve lines"); line 6 the hold rule; line 8 defend; new line 9 set-up.

## 6. Interim
**Superseded by the lead's later ruling (recorded in the plan's R0.1): flag STAYS offered as it is until the new version replaces it.** Nothing is unlisted. The new data is staged (`flag_setup`, beside the shipped `flags`) so the live mode never reads it; the plan's R0.1 has the mechanism. (The original text proposed pulling flag from the lobby with `WIN_MODE_FAIR_MAPS.flag = []`; that was WP0, now dropped.)

## 7. Work packages (S <= 0.5 d, M 1-2 d), ~12-14 agent-days
| WP | size | content | gate |
|---|---|---|---|
| WP0 | — | DROPPED (lead's ruling, plan R0.1): flag stays offered until the new version replaces it; nothing is unlisted | — |
| WP1 | S-M | Schema: a top-level `flag_setup {setup {seconds, band_tiles, kit}, cap_minutes, hold_s 45}` STAGED beside the shipped `flags`, which are kept (the live mode never reads the new block); validator R1 and S1-S4 on the new block | old wadi_tarfan_l flags red on G-ratio |
| WP2 | M | Sim set-up: clock, `ready`, regions, clamp, weapons tight, `setupLive` fold, snapshot rows, `SETUP_WORLD_PIN` | M6, M7 red; determinism pins unmoved |
| WP3 | M | Kit commands, `ground_only`, `cleanCommand`/`validateCommand` | seal/region refusals; air tests red without `ground_only` |
| WP4 | S-M | Runtime wiring, objectives wait for the bell, 30-min cap twin, content digest, rejoin premise seed | rejoin mid-set-up replays to the same hash |
| WP5 | M | Probe v2 | self-check red under each mutation |
| WP6 | M (~0.5 d a map) | Refit the five maps; PR table to the lead BEFORE listing | all bars |
| WP7 | M | HUD and lobby (parallel to WP5-6) | jsdom tests, `validate:ui` |
| WP8 | S-M | Bot (parallel to WP5-6) | `win-rule` throws on prompt drift |
| WP9 | S | List the maps that passed (`FLAG_SETUP_MAPS`); CLAUDE.md and `sim-and-orders.md`; file the follow-up issue that folds `flag_setup` into `flags` and deletes the v1 branch | — |

## 8. Open questions for the lead
1. Set-up length and cap: B (3:00 with early Ready, 30-min flag match) or A (90 s inside the map caps)? Literal 30-min prep refused.
2. Fortify: the set-up kit now, field works in versus only by a later ruling?
3. Goal share: keep 70% for the fit; if unreachable, accept 60% with the contested-capture share printed, rather than a "wipe, then capture" rule?
4. Maps: v1 on the five point-symmetric maps; tel_marum and beit_sahwan_outskirts unlisted for flag until a separate fit?
