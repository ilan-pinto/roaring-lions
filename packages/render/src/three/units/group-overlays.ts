/**
 * WP-P3 (PA-09): what a GROUP selection draws, as plain arithmetic.
 *
 * Until this, every selected unit drew its own range envelope and its own
 * route: fourteen squads box-selected and sent somewhere drew fourteen
 * overlapping annuli and fourteen lime lines, over the very ground the player
 * was ordering onto (polish audit play-31/play-32). Three rules replace that,
 * and every one is a pure function here so the counts are a test rather than
 * a look at a picture (`ThreeRenderer.group-clutter.test.ts` reads them back
 * off the real renderer):
 *
 * 1. **One envelope for the selection, plus one preview.** The envelope draws
 *    for the selection's PRIMARY only; the friendly under the cursor -- in
 *    the selection or not -- adds a preview at reduced strength. Two at most,
 *    whatever the selection's size. A single selection is unchanged: its one
 *    unit is the primary.
 * 2. **One route per command.** Units whose final destinations sit within
 *    `GROUP_ROUTE_LINK_TILES` of one another are one order (a group order
 *    lands in formation, `packages/sim/src/formation.ts`, so its slots are
 *    neighbours), and draw ONE path: from the members' centroid, through the
 *    centroid of their goals and of each queued waypoint, to the group's
 *    destination, marked once. Two orders to two places stay two paths.
 * 3. **The primary is distinct.** In a selection of more than one, the
 *    primary's own ground ring wears the team colour lightened by
 *    `PRIMARY_RING_LIGHTEN`; every other unit keeps the approved team ring
 *    (#354) exactly. Same hue, so the colour-vision variant follows.
 *
 * Which unit is primary: the first in the selection that has an envelope to
 * draw, else the first alive. The selection's order is the app's (the click,
 * the box, the recalled group, the narrowed chip), so the primary is stable
 * for as long as the selection is -- it never hops between units as they
 * move, which a "nearest the centroid" rule would.
 *
 * Presentation only: every input is sim state the renderer already reads,
 * nothing is written back (invariant 4). No `three` import.
 */
import { lightenHex } from './overlay-geometry';

/**
 * Two destinations this close (tiles) belong to one order. A formation's
 * slots are at most `VEHICLE_SPACING` (2) apart in either axis, so the
 * diagonal neighbour of a vehicle slot is 2.83 tiles away; 3 links every
 * slot of one formation to the next and leaves two orders a few tiles apart
 * as two.
 */
export const GROUP_ROUTE_LINK_TILES = 3;

/** How far the primary's team ring is lifted toward white: Kedem blue
 *  #2F6FD9 becomes #8DB0EA. */
export const PRIMARY_RING_LIGHTEN = 0.45;

/** The ring around a group's destination: the formation's own spread plus
 *  this margin (tiles), so the mark encloses the slots it stands for. */
export const GROUP_DESTINATION_MARGIN_TILES = 0.5;

/** The selection's primary: the first id `drawsEnvelope` accepts, else the
 *  first `alive` one, else -1. */
export function selectionPrimary(
  selection: readonly number[],
  drawsEnvelope: (id: number) => boolean,
  alive: (id: number) => boolean
): number {
  for (const id of selection) if (drawsEnvelope(id)) return id;
  for (const id of selection) if (alive(id)) return id;
  return -1;
}

export interface EnvelopeDraw {
  id: number;
  /** Drawn at the preview's reduced strength. */
  previewing: boolean;
}

/**
 * The envelopes a frame draws: the primary at full strength, and the
 * friendly under the cursor as a preview when it is someone else. Never
 * more than two.
 */
export function envelopeDraws(
  primary: number,
  preview: number,
  drawsEnvelope: (id: number) => boolean
): EnvelopeDraw[] {
  const out: EnvelopeDraw[] = [];
  if (primary >= 0 && drawsEnvelope(primary)) out.push({ id: primary, previewing: false });
  if (preview >= 0 && preview !== primary && drawsEnvelope(preview)) out.push({ id: preview, previewing: true });
  return out;
}

type Pt = readonly [number, number];

export interface UnitRoute {
  /** `queuedRouteLegs`' list: position, current goal, each queued waypoint. */
  points: readonly Pt[];
}

export interface GroupRoute {
  /** Start, then each leg's end; the last is the group's destination. */
  points: [number, number][];
  /** How many units the path stands for. */
  members: number;
  /** The farthest member destination from the group's (tiles); 0 for one. */
  spreadTiles: number;
}

/**
 * Merges per-unit routes into one path per order (rule 2 above). Clusters by
 * FINAL destination, single-linkage at `linkTiles`, in first-appearance
 * order. A cluster's k-th point is the mean of its members' k-th points,
 * where a member with a shorter route contributes its own destination -- so
 * the last point is always the centroid of every member's destination.
 */
export function groupRoutes(routes: readonly UnitRoute[], linkTiles: number = GROUP_ROUTE_LINK_TILES): GroupRoute[] {
  const n = routes.length;
  const parent = new Array<number>(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const dest = (r: UnitRoute): Pt => r.points[r.points.length - 1];
  const link2 = linkTiles * linkTiles;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = dest(routes[i]);
    for (let j = i + 1; j < n; j++) {
      const [bx, by] = dest(routes[j]);
      if ((ax - bx) * (ax - bx) + (ay - by) * (ay - by) <= link2) {
        const ri = find(i);
        const rj = find(j);
        if (ri !== rj) parent[rj < ri ? ri : rj] = rj < ri ? rj : ri;
      }
    }
  }
  const clusters = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    if (routes[i].points.length === 0) continue;
    const root = find(i);
    const list = clusters.get(root);
    if (list) list.push(i);
    else clusters.set(root, [i]);
  }
  const out: GroupRoute[] = [];
  for (const members of clusters.values()) {
    let len = 0;
    for (const m of members) len = Math.max(len, routes[m].points.length);
    const points: [number, number][] = [];
    for (let k = 0; k < len; k++) {
      let sx = 0;
      let sy = 0;
      for (const m of members) {
        const pts = routes[m].points;
        const p = pts[Math.min(k, pts.length - 1)];
        sx += p[0];
        sy += p[1];
      }
      points.push([sx / members.length, sy / members.length]);
    }
    const [gx, gy] = points[points.length - 1];
    let spread = 0;
    if (members.length > 1) {
      for (const m of members) {
        const [dx, dy] = dest(routes[m]);
        spread = Math.max(spread, Math.hypot(dx - gx, dy - gy));
      }
    }
    out.push({ points, members: members.length, spreadTiles: spread });
  }
  return out;
}

const lightenCache = new Map<string, string>();
/** `lightenHex(hex, PRIMARY_RING_LIGHTEN)`, memoised: the input set is the
 *  active variant's team colours, so the cache stays a handful of entries. */
export function primaryRingHex(teamHex: string): string {
  let out = lightenCache.get(teamHex);
  if (out === undefined) {
    out = lightenHex(teamHex, PRIMARY_RING_LIGHTEN);
    lightenCache.set(teamHex, out);
  }
  return out;
}
