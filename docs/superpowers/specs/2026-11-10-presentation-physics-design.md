# Presentation-only physics with Rapier: design (GH-1223)

**Status:** design for the lead's review. This document adds no dependency and changes no code.
**Ruling it implements** (GH-1223, lead, 10 Nov 2026): relax CLAUDE.md's "no physics library" rule for VISUAL-ONLY uses.
The sim stays hand-written Q16.16. Nothing a physics library computes may be read back by the sim, sent over the network,
or influence an outcome (invariant 4).
**Order of work:** this document first. Then the dependency, the CLAUDE.md amendment and the first use land in ONE PR,
the first slice (section 4).

## Recommendation

- **Package:** adopt `@dimforge/rapier3d-deterministic-compat`, pinned to exactly `0.21.0` (no caret).
- **Where it lives:** in one folder, `packages/render/src/three/physics/**`, lazy-loaded inside the already-lazy renderer
  chunk, and never loaded on the `low` preset.
- **Clock:** step it on the SIM clock at a fixed 50/3 ms (three steps per 20 Hz tick).
- **Isolation:** give each death incident its own small world.
- **First slice:** infantry ragdolls, dark-launched (every preset 0) behind a quality field. A sandbox flag and a new
  gated scenario let the lead see them first.

Every number below was measured unless it says "estimate". The method is in the appendix.

## 1. The boundary

**May use Rapier (presentation only):**
1. **Ragdolls:** infantry figures after the sim has already decided they are dead.
2. **Debris collision:** chunks that bounce off buildings and terrain instead of the closed-form P2 flight (GH-1197).
3. **Wreck tumble:** a vehicle wreck's roll or hop after the sim's `destroyed` event, ending in a resting pose.

**Never uses Rapier:** anything the sim reads or decides.
- Hits, penetration, ricochet, splash and damage.
- Line of sight, cover, flow fields and pathing.
- Unit positions, collision between live units, and the positions of buildings, rubble or wrecks as the SIM sees them.
- A ragdoll that lands across a road blocks nothing.
- A chunk that comes to rest in a doorway blocks nothing.
- A wreck's tumbled pose is not its sim footprint.

Physics may only move `THREE.Object3D` transforms and the instance matrices the renderer already owns. It never writes
a Q16.16 value, a `SimEvent`, a command, a net message, or anything `packages/app` reads.

**Guards** (all land in the first-slice PR, in this order):
1. **Import fence, static.** A `no-restricted-imports` block in `eslint.config.mjs` bans the patterns `@dimforge/*` and
   `**/three/physics/**` everywhere EXCEPT `packages/render/src/three/physics/**` (Rapier itself) and
   `packages/render/src/three/ThreeRenderer.ts` (the one caller of the physics folder).
   - This is narrower than the brief's "`packages/render/src/three/**`": one door is easier to audit than forty files.
   - It must EXTEND the existing option objects (`APP_RESTRICTED`, the render block's `three` paths, `ROAR_FENCE`),
     never replace them, because flat config keeps one `no-restricted-imports` object per file. The roar-fence block in
     `eslint.config.mjs` already handles this.
2. **Import fence, dynamic.** `no-restricted-imports` does not see `import()`; `eslint.config.mjs` measured this itself
   (the bundle-rule comment). Slice 1 loads Rapier with a dynamic import, so a `no-restricted-syntax` selector on
   `ImportExpression[source.value=/^@dimforge\//]` carries the same ban.
3. **The physics folder imports no sim.** `packages/render/src/three/physics/**` may not import `@lions/sim`, values or
   types. `ThreeRenderer` hands it plain numbers: entity id, death tick, killer tile, the ground sampler and a bone list.
   This means a physics module cannot even name a sim type to write into.
4. **Fence test** (`tools/src/physics_fence.test.ts`), shaped like `roar_fence.test.ts`.
   - It feeds the real config one illegal import, static and dynamic, from each of these places: `packages/sim/src`,
     `packages/net/src`, `packages/worker/src`, `packages/app/src`, `packages/render/src/index.ts`, and a render file
     outside the door.
   - Each import must produce exactly one error. A legal control in `three/physics/` must produce none.
5. **Outcome test** (the invariant-4 guard, behaviour rather than structure). It runs a 600-tick sandbox fight with
   deaths through the real `ThreeRenderer` twice, physics on and physics off, and asserts the sim's per-tick state digest
   is identical.
   - The falsifier: a deliberate write-back (a ragdoll position copied into `sim.units.x`) turns it red.
6. **Bundle check.** The main chunk and the sim worker chunk contain no `rapier` string. This follows the standing
   bundle rule's precedent for three.js.

## 2. Determinism for the visual gate

The gate photographs a fixed scenario at a fixed tick, and a capture must be bit-reproducible. Today that holds because
everything in a gated frame is a pure function of sim time (`visual-gate.md`, `aftermath`: 22/22 captures at 0 px). Its
measured enemy is anything on the frame clock: `step()` advances that clock by a latched real frame time that differs
per process, and that cost `aftermath` 519–656 px before the showcase moved. Physics must therefore be a pure function of
sim history.

**The rules:**
1. **Fixed step on the sim clock.** `h = MS_PER_TICK / 3 = 50/3 ms` exactly, so three steps per tick and 60 Hz physics.
   - Each frame, the renderer computes `t = presentationSimMs(tickCount, alpha)` (`decal-maths.ts`, the clock the decal
     fades already use), then runs every owed step up to `floor((t - t0) / h)` for each incident born at sim time `t0`.
   - Frame dt is never read. When the sim is paused, `t` stops and so does physics.
   - The drawn pose interpolates between the last two steps by the fraction of `h`, which is also a pure function of
     `t`.
   - Owed steps are never dropped, because dropping one breaks determinism. The active cap (section 3) bounds their
     cost.
   - **Measured:** the same world stepped 120 times at a fixed dt reproduces exactly (y-sum 281.98439398072657, twice).
     The same world at a dt jittered ±2 ms reads 279.68…, so frame-dt stepping is visibly non-reproducible.
2. **Seeds, not randomness.**
   - **Hashed values:** `tileHash(entityId, deathTick)` salted per figure and bone gives the direction jitter, the
     spin, and the pick of the death clip (`pickDeathClips` already hashes the entity id).
   - **The impulse direction** is the killer's tile, which comes from the `destroyed` event's `by`, as
     `toppleDirection` reads it.
   - **The impulse magnitude** is a per-class number in `data/vfx/munitions.json`: data, not code.
   - No `Math.random`, no wall time.
3. **The starting pose is data, not the screen.** A live figure animates on the FRAME clock, so the pose on screen
   at death differs per process. The ragdoll therefore starts from the death clip (`fall`/`fallAlt`, or the topple)
   sampled at a fixed clip time on the sim clock. Body velocities come from finite-differencing that clip over one `h`.
   The screen crossfades from whatever it shows into the ragdoll. That crossfade is display only, and the physics never
   reads it.
4. **One world per incident.** A squad's figures killed on one tick share one Rapier world, together with a static
   collider patch: a heightfield of the drawn ground sampled from `ringHeightAt` on a 0.25-tile grid over the incident's
   4x4 tiles, plus cuboids for the standing footprints inside that patch. **Measured:**
   - **Shared world:** creating 20 unrelated ragdolls 50 m away BEFORE a test ragdoll changed that ragdoll's final bits
     (digest `f7bf1721ac55` became `f6ce0e3ff63f`); 5 did not. In a shared world, then, a death's pose depends on every
     other death on the map, including ones a versus seat cannot see.
   - **Per-incident worlds:** with 20 other worlds stepping alongside, the test ragdoll stayed at `f7bf1721ac55`.
   - Isolation is what makes the cap, fog, catch-up and camera policies below safe.
5. **The deterministic build.** `@dimforge/rapier3d-deterministic-compat@0.21.0` (Rapier's `enhanced-determinism`
   feature: no SIMD, software maths) promises identical results across platforms for identical inputs and insertion
   order.
   - **Cost:** on 16 ragdolls it read 0.714–0.717 ms per step against the standard build's 0.668–0.714 ms, with the same
     final state on this machine. The `.wasm` is 23.8 KB larger.
   - **Why pay it:** the standard build's guarantee is "same binary, same platform", and CI's `linux-x64-swiftshader`
     environment is not this Mac.
6. **Settle and freeze.** An incident freezes when every body stays under 0.05 m/s and 0.1 rad/s for 30 consecutive
   steps (0.5 s), or at 240 steps (4 s), whichever comes first. Both are counted in steps, so the freeze tick is
   deterministic.
   - On freeze, the final bone transforms are written into the corpse, the existing persistent `MeshWreck` path (the
     `MAX_MESH_WRECKS` 256 pool), and the world is freed.
   - The hard cap matters: in the bench, jointed capsule chains did not fall asleep within 4 s, and settling cost as
     much as flight.
7. **Catch-up, fog, camera.**
   - **During a catch-up** (`quiet`), a death gets today's settled corpse pose and no ragdoll. Settled state, like the
     debris and decals placed at rest.
   - **An incident in flight when a catch-up starts** runs its remaining steps synchronously when the catch-up ends
     (at most 240 × ~0.05 ms per figure), so it lands exactly where it would have landed live.
   - **Which deaths get a ragdoll:** only a death inside the view frustum and in sight at its death tick, and only while
     a cap slot is free. Slots are taken in event order (tick, then entity id). Otherwise the death uses today's
     `fall`/topple path.
   - **Why this policy is safe:** every input is fixed in a gated capture (the camera is pinned from tick 0), and
     isolation means the policy only decides WHICH incidents exist, never what any of them computes.

**Captures stay bit-reproducible.**
- Captures still freeze the frame loop at tick 0 (`lateFreezeRefusal`, unchanged), and `step()` drives the sim to the
  target tick.
- Physics state at the capture is a function of the sim's event history and `presentationSimMs` alone, both fixed by
  the scenario.
- Physics therefore adds zero run-to-run variance in one environment. Across environments the physics bits are
  identical (the deterministic build), and any pixel differences are rendering's, already keyed per environment.

**Falsifiers that prove it:**
- **Cadence test** (`physics/ragdoll-clock.test.ts`, Node, no browser). It runs one incident to sim time 2,000 ms under
  three frame cadences: a steady 16.7 ms, a steady 7 ms, and a fixed jittered list of 5–40 ms. All three per-bone
  digests must equal each other AND a committed literal.
  - The literal is the cross-platform proof: `pnpm test` runs it on macOS for developers and on Linux in CI, so a
    platform difference fails CI.
  - Mutation: stepping by frame dt instead of `t` must turn it red.
- **A new gated `ragdoll` scenario.** It uses a renderer-only showcase in the `aftermath`/`rubble` pattern:
  `RendererOptions.ragdollShowcase`, sandbox flag `&ragdoll`, no sim entity and no sim kill.
  - Incidents are dated at sim time 0 (settled by the capture) AND at 14,750 ms, so at tick 300 (15 s) some figures
    are mid-flight.
  - Two CI captures of one commit must read 0 px. On the branch, the frame-dt mutation must turn the scenario red
    across processes.
  - There is no baseline until the post-merge bless, after the lead has looked: the `fogged`/`aftermath` precedent.

**WebGL2 and WebGPU parity.**
- Physics runs once in WASM, before either backend draws. Both backends draw the same bone transforms on the same
  rigidly bound figures.
- No material, shader or `onBeforeCompile` hook is added, so the WebGPU census gains nothing to port.
- The parity job compares two backends fed the same physics bits.

## 3. Budgets

**Download** (measured from the npm tarballs, version 0.21.0):

| Package | What ships | Raw | gzip -9 | brotli -q11 |
|---|---|---|---|---|
| `rapier3d-deterministic` | `.wasm` + JS glue | 3,105,893 + 338,178 B | 1,173,133 + 33,700 B | 855,167 + 26,276 B |
| `rapier3d-deterministic-compat` (recommended) | one `.mjs`, `.wasm` inlined as base64 | 4,372,012 B | 1,659,390 B | 1,201,977 B |

- The non-compat package imports its `.wasm` as an ES module, which Vite 8 cannot bundle without another dependency
  (`vite-plugin-wasm`). Compat needs no build change and costs about 0.32 MB more brotli. That choice is decision L1.
- **Either way the cost is lazy.** The chunk is fetched only when a mission starts with a preset whose cap is above
  zero, so the menu, the board and the `low` preset download nothing.

**Init** (estimate from Node 25.9.0, Apple M3 Pro): import 25.7 ms plus `init()` 56.7 ms. The init is a base64 decode
plus a WASM compile. It runs in parallel with the GLB loads, and a failure (no WASM, a compile error) falls back to
today's death path with one console warning. **To be read in Chrome** with `pnpm perf:load` before the flag flips.

**CPU per frame.** At 60 fps there is one step per frame, and two at 30 fps. Each figure is 10 bodies (section 4).
The bench ran 11-capsule chains, a slight overestimate. Per step, in Node on an M3 Pro:

| Load | Median | p95 |
|---|---|---|
| 10 ragdolls, flight | 0.75 ms | 1.76 ms |
| 16 ragdolls | 0.67–0.72 ms | 1.15–1.70 ms |
| 30 ragdolls, flight | 1.48 ms | 2.19 ms |
| 100 ragdolls, flight | 4.82 ms | 5.65 ms |
| 256 debris boxes, flight | 0.22 ms | 0.40 ms |
| 1,024 debris boxes, flight | 0.86 ms | 1.13 ms |
| 30 ragdolls + 1,024 debris | 2.26 ms | 3.48 ms |
| 90 ragdolls, 30 per-incident worlds | 4.88–5.05 ms | — |
| 90 ragdolls, one shared world | 3.74–3.79 ms | — |

- **Isolation costs** about +32% on top of the shared world, plus 0.54–0.58 ms to create each incident's world.
- Every case reproduced its own digest on a rebuild.
- **Headroom:** the 300-unit acceptance reads 6.50–6.70 ms p95 against 16.7 ms (`PERFORMANCE.md`).

**Proposed ceilings:**
- **Cost:** physics ≤ 1.0 ms median and ≤ 2.0 ms p95 per frame on the reference Mac at the `high` cap.
- **Active caps:** `high` 16 active figures, `medium` 8, `low` 0.
- **Over the ceiling:** the cost run steps a cap down a 16/8/4/0 ladder, the way the rain and nature ladders do.

**Bench plan in the browser** (owed before the flag flips, not done here):
- **CPU:** `perf:fx` gains a physics case, the `&ragdoll` showcase at 4, 8, 16 and 32 incidents on the real
  `ThreeRenderer`, reading frame CPU median and p95 with physics on and off, on ANGLE/Metal and on CI SwiftShader.
- **Low-end:** `pnpm perf:lowend` at the same counts.
- **Safari and Firefox:** read once each, because their WASM tiers differ from V8's.

**Memory** (WASM linear memory, measured through the instance's `memory.buffer`):
- **Growth:** 1.13 MiB after init, 3.06 MiB with 16 ragdolls, and 9.19 MiB with 100.
- **High-water:** 10.06 MiB after 300 incidents were created and freed. WASM memory never shrinks, so a mission's peak
  stays after it ends.
- **Code:** separately, Node's RSS grew by ~45 MB at init and ~110 MB more after the first steps. That is compiled code,
  which Chrome reports in the process total, not in the JS heap.

Against `perf:memory`:
- **Mission ceilings** (`jsTotal` 154 MiB, process 2,511 MiB, linux): ~3 MiB at the `high` cap fits.
- **The leak check is the tight one.** `menuAfterJsTotalMiB` 70 against a 65 MiB menu leaves 5 MiB, and the WASM module
  is a singleton the renderer cannot free.
- **Proposal:** measure first. If the first `perf:memory` walk with physics on breaks `menuAfter`, raise it by exactly
  the measured high-water, with the lead's approval (decision L5), rather than widening the leak percentage.
- **Low preset:** off. The cap is 0, so the chunk never loads, no world exists, and nothing changes.

## 4. First slice: ragdolls on infantry death, behind a quality flag

**The flag.**
- **The field:** `RenderQuality.physics?: { ragdolls: 0 | 4 | 8 | 16 }` in `packages/render/src/quality.ts`. It is the
  active-figure cap; absent reads 0.
- **It ships dark:** every preset reads 0.
- **Review path:** the sandbox flag `&ragdoll` (registered in `sandbox-help.ts`'s one table, never on a mission) forces
  16 and stamps the showcase.
- **Turning it on:** the lead flips `medium` to 8 and `high` to 16 in a follow-up PR after seeing it (decision L4).

**Bones to bodies.** Infantry figures are rigid, one part per bone, with no weight painting (`mesh-units.md`), so a
bone's parts move exactly with one body.
- **The bones:** rig.py's standing topology has 12 bones under `root`: `pelvis`, `spine`, `neck`, `head`,
  `upperarm_L/R`, `forearm_L/R`, `thigh_L/R` and `shin_L/R`.
- **The bodies:** these become **10 bodies**, with `neck` and `head` merged.
  - Each body is a capsule along the bone's head-to-tail segment, except `pelvis` and `spine`, which are boxes.
  - Each body's radius comes from its own bone's vertex bounds, measured at GLB load.
  - Hands, the weapon and carried kit ride the forearm or spine they are bound to. A free-falling rifle is decision L7.
- **Joints:**
  - **Elbows and knees:** revolute, with limits (`setLimits`).
  - **Shoulders, hips, neck and waist:** spherical. Rapier 0.21's JS API exposes no cone limit, so each axis gets a
    position motor toward the death clip's pose as soft muscle tone (`configureMotorPosition`). Its stiffness decays to
    zero over 0.6 s.
  - **Contacts:** off between jointed neighbours.
- **Scale:** the world is in metres, converted at the boundary by `METRES_PER_TILE` (1 tile = 1 world unit = 3 m), so
  Rapier's tolerances stay at their tuned scale.
- **Body mass:** 80 kg split across the bodies by volume.
- **Rigs not covered:** smooth-skinned civilians and crew posed at a weapon keep today's path.

**Handoff and timeline** (sim clock, per incident):
1. **Tick of death:** the existing death clip (`fall`/`fallAlt`, or the per-figure topple) starts as today.
2. **Handoff:** at clip time 0.20 s (four steps), the bodies are created at the clip's pose, with velocities from the
   clip plus the hashed impulse from the killer's side. The screen blends from the clip into the ragdoll over 0.10 s.
3. **Settle:** the bodies settle, then freeze (section 2.6). The pose is baked into the corpse and the world is freed.
4. **Afterwards:** the corpse is today's `MeshWreck`, which is persistent and pooled.

**Tests in the slice:**
- The cadence and literal-digest test (section 2).
- The fence and outcome tests (section 1).
- **Freeze within 240 steps:** a test that always freezes within 240 steps and ends with no body under the drawn
  ground.
- **Cap and policy:** event-order slots, and off-screen or catch-up deaths taking the old path.
- **Low preset:** loads no chunk (a spy on the dynamic import).
- **The gated `ragdoll` scenario:** a pending check with infinite floors, as for `rubble`.

**Later slices, each its own PR and its own lead look:**
1. **Debris collision:** P2's pool, with resting chunks fed from Rapier.
2. **Wreck tumble.**

Neither changes the boundary.

## 5. Proposed CLAUDE.md wording

This replaces line 158 ("Do not add a game engine, ECS library, or physics library. The sim is hand-written on purpose;
determinism cannot be delegated."). It lands in the same PR as the first use:

> - Do not add a game engine or ECS library, and never let a physics library near the sim. The sim is hand-written on
>   purpose; determinism cannot be delegated. **One exception, for presentation only** (GH-1223, the lead, 10 Nov
>   2026): Rapier (`@dimforge/rapier3d-deterministic-compat`, pinned exactly) may drive ragdolls, debris collision and
>   wreck tumble from `packages/render/src/three/physics/**` and nowhere else (lint-fenced, `physics_fence.test.ts`).
>   Nothing it computes may be read by the sim, sent over the network or change an outcome (invariant 4); hits,
>   ricochet, penetration, LOS and pathing stay in the sim. It steps on the sim clock at a fixed 50/3 ms, never on frame
>   time; it is never loaded on `low`; a version bump is its own PR and re-blesses the `ragdoll` scenario. Design:
>   `docs/superpowers/specs/2026-11-10-presentation-physics-design.md`.

## 6. Licence and attribution

**Licence:** Apache-2.0, checked in each package's `package.json` and `LICENSE` for all six 0.21.0 variants.
- Apache-2.0 code may ship inside this PolyForm-Noncommercial project, provided its terms are met.
- **No runtime dependencies on npm:** the package lists none.
- **Provenance:** the tarball carries an npm SLSA v1 provenance attestation and was published by `sebcrozet`, Rapier's
  author.

**Obligations (section 4 of the licence):**
- **4(a), a copy of the licence:** ship the licence text with the build, for example `assets/licenses/rapier.txt`,
  linked from the credits screen.
- **4(b), 4(c):** nothing to do. The code is used unmodified (only minified by the bundler), and the licence text
  ships beside it under 4(a).
- **4(d), NOTICE:** none required. The package has no `NOTICE` file (checked: `LICENSE`, `README.md`, `package.json`,
  the dist files).

**Attribution:**
- **Credits line:** "Rapier physics engine, © Dimforge, Apache-2.0", beside `three`. The credits screen lists only
  `three` today.
- **Fix the Draco gap at the same time:** that gap is `ASSET_PROVENANCE.md`'s open item 8, the Draco decoder's
  Apache-2.0 notice.

**Crate audit.** The `.wasm` statically links Rust crates, including nalgebra, parry and wasm-bindgen, all permissive
as far as is known. The npm package declares Apache-2.0 only.
- **Where the code lives:** the JS bindings moved into `dimforge/rapier` (`bindings/`) in July 2026, and
  `dimforge/rapier.js`'s newest tag is `v0.19.3`.
- **Owed:** the dependency PR runs a crate-licence audit against the `Cargo.lock` of the commit published as 0.21.0. It
  was not done here, because there is no Rust toolchain in scope.

## 7. Risks and lead decisions

**Decisions** (each with a recommendation):

| # | Decision | Recommendation |
|---|---|---|
| L1 | Compat (base64-inlined) or non-compat (`.wasm` plus `vite-plugin-wasm`) | **Compat**: no build plugin, about +0.32 MB brotli, lazy |
| L2 | Deterministic or standard build | **Deterministic**: same speed measured, +23.8 KB, cross-platform guarantee |
| L3 | One world per incident, or one shared world | **Per incident**: a shared world's bits depend on unrelated deaths (measured); about +32% CPU |
| L4 | Presets: ship dark (all 0), then medium 8 / high 16 after the lead's look | **Yes**: low is always 0 |
| L5 | `perf:memory`: if `menuAfter` breaks, raise it by the measured WASM high-water | **Yes**, by the measured amount only |
| L6 | A new gated `ragdoll` scenario (renderer-only showcase, mid-flight and settled figures at tick 300) | **Yes**: the strongest determinism falsifier the gate can hold |
| L7 | Rifle stays in hand, or becomes a free body | **In hand** for slice 1 |
| L8 | The CLAUDE.md wording in section 5 | **Adopt as written** |

**Risks:**
- **Scope creep into gameplay** ("let the body block the bullet"). The fences, the outcome test and the CLAUDE.md
  wording make that a red build, not a review comment.
- **A silent determinism break** (someone steps on frame dt). The cadence test, the literal digest on two platforms
  and the gated scenario each catch it.
- **Version churn:** 0.20.0 to 0.21.0 took seven weeks. The exact pin and the "a bump is its own PR" rule contain it;
  a bump may move every ragdoll bit.
- **Memory high-water and the leak ratchet** (section 3, L5).
- **Load time:** an extra 1.2 MB brotli and about 80 ms init on missions with physics on. It is lazy and runs in
  parallel, and it is read by `perf:load` before the flag flips.
- **Ragdoll look:** limp "noodle" bodies read badly at RTS zoom. The motors toward the death clip and the 4 s freeze
  exist for this, but the tuning needs the lead's eye, which is why the slice ships dark.
- **Unmeasured engines:** Safari and Firefox WASM speed has not been measured. Their caps follow from their own
  readings.

## Appendix: how the numbers were taken

- **Where:** a scratch npm install outside the repository (`$TMPDIR/opencode/rapier`), Node 25.9.0, Apple M3 Pro,
  10 Nov 2026.
- **Package facts:** sizes and licences come from `npm view` and the unpacked 0.21.0 tarballs, compressed with
  `gzip -9` and `brotli -q 11`.
- **Bench:** the bench scripts built 11-capsule spherical-joint chains and 0.30 x 0.10 x 0.20 m debris cuboids on a
  ground slab with 20 static building boxes.
  - **Steps:** 300 steps at 1/60 s, or 50/3 ms where the text says so. The flight figures cover the first 60 steps;
    the settle figures cover the last 240.
  - **Digests:** SHA-256 of every body's `Float64` translation and rotation, compared across a rebuild.
  - **Memory:** linear memory was read off the instance's exported memory by wrapping `WebAssembly.instantiate`.
- **What these are not:** browser numbers. Section 3's bench plan is owed before the flag flips.

## Slice 1 as built (GH-1223, the follow-up PR)

The lead approved L1-L8 as recommended. Where the build differs from the text above, and why:

- **11 bodies, not 10.** Section 4 counted 12 bones less the merged neck and head as 10; it is 11 (pelvis, spine,
  neck+head, two upper arms, two forearms+hands, two thighs, two shins+feet). The mapping is structural, never by
  name: a body is a LINK bone (one with a bone child) under a figure root.
- **Ball joints have limits after all** (+-1.0 rad per angular axis, about the handoff pose). Rapier 0.21's JS
  `SphericalImpulseJoint` declares per-axis motors but its runtime class has none; the joint set's own entry points
  (`jointSetLimits`, `jointConfigureMotorPosition`) do both, and the code calls them.
- **The push is a per-class number** (follow-up, GH-1223): `ragdoll_push` (`horizontal_m_s`, `up_m_s`) on a class row of
  `data/vfx/munitions.json`, read by the killer's last-fired weapon's class (`ragdollPushForWeapon`). A class with no
  row, an unmapped weapon (a rifle) and a death with no known killer take the old constant (1.0 / 0.4); the +-30%
  hashed spread stays in code. Slice 1 shipped it as a constant because that file was not on `main` yet.
- **The fence is its own eslint rule** (`tools/physics_fence.mjs`), not more `no-restricted-imports` patterns: a later
  block would replace those, and they do not see `import()`.
- **The outcome guard** (guard 5) is `ThreeRenderer.ragdoll.test.ts`: the sim's hash, tick by tick, with the ragdolls
  on and off. **The bundle check** (guard 6) is a finding of the existing bundle census (`tools/src/perf/bundle-census.ts`,
  `pnpm --filter @lions/tools webgpu:bundle`): Rapier is exactly one chunk, reached only by `import()`, never the entry
  or its static closure. Read on this branch: `rapier-*.js` 4,262 KiB raw / 1,622 KiB gzip, lazy; the main chunk clean.
  The census is a manual driver, not a CI job.
- Measured in Node on the shipped rigs: an `inf_squad` figure falls to a pelvis height of about 0.1 m within 1-2 s;
  every incident so far reaches the 240-step cap before the quiet rule (jittering contacts). The look is the lead's to
  judge on `&ragdoll`, which is why the slice ships dark.

