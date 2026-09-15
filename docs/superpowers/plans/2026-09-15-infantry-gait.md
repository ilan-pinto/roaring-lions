# Infantry Gait and Facing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Infantry face the way they are shooting, and their legs keep up with the ground they cross.

**Architecture:** The rig owns stride, the renderer owns cadence. Art pipelines author a gait; a post-export pass measures it and writes it into each GLB's scene extras; the renderer reads that and scales playback by the unit's own measured ground speed. A rewritten gate measures both facing and gait across every rigged mesh, where it previously measured one file.

**Tech Stack:** TypeScript (strict, no `any`), headless Blender 5.2 via `/Applications/Blender.app/Contents/MacOS/Blender`, `@gltf-transform` for the post-export pass, vitest, three.js (only under `packages/render/src/three/**`).

**Spec:** `docs/superpowers/specs/2026-09-15-infantry-gait-design.md` — read it before Task 1. Its §2 tables are the measured baseline every task is judged against.

## Global Constraints

- **No sim change of any kind.** `packages/sim/**` is not edited. `pnpm test:determinism`, `pnpm balance` and `pnpm playtest` must produce byte-identical output before and after every task. If a task appears to need a sim change, stop and report — it is out of scope by the spec.
- **TypeScript strict, no `any`, no non-null assertions.**
- **`three` may only be imported under `packages/render/src/three/**`** (eslint-enforced; subpath imports like `three/addons/...` are not caught by the rule and must be kept inside by discipline).
- **`packages/render/src/renderer.ts` (Pixi) is frozen.** Do not touch it. Pixi owes no parity for any of this.
- **Never `git add -A`.** This working tree is shared with other sessions. Commit named paths only: `git commit -- <paths>`.
- **Use `/usr/bin/git` by absolute path, one plain git command per shell call.** No compound commands, no heredocs containing the word "git", no `cd` chains.
- **Never `git checkout -- <file>`** to undo an edit. Undo the edit.
- **Never kill a process you did not start.** No `pkill -f vite`. A dev server on port 5178 is already running from this worktree and belongs to the controller.
- **Never use `preview_start` in this worktree** — it is pinned to the launch directory and will serve the wrong tree. Run vite via Bash on port 5178/5179.
- **Blender:** `/Applications/Blender.app/Contents/MacOS/Blender --background --python <script>`. `mathutils.noise` is banned anywhere in this tree (nondeterministic per process).
- **`art/blend` is a symlink** to the main checkout's gitignored sources. Never commit it; never write into it.
- **Infantry GLBs carry zero materials.** Colour comes from the runtime role ramp. Do not add materials.
- **Do not widen a visual-gate threshold to clear a red run.** Bless with a stated reason, from CI numbers.
- **Commit trailer, verbatim:** `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- **You never dispatch subagents.** Review arrives from the controller after your report.

---

## File Structure

| File | Responsibility |
|---|---|
| `tools/src/mesh_gait.ts` | The measurement instrument. Already measures boot travel; gains facing measurement and a shared clip-sampling export. |
| `tools/src/mesh_gait.test.ts` | The gate. Today measures `mortar_team` alone; becomes tree-wide for gait and facing. |
| `tools/import_meshy_soldier.py` | KDF rifleman: fixes the backward base pose, binds `Running`/`Run_and_Shoot`. |
| `tools/import_meshy_soldier_irregular.py` | Sarim irregular: binds `Running`. |
| `tools/import_meshy_civilians.py` | Four civilian rigs: bind `Running`. |
| `tools/units/rig.py` | Kit gait: stride sized from each team's own speed; mortar crew rest pose. |
| `tools/src/meshes/gait-pass.ts` | **New.** Post-export pass writing `rl_gait` scene extras. Sibling of `wreck-pass.ts`. |
| `packages/render/src/three/units/mesh-anim.ts` | Pure arithmetic: gait types, `gaitTimeScale`. |
| `packages/render/src/three/units/mesh-unit.ts` | Reads `rl_gait` off the loaded scene into `MeshUnitTemplate`. |
| `packages/render/src/three/ThreeRenderer.ts` | Applies the time scale each frame. |
| `tools/src/perf/gait-captures.ts` | **New.** The before/after capture sheet. |

---

### Task 1: Facing measurement in the gait instrument

**Files:**
- Modify: `tools/src/mesh_gait.ts`
- Test: `tools/src/mesh_gait.test.ts` (add a describe block; leave the existing three tests untouched)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `export interface FigureFacing { readonly joint: string; readonly meanDeg: number; readonly minDeg: number; readonly maxDeg: number }` and `export function measureFacing(path: string, clip: string): FigureFacing[]`. Tasks 2, 3, 4 and 7 all call this. Degrees are ground-plane bearing from the head joint to its own face-mesh vertices, measured in the GLB's own frame where the contract's forward is +X, so 0 means "facing forward". Positive is the figure's left.

**Context you need:**

`mesh_gait.ts` already contains everything except the selection step: `readGlb`, `readAccessor`, `readClip`, `nodeWorlds` and the four-influence skinning blend inside `measureRoleTravel`. `readClip` and `nodeWorlds` are currently module-private. Export them, or factor the shared part out — your call, but do not copy the skinning maths into a second function. A second copy is the exact failure mode this project has recorded repeatedly: behaviour in two places, so neither copy can be broken alone.

Head joints are named `*_head` (the `kit.py` rigs: `mil0_head`, `at_fire_head`) or `*_Head` (the Meshy rigs: `f0_Head`). Both pipelines are in the tree and both must work.

For each head joint, select the `face` role mesh's vertices whose `JOINTS_0` component equals that joint's index **within the skin's `joints` array** with `WEIGHTS_0 > 0.5`, skin them, and centroid them. The bearing is `atan2(dz, dx)` of (centroid − head joint world position).

**Do not** measure facing from whole-mesh centroids. The spec's §3.5 records that measured negative result in full: `face`-centroid against `uniform`-centroid is dominated by pack and weapon-side asymmetry and reports `inf_squad`'s *correct* `move` at −86° against its true −5°.

- [ ] **Step 1: Write the failing test**

Add to `tools/src/mesh_gait.test.ts`:

```ts
describe('mesh unit facing', () => {
  it('reads the kit rigs at their authored contrapposto, not a defect', () => {
    // kit.py's figure() yaws the head off the body axis by 0.18 rad (10.3 deg)
    // deliberately -- "a head square to the shoulders is a machine stance".
    // Measured on the running game: every kit team sits at +3..+11.
    const figs = measureFacing(`${MESHES}militia_cell.glb`, 'move');
    expect(figs.length).toBeGreaterThan(0);
    for (const f of figs) expect(Math.abs(f.meanDeg)).toBeLessThan(20);
  });

  it('SEES the KDF rifleman firing backward -- the defect this instrument exists for', () => {
    // Pre-fix characterisation. Task 2 replaces this expectation with the
    // in-band one; until then it pins that the instrument can see the bug,
    // which is the only thing that makes the gate in Task 7 trustworthy.
    const figs = measureFacing(`${MESHES}meshy_soldier.glb`, 'fire');
    expect(figs.length).toBe(3);
    for (const f of figs) expect(Math.abs(f.meanDeg)).toBeGreaterThan(120);
  });

  it('reads the same rifleman walking CORRECTLY, so the reading is of the clip', () => {
    const figs = measureFacing(`${MESHES}meshy_soldier.glb`, 'move');
    for (const f of figs) expect(Math.abs(f.meanDeg)).toBeLessThan(20);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm exec vitest run tools/src/mesh_gait.test.ts`
Expected: FAIL — `measureFacing is not exported` / not defined.

- [ ] **Step 3: Implement `measureFacing`**

Export `FigureFacing` and `measureFacing` from `tools/src/mesh_gait.ts`. Sample the clip at `SAMPLES` instants the way `measureRoleTravel` does. Throw, with the file path and the role in the message, when the file has no `face` mesh or no such clip — an absent role is a contract failure, not a facing of zero. Document the +X convention and the "no centroid pairs" negative result in the function's own doc comment, with the −86°/−5° numbers, so the next reader does not re-derive it expensively.

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run tools/src/mesh_gait.test.ts`
Expected: PASS, all six tests (the three existing gait ones plus the three new ones).

- [ ] **Step 5: Prove the numbers against the live game**

Run, from the repo root:

```bash
npx tsx -e "import('./tools/src/mesh_gait').then(m=>console.log(m.measureFacing('art/meshes/meshy_soldier.glb','fire')))"
```

Compare against the spec's §2.1 table, which was measured independently in the browser: `inf_squad` `fire` should read near **−156**, `move` near **−5**. Agreement within a few degrees is the point — two independent instruments, one answer. Record both numbers in your report. A disagreement of more than ~10° means one of the two is wrong and must be resolved before any art is touched.

- [ ] **Step 6: Typecheck, lint, commit**

```bash
pnpm typecheck
```
```bash
pnpm lint
```
```bash
/usr/bin/git commit -m "tools: the gait instrument can measure which way a figure faces" -- tools/src/mesh_gait.ts tools/src/mesh_gait.test.ts
```

---

### Task 2: The KDF rifleman stops facing backward, and runs

**Files:**
- Modify: `tools/import_meshy_soldier.py`
- Regenerate: `art/meshes/meshy_soldier.glb`, `assets/meshes/meshy_soldier.glb`
- Test: `tools/src/mesh_gait.test.ts` (flip the characterisation expectation from Task 1)

**Interfaces:**
- Consumes: `measureFacing` from Task 1.
- Produces: a `meshy_soldier.glb` whose `idle`/`fire`/`down` face forward and whose `move` is a run, plus a new `moveFire` clip. Task 5 measures it; Task 7 gates it.

**Context you need:**

Read the module docstring of `tools/import_meshy_soldier.py` first — it is long and it is the authority on why each mechanism is shaped the way it is. Two of its recorded findings bound this task:

1. **Forward is fixed POST-export** on the glTF node graph (`FORWARD_FIX_DEG` / `apply_forward_fix`), never by baking a rotation into the Blender armature. `fix_forward` is a documented no-op and must stay one. Do not reach for it.
2. `CLIP_SEMANTICS` / `check_clip_semantics` gates each clip's Hips vertical travel at build time, and exists because two clips have already been bound to the wrong slot (`Side_Shot` → `fire`, `Shot_and_Blown_Back` → `down`). You are adding a third gate of the same kind.

The defect: `idle` binds the whole of `Gun_Hold_Left_Turn`, which turns roughly 180°. `build_fire_src` and `build_down_src` both take their base pose from `idle`'s **last frame** (`f0, f1 = idle_action.frame_range`, then `frame_set(int(f1))`). So one mechanism produces three broken clips.

Sources available and unbound, in `art/blend/KDF/soldier/Meshy_AI_lowpoly_mideast_soldi_biped/`:
`..._Animation_Running_withSkin.glb`, `..._Animation_Run_and_Shoot_withSkin.glb`.

- [ ] **Step 1: Measure where the turn begins**

Add a build-time measurement that walks `Gun_Hold_Left_Turn`'s frames and reports, per frame, the forward bearing of the `Head`→`headfront` marker pair projected on the ground plane, relative to the clip's own opening bearing. Print the table. Identify the last frame before the bearing departs by more than 10°.

Do not hand-enter a frame number from this run. The script must compute the window itself on every build, so a re-supplied source cannot silently shift it.

- [ ] **Step 2: Trim `idle` to the pre-turn hold**

`idle` loops, and a held stance is what `idle` means. Bind only the measured hold window.

- [ ] **Step 3: Re-base `fire` and `down`**

Change `build_fire_src` and `build_down_src` to take their base pose from inside that window rather than from `frame_range[1]`. Both functions already take `idle_action` as their base; the change is which frame of it they sample.

Leave `build_wreck_src` alone. Its −166° is a body thrown round by the round that killed it, and the spec records it as deliberate.

- [ ] **Step 4: Bind the run clips**

- `Running_withSkin.glb` → `move`, replacing `Walking.glb`.
- `Run_and_Shoot_withSkin.glb` → `moveFire`.

`moveFire` is an existing `ClipName` (`packages/render/src/sheet.ts`) already produced by `import_meshy_soldier_irregular.py`, and `resolveMeshMotionClip` already plays it. No renderer change is needed for it.

Add both to `CLIP_ORDER` and give each a `CLIP_SEMANTICS` entry. `Running`'s Hips travel will be well above `idle`'s — that is a run and is correct; set its ceiling accordingly rather than inheriting `move`'s old one blindly, and say in the entry's `means` what it means.

- [ ] **Step 5: Add a heading gate beside the Hips gate**

Extend `check_clip_semantics` so each clip's own forward bearing is checked, not only its vertical Hips travel. Raise loudly, naming the clip and both numbers, exactly as the Hips check does. Exempt `wreck` (and `wreckAlt` where a rig has one). This is what makes a third instance of this defect class unshippable.

- [ ] **Step 6: Re-export**

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background --python tools/import_meshy_soldier.py
```

This is slow — six 18.6 MB source GLBs imported into one session. Expect several minutes. If it fails on memory, report rather than restructuring the script's export strategy, which its own `export_glb` docstring explains at length.

- [ ] **Step 7: Verify with Task 1's instrument**

```bash
pnpm exec vitest run tools/src/mesh_gait.test.ts
```

Then flip the Task 1 characterisation test: `fire` must now read **inside** ±20°, like `move` already does, and `down` likewise. Rewrite that test to assert the fixed state and update its comment to say what it used to read (`−156`) and that Task 2 fixed it.

- [ ] **Step 8: Re-encode the shipped mirror**

```bash
pnpm encode:meshes
```

- [ ] **Step 9: Gates, then commit**

```bash
pnpm test
```
```bash
pnpm validate:meshes
```
`validate:meshes` takes 45–70 s and needs `art/meshes/` clean of stray files — `git status art/meshes/` first, because it walks that directory with no filter and another session's scratch `.glb` will fail your run.

```bash
/usr/bin/git commit -m "art(kdf): the rifleman faces what he is shooting, and runs" -- tools/import_meshy_soldier.py art/meshes/meshy_soldier.glb assets/meshes/meshy_soldier.glb tools/src/mesh_gait.test.ts
```

Include `assets/meshes/manifest.json` in the commit if `pnpm encode:meshes` changed it.

---

### Task 3: The Sarim irregular and the four civilians run

**Files:**
- Modify: `tools/import_meshy_soldier_irregular.py`, `tools/import_meshy_civilians.py`
- Regenerate: `art/meshes/sarim_rifles.glb`, `art/meshes/civilians/{civilian_woman,office_worker,farm_worker,civilian_child}.glb`, and their `assets/meshes/` mirrors

**Interfaces:**
- Consumes: `measureFacing` (Task 1); the `CLIP_SEMANTICS` heading-gate pattern established in Task 2 — copy that shape rather than inventing a second one.
- Produces: five GLBs whose `move` is a run.

**Context you need:**

Both scripts are siblings of `import_meshy_soldier.py` and inherit its mechanisms. `import_meshy_soldier_irregular.py`'s own docstring records `Running_withSkin.glb` as UNUSED with the note *"needs a 'fleeing' signal that does not reach the renderer — GH-152's blocker. Do not bind this until that signal exists."*

**That note is now overtaken and you are deliberately overriding it.** The spec's §3.2 is the reason: these units have one speed and it is 2.7 m/s, so `move` *is* the run and no fleeing signal is required to render it honestly. Update the docstring in the same commit — leaving a note that forbids what the file now does is worse than the note never existing.

The same applies to the four civilian rigs at 0.8 tiles/s (2.4 m/s) and to GH-152 itself, which Task 8 closes.

- [ ] **Step 1: Bind `Running` → `move` in the irregular import**

Add its `CLIP_SEMANTICS` entry with a ceiling that admits a run's Hips travel, and the heading check from Task 2.

- [ ] **Step 2: Bind `Running` → `move` for all four civilian rigs**

- [ ] **Step 3: Update both docstrings**

Replace the "do not bind this" notes with what is now true and why, citing the measured speeds.

- [ ] **Step 4: Re-export**

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background --python tools/import_meshy_soldier_irregular.py
```
```bash
/Applications/Blender.app/Contents/MacOS/Blender --background --python tools/import_meshy_civilians.py
```

- [ ] **Step 5: Verify facing did not regress**

Run `measureFacing` over all five files for `idle`, `move`, `fire` where present. The spec's §2.1 has `sarim_rifles` at +10..+11 across the board; it must stay in band. Record the civilians' numbers, which §2.1 does not cover — they are new baseline.

- [ ] **Step 6: Re-encode, gate, commit**

```bash
pnpm encode:meshes
```
```bash
pnpm test
```
```bash
pnpm validate:meshes
```
```bash
/usr/bin/git commit -m "art: the militia and the civilians run, because their own speed is a run" -- tools/import_meshy_soldier_irregular.py tools/import_meshy_civilians.py art/meshes/sarim_rifles.glb art/meshes/civilians assets/meshes
```

---

### Task 4: The kit gait takes its stride from each team's own speed

**Files:**
- Modify: `tools/units/rig.py`
- Regenerate: all fourteen `SUPPORTED_TEAMS` GLBs under `art/meshes/`, plus `assets/meshes/` mirrors

**Interfaces:**
- Consumes: `measureFacing` (Task 1).
- Produces: fourteen GLBs whose `move` stride is sized to their unit's speed, and a `mortar_team` that marches along its heading.

**Context you need:**

`build_move_clip` authors one gait for all fourteen teams from module constants (`A_THIGH = 0.55`, `B_SHIN`, `A_ARM_FREE`, `A_ARM_WEAPON`, `MOVE_LEAN = 0.14`, `BOB_AMP`, `SETTLE_AMP`, the `_settle_bump` terms) over a fixed `MOVE_FRAMES = 16` cycle. The spec's §2.2 shows what that costs: 0.321 at `charge_squad`'s 1.9 tiles/s, 0.607 at `militia_cell`'s 0.95.

Step length from a thigh swing is `2 · L · sin θ`, so θ saturates — past roughly 0.7 rad the figure lunges rather than runs and the return on more rotation collapses. **Cap the stride growth and let the renderer's cadence (Task 6) take up the rest.** That is also what a sprinter does: longer stride *and* faster.

Read each team's `mobility.speed_tiles_s` from its own unit JSON under `data/units/**`. Do not restate speeds in `rig.py` — a second copy of a number that lives in data is how these tables go stale.

`kit.py`'s `figure()` deliberately yaws the head by `head_turn = 0.18 * hand`. Leave it; the spec's §2.1 records +3..+11 as intended contrapposto, not a defect.

**Four lessons from Tasks 2 and 3, each of which cost real time there:**

- **A build-time gate can pass while the export is wrong.** Task 2 built a pose
  that solved cleanly, put the weapon on the axis and went green in Python,
  while the exported face read +15.2° against the arms-only +0.3° — because the
  rotation it used tilts the head rather than yawing it, and the two instruments
  diverge by 14° on a tilt. **Always re-measure the exported bytes with
  `measureFacing` and `measureRoleTravel`. Treat the Python numbers as a
  prediction, never a verdict.**
- **Check every source path resolves before planning around it.** The soldier
  script's `SRC_DIR` pointed at a directory that exists in no checkout, so that
  pipeline could not be run at all and nobody had noticed — no gate reads these
  scripts and the shipped GLB was the only evidence.
- **Two obvious measures of "is this limb still plausible" are wrong on these
  rigs.** A shoulder-to-hand distance is the arm's CHORD and grows as the elbow
  straightens, so it loosens in exactly the direction a bad pose pushes; and
  `data.bones[...].length` sums to 46.9 m on a 1.67 m figure, because the
  auto-rig's tails do not sit at the child joints. Summed joint-to-joint
  segments is the measure that works.
- **An endpoint test is not a bound.** Separation is not monotonic in the
  magnitude of a solve: Task 2 measured a pose that wrapped three joints most of
  the way round and came back INSIDE an endpoint cap because the hand swung past
  the far side. Sweep the path, do not sample its ends.

The mortar crew defect (spec §3.6): the three figures hold an identical **+84°** in `move` and spread across −69…+94 in `idle`. `move` keys no crew-served figure (`animates: False`), so what `move` shows is the rest pose. Fix the rest pose so the team marches along its heading; leave `idle`'s splay alone, which is correct for a deployed weapon.

- [ ] **Step 1: Read speeds from unit data**

Add a loader mapping team id → `speed_tiles_s`. `SUPPORTED_TEAMS` and the unit ids agree for the kit teams ("team id == unit type id == file basename" holds for `kit.py` teams, per CLAUDE.md). Raise loudly on a team with no unit JSON rather than defaulting — a silent default is how a wrong stride ships.

- [ ] **Step 2: Scale the gait from speed, with a cap**

Derive the stride terms from the target step length the speed implies, capped. Keep every existing constant as the value at the reference speed so the change is a scaling of known-good numbers, not a re-authoring from scratch. Raise `MOVE_LEAN` with speed — a run without lean reads as a fast walk no matter what the legs do.

- [ ] **Step 3: Fix the mortar crew's rest heading**

- [ ] **Step 4: Re-export all fourteen teams**

**This command as originally written would have destroyed shipped art, and that
is worth stating rather than quietly fixing.** `art/meshes/sniper_team.glb` is
NOT `rig.py`'s output — it comes from `tools/export_meshy_sniper.py` and
contains two photogrammetry figures — so `-- all` replaced them with composed
primitives. Task 4 caught it by exporting to a scratch directory and diffing
BEFORE writing into `art/meshes/`, which is the habit worth copying: **a
pipeline that names a team is not proof that it owns that team's file.** A
`SUPERSEDED_ELSEWHERE` guard now makes `rig.py` refuse it and `all` skip it by
name, so the command below is safe — but check the guard is still there before
trusting it, and never run a bulk export straight into `art/meshes/`.

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background --python tools/export_mesh_team.py -- all
```

- [ ] **Step 5: Measure every team, both ways**

For each of the fourteen: `measureRoleTravel(file, 'boot', 'move')` against `groundPerCycleM(speed, clipSeconds)`, and `measureFacing(file, 'move')`. Produce a table against the spec's §2.2 and §2.1 baselines and put it in your report. Ratios should have risen substantially; `mortar_team`'s `move` facing must have come inside ±20°.

The three crew-served teams (`atgm_cell`, `mortar_crew`, `digger_crew`) carry `animates: False` and a degenerate 0.04 s `move`, and `moto_rpg` is a motorcycle. All four should be **unchanged**. If any of them moved, you have scaled something that should not have been scaled.

- [ ] **Step 6: Re-encode, gate, commit**

```bash
pnpm encode:meshes
```
```bash
pnpm validate:meshes
```
Silhouette IoU is computed from a rendered pose, so a changed stride can move it. A collision here is a real finding about two teams becoming more alike — report it, do not raise the limit.

```bash
pnpm test
```
```bash
/usr/bin/git commit -m "art(kit): a team's stride is sized from its own speed, and the mortar crew marches forward" -- tools/units/rig.py art/meshes assets/meshes
```

---

### Task 5: The gait pass — every GLB declares what its own legs do

**Files:**
- Create: `tools/src/meshes/gait-pass.ts`, `tools/src/meshes/gait-pass.test.ts`
- Modify: `tools/package.json` (add `gait:meshes`), `package.json` (add the root passthrough)
- Regenerate: `rl_gait` extras in every rigged `art/meshes/**.glb`, plus `assets/meshes/` mirrors

**Interfaces:**
- Consumes: `measureRoleTravel` and `groundPerCycleM` from `tools/src/mesh_gait.ts`.
- Produces: scene-level glTF extras on every rigged mesh:
  `rl_gait: { [clipName: string]: { strideM: number; cycleS: number } }`, written for `move` and `moveFire` only. Task 6 reads it through `gltf.scene.userData`; Task 7 checks it against a fresh measurement.

**Context you need:**

`tools/src/meshes/wreck-pass.ts` is the precedent and this is its sibling: a post-export `@gltf-transform` pass, idempotent, re-runnable after any re-export, invoked by its own pnpm script. Read it before writing this one and follow its shape.

Why a pass rather than writing the numbers at export time: the measurement lives in `tools/src/mesh_gait.ts` in TypeScript, and the exporters are Python. A second implementation in Python would be two copies of one behaviour — the failure mode this project has been bitten by repeatedly.

Ordering matters and must be documented in the script's own header: **re-export (Blender) → `pnpm gait:meshes` → `pnpm encode:meshes`**. The pass writes into `art/meshes/`, the source of record; the encode mirrors it into what ships.

- [ ] **Step 1: Write the failing test**

```ts
it('writes a stride a later reader can use, and is idempotent', () => {
  // Run the pass twice over a copy of one shipped file; the second run must
  // produce byte-identical output. wreck-pass.ts's own test does this and it
  // is what makes a post-export pass safe to re-run after every export.
});

it('declares what the instrument independently measures', () => {
  // The declared strideM must equal measureRoleTravel's maxTravelM for the
  // same file and clip. This is the property Task 7's gate relies on.
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm exec vitest run tools/src/meshes/gait-pass.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pass**

Skip a mesh with no `move` clip and a mesh with no `boot` role, printing each skip by name on the passing path — the project's own convention (`validate:meshes` prints its `NOT palette-checked` line the same way). The four crew-served/motorcycle cases are expected skips, not errors.

- [ ] **Step 4: Run it over the tree**

```bash
pnpm gait:meshes
```

- [ ] **Step 5: Prove the extras survive Draco**

```bash
pnpm encode:meshes
```

Then read `rl_gait` back out of a file in `assets/meshes/` and confirm it is present and equal. This is a real risk, not a formality: `encode-meshes.ts`'s own header records that Draco quantisation is lossy and that three things in this tree read mesh geometry as though it were exact. If extras do not survive, report it — the fix is a decision (declare in both trees, or have the renderer read from `art/`), not something to improvise.

- [ ] **Step 6: Gate and commit**

```bash
pnpm test
```
```bash
/usr/bin/git commit -m "tools: every rigged mesh declares the stride its own legs describe" -- tools/src/meshes/gait-pass.ts tools/src/meshes/gait-pass.test.ts tools/package.json package.json art/meshes assets/meshes
```

---

### Task 6: The renderer matches playback to measured ground speed

**Files:**
- Modify: `packages/render/src/three/units/mesh-anim.ts`, `packages/render/src/three/units/mesh-unit.ts`, `packages/render/src/three/ThreeRenderer.ts`
- Test: `packages/render/src/three/units/mesh-anim.test.ts`, `packages/render/src/three/units/mesh-unit.test.ts`

**Interfaces:**
- Consumes: `rl_gait` extras from Task 5, reached through `gltf.scene.userData`.
- Produces: `MeshUnitTemplate.gait` and a pure `gaitTimeScale(...)`. Task 7 gates the band it produces.

**Context you need:**

`ThreeRenderer.updateMeshUnits` calls `entity.mixer.update(dtSeconds)` and sets no `timeScale` anywhere today. `this.entitySpeed[i]` is already maintained (`Math.hypot(dx, dy) * SIM_HZ`, measured ground speed in tiles/s, the same signal `resolveClip` uses to decide `move` at all).

`cadenceScale` (`packages/render/src/clip.ts`, `ROUT_CADENCE = 1.6`) exists and **no three.js code reads it**. Wire it here; a routed unit should finally run at rout cadence on the default backend.

The split this file already draws — pure decision arithmetic above the `THREE.*` line, GPU-facing construction below — applies: `gaitTimeScale` goes in `mesh-anim.ts` and is tested in `environment: 'node'` with no `WebGLRenderer`.

Arithmetic:

```
clipGroundSpeed = strideM / (cycleS * MESH_UNITS_PER_TILE)   // tiles/s
timeScale       = (entitySpeed / clipGroundSpeed) * cadenceScale(anim)
```

- [ ] **Step 1: Write the failing tests**

```ts
describe('gaitTimeScale', () => {
  it('plays a clip at 1x when the unit moves at the clip\'s own ground speed', () => {
    // meshy_mortar_team.glb measured 1.28 m of boot travel over a 0.667 s
    // cycle -- 1.28 / (0.667 * 3) = 0.64 tiles/s, and that unit's own
    // speed_tiles_s is 0.65. Ratio 0.987 in the spec's table; the one
    // shipped mesh that already kept up.
    expect(gaitTimeScale({ strideM: 1.28, cycleS: 0.667 }, 0.64, 1)).toBeCloseTo(1, 2);
  });

  it('speeds a clip up when the unit outruns its own legs', () => {
    expect(gaitTimeScale({ strideM: 1.28, cycleS: 0.667 }, 1.28, 1)).toBeCloseTo(2, 2);
  });

  it('carries rout cadence, which no three.js code has ever read', () => {
    const calm = gaitTimeScale({ strideM: 1.28, cycleS: 0.667 }, 0.64, 1);
    const routed = gaitTimeScale({ strideM: 1.28, cycleS: 0.667 }, 0.64, ROUT_CADENCE);
    expect(routed / calm).toBeCloseTo(ROUT_CADENCE, 3);
  });

  it('clamps rather than playing a clip at an absurd rate', () => {
    expect(gaitTimeScale({ strideM: 1.28, cycleS: 0.667 }, 99, 1)).toBeLessThanOrEqual(2.5);
    expect(gaitTimeScale({ strideM: 1.28, cycleS: 0.667 }, 0.001, 1)).toBeGreaterThanOrEqual(0.5);
  });

  it('is 1 for a mesh that declares no gait, which is exactly today\'s behaviour', () => {
    expect(gaitTimeScale(undefined, 0.9, 1)).toBe(1);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm exec vitest run packages/render/src/three/units/mesh-anim.test.ts`
Expected: FAIL — `gaitTimeScale` not defined.

- [ ] **Step 3: Implement `gaitTimeScale` in `mesh-anim.ts`**

Document the clamp as a runtime guard, not the mechanism: shipped art is expected near 1.0 and Task 7's gate is what keeps it there. A clamp that is doing real work on a shipped mesh means that mesh's gait is wrong.

- [ ] **Step 4: Read `rl_gait` into the template**

In `mesh-unit.ts`, add `readonly gait?: ReadonlyMap<ClipName, GaitMetrics>` to `MeshUnitTemplate` and populate it in `buildMeshUnitTemplate` from `gltf.scene.userData`. Validate the shape rather than trusting it: a malformed entry is dropped with a warning naming the file, not allowed to reach the arithmetic. Add a `mesh-unit.test.ts` case building a template from a fixture carrying `userData.rl_gait`.

- [ ] **Step 5: Apply it each frame**

In `ThreeRenderer.updateMeshUnits`, after `applyMeshClip`, set the active action's `timeScale` from `gaitTimeScale` when the resolved clip is `move` or `moveFire`, and to 1 otherwise. Non-locomotion clips are never rate-scaled — `fire`, `down`, `work` and `idle` have no stride and scaling them would be meaningless.

`updateVehicleMeshes` is not touched: vehicles have no legs and `moto_rpg`'s wheel spin is recorded as follow-up in the spec's §4.

- [ ] **Step 6: Verify on screen**

A dev server is already running on port 5178 from this worktree. Do not start another and do not kill it. Drive it through the browser at `?sandbox=beit_sahwan_outskirts&sur`, order a squad across open ground, and read back `timeScale` on the live action along with `entitySpeed`. Confirm the product is near 1.0 for a unit at nominal speed, and that a unit halted by an obstacle slows its legs rather than marching on the spot.

Verify by driving the UI, not only the console — this project has twice recorded a console-only check passing while the feature was broken.

- [ ] **Step 7: Gate and commit**

```bash
pnpm test
```
```bash
pnpm typecheck
```
```bash
pnpm lint
```
```bash
/usr/bin/git commit -m "render(three): a unit's legs keep up with the ground it crosses" -- packages/render/src/three/units/mesh-anim.ts packages/render/src/three/units/mesh-anim.test.ts packages/render/src/three/units/mesh-unit.ts packages/render/src/three/units/mesh-unit.test.ts packages/render/src/three/ThreeRenderer.ts
```

---

### Task 7: The gate covers every rig, for gait and for facing

**Files:**
- Modify: `tools/src/mesh_gait.test.ts`

**Interfaces:**
- Consumes: `measureFacing` (Task 1), `measureRoleTravel`/`groundPerCycleM` (existing), `rl_gait` (Task 5), `gaitTimeScale` (Task 6).
- Produces: the gate. Nothing consumes it.

**Context you need:**

Today this file measures **`mortar_team` alone** — the one file GH-145 was raised against — which is why fourteen sliding rigs shipped green. The lesson is in the spec's §2.2 and it is the reason this task exists: a gate that names one file is a gate for one file.

Iterate `RIGGED_UNIT_MESHES` from `packages/app/src/mesh-catalogue.ts`, which is plain data with no `import.meta.url` in it precisely so a node-side reader can ask it directly — the existing `wiredMortarGlb()` helper already relies on that.

Exemptions, by name, printed on the passing path: `atgm_cell`, `mortar_crew`, `digger_crew` (crew-served, `animates: False`, a degenerate 0.04 s `move` by design) and `moto_rpg` (a motorcycle whose riders' boots do not move). Name them in one exported constant with the reason beside each, not scattered through the assertions.

- [ ] **Step 1: Gait band across every rigged type**

Assert the residual time scale at each unit's own nominal speed sits in a band around 1.0. Derive the band from what Tasks 2–4 actually achieved — run the numbers first, then set the band with margin. Do not fit the band to the worst file; if one type cannot reach the band, that is a finding to report, not a band to widen.

- [ ] **Step 2: Declared-vs-measured consistency**

Every file's declared `rl_gait` must equal a fresh `measureRoleTravel` of the same file and clip. This is what catches a re-export that skipped `pnpm gait:meshes` — otherwise the renderer rate-matches to a stale stride and nothing notices.

- [ ] **Step 3: Facing band across every rigged type and clip**

`idle`, `move`, `fire`, `down`, `work`, `moveFire` where present. Exempt `wreck`/`wreckAlt` — corpses, and the spec records `meshy_soldier`'s −166° as deliberate. Set the tolerance from the measured contrapposto band (+3..+11) with margin, well clear of the 84° and 156° defects it exists to catch.

**Gate the SPREAD as well as the mean, and the reason is specific.** `meanDeg`
is a circular mean (Task 1, fix round 1). For a clip whose bearing sweeps
through most of a circle — which is exactly what `meshy_soldier`'s broken
`idle` did, +23° to −159° — the averaged unit vectors nearly cancel, so the
mean is numerically unstable and means little. Measured: that clip's mean
moved 7.8° purely from switching to the circular mean, while every non-sweeping
clip moved less than 0.002°. A mean-only gate could therefore pass a figure
spinning on the spot. `maxDeg − minDeg` is what catches that, and a figure that
turns while standing still is a defect in its own right regardless of where the
turn is centred. Set that bound from what the fixed art actually measures.

- [ ] **Step 3b: Measure the WEAPON axis, from geometry, and gate the two instruments against each other**

Two findings from Task 2 make this step necessary rather than optional, and
both were measured.

**The weapon axis must come from geometry, not from a bone direction.** Task 2
gates `fire`'s weapon using the firing hand's own bone direction as a proxy.
Measured against the actual rifle — the first principal component of the
`uniform` vertices dominantly weighted to that hand joint, a 0.63 m cloud that
is unmistakably a rifle — the proxy is systematically offset: 4.1° on `idle`,
4.2° on `moveFire`, **7.6° on `fire`**. So the shipped barrel sits near +8.8°
where the proxy reports +1.2°. Use the PCA definition here. It needs only a
joint name, it reads the real weapon, and it is the only definition that could
catch a wrong bone.

**Do not gate `move`'s weapon axis tightly.** On the Meshy rigs `Running`
carries the rifle one-handed at the side, so its bearing spread is about 155°
and that is correct. A tight bound here would fail correct art.

**The face-centroid lever is unusable on one rig and you must exclude it by
name, not widen the band.** The bearing is read from a head joint to that
figure's own face-mesh centroid, and the length of that lever varies tenfold
across the roster: measured in the bind pose, `sarim_rifles` 0.0813,
`office_worker` 0.0692, `farm_worker` 0.0639, `meshy_soldier` 0.0582,
`civilian_child` 0.0505, and **`civilian_woman` 0.0160**. At 16 mm the reading
is noise: she measures a **78.7° spread on a STANDING idle**, against the
child's 10.8° on the same instrument and the same kind of clip.

**Do NOT "fix" that by reading `Head` → `headfront` instead, however tempting
Task 3's report makes it sound.** That recommendation is true only for the
seven Meshy-derived files. Checked in the actual bytes: `headfront` exists on
`meshy_soldier`, `sarim_rifles`, `yahalom_engineer` and the four civilians, and
is **absent from the other fifteen** — `at_team`, `atgm_cell`, `breach_team`,
`charge_squad`, `demo_squad`, `digger_crew`, `inf_squad`, `meshy_mortar_team`,
`militia_cell`, `mortar_crew`, `mortar_team`, `moto_rpg`, `rpg_team`,
`sniper_team`, `yahalom_squad`. And there is no fallback for those: `rig.py`
builds the head bone as a **vertical** segment, so its own direction has no
ground-plane bearing at all. Switching the gate to the marker would silently
drop coverage of every `kit.py` team — the majority of the roster, and the
family that produced the `mortar_team` defect this instrument exists for. Use
the centroid with `civilian_woman` excluded by name and by number, or find a
geometric lever that works on both rig families.

**`moto_rpg` has no head bone at all and will raise.** Its `face` role is bound
entirely to `rid_seat`, `pas_seat` and two death roots — a rigid pillion rig,
correct as built. Since Task 3 it raises rather than returning empty, so a
sweep over `art/meshes/**` goes red on a file that is right. Exempt it by name,
beside the `wreck` exemptions, with that reason. (`sniper_team` and
`yahalom_engineer` carry no `face` mesh at all and already raise at an earlier
guard — pre-existing, same treatment.)

**Do not try to share one ceiling between the Python gates and this file.** On
`sarim_rifles` the two instruments differ by 12–17°, because that rig's `face`
role is a 167-vertex sliver in a keffiyeh eye-gap. Deriving this file's bounds
from the import scripts' tables would be actively wrong. Either parse each
script's table and carry an explicit per-asset offset, or keep the bounds
literal here and say in the comment that they are literal and why.

**Gate the two instruments against each other.** Task 2 built a pose that
passed every build-time check and was still wrong: an aim distributed through
`Spine02` solved cleanly, put the weapon on the axis, and went green, while
the exported face read +15.2° against the arms-only +0.3°. A spine roll tilts
the head rather than yawing it, and the head-forward vector carries a vertical
component (measured 0.0859 forward, 0.0311 up), so a roll rotates part of that
into a lateral component and swings the ground bearing — which a marker-bone
probe along the head's own forward axis cannot see. Nothing automated would
have caught it: this test file gates `fire`'s face at 20 and that build read
15.2. What caught it was a by-hand comparison of two instruments that normally
agree to 1–3°. Assert that agreement, on the standing clips, with a bound near
5°. Both numbers already exist, so this is cheap.

- [ ] **Step 4: Falsify the gate**

A gate that has never gone red is a gate of its own threshold. Temporarily re-point one assertion at a pre-fix copy of `meshy_soldier.glb` (or reconstruct the defect), confirm the facing check fails and names the clip, then revert. Record the failure output in your report. Do the same for the gait check.

- [ ] **Step 5: Run and commit**

```bash
pnpm test
```
```bash
/usr/bin/git commit -m "tools: the gait gate measures every rig, not the one file it was raised against" -- tools/src/mesh_gait.test.ts
```

---

### Task 8: The capture sheet, the docs, and GH-152

**Files:**
- Create: `tools/src/perf/gait-captures.ts`
- Modify: `CLAUDE.md`, `docs/superpowers/specs/2026-08-28-mesh-unit-contract.md`, `docs/superpowers/specs/2026-09-15-infantry-gait-design.md` (a Deviations section)

**Interfaces:**
- Consumes: everything.
- Produces: the sheet the project lead judges this on.

**Context you need:**

This project's own record is that the lead judges motion on screen, and that numbers settle whether the feet keep up but not whether it looks right. `tools/src/perf/wreck-captures.ts` is the precedent for the sheet — read it and follow its shape.

- [ ] **Step 1: Write the capture harness**

Each affected type, walking and firing, at gameplay zoom and at 2.5×, one image per type. Use the dev server already running on 5178; do not start another and do not kill it.

- [ ] **Step 2: Produce the sheet**

- [ ] **Step 3: Extend the mesh-unit contract**

Document `rl_gait` in `2026-08-28-mesh-unit-contract.md` as an optional scene-level extra, with what it means, who writes it and what a mesh without one gets (time scale 1, today's behaviour).

- [ ] **Step 4: Update CLAUDE.md**

The "Mesh units" section carries stale claims this work overturns. At minimum: the pipeline now has a gait pass and a `pnpm gait:meshes` step between export and encode; `mesh_gait.test.ts` is tree-wide; `cadenceScale` now reaches three.js. Follow that file's own habit — record the measurement and the counter-intuitive finding, not just the rule.

- [ ] **Step 5: Write the Deviations section**

Append a numbered Deviations section to the spec recording every place the implementation diverged from it and why. Every task's surprises go here.

- [ ] **Step 6: Close GH-152**

```bash
gh issue close 152 --comment "..."
```

The comment should say what actually resolved it: the civilians' own speed is 2.4 m/s, so `move` *is* the run and the "fleeing signal" the issue was blocked on was never needed. Link the spec.

- [ ] **Step 7: Commit**

```bash
/usr/bin/git commit -m "docs,tools: the gait sheet, the contract's new extra, and GH-152's real answer" -- tools/src/perf/gait-captures.ts CLAUDE.md docs
```

---

## Final gate, before finishing the branch

```bash
pnpm test
```
```bash
pnpm typecheck
```
```bash
pnpm lint
```
```bash
pnpm test:determinism
```
```bash
pnpm validate:data
```
```bash
pnpm validate:meshes
```
```bash
pnpm encode:meshes -- --check
```
```bash
pnpm balance
```
```bash
pnpm playtest
```
```bash
pnpm golden-baseline
```

`pnpm test:determinism`, `pnpm balance` and `pnpm playtest` must be **byte-identical to main**. Any movement means a sim change crept in, which the Global Constraints forbid.

The visual gate **will** go red: `quiet` and `open-ground` frame infantry and their pose has changed. Run it **alone on an idle machine** — the `vehicle` scenario has read a false red three times when run straight after heavy jobs. Then bless from CI numbers with the reason written into `manifest.json`, download the bless artifact, and look at the picture.
