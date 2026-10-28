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
- **Wounds and rescue (GH-707) are ENGINE-ONLY until P3.** A squad with `hull.wounds` sheds a one-man `wounded` entity at each figure-share crossing; he bleeds, crawls to cover, and is treated, carried (`can_carry`) and admitted at an `aid` structure, then rejoins his squad weaker (`scars`). No shipped unit, structure, mission or map uses a wound field yet (P2 adds content, P3 switches on all infantry and re-pins). Every wound column -- and `removed`, which evacuation and admission now write -- folds into `hash()` only once a wound-related type is registered (`woundLive`, the `airLive`/`fwLive` deferred fold), so no pin moved; `WOUNDED_WORLD_PIN` in `determinism.test.ts` is the replay that sees the block. Rules: `sim.ts` `stepWounded`/`stepMedics`/`stepAidPosts` (and `applyDamage`'s share crossing), pure helpers in `wounds.ts`, numbers in `tuning.ts`. Conduct: `mission.ts` `stepRoe` pays +2 per enemy and +3 per civilian wounded the player admits or evacuates (once per man, +10 a mission, never past 100; `roeGain` event, folded into `digest()` only when non-zero), charges 3 for player fire killing a down enemy (not a bleed-out), and a downed civilian's 8 at his death, never the hit. A rescued man is not lost (`isLost`); a `remove` trigger's body still is. A map marker `wounded_evac` is side 0's evac point. Spec `docs/superpowers/specs/2026-10-22-wounded-rescue-design.md` (§0 rulings win), plan `docs/superpowers/plans/2026-10-22-wounded-rescue.md`.

---

- **Vehicle health (GH-560; the lead's four rulings, 27 Oct, GH-858 comments).** HP alone ends a vehicle. A penetration of a hard hull costs `penetrationHpCost(maxHp, damage, shift)` (`packages/sim/src/vehicle-health.ts`): `max(damage, floor(maxHp x PEN_HP_FLOOR) x (PEN_HP_OVERMATCH_DIV + shift) / PEN_HP_OVERMATCH_DIV x min(damage, R) / R)`, `PEN_HP_FLOOR` 0.34 (22282), `PEN_HP_OVERMATCH_DIV` 60, `shift` the 0-30 overmatch shift (`overmatchShift`), `R` = `PEN_HP_REF_DAMAGE` 85.0 (5570560; GH-868). So 3 hits, or 2 at shift 29 or 30 (0.51 at 30; two hits pass the bar from shift 29), for a round of 85 damage or more. **Below R the floor is scaled by `damage / R`** (integer, `((floor * damage) / R) | 0`, exact in a double): a flat 34% made a technical's DShK (damage 40) kill a Peten in 3 hits (199/200 in 8.3 s against main's 110/200 in 13.7 s) and kill a Remetz in 2.7 s (main 9.6 s). At R = 85 those read 173/200 in 18.9 s and 6.5 s, and every row the design table pins (ZU-23 v Peten = 3 hits, 30 mm, chain gun, the 380 loiter warhead) is unchanged. R = 85 is the largest R that leaves them alone: R = 100 moves a versus cell to 60.4%, R = 125 the ZU-23 to 4 hits. A penetrating weapon of damage 0 would cost 0; none ships (`spg_cluster`'s submunition carrier bursts before the penetration path). The witness is `sf2` in `vehicle-health-probe.ts` and its two gates in `vehicle-health-probe.test.ts`: nothing else, not balance, playtest, the versus arms or a pin, sees this change (measured byte-identical). The MANPAD half of GH-868 (one MANPAD costs 300 of a Peten's 640 and fires one missile per window: 0/200 against main's 43/200) is NOT a floor effect and is open. It applies on EVERY penetration path: the gun/missile tail of `resolveHit`, the kamikaze terminal strike (`stepKamikaze`) and `beamStrike`. Leaving the loiter drone at its weapon damage (17%) was the first draft and was a silent nerf (1-3 drones killed a Lavi 0 of 200): ruling S-1. `rollComponent` keeps its ONE draw on the shooter's stream (so every later draw is where it was) over weights that total `92 - shift`; `'catastrophic'` and `COMP_CATASTROPHIC` are deleted. **Never remove the draw**: it would shift every stream. A hard hull is any unit whose front plate is 30 mm or more (16 at the base commit; `tools/src/vehicle_health_bounds.test.ts` census). Ruling 3 has two side effects, both pinned in `vehicle-health.test.ts`: a bounce that `threatens` (`splash > 0 || penetration >= armorSide`) writes `lastDamagedTick`, restarting the 10 s regen delay, and `stepFieldFix` (a stuck hull's crew fix) and the workshop's component repair read the same field, so a threatening bounce postpones both. A round that could never hurt (a rifle on an MBT) does not. The cannot-penetrate fallback is kept (ruling 4). `hull.hp` is bounded by `"maximum": 32767` in `unit.schema.json` (`fx.from` wraps above it; `vehicle_health_bounds.test.ts` also asserts `hp * 65536 < 2^31` at base and top tier). No new column, no new per-tick work.
  - **Pins that moved** (each in its own commit, "Was <n>."): relief `1070599391` -> `1483138559` (both sites in `determinism.test.ts`); the ground-carrier jeep digest in `carriers.test.ts` `1417887594` -> `224131754` (S-1: the scenario's munition penetrates the tank); arena rush-over-passive seed `48514` -> `56433` (GH-816's method, seeds 0-11); the air-assault LANDING witness re-pointed to arm E (ZU-23) seed 0; the versus-probe table witness re-read (room 5420 -> 4440 ticks). Flat, orders, `ECONOMY_PIN`, both `RUNTIME_DIGEST_PIN`, `WOUNDED_WORLD_PIN`, fire-support `HASH` and the snapshot format pin did not move. The versus re-price moved the Beit seat table entry, the Beit mirror hashes (`versus-force` / `versus-breach` / `match-world`), `VERSUS_ECONOMY_PINS` tel_marum and the GH-681 wadi_tarfan route capacities. `LADDER_CREDITS` 5961 and `ROSTER_MAX` 30 are unmoved.
  - **Measured (200 seeds, `pnpm vehicle-health:probe`).** The Lavi duel: 99% of kills were catastrophic rolls and 73% of deaths came at a bar of 0.7 or more; now the luck share is 0%, the median bar at death is 0.07 and the time to kill is 17.5 s -> 37.5 s. Spike x3 v Lavi: median bar at death 0.87 -> 0.36, ttk 2.6 s -> 42.6 s. The probe's "luck" column is an upper bound (a destroyed hard hull whose bar was at least 0.5 the tick before, with a penetrating impact on the fatal tick): a salvo or a heavy warhead can read non-zero without a roll; the gate is the Lavi duel only. Vehicle deaths are no longer a function of one roll, so a lone loitering munition or MANPAD cannot kill a Lavi or a Yanshuf (one penetration is 38-39% of the bar). Target choice still reads P(pen), never HP: there is no "finish the damaged hull" preference, the obvious next doctrine lever.
  - **A loitering munition delivers its warhead once (GH-867).** `stepKamikaze`'s terminal strike is the only delivery: `stepCombat` skips every `isKamikaze` unit (clearing `engaging` and `curStructure`, leaving `curTarget` to `stepKamikaze`). Before, a drone whose weapon range exceeds `KAMIKAZE_STRIKE_SQ` (`loiter_drone`: 1.3 tiles against 1.22) also fired the warhead as an ordinary round, was destroyed by the strike, and the round landed two ticks later from a dead shooter: two penetrations from one munition, which under the GH-560 floor was the ONLY way a lone drone killed a hard hull. It also shelled a building holding an identified enemy for as long as it hovered there. A fixture whose range is under 1.22 tiles never leaked, so a test of this needs the shipped range. Witness: `packages/sim/src/kamikaze-single-warhead.test.ts`.
  - **Standoff (Sarim)** stays report-only (ruling 4): the doctrine and data work is GH-865. Spec `docs/superpowers/specs/2026-10-27-vehicle-health-design.md`, plan `docs/superpowers/plans/2026-10-28-vehicle-health.md`.

