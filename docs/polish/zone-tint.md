# Zones over a town centre (#470)

Status: **the lead chose option C on 2026-10-08, and it is built** (`polish/zone-hatch`).

- `zone-tint/sheet.jpg` is the mock as it was approved: today and four options on the same frames.
- `zone-tint/built.jpg` shows today next to the BUILT option C. Both columns were photographed
  from the real renderer, on the same frames, with the same harness.
- `tools/src/perf/zone-tint-captures.ts` is that harness. Its mock variants ran through a
  throwaway renderer patch (draft #472, closed in favour of the build); on a tree without
  the patch, it photographs whatever the tree draws, under `--tag=`.

## What was built

- The fill is gone. `OBJECTIVE_ZONE_FILL_ALPHA` and `OverlayBatch.polygonFillWorld` are
  deleted, so nothing in the over-everything tier draws inside a zone any more.
- The halo, the stroke and the not-held/contested dash (#461, VR-36) are unchanged.
- `units/zone-band.ts` adds a hatched band 0.5 tile inside the edge, built from 0.25-tile
  cells on the drawn ground.
  - Depth-tested, so buildings and units hide it.
  - Multiplied onto the lit ground at full strength, in the zone state's own colour key, and
    through the same resolver as the outline, so colour-vision variants follow.
  - Drawn in `ZONE_BAND_RENDER_ORDER`, an alias of the fading-decal band 0. It sits under the
    selection ring.
- It costs one mesh for every zone, and none when no zone is on screen.
- The `overlays` debug layer hides it, through `zoneBandGroup`.
- The minimap keeps its own 0.12 fill. A flat mark on a flat map hides nothing.

**Measured on the built code** (Metal, 1400×900, DPR 1, :5194):

- Draw calls: +1 with a zone on screen. Over the same frames, main against built differs by
  +1 or −2; the −2 is VFX run-to-run.
- Triangles: +1,774 on the Beit Sahwan III town zone (880 cells × 2, less the fill's 2).
- frame()+sync medians: within ±0.6 ms of main on every frame. That is noise.

The visual gate's only frame with an objective zone in it is `combat`, which is report-only.
Its `take_town` zone is contested at tick 600.

- Main against built: 31,183 / 34,302 px, mean |Δ| 4.54 / 4.64.
- The same commit against itself: 984 / 3,140 px, mean |Δ| 0.07 / 0.24.
- Where it moves: the hatch along the zone's west and north edges, and the roofs, rocks and
  hulls inside the zone that the fill used to tint.

Every gated scenario is a `sandbox=` frame, with no objective zone. They should not move.
Not blessed.

## Which layer does it

On three, the world draws ONE persistent zone layer: the **objective zone**. It covers every
active `hold_for`, `capture`, `raze` and `collapse` objective (`objectiveZonesFor` →
`renderer.objectiveZones`), and it is drawn in `ThreeRenderer.updateOverlays`. Each zone is
three pushes into the shared `OverlayBatch` (`units/overlays.ts`):

| Part | Colour | Alpha | Notes |
|---|---|---|---|
| Halo | `shadow.1` (`WORLD_HALO_COLOR_KEY`) | 0.6 | 0.2-tile band |
| Stroke | state colour | 0.65 (held, target), or pulsing 0.45–0.95 | 0.11-tile band; dashed for not held and contested (VR-36) |
| **Fill** | **state colour** | **0.12** | **the whole rectangle** |

The state colours are `vfx.tracer` (held), `team.neutral` (not held) and `team.hostile`
(contested or target).

The `OverlayBatch` material is `depthTest: false` and `depthWrite: false`. It sits in band 4
(`OVERLAY_RENDER_ORDER`), the HP-bar tier, above every unit and building. The fill is a flat
quad at ground height, so wherever a roof, a wall or a hull projects into the rectangle on
screen, the fill paints over it.

**It is two faults, not one:**

1. **Over everything.** The fill tints buildings and units as well as the ground. In the
   sheet, both Namers in the town turn lime.
2. **Unlit colour in a lit buffer.** The overlay writes its palette colour into the
   composer's HalfFloat target before tone mapping, as if it were a radiance. The lit
   ground it covers is much darker than that, and darker still at dusk or in shadow. So
   12% of `vfx.tracer`, whose linear green channel is 1.0, is not "a 12% tint": it outshines
   the scene it sits on. On Beit Sahwan II at dusk, the fill moves 31% of the frame by a
   mean of 9.3 grey levels.

Not drawn in the world at all, checked:

- ROE flagged and no-fire zones (`roe.flagged_zones`, `&roe`). They appear on the minimap
  only (`ui/ground-marks.ts`). `?sandbox=beit_sahwan_outskirts&roe` was photographed and
  draws nothing in the world.
- The refuge and evacuation zone. That is the GH-279 `pingRefuge` dashed ring, a three-second
  one-shot outline with no fill.

## The options as mocked (sheet columns)

Every option keeps today's halo and stroke unchanged, including the not-held dash. Only the
fill changes.

- **A — outline only.** No fill.
- **B — ground-only tint.** A separate batch that is depth-tested against terrain,
  buildings and units, drawn at the fading-decal band (0). It is **multiplied** onto the lit
  ground (`DstColor × mix(1, colour, 0.3)`), the decal pool's own blend. It therefore takes
  the scene's light and shadow instead of glowing, and stops at every wall and hull.
- **C — hatched edge band.** The same ground-only multiply batch, but only a 0.5-tile band
  inside the edge, with diagonal world-space stripes at full strength. The interior is clear.
- **D — fade with zoom.** B's tint, faded linearly from full at zoom ≤ 0.6 to nothing at
  zoom ≥ 1.0. At default zoom it is A; the bottom row (zoom 0.55) shows it on.

## Measurements

Capture conditions:

- Live three.js renderer, ANGLE/Metal on an M3 Pro, 1400×900 at DPR 1, dev server on :5193.
- Music off, HUD hidden, frame loop frozen.
- Each row is one sim tick and one camera. The force was ordered into or short of the zone
  first, so the zone is explored and occupied.

**Pixels the fill moves against A** (share of the frame with mean |Δ| > 4/255, and the mean
|Δ|):

| Frame | Today | B | C | D |
|---|---|---|---|---|
| III held, zoom 1 | 51.8% / 5.68 | 31.2% / 2.60 | 0.9% / 0.22 | ≈ A |
| III held, zoom 2 | 59.5% / 7.99 | 44.1% / 4.34 | 1.8% / 0.57 | ≈ A |
| III not held, zoom 1 | 36.6% / 3.58 | 31.0% / 2.46 | 1.0% / 0.19 | ≈ A |
| II dusk, zoom 1 | 31.3% / **9.31** | 17.0% / 1.18 | 1.2% / 0.17 | ≈ A |
| II dusk, zoom 2 | 41.0% / **13.84** | 20.3% / 1.43 | 2.0% / 0.32 | ≈ A |

D's residual at zoom ≥ 1 (0.0–0.6%) is the repaint noise floor; by construction it draws
what A draws.

**Cost.**

- B, C and D add one batch, which is **+1 draw call** when a zone is on screen. As mocked,
  the empty batch is still submitted, so a build should hide it when empty.
- Triangles, on the 24×32 town zone: B +6,144 (0.5-tile cells, so the tint can follow relief
  depth-tested); C +440; A −2.
- frame()+sync time: medians are 9.6–14.9 ms across all 45 frames. Every option is within
  ±0.6 ms of today on the same frame, and none is separable from noise. That is 40 samples
  per frame and one machine.

**Colour vision** (CIE76 ΔE between state pairs, `tools/src/cvd.ts`, Machado 2009 at
severity 1.0, on `limestone.2` and `dust.2`):

- Held and not held sit 8.5 / 8.2 apart even on the outline under deuteranopia /
  protanopia. That is already known, and it is why VR-36 dashed not held.
- B's tint collapses them to 0.6 / 1.8, and C's hatch to 6.3 / 4.6.
- Neither a tint nor a hatch can carry the state for those players. **The outline and its
  dash do, in every option**, and they are unchanged.
- Contested and target against either other state stay ≥ 18 under all three CVD sets on
  the hatch. On B's tint they fall to 3.5–17.

## Recommendation

**C, the hatched edge band, built on B's ground-only multiply batch.**

- It is the only option that answers the complaint outright: the town's interior is
  untouched (≈ 1–2% of the frame moves).
- It still marks the zone more strongly than A. The edge reads at default zoom on the dusk
  map, where A's lone line is the faintest thing on screen.
- The band stops at walls and hulls, like a decal.
- Cost: one draw call and a few hundred triangles.

Two follow-ups belong to the build, not the mock:

- Let the not-held hatch break with the outline's dash, so the band says the state too.
- Measure whether the 0.11-tile stroke wants to be heavier on bright day sand. In the
  Beit Sahwan III rows, A, C and D's lime line is thin.

**If the lead prefers the interior still read as "inside", B** at alpha 0.3 is the fallback.
It is ground-only and lit, so it no longer drowns buildings or units, but it still moves
17–44% of the frame.

Either way, the build must take the fill **out of `OverlayBatch`**. The fix for both faults
is the material (depth-tested, multiplied), not a lower alpha. At 0.12 the problem is
already the colour space, not the number.
