# Civilian drama: crowds, threats and the compound gate

**Date:** 2026-11-18 · **Status:** design. Q1 to Q3 are RULED (18 Nov, below) and D18 is written into `storyline.md`;
Q4 to Q11 stay **HOLD FOR LEAD** and nothing else here is canon or scheduled until the lead answers §7. **Written against** `origin/dev` at `93448908f`; every
code claim cites a file and line range read this session. Claims not read are marked
**UNREAD**; estimates are marked **ESTIMATE**.
**Contract:** `docs/campaign/README.md`. **Canon:** `docs/campaign/storyline.md`.
**Downstream:** `level-scripter` (ECA rows, gap classification), `narrative-designer`
(labels, `say` lines, register), `mission-author` (JSON), `sim-guard` (engine gaps),
`render-vfx` / `blender-art` (gate, crowd), `playtest` (passive probe, margins).

**The lead's request (18 Nov 2026), in substance.** Civilians are too passive. In the first
mission, instead of three people standing outside the camp, about 100 run for the compound
while the enemy shoots some of them or abducts them. The compound has huge yellow heavy
metal gates that open only when KDF soldiers come close. Wherever there are civilians there
should be many, and the enemy should do something bad to them that needs the KDF's help at
once.

**Rulings of 18 Nov 2026 (the lead, relayed by the PM).**
- **Q1: Option A, adults only.** Decision D18 is written into `docs/campaign/storyline.md` §0.2 exactly as §7 words it (with the
  follow-on edits of §9.5 that follow from it: D12 "in play, within D18", the breach twist T1 and the `execute` verb retired, rule 7
  of §2.4). Enemy troops may fire toward running civilians, who fall and lie still; groups may lead civilians away on foot or by
  vehicle to the map edge; no harm to the taken, no blood or body effect beyond the shipped `down` pose, adults only. The story voice
  names only "fell", "taken" and a number. The GDD §11 reconciliation of §9.5 is NOT yet made (it needs a GDD version bump) and stays
  an open follow-up.
- **Q2: the pilot is `beit_sahwan_breach`**, not `beit_sahwan_1_recon`: its compound already exists (`marj_perimeter`, with its wall
  gaps) with 11 civilians, growing toward about 100. Sections 6 and 10.1 were written for recon; the pilot script must be re-derived for
  the breach (new numbers, and Q11, the canon "eleven, two counted in, nine not", is now live: §9.6 N5 recommends keeping the
  ratio's meaning, and the lead has to restate or keep the numbers).
- **Q3: each front's own enemy does it**: the Ashwar on the Marj, Sarim on Sur, and so on; never one doctrine everywhere.
- **Also done in this change:** the two shipped text bugs of §9.4 are fixed (`wadi_halam_1_fords` said "Four of them off the ford"
  when the objective counts three; `wadi_halam_4_village` said "Every one of them is at the refuge" when it counts three of four;
  the English catalogue is regenerated and the two German lines changed to match, AI-translated and not proofread), and the
  `evacuate_before` over-count is recorded as gap **G-6** (§4).
- **Rulings from the lead's 5-point review of this design (18 Nov, relayed by the PM):**
  1. **The rescue clock is allowed.** A downed civilian bleeds out over 60 s unless rescued (the existing wound system), shown only as
     the `down` pose. D18 now carries the clause: "a downed civilian may be rescued before they are lost; nothing is shown beyond the
     `down` pose."
  2. **Q11 is KEEP** ("eleven" stands: eleven, two counted in, nine not), **conditional on E3**.
  3. **E3** (group-scoped counting, `collect` scoped to active objectives) is **the first and largest engine piece**.
  4. **The pilot's frame cost is measured before anything else ships** (up to 180 living entities; this answers Q5).
  5. **Order:** data first; the vehicle snatch (T3, with E9's vehicle pieces and G-9) is DEFERRED; `road_in` stays thin (a small bonus, not
     a second win condition); the E13 force-to-gate rule is RELAXED (one `at_team` stands 4.61 tiles from the west gate).
- **Fixed in this revision:** the stale Q2 recon text in section 7 is marked superseded; the `mission.ts:4846` citation (the `evacuatedCount`
  comparison is at `mission.ts:4843`); the two stale German overlay hashes (`wadi_halam_1_fords` `objective_say.get_the_carriers_out`,
  `wadi_halam_4_village` `objective_say.evac_families`) now equal the current English.
- **Still HOLD FOR LEAD:** Q4 (the 256-entity cap), Q6 (scoring on the after-action report), Q7, Q8, Q9 and **Q10** (art numbers: the gate is
  a Blender build at 0 credits, six Meshy civilian variants at about 240 to 420 credits, nothing spent until the lead approves the spend).

**The one-line answer.** Most of this is buildable. The crowd, the time pressure, the scoring
and a "blocked road" threat can ship as data today. The gate needs one medium sim change. Two
parts go past the content line the lead approved in September: enemy fire **aimed** at
fleeing civilians, and a **visible** abduction. §7 Q1 asks the lead to choose between moving
that line and keeping it. Every piece is labelled with the answer it depends on.

---

## 1. The pattern

### 1.1 The four beats

| beat | what happens | mechanism | today? |
|---|---|---|---|
| **Flight** | At about t=2 s the crowd (8–100 people) runs from where it lives to a **muster**: a gate apron, a wadi mouth, a road junction. The muster is outside the refuge zone | a `withdraw_to` trigger on the civilians' `group`, which queues a plain `move` for every living member (`packages/sim/src/mission.ts:4552-4568`). Civilian placements register their `group` like any other side's (`mission.ts:3905-3918`) | schema yes; **no shipped mission does it yet** (the only triggers on civilian groups are four `remove`s, census below), so it is unproven in play |
| **Threat** | One or two of the threat types in §1.2 act on the crowd | §1.2 | per type |
| **Help** | The KDF reach the crowd. A ground soldier within 4 tiles walks a family to the refuge (`civilians.ts:200-215`, `SHEPHERD_RADIUS_SQ` at `civilians.ts:33`). Civilians board a KDF carrier with free seats within the same radius (`civilians.ts:219-238`): Namer 5 seats, Eitan 2, Kipod 6 (`data/units/kdf/*.json` `transport_slots`). Where there is a compound, the gate (§2) opens only for KDF | the shipped `CivilianFlight`, on in any mission with an `evacuate_before` (`civilians.ts:50-52`) | yes |
| **Count** | `evacuate_before` counts the people who reach the refuge zone. It fails at its deadline (`mission.ts:4830-4848`). Those still outside at the deadline are taken (`remove`, the shipped pattern) | shipped | yes |

**Why the muster is the anti-passive rule.** Mass flight is new, and it brings a trap with it.
If a crowd ran straight to the refuge it would count itself in, and a passive player would win
`evacuate_before`. So **a crowd never runs into its own refuge zone.** It runs to a muster
outside it and waits there. Only one of two things moves it the rest of the way: a KDF ground
unit within 4 tiles (the shepherd rule), or an open gate plus a shepherd. A KDF force sitting
at its start line must stand more than 4 tiles from every muster and every gate. `playtest`'s
passive probe is what proves it, per mission.

### 1.2 Threat types

Each mission picks one or two, so 25 missions do not play the same. Each type has an **A form**
(the content line moved, §7 Q1) and a **B form** (the line kept). Loss ceilings are the
ESTIMATE used to set the margins in §3, to be replaced by `playtest` measurements.

| id | name | A form (line moved) | B form (line kept) | the player's decision | competent loss ceiling (ESTIMATE) |
|---|---|---|---|---|---|
| **T1** | **Firing line** | 1–2 enemy cells overlook the run and fire on the crowd while no KDF target is in their range. A civilian who is hit **falls** (the shipped `down` state, `data/units/civilians.json` `wounds.in_place: true`, `bleed_s` 60) and lies until a medic reaches him. KDF presence draws the fire. **Needs G-4** | **Crossfire.** Enemy fire aimed at KDF soldiers moving with the crowd (a mortar or rocket on an observer) lands among the civilians. Splash hurts them; enemy-caused deaths cost no Conduct (`mission.ts:4050-4056` charges only `st.side[e.by] === 0`). **Today** | draw the fire, or smoke the lane (100 Intel), or keep the soldiers away from the crowd; the mortar on the line is quick and danger-close (`DANGER_CLOSE_SQ`, 2 tiles, `mission.ts:794`) | A: 12–15% downed; B: 5–10% |
| **T2** | **Abduction column** | A small escort walks a separate captive group toward an exit zone at the map edge. Reaching the column frees the captives. If they reach the exit they are `remove`d as taken. Today this can only be approximated (§4 G-5); doing it properly needs G-5 | **Deadline taking.** Whoever is still outside at the deadline leaves play as taken. This is the shipped pattern in `beit_sahwan_breach` (272 s), `khan_rafid_1_recon` (250), `qarn_hadid_1_recon` (250) and `umm_zeitoun_1_recon` (242). The feed names each one taken (`mission.ts:4607-4640`). **Today** | split the force: a detachment intercepts the column, or everyone holds the run | A: the column's size, ≤15% of the crowd; B: 0% to a competent player |
| **T3** | **Vehicle snatch** | A technical (3 seats, `data/units/enemy/technical.json`) loads civilians and drives for the exit. Stop it short of the exit, which today means a `dismount` trigger, or immobilise it. Killing it outright is the ROE cliff (storyline T9). **Needs G-9** | not used; substitute T4 | catch a 2.6 t/s truck with the right weapon, not the biggest one | A: 3 per technical, ≤2 technicals |
| **T4** | **Blocked road** | as B | A mission-raised barrier (`structures[]`) and a `hold_position` group close the short route between the muster and the refuge. The crowd stalls behind the barrier, in the open. The tank gun breaks the barrier fast but is danger-close to the crowd. The demo squad is slow and costs nothing (an explicit `demolish` order; a low-profile barrier is never demolished on a sapper's own initiative, `sim.ts` `stepDemolition`, the `lowProfile` skip). **Today**, except that per-tile barrier placement by `structures[]` is UNREAD (G-19) | breach by hand or by gun | 0% direct; exposure time only |

**Time pressure** in every type is the `evacuate_before` deadline. Nothing else is needed.
**KDF payoff, scored:**
- civilians saved, the primary count;
- the most saved, a secondary count;
- captives recovered, a `hostages: true` count, which writes `civ.hostages_recovered` (`mission.schema.json:404-407`, `mission.ts:4988-5012`) and is only honest after G-6;
- Conduct credit, +3 per wounded civilian the KDF admit or evacuate (`tuning.ts:593`), capped at +10 a mission (`tuning.ts:595`).

§4 G-14 covers what the grade does not see.

---

## 2. The compound gate

### 2.1 What it is

A structure type, `compound_gate`: a heavy yellow two-leaf metal gate set into a wall gap, 2
tiles wide and 1 deep. It opens when a living KDF ground unit comes within `open_radius_tiles`
(4) of its centre. It closes once none has been within that radius for `hold_open_s` (3 s) and
nobody stands in it. Data-driven; no mission TypeScript.

### 2.2 Data and schema

`data/schemas/structure.schema.json` gains one optional block. The type schema is closed, with
`additionalProperties: false` at line 26, so the block has to be added.

```json
"gate": {
  "type": "object", "additionalProperties": false, "required": ["open_radius_tiles"],
  "properties": {
    "opens_for":         { "enum": [0], "default": 0 },
    "open_radius_tiles": { "type": "integer", "minimum": 1, "maximum": 8 },
    "hold_open_s":       { "type": "integer", "minimum": 0, "maximum": 30, "default": 3 },
    "swing_s":           { "type": "integer", "minimum": 1, "maximum": 10, "default": 2 }
  }
}
```

The proposed `data/structures.json` row is:

```json
"compound_gate": { "id": "compound_gate", "name": "Compound Gate", "symbol": "G",
  "hp_per_tile": 600, "garrison_slots": 0, "rubble_cover": 1, "height_px": 14,
  "color": "<new yellow key, §7 Q8>", "roe_penalty": 0, "per_tile": false,
  "low_profile": true, "standing_cover": 2,
  "gate": { "open_radius_tiles": 4, "hold_open_s": 3, "swing_s": 2 } }
```

Each value, justified:

| field | value | why |
|---|---|---|
| `symbol` | `G` | unused: censused across every map grid, and no structure type takes it |
| `per_tile` | false | the two leaves are one structure. A per-tile gate would open one leaf at a time |
| `low_profile` | true | matches `wall` (`low_profile: true`), so sight passes over the gate like it does over the wall. It also exempts the gate from automatic demolition (the `lowProfile` skip in `stepDemolition`). Without that, a `demo_squad` waiting at the gate would level it |
| `hp_per_tile` | 600 | 3× the wall's 200 and 2× the camp's 300. Heavy metal; PROVISIONAL, for `playtest` |
| `height_px` | 14 | twice the wall's 7. "Huge" is relative to the wall. Must clear `map_visibility` (README §"Maps keep the fight visible") |
| `owner` | omitted (-1, neutral) | an owned structure is a target "once seen" and turns on the field-works fold (`fwLive`, `sim.ts:3183`). The gate must be neither |
| `color` | a new yellow key | `data/palette.json` has 15 ramps (basalt, dust, fen, grass, gunmetal, karst, limestone, mud, olive, overcast, scrub, shadow, skin, terracotta, water) and **no yellow**. A new key is a palette change that needs the lead (levant-terrain skill rule 2). §7 Q8 |

`validate:data` gains three rules:
- a gate's footprint is 2×1 or 1×2;
- `per_tile: false`;
- refuse a gate on any map that has a `data/versus/<map>.json`, because a gate that opens for side 0 only is unfair in a room.

### 2.3 Sim shape (`packages/sim/src/sim.ts`, `structures.ts`)

**Columns.** Each is one array of `MAX_STRUCTURES` (256, `sim.ts:1640`) entries, allocated next
to `stAlive`/`stHp` (`sim.ts:2216-2217`, `2718-2719`):

| column | type | meaning |
|---|---|---|
| `stGateState` | `Uint8Array` | 0 CLOSED · 1 OPENING · 2 OPEN · 3 CLOSING |
| `stGateTimer` | `Int32Array` | swing ticks left |
| `stGateHold` | `Int32Array` | hold-open ticks left |
| `gateCount` | int | gates ever added. Derived from the structure table, so not hashed (like `aidPosts`, `sim.ts:1929-1931`) |

**Compile** (`structures.ts`; the type is compiled at about line 412). `gate: { radiusSq, holdTicks, swingTicks } | null`:
- `radiusSq = R * R * 65536`, an integer. R ≤ 8 gives at most 4,194,304;
- `holdTicks = hold_open_s * 20`;
- `swingTicks = swing_s * 20`.

No floating point, no `Math.*`.

**Raise** (`addStructure`, `sim.ts:3140-3212`). It blocks the tiles as it does today
(`blocked[t] = 1`, line 3166). Two additions: `stGateState = CLOSED`, and `gateLive = true` when
`type.gate !== null`.

**Step.** `stepGates()` runs once per 20 Hz tick, after commands are applied and **before**
`stepMovement` and detection, so passability is fixed for the whole tick. It returns at once
when `gateCount === 0`, so a world without a gate runs exactly the code it runs today. For each
living gate `g`:

1. **near**: any living unit of side `opens_for` that is:
   - not air (`unitTypes[...].isAir`), since an aircraft overhead opens nothing, as with GH-279 ruling a in `civilians.ts:206-207`;
   - not in a tunnel (`tunnelIn < 0`);
   - not carried (`carriedBy < 0`); the carrier itself counts;
   - not down (`isDown`), the same rule `livingIn` uses (`mission.ts:4395-4396`).

   The unit must also pass `dx = fx.sub(posX[u], stCx[g]) >> 8`, the same for `dy`, and
   `dx*dx + dy*dy <= radiusSq`. That is the Q8.8 squared form `civilians.ts:208-210` already
   uses. Worst case on 48×48: dx ≤ 12,288, so the sum is ≤ 3.0e8, inside int32. On a 96-tile
   map the sum is ≤ 1.2e9, still inside.
2. If near, `stGateHold = holdTicks`. Otherwise, if `stGateHold > 0`, decrement it. `wantOpen = near || stGateHold > 0`.
3. **occupied**: any living entity of **any side** whose tile (`posX >> 16`, `posY >> 16`) is one of the gate's tiles. That includes civilians, downed men and enemies.
4. The state machine:
   - **CLOSED**, if `wantOpen`: go to OPENING with `timer = swingTicks`.
   - **OPENING**: decrement the timer. At 0 go to **OPEN**. Unblock every tile in a `beginFlips`/`noteFlip` window and call `recomputeFields('opened')`, the same path `removeStructure` uses (`sim.ts:3240-3266`). Push `gateOpened`. OPENING always completes, which keeps the machine small.
   - **OPEN**, if `!wantOpen && !occupied`: go to CLOSING with `timer = swingTicks`. The tiles stay passable while it closes.
   - **CLOSING**:
     - if `wantOpen`: back to OPEN; the renderer reverses the swing;
     - otherwise, if `occupied`: hold, with no decrement;
     - otherwise decrement. At 0, block every tile and call `recomputeFields('closed')`, the path `addStructure` uses (`sim.ts:3211`). Push `gateClosed`.

**A unit standing in the gate.** The gate cannot close on anyone, of any side. A downed civilian
or soldier lying in the gate holds it open until a medic moves him. That is emergent and
intended: the enemy can follow through a held-open gate. The check uses the unit's position tile
only. A hull overlapping the gate from an adjacent tile does not hold it (the sim has no vehicle
footprint).

**Destroyed gate.** `destroyStructure` (`sim.ts:12404-12447`) already unblocks the tiles and
leaves rubble. `stAlive = 0` takes the gate out of `stepGates`. The gap stays open for good.

**Flow fields.** A flip goes through the existing exact incremental repair (`recomputeFields`,
`sim.ts:3006-3052`, GH-913 L2): "the same bytes `compute` would leave, for a cost proportional
to what the change touches". Two tiles per flip, at most once per 2 s per gate.

**Do civilians pass it?** Only while it is open. It is on the foot mask like any structure tile.
**Do they path to it and wait?** Yes, by data and with no new civilian rule: the crowd's
`withdraw_to` goal is the `gate_apron` marker outside the gate (§1.1).
- When a soldier comes within 4 tiles, the shepherd rule sends them to the refuge inside. That route goes through the gate and exists only while the gate is open.
- If the gate shuts with people still on the route, a field toward an unreachable goal is all `DIR_NONE`. `stepMovement` then falls back to a straight line and the wall-slide clamp (`sim.ts:4969-4978`), so they press against the wall.
- When the gate reopens, the repaired field moves them again.
- Cost risk: a fled civilian who has stopped is re-ordered **every tick** (`civilians.ts:154-193`). At a shut gate that is up to 100 `move` commands a tick. G-2 throttles it.

**Hash.** `stGateState`, `stGateTimer` and `stGateHold` fold into `hash()` (`sim.ts:13942`) for
`s < structureCount_` **only while `gateLive`**. This is the deferred-fold shape that `airLive`
(`sim.ts:1891-1895`), `woundLive` (`sim.ts:1896-1941`) and `fmLive` (`sim.ts:2009-2059`) already
use. `blocked` is already hashed (`sim.ts`, `hash()`, `hashArray(h, this.blocked)`), and it only
moves in a world that has a gate. **No existing replay or golden hash moves.** A new
`GATE_WORLD_PIN` replay in `determinism.test.ts` is the one that sees the block, as
`WOUNDED_WORLD_PIN` does for wounds.

**Renderer, read-only (invariant 4).** Two read paths:
- the read-only structure view (`sim.ts:2498-2516`) gains `gate: Uint8Array` (state) and `gateTimer: Int32Array`;
- two new `SimEvent` kinds, `gateOpened` and `gateClosed` (`{ tick, structure }`), are added to the union (about `sim.ts:1477`) and to the event-kind list (`sim.ts:1576`).

The renderer animates the swing from the state and timer on the **sim** clock and plays the
clank from the events. It writes nothing back. There is no new `Command`, because the gate is
sim-driven, so `cleanCommand` and the wire are untouched.

### 2.4 Files the change touches

| file | change |
|---|---|
| `data/schemas/structure.schema.json` | `gate` block |
| `data/structures.json` | `compound_gate` (and `compound_gate_ns` if Q8 says two GLBs) |
| `tools/validate_data.mjs` | footprint, `per_tile`, no gate on versus maps |
| `packages/sim/src/structures.ts` | `StructureType.gate`, compile |
| `packages/sim/src/sim.ts` | columns, `addStructure`, `stepGates`, hash fold, read-only view, two event kinds. **Audit the 10 readers of `structureOfTile`** (lines 3489, 3592, 4195, 6933-6934, 6998, 7325, 8256, 8317, 10581): each was written when "structure tile" implied "blocked tile", and an open gate breaks that. This is the main engine risk |
| `packages/sim/src/snapshot-schema.ts`, `snapshot.ts` | carry the three columns, or a restored save diverges (`snapshot.ts:34`, `:789-822` read the structure table) |
| `packages/sim/src/snapshot-witness.ts` | a witness world that moves the new columns (the census needs every row moved) |
| `packages/sim/src/determinism.test.ts` | `GATE_WORLD_PIN` |
| `packages/sim/src/gate.test.ts` (new) | falsification, per CLAUDE.md. Four mutations, each must go red: the radius sign; the occupied check removed; air counted; the hold not decremented |
| `packages/render/src/three/…` (new `gate-mesh.ts`) | leaf nodes swung about their hinges; presentation only |
| `packages/app/src/mesh-catalogue.ts` | building entries follow `buildings/<id>.glb` + `_wreck.glb` (`mesh-catalogue.test.ts:203-208`) |
| tutorial `await` lists, event-kind pins | any exhaustive `SimEvent` list must take the two kinds (UNREAD which tests pin the count) |

**Size: M (sim) + M (render) + art.** Owner: `sim-guard` (sim, schema), `render-vfx`, `blender-art`.

---

## 3. All 25 missions with civilians

**Census.** `grep -l '"civilians"' data/missions/*.json` lists 25 files. They place **118**
civilians between them today.

### 3.1 The budget, and the crowd ladder

| constraint | number | source | what it means for crowds |
|---|---|---|---|
| sim capacity | **256 entities, lifetime** | `packages/app/src/main.ts:2392`, `tools/src/backtest/playtest-run.ts:348`; `spawn` **throws** at capacity (`sim.ts:4309`) | Every placement, wave, spawn, reinforcement, production purchase and **every wounded man a squad sheds** (`fallMan` spawns a new entity, `sim.ts:9686-9700`) counts, and dead bodies are never freed. Civilians fall in place (`wounds.in_place: true`), so they spawn nothing extra. **Rule: authored entities ≤ 160**, leaving ≥ 96 for wounded and production (G-10) |
| sim tick | 300 units: p95 2.6 ms (M3 Pro, C1), 4.1 ms with wounds (C5), 5.1 ms (cloud, C8), against a 50 ms budget; crossed at ~1,700–2,100 living | `docs/PERFORMANCE.md:66,73,80`; `docs/agent-notes/scaling-debts.md:39-52` | **not binding.** Civilians observe nothing (`sim.ts:7531`) and are never targets (`sim.ts:8023-8025`), but they are detection *targets* (`sim.ts:7538-7549`). About 40 observers × 140 targets is 5,600 pairs, against ~1,600 today: ≈3.5× the detection cost, still under 10% of budget (ESTIMATE from C-rows) |
| render, frame | 60 fps = 16.7 ms. **The latest all-mesh curve: 10.8 / 17.8 / 30.0 / 39.7 ms p95 at 65 / 143 / 266 / 320 living** | `docs/PERFORMANCE.md:45` (F9, ANGLE/Metal M3 Pro; "needs Metal re-read", predates L1–L5, 3D grass, ragdolls) | **the binding constraint.** On F9's curve the frame budget goes at about 130–140 living. The "~1,150 figures" in CLAUDE.md is the stand-in harness (`scaling-debts.md:76-83`); the shipped roster measured lower. A civilian is **1 figure** (`civilians.json` `figures: 1`) and **4–7 mesh primitives** (GLB census: child 4, woman 6, office 6, farm 7). A squad entity is several figures, so a civilian probably costs less per entity than F9's average. That is UNMEASURED |
| wounded cap | 24 down at once per side | `tuning.ts:577`; past it a hit kills outright (`sim.ts:9694`) | a firing line must down fewer than 24 at once. T1-A is sized at 1–2 cells |
| Conduct gain | +3 per civilian rescued, +10 a mission | `tuning.ts:593-595` | only 4 rescues pay Conduct. The rest pay only in the count (G-7) |

**The ladder.**

| tier | crowd | missions | why |
|---|---|---|---|
| **P** pilot | **100** | `beit_sahwan_1_recon` | the lead's number. About 123 authored entities leaves ~133 of capacity. About 126 living interpolates to ≈16.3 ms on F9's curve (ESTIMATE), which is at the frame budget. **Gate: re-measure before it ships** (`pnpm perf:load`, `backend-curve-gate.ts --only=three-mesh` with a 100-civilian roster). Fallback 60 |
| **L** large | **40** | breach, KR I, QL II, TM I, WH I, WH IV | front openings (Marj, Sur, Naharin), the shown atrocity (WH IV, `storyline.md:231`) and the foothold that is about residents (QL II). The largest authored total is 83 |
| **M** most | **20–30** | 14 missions | 45–64 authored. A crowd still reads as a crowd at play zoom; the margin stays clear on any curve |
| **S** small | **≤15** | tutorial 8, BS IV 15, QL I 8, QL III 4 (unchanged) | tutorial, subterranean at dusk, night hostage stealth, and the Pause (a handover of four, `storyline.md:304`) |

Total placed civilians go from 118 to 745.

**Placement.** A placement lays its bodies 3 to a row, 1.25 tiles apart (`SPREAD = 81920`,
`mission.ts:791`, `:3905-3909`), and refuses any body on a blocked tile (`mission.ts:3505-3529`).
So a crowd is authored as groups of 10–13 sharing one `group` name. A count-12 group takes a
2.5 × 3.75-tile clear block.

### 3.2 The table

Notation:
- **today**: placed (groups); the civilian objective as `type count/seconds` (P primary, S secondary); `fb` is `roe.fail_below`; "rm@T" is the shipped `remove` at T s.
- **threat**: A form / B form.
- **margin** = 100% − the primary count's share − the loss ceiling (ESTIMATE, §1.2).
- **authored**: entities after the change (placed + waves + trigger spawns).
- Every proposed primary keeps its deadline ≥ 60 s inside `time_limit_s` (`validate_time_limit`).

Geometry for each threat (the muster, the barrier, the fire-line tile) is `level-scripter`'s
to world-walk on the real map. The tiles here are proposals only.

| # | mission (front · phase) | today | proposed crowd | threat A / B | KDF objective (proposed) | loss ceiling | margin | authored | ships as data first? |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `beit_sahwan_0_tutorial` (Marj · recon, 12-min exemption) | 2 (1) · S evac 2/600 | **8** | none / none | S evac 6/8 by 600 | 0 | 25% | 21 | yes (§7 Q7) |
| 2 | `beit_sahwan_breach` (Marj · breach) | 11 (4) · P evac 2/270 · rm@272 | **40** | T2-A column from the overrun outpost + T1-A / T2-B (shipped rm@272) + T1-B | P evac **10/40** by 270, in through two gates at the map's two wall gaps, (17,21–22) and (31,24–25) on `marj_perimeter` (`compound` zone [18,17,13,13]) | ≤50% by design: "losing ground is the design" | 25% | 83 | B without gates: yes; gates: §2. **Canon numbers: §7 Q11** |
| 3 | `beit_sahwan_1_recon` (Marj · recon) | 3 (2) · **no civilian objective** | **100** (88 crowd + 12 captives) | T1-A + T2-A / T1-B + T2-B | **§6** | 24% | 21% | 123 | needs the gate and a new map variant |
| 4 | `beit_sahwan_3_clearance` (Marj · clearance) | 5 (3) · **none** · fb 40 | **30** | T4 + T1-A / T4 + T1-B | **new** P evac 15/30 by 360 to a new collection zone (the map has only `town` and `clinic`) | 10% | 40% | 56 | yes |
| 5 | `beit_sahwan_4_subterranean` (Marj · subterranean, dusk) | 8 (3, one `hostages` ×4) · P evac 5/240 `hostages` | **15** (4 hostages + 11) | T2-A: the four moved toward a tunnel mouth at 150 s / T2-B | P evac hostages **3/4** (group-scoped), S residents 6/11 | 25% (one hostage) | 50% of residents | 43 | **blocked on G-6**: today's objective already counts *any* 5 of 8 as hostages recovered |
| 6 | `ein_qasab_1_recon` (Naharin · recon) | 4 (2) · P evac 3/300 | **24** | T3-A / T4 (a causeway block) | P evac 14/24 by 300 | 12.5% + 5% | 24% | 47 | B: yes |
| 7 | `ein_qasab_2_foothold` (Naharin · foothold) | 2 (2) · **none** · fb 40 | **20** | T1-A / T1-B | **new** P evac 12/20 by 360 | 15% | 25% | 45 | B: yes |
| 8 | `ein_qasab_3_buildup` (Naharin · buildup) | 5 (3) · **none** · fb 40 | **24** | T3-A / T1-B | **new** P evac 14/24 by 360 | 12.5% + 10% | 19% | 51 | B: yes |
| 9 | `khan_rafid_1_recon` (Marj · recon) | 4 (2) · P evac 2/240 · rm@250 | **40** | T2-A / T2-B (shipped) + T1-B | P evac 20/40 by 240 | 15% + 10% | 25% | 59 | B: yes |
| 10 | `khan_rafid_2_foothold` (Marj · foothold) | 6 (3) · P evac 4/300 · fb 45 | **30** | T4 / T4 | P evac 16/30 by 300 | 10% | 37% | 59 | yes |
| 11 | `khan_rafid_3_clearance` (Marj · clearance, dusk) | 8 (4) · P evac 6/300 · fb 50 | **30** | T1-A / T1-B | P evac 16/30 by 300 | 15% | 32% | 64 | B: yes |
| 12 | `qarn_hadid_1_recon` (Sur · recon) | 4 (2) · P evac 2/240 · rm@250 | **30** | T1-A / T1-B (Sarim standoff fire on the road) + T2-B (shipped) | P evac 15/30 by 240 | 10% | 40% | 48 | B: yes |
| 13 | `qarn_hadid_3_clearance` (Sur · clearance, dawn) | 5 (2) · P evac 3/300 · fb 45 | **24** | T4 + T1-A / T4 + T1-B | P evac 12/24 by 300 | 15% | 35% | 53 | B: yes |
| 14 | `qasr_liwan_1_recon` (Marj · recon, night) | 1 · P evac 1/300 `hostages` + `no_collateral_above` 10 | **8** (1 hostage + 7) | none new / none | P hostage 1/1 (group-scoped), S residents 4/7 | 0 | 43% of residents | 25 | **blocked on G-6**: residents would count as the hostage |
| 15 | `qasr_liwan_2_foothold` (Marj · foothold) | 9 (3) · P evac 6/300 | **40** | T4 + T1-A / T4 + T1-B | P evac 22/40 by 300 | 15% | 30% | 75 | B: yes |
| 16 | `qasr_liwan_3_buildup` (Marj · buildup, the Pause) | 4 (1) · P evac 4/330 `hostages` + `no_collateral_above` 5 | **4** (unchanged) | none / none | unchanged | 0 | 0% (all four; the premise) | 36 | exemption, §7 Q7 |
| 17 | `qasr_liwan_4_clearance` (Marj · clearance) | 6 (2) · P evac 5/300 + `no_collateral_above` 10 | **24** | T1-A / T1-B | P evac 13/24 by 300 | 15% | 31% | 50 | B: yes |
| 18 | `tel_marum_1_recon` (Sur · recon, dusk) | 3 (1) · P evac 2/300 | **40** | T1-A / T1-B (rockets on the valley floor: LANTERN's doctrine, `storyline.md:220`) | P evac 20/40 by 300 | 15% | 35% | 58 | B: yes, the recommended first data slice |
| 19 | `tel_marum_3_clearance` (Sur · clearance, dawn) | 3 (1) · P evac 2/300 · fb 45 | **24** | T1-A / T1-B (the battery beside `town_block`) | P evac 12/24 by 300 | 10% | 40% | 48 | B: yes |
| 20 | `umm_zeitoun_1_recon` (Sur · recon) | 3 (1) · P evac 2/240 · rm@242 | **30** | T2-A / T2-B (shipped) | P evac 15/30 by 240 | 15% | 35% | 50 | B: yes |
| 21 | `umm_zeitoun_3_clearance` (Sur · clearance, dawn) | 6 (2) · P evac 4/300 · fb 45 | **30** | T1-A + T4 / T1-B + T4 | P evac 16/30 by 300 | 15% | 32% | 62 | B: yes |
| 22 | `umm_zeitoun_4_clearance` (Sur · clearance, Adhal's end) | 4 (1) · **S** evac 3/240 · fb 45 | **20** | T2-A (porters marched off to carry for the battery) / T2-B | S evac 12/20 by 240 (promoting it to P is §7 Q7) | 15% | 25% | 56 | B: yes |
| 23 | `wadi_halam_1_fords` (Naharin · recon, dusk) | 4 (2) · P evac 3/300 | **40** | T3-A (canon T9, "the riders are carrying", `storyline.md:342`) / T4 | P evac 20/40 by 300 | 15% | 35% | 63 | B: yes |
| 24 | `wadi_halam_3_counterraid` (Naharin · buildup) | 4 (2) · P evac 3/300 | **30** | T3-A / T1-B | P evac 15/30 by 300 | 15% | 35% | 55 | B: yes |
| 25 | `wadi_halam_4_village` (Naharin · clearance, dusk) | 4 (3) · P evac 3/300 (failable) · fb 40 | **40** | T1-A in the village (atrocity **shown**, `storyline.md:231`) + T4 / T4 + T1-B | P evac 20/40 by 300 | 15% | 35% | 57 | B: yes |

**Rules the table holds to.**
1. Every mission ends with a civilian objective. Four have none today: BS I, BS III, EQ II and EQ III (rows 3, 4, 7, 8).
2. No objective is reached by harming a civilian.
3. Every primary share is ≤ 60%.
4. Every margin is ≥ 19 points against the ESTIMATED ceiling.
5. Every crowd runs to a muster, never into its refuge (§1.1).
6. `playtest` must show, per mission:
   - 30 of 30 seeds win the plan with the count met;
   - every passive control loses on the count's deadline;
   - the margin re-read from the plan's slowest seed replaces the estimate.

**Phase note.** The economy stays as shipped. In foothold and buildup rows (7, 8, 10, 15, 24)
the spend that helps civilians is a medic team or smoke (Intel). Neither `veh_ambulance` nor a
carrier is buildable today (`docs/agent-notes/sim-and-orders.md:140`).

---

## 4. Capability gaps

**Today, precisely:**
- **Civilians** are a placement list plus one `refuge` marker (`mission.schema.json:531-550`). They are "untargetable by either side; hurt only by ordnance" (`:533`; `sim.ts:8023-8025`).
- **Flight**: they shelter until suppressed past 0.3, or until a ground soldier comes within 4 tiles in a mission with an `evacuate_before` (`civilians.ts:27-33`, `:200-215`).
- **`evacuate_before`** counts **all** civilians globally (`complete = this.civFlight.evacuatedCount >= count`, `mission.ts:4843`). `hostages: true` writes `civ.hostages_recovered` (`mission.schema.json:404-407`).
- **Trigger conditions**: `first_contact`, `casualties_pct` (global, over the starting garrison, `mission.ts:4522-4535`), `timer_s`, `zone_entered` (any player unit, **aircraft included**: `livingIn(z, 0)` with `groundOnly` false, `mission.ts:4536-4538`, `:4387-4403`) and `group_in_zone` (any side, `:4539-4546`).
- **Trigger actions**: `commit` (attack-move with sweep), `withdraw_to` (move), `spawn` (side 1), `reinforce` (side 0), `dismount`, and `remove` (a group leaves play; riders go with their carrier; restricted to a `zone` if one is given; `mission.ts:4607-4640`, `schema:741-799`). `remove` landed (`storyline.md:604-606`), so G7's abduction verb exists. The `execute` verb does not, and this design does not ask for it.
- **Stances**: `hold_position | ambush(tiles) | patrol | garrison` (`schema:948-989`).
- **Passengers** in an enemy carrier spawn on the **carrier's** side (`embarkPassengers(id, p.passengers, side)`, `mission.ts:3657-3666`).

| id | gap | today | proposal | size | owner | data first? |
|---|---|---|---|---|---|---|
| **G-1** | Mass flight at t=0 | `withdraw_to` on a civilian group works in the schema and runtime | author it, world-walk it (`walk_mission.ts`) | data | `level-scripter` / `mission-author` | **yes** |
| **G-2** | Re-order spam: a fled civilian who stops outside the zone is re-ordered every tick (`civilians.ts:154-193`). That is up to 100 `move`s a tick at a shut gate or a barrier | — | re-order a stalled civilian on `(tick + id) % 20 === 0` only. It can move existing replays where a civilian stalls, so measure against the golden hash first; if it moves, gate it behind a crowd flag | S | `sim-guard` | — |
| **G-3** | The gate | none | §2 | M sim + M render | `sim-guard`, `render-vfx` | after art |
| **G-4** | Enemy fire on civilians (**A only**) | refused for every shooter (`sim.ts:8023-8025`). Detection does build contact rows on civilians (`sim.ts:7538-7549`). ROE already charges only player-caused deaths (`mission.ts:4050-4056`) | a placement field `fires_on_civilians: true`, which sets a sim column at spawn. The column folds into `hash()` behind `civFireLive` (the deferred fold). `engageable` admits side-2 targets for that shooter only when it has no engageable side-0 target, so KDF presence draws the fire. `selectTarget` is the second O(N²) scan (`scaling-debts.md:44-47`); this widens it only for flagged shooters | M | `sim-guard` | — |
| **G-5** | Abduction column, done properly (**A only**) | **approximation today.** `withdraw_to` escort and captives to `exit` at T. `group_in_zone(captives, exit_zone)` then `remove captives` and `remove escort`. Release on `group_in_zone(<a starting_force group>, intercept_zone)`, then `withdraw_to captives` to the muster. Starting-force groups landed with G7 (`storyline.md:605`). Flaws: release fires on *reaching* the column, not on beating the escort; captives (0.8 t/s, `civilians.json`) fall behind the escort (militia 0.95, `militia_cell.json`) | `do.kind: "abduct"` `{ group, captives, to, zone }`. The captives follow the escort's leader. They are released (the fled latch, an order to the refuge) when every escort member is dead, down or removed, or is more than 6 tiles off. A captive in `zone` with a living escort is removed as taken. The latch folds into `MissionRuntime.digest` | M | `sim-guard` | approximation: yes |
| **G-6** | Per-group counting. `evacuate_before` counts every civilian, so a crowd beside a `hostages: true` objective fabricates hostages recovered. **`beit_sahwan_4_subterranean` already over-counts**: `get_them_out` is `hostages`, count 5, and any 5 of its 8 civilians satisfy it | — | `evacuate_before.group`: count only evacuated ids in that group. The evaluation is at `mission.ts:4830-4848`; schema and validator follow. Precondition for rows 5 and 14 and for §6's captive count | **S** | `sim-guard` | — |
| **G-7** | A rescued wounded civilian is never "saved". A downed civilian is never collected (`civilians.ts:268-271`) and leaves by `woundEvacuated`/`woundAdmitted` (`mission.ts:4066-4072`), which `evacuate_before` does not count | — | count side-2 `woundEvacuated`/`woundAdmitted` toward a group's evacuation count (option on `evacuate_before`) | S | `sim-guard` | — |
| **G-8** | Group-scoped conditions: no "group lost", and `zone_entered` fires for a drone | — | `on.kind: group_lost` (every member dead, down or removed); `zone_entered.ground_only: true` | S each | `sim-guard` | — |
| **G-9** | Vehicle snatch (**A only**). Civilians in a side-1 carrier would spawn as side 1 and become targets. A carrier killed with riders "bails them out hurt" (`sim.ts:12448-12466`). Whom the ROE charges for a rider killed by that is **UNREAD** | — | passengers keep their own side (side 2 in a side-1 carrier); pin the ROE attribution of a rider's death to the shooter of the carrier | M | `sim-guard` | — |
| **G-10** | Capacity: 256 lifetime, and `spawn` throws mid-mission (`sim.ts:4309`) | — | (a) a `validate:data` budget: authored entities ≤ 160 a mission (S, `content-validator`); or (b) raise capacity in `main.ts:2392` and `playtest-run.ts:348`. Arrays such as `contact` scale with `side * capacity` (`sim.ts:2325`); whether hash bytes move is **UNREAD**. §7 Q4 | S / M | `content-validator` / `sim-guard` | (a) yes |
| **G-11** | Wounded cap 24 per side (`tuning.ts:577`) | — | no change (`tuning.ts` is off limits to design). Size every firing line to stay under it | — | — | yes |
| **G-12** | Render budget: F9 crosses 16.7 ms at ~140 living (`PERFORMANCE.md:45`). `SkinnedMesh` does not instance (`scaling-debts.md:60-62`) | — | (1) a measurement gate before the pilot; (2) if it fails: VAT plus `InstancedMesh` for civilians (the known remedy, `scaling-debts.md:62-69`, with the toon-ramp caveat), or LOD billboards for distant crowd members | (1) S, (2) L | `render-vfx` | (1) yes |
| **G-13** | Crowd variety: four variants, entity id `n % 4` (`mesh-catalogue.ts:218-243`), so a crowd of 100 is 25 of each | — | per-entity tint jitter from existing palette ramps (skin, cloth), keyed on entity id; presentation only (S). More variants are §5 | S + art | `render-vfx`, `blender-art` | — |
| **G-14** | The grade cannot see civilians. Stars read victory, a Conduct threshold and the carrying secondaries (`grade.ts:5-9`, `:33-42`); enemy-caused losses never touch Conduct | — | §7 Q6: (a) leave saved and taken on the after-action report only (S, app); (b) a carrying secondary needs a real later reader (README: "never flag a clock"), for example a later mission reading `civ.settlements_evacuated` (`mission.ts:207-211`) | S / M | `render-vfx` (app) / `sim-guard` | (a) yes |
| **G-15** | The board's account of the taken is static (`world.json` `taken: 19`). In-mission abductions do not add to it, and D9 forbids ledger-branched text | — | §7 Q6 | — | lead | — |
| **G-16** | Child figures under aimed fire (**A only**). The variant is render-only (`n % 4`); the sim cannot know which figure falls | — | `civilians.figures: "adults"`, a mission field the app reads to draw from the three adult variants only. Presentation only, so no hash change | S | `render-vfx` + schema | — |
| **G-17** | Gate throughput: 100 bodies through 2 tiles | flow fields are shared per goal (one field for the refuge point; `exact` moves, `civilians.ts:189-192`) | measure with `pnpm spacing:census -- --play` (the choke probe). ESTIMATE: 1.5–3 bodies/s, so 33–67 s for 100 | S (measure) | `playtest` | yes |
| **G-18** | A "running" crowd moves at 0.8 t/s (`civilians.json`), slower than a rifle squad (0.9) | — | §7 Q9. A speed change re-times all 25 missions | data | lead → `mission-author` | — |
| **G-19** | T4's barrier: whether mission `structures[]` (`schema:808-858`) can raise a per-tile type (`t_wall`, `fence`) with a `size` | **UNREAD** | `level-scripter` to verify. Fallback: a map variant draws the barrier | — | `level-scripter` | — |

**What ships first, as data under either answer:** G-1, the B forms of T1, T2 and T4, the ladder
of tiers M and L where no row is blocked, the G-10(a) budget and the G-12(1) and G-17
measurements. Recommended slice: `tel_marum_1_recon` (40, crossfire), `khan_rafid_2_foothold`
(30, blocked road) and `umm_zeitoun_1_recon` (30, deadline taking). These three exercise the
muster, the passive probe, the capacity budget and the frame time before any engine work.

---

## 5. Art needs: asks only, nothing spent

**House rule:** the lead approves the numbers before any render or Meshy call, and each call's
credits are announced in the ledger first.

| asset | status | ask | estimate | gate | pipeline |
|---|---|---|---|---|---|
| `compound_gate.glb` (closed geometry, two leaf nodes pivoted at their hinges, swung by the renderer) | **MISSING** (no `*gate*` under `art/`, census) | Blender kit build, like `art/src/buildings/wall.blend`. Footprint 2×1 tiles, height ≈ 2× `wall` (`height_px` 14). Leaves `leaf_l`/`leaf_r`. **No Meshy**: it is simple geometry | 0 credits; Blender ≈ 0.5–1 day (ESTIMATE) | `validate:meshes` (palette, silhouette IoU), `tools/building_facing.py`, `map_visibility` | `.blend` in `art/src/buildings/` → `art/meshes/buildings/` → encode |
| `compound_gate_wreck.glb` | **MISSING** | twisted leaves, a procedural twin | in the above | `mesh_roster` / catalogue tests | same |
| `compound_gate_lod1.glb` | optional (`house_lod1`, `wall_lod1` exist) | — | — | — | — |
| a second orientation (`compound_gate_ns`) | **MISSING** | needed if a 1×2 gate cannot be a rotated placement. Buildings never rotate at runtime (CLAUDE.md, mesh units). §7 Q8 | +0.25 day | same | same |
| yellow colour | **MISSING** palette key | a yellow ramp (for example `signal`) in `data/palette.json`, or a textured exemption (`TEXTURED_BUILDING_EXEMPT`, `tools/validate_mesh_assets.py:218`). Recommend the ramp: one key, no texture memory | — | the visual gate moves on any palette change; bless from CI | lead decision |
| civilian variants | **PRESENT ×4**: `art/meshes/civilians/{civilian_woman,office_worker,farm_worker,civilian_child}.glb`, clips `idle, move, down` (GLB census). Meshy origin (`art/ATTRIBUTION.md:41`); `.blend` sources not found under `art/src` (**UNREAD** where they live) | **+6 variants** (4 adults, 1 elder, 1 adolescent): 10 in all, so 10 of each in a crowd of 100 | 6 × (image-to-3D textured 2K, 15 credits on the lite models or 30 standard, `docs/ART_PIPELINE.md:228-235`, + remesh 5, + one retry) ≈ **240–420 credits**, ≈ $4.80–8.40 at the default $20 per 1,000 (`ART_PIPELINE.md:258`). Rigging and clips in Blender, ≈ 1–2 days (ESTIMATE) | `validate:meshes`, `mesh_gait.test.ts`, texture budget infantry 32 MiB / 3072 px | Meshy → skin to the existing skeleton (GH-746 precedent) → motion/gait passes → encode; ATTRIBUTION row |
| a run clip | **MISSING** (only `move`) | a `run` gait for the flight, only if §7 Q9 raises the speed | Blender ≈ 0.5 day | `mesh_gait.test.ts` | `tools/units/` passes |
| captive clip | not needed | captives walk (`move`). No bound or hands-up pose: the neutral register | 0 | — | — |
| gate audio (motor, clank) | **MISSING** | one or two licensed sounds | — | `validate:audio` (licence, source URL) | `data/audio.json` |
| crowd ambience | **MISSING** | optional | — | `validate:audio` | same |
| HUD saved / taken tally | **MISSING** | app surface, no art (G-14 a) | — | `validate:ui` | `render-vfx` |

---

## 6. The pilot: `beit_sahwan_1_recon`

**Checked.** The mission (`data/missions/beit_sahwan_1_recon.json`):
- recon, Ashwar Front, `target_minutes` 7, `time_limit_s` 840, `start_layout: assembly`, `player_start` (4,23);
- three civilians at (28.5,14.5) ×2 and (31.5,22.5);
- refuge `civ_refuge`, no civilian objective, ROE on with no `fail_below`.

Its map, `beit_sahwan_outskirts`, is 48×48 with no elevation. It has markers `kdf_assembly`
(4,23), `civ_refuge` (22,45) and others, and zones `town` [19,9,22,31] and `west_approach`
[0,8,17,32], among others. **There is no compound, wall or camp on it.** The map is also read by
the versus tests (`packages/app/src/net/versus-specials.ts:64` and eight `*.test.ts`), so it must
not be edited.

**Map.** Make a new variant, **`beit_sahwan_1`**: `beit_sahwan_outskirts` copied, plus a
compound. This is the precedent of `beit_sahwan_3` and `beit_sahwan_4`
(`docs/campaign/map-variants-design.md`).
- **Compound**: `=` wall on x=13 (y 15–30), y=15 and y=30 (x 0–13). The map edge closes the west.
- **Gate**: `G` at (13,21)–(13,22), with the road `r` extended from x=14 to x=18 on rows 21–22 to meet the town road.
- The grove tiles inside the walls (x 8–13, rows 15–20) become `.`. The grove north of the wall stays: it is the firing line's cover.
- New zone `compound_yard` [1,16,12,14].
- New markers:
  - `gate_apron` (15,21);
  - `civ_refuge` moved to (6,22), inside the yard;
  - `crowd_1`–`crowd_8` on clear 3×4 blocks in the town's west half (candidates (20,24), (23,24), (36,23), (38,25), (20,30), (34,35), (29,37), (37,36); each to be checked by `assertGroundClear`);
  - `fl_north` (16,13);
  - `taken_exit` (45,10);
- New zones `north_track` [30,7,12,8] and `taken_east` [44,6,4,10].
- **Distance check**: the nearest starting ground unit, inf_squad at (5,20), is 8 tiles from the gate centroid (13.5, 22). The radius is 4, so a passive force does not open the gate. The 4-tile margin must be re-measured after `start_layout: assembly` lays the force out.
- `map_visibility` must pass with the gate's height.

**Where the 100 start, and the run.**
- 88 people in 8 groups (11 each, group `crowd`) at `crowd_1..8`.
- 12 in the north block, group `taken_north`, at (27–31, 13–14), beside `bs_track_north`. They are not part of the run.
- At `timer_s 2` a `withdraw_to crowd → gate_apron` fires, labelled *"Families are running for the compound"*.
- The run is 7–25 tiles at 0.8 t/s, so 9–31 s. Everyone is at the apron by about t=35.
- From there the gate (§2) plus a shepherd within 4 tiles takes them in. ESTIMATED throughput 1.5–3 a second (G-17).

**The threat.** Each row has an A form and a B form.

| | A (line moved) | B (line kept) |
|---|---|---|
| fire on the run | `fl_north`: 2 `militia_cell` (rifles, range 7, `militia_cell.json`), `hold_position`, `fires_on_civilians` (G-4), 7.1 tiles from the apron. They fire on the crowd until a KDF unit is in their range | a `mortar_crew` (range 16, `mortar_crew.json`) at the town centre (30,22), observed by the shipped `bs_observer_aloft`. Its rounds aimed at KDF soldiers near the apron fall among the crowd. Both are expressible today |
| the taking | at `timer_s 120` (label *"Movement in the north block"*): `withdraw_to takers` (2 `militia_cell`, new, at (29,12)) and `withdraw_to taken_north` → `taken_exit`. Release: `group_in_zone(rescuers, north_track)` (a starting-force group: the three rifle squads, the Eitan and the Namer, with no drone) → `withdraw_to taken_north → gate_apron`, labelled *"The north block families break west"*. Taken: `group_in_zone(taken_north, taken_east)` → `remove taken_north` + `remove takers`. This is the today-approximation; G-5 replaces it | `taken_north` stays home. At `timer_s 242` `remove taken_north` takes those not yet shepherded (the shipped pattern, silent) |

The shipped `hunt_the_scouts` trigger (technicals committed to `kdf_assembly` on first contact)
stays as it is. It now drives at a gate that may be open: that is the tension, unchanged and free.

**Objectives.** The existing three stay as shipped.

| id | type | P/S | numbers | notes |
|---|---|---|---|---|
| `picture` | locate ×6 | P | — | shipped |
| `into_the_compound` | evacuate_before → `compound_yard` | **P** | **55** of 100 by **300 s** | failable; 300 ≤ 840 − 60 ✓ |
| `most_of_them` | evacuate_before → `compound_yard` | S | 85 by 300 s | not `carries` (no later reader, README rule) |
| `north_block` | evacuate_before → `compound_yard`, `hostages: true`, `group: taken_north` | S | 8 of 12 by 300 s | **only after G-6**. Before it, drop this row: the 12 count toward the two above |
| `hvt_seen`, `find_the_column` | locate | S, `carries` | — | shipped; they keep the third star |

**Ledger.** It requires `roster.surviving_units`, as shipped. It produces as shipped, plus
`civ.hostages_recovered` once `north_block` exists (an existing key, `mission.ts:203-206`).

**Time.** `target_minutes` 7 and `time_limit_s` 840, both unchanged. Running out with a primary
open is the shipped `withdrawn` defeat.

**The player's decision.** One force for three jobs: find six positions (recon), hold a soldier
at the gate and walk the crowd in (the primary), and send a detachment 30 tiles east to the north
block before 120 s or right after it (the secondary).
- Eitan at 1.8 t/s: ≈17 s. Infantry at 0.9 t/s: ≈33 s.
- The Lavi's 120 mm on the escort is danger-close to captives within 2 tiles. The Namer's 30 mm or a rifle squad is the clean answer.

**Margins (ESTIMATE).**
- Worst competent play: 12 downed (A) or 5–10 (B), plus 12 taken. That leaves ≥ 76 saveable against a primary of 55: **21 points**.
- A passive player: the gate never opens, so 0 in, and the mission fails at 300 s.
- A rush that ignores the crowd fails the same primary.

**Stars, as `grade.ts`.**

| stars | condition |
|---|---|
| ★ | victory |
| ★★ | Conduct ≥ 70 (no `fail_below`). Player-caused civilian deaths cost 8 each; danger-close ordnance costs 3 |
| ★★★ | also `hvt_seen` and `find_the_column`, as shipped. Saved and taken show on the after-action report only, unless §7 Q6 decides otherwise |

**Assets the pilot needs.**
- New: the map `beit_sahwan_1` (`validate:data`, `map_visibility`), `compound_gate` (§2, §5), the two-`militia_cell` `takers` group (an existing unit).
- PRESENT: `civilians` (`data/units/civilians.json`), `militia_cell`, `mortar_crew` (`data/units/enemy/*.json`).

---

## 7. Lead questions

**Q1: the content line.**

*The line today:*
- `storyline.md:47` (D12): "shown through mechanics and stated in the story voice, never depicted".
- `docs/campaign/beit_sahwan/design.md:24-27`: "Never depicted … *'nobody is coming back for them afterwards'* … the ceiling this design writes to, not a floor to exceed".
- `beit_sahwan/design.md:860` (O-D): "Name what happened — *taken*, *across the line*, a number — and never a method, never a body, never a scene."
- The mechanics as shipped: the enemy never aims at civilians (`sim.ts:8023-8025`, `mission.schema.json:533`); those left outside vanish at the deadline in four missions (`remove`).
- The front openings: First Light (`beit_sahwan_breach`: 11 placed, 2 counted in, told), Tel Marum (rockets, told, off-map) and Wadi Halam IV (shown, as a failable evacuation; `storyline.md:211, 221, 231`).
- In tension with all of this, GDD §11 (`docs/GDD.md:426-429`) already lists "a kidnapped civilian killed, a soldier abducted" as admissible level twists.

*What the request needs beyond that:*
- enemy fire **aimed** at running civilians, on screen (T1-A);
- people **led away** on screen (T2-A);
- people **loaded and driven off** (T3-A).

Each one shows a method.

*Option A: move the line.* Add to `storyline.md` §0 as a new decision, exactly:

> **D18 — Civilians in danger, in play.** The enemy may be shown endangering civilians in three
> ways and no others: an enemy unit may fire toward civilians who are running, and a civilian it
> hits falls and lies still until a medic reaches him or the mission ends; an enemy group may
> lead civilians away on foot, or carry them off in a vehicle, toward the edge of the map, where
> they leave play as taken; and enemy fire aimed at soldiers may fall among civilians. Nothing
> else is shown: no harm to anyone already taken, no execution, no blood, wound or body effect
> beyond the shipped `down` pose, no camera move, close-up or sound made for these moments, and
> no child figure among people under aimed fire; a downed civilian may be rescued before they are lost; nothing is shown beyond the `down` pose. The story voice still names only what
> happened — fell, taken, a number — never a method; and every such mission gives the player
> the means and the time to prevent most of it.

*Option B: keep the line* (the conservative alternative). Add, exactly:

> **D18 — Civilians in danger, in play.** The enemy never aims at civilians and is never shown
> taking anyone. Civilians fall only to fire aimed at soldiers; those the player has not
> reached by the deadline leave play as taken, said in the feed and the story voice and never
> shown.

*What depends on the answer:*
- **Under either answer:** the crowds and ladder (§3.1), the muster rule, the gate (§2), T1-B crossfire, T2-B deadline taking, T4 blocked road, and G-1, -2, -6, -7, -8, -10, -12, -13, -14, -17.
- **Only under A:** T1-A, T2-A, T3-A and G-4, G-5, G-9, G-16.
- The pilot (§6) is specified both ways.

*Recommendation:* **A**, with the child-figure clause (G-16) mandatory. Restraint as the better
play needs a threat the player can see and stop. B keeps the drama abstract: a number at a
deadline.

**Q2: which mission is "the first mission"? SUPERSEDED: the lead ruled it is `beit_sahwan_breach` (see the rulings block at the head); the recon text below is kept only as the question as it was asked, and its recommendation is not followed.**

_Original text:_  `world.json` puts **`beit_sahwan_breach`** first
after the tutorial. The breach already has a compound (`marj_perimeter` `compound`
[18,17,13,13], with wall gaps at (17,21–22) and (31,24–25)) and 11 civilians outside it.
"Three civilians outside the camp" matches `beit_sahwan_1_recon`'s count, but recon has no
compound and needs a new map (§6). *Recommendation:* the pilot in recon, as briefed; gates in
the breach second (row 2).

**Q3: "Sarim troops".** The Marj missions fight the **Ashwar Front** (`enemy.faction: ashwar`). Sarim is Sur's doctrine. *Recommendation:* read it as "the enemy of each front"; every threat uses its own front's units.

**Q4: capacity.** Hold every mission to ≤ 160 authored entities under today's 256 lifetime cap
(G-10 a)? Or authorise raising the cap (G-10 b, sim work and a measurement)? *Recommendation:*
(a) now, (b) only if a mission needs it.

**Q5: the pilot's frame budget.** May the 100-civilian pilot ship only after a fresh render
measurement on the real roster (`PERFORMANCE.md` F9 marks itself "needs Metal re-read"), with 60
as the fallback size? *Recommendation:* yes.

**Q6: scoring.** Should civilians saved and taken enter the grade, or stay on the after-action
report (G-14)? Should in-mission takings change the board's account of the taken (G-15, D9)?
*Recommendation:* the report only, and the board unchanged: a grade on a count would turn
rescue into points, the thing `grade.ts:7-9` refuses for Conduct.

**Q7: exemptions and promotions.**
- The tutorial: 8 people and no threat (or keep 2)?
- `qasr_liwan_3_buildup` (the Pause): keep its four?
- `qasr_liwan_1_recon`: 8, after G-6?
- `umm_zeitoun_4_clearance`: promote the porters to a primary on the act's climax?

*Recommendation:* 8 for the tutorial, keep the Pause's four, QL I at 8 once G-6 lands, and UZ IV stays a secondary.

**Q8: the gate's look and rules.**
- A new yellow palette ramp, or a textured exemption?
- `low_profile: true`, so sight passes over it like the wall?
- One GLB with a placement-time rotation, or two GLBs/types for the two wall orientations?
- `hp_per_tile` 600?

*Recommendation:* a ramp; low profile; two types; 600, provisional.

**Q9: crowd speed.** A "running" crowd moves at 0.8 t/s today, slower than a rifle squad. Raise
it (for example to 1.2, with a run clip)? *Cost:* all 25 missions re-measured.
*Recommendation:* not in the pilot; decide after it plays.

**Q10: art numbers** (§5). Approve:
- the gate as a Blender build (0 credits, ≈ 0.75–1.25 days with the second orientation);
- 6 Meshy civilian variants (≈ 240–420 credits, ≈ 1–2 Blender days);
- gate audio.

Nothing is spent until approved.

**Q11: the breach's canon numbers.** `storyline.md:100` and `:211` state "11 civilians in 4
groups … 2 counted in". Row 2 proposes 40 and 10. Re-state the canon (the meaning "most do not
get in" is kept), or exempt the breach from the larger crowd? *Recommendation:* re-state it; the
ratio stays at the same tragedy.

---

## 8. Compliance

| rule | how the design satisfies it | where |
|---|---|---|
| Every mission with civilians makes protecting them a scored, achievable objective | all 25 rows carry an evacuation count (four gain one); every primary ≤ 60% of its crowd, every estimated margin ≥ 19 points, to be replaced by `playtest`'s 30-seed reading | §3.2, rules 1–6 |
| No win requires harming civilians | every objective is a count of people brought in; the clean answers (the shepherd, smoke, the demo squad, the Namer over the Lavi) are always open; danger-close and player-caused deaths only cost | §1.2, §6 |
| A defeat from civilian losses is avoidable by a competent player | the only failable civilian objective is `evacuate_before` at its deadline; worst competent loss < the margin; the wounded cap is respected (1–2 cells a firing line) | §3.1, §3.2 |
| A passive player cannot win | crowds run to a muster outside the refuge; the gate opens only for nearby KDF ground units; the passive start is ≥ 4 tiles from every muster and gate, proved per mission by the passive probe | §1.1, §2.3, §6 |
| Non-graphic | people fall into the shipped `down` pose or walk away; no new clip, decal, sound or camera for it; no captive pose; the story voice says *fell*, *taken*, a number | §1.2, §5, §7 Q1 |
| Sarim/Ashwar/Rif are doctrines, never a people or faith; adversaries are job titles | every threat is a unit type and a stance (cells, escort, crew); no new person is named; Q3 keeps each front's doctrine | §1.2, §7 Q3 |
| No real place, people, operation or faith | new names are fictional ids only (`compound_gate`, `beit_sahwan_1`, `gate_apron`, `taken_north`); D12's reference is not repeated in content | throughout |
| Captives are fictional, never named or paraphrased from real events | captives are an unnamed civilian group and a count; no line is written here | §6 |
| No atrocity depiction beyond what storyline.md establishes, unless the lead moves the line | the line is quoted with its sources; everything past it is marked A and gated on Q1; a B form exists for every threat and for the pilot | §1.2, §6, §7 Q1 |
| Invariants 1–4 | the gate steps on the 20 Hz tick, in integers and Q16.16, with no RNG draw and no `Math.*`; the renderer reads a view and events; no new `Command` | §2.3 |
| No existing replay moves | new columns fold behind `gateLive` / `civFireLive`; G-2 measured against the golden hash before it lands | §2.3, §4 |
| Missions are data, not TypeScript | every behaviour is a schema field, a structure type or a trigger | §2.2, §4 |
| `target_minutes` 5–7, `time_limit_s` ≥ 2× and 60 s clear of primary deadlines | no row changes either; every proposed deadline (240–360 s) sits ≥ 60 s inside 720–840 s | §3.2, §6 |
| Shai is not promoted mid-town; one phase a mission | no phase, rank or ladder changes | — |
| `tuning.ts` untouched | the gate's numbers live in `structures.json`; caps are respected, not changed | §2.2, §3.1 |
| Art is approved before it is spent | asks only, with estimates | §5, §7 Q10 |

---

## 9. Narrative sheet (narrative-designer)

**Date:** 2026-11-18 · **Status:** HOLD FOR LEAD with §7. Nothing here is applied to
`data/missions/`. Every string below was checked by script: briefing seams with a port of
`briefingBeats` (`packages/app/src/ui/loading.ts:69-86`, two sentences, 240 characters);
`say`, `dispatch`, `aftermath`, `debrief` at the 240 ceiling (`mission.schema.json:132-141`,
`$defs/say`, `tools/validate_narrative.mjs`); trigger `label` at 48, no full stop
(`mission.schema.json:683-686`, `triggerLabelFailures`); objective text at an authoring
ceiling of **72** (no code limit exists; the longest shipped is 76; the toast prefixes
`OBJECTIVE COMPLETE — `). Templates (§9.3) are checked at the worst-case slot fill stated
with each.

**Status vocabulary** (the contract's, `docs/campaign/README.md`, which marks `say`,
`dispatch`, `aftermath` and `debrief` **live**):

| status | means |
|---|---|
| `live` | the surface AND the event the line hangs on exist; the line ships as data |
| `schema` | needs a schema field that is specced and not built (here: G-6 `evacuate_before.group`) |
| `engine` | the surface or its binding is unbuilt (a trigger on a `SimEvent`, the gate's sound, a coalesced feed line) |

The **needs** column names the mechanic gap (§4) without which the line would describe
something the mission does not do. A `live` line with a needs entry ships only with that gap.

### 9.1 The register

Derived from `storyline.md` D11, D12, §2.4; `beit_sahwan/design.md` §0 and O-D; GDD §2; the
contract's rules 1–3. These bind both answers to Q1. Where A and B differ, it says so.

**Rules.**

1. **A number, never a method.** The story voice and Idit say *how many* and *where*: fell,
   taken, across the line, did not come in, a number. Never how, never what was done to
   anyone, never a body, never a scene. The shipped ceiling is *"nobody is coming back for
   them afterwards"* (`beit_sahwan_breach`) and it stays the ceiling.
2. **Orders voice states the threat as a tile fact and a cost.** *Under A* a briefing may
   say who fires on which ground and when (*"Rifles in the grove north of the wall fire on
   the approach while nothing of ours is in reach"*); *under B* it may say only what enemy
   fire aimed at soldiers reaches. Neither says what a round does to a person.
3. **Nothing graphic, anywhere.** No blood, wound, injury, pain, scream, weeping, body,
   grave. A civilian who is hit has *fallen* or is *down*; the word is said once, in the
   story voice, never in a label or a toast.
4. **No execution, no harm to the taken.** Nobody taken is ever said to be hurt, used,
   traded or threatened. The enemy's purpose for the taken is never stated.
5. **No glorification, no sermon.** A rescue line is a count and the next action. No hero,
   no "saved them all", no "innocent", no "monsters". ROE is billed, never preached.
6. **Doctrine, never a people.** Ashwar Front, Sarim Brigades, Rif Cells are organisations
   defined by doctrine. An adversary is a job title: *cell, escort, crew, rifles, the party
   with them, the tube, the eye, the technical*. Never a faith, ethnicity, nationality,
   dialect, slogan or real insignia. The `enemy` speaker never speaks about civilians.
7. **The taken are fictional.** A captive is a count and a place, never a name, an age, a
   job or a story, and never a paraphrase of a real person or a real event. D12's reference
   is never repeated in content.
8. **No real place, people, operation, date or faith.** Places come from GDD §2 and
   `world.json` only.
9. **Children are never in a casualty or a taken line.** No line says *child*, *children*,
   *boy*, *girl*, *baby* beside fell, taken, fire or down (with G-16 for the figures).
10. **Counted people are *people*.** One civilian entity is one person (`civilians.json`
    `figures: 1`). The shipped text calls a counted body a *family* (breach `count: 2` →
    *"Get two families"*); at crowds of 20–100 that multiplies the implied population four
    or five times. Use **people** (or *residents*, *herders*, *porters*) for every count;
    *families* only uncounted (*"the families in them have nowhere else to go"*).
11. **Static text tells no outcome it cannot know** (D9). A `say` on completion states the
    threshold it fired at; a debrief states only what every such outcome makes true.

**Words to use.**

| for | use |
|---|---|
| civilians | people, the town, residents, herders, porters, carriers (*not* on a mission that also has a loading vehicle, §9.4 row 6), families (uncounted only) |
| harm | fell, are down (story voice only), on the wrong side of it, still out, did not come in |
| abduction | taken, the taken, across the line, moved, walked off, walked toward, did not leave empty |
| rescue | inside, through the gate, clear, at the refuge, came in, came back |
| enemy | cell, escort, crew, rifles, party, the party with them, the tube, the eye, the technical, he (the front's villain, by doctrine) |
| fire on civilians (A only) | fire on the approach, fire on that ground, is firing on their ground |
| crossfire (B) | reaches the ground, calls it onto soldiers, a reason to fire there |

**Words not to use** in any player-facing string (labels, objectives, `say`, briefing,
dispatch, aftermath, debrief): hostage(s), captive(s) and prisoner(s) for civilians; kidnap,
abduct, abduction; execute, execution, massacre, slaughter, murder, atrocity (design word
only); kill, killed, dead, death, body, bodies, corpse, blood, wound(ed), injured, bleeding
for civilians (the chrome strings `conduct.cause.civilians` *"Civilians killed"* and
`alert.conductGain.civilian` are engine-owned and stay); human shield; terrorist, militant,
jihadi, martyr, any faith word; tribe, clan, any ethnonym; innocent, hero, monsters, animals;
ransom, deal, trade, exchange, price (for people); target, aim (for a civilian, B); child,
children, boy, girl, baby (rule 9); withdrawn, withdrawal (`player-wording.test.ts:115-119`);
any real place, operation or date.

**In-game string shapes the feed may carry.**

| surface | shape | example (shipped or §9.2) |
|---|---|---|
| chrome, engine-owned | `taken (n)` · `clear (n)` (`en.json` `notice.removed.civilian`, `notice.evacuated`) | — |
| trigger `label` | `<who> <present-tense verb> <where>`, ≤ 48, no full stop, **no count of fallen or taken, no harm word** | *Families are running for the compound* · *Movement in the north block* |
| objective `text` | imperative · count in words · `people` · place · deadline: `Get <n> people <to/through place> inside <m> minutes` | *Get fifty-five people through the gate inside five minutes* |
| toast | `OBJECTIVE COMPLETE — <text>` / `OBJECTIVE FAILED — <text>` (hard-coded) | — |
| `say` | ≤ 2 sentences, ≤ 240: a count or a fact, then the next action or what it costs | *Fifty-five inside. Keep somebody at that gate until the road in front of it is empty.* |

### 9.2 The pilot: `beit_sahwan_1_recon`

Captain · Act I · Ashwar Front · map `beit_sahwan_1` (new, §6). Every line waits on the new
map and on G-3 (the gate); the **needs** column lists only what a row needs beyond that.
`name` stays **`Beit Sahwan I — Recon`** in both variants: every Beit Sahwan mission is named
by its phase, and the gate is the drama, not the title.

**Facts held from canon.** The compound is the brigade's, at the west edge of the town; its
gate is a huge yellow heavy metal gate that opens only when a soldier of ours comes within
four tiles (§2); a family follows a soldier within four tiles (the shepherd rule,
`civilians.ts:200-215`, stated as the breach states it since GH-279). Shai's motive, the
families that did not get in at First Light, is **never said by Shai**; Idit says it once,
in the debrief, without a number (so it survives either answer to Q11). Idit is named in the
third person in the JSON, as every Act I briefing but First Light does
(`beit_sahwan/narrative.md` §0.2). NOTE: the strings do not claim this is the First Light
compound, which is on another map (`marj_perimeter`); the lead may make it so without a
word changing.

#### Variant A — the line is moved

**`dispatch`** (narrator, 231): *Beit Sahwan never emptied after First Light; there was
nowhere for it to go. The brigade's compound at the west edge of town has a yellow gate that
opens for soldiers and nobody else, and everybody in Beit Sahwan knows where it is.*
· `live` · same in B.

**`briefing`** — 1,214 characters, 7 beats. Paste as one string; there are **no line
breaks** (the contract allows none: `briefingBeats` splits on sentence ends only, and
`briefing_sections` texts joined with one space must spell `briefing`,
`mission.schema.json:118`):

```
Before anything moves on Beit Sahwan, Idit needs the picture: six garrison positions, and the ATGM pair that overlooks the east road. An identification takes eyes held on a position, not a glance. The battalion has attached one of everything it owns: armor, an IFV, mortars, scouts and a drone. Push the drone east, keep the heavy metal back as a screen, and do not get decisively engaged. The town never emptied: when we step off, nearly ninety people run for the yellow gate in our wall. Rifles in the grove north of the wall fire on the approach while nothing of ours is in reach. The gate opens for one of ours within four tiles, and anyone within four tiles of him follows him through. Leave it and it shuts on whoever is outside; get fifty-five in by five minutes, and give the grove something of ours to look at. Twelve more are in the north block by the track. At two minutes the cell there walks them east, and at the edge they are across the line. Reach the track and they break for us. The Lavi's gun is billed within two tiles of anyone; the Namer's cannon and the rifles are not. The mortar does not care who is under it. What you find and who you bring home is what the brigade fights with next week.
```

| beat | speaker | chars | section | what it carries |
|---|---|---|---|---|
| 1 | Idit | 196 | `situation` (image `ui/portraits/idit_zohar.png`, kept) | shipped verbatim |
| 2 | Shai | 192 | `mission` | shipped, trimmed: *"— so use this approach to learn your tools"* cut to fit the band |
| 3 | Idit | 193 | `execution` | the crowd, the gate, the grove (T1-A) |
| 4 | Shai | 235 | `execution` | the gate rule, the shepherd rule, the count, the cost: soldiers draw the fire |
| 5 | Idit | 137 | `execution` | the north block, the clock, the edge (T2-A) |
| 6 | Shai | 134 | `execution` | the release; danger-close stated as a bill (`mission.ts:794-796`: `gun_120` 0.55 and `mortar_60` 0.7 are heavy, `cannon_30` 0.35 and `rifles` 0.1 are not) |
| 7 | Shai | 121 | `notes` | shipped verbatim; the cost close |

Idit / Shai / Idit / Shai / Idit / Shai / Shai — the picture and the plan alternate, and the
back half closes on Shai's costs, as First Light's does.
*Compliance:* 7 beats, each ≤ 2 sentences and ≤ 240; total inside 385–1,225; no harm word;
the fire is a tile fact (*fire on the approach*), never what it does; the taking is *walks
them east* and *across the line*; restraint is two bills and one exposure, no sermon.

**Objectives** (ids and types are §6's; only text is this sheet's).

| id | order (chars) | toast | status | needs |
|---|---|---|---|---|
| `picture` | Identify six garrison positions (31) | `OBJECTIVE COMPLETE — Identify six garrison positions` | live | — (shipped) |
| `hvt_seen` | Identify the ATGM pair overlooking the east road (48) | `OBJECTIVE COMPLETE — Identify the ATGM pair overlooking the east road` | live | — (shipped) |
| `find_the_column` | Identify the track north of the road (36) | `OBJECTIVE COMPLETE — Identify the track north of the road` | live | — (shipped) |
| `into_the_compound` | Get fifty-five people through the gate inside five minutes (58) | `OBJECTIVE FAILED — Get fifty-five people through the gate inside five minutes` | live | G-3 |
| `most_of_them` | Get eighty-five people through the gate inside five minutes (59) | `OBJECTIVE COMPLETE — Get eighty-five people through the gate inside five minutes` | live | G-3 |
| `north_block` | Bring eight of the north block's twelve through the gate (56) | `OBJECTIVE COMPLETE — Bring eight of the north block's twelve through the gate` | **schema** | G-6; **not** `hostages: true` (§9.6 N1). Before G-6 the row is dropped and its lines below go with it |

*Compliance:* every text ≤ 72, imperative, no full stop, *people* not *families* (rule 10),
reads as an order and as a toast.

**Trigger table — Variant A.** Trigger ids are proposals for `level-scripter`.

| event | channel | speaker | line | overlay / audio | status | needs |
|---|---|---|---|---|---|---|
| mission start | `title` | system | `Beit Sahwan I — Recon` · *2 primary objectives* | `hud.announce` | live | — |
| mission start | `dispatch` | narrator | as above | title card | live | — |
| mission start | `brief` | Idit / Shai | beats 1–7 | deploy screen, commander bar | live | — |
| `timer_s(2)` → `families_run` (`withdraw_to crowd → gate_apron`) | `toast` | system | `Families are running for the compound` (37) | feed, `warn` tone | live | G-1 |
| same | `radio` | Idit | "Most of the town is running for our gate, and their road passes under the grove. The rifles in it have not fired yet." (117) | commander bar | live | G-4 |
| first `fire` by the `fl_north` cells | `radio` | Idit | "The grove is firing on the road. Put something of ours in its reach and it looks at that instead." (97) | commander bar | **engine** | `on.kind: sim` (storyline G6) + G-4 |
| a civilian `down` (any cause) | — | — | **no line, by design** (rule 3; a line per fall is a cutscene by attrition) | — | — | — |
| `gateOpened` / `gateClosed` | audio | — | no line; the gate's motor and clank | `render/audio.ts`, `data/audio.json` | **engine** | G-3, §5 gate audio |
| `evacuated`, per person | `toast` | system | `clear (1)` — up to 100 lines | feed | live | — |
| `evacuated`, coalesced | `toast` | system | `clear (n)`, one line per second of arrivals | feed | **engine** | §9.6 N6, `render-vfx` |
| `timer_s(120)` → `north_block_moves` (`withdraw_to takers → taken_exit`) | `toast` | system | `Movement in the north block` (27) | feed | live | G-5 approximation |
| same | `radio` | Idit | "The north block cell is walking twelve people east along the track, toward the edge. They are not hurrying." (107) | commander bar | live | G-5 approximation |
| `timer_s(120)` → `north_block_walked` (`withdraw_to taken_north → taken_exit`) | `toast` | system | `North block families walked east` (32) | feed | live | G-5 approximation; §9.6 N2 |
| `group_in_zone(rescuers, north_track)` → `north_block_breaks` (`withdraw_to taken_north → gate_apron`) | `toast` | system | `The north block families break west` (35) | feed | live | §9.6 N2 (ordering) |
| same | `radio` | Shai | "They are loose and running for the gate. The Lavi's gun stays off that escort while they are this close to it." (110) | commander bar | live | — |
| `group_in_zone(taken_north, taken_east)` → `north_block_taken` (`remove taken_north`) | `toast` | system | no label (`remove` is silent); chrome `taken (1)` per person | feed | live | — |
| same | `radio` | Idit | "The track is empty to the east edge. Whoever was walking on it is across the line now." (86) | commander bar | live | — |
| same tick → `north_block_takers_leave` (`remove takers`) | — | — | silent, no `say` | — | live | — |
| `first_contact` → `hunt_the_scouts` | `toast` + `radio` | system / Idit | shipped label and line, unchanged | — | live | — |
| `objective(picture)` / `(hvt_seen)` complete | `toast` + `radio` | Idit | shipped lines, unchanged | — | live | — |
| `objective(into_the_compound, complete)` | `radio` | Shai | "Fifty-five inside. Keep somebody at that gate until the road in front of it is empty." (85) | commander bar | live | G-3 |
| `objective(into_the_compound, failed)` @300 s | `radio` | Idit | "Five minutes, and fewer than fifty-five came through that gate. Everybody else is on the wrong side of it." (106) | commander bar | live | G-3 |
| `objective(most_of_them, complete)` | `radio` | Idit | "Eighty-five through the gate. That is the first count in this war I wanted to write down." (89) | commander bar | live | G-3; §9.4 row 11 |
| `objective(most_of_them, failed)` | — | — | no `say_on_fail`: a secondary missed on a won mission is read on the report, not said | — | — | — |
| `objective(north_block, complete)` | `radio` | Idit | "Eight from the north block are inside the wall. That track ends at our gate today, not at the east edge." (104) | commander bar | **schema** | G-6 |
| `missionEnd(victory)` | `aftermath` | narrator | *By dark there were more people than soldiers in the compound yard. Nobody in Beit Sahwan asked where the line was after that; they had seen the gate open.* (154) | victory banner | live | — |
| `missionEnd(victory)` | `debrief` | Idit | "The district is on a board, and more of the town came through that gate than stayed outside it. At First Light it was the other way round." (138) | end screen, her plate | live | — |
| `missionEnd(defeat)` | `debrief` | Shai | "We came off the outskirts short. On this ground the picture and the gate were one job, and we did not finish it." (112) | end screen, his plate | live | — |

*Compliance:* labels ≤ 48, no full stop, no harm word, no count of taken; every `say` ≤ 240
and ≤ 2 sentences; the taking is *walking … toward the edge* and *across the line*, never a
purpose; no line from the `enemy` speaker; debriefs are true for every victory (≥ 55 of 100
in means more in than out; First Light's 2 of 11, or 10 of 40 under Q11, was the other way
round) and every defeat; Shai never names the motive, Idit names it without a number.
`dispatch` and `aftermath` describe a place and a gate, not an act.

#### Variant B — the line is kept

Same `name`, `dispatch`, `aftermath`, both `debrief` lines and the three locate objectives
as A: none of them describes the enemy acting on a civilian.

**`briefing`** — 1,222 characters, 7 beats, the same speakers and sections as A (beat 3 corrected for §10.5 N30: the spotter is `eye_north`, over the grove, not the paramotor to the east; **superseded** by the 18 Nov rulings: Q1 is A and Q2 moves the pilot to the breach, §9.7):

```
Before anything moves on Beit Sahwan, Idit needs the picture: six garrison positions, and the ATGM pair that overlooks the east road. An identification takes eyes held on a position, not a glance. The battalion has attached one of everything it owns: armor, an IFV, mortars, scouts and a drone. Push the drone east, keep the heavy metal back as a screen, and do not get decisively engaged. The town never emptied: when we step off, nearly ninety people run for the yellow gate in our wall. Their mortar in the town centre reaches the ground in front of it, and the eye over the grove calls it onto soldiers. The gate opens for one of ours within four tiles, and anyone within four tiles of him follows him through. Leave it and it shuts on whoever is outside; get fifty-five in by five minutes. Twelve more wait in the north block, thirty tiles east, for one of ours to come within four tiles. At four minutes somebody else moves them. The Lavi's gun is billed within two tiles of anyone; the Namer's cannon and the rifles are not. Every soldier in that crowd gives their tube a reason to fire there. The mortar does not care who is under it. What you find and who you bring home is what the brigade fights with next week.
```

| beat | speaker | chars | change from A |
|---|---|---|---|
| 1, 2, 7 | Idit, Shai, Shai | 196, 192, 121 | none |
| 3 | Idit | 217 | the grove becomes the new `mortar_crew` at (30,22) and the grove's spotter (`eye_north`, §10.1.5): *calls it onto soldiers* (B: fire aimed at soldiers only) |
| 4 | Shai | 186 | the cost clause moves to beat 6 |
| 5 | Idit | 140 | the north block waits for a shepherd; *"At four minutes somebody else moves them"* (the `remove` at 242 s; the register of shipped `umm_zeitoun_1_recon`) |
| 6 | Shai | 164 | the bill, then the crossfire cost: soldiers in the crowd draw the tube |

*Compliance:* as A; in addition no sentence has the enemy aim at, fire on or lead away a
civilian. *Fire there* is the riskiest phrase in B (§ report); its meaning is carried by
*soldier in that crowd*, not by a description of what lands.

**Objectives:** as A. `north_block` (schema, G-6) keeps its text.

**Trigger table — Variant B** (rows identical to A are not repeated: title, dispatch,
brief, `families_run` label, `hunt_the_scouts`, the locate objectives, the `evacuated`
rows, the gate audio row, `into_the_compound`, `most_of_them`, aftermath, both debriefs).

| event | channel | speaker | line | overlay / audio | status | needs |
|---|---|---|---|---|---|---|
| `timer_s(2)` → `families_run` | `radio` | Idit | "Most of the town is running for our gate. The tube in the town centre can reach the ground in front of it." (106) | commander bar | live | new `mortar_crew` placement |
| first `fire` by the new `mortar_crew` | `radio` | Idit | "That tube is firing at the gate because we are standing at it. Fewer of ours there, fewer rounds." (97) | commander bar | **engine** | `on.kind: sim` |
| `timer_s(242)` → `north_block_moved` (`remove taken_north`) | `toast` | system | no label; chrome `taken (1)` per person not yet shepherded | feed | live | — |
| same | `radio` | Idit | "The north block is empty. Nobody fought over it; whoever we had not reached was moved while we were at the gate." (112) | commander bar | live | — |
| `objective(north_block, complete)` | `radio` | Idit | "Eight from the north block are inside the wall. They waited for us, and this time somebody came." (96) | commander bar | **schema** | G-6 |

*Compliance:* B shows no taking: the `remove` is silent, its line is said after the fact
and names no method beyond *moved* (the shipped ceiling: `khan_rafid_1_recon`,
`qarn_hadid_1_recon`, `umm_zeitoun_1_recon` say *walked off*). *This time somebody came* is
the one line in the pilot that leans on First Light; it is Idit's, and it has no number.

**Pilot row count.** Variant A's trigger table: 28 rows (two deliberately carry no line),
**3 `engine`** (the grove's first fire, the gate audio, the coalesced feed), 1 `schema`; its
objective table adds 1 `schema`. Variant B's own table: 5 rows, **1 `engine`** (the tube's
first fire), 1 `schema`, and it shares A's gate-audio and coalesced-feed rows. **The pilot
sheet writes 4 distinct `engine` rows; either variant as played carries 3.**

### 9.3 Reusable line templates

Slots and their **published maxima** (the checks ran at these):
`{N}` the crowd and `{K}` the required count, in words, ≤ 12 (`{Nc}`, `{Kc}` capitalised) ·
`{M}` minutes in words ≤ 5 (`{Mc}`) · `{T}` a time in words ≤ 16 (*two minutes*; the template
supplies *at*) · `{place}` ≤ 24 with its article, **≤ 20 in an
objective, ≤ 24 in a label** · `{refuge}` ≤ 20 · `{fire}` the firing position ≤ 24 ·
`{weapon}` ≤ 16 (*their mortar*, *the battery*; `{Weapon}` capitalised) · `{edge}` ≤ 16 ·
`{Crowd}` the label noun ≤ 10 (*Families*, *Herders*, *Residents*, *Porters*) ·
`{holding}` the holding place ≤ 20 · `{barrier}` ≤ 16. Fill `{Crowd}` with a plural noun
(the verbs agree). A filler never puts a harm word, a faith word or a real name into a slot.

Briefing templates are two beats, Idit then Shai; drop them into a briefing at a seam.
Every row's status is the template's; the mission inherits it.

**T1 — Firing line**

| form | channel | speaker | template | max | status | needs |
|---|---|---|---|---|---|---|
| A | brief | Idit | {Nc} people are at {place}, and when they run it is for {refuge}. Rifles at {fire} fire on that ground while nothing of ours is in reach. | 192 | live | G-4 |
| A | brief | Shai | Get {K} of them to {refuge} in {M} minutes, and give {fire} something of ours to look at. Answer it with the rifles; a heavy round near the crowd is billed where it lands. | 212 | live | G-4 |
| A | `radio` on the flight trigger | Idit | They are running, and their way to {refuge} passes in front of {fire}. Nothing of ours is in its reach yet. | 137 | live | G-4 |
| A | `radio` on the first enemy `fire` | Idit | The position at {fire} is firing on their ground. Put something of ours in its reach and it looks at that instead. | 132 | **engine** | `on.kind: sim` |
| B | brief | Idit | {Nc} people are at {place}, and when they run it is for {refuge}. {Weapon} at {fire} reaches that ground, and it fires on any soldier it is told about there. | 220 | live | — |
| B | brief | Shai | Get {K} of them to {refuge} in {M} minutes, with no more of ours beside them than the walk needs. Every soldier in that crowd gives {weapon} a reason to fire there. | 195 | live | — |
| B | `radio` on the flight trigger | Idit | They are running, and {weapon} at {fire} can reach the ground they cross. It is looking for us, not for them. | 135 | live | — |
| B | `radio` on the first enemy `fire` | Idit | That is {weapon} firing at our soldiers beside the crowd. Fewer of ours there, fewer rounds. | 100 | **engine** | `on.kind: sim` |
| both | label (flight) | system | {Crowd} are running for {refuge} | 47 | live | G-1 |
| both | objective | — | Get {K} people to {refuge} inside {M} minutes | 68 | live | — |
| both | `say` on complete | Shai | {Kc} at {refuge}. Keep something of ours between them and whatever is still firing. | 103 | live | — |
| both | `say_on_fail` | Idit | {Mc} minutes, and fewer than {K} reached {refuge}. Everybody else is still out on that ground. | 116 | live | — |

*Compliance:* no harm word; A names who fires on which ground, B only what reaches it; the
cost is a bill or an exposure; *the crowd* never becomes a target noun in B.

**T2 — Abduction column**

| form | channel | speaker | template | max | status | needs |
|---|---|---|---|---|---|---|
| A | brief | Idit | {Nc} more are in {place}. At {T} the cell there walks them toward {edge}, and at {edge} they are across the line. | 171 | live | G-5 (or its approximation) |
| A | brief | Shai | Reach them before then and they break for us. Rifles and the Namer's cannon are clean beside them; the Lavi's gun and the mortar are billed within two tiles. | 157 | live | — |
| A | label (the escort moves) | system | Movement in {place} | 36 | live | — |
| A | label (the people move) | system | {Crowd} walked toward {edge} | 41 | live | — |
| A | `radio` (the escort moves) | Idit | The cell in {place} is walking {N} people toward {edge}. They are not hurrying. | 115 | live | — |
| A | label (release) | system | {Crowd} break for {refuge} | 41 | live | §9.6 N2 |
| A | `radio` (release) | Shai | They are loose and running for {refuge}. Keep the heavy guns off the escort while they are this close to it. | 120 | live | — |
| A | `radio` on the `remove` | Idit | The way to {edge} is empty. Whoever was walking on it is across the line now. | 87 | live | — |
| A | objective | — | Bring {K} from {place} to {refuge} | 72 | **schema** | G-6 |
| A | `say` on complete | Idit | {Kc} from {place} are at {refuge}. That walk ends with us today, not at {edge}. | 126 | **schema** | G-6 |
| B | brief | Idit | {Nc} people are in {place}, and they wait for one of ours to come within four tiles. At {T} somebody else moves them. | 155 | live | — |
| B | brief | Shai | Get {K} of them to {refuge} before then. Whoever is still at {place} after that is not ours to move. | 138 | live | — |
| B | `radio` on the `remove` | Idit | Nobody is left at {place}. There was no fight for it; whoever we had not reached was moved while we looked elsewhere. | 134 | live | — |
| B | objective | — | Get {K} people to {refuge} inside {M} minutes | 68 | live | — |
| B | `say_on_fail` | Shai | {Mc} minutes. Whoever is still at {place} is not ours to move now. | 84 | live | — |

*Compliance:* the taking is *walks/walked toward*, *moved*, *across the line*; no purpose,
no treatment, no count of taken in any label; B never shows the move (the `remove` is
silent and its line is after the fact).

**T3 — Vehicle snatch** (A only; under B substitute T4, §1.2)

| channel | speaker | template | max | status | needs |
|---|---|---|---|---|---|
| brief | Idit | A technical is working {place}, three seats in the back, and it drives whoever it loads toward {edge}. It is quick on a road and slow off one. | 169 | **engine** | G-9 (civilians boarding a side-1 carrier keep their side) |
| brief | Shai | Stop it short of {edge} and the people in the back get down and run for us. Kill it with them aboard and every one of them is billed. | 143 | **engine** | G-9, and its ROE ruling: true only if riders' deaths are charged to the carrier's shooter |
| label (loading) | system | A technical loads at {place} | 45 | **engine** | G-9 |
| `radio` (loading) | Idit | The technical at {place} has people in the back and is driving for {edge}. Three seats; it will come back for more. | 142 | **engine** | G-9 |
| label (`dismount`) | system | People are off the technical | 28 | **engine** | G-9 |
| `radio` (`dismount`) | Shai | They are off the truck and running for {refuge}. Leave the truck to the rifles. | 91 | **engine** | G-9 |
| label (drive-off) | system | The technical drives for {edge} | 41 | **engine** | G-9 |
| `radio` on the `remove` | Idit | The technical is over {edge}, and it did not leave empty. | 67 | **engine** | G-9 |

*Compliance:* *did not leave empty* is the shipped breach register (*"not walking back
empty"*); no rider is described; the restraint is a bill (*every one of them is billed*),
the ROE cliff storyline T9 names.

**T4 — Blocked road** (both forms)

| channel | speaker | template | max | status | needs |
|---|---|---|---|---|---|
| brief | Idit | The short way from {holding} to {refuge} is shut: {barrier} across {place}, with a cell holding behind it. The people at {holding} will stand in the open until it opens. | 227 | live | G-19 (the barrier as a mission structure) |
| brief | Shai | Open it. The engineers take it down slowly and cost nothing; the tank gun takes it down at once and is billed for everyone within two tiles. | 140 | live | G-19 |
| label (`group_in_zone(crowd, stall_zone)`) | system | {Crowd} stopped at {place} | 41 | live | a `do` of the scripter's choosing (every trigger needs one) |
| `radio` (same) | Idit | They have stopped at {barrier} and they are standing in the open. Nothing goes round it on that side. | 108 | live | — |
| label (`group_in_zone(crowd, beyond_zone)`) | system | The road at {place} is open | 44 | live | as above |
| `radio` (same) | Shai | The road is open. Walk them through before anything else closes it. | 67 | live | — |

**Debrief pair, any threat** (use where the evacuation is the mission's only failable
primary; else write the mission's own):

| outcome | speaker | template | max | status |
|---|---|---|---|---|
| victory | Idit | The order was {K}, and the count reached it. Everybody else from {place} goes in the book by number. | 126 | live |
| defeat | Shai | We came off {place} short of {K}. That was the order, and nothing else we did today changes it. | 121 | live |

**Template row count:** 43 rows (T1 12, T2 15, T3 8, T4 6, debrief 2), **10 `engine`**
(T1 ×2, T3 ×8), 2 `schema`. **§9 in all: 14 distinct `engine` rows** (pilot 4, templates 10).

### 9.4 Text audit of the 25 missions

Read this session from `data/missions/*.json` with `jq` (briefing, dispatch, aftermath,
debrief, every objective `text`/`say`/`say_on_fail`, every trigger `label`/`say`, every wave
`say`). **UNREAD:** `briefing_sections` (they must spell `briefing`, so they change with it);
the locale overlays `data/locales/en/missions.json` and `data/locales/de/missions.json`
(every text change below lands there too; the German needs a translator); the tutorial step
file beyond the two `en.json` keys cited.

Verdict: **CHANGE** a count or claim contradicts the proposed crowd; **CHANGE-A** contradicts
only under A; **OK** nothing contradicts; **PRE** a defect today, independent of the drama.

| # | mission | crowd (§3.2) | verdict | the sentences that contradict (field: quote) |
|---|---|---|---|---|
| 1 | `beit_sahwan_0_tutorial` | 2 → 8 | CHANGE | objective `bring_them_in`: *"Bring the two civilians to the refuge"*; `en.json` `tutorial.beit_sahwan_0.bring_them_in.teach`: *"Two civilians are hiding south of the road. Drive the jeep to them and they climb in"* (a jeep does not carry eight; the step teaches carrying) |
| 2 | `beit_sahwan_breach` | 11 → 40 (Q11) | CHANGE if Q11 restates | briefing: *"get at least two inside before the ring closes"*; objective: *"Get two families inside the wire before the ring closes"*; `say`: *"Two in. Get the gate shut behind them."*; `debrief.victory`: *"Eleven were outside the wire at first light. Two came in."* Under A also the `the_ring_closes` `say` *"they are not walking back empty"* stays true; T2-A's column needs its own labels (§9.3 T2) |
| 3 | `beit_sahwan_1_recon` | 3 → 100 | CHANGE | whole text, §9.2. `debrief.victory` replaced |
| 4 | `beit_sahwan_3_clearance` | 5 → 30 | CHANGE | `debrief.victory`: *"The town is ours and the block is still standing. Both of those were the objective."* (a third, civilian primary is added); briefing *"residents shelter among the buildings"* needs the flight and the barrier (T4) |
| 5 | `beit_sahwan_4_subterranean` | 8 → 15 | CHANGE (G-6) | objective: *"Get five people out to the collection point before the routes come down"*; `say`: *"Five at the collection point. That is the first time this district has given anybody back."* (split into 3/4 taken + 6/11 residents; under A the second sentence is also contradicted by BS I's north block, row 3). Briefing *"A rocket team stands over the four"* holds under B; under A the four are moved at 150 s and the sentence needs *"and at two and a half minutes it walks them toward the tunnel mouth"* |
| 6 | `ein_qasab_1_recon` | 4 → 24 | CHANGE | briefing: *"Four carriers are out there, two loaded on the south causeway and two in the hamlet yard"*, *"Get three of them to the refuge"*; objective: *"Get three carriers to the refuge before the next load moves"*; `say`: *"Three at the refuge."* CHANGE-A: *carriers* and *load* already mean people carrying freight (*"Every load on that road tonight is a family"*); T3-A's technical *loading* people collides with it. Use T4, or rename the people *porters* |
| 7 | `ein_qasab_2_foothold` | 2 → 20 | CHANGE | briefing: *"A family is in the yard between the house and the barn, two tiles from the cell inside it"*, *"The barn is the order; the house and the family beside it are on the rating."* No civilian objective exists to carry the new primary |
| 8 | `ein_qasab_3_buildup` | 5 → 24 | OK (adds) | no count is stated; `take_the_mill` `say` *"There are families in the mill"* and wave 300 *"If the families are still inside it"* hold; the new primary needs a briefing beat |
| 9 | `khan_rafid_1_recon` | 4 → 40 | CHANGE | briefing: *"Four people are stopped in the Old Town alleys … Get two of them back inside the ward inside four minutes. The jeep and the Eitan carry two each"*; objective: *"Get two families into the ward inside four minutes"*; `say`: *"Two inside the wall."*; `debrief.victory`: *"Two into the ward and two still in the alley. Four seats, one street and thirty tiles"*. CHANGE-A: the `they_move_the_families_off` `say` *"Nobody fought over them; they were walked off it while the drone was over the souk"* is false once the column is on screen and interceptable |
| 10 | `khan_rafid_2_foothold` | 6 → 30 | CHANGE | briefing: *"Six people in three groups … Four have to be inside that wall in five minutes; the wall will hold all six."*; objective: *"Get four families into the ward inside five minutes"*; `say`: *"Four inside the wall. There is room in there for the other two and eighty seconds of clock"*; `debrief.victory`: *"Four inside the wall and the wall held."* |
| 11 | `khan_rafid_3_clearance` | 8 → 30 | CHANGE | briefing: *"Eight families are in that quarter … six of them have to be inside the ward in five minutes. The carriers hold eleven between them, so the clock is the only thing standing between you and all eight."*; objective: *"Get six families into the ward inside five minutes"*; `say`: *"Six into the ward. I have kept this count since the first morning of the war and that is the best of them."* (false after BS I's 55, and after KR II at 16); `debrief.victory`: *"Six of the eight … I will write the other two down"* |
| 12 | `qarn_hadid_1_recon` | 4 → 30 | CHANGE | briefing: *"Four families are stopped on the pass road … Get two of them back … The jeep and the Eitan carry two each"*; objective: *"Get two families off the pass road inside four minutes"*; `say`: *"Two into the staging ground."* The `remove` `say` holds under B |
| 13 | `qarn_hadid_3_clearance` | 5 → 24 | CHANGE | briefing: *"Three families are in it and the yard they walk to is the clinic's own"*; objective: *"Get three families out of the village to the clinic yard inside five minutes"*; `say`: *"Three in the clinic yard."* Wave 330 *"He knows which yard we told those families to walk to"* reads as intent toward civilians: within the shipped line (movement, not fire), but under B do not add fire to it |
| 14 | `qasr_liwan_1_recon` | 1 → 8 | OK (adds, G-6) | the one-taken texts hold (*"Walk one person out to the north road"*); the 7 residents need a secondary text and a line; the `hostages: true` objective must be group-scoped first (G-6), or residents count as the taken |
| 15 | `qasr_liwan_2_foothold` | 9 → 40 | CHANGE | briefing: *"Nine residents are in the south quarter's lanes … Six of them through inside five minutes"*; objective: *"Get six residents south of the Cut"*; `say`: *"Six through the checkpoint and south of the Cut."* |
| 16 | `qasr_liwan_3_buildup` | 4 (kept) | OK | nothing contradicts; D18 (either) holds: nothing is done to the four |
| 17 | `qasr_liwan_4_clearance` | 6 → 24 | CHANGE | briefing: *"Six people are in the forecourt … Walk five of them to the refuge"*; objective: *"Walk five people out of the clinic forecourt"*; `say`: *"Five out of the forecourt and at the refuge."* *"A firing position covers that gate from the south-west"* holds under B only if it fires on soldiers; under A it is the T1-A position and needs its reach stated |
| 18 | `tel_marum_1_recon` | 3 → 40 | OK (scale) + terminology | no count in any line (*"Herders are grazing that floor"*, *"Get the herders off the valley floor"*). NOTE: its refuge is called *"the muster ground"* in the briefing; §1.1's design word *muster* means the opposite (the holding point outside the refuge). The design word must not reach a TM I line (§9.6 N7). `say_on_fail` *"The battery walked its fire onto the floor"*: under B this is fire aimed at soldiers on the floor, and it is told canon (LANTERN) — §9.6 N4 |
| 19 | `tel_marum_3_clearance` | 3 → 24 | CHANGE | briefing: *"Three families still live in it — get them out to the approach inside five minutes"*; objective: *"Get three families out of the town block before the fighting reaches it"*; `say`: *"Block is clear. Three families in the approach"* (and *"Block is clear"* overclaims when the count is a share) |
| 20 | `umm_zeitoun_1_recon` | 3 → 30 | CHANGE | briefing: *"Three families are at the wells … The jeep is the only thing … that can carry a family off that flank"*; objective: *"Get two families from the wells into the wadi inside four minutes"*; `say`: *"Two families in the wadi."*; `debrief.victory`: *"two families in the wadi"*. CHANGE-A: the `remove` `say` *"They walked them north between the hills while we were looking at the hills"* is false once the column is shown |
| 21 | `umm_zeitoun_3_clearance` | 6 → 30 | CHANGE | briefing: *"Six families are in the hamlet … Get four of them to the wadi"*; objective: *"Get four families out of the hamlet to the wadi inside five minutes"*; `say`: *"Four out of the block."*; `debrief.victory`: *"four out of the block"* |
| 22 | `umm_zeitoun_4_clearance` | 4 → 20 | CHANGE | briefing: *"Four porters are on the depot ground"*; objective: *"Get three porters off the depot ground to the northern shelf"*. CHANGE-A: T2-A *"porters marched off to carry for the battery"* states a purpose for the taken (rule 4): write it as T2 *walks them toward {edge}*, no purpose |
| 23 | `wadi_halam_1_fords` | 4 → 40 | CHANGE + PRE | briefing: *"Four of them are carrying for him at the south ford tonight"*; objective: *"Get three carriers off the south ford to the refuge"*; **PRE:** `say` *"Four of them off the ford"* fires at count 3 today |
| 24 | `wadi_halam_3_counterraid` | 4 → 30 | CHANGE | objective: *"Get three herders off the cattle track to the refuge"*. The briefing names no civilians at all and needs a beat; `debrief.victory` *"a track full of people"* already fits a crowd |
| 25 | `wadi_halam_4_village` | 4 → 40 | CHANGE + PRE | **PRE:** `say` *"Every one of them is at the refuge."* fires at count 3 of 4 today, and at 20 of 40 it is plainly false; `say_on_fail` *"Nine did not come in at First Light"* is canon-bound (Q11). Under A the shown atrocity (`storyline.md:231`) is the T1-A position: it needs a briefing sentence in §9.3 T1-A form |

**Totals:** 21 CHANGE (row 2 only if Q11 restates; rows 23 and 25 also PRE), 2 OK with
additions (8, 14), 2 OK (16; 18 with a terminology note); 7 rows carry an A-only clause
(5, 6, 9, 17, 20, 22, 25). Rows 1–25 are every file `grep -l '"civilians"'
data/missions/*.json` returns.

### 9.5 What changes in canon

**D18 — Option A** (proposed for `storyline.md` §0.1; differs from §7's draft only where
marked ✱). NOTE: the lead ruled Option A on §7's wording, which is what `storyline.md` §0.2 carries, plus the
rescue clause of 18 Nov; this refined text is a proposal, not what was adopted:

> **D18 — Civilians in danger, in play.** On the map the enemy may endanger civilians in
> three ways and no others: an enemy unit may fire toward civilians who are running ✱while no
> soldier of ours is in its reach✱, and a civilian it hits falls into the shipped `down` pose
> and nothing more; an enemy group may walk civilians, or drive them in a vehicle, toward the
> edge of the map, where they leave play as taken; and enemy fire aimed at soldiers may fall
> among civilians. Nothing else is shown or said: no harm to anyone already taken, no
> execution, no blood, wound or body effect, no camera move, close-up, sound or line made for
> these moments, ✱no child figure among people under aimed fire, led away or carried off, no
> line in the enemy's voice about civilians, and no stated purpose for the taken✱. A downed
> civilian may be rescued before they are lost; nothing is shown beyond the `down` pose (the
> lead's ruling of 18 Nov). The story
> voice names only what happened (fell, taken, across the line, a number), never a method.
> Every such mission gives the player the means and the time to prevent most of it,
> ✱measured by `playtest`✱. What the war does to civilians off the map stays told, under D12.

**D18 — Option B:**

> **D18 — Civilians in danger, in play.** No enemy unit on the map aims at a civilian, or is
> shown leading or carrying one away. On the map civilians fall only to fire aimed at
> soldiers, and those the player has not reached by a deadline leave play as taken: said in
> the feed and in the story voice, never shown. What the war does to civilians off the map —
> the rockets on the north, the corridor — stays told, under D12. The story voice names a
> number, never a method.

✱ *Why B differs from §7's text:* §7's *"The enemy never aims at civilians"* is unscoped,
and canon already has the enemy doing so off the map (§9.6 N4).

**`storyline.md` edits** (the lead's to approve; not made here):

| where | under A | under B |
|---|---|---|
| §0.1 | add D18 (A) | add D18 (B) |
| §0.2 D12, consequence column | append *"In play, within D18."* | same |
| §3.1 Table B, `_breach` twist T1 *"the civilians still outside are killed, not merely left"* | **retire**: *"Retired by D18: those outside at the deadline are taken (shipped `remove`), never killed."* | same |
| §7 G7, *"`execute` (a named civilian group dies)"* | **retire**: *"Retired by D18; `remove` is the only verb."* | same |
| §3.3 `_1_fords` T9 *"The riders are carrying"* | becomes T3-A, needs G-9 | stays told; no technical carries a civilian on screen |
| §2.4 | add rule 7: *"Civilians in danger are written in the register of `docs/campaign/civilian-drama.md` §9.1."* | same |
| §1 (*"eleven civilians in four groups … Two get in. Nine do not"*), §2.1(3), §2.3 SPADE atrocity row | only if Q11 restates (below) | same |

**Q11 (the breach's canon numbers).** NOTE, disagreeing with §7's recommendation: **keep
11 / 2 / 9.** The number is spoken across three acts (breach `debrief.victory`, WH IV
`say_on_fail` *"Nine did not come in at First Light. Somebody has to keep saying the number"*,
`storyline.md` §1, §2.1(3), §2.3) and it is the number Idit is defined by saying
(§2.2(6)). Leave the breach at tier S for the counted families, or grow it with people who
are already inside at t=0 and so are not counted. If the lead restates it anyway, the
replacement set is exact: breach objective *"Get ten people inside the wire before the ring
closes"*; its `say` *"Ten in. Get the gate shut behind them."*; `debrief.victory` *"Forty
were outside the wire at first light. Ten came in."*; WH IV `say_on_fail` *"…Thirty did not
come in at First Light…"*; `storyline.md` §1 *"forty civilians in four groups … Ten get in.
Thirty do not"*, §2.1(3) *"He got ten people through the wire and thirty did not come in"*,
§2.3 *"40 civilians in 4 groups … a primary that counts 10 in"*; and `world.json`
`taken: 19` re-derived (its derivation is UNREAD).

**GDD §11** (`docs/GDD.md:426-429`). The line *"a kidnapped civilian killed, a soldier
abducted"* lists an execution, which O-D and both D18 texts forbid, and uses two words
§9.1 keeps out of the fiction. Replacement for the paragraph:

*Under A:*
> **The level carries story twists.** Missions may turn the plot inside the level — people
> led away under fire and caught before the edge of the map, a soldier taken from his post —
> where the declarative vocabulary can express it, and the vocabulary is extended where it
> cannot; no mission is ever scripted in code. The enemy may be seen endangering civilians
> only in the ways `docs/campaign/storyline.md` D18 lists; nothing done to anyone taken is
> ever shown, and the story voice names a number, never a method.

*Under B:*
> **The level carries story twists.** Missions may turn the plot inside the level — a crowd
> that must be reached before a deadline, a soldier taken from his post — where the
> declarative vocabulary can express it, and the vocabulary is extended where it cannot; no
> mission is ever scripted in code. No enemy on the map aims at a civilian or is seen taking
> one; those not reached in time are taken, said and never shown
> (`docs/campaign/storyline.md` D18).

Version line: **1.2.5**, appending *"; §11's twist clause reconciled with D18 (2026-11-18)"*.
Optional, same pass: §11's *"an arch-terrorist"* → *"an adversary"*, for the same reason the
player text avoids the word (§9.1).

### 9.6 Notes on §§1–8 (conflicts recorded, the designer's sections not edited)

| # | where | note |
|---|---|---|
| N1 | §1.2 payoff bullet, §6 `north_block` and *Ledger* | **`hostages: true` on an in-mission rescue corrupts the board.** `hostagesAccount` subtracts every `civ.hostages_recovered` value from `world.json` `taken: 19` (`packages/app/src/campaign.ts:604-616`, `:664-671`), so the north block's 8–12, who were never among First Light's taken, would print *"Eleven still out"* after Beit Sahwan I and *"Nobody still out."* before Qasr Liwan III hands four back. Use G-6's `group` without `hostages: true`; produce no new ledger key |
| N2 | §6 *the taking* | **Trigger order.** `north_block_breaks` (`group_in_zone(rescuers, north_track)`) can fire before the 120 s take; triggers are one-shot, so the take then re-orders the freed people to the exit. And `CivilianFlight` re-orders a fled civilian every tick (`civilians.ts:154-193`): whether that or a `withdraw_to` wins is UNREAD. `level-scripter` must gate the release on the take having fired |
| N3 | §6 crowd markers | `crowd_1..8` are said to be in *"the town's west half"*, but (36,23), (38,25), (34,35), (37,36) are east of the `town` zone's centre (x 19–40). The pilot lines say *most of the town*, never *the west side* |
| N4 | §7 Q1, Option B text | *"The enemy never aims at civilians"* contradicts told canon: LANTERN's week of rockets on the north (`tel_marum_1_recon` `dispatch`), FERRY's corridor (`wadi_halam_1_fords` `dispatch`). §9.5's B text scopes it to the map |
| N5 | §7 Q11 | disagree with *"re-state it"*; §9.5 |
| N6 | §5 *HUD saved / taken tally*, §1.1 | **Feed flood.** `evacuated` and `removed` write one line per civilian, deliberately not coalesced (`ui/mission-notice.ts:47-80`). At 55–100 arrivals the 4-line, 9 s feed becomes a column of `clear (1)` that buries every trigger label. A coalesced `clear (n)` per second for crowds is a `render-vfx` item before the pilot ships (an `engine` row in §9.2) |
| N7 | §1.1 *muster* | the design word collides with `tel_marum_1_recon`'s player-facing refuge, *"the muster ground"*. Templates here use *holding place*; recommend §1.1 says *apron* or *holding point* |
| N8 | §1.2 T1-A, G-16 | extend G-16's adult-figures rule to people **led away** (T2-A) and **carried off** (T3-A), not only those under aimed fire; §9.5's D18 (A) does |
| N9 | §1.2 T3, G-9 | T3's cost line (*"every one of them is billed"*) is true only if G-9 rules that a rider killed with the carrier is charged to its shooter; until then the T3 templates are `engine` |
| N10 | §1.2 T1-A, D18 (A) *"lies still until a medic reaches him or the mission ends"* | `civilians.json` `bleed_s: 60`: what bleeding does to a downed civilian is UNREAD here. The D18 text in §9.5 promises only the `down` pose, not survival, and no line ever states the outcome of a fall |
| N11 | §3.2 row 22 | *"porters marched off to carry for the battery"* gives the taken a purpose (§9.1 rule 4) |
| N12 | §3.2 rows 23, 25 | two shipped `say` lines already contradict their own counts (§9.4 PRE); fix them in the drama pass whichever way Q1 goes |

---

## 10. Level script and engine hand-off (level-scripter)

**Date:** 2026-11-18 · **Status:** proposal for `mission-author` (data) and the RL worker (engine), **HOLD FOR LEAD** with §7 Q1 (A or B). Nothing here is written into `data/`. **Written against** `93448908f` (the worktree HEAD, `git log` read). Sections 1 to 9 are not edited; where this section disagrees with them it says so as a note in §10.5 (N13 onward).

**Status vocabulary** (the Bir Tarsha script's, `docs/campaign/bir_tarsha/level-script.md` §0.1; the README gives it only per channel): `live` = every field named exists in `mission.schema.json` and the runtime acts on it today · `schema` = the runtime would act and the schema refuses · `engine` = neither; the row names the piece (`E1` to `E15`, §10.2).

**What I ran** (the claims in §10.1 rest on these; the failure of each check was constructed and watched):
- `jsonschema` (Draft 2020-12) over two scratch missions assembled from the shipped `beit_sahwan_1_recon.json` plus the §10.1.10 fragments, kept **outside** `data/`: 0 errors with the engine fields stripped; with `fires_on_civilians` and `evacuate_before.group` put back the schema refuses exactly those two keys (`additionalProperties`).
- The repository's own pure validators, imported from `tools/validate_narrative.mjs` (`removeTriggerFailures`, `triggerLabelFailures`, `narrativeTextFailures`) and `tools/validate_time_limit.mjs` (`timeLimitFailures`): 0 failures on both missions; 3 failures on a copy with a 49-character label and `time_limit_s` 350.
- A grid checker on the variant map (§10.1.2): spawn clearance of every body of every civilian group and of the new enemy placements (the `assertGroundClear` rule, `mission.ts:3900-3902`), walk lengths (8-way BFS, no corner cutting), unit-id resolution, marker, zone and group resolution, refuge-in-zone, deadline clearance, force-to-gate distance. 0 errors; **red on all six constructed faults** (a group on the civic hall, a full stop in a label, an unknown marker, an undeclared group, a broken 60 s clearance, a squad at the gate).
- **Not run:** `pnpm validate:data`, `walk_placements.ts`, `walk_mission.ts`, `pnpm playtest`. The map `beit_sahwan_1` and the mission edit do not exist in `data/`. `mission-author` runs them (§10.1.10).

### 10.0 What I read, and what it settled

| # | claim | source read | result |
|---|---|---|---|
| V1 | order inside a tick | `MissionRuntime.step`: `stepRoe`, `stepWorks`, **`stepCivilians`** (`mission.ts:3022-3024`), `stepPatrols`, **`stepTriggers`** (3026), `stepWaves` (3027), then `stepObjectives`. Sim side: `Sim.tick` runs `applyCommands` first (`sim.ts:4657`), `stepDetection` (4659), `stepMovement` (4691); `queueCommand` appends to an array (`sim.ts:4456-4467`) and `applyCommands` walks it in order (6277-6281) | a trigger's order is queued **after** the civilian rule's in the same tick and wins it |
| V2 | civilian groups are addressable | `spawnPlacement` registers `group` for every side (`mission.ts:3904-3919`); `validate_data.mjs:917-926` walks **every** object with a `unit` key into `declaredGroups`, and `:1076-1089` checks `commit`/`withdraw_to` groups against it | a trigger can order `civilians.groups` placements, and `validate:data` accepts it |
| V3 | a `withdraw_to` is a plain, non-`exact` `move` | `mission.ts:4552-4568` (`queueCommand({kind:'move', ids, x, y})`, filter `alive && tunnelIn<0` only); `assignFormation` seats **every** member incl. side 2 (`sim.ts:5555-5593`): infantry one per tile, ranks 7 wide (`formation.ts:19-26`), reachable-from-click tiles only | 88 people ordered to one marker form a block about 7 wide and 13 deep behind it; the sealed yard is unreachable while the gate is shut, so no slot lands inside |
| V4 | one flow field **per goal tile** | `fieldFor(ufx,ufy,ufd)` per unit slot (`sim.ts:5719-5724`); the pool cap `MAX_FLOW_FIELDS` 128 is a floor (CLAUDE.md "Known scaling debts") | the t=2 order creates up to **88** distinct fields (one per slot); the shepherd rule's `exact` orders share **one** (goal = the refuge tile) |
| V5 | a civilian pressed against a shut gate keeps `moving = 1` | `stepMovement`: final-leg beeline and the three-branch wall slide, `moving` unchanged (`sim.ts:13039-13089`); `moving` is cleared at arrival (`finishLeg`, 13523-13552) and by a few rout and pin paths (13815-13826); `civilians.ts:166-167` skips a moving fled civilian | **G-2's "100 `move`s a tick at a shut gate" does not happen.** Re-order spam needs a fled civilian whose order ended **outside** the zone (`civilians.ts:168-193`) |
| V6 | `collect` runs only for an **active** `evacuate_before` | `stepObjectivePass` skips non-active objectives (`mission.ts:4702-4704`); `collect` at 4838-4842; `civilians.ts:258-281` | after the last evacuation objective resolves, arrivals are not cleared and stand in the yard (harmless, but E3 should keep collecting) |
| V7 | the shepherd rule does not look at `moving` for a non-fled civilian | `civilians.ts:199-241`: buried skip, then `leaving` by suppression above `CIV_FLEE_AT` (19661) or a ground player unit within `SHEPHERD_RADIUS_SQ` (1048576 = 4 tiles in Q8.8, `:33`, 208-213) | a soldier within 4 tiles re-orders a civilian that a trigger is walking, the same tick |
| V8 | ROE | `stepRoe` (`mission.ts:3991-4196`): a civilian's death charges `civilian_casualty_penalty` (8) only when `by` is side 0 (4050-4056); **every heavy shot** (collateral >= 0.5, `HEAVY_COLLATERAL` `:796`) with a civilian within 2 tiles of the aimpoint charges 3, no cooldown (4158-4193, `DANGER_CLOSE_SQ` `:794`); a rescue credits +3 (`CONDUCT_GAIN_CIVILIAN`, cap 10, `tuning.ts:593-595`) | enemy-caused deaths cost nothing; the second star is Conduct >= 70 where no `fail_below` (`grade.ts:18-29`) |
| V9 | who can be shot | `engageable` refuses `side[t] > 1` first (`sim.ts:8022-8026`); `selectTarget` scans ascending ids (8064-8125); civilians **are** detection targets (`sim.ts:7538-7549`) and observe nothing (7531); contact is per side (`contact[sSide*capacity+t] >= IDENTIFIED_AT`, 8033); `isEnemyFire` ignores a side-2 target (`mission.ts:4493-4505`) | a shot aimed at a civilian would not set `first_contact` |
| V10 | `picture` | a `locate` with no `target` completes at `identified.size >= count` (`mission.ts:4796-4800`), **any** enemy | extra enemy bodies make `picture` cheaper (N26) |
| V11 | capacity | start-time placements are strict (`Sim.spawn` throws at capacity, `sim.ts:4308-4309`; capacity 256 at `main.ts:2392` and `playtest-run.ts:348`); runtime `spawn`, `reinforce` and wave placements are **skipped whole** when `capacity - entityCount < bodies` (`mission.ts:3825-3835`); `fallMan` kills outright at capacity (`sim.ts:9693-9695`) | overflow degrades silently; it does not throw mid-mission (N21) |
| V12 | `structures[]` raises per-tile types one body per tile over `size` (default 2x2) and refuses an overlap with an existing building | `mission.ts:3769-3823` | **G-19 is resolved: yes.** A mission can raise a `hesco`, `t_wall` or `fence` run, or a non-per-tile `compound_gate` with `size [1,2]` |
| V13 | unit facts | `data/units/*.json`: `civilians` 0.8 t/s, hp 200, `wounds.in_place`, sight 4; `militia_cell` sight **7**, rifles range 7, 0.95 t/s; `mortar_crew` mortar_82 range 16, min 4, splash 2, sight 6; `paramotor` sight **14**; `technical` 2.6 t/s; `apc_eitan` 1.8 t/s, 2 seats; `inf_squad` 0.9 t/s, sight 8, rifles 8; `mbt_lavi` 1.1 t/s | the numbers in §10.1.2 |
| V14 | clocks | `validate_time_limit.mjs:20-45`: floor 120 s per `target_minutes`, 60 s clearance over every primary deadline; CLAUDE.md: `pnpm playtest` holds 120 s and 20% over the slowest 30-seed win | `time_limit_s` 840 stands (§10.1.7) |
| V15 | postures | `data/difficulty/postures.json`: Easier = time x5/4, waves x3/4 and +30 s, a 90 s relief of one `inf_squad` and one `inf_medic_squad`, `uncarry`; Harder = waves x5/4 and -15 s | the pilot has **no waves**, so Harder is a no-op on it (N23) |
| V16 | passive machinery | `passive-sweep.ts` (30 seeds, `SWEEP_SEEDS`); `playtest.ts:157` pins this mission's control to `'withdrawn'` today; `playtest.ts:138-153` is the event-callback pattern | E11 |
| V17 | feed | `evacuatedNotice` and `removedNotice` give one line per entity (`ui/mission-notice.ts:47-86`); the catalogue key already takes `{n}`; the loop is `main.ts:6431-6444` | E4 is app-side and small |
| V18 | gate substrate | `addStructure` (`sim.ts:3140-3213`), `removeStructure` (3242-3271), `destroyStructure` (12404-12447; leaves rubble, `recomputeFields('opened')`), `recomputeFields` repairs only fields a living unit follows (3006-3052; `FlowField.repair`, `flowfield.ts:399`), the structure hash fold (14055-14058), snapshot rows (`snapshot-schema.ts:212-222`), the read-only view (`sim.ts:2851-2866`), type compile (`structures.ts:395-425`), `MAX_STRUCTURES` 256 (`sim.ts:1640`) | E1 |

### 10.1 The pilot level script: `beit_sahwan_1_recon`

Phase `recon`, Captain, Ashwar Front, `target_minutes` 7, `time_limit_s` 840, `start_layout: assembly`, `start_front: E`, `player_start` (4,23). Map: the new variant **`beit_sahwan_1`**. Ledger unchanged (no new key; N1). Both variants share §10.1.2, §10.1.3 and §10.1.7; A and B differ in the threat, the north block and four narrative rows.

#### 10.1.1 N2 resolved

| question | answer | read |
|---|---|---|
| In one tick, who wins: `CivilianFlight` or a `withdraw_to`? | the trigger. `stepCivilians` runs before `stepTriggers` (V1) and both only append commands | `mission.ts:3024,3026`; `sim.ts:4464-4465`, 6277-6281 |
| Does a `withdraw_to` stand against the flight rule over time? | **Not for a fled civilian.** `fledSet` is written only by the flight rule (`civilians.ts:217`); `stepTriggers` does not read it. The trigger's walk stands while the civilian is `moving`; when he stops outside the zone he is re-ordered to the refuge (`civilians.ts:166-193`) | |
| And for a non-fled civilian? | the crowd at t=2 is non-fled and nobody of ours is within 4 tiles, so the order stands and they stand at the apron (not fled, not leaving: `civilians.ts:199-216`). A ground soldier within 4 tiles later **overrides the trigger's walk in the same tick** (V7) | |
| Does the 120 s take undo an earlier release? | **Yes, and unreadably.** A captive freed before 120 s is `fled` (walking to the refuge, or standing at a shut gate with `moving 1`). The take order `withdraw_to taken_north -> taken_exit` ignores the latch (`mission.ts:4558-4560` filters only `alive` and `tunnelIn`), turns him round, and a fled civilian in transit is not re-shepherded until he **stops** (`civilians.ts:166-167`). He walks to the exit and is taken | |
| Is `north_block_breaks` needed to release? | **No.** The shepherd rule frees every captive within 4 tiles of a ground soldier, and the pen is 6 tiles wide, so one unit at the road end frees all 12 (V7). The trigger adds a label, a line, and an order to the apron | |
| Fix | **E5**: `zone` on `commit`/`withdraw_to` (the filter `remove` already has, `mission.ts:4616-4621`). With `zone: taken_pen` the take orders only captives still standing in the pen; anyone already freed has left it. **Today** the schema accepts `do.zone` on `withdraw_to` and the runtime ignores it (a footgun: N24). Without E5 the A pilot ships with the early-rescue hazard documented and probed (P4, §10.4) | |
| `remove` | use `remove` **with `zone`** everywhere: taken only inside the exit zone. The shipped pattern has none, and a no-zone `remove` takes freed captives too | `mission.ts:4607-4643` |

#### 10.1.2 The map `beit_sahwan_1` and the placements

Copy `data/maps/beit_sahwan_outskirts.json` (48 x 48, no elevation; **do not edit the original**: `packages/app/src/net/versus-specials.ts:64` and eight tests read it) and change:

| change | tiles | note |
|---|---|---|
| compound wall `=` | row y=15, x 0 to 13; row y=30, x 0 to 13; column x=13, y 15 to 30 | the west edge closes it. Interior x 0 to 12, y 16 to 29. **It encloses `kdf_assembly` (4,23), every `starting_force` `at`, the `bs_tn_west` vent (7,22) and `wounded_evac` (1,22)**: the player's force starts **inside** the yard (N20) |
| gate `G` | (13,21) and (13,22): a vertical 1x2 run, one structure (`per_tile: false`) | the designer's `compound_gate`; `G` is unused on every map. E1 |
| grove inside | `o`, `1`, `n` on x 0 to 12, y 16 to 29 become `.` (**x=14 stays `o`**, outside the wall, as cover for the grove fight) | |
| road | `r` on x 14 to 18, rows 21 and 22 | joins the gate to the town road |
| everything else | unchanged | the hall `mmm` (20 to 22, 18 to 20, ROE 30 if razed) now stands **inside the crowd's queue** (x 15 to 27, y 18 to 24); a Lavi round near it is billed only if it destroys the hall |

New markers and zones (rect = `[x,y,w,h]`):

| name | kind | tile | purpose | on the map today? |
|---|---|---|---|---|
| `gate_apron` | marker | (15,21) | where the crowd musters; 2.06 tiles from the gate centre (13.5, 22.0); outside `compound_yard` | new |
| `civ_refuge` | marker | **(6,22)** | the refuge, moved from (22,45); inside `compound_yard` (`mission.ts:2850-2859` refuses otherwise) | moved |
| `taken_exit` | marker | (45,10) | A: where the column is walked to | new |
| `compound_yard` | zone | [1,16,12,14] | the `evacuate_before` target; contains the refuge; **no civilian starts in it** (checked) | new |
| `north_track` | zone | [29,12,10,8] (x 29 to 38, y 12 to 19) | A: a `rescuers` unit here fires the release. The designer's [30,7,12,8] is entered only at y 14, after the shepherd rule has fired; this one covers the road approach | new |
| `taken_east` | zone | [44,6,4,10] | A: the exit; contains `taken_exit` | new |
| `taken_pen` | zone | [26,13,9,4] | A: the E5 filter zone; B: the `remove` zone (the pen is x 27 to 33, y 14 to 15) | new |

Distances (script, tiles, 8-way, no corner cutting):

| pair | tiles | seconds |
|---|---|---|
| gate centre to the nearest ground `starting_force` `at` (inf_squad (5,20)) | 8.1 | authored positions; **re-measure after the assembly layout** (front E puts the first rank toward the gate). If the nearest ground unit is under 5.0 tiles, move `player_start` to (3,23) |
| gate_apron to the pen (28,14) | 15.9 | Eitan 8.8 s, infantry 18 s; from inside the yard (26 tiles) 14.5 s and 29 s |
| pen (28,14) to `taken_exit` | 18.7 | column 23 s (0.8 t/s), takers 20 s (0.95) |
| crowd bases to the apron | 6.2, 9.2, 21.8, 26.0, 9.8, 24.8, 27.6, 28.2 | 8 to 35 s at 0.8 t/s |

**The crowd** (under `civilians.groups`, 8 placements sharing `group: "crowd"`; 3 bodies a row at 1.25 spacing, so 2.5 x 3.75 tiles each; every body checked clear and no two groups share a tile):

| # | base | walk to the apron (tiles) | arrives |
|---|---|---|---|
| 1 | (20.5, 24.5) | 6.2 | 8 s |
| 2 | (24.5, 24.5) | 9.2 | 12 s |
| 3 | (36.5, 23.5) | 21.8 | 27 s |
| 4 | (41.5, 21.5) | 26.0 | 33 s |
| 5 | (17.5, 30.5) | 9.8 | 12 s |
| 6 | (34.5, 35.5) | 24.8 | 31 s |
| 7 | (30.5, 40.5) | 27.6 | 34 s |
| 8 | (38.5, 36.5) | 28.2 | 35 s |
| N | (27.5, 14.5) x6 and (30.5, 14.5) x6, `group: "taken_north"` | the pen; not part of the run | |

The designer's candidates (20,30), (29,37) and a shared tile at (37,36) were refused by the checker (a shanty `s` at (23,30), an apartment at (29,37)) and replaced. **Entity count (script):** A 127, B 125 (10 force + 13 shipped enemy + 100 civilians + 4 or 2 new); the designer's 123 omits the new enemy bodies (N27).

**One soldier, how many people.** Ranks are one body a tile and the shepherd radius is 4, so a soldier standing at the head of the apron block frees roughly 35 to 50 people at once (a 4-tile disc against a 7-wide block). The primary of 55 is therefore about one repositioning away for a single parked unit (N17). §10.4 P1 measures it; the levers are in §10.1.8.

#### 10.1.3 Flags

| flag | meaning in the fiction |
|---|---|
| `into_the_compound` | 55 of the 100 are through the gate; fails at 300 s and loses the mission |
| `most_of_them` | 85 through; secondary, no `carries` (no later reader) |
| `north_block` | **E3** 8 of the 12 of the north block through; secondary |
| `picture`, `hvt_seen`, `find_the_column` | shipped; the last two keep the third star |
| `families_run` (trigger fired) | the town has broken for the gate (t=2) |
| `north_block_moves`, `north_block_walked` (A) | the cell has started walking the north block east (t=120) |
| `north_block_breaks` (A) | a `rescuers` unit reached the north track |
| `north_block_taken` (A) / `north_block_moved` (B) | the north block left play as taken |
| gate open (**E1**; no flag in the data) | read off the sim view: a soldier of ours is within four tiles of it |

#### 10.1.4 ECA rows, Variant A (line moved)

| event | IF | THEN | cue bound (§9.2) | status |
|---|---|---|---|---|
| Start | mission start | title, dispatch, briefing; crowd, north block, grove cells, takers in place | `title`, `dispatch`, `brief` | live |
| `families_run` | `timer_s` 2 | `withdraw_to` group `crowd` -> marker `gate_apron` | toast *Families are running for the compound*; radio Idit | live (V2, V3; no shipped mission has done this: world-walk) |
| Grove fires | the `fl_north` cells have a civilian in reach and no KDF target (the `selectTarget` second scan) | fire on the crowd's north rows (y <= 20) | radio Idit (first fire) | **engine E6**; the cue row also **E7** |
| Gate opens / shuts | a living ground side-0 unit within 4 tiles of (13.5, 22.0) / none for 3 s and nobody in it | tiles unblocked / blocked; `gateOpened`, `gateClosed` | audio only | **engine E1, E2** |
| Arrivals | `evacuated` per person | `into_the_compound` and `most_of_them` count; `collect` clears them (`civilians.ts:258-281`) | toast `clear (n)`, one line a second | live; the coalescing is **E4** |
| `north_block_moves` | `timer_s` 120 | `withdraw_to` group `takers` -> `taken_exit` | toast *Movement in the north block*; radio Idit | live |
| `north_block_walked` | `timer_s` 120 | `withdraw_to` group `taken_north` -> `taken_exit`, `zone taken_pen` | toast *North block families walked east* | **engine E5** (without the zone: live, with the early-rescue hazard of §10.1.1) |
| Shepherd release | a `rescuers` ground unit within 4 tiles of a captive | `CivilianFlight` orders him to the refuge (V7) | none | live (existing rule) |
| `north_block_breaks` | `group_in_zone` `rescuers` in `north_track` | `withdraw_to` `taken_north` -> `gate_apron` | toast *The north block families break west*; radio Shai | live |
| `north_block_taken` | `group_in_zone` `taken_north` in `taken_east` | `remove` `taken_north`, `zone taken_east` | radio Idit; chrome `taken (1)` per person | live |
| `north_block_takers_leave` | `group_in_zone` `takers` in `taken_east` | `remove` `takers`, `zone taken_east` | silent | live |
| `north_block_stragglers` | `timer_s` 165 | `remove` `taken_north`, `zone taken_east` | silent; clears the late ones the first `remove` left standing in the exit | live |
| Hunters | `first_contact` (shipped `hunt_the_scouts`) | `commit` `hunters` -> `kdf_assembly` | shipped label and line | live; the goal is now a **sealed yard**: while the gate is shut the technicals beeline to the wall and press at it (V5), when a soldier opens it they stream in |
| `into_the_compound` done / failed | count 55, or 300 s | `say`; won / lost (a failed primary, `mission.ts:4881-4911`) | radio Shai / Idit | live |
| North block saved | `north_block` count 8 | `say` | radio Idit | **schema E3** |
| End | victory / defeat | `aftermath`, `debrief` | §9.2 | live |

Not done by a trigger: the *release when the escort is stopped* (the shepherd rule frees by proximity, not by beating the cell), and the captives *following* their escort (they are ordered to the same marker and drift apart: takers 0.95 t/s, captives 0.8). **E8** replaces this approximation.

#### 10.1.5 ECA rows, Variant B (line kept): differences only

| event | IF | THEN | cue bound | status |
|---|---|---|---|---|
| Start | as A, with `eye_north` (1 `militia_cell`, ambush 3) and `tube_town` (1 `mortar_crew`) in place; no `fl_north`, no `takers` | | | live |
| `families_run` | `timer_s` 2 | as A | toast same; radio Idit (the tube line) | live |
| The tube fires | `eye_north` identifies a KDF unit within 7 tiles of (17.5, 16.5); contact is side-wide (V9), so `tube_town` (range 16: 15.0 tiles to the apron, 18.0 to x=12) fires at it; rounds splash 2 tiles | people near that unit fall (`down`, `by` side 1: no Conduct) | radio Idit (first fire) | live data; the cue row **E7** |
| North block waits | nothing | a shepherd frees them as in A | | live |
| `north_block_moved` | `timer_s` 242 | `remove` `taken_north`, `zone taken_pen` | radio Idit | live (the shipped `umm_zeitoun_1_recon` pattern, with a zone so freed captives are not taken) |
| North block saved | `north_block` count 8 | `say` | radio Idit | **schema E3** |

**The designer's observer does not work (N13).** §6 B says the tube is "observed by the shipped `bs_observer_aloft`". That paramotor patrols x 38.5 to 43.5 (shipped garrison, `beit_sahwan_1_recon.json:302-318`) with sight 14 (`paramotor.json`): it sees x >= 24.5 at best, 9.5 tiles short of the apron, and no other shipped body sees (15,21) (cells sight 7, the mortar 6). With no spotter the tube never fires and T1-B does nothing. `eye_north` at (17.5, 16.5) (tile `1`, cover 1) is 5.4 tiles from the apron marker and 6.5 from (14,22), inside its sight of 7. In `ambush` it holds fire (the rifles' range of 7 is not used unless a unit closes to 3 tiles) and keeps its signature low.

#### 10.1.6 AI director

**Cadence (A).**

| t (s) | what | group | size | from | to |
|---|---|---|---|---|---|
| 0 | crowd in place | `crowd` | 88 | 8 bases, §10.1.2 | |
| 0 | north block in place | `taken_north` | 12 | (27.5,14.5), (30.5,14.5) | |
| 0 | grove cells | `fl_north` | 2 | (16.5, 13.5) | |
| 0 | takers | `takers` | 2 | (33.5, 12.5) | |
| 2 | flight | `crowd` | 88 | | `gate_apron` |
| 8 to 35 | the crowd arrives, nearest first | | | | |
| 8 on | the grove fires on the block's north rows (6.1 tiles from (15.5, 19.5)) until a KDF unit is inside 7 tiles of the cells | `fl_north` | | | |
| first contact | the technicals commit (shipped) | `hunters` | 2 | (42.5, 14.5), (42.5, 30.5) | `kdf_assembly` |
| 120 | the take | `takers`, `taken_north` | 2 + 12 | the pen | `taken_exit` |
| 143 to 150 | the column reaches `taken_east` and is removed | | | | |
| 165 | stragglers removed | | | | |
| 300 | `into_the_compound` fails, or has completed | | | | |

**Cadence (B).** As A for t=0 to 35 (no `fl_north`, no `takers`); `eye_north` and `tube_town` in place at 0; the tube fires from the first tick a KDF unit is inside the eye's 7 tiles (earliest about t=40, when a soldier reaches the apron); 242: the north block is removed.

**Stances.**

| placement | stance | why |
|---|---|---|
| civilians (all 10 placements) | none | the run is a trigger order |
| `fl_north` (A) | `hold_position` | fires from where it stands; **needs `fires_on_civilians`** (E6) to fire on the crowd, and without E6 it fires only at KDF inside 7 tiles |
| `takers` (A) | `hold_position` until the 120 s order, then a plain move | |
| `eye_north` (B) | `ambush`, tiles 3 | a hidden spotter |
| `tube_town` (B) | `hold_position` | indirect fire on what the eye identifies |
| shipped garrison, `hunters`, `bs_observer_aloft` | unchanged | the paramotor is not asked to spot the apron |

**Pressure curve.** No waves. The first 35 s are the crowd arriving and the player deciding who goes where: the force starts inside the yard, 8 tiles from the gate, and a unit within 4 tiles of the gate opens it. From about t=40 the primary is a shepherding job against a 300 s clock with a stated cost. Under A the grove shoots the crowd's north rows until something of ours draws its eye, and the north block walks at 120 s with a 20 to 25 s window (an Eitan must be east of the gate and moving by about t=105 to 110 to catch it, infantry on the road by about t=90). Under B the tube fires on any soldier the eye sees at the apron, so the crowd pays for the shepherd. The technicals arrive at first contact and test whether the gate is held. After 300 s the mission is a recon problem (`picture`, the ATGM pair, the track) on the 840 s limit.

#### 10.1.7 Objectives, ROE, clocks, stars

| id | type | P/S | numbers | note |
|---|---|---|---|---|
| `picture` | locate | P | count 6 | shipped; counts **any** identified enemy (V10, N26) |
| `into_the_compound` | evacuate_before -> `compound_yard` | **P** | count **55**, seconds **300** | 55% of 100; failable; `say` and `say_on_fail` as §9.2 |
| `most_of_them` | evacuate_before | S | count 85, seconds 300, `clock: false` | `clock: false` keeps a second countdown off the HUD; 85 is reachable only with most of the north block saved (N18) |
| `north_block` | evacuate_before, **`group: taken_north`** | S | count 8, seconds 300, `clock: false` | **E3**; not `hostages` (N1); the main two count all 100 |
| `hvt_seen`, `find_the_column` | locate | S, `carries` | | shipped |

- **Time.** `target_minutes` 7, `time_limit_s` **840** (twice the target, 120 s per target minute; 300 + 60 = 360 <= 840). `pnpm playtest` holds 120 s and 20% over the slowest win, so the plan must win in **700 s** or less (840 - 120 = 720; 840 / 1.2 = 700). Running out with a primary open is the shipped `withdrawn` defeat.
- **ROE.** Keep `roe: { "enabled": true }`, no `fail_below`, no `flagged_zones`. Defaults apply: `civilian_casualty_penalty` 8 (player-caused deaths only); `disproportionate_ordnance_penalty` 3 **per heavy shot** within 2 tiles of any civilian (`gun_120` 0.55 and `mortar_60` 0.7 are heavy; `cannon_30` 0.35, `rws_50` 0.25 and `rifles` 0.1 are not); +3 per wounded civilian admitted or evacuated (cap +10). **Conduct 70 is 30 points: ten heavy shots near the crowd, or four deaths** (N29). An optional lever if the lead wants restraint to bite harder: `fail_below` 30 (the star floor then becomes 50).
- **Stars** (`grade.ts:18-41`): 1 victory; 2 Conduct >= 70; 3 also `hvt_seen` and `find_the_column`. Saved and taken show on the report only (Q6).
- **Passive player.** Cannot win. The crowd stands at the apron (not fled, `civilians.ts:199-216`) and nobody within 4 tiles moves it; the gate is shut; a crowd member suppressed above 0.3 flees to the refuge, reaches the wall and presses it with `moving 1` (V5); the yard is sealed. The control ends **`defeat`** on `into_the_compound` at 300 s, not `withdrawn` (pin change in E11).

#### 10.1.8 Levers (data, for `playtest`'s first reading), and twists

| id | lever | class |
|---|---|---|
| L1 | the primary is too cheap (P1 clears 55 early): raise `count` to 65 and the secondary to 90, or split the run into two aprons `gate_apron` and `gate_apron_s` (16,24) with two `withdraw_to` triggers so one soldier reaches half a block | expressible today |
| L2 | the take is unreachable: move `taken_exit` to (46,38) (31.5 tiles from the pen, 39 s; tile checked open) or raise the A timer to 150 | expressible today |
| L3 | the wall is breached (P5): a `structures[]` run of `hesco` (600 hp per tile) on x=13, y 16 to 20 and 23 to 29 (V12), or accept the breach as a legitimate answer | expressible today |
| T-a | **the gate is held open by a man who fell in it**: a downed man in the gate holds it open (E1, by design) until a medic lifts him. Nothing to author | engine E1 |
| T-b | **the technicals follow the crowd in**: while a soldier holds the gate open the `hunters` stream into the yard. Free, in the data | expressible today |
| T-c | **the north block moved sooner in B**: `timer_s` 242 -> 180 | expressible today |

#### 10.1.9 What can be built before the engine (data first)

| slice | contents | needs | shows |
|---|---|---|---|
| S0 | the variant map with the **gate tiles left open as a 2-wide gap** (no `G`); the crowd, the muster, B's `eye_north` and `tube_town`, B's 242 s `remove`; the two evacuation objectives; no `north_block` | nothing | the run, the muster, the shepherd, the throughput (G-17), the field count at t=2 (E9), the passive control with the gap (the muster rule alone must keep it losing; suppression is the leak the gate closes), the feed flood (N6), the entity count, `picture` speed |
| S1 | S0 + E3 + E4 + E10 + E11 + E13 | S effort each | the full B pilot minus the gate; the `north_block` secondary |
| S2 | S1 + E1 (+ E2 art) | M | the gate |
| S3-A | A without E5, E6, E8: `fl_north` as plain cells, the timer take with the hazard | nothing | the A geometry; the P4 early-rescue probe (red on purpose) |
| S4-A | + E5, E6, E14, then E8 | | Variant A complete |

#### 10.1.10 Copy-ready fragments

Field names are the schema's (checked: preamble). Engine-only fields are marked `/* E# */` and are **not valid JSON**: strip the comment and the field until the piece lands. `mission-author` assembles, then runs `pnpm validate:data`, `walk_placements.ts`, `walk_mission.ts` and the map-visibility test. This file is not data.

`map.file` becomes `"beit_sahwan_1"`. `starting_force`: add `"group": "rescuers"` to every placement **except** `recon_drone` (A needs it for `north_block_breaks`; B does not). Whether `group` is honoured on a `from_ledger` placement is **UNREAD** (`spawnPlacement`'s ledger branch): `walk_mission.ts` must show `rescuers` non-empty.

Map patch (`beit_sahwan_1.json`, merged into the copied `markers` and `zones`):

```json
{
  "markers": { "gate_apron": [15, 21], "civ_refuge": [6, 22], "taken_exit": [45, 10] },
  "zones": {
    "compound_yard": [1, 16, 12, 14],
    "north_track": [29, 12, 10, 8],
    "taken_east": [44, 6, 4, 10],
    "taken_pen": [26, 13, 9, 4]
  }
}
```

`civilians` (A and B):

```json
{
  "refuge": "civ_refuge",
  "groups": [
    { "unit": "civilians", "count": 11, "at": [20.5, 24.5], "group": "crowd" },
    { "unit": "civilians", "count": 11, "at": [24.5, 24.5], "group": "crowd" },
    { "unit": "civilians", "count": 11, "at": [36.5, 23.5], "group": "crowd" },
    { "unit": "civilians", "count": 11, "at": [41.5, 21.5], "group": "crowd" },
    { "unit": "civilians", "count": 11, "at": [17.5, 30.5], "group": "crowd" },
    { "unit": "civilians", "count": 11, "at": [34.5, 35.5], "group": "crowd" },
    { "unit": "civilians", "count": 11, "at": [30.5, 40.5], "group": "crowd" },
    { "unit": "civilians", "count": 11, "at": [38.5, 36.5], "group": "crowd" },
    { "unit": "civilians", "count": 6, "at": [27.5, 14.5], "group": "taken_north" },
    { "unit": "civilians", "count": 6, "at": [30.5, 14.5], "group": "taken_north" }
  ]
}
```

`objectives` (insert after `picture`; texts and lines are the narrative sheet's §9.2, unchanged; the third row is **schema E3**, and its `say` is Variant A's; Variant B's is *"Eight from the north block are inside the wall. They waited for us, and this time somebody came."*):

```json
[
  { "id": "into_the_compound", "type": "evacuate_before", "primary": true, "target": "compound_yard", "count": 55, "seconds": 300,
    "text": "Get fifty-five people through the gate inside five minutes",
    "say": { "speaker": "shai", "text": "Fifty-five inside. Keep somebody at that gate until the road in front of it is empty." },
    "say_on_fail": { "speaker": "idit", "text": "Five minutes, and fewer than fifty-five came through that gate. Everybody else is on the wrong side of it." } },
  { "id": "most_of_them", "type": "evacuate_before", "primary": false, "target": "compound_yard", "count": 85, "seconds": 300, "clock": false,
    "text": "Get eighty-five people through the gate inside five minutes",
    "say": { "speaker": "idit", "text": "Eighty-five through the gate. That is the first count in this war I wanted to write down." } },
  { "id": "north_block", "type": "evacuate_before", "primary": false, "target": "compound_yard", "count": 8, "seconds": 300, "clock": false,
    "group": "taken_north" /* E3 */,
    "text": "Bring eight of the north block's twelve through the gate",
    "say": { "speaker": "idit", "text": "Eight from the north block are inside the wall. That track ends at our gate today, not at the east edge." } }
]
```

`enemy.garrison`, **Variant A** additions (append to the shipped list):

```json
[
  { "unit": "militia_cell", "count": 2, "at": [16.5, 13.5], "facing_deg": 180, "group": "fl_north",
    "stance": { "kind": "hold_position" } /* + "fires_on_civilians": true  E6 */ },
  { "unit": "militia_cell", "count": 2, "at": [33.5, 12.5], "facing_deg": 180, "group": "takers",
    "stance": { "kind": "hold_position" } }
]
```

`enemy.garrison`, **Variant B** additions:

```json
[
  { "unit": "militia_cell", "count": 1, "at": [17.5, 16.5], "facing_deg": 180, "group": "eye_north",
    "stance": { "kind": "ambush", "tiles": 3 } },
  { "unit": "mortar_crew", "count": 1, "at": [30.5, 21.5], "facing_deg": 180, "group": "tube_town",
    "stance": { "kind": "hold_position" } }
]
```

No tag on any new placement: a tag would join `intel.marked_positions` and pre-reveal a same-tagged placement in a later mission. `waves`: none. `structures`: none (the gate and the walls are map symbols); the alternative for the gate is `{ "type": "compound_gate", "at": [13, 21], "size": [1, 2] }` with the two tiles left `.` in the grid.

`triggers`, **Variant A** (append after the shipped `hunt_the_scouts`):

```json
[
  { "id": "families_run", "label": "Families are running for the compound",
    "on": { "kind": "timer_s", "value": 2 },
    "do": { "kind": "withdraw_to", "group": "crowd", "to": "gate_apron" },
    "say": { "speaker": "idit", "text": "Most of the town is running for our gate, and their road passes under the grove. The rifles in it have not fired yet." } },
  { "id": "north_block_moves", "label": "Movement in the north block",
    "on": { "kind": "timer_s", "value": 120 },
    "do": { "kind": "withdraw_to", "group": "takers", "to": "taken_exit" },
    "say": { "speaker": "idit", "text": "The north block cell is walking twelve people east along the track, toward the edge. They are not hurrying." } },
  { "id": "north_block_walked", "label": "North block families walked east",
    "on": { "kind": "timer_s", "value": 120 },
    "do": { "kind": "withdraw_to", "group": "taken_north", "to": "taken_exit" /* + "zone": "taken_pen"  E5 */ } },
  { "id": "north_block_breaks", "label": "The north block families break west",
    "on": { "kind": "group_in_zone", "group": "rescuers", "zone": "north_track" },
    "do": { "kind": "withdraw_to", "group": "taken_north", "to": "gate_apron" },
    "say": { "speaker": "shai", "text": "They are loose and running for the gate. The Lavi's gun stays off that escort while they are this close to it." } },
  { "id": "north_block_taken",
    "on": { "kind": "group_in_zone", "group": "taken_north", "zone": "taken_east" },
    "do": { "kind": "remove", "group": "taken_north", "zone": "taken_east" },
    "say": { "speaker": "idit", "text": "The track is empty to the east edge. Whoever was walking on it is across the line now." } },
  { "id": "north_block_takers_leave",
    "on": { "kind": "group_in_zone", "group": "takers", "zone": "taken_east" },
    "do": { "kind": "remove", "group": "takers", "zone": "taken_east" } },
  { "id": "north_block_stragglers",
    "on": { "kind": "timer_s", "value": 165 },
    "do": { "kind": "remove", "group": "taken_north", "zone": "taken_east" } }
]
```

`triggers`, **Variant B**:

```json
[
  { "id": "families_run", "label": "Families are running for the compound",
    "on": { "kind": "timer_s", "value": 2 },
    "do": { "kind": "withdraw_to", "group": "crowd", "to": "gate_apron" },
    "say": { "speaker": "idit", "text": "Most of the town is running for our gate. The tube in the town centre can reach the ground in front of it." } },
  { "id": "north_block_moved",
    "on": { "kind": "timer_s", "value": 242 },
    "do": { "kind": "remove", "group": "taken_north", "zone": "taken_pen" },
    "say": { "speaker": "idit", "text": "The north block is empty. Nobody fought over it; whoever we had not reached was moved while we were at the gate." } }
]
```

Rows the sheet binds to `engine` events (the grove's first fire, the tube's first fire, the gate audio) have **no trigger here**: they need E7 and E1.

### 10.2 The engine hand-off for the RL worker

**For whoever implements this.** Every rule below is a repository rule restated for these pieces. Q16.16 and integer maths only; no `Math.*`, no `Date.*`, no float in `@lions/sim`; all randomness from `rng(entityId)` (none of these pieces needs a draw); a new hashed column folds into `hash()` **only behind a live flag** and with a marker word, so every existing golden hash and replay is byte-identical. Run `pnpm test:determinism` before and after and say what moved (nothing may). Every test below comes with the one-line mutation that must turn it red: write the mutation, run the test, watch it go red, put the line back, and put the mutation in the commit message. Sizes: S under a day, M a few days, L more. Variant: **both**, **A** or **B**.

| E | piece | size | variant | needs | owner |
|---|---|---|---|---|---|
| E10 | authored-entity budget in `validate:data` (<= 160) | S | both | none | `content-validator` |
| E13 | muster and sealed-compound validators | S | both | none | `content-validator` |
| E3 | `evacuate_before.group` (group-scoped count) | S | both | none | `sim-guard` |
| E4 | coalesced `clear (n)` and `taken (n)` feed line | S | both | none | `render-vfx` (app) |
| E11 | passive-probe harness change and the crowd controls | S/M | both | S0 data | `playtest` |
| E1 | compound gate (structure `gate`, sim) | M | both | none | `sim-guard` |
| E2 | gate presentation: mesh, swing, audio, palette key | M + art | both | E1, Q8, Q10 | `render-vfx`, `blender-art` |
| E9 | crowd pathing and performance at 100 (measure first) | S, M if a fix is needed | both | S0 (gate part: E1) | `playtest`, `sim-guard` |
| E14 | crowd variety and adult-only figures (G-13, G-16) | S | both (variety) / A (adults) | art | `render-vfx` |
| E5 | `zone` filter on `commit` and `withdraw_to` | S | A | none | `sim-guard` |
| E6 | civilians as targets, per placement (`fires_on_civilians`) | M | A | none | `sim-guard` |
| E7 | trigger `on.kind: group_fired` | S | both (cue lines only) | none | `sim-guard` |
| E8 | `do.kind: abduct` | M | A | E5 | `sim-guard` |
| E12 | a rescued wounded civilian counts as saved (G-7) | S | both, optional | none | `sim-guard` |
| E15 | the capacity decision | S now, M later | both | E10 | lead, `sim-guard` |

Order of work: **E10, E13, E3, E4, E11** (no sim behaviour change; start now) -> **E1** -> **E2**, **E9** -> **E5** -> **E6**, **E14** -> **E8**; E7 and E12 any time after E3. **B needs no engine beyond E1 to E4, E9 to E11 and E13.** **A adds E5, E6, E8 and E14** (E7 for its cue line, shared with B's).

---

**E1: compound gate (sim)** · M · both · `sim-guard`
- **Does:** a structure type with a `gate` block opens when a living, surface, ground, standing side-0 unit is within `open_radius_tiles`, and shuts `hold_open_s` after the last one left, never on anything standing in it.
- **Files and functions:** `data/schemas/structure.schema.json` (new optional `gate` block; the type schema is closed, the designer cites line 26); `data/structures.json` (`compound_gate`, the §2.2 row); `packages/sim/src/structures.ts` `StructureType` and `structureTypeFromJson` (`:395-425`: add `gate: { radiusSq, holdTicks, swingTicks } | null`); `packages/sim/src/sim.ts`: columns beside `stAlive` (`:2216`, allocation `:2717-2719`), `addStructure` (`:3140-3213`: state CLOSED, set `gateLive`), a new `stepGates()` called **directly after `this.applyCommands()`** in `tick()` (`:4657`, before `stepDigging`, `stepDetection` `:4659` and `stepMovement` `:4691`), the flips through `beginFlips` / `noteFlip` / `recomputeFields('opened' | 'closed')` exactly as `removeStructure` (`:3242-3271`) and `addStructure` do, the hash fold after `stOccupants` (`:14055-14058`) behind `gateLive`, the structure view (`:2851-2866`), two `SimEvent` kinds; `packages/sim/src/snapshot-schema.ts` (`:212-222` row shape) and `snapshot.ts` (`:789-822`) for the three columns; `snapshot-witness.ts` (a world that moves them); `tools/validate_data.mjs` (footprint 2x1 or 1x2, `per_tile: false`, refuse on any map that has a `data/versus/<map>.json`). **Audit the readers of `structureOfTile`** (`sim.ts:3489, 3592, 4195, 6933-6934, 6998, 7325, 8256, 8317, 10581`): each assumed "structure tile" means "blocked tile".
- **Data shape:** `gate: { open_radius_tiles: int 1..8 (required), hold_open_s: int 0..30 (default 3), swing_s: int 1..10 (default 2), opens_for: enum [0] (default 0) }`; columns `stGateState: Uint8Array(256)` (0 closed, 1 opening, 2 open, 3 closing), `stGateTimer: Int32Array(256)`, `stGateHold: Int32Array(256)`; scalars `gateCount`, `gateLive`. Type row: §2.2 (`hp_per_tile` 600 x 2 tiles = 1200, `low_profile: true`, `per_tile: false`, no `owner`).
- **Determinism:** `radiusSq = R*R*65536` (an int, at most 4,194,304); the near test is `((posX - stCx) >> 8)^2 + ((posY - stCy) >> 8)^2 <= radiusSq`, the form `civilians.ts:208-213` uses; ticks = seconds x 20 by integer multiply (not `fx.mul`); gates visited ascending, entities ascending; `isDown`, `tunnelIn`, `carriedBy`, `isAir` read as in `livingIn` (`mission.ts:4387-4403`); `stOccupants` is garrison occupancy and must **not** be reused for "something stands in the gate"; no RNG. Early return when `gateCount === 0`. The fold is a marker word plus the three arrays, `s < structureCount_` only, behind `gateLive`; `blocked` is already hashed. A **new** `GATE_WORLD_PIN` beside `WOUNDED_WORLD_PIN` (`determinism.test.ts:1215-1255`) is the one replay that sees the block. A destroyed gate (`destroyStructure`, `:12404-12447`) has `stAlive = 0`, is skipped, and stays open with rubble.
- **Read side:** the structure view gains `gate` (state) and `gateTimer`; events `gateOpened`, `gateClosed` `{ tick, structure }`; no `Command`, so `cleanCommand` and the wire are untouched; any exhaustive `SimEvent` list and tutorial `await` list takes the two kinds (UNREAD which tests pin the count).

| test | the one-line mutation that must turn it red |
|---|---|
| opens at the radius and not outside it | flip `<=` to `>` in the radius compare |
| an aircraft opens nothing | delete the `isAir` skip |
| a downed, carried or buried soldier opens nothing | delete the `isDown` test |
| it shuts `hold_open_s` after the last soldier leaves | delete the `stGateHold` decrement |
| it never shuts on a standing civilian or a downed man (any side) | delete the `occupied` guard in the OPEN branch |
| a unit ordered through the gate while it is shut presses the wall, and walks through once it is open | delete `recomputeFields('opened')` |
| after it shuts, a field routes nobody through it | delete `recomputeFields('closed')` |
| a destroyed gate stays open and `stepGates` skips it | delete the `stAlive` guard |
| a world with no gate: every existing pin unchanged | fold the gate arrays unconditionally |
| `GATE_WORLD_PIN` moves when the swing changes | change `swing_s` 2 to 3 in the fixture |
| a snapshot restored mid-swing equals the uninterrupted run | drop `stGateTimer` from `snapshot-schema.ts` |
| the open gate does not block a sight line, a shot or a garrison goal, and is never auto-demolished | (per reader) re-introduce the `blocked` assumption in one reader |
| `validate:data` refuses a gate on a versus map, a 3x1 footprint, `per_tile: true` | switch each rule off in the validator; the fixture must then be accepted |

**E2: gate presentation** · M + art · both · `render-vfx`, `blender-art`
- **Does:** draws two leaves swung about their hinges from the sim's state and timer on the sim clock, and plays the clank on the events.
- **Files:** new `packages/render/src/three/gate-mesh.ts` (presentation only; reads the view, writes nothing back); `packages/app/src/mesh-catalogue.ts` (`buildings/compound_gate.glb` and `_wreck.glb`, `mesh-catalogue.test.ts:203-208`); `art/src/buildings/` `.blend` (`leaf_l`, `leaf_r`; 2x1 and 1x2 if Q8 says two types); a yellow key in `data/palette.json` (Q8, the lead); `data/audio.json` rows (`validate:audio`).
- **Determinism:** none (frame clock; `swingAngle(state, timer)` is a pure function of sim words). **Tests:** the swing angle at timer 0, half and full for OPENING and CLOSING (mutation: reverse the sign); the roster test fails when the GLB is missing (mutation: rename the file); the golden baseline is blessed **from CI**, never from the branch. **Size:** M render; art 0.75 to 1.25 days, 0 credits (Q10).

**E3: `evacuate_before.group`** · S · both · `sim-guard`
- **Does:** an evacuation objective counts only people of a named civilian group.
- **Files:** `data/schemas/mission.schema.json` (`objectives.items.properties.group`, plus an `allOf` rule that it is legal on `evacuate_before` only, like `hostages`); the objective type (`mission.ts:~223`); the evaluation at `mission.ts:4830-4848` (`complete = flight.evacuatedCountIn(ids) >= count`); `CivilianFlight.evacuatedCountIn(ids)` in `civilians.ts` (the set is mission-wide, `:62-76`; intersect it with `groups.get(group)`); the refuge and zone check block (`mission.ts:2842-2860`) throws on a group no placement declares; `validate_data.mjs` the same. Keep `collect` running for the arrival zone after the last objective resolves (V6).
- **Shape:** `group?: string`. **Determinism:** no new state; `evacuatedSet` is already digested (`civilians.ts:95-120`, `mission.ts:1629`), so no hash word moves. **Not** `hostages: true` for the north block (N1).

| test | mutation |
|---|---|
| a person of group B evacuating does not advance an objective scoped to A | ignore `group` in the count |
| an unknown group throws at `start()` | delete the throw |
| an unscoped objective still counts everyone | scope every objective to the first group |

**E4: coalesced feed** · S · both · `render-vfx` (app)
- **Does:** one `clear (n)` line per second of arrivals and one `taken (n)` per second of removals, instead of up to 100 lines in a 4-line, 9 s feed.
- **Files:** `packages/app/src/main.ts:6431-6444` (the loop calls `describeMissionEvent` per event); `packages/app/src/ui/mission-notice.ts:47-86` (`evacuatedNotice` and `removedNotice` already format with `{n}`); a new pure `coalesceCivilianEvents(events, windowTicks)` beside them; `en.json` plural (no new key: `notice.evacuated` and `notice.removed.civilian` take `n`). **Determinism:** app only, reads the same events. **Tests:** 30 `evacuated` in 20 ticks give one line `n=30` (mutation: emit one per event); a `removed` side-2 and a side-0 in the same second are not merged (mutation: merge on kind only); `validate:ui` and `__lionsI18n.missingKeys()`.

**E5: `zone` on `commit` and `withdraw_to`** · S · A · `sim-guard`
- **Does:** orders only the group members whose tile is inside the zone.
- **Files:** `mission.ts:4552-4561` (add `zoneContains` to the `ids` filter, as `remove` does at 4616-4621); the `do.zone` description in `mission.schema.json` (legal on `remove`, `commit`, `withdraw_to`); `validate_data.mjs`: **until this lands, refuse `zone` on `commit`/`withdraw_to`** (the schema accepts it and the runtime ignores it: N24). **Shape:** nothing new. **Determinism:** an integer tile compare; no state. **Tests:** members outside the zone get no order (mutation: ignore the zone); `remove` still works (mutation: break the shared filter); the validator refuses `zone` on `spawn`.

**E6: civilians as targets, per placement** · M · A · `sim-guard`
- **Does:** a placement marked `fires_on_civilians` shoots identified side-2 people when it has no side-0 target in reach.
- **Files:** `$defs/placement` in `mission.schema.json` (the shared def; refuse it in `starting_force`, `civilians.groups` and a side-0 `reinforce` in `validate_data.mjs`); `PlacementJson` and `spawnPlacement` (`mission.ts:3904-3931`) call a new `sim.setCivFire(id)`; `packages/sim/src/sim.ts`: column `civFire: Uint8Array(capacity)`, scalar `civFireLive`; **`selectTarget` (`:8064-8125`)**: after the scan, `if (best === -1 && this.civFireLive && this.civFire[shooter] === 1)` scan side-2 ids ascending through `engageable` with its `side[t] > 1` refusal (`:8025`) lifted for side 2 (factor the side test into an argument; the other caller, `:12689`, keeps today's); hash fold (marker word + array) behind `civFireLive`, snapshot row, witness world. ROE needs nothing (V8). `isEnemyFire` already ignores a side-2 target (V9), so a shot at the crowd does not set `first_contact` and does not send the technicals early.
- **Determinism:** integer; ascending scan; no new RNG draw beyond the existing hit resolution for a shot (per-entity streams). **Read side:** the existing tracer and `down` pose; no new clip, sound or camera (D18).

| test | mutation |
|---|---|
| an unflagged shooter never targets a civilian | drop the `civFire` test |
| a flagged shooter with a KDF target in reach shoots the KDF | delete `best === -1` |
| a flagged shooter with none shoots a civilian, who goes `down` in place, and the player pays no Conduct | skip the second scan |
| a shot at a civilian does not set `first_contact` | widen `isEnemyFire` to `targetSide <= 2` |
| a civilian downed by a side-1 shooter charges nothing; by a side-0 shooter charges 8 | change `st.side[e.by] === 0` to `!== 2` in `stepRoe` |
| a world with no flagged placement: every pin unchanged | fold `civFire` unconditionally |

**E7: `on.kind: group_fired`** · S · both (cue lines) · `sim-guard`
- **Does:** fires once when any member of a group first fires a weapon.
- **Files:** `mission.schema.json` `on.kind` enum, `group` required; `mission.ts:2940-2941` (the event digest sets a latch when `fire`'s shooter is in `groups.get(g)`); `stepTriggers` (`:4512-4549`) reads it; `validate_data.mjs` (the group is declared). **Determinism:** the latch folds into `MissionRuntime.digest` only when a trigger uses the kind. **Tests:** a group member's `fire` fires it, another group's does not (mutation: ignore the group); it fires once (mutation: reset the latch); the digest is unchanged for a mission without it.

**E8: `do.kind: abduct`** · M · A · `sim-guard` (E5 is the data-only interim)
- **Does:** captives follow an escort's leader; reaching `zone` with a living escort takes them (`remove`, the shipped verb); a captive freed by the existing shepherd rule (a ground soldier within 4 tiles) or by the escort being dead, down, removed or more than 6 tiles off belongs to the flight rule from then on.
- **Shape:** `{ "kind": "abduct", "group": <escort>, "captives": <civilian group>, "to": <marker>, "zone": <exit zone> }`. **Simplest honest version (recommended):** no hold against the shepherd rule, so reaching the column frees you, which is what the sheet says (*"Reach the track and they break for us"*). Then the piece is: leader = lowest-id living, surface, not-down escort member; every `(tick + id) % 10 === 0` queue an `exact` `move` of each not-`fled` captive to the leader's tile; a captive standing in `zone` while an escort lives is taken through `removeFromPlay` and the `removed` event (`mission.ts:4607-4643`).
- **Files:** `mission.schema.json` `do` (kind, `captives`), `stepTriggers`, a new runtime list in `MissionRuntime`, `CivilianFlight.hasFled(id)` to skip the freed (`civilians.ts:83-85`). **Determinism:** the follow period is integer ticks; the 6-tile test is `((dx >> 8)^2 + (dy >> 8)^2) <= 36 * 65536` (2,359,296, inside int32); the list and its `taken` flags fold into `MissionRuntime.digest` (`mission.ts:1629`) only when a trigger uses the kind. **Tests:** captives follow (mutation: no re-order); freed by proximity are not re-taken (mutation: ignore `hasFled`); no escort left means released (mutation: skip the release); taken only with a living escort (mutation: drop the escort test); the digest is unchanged without the kind.

**E9: crowd pathing and performance at 100** · S to measure, M if a fix is needed · both · `playtest`, `sim-guard`
- **Measure, in this order, on S0:** (1) distinct flow fields and tick time at t=2 (V4: up to 88 `fieldFor` computes; the pool cap 128 is a floor); (2) a gate-flip repair with N live fields (`recomputeFields` repairs each, `sim.ts:3030-3041`); (3) throughput of 2 tiles with `pnpm spacing:census -- --play` (the choke probe; the designer's 1.5 to 3 a second is an ESTIMATE); (4) whether an Eitan or a Lavi leaves the yard through a packed apron (`sepBlockedBy`, **UNREAD**); (5) the ROE loops are O(100) per heavy shot and per destroyed event (`mission.ts:4178-4193, 4050`): expect negligible; (6) the render curve on both backends (G-12; N22).
- **Fixes, only if a measurement asks:** spread the t=2 order over 2 to 4 markers (data); a trigger-issued `exact` order for an all-civilian group (`mission.ts:4568`; they then stack on a tile, so only with several markers). The **G-2 throttle is not needed** (V5; N16). **Tests:** a regression that the 88-person order creates at most K distinct goal tiles (mutation: remove the spreading marker); no timing asserts.

**E10: authored-entity budget** · S · both · `content-validator`
- **Does:** `validate:data` fails a mission whose authored entities exceed 160 (G-10 a).
- **Files:** `tools/validate_data.mjs` and a pure `entityBudgetFailures(mission)` in its own module (the `validate_time_limit.mjs` shape); count `starting_force` (a `from_ledger` placement counts its `count`), `civilians.groups`, `enemy.garrison` including `passengers` (each carrier x its load), wave placements and `spawn`/`reinforce` placements. **Tests:** a fixture at 160 passes and one at 161 fails (mutation: raise the limit to 200); passengers are counted (mutation: skip them). The pilot is 127 (A) and 125 (B).

**E11: passive-probe harness** · S/M · both · `playtest`
- **Does:** keeps a crowd from letting a passive or one-click player win, and prints the numbers of §10.4.
- **Files:** `tools/src/backtest/playtest.ts:157` (the control's expectation `'withdrawn'` becomes `'defeat'`; the cause is `{ objective: 'into_the_compound' }`); use the event-callback form of `run` (`playtest.ts:138-153`) to assert zero `evacuated` events for the **whole** passive run and to record the numbers; new controls `parked` (one `inf_squad` to `gate_apron` at t=0) and `naive` (every ground unit attack-moves east at t=0) beside `passive-plans.ts` (`ControlPlan`); `passive-sweep.ts` runs them on `SWEEP_SEEDS`.
- **Tests:** a fixture mission whose muster marker lies **inside** `compound_yard` makes the passive control win and the harness exit 1 (mutation: point `gate_apron` at (6,22) in the real mission and expect red); a fixture with the gate missing (S0) is read with the same assertion.

**E12: a rescued wounded civilian counts as saved** · S · both, optional · `sim-guard`
- **Does:** a civilian a medic admits or evacuates (`woundAdmitted` / `woundEvacuated`, side 2) counts toward an evacuation (G-7). **Files:** `civilians.ts` `collect`, or an option on `evacuate_before`; `mission.ts:4066-4072`. **Tests:** counted once (mutation: count twice); not counted when the option is off.

**E13: muster and sealed-compound validators** · S · both · `content-validator`
- **Does:** refuses a mission whose crowd can reach its own refuge.
- **Rules:** (a) every `withdraw_to` whose group is all-civilian targets a marker outside **every** `evacuate_before` zone; (b) after the start layout, no ground side-0 unit is within 5 tiles (shepherd 4 + 1) of a civilian body, a muster marker or a gate centre (a `walk_placements.ts`-style world build); (c) with every gate tile blocked, a flood from the muster marker does not reach the refuge. **Tests:** a fixture per rule (mutation: delete the rule and expect the fixture accepted); the real mission passes.

**E14: crowd variety and adult-only figures** · S · both (variety), A (adults) · `render-vfx`
- **Does:** per-entity tint jitter from existing palette ramps (skin, cloth) keyed on entity id; under A, a mission field `civilians.figures: "adults"` makes the app draw the three adult variants only (the variant is `n % 4`, `mesh-catalogue.ts:218-243`; presentation only, no hash). **Tests:** the child variant is never drawn under `adults` (mutation: ignore the field); the tint is a pure function of the id (mutation: use `Math.random`; lint refuses it).

**E15: the capacity decision** · S now, M later · both · lead, `sim-guard`
- **Decision proposed:** hold every mission to <= 160 authored entities (E10) and **do not raise 256** for the pilot (127 or 125 authored leaves 129 or 131). Overflow does not crash mid-mission (V11): a runtime `spawn`, `reinforce` or wave is skipped whole and a wounded man is killed outright, so the **Easier relief at 90 s and a late `reinforce` can silently not arrive**. Print lifetime `entityCount` in `playtest` (E11). Raising capacity (`main.ts:2392`, `playtest-run.ts:348`, and arrays scaled by `side * capacity` such as `contact`, `sim.ts:~2325`) needs a hash and snapshot audit that is **UNREAD**; do it only if a mission needs more than 160. Fallback crowd sizes: 60, then 40.

**Data first.** §10.1.9 lists the slices. Everything in E10, E13, E11, E3 and E4, and the whole of Variant B except the gate, can be built and measured before E1; the map's gate stands as a 2-wide gap for S0.

### 10.3 Capability gap report, reconciled with G-1 to G-19

| gap | what I found | smallest proposal | owner | status |
|---|---|---|---|---|
| G-1 mass flight | works in schema and runtime (V2, V3); no mission has played it | S0 world-walk | `mission-author` | live (data) |
| G-2 re-order spam | **not a problem at a shut gate** (V5: a pressed civilian keeps `moving 1`) | measure only (E9) | `playtest` | withdrawn |
| G-3 gate | as §2 | E1, E2 | `sim-guard`, `render-vfx` | engine |
| G-4 aim at civilians | `engageable` and `selectTarget` are the only two places (V9) | E6 | `sim-guard` | engine (A) |
| G-5 abduction | the approximation is live but has an early-rescue hazard (§10.1.1) | E5 now, E8 later | `sim-guard` | engine (A) |
| G-6 group count | | E3 | `sim-guard` | schema |
| G-7 saved wounded | | E12 | `sim-guard` | engine, optional |
| G-8 `group_lost`, `ground_only` | not needed: A uses `group_in_zone` on `rescuers` (no drone) | backlog | `sim-guard` | not blocking |
| G-9 vehicle snatch | T3 is not in the pilot | backlog | `sim-guard` | not blocking |
| G-10 capacity | strict at start, soft at runtime (V11) | E10, E15 | `content-validator`, lead | S |
| G-11 wounded cap 24 | a grove of 2 cells stays under it | none | | closed |
| G-12 render budget | two backends disagree (N22) | E9 (6) before the pilot ships | `render-vfx` | measure |
| G-13 variety | | E14 | `render-vfx` | S |
| G-14 grade | report only (Q6) | app S | `render-vfx` | lead |
| G-15 board's account | static | none | lead | |
| G-16 adults only | A only | E14 | `render-vfx` | S |
| G-17 gate throughput | | E9 (3) | `playtest` | measure |
| G-18 crowd speed | 0.8 t/s; every timing in §10.1.2 assumes it | Q9 | lead | |
| G-19 `structures[]` per-tile barrier | **resolved: yes** (V12) | none | | live |
| **L-1** observer for T1-B | the shipped spotter cannot see the apron (N13) | `eye_north` (data) | `mission-author` | live |
| **L-2** `zone` on `withdraw_to` accepted and ignored | footgun | E5; validator refusal now | `content-validator` | S |
| **L-3** wall breach | `wall` is 200 hp per tile; `STRUCT_DAMAGE` mortar 1.4 (`structures.ts`) | probe P5; lever L3 | `playtest` | measure |
| **L-4** `collect` stops after the last evacuation objective (V6) | | in E3 | `sim-guard` | S |
| **L-5** the primary may be one click away (N17) | | P1; lever L1 | `playtest` | measure |
| **L-6** `picture` is cheaper with more enemy bodies (V10) | | P3 reads its time; raise `count` if it collapses | `playtest` | measure |
| **L-7** Harder is a no-op | no waves | none; do not add a wave for the posture's sake | | note |

### 10.4 Playtest asks for the pilot

All on `SWEEP_SEEDS` (30), A and B separately, on S0 first and then with the gate. Every control must also be shown red once by a one-line mutation of the mission (E11).

| id | plan | pass | the mutation that must make it fail |
|---|---|---|---|
| P0 | **passive**: no orders (`passiveAcrossSeeds`, expectation changed to `defeat`) | 30/30 defeat, no `evacuated` event on any tick; cause `into_the_compound` at tick 6000 unless the force is wiped first (any defeat) | move `gate_apron` to (6,22): a win or an `evacuated` event |
| P1 | **parked**: one `inf_squad` to `gate_apron` at t=0, nothing else | report the time to 55; the ask is that it does **not** reach 55 before 120 s on more than 10% of seeds; if it does, apply lever L1 | give the unit a second order at t=60 (the report must change) |
| P2 | **naive**: every ground unit attack-moves east at t=0 (the shipped plan's own screen move is the model) | wins on at most 20% of seeds | hold a gate-keeper at the gate: the rate must move |
| P3 | **the winning plan** (below) | 30/30 victory; slowest win <= **700 s**; min saved >= 55 on every seed; **margin** = 100 - 55 - (worst seed's civilians lost, downed or taken, in %) >= **19** points, replacing the designer's 21 ESTIMATE; three stars on every seed | drop the gate-keeper: the primary must fail |
| P4 | **early rescue** (A): an Eitan to the north block at t = 20, 60, 100, 118 | with E5: the freed captives are never taken; **without E5 this probe must go red** at t=20 to 100 (a captive freed and still outside at 120 s is walked east); record it and keep it as the E5 witness | remove `zone` from `north_block_walked` |
| P5 | **breach**: the Lavi fires at wall tile (13,18) from the yard | report whether the wall falls, the Conduct cost, and how many enter through it; if it opens the compound for free, apply lever L3 | `hesco` on x=13: the wall must hold |

**P3's plan, as a table of orders** (a scripted plan has perfect information: read its margin as a floor, CLAUDE.md "Known scaling debts"):

| t (s) | order |
|---|---|
| 0 | drone legs as the shipped plan (`move` to (21,8), then (40,8) at 18 s, (40,22) at 24 s) |
| 2 | one `inf_squad` to (15.5, 21.5): the gate-keeper, who opens the gate and frees the block's head |
| 40 | a second `inf_squad` walks the block's length (x 15 to 27, y 21) to free the rest; the medic follows it to lift the downed |
| 90 (A) | the Eitan to (30, 17) with the `at_team` (north block); B: the same at 100 |
| 120+ | the rest of the screen advances to (16, 22) as the shipped plan does (`playtest.ts` ~196-199); the Lavi stays in the yard |

**Numbers the harness must print, per seed and as a 30-seed table:** evacuated at 60, 120, 180, 240 and 300 s; time to 55 and to 85; civilians downed (`woundedDown` side 2), killed (`destroyed`, by side) and taken (`removed` side 2); the north block's outcome (A: tick of release, tick of the take, saved, taken); Conduct at the end and its minimum, and the count of danger-close deductions; gate transitions and total ticks open; peak living entities and lifetime `entityCount`; distinct flow fields at t=2 and the peak `sim.fields` size; the `first_contact` tick; the ticks `picture`, `hvt_seen` and `find_the_column` complete; stars. **Postures:** Harder is a no-op (no waves), so the ladder's monotone check passes trivially and should say so. Easier gives time x1.25 (1050 s), a relief of two squads at 90 s inside the yard (check it does not open the gate or reach a muster: it spawns at the start), and `uncarry`; the passive control must still lose under Easier. **Margins:** `time_limit_s` 840 clears the 300 s deadline by 540 s (the rule asks 60 s) and the slowest win by the 120 s and 20% rule at 700 s.

### 10.5 Notes on sections 1 to 9 (conflicts recorded; the earlier sections are not edited)

| # | where | note |
|---|---|---|
| N13 | §6 *The threat*, B | `bs_observer_aloft` cannot observe the gate. Its patrol is x 38.5 to 43.5 (`beit_sahwan_1_recon.json:302-318`), sight 14 (`paramotor.json`), so it sees x >= 24.5; no other body sees (15,21). The tube would never fire. Fixed with `eye_north` (§10.1.5) |
| N14 | §6 *The taking*, A | `takers` at (29,12) is a house tile (row 12 is `2hhhh2`, x 28 to 31): `assertGroundClear` throws (`mission.ts:3900-3902`). Use (33.5, 12.5) |
| N15 | §6 *The threat*, A | the cells are 8.06 and 8.31 tiles from the apron marker, not 7.1; the militia's sight is 7, so a KDF unit **at** the apron is not seen and does not draw the fire. To draw it, a unit must be within 7 tiles of (16.5, 13.5): the olive strip x 14 to 18, y 15 to 19. The briefing wording holds |
| N16 | §4 G-2 | not true as stated (V5). Downgraded to a measurement |
| N17 | §1.1, §6 | the muster is not engine work (the shepherd rule and `withdraw_to` do it), but with one apron and 7-wide ranks one soldier frees about 35 to 50 people. The shipped plan's own advance to (16,22) at t=32 would land in the block. The primary of 55 may not be a decision; P1 measures it, L1 is the lever |
| N18 | §6 objectives | `most_of_them` 85 is unreachable once the north block is taken (the crowd is 88, less the downed). It is a stretch that couples to the north block; say so in the briefing's register or lower it to 80 |
| N19 | §2.2, §6 | `wall` is 200 hp per tile and mortar HE does 1.4 against masonry (`structures.ts` `STRUCT_DAMAGE`): B's tube, whose targets stand 2 tiles from the wall, can breach it, and a Lavi round does so deliberately, making the gate optional. Probe P5, lever L3 (`hesco`, 600 hp, low profile) |
| N20 | §6 | the compound **contains the player's start** (`kdf_assembly` (4,23), all `at`, the vent (7,22), `wounded_evac` (1,22)). Coherent with *"our wall"* but unstated. `start_front: E` lays the first rank toward the gate: re-measure the 4-tile margin after the layout. The technicals' `commit` goal is the sealed yard |
| N21 | §3.1 | "`spawn` throws at capacity" is true of start-time placements and `Sim.spawn` only. Runtime placements are skipped whole (`mission.ts:3825-3835`) and `fallMan` kills outright (`sim.ts:9693-9695`) (V11) |
| N22 | §3.1 | the render budget is backend-dependent: F9 reads 30.0 ms at 266 living on the legacy three path, F10 reads 9.15 to 10.95 ms at 300 on the WebGPU node path (`docs/PERFORMANCE.md:45` and the F10 row at line 46, both flagged "needs Metal re-read"). "Binding at 130 to 140 living" holds for F9 only. Measure both before choosing 100 or 60 |
| N23 | §6 stars | Harder is a no-op on this mission; Easier's relief lands inside the yard (V15) |
| N24 | §9.2 A rows | `north_block_walked` is `engine: E5`, not `live`; and a `do.zone` on `withdraw_to` is accepted by the schema and ignored by the runtime today. `remove` should carry a `zone` in every row |
| N25 | §9.2 A rows | `north_block_breaks` is not needed to release the captives (the shepherd rule does, V7); it stays as a label, a line and an order to the apron |
| N26 | §9.2 objectives | `picture` counts any identified enemy (V10): A adds 4 identifiable bodies, B adds 2. The text stays *six*; P3 reads the time |
| N27 | §3.2 row 3 | 123 authored omits the new enemies: A 127, B 125 (script count) |
| N28 | §4 G-19 | resolved (V12) |
| N29 | §6 stars, §9.2 | danger-close is **per heavy shot**, no cooldown (V8): ten shots or four deaths end the second star |
| N30 | §9.2 B briefing | *"the eye to the east calls it onto soldiers"* names the wrong eye; the spotter is in the grove north of the apron, so *"the eye over the grove"* is the true wording (`narrative-designer`) |
| N31 | §2.3 | the unreachable-goal fallback the designer cites at `sim.ts:4969-4978` is `nearestOpenTile`'s comment; the straight-line beeline and wall slide are at `sim.ts:13039-13089` |

---

### 9.7 The breach pilot's narrative sheet (Option A only)

*(narrative-designer, appended after the Rulings of 18 Nov. §9.2 and §10.1 were written for
recon and are superseded as the pilot by Q2; §9.2's B briefing is corrected for N30 in place
and stays only as a record.)*

**Read for this sheet:** `data/missions/beit_sahwan_breach.json` as shipped (6 waves, 5
triggers, 2 primaries, 11 civilians in group `families` at (10.5,18.5) ×3, (37.5,18.5) ×3,
(9.5,27.5) ×3, (37.5,27.5) ×2; refuge `civ_refuge` (24,26) inside zone `compound`
[18,17,13,13]); `data/maps/marj_perimeter.json` (wall x 17–31, y 16–30; the two gaps on the
road at (17,21–22) and (31,24–25); villages of `h` and `s` at the four corners; the road on
row 23 from both map edges); `beit_sahwan/narrative.md` §2; `storyline.md` §1, §2.1(3),
§2.2(6), §2.3, D12, D18. The shipped JSON is **behind** that sheet: its briefing has no
forward section and no eye aloft, so this sheet is written against the JSON.

**Recommendation: Q11-KEEP.** Eleven, two and nine are spoken in three acts and are the
number Idit exists to say; KEEP changes two shipped strings, RESTATE changes nine across
three files and `world.json`. The ~100 the lead asked for still run, under fire, on screen:
they are the road, not the villages.

**The shape both sub-variants share.**

| layer | who | where at t=0 | counted by | canon |
|---|---|---|---|---|
| the villages | group `families` (KEEP 11 · RESTATE 40) | the four shipped village markers | the primary `evac_settlements`, **scoped to `group: families` (G-6)** | the atrocity: KEEP *eleven, two in, nine not* |
| the road | groups `road_w`, `road_e` (KEEP 89 · RESTATE 60) | on the road outside each gate (row 23, x 0–16 and x 32–47) | a new **secondary** `road_in`, scoped to the road groups (G-6), never carried | uncounted in canon: no line states how many came in |
| the gates | two `compound_gate`s in the shipped gaps, (17,21–22) and (31,24–25) | — | — | "two gates, both on the road" (shipped) become the huge yellow ones |
| the threat (A) | T1-A: the t=18 cells entering by `raid_w` (2,26) and `raid_e` (43,26), flagged `fires_on_civilians` (G-4) | — | — | Ashwar Front: cells, the corners, ambush on the approach |
| the taking (A) | T2-A: the four `ring_*` corners walk the families still outside toward their raid markers at 240 s; the shipped `remove` at 272 s takes whoever is still with them | — | — | *"they are taken, back across the line"* (`design.md` §1) |

The road starts **outside**, running: a civilian placed inside `compound` is collected and
deleted on the first evaluation (`civilians.ts` `collect`, `alive = 0`), so nobody can be
"already inside" and visible (§ report, awkward 1). Authored entities: 54 shipped + 89 road =
**143** (RESTATE 54 − 11 + 40 + 60 = 143), inside §3.1's 160.

#### Q11-KEEP

**`name`:** `Beit Sahwan — First Light` (unchanged). **`dispatch`** (219, unchanged, true as
shipped): *Beit Sahwan, before dawn. Nadir Sahim spent four years digging under the Marj and
one morning spending it — every approach at once, and four villages left outside the wire.
The senior officer still inside was a captain.* · `live`

**`briefing`** — 1,131 characters, 6 beats, no line breaks:

```
They came at dawn, out of the Marj, across every approach at once. Eleven are still in the four villages outside the wire, and nearly ninety more are on the road, running for our gates. What is left of the company is inside the compound on the Beit Sahwan road. Hold the yard until the relief column reaches us, five minutes out. Two gates, both on the road, huge yellow steel, and two blind faces they will cut straight through rather than walk round. Cells are coming in along both roads, and they fire on anyone running while nothing of ours is in reach. A gate opens for one of ours within four tiles of it and for nobody else, and anyone within four tiles of him follows him in. While it stands open it is open to them as well, so be standing at it when it opens. The families in the villages have nowhere else to go: get at least two inside before the ring closes, because nobody is coming back for them afterwards. Take something fast: a family runs once one of ours is within four tiles, or under fire. The Nemala Medic Team is on loan: a wounded man has a minute, and it treats him and carries him to the rear of the yard.
```

| beat | speaker | chars | `briefing_sections` | source |
|---|---|---|---|---|
| 1 | Idit | 185 | `situation` | shipped sentence 1 + the two layers, counted and uncounted |
| 2 | Shai | 143 | `mission` | shipped (*"Hold the yard…"*), *"Two things matter this morning"* cut |
| 3 | Idit | 227 | `execution` | shipped gates sentence, now *huge yellow steel*; the T1-A fire as a tile fact |
| 4 | Shai | 210 | `execution` | the gate rule and the shepherd rule; the cost: an open gate is open to the Ashwar too |
| 5 | Shai | 152 | `execution` | **the canon line, verbatim from *"the families"* to *"afterwards"*** |
| 6 | Shai | 209 | `notes` | shipped, *"for the compound"* cut (the gates now say where) |

Idit / Shai / Idit / Shai / Shai / Shai: picture, plan, picture, then three beats of costs and
orders, as shipped First Light closed. Idit is **not** named in the third person: she is
standing next to him (`beit_sahwan/narrative.md` §2.3).
*Compliance:* 6 beats ≤ 2 sentences and ≤ 240; total in 385–1,225; *nobody is coming back for
them afterwards* kept as the ceiling; the fire is ground and a condition, never an effect;
adversaries are *cells*; no harm word; *families* survives only uncounted or in canon (rule 10).

**Objectives.**

| id | order (chars) | as a toast | status | needs |
|---|---|---|---|---|
| `survive_relief` | Hold until the relief column arrives (36) | `OBJECTIVE COMPLETE — Hold until the relief column arrives` | live | — (shipped) |
| `evac_settlements` | Get two families inside the wire before the ring closes (55) | `OBJECTIVE FAILED — Get two families inside the wire before the ring closes` | **schema** | G-6 `group: families`; without it the road completes the canon primary in seconds. Text shipped; *families* kept because it is canon |
| `road_in` (new, secondary, not `carries`) | Get fifty people off the road and inside the wire (49) | `OBJECTIVE COMPLETE — Get fifty people off the road and inside the wire` | **schema** | G-6 over `road_w` + `road_e`; 50 of 89 by 270 s (56%) |

*Compliance:* imperative, ≤ 72, no full stop; the road's count is *people*.

**Trigger table — KEEP.** Ids are proposals; rows the shipped file already carries are marked.

| event | channel | speaker | line | overlay / audio | status | needs |
|---|---|---|---|---|---|---|
| mission start | `title` | system | `Beit Sahwan — First Light` · *2 primary objectives* | `hud.announce` | live | — |
| mission start | `dispatch` | narrator | shipped | title card | live | — |
| mission start | `brief` | Idit / Shai | beats 1–6 | deploy screen, commander bar | live | — |
| `timer_s(2)` → `the_road_runs_west` (`withdraw_to road_w → gate_apron_w` (15,22)) | `toast` | system | `The road runs for the west gate` (31) | feed | live | G-1; new marker |
| same | `radio` | Idit | "Both roads are running for our gates, west and east. Their cells are coming in along the same roads, and nothing of ours is out there yet." (138) | commander bar | live | G-4 |
| `timer_s(2)` → `the_road_runs_east` (`withdraw_to road_e → gate_apron_e` (33,24)) | `toast` | system | `The road runs for the east gate` (31) | feed | live | G-1; new marker |
| first `fire` by a `fires_on_civilians` cell | `radio` | Idit | "Their cells are firing on the road. Put something of ours where they can see it and they look at that instead." (110) | commander bar | **engine** | `on.kind: sim` + G-4 |
| an enemy unit enters `compound` while a gate is open | `radio` | Shai | "Something of theirs came in behind the road. A gate shuts when the last of ours walks away from it." (99) | commander bar | **engine** | `on.kind: sim` (`gateOpened`) + G-3 |
| a civilian `down` | — | — | **no line, by design** (§9.1 rule 3) | — | — | — |
| `gateOpened` / `gateClosed` | audio | — | no line; the motor and the clank of the yellow gates | `data/audio.json` | **engine** | G-3, §5 |
| `evacuated`, per person | `toast` | system | `clear (1)` | feed | live | — |
| `evacuated`, coalesced | `toast` | system | `clear (n)` per second | feed | **engine** | N6, `render-vfx` |
| wave t=18 s (`compound_centre`) | `radio` | Idit | shipped: "Every approach at once. There is no main effort in this — he does not need one." | | live | — (shipped) |
| `first_contact` → `villages_rise`, `they_take_the_south_village`; `timer_s(150)` → `they_come_for_the_west_families`; `timer_s(190)` → `the_last_village_goes` | `toast` + `radio` | system / Idit | shipped labels and lines, unchanged (*"They are not queuing for the gates — they are going to the houses"* now reads against open gates, and holds) | | live | — (shipped) |
| waves t=120 s, t=205 s | `radio` | Shai, Idit | shipped, unchanged | | live | — (shipped) |
| `objective(evac_settlements, complete)` | `radio` | Shai | shipped: "Two in. Get the gate shut behind them." | | **schema** | G-6 |
| `objective(road_in, complete)` | `radio` | Shai | "Fifty in off the road. The gate shuts when the last of them is through, not before." (83) | commander bar | **schema** | G-6 |
| `timer_s(240)` → `the_corners_walk_back` (`withdraw_to` each `ring_*` and `families` → its raid marker) | `toast` | system | `The corners walk back with the families` (39) | feed | live | T2-A approximation; §10.5 N24 (a `withdraw_to` on a civilian group; zone ignored) |
| same | `radio` | Idit | "The corners are walking back the way they came, and they are not walking back empty." (84) | commander bar | live | the shipped line, moved here from the 272 s `remove` |
| `objective(evac_settlements, failed)` @270 s | `radio` | Idit | shipped: "The ring is closed. Whatever is still outside it is outside it." | | live | — (shipped) |
| `timer_s(272)` → `the_ring_closes` (`remove families`, with a `zone` per N24) | `toast` | system | silent; chrome `taken (1)` per person | feed | live | — (shipped trigger) |
| same | `radio` | Idit | "The ring is closed. The villages are across their line now, and so is everyone we did not reach." (96) | commander bar | live | new line; the old one moved to 240 s |
| `missionEnd(victory)` | `aftermath` | narrator | *The relief came through the west gate a little after six, and the yellow gates shut behind it. Everything the brigade did in the Marj after that morning was about the four villages on the other side of them.* (207) | victory banner | live | new field on this mission |
| `missionEnd(victory)` | `debrief` | Idit | "Eleven were in the villages at first light. Two came in." (56) | end screen | live | **changed**: *outside the wire* → *in the villages*, because ninety more were outside the wire |
| `missionEnd(defeat)` | `debrief` | Idit | shipped: "The compound went at 0-something. I did not get the time." | end screen | live | — (shipped) |

**Row count, KEEP:** 25 rows (one deliberately silent), **4 `engine`**, 2 `schema` (plus the
two `schema` objectives).
*Compliance:* labels ≤ 48, no full stop, no harm word; the visible taking is *walk back
with the families*, the outcome is *across their line*, nobody taken is described; no
`enemy` speaker line; the Ashwar act by doctrine (every approach, the corners, cells on the
approach, the walk back), never as a people; Shai never names his motive; the number is
Idit's, once, at the end, as shipped.

#### Q11-RESTATE

Everything in KEEP stands except these strings (all checked; the §9.5 replacement set):

| field | string | chars | status |
|---|---|---|---|
| `briefing` beat 1 (Idit) | They came at dawn, out of the Marj, across every approach at once. Forty are still in the four villages outside the wire, and about sixty more are on the road, running for our gates. | 182 | live |
| `briefing` beat 5 (Shai) | The families in the villages have nowhere else to go: get at least ten inside before the ring closes, because nobody is coming back for them afterwards. | 152 | live |
| whole `briefing` | 1,128 characters, 6 beats, seams as KEEP | — | live |
| `evac_settlements.text` | Get ten people inside the wire before the ring closes | 53 | schema (G-6) |
| `evac_settlements.say` (Shai) | "Ten in. Get the gate shut behind them." | 38 | schema (G-6) |
| `road_in.text` | Get thirty-five people off the road and inside the wire | 55 | schema (G-6), 35 of 60 |
| `road_in.say` (Shai) | "Thirty-five in off the road. The gate shuts when the last of them is through, not before." | 89 | schema (G-6) |
| `debrief.victory` (Idit) | "Forty were in the villages at first light. Ten came in." | 55 | live |
| `wadi_halam_4_village` `evac_families.say_on_fail` (Idit) | "The road is shut and there are still families inside it. Thirty did not come in at First Light. Somebody has to keep saying the number, and it is not going to be you." | 166 | live |
| `storyline.md` §1, §2.1(3), §2.3 | §9.5's set, with *in four groups* read as *in the four villages* | — | lead |
| `world.json` `taken` | re-derived from 30 plus the soldiers (derivation UNREAD) | — | lead |

*Compliance:* as KEEP; the counted forty are *people* in objectives (rule 10).

#### N30

Fixed in §9.2 B (*"the eye over the grove"*, 1,222 characters, beats re-checked). Nothing
kept for the breach uses an eye: the shipped breach has no paramotor in any wave and its
briefing names none, so no line here mentions one.

---

### 9.8 GDD §11 reconciliation: PROPOSED DIFF, NOT APPLIED

**The lead's to apply.** `docs/GDD.md` is not edited by this change; the version bump is the
lead's. Read today: line 3 (version), lines 420–424 (*One villain per front*), lines 426–429
(*The level carries story twists*). The second hunk is required by D18 (it lists an execution,
which D18 rules out); the third is optional.

```diff
--- docs/GDD.md
+++ docs/GDD.md (proposed, D18 Option A)
@@ -3 +3 @@
-**Version:** 1.2.4 · **Status:** decisions locked; §5 synced to the calibrated M0 model; §11 (story) added 2026-09-03 as a draft, its surface list corrected the same day when `dispatch`/`aftermath`/`debrief`/`say` landed; §11's surface list gains the end of the war (2026-10-09); §2 and §11 gain Ein Qasab, the winter interlude town, and §11's stale `debrief` clause is dropped (2026-10-31)
+**Version:** 1.2.5 · **Status:** decisions locked; §5 synced to the calibrated M0 model; §11 (story) added 2026-09-03 as a draft, its surface list corrected the same day when `dispatch`/`aftermath`/`debrief`/`say` landed; §11's surface list gains the end of the war (2026-10-09); §2 and §11 gain Ein Qasab, the winter interlude town, and §11's stale `debrief` clause is dropped (2026-10-31); §11's twist clause reconciled with storyline D18, civilians in danger in play (2026-11-18)
@@ -426,4 +426,8 @@
 **The level carries story twists.** Missions may turn the plot inside the level
-— a kidnapped civilian killed, a soldier abducted — where the declarative
-vocabulary can express it, and the vocabulary is extended where it cannot; no
-mission is ever scripted in code.
+— people led away under fire and caught before the edge of the map, a soldier
+taken from his post — where the declarative vocabulary can express it, and the
+vocabulary is extended where it cannot; no mission is ever scripted in code.
+The enemy may be seen endangering civilians only in the ways
+`docs/campaign/storyline.md` D18 lists, and only adults; nothing done to anyone
+taken is ever shown, and the story voice names a number, never a method.
@@ -420,2 +420,2 @@  (optional)
 **One villain per front.** Each campaign — the Marj, Sur, Naharin — introduces
-an arch-terrorist through an atrocity in its opening mission, keeps him present
+an adversary through an atrocity in its opening mission, keeps him present
```

No §5 or §7 line is touched. §2 needs nothing: its doctrine rule already covers D18's
*each front's own enemy*.


---

## 11. The breach pilot: level script (re-derives sections 6 and 10.1)

**Date:** 2026-11-18 · **Status:** proposal for `mission-author` and the RL worker. **Written against** `a0a6ecce7` (the worktree HEAD after the lead's rulings; D18 is in `storyline.md:53`). Nothing here is written into `data/`. The pilot is `beit_sahwan_breach` (Q2), Option A, adults only (Q1), the Ashwar on the Marj (Q3). The recommended sub-variant is **Q11-KEEP** (§9.7): the villages' counted **eleven** stay, the **89** more are the road. Q11-RESTATE is a diff at the end of §11.1. Status words as §10: `live` / `schema` / `engine` (E-numbers are §10.2's, with the changes §11.4 records as N32 onward).

**What I ran, on the real sim and runtime.** `tools/dist/scratch/breach_pilot.ts` (gitignored under `dist/`; run with `tools/node_modules/.bin/tsx`). It builds the world the way `tools/src/backtest/fl_ladder.ts` does (`fl_ladder.ts:35-91`), from the shipped `beit_sahwan_breach.json` edited to the §11.1.8 fragments, and **emulates what does not exist yet outside the sim**: E1 (two 1x2 gates in the shipped gaps, opened and shut each tick by a runner-side state machine over the public `removeStructure` / `addStructure`, the §2.3 rule: side-0 ground, surface, standing, within 4 tiles, 3 s hold, 2 s swing, never shut on an occupant) and E3 (the primary's count is patched to village civilians only). **Not emulated:** E6 (no cell fires on a civilian), E8, E5 (the 240 s orders have no zone filter). Everything below that says "measured" is this runner, 30 seeds (`424242` and 1 to 29) unless it says 100; the baseline it reproduces: the **shipped** mission passive 0/2 `defeat:{objective:evac_settlements}` at 269.9 s, `shipped_plan` 2/2 victory at 299.9 s, as `fl_ladder.ts` prints (`passive 0/3`, `optimal 3/3` at 5.00 min, run 18 Nov). Also run: the `jsonschema` check (0 errors with engine fields stripped; with them the schema refuses `group` on an objective and **silently accepts** `fires_on_civilians` on a wave unit, V21) and the repository's `removeTriggerFailures`, `triggerLabelFailures`, `narrativeTextFailures`, `timeLimitFailures` (0 failures on the §11.1.8 mission; 5 on a copy with a 49-character label, `time_limit_s` 320 and a `remove` of an undeclared group). **Not run:** `pnpm validate:data`, `walk_placements.ts`, `pnpm playtest`, the vitest files named in §11.4.

### 11.0 What I read in addition to §10.0

| # | claim | source read | result |
|---|---|---|---|
| V19 | the shipped breach | `data/missions/beit_sahwan_breach.json`: `target_minutes` 5, `time_limit_s` 600, `start_layout: authored` (6-8); objectives `survive_relief` (survive_until 300, `clock: false`) and `evac_settlements` (evacuate_before `compound`, count **2**, seconds **270**) (123-152); 7 `fence` runs (153-231); 11 civilians in group `families` (232-272); 7 garrison placements `ring_nw/ne/sw/se` (273-333); 6 waves (334-459), wave 0 at 18 s `to compound_centre` carrying one cell each from `raid_nw raid_n raid_ne raid_w raid_e` (357, 362), later `raid_w` entries at 160 s and `raid_e` at 250 s; 5 triggers (460-543), of which `the_ring_closes` is the `remove families` at 272 s | the starting point of the diff |
| V20 | the map | `data/maps/marj_perimeter.json`: `=` wall x 17-31, y 16-30; **gaps (17,21), (17,22) west and (31,24), (31,25) east**; road row 23 from both edges; markers `compound_centre` (24,23), `civ_refuge` (24,26), `wounded_evac` (23,27), `raid_nw (4,3) raid_n (24,2) raid_ne (42,3) raid_e (43,26) raid_se (42,43) raid_s (24,43) raid_sw (4,43) raid_w (2,26)`, `families_nw (12,18) ne (35,18) sw (12,27) se (35,27)`; zones `compound` [18,17,13,13], `clinic`, `outpost_ground`. No versus file exists for it (`data/versus/` holds `milh_flats_l rujm_sawda tel_marum wadi_tarfan wadi_tarfan_l` and `modes`) | the compound zone starts at x=18, so both gates (x=17, x=31) are **outside** it: a person is counted the first tile past the gate |
| V21 | a wave unit cannot carry a flag today | `mission.schema.json` wave `units.items` has `required [unit, count]` and **no** `additionalProperties: false`; `stepWaves` passes only `{unit, count, marker: u.from, group, tag}` to `spawnPlacement` (`mission.ts:4668-4671`) | a `fires_on_civilians` on a wave unit validates and is **dropped**: E6 must add the schema property **and** the passthrough |
| V22 | the passive precedent | `tools/src/first_light_fence.test.ts:470-483` pins the control: `defeat`, `evac_settlements` failed, `survive_relief` active, objective ids exactly `['evac_settlements','survive_relief']`; its header (1-60) records that a wider stand-off once made the control **win** because corner civilians crossed `CIV_FLEE_AT` and walked to `civ_refuge` through the open gaps; `fl_ladder.ts:18-20` records 0/100 | the leak this pilot closes with gates |
| V23 | unit coordinates are exact | `starting_force` `at` values are used as given (integers are tile corners, not centres); gate centres (17.5, 22.0) and (31.5, 25.0). Nearest ground unit: `at_team` (22,23) is **4.61** tiles from the west gate, `at_team` (27,23) **4.92** from the east, `inf_squad` (21,18) 5.32, (27,28) 5.41 | thin (0.61) but held: 0 gate openings in the 30-seed passive runs |
| V24 | shared pins around the mission | `LADDER_CREDITS = 8093` (`playtest.ts:4026`); breach is the head of the ledger chain `led0` (`playtest.ts:141`) and "mission 1, unconditionally" (3577-3580); `min_win_seconds.json` breach 74 = floor(fastest win / 4) (`plan-sweep.ts:171-206`); overlay census `[172, 211, 269]` and `waves[0].at_seconds` 18 -> 3 (`overlays.test.ts:107-116`); `civ.settlements_evacuated` is produced as the **global** `evacuatedCount` (`mission.ts:5019`) and read by nothing but the ledger shape (`ledger-shape.ts:97`) | §11.4 |
| V25 | what a gate in `structures[]` costs | `raiseMissionStructures` (`mission.ts:3769-3823`) raises a non-per-tile type over `size` as one body and refuses an overlap with a building. The gap tiles are `.` in the grid, so **both gates are mission data and the shared `marj_perimeter` grid is not edited** | the fence test, versus, sandbox anchors and the backdrop do not see a gate |

### 11.1 The level script (Q11-KEEP)

#### 11.1.1 Shape and numbers

| layer | who | at t=0 | counted by | canon |
|---|---|---|---|---|
| the villages | groups `families_nw/ne/sw/se` (3, 3, 3, 2 = **11**) | the four shipped spots | primary `evac_settlements`, **count 2, group-scoped (E3)** | *eleven, two in, nine not* (unchanged) |
| the road | groups `road_w` (45) and `road_e` (44) = **89** | outside each gate, on the road: west x 2.5 to 9, y 19.5 to 28.25; east x 40.5 to 47, y 19.5 to 28 | new secondary `road_in`, count **50** of 89, 270 s, group-scoped, `clock: false`, never `carries` | uncounted in canon |
| the gates | two `compound_gate`s (E1) in the gaps | shut | | "two gates, both on the road" |
| the cells (T1-A) | the wave-0 cells from `raid_w` and `raid_e`, `fires_on_civilians` (E6) | spawn at 18 s | | the Ashwar by doctrine: cells on the approach |
| the walk-back (T2-A) | the four `ring_*` corners and the four village groups, ordered to their raid marker at 240 s | | | *"not walking back empty"* |
| the taking | the shipped `remove`, one per village group, `zone corner_*`, 272 s | | | *taken, back across the line* |

Authored entities: **143** = 9 force + 100 civilians + 7 garrison + 27 wave bodies (script count; the shipped total is 54, and 54 - 11 + 11 + 89 = 143). No wave body is added: the cells **are** the shipped wave-0 entries.

#### 11.1.2 Map requirements (`data/maps/marj_perimeter.json`: markers and zones only, no grid edit)

| name | kind | value | purpose | on the map today? |
|---|---|---|---|---|
| `gate_apron_w` | marker | (15,22) | the west muster, 2.06 tiles from the gate centre, outside `compound` | new |
| `gate_apron_e` | marker | (33,24) | the east muster, 2.06 tiles from (31.5, 25.0) | new |
| `village_nw` | zone | [8,16,8,7] | E5 filter for the 240 s families order | new |
| `village_ne` | zone | [33,16,10,8] | same | new |
| `village_sw` | zone | [6,25,10,6] | same | new |
| `village_se` | zone | [33,25,10,6] | same | new |
| `corner_nw/ne/sw/se` | zones | [0,0,12,10], [36,0,12,10], [0,38,12,10], [36,38,12,10] | the `remove` zones at 272 s (each contains its `raid_*` marker) | new |

Zone names avoid `sandbox-extras.ts:22`'s `PROTECTED_ZONE` pattern (`clinic|hall|refuge|hospital|school`). Any digest over `data/maps/*.json` (`content-manifest.ts` is generated) is **UNREAD**. The fences at x=16 (y 17-20, 24-29) and x=32 (y 17-22, 26-29) leave a 3-tile funnel in front of each gate; the aprons sit in it.

**The crowd** (rows of 3 at 1.25 spacing; every body spawned through the real `assertGroundClear` in the runner, so clear): west bases (2.5,19.5) x11, (6.5,19.5) x11, (2.5,24.5) x11, (6.5,24.5) x12; east bases (44.5,19.5), (40.5,19.5), (44.5,24.5), (40.5,24.5), x11 each. Walks to the apron are 10 to 14 tiles west and 7 to 13 east (script, fences and walls in): **arrival 9 to 18 s** at 0.8 t/s, so the last of them reach the apron as the cells appear at 18 s. Two tiles are shared by harmless overlaps with `families_sw`.

**Start-force margin.** 4.61 tiles to the west gate is the thinnest (V23). The lever, if the lead wants 1.5 tiles: `at_team` (22,23) -> (21,23) (5.61). It is a `starting_force` edit to a pinned mission (§11.4 P7).

#### 11.1.3 ECA rows (KEEP)

| event | IF | THEN | cue bound (§9.7) | status |
|---|---|---|---|---|
| Start | mission start | title, dispatch, 6-beat briefing; crowd in place | `title`, `dispatch`, `brief` | live |
| `the_road_runs_west` | `timer_s` 2 | `withdraw_to` `road_w` -> `gate_apron_w` | toast *The road runs for the west gate*; radio Idit | live (measured: the road stands at the aprons by about 18 s) |
| `the_road_runs_east` | `timer_s` 2 | `withdraw_to` `road_e` -> `gate_apron_e` | toast *The road runs for the east gate* | live |
| Gates | a ground side-0 unit within 4 tiles of a gate centre / none for 3 s and nobody in it | open / shut; events | audio | **engine E1, E2** |
| Shepherd | a ground side-0 unit within 4 tiles of a civilian | the flight rule orders him to `civ_refuge` (V7) | none | live |
| Arrivals | `evacuated` | `evac_settlements` counts village arrivals, `road_in` road arrivals; the yard clears them | toast `clear (n)` | **schema E3**; coalescing **E4** |
| Cells fire | a wave-0 `raid_w` / `raid_e` cell has a civilian in reach and no KDF target | the crowd's rear and flank rows fall | radio Idit (first fire) | **engine E6**; the cue **E7** |
| Wave 0, 120, 160, 205, 250 | shipped | shipped | shipped lines | live (unchanged) |
| `villages_rise`, `they_take_the_south_village`, `they_come_for_the_west_families`, `the_last_village_goes` | shipped | `commit` the corners to their villages | shipped | live (unchanged) |
| `corner_walks_back_{nw,ne,sw,se}` | `timer_s` 240 | `withdraw_to` `ring_*` -> `raid_*` | toast *The north-west corner walks back* (x4); radio Idit on the first | live |
| `families_walk_{nw,ne,sw,se}` | `timer_s` 240 | `withdraw_to` `families_*` -> `raid_*`, **`zone village_*`** | toast *The north-west families walk with it* (x4) | **engine E5**; without the zone: live with the early-rescue hazard (§10.1.1, P4) |
| `the_ring_closes` (+`_ne`, `_sw`, `_se`) | `timer_s` 272 | `remove` `families_*`, `zone corner_*` | radio Idit on the first; chrome `taken (1)` | live |
| `evac_settlements` / `road_in` done or failed | counts, 270 s | `say` / `say_on_fail` | shipped / §9.7 | live / **schema E3** |
| End | victory / defeat | `aftermath` (new field), `debrief` | §9.7 | live |

The eight 240 s orders are eight labelled triggers (a trigger moves one group, and a non-`remove` trigger must carry a label): up to eight feed lines on one tick. The labels above are mine, for `narrative-designer` (N39). **E8** collapses them to four and lets the captives follow.

#### 11.1.4 AI director

| t (s) | what | group | size | from | to |
|---|---|---|---|---|---|
| 0 | crowd in place | `road_w`, `road_e`, `families_*` | 89 + 11 | §11.1.2 | |
| 0 | ring corners in ambush (shipped) | `ring_nw/ne/sw/se` | 2, 2, 2, 1 | the four corners | |
| 2 | the run | `road_w`, `road_e` | 45, 44 | | `gate_apron_w`, `gate_apron_e` |
| 9 to 18 | the road arrives at the aprons | | | | |
| 18 | wave 0 (shipped), the `raid_w` and `raid_e` cells flagged | | 5 + 3 | the raid markers | `compound_centre`, `assault_sw` |
| first contact | `ring_ne`, `ring_se` commit to their villages (shipped) | | 2, 1 | | `families_ne`, `families_se` |
| 120, 160, 205, 250 | shipped waves | | 4, 4, 7, 4 | | |
| 150, 190 | `ring_nw`, `ring_sw` commit (shipped) | | 2, 2 | | `families_nw`, `families_sw` |
| 240 | the walk-back | rings and families | | villages | raid markers |
| 270 | `evac_settlements` and `road_in` deadlines; `survive_relief` ends at 300 | | | | |
| 272 | the taking: `remove` per village group inside its corner zone | | | | |

**Stances.** Unchanged for all 7 garrison placements (ambush 4 or 3 tiles; the corners spring on the villages). The wave units have no stance (they attack-move and sweep). The only new behaviours are two flags and orders.

**Pressure curve.** The mission is one hold with two clocks. The road arrives in 9 to 18 s and **waits at two gates that shut**; from 18 s two cells close from the edges and, with E6, shoot the crowd's rear while nothing of ours is in reach; the waves converge on the compound and, as shipped, **cut the blind faces** (3 wall tiles lost a run, measured). A unit within 4 tiles of a gate opens it, and the crowd within 4 tiles of him follows: two keepers parked at the aprons clear 58 people by 24 s (measured), so the road's difficulty is the fire and the opened gate, not the walk. At 240 s the corners walk the remaining villagers off with their escorts; at 272 s whoever is still with them is taken. Restraint is the Lavi's gun and the mortar near the aprons (3 Conduct a shot).

#### 11.1.5 Objectives, ROE, clocks, stars

| id | type | P/S | numbers | note |
|---|---|---|---|---|
| `survive_relief` | survive_until | P | 300 s, `clock: false` | shipped |
| `evac_settlements` | evacuate_before `compound` | P | count **2**, 270 s, **`group: [families_nw, families_ne, families_sw, families_se]`** (E3) | text and lines shipped; the count is **canon** |
| `road_in` | evacuate_before `compound` | S | count **50**, 270 s, `clock: false`, `group: [road_w, road_e]` (E3) | text and `say` §9.7 |

- **Time.** `target_minutes` 5, `time_limit_s` **600** unchanged (= 2 x 5 x 60, the floor; 270 + 60 = 330 and 300 + 60 = 360 are inside it). Every measured win ends at 299.9 s (the hold), so `pnpm playtest`'s margins hold: 600 - 300 = 300 s >= 120 s and 600 / 300 = 2.0 >= 1.2.
- **ROE.** `roe: { "enabled": true }` unchanged, no `fail_below`, no `flagged_zones`; defaults: 8 per civilian the player kills, 3 per heavy shot (collateral >= 0.5: `gun_120`, `mortar_60`) within 2 tiles of a civilian, +3 per wounded civilian the medics admit (cap +10); enemy-caused deaths cost nothing (V8). Measured Conduct 100 on every run that printed it (passive, shipped plan, parked, keepers; no heavy fire near a civilian in these plans; E6 absent).
- **Stars.** 1 victory; 2 Conduct >= 70; **no third star** (no `carries`), as shipped (`playtest.ts:141` expects 2).
- **No intercept objective.** A scored objective for the walking villagers would make "two came in" false. The intercept is the player's choice and is not counted; the shepherd rule frees whoever he reaches.

#### 11.1.6 Q11-RESTATE: the diff

| field | KEEP | RESTATE |
|---|---|---|
| villages | 4 groups, 11 | 4 groups of **10** (`count` 10 each, same four `at`s; each is a 3 x 4 block, check `assertGroundClear` east of x 37.5 and south of y 27.5) |
| road | 89 (45 + 44) | **60** (30 + 30: three placements of 10 each side, bases (2.5,19.5), (6.5,19.5), (2.5,24.5) / (44.5,19.5), (40.5,19.5), (44.5,24.5)) |
| `evac_settlements.count` and text | 2, *two families* | **10**, *Get ten people inside the wire before the ring closes* |
| `road_in.count` and text | 50, *fifty people* | **35**, *thirty-five people* |
| entities | 143 | 143 (54 - 11 + 40 + 60) |
| strings | §9.7 KEEP | §9.7 RESTATE table, plus `wadi_halam_4_village` `say_on_fail`, `storyline.md` §1 / §2.1(3) / §2.3, `world.json` `taken` |
| E-pieces | as KEEP | as KEEP; the pins in §11.4 are the same, plus the downstream strings |

#### 11.1.7 Twists

| id | proposal | class |
|---|---|---|
| T-a | the gate shuts on the Ashwar: a unit that follows the crowd in holds the gate open behind it (E1: nothing may stand in the gate) | engine E1 |
| T-b | the walk-back caught short: reach a village before 240 s, or follow the column to the corner before 272 s (the shepherd rule frees at 4 tiles) | live (P4 probes it) |
| T-c | the run starts at 18 s with the cells instead of at 2 s: `RUN_AT=18` measured on 8 seeds, two keepers' 50th arrival moves from 24 s to 40 to 234 s (one seed late), the full plan to 38 to 49 s | expressible today (`timer_s` 2 -> 18) |

#### 11.1.8 Copy-ready fragments (KEEP)

Field names are the schema's; engine-only fields carry `/* E# */` and are **not valid JSON** until the piece lands. The assembled scratch mission validated as in the preamble. `mission-author` assembles, then runs `pnpm validate:data`, `walk_placements.ts`, `walk_mission.ts`.

`structures` (append to the seven fences; a gate in the shipped gaps):

```json
[
  { "type": "compound_gate", "at": [17, 21], "size": [1, 2] },
  { "type": "compound_gate", "at": [31, 24], "size": [1, 2] }
]
```

`civilians` (replace; the `families` group is split so each village can be ordered):

```json
{
  "refuge": "civ_refuge",
  "groups": [
    { "unit": "civilians", "count": 3, "at": [10.5, 18.5], "group": "families_nw" },
    { "unit": "civilians", "count": 3, "at": [37.5, 18.5], "group": "families_ne" },
    { "unit": "civilians", "count": 3, "at": [9.5, 27.5], "group": "families_sw" },
    { "unit": "civilians", "count": 2, "at": [37.5, 27.5], "group": "families_se" },
    { "unit": "civilians", "count": 11, "at": [2.5, 19.5], "group": "road_w" },
    { "unit": "civilians", "count": 11, "at": [6.5, 19.5], "group": "road_w" },
    { "unit": "civilians", "count": 11, "at": [2.5, 24.5], "group": "road_w" },
    { "unit": "civilians", "count": 12, "at": [6.5, 24.5], "group": "road_w" },
    { "unit": "civilians", "count": 11, "at": [44.5, 19.5], "group": "road_e" },
    { "unit": "civilians", "count": 11, "at": [40.5, 19.5], "group": "road_e" },
    { "unit": "civilians", "count": 11, "at": [44.5, 24.5], "group": "road_e" },
    { "unit": "civilians", "count": 11, "at": [40.5, 24.5], "group": "road_e" }
  ]
}
```

`objectives` (the shipped `evac_settlements` gains `group`; `road_in` is appended):

```json
[
  { "id": "evac_settlements", "type": "evacuate_before", "primary": true, "target": "compound", "count": 2, "seconds": 270,
    "group": ["families_nw", "families_ne", "families_sw", "families_se"] /* E3 */,
    "text": "Get two families inside the wire before the ring closes",
    "say": { "speaker": "shai", "text": "Two in. Get the gate shut behind them." },
    "say_on_fail": { "speaker": "idit", "text": "The ring is closed. Whatever is still outside it is outside it." } },
  { "id": "road_in", "type": "evacuate_before", "primary": false, "target": "compound", "count": 50, "seconds": 270, "clock": false,
    "group": ["road_w", "road_e"] /* E3 */,
    "text": "Get fifty people off the road and inside the wire",
    "say": { "speaker": "shai", "text": "Fifty in off the road. The gate shuts when the last of them is through, not before." } }
]
```

`enemy.waves[0].units` (the two road cells; every other entry and every other wave unchanged):

```json
[
  { "unit": "militia_cell", "count": 1, "from": "raid_w", "fires_on_civilians": true /* E6: wave-unit schema property AND stepWaves passthrough */ },
  { "unit": "militia_cell", "count": 1, "from": "raid_e", "fires_on_civilians": true /* E6 */ }
]
```

`triggers` (append after `they_take_the_south_village`, `they_come_for_the_west_families`, `the_last_village_goes`; **replace** the shipped `the_ring_closes`). The two road triggers and the first of each family of four are shown; the others differ only in the corner (`ne`, `sw`, `se`) and the labels *The north-east / south-west / south-east corner walks back* and *... families walk with it*:

```json
[
  { "id": "the_road_runs_west", "label": "The road runs for the west gate",
    "on": { "kind": "timer_s", "value": 2 },
    "do": { "kind": "withdraw_to", "group": "road_w", "to": "gate_apron_w" },
    "say": { "speaker": "idit", "text": "Both roads are running for our gates, west and east. Their cells are coming in along the same roads, and nothing of ours is out there yet." } },
  { "id": "the_road_runs_east", "label": "The road runs for the east gate",
    "on": { "kind": "timer_s", "value": 2 },
    "do": { "kind": "withdraw_to", "group": "road_e", "to": "gate_apron_e" } },
  { "id": "corner_walks_back_nw", "label": "The north-west corner walks back",
    "on": { "kind": "timer_s", "value": 240 },
    "do": { "kind": "withdraw_to", "group": "ring_nw", "to": "raid_nw" },
    "say": { "speaker": "idit", "text": "The corners are walking back the way they came, and they are not walking back empty." } },
  { "id": "families_walk_nw", "label": "The north-west families walk with it",
    "on": { "kind": "timer_s", "value": 240 },
    "do": { "kind": "withdraw_to", "group": "families_nw", "to": "raid_nw" /* + "zone": "village_nw"  E5 */ } },
  { "id": "the_ring_closes",
    "on": { "kind": "timer_s", "value": 272 },
    "do": { "kind": "remove", "group": "families_nw", "zone": "corner_nw" },
    "say": { "speaker": "idit", "text": "The ring is closed. The villages are across their line now, and so is everyone we did not reach." } },
  { "id": "the_ring_closes_ne",
    "on": { "kind": "timer_s", "value": 272 },
    "do": { "kind": "remove", "group": "families_ne", "zone": "corner_ne" } }
]
```

The `_sw` and `_se` removes follow the same shape. The `starting_force` placements need **no** `group` (no trigger reads one). `enemy.garrison`: unchanged. `waves`: only the two flags. `ledger`: unchanged (`civ.settlements_evacuated` is still produced; E3 should scope it to the primary's groups, N32).

### 11.2 The passive-player loss proof

**Claim.** A player who gives no orders loses on the **primary** `evac_settlements` failing at its own 270 s deadline, on every seed, with `survive_relief` still running and the 600 s limit never reached. A player who sends everyone out on a naive attack-move **wins** the canon primary (as shipped) and loses the secondary and, under E6, the crowd it walks past.

**Argument.**
1. *The villages need a soldier.* A village civilian moves only when suppressed above `CIV_FLEE_AT` or when a ground side-0 unit is within 4 tiles (V7). The ring corners do not frighten them (they walk to the houses; V19), and nothing of ours is near: the nearest force unit to any village is at least 10.5 tiles (script).
2. *The gates need a soldier.* The nearest ground unit to either gate centre is 4.61 and 4.92 tiles (V23): shut. A crowd member who flees from suppression walks to `civ_refuge`, which is unreachable, and presses the wall with `moving 1` (V5).
3. *The road is not the primary.* `evac_settlements` counts village people only (E3). The enemy's breaches (below) let some of the road in, and that cannot complete it.
4. *The leak that remains is the enemy's own breach.* The waves cut the blind faces (shipped; the briefing says so). Three wall tiles fall a run; the opened yard then admits part of the road.

**Executed** (`breach_pilot.ts`, real sim and runtime, gates and E3 emulated, 30 seeds unless stated):

| run | win | ends | village people in (mean, min..max) | road in (mean, min..max) | notes |
|---|---|---|---|---|---|
| **passive**, pilot | **0/30** (0/100 on seeds 424242 and 1 to 99) | `defeat:{objective:evac_settlements}` at 269.9 s, 30/30; `survive_relief` active, `road_in` failed | 0.3 (0..1; **max 1 of the 2 needed**) | 28.3 (10..35); 0 by 60 s and 120 s, 0.4 by 180 s, 18.6 by 240 s | gates never opened (0.0); wall tiles lost 3.0; peak entities 170 |
| passive, **E3 off** (global count) | **30/30 victory** | the road's leak satisfies the primary | | | the mutation that turns the proof red: E3 is a hard precondition |
| passive, gates absent (shipped gaps open), E3 on | 0/30 | `defeat:{objective:evac_settlements}` | 0.0 (max 0) | 24.9 (16..33); 3.6 by 60 s, 13.6 by 120 s | the gaps leak the road from 60 s (suppressed civilians walk in); the gates hold it to 0 until 180 s |
| parked, one squad at the west apron | 0/30 | `defeat:{objective:evac_settlements}` | 0.3 | 37.5 | a keeper alone saves road people, not the canon primary |
| parked, one squad at each apron | 0/30 | same | 0.2 | **58.7**; the 50th at **24 s on 30/30 seeds** | `road_in` is a 24 s job for two squads (N43) |
| **naive attack-move**, all ground units to (4,23) at t=0 | **30/30** | victory 299.9 s | 6.0 | 43.8 (west 41.0, east 2.9); the 50th never | wins the primary; `road_in` fails; the east crowd (about 41) and 5 villagers are left; no Conduct cost (no E6 yet) |
| naive attack-move, split west / east | 30/30 | victory | 7.9 | 85.0; the 50th at 20 s | units passing the aprons shepherd the whole crowd |
| shipped plan (jeep and APC to the west villages, home at 45 s) | 30/30 | victory 299.9 s | 6.0 (6..6) | 51.3 (48..54); the 50th at 89 to 221 s, 3 seeds never | `road_in` met on 27/30 |
| shipped plan + two keepers at the aprons at t=2, two more at t=30 | 30/30 | victory | 6.7 | **79.7**; the 50th at 23 s | KDF entities lost 14.4 against 3.9 |

Peak living entities across all runs: **180** of 256; distinct flow fields at 2 s: **89 to 98**; worst tick (sim plus mission) **18.5 ms** on this machine (the old mission: 1.6 to 7.0 ms), against the 50 ms budget.

**What the proof does not cover.** E6 and E8 (the cells never shoot, the column never follows); the runner opens a gate after the tick, not between commands and movement; the walk-back has no E5 zone; `fl_ladder`'s four tiers were not re-run on the edited mission; the 18 s `RUN_AT` variant ran on 8 seeds. The margin on the passive control is **one village person** on the worst of 100 seeds (the shipped control's margin is the full two): a 1000-seed sweep belongs in `passiveAcrossSeeds`' neighbourhood before this ships.

**Numbers the playtest must print** (per seed and as a table, A only; the shipped lines stay): ends and cause, `defeatCause`; village people in, road people in at 60, 120, 180, 240 and 270 s; time to the 2nd village person and to the 50th and 80th road person; civilians downed, killed (by side) and taken; wall tiles destroyed and the tick of the first; gate transitions, ticks open, and who stood within 4 tiles; first tick a `raid_w` / `raid_e` cell fires on a civilian; Conduct at the end and minimum; the number of heavy-shot deductions; KDF losses; peak and lifetime `entityCount`; flow fields at 2 s; worst tick ms; `first_contact` tick; stars. **Controls to add to `passiveAcrossSeeds`:** `defeat` on every seed with zero `evacuated` village events and zero gate openings (mutation: point `gate_apron_w` at (20,22), inside `compound`, or switch E3 off: the control must go red); the two parked controls and the naive attack-move as reports; the early-rescue probe P4 (a unit to a village at 20, 60, 100, 230 s; without E5 it must go red at 20 to 230 s because the 240 s order turns a freed, still-outside villager round).

### 11.3 What the pilot needs from E1 to E15, and what is data first

| E | what the breach needs from it | size |
|---|---|---|
| **E1** gate | two `compound_gate` entries in `structures[]` (V25); `validate:data`'s versus rule is moot (no versus file for the map); the audit of the `structureOfTile` readers matters more here: the **shipped enemy waves breach the walls** and path through the gaps, and an open gate must not read as a wall to them | M |
| **E2** presentation | the huge yellow gates (the lead's words); Q8, Q10 | M + art |
| **E3** group count | **hard precondition**: without it the passive control wins 30/30. Needs `group` as **`string` or `string[]`** (the villages are four groups so each can be ordered), and `collect` scoped to the groups of **active** objectives, so a village person who walks in after the primary is complete is not counted (that keeps *"Two came in"* an accounting fact, as shipped; N32); `civ.settlements_evacuated` scoped to the primary's groups | S |
| **E4** feed | about 100 `clear (1)` lines in 30 s without it | S |
| **E5** zone filter | the four `families_walk_*` orders; without it the early-rescue hazard (§10.1.1) | S |
| **E6** civilians as targets | **wave-unit** schema property and `stepWaves` passthrough (`mission.ts:4668-4671`, V21) as well as the placement field; only the two flagged entries; the cue **E7** | M |
| **E7** `group_fired` | two cue rows (cells firing; a hostile unit entering `compound` while a gate is open); optional | S |
| **E8** `abduct` | optional: halves the eight 240 s triggers and lets the villagers follow their corner | M |
| **E9** crowd perf | measured: 89 to 98 flow fields at 2 s (the 100 `withdraw_to` slots), worst tick 18.5 ms, 100 people at the aprons; the render curve (Q5, N22) is the open measurement | S |
| **E10** entity budget | 143 passes (<= 160); measured peak 180 of 256 | S |
| **E11** harness | the pins and controls of §11.2 and §11.4 | S/M |
| **E12** wounded count as saved | optional | S |
| **E13** validators | muster outside `compound` (the aprons at x=15 and 33 are); the force-to-gate rule at **5** tiles fails at 4.61 and 4.92: either relax it to 4.5 or move one `at_team` (11.1.2) | S |
| **E14** adults only | **mandatory under D18** for a hundred people under fire (G-16); `civilians.figures: "adults"` | S |
| **E15** capacity | decision: stay at 256, authored 143, peak 180; a runtime `reinforce` or wave is skipped whole if it would not fit (V11), which the Easier relief at 90 s would hit only past 254 | S |

**Data first (today).** Nothing about the road can ship before E3: adding the road crowd to the mission as it is makes the passive control win (measured, E3 off 30/30). Order: **E10, E13, E3** (S) -> the road crowd, the two run triggers, the `road_in` secondary, the removes with zones, the walk-back (S0: gaps open, passive 0/30, the road leaks 24.9) -> **E4** -> **E1, E2** (the gates; S2) -> **E5** -> **E6, E14, E7** -> E8 if wanted. The 143-entity budget against 256: 143 authored, 180 peak over 30 seeds of seven plans (37 wounded and rejoined bodies at most), so about 76 left; civilians shot under E6 spawn nothing (`wounds.in_place`), so E6 does not eat the margin; the 160 rule passes.

### 11.4 What this supersedes, notes, and the pins a change moves

**Superseded by §11 (by heading).**
- §6 *The pilot: `beit_sahwan_1_recon`*: all of it (the map variant `beit_sahwan_1`, the compound, the 88 + 12 crowd, the `fl_north` and `takers` cells, the objectives 55 / 85 / 8, the margins, the stars, the assets). Recon stays an ordinary Marj recon mission.
- §10.1: 10.1.2 (map `beit_sahwan_1`), 10.1.3 (flags), 10.1.4 and 10.1.5 (ECA rows, A and B), 10.1.6 (director), 10.1.7 (objectives and clocks), 10.1.8 (levers), 10.1.9 (slices) and 10.1.10 (fragments). **Still valid:** 10.1.1 (N2: the order of the civilian rule and the triggers, the early-rescue hazard and E5) and §10.0, §10.2, §10.3.
- §10.4 *Playtest asks*: the recon table P0 to P5 (replaced by §11.2); the method stands.
- §3.2 rows 2 and 3 (breach 40 / 10, recon 100) and §7 Q11's "re-state it" recommendation (§9.6 N5 and §9.7 recommend KEEP; so does this).
- §9.2 *The pilot: `beit_sahwan_1_recon`* (recon strings, kept as a record per §9.7).

**Notes (N32 onward; earlier sections not edited).**

| # | where | note |
|---|---|---|
| N32 | §10.2 E3 | `group` must take **a string or an array of strings** (the villages need four group names to be ordered one by one) and `collect` must be scoped to the groups of **active** evacuation objectives. Otherwise the road secondary keeps the yard collecting, every village person who walks in is counted (6 of 11 on every measured winning plan, 6.0 to 7.9) and *"Two came in"* is false on the player's own tally |
| N33 | §10.2 E13(b), §10.1.2 | the 5-tile rule meets authored margins of 4.61 and 4.92 (V23: `at` is exact, not a tile centre; §10's recon distances added 0.5 to tile corners where the layout is `assembly`, which is correct there, and wrong for an `authored` layout) |
| N34 | §10.1.1 | confirmed on the breach: the shipped no-zone `remove families` at 272 s is the pattern that takes a freed villager; the pilot uses a zone per village |
| N35 | §10.2 E6 | wave units need the schema property **and** the `stepWaves` passthrough; today the key validates and is dropped (V21). Add a `validate:data` refusal until it lands |
| N36 | §10.2 E1, §10.1.2 | V25: gates in `structures[]` mean `marj_perimeter.json`'s grid, the fence test's `BASE`, versus, the sandbox anchors (`sandbox-anchors.pinned.json`) and the terrain fixtures are not touched; only markers and zones are added to the map file |
| N37 | §3.2 row 2 | superseded: 11 + 89, not 40; `compound` zone [18,17,13,13] and gaps (17,21-22), (31,24-25) verified |
| N38 | §10.5 N19 | the wall breach is **measured**, not hypothetical: 3.0 wall tiles destroyed a passive run, 28.3 of the road (max 35) reach the yard through them. It is harmless to the primary only because of E3 |
| N39 | §9.7 triggers | `the_corners_walk_back` is one row but needs eight triggers (or four with E8), each non-`remove` with a label: up to eight feed lines on tick 4800 |
| N40 | §9.7 objectives | `road_in` needs `clock: false` (two countdowns at 270 s otherwise); `first_light_clock.test.ts:38` pins `clockless` to exactly `['survive_relief']` |
| N41 | §9.7 briefing | six beats; `loading.test.ts:581` pins five |
| N42 | §9.7 | the cells' fire is not the only threat to the crowd: the waves breach the walls (N38), and an open gate is open to them (T-a) |
| N43 | §10.4 P1, §11.1.5 | `road_in` 50 is met by two parked squads at 24 s on 30/30 seeds; with E6 absent this is a floor on the difficulty, not the measure. Levers: count 65 (79.7 is the best measured), or the run at 18 s (T-c) |
| N44 | §9.7 *shape* | *"a civilian placed inside `compound` is collected on the first evaluation"* is true (`civilians.ts:258-281`); the run starts outside and arrives 9 to 18 s in, as the 18 s cells appear |

**The breach's pins and playtest-plan lines a change moves** (files and lines read this session; **UNREAD** where the body was not opened):

| # | pin | where | moves? | action |
|---|---|---|---|---|
| P1 | body census 27, 11 civilian | `first_light_fence.test.ts:222-228` | yes: 116 bodies, 100 civilian (9 + 7 + 100) | re-derive |
| P2 | per-body route table `SPAWN_WALKS` (11 keys), `walked` toEqual | `first_light_fence.test.ts:328-410` | yes: the test walks every civilian body; 89 are new | restrict to the village groups or extend |
| P3 | `afterSim` raises every `MISSION.structures` entry | `first_light_fence.test.ts:268-286` | yes: the closed gates sever every route into the compound (`severed by the fence`) and every wave route to `compound_centre` (`:413-447`) | skip `compound_gate` in `afterSim` |
| P4 | passive control: `defeat`, `evac_settlements` failed, `survive_relief` active, ids exactly two | `first_light_fence.test.ts:470-483` | ids change to `evac_settlements`, `road_in`, `survive_relief`; the rest **held** (executed) | update the id list |
| P5 | `clockless` == `['survive_relief']` | `first_light_clock.test.ts:38` | yes (`road_in` is `clock: false`) | `['road_in','survive_relief']`; the rest of the file **UNREAD** against the new mission |
| P6 | briefing beat count 5 | `loading.test.ts:581`; length 385-1225 at `evacuation.test.ts:110-111` | beat count yes (6); length holds (1,131) | 5 -> 6 |
| P7 | starting force positions | `start_layout.test.ts:228-241` (authored, moved 0); `challenges.test.ts:103-108` (`inf_squad` x4, slice of three) | no, unless `at_team` moves: still `authored`, order unchanged | none |
| P8 | locale overlays | `data/locales/en/missions.json`, `de/missions.json`; `locales_en.test.ts:207-221` (`wave_say.0`, `.2` keyed by index) | strings yes; the wave indices **hold** (no wave added or reordered) | regenerate `en`; `de` re-translate (AI-translated, unproofread) |
| P9 | the passive line | `playtest.ts:133` (`'defeat'`) | held (executed: 30/30) | add the controls of §11.2 |
| P10 | the winning plan line | `playtest.ts:141` (victory, 2 stars, `inf_medic_squad`, rescue counts `>= 1`) | victory and 2 stars held (executed); rescue counts **UNREAD** | re-run |
| P11 | `LADDER_CREDITS = 8093` | `playtest.ts:4026-4029` | **yes**: the breach is mission 1 of the chain (3577-3580) and its survivors, Conduct and clock feed every later `led*`; "one more body shifts every later entity id and so the wave streams" (3962-3970) | re-pin from CI numbers; diff every downstream line |
| P12 | `ROSTER_MAX` / `ROSTER_CAP` | `playtest.ts:3413` | possibly (survivor count) | re-run |
| P13 | `min_win_seconds` breach 74 | `data/accounts/min_win_seconds.json:3`, `plan-sweep.ts:171-206` | **held**: fastest win 299.9 s (floor 74) | `--min-win` to confirm |
| P14 | sweep margins | `plan-sweep.ts` 30 seeds, 120 s and 20% | **held**: 300 s and 2.0x | none |
| P15 | passive-intel report | `playtest.ts:4268-4274` ("ahead on 16 of 30", report-only) | possibly | read the line |
| P16 | postures | `overlays.test.ts:107-116` (`[172, 211, 269]`, `waves[0]` 18 -> 3), `posture-ladder.ts` | census **held** (no untagged wave body added); Harder puts the flagged cells at **3 s**, inside the crowd's start and before the run (2 s) has moved it; whether a grown entry keeps `fires_on_civilians` is **UNREAD** (`overlays.ts` extra entry) | run Easier and Harder (8 seeds) |
| P17 | challenge `thin_wire` (`lost_at_most 2`), `breach_no_jeep`, `no_medic` | `data/challenges/beit_sahwan_breach.json`; `challenge-reading.test.ts:28` (limit 600 **holds**) | winnability **UNREAD** | `playtest` challenge reading |
| P18 | the four-tier ladder | `fl_ladder.ts` (header numbers, `civilians in` histogram counts all `evacuated`) | tool, not a test; its histogram is meaningless with a road | re-label or scope |
| P19 | shared plans | `plans.test.ts:54, 69, 73` (regexes on `firstLightPlan`) | held if the plan is untouched; the plan wins 30/30 unchanged (executed) | none |
| P20 | alerts | `alert-world.test.ts:77-90` (two waves by 20 s), `:96-110` | held (no wave added) | none |
| P21 | unit roster | `mesh-catalogue.test.ts:274-312` | held (no new unit type) | none |
| P22 | determinism | `determinism.test.ts` pins | none for the breach itself; `GATE_WORLD_PIN` (E1) and a civ-fire pin (E6) are new | per §10.2 |
| P23 | `docs/campaign/beit_sahwan/design.md`, `narrative.md`, `script.md` | the breach's design and script | yes | `narrative-designer`, `mission-author` |

**The biggest risk to the canon (eleven, two, nine).** *Eleven* holds. *Two* and *nine* are **thresholds, not outcomes**: the sim lets a competent player bring in **six of the eleven** (6.0 on every measured winning plan, 7.9 on the split attack) and takes five, not nine. The shipped mission carries the same latent falsity and hides it by an accounting convention: the objective completes at two, `collect` stops, and the report says two. The pilot breaks that convention the moment a second evacuation objective (`road_in`) keeps the yard collecting; then the player's own tally reads six and Idit's *"Two came in"* is false in plain view. E3 must therefore scope `collect` to the groups of active objectives (N32), or `debrief.victory` must be rewritten to be true of every victory (for example *"Eleven were in the villages at first light. We had counted two when the count stopped."*, `narrative-designer`). A second, smaller risk is the passive control's margin: one village person on the worst of 100 seeds (§11.2).
