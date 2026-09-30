# FW: field works — KDF constructible buildings and militia equivalents — design (#277)

**2026-09-29** · status: design, no code; gates G-NUM and G-MOCK approved 29 Sep; Meshy estimate pending · base `main` `9623d500` · lead rulings of 29 Sep on
#277 are binding (build anywhere; full-radius tunnel identification with a per-mission allow list;
workshop = repair + accuracy, not a damage aura; design, numbers, mock and art in October; sim
and UI in Stage 4). Gates: **G-NUM** (§9, approved 29 Sep), **G-MOCK** (§6, treatment B,
approved 29 Sep), **Meshy estimate** (§8, pending). Every number in §9 is approved; **M** marks a
figure measured against the real sim, **E** an estimate whose Stage 4 probe must measure it.

**What exists today, measured in code.**
- `MissionRuntime.requestBuild` queues a UNIT only: it spends logistics/intel and pushes onto a
  runtime-private `buildQueue` (`packages/sim/src/mission.ts:665-678`, queue `:511`, drained `:1064`).
  Nothing is ever placed.
- Every structure comes from the map grid or from `mission.structures[]`, raised once by
  `raiseMissionStructures` (`mission.ts:1204-1241`) through `Sim.addStructure`
  (`packages/sim/src/sim.ts:1342-1382`). The enemy never builds.
- Structures have NO owner except `produces_for` on the camp type (`structures.ts:38-62`,
  `:92`); the other nine types are neutral terrain. No structure observes anything.
- Healing is `stepUpkeep`'s field regen: after `REGEN_DELAY_TICKS` 200 (10 s) undamaged, +0.024%
  of max HP per tick (~0.48%/s) up to `REGEN_CAP` 0.7 (`tuning.ts:237-242`, `sim.ts:5122-5131`,
  whose comment already says "Serious damage needs M2 repair").
- `repair` and `resupply` are in the unit-schema ability enum (`data/schemas/unit.schema.json:
  474-475`) and are read by nothing: `unitTypeFromJson` parses no such flag (`sim.ts:466-494`) and
  no unit JSON carries either.
- Garrison is entry and protection only: `stepGarrison`/`enterStructure` (`sim.ts:4496-4511`,
  `:4231-4246`) move the unit to the centroid; range (`selectTarget`, `sim.ts:2729`), cooldown
  (`sim.ts:3665`, `:3748`) and sight (`detectionPair`, `sim.ts:2600`) never read `garrisonedIn`.
- Tunnels are identified only by `markerSeeingRoute` (a `mark_tunnel` unit with LOS to a route
  tile, `sim.ts:3048-3078`) or by the spoil ladder `trailStrengthFor` → `tnContact`
  (`sim.ts:2939-3003`). Both are HELD, not latched: unwatched contact decays (`:2966-2990`).

## 0. What this re-opens

**The recorded decision.** GH-115 item 2 (open, documentation only) records: base building is
adopted only as field fortification (#73, with #66 supplying barrier types); *"No construction
yard, no power grid, no sell, no repair-by-building"*, reasoning from GDD §4's Build-up
(*"production and force composition"*) and CLAUDE.md's *"the combat model is the product"*. The
lead's comment on #73 drew the line: *"a build radius, a power prerequisite, or a structure that
produces anything"* crosses it. GDD §10 does NOT yet carry the entry (§10 lists only multiplayer,
map editor, naval, air superiority, dynamic campaign, mod loader, localisation), so there is no
GDD text to reverse, only #115's pending wording. The execution plan lists "base building" as a
Re-open item; this is that re-open, made by the lead on 29 Sep. It is not argued here.

**What the reversal changes, and what it keeps.** It adds four placeable support buildings and
one form of repair-by-building (the workshop). It keeps: no harvester, no construction yard, no
power grid, no sell, **no build radius** (the "build anywhere" ruling), no tech prerequisites, and
**no structure that produces units or income** (the camp stays mission-authored; the intel centre
generates no intel, Q9).

**Proposed GH-115 / GDD §10 wording** (lands with this spec's docs PR, closing #115):
> **The harvester loop is refused, permanently.** Logistics is throughput (§3); protecting the
> corridor is the gameplay.
> **Base building is adopted as field works and field fortification — nothing more** (#277, #73,
> #66). Engineers raise a small catalogue of support positions (medic station, outpost, intel
> centre, workshop) and barriers anywhere on open ground, paid from mission logistics, built
> under fire, one mission at a time. Each is a tactical position with a radius, not an economy.
> **Refused:** a construction yard, a power grid, selling, build radius, tech prerequisites, and
> any structure that produces units or income. Repair by building exists in one form, the
> workshop's area repair.
> **Mirrored tech trees are refused** (§1 pillar 3): the enemy never builds.

**GDD §4, one clause each:** Foothold *"Engineering, supply corridor, Iron Dome battery"* becomes
*"Engineering (field works and fortification), supply corridor, Iron Dome battery"*; Build-up
gains *"— and where to site the field works the assault will lean on"*. GDD §3's Logistics line
(*"Builds units and structures"*) becomes literally true and needs no edit.

**#73 and #66 share this placement path.** #66's barrier half is partly landed as structure types
(`wall`, `fence`: `per_tile`, `low_profile`, `standing_cover`; `b`/`d` masks). FW builds the
generic path — the `buildable` block (§4), the `construct` command (§1), the dock's arm-and-click
flow (§6) — and #73 then reduces to "give barrier types a `buildable` block, plus a line drag that
issues one `construct` per tile for a `per_tile` type". #73's per-tile movement cost (wire slows)
is independent of FW and not needed by it.

**The militia stays asymmetric** (GDD §1 pillar 3, *"neither side plays the same game"*; the
pillars sit in §1, §2 is the setting). Militia works are placed by mission authors as targets and
positions; no enemy unit carries `construct`, no trigger `do` raises a building, and the enemy
has no dock. Same data concept, different ownership path — not a mirror.

## 1. Construction

**Placement is a player COMMAND into the sim (invariant 4).** The app calls
`MissionRuntime.requestConstruct(typeId, tx, ty)`, which checks the mission allow list (§4), the
unlock gate (`unlockReason`, as `buildBlockedReason` does, `mission.ts:595-610`), affordability,
and the pure read `sim.placementReason(typeIdx, tx, ty, side)`; on success it deducts cost and
queues `{ kind: 'construct'; ids: number[]; structType: number; x: number; y: number }` through
`sim.queueCommand` (`sim.ts:1679`), exactly as `requestStrike` does (`mission.ts:651-662`). The
sim re-checks at `applyCommands`; a refusal there (two overlapping sites in one frame) emits
`constructRefused`, and the runtime refunds on it. Unlike a unit build, the building is SIM state,
hashed, not runtime-private.

**Who builds.** A new ability `construct` in the enum, parsed as `canConstruct`. Carriers:
`demo_squad` (role `engineer`, "Combat Engineers"; #73 names construction as its third verb) and
`dozer_d9` (earthworks, rate ×1.5). NOT `yahalom_squad` (tunnel specialists) and not
`inf_squad` (Q3). Only the Yahalom mesh has a `work` clip today (`tools/units/rig.py:1357`,
`TEAM_CLIP_ADD` at `:2370`), so `demo_squad` needs one (Blender, 0 credits); until then
`meshClipOrFallback` plays `idle`. The builder is the selected `construct` unit(s); with none
selected, the nearest idle one; with none alive, the tile is disabled ("needs engineers").

**Cost currency: logistics only** (GDD §3: logistics *"Builds units and structures"*; intel buys
certainty and most missions grant none). `buildable.cost { logistics, intel? }` mirrors the unit
`cost` shape so `intel` stays expressible.

**Footprint validity** — `placementReason` returns null or the first failing rule, all integer:
1. inside the map; every tile `blocked === 0` (no building, ridge or wall) and `boulder === 0`
   (no boulder field or ditch: no footing, and a vehicle could never reach a workshop there);
2. flat: every footprint tile the same `elevation` level (a building on two levels terraces badly
   under `terrain/ground.ts`'s blocked-tile rule; relax to ±1 is Q6);
3. no overlap with another site or structure (`structureAt`, as `raiseMissionStructures` throws
   today, `mission.ts:1219-1225`);
4. no chokepoint seal: label the foot mask's 4-connected open components before and after; refuse
   if the footprint splits one (two flood fills of 2,304 cells). Barriers (#73) exist to shape
   movement and will opt out per type; buildings do not (Q5);
5. roads (`r`), groves (`o`) and knolls (`n`) are open ground and allowed; the cover under the
   footprint is lost and replaced by `rubble_cover` on collapse, as today.

Tunnels are NOT a placement rule: refusing a footprint over an unidentified route would leak it.
A vent under a standing structure surfaces its fighters at that structure's `exitTile`
(`sim.ts:4217-4229`) rather than inside it; today `stepSurfacing` writes the vent position with
no blocked test (`sim.ts:2829-2831`), so this is a Stage 4 fix (Q7).

**Lifecycle, in sim terms.**

| state | trigger | sim effect |
|---|---|---|
| **site** | `construct` accepted | a row in a fixed site table (`MAX_SITES` 8; type, footprint origin, side, paid cost); NOT blocked; drawn as the footprint pad (§6) |
| **staked** | first builder within `BUILD_RANGE` (2 tiles, `DEMO_RANGE_SQ`, `structures.ts:125`) | `addStructure` at `stProgress` 0, HP 10% of max: tiles blocked, ONE `recomputeFields` (§2) |
| **building** | each tick a builder is in range, alive, not moving, not pinned, not garrisoned | `stProgress += buildStep` per builder, max 2 builders; HP rises with progress; damage lands on `stHp` as on any building |
| **complete** | `stProgress === ONE` | aura, sensor and garrison switch on; `structureComplete` event |
| **wreck** | `stHp <= 0` | the existing `destroyStructure` (`sim.ts:4804-4830`), unchanged: unblock, rubble, garrison dies, collapse shock, one recompute |

Progress persists when builders leave or die (a staked site is a structure; another engineer can
resume). `buildStep = ONE / (build_time_s × 20)` precomputed once per type at load (integer
division, no `Math`). Staking waits while any LIVING non-builder stands on the footprint: a
FRIENDLY one is moved to the nearest open tile by the `exitTile` rule; an enemy or civilian
blocks staking (the pad reads "occupied"); garrisoned, carried and buried units are not on the
surface and are ignored.

**Cancel/refund.** A site not yet staked: 100%. A staked, unfinished structure: the unbuilt
fraction, `cost × (ONE − stProgress)`, and the structure is REMOVED — a new `removeStructure` that
unblocks without rubble, shock or garrison kill (nobody can be inside an unfinished building),
then one recompute. A complete building cannot be cancelled or sold (§0).

**Destruction.** `destroyStructure` unchanged. Friendly works carry `roe_penalty` 0, so the ROE
branch (`mission.ts:1413-1421`) charges nothing when the player levels its own; militia works
carry their own penalties (§5).

**Owned structures become targets.** Today a building is shot only while it holds an identified
hostile (`selectStructureTarget`, `sim.ts:3206-3237`). FW adds per-instance `stSide` (−1 neutral)
and a per-side latch `stKnown[side × MAX_STRUCTURES + s]`, set the first tick any unit of that
side has LOS to a footprint tile inside its sight (buildings do not move, so a latch, not a
ladder). `selectStructureTarget` then also accepts a living structure with `stSide` hostile to
the shooter and `stKnown` set, in the same fallback slot (only when no unit target,
`sim.ts:3535-3561`); `PROTECTED_ROE` (20, `structures.ts:135`) still exempts protected types from
initiative fire. The latch keeps an unseen militia OP hidden during recon.

## 2. Pathing

**No new path is needed: collapse already does this.** `addStructure` writes `blocked[t] = 1`,
`syncVehicleTile(t)` and calls `recomputeFields()` (`sim.ts:1358-1381`); `destroyStructure` does
the reverse (`:4810-4829`). `syncVehicleTile` (`:1290-1292`) re-derives `blocked | boulder` for
the vehicle mask when the map has boulders and is a no-op while the two masks are the same array
(`:1097-1099`, `:1260-1270`). `recomputeFields` (`:1296-1304`) recomputes every cached field of
both domains in place against `maskFor(d)`. Staking calls `addStructure`, cancel calls
`removeStructure` (same writes, same recompute), a wreck calls `destroyStructure`. The boulder
rule holds by construction: rule 1 refuses `boulder` tiles, so a footprint never sits on the one
place the two masks disagree.

**Determinism.** Construction is a command, applied at the tick's start (`applyCommands`, first
line of `tick()`, `sim.ts:1717`), so every replay stakes on the same tick. Flow fields are not in
the hash (`hash()`, `sim.ts:5150-5271`); `blocked`, `stAlive`, `stHp`, `stOccupants` are
(`:5154`, `:5243-5245`). FW adds to the hash: `stSide`, `stKnown`, `stProgress`, the site table,
and the aura modifier arrays (§3). **Hashing new arrays moves the golden hash once, even for a
replay that uses no field works** — the golden replay raises structures (`determinism.test.ts:
200`). That move lands in the same commit as the arrays, with its reason, per CLAUDE.md;
`pnpm balance` and `pnpm playtest` must stay byte-identical because no mission opts in until
task S9 (§10).

**Per-build cost.** One recompute per stake, cancel or wreck: up to `fields.length`
(≤ `MAX_FLOW_FIELDS` 128, `sim.ts:708`) calls to `FlowField.compute` on 48×48 (every shipped map).
`docs/PERFORMANCE.md` §"Sim tick cost" does not isolate a per-call cost; reading its
`flowField.compute` column as a per-tick average gives roughly 0.5–0.7 ms a call (inference), so
a full pool could cost ~65–90 ms in ONE tick, over the 50 ms budget. Collapse pays this today and
no measurement of it exists. Stage 4 task S2 measures `recomputeFields` at a full pool first; if
over 10 ms, recompute only fields a living unit follows (`fieldRef`) and drop the rest from
`fieldByGoal` so `fieldFor` recomputes them lazily. Hash-neutral: fields are not hashed and a
lazily computed field equals an eagerly computed one on the same mask.

## 3. The buildings, and one data concept

**One concept: an `aura` block on a structure type, with three optional scopes.** Four special
cases would be four engine features; this is one reader, and a new building is JSON.

| scope | who it touches | fields | read by |
|---|---|---|---|
| `area` | living, surface, non-garrisoned units of the OWNER's side within `radius` of the centroid | `radius`, `affects` (`foot`/`vehicle`/`any`), `heal_per_s`, `heal_cap`, `repair_per_s`, `repair_components_s`, `accuracy_mult` | new `stepAuras` |
| `garrison` | units inside this structure | `range_bonus` (tiles), `sight_bonus`, `supp_cover` | `selectTarget`, `detectionPair`, `applySuppression` via the unit's `garrisonedIn` |
| `sensor` | the structure itself, as an eye of its side | `sight`, `optics`, `tunnel_radius` | `stepDetection` |

An aura is live only while `stAlive`, `stProgress === ONE` and `stSide` is 0 or 1. Overlapping
auras do not stack: each field takes the MAX over covering structures (deterministic, order-free).
All values become Q16.16 at load in `structureTypeFromJson` (`structures.ts:80-95`); `foot` means
`moveDomain === DOMAIN_FOOT` and not air, `vehicle` means `DOMAIN_VEHICLE`.

**`stepAuras`** (new, between `stepGarrison` and `stepUpkeep`, `sim.ts:1731-1733`), at the §7
cadence, clears then fills four per-unit SoA arrays: `auraHealRate`, `auraHealCap`,
`auraAccMult`, `auraRepairTicks`. `stepUpkeep` reads them every tick, so healing stays smooth.

**Medic station** — `area: { radius 4, affects foot, heal_per_s 0.010, heal_cap 1.0 }`.
`stepUpkeep`'s regen (`sim.ts:5125-5130`) takes `cap = max(REGEN_CAP, auraHealCap[i])` and
`rate = max(REGEN_FRAC, auraHealRate[i])`: 33 raw a tick against the field's 16, ~2× field regen, to
full HP. **The delay is `REGEN_DELAY_TICKS` (10 s) and is not a field**: one rule for "under fire"
across the whole game, and no special case in `stepUpkeep` (a 5 s delay would let the station heal
mid-fight; at 10 s it heals between waves). New concept: none beyond the per-unit arrays.

**Outpost** — `garrison_slots` 3 (existing field) and `garrison: { range_bonus 1, sight_bonus 2,
supp_cover 3 }`. No soldiers are added.
- *Range* is **additive, in tiles, direct fire only**: `INDIRECT_MASK` weapons are excluded (a
  multiplier would put a garrisoned mortar at 20.7 tiles, past the Grad's 20). `selectTarget`'s
  `dSq > w.rangeSq` (`sim.ts:2729`) and the falloff ratio against `w.effectiveRange` (`:3623`) read a
  per-weapon bonused range when `garrisonedIn[i] >= 0`, squared once at load. +1 tile takes KDF rifles
  from 8 to 9: level with the Spike and the DShK, under the Kornet's 10.
- *Sight* `detectionPair` compares against `(sight + sight_bonus)²`. It must exceed the range gain
  (a squad sees 8), or the range bonus is dead. A garrisoned unit already sees out through its own
  building (`losRay` skips the origin structure, `sim.ts:2479-2480`).
- *No ROF bonus.* `ticksBetweenShots = toInt(1200/rof)` quantises: KDF rifles fire every 4 ticks,
  and any multiplier in (1, 1.33] gives 3, exactly +33%; the cooldown stays as it is. Measured, ROF
  ×1.2 on the militia's whole urban defence took urban 3:1 from 100% to **3%**. A fractional cooldown
  accumulator would be a sim change; not in v1.
- *Suppression cover.* Without this the garrison bonuses are moot: a MISSED round at a building
  lands at the nearest footprint tile, a 2×2 garrison sits 0.71 tiles from every tile centre (inside
  `NEAR_MISS_RADIUS_SQ`), and `applySuppression` reads the cover under the occupant, which on a
  building tile is 0. Three `inf_squad` garrisoned in a 2×2 held **0%** against a raid and killed
  none; the same squads in open cover 2 held 97% (**M**). `supp_cover` 3 makes occupants read
  `COVER_SUPP[3]` (0.09). **This depends on #280 (garrison suppression cover, Stage 4)**, which owns
  the sim rule: either this field or a sim-wide rule that occupants read their structure's protection,
  the latter also changing every shipped 2×2 building and moving `playtest`. FW declares the field
  and reads whatever #280 lands; **no garrison number here can be measured before it does.**

**Intel centre** — `sensor: { sight 10, optics 1.0, tunnel_radius 10 }`. Two sim paths and one
render path:
- *Units.* In `stepDetection` (`sim.ts:2875-2935`) a second observer loop over sensor structures
  runs `detectionPair`'s body with the structure's centroid, sight and optics, feeding the same
  `contact` array. The `contact` event's `observer` is an entity id, so a structure-sourced event
  carries `observer: -1` plus a new `observerStructure` (Q10).
- *Tunnels (the full 10, the lead's ruling).* A second identification path beside
  `markerSeeingRoute`, not a replacement: a route is identified to the owner's side when ANY of
  its tiles (`tnTiles`, the set `markerSeeingRoute` reads) lies within `tunnel_radius` of the
  centroid, **with no LOS test** (a sensor, not an eye). At 10, a centre built 5–9 tiles behind the
  start holds `deir_amun_2_foothold`'s pump route (its primary `collapse`), two of
  `beit_sahwan_4_subterranean`'s four routes and three of `deir_amun_3_subterranean`'s identified all
  mission (**M**, every flat 2×2 pad walked). The price is the allow-list rule (§4): **no intel centre
  in any mission that authors a `digs` or `in_tunnel` placement.** Routes are static, so on completion each
  sensor structure caches a 16-bit route mask (`MAX_TUNNELS` 16, `sim.ts:711`); the per-tick cost
  is one OR per structure. In the route loop (`:2939-2958`) the order is: sensor mask →
  `identifyTunnelTo(s, r, -1)`; else `markerSeeingRoute`; else the spoil ladder.
- *Persistence: held, not latched*, the same rule as `mark_tunnel` (`sim.ts:3140-3150`): while the
  centre stands, contact is pinned at identified; once it falls, contact decays down the existing
  ladder to `lost` in ~322 ticks. This keeps the playtest ruling that reversed frozen contact
  (`:2966-2976`) and makes the centre a target worth killing.
- *Fog* is render-side: `computeFog` reveals only living side-0 units (`packages/render/src/three/
  fog.ts:78`, `:101`). `FogInput` gains an optional `extraObservers` list (centroid, sight) that
  `main.ts` fills from side-0 sensor structures and outpost garrisons; three only (Pixi frozen).

**Workshop** — `area: { radius 4, affects vehicle, repair_per_s 0.010, repair_components_s 30 }`
plus a second area for `accuracy_mult 1.06, affects any`. This implements the declared `repair`
concept for the first time, as a structure effect: HP rises at 1%/s (33 raw a tick, a Lavi 30 hp/s,
30% to 100% in 70 s, ~2× field regen, the medic's factor) after the same `REGEN_DELAY_TICKS` 10 s
undamaged delay; `auraRepairTicks[i]` counts continuous covered, undamaged ticks and at
`repair_components_s` clears `mobilityKilled` and `firepowerKilled` (set by component damage,
`sim.ts:4015-4026`). 30 s is 1.5 Spike reloads (20 s), so a watched tank never repairs. A mobility
kill repairs only when it happened inside the radius, because the hull cannot drive in. The accuracy
multiplier joins veterancy in `hitFactors` (`sim.ts:3619-3622`): `accuracy × (1 + vet ×
VET_ACC_BONUS) × auraAccMult`, still capped at ONE. **1.06 is exactly one veterancy level**
(`VET_ACC_BONUS` 0.06, `tuning.ts:133`), so the card can say "fights one veterancy level up". No
damage term (the lead's ruling). The `area` scope therefore takes a LIST of effects (Q2 settles the
shape). Air units are excluded (`affects vehicle` means ground vehicle) because nothing lands.

## 4. Data model

**`data/schemas/structure.schema.json`** (`additionalProperties: false` at the type level, so
every key below is an explicit schema addition):

```json
"side":      { "type": "integer", "enum": [-1, 0, 1], "default": -1,
               "description": "Default owner of a structure of this type. Overridable per mission placement. -1 = neutral terrain, as the seven civilian types are." },
"buildable": { "type": "object", "additionalProperties": false, "required": ["cost", "build_time_s"],
               "properties": {
                 "cost": { "type": "object", "additionalProperties": false, "required": ["logistics"],
                           "properties": { "logistics": {"type": "integer", "minimum": 0},
                                           "intel": {"type": "integer", "minimum": 0} } },
                 "build_time_s": { "type": "number", "minimum": 1 },
                 "footprint": { "type": "array", "items": {"type": "integer", "minimum": 1},
                                "minItems": 2, "maxItems": 2, "default": [2, 2] },
                 "unlock": { "description": "unit.schema.json's unlock shape (:89), hoisted to a shared $defs" } } },
"aura":      { "type": "object", "additionalProperties": false, "properties": {
                 "area":     { "type": "array", "items": { "$ref": "#/$defs/area_effect" } },
                 "garrison": { "$ref": "#/$defs/garrison_effect" },
                 "sensor":   { "$ref": "#/$defs/sensor_effect" } } },
"construction_mesh": { "type": "string", "description": "Presentation only." }
```

`$defs.area_effect`: `radius` (0.5–12), `affects` (`foot`|`vehicle`|`any`), and any of
`heal_per_s`, `heal_cap` (0.7–1.0), `repair_per_s`, `repair_components_s`, `accuracy_mult`
(1.0–1.25). There is no delay field: heal and repair wait `REGEN_DELAY_TICKS`, the game's one rule.
`garrison_effect`: `range_bonus` (0–1 tiles, direct fire only), `sight_bonus` (0–4), `supp_cover`
(integer 0–3, the cover tier the occupants read for suppression; needs #280). There is no
`rof_mult`: the 20 Hz cooldown makes it a +33% step (§3). `sensor_effect`: `sight` (1–14), `optics` (0.5–2), `tunnel_radius` (0–14).
Ceilings sit at or under the roster maxima (sight 16 is the roster max per the E5 spec). A
`buildable` type must have `side` 0; `validate_data.mjs` enforces it.

**`data/structures.json`** gains eight types: `kdf_medic_station`, `kdf_outpost`,
`kdf_intel_centre`, `kdf_workshop` (all `side` 0, `buildable`, `roe_penalty` 0) and
`militia_field_clinic`, `militia_firing_position`, `militia_observation_post`,
`militia_weapons_workshop` (`side` 1, no `buildable`). Each needs a unique `symbol` (the map
legend) even though none will be drawn into a map grid: proposed `M O I W` and `C F P X` after
`validate_data.mjs`'s cross-check against the terrain legend. Example:

```json
"kdf_medic_station": { "id": "kdf_medic_station", "name": "Medic Station", "symbol": "M",
  "hp_per_tile": 200, "garrison_slots": 0, "rubble_cover": 1, "height_px": 12,
  "color": "olive.1", "roe_penalty": 0, "side": 0,
  "buildable": { "cost": { "logistics": 250 }, "build_time_s": 20, "footprint": [2, 2] },
  "aura": { "area": [ { "radius": 4, "affects": "foot", "heal_per_s": 0.010,
                        "heal_cap": 1.0 } ] } }
```

**`data/schemas/mission.schema.json`:**
- New root key `field_works`: `{ "type": "object", "additionalProperties": { "type": "integer",
  "minimum": 0, "maximum": 2 } }` — structure type id → how many the player may raise; **default
  1 per listed type, schema max 2** (8 sites = 4 types × 2 = `MAX_SITES`; at 4 the cap is
  unreachable, income being ~1,240 a mission). **Absent means none**, so every shipped mission is
  unchanged and `playtest` stays byte-identical. **Allow-list rule (lead, 29 Sep): a mission that
  authors a `digs` or `in_tunnel` placement must not list `kdf_intel_centre`** — a rule, not a
  convention, so `validate_data.mjs` enforces it alongside checking that each key is a `buildable`
  type and that `starting_force` or production can field a `construct` carrier.
- `structures[]` items (`:603-640`) gain `side` (−1/0/1, default: the type's). An authored enemy
  structure is `{ "type": "militia_observation_post", "at": [22, 9], "size": [1, 1] }`; `side`
  is only written to override. Garrisons use the existing placement `stance: garrison` with an
  `at` tile of the building (`:760`). A pre-built KDF work at a FOB is the same entry with a
  `kdf_*` type.
- Militia works are ordinary structures for objectives: `raze` already snapshots the structures
  in its zone at start (`mission.ts:490-497`), so "destroy the weapons workshop" needs no schema
  change.

## 5. Militia equivalents

Authored with `structures[]` and `side` 1; same `aura` reader; never built.

| type | aura / garrison | role for the author | ROE if the player levels it |
|---|---|---|---|
| `militia_field_clinic` | `area` foot heal 0.75%/s to 1.0, radius 3; HP 800 | defenders who fall back to it come back; a clearance needs to cut it off | **6**, the `clinic` figure (`data/structures.json`); below `PROTECTED_ROE`, so a cost, not a ban (Q8) |
| `militia_firing_position` | `garrison_slots` 3; `range_bonus` 0.5, `sight_bonus` 1, `supp_cover` 3; HP 1,200 (300/tile) | a sandbagged strongpoint to breach or bypass | 0 |
| `militia_observation_post` | `sensor { sight 9, optics 1.2 }` (no tunnel radius), 1×1, HP 300, `garrison_slots` 0 | spots for mortars and the Grad: indirect fire already needs only its SIDE's identification (`INDIRECT_MASK`, `selectTarget`), so a sensor structure is a spotter with no new rule | 0 |
| `militia_weapons_workshop` | `area` vehicle repair 0.75%/s, components 45 s + `accuracy_mult` 1.06 any, radius 4; HP 1,200 | keeps technicals and gun trucks in the fight; a raze target | 0 |

The militia's range bonus is +0.5 tile, not +1: that keeps the firing position at 7.5, under the KDF
rifle's 8, and +1 is a cliff (an AT-led assault against it went from 100% falls to 0%, **M**). Like the
outpost, its garrison numbers wait on #280.

**The observation post and the Tel Marum finding.** When this spec was written, CLAUDE.md recorded
that the Grad cannot price Tel Marum III's corridor because *"every post that can see the corridor
stands inside the corridor's own weapons"* and dies in ~48–59 s, and that *"unkillable permanent
contact"* takes the corridor to 1.20 losses a run, level with the pass. **That premise no longer
holds on `main`** (re-measured 2026-09-30, PR #300): since group formations (`1ea1094a`) the flank
files up the corridor as a column, the shipped `tm_spotter_narrow` survives to ~155–162 s, and the
Grad already prices the corridor at **3.10** losses a run against the pass's 3.80. The probe's
`perfect eyes` row (2.60) is no longer a ceiling either. The OP's case therefore has to be re-made
against those numbers, not the old ones. What stands is the structure argument:
`small_arms` does 0.01 of damage to a structure (`STRUCT_DAMAGE`, `structures.ts:103-116`), so the
flank's rifles cannot shoot it off its hill; two hits from an RPG, a mortar or a Spike kill it.
**Sight 9** (`sarim_rifles`' own, inside a Spike's 9) is the approved compromise: a sight 11 post
would sit outside the flank's rifles (8) and Spike (9) while it spots. Even so, do not add one to
`tel_marum_3_clearance` without re-running `tools/src/backtest/saddle-price.ts` (probe
`fw-op-saddle`). The corridor is already priced without it; whether it should cost MORE, and by
how much, is a design call.

**Candidate missions** (for `mission-author` in task S9, each needing a `playtest` plan update):
- OP: `umm_zeitoun_3_clearance`, `umm_zeitoun_4_clearance`, `qarn_hadid_2_foothold` (Sur,
  standoff doctrine; all field `rocket_battery`); `khan_rafid_3_clearance` (Marj, `mortar_crew`).
- Firing position: `qarn_hadid_2_foothold` (already raises a `concrete`), `khan_rafid_2_foothold`.
- Field clinic: `beit_sahwan_3_clearance`, `khan_rafid_3_clearance` (both flag clinic ground
  for ROE already, a clean pairing).
- Weapons workshop: `wadi_halam_5_depot` (Rif technicals; its `raze` zone is the natural home),
  `wadi_halam_3_counterraid`.
- KDF allow lists: **seven** missions, not six: the five `*_2_foothold` (`beit_sahwan`, `deir_amun`,
  `khan_rafid`, `qarn_hadid`, `tel_marum`), `umm_zeitoun_2_buildup` and `wadi_halam_2_laager`.
  `beit_sahwan_2_foothold` and `deir_amun_2_foothold` author tunnels, so they list the medic
  station, outpost and workshop and **no intel centre**; the other five may list all four. The
  subterranean missions (`beit_sahwan_4`, `deir_amun_3`) list no `field_works` at all.

## 6. UI (G-MOCK)

**Where.** A third tile group, "Field works", in the reinforcements dock
(`packages/app/src/ui/production.ts`), after the support tiles (`:85-104`); shown only when the
mission's `field_works` is non-empty. Each tile: mark, logistics price (the ▣ convention), the
count left (`2/2`), and `tileState`'s locked/unaffordable/"needs engineers" states from
`dock-model.ts`.

**Placement flow.** `SupportKind` (`:29`) widens to `'sweep' | 'strike' | { works: string }`;
clicking a tile calls `onArm` (`:50`), and `main.ts`'s single armed slot (`armedSupport`,
`main.ts:3021`, handler `:3074`, click `:3305-3322`) owns the next map click, so arming works
disarms an armed order and vice versa, as today (`:2508-2511`).
1. A **gridded footprint outline** snaps to the tile under the cursor (anchored top-left, drawn
   centred): a flat pad with the tile grid visible, team colour at 0.38, no volume ghost.
2. It tints valid/invalid from `placementReason` each frame (a pure read, no command): invalid
   is `team.hostile` with the ring at hover strength (0.6), and the reason is the cursor tooltip
   ("occupied", "not level", "would seal the passage").
3. The aura radius (and the sensor radius for the intel centre) draws while armed, as a
   **dashed ring with no fill** (2 px stroke at 0.7). The intel centre draws its sight ring dashed
   and its tunnel ring dotted in `dust.6`; at the approved 10/10 they coincide, so the tunnel ring
   sits a few screen pixels outside and a tooltip legend names both.
4. Click commits: `requestConstruct`; the feed line names the builder. The key stays armed on
   Shift-click for a second placement.
5. **No rotation in v1**: all eight footprints are square (2×2, the OP 1×1).
6. Cancel: Escape or right-click disarms (#268). Cancelling a site: select the structure, a
   "Cancel works (refund N)" button on the structure card.

**Radius display — only while placing, selected or hovered** (the lead rejected permanent in-world
status marks). **Treatment B (G-MOCK, 29 Sep): gridded footprint outline plus a dashed aura ring
with no fill**; treatment A (translucent volume ghost, filled disc) was not chosen. B needs a **new
dashed-arc overlay primitive**: `OverlayBatch` has only the full `ellipseRing` and
`ellipseAnnulusFill`, so the range-ring renderer behind `rangeRingPreview` (`packages/render/src/
api.ts:426`) cannot dash. The new `auraRingPreview: { cx, cy, radius, style: 'dashed' | 'dotted' }[]`
uses it, fed from the hovered structure (`hoverStructure`, `:416`) or the selected one; `dust.6`
for the tunnel ring needs a new render colour key (no semantic token names it), and the invalid
tint uses the existing `team.hostile`. Three only. No icon over a unit being healed; the
unit card gets a status chip ("Medic: healing", "Workshop: repairing") in the HUD, the approved
place for status.

**Feed and voice.** Feed keys `feed.works.started|complete|destroyed|cancelled|refused`,
interpolating the type's display name (escaped, as `hud.ts:986-988` requires). Voice: the
engineer's acknowledge on commit reuses the existing move/ack families; a works-specific call
(`he.engineer.construct`) waits on the D5 licence like the rest of WP-AU1.

**Sandbox.** A `&works` flag in `packages/app/src/sandbox-help.ts`'s table (the single source for
all four callers) grants every buildable type ×2 and one `demo_squad`, sandbox-only.

## 7. Performance

At the 300-unit target the whole tick is 2.08 ms, detection pairwise 1.17 ms for ~90,000 pairs
(`docs/PERFORMANCE.md`, "The main curve").
- **Areas.** `S_area × N` squared-distance tests. With ≤ 12 aura structures on a map (8 works
  plus authored militia) that is 3,600 tests an evaluation. **Cadence: every 10 ticks (0.5 s)**,
  phase-locked to `tickCount % 10 === 0`: ~360 tests a tick, well under 1% of detection. A unit
  entering a radius waits up to 0.5 s for its effect; heal and repair accrue per tick from the
  cached rate, so the total is exact.
- **Sensors.** In `stepDetection` every tick (the ladder's `DT` assumes it): `S_sensor × N`
  `detectionPair` calls with a `losRay`, ≤ 4 × 300 = 1,200, ~1.3% of the pair loop, ~0.02 ms.
  Tunnels: a cached route mask, one OR per sensor per tick.
- **Garrison bonuses.** Read at the call sites; no loop.
- **Owned-structure latch.** Only for owned structures not yet known to a side, stopping once set.
- **Recompute on stake/cancel/wreck.** The one real risk (§2): measured first in S2.

## 8. Art

Eight buildings, each with three states: standing, under construction, wreck.

| state | method | credits |
|---|---|---|
| 4 KDF standing (medic tent + container, sandbagged outpost with a firing parapet, container intel centre with a mast and dish, open-sided workshop with a gantry) | Meshy preview + texture + remesh (style bible §4: 20 + 10 + 5) | 4 × 35 = 140 |
| 4 militia standing | Meshy for the two new silhouettes (OP tower, weapons workshop) at 35 each; field clinic and firing position kit-bashed in Blender from `clinic.glb`/`shanty.glb` and sandbag parts | 70 |
| 8 under construction | Blender: the standing mesh's lower half, a scaffold and pallet kit shared by all eight, driven by `stProgress` as a height clip | 0 |
| 8 wrecks | Blender, the existing `_wreck` pattern (`art/meshes/buildings/*_wreck.glb`) | 0 |

**Estimate: 210 credits planned; ceiling 420** (one re-roll each, or all eight on Meshy). The lead
approves the number before any call (meshy-api-policy); each call is announced with its cost.
Textured Meshy bakes ship `base_color` only through the named `TEXTURED_BUILDING_TYPES` /
`TEXTURED_MESH_EXEMPT` pair (CLAUDE.md), so each new textured building extends BOTH lists and
`textured-building.test.ts`; palette buildings avoid that. Recommend: KDF works palette-painted
(olive, reads as the brigade's), militia works textured (Q11). Wiring: `BUILDING_MESHES`
(`packages/app/src/mesh-catalogue.ts:209-222`) gains eight entries plus a `construction` key;
`pnpm validate:meshes` runs facing and IoU (a `glass` role on the intel centre's cabin makes it
facing-judgeable); AI art is disclosed in the PR. Three only: `renderer.ts` is frozen and Pixi
draws new types through its generic fallback.

## 9. Balance (G-NUM, approved 29 Sep)

Approved as proposed by `balance-analyst`, with one lead override (N6b, the tunnel radius). Economy
context: a foothold grants 400–600 start + 80–150/min (`beit_sahwan_2_foothold` 400 + 120/min, ~1,240
over 7 minutes); the four KDF works together cost 1,300, about one mission's income, so the realistic
buy is one or two. `inf_squad` costs 292. **M** measured on the real sim, **E** estimate (the probe
named must measure it in Stage 4).

| id | number | approved | basis |
|---|---|---|---|
| N1 | medic cost / time / footprint / HP | 250 / 20 s / 2×2 / 800 (200/tile) | under a squad; worth 1–2 squads of HP a mission. **E**, `fw-medic-lull` |
| N2 | medic radius / rate / cap / delay | 4 / 1.0%/s (33 raw) / 1.0 / 10 s | ~2× field regen (16 raw); squad 30% → full in 70 s. Delay is `REGEN_DELAY_TICKS`. **E**, `fw-medic-lull` |
| N3 | outpost cost / time / HP / slots | 350 / 30 s / 1,600 (400/tile) / 3 | the swing position in a heavy raid (0% → 53–63% hold); 2× a medic's HP per tile. **M** |
| N4 | outpost range / ROF / sight / suppression | +1 tile direct fire only / none / +2 / `supp_cover` 3 | rifles 8 → 9, level with the Spike, under the Kornet's 10. ROF quantises to +33%. **M**; depends on #280 |
| N5 | intel centre cost / time / HP | 400 / 40 s / 1,000 (250/tile) | the priciest work; 1.9× a `recon_drone` (210), a permanent eye |
| N6 | intel sight / optics / tunnel radius | 10 / 1.0 / **10** | a parked Eitan's 10/1.0; identifies a still militia in cover 2 in ~27 s, a moving one in ~9 s. The tunnel radius is the lead's, over the analyst's 6: at 10 it trivialises the tunnel missions, hence the §4 allow-list rule. **M** |
| N7 | workshop cost / time / HP | 300 / 30 s / 1,200 (300/tile) | open-sided gantry, `camp`-grade per tile |
| N8 | workshop repair / delay / components / accuracy | 1.0%/s (33 raw) / 10 s / 30 s / ×1.06 | Lavi 30 hp/s, 30% → 100% in 70 s; 30 s is 1.5 Spike reloads; ×1.06 = one veterancy level (8v8 exchange 1.076; urban 2:1 with the whole assault buffed ×1.08: 63 → 72%). **E** (repair), **M** (accuracy); `fw-workshop-pk` |
| N9 | build range / builders / D9 rate / start HP | 2 tiles / 2 / ×1.5 / 10% | reuses `DEMO_RANGE_SQ`; two builders halve the time |
| N10 | refund | 100% site, unbuilt fraction after | no sell (§0); a 90%-built outpost refunds 35 |
| N11 | allow-list max per type | 1 default, schema max 2 | 8 sites = 4 types × 2 = `MAX_SITES` |
| N12a | militia clinic | 0.75%/s (25 raw), cap 1.0, delay 10 s, radius 3, HP 800 | weaker than the KDF station in rate and reach; ROE 6 stands |
| N12b | militia firing position | +0.5 tile, no ROF, sight +1, `supp_cover` 3, HP 1,200 (300/tile), 3 slots | range 7.5 stays under the KDF rifle's 8; +1 is a cliff. **M**; depends on #280 |
| N12c | militia OP | 1×1, sight 9, optics 1.2, HP 300, no tunnel radius | sight 9 = `sarim_rifles`, inside a Spike's 9, so the Tel Marum finding survives. **M**, `fw-op-saddle` |
| N12d | militia weapons workshop | 0.75%/s (25 raw), components 45 s, ×1.06, radius 4, HP 1,200 | Rif technicals repaired slower than KDF armour; defenders ×1.08: urban unchanged. **M** |
| N13 | aura cadence | 10 ticks | §7; ~360 tests a tick, under 1% of detection |
| N14 | works unlock (credits) | none in v1 | the engineer is already the gate (`demo_squad` Conduct 77 / 360; D9 87 / 560) |

**Interaction with the harnesses.** The §5.7 targets are unaffected: `pnpm balance` names six unit
ids and no structures, so it must stay byte-identical through S1–S8. `pnpm playtest` is
byte-identical until S9, because no shipped mission lists `field_works` or a militia work. At S9
each adopting mission re-runs its plan ladder (`playtest` agent), and the endure-clock band
(0.70–1.00 of target, CLAUDE.md) is the check for footholds: a medic station that turns a
survive-until into a walkover shows as a passive plan winning. **Probes** (`tools/src/backtest/
field-works-probes.ts`, S8), bands fixed from the baselines at G-NUM, never after:
- `fw-medic-lull` (a): 1:1 and 2:1 urban with and without a station behind the attacker, with a
  scripted fall-back, plus a `hold_for` wave replay; 2:1 stays ≤ 85% and ≥ 15 pp under 3:1.
- `fw-garrison-supp`: a 2×2 garrison fires (kills > 0) against a raid; a regression pin for #280.
- `fw-outpost-raid` (b): light and heavy raid against 3 `inf_squad`; heavy hold 40–80% (measured 63%).
- `fw-fp-assault`: 4 inf + mortar and 4 inf + AT against the firing position; the AT arm falls ≥ 80%.
- `fw-urban-garrisoned`: urban ratio with the militia bonus on all defenders passes §5.7 (0/42/100/100).
- `fw-op-saddle` (c): Tel Marum's saddle price with a militia OP at the best post (§5).
- `fw-workshop-pk` (d): per 100 Spike penetrations, how many hulls fight again within 120 s with a
  workshop at 3 and at 12 tiles; `destroy` stays final, only mobility/firepower kills return.
- `fw-tunnel-radius`: the walk of every flat pad, as a test that no allow-listed mission has a
  safe pad covering a route a primary needs.

*Mission difficulty must be measured*: losses compound by design, and a medic station is a direct
lever on that compounding.

## 10. Phasing

**October — no sim change** (lane B / C design):
- **D1** this spec, GH-115/GDD §10 and §4 wording (§0), HANDOVER line. Docs PR.
- **D2** G-NUM: `balance-analyst` reviews §9 against the economy anchors; lead approves. **Done 29 Sep.**
- **D3** G-MOCK: a static placement mock (pad, valid/invalid tints, radius, dock group, unit-card
  chip) for the lead; no app code. **Done 29 Sep: treatment B.**
- **D4** Meshy estimate to the lead (§8), then batches after the October credits; Blender
  construction and wreck states; `validate:meshes` green. Meshes land UNWIRED (no
  `structures.json` entry yet), so nothing reads a field no sim reads.

**Stage 4 (November) — one `sim-guard` stream**, sequenced with E6's placed charge (#274), which
also extends per-structure SoA:
- **S1** `stSide`, `stKnown`, owned-structure targeting; hash moves once, with the reason.
- **S2** measure `recomputeFields` at a full pool; lazy invalidation if needed; `removeStructure`.
- **S3** `construct` command, site table, staking, progress, cancel/refund, `placementReason`,
  `canConstruct`; `requestConstruct`; the vent-under-structure fix (Q7).
- **S4** `aura` parse, `stepAuras`, regen/repair/component/accuracy hooks, garrison bonuses
  (range, sight, `supp_cover`; the garrison half waits on #280).
- **S5** sensor: detection observer, tunnel identification path, `observerStructure`.
- **S6** schemas, `structures.json`, `field_works`, `structures[].side`, `validate_data.mjs`
  (including the no-intel-centre-with-tunnels rule).
- **S7** app: dock group, placement flow, aura ring, card chip, feed, `&works`; render:
  construction state, fog `extraObservers`, mesh wiring, the dashed-arc overlay primitive (§6).
- **S8** probes (§9) and bands.
- **S9** missions adopt, with `mission-author` and `playtest`.

**Risks.** R1 the recompute spike (§2), unmeasured today for collapse too. R2 medic and workshop
blunt the "losses compound" design; the radius, the 10 s delay and the caps are the brakes,
measured by S8. R3 component repair weakens §5.4's mobility/firepower kills; 30 s undamaged is
the brake. R4
chokepoint sealing if rule 4 is dropped. R5 a militia OP silently reprices Tel Marum (§5). R6
hash churn from E6 and FW both touching structure SoA: one stream, one determinism review. R7 no
Pixi path for the new types. R8 building works on engineers who are locked in a fresh campaign
(`demo_squad` gate: Conduct 77 or 360 credits); a mission listing works must field one.

## 11. Open questions (each with a recommended default)

Questions the 29 Sep gates answered are marked **answered**; the rest stay open.

| # | question | default |
|---|---|---|
| Q1 | Which units carry `construct`? | `demo_squad` and `dozer_d9` (×1.5) |
| Q2 | One `aura` block with `area`/`garrison`/`sensor` scopes, `area` a list | yes |
| Q3 | Give `inf_squad` `construct` so every mission can build? | no: engineers only; a listing mission fields one |
| Q4 | Blocked on staking or on order? | on staking (first builder arrives) |
| Q5 | Refuse a footprint that splits the open ground (chokepoint seal)? | yes for buildings; barriers (#73) opt out |
| Q6 | Footprint elevation tolerance | 0 (flat pad) in v1 |
| Q7 | A tunnel vent under a structure | allowed (no info leak); fighters surface at `exitTile` |
| Q8 | Militia field clinic ROE | 6 (as `clinic`), not protected. **Answered (G-NUM): stands** |
| Q9 | Intel centre also generates intel (GDD §3's "SIGINT structure ~12/min")? | no: #73's "a structure that produces anything" line |
| Q10 | Structure-sourced contact/tunnel events | `observer: -1` + `observerStructure`; objective contribution credits nobody |
| Q11 | KDF works palette-painted, militia works textured | yes |
| Q12 | `field_works` shape: list or type → max count | type → max count, absent = none. **Answered (G-NUM): default 1, max 2; no intel centre where `digs`/`in_tunnel` are authored** |
| Q13 | Can a KDF work be pre-placed by a mission (a FOB)? | yes: `structures[]` with a `kdf_*` type |
| Q14 | Owned structures known to the enemy by sight latch, or always | sight latch |
| Q15 | Enemy AI targets works deliberately (trigger `do`)? | no new verb in v1; the fallback slot only |
| Q16 | Garrison suppression cover: a `garrison.supp_cover` field, or a sim-wide rule that occupants read their structure's protection? | #280 decides (Stage 4); FW reads the field either way. **Answered by ruling: garrisons depend on #280** |
