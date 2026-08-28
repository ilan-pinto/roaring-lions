# Rigged infantry — design

**Date:** 2026-08-28
**Branch:** `feat/three-renderer`
**Predecessor:** `2026-08-26-three-renderer-design.md` (this is its Phase F, pulled forward)
**Status:** design, pending the GO/NO-GO in Phase R0

---

## Why this, and why now

The three.js migration was undertaken for three stated reasons: the UI art reads
as weak, unit animation is not strong enough, and maps should hold more units.
Phases A–B4 delivered the renderer that makes all three *possible* and none of
them *visible*. Phase C (parity overlays) would not have changed that either.

`ART_PIPELINE.md` §0 makes the argument for spending here, and makes it against
its own instinct:

> at 40–80 px on screen, model quality is nearly irrelevant. What players read
> as "good art" is lighting, palette, VFX, **animation**, and terrain density.

Animation is on that list. It is also, right now, the weakest of the five:
`MOVE_STRIDE = (0.0, 1.0, 0.0, -1.0)` (`tools/units/teams.py:50`) is a
four-frame stride built from discrete geometry arrangements, and `idle` is a
single pose. Lighting, palette and terrain density have all had dedicated work.
Animation has had four frames.

---

## The decision this reopens, and on what grounds

`tools/units/kit.py` opens with **"No armature."** and gives three reasons in
weight order. This spec overturns exactly one of them and must say which.

**Reason 1 — "deterministic and reviewable as code. A rig's pose is data in a
.blend that nobody can diff."** *Not overturned. Preserved.* This is the
strongest of the three and it survives intact, because the armature and every
clip in this spec are **authored in Python**, exactly as `kit.py` authors
geometry. A bone is a named parent, a head, a tail, and a roll — four numbers
in a table. A clip is a keyframe table. Both diff. Nothing in this design
requires opening a `.blend` to review a pose, and nothing in it requires weight
painting, which is the genuinely un-diffable part of rigging.

**Reason 2 — "It drops `art/src/soldier_kolos.fbx`, whose licence is
unverified."** *Not overturned. Strengthened.* That file is worse than
unverified: it embeds
`U:\Dropbox\SyntyStudios\PolygonMilitary\_Working\_Textures\PolygonMilitary_Texture_01_A.psd`,
identifying it as Synty POLYGON Military, which `CLAUDE.md` names explicitly in
"what not to do", *"even if you own a licence"*. Nothing in this spec uses it,
and it should be deleted independently of this work.

**Reason 3 — "It is enough. At 40–80 px model quality is nearly irrelevant, and
the rig contract measured infantry at 25 px wide. Blocky is the correct budget
at that size, not a compromise."** ***This is the one being overturned.*** Two
grounds, and the second matters more than the first:

- The claim is about **model quality**, and `ART_PIPELINE.md` §0 puts animation
  in the *other* category — one of the five things players do read at that size.
  "Blocky is the correct budget" and "four frames of motion is the correct
  budget" are different claims, and only the first was argued.
- The size premise is no longer the only one that counts. Units are judged
  zoomed in, not only at gameplay size, and the migration's own goals push both
  directions at once — larger maps make units smaller, while a three.js camera
  makes zooming in free.

If Phase R0 shows the motion win is not there at gameplay size, reason 3 stands
and this work stops. That is what R0 is for.

---

## Scope

**In:** one unit type (`inf_squad`), an armature authored in code, rigid part-to-
bone binding, three clips (`idle`, `move`, `fire`), glTF export, a `SkinnedMesh`
path in `ThreeRenderer` behind a flag, drawn beside billboard units.

**Out, deliberately:** every other unit type; smooth/weighted skinning; the
remaining three clips (`down`, `wreck`, `work`); vehicles and buildings;
replacing the sprite pipeline; Phase C parity overlays; and any change to
`validate:assets`.

**A gate this spike does not satisfy, stated plainly rather than skipped
quietly:** `validate:assets` renders a PNG and checks palette conformance and
silhouette IoU. A mesh unit produces no PNG, so a mesh `inf_squad` is outside
that gate entirely. The design spec's Phase G exists to fix this and is not
being pulled forward. For the duration of this spike the billboard `inf_squad`
sheet remains in the tree and remains gated; the mesh is additive and
flag-gated, so nothing ships ungated.

---

## Phase R0 — GO / NO-GO, before any pipeline is built

Phase 0 of the renderer migration answered "can real-time shading emit the
palette exactly?" with a throwaway spike, and its answer (GO, by construction)
shaped every phase after it. R0 is the same move for the two questions this
work actually rests on, and it is cheap on purpose:

**Q1 — does the palette survive deformation?** Phase 0 proved a toon LUT makes
off-palette output *unrepresentable*, on **static** geometry. Skinning changes
vertex normals every frame, and the toon ramp is indexed by normal. The banding
will therefore *move across the figure as it animates*. That is expected and may
be fine; what would not be fine is shimmer — band boundaries crawling frame to
frame at a scale that reads as noise. Untested, and not answerable by
inspection.

**Q2 — does the motion actually read better?** Against the shipping four-frame
stride, at gameplay size *and* zoomed, side by side.

**Method:** one figure, one `move` clip, crude bones, no pipeline, no tests, no
commitment. Rendered in the real game beside a billboard `inf_squad`.

**NO-GO if:** the palette shimmers under deformation and no cheap fix presents
itself; or rigid binding tears visibly at the joints and only weight painting
fixes it (which would cost reason 1); or the motion does not read better at the
sizes the game is actually played and judged at.

A NO-GO here is a real outcome, not a failure. It costs a day and it would
leave reason 3 standing, which is worth knowing.

---

## Technical decisions

**Armature in code.** `tools/units/rig.py`, alongside `kit.py`. Bones as a
table: name, parent, head, tail, roll. A minimal humanoid — root, pelvis, spine,
head, and four limb chains — is 12–14 bones. No IK; forward kinematics only,
since every clip here is authored rather than solved.

**Rigid binding, one part to one bone.** `kit.py` already builds a figure as
discrete named parts carrying `rl_role` tags. Each part binds wholly to one
bone, no weights, no falloff. This is the decision that keeps reason 1 intact —
weight painting is the un-diffable step, and skipping it is possible only
because the art direction is blocky. It also matches how the parts are already
authored: `limb()` builds through waypoints with blobbed ellipsoid joints, and
those joint blobs are exactly what hides a rigid seam. If seams read badly, that
is R0's Q1 answering NO, not a licence to start weight painting.

**Clips as keyframe tables.** A clip is `{bone: [(frame, rotation), …]}` in
Python. `move` gets a real cycle rather than four positions; `idle` gets breath
and a weight shift; `fire` gets recoil and recovery.

**glTF/GLB export** via Blender's built-in `bpy.ops.export_scene.gltf`. It is
three.js's native format, carries skin and animation together, and needs no new
dependency. No such export exists in `tools/` yet.

**Palette under skinning.** The Phase 0 recipe is non-negotiable and must be
carried verbatim: LUT colours built with `setStyle(hex, LinearSRGBColorSpace)`,
`renderer.outputColorSpace = LinearSRGBColorSpace`, antialiasing off or
accounted for. The material gains skinning support; nothing else about it
changes. `ROLE_PALETTE` (`tools/render_team.py:66`) already maps `rl_role` to
palette keys and is the input to the LUT.

**Determinism.** Animation is renderer-side only. Clip selection already reads
sim state through `resolveClip` (`packages/render/src/clip.ts:56`) and that path
is reused unchanged. An `AnimationMixer`'s own clock is frame time, never sim
time, and nothing it produces may reach the sim — invariants 1 and 4.

---

## Risks

| risk | why it matters | when it surfaces |
|---|---|---|
| Palette shimmers under deformation | the migration's central guarantee | R0 · Q1 |
| Rigid seams tear at joints | the fix costs reason 1 | R0 · Q1 |
| Motion win is not there at size | the whole premise | R0 · Q2 |
| One rigged type looks wrong beside twelve billboard types | a mixed roster may read worse than either pure state | R0, and again at the end |
| Mesh units are outside `validate:assets` | ungated art can ship | held off by the flag; Phase G's problem |
| Vertex/bone cost at 300 units | the 300-unit gate is the migration's own bar | after R0, measured on the existing harness |

The fourth row is the one most likely to be underestimated. A single rigged
squad among billboards may read as *inconsistent* rather than as *better*, and
that judgement cannot be made from the rigged figure alone.
