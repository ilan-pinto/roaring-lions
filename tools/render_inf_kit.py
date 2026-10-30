"""Approval render 1 for the infantry upgrade kit (GH-826): `inf_squad`.

    blender -b -P tools/render_inf_kit.py -- --out <dir> --mode build|turntable|grid|close \\
        [--figure f1] [--tiers a,s,f]

Blender only, no browser, no Meshy. Imports the SHIPPED art/meshes/inf_squad.glb,
adds the kit (`units/inf_kit.py`), poses `idle` frame 0 and photographs it in
the game's camera and light (`inf_kit_stage.py`). The object turns (the squad's
parent empty); the camera and the sun never do.

Frames are written as 8-bit PNGs, tone-mapped the way the game's OutputPass
does (ACES, exposure 1.0). `tools/inf_kit_sheet.py` (plain python3 + PIL)
lays them into the contact sheet.
"""
import json
import math
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "units"))

import inf_kit  # noqa: E402
import inf_kit_garage as gar  # noqa: E402
import inf_kit_parts as kp  # noqa: E402
import inf_kit_scene as scn  # noqa: E402
import inf_kit_stage as st  # noqa: E402

# (label, {track: tier}) -- the eleven states of the approval grid.
STATES = [("none", {})] + [
    (f"{t[0]}{n}", {t: n}) for t in kp.TRACKS for n in (1, 2, 3)
] + [("full", {t: 3 for t in kp.TRACKS})]


def isolate(arm, keep):
    """Send every figure but `keep` far below the ground (a pose offset on its
    root bone), so a close-up is one soldier, not three overlapping."""
    from mathutils import Matrix, Vector
    for pf in kp.ALL:
        if pf == keep:
            continue
        pb = arm.pose.bones[f"{pf}_root"]
        pb.matrix = Matrix.Translation(Vector((0, 0, -40.0))) @ pb.matrix
    bpy.context.view_layer.update()


def tri_report(rows):
    """Per-part triangles against the spec column (cap 1.10x), per figure drawn at max kit
    (superseded slot parts dropped) against 1,200, per file (every part) against 5,000."""
    by_part = {}
    for ob, part, pf, tris in rows:
        by_part.setdefault((part.name, pf), 0)
        by_part[(part.name, pf)] += tris
    parts = []
    for part in kp.PARTS:
        per_fig = {pf: by_part[(part.name, pf)] for pf in kp.ALL if (part.name, pf) in by_part}
        worst = max(per_fig.values())
        cap = part.spec_tris * kp.PART_LIMIT
        parts.append({"part": part.name, "track": part.track, "tier": part.tier, "spec": part.spec_tris,
                      "cap": round(cap, 1), "built": per_fig, "within_cap": worst <= cap + 1e-9})
    drawn, infile = {}, {}
    for pf in kp.ALL:
        infile[pf] = sum(t for ob, part, f, t in rows if f == pf)
        # drawn at max: the highest tier of every slot only
        best = {}
        for ob, part, f, t in rows:
            if f == pf and part.slot:
                key = (part.slot, inf_kit._side_of(ob))
                best[key] = max(best.get(key, 0), part.tier)
        drawn[pf] = sum(t for ob, part, f, t in rows if f == pf and (not part.slot or part.tier == best[(part.slot, inf_kit._side_of(ob))]))
    return {"parts": parts, "totals": {"drawn_at_max_per_figure": drawn, "cap_per_figure": 1200,
                                         "in_file_per_figure": infile, "in_file_total": sum(infile.values()), "cap_per_file": 5000,
                                         "parts_over_cap": [p["part"] for p in parts if not p["within_cap"]]}}


def _tiers_of(label):
    for lab, tiers in STATES:
        if lab == label:
            return tiers
    raise KeyError(label)


def _reset_pose(arm):
    scn.pose(arm, "idle", 0)


def run_garage(a, mode, out, arm, meshes, rows, samples):
    """The garage turntable framing (garage-frame.ts / garage-view.ts) in Blender: three
    figures in a line, a perspective camera fitted once to the max-kit sweep."""
    import numpy as np
    w, h = int(a.get("w", 1356)), int(a.get("h", 760))
    figs = list(kp.ALL)
    show = lambda tiers: inf_kit.show(rows, tiers)
    G = gar.Garage(arm, meshes, rows, figs, show, w, h, lambda: _reset_pose(arm))
    summ = G.summary()
    print(json.dumps(summ))
    with open(os.path.join(out, f"{mode}_stage.json"), "w") as fh:
        json.dump(summ, fh, indent=1)
    G.build_scene(samples=samples, denoise=a.get("denoise", "1") == "1")
    if mode == "garage":
        labels = a.get("states", ",".join(l for l, _ in STATES)).split(",")
        heads = [int(x) for x in a.get("headings", "0,180").split(",")]
        for hd in heads:
            _reset_pose(arm)
            gar.place_figures(arm, figs, G.spacing, hd)
            G.set_camera(G.cam_pos, G.cam_target)
            for lab in labels:
                show(_tiers_of(lab))
                lin = gar.render_rgba(os.path.join(out, "tmp.npy"))
                gar.save_png(lin, os.path.join(out, f"garage_{lab}_{hd:03d}.png"))
                print("garage", lab, hd, flush=True)
        return
    # zones: one isolated soldier, the camera re-fitted to the zone with CLOSEUP_PAD
    zw, zh = int(a.get("zw", 480)), int(a.get("zh", 320))
    bpy.context.scene.render.resolution_x, bpy.context.scene.render.resolution_y = zw, zh
    zone_of = {"sensors": "head", "armour": "torso", "firepower": "weapon"}
    which = a.get("figures", "f2,f1").split(",")
    for pf in which:
        for track in kp.TRACKS:
            zone = zone_of[track]
            full = {t: 3 for t in kp.TRACKS}
            show(full)
            best = None
            fixed = {"armour": [0], "sensors": [45]}.get(track)
            for hd in (fixed or range(0, 360, 45)):
                _reset_pose(arm)
                isolate_line(arm, pf)
                gar.place_figures_one(arm, pf, hd)
                P = zone_points(arm, meshes, rows, pf, zone, track)
                T = np.array([gar.b2t(p) for p in P])
                pos, tgt, dist = gar.fit_camera(T, zw / zh, mx=1.0 / gar.CLOSEUP_PAD, my=1.0 / gar.CLOSEUP_PAD)
                # the heading that shows the track's own kit best: the largest projected spread at the fitted camera
                kit_pts = kit_track_points(arm, rows, pf, track)
                Tk = np.array([gar.b2t(p) for p in kit_pts])
                rot = gar._look(pos, tgt)
                nx, ny, _f = gar._project(Tk, pos, rot, gar.FOV_DEG, zw / zh)
                spread = (nx.max() - nx.min()) * (ny.max() - ny.min())
                if best is None or spread > best[0]:
                    best = (spread, hd, pos, tgt)
            _s, hd, pos, tgt = best
            _reset_pose(arm)
            isolate_line(arm, pf)
            gar.place_figures_one(arm, pf, hd)
            G.cam_data.sensor_fit = "VERTICAL"
            G.set_camera(pos, tgt)
            G.aspect = zw / zh
            for tier in (1, 2, 3):
                show({**{t: 0 for t in kp.TRACKS}, track: tier})
                lin = gar.render_rgba(os.path.join(out, "tmp.npy"))
                gar.save_png(lin, os.path.join(out, f"zone_{pf}_{track}_T{tier}.png"))
                print("zone", pf, track, tier, "heading", hd, flush=True)


def isolate_line(arm, keep):
    from mathutils import Matrix, Vector
    for pf in kp.ALL:
        if pf != keep:
            pb = arm.pose.bones[f"{pf}_root"]
            pb.matrix = Matrix.Translation(Vector((0, 0, -40.0))) @ pb.matrix
    bpy.context.view_layer.update()


def zone_points(arm, meshes, rows, pf, zone, track):
    """World points of one figure's zone (head: z >= 1.45; torso: the body between the
    hips and the neck; weapon: the weapon bone's own verts), kit of the track at T3 included."""
    import numpy as np
    base = [meshes[n] for n in ("uniform", "boot", "face", "weapon")]
    bo = gar.base_owner_fn(arm, list(kp.ALL))
    P, O = gar.eval_points(arm, base, bo)
    sel = O == list(kp.ALL).index(pf)
    P = P[sel]
    kit = [ob for ob, part, f, _ in rows if f == pf and part.track == track and not ob.hide_render]
    Pk = gar.eval_points(arm, kit, gar.kit_owner_fn(list(kp.ALL)))[0] if kit else np.zeros((0, 3))
    root = np.array(arm.data.bones[f"{pf}_root"].head_local)
    if zone == "head":
        m = P[:, 2] >= 1.45
    elif zone == "torso":
        m = (P[:, 2] >= 0.95) & (P[:, 2] <= 1.52)
    else:
        wo = meshes["weapon"]
        W, Ow = gar.eval_points(arm, [wo], gar.base_owner_fn(arm, list(kp.ALL)))
        P = W[Ow == list(kp.ALL).index(pf)]
        m = np.ones(len(P), bool)
    return np.concatenate([P[m], Pk])


def kit_track_points(arm, rows, pf, track):
    import numpy as np
    kit = [ob for ob, part, f, _ in rows if f == pf and part.track == track and not ob.hide_render]
    return gar.eval_points(arm, kit, gar.kit_owner_fn(list(kp.ALL)))[0]


def parse():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    a = {}
    for i in range(0, len(argv) - 1, 2):
        a[argv[i].lstrip("-")] = argv[i + 1]
    return a


def main():
    a = parse()
    out = os.path.abspath(a["out"])
    os.makedirs(out, exist_ok=True)
    mode = a.get("mode", "build")
    arm, meshes, mat = scn.load_squad(REPO)
    rows = inf_kit.build(REPO, arm, meshes, mat)
    turn = bpy.data.objects.new("turn", None)
    bpy.context.collection.objects.link(turn)
    arm.parent = turn
    report = tri_report(rows)
    with open(os.path.join(out, "tris.json"), "w") as fh:
        json.dump(report, fh, indent=1, sort_keys=True)
    print(json.dumps(report["totals"], indent=1))
    for r in report["parts"]:
        if not r["within_cap"]:
            print("OVER the per-part cap:", r)
    scn.pose(arm, a.get("pose", "idle") if a.get("pose", "idle") != "rest" else None, int(a.get("frame", 0)))
    samples = int(a.get("samples", 96))
    if mode == "build":
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, "inf_squad_kit.blend"))
        return
    if mode == "census":
        # nothing a living team draws is under the ground: the lowest vertex over EVERY key of each clip,
        # for the kit (full kit, all three figures) and, for scale, for the base figure itself
        import numpy as np
        from inf_kit_clash import clip_keys
        inf_kit.show(rows, {t: 3 for t in kp.TRACKS})
        res = {}
        kitobs = [ob for ob, _, _, _ in rows if not ob.hide_render]
        baseobs = [meshes[n] for n in ("uniform", "boot", "face", "weapon")]
        for clip in ("idle", "move", "fire", "moveFire", "kneel", "kneelIn", "kneelOut", "pinned", "down"):
            act = bpy.data.actions[clip]
            keys, lo = clip_keys(act, 4)
            lo_z, who, base_lo = 9.0, None, 9.0
            for kf_ in keys:
                arm.data.pose_position = "POSE"
                arm.animation_data_create()
                arm.animation_data.action = act
                arm.animation_data.action_slot = act.slots[0] if act.slots else None
                bpy.context.scene.frame_set(kf_)
                bpy.context.view_layer.update()
                dg = bpy.context.evaluated_depsgraph_get()
                for ob in kitobs:
                    e = ob.evaluated_get(dg)
                    m = e.to_mesh()
                    z = min((ob.matrix_world @ v.co).z for v in m.vertices)
                    e.to_mesh_clear()
                    if z < lo_z:
                        lo_z, who = z, ob.name
                for ob in baseobs:
                    e = ob.evaluated_get(dg)
                    m = e.to_mesh()
                    z = min((ob.matrix_world @ v.co).z for v in m.vertices if True)
                    e.to_mesh_clear()
                    base_lo = min(base_lo, z)
            res[clip] = {"keys": len(keys), "lowest_kit_z_m": round(lo_z, 4), "part": who, "lowest_base_figure_z_m": round(base_lo, 4)}
        with open(os.path.join(out, "census.json"), "w") as fh:
            json.dump(res, fh, indent=1)
        print(json.dumps(res, indent=1))
        return
    if mode in ("garage", "zones"):
        run_garage(a, mode, out, arm, meshes, rows, samples)
        return
    if mode == "close":
        # development view: one figure's kit at a given zoom, several headings
        tiers = {t: int(v) for t, v in zip(kp.TRACKS, a.get("tiers", "3,3,3").split(","))}
        inf_kit.show(rows, tiers)
        fig = a.get("figure", "f1")
        zoom = float(a.get("zoom", 14))
        centre = tuple(arm.data.bones[f"{fig}_root"].head_local)
        cx, cy = centre[0], centre[1]
        turn.location = (0, 0, 0)
        w, h = int(a.get("w", 420)), int(a.get("h", 520))
        if a.get("isolate", "1") == "1":
            isolate(arm, fig)
        cam, sun, ground = st.setup_scene(w, h, zoom, (cx, cy, float(a.get("cz", 1.0))), samples=samples)
        for hd in [int(x) for x in a.get("headings", "0,90,180,270").split(",")]:
            # turn about the figure, not the squad centre: parent the turntable there
            turn.location = (cx, cy, 0.0)
            turn.rotation_euler[2] = math.radians(hd)
            arm.location = (-cx, -cy, 0.0)
            bpy.context.view_layer.update()
            lin = st.render_npy(os.path.join(out, "tmp.npy"))
            st.save_png(lin, os.path.join(out, f"close_{fig}_{a.get('tag', 'x')}_{hd:03d}.png"))
        return
    if mode == "grid":
        # the eleven states at game scale: zoom 1 and zoom 2.5, two headings each
        zoom = float(a.get("zoom", 1.0))
        w, h = int(a.get("w", 120)), int(a.get("h", 96))
        cam, sun, ground = st.setup_scene(w, h, zoom, (0.0, 0.0, 0.85), samples=samples)
        for label, tiers in STATES:
            inf_kit.show(rows, tiers)
            for hd in [int(x) for x in a.get("headings", "0,180").split(",")]:
                turn.rotation_euler[2] = math.radians(hd)
                bpy.context.view_layer.update()
                lin = st.render_npy(os.path.join(out, "tmp.npy"))
                st.save_png(lin, os.path.join(out, f"grid_z{zoom:g}_{label}_{hd:03d}.png"))
        # the empty ground, for the floors' T0 pixel count: every figure sent below the ground
        isolate(arm, "none")
        inf_kit.show(rows, {})
        for hd in [int(x) for x in a.get("headings", "0,180").split(",")]:
            turn.rotation_euler[2] = math.radians(hd)
            bpy.context.view_layer.update()
            lin = st.render_npy(os.path.join(out, "tmp.npy"))
            st.save_png(lin, os.path.join(out, f"grid_z{zoom:g}_empty_{hd:03d}.png"))
        return
    if mode == "turntable":
        # none vs full kit at 8 headings; the whole squad, or one figure
        fig = a.get("figure")
        zoom = float(a.get("zoom", 5.0))
        w, h = int(a.get("w", 360)), int(a.get("h", 330))
        if fig:
            isolate(arm, fig)
            c = tuple(arm.data.bones[f"{fig}_root"].head_local)
            centre = (c[0], c[1], float(a.get("cz", 1.0)))
            turn.location = (c[0], c[1], 0.0)
            arm.location = (-c[0], -c[1], 0.0)
        else:
            centre = (0.0, 0.0, 0.85)
        cam, sun, ground = st.setup_scene(w, h, zoom, centre, samples=samples)
        for label, tiers in (("none", {}), ("full", {t: 3 for t in kp.TRACKS})):
            inf_kit.show(rows, tiers)
            for hd in range(0, 360, 45):
                turn.rotation_euler[2] = math.radians(hd)
                bpy.context.view_layer.update()
                lin = st.render_npy(os.path.join(out, "tmp.npy"))
                st.save_png(lin, os.path.join(out, f"turn_{fig or 'squad'}_{label}_{hd:03d}.png"))
        return
    raise SystemExit(f"unknown mode {mode}")


if __name__ == "__main__":
    main()
