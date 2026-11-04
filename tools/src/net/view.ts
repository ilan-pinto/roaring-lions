/**
 * What one seat's player sees, as data: its own force in full, enemy contacts
 * only while they stand in sight, and the buildings it may be told are held.
 * The AI harness's `observe` serialises this and nothing else, so a model is
 * shown the board its human counterpart is shown (spec §11). Every rule is the
 * renderer's own predicate -- `unitIsObserved`, `heldShown` -- called with this
 * seat's fog, not a copy. A pure read: it never writes to the sim.
 */
import { versusModes } from '@lions/data';
import type { Faction, WinMode } from '@lions/net';
import { campOf } from '../../../packages/app/src/net/versus-force';
import { flagViewOf, type FlagView } from '../../../packages/app/src/net/flag-view';
import { pointsViewOf, type PointsView } from '../../../packages/app/src/net/points-view';
import type { MatchWorld } from '../../../packages/app/src/net/match-world';
import { scoreFor, scoreOf, type SideScore } from '../../../packages/app/src/net/scoreboard';
import { heldBuildings, heldShown } from '../../../packages/render/src/three/units/held-building';
import { unitIsObserved } from '../../../packages/render/src/three/units/observed';
import { fx, WOUND_DOWN, WOUND_NONE, WOUND_STABILISED, type Command } from '@lions/sim';
import { isIdle } from '../../../packages/app/src/ui/idle';
import { economyView, type EconomyView } from './economy-view';
import type { FogTracker } from './fog-tracker';

/** What `setStance` takes: `Command['kind']`'s own union, so a stance the sim adds is a compile error here. */
export type StanceName = Extract<Command, { kind: 'setStance' }>['stance'];
const STANCE_NAMES: Record<StanceName, true> = { hold: true, ambush: true, patrol: true };
/** The stances `order` with verb `setStance` accepts, in the order `observe` lists them. */
export const STANCES = Object.keys(STANCE_NAMES) as StanceName[];
/** A unit's stance as the sim keeps it: `hold` is a halt and leaves no state behind, so a held unit reads `free`. */
export type StanceNow = 'free' | 'ambush' | 'patrol';

export interface UnitLine {
  id: number; type: string; tile: [number, number]; hp: number; flags: string[];
  /** Own units only (GH-954). */
  stance: StanceNow;
  /** Ambush: the radius, in tiles, a target must close to before the unit springs it. */
  radius?: number;
  /** Patrol: how many points its beat has. */
  points?: number;
  /** Why a unit that was ordered to move is not going anywhere. `pinned`: suppressed, so the sim slows it to 1/64 of its speed (`PIN_SPEED_SHIFT`, GDD 5.5) until the fire lifts; its order stands. */
  held?: 'pinned';
}
/**
 * An enemy unit in sight. `observe` lists a contact only while it stands in sight, so `inSight` is always true here, and
 * `tile` is where it stands now (read from the sim, not remembered). `seenTick` is the sim tick of the fog refresh that
 * confirmed it in sight (the fog refreshes every fourth tick, so it is at most 3 ticks old). What the seat remembers of
 * a unit that left sight is never a contact: it is `lastSeen` on an order or a refusal.
 */
export interface ContactLine { id: number; type: string; tile: [number, number]; hp: number; inSight: true; seenTick: number }
/** A wounded man (GH-973): down on the field, in nobody's order of battle. Never an orderable combat unit. */
export interface CasualtyLine { id: number; type: string; tile: [number, number]; state: 'down' | 'stabilised' | 'other'; bleeding?: number }
export interface HeldLine { structure: number; tile: [number, number]; side: 0 | 1 }
export interface SideView {
  tick: number;
  clock: string;
  side: 0 | 1;
  faction: Faction;
  map: string;
  size: [number, number];
  camp: [number, number];
  enemyCamp: [number, number];
  units: UnitLine[];
  contacts: ContactLine[];
  /** Wounded bodies, listed apart from `units` and `contacts`: `mine` (rescue is a medic's job; none are orderable) and `theirs` in sight. */
  casualties: { mine: CasualtyLine[]; theirs: CasualtyLine[] };
  held: HeldLine[];
  /** The stances `order` accepts with verb `setStance` (GH-954): every room allows all three. */
  stances: StanceName[];
  /** Your production, purse and menu (GH-954); absent in a room with no economy (a mirror room, a win-mode room). Yours alone. */
  economy?: EconomyView;
  score: { mine: SideScore; theirs: SideScore };
  /** How this room is won (GH-976 P2): `annihilation`, or the win mode the host picked. */
  mode: 'annihilation' | WinMode;
  /** A points race only: both sides' points, the target, what each side's zones pay a minute and who holds each zone.
   *  PUBLIC by design (see `net/points-view.ts`): the board of a race is read by both seats, as the HUD shows it to a human;
   *  the units on it stay behind the fog (`contacts`). */
  points?: PointsView;
  /** A flag raid only (GH-976 P3): where each flag stands, how long the hold is, and how each raid is going. PUBLIC by design (see
   *  `net/flag-view.ts`): both flags' state is read by both seats; the units in the zones stay behind the fog. */
  flags?: FlagView;
  result: string | null;
  /** How the match was decided, once it has been (`annihilation`, `objective`, `stalemate`, `time`, `mutual`, `surrender`, `left`, `forfeit`); null while it runs. */
  by: string | null;
}

const TICKS_PER_SECOND = 20;

function clockOf(tick: number): string {
  const s = Math.floor(tick / TICKS_PER_SECOND);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

/**
 * Whether the enemy-side entity `i` is in sight of `side` right now: the renderer's draw gate, with this seat's fog.
 * Hidden inside a building, a carrier or a tunnel, and fog-gated in the open. The one copy: `sideView` lists contacts
 * and enemy wounded by it, and the harness's last-seen memory (`seat-memory.ts`) records a position by it, so a
 * remembered tile is always one `observe` would have listed.
 */
export function inSightOf(sim: MatchWorld['sim'], i: number, side: 0 | 1, visibleAt: (x: number, y: number) => boolean): boolean {
  const st = sim.state;
  if (st.garrisonedIn[i] >= 0 || st.carriedBy[i] >= 0 || st.tunnelIn[i] >= 0) return false;
  return unitIsObserved(st.side[i], side, st.posX[i] / 65536, st.posY[i] / 65536, visibleAt);
}

export function sideView(w: MatchWorld, side: 0 | 1, fog: FogTracker, result: string | null, by: string | null = null): SideView {
  const sim = w.sim;
  const st = sim.state;
  const visibleAt = (x: number, y: number): boolean => fog.visibleTile(x, y);
  const units: UnitLine[] = [];
  const contacts: ContactLine[] = [];
  const casualties: { mine: CasualtyLine[]; theirs: CasualtyLine[] } = { mine: [], theirs: [] };
  for (let i = 0; i < sim.entityCount; i++) {
    if (st.alive[i] === 0) continue;
    const s = st.side[i];
    if (s !== 0 && s !== 1) continue; // civilians are not a seat's concern
    const type = sim.unitTypes[st.typeIdx[i]];
    const hp = Math.round((fx.toNumber(st.hp[i]) * 100) / fx.toNumber(type.hp));
    const tile: [number, number] = [st.posX[i] >> 16, st.posY[i] >> 16];
    // A wounded body (a `wounded` role, or any wound state) is a casualty, not a unit: it takes no order.
    const down = st.woundState[i] !== WOUND_NONE || type.isWounded;
    if (down) {
      const state = st.woundState[i] === WOUND_DOWN ? 'down' : st.woundState[i] === WOUND_STABILISED ? 'stabilised' : 'other';
      if (s === side) {
        casualties.mine.push({ id: i, type: type.id, tile, state, bleeding: sim.woundBleedRate(i) });
      } else if (inSightOf(sim, i, side, visibleAt)) {
        casualties.theirs.push({ id: i, type: type.id, tile, state });
      }
      continue;
    }
    if (s === side) {
      const flags: string[] = [];
      if (st.moving[i] !== 0) flags.push('moving');
      if (st.pinned[i] !== 0) flags.push('pinned');
      if (st.routed[i] !== 0) flags.push('routed');
      if (st.garrisonedIn[i] >= 0) flags.push('garrisoned');
      if (st.carriedBy[i] >= 0) flags.push('carried');
      if (st.tunnelIn[i] >= 0) flags.push('buried');
      if (st.mobilityKilled[i] !== 0) flags.push('immobile');
      if (st.firepowerKilled[i] !== 0) flags.push('disarmed');
      // What the player's own HUD shows of its own units: the unit card's
      // "Engaging" (the sim's current target), and the idle finder's key
      // (`isIdle`, the app's own predicate, built the way `main.ts` builds it).
      // Never computed for a contact.
      if (st.curTarget[i] >= 0 || st.curStructure[i] >= 0) flags.push('engaging');
      if (isIdle({
        alive: true, side: s, moving: st.moving[i] !== 0, waypoints: sim.waypointCount(i),
        curTarget: st.curTarget[i], curStructure: st.curStructure[i], demoTarget: st.demoTarget[i],
        carriedBy: st.carriedBy[i], garrisonedIn: st.garrisonedIn[i],
      }, side)) flags.push('idle');
      const unit: UnitLine = { id: i, type: type.id, tile, hp, flags, stance: 'free' };
      // Suppression holds a unit by design (a routed one flees instead, `stepMovement` checks routed first).
      if (st.pinned[i] !== 0 && st.routed[i] === 0) unit.held = 'pinned';
      if (sim.isPatrolling(i)) {
        unit.stance = 'patrol';
        unit.points = sim.patrolCountOf(i);
      } else if (sim.ambushRadiusSqOf(i) > 0) {
        unit.stance = 'ambush';
        unit.radius = Math.round(Math.sqrt(fx.toNumber(sim.ambushRadiusSqOf(i))) * 10) / 10;
      }
      units.push(unit);
      continue;
    }
    // The renderer's draw gate, with this seat's fog: hidden inside a
    // building, a carrier or a tunnel, and fog-gated in the open.
    if (!inSightOf(sim, i, side, visibleAt)) continue;
    contacts.push({ id: i, type: type.id, tile, hp, inSight: true, seenTick: fog.refreshedTick });
  }
  const held: HeldLine[] = [];
  for (const b of heldBuildings(sim, sim.entityCount)) {
    if (b.holder !== 0 && b.holder !== 1) continue;
    if (!heldShown(sim, b, side, visibleAt)) continue;
    held.push({
      structure: b.s,
      tile: [sim.structures.cx[b.s] >> 16, sim.structures.cy[b.s] >> 16],
      side: b.holder,
    });
  }
  // By END, which follows the seat (LD1): a Sarim host is side 1 on `friendly`.
  const camp = campOf(w.anchors, w.endOfSide[side]);
  const enemyCamp = campOf(w.anchors, w.endOfSide[side === 0 ? 1 : 0]);
  const economy = economyView(w, side);
  const pointsRules = w.winMode === 'points' ? versusModes[w.mapJson.id]?.modes.points : undefined;
  const points = pointsRules !== undefined && w.runtime !== null ? pointsViewOf(w.runtime, pointsRules, side) : undefined;
  const flagRules = w.winMode === 'flag' ? versusModes[w.mapJson.id] : undefined;
  const flags = flagRules?.flags !== undefined && w.runtime !== null ? flagViewOf(w.runtime, { flags: flagRules.flags, modes: flagRules.modes }, side, w.endOfSide[side]) : undefined;
  return {
    tick: sim.tickCount,
    clock: clockOf(sim.tickCount),
    side,
    faction: w.factions[side],
    map: w.mapJson.id,
    size: [sim.width, sim.height],
    camp: [camp[0], camp[1]],
    enemyCamp: [enemyCamp[0], enemyCamp[1]],
    units,
    contacts,
    casualties,
    held,
    stances: [...STANCES],
    ...(economy === null ? {} : { economy }),
    score: scoreFor(scoreOf(sim), side),
    mode: w.winMode ?? 'annihilation',
    ...(points === undefined ? {} : { points }),
    ...(flags === undefined ? {} : { flags }),
    result,
    by,
  };
}
