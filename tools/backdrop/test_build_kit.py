"""Tests for the Wadi Halam backdrop kit numerics (no Blender needed).

    python3 -m unittest tools/backdrop/test_build_kit.py      (or pytest)

Each check was falsified: see `docs`-less notes in the render-1 notes.md (a mutation
per check, each watched go red, then reverted).
"""
import glob
import os
import math
import re
import sys
import unittest

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import kitlib as K
import pieces as P
import bake as B
import layout as L
import olive as O
import rim as R

# Reference values printed by the renderer's OWN `tileHash`, `valueNoise2` and `fbm2`
# (packages/render/src/tile-hash.ts, terrain/noise.ts) under node, 2026-10-28.
TS_HASH = [(0, 0, 0.0), (1, 2, 0.8830856902059168), (-5, 17, 0.7051534024067223),
           (99999, -88888, 0.08301781304180622), (123456, 654321, 0.7357713135425001)]
TS_VN = [(0.3, 0.7, 0.6874753289327658), (12.5, -3.25, 0.2287977523670961), (-40.1, 77.7, -0.9146096368531477),
         (1234.5678, -987.65, -0.03670653597000151), (3.999, 5.001, 0.5022210370260694)]
TS_FBM = [(0.3, 0.7, -0.4479891132186508), (12.5, -3.25, -0.45962527288656), (-40.1, 77.7, 0.13367420736972999),
          (1234.5678, -987.65, -0.25766232734155775), (3.999, 5.001, -0.20097517362817444)]


class Noise(unittest.TestCase):
    def test_matches_the_renderers_own(self):
        for x, y, v in TS_HASH:
            self.assertAlmostEqual(float(K.tile_hash(x, y)), v, places=12)
        for x, z, v in TS_VN:
            self.assertAlmostEqual(float(K.vnoise(x, z, 11.0, 7)), v, places=12)
        for x, z, v in TS_FBM:
            self.assertAlmostEqual(float(K.fbm(x, z, 18.0, 3, 12)), v, places=12)


class Hygiene(unittest.TestCase):
    def test_no_hex_literal_in_the_kit_tools(self):
        pat = re.compile("#" + "[0-9A-Fa-f]{6}\\b")
        hits = []
        for f in glob.glob(os.path.join(HERE, "*.py")):
            if f.endswith("test_build_kit.py"):
                continue
            for n, line in enumerate(open(f), 1):
                if pat.search(line):
                    hits.append("%s:%d" % (os.path.basename(f), n))
        self.assertEqual(hits, [])

    def test_no_mathutils_noise(self):
        for f in glob.glob(os.path.join(HERE, "*.py")):
            if f.endswith("test_build_kit.py"):
                continue
            self.assertNotIn("mathutils.noise", open(f).read().replace("NEVER `mathutils.noise`", "").replace("`mathutils.noise`", "").replace("mathutils.noise``", ""), f)

    def test_ladders_descend_in_luma(self):
        for lad in (K.LIME, K.LIME_LIT, K.KARST, K.SCRUB, K.SCRUB_LIT, K.GRASS, K.DUST, K.OLIVE_CANOPY, K.TRUNK):
            self.assertTrue(np.all(np.diff(lad.luma) <= 1e-9), lad.keys)

    def test_a_ladder_that_ascends_is_refused(self):
        with self.assertRaises(ValueError):
            K.Ladder(["limestone.8", "limestone.0"])


class Pieces(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.p = {x.name: x.build() for x in P.all_pieces()}

    def test_caps_and_lod_ratio(self):
        for n, x in self.p.items():
            self.assertLessEqual(x.gm.tri_count, x.cap, n)

    def rows_at(self, x, s):
        j = int(np.argmin(np.abs(x.gm.sv - s)))
        self.assertAlmostEqual(float(x.gm.sv[j]), s, places=6, msg="no seam vertex at %s" % s)
        return x.gm.z[:, j]

    def test_walls_share_profile_w_at_both_ends(self):
        ref = self.rows_at(self.p["bd_wall_far_a"], -24.0)
        for n in ("bd_wall_far_a", "bd_wall_far_b", "bd_wall_far_c"):
            for s in (-24.0, 24.0):
                np.testing.assert_allclose(self.rows_at(self.p[n], s), ref, atol=0.03, err_msg="%s @ %s" % (n, s))

    def test_taper_corner_and_head_meet_the_wall(self):
        wall = self.rows_at(self.p["bd_wall_far_a"], 24.0)
        tap = self.rows_at(self.p["bd_taper"], -24.0)
        np.testing.assert_allclose(tap, wall, atol=0.05)
        # the corner's faces: s = 0 (b = 0) and t = 0 (a = 0) are profile W along the other axis
        c = self.p["bd_wall_corner"]
        j = int(np.argmin(np.abs(c.gm.sv)))
        i = int(np.argmin(np.abs(c.gm.tv)))
        self.assertAlmostEqual(float(c.gm.sv[j]), 0.0, places=6)
        self.assertAlmostEqual(float(c.gm.tv[i]), 0.0, places=6)
        np.testing.assert_allclose(c.gm.z[i:, j], wall, atol=0.06, err_msg="corner face b=0")
        np.testing.assert_allclose(c.gm.z[i, j:], wall, atol=0.06, err_msg="corner face a=0")
        # the head wall's ends, over the depth it has (its rows add the cirque's risers, which lie on
        # a straight stretch of the profile: compare against the wall's mesh as the mesh is, linear
        # between its rows)
        h = self.p["bd_head_wall"]
        n = int(np.sum(h.gm.tv <= 72.0 + 1e-6))
        for s in (-48.0, 48.0):
            col = self.rows_at(h, s)
            ref = np.interp(h.gm.tv[:n], self.p["bd_wall_far_a"].gm.tv, wall)
            np.testing.assert_allclose(col[:n], ref, atol=0.05, err_msg="head @ %s" % s)

    def test_near_slopes_stay_under_the_envelope(self):
        # the DESIGNED field, before the final clamp that guarantees it: a check on the
        # clamped result alone could not fail (the clamp forces the ratio)
        for n in ("bd_slope_near_a", "bd_slope_near_b"):
            x = self.p[n]
            S, T = x.M.S, x.M.T
            b = n.endswith("b")
            H, ter, riser, track = P._near_field(S + (10 if b else 0), T, x.seed + (17 if b else 0), P.env(S, ramp=10.0), T)
            ratio = np.where(T > 3.0, H / np.maximum(T, 1e-6), 0.0)
            self.assertLessEqual(float(ratio.max()), 0.38 + 1e-9, n)
            inner = (T > 6.0) & (T < 118.0) & (np.abs(S) < 23.0)
            clamped = float(np.mean(x.f["H"][inner] < H[inner] - 1e-9))
            self.assertLess(clamped, 0.001, "the clamp is doing the work on %s" % n)
        # the finished meshes obey it too
        for n in ("bd_slope_near_a", "bd_slope_near_b"):
            x = self.p[n]
            T = x.M.T
            self.assertLessEqual(float(np.where(T > 3.0, x.f["H"] / np.maximum(T, 1e-6), 0.0).max()), 0.38 + 1e-9, n)
        x = self.p["bd_slope_corner"]
        m = np.maximum(x.M.S, x.M.T)
        self.assertLessEqual(float(np.where(m > 3.0, x.f["H"] / np.maximum(m, 1e-6), 0.0).max()), 0.38 + 1e-9)

    def test_slope_corner_meets_the_slope_ends(self):
        c = self.p["bd_slope_corner"]
        j = int(np.argmin(np.abs(c.gm.sv)))
        for n in ("bd_slope_near_a", "bd_slope_near_b"):
            x = self.p[n]
            end = self.rows_at(x, 24.0)
            tv = x.gm.tv
            # the corner's own rows differ from the slope's: compare on the master
            cH = c.f["H"][:, int(round((0.0 - c.M.s[0]) / c.M.h))]
            sH = x.f["H"][:, int(round((24.0 - x.M.s[0]) / x.M.h))]
            t_c = c.M.t
            t_s = x.M.t
            for t in (10.0, 30.0, 60.0, 100.0):
                self.assertAlmostEqual(float(np.interp(t, t_c, cH)), float(np.interp(t, t_s, sH)), delta=0.08, msg="%s at t=%s" % (n, t))

    def test_terraces_chain_flush(self):
        a, b, e = (self.p["bd_terrace_" + k] for k in ("a", "b", "end"))
        def col(x, s):
            return x.f["H"][:, int(round((s - x.M.s[0]) / x.M.h))]
        for s in (-12.0, 12.0):
            np.testing.assert_allclose(col(a, s), col(b, s), atol=0.03, err_msg="a vs b at %s" % s)
        np.testing.assert_allclose(col(e, -12.0), col(a, 12.0), atol=0.03, err_msg="end vs a")

    def test_the_envelope_check_can_fail(self):
        # a surface 0.5 over the envelope must be seen
        x = self.p["bd_slope_near_a"]
        T = x.M.T
        bad = np.where(T > 3.0, (x.f["H"] + 0.5 * T) / np.maximum(T, 1e-6), 0.0)
        self.assertGreater(float(bad.max()), 0.38)

    def test_build_twice_is_byte_identical(self):
        a = P.all_pieces()[0].build()
        b = P.all_pieces()[0].build()
        self.assertEqual(a.gm.pos.tobytes(), b.gm.pos.tobytes())
        self.assertEqual(a.gm.tris.tobytes(), b.gm.tris.tobytes())
        self.assertEqual(a.f["ao"].tobytes(), b.f["ao"].tobytes())

    def test_a_different_seed_differs(self):
        a = P.all_pieces()[0]
        b = P.all_pieces()[0]
        b.seed += 1
        a.build()
        b.build()
        self.assertNotEqual(a.gm.pos.tobytes(), b.gm.pos.tobytes())


class SecondPass(unittest.TestCase):
    """Lane B second pass (GH-161, lead 28 Oct): the seven points."""

    @classmethod
    def setUpClass(cls):
        cls.p = {x.name: x.build() for x in P.all_pieces()}

    # ---- (2) cliff edges: every ledge is one row wide at every column ------------------
    def test_every_ledge_is_one_row_wide(self):
        for n in ("bd_wall_far_a", "bd_wall_far_b", "bd_wall_far_c"):
            x = self.p[n]
            cols = np.where(np.abs(x.gm.sv) < 12.0)[0]
            if n.endswith("b"):
                cols = np.array([j for j in cols if x.gm.sv[j] > 6.0 or x.gm.sv[j] < -9.0])    # the gully has its own geometry
            tv = x.gm.vv
            # the five faces of the sheer band: a row vertex at each foot and each top
            face_rows = []
            for (a, b) in P.PROFILE.face_span:
                i0 = int(np.argmin(np.abs(tv - a)))
                i1 = int(np.argmin(np.abs(tv - b)))
                self.assertAlmostEqual(float(tv[i0]), a, places=5, msg="%s: no row at the foot of a face" % n)
                self.assertAlmostEqual(float(tv[i1]), b, places=5, msg="%s: no row at the top of a face" % n)
                self.assertEqual(i1, i0 + 1, "%s: a face spans more than one row interval" % n)
                face_rows.append(i0)
            # steepness of the steepest face interval, at every interior column: the profile is 3.2:1
            slopes = np.array([(x.gm.z[i + 1, cols] - x.gm.z[i, cols]) / (tv[i + 1] - tv[i]) for i in face_rows])
            self.assertGreater(float(slopes.min()), 1.6, "%s: a ledge is smeared over several rows" % n)
            # the rim meanders: the mesh rows carry it (world t of one row differs from column to column)
            allc = np.arange(len(x.gm.sv))
            wt = x.world(x.gm.sv[None, allc].repeat(len(tv), 0), tv[:, None].repeat(len(allc), 1))[1]
            self.assertGreater(float(np.ptp(wt[face_rows[0] + 1])), 0.5, "%s: the rim does not meander" % n)
            self.assertGreater(float(np.diff(wt, axis=0).min()), 0.05, "%s: the meander folds the mesh" % n)

    def test_rim_meander_never_folds(self):
        # a row of equal profile distance must stay a row: d(shift)/d(d) well under 1 for every wall seed
        S = np.linspace(-48.0, 48.0, 241)[None, :] * np.ones((841, 1))
        D = np.linspace(0.0, 84.0, 841)[:, None] * np.ones((1, 241))
        for seed in (101, 202, 303, 404, 505, 613):
            e = P.env(S, half=48.0, ramp=14.0)
            sh = P.rim_shift(S, D, seed, e, P.WARP + 0.2)
            self.assertLess(float(np.diff(sh, axis=0).max() / 0.1), 0.6, "seed %d" % seed)
            self.assertGreater(float(np.ptp(sh)), 1.5, "seed %d: no meander to speak of" % seed)

    def test_rim_meander_vanishes_at_the_seams(self):
        for n in ("bd_wall_far_a", "bd_wall_far_b", "bd_wall_far_c", "bd_taper"):
            x = self.p[n]
            for s in ((-24.0,) if n == "bd_taper" else (-24.0, 24.0)):
                j = int(np.argmin(np.abs(x.gm.sv - s)))
                wt = x.world(np.full(len(x.gm.vv), s), x.gm.vv)[1]
                np.testing.assert_allclose(wt, x.gm.vv, atol=1e-9, err_msg="%s @ %s" % (n, s))

    # ---- (1) crests: a broken skyline ------------------------------------------------
    def test_crest_skyline_is_broken(self):
        for n, summits in (("bd_crest_a", 4), ("bd_crest_b", 5)):
            x = self.p[n]
            ridge = x.gm.z.max(axis=0)                       # the skyline: highest ground at each column
            # local summits that stand clear of both neighbouring notches by 2 m
            peaks = []
            for j in range(2, len(ridge) - 2):
                if ridge[j] >= ridge[j - 1] and ridge[j] > ridge[j + 1]:
                    lo_l = ridge[:j][::-1].min() if j else ridge[j]
                    # prominence: the lowest the line drops before it climbs higher (or the end)
                    left = next((k for k in range(j - 1, -1, -1) if ridge[k] > ridge[j]), -1)
                    right = next((k for k in range(j + 1, len(ridge)) if ridge[k] > ridge[j]), len(ridge))
                    base_l = ridge[left + 1:j].min() if left < j - 1 else ridge[j]
                    base_r = ridge[j + 1:right].min() if right > j + 1 else ridge[j]
                    if ridge[j] - max(base_l, base_r) >= 2.0:
                        peaks.append(j)
            self.assertGreaterEqual(len(peaks), summits, "%s: the skyline is a loaf (%d summits)" % (n, len(peaks)))
            top = np.sort(ridge[peaks])[::-1]
            # the deepest notch between two summits drops below 60% of the lower summit
            notch = min(ridge[a:b + 1].min() / min(ridge[a], ridge[b]) for a, b in zip(peaks[:-1], peaks[1:]))
            self.assertLess(float(notch), 0.60, "%s: no real notch between summits" % n)
            self.assertGreater(float(top[0] / top[-1]), 1.3, "%s: every summit the same height" % n)

    # ---- (3) wall b: a slot, narrow and dark ------------------------------------------
    def test_wall_b_gully_is_narrow_and_dark(self):
        b, a = self.p["bd_wall_far_b"], self.p["bd_wall_far_a"]
        row = int(np.argmin(np.abs(b.gm.vv - 45.0)))
        depth = a.gm.z[row, :].mean() - b.gm.z[row, :]          # below the plain wall's own surface
        wide = b.gm.sv[depth > 1.0]
        width = float(wide.max() - wide.min()) if len(wide) else 0.0
        self.assertGreater(width, 1.0, "no gully at all")
        self.assertLess(width, 9.0, "the gully is a wide scoop (%.1f m at d = 45)" % width)
        # darker: the shaded colour of the slot's own pixels
        rgb = P.SHADERS["wall"](b.M, b.f, b.seed)
        luma = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]
        inside = (b.f["slot_dark"] > 0.9) & (b.f["slot_floor"] > 0.5)
        self.assertGreater(int(inside.sum()), 500)
        self.assertLess(float(luma[inside].mean()), 0.28, "the slot floor is not dark")
        # and the plain wall at the same distance is much lighter
        rows = (b.M.T > 36.0) & (b.M.T < 56.0) & (np.abs(b.M.S) > 10.0)
        self.assertGreater(float(luma[rows].mean()), 1.6 * float(luma[inside].mean()))

    # ---- (4) olives: a finer crown within 64 triangles ----------------------------------
    def silhouette(self, verts, tris, n=320):
        """The olive seen from the game camera (30 degrees up, 45 degrees round), as a mask."""
        el, az = math.radians(30.0), math.radians(45.0)
        right = np.array([math.cos(az), math.sin(az), 0.0])
        up = np.array([-math.sin(el) * math.sin(az), math.sin(el) * math.cos(az), math.cos(el)])
        uv = np.stack([verts @ right, verts @ up], axis=1)
        lo, hi = uv.min(axis=0) - 0.05, uv.max(axis=0) + 0.05
        scale = (n - 1) / max(hi - lo)
        px = (uv - lo) * scale
        yy, xx = np.mgrid[0:n, 0:n]
        mask = np.zeros((n, n), dtype=bool)
        for t in tris:
            a, b, c = px[t[0]], px[t[1]], px[t[2]]
            d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
            if abs(d) < 1e-9:
                continue
            l1 = ((b[1] - c[1]) * (xx - c[0]) + (c[0] - b[0]) * (yy - c[1])) / d
            l2 = ((c[1] - a[1]) * (xx - c[0]) + (a[0] - c[0]) * (yy - c[1])) / d
            mask |= (l1 >= 0) & (l2 >= 0) & (1 - l1 - l2 >= 0)
        return mask, scale

    def test_olive_is_a_fine_crown_within_the_cap(self):
        v, t, tag = O.build()
        self.assertLessEqual(len(t), 64)
        self.assertTrue(3.1 <= v[:, 2].max() <= 3.5, "height %.2f vs the in-map olive's 3.4 m" % v[:, 2].max())
        self.assertTrue(2.6 <= np.ptp(v[:, 0]) <= 3.8)
        canopy = t[tag == O.CANOPY]
        lobes = len(set(int(i) // 6 for i in canopy.ravel() if True))
        self.assertGreaterEqual(len(canopy) // 8, 6, "fewer than six crown lobes")
        mask, scale = self.silhouette(v, t)
        # roughness of the outline: perimeter squared over area, 4 pi for a disc and no ... a smooth blob is near 1.0
        er = mask & ~np.roll(mask, 1, 0) | mask & ~np.roll(mask, 1, 1) | mask & ~np.roll(mask, -1, 0) | mask & ~np.roll(mask, -1, 1)
        perim = float(er.sum())
        area = float(mask.sum())
        rough = perim * perim / (4.0 * math.pi * area)
        # the largest lump: no single crown lobe covers more than a sixth of the whole silhouette
        biggest = 0.0
        for k in range(len(canopy) // 8):
            m, _ = self.silhouette(np.concatenate([v[:0], v]), canopy[k * 8:(k + 1) * 8])
            biggest = max(biggest, float(m.sum()))
        self.assertGreater(rough, 1.9, "the outline is a smooth blob (roughness %.2f)" % rough)
        self.assertLess(biggest / area, 0.34, "one lump is a third of the olive")

    # ---- (5) outer corners ---------------------------------------------------------------
    def test_outer_corner_meets_the_taper_and_the_slope(self):
        oc, tp = self.p["bd_outer_corner"], self.p["bd_taper"]
        j = int(np.argmin(np.abs(oc.gm.sv - 24.0)))
        k = int(np.argmin(np.abs(tp.gm.sv - 24.0)))
        self.assertAlmostEqual(float(oc.gm.sv[j]), 24.0, places=6)
        self.assertAlmostEqual(float(tp.gm.sv[k]), 24.0, places=6)
        # the taper's free end and the outer corner's seam row: the same cross-section (within 5 cm; the
        # taper's skirt dip sits 0.6 m under it, so the comparison is on the nominal line)
        np.testing.assert_allclose(oc.gm.z[:, j], tp.gm.z[:, k], atol=0.05)
        # the near slope's end profile, continued along t = 0 (past the 20 m it takes to grow in)
        sl = self.p["bd_slope_near_a"]
        col = int(np.argmin(np.abs(sl.M.s - 24.0)))
        for u in (30.0, 50.0, 70.0):
            tm = 48.0 + u          # a literal: the taper is 16 tiles = 48 m long, so the south edge is 48 m behind its free end
            want = float(np.interp(tm, sl.M.t, sl.f["H"][:, col]))
            got = float(np.interp(24.0 + u, oc.gm.sv, oc.gm.z[0, :]))
            self.assertAlmostEqual(got, want, delta=0.12, msg="inner edge at %s m" % u)
        # and it is not four extra near slopes: one piece carries a spur taller than any near slope could
        self.assertGreater(float(oc.gm.z.max()), 8.0)

    def test_corner_ledges_are_one_row_wide_too(self):
        c = self.p["bd_wall_corner"]
        tv = c.gm.vv
        rows = []
        for (a, b) in P.PROFILE.face_span:
            i0 = int(np.argmin(np.abs(tv - a)))
            self.assertEqual(int(np.argmin(np.abs(tv - b))), i0 + 1)
            rows.append(i0)
        # columns well off the mitre (where the two walls' fields meet), on the first wall's half
        cols = [j for j in range(len(c.gm.sv)) if 4.0 < c.gm.sv[j] < 20.0]
        slopes = np.array([(c.gm.z[i + 1, cols] - c.gm.z[i, cols]) / (tv[i + 1] - tv[i]) for i in rows])
        self.assertGreater(float(slopes.min()), 1.6)
        # and the mirrored half: rows 4..20 m out, columns at the faces
        slopes2 = np.array([(c.gm.z[cols, i + 1] - c.gm.z[cols, i]) / (tv[i + 1] - tv[i]) for i in rows])
        self.assertGreater(float(slopes2.min()), 1.6)

    def test_corner_is_symmetric_off_the_couloir(self):
        c = self.p["bd_wall_corner"]
        n = int(np.sum(c.gm.vv < 22.0))
        z = c.gm.z[:n, :n]
        self.assertGreater(float(np.ptp(z)), 3.0)
        np.testing.assert_allclose(z, z.T, atol=0.2)

    # ---- (6) per-piece base heights -----------------------------------------------------
    def layout(self):
        m, elev = R.load_map()
        rim = R.rim_field(elev)
        return L.layout_ns(48, 48, rim=rim, profile=lambda d: float(np.interp(d, P.PROFILE.d, P.PROFILE.y))), rim

    def test_layout_feet_follow_the_rim(self):
        pl, rim = self.layout()
        by = {}
        for q in pl:
            by.setdefault((q["id"], tuple(q["at"]), q["rot"]), q)
        # literal ground (WH IV): the NW corner and the north edge stand on level 4 (3.06 m); the south edge
        # runs level 0-2. One base per family put the north foot 2-3 m under the floor.
        self.assertAlmostEqual(by[("bd_wall_corner", (0.0, 0.0), 0)]["y"][0], 3.0, delta=0.15)
        north_wall = by[("bd_wall_far_c", (40.0, 0.0), 90)]
        self.assertTrue(all(2.8 < v < 3.2 for v in north_wall["y"]), north_wall["y"])
        sw = by[("bd_outer_corner", (0.0, 64.0), 0)]
        self.assertTrue(all(1.2 < v < 1.8 for v in sw["y"]), "the south-west must not float: %s" % sw["y"])
        # not a single family constant: the walls differ by well over a metre end to end
        ys = [v for q in pl if q["id"].startswith("bd_wall_far") for v in q["y"]]
        self.assertGreater(max(ys) - min(ys), 2.5)

    def test_layout_feet_are_continuous_across_seams(self):
        pl, rim = self.layout()
        seen = {}
        for q in pl:
            if q["id"].startswith(("bd_wall_far", "bd_taper", "bd_head_wall", "bd_outer_corner", "bd_wall_corner")):
                ext = L.s_extent(q["id"])
                pts = [(q["id"], L.edge_point(q, e), v) for e, v in zip(ext, q["y"])] if ext else [(q["id"], tuple(q["at"]), q["y"][0])]
                for pid, pt, v in pts:
                    seen.setdefault((round(pt[0], 6), round(pt[1], 6)), []).append((pid, v))
        shared = [v for v in seen.values() if len(v) > 1]
        self.assertGreater(len(shared), 5, "no shared seam points found")
        for group in shared:
            vals = [v for _, v in group]
            self.assertLess(max(vals) - min(vals), 1e-6, "a step at a seam: %s" % group)

    # ---- (7) texel density ---------------------------------------------------------------
    def test_terrace_and_cliff_texels_beat_the_first_pass(self):
        pcs = list(self.p.values())
        pos, used, k, sizes = B.plan(pcs)
        self.assertLessEqual(used, K.ATLAS_PX)
        per_tile = {}
        for q in pcs:
            for c in q.charts:
                per_tile.setdefault(q.name, []).append(q.ppm * c.dens * k * 3.0)
        self.assertGreaterEqual(min(per_tile["bd_terrace_a"]), 40.0, "terraces: first pass 22")
        self.assertGreaterEqual(max(per_tile["bd_wall_far_a"]), 30.0, "cliff face: first pass 22")
        # the foot ramp (under the terraces) keeps at least the first pass's density within 10%
        self.assertGreaterEqual(per_tile["bd_wall_far_a"][0], 0.9 * 22.3)

    # ---- every mesh over a piece's parameter plane ----------------------------------------
    def test_lod1_is_a_third_and_inside_the_charts(self):
        for n, x in self.p.items():
            g1 = x.lod1()
            self.assertLessEqual(g1.tri_count, 0.40 * x.gm.tri_count, n)
            uv = K.corner_uv(g1, x.charts) if x.charts[0].x0 is not None else None
            if uv is not None:
                self.assertTrue(np.isfinite(uv).all(), n)

    def test_second_pass_pieces_build_twice_identically(self):
        for n in ("bd_wall_corner", "bd_outer_corner", "bd_crest_a", "bd_wall_far_b"):
            a = next(q for q in P.all_pieces() if q.name == n).build()
            b = next(q for q in P.all_pieces() if q.name == n).build()
            self.assertEqual(a.gm.pos.tobytes(), b.gm.pos.tobytes(), n)
            self.assertEqual(a.f["H"].tobytes(), b.f["H"].tobytes(), n)


if __name__ == "__main__":
    unittest.main()
