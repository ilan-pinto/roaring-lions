// The lane probe (GH-974, versus-maps design section 4, check 5): does a map have a
// strategy to find, and is it the same strategy from both seats? REPORT-ONLY, exit 0 whatever it reads.
//
//   pnpm exec tsx src/backtest/lane-probe.ts --maps=rujm_sawda --lanes=ford_ne,ford_sw [--seeds=192] [--seed-from=6000] [--cap=2100]
//
// One side SPLITS: its armour (every wheeled or tracked unit) attack-moves to the lane marker on one side of
// its own seat's line to the enemy, its infantry to the other lane's marker, and each group goes on to the
// other side's centroid once it has reached its marker (within `PASS_RADIUS_TILES`). Its aircraft go straight
// at the centroid. The other side is the versus probe's plain blob: the whole force, attack-moving on the
// splitter's living centroid every 20 s. "Left" and "right" are as the splitter's own seat sees them (the
// seat looks along its line to the other seat), so on a half-turn map the two seats' lanes are the same lane
// seen from the other end: a map whose lanes are fair gives the splitter the same share from the west seat
// and from the east one.
//
// Four cells: (armour left, infantry right) and the swap, each with the splitter at the west seat and at the
// east one. The reading is the splitter's win share per cell and the west-east gap, with a two-proportion z.
// The bar (this PR's reading of "it must win equally from both seats"): |west - east| <= 10 points, about 2
// standard errors at 192 seeds a cell. A draw is no one's win. The arm is the versus probe's `world`, seats,
// spawns and outcome rule, so a cell differs from the blob-v-blob cell in the splitter's orders alone.
import { fileURLToPath } from 'node:url';
import { fx, type Sim } from '@lions/sim';
import { maps, parseMap, type MapId } from '@lions/data';
import { matchCapTicks } from '@lions/net';
import { versusAnchors } from '../../../packages/app/src/net/versus-seats';
import { versusSpawns } from '../../../packages/app/src/net/versus-force';
import { outcomeOf, unitCost } from '../../../packages/app/src/net/outcome';
import { CAP_TICKS_DEFAULT, DECIDE_EVERY_TICKS, ORDER_EVERY_TICKS, centroid, humanHeldOf, layoutOf, seedOf, world, type Arrangement } from './versus-probe';

/** A group has reached its lane when its centroid is this close to the marker. */
export const PASS_RADIUS_TILES = 8;
/** The unbiased gap bar, in percentage points of the splitter's share. */
export const SEAT_GAP_MAX_POINTS = 10;

export type Point = readonly [number, number];
export type Group = 'armour' | 'foot' | 'air';

/** Which of two lane markers is on the LEFT of a seat that looks from `own` along its line to `enemy`
 *  (screen coordinates, y down: looking east, left is north), and which is on the right. */
export function lanesOf(own: Point, enemy: Point, a: Point, b: Point): { left: Point; right: Point } {
  const fx_ = enemy[0] - own[0];
  const fy_ = enemy[1] - own[1];
  const side = (p: Point): number => (p[0] - own[0]) * fy_ - (p[1] - own[1]) * fx_; // dot with the left normal (fy, -fx)
  return side(a) >= side(b) ? { left: a, right: b } : { left: b, right: a };
}

export function groupOf(sim: Sim, id: number): Group {
  const t = sim.unitTypes[sim.state.typeIdx[id]];
  return t.isAir ? 'air' : t.wheeled ? 'armour' : 'foot';
}

/** The exact tile centre as a raw Q16.16 pair. */
const raw = (p: Point): [number, number] => [fx.from(p[0]) + fx.from(0.5), fx.from(p[1]) + fx.from(0.5)];

export interface Splitter {
  /** The splitter's lane marker for each ground group. */
  lane: { armour: Point; foot: Point };
  /** Which groups have reached their lane (sticky). */
  passed: { armour: boolean; foot: boolean };
}

/** The mean tile position of the living members of `ids`, or null when none. */
export function meanOf(sim: Sim, ids: readonly number[]): Point | null {
  let x = 0;
  let y = 0;
  let n = 0;
  for (const id of ids) {
    if (sim.state.alive[id] !== 1) continue;
    x += fx.toNumber(sim.state.posX[id]);
    y += fx.toNumber(sim.state.posY[id]);
    n++;
  }
  return n === 0 ? null : [x / n, y / n];
}

/** One round of the splitter's orders: each ground group heads for its lane until it has reached it, then for
 *  the blob's centroid; aircraft always for the centroid. */
export function splitOrders(sim: Sim, ids: readonly number[], s: Splitter, target: readonly [number, number]): void {
  const live = ids.filter((id) => sim.state.alive[id] === 1);
  const by: Record<Group, number[]> = { armour: [], foot: [], air: [] };
  for (const id of live) by[groupOf(sim, id)].push(id);
  for (const g of ['armour', 'foot'] as const) {
    if (by[g].length === 0) continue;
    if (!s.passed[g]) {
      const at = meanOf(sim, by[g]);
      const lane = s.lane[g];
      if (at !== null && Math.hypot(at[0] - lane[0], at[1] - lane[1]) <= PASS_RADIUS_TILES) s.passed[g] = true;
    }
    const to = s.passed[g] ? target : raw(s.lane[g]);
    sim.queueCommand({ kind: 'attackMove', ids: by[g], x: to[0], y: to[1] });
  }
  if (by.air.length > 0) sim.queueCommand({ kind: 'attackMove', ids: by.air, x: target[0], y: target[1] });
}

/** The splitter's lane for each ground group: armour left and infantry right, or the swap. */
export function laneFor(armourLeft: boolean, left: Point, right: Point): Splitter['lane'] {
  return armourLeft ? { armour: left, foot: right } : { armour: right, foot: left };
}

export interface LaneCell {
  /** The splitter's END: 0 west (friendly), 1 east (hostile). */
  splitEnd: 0 | 1;
  /** true: armour takes the left lane and infantry the right; false: the swap. */
  armourLeft: boolean;
}

/** One game. Returns the winning END (0 west, 1 east) or null for a draw. */
export function playLane(mapId: MapId, seed: number, cell: LaneCell, lanes: readonly [Point, Point], capTicks: number): { winner: 0 | 1 | null; ticks: number } {
  const arr: Arrangement = ['kdf', 'kdf'];
  const { sim, typeOf, map } = world(mapId, seed, humanHeldOf('room', mapId, arr, seed));
  const { sideOfEnd, factions, ends } = layoutOf(arr);
  const anchors = versusAnchors(map);
  const force = versusSpawns(sim, typeOf, anchors, factions, ends);
  const roomCap = matchCapTicks(mapId);
  const splitSide = sideOfEnd[cell.splitEnd];
  const blobSide = sideOfEnd[cell.splitEnd === 0 ? 1 : 0];
  const own = anchors[cell.splitEnd === 0 ? 'friendly' : 'hostile'];
  const enemy = anchors[cell.splitEnd === 0 ? 'hostile' : 'friendly'];
  const { left, right } = lanesOf(own, enemy, lanes[0], lanes[1]);
  const s: Splitter = { lane: laneFor(cell.armourLeft, left, right), passed: { armour: false, foot: false } };
  const finish = (o: ReturnType<typeof outcomeOf>, ticks: number) => ({ winner: o.kind === 'won' ? (sideOfEnd[0] === o.side ? 0 : 1) : null, ticks }) as { winner: 0 | 1 | null; ticks: number };
  for (let t = 0; t < capTicks; t++) {
    if (t % ORDER_EVERY_TICKS === 0) {
      const toBlob = centroid(sim, blobSide);
      const toSplit = centroid(sim, splitSide);
      if (toBlob) splitOrders(sim, force.bySide[splitSide], s, toBlob);
      if (toSplit) {
        const ids = force.bySide[blobSide].filter((id) => sim.state.alive[id] === 1);
        if (ids.length > 0) sim.queueCommand({ kind: 'attackMove', ids, x: toSplit[0], y: toSplit[1] });
      }
    }
    sim.tick();
    if (sim.tickCount % DECIDE_EVERY_TICKS === 0) {
      const o = outcomeOf(sim, sim.tickCount, unitCost, undefined, roomCap);
      if (o.kind !== 'ongoing') return finish(o, sim.tickCount);
    }
  }
  const o = outcomeOf(sim, roomCap, unitCost, undefined, roomCap);
  if (o.kind === 'ongoing') throw new Error('the cap rule left a game ongoing');
  return finish(o, sim.tickCount);
}

export interface LaneRead {
  wins: number;
  losses: number;
  draws: number;
}

/** The splitter's share of decided games, percent (0 when none were decided). */
export const shareOf = (r: LaneRead): number => (r.wins + r.losses === 0 ? 0 : (100 * r.wins) / (r.wins + r.losses));

/** Two-proportion z of the west-seat splitter against the east-seat one, on decided games. */
export function gapZ(a: LaneRead, b: LaneRead): number {
  const na = a.wins + a.losses;
  const nb = b.wins + b.losses;
  if (na === 0 || nb === 0) return 0;
  const p = (a.wins + b.wins) / (na + nb);
  const se = Math.sqrt(p * (1 - p) * (1 / na + 1 / nb));
  return se === 0 ? 0 : (a.wins / na - b.wins / nb) / se;
}

/** The bar: the splitter's share from the west seat and from the east seat differ by no more than the bar. */
export const seatGapOk = (west: LaneRead, east: LaneRead): boolean => Math.abs(shareOf(west) - shareOf(east)) <= SEAT_GAP_MAX_POINTS;

function flag(args: readonly string[], name: string): string | undefined {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? undefined : hit.slice(name.length + 3);
}

export function main(args: readonly string[] = process.argv.slice(2)): number {
  const mapId = (flag(args, 'maps') ?? 'rujm_sawda') as MapId;
  const laneNames = (flag(args, 'lanes') ?? 'ford_ne,ford_sw').split(',');
  if (laneNames.length !== 2) throw new Error('--lanes names two markers');
  const markers = parseMap(maps[mapId]).markers as Record<string, readonly [number, number]>;
  const pts = laneNames.map((n) => {
    const m = markers[n];
    if (m === undefined) throw new Error(`--lanes: ${mapId} has no marker "${n}"`);
    return [m[0], m[1]] as Point;
  }) as [Point, Point];
  const seeds = Number(flag(args, 'seeds') ?? 192);
  const from = Number(flag(args, 'seed-from') ?? 6000);
  const cap = Math.round(Number(flag(args, 'cap') ?? CAP_TICKS_DEFAULT / 20) * 20);
  console.log(`lane probe (report-only): ${mapId}, lanes ${laneNames.join(' / ')}, ${seeds} seeds a cell (seeds ${from}..${from + seeds - 1}, seedOf(${from}) = ${seedOf(from)}), cap ${cap / 20} s, blob = whole force on the splitter's centroid`);
  const reads = new Map<string, LaneRead>();
  for (const armourLeft of [true, false]) {
    for (const splitEnd of [0, 1] as const) {
      const r: LaneRead = { wins: 0, losses: 0, draws: 0 };
      for (let n = 0; n < seeds; n++) {
        const w = playLane(mapId, seedOf(from + n), { splitEnd, armourLeft }, pts, cap).winner;
        if (w === null) r.draws++;
        else if (w === splitEnd) r.wins++;
        else r.losses++;
      }
      reads.set(`${armourLeft}/${splitEnd}`, r);
      console.log(`  armour ${armourLeft ? 'left, infantry right' : 'right, infantry left'}, splitter ${splitEnd === 0 ? 'WEST' : 'EAST'}: splitter ${r.wins}, blob ${r.losses}, draw ${r.draws}  (splitter share ${shareOf(r).toFixed(1)}%)`);
    }
  }
  let ok = true;
  for (const armourLeft of [true, false]) {
    const w = reads.get(`${armourLeft}/0`) as LaneRead;
    const e = reads.get(`${armourLeft}/1`) as LaneRead;
    const gap = shareOf(w) - shareOf(e);
    const pass = seatGapOk(w, e);
    ok = ok && pass;
    console.log(`  armour ${armourLeft ? 'left' : 'right'}: west ${shareOf(w).toFixed(1)}% east ${shareOf(e).toFixed(1)}% gap ${gap >= 0 ? '+' : ''}${gap.toFixed(1)} points, z ${gapZ(w, e).toFixed(2)}  ${pass ? 'PASS' : 'FAIL'} (bar ${SEAT_GAP_MAX_POINTS} points)`);
  }
  console.log(ok ? 'lane probe: equal from both seats' : 'lane probe: NOT equal from both seats');
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main();
