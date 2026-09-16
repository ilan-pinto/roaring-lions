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
