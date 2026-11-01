/**
 * Destination slots for a group order — spec
 * docs/superpowers/specs/2026-09-15-group-formation-design.md §4.1–4.2.
 *
 * Pure: masks and tiles in, one tile per id out. No Sim, no RNG, ids sorted,
 * neighbours visited N, E, S, W, so two runs from the same state pick the
 * same tiles (invariant 3, without touching any stream).
 *
 * The frame: the approach direction is the centroid→click vector quantised to
 * an axis; the front rank is the row through the click tile, perpendicular
 * to it; ranks step back toward the group. Vehicles and aircraft ("front")
 * fill the leading ranks with VEHICLE_SPACING between them in both axes;
 * infantry ("rear") fills the ranks behind one per tile. A slot is valid when
 * its tile is open for the unit's domain AND reachable from that domain's
 * origin within the walk bound, so a street walls the lateral offsets off and
 * the grid degenerates into a column with no street detector at all.
 */

/** Widest a rank gets: offsets 0, ±1 … ±MAX_LATERAL — 7 tiles, 7 infantry or 3 vehicles. */
export const MAX_LATERAL = 3;
/** Between vehicles sideways and between vehicle ranks: a tank is about a tile long. */
export const VEHICLE_SPACING = 2;
/** Between vehicle RANKS: two hulls in consecutive ranks need up to 2.83 tiles
 *  (two Tzavs, half-length 1.42 each; formation_rank_depth.test.ts measures the
 *  roster), so 3. Sideways stays VEHICLE_SPACING (2). */
export const VEHICLE_RANK_DEPTH = 3;
/** One team per tile, ranks one tile apart. */
export const INFANTRY_SPACING = 1;
/** The first infantry rank sits this many rows behind the last vehicle rank. */
export const VEHICLE_TO_INFANTRY_GAP = 1;
/** Ranks are tried this far behind the click first. A group the grid cannot seat
 *  inside it is not dropped at the click (GH-929): the search is run again with
 *  the radius doubled, up to MAX_SEARCH_RADIUS, so the radius follows the need. */
export const SEARCH_RADIUS = 8;
/** The most the radius grows to: one rank per unit, for the largest order the
 *  protocol carries (`MAX_CMD_IDS` 256 in @lions/net, which this package may not
 *  import) in a one-tile street. Powers of two from SEARCH_RADIUS, so at most
 *  six attempts, and an attempt stops growing the moment the walk finds no new
 *  ground, so the map bounds the work long before this does. */
export const MAX_SEARCH_RADIUS = 256;
/** The reachability walk's depth for a given radius: a rank at that radius plus a
 *  full lateral offset — 11 at SEARCH_RADIUS, so the walk can touch up to
 *  (2·11 + 1)² = 529 tiles per distinct (mask, origin), not the 289 spec §4.5
 *  derived from SEARCH_RADIUS alone. A slot beyond this is unreachable by
 *  construction, so the depth has to cover the widest slot the grid can ask for,
 *  not the deepest rank. */
function walkDepth(radius: number): number {
  return radius + MAX_LATERAL;
}

export interface FormationUnit {
  id: number;
  domain: number;
  /** A vehicle or an aircraft: takes the front ranks with vehicle spacing. */
  front: boolean;
}

export interface FormationInput {
  width: number;
  height: number;
  /** Passability per domain, indexed by domain number; 0 = open. */
  masks: readonly Uint8Array[];
  /** Per domain: the tile the reachability walk starts from — the click tile
   *  snapped to open ground for that domain. */
  origins: readonly (readonly [number, number])[];
  /** The foot-snapped click tile: lateral offset 0 of the front rank. */
  clickX: number;
  clickY: number;
  /** The tile the group is coming from (an integer centroid). */
  fromX: number;
  fromY: number;
  units: readonly FormationUnit[];
  /** 1 where a same-side unit outside this order stands or is bound. */
  reserved: Uint8Array;
}

export interface Slot {
  id: number;
  x: number;
  y: number;
}

/** Tiles reachable from `origin` over open tiles within `maxDepth` steps, in
 *  the order they were reached — the overflow order — plus a per-tile flag. */
export interface Reach {
  order: number[];
  hit: Uint8Array;
}

/** `maxDepth` is the walk bound in steps: `walkDepth(SEARCH_RADIUS)` for the grid, a formation's
 *  `extent` for a template (GH-859, formation-template.ts). */
export function walk(
  mask: Uint8Array,
  w: number,
  h: number,
  origin: readonly [number, number],
  maxDepth: number = walkDepth(SEARCH_RADIUS)
): Reach {
  const hit = new Uint8Array(w * h);
  const order: number[] = [];
  const [ox, oy] = origin;
  if (ox < 0 || oy < 0 || ox >= w || oy >= h || mask[oy * w + ox] !== 0) return { order, hit };
  const queue: number[] = [oy * w + ox];
  const depth: number[] = [0];
  hit[oy * w + ox] = 1;
  for (let q = 0; q < queue.length; q++) {
    const t = queue[q];
    order.push(t);
    const d = depth[q];
    if (d === maxDepth) continue;
    const x = t % w;
    const y = (t - x) / w;
    // N, E, S, W — fixed, so the overflow order is the same on every run.
    const nx = [x, x + 1, x, x - 1];
    const ny = [y - 1, y, y + 1, y];
    for (let k = 0; k < 4; k++) {
      if (nx[k] < 0 || ny[k] < 0 || nx[k] >= w || ny[k] >= h) continue;
      const n = ny[k] * w + nx[k];
      if (hit[n] === 1 || mask[n] !== 0) continue;
      hit[n] = 1;
      queue.push(n);
      depth.push(d + 1);
    }
  }
  return { order, hit };
}

/** 0, +s, −s, +2s, −2s … while the offset fits inside MAX_LATERAL. */
function lateralOffsets(spacing: number): number[] {
  const out = [0];
  for (let k = spacing; k <= MAX_LATERAL; k += spacing) out.push(k, -k);
  return out;
}

/** One attempt at the grid: every unit the ranks out to `radius` could seat is in
 *  `out`, the rest in `left` (front first, then rear, each in id order). */
interface GridAttempt {
  out: Slot[];
  left: FormationUnit[];
  reach: Reach[];
  taken: Uint8Array;
  /** Tiles the walks found, summed over the distinct reaches: a larger radius
   *  that finds the same count has nothing more to offer. */
  reached: number;
}

export function assignFormation(input: FormationInput): Slot[] {
  const w = input.width;
  // The frame: forward (fwdX, fwdY) is the axis-quantised approach; lateral
  // (latX, latY) is forward turned a quarter turn, fixed so the fill order is.
  const dx = input.clickX - input.fromX;
  const dy = input.clickY - input.fromY;
  const adx = dx < 0 ? -dx : dx;
  const ady = dy < 0 ? -dy : dy;
  let fwdX = 0;
  let fwdY = 0;
  if (adx >= ady) fwdX = dx < 0 ? -1 : 1;
  else fwdY = dy < 0 ? -1 : 1;

  const sorted = [...input.units].sort((a, b) => a.id - b.id);

  // Seat by need (GH-929). The radius starts at SEARCH_RADIUS and doubles while
  // the grid still leaves a unit unseated, so a big order is never cut at a
  // fixed depth (a fixed 12 would only move the cliff). It stops when
  //  - everyone is seated, which is every order that fit before: the first
  //    attempt is then byte-identical to the old single pass;
  //  - the larger walk reached no more ground than the smaller one, so the
  //    ground itself is full and only the overflow below can help; or
  //  - MAX_SEARCH_RADIUS, which no order the protocol carries can outrun.
  // Integer doubling over a fixed ladder: nothing here reads a clock or a stream.
  let radius = SEARCH_RADIUS;
  let attempt = seatGrid(input, sorted, radius, fwdX, fwdY);
  while (attempt.left.length > 0 && radius < MAX_SEARCH_RADIUS) {
    radius *= 2;
    const next = seatGrid(input, sorted, radius, fwdX, fwdY);
    const grew = next.reached > attempt.reached;
    attempt = next;
    if (!grew) break;
  }

  // Phase 2: overflow (overflowPlace, below): the nearest free reachable tile
  // in walk order, spacing dropped, behind-first. Reached only by ground that
  // is genuinely out of tiles for the units that remain.
  const { out, taken } = attempt;
  overflowPlace(
    attempt.left,
    { width: w, clickX: input.clickX, clickY: input.clickY, fwdX, fwdY, reach: attempt.reach, origins: input.origins, reserved: input.reserved, taken },
    (u, x, y) => {
      taken[y * w + x] = 1;
      out.push({ id: u.id, x, y });
    },
    (u, x, y) => out.push({ id: u.id, x, y })
  );
  return out;
}

/** Phase 1: the grid out to `radius` ranks. `sorted` is the order's units by id. */
function seatGrid(input: FormationInput, sorted: readonly FormationUnit[], radius: number, fwdX: number, fwdY: number): GridAttempt {
  const w = input.width;
  const h = input.height;
  const latX = -fwdY;
  const latY = fwdX;

  // One walk per DISTINCT (mask, origin) pair. On a map with no boulders the
  // foot and vehicle masks are the same array (`Sim.maskFor` collapses the
  // domain there) and the click snaps to the same tile for both, so the
  // second walk was a byte-identical copy of the first — up to the walk's
  // full disc re-visited for nothing, on every map the game ships but one.
  // Compared by identity and origin, never by contents: the collapse is a
  // property of the caller handing the same array twice, and the ORIGIN has
  // to match too, since the same mask walked from two tiles gives a different
  // `order` (the overflow order) and a different `hit` disc. A shared `Reach`
  // is safe to alias: nothing below writes to one.
  const depth = walkDepth(radius);
  const reach: Reach[] = [];
  let reached = 0;
  for (let d = 0; d < input.masks.length; d++) {
    const mask = input.masks[d];
    const [ox, oy] = input.origins[d];
    let same = -1;
    for (let e = 0; e < d && same < 0; e++) {
      const [ex, ey] = input.origins[e];
      if (input.masks[e] === mask && ex === ox && ey === oy) same = e;
    }
    if (same < 0) {
      const r = walk(mask, w, h, input.origins[d], depth);
      reached += r.order.length;
      reach.push(r);
    } else reach.push(reach[same]);
  }
  const taken = new Uint8Array(w * h);
  const out: Slot[] = [];
  const front = sorted.filter((u) => u.front);
  const rear = sorted.filter((u) => !u.front);

  const usable = (u: FormationUnit, x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    const t = y * w + x;
    return reach[u.domain].hit[t] === 1 && input.reserved[t] === 0 && taken[t] === 0;
  };
  const place = (u: FormationUnit, x: number, y: number): void => {
    taken[y * w + x] = 1;
    out.push({ id: u.id, x, y });
  };

  // Rank r sits r tiles behind its anchor; a slot is the anchor plus the
  // lateral offset along (latX, latY) minus r along forward.
  // A FRONT unit anchors at its own domain's origin — the click tile snapped
  // to ground a vehicle can hold, which is the click itself whenever the
  // click is vehicle-open — so a click inside a boulder field puts the
  // vehicles on the nearest ground they can stand on and leaves the click to
  // the infantry (spec §4.2's corridor). Infantry always anchors at the click,
  // and starts behind the last front rank only when that rank was anchored
  // at the click too; otherwise the two grids are apart and it starts at 0.
  let lastFrontRankAtClick = -1;
  let fi = 0;
  const frontLateral = lateralOffsets(VEHICLE_SPACING);
  for (let r = 0; r <= radius && fi < front.length; r += VEHICLE_RANK_DEPTH) {
    for (let k = 0; k < frontLateral.length && fi < front.length; k++) {
      const u = front[fi];
      const [ax, ay] = input.origins[u.domain];
      const l = frontLateral[k];
      const x = ax + l * latX - r * fwdX;
      const y = ay + l * latY - r * fwdY;
      if (!usable(u, x, y)) continue;
      place(u, x, y);
      fi++;
      if (ax === input.clickX && ay === input.clickY) lastFrontRankAtClick = r;
    }
  }
  const rearStart = lastFrontRankAtClick < 0 ? 0 : lastFrontRankAtClick + VEHICLE_TO_INFANTRY_GAP;
  let ri = 0;
  const rearLateral = lateralOffsets(INFANTRY_SPACING);
  for (let r = rearStart; r <= radius && ri < rear.length; r += INFANTRY_SPACING) {
    for (let k = 0; k < rearLateral.length && ri < rear.length; k++) {
      const l = rearLateral[k];
      const x = input.clickX + l * latX - r * fwdX;
      const y = input.clickY + l * latY - r * fwdY;
      if (!usable(rear[ri], x, y)) continue;
      place(rear[ri], x, y);
      ri++;
    }
  }
  return { out, left: front.slice(fi).concat(rear.slice(ri)), reach, taken, reached };
}

/** What the behind-first overflow pass reads. */
export interface OverflowGround {
  width: number;
  /** The foot-snapped click tile and the axis-quantised approach (unit vector). */
  clickX: number;
  clickY: number;
  fwdX: number;
  fwdY: number;
  /** Per domain: the reachability walk, whose `order` is the overflow order. */
  reach: readonly Reach[];
  origins: readonly (readonly [number, number])[];
  reserved: Uint8Array;
  /** The tiles already given out. `place` must mark the tile it takes. */
  taken: Uint8Array;
}

/**
 * Phase 2 of the grid, lifted out unchanged so the template (formation-template.ts)
 * shares it: the nearest free reachable tile in walk order, spacing dropped —
 * behind-first: a tile AHEAD of the front rank (a positive projection onto the
 * approach direction from the click) is taken only when nothing at or behind the
 * click is free, so a column's tail fills the gaps between the spaced vehicles
 * before it spills past the head. A unit that finds none keeps its origin
 * (`keep`) — the one way two units can still share a tile, and it takes more
 * units than free ground.
 */
export function overflowPlace<U extends { id: number; domain: number }>(
  rest: readonly U[],
  g: OverflowGround,
  place: (u: U, x: number, y: number) => void,
  keep: (u: U, x: number, y: number) => void
): void {
  const w = g.width;
  const ahead = (t: number): boolean => {
    const x = t % w;
    const y = (t - x) / w;
    return (x - g.clickX) * g.fwdX + (y - g.clickY) * g.fwdY > 0;
  };
  for (let i = 0; i < rest.length; i++) {
    const u = rest[i];
    const order = g.reach[u.domain].order;
    let placed = false;
    for (let pass = 0; pass < 2 && !placed; pass++) {
      for (let k = 0; k < order.length; k++) {
        const t = order[k];
        if (g.reserved[t] !== 0 || g.taken[t] !== 0) continue;
        if (pass === 0 && ahead(t)) continue;
        const x = t % w;
        place(u, x, (t - x) / w);
        placed = true;
        break;
      }
    }
    if (!placed) {
      const [ox, oy] = g.origins[u.domain];
      keep(u, ox, oy);
    }
  }
}
