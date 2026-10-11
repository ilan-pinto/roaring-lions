# GH-85: the unused effect triggers, before and after

`pnpm blast:capture -- --label=before|after --only=<id>` (`tools/src/perf/blast-captures.ts`, the six GH-85 subjects).
Before is `origin/main` at 87d213e6 with this branch's harness copied in; after is this branch. Both: macOS arm64, ANGLE/Metal,
1400x900 at deviceScaleFactor 1, frozen frame loop, `beit_sahwan_outskirts` sandbox, one isolated page per subject, music off.
Ladder crops are 600x400 JPEG q82 of the PNG the harness wrote; establishing shots are downscaled to 700 px. Full conditions in
`before/sheet.md` and `after/sheet.md`.

## `ricochet_d9`

`armor_ricochet` (`impact_armor`): 12.7 mm off a D9. Before: nothing at the hull, ever.

| rung | before | after |
|---|---|---|
| 00000ms | ![](before/ricochet_d9-strike-00000ms-before-z2.5.jpg) | ![](after/ricochet_d9-strike-00000ms-after-z2.5.jpg) |
| 00050ms | ![](before/ricochet_d9-strike-00050ms-before-z2.5.jpg) | ![](after/ricochet_d9-strike-00050ms-after-z2.5.jpg) |
| 00100ms | ![](before/ricochet_d9-strike-00100ms-before-z2.5.jpg) | ![](after/ricochet_d9-strike-00100ms-after-z2.5.jpg) |
| 00200ms | ![](before/ricochet_d9-strike-00200ms-before-z2.5.jpg) | ![](after/ricochet_d9-strike-00200ms-after-z2.5.jpg) |
| 00400ms | ![](before/ricochet_d9-strike-00400ms-before-z2.5.jpg) | ![](after/ricochet_d9-strike-00400ms-after-z2.5.jpg) |
| 00800ms | ![](before/ricochet_d9-strike-00800ms-before-z2.5.jpg) | ![](after/ricochet_d9-strike-00800ms-after-z2.5.jpg) |

## `penetration_d9`

`armor_penetration` (`penetration`): 30 mm into a D9's rear. Before: a flat flash on the TICK, ~176 ms before the round visibly arrived, gone by rung 0.

| rung | before | after |
|---|---|---|
| 00000ms | ![](before/penetration_d9-strike-00000ms-before-z2.5.jpg) | ![](after/penetration_d9-strike-00000ms-after-z2.5.jpg) |
| 00050ms | ![](before/penetration_d9-strike-00050ms-before-z2.5.jpg) | ![](after/penetration_d9-strike-00050ms-after-z2.5.jpg) |
| 00100ms | ![](before/penetration_d9-strike-00100ms-before-z2.5.jpg) | ![](after/penetration_d9-strike-00100ms-after-z2.5.jpg) |
| 00200ms | ![](before/penetration_d9-strike-00200ms-before-z2.5.jpg) | ![](after/penetration_d9-strike-00200ms-after-z2.5.jpg) |
| 00400ms | ![](before/penetration_d9-strike-00400ms-before-z2.5.jpg) | ![](after/penetration_d9-strike-00400ms-after-z2.5.jpg) |
| 00800ms | ![](before/penetration_d9-strike-00800ms-before-z2.5.jpg) | ![](after/penetration_d9-strike-00800ms-after-z2.5.jpg) |

## `aps_lavi`

`aps_launch` (`interceptor_launch`): the Lavi's APS firing at an inbound Kornet, toward the shooter (right). The fireball is the existing `missile_impact`.

| rung | before | after |
|---|---|---|
| 00000ms | ![](before/aps_lavi-aps-00000ms-before-z2.5.jpg) | ![](after/aps_lavi-aps-00000ms-after-z2.5.jpg) |
| 00050ms | ![](before/aps_lavi-aps-00050ms-before-z2.5.jpg) | ![](after/aps_lavi-aps-00050ms-after-z2.5.jpg) |
| 00100ms | ![](before/aps_lavi-aps-00100ms-before-z2.5.jpg) | ![](after/aps_lavi-aps-00100ms-after-z2.5.jpg) |
| 00200ms | ![](before/aps_lavi-aps-00200ms-before-z2.5.jpg) | ![](after/aps_lavi-aps-00200ms-after-z2.5.jpg) |
| 00400ms | ![](before/aps_lavi-aps-00400ms-before-z2.5.jpg) | ![](after/aps_lavi-aps-00400ms-after-z2.5.jpg) |
| 00800ms | ![](before/aps_lavi-aps-00800ms-before-z2.5.jpg) | ![](after/aps_lavi-aps-00800ms-after-z2.5.jpg) |

## `smoke_eitan`

`smoke_discharge` (`smoke_screen`): the pop at the Eitan that laid the screen. The screen itself is unchanged.

| rung | before | after |
|---|---|---|
| 00000ms | ![](before/smoke_eitan-smoke-00000ms-before-z2.5.jpg) | ![](after/smoke_eitan-smoke-00000ms-after-z2.5.jpg) |
| 00100ms | ![](before/smoke_eitan-smoke-00100ms-before-z2.5.jpg) | ![](after/smoke_eitan-smoke-00100ms-after-z2.5.jpg) |
| 00250ms | ![](before/smoke_eitan-smoke-00250ms-before-z2.5.jpg) | ![](after/smoke_eitan-smoke-00250ms-after-z2.5.jpg) |
| 00500ms | ![](before/smoke_eitan-smoke-00500ms-before-z2.5.jpg) | ![](after/smoke_eitan-smoke-00500ms-after-z2.5.jpg) |
| 01000ms | ![](before/smoke_eitan-smoke-01000ms-before-z2.5.jpg) | ![](after/smoke_eitan-smoke-01000ms-after-z2.5.jpg) |

## `charge_demo`

`demolition_blast` (`eod_breach`): a demo squad's satchel going off. Before: the flat dust puff of a rifle miss when a charge misses, nothing when it hits. (This throw missed; the sim's `nearMiss` put it a tile west.)

| rung | before | after |
|---|---|---|
| 00000ms | ![](before/charge_demo-charge-00000ms-before-z2.5.jpg) | ![](after/charge_demo-charge-00000ms-after-z2.5.jpg) |
| 00100ms | ![](before/charge_demo-charge-00100ms-before-z2.5.jpg) | ![](after/charge_demo-charge-00100ms-after-z2.5.jpg) |
| 00200ms | ![](before/charge_demo-charge-00200ms-before-z2.5.jpg) | ![](after/charge_demo-charge-00200ms-after-z2.5.jpg) |
| 00400ms | ![](before/charge_demo-charge-00400ms-before-z2.5.jpg) | ![](after/charge_demo-charge-00400ms-after-z2.5.jpg) |
| 00800ms | ![](before/charge_demo-charge-00800ms-before-z2.5.jpg) | ![](after/charge_demo-charge-00800ms-after-z2.5.jpg) |
| 01600ms | ![](before/charge_demo-charge-01600ms-before-z2.5.jpg) | ![](after/charge_demo-charge-01600ms-after-z2.5.jpg) |

## `smoulder_lavi`

`wreck_smoulder` (`catastrophic_kill`): the hull smoking on after the 20 s column, sim-dated, out at 60 s.

| rung | before | after |
|---|---|---|
| 00000ms | ![](before/smoulder_lavi-kill-00000ms-before-z1.5.jpg) | ![](after/smoulder_lavi-kill-00000ms-after-z1.5.jpg) |
| 02000ms | ![](before/smoulder_lavi-kill-02000ms-before-z1.5.jpg) | ![](after/smoulder_lavi-kill-02000ms-after-z1.5.jpg) |
| 10000ms | ![](before/smoulder_lavi-kill-10000ms-before-z1.5.jpg) | ![](after/smoulder_lavi-kill-10000ms-after-z1.5.jpg) |
| 20000ms | ![](before/smoulder_lavi-kill-20000ms-before-z1.5.jpg) | ![](after/smoulder_lavi-kill-20000ms-after-z1.5.jpg) |
| 30000ms | ![](before/smoulder_lavi-kill-30000ms-before-z1.5.jpg) | ![](after/smoulder_lavi-kill-30000ms-after-z1.5.jpg) |
| 45000ms | ![](before/smoulder_lavi-kill-45000ms-before-z1.5.jpg) | ![](after/smoulder_lavi-kill-45000ms-after-z1.5.jpg) |
| 59000ms | ![](before/smoulder_lavi-kill-59000ms-before-z1.5.jpg) | ![](after/smoulder_lavi-kill-59000ms-after-z1.5.jpg) |
| 64000ms | ![](before/smoulder_lavi-kill-64000ms-before-z1.5.jpg) | ![](after/smoulder_lavi-kill-64000ms-after-z1.5.jpg) |
