# How combat vehicles move tactically: public doctrine for AI and formations

Reference notes for Roaring Lions developers (section 4 of the research brief). Public US
Army doctrine only. Source tags `[n]` refer to the list at the end. **(estimate)** or
**(heuristic)** marks anything not stated by a source.

**The main text, and why.** The US tank-platoon manual's line of succession is FM 17-15
(1996), then FM 3-20.15 (2007), then ATP 3-20.15 (2012, then 2019, and a 2025 revision per
the Army [3]). Only the **FM 17-15 (1996)** text could be downloaded in full [1]. The FAS
copy of ATP 3-20.15 returned an empty body to both the fetch tool and curl [2]. The
techniques and formations below are quoted from FM 17-15. The later manuals keep the same
three techniques and six formations; their tables of contents and secondary summaries
confirm the headings [2], [4]. Exact wording may differ in the current edition.

## Contents

1. [Movement techniques](#1-movement-techniques)
2. [Formations](#2-formations)
3. [Intervals between vehicles, and why](#3-intervals-between-vehicles-and-why)
4. [Terrain use](#4-terrain-use)
5. [Firing: short halt vs on the move](#5-firing-short-halt-vs-on-the-move)
6. [Tanks and infantry carriers together; dismount points](#6-tanks-and-infantry-carriers-together-dismount-points)
7. [Road march and convoy spacing and speed](#7-road-march-and-convoy-spacing-and-speed)
8. [Reversing out of a position (shoot and scoot)](#8-reversing-out-of-a-position-shoot-and-scoot)
9. [Translating doctrine to Roaring Lions scale](#9-translating-doctrine-to-roaring-lions-scale)
10. [Sources](#sources)

---

## 1. Movement techniques

FM 17-15 bases the choice on three factors: "the likelihood of enemy contact", "the
availability of another element to provide overwatch", and "the terrain over which the
moving element will pass" [1]. Who overwatches whom depends on the terrain [1]:

- in **open terrain** (desert), one company overwatches another;
- in **close terrain** (rolling hills), platoons overwatch platoons;
- in **restrictive terrain** (mountains, forest, urban), a tank section relies on another
  section or on dismounted infantry.

| Technique | When | What moves | Doctrine text [1] |
|---|---|---|---|
| **Traveling** | Contact unlikely, speed important | Every element, continuously | "Characterized by continuous movement of all elements" |
| **Traveling overwatch** | Contact possible, speed desirable | The lead moves continuously. The trail "moves at various speeds and may halt periodically to overwatch the movement of the lead element" | The trail "maintains dispersion based on its ability to provide immediate suppressive fires in support of the lead element" |
| **Bounding overwatch** | Contact expected | One element at a time | "the most secure, but slowest, movement technique" |

**The two kinds of bound** [1]:

- **Alternate bounds.** The lead moves forward, halts and overwatches. "The rear element
  advances past the lead element and takes up overwatch positions", and so on, leapfrogging.
  This is "usually more rapid than successive bounds". Open terrain favours it when speed
  matters [5].
- **Successive bounds.** The lead advances. The rear element moves up "abreast of the lead
  element and halts", and "the rear element avoids advancing beyond the lead element". This
  is easier to control and more secure, but slower. Restrictive terrain favours it [5].
- **Both:** "Only one element moves at a time."

**Bound length:** "the distance of each move (or bound) must not exceed the direct fire range
of the overwatch element" [1]. The planning ranges in FM 17-15 are 2,000 m for the 105 mm gun
and 2,500 m for the 120 mm gun [1].

**AI rule (heuristic, from the above).** Pick the technique from the estimated probability of
contact. Split a group into two elements (two-tank sections of a four-tank platoon). In
bounding overwatch, end each bound at the next covered position that is still within the
overwatch element's weapon range.

## 2. Formations

"Formations are not intended to be rigid, with vehicles remaining a specific distance apart
at every moment." Position depends on terrain and on the wingman's awareness, but "individual
tanks should always occupy the same relative position within a formation" [1]. The six
movement formations and two halt formations [1]:

| Formation | Fires | Used when [1] |
|---|---|---|
| **Column** | "excellent control and fire to the flanks, but permits less fire to the front" | Speed critical, restrictive terrain on a set route, contact not likely |
| **Staggered column** | One section leads and one trails to overwatch. "Good fire to the front and flanks" | Speed critical, little room to spread sideways, contact possible |
| **Wedge** | "Excellent firepower to the front and good firepower to the flanks" | Overwatched by another element, open or rolling terrain |
| **Echelon** | "Excellent firepower to the front and to one flank" | Screening an exposed flank |
| **Vee** | "Excellent protection and control, but limits fires to the front" | Terrain restricts movement, or overwatch needed within the platoon |
| **Line** | "Maximum firepower forward" | Crossing danger areas under overwatch, or the assault |
| **Coil** (halt) | 360° perimeter | Extended halts when operating independently. The lead halts facing 12 o'clock and the others form a circle |
| **Herringbone** (halt) | 360°, ready to resume movement | Road-march halts. Vehicles pull off the road "at a 45-degree angle, allowing passage of vehicles through the center" |

The mechanised-infantry manual of the same era lists five mounted formations: column, line,
echelon, vee and wedge [4]. In traveling overwatch, a platoon "may move in a column, wedge,
or echelon formation with turrets oriented into assigned sectors" [4b].

**Turret orientation:** each tank covers a sector. In the wedge, outer tanks look outward and
the lead looks forward [1], [4b].

## 3. Intervals between vehicles, and why

Doctrine gives **reasons** for spacing more often than numbers. The numbers it does give:

| Situation | Interval | Why | Source |
|---|---|---|---|
| Traveling overwatch, trail element | not fixed: "an interval dictated by the capabilities of its weapon systems and the effects of terrain" | The trail must be able to suppress whatever engages the lead, and must not be caught in the same fire | [1] |
| Air attack threat (passive or active drill) | "at least 100 meters between tanks" | Forces "aircraft to make several passes to engage the entire platoon" | [1] |
| Defence, platoon in battle position | "generally 100 to 250 meters between tanks" | Dispersion "reduces vulnerability... to enemy fires" but "increases the demands for local security in the area between" positions | [1] |
| Road march, open column (day) | 50-200 m by light and weather | Dispersion against observation and fire, plus control | [1] |
| Road march, close column (limited visibility) | "normally less than 50 meters": the distance at which the driver can see the vehicle ahead | Control at night | [1] |
| General vehicle movement (chemical-unit manual) | about 50 m, terrain permitting | | [6] (search snippet) |
| Dismounted infantry, for comparison | about 10 m between soldiers in a fire-team wedge; about 50 m between teams in traveling overwatch | | [7] (search snippet) |

**Why spacing exists, in one line each:**

- **Survivability:** one burst, one missile salvo or one strafing pass should not take two
  vehicles.
- **Mutual support:** each vehicle must be close enough to fire into its neighbour's sector.
- **Control:** each driver must keep the vehicle he follows in sight.
- **Terrain:** spacing shrinks in close terrain because sight lines shrink.

**Typical moving-formation intervals (estimate).** The wedge, line and vee have no published
figure. About 50-100 m in close terrain and 100-300 m in open desert is consistent with the
numbers above (air threat ≥ 100 m, defence 100-250 m). It is not a doctrinal statement.

## 4. Terrain use

**Movement rules** [1]:

- "Do not move forward from an overwatch position or BP. Back away from your position and go
  around on the low ground."
- "Stay on low ground as much as possible. Moving on top of ridgelines and over hilltops will
  silhouette (skyline) platoon vehicles."
- Scan for "disturbed earth, out-of-place features, and surface-laid mines."
- At danger areas, the commander or loader may dismount to "observe around blind spots or
  check the trafficability of a route or defile".
- Under air attack, tanks "move as fast as possible at a 45-degree angle away from the path
  of flight". Afterwards they "freeze their movement for at least 60 seconds after the last
  flight of aircraft has passed" [1].

**Hull-down and turret-down** [8]:

- **Hull-down:** the hull is "behind a crest or other raised ground", with the turret
  exposed. The tank can fire its main gun.
- **Turret-down:** "the vehicle is completely hidden", and the crew observes from the roof
  hatches. Usually "a few metres further back" than hull-down. From turret-down a tank "can
  fire only" its roof machine guns, and observation uses the commander's sight [1].
- **Gun depression decides whether hull-down works.** A hull parked behind a crest tilts
  nose-up, so the gun must depress. Western tanks have about −10°, Soviet tanks about −5° [8].

**The doctrinal sequence for occupying a defence** [1]:

1. Move into hide positions behind the fighting positions.
2. On order, move simultaneously into turret-down positions.
3. On order, move to hull-down positions to complete sector sketches.
4. Go back to hide.
5. In the fight, TCs move between hull-down and turret-down "based on two considerations:
   the necessity to maintain direct fire on the enemy and the effectiveness of enemy fires".

**Reverse slopes and re-cresting** [8]: after observing, a vehicle reverses off the crest and
looks for a route through dead ground. If it must cross a crest, it "can back down and jockey
at least 50 metres along the covered back of the slope". It then crosses at high speed, which
limits the enemy's time to aim.

**Cover to cover.** Every bound should end in a covered position, as the bounding-overwatch
rules above require. Use folds in the ground, wadis and the low ground [1].

## 5. Firing: short halt vs on the move

- **On the move.** A stabilised modern tank can "hit a target moving thirty miles an hour
  while itself is moving at the same speed" at 2,000 m or more, with accuracy close to a
  standstill [9]. Accuracy depends on stabilisation: early single-plane US systems were
  effective up to 10 mph [9].
- **Short halt.** The vehicle stops, fires, and moves on. Doctrine uses it for overwatch: the
  trail element "can execute a short halt on key terrain to provide more effective
  overwatch" [1]. In the defence, TCs "execute a short halt and overwatch the engagement
  area" [1].
- **The trade-off**, as a military-police manual (not armour doctrine) puts it: "Firing on
  the move is less accurate than firing from a halt. However, to halt and fire takes more
  time and is more dangerous" [10] (search snippet).
- **Unstabilised weapons** (a technical's machine gun or autocannon, older guns) need a halt
  to hit anything at range (mechanism, follows from [9]).

**Game reading (heuristic).** Firing on the move should be a per-weapon property
(stabilised or not), not a blanket penalty. A stabilised MBT gun loses little on the move. A
pickup-mounted weapon loses a lot.

## 6. Tanks and infantry carriers together; dismount points

**From the light/heavy appendix of FM 17-15** [1]:

- **Infantry leads.** This is the preferred way. Tanks either wait at a CP until called
  forward, follow "close enough to provide direct fire support when requested", or overwatch
  the infantry's movement from stationary positions. The infantry halts at a contact,
  suppresses AT weapons and calls the tanks forward. Tank and infantry leaders link up and
  coordinate. The infantry guides the tanks to firing positions and signals cease fire.
- **Tanks lead.** "The least preferred method." "Tanks must move very slowly when they lead
  infantrymen (approximately 2 1/2 miles per hour)", about **4 km/h**, which "hinders their
  ability to use speed as a survivability tool".
  - The infantry's AT assets "stay close enough to overwatch" the tanks.
  - The infantry "maintains a standoff distance to prevent injury from the 'splash' and
    ricochet of enemy AT weapons and small arms fire aimed at the tanks".
  - Tanks attract mortar and artillery fire, which strips away the infantry [1].
- **SABOT danger.** SABOT "cannot be fired over the heads or flanks of unprotected infantry"
  [1].

**Dismount points (mechanised infantry)** [4c] (search snippets of FM 7-7 and FM 3-21.71):

- The vehicles suppress and obscure the enemy while moving to covered dismount points.
- The driver stops "in a covered/concealed position with the vehicle pointed at the enemy".
  This keeps the hull's front armour, and the hull itself, between the enemy and the
  dismounting squad.
- "The mechanized platoon leader makes every effort to dismount in a covered and concealed
  location."
- After the dismount, the carriers overwatch and support by fire.
- A lessons-learned report noted that dismount and pick-up points "are not planned" as a
  common failing [4d].

## 7. Road march and convoy spacing and speed

FM 17-15 describes a road march as moving "rapidly, not to gain contact... using fixed
speeds and timed intervals" [1].

| Technique | Interval | Speed | Source |
|---|---|---|---|
| Open column (day) | 50-200 m (FM 17-15); "300 feet or more" (FHWA) | "in excess of 25 mph" (FHWA) | [1], [11] |
| Close column (night, limited visibility) | < 50 m (FM 17-15); 25-50 m (FHWA) | "under 25 mph" (FHWA) | [1], [11] |
| Infiltration | Small groups at irregular intervals | varies | [1], [11] |

- The march commander designates a **catch-up speed**, above the march rate, for vehicles
  regaining lost distance [12] (search snippet; values vary by manual).
- On interstate-type highways, one convoy guide calls for "at least 200 meters" when close
  column control is not essential [12].
- **Convoy escort by a tank platoon** [1]: a "modified traveling overwatch", with one section
  leading the convoy and one trailing, and enough dispersion within sections "to provide
  flank security". At a halt, the escort takes a short halt and overwatches.

## 8. Reversing out of a position (shoot and scoot)

- **The rule.** In a covered displacement, the platoon "simultaneously backs down to hide
  positions, keeping front hulls toward the enemy until adequate cover protects each tank".
  Tanks then "orient weapon systems toward the enemy as they move" [1]. Do not drive forward
  out of an overwatch position; back off and go around on low ground [1].
- **Why.** The frontal arc carries the armour. Turning round in contact shows the enemy the
  flank and then the rear (mechanism, consistent with [1]).
- **Shoot and scoot in practice.**
  1. Fire from hull-down.
  2. Reverse to turret-down or hide.
  3. Jockey sideways along the reverse slope, "at least 50 metres" per [8].
  4. Re-emerge somewhere else.
  TCs move between primary and alternate positions as the effectiveness of enemy fire
  dictates [1].
- **Reverse speed** is lower than forward: the Leopard 2 does 31 km/h against 68 km/h
  forward (see `dynamics.md` 2.4).

## 9. Translating doctrine to Roaring Lions scale

The game compresses distance far more than time. Facts from the repository
(`vehicles-and-game.md` §7):

- 1 tile = 3 m.
- The Lavi's `gun_120` range is 12 tiles (36 m), against a real 120 mm planning range of
  2,500 m [1]. **Ranges are about 70× compressed.**
- The Lavi hull is about 2 tiles long. **Vehicle size is not compressed at all.**
- Maps are 48×48, 80×80 or 96×96 tiles (144-288 m a side).

So **real intervals in metres cannot be used**. A 100 m air-threat interval would be 33 tiles,
more than half a map. Two ways to translate (both **heuristics**):

- **By range ratio.** Doctrine spaces at about 4-10 % of the main gun's planning range (100-250
  m of 2,500 m). In the game that is 0.5-1.2 tiles, less than one hull length. So in the game,
  **spacing is set by the footprint, not by doctrine**. Today's `VEHICLE_SPACING` of 2 tiles,
  centre to centre (`packages/sim/src/formation.ts`), is already the practical minimum.
- **By order, not magnitude.** Keep the doctrinal ordering:
  close column < open column ≈ wedge < line < defence.
  Wider formations also cost more time to form and to control.
- **Bound length** maps cleanly: a bound must not exceed the overwatch element's weapon range.
  The Lavi's 12 tiles fit. The formation `leg_tiles` of 8 (`data/formations/*.json`) is a
  plausible bound.
- **Leading infantry:** tanks crawl. At 4 km/h against a real cross-country 55 km/h, they
  keep about 7 % of their speed. In the game, pace tanks to the infantry, as the Column
  formation's `pace: slowest_ground` already does.
- **Facing in a back-off:** keep the hull toward the threat. This is a sim rule, because
  `resolveHit` reads `facing` for the armour arc (see the gaps in `vehicles-and-game.md`).

---

## Sources

1. US Army **FM 17-15, *Tank Platoon*** (1 April 1996), via EverySpec (PDF downloaded and
   text extracted). Chapter 3 Section IV (movement, formations, overwatch), Chapter 3 air
   defence drills, Chapter 4 (battle positions, hull-down / turret-down, displacement),
   Chapter 5 Section I (road march), Section IV (convoy escort), Appendix B (light/heavy).
   https://everyspec.com/ARMY/FM-Field-Manual/download.php?spec=FM_17-15.013925.pdf
   (landing page https://everyspec.com/ARMY/FM-Field-Manual/FM_17-15_13925/)
2. US Army **ATP 3-20.15 (FM 3-20.15), *Tank Platoon*** (December 2012), FAS copy, which
   supersedes FM 3-20.15 of 22 Feb 2007. The fetch returned an empty body, so the text was
   not read. https://irp.fas.org/doddir/army/atp3-20-15.pdf
3. US Army, *Forging the Thunderbolt's Foundation: Doctrinal Updates to Tank and Scout
   Platoon Manuals* (revision history to 2025). https://www.army.mil/article/289372
4. FM 7-7, mechanised platoon movement (five mounted formations), GlobalSecurity (search
   snippet; 403 on fetch). https://www.globalsecurity.org/military/library/policy/army/fm/7-7/Ch4.htm
   4b. Army correspondence course IN0202 (traveling overwatch in column, wedge or echelon,
   turrets oriented) (search snippet).
   https://www.globalsecurity.org/military/library/policy/army/accp/in0202/le2c.htm
   4c. FM 3-21.71 Appendix E and FM 7-7 Appendix G, dismount positioning (search snippets).
   https://www.globalsecurity.org/military/library/policy/army/fm/3-21-71/appe.htm and
   https://www.globalsecurity.org/military/library/policy/army/fm/7-7/appg2.htm
   4d. CALL report 97-17 (dismount and pick-up points not planned) (search snippet).
   https://www.globalsecurity.org/military/library/report/call/call_97-17_ta1n2.htm
5. Army chemical operations course, *Movement Techniques*: alternate bounds when speed
   matters in open terrain, successive bounds when deliberate or restrictive (search snippet;
   TLS error on fetch). https://armychemicaloperations.tpub.com/cm3300b/Movement-Techniques-43.htm
6. Same source as [5]: rough vehicle interval of about 50 m (search snippet).
7. Ranger Handbook and infantry manuals: 10 m fire-team wedge, 50 m between teams (search
   snippet). https://relayto.com/explore/ranger-handbook-xq5p163k9y49e/gPUcHVal102
8. Wikipedia, *Hull-down*: definitions, gun depression, "jockey at least 50 metres".
   https://en.wikipedia.org/wiki/Hull-down
9. Wikipedia, *Gun stabilizer*. https://en.wikipedia.org/wiki/Gun_stabilizer
10. FM 3-19.4, military police (halt vs moving fire), GlobalSecurity (search snippet).
    https://www.globalsecurity.org/military/library/policy/army/fm/3-19-4/chap3.htm
11. FHWA, *Coordinating Military Deployments on Roads and Highways*, Appendix B "Military
    Convoy Movement Facts" (fetched). https://ops.fhwa.dot.gov/publications/fhwahop05029/appendix_b.htm
12. US Army Reserve, *Convoy Commander's Guide*: catch-up speed, ≥ 200 m on controlled-access
    highways (search snippet; 403 on fetch).
    https://www.usar.army.mil/Portals/98/Documents/Publications/PAMS/Convoy%20Commanders%20Guide.pdf
13. Wikipedia, *Bounding overwatch* (general background only).
    https://en.wikipedia.org/wiki/Bounding_overwatch
