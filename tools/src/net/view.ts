/**
 * What one seat's player sees, as data: its own force in full, enemy contacts
 * only while they stand in sight, and the buildings it may be told are held.
 * The AI harness's `observe` serialises this and nothing else, so a model is
 * shown the board its human counterpart is shown (spec §11). Every rule is the
 * renderer's own predicate -- `unitIsObserved`, `heldShown` -- called with this
 * seat's fog, not a copy. A pure read: it never writes to the sim.
 */
import type { Faction } from '@lions/net';
import { campOf } from '../../../packages/app/src/net/versus-force';
import type { MatchWorld } from '../../../packages/app/src/net/match-world';
import { scoreFor, scoreOf, type SideScore } from '../../../packages/app/src/net/scoreboard';
import { heldBuildings, heldShown } from '../../../packages/render/src/three/units/held-building';
import { unitIsObserved } from '../../../packages/render/src/three/units/observed';
import { fx } from '@lions/sim';
import { isIdle } from '../../../packages/app/src/ui/idle';
import type { FogTracker } from './fog-tracker';

export interface UnitLine { id: number; type: string; tile: [number, number]; hp: number; flags: string[] }
export interface ContactLine { id: number; type: string; tile: [number, number]; hp: number }
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
  held: HeldLine[];
  score: { mine: SideScore; theirs: SideScore };
  result: string | null;
}

const TICKS_PER_SECOND = 20;

function clockOf(tick: number): string {
  const s = Math.floor(tick / TICKS_PER_SECOND);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

export function sideView(w: MatchWorld, side: 0 | 1, fog: FogTracker, result: string | null): SideView {
  const sim = w.sim;
  const st = sim.state;
  const visibleAt = (x: number, y: number): boolean => fog.visibleTile(x, y);
  const units: UnitLine[] = [];
  const contacts: ContactLine[] = [];
  for (let i = 0; i < sim.entityCount; i++) {
    if (st.alive[i] === 0) continue;
    const s = st.side[i];
    if (s !== 0 && s !== 1) continue; // civilians are not a seat's concern
    const type = sim.unitTypes[st.typeIdx[i]];
    const hp = Math.round((fx.toNumber(st.hp[i]) * 100) / fx.toNumber(type.hp));
    const tile: [number, number] = [st.posX[i] >> 16, st.posY[i] >> 16];
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
      units.push({ id: i, type: type.id, tile, hp, flags });
      continue;
    }
    // The renderer's draw gate, with this seat's fog: hidden inside a
    // building, a carrier or a tunnel, and fog-gated in the open.
    if (st.garrisonedIn[i] >= 0 || st.carriedBy[i] >= 0 || st.tunnelIn[i] >= 0) continue;
    if (!unitIsObserved(s, side, st.posX[i] / 65536, st.posY[i] / 65536, visibleAt)) continue;
    contacts.push({ id: i, type: type.id, tile, hp });
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
  const camp = campOf(w.anchors, side);
  const enemyCamp = campOf(w.anchors, side === 0 ? 1 : 0);
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
    held,
    score: scoreFor(scoreOf(sim), side),
    result,
  };
}
