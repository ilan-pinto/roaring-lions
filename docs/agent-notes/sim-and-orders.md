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
- **Wounds and rescue (GH-707) are ENGINE-ONLY until P3.** A squad with `hull.wounds` sheds a one-man `wounded` entity at each figure-share crossing; he bleeds, crawls to cover, and is treated, carried (`can_carry`) and admitted at an `aid` structure, then rejoins his squad weaker (`scars`). No shipped unit, structure, mission or map uses a wound field yet (P2 adds content, P3 switches on all infantry and re-pins). Every wound column -- and `removed`, which evacuation and admission now write -- folds into `hash()` only once a wound-related type is registered (`woundLive`, the `airLive`/`fwLive` deferred fold), so no pin moved; `WOUNDED_WORLD_PIN` in `determinism.test.ts` is the replay that sees the block. Rules: `sim.ts` `stepWounded`/`stepMedics`/`stepAidPosts` (and `applyDamage`'s share crossing), pure helpers in `wounds.ts`, numbers in `tuning.ts`. Conduct: `mission.ts` `stepRoe` pays +2 per enemy and +3 per civilian wounded the player admits or evacuates (once per man, +10 a mission, never past 100; `roeGain` event, folded into `digest()` only when non-zero), charges 3 for player fire killing a down enemy (not a bleed-out), and a downed civilian's 8 at his death, never the hit. A rescued man is not lost (`isLost`); a `remove` trigger's body still is. A map marker `wounded_evac` is side 0's evac point. **Versus (30 Oct 2026, the lead):** the Nemala medic team was opened to the KDF versus menu and HELD out again the same day (PR 907: the probe's ruled buy rule delivers 0.0 medics a game, and `--rescue-buy=opening` leaves 60/40 on Tel Marum Sarim friendly), so all three rescue units are in `VERSUS_HELD_UNITS`; the rescue tests, `pnpm versus:probe -- --rescue-buy=...` and the witness's rescue world put the medic in a room in memory (`medic-room.test-helper.ts`). What stays: in a versus economy room the camp is the drop-off: `standMapStructures(sim, map, true)` gives the `camp` type its `versus_aid` block as `aid`, and `Sim.aidSideOf` lets a NEUTRAL aid structure work for the side it produces for (no owner, so no field-works fold and not a target). A mission's camp admits nobody. In a room `rescue` targets only the seat's own side's wounded (`validateCommand`), and a rescue unit keeps no side alive (`armedStanding`). Numbers: `docs/campaign/economy/production-numbers.md` section 6. Spec `docs/superpowers/specs/2026-10-22-wounded-rescue-design.md` (§0 rulings win), plan `docs/superpowers/plans/2026-10-22-wounded-rescue.md`.

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
calls (P1b). The sources of every number below are the ledger `_coord/formations-p1a-progress.md`, the S4
diagnosis `_coord/formations-p1a/t6/s4-diagnosis.md` and its `t6/*.txt` tables.

- **The order.** `move` and `attackMove` carry an optional `formation` (a string of at most 32 characters,
  `^[a-z][a-z0-9_]{0,31}$`, mirrored in the schema and pinned by `tools/src/formation-id-pattern.test.ts`).
  `applyMove` reads it only through `templateFor`. Everything else in the table below is a plain order, exactly
  today's code path.
- **The state.** One group table (`fg*` columns, `fmGroup`, `fmArrive`, `restFacing`), `MAX_FORMATION_GROUPS_PER_SIDE`
  16, `FORMATION_ROWS` 32 (side `s` owns rows `s * 16 ..`). Every column folds into `hash()` and the snapshot only
  once `fmLive` is set, by the first template order (the `airLive`/`woundLive` pattern). Registering a formation
  does not set it. Pins: `FORMATION_WORLD_PIN` is a new replay (2129900778 at this writing, re-pinned once by the
  spring-before-combat fix); the snapshot format pin moved 2452666963 -> 3512584427 with the new rows.
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
  and pushes `formationSprung`; `stepFormationSpring` runs BEFORE `stepCombat` and clears the ring's stances, so
  the ring opens fire one tick after it was found (an in-tick test pins that). If every member is ordered away
  between the mark and the spring, the row frees with the event already pushed and no spring follows (accepted).
  Aircraft never take a stance; medics in an Ambush order take none; only ring-element members do.
- **Placement.** `formation-template.ts` (`assignTemplate`, `templateOffsets`) is pure and shared with the HUD
  schematic. `FORMATION_WALK_CAP` 24; a 24-hull Column is 36 deep, so a `files` element spills its leftover hulls
  BEHIND its own rear row (S3 ruling), on a lazily built full-map walk; `overflow` is empty for every shipped
  (formation, mix, N). `tools/src/formations_place.test.ts` is the gate (N = 2..24, every class mix, no tile
  twice, vehicle spacing outside the ring).

### Versus: formations are OFF until P1b (lead's ruling, 29 Oct, GH-859)

Formations ship in single player. In a versus room they are off until P1b. The mechanism is ONE predicate,
`packages/app/src/net/versus-formations.ts`: `VERSUS_FORMATIONS_OPEN = false` and `formationsOpenIn(mode, versusOpen)`
(a versus room follows the constant; single-player and the sandbox room are open). Three consumers:
- the SENDER strip, `roomOrderSink` (`room-pause.ts`, `mode` a required fourth argument so a missed caller fails
  `tsc`): a `move` or `attackMove` goes out through `withoutFormation`, a new object with the key deleted, so a
  plain order is delivered, never a refusal (the pause behaviour is unchanged);
- the RECEIVER gate, `seatWorldFor(...).formationAllowed`, false in a versus room, so a forged or stale client's
  formation order drops on both machines (the protocol still carries the field);
- the HUD row: drawn, every button inert, reason `hud.formation.inert.versus` ("Formations are not in versus rooms
  yet"), which outranks `needsTwo` and `ambushNoGround`; R/T/Y arm nothing.

The sim still registers the shipped formations in every room (`match-world.ts`) and the content digest still folds
them (as an ARRAY in `formations` order, so the digest covers registration order). The no-formation versus probe is
byte-identical to baseline (Beit mirror, `kdf/kdf`, 96 seeds: `47 49 0`, `96/0/0/0`, 2.9 min, east 51%).

**To open versus (P1b):** set `VERSUS_FORMATIONS_OPEN = true` after P1b's S4 reads pass. These closed-gate tests
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
  garrisoned pair ("Needs two free units"), a medic or ambulance in the selection (the CCP mark has no witness),
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
