# Replacing PixiJS with three.js

**Status:** design, pending review. Not started.
**Date:** 2026-08-26
**Issue:** #123
**Branch:** `feat/three-renderer`

---

## Why

The game's animation is not thin because PixiJS draws it badly. It is thin because
the pre-rendered sprite pipeline charges a 16× facing multiplier on every frame
authored, and the budget has been spent:

| | |
|---|---|
| animation frames in the entire game | **204**, across 103 clips on 36 sheets |
| average clip length | **2 frames** |
| what those 204 frames cost | **3,107 PNGs, 62 MB** |
| `fire`, on every unit in the game | 1 frame |
| `down` (death), on every unit | 1 frame |
| `TNK_HULL` / `TNK_TURR` | no clips at all |

A respectable set per unit — idle 10, move 8, fire 6, reload 8, death 8, wreck 1
≈ 41 frames — costs about **23,600 PNGs and 470 MB** in the sprite pipeline, which
is not shippable on a web build. The same content in real-time 3D costs one authored
clip per animation and roughly **84 KB per unit type** as a bone-matrix texture.

Three.js does not make animation better. It removes the reason none can be afforded.

### The second argument, which is about depth rather than animation

Every open render-side elevation debt in `CLAUDE.md` is one missing thing wearing
four hats: VFX not lifted to terrain height, extruded terrain not occluding units,
picking untested mid-slope, and `trailG`/`fxG`/`wreckLayer` sitting unconditionally
below `spriteLayer` so a wreck in front of a ridge draws behind it. `CLAUDE.md`
already records that a correct fix "means depth-sorting wrecks and VFX against
terrain" and defers it because a partial fix would be worse than none.

Those are four symptoms of having no depth buffer. In a 3D renderer they are not
fixed — they are absent. `depth.test.ts` and the integer-`zIndex` machinery get
deleted rather than extended. Tel Marum is the first map with relief and has no
missions yet, so that deferred list is about to start costing something.

### What is measured, and what is assumed

**Measured** (spike, three.js 0.170, throwaway, deleted): 300 animated units at
1,968 triangles each cost **4.0 ms per frame at retina** using a vertex-animation
texture and one `InstancedMesh` — about a quarter of the 16.7 ms budget. Cost is
nearly flat in unit count (300 → 1200 units moves it 4.0 → 5.1 ms) because it is
fill-rate bound. Even the naive path (one `SkinnedMesh` and one `AnimationMixer`
per unit, 300 draw calls) clears 300 units at 11.7 ms and only exceeds budget past
~1200. Validity was checked: the bake varies across frames and 72,011 pixels change
between `t=0` and `t=0.5` against 71,592 lit pixels, so it is genuinely animating.

Caveats on that number: units only — no terrain, VFX, overlays, fog, picking or UI,
and most of `packages/render`'s 5,059 lines are not units. One unit type and one
material. No shadow maps. One machine's GPU.

**Assumed, and NOT yet verified:** that the game's quantized palette survives
real-time shading. Phase 0 exists to settle this before anything else is built.

---

## Scope

**Changes:** `packages/render` only. Pixi appears in exactly two source files,
`renderer.ts` and `vfx/particles.ts`.

**Does not change:**

- `@lions/sim` — untouched. Invariant 4 already forbids the renderer writing sim
  state, and the seam below makes that structural rather than conventional.
- The determinism golden hash.
- `data/` — no content changes.
- `theme.css`, the HUD, and the DOM UI. The campaign world map is a PNG under an
  SVG overlay with CSS state; it never touched Pixi.
- The 863 existing tests, which stay green throughout and act as the regression net
  for everything outside `render`.

---

## The seam

Extract a `Renderer` interface from `PixiRenderer`'s existing public surface.
`PixiRenderer` and `ThreeRenderer` both implement it; `app` selects with
`?renderer=three`, defaulting to Pixi until parity.

The surface `app` actually uses today is small for a 5,059-line implementation —
13 methods and about 10 properties:

```
init frame snapshot onEvents
screenToWorld pickUnit isVisible
setElevation setDecor useEmitters
addOrderMarker setTutorialFocus clearTutorialFocus

camera selection width height
hoverEntity hoverStructure hoverCanGarrison
objectiveZone objectiveZoneState unitGroup
```

Four leaks must close first. All four are worth closing regardless of this project.

| today | becomes | why |
|---|---|---|
| `renderer.app.canvas` | `renderer.canvas` | `app` should not name the backend |
| `renderer.app.renderer.width` / `.height` | `renderer.width` / `.height` (**new members**) | viewport size is only reachable through the backend today |
| `renderer.app.ticker.add(cb)` | `app` drives its own `requestAnimationFrame` loop | Pixi's ticker is backend-specific |
| exported `isoX(wx,wy)` / `isoY(wx,wy)` | `renderer.worldToScreen(wx, wy)` | see below |

The last is the one that matters. `main.ts:1341` computes the cursor's screen
position by calling exported `isoX`/`isoY` and redoing the camera arithmetic
itself. In three.js the projection **is** the camera, so a pair of exported
projection functions would be a second and independently drifting source of truth
for it. Projection becomes a question the renderer answers, not arithmetic the app
repeats. `TILE_W`/`TILE_H` stay exported as layout constants.

`renderer.unitGroup` (control-group slot per entity) stays a plain array on the
interface: the renderer draws the group badge, so it legitimately owns the state.

---

## Phases

### Phase 0 — palette identity. GO / NO-GO.

One unit rendered under a toon ramp plus a palette lookup texture, beside its
current sprite, at gameplay zoom rather than zoomed in. Throwaway code, nothing
merged, no dependency on any other phase.

**If the quantized look does not survive real-time shading, stop.** Every phase
below is worthless without it, and this is the cheapest possible place to find out.
It is also the only assumption in this document that has not been measured.

Runs alongside M1 without competing for the renderer, because it touches nothing.

### Phase A — seam extraction

The `Renderer` interface plus the four leak fixes. No behaviour change, ships on
Pixi, and every conformance test written here runs against `PixiRenderer` first —
so the interface is proven against a working implementation before a second one
exists.

### Phase B — `ThreeRenderer`, billboards

Terrain, elevation, buildings, and units drawn as camera-facing quads using the
**existing sprites**. Orthographic camera at `atan(0.5)` elevation and 45° azimuth,
matching `TILE_W`/`TILE_H`. Real depth buffer. Behind the flag; Pixi stays default.

Billboards first is deliberate: it reaches visual parity quickly, fixes depth and
occlusion immediately, and the game never looks worse than it does today. Art
direction and renderer correctness get debugged separately instead of at once.

### Phase C — parity

VFX, overlays, trails, fog, order markers, tutorial focus, picking. Measured by the
golden-image diff described under Testing.

### Phase D — flip the default

`?renderer=pixi` retained for one release as an escape hatch.

### Phase E — delete Pixi

`depth.test.ts` and the integer-`zIndex` machinery are **deleted, not ported**. The
four elevation debts close here. The `pixi.js` dependency leaves `package.json`.

### Phase F — meshes, one unit type at a time

Infantry first, since infantry deform most and read worst as static sprites, and
because rigs already exist (`human_male_soldier.blend`, `soldier_kolos.fbx`,
`Tiger_Tank_Rig.blend`, and `tools/render_team.py` already drives an armature).
Each type is independently revertible: a type that has not migrated keeps its
billboard.

**This is the phase that produces the visible win, and the phase that costs the
most.** Three.js removes the facing multiplier, not the work of animating.

### Phase G — headless render gate

Replaces `validate:assets` for mesh units: render each mesh headlessly at the
dimetric angle in CI, then run the existing palette and silhouette-IoU checks
against that image. Billboard units keep the current gate untouched until their
type migrates, so the gate is never absent for anything that ships.

### Sequencing against M1

M1 (Beit Sahwan) finishes on Pixi first. Phase 0 may run alongside it — it is
throwaway and touches no shared code. Phases A onward begin after M1.

---

## Technical decisions

**Animation uses a bone-matrix texture with `InstancedMesh` per unit type**, not the
vertex-animation texture the spike benchmarked. VAT was the right thing to measure
(it is the brute-force upper bound on cost) but the wrong thing to ship: roughly
84 KB per unit type against ~368 KB, and bone textures support blending between
clips where VAT cannot. One draw call per unit type, ~30 total.

**Facings become continuous.** The 22.5° snap disappears for a type when it
migrates. `facings: 16` stays meaningful in the manifest for billboard units.

**Colour goes through a palette LUT**, so off-palette output is impossible by
construction rather than by inspection. This is what leaves silhouette IoU as the
part of Phase G still doing real work.

**Turret traverse becomes a bone**, replacing the split `_HULL` / `_TURR` sheets
that currently fake it.

---

## Testing

**A conformance suite against the interface, run once per implementation.** Phase A
delivers the half of it that needs no GPU: the `screenToWorld` / `worldToScreen`
round-trips, plus viewport and camera-centring. Those run against a minimal
stand-in, **not** against `PixiRenderer` — `environment: 'node'` cannot construct
one, since that needs a WebGL context — so what Phase A pins is the arithmetic of
the contract rather than a constructed renderer's behaviour.

The rest of the suite — `pickUnit` at known tiles, `isVisible` against fog, and
picking mid-slope, which `CLAUDE.md` records as untested today — needs a
constructed renderer and therefore belongs to Phase B, alongside the golden-image
harness that has to stand a renderer up anyway. Phase B's plan must pick them up;
they are deferred, not dropped.

**Golden-image diff between the two renderers** on the same map and the same sim
state, through Phases B and C. This makes "parity" a measurement rather than a
judgement call, and it is the gate for Phase D.

**The 863 existing tests** stay green and cover everything outside `render`.

---

## Risks

- **Phase 0 failing.** The largest risk and the reason it is first and cheap.
- **Two renderers coexist through Phases B–D.** The cost #120 warned about, bounded
  here by the flag, the shared interface, and the golden-image diff.
- **Shadows and lighting were not benchmarked.** The 4.0 ms figure excludes them.
- **Mesh authoring in Phase F is the real time sink**, and no engine choice reduces it.
- **`validate:assets` has a gap** between the first mesh landing (Phase F) and the
  headless gate existing (Phase G). Mitigated by migrating one type at a time and by
  the palette LUT making the palette half of the gate structurally unnecessary.

---

## Implementation planning

This document covers seven phases and is deliberately larger than one
implementation plan. **The first plan should cover Phase 0 and Phase A only.**

Phase 0 is a GO/NO-GO gate whose answer may end the project, so planning past it is
speculative. Phase A is worth planning alongside it because it is valuable
independently: the seam extraction and its four leak fixes improve the codebase
whether or not a second renderer is ever written, and the conformance suite it
produces documents `PixiRenderer`'s real contract for the first time.

Phases B onward get their own plans, written once Phase 0 has answered.

---

## Explicitly not in scope

- Any change to `@lions/sim`, including the O(N²) detection debt, the trail scan,
  `markerSeesRoute`, and `raySmoke` ignoring elevation. A renderer change touches
  none of them, and this document does not claim otherwise.
- The HUD and UI art direction, which is a separate and cheaper piece of work.
- Slope movement cost and downhill cover, both deferred from E3 and both sim-side.
