/**
 * The opt-in halves of the sandbox: a protected zone, a tunnel route, and an
 * anti-tank ditch.
 *
 * Each exists because a subsystem was unreachable without a mission. Rules of
 * engagement come from `mission.roe.flagged_zones`, tunnels from a map's own
 * `tunnels` array, and a ditch from a `d` in a map's own rows — a sandbox has
 * none of the three, so the ROE X, the tunnel charge cursor and the ditch
 * could not be looked at on any shipped map at all.
 *
 * They are opt-in rather than always-on so the default sandbox stays what it
 * has always been, and so a check for one subsystem is not buried under
 * three others.
 *
 * Pure: dimensions, zones and two anchors in, rectangles, a route and rows
 * out. No sim, no DOM, no URL parsing.
 */

import type { SandboxAnchors } from './sandbox-anchors';

/** Zones whose name marks them protected in the shipped corpus. */
const PROTECTED_ZONE = /clinic|hall|refuge|hospital|school/i;

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
 * and marj_perimeter, `hall_block` and `refuge` on wadi_halam_basin — so
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

/** Markers that read as somewhere civilians are walked TO. Every shipped map
 *  but Tel Marum declares one (`civ_refuge`), and the four missions with a
 *  `civilians` block all name exactly that marker — so preferring it means the
 *  sandbox shepherds people onto the ground an author already chose. */
const REFUGE_MARKER = /refuge|shelter/i;

export interface MarkedMap extends ZonedMap {
  markers?: Readonly<Record<string, readonly number[]>>;
}

export interface SandboxRefuge {
  /** The tile civilians are ordered to. */
  at: readonly [number, number];
  /** The rectangle that counts as "got out": `[x, y, w, h]`. */
  zone: readonly [number, number, number, number];
}

/**
 * Where `&civ`'s crowd is walked to, and the ground that counts as arrival.
 *
 * A mission declares `civilians.refuge` (a marker) and points its
 * `evacuate_before` at a zone; a sandbox has neither, so both are supplied
 * here — the same shape `sandboxFlaggedZones` uses, and for the same reason.
 * The marker half prefers what the map already declares. The ZONE half never
 * does, and that is deliberate rather than lazy: only `wadi_halam_basin`
 * declares a `refuge` rectangle at all, and `CivilianFlight.step` stops
 * re-ordering a civilian standing on the refuge — so a refuge point sitting
 * outside its own arrival zone is a hang, not a miss. Building the box AROUND
 * the point makes that unrepresentable.
 *
 * Tel Marum declares no refuge marker, and falls back to the friendly anchor:
 * the ground the player's own force forms up on is safe by construction, is
 * open by construction (units spawn there), and needs no arithmetic to
 * justify calling it shelter.
 */
export function sandboxRefuge(map: MarkedMap, anchors: SandboxAnchors): SandboxRefuge {
  const declared = Object.entries(map.markers ?? {}).find(
    ([name, p]) => REFUGE_MARKER.test(name) && Array.isArray(p) && p.length >= 2
  );
  const at: readonly [number, number] = declared
    ? [Math.round(declared[1][0]), Math.round(declared[1][1])]
    : [anchors.friendly[0], anchors.friendly[1]];
  const half = Math.floor(SYNTHETIC_SIDE / 2);
  // Clamped like the flagged zone above, and for the same reason: the arrival
  // test is exclusive at the far edge, so a box hanging over the border would
  // silently shrink on the side the civilians walk in from.
  const x = Math.min(Math.max(at[0] - half, 0), Math.max(map.width - SYNTHETIC_SIDE, 0));
  const y = Math.min(Math.max(at[1] - half, 0), Math.max(map.height - SYNTHETIC_SIDE, 0));
  return {
    at,
    zone: [x, y, Math.min(SYNTHETIC_SIDE, map.width), Math.min(SYNTHETIC_SIDE, map.height)],
  };
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

/**
 * Terrain symbols a synthesised ditch is allowed to overwrite.
 *
 * Open ground and the three cover levels only. Deliberately NOT `^`, `b` or
 * any building symbol: a dev flag that quietly deleted a rock ridge or half
 * a building would change the map under the very check it exists to serve,
 * and `d` carries no cover of its own so overwriting a cover tile is already
 * the biggest change it makes.
 *
 * `r`, `o` and `n` are excluded for a subtler reason: they carry a decor kind,
 * and `d` would replace it. A ditch dug straight through the middle of an
 * olive grove is a fine thing to author on purpose and a confusing thing for
 * a flag to do behind your back.
 */
const DITCH_OVERWRITABLE: ReadonlySet<string> = new Set(['.', '1', '2', '3']);

export interface RowMap extends ZonedMap {
  rows: readonly string[];
}

/**
 * `map.rows` with an anti-tank ditch cut across it, for maps that author none
 * — which today is every shipped map.
 *
 * The line is drawn PERPENDICULAR to the axis between the two anchors and at
 * their midpoint, so it lies across the ground a force actually crosses
 * rather than beside it. That is the whole point of the flag: a ditch nobody
 * has to path around proves nothing about the mask.
 *
 * Axis-aligned, and only ever a straight run, which is also deliberate. The
 * ditch asset is a straight prismatic segment and cannot express a bend
 * (`decor-place.ts`'s `ditchYawTurns` documents what happens at a corner) —
 * so a dev flag should demonstrate the case the asset is FOR, not manufacture
 * the case it handles least well. A diagonal or dog-legged synthetic ditch
 * would put a crossing artefact on screen and invite it to be read as a bug
 * in the placement rule.
 *
 * Returns the rows unchanged if nothing on the line is overwritable, rather
 * than forcing a ditch through a building.
 */
export function sandboxDitchRows(map: RowMap, anchors: SandboxAnchors): string[] {
  const rows = map.rows.map((r) => r);
  const [fx0, fy0] = anchors.friendly;
  const [hx, hy] = anchors.hostile;
  // Run the ditch across the LONGER of the two anchor separations: if the
  // two forces are mostly east-west apart, the obstacle between them runs
  // north-south.
  const vertical = Math.abs(hx - fx0) >= Math.abs(hy - fy0);
  const mid = vertical
    ? Math.min(Math.max(Math.round((fx0 + hx) / 2), 0), map.width - 1)
    : Math.min(Math.max(Math.round((fy0 + hy) / 2), 0), map.height - 1);

  const span = vertical ? map.height : map.width;
  for (let i = 0; i < span; i++) {
    const x = vertical ? mid : i;
    const y = vertical ? i : mid;
    const row = rows[y];
    if (row === undefined || x >= row.length) continue;
    if (!DITCH_OVERWRITABLE.has(row[x])) continue;
    rows[y] = `${row.slice(0, x)}d${row.slice(x + 1)}`;
  }
  return rows;
}
