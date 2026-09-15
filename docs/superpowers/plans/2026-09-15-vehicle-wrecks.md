# Mesh Vehicle Wrecks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every mesh vehicle dies into a persistent, charred, slumped 3D wreck instead of vanishing into a billboard.

**Architecture:** A gltf-transform pass adds a `death_root` with `WRECK_<name>` children (sharing the live meshes) and two constant scale clips (`idle`, `wreck`) to each of the eleven vehicle GLBs, from per-vehicle recipes. The renderer chars anything under the death root and plays the existing fade → `wreck` → persistent-wreck sequence through a rigid-mesh sibling of `mesh-death.ts`. The mesh gate hides the death root for the live render and judges the wreck on its own. The sim is untouched.

**Tech Stack:** `@gltf-transform/core|extensions|functions` (already `tools` dependencies), three.js 0.170 (`MeshStandardMaterial`), vitest, Blender 5.2.0 (`/Applications/Blender.app`, matching CI), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-14-vehicle-wreck-design.md` (approved 2026-09-14). One section is restated below because the renderer changed under it: §4.3's "shared dark ramp slice" predates the lit renderer (Phase 0, 2026-09-14), where a palette mesh is `rampMaterial(ramp)` = `liftTone(ramp)` on a `MeshStandardMaterial` and a textured vehicle keeps its sRGB bake. Charring is therefore a dark `rampMaterial` for a palette mesh and a tinted `.clone()` of `texturedMaterial(loaded)` for a textured one (Task 4). Record this as Deviation 1 in the spec (Task 5).

## Global Constraints

- The asset contract (spec §4.1), verbatim: every `art/meshes/vehicles/<id>.glb` carries one extra top-level node `death_root`; under it one child per live mesh node named `WRECK_<name>` referencing the SAME mesh; each child carries its twin's extras (`rl_role` or `rl_textured: true`) plus `rl_wreck: true`; two clips `idle` and `wreck` keying the scale of every top-level live node and of `death_root` as constant channels (1/0 for `idle`, 0/1 for `wreck`); the role vocabulary stays closed (`VEHICLE_MESH_ROLES = hull, plate, rubber, metal, glass, recess`) and `VEHICLE_ROLE_PALETTE` is unchanged.
- The pass is idempotent: running it twice is a no-op on the bytes; it strips any existing `death_root` and any `idle`/`wreck` clip first.
- No geometry duplication: the eight Meshy vehicles are 1.6–3.4 MB; a GLB may grow by a few hundred bytes only.
- The supplied Meshy `.blend` files are never opened ("used as-is"); the source of truth for the wreck is the exported GLB plus the recipe table.
- Runtime: `addWreck` steps aside ONLY for a type whose vehicle template carries the `wreck` clip (CLAUDE.md's trap: excluding `vehicleMeshTemplates` unconditionally deletes the sprite wreck and leaves nothing).
- Disposal stays exactly once: every material the runtime creates for charring goes into the template's existing `materials` array (`mesh-vehicle.ts:184-185`, walked by `disposeVehicleMeshTemplate`).
- The sim is untouched; data flow stays commands in, events out. The golden determinism hash, `pnpm playtest` and `pnpm balance` cannot move.
- `three` is imported only under `packages/render/src/three/**`; TypeScript strict, no `any`.
- Blender: `pnpm validate:meshes` must stay green; `IOU_LIMIT 0.88` and `MIN_FILL 0.06` are never adjusted; any new floor is measured from the eleven results and its derivation written where the constant lives.
- Visual gate: read CI's numbers before blessing anything; the gated scenarios kill nothing, so no baseline is expected to move (a Draco re-encode of unchanged geometry must read inside noise — Task 2 checks).
- Commit trailer, verbatim, last line of every commit: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`
- `/usr/bin/git` by absolute path, one plain git command per Bash call, explicit pathspecs; never `git add -A`; never `git checkout -- <file>`.

---

## File structure

- Create `tools/src/meshes/wreck-recipes.ts` — the recipe table and the fraction constants (authored in code, like `rig.py`'s tables).
- Create `tools/src/meshes/wreck-pass.ts` — `applyWreckPass(document, recipe)` (pure on a gltf-transform `Document`) plus the CLI that reads/writes `art/meshes/vehicles/*.glb`.
- Create `tools/src/meshes/wreck-pass.test.ts` — unit tests on in-memory documents.
- Modify `tools/package.json`, root `package.json` — `wreck:meshes` scripts.
- Modify `art/meshes/vehicles/*.glb` (eleven, by running the pass), `assets/meshes/*` + `assets/meshes/manifest.json` (the Draco mirror).
- Modify `packages/render/src/three/units/mesh-vehicle-shipped.test.ts` — from "zero animations" to the contract.
- Modify `tools/validate_mesh_assets.py` — `check_vehicle_wrecks` (bytes) and the wreck-render checks; `tools/render_mesh_gate.py` — hide `death_root` for the live render, render the wreck alone.
- Modify `packages/render/src/three/units/vehicle-mesh-role.ts` — `CHARRED_RAMP`; `world-materials.ts` — `charredTexturedMaterial`; `mesh-vehicle.ts` — the `rl_wreck` branch and `hasWreck`.
- Create `packages/render/src/three/units/mesh-vehicle-death.ts` + test; modify `rigid-mesh-fixture.ts` (a `deathRoot` option), `ThreeRenderer.ts` (the death hand-off, `addWreck` guard, billboard-death skip).
- Create `tools/src/perf/wreck-captures.ts` — the eleven-pair sheet.
- Modify `CLAUDE.md`, `docs/superpowers/specs/2026-08-28-mesh-unit-contract.md`, the spec (Deviations).

---

### Task 1: The wreck pass as a library, with its recipes and tests

**Files:**
- Create: `tools/src/meshes/wreck-recipes.ts`, `tools/src/meshes/wreck-pass.ts`, `tools/src/meshes/wreck-pass.test.ts`
- Modify: `tools/package.json` (script `wreck:meshes`), root `package.json` (alias)
- Reference: `tools/src/meshes/encode-meshes.ts:53-65` (the `NodeIO`/extensions setup to copy), `.superpowers/wreck-plan-research.md` §4 (the node census)

**Interfaces:**
- Produces:

```ts
// wreck-recipes.ts
export type HullKind = 'wheeled' | 'tracked' | 'air';
export interface WreckRecipe {
  hull: HullKind;
  /** Node name of the turret pivot whose subtree is thrown, if any. */
  turretPivot?: string;
  /** Node name of the rotor pivot whose subtree is bent, if any. */
  rotorPivot?: string;
  /** Node name of the canopy (the paramotor's `hull_hull`), collapsed beside the frame. */
  canopy?: string;
}
export const WRECK_RECIPES: Readonly<Record<string, WreckRecipe>>;
export const WRECK_FRACTIONS: { HULL_DROP: 0.15; HULL_PITCH_DEG: 4; HULL_ROLL_DEG: 6; TURRET_SHIFT: 0.25; TURRET_ROLL_DEG: 12; TURRET_YAW_DEG: 20; BODY_ROLL_DEG: 25; ROTOR_BEND_DEG: 30; CANOPY_ROLL_DEG: 80; CANOPY_SHIFT: 0.6 };
// wreck-pass.ts
export const DEATH_ROOT = 'death_root';
export const WRECK_PREFIX = 'WRECK_';
export const CLIP_IDLE = 'idle';
export const CLIP_WRECK = 'wreck';
export function applyWreckPass(doc: Document, vehicleId: string, recipe: WreckRecipe): void;
export async function runWreckPass(ids: readonly string[] | 'all'): Promise<void>; // the CLI body
```

- Consumes: nothing from the renderer. `@gltf-transform/core`'s `Document`, `Node`, `NodeIO`, `getBounds` (verify the export name in the installed version: `node_modules/@gltf-transform/core/dist/*.d.ts` — it is `getBounds` in v3+, `bounds` in older); `gl-matrix`'s `mat4`/`quat` (a transitive dependency of core; if not resolvable from `tools/`, implement the 4×4 decompose by hand — 30 lines — rather than adding a dependency).

The recipe table, from the census (every vehicle's live top-level nodes are `hull_*` role meshes plus at most one pivot):

```ts
export const WRECK_RECIPES: Readonly<Record<string, WreckRecipe>> = {
  apc_eitan: { hull: 'wheeled', turretPivot: 'turret_pivot' },
  apc_kipod: { hull: 'wheeled' },
  dozer_d9: { hull: 'tracked' },
  heli_peten: { hull: 'air', rotorPivot: 'rotor_pivot' },
  ifv_namer: { hull: 'tracked', turretPivot: 'turret_pivot' },
  jeep_shoded: { hull: 'wheeled' },
  mbt_lavi: { hull: 'tracked', turretPivot: 'turret_pivot' },
  paramotor: { hull: 'air', canopy: 'hull_hull' },
  rocket_battery: { hull: 'wheeled' },
  scout_shachaf: { hull: 'wheeled' },
  technical: { hull: 'wheeled', turretPivot: 'turret_pivot' },
};
```

(`rocket_battery`'s launcher is fused into its `hull_*` meshes, so the spec's `masted` kind has no taker in the shipped eleven; say so in the table's comment. The fractions above are the FIRST values; Task 5 tunes them against the sheet and records the tuned numbers beside each.)

What the pass does, per document (write this as `applyWreckPass`):

1. Find the scene (`doc.getRoot().listScenes()[0]`). Remove any existing node named `death_root` (and its subtree) and any animation named `idle` or `wreck` — `node.dispose()` / `animation.dispose()` — so the pass is idempotent.
2. Collect the LIVE top-level nodes: `scene.listChildren()`. Collect the live MESH nodes: every node in the subtree with a mesh (`node.getMesh() !== null`), remembering for each its world matrix (`node.getWorldMatrix()`) so a turret part under a pivot is flattened into the death root with the pivot's transform baked in.
3. Measure the hull: the world-space bounds of the union of all live mesh nodes (`getBounds`), giving `height = maxY - minY`, `length` = the larger of the X and Z extents, `groundY = minY`, `centre`.
4. Create `death_root` as a child of the scene at the identity transform. For each live mesh node `n`, create `WRECK_<n.name>` under `death_root` with `.setMesh(n.getMesh())` (the same `Mesh` object, so the file grows by a node, not a buffer), `.setExtras({ ...n.getExtras(), rl_wreck: true })`, and a transform = the node's world matrix composed with the recipe's displacement for its part:
   - every part not under a pivot and not the canopy: the HULL recipe — translate by `−HULL_DROP × height` on Y (the hull settles toward the ground; wheels and tracks stay where they are, so apply the drop to `hull_*` parts whose role is `hull`, `plate`, `glass`, `metal`, `recess` but NOT `rubber`), then pitch `HULL_PITCH_DEG` about the hull centre's X and roll `HULL_ROLL_DEG` about its Z (right-handed, degrees → radians); for `hull: 'air'` (the helicopter) use `BODY_ROLL_DEG` as the roll so the fuselage lies on its side;
   - parts under `turretPivot`: the hull transform, then a shift of `TURRET_SHIFT × length` along the hull's long axis and a roll of `TURRET_ROLL_DEG` plus a yaw of `TURRET_YAW_DEG` about the pivot's own origin (the turret is thrown, not merely dropped);
   - parts under `rotorPivot`: the body roll, then a pitch of `ROTOR_BEND_DEG` about the pivot origin (the blades bend);
   - the `canopy`: rotate `CANOPY_ROLL_DEG` about its long axis and translate to lie at `groundY` shifted `CANOPY_SHIFT × length` along the long axis (the wing collapses beside the motor); the other paramotor parts take the hull recipe.
   Compose as matrices (world × displacement), then decompose into translation/rotation/scale for `setTranslation/setRotation/setScale`.
5. Create the two clips. One `Accessor` for the times `[0, 0.1]` (`SCALAR`, `Float32Array`), one `VEC3` accessor `[1,1,1, 1,1,1]` and one `[0,0,0, 0,0,0]`, all on the document's existing buffer (`doc.getRoot().listBuffers()[0]`). For `idle`: a `STEP` sampler + channel targeting `scale` on every live top-level node with the ones accessor and on `death_root` with the zeros accessor. For `wreck`: the reverse. `doc.createAnimation('idle')` / `('wreck')`, adding every sampler and channel. Constant channels are what the team rigs ship and what `applyMeshClip` plays; `mesh-team-death-shipped.test.ts:100-134` documents the "static held pose" shape (`duration < 0.2`, every sample equal to the first).
6. Return; the CLI writes with the same `NodeIO` + `ALL_EXTENSIONS` setup `encode-meshes.ts` uses (Draco is NOT applied here — `art/meshes` are the uncompressed sources; `pnpm encode:meshes` mirrors them).

The CLI (`runWreckPass`): argv `--id=<vehicle>` or nothing for all eleven; for each id in `WRECK_RECIPES`, read `art/meshes/vehicles/<id>.glb`, apply, write in place, print `WRECK_PASS_OK <id> +<bytes> bytes, <n> wreck nodes`. Refuse an id with no recipe. Scripts: `tools/package.json` `"wreck:meshes": "tsx src/meshes/wreck-pass.ts"`, root `"wreck:meshes": "pnpm --filter @lions/tools wreck:meshes"`.

- [ ] **Step 1: Write the failing tests** (`tools/src/meshes/wreck-pass.test.ts`)

Build documents in memory with `@gltf-transform/core` (`new Document()`, `doc.createBuffer()`, a `Mesh` with one `Primitive` of a unit cube's positions, nodes named as the census: `hull_hull`, `hull_rubber`, and a `turret_pivot` with a child `turret_metal`, extras `rl_role` on each mesh node). Tests:

```ts
describe('applyWreckPass', () => {
  it('adds death_root with one WRECK_ child per live mesh node, sharing the mesh', ...);   // 3 children for the fixture; each child's getMesh() === the live node's getMesh(); extras carry rl_role and rl_wreck: true
  it('bakes a pivot child's transform into its wreck copy', ...);                          // WRECK_turret_metal's world matrix ≈ pivot × part × displacement, never the identity
  it('keys idle and wreck as constant scale channels on every top-level live node and death_root', ...); // 2 animations; channel count = live top-level count + 1 each; sampler output all-ones/all-zeros; interpolation STEP; times [0, 0.1]
  it('is idempotent: running twice leaves the same node and animation count and equal bytes', ...); // write both to Uint8Array via NodeIO.writeBinary and compare
  it('strips a stale death_root and stale clips before rebuilding', ...);                   // pre-create a death_root with a bogus child and an `idle` animation, run, assert exactly the rebuilt set
  it('refuses a vehicle with no recipe', ...);
  it('does not grow the buffer by more than the two clips need', ...);                     // byte growth < 2 KB on the fixture
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm exec vitest run tools/src/meshes/wreck-pass.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `wreck-recipes.ts` and `wreck-pass.ts`** per the interface above. Verify the gltf-transform API names against the installed `node_modules/@gltf-transform/core/dist/*.d.ts` before writing (`getBounds`, `Node.getWorldMatrix`, `Document.createAnimation/createAnimationSampler/createAnimationChannel`, `Accessor.setType/setArray/setBuffer`, `AnimationSampler.setInterpolation('STEP')`, `AnimationChannel.setTargetPath('scale')`).

- [ ] **Step 4: Run the tests** — `pnpm exec vitest run tools/src/meshes/wreck-pass.test.ts` → PASS.

- [ ] **Step 5: Lint, typecheck** — `pnpm lint && pnpm typecheck` → PASS (the tools package is TypeScript-strict too).

- [ ] **Step 6: Commit** — `/usr/bin/git add tools/src/meshes/wreck-recipes.ts tools/src/meshes/wreck-pass.ts tools/src/meshes/wreck-pass.test.ts tools/package.json package.json` then commit: `tools(meshes): the wreck pass -- a death_root of shared meshes and two constant clips, from a recipe table` with a body naming the contract and the fraction constants as first values, trailer verbatim.

---

### Task 2: Run the pass on the eleven, mirror them, and make the tree refuse a wreck-less vehicle

**Files:**
- Modify: `art/meshes/vehicles/*.glb` (eleven), `assets/meshes/**` + `assets/meshes/manifest.json` (via `pnpm encode:meshes`)
- Modify: `packages/render/src/three/units/mesh-vehicle-shipped.test.ts`
- Modify: `tools/validate_mesh_assets.py` (`check_vehicle_wrecks`, wired into `main()`), `tools/render_mesh_gate.py` (hide `death_root` in the live render)
- Test: `pnpm validate:meshes`, `pnpm test`, `pnpm golden-baseline`

**Interfaces:**
- Consumes: Task 1's CLI and constants (`DEATH_ROOT`, `WRECK_PREFIX`, clip names).
- Produces: eleven GLBs carrying the contract; `check_vehicle_wrecks(vehicles_root) -> list[str]` in `validate_mesh_assets.py`; `hide_death_root(objs)` in `render_mesh_gate.py`.

- [ ] **Step 1: Flip the shipped-vehicle test first** (`mesh-vehicle-shipped.test.ts`): replace the clipless assumptions with the contract — every shipped vehicle has exactly the clips `idle` and `wreck`; both are static held poses (reuse the shape of `mesh-team-death-shipped.test.ts:100-134`: `duration < 0.2`, every track sample equals its first); each clip keys `scale` on every top-level live node and on `death_root`; a node named `death_root` exists with ≥ 1 child; every child's name starts with `WRECK_`, carries `userData.rl_wreck === true`, and its geometry is the SAME `BufferGeometry` object as some live mesh's (GLTFLoader shares geometry for a shared glTF mesh — assert identity, `expect(wreck.geometry).toBe(live.geometry)`); `entity.mixer` is non-null for every vehicle now (the research's "clipless vehicle costs nothing" branch is gone for shipped vehicles — keep the test that a mixer exists iff clips do, with the fixture path still covering the clipless case). Raise the stale `>= 9` count to `11`. Run it: FAIL on every vehicle (no clips yet).

- [ ] **Step 2: Run the pass and the mirror**

Run: `pnpm wreck:meshes` then `pnpm encode:meshes`, then `pnpm wreck:meshes` again and `git status --porcelain -- art/meshes/vehicles` must show the same eleven files with no further change (idempotence on the shipped bytes: run `shasum` before and after the second run and paste). Record each file's size delta (must be hundreds of bytes, not kilobytes).

- [ ] **Step 3: Run the shipped test** — `pnpm exec vitest run packages/render/src/three/units/mesh-vehicle-shipped.test.ts` → PASS for all eleven.

- [ ] **Step 4: The bytes-level contract check** (`tools/validate_mesh_assets.py`): add `check_vehicle_wrecks(vehicles_root)` modelled on `check_decor_meshes` (`:430-506`, using `_read_glb_json`): for every `art/meshes/vehicles/*.glb`, require a node named `death_root` among the scene's root nodes; every child of it named `WRECK_*` with `extras.rl_wreck === true`, referencing a mesh index that some non-wreck node also references; exactly two animations named `idle` and `wreck`, each with one `scale` channel per top-level live node plus one for `death_root`, each sampler `STEP` with two keyframes whose outputs are all-ones or all-zeros as the contract says. Each clause appends a human-readable failure; wire it as the fifth call in `main()` (`:637-758`) and print on the PASSING path: `vehicle wrecks: 11 GLB(s) carry the death_root contract; charring is a runtime treatment and is NOT gate-checked` (the analogue of the `NOT palette-checked` line at `:707-714`). Falsify each clause once by editing a throwaway copy of one GLB's JSON chunk (or by temporarily returning early from `applyWreckPass` on one id and re-running the pass), and paste the failure lines in the report; restore.

- [ ] **Step 5: Hide the death root in the live render** (`tools/render_mesh_gate.py`): in `render_one`'s `elif kind == "vehicle":` branch (`:491-492`), after import and before framing, call a new `hide_death_root()` that sets `hide_render = True` (and `hide_viewport`) on every object named `death_root` and its descendants — the vehicle analogue of `apply_idle_pose`, which never ran for vehicles. Without it the imported wreck copies render superimposed on the live vehicle (Blender's glTF importer does not evaluate the `idle` clip's frame-0 scale unless asked) and every silhouette IoU moves.

- [ ] **Step 6: The mesh gate and the visual gate**

Run: `pnpm validate:meshes` (Blender is at `/Applications/Blender.app`, found by the default candidates) → green, with the new passing-path line and the same 46 rendered units as before; paste the summary. Run: `pnpm golden-baseline` → exit 0 with every gated scenario inside its noise (the `vehicle` scenario draws mesh vehicles: a Draco re-encode of unchanged geometry must not move it beyond 5–157 px; if it does, report the numbers and do NOT bless — a systematic move here means the pass changed live geometry).

- [ ] **Step 7: Full gate and commit**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm validate:data && pnpm encode:meshes -- --check`
Then: `/usr/bin/git add art/meshes/vehicles/*.glb assets/meshes/manifest.json assets/meshes/<the eleven mirrored files by path> packages/render/src/three/units/mesh-vehicle-shipped.test.ts tools/validate_mesh_assets.py tools/render_mesh_gate.py` and commit `art(meshes): every vehicle GLB carries its wreck -- death_root, WRECK_ children on shared meshes, idle/wreck clips` with the per-file byte deltas and the gate lines in the body, trailer verbatim.

---

### Task 3: The gate judges the wreck

**Files:**
- Modify: `tools/render_mesh_gate.py` (render the wreck alone to `<unit>/wreck_f00_000.png`), `tools/validate_mesh_assets.py` (`load_mesh_masks` for the wreck PNGs; two checks; `WRECK_MIN_DISTINCT` measured)
- Test: `pnpm validate:meshes`

**Interfaces:**
- Consumes: Task 2's `hide_death_root()`; the existing `load_mesh_masks`/`check_collisions` (rendered IoU) and `IOU_LIMIT` from `validate_assets.py` (never redeclared).
- Produces: `WRECK_MIN_DISTINCT` (a float in `validate_mesh_assets.py`, derived from the eleven measured live-vs-wreck IoUs and written beside the constant).

- [ ] **Step 1: The wreck render**: in `render_one`'s vehicle branch, after the live PNG, hide every top-level live node (everything that is not `death_root`), un-hide `death_root` and its subtree, keep the SAME camera rig and framing as the live render (so the two masks are comparable), write `<out_root>/<unit_id>/wreck_f00_000.png`, print `MESH_GATE_OK: <unit_id> (vehicle-wreck) -> <path>`. Palette painting: the gate's `apply_vehicle_materials` repaints from `VEHICLE_ROLE_PALETTES` by `rl_role`; the wreck copies carry the same roles, so they paint the same — say in a comment that the runtime charring is not visible to the gate.

- [ ] **Step 2: The two checks** in `validate_mesh_assets.py`: (a) `wreck differs from its own live silhouette`: `IoU(live_mask, wreck_mask) <= 1 - WRECK_MIN_DISTINCT` — a recipe that moved nothing fails; (b) `wreck collides with no other unit`: run the existing `check_collisions` logic with the wreck mask against every OTHER unit's mask (meshes and sprites), `IOU_LIMIT 0.88`, excluding its own live mask and its own retired sprite (`VEHICLE_OWN_SPRITES` — add `scout_shachaf: ('SHACHAF_HULL',)` and `apc_kipod: ('KIPOD_HULL',)`, the two entries the research found missing).
   Derive `WRECK_MIN_DISTINCT` from the measurement: print all eleven live-vs-wreck IoUs, take the LARGEST (the least-changed wreck), and set the constant so that one passes with a margin of a third of its distance from 1.0 — write the eleven numbers and the derivation in the comment beside the constant. Falsify (a) once by temporarily zeroing every `WRECK_FRACTIONS` value, re-running the pass on one vehicle and the gate (paste the failure), then restore the fractions and re-run the pass on that vehicle; falsify (b) by reasoning only if no shipped wreck comes near 0.88 (say so).

- [ ] **Step 3: `pnpm validate:meshes` green**, summary pasted, with both checks named on the passing path.

- [ ] **Step 4: Commit** — `tools(gate): the mesh gate renders every vehicle's wreck alone and holds it to a measured distinctness floor and the collision limit`, body with the eleven IoUs, trailer verbatim. (If Step 2's falsification re-ran the pass on a vehicle, `git status` must be clean of GLB changes before committing — the restored fractions reproduce the shipped bytes; verify with `shasum`.)

---

### Task 4: The runtime — charring, the vehicle death path, the wreck

**Files:**
- Modify: `packages/render/src/three/units/vehicle-mesh-role.ts` (`CHARRED_RAMP`), `packages/render/src/three/world-materials.ts` (`charredTexturedMaterial`, `CHARRED_TINT_HEX`), `packages/render/src/three/units/mesh-vehicle.ts` (the `rl_wreck` branch, `template.hasWreck`), `packages/render/src/three/units/rigid-mesh-fixture.ts` (a `deathRoot` option), `packages/render/src/three/ThreeRenderer.ts` (the hand-off in `updateVehicleMeshes`' prune loop, `stepVehicleDeaths`, the `addWreck` guard, the billboard-death skip in `onEvents`)
- Create: `packages/render/src/three/units/mesh-vehicle-death.ts`, `packages/render/src/three/units/mesh-vehicle-death.test.ts`
- Test: `mesh-vehicle.test.ts` (existing), `world-materials.test.ts` (existing, if any), `ThreeRenderer.test.ts` / `debug-layers.test.ts` for the guard

**Interfaces:**
- Consumes: `rampMaterial`, `texturedMaterial`, `liftTone`, `WORLD_ROUGHNESS` (`world-materials.ts`); `rampForVehicleRole`, `sliceFrom` (`vehicle-mesh-role.ts`); `beginMeshDeathFade`/`setMeshDeathOpacity`/`endMeshDeathFade`, `meshDeathOpacity`, `meshDeathSinkPx`, `MESH_DEATH_SECONDS`, `MAX_MESH_WRECKS`, `MeshWreck`, `pushMeshWreck`, `updateMeshWrecks`, `MeshDeathEnv` (`mesh-death.ts` — all exported); `instantiateVehicleMesh`'s entity shape (`root`, `mixer`, `turretPivot`, `rotorPivot`) and `disposeVehicleMeshEntity`.
- Produces:

```ts
// vehicle-mesh-role.ts
/** The charred slice every wreck part takes on a palette vehicle: the darkest
 *  band's lit face. One constant, not a role -- the role vocabulary stays closed. */
export const CHARRED_RAMP: readonly string[] = sliceFrom('shadow', 0, 3);
// world-materials.ts
export const CHARRED_TINT_HEX = 0x2a2620;   // a warm near-black; multiplies the bake
export function charredTexturedMaterial(loaded: THREE.Material): THREE.MeshStandardMaterial; // texturedMaterial(loaded).clone() with color = CHARRED_TINT_HEX, roughness 1, metalness 0, metalnessMap/normalMap kept
// mesh-vehicle.ts
export interface VehicleMeshTemplate { ...existing; hasWreck: boolean }  // clips.has('wreck')
// mesh-vehicle-death.ts
export interface DyingVehicle { entityId: number; entity: VehicleMeshEntity; t: number; baseWorldY: number; swaps: MeshFadeSwap[]; settling: boolean; wreckAction: THREE.AnimationAction | null }
export function beginVehicleDeath(entity: VehicleMeshEntity, entityId: number, template: VehicleMeshTemplate): DyingVehicle;
export function stepVehicleDeath(d: DyingVehicle, dtSeconds: number, env: MeshDeathEnv): 'fading' | 'removed' | MeshWreck;
```

The material rule (the restated §4.3): while `buildVehicleMeshTemplate` traverses (`mesh-vehicle.ts:191-254`), a mesh whose `userData.rl_wreck === true` takes the charred treatment on top of the branch its twin takes — palette: `rampMaterial(CHARRED_RAMP)`; textured (`allowTextured` and a `map`): `charredTexturedMaterial(loaded)`. Both go into the template's `materials` array. The wreck copies keep `castShadow`/`receiveShadow` and `renderOrderForPart`. `hasWreck = clips.has('wreck')`.

The death path (rigid, so no bind-pose hazard — `mesh-death.ts:334-359`'s reason for not disposing the mixer does not apply): `beginVehicleDeath` swaps the entity's live materials for transparent clones exactly as `beginMeshDeathFade` does (reuse it if its signature takes a root; otherwise mirror it), records `baseWorldY`; `stepVehicleDeath` fades over `MESH_DEATH_SECONDS` with `meshDeathOpacity`/`meshDeathSinkPx`, then plays `wreck` once through `entity.mixer` (`clampWhenFinished`, `LoopOnce`), restores the swaps (`endMeshDeathFade`), and returns a `MeshWreck { root, x, y, shown }` for `pushMeshWreck` under `MAX_MESH_WRECKS`, fog-gated by `updateMeshWrecks`. The renderer: in `updateVehicleMeshes`' prune loop (`ThreeRenderer.ts:4733-4738`), a dead entity whose type's template `hasWreck` and whose `st.removed[id] === 0` is handed to `beginVehicleDeath` (root stays in the scene) instead of being removed and disposed; `stepVehicleDeaths(dt)` runs beside `stepMeshDeaths`; `addWreck` (`:5113-5117`) returns early when `this.vehicleMeshTemplates.get(typeId)?.hasWreck === true`; and `onEvents` (`:2552-2561`) does not push a `destroyed` vehicle into `this.dying` when that same predicate holds, so the intact-sprite fade never draws. Verify the last two on screen in Task 5: a destroyed Lavi must show no billboard at any point.

- [ ] **Step 1: Extend the rigid fixture** (`rigid-mesh-fixture.ts`): an option `deathRoot?: { parts: string[] }` that emits a `death_root` node with one `WRECK_<part>` child per named part sharing that part's mesh index and extras `rl_wreck: true`, plus the two constant scale clips when `clipNames` includes `idle` and `wreck`. A test in `rigid-mesh-fixture.test.ts` (or the existing fixture test) that `GLTFLoader` parses it and the wreck child's geometry `toBe` the live one.

- [ ] **Step 2: Write the failing tests** (`mesh-vehicle-death.test.ts`, on the fixture with two parts and the two clips): (a) the template built with the fixture marks `hasWreck` and gives the `WRECK_` mesh a material whose colour equals `new THREE.Color(liftTone(CHARRED_RAMP))` (palette) — and, with a textured fixture (a `map` on the material, `allowTextured` true), a material that is not the live one, with `color.getHex() === CHARRED_TINT_HEX`, roughness 1; both present in `template.materials`; (b) `beginVehicleDeath` → `stepVehicleDeath` over 0.4 s reports `'fading'` then, after the `wreck` action finishes, a `MeshWreck` whose `root` is the entity root; the live top-level nodes' scale is 0 and `death_root`'s is 1 after the clip; (c) `pushMeshWreck` evicts the oldest past `MAX_MESH_WRECKS`; (d) `addWreck` guard both ways through `ThreeRenderer`'s internals (a fake `WebGLRenderer` as `debug-layers.test.ts` does): a type whose template `hasWreck` pushes no billboard wreck; one without still does; (e) `onEvents` with a `destroyed` event for a `hasWreck` type leaves `dying` empty.

- [ ] **Step 3: Run to verify they fail**, then implement the pieces above in the order: `vehicle-mesh-role.ts`, `world-materials.ts`, `mesh-vehicle.ts`, `mesh-vehicle-death.ts`, `ThreeRenderer.ts`.

- [ ] **Step 4: Run** `pnpm exec vitest run packages/render` → PASS (the existing `mesh-vehicle.test.ts` and the shipped test included). `pnpm typecheck && pnpm lint` → PASS.

- [ ] **Step 5: On-screen check** (dev server from THIS worktree in the background: `pnpm --filter @lions/app exec vite --port 5178 --strictPort --host 127.0.0.1`, never `preview_start`, never kill a process you did not start; stop yours after): `?sandbox=beit_sahwan_outskirts`, in the console `__lions.units()` to find an `mbt_lavi`, `__lions.sim.debugKill(id)`, `__lions.step(20)`: the Lavi slumps into a charred wreck with its turret thrown, no sprite ever flashes, the wreck persists; take one screenshot via Playwright (the `art-captures.ts` helpers) and put its path in the report.

- [ ] **Step 6: Full gate and commit** — `pnpm test && pnpm typecheck && pnpm lint && pnpm validate:ui && pnpm golden-baseline` (no scenario kills a vehicle; the baselines must not move). Commit `render(three): a mesh vehicle dies into its charred wreck -- fade, the wreck clip, a persistent MeshWreck, and the billboard steps aside only when the clip exists`, trailer verbatim.

---

### Task 5: The sheet, the tuning, and the docs

**Files:**
- Create: `tools/src/perf/wreck-captures.ts`
- Modify (tuning): `tools/src/meshes/wreck-recipes.ts` (the fractions, with the tuned numbers recorded beside each), the eleven GLBs and the mirror (re-run the pass + `encode:meshes`)
- Modify (docs): `CLAUDE.md` ("Known scaling debts" mesh-vehicle-death paragraph, `:1032-1068`, rewritten to the shipped state; the "A GLB carries zero materials" bullet's sentence on vehicle clips), `docs/superpowers/specs/2026-08-28-mesh-unit-contract.md` ("Open, owned by the export side" closes for vehicles), the spec (a `## 7. Deviations` section: 1 the lit-renderer charring restatement; 2 no `masted` taker; 3 anything Task 4 changed in the death path's shape; the measured byte deltas and the eleven live-vs-wreck IoUs)
- Test: the sheet, `pnpm validate:meshes` after tuning, the full gate

**Interfaces:**
- Consumes: `art-captures.ts`'s `boot`/`cam`/`shot`; `__lions.units()`, `__lions.sim.debugKill`, `__lions.sim.spawn(typeIdx, side, x, y)` with `typeIdx` looked up from `__lions.sim.unitTypes` by id (the research: `scout_shachaf` and `apc_kipod` are in no sandbox table, so the sheet spawns them itself); `__lions.step(n)`.

- [ ] **Step 1: The sheet script**: boot `/?sandbox=beit_sahwan_outskirts&sur` (fields nine of the eleven), spawn `scout_shachaf` and `apc_kipod` on open tiles near the force, then for EACH of the eleven ids: find its entity, camera on it at zoom 1.6, `shot('<id>-live-1.6')`, `debugKill`, `step(20)` (past the 0.4 s fade and the clip), `shot('<id>-wreck-1.6')`, then the same pair at zoom 2.2; write to `.superpowers/wreck-captures/`. Run it against your own dev server; Read every wreck PNG.

- [ ] **Step 2: Tune the fractions against the sheet** — the spec's own rule: "set by looking at the eleven results at gameplay zoom, not reasoned in advance". Adjust `WRECK_FRACTIONS` (and a per-vehicle override field on `WreckRecipe` only if one vehicle needs it), re-run `pnpm wreck:meshes && pnpm encode:meshes`, re-run the sheet, until each wreck reads as slumped and charred with the turret thrown / rotor bent / canopy collapsed at zoom 1.6 and 2.2. Record the final numbers beside each constant with one clause on what each was tuned against. Re-run `pnpm validate:meshes` (the distinctness floor from Task 3 was derived from the FIRST fractions; if the tuned wrecks move the eleven IoUs, re-derive the floor the same way and say so).

- [ ] **Step 3: Send the sheet to the lead** — the controller does this from the report's paths: list the twenty-two PNGs.

- [ ] **Step 4: The docs** as listed under Files, each claim true of the code on the branch (read `CLAUDE.md:1032-1068` and rewrite it to the shipped state, keeping the history of why it was worse than "nothing draws" as one sentence).

- [ ] **Step 5: Full gate and commit** — `pnpm test && pnpm typecheck && pnpm lint && pnpm validate:data && pnpm validate:ui && pnpm validate:meshes && pnpm encode:meshes -- --check && pnpm golden-baseline` → all green. Commit `art,docs: the eleven wrecks tuned against the sheet; the mesh-vehicle death debt closes`, with the tuned fractions and the sheet paths in the body, trailer verbatim.
