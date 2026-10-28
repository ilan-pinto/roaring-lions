"""Tests for the Wadi Halam backdrop kit numerics (no Blender needed).

    python3 -m unittest tools/backdrop/test_build_kit.py      (or pytest)

Each check was falsified: see `docs`-less notes in the render-1 notes.md (a mutation
per check, each watched go red, then reverted).
"""
import glob
import os
import re
import sys
import unittest

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import kitlib as K
import pieces as P

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
        # the head wall's ends, over the depth it has
        h = self.p["bd_head_wall"]
        for s in (-48.0, 48.0):
            col = self.rows_at(h, s)
            n = int(np.sum(h.gm.tv <= 72.0 + 1e-6))
            np.testing.assert_allclose(col[:n], wall[:n], atol=0.05, err_msg="head @ %s" % s)

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


if __name__ == "__main__":
    unittest.main()
