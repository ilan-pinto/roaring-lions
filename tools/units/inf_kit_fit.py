"""Per-figure measurements and body-zone BVHs for the kit redesign (GH-826).

Blender-only. Everything is read from the SHIPPED base primitives in the bind
pose (the armature in REST), so a part follows each figure's own build.
"""
import math

import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

import inf_kit_geo as geo
import inf_kit_parts as kp
import inf_kit_scene as scn

HELMET_Z0 = 1.56      # above this, head-bound uniform verts are the helmet

_CACHE = {}


def _base(meshes):
    """Arrays over the `uniform` primitive: coordinates, weights per group, tris."""
    key = id(meshes["uniform"])
    if key in _CACHE:
        return _CACHE[key]
    U = meshes["uniform"]
    me = U.data
    n = len(me.vertices)
    co = np.empty((n, 3))
    for i, v in enumerate(me.vertices):
        co[i] = v.co
    names = {vg.index: vg.name for vg in U.vertex_groups}
    W = {nm: np.zeros(n) for nm in names.values()}
    dom = np.empty(n, dtype=object)
    for i, v in enumerate(me.vertices):
        best, bw = None, -1.0
        for g in v.groups:
            W[names[g.group]][i] = g.weight
            if g.weight > bw:
                best, bw = names[g.group], g.weight
        dom[i] = best
    me.calc_loop_triangles()
    tris = np.array([t.vertices[:] for t in me.loop_triangles], dtype=int)
    _CACHE[key] = (co, W, dom, tris)
    return _CACHE[key]


_LUM = {}


def _tri_luminance(U):
    """Texel luminance (0-1, as stored) of each loop triangle of the `uniform` primitive, read from its baked atlas at the
    triangle's UV centroid: the way to find a baked vest (near black) among cloth, hands and loose shards."""
    key = id(U)
    if key in _LUM:
        return _LUM[key]
    import bpy
    me = U.data
    img = None
    for n in me.materials[0].node_tree.nodes:
        if n.type == "TEX_IMAGE":
            img = n.image
    W, H = img.size
    px = np.empty(W * H * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(H, W, 4)
    uv = me.uv_layers.active.data
    out = np.empty(len(me.loop_triangles))
    for i, t in enumerate(me.loop_triangles):
        u = np.mean([uv[l].uv for l in t.loops], axis=0)
        c = px[int(np.clip(u[1] * H, 0, H - 1)), int(np.clip(u[0] * W, 0, W - 1)), :3]
        out[i] = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    _LUM[key] = out
    return out


def _co(ob):
    return np.array([v.co[:] for v in ob.data.vertices])


def _dominant(ob):
    names = {vg.index: vg.name for vg in ob.vertex_groups}
    return np.array([names[max(v.groups, key=lambda g: g.weight).group] for v in ob.data.vertices])


class Fit:
    """Per-figure anchors and zone BVHs, measured from the shipped bind pose."""

    def __init__(self, arm, meshes, prefix):
        self.prefix = prefix
        pf = prefix
        bones = arm.data.bones
        self.bones = bones
        self.O = np.array(bones[f"{pf}_root"].head_local)
        self.O[2] = 0.0
        co, W, dom, tris = _base(meshes)
        self.co, self.W, self.tris = co, W, tris
        mine = np.array([isinstance(d, str) and d.startswith(pf + "_") for d in dom])
        self.mine = mine
        tri_mine = mine[tris].all(1)

        self.pts = {}

        def zone(pred, name=None):
            ok = pred[tris].all(1) & tri_mine
            if not ok.any():
                return None
            t = tris[ok]
            if name:
                # the zone's own sample points: its vertices, face centroids and edge midpoints
                a, b, c = co[t[:, 0]], co[t[:, 1]], co[t[:, 2]]
                vs = co[np.unique(t)]
                self.pts[name] = np.concatenate([vs, (a + b + c) / 3, (a + b) / 2, (b + c) / 2, (c + a) / 2])
            return geo.bvh_from(co, t)
        w = lambda b: W[f"{pf}_{b}"]
        z = co[:, 2]
        self.zone_all = zone(mine)
        self.zone_torso = zone(w("spine") >= 0.95, "torso")
        self.zone_torso_all = self.zone_torso
        if kp.TEAM.torso_vest_lum is not None:
            # the wraps fit the BAKED VEST (near-black texels on the spine), not the whole spine zone: that zone also carries
            # cloth tatters and spine-bound hands, which make the outermost-hit sampler draw a shapeless drape around the arms
            lum = _tri_luminance(meshes["uniform"])
            ok = (w("spine")[tris] >= 0.5).all(1) & tri_mine & (lum < kp.TEAM.torso_vest_lum)
            t = tris[ok]
            a, b, c = co[t[:, 0]], co[t[:, 1]], co[t[:, 2]]
            vs = co[np.unique(t)]
            self.pts["torso_all"] = self.pts["torso"]       # the whole spine zone: the collar and yoke sit above the vest
            self.pts["torso"] = np.concatenate([vs, (a + b + c) / 3, (a + b) / 2, (b + c) / 2, (c + a) / 2])
            self.zone_torso = geo.bvh_from(co, t)
        self.zone_helmet = zone((w("head") >= 0.5) & (z >= HELMET_Z0), "helmet")
        self.zone_arm = {s: zone(w(f"upperarm_{s}") >= 0.95, f"arm{s}") for s in "LR"}
        self.zone_arm_any = {s: zone(w(f"upperarm_{s}") >= 0.5) for s in "LR"}
        self.zone_pelvis = zone(((w("pelvis") + w("spine")) >= 0.9) & (z < 1.02) & (z > 0.80), "pelvis")
        self.zone_head = zone(w("head") >= 0.5)
        arms = np.zeros(len(co), bool)
        for b in ("upperarm_L", "upperarm_R", "forearm_L", "forearm_R"):
            arms |= (w(b) >= 0.5)
        self.zone_arms = zone(arms)
        armw = sum(w(b) for b in ("upperarm_L", "upperarm_R", "forearm_L", "forearm_R"))
        self.zone_lower = zone((armw < 0.3) & (z < 1.02), "lower")
        # arm vertex cloud (any weight >= 0.5 on either arm / forearm) for clearance queries
        arm_any = np.zeros(len(co), bool)
        for b in ("upperarm_L", "upperarm_R", "forearm_L", "forearm_R"):
            arm_any |= (w(b) >= 0.5)
        self.arm_any_idx = np.nonzero(arm_any & mine)[0]

        # --- helmet
        hm = (w("head") >= 0.5) & (z >= HELMET_Z0) & mine
        hel = co[hm] - self.O
        # a baked mount stands 5 cm proud of the shell at the front and would drag the helmet's centre (and every wrap's axis)
        # forward: measure the shell without the front-most cluster
        meas = hel[hel[:, 0] < hel[:, 0].max() - 0.04] if kp.TEAM.baked_mount else hel
        lo, hi = np.percentile(meas, 1, axis=0), np.percentile(meas, 99, axis=0)
        self.hel_lo, self.hel_hi = lo, hi
        self.hel_c = Vector(((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, 0.0))
        self.hel_rx, self.hel_ry = (hi[0] - lo[0]) / 2, (hi[1] - lo[1]) / 2
        self.hel_top = float(hel[:, 2].max())
        self.hel_bot = float(np.percentile(hel[:, 2], 1))
        # --- torso
        sm = (w("spine") >= 0.95) & mine
        sp = co[sm] - self.O
        ch = sp[(sp[:, 2] >= 1.28) & (sp[:, 2] <= 1.40)]
        self.chest_x = (float(np.percentile(ch[:, 0], 1)), float(np.percentile(ch[:, 0], 99)))
        self.chest_y = (float(np.percentile(ch[:, 1], 1)), float(np.percentile(ch[:, 1], 99)))
        self.sh = {s: Vector(np.array(bones[f"{pf}_upperarm_{s}"].head_local)) for s in "LR"}
        self.el = {s: Vector(np.array(bones[f"{pf}_upperarm_{s}"].tail_local)) for s in "LR"}
        # --- weapon, in its own frame (u forward to the muzzle, w left, v up). An unarmed figure has none.
        self.armed = f"{pf}_weapon" in bones
        if not self.armed:
            self.wM = self.wu = self.ww = self.wv = self.wl = None
            self.wlen = 0.0
            self.wbvh = None
            return
        Wm = meshes["weapon"]
        wco, wdom = _co(Wm), _dominant(Wm)
        wv_ = wco[wdom == f"{pf}_weapon"]
        c = wv_.mean(0)
        u = np.linalg.svd(wv_ - c, full_matrices=False)[2][0]
        if u[0] < 0:
            u = -u
        u = Vector(u).normalized()
        v = (Vector((0, 0, 1)) - u * u.z).normalized()
        wvec = v.cross(u).normalized()
        proj = (wv_ - c) @ np.array(u)
        muz = wv_[proj >= proj.max() - 0.02].mean(0)
        self.wM = Vector(muz)
        self.wu, self.ww, self.wv = u, wvec, v
        self.wlen = float(proj.max() - proj.min())
        d = wv_ - muz
        self.wl = np.stack([d @ np.array(u), d @ np.array(wvec), d @ np.array(v)], axis=1)
        # a sparse weapon (demo_squad's carbine: a handful of long faces) has no vertices at most stations, so its top, bottom
        # and width there are read off its SURFACE: a BVH of the gun's faces in the weapon frame, ray-cast
        self.wbvh = None
        if kp.TEAM.weapon_by_surface:
            me = Wm.data
            names = {vg.index: vg.name for vg in Wm.vertex_groups}
            dom = [names[max(vv.groups, key=lambda g: g.weight).group] for vv in me.vertices]
            loc_v = []
            for i, vv in enumerate(me.vertices):
                dd = np.array(vv.co[:]) - muz
                loc_v.append(Vector((dd @ np.array(u), dd @ np.array(wvec), dd @ np.array(v))))
            tris = [tuple(pg.vertices) for pg in me.polygons if all(dom[i] == f"{pf}_weapon" for i in pg.vertices)]
            self.wbvh = BVHTree.FromPolygons(loc_v, tris)

    def _surface_station(self, back):
        """(top, bottom, w_lo, w_hi) at `back` metres behind the muzzle, from vertical and sideways rays on the gun's faces."""
        tops, bots, ws = [], [], []
        for w in np.arange(-0.07, 0.0701, 0.005):
            o = Vector((-back, w, 1.0))
            hit = self.wbvh.ray_cast(o, Vector((0, 0, -1)))
            if hit[0] is not None:
                tops.append(hit[0].z)
                ws.append(w)
            hit = self.wbvh.ray_cast(Vector((-back, w, -1.0)), Vector((0, 0, 1)))
            if hit[0] is not None:
                bots.append(hit[0].z)
        if not tops:
            return None
        return float(max(tops)), float(min(bots)), float(min(ws)), float(max(ws))

    def rail_top(self, u0, u1):
        """Highest point of the gun's surface between two stations (u negative = behind the muzzle)."""
        best = None
        for u in np.linspace(u0, u1, 9):
            st = self._surface_station(-u)
            if st is not None and (best is None or st[0] > best):
                best = st[0]
        return 0.06 if best is None else float(best)

    def helmet_hardware(self, p, proud=0.02):
        """True for a helmet-zone point that stands more than `proud` metres off the shell: baked NVG shroud, bracket and side
        rails, which a real helmet cover is cut around. The shell here is the 25th-percentile radius of the helmet's own points in
        the same height band and 30-degree sector, from the helmet's axis."""
        if "_hel_pts" not in self.__dict__:
            self._hel_pts = self.pts["helmet"]
        P = self._hel_pts
        cx, cy = self.O[0] + self.hel_c.x, self.O[1] + self.hel_c.y
        d = P[:, :2] - np.array([cx, cy])
        ang = np.degrees(np.arctan2(d[:, 1], d[:, 0]))
        rad = np.hypot(d[:, 0], d[:, 1])
        q = np.array([p[0] - cx, p[1] - cy])
        qa = math.degrees(math.atan2(q[1], q[0]))
        qr = float(np.hypot(*q))
        sel = (np.abs(P[:, 2] - p[2]) <= 0.025) & (np.abs((ang - qa + 180.0) % 360.0 - 180.0) <= 30.0)
        if sel.sum() < 6:
            return False
        return qr > float(np.percentile(rad[sel], 25)) + proud

    # frames
    def fig(self):
        m = Matrix.Identity(4)
        m.translation = Vector(self.O)
        return m

    def world(self):
        return Matrix.Identity(4)

    def wpn(self):
        m = Matrix.Identity(4)
        for i in range(3):
            m[i][0], m[i][1], m[i][2] = self.wu[i], self.ww[i], self.wv[i]
        m.translation = self.wM
        return m

    def station(self, back, half=0.025):
        """(top, bottom, w_lo, w_hi) of the weapon `back` metres behind the muzzle."""
        if self.wbvh is not None:
            st = self._surface_station(back)
            if st is not None:
                return st
        s = self.wl[np.abs(self.wl[:, 0] + back) < half]
        if len(s) == 0:
            s = self.wl[np.abs(self.wl[:, 0] + back) < 0.06]
        # a sparse barrel (demo_squad's carbine has no vertices within 6 cm of some stations): widen until it has some
        win = 0.06
        while len(s) == 0 and win < 0.4:
            win *= 1.5
            s = self.wl[np.abs(self.wl[:, 0] + back) < win]
        return float(s[:, 2].max()), float(s[:, 2].min()), float(s[:, 1].min()), float(s[:, 1].max())

    def section(self, zlo, zhi, bone="spine", thr=0.95):
        """(x0, x1, y0, y1) of the zone's vertices in a z slab, figure-relative."""
        m = (self.W[f"{self.prefix}_{bone}"] >= thr) & self.mine & (self.co[:, 2] >= zlo) & (self.co[:, 2] <= zhi)
        p = self.co[m] - self.O
        if len(p) == 0:
            return None
        return (float(p[:, 0].min()), float(p[:, 0].max()), float(p[:, 1].min()), float(p[:, 1].max()))

    def centre_at(self, z, bone="spine", half=0.03):
        s = self.section(z - half, z + half, bone)
        if s is None:
            return None
        return Vector(((s[0] + s[1]) / 2, (s[2] + s[3]) / 2, 0.0))


class PoseBank:
    """The figure's own geometry in every sampled key of the living clips, so a part can be
    trimmed against what the OTHER bones actually do (spec 4.3: clearance, not a guess).

    For a part riding bone B, every vertex of the base primitives that belongs to ANOTHER bone
    is carried into B's rest frame (`rest @ pose^-1 @ world`): where that vertex would be if it
    were rigid with B. Those points, over all poses, are the volume the part must stay out of."""

    def __init__(self, arm, meshes, fits, stride=6):
        import bpy
        self.arm = arm
        self.meshes = meshes
        self.fits = fits
        team = kp.TEAM
        self.CLIPS = team.bank_clips
        objs = [meshes[n] for n in team.bank_prims]
        self.objs = objs
        self.dom = []
        for ob in objs:
            names = {vg.index: vg.name for vg in ob.vertex_groups}
            self.dom.append(np.array([names[max(v.groups, key=lambda g: g.weight).group] for v in ob.data.vertices], dtype=object))
        self.poses = []     # (matrices {bone: 4x4 np}, world verts per obj)
        saved = arm.data.pose_position
        for clip in self.CLIPS:
            act = bpy.data.actions[clip]
            if team.dense_keys:
                # the file's own keys: a short clip (kneelIn / kneelOut, 0..4.8) at every keyframe and its last frame, a long
                # one on the stride plus its keys' integer frames. The Rifle Squad's bank sampled `range(lo, hi + 1, stride)`
                # alone, which for a 4.8-frame clip is frame 0 only.
                keys, _lo = scn.clip_keys(act, stride, dense=True)
            else:
                lo, hi = int(act.frame_range[0]), int(act.frame_range[1])
                keys = list(range(lo, hi + 1, max(1, stride)))
            for fr in keys:
                self._pose(arm, act, fr)
                dg = bpy.context.evaluated_depsgraph_get()
                mats = {pb.name: np.array(pb.matrix) for pb in arm.pose.bones}
                W = []
                for ob in objs:
                    e = ob.evaluated_get(dg)
                    me = e.to_mesh()
                    W.append(np.array([v.co[:] for v in me.vertices]))
                    e.to_mesh_clear()
                self.poses.append((mats, W))
        arm.data.pose_position = "REST"
        if arm.animation_data:
            arm.animation_data.action = None
        bpy.context.view_layer.update()
        self.rest = {b.name: np.array(b.matrix_local) for b in arm.data.bones}

    @staticmethod
    def _pose(arm, act, fr):
        import bpy
        arm.data.pose_position = "POSE"
        if arm.animation_data is None:
            arm.animation_data_create()
        arm.animation_data.action = act
        arm.animation_data.action_slot = act.slots[0] if act.slots else None
        scn.set_frame(fr)
        bpy.context.view_layer.update()

    def blockers(self, pf, bone, lo, hi):
        """Points (rest frame of `{pf}_{bone}`) of every other bone's vertices that ever come inside
        the box [lo, hi] (figure-world coordinates, with a margin)."""
        key = f"{pf}_{bone}"
        if not hasattr(self, "_own"):
            self._own = {}
        for oi in range(len(self.objs)):
            if (pf, key, oi) not in self._own:
                # every other bone of this figure, and the free-standing prop (a charge on the ground) if the file has one
                self._own[(pf, key, oi)] = np.array([isinstance(d, str) and (d.startswith(pf + "_") or d == "prop") and d != key for d in self.dom[oi]])
        out, who = [], []
        for mats, W in self.poses:
            M = self.rest[key] @ np.linalg.inv(mats[key])
            for oi, w in enumerate(W):
                own = self._own[(pf, key, oi)]
                p = w[own]
                X = p @ M[:3, :3].T + M[:3, 3]
                m = ((X >= lo) & (X <= hi)).all(1)
                if m.any():
                    out.append(X[m])
                    who.append(np.array([d[len(pf) + 1:] if d.startswith(pf + "_") else d for d in self.dom[oi][own]], dtype=object)[m])
        if not out:
            return np.zeros((0, 3)), np.zeros(0, dtype=object)
        return np.concatenate(out), np.concatenate(who)
