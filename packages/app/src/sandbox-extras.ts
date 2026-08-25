/**
 * The opt-in halves of the sandbox: a protected zone, and a tunnel route.
 *
 * Both exist because a subsystem was unreachable without a mission. Rules of
 * engagement come from `mission.roe.flagged_zones`, and tunnels from a map's
 * own `tunnels` array — a sandbox has neither, so the ROE X and the tunnel
 * charge cursor could not be looked at on most maps at all.
 *
 * They are opt-in rather than always-on so the default sandbox stays what it
 * has always been, and so a check for one subsystem is not buried under
 * three others.
 *
 * Pure: dimensions, zones and two anchors in, rectangles and a route out. No
 * sim, no DOM, no URL parsing.
 */

import type { SandboxAnchors } from './sandbox-anchors';

/** Zones whose name marks them protected in the shipped corpus. */
const PROTECTED_ZONE = /clinic|mosque|refuge|hospital|school/i;

/** Side of the synthesised zone, in tiles, when a map declares none. */
const SYNTHETIC_SIDE = 4;

export interface ZonedMap {
  width: number;
  height: number;
  zones?: Readonly<Record<string, readonly number[]>>;
}

/**
 * Rectangles the sandbox should treat as no-fire ground.
 *
 * Prefers what the map already declares — `clinic` on beit_sahwan_outskirts
 * and marj_perimeter, `mosque_block` and `refuge` on wadi_halam_basin — so
 * the flagged ground is somewhere an author already thought about.
 *
 * Tel Marum declares none (`valley_floor`, `pass`, `overwatch_east/west`),
 * and it is also the only map with relief, so synthesising one is what makes
 * the protected X reachable on the map that most needs looking at. The
 * synthetic zone sits midway between the two anchors: on the ground a player
 * crosses, rather than tucked behind either force.
 */
export function sandboxFlaggedZones(map: ZonedMap, anchors: SandboxAnchors): readonly number[][] {
  const declared = Object.entries(map.zones ?? {})
    .filter(([name, z]) => PROTECTED_ZONE.test(name) && Array.isArray(z) && z.length >= 4)
    .map(([, z]) => [z[0], z[1], z[2], z[3]]);
  if (declared.length > 0) return declared;

  const [fx0, fy0] = anchors.friendly;
  const [hx, hy] = anchors.hostile;
  const half = Math.floor(SYNTHETIC_SIDE / 2);
  const cx = Math.round((fx0 + hx) / 2);
  const cy = Math.round((fy0 + hy) / 2);
  // Clamp so the rectangle stays inside the map rather than half off it —
  // zoneContains is exclusive at the far edge, so a zone hanging over the
  // border would silently shrink.
  const x = Math.min(Math.max(cx - half, 0), Math.max(map.width - SYNTHETIC_SIDE, 0));
  const y = Math.min(Math.max(cy - half, 0), Math.max(map.height - SYNTHETIC_SIDE, 0));
  return [[x, y, Math.min(SYNTHETIC_SIDE, map.width), Math.min(SYNTHETIC_SIDE, map.height)]];
}

export interface SandboxRoute {
  id: string;
  points: readonly (readonly [number, number])[];
  dig_tiles_per_s: number;
  pre_dug: boolean;
}

/**
 * A tunnel route for maps that declare none.
 *
 * Runs from near the hostile anchor toward the friendly one, which is the
 * direction a tunnel is for — infrastructure reaching out from the defender's
 * ground. `pre_dug` because a sandbox is for looking at a finished thing, not
 * for waiting out a digger.
 *
 * The route is NOT identified by construction: a `mark_tunnel` carrier still
 * has to see it, which is the mechanic the charge cursor depends on. Handing
 * over an identified route would make the sandbox prove something the game
 * does not do.
 */
export function sandboxTunnelRoute(map: ZonedMap, anchors: SandboxAnchors): SandboxRoute {
  const clamp = (v: number, hi: number): number => Math.min(Math.max(Math.round(v), 0), hi - 1);
  const [fx0, fy0] = anchors.friendly;
  const [hx, hy] = anchors.hostile;
  // Start just inside the hostile side and reach a third of the way toward
  // the friendly anchor: long enough to walk along, short enough that both
  // ends sit on ground the sandbox force can actually get to.
  const start: [number, number] = [clamp(hx, map.width), clamp(hy, map.height)];
  const end: [number, number] = [
    clamp(hx + (fx0 - hx) / 3, map.width),
    clamp(hy + (fy0 - hy) / 3, map.height),
  ];
  return {
    id: 'sandbox_route',
    points: [start, end],
    dig_tiles_per_s: 1,
    pre_dug: true,
  };
}
