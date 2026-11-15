/**
 * The computer seat (GH-1388): the arena's `rush` script offered as an opponent in an OFFLINE versus match.
 *
 * It is a player like any other. Each decision it reads the same fog-honest `SideView` the AI harness shows a model (`sideView`, built
 * from this seat's OWN fog, `FogTracker`), runs the script, and hands the commands to the arena's `OrderDesk`, which paces them as the
 * room does (at most one flush of four commands every 20 ticks). What leaves the desk are ordinary `Command`s, stamped with the seat and
 * put in the frame like a human's, so `applyFrame`'s ownership check, `cleanCommand` and the sim's own validation apply to them
 * exactly as to a seat on the network. It writes no sim state and reads none directly: the only handle on the sim it is given is the
 * world it builds the view from. `computer-seat.test.ts` scans this file for that.
 *
 * Cadence is the arena's realtime player (`runInProcess`): one decision every `REALTIME_EVERY_TICKS` (100 ticks, 5 s), the first at tick
 * 100, in the frame of that tick. The script is `rush`, untouched: it sends every idle unit still at home to attack-move on what it can
 * see, else on the enemy camp. It issues no build, so this opponent fights with the force it starts with.
 */
import type { Command } from '@lions/sim';
import type { Seat, Stamped } from '@lions/net';
import type { MatchWorld } from '../match-world';
import { FogTracker } from './fog-tracker';
import { OrderDesk } from './order-desk';
import { REALTIME_EVERY_TICKS, rush } from './policy';
import { sideView, type SideView } from './view';

/** A script the seat can run in place: it answers at once. (`rush` and `passive` do; a slow or external policy is the arena's.) */
export type SyncPolicy = (view: SideView) => Command[];

export interface ComputerSeatOptions {
  seat: Seat;
  side: 0 | 1;
  /** Default: the arena's `rush`, as it is. */
  policy?: SyncPolicy;
  /** Ticks between decisions; default `REALTIME_EVERY_TICKS`. */
  every?: number;
}

export class ComputerSeat {
  private world: MatchWorld | null = null;
  private fog: FogTracker | null = null;
  /** Ticks whose fog step has been taken: the tracker is stepped once per tick, as the renderer steps its own. */
  private fogged = 0;
  private seq = 0;
  private readonly out: Command[] = [];
  private readonly desk = new OrderDesk((cmd) => { this.out.push(cmd); });
  private readonly policy: SyncPolicy;
  readonly every: number;
  /** Decisions taken, for the tests and the console. */
  decisions = 0;

  constructor(private readonly o: ComputerSeatOptions) {
    this.policy = o.policy ?? (rush as SyncPolicy);
    this.every = o.every ?? REALTIME_EVERY_TICKS;
  }

  /** Gives the seat the world it plays in, before the first tick. */
  attach(world: MatchWorld): void {
    this.world = world;
    this.fog = new FogTracker(world.sim, this.o.side);
    this.fogged = 0;
  }

  /** Whether a decision falls on `tick`: the frame must then be the FIRST of its batch, so the sim has run every tick before it. */
  decidesAt(tick: number): boolean {
    return tick > 0 && tick % this.every === 0;
  }

  /**
   * The commands this seat puts in the frame of `tick`. Called once per frame, in order, with the sim standing at the start of `tick`.
   * Returns them stamped with the seat, in the order the desk released them.
   */
  commandsFor(tick: number): Stamped[] {
    const world = this.world;
    const fog = this.fog;
    if (world === null || fog === null) return [];
    while (this.fogged < tick) {
      fog.step();
      this.fogged++;
    }
    if (this.decidesAt(tick)) {
      this.decisions++;
      const view = sideView(world, this.o.side, fog, null);
      for (const cmd of this.policy(view)) this.desk.submit(cmd, tick);
    }
    this.desk.onTick(tick);
    return this.out.splice(0).map((cmd) => ({ seat: this.o.seat, seq: this.seq++, cmd }));
  }
}
