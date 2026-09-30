# Field commanders ("Officers" on screen) — design (GH-298)

**2026-09-30** · status: **design, docs only** · base `docs/heroes-concepts` `e6b1d1ff` (PR #299) ·
source `docs/campaign/heroes/concepts.md` · implementation **Stage 4 or later, after FW (#277) and
E6 (#274)** in the re-pin order (`docs/superpowers/plans/2026-09-29-stage4-sim-fixes.md:503-527`).
Downstream: `narrative-designer` (names, bios, lines), `balance-analyst` (every **P**),
`sim-guard` (§2), `render-vfx` (§5), `mission-author` + `playtest` (§3), `level-scripter` (§4),
`blender-art` (§7).

**The lead's rulings of 30 Sep (PR #299) bind everything below.**
- **Starting set:** Maya (infantry company commander), Yoav (forward observer / fires officer),
  Ronen (armour commander, command tank), Dalia (engineer commander). Omer is deferred.
- **Always wounded, never killed.** A downed officer sits out the next mission.
- **Earned** by story, stars or Conduct, **and buyable with brigade credits**, like E5. Never Roar
  coins (G7, ST8).
- **An officer buys at most one ratio step.** 1:1 with an officer plus smoke must still fail.
- **Defaults taken:** own foot team (command tank for Ronen); per-mission slots, none by default;
  improvement by missions survived; short unit lines; Shai is never a unit; enemy leaders through
  a new trigger (Sarim, Rif); "Officers" on screen; names screened.

Every number marked **P** is a placeholder for G-NUM (§6). Every code claim was read this session
at `e6b1d1ff`.

**Retired from the concept menu:** "always wounded" removes §3.1's 65/35 roll and N3 (**no
casualty roll, no RNG draw, no new death event**: the app reads `destroyed` and the ledger records
a wound), and §3.2's "refuse a `price`" inverts: an officer **must** carry an earned field and a
price.

## 0. Facts this design is built on

| fact | where | consequence |
|---|---|---|
| Suppression decays by a per-tick `SUPP_DECAY` 65046 (0.99253, λ 0.150/s); pin above `PIN_AT` 0.70, unpin below `UNPIN_AT` 0.45 | `tuning.ts:82-84`, `sim.ts:5092-5097` | 0.70 → 0.45 takes 2.94 s. Presence is a per-unit decay multiplier. |
| Rout fires on `pinnedTicks[i] === ROUT_AFTER_TICKS` (200, 10 s) for soft, mobile units; unpinning a routed unit fires `rallied` | `sim.ts:5098-5118`, `tuning.ts:166` | Rally is a suppression write with no new state. A per-unit delay needs `>=` (§2.1). |
| Veterancy: +6% accuracy, −8% incoming suppression per level | `tuning.ts:133-135`, `sim.ts:3620`, `:4121` | "One level steadier" is the legible unit. |
| Contact is per SIDE; `call_strike` is in the ability enum and read by nothing | `sim.ts:3171`, `unit.schema.json:473` | No officer "shares contact"; Yoav's order reuses `call_strike`. |
| A strike's caller is the **first living surface player unit**, with no LOS test; 250 Intel; scatter radius uniform in `[0, 0.3]` tiles from the caller's stream | `mission.ts:651-663`, `:412-413`, `sim.ts:2218-2235`, `tuning.ts:216-221` | Yoav changes the caller rule (§2.2). |
| An indirect miss lands `SCATTER_BASE + u` = 0.5–1.5 tiles out; `INDIRECT_MASK` shots need no LOS | `sim.ts:3674-3680`, `:245`, `:3179` | Observed fire tightens the miss, never the hit. |
| Smoke: 3-tile radius, ~9-tile reach, 45 s cooldown per unit, laid the tick it is ordered | `sim.ts:2176-2199`, `tuning.ts:197-207` | Smoke-and-bound is an app-side fan-out (§2.3). |
| `selectTarget` scans every entity per weapon slot per shooter; `curTarget` persists and is hashed | `sim.ts:3155-3200`, `:3513-3514`, `:5194` | Fire distribution reads last tick's `curTarget`: no second scan. |
| Detection + `selectTarget` are 85–95% of tick cost; at 300 units tick 2.08 ms, detection 1.17, `stepCombat` 0.45 | `docs/PERFORMANCE.md:361-362`, `:411-414` | A per-pair cost multiplies by ~90,000. |
| FW `aura.area[]` is filled by `stepAuras` every 10 ticks into per-unit SoA, MAX over sources | FW spec §3 (`2026-09-29-field-works-design.md:190-206`), §7 (`:437-440`) | An officer is a unit-sourced `area` (§1.2). |
| Trigger `on.kind` is `first_contact`/`casualties_pct`/`timer_s`/`zone_entered`; `casualties_pct` excludes `removed`; tags map to ids | `mission.schema.json:504-523`, `mission.ts:1624-1645`, `:1329-1333` | `tag_killed` is a fifth branch with no sim change (§4). |
| Credits price the STARTING force (`startingIds`, snapshotted at the end of `start()`); the wipe check reads all `playerIds` | `mission.ts:458-465`, `:743-755`, `:1861-1862`, `credits.ts:69-70` | An officer spawned after the snapshot earns and costs no credits. |
| Earned unlock fields are ANDed; a price opens the gate; Conduct is the campaign average | `unlock.ts:48-89`, `:117-133` | Ronen pairs Conduct with a mission: Conduct alone opens after mission 1 (`prices.md:229-236`). |
| The account keeps bought ids in `unlocks` (`buyUnlock`) and survives a fresh campaign | `brigade-account.ts:25-38`, `:169-180` | A bought officer needs no new account field. |

## 1. Data model

### 1.1 Officer unit JSON

An officer is a **unit type with an `officer` block**, spawned by a mission slot and never built.
Ids are by **function**, so the rule-3 rename touches only `name` (Q1): `officer_infantry`,
`officer_fires`, `officer_armour`, `officer_engineer`. Maya in full (every number **P**):

```json
{ "id": "officer_infantry", "name": "Maya (placeholder)", "faction": "kdf", "role": "support",
  "officer": { "branch": "infantry" }, "cost": { "logistics": 180, "build_time_s": 1, "population": 1 },
  "hull": { "hp": 110, "armor": { "front": 10, "side": 10, "rear": 10 }, "crew": 2, "suppression_resistance": 0.6 },
  "mobility": { "speed_tiles_s": 0.9 },
  "sensors": { "optics": 1.2, "sight_tiles": 9, "signature": 0.7, "firing_signature_mult": 3.0 },
  "abilities": ["garrison", "rally", "assault_order"],
  "weapons": [ { "id": "carbines", "type": "small_arms", "range_tiles": 6, "effective_range_tiles": 4.8,
    "accuracy": 0.6, "penetration": 8, "damage": 12, "suppression": 20, "rof_per_min": 120,
    "can_target": ["ground"], "collateral_risk": 0.05 } ],
  "aura": { "area": [ { "radius": 5, "affects": "foot", "supp_recovery_mult": 1.5, "rout_delay_mult": 1.5 } ] },
  "orders": {
    "rally": { "charges": 2, "cooldown_s": 30, "radius": 4, "self_signature_mult": 2.0, "self_signature_s": 10 },
    "assault_order": { "charges": 1, "radius": 6, "duration_s": 20, "pin_at": 0.85, "supp_taken_mult": 0.8,
                       "after_s": 20, "after_recovery_mult": 0.5 } },
  "service": [ { "missions": 3, "patch": { "aura.area[0].radius": 1 } },
               { "missions": 6, "patch": { "orders.rally.charges": 1 } } ],
  "unlock": { "after_mission": "beit_sahwan_4_subterranean", "price": 1200 } }
```

| id | role, hull | sensors | `aura` | `orders` | `unlock` |
|---|---|---|---|---|---|
| `officer_fires` (Yoav) | `support`, foot, crew 2, hp 100, carbines | sight 12, optics 1.6, sig 0.5 | `observer: { indirect_scatter_mult: 0.5 }` | `call_strike: { cooldown_s 60, free_calls 1, scatter_mult 0.5 }` | `stars_min` 20, price 1500 |
| `officer_armour` (Ronen) | `mbt`; `mbt_lavi`'s hull, armour, gun and `smoke` | as `mbt_lavi` | `area: [{ radius 6, affects vehicle, fire_distribution true, supp_recovery_mult 1.5 }]` | `smoke_and_bound: { radius 6, spacing_tiles 6, max_screens 4 }` (app-read) | `roe_rating_min` 85 **and** `after_mission tel_marum_1_recon`, price 2400 |
| `officer_engineer` (Dalia) | `engineer`, foot, crew 3, hp 150, carbines | sight 8, optics 1.2, sig 0.6 | `area: [{ radius 4, affects foot, work_rate_mult 1.43, build_rate_mult 1.33 }]`, `hostile_area: [{ radius 3, stance ambush, signature_mult 2.0 }]` | `dig_in: { charges 2, radius 3, settle_s 20, cover_step 1, cover_cap 2 }` | `stars_min` 30, price 1800 |

`cost` is required by the schema (`unit.schema.json:7-16`) and fits the hull to the curve under
`validate_balance.py`; it is **never charged**. The curve prices hulls and guns, not auras or
orders; the probes carry those (§6), as they carry E5's abilities (E5 spec §3). Roles follow
E5's G3 precedent (`support` for a foot specialist, E5 §4 G3); `mbt` puts Ronen in the crew voice
pool and the vehicle domain with no new code (`unit.schema.json:58-60`).

### 1.2 `aura`: the FW block with a unit as its source

**Reuse.** FW's `aura.area[]` is structure-sourced and filled by `stepAuras` (FW §3). Officers add
a **second source loop over units** in the same `stepAuras`, with FW's 10-tick cadence, MAX rule
and `affects` filter. FW's `$defs.area_effect` is **hoisted** into a shared
`data/schemas/defs/aura.schema.json` that `structure.schema.json` and `unit.schema.json` both
`$ref`, as FW hoists `unlock` (FW §4).

**The source is live** while the officer is alive, on the surface, not carried, not garrisoned and
**not pinned**: a pinned officer is not commanding, and a garrisoned one could not be shot
(`sim.ts:3170`), which would delete the counterplay (Q4). Recipients are FW's (living, surface,
non-garrisoned, own side); the officer is never his own recipient.

**New `area_effect` fields.** All are "bigger is better", so the MAX rule holds unchanged.

| field | range | Q16.16 at load | SoA filled (default) | read by |
|---|---|---|---|---|
| `supp_recovery_mult` | 1.0–1.5 | `fx.expNeg(λtick × mult)`, λtick 0.0075; ×1.5 → **64802** | `auraSuppDecay: Int32` (65046) | `stepUpkeep` decay (`sim.ts:5092`) |
| `rout_delay_mult` | 1.0–2.0 | `toInt(200 × mult)`; ×1.5 → **300** | `auraRoutTicks: Int16` (200) | rout test (`:5111-5112`) |
| `fire_distribution` | bool | — | `auraDistribute: Uint8` (0) | `selectTarget` (§2.3) |
| `work_rate_mult` | 1.0–1.5 | ×1.43 → **93623** | `auraWorkRate: Int32` (ONE) | `stepDemolition` (`:4617`), `stepTunnelCharge` (`:4704`) |
| `build_rate_mult` | 1.0–1.5 | ×1.33 → **87381** | `auraBuildRate: Int32` (ONE) | FW construct progress (FW S3) |

`expNeg` runs **once at load** in the unit parse (`sim.ts:470-520`), never per tick; a unit test
pins it to 64802 ±1. It is the LUT already used for range falloff (`sim.ts:3624`).

**Two scopes for units only.** `hostile_area[]` touches ENEMY units in `radius`, filtered by
`stance` (`ambush` = `stance[t] === 1`, `sim.ts:841`); its field `signature_mult` fills
`auraSigMult: Int32` (default ONE), multiplied in after the cover factor (`sim.ts:2615`) for
**side-0 observers only**. `observer` is not an area: it marks a fire-control eye, and
`indirect_scatter_mult` is read at the shot (§2.2).

### 1.3 New ability kinds and the `orders` block

`abilities` gains **`rally`, `assault_order`, `dig_in`, `smoke_and_bound`**; `call_strike` goes
live. `orders` carries each order's parameters, keyed by ability. `validate_data.mjs` requires
every `orders` key in `abilities`, and an `orders` entry for every chargeable kind.

| kind | lives in | target | charges / cooldown |
|---|---|---|---|
| `rally` | sim `{ kind: 'rally', officer }` | area around the officer | `ordCharges`, `ordCooldown` |
| `assault_order` | sim `{ kind: 'assaultOrder', officer, ids }` | selected foot inside `radius` | charges |
| `call_strike` | sim `callStrike` + optional `observer` (§2.2) | map point | cooldown; Intel and the free call are the mission's |
| `dig_in` | sim `{ kind: 'digIn', officer }` | foot inside `radius` | charges |
| `smoke_and_bound` | **app only**: `smoke` + `move` fan-out | two map points | each hull's own 45 s smoke cooldown |

`ordCharges: Uint8Array` and `ordCooldown: Int32Array`, `capacity × 2` (no officer has three
orders), are set at spawn from the patched type (§1.5) and counted down in `stepUpkeep` beside the
weapon cooldowns (`sim.ts:5134-5135`). A refused order emits `{ kind: 'orderRefused', entity,
ability, reason }` (`no_charges`, `cooling`, `pinned`, `no_sight`, `buried`) so the HUD can say why
(GDD §5.8).

### 1.4 Schema changes

**`unit.schema.json`** (root `additionalProperties: false`): `officer: { branch: enum [infantry,
fires, armour, engineer] }`; `aura` (`area`, `hostile_area`, `observer`) through the shared defs;
`orders`, one closed `$def` per kind; `service`, ≤ 3 entries of `{ missions ≥ 1, patch }` with
missions strictly increasing and its own narrow whitelist
`^(aura\.area\[0\]\.radius|orders\.[a-z_]+\.(charges|radius))$`; the four new ability kinds.

**`mission.schema.json`:** `officer_slots` 0–1, **absent = 0**, so shipped missions and `playtest`
stay byte-identical; `officer_at`, an optional marker (default: the first `starting_force` `at`);
trigger `on.kind` gains `tag_killed`, and `on` gains `tag` (§4).

**`tools/validate_data.mjs` refuses:** (1) an officer without both an earned `unlock` field and a
`price`; (2) a non-`kdf` officer; (3) an officer id in any placement, wave, `reinforce` or
production list; (4) `officer_slots > 0` in a `breach` or `recon` mission (§3.1); (5) an
undeclared `officer_at`; (6) a `tag_killed` whose tag no placement or wave declares.

### 1.5 The ledger and the account

**One new app-written key**, `roster.officers`, in `CampaignLedger` (`ledger-store.ts:112-121`),
beside `roster.surviving_units` and outside every mission's contract:

```ts
interface OfficerRecord {
  id: string;          // 'officer_infantry'
  missions: number;    // fielded AND survived: the service count
  out: 0 | 1;          // 1 = wounded, sits out the next won mission
  wounded_in?: string; // mission id, for the garage and debrief sentence
}
```

**Written on a victory only**; a defeat writes nothing (`main-keys.ts:24-25`), the rule every
roster loss follows. Fielded and alive at the end: `missions += 1`. Fielded and destroyed: `out =
1`, `wounded_in` set, `missions` unchanged. Carrying `out = 1` and not fielded in this won mission:
`out = 0`. So a wounded officer misses exactly one *won* mission, slot or not, and a lost retry
does not heal him (Q6).

**Service** is a type patch applied before registration. `upgrade-prepass.ts` already patches
types from the account before `bootBattlefield` (`upgrade-prepass.ts:1-12`); it gains a `service`
step reading `missions`. Service lives on the **campaign ledger**, so a fresh campaign starts it at
0 (Q7).

**Unlock state needs no new account field.** A bought officer's id goes into `unlocks` through the
unchanged `buyUnlock`; an earned one is derived from the ledger by `unlockReason` (`unlock.ts:48`).
**Earning opens an officer for this campaign; buying opens him for every campaign from mission
1.** That permanence is what the price buys (brigade economy D4).

### 1.6 Where officers must NOT appear

**Roster:** `roster-carryover.ts:86-166` drops any `officer` type from `roster.surviving_units`,
`reserve` and `lost`; a person is not a hull. **Dock, deploy pools, `from_ledger` draws and the
upgrade board** filter `officer` as they filter by faction. **Credits:** he spawns after the
`startingIds` snapshot (`mission.ts:458-465`), so `startingCount`/`startingHome` never see him
(`credits.ts:69-70`): a wound costs a mission, never credits. **Wipe-loss** (`mission.ts:726-727`,
`:1861-1862`) and **`lostByType`** (`:756`) skip `officerIds`: an officer alone has lost.

## 2. The officers

Every change here is **Stage 4**, owned by `sim-guard`; every array is declared in one commit that
re-pins the golden hash once (§8, B1).

### 2.1 Maya: infantry company commander

**Presence** (passive `area`, radius 5 **P**, foot). `stepUpkeep` (`sim.ts:5092`) reads
`suppression[i] = fx.mul(suppression[i], auraSuppDecay[i])`: λ 0.225/s, so 0.70 → 0.45 takes
**1.96 s instead of 2.94 s**. The rout test becomes `pinnedTicks[i] >= auraRoutTicks[i]`: 15 s
instead of 10. `>=` is needed because the aura can lower the threshold mid-pin; the existing
`routed[i] === 0` guard keeps it one-shot. It is byte-identical on every shipped path. The only
divergence is a soft unit whose `mobilityKilled` clears while pinned, which only FW's workshop can
do, and the workshop repairs vehicles only (FW §3). **Counterplay:** 5 tiles is inside a militia
rifle's 8, and pinning the command team drops the whole radius at the next refresh.

**Rally** (2 charges, 30 s cooldown **P**). Own soft foot within 4 tiles that are pinned or routed
get `suppression[t] = min(suppression[t], 29490)`, which is `UNPIN_AT − 1`. That tick's
`stepUpkeep` decays it under `UNPIN_AT`, firing `unpinned` and, for a routed unit, the existing
`rallied` branch (`sim.ts:5096-5105`). No new state. Her own `sigBoostUntil[officer] = tick + 200`
doubles her detection signature for 10 s (`sim.ts:2610`): she stood up. **Counterplay:** commands
apply at the head of the tick (`sim.ts:1719`), and `stepCombat` and `stepProjectiles` run before
`stepUpkeep`, so fire landing that tick re-pins. Rally is timing, not a shield, and it paints her.

**Assault on my mark** (1 charge **P**). For the command's ids that are own foot within 6 tiles of
her, `assaultUntil[t] = tick + 400`: the pin threshold is 55706 (0.85) instead of `PIN_AT`, and
`applySuppression` (`:4113`) multiplies incoming by 52429 (0.8) after veterancy, before cover.
Then `recoverUntil[t] = assaultUntil + 400`: decay 65291 (λ × 0.5), or 65168 (λ × 0.75) inside
Presence. The after-cost always wins over Presence. **Counterplay:** the window is fixed,
`ambush(N)` still springs (`sim.ts:3373-3390`), a stalled push pays the after-cost under fire, and
0.85 sits under `SUPP_CAP` 2.0 (`tuning.ts:85`), so enough volume still pins.

**Stage 4:** the decay and rout reads, the per-unit pin threshold, the `applySuppression`
multiplier, the `rally` and `assaultOrder` commands, and the signature boost.

### 2.2 Yoav: forward observer and fires officer

**Observed fire** (passive `observer`). In `fireAt`'s miss branch (`sim.ts:3674-3680`), for a
side-0 `INDIRECT_MASK` shot, if a living, surface, unpinned side-0 observer has the target inside
its `sightSq`, `losRay(obs → target) >= 0` and smoke on the line below `SMOKE_BLOCKS_AT`
(`tuning.ts:199`), then `rad = fx.mul(SCATTER_BASE + u, indirect_scatter_mult)`: **0.25–0.75 tiles
instead of 0.5–1.5**. The shot draws the same two values from the shooter's stream (invariant 3),
and the hit roll is untouched, as the ruling that an officer never makes a round hit harder
requires. Cost: one distance test and at most one `losRay` per KDF indirect shot. **Counterplay:**
kill him, or smoke his line; Sarim hunt observers.

**Priority call for fire** (`call_strike`, 60 s cooldown **P**, first call each mission free).
`mission.ts:651-663` keeps `requestStrike` unchanged for the ordinary strike. A new
`requestPriorityStrike(x, y)` requires a living, surface `call_strike` carrier in `officerIds`;
asks a new **read-only** `sim.canObserve(id, x, y)` (the test above; no RNG, no write: invariant 4)
and `sim.orderReady(id, 'call_strike')`; charges 0 Intel for the mission's first call
(`freePriorityUsed`, runtime state outside the hash) and `STRIKE_COST` 250 after; and queues
`{ kind: 'callStrike', caller: officer, x, y, observer: officer }`. The sim (`sim.ts:2218`)
re-validates sight and cooldown and draws the same two values from the **officer's** stream with
radius `% (9830 + 1)`: **0.15 tiles instead of 0.3**, then sets a 1200-tick cooldown. On failure it
emits `orderRefused` and the mission **refunds**, so the sim stays the one authority. Delay 3 s,
600 damage, 2-tile splash and ROE attribution to the caller are unchanged. **Counterplay:** he
must stand where he sees, which is where he is seen; a strike beside a flagged zone still costs
Conduct. **Deferred:** the registered target (concept §2.2) needs a "fire at ground" order (Q8).

### 2.3 Ronen: armour commander, command tank

**Fire distribution** (passive `area`, radius 6 **P**, vehicles): three tanks must not all kill one
technical. It adds no accuracy. **The cheap form.** One O(N) pass at the head of `stepCombat`
(`sim.ts:3467`), before the shooter loop overwrites `curTarget`, fills `firstEngager: Int32Array`
(reset to −1) with the **lowest id** among `auraDistribute[i] === 1` units whose last-tick
`curTarget[i] === t`. In `selectTarget` (`:3187-3196`), only for a flagged shooter, a candidate is
`taken` when `firstEngager[t] >= 0 && firstEngager[t] < shooter`, and the key becomes `(hurts,
!taken, distance)`. **Stable by construction**: the lowest id keeps a target and higher ids move
off, so two tanks never swap every tick (a symmetric "anyone else on it?" count would), and reading
only the previous tick makes it order-free. **Cost at 300 units:** 300 reads and writes, plus one
array read per candidate for flagged shooters only (≤ 8 vehicles × ~300 ≈ 2,400 a tick): **under
1% of `stepCombat`'s 0.45 ms, estimated** (`PERFORMANCE.md:362`); B5 measures it with
`tools/src/perf/sim-scaling.ts`. **Rejected:** scanning the other shooters per candidate (O(N² ×
V)), and any extra `losRay`. **Counterplay:** spread targets make it inert, and every exchange it
changes is still decided by the unchanged hit and penetration model.

**Crew drill:** the same `area` carries `supp_recovery_mult` 1.5 for vehicles through
`auraSuppDecay`, so crew-shaken suppression from `rollComponent` clears ×1.5 faster. Mobility,
firepower and catastrophic kills are untouched.

**Smoke and bound** (**app only, no sim change**). It arms two clicks: the screen line's centre,
then the bound point. The app takes every own smoke-capable hull within 6 tiles of Ronen with
`smokeCooldown` 0 (Ronen's Lavi hull carries `smoke`). It spreads up to 4 aim points along the line
through click 1, perpendicular to Ronen → click 1, 6 tiles apart (two smoke radii,
`tuning.ts:197`), and gives each point to the nearest hull in `SMOKE_RANGE_SQ` (`:207`). In **one
tick** it queues one `smoke` per hull and one `move` to click 2 for Ronen and the hulls in radius.
Smoke is laid the tick it is ordered (`sim.ts:2180-2192`), so the screen stands before anyone
moves, and the ordinary queue means replays record it. **Counterplay:** each hull spends its own
45 s cooldown. Smoke buys one ratio step (D1); this spends it faster and adds no second one.

**His wound, as a hull:** crew shaken pins the hull, which drops the aura; mobility and firepower
kills leave command on; destruction wounds him.

### 2.4 Dalia: engineer commander

**Work site** (passive `area`, radius 4 **P**). `stepDemolition`'s `++demoTicks[i] >=
type.demolitionTicks` (`sim.ts:4617`) and `stepTunnelCharge` (`:4704`) compare against
`fx.toInt(fx.div(fx.fromInt(ticks), auraWorkRate[i]))`: 0.7× the time. The per-tick structure
damage at `:4634` divides by the same reduced count, so the total is unchanged. FW construction
progresses at `auraBuildRate` (0.75× the time). E6's placed charge reuses the explicit set branch
(E6 §2.1) and inherits the rate with no extra code. **Counterplay:** the work stays held-station
and exposed; the window is shorter, not gone.

**Prove the route** (`hostile_area`, radius 3). Enemy units in `ambush` within 3 tiles of her read
signature ×2 to side-0 observers: one read in `detectionPair` (`sim.ts:2609-2615`), filled every 10
ticks. She has to walk point to use it.

**Dig in** (2 charges **P**). Own foot within 3 tiles get `digSettle[t] = 400` (20 s), counted down
in `stepUpkeep` while stationary, unpinned and on the same tile; moving resets it and clears
`dugIn[t]`. At 0, `dugIn[t] = 1` and the unit's effective cover is `c < 2 ? c + 1 : c`, read in
`hitFactors` (`sim.ts:3629-3631`, max with the parapet) and `applySuppression`'s cover branch
(`:4122-4125`).
**Per unit, not a terrain edit** (Q3): no shared grid changes, so `FlowField`, `applyTerrain` and
the ground are untouched, the enemy cannot inherit the scrape, and moving off the tile ends it.
It reads through the hover P(hit) cover factor (GDD §5.8) and a card chip, with no world mark.
**Counterplay:** 20 s stationary; strikes ignore cover (`sim.ts:3832`, `coverProtects = false`).
Cover 0→1 is the big rung (`COVER_HIT`, `tuning.ts:49`), hence its own probe (§6).
**Overlap:** Dalia multiplies FW's build time and E6's placed charge, so she lands after both.

### 2.5 The Stage 4 array list (declared together in B1)

| array | type | length | officer | | array | type | length | officer |
|---|---|---|---|---|---|---|---|---|
| `auraSuppDecay` | Int32 | cap | Maya, Ronen | | `ordCooldown` | Int32 | cap × 2 | all |
| `auraRoutTicks` | Int16 | cap | Maya | | `sigBoostUntil` | Int32 | cap | Maya |
| `auraDistribute` | Uint8 | cap | Ronen | | `assaultUntil` | Int32 | cap | Maya |
| `auraWorkRate` | Int32 | cap | Dalia | | `recoverUntil` | Int32 | cap | Maya |
| `auraBuildRate` | Int32 | cap | Dalia | | `digSettle` | Int16 | cap | Dalia |
| `auraSigMult` | Int32 | cap | Dalia | | `dugIn` | Uint8 | cap | Dalia |
| `ordCharges` | Uint8 | cap × 2 | all | | | | | |

`firstEngager` is unhashed scratch rebuilt each tick from hashed `curTarget`. No per-tick allocation.

## 3. Campaign integration

### 3.1 Slots

`officer_slots` (0–1) is authored per mission; absent = 0. On deploy, `MissionRuntime` receives
`ctx.officer?: { unit, service }` (the playtest harness passes none and stays byte-identical),
spawns him at `officer_at` **after** the `startingIds` snapshot, and records his id in
`officerIds`.

**Default adoption:** 1 slot in `foothold`, `buildup` and `clearance` missions; 0 in `breach` and
`recon`, enforced by validator rule 4. A breach is `survive_until`, and a passive player with a
free suppression aura on a static perimeter is exactly what the passive control exists to catch.
Recon runs on drones and scouts, where an officer is inert or a spotter shortcut. `subterranean`
is open (Q5).

Of the 27 shipped missions the default puts a slot on **16**: 6 foothold (counting
`wadi_halam_2_laager`), 2 buildup (counting `wadi_halam_3_counterraid`) and 8 clearance. Beit
Sahwan II and III come before any officer can be earned, so only an officer bought in an earlier
campaign fills theirs. Adoption is content work (§8, D2), mission by mission, and each adopting
mission re-runs its passive control with every officer (§6).

### 3.2 Earning gates and credit prices

| officer | earned gate | opens on the ★★ ladder | price **P** | affordable (★★) | margin |
|---|---|---|---|---|---|
| Maya | story: `after_mission beit_sahwan_4_subterranean` (Act I end, Shai → Major, `storyline.md:145`) | after mission 5 | **1,200** | after 6 (1,345) | −1 |
| Yoav | `stars_min` 20 | ~mission 10 (between 12 → 6 and 30 → 15) | **1,500** | after 7 (1,570) | ~+3 |
| Dalia | `stars_min` 30 | after 15 (as `scout_shachaf`) | **1,800** | after 9 (1,966) | +6 |
| Ronen | Conduct 85 **and** `after_mission tel_marum_1_recon` | after 12 | **2,400** | after 12 (2,631) | 0 |

Ladder columns: `prices.md:77-102` (the 2026-09-16 ★★ curve, not re-walked, per
`prices.md:145-149`). **Why this band:** earned *and* buyable puts officers in the star-gated band
(850–3,200, `prices.md:293-300`) and under the bought-only floor of 4,000 (`prices.md:436-445`): a
thing play can reach must never cost what one it cannot does. **The set costs 6,900**, 1.18 ×
`LADDER_CREDITS` 5,849 (E5 §2): a first campaign buys one or two, a second the rest (D4's shape).
A negative margin is a first-campaign loss, as with the Namer (`prices.md:328-335`), acceptable
because the purchase buys **permanence across campaigns** (§1.5), not first-campaign speed.
**Ronen's AND is load-bearing:** Conduct alone opens after mission 1 at any floor ≤ 97
(`prices.md:229-236`). **Roar coins:** no path; `unlock.price` is credits only (G7), and validator
rule 1 means an officer is never bought-only.

### 3.3 Wounds, and what the ladder must not see

A destroyed officer is **wounded, always**; the HUD and debrief say so (§5) and a victory writes
`out: 1`. The deploy screen greys him for the next won mission with the reason; if every unlocked
officer is out, the slot stays empty and says why. No death, no replacement, no second-in-command
(concept P3 retired). No `playtest` plan fields an officer, so `LADDER_CREDITS`, `GATES` and
`CONDUCT_GATES` must not move. Officer runs are off-ladder `(officer:<id>)` lines, like E5's
`(bought)` probes (E5 §3.4): the plan still wins, and the passive control with the slot filled
still loses.

## 4. Enemy leaders

**Asymmetry kept (GDD §2):** KDF officers are few, named and persistent; enemy leaders are
disposable, tag-named placements whose death breaks something different per doctrine.
**New trigger condition `tag_killed`** (`mission.schema.json:511-520`):
`on: { kind: 'tag_killed', tag }`. It is a fifth branch in `stepTriggers` (`mission.ts:1624-1645`):
`ids = this.tags.get(tag)`, fire when `ids.length > 0` and every id has `alive === 0 && removed !==
1`. Removal is not a kill, matching `casualties_pct` (`:1631-1636`), so a leader who leaves through
`remove` never fires it. It fires once, like every trigger (`:1620-1621`). **No sim change and no
hash change**: it is mission runtime only, so it can land **early as an order-0 row** (§8, Q15).

| doctrine | leader | his death does | authored as | status |
|---|---|---|---|---|
| **Sarim** | the section observer, e.g. on FW's `militia_observation_post` (FW §5) | standoff cells **withdraw in good order**: no eyes, no fight | `tag_killed(sr_observer)` → `withdraw_to` the ATGM group's fallback marker | **v1** |
| **Rif** | the raid leader in a `technical`, the `wh_hvt_amir` pattern (`wadi_halam_3_counterraid.json:95`, `:155`) | the raid **disperses** to the map edge | `tag_killed(rf_leader)` → `withdraw_to` an exit marker, one trigger per raid group | **v1** |
| **Ashwar** | the digger's foreman | ambush discipline breaks: `ambush(N)` springs at weapon range | an enemy `leader` aura over group ambush radii | **deferred** |

**Known limit (Q13).** A trigger fires one `do`, and a `remove` with `zone` removes only those
already inside when it fires (`mission.schema.json:561-564`). So v1 disperses the Rif to the exit,
where they stop fighting; removal on arrival needs a chained condition.

**Leaders are ROE bait by design**: an observer on a roof in human terrain is the villain's job
done small, and the collateral preview governs every shot at him. A trigger `id` reads verbatim as
`enemy reacts (<id>)` (CLAUDE.md), so ids are player text: `observer_down`, `raid_breaks`.

## 5. UI (three.js; Pixi shows the card but no rings)

### 5.1 HUD officer card

A fixed card beside the order row in the bottom-centre cluster (`hud.ts:19-30`), present only when
an officer is fielded, so no gated golden scenario moves. It shows the portrait (§7), name and
branch ("Officer · Infantry"), a status (*Commanding* · *Pinned — not commanding* · *Under cover —
not commanding* · *Down — wounded*), "Under command: N", and one button per order with charge pips
and a cooldown sweep. Click selects him; double-click centres the camera. **The radius draws only
while he is selected or hovered, or an order is armed**, as FW treatment B's dashed ring with no
fill (FW §6, `auraRingPreview`; no new primitive); `hostile_area` draws dotted. Recipients get a
card chip ("Under command: Maya", "Dug in"), **never a world mark**. `orderRefused` prints its
reason in the feed and flashes the button (GDD §5.8).

### 5.2 Hotkeys (`input/keymap.ts:35-66`; all rebindable, all free today)

| action | key | behaviour |
|---|---|---|
| `officerSelect` | `q` | select the officer; a second press centres the camera |
| `officerOrder1` | `z` | Maya: Rally · Yoav: Priority call (arms a click) · Ronen: Smoke and bound (arms two clicks) · Dalia: Dig in |
| `officerOrder2` | `x` | Maya: Assault on my mark (applies to the current selection) |

Escape or right-click disarms (#268). The F1 keys overlay lists them from the same table.

### 5.3 Garage, deploy and debrief

**Garage:** an "Officers" section beside the unit tracks. Each card: portrait; the `unlockReason`
sentence ("requires 20 stars, or buy for 1500 credits") and the buy button (`buyUnlock`); service
("4 missions · next: +1 rally at 6"); when it applies, **"Wounded at *Qarn Hadid II*. Sits out the
next mission."** **Deploy:** an "Officer" row when the mission has a slot: fit officers selectable,
wounded ones greyed with the same sentence, and "None"; default the last officer fielded if fit.
It is its own field in the Phase 3 decision (`deploy-select.ts`), not a pool permutation.
**Debrief:** "Maya came through. 4 missions." or "Maya was wounded and evacuated. She sits out the
next mission." A defeat's debrief says nothing is recorded.

### 5.4 Voice and sandbox

**Voice:** two to four short lines per officer in their own pool, keyed on the house pattern
(`he.<pool>.<event>`, unit-voices spec), e.g. `he.officer_infantry.rally`: acknowledge, order
(rally, assault, priority call, smoke-and-bound, dig in) and pinned ("not commanding"). The brigade
net, not the officer, announces the wound. `narrative-designer` writes them after the rule-3
screen. **Briefings stay the Shai/Idit two-hander** (GDD §11); officers never brief. Status:
`engine` until the bark channel and the D5 licence land. **Sandbox:** `&officers` in
`sandbox-help.ts`'s flag table (the single source for all four callers) adds all four officers to
the sandbox force; a mission slot is the only other path.

## 6. Balance

### 6.1 G-NUM placeholders for `balance-analyst`

| # | number | **P** | band to test | measured by |
|---|---|---|---|---|
| N1 | Maya presence radius | 5 | 4–6 | officerStep |
| N2 / N3 | presence `supp_recovery_mult` / `rout_delay_mult` | 1.5 / 1.5 | 1.2–1.5 / 1.25–2.0 | officerStep |
| N4 | rally radius / charges / cooldown | 4 / 2 / 30 s | 3–5 / 1–3 / 20–60 | officerStep |
| N5 | rally self signature | ×2.0 for 10 s | ×1.5–3 | Maya probe |
| N6 / N7 | assault radius / duration / pin_at / taken; after-cost | 6 / 20 s / 0.85 / 0.8; 20 s at λ × 0.5 | — / 10–30 / 0.75–0.9 / 0.7–0.9; 10–30 s | officerStep |
| N8 | observed-fire scatter mult | 0.5 | 0.4–0.75 | Yoav probe |
| N9 | priority scatter / cooldown / free calls | 0.15 / 60 s / 1 | 0.1–0.3 / 45–120 / 0–1 | Yoav probe |
| N10 | Ronen radius / crew-drill mult | 6 / 1.5 | 4–8 / 1.2–1.5 | armour probe |
| N11 | smoke-and-bound spacing / max screens | 6 / 4 | 5–7 / 2–4 | armour probe |
| N12 | work / build rate | 1.43 / 1.33 | 1.2–1.5 | Dalia probe |
| N13 | prove-the-route radius / sig mult | 3 / 2.0 | 2–4 / 1.5–3 | Dalia probe; GDD §5.7 ambush ≥ 80% must hold outside her radius |
| N14 | dig-in radius / settle / charges / cap | 3 / 20 s / 2 / 2 | — / 15–30 / 1–3 / 1–2 | Dalia probe |
| N15 | hp (Maya / Yoav / Dalia) and sight | 110 / 100 / 150; 9 / 12 / 8 | curve ±18% | `validate_balance.py --also` |
| N16 | service steps | radius +1 at 3; +1 charge at 6 | 3–5 / 6–10 | none (ledger) |
| N17 | prices | 1,200 / 1,500 / 1,800 / 2,400 | 850–3,200 | the §3.2 ladder walk |

### 6.2 New pinned case: "An officer buys at most one ratio step"

In `tools/src/backtest/targets.ts` beside `urbanSmokeStep` (`:344-376`), clause for clause: same
town, seeds (`60000 + ratio·1000 + s`) and clearing plan (`urbanAssault`, `:103-209`), which gains
`officer?: OfficerArm`. **The officer spawns last**, after every squad: streams are keyed by
entity id, so every other unit keeps its id and stream and the arms stay paired seed for seed (the
Tel Marum RNG trap in CLAUDE.md, avoided by construction). **Maya's plan:** follow group 1 three
tiles behind its first squad (re-ordered every 40 ticks); rally when ≥ 2 squads within 4 tiles are
pinned or routed; order the assault once group 1's first squad is within 8 tiles of
`URBAN_FRONTS[1]`.

- **Pinned:** `1:1 + officer + smoke ≤ 0.25` (**the ruling**), and `1:1 + officer ≤ 0.25`
  (implied, pinned for a sharper failure message).
- **Recorded, not enforced:** `2:1 + officer` and `2:1 + officer + smoke`. No honest upper bound
  exists against a 100% ceiling, which is why `urbanSmokeStep` records its max-tier row
  (`:333-338`).
- **Scope:** Maya only in `pnpm balance` (2 × 60 runs, `urbanSmokeStep`'s cost). The other three
  run the same clauses in `tools/src/backtest/officer-probes.ts` (Q16).
- **§5.7 stays measured without officers**, as without smoke (`targets.ts:4-8`, GDD §5.7).

**Probes** (`officer-probes.ts`; bands set at G-NUM, never after). **Yoav:** a `mortar_team` vs a
dug-in `militia_cell`, observed vs unobserved, 60 seeds. **Ronen:** 3 `mbt_lavi` + Ronen vs 5
technicals with and without the aura; Lanchester (`targets.ts:395`) with Ronen in a vehicle variant
must still pass. **Dalia:** her ambush read against the GDD §5.7 ambush target; dig-in on a
foothold hold against a militia wave; the breach passive control with her dug in must still lose.
**Every adopting mission:** its passive control re-run with each officer, expected DEFEAT.

## 7. Art and the Meshy estimate

Rates are style bible §4: a figure team (preview 20 + refine 10 + remesh 5 + rig 5) is **40**, a
textured vehicle **35** (`docs/art/meshy-prompts-units.md:26-27`, `:134`).

| asset | class | planned | cap | silhouette lever vs neighbours |
|---|---|---|---|---|
| Maya's command team (officer + signaller) | figure team | 40 | 80 | a tall whip antenna (≈ 80°) on the signaller; a map case; vs `inf_squad`, `recon_zikit` |
| Yoav's observer team (observer + radio operator) | figure team | 40 | 80 | a kneeling observer at a tripod binocular or designator; vs `sniper_team`, `recon_zikit` |
| Dalia's engineer team (officer + two sappers) | figure team | 40 | 80 | a long mine probe and a slung charge satchel; vs `demo_squad`, `yahalom_squad` |
| Ronen's command tank | textured vehicle | 35 | 70 | a tall telescoping mast behind the turret and a raised commander's sight; vs `mbt_lavi` (**IoU ≥ 0.88 risk**: measure on the preview before refining) |
| **total** | | **155** | **310** | ≈ **$3.10 planned, $6.20 cap** (E5's rate: 140 cr ≈ $2.80) |

**Who runs it:** per the lead, **Meshy design work runs on a Fable 5.1 agent at high effort**,
each call announced with its credit and USD estimate first (Meshy API policy), when the October
credits allow. **Prompts** follow E5 §6's frame (fictional army, plain olive drab, A-pose, one
object, no insignia) and the KDF vehicle line (E5 Q8), drafted only after the rule-3 screen.
**Portraits** for the card and garage are rendered from each GLB through the GH-153 Blender
pipeline at **0 credits** (Q14). **Billboards:** Pixi and `&nomesh` need sheets rendered from the
meshes and `SPRITE_MAP` entries, because art that exists is not art that draws (CLAUDE.md).
**Gates:** `validate:meshes`, `validate:assets`, the IoU checks, `pnpm wreck:meshes` for the
command tank (the vehicle-death debt), provenance and the AI disclosure in each PR.

## 8. Phasing

### 8.1 Re-pin order (extends `2026-09-29-stage4-sim-fixes.md:509-515`)

| order | stream | moves the pins | reason |
|---|---|---|---|
| 0 | this spec: **`tag_killed`** (§4) | no | mission runtime, not sim state |
| 1 | #291 | yes | 3 per-unit columns |
| 2 | FW Task 2 | yes | 14 FW arrays; `stepAuras` exists only after FW S4 |
| 3 | E6 T1 | yes | its per-structure columns |
| **4** | **officers B1** | **once** | the 13 arrays of §2.5. With their `hashArray` lines removed, both pins must reproduce E6's values: no behaviour moved. |

**Why fourth.** B2 extends FW's `stepAuras`, which does not exist before FW S4. Dalia multiplies
FW construction and E6's placed charge. `applySuppression` is edited by #291, FW Task 1 and E6's
blast before this stream adds `supp_taken_mult`; rebasing onto a settled signature is why #291 went
first. One stream, one determinism review; the commit says what entered `hash()` and writes
`Was <E6 value>.`

### 8.2 Plans and tasks

| plan | task | owner | content |
|---|---|---|---|
| **A** October, no sim | A1 | `narrative-designer` | rule-3 name screen, bios, ranks (Maya takes Shai's company at the Act I boundary), the §5.4 line list |
| | A2 | `balance-analyst` | G-NUM over §6.1 on probe copies; the lead approves |
| | A3 | G-MOCK | static mock: HUD card, deploy officer row, a wounded garage card; no app code |
| | A4 | Fable 5.1, high effort | the Meshy estimate to the lead, then §7 after the credits |
| | A5 | tools | E5 staging (E5 §5): four JSON files in `docs/campaign/heroes/staged/`; a spec asserts no staged id is in `@lions/data`; `validate_balance.py --also` |
| | A6 | order 0 | `tag_killed` in schema, `stepTriggers`, `validate_data.mjs`; `mission.test.ts` per rule (all dead fires, removal does not, fires once); `test:determinism` unmoved |
| **B** Stage 4, one `sim-guard` stream after E6 T1 | B1 | `sim-guard` | the 13 arrays, `hash()`, one coverage test per array, the re-pin with its reason; balance, playtest, E5/E6 probes byte-identical |
| | B2 | `sim-guard` | unit-sourced `stepAuras`, decay and `>=` rout reads, crew drill, `auraSigMult`; tests: MAX not stacking, source off when pinned/garrisoned/carried, the expNeg pin |
| | B3 | `sim-guard` | `rally`, `assaultOrder`, `digIn`; charges, cooldowns, `orderRefused` |
| | B4 | `sim-guard` | observed fire, `canObserve`, the `callStrike` observer path; test: RNG draws per shot unchanged |
| | B5 | `sim-guard` + `perf-analyst` | `firstEngager` and the tie-break; perf at 300 and 600 into `docs/PERFORMANCE.md`; test: no target swapping over 200 ticks |
| | B6 | `sim-guard` | work and build rates (after FW S3 and E6 T2) |
| | B7 | `sim-guard` | `mission.ts`: slot spawn after the snapshot, `officerIds`, wipe and `lostByType` exclusions, `requestPriorityStrike` + refund; schemas; validator rules 1–5 |
| **C** app and render | C1 | app, `render-vfx` | `roster.officers` write rule, service pre-pass, roster/dock/garage filters, deploy row, garage section, debrief, HUD card, chips, hotkeys, smoke-and-bound fan-out, `&officers`, dashed-ring reuse; walked by driving the UI, music off |
| **D** balance, content | D1 | `balance-analyst` | `officerStep`, `officer-probes.ts`, bands frozen |
| | D2 | `mission-author` → `playtest` | slots adopted mission by mission, each with its `(officer:<id>)` lines |
| | D3 | `level-scripter` → `mission-author` | the Sarim and Rif leaders |
| **E** land | E1 | — | one PR per officer, art and data together: staged → `data/units/kdf/`, `index.ts`, `SPRITE_MAP`, `mesh-catalogue`, `names.json`; CLAUDE.md, HANDOVER |

## 9. Risks

| # | risk | guard |
|---|---|---|
| R1 | Maya breaks the urban curve: Presence plus assault is the game's strongest suppression lever | §6.2; if `1:1 + Maya + smoke` > 25%, N2, N3 and N6 come down; the clause never widens |
| R2 | fire distribution in the hot loop | estimated < 1% of `stepCombat`; B5 measures; Lanchester and the ATGM exchange re-run with Ronen |
| R3 | a passive player on a `hold_for`, where Presence and dig-in pay for sitting still | every adopting mission's passive control must lose with each officer |
| R4 | "always wounded" lowers the stakes | the cost is a won mission without him, and service stops accruing; a second mission out is a data change |
| R5 | dig-in takes the biggest cover rung (0→1 cuts hit chance to 0.375×) | settle time and charges, measured by the Dalia probe |
| R6 | hash churn: a fourth stream through `applySuppression` and `stepUpkeep` | one re-pin, with the "no behaviour moved" proof |
| R7 | an officer leaks into `startingIds` or `roster.surviving_units` (free credits, roster dilution) | tests assert both exclusions |
| R8 | command tank vs `mbt_lavi` IoU ≥ 0.88 | measure on the preview before refining |
| R9 | Conduct gates open after mission 1 on the optimal ladder | Ronen's `after_mission` AND; recheck if the ladder moves |
| R10 | the names block the JSON | staged data uses functional ids from day one; only `name` waits |
| R11 | the free priority call is worth 250 Intel a mission (storyline §2.2) | N9's band allows 0 free calls |

## 10. Open questions (each with a recommended default)

| # | question | recommended default |
|---|---|---|
| Q1 | Unit ids by function (`officer_infantry`…), with display names from the screen? | **Yes.** A rename touches only `name`. |
| Q2 | Rout test `===` → `>=` against a per-unit threshold? | **Yes.** Byte-identical on every shipped path (§2.1). |
| Q3 | Dig-in as a per-unit cover step, not a runtime terrain edit? | **Per unit.** No shared grid changes, no scrape for the enemy. |
| Q4 | Aura source off while the officer is pinned, garrisoned or carried? | **Off in all three.** Command has to stand where it can be shot. |
| Q5 | Slots in `subterranean` missions (Dalia's natural home)? | **0 in v1**, per the lead's listed types; revisit after the Dalia probe. |
| Q6 | A wounded officer sits out the next *won* mission, even one with no slot? | **Yes.** A defeat writes nothing, so a lost retry does not heal him. |
| Q7 | Service on the campaign ledger (reset by a fresh campaign), not the account? | **Campaign ledger.** The account keeps only the purchase. |
| Q8 | Yoav's registered target (needs an indirect "fire at ground" order)? | **Defer to v2.** |
| Q9 | Officers excluded from credits, the roster, `lostByType` and the wipe check? | **Yes, all four.** |
| Q10 | Yoav's first priority call free each mission, then 250 Intel? | **Yes**, pending N9. |
| Q11 | Ronen gated by Conduct 85 **and** `tel_marum_1_recon`? | **Yes.** Conduct alone opens after mission 1. |
| Q12 | Prices 1,200 / 1,500 / 1,800 / 2,400, in the star-gated band under the 4,000 floor? | **Yes**, as **P** for G-NUM. |
| Q13 | Rif dispersal by `withdraw_to` an exit only, with no removal on arrival in v1? | **Yes.** A chained condition is out of scope. |
| Q14 | Portraits rendered from the GLB (0 credits), not painted? | **Rendered in v1**; painted with the character-portrait work. |
| Q15 | `tag_killed` lands early as an order-0 row, ahead of Stage 4? | **Yes.** Hash-neutral, and it unblocks the Sarim and Rif leaders. |
| Q16 | The pinned case in `pnpm balance` for Maya only, the other three in probes? | **Yes.** Keeps the gate at `urbanSmokeStep`'s cost. |
