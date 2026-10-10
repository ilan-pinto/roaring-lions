# Infantry motion references: how RTS squads look in assault

Research brief, 2026-10-05. Paraphrased from the sources listed at the end.
Every claim carries a tag: **[V]** verified in a source I read, **[V-snip]**
seen only in a search-result snippet (source page not re-fetched, treat as
likely), **[I]** inferred or estimated by me, not stated by any source.
Web research only; no video was watched, so anything about "what it looks like"
that no text source states is [I] or is listed under "Not verified".

## 1. What the genre does (summary)

Squad RTS games sell infantry realism with state changes and group behaviour,
not with fine limb motion. Company of Heroes drives each soldier from a
formation offset with small random drift, speed correction and short "leapfrog"
dashes to cover, and switches soldiers between march, dash, cautious look-around
and dive-to-prone-and-crawl depending on context [V: S1, S2, S3]. Men of War and
Gates of Hell expose the same ladder to the player as stance and movement modes
(run without stopping, short sprints with stops to fire, crawl), with every
soldier using one shared animation set [V: S4, S5]. Steel Division and CoH both
map suppression onto a visible posture change: troops go prone and stop firing
[V: S6, S7]. Close Combat is a top-down sprite game whose individuality lives in
per-soldier psychology and fatigue, not animation [V: S8]. None of the
developer-side sources I could reach describe weapon grip, recoil animation or
mocap retargeting for any of these games. That layer is unverified (section 7).

## 2. Weapon grip

- **CoH 1/2/3**: no source found on grip, cheek weld or muzzle line. CoH3's
  public art posts describe a "paper doll" mix-and-match of uniforms, gear and
  weapons for per-soldier variety, plus an intent/personality system and
  blending between animations [V-snip: S9; the post itself returned a TLS error
  when fetched, the quote appears in two press mirrors S10, S11].
- **Men of War / Gates of Hell**: one community member explains that all human
  entities share one universal animation set, and a player complains that
  soldiers carry rifles and MGs one-handed while running; a hip-carry run clip
  exists in the files but is rarely used for player units [V: S5, forum
  posts, not developer statements].
- **Broken Arrow**: reviewers/forum posters praise "weapon handling, recoil and
  transitions" and note per-soldier body-size and equipment variation within a
  squad [V-snip: S12]. Mocap use is not stated anywhere I found.
- **Steel Division, Close Combat**: nothing found. Close Combat is top-down 2D
  sprites [V: S8].
- Relic's own animators are described as combining keyframe work with mocap
  clean-up in MotionBuilder/Maya, but that is a job-listing-level statement
  about Relic generally, not about CoH infantry [V-snip: S13].

## 3. Kneel-to-fire / halt-to-fire

- **CoH (Relic preview of CoH1)**: skeletal animation is context-sensitive.
  Soldiers show a forward march, a dashing forced march, a cautious advance
  (continually looking side to side), and a dive to prone followed by a belly
  crawl [V: S3]. Suppressed squads crawl on their bellies with a reduced fire
  rate; sustained suppression for "several seconds" becomes pinned: cannot
  move or shoot, can retreat [V: S14]. No drop/rise duration in seconds is
  published in anything I read.
- **CoH2 movement fire**: patch notes (secondhand via search snippets) say all
  weapons carry a major accuracy penalty on the move, that small arms took a
  25% penalty vs sprinting targets in one patch, and that sprinting infantry
  got a 75% received-accuracy modifier in another. A designer note framed
  firing on the move as something German doctrine discouraged [V-snip: S15,
  S16]. Treat the percentages as unverified until the changelog pages are
  re-read (they returned HTTP 429 when I tried).
- **Men of War / Gates of Hell**: three player-set movement modes, in a
  third-party primer: double-time (never stops; fires on the move at spotted
  enemies only, if at all), dash (short sprints with stops to fire a few
  rounds), crawl (cautious, usually prone) [V: S4]. A GoH player notes that
  standing loses to kneeling loses to prone in a firefight, and that a normal
  move order makes soldiers stop and engage while a double-click sprints
  [V: S5].
- **Steel Division**: under stress, infantry drop prone instead of falling
  back, stop firing, and accept only retreat orders; they can surrender if
  isolated [V: S6].
- **Close Combat**: six orders (move, fire, move fast, defend, hide, smoke);
  soldiers may refuse suicidal orders and seek cover instead [V: S8, S17].
  Crawl/kneel sprite states: not verified.
- **Real world**: US doctrine's individual movement is high crawl, low crawl,
  and a 3-5 second rush from one covered position to the next, taken by fire
  team or buddy pair; the soldier's "up, seen, down" rhythm is the timing rule
  [V: S18, S19, S20]. Typical bound length "5-10 metres" [V: S21, Wikipedia].

## 4. Recoil

No source for any of the five games describes recoil animation, camera shake or
backblast treatment. What is known:

- Broken Arrow's infantry recoil is praised in player/forum text only [V-snip:
  S12].
- CoH3's "intent" and stance-change systems react to nearby enemies and
  aircraft, which is posture, not recoil [V-snip: S9, S11].
- Everything about visibility of recoil at RTS zoom is [I]. See section 6.

## 5. Squad cohesion

- **CoH (first-hand, the best source here)**: Jurney (Kaos, ex-Relic) documents
  the formation system [V: S1]. Squads split into a core and left/right flank
  elements, each with a leader; heavy weapons are placed by faction rule
  (Allies on the flanks, Axis in the core) and assignment changes are "stable"
  (minimum swaps) so nobody runs across the squad when a reinforcement arrives.
  Followers aim at an offset from the leader's predicted position about two
  seconds ahead, rotated by the leader's predicted heading. A speed modifier
  slows a follower who is ahead of his offset along the direction of travel and
  speeds him up if behind. Every soldier carries a personal random "drift"
  added to his offset so the formation does not look robotic. Followers repath
  only every half to three quarters of a second (every 4-6 ticks). Shape
  depends on terrain: wide wedge in the open, tight wedge in confined ground,
  staggered column on roads. Elements "leapfrog" out of formation to a nearby
  point of interest or cover, hold, and rejoin; a "soft" leapfrog veers about
  80% toward the cover point without stopping (used when hurrying or
  retreating); a virtual leader keeps the rest on the original path meanwhile.
  At the destination each soldier reserves his own spot, and searches nearby
  for cover relative to the facing, which is the settle-into-cover step.
- **CoH cover**: green (heavy), yellow (light), red (worse than none); most
  heavy cover is directional [V: S14]. Units run and crouch between cover
  points automatically [V-snip: S22].
- **Men of War**: squad stances are a shared player setting; the "firers vs
  movers" 2:1 split is a player tactic, not an engine behaviour [V: S4].
- **Steel Division, Broken Arrow, Close Combat**: formation shape and spacing
  not found. Broken Arrow forum chatter wishes for more movement variety and
  less synchronised motion [V-snip: S12].
- **Real world**: fire-team wedge with a 10 m interval between soldiers,
  squad column of wedges [V: S19]. Movement techniques are distances that vary
  by contact likelihood: traveling, traveling overwatch (lead team ideally 50 m
  ahead), bounding overwatch (one element moves while another covers, never
  beyond the range the base of fire can suppress) [V: S20].

## 6. Numbers worth stealing

| Number | What | Source / basis |
|---|---|---|
| ~2 s | Look-ahead on the leader's path used to place followers | S1, verified |
| 0.5-0.75 s (4-6 ticks) | Follower repath/goal refresh cadence | S1, verified |
| 80% | Pull toward cover in a "soft" leapfrog (veer, no stop) | S1, verified |
| 10 m (3.3 tiles at 3 m/tile) | Wedge interval, fire team | S19, verified; tile conversion mine |
| 5-10 m (1.7-3.3 tiles) | One bound/rush length | S21 verified |
| 3-5 s | Rush exposure: up, seen, down | S18, S20, verified |
| 50 m | Lead team ahead in traveling overwatch (not a visual number) | S20, verified |
| several seconds | Suppressed -> pinned onset in CoH | S14 verified (no exact value) |
| 25% / 75% | CoH2 accuracy modifiers vs sprinters | S15/S16, snippet only |
| 2 s | CoH2 LMG setup time | S16-adjacent snippet only |
| 0.15-0.4 s drop-to-kneel | Plausible stance-change duration | ESTIMATED, no source |
| 0.5-1.0 s drop-to-prone | Plausible dive duration | ESTIMATED, no source |
| 0-0.4 s per-figure start offset | Phase offset to break lockstep | ESTIMATED, no source |
| 8-12% | Per-figure speed variance | ESTIMATED, no source |

## 7. What this means for a 25 px figure

All items are [I] unless a tag says otherwise.

1. **Posture is the readable verb, not recoil.** A 25 px figure has a rifle of
   perhaps 6-8 px; a 1-2 px barrel kick is invisible. Stand, kneel, prone and
   crawl differ in silhouette height (roughly 25 / 17 / 7 px) and are the
   things players in these games react to (S4, S5, S6, S14).
2. **Sell the shot with light and VFX, not limbs.** Muzzle flash, a short
   tracer, a single-frame brightness pop and ground dust read at this size.
   For launchers a backblast puff behind the figure reads; shoulder jolt does
   not. For MGs, a sustained flash cadence reads as "bipod, braced" and the
   figure staying still is part of the cue.
3. **Make each figure drop at a slightly different moment.** CoH's own fix for
   robotic squads is per-soldier drift and speed correction, not authored
   variety (S1). Cheap equivalents: per-figure phase offset and a few percent
   speed variance, both invisible to the sim.
4. **Stop-to-fire needs a hard pose change, 0.2-0.5 s, with the muzzle line
   already up.** The Men of War "dash, stop, fire, dash" cadence (S4) is legible
   precisely because the stop is unmistakable.
5. **Use asymmetric timing: drop fast, rise slow.** It matches "up, seen,
   down" (S18) and gives a bound a visible beat; a symmetric tween looks like
   a bob.
6. **Leapfrog is the cheapest "tactical" read.** One figure of a team veering
   toward the nearest cover and pausing (S1's soft leapfrog) is more
   convincing than every figure running in step; at 3-4 m apart (1 tile) the
   team still reads as one unit.
7. **Spacing: compress the doctrine, keep the shape.** The doctrinal 10 m is
   3.3 tiles, which at this zoom reads as separate units. In this game one
   team is one sim unit on one 3 m tile and neighbouring units stand a tile
   apart, so a team's figures have to fit inside about 2.5 m: roughly 1.1-1.4 m
   between figures. Keep a wedge or staggered column rather than a line, and
   switch to a column when the path narrows (S1). (Corrected by the motion
   checkpoint, 5 Oct: an earlier draft said 1.0-1.5 tiles between figures,
   which would overlap the neighbouring unit.)
8. **Grip detail is a zoomed-in and screenshot concern, and still worth
   getting right.** Cheek weld and rear-hand position are hard to tell apart at
   25 px, but the lead reviews at close zoom (up to about 62 px a figure), where
   a rifle fired from the hip with the support hand off the weapon reads as
   wrong. What survives at every zoom: the weapon axis pointing at the target
   (not hanging or canted across the body), the weapon at head height rather
   than belt height, and a different silhouette for MG, launcher and rifle.
   Suppressed troops being prone is the biggest free cue (S6, S14).

## 8. Not verified

- Any developer statement on grip, cheek weld or muzzle-line rules, in any game.
- Mocap versus keyframe for CoH, Men of War, Gates of Hell, Steel Division,
  Close Combat or Broken Arrow, and any retargeting method.
- Recoil visibility, camera shake, backblast handling, MG bipod animation.
- Drop/rise durations in seconds for any game.
- Formation spacing in metres for any game (CoH's Jurney article gives no
  offsets); Steel Division, Gates of Hell, Broken Arrow formations.
- Close Combat crawl/kneel/run sprite states and speeds.
- Steel Division 1/2 infantry model counts per team beyond "small 3D groups".
- CoH3 Art Vision post text (fetch failed; only press mirrors read).
- CoH2 accuracy percentages and LMG setup time (search snippets only).
- Standing-to-kneeling transition time in US doctrine.

## Sources

- S1 Jurney, "Company of Heroes Squad Formations Explained", AI Game Programming
  Wisdom 4. Read from a Safari Books copy of the article; a PDF is reachable at
  https://forum.arongranberg.com/uploads/short-url/rWod3K2KhNWcOEdjewnsLXQKU6A.pdf
  (found via search, not opened by me).
- S2 https://www.shacknews.com/article/37028/company-of-heroes-preview
- S3 same as S2 (CoH1 preview, animation context).
- S4 https://armchairgeneral.com/theatre-of-war-pt2-assault-tactics-primer.htm/2
- S5 https://steamcommunity.com/app/400750/discussions/0/4210371088510097638 and
  https://steamcommunity.com/app/400750/discussions/0/3073118388427916639
- S6 https://pcgamesn.com/steel-division-normandy-44-stress-mechanic-suppression
- S7 https://www.coh2.org/guides/5732/company-of-heroes-2-basic-concepts-and-glossary
- S8 https://en.wikipedia.org/wiki/Close_Combat_(video_game)
- S9 https://community.companyofheroes.com/coh-franchise-home/company-of-heroes-3/forums/1-general-discussion/threads/1578-company-of-heroes-3-%E2%80%93-art-vision-%E2%80%93-living-battlefield (fetch failed)
- S10 https://gamedeveloper.com/press-release/company-of-heroes-3-art-authenticity
- S11 https://www.thesixthaxis.com/2022/04/22/company-of-heroes-3-dev-diary-trailer-art-and-authenticity/
- S12 https://forum.slitherine.com/viewtopic.php?p=1059010
- S13 https://zerply.com/industry-jobs/Senior-Animator-Relic-Entertainment-Vancouver-29Fe4np8
- S14 https://www.coh2.org/guides/5732/company-of-heroes-2-basic-concepts-and-glossary
- S15 https://steamcommunity.com/sharedfiles/filedetails/changelog/1170363977?p=4
- S16 https://steamcommunity.com/sharedfiles/filedetails/changelog/341279469?p=10
- S17 https://nodicenoglory.com/25-year-retrospective-of-the-close-combat-series-part-one/
- S18 https://www.dvidshub.net/news/printable/198409
- S19 https://atu.edu/rotc/docs/2_LDAC10_Maneuver_Handbook_26_May_10.pdf
  (Warrior Forge 2010 squad handbook; fire team wedge diagram, 10 m)
- S20 https://boisestate.edu/sps-militaryscience/wp-content/uploads/sites/123/2014/04/MovementFormations.pgs3_.12to3.27.pdf
  (FM 3-21.8, 2007, ch. 3: movement techniques, 50 m, 3-5 s rushes)
- S21 https://en.wikipedia.org/wiki/Individual_movement_techniques
- S22 https://gamingnexus.com/Article/1235/Company-of-Heroes
