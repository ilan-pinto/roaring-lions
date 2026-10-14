/**
 * The headless client (N4a task 4): a Node process that joins a versus room
 * as a seat (or, from task 5, a seat's advisor) and keeps its OWN `Sim` in
 * step from the room's frames by exactly the browser's path -- the world from
 * `buildMatchWorld`, each frame through `runFrames` (ownership, one tick, the
 * ack and the hash), and the result read on a hash tick by `hashTickOutcome`.
 * Nothing here writes sim state except through `applyFrame`, and the room
 * compares this client's hashes with the browser's like any seat's.
 *
 * What a model sees is `view()`: this seat's side, its fog, and nothing else.
 * What a model orders goes through `desk`, which paces it to the room's caps.
 */
import {
  WsTransport,
  canonicalOrder,
  validateCommand,
  type Frame,
  type MatchConfig,
  type Seat,
  type SeatWorld,
  type SocketLike,
} from '@lions/net';
import { buildMatchWorld, type MatchWorld } from '../../../packages/app/src/net/match-world';
import { runFrames, seatWorldFor } from '../../../packages/app/src/net/frame-step';
import {
  decideOnHashTick,
  matchResult,
  reportOver,
  roomEndingOutcome,
  type LocalDecision,
  type MatchResult,
} from '../../../packages/app/src/net/outcome';
import { FogTracker } from './fog-tracker';
import { OrderDesk } from './order-desk';
import { sideView, type SideView } from './view';
import { nodeSocket } from './node-socket';

export interface AgentClientOptions {
  /** The game's origin, e.g. `https://<your-worker>`. */
  server: string;
  code: string;
  ticket: string;
  /** What the room checks on hello (`buildId()`). */
  build: string;
  role: 'seat' | 'advisor';
  seat: Seat;
  /** Tests pass a fake; default `nodeSocket(<server>/api/match/<code>/ws, origin(server))`. */
  open?: () => SocketLike;
  /** Default: stderr. stdout is the MCP protocol channel and never written. */
  log?: (line: string) => void;
}

/** The match's state, built at `start` (or the first `log`). */
interface Live {
  config: MatchConfig;
  w: MatchWorld;
  side: 0 | 1;
  fog: FogTracker;
  seatWorld: SeatWorld;
}

/** Where a room's socket lives, and the Origin to send it: the browser's own
 *  URL (`connect.ts`), and the server's own origin (decision D9). */
export function matchSocketTarget(server: string, code: string): { url: string; origin: string } {
  const origin = new URL(server).origin;
  return { url: `${origin.replace(/^http/, 'ws')}/api/match/${encodeURIComponent(code)}/ws`, origin };
}

function resultLine(r: MatchResult, side: 0 | 1): string {
  if (r.kind === 'draw') return `draw (${r.by})`;
  return `${r.side === side ? 'won' : 'lost'} (${r.by})`;
}

export class AgentClient {
  readonly ready: Promise<MatchConfig>;
  readonly desk: OrderDesk;
  readonly transport: WsTransport;
  private live: Live | null = null;
  private ran = 0;
  private decided: LocalDecision | null = null;
  private ending: { reason: string; seat?: Seat } | null = null;
  private drained = false;
  private closed = false;
  private readonly log: (line: string) => void;

  constructor(private readonly o: AgentClientOptions) {
    this.log = o.log ?? ((line) => { process.stderr.write(`${line}\n`); });
    let resolve: (c: MatchConfig) => void = () => {};
    let reject: (e: Error) => void = () => {};
    this.ready = new Promise<MatchConfig>((res, rej) => { resolve = res; reject = rej; });
    // Nobody need await `ready` for a refusal to be safe: the rejection is
    // still delivered to whoever does.
    this.ready.catch(() => {});
    // An advisor's orders are never the room's (task 5 gives it proposals):
    // its desk keeps a ledger and sends nothing.
    this.desk = new OrderDesk(o.role === 'seat' ? (cmd) => { this.transport.queueCommand(cmd); } : () => {});
    const open = o.open ?? (() => {
      const target = matchSocketTarget(o.server, o.code);
      return nodeSocket(target.url, target.origin);
    });
    this.transport = new WsTransport(open, o.ticket, o.build, {
      onLobby: (seats, you) => {
        // A seat readies as soon as the room has it; a human seat's lobby
        // button is the browser's, and the room starts when both are ready.
        if (o.role === 'seat' && seats.find((s) => s.seat === you)?.ready !== true) this.transport.ready();
      },
      onStart: (config) => {
        try {
          this.begin(config);
        } catch (err) {
          // A world this checkout cannot build (`buildMatchWorld` throws on
          // an unshipped map) is never played: refuse it rather than throw
          // out of the socket's message handler.
          const e = err instanceof Error ? err : new Error(String(err));
          this.log(e.message);
          reject(e);
          this.close();
          return;
        }
        resolve(config);
      },
      onError: (code) => {
        if (code === 'build_mismatch') {
          // The room does not say which build it runs, so only ours can be named.
          const e = new Error(`the room refused build "${o.build}"; it runs a different build. Check out that build's commit, or pass --build`);
          this.log(e.message);
          reject(e);
          this.close();
        } else if (code === 'bad_ticket') {
          const e = new Error('the room refused the ticket (bad_ticket)');
          this.log(e.message);
          reject(e);
          this.close();
        } else {
          this.log(`room error: ${code}`);
        }
      },
      onEnded: (reason, seat) => {
        this.ending = seat === undefined ? { reason } : { reason, seat };
        this.log(`room ended: ${reason}${seat === undefined ? '' : ` (seat ${seat})`}`);
        reject(new Error(`the room ended before the match started: ${reason}`));
      },
      onDesync: (tick) => { this.log(`desync at tick ${tick}`); },
    });
  }

  private begin(config: MatchConfig): void {
    if (this.live !== null) return;
    const w = buildMatchWorld(config);
    // ONE side for the fog and the view: the seat's own, from the config.
    const side = config.seats[this.o.seat].side as 0 | 1;
    this.live = { config, w, side, fog: new FogTracker(w.sim, side), seatWorld: seatWorldFor(config, w.sim) };
    this.log(`match ${config.code} started: ${config.map}, seat ${this.o.seat} (side ${side}, ${w.factions[side]})`);
  }

  world(): MatchWorld | null {
    return this.live?.w ?? null;
  }

  /** Frames run so far. */
  tick(): number {
    return this.ran;
  }

  /** Runs up to `maxTicks` buffered frames; returns how many ran. */
  pump(maxTicks: number): number {
    const live = this.live;
    if (live === null || this.decided !== null) return 0;
    const { config, w, fog, seatWorld } = live;
    const sim = w.sim;
    const seat = this.o.seat;
    const { ran } = runFrames({
      transport: this.transport,
      sim,
      seatWorld,
      runTick: () => { sim.tick(); fog.step(); },
      config,
      beforeFrame: (f: Frame) => {
        const own = canonicalOrder(f.cmds)
          .filter((s) => s.seat === seat)
          .map((s) => ({ cmd: s.cmd, valid: validateCommand(s.cmd, s.seat, seatWorld) }));
        if (own.length > 0) this.desk.onOwnCommands(own, f.tick);
        this.desk.onTick(f.tick);
      },
      stopAfter: (tick) => {
        this.decided = decideOnHashTick(this.decided, tick, config, sim);
        if (this.decided === null) return false;
        // As the browser does through its end panel: the sim's result, told once.
        reportOver(this.o.role === 'seat' ? this.transport : null, this.decided.result, this.decided);
        this.log(`result at tick ${tick}: ${resultLine(this.decided.result, live.side)}`);
        return true;
      },
    }, maxTicks);
    this.ran += ran;
    if (ran === 0 && this.ending !== null) this.drained = true;
    return ran;
  }

  /** What this seat may know: its own force, contacts in its fog, the score. */
  view(): SideView {
    const live = this.live;
    if (live === null) throw new Error('AgentClient.view: the match has not started');
    const r = this.result();
    return sideView(live.w, live.side, live.fog, r === null ? null : resultLine(r, live.side));
  }

  /** The sim's own result; failing that, the room's ending once its frames are run. */
  result(): MatchResult | null {
    const live = this.live;
    const local = this.decided?.result ?? null;
    if (live === null) return local;
    const ending = this.ending === null
      ? null
      : roomEndingOutcome(this.ending.reason, this.ending.seat, live.side, (s) => live.config.seats[s].side as 0 | 1);
    return matchResult(local, ending, this.drained);
  }

  /** A seat says `bye` (the room reads it as a surrender); an advisor detaches quietly. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.o.role === 'seat') this.transport.close();
    else this.transport.detach();
  }
}
