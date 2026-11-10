# Perception at game scale, and VFX craft heuristics

How a real explosion unfolds in time, what the eye can resolve of it, what survives at RTS camera
distance, and the craft rules game-VFX artists use. Physics and perception are sourced; **craft
heuristics are marked as such and are not physics.** Tags: `[Sn]` sources at the end; **[derived]**
computed from `physics.md`; **[estimate]** my judgement.

## Contents

1. [The real timeline of one 155 mm surface burst](#1-the-real-timeline-of-one-155-mm-surface-burst)
2. [What the eye does with it](#2-what-the-eye-does-with-it)
3. [What reads at RTS camera distance](#3-what-reads-at-rts-camera-distance)
4. [Craft heuristics from game VFX (not physics)](#4-craft-heuristics-from-game-vfx-not-physics)
5. [Where physics and craft disagree, and who wins](#5-where-physics-and-craft-disagree-and-who-wins)
6. [A recipe that respects both](#6-a-recipe-that-respects-both)
7. [Sources](#sources)

---

## 1. The real timeline of one 155 mm surface burst

6.86 kg TNT on dry ground (`munitions-table.md`). Times from detonation.

| Time | Event | Size | Source |
|---|---|---|---|
| < 1 ms | detonation flash, case rupture | the shell | [estimate] |
| 0-5 ms | fireball pops out behind the shock, near full size | r ≈ 3 m | [S1], [derived] |
| 2.7 ms | shock at 3.6 m (54 psi) | | [derived] |
| 9.7 ms | shock at 7.2 m (11 psi) | | [derived] |
| 18 ms | shock at the 5 psi radius, 10.6 m | | [derived] |
| 75 ms | shock at the 1 psi radius, 31 m; still invisible | | [derived] |
| tens of ms | radiant intensity of the afterburning fireball peaks | | [S28] |
| 0.1-0.4 s | fireball fades from yellow-orange to dull red under soot | | [S1] |
| 0.1-2 s | soil column and clods rise; a few reach 10-30 m | | [derived from S16], [estimate] |
| 1-3 s | clods land, mostly within a few crater radii, some tens of m out | | [S16], [derived] |
| 30-60 s | buoyant cloud stabilises (tens of m; Church's 150 m is an upper bound) | | [S8], [S9] |
| minutes | fine dust drifts downwind, thinning | | [derived, Stokes] |

**The whole "explosion" in the sense of fire and pressure is over in about a third of a second. What
lasts is soil and smoke.**

Sound: at a distance `d`, the bang arrives `d / 343` s after the flash (0.9 s at 300 m) [derived]. An RTS
camera is a viewpoint, not a listener, so whether to delay audio is a design choice [estimate].

---

## 2. What the eye does with it

- **A frame is 16.7 ms at 60 fps** (the sim ticks at 20 Hz, 50 ms; `CLAUDE.md` invariant 1). The shock
  crosses a 155's entire 5 psi radius in about one frame [derived]. Any physically timed shock is a
  one-frame event.
- **Brief flashes are integrated.** Within a critical duration the visual system pools light (Bloch's
  law: threshold depends on luminance × duration) [S29]. The critical duration is not fixed: it shortens
  as luminance rises [S29]. The **Broca-Sulzer** effect makes a short flash look transiently brighter,
  peaking for flashes of about **50-100 ms**; past that, brightness plateaus [S29]. So a detonation
  flash shown for 2-6 frames (33-100 ms) at a high value reads as a bright flash; much longer and it reads
  as a lamp [derived from S29].
- **Order matters more than duration.** The eye reads flash, then fireball, then dust as a sequence; their
  physical durations (< 1 ms, ~0.3 s, minutes) span six orders of magnitude, and no game shows them to
  scale [estimate].

---

## 3. What reads at RTS camera distance

Roaring Lions, zoom 1: one tile = 3 m = **45 px** of ground and **39 px** of height (GH-1197 design §5),
so about **15 px per metre** across the ground [derived].

| Real feature | Real size | At zoom 1 | Reads? |
|---|---|---|---|
| Steel fragment | 0.5-50 g, 4-20 mm | < 0.3 px, moving ~1 km/s | No. Show only as sparks, ground puffs and hits |
| Soil clod | 0.1-0.3 m | 1.5-4.5 px | Barely, in groups, against sky or bright ground |
| Whole brick (dominant wall debris [S11]) | 0.24 m | 3.6 px | Barely; slabs and wall chunks read |
| Fireball of a 155 | D 6-6.5 m | 90-100 px | Yes, strongly |
| Fireball of an 82 mm | D 2.4 m | 36 px | Yes |
| 10 psi radius of a 155 | 7.5 m | 110 px | Only through dust it lifts |
| 1 psi radius of a 155 | 31 m | 470 px | No (most of a 1440 px screen); only as a condensation flash in humid air, rarely |
| 155 crater | D 1.4-1.7 m | 21-26 px | Yes, as a dark scar |
| Dense dust column of a 155 | 10-30 m | 130-390 px tall | Yes, and it covers the action |

Consequences [estimate, from the table]:

- **Show the fireball and the dust; fake the shock.** The shock can only be drawn as a stylised ring or
  dust skirt. The physically placed version (to the 5 psi line, `munitions-table.md` §5) is a good anchor.
- **Fragments become sparks.** A few bright streaks for a frame or two say "steel" better than any
  attempt at real fragments.
- **Dust is the hazard to readability.** A real 155 column is taller than a two-storey house within a
  second and lingers for a minute. Physically right dust would hide the battle; that is why every game
  shortens it.

---

## 4. Craft heuristics from game VFX (not physics)

These come from practitioners. They are rules of thumb, not measurements.

- **Layers.** One published breakdown builds an explosion from 18 layers in six groups: shockwave, smoke,
  instant flash, burst ring, burst core, sparks. The shockwave fires first and also backlights the flash;
  smoke starts almost at once and lasts to the end; sparks die just after the burst ring [S30a].
- **The flash is 2-3 frames**, and layer start times are offset by only 2-3 frames; the author found that
  spacing necessary "to get the right feel" [S30a].
- **Start near full strength, peak a few frames later.** A Polycount critique notes that reference
  explosions start close to full strength on the first frame and peak about 3-5 frames later; it
  suggests the full-size shockwave last only about 4-5 frames [S30b].
- **Debris and smoke linger, but must not steal attention** from the burst [S30b].
- **The aftermath sells it.** A Real-Time VFX forum thread argues a good explosion is felt "for many
  seconds afterwards": a hot-air push on cloth and hair, blown-out windows, debris raining down, and
  secondary effects after the blast has cooled [S30c].
- **Colour is not one ramp.** The same thread suggests varying flame colour by material and using
  complementary colours to break the usual orange-to-grey [S30c]. Just Cause 4's principal VFX artist,
  Chris Judkins, is reported as saying explosion behaviour should match what is burning [S30d].
- **VFX is a visual language.** Sarah Grissom (GDC 2018) frames effects as a spectrum that tells the
  player about the setting and the game, not only "fire and explosions" [S30e]. GDC 2017's VFX Bootcamp
  covered "building more convincing explosions" and fire in motion [S30f]; Fred Hooper's Just Cause 3
  talk covers destruction and explosion effects built for player agency [S30g].
- **Read at three distances.** Zach Gage's GDC 2018 rule of thumb: a game should be easily readable at
  three different distances (the "band poster" test) [S30h]. For an RTS: full zoom-out, play zoom, and
  close zoom.

---

## 5. Where physics and craft disagree, and who wins

| Question | Physics says | Craft says | Recommendation |
|---|---|---|---|
| Shock ring speed | crosses the 5 psi radius in ~1 frame | 4-5 frames for the full ring [S30b]; GH-1197 uses 260 ms | Craft. Keep the **radius** physical and the **time** readable |
| Flash length | < 1 ms | 2-3 frames [S30a] | Agree: perception integrates it [S29] |
| Fireball size | D ≈ 3.2-3.4 W^(1/3) m [S1] | often drawn larger for impact | Physics. The real fireball already reads at 90+ px for a 155 |
| Fireball life | 0.1-0.4 s visible [S1] | similar | Agree |
| Dust life | tens of s to minutes | seconds | Craft, for readability. Leave a faint long tail if the frame budget allows |
| Crater | D ≈ 0.8 W^(1/3) m (shells close to this) [S7, S15] | often oversized so it reads | Prefer physics plus contrast (a dark rim, a scorch) over a bigger hole |
| Debris throw | bulk within ~2 crater radii, a fast few to tens of m [S16] | a showy spray | Physics already gives a good spray; keep chunks within the scorch for the bulk |
| Building collapse dust | dense for seconds to a minute; haze ~15 min [S26] | short | Craft (the shroud) is right for gameplay |
| Danger reach | fragments, tens to hundreds of m | the damage ring | The sim number wins; the drawn ring must equal it |

---

## 6. A recipe that respects both

An estimate-driven synthesis for a charge of `W` kg TNT on the ground, with times at 60 fps. **Sizes are
physics, timings are craft** [derived sizes; estimate timings].

1. **Frame 0-2 (0-33 ms): flash.** A white-hot core at about 0.3-0.5 of the fireball radius, at peak HDR,
   gone by frame 3. Optional: a one-frame refraction ring.
2. **Frame 1-6 (17-100 ms): fireball.** Grow to `r = 1.6 · W^(1/3)` m by frame 3-5 with a strong ease-out;
   yellow-orange, then darkening. 155: r ≈ 3 m (1 tile).
3. **Frame 3-30 (50-500 ms): ring and skirt.** A thin bright ring to the sim's damage reach; a faint dust
   skirt that stops at the 5 psi line, `r ≈ 5.6 · W^(1/3)` m (155: 10.6 m, 3.5 tiles).
4. **Frame 6-120 (0.1-2 s): ejecta.** Clods launched mostly steep; the bulk lands within `~1.6 · W^(1/3)` m
   (two crater radii), a fast few out to `~5-10 · W^(1/3)` m; the dense column rises to `~10 · W^(1/3)` m.
5. **0.3 s onward: smoke and dust.** Fireball soot over soil-coloured dust; fade over 5-10 s in game,
   with drift downwind at the map's wind speed.
6. **Leave behind:** a crater `D ≈ 0.8 · W^(1/3)` m, a scorch about the fireball's footprint, and
   scattered clods.

---

## Sources

- [S1] Price, M. A. (2005). LA-14209-T. https://www.osti.gov/servlets/purl/841586
- [S7] Ambrosini, Luccioni & Danesi (2004). https://amcaonline.org.ar/ojs/index.php/mc/article/download/271/260
- [S8] Goldstein (2020). LLNL-TR-815803. https://www.osti.gov/servlets/purl/1688581
- [S9] Nasstrom et al. (2011). LLNL. https://narac.llnl.gov/sites/narac/files/2024-02/LLNL-PRES-523194.pdf
- [S11] Schneider et al. (2019). *CET* 77. http://www.aidic.it/cet/19/77/037.pdf
- [S15] DIRT crater data, DTIC ADA111994 (via search). https://apps.dtic.mil/sti/tr/pdf/ADA111994.pdf
- [S16] Luther et al. (2018). EPSC2018-139. https://meetingorganizer.copernicus.org/EPSC2018/EPSC2018-139.pdf
- [S26] Collapse dust: see `physics.md` [S26].
- [S28] Goroshin et al. (2006), *PEP*, DOI 10.1002/prep.200600024 (abstract via search).
- [S29] Kalloniatis, M. & Luu, C., "Temporal Resolution", *Webvision* (Bloch's law, critical duration,
  Broca-Sulzer effect), and related results via search. https://webvision.med.utah.edu/?p=159
- [S30a] Atif (2017), "Stylized Frag Launcher Explosion (Overwatch inspiration), breakdown", Real Time VFX
  forum. https://realtimevfx.com/t/stylized-frag-launcher-explosion-overwatch-inspiration-breakdown-posted/1894?page=2
- [S30b] Polycount discussion on explosion timing (via search). https://polycount.com/discussion/comment/2530266
- [S30c] "Best resources to learn about explosion timing?", Real Time VFX forum (2026).
  https://realtimevfx.com/t/best-resources-to-learn-about-explosion-timing/30835
- [S30d] PC Gamer, "Anatomy of an explosion" (2018), Chris Judkins interview (via search summary):
  https://www.pressreader.com/usa/pc-gamer-us/20180911/281578061511390
- [S30e] Grissom, S. (GDC 2018), "Real-Time VFX: A Visual Language Spectrum". https://gdcvault.com/play/1025230/
- [S30f] GDC 2017, "Visual Effects Bootcamp: Rapid Talks". https://gdcvault.com/play/1024299/
- [S30g] Hooper, F. (GDC), "Free Reign: Building Visual Effects for Player Agency in Just Cause 3".
  https://gdcvault.com/play/1023243/Free-Reign-Building-Visual-Effects
- [S30h] Game Developer, "How to build games that can be understood at a glance" (Zach Gage, GDC 2018).
  https://gamedeveloper.com/design/video-how-to-build-games-that-can-be-understood-at-a-glance
- Game: GH-1197 design spec on `origin/docs/gh1197-explosion-design`
  (`docs/superpowers/specs/2026-11-09-explosion-scale-and-building-physics-design.md`), §5 pixel scale.
