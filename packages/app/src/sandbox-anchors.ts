/**
 * Where a sandbox force stands on a map nobody authored a sandbox for.
 *
 * The sandbox used to hardcode one map's coordinates, so walking any other
 * map meant writing a throwaway mission and deleting it afterwards. These two
 * anchors let the same formation land on any map that declares markers, which
 * is what makes a new map walkable the moment it exists.
 *
 * Marker names are entirely map-specific — `kdf_assembly`, `kdf_start`,
 * `kdf_crossing`, `start_line`, and nothing shared across all five shipped
 * maps — so nothing here may require a particular name. The rule is a
 * heuristic with a map-relative fallback, and the fallback is the part that
 * has to keep working.
 *
 * Pure and DOM-free: it takes dimensions and a marker table and returns two
 * points, so a test can describe a map without building one.
 */

export type Point = readonly [number, number];

export interface SandboxAnchors {
  /** Where the player's force forms up. */
  friendly: Point;
  /** Where the opposition sits — at contact range, not the far edge. */
  hostile: Point;
}

/** A marker that reads as a player start. Ordered: the first match wins. */
const FRIENDLY_HINTS = [/^kdf[_-]/, /^player[_-]/, /^start[_-]/, /[_-]start$/];

/**
 * Markers no opposition should ever stand on.
 *
 * Every shipped map declares a `civ_refuge`, and the tutorial adds a
 * `clinic_house`. On beit_sahwan_outskirts the refuge sits 28.4 tiles from the
 * player start against the town centre's 27.0 — so a rule that reads distance
 * alone puts the enemy in the civilian shelter, which is both wrong and in the
 * opposite direction from the fight. Excluding a class is not the same as
 * requiring a name: a map that declares none of these still works.
 */
const NEVER_HOSTILE = /civ|refuge|clinic/i;

/**
 * How far across the map the opposition should sit, as a fraction of the
 * longer dimension.
 *
 * NOT the farthest marker, which is the obvious rule and the wrong one. A
 * hostile draws no sprite until a friendly unit sees its tile, so a force
 * parked on the far edge is invisible for the whole opening — the existing
 * sandbox carries a comment about exactly that, after its raider set was
 * first placed at x 45 and could not be found. Contact range is what makes
 * the opposition reachable in the first push.
 */
const CONTACT_FRACTION = 0.6;

const dist = (a: Point, b: Point): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function sandboxAnchors(map: {
  width: number;
  height: number;
  markers?: Readonly<Record<string, readonly number[]>>;
}): SandboxAnchors {
  const entries = Object.entries(map.markers ?? {})
    .filter(([, p]) => Array.isArray(p) && p.length >= 2)
    .map(([name, p]) => [name, [p[0], p[1]] as Point] as const);

  // No usable markers at all: fall back to map-relative thirds rather than
  // throwing. An unmarked map is still worth walking, and a sandbox that
  // refuses to load is worse than one that guesses.
  if (entries.length === 0) {
    return {
      friendly: [Math.round(map.width * 0.1), Math.round(map.height / 2)],
      hostile: [Math.round(map.width * 0.7), Math.round(map.height / 2)],
    };
  }

  const friendly =
    FRIENDLY_HINTS.reduce<Point | null>(
      (found, re) => found ?? (entries.find(([name]) => re.test(name))?.[1] ?? null),
      null
    ) ?? entries[0][1];

  // The marker sitting closest to contact range from the friendly anchor.
  // With one marker this is that marker, which is why the hostile fallback
  // below only fires when it would collide with the friendly anchor.
  const want = CONTACT_FRACTION * Math.max(map.width, map.height);
  const candidates = entries.filter(([name]) => !NEVER_HOSTILE.test(name));
  // If a map declares nothing BUT civilian markers, take them rather than
  // returning no opposition at all — a stacked spawn is caught below.
  const pool = candidates.length > 0 ? candidates : entries;
  let hostile = pool[0][1];
  let best = Infinity;
  for (const [, p] of pool) {
    const err = Math.abs(dist(friendly, p) - want);
    if (err < best) {
      best = err;
      hostile = p;
    }
  }

  // A map with a single marker would put both forces on the same tile, which
  // is a spawn stack rather than a sandbox.
  if (hostile[0] === friendly[0] && hostile[1] === friendly[1]) {
    hostile = [Math.round(map.width * 0.7), Math.round(map.height / 2)];
  }

  return { friendly, hostile };
}
