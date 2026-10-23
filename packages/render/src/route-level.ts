/**
 * GH-681: how much of tunnel route `r` the player on side `viewer` may be
 * shown -- the ONE presentation read every route draw asks (the world's
 * x-ray, the mouth and vent pieces, the spoil trail, the minimap mark).
 *
 * A route the viewer's own side owns (`Sim.tunnelOwner`, a versus room's
 * Sarim end) is always level 2: the seat dug it, so it sees the bore, both
 * shafts and its own men below, always (versus tunnels spec §4.2). Every
 * other route is whatever the sim says the viewer's side has found
 * (`Sim.tunnelContactLevel`: 0 none, 1 suspected, 2 identified) -- so a route
 * the other seat owns gives nothing away until it is found (§4.3).
 *
 * Single-player owns no route (map-file routes have no owner, -1), so there
 * this is exactly `tunnelContactLevel(viewer, r)`, the read it replaced.
 *
 * Zero imports: the app's minimap calls it too, so a second spelling of the
 * owner rule cannot drift from the renderer's.
 */
export interface RouteLevelSource {
  tunnelOwner(r: number): number;
  tunnelContactLevel(side: number, r: number): number;
}

export function routeLevelFor(sim: RouteLevelSource, viewer: number, r: number): 0 | 1 | 2 {
  if (sim.tunnelOwner(r) === viewer) return 2;
  const lv = sim.tunnelContactLevel(viewer, r);
  return lv >= 2 ? 2 : lv === 1 ? 1 : 0;
}

/** True when side `viewer` owns route `r` -- the routes a seat may send its
 *  own foot units down (`enterTunnel`, T-R4). */
export function ownsRoute(sim: Pick<RouteLevelSource, 'tunnelOwner'>, viewer: number, r: number): boolean {
  return sim.tunnelOwner(r) === viewer;
}
