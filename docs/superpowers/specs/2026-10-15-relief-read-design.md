# Relief read — design and record

**Date:** 2026-10-15. **Status:** built behind a lead look (`render/relief-read`). **Decided by:** the
Lane B coordinator under the lead's delegation, from the mock in `roaring-lions-ep/_coord/relief-read/`
(`sheet.html`, `proposal.md`).

## Problem

**Relief reads weakly from the game camera.** Open ground is Catmull-Rom smooth, so a 3–4 level
bluff spread over 3–4 tiles turns its normal only a few degrees, and the sun barely tells its faces
apart.

- **Before this,** relief read almost entirely through the terraced `^` walls.
- **Wadi Tarfan:** the bed and bluffs (bluff 4, bed 0) look nearly flat at zoom 1.
- **Milh Flats:** the tells look nearly flat at zoom 1.

## What was mocked, and the verdicts

| option | verdict |
|---|---|
| A. slope light: a normal exaggeration for lighting | **built**, at gain 2 with a 38° ceiling (×3 went blotchy on Wadi Tarfan) |
| B. height tint + contours | **built**, with the tint normalised to the map's median level (the mock's absolute tint darkened every flat map) |
| C. valley AO: GTAO radius ×3, scale ×1.35 | **dropped**: no visible effect on any of the four maps, and it would move every golden scenario |
| D. crown summit: small `^` clusters drawn as a smooth peak, +2 levels | **held for an art pass**: the dome loses the crown's rock look |

## What ships

`packages/render/src/three/terrain/relief-read.ts` holds the constants, the pure maths and the
GLSL, which is generated from the same constants. `terrain/mesh.ts` injects it into
`GroundMaterial`.

### A. Slope light

For lighting only, the ground's world normal tilt `t` becomes
`max(t, min(atan(2 · tan t), 38°))`, with its azimuth kept.

- **Flat ground** (no horizontal part) is untouched.
- **A wall or back face** (no vertical part) is untouched.
- **Shadows** still come from the geometry.

### B. Height contours and tint

Both apply on ground tops only (`rlTop`), never on a wall face.

- **Contours:** a 0.18 darkening, 1.4 px half-width via `fwidth`, where the surface crosses a
  half level.
- **Tint:** a ramp relative to the median open level, reaching full strength 4 levels away. Low is
  cooler and darker (0.88, 0.90, 0.94); high is warmer and lighter (1.07, 1.05, 1.02). The median
  itself is exactly 1.
- **Where the median comes from:** `hazeReferenceLevel`, the haze's own, set on each terrain
  rebuild.

**A flat map does not move under either term:** it sits on whole levels and is all median.

## Gate

**Two debug layers:**

- `slope-light` sets the gain to 1, the identity.
- `height-contours` sets the contour and tint amplitudes to 0.

Both are uniform writes that nothing re-asserts per frame.

**Witnessed on `relief` and `aftermath`.** These are the only gated frames with relief; every other
gated scenario is on a flat map, where both layers read 0 by construction.

**Floors are a third of the measured signal.** The measurement is
`tools/src/perf/relief-read-signal.ts`, which uses the gate's own capture and repaint control.
Three fresh-page runs were bit-identical:

| scenario | layer | measured | floor |
|---|---|---|---|
| relief | slope-light | 0 px / 0.0555 | 0 px / 0.0185 |
| relief | height-contours | 0 px / 0.4817 | 0 px / 0.1605 |
| aftermath | slope-light | 9 px / 1.4944 | 0 px / 0.4981 |
| aftermath | height-contours | 3 px / 0.3962 | 0 px / 0.1320 |

**The pixel floors are 0** because every reading is under `SUB_THRESHOLD_PX` (100), so the
magnitude floor carries each check.

**Falsified:** with both shader terms removed, all four toggles read 0 px / 0.0000.

**`relief` and `aftermath` will need a bless, from CI numbers,** after the lead has looked at the
picture.

## Cost

| | added |
|---|---|
| draw calls | +0 |
| programs | +0 |
| textures | +0 |
| work | ALU per ground fragment: an `atan`/`sin`/`cos` and a view-matrix multiply for A; `fract`, `fwidth` and `smoothstep` for B |

**The frame cost was NOT measured on a quiet machine at build time.** Every timing taken (load average 60–135 from
other sessions) was swamped. That includes a paired, interleaved run (±7–12 ms per round).
**Since measured and closed (GH-804):** about +0.15 ms median at every preset (high, medium, low; M3 Pro,
ANGLE/Metal, DPR 2), under the 0.3 ms line, at load average 3-10 on a shared machine, not a quiet one;
`low` on `qarn_hadid` is the one cell near +0.3 ms.
