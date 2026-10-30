// GH-859 P1a, spec 8.3: the Ambush probe. REPORT-ONLY (it prints a table and exits 0 whatever it says;
// whether a number is a problem is the lead's call, STOP gate S3). `pnpm formations:probe`.
//
// A ring of six (2 Lavi, 3 rifle squads, 1 mortar team) is sent to a click, and a Sarim column of four
// vehicles and three infantry teams drives through the click. Three PAIRED arms, seed for seed, on the
// same map, the same units and the same tiles:
//
//   A  the Ambush formation: `move` + `formation: 'ambush'`. The ring springs TOGETHER (D8).
//   B  the same order; once every member has arrived and turned (stopped, facing its rest facing), a
//      per-unit `setStance{ambush}` at the same R. That order takes each member out of its group
//      (`fmForget`), so B has A's slots and A's inward facing, and each member springs ALONE.
//   C  each member sent by `exact: true` to A's tile, then `setStance{ambush}` as it stops. C has A's
//      slots and the TRAVEL facing, and each member springs alone.
//
// So A against B isolates the group spring, and B against C isolates the facing (D14).
//
// Reported per arm: the share of ring members that fire within 20 ticks of the ring's first shot (A's
// claim is 90%); the friendly splash damage per engagement and its ratio to the damage the ring dealt
// (D7: above 10% is the trigger for P2's U and L shapes); the arcs of the impacts on the ring's two
// Lavi; and the ring's win and loss counts.
//
// Friendly damage is read by a probe-only wrapper on `Sim.applyDamage` (`DamageMeter`), which reads the
// shooter's side and the target's. It changes no sim state and draws no random number.
//
// Three geometries. The facing reading depends on where the column comes from. `head`: the ring marches
// west to east and the column comes from the east, so the ring's TRAVEL facing already points at the
// threat. `cross`: the column comes from the north, so travel facing shows the Lavi's flank. In both the
// column attack-moves, so it STOPS to fight at its own weapon range, outside the ring. `through`: the
// head-on column is ordered to MOVE, so it keeps driving through the kill zone while it is shot at: the
// fratricide stress (the column is inside the ring, where a ring member's HE lands among its own).
//
// The map is flat open ground with no cover: the ring's cover preference has nothing to choose between.

import { fileURLToPath } from 'node:url';
import { Sim, fx, type SimEvent } from '@lions/sim';
import { formations, units } from '@lions/data';

/** The facing arc an `impact` event carries (the sim's own type, not exported by name). */
export type FacingArc = Extract<SimEvent, { kind: 'impact' }>['arc'];
export type Arm = 'A' | 'B' | 'C';
export const ARMS: readonly Arm[] = ['A', 'B', 'C'];
export type Geometry = 'head' | 'cross' | 'through';
export const GEOMETRIES: readonly Geometry[] = ['head', 'cross', 'through'];

const TICKS_PER_SECOND = 20;
export const SEEDS_DEFAULT = 60;
export const seedOf = (n: number): number => 90000 + n * 7919;
/** The window that counts as "together": one second after the ring's first shot. */
export const TOGETHER_TICKS = 20;
/** A member that has not fired this long after the first shot is counted as never having fired. */
const FIRE_HORIZON_TICKS = 200;
/** The second window the report prints: five seconds. */
export const LATE_TICKS = 100;
/** The column leaves this long after the whole ring has arrived and turned. */
const SETTLE_TICKS = 60;
/** From the column's start to the end of a game. */
const GAME_TICKS = 180 * TICKS_PER_SECOND;
const MAP = 64;
/** The click: the kill-zone centre. */
const CLICK: readonly [number, number] = [32, 32];

const asNum = (n: number): number => n;
const at = (n: number): number => fx.from(asNum(n) + 0.5);

/** The shipped Lavi, rifle squad and mortar team; the Sarim column's units. */
const RING_TYPES = ['mbt_lavi', 'mbt_lavi', 'inf_squad', 'inf_squad', 'inf_squad', 'mortar_team'] as const;
const COLUMN_TYPES = ['technical', 'technical', 'gun_truck', 'moto_rpg', 'sarim_rifles', 'sarim_rifles', 'rpg_team'] as const;

/** The private columns the probe reads (the same cast the formation tests use). */
interface Priv {
  goalX: Int32Array;
  goalY: Int32Array;
  restFacing: Uint16Array;
  applyDamage(target: number, dmg: number, by: number): void;
}
const priv = (sim: Sim): Priv => sim as unknown as Priv;

// ---------------------------------------------------------------------------
// The damage meter
// ---------------------------------------------------------------------------

/** Damage in hit points (raw Q16.16 / 65536), as `applyDamage` actually applied it (overkill excluded). */
export class DamageMeter {
  /** Side 0's shooters hitting side 0's units other than themselves: friendly splash. */
  friendly = 0;
  /** Side 0's shooters hitting side 1's units. */
  dealt = 0;
  /** Side 1's shooters hitting side 0's units. */
  taken = 0;
  /** Friendly damage by the shooter's type id. */
  friendlyBy: Record<string, number> = {};

  constructor(sim: Sim) {
    const p = priv(sim);
    const original = p.applyDamage.bind(sim);
    p.applyDamage = (target, dmg, by) => {
      const s = sim.state;
      // The same early outs `applyDamage` has, so a refused hit is not counted.
      const counts = dmg > 0 && s.alive[target] === 1 && by >= 0 && s.garrisonedIn[target] < 0 && s.carriedBy[target] < 0 && s.tunnelIn[target] < 0;
      const before = counts ? Math.max(s.hp[target], 0) : 0;
      original(target, dmg, by);
      if (!counts) return;
      const applied = Math.min(dmg, before) / 65536;
      if (s.side[by] === 0 && s.side[target] === 0 && by !== target) {
        this.friendly += applied;
        const id = sim.unitTypes[s.typeIdx[by]].id;
        this.friendlyBy[id] = (this.friendlyBy[id] ?? 0) + applied;
      } else if (s.side[by] === 0 && s.side[target] === 1) this.dealt += applied;
      else if (s.side[by] === 1 && s.side[target] === 0) this.taken += applied;
    };
  }
}

// ---------------------------------------------------------------------------
// One game
// ---------------------------------------------------------------------------

export interface AmbushGame {
  arm: Arm;
  geometry: Geometry;
  /** The ring fired at all. */
  engaged: boolean;
  /** Ring members alive at the ring's first shot. */
  membersAtFirstShot: number;
  /** Of those, how many had a living column unit inside some weapon's window (min range to range) at
   *  the first shot: a member with nothing in reach cannot fire whatever springs it. */
  eligible: number;
  /** Of those members, how many fired within `TOGETHER_TICKS` of the first shot. */
  firedTogether: number;
  /** Of the ELIGIBLE members, how many fired within `TOGETHER_TICKS`. */
  eligibleFiredTogether: number;
  /** Of those members, how many fired within `LATE_TICKS`. */
  firedLate: number;
  /** Of those members, how many fired within `FIRE_HORIZON_TICKS`. */
  firedEver: number;
  /** Ticks from the first shot to the last of those members' first shot (0 when none fired). */
  spreadTicks: number;
  friendly: number;
  friendlyBy: Record<string, number>;
  dealt: number;
  taken: number;
  /** Impacts on the ring's Lavi by arc, and how many of them penetrated. */
  arcs: Record<FacingArc, number>;
  penetrated: number;
  /** The FIRST impact on each Lavi (at most two per game): the arc it met before it had turned to
   *  face its attacker. The all-impact table above is dominated by the length of the exchange. */
  firstHit: Record<FacingArc, number>;
  firstHitPenetrated: number;
  /** `formationSprung` and `ambushSprung` events pushed by ring members. */
  formationSprung: number;
  ambushSprung: number;
  /** Ring members in a formation group when the ring had arrived (6 for A, 0 for B after its stance and for C). */
  grouped: number;
  /** B only: the stance order had to be forced at the column's start because the ring had not settled. */
  forced: boolean;
  ringAlive: number;
  columnAlive: number;
  result: 'ring' | 'column' | 'open';
}

interface Reference {
  /** A's tiles, in ring order. */
  goals: [number, number][];
  /** The ring radius, tiles. */
  radius: number;
  /** The tick by which every member has arrived and turned. */
  settled: number;
}

function build(seed: number, geometry: Geometry): { sim: Sim; ring: number[]; column: number[] } {
  const sim = new Sim({ seed, width: MAP, height: MAP, capacity: 64 });
  const typeOf = new Map<string, number>();
  for (const id of new Set<string>([...RING_TYPES, ...COLUMN_TYPES])) {
    const u = (units as Record<string, unknown>)[id];
    if (u === undefined) throw new Error(`formation probe: no shipped unit ${id}`);
    typeOf.set(id, sim.addUnitType(u as never));
  }
  // A room registers its formations after its unit types; the registration is config and moves no hash.
  for (const f of formations) sim.addFormationType(f);
  const tid = (id: string): number => {
    const t = typeOf.get(id);
    if (t === undefined) throw new Error(`formation probe: ${id} not registered`);
    return t;
  };
  // The ring starts west of the click in two rows of three, so its approach is from the west.
  const ring = RING_TYPES.map((t, k) => sim.spawn(tid(t), 0, at(8 + (k % 2)), at(30 + Math.floor(k / 2) * 2), 0));
  // The column starts out of sight and waits for its order: east of the click, or north of it.
  const column = COLUMN_TYPES.map((t, k) => {
    const lane = (k % 2) * 2 - 1;
    const back = 58 + (k >> 1) * 2;
    return geometry === 'cross'
      ? sim.spawn(tid(t), 1, at(32 + lane), at(MAP - 1 - back), 16384)
      : sim.spawn(tid(t), 1, at(back), at(32 + lane), 32768);
  });
  return { sim, ring, column };
}

const clickAt = (): [number, number] => [at(CLICK[0]), at(CLICK[1])];

function orderRing(sim: Sim, ring: number[], arm: Arm, goals: readonly [number, number][]): void {
  const [x, y] = clickAt();
  if (arm !== 'C') {
    sim.queueCommand({ kind: 'move', ids: ring, x, y, formation: 'ambush' });
    return;
  }
  // C: each member to A's tile on an exact order (no group, no slot of its own, travel facing).
  ring.forEach((id, k) => sim.queueCommand({ kind: 'move', ids: [id], x: at(goals[k][0]), y: at(goals[k][1]), exact: true }));
}

function orderColumn(sim: Sim, column: number[], geometry: Geometry): void {
  const x = geometry === 'cross' ? at(CLICK[0]) : at(2);
  const y = geometry === 'cross' ? at(MAP - 3) : at(CLICK[1]);
  sim.queueCommand({ kind: geometry === 'through' ? 'move' : 'attackMove', ids: column, x, y });
}

/** A's order, run alone: the tiles, the radius and the tick by which the ring has settled. */
export function reference(seed: number, geometry: Geometry): Reference {
  const { sim, ring } = build(seed, geometry);
  orderRing(sim, ring, 'A', []);
  sim.tick();
  const goals = ring.map((id): [number, number] => [priv(sim).goalX[id] >> 16, priv(sim).goalY[id] >> 16]);
  let settled = -1;
  for (let t = 1; t < 3000 && settled < 0; t++) {
    sim.tick();
    if (ring.every((id) => ringSettled(sim, id))) settled = t;
  }
  if (settled < 0) throw new Error(`formation probe: the ring never settled (seed ${seed}, ${geometry})`);
  const r2 = sim.ambushRadiusSqOf(ring[0]);
  const radius = Math.round(Math.sqrt(r2 / 65536));
  return { goals, radius, settled };
}

/** Some living column unit stands inside one of `id`'s weapon windows (minimum range to range, tiles). */
function inReach(sim: Sim, id: number, column: readonly number[]): boolean {
  const s = sim.state;
  const type = (units as Record<string, { weapons?: { range_tiles: number; min_range_tiles?: number | null }[] }>)[sim.unitTypes[s.typeIdx[id]].id];
  for (const w of type?.weapons ?? []) {
    for (const c of column) {
      if (s.alive[c] === 0) continue;
      const dx = (s.posX[c] - s.posX[id]) / 65536;
      const dy = (s.posY[c] - s.posY[id]) / 65536;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= w.range_tiles && d >= (w.min_range_tiles ?? 0)) return true;
    }
  }
  return false;
}

/** Stopped, in ambush, and turned to its rest facing. */
function ringSettled(sim: Sim, id: number): boolean {
  const s = sim.state;
  return s.moving[id] === 0 && sim.ambushRadiusSqOf(id) > 0 && priv(sim).restFacing[id] === s.facing[id];
}

export function playAmbush(arm: Arm, seed: number, geometry: Geometry, ref: Reference = reference(seed, geometry), trace?: (t: number, sim: Sim, ring: readonly number[]) => void): AmbushGame {
  const { sim, ring, column } = build(seed, geometry);
  const meter = new DamageMeter(sim);
  const lavi = new Set(ring.slice(0, 2));
  const ringSet = new Set(ring);
  const start = ref.settled + SETTLE_TICKS;
  const radius = fx.fromInt(ref.radius);
  const game: AmbushGame = {
    arm, geometry, engaged: false, membersAtFirstShot: 0, eligible: 0, firedTogether: 0, eligibleFiredTogether: 0, firedLate: 0, firedEver: 0, spreadTicks: 0,
    friendly: 0, friendlyBy: {}, dealt: 0, taken: 0, arcs: { front: 0, side: 0, rear: 0 }, penetrated: 0,
    firstHit: { front: 0, side: 0, rear: 0 }, firstHitPenetrated: 0,
    formationSprung: 0, ambushSprung: 0, grouped: 0, forced: false, ringAlive: 0, columnAlive: 0, result: 'open',
  };
  orderRing(sim, ring, arm, ref.goals);
  const stanced = new Set<number>();
  let bDone = false;
  let firstShot = -1;
  const firstFire = new Map<number, number>();
  let aliveAtFirst: number[] = [];
  let eligibleAtFirst = new Set<number>();
  const hitOnce = new Set<number>();
  for (let t = 0; t < start + GAME_TICKS; t++) {
    if (t === start) orderColumn(sim, column, geometry);
    if (arm === 'B' && !bDone && t >= 1 && (t >= start - 1 || ring.every((id) => ringSettled(sim, id)))) {
      if (t >= start - 1 && !ring.every((id) => ringSettled(sim, id))) game.forced = true;
      sim.queueCommand({ kind: 'setStance', ids: ring.filter((id) => sim.state.alive[id] === 1), stance: 'ambush', radius });
      bDone = true;
    }
    if (arm === 'C' && t >= 2) {
      for (const id of ring) {
        if (stanced.has(id) || sim.state.alive[id] === 0 || sim.state.moving[id] === 1) continue;
        stanced.add(id);
        sim.queueCommand({ kind: 'setStance', ids: [id], stance: 'ambush', radius });
      }
    }
    const events: SimEvent[] = sim.tick();
    trace?.(t, sim, ring);
    if (t === ref.settled && arm === 'A') game.grouped = ring.filter((id) => sim.formationGroupOf(id) >= 0).length;
    for (const e of events) {
      if (e.kind === 'fire' && ringSet.has(e.shooter)) {
        if (firstShot < 0) {
          firstShot = e.tick;
          aliveAtFirst = ring.filter((id) => sim.state.alive[id] === 1 || id === e.shooter);
          eligibleAtFirst = new Set(aliveAtFirst.filter((id) => inReach(sim, id, column)));
        }
        if (!firstFire.has(e.shooter)) firstFire.set(e.shooter, e.tick);
      } else if (e.kind === 'impact' && lavi.has(e.target)) {
        game.arcs[e.arc]++;
        if (e.penetrated) game.penetrated++;
        if (!hitOnce.has(e.target)) {
          hitOnce.add(e.target);
          game.firstHit[e.arc]++;
          if (e.penetrated) game.firstHitPenetrated++;
        }
      } else if (e.kind === 'formationSprung' && ringSet.has(e.entity)) game.formationSprung++;
      else if (e.kind === 'ambushSprung' && ringSet.has(e.entity)) game.ambushSprung++;
    }
    if (t >= start && (t & 15) === 0) {
      const r = ring.filter((id) => sim.state.alive[id] === 1).length;
      const c = column.filter((id) => sim.state.alive[id] === 1).length;
      if (r === 0 || c === 0) break;
    }
  }
  game.engaged = firstShot >= 0;
  if (game.engaged) {
    game.membersAtFirstShot = aliveAtFirst.length;
    game.eligible = eligibleAtFirst.size;
    let spread = 0;
    for (const id of aliveAtFirst) {
      const f = firstFire.get(id);
      if (f === undefined || f - firstShot > FIRE_HORIZON_TICKS) continue;
      game.firedEver++;
      spread = Math.max(spread, f - firstShot);
      if (f - firstShot <= LATE_TICKS) game.firedLate++;
      if (f - firstShot <= TOGETHER_TICKS) {
        game.firedTogether++;
        if (eligibleAtFirst.has(id)) game.eligibleFiredTogether++;
      }
    }
    game.spreadTicks = spread;
  }
  game.friendly = meter.friendly;
  game.friendlyBy = meter.friendlyBy;
  game.dealt = meter.dealt;
  game.taken = meter.taken;
  game.ringAlive = ring.filter((id) => sim.state.alive[id] === 1).length;
  game.columnAlive = column.filter((id) => sim.state.alive[id] === 1).length;
  game.result = game.columnAlive === 0 && game.ringAlive > 0 ? 'ring' : game.ringAlive === 0 && game.columnAlive > 0 ? 'column' : 'open';
  return game;
}

// ---------------------------------------------------------------------------
// The reading
// ---------------------------------------------------------------------------

export interface ArmReading {
  arm: Arm;
  geometry: Geometry;
  games: number;
  engaged: number;
  /** Of members alive at the first shot, the share firing within `TOGETHER_TICKS`, pooled over engagements. */
  togetherShare: number;
  /** The same, of the members that had something in reach. */
  eligibleShare: number;
  /** The same members, within `LATE_TICKS`, and ever (`FIRE_HORIZON_TICKS`). */
  lateShare: number;
  everShare: number;
  /** Engagements in which EVERY such member fired within the window. */
  allTogether: number;
  /** Mean ticks from the first shot to the last member's first shot. */
  meanSpread: number;
  friendlyHp: number;
  dealtHp: number;
  takenHp: number;
  /** friendly / dealt, pooled; null when the ring dealt nothing. */
  friendlyRatio: number | null;
  /** Engagements with any friendly damage. */
  friendlyGames: number;
  arcs: Record<FacingArc, number>;
  penetrated: number;
  firstHit: Record<FacingArc, number>;
  firstHitPenetrated: number;
  ringWins: number;
  columnWins: number;
  open: number;
  meanRingAlive: number;
  meanColumnAlive: number;
  formationSprung: number;
  ambushSprung: number;
  grouped: number;
  forced: number;
}

export function read(games: readonly AmbushGame[]): ArmReading {
  const r: ArmReading = {
    arm: games[0].arm, geometry: games[0].geometry, games: games.length, engaged: 0, togetherShare: 0, eligibleShare: 0, lateShare: 0, everShare: 0, allTogether: 0, meanSpread: 0,
    friendlyHp: 0, dealtHp: 0, takenHp: 0, friendlyRatio: null, friendlyGames: 0, arcs: { front: 0, side: 0, rear: 0 }, penetrated: 0, firstHit: { front: 0, side: 0, rear: 0 }, firstHitPenetrated: 0,
    ringWins: 0, columnWins: 0, open: 0, meanRingAlive: 0, meanColumnAlive: 0, formationSprung: 0, ambushSprung: 0, grouped: 0, forced: 0,
  };
  let members = 0;
  let together = 0;
  let eligible = 0;
  let eligibleTogether = 0;
  let late = 0;
  let ever = 0;
  let spread = 0;
  for (const g of games) {
    if (g.engaged) {
      r.engaged++;
      members += g.membersAtFirstShot;
      together += g.firedTogether;
      eligible += g.eligible;
      eligibleTogether += g.eligibleFiredTogether;
      late += g.firedLate;
      ever += g.firedEver;
      spread += g.spreadTicks;
      if (g.firedTogether === g.membersAtFirstShot) r.allTogether++;
    }
    r.friendlyHp += g.friendly;
    r.dealtHp += g.dealt;
    r.takenHp += g.taken;
    if (g.friendly > 0) r.friendlyGames++;
    for (const a of ['front', 'side', 'rear'] as const) {
      r.arcs[a] += g.arcs[a];
      r.firstHit[a] += g.firstHit[a];
    }
    r.penetrated += g.penetrated;
    r.firstHitPenetrated += g.firstHitPenetrated;
    if (g.result === 'ring') r.ringWins++; else if (g.result === 'column') r.columnWins++; else r.open++;
    r.meanRingAlive += g.ringAlive;
    r.meanColumnAlive += g.columnAlive;
    r.formationSprung += g.formationSprung;
    r.ambushSprung += g.ambushSprung;
    r.grouped += g.grouped;
    if (g.forced) r.forced++;
  }
  r.togetherShare = members === 0 ? 0 : together / members;
  r.eligibleShare = eligible === 0 ? 0 : eligibleTogether / eligible;
  r.lateShare = members === 0 ? 0 : late / members;
  r.everShare = members === 0 ? 0 : ever / members;
  r.meanSpread = r.engaged === 0 ? 0 : spread / r.engaged;
  r.friendlyRatio = r.dealtHp > 0 ? r.friendlyHp / r.dealtHp : null;
  r.meanRingAlive /= games.length;
  r.meanColumnAlive /= games.length;
  return r;
}

/** Runs one geometry: every arm over the same seeds, the reference computed once per seed. */
export function runGeometry(geometry: Geometry, seeds: number): ArmReading[] {
  const games: Record<Arm, AmbushGame[]> = { A: [], B: [], C: [] };
  for (let n = 0; n < seeds; n++) {
    const seed = seedOf(n);
    const ref = reference(seed, geometry);
    for (const arm of ARMS) games[arm].push(playAmbush(arm, seed, geometry, ref));
  }
  return ARMS.map((a) => read(games[a]));
}

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

export function main(args: readonly string[] = process.argv.slice(2)): number {
  const seedsArg = args.find((a) => a.startsWith('--seeds='));
  const seeds = seedsArg === undefined ? SEEDS_DEFAULT : Number(seedsArg.slice(8));
  if (!Number.isInteger(seeds) || seeds < 1) throw new Error('--seeds must be a whole number of at least 1');
  console.log(`formation probes (report-only, GH-859 P1a spec 8.3): ${seeds} seeds, ring = 2 mbt_lavi + 3 inf_squad + 1 mortar_team, column = 2 technical + gun_truck + moto_rpg + 2 sarim_rifles + rpg_team`);
  console.log('arms: A the Ambush formation | B the same slots and facing, each member stanced alone | C exact moves to A\'s tiles, travel facing, each stanced alone');
  for (const geometry of GEOMETRIES) {
    const rows = runGeometry(geometry, seeds);
    console.log('');
    const where: Record<Geometry, string> = {
      head: 'ring marches west to east, column attack-moves in from the east and stops to fight',
      cross: 'ring marches west to east, column attack-moves in from the north and stops to fight',
      through: 'ring marches west to east, column MOVES in from the east and drives through the kill zone',
    };
    console.log(`geometry ${geometry} (${where[geometry]})`);
    console.log('fire together (members alive at the ring\'s first shot that fire within 1 s / 5 s / 10 s of it; "reach" = of those with a column unit in weapon reach):');
    console.log('arm  engaged  <=1 s    reach<=1 s  <=5 s    <=10 s   all alive <=1 s  mean spread');
    for (const r of rows) {
      console.log(
        `${r.arm.padEnd(5)}${String(r.engaged).padEnd(9)}${pct(r.togetherShare).padEnd(9)}${pct(r.eligibleShare).padEnd(12)}${pct(r.lateShare).padEnd(9)}${pct(r.everShare).padEnd(9)}${String(r.allTogether).padEnd(16)}${(r.meanSpread / TICKS_PER_SECOND).toFixed(1)} s`,
      );
    }
    console.log('friendly splash and the fight (per game means over the seeds; hp):');
    console.log('arm  friendly hp  ring dealt hp  friendly/dealt  games with friendly  ring/column/open  ring left  column left  ring took hp');
    for (const r of rows) {
      console.log(
        `${r.arm.padEnd(5)}${(r.friendlyHp / r.games).toFixed(1).padEnd(13)}${(r.dealtHp / r.games).toFixed(1).padEnd(15)}${(r.friendlyRatio === null ? 'n/a' : pct(r.friendlyRatio)).padEnd(16)}${String(r.friendlyGames).padEnd(21)}` +
          `${`${r.ringWins}/${r.columnWins}/${r.open}`.padEnd(18)}${r.meanRingAlive.toFixed(2).padEnd(11)}${r.meanColumnAlive.toFixed(2).padEnd(13)}${(r.takenHp / r.games).toFixed(1)}`,
      );
    }
    const share = (k: number, n: number) => (n === 0 ? 'n/a' : pct(k / n));
    console.log('arcs of impacts on the ring\'s two Lavi (front/side/rear):');
    for (const r of rows) {
      const n = r.arcs.front + r.arcs.side + r.arcs.rear;
      const m = r.firstHit.front + r.firstHit.side + r.firstHit.rear;
      console.log(
        `  ${r.arm}: FIRST hit on each Lavi ${r.firstHit.front}/${r.firstHit.side}/${r.firstHit.rear} of ${m} (${share(r.firstHit.front, m)} front, ${share(r.firstHit.side, m)} side, ${share(r.firstHit.rear, m)} rear), ${r.firstHitPenetrated} penetrating` +
          ` | ALL impacts ${r.arcs.front}/${r.arcs.side}/${r.arcs.rear} of ${n}, ${r.penetrated} penetrating`,
      );
    }
    console.log(`proof the arms ran: formationSprung events A/B/C ${rows.map((r) => r.formationSprung).join('/')}; ambushSprung ${rows.map((r) => r.ambushSprung).join('/')}; ring grouped at arrival (A) ${rows[0].grouped}/${6 * seeds}; B forced ${rows[1].forced}`);
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main();
