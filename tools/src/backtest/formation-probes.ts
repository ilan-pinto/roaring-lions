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
//
// GH-859 P1b (spec 8.3, 8.4) adds, all report-only and all on the same flat 64 x 64 map with SHIPPED unit types:
//   ambush re-run  P1a's three arms and geometries again, now that march and calls are live, and arm A once
//                  more with a strike helicopter and a spot drone in the ring (the sorties it flew, whether it
//                  lived, and the contacts raised while every aircraft was on its way home: a RETURN-only
//                  group is not answered until it lands, Ruling 12 literal);
//   medic          F2 Attack and F1 Column, six rifle squads that carry wounds and two medic squads, against a
//                  four-rifle post; paired with the same orders and no formation;
//   air            a gunship in an Attack and called, against the same gunship ordered with the force and no
//                  formation, both against a MANPAD team;
//   ashwar         an unspotted RPG team in `ambush(3)` beside the road a four-vehicle F1 Column drives, against
//                  the same vehicles on a plain move.
// `--probe=<ambush|medic|air|ashwar|all>` picks one (default all); `--seeds=<n>` is the seed count of each.

import { fileURLToPath } from 'node:url';
import { Sim, fx, MED_TREATING, type SimEvent } from '@lions/sim';
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
/** The aircraft the `air` ring adds: a gunship (a `strike` call) and a recon drone (a `spot`). */
const RING_AIR_TYPES = ['heli_peten_gunship', 'recon_drone'] as const;
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
  /** The aircraft arm only (`air`): `strike` and `spot` sorties flown (`formationCall` events), the aircraft
   *  alive at the end of two, the ticks the ring was in contact (a ring member fired, or was fired on) while
   *  every living aircraft was on its way home (duty RETURN) and none was out, and the 'return' calls sent. */
  sorties: number;
  airAlive: number;
  returnOnlyContactTicks: number;
  returns: number;
}

interface Reference {
  /** A's tiles, in ring order. */
  goals: [number, number][];
  /** The ring radius, tiles. */
  radius: number;
  /** The tick by which every member has arrived and turned. */
  settled: number;
}

function build(seed: number, geometry: Geometry, air = false): { sim: Sim; ring: number[]; column: number[]; aircraft: number[] } {
  const sim = new Sim({ seed, width: MAP, height: MAP, capacity: 64 });
  const typeOf = new Map<string, number>();
  for (const id of new Set<string>([...RING_TYPES, ...(air ? RING_AIR_TYPES : []), ...COLUMN_TYPES])) {
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
  // The aircraft stand behind the ring (west of it) and are ordered with it, so a group of eight forms.
  const aircraft = air ? RING_AIR_TYPES.map((t, k) => sim.spawn(tid(t), 0, at(6), at(30 + k * 2), 0)) : [];
  // The column starts out of sight and waits for its order: east of the click, or north of it.
  const column = COLUMN_TYPES.map((t, k) => {
    const lane = (k % 2) * 2 - 1;
    const back = 58 + (k >> 1) * 2;
    return geometry === 'cross'
      ? sim.spawn(tid(t), 1, at(32 + lane), at(MAP - 1 - back), 16384)
      : sim.spawn(tid(t), 1, at(back), at(32 + lane), 32768);
  });
  return { sim, ring, column, aircraft };
}

const clickAt = (): [number, number] => [at(CLICK[0]), at(CLICK[1])];

function orderRing(sim: Sim, ring: number[], arm: Arm, goals: readonly [number, number][], aircraft: readonly number[] = []): void {
  const [x, y] = clickAt();
  if (arm !== 'C') {
    sim.queueCommand({ kind: 'move', ids: [...ring, ...aircraft], x, y, formation: 'ambush' });
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
export function reference(seed: number, geometry: Geometry, air = false): Reference {
  const { sim, ring, aircraft } = build(seed, geometry, air);
  orderRing(sim, ring, 'A', [], aircraft);
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

export function playAmbush(arm: Arm, seed: number, geometry: Geometry, ref: Reference = reference(seed, geometry), trace?: (t: number, sim: Sim, ring: readonly number[]) => void, air = false): AmbushGame {
  if (air && arm !== 'A') throw new Error('formation probe: the aircraft ring is arm A only (B and C form no group to call from)');
  const { sim, ring, column, aircraft } = build(seed, geometry, air);
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
    sorties: 0, airAlive: 0, returnOnlyContactTicks: 0, returns: 0,
  };
  orderRing(sim, ring, arm, ref.goals, aircraft);
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
    // The duty the aircraft held ENTERING this tick: a contact in it was raised against that state.
    const homewardOnly =
      air &&
      aircraft.some((id) => sim.state.alive[id] === 1 && sim.formationDutyOf(id) === 3) &&
      aircraft.every((id) => sim.state.alive[id] === 0 || sim.formationDutyOf(id) !== 2);
    const events: SimEvent[] = sim.tick();
    trace?.(t, sim, ring);
    if (t === ref.settled && arm === 'A') game.grouped = ring.filter((id) => sim.formationGroupOf(id) >= 0).length;
    let contactThisTick = false;
    for (const e of events) {
      if (air && e.kind === 'formationCall' && aircraft.includes(e.entity)) {
        if (e.call === 'return') game.returns++;
        else game.sorties++;
      }
      if (air && ((e.kind === 'fire' && ringSet.has(e.shooter)) || (e.kind === 'impact' && ringSet.has(e.target)))) contactThisTick = true;
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
      } else if (e.kind === 'formationSprung' && (ringSet.has(e.entity) || aircraft.includes(e.entity))) game.formationSprung++;
      else if (e.kind === 'ambushSprung' && (ringSet.has(e.entity) || aircraft.includes(e.entity))) game.ambushSprung++;
    }
    if (homewardOnly && contactThisTick) game.returnOnlyContactTicks++;
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
  game.airAlive = aircraft.filter((id) => sim.state.alive[id] === 1).length;
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

/** Arm A once more with the ring's two aircraft: the games, and what the aircraft did. */
export function runAirRing(geometry: Geometry, seeds: number): AmbushGame[] {
  const games: AmbushGame[] = [];
  for (let n = 0; n < seeds; n++) {
    const seed = seedOf(n);
    games.push(playAmbush('A', seed, geometry, reference(seed, geometry, true), undefined, true));
  }
  return games;
}

// ---------------------------------------------------------------------------
// The P1b call probes: a shared rig
// ---------------------------------------------------------------------------

interface Rig {
  sim: Sim;
  tid: (id: string) => number;
}

/** A sim on the flat open map with the named SHIPPED unit types (and the wounded type of any that carries wounds)
 *  registered, then the formations (a room registers them after its unit types; config, moves no hash). */
function rig(seed: number, ids: readonly string[], capacity = 96): Rig {
  const sim = new Sim({ seed, width: MAP, height: MAP, capacity });
  const typeOf = new Map<string, number>();
  const want = new Set<string>(ids);
  for (const id of ids) {
    const u = (units as Record<string, { hull?: { wounds?: { type: string } } }>)[id];
    if (u === undefined) throw new Error(`formation probe: no shipped unit ${id}`);
    if (u.hull?.wounds !== undefined) want.add(u.hull.wounds.type);
  }
  for (const id of want) typeOf.set(id, sim.addUnitType((units as Record<string, unknown>)[id] as never));
  for (const f of formations) sim.addFormationType(f);
  const tid = (id: string): number => {
    const t = typeOf.get(id);
    if (t === undefined) throw new Error(`formation probe: ${id} not registered`);
    return t;
  };
  return { sim, tid };
}

/** `contact.call_radius_tiles` of a shipped formation: the reach of a casualty or contact call. */
function callRadiusOf(formation: string): number {
  const f = formations.find((x) => x.id === formation);
  if (f === undefined) throw new Error(`formation probe: no formation ${formation}`);
  return f.contact.call_radius_tiles;
}

const median = (xs: readonly number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
};
const mean = (xs: readonly number[]): number | null => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);
const sec = (ticks: number | null): string => (ticks === null ? 'n/a' : (ticks / TICKS_PER_SECOND).toFixed(1) + ' s');
const num = (x: number | null, d = 2): string => (x === null ? 'n/a' : x.toFixed(d));
const share = (k: number, n: number): string => (n === 0 ? 'n/a' : pct(k / n));

// ---------------------------------------------------------------------------
// Medic (spec 8.4, Ruling 14)
// ---------------------------------------------------------------------------
//
// Six rifle squads that carry wounds and two medic squads march into a post of five rifles that stands astride
// their lane (an eight-rifle post stalls the fight at range and a four-rifle one dies without a casualty). F2 Attack (`attackMove`) and F1 Column (`move`), each paired with the SAME orders and no `formation`.
// Reported per arm: the ticks from `woundedDown` to the medic starting treatment (`MED_TREATING`), the bleed-outs,
// the medic squads lost, and the share of casualties no medic was in reach of when he went down (reach = the
// formation's `call_radius_tiles`, 12, measured the same way in both arms).
//
// Ruling 14's costs, counted: a medic that answers walks off with his queue kept and returns to a possibly stale
// `fmHome` (medic ticks on duty OUT), and a halted OUT medic loses his queue (medic ticks beyond the call radius
// from the rifles' centroid while on no duty: stragglers).

export type MedicShape = 'attack' | 'column';
export const MEDIC_SHAPES: readonly MedicShape[] = ['attack', 'column'];
export type MedicArm = 'formed' | 'plain';
export const MEDIC_ARMS: readonly MedicArm[] = ['formed', 'plain'];
const MEDIC_FORCE = ['inf_squad', 'inf_squad', 'inf_squad', 'inf_squad', 'inf_squad', 'inf_squad', 'inf_medic_squad', 'inf_medic_squad'] as const;
const MEDIC_POST = ['sarim_rifles', 'sarim_rifles', 'sarim_rifles', 'sarim_rifles', 'sarim_rifles'] as const;
const MEDIC_TICKS = 220 * TICKS_PER_SECOND;

export interface MedicGame {
  shape: MedicShape;
  arm: MedicArm;
  /** Force members in a formation group at tick 1 (8 formed, 0 plain). */
  grouped: number;
  /** Men of the force who went down (`woundedDown` on side 0). */
  casualties: number;
  /** Of those, how many a medic started treating, and the ticks from going down to that. */
  treated: number;
  /** Of those, men of a medic squad treated by that squad's own medic (not in `startDelays`). */
  ownTreated: number;
  startDelays: number[];
  stabilised: number;
  evacuated: number;
  bledOut: number;
  /** Casualties with no living medic within the call radius when they went down. */
  unreached: number;
  /** `formationCall` casualty events. */
  calls: number;
  medicLosses: number;
  /** Medic-ticks on duty OUT (a formation answer), busy at all (`medState` not idle), and stray (alive, on no
   *  duty, further than the call radius from the rifles' centroid). */
  outTicks: number;
  busyTicks: number;
  strayTicks: number;
  postKilled: number;
  riflesLeft: number;
}

export function playMedic(shape: MedicShape, arm: MedicArm, seed: number): MedicGame {
  const { sim, tid } = rig(seed, [...MEDIC_FORCE, ...MEDIC_POST]);
  const s = sim.state;
  const force = MEDIC_FORCE.map((t, k) => sim.spawn(tid(t), 0, at(8 + (k % 4)), at(29 + Math.floor(k / 4) * 2), 0));
  const rifles = force.filter((_, k) => MEDIC_FORCE[k] === 'inf_squad');
  const medics = force.filter((_, k) => MEDIC_FORCE[k] === 'inf_medic_squad');
  const post = MEDIC_POST.map((t, k) => sim.spawn(tid(t), 1, at(40 + (k % 2) * 2), at(29 + Math.floor(k / 2) * 2), 32768));
  const verb = shape === 'attack' ? 'attackMove' : 'move';
  const cmd = { kind: verb, ids: force, x: at(56), y: at(32) } as const;
  sim.queueCommand(arm === 'formed' ? { ...cmd, formation: shape } : cmd);
  const reach = callRadiusOf(shape);
  const priv2 = sim as unknown as { medState: Uint8Array; medTarget: Int32Array; woundParent: Int32Array };
  const g: MedicGame = {
    shape, arm, grouped: 0, casualties: 0, treated: 0, ownTreated: 0, startDelays: [], stabilised: 0, evacuated: 0, bledOut: 0, unreached: 0, calls: 0,
    medicLosses: 0, outTicks: 0, busyTicks: 0, strayTicks: 0, postKilled: 0, riflesLeft: 0,
  };
  const downAt = new Map<number, number>();
  const started = new Set<number>();
  for (let t = 0; t < MEDIC_TICKS; t++) {
    const events = sim.tick();
    if (t === 0) g.grouped = force.filter((id) => sim.formationGroupOf(id) >= 0).length;
    for (const e of events) {
      if (e.kind === 'woundedDown' && s.side[e.entity] === 0) {
        g.casualties++;
        downAt.set(e.entity, e.tick);
        const wx = s.posX[e.entity];
        const wy = s.posY[e.entity];
        const near = medics.some((m) => {
          if (s.alive[m] === 0) return false;
          const dx = (s.posX[m] - wx) / 65536;
          const dy = (s.posY[m] - wy) / 65536;
          return dx * dx + dy * dy <= reach * reach;
        });
        if (!near) g.unreached++;
      } else if (e.kind === 'woundStabilised' && downAt.has(e.entity)) g.stabilised++;
      else if (e.kind === 'woundEvacuated' && downAt.has(e.entity)) g.evacuated++;
      else if (e.kind === 'bledOut' && downAt.has(e.entity)) g.bledOut++;
      else if (e.kind === 'formationCall' && e.call === 'casualty') g.calls++;
    }
    // A medic that has begun working on a man who went down: the first tick it holds MED_TREATING on him.
    let cx = 0;
    let cy = 0;
    let n = 0;
    for (const r of rifles) {
      if (s.alive[r] === 0) continue;
      cx += s.posX[r] / 65536;
      cy += s.posY[r] / 65536;
      n++;
    }
    for (const m of medics) {
      if (s.alive[m] === 0) continue;
      const tgt = priv2.medTarget[m];
      if (priv2.medState[m] === MED_TREATING && tgt >= 0 && downAt.has(tgt) && !started.has(tgt)) {
        started.add(tgt);
        g.treated++;
        // A medic squad's own man is tended where he fell, at once: counted as treated, kept out of the delay.
        if (priv2.woundParent[tgt] === m) g.ownTreated++;
        else g.startDelays.push(sim.tickCount - 1 - (downAt.get(tgt) as number));
      }
      if (priv2.medState[m] !== 0) g.busyTicks++;
      const duty = sim.formationDutyOf(m);
      if (duty === 2) g.outTicks++;
      else if (duty === 0 && n > 0) {
        const dx = s.posX[m] / 65536 - cx / n;
        const dy = s.posY[m] / 65536 - cy / n;
        if (dx * dx + dy * dy > reach * reach) g.strayTicks++;
      }
    }
  }
  g.medicLosses = medics.filter((m) => s.alive[m] === 0).length;
  g.postKilled = post.filter((p) => s.alive[p] === 0).length;
  g.riflesLeft = rifles.filter((r) => s.alive[r] === 1).length;
  return g;
}

export interface MedicReading {
  shape: MedicShape;
  arm: MedicArm;
  games: number;
  grouped: number;
  /** Games with at least one casualty. */
  engaged: number;
  casualties: number;
  treated: number;
  /** Median / mean ticks from going down to treatment start, over treated casualties. */
  medianDelay: number | null;
  meanDelay: number | null;
  bledOut: number;
  stabilised: number;
  evacuated: number;
  unreached: number;
  calls: number;
  medicLosses: number;
  /** Per game with a casualty. */
  lossesPerEngagement: number | null;
  meanOutTicks: number;
  meanBusyTicks: number;
  meanStrayTicks: number;
  postKilledMean: number;
  riflesLeftMean: number;
}

export function readMedic(games: readonly MedicGame[]): MedicReading {
  const r: MedicReading = {
    shape: games[0].shape, arm: games[0].arm, games: games.length, grouped: 0, engaged: 0, casualties: 0, treated: 0, medianDelay: null, meanDelay: null,
    bledOut: 0, stabilised: 0, evacuated: 0, unreached: 0, calls: 0, medicLosses: 0, lossesPerEngagement: null, meanOutTicks: 0, meanBusyTicks: 0,
    meanStrayTicks: 0, postKilledMean: 0, riflesLeftMean: 0,
  };
  const delays: number[] = [];
  let engagedLosses = 0;
  for (const g of games) {
    r.grouped += g.grouped;
    if (g.casualties > 0) {
      r.engaged++;
      engagedLosses += g.medicLosses;
    }
    r.casualties += g.casualties;
    r.treated += g.treated;
    delays.push(...g.startDelays);
    r.bledOut += g.bledOut;
    r.stabilised += g.stabilised;
    r.evacuated += g.evacuated;
    r.unreached += g.unreached;
    r.calls += g.calls;
    r.medicLosses += g.medicLosses;
    r.meanOutTicks += g.outTicks;
    r.meanBusyTicks += g.busyTicks;
    r.meanStrayTicks += g.strayTicks;
    r.postKilledMean += g.postKilled;
    r.riflesLeftMean += g.riflesLeft;
  }
  r.medianDelay = median(delays);
  r.meanDelay = mean(delays);
  r.lossesPerEngagement = r.engaged === 0 ? null : engagedLosses / r.engaged;
  for (const k of ['meanOutTicks', 'meanBusyTicks', 'meanStrayTicks', 'postKilledMean', 'riflesLeftMean'] as const) r[k] /= games.length;
  return r;
}

export function runMedic(seeds: number): MedicReading[] {
  const out: MedicReading[] = [];
  for (const shape of MEDIC_SHAPES) {
    for (const arm of MEDIC_ARMS) {
      const games: MedicGame[] = [];
      for (let n = 0; n < seeds; n++) games.push(playMedic(shape, arm, seedOf(n)));
      out.push(readMedic(games));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Air (spec 8.4)
// ---------------------------------------------------------------------------
//
// Two tanks, three rifle squads and a gunship attack-move east at a MANPAD team that stands on their lane. `call`:
// the Attack formation, the gunship its aircraft element (it stands 13 tiles behind and flies out when the force
// makes contact). `hull`: the same order to the same ids with no formation, so the gunship is one more attack-mover
// in the hull rank (it outruns the tanks). Reported per arm: contact to the gunship's first shot (contact = the first
// shot by a ground member of the force, or the first enemy shot or hit on it; the gunship firing before that is
// counted `ahead` and reads 0), sorties flown, whether the gunship lived, and the MANPAD team's fate.
//
// Ruling 12 literal: a group whose only aircraft are on their way home is not answered until they land. The probe
// counts the ticks a contact was raised in that state (the Ambush re-run counts them too).

export type AirArm = 'call' | 'hull';
export const AIR_ARMS: readonly AirArm[] = ['call', 'hull'];
const AIR_FORCE = ['mbt_lavi', 'mbt_lavi', 'inf_squad', 'inf_squad', 'inf_squad', 'heli_peten_gunship'] as const;
const AIR_TICKS = 150 * TICKS_PER_SECOND;

export interface AirGame {
  arm: AirArm;
  grouped: number;
  /** Any contact was made at all. */
  contact: boolean;
  /** `strike` calls (formationCall events). */
  sorties: number;
  /** The gunship fired at all, and the ticks from contact to its first shot (0 when it fired ahead of contact). */
  fired: boolean;
  response: number;
  ahead: boolean;
  gunshipAlive: boolean;
  gunshipHpLost: number;
  manpadKilled: boolean;
  /** Ticks the gunship spent on duty OUT, and the contacts raised while it was RETURN-only. */
  outTicks: number;
  returnOnlyContactTicks: number;
}

export function playAir(arm: AirArm, seed: number): AirGame {
  const { sim, tid } = rig(seed, [...AIR_FORCE, 'manpad_team']);
  const s = sim.state;
  const force = AIR_FORCE.map((t, k) => sim.spawn(tid(t), 0, at(8 + (k % 3)), at(29 + Math.floor(k / 3) * 3), 0));
  const heli = force[force.length - 1];
  const ground = new Set(force.slice(0, -1));
  const manpad = sim.spawn(tid('manpad_team'), 1, at(38), at(32), 32768);
  const cmd = { kind: 'attackMove', ids: force, x: at(56), y: at(32) } as const;
  sim.queueCommand(arm === 'call' ? { ...cmd, formation: 'attack' } : cmd);
  const hp0 = s.hp[heli] / 65536;
  const g: AirGame = {
    arm, grouped: 0, contact: false, sorties: 0, fired: false, response: 0, ahead: false, gunshipAlive: false, gunshipHpLost: 0, manpadKilled: false,
    outTicks: 0, returnOnlyContactTicks: 0,
  };
  let contactTick = -1;
  let firstShot = -1;
  for (let t = 0; t < AIR_TICKS; t++) {
    const duty = sim.formationDutyOf(heli);
    const homeward = duty === 3 && s.alive[heli] === 1;
    const events = sim.tick();
    if (t === 0) g.grouped = force.filter((id) => sim.formationGroupOf(id) >= 0).length;
    let contactNow = false;
    for (const e of events) {
      if (e.kind === 'fire' && ground.has(e.shooter)) contactNow = true;
      else if (e.kind === 'fire' && e.shooter === manpad) contactNow = true;
      else if (e.kind === 'impact' && (ground.has(e.target) || e.target === heli)) contactNow = true;
      if (e.kind === 'fire' && e.shooter === heli && firstShot < 0) firstShot = e.tick;
      if (e.kind === 'formationCall' && e.entity === heli && e.call === 'strike') g.sorties++;
    }
    if (contactNow && contactTick < 0) contactTick = t;
    if (contactNow && homeward) g.returnOnlyContactTicks++;
    if (duty === 2) g.outTicks++;
  }
  g.contact = contactTick >= 0;
  g.fired = firstShot >= 0;
  if (g.fired && g.contact) {
    g.ahead = firstShot < contactTick;
    g.response = Math.max(0, firstShot - contactTick);
  }
  g.gunshipAlive = s.alive[heli] === 1;
  g.gunshipHpLost = g.gunshipAlive ? hp0 - s.hp[heli] / 65536 : hp0;
  g.manpadKilled = s.alive[manpad] === 0;
  return g;
}

export interface AirReading {
  arm: AirArm;
  games: number;
  grouped: number;
  contacts: number;
  sorties: number;
  fired: number;
  ahead: number;
  /** Response ticks over the games where the gunship fired after contact. */
  medianResponse: number | null;
  meanResponse: number | null;
  survived: number;
  meanHpLost: number;
  manpadKilled: number;
  meanOutTicks: number;
  returnOnlyContactTicks: number;
}

export function readAir(games: readonly AirGame[]): AirReading {
  const r: AirReading = {
    arm: games[0].arm, games: games.length, grouped: 0, contacts: 0, sorties: 0, fired: 0, ahead: 0, medianResponse: null, meanResponse: null, survived: 0,
    meanHpLost: 0, manpadKilled: 0, meanOutTicks: 0, returnOnlyContactTicks: 0,
  };
  const responses: number[] = [];
  for (const g of games) {
    r.grouped += g.grouped;
    if (g.contact) r.contacts++;
    r.sorties += g.sorties;
    if (g.fired) r.fired++;
    if (g.ahead) r.ahead++;
    if (g.fired && g.contact && !g.ahead) responses.push(g.response);
    if (g.gunshipAlive) r.survived++;
    r.meanHpLost += g.gunshipHpLost;
    if (g.manpadKilled) r.manpadKilled++;
    r.meanOutTicks += g.outTicks;
    r.returnOnlyContactTicks += g.returnOnlyContactTicks;
  }
  r.medianResponse = median(responses);
  r.meanResponse = mean(responses);
  r.meanHpLost /= games.length;
  r.meanOutTicks /= games.length;
  return r;
}

export function runAir(seeds: number): AirReading[] {
  return AIR_ARMS.map((arm) => {
    const games: AirGame[] = [];
    for (let n = 0; n < seeds; n++) games.push(playAir(arm, seedOf(n)));
    return readAir(games);
  });
}

// ---------------------------------------------------------------------------
// Ashwar (spec 8.3, GDD 5.7)
// ---------------------------------------------------------------------------
//
// An RPG team sits in `ambush(3)` beside a lane. A four-vehicle column drives the lane from the west: `column` the
// F1 Column formation (a `move` that halts on contact, and paces every hull to the slowest), `plain` the same four
// hulls on the same `move` with no formation. The claim (GDD 5.7) is that the team's first volley goes in before it
// is identified; target 80%, report-only. "Identified" is the column's side holding the team at `contactLevel` 2,
// read on the tick BEFORE the volley's tick runs.
//
// The sim draws no random number in this approach (identification is deterministic: every seed of one geometry
// reads the same ticks), so a seed index selects a GEOMETRY and the sim's seed only repeats it. The geometries are
// the cover under the team (0 bare verge to 3 the best) and its distance from the lane (0.5, 1.5, 2.5 tiles), 12
// cells cycled by index; the table is read per cover, because the claim stands or falls on it.
//
// An encounter is MET when the team fired or the column held it identified at all. Of the met, the team's volley
// came FIRST (before identification: the claim), or the column FOUND it first (and the team then fired, or never).

export type AshwarArm = 'column' | 'plain';
export const ASHWAR_ARMS: readonly AshwarArm[] = ['column', 'plain'];
const ASHWAR_COLUMN = ['jeep_shoded', 'mbt_lavi', 'ifv_namer', 'apc_eitan'] as const;
const ASHWAR_TICKS = 120 * TICKS_PER_SECOND;
export const ASHWAR_COVERS: readonly number[] = [0, 1, 2, 3];
export const ASHWAR_OFFSETS: readonly number[] = [0.5, 1.5, 2.5];
/** The geometry (cover, distance from the lane in tiles) seed index `n` plays. */
export const ashwarCell = (n: number): { cover: number; offset: number } => ({
  cover: ASHWAR_COVERS[n % ASHWAR_COVERS.length],
  offset: ASHWAR_OFFSETS[Math.floor(n / ASHWAR_COVERS.length) % ASHWAR_OFFSETS.length],
});

export interface AshwarGame {
  arm: AshwarArm;
  cover: number;
  offset: number;
  grouped: number;
  /** The team fired at all, and the tick of its first volley (-1: it never did). */
  engaged: boolean;
  firstVolley: number;
  /** The tick the column's side first held the team identified (-1: never). */
  identified: number;
  /** The team was in the ambush stance at tick 1, and the distance from it to the nearest column hull when it fired
   *  its first volley, tiles (-1: it never fired). An ambusher holds fire until the column is inside its radius (3). */
  stanced: boolean;
  volleyRange: number;
  /** The column and the team met: it fired, or it was identified. */
  met: boolean;
  /** Met, and the first volley went in before the team was identified. */
  volleyFirst: boolean;
  hullsKilled: number;
  teamKilled: boolean;
}

/** The team's first volley (tick, -1 none) came before the column held it identified (the tick the identification was
 *  first seen ENTERING, -1 never). Identified entering the volley's own tick is identified first. */
export const volleyFirstOf = (firstVolley: number, identified: number): boolean => firstVolley >= 0 && (identified < 0 || identified > firstVolley);

export function playAshwar(arm: AshwarArm, seed: number, offset = ashwarCell(0).offset, cover = 0): AshwarGame {
  const { sim, tid } = rig(seed, [...ASHWAR_COLUMN, 'rpg_team']);
  const s = sim.state;
  const column = ASHWAR_COLUMN.map((t, k) => sim.spawn(tid(t), 0, at(4 + k * 2), at(32), 0));
  const team = sim.spawn(tid('rpg_team'), 1, fx.from(32.5), fx.from(32.5 + offset), 49152);
  // The team's tile, and the one each side of it along the lane, carry the geometry's cover.
  if (cover > 0) for (let dx = -1; dx <= 1; dx++) sim.setCover(32 + dx, Math.floor(32.5 + offset), cover);
  sim.queueCommand({ kind: 'setStance', ids: [team], stance: 'ambush', radius: fx.fromInt(3) });
  const cmd = { kind: 'move', ids: column, x: at(58), y: at(32) } as const;
  sim.queueCommand(arm === 'column' ? { ...cmd, formation: 'column' } : cmd);
  const g: AshwarGame = { arm, cover, offset, grouped: 0, engaged: false, firstVolley: -1, identified: -1, stanced: false, volleyRange: -1, met: false, volleyFirst: false, hullsKilled: 0, teamKilled: false };
  for (let t = 0; t < ASHWAR_TICKS; t++) {
    // The identification the volley of this tick will meet is the one held ENTERING it.
    if (g.identified < 0 && sim.contactLevel(0, team) === 2) g.identified = sim.tickCount;
    const events = sim.tick();
    if (t === 0) {
      g.grouped = column.filter((id) => sim.formationGroupOf(id) >= 0).length;
      g.stanced = sim.ambushRadiusSqOf(team) > 0;
    }
    for (const e of events) {
      if (e.kind !== 'fire' || e.shooter !== team || g.firstVolley >= 0) continue;
      g.firstVolley = e.tick;
      let near = Infinity;
      for (const id of column) {
        if (s.alive[id] === 0) continue;
        const dx = (s.posX[id] - s.posX[team]) / 65536;
        const dy = (s.posY[id] - s.posY[team]) / 65536;
        near = Math.min(near, Math.sqrt(dx * dx + dy * dy));
      }
      g.volleyRange = near;
    }
  }
  g.engaged = g.firstVolley >= 0;
  g.met = g.engaged || g.identified >= 0;
  g.volleyFirst = volleyFirstOf(g.firstVolley, g.identified);
  g.hullsKilled = column.filter((id) => s.alive[id] === 0).length;
  g.teamKilled = s.alive[team] === 0;
  return g;
}

export interface AshwarReading {
  arm: AshwarArm;
  /** The cover this row reads, or null for every game of the arm. */
  cover: number | null;
  games: number;
  grouped: number;
  engaged: number;
  met: number;
  volleyFirst: number;
  /** Met, and the column found the team first. Of those, the ones whose team then fired. */
  foundFirst: number;
  foundThenFired: number;
  medianFirstVolley: number | null;
  hullsKilled: number;
  teamKilled: number;
}

export function readAshwar(games: readonly AshwarGame[], cover: number | null = null): AshwarReading {
  const r: AshwarReading = {
    arm: games[0].arm, cover, games: games.length, grouped: 0, engaged: 0, met: 0, volleyFirst: 0, foundFirst: 0, foundThenFired: 0, medianFirstVolley: null, hullsKilled: 0, teamKilled: 0,
  };
  const volleys: number[] = [];
  for (const g of games) {
    r.grouped += g.grouped;
    if (g.engaged) {
      r.engaged++;
      volleys.push(g.firstVolley);
    }
    if (g.met) {
      r.met++;
      if (g.volleyFirst) r.volleyFirst++;
      else {
        r.foundFirst++;
        if (g.engaged) r.foundThenFired++;
      }
    }
    r.hullsKilled += g.hullsKilled;
    if (g.teamKilled) r.teamKilled++;
  }
  r.medianFirstVolley = median(volleys);
  return r;
}

/** Every arm over the same seeds, read for all games and then per cover. */
export function runAshwar(seeds: number): AshwarReading[] {
  const out: AshwarReading[] = [];
  for (const arm of ASHWAR_ARMS) {
    const games: AshwarGame[] = [];
    for (let n = 0; n < seeds; n++) {
      const { cover, offset } = ashwarCell(n);
      games.push(playAshwar(arm, seedOf(n), offset, cover));
    }
    out.push(readAshwar(games));
    for (const c of ASHWAR_COVERS) {
      const sub = games.filter((g) => g.cover === c);
      if (sub.length > 0) out.push(readAshwar(sub, c));
    }
  }
  return out;
}

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

/** The probes `main` can run, `--probe=`. */
export const PROBES = ['ambush', 'medic', 'air', 'ashwar'] as const;
export type Probe = (typeof PROBES)[number];

function printAmbush(seeds: number): void {
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
    // P1b: arm A again with a gunship and a drone in the group.
    const air = runAirRing(geometry, seeds);
    const a = read(air);
    const sorties = air.reduce((n, g) => n + g.sorties, 0);
    const homeward = air.reduce((n, g) => n + g.returnOnlyContactTicks, 0);
    console.log(
      `arm A + aircraft (gunship + drone in the ring, calls live): engaged ${a.engaged}, <=1 s ${pct(a.togetherShare)}, friendly/dealt ${a.friendlyRatio === null ? 'n/a' : pct(a.friendlyRatio)}, ring/column/open ${a.ringWins}/${a.columnWins}/${a.open}, ring left ${a.meanRingAlive.toFixed(2)}`,
    );
    console.log(
      `  aircraft: sorties ${sorties} in ${air.filter((g) => g.sorties > 0).length}/${seeds} games (${(sorties / seeds).toFixed(2)} a game), returns sent ${air.reduce((n, g) => n + g.returns, 0)}, aircraft alive at the end ${air.reduce((n, g) => n + g.airAlive, 0)}/${2 * seeds}, ticks in contact while every aircraft was RETURN-only ${homeward} (Ruling 12: answered only after landing)`,
    );
  }
}

function printMedic(seeds: number): void {
  const rows = runMedic(seeds);
  console.log('');
  console.log(`medic probe (spec 8.4, Ruling 14; report-only): ${seeds} seeds, 6 inf_squad + 2 inf_medic_squad march (8,29) -> (56,32) into a 5-rifle post astride the lane (40-42, 29-33); ${MEDIC_TICKS / TICKS_PER_SECOND} s a game`);
  console.log('arms: formed = F2 Attack (attackMove) / F1 Column (move); plain = the same order, no formation. reach = the formation\'s call_radius_tiles.');
  console.log('shape   arm     grouped  games w/ casualty  casualties  treated  start median / mean  bled out  stabilised  evacuated  no medic in reach');
  for (const r of rows) {
    console.log(
      `${r.shape.padEnd(8)}${r.arm.padEnd(8)}${String(r.grouped).padEnd(9)}${String(r.engaged).padEnd(19)}${String(r.casualties).padEnd(12)}${String(r.treated).padEnd(9)}` +
        `${`${sec(r.medianDelay)} / ${sec(r.meanDelay)}`.padEnd(21)}${String(r.bledOut).padEnd(10)}${String(r.stabilised).padEnd(12)}${String(r.evacuated).padEnd(11)}${share(r.unreached, r.casualties)}`,
    );
  }
  console.log('shape   arm     casualty calls  medic squads lost (per engaged game)  medic s OUT / busy / stray (a game)  rifles left  post killed (of 5)');
  for (const r of rows) {
    console.log(
      `${r.shape.padEnd(8)}${r.arm.padEnd(8)}${String(r.calls).padEnd(16)}${`${r.medicLosses} (${num(r.lossesPerEngagement)})`.padEnd(38)}` +
        `${`${(r.meanOutTicks / TICKS_PER_SECOND).toFixed(1)} / ${(r.meanBusyTicks / TICKS_PER_SECOND).toFixed(1)} / ${(r.meanStrayTicks / TICKS_PER_SECOND).toFixed(1)}`.padEnd(37)}${r.riflesLeftMean.toFixed(2).padEnd(13)}${r.postKilledMean.toFixed(2)}`,
    );
  }
}

function printAir(seeds: number): void {
  const rows = runAir(seeds);
  console.log('');
  console.log(`air probe (spec 8.4; report-only): ${seeds} seeds, 2 mbt_lavi + 3 inf_squad + heli_peten_gunship attack-move (8,29) -> (56,32) at a MANPAD team on the lane; ${AIR_TICKS / TICKS_PER_SECOND} s a game`);
  console.log('arms: call = the Attack formation, the gunship its aircraft element | hull = the same order to the same ids, no formation (the gunship in the hull rank)');
  console.log('arm   grouped  contacts  sorties  gunship fired (ahead of contact)  contact -> first shot median / mean  survived  hp lost (mean)  MANPAD killed  s OUT (a game)  RETURN-only contact ticks');
  for (const r of rows) {
    console.log(
      `${r.arm.padEnd(6)}${String(r.grouped).padEnd(9)}${String(r.contacts).padEnd(10)}${String(r.sorties).padEnd(9)}${`${r.fired} (${r.ahead})`.padEnd(34)}` +
        `${`${sec(r.medianResponse)} / ${sec(r.meanResponse)}`.padEnd(37)}${share(r.survived, r.games).padEnd(10)}${r.meanHpLost.toFixed(0).padEnd(16)}${share(r.manpadKilled, r.games).padEnd(15)}${(r.meanOutTicks / TICKS_PER_SECOND).toFixed(1).padEnd(16)}${r.returnOnlyContactTicks}`,
    );
  }
}

function printAshwar(seeds: number): void {
  const rows = runAshwar(seeds);
  console.log('');
  console.log(
    `ashwar probe (spec 8.3, GDD 5.7; report-only): ${seeds} seeds, rpg_team in ambush(3) on a lane, jeep_shoded + mbt_lavi + ifv_namer + apc_eitan drive (4,32) -> (58,32); ${ASHWAR_TICKS / TICKS_PER_SECOND} s a game; ` +
      `geometry by seed index: cover ${ASHWAR_COVERS.join('/')} x ${ASHWAR_OFFSETS.join('/')} tiles off the lane (the sim draws nothing here, so a seed repeats its geometry)`,
  );
  console.log('arms: column = F1 Column (move, paced to the slowest, halts on contact) | plain = the same hulls on the same move. Claim: first volley before identification, target >= 80% of the encounters met.');
  console.log('arm     cover  games  grouped  team fired  met  volley first (share of met)  found first (then fired)  first volley median  hulls lost  team killed');
  for (const r of rows) {
    console.log(
      `${r.arm.padEnd(8)}${(r.cover === null ? 'all' : String(r.cover)).padEnd(7)}${String(r.games).padEnd(7)}${String(r.grouped).padEnd(9)}${String(r.engaged).padEnd(12)}${String(r.met).padEnd(5)}` +
        `${`${r.volleyFirst} (${share(r.volleyFirst, r.met)})`.padEnd(29)}${`${r.foundFirst} (${r.foundThenFired})`.padEnd(26)}${sec(r.medianFirstVolley).padEnd(21)}${String(r.hullsKilled).padEnd(12)}${share(r.teamKilled, r.games)}`,
    );
  }
}

export function main(args: readonly string[] = process.argv.slice(2)): number {
  const seedsArg = args.find((a) => a.startsWith('--seeds='));
  const seeds = seedsArg === undefined ? SEEDS_DEFAULT : Number(seedsArg.slice(8));
  if (!Number.isInteger(seeds) || seeds < 1) throw new Error('--seeds must be a whole number of at least 1');
  const probeArg = args.find((a) => a.startsWith('--probe='));
  const which = probeArg === undefined ? 'all' : probeArg.slice(8);
  if (which !== 'all' && !(PROBES as readonly string[]).includes(which)) throw new Error(`--probe must be one of ${PROBES.join(', ')} or all`);
  const run = (p: Probe): boolean => which === 'all' || which === p;
  if (run('ambush')) printAmbush(seeds);
  if (run('medic')) printMedic(seeds);
  if (run('air')) printAir(seeds);
  if (run('ashwar')) printAshwar(seeds);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main();
