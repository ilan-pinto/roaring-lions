# How the individual soldier moves

Reference notes for Roaring Lions developers, part 1 of 3 (`soldier-movement.md`, `squad-tactics.md`, `game-and-animation.md`).
Scope: presentation and gameplay realism only (movement, posture, timing). Every number carries a source tag `[Sn]`
that resolves in the Sources list at the end. **ESTIMATE** marks a number no source gave; the reasoning is shown.
Researched 9 Nov 2026 from public doctrine, peer-reviewed load-carriage studies and encyclopedic sources.

## Contents

1. [Speeds](#1-speeds)
2. [The soldier's load](#2-the-soldiers-load)
3. [How load changes speed, stride and endurance](#3-how-load-changes-speed-stride-and-endurance)
4. [Gait cues: stride, cadence, lean, arm swing](#4-gait-cues-stride-cadence-lean-arm-swing)
5. [Weapon carry and firing positions](#5-weapon-carry-and-firing-positions)
6. [The rush](#6-the-rush)
7. [Crawls](#7-crawls)
8. [Taking cover and reacting to contact](#8-taking-cover-and-reacting-to-contact)
9. [Quick reference table](#9-quick-reference-table)
10. [Sources](#sources)

---

## 1. Speeds

| Gait | Speed | Basis | Source |
|---|---|---|---|
| Civilian preferred walk | 1.10-1.65 m/s (about 1.4 m/s is the common reference) | population studies | [S24] |
| Civilian walk, measured | ~112 steps/min, ~0.71 m step (about 1.3 m/s) | lab table, preferred speed | [S25] |
| Road march, while moving | 1.35 m/s (4.8 km/h) | FM 21-18's pace: 30 in (0.76 m) at 106 steps/min, derived | [S11] |
| Road march, average with halts | 4.0 km/h day (1.1 m/s), 3.2 km/h at night or limited visibility | FM 21-18 rates of march; a 10-minute halt every 50 minutes | [S11] |
| Cross-country march, average | 2.4 km/h day (0.67 m/s), 1.6 km/h night | FM 21-18 | [S11] |
| Drill quick time | 120 steps/min x 30 in = 1.52 m/s (derived) | drill cadence | [S27] |
| Drill double time | 180 steps/min; 30 in step gives 2.29 m/s, a 36 in step gives 2.74 m/s (derived) | drill cadence; secondary sources disagree on the double-time step length (30 vs 36 in), so the speed is a range | [S27] |
| Sprint, 30 m from a standing start, unloaded | 6.2 +/- 0.8 s, mean 4.8 m/s including the acceleration | 17 soldiers, combat uniform and boots | [S18] |
| Sprint, 30 m, 21.6 kg fighting load | 8.2 +/- 1.4 s, mean 3.7 m/s | same soldiers | [S18] |
| The rush, recommended target | 6.7 m/s (15 mph) over 20-33.5 m | an Army performance officer's argument, not doctrine; he contrasts it with a 3.3 m/s rush | [S22] |

**Why the march figures look slow.** 4.0 km/h is a planning average that already contains the halts: 4.8 km/h of
walking for 50 minutes of each hour is 4.04 km/h (derived from [S11]). On the screen, a moving column walks at
about 1.35 m/s, not 1.1.

**Why the sprint figures disagree.** Treloar and Billing timed a 30 m dash from a standstill, so the mean includes the
acceleration ([S18]); Barringer's 6.7 m/s is a target he argues for, not a measured mean ([S22]). For animation, read
a loaded soldier's top running speed as roughly 4-6 m/s and an unloaded one's as roughly 5-7 m/s (**ESTIMATE** that
brackets the two sources).

## 2. The soldier's load

Doctrine splits the load in three ([S11] para 2-7 and ch 5):

- **Fighting load**: what he fights in: weapon, ammunition, helmet, armour, water. FM 21-18 (1990) caps it at
  **48 lb (21.8 kg)** for a conditioned soldier.
- **Approach march load**: fighting load plus a light pack, **72 lb (32.7 kg)** or less.
- **Emergency approach march load**: above 72 lb when vehicles cannot reach. Soldiers used as porters "can carry up to
  120 pounds [54 kg] ... for several days over distances of 20 km a day"; 150 lb (68 kg) is feasible but fatiguing
  ([S11] para 5-6c).
- The basis is body weight: a soldier fit to APFT standards carries **45 % of body weight (average 72 lb) at 4 km/h for
  an 8-hour approach march** ([S11] ch 5). 48 and 72 lb are 30 % and 45 % of a 160 lb man.

**What soldiers actually carried.** In Afghanistan in 2003 almost every soldier's fighting load was **60-70 lb
(27-32 kg)**, and most carried **over 100 lb (45+ kg)** on approach marches ([S12], Dean's Center for Army Lessons
Learned study, about 800 paratroopers). A secondhand quote of the same report gives averages of 63 lb (fighting), 95.7 lb
(approach) and 127.3 lb (emergency approach), which I could not check against the original ([S12b]). A 2025 trade-press
summary of the new ATP 3-21.18 gives a fighting load of 60-80 lb (27-36 kg) and an approach march load of 80-100 lb
(36-45 kg) ([S12c], unverified against the manual). **The doctrinal ceiling and the measured load differ by about 30-40 %;
for presentation, assume the measured load.**

### Equipment weights (encyclopedic)

| Item | Weight | Source |
|---|---|---|
| M4 carbine, empty | 2.92 kg | [S28a] |
| M4 with loaded 30-round magazine and sling | 3.52 kg | [S28a] |
| IWI Tavor X95 family (the IDF's issue rifle) | 3.3-3.62 kg | [S28c] |
| M249 light machine gun, empty / with 200-round belt | 7.5 kg / 10 kg | [S28b] |
| IOTV body armour, medium, fully equipped (4 plates, collar, groin) | ~14 kg (30 lb); large ~16 kg | [S28d] |
| One medium ESAPI plate | 2.5 kg | [S28d] |
| Advanced Combat Helmet, medium / X-large | 1.36 / 1.72 kg | [S28e] |
| M18 smoke grenade | 540 g | [S28f] |

Rifle, armour and helmet alone come to about 19-21 kg before ammunition and water (derived from the rows above), which
is why the measured fighting load sits above the 1990 ceiling.

## 3. How load changes speed, stride and endurance

- **Agility.** "The time a soldier needs to complete an obstacle course is increased from 10 to 15 percent ... for every
  10 pounds of equipment carried" ([S11] para 5-3a).
- **Sprinting.** A 21.6 kg fighting load slowed a 30 m sprint by 32 % on average (6.2 to 8.2 s): men 29 %, women 36 %.
  **About half the loss (51.7 %) was in the first 5 m**, the start ([S18]). The animation reading: the loaded man is
  slowest getting going.
- **Rushes with armour.** Heavier armour configurations lengthened individual and total 30 m rush times ([S19]). In a
  prone-sprint-prone rush, **the time to get down was the best predictor of the whole cycle time** (R^2 0.75), ahead of
  getting up (0.58) and the sprint itself (0.40) ([S20]). Loads of 15 % and 30 % body weight slowed the overall rush,
  the stand-up and the sprint; the drop slowed significantly only at 30 % ([S21]).
- **March distance.** "The distance marched in six hours decreases by about 2 km for every 10 pounds carried over 40
  pounds" ([S11] para 5-3c). A burst of 900-1,000 kcal/h can be sustained for only **6-10 minutes** ([S11] 5-3b).
- **Self-pacing.** Loaded walkers choose to slow down, and the total work still rises because they walk longer
  ([S26], citing Simpson et al. 2011). A 10 kg load cut time to exhaustion at a constant running intensity by 42.9 %
  ([S26], citing Shei et al. 2018).
- **Energy.** At a fixed 1.25 m/s, net metabolic rate rose about 7.6 W per kg of load; gross rate was about 40 % higher
  at a load of 30 % of body mass ([S17]).

## 4. Gait cues: stride, cadence, lean, arm swing

### Stride and cadence

| Condition | Step length | Cadence | Source |
|---|---|---|---|
| Civilian preferred walk | ~0.71 m | ~112 steps/min (1.9 steps/s) | [S25] |
| Treadmill 1.25 m/s, unloaded | 0.662 m | step time 0.532 s (1.88 steps/s) | [S17] |
| Same, up to 20.4 kg | **unchanged** | **unchanged**; double support rose ~30 % (29 % to 38 % of the step) | [S17] |
| Self-selected speed, 4.2-17.5 kg (6.5-27.2 % body weight), Indian infantry | longer step and stride | higher cadence; longer midstance | [S14] |
| 6, 20, 33, 44 kg backpack | stride length falls as load rises (secondary summary) | stride frequency rises only at the heaviest load | [S16] |
| Road march pace | 0.76 m (30 in) | 106 steps/min | [S11] |
| Walk / run / sprint band (the game's own gate, quoting human gait) | — | walk under 2 m/s: 1.7-2.4 steps/s; run 2.5-3.1; sprint 3.3-4.2 | `tools/src/mesh_gait.test.ts` |

**Why the stride sources disagree.** Huang and Kuo held the treadmill at 1.25 m/s, so the subjects could not change
speed, and stride and cadence stayed put ([S17]). Majumdar let soldiers choose their speed and found longer and quicker
steps ([S14]). Harman went to 44 kg and found shorter strides with a higher frequency only at the top ([S16]). Read it as:
**at light loads and a fixed speed the stride barely changes; at heavy loads stride shortens, cadence rises, and the
feet spend longer both on the ground (double support).** The double-support increase is consistent across studies
([S16], [S17]) and is the most reliable visual cue of a heavy load: a flatter-footed, "planted" gait.

### Forward lean

- The trunk leans further forward as load rises, in every study read: Attwells 2006 (8-50 kg total), Harman 2000,
  Majumdar 2010 ([S15], [S16], [S14]). The head also comes forward: the craniovertebral angle fell under load (p < 0.001)
  ([S15]).
- **Degrees.** Majumdar reported a forward trunk inclination of **10 degrees or more** already at a 10.7 kg pack (as
  summarised in a secondary search result for [S14]; the full text was not read). A 2017 conference abstract measured mean
  trunk lean of **1.4 deg (light) and 4.6 deg (heavy) with a standard pack**, and 5.5 / 10.9 deg with a heavier
  energy-harvesting pack ([S14b]). **Range: about 2-11 degrees of extra trunk lean under a loaded pack**, depending on
  load mass and how high and far back it rides. Body armour worn on the chest without a pack pushes the other way: a
  front-mounted fighting load increased maximum trunk EXTENSION while walking ([S19]).
- Knee range of motion grows under load (21.1 to 25.5 deg with a carried anti-tank weapon), and the femur's
  (33.9 to 37.8 deg) ([S15]). Knee flexion and lean together lower the body's centre of mass ([S16]).

### Arm swing with a rifle

- A soldier holding a rifle in both hands cannot swing his arms. In civilians, holding the arms still raised metabolic
  cost by 12 % and the vertical ground-reaction moment (the twist the feet must resist) by 63 % ([S23]).
- **Animation inference (not measured on soldiers):** with the arms locked to the weapon, the counter-rotation that arm
  swing normally provides has to come from the torso and shoulders, so a rifleman's chest yaws slightly against his
  pelvis each step while the muzzle stays steady, and the head stays level. A rifleman whose arms swing freely, or whose
  muzzle bobs with each step, reads wrong.

## 5. Weapon carry and firing positions

### Carry positions

TC 3-22.9, *Rifle and Carbine*, names six carry positions: **hang, safe hang, collapsed low ready, low ready, high ready
and ready (ready-up)**, the last for when contact is imminent ([S29b]). I could not fetch the manual's text, so the
descriptions below come from training material and are **unverified against TC 3-22.9**:

- **Hang / safe hang**: weapon slung, hands free or one hand on it. Admin movement.
- **Low ready**: stock in the shoulder, muzzle depressed (commonly described as about 45 degrees) so the man can see over
  it; the patrol and room-clearing carry.
- **High ready**: stock under the armpit or at the shoulder, muzzle up; used on upper floors and stairs, where up is the
  safer direction.
- **Ready / ready-up**: weapon in the shoulder at the eye, muzzle just below the target line.

The game already settled on "low ready when moving" (lead's motion standard, 5-6 Oct 2026; see
`game-and-animation.md`).

### Firing positions

- **Standing**: fastest, highest and least stable. FM 3-06.11 calls firing from standing at a corner a common error,
  because it puts the head where an enemy expects a target ([S30] para 3-28a).
- **Kneeling**: the compromise the game uses for its halt to fire.
- **Prone**: lowest silhouette; the end state of every rush ([S10]); the position when no cover exists ([S30] 3-28g).
- **Around cover, not over it**, and from the shoulder that exposes least: a right-handed man fires left-handed round a
  left-hand corner ([S30] 3-7, 3-28a-b).
- At a window, stay well back in the room and kneel ([S30] 3-28c).

### Time from moving to each firing position

No public source gave a measured transition time. The figures below are **ESTIMATES**:

| Transition | Estimate | Reasoning |
|---|---|---|
| Walking at low ready to standing aimed | 0.3-0.7 s | raising the stock from the low ready to the eye; no posture change |
| Walking to kneeling, aimed | 0.5-1.0 s | one step to plant, drop the knee, then aim |
| Running to prone ("hit the dirt") | 1.0-2.0 s | plant both feet, fall forward, roll, settle the rifle ([S10]); the get-down phase dominates the rush cycle ([S20]) |
| Prone to running | 1.0-2.0 s | arms in, leg drawn up, push up in one movement, step off ([S10]) |

The one hard bound: a nuclear-security qualification table allows **10 s to move from standing to prone and fire 2
rounds** at 25 yards, a generous training limit, not a measurement ([S43]). The game uses 0.2 s each way
(`KNEEL_DROP_TICKS`, `KNEEL_RISE_TICKS`), balanced against the backtest and accepted by the lead.

## 6. The rush

Doctrine (Soldier's Manual of Common Tasks, task 071-326-0502, *Move Under Direct Fire*, [S10]; and FM 7-8, [S6]):

- Use it to cross open ground or when time is critical. It is the fastest individual technique and the least
  protected ([S10]).
- **"Try not to stay up any longer than 3 to 5 seconds"**, so an enemy automatic rifleman cannot track you ([S10]). The
  mnemonic "I'm up, he sees me, I'm down" is a training saying that times about 3 s; I found no doctrinal text that
  prints it.
- The sequence, as movement ([S10], and the FM 21-75 figure reproduced in [S9]):
  1. From prone, roll or crawl out of the firing position (so he does not reappear where he went down).
  2. Raise the head slowly and pick the next position.
  3. Lower the head, draw the arms in with elbows down, pull the right leg forward.
  4. Straighten the arms and rise in one movement, then spring up and step off with either foot.
  5. Run for 3-5 s.
  6. Plant both feet just before going down.
  7. Fall forward, sliding the right hand to the butt and breaking the fall on the butt.
  8. Roll onto the side, bring the butt into the shoulder, and roll or crawl to a covered firing position.
- **Distance per rush (derived):** 3-5 s at the measured 3.7-4.8 m/s is about **11-24 m**; Barringer argues for 20-33.5 m
  at 6.7 m/s ([S22]).
- Buddy teams: one man moves while the other covers by fire; signal the plan by hand ([S10]).

## 7. Crawls

Doctrine ([S10], [S6] para 2-10c):

| | High crawl | Low crawl |
|---|---|---|
| When | the route gives cover and concealment, visibility is poor, or speed is needed where only a low crawl would otherwise fit | cover or concealment is under about 1 ft (30 cm) high, the enemy observes well, and speed is not needed |
| Body | off the ground on forearms and lower legs; knees well behind the buttocks so the buttocks stay low | as flat as possible |
| Rifle | cradled in the arms, muzzle off the ground | sling grasped at the upper swivel, handguard on the forearm, butt dragging so the muzzle stays up |
| Motion | right elbow with left knee, then left elbow with right knee | push both arms forward and pull the right leg up, then pull with the arms and push with the leg; change legs often |
| Speed | **ESTIMATE 0.3-0.6 m/s** | **ESTIMATE 0.1-0.3 m/s** |

**No public study gave a crawl speed.** The USMC LEAP course has a crawl station (low, back and high crawls) but its
station times were not available ([S21b]). The estimate assumes a high-crawl cycle moves 0.3-0.5 m per elbow-knee pair
at about one pair a second, and a low crawl roughly half that. Treat both as tuning ranges, not facts.

Crawling is slow enough that, at game scale (1 tile = 3 m), a low-crawling man covers a tile in about 10-30 s
(derived from the estimate).

## 8. Taking cover and reacting to contact

What doctrine says the individual does ([S6], [S7], [S10]):

1. **Get down and get to cover.** "Soldiers immediately take the nearest covered positions" ([S7] Drill 2, para 1).
2. **Return fire** toward the contact from there ([S7]). Team leaders then control fire with fire commands ([S7]).
3. **Keep contact** with the soldiers left and right and with the team leader ([S7] para 4-5). The leader's rule is
   "follow me and do as I do": the men move when he moves and fire when he fires ([S1]).
4. **Move under fire** by crawls and 3-5 s rushes, one buddy covering the other ([S10]).

Cover is anything that stops rounds; concealment only hides. The task standard lists **cover**: gullies, ravines,
ditches, walls, large trees, rocks, stumps, rubble, vehicle hulks, folds in the ground; **concealment only**: hedgerows
and thick vegetation; high grass is partial concealment and suits the rush rather than a crawl ([S10]).

### A timeline for the first seconds of contact (ESTIMATE)

No source times this. Built from the drill text and the rush/get-down figures above:

| t (s) | What a rifleman does | Basis |
|---|---|---|
| 0 | rounds crack; head and shoulders duck, the step falters | reflex; the game's flinch is 0.3 s ([S-game]) |
| 0-1.5 | drops where he is or takes 1-3 strides to the nearest cover and drops | "nearest covered position" [S7]; get-down 1-2 s (estimate) |
| 1.5-3 | rolls or crawls to a firing position, finds the threat | [S10] steps 7-8 |
| 2-4 | first aimed shots back toward the contact | [S7] para 1 |
| 4+ | team leader's fire commands; squad leader moves up to the element in contact | [S7] para 8a |

---

## 9. Quick reference table

All in metres and seconds; game tiles at 3 m.

| Motion | Real value | Tiles/s (at 3 m/tile) | Source |
|---|---|---|---|
| Patrol walk, loaded, moving | 1.1-1.35 m/s | 0.37-0.45 | [S11] |
| Cross-country average | 0.67 m/s | 0.22 | [S11] |
| Jog / double time | 2.3-2.7 m/s | 0.76-0.91 | [S27] (derived) |
| Loaded sprint, 30 m mean | 3.7 m/s | 1.2 | [S18] |
| Unloaded sprint, 30 m mean | 4.8 m/s | 1.6 | [S18] |
| Rush exposure | 3-5 s | — | [S10] |
| Rush length | 11-24 m (derived) to 33.5 m | 4-8 to 11 | [S10], [S18], [S22] |
| High crawl | 0.3-0.6 m/s | 0.1-0.2 | ESTIMATE |
| Low crawl | 0.1-0.3 m/s | 0.03-0.1 | ESTIMATE |
| Stand to kneel, aimed | 0.5-1.0 s | — | ESTIMATE |
| Run to prone | 1.0-2.0 s | — | ESTIMATE |
| Fighting load, doctrine / measured | 21.8 / 27-32 kg | — | [S11], [S12] |
| Approach march load, doctrine / measured | 32.7 / 45+ kg | — | [S11], [S12] |
| Extra trunk lean under a loaded pack | about 2-11 deg | — | [S14], [S14b] |

---

## Sources

Retrieval note: several Army sites (armypubs, globalsecurity.org, benning.army.mil, DTIC) refused automated access on
9 Nov 2026. Where a manual's text came through a mirror or a secondary summary, the entry says so.

- [S1] ATP 3-21.8, *Infantry Platoon and Squad* (2024), fire team movement formations, HTML mirror:
  https://infantrydrills.com/manuals/fm-atp-3-21-8-infantry-rifle-platoon-squad-2024/movement-and-maneuver/tactical-movement-approach-march/movement-formations/fire-team-movement-formations/
- [S6] FM 7-8, *Infantry Rifle Platoon and Squad* (1992), chapter 2, mirror:
  https://550cord.com/infantry-rifle-platoon-squad-fm-7-8/fm-7-8-chapter-2-operations/
- [S7] FM 7-8 chapter 4, battle drills, mirror:
  https://550cord.com/infantry-rifle-platoon-squad-fm-7-8/fm-7-8-chapter-4-battle-drills/
- [S9] University of Akron Army ROTC, *Tactics 1b: Movements and Formations* (2014), reproducing the FM 21-75 / FM 3-21.8
  figures (rush sequence, wedge, file): https://uakron.edu/armyrotc/MS1/33.pdf
- [S10] STP 21-1-SMCT (18 Jun 2009), task 071-326-0502 *Move Under Direct Fire*, pp. 3-168 to 3-172, reproduced at:
  https://prepare-and-protect.net/2013/12/move-under-direct-fire
- [S11] FM 21-18, *Foot Marches* (1 Jun 1990): paras 2-7, 3-2 (figure 3-1, rates of march; pace 30 in at 106 steps/min;
  2-5 m between soldiers), 4-5, 5-3, 5-4: https://elon.edu/assets/docs/rotc/FM%2021-18%20Foot%20Marches.pdf
- [S12] MIT News (2004) on Dean's CALL study *The Modern Warrior's Combat Load*: https://news.mit.edu/2004/soldier
- [S12b] Forum quotation of the same report's averages (secondhand):
  https://army.ca/forums/threads/the-modern-warrior%E2%80%99s-combat-load.104984/
- [S12c] Trade-press summary of ATP 3-21.18 (2025) loads (unverified):
  https://defence.h5mag.com/global_defence_technology_dec25/shouldering_the_burden
- [S14] Majumdar D, Pal MS, Majumdar D (2010), *Effects of military load carriage on kinematics of gait*, Ergonomics
  53(6):782-791, https://doi.org/10.1080/00140131003672015 (abstract via Europe PMC; the 10-degree figure from a secondary
  summary)
- [S14b] *Effects of Carrying a Loaded Energy Harvesting Backpack on Trunk Lean* (2017 ACSM abstract):
  https://aminer.org/pub/5c756e9ff56def97985ec8c9/effects-of-carrying-a-loaded-energy-harvesting-backpack-on-trunk-lean-board
- [S15] Attwells RL et al. (2006), *Influence of carrying heavy loads on soldiers' posture, movements and gait*,
  Ergonomics 49(14):1527-1537, https://doi.org/10.1080/00140130600757237
- [S16] Harman E et al. (2000), *The Effects of Backpack Weight on the Biomechanics of Load Carriage*, USARIEM,
  https://apps.dtic.mil/sti/html/tr/ADA377886/ (abstract via search; DTIC refused direct access)
- [S17] Huang TP, Kuo AD (2014), *Mechanics and energetics of load carriage during human walking*, J Exp Biol
  217:605-613, https://pmc.ncbi.nlm.nih.gov/articles/PMC3922835/
- [S18] Treloar AK, Billing DC (2011), *Effect of load carriage on performance of an explosive, anaerobic military task*,
  Mil Med 176(9):1027-1031, https://doi.org/10.7205/milmed-d-11-00017
- [S19] Loverro KL et al. (2015), *Use of body armor protection with fighting load impacts soldier performance and
  kinematics*, Appl Ergon 46:168-175, https://doi.org/10.1016/j.apergo.2014.07.015
- [S20] Davidson SP et al. (2021), *Quantifying warfighter performance during a bounding rush (prone-sprinting-prone)
  maneuver*, Appl Ergon 94:103382, https://doi.org/10.1016/j.apergo.2021.103382
- [S21] Vitali RV et al. (2019), *Body-worn IMU array reveals effects of load on performance in an outdoor obstacle
  course*, PLoS One 14(3):e0214008, https://pmc.ncbi.nlm.nih.gov/articles/PMC6428270
- [S21b] LEAP obstacle course reliability report (crawl station; times not retrieved): https://apps.dtic.mil/sti/tr/pdf/AD1019936.pdf
- [S22] Barringer N (2018), *Move or die: why speed matters*, Military Times, summarising his Infantry magazine article
  (Apr-Jul 2016): https://www.militarytimes.com/off-duty/military-fitness/2018/01/02/move-or-die-why-speed-matters-and-how-troops-can-get-faster/
- [S23] Collins SH, Adamczyk PG, Kuo AD (2009), *Dynamic arm swinging in human walking*, Proc R Soc B 276:3679-3688,
  https://doi.org/10.1098/rspb.2009.0664
- [S24] Wikipedia, *Preferred walking speed*: https://en.wikipedia.org/wiki/Preferred_walking_speed
- [S25] Lower trunk motion and speed-dependence during walking (2009), table 1:
  https://jneuroengrehab.biomedcentral.com/articles/10.1186/1743-0003-6-9/tables/1
- [S26] *Physiological impact of load carriage exercise* (review), https://pmc.ncbi.nlm.nih.gov/articles/PMC9630762/
- [S27] Drill cadence, quick time 120 and double time 180 steps/min (TC 3-21.5 as taught):
  https://vdf.virginia.gov/pdf/Training_2020/VDF_105_D&C_JUL2020.pdf (not fetched; via search summary)
- [S28a] Wikipedia, *M4 carbine*: https://en.wikipedia.org/wiki/M4_carbine
- [S28b] Wikipedia, *M249 light machine gun*: https://en.wikipedia.org/wiki/M249_light_machine_gun
- [S28c] Wikipedia, *IWI Tavor X95*: https://en.wikipedia.org/wiki/IWI_Tavor_X95
- [S28d] Wikipedia, *Improved Outer Tactical Vest*: https://en.wikipedia.org/wiki/Improved_Outer_Tactical_Vest
- [S28e] Wikipedia, *Advanced Combat Helmet*: https://en.wikipedia.org/wiki/Advanced_Combat_Helmet
- [S28f] Wikipedia, *M18 smoke grenade*: https://en.wikipedia.org/wiki/M18_smoke_grenade
- [S29b] TC 3-22.9 carry position names, as taught (flashcards; the manual itself, https://irp.fas.org/doddir/army/tc3-22-9.pdf,
  could not be read): https://www.brainscape.com/flashcards/rifle-and-carbine-tc-3-229-10208162/packs/18228283
- [S30] FM 3-06.11, *Combined Arms Operations in Urban Terrain* (2002), full text:
  https://archive.org/stream/Coed_Arms_Operations_in_Urban_Terrain_FM_3-06.11/Combined_Arms_Operations_in_Urban_Terrain_FM_3-06.11_djvu.txt
- [S43] 10 CFR 73 Appendix H qualification table (10 s standing to prone and 2 rounds):
  https://forms.nrc.gov/reading-rm/doc-collections/cfr/part073/part073-apph.html (via search summary)
- [S-game] Roaring Lions source: `packages/render/src/three/units/squad-motion.ts` (`FLINCH_SECONDS`),
  `packages/sim/src/tuning.ts` (`KNEEL_DROP_TICKS`), `tools/src/mesh_gait.test.ts` (`HUMAN_CADENCE`).
