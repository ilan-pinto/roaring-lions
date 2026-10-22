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
import type { Command } from '@lions/sim';
import { buildMatchWorld, matchTick, type MatchWorld } from '../../../packages/app/src/net/match-world';
import { runFrames, seatWorldFor } from '../../../packages/app/src/net/frame-step';
import { shippedContentDigest } from '../../../packages/app/src/net/content-digest';
import {
  decideOnHashTick,
  productionOf,
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
  /** Folded into every hash this seat reports (`FrameStep.runtimeDigest`,
   *  N2-P2). Absent: the world's own economy runtime's digest (0 in a mirror
   *  room), exactly as the browser's is (N3 Task 3); the room compares it like
   *  the rest of the digest. A test overrides it to make a seat desync. */
  runtimeDigest?: () => number;
}

/** The match's state, built at `start` (or the first `log`). */
interface Live {
  config: MatchConfig;
  w: MatchWorld;
  side: 0 | 1;
  fog: FogTracker;
  seatWorld: SeatWorld;
  /** This client's own content digest (L4), taken once at the start. */
  dataDigest: number;
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
  private failure: string | null = null;
  private readonly log: (line: string) => void;

  constructor(private readonly o: AgentClientOptions) {
    this.log = o.log ?? ((line) => { process.stderr.write(`${line}\n`); });
    let resolve: (c: MatchConfig) => void = () => {};
    let reject: (e: Error) => void = () => {};
    this.ready = new Promise<MatchConfig>((res, rej) => { resolve = res; reject = rej; });
    // Nobody need await `ready` for a refusal to be safe: the rejection is
    // still delivered to whoever does.
    this.ready.catch(() => {});
    // An advisor's orders are never the room's (its proposals are a later
    // task's): its desk has no way to send, refuses `submit`, and so keeps a
    // ledger that reports nothing it did not do.
    this.desk = new OrderDesk(o.role === 'seat' ? (cmd) => { this.transport.queueCommand(cmd); } : null);
    const open = o.open ?? (() => {
      const target = matchSocketTarget(o.server, o.code);
      return nodeSocket(target.url, target.origin);
    });
    this.transport = new WsTransport(open, o.ticket, o.build, {
      onLobby: (seats, you) => {
        // The seat this client was asked to play must be the one the room gave
        // the socket: orders for the wrong side's units are dropped, and a
        // `bye` would end the match for a seat nobody meant to leave.
        if (you !== o.seat) {
          const e = new Error(`the room seated this socket as seat ${you}, but the client was asked to play seat ${o.seat}`);
          this.log(e.message);
          reject(e);
          this.abort();
          return;
        }
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
          // out of the socket's message handler. Detached, not closed: a
          // `bye` would surrender the seat, and the room ending on a leave
          // would read as a match played. `failed()` is what `pnpm agent`
          // reads to exit non-zero.
          const e = err instanceof Error ? err : new Error(String(err));
          this.log(e.message);
          this.failure = e.message;
          reject(e);
          this.abort();
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
    }, undefined, o.role);
  }

  private begin(config: MatchConfig): void {
    if (this.live !== null) return;
    const w = buildMatchWorld(config);
    // ONE side for the fog and the view: the seat's own, from the config.
    const side = config.seats[this.o.seat].side as 0 | 1;
    this.live = { config, w, side, fog: new FogTracker(w.sim, side), seatWorld: seatWorldFor(config, w.sim), dataDigest: shippedContentDigest() };
    this.log(`match ${config.code} started: ${config.map}, seat ${this.o.seat} (side ${side}, ${w.factions[side]})`);
  }

  world(): MatchWorld | null {
    return this.live?.w ?? null;
  }

  /** The room's config, once the match has started. */
  config(): MatchConfig | null {
    return this.live?.config ?? null;
  }

  /** The seat this client plays (or advises). */
  get seat(): Seat {
    return this.o.seat;
  }

  /** Ownership's verdict on `cmd` from this seat, on THIS machine's world:
   *  advisory only. The authoritative drop is `applyFrame`'s, on both
   *  machines, when the frame carrying it runs. False before the start. */
  precheck(cmd: Command): boolean {
    const live = this.live;
    return live !== null && validateCommand(cmd, this.o.seat, live.seatWorld);
  }

  /** Frames run so far. */
  tick(): number {
    return this.ran;
  }

  /** Why this client gave up on a match it could not play (a world this
   *  checkout cannot build), or null. */
  failed(): string | null {
    return this.failure;
  }

  /** Runs up to `maxTicks` buffered frames; returns how many ran. */
  pump(maxTicks: number): number {
    const live = this.live;
    if (live === null || this.decided !== null) return 0;
    const { config, w, fog, seatWorld, dataDigest } = live;
    const sim = w.sim;
    const seat = this.o.seat;
    const { ran } = runFrames({
      transport: this.transport,
      sim,
      seatWorld,
      ...harnessTick(w, fog, this.o.runtimeDigest),
      config,
      dataDigest,
      beforeFrame: (f: Frame) => {
        const own = canonicalOrder(f.cmds)
          .filter((s) => s.seat === seat)
          .map((s) => ({ cmd: s.cmd, valid: validateCommand(s.cmd, s.seat, seatWorld) }));
        if (own.length > 0) this.desk.onOwnCommands(own, f.tick);
        this.desk.onTick(f.tick);
      },
      stopAfter: (tick) => {
        this.decided = decideOnHashTick(this.decided, tick, config, sim, productionOf(w));
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

  /** Closes WITHOUT a `bye`: this socket is not the seat it was meant to be,
   *  or the world it was handed could not be built. */
  private abort(): void {
    if (this.closed) return;
    this.closed = true;
    this.transport.detach();
  }

  /** A seat quitting a match still in play says `bye` (the room reads it as a
   *  surrender). Once the match has a result, or the room has ended it, there
   *  is nothing to give up: the seat detaches, so its `over` stands and the
   *  room never records a leave. An advisor always detaches quietly. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    const over = this.result() !== null || this.ending !== null;
    if (this.o.role === 'seat' && !over) this.transport.close();
    else this.transport.detach();
  }
}

/**
 * The harness's tick and runtime digest (N3 Task 3): the browser's own
 * `matchTick`, then this seat's fog, and the world runtime's digest unless a
 * test overrides it. Exported so a spec can run it against the browser's body
 * and see the two report one digest (`two-client.test.ts`).
 */
export function harnessTick(
  w: Pick<MatchWorld, 'sim' | 'runtime'>,
  fog: { step(): void },
  runtimeDigest?: () => number,
): { runTick: () => void; runtimeDigest: () => number } {
  return {
    runTick: () => { matchTick(w); fog.step(); },
    runtimeDigest: runtimeDigest ?? (() => w.runtime?.digest() ?? 0),
  };
}
