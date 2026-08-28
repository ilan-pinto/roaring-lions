# Mesh unit contract v1 — the file the art pipeline produces and the renderer consumes

**Date:** 2026-08-28 · **Status:** pinned for Phase F slice 1

This exists so the export side and the runtime side can be built in parallel
without either waiting on the other. It is the ONLY thing they share. Anything
not written here is that side's own business; anything written here changes only
by changing this file and telling both sides.

---

## Location and granularity

`art/meshes/<team_id>.glb` — one file per `tools/units/teams.py` `TEAMS` key
(`inf_squad`, `at_team`, …), not per soldier. A team's figures ship together
because they animate together and are drawn together.

## Contents

**Geometry — joined by role, not by part.** R0 exported one mesh per
`kit.figure()` part: 56 draw calls per soldier, fatal at 300 units. Join every
part sharing an `rl_role` into ONE skinned mesh, giving at most one mesh per
role present. No custom vertex attribute is needed for this and none may be
added: each role already wants its own material, so the role IS the draw-call
boundary.

Each such mesh must carry its role in BOTH places, deliberately redundantly:

- the glTF node/mesh **name** equal to the role string exactly (`uniform`,
  `webbing`, `boot`, `face`, `skin_shadow`, `metal`, `weapon`, `wood`,
  `charge`, `keffiyeh`)
- the node **`extras.rl_role`**, same string (requires `export_extras=True`;
  it is off by default and drops silently)

The runtime reads `extras` and falls back to the name. Either alone has failed
once already in this project.

**Roles are a closed set.** The ten above, from `tools/render_team.py`'s
`ROLE_PALETTE` / `BODY_PALETTE` / `SHARED_PALETTE`. A role outside the set must
be a loud failure on both sides, never a default colour.

**Skin.** One armature per file, covering every figure in the team. Bone names
prefixed by figure index — `f0_pelvis`, `f1_pelvis` — so a three-man team is
one skin and one set of draw calls rather than three.

**Clips**, named EXACTLY as `packages/render/src/sheet.ts`'s `ClipName` union:
`idle`, `move`, `fire`, `down`, `wreck`, `work`. A clip absent from the file is
legal (the runtime falls back the way `resolveClip` already does for sheets);
a clip present under any other name is a failure.

**Zero materials.** The exporter writes no material of any kind. Every colour
is applied on the runtime side from `data/palette.json`, so the palette
guarantee lives in exactly one place. This is not a convenience — R0's whole
Q1 result depends on colour never being decided in Blender.

**Units and orientation.** Built at real metres, `kit.py`'s convention (object
scale always 1, a standing figure 1.8 tall). Forward is **+X**. The runtime
scales by `1 / UNITS_PER_TILE` (3.0) because three draws one unit per tile.

## What the runtime guarantees in return

- It applies one material per role from a ramp SLICE, never from
  `ROLE_PALETTE`'s single base colour. (That table is calibrated for a
  multiply-style light — hence `LIT_GAIN` and "a figure renders at roughly half
  its base value". A toon LUT indexes rather than multiplies.)
- It drives clip choice from sim state through the existing `resolveClip`, so
  the sim contract is unchanged and no new sim coupling appears.
- It never writes to the file, never depends on part-level names, and never
  depends on bone names beyond the `f<N>_` prefix convention.

## Open, and owned by the export side to decide and report

- Whether the hip needs geometry change, a third bone, or an accepted seam.
- Bone count per figure beyond the 13 R0 used.
- Whether `wreck` is a clip at all or stays separate geometry.
