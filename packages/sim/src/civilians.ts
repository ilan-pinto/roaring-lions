// What civilians do when a fight arrives — one rule, two callers.
//
// This was a pair of private members of `MissionRuntime`: `stepCivilians` and
// the arrival half of the `evacuate_before` objective. It moved here so the
// SANDBOX can drive the same rule. `?sandbox=<map>&civ` has no mission, so it
// has no runtime, and the only two ways to reach civilian behaviour from there
// were to hand-copy the rule into `packages/app` — a second implementation of
// a game rule, which is the failure mode `SANDBOX_FLAGS` and `zoneContains`
// exist to prevent — or to write `alive = 0` from outside the sim, which
// invariant 4 forbids outright.
//
// So the rule is a small object both callers own an instance of. Nothing here
// is new behaviour: `MissionRuntime` delegates to it and its own civilian
// tests are unchanged.
//
// Commands in, events out, exactly as before: this queues `move` and `load`
// like any other order source, and the ONE state write it makes — clearing
// `alive` for someone who reached the refuge — is the same write the runtime
// has always made, now made from inside the sim package where it belongs.

import { fx, type Fx } from './fixed';
import type { Sim } from './sim';

/** Civilians break for the refuge above this suppression (0.3). */
export const CIV_FLEE_AT = 19661;
/** A soldier this close is walking these people out: 4 tiles, squared, in the
 *  Q8.8 form the other radius checks use. Civilians move for exactly one other
 *  reason -- fear -- and an evacuation objective built on fear alone would
 *  reward shooting near them to herd them. */
export const SHEPHERD_RADIUS_SQ = 1048576;

/**
 * The flight and the count, for one set of civilians.
 *
 * Holds the two latches (`fled`, `evacuated`) and nothing else — the id lists
 * stay with the caller, because a mission tracks its civilians for ROE
 * danger-close scans as well and would otherwise keep a second copy.
 */
export class CivilianFlight {
  private readonly fledSet = new Set<number>();
  private readonly evacuatedSet = new Set<number>();

  /** How many got out. Latched: dying afterwards does not un-count them. */
  get evacuatedCount(): number {
    return this.evacuatedSet.size;
  }

  /** Whether this civilian has already been counted out. */
  hasEvacuated(id: number): boolean {
    return this.evacuatedSet.has(id);
  }

  /** Whether this civilian has already broken for the refuge. */
  hasFled(id: number): boolean {
    return this.fledSet.has(id);
  }

  /**
   * Civilians shelter in place until fire lands close, then break for the
   * refuge — once, in fear, not as a controlled unit. They also go when a
   * soldier reaches them: that is the player evacuating them, and it is the
   * only way `evacuate_before` can be satisfied without shooting at them.
   *
   * `refuge` is resolved by the caller rather than looked up here, because a
   * mission names a marker and the sandbox synthesises a point.
   */
  step(
    sim: Sim,
    civIds: readonly number[],
    playerIds: readonly number[],
    refuge: readonly [Fx, Fx]
  ): void {
    const st = sim.state;
    const [rx, ry] = refuge;
    for (const civ of civIds) {
      if (st.alive[civ] === 0) continue;
      if (this.fledSet.has(civ)) {
        // Already ordered out -- but the order can be LOST, and the latch used
        // to make that permanent. `fledSet` is added before boarding is even
        // attempted, so a civilian whose transport dies mid-run is set down
        // wherever the wreck fell with no order, and every later tick skipped
        // it on the strength of the latch. `evacuate_before` then never
        // completed: no error, the objective simply hung.
        //
        // Re-order only one that has actually STOPPED. Riding and walking are
        // both progress, and an evacuated civilian is already `alive = 0`
        // (`collect` clears it on arrival), so this cannot re-order someone
        // who is done.
        if (st.carriedBy[civ] >= 0) continue;
        if (st.moving[civ] === 1) continue;
        const rdx = (fx.sub(st.posX[civ], rx) >> 8) | 0;
        const rdy = (fx.sub(st.posY[civ], ry) >> 8) | 0;
        // Standing on the refuge and still not counted means the refuge point
        // sits outside its own evacuation zone -- an authoring fault.
        // Re-ordering there would queue one dead command every tick for the
        // rest of the mission, so it stops here instead.
        if (rdx * rdx + rdy * rdy <= SHEPHERD_RADIUS_SQ) continue;
        sim.queueCommand({ kind: 'move', ids: [civ], x: rx, y: ry });
        continue;
      }
      // A buried civilian cannot be reached, shepherded, or moved — and
      // the latch is set before the order is confirmed, so evaluating one
      // here would freeze it out of `evacuate_before` forever (the same
      // latch-before-confirm shape as the dead-transport debt).
      if (st.tunnelIn[civ] >= 0) continue;
      let leaving = st.suppression[civ] > CIV_FLEE_AT;
      if (!leaving) {
        for (const p of playerIds) {
          // A buried soldier reaches nobody: his coordinates name a tile he
          // is not standing on.
          if (st.alive[p] === 0 || st.tunnelIn[p] >= 0) continue;
          const dx = (fx.sub(st.posX[civ], st.posX[p]) >> 8) | 0;
          const dy = (fx.sub(st.posY[civ], st.posY[p]) >> 8) | 0;
          if (dx * dx + dy * dy <= SHEPHERD_RADIUS_SQ) {
            leaving = true;
            break;
          }
        }
      }
      if (!leaving) continue;
      this.fledSet.add(civ);

      // Prefer boarding a nearby transport with free slots — civilians
      // ride to the compound instead of walking.
      let boarded = false;
      for (const p of playerIds) {
        // Nor does anyone board a hull that is under the earth.
        if (st.alive[p] === 0 || st.tunnelIn[p] >= 0) continue;
        const ptype = sim.unitTypes[st.typeIdx[p]];
        if (ptype.transportSlots === 0) continue;
        if (sim.passengerCount(p) >= ptype.transportSlots) continue;
        const dx2 = (fx.sub(st.posX[civ], st.posX[p]) >> 8) | 0;
        const dy2 = (fx.sub(st.posY[civ], st.posY[p]) >> 8) | 0;
        if (dx2 * dx2 + dy2 * dy2 <= SHEPHERD_RADIUS_SQ) {
          sim.queueCommand({ kind: 'load', ids: [civ], carrier: p });
          boarded = true;
          break;
        }
      }
      if (!boarded) sim.queueCommand({ kind: 'move', ids: [civ], x: rx, y: ry });
    }
  }

  /**
   * Everyone standing inside `zone` who has not been counted yet: latched,
   * cleared from the sim, and RETURNED.
   *
   * Returned rather than announced, because the two callers announce
   * differently — a mission emits `MissionEvent`s with its own tick, the
   * sandbox builds the same events with the sim's. What must not differ is
   * WHO: `alive = 0` is the only record that a civilian left the map and it is
   * the identical record a casualty leaves, so the renderer can only tell a
   * rescue from a killing by being told. Clearing `alive` and returning the id
   * happen in the same branch under the same guard, so exactly one id comes
   * back per civilian and never one who died.
   */
  collect(sim: Sim, civIds: readonly number[], zone: readonly number[]): number[] {
    const out: number[] = [];
    const st = sim.state;
    for (const civ of civIds) {
      if (this.evacuatedSet.has(civ) || st.alive[civ] === 0) continue;
      // The same rule livingIn and contestedIn were fixed for: a buried body's
      // coordinates name a tile it is not standing on. Counting one here
      // evacuates a family that never moved, deletes it, and writes the
      // fabricated rescue into the ledger.
      if (st.tunnelIn[civ] >= 0) continue;
      const tx = st.posX[civ] >> 16;
      const ty = st.posY[civ] >> 16;
      if (tx >= zone[0] && tx < zone[0] + zone[2] && ty >= zone[1] && ty < zone[1] + zone[3]) {
        this.evacuatedSet.add(civ);
        st.alive[civ] = 0;
        out.push(civ);
      }
    }
    return out;
  }
}
