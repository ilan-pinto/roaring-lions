import type { ParsedMap } from '@lions/data';
import type { TunnelRouteJson } from '@lions/sim';

/** A parsed route as the sim's `addTunnel` (and a mission context's `tunnels`) takes it. The one
 *  conversion `main.ts` and `buildMatchWorld` share, so the owner and capacity of a versus route
 *  reach the sim from whichever array they read. */
export function tunnelRouteOf(t: ParsedMap['tunnels'][number]): TunnelRouteJson {
  return {
    id: t.id,
    points: t.points,
    dig_tiles_per_s: t.digTilesPerS,
    pre_dug: t.preDug,
    ...(t.side !== undefined ? { side: t.side } : {}),
    ...(t.capacity !== undefined ? { capacity: t.capacity } : {}),
  };
}
