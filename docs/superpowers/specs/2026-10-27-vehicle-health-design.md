# Vehicle health: design (GH-560)

Status: **proposal, for the lead. No tuning lands with this document.**
Lane C (sim). Written 2026-10-27 against `origin/main` at `0c86c10c` (v0.129.1).
GH-560 was deferred to Stage 4 on 2026-10-13; Stage 4 is now. Every number below
was measured on a scratch copy of the sim (switches in `tuning.ts`/`sim.ts`,
never committed, reverted by undoing the edit); §2 says how, and how many seeds.

The issue asks four things. The answers, measured, are in §0. The short version:
the HP bar lies because **the catastrophic roll, not HP, ends a vehicle**. Today
78-100% of armoured deaths are a roll that kills a hull whose bar still reads half
or more. Regeneration is a symptom: it is invisible in today's model because a
vehicle almost never dies of HP, and it becomes load-bearing the moment HP does
end vehicles. The cannot-penetrate fallback should stay. The Standoff target is
not a vehicle-health question.

## 0. Recommendation and the decisions it needs

**Recommended combination: "HP ends a vehicle" + regeneration paused by any
threatening hit + keep the fallback + Standoff stays report-only.**

1. **Q2 (what ends a vehicle): HP, and only HP.** The §5.4 table keeps its four
   recoverable results (crew shaken, mobility, firepower, both); the catastrophic
   result stops being a separate kill roll (weight 0) and a hull dies when its HP
   reaches 0. A penetration costs **at least a third of the hull (34% of max HP),
   scaled by overmatch up to x1.5** (`max(damage, 0.34 x maxHp x (1 + shift/60))`,
   where `shift` is the existing 0-30 overmatch shift). That is 2 hits for heavy
   overmatch (an RPG into an Eitan, a 120 mm into a Namer), 3 for a 120 mm into a
   Lavi's front or a Kornet into it, 3 for a ZU-23 into a Peten (table in §5.2).
   Measured: luck deaths 78-100% -> **0%**; the bar at the killing shot reads a
   median 0.07-0.36 instead of 0.83-1.00; lethality per fight is unchanged
   (mirror 5.33 -> 5.28 vehicle deaths a fight; KDF assault 0.97 -> 0.91), and a
   kill takes longer (Lavi duel median 17.5 s -> 37.5 s), which is the window in
   which a player can pull a damaged hull back.
2. **Q1 (regeneration): keep it, but a hit that could have come through restarts
   the 10 s delay** (option R5: a non-penetrating round that "threatens", the
   existing test `splash > 0 || pen >= armorSide`, writes `lastDamagedTick` like a
   penetration does). The bar no longer refills while a tank is still being
   engaged by guns that could kill it. Off, slower, a lower cap and "only when
   unseen" were all measured: on today's model each is inert (no pin, no plan, no
   versus cell moved); under the HP model each one swings KDF v Sarim versus up
   to 20 points toward Sarim (§4.2).
3. **Q3 (Standoff): do not gate it.** Keep it report-only. It fails at every
   option measured, by two orders of magnitude (a cell kills an APS Lavi in 0.0-0.5%
   of 200 engagements; it needs ~23%), because the cell sees 10 tiles, the Lavi
   12 with thermal, and the Trophy takes 1.05 of the 1.32 missiles a cell gets off.
   That is doctrine and data (spotting, APS saturation), not vehicle health (§6).
4. **Q4 (cannot-penetrate fallback): keep it.** Removing it, or restricting it
   to targets with any real chance (P(pen) >= 0.005), fails §5.7 (airDefence (a)
   at both tiers; "Air is contested" at max tier on removal), fails two plans,
   moves the ladder 5961 -> 5949 and swings KDF v Sarim to KDF (placed force
   66.7-85.4% KDF, every placed cell outside 60/40; §7).

What the recommendation costs, measured (§8): every §5.7 target passes at both
tiers; the relief golden hash moves (flat and orders do not); `LADDER_CREDITS`
5961 and `ROSTER_MAX` 30 do not move; one plan seed fails
(`wadi_halam_5_depot (gate open)`, seed 22, a defeat) and needs `mission-author`.
**And it does not pass the versus bar as it stands:** KDF v Sarim leans Sarim,
and 5 of the 16 offered cells read outside 60/40 (60.4-64.6%; today 0 of 16). No
HP-model setting measured keeps all 16 inside: 2 hits at heavy overmatch leans
Sarim, 3 hits leans KDF by more (§5.3, §8). Shipping it therefore needs either a
versus re-price in data, or the residual-roll calibration of decision 2, before
it reaches a versus room.

### Decisions for the lead (numbered; recommendation first in each)

1. **What ends a vehicle?** (a) HP only, catastrophic roll removed, a penetration
   costs >= 34% x (1 + overmatch/60) [recommended]; (b) HP plus a kill roll that
   scales with HP already lost (measured as "D": honest-ish, luck 36-66%, but KDF
   v Sarim goes 60-76% Sarim, every faction cell outside); (c) a heavier penetration alone
   (25% floor, roll kept: luck 62-95%, five versus cells outside); (d) today.
2. **The hits-to-kill calibration, and how versus is re-centred.** The HP model
   is a step function: 2 hits at heavy overmatch (34%/60) versus 3 (32%/75 or
   30%/90) moves KDF v Sarim by ~20 points (Sarim 51-65% vs KDF 59-79%, §5.3, §8).
   (a) 34%/60 and re-centre versus in data (prices or the versus force)
   [recommended: the model stays simple and honest, and the lean is the smaller
   of the two]; (b) 3 hits plus a residual kill roll on an already-damaged hull
   (option E: the roll's weight x the HP lost BEFORE the hit, so a full hull never
   brews up). Its slope is a continuous knob: at slope 100 it measured KDF-lean
   (up to 72.9% KDF, 8 of 16 cells outside), and 34%/60 is the Sarim-lean end, so a slope
   between them is the in-model way to re-centre; it brings back 14-28% of kills
   at a bar of 0.5-0.68 (after one visible heavy hit, never from a full bar).
3. **Regeneration for armour.** (a) keep, paused by threatening hits (R5)
   [recommended]; (b) keep as today; (c) only when unseen by the enemy (R4); (d)
   slower (/4); (e) capped at 40%; (f) off. (c)-(f) cost KDF up to 20 points in
   KDF v Sarim versus under the HP model; the workshop (`kdf_workshop`, 1%/s) remains
   the repair path, and field works are dropped in versus rooms.
4. **Standoff (Sarim).** (a) stays report-only, with a follow-up doctrine/data
   issue (cell sight vs Kornet range, a spotter, APS saturation) [recommended];
   (b) gate it as written (fails at every option measured); (c) restate it as a
   saturation target, e.g. "three cells mission-kill an APS MBT >= 50%" (54% today,
   51% under the recommendation), and gate that.
5. **The fallback.** (a) keep [recommended]; (b) restrict to P(pen) >= 0.005;
   (c) remove.
6. **Who follows up:** `mission-author` re-scripts `wadi_halam_5_depot (gate
   open)` seed 22 (it fails in every HP-model run, 12 of 12, and in none of the
   regen-only or roll-only runs); a versus re-pricing pass
   (data) if the lead wants KDF v Sarim re-centred under the new model.

## 1. What exists today (read from the code)

**The hit.** `resolveHit` (`packages/sim/src/sim.ts`). A soft target (front
armour under `SOFT_ARMOR_LIMIT`, 30 mm) takes the weapon's `damage`. A hard target
rolls P(pen) on the face it presents (`presentedArmor`, `penZ`); on a penetration it
takes the weapon's `damage` (`applyDamage`) and, if still alive, `rollComponent`
draws once on the shooter's stream over the §5.4 weights (crew shaken 45, mobility
20, firepower 15, both 12, catastrophic 8), with overmatch moving
`clamp((z - 1) x 10, 0, 30)` points from crew shaken to catastrophic.
`catastrophic` calls `destroy`. A non-penetration is a bounce: suppression only,
and it does **not** write `lastDamagedTick`.

**Who is hard.** KDF: Lavi (3000 hp), Namer (2200), Eitan (1600), Kipod (1750),
D9, Tzav, Shachaf, the ambulance, the Remetz carrier, the SPGs, and the
helicopters (Peten 640 hp, front 45). **No Sarim unit is hard**: technical and gun
truck are soft. So vehicle health is a KDF-only property in the campaign, and an
asymmetric one in KDF v Sarim versus.

**What a penetration costs in HP today.** The weapon's damage: Kornet/Spike 400
(13% of a Lavi), the 120 mm 520 (17%), RPG-7 300 (10%; 19% of an Eitan), ZU-23 85
(13% of a Peten).

**Regeneration.** `stepUpkeep`: once `tickCount - lastDamagedTick >=
REGEN_DELAY_TICKS` (200, 10 s), every unit but a swarm gains `REGEN_FRAC` (16 =
0.00024 of max HP a tick, 0.49%/s; a Lavi 14.6 hp/s) up to `REGEN_CAP` (0.7). A
field work's aura raises rate and ceiling. It applies to infantry and vehicles
alike; only `applyDamage` and the swarm paths write `lastDamagedTick`, so a tank
taking bounces regenerates.

**The fallback.** `selectTarget` ranks a target the weapon cannot "hurt"
(`weaponHurts`: soft, or P(pen) on the face shown >= `PEN_HURTS_MIN` 0.05) as a
last resort: never chosen over a hurtable target, but fired at when it is the only
one (PR 570).

**What the player sees.** The HP bar; the vehicle scar and wisp
(`vehicle-damage.ts`) read the same HP through `structureHpBand` (a scar from band
5, HP <= 62.5%; the wisp from band 2, <= 25%); the HUD's component states
(`combat-state.ts` `vehicleDamage`: immobilised, gun out, out of action, slowed).
One penetration today leaves a Lavi at band 7, so a Lavi almost never shows its
scar, and regen to 70% keeps it at band 6. **Nothing downstream reads the
`catastrophic` component result** (grep of `packages/app` and `packages/render`):
death VFX key off `destroyed`, so removing the roll costs no presentation work.

## 2. Method

**Scratch switches.** Seven integer constants in `tuning.ts` and their reads in
`sim.ts`, all defaulting to today's behaviour: regen mode (today / armour off /
armour /4 / armour cap 0.4 / armour only when unidentified / paused by a
threatening bounce), a penetration HP floor and its overmatch divisor, the
catastrophic weight's percent at full HP and its slope per percent HP lost, and
the fallback mode. **The scaffold was falsified first:** with every switch at its
default all 107 determinism tests held (flat 1258746094, relief 1070599391, orders
2559269335, the economy, digest and wounded pins), so every move below is the
option, not the scaffolding. "Armour" means `!isSoft` (helicopters included).

**Instruments, and seeds.**
- `pnpm balance`, both tables, as shipped (ATGM 400 launches, APS 400, urban and
  smoke 60 seeds a ratio, Lanchester, Air 30 seeds a case, airDefence 60).
- `pnpm playtest` (30 seeds a plan, 37 winning plans and every control; the ladder
  on seed 424242).
- `pnpm versus:probe`, the bar in `docs/agent-notes/sim-and-orders.md`: 96 seeds
  per spawn order on offered cells only: the mirror on the four fair maps,
  KDF v Sarim placed force on Tel Marum and Wadi Tarfan, the `--economy` arm, and
  the `--tunnels` arm's cell 3. The tunnel arm (14 min a run) was run for today
  and five combinations only (C1, C2, C9, C10, C11).
- `pnpm test:determinism`.
- A scratch probe (`vh-probe.ts`, not committed), 200 seeds per scenario: duels
  and small fights on open ground (3 Spikes vs a Lavi at 7 tiles; Lavi v Lavi at 9;
  2 RPGs vs an Eitan at 3.5; flank shots; a Namer's 30 mm vs a Lavi), RPG pairs
  every 30 s and 60 s on a weaponless Lavi (5 waves; the regen question), a KDF
  mirror melee (2 Lavi, Namer, Eitan, 3 squads, Spike team a side), a KDF assault on
  a halted Sarim position (2 Lavi, Eitan, 2 squads, Spike vs 2 RPG, 2 Kornet,
  recoilless, 3 militia, technical, gun truck), the Standoff (1, 2 and 3 Kornet
  cells at 8.5 tiles vs a live Lavi, 3 missiles each), and a replica of "Air is
  contested" (30 seeds a case).

Totals: 22 full instrument runs (today, 11 single options, 10 combinations) and
one versus-only run (C10); the tunnel arm ran six times. About 40 probe runs.
Combination labels: C1 H3+R4, C2 H3g+R4, C3 H3+R1, C4 H3+R2, C5 H3+R3, C6
H3g+R0, C7 H3m+R4, C8 H3m+R0, **C9 H3+R5 (the recommendation)**, C10 H3+R0 (versus
and tunnels only; its other instruments are H3's, the same switches), C11 E+R5. Readings at 96 seeds carry ~5 points of sampling noise
(the agent note's Tel Marum example read 68.8% at 48 seeds and 55.2% at 96), so a
cell at 60.4-62.5% is a lean, not a verdict; one at 65%+ is.

**Probe metrics.** *Kill cause*: catastrophic roll or HP. *Bar at death*: the HP
fraction the bar showed on the tick before the killing hit. *Luck death*: a
catastrophic kill of a hull whose bar read >= 0.5, the complaint in GH-560.
*One-shot*: an HP death from a bar >= 0.7 (a single big hit, or a volley landing on
one tick), visible and therefore not a lie. *TTK*: median seconds to the kill.

## 3. Today, measured

| scenario (200 seeds) | vehicle deaths/run | by the roll | luck deaths | bar at death (median) | TTK |
|---|---|---|---|---|---|
| KDF mirror melee | 5.33 | 88% | 78% | 0.83 | 42.3 s |
| KDF assault on Sarim | 0.97 | 98% | 92% | 1.00 | 35.8 s |
| Lavi v Lavi, 9 tiles | 0.51 | 99% | 94% | 1.00 | 17.5 s |
| 3 Spikes v Lavi, 7 tiles | 0.17 | 97% | 97% | 0.87 | 2.6 s |
| 2 RPGs v Eitan, 3.5 tiles | 0.18 | 100% | 97% | 1.00 | 1.1 s |
| RPG pairs every 30 s v cold Lavi | 0.57 (3.13 waves) | 100% | 100% | 1.00 | 60.7 s |

This reproduces the Lavi investigation: 88-100% of kills are the roll, and most
of them kill a hull whose bar still reads full. The waves scenario reads the same
at 30 s and 60 s spacing because the roll, not accumulated damage, does the killing.

## 4. Q1: should vehicles regenerate?

### 4.1 Each regen option alone, on today's model

| option | §5.7 | playtest | determinism | versus (all offered cells) |
|---|---|---|---|---|
| today | all pass; Air max tier 3 trucks 30% | 37/37, ladder 5961, roster 30 | — | all within 60/40 |
| R1 armour off | all pass; Air max tier 3 trucks 27% | identical | no pin moved | all within |
| R2 armour /4 | all pass; Air max tier 27% | identical | no pin moved | all within |
| R3 armour cap 0.4 | all pass; Air max tier 27% | identical | no pin moved | all within |
| R4 armour only when unidentified | all pass; Air max tier 27% | identical | no pin moved | all within |
| R5 a threatening bounce restarts the delay | all pass; Air max tier 27% | identical | no pin moved | all within |

On today's model regeneration is **inert**: the probe's luck-death share stays
76-78% in the mirror and the bar at death 0.83 for every mode, because almost no
vehicle dies of HP. Turning it off fixes nothing a player can see.

### 4.2 Regen under "HP ends a vehicle" (34%/60)

| regen | probe: RPG waves deaths/run | KDF v Sarim placed (KDF share) | economy | tunnels cell 3 |
|---|---|---|---|---|
| today (R0) | 0.41 | S53.1, S57.3, S51.0, S59.4 | K58.3, **S62.5**, S52.1, S51.0 | K57/S39, K47/S49, **K35/S61**, **K36/S60** |
| **R5 bounce restarts** | 0.41 | S54.2, S57.3, S53.1, S59.4 | K56.3, **S64.6**, S52.1, =50 | **K60/S36**, K45/S51, **K34/S62**, **K37/S59** |
| R2 /4 | 0.44 | S57.3, S59.4, **S66.7**, S56.3 | S55.2, **S67.7**, **S66.7**, **S61.5** | not run |
| R3 cap 0.4 | 0.44 | S58.3, **S62.5**, **S68.8**, **S64.6** | S52.1, **S68.8**, **S66.7**, **S66.7** | not run |
| R4 unseen only | 0.44 | **S60.4**, **S65.6**, **S66.7**, **S65.6** | S55.2, **S70.8**, **S71.9**, **S67.7** | K51/S45, **K33/S63**, **K27/S69**, **K25/S71** |
| R1 off | 0.44 | **S60.4**, **S65.6**, **S67.7**, **S65.6** | S55.2, **S70.8**, **S71.9**, **S68.8** | not run |

(Cells in order: Tel Marum KDF friendly, Tel Marum Sarim friendly, Wadi Tarfan KDF
friendly, Wadi Tarfan Sarim friendly; bold is outside 60/40. Today: K53.1, K55.2,
K56.3, K55.2 placed; K57.3, S54.2, K53.1, K55.2 economy; tunnel cell 3 K52/S44,
K40/S56, K42/S54, K41/S55, all within.)

Once HP is the meter, regeneration is what lets a KDF hull carry damage from one
engagement to the next; every weaker form costs KDF 4-20 points a cell against a
side with no armour to lose. The playtest reads the same for every regen mode under the
HP model (36/37, the one seed of §8).

**Readability.** Today a tank at 30% that is still being engaged refills to 70%
after 10 s without a penetration, because a bounce never writes the regen clock.
R5 removes exactly that and nothing else; R4 makes "pull back out of sight to
patch up" a rule the player can learn, at the versus cost above; R1 makes the bar
monotonic in a fight and in a mission, and leaves the workshop as the only repair.

## 5. Q2: what ends a vehicle, and what makes the bar honest?

### 5.1 Options, probe (200 seeds a scenario)

| option | mirror: deaths, luck, bar at death, TTK | assault: deaths, luck, bar, KDF win | Lavi v Lavi: luck, TTK |
|---|---|---|---|
| today | 5.33, 78%, 0.83, 42 s | 0.97, 92%, 1.00, 72.5% | 94%, 17.5 s |
| H1 penetration costs >= 25% max HP, roll kept | 5.33, 76%, 0.75, 42 s | 0.99, 91%, 1.00, 72.0% | 83%, 17.5 s |
| H2 roll scales with HP lost (25% at full, +300% x lost) | 5.50, 88%, 0.83, 42 s | 1.02, 96%, 0.87, 70.5% | 95%, 24 s |
| **H3 HP only, >= 34% x (1 + shift/60), no roll** | **5.28, 0%, 0.28, 55 s** | **0.91, 0%, 0.23, 76.5%** | **0%, 37.5 s** |
| D H3's cost + roll x HP lost (slope 100) | 5.46, 41%, 0.51, 42 s | 0.96, 36%, 0.49, 75.5% | 58%, 24 s |
| H4 overmatch into HP (x(1 + 0.07 shift)), roll fixed at 8% | 5.80, 9%, 0.47, 36 s | 1.02, 18%, 0.27, 74.5% | 20%, 24 s |
| H3m HP only, 32%/75 | 4.99, 0%, 0.21, 74 s | 0.86, 0%, 0.15, 80.0% | 0%, 37.5 s |
| H3g HP only, 30%/90 | 4.98, 0%, 0.27, 75 s | 0.84, 0%, 0.25, 80.5% | 0%, 37.5 s |

H1 and H2 alone do not fix the bar: the roll still does the killing at a high
bar. Only taking the roll out (H3 family) brings luck deaths to zero. D and H4 keep
a roll and keep a share of luck deaths (H4 also lets a 120 mm one-shot an Eitan or
Namer: one-shot HP deaths are 32% of its mirror deaths). Lethality per fight barely moves for any option: a
fight still ends when one side's guns have landed enough; what changes is how the
bar reads on the way there. The "Air is contested" replica (base tier) reads
73/0/0% for every Q1 and Q2 option: a ZU-23 rarely penetrates a Peten's front, and when it does, the HP model
and today's roll kill in about the same number of hits.

### 5.2 Hits to kill (nominal facing, no obliquity)

| matchup | P(pen) | overmatch shift | today: P(roll kills)/pen, HP hits, mean pens to kill | H3 34%/60 | H3m 32%/75 | H3g 30%/90 |
|---|---|---|---|---|---|---|
| 120 mm v Lavi front | 1.00 | 28 | 36%, 6, 2.59 | 3 | 3 | 3 |
| 120 mm v Namer front | 1.00 | 30 | 38%, 5, 2.39 | 2 | 3 | 3 |
| 120 mm v Eitan front | 1.00 | 30 | 38%, 4, 2.24 | 2 | 3 | 3 |
| Kornet v Lavi front | 0.97 | 8 | 16%, 8, 4.70 | 3 | 3 | 4 |
| Kornet v Lavi side | 1.00 | 30 | 38%, 8, 2.57 | 2 | 3 | 3 |
| RPG-7 v Lavi side | 1.00 | 27 | 35%, 10, 2.82 | 3 | 3 | 3 |
| RPG-7 v Eitan front | 1.00 | 30 | 38%, 6, 2.48 | 2 | 3 | 3 |
| ZU-23 v Peten front | 0.15 | 0 | 8%, 8, 6.08 | 3 | 4 | 4 |

Today's mean pens-to-kill for heavy overmatch is ~2.2-2.8; an HP model can only
say 2 or 3. That is the knob of decision 2.

### 5.3 The full instruments for the Q2 options (regen as today)

| option | §5.7 | playtest | relief pin | KDF v Sarim placed | economy | mirror |
|---|---|---|---|---|---|---|
| today | pass | 37/37 | 1070599391 | K53.1, K55.2, K56.3, K55.2 | K57.3, S54.2, K53.1, K55.2 | W58.3, =50, W51, E51 |
| H1 | pass; Air max 3 trucks 30% -> 0% | 37/37 | unmoved | S51.0, S54.2, S52.1, **S60.4** | S52.1, **S60.4**, **S60.4**, **S61.5** | **W60.4**, E54.2, W58.3, W54.2 |
| H2 | pass; Air max 17% | 37/37 | 975918665 | K57.3, K57.3, K53.1, K55.2 | K53.1, S52.1, S56.3, S53.1 | W51, E53.1, W53.1, E51 |
| H3 | pass; Air max 0% | **36/37** | 1483138559 | S53.1, S57.3, S51.0, S59.4 | K58.3, **S62.5**, S52.1, S51.0 | **W62.5**, W51, =50, E52.1 |
| D | pass; Air max 0% | **36/37** | 2933176153 | **S65.6, S68.8, S75.0, S68.8** | **S60.4, S75.0, S76.0, S74.0** | W57.3, E55.2, E53.1, E52.1 |
| H3g (+R0) | pass; Air max 0% | **36/37** | 3256918887 | **K79.2, K74.0, K66.7, K61.5** | **K72.9, K61.5, K69.8, K68.8** | **W61.5**, W54.2, E54.2, =50 |
| H3m (+R0) | pass; Air max 0% | **36/37** | 2149534927 | **K78.1, K71.9, K66.7**, K59.4 | **K74.0**, K58.3, **K70.8, K62.5** | **W61.5**, W56.3, E54.2, W52.1 |
| E: H3m + roll x HP lost before the hit, slope 100 (+R5) | pass; Air max 0% | **36/37** | 2149534927 | **K65.6, K72.9**, K56.3, K55.2 | **K68.8**, K51.0, **K60.4, K64.6** | W55.2, W54.2, W59.4, W52.1 |

Every §5.7 target that is not about armour (ATGM Pk 0.67/0.77 counts
penetrations, not kills; APS 0.73; urban, smoke, Lanchester) is byte-identical
under every option. "Air is contested" passes everywhere; at max tier the
3-truck case falls from 30% to 0-17% (the target is <= 50%). airDefence (a)-(d)
unchanged. `LADDER_CREDITS` 5961 and `ROSTER_MAX` 30 never moved. The one plan
failure is §8's.

**Player readability.** H3 is the only family where the bar is the truth: every
death happens at HP 0, and half of a fight's kills come at a bar under 0.3. The
damage art that already reads HP finally shows: the scar (band 5, HP <= 62.5%)
from the first heavy penetration (one that costs more than 37.5%) and always from
the second, the wisp (band 2, <= 25%) on a three-hit hull after its second hit.
Today one penetration leaves a Lavi at band 7, and regen holds it at band 6.
Sudden deaths remain only where they are readable: a volley or a heavy round that
takes a third to a half of the bar at once. The component results stay
the "recoverable losses" §5.4 asks for, and now carry most of the probabilistic
texture (heavy overmatch shifts weight from crew shaken to mobility and firepower,
since catastrophic is 0).

## 6. Q3: should Standoff (Sarim) be a gated §5.7 target?

GDD §5.7 (extended): an ATGM cell firing from >= 8 tiles wins the cost exchange
against an APS MBT over a 3-missile engagement. Probe, 200 seeds, cell at 8.5
tiles, a live shipped Lavi (Trophy), the cell withdrawn after its third launch:

| | cells | Lavi destroyed | Lavi destroyed or disabled | cell killed before its 3rd launch | missiles/run | exchange/run (logistics) |
|---|---|---|---|---|---|---|
| today | 1 | 0.5% | 10% | 89.5% | 1.32 | -206 |
| today | 2 | 11.5% | 34.5% | 68% | 3.48 | -217 |
| today | 3 | 15% | 54% | 53% | 5.93 | -237 |
| H3 | 1 | 0% | 8.5% | 91% | 1.31 | -214 |
| H3 | 3 | 13% | 51% | 56% | 6.05 | -275 |

The cell needs P(kill) above ~23% to win the exchange (235 against 906 at a 90%
death rate); it has 0.0-0.5% under every option measured, today included. The cause is not vehicle health: the cell's sight is 10
tiles against the Lavi's 12 with thermal, its first launch multiplies its
signature x5, and the Trophy takes 1.05 of its 1.32 missiles. Making one Kornet
kill a Lavi would break the honest bar. **Recommendation: keep it report-only**,
and open a doctrine/data issue (spotting for the cell, the Kornet's 14-tile range
it cannot use unspotted, salvo saturation against a 3-round Trophy magazine). If
the lead wants a gate, a saturation form ("three cells mission-kill an APS MBT in
>= 50%": 54% today, 51% under H3) is measurable now.

## 7. Q4: the cannot-penetrate fallback

| option | §5.7 | playtest | pins | versus |
|---|---|---|---|---|
| keep (today) | pass | 37/37, ladder 5961 | — | all within |
| F1 remove (`if (!hurts) continue`) | **FAIL**: airDefence (a) 3.48 / 3.45 (>= 3.5); Air max tier 3 trucks **100%** (<= 50%) | **35/37** (`wadi_halam_1_fords` seed 14, `wadi_halam_5_depot` seed 6); ladder **5949** | flat 3991404656, relief 3737155265 | KDF v Sarim **K69.8-85.4** placed, **K62.5-86.5** economy; mirror **W62.5** |
| F2 restrict to P(pen) >= 0.005 | **FAIL**: airDefence (a) 3.48 / 3.45; Air passes (73/0, 100/30) | **35/37** (same two); ladder **5949** | same as F1 | **K66.7-85.4** placed, K59.4-84.4 economy; mirror **W61.5, E60.4** |

F2 keeps the ZU-23's long chance at a max-tier Peten's 50 mm front (P 0.019), so
"Air is contested" survives it. It still fails airDefence (a), and the mechanism
was traced (60 seeds, MG arm): with the fallback the swarm dives 209 times on the
squad and 41 on the Eitan, whose 220 mm front its 160 mm bomblet cannot
penetrate; without it, 209 and 0. The claim counts dives, so 4.17 members spent
becomes 3.48: the MG did not get better, the swarm stopped wasting itself.

It is the fallback that keeps Sarim's massed small arms and RPGs firing at KDF armour (bounce
suppression, and the rare side or rear penetration); without it KDF v Sarim stops
being a contest. **Keep it.** Readability is unchanged, and under H3 each
fallback round that does get through costs a third of the bar, so it is visible.

## 8. The recommended combination, measured

H3 (34%/60, no roll) + R5 (a threatening bounce restarts the regen delay) +
fallback kept.

| instrument | today | recommended (H3 + R5 + fallback kept) |
|---|---|---|
| §5.7, base | all pass; Air 73% / 0% | all pass, every number identical |
| §5.7, max tier | all pass; Air 100% / 30% | all pass; Air 100% / **0%** (target <= 50%); every other number identical |
| `pnpm playtest` | 37/37 plans on 30/30 seeds; every control loses | **36/37**: `wadi_halam_5_depot (gate open)` wins 29/30 (seed 22, defeat); every control still loses on 30/30; slowest-seed times move (Wadi Halam I 7.8 -> 4.9 min) |
| `LADDER_CREDITS` / `ROSTER_MAX` | 5961 / 30 | 5961 / 30 |
| determinism | — | relief 1070599391 -> **1483138559**; flat, orders, economy, digest, wounded unmoved |
| versus mirror (4 maps) | W58.3, =50, W51, E51 | **W60.4**, =50, =50, E52.1 |
| KDF v Sarim placed | K53.1, K55.2, K56.3, K55.2 | S54.2, S57.3, S53.1, S59.4 |
| KDF v Sarim economy | K57.3, S54.2, K53.1, K55.2 | K56.3, **S64.6**, S52.1, =50 |
| tunnels cell 3 | K52/S44, K40/S56, K42/S54, K41/S55 | **K60/S36**, K45/S51, **K34/S62**, **K37/S59** |
| probe: luck deaths (mirror / assault / Lavi duel) | 78% / 92% / 94% | **0% / 0% / 0%** |
| probe: bar at death, median | 0.83 / 1.00 / 1.00 | 0.28 / 0.23 / 0.07 |
| probe: deaths per fight (mirror / assault) | 5.33 / 0.97 | 5.28 / 0.91 |
| probe: Lavi duel TTK | 17.5 s | 37.5 s |
| Standoff, 1 cell / 3 cells: Lavi destroyed | 0.5% / 15% | 0% / 13.5% |

R5 changes nothing measurable on top of H3 except the readability case it
targets: the relief pin, the playtest and every probe fight are identical to H3
with today's regen (the 3-cell Standoff alone moves, 13.0% -> 13.5% destroyed),
and the versus readings differ from C10 by 0-3 games a cell in every arm, inside
the noise. Versus-wise R0 and R5 cannot be told apart at 96 seeds (C10: 4 cells
outside, C9: 5).

The versus lean is the open item. It is the faction asymmetry of §1 made visible:
Sarim has no armour, so a model that lets KDF hulls lose HP honestly moves only
one side. Today's roll and regen together happen to sit near the centre.

## 9. Pins and tests that would move

- **Golden hashes** (`packages/sim/src/determinism.test.ts`): relief 1070599391
  moves under every H-family option (H3 1483138559; H3+R5 in §8); flat
  1258746094 and orders 2559269335 do not (the flat replay never puts a gun on
  armour; PR 570 found the same). Removing or restricting the fallback also moves
  flat. Economy, digest and wounded pins hold. Update in the same commit as the
  tuning change, with the reason.
- **`LADDER_CREDITS` 5961 / `CAMPAIGN_CREDITS` 5961, `ROSTER_MAX` 30**: unmoved by
  every Q1/Q2 option; 5949 under either fallback change.
- **Plans:** `wadi_halam_5_depot (gate open)` seed 22 (a defeat) under every
  HP-model option; for `mission-author`.
- **Unit tests.** `vitest run packages/sim` under the recommendation: 17 of 1955
  fail. Eight are the scratch scaffold, not the option (`snapshot-schema.test.ts`
  sees the extra field the experiment added; an implementation keeps the HP-before
  in a local). The rest assert today's draws or today's regen and would be
  updated in the change: `combat.test.ts` (2: the mobility-kill and the rifle/ATGM
  penetration specs), `mobility.test.ts` (2, combat_ineffective),
  `air-forced-landing.test.ts` (1), `focus.test.ts` (1), `hit-suppression.test.ts`
  (1), and the two relief-pin specs.
  `works-model.ts` compares a heal rate to `REGEN_FRAC`; it is unchanged by R5.
- **GDD §5.4** text: the table keeps four results and "Catastrophic" becomes the
  name of the HP-0 brew-up; §5.7's Standoff line gets "report-only".

## 10. What this did not measure

- Real players. `pnpm playtest` proves a plan wins, not how a fight feels.
- The garrison case (`pnpm balance` is blind to it; vehicles do not garrison).
- Max tier in the probe (base roster only); `pnpm balance` and `pnpm playtest`
  ran both tiers.
- A data re-price of versus under the HP model.
- Per-tick cost: the change is two integer multiplies on a penetration and one
  write on a threatening bounce; nothing per tick.
