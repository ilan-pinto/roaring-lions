# Tunnels: the x-ray reveal (GH-471) — mock for approval

Status: **mock, waiting for the lead.** Nothing in this branch ships. The frames come
from a patched local build. The patch is `docs/polish/tunnel-xray/mock.patch`, and
`git apply` re-creates it on `origin/main` at `864deb07`. None of that code is in the
tree.

- `docs/polish/tunnel-xray/sheet.png`: today and the mock side by side on both maps,
  the default-zoom picture, and the HUD half of the discovery beat.
- `strip-tel-marum.png` and `strip-beit-sahwan-4.png`: the discovery, nine real frames
  250 ms apart (0–2 s) at zoom 2.2.
- `strip-*-z1.png`: the same moment at the default zoom 1.0.

Capture conditions: one headless Chromium on ANGLE/Metal (Apple M3 Pro), 1440x900 at
DPR 1, music off, its own Vite server on :5194. On both maps the drone is ordered with
a real right-click on the canvas. `__lions.sel` sets the selection and clears it again
before every frame. The rAF loop is frozen and each frame is a `step()` on the sim
clock, so the strip is deterministic. Instrument: `tools/src/perf/tunnel-xray-captures.ts`,
which is inside the patch.

## Today

- **The "red mark"** is the trail's identified-line rung (`trail.ts`, `trail-mesh.ts`):
  `terrainTones.spoil` (`terracotta.1` on arid maps) at alpha **0.18**, one flat quad per
  tile. It draws only on tiles a `mark_tunnel` carrier can see right now
  (`Sim.markerSeesTile`). On sand it sits about one value step off the ground, so it is
  easy to miss (sheet row 1, left). On a dusk map with fog it is close to invisible
  (row 2, left).
- **Mouth and vent props** (`tunnel-props.ts`) appear at level 2. **Spoil** appears at
  level ≥ 1 wherever any side-0 unit can see it. A `pre_dug` route has no spoil, so on
  Beit Sahwan IV the line is the only cue.
- **Nothing outside the world reacts.** No app code reads `tunnelContact`: there is no
  feed line, no minimap mark and no cue. The event already carries `observer`, the
  carrier's entity id, and `mission.ts` uses it for `routeFoundBy`.
- **Fighters inside** have `state.tunnelIn[i] = r` and **no position along the route**.
  `posX/posY` stays where they went under: the placement point, or the vent. The
  renderer, the minimap and picking all skip them.

## The mock

Everything here only reads the sim (invariant 4). It reads `tunnelPointAt`/`tnLength`
for geometry, `tunnelContactLevel` plus `markerSeesTile` over the route's own tiles for
"held", `state.tunnelIn` for occupants, and the `tunnelContact` event for the beat.
Pulses and fades run on `presentationSimMs`, so a pause holds them and a pinned tick
repeats.

1. **The bore.** An arched tube (1.2 x 1.7 m) sits 0.62 tile under the drawn ground,
   along a 3-tile moving average of the surface. It is never closer than a bore height
   to the surface, so it does not climb a cliff face or break through on a crest. It is
   drawn with the occlusion silhouette's own flags: `GreaterDepth` plus the unit stencil
   (`SILHOUETTE_MATERIAL_FLAGS`). It therefore shows only where the ground hides it, and
   never over a unit standing on it. The far wall and floor (back faces) are a dark
   `shadow.1` cut with a cold edge, which reads as a trench in the earth. The near wall
   is glass with a `vfx.interceptor` rim. One scan band runs mouth → vent every 2.5 s.
2. **Shafts and vents.** A vertical shaft runs from the bore up to the surface at the
   mouth and at the vent. Each gets a flat surface collar, and the vent's collar breathes
   because it is where fighters come up. They are part of the tunnel itself, not a
   status mark.
3. **Fighters inside.** One small crouched figure per occupant, in a `team.hostile` rim
   under the same x-ray flags. Each paces ±1.1 tiles around a home point on the route
   chosen by id hash. That position is presentation, because the sim keeps none. A
   figure is revealed only once the pulse has passed it.
4. **The discovery beat** (`tunnelContact`, side 0, `identified`):
   - a `vfx.interceptor` beam from the finder (at drone height for air) down to the
     nearest point of the route, fading over 1.2 s;
   - a `vfx.white_hot` front that sweeps the route both ways from that point at
     12 tiles/s. The bore appears behind it and the flash settles over 1.6 s;
   - one feed line, "**tunnel found** — route and shafts marked · {place}", tier
     important, tone warn, cue `alert.important` from the existing bus. No new sound.
     Several routes found in one tick merge into "**3 tunnels found**";
   - the VR-36 important/warn ring at the finder on the minimap, and while the route
     stays identified, a `--intercept` route line with two shaft squares. `--intercept`
     is the theme token already mapped to `vfx.interceptor` and unused until now;
   - once per route per mission. Picking a route up again later re-runs the sweep with
     no beam, a quarter of the flash, and no alert.
5. **Fade when identification lapses.** The bore is at full strength while any carrier
   sees any tile of the route. Once none does, it fades linearly toward 0.3 over 16 s,
   the same window in which the sim's contact decays to `lost` (~322 ticks). On `lost` it
   goes out in about half a second.
6. **Suspected but not identified: spoil only, unchanged.** The spoil tint and the spoil
   heap stay as they are. There is no bore, no feed line and no minimap mark until a
   detector reads the route. This keeps the reason to fly the drone (`trail.ts`: "anyone
   can see dirt; only a detector reads the route").
7. **The trail's identified-line rung retires.** The bore replaces it and the spoil rung
   stays. Without this, the red tiles and the bore draw twice at slightly different
   screen positions (sheet row 1).

### Render order (proposal, for `units/render-order.ts`)

`TUNNEL_XRAY_RENDER_ORDER = 0.25`, a fractional band between `TRAIL`/`HULL` (0) and
`SELECTION_RING` (0.5), following that file's own precedent for squeezing between two
adjacent constants. The figures sit at +0.05 and the beam at +0.1, inside the band.

Why 0.25:
- **Above the surface trail and decals.** The cut must read through the spoil tint.
- **Below the selection ring, FX (2), overlays (4), smoke (5) and the occlusion
  silhouette (6).** A tracer, an HP bar or a smoke screen over the tunnel must still
  win.
- **Bodies cannot be affected.** The stencil already keeps the bore off every unit
  body, so the band never decides that.

Fog is a post pass. It dims the bore by the GROUND position in front of it, so a route
under unexplored ground is dimmed like the ground (sheet row 3, right). See decision 3.

### Cost (measured)

Measured with `info.autoReset` off over one repaint, the group toggled on and off, at
zoom 2.2:

| scene | draw calls | triangles | frame ms on / off (3 rounds x 60 repaints, `gl.finish`) |
|---|---|---|---|
| tel_marum sandbox, 1 route, 0 inside | **+2** (231 → 233) | +1,624 | 5.51 / 5.41 median (noise ±0.3) |
| beit_sahwan_4, 4 routes, 2 inside | **+3** (408 → 411) | +10,424 | 9.07 / 6.81 median, rounds 5.6–10.5 both ways: inside the noise |

- **Draw calls are constant:** bore and shafts, collars and figures, plus 1 more for
  the beam's 1.2 s. They stay constant whatever the number of routes, because all
  routes share one merged geometry and per-route state rides in uniform arrays (≤ 16 =
  `MAX_TUNNELS`).
- **Nothing is skinned.** Figures are one InstancedMesh, ≤ 64.
- **None of these meshes reaches the shadow or AO passes.** The +2/+3 is the whole
  count across every pass.
- **CPU:** under the 0.1 ms timer resolution per frame. The 5 Hz route-state read is
  `markerSeesTile` over each identified route's own tiles (≤ ~40), with an early exit.

## Decisions for the lead

1. **Do we show the fighters inside, and how many?** The mock draws every occupant of
   an identified route as a hostile silhouette, so the player learns the real count. A
   flamethrower-style decision follows from it: the alert layer is otherwise careful
   never to name an enemy nobody engaged. The positions are invented, because the sim
   keeps none, though the count is true. Options:
   - **(a)** as mocked, every fighter;
   - **(b)** only "occupied", one generic silhouette whatever the count;
   - **(c)** no figures, the bore only.

   The lead's brief asked for (a). It is still flagged because it hands over information
   no other channel gives.
2. **How much of the route, and for how long?** The mock reveals the WHOLE route while
   any carrier sees any part of it, then fades over the sim's own 16 s decay. Today only
   the tiles a carrier sees right now draw. The alternative keeps today's rule and lights
   only the carrier-seen stretch, with the rest a faint ghost.
3. **What does the x-ray see through?** The mock draws through everything except unit
   bodies, so a route under a roof or behind a ridge paints over the roof. It also
   accepts fog's dimming: on Beit Sahwan IV's unexplored north the bore is half-dimmed.
   - **Cleaner:** a ground-only window, drawn only where the occluder is the ground
     itself. That needs the depth test moved into the fog post pass. It costs +0 draw
     calls but a pass-shader change, and lets the bore skip fog dimming if wanted.
   - **Colour:** cyan `vfx.interceptor` on a `shadow.1` cut, `vfx.white_hot` for the
     pulse, `team.hostile` for the figures. It follows colour-vision settings through
     `resolveColor`.

Smaller calls a build would make unless the lead objects:
- retire the red identified-line rung (item 7);
- once per route per mission for the alert;
- bore depth 0.62 tile. Its image sits ~20–30 px below the surface trace at zoom 2.2,
  which is the depth cue; the charge cursor still targets the surface tiles;
- sound stays on `alert.important`, with no bespoke cue.

## Known issues in the mock (would be fixed in the build)

- **Sawtooth.** At zoom 2.2 a faint sawtooth runs along the bore's lower edge. It is the
  floor back faces showing past the near wall's silhouette at each 0.25-tile ring. The
  fix is a per-sample frame with a consistent up vector, or a ribbon instead of rings.
- **Figures are a procedural crouched man.** The build would reuse each type's own
  silhouette geometry (`units/silhouette.ts`) at bore scale.
- **The minimap line is not faded.** It does not follow decision 2's fade.
- **No tests.** The mock carries none. The build needs: the state rule (level, held,
  fade, once-per-route), the alert's once-per-route coalescing, and render-order
  placement.

WORK PACKAGE: GH-471 tunnel x-ray — design + mock (no shipping change)
- **Changed:** docs only (this note, four sheets, `mock.patch`).
- **Why:** the lead's 8 Oct ask. The identified route is a 0.18-alpha tint with no
  feed, minimap or cue.
- **Player-visible improvement:** none until approval. The mock shows the route, the
  shafts and the fighters, plus a discovery moment that cannot be missed.
- **Tests:** none, since no code ships.
- **Visual evidence:** above.
- **Known remaining issues:** listed above.
- **Next priority:** the lead's three decisions, then the build.
