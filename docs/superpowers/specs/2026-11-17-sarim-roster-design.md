# The Sarim roster at fifteen types, with its own production menu (GH-1382): design and asset manifest

**Date:** 2026-11-17. **Issue:** GH-1382 (audit dimension D2, epic, size L). **Depends on:** GH-1381 ("Open Sarim on
every versus map and win mode, and in free play"). **Base:** `origin/dev` at `e049ba7`.
**Status: HOLD FOR LEAD.** This page is the design and the art numbers for the lead's approval. Nothing on it has been
built, rendered or bought.

- **No Meshy call was made.** Not a generation, and not `pnpm meshy -- estimate` either: every credit figure below is
  computed by hand from the CLI's own price table (`tools/src/meshy/pricing.ts`, quoted from the Meshy pricing page on
  2026-11-09) and from what comparable shipped assets actually consumed (`art/meshy/ledger.jsonl`).
- **No Blender render was made.** No portrait, gate render, look-dev or capture.
- **No file outside this page changed.** The three proposed unit files below are written out as data in §2. They were
  checked only in a scratch directory, against `unit.schema.json` and against `tools/validate_balance.py` with `--also`
  (§2.5). They are not in `data/units/` and not staged in `docs/campaign/special_units/`.

Every figure is **(M)**, measured on this tree, or **(R)**, reasoned. Each one is marked.

---

## 0. The answer in five lines

1. **Twelve of the fifteen already have art.** The Sarim menu (`data/doctrines/sarim.json`) lists 6 types today. The
   opposition roster has 6 more armed, buildable types that ship with a GLB, a catalogue entry and portraits, and that a
   versus room already registers: `technical`, `moto_rpg`, `rpg_team`, `militia_cell`, `mortar_crew` and `paramotor`.
   Adding them is one data edit, with no art.
2. **Three types are new:** `sarim_carrier` (**Tracked Carrier**, the armoured vehicle the issue asks for),
   `hmg_team` (**Heavy MG Team**) and `observer_team` (**Observer Team**). All three are priced on the fitted curve,
   within 1.3% of it (M, §2.5). They use no new schema field and need no engine change.
3. **The production menu is the doctrine menu.** It runs on the one camp line per end that `data/versus/<map>.json`
   already authors. It touches no `data/missions` file, so **D7 is untouched**. A second, role-filtered Sarim line is
   designed in §3.3 and **not recommended** now.
4. **Art: 70 credits planned, 200 ceiling (about $1.40 / $4.00 at the CLI's $0.02 a credit). About 25 Blender hours
   planned, 35 at the ceiling (R).** Only the carrier needs a new Meshy body. The two teams reuse a shipped Sarim figure.
5. **Fairness is the open gate.** Every KDF-v-Sarim economy cell will move, because the probe's Sarim buy rule reads
   the menu (§3.4). That re-read is parked behind GH-1381's ruling on `pnpm versus:probe`. One cell is already outside the
   bar on main (GH-990).

---

## 1. Today's Sarim roster

### 1.1 What "Sarim" means in the data

- **The seat's faction is `sarim`.** `data/doctrines/sarim.json` is its menu. The doctrine schema lets a `sarim` menu
  hold "any opposition unit (sarim, rif or ashwar faction)", and `validate:data` (`tools/validate_doctrine.mjs`) holds
  the rest:
  - every menu id is an opposition unit (`OPPOSITION_FACTIONS`);
  - no menu holds `loiter_drone` (LD3, `BANNED_MENU_UNITS`);
  - the Sarim budget is 1.6x the KDF's (`SARIM_BUDGET_RATIO` 8/5: 2400 against 1500, still `provisional`).
- **Menu today: 6 types**, in dock order: `sarim_rifles`, `atgm_cell`, `gun_truck` (a Rif unit), `manpad_team`,
  `rocket_battery`, `recoilless_team`. `pop_cap` is 56; the KDF's is 40.
- **The opposition fields 17 unit files** in `data/units/enemy/`: 8 of `faction: sarim`, 4 of `rif`, 5 of `ashwar`.
  Two of them are not buildable at all: `wounded_sarim` is shed by a squad, never bought, and `drone_swarm` is in
  `VERSUS_HELD_UNITS`.
- **A versus room registers every shipped unit except `VERSUS_HELD_UNITS`** (`packages/app/src/net/versus-roster.ts`),
  so all 15 non-held opposition types are already in every room's type table. A menu edit adds no registration and
  moves no type index.

### 1.2 The table

Key to the columns:
- **wheeled** is the value the sim resolves: the authored `mobility.wheeled`, else `!FOOT_ROLES.has(role)`.
  "(explicit)" marks an authored value.
- **.blend** means a TRACKED `.blend`. The Meshy-CLI teams have no `.blend` in git. Their source is the
  `art/meshy/<slug>/` task folder plus a code importer (`tools/units/import_meshy_crew_team.py` and its kin): the kit,
  rig and clips are code. Supplied Meshy web exports had their `.blend` in the gitignored `art/blend/`
  (`docs/ASSET_PROVENANCE.md`, "The supplied Meshy assets").
- **Catalogue** is the entry in `packages/app/src/mesh-catalogue.ts`, with its line number.
- **Portrait** is the entry in `assets/ui/portraits/units/manifest.json`. "team + lead" means the figure team also ships
  the one-figure chip variant that `portrait.test.ts`'s `FIGURE_TEAMS` requires.
- **Clips** are read from each GLB's glTF JSON chunk (M).

| id | name | faction | role | logistics / build s / pop | wheeled | GLB | .blend (tracked) | Catalogue | Portrait | Clips | On the Sarim menu |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `sarim_rifles` | Sarim Rifles | sarim | infantry | 340 / 26 / 2 | false | `art/meshes/sarim_rifles.glb` | none (Meshy B3 `militia_cell` figure + part `sarim_rifle`, `import_meshy_crew_team.py`) | yes, l.184 | team + lead | down, fall, fallAlt, fire, idle, move, moveFire, wreck, wreckAlt, kneel, kneelIn, kneelOut, pinned | **yes** |
| `atgm_cell` | ATGM Cell | sarim | at_team | 235 / 20 / 1 | false | `art/meshes/atgm_cell.glb` | none (Meshy `atgm_cell` + part `atgm_post`) | yes, l.161 | team + lead | down, idle, move, moveFire, wreck, fire, pinned | **yes** |
| `manpad_team` | MANPAD Team | sarim | aa | 210 / 18 / 1 | false (explicit) | `art/meshes/manpad_team.glb` | none (B3 militia figure + part `manpad_tube`) | yes, l.215 | team + lead | down, fire, idle, move, moveFire, wreck, kneel, kneelIn, kneelOut, pinned | **yes** |
| `recoilless_team` | Recoilless Team | sarim | at_team | 205 / 16 / 1 | false | `art/meshes/recoilless_team.glb` | none (Meshy `recoilless_team` + part `recoilless_rifle`) | yes, l.216 | team + lead | down, fire, idle, move, moveFire, wreck, pinned | **yes** |
| `rocket_battery` | Rocket Battery | sarim | artillery | 201 / 40 / 3 | true (explicit) | `art/meshes/vehicles/rocket_battery.glb` | `art/src/vehicles/rocket_battery.blend` | yes, l.290 | team | idle, wreck | **yes** |
| `gun_truck` | AA Gun Truck | rif | aa | 324 / 13 / 1 | true | `art/meshes/vehicles/gun_truck.glb` | `art/src/vehicles/gun_truck.blend` | yes, l.331 | team | idle, wreck | **yes** |
| `technical` | Armed Technical | rif | technical | 331 / 10 / 1 | true | `art/meshes/vehicles/technical.glb` | `art/src/vehicles/technical.blend` | yes, l.285 | team | idle, wreck | no |
| `moto_rpg` | Armed Motorcycle | rif | technical | 244 / 7 / 1 | true | `art/meshes/moto_rpg.glb` (a rigged team, not a vehicle) | none (`import_meshy_moto_rpg.py`) | yes, l.169 | team (one-figure rig) | fire, idle, move, wreck | no |
| `rpg_team` | RPG Team | ashwar | at_team | 210 / 12 / 1 | false | `art/meshes/rpg_team.glb` | none (Meshy `rpg_team` + `art/parts/rpg7.glb`) | yes, l.160 | team + lead | down, fire, idle, move, moveFire, wreck, kneel, kneelIn, kneelOut, pinned | no |
| `militia_cell` | Militia Cell | ashwar | infantry | 280 / 10 / 1 | false | `art/meshes/militia_cell.glb` | none (Meshy `militia_cell` + part `sarim_rifle`) | yes, l.159 | team + lead | down, fire, idle, move, moveFire, wreck, kneel, kneelIn, kneelOut, pinned | no |
| `mortar_crew` | Mortar Crew | ashwar | artillery | 198 / 15 / 1 | false | `art/meshes/mortar_crew.glb` | part only: `art/parts/mortar_crew/mortar.blend` | yes, l.162 | team + lead | down, idle, move, wreck, moveFire, fire, pinned | no |
| `paramotor` | Powered Parachute | ashwar | support (air) | 275 / 11 / 1 | false (air) | `art/meshes/vehicles/paramotor.glb` | `art/src/drones/paramotor.blend` | yes, l.289 | team | idle, wreck | no |
| `charge_squad` | Suicide Squad | ashwar | infantry | 267 / 6 / 1 | false | `art/meshes/charge_squad.glb` | none (Meshy `charge_squad`) | yes, l.163 | team + lead | down, fire, idle, move, wreck, moveFire, pinned | no |
| `digger_crew` | Digger Crew | ashwar | engineer | 186 / 15 / 1 | false | `art/meshes/digger_crew.glb` | none (Meshy `digger_crew`) | yes, l.170 | team (one-figure rig) | down, idle, move, wreck, pinned | no |
| `loiter_drone` | Loitering Munition | sarim | drone (air) | 292 / 9 / 0 | true (air) | `art/meshes/vehicles/loiter_drone.glb` | `art/src/drones/loitering_munition.blend` | yes, l.332 | team | idle, wreck | barred (LD3) |
| `drone_swarm` | Drone Swarm | sarim | drone (air) | 240 / 16 / 0 | true (air) | `art/meshes/vehicles/drone_swarm.glb` | `art/src/vehicles/drone_swarm.blend` | yes, l.337 | team | idle, wreck | held (`VERSUS_HELD_UNITS`) |
| `wounded_sarim` | Wounded Fighter | sarim | wounded | 0 / - / 0 | false (explicit) | `art/meshes/wounded_sarim.glb` | `art/src/units/wounded_sarim.blend` | yes, l.253 | team (one-figure rig) | crawl, down, idleWounded, wreck | never (shed, not built) |

Every row passes `tools/src/mesh_roster.test.ts` today:
- every vehicle GLB carries `idle` and `wreck`;
- every rigged team carries `down` or `wreck`.

Every row also has its portrait (`packages/app/src/ui/portrait.test.ts`). Every Meshy-origin row is in
`art/ATTRIBUTION.md`'s groups.

**Armour today (M):** the thickest opposition hull is `technical`'s 15 mm front. That is under the sim's 30 mm soft line
(`SOFT_ARMOR_LIMIT`), which is the issue's D1 finding: the KDF's penetration, facing and bounce chain never runs against
an opposition hull.

---

## 2. The proposed additions

### 2.1 The fifteen

**Recommended menu (append, never reorder).** The six shipped entries keep their positions, because the versus probe's
buy rule breaks ties in menu order (§3.4), so a reorder would move cells for no reason. The nine additions follow them.
The dock order is presentation only, and the lead may regroup it.

| # | id | source | role in the matchup against KDF |
|---|---|---|---|
| 1 | `sarim_rifles` | shipped | Line infantry that holds under fire (suppression resistance 0.72). Garrisons. |
| 2 | `atgm_cell` | shipped | The Kornet wall: the one Sarim weapon that kills armour through the Trophy, in sections of three (GDD §5.7 Standoff). |
| 3 | `gun_truck` | shipped (Rif) | The ZU screen against the Peten and against infantry in the open. |
| 4 | `manpad_team` | shipped | Air denial only, at 13 tiles. |
| 5 | `rocket_battery` | shipped | Indirect reach from behind rock. Inert without a spotter (`sight_tiles` 6, range 20). |
| 6 | `recoilless_team` | shipped | Cheap, quiet anti-armour inside 7 tiles. |
| 7 | `technical` | shipped (Rif), **added** | A fast HMG raider with 3 seats. Punishes jeeps and infantry, dies to anything heavier. |
| 8 | `moto_rpg` | shipped (Rif), **added** | The fastest flanker (3.4 t/s). An RPG on a soft rear arc, then gone. |
| 9 | `rpg_team` | shipped (Ashwar), **added** | Ambush anti-armour in streets. Garrisons and takes the versus tunnels. |
| 10 | `militia_cell` | shipped (Ashwar), **added** | Cheaper, quicker, worse infantry than the Rifles: bodies for a held house. |
| 11 | `mortar_crew` | shipped (Ashwar), **added** | Short indirect fire. Moves the KDF off the cover it took against the Kornets. |
| 12 | `paramotor` | shipped (Ashwar), **added** | An air spotter for the rockets and mortars, 14 tiles of sight. Fragile: every KDF rifle and MG can target air. |
| 13 | `sarim_carrier` | **new** | **The armoured vehicle.** An HMG carrier that small arms and every KDF machine gun cannot penetrate from any face, and that the Namer's 30 mm bounces off frontally three times in four. It forces the KDF to flank it, or to spend a missile or a tank round on it. |
| 14 | `hmg_team` | **new** | A tripod 12.7 mm gun. Suppression and anti-infantry at 9 tiles from a window, and light AA against the Peten. Sarim has no crew-served MG today. |
| 15 | `observer_team` | **new** | A ground spotter, 14 tiles of sight at signature 0.35. It gives the rockets, the mortars and the Kornets the side-wide identification they need. That is the standoff doctrine's missing piece (the 2026-08-23 roster design: "a battery with no spotter is inert past its own sight"). |

**The bench, if the lead strikes a row above:**
- `charge_squad` (**Suicide Squad**): see Q2. A player-bought suicide attack is a tone call. It is left out by default.
- `digger_crew`: no weapon, and its one verb, digging a tunnel, exists only as mission data (a placement's `digs`, a route id).
  There is no `Command` for it and the versus routes are pre-dug, so in a room it is a 186-logistics unit that does nothing.

**Not eligible:**
- `loiter_drone`: barred by LD3.
- `drone_swarm`: held, because a lockstep room has no rule for one entity that stands for twelve drones.
- `wounded_sarim`: never bought.

### 2.2 The fiction and the naming screen

The three new units are Sarim Brigades materiel: the best-trained of the three opposition doctrines, in the northern
mountains, built around rockets, ATGMs and standoff (GDD §2). Their names follow the shipped Sarim register, which is a
plain English description of what the unit is: *ATGM Cell*, *Recoilless Team*, *Rocket Battery*.

| id | name | screen (storyline §2.4) |
|---|---|---|
| `sarim_carrier` | Tracked Carrier | A generic description. It names no real platform, person, faith, place, insignia or operation. No in-game collision: no shipped unit is a "Carrier" (`Kipod Screen Carrier` is a KDF name, a different word in context, and the lead may prefer *Tracked APC*). |
| `hmg_team` | Heavy MG Team | Generic. The shipped register already has *MANPAD Team*, *RPG Team* and *ATGM Cell*. |
| `observer_team` | Observer Team | Generic. It does not collide with *Shmamit Deep Recon Team* or *Chadaf Recon Robot*. |

**Weapon ids are real equipment** (`kpvt_14_5`, `dshk_tripod`), like the shipped `kornet`, `spg9`, `grad_122`,
`zu23_twin` and `dshk`. Rule 6 (the lead, 15 Nov 2026, GH-1440) admits real equipment names. Rule 5 still holds: no flag,
badge or emblem, and every model prompt carries the house line "No insignia, flags, patches, text or markings of any
kind". A weapon id is never shown to the player.

The blurbs are each at most 96 characters (`unit.schema.json` `maxLength`). Each says what the unit does in play and what
it cannot do, and promises nothing the sim does not do.

### 2.3 The three new unit files (data only)

They are written in the shipped files' shape. No combat tuning: no constant in `tuning.ts` and no shipped unit's
stats change. Each weapon number sits inside the range of a shipped weapon of its class, named in §2.4.

```json
{
  "id": "sarim_carrier",
  "name": "Tracked Carrier",
  "blurb": "Shrugs off rifles and machine guns from the front, carries two teams, and dies to any missile.",
  "faction": "sarim",
  "role": "apc",
  "cost": { "logistics": 445, "build_time_s": 26, "population": 2 },
  "hull": {
    "hp": 1300,
    "armor": { "front": 130, "side": 70, "rear": 45 },
    "crew": 3,
    "transport_slots": 2,
    "suppression_resistance": 0.6
  },
  "mobility": {
    "footprint": { "half_length_tiles": 1.12, "half_width_tiles": 0.5 },
    "speed_tiles_s": 1.6,
    "turn_rate_deg_s": 90,
    "gear": "tracks"
  },
  "sensors": { "optics": 1.0, "sight_tiles": 9, "signature": 0.9, "firing_signature_mult": 3.5 },
  "weapons": [
    {
      "id": "kpvt_14_5", "type": "hmg",
      "range_tiles": 9, "effective_range_tiles": 7.5,
      "accuracy": 0.58, "penetration": 32, "damage": 50, "suppression": 60, "rof_per_min": 300,
      "can_target": ["ground", "air"], "collateral_risk": 0.3
    }
  ]
}
```

```json
{
  "id": "hmg_team",
  "name": "Heavy MG Team",
  "blurb": "A tripod gun that pins men and light trucks at nine tiles and fires from a window. Slow to move.",
  "faction": "sarim",
  "role": "support",
  "formation_class": "support_weapon",
  "cost": { "logistics": 290, "build_time_s": 16, "population": 1 },
  "hull": {
    "hp": 330,
    "armor": { "front": 10, "side": 10, "rear": 10 },
    "crew": 3,
    "suppression_resistance": 0.55,
    "figures": 2,
    "wounds": { "wound_chance": 0.6, "bleed_s": 60, "type": "wounded_sarim" }
  },
  "mobility": { "speed_tiles_s": 0.6, "wheeled": false },
  "sensors": { "optics": 1.0, "sight_tiles": 9, "signature": 0.55, "firing_signature_mult": 4.0 },
  "abilities": ["garrison"],
  "weapons": [
    {
      "id": "dshk_tripod", "type": "hmg",
      "range_tiles": 9, "effective_range_tiles": 7.2,
      "accuracy": 0.62, "penetration": 25, "damage": 40, "suppression": 65, "rof_per_min": 300,
      "can_target": ["ground", "air"], "collateral_risk": 0.25
    }
  ]
}
```

```json
{
  "id": "observer_team",
  "name": "Observer Team",
  "blurb": "Sees fourteen tiles from cover so the rockets and mortars can fire. Barely armed.",
  "faction": "sarim",
  "role": "recon",
  "cost": { "logistics": 255, "build_time_s": 14, "population": 1 },
  "hull": {
    "hp": 300,
    "armor": { "front": 10, "side": 10, "rear": 10 },
    "crew": 2,
    "suppression_resistance": 0.6,
    "figures": 2,
    "can_embark": true,
    "wounds": { "wound_chance": 0.6, "bleed_s": 60, "type": "wounded_sarim" }
  },
  "mobility": { "speed_tiles_s": 0.8, "wheeled": false },
  "sensors": { "optics": 1.5, "sight_tiles": 14, "signature": 0.35, "firing_signature_mult": 3.0 },
  "abilities": ["mark_target", "garrison"],
  "weapons": [
    {
      "id": "carbines", "type": "small_arms",
      "range_tiles": 6, "effective_range_tiles": 5,
      "accuracy": 0.55, "penetration": 8, "damage": 12, "suppression": 20, "rof_per_min": 160,
      "can_target": ["ground", "air"], "collateral_risk": 0.1
    }
  ]
}
```

**Authoring traps, already handled in the data above:**
- `observer_team` is `role: recon`, and `recon` is NOT in the sim's `FOOT_ROLES`. Without the explicit
  `"wheeled": false` the sim would treat two men on foot as a vehicle: no boulder field, no tunnel, no garrison. This is
  CLAUDE.md's "`FOOT_ROLES` alone is wrong" rule. `hmg_team` (role `support`, a foot role) authors it too, for clarity.
- `hmg_team` declares `formation_class: support_weapon` (it would default to `infantry`) so a formation places it with
  the mortars and the batteries, not in the rifle wedge.
- The carrier declares no `top` armour. The sim reads no `top` (only `hull.armor` front, side and rear reach the hit
  path), and `validate_balance.py` does not read it either, so a value there would be a dead field.
- No `voice`, no `upgrades` (`validate:data` allows `upgrades` on `kdf` units only), no `unlock` (the doctrine menu is the
  versus gate, P-7), no `hidden_setup`.

### 2.4 The carrier against the KDF's guns: penetration, facing and bounce

The issue's D1 criterion asks for an opposition hull on which the KDF's penetration, facing and bounce are exercised.
The table gives P(penetrate) by face, from the normal curve `validate_balance.py` shares with the sim
(sigma = 0.12 x penetration) (M, computed):

| KDF weapon (penetration) | front 130 | side 70 | rear 45 |
|---|---|---|---|
| `inf_squad` rifles (8), `yahalom` / `medic` carbines (8) | 0.00 | 0.00 | 0.00 |
| `jeep_shoded` pintle MG (22), Lavi coax (20), Eitan `rws_50` (25), `breach_team` (26) | 0.00 | 0.00 | 0.00 |
| `sniper_team` AMR (45) (not on the KDF menu) | 0.00 | 0.00 | 0.50 |
| `ifv_namer` 30 mm (120), `heli_peten` chain gun (120) | **0.24** | 1.00 | 1.00 |
| `at_team` Spike (900), Peten Hellfire (900) | 1.00 | 1.00 | 1.00 |
| `mbt_lavi` 120 mm (1300) | 1.00 | 1.00 | 1.00 |

So the KDF's whole small-arms and MG set bounces off it, and the Namer's cannon bounces off its front three times in four
and goes through its flank every time. That is facing made mechanical. Any missile or tank round goes through, at the
GH-560 hit-point cost (`penetrationHpCost`, at least 34% x (1 + overmatch/60) of max hp). Its own 14.5 mm (penetration
32) defeats the KDF's soft targets only: `jeep_shoded` (front 14) and infantry. Against the Eitan (front 220), the Namer
or the Lavi it does nothing, so it threatens no KDF hull.

Neighbours on each axis (M, read from `data/units`):
- **Armour:** `scout_shachaf` 130 / 75 / 50 (KDF, wheeled recon car).
- **Hit points:** between the Shachaf (900) and the Eitan (1600).
- **Speed:** the Eitan's 1.8 and the Namer's 1.3 on either side.
- **Weapon:** between the `technical`'s DShK (penetration 25, damage 40) and the `gun_truck`'s ZU (40 / 85).
- **Seats:** 2, like the Eitan.
- **Population:** 2, like every KDF APC.

### 2.5 Priced on the cost curve (M)

`tools/validate_balance.py` (±18% band, refitted from the whole roster on every run) was run on this tree with the three
files in a scratch directory passed as `--also`. That is a pure-Python, offline run, no different from what CI does for
staged content. All four of CI's invocations (`.github/workflows/ci.yml` lines 161-172) pass, 50 units.

| invocation | fitted curve | `sarim_carrier` 445 | `hmg_team` 290 | `observer_team` 255 | widest | widest without the three |
|---|---|---|---|---|---|---|
| plain | 282.707 x power^0.482 | +0.7% (expected 442) | -1.3% (294) | -1.1% (258) | `attack_drone` +14.0% | +13.9% |
| `--also e5 --also gh709` | same | same | same | same | +14.0% | +13.9% |
| `--max-tier --upgrade-cost-factor 0.02` | 301.658 x power^0.484 | +2.3% (435) | -2.8% (298) | -2.1% (260) | `heli_yanshuf` +15.5% | +15.3% |
| both | same | same | same | same | +15.5% | +15.3% |

- **The refit barely moves.** It widens the widest deviation by 0.1 to 0.2 points. The most negative stays
  `manpad_team` at -10.0% (-10.2% at max tier).
- **The first prices were a reasoned guess and were refitted once.** The guess was 500 / 250 / 230, which read +13.1%,
  -14.6% and -10.3%. Each was then moved to its own expected price, and nothing else was changed.
- **The curve is the authority** (the 2026-08-23 roster design's rule). The landing PR re-runs it on its own tree. These
  numbers are a scratch measurement, not a pin.

**Build time and line pace** (production-numbers §3's basis, logistics per second of line, R):

| unit | build s | logistics / s of line | neighbours |
|---|---|---|---|
| `sarim_carrier` | 26 | 17.1 | `apc_eitan` 28 s / 18.6, `dozer_d9` 26 s, `sarim_rifles` 26 s / 13.1 |
| `hmg_team` | 16 | 18.1 | `recoilless_team` 16 s / 12.8, `rpg_team` 12 s / 17.5 |
| `observer_team` | 14 | 18.2 | `mortar_crew` 15 s / 13.2, `paramotor` 11 s / 25.0 |

`pnpm balance` (the §5.7 backtest) is unit-agnostic except for its named scenarios. None of them names a new id, so the
landing PR runs it once, expecting no change (R). It is not run here: it needs the units registered in `@lions/data`,
which is code, and this page is docs only.

---

## 3. The Sarim production menu for versus

### 3.1 What exists

- **One camp per end.** A KDF-v-Sarim economy room (`economyRoom`) boots a `MissionRuntime` from `data/versus/<map>.json`
  (`ends.friendly.camp` and `ends.hostile.camp`, each a `camp` structure with an optional `exit`).
- **One serial line per camp,** keyed by side (`packages/sim/src/production.ts`). The side that stands at an end owns its
  camp (LD1).
- **The menu is the doctrine's.** `versusUnitInfo(menus)` (`packages/app/src/net/match-world.ts`) prices a unit only if it
  is on `menus[side]`, at its own JSON's logistics, build time and population. "No `unlock` -- the doctrine menu IS the
  gate (P-7)".
- **Production commands** (`build`, `cancelBuild`, `setRally`, `clearRally`) pass `validateCommand` in an economy room for
  the seat's own side only.
- **Five rules files** carry camps today: `tel_marum`, `wadi_tarfan`, `wadi_tarfan_l`, `rujm_sawda`, `milh_flats_l`.
  GH-1381 adds one for every open map.

So **Sarim already has its own production menu: `data/doctrines/sarim.json`.** GH-1382's "its own production menu"
is that file grown from 6 types to 15. Nothing new is needed in `data/versus`.

### 3.2 Recommended: one camp line, fifteen tiles (Option A, data only)

- **The change:** `data/doctrines/sarim.json` `menu` grows from 6 to 15 (§2.1's order), in the same commit as, or after,
  the three new units land in `data/units/enemy/`. Before that, the six shipped additions can land alone at 12, which is
  slice S1 in §7.
- **The rules hold:**
  - every id is an opposition unit;
  - none is `loiter_drone`;
  - every id is registered by a room, so none is in `VERSUS_HELD_UNITS` (otherwise `versusUnitInfo` answers null and
    the tile is dead);
  - `pop_cap` 56 and `logistics_start` 2400 are unchanged, and the 1.6 ratio stands.
- **Pace on one serial line.** Six of the additions build in 7 to 12 s. So, as with the KDF's drones (production-numbers
  §3 "Instant-feeling"), the purse paces the Sarim seat more than the line does. The slowest Sarim item stays the
  `rocket_battery` at 40 s, the one cheap-but-slow mismatch §3 already flags.

### 3.3 Not recommended now: a second, role-filtered Sarim line (Option B, schema and engine)

"Its own camp lines" could mean a second line per Sarim end: the camp for foot teams, and a vehicle yard for
`technical`, `moto_rpg`, `gun_truck`, `rocket_battery` and `sarim_carrier`. Everything it needs exists in pieces, but
not in this combination:

| piece | exists today | what Option B needs |
|---|---|---|
| a role filter on a line | `production.roles` and `lineTakes` (GH-277), with `NOT_ON_LINE` worded in the dock | the same filter on an AUTHORED versus line. Today it is only on a production WORK, which is owner 0, buildable, never placed by data, and refused in every versus room (`raiseWorks` drops in `ownership.ts`) |
| a second structure per end | no: `versus_rules.schema.json` `end` has exactly one `camp` | a schema field, e.g. `ends.<end>.yard: { at, size, exit, roles }`, plus `validate_versus_rules.mjs` (open ground, within 6 tiles of the anchor, point-mirrored exits) |
| side-1 lines | yes in versus (`economyRuntime` builds both ends' camps) | nothing new |
| a role list naming opposition roles | no: `validate_production.mjs` refuses "a role no KDF unit has" | a rule widened to the line's own faction |
| `MAX_PRODUCTION_LINES` 4 a side | yes | 2 of 4 |

**Why not now:**
- It is an engine and schema change, and the issue's constraint is "content is JSON; an engine change means the schema
  is missing a concept".
- A second line doubles Sarim's build throughput. Unless the KDF gets the same, that is a fairness change in its own
  right.
- (R) It buys little. With a 2400 opening purse and about 1 logistic a second of zone income
  (production-numbers §6), the opening purse is about 8 items, which one line clears in about 2.5 minutes at Sarim's
  build times. After that the purse, not the line, paces the seat.

If the lead wants it: make it symmetric (a KDF yard too), as its own ticket, with its own probe reading.

### 3.4 D7, the versus camps, and the fairness reading against production-numbers §6

**D7 is untouched.** D7 is about the campaign: "No shipped campaign mission gives side 1 a camp".
- `validate:data` refuses `enemy.production` on a shipped mission, and the shipped `unitInfo` lambdas answer KDF only
  (R-F4-5).
- Option A edits `data/doctrines/sarim.json` and adds units. It touches no `data/missions` file and no `enemy.production`
  block, and it changes no campaign `unitInfo`.
- The new types become available to mission authors as enemy placements or waves, like any opposition unit, but this
  design places none.
- If the lead wants the Sarim menu to drive a campaign side-1 camp, that is D7's own alternative ("author one enemy camp
  AND make the app/playtest unitInfo answer side 1", code and data, held for the lead), and out of scope here.
- **Free play** (GH-1381's third criterion) is a sandbox, not a shipped mission, so D7 does not bind it either.

**The versus camps are unchanged.** No `data/versus/*.json` file changes under Option A. A camp's line takes whatever the
seat's doctrine menu lists. `versus_aid` (the camp as a drop-off) is a KDF-medic matter, and Sarim still has no rescue
unit.

**The fairness reading, on §6's basis.** §6 opened one KDF menu unit (the Nemala medic) as follows:
1. Price it on the same curve as its neighbours (§2.5 here).
2. Re-run `pnpm versus:probe -- --economy` at 96 seeds a cell (192 near the bar), on Tel Marum, Wadi Tarfan and Wadi
   Tarfan L, each end friendly, plus tunnels cell 3.
3. Hold every cell inside 60/40.
4. Require mirror and placed-force rooms to be byte-identical to main.

The same reading applies here, with four differences (R, not measured):
- **Mirror and placed rooms do not move (R).** They read no menu: the placed force is `VERSUS_SARIM` in
  `versus-force.ts`, and a mirror room has no runtime. The menu-only slice S1 adds no registration either. The three new
  types do add registration, which moves the roster-count and hash pins, but not outcomes (R; verify, §5).
- **Every economy cell moves.** The probe's buy rule (`planRound`, `tools/src/backtest/versus-probe.ts`) rebuilds toward
  the placed force's mix: ratio = (living + queued) / weight, where weight is the count in `VERSUS_SARIM` (14 Kornets,
  6 ZUs, 2 Rifles, 2 MANPADs, 2 batteries) and at least 1. Ties go in menu order.
  - The nine additions are all armed with weight 1, so the first round buys one of each in menu order before the Kornet
    count rises. The Sarim opening goes from Kornet-heavy to a broad mix.
  - (R) `versus-force.ts` records that "an equal-value mix with infantry, RPGs, technicals and a mortar lost 24 of 24 on
    both maps, because a Namer's 30 mm and a Lavi's gun clear anything that walks". So the bot reading probably swings
    toward KDF. The probe then measures the buy rule as much as the menu.
- **GH-990 is already outside on main:** Economy, Tel Marum, Sarim friendly reads Sarim 61.5% at 192 seeds (§6's
  re-read). The broader Sarim opening could bring it back inside, or push the KDF-friendly cell out. That is unknown
  until measured.
- **The probe is parked.** GH-1381: "Fairness probes are parked too: `pnpm versus:probe` is the bar for opening a versus
  map, so the lead's ruling on it comes first." So the menu cannot land as fair before that ruling. The design separates
  the art and the units, which can land, from the menu edit, which waits on the ruling.

---

## 4. ASSET MANIFEST

### 4.1 Pricing basis for the credit column (no call made)

From `tools/src/meshy/pricing.ts` (`PRICING`, quoted from https://docs.meshy.ai/en/api/pricing on 2026-11-09):

| step | credits |
|---|---|
| text-to-3D preview, `meshy-6` (the CLI default) or 7 / 7.1 / latest | 20 |
| text-to-3D preview, lite tier (`meshy-6-lite`, `meshy-t2`, `meshy-t2.5`) | 5 |
| ultra surcharge (meshy-7 family only) | +5 |
| refine, 2K/4K texture | 10 |
| refine, 8K texture | 15 |
| remesh (flat, any polycount) | 5 |
| image-to-3D, textured 2K/4K (standard) | 30 |

USD is `DEFAULT_USD_PER_CREDIT` = **$0.02** (the Pro plan's advertised $20 / 1,000; the API publishes no rate, so every
USD figure is an estimate).

**What comparable shipped assets actually consumed** (M, `art/meshy/ledger.jsonl`, `credits_consumed` summed by `name`):
- the standard asset route is preview 20 + refine 10 + remesh 5 = **35**. `atgm_cell`, `sarim_rifles`, `militia_cell`,
  `rpg_team`, `gun_truck`, `apc_eitan`, `apc_kipod`, `scout_shachaf` and `dozer_d9` each consumed exactly 35;
- a re-tried hull ran higher: `ifv_namer` 80 (two full rounds), `moto_rpg` 65, `recon_drone` 90;
- a hand-weapon part ran 40 to 60: `sarim_rifle` 40, `manpad_tube` 40, `recoilless_rifle` 60, `atgm_post` 60;
- the ledger total to date is **3,030 credits consumed**.

The **ceiling** below is the precedent of one extra full round on the same asset.

### 4.2 The table, one row per menu unit (and the bench)

Pipeline keys:
- **T** is the infantry team path (CLAUDE.md "Mesh units"):
  - a figure source (`import_meshy_crew_team.py` or its kin, with a `tools/units/crew_builds.py` / `teams.py` entry),
    then `rig.py` (clips authored in code), then `export_mesh_team.py` ownership (`rig.TEAM_MESH_OWNER`);
  - then `pnpm motion:meshes`, `pnpm gait:meshes` and `pnpm encode:meshes`. `pnpm hands:meshes` applies to
    `HANDS_TEAMS` only, so it is not needed for these teams;
  - then a catalogue entry, the `TEXTURED_INFANTRY_EXEMPT` set and its pinned TS twin, an `ATTRIBUTION.md` group and an
    `ASSET_PROVENANCE.md` row, and a portrait (team + lead).
- **V** is the vehicle path:
  - Meshy, then an exporter (`tools/vehicles/export_meshy_<id>.py`) writing the GLB and `art/src/vehicles/<id>.blend`;
  - then `pnpm running-gear:meshes` (a recipe in `tools/src/meshes/running-gear-recipes.ts`), optionally
    `pnpm mark:meshes`, then `pnpm wreck:meshes` (a recipe), `pnpm damage:meshes` and `pnpm encode:meshes`;
  - no rescale, and no kit (Sarim has no `upgrades`);
  - then the catalogue vehicle map, `TEXTURED_VEHICLE_EXEMPT` and its TS twin, attribution, provenance, and a portrait
    (team).

| # | unit | GLB exists | `.blend` exists | clips present / missing | kit parts reusable from `art/parts` (or shipped art) | pipeline steps needed | Meshy credits, planned / ceiling (assumptions) | Blender hours, planned / ceiling (R) |
|---|---|---|---|---|---|---|---|---|
| 1 | `sarim_rifles` | yes, `art/meshes/sarim_rifles.glb` | no tracked (Meshy + importer) | all 13 / none | n/a | none | 0 / 0 | 0 / 0 |
| 2 | `atgm_cell` | yes, `art/meshes/atgm_cell.glb` | no tracked (Meshy + importer) | 7 / none | n/a | none | 0 / 0 | 0 / 0 |
| 3 | `gun_truck` | yes, `art/meshes/vehicles/gun_truck.glb` | yes, `art/src/vehicles/gun_truck.blend` | idle, wreck / none | n/a | none | 0 / 0 | 0 / 0 |
| 4 | `manpad_team` | yes, `art/meshes/manpad_team.glb` | no tracked | 10 / none | n/a | none | 0 / 0 | 0 / 0 |
| 5 | `rocket_battery` | yes, `art/meshes/vehicles/rocket_battery.glb` | yes, `art/src/vehicles/rocket_battery.blend` | idle, wreck / none | n/a | none | 0 / 0 | 0 / 0 |
| 6 | `recoilless_team` | yes, `art/meshes/recoilless_team.glb` | no tracked | 7 / none | n/a | none | 0 / 0 | 0 / 0 |
| 7 | `technical` | yes, `art/meshes/vehicles/technical.glb` | yes, `art/src/vehicles/technical.blend` | idle, wreck / none | n/a | none (menu entry only) | 0 / 0 | 0 / 0 |
| 8 | `moto_rpg` | yes, `art/meshes/moto_rpg.glb` | no tracked (`import_meshy_moto_rpg.py`) | fire, idle, move, wreck / none required (a one-figure rig, armed: `mesh_gait.test.ts` already passes it as shipped) | n/a | none | 0 / 0 | 0 / 0 |
| 9 | `rpg_team` | yes, `art/meshes/rpg_team.glb` | no tracked | 10 / none | n/a | none | 0 / 0 | 0 / 0 |
| 10 | `militia_cell` | yes, `art/meshes/militia_cell.glb` | no tracked | 10 / none | n/a | none | 0 / 0 | 0 / 0 |
| 11 | `mortar_crew` | yes, `art/meshes/mortar_crew.glb` | part only, `art/parts/mortar_crew/mortar.blend` | 7 / none | n/a | none | 0 / 0 | 0 / 0 |
| 12 | `paramotor` | yes, `art/meshes/vehicles/paramotor.glb` | yes, `art/src/drones/paramotor.blend` | idle, wreck / none | n/a | none | 0 / 0 | 0 / 0 |
| 13 | **`sarim_carrier`** | **no** | **no** | none / **idle, wreck** (written by `wreck:meshes`) | **None fits as a body.** Every tracked hull on disk is KDF (`ifv_namer_host.blend`, `apc_eitan_host.blend`, the Lavi), and a KDF hull on the Sarim side would read as KDF and collide in IoU. Reusable: the running-gear pass and its tracked recipe shape (`NAMER_GEAR`), the wreck and damage passes, and the turret-pivot convention of the shipped carriers. The 14.5 mm in a small cone turret is in the Meshy body (one object, roles split into named nodes in Blender) | **V**: Meshy text-to-3D (textured, real metres, about 6.7 x 2.9 m, hull `hull`, turret `turret`, tracks `track`, road wheels named for the recipe) -> new `tools/vehicles/export_meshy_carrier.py` (modelled on `export_meshy_truck.py`) -> `art/src/vehicles/sarim_carrier.blend` + `art/meshes/vehicles/sarim_carrier.glb` -> `running-gear:meshes` (new recipe, measured from the bytes) -> [`mark:meshes` if Q5 says yes: a row in `tools/vehicles/lavi_mark.py`] -> `wreck:meshes` (new recipe) -> `damage:meshes` -> `encode:meshes` -> catalogue, `TEXTURED_VEHICLE_EXEMPT` + TS twin, `ATTRIBUTION.md`, `ASSET_PROVENANCE.md`, `check_provenance_register.py` -> portrait (team) | **35 / 70.** Planned: 1 preview `meshy-6` 20 + 1 refine 2K 10 + 1 remesh 5. Ceiling: a second full round (the `ifv_namer` precedent, 80, was two rounds plus an extra refine). +5 for an 8K refine; the vehicle texture ratchet is 2560 px (`validate:meshes`), so 2K is enough | **12 / 16.** Import, scale, orient, de-light check, role split 3; exporter 2; running-gear recipe and check 2; turret pivot and slew 1; wreck recipe, damage, encode 1.5; team mark 1 (if Q5); IoU and gate iterations 1.5; portrait 0.25 (ceiling: one more Meshy round to clean, +4) |
| 14 | **`hmg_team`** | **no** | **no** (source: shipped Meshy figure + part, per house practice for Meshy teams) | none / **all**: idle, move, moveFire, fire, down, wreck, pinned, kneel set (from `rig.py` + the motion pass) | **The body:** the B3 `militia_cell` remesh, the figure `sarim_rifles` and `manpad_team` already reuse (0 credits). **The tripod:** `kit.atgm_tripod` (a code part) as the mount base, and the crew-point convention of `art/parts/mortar_crew/points.json`. **The gun:** none shipped (`technical`'s DShK is inside a supplied export whose source is not in git), so it is new | **T**: a `crew_builds.py` / `teams.py` entry (2 figures, gunner prone-to-kneel behind the gun, loader kneeling) -> gun part: Meshy preview, refine 2K, remesh at about 400-600 tris -> `art/parts/hmg_team/dshk.glb` + `.blend` + `points.json` -> rig -> motion -> gait -> encode -> catalogue, `TEXTURED_INFANTRY_EXEMPT` + TS twin, `rig.SUPPORTED_TEAMS`, attribution, provenance -> portrait (team + lead) | **35 / 95.** Planned: the gun part at 35 (preview 20 + refine 10 + remesh 5), body 0. Ceiling: the part at 60 (the `recoilless_rifle` precedent) + a new A-pose figure at 35, if the lead wants the HMG men to look unlike the riflemen, or if IoU needs a different body | **7 / 10.** Crew build and cut 2; part import, points, tripod 2; clips through rig/motion/gait 1.5; IoU and gait-gate iterations 1; portrait both variants 0.5 (ceiling: a new figure's cut, +3) |
| 15 | **`observer_team`** | **no** | **no** | none / **all**, as above (`fire`/`moveFire` for the carbines; the kneel set for the observing pose) | **The body:** the same B3 figure (0), or the `atgm_cell` figure for a second face. **Kit, all code:** `kit.binoculars` (shipped), a tripod spotting scope from `kit.atgm_tripod` + `kit.tube`, and a whip antenna (one `kit.tube`, about 1.2 m) on the second man's pack, which is the silhouette cue. Carbines: the `sarim_rifle` part | **T**: as row 14, with no Meshy part | **0 / 35.** Planned 0: every part is code-built or shipped. Ceiling: a new A-pose figure at 35 (preview 20 + refine 10 + remesh 5), or 15 on the lite tier (`meshy-6-lite` preview 5 + refine 10, 2K only), if the lead wants it distinct | **6 / 9.** Crew build and kit placement 2.5; clips 1.5; IoU (sniper and MANPAD neighbours) 1; portrait both variants 0.5; slack 0.5 (ceiling: a new figure, +3) |
| bench | `charge_squad` | yes, `art/meshes/charge_squad.glb` | no tracked | 7 / none | n/a | none | 0 / 0 | 0 / 0 |
| bench | `digger_crew` | yes, `art/meshes/digger_crew.glb` | no tracked | 5 / none (unarmed: no `moveFire` needed) | n/a | none | 0 / 0 | 0 / 0 |

### 4.3 Totals

| | planned | ceiling |
|---|---|---|
| **Meshy credits** | **70** (carrier 35 + HMG gun 35 + observer 0) | **200** (70 + 95 + 35) |
| **USD at $0.02 a credit (estimate)** | **$1.40** | **$4.00** |
| **Blender hours (R)** | **25** (12 + 7 + 6) | **35** (16 + 10 + 9) |
| new GLBs | 3 (1 vehicle, 2 teams) + 1 part GLB | 3 + 1 part (+ up to 2 figure remeshes, not shipped as GLBs) |
| new tracked `.blend` | 2 (`art/src/vehicles/sarim_carrier.blend`, `art/parts/hmg_team/dshk.blend`) | 2 |
| renders (portraits, after approval) | 3 team + 2 lead | same |

- **No Meshy call was made for this page,** and no estimate was run. The credit column is arithmetic on `pricing.ts`'s
  table and the ledger's precedents.
- **Before ANY call,** the lead approves these numbers, and each call is announced with its credits first. The CLI's
  offline `estimate text ... --refine` and `estimate remesh` then print the same 30 and 5.
- **The assumptions:**
  - `meshy-6` standard previews at 20;
  - 2K refines;
  - one remesh each;
  - no ultra mode;
  - no image-to-3D (a reference sheet would add a text-to-image call, 6 credits on `nano-banana-2`, plus 30 for a
    textured image-to-3D in place of the 30 for preview and refine).
- **The hours** assume an artist-agent who knows these pipelines, as the shipped B2 to B8 batches were made. They
  exclude the gate runs' machine time, the opus high-effort infantry review (`infantry-movement` skill), and the
  versus-probe re-read.
- **Prompts are not written here.** Per the skills, an Opus agent writes them at high effort after the lead approves the
  numbers. Each one carries:
  - real metres;
  - "a machine of a fictional army";
  - no baked lighting;
  - "No insignia, flags, patches, text or markings of any kind".

---

## 5. The gates each new unit must pass

These are the four gates the brief names, then the seams that also pin a new unit. Each one is named with what it
checks, and where a new unit has gone red there before.

**1. `tools/src/mesh_roster.test.ts`** (`pnpm test`).
- **What it checks:**
  - every `data/units` id has `art/meshes/<id>.glb` (team) or `art/meshes/vehicles/<id>.glb` (vehicle);
  - every vehicle GLB carries `idle` and `wreck`;
  - every rigged team carries `down` or `wreck`;
  - `hull.figures` equals the men the GLB draws, counted from the bytes by `<prefix>_death_root` nodes (GH-707 P3);
  - every foot team carries `hull.wounds`. Both new teams author `wounded_sarim`.
- **What it means here:** a unit file cannot land before its GLB. "No art-less unit ships" is the same rule, and the
  JSON and the GLB move in one commit. Until then the JSON is staged under `docs/campaign/special_units/gh1382/`, fitted
  on CI with `--also`, and guarded by a staged test on `tools/src/e5_staged.test.ts`'s pattern (faction `sarim`, no
  `unlock`, no staged id already shipped).

**2. `pnpm validate:meshes`** (`tools/validate_mesh_assets.py`; needs Blender).
- **What it checks:**
  - silhouette IoU at gameplay zoom **≤ `IOU_LIMIT` 0.88 against every other mesh**;
  - the wreck's distinctness from its own live pose;
  - framing;
  - the texture-memory ratchet per class (vehicle 80 MiB / 2560 px, infantry 32 MiB / 3072 px, never raised to let an
    asset in);
  - the textured-exemption sets;
  - the team mark, if one is declared.
- **Collision risks and levers (R):**

  | new unit | nearest silhouettes | lever |
  |---|---|---|
  | `sarim_carrier` | `scout_shachaf`, `apc_eitan`, `technical`, `gun_truck` | tracks and side skirts against wheels; the low, wide hull and the small off-centre cone turret |
  | `hmg_team` | `recoilless_team` and `atgm_cell` (two men and a tripod) | the gun's long barrel and box magazine at about 0.6 m height, with the gunner prone or kneeling behind it, against the recoilless team's shoulder-high tube and the ATGM's post sight |
  | `observer_team` | `sniper_team` (KDF, two men low), `manpad_team` | the upright tripod scope and the whip antenna |

- Run `git status art/meshes/` first: the gate walks untracked files too.

**3. Balance.**
- **What it checks:** `python3 tools/validate_balance.py --units data/units` and the three other CI invocations at ±18%
  (§2.5 is the scratch reading). Then `pnpm balance`, the §5.7 targets, which should be unmoved (R).
- **No tuning-constant change** (the issue's constraint, and the balance park).

**4. Portraits.**
- **How they are made:** `blender -b -P tools/render_unit_portraits.py -- --only=<id>` (team, plus lead for the two
  teams), then `tools/portrait_manifest.py`.
- **What checks them:**
  - `packages/app/src/ui/portrait.test.ts`: coverage. Add `hmg_team` and `observer_team` to its `FIGURE_TEAMS` literal;
  - `tools/src/portrait_framing.test.ts`.
- **These are renders,** so they wait for the lead's go like the rest.

**The other seams a new unit touches** (each one is a red test if missed):
- **`validate:data`** (schema, doctrine rules, garrison rule: `fires_from_building` needs no change, no mortar or rocket);
- **`tools/src/mesh_gait.test.ts`:** nothing under the ground, gait and facing per figure, and **every armed walker ships
  `moveFire`**. Both teams are armed;
- **`packages/sim/src/formation-template.test.ts`:** its literal `TABLE` pins every unit, 50 today, and gains 3 rows:
  - carrier `light_vehicle`;
  - HMG `support_weapon`;
  - observer `recon`.
- **`packages/data/src/index.ts` `units`:** **register the three LAST** (after `demo_tzav`), as `drone_swarm`,
  `aa_remetz` and `demo_tzav` were, so no earlier type index moves;
- **the versus roster-count and hash pins:** they move ONCE, deliberately, in the landing commit, because a room
  registers every non-held type. The sim's `pnpm test:determinism` must stay unmoved (data only; verify);
- **`pnpm store:threats`:** regenerate `threat-table.json` after a roster change;
- **`TEXTURED_*_EXEMPT` against their TS twins,** `check_provenance_register.py`, and `ATTRIBUTION.md`'s groups (a
  Meshy-origin asset must be added there);
- **the opus high-effort infantry review** before the two teams merge.

---

## 6. Open questions for the lead

1. **Identity.**
   - **The question:** may the Sarim seat field six Ashwar and Rif types (`technical`, `moto_rpg`, `rpg_team`,
     `militia_cell`, `mortar_crew`, `paramotor`)? The schema already allows it, and `gun_truck` is a precedent.
   - **The alternative:** nine new Sarim-built types. At this page's rates that is about 9 x 35 = 315 credits planned
     and about 60 Blender hours, instead of 70 and 25.
   - **Recommendation:** field them.
2. **`charge_squad` on a player-bought menu.**
   - **The question:** a suicide attack as a unit a player buys. Today it exists only as a campaign enemy.
   - **Recommendation:** keep it off the menu and on the bench.
3. **The armoured vehicle's shape.**
   - **Proposed:** an HMG carrier (front 130), which no KDF hull fears.
   - **Alternatives, each re-priced on the curve:**
     - an IFV with a low-pressure 73 mm gun (penetration about 300). It goes through every KDF APC, the Lavi's rear and
       half the time its flank, so it is a much larger fairness move;
     - an old tank (front about 250), a heavier facing test for the Namer's 30 mm.
   - **Seats:** 2, or 3 like the `technical`.
4. **Art numbers.**
   - **The budget:** 70 credits planned and 200 ceiling (about $1.40 / $4.00), and 25 to 35 Blender hours.
   - **The routes:**
     - the HMG gun as a Meshy part (recommended, maximum detail) against a code-built part (0 credits);
     - the two teams on the shipped B3 figure (0) against a new figure (35 each).
   - **Texture:** 2K or 8K (+5 a refine).
5. **A team mark on the carrier.**
   - **Today:** six vehicles carry the L3 shader-box mark (the Lavi line and the three KDF carriers).
   - **Recommendation:** give the carrier one (0 credits, about 1 hour, a row in `lavi_mark.py`, and `validate:meshes` then
     requires it), so it reads Sarim-side at play zoom (art principle 4).
6. **The production line.**
   - **Recommended:** one camp line (Option A).
   - **The alternative:** a symmetric second, role-filtered yard line (Option B, its own ticket).
7. **Fairness gate and order.**
   - **The proposal:** accept that the menu edit waits for GH-1381's ruling on `pnpm versus:probe`, while the units and
     art land first and unbuyable.
   - **The probe:** keep its weight-1 rule for menu units outside `VERSUS_SARIM`, or extend `VERSUS_SARIM`'s placed mix
     to name them. The latter changes the placed rooms, which is a separate reading.
   - **GH-990:** say whether the menu PR may ship with GH-990's cell still outside, as the medic did.
8. **Dock order:** append the nine after the six shipped entries (recommended), or group by class (foot, vehicles, air).
   A regroup moves the probe's tie-breaks.
9. **Names:** the descriptive register (*Tracked Carrier*, *Heavy MG Team*, *Observer Team*), or a named register for
   Sarim materiel. A named register would need a screen like `gh709/names.md`.
10. **Campaign:** the new types are available to mission authors and placed in no mission. Is that wanted, or should
    the first Sur mission that fields the carrier be a named follow-up?

---

## 7. Slices (1 to 5 days each, as the issue asks)

| slice | contents | gates | waits on |
|---|---|---|---|
| S1 | menu 6 -> 12 (the six shipped types, appended) | `validate:data`; `versus:probe -- --economy` at 96 / 192 seeds; mirror and placed byte-identical | GH-1381's probe ruling; Q1, Q2, Q7 |
| S2 | `sarim_carrier`: staged JSON + staged test, then Meshy, exporter, passes, then JSON into `data/units/enemy/` in the art commit | §5, all | Q3, Q4, Q5 approval |
| S3 | `hmg_team`: as S2, team path | §5, all; infantry review | Q4 |
| S4 | `observer_team`: as S3 | §5, all; infantry review | Q4 |
| S5 | menu 12 -> 15, the probe re-read, pins blessed once | `versus:probe`; versus pins | S1-S4 |

## 8. What this page does not decide

- No tuning constant.
- No shipped unit's stats or price.
- No mission.
- No versus rules file.
- No camp-line engine change.
- No change to the Sarim budget or the population cap. Both stay `provisional` (G3 Q7 and Q4).
