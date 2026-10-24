# Mission, tunnel, playtest and Tel Marum findings

Moved verbatim from `CLAUDE.md` (origin/main `f946bb16`, 2026-10-25) when that file was slimmed to its rules.
The rules distilled from these passages stay in `CLAUDE.md`; this file keeps the measurements, history,
reasoning and superseded statements behind them, unedited. Nothing here has been pruned yet.

<!-- CLAUDE.md lines 2476-2485, section "Known scaling debts" -->

- Tunnels are implemented (`feat/tunnel-subsystem`): routes are map data, a digger
  advances one and leaves surface spoil, stocked fighters surface at the vent to fire a
  volley and submerge, and a `yahalom_squad` charge collapses a route. Both content keys
  are wired: a placement's `digs` assigns its body as a route's digger, and a
  `mark_tunnel` unit with a sight line to a route identifies it — spoil or no spoil —
  so an authored mission can dig, find, and collapse a route end to end (the mission
  runtime tests prove the chain from JSON alone). The Beit Sahwan subterranean
  mission (#91) now exists — `data/missions/beit_sahwan_4_subterranean.json`, the
  first content to use the `subterranean` phase. `tunnel_travel` remains unit data
  only.

<!-- CLAUDE.md lines 2493-2749, section "Known scaling debts" -->

- ~~A civilian who boards a transport and whose transport then dies before reaching the refuge is stranded forever~~ — **fixed.** `stepCivilians` latched `civFled` before boarding was attempted and then skipped that civilian on every later tick, so one dropped by a dead carrier had no order and no way back into the loop, and could never satisfy `evacuate_before`. It is now re-ordered to the refuge when it has actually stopped — riding and walking are both left alone as progress, and an evacuated civilian is already `alive = 0`. A civilian standing on the refuge marker and still uncounted means that mission's marker sits outside its own evacuation zone, which is an authoring fault and is deliberately NOT re-ordered (it would queue one dead command per tick). Guard: `mission.test.ts`, "re-orders a civilian whose transport died".
- `starting_force` never consults a unit's `unlock` gate — `spawnPlacement` has no equivalent of the `buildBlockedReason` check `requestBuild` makes — **and that is a feature, decided 4 Oct (lead, G3 Q5): the issued force is the brigade's to lend.** A placement may field a unit whose gate is closed; it is on loan for that mission and returns afterwards (its mark on the unit card, selection chip and Field order card lands with WP-S-F #184). Gates govern what you build and what you upgrade to. Restraint shapes the issued force through `upgrades_to` and `gate_only`. Missions rely on this: Wadi Halam V hands out a `dozer_d9` (Conduct floor 87) and a `demo_squad` (77) unconditionally, and Wadi Halam I–V all field a `recon_drone` (70) or an `ifv_namer` (85) a fresh campaign has not earned (floors read off `data/units/kdf/*.json` `unlock.roe_rating_min`, 15 Oct; the 60 / 50 / 35 / 40 this paragraph carried predated the Conduct re-floor). Resolving it the other way would silently strip Wadi Halam V of both demolishers, so the `seconds` deadline on its `raze` primary is what keeps that a lost mission rather than a stuck one. "On loan" is a predicate, not a field: `loanedPlacements` (`packages/sim/src/unlock.ts`) names the placements whose gate, as resolved for this ledger (a bought unit counts as open), is still closed AFTER `resolveUpgrades`; a `from_ledger` placement, and a `gate_only` placement dropped by a closed gate, are never on loan. The app and the harness pass the answer in as `MissionContext.loaned`, and `MissionRuntime.isOnLoan` remembers it. **L-1: a loaned survivor goes back to the lender** — `checkEnd` skips its `roster.surviving_units` write, so it is never enlisted, slotted, named, counted by `ROSTER_CAP` or memorialised. Measured at landing: `ROSTER_MAX` 33 -> 29 (Tel Marum III's lent bodies stopped carrying into Qarn Hadid and Umm Zeitoun; the drone Wadi Halam I lends stopped carrying into II–V); `LADDER_CREDITS` and `CAMPAIGN_CREDITS` stayed 5940 and no outcome moved. A loaned carrier's authored `passengers` are separate placements and are not on loan with it. **"The brigade does not keep what it was lent" holds for `starting_force` only: open question for the lead (F3 final review, C-R12): a gated unit that arrives by a `reinforce` trigger is judged by nobody -- D5 covers `starting_force` only -- and so is kept; today the only shipped case is `wadi_halam_5_depot`'s `the_second_engineer_team_comes_up` (75 s timer), a second `demo_squad` behind the same Conduct 77 gate as the loaned starting one -- under 77 the starting one goes back (L-1) and the reinforced one joins the roster for good. No behaviour change; the lead decides.** The motivation layer's `upgrades_to` is the sanctioned way to shape the issued force: `resolveUpgrades` (`packages/sim/src/unlock.ts`) checks a placement's gate once, before the runtime is built, and upgrades it rather than blocking it, so the spawner itself stays exactly as gate-blind as above and Wadi Halam V's D9 stays on loan. A placement can also set `gate_only: true` beside `upgrades_to`, asking `resolveUpgrades` to DROP it while the gate is closed instead of fielding the base unit — `qarn_hadid_3_clearance`'s `jeep_shoded` only, since a 2026-09-14 ladder measured that closed-gate body as a net negative for a realistic player (naive win rate 66.7% with it vs 90.0% without over 30 seeds; sensible 46.7% vs 66.7%), unlike the other five `upgrades_to` sites. A bought unit (`unlock.price`, brigade account) counts as an open gate for `resolveUpgrades` and for the loan predicate too — `bought` is resolved by `kdfUnlockGate` from the account and is never authored.
- `mission.schema.json`'s wave `from` promises "Spawn point or tunnel id. Tunnels
  keep producing until located and collapsed", but `mission.ts:1307` resolves `from`
  through `markerPos` only — a tunnel id there is an unknown marker. Tunnel-sourced
  reinforcement waves do not exist. Beit Sahwan IV works around it with `in_tunnel`
  garrisons that vent, which is the loop the subsystem was built around; the schema
  text should either be corrected or the feature built.
- `intel.marked_positions` cannot pre-reveal a tunnel route, and after the
  subsystem's playtest it should not: it reveals units by tag (`mission.ts:942`),
  exempts buried placements deliberately, and tunnel visibility is live — a route is
  identified only while a `mark_tunnel` carrier holds a sight line, so anything
  revealed at t=0 decays to unknown unwatched. GDD §4's "thorough recon → tunnel
  mouths pre-marked" is therefore not literal, and Beit Sahwan IV honours the
  contract through the surface ambushers instead.
- `tools/src/backtest/playtest.ts` was crashing on `main` from `d46b926` until
  `b604032` and nobody noticed. Its `run()` never registered the map's tunnels with
  the `Sim`, so the moment Beit Sahwan II gained a `digs`/`in_tunnel` placement the
  whole chain died at that mission with `unknown tunnel "bs_tn_west"`, taking every
  mission below it with it. The gate was then a manual `npx tsx` script wired into
  neither `pnpm test` nor CI, which is why "all gates green" could be said truthfully
  about the tunnel subsystem while this one was red. **It is wired now** (`c05de3c`,
  `pnpm playtest` in ci.yml's `gates` job), so that particular silence cannot recur. Two consequences outlived the fix and have
  SINCE BEEN RESOLVED (see below): `beit_sahwan_breach (passive control)` returned
  VICTORY where its own comment demands DEFEAT, and `beit_sahwan_3_clearance` returned
  DEFEAT. Neither was a tunnel-era regression — checking out `066445f` (main before any tunnel code) and
  running the harness there reproduces both failures byte-identically, so the crash
  merely hid `beit_sahwan_3_clearance` for about two days, no more.
  Both are now fixed. The clearance mission lost 55 of
  its 61 points to eleven deductions for firing into the clinic -- 107 rounds of the
  Namers' `cannon_30`, which arms the zone penalty at `collateral_risk >= 0.3` where
  rifles, `coax_mg` and the Eitan's `rws_50` do not; the plan was careless, not the
  floor, and keeping the armour off the zone takes it to ROE 94. First Light's control
  did NOT fail because the mission had gone soft: scaling the waves from 36 attackers
  to 131 walked the passive run's survivors from 9 to 2 and no further while killing
  the scripted plan outright, because `survive_until` completes if anything is alive
  and sitting still is the correct answer to a siege. `3122340` had dropped
  `evac_settlements` -- the only objective requiring anyone to leave the compound --
  while leaving all eleven civilians on the map; restoring it as a primary
  (`checkEnd` reads only primaries, and `evacuate_before` is the one type that can
  reach 'failed') makes passivity lose again. **`playtest.ts` now exits 0, and it is
  wired into CI** — `pnpm playtest` in ci.yml's `gates` job since `c05de3c`. It runs
  in **4.07s** measured (no browser, no GPU, no Blender), which is why it sits on
  every push next to `pnpm balance` rather than behind a schedule the way
  golden-diff does. Not in `pnpm test`: it is a CLI harness that prints a table, not
  a vitest spec, and `pnpm test` (18.65s, 2012 specs) stays the fast inner loop.
  **What it can and cannot fail on, measured 2026-09-01.** Falsified by hand:
  setting `beit_sahwan_3_clearance`'s `take_town` hold from 20s to 1500s pushes the
  run past the harness's own 20-minute ceiling and it goes red —
  `beit_sahwan_3_clearance: FAILED — expected VICTORY, got ONGOING`, exit 1.
  But the same break at 900s took that mission from **2.5 min to 17.2 min — a 7x
  blowout, 3.4x its own `target_minutes` — and the gate stayed GREEN, exit 0.**
  The assertion is `result === expect` and nothing else, so the only duration
  failure it can express is "did not finish inside 20 minutes". A mission can
  degrade several-fold and CI will not notice. Closing that means giving the
  harness a per-mission duration ceiling, which is a design call, not a tidy-up —
  see the next bullet for why tying it to `target_minutes` is the wrong shape.
- A scripted plan in `playtest.ts` proves a mission WINNABLE; it does not measure how
  long the mission takes. The plans are optimal-play proofs, and tuning enemy volume
  until the scripted clock reaches `target_minutes` would produce missions no real
  player could finish. **Re-measured across all thirteen plans (GH-84, 2026-09-01);
  the "eight of nine, band 0.51–1.00" reading this bullet used to carry is retired.**
  It predated Tel Marum and had silently omitted `beit_sahwan_3_clearance`, and worse,
  it pooled two populations that do not belong in one band. What separates them is
  whether a primary makes the player ENDURE a clock. A `hold_for` or `survive_until`
  `seconds` is a floor on mission length; a `raze`, `collapse` or `evacuate_before`
  `seconds` is the opposite — a deadline, a ceiling on the allowance — so it does not
  set length and does not belong in this split.
  The seven missions with an endure-clock all land **0.70–1.00 of target, and 0.0–2.1
  minutes above their own floor**: `beit_sahwan_breach` 1.00 (floor 5.0, plan +0.0),
  `wadi_halam_3_counterraid` 0.93 (+0.6), `beit_sahwan_2_foothold` 0.87 (+1.1),
  `wadi_halam_5_depot` 0.87 (+2.1, the extra being the raze that precedes the hold),
  `wadi_halam_1_fords` 0.80 (+0.8), `wadi_halam_2_laager` 0.80 (+0.6),
  `tel_marum_2_foothold` 0.70 (+0.2). The plan does not beat these missions quickly —
  it runs the timer out and leaves. That is why the ratio is informative there, and why
  it tracks a real player: it is the same clock for both.
  The other six have no endure-clock and scatter 0.10–0.87 — `wadi_halam_4_village`
  0.87, `tel_marum_3_clearance` 0.50, `beit_sahwan_3_clearance` 0.36,
  `beit_sahwan_4_subterranean` 0.22, `tel_marum_1_recon` 0.13, `beit_sahwan_1_recon`
  0.10 — because each plan *hardcodes the answer the mission is about*. The recon plans
  fly the drone to the six positions by waypoint; IV drives a `mark_tunnel` carrier
  straight at a route it is not supposed to know; the clearance plans go straight to the
  HVT. The plan holds perfect information and the player does not, so its clock is a
  floor with the puzzle removed. **A low ratio on one of these six is not evidence of
  anything and must not be tuned against.** `wadi_halam_4_village` at 0.87 is why the
  scatter is scatter and not a second band: a search mission is not *required* to read
  low, so a high one is not reassurance either.
  What has NOT changed: stepping the real runtime and reading
  `runtime.result` and `objectiveList` is still the only instrument that measures
  duration at all, there is still nothing headless between the optimal-play proof and
  a fully-passive walk, and therefore **no real-player duration has ever been measured
  for any mission** — every `target_minutes` in the tree is design intent that survived
  a floor check, including Beit Sahwan IV's 6.
  One consequence of the 5–7 ceiling worth knowing before authoring: `target_minutes`
  cannot express a sequential-timer worst case. `wadi_halam_5_depot` gates `raze` at
  300s and then holds for 240s *after* it comes down — a 9-minute mechanical ceiling
  behind a declaration of 7, which the optimal plan reaches in 6.1 only because it
  razes fast.
- The elevation milestone (E1–E3) closed with three things left inert, dormant only
  because every shipped map was flat and each first reachable the moment a map
  authored relief. **`raySmoke` is no longer one of them.** A screen is now a column
  `SMOKE_RISE` levels tall standing on its OWN tile's ground, tested with `losRay`'s
  own cross-multiplied comparison, so a line passing above the plume is not obscured
  by it: on Tel Marum an observer on the western shoulder (20,16) now sees the bench
  at (24,26) across five tiles of screen his sight line clears by more than a level,
  while the same screen still stops a line drawn along the basin floor dead. Two
  things about it are load-bearing and neither is obvious. **`SMOKE_RISE` (2) MUST
  stay strictly above `EYE_HEIGHT`**, the mirror of the `EYE_HEIGHT < BLOCK_RISE`
  coupling: on flat ground the sight line sits at exactly `EYE_HEIGHT` above every
  tile, so a shorter plume never reaches it and smoke goes inert on every shipped map
  at once (falsified by hand — at 1, four pre-existing flat-ground smoke tests go
  red). And it equals `BLOCK_RISE` deliberately, so the authoring rule is the terrain
  sentence again: **smoke obscures what a building obscures, from the same places**,
  and high ground that sees over the rooftops sees over the smoke. Taller would make
  smoke a better wall than a wall. The fix is bit-identical on flat ground by
  construction, which is why **no golden hash moved and neither did `pnpm balance` or
  `playtest.ts`** — and that silence is not a blind test: the golden replay lays no
  smoke, and **no shipped mission or playtest plan lays any either**, since `smoke` is
  reachable only from the player's UI. The replay guard for smoke over non-uniform
  relief therefore lives in `smoke.test.ts`, not in `determinism.test.ts`. One clause
  of the old bullet was never reproducible and is retired rather than fixed: “smoke
  sitting on a peak will not blanket the valley below” described nothing the code did
  — the height-blind version was uniformly OVER-permissive, so every behavioural
  change from this fix is smoke ceasing to block, never starting to. `raySmoke` still
  runs before `losRay`'s loop, and that is harmless: a ray terrain blocks returns -1
  either way. Pinned by `packages/sim/src/smoke.test.ts` (`smoke and elevation`) and
  `tools/src/tel_marum_smoke.test.ts`, which also pins the map elevations it argues
  from — (24,26) reads as plain basin by eye and is two levels up.
  **The other two were walked on 2026-09-01 and neither survives.** "VFX are
  not lifted to terrain height" and its wreck/tracer sorting gap were Pixi-only:
  in `three` trails, fx, fx-above and wrecks are all lifted to their own tile's
  ground height, photographed correct at Tel Marum's steepest drop. (The Pixi
  half went with that backend in WP-A3.3.)
  **"Extruded terrain cannot occlude units" is backwards for `three`.** It occludes
  them through the real depth buffer, decisively — up to 85% of an infantryman.
  More usefully: the occluded-unit silhouette (band 6) **already covers terrain,
  unmodified**. It fires on every terrain-occluded tile above its ~10% threshold and
  on none of the 126 unoccluded tiles sampled. There is nothing to extend, and a
  design that set out to extend it would be rebuilding something that works.
  Picking mid-slope was separately measured working. E3's cut scope
  is the only part of that original list still standing, and slope cost has since
  shipped (T1-A).
  **One real defect came out of that walk. It is fixed, and the fix is worth
  knowing about because it could not be one number.** A unit standing in Tel Marum's
  boulder field was 48–79% hidden by the boulder decor and got no silhouette at all
  — infantry taking cover in boulders became genuinely invisible, which is worse
  than the building case the feature was built for. The cause was the depth bias,
  as reported (draw order was tested and falsified). The bias, a constant 0.75
  world units, had been sized for the FILL era's (now retired) billboard
  artefact and never resized: it is larger than the **0.612** of depth a single-axis neighbouring tile
  is worth, so it swallowed every occluder nearer than about a tile and a quarter —
  a boulder sharing a unit's own tile included. Across `tel_marum`'s 1550 open
  tiles, **ten** hid 25–73% of a rifleman and outlined none of it; all ten were in
  the boulder field.
  **The mesh silhouette's bias is `2.5 x silhouetteOutlineWorldWidth(zoom)`,**
  retuned per frame: the artefact it guards is the outline ring, a fixed number
  of SCREEN pixels, so 7x wider in world units at zoom 0.35 than at 2.5; the
  multiple is 2 by derivation (this camera's 30-degree pitch means a ring
  fragment `d` below the feet sits over ground `2d` nearer) plus a measured
  margin. The billboard path kept the 0.75 constant for its ground-clipped
  quad, and drew 75-432 false px along a billboard Lavi's hull base on open
  ground -- a recorded pre-existing defect retired with that path in WP-A3.3,
  not fixed. See `.superpowers/queue/boulder-silhouette-report.md`.
- Tel Marum's narrow saddle is **closed to armour and still the cheaper road on foot**, and
  what priced the armour half was terrain rather than fire. The corridor at x=10-11, y=12-17 is a boulder field (`b`) now, with a
  small scree apron on the valley floor at its mouth (x=9-12, y=18): open ground on foot, a
  wall to anything wheeled or tracked. Measured through the real `FlowField` on the shipped
  map, crossing the wall there costs a rifleman **8 tiles** before and after, and a vehicle
  **8 -> 28**, because the only remaining gap in the wall is the guarded wide saddle. The
  whole flank route start line -> corridor -> battery is **48 tiles on foot** against 38
  through the pass, and **no route at all** for armour. The shortest route to the battery is
  **38 for both domains, unchanged** -- the mission's own axis was deliberately not touched,
  and if that number ever moves the field has leaked onto it. Committing the whole force to
  one route is therefore structurally impossible: the split the design always wanted is
  enforced by the ground instead of hoped for.
  Two figures this bullet used to carry were wrong and are corrected. The flank is **+10
  tiles (38 vs 48)**, not +9 (38 vs 47) -- measured five ways, every waypoint through the
  corridor gives 48; `tel_marum_3_clearance`'s briefing said nine and now says ten. And
  **no sight fact moved**, because `b` is deliberately not sight-blocking: every `sees()`
  assertion in `tools/src/tel_marum_doctrine.test.ts` passed unchanged when the field
  landed. `pnpm balance`, the golden determinism hash and all nineteen `playtest.ts` lines
  are identical before and after -- no shipped plan ever drove a vehicle up the corridor
  (mission I's drone is `domain: air` and flies over boulders), so the field costs the
  optimal-play proofs nothing and closes an exploit they never used.
  The fire-based half was settled once, and group formations unsettled it. Measured over
  ten seeds with the armour's orders held byte-identical in both arms and only the foot's
  route changed (`tools/src/backtest/saddle-price.ts`), **on `fc0fc13e` (2026-09-30):
  through the pass 3.80 losses a run (9/10 wins), up the corridor 3.10 (10/10), on a
  4.6-minute clock.** The corridor's dead are infantry now -- over ten seeds `inf_squad` x20,
  `at_team` x3 and `mortar_team` x1, plus seven `apc_eitan` -- so "the corridor kills nobody
  on foot", which this bullet used to say, is retired. Walked commit by commit from
  `a32f31ad`, where the probe was written and read **1.20 / 0.30 on a 3.54-minute clock**,
  exactly two commits move it. `708690c7` (Tel Marum III's `get_the_block_out` evacuation
  primary) takes the pass to 1.30 and the clock to 4.6 min: the probe escorts nobody, so
  every run now waits on that primary's timer, and the three new civilians shift entity ids.
  **`1ea1094a` (a group order lands in formation) does the rest -- 1.30 -> 3.80 and
  0.30 -> 3.10 -- and nothing since has moved either number.** Putting `exact: true` on every
  order in the probe reads 1.30 / 0.30 on `fc0fc13e`, so the whole move is formation
  slotting and not a unit, tuning or map change.
  What formations changed is the POSTURE, not the fire. The foot's one order to [10,12]
  used to stack all five units on the corridor's north exit row, the one row
  `tm_spotter_narrow` sees: together they shot it off its hill at 57-65 s in seven seeds of
  ten, and the Grad never had a corridor target. A formation order files them down the
  two-tile slot as a column (y 12-15), so only the lead squad on the exit row sees the
  spotter, it loses that duel alone at ~60 s, and the spotter lives to 155-162 s -- long
  enough for the Grad's rounds at t=111 and t=141 to land in the column. Slotting only the
  armour (the foot's orders `exact`) leaves the corridor with no infantry dead at all (0.70
  a run, every one an Eitan, lost to the armour's own slotting). So **the authored answer
  works now** -- let the Grad at `battery_position` charge for the corridor, since it reaches
  it at 17 tiles and `rocket` is in `INDIRECT_MASK` (`sim.ts:244`) so it needs no sight of
  its own, while `selectTarget` (`sim.ts:2887`) gates each shot on **per-side**
  identification -- because a group order now leaves a player's column where the one
  spotter can call rounds onto it. Whether 3.10 against the pass's 3.80 is the price the
  design wanted is a balance call nobody has made. Before formations it did not work, and
  **`selectTarget` was not why.** That was the recorded leading explanation and it was
  disproved: hand the Sarim side contact and the
  battery shells the man in the corridor on its very next reload, three rounds in two
  minutes, every time. Its rule is `hurts` first and then nearest, so a flanker is not
  immune, only LAST IN THE QUEUE -- with a decoy at [24,13] the battery spends three rockets
  killing that and turns west on the fourth. Both halves are pinned as behaviour, not prose,
  in `tel_marum_doctrine.test.ts`.
  The observer geometry still stands, because it is terrain. **Every post that can see the
  corridor stands inside the corridor's own weapons.** The only sightlines into a straight
  slot in a rock wall run along its axis, so distance along that axis IS the standoff: at
  `sarim_rifles`' sight 9 the best standoff for seeing even ONE of the twelve corridor tiles
  is 9.0 and for ten of them 4.0, against an 8-tile rifle and `at_team`'s 9-tile Spike.
  `tm_spotter_narrow` at [12,4] sees **2 of 12** -- the north exit row and nothing below it,
  exactly as its briefing says -- and `manpad_team`, the roster's best standing eye at sight
  12, buys only 9.2 tiles of standoff for half the corridor. What that geometry COSTS has
  inverted. Before formations every observer variant read 0.30 and the conclusion was "do
  not add a spotter". On `fc0fc13e` the probe's own sweep reads: shipped rifleman 3.10;
  moved to the best sight-9 post ([11,8], 10 of 12) **0.70**; `manpad_team` at [8,3] (6 of
  12, 9.2 standoff) **4.90**; `manpad_team` at [10,6] (12 of 12, 6.0) **0.70**. An eye that
  sees MORE of the corridor draws the whole column's fire and dies early; the shipped one
  sees only the exit row, fights one squad at a time, and lives. And the probe's
  `perfect eyes` row is **no longer a ceiling** -- it reads 2.60 up the corridor, BELOW the
  shipped spotter's 3.10 (the pass is unchanged at 3.80) -- so read nothing off it until
  someone works out why more contact now costs the player less. The pre-formation
  conclusions it supported (the Grad's `rof_per_min: 2` as the binding constraint; a spotter
  as the wrong tool; "closing it needs something that SHOOTS the corridor") are retired with
  it. One part stands: a trigger cannot reveal a unit -- the schema's `do` vocabulary is
  commit/withdraw_to/spawn/reinforce/dismount -- so a scripted reveal would take
  `mission.ts`.
  Two sight facts stand unchanged: **nothing north of the wall can see the hollow** -- 841
  open tiles see [24,29] and not one is at y <= 17, so the hollow is dead ground twice over
  -- and the corridor is **not** watchable from its own mouth at [8,9]. Both were drawn
  wrong by eye first. `tools/src/tel_marum_doctrine.test.ts` pins all of it, the per-domain
  routes included, each one paired against the same map with the boulders turned back into
  '.' so that "the vehicle went round" cannot pass for the wrong reason.
  Three traps for anyone re-running this. Isolating a unit by removing its garrison entry
  corrupts every later unit's RNG stream -- kill it at t=0 with `debugKill` (`applyDamage`
  is private), or mutate the entry in place at the same array index, which leaves entity ids
  and streams untouched. Rerouting only `mbt_lavi` or only `ifv_namer` reproduces the wide
  result exactly, because either wins the pass fight alone. And the earlier "wide 3.5 /
  narrow 5.2 / narrow-with-the-spotter-dead 5.1" reading is retired: those runs held the
  flank at a waypoint until t=130 s, some 90 s later than a direct order puts it in the
  corridor, so they measured the halt and not the route.
