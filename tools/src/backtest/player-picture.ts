// What a player knows about the enemy, for the scripted plans in `playtest.ts`.
//
// Since 2026-10-11 (#537) a PLAYER's attack-move stops where it is sent: on arrival the unit holds
// and fights what comes inside its own reach, and it no longer walks on by itself to the nearest
// contact its side remembers. That walk (`stepSweep`) was finishing several winning plans on its
// own -- a force parked a few tiles short of the last picket on an objective, and the sweep took it
// the rest of the way. A player has to give that order himself now, and so does a plan.
//
// The order is honest only if it uses what the player could see. A hostile is on the player's
// screen while his side holds any contact on it (`contactLevel` 1 suspected or 2 identified: the
// renderer draws a contact mark over both), and he remembers where he last saw it after the mark
// fades. That memory is what this keeps, and nothing else: no position is read for a hostile the
// side has never observed.
//
// A remembered contact is struck off in two ways, the same two `stepSweep` used. One of ours stands
// on the spot where it was last seen and does not see it there (searched), or it dies. The death
// rule reads `alive`, which a player learns only when he sees the kill. The sweep this replaces
// read the same thing (`destroy` clears every side's last-seen entry), so a plan using it knows no
// more than the shipped behaviour it stands in for did.

import { fx, type Sim } from '@lions/sim';

export interface Seen {
  id: number;
  x: number;
  y: number;
}

/** Tiles, squared: one of ours this close to a last-seen spot has searched it. */
const SEARCHED_SQ = 1.5 * 1.5;

export class Picture {
  private readonly seen = new Map<number, Seen>();
  /** What each contact turned out to be, recorded only once the side has IDENTIFIED it (contact
   *  level 2): the renderer names a unit's type from that level, and a suspected mark is anonymous. */
  private readonly known = new Map<number, string>();

  constructor(
    private readonly sim: Sim,
    private readonly side = 0
  ) {}

  /** Reads the screen: every hostile the side observes now, where it is now. */
  update(): void {
    const st = this.sim.state;
    for (let i = 0; i < this.sim.entityCount; i++) {
      const s = st.side[i];
      if (s === this.side || s > 1) continue;
      if (st.alive[i] !== 1) {
        this.seen.delete(i);
        continue;
      }
      const level = this.sim.contactLevel(this.side, i);
      if (level >= 1) this.seen.set(i, { id: i, x: fx.toNumber(st.posX[i]), y: fx.toNumber(st.posY[i]) });
      if (level >= 2 && !this.known.has(i)) this.known.set(i, this.sim.unitTypes[st.typeIdx[i]].id);
    }
    for (const c of [...this.seen.values()]) {
      if (this.sim.contactLevel(this.side, c.id) >= 1) continue;
      for (let i = 0; i < this.sim.entityCount; i++) {
        if (st.side[i] !== this.side || st.alive[i] !== 1) continue;
        const dx = fx.toNumber(st.posX[i]) - c.x;
        const dy = fx.toNumber(st.posY[i]) - c.y;
        if (dx * dx + dy * dy <= SEARCHED_SQ) {
          this.seen.delete(c.id);
          break;
        }
      }
    }
  }

  /** Every remembered contact, optionally only those inside a zone rectangle `[x, y, w, h]`. */
  contacts(zone?: readonly [number, number, number, number]): Seen[] {
    const all = [...this.seen.values()];
    if (!zone) return all;
    const [zx, zy, zw, zh] = zone;
    return all.filter((c) => c.x >= zx && c.x < zx + zw && c.y >= zy && c.y < zy + zh);
  }

  /** Every remembered contact the side has identified as unit type `typeId`. */
  identified(typeId: string): Seen[] {
    return [...this.seen.values()].filter((c) => this.known.get(c.id) === typeId);
  }

  /** The remembered contact nearest `(x, y)`, or undefined. */
  nearest(x: number, y: number, zone?: readonly [number, number, number, number]): Seen | undefined {
    let best: Seen | undefined;
    let bestD = Infinity;
    for (const c of this.contacts(zone)) {
      const d = (c.x - x) ** 2 + (c.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }
}

/** Living side-0 units, minus `except`. */
export function living(sim: Sim, except: ReadonlySet<number> = new Set()): number[] {
  const out: number[] = [];
  for (let i = 0; i < sim.entityCount; i++) if (sim.state.side[i] === 0 && sim.state.alive[i] === 1 && !except.has(i)) out.push(i);
  return out;
}
