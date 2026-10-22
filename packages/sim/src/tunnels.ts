// Tunnels as first-class sim objects (GDD §2 Ashwar doctrine, §4 phase 6).
//
// A tunnel is a third kind of container, after the building and the carrier.
// A unit inside one cannot be reached by fire — the earth is in the way — and
// the counterplay is destroying the container, exactly as it is for a garrison.
// What makes a tunnel different from a building is its shape: it is a route
// with a moving dig head and a vent, not a footprint, which is why it gets its
// own module rather than a flag on StructureType.

import { fx, type Fx } from './fixed';

/** A route as the sim receives it. The app converts `ParsedTunnel` into this;
 *  `@lions/sim` imports nothing, so the shape is restated rather than shared. */
export interface TunnelRouteJson {
  id: string;
  /** Mouth first, vent last, in tiles. At least two points. */
  points: readonly (readonly [number, number])[];
  dig_tiles_per_s: number;
  /** The route starts fully excavated: progress at full length, vent open.
   *  One of the two ways authored data opens a route — the other is a
   *  placement whose `digs` names it, which excavates live and leaves spoil.
   *  No trail is stamped at load: spoil is what digging leaves behind, and a
   *  route finished before the mission began has weathered. */
  pre_dug?: boolean;
  /** The side that owns the route (GH-681): the only side whose units may
   *  `enterTunnel` it. Absent on every map-file route, which therefore admits
   *  nobody by order (scripted placements and `submerge` are unaffected). A
   *  versus room's rules data sets it on the Sarim seat's routes. */
  side?: number;
  /** How many units an `enterTunnel` order may put inside (GH-681). Absent =
   *  `TUNNEL_CAPACITY_DEFAULT`. Placements and `submerge` do not read it. */
  capacity?: number;
}

/** Trail density stamped on a tile the moment the dig head passes under it. */
export const TRAIL_MAX = 255;
/** Per-tick decay of surface spoil. 255 at 1 per 4 ticks is ~51 s of trail —
 *  long enough to be found and acted on, short enough that a route dug early
 *  and abandoned does not brand the map for the whole mission. */
export const TRAIL_DECAY = 1;
export const TRAIL_DECAY_EVERY = 4;
/** Base signature of spoil on the surface. Well below a unit's: it is a scar
 *  in the dirt, not a man. This is the number that makes recon worth having. */
export const TRAIL_SIGNATURE = 13107; // 0.2
/** Seconds a Yahalom team works before the charge blows, when unit data omits
 *  `tunnel_charge_time_s`. Longer than a building demolition: they are digging
 *  down to the void first. */
export const CHARGE_SECONDS = 8;
/** How close the team must be to the nearest tile of the route: squared
 *  tiles, Q16.16. The route's geometry, not its spoil — identification is
 *  what gates the charge, and it would be absurd for a found route to become
 *  indestructible because the dirt blew away (or, pre_dug, never showed). */
export const CHARGE_RANGE_SQ = 262144; // 4.0 tile² = 2 tiles
/** Minimum seconds a unit stays exposed once it surfaces, on top of its volley.
 *  This is the player's guaranteed reaction slot — see spec, "stepSurfacing". */
export const SURFACE_SECONDS = 3;
/** Shots committed per surfacing. A unit comes up to do something specific
 *  and goes back down; it does not fight a battle from the hole. */
export const SURFACE_VOLLEY = 2;
/** Units an ordered route holds when its data names no `capacity` (GH-681, Q4). */
export const TUNNEL_CAPACITY_DEFAULT = 4;
/** How near the mouth or the vent's tile centre a unit under `enterTunnel`
 *  must stand to go below: squared tiles, Q16.16. One tile. */
export const TUNNEL_ENTER_RANGE_SQ = 65536;
/** Shock of a collapsing route, and its radius². This 0.6 is handed to
 *  splashDirect as a per-near-miss figure and doubled there like every blast
 *  (BOUNCE_SUPP_MULT), so everyone within the radius takes 1.2 before
 *  resistance and cover -- deliberately, by the lead's ruling of 2026-10-13
 *  (until that day the doubling was a no-op and it dealt nothing). Held apart
 *  from structures.ts's COLLAPSE_SHOCK (0.7, applied as is), which sim.ts
 *  already imports unaliased: a different value for a different event, not a
 *  duplicate to fold together. */
export const TUNNEL_COLLAPSE_SHOCK = 39322; // 0.6, dealt as 1.2
export const TUNNEL_COLLAPSE_RADIUS = 131072; // 2 tiles — splashDirect squares it

/** Total length of a polyline, in Q16.16 tiles. */
export function routeLength(points: readonly (readonly [number, number])[]): Fx {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total = fx.add(total, legLength(points[i - 1], points[i]));
  }
  return total;
}

function legLength(a: readonly [number, number], b: readonly [number, number]): Fx {
  const dx = fx.sub(fx.from(b[0]), fx.from(a[0]));
  const dy = fx.sub(fx.from(b[1]), fx.from(a[1]));
  return fx.sqrt(fx.add(fx.mul(dx, dx), fx.mul(dy, dy)));
}

/**
 * The point `d` tiles along the polyline, clamped to both ends.
 *
 * Clamped rather than extrapolated because the caller is a dig head whose
 * progress is compared against the route length elsewhere: letting it run off
 * the end here would put the vent somewhere off the map on the tick before the
 * progress check notices.
 */
export function pointAtDistance(
  points: readonly (readonly [number, number])[],
  d: Fx
): [Fx, Fx] {
  const first = points[0];
  if (d <= 0) return [fx.from(first[0]), fx.from(first[1])];
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const leg = legLength(a, b);
    // Structurally unreachable: d > walked on entry (from failed `d <= next` on prior iteration or pre-loop check),
    // so a zero-length leg makes `d <= walked === next` false. Kept as defensive belt-and-braces against
    // future changes to walked/next accumulation introducing a zero divisor in fx.div below.
    if (leg === 0) continue;
    const next = fx.add(walked, leg);
    if (d <= next) {
      const t = fx.div(fx.sub(d, walked), leg);
      const ax = fx.from(a[0]);
      const ay = fx.from(a[1]);
      return [
        fx.add(ax, fx.mul(fx.sub(fx.from(b[0]), ax), t)),
        fx.add(ay, fx.mul(fx.sub(fx.from(b[1]), ay), t)),
      ];
    }
    walked = next;
  }
  const last = points[points.length - 1];
  return [fx.from(last[0]), fx.from(last[1])];
}
