# Tunnels: the x-ray reveal (GH-471), built

Status: **approved by the lead on 2026-10-08 as mocked, with all three defaults, and
built.** The mock and its decision record are on draft #473, which this PR supersedes.

- `docs/polish/tunnel-xray/sheet.png` puts today next to the BUILT code on both maps.
  It also shows the default-zoom picture and the HUD half of the discovery beat.
- `strip-tel-marum.png` and `strip-beit-sahwan-4.png` show the discovery as nine real
  frames, 250 ms apart, at zoom 2.2. The `-z1` sheets show the same moment at the
  default zoom.
- Instrument: `pnpm tunnel:capture -- --out=<dir> [--port=5194]`
  (`tools/src/perf/tunnel-xray-captures.ts`).
  - It uses one headless Chromium on ANGLE/Metal and its own Vite server, refusing
    5177 or a busy port. Music is off.
  - The drone is ordered with a real right-click on the canvas.
  - The rAF loop is frozen and every frame is a `step()` on the sim clock.

## The approved rules

1. **The fighters inside.** One hostile silhouette per occupant (`state.tunnelIn`), so
   the count shown is the real one. The walk is invented: the sim keeps no position for
   a buried unit, so each figure has a home on the route chosen by id and paces either
   side of it on the sim clock.
2. **The whole route lights** while any `mark_tunnel` carrier of side 0 sees any tile of
   it (`markerSeesTile`, read at the trail's 5 Hz refresh).
   - Once nobody holds it, it fades toward 0.3 over the window in which the sim forgets
     it, then goes out on `lost`.
   - That window, ~322 ticks or ~16.1 s, is derived from `CONTACT_DECAY` and `LOST_AT`.
     `@lions/sim` does not export them, so they are copied into
     `three/tunnel-xray-state.ts` and pinned against `tuning.ts` as text, the
     `PROJ_SPEED` pattern.
3. **It draws through roofs and ridges, and fog dims it.**
   - The bore and figures carry the occlusion silhouette's own flags: `GreaterDepth`
     plus the unit stencil. They show only where something is in front of them, and
     never over a unit body.
   - The fog post pass dims by the ground in front of a pixel.
4. **The discovery beat.**
   - On the first `tunnelContact` identified event per route per mission, a beam runs
     from the finder and a white-hot sweep travels along the route from the nearest
     point.
   - The feed gets one line, "**tunnel found** — route and shafts marked · {place}",
     tier important, tone warn, cue `alert.important`. Several routes found in one tick
     read as "N tunnels found".
   - The minimap gets the VR-36 ring at the finder. While the route stays identified it
     also shows a `--intercept` route line with a square at each shaft.
   - A later re-acquisition re-runs the sweep quietly: no beam, a quarter of the flash,
     no alert.
5. **Suspected routes are unchanged:** spoil tint and spoil heap only.
6. **The trail's identified-line rung is retired.** The renderer asks the trail for the
   spoil rung only (`ThreeRenderer.buildTrailInput`). `trailTileAlpha` keeps the rung
   as a tested fact.

Invariant 4: everything above is a read of `tunnelContactLevel`, `markerSeesTile`,
`state.tunnelIn`, `tunnelPointAt`/`tnLength`, or the `tunnelContact` event. Nothing
writes to the sim. There is no change under `packages/sim`.

## What changed from the mock

- **Back faces only.** The near-wall "glass" is gone. Its silhouette and the far
  wall's disagreed by a sliver at every 0.25-tile ring, which photographed as a
  sawtooth along the bore's lower edge. The rim is now computed on the back faces from
  the same normal.
- **Rules moved into a pure module.** `three/tunnel-xray-state.ts` is three-free and
  tested as numbers. `three/tunnel-xray.ts` is the GPU half.
- **No draw while nothing is identified.** A tunnel map with nothing identified, and
  every map with no tunnel, submits 0 draws.
- **Render bands are named in `units/render-order.ts`.**
  - `TUNNEL_XRAY_RENDER_ORDER` 0.25 covers the bore, shafts and collars.
  - `_FIGURE_` 0.3 and `_BEAM_` 0.35 follow.
  - All sit above the trail and decals and below the selection ring, with a test and a
    table row.
- **New debug layer `tunnel-xray`.** It is a flag, the `missiles` shape, because
  `update` rewrites the figures' and beam's visibility every frame.
- **Disposal.** `TunnelXray.dispose()` runs from `ThreeRenderer.dispose()`.
- **Bore rebuilds.** The bore is rebuilt when the route set or the elevation grid
  changes.

## Cost (measured on the built code, Metal M3 Pro, zoom 2.2)

Draw calls and triangles were counted with `info.autoReset` off over one repaint, with
the group toggled. Frame time is 3 rounds x 60 repaints, with `gl.finish` inside the
clock.

| scene | draw calls | triangles | frame ms on / off |
|---|---|---|---|
| tel_marum `&tunnel`, 1 route, 0 inside | +2 (231 → 233) | +1,328 | 4.46 / 4.40 median: noise |
| beit_sahwan_4, 4 routes, 4 figures shown | +3 (408 → 411) | +8,640 | 4.59 / 5.05 median: noise |

The ceiling is **4 draws** (bore, collars, figures, and the beam for 1.2 s), whatever
the number of routes or fighters. A test pins it at 16 routes and 200 occupants. None
of these meshes reaches the shadow or AO passes.

## Tests (each seen red under a one-line mutation, then green)

`tunnel-xray-state.test.ts`, `tunnel-xray.test.ts`, `ThreeRenderer.tunnel-xray.test.ts`
(a real `Sim`), `render-order.test.ts`, `alerts.test.ts`, `minimap-tunnels.test.ts`
(a real `Sim`). Seventeen mutations, all red; the list is in the commit message.

## Known remaining

- **Figures are a procedural crouched man.** They are not each type's own silhouette
  geometry.
- **The minimap line does not fade with the world's lapse.** It shows while the route
  is identified.
- **No gated golden scenario contains a tunnel.** `relief` frames `tel_marum` without
  `&tunnel`, so the visual gate should read no change. CI's `visual` job is the
  confirmation; nothing is blessed here.
