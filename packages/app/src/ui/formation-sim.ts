/**
 * What the HUD and the arming read of the sim about combat formations (GH-859 P1a, Task 8).
 *
 * Read-only, and only public reads: `Sim.unitTypes[..].fmClass` (the class the sim fixed at
 * `addUnitType`), `formationGroupOf` / `formationTypeOfGroup` / `formationStateOfGroup` /
 * `formationIdOf` (the group table) and `ambushRadiusSqOf` (set when the ring stands in its
 * ambush stance). Nothing here writes, and nothing here is a second rule: the sim decides what a
 * formation is, this only turns its public columns into the pure views `formation-model.ts` draws.
 *
 * The one number copied is `FM_SPRUNG` (the sim does not export it): `formation-hud.test.ts`
 * springs a real ring and reads this phase back, so the copy cannot drift unseen.
 */
import { FORMATION_CLASSES, fx, type Sim } from '@lions/sim';
import { FORMATION_IDS, type FormationId, type FormationMemberView, type FormationUnitFact } from './formation-model';

/** `fgState` of a sprung row (`formation-template.ts`'s `FM_SPRUNG`, not exported from `@lions/sim`). */
const GROUP_SPRUNG = 4;

/** The slice of `Sim` these reads need, so a spec can hand a plain object. */
export type FormationReads = Pick<
  Sim,
  'state' | 'unitTypes' | 'formationGroupOf' | 'formationTypeOfGroup' | 'formationStateOfGroup' | 'formationIdOf' | 'ambushRadiusSqOf'
>;

const MEDIC_CLASS = FORMATION_CLASSES.indexOf('medic');

/** The formation `id` stands in, or undefined when it is in none. */
export function formationOfUnit(sim: FormationReads, id: number): FormationId | undefined {
  const g = sim.formationGroupOf(id);
  if (g < 0) return undefined;
  const type = sim.formationTypeOfGroup(g);
  if (type < 0) return undefined;
  const name = sim.formationIdOf(type);
  return FORMATION_IDS.find((f) => f === name);
}

/** One selected own unit as the row needs it: its class, whether it can be placed now (not inside a
 *  building, aboard a carrier or below ground) and whether it is a casualty-collection vehicle (the
 *  legend's Ambulance: a ground medic-class hull; the medevac helicopter stays "Medic"). */
export function formationUnitFacts(sim: FormationReads, ids: readonly number[]): FormationUnitFact[] {
  const st = sim.state;
  return ids.map((i) => {
    const type = sim.unitTypes[st.typeIdx[i]];
    return {
      cls: type.fmClass,
      free: st.garrisonedIn[i] < 0 && st.carriedBy[i] < 0 && st.tunnelIn[i] < 0,
      ...(type.fmClass === MEDIC_CLASS && !type.isAir && type.wheeled ? { ambulance: true } : {}),
    };
  });
}

/** Where a member stands in its formation, for its card; null when `id` is in none.
 *
 *  A sprung group is `sprung`. Otherwise a unit holding its ambush stance (`ambushRadiusSqOf` > 0)
 *  is `set`, with its ring radius; an ambush member still walking is `marching`; one standing without
 *  the stance (an aircraft, which the ring does not take) has no line. The column and the attack ignore
 *  the phase. */
export function formationMemberView(sim: FormationReads, id: number): FormationMemberView | null {
  const formation = formationOfUnit(sim, id);
  if (formation === undefined) return null;
  if (sim.formationStateOfGroup(sim.formationGroupOf(id)) === GROUP_SPRUNG) return { id: formation, phase: 'sprung' };
  // The column and the attack have one line whatever the phase.
  if (formation !== 'ambush') return { id: formation, phase: 'marching' };
  const sq = sim.ambushRadiusSqOf(id);
  if (sq <= 0) {
    // Still walking to its slot: "moving to the ambush". Standing with no ambush stance is a member the
    // ring does not take (an aircraft); nothing true to add beyond the chip's "in ambush".
    return sim.state.moving[id] === 1 ? { id: formation, phase: 'marching' } : null;
  }
  // Q16.16 squared tiles back to whole tiles: the ring's radius is an integer, so its square is exact.
  const area = fx.toNumber(sq);
  let radius = 0;
  while ((radius + 1) * (radius + 1) <= area) radius++;
  return { id: formation, phase: 'set', radius };
}
