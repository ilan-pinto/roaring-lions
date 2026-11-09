# What reads at RTS scale, what Roaring Lions does today, and the gaps

Reference notes for Roaring Lions developers, part 3 of 3 (`soldier-movement.md`, `squad-tactics.md`, `game-and-animation.md`).
Real-world numbers come from the other two files; this one adds the craft side and the comparison with the game. Every
external number has a source tag; **HEURISTIC** marks craft advice (a reputable practice, not a measurement);
**ESTIMATE** marks a number no source gave. Game facts cite the file they were read from (main, 9 Nov 2026).

## Contents

1. [Scale: tiles, ticks and the camera](#1-scale-tiles-ticks-and-the-camera)
2. [What a player notices at RTS distance](#2-what-a-player-notices-at-rts-distance)
3. [Animation craft heuristics](#3-animation-craft-heuristics)
4. [What the game does today](#4-what-the-game-does-today)
5. [Real vs game, side by side](#5-real-vs-game-side-by-side)
6. [Gaps, ranked](#6-gaps-ranked)
7. [Constraints any fix must respect](#7-constraints-any-fix-must-respect)
8. [Sources](#sources)

---

## 1. Scale: tiles, ticks and the camera

- **One tile is 3 m.** The renderer's `MESH_UNITS_PER_TILE = 3.0` (`packages/render/src/three/units/mesh-anim.ts`),
  `METRES_PER_TILE = 3` (`units/squad-motion.ts`, `units/running-gear.ts`), and the rig's `TILE_M = 3.0`
  (`tools/units/rig.py`) all agree. A mesh unit is a metre.
- **The sim ticks at 20 Hz** (`TICKS_PER_SECOND = 20`, `packages/sim/src/sim.ts`); the renderer interpolates to 60 fps.
  A walking step (about 0.5 s) spans 10 ticks; a running step (about 0.35 s) about 7.
- **Conversions to remember:**

| Real | Tiles |
|---|---|
| 10 m wedge interval | 3.3 tiles |
| 20 m between men (overwatch) | 6.7 tiles |
| 50 m between teams | 17 tiles |
| 250 m: switch to bounding before the far side of an open area | 83 tiles |
| 1.35 m/s march pace | 0.45 tiles/s |
| 3.7 m/s loaded sprint | 1.2 tiles/s |
| 35 m: most urban engagements are at or under this ([S30] 7-1b) | 11.7 tiles |

- **The world is small.** A 48 x 48 map, the campaign's standard grid, is 144 m across. A Rifle Squad's sight is 8 tiles, 24 m
  (`data/units/kdf/inf_squad.json`). Doctrinal open-ground spacing (a squad column is about 20-30 m by 50-60 m) would fill
  a fifth of a map, so the game compresses space by roughly 5-10 times. Urban doctrine (3-5 m between men, engagements
  under 35 m) fits the game's scale almost as it is; open-ground doctrine does not.
- **One squad is one entity on one tile**, drawn as a few figures: the Rifle Squad is 8 men (`hull.crew`) drawn as 3
  figures (`hull.figures`), standing about 0.9 m apart in a shallow wedge (`tools/units/teams.py`). At play zoom an
  infantry figure is about 25 px tall (the old `kit.py` readability note, `docs/agent-notes/mesh-units.md`), so a figure's
  head is about 3 px.

## 2. What a player notices at RTS distance

No study measures this for RTS cameras. The ranking below is a **HEURISTIC** built from three kinds of evidence: what the
game's lead caught on the live site (`memory: infantry-motion-standard`, `infantry-squad-design-rules`), what shipped
RTS games chose to make legible ([S38], [S39]), and the size arithmetic above.

### Reads clearly (worth getting right)

1. **Posture height.** Standing, kneeling and prone change the silhouette's height by about 1.75 m, 1.1-1.2 m and
   0.3-0.4 m (**ESTIMATE**, typical adult anthropometry): a 3:2:0.5 ratio, which survives at 25 px. Kneel-to-fire is the
   lead's settled standard; prone is the strongest read of "under fire".
2. **Transitions between postures.** A man dropping or getting up is a large, fast change of silhouette. Company of
   Heroes builds its whole suppression read on it: suppressed and pinned squads change state, pinned ones cannot move
   or fire ([S39]).
3. **Group shape and spacing.** A wedge, a line and a file are different shapes even at 3 figures. Blizzard designed
   StarCraft II's units for the top-down three-quarter view, by silhouette ([S38]); a squad's footprint is its
   silhouette at RTS zoom.
4. **Stop and go.** Whether men move continuously or in rushes, and whether they halt to fire. The lead caught the loss
   of walk-and-fire and stiff procedural clips on the live site within a day (motion standard, 5 Oct 2026).
5. **Foot sliding and treadmilling.** Feet moving slower or faster than the ground are noticed at play zoom (the game
   measured walkers 1.8-2.9 times too fast for their stride before the gait pass, `mesh-units.md`). This is the
   cheapest realism error to make and the most visible one at medium zoom.
6. **Recoil and muzzle direction.** Visible only when exaggerated: the game multiplies recoil by 1.5-2.5 so it reads
   (`RECOIL_MULTIPLIER`, `units/squad-motion.ts`).
7. **Crawling.** Slow, flat movement reads as a distinct state, provided it is drawn (see gap G2).

### Marginal (visible when zoomed in, or in aggregate)

- The suppression lean (18 degrees of spine) and a 6-degree near-miss flinch: individually small, but a whole squad
  ducking at once reads as a ripple (`LEAN_*`, `FLINCH_*` in `units/squad-motion.ts`).
- Load-dependent gait (forward lean of 2-11 degrees, longer double support): reads as "heavy" versus "light" across
  teams, not per figure.
- Per-figure phase and cadence variety: invisible on one figure, but its absence (lockstep) is very visible.

### Invisible at play zoom (do not spend on it)

- Finger detail, head turns under about 20 degrees, breathing, and arm-swing nuance with a rifle held in both hands.
- Stride length errors under about 10 % if the feet do not slide (**HEURISTIC**).
- Exact doctrinal intervals: a player cannot tell 8 m from 10 m; he can tell clumped from dispersed.

The game's own exception list matters: **hands are counted by the lead in close-ups and in the store**, two per figure,
each holding its weapon (`infantry-squad-design-rules`). Invisible at play zoom is not a licence to get them wrong.

## 3. Animation craft heuristics

All **HEURISTIC** unless a number is sourced.

### Cycle timing

- Traditional animation: a natural walk is one step every 12 frames at 24 fps (0.5 s a step, a 24-frame cycle); slower
  walks 14-18 frames a step, faster 8-10; under about 8 frames a step becomes a run ([S37a], [S37b], [S37c]). At 30 fps
  the same 12-frame step is about 15-16 frames ([S37c]).
- In steps per second, human gait gives walk 1.7-2.4, run 2.5-3.1, sprint 3.3-4.2 (the game's own `HUMAN_CADENCE` gate,
  `tools/src/mesh_gait.test.ts`); civilian preferred walking is about 1.9 steps/s ([S25]).
- **Pick the clip by speed band, not one clip time-scaled across all speeds.** The walk-to-run change happens around
  2 m/s (the boundary of the game's own cadence bands). Slowing a run clip to walking speed keeps the flight phase and
  reads as slow motion; speeding a walk into a run reads as scurrying.

### Keeping feet planted

- **Rate-match the legs to the ground.** Unreal's stride warping scales the stride by `locomotion speed / root-motion
  speed`, with a minimum speed below which it switches off and a clamp on the scale ([S33a]). The game already plays each
  locomotion clip at `ground speed / declared stride` (`rl_gait`, `mesh-anim.ts`), with a clamp of 4 that is a
  backstop only.
- **Lock the planted foot** with IK during stance; the common fix for residual slide is stride warping plus foot locking
  ([S33a], forum and blog advice there).
- **Orientation warping** twists the legs toward the travel direction and the spine back toward the aim; Unreal's default
  limit is 90 degrees ([S33a]). The game caps aim off the march heading at 45 degrees for the same reason
  (`AIM_OFF_HEADING_MAX`, `tuning.ts`).
- **Sync markers**: when blending walk and run, align footfalls (a "right foot down" marker in both) rather than
  normalised length, or the feet drift apart mid-blend ([S33b]).

### Transitions

- **Inertialization** (Gears of War 4): instead of evaluating two clips through a cross-fade, switch at once and decay
  the pose difference as a post-process; reported as 60 % cheaper overall ([S34a], [S34b]). Worth knowing at 300 units,
  where cross-fades double the per-figure cost for their duration.
- **Motion matching** (For Honor): a brute-force search of a large mocap database each frame for the best next pose,
  matched on pose and velocity ([S35]). It needs a large captured dataset and CPU; it does not fit a pipeline where clips
  are authored in code and figures number in the hundreds.
- **Procedural animation from few keys** (Overgrowth): a handful of key poses driven by simple procedural rules gives
  fluid, interactive motion ([S36]). This is the closest public precedent for the game's code-authored clips.
- Stagger stance changes across a squad (the game's 0, 0.08 and 0.15 s, `STANCE_STAGGER_S`) so they read as men, not a
  switch.

### RTS readability

- Design for the camera's view angle; readability must hold over the zoom range, not one zoom ([S38]).
- Exaggerate what must read (recoil 1.5-2.5x in this game); keep posture contrast high; keep the group's footprint
  meaningful (a shape the player can learn).
- Status belongs on icons and the HUD, not on world marks (the lead rejected an on-map kit badge,
  `memory: no-status-marks-in-the-world`). Posture and spacing are how the WORLD shows status.

## 4. What the game does today

Read from main on 9 Nov 2026.

### Sim (deterministic, fixed point, 20 Hz)

- **Speeds** (`data/units/*/*.json`, `mobility.speed_tiles_s`): Rifle Squad and Sarim Rifles 0.9 tiles/s (2.7 m/s, a
  jog), grenadiers 0.85, mortar 0.65 (1.95 m/s), AT teams 0.7 (2.1 m/s), sniper 0.45 (1.35 m/s), the Sarim charge squad
  1.9 (5.7 m/s, a sustained sprint). Speed does not depend on load or posture.
- **Halt to fire** (`tuning.ts`): foot units that shoot halt and kneel before the first shot: `KNEEL_DROP_TICKS` 4
  (0.2 s) down, `KNEEL_RISE_TICKS` 4 (0.2 s) up, measured against the urban backtest (0.6 s read 68 % on a 90 % gate).
  Kneeling adds no cover, accuracy or signature. Plain moves run through without firing.
- **Bounds** (`BOUND_FIRE_TICKS` 40, `BOUND_MOVE_TICKS` 40): on attack-move against a target in the open between
  effective and maximum range, a halt-to-fire unit alternates 2 s down and firing with 2 s up and moving.
- **Suppression** (GDD 5.5, `tuning.ts`): pinned at 0.70, released at 0.45, decays at 0.15/s; cover divides incoming
  suppression (1, 0.475, 0.1375, 0.09 for cover 0-3). A pinned unit holds fire and moves at 1/64 speed
  (`PIN_SPEED_SHIFT` 6): 0.014 tiles/s, about 0.04 m/s for a Rifle Squad. Pinned 10 s continuously, a soft unit routs and
  flees at half speed for 6 tiles.
- **Wounds**: a downed man crawls toward better cover every 2 s within a 5 x 5 tile window (`WOUND_CRAWL_*`).
- **Formations** (GH-859): Column, Attack, Ambush, as data (`data/formations/`); in the Attack, infantry squads stand in a
  rank 1 tile (3 m) apart, `max_lateral` 3; marches on checkpoints with a dress; the Column paces at the slowest ground
  member (`slowest_ground`), the Attack at no common pace. Off in some versus maps.
- **Transport**: a squad boards a carrier on reaching it and rides untouchable; it **disembarks instantly** to the tile
  at the hull position + (0.5, 0.5) tiles, or the nearest open tile (`Sim.disembark`, `sim.ts`). No dismount time, no
  ramp.
- **Garrisons**: a garrisoned squad fights from the window (`eyePoint`), lifted `floors - 1` levels.

### Renderer (presentation only)

- **Clips** (`packages/render/src/sheet.ts`, `tools/units/rig.py`, `tools/src/meshes/motion/`): `idle`, `move`, `fire`,
  `moveFire`, `kneel`, `kneelIn`, `kneelOut` (0.2 s, scrubbed by the sim's drop/rise ticks), `pinned`, `down`, `wreck`,
  `fall`/`fallAlt` (three captured teams), `work`; the wounded carry `down`, `idleWounded`, `crawl`, `treat`, `carry`.
  There is **one locomotion clip per team** (`move`), rate-matched to speed; `moveFire` shares its legs.
- **Clip choice** (`clip.ts` `resolveClip`): routed and moving plays `move` at 1.6x cadence; routed and still, or
  pinned, plays `pinned` **whether or not the unit is moving**; then working, firing, moving, idle.
- **The pinned huddle** (`motion/pinned.ts`, approved 7 Oct): every figure on one knee, folded forward at spine, neck
  and head, weapon pointing at the ground. Chosen so a pinned team does not lie in its death pose.
- **Squad motion** (`units/squad-motion.ts`, `units/squad-rig.ts`): each figure walks its own path to its slot (lag at
  most 0.25 m, acceleration 14 m/s^2), drifts 0.25 m along and 0.12 m across over 3-7 s periods, has its own clip phase
  (0, 0.37, 0.71) and cadence (+/- 6 %), staggers stance changes by 0.08-0.15 s, spreads its slots 20 % wider when kneeling,
  twists its upper body up to 60 degrees toward the aim, and turns its legs at 400 deg/s.
- **Suppression read**: a spine/neck/head lean of up to 18/10/12 degrees from suppression 0.15 to 0.70, a 6-degree,
  0.3 s near-miss flinch when already shaken, and a fixed 25-degree forward lean when routed and running.
- **Gait** (`rl_gait`, `pnpm gait:meshes`): the stride each clip's legs plant is measured and the clip is played at
  ground speed / stride; cadence is gated against human bands; foot skate is gated under 0.25 of body speed; nothing a
  living figure draws may be under the ground (`mesh_gait.test.ts`).
- **Weapon handling** (motion standard, 5-6 Oct): right shoulder, cheek on the stock, both hands on the weapon, low
  ready when moving, per-shot recoil exaggerated 1.5-2.5x, RPG on the shoulder with backblast. No figure kneels while its
  unit moves.
- **Deaths**: figures topple about their own feet away from the killer over 0.5 s, or play a captured fall; wrecks
  persist.

## 5. Real vs game, side by side

| Aspect | Real (see the other files) | Game today | Verdict |
|---|---|---|---|
| Move speed | march 1.35 m/s moving, rush 3.7-4.8 m/s | 2.7 m/s always (Rifle Squad) | compressed on purpose; reads as a jog |
| Get down to fire | kneel 0.5-1.0 s, prone 1-2 s (ESTIMATE) | kneel 0.2 s | compressed for balance; lead-accepted |
| Posture under fire | prone behind cover | kneeling huddle | readable, but not what soldiers do |
| Moving while pinned | low crawl, 0.1-0.3 m/s (ESTIMATE) | 0.04 m/s, drawn as the static huddle | the sim already crawls; the picture does not |
| Rush | 3-5 s up, then prone | 2 s up, 2 s kneeling (band-range bounds only) | right rhythm, wrong ending posture |
| Fire team spacing | 10 m (3.3 tiles); urban 3-5 m | 3 figures about 0.9 m apart | about 5-10x tighter than doctrine |
| Spacing between squads | 20-50 m (7-17 tiles) | 1 tile in the Attack formation | compressed by the map size |
| Wedge shape | leader at the point, others echeloned back | shallow wedge, leader stepped forward | present |
| Lockstep | none: men move independently | per-figure phase, cadence, drift | good |
| Sectors | each man watches his side | all figures face the march or the target | missing |
| Load | 27-45 kg; forward lean, longer double support | stride scaled by speed; lean by team speed | partial |
| Urban: wall hugging, shadows | 30 cm off the wall, shadowed side | flow-field tile centres | missing |
| APC dismount | 30-45 s per fire team by the ramp; out the back | instant, beside the hull | missing |
| Infantry ahead of tanks in streets | yes; not in the gun's 60-degree arc | no relation | missing |
| Break contact / ambush drills | leapfrog back with smoke; assault through near ambush | rout = flee at half speed | partly (rout is a different thing) |

## 6. Gaps, ranked

Ranked by visual impact times gameplay impact over cost. **P** = presentation only (renderer or art, no sim change, no
determinism risk); **D** = data only (JSON the sim already reads); **S** = sim change (needs `sim-guard`, the golden hash
and `pnpm balance`). Each "real" figure is from the other two files.

| # | Gap | Real reference | Fix | Layer | Visual | Gameplay | Cost |
|---|---|---|---|---|---|---|---|
| **G1** | A pinned unit under a move order still plays the static huddle and slides (slowly: 0.04 m/s, about 0.4 m in 10 s) | pinned men crawl to cover, 0.1-0.3 m/s low crawl (ESTIMATE) | play a `crawl` clip (prone, or knees and elbows) when pinned AND moving, rate-matched like `move`; the wounded rig's crawl is a starting point. Optional later (S, balance): a pinned crawl speed nearer 0.1 m/s (0.03 tiles/s) instead of 1/64 | P (S optional) | medium | none (P) | low-medium |
| **G2** | No prone posture for the living | "nearest covered position", the rush ends prone, prone when no cover ([S7], [S10], [S30]) | a `prone` / `proneFire` pair for open ground under fire, the kneel kept for cover and buildings; the lead's reason for the kneeling huddle (prone read as dead) is answered by a raised head, muzzle up, and the crawl from G1 | P (a choice rule can read sim state: suppression, tile cover) | high | none | medium (art, motion pass, gates); needs the lead's approval, it revisits the 7 Oct ruling |
| **G3** | One locomotion clip played across every speed band | walk under ~2 m/s, run 2-4 m/s, sprint above ([S25], `HUMAN_CADENCE`) | add `walk` (and `sprint` for the charge squad) per team; choose by ground speed with footfall-synced blending ([S33b]). Most visible on a Column paced by its slowest member, routs at 1.6x, and pinned creep. The cadence gate should test each clip at the speeds it will actually play (it reads each team at its own unit speed today, as far as I can tell) | P | medium-high | none | medium |
| **G4** | APC dismount is instant and beside the hull | ramp exit, 30 s per fire team on the Bradley standard ([S31]); Namer 9 men by a rear door-ramp ([S28g]) | P: figures appear at the ramp and walk to their slots over ~5-10 s (the squad rig already walks figures to slots, with its lag cap lifted for this). S: set the rider down at the hull's rear rather than (+0.5, +0.5), and optionally a short dismount delay (gameplay: a vulnerable window) | P first, S optional | medium-high | medium (if S) | low (P), medium (S) |
| **G5** | Figures too close together | 10 m wedge, 3-5 m urban ([S1], [S30]) | widen slots inside the tile from ~0.9 m to ~1.5-2.5 m on open ground and keep them tight in streets and buildings, read from the tile's cover/building context; never leave the unit's tile | P | medium | none | low |
| **G6** | No sector watching | interlocking sectors, rear security ([S1], [S2]) | when moving without a target, give each figure an upper-body/head yaw to its side of the wedge (point ahead, flanks out, last man rear) inside the existing 60-degree twist | P | low-medium | none | low |
| **G7** | The rush ends in a kneel, not a fall to prone | 3-5 s up, plant, fall forward, roll ([S10]) | when a bound ends in the open, play a `dropProne` (fall forward and roll) instead of `kneelIn`; keep the sim's 0.2 s. A presentation-only fall must finish inside the sim's window or it lies, so it is an abbreviated fall | P | medium | none | medium (depends on G2) |
| **G8** | No overwatch technique | traveling / traveling overwatch / bounding overwatch by likelihood of contact ([S3]) | a formation `march` option in which elements alternate move and overwatch, data-driven in the formation schema | S + D | medium | high | high |
| **G9** | No urban wall-hugging | 30 cm off the wall, the shadowed side, below windows ([S30] 3-2, 3-3) | P: bias figure slots toward the nearest wall on street tiles and crouch the walk past windows. S (later): a flow-field cost for open street centres | P first | medium | low (P) | low-medium |
| **G10** | Load does not show in the gait | heavy teams lean 2-11 degrees, longer double support, shorter stride at heavy loads ([S14]-[S17]) | a per-team load class (light rifle / heavy weapon / crew-served) in the rig's gait table: more lean, more knee flexion, longer double support for mortar, MG and AT teams | P (art) | low-medium | none | medium (re-export, motion and gait passes) |
| **G11** | Infantry and armour ignore each other | dismounts ahead in streets, not in the 60-degree arc, not behind the engine ([S30], [S30b]) | a formation element relation (dismounts N tiles ahead of hulls in close terrain) and a renderer rule keeping figures out of a firing hull's frontal arc | D + S (formation), P (arc) | low-medium | medium | high |
| **G12** | No break-contact drill | leapfrog back under smoke ([S7] Drill 3) | a "break contact" order: two elements alternate fire and move away, the smoke ability used by the first mover | S + D | low | medium | high |

### Things deliberately left alone

- **The 0.2 s kneel and the 2.7 m/s run** are compressions measured against the backtest and accepted by the lead
  (`tuning.ts` comments). At 0.2 s the max-tier urban assault gate reads 97 %; the realism-only first pick, 0.6 s, read 68 % under the first design against a 90 % floor (`tuning.ts`). Change only with
  `balance-analyst`.
- **Doctrinal spacing between squads** (7-17 tiles) does not fit 48-tile maps. G5 compresses it inside the tile; between
  squads, 1-2 tiles in the open is the believable limit.
- **The kneeling huddle** is the lead's 7 Oct ruling. G2 proposes revisiting it with evidence, not overriding it.

### Recommended order

G1 (a crawl for pinned movers: the sim already does it, the picture is wrong) and G5 (spacing) first: both
presentation-only, cheap, and visible in every firefight. Then G3 (walk/run by speed), then G2 + G7 together (prone and
the rush ending), with the lead's sign-off on the pose numbers before any render. G4's presentation half can ride along
with any carrier work. G8, G11 and G12 are design work for a formations phase, not animation tasks.

## 7. Constraints any fix must respect

- **Invariant 4**: animation reads sim state, never writes it. A posture rule may read `suppression`, `pinned`, tile
  cover and `brace`, and must not feed back. Nothing visual may decide a hit.
- **Determinism**: every per-figure variation is a hash of the entity id (as `hash01` does), never `Math.random()`.
  Presentation timers run on the sim clock (`presentationSimMs`), not wall-clock accumulation.
- **Bones and clips are authored in code** (`rig.py`, `tools/src/meshes/motion/`) or come through the Meshy pipeline,
  never hand-posed; rigid binding except the Meshy figures. Pipeline order is load-bearing: export -> hands -> motion ->
  gait -> (kit) -> encode.
- **The gates**: no figure under the ground, foot skate under 0.25 of body speed, cadence in the human band, two hands
  on the weapon in every clip, no kneeling while the unit moves. A new clip arrives with an input that makes each gate
  fail (`docs/agent-notes/falsification-casebook.md`).
- **The lead approves pose numbers before any render or Meshy call**, judges motion on the live site, and wants
  before/after GIFs of run, fire, kneel and turn for any change to infantry GLBs.
- **No status marks in the world**; posture and spacing carry the read.
- **Flow fields only**; no per-unit A*. Urban wall-hugging is a figure-slot offset or a field cost, not a path search.

---

## Sources

External:

- [S1], [S2], [S3] ATP 3-21.8 (2024), HTML mirror (formations and techniques):
  https://infantrydrills.com/manuals/fm-atp-3-21-8-infantry-rifle-platoon-squad-2024/movement-and-maneuver/tactical-movement-approach-march/
- [S7] FM 7-8 (1992) chapter 4, battle drills: https://550cord.com/infantry-rifle-platoon-squad-fm-7-8/fm-7-8-chapter-4-battle-drills/
- [S10] STP 21-1-SMCT task 071-326-0502: https://prepare-and-protect.net/2013/12/move-under-direct-fire
- [S14] Majumdar et al. (2010), Ergonomics 53(6): https://doi.org/10.1080/00140131003672015
- [S15] Attwells et al. (2006), Ergonomics 49(14): https://doi.org/10.1080/00140130600757237
- [S16] Harman et al. (2000), USARIEM: https://apps.dtic.mil/sti/html/tr/ADA377886/
- [S17] Huang and Kuo (2014), J Exp Biol: https://pmc.ncbi.nlm.nih.gov/articles/PMC3922835/
- [S25] Lower trunk motion and speed-dependence during walking, table 1:
  https://jneuroengrehab.biomedcentral.com/articles/10.1186/1743-0003-6-9/tables/1
- [S28g] Wikipedia, *Namer*: https://en.wikipedia.org/wiki/Namer
- [S30] FM 3-06.11 (2002) full text:
  https://archive.org/stream/Coed_Arms_Operations_in_Urban_Terrain_FM_3-06.11/Combined_Arms_Operations_in_Urban_Terrain_FM_3-06.11_djvu.txt
- [S30b] FM 3-06.11 ch 4 (tank danger arc), via search summary: https://www.globalsecurity.org/military/library/policy/army/fm/3-06-11/ch4.htm
- [S31] Task and Purpose, Army battle drills (dismount 30 s / 45 s): https://taskandpurpose.com/military-life/us-army-battle-drills/
- [S33a] Epic Games, *Pose Warping in Unreal Engine* (stride, orientation, slope warping):
  https://dev.epicgames.com/documentation/en-us/unreal-engine/pose-warping-in-unreal-engine
- [S33b] Epic Games, *Animation Sync Groups in Unreal Engine* (sync markers):
  https://dev.epicgames.com/documentation/en-us/unreal-engine/animation-sync-groups-in-unreal-engine
- [S34a] Bollo D (GDC 2018), *Inertialization: High-Performance Animation Transitions in Gears of War*:
  https://gdcvault.com/play/1025165/Inertialization-High-Performance-Animation-Transitions
- [S34b] Bollo D (SIGGRAPH 2017), *High Performance Animation in Gears of War 4* (60 % cheaper):
  https://history.siggraph.org/wp-content/uploads/2022/09/2017-Talks-Bollo_High-Performance-Animation-in-Gears-of-War-4.pdf
- [S35] Clavet S (GDC 2016), *Motion Matching and The Road to Next-Gen Animation*:
  https://gdcvault.com/play/1022985/Motion-Matching-and-The-Road
- [S36] Rosen D (GDC 2014), *Animation Bootcamp: An Indie Approach to Procedural Animation*:
  https://gdcvault.com/play/1020049/Animation-Bootcamp-An-Indie-Approach
- [S37a] Monmouth University, *Movement: Walk Cycle* (Williams-style timing table): https://animation.monmouth.edu/instruct/?p=351
- [S37b] AWN forum, frames per step for human runs: https://www.awn.com/comment/1008092
- [S37c] AnimSchool blog on walking "on 12s": https://blog.animschool.edu/?p=588
- [S38] Eurogamer interview with Samwise Didier (StarCraft II silhouettes from the three-quarter view), via Blizzplanet:
  https://www.blizzplanet.com/blog/comments/eurogamer_interviews_samwise_didier
- [S39] Company of Heroes suppression and pinned states (community documentation, not official):
  https://cohstats.com/stats/coh-stats.com/Info_Suppression.html and https://www.coh2.org/topic/21032/title/post/188012

Game (main, 9 Nov 2026; paths relative to `/Users/ilpinto/dev/roaring-lions`):

- `packages/sim/src/tuning.ts` (kneel, bounds, suppression, pin, rout, wound crawl, aim cap)
- `packages/sim/src/sim.ts` (`TICKS_PER_SECOND`, `disembark`, `stepTransport`)
- `data/units/kdf/*.json`, `data/units/enemy/*.json` (speeds, crew, figures)
- `data/formations/attack.json`, `packages/sim/src/formation-template.ts` (spacing, pace)
- `packages/render/src/clip.ts`, `packages/render/src/sheet.ts` (clip names and choice)
- `packages/render/src/three/units/squad-motion.ts`, `squad-rig.ts`, `stance.ts`, `mesh-anim.ts`
- `tools/units/rig.py`, `tools/units/teams.py`, `tools/src/meshes/motion/pinned.ts`, `tools/src/mesh_gait.test.ts`
- `docs/agent-notes/mesh-units.md`, `docs/agent-notes/sim-and-orders.md`
- The lead's standards (auto-memory): `infantry-motion-standard.md`, `infantry-squad-design-rules.md`,
  `no-status-marks-in-the-world.md`
