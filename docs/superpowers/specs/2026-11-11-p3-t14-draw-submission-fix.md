# WebGPU P3 T14: the GH-1152 draw-submission fix, the plan

Status: PLAN only, no renderer code. Refs GH-943 (P3), GH-1152. Plan of record: `docs/superpowers/plans/2026-11-08-webgpu-p3.md`, T13 and
T14. The P3 bar is RELAXED: n600 ≤ ×1.073 (the P2 reading), n300 ≤ 1.05 (a no-regression check).

**The short version.**
- What T13 found, and what PR 1205 already landed, leaves the n600 ratio at **×1.330**, not ×1.073. That reading is from the T14 hold
  of 10 Nov, on integration head 715daabbb.
- The whole gap is CPU time inside G's `render()`. G's GPU wait is shorter than L's.
- The numbers needed to choose between the fixes are partly missing. §3 names each one and the exact run that produces it.
- The recommended fix is node-side and comes in two parts:
  - **F2**, a refresh policy for parked objects: no per-object FULL refresh for an object that has not changed;
  - **F8**, one world-matrix walk per frame instead of two.
- Each part sits behind a switch, so one Metal hold can read it on and off.
- Neither part, alone or with the other, is expected to reach ×1.073 at n600. Lead decision D2 says what happens then.

---

## 1. What T13 measured, and what has happened since

### 1.1 The T13 instrument (PR 1203, merged 10 Nov)

- `stats().perPass`: calls and objects per `shadow | scene | ao | post`.
- `stats().censusMs`, with the census taken out of `cpuRender`.
- `gpuTimeMs()`, behind `timestamps`.
- `tools/src/perf/webgpu-submit-probe.ts`, which reads H1 to H6 on L and G at n300 and n600.
- CI runs it as counts only on SwiftShader: `webgpu-noise.yml`, `probe=submit`.
- The record is `docs/agent-notes/webgpu-backend.md`, "Draw submission (P3 T13, GH-1152)".

### 1.2 The T13 Metal hold (10 Nov)

Conditions:
- Apple M3 Pro: L on ANGLE Metal, G on apple / metal-3.
- `wadi_halam_4` at 1280x720, DPR 2, z0.5, quality high, music off.
- 6 ABBA rounds of 80 frames; the 1-minute load was 2.50-4.00 per page.

The raw report is `_coord/webgpu-p3/tmp-t13/hold/submit-probe.md`.

| hyp | what | result |
|---|---|---|
| H1 | decor and props hidden (the BatchedMesh per-entry draws) | REJECTED. -2729 calls, dG -0.48 ms at n600, inside the spread. G's call excess is a matter of how calls are counted, not a cost. |
| H2 | FULL refreshes per frame on G | 1117 at n300, 4076 at n600, so +2959 per 300 units. Of those, skinned +1909, nodeMesh +358 and stockMesh +692. By reason at n600: `hasNode` 3007, `hasAnimation` 1062, other 7. |
| H3 | unit `castShadow` off | At n600 G -6.78 ms and L -3.10 ms. The shadow pass costs G about 2.2x what it costs L. This reading was taken on a scene that kept growing (caveat below). |
| H4 | AO hidden | Settled by the count: the AO pre-pass draws 0 calls at z0.5. |
| H5 | census in `cpuRender` | REJECTED. 0.079 ms a frame, 0.5% of the n600 G-L difference. |
| H6 | G before and after the T3-T12 twins (`runArm`, cpuRender) | n300 9.15 -> 10.95 ms, n600 15.95 -> 19.82 ms. P3 added x1.197 at n300 and x1.243 at n600. The slope went from 6.80 to 8.88 ms per 300 units; the intercept did not move. |

The G profile at n600, self time over 60 frames:

| function | ms over 60 frames |
|---|---|
| `writeBuffer` | 227.6 |
| `updateMatrixWorld` | 142.1 |
| `multiplyMatrices` | 115.0 |
| `_renderObjectDirect` | 114.2 |
| `_projectObject` | 109.8 |
| `_needsRenderUpdate` | 38.3 |
| `_updateBindings` | 33.6 |

L's top entry is `readPixels`, the sync. L's `updateMatrixWorld` is 80.5 and its `multiplyMatrices` 139.4.

**T13's named lever:** the per-object FULL refresh that every node-twinned mesh now takes in both the scene and the shadow pass. The
reason is that `NodeMaterialObserver.needsRefresh` returns FULL whenever the material `hasNode`.

**Caveat (measured):** repeated `snapshot()` calls grew the drawn scene, so H3 and H4 on the T13 page read a bigger scene than their
base did. The probe now snapshots once per spawn. Why repeated snapshots change the drawn set is still not diagnosed.

### 1.3 PR 1205 (merged 10 Nov 12:35Z): the first T14

PR 1205 took the `writeBuffer` half of the lever, node-side:
- `backend/attribute-uploads.ts`: a `DynamicDrawUsage` attribute uploads only when its version changes. T13's profile put 2.06 ms
  of `writeBuffer` a frame on this.
- `backend/bone-texture.ts`: skinned meshes take three's bone-texture path, one upload per skeleton per frame. That source was
  1.73 ms a frame.

**Its G1 section is still "Pending".** The hold (`_coord/webgpu-p3/tmp-t14/hold.log`) went as follows:

| step | what | result |
|---|---|---|
| 1 | ABBA with the fix | Ran. Numbers below. |
| 2 | ABBA with the fix's lines reverted | REFUSED: 1-minute load 6.29 > 4. |
| 3 | submit probe on the fixed page | Ran all 6 rounds, then was killed (exit 143) when the lock was released. No profile and no summary were written. |
| `hold2.sh` | retry of step 2 | Produced nothing. |

So **the effect of PR 1205 has never been measured.**

### 1.4 Where the ratio stands (T14 hold step 1, `abba-fixed.json`)

All values are medians in ms. The P2 row is the P2 lead sheet, `_coord/webgpu-p2/sheet/abba.json`, at the same 1280x720 DPR 2 z0.5.

| n | arm | synced | cpuFrame | cpuRender | synced - cpuFrame | calls | triangles |
|---|---|---|---|---|---|---|---|
| 300 | L | 22.1 | 6.4 | 4.7 | 15.7 | 1547 | 8.31 M |
| 300 | G | 26.5 | 13.7 | 11.9 | 12.8 | 4292 | 8.32 M |
| 600 | L | 32.7 | 12.7 | 9.6 | 20.0 | 2897 | 15.12 M |
| 600 | G | 43.8 | 25.8 | 22.3 | 18.0 | 5642 | 15.15 M |
| 600 (P2) | L | 30.9 | 11.4 | 8.3 | 19.5 | 2477 | 10.59 M |
| 600 (P2) | G | 33.3 | 19.7 | 16.3 | 13.6 | 5210 | 10.61 M |

The ratios, as the median of the round medians:

| n | G vs L (synced) | spread | bar |
|---|---|---|---|
| 300 | x1.205 | 1.20 / 0.20 | NOT MET (≤ 1.05) |
| 600 | x1.330 | 0.85 / 0.30 | NOT MET (≤ x1.073) |

Read from this table:
- **The gap is CPU.**
  - G's `synced - cpuFrame`, the wait for the GPU after submit, is 2 ms shorter than L's at n600.
  - G's cpuFrame is 13.1 ms longer, and 12.7 ms of that is inside `render()`.
  - A CPU saving on G lands roughly 1:1 in `synced`.
- **What the bar needs:**
  - At n600, G's synced must fall from 43.38 to ≤ 35.01 ms (×1.073 of L's 32.63). That is **-8.4 ms of G CPU**.
  - At n300, G's synced must fall from 26.35 to ≤ 22.97 ms. That is **-3.4 ms**.
- **The scene is heavier than P2's on both arms.**
  - At n600 there are 15.12 M triangles today against 10.59 M in P2.
  - Today's `unit-shadow-off` variant draws **exactly** P2's triangle count at both counts: 10,586,682 at n600 and 6,038,292 at n300.
  - So P2's ×1.073 was most likely read on a scene whose unit meshes cast no shadow, probably because the hooked unit materials were
    census-hidden on G and matched-hidden on L. That cause is not established (see N6). It matters for D1.

### 1.5 H3 on the fixed page (T14 step 3, the per-round log lines; 12 readings, 6 rounds, cpuRender medians)

| n | arm | base | unit-shadow-off | delta | decor-props-hidden |
|---|---|---|---|---|---|
| 600 | G | 24.5 | 20.05 | **-4.45** | 24.1 (-0.4) |
| 600 | L | 11.05 | 8.85 | **-2.2** | 11.0 |
| 300 | G | 13.25 | 11.1 | -2.15 | 12.9 |
| 300 | L | 5.5 | 4.4 | -1.1 | 5.2 |

On the clean page, the unit shadow pass costs G about 2x what it costs L. H1 is rejected again.

### 1.6 Facts checked in three 0.186.1 (the patched build the repo resolves)

- **The `hasNode` check runs before the `static` check.** `NodeMaterialObserver.needsRefresh` returns FULL on
  `hasNode || hasAnimation || dynamic instancing || first sight || velocity` *before* it reads `object.static` or a static bundle.
  - So marking a twinned object `static` changes nothing.
  - This rules out the plan's candidate "static render objects marked so the observer skips them" for every twin.
- **`containsNode` is true for more than twins.** It is true for any material with a node-valued property, and also when the
  builder context carries `getShadow` / `getAO` / `modelViewMatrix`.
  - That is why stock meshes also show up under `hasNode`: 1098 stockMesh FULL refreshes at n600.
- **FULL and SHARED do different work.**
  - FULL runs, per render object: `updateBefore`, `geometries.updateForRender`, `nodes.updateForRender`, then
    `bindings.updateForRender`, which checks every group and writes only what changed since 1205.
  - SHARED skips the geometry update and every non-shared (object) group.
- **The shadow pass walks the scene graph a second time.** `ShadowNode` renders through `renderer.render(scene, shadow.camera)`, and
  `Renderer` calls `scene.updateMatrixWorld()` at the top of every `render` when `matrixWorldAutoUpdate` is set.
  - So G walks the world matrices at least twice a frame: the scene pass, then the nested shadow pass inside it.
  - Legacy's `WebGLShadowMap` does not re-walk the graph.
  - This matches G's `updateMatrixWorld` self time: 142 ms against L's 80.5 over 60 frames.
- **Shadow casters are the same on both arms.**
  - Shadow casters: G 3660 calls / 2281 objects, L 2281 / 2281.
  - With decor hidden, G's shadow pass reads 2276 / 2276, so G's extra shadow calls are BatchedMesh entries (H1).
  - G draws no shadow caster that L does not, so the candidate "trim unit `castShadow` where legacy draws no shadow either" is empty.

---

## 2. Candidate fixes, ranked

| # | fix | where | expected saving at n600 (n300) | risk | verdict |
|---|---|---|---|---|---|
| F2 | **Refresh policy for parked objects:** on a node boot, downgrade FULL to SHARED for a render object whose reason is `hasNode` only and whose inputs are unchanged. Not for skinned objects (`hasAnimation`), first sight, dynamic instancing or velocity. "Inputs" means the world matrix, the geometry and material versions, and the twin's declared OBJECT-scoped tuple (P3-R3's `color`, `opacity`, `roughness`, `metalness`, `uRgRot`, `uRgAxle`, `uRgTrack`, `uRgPitchInv`). | `backend/`, a wrap of the node renderer's `_nodes.needsRefresh`. This is the seam T13's probe already wraps, and three is not patched. | **At most about 6.4 ms**, an UPPER BOUND, not a forecast: 1732 non-skinned FULL refreshes a frame at n600 (nodeMesh 616, stockMesh 1098, instanced 8, batched 10) x T13's 3.68 µs per refresh. That 3.68 µs charges ALL of G's excess slope to the refresh, so it overstates. The saving applies only to PARKED objects: a moving unit changes its matrix and stays FULL. The ABBA scene is parked, so the benchmark flatters it. The real figure is H7 (§3). | **Medium.** The danger is a stale uniform: a value an object reads changes, but no input in the key moves. Gates G2b and G2c below cover it. | **Recommended**, behind a go/no-go on H7 |
| F8 | **One world-matrix walk per frame:** set `scene.matrixWorldAutoUpdate = false` for the nested shadow render (and any nested `PassNode` render of the same scene), then restore it. The outer pass has already updated the matrices. | `backend/`, inside the pass counter's existing wrap of `renderer.render` | **About 1.2 ms**, which is half of G's `updateMatrixWorld` self time of 2.37 ms a frame. Up to about 2 ms if the duplicate `multiplyMatrices` share goes with it. (About 0.6-1.0 ms at n300.) | **Low.** The second walk is redundant unless something writes a transform between the two passes (an `onBeforeRender` that moves an object); gate G2d checks that. | **Recommended**, bundled with F2 |
| F3 | **Unit shadow sub-mesh trim:** small per-role parts (kit, small gear) stop casting shadows, ON BOTH ARMS. | `units/`, both backends | Ceiling, with every unit shadow off: G -4.45, L -2.2 ms cpuRender (§1.5). That alone takes the n600 ratio only to about x1.27. A part-only trim gives a fraction of it. | **A legacy look change.** Every baseline moves, and it needs the lead's look and a CI bless (the P2 ruling-2 path). rts-art-direction: shadows ground a unit at play zoom, and "simplified only to a measured budget". | Out of P3 bounds: Lead decision D2(b) |
| F7 | **Merge each figure's per-role SkinnedMeshes into one** | the art pipeline | The largest lever: skinned is 2344 of the 4076 FULL refreshes at n600, and 1909 of the 2959 added per 300 units. It also helps L. Not sized. | An art change (the plan says so: NOT P3). Per-role roughness and metalness need a vertex role attribute. | Out of bounds: D2(c) |
| F4 | Shadow map at half rate on the node path | `backend/` | At most about half of G's unit shadow cost, about 2.2 ms | A parity break: G's shadows lag moving units and L's do not. Done on both arms, it is a look change. | Rejected |
| F5 | The census on a dirty flag | | 0.079 ms (H5) | | Rejected (H5) |
| F6 | BatchedMesh per-entry work | | 0.4 ms, inside the spread (H1) | | Rejected (H1) |
| F9 | `object.static` on parked objects | | 0 for every twin (§1.6) | | Rejected (the three code) |

**Why F2 and F8 go together, and why that is still unlikely to be enough.**
- Both are node-only, both are per-object CPU work, and each has its own switch, so one hold reads each one separately.
- Their combined ceiling is about 6.4 + 1.2 to 2 = **7.6 to 8.4 ms**, against the 8.4 ms the n600 bar needs.
- F2's figure is an upper bound that counts every parked object. The realistic result is below the bar.
- T14 therefore pre-declares the outcome: it lands what it measures outside the spread, reports the ratio, and goes to D2. This is
  Lead decision 6 of the P3 plan.

---

## 3. The numbers that are missing, and the runs that produce them

T13 named the lever, but it did not produce every number this plan needs. Precisely:

| # | missing number | why the plan needs it | status |
|---|---|---|---|
| N1 | **The G CPU profile at n600 after PR 1205** | T13's top entry, `writeBuffer`, is what 1205 removed. Without a new profile, the ranking of F2 against F8 rests on a profile that no longer describes main. | The T14 hold's step 3 was killed (exit 143) before writing it |
| N2 | **The effect of PR 1205** (ABBA with its lines reverted, same hold) | So that its saving is not credited to F2 and F8 | Refused on load 6.29; the `hold2.sh` retry produced nothing |
| N3 | **The marginal cost of a FULL refresh against a SHARED one** | F2's real saving. The 3.68 µs is an attribution, not a measurement. | Never measured. Needs the new probe variant H7 |
| N4 | **The ratio on origin/main itself** | The only reading (×1.330) is from the unpushed head 715daabbb. Main now carries T1-T14, so the next reading should be main at a named sha. | Not read |
| N5 | A GPU time | Not needed for the decision: `synced - cpuFrame` shows G's GPU wait is shorter than L's (§1.4). `gpuMs` read 73-112 ms, above the frame's own time, and stays unused. | Not blocking |
| N6 | Why P2's n600 scene drew exactly today's `unit-shadow-off` triangles | D1 (is ×1.073 like for like?) | Not blocking, but D1's context |

### The runs

Every Metal run is done by the coordinator. Each one takes `_coord/BROWSER.lock`, runs on its own port (never 5177), with music off
(the pages force it), load ≤ 4, `--wait-quiet=90`, 1280x720 DPR 2 z0.5 quality high (the scripts' defaults), on a clean checkout of
origin/main at a named sha `<M>`. `$C` is `/Users/ilpinto/dev/roaring-lions-ep/_coord`. Backends:
- L is Chromium WebGL2 on ANGLE Metal;
- G is WebGPU on apple / metal-3.

**R1 (CI, free; N4's counts and F2's G2 base).**
- Command: `gh workflow run webgpu-noise.yml --ref main -f probe=submit`.
- SwiftShader, counts only: FULL refreshes by type and reason, uploads, per pass, on main.

**R2 (Metal hold 1, BEFORE any T14b code; N1, N4, and N2 if the load allows). From `<main checkout>/tools`:**

1. The ratio on main (N4), port **5215**:
   `pnpm exec tsx src/perf/webgpu-abba-run.ts --port=5215 --root=<main checkout> --counts=300,600 --rounds=6 --frames=80 --wait-quiet=90 --max-load=4 --arms=G --legacy=matched --out=$C/webgpu-p3/tmp-t14b/abba-main.json`
2. The post-1205 profile, H3 and uploads (N1), port **5216**:
   `pnpm exec tsx src/perf/webgpu-submit-probe.ts --hw=metal --lock=$C/BROWSER.lock --out-dir=$C/webgpu-p3/tmp-t14b/submit-main --port=5216 --rounds=6 --frames=80 --wait-quiet=90 --max-load=4 --skip=gpu`
3. Optional, for N2: the same ABBA command as step 1 on a copy of `<main checkout>` with 1205's two `install*` lines removed
   (`_coord/webgpu-p3/tmp-t14/revert.py` is the script that did it on 715daabbb), with `--out=.../abba-1205-off.json`.
   - If the load refuses it again, N2 moves to R3, where it is read through a switch instead of a source revert.

**Decision after R2.** If the new profile no longer shows per-object refresh work (`_renderObjectDirect`, `_updateBindings`,
`_needsRenderUpdate`, `updateForRender`) and `updateMatrixWorld` near the top of G's self time, the ranking in §2 is re-done from that
profile before any code is written. That re-ranking is a short addendum to this file.

**R3 (Metal hold 2, after T14b's code is on its branch; this is G1).** It is described in §4.

---

## 4. The recommended fix: T14b, F2 and F8

### Scope (node-side, legacy untouched)

**`packages/render/src/three/backend/refresh-policy.ts`, new.**
- A pure decision function `refreshVerdict(observerVerdict, reason, prev, now): 'FULL' | 'SHARED' | 'NONE'` over plain records:
  - the world matrix's 16 numbers;
  - the geometry and material versions;
  - the declared object tuple.
- An installer that wraps the node renderer's `_nodes.needsRefresh`. The probe already reaches it as `post.pipeline.renderer`, but here
  the backend does it, on the renderer it built.
- A material declares its object inputs in a list next to P3-R3's `OBJECT_SCOPED_FIELDS`. A twin with an undeclared OBJECT-update
  node is NEVER downgraded (see G2c).

**`backend/pass-counter.ts`.** Around a nested render of the same scene, `scene.matrixWorldAutoUpdate = false`, restored on exit. This
is F8.

**`NodeBackendOptions`.**
- `refreshPolicy?: 'three' | 'parked'`, where `'parked'` is the default on a node boot.
- `matrixWalk?: 'every-pass' | 'once'`, where `'once'` is the default.
- `uploads?: 'three' | 'versioned'`, where `'versioned'` is the default. This makes 1205 switchable, for N2 and its falsification.
- A legacy boot never reads any of the three (as T13's G4).
- The measurement pages pass the non-default value only on an arm that is named as such.

**`tools/src/perf/webgpu-submit-probe*.ts` and `webgpu-page.ts`.**
- **H7**, the F2 ceiling: on the probe page only, every `hasNode`-only FULL becomes SHARED with no key check. This is unsafe for the
  picture and used for the timing only.
- **H8**: F2 itself (`refreshPolicy` three against parked).
- **H9**: F8 (`matrixWalk`).
- **H10**: 1205 (`uploads`).
- `webgpu-abba-run.ts` gains `--node-opts=<k=v,...>` for the G arm, so G1's falsification is a second ABBA on the same tree, not a
  source revert.

**Not in scope:**
- F3 and F7 (D2);
- a three patch;
- any change to `units/` or to legacy.

### How the effect is measured (R3, one Metal hold, coordinator, own port, music off, main + T14b at a named sha)

| step | what | port |
|---|---|---|
| 1 | ABBA, all switches at their defaults (the fix) | 5215 |
| 2 | ABBA with `--node-opts=refreshPolicy=three,matrixWalk=every-pass` (G1's falsification: the fix off, 1205 on) | 5215 |
| 3 | ABBA with `--node-opts=refreshPolicy=three,matrixWalk=every-pass,uploads=three` (N2, the main before 1205) | 5215 |
| 4 | The submit probe with H7-H10: the profile, the FULL and SHARED counts, H3 again. **F2 go/no-go:** if H7's G delta at n600 is inside its spread, F2 is dropped from the PR before merge and only F8 ships. | 5216 |
| 5 | Step 1 again (drift across the hold); the hold is refused if step 1 and step 5 disagree by more than their spreads | 5215 |

The CI counts, R1 again on the T14b branch, give G2a's literal. The ABBA numbers go into GH-1152 and the PR.

---

## 5. Gates, each with its falsification

**G1. The P3 exit bar (ruling 2, relaxed).**
- The measure: GH-829 ABBA, G against L-matched, the median of 6 round medians. A difference inside the spread counts as no
  difference.
- The bars:
  - n600 ≤ x1.073;
  - n300 ≤ 1.05.
- Measured on main + T14b, with triangles within 1% and 0 GPU validation errors. Whatever the fix reaches is reported. Today's
  ×1.330 / ×1.205 is the "before".
- *Falsification:* R3 step 2, the fix switched off on the same hold. The ratio must read above step 1's spread, or the fix is not
  shown. **If step 1 is over ×1.073 (expected), G1 is reported as NOT MET and D2 applies; T14b still merges if G2-G4 hold and step 2
  reads above step 1's spread.**

**G2a. F2 cuts the FULL refreshes on a parked scene.**
- The FULL-refresh count per frame on the static n600 scene must be ≤ the literal recorded on CI (SwiftShader counts are deterministic)
  after the fix. The literal is written into the probe's test once.
- *Falsification:* make `refreshVerdict` return the observer's verdict unchanged. The count returns to the R1 base (about 4000), and the
  gate goes red.

**G2b. F2 never skips a change (vitest, `refresh-policy.test.ts`, pure records).**
- Each of these gives FULL:
  - a matrix element changes;
  - the material or geometry version moves;
  - each declared tuple field moves on its own (`opacity` for a fade, `color` for team, `uRgRot` for a wheel);
  - first sight;
  - `hasAnimation`.
- Parked and unchanged gives SHARED.
- *Falsification:* drop `opacity` from the tuple. The fade case reads SHARED and goes red.

**G2c. Every OBJECT-update node of a twin is declared.**
- For each compiled P3 unit twin (the T3/T4 compile helpers), every node whose `updateType` is OBJECT must be listed in that twin's
  declared tuple. A twin that has an undeclared one is marked "never downgrade", and the test lists it.
- *Falsification:* add an object-scoped test uniform to the unit twin without declaring it. The gate goes red, because the policy would
  have downgraded that twin.

**G2d. One world-matrix walk per frame (F8; a fake renderer, like `pass-counter.test.ts`).**
- `scene.updateMatrixWorld` runs once per node frame, with a nested shadow render.
- An object moved by an `onBeforeRender` inside the outer pass still reaches the shadow pass with its new matrix: the test reads it.
- *Falsification:* remove the guard. The count is 2, and the gate goes red.

**G3. Legacy unchanged, and the twins' frames unchanged.**
- `visual` stays green with no bless.
- `visual-backends webgpu` and `webgl2` stay green. A stale uniform would move a node frame.
- A legacy boot reads none of the three new options (a counting getter, as T13's G4).
- *Falsification:* read `refreshPolicy` at the top of `ThreeRenderer.init`. The legacy spec goes red.

**G4. The switches really switch.**
- The submit probe refuses an H8, H9 or H10 variant that moved neither cost nor count on any arm (T13's `deadHypotheses` rule).
- *Falsification:* stub `matrixWalk` to do nothing. H9 reads dead, and the run refuses.

---

## 6. Lead decisions

| # | decision | facts | options | recommendation |
|---|---|---|---|---|
| D1 | Does ×1.073 stand on today's heavier scene? | P2 read ×1.073 at 10.59 M triangles. Today both arms draw 15.12 M, and the `unit-shadow-off` variant draws exactly P2's 10,586,682. So P2's matched scene most likely had no unit shadows. | (a) Keep ×1.073 on the full scene. (b) Re-read the bar on the unit-shadow-off scene, the like-for-like reading. | **(a)**: the player sees the full scene. Report the shadow-off ratio beside it as context (one probe variant already exists). |
| D2 | If F2 + F8 leave n600 over ×1.073 (expected) | The gap is -8.4 ms of G CPU at n600. F2 + F8 reach it only at their upper bound. | (a) Carry the residual to P6 with the numbers (the P3 plan's Lead decision 6). (b) F3, the unit shadow sub-mesh trim on both arms (look change, re-bless). (c) F7, merge per-role SkinnedMeshes (art). | **(a)**, with (b) read on the R3 hold as a measured variant only, never shipped, so you see its number and a before/after sheet at play zoom and close up. Open (c) as a P6 issue: it is the largest lever and helps both arms. |
| D3 | F2 on by default on node boots | Node-only. Covered by G2b-G3. `'three'` stays as the measurement arm. | on / off | **On.** |
| D4 | The n300 leg (×1.205 against ≤ 1.05) | It already fails at the P3 head. In P2 it read ×1.020. | Block T14b on it, or report it | **Report it**, under D2. It is the same CPU gap at half the units. |

---

## 7. Order of work

1. R1 on CI and R2 on Metal (coordinator); the §3 addendum if R2 re-ranks.
2. T14b (Opus, from origin/main): H7-H10 and `--node-opts` first, then F8, then F2.
   - G2a-G2d, G3 and G4 go red, then green.
   - CI: `ci.yml` and `webgpu-noise.yml probe=submit`.
3. R3 on Metal (coordinator). The numbers go into the PR and GH-1152; D2 goes to the lead.
4. T15 re-takes the ABBA at the end of its own hold.
