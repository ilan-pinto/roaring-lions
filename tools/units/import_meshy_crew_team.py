"""Build a two-man crew team GLB from ONE Meshy A-pose figure, through rig.py.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --python tools/units/import_meshy_crew_team.py -- manpad_team
    ... -- recoilless_team
    ... -- all

Writes `art/meshes/<team_id>.glb` -- WP-A3.1 (GH-179) batch B2
(`docs/art/meshy-prompts-units.md` §8-9). Owner of both files in
`rig.TEAM_MESH_OWNER`, so `export_mesh_team.py -- all` skips them.

SOURCES (`art/meshy/<team>-20260930-01a0f2af/model.glb`, Meshy text-to-3d
preview in `--pose a-pose`, then REMESH at 1,500 tris; no material, no rig):

  manpad_team      preview 01a0f2ac-f4e5-7632-8b48-d8813d50890c,
                   remesh  01a0f2af-b00a-715f-9b29-424e409d471a
  recoilless_team  preview 01a0f2ac-f5b1-7146-b3e3-73be95e86ff2,
                   remesh  01a0f2af-b122-75c8-bbe1-9c9da39e1aa2

AI-generated (Meshy), disclosed per CONTRIBUTING.md.

## Why this path and not `import_meshy_soldier.py`'s

The shipped Meshy infantry (`meshy_soldier`, `sarim_rifles`, `rpg_team`) were
SUPPLIED as rigged bipeds with clips, and their importers retarget those. B2's
figures come from `pnpm meshy`, which has no `rig` command, and a headless
session cannot drive the Meshy web UI; the bible's step 5 (a bought humanoid
rig) is therefore not taken. Instead the remeshed figure goes through
`tools/units/rig.py` exactly as a `kit.py` figure does: it is CUT into rigid
parts at rig.py's own joints, each part is named `{prefix}_{suffix}` with a
suffix from `PART_BONE`, `rig.rig_parts` binds one part to one bone, and every
clip is rig.py's own keyframe table (`build_idle_clip`, `build_move_clip`,
`build_fire_clip`, `build_death_clip`). No hand-posing, no weight painting;
where a rigid cut opens a seam, a `kit.blob` joint hides it -- kit's own
mechanism, in the same palette roles, so it is invisible on a palette-painted
figure.

## The cut, measured on each remesh rather than assumed

The A-pose figure faces -Y in the source (probed: the toes' centroid sits
forward of the shins' along -Y; confirmed by an ortho render with a marker
cube), so it takes one +90 degree Z rotation to face +X. Heights are
fractions of the figure's own height `H` (anthropometric, not `kit.py`'s
stylised 1.8 m proportions): ankle 0.045, boot top 0.09, knee 0.285, crotch
found by scanning for the band where the two legs merge (fallback 0.47),
belt = crotch + 0.08, neck base 0.83, chin 0.87. A crotch SCAN (the band
where the two legs' face centroids separate) was tried and swung between
0.44 and 0.52 H on a 1,500-tri shell, so the cut uses the fraction and the
scan is only logged beside it. The arm root is the torso half-width at the
armpit, 0.105 H -- both B2 figures measured 0.20 of 1.90 source units -- and
the shoulder is the centroid of the arm-root ring above the hip pouches; the
elbow sits 0.42 of the way from that ring to the fingertips.

The A-pose arms (30-47 degrees from vertical, measured) are hung at
`ARM_HANG_DEG` from vertical by one rigid rotation of each arm about its own
shoulder ring -- rest geometry, like kit's contrapposto, not a pose -- and a
deltoid blob covers the wedge. The kneeling figure is the same parts
re-arranged rigidly onto a kneel: torso, head and arms drop, the rear thigh
angles back to put its knee on the ground, the rear shin lies along the ground
with the boot plantar-flexed behind it, the front thigh rises to a knee the
front shin drops vertically from, so the front boot's sole lands on z = 0.
Every angle is solved from the figure's own segment lengths; see `_kneel`.

## Roles

`boot` below the boot top; `face` the forward strip of the head between 0.88
and 0.955 H; `keffiyeh` the rest of the head and the neck (both figures wrap a
scarf there -- the recoilless man is fully hooded, the MANPAD man's preview
ignored the head wrap and came bare-headed, so he ALSO gets `kit.keffiyeh`
geometry over the crown, the same fix the bible allows for a preview that
missed a slot); `uniform` everything else; `weapon`/`metal` the kit parts.
No `webbing`: a chest rig on a bakeless remesh cannot be told from the shirt
by geometry, and a wrong band reads as a wrong army.

## What each team carries, from `tools/units/teams.py`

The figures' positions are teams.py's. The three shouldered launchers are
NOT at teams.py's anchors any more: those are the KIT figure's centre line,
and on these Meshy figures they ran each tube through its gunner's head or
chest. `_seat_launcher` seats each one on its gunner's +y shoulder beside
his head and re-seats both his hands on it (see the comment above
`LAUNCHERS`, and PR #325 for the same fix on at_team):

  manpad_team      mpd_fire standing at (0.16, -0.22) with the MANPAD at
                   teams.py's 78 deg and 0.065 radius, 1.30 m long with a
                   gripstock, on his forearm_R; mpd_spot kneeling at
                   (-0.28, 0.30) with `kit.binoculars` on his head.
  recoilless_team  rcl_fire kneeling at (0.20, -0.28), the recoilless rifle
                   SHOULDERED, pitch 0, length 0.86, radius 0.115, on
                   forearm_R; rcl_load kneeling at (-0.30, 0.30); two spare
                   rounds (`kit.tube` 0.52 x 0.075) on the ground on a `prop`
                   bone.
  rpg_team         rpg_fire standing at (0.18, -0.26) with the RPG at 38 deg,
                   warhead on, on his forearm_R; rpg_load at (-0.30, 0.30)
                   with a rifle at his hand.

Both kneeling figures walk on a standing walker for `move` (design D6,
`rig._walker_specs`), and every figure carries a prone corpse for
`down`/`wreck` -- the standing parts laid face-down and decimated to half,
rigidly on `{prefix}_death_root` (`rig._figure_death_parts`'s convention,
with the man's own body instead of kit primitives).

## B5 (GH-179, 2026-10-01): `breach_team`, the one KDF team on this path

`breach_team` is the last kit-built KDF team and the brief named the B0b KDF
importer (`import_meshy_kdf_team.py`) as its path. It goes through THIS file
instead, deliberately: the B0b cut hangs each A-pose arm as one rigid unit
(bible §9 -- "the hands flare at the wrist, visible at 2.5") and lays the
corpse flat, where this file carries B3/B4's measured elbow cut, both
forearms bent to a rifle for a carrier (`FORE_BEND`, `_rifle_at_hand`) and
the posed corpse -- the fixes the batch was told to inherit. The only
faction-specific thing in the cut is the head: a KDF helmet and neck are
`uniform`, not `keffiyeh` (`HEAD_ROLE`), and no kit keffiyeh goes on. Its
props are `rig._breach_extras`' own shield (on `brc_point_forearm_L`) and
pole (on `brc_cover_spine`), through `PART_BONE`'s fallback as in the kit.

## A3.1 stage 2 (GH-179, 2026-10-05): Meshy hand weapons

Every kit rifle and procedural launcher left on these figures is replaced by
a Meshy PART composed into the team's atlas (see the section above
`HAND_PARTS`): `sarim_rifle` (militia_cell, sarim_rifles, rpg_team's loader),
`kdf_carbine` (mortar_team No.3, yahalom_squad yah_b, and breach_team, where
it replaces the figure's BAKED carbine on the spine), `rpg_launcher` (the
textured on-disk RPG-7 through `export_meshy_rpg.py`; rpg_team and, through
`import_meshy_moto_rpg.py`, the moto_rpg pillion), `manpad_tube`
(manpad_team: its pointed nose cut and capped flat, the lead's ruling),
`atgm_post` (atgm_cell, on `prop`) and `recoilless_rifle` (recoilless_team:
the dirt patch the preview stood on dropped, its two spare rounds split off
and laid by the loader). The Spike (`spike_launcher`, at_team) goes through
the same loader from `import_meshy_kdf_team.py`. AI-generated (Meshy),
disclosed per CONTRIBUTING.md; task ids in docs/ASSET_PROVENANCE.md.

After this: `pnpm gait:meshes -- --id=<team>`, `pnpm encode:meshes` (that
order), `pnpm validate:meshes`.
"""
import glob
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
sys.path.insert(0, TOOLS)
sys.path.insert(0, HERE)

import kit  # noqa: E402
import rig  # noqa: E402
import teams  # noqa: E402
from import_meshy_kdf_team import _two_bone  # noqa: E402  PR #325's two-bone IK

REPO = os.path.dirname(TOOLS)
OUT_DIR = os.path.join(REPO, "art", "meshes")

#: team -> (Meshy remesh folder glob, figure height in metres -- the numbers
#: table's 1.74 / 1.72, bible §5 worked examples 2 and 3; B3's §10-12).
SOURCES = {
    # B7 (GH-179, 2026-10-01): both B2 figures re-remeshed at the same 1,500
    # from a REFINE of their own B2 preview (`pnpm meshy -- refine`, 10
    # credits each), so each carries its bake now; the B2 remeshes
    # (`*-01a0f2af`) are superseded. Same preview mesh, same polycount: the
    # cut, the kneel and `_seat_launcher` re-run on near-identical shells.
    # Lead's ruling 2026-10-02 (B7 review, option 1): the refined B2 MANPAD
    # figure read as a KDF soldier at game zoom (dark olive, helmet), so the
    # team is built on the EXISTING Sarim body -- B3's militia_cell remesh
    # with its tan bake and kit keffiyeh -- at 0 credits. The B2 preview, its
    # refine and remesh (ledger 2026-09-30 / 10-01) are unused now.
    "manpad_team": (os.path.join(REPO, "art", "meshy", "militia-cell-*-01a0f30b", "model.glb"), 1.70),
    "recoilless_team": (os.path.join(REPO, "art", "meshy", "recoilless-team-*-01a0f890", "model.glb"), 1.72),
    # B3 (GH-179, 2026-09-30): remeshes of REFINED tasks, so each carries its
    # own 2k bake -- see `TEXTURED` below. Folder ids filled in as each
    # remesh landed (docs/ASSET_PROVENANCE.md has the full task ids).
    "militia_cell": (os.path.join(REPO, "art", "meshy", "militia-cell-*-01a0f30b", "model.glb"), 1.70),
    "rpg_team": (os.path.join(REPO, "art", "meshy", "rpg-team-*-01a0f313", "model.glb"), 1.76),
    "atgm_cell": (os.path.join(REPO, "art", "meshy", "atgm-cell-*-01a0f313", "model.glb"), 1.72),
    # B4 (GH-179, 2026-10-01): the three remaining enemy teams, numbers in
    # `docs/art/meshy-prompts-units.md` §13-15. The 30 Sep run stopped at
    # HTTP 402 before any spend; the lead raised the key's credit limit and
    # the three ran on 1 Oct -- remeshes of the 2k-refined tasks, ids in
    # docs/ASSET_PROVENANCE.md.
    "mortar_crew": (os.path.join(REPO, "art", "meshy", "mortar-crew-*-01a0f5f3", "model.glb"), 1.68),
    "charge_squad": (os.path.join(REPO, "art", "meshy", "charge-squad-*-01a0f5f3", "model.glb"), 1.72),
    "digger_crew": (os.path.join(REPO, "art", "meshy", "digger-crew-*-01a0f5f3", "model.glb"), 1.66),
    # B5 (GH-179, 2026-10-01): the KDF breach team, `meshy-prompts-units.md`
    # §16 -- 1.78 m, the KDF rifleman reference. See the module docstring for
    # why it is here and not in import_meshy_kdf_team.py.
    "breach_team": (os.path.join(REPO, "art", "meshy", "breach-team-*-01a0f624", "model.glb"), 1.78),
    # B6 (GH-179, 2026-10-01): moto_rpg's RIDERS are B3's rpg_team figure
    # (the one Sarim preview that honoured the head wrap), re-posed seated
    # by tools/units/import_meshy_moto_rpg.py, which loads it through this
    # module's `_load_figure`/`cut_figure`/`_death_parts_posed`. No new
    # Meshy figure, 0 credits. `build_team` here does NOT know this team.
    "moto_rpg": (os.path.join(REPO, "art", "meshy", "rpg-team-*-01a0f313", "model.glb"), 1.76),
    # B7 (GH-179, 2026-10-01): the five supplied Meshy teams replaced on this
    # path -- numbers in `docs/art/meshy-prompts-units.md` §19-23, task ids in
    # docs/ASSET_PROVENANCE.md. Each file reclaims its team id's own name.
    "inf_squad": (os.path.join(REPO, "art", "meshy", "inf-squad-*-01a0f89c", "model.glb"), 1.78),
    # Same ruling: the B7 Sarim rifleman preview (sarim-rifles-*-01a0f89e,
    # unused now) read as KDF; the team is the militia_cell body three times.
    "sarim_rifles": (os.path.join(REPO, "art", "meshy", "militia-cell-*-01a0f30b", "model.glb"), 1.70),
    "mortar_team": (os.path.join(REPO, "art", "meshy", "mortar-team-*-01a0f89f", "model.glb"), 1.76),
    "sniper_team": (os.path.join(REPO, "art", "meshy", "sniper-team-*-01a0f8a1", "model.glb"), 1.78),
    "yahalom_squad": (os.path.join(REPO, "art", "meshy", "yahalom-squad-*-01a0f8ab", "model.glb"), 1.78),
}

#: Teams whose GLB ships the remesh's own base-colour bake (PR #307's
#: `TEXTURED_INFANTRY_TYPES` / `TEXTURED_INFANTRY_EXEMPT`, both lists edited
#: in the same change as the file). The bake stays on the figure's own
#: material through every cut (`_piece` duplicates keep UVs and the material
#: slot); a `kit.blob` joint or a kit keffiyeh that joins a textured role
#: BORROWS the material and one UV from the nearest source face, so it takes
#: the local cloth colour instead of texel (0, 0). Kit weapons keep no UVs and
#: no material: `buildMeshUnitTemplate` decides per MESH, so `weapon`/`metal`
#: stay palette-painted beside a textured `uniform`. Shipped at
#: `TEXTURE_PX` JPEG; the refine's normal and metallic-roughness maps are
#: dropped (a 25 px figure cannot show them, and the characters doc's own
#: rule is "single base-colour texture").
TEXTURED = {"militia_cell", "rpg_team", "atgm_cell",
            # B4: same bake path, listed here so the import keeps the material;
            # the runtime/gate lists are edited only when each GLB ships.
            "mortar_crew", "charge_squad", "digger_crew",
            # B5: the KDF breach team ships its own bake the same way.
            "breach_team",
            # B6: the riders carry rpg_team's bake; the bike is palette.
            "moto_rpg",
            # B7: the two B2 teams, refined on their own previews, and the
            # five replaced supplied teams.
            "manpad_team", "recoilless_team",
            "inf_squad", "sarim_rifles", "mortar_team", "sniper_team", "yahalom_squad"}
TEXTURE_PX = 1024
JPEG_QUALITY = 85

#: Head-wrap recolour, per team: (target linear RGB, hue window in degrees).
#: Both B3 previews that honoured the head wrap painted it PINK (rpg: a rose
#: scarf; atgm: a pink-white cap) -- saturated colour the bible reserves for
#: VFX and team markers, on the one part of an enemy figure the eye goes
#: to. Fixed in the bake rather than re-rolled: the texels of the head and
#: neck faces (the cranium/neck cut, face strip excluded) whose hue falls in
#: the red-magenta window and whose saturation is above SAT_MIN take the
#: target's chroma at their own luminance, so folds and shading survive.
#: Skin (hue ~20-30 deg) and the tan shirt sit outside the window.
RECOLOUR = {"rpg_team": ((0.60, 0.52, 0.40), (300.0, 14.0)),      # dusty tan
            "atgm_cell": ((0.80, 0.77, 0.70), (300.0, 14.0)),     # limestone
            # B4: the mortar refine painted the helmet a red-and-white check
            # and the collar rose -- a real-world pattern, in saturated red.
            # Red sits at hue 0, so the window reaches to 20.
            "mortar_crew": ((0.60, 0.52, 0.40), (300.0, 20.0)),   # dusty tan
            # B4: the digger's bald crown was painted the same rose check.
            "digger_crew": ((0.55, 0.53, 0.48), (300.0, 20.0)),   # dusty grey
            # B6: the same rpg_team figure, the same rose scarf.
            "moto_rpg": ((0.60, 0.52, 0.40), (300.0, 14.0)),
            }
RECOLOUR_SAT_MIN = 0.16
RECOLOUR_FLOOR_F = 0.74
#: The mortar figure's chest bandolier came back in the same red check as
#: its helmet, so its window reaches down to the belt line; the tan shirt and
#: olive rig sit outside the hue window either way.
RECOLOUR_FLOOR_BY_TEAM = {"mortar_crew": 0.55}

#: Whether the figure needs kit's keffiyeh over the crown (see module docstring).
ADD_KEFFIYEH = {"manpad_team": True, "recoilless_team": False,
                # B3: the militia preview came back bare-headed and clean-cut
                # (the wrap AND the ragged jacket were ignored), so it wears
                # kit's keffiyeh, coloured from its own shirt's bake.
                "militia_cell": True, "rpg_team": False, "atgm_cell": False,
                # B4 (2026-10-01): all three previews ignored the head wrap --
                # mortar and charge came back in a HELMET with goggles, the
                # digger bald -- so every one wears kit's keffiyeh, coloured
                # from its own shirt's bake, exactly militia_cell's fix.
                "mortar_crew": True, "charge_squad": True, "digger_crew": True,
                # B5: a KDF helmet, never a keffiyeh (see HEAD_ROLE).
                "breach_team": False,
                # B6: rpg_team's figure wraps its own scarf.
                "moto_rpg": False,
                # B7: four KDF teams (helmets, see HEAD_ROLE); sarim_rifles
                # set from its preview.
                "inf_squad": False, "mortar_team": False, "sniper_team": False,
                "yahalom_squad": False,
                # B7 (2 Oct ruling): both on the militia_cell body, which came
                # bare-headed -- kit's keffiyeh, militia's own fix.
                "sarim_rifles": True}

#: The role the cranium and neck cut take. Every Sarim figure wraps a scarf
#: there (`keffiyeh`, the module docstring's "Roles"); a KDF figure wears a
#: helmet over a bare neck, and on a textured team the role only has to be in
#: the closed set -- the bake says what colour it is -- so it is `uniform`,
#: exactly what import_meshy_kdf_team.py's cut gives at_team and demo_squad.
HEAD_ROLE = {"breach_team": "uniform",
             # B7: the four KDF teams on this path wear helmets.
             "inf_squad": "uniform", "mortar_team": "uniform",
             "sniper_team": "uniform", "yahalom_squad": "uniform"}
HEAD_ROLE_DEFAULT = "keffiyeh"

#: charge_squad only: put kit's `vest_f`/`vest_b` slabs (the `charge` role,
#: verbatim from `rig._charge_squad_rest`) on both men. False while the
#: Meshy figure is asked for the padded vest itself (§14's signature); flip
#: it if the preview ignores the vest -- the bible's fix for a missed slot.
CHARGE_KIT_VESTS = False

#: digger_crew's entrenching tool: a short `wood` handle with a `metal`
#: blade in the kneeling man's hands, pointed at the heap, bound to
#: `dig_spine` with the torso that holds it (ARMS_FORWARD below), so it
#: hides with the kneel root while he walks. Not a
#: `weapon` role (mesh_gait.test.ts's WEAPON_EXEMPT: "a digger: `wood`, no
#: `weapon` role, no `fire` clip").
TOOL_LENGTH, TOOL_RADIUS = (0.50, 0.90), 0.018   # handle length: hand-to-heap, clamped
TOOL_BLADE = (0.14, 0.10, 0.02)

#: Figures whose preview did NOT come back in an A-pose but with both arms
#: reaching FORWARD (the digger: elbows behind the torso at 0.6 H, hands at
#: x +0.62 m and 0.78 H -- measured 2026-10-01). Nothing is outboard of the
#: torso in |y|, so `_arm_axis` has no band to find and the arms cannot be
#: cut and hung without a seam through the chest rig. The whole upper body
#: is kept as ONE `torso` part on `spine` instead, with synthetic hanging
#: arm joints so the bone tables and clips are unchanged; the corpse lies on
#: its SIDE (roll 90) rather than face down, since arms that reach forward
#: would otherwise hold a face-down body off the ground; and the tool is
#: read off the real hands (the torso's forward-most vertices) and bound to
#: `spine` with them. A kneeling digger with his arms out to the mound reads
#: as labour; the walker walks with his arms out, which a 25 px rare unit
#: can carry rather than a second preview.
ARMS_FORWARD = {"digger_crew"}
#: The same fix per SIDE (B5, 2026-10-01): which arm sides (0 = left/-y,
#: 1 = right/+y) stay on the torso. `ARMS_FORWARD` is both sides; the
#: breach figure came back with its LEFT arm bent across the chest holding
#: the rifle the prompt never asked for, while its right arm is a true
#: A-pose arm that cuts and hangs normally. A side listed here gets the
#: synthetic hanging joints and no arm parts; `_bend_forearms`,
#: `_death_parts_posed` and the deltoid/elbow blobs all skip it.
ARMS_ON_TORSO = {"digger_crew": {0, 1}, "breach_team": {0},
                 # B7: the rifleman preview came holding its carbine across
                 # the chest in BOTH hands (the subject noun beat the pose
                 # line, as on breach_team) -- both arms stay on the torso,
                 # the baked carbine is the rifle (WEAPON_ON_SPINE), and the
                 # fire clip is a FIRE_ROOT_LEAN brace. No kit rifle.
                 "inf_squad": {0, 1},
                 # B7: the sniper preview came AIMING its carbine -- both arms
                 # up on the gun, no A-pose, no ghillie hood. Kept rather than
                 # re-rolled: laid on its chest with the carbine turned to run
                 # along the body, an aiming man IS a man on the scope.
                 "sniper_team": {0, 1}}
#: A weapon the preview BAKED into the figure, per team: the region (in
#: fractions of H, +X forward) cut off the torso as its own `weapon` piece
#: and force-bound to `{prefix}_spine` -- it is held in the hand that stays
#: on the torso, so it rides with the torso, never with `forearm_R`. The
#: breach preview came with a compact carbine across the chest in the LEFT
#: hand (measured 2026-10-01: faces at x > 0.06 H between z 0.52 and 0.72 H
#: and y -0.14..+0.04 H, where the chest front sits at x 0.02-0.04 H).
#: Cutting it out would leave the carrier and the gripping hand open; a kit
#: rifle beside it would be a second gun. So it IS the team's rifle: no kit
#: rifle, no hand-bound weapon, and `rig.TEAM_FIGURES` declares
#: `weapon=None` with a `FIRE_ROOT_LEAN` brace for the fire clip.
WEAPON_ON_SPINE = {"breach_team": dict(x_min=0.06, y=(-0.16, 0.08), z=(0.50, 0.74)),
                   # B7: the carbine runs diagonally across the chest from the
                   # right hip to the left shoulder; the box is wide enough
                   # for the barrel and the magazine, measured on the remesh.
                   "inf_squad": dict(x_min=0.07, y=(-0.20, 0.16), z=(0.44, 0.78)),
                   # B7: the sniper's carbine is held out ahead of the chest at
                   # shoulder height, barrel forward.
                   "sniper_team": dict(x_min=0.10, y=(-0.22, 0.22), z=(0.56, 0.88))}
#: The refine painted a small readable name tape on the breach figure's
#: carrier ("no text" in the prompt notwithstanding): the texels of the
#: upper-chest faces in this region whose luminance is above `lum_min` are
#: set to the region's own dark median, so the tape goes the carrier's
#: black. Fractions of H, +X forward.
LABEL_FLATTEN = {"breach_team": dict(x_min=-0.02, y=(-0.08, 0.08), z=(0.68, 0.82), lum_min=0.35)}
CORPSE_ROLL_BY_TEAM = {"digger_crew": 90.0,
                       # B5: the left arm across the chest (ARMS_ON_TORSO) would hold a
                       # face-down body off the ground, as the digger's forward arms did.
                       "breach_team": 90.0}
#: ...and lies head AWAY from the heap (the generic corpse falls head-forward,
#: +x, which from the digger's anchor at x -0.34 puts the head inside the
#: mound at x +0.36).
CORPSE_YAW_BY_TEAM = {"digger_crew": 180.0}
#: charge_squad's two corpses: single-file anchors 0.16 m apart in y put one
#: 1.8 m body on top of the other (kit's did the same). The death roots are
#: offset sideways so the pair reads as two men down, not a heap.
CORPSE_Y_OFFSET = {"charge_squad": {"chg0": -0.30, "chg1": 0.30},
                   # B5: anchors 0.42 m apart in y and two 1.8 m bodies on their
                   # side still overlapped; pushed apart the same way.
                   "breach_team": {"brc_point": -0.22, "brc_cover": 0.22}}

#: `kit.blob` topology per team. B2 used kit's default (9 sides, 3 rings: 72
#: glTF tris a blob, ~580 a body copy). B3's numbers tables budget the
#: kneeling ATGM crew at three copies per figure inside the 8,000-tri team
#: cap, so its joints are coarser -- 7 x 2, 42 tris -- and the two standing
#: teams take the same so the batch reads as one register.
BLOB_KW = {"militia_cell": dict(sides=7, rings=2), "rpg_team": dict(sides=7, rings=2),
           "atgm_cell": dict(sides=7, rings=2),
           "mortar_crew": dict(sides=7, rings=2), "charge_squad": dict(sides=7, rings=2),
           "digger_crew": dict(sides=7, rings=2), "breach_team": dict(sides=7, rings=2),
           "moto_rpg": dict(sides=7, rings=2)}

#: Hand-bound weapon carriers get both forearms bent forward at the elbow --
#: rest geometry like the arm hang, one rigid rotation per forearm about its
#: own elbow -- so a kit rifle sits at the hands instead of floating at
#: chest height over arms that hang. Degrees: (pitch forward from hanging,
#: yaw inward about the elbow) for the left and the right forearm.
FORE_BEND = {"L": (75.0, 40.0), "R": (70.0, 10.0)}
#: Where the rifle grip sits past the right wrist, along the forearm.
HAND_REACH = 0.06
#: Rifle yaw across the front, degrees (negative: muzzle to the left).
RIFLE_YAW_DEG = -15.0    # mesh_gait.test.ts wants the rifle within 20 deg of the facing

#: The posed corpse (B3; B2 laid the A-pose body flat). Angles, all rigid
#: re-arrangements of the cut parts BEFORE the body is laid face down: the
#: left arm thrown overhead, the right arm out from the side, the right
#: thigh abducted and its shin splayed, the head turned, then the whole
#: body rolled so it is not a plank.
CORPSE_OVERHEAD = Vector((0.06, -0.34, 0.94))    # left arm target, standing frame
CORPSE_OUT = Vector((0.12, 0.92, -0.32))         # right arm target, standing frame
CORPSE_THIGH_DEG = 16.0                           # right thigh out, about the hip
CORPSE_SHIN_DEG = 42.0                            # right shin further out, about the knee
CORPSE_HEAD_DEG = 65.0                            # head turned, about the neck
CORPSE_ROLL_DEG = 12.0                            # body rolled about its own long axis
CORPSE_DECIMATE = 0.5
#: A3.1 (5 Oct): the Meshy hand weapons put two teams over the bible's 8,000
#: team cap (militia_cell 9,510, atgm_cell 9,725 glTF tris). The parts are the
#: thing being bought, so the FIGURE pays: the prone corpse, drawn only lying
#: face down after a death, is decimated harder on those two.
CORPSE_DECIMATE_BY_TEAM = {"militia_cell": 0.2, "atgm_cell": 0.2}
#: atgm_cell draws each man three times (kneeling, the D6 standing walker,
#: the corpse), so the corpse alone does not bring it under: its WALKERS --
#: drawn only in `move`, when the post is packed -- also lose triangles on
#: their `uniform` parts (boots, face and head untouched: the gait and facing
#: gates read those).
WALKER_DECIMATE_BY_TEAM = {"atgm_cell": 0.6}

# --- height fractions of the figure's own H --------------------------------
ANKLE_F, BOOT_TOP_F, KNEE_F, CROTCH_FALLBACK_F = 0.045, 0.09, 0.285, 0.47
NECK_F, CHIN_F, FACE_LO_F, FACE_HI_F = 0.83, 0.87, 0.88, 0.955
FACE_HALF_W = 0.07
ARM_ROOT_FALLBACK_F = 0.105    # torso half-width at the armpit: both B2 figures measure 0.20/1.90 src
ARM_BAND_Z_F = 0.15            # a |y| band spanning less than this in z (above 0.62 H) is arm, not torso
WRIST_IN_F, HAND_F = 0.07, 0.035 # the wrist band, measured inward from the fingertips along |y|
HAND_PAST_WRIST = 0.24         # how far past the wrist band the forearm segment still claims faces
R_ARM_F = 0.05                 # an arm's reach from its own axis, incl. the hand (0.087 m at 1.74)
#: Joint-blob radii: kit.py's own limb radii (for its 1.8 m figure), scaled
#: by height -- measured cross-sections on a 1,500-tri shell are too noisy
#: (a first pass read the chest rig as the upper arm and drew 0.2 m spheres).
BLOB_R = {"deltoid": kit.R_UPPERARM * 1.35, "elbow": kit.R_FOREARM * 1.25,
          "knee": kit.R_KNEE * 1.2, "hip": kit.R_THIGH * 1.1}
ARM_HANG_DEG = 10.0            # from vertical, outward, once hung
REAR_THIGH_DEG = 25.0          # kneel: rear thigh back from vertical
REAR_BOOT_FLEX_DEG = 80.0      # kneel: rear boot plantar-flexed behind the shin
DEATH_DECIMATE = 0.5


def log(msg):
    print(f"[crew] {msg}")


# ---------------------------------------------------------------------------
# geometry helpers
# ---------------------------------------------------------------------------

def _src(team_id):
    pattern, _h = SOURCES[team_id]
    hits = sorted(glob.glob(pattern))
    if len(hits) != 1:
        raise SystemExit(f"{team_id}: expected exactly one source at {pattern}, found {hits}")
    return hits[0]


def _load_figure(team_id):
    """The remesh as one mesh object: world transform applied, materials
    stripped, rotated to face +X, scaled to its target height, feet on z=0,
    ankles centred on the origin."""
    _pattern, height = SOURCES[team_id]
    bpy.ops.import_scene.gltf(filepath=_src(team_id))
    meshes = [o for o in bpy.data.objects if o.type == "MESH" and o.name != "rig"]
    if len(meshes) != 1:
        raise SystemExit(f"{team_id}: expected one mesh object, found {[o.name for o in meshes]}")
    ob = meshes[0]
    if team_id in TEXTURED:
        _keep_base_color(team_id, ob)
    else:
        ob.data.materials.clear()
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    co = _coords(ob)
    z = co[:, 2] - co[:, 2].min()
    h_src = z.max()
    zf = z / h_src
    feet, shin = zf < 0.04, (zf > 0.15) & (zf < 0.25)
    fwd_y = co[feet, 1].mean() - co[shin, 1].mean()
    if fwd_y >= 0:
        raise SystemExit(f"{team_id}: toes point +Y, not the -Y every B2 figure measured -- look before rotating")
    # -Y forward -> +X forward is +90 about Z; scale; feet to z=0; ankles to origin.
    k = height / h_src
    rot = Matrix.Rotation(math.radians(90.0), 4, "Z")
    me = ob.data
    for v in me.vertices:
        v.co = rot @ v.co
    for v in me.vertices:
        v.co = v.co * k
    co = _coords(ob)
    ankle = co[(co[:, 2] - co[:, 2].min()) < ANKLE_F * height]
    shift = Vector((-ankle[:, 0].mean(), -ankle[:, 1].mean(), -co[:, 2].min()))
    for v in me.vertices:
        v.co = v.co + shift
    co = _coords(ob)
    feet, shin = co[:, 2] < 0.04 * height, (co[:, 2] > 0.15 * height) & (co[:, 2] < 0.25 * height)
    if co[feet, 0].mean() <= co[shin, 0].mean():
        raise SystemExit(f"{team_id}: after the turn the toes do not point +X")
    log(f"{team_id}: source height {h_src:.4f} -> {height} m; {len(me.polygons)} tris; faces +X")
    ob.name = "figure_src"
    if team_id in RECOLOUR and team_id in TEXTURED:
        _recolour_head(team_id, ob, height, *RECOLOUR[team_id])
    if team_id in LABEL_FLATTEN and team_id in TEXTURED:
        _flatten_label(team_id, ob, height, **LABEL_FLATTEN[team_id])
    _bisect_source(team_id, ob, height)
    return ob, height


def _bisect_source(team_id, ob, height):
    """Cut the source shell along every plane `cut_figure` classifies by, so
    no triangle straddles a cut (B7 review). A remesh at 1,000-1,500 tris
    has triangles up to ~10 cm across; a triangle crossing the knee plane
    stayed whole with whichever side its centroid fell on, and the kneel
    then rotated it against its neighbours into a spike -- the shards on
    the mortar team's thighs and shoulders. Bisected, every part ends
    exactly on its plane and the blob joints cover a clean seam. The arm
    planes are the measured arm roots (|y| = w_arm), skipped for a figure
    whose arms stay on the torso. Face count grows ~10-15%."""
    H = height
    co = _coords(ob)
    zc = CROTCH_FALLBACK_F * H
    # The HINGE planes only -- where a rigid re-arrangement (the kneel, the
    # arm hang) turns one part against its neighbour: ankle, knee, crotch and
    # the two arm roots. Every plane bisected adds a ring of triangles round
    # the whole body (all nine cut planes read +95% on a 974-tri shell; these
    # five about +40%), and the neck, chin, belt and face cuts never move
    # against each other.
    # (plane point, normal, which faces may be split: a predicate on the face
    # centroid, so a leg plane never splits the torso and an arm plane never
    # splits the hips -- each cut then adds one ring where it is needed.)
    planes = [((0.0, 0.0, f * H), (0.0, 0.0, 1.0), (lambda c, zf=f * H: abs(c[2] - zf) < 0.12)) for f in (ANKLE_F, KNEE_F)]
    planes += [((0.0, 0.0, zc), (0.0, 0.0, 1.0), (lambda c: abs(c[2] - zc) < 0.12))]
    on_torso = ARMS_ON_TORSO.get(team_id, set())
    # The arm axes are measured BEFORE the cut and cached for `cut_figure`:
    # a bisected ring at |y| = w_arm puts torso-height vertices into the
    # first arm-only band `_arm_axis` scans for, and the shoulder it reads
    # steps 2 cm outboard -- on the MANPAD that moved the launcher's seat
    # search off the seat it had found.
    axes = {}
    for side in (0, 1):
        if side in on_torso:
            continue
        axes[side] = _arm_axis(co, H, side)
        w = axes[side][3]
        sgn = -1.0 if side == 0 else 1.0
        planes.append(((0.0, sgn * w, 0.0), (0.0, 1.0, 0.0),
                       (lambda c, w=w, sgn=sgn: c[2] > 0.55 * H and abs(c[1] * sgn - w) < 0.08)))
    _ARM_AXES_CACHE.clear()
    _ARM_AXES_CACHE.update({side: tuple(tuple(v) if hasattr(v, "__len__") else v for v in ax) for side, ax in axes.items()})
    before = len(ob.data.polygons)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for pco, pno, near in planes:
        faces = [f for f in bm.faces if near(f.calc_center_median())]
        verts = {v for f in faces for v in f.verts}
        edges = {e for f in faces for e in f.edges}
        bmesh.ops.bisect_plane(bm, geom=list(verts) + list(edges) + faces, plane_co=pco, plane_no=pno, dist=1e-5)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    log(f"{team_id}: bisected at {len(planes)} cut planes -- {before} -> {len(ob.data.polygons)} tris")


#: The source figure's arm axes as `_arm_axis` read them BEFORE the bisection
#: (see `_bisect_source`); `cut_figure` takes these over a fresh measurement.
_ARM_AXES_CACHE = {}


def _part_samples(objs):
    """Surface samples of kit parts: every vertex plus every edge at 1 cm."""
    pts = []
    for ob in objs:
        co = _coords(ob)
        pts.extend(co.tolist())
        for e in ob.data.edges:
            a, b = co[e.vertices[0]], co[e.vertices[1]]
            n = max(2, int(np.linalg.norm(b - a) / 0.01) + 1)
            for t in np.linspace(0.0, 1.0, n)[1:-1]:
                pts.append((a + (b - a) * t).tolist())
    return np.array(pts, dtype=np.float64)


def _inside_count(sample_objs, body_objs):
    """How many surface samples of `sample_objs` lie inside the union of
    `body_objs`, by generalised winding number -- the census PR #325 ran
    and `launcher_clearance.test.ts` repeats on the exported bytes."""
    if not body_objs:
        return 0
    P = _part_samples(sample_objs)
    T = np.concatenate([_tris(o) for o in body_objs])
    return int((_winding(P, T) > 0.5).sum())


def _pack_behind(name, pfx, parts, kneel):
    """yahalom_squad's square pack seated BEHIND the figure's own measured
    back (B7 review): `teams._yah_pack` centres it 0.18 m behind the kit
    figure's axis, which on a Meshy torso (back at x -0.25) ran the box
    through the chest. The pack's front face sits 1 cm behind the furthest
    back point of the torso in the pack's own height band."""
    seq = parts.values() if isinstance(parts, dict) else parts
    torso = next(o for o in seq if o.name == f"{pfx}_torso")
    hips = next((o for o in seq if o.name == f"{pfx}_hips"), None)
    sx, sy, sz = teams.YAH_PACK_SIZE
    cz = 0.95 - (0.54 if kneel else 0.0)
    tc = _coords(torso)
    band = tc[(tc[:, 2] > cz - sz / 2.0) & (tc[:, 2] < cz + sz / 2.0)]
    if len(band) == 0:
        band = tc
    back_x = float(band[:, 0].min())
    cy = float(band[:, 1].mean())
    pack = kit.box(name, (sx, sy, sz), (back_x - sx / 2.0 - 0.01, cy, cz), role="webbing")
    inside = _inside_count([pack], [o for o in (torso, hips) if o is not None])
    log(f"{pfx}: pack behind the back at x {back_x - sx / 2.0 - 0.01:+.3f} (back {back_x:+.3f}); "
        f"{inside} samples inside the torso")
    return pack, inside


def _recolour_head(team_id, ob, height, target, hue_window):
    """See RECOLOUR. Rasterises the head/neck faces' UV triangles into a
    mask on `base_color`, then remaps the saturated red-magenta texels
    inside it."""
    img = bpy.data.images["base_color"]
    w, h = img.size
    me = ob.data
    cent = _face_centroids(ob)
    co = _coords(ob)
    head = cent[:, 2] > CHIN_F * height
    x_head = co[co[:, 2] > CHIN_F * height][:, 0].mean()
    face_strip = ((cent[:, 0] > x_head + 0.02) & (cent[:, 2] > FACE_LO_F * height)
                  & (cent[:, 2] < FACE_HI_F * height) & (np.abs(cent[:, 1]) < FACE_HALF_W))
    # Down to the upper chest, not just the neck cut: the rpg figure's
    # scarf hangs to the collarbones, and the hue window is what keeps
    # the shirt and the rig out of it.
    floor_f = RECOLOUR_FLOOR_BY_TEAM.get(team_id, RECOLOUR_FLOOR_F)
    sel = ((cent[:, 2] > floor_f * height) & ~(head & face_strip))
    uv = np.empty(len(me.loops) * 2, dtype=np.float32)
    me.uv_layers.active.data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    mask = np.zeros((h, w), dtype=bool)
    for i in np.nonzero(sel)[0]:
        poly = me.polygons[i]
        tri = uv[list(poly.loop_indices)][:3]
        px = np.stack([(tri[:, 0] % 1.0) * (w - 1), (tri[:, 1] % 1.0) * (h - 1)], axis=1)
        x0, x1 = int(np.floor(px[:, 0].min())), int(np.ceil(px[:, 0].max()))
        y0, y1 = int(np.floor(px[:, 1].min())), int(np.ceil(px[:, 1].max()))
        if x1 <= x0 or y1 <= y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
        (ax, ay), (bx, by), (cx, cy) = px
        det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
        if abs(det) < 1e-9:
            continue
        l1 = ((bx - xs) * (cy - ys) - (cx - xs) * (by - ys)) / det
        l2 = ((cx - xs) * (ay - ys) - (ax - xs) * (cy - ys)) / det
        l3 = 1.0 - l1 - l2
        inside = (l1 >= -0.002) & (l2 >= -0.002) & (l3 >= -0.002)
        mask[ys[inside], xs[inside]] = True
    pix = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(pix)
    pix = pix.reshape(h, w, 4)
    rgb = pix[:, :, :3]
    mx, mn = rgb.max(axis=2), rgb.min(axis=2)
    sat = np.where(mx > 1e-6, (mx - mn) / np.maximum(mx, 1e-6), 0.0)
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    d = np.maximum(mx - mn, 1e-6)
    hue = np.where(mx == r, (g - b) / d % 6.0, np.where(mx == g, (b - r) / d + 2.0, (r - g) / d + 4.0)) * 60.0
    lo, hi = hue_window
    # A window given as (300, 20) wraps through red; one given as (95, 150)
    # does not (B7: the Sarim rifleman's green headband).
    in_hue = ((hue >= lo) | (hue <= hi)) if lo > hi else ((hue >= lo) & (hue <= hi))
    hit = mask & in_hue & (sat > RECOLOUR_SAT_MIN)
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    t = np.array(target, dtype=np.float32)
    t_lum = float(0.2126 * t[0] + 0.7152 * t[1] + 0.0722 * t[2])
    scale = (lum[hit] / t_lum)[:, None]
    rgb[hit] = np.clip(t[None, :] * scale, 0.0, 1.0)
    img.pixels.foreach_set(pix.reshape(-1))
    img.pack()
    log(f"{team_id}: head recolour -- {int(sel.sum())} faces, mask {int(mask.sum())} px, "
        f"remapped {int(hit.sum())} px to {target}")


def _flatten_label(team_id, ob, height, x_min, y, z, lum_min):
    """See LABEL_FLATTEN. Rasterises the faces inside the region into a
    mask on `base_color` (the same rasteriser `_recolour_head` uses) and
    sets every masked texel brighter than `lum_min` to the median of the
    masked texels that are not."""
    img = bpy.data.images["base_color"]
    w, h = img.size
    me = ob.data
    cent = _face_centroids(ob)
    H = height
    sel = ((cent[:, 0] > x_min * H) & (cent[:, 1] > y[0] * H) & (cent[:, 1] < y[1] * H)
           & (cent[:, 2] > z[0] * H) & (cent[:, 2] < z[1] * H))
    mask = _uv_mask(me, sel, w, h)
    pix = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(pix)
    pix = pix.reshape(h, w, 4)
    rgb = pix[:, :, :3]
    lum = 0.2126 * rgb[:, :, 0] + 0.7152 * rgb[:, :, 1] + 0.0722 * rgb[:, :, 2]
    dark = mask & (lum <= lum_min)
    hit = mask & (lum > lum_min)
    if dark.sum() == 0 or hit.sum() == 0:
        log(f"{team_id}: label flatten -- {int(sel.sum())} faces, mask {int(mask.sum())} px, nothing to do")
        return
    fill = np.median(rgb[dark], axis=0)
    rgb[hit] = fill
    img.pixels.foreach_set(pix.reshape(-1))
    img.pack()
    log(f"{team_id}: label flatten -- {int(sel.sum())} faces, mask {int(mask.sum())} px, "
        f"{int(hit.sum())} px above {lum_min} set to {tuple(round(float(c), 3) for c in fill)}")


def _uv_mask(me, sel, w, h):
    """A boolean (h, w) mask of the texels covered by the UV triangles of the
    faces `sel` selects."""
    uv = np.empty(len(me.loops) * 2, dtype=np.float32)
    me.uv_layers.active.data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    mask = np.zeros((h, w), dtype=bool)
    for i in np.nonzero(sel)[0]:
        poly = me.polygons[i]
        tri = uv[list(poly.loop_indices)][:3]
        px = np.stack([(tri[:, 0] % 1.0) * (w - 1), (tri[:, 1] % 1.0) * (h - 1)], axis=1)
        x0, x1 = int(np.floor(px[:, 0].min())), int(np.ceil(px[:, 0].max()))
        y0, y1 = int(np.floor(px[:, 1].min())), int(np.ceil(px[:, 1].max()))
        if x1 <= x0 or y1 <= y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
        (ax, ay), (bx, by), (cx, cy) = px
        det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
        if abs(det) < 1e-9:
            continue
        l1 = ((bx - xs) * (cy - ys) - (cx - xs) * (by - ys)) / det
        l2 = ((cx - xs) * (ay - ys) - (ax - xs) * (cy - ys)) / det
        l3 = 1.0 - l1 - l2
        inside = (l1 >= -0.002) & (l2 >= -0.002) & (l3 >= -0.002)
        mask[ys[inside], xs[inside]] = True
    return mask


#: The one material every textured part shares, set by `_keep_base_color`.
_TEX = {"material": None, "src": None}


def _keep_base_color(team_id, ob):
    """Keep exactly one material on the remesh: its Principled BSDF with the
    base-colour image linked, every other image (normal, metallic-roughness)
    unlinked and removed. The image is renamed `base_color` -- the name the
    vehicle and building texture modules key on -- and downscaled at export."""
    mats = [m for m in ob.data.materials if m is not None]
    if len(mats) != 1 or not mats[0].use_nodes:
        raise SystemExit(f"{team_id}: expected one node material on the remesh, found {[m.name for m in mats]}")
    mat = mats[0]
    tree = mat.node_tree
    bsdf = next((n for n in tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        raise SystemExit(f"{team_id}: no Principled BSDF on {mat.name}")
    link = next((l for l in tree.links if l.to_node == bsdf and l.to_socket.name == "Base Color"), None)
    if link is None or link.from_node.type != "TEX_IMAGE" or link.from_node.image is None:
        raise SystemExit(f"{team_id}: Base Color is not an image on {mat.name} -- no bake to ship")
    base = link.from_node.image
    for node in list(tree.nodes):
        if node.type == "TEX_IMAGE" and node.image is not base:
            img = node.image
            tree.nodes.remove(node)
            if img is not None and img.users == 0:
                bpy.data.images.remove(img)
    for other in list(bpy.data.images):
        if other is not base and other.users == 0:
            bpy.data.images.remove(other)
    base.name = "base_color"
    if not ob.data.uv_layers:
        raise SystemExit(f"{team_id}: the remesh carries no UV layer")
    _TEX["material"] = mat
    log(f"{team_id}: bake kept -- {mat.name}, base_color {base.size[0]}x{base.size[1]}, "
        f"{len(ob.data.uv_layers)} uv layer(s)")


def _borrow_uv(ob, src, near=None):
    """Give a UV-less kit part (a blob joint, a keffiyeh) the source figure's
    material and ONE uv -- the centroid uv of the source face nearest the
    part's own centre (or `near`, when the part should take its colour from
    somewhere else: a kit keffiyeh over a bare textured head borrows from the
    shirt, not from the hair) -- so it takes that cloth colour of the bake."""
    if _TEX["material"] is None or src is None or not src.data.uv_layers:
        return
    me_s = src.data
    uv_s = me_s.uv_layers.active.data
    cent = _face_centroids(src)
    c = np.array(near, dtype=np.float64) if near is not None else _coords(ob).mean(axis=0)
    i = int(np.argmin(((cent - c) ** 2).sum(axis=1)))
    poly = me_s.polygons[i]
    uv = np.mean([uv_s[l].uv[:] for l in poly.loop_indices], axis=0)
    me = ob.data
    layer = me.uv_layers.active if me.uv_layers else me.uv_layers.new(name="UVMap")
    for loop in layer.data:
        loop.uv = uv
    me.materials.clear()
    me.materials.append(_TEX["material"])


def _blob(name, at, radius, src=None, **kw):
    """`kit.blob` at this team's topology (`BLOB_KW`), textured if the team is."""
    kw = {**_BLOB_KW_ACTIVE, **kw}
    ob = kit.blob(name, at, radius, **kw)
    _borrow_uv(ob, src)
    return ob


_BLOB_KW_ACTIVE = {}
_TEAM = {"id": None}


def _coords(ob):
    co = np.empty(len(ob.data.vertices) * 3, dtype=np.float64)
    ob.data.vertices.foreach_get("co", co)
    return co.reshape(-1, 3)


def _face_centroids(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    cent = np.array([tuple(f.calc_center_median()) for f in bm.faces], dtype=np.float64)
    bm.free()
    return cent


def _find_crotch(cent, height):
    """The top of the first band (scanning down from the belt) in which the
    left-of-midline and right-of-midline face centroids are separated by a
    real gap -- two legs rather than one body. Face centroids rather than
    vertices because a 1,500-tri remesh leaves 2 cm bands with no vertex at
    all on a belly. Clamped to the anthropometric window either way."""
    z = cent[:, 2]
    band_h = 0.02 * height
    for lo in np.arange(0.58, 0.36, -0.02):
        band = (z >= lo * height) & (z < lo * height + band_h)
        ys = cent[band, 1]
        pos, neg = ys[ys > 0], ys[ys < 0]
        if len(pos) == 0 or len(neg) == 0:
            continue
        if pos.min() - neg.max() > 0.04 * height:
            return float(min(max(lo * height + band_h, 0.44 * height), 0.52 * height))
    return CROTCH_FALLBACK_F * height


def _arm_axis(co, height, side):
    """The spread arm's own joints. Returns (shoulder, elbow, wrist,
    torso half-width), all measured.

    B2 fitted this from a fixed torso half-width (0.105 H) and the centroid of
    a 5 cm ring outboard of it above z = 0.62 H. The B3 militia figure broke
    that: a broad chest rig puts torso flank INSIDE that ring, so the
    "shoulder" read at z 1.19 on a 1.70 m man (true ~1.40) and the arm came
    out 82 degrees from vertical -- half of it left in the torso. Measured,
    not assumed, now: |y| bands of 2 cm scanned outward above z = 0.62 H;
    a band that still spans the torso's height (belt to shoulder, ~0.23 H)
    is torso, the first band that spans only an arm's thickness is where
    the arm leaves the body; the shoulder is the centre of the first two
    arm-only bands."""
    sgn = -1.0 if side == 0 else 1.0
    y = co[:, 1] * sgn
    upper = co[:, 2] > 0.62 * height
    ymax = float(y[upper].max())
    step = 0.02
    w_arm = None
    for lo in np.arange(0.09 * height, ymax - 0.05, step):
        band = upper & (y >= lo) & (y < lo + step)
        if band.sum() < 6:
            continue
        if co[band, 2].max() - co[band, 2].min() < ARM_BAND_Z_F * height:
            w_arm = float(lo)
            break
    if w_arm is None:
        raise SystemExit(f"arm{side}: no arm-only band found -- not an A-pose figure?")
    # The shoulder is the centre of the first two arm-only bands -- the arm
    # root where it leaves the torso. (A line fitted through every band and
    # extrapolated back was tried first and read 0.09 m LOW on this figure:
    # its forearm is flatter than its upper arm, so the fit averages the two
    # slopes and lands under the deltoid.)
    root = upper & (y >= w_arm) & (y < w_arm + 2.0 * step)
    shoulder = Vector(co[root].mean(axis=0))
    # The wrist is the WRIST band, not the fingertips: this figure's open
    # hands cup upward, and a fingertip centroid put the axis 25 degrees
    # flatter than the arm it was meant to follow.
    above = co[:, 2] > 0.5 * height
    wrist_sel = above & (y > ymax - WRIST_IN_F * height) & (y < ymax - HAND_F * height)
    wrist = Vector(co[wrist_sel if wrist_sel.sum() >= 4 else above & (y > ymax - 0.05)].mean(axis=0))
    # The elbow: an A-pose arm is bent (this one visibly -- upper arm out
    # and down, forearm out and up), so a straight shoulder-to-wrist axis
    # is 0.2 m long on a 0.55 m arm and the hung arm came out a stub. The
    # elbow is the lowest band centroid in the middle of the |y| span; on
    # a straight arm sloping down that is the window's outer end, which
    # is still a fair elbow.
    span = ymax - w_arm
    best = None
    for lo in np.arange(w_arm + 0.32 * span, w_arm + 0.66 * span, step):
        band = above & (y >= lo) & (y < lo + step)
        if band.sum() < 4:
            continue
        c = co[band].mean(axis=0)
        if best is None or c[2] < best[2]:
            best = c
    elbow = Vector(best) if best is not None else shoulder.lerp(wrist, 0.45)
    return shoulder, elbow, wrist, w_arm


def _keep_only(ob, keep_idx):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index not in keep_idx], context="FACES")
    bm.to_mesh(ob.data)
    bm.free()


def _piece(src, name, role, faces):
    bpy.ops.object.select_all(action="DESELECT")
    src.select_set(True)
    bpy.context.view_layer.objects.active = src
    bpy.ops.object.duplicate()
    ob = bpy.context.object
    ob.name = name
    ob.data.name = name
    _keep_only(ob, faces)
    for k in list(ob.keys()):
        if k != "_RNA_UI":
            del ob[k]
    ob["rl_role"] = role
    return ob


def _transform(ob, mat):
    for v in ob.data.vertices:
        v.co = mat @ v.co


def _rot_about(point, axis, deg):
    p = Vector(point)
    return Matrix.Translation(p) @ Matrix.Rotation(math.radians(deg), 4, axis) @ Matrix.Translation(-p)


def _radius_near(co, point, band=0.03):
    """Mean radial distance from `point` (in the horizontal plane) of the
    vertices within `band` of its height -- a limb's local radius."""
    z = co[:, 2]
    sel = np.abs(z - point[2]) < band
    if not sel.any():
        return 0.05
    d = np.hypot(co[sel, 0] - point[0], co[sel, 1] - point[1])
    return float(np.median(d))


# ---------------------------------------------------------------------------
# one figure: cut, hang the arms, measure the joints
# ---------------------------------------------------------------------------

def cut_figure(src, height, prefix, blobs=True):
    """Cut the standing source into rig.py parts at the origin. Returns
    (parts, joints) where joints is a dict of the measured points every later
    step (bones, kneel, corpse) reads."""
    co = _coords(src)
    cent = _face_centroids(src)
    H = height
    # Measured crotch heights on the two B2 remeshes swung between the clamps
    # (0.44 H and 0.52 H) on a 1,500-tri shell, so the cut uses the
    # anthropometric fraction and the scan is only reported beside it.
    zc = CROTCH_FALLBACK_F * H
    log(f"{prefix}: crotch scan read {_find_crotch(cent, H) / H:.3f} H; cutting at {CROTCH_FALLBACK_F} H")
    z_ankle, z_boot, z_knee = ANKLE_F * H, BOOT_TOP_F * H, KNEE_F * H
    z_belt, z_neck, z_chin = zc + 0.08, NECK_F * H, CHIN_F * H
    head = co[co[:, 2] > z_chin]
    x_head, y_head = float(head[:, 0].mean()), float(head[:, 1].mean())
    on_torso = ARMS_ON_TORSO.get(_TEAM["id"], set())
    merge_arms = on_torso == {0, 1}
    if merge_arms:
        # See ARMS_FORWARD: nothing is outboard, every face stays torso.
        axes = None
        w_arm = float(np.abs(co[co[:, 2] > 0.62 * H][:, 1]).max()) + 0.01
    else:
        axes = {side: (None if side in on_torso else
                       (tuple(Vector(v) if isinstance(v, tuple) else v for v in _ARM_AXES_CACHE[side])
                        if side in _ARM_AXES_CACHE else _arm_axis(co, H, side)))
                for side in (0, 1)}
        w_arm = max(a[3] for a in axes.values() if a is not None)
    log(f"{prefix}: crotch {zc:.3f} ({zc / H:.3f} H) arm-root |y| {w_arm:.3f} knee {z_knee:.3f} "
        f"neck {z_neck:.3f} chin {z_chin:.3f}"
        f"{' (arms kept on the torso)' if merge_arms else ''}"
        f"{f' (arm sides {sorted(on_torso)} kept on the torso)' if on_torso and not merge_arms else ''}")

    def arm_side(p, y_out):
        """0/1 if a face is arm: its OUTERMOST vertex (`y_out`, signed) lies
        beyond the measured torso edge, and its centroid `p` is either above
        the armpit line (0.62 H -- nothing but arm is out there) or within
        R_ARM of the arm's axis (a low-hanging A-pose forearm). The pouches
        at the waist are outboard too but below the line and far from the
        axis. Two things B2 did differently, both measured wrong on a
        2,000-tri figure with near-horizontal arms: it tested the CENTROID
        against the torso edge, so a face straddling the armpit stayed with
        the torso and stuck out as a spike once the arm was hung (a 6 cm
        triangle reaches 6 cm past its own centroid); and it required the
        axis test alone, which left a third of a thick forearm behind."""
        if axes is None or abs(y_out) <= w_arm or p[2] < 0.5 * H:
            return None
        side = 0 if y_out < 0 else 1
        if axes[side] is None:
            return None   # ARMS_ON_TORSO: this side's arm stays with the torso
        if p[2] > 0.62 * H:
            return side
        shoulder, elbow, wrist, _w = axes[side]
        pv = Vector(p)
        # The forearm segment runs on past the wrist by a hand's length:
        # on the ATGM figure (arms 62 degrees from vertical) the fingertips
        # sit below the armpit line, and a glove face left behind here
        # floated beside the kneeling man at his old A-pose hand.
        for a, b, past in ((shoulder, elbow, 0.05), (elbow, wrist, HAND_PAST_WRIST)):
            axis = (b - a).normalized()
            d = pv - a
            along = d.dot(axis)
            if -0.05 <= along <= (b - a).length + past and (d - axis * along).length < R_ARM_F * H:
                return side
        return None

    classes = {}
    head_role = HEAD_ROLE.get(_TEAM["id"], HEAD_ROLE_DEFAULT)

    def put(i, name, role):
        classes.setdefault((name, role), set()).add(i)

    vco = _coords(src)
    y_outer = np.array([max((vco[v][1] for v in poly.vertices), key=abs) for poly in src.data.polygons])
    wos = WEAPON_ON_SPINE.get(_TEAM["id"])
    for i, (x, y, z) in enumerate(cent):
        side = arm_side((x, y, z), y_outer[i])
        if side is not None:
            put(i, f"arm{side}", "uniform")
        elif (wos is not None and x > wos["x_min"] * H and wos["y"][0] * H < y < wos["y"][1] * H
              and wos["z"][0] * H < z < wos["z"][1] * H):
            put(i, "carbine", "weapon")
        elif z > z_chin:
            # A centred strip, |y| < FACE_HALF_W: the hooded figure's head
            # wraps to one side and an off-centre face strip read 30 degrees
            # off the way the man travels (mesh_gait.test.ts's facing sweep).
            if x > x_head + 0.02 and FACE_LO_F * H < z < FACE_HI_F * H and abs(y - y_head) < FACE_HALF_W:
                put(i, "face", "face")
            else:
                put(i, "cranium", head_role)
        elif z > z_neck:
            put(i, "neck", head_role)
        elif z > z_belt:
            put(i, "torso", "uniform")
        elif z > zc - 0.02:
            put(i, "hips", "uniform")
        else:
            side = 0 if y < 0 else 1
            if z > z_knee:
                put(i, f"thigh{side}", "uniform")
            elif z > z_boot:
                put(i, f"calf{side}", "uniform")
            else:
                put(i, f"boot{side}", "boot")

    parts = {}
    for (name, role), faces in classes.items():
        parts[name] = _piece(src, f"{prefix}_{name}", role, faces)

    # The head's own centre in plan: the neck and head bones sit on it, and
    # the face strip is cut about it. The militia figure's head sits 5 cm
    # off the figure's axis, and with the bone ON the axis the strip's
    # bearing from the bone read 26 degrees (mesh_gait.test.ts's facing
    # sweep, limit 25) for a head that looks straight ahead.
    joints = {"H": H, "crotch": zc, "knee": z_knee, "ankle": z_ankle, "neck": z_neck, "chin": z_chin,
              "belt": z_belt, "head_xy": (x_head, y_head), "leg": {}, "arm": {}}
    # Legs: the knee band's centroid per side is where the thigh and shin bones meet.
    for side in (0, 1):
        pc = _coords(parts[f"calf{side}"])
        top = pc[pc[:, 2] > z_knee - 0.05]
        joints["leg"][side] = (float(top[:, 0].mean()), float(top[:, 1].mean()))

    # Arms: split each into upper and fore at the measured elbow, then hang
    # each segment separately -- the upper arm about the shoulder, the
    # forearm about the moved elbow -- so a bent A-pose arm hangs straight
    # at its full length.
    for side in (0, 1):
        if side in on_torso:
            # Synthetic hanging joints (see ARMS_FORWARD): nothing binds to
            # the arm bones, but the bone tables, kneel and clips read them.
            sgn = -1.0 if side == 0 else 1.0
            down = Vector((0.0, sgn * math.sin(math.radians(ARM_HANG_DEG)), -math.cos(math.radians(ARM_HANG_DEG))))
            sh = Vector((x_head, sgn * 0.12 * H, 0.80 * H))
            el = sh + down * (0.17 * H)
            wr = el + down * (0.15 * H)
            joints["arm"][side] = {"shoulder": tuple(sh), "elbow": tuple(el), "wrist": tuple(wr)}
            log(f"{prefix}: arm{side} kept on the torso; synthetic joints shoulder z {sh.z:.3f} wrist z {wr.z:.3f}")
            continue
        arm = parts.pop(f"arm{side}")
        shoulder, elbow, wrist, _w = axes[side]
        acent = _face_centroids(arm)
        upper_faces = {i for i, c in enumerate(acent) if abs(c[1]) < abs(elbow.y)}
        fore_faces = set(range(len(acent))) - upper_faces
        upper = _piece(arm, f"{prefix}_upperarm{side}", "uniform", upper_faces)
        fore = _piece(arm, f"{prefix}_forearm{side}", "uniform", fore_faces)
        bpy.data.objects.remove(arm, do_unlink=True)
        sgn = -1.0 if side == 0 else 1.0
        target = Vector((0.0, sgn * math.sin(math.radians(ARM_HANG_DEG)), -math.cos(math.radians(ARM_HANG_DEG))))
        q_up = (elbow - shoulder).normalized().rotation_difference(target)
        m_up = Matrix.Translation(shoulder) @ q_up.to_matrix().to_4x4() @ Matrix.Translation(-shoulder)
        elbow_h = m_up @ elbow
        q_fore = (wrist - elbow).normalized().rotation_difference(target)
        m_fore = Matrix.Translation(elbow_h) @ q_fore.to_matrix().to_4x4() @ Matrix.Translation(-elbow)
        _transform(upper, m_up)
        _transform(fore, m_fore)
        wrist_h = m_fore @ wrist
        axis = (wrist - shoulder).normalized()
        k = H / kit.FIGURE_H
        parts[f"upperarm{side}"] = upper
        parts[f"forearm{side}"] = fore
        if blobs:
            parts[f"deltoid{side}"] = _blob(f"{prefix}_deltoid{side}", tuple(shoulder), BLOB_R["deltoid"] * k,
                                            src=src, squash=(1.0, 1.0, 0.9))
            parts[f"elbow{side}"] = _blob(f"{prefix}_elbow{side}", tuple(elbow_h), BLOB_R["elbow"] * k, src=src)
        joints["arm"][side] = {"shoulder": tuple(shoulder), "elbow": tuple(elbow_h), "wrist": tuple(wrist_h)}
        log(f"{prefix}: arm{side} A-pose {math.degrees(math.acos(abs(axis.z))):.1f} deg from vertical "
            f"(upper {(elbow - shoulder).length:.2f} m, fore {(wrist - elbow).length:.2f} m), hung to "
            f"{ARM_HANG_DEG}; shoulder z {shoulder.z:.3f} elbow z {elbow_h.z:.3f} wrist z {wrist_h.z:.3f}")

    # Knee and hip blobs, kit's own radii scaled to this figure.
    k = H / kit.FIGURE_H
    for side in (0, 1):
        lx, ly = joints["leg"][side]
        if blobs:
            parts[f"knee{side}"] = _blob(f"{prefix}_knee{side}", (lx, ly, z_knee), BLOB_R["knee"] * k, src=src)
            parts[f"hip{side}"] = _blob(f"{prefix}_hip{side}", (lx, ly, zc), BLOB_R["hip"] * k, src=src,
                                        squash=(1.05, 1.05, 1.05))
    return parts, joints


def _rename(parts, prefix, mapping):
    for old, new in mapping.items():
        if old in parts:
            ob = parts.pop(old)
            ob.name = f"{prefix}_{new}"
            ob.data.name = ob.name
            parts[new] = ob


def _move_all(parts, names, mat):
    for n in names:
        if n in parts:
            _transform(parts[n], mat)


def standing_bones(prefix, joints, dx, dy):
    """rig.py's `_BASE_BONES` shape with THIS figure's measured joints."""
    H, zc, zk, za, zn, zh = (joints[k] for k in ("H", "crotch", "knee", "ankle", "neck", "chin"))
    sh0 = joints["arm"][0]["shoulder"]
    z_sh = max(joints["arm"][s]["shoulder"][2] for s in (0, 1))
    hx, hy = joints["head_xy"]
    table = [
        ("root", None, (0.0, 0.0, 0.0), (0.0, 0.0, 0.15)),
        ("pelvis", "root", (0.0, 0.0, zc - 0.05), (0.0, 0.0, joints["belt"])),
        ("spine", "pelvis", (0.0, 0.0, joints["belt"]), (0.0, 0.0, z_sh - 0.02)),
        ("neck", "spine", (hx, hy, zn), (hx, hy, zh)),
        ("head", "neck", (hx, hy, zh), (hx, hy, H)),
    ]
    for side, name in ((0, "L"), (1, "R")):
        a = joints["arm"][side]
        table.append((f"upperarm_{name}", "spine", a["shoulder"], a["elbow"]))
        table.append((f"forearm_{name}", f"upperarm_{name}", a["elbow"], a["wrist"]))
    for side, name in ((0, "L"), (1, "R")):
        lx, ly = joints["leg"][side]
        table.append((f"thigh_{name}", "pelvis", (lx, ly, zc), (lx, ly, zk)))
        table.append((f"shin_{name}", f"thigh_{name}", (lx, ly, zk), (lx, ly, za)))
    out = rig._translate(table, dx, dy, prefix)
    for side, name in ((0, "L"), (1, "R")):
        lx, ly = joints["leg"][side]
        out.append((f"{prefix}_hip_{name}", f"{prefix}_pelvis",
                    (lx + dx, ly + dy, zc), (lx + dx, ly + dy, zc - 0.15 * (zc - zk))))
    return out


def _kneel(parts, joints, prefix):
    """Re-arrange standing parts (at the origin) into a kneel, rigidly, and
    return the kneel bone table (untranslated). Side 0 (-y) is the rear leg
    with its knee on the ground; side 1 (+y) the planted front leg."""
    H, zc, zk, za = (joints[k] for k in ("H", "crotch", "knee", "ankle"))
    L_thigh, L_shin = zc - zk, zk - za
    rear = math.radians(REAR_THIGH_DEG)
    r_knee = 0.06
    z_hip = r_knee + L_thigh * math.cos(rear)
    drop = zc - z_hip
    # Front thigh angle that lands the front sole exactly on the ground.
    s = (zk - z_hip) / L_thigh
    front = math.asin(max(-1.0, min(1.0, s)))
    log(f"{prefix}: kneel hip z {z_hip:.3f} (drop {drop:.3f}), rear thigh {REAR_THIGH_DEG} deg back, "
        f"front thigh {math.degrees(front):.1f} deg up")

    legs = {"thigh0", "thigh1", "calf0", "calf1", "boot0", "boot1", "knee0", "knee1", "hip0", "hip1"}
    _move_all(parts, [n for n in parts if n not in legs], Matrix.Translation((0.0, 0.0, -drop)))

    # Rear leg (side 0): thigh back about the hip, shin flat behind the knee,
    # boot flexed behind the shin.
    lx0, ly0 = joints["leg"][0]
    hip0 = Vector((lx0, ly0, zc))
    # R_y(t) takes the thigh's own down vector (0, 0, -1) to (-sin t, 0, -cos t):
    # a POSITIVE angle about +Y tips it backward, toward -x.
    m_thigh0 = Matrix.Translation((0, 0, -drop)) @ _rot_about(hip0, "Y", REAR_THIGH_DEG)
    knee0 = m_thigh0 @ Vector((lx0, ly0, zk))
    m_shin0 = _rot_about(knee0, "Y", 90.0) @ m_thigh0
    ankle0 = m_shin0 @ Vector((lx0, ly0, za))
    m_boot0 = _rot_about(ankle0, "Y", REAR_BOOT_FLEX_DEG) @ m_shin0
    _transform(parts["thigh0"], m_thigh0)
    _transform(parts["hip0"], m_thigh0)
    _transform(parts["knee0"], m_thigh0)
    _transform(parts["calf0"], m_shin0)
    _transform(parts["boot0"], m_boot0)
    # Front leg (side 1): thigh up about the hip, shin vertical below the knee.
    lx1, ly1 = joints["leg"][1]
    hip1 = Vector((lx1, ly1, zc))
    # Forward and up by `front`: (0, 0, -1) -> (cos f, 0, sin f) is R_y(-(90 + f)).
    m_thigh1 = Matrix.Translation((0, 0, -drop)) @ _rot_about(hip1, "Y", -(90.0 + math.degrees(front)))
    knee1 = m_thigh1 @ Vector((lx1, ly1, zk))
    m_shin1 = Matrix.Translation(knee1 - Vector((lx1, ly1, zk)))
    _transform(parts["thigh1"], m_thigh1)
    _transform(parts["hip1"], m_thigh1)
    _transform(parts["knee1"], m_thigh1)
    _transform(parts["calf1"], m_shin1)
    _transform(parts["boot1"], m_shin1)
    ankle1 = m_shin1 @ Vector((lx1, ly1, za))
    # Blobs over the wedges the two thigh rotations opened at the hips.
    kneek = parts["knee1"]
    _rename(parts, prefix, {"thigh0": "thigh_r", "calf0": "shin_r", "boot0": "boot_r",
                            "thigh1": "thigh_f", "calf1": "shin_f", "boot1": "boot_f",
                            "knee1": "knee_f", "knee0": "kneek_r", "hip0": "hipk_r", "hip1": "hipk_f"})
    del kneek
    hip0k = m_thigh0 @ hip0
    hip1k = m_thigh1 @ hip1
    bones = [
        ("root", None, (0.0, 0.0, 0.0), (0.0, 0.0, 0.15)),
        ("pelvis", "root", (0.0, 0.0, zc - 0.05 - drop), (0.0, 0.0, joints["belt"] - drop)),
        ("spine", "pelvis", (0.0, 0.0, joints["belt"] - drop),
         (0.0, 0.0, max(joints["arm"][s]["shoulder"][2] for s in (0, 1)) - drop - 0.02)),
        ("neck", "spine", (joints["head_xy"][0], joints["head_xy"][1], joints["neck"] - drop),
         (joints["head_xy"][0], joints["head_xy"][1], joints["chin"] - drop)),
        ("head", "neck", (joints["head_xy"][0], joints["head_xy"][1], joints["chin"] - drop),
         (joints["head_xy"][0], joints["head_xy"][1], H - drop)),
    ]
    for side, name in ((0, "L"), (1, "R")):
        a = joints["arm"][side]
        sh = (a["shoulder"][0], a["shoulder"][1], a["shoulder"][2] - drop)
        el = (a["elbow"][0], a["elbow"][1], a["elbow"][2] - drop)
        wr = (a["wrist"][0], a["wrist"][1], a["wrist"][2] - drop)
        bones.append((f"upperarm_{name}", "spine", sh, el))
        bones.append((f"forearm_{name}", f"upperarm_{name}", el, wr))
    bones.append(("thigh_r", "pelvis", tuple(hip0k), tuple(knee0)))
    bones.append(("shin_r", "thigh_r", tuple(knee0), tuple(ankle0)))
    bones.append(("thigh_f", "pelvis", tuple(hip1k), tuple(knee1)))
    bones.append(("shin_f", "thigh_f", tuple(knee1), tuple(ankle1)))
    eye_z = FACE_LO_F * H + 0.03 - drop
    joints["drop"] = drop   # `_seat_launcher` seats a kneeling gunner's tube from it
    return bones, eye_z


def _death_parts(src, height, prefix, x, y):
    """The whole standing source laid face-down, decimated, as ONE assembly
    named for `{prefix}_death_root`."""
    ob = _piece(src, f"{prefix}_death_body", "uniform", set(range(len(src.data.polygons))))
    # +90 about Y: height -> +x (head forward), forward -> -z (face down).
    _transform(ob, Matrix.Rotation(math.radians(90.0), 4, "Y"))
    co = _coords(ob)
    shift = Vector((x - height / 2.0, y, -co[:, 2].min()))
    _transform(ob, Matrix.Translation(shift))
    mod = ob.modifiers.new("dec", type="DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = DEATH_DECIMATE
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return [ob]


def _bend_forearms(parts, joints, prefix):
    """Rest geometry for a hand-bound weapon carrier: each forearm rotated
    rigidly about its own elbow, forward from the hang and a little inward,
    so the hands meet a rifle held across the front (`FORE_BEND`). The elbow
    blob is the pivot and stays; the wrist in `joints` moves with the part so
    `standing_bones` draws the forearm bone along the bent forearm."""
    for side, name in ((0, "L"), (1, "R")):
        if f"forearm{side}" not in parts:
            continue   # ARMS_ON_TORSO: that arm is on the torso, nothing to bend
        a = joints["arm"][side]
        elbow = Vector(a["elbow"])
        pitch, yaw = FORE_BEND[name]
        inward = 1.0 if side == 0 else -1.0   # +Z yaw takes +x toward +y: inward for the left arm
        mat = _rot_about(elbow, "Z", inward * yaw) @ _rot_about(elbow, "Y", -pitch)
        _transform(parts[f"forearm{side}"], mat)
        a["wrist"] = tuple(mat @ Vector(a["wrist"]))
        log(f"{prefix}: forearm{side} bent {pitch:.0f} forward, {yaw:.0f} inward; wrist z {a['wrist'][2]:.3f}")


def _rifle_at_hand(prefix, joints, dx, dy):
    """`rig._weapon_parts`' seven-part rifle with its grip on the right
    hand: the anchor is solved from the bent right wrist rather than taken
    from kit's chest-height formula, and the rifle is yawed across the front
    (`_rifle_frame`). A team in `HAND_PARTS` gets its Meshy rifle instead."""
    at, yaw = _rifle_frame(prefix, joints, dx, dy)
    return rig._weapon_parts(prefix, at, yaw=yaw, posture="standing", aim=False)


def _entrenching_tool(prefix, parts, heap_at):
    """digger_crew's tool (see TOOL_LENGTH): the handle runs from the kneeling
    man's hands toward the heap, the blade sits at its far end. The hands are
    read off GEOMETRY -- the forward-most vertices of the kneeling
    `{prefix}_torso` part, which on an ARMS_FORWARD figure carries the arms
    -- so the tool sits where the man is actually reaching, and it binds to
    the same `spine` bone the torso does (see the ARMS_FORWARD note)."""
    torso = next(o for o in parts if o.name == f"{prefix}_torso")
    tc = _coords(torso)
    hand = Vector(tc[tc[:, 0] > tc[:, 0].max() - 0.08].mean(axis=0))
    d = Vector(heap_at) + Vector((0.0, 0.0, 0.12)) - hand   # the heap's top, not its centre
    length = max(TOOL_LENGTH[0], min(TOOL_LENGTH[1], d.length))
    d.z = min(d.z, -0.05)            # always down into the ground, never up
    d.normalize()
    yaw = math.atan2(d.y, d.x)
    pitch = math.asin(max(-1.0, min(1.0, d.z)))
    mid = hand + d * (length * 0.45)
    handle = kit.tube(f"{prefix}_tool_handle", length, TOOL_RADIUS, tuple(mid),
                      yaw=yaw, pitch=pitch, role="wood")
    tip = hand + d * (length * 0.95)
    blade = kit.rot_z(f"{prefix}_tool_blade", TOOL_BLADE, tuple(tip), yaw, "metal")
    log(f"{prefix}: tool {length:.2f} m from hands {tuple(round(v, 3) for v in hand)} toward heap, "
        f"yaw {math.degrees(yaw):.0f} pitch {math.degrees(pitch):.0f}")
    return [handle, blade]


def _kit_keffiyeh_over(parts, pfx, src):
    """kit's keffiyeh drape over the `{pfx}_cranium` part in `parts` (a dict
    or list), coloured from the same figure's shirt bake -- the bible's fix
    for a preview that ignored the head wrap. Returns the kef parts."""
    seq = parts.values() if isinstance(parts, dict) else parts
    cranium = next((o for o in seq if o.name == f"{pfx}_cranium"), None)
    if cranium is None:
        return []
    co = _coords(cranium)
    centre = ((co[:, 0].min() + co[:, 0].max()) / 2.0, (co[:, 1].min() + co[:, 1].max()) / 2.0,
              co[:, 2].min() + 0.55 * (co[:, 2].max() - co[:, 2].min()))
    radius = max(co[:, 0].max() - co[:, 0].min(), co[:, 1].max() - co[:, 1].min()) / 2.0 * 1.04
    kef = kit.keffiyeh(f"{pfx}_kef", centre, radius=radius)
    # The borrowed texel comes from the SOURCE figure's upper back (the shirt
    # between the shoulder blades), named in the source's own standing frame.
    # B3 took it from the part's torso bounds, which on a KNEELING figure sit
    # 0.45 m lower than the standing source they are matched against -- the
    # nearest source face was then the belt and holster, and B4's mortar
    # crew wore a black keffiyeh while their own walkers wore tan.
    sc = _coords(src)
    Hs = float(sc[:, 2].max())
    band = sc[(sc[:, 2] > 0.74 * Hs) & (sc[:, 2] < 0.80 * Hs)]
    near = (float(band[:, 0].min()) + 0.02, 0.0, 0.77 * Hs)
    for ob_k in kef:
        _borrow_uv(ob_k, src, near=near)
    return kef


def _death_parts_posed(src, height, prefix, x, y, add_kef=False):
    """The corpse as a POSED fall (B3): the same cut as the living figure,
    re-arranged rigidly in code -- left arm overhead, right arm out, right
    thigh abducted and its shin splayed, head turned -- then laid face
    down, rolled off flat, and decimated. `kit.blob` covers the joints that
    turned. All of it on `{prefix}_death_root`, one part to one bone."""
    dp = f"{prefix}_death"
    parts, joints = cut_figure(src, height, dp, blobs=False)
    k = height / kit.FIGURE_H
    # Arms: the whole hung arm (upper + fore) about its shoulder.
    for side, target in ((0, CORPSE_OVERHEAD), (1, CORPSE_OUT)):
        if f"upperarm{side}" not in parts:
            continue   # ARMS_FORWARD: the arms are on the torso, nothing to throw
        a = joints["arm"][side]
        shoulder, wrist = Vector(a["shoulder"]), Vector(a["wrist"])
        axis = (wrist - shoulder).normalized()
        q = axis.rotation_difference(target.normalized())
        mat = Matrix.Translation(shoulder) @ q.to_matrix().to_4x4() @ Matrix.Translation(-shoulder)
        _transform(parts[f"upperarm{side}"], mat)
        _transform(parts[f"forearm{side}"], mat)
        parts[f"deltoid{side}"] = _blob(f"{dp}_deltoid{side}", tuple(shoulder), BLOB_R["deltoid"] * k, src=src,
                                        squash=(1.0, 1.0, 0.9))
    # Right leg: thigh out about the hip (X), shin further out about the knee.
    lx, ly = joints["leg"][1]
    hip, knee = Vector((lx, ly, joints["crotch"])), Vector((lx, ly, joints["knee"]))
    m_thigh = _rot_about(hip, "X", CORPSE_THIGH_DEG)
    m_shin = _rot_about(m_thigh @ knee, "X", CORPSE_SHIN_DEG) @ m_thigh
    _transform(parts["thigh1"], m_thigh)
    _transform(parts["calf1"], m_shin)
    _transform(parts["boot1"], m_shin)
    parts["hip1"] = _blob(f"{dp}_hip1", tuple(hip), BLOB_R["hip"] * k, src=src, squash=(1.05, 1.05, 1.05))
    parts["knee1"] = _blob(f"{dp}_knee1", tuple(m_thigh @ knee), BLOB_R["knee"] * k, src=src)
    # Head turned about the neck's own axis; kit's keffiyeh (if the preview
    # ignored the wrap) goes on BEFORE the turn and the lay-down, so it
    # drapes over a standing head and then falls with it.
    if add_kef:
        for i, ob_k in enumerate(_kit_keffiyeh_over(parts, dp, src)):
            parts[f"kef{i}"] = ob_k
    hc = _coords(parts["cranium"])
    m_head = _rot_about((hc[:, 0].mean(), hc[:, 1].mean(), 0.0), "Z", CORPSE_HEAD_DEG)
    for n in ("cranium", "face", "kef0", "kef1", "kef2"):
        if n in parts:
            _transform(parts[n], m_head)
    # Lay it down: height -> +x (head forward), forward -> -z (face down);
    # roll about the body's long axis; lowest point on the ground, centred.
    roll = CORPSE_ROLL_BY_TEAM.get(_TEAM["id"], CORPSE_ROLL_DEG)
    yaw = CORPSE_YAW_BY_TEAM.get(_TEAM["id"], 0.0)
    lay = (Matrix.Rotation(math.radians(yaw), 4, "Z") @ Matrix.Rotation(math.radians(roll), 4, "X")
           @ Matrix.Rotation(math.radians(90.0), 4, "Y"))
    for ob in parts.values():
        _transform(ob, lay)
    allco = np.concatenate([_coords(ob) for ob in parts.values()])
    shift = Matrix.Translation((x - (allco[:, 0].min() + allco[:, 0].max()) / 2.0, y, -allco[:, 2].min()))
    for ob in parts.values():
        _transform(ob, shift)
    # ONE object, decimated once: collapsing each cut piece on its own
    # shredded every seam (measured -- a first pass read as a heap of
    # shards). Role `uniform` for the whole body, as B2's corpse was; on a
    # textured team the bake colours the boots and face regardless.
    body = _join(list(parts.values()), f"{dp}_body", "uniform")
    # Re-weld the seams the pose did not open (each cut piece carries its
    # own copy of the boundary vertices), so the collapse works on a mostly
    # closed shell rather than a soup of open rims.
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bm.to_mesh(body.data)
    bm.free()
    mod = body.modifiers.new("dec", type="DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = CORPSE_DECIMATE_BY_TEAM.get(_TEAM.get("id"), CORPSE_DECIMATE)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.modifier_apply(modifier=mod.name)
    log(f"{prefix}: posed corpse, {len(body.data.polygons)} polys, "
        f"x {allco[:, 0].min() + shift.translation.x:+.2f}..{allco[:, 0].max() + shift.translation.x:+.2f}")
    return [body]


# ---------------------------------------------------------------------------
# sniper_team: the prone LIVING pose (B7)
# ---------------------------------------------------------------------------
#
# `rig._sniper_rest`'s contract: the prone build on `{prefix}_death_root` is
# the living pose (`idle`, `fire`, tightened for `down`/`wreck`) and the
# standing build on `root` is `move` alone; `rig.build_sniper_clips` flips
# which is visible. The prone body here is the KNEEL's method laid flat: the
# same standing cut re-arranged rigidly in code before the lay-down -- both
# arms swung forward and the forearms turned in to meet the rifle, the head
# lifted on the neck to look down the barrel, the legs splayed unevenly --
# then laid on its chest with its head at kit's own +0.78 m from the anchor,
# so `kit.sniper_rifle`/`kit.binoculars`'s prone offsets (written for the
# kit figure) land on this body's hands and face unchanged.
PRONE_ARM_DIR = (0.30, 0.10, 0.95)      # standing frame: mostly "up", a little forward and out
PRONE_FORE_IN_DEG = 28.0                # forearm turned in toward the centre line, about the elbow
PRONE_HEAD_LIFT_DEG = 38.0              # face raised off the ground, about the neck
PRONE_LEG_SPREAD_DEG = (-5.0, 11.0)     # per side, about the hip -- never parallel (kit's own rule)
PRONE_HEAD_X = 0.78                     # kit.figure's prone head centre, ahead of the anchor
CARRY_SNIPER_RIFLE_Z = 0.72             # standing carry height as a fraction of POSTURE_EYE["standing"] (kit's own)


def _prone_parts(src, height, prefix, x, y):
    """The sniper's living prone body: every cut part of the standing figure,
    re-arranged and laid down, each part keeping its own role, all of them
    on `{prefix}_death_root`. Returns (parts, head_centre)."""
    dp = f"{prefix}_death"
    parts, joints = cut_figure(src, height, dp, blobs=False)
    k = height / kit.FIGURE_H
    for side in (0, 1):
        if f"upperarm{side}" not in parts:
            continue
        a = joints["arm"][side]
        sgn = -1.0 if side == 0 else 1.0
        shoulder, elbow, wrist = Vector(a["shoulder"]), Vector(a["elbow"]), Vector(a["wrist"])
        target = Vector((PRONE_ARM_DIR[0], sgn * PRONE_ARM_DIR[1], PRONE_ARM_DIR[2])).normalized()
        q = (wrist - shoulder).normalized().rotation_difference(target)
        m_arm = Matrix.Translation(shoulder) @ q.to_matrix().to_4x4() @ Matrix.Translation(-shoulder)
        _transform(parts[f"upperarm{side}"], m_arm)
        _transform(parts[f"forearm{side}"], m_arm)
        elbow_m = m_arm @ elbow
        # Forearm turned in about the moved elbow -- a rotation about the
        # standing X axis, which is the prone body's vertical.
        m_fore = _rot_about(elbow_m, "X", sgn * PRONE_FORE_IN_DEG)
        _transform(parts[f"forearm{side}"], m_fore)
        parts[f"deltoid{side}"] = _blob(f"{dp}_deltoid{side}", tuple(shoulder), BLOB_R["deltoid"] * k, src=src,
                                        squash=(1.0, 1.0, 0.9))
        parts[f"elbow{side}"] = _blob(f"{dp}_elbow{side}", tuple(elbow_m), BLOB_R["elbow"] * k, src=src)
    for side in (0, 1):
        lx, ly = joints["leg"][side]
        hip = Vector((lx, ly, joints["crotch"]))
        m_leg = _rot_about(hip, "X", PRONE_LEG_SPREAD_DEG[side])
        for n in (f"thigh{side}", f"calf{side}", f"boot{side}"):
            _transform(parts[n], m_leg)
        parts[f"hip{side}"] = _blob(f"{dp}_hip{side}", tuple(hip), BLOB_R["hip"] * k, src=src, squash=(1.05, 1.05, 1.05))
    hx, hy = joints["head_xy"]
    m_head = _rot_about((hx, hy, joints["neck"]), "Y", -PRONE_HEAD_LIFT_DEG)
    for n in ("cranium", "face", "neck"):
        if n in parts:
            _transform(parts[n], m_head)
    if "carbine" in parts:
        # A baked carbine held out ahead of the chest (WEAPON_ON_SPINE) ends
        # up UNDER the chest once the body lies on it, with the arms that
        # hold it; it is dropped from the prone copy and kit's long sniper
        # rifle lies along the body instead (the `sniper_team` rule), where
        # the first cut -- the carbine turned up about its rear end -- ran it
        # through the lying man's own head.
        bpy.data.objects.remove(parts.pop("carbine"), do_unlink=True)
    # Lay it down: height -> +x (head forward), forward -> -z (face down).
    lay = Matrix.Rotation(math.radians(90.0), 4, "Y")
    for ob in parts.values():
        _transform(ob, lay)
    allco = np.concatenate([_coords(ob) for ob in parts.values()])
    hc = _coords(parts["cranium"])
    head_x = (hc[:, 0].min() + hc[:, 0].max()) / 2.0
    shift = Matrix.Translation((x + PRONE_HEAD_X - head_x, y - (allco[:, 1].min() + allco[:, 1].max()) / 2.0,
                                -allco[:, 2].min()))
    for ob in parts.values():
        _transform(ob, shift)
    hc = _coords(parts["cranium"])
    head_c = (float(hc[:, 0].mean()), float(hc[:, 1].mean()), float(hc[:, 2].mean()))
    allco = np.concatenate([_coords(ob) for ob in parts.values()])
    log(f"{prefix}: prone body x {allco[:, 0].min():+.2f}..{allco[:, 0].max():+.2f} "
        f"z max {allco[:, 2].max():.3f}, head at {tuple(round(v, 3) for v in head_c)}")
    return list(parts.values()), head_c


def _sniper_figure(src, height, spec):
    """One sniper: the standing walker on `root` (move) and the prone living
    body on `death_root` (every other clip) -- `rig._sniper_rest`'s two
    rigs with Meshy geometry. Returns (parts, bones, forced, eye_z, joints,
    prone_head)."""
    prefix, x, y = spec["prefix"], spec["x"], spec["y"]
    parts, joints = cut_figure(src, height, prefix)
    bones = standing_bones(prefix, joints, x, y)
    _place(parts, x, y)
    eye_z = FACE_LO_F * height + 0.03
    forced = {}
    if "carbine" in parts:
        forced[parts["carbine"]] = f"{prefix}_spine"   # WEAPON_ON_SPINE, as `_figure`
    out = list(parts.values())
    prone, head_c = _prone_parts(src, height, prefix, x, y)
    death_bone = rig._death_root_bone(prefix, x, y)
    bones.append(death_bone)
    for ob in prone:
        forced[ob] = death_bone[0]
    out += prone
    return out, bones, forced, eye_z, joints, head_c


# ---------------------------------------------------------------------------
# the shouldered launchers (rpg_team, manpad_team, recoilless_team)
# ---------------------------------------------------------------------------
#
# B2/B3 built each of these with `kit.launcher` at teams.py's own anchor --
# the KIT figure's centre line -- so on these Meshy figures the RPG ran
# through rpg_fire's chest (945 tube samples inside head/neck/torso on
# `fire`), the MANPAD through mpd_fire's head (406-653 in the head's own box)
# and the recoilless rifle through rcl_fire's chest (671). PR #325 found and
# fixed the same defect on at_team's Spike (`import_meshy_kdf_team.py`'s
# `_shoulder_launcher`); this is the same fix, generalised to a PITCHED tube:
#
#   * the tube rests ON the +y shoulder -- the side whose `forearm_R` it is
#     bound to -- BESIDE the head. The search starts with its supporting
#     point (`rest`, a fraction of the tube from the rear) on that shoulder's
#     joint, laterally at the widest point of the head, face, neck or
#     keffiyeh plus the bore's radius plus `SEAT_GAP`, and takes the FIRST
#     seat that clears, trying in this order: pushed off the shoulder along
#     the bore's own normal (straight up for a level tube, mostly backward for
#     the MANPAD's 78 deg) in `SEAT_STEP`s, then the tube slid forward along
#     its bore a `SEAT_SLIDE_STEP` of its length at a time, then stepped
#     outboard -- so it sits as close to the head and as low on the shoulder
#     as the body allows, and leaves the shoulder only if nothing nearer fits;
#   * "clears" is measured: every surface sample of the bore solids and the
#     sight is outside the body (generalised winding number) and at least
#     `SEAT_GAP` from the gunner's own body, `mate_gap` from the other man's
#     (both breathe and sway in `idle`; a walking gunner's mate walks beside
#     him with swinging arms), and no body vertex is inside a bore. The body
#     is every living part of both men except the gunner's two arms, which
#     are re-seated below; the grips and the handle are verified after;
#   * the pitch and the tube's length and radius stay each weapon's own
#     silhouette lever (teams.py: the RPG at 38 deg, the MANPAD near-vertical
#     at 78, the recoilless level, short and fat); what each one carries is
#     declared in `LAUNCHERS` below so it reads as itself;
#   * both arms are re-seated RIGIDLY as rest geometry by `_two_bone`
#     (PR #325's own two-bone IK, imported, not copied): the firing hand on
#     the pistol grip, the support hand on the support handle (its length
#     solved so that hand can reach it, never into the body) or on a named
#     point of the weapon. No pose is keyed and nothing is weight-painted;
#     the arm bones are rewritten from the moved joints, so every clip (idle,
#     move, fire, down/wreck) drives the seated geometry. A walking gunner's
#     arms are not swung in `move` (`rig.build_move_clip`).
#
# Tube frame: `u` along the bore (+ toward the muzzle), `v` = +y (outboard,
# so a NEGATIVE v is toward the face), `w` = the bore's own "up" -- for a
# level tube +z, for the MANPAD's 78 deg mostly backward. Every number in
# `LAUNCHERS` is in that frame, from the supporting point.
SEAT_GAP = 0.02                # air between any launcher sample and the body
SEAT_STEP = 0.005              # search step, both directions
SEAT_LIFT_MAX = 0.20           # how far off the shoulder joint, along the bore's normal, the search looks
SEAT_OUT_MAX = 0.12            # how far outboard of the head rule it may step -- 0.10 until B7
                               # (2026-10-01): the MANPAD's re-remesh (the refined B2 preview at the
                               # same 1,500) found no seat at 0.10, and the nearest candidate (out
                               # 0.100, up 0, slide 0.10) failed by 3 samples within 2 cm of the
                               # gunner and 1 vertex in the bore -- the tube over his deltoid, a
                               # shouldered carry. Measured before widening, as the message asks.
SEAT_SLIDE_STEP = 0.01         # of the tube's length, per step of sliding it forward
SEAT_SLIDE_MAX = 0.20          # the furthest it may slide forward on the shoulder
SIGHT_STANDOFF = 0.04          # eyepiece face ahead of the face's front (PR #325)
LAUNCH_REACH_USE = 0.97        # of an arm's shoulder->wrist length (PR #325's REACH_USE)
HANDLE_GAP = 0.04              # the support handle's clearance: twice SEAT_GAP, for the fire recoil
LAUNCH_FIRE_POLE = (0.0, 0.5, -1.0)      # firing elbow: down and outboard (PR #325)
LAUNCH_SUPPORT_POLE = (0.4, -0.6, -1.0)  # support elbow: down, outboard, forward (PR #325)
#: A3.1: a Meshy launcher's shoulder point, behind its own pistol grip (m)
#: -- a real RPG-7 rests on the heat shield just behind the grip. A
#: trade measured on the RPG-7 (declared value: support wrist short of the
#: longest handle / `launcher_arms.test.ts`'s idle count, ceiling 223):
#: 0.05: 0 cm / 223; 0.08: 0 / 216; 0.10: 0 / 222; 0.12: 0 / 205;
#: 0.15: 0 / 230; 0.20: 17.3 cm / 186; 0.25: 17.5 cm / 137. 0.12 is the one
#: where the hand reaches with the most room under the ceiling.
PART_REST_BEHIND_GRIP = 0.12
#: A3.1: a Meshy launcher's support HANDLE. These figures' arms (0.45-0.5 m
#: shoulder ring to fingertips) cannot reach a part's own forward grip across
#: the chest -- measured on the RPG-7: the left wrist 29 cm short of it with
#: 200 arm vertices in his chest, and 5 cm short at best, 303 inside, even
#: with the hand slid back along the tube's underside behind the pistol grip.
#: So the forward grip is EXTENDED: PR #325's solved handle, hung from the
#: bottom of the part's own forward grip (never slid along the bore), down
#: and inboard, as long as the support arm needs, textured from the grip's
#: own texel. (direction (u, v, w), section, min length, max length).
PART_HANDLE = ((0.0, -0.6, -0.8), (0.035, 0.03), 0.04, 0.30)
PART_HAND_RISE = 0.10          # m the support hand may sit above its own shoulder joint
PART_HANDLE_SLIDE = 0.04        # m per step back along the tube from the forward grip
PART_SUPPORT_MIN_AHEAD = 0.08   # m: the support hand stays this far ahead of the pistol grip
#: Parts never counted as body for the seat: the two arms are moved after it.
SEAT_ARM_PARTS = ("upperarm0", "upperarm1", "elbow0", "elbow1", "forearm0", "forearm1")

#: Per team. `rest` is where along the tube (fraction from the rear) the
#: shoulder carries it. `bores` are (name, u0, u1, r0, r1, role) solids of
#: revolution on the bore -- r0 == r1 a cylinder, else a cone. `boxes` are
#: (name, size (u, v, w), centre (u, v, w), role); a centre given as the
#: string "sight" is placed by `_sight_centre` (the eyepiece SIGHT_STANDOFF
#: ahead of the face, at eye height where the tube allows). `grip` names the
#: box the firing hand closes on; `handle` is (attach (u, v, w), direction
#: (u, v, w), section, min length, max length) -- the support hand's -- or
#: None, and then `support` (u, v, w) is the point that hand closes on.
#: `mate_gap` is the seat's clearance to the OTHER man, per team, measured.
LAUNCHERS = {
    # The RPG-7: a 0.96 m tube (r 0.075, rig._rpg_extras' own radius) at
    # teams.py's 38 deg, the rear venturi flare, and the PG-7's warhead on
    # the muzzle -- a narrow stem, the fat body, the nose cone -- which is
    # what makes it read as an RPG and not a pipe. Overall 1.27 m against
    # the kit tube's 1.24. Optic on the inboard side, the pistol grip and
    # the forward grip under the bore. `mate_gap` 0.02 (SEAT_GAP): measured
    # clear of the loader in every clip at that; 0.06 stepped the tube 3.5 cm
    # further outboard for nothing.
    "rpg_team": dict(
        part="rpg_launcher",   # A3.1: the Meshy RPG-7 replaces every bore and box below when loaded
        prefix="rpg_fire", name="rpg_tube", pitch=38.0, rest=0.35, length=0.96, mate_gap=0.02,
        bores=(("rpg_tube", 0.0, 0.96, 0.075, 0.075, "weapon"),
               ("rpg_tube_bell", -0.04, 0.12, 0.11, 0.11, "weapon"),
               ("rpg_tube_stem", 0.96, 1.02, 0.04, 0.04, "weapon"),
               ("rpg_tube_head", 1.02, 1.13, 0.105, 0.105, "weapon"),
               ("rpg_tube_nose", 1.13, 1.27, 0.105, 0.02, "weapon")),
        boxes=(("rpg_tube_sight", (0.09, 0.05, 0.07), "sight", "metal"),
               ("rpg_tube_grip", (0.045, 0.035, 0.11), (0.22, 0.0, -0.075 - 0.045), "weapon")),
        grip="rpg_tube_grip",
        handle=((0.20, -0.05, -0.05), (0.0, -0.6, -0.8), (0.04, 0.035), 0.08, 0.30)),
    # The MANPAD (Strela/Igla class): teams.py's near-vertical 78 deg and
    # 0.065 radius, but LONG -- 1.30 m against the kit's 0.94, still short
    # of a real 1.44-1.57 m tube -- with a seeker cap on the front, a small
    # rear flare, and the gripstock: a stock standing off the bore below the
    # shoulder, the pistol grip under its far end, the support hand on the
    # stock itself. A handle for it was tried in five directions and cut his
    # chest in every one: the tube sits beside the shoulder, so anything
    # reaching across to the left hand crosses the torso. `mate_gap` 0.08:
    # at 0.02 his spotter's walker, swinging its arms in `move`, put 157
    # tube samples inside itself (22 at 0.06).
    "manpad_team": dict(
        part="manpad_tube",   # A3.1: the Meshy MANPAD replaces every bore and box below when loaded
        # A3.1: the Meshy tube is fatter than the procedural one (bore r 0.089
        # against 0.065, its own proportions at 1.4 m, fins and gripstock
        # wider still): no seat within 0.12 m outboard and 0.2 of its length
        # forward (nearest: 30 samples within SEAT_GAP of the gunner, 49
        # within mate_gap of the spotter).
        seat_out_max=0.12,
        # ...and stepping OUTBOARD walks it toward the spotter (out 0.20 still
        # failed: 15 samples within SEAT_GAP of the gunner, 28 within mate_gap
        # of the spotter), so instead it may slide further up its own bore,
        # lifting the fins off both men.
        seat_slide_max=0.45,
        prefix="mpd_fire", name="mpd_tube", pitch=78.0, rest=0.30, length=1.30, mate_gap=0.08,
        bores=(("mpd_tube", 0.0, 1.30, 0.065, 0.065, "weapon"),
               ("mpd_tube_bell", -0.03, 0.08, 0.085, 0.085, "weapon"),
               ("mpd_tube_cap", 1.24, 1.33, 0.075, 0.075, "metal")),
        boxes=(("mpd_tube_stock", (0.05, 0.04, 0.26), (-0.15, 0.0, -0.065 - 0.13), "metal"),
               ("mpd_tube_grip", (0.11, 0.035, 0.04), (-0.185, 0.0, -0.065 - 0.24), "weapon")),
        grip="mpd_tube_grip", grip_group=("mpd_tube_stock", "mpd_tube_grip"),
        handle=None, support=(-0.15, -0.03, -0.065 - 0.156)),
    # The recoilless rifle (Carl Gustaf class), SHOULDERED from the kneel --
    # teams.py's own words ("shouldered from a crouch, not tripod-mounted"),
    # where the kit's z 0.72 ran it through this figure's chest. Short and
    # fat as teams.py has it (0.86 m, r 0.115); the venturi flare at 1.35 r
    # rather than the kit's 1.7 r, a 0.39 m disc behind the gunner's head.
    # Optic on the inboard side in front of the eye, pistol grip, forward
    # grip. `mate_gap` 0.06: at 0.02 the kneeling loader, swaying in `idle`
    # beside him, took 23-32 samples of the flare.
    "recoilless_team": dict(
        part="recoilless_rifle",   # A3.1: the Meshy recoilless replaces every bore and box below when loaded
        prefix="rcl_fire", name="rcl_tube", pitch=0.0, rest=0.45, length=0.86, mate_gap=0.06,
        bores=(("rcl_tube", 0.0, 0.86, 0.115, 0.115, "weapon"),
               ("rcl_tube_bell", -0.04, 0.12, 0.155, 0.155, "weapon")),
        boxes=(("rcl_tube_sight", (0.10, 0.05, 0.08), "sight", "metal"),
               ("rcl_tube_grip", (0.045, 0.035, 0.10), (0.12, 0.0, -0.115 - 0.04), "weapon")),
        grip="rcl_tube_grip",
        handle=((0.26, -0.05, -0.10), (0.0, -0.6, -0.8), (0.04, 0.035), 0.08, 0.30)),
}


def _tube_frame(pitch_deg):
    p = math.radians(pitch_deg)
    d = Vector((math.cos(p), 0.0, math.sin(p)))
    v = Vector((0.0, 1.0, 0.0))
    w = Vector((-math.sin(p), 0.0, math.cos(p)))
    return d, v, w


def _winding(P, T):
    """Generalised winding number of points P (n,3) w.r.t. triangles T (m,3,3):
    > 0.5 is inside. Robust on the cut pieces' open seams (the census in
    PR #325 used the same measure)."""
    out = np.zeros(len(P))
    for s in range(0, len(P), 128):
        p = P[s:s + 128][:, None, :]
        a, b, c = (T[None, :, k, :] - p for k in range(3))
        la, lb, lc = (np.linalg.norm(x, axis=-1) for x in (a, b, c))
        det = np.einsum("...i,...i", a, np.cross(b, c))
        den = (la * lb * lc + np.einsum("...i,...i", a, b) * lc + np.einsum("...i,...i", b, c) * la
               + np.einsum("...i,...i", c, a) * lb)
        out[s:s + 128] = (2.0 * np.arctan2(det, den)).sum(axis=1) / (4.0 * np.pi)
    return out


def _tris(ob):
    me = ob.data
    me.calc_loop_triangles()
    idx = np.empty(len(me.loop_triangles) * 3, dtype=np.int64)
    me.loop_triangles.foreach_get("vertices", idx)
    return _coords(ob)[idx.reshape(-1, 3)]


def _seat_samples(cfg, P, sight_c):
    """Surface samples of the bore solids and the sight at pivot `P`: rings
    of 12 every 1 cm (end caps included), and the sight's twelve edges at
    1 cm -- the same density PR #325's census tests the exported GLB at."""
    d, v, w = _tube_frame(cfg["pitch"])
    u_rear = -cfg["rest"] * cfg["length"]
    if cfg.get("samples") is not None:
        # A Meshy part (A3.1): its own surface, in its canonical frame (x
        # from the rear along the bore, y outboard, z the bore's up).
        S = cfg["samples"]
        return (np.array(P)[None, :] + np.outer(u_rear + S[:, 0], d) + np.outer(S[:, 1], v)
                + np.outer(S[:, 2], w))
    pts = []
    for _n, u0, u1, r0, r1, _role in cfg["bores"]:
        n = max(2, int((u1 - u0) / 0.01) + 1)
        for t in np.linspace(0.0, 1.0, n):
            c = P + d * (u_rear + u0 + (u1 - u0) * t)
            r = r0 + (r1 - r0) * t
            rings = (r, r * 0.5) if t in (0.0, 1.0) else (r,)
            for rr in rings:
                for k in range(12):
                    a = 2.0 * math.pi * k / 12
                    pts.append(tuple(c + v * (rr * math.cos(a)) + w * (rr * math.sin(a))))
    if sight_c is not None:
        for name, size, c, _role in cfg["boxes"]:
            if c != "sight":
                continue
            corners = [Vector((su, sv, sw)) for su in (-size[0] / 2, size[0] / 2)
                       for sv in (-size[1] / 2, size[1] / 2) for sw in (-size[2] / 2, size[2] / 2)]
            for i, a in enumerate(corners):
                for b in corners[i + 1:]:
                    if sum(abs(a[k] - b[k]) > 1e-9 for k in range(3)) != 1:
                        continue   # the twelve edges only
                    for t in np.linspace(0.0, 1.0, max(2, int((a - b).length / 0.01) + 1)):
                        q = sight_c + a + (b - a) * t
                        pts.append(tuple(P + d * q.x + v * q.y + w * q.z))
    return np.array(pts)


def _seat_violations(cfg, P, sight_c, bvh, T, body_v, bvh_mate=None):
    """How a candidate seat fails: (samples within SEAT_GAP of the gunner,
    samples within `mate_gap` of the other man, body vertices inside a bore
    solid, samples inside the body by winding number). All four zero is a
    clear seat. Counted in full rather than short-circuited so a FAILED
    search can say which rule refused the nearest candidate (B7: the
    MANPAD's re-remesh found no seat and the message named three limits
    without saying which one bit)."""
    pts = _seat_samples(cfg, P, sight_c)
    body_hits = mate_hits = 0
    for p in pts:
        q = Vector(p)
        hit = bvh.find_nearest(q)
        if hit[0] is not None and hit[3] < SEAT_GAP:
            body_hits += 1
        if bvh_mate is not None:
            hit = bvh_mate.find_nearest(q)
            if hit[0] is not None and hit[3] < cfg["mate_gap"]:
                mate_hits += 1
    d = np.array(_tube_frame(cfg["pitch"])[0])
    rel = body_v - np.array(P)
    along = rel @ d
    radial = np.linalg.norm(rel - np.outer(along, d), axis=1)
    u_rear = -cfg["rest"] * cfg["length"]
    swallowed = 0
    for _n, u0, u1, r0, r1, _role in cfg["bores"]:
        t = (along - (u_rear + u0)) / (u1 - u0)
        m = (t >= 0.0) & (t <= 1.0)
        swallowed += int((radial[m] < (r0 + (r1 - r0) * t[m]) + SEAT_GAP).sum())
    inside = int((_winding(pts, T) > 0.5).sum())
    return body_hits, mate_hits, swallowed, inside


def _seat_clear(cfg, P, sight_c, bvh, T, body_v, bvh_mate=None):
    """True when no launcher sample is inside the body or within SEAT_GAP of
    it (`mate_gap` of the other man), AND no body vertex is inside a bore
    solid (a fat tube could swallow an ear whole with every one of its own
    samples outside). Short-circuits on the first violation: the search
    asks this of ~18,000 candidates, and the full counts (`_seat_violations`)
    are for the report when none of them clears."""
    pts = _seat_samples(cfg, P, sight_c)
    for p in pts:
        q = Vector(p)
        hit = bvh.find_nearest(q)
        if hit[0] is not None and hit[3] < SEAT_GAP:
            return False
        if bvh_mate is not None:
            hit = bvh_mate.find_nearest(q)
            if hit[0] is not None and hit[3] < cfg["mate_gap"]:
                return False
    d = np.array(_tube_frame(cfg["pitch"])[0])
    rel = body_v - np.array(P)
    along = rel @ d
    radial = np.linalg.norm(rel - np.outer(along, d), axis=1)
    u_rear = -cfg["rest"] * cfg["length"]
    for _n, u0, u1, r0, r1, _role in cfg["bores"]:
        t = (along - (u_rear + u0)) / (u1 - u0)
        m = (t >= 0.0) & (t <= 1.0)
        if (radial[m] < (r0 + (r1 - r0) * t[m]) + SEAT_GAP).any():
            return False
    return not (_winding(pts, T) > 0.5).any()


def _sight_centre(cfg, P, face_front, eye_z):
    """The sight's centre in the tube frame: on the bore's inboard side, its
    rear (eyepiece) face SIGHT_STANDOFF ahead of the face along the bore, its
    w at eye height as far as the bore's own radius allows."""
    d, v, w = _tube_frame(cfg["pitch"])
    box = next(b for b in cfg["boxes"] if b[2] == "sight")
    su, sv, sw = box[1]
    r = cfg["bores"][0][3]
    eye = Vector((face_front, P.y, eye_z))
    u_eye = (eye - P).dot(d)
    w_eye = (eye - P).dot(w)
    w_c = max(-r + sw / 2.0, min(r - sw / 2.0 + 0.02, w_eye))
    return Vector((u_eye + SIGHT_STANDOFF + su / 2.0, -(r + sv / 2.0), w_c))


#: Follow-up to #327: re-seating both gunner arms with `_two_bone` sank
#: them into the chest (arm vertices inside his own head/neck/spine, read off
#: the exported GLB by `mesh_gait.measureArmInBody`: rpg 223 -> 391, manpad
#: 29 -> 274, recoilless 152 -> 225; gated by `launcher_arms.test.ts`). Four
#: levers are now MEASURED rather than declared, each the least move that
#: helps, and none may leave a hand further off its seat:
#:   * the elbow's SWIVEL about the shoulder->wrist line (`_arm_swivel`), in
#:     ARM_SWIVEL_STEP_DEG steps within ARM_SWIVEL_MAX_DEG of the declared
#:     pole, never with the elbow above its own shoulder (ELBOW_RISE_MAX);
#:   * the firing GRIP slid along the bore (GRIP_SLIDE), staying GRIP_ON_TUBE
#:     inside either end -- with the MANPAD's whole gripstock and its support
#:     point riding it (`grip_group`), scored on both arms together;
#:   * the SUPPORT seat: a handle's attach point slid along the bore
#:     (HANDLE_SLIDE) and inboard (HANDLE_INBOARD), its hang swung about the
#:     bore (HANDLE_SWING, kept well below the bore's side) and raked toward
#:     the muzzle (HANDLE_RAKE); with no handle, the point moved over its stock
#:     face (SUPPORT_SLIDE). The hand never rises above, or reaches further
#:     across him than, its declared seat (a hand lifted beside the face read
#:     worse than the overlap it removed), and every handle passes its own
#:     clearance;
#:   * the SHOULDER protracted forward and out (SHOULDER_PROTRACT), as a
#:     reaching shoulder rides its scapula -- at most 3 cm each way, inside
#:     the deltoid blob that hides the cut.
ARM_SWIVEL_STEP_DEG = 5.0
ARM_SWIVEL_SEARCH_STEP_DEG = 15.0   # coarser while a seat search calls it per candidate
ARM_SWIVEL_MAX_DEG = 90.0
ELBOW_RISE_MAX = 0.0           # m an elbow may sit above its own shoulder joint (the declared pole is exempt)
#: The joints whose parts are "his own upper body" for that count -- the same
#: three `measureArmInBody` reads off the GLB.
ARM_BODY_BONES = ("spine", "neck", "head")
#: The parts each arm bone carries (rig.PART_BONE), as `_seat_launcher` moves them.
ARM_UPPER_PARTS = ("upperarm{}", "elbow{}")
ARM_FORE_PARTS = ("forearm{}",)
HANDLE_SLIDE = tuple(round(0.05 * k, 3) for k in range(-2, 5))      # m along the bore, + muzzle
HANDLE_SWING = (-30.0, -15.0, 0.0, 10.0, 20.0, 30.0)                # deg about the bore, + inboard
HANDLE_RAKE = (0.0, 0.2, 0.4)                                       # + toward the muzzle
HANDLE_INBOARD = (0.0, -0.03, -0.06)                                # m, - toward his face
SUPPORT_SLIDE = {"u": (-0.02, 0.0, 0.02),                           # m, tube frame, on the stock face
                 "w": tuple(round(0.02 * k, 3) for k in range(-3, 6))}
SUPPORT_SHORT_SLACK = 0.005    # m a re-seated wrist may sit further off its seat than the declared one
GRIP_SLIDE = tuple(round(0.02 * k, 3) for k in range(-5, 11))      # m along the bore
GRIP_ON_TUBE = 0.03
SHOULDER_PROTRACT = (0.0, 0.01, 0.02, 0.03)   # m; the deltoid blob's radius is 0.078 H/1.8


def _arm_swivel(team_id, pfx, side, mine, upper_T, S, E, W, target, pole, quiet=False, shift=None):
    """(pole, count): the pole for `_two_bone` that keeps arm `side` out of
    `upper_T`, and how many of the arm's vertices are still inside it."""
    u = (target - S).normalized()
    p0 = Vector(pole)
    v0 = (p0 - u * p0.dot(u)).normalized()
    w0 = u.cross(v0)
    up = np.concatenate([_coords(mine[n.format(side)]) for n in ARM_UPPER_PARTS if n.format(side) in mine])
    fore = np.concatenate([_coords(mine[n.format(side)]) for n in ARM_FORE_PARTS if n.format(side) in mine])
    if shift is not None:   # a protracted shoulder: the whole arm, joints and parts, moved first
        up, fore = up + np.array(shift), fore + np.array(shift)
        S, E, W = S + shift, E + shift, W + shift

    def moved(m, co):
        M = np.array(m)
        return co @ M[:3, :3].T + M[:3, 3]

    lo, hi = upper_T.reshape(-1, 3).min(axis=0), upper_T.reshape(-1, 3).max(axis=0)

    def inside(co):
        box = np.all((co >= lo) & (co <= hi), axis=1)
        return int((_winding(co[box], upper_T) > 0.5).sum()) if box.any() else 0

    step = ARM_SWIVEL_SEARCH_STEP_DEG if quiet else ARM_SWIVEL_STEP_DEG
    n = int(round(ARM_SWIVEL_MAX_DEG / step))
    best = None
    scores = []
    for k in sorted(range(-n, n + 1), key=abs):
        th = math.radians(k * step)
        p = v0 * math.cos(th) + w0 * math.sin(th)
        m_up, m_fore, E2, _W2, _sh = _two_bone(S, E, W, target, p)
        if k and E2.z > S.z + ELBOW_RISE_MAX:
            continue   # never an elbow cocked above the shoulder to dodge the chest
        c = inside(moved(m_up, up)) + inside(moved(m_fore, fore))
        scores.append((k * step, c))
        if best is None or c < best[1]:
            best = (k * step, c, p, E2 - S)
    declared = dict(scores)[0.0]
    if quiet:
        return tuple(best[2]), best[1]
    log(f"{team_id}: {pfx} arm{side} elbow swivel {best[0]:+.0f} deg from the declared pole "
        f"(elbow at shoulder {tuple(round(x, 3) for x in best[3])}): "
        f"{declared} -> {best[1]} arm vertices inside his own upper body at rest "
        f"(sweep {' '.join(f'{a:+.0f}:{c}' for a, c in sorted(scores))})")
    return tuple(best[2]), best[1]


def _seat_launcher(team_id, spec, parts, bones, joints, drop):
    """Seat `LAUNCHERS[team_id]` on its gunner's +y shoulder beside his head
    and re-seat both his hands on it. `parts` is the team's PLACED part list,
    `bones` its translated bone table (the two arm pairs are rewritten in
    place); returns the launcher's part objects (not yet bound)."""
    from mathutils.bvhtree import BVHTree
    cfg = LAUNCHERS[team_id]
    part = cfg.get("part") if cfg.get("part") in _HAND else None
    if part:
        # A3.1: the Meshy part replaces every bore and box. One measured
        # cylinder stays as the "a body vertex inside the bore" proxy; the
        # seat tests the part's own surface samples; the shoulder carries it
        # PART_REST_BEHIND_GRIP behind its pistol grip, and the slide search
        # moves it forward from there exactly as it moves a procedural tube.
        info = _PART_INFO[part]
        L = info["length"]
        behind = PART_SPECS[part].get("rest_behind_grip", PART_REST_BEHIND_GRIP)
        cfg = dict(cfg, length=L, rest=(info["grip"][0] - behind) / L,
                   bores=((f"{cfg['name']}_bore", 0.0, L, info["r"], info["r"], "weapon"),),
                   boxes=(), handle=None, samples=info["samples"])
    pfx, fx, fy = spec["prefix"], spec["x"], spec["y"]
    mine = {o.name[len(pfx) + 1:]: o for o in parts
            if o.name.startswith(pfx + "_") and "_death" not in o.name}
    # The other man, deployed -- and on his D6 walker too, but only if the
    # gunner WALKS with the launcher (`animates`): a kneeling gunner's tube
    # is drawn only while he kneels, and every walker only in `move`
    # (`_key_death_visibility`). Never the gunner's own walker (`{pfx}w_*`),
    # which stands where he kneels and is never drawn beside his tube.
    def _other(o):
        if o.name.startswith(pfx + "_") or o.name.startswith(pfx + "w_") or "_death" in o.name:
            return False
        if o.get("rl_role") in ("weapon", "metal"):
            return False
        walker = any(o.name.startswith(s["prefix"] + "_") for s in rig._walker_specs(rig.TEAM_FIGURES[team_id]))
        return spec["animates"] or not walker
    others = [o for o in parts if _other(o)]
    body = [o for n, o in mine.items() if n not in SEAT_ARM_PARTS] + others
    T = np.concatenate([_tris(o) for o in body])
    body_v = np.concatenate([_coords(o) for o in body])

    def _bvh(tris):
        return BVHTree.FromPolygons([tuple(p) for p in tris.reshape(-1, 3)],
                                    [(3 * i, 3 * i + 1, 3 * i + 2) for i in range(len(tris))])
    bvh = _bvh(T)
    bvh_mate = _bvh(np.concatenate([_tris(o) for o in others])) if others else None
    H = joints["H"]
    off = Vector((fx, fy, -drop))
    sh1 = Vector(joints["arm"][1]["shoulder"]) + off
    head = np.concatenate([_coords(o) for n, o in mine.items()
                           if n in ("cranium", "face", "neck") or n.startswith("kef_")])
    r = cfg["bores"][0][3]
    if part:
        # A part is wider than its bore (grips, optic, the bell): its own
        # half-width across the bore stands in for the procedural radius.
        r = max(r, float(np.abs(info["samples"][:, 1]).max()))
    y_head = float(head[:, 1].max()) + r + SEAT_GAP
    face = _coords(mine["face"])
    eye_z = FACE_LO_F * H + 0.03 - drop
    band = face[np.abs(face[:, 2] - eye_z) < 0.06]
    face_front = float((band if len(band) else face)[:, 0].max())

    seat = None
    rest0 = cfg["rest"]
    has_sight = any(b[2] == "sight" for b in cfg["boxes"])
    w_bore = _tube_frame(cfg["pitch"])[2]
    nearest = None   # the least-violating candidate, reported if none clears
    out_max = cfg.get("seat_out_max", SEAT_OUT_MAX)
    for k_out in range(int(round(out_max / SEAT_STEP)) + 1):
        y = y_head + k_out * SEAT_STEP
        for k_slide in range(int(round(cfg.get('seat_slide_max', SEAT_SLIDE_MAX) / SEAT_SLIDE_STEP)) + 1):
            cfg = dict(cfg, rest=rest0 - k_slide * SEAT_SLIDE_STEP)
            for k_up in range(int(round(SEAT_LIFT_MAX / SEAT_STEP)) + 1):
                P = Vector((sh1.x, y, sh1.z)) + w_bore * (k_up * SEAT_STEP)
                sight_c = _sight_centre(cfg, P, face_front, eye_z) if has_sight else None
                if _seat_clear(cfg, P, sight_c, bvh, T, body_v, bvh_mate):
                    seat = (P, sight_c, k_out, k_up, k_slide)
                    break
            if seat:
                break
        if seat:
            break
    if seat is None:
        # Which rule refused: the full counts on a coarse grid of the same
        # search (every tenth step), reported for the least-violating one.
        for k_out in range(0, int(round(out_max / SEAT_STEP)) + 1, 10):
            y = y_head + k_out * SEAT_STEP
            for k_slide in range(0, int(round(cfg.get('seat_slide_max', SEAT_SLIDE_MAX) / SEAT_SLIDE_STEP)) + 1, 10):
                cfg_k = dict(cfg, rest=rest0 - k_slide * SEAT_SLIDE_STEP)
                for k_up in range(0, int(round(SEAT_LIFT_MAX / SEAT_STEP)) + 1, 10):
                    P = Vector((sh1.x, y, sh1.z)) + w_bore * (k_up * SEAT_STEP)
                    sight_c = _sight_centre(cfg_k, P, face_front, eye_z) if has_sight else None
                    viol = _seat_violations(cfg_k, P, sight_c, bvh, T, body_v, bvh_mate)
                    if nearest is None or sum(viol) < sum(nearest[0]):
                        nearest = (viol, k_out, k_up, k_slide, tuple(round(c, 3) for c in P))
        viol, k_out, k_up, k_slide, at_p = nearest
        raise SystemExit(f"{team_id}: no seat for {cfg['name']} within {out_max} m outboard, "
                         f"{SEAT_LIFT_MAX} m above {pfx}'s shoulder and {SEAT_SLIDE_MAX} of its length forward "
                         f"-- look at the figure before widening any of them. Nearest candidate at {at_p} "
                         f"(out {k_out * SEAT_STEP:.3f}, up {k_up * SEAT_STEP:.3f}, slide {k_slide * SEAT_SLIDE_STEP:.2f}): "
                         f"{viol[0]} samples within {SEAT_GAP} of the gunner, {viol[1]} within mate_gap "
                         f"{cfg['mate_gap']} of the other man, {viol[2]} body vertices in a bore, {viol[3]} samples inside")
    P, sight_c, k_out, k_up, k_slide = seat
    d, v, w = _tube_frame(cfg["pitch"])
    u_rear = -cfg["rest"] * cfg["length"]
    if part:
        # The hands' targets ride the part: the firing hand on its pistol
        # grip (a proxy box the arm search reads, deleted below), the support
        # hand on its forward grip -- both measured on the mesh and checked
        # against its surface by `_normalise_part`.
        g, sp = info["grip"], info["support"]
        hang_w = info["support_bottom"]
        cfg = dict(cfg, boxes=((f"{cfg['name']}_gripproxy", (0.02, 0.02, 0.02), (u_rear + g[0], g[1], g[2]), "weapon"),),
                   grip=f"{cfg['name']}_gripproxy", grip_group=None,
                   handle=((u_rear + sp[0], sp[1], hang_w),) + PART_HANDLE)
        if not PART_SPECS[part].get("support_handle", True):
            # The support hand closes on the part itself (its named point),
            # no handle: the MANPAD's procedural rule too -- at 78 deg a
            # handle hung toward the left hand crossed his chest.
            cfg = dict(cfg, handle=None, support=(u_rear + sp[0], sp[1], sp[2]))
    R = Matrix(((d.x, v.x, w.x), (d.y, v.y, w.y), (d.z, v.z, w.z))).to_4x4()
    Rz = Matrix(((-w.x, v.x, d.x), (-w.y, v.y, d.y), (-w.z, v.z, d.z))).to_4x4()   # local z -> bore

    def at(uvw):
        return P + d * uvw[0] + v * uvw[1] + w * uvw[2]

    out = []
    for name, u0, u1, r0, r1, role in cfg["bores"]:
        if abs(r0 - r1) < 1e-9:
            out.append(kit.tube(name, u1 - u0, r0, tuple(at((u_rear + (u0 + u1) / 2.0, 0.0, 0.0))),
                                pitch=math.radians(cfg["pitch"]), role=role))
        else:
            ob = kit.prism(name, r0, r1, u1 - u0, (0.0, 0.0, 0.0), sides=8, role=role)
            _transform(ob, Matrix.Translation(at((u_rear + u0, 0.0, 0.0))) @ Rz)
            out.append(ob)
    # Re-seat the two hands (follow-up to #327): the firing hand's grip slides
    # along the bore (GRIP_SLIDE) and the support hand's seat is searched
    # (HANDLE_* / SUPPORT_SLIDE) to whatever keeps each arm out of his own
    # chest, every arm with its elbow swivel measured too (`_arm_swivel`).
    # A team whose stock and support point hang off the grip (`grip_group`,
    # the MANPAD's gripstock) slides them together and is scored on both arms
    # at once; otherwise the two hands are independent.
    upper_T = np.concatenate([_tris(o) for n, o in mine.items()
                              if rig.PART_BONE.get(n) in ARM_BODY_BONES or n.startswith("kef_")])
    a1 = joints["arm"][1]
    a1S, a1E, a1W = (Vector(a1[k]) + off for k in ("shoulder", "elbow", "wrist"))
    reach1 = (a1E - a1S).length + (a1W - a1E).length
    grip_c = next(Vector(c) for n, _s, c, _r in cfg["boxes"] if n == cfg["grip"])
    short1_cap = max(0.0, (at(grip_c) - a1S).length - reach1) + SUPPORT_SHORT_SLACK
    group = cfg.get("grip_group") or (cfg["grip"],)

    # Support handle: hung from its attach point along its direction, as long
    # as the support arm needs to reach its foot (PR #325's handle, solved) --
    # but never into the body: every point of its axis keeps its own half
    # section plus HANDLE_GAP clear, so the fire clip's recoil (the tube rides
    # forearm_R, the chest rides spine) cannot carry its foot into the chest.
    # If no clear length reaches, the longest clear one is taken and the
    # support wrist's shortfall logged, never the handle driven through him.
    a0 = joints["arm"][0]
    S0 = Vector(a0["shoulder"]) + off
    reach0 = ((Vector(a0["elbow"]) - Vector(a0["shoulder"])).length
              + (Vector(a0["wrist"]) - Vector(a0["elbow"])).length)
    a0S, a0E, a0W = (Vector(a0[k]) + off for k in ("shoulder", "elbow", "wrist"))
    if cfg.get("handle") is None:
        # No handle: the support hand closes on a named point of the weapon --
        # the declared one, or another on the same stock face (SUPPORT_SLIDE).
        def solve(du, dw, grip_du=0.0):
            A = at((cfg["support"][0] + du + grip_du, cfg["support"][1], cfg["support"][2] + dw))
            D = (A - S0).normalized()
            return A, D, 0.0, A + D * 0.02
        cands = [(du, dw) for du in SUPPORT_SLIDE["u"] for dw in SUPPORT_SLIDE["w"]]
        if part:
            # On a part, only seats on its own surface.
            sp = info["support"]
            cands = [(du, dw) for du, dw in cands
                     if float(np.sqrt(((info["samples"] - np.array((sp[0] + du, sp[1], sp[2] + dw))) ** 2)
                                      .sum(axis=1)).min()) <= PART_GRIP_REACH]
        cands_zero = (0.0, 0.0)
    else:
        attach_t, dir_t, section, lmin, lmax = cfg["handle"]
        clear_r = 0.5 * math.hypot(*section) + HANDLE_GAP

        def solve(du, dphi, rake, dv, grip_du=0.0):
            # A part's handle slid back off its forward grip hangs from the
            # tube's own underside (-r), never from air.
            A = at((attach_t[0] + du, attach_t[1] + dv,
                    attach_t[2] if not (part and du) else -info["r"] + 0.005))
            r_vw = math.hypot(dir_t[1], dir_t[2])
            phi = math.atan2(-dir_t[1], -dir_t[2]) + math.radians(dphi)
            Dt = (dir_t[0] + rake, -math.sin(phi) * r_vw, -math.cos(phi) * r_vw)
            D = (d * Dt[0] + v * Dt[1] + w * Dt[2]).normalized()

            def handle_clear(L):
                n = max(2, int(L / 0.01) + 1)
                axis = np.array([tuple(A + D * (L * t)) for t in np.linspace(0.0, 1.0, n)])
                if any(bvh.find_nearest(Vector(p))[3] < clear_r for p in axis[1:]):
                    return False
                return not (_winding(axis, T) > 0.5).any()

            length, best_clear = None, None
            for k in range(int(round((lmax - lmin) / 0.005)) + 1):
                L = lmin + k * 0.005
                if not handle_clear(L):
                    break
                best_clear = L
                if (A + D * L - S0).length <= LAUNCH_REACH_USE * reach0:
                    length = L
                    break
            if best_clear is None:
                return None
            if length is None:
                length = best_clear
            return A, D, length, A + D * length
        cands = [(du, dphi, rk, dv) for du in HANDLE_SLIDE for dphi in HANDLE_SWING for rk in HANDLE_RAKE
                 for dv in HANDLE_INBOARD if not (part and dv)]
        if part:
            # Along the part: from its forward grip back toward the pistol
            # grip in PART_HANDLE_SLIDE steps, never closer than
            # PART_SUPPORT_MIN_AHEAD to it, never forward of the grip.
            span = info["support"][0] - info["grip"][0] - PART_SUPPORT_MIN_AHEAD
            slides = [-PART_HANDLE_SLIDE * k for k in range(int(span / PART_HANDLE_SLIDE) + 1)]
            cands = [(du, dphi, rk, 0.0) for du in slides for dphi in HANDLE_SWING for rk in HANDLE_RAKE]
        cands_zero = (0.0, 0.0, 0.0, 0.0)

    def short_of(foot, D):
        return max(0.0, ((foot - D * 0.02) - a0S).length - reach0)

    declared = solve(*cands_zero)
    if declared is None:
        raise SystemExit(f"{team_id}: {cfg['name']}'s support handle cuts the body even at its declared seat")
    short_cap = short_of(declared[3], declared[1]) + SUPPORT_SHORT_SLACK

    def support_search(grip_du):
        best, tried = None, []
        ref = solve(*cands_zero, grip_du=grip_du) or declared   # the declared seat, riding the grip
        for c in sorted(cands, key=lambda c: sum(abs(x) / sc for x, sc in zip(c, (1.0, 100.0, 1.0, 1.0)))):
            sol = solve(*c, grip_du=grip_du)
            if sol is None or short_of(sol[3], sol[1]) > short_cap:
                continue
            # The support hand never rises above, or reaches further across
            # his body than, its declared seat: a hand lifted beside the face
            # to dodge the chest reads worse than the overlap it removes.
            hand, hand0 = sol[3] - sol[1] * 0.02, ref[3] - ref[1] * 0.02
            # A part's declared seat is its forward grip, LOW on a 38 degree
            # tube: what bounds that hand is his own shoulder, PART_HAND_RISE
            # above which it would sit beside his face.
            z_cap = a0S.z + PART_SPECS[part].get("hand_rise", PART_HAND_RISE) if part else hand0.z
            if hand.z > z_cap + 1e-6 or hand.y > hand0.y + 1e-6:
                continue
            _pole, inside = _arm_swivel(team_id, pfx, 0, mine, upper_T, a0S, a0E, a0W, sol[3] - sol[1] * 0.02,
                                        LAUNCH_SUPPORT_POLE, quiet=True)
            tried.append((c, inside))
            # A part's support hand must REACH first (its handle is only so
            # long), then keep out of the chest; a procedural handle always
            # reaches, so the chest alone decides there.
            key = (short_of(sol[3], sol[1]) > SUPPORT_SHORT_SLACK if part else False, inside)
            if best is None or key < best[3]:
                best = (c, inside, sol, key)
        if best is None:
            log(f"{team_id}: support search at grip slide {grip_du:+.3f}: none of {len(cands)} seat(s) kept -- "
                f"declared hand z {ref[3].z:.3f} (cap {(a0S.z + PART_SPECS[part].get('hand_rise', PART_HAND_RISE)) if part else float('nan'):.3f}), "
                f"short {short_of(ref[3], ref[1]):.3f} (cap {short_cap:.3f})")
        return best, tried

    coupled = len(group) > 1
    fixed_support = None if coupled else support_search(0.0)
    grip_tried = []
    group_u = [c[0] for n, _s, c, _r in cfg["boxes"] if n in group]
    for du in sorted(GRIP_SLIDE, key=abs):
        # Every sliding box stays on the bore, GRIP_ON_TUBE in from either end.
        if du and part:
            continue   # a part's pistol grip is where the mesh has it
        if du and not all(u_rear + GRIP_ON_TUBE <= u + du <= u_rear + cfg["length"] - GRIP_ON_TUBE for u in group_u):
            continue
        g = at(grip_c + Vector((du, 0.0, 0.0)))
        if max(0.0, (g - a1S).length - reach1) > short1_cap:
            continue
        _p, n1 = _arm_swivel(team_id, pfx, 1, mine, upper_T, a1S, a1E, a1W, g, LAUNCH_FIRE_POLE, quiet=True)
        sup = support_search(du) if coupled else fixed_support
        if sup[0] is None:
            continue
        n0 = sup[0][1] if coupled else 0
        grip_tried.append((du, n1 + n0, sup))
    grip_du, _n, (best, tried) = min(grip_tried, key=lambda t: (t[1], abs(t[0])))
    by_du = {t[0]: t[1] for t in grip_tried}
    log(f"{team_id}: {'+'.join(group)} slid {grip_du:+.3f} m along the bore: "
        f"{'both arms' if coupled else 'firing arm'} {by_du[0.0]} -> {by_du[grip_du]} vertices inside his "
        f"upper body ({' '.join(f'{a:+.3f}:{n}' for a, n in sorted(by_du.items()))})")
    (c_best, inside_best, (A, D, length, foot), _key) = best
    log(f"{team_id}: support seat moved {c_best} from the declared one: {dict(tried).get(cands_zero)} -> "
        f"{inside_best} support-arm vertices inside his upper body ({len(tried)} seats tried: "
        f"{' '.join('/'.join(f'{x:+.3f}' for x in c) + f':{n}' for c, n in sorted(tried))})")

    centres = {}
    for name, size, c, role in cfg["boxes"]:
        c = sight_c if c == "sight" else Vector(c)
        if name in group:
            c = c + Vector((grip_du, 0.0, 0.0))
        ob = kit.box(name, size, (0.0, 0.0, 0.0), role)
        _transform(ob, Matrix.Translation(at(c)) @ R)
        centres[name] = at(c)
        out.append(ob)

    handle_ob = None
    if cfg.get("handle") is not None:
        foot = A + D * length
        hob = kit.box(f"{cfg['name']}_handle", (section[0], section[1], length), (0.0, 0.0, 0.0), "weapon")
        # local z -> D, local x -> the bore where it can be, y completing the frame
        xz = (d - D * d.dot(D)).normalized()
        yz = D.cross(xz)
        M = Matrix(((xz.x, yz.x, D.x), (xz.y, yz.y, D.y), (xz.z, yz.z, D.z))).to_4x4()
        _transform(hob, Matrix.Translation(A + D * (length / 2.0)) @ M)
        out.append(hob)
        handle_ob = hob

    # Both arms, rigidly, by PR #325's two-bone IK -- elbow swivel MEASURED
    # (`_arm_swivel`), so the re-seated arm stays out of his own chest.
    names = {0: "L", 1: "R"}
    short = {}
    for side, target, pole in ((1, centres[cfg["grip"]], LAUNCH_FIRE_POLE),
                               (0, foot - D * 0.02, LAUNCH_SUPPORT_POLE)):
        a = joints["arm"][side]
        S, E, W = (Vector(a[k]) + off for k in ("shoulder", "elbow", "wrist"))
        # Protraction: a shoulder reaching forward or across rides its
        # scapula forward and out. Searched in SHOULDER_PROTRACT steps (out
        # from the midline, forward), never past the deltoid blob that hides
        # the seam, and kept only where it takes arm vertices out of the chest.
        reach = (E - S).length + (W - E).length
        out_y = -1.0 if side == 0 else 1.0
        trials = []
        for o in SHOULDER_PROTRACT:
            for f in SHOULDER_PROTRACT:
                shift = Vector((f, out_y * o, 0.0))
                if (target - (S + shift)).length - reach > max(0.0, (target - S).length - reach) + 1e-6:
                    continue   # never leave the hand further off its seat
                p_, n_ = _arm_swivel(team_id, pfx, side, mine, upper_T, S, E, W, target, pole, quiet=True,
                                     shift=shift)
                trials.append((n_, o + f, shift))
        n_best, _mag, shift = min(trials, key=lambda t: (t[0], t[1]))
        pole, _inside = _arm_swivel(team_id, pfx, side, mine, upper_T, S, E, W, target, pole, shift=shift)
        log(f"{team_id}: {pfx} shoulder{side} protracted {tuple(round(x, 3) for x in shift)}: "
            f"{min(t[0] for t in trials if t[1] == 0)} -> {n_best} arm vertices inside (swivel search)")
        for n in ("upperarm", "elbow", "forearm"):
            _transform(mine[f"{n}{side}"], Matrix.Translation(shift))
        S, E, W = S + shift, E + shift, W + shift
        m_up, m_fore, E2, W2, sh = _two_bone(S, E, W, target, pole)
        _transform(mine[f"upperarm{side}"], m_up)
        _transform(mine[f"elbow{side}"], m_up)
        _transform(mine[f"forearm{side}"], m_fore)
        for i, (bn, parent, h, t) in enumerate(bones):
            if bn == f"{pfx}_upperarm_{names[side]}":
                bones[i] = (bn, parent, tuple(S), tuple(E2))
            elif bn == f"{pfx}_forearm_{names[side]}":
                bones[i] = (bn, parent, tuple(E2), tuple(W2))
        short[side] = sh
    if part:
        for ob in [o for o in out if o.name.endswith("_gripproxy") or o.name.endswith("_bore")]:
            out.remove(ob)
            bpy.data.objects.remove(ob, do_unlink=True)
        pob = _part_copy(part, cfg["name"])
        M = Matrix(((d.x, v.x, w.x), (d.y, v.y, w.y), (d.z, v.z, w.z))).to_4x4()
        _transform(pob, Matrix.Translation(P + d * u_rear) @ M)
        out.append(pob)
        _part_extent_log(pob)
        # The handle extends the part's forward grip: one material per role,
        # so it borrows that grip's own texel.
        if handle_ob is not None:
            _borrow_uv(handle_ob, pob, near=tuple(A))
    # Every launcher part, accessories included, against the body at rest:
    # the seat search tests the bore and the sight; the grips and the handle
    # are placed after it, so they are verified here and REFUSED if they cut
    # the body (their hands, the two re-seated arms, are not body).
    bad = {}
    for ob in out:
        me = ob.data
        co = _coords(ob)
        samp = [co]
        for e in me.edges:
            a, b = co[e.vertices[0]], co[e.vertices[1]]
            n = max(2, int(np.linalg.norm(b - a) / 0.01) + 1)
            samp.append(a + (b - a) * np.linspace(0.0, 1.0, n)[:, None])
        samp = np.concatenate(samp)
        inside = int((_winding(samp, T) > 0.5).sum())
        near = min(bvh.find_nearest(Vector(p))[3] for p in samp)
        # Half the seat's gap: the search samples a bore as a 12-gon and the
        # mesh is an 8-gon, so a corner it never sampled can sit a few mm
        # nearer than SEAT_GAP (measured: 16.7 mm on the RPG's flare).
        if inside or near < SEAT_GAP / 2.0:
            bad[ob.name] = (inside, round(near, 4))
    if bad:
        raise SystemExit(f"{team_id}: launcher parts inside the body, or within {SEAT_GAP / 2.0} m of it, "
                         f"at rest (part: (samples inside, nearest m)): {bad}")
    log(f"{team_id}: {cfg['name']} pitch {cfg['pitch']} rests at ({P.x:+.3f}, {P.y:+.3f}, {P.z:.3f}) over "
        f"{pfx}'s +y shoulder joint ({sh1.x:+.3f}, {sh1.y:+.3f}, {sh1.z:.3f}): head rule y {y_head:+.3f} "
        f"(widest head/face/neck/keffiyeh + r {r} + gap {SEAT_GAP}) stepped out {k_out * SEAT_STEP:.3f}, "
        f"pushed {k_up * SEAT_STEP:.3f} off the joint along the bore's normal to clear the body by {SEAT_GAP}, "
        f"slid forward to rest "
        f"{cfg['rest']:.2f} of its length from the rear (declared {rest0:.2f}); "
        f"support handle {length:.3f} m; firing wrist short of grip by {short[1] * 100:.1f} cm, "
        f"support wrist short of handle by {short[0] * 100:.1f} cm")
    return out


def _join(objs, name, role):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    ob["rl_role"] = role
    return ob


def _place(parts, dx, dy):
    for ob in parts.values():
        _transform(ob, Matrix.Translation((dx, dy, 0.0)))


# ---------------------------------------------------------------------------
# B8: Meshy crew-weapon parts, textured through the figure's own atlas
# ---------------------------------------------------------------------------
#
# The lead's 2 Oct follow-ups after the portrait sheet: the kit mortar read
# as a crude grey frame beside three Meshy crewmen, and the sniper's kit tube
# as a flat panel beside the prone pair. Each part is one Meshy text-to-3D
# preview, refined at 8k and remeshed at the crew-weapon cap (600), loaded
# here from the ledger's LAST remesh named `MESHY_PARTS[team]["name"]`
# (`docs/art/meshy-prompts-units.md` sections 25-26).
#
# WHY AN ATLAS. The part arrives with its own bake, and a role that joins a
# part on one material with a part on another exports as TWO primitives
# which three.js names `weapon_1`/`weapon_2` -- roles nothing maps
# (`_borrow_uv`'s own note). So the GLB keeps ONE material: the part's base
# colour is scaled to TEXTURE_PX and composed BESIDE the figure's in one
# 2 x TEXTURE_PX by TEXTURE_PX `base_color`, the figure's uvs are mapped
# into u [0, 0.5) BEFORE the cut (so every blob and borrowed uv follows) and
# the part's into [0.5, 1). A kit piece left in a role the part now shares
# (the No.3's rifle beside the mortar, the standing spotter's glasses beside
# the scope) borrows one uv from the PART's bake, so the role stays one
# material. The figure keeps exactly the texel density it had: its half of
# the atlas IS its 1024 bake.
MESHY_PARTS = {
    "mortar_team": {
        "name": "mortar_team_mortar",
        # The whole assembly (tube, bipod, baseplate, sight) is one `weapon`
        # mesh on `prop` at kit's own anchor -- the point the importer's
        # `_inside_count` and `launcher_clearance.test.ts`'s MOUNTED row
        # refuse on. Scaled so the longest bounding-box axis reads this many
        # metres (the preview's 35-degree tube reaches further forward than
        # kit's 74-degree spike: a 1.3 m tube lies ~1.1 m along the ground).
        "longest_m": 1.40,
        "anchor": (0.26, 0.0),
    },
    "sniper_team": {
        "name": "sniper_team_rifle",
        # Two loose pieces in one preview: the rifle (the larger island) and
        # the spotting scope on its tripod. The rifle's long axis is scaled
        # to the kit tube's 1.24 m and the scope takes the same factor.
        "rifle_m": 1.24,
    },
}


def _part_source(name):
    """The ledger's LAST `kind: remesh` task named `name`, as
    `tools/vehicles/export_meshy_ramp.py` finds a vehicle's."""
    import json
    ledger = os.path.join(REPO, "art", "meshy", "ledger.jsonl")
    task_id = None
    with open(ledger) as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            entry = json.loads(line)
            if entry.get("kind") == "remesh" and entry.get("name") == name:
                task_id = entry["id"]
    if task_id is None:
        raise SystemExit(f"no kind=remesh entry named {name!r} in {ledger}")
    hits = glob.glob(os.path.join(REPO, "art", "meshy", f"{name.replace('_', '-')}-*-{task_id.split('-')[0]}", "model.glb"))
    if len(hits) != 1:
        raise SystemExit(f"expected one download dir for remesh task {task_id}, found {hits}")
    return hits[0], task_id


def _load_part(team_id):
    """`MESHY_PARTS[team_id]`'s part (B8): see `_load_part_file`."""
    path, task_id = _part_source(MESHY_PARTS[team_id]["name"])
    ob, img = _load_part_file(team_id, path, task_id)
    ob.name = "part_src"
    return ob, img


def _load_part_file(team_id, path, task_id):
    """Import a part GLB as one mesh object with its world transform
    applied, keeping only its base-colour image (renamed `part_color`, its
    own material dropped -- the part draws through the figure's material
    once the atlas is composed). Returns (object, image)."""
    before = set(bpy.data.objects)
    before_img = set(bpy.data.images)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
    if len(new) != 1:
        raise SystemExit(f"{team_id}: expected one mesh in the part remesh, found {[o.name for o in new]}")
    ob = new[0]
    for o in list(bpy.data.objects):
        if o not in before and o.type != "MESH":
            bpy.data.objects.remove(o, do_unlink=True)
    ob.parent = None
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    mats = [m for m in ob.data.materials if m is not None]
    if len(mats) != 1 or not mats[0].use_nodes:
        raise SystemExit(f"{team_id}: expected one node material on the part remesh, found {[m.name for m in mats]}")
    tree = mats[0].node_tree
    bsdf = next((n for n in tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    link = next((l for l in tree.links if bsdf is not None and l.to_node == bsdf and l.to_socket.name == "Base Color"), None)
    if link is None or link.from_node.type != "TEX_IMAGE" or link.from_node.image is None:
        raise SystemExit(f"{team_id}: the part's Base Color is not an image -- no bake to compose")
    img = link.from_node.image
    img.name = "part_color"
    for other in list(bpy.data.images):
        if other not in before_img and other is not img:
            bpy.data.images.remove(other)
    ob.data.materials.clear()
    bpy.data.materials.remove(mats[0])
    if not ob.data.uv_layers:
        raise SystemExit(f"{team_id}: the part remesh carries no UV layer")
    log(f"{team_id}: part {os.path.relpath(path, REPO)} ({task_id}): {len(ob.data.polygons)} tris, "
        f"part_color {img.size[0]}x{img.size[1]}")
    return ob, img


def _remap_u(ob, lo, hi):
    """Map every uv's u from [0, 1) into [lo, hi)."""
    layer = ob.data.uv_layers.active
    uv = np.empty(len(ob.data.loops) * 2, dtype=np.float32)
    layer.data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    uv[:, 0] = lo + (uv[:, 0] % 1.0) * (hi - lo)
    layer.data.foreach_set("uv", uv.ravel())


def _scaled_pixels(img, w, h):
    """The image's RGB(A) buffer resampled to (w, h) -- on a COPY, so the
    datablock the material still references is untouched until replaced."""
    tmp = img.copy()
    tmp.scale(w, h)
    px = np.array(tmp.pixels[:], dtype=np.float32).reshape(h, w, tmp.channels)
    bpy.data.images.remove(tmp)
    return px


def _retexel_orange(team_id, name, px):
    """Re-paint the bake's safety-orange texels (`ORANGE_HUE`/`ORANGE_SAT`,
    dilated `ORANGE_DILATE`) with the median of the part's OTHER texels -- the
    tube's own olive -- scaled to each texel's own brightness, so the grain
    survives and the band does not. Refuses if it finds nothing to paint."""
    rgb = px[..., :3]
    mx, mn = rgb.max(axis=2), rgb.min(axis=2)
    d = np.where(mx - mn > 1e-6, mx - mn, 1.0)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    hue = np.where(mx == r, ((g - b) / d) % 6.0, np.where(mx == g, (b - r) / d + 2.0, (r - g) / d + 4.0)) * 60.0
    hue = np.where(mx - mn > 1e-6, hue, 0.0)
    sat = np.where(mx > 1e-6, (mx - mn) / np.where(mx > 1e-6, mx, 1.0), 0.0)
    mask = (hue >= ORANGE_HUE[0]) & (hue <= ORANGE_HUE[1]) & (sat > ORANGE_SAT) & (mx > ORANGE_VAL)
    core = int(mask.sum())
    if not core:
        raise SystemExit(f"{team_id}: {name}: no orange texels to re-paint -- the bake changed; look at it")
    for _ in range(ORANGE_DILATE):
        m = mask.copy()
        m[1:, :] |= mask[:-1, :]
        m[:-1, :] |= mask[1:, :]
        m[:, 1:] |= mask[:, :-1]
        m[:, :-1] |= mask[:, 1:]
        mask = m & (mx > ORANGE_VAL)
    keep = (~mask) & (mx > ORANGE_VAL)
    olive = np.median(rgb[keep], axis=0)
    gain = (mx[mask] / max(float(olive.max()), 1e-6))[:, None]
    out = px.copy()
    out[..., :3][mask] = np.clip(olive[None, :] * gain, 0.0, 1.0)
    log(f"{team_id}: {name}: {core} orange texel(s) (+{int(mask.sum()) - core} edge) re-painted "
        f"olive {tuple(round(float(v), 3) for v in olive)} at their own brightness")
    return out


def _compose_atlas(team_id, src, slots):
    """One `base_color` of (1 + n) * TEXTURE_PX x TEXTURE_PX: the figure's bake
    in the first slot, each part's in the next ones, left to right, in the
    order `slots` ((object, image) per part) gives; the figure's uvs into
    [0, 1/(1+n)), part k's into [k/(1+n), (k+1)/(1+n)); every part takes the
    figure's material. With one part this is B8's two-slot atlas exactly.
    Sets `_TEX["atlas"]` so the export step ships the atlas at that size
    rather than squashing it to a square."""
    fig_img = bpy.data.images["base_color"]
    n = 1 + len(slots)
    W, H = n * TEXTURE_PX, TEXTURE_PX
    tiles = [_scaled_pixels(fig_img, TEXTURE_PX, TEXTURE_PX)]
    ch = tiles[0].shape[2]
    for _ob, img in slots:
        px = _scaled_pixels(img, TEXTURE_PX, TEXTURE_PX)
        if img.name.startswith("part_color_") and img.name[len("part_color_"):] in ORANGE_RETEXEL:
            px = _retexel_orange(team_id, img.name[len("part_color_"):], px)
        if px.shape[2] != ch:
            rgba = np.ones((TEXTURE_PX, TEXTURE_PX, ch), dtype=np.float32)
            k = min(ch, px.shape[2])
            rgba[..., :k] = px[..., :k]
            px = rgba
        tiles.append(px)
    atlas = bpy.data.images.new("atlas_color", W, H, alpha=(ch == 4))
    atlas.pixels = np.concatenate(tiles, axis=1).ravel().tolist()
    atlas.update()
    mat = _TEX["material"]
    for node in mat.node_tree.nodes:
        if node.type == "TEX_IMAGE" and node.image is fig_img:
            node.image = atlas
    fig_img.name = "figure_color"
    atlas.name = "base_color"
    _remap_u(src, 0.0, 1.0 / n)
    for k, (ob, _img) in enumerate(slots, start=1):
        _remap_u(ob, k / n, (k + 1) / n)
        ob.data.materials.clear()
        ob.data.materials.append(mat)
    for stale in [fig_img] + [img for _ob, img in slots]:
        if stale.users == 0:
            bpy.data.images.remove(stale)
    _TEX["atlas"] = (W, H)
    log(f"{team_id}: atlas {W}x{H} -- figure bake, then {[ob.name for ob, _i in slots]}; "
        f"images {[i.name for i in bpy.data.images]}")


def _separate_islands(ob):
    """Split `ob` into its loose pieces, largest first (by face count).
    A remesh's UV seams split its vertices (the B8 sniper part came apart
    into 361 'islands' by vertex connectivity), so coincident vertices are
    welded first -- UVs live on the loops and are untouched."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.separate(type="LOOSE")
    bpy.ops.object.mode_set(mode="OBJECT")
    pieces = [o for o in bpy.context.selected_objects if o.type == "MESH"]
    pieces.sort(key=lambda o: -len(o.data.polygons))
    return pieces


def _part_extent_log(ob):
    co = _coords(ob)
    log(f"  {ob.name:22s} role {ob.get('rl_role'):7s} x {co[:, 0].min():+.2f}..{co[:, 0].max():+.2f} "
        f"y {co[:, 1].min():+.2f}..{co[:, 1].max():+.2f} z {co[:, 2].min():+.2f}..{co[:, 2].max():+.2f} "
        f"({len(ob.data.polygons)} tris)")


def _long_axis_yaw(co):
    """Yaw (degrees) that turns the xy long axis of `co` onto +X, read off
    the 2-D covariance; which END leads is settled by the caller."""
    xy = co[:, :2] - co[:, :2].mean(axis=0)
    w, v = np.linalg.eigh(xy.T @ xy)
    ax = v[:, int(np.argmax(w))]
    return -math.degrees(math.atan2(ax[1], ax[0]))


def _meshy_mortar(team_id, part):
    """The mortar: scaled by its longest axis, turned so the muzzle (the
    highest vertex cluster) leads the baseplate (the lowest) along +X,
    baseplate centre on kit's anchor, on the ground, role `weapon`."""
    cfg = MESHY_PARTS[team_id]
    co = _coords(part)
    ext = co.max(axis=0) - co.min(axis=0)
    scale = cfg["longest_m"] / float(ext.max())
    z = co[:, 2] - co[:, 2].min()
    plate = co[z < 0.06 * z.max()][:, :2].mean(axis=0)
    muzzle = co[z > 0.90 * z.max()][:, :2].mean(axis=0)
    d = muzzle - plate
    yaw = -math.degrees(math.atan2(d[1], d[0]))
    log(f"{team_id}: mortar source extent {tuple(round(float(e), 3) for e in ext)}, scale {scale:.4f}, "
        f"muzzle leads the plate by {math.hypot(*d):.3f} source units at {-yaw:+.1f} deg -> yaw {yaw:+.1f}")
    _transform(part, Matrix.Scale(scale, 4))
    _transform(part, Matrix.Rotation(math.radians(yaw), 4, "Z"))
    co = _coords(part)
    z = co[:, 2] - co[:, 2].min()
    plate = co[z < 0.06 * z.max()][:, :2].mean(axis=0)
    ax, ay = cfg["anchor"]
    _transform(part, Matrix.Translation((ax - plate[0], ay - plate[1], -co[:, 2].min())))
    part.name = part.data.name = "mtr_tube"
    part["rl_role"] = "weapon"
    _part_extent_log(part)
    return part


def _meshy_sniper_kit(team_id, part):
    """The rifle and the spotting scope from one preview: separated by
    connectivity, the rifle turned muzzle +X (the thinner end -- the stock
    is the taller one), scaled to `rifle_m`, the scope by the same factor,
    both left where that leaves them for the caller to place. Returns
    (rifle, scope)."""
    cfg = MESHY_PARTS[team_id]
    pieces = _separate_islands(part)
    if len(pieces) < 2:
        raise SystemExit(f"{team_id}: the part remesh is one island -- no spotting scope to split off")
    rifle, scope = pieces[0], pieces[1]
    for extra in pieces[2:]:
        # Loose slivers (a strap end, a bipod foot) go with the nearer piece.
        c = _coords(extra).mean(axis=0)
        near = min((rifle, scope), key=lambda o: float(((_coords(o).mean(axis=0) - c) ** 2).sum()))
        bpy.ops.object.select_all(action="DESELECT")
        extra.select_set(True)
        near.select_set(True)
        bpy.context.view_layer.objects.active = near
        bpy.ops.object.join()
    log(f"{team_id}: islands -> rifle {len(rifle.data.polygons)} tris, scope {len(scope.data.polygons)} tris, "
        f"{len(pieces) - 2} sliver(s) merged")
    co = _coords(rifle)
    yaw = _long_axis_yaw(co)
    _transform(rifle, Matrix.Rotation(math.radians(yaw), 4, "Z"))
    co = _coords(rifle)
    x0, x1 = co[:, 0].min(), co[:, 0].max()
    front = co[co[:, 0] > x1 - 0.2 * (x1 - x0)]
    back = co[co[:, 0] < x0 + 0.2 * (x1 - x0)]
    if (front[:, 2].max() - front[:, 2].min()) > (back[:, 2].max() - back[:, 2].min()):
        _transform(rifle, Matrix.Rotation(math.radians(180.0), 4, "Z"))
        yaw += 180.0
    scale = cfg["rifle_m"] / float(x1 - x0)
    log(f"{team_id}: rifle long axis {x1 - x0:.3f} source units, yaw {yaw:+.1f}, scale {scale:.4f}")
    _transform(scope, Matrix.Rotation(math.radians(yaw), 4, "Z"))
    for ob in (rifle, scope):
        _transform(ob, Matrix.Scale(scale, 4))
    return rifle, scope


def _seat_on_ground(ob, name, role, x, y):
    """xy bounding-box centre on (x, y), lowest vertex on z = 0."""
    co = _coords(ob)
    cx, cy = (co[:, 0].min() + co[:, 0].max()) / 2.0, (co[:, 1].min() + co[:, 1].max()) / 2.0
    _transform(ob, Matrix.Translation((x - cx, y - cy, -co[:, 2].min())))
    ob.name = ob.data.name = name
    ob["rl_role"] = role
    _part_extent_log(ob)
    return ob


# ---------------------------------------------------------------------------
# A3.1 stage 2 (GH-179, 2026-10-05): Meshy hand weapons through the atlas
# ---------------------------------------------------------------------------
#
# `docs/art/meshy-prompts-a31-parts.md`: the kit rifles and the procedural
# launchers still drawn on Meshy bodies are replaced by Meshy PARTS -- each
# refined at 8k and remeshed at the crew-weapon number (400, cap 600), or for
# the RPG-7 the on-disk textured image-to-3D source decimated by
# `export_meshy_rpg.py` -- and composed into the team's one atlas exactly as
# B8's mortar and rifle are (`_compose_atlas`, one TEXTURE_PX slot per part
# after the figure's). A part shared by several figures is loaded ONCE and
# copied per figure, so every copy reads the same slot. Every part is scaled
# to REAL metres from its own measured length (Meshy normalises every model
# to 1.90 m on its longest axis), role `weapon`.
#
# Two kinds, one canonical frame each, set by `_normalise_part`:
#
#   rifle     the long axis on X, the muzzle +X (the butt is the TALLER end:
#             a stock and butt plate against a barrel, `RIFLE_BUTT_RATIO`),
#             the magazine down (-Z: the deeper protrusion from the body's
#             own centreline), the length centred on x = 0 and that
#             centreline on z = 0. It replaces `rig._weapon_parts`' seven-box
#             rifle IN PLACE (`_rifle_part_at_hand`): the same anchor and yaw
#             `_rifle_at_hand` solves from the bent right hand, its length
#             centred where the kit rifle's span is centred. The hand then
#             closes on the receiver behind the magazine.
#
#   launcher  the bore on the X axis, x = 0 at the REAR, the muzzle +X, the
#             optic (the highest thing above the bore) on -Y -- the INBOARD
#             side, toward the gunner's face (`_seat_launcher`'s frame: v = +y
#             is outboard). A part whose optic comes on +Y is MIRRORED in Y
#             (winding reversed); every one of these weapons is symmetric
#             but for the sight, and a sight on the far side of the tube from
#             the eye is the one thing that reads wrong. The grips are found
#             on the mesh (`_down_runs`: runs of length slices reaching below
#             the bore) and named per part in `PART_SPECS`; the firing hand
#             goes to one, the support hand to the other, and each target
#             must lie within `PART_GRIP_REACH` of the part's own surface or
#             the import refuses -- a hand closing on air is the defect the
#             procedural grips could never have.
HAND_PARTS = {
    "militia_cell": ("sarim_rifle",),
    "sarim_rifles": ("sarim_rifle",),
    "rpg_team": ("rpg_launcher", "sarim_rifle"),
    "mortar_team": ("kdf_carbine",),
    "yahalom_squad": ("kdf_carbine",),
    "breach_team": ("kdf_carbine",),
    "manpad_team": ("manpad_tube",),
    "atgm_cell": ("atgm_post",),
    "recoilless_team": ("recoilless_rifle",),
}
#: name -> spec. `length_m`: real overall length. `path`: a part that is not a
#: Meshy remesh (the RPG, from `export_meshy_rpg.py`), with its provenance.
#: Launchers: `grip_run`/`support_run` index `_down_runs` from the REAR.
PART_SPECS = {
    "sarim_rifle": dict(kind="rifle", length_m=0.88),
    "kdf_carbine": dict(kind="rifle", length_m=0.85, cut=lambda *a: _cut_carbine_sling(*a)),
    # Spike (A3.1 #3): Meshy's muzzle (the sealed front cap) at -X, the CLU
    # with its thermal sight at the rear; the plain canister is the front
    # third. Seated by `import_meshy_kdf_team.py` (at_team), which keeps its
    # own measured hands, so no grip runs are named here.
    "spike_launcher": dict(kind="launcher", length_m=1.2, src_muzzle=-1, bore_band=(0.80, 0.95),
                           cut=lambda *a: _cut_spike_bipod(*a)),
    # MANPAD (A3.1 #10): delivered lying on its side (gripstock toward -y),
    # its pointed missile nose at -X. Seated by `_seat_launcher` at 78 deg
    # with its gripstock BELOW the shoulder point (`rest_behind_grip` < 0),
    # where the procedural gripstock hung -- at 78 deg a grip above the
    # shoulder puts both hands beside the face. The seat search still slides
    # the fat tube 0.3 m up its bore to clear the head, which lifts both
    # hands: the support hand closes on the tube just ahead of the pistol
    # grip and may sit `hand_rise` above its shoulder (at 0.10 every seat was
    # refused: hand 0.30 m above it, measured). `launcher_arms.test.ts`
    # (ceiling 196/196/207) read idle/fire/move -- support_ahead -0.20:
    # 229/234/246; -0.10: 203/208/207; -0.05: 187/192/197; +0.02: 170/175/186.
    # The lead's ruling: its pointed missile nose is cut off where the tube
    # ends and the hole capped flat (`_cut_manpad`), and the shipped length
    # -- after that cut -- is the 1.4 m. The strap that hangs off it goes.
    "manpad_tube": dict(kind="launcher", length_m=1.4, src_roll=90.0, src_muzzle=-1, bore_band=(0.50, 0.75),
                        cut=lambda *a: _cut_manpad(*a), grip_run="deepest", support_ahead=0.02, hand_rise=0.30,
                        rest_behind_grip=-0.20,
                        # 2 cm seat samples (the final clearance check still
                        # samples every 1 cm): at 1 cm its widened search
                        # ran past ten minutes.
                        seat_sample_step=0.02, support_handle=False),
    # ATGM post (A3.1 #6 v2): a squat four-legged tripod under a level tube,
    # its rounded front at -X; stands on `prop` at kit's anchor.
    "atgm_post": dict(kind="mounted", tube_m=1.2, tube_band_f=0.30, src_muzzle=-1),
    # Recoilless (A3.1 #8 v2): on a dirt patch (`_split_recoilless`), muzzle
    # +X, the fat venturi housing at the rear; 1.1 m.
    # Its front leg (a folding bipod, hanging) is cut; the hands close on the
    # barrel's underside, the firing hand just ahead of the venturi housing.
    "recoilless_rifle": dict(kind="launcher", length_m=1.1, pre=lambda *a: _split_recoilless(*a),
                             bore_band=(0.60, 0.85), cut=lambda *a: _cut_recoilless_leg(*a),
                             grip_run=0, grip_at=0.45, support_ahead=0.25),
    "rpg_launcher": dict(kind="launcher", length_m=1.27, path=os.path.join("art", "parts", "rpg7.glb"),
                         provenance="export_meshy_rpg.py <- Meshy_AI_RPG_7_launcher_0903143528 (textured)",
                         grip_run=0, support_run=1, optic_inboard=False),
}
RIFLE_BUTT_RATIO = 1.3          # the butt end's height over the muzzle end's, or the import refuses
RIFLE_END_F = 0.05              # each end slice, of the length, for that comparison
#: The kit rifle's own span in its anchor frame (`rig._weapon_parts`: the
#: stock's rear face at -0.44, the front sight at +0.48), whose centre the
#: Meshy rifle's length is centred on.
KIT_RIFLE_SPAN = (-0.44, 0.48)
PART_GRIP_REACH = 0.03          # m: a hand target this close to the part's surface, or refused
SLIVER_FACES = 8                # loose islands smaller than this are dropped (a remesh's stray strip)
LAUNCH_BORE_BAND = (0.15, 0.35) # of the length from the rear: plain tube, for the bore radius
LAUNCH_SIGHT_ABOVE = 0.03       # m above the bore's top that counts as the optic
CARBINE_SLING_Y = -0.02           # source units, kdf_carbine: see `_cut_carbine_sling`
CARBINE_STOCK_X = 0.40
CARBINE_STOCK_BOTTOM = -0.10
MANPAD_FULL_BORE = 0.92            # of the bore radius: the tube's end, scanning back from the nose
MANPAD_HANG = 0.005
MANPAD_STRAP_HUE = (15.0, 45.0)    # degrees: the strap's orange
MANPAD_STRAP_SAT = 0.45
MOUNTED_FEET_DZ = 0.03           # m: the vertices this close to the lowest are the feet
MOUNTED_CAP_BELOW = 0.03         # m under the tube's bottom: what the front cap may cut
ATGM_ANCHOR = (0.24, 0.0)        # kit's `rig._atgm_extras` anchor: the post's feet centre
ATGM_SWAY_MARGIN = 0.08         # m past the first anchor clear at rest
ATGM_ANCHOR_SLIDE = tuple(round(0.02 * k, 2) for k in range(0, 16))   # m forward of it, tried in order
RCL_BASE_DZ = 0.04               # source units: the recoilless preview's dirt patch
RCL_ROUNDS_MIN_FACES = 20
RCL_LEG_BELOW = 0.08
RCL_REMNANT_X = 0.60             # of the length: the leg bracket's rear edge sits at ~0.64
RCL_BARREL_REF_F = 0.88          # of the length: the muzzle end, where the barrel's bottom is read
RCL_REMNANT_SLACK = 0.01         # m under that bottom before a face counts as hanging
#: Parts whose bake carries a stray safety-orange band (the recoilless's
#: ring at the housing's front and its strap stubs: hue ~32 deg, sat ~0.65,
#: where the tube is olive at ~66 deg): those texels are re-painted with the
#: tube's own olive at their own brightness, in the part's atlas slot.
ORANGE_RETEXEL = {"recoilless_rifle"}
ORANGE_HUE = (8.0, 44.0)         # degrees
ORANGE_SAT = 0.40
ORANGE_VAL = 0.12
ORANGE_DILATE = 2                # texels, at the slot's TEXTURE_PX: the band's blended edge
SPIKE_BIPOD_WINDOW = (0.66, 0.80)  # of the length from the rear: where the preview's bipod hangs
SPIKE_BIPOD_BELOW = 0.03        # m under the canister's bottom
GRIP_BELOW = 0.04               # m below the bore's bottom that counts as a grip
RUN_MERGE = 0.03                # m: hanging runs closer than this are one grip
_HAND = {}
_HAND_EXTRA = {}   # a second piece a part's `pre` split off (the recoilless rounds)
_PART_INFO = {}


def _load_hand_part(team_id, name):
    spec = PART_SPECS[name]
    if spec.get("path"):
        path, task = os.path.join(REPO, spec["path"]), spec["provenance"]
        if not os.path.exists(path):
            raise SystemExit(f"{team_id}: {name} not built -- run tools/units/export_meshy_rpg.py first ({path})")
    else:
        path, task = _part_source(name)
    ob, img = _load_part_file(team_id, path, task)
    ob.name = ob.data.name = f"part_{name}"
    img.name = f"part_color_{name}"
    if spec.get("pre"):
        ob = spec["pre"](team_id, name, ob)
    _drop_slivers(team_id, ob)
    return ob, img


def _drop_slivers(team_id, ob):
    """Delete loose islands under SLIVER_FACES faces (welded first: a remesh's
    UV seams split its vertices, `_separate_islands`' note)."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bm.faces.ensure_lookup_table()
    seen, small = set(), []
    for f in bm.faces:
        if f.index in seen:
            continue
        comp, stack = [], [f]
        seen.add(f.index)
        while stack:
            g = stack.pop()
            comp.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in seen:
                        seen.add(h.index)
                        stack.append(h)
        if len(comp) < SLIVER_FACES:
            small += comp
    if small:
        bmesh.ops.delete(bm, geom=small, context="FACES")
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    log(f"{team_id}: {ob.name}: {len(small)} sliver face(s) dropped, {len(ob.data.polygons)} tris kept")


def _apply_np(ob, co):
    ob.data.vertices.foreach_set("co", np.asarray(co, dtype=np.float64).ravel())
    ob.data.update()


def _reverse_winding(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def _slices(co, n=40):
    """(lo, hi, zmin, zmax, ymin, ymax) per non-empty slice along X."""
    x0, x1 = co[:, 0].min(), co[:, 0].max()
    out = []
    for b in range(n):
        a, c = x0 + (x1 - x0) * b / n, x0 + (x1 - x0) * (b + 1) / n
        s = co[(co[:, 0] >= a) & (co[:, 0] <= c)]
        if len(s):
            out.append((a, c, s[:, 2].min(), s[:, 2].max(), s[:, 1].min(), s[:, 1].max()))
    return np.array(out)


def _body_centreline(co):
    """z of the body's own centreline: the median slice midpoint over the
    slices that are NOT a protrusion (span within 1.3x the median span)."""
    sl = _slices(co)
    span = sl[:, 3] - sl[:, 2]
    body = sl[span <= 1.3 * np.median(span)]
    return float(np.median((body[:, 2] + body[:, 3]) / 2.0))


def _surface_samples(ob, step=0.01):
    """Every vertex, plus every edge sampled at `step` -- the density the
    launcher seat and the clearance census use."""
    co = _coords(ob)
    pts = [co]
    for e in ob.data.edges:
        a, b = co[e.vertices[0]], co[e.vertices[1]]
        n = max(2, int(np.linalg.norm(b - a) / step) + 1)
        pts.append(a + (b - a) * np.linspace(0.0, 1.0, n)[:, None])
    return np.concatenate(pts)


def _down_runs(co, r, below):
    """Runs of length slices (x0, x1, zmin) that HANG: the lowest point more
    than `below` under the bore's bottom (-r) and at least twice as far down
    as the slice reaches up -- a grip, not the bell's or a cap's full ring.
    Runs closer than RUN_MERGE are one run (a grip with a gap at its guard).
    Rear first."""
    sl = _slices(co, 60)
    hang = (sl[:, 2] < -(r + below)) & (-sl[:, 2] > 2.0 * sl[:, 3])
    runs, cur = [], None
    for row, h in zip(sl, hang):
        if h:
            if cur is None and runs and row[0] - runs[-1][1] < RUN_MERGE:
                cur = list(runs.pop())
            cur = [row[0], row[1], row[2]] if cur is None else [cur[0], row[1], min(cur[2], row[2])]
        elif cur is not None:
            runs.append(tuple(float(v) for v in cur))
            cur = None
    if cur is not None:
        runs.append(tuple(float(v) for v in cur))
    return runs


def _normalise_part(team_id, name, ob):
    """Turn, scale and seat `ob` in its kind's canonical frame (see the
    section comment) and record what the placers need in `_PART_INFO`."""
    spec = PART_SPECS[name]
    co = _coords(ob)
    co = co - co.mean(axis=0)
    if spec["kind"] == "rifle":
        # Meshy delivers a "lying flat, level" rifle in its profile plane:
        # the long axis on X, up on +Z (both 5 Oct rifles, measured: X span
        # 1.89-1.90, Y 0.10-0.20, the magazine and grips toward -Z). No PCA:
        # a slack sling or a tall stock tilts the principal axis (tried --
        # the carbine came out 9 degrees nose-up and upside down). So only
        # the muzzle end is decided here, and `cut` drops what hangs loose.
        if spec.get("cut"):
            spec["cut"](team_id, name, ob, co)
            co = _coords(ob)
            co = co - co.mean(axis=0)
        x0, x1 = co[:, 0].min(), co[:, 0].max()
        end = RIFLE_END_F * (x1 - x0)
        h_lo = np.ptp(co[co[:, 0] < x0 + end][:, 2])
        h_hi = np.ptp(co[co[:, 0] > x1 - end][:, 2])
        butt, muzzle = max(h_lo, h_hi), min(h_lo, h_hi)
        if butt < RIFLE_BUTT_RATIO * muzzle:
            raise SystemExit(f"{team_id}: {name}: cannot tell the butt from the muzzle -- end heights "
                             f"{h_lo:.3f} / {h_hi:.3f} source units, ratio under {RIFLE_BUTT_RATIO}. Look at it.")
        if h_hi > h_lo:                                # butt at +x: turn 180 about z
            co = co * np.array((-1.0, -1.0, 1.0))
        scale = spec["length_m"] / float(np.ptp(co[:, 0]))
        co = co * scale
        co[:, 0] -= (co[:, 0].min() + co[:, 0].max()) / 2.0
        co[:, 1] -= (co[:, 1].min() + co[:, 1].max()) / 2.0
        co[:, 2] -= _body_centreline(co)
        _apply_np(ob, co)
        _PART_INFO[name] = dict(kind="rifle", length=spec["length_m"])
        log(f"{team_id}: {name}: rifle, scale {scale:.4f}, butt/muzzle end heights {butt:.3f}/{muzzle:.3f} "
            f"(x{butt / muzzle:.1f}); "
            f"x {co[:, 0].min():+.3f}..{co[:, 0].max():+.3f} y {co[:, 1].min():+.3f}..{co[:, 1].max():+.3f} "
            f"z {co[:, 2].min():+.3f}..{co[:, 2].max():+.3f} m")
        return
    if spec["kind"] == "mounted":
        _normalise_mounted(team_id, name, ob, spec)
        return
    # launcher: turned muzzle +X (`src_muzzle` -1: the part arrives with it at
    # -X), scaled, x = 0 at the rear, and the bore put on the X axis from the
    # plain-tube band `bore_band` (fractions of the length from the rear).
    co = _coords(ob)
    if spec.get("src_roll"):
        # A part delivered lying on its side: +90 about x takes its -y
        # (where the grips hang) to -z.
        co = co @ np.array(Matrix.Rotation(math.radians(spec["src_roll"]), 3, "X")).T
    if spec.get("src_muzzle", 1) < 0:
        co = co * np.array((-1.0, -1.0, 1.0))      # 180 degrees about z
    scale = spec["length_m"] / float(np.ptp(co[:, 0]))
    co = co * scale
    co[:, 0] -= co[:, 0].min()
    L = spec["length_m"]
    b0, b1 = spec.get("bore_band", LAUNCH_BORE_BAND)
    band = co[(co[:, 0] > b0 * L) & (co[:, 0] < b1 * L)]
    by, bz = (band[:, 1].min() + band[:, 1].max()) / 2.0, (band[:, 2].min() + band[:, 2].max()) / 2.0
    co[:, 1] -= by
    co[:, 2] -= bz
    band = co[(co[:, 0] > b0 * L) & (co[:, 0] < b1 * L)]
    r = float(np.median(np.sqrt(band[:, 1] ** 2 + band[:, 2] ** 2)))
    top = co[co[:, 2] > r + LAUNCH_SIGHT_ABOVE]
    mirrored = False
    want = -1.0 if spec.get("optic_inboard", True) else 1.0
    if len(top) and float(top[:, 1].mean()) * want < 0.0:
        co[:, 1] *= -1.0
        mirrored = True
    _apply_np(ob, co)
    if mirrored:
        _reverse_winding(ob)
    if spec.get("cut"):
        spec["cut"](team_id, name, ob, r)
        co = _coords(ob)
        if spec.get("length_after_cut", True) and abs(np.ptp(co[:, 0]) - L) > 1e-4:
            # The shipped length is the spec's, measured after the cut.
            k = L / float(np.ptp(co[:, 0]))
            co[:, 0] -= co[:, 0].min()
            co = co * k
            r *= k
            _apply_np(ob, co)
            log(f"{team_id}: {name}: rescaled x{k:.4f} after the cut to ship at {L} m (bore r {r:.3f})")
    samples = _surface_samples(ob)
    info = dict(kind="launcher", length=L, r=r, samples=samples, scale=scale)
    msg = ""
    if "grip_run" in spec:
        runs = _down_runs(co, r, GRIP_BELOW)
        def underside(u):
            under = samples[(np.abs(samples[:, 0] - u) < 0.03) & (np.abs(samples[:, 1]) < 0.03)]
            return float(under[:, 2].min())
        if "grip_at" in spec:
            # No pistol grip on the part (or none that survives its cut): the
            # firing hand closes on the tube's underside at `grip_at` of L.
            u = spec["grip_at"] * L
            runs = list(runs) + [(u - 0.01, u + 0.01, underside(u) - 0.01)]
            spec = dict(spec, grip_run=len(runs) - 1)
        if spec["grip_run"] == "deepest":
            # The pistol grip is the run that hangs furthest (a strap stub or
            # a sight bracket hangs less).
            spec = dict(spec, grip_run=int(np.argmin([z for _a, _b, z in runs])))
        if "support_ahead" in spec:
            # No forward grip on the part: the support hand's handle hangs
            # from the tube's own underside, `support_ahead` past the grip.
            g = runs[spec["grip_run"]]
            u = (g[0] + g[1]) / 2.0 + spec["support_ahead"]
            runs = list(runs) + [(u - 0.01, u + 0.01, underside(u) - 0.01)]
            spec = dict(spec, support_run=len(runs) - 1)
        if len(runs) <= max(spec["grip_run"], spec["support_run"]):
            raise SystemExit(f"{team_id}: {name}: {len(runs)} hanging run(s) {runs} -- no grip/support to name")
        for key in ("grip", "support"):
            x0, x1, zmin = runs[spec[f"{key}_run"]]
            synthetic = (key == "support" and "support_ahead" in spec) or (key == "grip" and "grip_at" in spec)
            if synthetic:
                t = np.array(((x0 + x1) / 2.0, 0.0, zmin + 0.005))
            else:
                # The grip's own geometry: the mean of the part's surface
                # under the bore in the run's window (a slanted pistol grip's
                # middle is not under the window's centre).
                g = samples[(samples[:, 0] > x0 - 0.03) & (samples[:, 0] < x1 + 0.03) & (samples[:, 2] < -r - 0.02)]
                t = g.mean(axis=0)
            near = float(np.sqrt(((samples - t) ** 2).sum(axis=1)).min())
            if near > PART_GRIP_REACH:
                raise SystemExit(f"{team_id}: {name}: the {key} hand target {tuple(round(v, 3) for v in t)} is "
                                 f"{near:.3f} m from the part (limit {PART_GRIP_REACH}) -- it would close on air")
            info[key] = t
        info["support_bottom"] = runs[spec["support_run"]][2] + (0.015 if "support_ahead" in spec else 0.01)
        msg = (f"; hanging runs {[(round(a, 3), round(b, 3), round(z, 3)) for a, b, z in runs]}; grip "
               f"{tuple(round(float(v), 3) for v in info['grip'])}, support {tuple(round(float(v), 3) for v in info['support'])}")
    info["samples"] = _surface_samples(ob, step=spec.get("seat_sample_step", 0.01))
    _PART_INFO[name] = info
    log(f"{team_id}: {name}: launcher, scale {scale:.4f}, {L} m, bore r {r:.3f}, bore moved ({by:+.3f}, {bz:+.3f}), "
        f"optic {'mirrored' if mirrored else 'kept'} to the {'inboard -y' if want < 0 else 'outboard +y'}; "
        f"x {co[:, 0].min():+.3f}..{co[:, 0].max():+.3f} y {co[:, 1].min():+.3f}..{co[:, 1].max():+.3f} "
        f"z {co[:, 2].min():+.3f}..{co[:, 2].max():+.3f}{msg}; {len(samples)} surface samples")


def _cut_faces(team_id, name, ob, keep_fn, why, drop_idx=None):
    """Delete every face whose centroid `keep_fn` rejects, or (`drop_idx`)
    whose index is listed."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    if drop_idx is not None:
        dead = [bm.faces[i] for i in sorted(drop_idx)]
    else:
        dead = [f for f in bm.faces if not keep_fn(np.array(tuple(f.calc_center_median())))]
    bmesh.ops.delete(bm, geom=dead, context="FACES")
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    log(f"{team_id}: {name}: {len(dead)} face(s) cut -- {why}")
    if not dead:
        raise SystemExit(f"{team_id}: {name}: the cut ({why}) found nothing -- the part changed; look at it")


def _cut_carbine_sling(team_id, name, ob, _co):
    """The carbine came with its padded sling hanging in a loose loop off the
    stock, baked a saturated orange (the prompt's "tan" read as safety
    orange) -- at 25 px an orange ring beside the butt, a colour the bible
    keeps for markers. In the SOURCE frame (measured: the rifle stands in
    y +0.03..+0.18 with its stock at +X), the loop is everything at
    y < CARBINE_SLING_Y, plus whatever hangs under the stock's own bottom."""
    _cut_faces(team_id, name, ob,
               lambda c: not (c[1] < CARBINE_SLING_Y or (c[0] > CARBINE_STOCK_X and c[2] < CARBINE_STOCK_BOTTOM)),
               f"the slack sling (y < {CARBINE_SLING_Y}, or x > {CARBINE_STOCK_X} under z {CARBINE_STOCK_BOTTOM})")


def _part_colour_hsv(ob, img_name, px=512):
    """(n_faces, 3) HSV of the part's own bake at each face's UV centroid,
    read off a `px` copy of the image (the 8k bake itself is ~1 GB as floats)."""
    import colorsys
    img = bpy.data.images[img_name]
    pix = _scaled_pixels(img, px, px)
    uv = ob.data.uv_layers.active.data
    out = []
    for poly in ob.data.polygons:
        u, v = np.mean([uv[i].uv[:] for i in poly.loop_indices], axis=0)
        x, y = int((u % 1.0) * (px - 1)), int((v % 1.0) * (px - 1))
        out.append(colorsys.rgb_to_hsv(*[float(c) for c in pix[y, x, :3]]))
    return np.array(out)


def _cap_front(team_id, name, ob, x_cut, L, z_above=None):
    """Cut away everything past x = `x_cut` (only faces whose centroid is above
    `z_above`, when given: a tube over a tripod whose legs reach as far) and
    cap the hole with flat face(s) facing +X, textured with one uv from the
    tube just behind the cut."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    faces = [f for f in bm.faces if z_above is None or f.calc_center_median().z > z_above]
    verts = list({v for f in faces for v in f.verts})
    edges = list({e for f in faces for e in f.edges})
    res = bmesh.ops.bisect_plane(bm, geom=verts + edges + faces, plane_co=(x_cut, 0.0, 0.0),
                                 plane_no=(1.0, 0.0, 0.0), clear_outer=True)
    cut_edges = [e for e in res["geom_cut"] if isinstance(e, bmesh.types.BMEdge) and e.is_valid]
    filled = bmesh.ops.holes_fill(bm, edges=cut_edges, sides=0)["faces"]
    uv_layer = bm.loops.layers.uv.active
    near = [f for f in bm.faces if f not in filled and abs(f.calc_center_median().x - x_cut) < 0.05
            and (z_above is None or f.calc_center_median().z > z_above)]
    cap_uv = near[0].loops[0][uv_layer].uv.copy() if near else None
    for f in filled:
        f.normal_update()
        if f.normal.x < 0:
            f.normal_flip()
        if cap_uv is not None:
            for l in f.loops:
                l[uv_layer].uv = cap_uv
    kept = len(bm.faces)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    log(f"{team_id}: {name}: nose cut at x {x_cut:.3f} of {L:.3f} (the tube's front end), "
        f"{len(filled)} cap face(s) over the hole; {kept} faces kept")
    if not filled:
        raise SystemExit(f"{team_id}: {name}: the nose cut left an open hole -- nothing capped")


def _cut_manpad(team_id, name, ob, r):
    """Two cuts, both the lead's (5 Oct) or the bible's:
      * the pointed MISSILE NOSE: everything past the tube's own front end is
        deleted and the hole capped with one flat face -- a launcher carries
        a flat front cap, and end-on a cone reads as a rocket. The tube's end
        is the rearmost slice, scanning back from the tip, at full bore
        (MANPAD_FULL_BORE of r) -- the white band where the cone starts;
      * the STRAP that hangs off the tube: faces further than r + MANPAD_HANG
        from the bore whose bake is the strap's saturated orange (hue
        MANPAD_STRAP_HUE, saturation > MANPAD_STRAP_SAT) -- where it wraps
        the tube it stays."""
    co = _coords(ob)
    L = float(co[:, 0].max())
    sl = _slices(co, 60)
    rad = np.maximum(np.abs(sl[:, 2:4]).max(axis=1), np.abs(sl[:, 4:6]).max(axis=1))
    x_cut = None
    for row, rr in zip(sl[::-1], rad[::-1]):
        if row[1] < 0.6 * L:
            break
        if rr >= MANPAD_FULL_BORE * r:
            x_cut = float(row[1])
            break
    if x_cut is None:
        raise SystemExit(f"{team_id}: {name}: no full-bore slice in the front 40 % -- the nose cut found no tube end")
    _cap_front(team_id, name, ob, x_cut, L)
    hsv = _part_colour_hsv(ob, f"part_color_{name}")
    cent = np.array([tuple(p.center) for p in ob.data.polygons])
    radial = np.sqrt(cent[:, 1] ** 2 + cent[:, 2] ** 2)
    h0, h1 = MANPAD_STRAP_HUE
    strap = (radial > r + MANPAD_HANG) & (hsv[:, 1] > MANPAD_STRAP_SAT) & (hsv[:, 0] * 360.0 >= h0) & (hsv[:, 0] * 360.0 <= h1)
    idx = set(int(i) for i in np.nonzero(strap)[0])
    _cut_faces(team_id, name, ob, None, drop_idx=idx, why=f"the hanging strap ({len(idx)} orange faces more than {MANPAD_HANG} m off the tube)")


def _split_recoilless(team_id, name, ob):
    """The recoilless preview stands on a DIRT PATCH with tufts of grass ("no
    ground, no base" notwithstanding), and the remesh welded patch, tube and
    rounds into ONE island. The patch is the faces within RCL_BASE_DZ of the
    lowest point (source units); with it gone the model falls apart by
    connectivity into the tube, the two spare rounds (one island) and the
    tufts (singletons). The tube is returned and goes on as the part; the
    rounds go to `_HAND["recoilless_rounds"]` for `recoilless_team` to lay
    beside the loader; the tufts are dropped."""
    co = _coords(ob)
    zmin = float(co[:, 2].min())
    _cut_faces(team_id, name, ob, lambda c: c[2] >= zmin + RCL_BASE_DZ,
               f"the dirt patch (centroids within {RCL_BASE_DZ} of the lowest point)")
    pieces = _separate_islands(ob)
    tube = pieces[0]
    rounds = [p for p in pieces[1:] if len(p.data.polygons) >= RCL_ROUNDS_MIN_FACES]
    if len(rounds) != 1:
        raise SystemExit(f"{team_id}: {name}: expected the rounds as one island of >= {RCL_ROUNDS_MIN_FACES} faces, "
                         f"found {[len(p.data.polygons) for p in pieces[1:]]}")
    for p in pieces[1:]:
        if p is not rounds[0]:
            bpy.data.objects.remove(p, do_unlink=True)
    log(f"{team_id}: {name}: tube {len(tube.data.polygons)} faces, rounds {len(rounds[0].data.polygons)}, "
        f"{len(pieces) - 2} tuft island(s) dropped")
    rounds[0].name = rounds[0].data.name = "part_recoilless_rounds"
    _HAND_EXTRA["recoilless_rounds"] = rounds[0]
    tube.name = tube.data.name = f"part_{name}"
    return tube


def _cut_recoilless_leg(team_id, name, ob, r):
    """The recoilless preview stands its barrel on a folding front leg; on a
    shouldered tube at 25 px a leg hanging off the muzzle half reads as a
    second barrel. Everything in the front half more than RCL_LEG_BELOW under
    the bore goes."""
    L = PART_SPECS[name]["length_m"]
    _cut_faces(team_id, name, ob, lambda c: not (c[0] > 0.55 * L and c[2] < -RCL_LEG_BELOW),
               f"the front leg (x > 0.55 of the length, more than {RCL_LEG_BELOW} m under the bore)")
    # The leg's REMNANT: the cut above stops at RCL_LEG_BELOW under the bore,
    # but the bore band (0.60-0.85 of L) itself takes in the leg's bracket, so
    # the "bore" centre sits under the real barrel and a bracket and a spike
    # 0.1 m long survived under it (photographed, 5 Oct review). The barrel's
    # own bottom is measured at the muzzle end, where no leg ever hung, and
    # everything forward of RCL_REMNANT_X under it goes.
    co = _coords(ob)
    muzzle = co[co[:, 0] > RCL_BARREL_REF_F * float(co[:, 0].max())]
    floor = float(muzzle[:, 2].min()) - RCL_REMNANT_SLACK
    # By its LOWEST vertex, not its centroid: the remnant's barb is long thin
    # triangles whose centroids sit at the barrel's own height (a centroid
    # cut left it, photographed).
    co = _coords(ob)
    idx = set()
    for poly in ob.data.polygons:
        v = co[list(poly.vertices)]
        if float(v[:, 0].mean()) > RCL_REMNANT_X * L and float(v[:, 2].min()) < floor:
            idx.add(poly.index)
    _cut_faces(team_id, name, ob, None, drop_idx=idx,
               why=f"the leg's remnant (x > {RCL_REMNANT_X} of the length, a vertex under the barrel's own "
                   f"bottom {floor + RCL_REMNANT_SLACK:+.3f} - {RCL_REMNANT_SLACK} m, read at the muzzle end)")


def _cut_spike_bipod(team_id, name, ob, r):
    """The Spike preview came with its front bipod EXTENDED (the prompt asked
    for it folded); at 25 px two splayed legs under the canister read as a
    second barrel. Every face below the canister's bottom, by more than
    SPIKE_BIPOD_BELOW, in the bipod's window along the length, goes."""
    L = PART_SPECS[name]["length_m"]
    x0, x1 = SPIKE_BIPOD_WINDOW
    _cut_faces(team_id, name, ob,
               lambda c: not (x0 * L <= c[0] <= x1 * L and c[2] < -(r + SPIKE_BIPOD_BELOW)),
               f"the extended bipod (x {x0}-{x1} of the length, more than {SPIKE_BIPOD_BELOW} m under the bore)")


def _carbine_over_baked(name, baked):
    """A copy of the canonical rifle laid where a preview's BAKED carbine was
    (breach_team, WEAPON_ON_SPINE): centred on the baked piece's centroid,
    along its principal axis, muzzle toward the THINNER end (a barrel against
    a stock and receiver), its top turned toward the wearer's chest and up
    (the magazine forward and down, as a carbine is carried across the chest)
    and scaled by nothing but its own real length."""
    co = _coords(baked)
    c = co.mean(axis=0)
    _ev, vec = np.linalg.eigh((co - c).T @ (co - c))
    ax = vec[:, 2]
    t = (co - c) @ ax
    lo, hi = t.min(), t.max()
    end = 0.15 * (hi - lo)

    def girth(m):
        q = (co[m] - c) - np.outer(t[m], ax)
        return float(np.linalg.norm(q, axis=1).max())
    if girth(t > hi - end) > girth(t < lo + end):
        ax = -ax                                        # the thinner end is the muzzle
    up = np.array((-1.0, 0.0, 1.0)) / math.sqrt(2.0)
    zc = up - ax * float(up @ ax)
    zc /= np.linalg.norm(zc)
    yc = np.cross(zc, ax)
    M = Matrix(((ax[0], yc[0], zc[0], c[0]), (ax[1], yc[1], zc[1], c[1]),
                (ax[2], yc[2], zc[2], c[2]), (0.0, 0.0, 0.0, 1.0)))
    ob = _part_copy(name, baked.name.replace("_carbine", "_w_carbine"))
    _transform(ob, M)
    log(f"{baked.name}: baked carbine ({hi - lo:.3f} m along its axis, {len(baked.data.polygons)} faces) "
        f"replaced by {name}, muzzle {tuple(round(float(v), 2) for v in ax)}")
    _part_extent_log(ob)
    return ob


def _normalise_mounted(team_id, name, ob, spec):
    """A crew weapon that stands on the ground (atgm_post): muzzle +X, scaled
    so its TUBE (the top `tube_band_f` of its height -- the tube and its
    sight, above the tripod) is `tube_m` long, the centre of its feet on
    (0, 0), the feet on z = 0; then its pointed front cut back to the tube's
    own end and capped flat (`_cap_front`, legs untouched)."""
    co = _coords(ob)
    if spec.get("src_muzzle", 1) < 0:
        co = co * np.array((-1.0, -1.0, 1.0))
    zt, zb = co[:, 2].max(), co[:, 2].min()
    tube = co[co[:, 2] > zt - spec["tube_band_f"] * (zt - zb)]
    scale = spec["tube_m"] / float(np.ptp(tube[:, 0]))
    co = co * scale
    z0 = co[:, 2].min()
    feet = co[co[:, 2] < z0 + MOUNTED_FEET_DZ]
    co = co - np.array((feet[:, 0].mean(), feet[:, 1].mean(), z0))
    _apply_np(ob, co)
    zt = co[:, 2].max()
    band_lo = zt - spec["tube_band_f"] * zt
    tube = co[co[:, 2] > band_lo]
    x0, x1 = tube[:, 0].min(), tube[:, 0].max()
    mid = tube[(tube[:, 0] > x0 + 0.3 * (x1 - x0)) & (tube[:, 0] < x0 + 0.6 * (x1 - x0))]
    ay, az = np.median(mid[:, 1]), (mid[:, 2].min() + mid[:, 2].max()) / 2.0
    # The tube's radius is the 90th percentile of the middle band's radial
    # reach (the median is dragged in by the low-poly tube's own facets).
    r = float(np.percentile(np.sqrt((mid[:, 1] - ay) ** 2 + (mid[:, 2] - az) ** 2), 90))
    x_cut = None
    n = 40
    for k in range(n - 1, n // 2, -1):
        a, b = x0 + (x1 - x0) * k / n, x0 + (x1 - x0) * (k + 1) / n
        sl = tube[(tube[:, 0] >= a) & (tube[:, 0] <= b)]
        if len(sl) and float(np.sqrt((sl[:, 1] - ay) ** 2 + (sl[:, 2] - az) ** 2).max()) >= MANPAD_FULL_BORE * r:
            x_cut = float(b)
            break
    if x_cut is None:
        raise SystemExit(f"{team_id}: {name}: no full-bore slice in the tube's front half -- no tube end to cap")
    _cap_front(team_id, name, ob, x_cut, float(x1), z_above=az - r - MOUNTED_CAP_BELOW)
    # `tube_m` is the tube WITH its rounded front, as the prompt sized it:
    # rescaling to 1.2 m after the cut was tried and stood the post 1.14 m
    # tall with its legs 1.3 m across (the prompt's 0.7 m post, the kit's
    # 0.74 m tube height), 80 samples inside the crew at kit's anchor.
    co = _coords(ob)
    _PART_INFO[name] = dict(kind="mounted", tube_m=spec["tube_m"], axis_z=az, r=r)
    log(f"{team_id}: {name}: mounted, scale {scale:.4f}, tube {spec['tube_m']} m at z {az:.3f} (r {r:.3f}), "
        f"x {co[:, 0].min():+.3f}..{co[:, 0].max():+.3f} y {co[:, 1].min():+.3f}..{co[:, 1].max():+.3f} "
        f"z {co[:, 2].min():+.3f}..{co[:, 2].max():+.3f} m (feet centred on the origin)")


def _part_copy(name, new_name):
    src = _HAND[name]
    ob = src.copy()
    ob.data = src.data.copy()
    bpy.context.scene.collection.objects.link(ob)
    ob.name = ob.data.name = new_name
    ob["rl_role"] = "weapon"
    return ob


def _rifle_frame(prefix, joints, dx, dy):
    """(kit anchor, yaw): the frame `_rifle_at_hand` puts the kit rifle in."""
    a = joints["arm"][1]
    elbow, wrist = Vector(a["elbow"]), Vector(a["wrist"])
    hand = wrist + (wrist - elbow).normalized() * HAND_REACH
    yaw = math.radians(RIFLE_YAW_DEG)
    c, s = math.cos(yaw), math.sin(yaw)
    gx, gy, gz = hand.x - (-0.03 * c), hand.y - (-0.03 * s), hand.z + 0.065
    reach, z_kit = 0.16, kit.POSTURE_EYE["standing"] * kit.FIGURE_H - 0.16
    at = (gx - reach * c + dx, gy - reach * s + dy, gz - z_kit)
    return at, yaw


def _hand_rifle(prefix, joints, dx, dy):
    """The rifle at this figure's hand: the team's Meshy rifle part if it has
    one (`HAND_PARTS`), else kit's seven boxes (`_rifle_at_hand`)."""
    rifles = [n for n in HAND_PARTS.get(_TEAM["id"], ()) if PART_SPECS[n]["kind"] == "rifle"]
    if rifles:
        return _rifle_part_at_hand(rifles[0], prefix, joints, dx, dy)
    return _rifle_at_hand(prefix, joints, dx, dy)


def _rifle_part_at_hand(name, prefix, joints, dx, dy):
    """A copy of the canonical Meshy rifle in place of `rig._weapon_parts`'
    seven boxes: the same anchor and yaw `_rifle_at_hand` solves, its length
    centred on the kit span's centre. Returns [object]."""
    at, yaw = _rifle_frame(prefix, joints, dx, dy)
    g = Vector(rig._weapon_anchor(at, yaw, "standing", False))
    u_c = (KIT_RIFLE_SPAN[0] + KIT_RIFLE_SPAN[1]) / 2.0
    ob = _part_copy(name, f"{prefix}_w_rifle")
    _transform(ob, Matrix.Translation(g) @ Matrix.Rotation(yaw, 4, "Z") @ Matrix.Translation((u_c, 0.0, 0.0)))
    _part_extent_log(ob)
    return [ob]


# ---------------------------------------------------------------------------
# teams
# ---------------------------------------------------------------------------

def _figure(src, height, spec, kneel):
    """Parts + bones + forced binds for one TEAM_FIGURES spec, placed at its
    anchor. `kneel` builds the deployed kneel AND (per design D6) a standing
    walker with the `{prefix}w` prefix."""
    prefix, x, y = spec["prefix"], spec["x"], spec["y"]
    forced = {}
    if not kneel:
        parts, joints = cut_figure(src, height, prefix)
        if spec["weapon"] == "rifle":
            # A launcher's arms are re-seated on its grips by `_seat_launcher`
            # instead, from the hanging rest.
            _bend_forearms(parts, joints, prefix)
        bones = standing_bones(prefix, joints, x, y)
        _place(parts, x, y)
        eye_z = FACE_LO_F * height + 0.03
    else:
        parts, joints = cut_figure(src, height, prefix)
        kbones, eye_z = _kneel(parts, joints, prefix)
        bones = rig._translate(kbones, x, y, prefix)
        _place(parts, x, y)
        wp = rig._walker_prefix(spec)
        wparts, wjoints = cut_figure(src, height, wp)
        bones += standing_bones(wp, wjoints, x, y)
        _place(wparts, x, y)
        ratio = WALKER_DECIMATE_BY_TEAM.get(_TEAM["id"])
        if ratio is not None:
            before = after = 0
            for wob in wparts.values():
                if wob.get("rl_role") != "uniform":
                    continue
                before += len(wob.data.polygons)
                mod = wob.modifiers.new("dec", type="DECIMATE")
                mod.decimate_type = "COLLAPSE"
                mod.ratio = ratio
                bpy.context.view_layer.objects.active = wob
                bpy.ops.object.modifier_apply(modifier=mod.name)
                after += len(wob.data.polygons)
            log(f"{wp}: walker uniform decimated x{ratio}: {before} -> {after} polys")
        parts.update({f"w_{k}": v for k, v in wparts.items()})
    if "carbine" in parts:
        forced[parts["carbine"]] = f"{prefix}_spine"   # WEAPON_ON_SPINE
        log(f"{prefix}: baked carbine kept as `weapon` on spine, {len(parts['carbine'].data.polygons)} faces")
    out = list(parts.values())
    if spec.get("work_posture") == "kneeling":
        # B7 (yahalom_squad): a third body, kneeling, shown in `work` alone --
        # the same cut on a kneel, its own mast pitched from its right hand
        # into the ground on `{kp}_forearm_R`, its pack on `{kp}_spine`.
        kp = rig._kneeler_prefix(spec)
        kparts, kjoints = cut_figure(src, height, kp)
        kbones, _eye = _kneel(kparts, kjoints, kp)
        bones += rig._translate(kbones, x, y, kp)
        _place(kparts, x, y)
        out += list(kparts.values())
        wr = Vector(kjoints["arm"][1]["wrist"]) + Vector((x, y, -kjoints["drop"]))
        ground = Vector((wr.x + 0.85, wr.y, 0.0))
        d = ground - wr
        length = d.length + 0.25
        pitch = math.atan2(d.z, math.hypot(d.x, d.y))
        mid = wr + d.normalized() * (length * 0.5 - 0.15)
        mast = kit.tube(f"{kp}_mast", length, 0.030, tuple(mid), yaw=math.atan2(d.y, d.x), pitch=pitch, role="metal")
        pack, _in = _pack_behind(f"{kp}_pack", kp, kparts, kneel=True)
        forced[mast] = f"{kp}_forearm_R"
        forced[pack] = f"{kp}_spine"
        out += [mast, pack]
        log(f"{prefix}: work kneeler {kp}, mast {length:.2f} m from hand {tuple(round(v, 2) for v in wr)} "
            f"at {math.degrees(pitch):.0f} deg")
    dy_death = CORPSE_Y_OFFSET.get(_TEAM["id"], {}).get(prefix, 0.0)
    death = _death_parts_posed(src, height, prefix, x, y + dy_death, add_kef=ADD_KEFFIYEH[_TEAM["id"]])
    death_bone = rig._death_root_bone(prefix, x, y + dy_death)
    bones.append(death_bone)
    for ob in death:
        forced[ob] = death_bone[0]
    out += death
    return out, bones, forced, eye_z, joints


def build_team(team_id):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _TEX["material"] = None
    _TEX.pop("atlas", None)
    _TEAM["id"] = team_id
    _BLOB_KW_ACTIVE.clear()
    _BLOB_KW_ACTIVE.update(BLOB_KW.get(team_id, {}))
    src, height = _load_figure(team_id)
    part_src = None
    slots = []
    if team_id in MESHY_PARTS:
        # B8: the Meshy crew weapon, before the cut so every figure uv (and
        # every blob that borrows one) lands in the atlas's left half.
        part_src, part_img = _load_part(team_id)
        slots.append((part_src, part_img))
    # A3.1 stage 2: the hand-weapon parts, into the same atlas (one slot each,
    # after B8's) and then turned into their canonical frame.
    hand = {}
    for name in HAND_PARTS.get(team_id, ()):
        ob, img = _load_hand_part(team_id, name)
        slots.append((ob, img))
        hand[name] = ob
    for name, ob in hand.items():
        _normalise_part(team_id, name, ob)   # before the atlas: a cut may read the part's own bake
    if slots:
        _compose_atlas(team_id, src, slots)
    for extra in _HAND_EXTRA.values():
        # A piece split off a part shares that part's slot: same uv mapping.
        n = 1 + len(slots)
        k = 1 + [o for o, _i in slots].index(hand["recoilless_rifle"])
        _remap_u(extra, k / n, (k + 1) / n)
        extra.data.materials.clear()
        extra.data.materials.append(_TEX["material"])
    _HAND.clear()
    _HAND.update(hand)
    if team_id != "recoilless_team":
        _HAND_EXTRA.clear()
    figures = rig.TEAM_FIGURES[team_id]
    parts, bones, forced = [], [], {}
    eyes, hands = {}, {}
    prone_heads = {}
    for spec in figures:
        if team_id == "sniper_team":
            p, b, f, eye_z, j, head_c = _sniper_figure(src, height, spec)
            prone_heads[spec["prefix"]] = head_c
        else:
            p, b, f, eye_z, j = _figure(src, height, spec, kneel=(spec["posture"] == "kneeling"))
        parts += p
        bones += b
        forced.update(f)
        eyes[spec["prefix"]] = eye_z
        hands[spec["prefix"]] = j
    if ADD_KEFFIYEH[team_id]:
        # Crown over every LIVING head this team draws (deployed, walker) --
        # the corpse got its own inside `_death_parts_posed`, before it fell.
        for ob in list(parts):
            if ob.name.endswith("_cranium") and not ob.name.endswith("_death_cranium"):
                parts += _kit_keffiyeh_over(parts, ob.name[: -len("_cranium")], src)
    launcher = []
    if team_id in LAUNCHERS:
        # The shouldered launcher, seated on its gunner's own measured body
        # BEFORE any other weapon exists (see `_seat_launcher`).
        gunner = next(s for s in figures if s["prefix"] == LAUNCHERS[team_id]["prefix"])
        launcher = _seat_launcher(team_id, gunner, parts, bones, hands[gunner["prefix"]],
                                  hands[gunner["prefix"]].get("drop", 0.0))
    src_fig = src if team_id == "sniper_team" else None   # the prone rifle borrows its bake below
    if src_fig is None:
        bpy.data.objects.remove(src, do_unlink=True)

    # Crew weapons -- kit geometry; positions from teams.py except the three
    # shouldered launchers, seated above.
    if team_id == "manpad_team":
        tube = launcher
        binos = kit.binoculars("mpd_binos", (-0.28, 0.30, eyes["mpd_spot"] - kit.POSTURE_EYE["standing"] * kit.FIGURE_H - 0.04),
                               posture="standing")
        forced.update({ob: "mpd_fire_forearm_R" for ob in tube})
        forced.update({ob: "mpd_spot_head" for ob in binos})
        parts += tube + binos
    elif team_id == "recoilless_team":
        tube = launcher
        if "recoilless_rounds" in _HAND_EXTRA:
            # A3.1: the preview's own two spare rounds (one island), at the
            # tube's own scale, long axis along y like kit's, on the ground
            # where kit's pair lay.
            rounds_ob = _HAND_EXTRA.pop("recoilless_rounds")
            co = _coords(rounds_ob) * _PART_INFO["recoilless_rifle"]["scale"]
            co = co - co.mean(axis=0)
            _apply_np(rounds_ob, co)
            _transform(rounds_ob, Matrix.Rotation(math.radians(_long_axis_yaw(co) + 90.0), 4, "Z"))
            rounds = [_seat_on_ground(rounds_ob, "rcl_rounds", "weapon", -0.10, 0.53)]
        else:
            rounds = [
                kit.tube("rcl_round0", 0.52, 0.075, (-0.10, 0.46, 0.075), yaw=math.radians(90.0)),
                kit.tube("rcl_round1", 0.52, 0.075, (-0.10, 0.60, 0.075), yaw=math.radians(90.0)),
            ]
        bones.append(rig._prop_bone((-0.10, 0.53, 0.0), 0.30))
        forced.update({ob: "rcl_fire_forearm_R" for ob in tube})
        forced.update({ob: "prop" for ob in rounds})
        parts += tube + rounds
    elif team_id == "militia_cell":
        # Two riflemen, grip on each man's own bent right hand (`_rifle_at_hand`).
        for spec in figures:
            w = _hand_rifle(spec["prefix"], hands[spec["prefix"]], spec["x"], spec["y"])
            forced.update({ob: f"{spec['prefix']}_forearm_R" for ob in w})
            parts += w
    elif team_id == "rpg_team":
        # The RPG seated on rpg_fire's shoulder (teams.py's 38 deg, see
        # LAUNCHERS) on his forearm_R; the loader's rifle at his hand.
        tube = launcher
        forced.update({ob: "rpg_fire_forearm_R" for ob in tube})
        parts += tube
        w = _hand_rifle("rpg_load", hands["rpg_load"], -0.30, 0.30)
        forced.update({ob: "rpg_load_forearm_R" for ob in w})
        parts += w
    elif team_id == "atgm_cell":
        # The tripod post verbatim from `rig._atgm_extras`, on the static
        # `prop` bone -- hidden while the crew walks (`_key_death_visibility`).
        post, prop_bones, f_post = rig._atgm_extras()
        bones += prop_bones
        if "atgm_post" in _HAND:
            # A3.1: the Meshy post in kit's place -- its feet's centre on the
            # same anchor, on the same `prop` bone, one `weapon` mesh -- and
            # clear of both crewmen at rest (the mortar's rule), or refused.
            for ob in post:
                bpy.data.objects.remove(ob, do_unlink=True)
            ob = _part_copy("atgm_post", "atgm_post")
            crew = [o for o in parts if "_death" not in o.name and o.get("rl_role") not in ("weapon", "metal")
                    and not any(o.name.startswith(s["prefix"] + "_") for s in rig._walker_specs(figures))]
            # Kit's anchor first; if the Meshy legs (wider than kit's) reach a
            # crewman, the nearest clear anchor forward of it, measured.
            tried = []
            for dx in ATGM_ANCHOR_SLIDE:
                at = (ATGM_ANCHOR[0] + dx, ATGM_ANCHOR[1], 0.0)
                _transform(ob, Matrix.Translation(at))
                inside = _inside_count([ob], crew)
                tried.append((dx, inside))
                if not inside:
                    break
                _transform(ob, Matrix.Translation(tuple(-c for c in at)))
            log(f"atgm_cell: post samples inside the crew by anchor x offset from kit's {ATGM_ANCHOR}: "
                f"{' '.join(f'{d:+.2f}:{n}' for d, n in tried)}")
            if tried[-1][1]:
                raise SystemExit(f"atgm_cell: {tried[-1][1]} post samples inside a crewman at every anchor tried -- "
                                 f"move the mount, do not ship it")
            # The census here is the crew at REST; in `idle` they breathe and
            # sway, and the exported GLB read 6 samples inside at the first
            # clear offset (+0.08, `launcher_clearance.test.ts`). So the mount
            # goes ATGM_SWAY_MARGIN further on.
            _transform(ob, Matrix.Translation((ATGM_SWAY_MARGIN, 0.0, 0.0)))
            log(f"atgm_cell: post anchor x {ATGM_ANCHOR[0] + tried[-1][0] + ATGM_SWAY_MARGIN:+.2f} "
                f"(first clear {tried[-1][0]:+.2f} + sway margin {ATGM_SWAY_MARGIN}); samples inside at rest "
                f"{_inside_count([ob], crew)}")
            _part_extent_log(ob)
            post = [ob]
            f_post = {ob: "prop"}
        forced.update(f_post)
        parts += post
    elif team_id == "mortar_crew":
        # B4: the 0.76 m tube verbatim from `rig._mortar_crew_extras`, on
        # `prop`, hidden while the crew walks -- atgm_cell's shape exactly.
        tube, prop_bones, f_tube = rig._mortar_crew_extras()
        bones += prop_bones
        forced.update(f_tube)
        parts += tube
    elif team_id == "charge_squad":
        # B4: `rig._charge_squad_rest`'s order, on the Meshy cut -- chg1's
        # satchel (and, under CHARGE_KIT_VESTS, both men's vest slabs) join
        # the figure's own parts BEFORE the sprint lean, so all of it turns
        # together; then `teams._lean_forward` (the same call, not a copy)
        # leans every LIVING part of each man about his own ground line.
        # The bones stay upright, as that builder leaves them: `build_clips`
        # budgets the gait against REST_LEAN_RAD and keys FIRE_ROOT_LEAN. The
        # corpse (`*_death_body`) is left as cut -- prone, not sprinting.
        extra = {s["prefix"]: [] for s in figures}
        for spec in figures:
            x, y = spec["x"], spec["y"]
            if CHARGE_KIT_VESTS:
                extra[spec["prefix"]] += [
                    kit.rot_z(f"{spec['prefix']}_vest_f", (0.10, 0.26, 0.32), (x + 0.16, y, 0.60), 0.0, "charge"),
                    kit.rot_z(f"{spec['prefix']}_vest_b", (0.09, 0.26, 0.28), (x - 0.15, y, 0.62), 0.0, "charge"),
                ]   # PART_BONE: vest_f / vest_b -> spine
            if spec["prefix"] == "chg1":
                sat = kit.box("chg_satchel", (0.26, 0.18, 0.20), (x - 0.12, y + 0.19, 0.74), "charge")
                forced[sat] = "chg1_spine"
                extra[spec["prefix"]].append(sat)
        for spec in figures:
            pfx = spec["prefix"]
            living = [o for o in parts if o.name.startswith(pfx + "_") and "_death" not in o.name]
            living += extra[pfx]
            teams._lean_forward(living, rig.CHARGE_REST_LEAN_DEG, at_x=spec["x"])
            parts += extra[pfx]
            log(f"{pfx}: {len(living)} living parts leaned {rig.CHARGE_REST_LEAN_DEG} deg about x={spec['x']}")
    elif team_id == "digger_crew":
        # B4: the spoil heap verbatim from `rig._digger_extras` on the
        # never-keyed `ground` bone (it stays through every clip), and the
        # entrenching tool in the kneeling man's right hand.
        heap, ground_bones, f_heap = rig._digger_extras()
        bones += ground_bones
        forced.update(f_heap)
        parts += heap
        tool = _entrenching_tool("dig", parts, (0.36, -0.06, 0.14))
        forced.update({ob: "dig_spine" for ob in tool})
        parts += tool
    elif team_id == "breach_team":
        # B5: no kit rifle -- the figure's own carbine is on the torso (see
        # WEAPON_ON_SPINE). `rig._breach_extras` verbatim for the props: the
        # pole resolves through PART_BONE (`pole`/`pole_head` -> spine) as in
        # the kit file; the shield is FORCED to brc_point's spine rather than
        # PART_BONE's `forearm_L`, because this figure's left arm is on the
        # torso (ARMS_ON_TORSO) and the forearm_L bone it would ride swings
        # with the gait while the arm it belongs to does not. The plate
        # stands 0.28 m ahead of the man's centre line, where his left
        # forearm, bent across the chest, would hold its handle.
        if "kdf_carbine" in _HAND:
            # A3.1: the baked carbine (WEAPON_ON_SPINE) gives way to the Meshy
            # carbine, laid along the baked one's own long axis.
            for ob in [o for o in parts if o.name.endswith("_carbine") and "_death" not in o.name]:
                new = _carbine_over_baked("kdf_carbine", ob)
                forced[new] = forced.pop(ob)
                parts[parts.index(ob)] = new
                bpy.data.objects.remove(ob, do_unlink=True)
        props, _b, f_props = rig._breach_extras()
        forced.update(f_props)
        for ob in props:
            if ob.name == "brc_point_shield":
                forced[ob] = "brc_point_spine"
        parts += props
    elif team_id == "inf_squad":
        # B7: no kit rifle -- each man's own baked carbine is on his torso
        # (WEAPON_ON_SPINE, ARMS_ON_TORSO), exactly breach_team's shape.
        pass
    elif team_id == "sarim_rifles":
        # B7: three riflemen, grip on each man's own bent right hand --
        # militia_cell's rule, three times.
        for spec in figures:
            w = _hand_rifle(spec["prefix"], hands[spec["prefix"]], spec["x"], spec["y"])
            forced.update({ob: f"{spec['prefix']}_forearm_R" for ob in w})
            parts += w
    elif team_id == "mortar_team":
        # B7: the 1.02 m tube verbatim from `rig._mortar_team_extras` on
        # `prop`, hidden while the crew walk on their D6 walkers; the No.3's
        # rifle at his hand.
        _kit_tube, prop_bones, _f_kit = rig._mortar_team_extras()
        for ob in _kit_tube:
            bpy.data.objects.remove(ob, do_unlink=True)
        # B8: the Meshy mortar on the same `prop` bone at the same anchor
        # (`MESHY_PARTS`), one `weapon` mesh through the atlas.
        tube = [_meshy_mortar(team_id, part_src)]
        part_src = None
        # The tube and bipod must be clear of every crewman at rest (B7
        # review): counted here, and `launcher_clearance.test.ts` repeats
        # it on the exported bytes.
        crew = [o for o in parts if "_death" not in o.name and not o.name.startswith("mtr_crew0w")
                and not o.name.startswith("mtr_crew1w") and o.get("rl_role") not in ("weapon", "metal")]
        inside = _inside_count(tube, crew)
        log(f"mortar_team: mortar samples inside the crew at kit's (0.26, 0): {inside}")
        if inside:
            raise SystemExit(f"mortar_team: {inside} mortar samples inside a crewman -- move the mount, do not ship it")
        bones += prop_bones
        forced.update({ob: "prop" for ob in tube})
        parts += tube
        w = _hand_rifle("mtr_no3", hands["mtr_no3"], -0.62, 0.0)
        for ob in w:
            # One material per role: the kit rifle shares `weapon` with the
            # textured mortar, so it borrows one uv from the mortar's bake
            # (its tube, a dark gunmetal texel) rather than exporting bare.
            if not ob.data.materials:   # a Meshy carbine part carries its own atlas slot
                _borrow_uv(ob, tube[0], near=_coords(tube[0]).mean(axis=0))
        forced.update({ob: "mtr_no3_forearm_R" for ob in w})
        parts += w
    elif team_id == "sniper_team":
        # B7: each man's prop twice -- carried on the standing walker
        # (`spine` for the slung rifle, `head` for the glasses, as
        # `rig._sniper_rest`) and lying with the prone body on its
        # `death_root`. The prone offsets are kit's own, written for a head
        # at +0.78 from the anchor, which is where `_prone_parts` put it.
        baked = any(o.name.endswith("_carbine") for o in parts)
        # B8: the Meshy rifle and spotting scope (one preview, two islands),
        # placed below in the kit pieces' own positions.
        rifle_m, scope_m = _meshy_sniper_kit(team_id, part_src)
        part_src = None
        for sspec in rig.SNIPER_SPECS:
            pfx, sx, sy = sspec["prefix"], sspec["x"], sspec["sign"] * rig.SNIPER_CLOSE_IDLE
            if sspec["role"] == "rifle":
                # Standing: the figure's own baked carbine (on spine,
                # WEAPON_ON_SPINE, bound by `_sniper_figure`) if the preview
                # came holding one, else kit's slung rifle. Prone: always
                # kit's long rifle with its bipod, lying along the body.
                carried = [] if baked else kit.sniper_rifle(f"{pfx}_rifle", (sx, sy, 0.0), posture="standing")
                forced.update({ob: f"{pfx}_spine" for ob in carried})
                # kit.sniper_rifle's prone offsets were written for kit's
                # 0.25 m-thick prone figure; this body lies ~0.5 m thick with
                # its arms under it, so the same tube vanished inside it. The
                # rifle lies BESIDE the head on the outboard side at shoulder
                # height, muzzle well past the helmet, the bipod standing on
                # the ground under the muzzle.
                hx, hy, hz = prone_heads[pfx]
                side = -1.0 if sy < 0 else 1.0
                ry = hy + side * 0.17
                # B8: the Meshy rifle lies on its own bipod on the ground,
                # outboard of the head at the kit tube's x (centre hx+0.25,
                # muzzle past the helmet), role `weapon` through the atlas.
                lying = [_seat_on_ground(rifle_m, f"{pfx}_death_rifle", "weapon", hx + 0.25, ry)]
            else:
                carried = kit.binoculars(f"{pfx}_binos", (sx, sy, eyes[pfx] - kit.POSTURE_EYE["standing"] * kit.FIGURE_H - 0.04),
                                         posture="standing")
                forced.update({ob: f"{pfx}_head" for ob in carried})
                for ob in carried:
                    # One material per role: the standing glasses share
                    # `metal` with the textured scope below, so they borrow
                    # one uv from the scope's bake.
                    _borrow_uv(ob, scope_m, near=_coords(scope_m).mean(axis=0))
                hx, hy, hz = prone_heads[pfx]
                # B8: the Meshy spotting scope on its tripod, on the ground
                # just ahead of the lifted face, role `metal` through the atlas.
                lying = [_seat_on_ground(scope_m, f"{pfx}_death_scope", "metal", hx + 0.30, hy)]
            forced.update({ob: f"{pfx}_death_root" for ob in lying})
            parts += carried + lying
    elif team_id == "yahalom_squad":
        # B7: the packs verbatim from `rig._yahalom_extras` (kit, on both
        # spines -- the boxy tell), the rifle at yah_b's hand, and the mast
        # held LEVEL at yah_a's own measured right hand rather than at the
        # kit figure's: 1.45 m with the sensor head box at its far end, on
        # `forecarm_R` so it hides with him in down/wreck.
        a = hands["yah_a"]["arm"][1]
        elbow, wrist = Vector(a["elbow"]), Vector(a["wrist"])
        hand = wrist + (wrist - elbow).normalized() * HAND_REACH + Vector((0.30, -0.20, 0.0))
        mast_len = 1.45
        # `metal`, not kit's default `weapon`: a sensor mast is not a barrel,
        # and the gait test's weapon-axis sweep reads every `weapon` vertex
        # on a `forearm_R` as one (48 vertices of mast failed its 50 floor).
        mast = [kit.tube("yah_mast", mast_len, 0.030, (hand.x + mast_len * 0.5 - 0.20, hand.y, hand.z), yaw=0.0, pitch=0.0, role="metal")]
        head = [kit.box("yah_head", (0.16, 0.10, 0.04), (hand.x + mast_len - 0.20, hand.y, hand.z), "metal")]
        forced.update({ob: "yah_a_forearm_R" for ob in mast + head})
        # Kit's own positions ran the boxes through both torsos (B7 review);
        # the "before" count is logged beside the seated one.
        packs = []
        for pfx, at in (("yah_a", (0.30, -0.20, 0.0)), ("yah_b", (-0.34, 0.26, 0.0))):
            kit_pack = teams._yah_pack(f"{pfx}_kitpack", at)
            body = [o for o in parts if o.name in (f"{pfx}_torso", f"{pfx}_hips")]
            log(f"{pfx}: kit pack position -- {_inside_count([kit_pack], body)} samples inside the torso (before)")
            bpy.data.objects.remove(kit_pack, do_unlink=True)
            pack, _in = _pack_behind(f"yah_pack_{pfx[-1]}", pfx, parts, kneel=False)
            forced[pack] = f"{pfx}_spine"
            packs.append(pack)
        parts += mast + head + packs
        w = _hand_rifle("yah_b", hands["yah_b"], -0.34, 0.26)
        forced.update({ob: "yah_b_forearm_R" for ob in w})
        parts += w
    else:
        raise SystemExit(f"no crew weapon rule for {team_id}")

    if src_fig is not None:
        bpy.data.objects.remove(src_fig, do_unlink=True)
    for ob in _HAND.values():   # the canonical part sources; every placed one is a copy
        bpy.data.objects.remove(ob, do_unlink=True)
    _HAND.clear()

    want = {f"{s['prefix']}_forearm_R" for s in figures if s["weapon"] in ("launcher", "rifle")}
    if want - set(forced.values()):
        raise SystemExit(f"{team_id}: weapon declared but not bound: {want - set(forced.values())}")

    if os.environ.get("CREW_DEBUG"):
        for ob in sorted(parts, key=lambda o: o.name):
            c = _coords(ob)
            log(f"  part {ob.name:28s} role {ob.get('rl_role'):9s} x {c[:, 0].min():+.2f}..{c[:, 0].max():+.2f} "
                f"y {c[:, 1].min():+.2f}..{c[:, 1].max():+.2f} z {c[:, 2].min():+.2f}..{c[:, 2].max():+.2f} "
                f"-> {forced.get(ob, '(table)')}")
    arm_obj = rig.build_armature(bones)
    prefixes = {s["prefix"] for s in figures} | {s["prefix"] for s in rig._walker_specs(figures)}
    prefixes |= {rig._kneeler_prefix(s) for s in figures if s.get("work_posture") == "kneeling"}
    rig.rig_parts(parts, arm_obj, forced, prefixes)
    merged = rig.join_by_role(parts)
    rig.build_clips(arm_obj, team_id)
    path = os.path.join(OUT_DIR, f"{team_id}.glb")
    textured = team_id in TEXTURED
    if textured:
        img = bpy.data.images["base_color"]
        before = tuple(img.size)
        cap_w, cap_h = _TEX.get("atlas") or (TEXTURE_PX, TEXTURE_PX)
        if img.size[0] > cap_w or img.size[1] > cap_h:
            img.scale(min(img.size[0], cap_w), min(img.size[1], cap_h))
        log(f"{team_id}: base_color {before[0]}x{before[1]} -> {img.size[0]}x{img.size[1]}; "
            f"images {[i.name for i in bpy.data.images]}")
        for role, ob in merged.items():
            has = any(m is not None for m in ob.data.materials)
            log(f"  role {role:9s} material {'yes' if has else 'no '} uv {'yes' if ob.data.uv_layers else 'no '}")
    rig.export_glb(arm_obj, path, materials=textured, jpeg_quality=JPEG_QUALITY)
    tris = sum(len(ob.data.polygons) for ob in merged.values())
    log(f"{team_id}: wrote {path} ({os.path.getsize(path)} bytes), roles {sorted(merged)}, {tris} tris, "
        f"clips {[a.name for a in bpy.data.actions]}")
    return path


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    names = [n for n in SOURCES if n != "moto_rpg"] if argv in ([], ["all"]) else argv
    for name in names:
        if name not in SOURCES:
            raise SystemExit(f"unknown team {name!r}; have {sorted(SOURCES)}")
        if name == "moto_rpg":
            raise SystemExit("moto_rpg is built by tools/units/import_meshy_moto_rpg.py (its riders "
                             "only come from this module's SOURCES)")
        build_team(name)


if __name__ == "__main__":
    main()
