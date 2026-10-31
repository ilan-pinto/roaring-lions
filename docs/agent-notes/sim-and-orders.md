# Sim-side rules: garrisons, orders, production, wounds, economy

Moved verbatim from `CLAUDE.md` (origin/main `f946bb16`, 2026-10-25) when that file was slimmed to its rules.
The rules distilled from these passages stay in `CLAUDE.md`; this file keeps the measurements, history,
reasoning and superseded statements behind them, unedited. Nothing here has been pruned yet.

<!-- CLAUDE.md lines 301-321, section "Dev instruments" -->

- **Garrisons (GH-280, GH-34; lead rulings 2026-10-14).** A garrisoned unit fights with
  `garrison_cover` (structure JSON, default 3) against suppression and detection, not the tile's cover.
  Range, sight and the line of fire start at the window -- `eyePoint`, the footprint tile centre nearest
  the target -- while position stays the centroid (where it is drawn, where a near miss is measured to).
  `floors` (`data/structures.json`) lifts that eye one elevation level per floor above the first
  (`floors - 1`, `eyeLift`; a one-floor building adds nothing). **Not everything measures from the
  window:** tunnel and route spotting (`trailStrengthFor`, `markerSeeingRoute`, `seesTile`), the
  breach-target reach in `stepCombat` (`selectBreachTarget`'s `structDistSq`/`reachSq` read) and the
  ambush spring (`checkAmbushSpring`) still measure from the centroid at ground level, with no floor
  lift; and a garrisoned unit can still lay smoke, because `smoke` is an ability and not its weapon.
  `fires_from_building` is a weapon flag, default true; `validate_data` requires `false` on a mortar or
  rocket weapon of a unit that can garrison (`mortar_team` carries it; `mortar_crew` and `rocket_battery`
  have no `garrison` ability and carry no flag), and it is not required elsewhere
  (`tools/validate_garrison.mjs`, which also refuses a garrison stance on a
  unit without the `garrison` ability -- the runtime would silently skip it). `GARRISON_RANGE_BONUS`
  (`tuning.ts`, +1 tile) lengthens max and effective range from inside, not sight and not min range. A
  dead or removed occupant frees its slot; an overflow unit waits at the door, stopped, and fights.
  **The §5.7 urban target builds no structures, so `pnpm balance` is blind to all of this** --
  `tools/src/backtest/garrison-probes.ts` is the report-only instrument that can see it (the #280 raid
  and the garrisoned town; no passing band yet, L-4). Run
  `pnpm --filter @lions/tools exec tsx src/backtest/garrison-probes.ts`.

<!-- CLAUDE.md lines 339-367, section "Dev instruments" -->

- **A right-click on an identified enemy is an `attack` order, not an attack-move**
  (GH-420; `Command` `attack`, hashed `focusTarget`/`focusLost` columns). A slot
  fires on the focus whenever it is in range, in sight (or indirect) and can hurt
  it (`engageable` + `weaponHurts`); otherwise it picks as before. The unit closes
  to the effective range of ANY slot that can fire, holds across a half-tile band
  there (`FOCUS_REACH_SLACK`), and kneels if it `haltsToFire`. A target the side
  stops identifying is walked to at its last-seen tile; the order ends after
  `FOCUS_LOST_TICKS` (100) consecutive ticks below identified (re-identification
  resets the count), at once if there is no last-seen point, and when the target
  dies, garrisons, boards or goes underground. The unit is then an ARRIVED
  attack-mover that holds (`sweepOrder` 0), so `stepSweep`, the closing rule, does
  not sweep it on. Any other order naming it, or a rout, releases the focus; a
  refused `attack` changes nothing. Not every enemy click is the order: Shift
  keeps the appended attack-move, armed Move moves, and in a mixed selection the
  units that cannot hurt or aim at it attack-move to its tile -- a loitering
  munition always, since `canFocus` refuses kamikaze shooters (R-25:
  `stepKamikaze` steers them). If someone can focus it and nobody can hurt it, the
  click is refused (`intent.cantPenetrate`, the deny cue). The ROE tier is read at
  the target. The order picks the enemy by `Renderer.unitAtScreen`'s body segment
  at `ORDER_PICK_RADIUS_TILES` (0.5, R-23); the 1.2-tile default is the left-click's,
  so ground a tile from an enemy is still an attack-move. A picked enemy does not
  switch off PA-14's wall rule (R-24): only a focus beats the building. A
  garrisoned unit keeps its post on an enemy click (R-20), but a click that
  resolves to a building or tunnel tile, a wall pixel included, can still send it
  an attack-move that walks it out (R-21). `__lions.cursorKey()` reads `attack-*`
  when some selected unit can hurt the target, `advance-*` when nobody can focus
  it, and `blocked` when nobody can penetrate it. The sim's public `canFocus` and
  `focusHurts` are the app's only filter; do not re-derive "can it hurt that" in
  `intents.ts`.

<!-- CLAUDE.md lines 480-505, section "Dev instruments" -->

- **The brigade account is a second save, not a ledger key.** `lions.brigade.account`
  (`packages/app/src/brigade-account.ts`, the only reader and writer) holds credits and
  what they bought, and it SURVIVES `?fresh` on purpose (spec 2026-09-15 §4.1): a second
  campaign starts with the brigade you built. Reset it from the brigade screen, twice.
  A victory pays `creditsFor` (`packages/sim/src/credits.ts`, integer-only, never called
  by the sim) only for improvement over what that mission paid before IN THIS CAMPAIGN;
  since GH-330 (PR #378) the improvement record is per campaign, cleared by "New
  campaign", so a fresh campaign pays again (the whole catalogue is reachable by play in
  ~12 campaigns), while a replay inside one campaign still pays only improvement. Only an
  OPEN mission pays, so booting a locked mission by URL earns nothing. `pnpm playtest`
  pins the optimal ladder's total (`LADDER_CREDITS`) beside the star gates, and checks
  that campaign 2 pays it again. The tutorial
  pays nothing: it produces no ledger keys, so `main.ts` gates the payout on
  `mission.ledger.produces` rather than a name list. Buying an unlock deducts and records
  `unlocks`; it writes no grant. A KDF unit's `upgrades` tracks (spec §4.3) are applied by
  `@lions/data`'s `applyUpgrades` before `addUnitType` — in the app, the playtest harness and
  the balance backtest alike — so the sim never learns a tier exists. `pnpm playtest` replays
  every plain victory at max tier and requires the outcome class to hold; `pnpm balance` and
  `validate_balance.py --max-tier` run the §5.7 targets and the cost curve at max tier too.
- Two ROE facts a visual check needs: **three maps carry `m` civic-hall tiles (`hall`, the O10 replacement; the type was `mosque` until 2026-09-06) — `beit_sahwan_outskirts` (9),
  `marj_perimeter` (4) and `wadi_halam_basin` (9), counted 2026-09-03 from the
  map rows; this line said "only `wadi_halam_basin`" until then** — so the
  protected-target X (keyed on the STRUCTURE's `roe_penalty`, `input/intents.ts`
  `isProtected`) is reachable on those three and nowhere else unless a mission
  declares `roe.flagged_zones` or `&roe` supplies one. Tel Marum's town buildings are `#`
  (`concrete`, penalty 3), so they read as the *costly* tier, not protected.

<!-- CLAUDE.md lines 598-600, section "Dev instruments" -->

- `pnpm balance` runs the §5.7 backtest; `tools/src/backtest/urban-only.ts` is the fast urban-ratio calibration loop.
- The determinism golden hash lives in `packages/sim/src/determinism.test.ts`. It changes only when sim code or tuning changes deliberately — update it in the same commit and say why.
- Combat tuning lives in `packages/sim/src/tuning.ts`. §5.7 targets outrank §5 formula text.

<!-- CLAUDE.md lines 627-631, section "Dev instruments" -->

- **Production is a serial line per camp, keyed by side (F4, GH-183; closes GH-136; G3 Q3).** A `camp` structure (and, for side 0 only, `player_start` when the mission has none) is one `ProductionLine` (`packages/sim/src/production.ts`): one item in progress for its `build_time_s`, the rest waiting (at most `MAX_LINE_QUEUE` 16, at most `MAX_PRODUCTION_LINES` 4 lines a side), the price paid at queue time and refunded in full on a cancel. The clock pauses while a living, surface, ground enemy stands within `CONTEST_RADIUS_SQ` of the exit (aircraft do not contest). A rally point is a per-line no-sweep `attackMove` (D5). A dead camp keeps its line's index and loses its queue. `requestBuild`/`canBuild`/`cancelBuild`/`setRally`/`clearRally` take `(…, line?, side = 0)` and travel as `Command`s (`build.line?`, `cancelBuild`, `setRally`, `clearRally`); `applyQueued` asks `isHumanHeld(c.side)` and passes the side (N3, GH-741; it skipped `side !== 0` before), and `validateCommand` admits `build`/`cancelBuild`/`setRally`/`clearRally` in an economy room (KDF v Sarim; each seat its own side, a forged side dropped) while fire support and field works stay dropped in every versus room (they act for side 0). A versus economy room boots a `MissionRuntime` from `data/versus/<map>.json` through `buildMatchWorld`, ticked only by `matchTick`; a runtime with no objectives never ends by itself. `built` carries `side` and the app filters to the viewer's side (`isOwnSide`; the announcer takes viewer 0, the tutorial `!== 0`). An enemy side buys through `enemy.production` (`spendDown`, D8, the same `requestBuild(unit, line, 1)`), but **no shipped mission gives side 1 a camp (D7), and `validate:data` refuses `enemy.production` on one while D7 stands** (the shipped `unitInfo` answers KDF only); `pnpm --filter @lions/tools enemy-production:probe` is the report-only witness. `economyHash` folds every line, so the four economy/digest pins moved once (`e0c39d39`); the sim pins did not. Numbers and the D-list: `docs/campaign/economy/production-numbers.md`.
- **Which `pnpm versus:probe` invocation is the bar.** A plain `pnpm versus:probe` runs 48 seeds on all four `VERSUS_FAIR_MAPS` in all three pairings, so it prints cells nobody is offered (Beit and Milh faction cells; only the mirror is offered there) and 48-seed readings inside sampling noise (Tel Marum Sarim-friendly read KDF 68.8% at 48 seeds and 55.2% at 96, the same seeds extended). The bar is 96 seeds, on offered cells only: the mirror on the four fair maps (`--maps=beit_sahwan_outskirts,tel_marum,wadi_tarfan,milh_flats --seeds=96`), and KDF v Sarim on `FACTION_MATCHUP_MAPS` (Tel Marum, Wadi Tarfan) as placed force, `--economy --seeds=96` and `--tunnels --seeds=96` cell 3. An OUTSIDE on Beit or Milh KDF v Sarim, or on any cell at 48 seeds alone, is not a failure of the bar. The 26 Oct reading on main (GH-816's rebalance) matches at 96 seeds cell for cell.
- **Wounds and rescue (GH-707).** A squad with `hull.wounds` sheds a one-man `wounded` entity at each figure-share crossing; he bleeds, crawls to cover, and is treated, carried (`can_carry`) and admitted at an `aid` structure, then rejoins his squad weaker (`scars`). 21 shipped unit types carry `hull.wounds` (civilians; Sarim `atgm_cell`, `charge_squad`, `digger_crew`, `manpad_team`, `militia_cell`, `mortar_crew`, `recoilless_team`, `rpg_team`, `sarim_rifles`; KDF `at_nlos_team`, `at_team`, `breach_team`, `demo_squad`, `inf_grenadier`, `inf_medic_squad`, `inf_squad`, `mortar_team`, `recon_zikit`, `sniper_team`, `yahalom_squad`) and 27 shipped missions name them (every campaign town; no `data/versus` file does, but the KDF and Sarim doctrines field wound-carrying infantry). The medic call (`rescue` ability) is reachable in shipped play through `inf_medic_squad` (the Nemala medic team), loaned in every campaign mission's starting force but the tutorial (PR 905 / PR 908; before them it was placed once, in `beit_sahwan_breach`); `veh_ambulance` and `air_medevac_heli` are placed nowhere. Every wound column -- and `removed`, which evacuation and admission now write -- folds into `hash()` only once a wound-related type is registered (`woundLive`, the `airLive`/`fwLive` deferred fold), so no pin moved; `WOUNDED_WORLD_PIN` in `determinism.test.ts` is the replay that sees the block. Rules: `sim.ts` `stepWounded`/`stepMedics`/`stepAidPosts` (and `applyDamage`'s share crossing), pure helpers in `wounds.ts`, numbers in `tuning.ts`. Conduct: `mission.ts` `stepRoe` pays +2 per enemy and +3 per civilian wounded the player admits or evacuates (once per man, +10 a mission, never past 100; `roeGain` event, folded into `digest()` only when non-zero), charges 3 for player fire killing a down enemy (not a bleed-out), and a downed civilian's 8 at his death, never the hit. A rescued man is not lost (`isLost`); a `remove` trigger's body still is. A map marker `wounded_evac` is side 0's evac point. **Versus (30 Oct 2026, the lead):** the Nemala medic team was opened to the KDF versus menu and HELD out again the same day (PR 907: the probe's ruled buy rule delivers 0.0 medics a game, and `--rescue-buy=opening` leaves 60/40 on Tel Marum Sarim friendly), so all three rescue units are in `VERSUS_HELD_UNITS`; the rescue tests, `pnpm versus:probe -- --rescue-buy=...` and the witness's rescue world put the medic in a room in memory (`medic-room.test-helper.ts`). What stays: in a versus economy room the camp is the drop-off: `standMapStructures(sim, map, true)` gives the `camp` type its `versus_aid` block as `aid`, and `Sim.aidSideOf` lets a NEUTRAL aid structure work for the side it produces for (no owner, so no field-works fold and not a target). A mission's camp admits nobody. In a room `rescue` targets only the seat's own side's wounded (`validateCommand`), and a rescue unit keeps no side alive (`armedStanding`). Numbers: `docs/campaign/economy/production-numbers.md` section 6. Spec `docs/superpowers/specs/2026-10-22-wounded-rescue-design.md` (§0 rulings win), plan `docs/superpowers/plans/2026-10-22-wounded-rescue.md`.

---

- **Vehicle health (GH-560; the lead's four rulings, 27 Oct, GH-858 comments).** HP alone ends a vehicle. A penetration of a hard hull costs `penetrationHpCost(maxHp, damage, shift)` (`packages/sim/src/vehicle-health.ts`): `max(damage, floor(maxHp x PEN_HP_FLOOR) x (PEN_HP_OVERMATCH_DIV + shift) / PEN_HP_OVERMATCH_DIV x min(damage, R) / R)`, `PEN_HP_FLOOR` 0.34 (22282), `PEN_HP_OVERMATCH_DIV` 60, `shift` the 0-30 overmatch shift (`overmatchShift`), `R` = `PEN_HP_REF_DAMAGE` 85.0 (5570560; GH-868). So 3 hits, or 2 at shift 29 or 30 (0.51 at 30; two hits pass the bar from shift 29), for a round of 85 damage or more. **Below R the floor is scaled by `damage / R`** (integer, `((floor * damage) / R) | 0`, exact in a double): a flat 34% made a technical's DShK (damage 40) kill a Peten in 3 hits (199/200 in 8.3 s against main's 110/200 in 13.7 s) and kill a Remetz in 2.7 s (main 9.6 s). At R = 85 those read 173/200 in 18.9 s and 6.5 s, and every row the design table pins (ZU-23 v Peten = 3 hits, 30 mm, chain gun, the 380 loiter warhead) is unchanged. R = 85 is the largest R that leaves them alone: R = 100 moves a versus cell to 60.4%, R = 125 the ZU-23 to 4 hits. A penetrating weapon of damage 0 would cost 0; none ships (`spg_cluster`'s submunition carrier bursts before the penetration path). The witness is `sf2` in `vehicle-health-probe.ts` and its two gates in `vehicle-health-probe.test.ts`: nothing else, not balance, playtest, the versus arms or a pin, sees this change (measured byte-identical). The MANPAD half of GH-868 (one MANPAD cost 300 of a Peten's 640 and fires one missile per window: 0/200 against main's 43/200) was NOT a floor effect: the lead's 28 Oct ruling raised `manpad_team`'s warhead to 420 (data only; two hits kill a Peten or a Yanshuf; the same Peten hover reads 49/200 destroyed, 125/200 destroyed-or-grounded). A hit that rolls a mobility kill lands the aircraft and the air-only MANPAD cannot engage it, so read `destroyed` together with `destroyed-or-grounded` and `intact`: `pnpm vehicle-health:probe -- --only=s6`, gated by `vehicle-health-probe.test.ts`. Any unit-JSON edit re-rolls the sign of `snapshot-rejoin.test.ts`'s mirror digest (it folds in `shippedContentDigest()`), so its premise seed was re-picked. It applies on EVERY penetration path: the gun/missile tail of `resolveHit`, the kamikaze terminal strike (`stepKamikaze`) and `beamStrike`. Leaving the loiter drone at its weapon damage (17%) was the first draft and was a silent nerf (1-3 drones killed a Lavi 0 of 200): ruling S-1. `rollComponent` keeps its ONE draw on the shooter's stream (so every later draw is where it was) over weights that total `92 - shift`; `'catastrophic'` and `COMP_CATASTROPHIC` are deleted. **Never remove the draw**: it would shift every stream. A hard hull is any unit whose front plate is 30 mm or more (16 at the base commit; `tools/src/vehicle_health_bounds.test.ts` census). Ruling 3 has two side effects, both pinned in `vehicle-health.test.ts`: a bounce that `threatens` (`splash > 0 || penetration >= armorSide`) writes `lastDamagedTick`, restarting the 10 s regen delay, and `stepFieldFix` (a stuck hull's crew fix) and the workshop's component repair read the same field, so a threatening bounce postpones both. A round that could never hurt (a rifle on an MBT) does not. The cannot-penetrate fallback is kept (ruling 4). `hull.hp` is bounded by `"maximum": 32767` in `unit.schema.json` (`fx.from` wraps above it; `vehicle_health_bounds.test.ts` also asserts `hp * 65536 < 2^31` at base and top tier). No new column, no new per-tick work. Two public reads serve the card (GH-560 follow-ups, card/DOM only, nothing hashed): `Sim.penetrationsToKill(shooter, target, weaponId?)` is `ceil(hp / penetrationHpCost(...))` over the plate `presentedArmor` shows that shooter, null for a soft or swarm target or a weapon `weaponHurts` refuses (so it tracks `focusHurts`/`canFocus`); the fire panel prints the fewest across the selection and the Engaging line prints the unit's own (`hud.fire.hitsToKill`, "~3 penetrating hits to kill"). `Sim.ticksSinceDamaged(id)` is the age of the hit that zeroes `fieldFixTicks`; the card adds "repair reset — under fire" beside "Repairing m:ss" for `REPAIR_RESET_CUE_TICKS` (40, `ui/combat-state.ts`) after it. The hit count follows the face shown NOW, so it moves as the hull turns (Spike on a Lavi: 3 on the front plate, 2 on the side or rear).
  - **Pins that moved** (each in its own commit, "Was <n>."): relief `1070599391` -> `1483138559` (both sites in `determinism.test.ts`); the ground-carrier jeep digest in `carriers.test.ts` `1417887594` -> `224131754` (S-1: the scenario's munition penetrates the tank); arena rush-over-passive seed `48514` -> `56433` (GH-816's method, seeds 0-11); the air-assault LANDING witness re-pointed to arm E (ZU-23) seed 0; the versus-probe table witness re-read (room 5420 -> 4440 ticks). Flat, orders, `ECONOMY_PIN`, both `RUNTIME_DIGEST_PIN`, `WOUNDED_WORLD_PIN`, fire-support `HASH` and the snapshot format pin did not move. The versus re-price moved the Beit seat table entry, the Beit mirror hashes (`versus-force` / `versus-breach` / `match-world`), `VERSUS_ECONOMY_PINS` tel_marum and the GH-681 wadi_tarfan route capacities. `LADDER_CREDITS` 5961 and `ROSTER_MAX` 30 are unmoved.
  - **Measured (200 seeds, `pnpm vehicle-health:probe`).** The Lavi duel: 99% of kills were catastrophic rolls and 73% of deaths came at a bar of 0.7 or more; now the luck share is 0%, the median bar at death is 0.07 and the time to kill is 17.5 s -> 37.5 s. Spike x3 v Lavi: median bar at death 0.87 -> 0.36, ttk 2.6 s -> 42.6 s. The probe's "luck" column is an upper bound (a destroyed hard hull whose bar was at least 0.5 the tick before, with a penetrating impact on the fatal tick): a salvo or a heavy warhead can read non-zero without a roll; the gate is the Lavi duel only. Vehicle deaths are no longer a function of one roll, so a lone loitering munition or MANPAD cannot kill a Lavi or a Yanshuf (one penetration is 38-39% of the bar). Target choice still reads P(pen), never HP: there is no "finish the damaged hull" preference, the obvious next doctrine lever.
  - **A loitering munition delivers its warhead once (GH-867).** `stepKamikaze`'s terminal strike is the only delivery: `stepCombat` skips every `isKamikaze` unit (clearing `engaging` and `curStructure`, leaving `curTarget` to `stepKamikaze`). Before, a drone whose weapon range exceeds `KAMIKAZE_STRIKE_SQ` (`loiter_drone`: 1.3 tiles against 1.22) also fired the warhead as an ordinary round, was destroyed by the strike, and the round landed two ticks later from a dead shooter: two penetrations from one munition, which under the GH-560 floor was the ONLY way a lone drone killed a hard hull. It also shelled a building holding an identified enemy for as long as it hovered there. A fixture whose range is under 1.22 tiles never leaked, so a test of this needs the shipped range. Witness: `packages/sim/src/kamikaze-single-warhead.test.ts`.
  - **Standoff (Sarim)** is gated in its SECTION form (GH-865 ruling 2, `standoff()` in `tools/src/backtest/targets.ts`, a row in both `pnpm balance` tables): three `atgm_cell`s in cover 2 at 8.5 tiles v an APS Lavi, exchange > 0 AND destroyed-or-disabled >= 60%, 200 seeds. Read base +271 / 74.5%, max tier +137 / 68.5%. The single-cell form is retired as a target (a Kornet costs 39% of the bar, so three penetrations are needed and the Trophy stops each: 0.1% destroyed over 1,000 seeds, 3.5% with the Trophy off). The probe's one-, two- and three-cell open-ground rows stay report-only. `tools/src/backtest/standoff-gate.test.ts` runs the red arms (no cover, 2 cells, cover 1 at max tier, Trophy pk 0.9 at max tier) and a parity check against the probe row. The gate and `apsIntercept` now bound the Trophy's `base_pk` from both sides. No unit data, tuning or sim change, so no pin moved. Measurement: `docs/superpowers/specs/2026-10-29-standoff-doctrine.md`. Original ruling-4 specs `docs/superpowers/specs/2026-10-27-vehicle-health-design.md`, plan `docs/superpowers/plans/2026-10-28-vehicle-health.md`.


---

## Formations (GH-859 P1a)

As built on `feat/formations-p1a` (plan `docs/superpowers/plans/2026-10-28-formations-p1a.md`, design
`docs/superpowers/specs/2026-10-28-combat-formations-design.md`). Three shipped formations in
`data/formations/` (`column`, `attack`, `ambush`), the Attack and Column ones templates of ranks and files, the
Ambush one a ring. P1a places units and sets a rest facing and an arrival stance; it has no march, dress, pace or
calls (those are P1b, in the "Formations P1b" section below). The sources of every number below are the ledger `_coord/formations-p1a-progress.md`, the S4
diagnosis `_coord/formations-p1a/t6/s4-diagnosis.md` and its `t6/*.txt` tables.

- **The order.** `move` and `attackMove` carry an optional `formation` (a string of at most 32 characters,
  `^[a-z][a-z0-9_]{0,31}$`, mirrored in the schema and pinned by `tools/src/formation-id-pattern.test.ts`).
  `applyMove` reads it only through `templateFor`. Everything else in the table below is a plain order, exactly
  today's code path.
- **The state.** One group table (`fg*` columns, `fmGroup`, `fmArrive`, `restFacing`), `MAX_FORMATION_GROUPS_PER_SIDE`
  16, `FORMATION_ROWS` 32 (side `s` owns rows `s * 16 ..`). Every column folds into `hash()` and the snapshot only
  once `fmLive` is set, by the first template order (the `airLive`/`woundLive` pattern). Registering a formation
  does not set it. Pins: `FORMATION_WORLD_PIN` is a new replay (2129900778 at P1a's writing, re-pinned once by the
  spring-before-combat fix; P1b moved it five times, below); the snapshot format pin moved 2452666963 -> 3512584427 with the new rows.
- **The exit funnel.** `fmForget(id)` is the ONE way out of a group: it clears `restFacing` and `fmArrive`, drops
  membership, and frees the row (every column to zero) when the last member leaves. Every caller is
  `if (this.fmLive) this.fmForget(..)`. Call sites, by symbol in `sim.ts`:
  - `applyCommands`' per-id pre-pass: every id of every command kind except `attack` and `rescue`. It also clears
    an ambush stance the formation gave (`stance` 1 on a group member), so a member ordered away does not stay armed
    to spring alone; a `setStance` of its own, later in the same command, is honoured;
  - the `attack` and `rescue` branches, for the ids they ACCEPT (a refused order changes nothing, GH-420);
  - `destroy` (death), `removeFromPlay`, `stepUpkeep`'s rout, `seat` (boarding), `enterStructure` (garrisoning),
    `putInTunnel` (below ground);
  - `downInPlace`, `evacuateAboard`, `admitAboard`: defensive. With shipped content they are unreachable (a
    civilian is class none, `seat` is the only writer of `carriedBy` and already forgets), so a test cannot fail
    them and they are not listed as tested exits. Each carries a comment saying so.
  - The writes were grepped: `carriedBy[..] = car` only in `seat`, `garrisonedIn[..] = s` only in
    `enterStructure`, `tunnelIn[..] = route` only in `putInTunnel`, `routed[..] = 1` only at the one rout site.
    A new way to take a unit out of play must call `fmForget`, or its row never frees.
- **The degraded table.** `fmJoin` takes the lowest free row of the side. With all 16 taken the order is
  DEGRADED, never refused: members still get the slots, the rest facing and the arrival stance, but no group, so
  there is no shared spring (an ambush ring then springs member by member). The spec's card line for it is
  "In formation (no march)". Order-time only, deterministic.
- **The plain-order fallbacks** (the template branch is not entered, nothing is written, today's slots are used):
  - no `formation`, an id this world does not register, or `exact: true` (the sim shepherding civilians);
  - a verb mismatch (an `attackMove` naming a `move` formation, or the reverse; `either` accepts both);
  - fewer placeable members than the formation's `min_members` (placeable = alive, not routed, not carried, not
    landing, class not none, side 0 or 1). One unit, or a selection whose rest is aboard, is a plain order;
  - and inside a template order, an id with no slot (class none, side 2, a passenger) simply ignores it.
  The app mirrors the too-few case: it keeps the formation's own verb (Attack with one unit sends a plain
  `attackMove`) and plays the deny cue with a feed line.
- **Why the faction check is versus-only.** The sim does not check factions: it knows sides, not factions, and
  the three shipped files all list `["kdf", "sarim"]`. The faction rule is `validateCommand`'s, through
  `seatWorldFor(...).formationAllowed` (`packages/app/src/net/frame-step.ts`, `formationFielded` is exported so
  the clause is testable with a faction-gated table). It runs on a room's frame path, on both machines, so a
  forged id vanishes before the queue. Single-player never passes through it (and is always the KDF seat). A
  faction-gated formation (P2/P3) needs sim side-to-faction data first.
- **Rest facing.** `restFacing` is where a hull comes to rest (`stepFormationFacing`, right after `stepCombat`):
  a unit that is stopped, alive, has no target, no structure target, a working drive, and is not garrisoned,
  carried or below ground turns toward it. A target always wins, so does anything that holds the hull. Inward and
  outward are measured from the member's own track anchor.
- **The spring.** An ambush ring springs as one (D8). `fmPend` (a member springs, or is fired on) marks the group
  and pushes `formationSprung`; `stepFormationContact` runs BEFORE `stepCombat` and clears the ring's stances, so
  the ring opens fire one tick after it was found (an in-tick test pins that). If every member is ordered away
  between the mark and the spring, the row frees with the event already pushed and no spring follows (accepted).
  Aircraft never take a stance; medics in an Ambush order take none; only ring-element members do.
- **Placement.** `formation-template.ts` (`assignTemplate`, `templateOffsets`) is pure and shared with the HUD
  schematic. `FORMATION_WALK_CAP` 24; a 24-hull Column is 36 deep, so a `files` element spills its leftover hulls
  BEHIND its own rear row (S3 ruling), on a lazily built full-map walk; `overflow` is empty for every shipped
  (formation, mix, N). `tools/src/formations_place.test.ts` is the gate (N = 2..24, every class mix, no tile
  twice, vehicle spacing outside the ring).

### Versus: formations are OFF (lead's ruling, 29 Oct, GH-859; still off after P1b, S4 failed)

Formations ship in single player. In a versus room they are off. The mechanism is ONE predicate,
`packages/app/src/net/versus-formations.ts`: `VERSUS_FORMATIONS_OPEN = false` and `formationsOpenIn(mode, versusOpen)`
(a versus room follows the constant; single-player and the sandbox room are open). Three consumers:
- the SENDER strip, `roomOrderSink` (`room-pause.ts`, `mode` a required fourth argument so a missed caller fails
  `tsc`): a `move` or `attackMove` goes out through `withoutFormation`, a new object with the key deleted, so a
  plain order is delivered, never a refusal (the pause behaviour is unchanged);
- the RECEIVER gate, `seatWorldFor(...).formationAllowed`, false in a versus room, so a forged or stale client's
  formation order drops on both machines (the protocol still carries the field);
- the HUD row: drawn, every button inert, reason `hud.formation.inert.versus` ("Formations are not in versus rooms
  yet"), which outranks `needsMin` and `ambushNoGround`; R/T/Y arm nothing.

The sim still registers the shipped formations in every room (`match-world.ts`) and the content digest still folds
them (as an ARRAY in `formations` order, so the digest covers registration order). The no-formation versus probe is
byte-identical to baseline (Beit mirror, `kdf/kdf`, 96 seeds: `47 49 0`, `96/0/0/0`, 2.9 min, east 51%).

**To open versus:** P1b's S4 failed ("Formations P1b" below), so this has not happened and what remains is the march (a frame mirrored between the ends, an engine change). Set `VERSUS_FORMATIONS_OPEN = true` only after an S4 read passes. These closed-gate tests
go red, and each is re-aimed to the open path rather than deleted (the open-path twins already exist, driven by
the injectable `versusOpen` argument): `versus-formations.test.ts` ("the gate ships closed", and the predicate
table); `room-pause.test.ts` W1 (three cases: the strip bites, the caller's object is not mutated, a paused
room); `frame-step.test.ts` W3 (no formation for any shipped id, either seat); `tools/src/net/two-client.test.ts`
"GATE CLOSED (the shipped guard)"; and the first two cases of `tools/src/net/mcp-tools.test.ts`' "order: the
formation field" (a Column move and an Attack attackMove refused as invalid in `twoSeats`). Task 6V's mutation
M-6Vd (the constant set to true) turned 6 red at once: the gate pin, the predicate, W1 twice, W3 and two-client
GATE CLOSED. `formation-model.test.ts`' "formationRow: versus rooms" passes `formationsOpen: false` itself and
does not move. Nothing else changes: no pin, no digest.

### Measured at Task 6 (head `318148e2`, report-only except S4; outputs `_coord/formations-p1a/t6/`)

- **6.1 byte identity.** With the formations registered and none named, `pnpm balance`, `pnpm playtest` and the
  four versus arms (mirror, placed, economy, tunnels, 96 seeds) normalise to the baseline exactly. The literal
  "absent formation means column" mutation (M-4a) CANNOT move the versus probe, because the probe sends
  attack-moves and Column is a `move` formation; the registered-twin hash test in `formation-group.test.ts` and
  the "move naming an attackMove formation" test catch it. The verb-matched variant does move the probe (Beit
  mirror 12 seeds 9/3/0 -> 6/5/1).
- **S2 PASSED.** The urban Attack formation against the plain arm: 0 of 240 seeds read differently, both tiers.
  Base 1:1 = 0, 2:1 = 30, 3:1 = 100, 4:1 = 100 (plain identical); max tier 0/42/100/100 (plain identical); 15.0
  attackers per run grouped. Trajectories are tick-for-tick identical; only the hash differs (group state), so
  this arm cannot show anything the group changes beyond the infantry rank giving the legacy line's goals.
- **S3 (Ambush, report-only; 60 seeds, 3 geometries; arms A group spring, B per-unit stance, C travel facing).**
  - Fire within 1 s of the ring's first shot / of members with a target in reach: head A 75.0% / 100%, B 16.7% /
    22.2%, C 16.7% / 22.2%; cross A 100% / 100%, B 16.7%, C 16.7%; through A 89.2% / 100% (all alive within 1 s in
    21 of 60), B 25.0% / 33.3%, C 25.0% / 33.3%.
  - Friendly splash: head 0.0 all arms; cross A 1.4 hp per game (5 of 60 games, 0.1% of the ring's damage), B and C
    0; through 0.0 all arms.
  - First-hit arc on the ring's Lavi (front/side/rear): head A 10/4/46, B 2/2/58, C 60/0/0; cross A 60/0/0, B
    0/27/43, C 0/60/0; through A 1/7/42, B 30/15/49, C 59/32/3.
  - Penetrating hits on the Lavi (A/B/C): head 2/6/0, cross 0/111/0, through 2/2/0.
  - Ring win/column win/open: head A 30/0/30 B 8/0/52 C 9/0/51; cross A 2/0/58 B 0/0/60 C 0/0/60; through A
    59/0/1 B 27/0/33 C 29/0/31.
  Instrument: `pnpm formations:probe` (`tools/src/backtest/formation-probes.ts`).
- **S4 TRIPPED.** `pnpm versus:probe -- --formation=attack [--formation-end=friendly|hostile]`, 96 seeds per cell
  (SE about 5.1 pp). (b) both ends in Attack outside 60/40: placed wadi_tarfan, Sarim friendly: Sarim 74.0%
  (base 59.4%); placed wadi_tarfan, KDF friendly: Sarim 60.4% (base 53.1%, one game over); economy wadi_tarfan,
  Sarim friendly: Sarim 74.0% (base level 48/48); tunnels cell 3, tel_marum, KDF friendly: KDF 74.0% (base KDF 49
  / Sarim 47). The four mirror cells stayed inside (max 56.2%). (c) the formation end above 65%: Beit mirror
  friendly-only 69.8% (base 49.0%; hostile-only 39.6%); placed wadi_tarfan Sarim friendly, friendly-only 69.8%;
  tunnels cell 3 tel_marum KDF friendly, friendly-only 72.9%.

### What S4 meant (the diagnosis; P1b's inputs)

- **Mechanism: slot geometry only.** Rest facing does nothing (`arrival.face: none` replays game for game), and no
  drill acts on Attack in P1a.
- **wadi_tarfan is a real, stable shift to Sarim, not noise.** Repeated on fresh seeds: placed Sarim friendly 59.4 /
  49.0 / 57.3 (base, three seed sets) against 74.0 / 69.8 / 68.8 (Attack); the 288-seed mean 55.2 -> 70.9 (+15.6);
  tunnels cell 3 47.4 -> 70.3 over 192 seeds. Paired flips base -> Attack: 21 to Sarim, 7 to KDF (sign test p
  about 0.01). Most of it is Sarim's own layout: KDF-side changes do not move the Sarim-friendly cell (68.8 to
  77.1 across five variants), Sarim-side ones do. The Namers die sooner and trade worse (Namer kills of Kornet
  teams 1.86 -> 0.69 per game, first Namer death 39.7 s -> 32.8 s); the Lavi exchange barely moves.
- **Beit mirror is a knife-edge, not strength.** One-end arms swing 20 to 40 pp on small layout details in either
  direction, and a near-legacy "control" template spreads at least as wide (sd 10.2 against 8.1 for shipped
  Attack over the 16 one-end readings; mean +4.4 pp shipped, -0.2 pp control). The shipped Attack has a modest real
  edge of about +3 to +4 pp. Mirror games are short (2.4 to 3.5 min) and decided by the Lavi tank duel.
- **The bar is ill-conditioned near itself.** Baseline placed wadi_tarfan Sarim friendly reads 59.4 / 49.0 / 57.3
  on three seed sets (288-seed mean 55.2), so a 96-seed read lands above 60% about 15% of the time with no change.
  Baseline tunnels cell 2 on tel_marum is already outside (67.7).

**P1b items, each with its evidence:**
1. The Sarim gun-truck line width: the 6 ZU-23 trucks as one 14-tile-wide rank on the click, where the legacy grid
   had two ranks of three. Trucks 3 wide recovers about half of the wadi_tarfan shift (placed, Sarim friendly: 66.7
   against 74.0 shipped and 59.4 base).
2. The 13-tile KDF aircraft standoff: worth 9 to 10 pp in either direction (placed wadi_tarfan KDF friendly 39.6 ->
   49.0 with the aircraft in the hull rank; tunnels cell 3 KDF-only 72.9 -> 62.5).
3. S4 must be read PER CELL against its own no-formation baseline at 192 or more seeds, with a paired sign test on
   the flips, and any cell within 5 pp of the bar re-run on a second seed set before it can trip (96-seed cells
   sit near 60/40 with no change at all; SE about 5 pp).
4. Do NOT put hulls behind the infantry: measured 90.6% Sarim on placed wadi_tarfan SK (78.1% on KS).
5. Do NOT widen the 60/40 or 65% caps: clearing the shipped Attack would take about 75/25 and 73%.

Rejected options on the numbers: hulls second (item 4); foot-only formations (re-deals the trips onto tel_marum:
P-tm-KS Sarim 76.0%); a data-only template tune (still fails 3 cells: P-wt-SK 62.5, E-wt-SK 60.4, T3-tm-KS 62.5).

**Open findings carried to P1b/P2:**
- A 24-tank Column is 36 deep and spills past the 24 cap; ruled (S3) to spill behind the rear row, which holds
  spacing but makes a very long column.
- Ambush with many hulls puts hulls on adjacent ring tiles (lateral 1). The D7 friendly-damage fallback (U and L
  shapes) is P2; the Task 6 splash reading (0.0 hp, 1.4 hp in 5 of 60 cross games) says it is not needed yet.
- The Task 6 disclosed survivor, forcing the urban arm's grouped-attacker counter to 15, was not caught by a unit
  test. CLOSED in `b4577b5d`: the counter is read per ratio against the literals 6, 12, 18, 24 (both mutations
  red). Not open; recorded because the shape (a pinned mean over a forced constant) repeats.

### The UI as built (Task 7 and 8; the one Metal browser check)

- **Surface.** A formation row above the order row for a selection of two or more free own units (tag
  "Formation", Column R, Attack T, Ambush Y, rebindable, `data-family` manoeuvre/offensive/control), a tooltip
  per button with an SVG schematic from the sim's own `templateOffsets` and a legend with counts, an armed state
  (`input/formation-arming.ts`: click spends it, right-click and Escape disarm, arming another order disarms it,
  the minimap click spends it), three cursors, a card line ("In attack formation", "Ambush set - springs
  together", "Ring radius N"), a chip status, and the `alert.ambushSprung` feed line (own side only, one line per
  tick). The class a unit has is `sim.unitTypes[idx].fmClass`; "set" is `ambushRadiusSqOf(id) > 0`; sprung is the
  number 4, copied because `FM_SPRUNG` is not exported (a test reads the sim's 4 and the card together).
- **Browser check** (one full walk plus three targeted re-runs of steps 5 to 8; ANGLE Metal, Apple M3 Pro, port
  5183, music off, `?sandbox=beit_sahwan_outskirts`, 14 mixed units). Passed: clean boot (0 console errors); the
  row, tooltips for all three, arming (T arms Attack, Esc disarms without opening pause, R then T leaves only
  Attack armed, right-click disarms keeping the selection); an Attack click queues exactly one `attackMove` with
  `formation:"attack"` and all 14 join a group (drone and heli stand off behind); Ambush rings the spot, faces
  inward, a militia cell inside the ring springs it (card "Ambush sprung", one feed line) and one 7 tiles out does
  not; Column forms two files 2 tiles apart facing the march; with nothing armed Escape opens pause and R/T/Y arm
  nothing; 60.4 fps, worst frame 16.8 ms over 3 s.
- **Not driven** (no relay, or not in the sandbox force): a versus room (the inert row is covered by jsdom only), the
  garrisoned pair ("Needs 2 free units"), a medic or ambulance in the selection (the CCP mark has no witness),
  the enemy-side sprung alert (raises nothing; jsdom only), per-unit "everyone fires" on the spring (inferred from
  the alert and the kills), and the row at the other two resolutions (`ui:shots`, CI).
- **Cursor badge caveat.** The glyph rides the sight's bottom-right quadrant inside the 32 px canvas, about 15 by 7
  px. Colour (green/red/yellow by family) carries the reading, not the shape; Column and Ambush share the Move
  sight. Clean at 4x. Shipped as built; the alternative, a 32x46 canvas for the three keys, would touch the sight
  assertions that pin `viewBox 0 0 24 24` and 32x32. A question for the lead.
- **Lavi chip precedence.** `chipStatus` ranks APS and the combat states above formation, so a Lavi MBT chip reads
  "APS 6/6" and never a formation. As designed.
- **Nit, deferred.** The arm note ("attack formation - click the objective (Esc cancels)") stays in the feed for
  the normal lifetime after the click spent it, and repeats merge into "xN", so it reads as a pending
  instruction. Suspect `formation-arming.ts` or the `issueFormation` note: retire the line on spend or disarm.
- **Unreproduced.** In run 1 one Column click after an ambush queued nothing; two clean re-runs worked every time
  (suspected partial box-select, not proved).

## Formations P1b (GH-859)

As built on `feat/formations-p1b` (plan `docs/superpowers/plans/2026-10-30-formations-p1b.md`, Rulings 1-18;
design `docs/superpowers/specs/2026-10-28-combat-formations-design.md`). P1b adds the march, the dress, the pace,
the contact drills and the calls to P1a's shapes. **Versus stays closed: S4 failed** (last subsection). The sources
of every number are the ledger `_coord/formations-p1b-progress.md` and the reports under
`_coord/formations-p1b/t8/` and `t9/`.

### The march, the dress and the pace

- **Checkpoints.** A formation order walks the route field once, at order time (`checkpointsOf`, pure, in
  `formation-template.ts`): the lead domain is the vehicle domain when any template member is a ground vehicle, else
  foot; the walk follows `dirs` from the members' centroid to the snapped click and gives up (no march: one
  checkpoint, the click) unless it reaches the goal. With L route steps and `leg_tiles` T the spacing is
  `max(T, ceil(L / 9))` (nine = `MAX_WAYPOINTS` plus the goal); the last checkpoint is always the click. A
  shift-appended formation order gets no march (Q5), `march.legs: false` (the shipped Ambush) compiles to one
  checkpoint, and pace still applies to both. Checkpoint k's slots come from `assignTemplate` with `from` =
  checkpoint k-1; intermediate checkpoints reserve nothing, the final one uses `reservedTilesFor`, which now
  reserves a formation member's LAST queued tile. `tCount` counts distinct ids, so `[a, a]` no longer meets
  `min_members` 2 (template branch only). Shipped route facts: a six-unit Column (24,44) to (24,14) on an open map
  is 30 steps, spacing 8, checkpoints y = 36, 28, 20, 14, four legs.
- **The hold.** `fmLeg[i]` is the checkpoint member i is heading to. `finishLeg` calls `fmMarchHold` on an arrival
  with checkpoints still queued. It holds only a row in `FM_MARCH` (a member that arrives after a drill ran passes
  straight through), only at `fmLeg > fgRelease` and `fmLeg < fgLegs`: it sets `fmDuty = FM_DUTY_WAIT`, adds one to
  `fgAtCp` and returns with `moving` still 1 and the goal unchanged, so the member re-arrives each tick at one
  compare and every system that acts on `moving === 0` (`stepSweep`, `stepMedics`' idle pick, the rest facing) leaves
  it alone. At a released checkpoint it goes straight on through `advanceLeg` (the `queued > 0` branch of
  `finishLeg`, extracted unchanged).
- **The release, in ticks.** `stepFormationMarch` runs BEFORE `stepMovement` (after `stepMedics`), which is what makes
  a release "the next tick's" (Ruling 7): with every member present the release is the last arrival's tick + 1, and
  on the clock it is the first arrival's tick + `dress_s` x 20 (60 ticks at the shipped 3 s). A release is
  `fgAtCp + fgAway >= fgMembers` (waiting, or away on a call) or `fgDress >= dressTicks` (the clock counts only
  while `fgAtCp > 0`). On release: `fgRelease++`, `fgDress = fgAtCp = 0`, one O(count) scan advances every WAIT
  member and re-reads `fgPace`, one `formationReleased` event. The same function counts the quiet clock (below).
- **The facing gate.** `stepFormationFacing` acts on a grouped member only when `fmLeg >= fgLegs` (the final
  checkpoint) or its row is in `FM_CONTACT`; `>=`, not `===`, because a shift-appended order keeps `fmLeg` 1 of
  `fgLegs` 1 while the member finishes its old goal, which advances `fmLeg` to 2. It skips a member on duty OUT or
  RETURN. `travel` now means the march direction (`eighthToward(click - checkpoint n-1)`, eight-way).
- **The pace.** `fgPace` is the minimum over living ground members not on a call of `baseStep(i)` (the expression
  `stepMovement` always used, extracted byte-identical) with `mobilityDamaged`'s percent applied. In
  `stepMovement`, after the mobility percent and before the rout and pin shifts, a grouped ground member not on
  duty OUT/RETURN has `step = min(step, fgPace)`. `march.pace: none` gives 0 (no cap). Aircraft and a member on a
  call are exempt. It is read at order time and at every release; the setter is not state
  (`formationPaceSetterOf` recomputes it: argmin step, lowest id).

### The drills and the calls

- **Contact.** `fmPend(id, x, y)` is the one hook. It restarts the quiet clock (`fgQuiet = 0`) on every call. A
  `FM_MARCH` row not yet pending takes `fgPending = FM_PEND_DRILL` and stores the point in `fgCallX/Y`; a CONTACT or
  SPRUNG row with `fgCalled === 0` takes `FM_PEND_CALL`. `FM_PEND_*` are bits (1 drill, 2 call), so a spring with no
  call writes what P1a wrote. The mark also pushes `formationContact` (`formationSprung` for a `spring` group). The
  call bit is set only when the formation has a `contact` call element AND the point is within `call_radius_tiles`
  of the member that REPORTED it (`fmCallReaches`, Ruling 10, the lead's Q3): measured from the aircraft, Attack's
  aircraft 13 tiles back could never answer a 12-tile radius.
- **The fire sites** (the ledger's grep of `kind: 'fire'` finds two pushes; five sites in all): `fireAt` (the
  target's position), `fireAtStructure` (the aim point), `stepBeam` (after `lastFired`, the target's position:
  the beam pushes `kind: 'beam'` and never goes through `fireAt`), `applySuppression`'s hostile branch (the
  source origin) and `stepCombat`'s spring (the member's own position). Nothing else pushes a fire event.
- **The drills** run in `stepFormationContact` (P1a's spring step, renamed, same place: before
  `stepCombat`). `halt` and `press` set `FM_CONTACT` (3); `spring` is P1a's, state `FM_SPRUNG`. `spring` and `press`
  end the dress through `fmEndDress` (`fgRelease = fgLegs - 1`, every WAIT member advanced, `fgAtCp`/`fgDress` zero).
  - `spring`: P1a, plus the dress end. Ring stances clear, one tick before `stepCombat`.
  - `halt`: `haltUnit` on every ground member and on every aircraft that will not be called (`stay`, or the call
    bit is clear); an aircraft the call will sortie is skipped. It clears every member's WAIT duty first (a waiting
    aircraft that was left WAITing was a defect), zeroes `fgAtCp`/`fgDress`, and sets a vehicle's `restFacing` to
    `eighthToward(call point - own position)`. A RETURN member is halted and freed (duty NONE, `fgAway--`); an OUT
    member keeps its duty but loses its queue like any ground member. An answering aircraft in a halt row has
    `wpCount` zeroed, so it flies to the call, comes home to `fmHome` and stops.
  - `press`: pace stays, the dress ends, the WAIT members go on. Neither press nor spring touches OUT/RETURN members.
- **`fgCalled`** is a `Uint8Array`: 0 nobody out and a call may be raised, 1 at least one aircraft is out on the
  row's call (the quiet clock runs and `fmRecall` is armed), 2 nobody could ever answer (no live member passes
  `fmCanBeCalled`: air, not `stay`, an element on call for `contact`), so `fmPend`'s `fgCalled === 0` gate stops
  the re-mark and the per-exchange scan. The value hashes and snapshots as is; `fmForget` zeroes a freed row.
- **Aircraft call class** (Ruling 12, `aircraftCallOf(json)` once into `UnitType.fmCall`): a weapon that can target
  `ground`, no `kamikaze`, no `swarm` block, no seats is `strike`; no ground weapon is `spot`; seats (`hull.transport_slots`),
  `kamikaze` or `swarm` is `stay`. Census of the nine shipped air units: `heli_peten` and `heli_peten_gunship` and
  `paramotor` strike, `recon_drone` spot, `heli_yanshuf`, `attack_drone`, `loiter_drone`, `drone_swarm` and
  `air_medevac_heli` (the unlisted ninth, seats 4) stay. `fmCallAircraft` sends every strike/spot aircraft member
  that is free (duty below OUT, not LANDING, in an element on call for `contact`), at any distance (it is the group's
  own): `fmHome` = its goal if moving, else its position; goal = the call point's tile centre on the air field;
  `attackMove` 1 for strike, 0 for spot, `sweepOrder` 0; `fmDuty = OUT`, `fgAway++`, `fgCalled = 1`, one
  `formationCall` event. Its queue is left intact (`finishLeg` on an OUT member stops it and never advances the
  queue) except in a halt row (above).
- **The return.** `stepFormationMarch` counts `fgQuiet` up for a CONTACT or SPRUNG row. At `quiet_s` x 20 ticks with
  `fgCalled === 1`, `fmRecall` sends every OUT aircraft home (`fmReturnHome`: goal = `fmHome`, `attackMove` 0, duty
  RETURN, since a gunship flying home as an attack-mover would stop at every target) and sets `fgCalled = 0`.
  `finishLeg` on a RETURN member sets duty NONE, `fgAway--` and `attackMove` = the formation's verb, then runs the
  ordinary march logic. A medic is not recalled: he comes home through `medicIdle` (rescue done, not routed, nobody
  carried) or from `stepMedics`' idle pick. Residual: a contact while the only aircraft are RETURN raises the bit on
  each exchange and is answered only after landing (Ruling 12 skips a RETURN aircraft); the probes count those ticks.
- **The medic call** (Ruling 14). In `fallMan`, when the wounded is spawned and `fmLive`, `woundCrossings` has
  captured `fmGroup[target]` BEFORE `destroy` forgets it (so a squad's last man is called for too, though his own
  group is -1). `fmCasualty` picks the nearest group member with a `rescue` block by `distSqFx`, ties by id: on foot,
  free (`fmDuty < OUT`, `medState` IDLE, no passenger, not garrisoned, not downed or routed), within
  `call_radius_tiles` of the wounded, in an element on call for `casualty`. He gets `beginRescue(m, w, keepQueue = true)`
  (the `rescue` branch's writes after its `fmForget`, extracted; the `rescue` command is `beginRescue(id, w, false)`,
  byte-identical, so `WOUNDED_WORLD_PIN` did not move), then `fmHome`, `fmDuty = OUT`, `fgAway++`. Keeping his queue
  needs `medicGoTo`/`medicTend` not to zero `wpCount` while he is OUT (`fmOnCall`, behind `fmLive`). The ambulance
  and the medevac never answer: they are the CCP. A medic out of reach does not answer.
- **The counters and the exit funnel.** The row columns are `fgLegs`, `fgRelease`, `fgDress`, `fgQuiet`, `fgAtCp`,
  `fgAway`, `fgCalled`, `fgPace`, `fgCallX`, `fgCallY`; the unit columns `fmLeg`, `fmDuty` (NONE 0, WAIT 1, OUT 2,
  RETURN 3), `fmHomeX`, `fmHomeY`; all state, appended after `fgMembers` behind a second marker word `0x464d0002`.
  `fmForget` is still the one way out and now also unwinds: WAIT -> `fgAtCp--` (and the dress clock when it falls
  to zero), OUT/RETURN -> `fgAway--`, then clears `fmDuty`, `fmLeg`, `fmHome`; a freed row zeroes all fourteen. A
  player order to a member on a sortie is the manual override: it takes him out of the group.
- **Pins, in order** (each in its own commit, "Was <n>."): snapshot format 3512584427 -> 128788725 (the 14 rows);
  `FORMATION_WORLD_PIN` 2129900778 -> 16150840 (the new marker word and 14 zero columns fold into any `fmLive`
  world; the plan's "unchanged in T2" was wrong) -> 332225713 (march) -> 39544183 (contact) -> 3138870583 (calls) ->
  762031029 (fgCalled 2). The golden flat 1258746094 / relief 1483138559 / orders 2559269335, the economy and
  runtime-digest pins, `WOUNDED_WORLD_PIN` 3748305113, fire-support HASH, versus pins, `LADDER_CREDITS` (unchanged by this branch: 6279,
  main's value, which the GH-707 loaned medic teams moved from 5973) and `ROSTER_MAX` 30 did not move.
- **UI** (Task 10). The card reads the march and the call: "checkpoint n of m", the pace and its setter, "On call",
  "Answering a call", the contact column or attack, "degraded" (`Sim.formationDegradedOf`); the chip reads "6 in
  column - cp 2/4"; own-side alerts, one per event; the tooltip composes the halt, pace and call clauses from the
  compiled file. `tools/validate_formations.mjs` requires `hud.formation.pace` and `hud.formation.call.<on_call>`.
  The inert reason is `needsMin` ("Needs {n} free units"; the key `hud.formation.inert.needsMin`). Pace is shown to one
  decimal, not for an aircraft, a member on a call or a halted Column.

### Measured (head `2a80a3bbd`, Tasks 8 and 9; outputs `_coord/formations-p1b/t8/` and `t9/`)

- **S1 byte identity.** `test:determinism` and the full suite green with only the two planned pins moved, `pnpm
  playtest` byte-identical to the pre-flight baseline, `pnpm balance` identical but for the two Attack-formation
  rows, and the NO-formation `versus:probe` on all 16 offered cells (set A, 192 seeds, 3072 games a side) against
  `d203f0237`: 0 per-seed mismatches in winner, `by` and ticks, stdout identical.
- **S2 (urban Attack).** Base tier 0/25/95/100 at 1:1/2:1/3:1/4:1 (plain 0/30/100/100, 24 of 240 seeds differ); max
  tier 0/30/92/100 (plain 0/42/100/100, 34 of 240 differ). Both inside the band, the 2:1 row 70 and 62 points below
  3:1. **M7a: the Attack arm no longer equals the plain arm seed for seed (P1a's 0 of 240), so the urban gate can now
  fail through pace and dress** and must be read after any change to the march.
- **S3 probes** (`pnpm formations:probe -- --probe=medic|air|ashwar|ambush`, 60 seeds, report-only):
  - Medic: treatment delay median 1.1 s Attack and 1.3 s Column formed against 9.4 s and 6.8 s plain. Attack formed
    loses 1.11 medic squads per engaged game (plain 0.98) and has no medic in reach 8.3% of the time (plain 1.6%);
    bleed-outs 111 of 180 (plain 165 of 246). Column formed: 40 casualties, 0 bled out, 0 medics lost (plain 509,
    416, 1.07).
  - Air: a called gunship first fires 1.0 s after contact against 0.4 s in the hull rank; survival 100% in both,
    MANPAD killed 100% in both; RETURN-only contact ticks 0.
  - Ashwar (the Column against an unfired team; 60 seeds are 12 geometries x 5, the sim draws nothing there, so read
    per cover): the Column gets the volley first 0% at cover 0, 0% at 1, 66.7% at 2, 100% at 3 (pooled 41.7%),
    against 100% everywhere for a plain move; the Column loses no hull and kills the team 100%, the plain move at
    cover 3 loses a hull and kills it 6.7%.
  - Ambush: fire together within 1 s of the ring's first shot 75.0 / 100.0 / 89.2% (head / cross / through) against
    16.7-25% in the per-unit and travel-facing arms; fratricide 0.0 / 0.1 / 0.0% (the D7 P2 trigger is not
    flagged). With a gunship and drone in the group: 2 sorties a game, 54, 58 and 60 of 120 alive at the end,
    RETURN-only contact ticks 5 / 13 / 0.
  - Overlap (`vehicle-overlap:probe -- --formation=column`): transit pair-ticks 5488 -> 5310 and at-rest 10 -> 0,
    but deep pair-ticks 2109 -> 3107 (+47%), worse in 3 of 6 scenarios on transit.
  - Perf (`pnpm perf:formations`, three invocations of three runs): median tick delta 0.810 / 0.971 / 0.904 ms (bar
    1 ms; 0.97 is close), worst checkpoint-activation excess 3.462 / 3.034 / 2.652 ms (bar 5), `flowFieldCount`
    peak 294 formed against 300 plain.
  - Playtest variants (`pnpm formations:playtest`, 30 seeds): Beit Sahwan IV and Tel Marum II win 30/30 in every
    variant (Beit Sahwan IV Column 4.7 min against 2.7, ROE 94 against 100). **Qarn Hadid III with Attack is 0/30,
    every loss `withdrawn`.** Diagnosis: the shipped plan is open loop; its t=75 west leg is cut off by the t=110
    redirect at the paced speed, and `kill_the_relay` never completes. A scratch counterfactual with one extra west
    attack-move at t=300 wins 30/30 at median 6.27 min (limit 14). It is not a case of pace making the deadline
    unreachable, and nothing was retuned.

### The S4 gate, and why versus stays closed

- **The tool.** `pnpm s4:gate -- --end=<both|friendly|hostile> --base-a=.. --arm-a=.. [--base-b=.. --arm-b=..]`
  reads per-seed files written by `pnpm versus:probe -- ... --per-seed=<file>` (schema `versus-per-seed/1`,
  `tools/src/backtest/per-seed.ts`), with `--seed-from=<n>` (set A is `--seed-from=0 --seeds=192`, set B `--seed-from=192
  --seeds=192`) and `--tunnel-cell=<off|noAnswer|answer|turtle>` (one tunnel cell, no twin). Each flag takes a comma
  list of files merged by cell key; exit 0 all pass, 1 any TRIP, 3 a RERUN still unplayed, 2 the gate refused (a
  pairing fault: seeds, cells, seat table or cap differ, an arm that is not Attack, set B overlapping set A).
- **The verdict rule** (the lead's Q1, exact; integers only, a share is wins over ALL seeds, a draw is no one's):
  - (b) both ends in Attack, per cell, S = the arm's leading-end share (the end with more wins, end 0 on a tie), B =
    the same end's base share on the same seeds. S <= 55 PASS; 55 < S <= 65 at set A is RERUN (play set B, judge the
    pooled seeds: pooled S <= 60 PASS, above it the baseline clause); S > 65 is the baseline clause.
  - (c) one end only, S = the formed end's share. S <= 60 PASS; 60 < S <= 70 RERUN (pooled judged against 65); S > 70
    the baseline clause against 65.
  - The baseline clause: TRIP, unless B is itself above the bar (60 for (b), 65 for (c)) and the paired sign test
    shows no shift toward that end (two-sided exact binomial p >= 0.05, or more flips away than toward): PASS
    (baseline outside, not worse). Flips: toward = the end wins in the arm and not in the base, away = the reverse.
    "p < 0.05" is decided in integers, never on the printed float.
- **S4 failed at the shipped layout L0** (Task 8.4, set A 192 seeds, set B 192..383 for every RERUN; mirror, placed
  and economy groups, all three arms on every cell): of 36 cell-arm verdicts, **13 TRIP and 23 PASS**.
  - (b), 8 TRIP: mirror Beit (east 78.6%, base 49.5, flips 75/19), mirror wadi_tarfan (pooled 64.1, base 53.4,
    115/74), placed tel_marum KDF-friendly (Sarim 66.1), placed wadi_tarfan KDF-friendly (KDF 88.0) and Sarim-friendly
    (KDF 95.3, flips 98/3), economy tel_marum KDF-friendly (Sarim 70.8), economy wadi_tarfan KDF-friendly (KDF 81.8)
    and Sarim-friendly (KDF 91.1).
  - (c) friendly, 3 TRIP: mirror Beit 71.4, mirror wadi_tarfan 70.8, economy wadi_tarfan Sarim-friendly 70.3 (135 of
    192, one game over the bar). (c) hostile, 2 TRIP: mirror Beit 90.6, mirror wadi_tarfan pooled 66.9.
  - The tunnels group was not played at L0 (L0 already fails).
- **The lever screen** (Task 9; L1 the light-vehicle rank 2 wide instead of 6, L2 the aircraft standoff 13 -> 7 and
  13 -> 0, and the combined arms), run on the Beit mirror (b) at set A, the cheapest and most severe cell: **all
  five arms TRIP** (S 78.6-80.2 against base 49.5, flips 75/19 to 79/20, p 0.0000). L1 is byte-identical to L0 on
  Beit (the Beit KDF force holds one wheeled light vehicle, so the width is the same one tile); L2 re-deals 188 of 192
  games and L2 at 7 equals L2 at 0. A clean arm needs no TRIP on any cell, so one TRIP kills an arm and the screen
  stopped there. Task 9 steps 3 and 4 and Task 11 (the layout edit and the open gate) were not done;
  `data/formations/attack.json` is unchanged.
- **The mechanism** (a monkeypatched `Sim.tick` trace of `play()`, 96 seeds): with both ends formed the joint march
  delays first contact from 5 s to 15 s and the dressed formation leaves one end nearer at the first shot. On
  wadi_tarfan placed KDF-friendly KDF wins 45 -> 84 of 96: Namer kills of Kornet teams 1.70 -> 5.93 a game, Kornet
  kills of Lavi 1.20 -> 0.22, first Kornet death 45.5 -> 29.7 s, and at the first shot the Sarim Kornet and rifle
  teams are nearer the enemy than their own gun trucks (11.1 and 10.1 against 12.1 tiles). This is the reverse of
  P1a (Namers dying sooner, Sarim winning), and one-end arms do not do it (KDF-formed alone 58.3). On the Beit mirror
  the dressed march leaves the east end nearer (Lavi 11.4 against 15.0 tiles), the east Lavi loses 0.30 a game
  against 0.69, so the formation shifts the Lavi duel by end. The levers only move slots; this is the march.
- **Versus stays closed, because S4 failed** (the coordinator's Q6: P1b ships single-player with versus off). The
  gate is unchanged: `VERSUS_FORMATIONS_OPEN` is false, the sender strip, the receiver gate and the inert HUD row are
  as P1a left them.
- **To open versus** needs a clean S4 read, and the only lever class left is the march itself: for example
  mirroring the formation's frame between the two ends so neither is nearer at the first shot. That is an engine
  change, so it is P2/P3 design work, not a data edit. When a march change passes S4 per cell at 192+ seeds,
  the closed-gate tests re-aim as the "To open versus" paragraph above lists, and an unfielded shape then wants its own refusal text (`mcp-tools.ts` names
  `formations-closed-in-versus` for any formation field that passes precheck without it).

### Post-merge corrections (final whole-branch review, 30 Oct; head `522c89ab5` plus the review-fix commit)

- **The Task 8/9 measurements predate the merge of origin/main.** Every number in "Measured" above was read before
  main's loaned `inf_medic_squad` (one in every campaign mission but the tutorial, GH-707) joined the branch. S1 byte
  identity, S2, S3 and the playtest variants are pre-merge readings. The playtest variants were RE-RUN on the merged
  head (`pnpm formations:playtest`, report-only, 30 seeds, 90 s; output `_coord/formations-p1b/t13b/playtest.txt`):

  | mission | variant | wins/defeats | win min median / slowest | ROE median / lowest | events contact/sprung/released/call |
  |---|---|---|---|---|---|
  | beit_sahwan_4_subterranean | none | 30/0 | 2.6 / 6.0 | 100 / 94 | 0/0/0/0 |
  | beit_sahwan_4_subterranean | attack | 30/0 | 2.6 / 7.0 | 100 / 94 | 169/0/0/3 |
  | beit_sahwan_4_subterranean | column | **27/3** (lost 3: objective `get_them_out`) | 4.7 / 6.3 | 94 / 94 | 171/0/0/0 |
  | beit_sahwan_4_subterranean | ambush | 30/0 | 2.7 / 3.2 | 100 / 100 | 0/122/0/0 |
  | tel_marum_2_foothold | none / attack / column / ambush | 30/0 each | 4.2 / 4.6, 4.2 / 4.6, 4.2 / 4.2, 4.2 / 4.2 | 98 / 98 each | attack 71/0/6/0, column 24/0/60/0, ambush 0/38/0/0 |
  | qarn_hadid_3_clearance | none | 30/0 | 3.4 / 4.4 | 94 / 91 | 0/0/0/0 |
  | qarn_hadid_3_clearance | attack | **0/30** (every loss `withdrawn`) | n/a | n/a | 196/0/110/0 |
  | qarn_hadid_3_clearance | column / ambush | 30/0 each | 3.4 / 4.4 | 94 / 91 | none carried |

  Against the pre-merge table (every variant of Beit and Tel Marum 30/30; Beit Column 4.7 min, ROE 94): Tel Marum II,
  Beit Attack and Beit Ambush are unchanged, and Qarn Hadid III is unchanged (Attack 0/30 withdrawn, the open-loop
  plan). **New: Beit Sahwan IV Column loses 3 of 30 seeds on `get_them_out`** (it won 30/30 before). The review-fix
  commit is behaviour-neutral (no pin moved), the `none` variant is unchanged, so the loss comes from the merge,
  most likely the loaned medic joining the Column's march; it was not investigated. Read it before the P1b PR: it is a report-only
  variant, nothing was retuned, and the lead decides whether a Column that loses 10% of a campaign mission is a P1b
  blocker or a P2 note.
- **`s4:gate` was not re-run after the merge**, although `packages/sim` moved. S4 already failed at L0 and versus stays
  closed, so there is no verdict to protect; the versus pins are unchanged on the merged tree (`test:determinism` and
  the full suite are green).
- **Formations are also open in the two-human sandbox room (mode `sandbox`), as in P1a** (`formationsOpenIn`). The
  march, the dress and the calls run in lockstep there, so both clients simulate them; nothing in this branch tested
  the sandbox room beyond the jsdom closed-gate tests.
- **The levers were measured only on the Beit mirror (b).** L1's possible gain on wadi_tarfan (where the KDF force
  holds more wheeled light vehicles) was never tested. It cannot change the verdict: one TRIP kills an arm and every
  arm TRIPs on Beit.
- **A waiting member keeps `moving` 1**, so `isEffectivelyMoving` treats it as moving for the detection signature, the
  target-motion test and the shooter stance for up to `dress_s` (3 s) per checkpoint. That matches the sim's existing
  short-halt pricing (a unit that has just stopped is still priced as moving for a short while).
- **Follow-ups, none done:**
  - M-3: a halted row's OUT member, medic or aircraft returns to the pre-halt checkpoint slot. `fmHome` should be
    re-stamped to the member's position when the halt runs. Needs a re-pin and a re-read of the medic probe.
  - M-5: leave a mobility-killed aircraft out of `could` in `fmCallAircraft`. A downed aircraft on RETURN forever keeps
    `fgCalled` 0 and the row rescans on every fight tick.
  - M-6: the per-seed files do not record `--rescue-buy`, `--start`, `--pop-cap` or `--rate-scale`, so the S4 pairing
    guard cannot refuse a base and an arm played under mixed overrides.
  - M-8: pressing the armed formation's own button after it went inert leaves it armed.
  - The march-frame work for versus: mirror the formation frame between the ends. Scratch-arm the Beit mirror first.
  - Deep vehicle overlap +47% (GH-421).
  - Qarn Hadid III's open-loop playtest plan (the t=75 west leg is cut off by the t=110 redirect at the paced speed).
