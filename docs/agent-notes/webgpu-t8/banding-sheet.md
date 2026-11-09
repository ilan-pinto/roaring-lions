# T8 banding sheet (2026-11-08T11:52:18.915Z)

Conditions: map=wadi_halam_4, 1440x900 DPR 2, booted camera z1, quality high, music off, reduced motion, Metal (L on legacy-gl, G on apple / metal-3); sim tick 5; loadavg start 9.71, after Ls 8.68, after L 10.27, end 9.84.

BEFORE is dither 0 on the new code, not a frame from the pre-fix commit: that the two are byte-identical rests on the shader (uGradeDither 0 adds zero) and is not asserted by any check here.

| arm | state | phase | penumbra | lit |
|---|---|---|---|---|
| L shipped | shipped | before | 0.001 | 0.000 |
| L shipped | shipped | after | 0.000 | 0.000 |
| L matched | flat | before | 0.563 | 0.636 |
| L matched | flat | after | 0.000 | 0.000 |
| L matched | shipped | before | 0.001 | 0.000 |
| L matched | shipped | after | 0.000 | 0.000 |
| G (WebGPU) | flat | before | 0.636 | 0.679 |
| G (WebGPU) | flat | after | 0.000 | 0.000 |
| G (WebGPU) | shipped | before | 0.000 | 0.000 |
| G (WebGPU) | shipped | after | 0.000 | 0.000 |

Legacy shipped frame, after minus before: 3323975 px changed, mean 0.4365 channel units.

## Gate (flat state, texture removed from both arms)

- node flat index (G, after) 0.000 <= L-matched flat (after) 0.000 on penumbra: PASS
- node flat index (G, after) 0.000 <= L-matched flat (after) 0.000 on lit: PASS
- L-matched flat index falls across the fix on penumbra: 0.563 -> 0.000: PASS
- L-matched flat index falls across the fix on lit: 0.636 -> 0.000: PASS
