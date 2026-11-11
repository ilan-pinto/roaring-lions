# Soft particles: depth-faded flipbook smoke, dust and fire (GH-1227)

Status: design, plus slice 1 (WebGL2 smoke pass, behind a flag that is off by default). 11 Nov 2026.
Owner: renderer lane. Skill consulted: `rts-art-direction` (readability at play zoom, FX unlit by design, HDR gains in one table).

## 1. The problem

The flipbook billows (`units/flipbook-fx.ts`) are camera-facing quads. Where a quad passes through the terrain or a wall the depth
test cuts it along a hard, straight line. Today the only mitigation is the 0.32-size lift (D10 of Defilade T4, "soft ground
intersection deferred"): it hides the cut against flat ground, but it fails on slopes, on terraces, against a wall and for every
billow that drifts sideways into a building. The fire pass (`depthTest: false`) has no cut, but it has the opposite fault: it draws
over the wall it is behind.

Soft particles fix the cut: each fragment's alpha is multiplied by a fade that is 0 where the billow touches the opaque scene and 1
a short distance in front of it. The billow then meets the ground in a soft band.

Constraints from the issue and CLAUDE.md: cheap; read the depth the chain already has; WebGL2 plus a TSL twin; presentation only;
palette and HDR gains unchanged (the fade multiplies ALPHA only, never colour); measure the visual-gate move first; every new check
shown failing once.

## 2. The technique

Per fragment of a soft layer:

```
sceneDepth = texture(uSoftDepth, gl_FragCoord.xy / drawingBufferSize).x   // window depth of the opaque scene, 0..1
gap        = (sceneDepth - gl_FragCoord.z) * (far - near)                // world units: the camera is orthographic
range      = max(0.05, 0.35 * billowSize)                                // world units
soft       = smoothstep(0, range, gap)
alpha     *= soft
```

- **Orthographic, so linear.** `dimetricCamera` is an `OrthographicCamera`, so window depth is linear in view z and a depth
  difference times `far - near` is a distance in world units. No `perspectiveDepthToViewZ`, no reconstruction. If the camera ever
  became perspective, `softParticleFadeOps` is the one place that changes (three's `perspectiveDepthToViewZ` on both depths).
- **The band scales with the billow.** A fixed band is either too soft for a muzzle puff or too hard for a kill column. 0.35 of
  the drawn size (the size the vertex stage already computes, times `uQuadScale`) with a 0.05-unit floor reads as "the bottom
  third of the billow thins into the ground". Lead decision D5.
- **Shared maths.** `softParticleFadeOps<T>(o: Ops<T>, ...)` in `three/soft-depth.ts` is written once against `Ops<T>` (the
  GH-943 pattern); the GLSL copy `SOFT_PARTICLE_GLSL` carries the same constants, pinned by a test, and the node twin will take the
  Ops body through `material-maths.ts`.
- **Spliced, not `#ifdef`ed.** `softFlipbookShaders` splices the fade into the smoke pass's shipped `VERT`/`FRAG` text at three
  anchors that must each occur exactly once (else it throws). With soft particles off the material carries the shipped text byte for
  byte, which is the strongest available proof that nothing moves.

Which layers (D3, D4):

| layer | today | soft? |
|---|---|---|
| flipbook SMOKE pass (smoke, dust tint, oil soot, dirt) | band 5, depth-tested | **yes: slice 1** |
| flipbook FIRE pass (fire, sparks) | band 5.5, `depthTest: false`, engulfs its hull | no (D3); at most its late soot phase |
| `ParticleInstancer` debris dust | band 2, depth-tested | yes, later slice (same snapshot) |
| collapse shroud, smoke screen (`smoke-mesh.ts`) | band 5, `depthTest: false` | no (D4): smoke is cover; a depth fade would thin the screen where it meets the ground, which is where it hides a unit, and weaken how it reads as cover |
| explosion-burst mesh, plumes | fallback paths only once atlases are in | no |

## 3. The depth source

The depth the chain already has is the composer target's `depthTexture`. The flipbook draws INTO that target during `RenderPass`,
with that texture attached, and sampling an attached texture is a WebGL2 feedback loop (INVALID_OPERATION, draw dropped) even with
depth writes off. The fog pass can read it only because it runs after `RenderPass`, writing into the other buffer. So the depth must
be copied, or the soft layers must move out of `RenderPass`.

Options considered:

| option | new rendering | draw order | cost | verdict |
|---|---|---|---|---|
| **A. Mid-pass snapshot (sentinel)** | none | unchanged | one depth blit + one render-pass break, only while smoke draws | **recommended, built in slice 1** |
| B. Move soft layers to a pass after `RenderPass` (colour-only framebuffer on the same colour texture, depth sampled freely) | one small pass | soft layers draw AFTER the silhouette (band 6): smoke would wash the occlusion outline, which `render-order.ts` puts above smoke on purpose | one pass break | rejected: breaks the band-6 rule |
| C. Previous frame's depth (the other composer buffer, or GTAO's) | none | unchanged | free | rejected: lags a frame; every pan and every collapse ghosts |
| D. Ground height-field fade (the rain batch's `heightTexels` texture, `units/rain-batch.ts`) | none | unchanged | ~0: one filtered fetch, no pass break | fallback for `medium`/`low` (D2): fades against the ground only, walls stay hard |
| E. Depth pre-pass | a full scene depth render | unchanged | a scene's worth of draws | rejected: the issue says reuse |

**Option A, as built.** `SoftDepthSnapshot` owns a depth texture of the composer's format (`DepthStencilFormat`,
`UnsignedInt248Type`: a depth blit needs a match) and a sentinel mesh at `SOFT_DEPTH_SNAPSHOT_RENDER_ORDER = -2`, the first
transparent draw (three draws every opaque object before any transparent one, so at that moment the depth attachment holds exactly
the opaque world). The sentinel draws zero vertices and writes no colour, depth or stencil. Its `onBeforeRender`:

1. reads `renderer.getRenderTarget()`; copies only if it is one of the composer's two buffers (so `photographGround`, a capture view
   or GTAO's G-buffer, which hides it anyway as a non-occluder, never touch the snapshot);
2. resizes the snapshot to match, `initRenderTarget`, `copyTextureToTexture(src.depthTexture, snapshot)` (three r186 does a
   `blitFramebuffer` of the depth bit for a depth texture);
3. `setRenderTarget(src)`: the copy leaves no framebuffer bound, and every later transparent draw must land back in the scene target
   (the same restore three's own `Reflector` does from its `onBeforeRender`).

`sync([flipbook.mesh])` runs each frame after `flipbook.step`: the sentinel is visible only while the smoke pass is, so an idle
frame takes no snapshot and pays nothing.

## 4. Cost on the Metal machine (estimate, to be measured: gate G-cost)

Conditions as in `docs/PERFORMANCE.md` "Defilade T4": Apple M3 Pro, ANGLE/Metal, CSS 1440x900 at DPR 2 (2880x1800, 5.18 Mpx),
`high` at 12.5-13.1 ms median on the reference views.

| term | when | estimate |
|---|---|---|
| depth blit | smoke live | Apple GPUs have no D24S8, so ANGLE backs it with Depth32Float_Stencil8 (5-8 B/px): 26-41 MB read + the same written |
| render-pass break | smoke live | the blit ends the Metal render encoder mid-scene: colour (RGBA16F, 41 MB) and depth/stencil (26-41 MB) are stored and then reloaded when the transparents resume: ~135-165 MB |
| total traffic | smoke live | ~190-250 MB a frame; at the M3 Pro's ~150 GB/s, **about 1.2-1.7 ms** at DPR 2, **0.3-0.5 ms** at DPR 1 |
| fragment | per smoke fragment | one nearest fetch and ~6 ALU on top of two atlas taps and two 4-octave fbm chains: about 5-10% of the flipbook's own fill, which a 432-billboard burst measured at ~1.2 ms at `high`: **~0.1 ms** |
| idle | no smoke on screen | **0**: the sentinel is not drawn, no program changes |

So **~1.3-1.8 ms at DPR 2 while smoke is on screen, 0 otherwise**. Two risks the measurement must clear:

- **The `medium` target-switch cliff.** PERFORMANCE.md's bloom bisect found `medium` jumping +7.5 ms from render-target switches and
  clears alone, cause unexplained. A mid-pass break may hit the same cliff. G-cost reads `medium` as well as `high`.
- **ANGLE's depth blit path.** If ANGLE implements the depth blit as a draw rather than an MTLBlitCommandEncoder copy, the blit term
  doubles. Still under the total's upper bound; measured, not assumed.

Instrument: `tools/src/perf/render-frame-cost.ts --stress` (24 Grad landings, 432 billows, frozen), flag on against off, high and
medium, 3 runs interleaved, load under 6; falsified by hiding the `flipbook` layer (the delta must vanish).

## 5. The WebGPU twin

**Built in slice 1 (lead ruling, 11 Nov: the same-PR twin rule holds), switched off like the WebGL side.**

- **Maths:** `softParticleFadeOps` is in `material-maths.ts`'s `flipbook` slot (`softOps`). `createNodeFlipbookMaterial` builds the
  fade on the SMOKE pass only, and only when the legacy record carries `uSoftDepth` (only `setSoftDepth`, so only
  `quality.softParticles`, puts it there). Otherwise none of it is built: the default smoke and fire programs (GLSL and WGSL, vertex
  and fragment) are pinned by hash to the shipped twin's, taken before the change (`flipbook-soft.node.test.ts`).
- **What the twin samples:** the INJECTED depth texture in the record (`uSoftDepth`, a late texture tap like the atlases, a
  statement in uniform control flow, compiled as `texture_depth_2d`), at `screenUV` (normalised and flip-correct on both backends,
  so `uSoftInvSize` has no twin), against the fragment's own orthographic window depth
  (`viewZToOrthographicDepth(positionView.z, cameraNear, cameraFar)`), with `uSoftSpan` re-read from the record (the node renderer
  also calls the smoke mesh's `onBeforeRender`, which writes it).
- **What is NOT built: the node backend's copy that fills it.** three's `viewportDepthTexture()` would copy the pass's depth
  mid-pass, but our scene pass is `depth24plus-stencil8` (`post-chain.node.ts`), and WebGPU's copy rules do not allow copying the
  depth aspect of a `depth24plus` format. Two ways out, for the later slice, in order: (W1) switch the scene pass to
  `depth32float-stencil8` (an optional feature, present on Apple), whose depth aspect is copyable; (W2) copy by a full-screen draw
  that samples the depth through a depth-only view (the view the GH-943 patch already makes) into an R32F target. Either needs its
  own Metal read.
- **So on the node backend `softParticles` stays inert**: `ThreeRenderer.init` returns before the wiring on the node path, no
  `setSoftDepth` runs, and the twin builds its shipped graph. The copy slice wires it and adds the test that pins the copy.
- **Slice 3, as built: W1.** `soft-depth.ts`'s `NodeSoftDepthCopy` is the same sentinel at the same band; its `onBeforeRender`
  calls the node renderer's `copyFramebufferToTexture` into a `depth32float-stencil8` texture of its own (three's WebGPU backend
  ends the scene render pass, copies on the same encoder, and resumes the pass with `load`: the path three's own
  `viewportDepthTexture()` takes). The scene pass renders `depth32float-stencil8` only while that copy exists: one predicate,
  `post-chain.node.ts`'s `nodeSoftDepthOn` (the flag AND a WebGPU device with the feature), picks the pass format in the node
  backend and gates the copy in `ThreeRenderer.init` (through `RenderBackend.softDepthOn`), before adoption, so the smoke twin is
  built with the copy's texture. Off, or on a device without the feature, or on the node-WebGL2 arm: no copy, today's pass, and the
  chain's compiled programs are main's (pinned by hash). W2 was not taken: a full-screen draw cannot run mid-pass through three's
  public API without splitting the scene pass in two (a nested `render` is a separate command buffer, submitted BEFORE the outer
  pass's opaque draws, so it would read last frame's depth); W1 changes nothing while the flag is off. The Metal read
  (G-twin-copy) is still pending.

## 6. How the golden baselines move

Slice 1: **none move.** The flag is off on every preset (pinned), so no sentinel is built and every program is the shipped text byte
for byte (pinned).

When the flag turns on at `high` (the capture preset), a scenario moves only if a flipbook smoke-pass instance is live in frame at the
capture tick:

| scenario | gated? | expected | why |
|---|---|---|---|
| `combat` | report-only | **moves** | tick 600 of a real fight: kill columns, muzzle smoke, impact dust |
| `aftermath` | **gated** | **may move** | at tick 300 the sandbox force is firing (PERFORMANCE.md, Defilade T4 item 3); muzzle recipes (`fire_apfsds`, `fire_heat`) spawn smoke-pass billows |
| `dusk` | report-only | expected still | `quiet`'s framing; nothing fires in shot |
| `quiet`, `open-ground`, `relief` | gated | expected still | the force spawns outside the shot or only walks |
| `vehicle`, `kitted`, `fogged`, `graded` | gated | expected still | idle vehicles at tick 140 |

"Expected still" is a prediction, not a measurement: the slice that flips the flag runs CI with it on, reads `meanAbsChannelDelta`
per scenario against the flag-off run, attributes any move with the `flipbook` layer A/B, and the lead sees the pictures before the
bless (`visual-baseline-bless`, from CI numbers). No threshold is widened.

## 7. Gates

Slice 1 (built, each mutation run red once; the commit message lists them):

| id | gate | test | falsification (one-line mutation) |
|---|---|---|---|
| G1 | the fade's maths: 0 at contact and behind, smooth inside, 1 past the band, band scales with size, floor holds | `soft-depth.test.ts`, literal readings | band constant 0.35 -> 0.3: red; drop the `* depthSpan`: red |
| G2 | the GLSL carries the same constants and expression | `soft-depth.test.ts` | band constant change: red (same run as G1) |
| G3 | the snapshot copies only from a target it was given, never the canvas | `soft-depth.test.ts` | delete the `sources.has` guard: red |
| G4 | the scene target is rebound after the copy | `soft-depth.test.ts` | delete `setRenderTarget(src)`: red |
| G5 | the sentinel changes no pixel (zero vertices; no colour, depth, test; out of AO and shadows) | `soft-depth.test.ts` | `colorWrite: true`: red |
| G6 | the sentinel is the first transparent draw (below every band) | `soft-depth.test.ts` | band -2 -> -1 (ties `WORLD`): red |
| G7 | idle costs 0: the sentinel draws only while a consumer does | `soft-depth.test.ts` | `some` -> `every`: red |
| G8 | off is the shipped program and uniform record, exactly; on-then-off restores it | `flipbook-soft.test.ts` | leave `uSoftSpan` behind on off: red |
| G9 | on splices the fade into the smoke pass; the fire pass is untouched | `flipbook-soft.test.ts` | skip the fragment splice: red; splice the fire material: red |
| G10 | the camera span is `far - near` | `flipbook-soft.test.ts` | `far` alone: red |
| G11 | the splice refuses a missing or repeated anchor | `flipbook-soft.test.ts` | drop the repeat check: red |
| G12 | no preset turns it on | `flipbook-soft.test.ts` | `softParticles: true` on `high`: red |
| G13 | the depth copy runs with the scissor test off and restores it (a blit honours the scissor) | `soft-depth.test.ts` | delete the disable: red |
| G14 | `FlipbookFx.dispose` turns soft particles off, so no uniform keeps the freed snapshot texture | `flipbook-soft.test.ts` | delete the call in `dispose`: red |
| G15 | the smoke mesh hook is chained, not overwritten, and comes back when soft particles go off | `flipbook-soft.test.ts` | overwrite instead of chaining: red |
| G16 | D4 gives the corrected reason (thinning at the ground, not hiding behind walls) | `soft-depth.test.ts` | restore the old wording: red |

Disclosed survivor: the `ThreeRenderer.init` wiring (`quality.softParticles === true`) has no unit test, because no
`ThreeRenderer` test calls `init` (it needs a live context). Mutating the condition to `!== false` would survive the unit tests (not run: no test reaches that line); G12 plus
the unchanged CI baselines are what hold it. The spliced program was compiled once with `glslangValidator` as GLSL ES 3.00 (vertex
and fragment both clean; a misspelt identifier in the splice failed), which is a compile check, not a picture.

Twin gates (slice 1, `units/flipbook-soft.node.test.ts`; each mutation run red once, listed in the commit message):

| id | gate | falsification (one-line mutation) |
|---|---|---|
| T1 | off: the default smoke and fire twins compile to the shipped programs (four hashes), and after on-then-off too | build the fade whenever the pass is smoke: red |
| T2 | on: the fade samples the injected `uSoftDepth` at `screenUV`, through its statement var, with the record's `uSoftSpan` | tap `uSmokeAtlas` instead: red; tap at the atlas uv: red; drop `.toVar()`: red; a literal span: red |
| T3 | on: the fade's value reaches the alpha | compute the fade but do not multiply: red |
| T4 | the fire pass never fades, even handed a record with the soft uniforms | drop `pass === 'smoke'`: red |

Slice 3 gates (`soft-depth.node.test.ts`, `ThreeRenderer.soft-depth-node.test.ts`; each mutation run red once, listed in the commit
message):

| id | gate | falsification (one-line mutation) |
|---|---|---|
| C1 | the copy is wanted only for the flag AND a copyable device; no preset turns it on | drop `&& copyable`: red |
| C2 | off: the node scene pass is depth24plus-stencil8, the pass list and the chain's compiled WGSL equal main's literals | `nodeSceneDepthType` always `FloatType`: red; ACES -> Neutral in the output: red |
| C3 | on: the scene pass is depth32float-stencil8, the copy's own format; passes and programs unchanged | the copy texture `UnsignedInt248Type`: red |
| C4 | the copy reads only the current scene pass target, of its own type, recreates on resize, into its own texture | drop the target guard / the type guard / `needsUpdate` / copy into `depth`: each red |
| C5 | the smoke twin taps the texture the copy fills (`texture_depth_2d`) | copy into the source's texture: red |
| C6 | three's own `RenderList` order: opaque draws, then the copy, then the smoke pass, at any billow depth | sentinel `transparent: false`: red; band -2 -> 6: red |
| W1 | off (every preset; the flag without the feature), a node boot adds no sentinel and adopts the shipped smoke twin | gate on `quality.softParticles` alone: red |
| W2 | on, the boot adds the sentinel and the boot-built smoke twin taps the copy | drop `scene.add(sentinel)`: red; drop `setSoftDepth(copy)`: red |

Disclosed survivor: `node-backend.ts` (it needs a live `WebGPURenderer.init`) is not unit-tested, so dropping its `softDepthCopyable`
argument to `createNodePostChain`, or its `isGpu &&`, survives these tests. The first would leave the pass at depth24plus-stencil8
while the copy exists, and C4's type guard then refuses every copy: no backend error, but the copy's texture is never filled, so
the fade reads every billow as behind the scene and the smoke pass draws nothing (flag on only). G-twin-copy, on Metal, is what
holds it.

Later slices:

| id | gate | falsification |
|---|---|---|
| G-cost | flag on vs off, `high` and `medium`, DPR 2, `render-frame-cost.ts --stress`; within the budget the lead sets (D2) | hide the `flipbook` layer: the delta must vanish |
| G-visual | a reference-free layer check (`BaselineSpec.layerChecks`): a `soft` toggle on a frame with a billow on the ground changes the frame by a calibrated floor | force `soft = 1.0` in the splice: the check must go red |
| G-palette | HDR gains and colours unchanged: the fade multiplies alpha only | multiply `col` by `soft`: a colour-identity test (a fully-in-front fragment's colour equals today's) goes red |
| G-twin-copy | node backend fills the snapshot (W1 or W2) and the twin's fade matches the legacy one on a Metal read | hide the `flipbook` layer: the delta must vanish |
| G-baseline | CI report of every scenario with the flag on, read by the lead before any bless | the flag-off CI run must read zero on every scenario |

## 8. Slices

1. **This PR.** WebGL2 snapshot and smoke-pass fade, flag off on every preset; design.
2. `&soft` sandbox flag (`sandbox-help.ts`) for an A/B look; G-cost on Metal; the lead's one Metal browser check.
3. The node backend's depth copy (section 5, W1 or W2) and G-twin-copy; the twin's fade itself is built in slice 1.
4. `ParticleInstancer` debris dust on the same snapshot (D4).
5. Flip on at the presets the lead picks (D2); G-baseline; bless from CI after the lead sees it.

## 9. Lead decisions

| id | decision | options | recommendation |
|---|---|---|---|
| D1 | depth source | A mid-pass snapshot / B post-pass soft layers / C last frame / D ground height-field / E pre-pass | **A** (no new rendering, no order change); D as the cheap tier if G-cost fails on `medium` |
| D2 | which presets get it | high / high+medium / all; budget | **`high` only**, budget 2 ms at DPR 2 with smoke on screen; `medium` only if G-cost shows no cliff; `low` never (or D); the reviewer suggests D, the ground height-field, as the `medium` tier: a later slice weighs it |
| D3 | the fire pass | no fade / fade the late soot phase only / full fade | **no fade**: a fireball engulfing its hull is the authored look; revisit soot-phase-only after slice 5 |
| D4 | other layers | debris dust / collapse shroud / smoke screen | **debris dust yes** (slice 4); **shroud and smoke screen no**: smoke is cover, and a depth fade would thin the screen where it meets the ground and weaken how it reads as cover (accepted 11 Nov; reason corrected per the reviewer) |
| D5 | band width | 0.35 x billow size, 0.05-unit floor | **keep**, retune by eye in the slice-2 Metal check |
| D6 | half-resolution snapshot | full / half | **full**: half saves only the blit term (~25%) and needs a hand-written scaled blit; revisit if G-cost misses |
| D7 | the 0.32 lift (D10) | keep / lower now that the cut is soft | **keep** until slice 5: lowering it moves every flipbook frame, a separate look decision |
| D8 | baselines | bless the move when the flag turns on | **yes, from CI, after you see `combat` and `aftermath`**, in the slice that flips it, its own PR |
| D9 | re-baked atlases (the issue's optional art task) | now / later | **later, separate task**, our own bakes against `explosion-physics`, never another game's textures |
