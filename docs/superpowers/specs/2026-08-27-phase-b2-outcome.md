# Phase B2 outcome — what B3 inherits

**Date:** 2026-08-27
**Issue:** 123
**Plan:** `docs/superpowers/plans/2026-08-27-three-renderer-phase-b2.md`
**Predecessor:** `docs/superpowers/specs/2026-08-26-phase-b1-outcome.md`
**Commits:** `e2e571d..b6ee09d`, eighteen commits on `feat/three-renderer`

B2 delivered what it set out to: under `?renderer=three` the whole map draws — ground at true
elevation, slope faces, grain, cover, knolls, ridges, roads, groves and buildings — as real 3D
geometry, and **every vertex colour is a palette entry**, asserted across all five shipped maps.
Pixi remains the default and its behaviour is unchanged.

Two user decisions shaped it: a real height mesh with Pixi's flat tones (no lighting; slopes
read by silhouette), and ground *plus* all decor rather than the ground alone.

---

## The ruling everything else rests on

**Pixi's alpha composites are not palette colours.** Open ground is drawn at `0.92 + rnd*0.08`
over the clear colour, a road tone at `0.85` over that, `underBuilding` at `0.22` over that.
Every one of those blends is off-palette. Reproducing them faithfully would have put
off-palette colour across most of the screen — exactly what Phase 0 measured and B1 installed a
pipeline to prevent.

So B2 composites the way Pixi does and then **snaps the result to the nearest palette entry**.
`quantise` is total by construction: on any input, including malformed hex, the distance
comparison never updates and it returns `palette[0]`. Every builder asserts palette membership,
and `terrain-parity.test.ts` asserts it over real map data.

One consequence worth knowing: quantising Pixi's per-tile jitter collapsed it to **exactly two**
arid tones, which read as a visible checkerboard — the tile grain that replaced it is what
carries the texture now. The jitter was dropped. If terrain ever wants finer tonal variation the
answer is a longer ramp in `palette.json`, a data change, not code.

## What B3 inherits

**1. `rebuildTerrain()` is all-or-nothing and costs 114–179 ms** — `buildScatter` is 97–145 ms
of that. Today it runs once, at boot. Pixi sets `terrainDirty` on **every structure-damage
event** (`renderer.ts:853`, `bumpStructureWear`), not only on destruction. **Wiring `onEvents`
the way Pixi does gives a ~150 ms full-scene stall several times a second in a firefight against
a building.** Per-structure sub-meshes or a dirty-region rebuild must land *before* events are
wired, not after.

Related, and the reason it matters beyond one mission: scatter costs ~50 µs/tile, so a 128×128
map — the larger maps this migration exists for — is a 700 ms–1 s boot hitch.

**2. Damage tint is baked into vertex colours.** `buildings.ts` computes
`wear = 0.45 + 0.55 * integrity` at build time, so with no rebuild walls never darken at all.
That is a wider version of the destroyed-structure gap: a destroyed structure stops being drawn
entirely, because `destroyStructure` unblocks its footprint and the tile loop only reaches a
structure on a blocked tile. Both close together when `onEvents` is wired.

**3. The epsilon depth scheme does not survive a second source of coplanar geometry.**
`grove.ts` resolves exact ties between crown lobes with world-Y nudges of 0.005–0.04 (0.2–1.6
screen px). That works only because every quad of one tree is coplanar and the camera is fixed.
A unit billboard on a grove tile sits in the same Y band as the crown, so unit-vs-tree order
falls back to ground X/Z — **an exact tie for a unit standing at the tree's own anchor.** B3
needs an explicit convention (renderOrder bands, or polygonOffset); the epsilons cannot
arbitrate it.

**4. Trees are already billboards — baked ones.** Each quad is built with "right" =
`screenOffsetToWorld(px, 0)` and "up" = world +Y: the camera's orientation frozen into static
vertices, with tree height additionally scaled by `clampCenterToTile`'s containment factor. If
B3 picks `THREE.Sprite` or a shader billboard for units, the scene carries **two billboard
conventions with different depth semantics**, and nothing tests that the tree one still matches
the camera.

**5. There is no terrain-height query on the three side.** `ThreeRenderer.worldToScreen` omits
`lift` deliberately — right for the seam, useless for standing a unit on a terrace. Pixi's
equivalent is `groundOffset` (`renderer.ts:706`). The only elevation lookup in `three/` is a
private five-line `levelAt`, copy-pasted into four builders and the parity test. **Promote it
before B3 makes it six.**

**6. Duplication B3 multiplies if it does not consolidate first:** `hexToUnit` ×4, `levelAt` ×5,
`pushQuad` ×3 closures plus `pushPolygon`, `rectCorners` ×2, `MARK_EPSILON` ×3, `DECOR_*` ×4.
Two are already identified and deferred *to B3 specifically* because closing them means editing
`ThreeRenderer.ts`, which B2's later tasks were barred from: `structureFootprintsFor` in the
parity test is byte-identical to `ThreeRenderer.structureFootprints()`, and `TERRAIN_THEMES` is
a verbatim copy of `main.ts:480-546` (all 40 tone keys diffed identical today). Both drift
quietly rather than loudly.

Worse for navigation than for correctness: `screenOffsetToWorld` — the projection primitive
that grove *and* buildings depend on — lives in `scatter.ts`, the grain module; and
`WORLD_PER_LEVEL` lives in `ground.ts`.

**7. Fog has nowhere to go, and that is B3's problem, not B4's.** Colour reaches the GPU only as
a baked vertex attribute through one shared `MeshBasicMaterial`. Per-tile fog needs either the
150 ms rebuild or a replacement shader sampling a fog texture — and that shader must preserve
Phase 0's palette-exactness proof. **Decide the material strategy in B3**, while units are being
designed, rather than discovering it in B4.

**8. The toon shader has still never been compiled by a GL driver.** `toonRampMaterial` from B1
remains exported, tested for its uniform data, and used by nothing. B2 is unlit by design, so
the first real GLSL compile is B3's risk, exactly as B1 handed it over.

## The bundle rule, now enforced from both ends

Phase B1 shipped 464 kB of three.js in the default player's main chunk because `main.ts`
imported `ThreeRenderer` statically. B2's final review found the same mechanism reopening: the
"pure builders" barrel imported one constant from `three/camera.ts`, which imports all of
three.js — while the barrel's own doc comment claimed it did not. **Nothing had shipped wrong**;
no app code reached it statically. It was a loaded gun, not a fired one.

Both ends are now guarded by lint rather than by comment:

- `packages/app/src/**` (excluding tests) may not statically import `@lions/render/three`,
  `/terrain` or `/three-camera`. `main.ts`'s dynamic `import()` is unaffected — verified by
  probe, not assumed.
- Only `packages/render/src/three/**` may import `three` at all. `renderer.ts` and the shared
  projection code stay three-free.

A pure constant both backends need belongs in `project.ts`, which imports nothing. `ELEV_STEP`,
`ELEVATION` and `WORLD_Y_PER_LIFT_PIXEL` all live there for this reason.

## Two Pixi defects found while porting

Faithful porting was B2's contract, so neither was fixed here — both are pinned by tests that
would catch them becoming live.

**The road-rut parity branch is dead code.** `renderer.ts:1527` reads
`const rut = (cx + cyG) % 2 === 0 ? 5 : 7`. With `cx = (x−y)·32` and
`cyG = (x+y+1)·16 − elev·10`, every term is even, so the test is always true and `rut` is always
5 — confirmed over 16,000 (x, y, elevation) combinations, zero odd cases. **The per-tile
variation the author intended has never rendered, in either backend, on any map.** Worth fixing
in Pixi with a parity source that actually varies, updating the pinned test on both sides in the
same change.

**The building south wall never darkens with damage** — fixed alpha 0.9, while the east wall and
roof both scale by `wear`. This one is *not* a bug. `wear` is a fade toward the ground tone
rather than a darken, so over a warm ground tone dropping alpha makes a mid-grey wall *lighter*;
applying it to the near-black south wall would wash the building's only shadow anchor out to
tan. Deliberate and live. Nothing to file.

## On testing, which is the part of B2 worth carrying forward hardest

**Nine tests in this phase passed while checking nothing.** Every one was found by deliberately
breaking the thing and seeing which test failed — never by reading:

- a palette test on a flat map that never emitted a single side face
- an axis test on a square grid that could not detect a transposed X/Z
- a determinism test comparing only colours, never positions or indices
- a break check discriminating by 8 nanometres of float32 rounding luck
- layering tests proving constants were *ordered* but never that they were *wired*
- a parity palette check running over a mesh with zero vertices

And one browser observation confidently reported scree "rendering distinctly" while it was
occluded behind a slope face the entire time — the observer was looking at the slope as a whole.

Two standards came out of that, and they cost nothing to keep:

1. **A guard is not a guard until you have broken the thing and watched it fail.** State which
   test caught it and what it said. If the break is not caught, the test is wrong, not the break.
2. **Isolate the specific thing before claiming it.** A screenshot of a region is not evidence
   about one feature in that region. The strongest demonstrations in this phase changed *world*
   state and reasoned about what the alternative explanation could not produce — for occlusion,
   that a quad confined to the ground plane cannot overlap the band a slope face occupies.
