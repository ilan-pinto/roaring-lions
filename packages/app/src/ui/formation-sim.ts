/**
 * What the HUD and the arming read of the sim about combat formations (GH-859 P1a, Task 8; P1b, Task 10).
 *
 * Read-only, and only public reads: `Sim.unitTypes[..].fmClass` / `.fmCall` (what the sim fixed at
 * `addUnitType`), the group table (`formationGroupOf`, `formationTypeOfGroup`, `formationStateOfGroup`,
 * `formationIdOf`), the march (`formationLegOfGroup`, `formationLegsOfGroup`, `formationPaceOfGroup`,
 * `formationPaceSetterOf`), a member's duty (`formationDutyOf`), a degraded order's mark (`formationDegradedOf`)
 * and `ambushRadiusSqOf` (set when the ring stands in its ambush stance). Nothing here writes, and nothing here is
 * a second rule: the sim decides what a formation is, this only turns its public columns into the pure views
 * `formation-model.ts` draws. The group states and duties are the sim's own named constants, not copies.
 */
import { FM_CALL_STAY, FM_CONTACT, FM_DUTY_OUT, FM_DUTY_RETURN, FM_MARCH, FM_SPRUNG, FORMATION_CLASSES, TICKS_PER_SECOND, fx, type Sim } from '@lions/sim';
import {
  FORMATION_IDS,
  formationAnswersCall,
  formationHalts,
  type FormationDegradedView,
  type FormationId,
  type FormationMemberView,
  type FormationUnitFact,
} from './formation-model';

/** The slice of `Sim` these reads need, so a spec can hand a plain object. */
export type FormationReads = Pick<
  Sim,
  | 'state'
  | 'unitTypes'
  | 'formationGroupOf'
  | 'formationTypeOfGroup'
  | 'formationStateOfGroup'
  | 'formationIdOf'
  | 'ambushRadiusSqOf'
  | 'formationLegOfGroup'
  | 'formationLegsOfGroup'
  | 'formationPaceOfGroup'
  | 'formationPaceSetterOf'
  | 'formationDutyOf'
  | 'formationDegradedOf'
>;

const MEDIC_CLASS = FORMATION_CLASSES.indexOf('medic');

/** The formation class code of `id` (`FM_CLASS_NONE` = none), for the arming's `min_members` count. */
export function formationClassOfUnit(sim: Pick<Sim, 'state' | 'unitTypes'>, id: number): number {
  return sim.unitTypes[sim.state.typeIdx[id]].fmClass;
}

/** The formation `id` stands in, or undefined when it is in none. */
export function formationOfUnit(sim: FormationReads, id: number): FormationId | undefined {
  const g = sim.formationGroupOf(id);
  if (g < 0) return undefined;
  const type = sim.formationTypeOfGroup(g);
  if (type < 0) return undefined;
  const name = sim.formationIdOf(type);
  return FORMATION_IDS.find((f) => f === name);
}

/** The checkpoint a marching member's group is dressing (k) of its route's (m), for the chip; undefined for a unit in no
 *  group, a group in contact or sprung (it is not marching), or a one-checkpoint route (the plain line stays). */
export function formationCheckpointOf(sim: FormationReads, id: number): { k: number; m: number } | undefined {
  const g = sim.formationGroupOf(id);
  if (g < 0 || sim.formationStateOfGroup(g) !== FM_MARCH) return undefined;
  const m = sim.formationLegsOfGroup(g);
  return m > 1 ? { k: sim.formationLegOfGroup(g), m } : undefined;
}

/** One selected own unit as the row needs it: its class, whether it can be placed now (not inside a
 *  building, aboard a carrier, below ground or routed: the sim gathers none of those) and whether it is a
 *  casualty-collection vehicle (the legend's Ambulance: a ground medic-class hull; the medevac helicopter
 *  stays "Medic"). */
export function formationUnitFacts(sim: FormationReads, ids: readonly number[]): FormationUnitFact[] {
  const st = sim.state;
  return ids.map((i) => {
    const type = sim.unitTypes[st.typeIdx[i]];
    return {
      cls: type.fmClass,
      free: st.garrisonedIn[i] < 0 && st.carriedBy[i] < 0 && st.tunnelIn[i] < 0 && st.routed[i] === 0,
      ...(type.fmClass === MEDIC_CLASS && !type.isAir && type.wheeled ? { ambulance: true } : {}),
    };
  });
}

/** The pace in tiles a second, one decimal, rounded half up: `Fx` tiles a tick x 20 ticks a second. */
function paceText(pace: number): string {
  const tenths = Math.round(fx.toNumber(pace) * TICKS_PER_SECOND * 10);
  return `${Math.floor(tenths / 10)}.${tenths % 10}`;
}

/** Where a member stands in its formation, for its card; null when `id` is in none (and not degraded).
 *
 *  A unit with no group row that took a template order reads `degraded`. A sprung group is `sprung`. Otherwise a unit
 *  holding its ambush stance (`ambushRadiusSqOf` > 0) is `set`, with its ring radius; an ambush member still walking is
 *  `marching`; one standing without the stance (an aircraft, which the ring does not take) is `standing`. The column and
 *  the attack are `marching`, in `contact` once the group has made it, with the checkpoint being dressed. On any of them: the
 *  pace and who sets it (a ground member of a marching group), and `onCall` / `answering` for a member that answers a call. */
export function formationMemberView(sim: FormationReads, id: number): FormationMemberView | FormationDegradedView | null {
  const formation = formationOfUnit(sim, id);
  if (formation === undefined) return sim.formationDegradedOf(id) ? { degraded: true } : null;
  const g = sim.formationGroupOf(id);
  const state = sim.formationStateOfGroup(g);
  const type = sim.unitTypes[sim.state.typeIdx[id]];
  const duty = sim.formationDutyOf(id);
  const away = duty === FM_DUTY_OUT || duty === FM_DUTY_RETURN;
  const call: Pick<FormationMemberView, 'call'> = away
    ? { call: 'answering' }
    : formationAnswersCall(formation, {
          cls: type.fmClass,
          air: type.isAir,
          stays: type.fmCall === FM_CALL_STAY,
          ambulance: type.fmClass === MEDIC_CLASS && !type.isAir && type.wheeled,
        })
      ? { call: 'onCall' }
      : {};
  if (state === FM_SPRUNG) return { id: formation, phase: 'sprung', ...call };
  const contact = state === FM_CONTACT;
  let view: FormationMemberView;
  if (formation !== 'ambush') {
    view = { id: formation, phase: 'marching', ...(contact ? { contact } : {}) };
    const m = sim.formationLegsOfGroup(g);
    if (!contact && m > 1) view.cp = { n: sim.formationLegOfGroup(g), m };
  } else {
    const sq = sim.ambushRadiusSqOf(id);
    if (sq <= 0) {
      // Still walking to its slot: "moving to the ambush". Standing with no ambush stance is a member the ring does
      // not take (an aircraft); it has no ambush line, only what it answers.
      view = { id: formation, phase: sim.state.moving[id] === 1 ? 'marching' : 'standing' };
    } else {
      // Q16.16 squared tiles back to whole tiles: the ring's radius is an integer, so its square is exact.
      const area = fx.toNumber(sq);
      let radius = 0;
      while ((radius + 1) * (radius + 1) <= area) radius++;
      view = { id: formation, phase: 'set', radius };
    }
  }
  // The pace: a ground member of a group that is marching (a group that halts on contact has stopped; an Attack, which has no pace, presses on at
  // its own speeds; a member away on a call is not held to it).
  const marching = view.phase === 'marching' && !(contact && formationHalts(formation));
  const pace = sim.formationPaceOfGroup(g);
  const setter = sim.formationPaceSetterOf(g);
  if (marching && !type.isAir && !away && pace > 0 && setter >= 0) {
    view.pace = { pace: paceText(pace), unit: sim.unitTypes[sim.state.typeIdx[setter]].name };
  }
  if (call.call !== undefined) view.call = call.call;
  // A member with nothing at all to say (an aircraft in an ambush, not on call) has no card line.
  return view.phase === 'standing' && view.call === undefined ? null : view;
}
