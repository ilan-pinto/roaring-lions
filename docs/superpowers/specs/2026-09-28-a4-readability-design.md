# WP-A4: readability remainder. Design

GitHub #186 · art Phase 4 · lane A · base `main` `1035b18c` (v0.89.1) · three.js only; Pixi owes no parity · the sim is untouched.

## 1. Measured current state

Paths are under `packages/render/src/three/` at `1035b18c`.

- **One loop draws every unit overlay.** `ThreeRenderer.updateOverlays` (`ThreeRenderer.ts:7695`) runs once per `frame()` (`:3085`) over every living unit. It skips a non-player unit only when fogged (`:7717`). Everything goes into one `OverlayBatch`, a non-instanced mesh with `depthTest: false`, at `OVERLAY_RENDER_ORDER = 4` (`units/render-order.ts:240`).
- **HP bars draw unconditionally.** Every visible unit gets one, at any health (`:7773-7786`): a 24 × 3 px `shadow.1` backing at α 0.8 and a ratio-scaled fill at α 1, at `-(r+10)` px, with `r` 7 soft / 11 hard (`unitOverlayRadiusPx`). The fill key is `hpBarColorKey`. Structures already draw theirs only once damaged (`:7892`).
- **The selection ring is a billboard.** It is a screen-space ellipse stroke (`:7838-7843`): `ellipseRing(billboardPoint(anchor, 0, -2), r+7, (r+7)/2, 2 px, groupColor || vfx.tracer, α 1)`. It sits on the roof when garrisoned (`:7730-7735`), paints over buildings, ignores slope, and is coloured by control group or lime, never by team. At zoom 1 its radius is 14 px soft (0.31 tile) and 18 px hard (0.40 tile), smaller than an MBT hull.
- **Overlays scale with zoom** (CLAUDE.md); px figures are at zoom 1.
- **Hover already exists.** `main.ts:4463-4478` writes the hostile hover to `hoverEntity`, and `:4497-4517` the friendly unselected one to `rangeRingPreview`, every frame, with no delay. Both are on the seam (`api.ts:415`, `:426`), so **A4 needs no new seam field.**
- **The outline** (`units/silhouette.ts`, band 6) is unaffected and is kept.
- **The decal pool** (`decal-pool.ts:214`) is a sim-time-dated ring buffer whose material *multiplies* an albedo ratio onto lit ground (F-22): the wrong blend for a bright mark, and a per-frame rewrite would fight its per-slot uploads. Its pure half is reusable: `writeDecalGrid`, `writeDecalOffsets`, `writeGridIndices`, `gridTriangles` (`decal-maths.ts:230-420`), with the conforming sag lift and `DECAL_POLYGON_OFFSET_*`.

## 2. Design

### 2.1 HP bar visibility rule

A unit's HP bar draws when any of these holds:

```
hp[i] < type.hp                      // damaged: raw Q16.16 compare, any damage
|| selection.includes(i)
|| i === hoverEntity                 // hostile hover
|| i === rangeRingPreview            // friendly hover
```

Every side; the fog gate already hides unobserved enemies. No hover delay or linger. The rule is a pure predicate, `hpBarVisible(...)`, in `units/overlays.ts`. The restyle adds a 1 px dark frame; size, colours and offset are unchanged, and so are the suppression bar (own `> 0.02` rule), kill pips, badge, chevron and structure bar.

### 2.2 Selection ground ring

A new `SelectionRingBatch` (`units/selection-ring.ts`): one non-instanced mesh rewritten each frame. Each ring is an `n = 4` grid placed by `writeDecalGrid`, so it lies on bicubic ground and slopes; the fragment shader draws an annulus from the `aOffset` radius with a feather (antialiasing is off).

- **Material.** Unlit, "over" blend, `depthTest: true`, `depthWrite: false`, decal polygon offset, no shadows, parented beside the decal meshes.
- **Render order.** New `SELECTION_RING_RENDER_ORDER = 0.5`: above `DECAL_FADING_RENDER_ORDER` (0, over tread prints), below `TURRET_RENDER_ORDER` (1) and FX, pinned in `render-order.test.ts`. The unit's body depth-occludes the ring's inside: the "under the feet" read.
- **Colour.** `opts.teamColors[side[i]]` (CVD-aware; `team.kedem` for the player). Group colour stays on the badge.
- **Where the billboard ring is kept.** A **garrisoned** unit (a ground ring would be under the building), and any unit past `SELECTION_RING_CAPACITY`, so no selection is silently invisible.
- **Air units.** Ground ring under the existing air shadow.
- **Behind a building.** The ring is occluded; the kept outline and the selected unit's HP bar (overlays are `depthTest: false`) carry it. Nothing new.

### 2.3 What is not built

- No new in-world element: frame and halo restyle existing marks, and both are mocked (Task 4) before wiring.
- No sub-tile formation spread (issue: "only if formations leave a case that needs it"); the Task 5 drive records whether one is needed.
- Nothing in Pixi, `api.ts` or `packages/sim`.

## 3. Numbers table (for lead approval, gate G-NUM)

World sizes are in tiles. The px figure is at zoom 1, where 1 tile of radius ≈ 45.3 px horizontally (`TILE_W · √½`).

| Item | Proposed | Today | Notes |
|---|---|---|---|
| HP bar rule | damaged ∨ selected ∨ hovered (either hover) | always | no damage threshold: any chip counts |
| HP bar size | 24 × 3 px fill; 26 × 5 px frame | 24 × 3 px, no frame | offset unchanged, `-(r+10)` |
| HP bar colours | fill `scrub.0` / `team.neutral` / `team.hostile` at >0.5 / >0.25 / else; frame `shadow.1` | same fill; backing `shadow.1` | frame α 0.8, fill α 1 |
| Hover delay / linger | 0 ms / 0 ms | n/a | same clock as the range-ring preview |
| Ring radius, foot (`!wheeled && !isAir`) | 0.45 (20 px) | 0.31 (14 px) | outer edge of the core |
| Ring radius, light vehicle (`wheeled && isSoft`) | 0.55 (25 px) | 0.31 | jeep, technical, moto |
| Ring radius, armour (`wheeled && !isSoft`) | 0.70 (32 px) | 0.40 (18 px) | must clear the Lavi hull |
| Ring radius, air (`isAir`) | 0.35 (16 px) | 0.31 / 0.40 | centred under the shadow |
| Radius rule | `max(class value, 1.15 × measured half-diagonal of the class's largest shipped GLB footprint)` | n/a | Task 1 measures; it may raise a row, never lower one |
| Ring thickness | 0.06 (2.7 px), floor 1.5 screen px | 2 px | the floor holds at zoom 0.35 |
| Feather | 0.015 each edge | none | shader smoothstep |
| Ring core alpha | 0.90 | 1.0 | |
| Halo | `shadow.1`, α 0.35, 0.03 wide, outside the ring only | none | the objective-zone precedent |
| Ring colour | `team.kedem` via `teamColors[side]` (CVD variants follow) | group colour / `vfx.tracer` | |
| Capacity | 256 rings (18 tris each) | n/a | beyond it, billboard fallback |

**Palette keys:** `team.kedem`, `shadow.1`, `scrub.0`, `team.neutral` and `team.hostile`. None is new. The ring no longer uses `vfx.tracer`.

## 4. Visual gate effect

Gated scenarios (`tools/src/golden-diff/baseline.ts`): `quiet`, `open-ground`, `vehicle`, `relief`, `aftermath`. None selects anything, which is a stated precondition (`baseline.ts:264`). So **the ring appears in no baseline**, and only the HP bar rule moves pixels.

| Scenario | Expected | Why |
|---|---|---|
| `vehicle` (300 px / 0.02) | **moves** | full-health sandbox vehicles lose their bars |
| `relief` (40 px / 0.004) | **moves** | the recon drone's bar goes (zoom 2, ≈ 290 px) |
| `quiet` | unchanged | no unit in frame |
| `open-ground` | unchanged | the region crop excludes the infantry |
| `aftermath` | unchanged | no unit in frame |
| `combat`, `dusk` | report-only | `combat` moves and does not vote |

Layer self-checks do not move (both photographs lose the same bars). **One bless**, from CI numbers on `linux-x64-swiftshader`, once the PR's `visual` job shows these two moves and nothing else. New precondition: `hoverEntity === -1` too, since a hover now draws a bar; Task 6 asserts it in the capture script.

## 5. Perf budget

| | Draw calls | Vertices / tris | CPU per frame |
|---|---|---|---|
| HP rule | ±0 | −12 verts per healthy visible unit | saves pushes |
| Ring | **+1 while ≥ 1 unit is selected**, 0 otherwise (the mesh is invisible at count 0) | +18 tris, −96 overlay verts per selected unit | 16 + 9·25 = 241 ground samples per ring |

Budget: **≤ 0.25 ms p95** added to `frame()` at 100 selected, via `tools/src/perf/render-frame-cost.ts`. Over it, cache each grid by entity and quantised position. GPU cost: at most 256 small quads.

## 6. Open questions (each with a recommended default)

| # | Question | Default |
|---|---|---|
| Q1 | Ring in team or control-group colour? | **Team** (the issue). Group colour stays on the badge; update `palette.json`'s `group.role` note. |
| Q2 | Should any damage show the bar, or only below 95%? | **Any.** A chip is real information. |
| Q3 | Suppression bar follows the HP rule? | **No**: own `> 0.02` rule, transient state. |
| Q4 | Halo on the ring? | **On**, unless the mock shows it muddy on green ground. |
| Q5 | HP bar width per class (foot 20 / vehicle 28)? | **No.** Keep 24 px everywhere. |
| Q6 | A gate witness for the ring? | **Not in A4.** Tests and the drive pin it; the gap goes in HANDOVER. |
| Q7 | Garrisoned units: billboard ring at roof height? | **Yes**, the one retained billboard case. |
| Q8 | A hover linger against flicker? | **No** (0 ms) unless the drive shows flicker. |

## 7. Deviations recorded during Task 5

- **Vehicles get an ellipse, not a circle** (G-MOCK, the lead, 29 Sep: "Team colour + ellipse").
  - The semi-axes start at the hull half-extent + 0.30 tile. Fix round 1 then scales them, at the same aspect, until all four hull corners are inside. The Namer, Eitan, D9 and Kipod grew.
  - The ellipse is centred on the hull box, not the unit origin. For example, the Lavi's hull sits 0.18 tile behind its origin.
  - All of this is data in `ELLIPSE_BY_TYPE`, generated by `tools/src/perf/unit-footprints.ts`.
- **Larger rings use finer conforming grids.** A ring uses 6×6 when its larger semi-axis exceeds 0.75 tile, and 7×7 when it exceeds 1.4 tile (fix round 2). The 4×4 grid of §2.2 buried a Namer's ellipse on relief, and so did 6×6 once the Namer's ring had grown to hold its hull corners. The measurements are in `readability.ts`, and `tools/src/ring_burial.test.ts` holds the burial limit at 0.02 wu.
- **The §5 cache is keyed per slot, not by quantised position.** A ring's grid is rebuilt only when its unit has moved more than 0.05 tile, or turned more than about 2°, since the last build, or its shape changed. The lead accepted the moving cost on relief on 29 Sep ("Cache + accept"); `docs/PERFORMANCE.md`, "Selection ring (A4)", has the numbers.
- **The ring follows the sim position, not the drawn hull.** The hull draws with a lag-and-recoil offset of up to 0.25 tile (`MAX_DRAWN_OFFSET_TILES`), so the ring can sit slightly off the hull while a vehicle accelerates or fires. The lead ruled on 29 Sep that this is fine; it is left as is.
