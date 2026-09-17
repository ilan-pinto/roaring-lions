# Infantry gait and facing — design

**Date:** 2026-09-15
**Status:** approved (project lead, "proceed")
**Supersedes nothing. Extends:** `2026-08-28-mesh-unit-contract.md` (one new, optional scene-level extra).

---

## 1. The complaint

> "The infantry walk and shooting are funny; in many cases, they are walking
> backward or shooting with their faces not in front of the gun. Also, they
> walk nonchalantly instead of running. That's also true to the militia forces."

Three distinct defects sit behind that sentence. All three were measured on the
running game and on the shipped bytes before this document was written; none of
them is a guess.

---

## 2. What was measured

### 2.1 Facing — per figure, head bone to its own face vertices

Method: for each figure in a loaded team, take the vertices of the `face` role
mesh whose dominant skin influence is that figure's own head joint, skin them
through the live clip, centroid them, and measure the ground-plane bearing from
that head joint. Compare against the unit's own sim `facing`. Positive is the
figure's left. Sampled 4–10 instants per clip, `?sandbox=beit_sahwan_outskirts&sur`.

| type | file | idle | move | fire | down |
|---|---|---|---|---|---|
| `inf_squad` | `meshy_soldier.glb` | **−67** (sweeps +23 → −159) | −5 | **−156** | **−163** |
| `sarim_rifles` | `sarim_rifles.glb` | +11 | +10 | +11 | +10 |
| `militia_cell` | `militia_cell.glb` | +9 | +8 | +9 | — |
| `rpg_team` | `rpg_team.glb` | +9 | +9 | +9 | — |
| `at_team` | `at_team.glb` | +6 | +6 | — | — |
| `atgm_cell`, `mortar_crew` | — | +3 | +3 | — | — |
| `charge_squad` | `charge_squad.glb` | ~0 | +1 | ~0 | — |
| `mortar_team` | `meshy_mortar_team.glb` | +3 (range −69…+94) | ~~**+84**~~ **see §2.1a** | −14 | — |

The **+3…+11 band is not a defect**: `kit.py`'s `figure()` yaws the head off the
body axis by `head_turn = 0.18 * hand` (10.3°) on purpose — contrapposto, "a
head square to the shoulders is a machine stance". Anything inside ±15° is that,
and is left alone.

Two real defects fall out:

- **`inf_squad` faces backward in `idle`, `fire` and `down`.** Only `move` is
  correct. A KDF rifleman standing still rotates roughly 180° over 3.67 s and
  loops; one that is shooting faces 156° away from what it is shooting at; one
  that is suppressed goes to ground facing backward.
- **`mortar_team` marches backward.** See §2.1a — the number first recorded
  here was wrong, and so was the mechanism.

### 2.1a Correction — the mortar crew, and a trap in §2.1's own method

**This section was written after Task 4 and it retires what §2.1 and §3.6
originally claimed.** Both were wrong, and the way they were wrong is worth
more than the defect was.

§2.1 recorded `mortar_team` holding an identical **+84°** across three figures
in `move`, and §3.6 explained it as "`move` keys no crew-served figure at all,
so what `move` shows is the rest pose". Neither survives measurement:

- **The bearing was read off a rig scaled to zero.** In `move`, this file keys
  `f0_head`, `f0_chest`, `f0_abdomen` and `f0_root` — and their `f1`/`f2`
  twins — to scale exactly `(0,0,0)` at all 17 keyframes, while the standing
  chain is keyed to 1. That chain (`STAND_CHAIN` in
  `import_meshy_mortar_team.py`) carries **no head bone at all**, so the only
  joints the head pattern can match are the kneeling heads, which in this clip
  have zero world scale. Every `face` vertex collapses onto a blend of
  collapsed joint translations and the bearing measures nothing that is on
  screen. On the bytes it reads +87.7 / −139.5 / −101.2, before and after —
  not the "identical +84" first recorded, which could not be reproduced by any
  route.
- **`move` is fully keyed and walks.** 17 keyframes on the standing rig, ratio
  **0.996**. §3.6's premise was simply false.
- **The real defect was 180°, not 84°: the limbered crew marched backward**,
  and `classify_standing` had painted the skin ramp on the backs of three
  heads.

**The proof is non-circular, and that is the point.** The obvious check is
circular — the `face` role *is* the −Y half of each head, so the role
assignment and the facing measurement share one assumption and agree whichever
way the sculpt points. The `boot` role does not: it is classified by HEIGHT,
never by a half-space, and a boot's toe protrudes forward of its own ankle.
Measuring each standing figure's boot centroid against its own ankle, in the
pre-`forward_fix` space the vertices live in, against `meshy_soldier.glb` as a
known-correct control:

| file | boot centroid − ankle |
|---|---|
| `meshy_soldier.glb` (control) | dZ **+0.022…+0.065** |
| `meshy_mortar_team.glb` after | dZ **+0.017…+0.027** |
| `meshy_mortar_team.glb` before | dZ **−0.017…−0.027** |

Both files carry `FORWARD_FIX_DEG = 90.0`, which carries pre-fix `+Z` to the
contract's `+X`. So before the fix the toes pointed at −X. The left/right
vertex groups also swap, which is the signature of a 180° yaw and of no other
rotation.

**The generalisable lesson, and it binds §3.5's gate.** §2.1's method — read a
head joint's bearing and believe it — **will report a confident number for any
two-posture rig's hidden side**, which is every `rig.py` team in `down` and
`wreck`, since those swap between a living root and a `death_root` by scale.
`measureFacing` now carries a `hiddenInClip` flag, true only when a joint's
world-matrix basis stays collapsed across every sample, so a reading taken off
an invisible figure is visible as such rather than silently authoritative.
Bone LENGTH lives in the child's translation rather than in scale, so a
physically small bone cannot trip it.

### 2.2 Gait — boot travel against ground covered

Method: `tools/src/mesh_gait.ts`, which already exists (GH-145). It skins the
`boot` role mesh with the clip's own animated joints and reports peak-to-peak
vertex travel over one `move` cycle, against `speed_tiles_s × clipSeconds ×
MESH_UNITS_PER_TILE`. A ratio of 1.0 means the feet exactly keep up with the
ground. Everything below is that ratio, measured off the shipped GLBs.

| type | file | speed (tiles/s) | cycle | ground | boot travel | **ratio** |
|---|---|---|---|---|---|---|
| `mortar_team` | `meshy_mortar_team.glb` | 0.65 | 0.67 s | 1.30 m | 1.28 m | **0.987** |
| `at_team` | `at_team.glb` | 0.70 | 0.67 s | 1.40 m | 1.15 m | 0.824 |
| `demo_squad` | `demo_squad.glb` | 0.85 | 0.67 s | 1.70 m | 1.15 m | 0.679 |
| `rpg_team` | `rpg_team.glb` | 0.90 | 0.67 s | 1.80 m | 1.15 m | 0.641 |
| `militia_cell` | `militia_cell.glb` | 0.95 | 0.67 s | 1.90 m | 1.15 m | 0.607 |
| `breach_team` | `breach_team.glb` | 0.95 | 0.67 s | 1.90 m | 1.15 m | 0.607 |
| `sniper_team` | `sniper_team.glb` | 0.45 | 1.00 s | 1.35 m | 0.74 m | 0.545 |
| `civilians` | `office_worker.glb` | 0.80 | 1.03 s | 2.48 m | 1.10 m | 0.445 |
| `civilians` | `farm_worker.glb` | 0.80 | 1.03 s | 2.48 m | 1.06 m | 0.428 |
| `yahalom_squad` | `yahalom_engineer.glb` | 0.85 | 1.04 s | 2.66 m | 1.02 m | 0.384 |
| `civilians` | `civilian_woman.glb` | 0.80 | 1.03 s | 2.48 m | 0.95 m | 0.382 |
| `sarim_rifles` | `sarim_rifles.glb` | 0.90 | 1.04 s | 2.81 m | 0.93 m | 0.332 |
| `charge_squad` | `charge_squad.glb` | 1.90 | 0.67 s | 3.80 m | 1.22 m | **0.321** |
| `inf_squad` | `meshy_soldier.glb` | 0.90 | 1.04 s | 2.81 m | 0.89 m | **0.315** |
| `civilians` | `civilian_child.glb` | 0.80 | 1.03 s | 2.48 m | 0.73 m | 0.295 |
| `sarim_rifles` `moveFire` | — | 0.90 | 3.25 s | 8.78 m | 0.66 m | **0.075** — see §4a |

Three files are legitimately near zero and are **not** defects: `atgm_cell`,
`mortar_crew` and `digger_crew` ship a degenerate 0.04 s `move` with no leg
keys at all, because `teams.py`'s crew-served figures carry `animates: False`
("crew-served weapons stay deployed through move"); and `moto_rpg` is a
motorcycle, whose wheels turn while its riders' boots do not.

**This is the whole of "walking nonchalantly".** The legs describe a third to
two-thirds of the ground the body actually crosses, so the figure glides.
`charge_squad` is the worst case that is not an outright bug: it moves at
1.9 tiles/s — 5.7 m/s, a hard sprint — playing the same 0.67 s stroll every
other kit team plays.

Note also the scale of the speeds. One tile is 3 m (`MESH_UNITS_PER_TILE`), so
0.9 tiles/s is **2.7 m/s**. Every rifleman in this game is already moving at a
run. Nothing needs to move faster; the animation needs to admit what the
movement already is.

### 2.3 Three facts about the runtime that the above depends on

- `ThreeRenderer.updateMeshUnits` calls `entity.mixer.update(dtSeconds)` and
  **sets no `timeScale` anywhere**. Every clip plays at its authored rate
  regardless of how fast the unit is actually moving.
- ~~`cadenceScale` (`packages/render/src/clip.ts`, `ROUT_CADENCE = 1.6`) exists
  and **no three.js code reads it**. A routed unit on the default backend runs
  at exactly the same cadence as a calm one.~~ **FALSE, and corrected after
  Task 6 measured it.** `three/units/frame-state.ts` already composes
  `walkFps(anim.speed, n) * cadenceScale(anim)` for every BILLBOARD unit on
  three.js — and `walkFps` is itself a rate match, so a billboard's legs have
  always followed its ground speed. What had never been rate-matched, and what
  this milestone is actually about, is the **MESH** path. The correction
  matters beyond bookkeeping: it is the reason §3.4's multiply is right rather
  than merely specified, because a routed mesh rifleman and a routed billboard
  standing beside him would otherwise disagree in the same frame.
- `resolveClip` already outranks `move` with `fire`, and `firingTimer` latches
  for the fire clip's full duration (0.5 s for these rigs) against a rifle
  firing every 0.19 s — so a squad in contact holds `fire` continuously. On
  `inf_squad` that is the backward-facing pose, and the body still slides along
  its path. That combination is what reads as "walking backward".

---

## 3. Design

Five changes. The sim is not touched by any of them: no new state, no new
event, no tuning constant, **no determinism-hash movement**. Everything is
art-pipeline and renderer.

### 3.1 D1 — `meshy_soldier.glb` stops facing backward

`import_meshy_soldier.py` binds `idle` to the supplied
`Gun_Hold_Left_Turn.glb`, which is what its name says: a figure holding a gun
that **turns left**, through roughly 180°, over the clip. Measured head bearing
holds at +23° until at least 1.1 s and reaches −159° by 2.9 s.

`build_fire_src` and `build_down_src` both take their base pose from
`idle`'s **last frame**, so both inherit the far end of that turn. That is the
whole root cause, and it is one mechanism producing three broken clips.

The fix is to establish the pre-turn hold as the base:

1. Measure, at build time, the frame window over which the source clip's
   forward bearing stays within a tolerance of its own opening bearing. This is
   a measurement the script performs and prints, not a hand-entered frame
   number.
2. Trim `idle` to that window (it loops, so a held stance is correct and is
   what `idle` already claims to be).
3. Take `build_fire_src`'s and `build_down_src`'s base pose from **inside** that
   window rather than from `frame_range[1]`.

`wreck` is deliberately **not** changed. It samples the last frame of
`Shot_and_Blown_Back`, and a body thrown round by the round that killed it is a
corpse lying where the blast put it, not a facing bug. Its −166° is recorded
here so the next reader does not "fix" it.

### 3.2 D2 — bind the run clips that are already on disk

Six rigs ship a `Running` animation that nothing plays:

| rig | source file | binds to |
|---|---|---|
| KDF soldier | `Running_withSkin.glb` | `move` |
| KDF soldier | `Run_and_Shoot_withSkin.glb` | `moveFire` |
| Sarim irregular | `Running_withSkin.glb` | `move` |
| civilian ×4 | `Animation_Running_withSkin.glb` | `move` |

The blocker recorded against all of these — GH-152, and the Sarim entry in the
task queue — was that binding a run needs a "fleeing" signal the sim does not
have. **That blocker does not apply once the speeds above are read.** These
units do not have a walk speed and a run speed; they have one speed, and it is
2.4–2.7 m/s. `move` *is* the run. No sim signal is required, and GH-152 can be
closed by this change rather than deferred behind it.

`Side_Shot` stays unbound on both rigs (measured hit reactions, not firing
poses — both import scripts already document this trap).

### 3.3 D3 — the kit gait gets a stride sized from each team's own speed

`tools/units/rig.py`'s `build_move_clip` authors one gait for all fourteen kit
teams: `A_THIGH = 0.55` rad of thigh swing on a ~0.85 m leg, about a 0.88 m
step, at a fixed 16-frame cycle. That is a brisk march and it is the same march
whether the unit moves at 0.45 tiles/s (`sniper_team`) or 1.9 (`charge_squad`).

The rig gains a per-team stride target derived from that team's own
`mobility.speed_tiles_s`, read from the unit JSON rather than restated:

- Stride amplitude (`A_THIGH`, the shin/settle terms that follow it, arm swing,
  and `MOVE_LEAN`) scales toward the step length the unit's speed implies.
- Stride growth is **capped**, because thigh swing saturates — a step is
  `2 · L · sin θ`, so past roughly 0.7 rad the return on more rotation collapses
  and the figure reads as lunging rather than running.
- Whatever the cap leaves unmet is taken up by **cadence**, which §3.4 supplies
  at runtime. This is also what a real sprinter does: a longer stride *and* a
  faster one.

So the division of labour is: **the rig owns stride; the renderer owns
cadence.**

The forward lean rises with speed as well. A run without lean reads as a fast
walk no matter what the legs do.

### 3.4 D4 — playback matched to measured ground speed

**The GLB declares its own gait.** A post-export pass, `pnpm gait:meshes`
(`tools/src/meshes/gait-pass.ts`), walks every rigged `art/meshes/**.glb`,
measures each locomotion clip with `mesh_gait.ts`'s existing instrument, and
writes the result into the scene's glTF `extras`:

```
rl_gait: { "move": { "strideM": 1.28, "cycleS": 0.667 }, "moveFire": { … } }
```

This mirrors `tools/src/meshes/wreck-pass.ts` exactly — idempotent,
re-runnable after any re-export, one implementation of the measurement rather
than a second copy in Python. `GLTFLoader` surfaces scene extras as
`gltf.scene.userData`, which `buildMeshUnitTemplate` already holds.

**The renderer rate-matches.** Per frame, for a unit playing a locomotion clip:

```
clipGroundSpeed = strideM / (cycleS · MESH_UNITS_PER_TILE)   // tiles/s
timeScale       = entitySpeed / clipGroundSpeed
```

then multiplied by `cadenceScale` (so `ROUT_CADENCE` finally reaches the
three.js backend) and clamped to a sane band. The clamp is a runtime guard, not
the mechanism: shipped art is expected to land near 1.0, and §3.5 is what keeps
it there.

Consequences worth stating:

- A unit slowed by terrain or crowding slows its legs. Today it plays a
  full-cadence walk while crawling.
- A GLB with no `rl_gait` keeps `timeScale = 1` — exactly today's behaviour, so
  a hand-authored fixture or an un-passed re-export is never made worse.
- Clips that are not locomotion (`idle`, `fire`, `down`, `work`, `wreck`) are
  never rate-scaled. Only `move` and `moveFire`.

### 3.5 D5 — the gate covers every rig, and gains a facing check

`tools/src/mesh_gait.test.ts` today measures **`mortar_team` alone** — the one
file GH-145 was raised against — which is why fourteen sliding rigs shipped
green. It is extended to iterate `RIGGED_UNIT_MESHES`, and gains a second
check.

**Gait check.** For every rigged type, the post-rate-match residual must sit
inside a band around 1.0. Exempt, by name, printed on the passing path the way
`validate:meshes` already prints its `NOT palette-checked` line:
`atgm_cell`, `mortar_crew`, `digger_crew` (crew-served, deliberately no gait)
and `moto_rpg` (a motorcycle). The gate also compares each file's **declared**
`rl_gait` against its own fresh measurement, so a re-export that skipped
`pnpm gait:meshes` fails loudly instead of silently rate-matching to a stale
stride.

**Facing check.** Per figure, per clip: the head-joint-to-own-face-vertices
bearing, against the contract's +X. Gated for `idle`, `move`, `fire`, `down`,
`work`, `moveFire`; **exempt** for `wreck`/`wreckAlt`, which are corpses.
Tolerance is set from the measured contrapposto band (§2.1) with margin, well
clear of the 84° and 156° defects it exists to catch.

One negative result is load-bearing and must not be re-derived the expensive
way. **Whole-mesh centroid pairs do not measure facing.** Taking the `face`
mesh centroid against the `uniform` mesh centroid — the obvious rig-agnostic
metric, needing no bone names — was implemented and measured, and it is
dominated by pack, keffiyeh and weapon-side asymmetry rather than by heading:
it reports `inf_squad`'s *correct* `move` at −86° (true value −5°) and
`sarim_rifles`'s `moveFire` at +148° (true value +42°). The per-figure
head-joint method is the one that works, and it is what §2.1's table was
produced with.

### 3.6 D6 — `mortar_team` marches backward

~~The three figures hold an identical +84° in `move` and spread across −69…+94
in `idle`. `move` keys no crew-served figure at all, so what `move` shows is
the rest pose.~~ **Both halves of that were false and §2.1a retires them.** The
+84 was read off a rig keyed to zero scale, and `move` is fully keyed — 17
keyframes on the standing chain, walking at ratio 0.996.

What is actually wrong: **the limbered crew marches 180° backward**, proved
against the `boot` role's toe-versus-ankle offset, which shares no assumption
with the `face` role the first reading depended on. `classify_standing` had
painted the skin ramp on the backs of three heads.

Turn the limbered crew to face its own line of travel, and leave `idle`
splaying them around the tube, which is correct for a deployed weapon.

---

## 4. Out of scope

- **Any sim change.** No fleeing state, no speed rebalancing, no new event. The
  determinism golden hash must not move, and `pnpm balance` and `pnpm playtest`
  must be byte-identical.
- **Civilian movement speed.** 0.8 tiles/s is a jog and that is a design
  question for the project lead, not something to settle inside an animation
  fix. Binding the supplied run clip is the honest rendering of the speed that
  exists.
- **Texturing infantry.** Still the lead's call; the Sarim entry in the task
  queue keeps it.
### 4a Correction — `sarim_rifles`'s `moveFire` came back into scope

**Written after Task 5, and it retires the out-of-scope entry below.** §4
declared the militia's walk-and-shoot out of scope as "bladed but not broken".
That was right when it was written and wrong the moment Task 3 landed: rebinding
that unit's `move` to the supplied run left `moveFire` on the walk, so the same
fighter ran when moving and **crept at 0.2 m/s** when moving and firing. This
milestone caused that, so this milestone fixed it.

The number that forced it: the declared gait implied a **13.27× playback
multiplier** against a next-worst of 2.60 anywhere in the tree — a 3.25 s clip
finishing in 245 ms. Widening the runtime clamp far enough to absorb that would
have disabled rate-matching for every other unit in the game.

`moveFire` is now synthesized from the run, so it declares the same stride and
cycle as `move` — the same legs — and needs **1.244×**. The weapon axis is
inherited whole from the supplied firing pose and did not move (−1.92°, on the
axis a tracer flies down). The face came square with the run rather than blading
with the walk: **+41.8° → +15.5°**, against `move`'s own +14.8°, which is the
smallest face-to-weapon gap of any firing clip in the tree (−1.82°).

Two things learned that bind §3.5's gate. **Nothing in this tree could see a
mismatch BETWEEN two clips of one file** — every check judges one clip at a
time, against its unit's speed, so `move` and `moveFire` disagreeing by a factor
of ten was invisible. And the KDF rifleman's arm-chain aim solve **does not
transfer** to this rig, because the offset here lives in the torso: applied
directly it diverges on 4 of 16 frames and drives the hands past the figure's
own arm reach.

- ~~**`sarim_rifles`'s `moveFire` blade.** Measured +42° — a genuine supplied
  walk-and-shoot mocap, bladed but not broken. Recorded, not changed.~~
  **Retired — see §4a. It came back into scope because this milestone broke it.**
- **`moto_rpg` wheel-spin rate-matching.** Its wheels should arguably scale with
  speed the way legs now do. Recorded as follow-up.
- **Vehicle and turret animation.** Untouched.

---

## 5. What will move, and how it is judged

Roughly twenty GLBs change. That touches three gates, and each is expected to
move for a stated reason rather than being widened:

- **`pnpm validate:meshes`** — silhouette IoU is computed from a rendered pose.
  A changed rest/stride pose moves it. Expected to pass; if a collision appears
  it is a real finding about two teams becoming more alike, not a threshold to
  raise.
- **`pnpm test`** — `mesh_gait.test.ts` is rewritten by D5 and is the gate that
  should go red before the work and green after.
- **The visual gate** — `quiet` and `open-ground` frame infantry, so the
  baselines will move. Bless from **CI numbers**, with the reason written into
  `manifest.json`, and download the bless artifact and look at the picture.
  Never widen a threshold to clear it.
- **Load time** — run clips are additional animation data. `pnpm perf:load`
  before and after; report the delta rather than assuming it is free.

---

## 6. How it is judged on screen

Numbers settle whether the feet keep up. They do not settle whether it looks
right, and this project's own record is that the lead judges motion on screen.
So the deliverable includes a capture sheet: each affected type, walking and
firing, before and after, at gameplay zoom **and** at 2.5×, in one image per
type — the same shape `tools/src/perf/wreck-captures.ts` produced for the
vehicle wrecks.

---

## 7. Deviations — where the implementation departed from this document

Written 2026-09-16, at the end of the eight-task plan. Everything above is the
design as approved, with §2.1a, §2.3 and §4a already corrected in place where
the work falsified them. This section is the complete list of divergences,
those corrections included, so a reader who has only the spec knows what
shipped. Each entry is what the spec said, what shipped, and the measurement
that decided it.

### D-1. §2.1's `mortar_team` defect was +84°, and the +84 did not exist

**Shipped:** the defect was **180°** — the limbered crew marched backward,
because `classify_standing` had painted the skin ramp on the backs of three
heads.

**Why:** the +84 was a bearing read off a rig keyed to scale `(0,0,0)`. In
`move` that file keys `f0_head`/`f0_chest`/`f0_abdomen`/`f0_root` and their
`f1`/`f2` twins to zero scale at all 17 keyframes, and the standing chain that
IS drawn carries no head bone at all, so the head pattern could only match
invisible joints. On the bytes it reads +87.7 / −139.5 / −101.2, not an
identical +84, and no route reproduces the number first recorded. §3.6's
explanation — "`move` keys no crew-served figure at all, so what `move` shows
is the rest pose" — was false in both halves: `move` is fully keyed and walks,
at ratio 0.996. Proved non-circularly against the `boot` role, which is
classified by HEIGHT rather than by a Y half-space and therefore shares no
assumption with the `face` role the first reading depended on. `measureFacing`
gained a `hiddenInClip` flag so a reading taken off an invisible figure is
visible as such rather than silently authoritative. Recorded in place as §2.1a.

### D-2. §2.3's "no three.js code reads `cadenceScale`" was false

**Shipped:** the multiply, for the reason the spec gave — but the premise was
wrong. `three/units/frame-state.ts` has always composed
`walkFps(anim.speed, n) * cadenceScale(anim)` for every BILLBOARD unit on
three.js, and `walkFps` is itself a rate match. Billboard legs have followed
their ground speed since long before this milestone; what had never been
rate-matched is the MESH path.

**Why it matters beyond bookkeeping:** it is what makes §3.4's multiply right
rather than merely specified. Not multiplying would put a routed mesh rifleman
and a routed billboard in the same frame disagreeing about how fast a broken
man's legs move, invisibly to every test. Corrected in place as §2.3.

### D-3. §2.1's "+3…+11 contrapposto band" is not the shipped band

**Shipped:** the facing gate's tolerances come from a sweep of the shipped
bytes, not from this document. On the bytes the `kit.py` teams' `move` means
span **−2.0 … +8.6**, and a band set from §2.1's quoted range would have redded
the shipped tree on day one.

### D-4. §3.1 asked for a trim; `fire` also got a root yaw and a real aim solve

**Shipped:** the hold-window trim, plus a build-time-computed **+22.90° yaw on
`Hips`**, plus an arm-chain aim solve on `fire` alone.

**Why:** trimming alone left `fire`/`down`/`idle` near +21°, because the
supplied hold stance is **48° bladed** and no trim can touch that. The yaw is a
rigid rotation of the whole figure, so it cannot create a face-to-weapon
misalignment — it only decides which end of a pre-existing one reads zero. The
gap was already there at the fork point (face −156.0, weapon +163.4) and both
ends were backwards, so nobody could see it. The three options were exactly
determined: trim only gives face +22.3 / weapon −10.4; yaw from the head gives
face −0.6 / weapon −33.3; yaw from the weapon gives face +33 / weapon ≈0. What
shipped is the head yaw **and** a 14.72° three-bone solve bringing the weapon
onto the aim axis in `fire`, taking that clip to face +0.3 / weapon +1.2, gap
0.4°. Independently confirmed on the geometry by PCA over the 3,248 `uniform`
vertices dominantly weighted to the firing hand: **−34.66° → +8.75°**, with
nothing else in the file moving by more than a tenth of a degree.

**`idle` and `down` keep the carry offset deliberately.** A soldier at ease or
gone to ground carries his rifle across his body, and neither clip draws a
tracer that contradicts it. `wreck` stays exempt for a second, stronger reason
than §3.1 gives: on a prone body the forward vector is nearly vertical, so its
ground projection is noise — the build-time probe and `measureFacing` disagree
by **40°** on that one pose against 1–3° everywhere else.

**One residual circularity is stated rather than hidden:** the bone proxy is
both the solve's objective and the gate's metric, and it is offset from the
geometry by 4.1° on `idle`, 4.2° on `moveFire` and **7.6° on `fire`**. The
shipped barrel sits near **+8.8°**, not the +1.2° the proxy reports. That is a
correct-looking aim and a 43° improvement; it is also the measured price of
gating a proxy.

### D-5. `LOOP_SEAM_DEG = 2.0` — a tolerance this document never named

**Shipped:** a second tolerance in `import_meshy_soldier.py` alongside the
hold-window one. `idle` LOOPS, and a 10° window puts a 7.1° head snap on the
seam every 1.4 s — a visible defect the design did not anticipate. Both numbers
are computed and printed on every build rather than hand-entered.

### D-6. §3.3 reasoned a 0.70 rad thigh cap; 0.85 shipped

**Shipped:** `THIGH_CAP = 0.85`.

**Why:** §3.3's argument is sine saturation — but `sin(0.85)/sin(0.70) = 1.17`,
so 17% of step is still available at 0.70, which means saturation is not what
binds. What binds is a **squat**: a four-point build-and-render sweep found the
figure sinking rather than shortening its step, and the renders are what
settled it. `charge_squad` stopping at gait ratio 0.430 IS the geometric
ceiling and not an unpushed cap: 1.00 rad reaches only 0.465, at a visible
crouch, and hip-to-ankle is 0.770 m against 3.80 m of ground per cycle. The
rest is cadence, which is what §3.4 supplies.

### D-7. §3.3 says "all fourteen kit teams". `sniper_team` is not one of them

**Shipped:** thirteen teams rebuilt through `rig.py`, plus a
`mesh_owner`/`MESH_KIT_OWNED` ownership table that makes a bulk export refuse
to write a file it does not own.

**Why:** `art/meshes/sniper_team.glb` comes from `tools/export_meshy_sniper.py`
and carries two photogrammetry figures. A bulk `export_mesh_team.py -- all`
would have replaced them with composed primitives, silently, with every gate
green afterwards. It was caught only because the implementer exported to a
scratch directory and diffed first. **The same trap was live in three more
places and one was worse:** `dozer_d9.glb` carries a `death_root`, five
`WRECK_` children, `idle`/`wreck` clips and a Meshy copyright, and the kit path
both deletes `WRECK_` objects before merge and exports with
`export_animations=False`. Closed inside this branch rather than queued, with
`tools/mesh_ownership.py` as the single place the idea is written down and pin
tests against the real exporters' own output paths. **A pipeline that names a
team is not proof it owns that team's file**, and a bulk export must never
write straight into `art/meshes/`.

### D-8. `strideM` is the forward component, not the 3-D travel

**Shipped:** `measureRoleFootprint(...).axisTravelM[0]`.

**Why:** the plan specified `maxTravelM`, the worst boot vertex's 3-D
peak-to-peak travel. §3.4 divides a declared `strideM` by `cycleS` and treats
the result as a GROUND speed, and a hypotenuse folds in vertical lift and
lateral swing. Measured forward fraction across the seventeen declarations:
0.985 down to **0.823** (`meshy_soldier`/`move`), rig-dependent, so no constant
downstream could correct it — `inf_squad` would have played at 1.268× where the
ground demands 1.541×, still under-running by 21%. Fixing it moved **every**
declaration down, by 1.47% to 17.70%, exactly the predicted band. The forward
axis was confirmed empirically on rigs from both pipelines rather than assumed,
because these rigs go through a post-export forward fix and a wrong axis would
mis-declare every file rather than fail loudly.

### D-9. `cycleS` names a cycle and measures a clip, and that is now checked

**Shipped:** the same number, plus `countTracePeaks` — a phase-aligned
periodicity check calibrated to read exactly 1 on all seventeen real
declarations and 2 or 3 on synthetic doubled and tripled traces, so it has a
positive control and not only a negative one. A clip that does not read as one
cycle WARNS by name rather than failing the pass, because a fresh heuristic
whose false positive silently blocked every future re-export would be worse
than a number a human has to look at once.

**Why:** peak-to-peak travel is invariant to cycle count and clip length is
not, so a future re-export baking two strides into one `move` would halve the
implied ground speed while every check stayed green — both sides of the
declared-versus-measured equality would still agree with each other, just not
with the ground.

### D-10. The skip rule is a measured floor, not "no `move` clip and no `boot`"

**Shipped:** `MIN_GAIT_TRAVEL_M = 0.1`.

**Why:** all four exempt files HAVE both a `move` clip and a `boot` role, so
the condition the brief gave would have skipped nothing. Headroom is wide:
`sniper_team` moves at 0.45 tiles/s and measures 0.7355 m against the floor,
and `moto_rpg` is the narrowest skip at 0.0547.

### D-11. §3.4's example clamp of 2.5 is wrong

**Shipped:** `GAIT_TIME_SCALE_MAX = 4`, `GAIT_TIME_SCALE_MIN = 0.05`, both
derived from the shipped declarations rather than chosen.

**Why:** 2.5 clips `yahalom_squad` at 2.645 — the unit with the single largest
correction to make — silently putting its slide back with every test green. The
reachable range for a unit whose legs are on the ground is **0.914×…2.645×**,
bounded from the sim rather than from observation (`stepMovement` never moves a
unit further than `type.stepPerTick` in a tick and the direction vectors are
unit vectors, so a diagonal is not faster). The floor is deliberately far below
anything either the art or the sim produces, because a LOW time scale is the
feature: a floor that bound during ordinary slow movement would re-introduce
the slide on exactly the units this milestone helps. The brief's example floor
of 0.5 would have done that — a live capture caught an `inf_squad` on its short
final step at 0.0585 tiles/s playing at **0.1002**, twice the shipped floor and
closing.

### D-12. A carried unit is excluded from rate-matching, which the spec did not anticipate

**Shipped:** `applyGaitRate` skips any unit with `carriedBy >= 0`.

**Why:** `Sim.stepTransport` overwrites a passenger's position with its
carrier's every tick, so a passenger's `entitySpeed` IS the vehicle's speed.
Measured live: a `sniper_team` in a `jeep_shoded` computes **13.53×**,
`yahalom_squad` 9.03, `inf_squad` 4.97, `sarim_rifles` in a `technical` 4.29 —
all clamped. Visually harmless (the figures are inside a hull) and
semantically fatal, because it made the invariant the gate rests on — "a clamp
doing real work means that mesh's gait is wrong" — false. Skipping is strictly
less change than clamping: it restores exactly the pre-milestone behaviour.
`garrisonedIn` and `tunnelIn` were deliberately NOT added; neither produces a
fictional speed, because a garrisoned or buried unit does not move and reads
`idle`.

### D-13. §3.5's gait check as specified could not fail

**Shipped:** the gate measures the playback MULTIPLIER, plus a cadence axis in
steps per second that this document never asked for.

**Why:** the spec asked for the post-rate-match residual to sit near 1.0. §3.4
computes `timeScale = entitySpeed / clipGroundSpeed`, so that residual is 1.0
by construction for any stride whatsoever, including none. The multiplier is
what nothing normalises. The cadence axis was added because **the multiplier is
not cadence**: `yahalom_squad` carries the larger multiplier (2.6454) at a
perfectly human 5.08 steps/s while `charge_squad` is at 7.45, and it is cadence
the eye reads. `cycleS` cancels out of it entirely
(`cadence = 6·speed/strideM`), making it a pure step-length check orthogonal to
the multiplier.

### D-14. §3.5's facing check grew instruments it did not name

**Shipped, beyond the per-figure head-joint bearing:** a `Head`→`headfront`
MARKER instrument for rigs that carry one, a weapon-axis PCA over the real
vertex cloud, a per-file two-instrument agreement check against a pinned
offset, a weapon-ELEVATION check, a per-FIGURE ground-coverage check, a
still-figure pin, and a swing-direction signature.

**Why, in order.** The marker cannot replace the centroid: it exists on 7
infantry GLBs and is **absent from 15**, and `rig.py` builds the kit head bone
as a VERTICAL segment, so those fifteen have no fallback ground-plane axis at
all — taking that recommendation at face value would have dropped coverage of
every `kit.py` team, the majority of the roster and the family the
`mortar_team` defect came from. The weapon axis exists because the head gate is
**self-satisfying** for `idle`/`fire`/`down` (the pose is yawed by the circular
mean of exactly the bearings the gate then tests) while the yaw does not
normalise the weapon axis at all; 7 of 7 injected defects raise and two are
catchable only by the weapon half. The elevation check exists because a
ground-plane bearing is blind to a rifle pointed 43° at the sky. The per-figure
check exists because a per-FILE check cannot see one figure of three going
still. And `move`'s weapon axis is deliberately NOT gated tightly: a running
soldier carrying a rifle one-handed at his side has a correct spread of 154.5°.

### D-15. §4 put `sarim_rifles`'s `moveFire` out of scope; this milestone put it back

Recorded in place as §4a. In short: rebinding that unit's `move` to the
supplied run left `moveFire` on the walk, so the same fighter ran when moving
and **crept at 0.2 m/s** when moving and firing — a **13.27×** playback
multiplier against a next-worst of 2.60, a 3.25 s clip finishing in 245 ms.
Widening the clamp to absorb it would have disabled rate-matching for every
other unit in the game. `moveFire` is now synthesised from the run and needs
1.244×. Two things learned bind §3.5: **nothing in this tree could see a
mismatch BETWEEN two clips of one file**, because every check judges one clip
at a time against its unit's speed; and the KDF arm-chain aim solve **does not
transfer** to this rig, because the offset lives in the torso — applied
directly it diverges on 4 of 16 frames and drives the hands past the figure's
own arm reach.

### D-16. Scope added at the project lead's request, after the eight tasks

`at_team` shipped a 1.357 m launcher and **no `fire` clip**, so an anti-tank
team stood motionless while a Spike left the tube. The cause is a reasoning
error rather than an oversight: `build_fire_clip` excludes figures whose weapon
is a free-standing ground mount, which is right — but this team's tube rides
`at_fire`'s forearm exactly like a rifle, so the objection does not apply.
`sniper_team` had three symptoms from one cause (`MOVE_FRAMES = 24` against
`rig.py`'s 16, a hardcoded swing that never read `speed_tiles_s`, and a
reversed swing signature — its foot is lowest at the BACK of the stride,
−0.180, where sixteen other clips read +0.113…+0.470), all closed by
reconciling `export_meshy_sniper.py` with `rig.py`.

**And the defect found while reviewing that work is the most transferable thing
on the branch.** `export_meshy_sniper.py` anchored metres-per-unit on **its own
previous output**, dividing two measurements that are not like-for-like — a
fixed multiplicative gain of 1.02489, not a fixed point. The sniper pair had
grown 1.670 m → 1.753 → 1.796 across three exports, 7.5% taller than every
other infantryman, and two more exports would have put them past 1.9 m. The
file's own comment said the declared and measured heights "are asserted to
agree at build time". **No such assertion existed.** Re-anchored to `kit.py`'s
own 1.67 m.

### D-17. §6's capture sheet: one image per CELL, and "before" is served live

**Shipped:** `tools/src/perf/gait-captures.ts` — 12 subjects × {`move`, `fire`,
`moveFire`} × {gameplay zoom, top of the zoom band} × {before, after}.

**Why not one composite image per type:** `wreck-captures.ts`, which §6 names
as the shape to follow, produces one PNG per cell (11 × 2 × 2 = 44), and this
tree has no compositing step. Following the precedent literally was preferred
to inventing one.

**Why the LIVE renderer rather than `tools/render_clip_pose.py`:** that script
frames the camera to the figure's own bounds, so "gameplay zoom" has no meaning
in it; it renders through the SPRITE rig rather than the lit three.js scene;
and it has no playback rate in it at all, so it cannot show §3.4. The
before-art reaches the running dev server by intercepting the `/meshes/*.glb`
fetches and answering them from `git show <fork>:assets/meshes/…`, which
touches no file in the tree — and the run refuses to finish unless at least one
intercepted file differed in length from the working tree, because a route glob
that stops matching yields a "before" sheet that is a second copy of "after"
and looks entirely correct.

**Two limitations, stated.** For the six rigs §3.2 rebound, `move` is a
different SOURCE CLIP before and after, so the shared phase fraction is a
convention rather than a correspondence; for the ten `kit.py` teams §3.3
rescaled it is a real correspondence — same authored sinusoid, same cycle,
larger amplitude. And **a still cannot show cadence at all**: the sheet shows
stride, lean, knee drive and where a figure points, and the playback rate is
carried as a number beside each cell rather than in the picture.

### D-18. Still open, deliberately

Recorded, not fixed, each with a measurement behind it: `charge_squad` needs
7.45 steps/s and wants a longer authored cycle for that team alone;
`office_worker`'s `face` role sits 13.3° off its own head axis;
`charge_squad`'s face-role centroid sits 0.57 m from its own head joint;
`yahalom_engineer` puts 8 vertices spanning 0.076 m on `RightHand` under the
`weapon` role, so that unit has no gateable weapon axis — and it ships no
`fire` clip either, which the capture sheet names on its passing path;
`atgm_cell` and `mortar_crew` mount their launcher and tube on `prop`, weighted
to no arm bone, with the same consequence; `rpg_fire` is the only STANDING
`animates=False` figure in the tree, so a man's boots never move while his
team-mate walks beside him; the elevation gate cannot see an off-level REST
pose; `import_meshy_soldier.py` is not byte-reproducible, so every re-export
produces a diff with no measurable change in it; and §4's `moto_rpg` wheel-spin
rate-match is still out of scope.
