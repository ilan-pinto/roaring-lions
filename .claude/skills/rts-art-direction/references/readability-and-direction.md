# RTS readability and art direction: principles

Part 1 of the Roaring Lions RTS art research (2026-11-09). This file covers the genre's
readability principles. The per-game study is `leading-rts-best-practices.md`. Materials and
lighting are in `materials-and-lighting.md`, techniques in `webgpu-and-blender.md`, and the
comparison with the shipped game in `game-mapping.md`.

Everything here is a **principle**. Nothing describes how to reproduce any franchise's assets,
characters, logos or looks; Roaring Lions' art stays original.

**Notation.** `[S#]` points to the Sources list at the end. **(est.)** marks an estimate or a rule
of thumb with no measured origin. **(inference)** marks my own reasoning from the sources, not
something a source says. **(snippet)** marks a source seen only as a search-result summary.

## Contents

1. [The reading order: shape, value, hue, motion, detail](#1-the-reading-order-shape-value-hue-motion-detail)
2. [Silhouette and value at 30-80 px](#2-silhouette-and-value-at-30-80-px)
3. [The squint test, and its stricter variants](#3-the-squint-test-and-its-stricter-variants)
4. [Exaggerated proportions](#4-exaggerated-proportions)
5. [Team colour: how much and where](#5-team-colour-how-much-and-where)
6. [The ground stays quieter than the units](#6-the-ground-stays-quieter-than-the-units)
7. [The effects hierarchy](#7-the-effects-hierarchy)
8. [UI versus world](#8-ui-versus-world)
9. [Lessons by game, as principles](#9-lessons-by-game-as-principles)
10. [Sources](#sources)

---

## 1. The reading order: shape, value, hue, motion, detail

At RTS distance a player identifies a unit from its outline first, then its tone band (light or
dark against the ground), then its colour, then its motion. Surface detail comes last, and is often
not read at all.

- Silhouette is the first thing a player registers, ahead of colour or interior detail. A state
  change such as "charging" should change the outline, not only flash a colour [S1].
- If a character reads only through colour or texture, its shape is too weak. Check it in
  greyscale [S2].
- StarCraft II's art director describes designing silhouettes for the fixed top-down camera. Large
  forms win over fine mechanical detail, and units are "a little bit bigger and over-proportioned"
  so they read at gameplay distance [S3].
- StarCraft II's engineers state the same budget from the other side. Units are "generally viewed
  from a good distance away", so vertex counts stay conservative and the quality goes into
  pixel-shader effects [S4].
- Relic's AoE IV art lead: readability and playability come first. That means bigger weapons,
  colours that stand out from the environment, and a consistent footprint per function [S5].
  Detail was cut on small units and spent on buildings [S6].

**Rule for agents.** Do not spend effort on a detail layer until the silhouette and value pass at
game zoom.

## 2. Silhouette and value at 30-80 px

**The working sizes.** In Roaring Lions a soldier is about 25 px tall at gameplay zoom and a
vehicle is 90-125 px long (`docs/art/style-bible.md` §1). The genre's band is roughly 20-130 px
on a 1080p-1440p screen (est.). At those sizes:

- **One read per unit.** A unit is told apart by posture, weapon angle and mass, never by texture.
  Roaring Lions already gates this: IoU under 0.88 at 64 px against every other unit
  (`validate:meshes`).
- **Horizontal variation matters.** A top-down camera foreshortens height, so a top-down camera
  shows a unit's width and length more than its height (inference). A unit is told apart by
  what sticks out sideways: barrels, launch tubes, booms, wings. One player critique of AoE IV
  makes this point: silhouettes, not bigger weapons, drive readability, and horizontal shape
  variation was missing [S7] (player opinion).
- **Value separation from the ground.** Most readability failures are value problems, such as a
  busy background in the same mid-tones as the units. The fix is to push background detail back in
  value and saturation [S1]. Company of Heroes 3's alpha was criticised for exactly this. Heavy
  cover and passable ground read as the same value, and units were hard to tell apart under some
  lighting [S8] (community, snippet).
- **Light top, dark base** (est.). Many top-down designs put the lightest values on top surfaces,
  such as a turret roof or helmets and shoulders, and the darkest at ground contact. The sun lights
  the top anyway, so a light top lets value and lighting reinforce each other. No sourced rule
  states this; it is a common practice.
- **Value contrast budget** (est.). A unit should differ from the ground under it by a clear step,
  about 15-25% in linear luminance or one to two palette ramp steps, on at least its top
  surface or its outline. Where a unit's base colour matches the ground's value (olive on
  scrub, tan on dust), the separation has to come from the shadow it casts, a rim or outline, and
  team-colour accents (inference).

## 3. The squint test, and its stricter variants

The squint test blurs the frame so that only value masses remain. Run it in several forms:

1. **Black fill.** Fill every unit black at its game size, line them up and look for pairs that
   match. One guide describes a five-second QA routine: fill, squint, step back, compare [S9].
2. **Greyscale.** Desaturate the in-game frame. Units must still separate from the ground, and
   threats from friendlies [S2], [S10].
3. **Blur.** Gaussian-blur a game-zoom capture by about 2-3 px at 1080p (est.). The unit masses
   should survive.
4. **Busiest moment, not the calmest.** Stress-test readability in the heaviest combat, with
   smoke, fire and explosions, not in a quiet frame [S1].
5. **At the real zoom levels.** Test at the minimum, default and maximum zoom, and at the
   resolution the player uses. A close-up turntable is not a readability test (inference; it is
   the lead's habit of judging zoomed-in renders, `approve-art-numbers-before-rendering` memory).

Valve's Dota 2 workshop guide (a high three-quarter camera, the closest MOBA analogue to RTS)
tells artists to test value patterns in the game before adding colour [S10] (snippet).

## 4. Exaggerated proportions

- StarCraft II over-proportions characters, slightly bigger than life, so they read at distance [S3].
- AoE IV makes weapons larger for readability [S5].
- Warcraft III Reforged made a mount more prominent "to keep it unambiguous on a chaotic
  battlefield" [S11].
- **A caution from the same games.** Reforged models went from about 700 to about 15,000
  polygons [S11]. Many players then found them harder to identify at a glance than the low-poly
  originals [S12] (forum opinion). More detail without a readability pass costs identification.

**For a realism-leaning game like Roaring Lions** the lever is selective scale, not caricature
(inference). Scale up what identifies the role: the gun tube, the launcher, the radar, the
dozer blade, the antenna. Keep the hull and figure proportions real. The project already does this
through `SIZE_CLASS`, with no per-asset scaling (style bible §1). An identifying part can be
enlarged by about 10-25% (est.). The lead's "kit gear must look real" ruling caps it for infantry
kit.

## 5. Team colour: how much and where

There is no published industry percentage. The sourced evidence is directional:

- StarCraft II's early builds had units that looked over-saturated from heavy team colour, and the
  art team planned passes to balance team colour against brightness [S13] (secondhand news
  summary).
- Warcraft III Reforged shipped a later team-colour polish pass on melee units and buildings for
  vibrancy and readability [S14] (snippet).
- AoE IV took team colours from its predecessor for accents, not for the whole environment [S6].
- Roaring Lions' lead rejected a solid team fill on silhouettes as "too loud". The shipped vehicle
  team mark (L3) covers **about 2% of the Lavi's surface**: a roof panel plus turret flank bands
  (`team-mask.ts`).

**Placement principles:**

1. **Put it on the top surfaces the camera sees.** A dimetric camera at 30° elevation sees roofs
   and turret tops first. A roof panel reads at every zoom; a skirt band near the ground is lost
   in the unit's own shadow (inference).
2. **Concentrate it rather than scatter it.** One or two solid shapes read; many small flecks
   blur into the base colour at 25 px (inference, the same rule as §2).
3. **The area budget** (est.). Vehicles get about 2-6% of their visible surface as a mark. Infantry
   get one element per figure, such as a helmet band, armband or backpack panel. That element is
   often more of the area, perhaps 5-10%, because figures are tiny. Back the in-world mark with
   the non-diegetic channels: ring, outline, minimap and icons. These carry team identity at
   every zoom and under every grade.
4. **Keep team hues out of the world palette.** Saturated colour is reserved for team markers and
   VFX (style bible §1, `data/palette.json` reserved bands). This is the same separation AoE IV
   describes [S5], [S6].
5. **Survive the grade and the tone mapper.** A saturated blue or red shifts under filmic tone
   mapping (see `materials-and-lighting.md` §3.2). Check the team colours after the final output
   transform under every time of day and colour-vision mode. The project already plans a
   delta-E gate for grades (look-uplift spec §8).

## 6. The ground stays quieter than the units

- Push background detail down in value and saturation so units in the same mid-tones do not
  vanish [S1].
- Company of Heroes 3 makes noise carry meaning: more noise marks concealment and hard ground,
  and less noise and contrast mark clear paths [S8] (summary of the art director's post, snippet).
  The ground's texture frequency becomes a gameplay channel. That only works if the units sit
  above it in contrast.
- Dawn of War III's art director, on raising the camera: units "need to pop out from the background
  art", and mud and grime that worked close up in its predecessor "can turn into noise pretty
  quickly" from a high angle [S15].
- **Saturation ceiling** (est.). Ground chroma should stay below the least saturated team
  colour, and well below the VFX band. Desert, karst and overcast ramps are naturally low-chroma.
  Green maps (grass, fen) are where this fails first: a saturated sward competes with team colour
  and with olive hulls. The project already measured a figure-ground share, texels within
  CIEDE2000 12 of KDF `olive.1` and limited to 5%, on the wetland (`terrain-rendering.md`).
- **Frequency.** Keep ground detail at a different spatial frequency from unit detail: larger
  macro variation and fine grain, with little at the unit's own scale of 1-4 m (inference).

## 7. The effects hierarchy

What must out-read what, highest first. The order is distilled from the sources; the exact
ranking is my synthesis (inference).

1. **Threat and damage cues tied to a decision.** Incoming artillery, a missile launch, a unit
   being hit, a unit dying.
2. **Weapon fire from own and enemy units.** Muzzle flashes and tracers, which say who is shooting
   whom.
3. **Explosions and impacts.** A bright core, briefly. Its smoke must not hide the units for long.
4. **Persistent battlefield state.** Smoke screens, fires, craters, wrecks, tracks. Company of
   Heroes 2 made tracks in snow an information layer: fresh tracks reveal enemy movement [S16].
5. **Ambient effects.** Dust, wind, rain, haze. They should be the lowest contrast in the frame.

Principles:

- **Brightness is reserved.** Only effects should exceed scene white. Roaring Lions does this
  already: bloom threshold 1.0, with HDR gains in one table (`hdr-gains.ts`), and quiet frames
  are held under 0.9 by `perf:bloom-census`.
- **Hue is reserved.** Effects use a saturated band that the static art never uses (the palette's
  `reserved.vfx`).
- **Duration is inverse to brightness** (est.). The brightest elements, such as a muzzle core or
  an explosion's white-hot centre, last tens of milliseconds to a few hundred. The dimmest, such as
  smoke and dust, last seconds to tens of seconds. A long bright effect stops reading as an event.
- **Smoke obeys gameplay.** If smoke is cover in the sim, its visual density must match its
  mechanical effect, as Company of Heroes 2 matched visual sight blockers to real ones [S16].
  Roaring Lions keeps own-unit outlines in smoke and drops enemy outlines, because smoke is cover
  (CLAUDE.md).
- **Cap the cost of effects.** Company of Heroes 2 drew effects at half resolution and
  composited them, cutting the worst-case frame loss from about 30% to under 4% [S17].

## 8. UI versus world

- **Diegetic versus non-diegetic.** Selection rings, health bars, outlines and orders are
  non-diegetic: they serve the player and may be saturated and flat. The world is diegetic: it
  must look like a place, and it is lit. Do not put status marks in the world mesh. Roaring Lions'
  lead rejected an in-world kit badge, and kit reads on icons instead (CLAUDE.md, "no status marks
  in the world").
- **Overlays sit in their own value and hue band.** They must not borrow the world's tans and
  olives, and the world must not borrow their saturated hues (inference; the project's palette
  bands already enforce it).
- **Zoom changes the balance.** Strategic zoom turns units into icons. Supreme Commander zooms out
  until units are icons, like an enlarged minimap [S18] (snippet). Its zoom is described as LOD
  swapping down to dots, with the engine built for it from the start [S19]. WARNO's players ask
  for icons to hide when zoomed in, because icons clutter the close view [S20]. The principle:
  the closer the camera, the more the world carries the information; the further, the more the
  icons carry it.
- **A UI that shares the world's material language** raises cohesion. Total War: Three Kingdoms
  built its UI from ink and paper in line with its setting [S21].
- **Notifications.** A reviewer of Dawn of War III wanted clearer notices when outposts or units
  were under attack [S22]. World effects alone do not tell a player about a fight off-screen.

## 9. Lessons by game, as principles

A short form. The long form, with each game's eight dimensions, is
`leading-rts-best-practices.md`.

| Game | Principle it proves |
|---|---|
| Command & Conquer 3 / Red Alert 3 | Each faction has one tone and one material identity (armoured or stylish), held across every unit [S23] (snippet) |
| StarCraft II | Silhouette first for the fixed camera. Over-proportion. Conservative geometry with quality in the pixel shader. Team colour tuned against saturation [S3], [S4], [S13] |
| Company of Heroes 1-3 | Real sight-blocking that you can see. The ground records history (tracks, snow, craters). Grime grows from play. Value and noise encode cover [S8], [S16], [S17], [S24] |
| Age of Empires IV | Readability over fidelity. Larger weapons. Consistent footprints. Detail spent on buildings, not small units [S5], [S6] |
| Warcraft III Reforged | Identification can regress when fidelity rises. Plan readability and team-colour passes [S11], [S12], [S14] |
| Supreme Commander | Design the zoom range and icon handoff into the engine from day one [S18], [S19] |
| Iron Harvest | Destruction changes cover over a match, so the map looks different at the end. Weight is sold through the rig [S25], [S26] |
| WARNO / Steel Division | Detail layers by zoom, from grass up close to a planning map far out. HUD clutter is the most common complaint [S20], [S27] |
| Total War | What the player sees must equal what the sim does: a barely visible wrinkle can block sight. Detail and noise are tuned by camera distance [S21], [S28] |
| Northgard | A simple UI protects the atmosphere. Seasons change both the look and the rules [S29], [S30] |
| Dawn of War II / III | A raised camera needs bright, clean unit colour; close-up grime turns to noise from a high angle [S15], [S22] |

---

## Sources

Every claim above links to one of these. Where a page was seen only as a search summary, the claim
carries "(snippet)".

- [S1] Bugnet, "Readable game art: why clarity beats detail" — https://bugnet.io/blog/readable-game-art-why-clarity-beats-detail
- [S2] RocketBrush, "Shape language in game character design" — https://rocketbrush.com/blog/shape-language-in-game-character-design-how-to-make-characters-readable-and-consistent
- [S3] Eurogamer interview with Samwise Didier (repost) — https://www.blizzplanet.com/blog/comments/eurogamer_interviews_samwise_didier
- [S4] Filion and McNaughton, "StarCraft II: Effects & Techniques", SIGGRAPH 2008 Advances course — https://www.advances.realtimerendering.com/s2008/SIGGRAPH2008%20-%20StarCraftII.pdf
- [S5] GamePressure, AoE IV visuals and the developers' response (Zach Schläppi) — https://www.gamepressure.com/newsroom/age-of-empires-4-takes-flak-for-visuals-devs-respond/z13167
- [S6] MobileSyrup, AoE IV Relic developer interview — https://mobilesyrup.com/2021/04/10/age-of-empires-iv-relic-developer-interview/
- [S7] AoE forums, unit appearance thread (player opinion, snippet) — https://forums.ageofempires.com/t/aoe4-units-appereance-coolness-and-colorful-pyjamas/237243
- [S8] CoH3 art vision forum thread (search summary only) — https://community.companyofheroes.com/coh-franchise-home/company-of-heroes-3/forums/1-general-discussion/threads/1551-company-of-heroes-3-art-vision-life-at-war-and-cinematic-realism
- [S9] FreeGameSprites, sprite silhouette test — https://freegamesprites.com/es/news/sprite-silhouette-test-character-readability
- [S10] Valve, Dota 2 Workshop Character Art Guide (snippet; the PDF now redirects to this page) — https://help.steampowered.com/faqs/view/0688-7692-4D5A-1935
- [S11] Blizzard, "Tales from the Smithy: Reforging the Humans" — https://news.blizzard.com/en-us/article/23150108/tales-from-the-smithy-reforging-the-humans
- [S12] Blizzard forums, "Graphics don't feel like Warcraft III" (player opinion) — https://us.forums.blizzard.com/en/warcraft3/t/feedback-graphics-dont-feel-like-warcraft-iii/275
- [S13] GosuGamers, StarCraft II graphic change (2008) — https://www.gosugamers.net/news/7571-graphic-change-in-the-works-for-starcraft-ii
- [S14] Destructoid, Warcraft III Reforged patch (snippet) — https://www.destructoid.com/warcraft-iii-reforged-gets-another-patch-to-smooth-over-its-sins-from-launch/
- [S15] GameGrin, Dawn of War III interview (Philippe Boulle) — https://www.gamegrin.com/articles/warhammer-40000-dawn-of-war-iii-interview/?os=30
- [S16] Engadget, "Keeping your eyes open in the cold of Company of Heroes 2" — https://www.engadget.com/2013-06-24-keeping-your-eyes-open-in-the-cold-of-company-of-heroes-2.html
- [S17] Daniel Barrero, CoH2 rendering technology (KGC 2013 slides) — https://www.slideshare.net/proyZ/daniel-barrero-coh2renderingtech
- [S18] Edge via PressReader, Supreme Commander strategic zoom (snippet) — https://www.pressreader.com/australia/edge/20170105/282656097111257
- [S19] Matchstick Eyes, RTS zoom retrospective — https://www.matchstickeyes.com/tag/rts-zoom/
- [S20] Steam Workshop comments, WARNO icon clutter (player feedback) — https://steamcommunity.com/sharedfiles/filedetails/comments/3387658237
- [S21] GamesBeat, how Creative Assembly conceived the art for Total War: Three Kingdoms — https://gamesbeat.com/how-creative-assembly-conceived-the-art-for-total-war-three-kingdoms/
- [S22] GamingTrend, Dawn of War III review — https://gamingtrend.com/reviews/beautiful-but-bittersweet-dawn-of-war-iii-review/
- [S23] GameSpot, C&C3 designer diary 4 (snippet) — https://www.gamespot.com/articles/command-and-conquer-3-tiberium-wars-designer-diary-4-comparing-the-gdi-and-nod-factions/1100-6163297
- [S24] TheSixthAxis, CoH3 art and authenticity dev diary — https://www.thesixthaxis.com/2022/04/22/company-of-heroes-3-dev-diary-trailer-art-and-authenticity/
- [S25] Shacknews, Iron Harvest interview — https://www.shacknews.com/article/120167/iron-harvest-interview-combining-history-with-science-fiction
- [S26] KING Art devblog — https://kingart-games.com/article/49
- [S27] SUPERJUMP, WARNO early-access impressions — https://www.superjumpmagazine.com/warno-early-access-impressions/
- [S28] Game Developer, designing Total War: Warhammer II for massive battles — https://gamedeveloper.com/design/designing-i-total-war-warhammer-ii-i-to-handle-tons-of-units-and-massive-battles
- [S29] Game Developer, Northgard's multiple victory states — https://gamedeveloper.com/design/crafting-the-multiple-victory-states-of-the-rts-i-northgard-i-
- [S30] Wccftech, Northgard impressions — https://wccftech.com/northgard-impressions-the-viking-rts-weve-been-looking-for/
- Project facts (read-only, `origin/main` on 2026-11-09): `CLAUDE.md`, `docs/art/style-bible.md`, `data/palette.json`, `packages/render/src/three/units/team-mask.ts`, `docs/agent-notes/terrain-rendering.md`.
