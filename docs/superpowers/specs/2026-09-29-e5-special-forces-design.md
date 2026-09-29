# E5: bought-only special forces and the anti-drone pair — design (WP-G-E5, #181)

**2026-09-29** · status: part 1 built: staged data, probes, names, garage tag; art and roster landing wait for the October Meshy credits (part 2) · base `main` `ce80b767` · implements G0 #11,
G7 (earned credits only, never Roar coins; ST8 §1, §7) and the 29 Sep swarm-and-laser addition ·
plan `docs/superpowers/plans/2026-09-29-e5-special-forces.md`.

**Scope, as split by the lead on 29 Sep (Q11).**
- **E5 (#181) is sim-free.** It covers the Zikit, the Gunship, and the Tzav's staged data and art.
- **E6 (#274) is Stage 4 or later, because it moves the sim.** It covers the Tzav's placed charge (G1),
  the drone swarm and the directed-energy beam, plus the missions that field swarms. This spec's
  §4 G1 and §8 are E6's design input.

Curve figures come from `tools/validate_balance.py` (roster plus drafts, base and `--max-tier
--upgrade-cost-factor 0.02`; n=35 for §1, n=37 for §8, which moves §1 by under 1.3 points). All
drafts pass `unit.schema.json`. `cost.logistics` must fit the curve (±18%); `unlock.price` is the
credit gate, which the curve never sees. No unit exceeds a roster maximum (front 700, sight 16, KDF
rof 625, signature floor 0.25).

## 1. The three bought-only units

### 1.1 `recon_zikit`: "Shmamit Deep Recon Team" (name decided 29 Sep)

**Fantasy.** Act II's weapon is information (storyline §1), and every KDF eye pays for seeing:
the drone meets MANPADs, the Shachaf cannot enter boulders, the sniper unmasks when it fires. The
Zikit is Idit's section's eyes on foot. *Zikit*: a chameleon.

| field | value | field | value |
|---|---|---|---|
| role | `support` (G3) | hp / armour | 320 / 10·10·10 |
| crew / supp. res. | 4 / 0.7 | speed | 0.9, foot |
| sight / optics | 14 / 1.8, thermal | signature / firing mult | 0.25 / 1.5 |
| weapon | `suppressed_carbines`: small_arms, range 6, acc 0.68, pen 10, dmg 16, supp 20, rof 160, collateral **0.05** | abilities | `mark_target`, `mark_tunnel`, `garrison` |
| cost | 290 logistics, 22 s, pop 1 | unlock | `{ "price": 4250 }` |
| upgrades | sensors, armour: 1,100 credits | curve | **+1.3%**; max tier +2.5% |

**Unique.** The only foot `mark_tunnel` carrier: a tunnel eye that walks boulders, garrisons, and
cannot be shot down, with the lowest signature and quietest weapon on the roster.
**Counter-play.** No enemy has thermal: proximity, `paramotor` or `loiter_drone` find it, and then
it loses the fight (pen 10 cannot hurt a `technical`).

### 1.2 `demo_tzav`: "Shiryonan Demolition Carrier" (name decided 29 Sep; GH-156)

**Fantasy.** Act III asks "can you stop?"; GH-156 is the faster, uglier answer (*"drops a box of
bombs near buildings"*). A *tzav*, a tortoise: it lays its charge and walks away.

| field | value | field | value |
|---|---|---|---|
| role | `engineer` | hp / armour | 2,600 / 380·200·120, top 40 |
| crew / supp. res. | 3 / 0.8, `can_embark: false` | speed / turn | 1.0 / 55, **`wheeled: true`** (G4) |
| sight / optics | 8 / 0.9 | signature / firing mult | 1.1 / 2.0 |
| weapon | `rws_mg`: hmg, range 7, acc 0.55, pen 18, dmg 26, supp 55, rof 220, collateral 0.12 | abilities | `demolish`, `smoke` |
| demolition | `demolition_method: "placed"` (**new; E6, absent from the staged JSON**), 3.0 s to set | charge (**new**) | fuse 8 s, blast 2.5 tiles, dmg 300, supp 120, withdraw 4 tiles |
| cost | 680 logistics, 34 s, pop 2 | unlock | `{ "price": 6500 }` |
| upgrades | armour, firepower: 2,360 credits | curve | **−0.3%**; max tier −6.0% |

**Unique.** The demolition completes after it leaves, or dies (exposed 3 s; the D9 must hold 2 s,
`demo_squad` 5 s). And it kills *around* the building: a collapse today kills only the garrison and
suppresses within 3 tiles, while this blast damages every soft unit within 2.5 tiles, own infantry
and civilians included. The D9 stays the clean tool.
**Counter-play.** RPGs defeat its front (550, 650, `kornet` 900); its 120 mm rear faces the enemy as
it withdraws; the blast punishes a careless escort, and civilian deaths cost Conduct.

### 1.3 `heli_peten_gunship`: "Peten Gunship" (name confirmed 29 Sep)

**Fantasy.** The Peten for the open ground of Sur and Naharin: pods for men in the open, the
cannon, half the missiles, hull for one more pass. The heaviest hammer the brigade can buy.

| field | value | field | value |
|---|---|---|---|
| role / domain | `gunship` / `air` | hp / armour | 820 / **47**·32·22 |
| crew / supp. res. | 2 / 0.8 | speed / turn | 3.0 / 100 |
| sight / optics | 15 / 1.6, thermal | signature / firing mult | 1.3 / 2.5 |
| weapons | `chain_gun_30` as the Peten; `hellfire` as the Peten at rof **3** (6) | weapon 1 | `rocket_pods`: **he**, range 8, acc 0.45, pen 60, dmg 140, splash 1.0, supp 140, rof 30, collateral **0.55** |
| cost | 450 logistics, 50 s, pop 3 | unlock | `{ "price": 8000 }` |
| upgrades | armour, sensors, firepower (pods): 3,185 credits | curve | **+2.2%**; max tier +10.9% |

**Deviation (29 Sep): front 55 → 47, lead 29 Sep, the AA-counter claim.** At 55 the Gunship
survived a firing pass against 1/2/3 ZU-23 gun trucks 100/100/93% (the Peten: 80/0/0), because a
pass is nose-on and the ZU-23's penetration is 40. At 47 it reads 93/0/0 and meets all three §3
probe claims. The curve moved from +1.9% to +2.2% (max tier +10.6% to +10.9%). Every other number
stands as approved. Bands: `docs/campaign/special_units/e5/numbers.md`.

**Deviation (29 Sep): armour track "Front +0, rest to sides and HP", lead 29 Sep.** The track's
+3/+5/+8 front put a max-tier Gunship back at 55 (100/100/93 against the max-tier Peten's
100/30/30). Front is now +0 at every tier; per tier hp/side/rear is +62·3·2, +131·4·4, +221·6·5
(was +58·2·1, +123·3·2, +205·5·3), HP solved to hold the curve's survivability, so the curve is
unchanged (+2.2%, max tier +10.9%). Max tier now reads 100/0/0.

**Unique.** The first `he` weapon on the roster; at 0.55 it clears both ROE thresholds (0.3 zone,
0.5 danger close). **Counter-play.** Pods (8) and missiles (10.5) sit inside `manpad` (13, ~75% to
penetrate) and `zu23_twin` (11). **Station time is dropped:** no air unit has endurance, and adding
it would nerf the Peten (G2).

## 2. Prices against the ladder

`LADDER_CREDITS` is 5,849, one optimal campaign. The peak single-mission payout is 310 (prices.md
§2).

| unit | credits | ladders | × peak | + all tiers |
|---|---|---|---|---|
| Zikit | 4,250 | 0.73 | 13.7 | 1,100 |
| Tzav | 6,500 | 1.11 | 21.0 | 2,360 |
| Gunship | 8,000 | 1.37 | 25.8 | 3,185 |

Inside prices.md §8's band (4,000–8,000, floor above `apc_kipod`'s 3,200). The Zikit is a late
first-campaign buy; the others take a second campaign, as D4 intends. No mission fields them, so
the ladder, `GATES` and `LADDER_CREDITS` must not move.

## 3. Balance method

1. **The curve, both passes.** Tightest stays `attack_drone` (+16.7% → +16.5%; max tier +12.3%,
   then the Gunship +10.9% at front 47). It prices hulls and guns, not abilities, air, the charge, the swarm or
   the beam; the probes carry those.
2. **`pnpm balance`** names six ids and cannot move; it runs as a guard.
3. **Probes** (`tools/src/backtest/e5-probes.ts`): the Gunship in `airContested` against 1–3 AA
   trucks (survival must fall, and at 3 not beat the Peten at 2); the Tzav against the D9 and
   `demo_squad` on a defended house (**moved to E6, #274**); the Zikit's detection tick at 4/6/8 tiles against the sniper.
   `balance-analyst` sets bands from the baselines at the numbers gate, never afterwards.
4. **`(bought)` playtest probes**, off the ladder: Zikit on `beit_sahwan_4_subterranean`, Tzav on
   `wadi_halam_5_depot` (**moved to E6, #274**), Gunship on `umm_zeitoun_4_clearance`.

## 4. Schema and engine gaps

- **G1: the placed charge — a schema extension AND sim code, flagged loudly.** `demolition_method`
  gains `"placed"` plus `placed_charge { fuse_s, blast_tiles, damage, suppression, withdraw_tiles }`.
  Set only on an explicit `demolish` order; the fuse lives in per-structure struct-of-arrays (no
  allocation); on expiry `destroyStructure` then `splashDirect`; the carrier withdraws via
  `nearestOpenTile`; events `chargeSet`/`chargeDetonated`; attribution outlives the carrier, so ROE
  is unchanged. Owner `sim-guard`; a moved hash moves in the same commit with its reason.
  (`tunnel_charge` is held-station too: no placed object exists yet.)
- **G2: station time.** It cannot be expressed, so it is dropped.
- **G3: `role` mixes doctrine with body.** `recon` reads as a vehicle in `FOOT_ROLES`,
  `can_embark` and `names.json`, so the Zikit takes `support`, as `breach_team` did.
- **G4: `dozer_d9` paths on the foot domain** (role `engineer`, no `wheeled`): it crosses boulders.
  The mirror of #247.
- **G5: `he` draws as a flat tracer** (`shellKindFor` returns null); route it to the `missile`
  streak, three-only.
- **G6: the six recon missions have no `resources`,** so a bought Zikit cannot be built there.

## 5. Landing while the art waits

**Recommended: stage the data outside the roster** in `docs/campaign/special_units/e5/`. A tools
spec validates it against the schema and asserts no staged id is in `@lions/data`'s `units`;
`validate_balance.py --also <dir>` fits the curve with it on CI. One PR per unit lands art and data
together, moving the file to `data/units/kdf/` and wiring `index.ts`, `SPRITE_MAP`,
`mesh-catalogue`, `VEHICLE_ROLE_PALETTE` and `names.json`.
**Rejected: a garage flag.** Garage, dock and debrief each filter `faction === 'kdf'`; a hidden list
is the `SPRITE_MAP` failure mode, and a missed surface shows an unbuyable `4250 cr` unit.
**Rejected: stand-in meshes.** A sheetless card prints "{id} — no sprite sheet", and a Peten GLB on
the Gunship is a twin the IoU gate cannot see (no new file). A placeholder, which the lead has
rejected before.

## 6. Art plan

Style bible §4: one preview per concept, each call announced first. The bible has no KDF vehicle
line; proposed: *"a vehicle of a fictional army in plain worn olive-drab paint"* (Q8).

**Zikit** (3 figures, 40 cr; neighbours `sniper_team`, `inf_squad`; levers: whip antenna ~80°, a
kneeling spotter with a tripod scope).

```
A single low-poly game-ready reconnaissance soldier, a soldier of a fictional army in a plain
olive-drab field uniform, black nylon plate carrier, tan suede boots, modern helmet with a plain
olive cover. Standing in a relaxed A-pose, arms slightly away from the body. A large radio
backpack with a tall whip antenna, and a short suppressed carbine slung across the chest.
Real-world scale, 1.78 metres tall. Olive cloth, black webbing, gunmetal. Plain even lighting,
no baked shadows, no ground, no base, no plinth, centred, one object, facing forward. No
insignia, flags, patches, text or markings of any kind.
```

**Tzav** (palette vehicle, 25 cr, 35 baked; neighbours `apc_kipod`, `ifv_namer`, `dozer_d9`;
lever: a boom holding a crate ahead of the bow, no turret).

```
A single low-poly game-ready heavy tracked armoured engineering vehicle with a folding
hydraulic arm at the front holding a large square demolition crate, a vehicle of a fictional
army in plain worn olive-drab paint. At rest, level. The arm reaches forward past the bow and
holds the crate raised at about 30 degrees, clearly ahead of the hull. Real-world scale, 8.5
metres long. Worn olive paint, gunmetal arm, black tracks. Plain even lighting, no baked
shadows, no ground, no base, no plinth, centred, one object, facing forward. No insignia,
flags, patches, text or markings of any kind.
```

**Gunship** (Blender from `heli_peten`'s source, 0 cr: stub wings with four pods, two tanks, a mast
dome). Named risk: IoU ≥ 0.88 against `heli_peten`; measure before spending. A Meshy pod part (25
cr, prompt in plan Task 8) only if Blender pods fail.

**Credits:** 65 planned, 140 ceiling (~$2.80); §8's pair is priced there. Then sheets,
`pnpm wreck:meshes`, icons, gates, provenance, AI disclosure.

## 7. Decisions (29 Sep)

Q1, Q10 and Q11 are the lead's answers. The others are taken defaults: the lead did not change
them. All are dated 29 Sep.

| # | question | decision · 29 Sep |
|---|---|---|
| Q1 | The §1 and §8 numbers | **approved** by the lead, all five units |
| Q2 | Gunship station time | dropped (G2) · taken default |
| Q3 | G1, or a held-station Tzav | build G1, in E6 · follows from Q11 |
| Q4 | Tzav: auto-withdraw; order-only charge; blast hurts own troops and civilians | yes, 4 tiles; yes; yes · taken default |
| Q5 | Pods at 0.55 collateral | keep · taken default |
| Q6 | Stage the data (§5) | stage · taken default |
| Q7 | Names: `narrative-designer`'s rule-3 screen before any JSON ships | **decided 29 Sep:** Shmamit Deep Recon Team (`recon_zikit`), Shiryonan Demolition Carrier (`demo_tzav`), Peten Gunship; ids unchanged |
| Q8 | The KDF vehicle line in the bible | adopt · taken default |
| Q9 | Fold G4 into #247; leave G6 without a hook | yes; accept · taken default |
| Q10 | The swarm's side | **enemy only, Sarim and Rif** (lead) |
| Q11 | Split the pair and all sim work into E6 | **split into E6** (lead) |
| Q12 | The beam also intercepts mortar and rocket rounds | not in v1 · taken default |

## 8. The anti-drone pair (added 29 Sep; moved to E6)

### 8.1 `drone_swarm`, "Drone Swarm" (Sarim, Rif)

**One entity, not N**: detection and `selectTarget` are O(N²), and one entity keeps per-entity RNG
streams stable. Thinning is data: `hp = count × member_hp`, live members `ceil(hp / member_hp)`.

| field | value | field | value |
|---|---|---|---|
| role / domain | `drone` / `air` | hp | 180 (12 × 15) |
| speed / sight | 2.6 / 10, optics 1.2 | signature | 0.6 (loud) |
| weapon | `bomblet_dive`: heat, range 1.5, acc 0.8, pen 160, dmg 90, splash 0.5, supp 60, rof 12, collateral 0.3 | cost / curve | 240 logistics, 16 s, pop 0 / **+6.2%** |

**New block `swarm: { count, member_hp, spread_tiles }`, read by sim code:** each dive spends one
member; rate of fire scales with live ÷ count; a single-target hit removes at most one member, a
splash hit up to `ceil(live × min(1, splash / spread))`. That is why rifles and MGs are poor
against it. Pen 160 beats `mbt_lavi`'s 150 mm rear. Drawn as one instanced mesh.

### 8.2 `aa_gachelet`, "Gachelet Beam Carrier" (KDF; *gachelet*: an ember)

| field | value | field | value |
|---|---|---|---|
| role | `aa`, wheeled | hp / armour | 1,100 / 40·25·20 |
| speed / sight | 1.6 / 12, optics 1.4, thermal | signature / firing mult | 0.9 / 1.5 |
| weapon | `beam`: **directed_energy** (new), range 9, acc 1.0, pen 5, dmg 80, rof 40, `can_target: ["air"]`, collateral **0.0** | beam block (**new**) | dwell 1.5 s, heat 12 s, cooldown 6 s |
| cost | 350 logistics, 30 s, pop 2 | unlock / curve | `{ "roe_rating_min": 85, "price": 470 }` / **+5.1%** (unused `interceptor` class as stand-in) |

**Directed energy in the sim:** resolves at once, with no projectile; must dwell uninterrupted, each
`dwell_s` delivering `damage` (one swarm member); fires for `heat_s`, then is silent for
`cooldown_s`; the target filter is the existing `can_target`, and pen 5 does nothing to armour;
bound by line of sight, and `raySmoke` on the line blocks the beam even when another unit spots the
target. Smoke is the counter-play; there is no weather system. **Renderer:** a three-only beam,
drawn as a line plus shimmer at the FX band; no Pixi parity owed. **Fiction:** in-world name, no
real system.

### 8.3 Sides and prices

**The swarm is an enemy threat (recommended).** A laser facing 4 air placements and 4 air
waves is dead content: the special-units design rejected an AA unit on that exact measurement
(its G6). The beam is worth building only if missions field swarms.

**The beam is not bought-only.** Swarm missions must stay winnable on the earned path, so it takes
the nine's shape: Conduct 85 **or** 470 credits (`(350 + 5 × 85) × 0.6` = 465, rounded up as prices.md §4 does). It
has zero collateral: the cleanest weapon in the game, earned by clean play. An enemy swarm has no
price. A KDF bought swarm is deferred: its counter-play would need an enemy beam.

### 8.4 E6 takes the pair and all sim work (decided 29 Sep)

The pair needs a new weapon class, the swarm damage model, dwell and heat, and missions that field
swarms. Those missions move the ladder, which E5 must not. That is Stage 4+. The Tzav's G1 is sim
code too, so E5 cannot land all three of its own units sim-free either.

- **E5** lands the Zikit and the Gunship with no sim change (the G5 render fix only), and carries
  the Tzav's data and art until G1 lands.
- **E6** takes G1, the swarm, the beam, a §5.7 target (swarm vs beam vs MG), and the missions:
  one `sim-guard` stream, one determinism review.

**E6 art**, announced when E6 opens: the swarm as an instanced palette drone (25 cr) and the beam
carrier as a palette vehicle (25 cr).

```
A single low-poly game-ready small quadcopter drone carrying a single small bomb under its body,
a civilian vehicle crudely converted for war, sun-faded dusty paint, welded plates. At rest,
level. Four exposed rotors on thin arms and a stubby body with the bomb slung beneath. Real-world
scale, 0.5 metres across. Dusty tan plastic, gunmetal, black rotors. Plain even lighting, no
baked shadows, no ground, no base, no plinth, centred, one object, facing forward. No insignia,
flags, patches, text or markings of any kind.
```

```
A single low-poly game-ready six-wheeled armoured truck carrying a large boxy directed-energy
turret with a wide round lens, a vehicle of a fictional army in plain worn olive-drab paint. At
rest, level. The turret sits high behind the cab, its round lens facing forward and raised
slightly. Real-world scale, 8 metres long. Worn olive paint, gunmetal turret, dark glass lens.
Plain even lighting, no baked shadows, no ground, no base, no plinth, centred, one object, facing
forward. No insignia, flags, patches, text or markings of any kind.
```
