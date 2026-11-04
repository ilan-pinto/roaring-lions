/**
 * What one seat has seen and lost, kept by the harness for the tools (the 4 Nov bot report, items 1 and 2).
 *
 * Two things a model cannot rebuild from `observe` alone, because `observe` is a snapshot:
 *
 *  - LAST SEEN. Where, and at which tick, an enemy unit was last in this seat's sight. It is updated only when the
 *    fog is recomputed (the renderer's own cadence, `FogTracker.generation`) and only for a unit `inSightOf` says
 *    this seat sees, so a position here is one the seat was shown. A unit the seat never saw is not here, and no tool
 *    may say anything about it that it would not say about an id that does not exist.
 *  - FATE of the seat's OWN units. The tick a unit of this side was found dead. The seat's own ids are its own
 *    knowledge (the fog hides the enemy, not its own force), and an order record that names a dead unit says `died`.
 *
 * A pure read of the sim: it writes nothing back (invariant 4), and runs outside the sim package.
 */
import { WOUND_NONE, type Sim } from '@lions/sim';
import { inSightOf } from './view';
import type { FogTracker } from './fog-tracker';

export interface LastSeen { tile: [number, number]; tick: number }

/** The most last-seen entries kept. Entities are few hundred; this only bounds a pathological spawn count. */
export const LAST_SEEN_MAX = 2048;

export class SeatMemory {
  private readonly seen = new Map<number, LastSeen>();
  /** Own units no longer in play: the tick it was noticed, with how (`died`: destroyed; `removed`: taken off the board alive, `removeFromPlay` / `admitAboard`), or tick -1 and `unknown` for one already gone when memory began (a rejoin). */
  private readonly gone = new Map<number, { fate: 'died' | 'removed' | 'unknown'; tick: number }>();
  private fogGeneration = -1;

  constructor(
    private readonly sim: Sim,
    private readonly side: 0 | 1,
    private readonly fog: FogTracker,
  ) {
    // A client that joins a match under way starts on a world that may already hold dead units: their tick is unknown.
    const st = sim.state;
    for (let i = 0; i < sim.entityCount; i++) if (st.alive[i] === 0 && st.side[i] === side) this.gone.set(i, { fate: 'unknown', tick: -1 });
  }

  /** Call once after every sim tick and its fog step. */
  onTick(): void {
    const sim = this.sim;
    const st = sim.state;
    const tick = sim.tickCount;
    for (let i = 0; i < sim.entityCount; i++) {
      if (st.side[i] === this.side) {
        if (st.alive[i] === 0 && !this.gone.has(i)) this.gone.set(i, { fate: st.removed[i] !== 0 ? 'removed' : 'died', tick });
      }
    }
    if (this.fog.generation === this.fogGeneration) return;
    this.fogGeneration = this.fog.generation;
    const visibleAt = (x: number, y: number): boolean => this.fog.visibleTile(x, y);
    for (let i = 0; i < sim.entityCount; i++) {
      const s = st.side[i];
      if (s === this.side || (s !== 0 && s !== 1) || st.alive[i] === 0) continue;
      // A wounded man is a casualty in `observe`, never a contact: it is not an `attack` target either.
      if (st.woundState[i] !== WOUND_NONE || sim.unitTypes[st.typeIdx[i]].isWounded) continue;
      if (!inSightOf(sim, i, this.side, visibleAt)) continue;
      this.seen.delete(i); // re-insert: eviction below is by oldest sighting
      this.seen.set(i, { tile: [st.posX[i] >> 16, st.posY[i] >> 16], tick });
    }
    if (this.seen.size > LAST_SEEN_MAX) {
      // Oldest sighting first (a Map iterates in insertion order; a refreshed sighting was re-inserted above).
      const over = this.seen.size - LAST_SEEN_MAX;
      let n = 0;
      for (const id of this.seen.keys()) { if (n++ >= over) break; this.seen.delete(id); }
    }
  }

  /** Where and when this seat last saw enemy unit `id` in sight, or null if it never has. */
  lastSeen(id: number): LastSeen | null {
    return this.seen.get(id) ?? null;
  }

  /** What became of own unit `id` and when it was noticed, or null while it is in play (or is not this side's). `unknown`: gone before memory began, tick -1. */
  fateOf(id: number): { fate: 'died' | 'removed' | 'unknown'; tick: number } | null {
    return this.gone.get(id) ?? null;
  }
}
