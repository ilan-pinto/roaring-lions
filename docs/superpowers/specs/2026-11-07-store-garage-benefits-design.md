# GH-1076 and GH-1077: what a unit adds before you buy it, and upgrading a bought unit (design)

**2026-11-07** · status: design for the lead's approval, nothing built · base `origin/main` `4cdac8fdc` ·
issues GH-1076 (Store: show what a unit adds) and GH-1077 (Garage: upgrade a store-bought unit with
credits), both queued by the lead on 6 Nov, no comments yet · related GH-317 (Stores, wallet), PR 1064
(Buy with credits), GH-709 (the nine special units), E5 (`2026-09-29-e5-special-forces-design.md`).

**No sim change.** Every number the new panel prints is read from unit JSON through `@lions/data`'s
`readPath`, or from `unitTypeFromJson` (an existing public `@lions/sim` export, read-only), or from a
generated presentation table (§1.4). The new upgrade tracks go through `applyUpgrades` in
`upgradePrepass` before `addUnitType`, as every track does today. Section 3 lists every file that changes.

## 0. What reading the code found

1. **The empty Garage grid in the lead's screenshot is a data gap, not a payment gap.** The Garage draws
   whatever tracks the unit's JSON declares (`brigade.ts`, `renderBay`: `u.upgrades`). Nine of the twelve
   bought-only units declare none: `mbt_lavi_camo`, `spg_long_range` (the Te'o Howitzer in the
   screenshot), `spg_cluster`, `at_nlos_team`, `veh_ambulance`, `air_medevac_heli`, `inf_medic_squad`,
   `inf_grenadier`, `ugv_recon_dog`. That was ruled on 22 Oct (special-units spec, Q1, which took
   recommendation §6.1 "ship no upgrade tracks on the eleven in v1"). The other three bought-only
   units (`recon_zikit`, `demo_tzav`, `heli_peten_gunship`, all E5) already carry tracks, and they
   already upgrade in the Garage with credits and in the Stores with coins, whether the unit was bought
   with credits or with coins. Nothing in code treats a bought unit differently. So GH-1077 is mostly
   about authoring tracks, and that reverses a lead ruling (decision D1).
2. **A real defect: credits cannot continue a track that coins started.** The Garage asks for tier
   `max(earned, coins) + 1` (it reads `accountView`'s single-player tiers), but `buyUpgrade` accepts
   only `earned + 1`. On a track where coins bought tier 1 and credits bought nothing, the Garage shows
   an enabled "Buy tier 2" button, the account refuses it, and the screen redraws with nothing bought
   (`landed: false`). This affects any unit with tracks today, not only bought units.
3. **The Stores sells tiers for coins only.** PR 1064 put "Buy with credits" on unit cards and not on
   tier rows.
4. **The campaign enemy has no armour.** Every Sarim, Ashwar and Rif unit is soft (front armour at most
   15 mm). Any KDF weapon hurts every enemy. So a "what it counters" line computed from penetration would
   say "everything" for every unit. The useful half is the other direction: which enemies can hurt this
   unit. §1.2 computes counters from capabilities, and "countered by" from a threat table.

---

## 1. GH-1076: the "What it adds" panel

### 1.1 Where it lives

The Stores cards stay as the lead decluttered them on 2 Oct: portrait, name, one price line, the short
earned-path line, the Buy buttons. Each unit card gets one more control, **"What it adds"**
(`data-focus="adds:<id>"`, `aria-expanded`, `aria-controls`). Pressing it opens **one** panel inside the
Stores root, under that card's grid row. Opening another card's panel closes the first. The panel is a
`role="region"` labelled with the unit's name. Focus moves to its heading, and closing it returns focus
to the control.

The panel carries no Buy of its own. The card's Buy stays the one control, so `buyEnabled` and
`creditBuyEnabled` remain the only predicates, and focus restore after a purchase keeps its keys. The
panel is rebuilt by every Stores redraw: the brigade it compares against may have just changed. The
open card id goes through `StoresOptions` like `shelf` and `showOwned` already do (`adds?`, `onAdds?`).

Disposer contract: everything mounts inside `host` and is removed by the Stores' disposer. No `document`
or `window` listener is needed. Preview mode (no durable storage) draws the panel too. It reads no
wallet, so there is nothing to disable.

### 1.2 What it shows, block by block

Every line comes from one pure function, `unitAdds(input)` in a new
`packages/app/src/ui/stores-adds.ts`. It returns discriminated values, as `Honest` does today, and the
screen turns each one into a `t()` sentence. No line is keyed by unit id, and no English sits in the model.

**Input.** The candidate unit's JSON; every KDF unit's JSON; the open set, which is the single-player
view (`accountView`: earned gate open, bought with credits, or bought with coins) minus `wounded_kdf`;
the owned tiers; the ledger; the missions and `data/campaign/world.json`; the KDF doctrine menu
(`data/doctrines/kdf.json`) and `VERSUS_HELD_UNITS`; and the threat table (§1.4).

The blocks, in the order they draw:

**A. Role.** `roleLabel(role)` beside the role mark (`roleBadgeSvg(roleBucket(...))`, as in the Garage),
then one sentence from `role.<role>.purpose`. There are fourteen new keys, one per role in `ROLE_KEYS`,
for example `role.artillery.purpose`: "Fires on what others can see, from beyond their reach". This is
role copy, written once per role and never per unit (the issue's own rule). `role.test.ts` already pins
every shipped role against `ROLE_KEYS`. The new test (§4, T2) extends that pin to `.purpose`.

**B. Brings (strengths).** A capability tag shows when its predicate holds on the unit. Every predicate
reads `unitTypeFromJson(json)`, the sim's own resolution of defaults, or a JSON field, never a list of
ids. The table order is the priority: the panel shows the first four tags that hold, then "+N more" on
a toggle.

| tag | predicate (data) | en.json key |
|---|---|---|
| `heal` | `aura.area[]` has an entry with `heal_per_s > 0` | `stores.adds.tag.heal` "Heals troops near it" |
| `rescue` | `rescue` block present | `…rescue` "Recovers the wounded" |
| `evacuate` | `hull.can_carry` includes `wounded` | `…evacuate` "Carries the wounded" |
| `transport` | `isMountCarrier(type)` (role.ts) | `…transport` "Carries {n} teams" |
| `markTunnel` | `type.canMarkTunnel` | `…markTunnel` "Finds tunnel routes" |
| `markTarget` | `type.canMarkTarget` | `…markTarget` "Marks targets for others" |
| `indirect` | any `weapons[i]` with `isIndirect` | `…indirect` "Fires beyond its own sight" |
| `area` | any weapon `splash` > 0 or `submunitions` | `…area` "Area fire" |
| `coverIgnore` | any weapon `coverIgnore` > 0 | `…coverIgnore` "Digs men out of cover" |
| `beam` | any weapon `beam` | `…beam` "Burns drones out of the air" |
| `structure` | any weapon `can_target` includes `structure` | `…structure` "Hits buildings" |
| `demolish` | `type.canDemolish` | `…demolish` "Demolishes buildings" |
| `construct` | `type.canConstruct` or `type.canRepair` | `…construct` "Builds and repairs works" |
| `smoke` | `type.canSmoke` | `…smoke` "Lays smoke" |
| `garrison` | `type.canGarrison` | `…garrison` "Fights from buildings" |
| `thermal` | `type.thermal` | `…thermal` "Thermal sight" |
| `crush` | `mobility.can_crush` | `…crush` "Crushes obstacles" |
| `engagesAir` | any weapon `canTargetAir` | `…engagesAir` "Can fire at aircraft" |
| `flies` | `type.isAir` | `…flies` "Flies over walls and boulders" |

**C. Watch for (weaknesses, and who can hurt it).** These tags work the same way, also capped at four:

| tag | predicate | key |
|---|---|---|
| `soft` | `type.isSoft` | `stores.adds.weak.soft` "Soft: rifles and machine guns hurt it" |
| `unarmed` | `weapons` empty | `…unarmed` "Unarmed: escort it" |
| `minRange` | any weapon `min_range_tiles` > 0, shown as the largest | `…minRange` "Cannot fire inside {n} tiles" |
| `needsSpotter` | `sensors.sight_tiles` < the longest weapon `range_tiles` | `…needsSpotter` "Sees {sight} of its {range} tiles: needs a spotter" |
| `groundBound` | `type.wheeled` and not `type.isAir` | `…groundBound` "Boulders, ditches and marsh stop it" |
| `conduct` | any weapon `collateral_risk` ≥ `HEAVY_COLLATERAL` (0.5) | `…conduct` "Costs Conduct near civilians" |

`wheeled` comes from `unitTypeFromJson` on purpose. CLAUDE.md warns that `FOOT_ROLES` alone is wrong
both ways (the D9 and the rocket battery). `HEAVY_COLLATERAL` is private to `mission.ts`, so the app keeps
a copy, pinned to the source text by a test (§4, T4). That is the precedent `PROJ_SPEED` set in
`units/missiles.ts`, and it avoids a sim export.

**Hurt by** follows the tags. If the unit is `soft`, the `soft` tag says all there is to say and no list
follows. Otherwise the panel lists the armed, non-`wounded` enemy types the threat table (§1.4) says can hurt it, grouped by
their role label, at most three groups and then "+N more". It also lists the types that cannot hurt it,
under "Shrugs off".

**D. Against your closest unit.** The unit it is compared with is chosen from the open set, excluding the
candidate itself:
1. the same `role`; failing that
2. the same `roleBucket`; failing that
3. nobody. The block then prints the candidate's own figures under "First of its kind".

Ties go to the smallest `|Δ cost.logistics|`, then to id order. The comparison unit is read **as it
stands**: `applyUpgrades(json, ownedTiers[id])`, the same reading as the Garage's comparison ghost
(GH-243, `ghostBar`). That is the unit the player would field. The candidate is read at its own owned
tiers. A unit can keep dormant tiers while locked (ruling L2), so this is usually tier 0.

There are five rows, each `readPath` on a fixed path. "Range" is the maximum over the unit's weapons.

| row | path | format |
|---|---|---|
| Range | `max(weapons[i].range_tiles)` | tiles |
| Front armour | `hull.armor.front` | mm, the Garage's `garage.stat.armourFront` |
| Hit points | `hull.hp` | `garage.stat.hp` |
| Speed | `mobility.speed_tiles_s` | tiles/s, new key |
| Sight | `sensors.sight_tiles` | `garage.stat.sight` |

Each row prints `candidate · other` and a signed difference. The difference uses `.rl-good` or `.rl-bad`
from the sign. It is never coloured for HP or armour against role: a bigger number is better in all five.
There are no bars. The Garage's bars scale against the roster maximum, and a five-row text table is
easier to read on a card-sized panel.

**E. The gap it fills.** This is the "before and after" the issue asks for. It is computed over the
**open set**, never the catalogue, and shows up to three lines in this order:
- `firstRole` "First {role} in your brigade" when no open unit has its `role`;
- `newTags` "New to your brigade: {tags}" for block B tags that no open unit has;
- `reach` "Longest reach in your brigade: {n} tiles (+{d})" when its range beats every open unit's;
- `plusOne` "+1 {role}: you have {name}" when none of the above holds. `name` is block D's unit.

**F. Where you can use it.**
- `dock`: "Can be called in on {n} campaign missions", where `n` counts the missions on the world map
  (`world.json`) that declare `resources`, the reinforcement dock. That is 20 of 29 today. A camp whose
  `production.roles` excludes the role does not count (GH-277).
- `fieldedAs`: "Replaces the {base} in {mission}" for each `starting_force` placement with
  `upgrades_to: <id>`.
- `loaned`: "On loan in {n} missions; bought, the survivors stay". This counts the placements
  `loanedPlacements`/`loanedReinforcements` mark for this unit under the current ledger, the sim's
  own L-1 predicate. Once the unit is bought, those placements are no longer loans.
- `versus`: "Also on the versus camp menu" when the id is in `kdf.json`'s `menu` and not in
  `VERSUS_HELD_UNITS`; otherwise "Campaign and free play only".
- `coinsSinglePlayer`: the existing "Bought with coins: single-player only" rule, said once here.

**G. Upgrades it can take.** "{tracks} tracks, {tiers} tiers: {credits} credits or {coins} coins to max".
`credits` is the sum of every tier's price. `coins` is the sum of each tier's `coinPrice`, never
`coinPrice` of the total. Each tier is sold on its own and rounds up on its own, so the honest total is
the sum (§4, T9). A unit with no tracks shows "No upgrades". The track names are `garage.track.<track>`.

### 1.3 Worked examples

Both examples assume a brigade that owns only the starting roster: Eitan APC, Spike AT Team, Rifle
Squad, Shoded Jeep and 60mm Mortar Team. Figures are read from today's JSON. The "Hurt by" lists use the
approximate rule `penetration ≥ hull.armor.side` (the sim's own `threatens` test, `sim.ts`). The generated
table in §1.4 replaces that rule.

**Te'o Howitzer (`spg_long_range`), 6,500 credits or 650 coins, special forces.**

| block | shows |
|---|---|
| A | artillery · "Fires on what others can see, from beyond their reach" |
| B | Fires beyond its own sight · Area fire · Hits buildings |
| C | Cannot fire inside 6 tiles · Sees 7 of its 28 tiles: needs a spotter · Boulders, ditches and marsh stop it · Costs Conduct near civilians. **Hurt by** AT teams (ATGM Cell, Recoilless Team, RPG Team), artillery (Mortar Crew, Rocket Battery), drones (Loitering Munition, Drone Swarm), +3 more. **Shrugs off** Militia Cell, Sarim Rifles, Armed Technical, Powered Parachute |
| D | against the **60mm Mortar Team** (same role): Range 28 · 18 (+10), Front armour 60 · 10 (+50), Hit points 1400 · 350 (+1050), Speed 0.9 · 0.65 (+0.25), Sight 7 · 7 (0) |
| E | "Longest reach in your brigade: 28 tiles (+10)". No new tag, because the mortar already brings all three. `plusOne` is not shown, because the reach line holds |
| F | Can be called in on 20 campaign missions · Campaign and free play only (in `VERSUS_HELD_UNITS`) |
| G | today: "No upgrades". After GH-1077's data (§2.2): "2 tracks, 6 tiers: 1,350 credits or 145 coins to max" |

**Nemala Medic Team (`inf_medic_squad`), 4,250 credits or 425 coins, special forces.**

| block | shows |
|---|---|
| A | support · role purpose sentence |
| B | Heals troops near it · Recovers the wounded · Carries the wounded · Lays smoke · +2 more (Fights from buildings, Can fire at aircraft) |
| C | Soft: rifles and machine guns hurt it. There is no Hurt-by list: it is soft |
| D | no open `support` unit. Its bucket is `soft`: the stretcher seat is wounded-only and the team can embark, so `roleBucket` falls through to soft. The open soft units are Rifle Squad (292), Spike AT Team (236) and 60mm Mortar Team (209), and the nearest in logistics to 295 is the **Rifle Squad**: Range 6 · 8 (−2), Front armour 10 · 10 (0), Hit points 360 · 400 (−40), Speed 0.95 · 0.9 (+0.05), Sight 8 · 8 (0) |
| E | "First support in your brigade" · "New to your brigade: heals troops near it, recovers the wounded, carries the wounded" |
| F | Can be called in on 20 campaign missions · "On loan in 29 missions; bought, the survivors stay" · Also on the versus camp menu |
| G | today: "No upgrades". After §2.2: "2 tracks, 6 tiers: 995 credits or 110 coins to max" |

### 1.4 The threat table ("Hurt by")

The sim's `focusHurts` is the right answer to "can that hurt this", but it needs a live `Sim`, and the
shell does not build one to draw a menu (`unlock.ts`'s own comment). The recommendation (decision D4)
is a **generated** table, made the way `ELLIPSE_BY_TYPE` is:
- `tools/src/store/threat-table.ts` (`pnpm store:threats`) builds one headless `Sim` per (enemy type, KDF
  type) pair: the enemy at side 1, the KDF unit at side 0 presenting its side face, four tiles apart,
  inside every enemy weapon's range. It records `focusHurts(enemy, kdf)`.
- It writes `packages/app/src/ui/generated/threat-table.json`:
  `{ "<kdfId>": ["<enemyId>", …] }`, sorted. The file is never hand-edited.
- `tools/src/store_threat_table.test.ts` regenerates the table and deep-equals it with the committed
  file, so a tuning or roster change that moves a cell goes red until it is regenerated.

The tool imports the sim, which `tools/` may do, and the app imports only the JSON. The sim is untouched.
If the lead prefers no generated file, the fallback is the `penetration ≥ side armour` rule above,
written in the app. It is cheaper, but it can drift from `weaponHurts` (it ignores P(pen), facing and
ERA), and CLAUDE.md's GH-420 rule against re-deriving "can it hurt that" applies in spirit.

### 1.5 Copy and colour

There are about 45 new `en.json` keys: `stores.adds.*`, `role.*.purpose` and one speed stat. Each is
resolved by `t()` at draw time, never at module load (the `ROLE_LABEL` getter rule). Enemy names are
unit JSON `name` values, which are data, as the Garage's blurb is. The CSS uses only semantic tokens
(`--ink`, `--panel-*`) and `.rl-good` and `.rl-bad`, so `validate:ui` passes with no allowlist.

---

## 2. GH-1077: upgrading a store-bought unit

### 2.1 What changes

1. **Data:** tracks for the nine bought-only units that have none (§2.2). After that, the Te'o Howitzer
   shows tiers in the Garage exactly as an earned unit does, through code that already exists.
2. **One payment rule for mixed tracks** (§2.3, R3), which fixes defect 2 in §0.
3. **"Buy with credits" on the Stores' tier rows**, beside the coin Buy. It is shown only when credits
   cover the ask, and it routes to the Garage's `onBuyUpgrade` path, as PR 1064 does for units.

### 2.2 Tracks for the nine

**Shape.** This is `upgrades.md` §3's shape: `armour` (hp and three faces), `sensors` (optics and sight)
and, for a unit whose primary weapon defines it, `firepower` (`weapons[0]` accuracy and penetration).
Three tiers each, cumulative over base.

**Price rule.** Tier price = `logistics × m`, rounded to the nearest 5 (halves to even). The multipliers
are armour 0.40 / 0.60 / 0.85, sensors 0.33 / 0.50 / 0.70 and firepower 0.50 / 0.75 / 1.05. This rule
was derived for this spec, and it reproduces **all 46** shipped tracks on the sixteen earned-gate and
starting units exactly. The only shipped tracks it does not fit are `attack_drone` (re-priced,
upgrades.md §7.4), `heli_yanshuf`, and E5's three, which carry their own prices (the Gunship at about
1.25×). The recommendation is the plain rule with no premium for bought units: the unit price already
carries the premium (4,000–8,000, "never cheaper than the dearest earned unit"). E5's three stay as
shipped.

**Deltas.** These are the generic curves (armour +7 / 15 / 25 % of base, sensors +8 / 15 / 25 % optics
and +1 / 2 / 3 sight, firepower +0.03 / 0.06 / 0.10 accuracy and +8 / 16 / 25 % penetration), with the
sibling exceptions `upgrades.md` §4 already measured:
- `mbt_lavi_camo` copies `mbt_lavi`'s three tracks verbatim. They share the hull and gun, and the Lavi's
  armour track was shrunk for the ATGM Pk target (§4.2).
- The foot teams (`inf_medic_squad`, `inf_grenadier`, `at_nlos_team`) take the rifle squad's foot pattern:
  faces +1 / 2 / 2, and sight +1 / 2 / 2 for the two rifle-armed teams (§4.3, the urban ratio).
  `at_nlos_team` firepower is `at_team`'s pattern on penetration 1000 (+80 / 160 / 250, accuracy +0.03 /
  0.06 / 0.07).
- `air_medevac_heli` armour is **front +0**, with the rest on sides and hp. That is the Gunship ruling
  (29 Sep): at front 40 a ZU-23 (penetration 40) stops penetrating, which erases "air is contested by
  AA".
- `ugv_recon_dog` armour is hp only, like `recon_drone`.
- **No firepower track** on `spg_long_range`: its probe Q11 already wins 30 of 30. None on `spg_cluster`
  either: penetration means nothing to bomblets, and the cluster's price is its Conduct cost. None on
  `inf_medic_squad`, nor on the three unarmed units.

| unit | logistics | tracks: tier prices (credits) | to max | coins to max |
|---|---|---|---|---|
| `mbt_lavi_camo` | 960 | armour 385 / 575 / 815; sensors 315 / 480 / 670; firepower 480 / 720 / 1010 | 5,450 | 570 |
| `spg_long_range` | 400 | armour 160 / 240 / 340; sensors 130 / 200 / 280 | 1,350 | 145 |
| `spg_cluster` | 400 | armour 160 / 240 / 340; sensors 130 / 200 / 280 | 1,350 | 145 |
| `at_nlos_team` | 265 | armour 105 / 160 / 225; sensors 85 / 130 / 185; firepower 130 / 200 / 280 | 1,500 | 170 |
| `veh_ambulance` | 540 | armour 215 / 325 / 460; sensors 180 / 270 / 380 | 1,830 | 200 |
| `air_medevac_heli` | 330 | armour 130 / 200 / 280; sensors 110 / 165 / 230 | 1,115 | 125 |
| `inf_medic_squad` | 295 | armour 120 / 175 / 250; sensors 95 / 150 / 205 | 995 | 110 |
| `inf_grenadier` | 320 | armour 130 / 190 / 270; sensors 105 / 160 / 225; firepower 160 / 240 / 335 | 1,815 | 205 |
| `ugv_recon_dog` | 190 | armour 75 / 115 / 160; sensors 65 / 95 / 135 | 645 | 80 |
| **total** | | | **16,050** | **1,750** |

The credit catalogue grows from 122,205 to 138,255, from 17.4 to 19.7 campaigns at
`CAMPAIGN_CREDITS` 7,007. Guard G1 still holds, because every price is reachable by play across
campaigns (GH-330).

**These are drafts, not fitted numbers.** The `balance-analyst` fits them before any JSON lands, against:
- `validate_balance.py --max-tier --upgrade-cost-factor 0.02`, ±18% (CI's job, both invocations);
- `pnpm balance` as a guard;
- `pnpm playtest`'s max-tier replay, which **exercises the medic in 29 missions**: every victory stays a
  victory and no star drops;
- `su:probes` re-run with each of the nine at max tier, which is report-only. A claim that flips is a
  stop for the lead, never a widened band.

**Art.** `tools/src/garage_closeups.test.ts` requires a close-up per (vehicle or aircraft, track). The
five non-rigged units add 11 close-ups: camo Lavi 3, and 2 each for the two howitzers, the ambulance and
the medevac. The pinned 36 / 13 become 47 / 18. They are engine renders (`pnpm closeups:garage`), with
no Meshy, but the house rule wants the lead's approval before any render (decision D2). Kit parts are
optional (`art/parts/kit/` covers eight vehicles today), and the rigged teams have no close-ups (WP-SC0).

### 2.3 Credits and coins: the rules

The two records stay as they are, so **no account or wallet schema change** is needed.
`lions.brigade.account` `upgrades[unit][track]` is the **earned** tier, paid in credits.
`lions.roar` `entitlements.upgrades[unit][track].tier` is the **coin** tier. Single-player plays
`max(earned, coins)`. Network play plays `earned` only (G2, `coin-claim.test.ts`).

- **R1. One ladder per track, whatever opened the unit.** Every tier has the price its JSON authors, in
  credits or `coinPrice(price)` in coins. It does not matter whether the unit was opened by play, by
  credits or by coins. A bought unit takes exactly the tiers and prices an earned unit would under the
  same rule (§2.2). There is no surcharge and no discount by payment path.
- **R2. Coins buy the next single-player tier.** This is `buyTierWithCoins`, unchanged: `current =
  max(earned, coins)`.
- **R3. Credits buy the next single-player tier, and fill the earned path below it.** A credit Buy on a
  track asks for the run of earned tiers from `earned + 1` up to a target `T`:
  - `T = max(earned, coins) + 1` while the track has a tier above the single-player tier, and the price
    is the sum of tiers `earned + 1 … T`. When `earned ≥ coins`, that is exactly today's one-tier buy.
  - When coins have already maxed the track and `earned < coins`, `T = coins`. The button reads
    "Count online · {price}", meaning the player pays credits to make the coin tiers count in network
    play.
  - The label always states the run. For example, on the howitzer's armour with coins at tier 2 and
    nothing earned: "Tier 3 · 740 credits (includes tiers 1–2 for online play)".
    The price is computed in one pure function, `creditAsk(unit, track, earned, coins)`, in a new
    `packages/app/src/upgrade-pay.ts`. The account gains `buyUpgradeRun(account, unit, track, from, to,
    price)`, which refuses unless `from === earned + 1` and `to ≥ from`, and sets `earned = to`.
    `buyUpgrade` stays, as the `from === to` case.

  Why not let credits buy only tier `T` and record `earned = T`? Because that hands tiers 1 to `T − 1`
  to network play for coins. Why not refuse credits on a coin-started track? Because that is the dead
  button the issue reports, and it makes coins a one-way door.
- **R4. A tier is never owned twice.** Neither path sells a tier at or below the single-player tier.
  The one exception is R3's explicit online catch-up, which buys the earned copy and says so.
- **R5. No refunds, resale or conversion.** Coins never become credits (G3), and nothing writes a coin
  receipt from credits. Coins spent on tiers that R3 later fills on the earned path are not returned.
  Play opening a gate later turns a coin-bought unit into an earned one with no refund (§1.6 of the coin
  spec). Tiers follow the same rule.
- **R6. Earning is untouched.** Credits come only from `payMission`'s improvement rule (campaign scope
  for an open mission, lifetime scope otherwise; the tutorial pays nothing because it produces no
  ledger) and from coupons, once per id. Coins come only from `roar-earn.ts` and coupons.

### 2.4 What stops credit farming

Nothing in this design adds a source of credits, so farming means a loop that spends and gets more back.
There is none:
- there is no refund or sell-back, so buy-then-sell cannot cycle;
- a tier purchase writes no grant and never moves `earned_total`. The test pins it (§4, T22);
- `creditsFor` counts the **starting force** only (ruling R4). A bought-only unit is in no starting force
  except as a loan, and its kit cannot raise the "units home" pay. Kit can make a win or a secondary
  easier, as it does for every earned unit. The playtest measured that at about +2% a campaign (5,736
  base against 5,859 at max tier, GH-330), and the improvement rule still caps each mission per
  campaign;
- coins never become credits (G3) and credits never become coins;
- a save slot snapshots the whole account, balance and tiers together (`profile.ts`), so loading one
  restores both and never returns the balance alone. The wallet is not in a slot, so coin tiers survive
  a slot load, which pays nothing;
- the reset clears the account, credit tiers included (`resetAccount`), and the free coin tiers
  (`resetFree`). One known loop, unchanged here: a reset makes a coupon redeemable again
  (`coupons.md`, accepted by the lead).

### 2.5 Reset and save

- **`lions.brigade.account`:** a bought unit's credit tiers live in `upgrades` beside every other unit's.
  No new field, and `ACCOUNT_VERSION` stays 2. `migrateUpgrades` already clamps to the JSON (data may
  shrink a track), and a unit that gains tracks reads tier 0.
- **Reset** (`resetAccount` plus `resetFree`): credit tiers go, free coin tiers go, and paid coin tiers
  stay. That is today's rule, with nothing new.
- **Save slots:** a slot restores the earned tiers it saved and leaves the wallet's coin tiers alone. A
  slot loaded from before R3 bought anything may read `earned < coins`. `max` handles that, and the
  credit Buy then offers R3's run. A slot from before the unit was bought keeps any credit tiers
  dormant (ruling L2). The Garage already draws those as kept and read-only.

---

## 3. Schema, data and code changes (and what does not change)

| area | change |
|---|---|
| `data/units/kdf/*.json` | `upgrades` blocks on the nine units (§2.2), after the balance fit. No schema change: `unit.schema.json`'s `upgrades` block and whitelist already cover every path used |
| `docs/campaign/economy/upgrades.md` | a §3 entry per new unit, plus the price rule as a stated formula |
| `assets/ui/garage/closeups/` | 11 JPEGs and their manifest entries (D2) |
| `packages/app/src/ui/generated/threat-table.json` | new, generated (D4) |
| `packages/app/src/i18n/en.json` | about 45 keys (§1.5) and the R3 labels |
| `packages/app/src/ui/stores-adds.ts` | new, pure (§1.2) |
| `packages/app/src/ui/stores.ts` | the "What it adds" control and panel; the tier-row credit Buy |
| `packages/app/src/upgrade-pay.ts` | new, pure: `creditAsk` (R3) |
| `packages/app/src/brigade-account.ts` | `buyUpgradeRun` |
| `packages/app/src/ui/garage-board.ts`, `brigade.ts`, `main.ts` | the Garage's credit Buy asks `creditAsk`, and the label shows the run |
| `packages/app/src/ui/theme.css` | panel styles, semantic tokens only |
| `tools/src/store/threat-table.ts` | new generator |

**The sim is untouched.** There are no edits under `packages/sim/`. `unitTypeFromJson` is an existing
export, and `HEAVY_COLLATERAL` is copied rather than exported. The determinism golden hash does not move.
The new tracks reach the sim only through `applyUpgrades` in `upgradePrepass`, as every track does, so
the sim never learns that a tier or a payment path exists. `LADDER_CREDITS` and `CAMPAIGN_CREDITS` do
not move, because no ladder plan buys kit. Only the playtest's report-only max-tier credit figure may
move.

---

## 4. Tests: each with the input that makes it fail

Each new check states the mutation that turns it red. The PR that builds it runs that mutation and puts
the red result in the commit message (CLAUDE.md, falsification). The oracles below are literals, never
values read from the code under test.

| # | test (file) | asserts | input that makes it fail |
|---|---|---|---|
| T1 | `stores-adds.test.ts` closest unit | the open starting roster against `spg_long_range` gives `mortar_team` (same role), and against `inf_medic_squad` gives `inf_squad` (bucket, nearest logistics) | swap steps 1 and 2 (bucket first): the howitzer's bucket is `armour`, which no starter shares, so it reads "first of its kind" |
| T2 | `role.test.ts` | every shipped KDF role has `role.<role>.purpose` | delete `role.artillery.purpose` |
| T3 | `stores-adds.test.ts` tags | for each tag, a literal fixture with the field gets it and the same fixture without the field does not; across the shipped roster every tag holds on at least one unit and not on all of them | turn `minRange`'s `> 0` into `>= 0`: every armed unit is tagged, and "not on all" goes red |
| T4 | `stores-adds.test.ts` collateral copy | the app's 0.5 equals `HEAVY_COLLATERAL` parsed from `mission.ts`'s source text (raw 32768) | set the copy to 0.4 |
| T5 | `store_threat_table.test.ts` | regenerating via the `Sim` deep-equals the committed JSON; literals: `sarim_rifles` is NOT in `mbt_lavi`'s list, `atgm_cell` IS | hand-edit one cell, or make the generator write every enemy (the rifles literal goes red) |
| T6 | `stores-adds.test.ts` gap | a starting-roster brigade: the medic reads `firstRole` and `newTags ⊇ {heal, rescue}`, the howitzer reads `reach` +10 | compute coverage over the whole KDF catalogue instead of the open set: the medic is no longer "first" |
| T7 | `stores-adds.test.ts` stats | the comparison unit at owned tiers: `mortar_team` with armour tier 2 shows hp 402 (literal) | read the comparison unit's base JSON (350) |
| T8 | `stores-adds.test.ts` where | fixture missions: the medic in two starting forces, one `from_ledger: true`, gives `loaned` 1; a mission without `resources` adds nothing to `dock` | drop the `from_ledger` filter (2), or count every mission |
| T9 | `stores-adds.test.ts` upgrades | `spg_long_range` after §2.2: 1,350 credits, **145** coins | `coinPrice(sum)` gives 135 |
| T10 | `stores.test.ts` panel | opening B closes A; `aria-expanded` follows; focus moves to the heading and back; the disposer leaves `host` empty; every visible panel string is bracketed under `?pseudo=1` | skip the close of the previous panel (two regions), or write one literal string into the panel |
| T11 | `pnpm validate:ui` | no colour literal in the new CSS or TS (existing gate) | add a hex literal to the panel CSS |
| T12 | `tools/src/bought_unit_tracks.test.ts` | every `isBoughtOnly` KDF unit declares at least two tracks, and the nine's prices equal the price rule (literal multipliers, halves to even), with the exemptions named: E5's three, `attack_drone`, `heli_yanshuf` | delete `spg_long_range`'s `upgrades`, or move one tier by 5 |
| T13 | `garage_closeups.test.ts` | plan length 47, 18 ids | ship the tracks without their JPEGs |
| T14 | `vehicle_health_bounds.test.ts` | `HARD_TYPES` stays 16, and no soft unit turns hard at top tier (the foot faces stay ≤ +2) | give `inf_medic_squad` front +20 at tier 3 |
| T15 | CI `validate_balance.py --max-tier` | every unit within ±18% | an absurd tier (`hull.hp` +5000 on the howitzer) |
| T16 | `pnpm playtest` max-tier replay | no victory lost, no star dropped, medic tracks included | a local-only weakening tier (medic `hull.hp` −300 at tier 3) must turn at least one replay red. If none goes red, the PR says the gate cannot see the medic, rather than claiming it |
| T17 | `upgrade-pay.test.ts` `creditAsk` | (earned 0, coins 0) gives tier 1 at its price; (0, 2, length 3) gives the run 1–3 at the sum; (0, 3) gives "count online" 1–3; (3, 3) gives null; (2, 0) gives tier 3 | compute `from` as `coins + 1`: case 2 prices tier 3 alone |
| T18 | `upgrade-pay.test.ts` G2 invariant | after any sequence of R2 and R3 purchases, credits spent on a track ≥ the sum of its earned tiers' prices, and `networkView` never exceeds `earned` | record `earned = T` while charging only tier `T` |
| T19 | `brigade.test.ts` mixed track | coins own armour tier 1 and earned owns 0: the Garage credit Buy lands (`landed: true`) and the account reads earned 2 | **today's `main`**: refused, `landed: false` (defect 2) |
| T20 | `stores.test.ts` tier credit Buy | shown only when credits cover the ask; never reads the wallet | read `wallet.coins` instead of credits: zero credits and plenty of coins shows the button |
| T21 | `brigade-account.test.ts`, `profile.test.ts` | `resetAccount` drops a bought unit's credit tiers; `resetFree` keeps paid coin tiers; a slot load restores earned tiers and leaves coin tiers | write the coin tiers into the slot snapshot |
| T22 | `brigade-account.test.ts` G3 | `buyUpgradeRun` writes no grant, `earned_total` does not move, and the balance falls by exactly the price | push a grant on purchase |
| T23 | `pnpm test:determinism` | the golden hash is unchanged | any edit under `packages/sim/` that moves state |

---

## 5. Out of scope

Kit parts for the new vehicle tracks (optional; the Lavi's L3 rules apply if they come). A "What it
adds" panel in the Garage bay (it already has the stat panel and comparison ghost). Tiers for enemy
factions. Versus seats for the held units. Real-money packs (`PURCHASES_OPEN` stays false).

---

## 6. Decisions for the lead

Each decision gives the recommendation first.

1. **D1. Give the nine bought-only units upgrade tracks.** This reverses the 22 Oct line "no tracks on
   the special units in v1". *Recommendation:* yes, by §2.2's shape and price rule, with no premium for
   bought units: +16,050 credits, the catalogue from 17.4 to 19.7 campaigns. The numbers are fitted by
   the balance analyst before they land. *Alternatives:* combat units only (drop the medic, the
   ambulance, the medevac and the dog: +11,465); or E5's roughly 1.25× premium.
2. **D2. Approve 11 garage close-up renders** (engine renders, no Meshy) for the five vehicle and
   aircraft units, so the tracks and the close-ups land in one PR as `garage_closeups.test.ts` requires.
   *Recommendation:* approve.
3. **D3. Mixed tracks: credits fill the earned path below the tier they buy** (R3), with one button
   whose label states the run. *Recommendation:* R3. *Alternative:* refuse credits on a track coins
   started. That is simpler, but it keeps the dead end GH-1077 reports. Letting credits buy only the top
   tier is rejected, because it leaks coin tiers into network play (G2).
4. **D4. Source "Hurt by" from a table generated by the sim** (§1.4). *Recommendation:* the generated
   table. *Alternatives:* the `penetration ≥ side armour` rule in the app (it can drift from
   `weaponHurts`), or no Hurt-by list at all, keeping the weakness tags.
5. **D5. "Buy with credits" on the Stores' tier rows.** *Recommendation:* yes, the same visibility rule
   as PR 1064's unit button. *Alternative:* tiers with credits in the Garage only.
6. **D6. The panel's form: one "What it adds" panel opened from the card** (§1.1). *Recommendation:*
   that, which keeps the 2 Oct declutter. *Alternatives:* two always-on lines per card (the gap line and
   the closest-unit line), or the Garage bay only.
