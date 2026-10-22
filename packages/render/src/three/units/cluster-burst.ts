/**
 * GH-709 (E3): the presentation of a cluster round. Pure and three-free.
 *
 * The sim emits one `submunition` event per bomblet, all of a round's
 * consecutive in one tick, and NEVER the burst centre or a "round opened"
 * event (the parent raises no `impact`/`nearMiss`). The centre is therefore
 * recovered here from the round's own bomblets: the CENTROID of the group.
 * `burstSubmunitions` places each bomblet at `cos/sin(angle) * rad` from the
 * centre with angle and rad both uniform, so the centre is the expectation of
 * every bomblet and the centroid of `count` of them is unbiased, with a
 * standard error of `scatter / sqrt(6 * count)` per axis -- 0.29 tile for a
 * 2.5-tile, 12-bomblet round, an eighth of the spread it describes. No sim
 * change is needed to draw the airburst where the round really opened.
 *
 * Grouping is by shooter: a group opens at `index === 0` (which discards any
 * half-seen group of that shooter, e.g. one cut by a catch-up) and closes at
 * `index === count - 1`.
 */

/** The fields of a sim `submunition` event this module reads (tile floats). */
export interface BombletSample {
  by: number;
  x: number;
  y: number;
  index: number;
  count: number;
}

export interface BurstCentre {
  by: number;
  x: number;
  y: number;
}

/** Bomblet crater radius, tiles (a tile is 3 m): 0.25 tile = 0.75 m. The lead's
 *  22 Oct ruling: bigger and darker than the 0.1 tile dimple (a faint pale ring at
 *  game zoom), so the spread of a round reads. A mortar crater is `0.15 + power`
 *  (0.45 at 0.3). */
export const BOMBLET_CRATER_RADIUS_TILES = 0.25;

/** The dark scorch laid with each bomblet's crater, as a mortar landing pairs
 *  its crater and scorch (the decal blend multiplies, so the two compose in any
 *  order): 0.4 tile, 1.6x
 *  the crater. A scorch is solid to 0.55 r (0.22 tile) and fades to nothing at
 *  r, so it covers the crater's pale lip (0.76-1.0 of 0.25 = 0.19-0.25 tile)
 *  with 0.45-alpha `scorch` palette tone and the dark mark, not the pale lip,
 *  is what reads. A mortar's own ratio is 1.95 (0.876 over 0.45). */
export const BOMBLET_SCORCH_RADIUS_TILES = 0.4;

/** Where the carrier shell opens above the ground, in lift pixels (the unit
 *  the arcs use): 30 px x 0.0255 = 0.77 world units, about 2.3 m: "a little
 *  above the ground", visibly off it but under a one-storey roofline. */
export const CLUSTER_BURST_LIFT_PX = 30;

/** `shell_impact`'s role for a cluster round: the power the airburst emitter
 *  is scaled by. Modest, below a mortar bomb's 0.3 -- the carrier is a puff
 *  and a flash, the bomblets are the damage. */
export const CLUSTER_BURST_POWER = 0.25;

/** How far through its flight a carrier must be for a burst to retire it. The
 *  sim's burst lands within a tick or two of the drawn shell's end, so only a
 *  shell nearly down can be the one that opened; a younger shell from the same
 *  shooter (a faster weapon's next round) is still in the air and is left. */
export const CLUSTER_RETIRE_MIN_PROGRESS = 0.85;

/** The carrier shell a burst by `shooter` retires: of that shooter's cluster
 *  shells at least `CLUSTER_RETIRE_MIN_PROGRESS` through their flight, the one
 *  nearest its end; -1 when none (it has already landed and been dropped). */
export function clusterCarrierToRetire(
  shells: readonly { cluster?: boolean; shooter?: number; t: number; duration: number }[],
  shooter: number,
): number {
  let best = -1;
  let bestU = CLUSTER_RETIRE_MIN_PROGRESS;
  for (let i = 0; i < shells.length; i++) {
    const s = shells[i];
    if (s.cluster !== true || s.shooter !== shooter) continue;
    const u = s.t / s.duration;
    if (u >= bestU) {
      best = i;
      bestU = u;
    }
  }
  return best;
}

export class ClusterBurstGrouper {
  private readonly open = new Map<number, { sx: number; sy: number; n: number }>();

  /** Feeds one bomblet; answers the burst centre when it completes a group. */
  push(b: BombletSample): BurstCentre | null {
    let g = this.open.get(b.by);
    if (b.index === 0 || g === undefined) {
      if (b.index !== 0) return null; // the head of this group was never seen
      g = { sx: 0, sy: 0, n: 0 };
      this.open.set(b.by, g);
    }
    g.sx += b.x;
    g.sy += b.y;
    g.n++;
    if (b.index < b.count - 1) return null;
    this.open.delete(b.by);
    return { by: b.by, x: g.sx / g.n, y: g.sy / g.n };
  }

  reset(): void {
    this.open.clear();
  }
}
