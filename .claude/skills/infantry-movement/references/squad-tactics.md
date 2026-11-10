# How fire teams and squads move

Reference notes for Roaring Lions developers, part 2 of 3 (`soldier-movement.md`, `squad-tactics.md`, `game-and-animation.md`).
Scope: formations, movement techniques, drills as movement sequences, cover, and infantry with vehicles. Weapons
effects only where doctrine ties them to posture and cover. Every number carries a source tag that resolves at the end;
**ESTIMATE** marks a number no source gave. US Army doctrine is the main public source; the game's KDF is fictional, and
nothing here claims to describe IDF practice.

## Contents

1. [Organisation](#1-organisation)
2. [Fire team formations](#2-fire-team-formations)
3. [Squad formations](#3-squad-formations)
4. [Spacing by terrain and visibility](#4-spacing-by-terrain-and-visibility)
5. [Sectors of fire](#5-sectors-of-fire)
6. [Movement techniques](#6-movement-techniques)
7. [Fire and movement](#7-fire-and-movement)
8. [Battle drills as movement](#8-battle-drills-as-movement)
9. [Danger areas](#9-danger-areas)
10. [Urban movement](#10-urban-movement)
11. [Cover, concealment, silhouette and smoke](#11-cover-concealment-silhouette-and-smoke)
12. [Holding a position](#12-holding-a-position)
13. [Infantry with vehicles](#13-infantry-with-vehicles)
14. [Sources](#sources)

---

## 1. Organisation

- A US Army rifle squad is a squad leader and two four-man fire teams, nine men ([S35], FM 3-21.71, via search summary). A fire team
  is a team leader, an automatic rifleman, a grenadier and a rifleman ([S9]).
- Fire teams "rarely act independently" ([S1] para 3-45). The squad leader commands through the two team leaders and
  designates a **base fire team** that the other cues off, in and out of contact ([S2] paras 3-50, 3-51).
- Attached weapons (medium machine gun, Javelin, recoilless rifle) ideally travel **between the two fire teams** and
  near the squad leader ([S2] para 3-52, [S3] para 3-79).

## 2. Fire team formations

### Wedge, the basic formation

- "The interval between Soldiers in the wedge formation is normally **10 meters**" ([S1]; same figure in FM 3-21.8 2007
  and FM 7-8, [S6] para 2-7).
- The **team leader leads**; the others are echeloned right and left behind him. "Positions for all but the leader may
  vary" ([S1]).
- The common teaching layout ([S9], from the FM 3-21.8 figure): team leader at the point; **automatic rifleman behind
  and to the left**; **grenadier behind and to the right**; **rifleman behind the automatic rifleman**, further back and
  out. Every man about 10 m from the next on a roughly 45-degree diagonal.
- Characteristics ([S9], from the FM's table): control easy, flexibility good, **fires immediately in all directions**,
  security good.
- In rough terrain or poor visibility the interval shrinks so everyone can see the team leader; the sides can close up
  until the wedge becomes a file; the team spreads out again on easier ground ([S1]).
- The leader's rule: "Follow me and do as I do." Soldiers move when he moves and fire when he fires ([S1]).

### File

- For severely restrictive terrain, inside buildings, dense vegetation or limited visibility ([S1]).
- Interval "changes with the situation, particularly in urban operations" ([S1]); the teaching figure is **10 m**
  ([S9]).
- Order in the teaching figure: team leader, automatic rifleman, grenadier, rifleman ([S9]).
- Characteristics: control easiest; less flexible than the wedge; **fires to the flanks, masks most fire to the front
  and rear**; security least ([S9]).

## 3. Squad formations

| Formation | Use | Layout | Source |
|---|---|---|---|
| **Squad column** | the main movement formation, except when preparing to assault | two fire-team wedges one behind the other (a "column wedge"); the lead team is the base team; a rifleman of the trail team is rear security | [S2] para 3-53, [S6] para 2-8 |
| **Squad line** | maximum firepower to the front; the assault and pre-assault formation | two fire teams abreast; one designated base (the right team when the squad is the base squad, in FM 7-8) | [S2] para 3-54, [S6] |
| **Squad file** | severely restrictive or extremely close terrain | one file; the squad leader may move to the second or third position; a team leader last controls the rear | [S2] para 3-55, [S6] |

Line, echelon and column are the least flexible formations: a line masses fire forward and leaves the flanks open, and a
column has trouble reinforcing the element in contact ([S4] para 3-42). Formations "need not be parade-ground precise"
([S4] para 3-39).

**Squad-level spacing was not given numerically** in the ATP pages read ([S2]). With 10 m inside each wedge and the
Ranger Handbook's 20 m between teams when traveling ([S8a]), a squad column is roughly **20-30 m wide and 50-60 m deep**
(derived: two wedges 20 m wide and 20 m deep, 20 m apart).

## 4. Spacing by terrain and visibility

| Situation | Spacing between men | Between teams or elements | Source |
|---|---|---|---|
| Fire team wedge, open ground | 10 m | — | [S1], [S6] |
| Traveling (contact unlikely) | 10 m | 20 m | [S8a] Ranger Handbook ch 6 |
| Traveling overwatch (contact possible) | 20 m | 50 m; the lead team at least 50 m ahead | [S8b], [S3] para 3-79 |
| Bounding overwatch (contact expected) | about 20 m | varies with terrain | [S8b] |
| Platoon: lead squad ahead of the platoon in traveling overwatch | — | 50-100 m | [S8b] |
| Road march, day | 2-5 m (over 5 m hinders control) | 50 m between platoons, 100 m between companies | [S11] para 4-7 |
| Road march, night | 1-3 m | 25 m between platoons, 50 m between companies | [S11] para 3-2e, 4-7 |
| Urban fire team crossing open areas | 3-5 m | — | [S30] FM 3-06.11 para 3-8 |
| Inside a building | 12-18 in (30-45 cm) off the wall; never alone in a hallway | — | [S30] para 3-25a |

The principle behind every row: **disperse up to the limit of control** ([S1] para 3-45). Every soldier must see his
team leader, and every team leader his squad leader ([S4] para 3-43). Night halves the spacing; urban terrain cuts it to
a few metres.

**The accordion effect.** A change of pace at the head of a column grows down its length, so the rear has to run to
keep its distance; the cure is for the lead to slow after an obstacle ([S11] para 4-6). Visible on screen as a file
bunching and stretching at a gap in a wall.

## 5. Sectors of fire

- Each soldier covers an assigned sector for observation and direct fire while moving; sectors **interlock for
  360-degree security**; team leaders check and correct them ([S1]).
- The squad leader owns 360-degree security, mutually supporting sectors, and a rapid transition on contact ([S2]
  para 3-50).
- At a short halt, soldiers spread out, go **prone behind cover**, and watch their sectors; sectors overlap ([S6] paras
  2-4a, 2-4c).
- In a file, fire goes to the flanks and the men in front and behind mask each other ([S9]).
- In a room, numbers 1 and 2 cover straight ahead and then along the entry wall; numbers 3 and 4 start at the centre of
  the far wall and clear toward their side, stopping short of 1 and 2 ([S30] para 3-21d).

**What this looks like:** in a moving wedge the heads and muzzles are NOT all pointed forward. The point man looks
ahead, the flank men look out to their sides, and the last man checks the rear.

## 6. Movement techniques

Chosen by the likelihood of contact ([S3], [S6] para 2-10):

| Technique | When | Speed vs security | Shape |
|---|---|---|---|
| **Traveling** | contact unlikely, speed needed | fastest, least secure | squad moves together; 10 m / 20 m spacing ([S8a]) |
| **Traveling overwatch** | contact possible | middle | lead team at least 50 m ahead of the rest ([S3] para 3-79); 20 m / 50 m ([S8b]) |
| **Bounding overwatch** | contact expected; the leader senses the enemy (movement, noise, reflection, trash, fresh tracks, intuition); crossing a large open danger area | slowest, most secure | one team moves while the other overwatches from cover ([S3] para 3-80) |

### Bounding overwatch in detail ([S3] paras 3-80 to 3-84)

- The **lead team overwatches first**; the trail team bounds, then signals it is ready to overwatch.
- The squad leader **usually stays with the overwatch team**; both team leaders must know where he is.
- The bounding team moves on **covered and concealed routes** to its next support-by-fire position unless it makes
  contact en route; its leader must know the destination, route, likely enemy, actions on arrival and where the
  overwatch is.
- **Bound length** depends on terrain and the range of the overwatching weapons ([S3] para 3-82). A training rule:
  never bound beyond sight or the overwatching weapons' maximum effective range (slide deck in search results; not
  doctrine text).
- **Alternate bounds**: the rear element passes the lead and takes over the overwatch. Faster ([S3] para 3-83).
- **Successive bounds**: the rear element comes up only level with the lead. Easier to control, slower ([S3] para 3-84).
- **Only one element moves at a time** in both ([S3]).

**Timing (ESTIMATE).** No source timed a bound. A bound of 30-100 m by covered routes at 1-3 m/s, with a pause to take
the overwatch position and signal, gives roughly **20-90 s per bound**. The game's sim uses 2 s fire / 2 s move cycles
for its band-range bounds (`BOUND_FIRE_TICKS`, `BOUND_MOVE_TICKS`), which is closer to a rush cycle than to a
doctrinal bound.

## 7. Fire and movement

- **Maneuver** is movement combined with direct fire after contact; tactical movement (above) is movement before
  contact ([S1] chapter intro, via [S34]).
- Within a fire team, buddy teams alternate: one man or pair fires while the other moves by crawls or 3-5 s rushes
  ([S10]). A secondary summary gives the move per rush in fire and movement as 5-10 m ([S40], citing FM 3-21.8 p. 1-8);
  the rush arithmetic in `soldier-movement.md` gives 11-24 m for a full 3-5 s rush.
- The squad can go from the squad line into any of the three movement techniques or fire and movement ([S2] para 3-54).

## 8. Battle drills as movement

ATP 3-21.8 (2024) Appendix E lists the current drills ([S5]): React to Direct Fire Contact (squad and platoon), Conduct
a Squad/Platoon Assault, Break Contact, React to Ambush (dismounted), Knock Out a Bunker, Enter and Clear a Room, Enter
a Trench, React to Indirect Fire, React to Aircraft, Establish Security at the Halt, Conduct a Hasty Attack, Dismount a
Vehicle Under Direct Fire, and others. The step texts below are from FM 7-8 (1992), whose drills the current ones
descend from ([S7]); verify against ATP 3-21.8 before quoting.

### React to contact ([S7] Drill 2)

1. Soldiers **immediately take the nearest covered positions** and return fire toward the contact.
2. Team leaders locate and engage the enemy with aimed fire; they control fire by fire commands.
3. Soldiers keep contact with the men to their left and right and with their team leader.
4. The squad leader (or platoon leader) **moves up to the element in contact** and links up with its leader. In a
   platoon, the platoon leader brings his radio operator, forward observer, the nearest squad leader and one machine-gun
   team; the platoon sergeant comes forward with the second machine-gun team.
5. The leader decides whether to stay and fight (go to the assault drill) or leave the engagement area.
6. Team leaders lead by example, moving with their teams.

### Break contact ([S7] Drill 3)

1. One fire team or squad in contact becomes the **base of fire** and covers the disengagement of the rest.
2. The leader gives the first moving element a distance and direction, a terrain feature or the last rally point.
3. The base of fire keeps suppressing.
4. The moving element uses **fragmentation, concussion and smoke grenades to mask its movement**.
5. The moving element takes its position and engages; then the base of fire moves back, by fire and movement if
   needed.
6. The unit **keeps bounding away** until contact is broken, it passes through a friendly support-by-fire position, or
   it reaches its assigned position.
7. Afterwards, consider a change of direction so enemy indirect fire misses. A disrupted unit moves to the last rally
   point.

As seen from above: **two groups leapfrogging backwards**, each covering the other, with smoke between them and the
enemy.

### React to ambush ([S7] Drill 4)

- **Near ambush (within hand-grenade range):** soldiers in the kill zone throw grenades and then **assault through the
  ambush** by fire and movement immediately after the detonations; soldiers outside the kill zone take cover and shift
  fire as the assault moves forward.
- **Far ambush (beyond grenade range):** soldiers in the kill zone return fire and suppress; soldiers NOT under fire
  move by a covered route to a **vulnerable flank** and assault by fire and movement; the kill-zone element shifts fire
  as they go through.
- On a road march, an ambushed march unit **increases speed and fights through** ([S11] para 4-3b).
- Movement signature: near ambush, the whole element turns INTO the fire; far ambush, part freezes and fires while part
  swings wide around.

### React to indirect fire

On a road march the unit under fire keeps moving and the rest bypass the impact area ([S11] para 4-3). Task and
Purpose's summary of the current drill gives no distance to clear the impact area ([S31]).

## 9. Danger areas

Roads, trails, open fields, streams: anywhere the unit is exposed. FM 7-8 para 2-11 ([S6]):

- **Linear danger area (road, trail):** the lead signals and the unit halts. **Near-side security** (usually the trail
  squad) goes into position covering left and right. **Far-side security** crosses, clears the far side, sets an
  observation post and signals. **The main body crosses quickly**; near-side security crosses last, where the main body
  crossed. Near- and far-side rally points are named.
- **Large open area:** traveling overwatch to save time; switch to **bounding overwatch when contact is possible or when
  within small-arms range of the far side, about 250 m**.
- **Small open area:** bypass it, either by a **detour of 90-degree turns** (box around it; the offset legs are not
  counted in the route's pace count) or by **contouring** along the wood line to a far-side rally point.
- Large units cross one element at a time ([S6]).
- Bounding overwatch may also be used to cross a linear danger area without fully securing both sides (CALL bulletin,
  [S44], via search summary).

What reads at RTS scale: **a pause at the edge, two men posted left and right, a small group dashing across, then the
rest crossing in a rush.**

## 10. Urban movement

FM 3-06.11 (2002) chapter 3 ([S30]):

- **Crossing open areas (3-1):** avoid streets, alleys and parks; **use smoke** (hand grenades or smoke pots) to hide
  the crossing (thermal sights see through it); recon and plan first; **run the shortest distance** between buildings
  and move along the far building.
- **Moving parallel to buildings (3-2):** use smoke, suppressive fire and cover; **stay at least 12 in (30 cm) from the
  wall**; keep in the shadow; keep a low silhouette; move rapidly to the next position; other squad members overwatch.
- **Past windows (3-3):** stay **below window level** and near the wall; pass basement windows by stepping or jumping
  past without exposing the legs.
- **Around corners (3-4):** look before moving; do not let the muzzle show; either lie flat and look out at ground level,
  or "pie" the corner: aim beyond it and side-step around, pivoting on the muzzle.
- **Crossing a wall (3-5):** recon the far side, then **roll over quickly**, staying low.
- **Doorways (3-6):** do not use them as entrances or exits; if you must, pick the next position first and go fast and
  low under covering fire.
- **Between positions (3-7):** do not mask friendly fire; cover each other; **fire around cover, not over it**.
- **Fire team (3-8):** cross open areas as a group using the building as cover, **3-5 m apart**; on a signal, make an
  abrupt flanking move on line to the next building.
- **Inside (3-25):** never move alone in a hallway; **12-18 in from the walls** (rubbing makes noise; ricochets travel
  along walls). Hallways: **serpentine** in narrow halls (No. 1 front, 2 and 3 flanks, 4 with the automatic rifle
  covering the rear) or the **rolling T** in wide halls (1 and 2 abreast, 3 firing between them down the hall, 4 rear).
  Stairs: the three-man flow, with overwatch up and down.

### Entering and clearing a room

FM 3-06.11 paras 3-19 to 3-22 ([S30]) and FM 7-8 Drill 6 ([S7]):

1. A base of fire covers the building; the assault team approaches by a covered route, **entering at the highest level
   possible**.
2. The team moves from cover **already in entry order** and gets as close to the entry as cover allows: the posture
   training calls a "stack" (the term is not in these texts). The team leader is normally No. 2.
3. A grenade may go in first (cooked off two seconds at most, [S7]).
4. On the signal or right after the detonation, everyone goes through without stopping: the door is the **"fatal
   funnel"**.
   - **No. 1** goes along the path of least resistance to a corner, deep into the room.
   - **No. 2** enters almost at the same time and goes the **opposite way** along the wall.
   - **No. 3** goes opposite No. 2, **at least 1 m from the entry**.
   - **No. 4** goes opposite No. 3.
5. Nobody's point of domination is in front of a door or window, and nobody masks another's fire. On order, one man
   moves deeper under cover of the rest.
6. The team leader reports the room clear; the squad leader marks it; the next team moves to the next room. Squads
   rotate fire teams to keep momentum ([S7] para 14).

**Speed** is measured by how fast the threat is removed and the room cleared, not by how fast the team enters
([S30] 3-21a). Most urban engagements are at **35 m or less** ([S30] para 7-1b).

## 11. Cover, concealment, silhouette and smoke

- **Cover stops fire; concealment only hides.** Cover: gullies, ravines, ditches, walls, large trees, rocks, stumps,
  rubble, vehicle hulks, folds in the ground. Concealment only: hedgerows, thick vegetation. High grass: partial
  concealment, rush through it rather than crawl ([S10]).
- **Folds in the ground** are the route: move along them, choose the next position before getting up, and never cross
  in front of a teammate's fire ([S10]).
- **Silhouette:** do not silhouette in windows or doorways; fire from the shadowed inside of a room, back from the
  window and kneeling; prone when no cover exists; never against a lighter background ([S30] 3-3, 3-28, 3-37a).
- **Walls and buildings:** fire around, not over; use either shoulder; hug buildings and keep to the shadowed side of a
  street, never the centre ([S30] 3-7, 3-28, 6-13).
- **Smoke:** the moving element masks itself with smoke grenades when breaking contact ([S7] Drill 3); smoke covers
  urban crossings ([S30] 3-1). An M18 smoke grenade burns **50-90 s**, has a **1.0-2.3 s fuze delay**, and is thrown about
  **35 m** ([S28f]). Thermal sights see through ordinary smoke ([S30] 3-1).

## 12. Holding a position

- Short halt: everyone down, behind cover, facing out in overlapping sectors; leaders post observation posts ([S6]
  2-4c).
- Long halt or a lone fire team: **perimeter (all-round) defence** ([S1] para 3-45, [S6] 2-4d).
- Platoon sectors in urban defence are **100-300 m wide** ([S30] para 5-28b).
- Men in buildings fire from back in the room, around cover, and change windows so as not to set a pattern ([S30]
  3-29e).

## 13. Infantry with vehicles

### Carriers

| Vehicle | Dismounts | Exit | Source |
|---|---|---|---|
| Namer heavy APC (IDF) | 9 infantry (12 aboard with the 3 crew) | wide rear door-ramp; two roof hatches | [S28g] |
| M113 APC | 11-15 passengers | rear ramp | [S28h] |
| Bradley IFV | not a full squad: the compartment was not designed for one | rear ramp or combat door | [S32] RAND |

### Dismounting

- **US Army battle drill (dismount a BFV or ICV):** each fire team must be out in **30 s through the ramp** or **45 s
  through the combat door**. ICV seats empty in pairs from the rear: 10 and 11, then 8 and 9, 6 and 7, 4 and 5, then 3
  ([S31]). The platoon first moves to covered and concealed ground ([S31b], via search summary).
- I found **no public dismount time for the Namer or the M113.** For the Namer, assume the Bradley ramp standard as a
  reference: 9 men in 30-45 s, the first out in about 5-10 s (**ESTIMATE**).
- **Under fire**, the drill is "Dismount a Vehicle Under Direct Fire" ([S5]); its steps were not retrieved.
- Riders go to ground around the ramp and take sectors, then move off as a squad (**ESTIMATE** of what it looks like;
  no source describes the post-ramp spread).

### Moving with tanks and IFVs

FM 3-06.11 ([S30]):

- **In open areas a tank section leads; in close terrain infantry leads while tanks overwatch** (para 4-39).
- In narrow streets, or streets with narrow paths through debris, **infantry move ahead of the tanks clearing the
  buildings on each side** ([S30b], via search summary of ch 4).
- Each Bradley section **overwatches the squad in front of it, watching the opposite side of the street**, and an
  overwatching vehicle should itself be protected by dismounts (para 4-31a).
- On contact, tanks fix and isolate the enemy by fire while the dismounts maneuver (para 4-31b). Vehicles fire from
  covered positions and displace so they are not targeted twice (para 4-37).
- **Danger zones around a tank:** exposed infantry should not be forward of a firing tank in its **60-degree frontal
  arc** (discarding sabot petals are lethal); the **heat behind an M1** stops infantry following closely; fragments and
  ricochets off armour are historically a main cause of infantry casualties in cities ([S30b], via search summary).
- Tanks cannot engage close street-level or overhead targets, and buttoned-up crews see poorly to the flanks and rear
  (para 5-34) — this is why infantry screen them.
- Current thinking: the lead can shift between infantry and armour as the threat changes; at Fallujah the lead vehicles
  covered dismounts, who found strongpoints and called the tanks forward ([S32b], 2025).

**Spacing (ESTIMATE).** No source read gives a metre figure. The doctrine's shape is: dismounts a building or two ahead
on both sides of the street, the vehicle behind them overwatching the far side, and nobody in the arc in front of the
gun or directly behind the engine. At game scale that is dismounts 2-6 tiles ahead and to the side of the hull.

---

## Sources

- [S1] ATP 3-21.8 (2024), fire team movement formations, paras 3-44 to 3-48, HTML mirror:
  https://infantrydrills.com/manuals/fm-atp-3-21-8-infantry-rifle-platoon-squad-2024/movement-and-maneuver/tactical-movement-approach-march/movement-formations/fire-team-movement-formations/
- [S2] ATP 3-21.8 (2024), squad movement formations, paras 3-49 to 3-55:
  https://infantrydrills.com/manuals/fm-atp-3-21-8-infantry-rifle-platoon-squad-2024/movement-and-maneuver/tactical-movement-approach-march/movement-formations/squad-movement-formations/
- [S3] ATP 3-21.8 (2024), squad movement techniques, paras 3-78 to 3-84:
  https://infantrydrills.com/manuals/fm-atp-3-21-8-infantry-rifle-platoon-squad-2024/movement-and-maneuver/tactical-movement-approach-march/movement-techniques/squad-movement-techniques/
- [S4] ATP 3-21.8 (2024), movement considerations, paras 3-39 to 3-43:
  https://infantrydrills.com/manuals/fm-atp-3-21-8-infantry-rifle-platoon-squad-2024/movement-and-maneuver/tactical-movement-approach-march/movement-formations/movement-considerations/
- [S5] ATP 3-21.8 (2024), Appendix E, battle drills (list):
  https://infantrydrills.com/manuals/fm-atp-3-21-8-infantry-rifle-platoon-squad-2024/appendix-e-battle-drills/
- [S6] FM 7-8 (1992), chapter 2, mirror: https://550cord.com/infantry-rifle-platoon-squad-fm-7-8/fm-7-8-chapter-2-operations/
- [S7] FM 7-8 (1992), chapter 4, battle drills, mirror:
  https://550cord.com/infantry-rifle-platoon-squad-fm-7-8/fm-7-8-chapter-4-battle-drills/
- [S8a] Ranger Handbook, ch 6, p. 101 (traveling 10 m / 20 m): https://relayto.com/explore/ranger-handbook-xq5p163k9y49e/QF1oGru6101
- [S8b] Ranger Handbook, ch 6, p. 102 (traveling overwatch, bounding overwatch):
  https://relayto.com/explore/ranger-handbook-xq5p163k9y49e/gPUcHVal102
- [S9] University of Akron Army ROTC, *Tactics 1b* (2014), wedge and file figures and characteristics table:
  https://uakron.edu/armyrotc/MS1/33.pdf
- [S10] STP 21-1-SMCT task 071-326-0502, *Move Under Direct Fire*, reproduced:
  https://prepare-and-protect.net/2013/12/move-under-direct-fire
- [S11] FM 21-18, *Foot Marches* (1990): https://elon.edu/assets/docs/rotc/FM%2021-18%20Foot%20Marches.pdf
- [S28f] Wikipedia, *M18 smoke grenade*: https://en.wikipedia.org/wiki/M18_smoke_grenade
- [S28g] Wikipedia, *Namer*: https://en.wikipedia.org/wiki/Namer
- [S28h] Wikipedia, *M113 armored personnel carrier*: https://en.wikipedia.org/wiki/M113_armored_personnel_carrier
- [S30] FM 3-06.11, *Combined Arms Operations in Urban Terrain* (2002), full text (chapters 3, 4, 5, 7):
  https://archive.org/stream/Coed_Arms_Operations_in_Urban_Terrain_FM_3-06.11/Combined_Arms_Operations_in_Urban_Terrain_FM_3-06.11_djvu.txt
- [S30b] FM 3-06.11 chapter 4 on tanks with infantry (60-degree arc, M1 heat), via search summary of
  https://www.globalsecurity.org/military/library/policy/army/fm/3-06-11/ch4.htm (refused direct access)
- [S31] Task and Purpose, *How well do you know the Army's 14 battle drills?* (dismount standards, ICV seat order):
  https://taskandpurpose.com/military-life/us-army-battle-drills/
- [S31b] Fort Benning ATP 3-21.8 doctrine supplement, Battle Drill 12 (via search summary; site unreachable):
  https://www.moore.army.mil/Infantry/DoctrineSupplement/ATP3-21.8/appendix_j/BattleDrill_11/Introduction/index.html
- [S32] RAND, *Understanding Why a Ground Combat Vehicle That Carries Nine Dismounts Is Important to the Army*:
  https://www.rand.org/pubs/research_reports/RR184.html (via search summary)
- [S32b] Johnstone J, Jordan C (2025), *Tanks in Cities? Preparing the Armored Force for the Urban Fight*, army.mil:
  https://www.army.mil/article/286862/tanks_in_cities_preparing_the_armored_force_for_the_urban_fight
- [S34] ATP 3-21.8 (2016) chapter text on movement vs maneuver (reader page): https://textopian.com/read/6ni9!9/
- [S35] FM 3-21.71, *Mechanized Infantry Platoon and Squad (Bradley)* (2002):
  https://upload.wikimedia.org/wikipedia/commons/9/96/FM_3-21.71_Mechanized_Infantry_Platoon_and_Squad_(Bradley)_August_2002.pdf
- [S40] Wikipedia, *Individual movement techniques* (fire and movement 5-10 m per move, citing FM 3-21.8 p. 1-8):
  https://en.wikipedia.org/wiki/Individual_movement_techniques
- [S44] CALL 97-15, *Patrolling TTP for Crossing Linear Danger Areas* (via search summary):
  https://www.globalsecurity.org/military/library/report/call/call_97-15_ctc3q1a.htm
