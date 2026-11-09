# Best practice from leading strategy games

Part 5 of the Roaring Lions RTS art research (2026-11-09), added at the lead's request ("learn best
practice from leading RTS games"). For each game, it gives what the game did best across eight
dimensions. It then ranks principles from all the games and says how each applies to Roaring
Lions' dimetric three.js/WebGPU renderer.

**Principles only.** Nothing here describes how to copy any game's assets, names, characters,
logos or specific looks.

**Evidence quality, stated up front.** About 100 web calls went into this file and its sister
files. Primary technical sources are strong for StarCraft II (a SIGGRAPH course paper) and Company
of Heroes 2 (Relic conference slides). Art-direction sources for the other games are developer
interviews and press. For C&C 3 / Red Alert 3, Warcraft III Reforged, Supreme Commander, WARNO and
Northgard the record is thin, and many publisher pages refused or truncated the fetch. Where a
dimension has no sourced claim, the entry says so instead of inventing one. Markers: **(snippet)**
means the claim was seen only in a search summary, **(opinion)** means player or forum opinion,
and **(inference)** means my own reading. `[S#]` refers to the Sources list.

## Contents

1. [Command & Conquer 3 / Red Alert 3](#1-command--conquer-3--red-alert-3)
2. [StarCraft II](#2-starcraft-ii)
3. [Company of Heroes 2](#3-company-of-heroes-2)
4. [Company of Heroes 3](#4-company-of-heroes-3)
5. [Age of Empires IV](#5-age-of-empires-iv)
6. [Warcraft III Reforged](#6-warcraft-iii-reforged)
7. [Supreme Commander](#7-supreme-commander)
8. [Iron Harvest](#8-iron-harvest)
9. [WARNO and Steel Division 2](#9-warno-and-steel-division-2)
10. [Total War](#10-total-war)
11. [Northgard](#11-northgard)
12. [Dawn of War I-III](#12-dawn-of-war-i-iii)
13. [Ranked principles and how they apply to Roaring Lions](#13-ranked-principles-and-how-they-apply-to-roaring-lions)
14. [Sources](#sources)

---

## 1. Command & Conquer 3 / Red Alert 3

- **Art direction.** C&C 3's designers framed one faction as style-forward and the other as
  heavily armoured: faction identity by silhouette and material [S1] (snippet). Red Alert 3's
  producer said the team would play up the silliness of faction design wherever possible: a
  deliberate, consistent tone per faction [S2] (snippet).
- **Technique.** Red Alert 3 ran on SAGE 2.0, a heavily overhauled version of the earlier engine
  [S3] (snippet).
- **Materials and lighting; effects; unit feedback; camera; terrain; UI.** I found no sourced
  claim. Team colour and the voiced announcer are widely remembered but were not sourced in this
  session.
- **Principle.** Give each faction one material and shape vocabulary and hold it across every unit.

## 2. StarCraft II

- **Art direction.** Silhouettes were designed for the fixed top-down three-quarter camera.
  Large forms are favoured over fine mechanical detail, and characters are "a little bit bigger
  and over-proportioned" [S4]. Early builds' heavy team colour read as over-saturated, and passes
  balanced it against brightness [S5] (secondhand).
- **Materials and lighting.** A deferred buffer (depth, normals, unlit diffuse and specular,
  an AO term) let many local lights touch many units without the batch count exploding. The stress
  case was a squad in which every soldier casts a flickering light. The global directional light
  stays forward-rendered, because deferring it would be slower. HDR uses 16-bit float buffers [S6].
- **Effects.** Translucent shadows: a second shadow map plus a colour buffer lets a transparency
  tint the light that passes through it [S6].
- **Unit feedback.** Not covered by the sources found.
- **Camera and zoom.** "Split personality": the game camera is far away with high batch counts
  and a focus on action, while story mode is close-up and cinematic. Depth of field was built
  for story mode, not for play [S6].
- **Terrain.** The deeply layered terrain was part of the batch problem that pushed the engine to
  deferred buffers [S6].
- **UI and world.** Not covered by the sources found.
- **Technique.** Conservative vertex counts, with quality pushed into the pixel shader. Fixed-cost
  post effects (SSAO, depth of field) cost the same at 5 or 500 units. SSAO uses a depth- and
  normal-aware blur so occlusion does not bleed between objects. Baked AO is ignored when SSAO is
  on [S6]. Scalability across PC specs was a design goal in its own right [S7].

## 3. Company of Heroes 2

- **Art direction.** Not covered directly by the sources found.
- **Materials and lighting.** The move from a forward to a deferred renderer bought many dynamic
  lights and fewer shader permutations. It cost harder transparency and anti-aliasing, and worse
  performance on old hardware. Blob-like splat AO was replaced by GPU ray casting against a
  top-down height map, precomputed for static objects [S8].
- **Effects and weather.** Snow lands procedurally on upward-facing surfaces, and a top-down
  "snow shadow" depth map keeps it off sheltered ones. "Virtual extrusion" fakes snow depth
  without geometry. Effects draw at half resolution and composite, cutting the worst-case frame
  loss from about 30% to under 4% [S8].
- **Unit feedback.** Foot and vehicle tracks are drawn into a top-down map and clipped at snow
  height, with mud showing inside them. Objects take the terrain's snow, and damage removes it
  from both [S8]. Fresh tracks let a player spot enemy infantry and warn of heavy vehicles [S9].
- **Camera.** Not covered directly by the sources found.
- **Terrain.** Artists paint a snow layer that drives terrain height. Ice uses a simulated
  health-cell map to blend solid, broken, slush and water, with noise hiding the grid [S8].
- **UI and world.** True line of sight: unseen areas are darkened, and objects that block sight
  in the world also block the troops' sight, which "makes reconnaissance much more important" [S9].
- **Technique.** The track system's own listed costs were high texel density, trouble with
  persistence across multiple GPUs, and a need for high frame rates [S8].

## 4. Company of Heroes 3

- **Art direction.** Units are built from light and dark elements so they stand out on varied
  terrain. More noise marks concealed, hard ground; less noise and contrast marks clear paths
  [S10] (summary of the art director's post, snippet). The alpha was criticised because cover and
  open ground could share a value, and lighting made units hard to tell apart [S10] (opinion).
- **Materials.** Wear is no longer baked in. Grime builds up from the terrain a vehicle crosses,
  and damage appears where the vehicle was hit. A modular "paper doll" builds outfits and tanks
  from parts, for subtle variation [S11].
- **Effects and destruction.** Earlier titles faked falling building pieces with
  camera-dependent effects and made bullet holes with transparent wall sections. The third uses
  multi-layer walls, physics debris and progressive collapse from limited structural strength,
  and the debris can kill soldiers [S12].
- **Unit feedback.** Units react to events such as aircraft overhead, and their stance grows
  tenser [S11].
- **Camera, terrain, UI, technique.** Not covered by the sources found beyond the above.

## 5. Age of Empires IV

- **Art direction.** "Readability and playability are top on our list": bigger weapons, colours
  that stand out from the environment, and a consistent footprint per civilisation and building
  function [S13]. Team accents come from the series' earlier palette, not the whole environment.
  Small units lost detail for legibility at distance, and the detail went into buildings.
  Painterly textures keep the frame clean from low-end 1080p to 4K [S14].
- **Reception.** Some players found it too colourful and cartoonish [S13]. One forum argument
  is that distinct silhouettes, not bigger weapons, drive readability [S15] (opinion).
- **Camera.** Players report that the maximum zoom-out was raised after beta but still felt close
  to the ground [S16] (opinion, snippet).
- **Materials, effects, unit feedback, terrain, UI, technique.** Not covered by the sources found.

## 6. Warcraft III Reforged

- **Art direction.** A mount was made more prominent "to keep it unambiguous on a chaotic
  battlefield" [S17]. A post-launch patch made a team-colour polish pass on melee units and
  buildings for vibrancy and readability [S18] (snippet).
- **Reception.** Many players found the new models harder to identify at a glance than the
  originals [S19] (opinion).
- **Technique.** A hero model went from about 700 polygons to about 15,000 [S17]. The original
  game capped the lights per unit, which caused light popping; StarCraft II's deferred lights fixed
  that [S6].
- **Effects, unit feedback, camera, terrain, UI.** Not covered by the sources found.
- **Principle.** Fidelity without a readability pass can make units harder to identify.

## 7. Supreme Commander

- **Camera and zoom.** Strategic zoom was the key design element: zooming in and out on large maps
  made more real strategy possible [S20] (snippet). At full zoom, units become icons, like an
  enlarged minimap [S21] (snippet). It works by LOD swapping, with assets replaced by lower
  resolutions until they become dots. A developer said the engine was designed for this from the
  start [S22].
- **UI and world.** A player can command from the zoomed-out view without needing a minimap [S22].
- **Technique.** A contemporary review credits aggressive line-of-sight culling and LOD, plus
  simulated projectiles [S23] (snippet).
- **Art, materials, effects, terrain.** Not covered by the sources found.

## 8. Iron Harvest

- **Art direction.** The look comes from one painter's established universe, and that artist
  designed the machines and characters and stayed in production [S24], [S25]. Factions differ by
  role and silhouette weight: light, cheap hit-and-run machines against tough, expensive,
  specialised ones [S24].
- **Materials and lighting.** The team tested its assets inside a Unity lighting showcase to see
  them under the newer engine's lighting [S26]. A benchmark review found night missions
  noticeably drabber than day ones [S27].
- **Effects and destruction.** Environments are fully destructible, so "cover can be blown apart",
  and late in a match the map looks very different from the start [S24]. Each destruction type
  needs its own asset preparation, and a producer tracks every destructible object [S26].
- **Unit feedback.** Weight is sold through the rig. The rigs had to handle turret weapons,
  garrisons, firing on the move and two-, four- and eight-legged machines [S26].
- **Camera.** Cutscene models look stiff but are "barely noticeable" from the gameplay view [S27].
- **Technique.** Debris, effects and ragdolls are pooled [S26]. Of the AA modes, FXAA blurs,
  SMAA leaves vegetation shimmering, and TAA is best but soft [S27].
- **Terrain and UI.** Not covered beyond the above.

## 9. WARNO and Steel Division 2

- **Camera and zoom.** The engine (IRISZOOM) zooms from the ground to a strategic map [S28].
  WARNO zooms anywhere on the map, from "blades of grass and individual trees" up to broad
  planning, and a double-click locks the camera to a unit [S29]. The zoom can overshoot in heavy
  fighting [S29].
- **Effects.** Dust trails behind vehicles, smoke marks destroyed units, terrain burns and craters,
  and mortar arcs, tracers and missile smoke are all visible [S29].
- **Unit feedback and UI.** A suppression meter sits above each unit's label under fire [S30]
  (snippet). The attack overlay shows line of sight, range, weapon and hit chance [S29]. Enemy
  markers under fog of war flash and vanish [S29]. Players asked for a way to hide icons up close
  [S31] and for icons as simple silhouettes with no background plate [S30] (opinion).
- **Terrain.** Handcrafted maps where units use forests for cover and roads for movement [S29].
- **Art, materials, technique.** No Eugen art or technique write-up was reachable.

## 10. Total War

- **Art direction.** For the fantasy series the tabletop miniatures were the style guide [S32].
  The second game chose more colour on purpose and gave each race a visual personality [S33].
  Dramatic static poses had to be reworked so the models could animate without clipping [S32].
- **Lighting.** Night battles in Three Kingdoms use a dark blue tone that is not gritty.
  Lanterns and fires add contrast and keep night battles "super clear and visible" [S34].
- **Unit feedback.** Animation sets are culled so units do not look wrong, for example when
  fighting on a wall [S35]. Natural motion is borrowed, such as a bat's elbow for a flying
  creature's walk [S32].
- **Camera and map art.** On the campaign map, detail layers in as the camera closes. At a
  distance objects are tuned "to limit visual noise", with fog and depth of field for subtle blur
  [S34].
- **UI.** Three Kingdoms replaced wooden, skeuomorphic panels with a minimalist UI built on ink
  and ink-dipped paper, with painterly illustrations [S34].
- **Technique.** Thousands of units are handled with unit LODs and multicore work. One of the
  hardest problems is the gap between what the player sees and what the engine renders: a wrinkle
  "barely discernible" from the high camera can block a soldier's view [S35].
- **Effects.** Not covered by the sources found.

## 11. Northgard

- **Art direction.** Colourful and slightly cartoony [S36] (pre-release preview), with units
  "clear and easy to spot on the backdrop" [S37] (snippet). The studio's later strategy game set
  its art between tiny realistic units and big-unit caricature, and was deliberately more
  colourful than the genre [S38].
- **Effects and weather.** Seasons change both the look and the rules: winter cuts food and
  raises wood consumption [S39]. A snow map came later [S40].
- **Camera.** Zoomed in closer than a grand-strategy map [S39].
- **UI.** "Easy controls and a simple UI", with micromanagement kept low to protect the
  atmosphere [S41].
- **Materials, unit feedback, terrain technique.** Not covered by the sources found.

## 12. Dawn of War I-III

- **Art direction.** In the third game the camera moved further out, so "the units need to pop
  out from the background art". Close-up mud and grime from the second game "can turn into noise
  pretty quickly" from a high angle. Bright armour was compared to painted tabletop miniatures
  [S42]. Fans criticised the result as too colourful for the setting [S43] (snippet), and
  reviewers praised its clarity in battle [S44].
- **Materials and lighting.** The second game's engine was an update of Company of Heroes',
  adding HDR, real-time lighting and destructible scenery [S45], [S46] (snippet).
- **Effects and destruction.** In the second game explosives destroy cover, and units under fire
  seek cover by themselves [S45]. Reviewers called the third game's destruction satisfying [S44].
- **Unit feedback.** Melee finishers (sync-kills) were a signature of the second game. The third
  dropped them, and playtesters of a later entry reportedly asked for longer battles to watch them
  [S47] (snippet).
- **UI.** A reviewer wanted clearer notifications when outposts or units were attacked [S44].
- **Terrain.** Maps meant to be eye-catching spaces that support the fight rather than compete
  with it [S48] (a writer's summary).

---

## 13. Ranked principles and how they apply to Roaring Lions

Ranked by how much they would move Roaring Lions' look and play for the effort, given its
dimetric camera, realism-leaning tone, lit three.js renderer and WebGPU work in progress.
"Proven by" names the games above. The application is my own reading against the project's rules:
presentation only, palette keys, the lead approves art numbers before any render, and every change
passes the visual gate.

### P1. Silhouette and value first, for the camera you actually ship

**Proven by:** StarCraft II, AoE IV, Dawn of War III, Warcraft III Reforged (the cautionary case).

**Roaring Lions.** This is already gated through IoU at 64 px. Add a **value** gate: the
linear-luminance step between a unit's lit top and the ground under it, measured from a capture
at default zoom on each theme. Today's palette makes this a real risk: `olive.1` sits at 0.163
linear luminance against scrub at 0.218 and dust ramps at 0.13-0.52 (`game-mapping.md`).

### P2. The ground serves the units: lower contrast, lower chroma, meaningful noise

**Proven by:** Dawn of War III, CoH3, Total War (noise tuned by distance).

**Roaring Lions.** Keep ground chroma under the team colours, and keep detail frequency away from
unit scale. Consider tying noise to cover tiles, as CoH3 does, but only through palette keys and
the existing control map.

### P3. What the player sees must equal what the sim does

**Proven by:** CoH2 (sight blockers), Total War (the terrain wrinkle), Dawn of War II (destructible
cover).

**Roaring Lions.** This is the project's invariant 4 seen from the art side. Elevation, cover and
smoke visuals must stay derived from the sim's grid. The relief read and crowns already do this
(`terrain-rendering.md`). Any new terrain art (height blending, displacement) must not invent
relief the sim does not have.

### P4. Team colour is a tuned budget on top surfaces, backed by non-diegetic channels

**Proven by:** StarCraft II, Warcraft III Reforged, AoE IV.

**Roaring Lions.** The L3 team mark (about 2% of the Lavi, roof plus turret flanks) fits this
exactly. Roll it out to every vehicle, and find a one-element equivalent for infantry, such as a
helmet band or pack. Gate team colour against the final output transform and every grade.

### P5. The ground records the battle

**Proven by:** CoH2 (tracks), CoH3 (grime from terrain), Iron Harvest and WARNO (craters, rubble,
burning ground).

**Roaring Lions.** It already has a decal pool aged on the sim clock, craters with rims, and
wrecks. The gaps are vehicle tracks and ruts, and dust or mud accumulating on hulls by theme. Both
are presentation-only and can read sim positions without writing back.

### P6. Brightness and saturated hue are reserved for effects and threats

**Proven by:** StarCraft II (HDR), CoH2 (half-resolution effects), WARNO (tracers, smoke as
information).

**Roaring Lions.** This is already the rule: bloom above 1.0 only, one HDR gains table, and a
reserved VFX band. Keep it as the bar for every new effect, including GPU compute particles.

### P7. Zoom is a design axis with an icon handoff

**Proven by:** Supreme Commander, WARNO, Total War (detail by distance).

**Roaring Lions.** Zoom is bounded, and overlays scale with it by design. If a strategic zoom is
ever added, plan icons, LOD and impostors together, and fade world overlays as icons take over.
Do not retrofit it piecemeal.

### P8. Grime and damage grow from play, not from baked textures

**Proven by:** CoH3, CoH2.

**Roaring Lions.** Meshy bakes arrive with wear in the albedo. Prefer de-lit, clean base colour
plus runtime dust by theme and by the damage state the sim already reports. Mind the textured
exemptions, the texture budgets and the lead's approval.

### P9. Weight and believable motion sell scale

**Proven by:** Iron Harvest, Total War.

**Roaring Lions.** Vehicle weight, conform and running gear have shipped. The infantry motion
standard (shoulder grip, recoil, kneel to fire, squad wedge) is the matching bar for figures.

### P10. Lighting that is legible at every time of day

**Proven by:** Total War: Three Kingdoms (clear night battles), Iron Harvest (night maps read
drab).

**Roaring Lions.** Dawn and dusk grades exist, and night resolves to dusk. A future night preset
needs local light sources and unit readability held at the same value gate as day, not just a
darker frame.

### P11. Effects cost is capped, not proportional to the fight

**Proven by:** StarCraft II (fixed-cost post effects), CoH2 (half-resolution effects).

**Roaring Lions.** It already runs bloom at quarter resolution and GTAO at half. The same
discipline applies to any new compute particle system: a fixed pool and a known worst-case
millisecond cost.

### P12. A UI that shares the world's material language, and stays out of the way

**Proven by:** Total War: Three Kingdoms, Northgard, WARNO (clutter complaints).

**Roaring Lions.** The shell already has its own token theme. The world-side rule is fewer
in-world marks (the lead's standing ruling) and clear off-screen attack notices.

---

## Sources

- [S1] GameSpot, C&C 3 designer diary 4 (snippet) — https://www.gamespot.com/articles/command-and-conquer-3-tiberium-wars-designer-diary-4-comparing-the-gdi-and-nod-factions/1100-6163297
- [S2] Digital Chumps, Red Alert 3 interview (snippet) — https://digitalchumps.com/2008/07/19/exclusive-interview-command-and-conquer-red-alert-3/2
- [S3] Wikipedia, Command & Conquer: Red Alert 3 (snippet) — https://en.wikipedia.org/wiki/Command_%26_Conquer:_Red_Alert_3
- [S4] Eurogamer interview with Samwise Didier (repost) — https://www.blizzplanet.com/blog/comments/eurogamer_interviews_samwise_didier
- [S5] GosuGamers, StarCraft II graphic change — https://www.gosugamers.net/news/7571-graphic-change-in-the-works-for-starcraft-ii
- [S6] Filion and McNaughton, "StarCraft II: Effects & Techniques", SIGGRAPH 2008 — https://www.advances.realtimerendering.com/s2008/SIGGRAPH2008%20-%20StarCraftII.pdf
- [S7] Filion, GDC 2010, Designing for performance, scalability and reliability — https://gdcvault.com/play/1012369/Designing-for-Performance-Scalability-Reliability
- [S8] Daniel Barrero, CoH2 rendering technology (KGC 2013) — https://www.slideshare.net/proyZ/daniel-barrero-coh2renderingtech
- [S9] Engadget, CoH2 preview — https://www.engadget.com/2013-06-24-keeping-your-eyes-open-in-the-cold-of-company-of-heroes-2.html
- [S10] CoH3 art vision forum thread (snippet) — https://community.companyofheroes.com/coh-franchise-home/company-of-heroes-3/forums/1-general-discussion/threads/1551-company-of-heroes-3-art-vision-life-at-war-and-cinematic-realism
- [S11] TheSixthAxis, CoH3 art and authenticity dev diary — https://www.thesixthaxis.com/2022/04/22/company-of-heroes-3-dev-diary-trailer-art-and-authenticity/
- [S12] GamePressure, CoH3 destruction — https://www.gamepressure.com/newsroom/company-of-heroes-3-videos-show-impressive-environmental-destruct/ze3ef0
- [S13] GamePressure, AoE IV visuals and the developers' response — https://www.gamepressure.com/newsroom/age-of-empires-4-takes-flak-for-visuals-devs-respond/z13167
- [S14] MobileSyrup, AoE IV Relic interview — https://mobilesyrup.com/2021/04/10/age-of-empires-iv-relic-developer-interview/
- [S15] AoE forums, unit appearance (opinion) — https://forums.ageofempires.com/t/aoe4-units-appereance-coolness-and-colorful-pyjamas/237243
- [S16] AoE forums, graphics thread (opinion, snippet) — https://forums.ageofempires.com/t/the-curious-case-of-aoe-4-graphics-lots-of-screenshots/211488.md?page=30
- [S17] Blizzard, "Tales from the Smithy: Reforging the Humans" — https://news.blizzard.com/en-us/article/23150108/tales-from-the-smithy-reforging-the-humans
- [S18] Destructoid, Reforged patch (snippet) — https://www.destructoid.com/warcraft-iii-reforged-gets-another-patch-to-smooth-over-its-sins-from-launch/
- [S19] Blizzard forums, Reforged graphics feedback (opinion) — https://us.forums.blizzard.com/en/warcraft3/t/feedback-graphics-dont-feel-like-warcraft-iii/275
- [S20] MCV, Q&A with Chris Taylor (snippet) — https://www.mcvuk.com/development-news/qa-chris-taylor-talks-strategy/
- [S21] Edge via PressReader (snippet) — https://www.pressreader.com/australia/edge/20170105/282656097111257
- [S22] Matchstick Eyes, RTS zoom — https://www.matchstickeyes.com/tag/rts-zoom/
- [S23] Cornell Sun, Supreme Commander technical review (snippet) — https://cornellsun.com/2007/05/05/supreme-commander-technical-review/
- [S24] Shacknews, Iron Harvest interview — https://www.shacknews.com/article/120167/iron-harvest-interview-combining-history-with-science-fiction
- [S25] GamingBolt, Iron Harvest interview — https://gamingbolt.com/iron-harvest-1920-interview-tactical-strategy-chronicles
- [S26] KING Art devblog — https://kingart-games.com/article/49
- [S27] ComputerBase, Iron Harvest benchmark — https://www.computerbase.de/2020-09/iron-harvest-benchmark-test/
- [S28] Wikipedia, WARNO — https://en.wikipedia.org/wiki/Warno_(video_game)
- [S29] SUPERJUMP, WARNO early-access impressions — https://www.superjumpmagazine.com/warno-early-access-impressions/
- [S30] Paradox forum, Steel Division 2 accessibility and unit icons (opinion; manual detail via snippet) — https://forum.paradoxplaza.com/forum/threads/steel-division-2-accessibility-and-unit-icon-improvements.1112677/
- [S31] Steam Workshop comments, WARNO (opinion) — https://steamcommunity.com/sharedfiles/filedetails/comments/3387658237
- [S32] MCV, Total War: Warhammer interview — https://mcvuk.com/development-news/total-war-warhammer-interview-can-things-ever-be-too-spiky/
- [S33] Wccftech, Total War: Warhammer II interview — https://wccftech.com/total-war-warhammer-ii-interview/2/
- [S34] GamesBeat, Total War: Three Kingdoms art — https://gamesbeat.com/how-creative-assembly-conceived-the-art-for-total-war-three-kingdoms/
- [S35] Game Developer, Total War: Warhammer II for massive battles — https://gamedeveloper.com/design/designing-i-total-war-warhammer-ii-i-to-handle-tons-of-units-and-massive-battles
- [S36] GameGrin, Northgard Gamescom preview — https://www.gamegrin.com/previews/northgard-gamescom-preview/
- [S37] Checkpoint Gaming, Northgard review (snippet) — https://checkpointgaming.net/reviews/2018/03/northgard-review/
- [S38] Worthplaying, Dune: Spice Wars art director interview — https://worthplaying.com/article/2022/4/13/news/131491-dune-spice-wars-developer-interview-with-art-director-jeremy-vitry
- [S39] Wccftech, Northgard impressions — https://wccftech.com/northgard-impressions-the-viking-rts-weve-been-looking-for/
- [S40] Gamespace, Northgard Winter Festival update — https://gamespace.com/all-articles/news/northgard-gets-a-little-bit-chillier-with-the-winter-festival-update/
- [S41] Game Developer, Northgard's multiple victory states — https://gamedeveloper.com/design/crafting-the-multiple-victory-states-of-the-rts-i-northgard-i-
- [S42] GameGrin, Dawn of War III interview — https://www.gamegrin.com/articles/warhammer-40000-dawn-of-war-iii-interview/?os=30
- [S43] KitGuru (snippet) — https://www.kitguru.net/?p=295976
- [S44] GamingTrend, Dawn of War III review — https://gamingtrend.com/reviews/beautiful-but-bittersweet-dawn-of-war-iii-review/
- [S45] Wikipedia, Dawn of War II — https://en.wikipedia.org/wiki/Warhammer_40,000:_Dawn_of_War_II
- [S46] GamesRadar, Dawn of War II (snippet) — https://gamesradar.com/warhammer-40000-dawn-of-war-2-10
- [S47] FRVR, Dawn of War 4 playtesters and sync-kills (snippet) — https://frvr.com/blog/warhammer-40000-dawn-of-war-4-devs-say-playtesters-begged-for-longer-battles-to-gawk-at-the-games-sync-kill-animations
- [S48] Wccftech, Dawn of War III environment showcase — https://wccftech.com/dawn-war-iii-environment-showcase-video/amp/
