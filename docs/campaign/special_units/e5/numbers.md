# E5 special forces: the numbers (GH-181)

The single record of the numbers for the three bought-only units staged in this directory
(`recon_zikit`, `demo_tzav`, `heli_peten_gunship`). The design and its reasoning are in
`docs/superpowers/specs/2026-09-29-e5-special-forces-design.md`; this file holds what was
approved, what was measured, and the probe bands.

**The Task 4 probe bands at the end of this file are frozen from the commit that adds them
(2026-09-29).** They are pinned by `tools/src/backtest/e5-probes.test.ts`; a red probe is content
to retune, never a band to widen.

## Rulings

- **2026-09-29, gate G-E5-N (Q1): approved.** The lead approved all five units' numbers
  unchanged (the three here, and the anti-drone pair that Q11 moved to E6, GH-274).
- **2026-09-29, Q10:** the drone swarm is enemy only (Sarim and Rif). **Q11:** the pair and all
  sim work (the Tzav's placed charge, G1) split into E6.
- **2026-09-29, Gunship front armour 55 → 47 (lead, the AA-counter claim).** Measured by the
  Task 4 probe: at 55 the Gunship survived a firing pass against 1/2/3 ZU-23 gun trucks
  100/100/93% where the Peten survives 80/0/0. A pass is nose-on and the ZU-23's penetration is 40,
  so above ~49 front the truck stops penetrating (scan, everything else as drafted: 45 → 83/0/0,
  47 → 93/0/0, 49 → 100/10/3, 51 → 100/57/57, 53 → 100/90/70, 55 → 100/100/93). Every other number
  stands as approved.
- **2026-09-29, Gunship armour track: "Front +0, rest to sides and HP" (lead).** The track added
  +3/+5/+8 front, so a max-tier Gunship was back at front 55 and survived 3 trucks 93% against the
  max-tier Peten's 30% at 2. Front is now +0 at every tier (47 throughout). The split, per tier
  (hp / side / rear, was 58·2·1, 123·3·2, 205·5·3):

  | tier | price | hp | front | side | rear |
  |---|---|---|---|---|---|
  | 1 | 225 | +62 | +0 | +3 | +2 |
  | 2 | 335 | +131 | +0 | +4 | +4 |
  | 3 | 470 | +221 | +0 | +6 | +5 |

  Why this split: the curve values a hull as `hp × (1 + (0.55·front + 0.30·side + 0.15·rear)/200)`,
  so each tier's HP was solved to hold that product (tier 3: 1,256.1 before, 1,256.0 after); both
  curve outputs below are unchanged to the digit. Most of the +8 goes to HP rather than armour on
  purpose: armour against the ZU-23 (pen 40) has a cliff -- the front scan above goes from 0% to
  93% survival across 47-55 -- and HP has none. Side stays at 38 at max tier, below the gun's
  penetration, so a flank pass stays punishable; rear takes the other point or two because
  nothing in the probe sees the rear and a withdrawing helicopter shows it.
  Result at max tier: survive 100/0/0 against 1/2/3 trucks (max-tier Peten 100/30/30).

## The three units (as staged, after the 29 Sep ruling)

### `recon_zikit` -- Shmamit Deep Recon Team (working name Zikit; see the names screen)

| field | value | field | value |
|---|---|---|---|
| role | `support` | hp / armour | 320 / 10·10·10 |
| crew / supp. res. | 4 / 0.7 | speed | 0.9, foot |
| sight / optics | 14 / 1.8, thermal | signature / firing mult | 0.25 / 1.5 |
| weapon | `suppressed_carbines`: small_arms, range 6, acc 0.68, pen 10, dmg 16, supp 20, rof 160, collateral 0.05 | abilities | `mark_target`, `mark_tunnel`, `garrison` |
| cost | 290 logistics, 22 s, pop 1 | unlock | `{ "price": 4250 }` |
| upgrades | sensors, armour: 1,100 credits | curve | +1.3%; max tier +2.5% |

### `demo_tzav` -- Shiryonan Demolition Carrier (working name Tzav; see the names screen)

| field | value | field | value |
|---|---|---|---|
| role | `engineer` | hp / armour | 2,600 / 380·200·120, top 40 |
| crew / supp. res. | 3 / 0.8, `can_embark: false` | speed / turn | 1.0 / 55, `wheeled: true` |
| sight / optics | 8 / 0.9 | signature / firing mult | 1.1 / 2.0 |
| weapon | `rws_mg`: hmg, range 7, acc 0.55, pen 18, dmg 26, supp 55, rof 220, collateral 0.12 | abilities | `demolish`, `smoke` |
| demolition | `placed` -- **E6**, not staged (the schema rejects it until G1 lands) | charge | fuse 8 s, blast 2.5, dmg 300, supp 120, withdraw 4 (E6) |
| cost | 680 logistics, 34 s, pop 2 | unlock | `{ "price": 6500 }` |
| upgrades | armour, firepower: 2,360 credits | curve | −0.3%; max tier −6.0% |

### `heli_peten_gunship` -- Peten Gunship

| field | value | field | value |
|---|---|---|---|
| role / domain | `gunship` / `air` | hp / armour | 820 / **47**·32·22 (front 55 until the 29 Sep ruling) |
| crew / supp. res. | 2 / 0.8 | speed / turn | 3.0 / 100 |
| sight / optics | 15 / 1.6, thermal | signature / firing mult | 1.3 / 2.5 |
| weapons | `chain_gun_30` as the Peten; `rocket_pods` he, range 8, acc 0.45, pen 60, dmg 140, splash 1.0, supp 140, rof 30, collateral 0.55; `hellfire` as the Peten at rof 3 | | |
| cost | 450 logistics, 50 s, pop 3 | unlock | `{ "price": 8000 }` |
| upgrades | armour (front +0 at every tier; see Rulings), sensors, firepower (pods): 3,185 credits | curve | +2.2%; max tier +10.9% (+1.9% / +10.6% at front 55) |

## The names screen (Q7, storyline §2.4 rule 3), 2026-09-29

Run by `narrative-designer` (E5 Task 6) before any name enters shipping JSON. Only `name` and
`blurb` changed. **The ids stay** (`recon_zikit`, `demo_tzav`): they are keys the tests, probes
and art plan already name, a player never reads them, and renaming them is not a text change.
Elsewhere in this file and in the design, *Zikit* and *Tzav* are the working names for the
same two units.

**Method.** The MediaWiki search API on he.wikipedia.org and en.wikipedia.org, each name
searched as a word and beside military context (צה"ל, יחידה, פלוגה, רכב, מל"ט; "IDF", "unit",
"vehicle", "armoured"), then the matching articles read. The test: is the word a real platform,
a real unit, a real operation, a real armed group, a faith term, or a real group active in the
war the campaign transposes (storyline D12)? This is an encyclopaedia search, not a trademark or
web search; a veto is welcome.

| working name | finding | verdict | final name |
|---|---|---|---|
| **Zikit** (chameleon) | **Collides.** *Plugat Zikit*, a company of the real Unit 636 (IDF field intelligence): covert observation and intelligence collection, earlier a platoon of Duvdevan (he.wikipedia, "יחידה 636"). The same word for the same job. Other hits: a film series (*Koach Zikit*), a Kraków transit body | replace | **Shmamit Deep Recon Team** |
| **Tzav** (tortoise, צב) | **Collides in the transliteration a player reads.** The English *Tzav*/*Tsav* is first a weekly Torah portion (en.wikipedia, "Tzav": rule 5, never a faith), then *Tzav 8* and *Tzav Rishon*, the real IDF call-up orders, and *Tsav 9*, a real, sanctioned group active in the war D12 transposes. No platform or unit named Tzav was found | replace | **Shiryonan Demolition Carrier** |
| **Peten Gunship** | **Passes as a name.** No platform called "Peten Gunship". *Peten* itself is the Israeli Air Force's name for the AH-64A, which the shipped `heli_peten` ("AH-64 Peten") already carries; that collision is out of scope here (special_units design §9.3) and is inherited, not added | keep | **Peten Gunship** |

**The replacements, screened the same way.**
- *Shmamit* (שממית, the gecko: it holds to a wall and is not seen; Proverbs 30:28's *semamit*
  that "is in kings' palaces" is the same word). No military, unit, platform or operation hit in
  either language. It keeps the design's fantasy (a lizard that goes unseen) and moves the
  animal, not the idea.
- *Shiryonan* (שריונן, the armadillo: the armoured animal that is slow and sits tight). No
  military hit in English (0 results) and none in Hebrew beyond the common noun *shiryon*
  (armour), which it is built on the way *Kipod* is a common noun. It keeps the design's
  fantasy (the armoured, slow beast that lays its charge and walks away).

**Rejected on the way, each for a real collision:** *Tinshemet* (barn owl: INS Tinshemet T-212,
a Nahal platoon, the Hila balloon's sensor), *Bardelas* (the IDF's name for the M113, and a
battalion), *Shual* (Samson's Foxes), *Akrav* (IAF 105 Squadron, an operation), *Karnaf* (the
IAF's C-130, a drone launcher), *Girit* (a checkpoint-systems company).

**Rule 4 fit.** Both finals are single Hebrew common nouns for animals, the register of *Lavi*,
*Namer*, *Peten* and *Kipod*.

## Prices against the ladder

`LADDER_CREDITS` is 5,849; the peak single-mission payout is 310.

| unit | credits | ladders | × peak | + all tiers |
|---|---|---|---|---|
| Zikit | 4,250 | 0.73 | 13.7 | 1,100 |
| Tzav | 6,500 | 1.11 | 21.0 | 2,360 |
| Gunship | 8,000 | 1.37 | 25.8 | 3,185 |

## The cost curve, measured 2026-09-29 at front 47

`python3 tools/validate_balance.py --units data/units --also docs/campaign/special_units/e5 --report`

```
fitted curve: cost = 285.745 * power^0.466  (n=35)

unit                     power      cost  expected      dev
attack_drone               0.8       300       258   +16.5%
sarim_rifles               1.1       340       298   +14.3%
recoilless_team            0.6       205       227    -9.6%
manpad_team                0.6       210       227    -7.3%
demo_squad                 1.0       300       282    +6.4%
mbt_lavi                  13.4       906       958    -5.4%
ifv_namer                  6.0       630       661    -4.6%
rpg_team                   0.6       210       219    -4.3%
yahalom_squad              0.9       260       269    -3.4%
inf_squad                  1.0       292       283    +3.3%
recon_drone                0.6       210       217    -3.3%
militia_cell               0.9       280       271    +3.3%
mortar_crew                0.5       198       204    -3.0%
sniper_team                0.9       260       268    -2.9%
mortar_team                0.5       209       215    -2.6%
digger_crew                0.4       186       190    -2.3%
technical                  1.3       331       324    +2.2%
apc_eitan                  3.5       520       509    +2.2%
heli_peten_gunship         2.5       450       440    +2.2%
rocket_battery             0.5       201       197    +1.8%
apc_kipod                  4.4       562       572    -1.8%
dozer_d9                   4.5       586       576    +1.8%
heli_peten                 2.0       402       397    +1.3%
scout_shachaf              2.1       410       405    +1.3%
recon_zikit                1.0       290       286    +1.3%
breach_team                1.1       306       302    +1.2%
loiter_drone               1.1       292       295    -1.0%
at_team                    0.7       236       238    -1.0%
atgm_cell                  0.7       235       237    -0.9%
paramotor                  0.9       275       277    -0.6%
demo_tzav                  6.5       680       682    -0.3%
jeep_shoded                1.3       317       318    -0.3%
charge_squad               0.9       267       268    -0.3%
moto_rpg                   0.7       244       244    +0.1%
gun_truck                  1.3       324       324    +0.0%

balance gate passed: 35 units within +/-18%
```

`python3 tools/validate_balance.py --units data/units --also docs/campaign/special_units/e5 --report --max-tier --upgrade-cost-factor 0.02`

```
max-tier pass: every 'upgrades'-bearing unit patched, K=0.02

fitted curve: cost = 300.834 * power^0.458  (n=35)

unit                     power      cost  expected      dev
sarim_rifles               1.0       340       300   +13.5%
attack_drone               0.8       308       274   +12.3%
heli_peten_gunship         2.6       514       463   +10.9%
recoilless_team            0.5       205       228   -10.2%
manpad_team                0.5       210       228    -8.1%
heli_peten                 2.0       448       417    +7.3%
ifv_namer                  7.3       702       749    -6.3%
demo_squad                 1.1       334       315    +6.0%
demo_tzav                  7.9       727       773    -6.0%
inf_squad                  1.0       325       308    +5.7%
breach_team                1.2       341       323    +5.6%
recon_drone                0.6       224       236    -5.1%
rpg_team                   0.5       210       221    -4.9%
yahalom_squad              1.0       290       304    -4.7%
dozer_d9                   5.5       626       656    -4.6%
jeep_shoded                1.3       353       338    +4.5%
mortar_crew                0.4       198       205    -3.5%
scout_shachaf              2.3       457       442    +3.3%
loiter_drone               1.0       292       300    -2.7%
apc_kipod                  5.3       626       643    -2.7%
mbt_lavi                  14.9      1009      1037    -2.7%
digger_crew                0.4       186       191    -2.6%
recon_zikit                1.0       312       304    +2.5%
militia_cell               0.8       280       273    +2.4%
mortar_team                0.6       233       238    -2.4%
paramotor                  0.9       275       281    -2.2%
apc_eitan                  4.0       579       568    +1.9%
technical                  1.2       331       325    +1.8%
charge_squad               0.8       267       272    -1.7%
moto_rpg                   0.7       244       248    -1.6%
atgm_cell                  0.6       235       239    -1.5%
rocket_battery             0.4       201       198    +1.3%
sniper_team                0.9       290       291    -0.4%
at_team                    0.7       263       262    +0.3%
gun_truck                  1.2       324       325    -0.3%

balance gate passed: 35 units within +/-18%
```

## Decisions Q1-Q12 (29 Sep)

Q1, Q10 and Q11 are the lead's answers; the rest are taken defaults the lead did not change.

| # | question | decision · 29 Sep |
|---|---|---|
| Q1 | The §1 and §8 numbers | **approved** by the lead, all five units (Gunship front then ruled 47, same day) |
| Q2 | Gunship station time | dropped (G2) · taken default |
| Q3 | G1, or a held-station Tzav | build G1, in E6 · follows from Q11 |
| Q4 | Tzav: auto-withdraw; order-only charge; blast hurts own troops and civilians | yes, 4 tiles; yes; yes · taken default |
| Q5 | Pods at 0.55 collateral | keep · taken default |
| Q6 | Stage the data | stage · taken default |
| Q7 | Names: rule-3 screen before any JSON ships | working names until screened · taken default |
| Q8 | The KDF vehicle line in the bible | adopt · taken default |
| Q9 | Fold G4 into GH-247; leave G6 without a hook | yes; accept · taken default |
| Q10 | The swarm's side | **enemy only, Sarim and Rif** (lead) |
| Q11 | Split the pair and all sim work into E6 | **split into E6** (lead) |
| Q12 | The beam also intercepts mortar and rocket rounds | not in v1 · taken default |

## Task 4 probe bands -- FROZEN from the commit that adds this section

These bands were set by `balance-analyst` on 2026-09-29 from the first measured run of
`pnpm --filter @lions/tools e5:probes` (`tools/src/backtest/e5-probes.ts`) against the staged
drafts, and are frozen from this commit on in `tools/src/backtest/e5-probes.test.ts` (part of
`pnpm test`). A probe outside its band is a unit to retune -- the lead's call -- and never a band
to widen. Seeds are fixed and the sim is deterministic, so a band moves only when the staged
numbers or the combat model do.

### Gunship: one firing pass vs N `gun_truck` (30 seeds each; `airContested`'s seeds)

| unit | survive 1 / 2 / 3 | cleared 1 / 2 / 3 |
|---|---|---|
| `heli_peten` | 80 / 0 / 0 % | 80 / 0 / 0 % |
| `heli_peten_gunship` (front 47) | 93 / 0 / 0 % | 93 / 0 / 0 % |

Claims (all met):
- survival falls as trucks are added: never rises with an added truck, and 1 > 3
  (strict at every step cannot hold alongside the next claim while the Peten's 2-truck rate is 0);
- survival vs 3 trucks ≤ the Peten's vs 2 (0 ≤ 0);
- clears the position vs 1 truck at least as often as the Peten (93 ≥ 80).

Bands: survive vs 1 in [80, 100]%; survive vs 2 ≤ 10%; cleared vs 1 in [80, 100]%.

**Maximum tier (claim added with the 29 Sep armour-track ruling).** Both helicopters at their
maximum tiers, same seeds:

| unit | survive 1 / 2 / 3 | cleared 1 / 2 / 3 |
|---|---|---|
| `heli_peten` (max) | 100 / 30 / 30 % | 100 / 0 / 0 % |
| `heli_peten_gunship` (max, front 47) | 100 / 0 / 0 % | 97 / 0 / 0 % |

Claim (met): a max-tier Gunship against 3 trucks survives no more often than a max-tier Peten
against 2 (0 ≤ 30%). Also pinned: front armour is 47 at armour tiers 0-3. On the old +8 front the
max-tier Gunship read 100 / 100 / 93 and the claim was red. The other two base claims are printed
at max tier, not claimed: "falls with AA" holds (100 → 0 → 0); "clears vs 1 at least as often as
the Peten" reads 97% against 100% (one seed of 30), which nobody has ruled on.

### Zikit: first tick a `militia_cell` identifies the unit (open ground, 20 seeds, 20 ticks/s)

Median first-identified tick (every seed gave the same tick except `inf_squad` firing at 8):

| mode | unit | 4 tiles | 6 tiles | 8 tiles (non-claim) |
|---|---|---|---|---|
| hold | `recon_zikit` | 92 | 209 | never |
| hold | `sniper_team` | 92 | 209 | never |
| hold | `inf_squad` | 38 | 86 | never |
| fire | `recon_zikit` | 69 | 156 | never |
| fire | `sniper_team` | 38 | 86 | never |
| fire | `inf_squad` | 38 | 86 | 578 (526-642) |

"hold" registers the unit with no weapons; "fire" as drafted. Claims (all met, at 4 and 6 tiles):
the Zikit is found later than `inf_squad` holding and firing, and later than `sniper_team` once
both fire. Holding, the Zikit and the sniper are identical (both signature 0.25); the Zikit's edge
is its firing multiplier, 1.5 against 6.0.

Bands (±15% of the measured tick): hold 4 tiles [78, 106], hold 6 tiles [178, 240], fire 4 tiles
[59, 79], fire 6 tiles [133, 179]; found in 20 of 20 seeds.

**The 8-tile rows are non-claims.** 8 tiles is outside `militia_cell`'s sight (7), so no unit
holding fire is ever found there, and outside the Zikit's carbines (6), so it never fires there
either. A band frozen on them would be vacuous.

**Finding, not investigated:** `inf_squad` firing at 8 tiles IS identified (median tick 578),
beyond the militia's 7-tile sight. Some under-fire reaction -- movement or a reveal -- lets the
militia find a shooter it cannot see. Recorded, not explained.
