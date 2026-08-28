# Phase R0 verdict — does a rigged, code-authored infantry figure work?

**Date:** 2026-08-28
**Spec:** `2026-08-28-rigged-infantry-design.md`
**Method:** throwaway spike, committed at `0d6eab2` under `art/spike/`,
`tools/spike_rig_infantry.py`, `packages/render/src/three/spike/`.

---

## VERDICT: GO

Both questions answered. Q1 by measurement, Q2 by the project lead's judgement.

---

## Q1 — does the palette survive skeletal deformation? YES, twice over.

Phase 0 proved a toon LUT makes off-palette output unrepresentable on **static**
geometry. Skinning rewrites vertex normals every frame and the ramp is indexed
by normal, so the guarantee had to be re-earned. It was, and by the same method
Phase 0 used — censusing pixels, not looking at them.

**Colour census**, one frame, canvas holding a deforming skinned mesh, the
shipping `INF_SQUAD` sheet and the ground:

| distinct colours | in `data/palette.json` | off palette |
|---|---|---|
| 20 | 20 | **0** |

**Band crawl**, the failure a single-frame census cannot see. Every individual
frame is in-palette *by construction*, so the question is whether band
boundaries jump noisily between frames. Measured as the share of figure pixels
that change colour for a given advance of the animation clock:

| advance | figure pixels changed |
|---|---|
| 0 ms | **0.00%** |
| 1 ms | 0.33% |
| 4 ms | 0.77% |
| 16 ms (a 60 fps frame) | 2.25% |
| 100 ms | 11.07% |

Change is **proportional to elapsed time with a zero intercept**. Shimmer would
be the opposite shape — a large change at 1 ms, a curve that does not pass
through the origin. The 0 ms row is the instrument's own sanity check: it proves
the measurement can return zero, so the small numbers are a result rather than
an artefact.

## Q2 — does rigged motion read better? YES.

Project lead, on the side-by-side: *"the new infantry using three looks much
better."* Recorded as the answer it is — Q2 was always a judgement, and the
spike existed to put it in front of someone qualified to make it.

`kit.py`'s reason 3 for having no armature ("blocky is the correct budget at
25 px") is therefore overturned on the record, as the design spec said it would
have to be. Reasons 1 and 2 stand and are preserved by the design.

## Art direction, from the same review

Two changes requested, and they are requirements for Phase F rather than
polish:

- **A more modern outfit.**
- **Rounded edges on the figure.**

The second is the more interesting one, because it cuts against how `kit.py`
already argues: its `figure()` docstring says the fourth pass was "the first
built to an organic brief rather than away from boxes", and lists blobbed
ellipsoid joints and bowed limbs. So the direction is not new — it is *further
along the axis kit.py was already travelling*, and the rounder the joints get,
the better rigid part-to-bone binding hides its seams. Art direction and the
rig's one known weakness pull the same way here, which is worth knowing before
either is designed.

---

## Two findings the spike produced that Phase F must design around

**1. 56 draw calls per soldier.** Each `kit.figure()` part exported as its own
mesh. Immaterial for one figure; fatal at the GDD's 300-unit target. Phase F
joins parts **by `rl_role`**, which is 6 meshes rather than 56 and needs no
custom vertex attribute, since each role already wants its own material.

**2. The hip is a genuine rigid-binding exception.** Every other joint holds to
~51° of relative rotation with no visible tear, because `kit.py`'s blobbed
ellipsoid joints bridge the seam. `hip0`/`hip1` bridge pelvis and thigh, and
binding them wholly to the thigh opens a visible gap in profile at maximum
forward swing. This is the one place the "no weight painting" rule is under
real pressure, and the art direction above may dissolve it for free.

## What R0 did NOT establish

- **One unit type, one faction, two clips.** `down`, `wreck`, `work` and `fire`
  are unauthored; the enemy `dust`-ramp figure is untested.
- **No weapon.** `kit.figure()` builds the soldier; `teams.py` adds the rifle
  separately, and the spike called only the first. Every silhouette
  observation is of an unarmed figure.
- **One figure against a three-man sprite team**, so nothing here compares
  massing, spread, or how a mixed roster reads.
- **Nothing about cost.** No measurement at any unit count above one.
- **Nothing about the gate.** A mesh unit produces no PNG and is outside
  `validate:assets` entirely.
