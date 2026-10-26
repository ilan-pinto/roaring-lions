/**
 * The room's client (spec §3.3): one socket, the lockstep clock behind it,
 * acks every ACK_EVERY ticks, hashes on hash ticks, and a reconnect that
 * reopens with the same ticket and lets `LockstepClock` discard the head of
 * the log it already ran. Takes a socket FACTORY so tests pass a fake and
 * the browser passes `() => new WebSocket(url)`.
 */
import type { Command } from '@lions/sim';
import type { Faction, MatchConfig, Seat } from './config';
import type { AdvisorMsg, AdvisorScope } from './advisor';
import type { Frame } from './frames';
import { LockstepClock } from './lockstep';
import { parseServerMsg, type ClientMsg, type LobbyKit, type SeatState, type ServerMsg } from './protocol';
import type { MatchTransport, TransportStatus } from './transport';

/** The room's `ACK_EVERY`: a seat acks the last tick of every ten it ran. */
export const ACK_EVERY = 10;
export const RECONNECT_DELAY_MS = 1000;
/** The close code `MatchRoom` gives a socket another hello for its seat replaced:
 *  terminal for the replaced transport, so two tabs on one ticket do not take
 *  the seat from each other in turn. */
export const REPLACED_CLOSE_CODE = 4000;

/** Declared as methods so their parameters are checked bivariantly: a real
 *  `WebSocket` (whose handlers take `Event`, `MessageEvent`, `CloseEvent`) is a
 *  `SocketLike`, and a fake can call them with plain objects. */
interface SocketHandlers {
  open(ev: unknown): void;
  message(ev: { data: unknown }): void;
  close(ev: { code?: number }): void;
}

export interface SocketLike {
  send(data: string): void;
  close(): void;
  onopen: SocketHandlers['open'] | null;
  onmessage: SocketHandlers['message'] | null;
  onclose: SocketHandlers['close'] | null;
}

export interface WsTransportHooks {
  /** `factions`, by seat: the room's matchup (absent from an older room: the mirror).
   *  `kit`: the room's kit rule, named only for `brigade` (absent is matched). */
  onLobby?(seats: SeatState[], you: Seat, map: string, factions?: [Faction, Faction], kit?: LobbyKit): void;
  onStart(config: MatchConfig): void;
  onDesync?(tick: number, hashes: [number, number]): void;
  onEnded?(reason: string, seat?: Seat): void;
  /** A seat paused: how long the room will hold the pause, and each seat's pauses left. */
  onPaused?(seat: Seat, remainingMs: number, pausesLeft: [number, number]): void;
  onChat?(seat: Seat, text: string): void;
  /** The room dropped a command this seat sent, because a pause was in force (an order in flight when it began). */
  onCmdRefused?(): void;
  onError?(code: string): void;
  /** What this seat's pair (its human or its advisor) said, relayed by the room (N4a). */
  onAdvisor?(from: 'human' | 'advisor', a: AdvisorMsg): void;
  /** The advisor scope each seat has seated, or null (N4a). */
  onAdvisors?(present: [AdvisorScope | null, AdvisorScope | null]): void;
}

type Stalled = Extract<TransportStatus, { kind: 'stalled' }>;

/** A disconnected seat, and when (this machine's wall clock) the room will
 *  end the match with the other seat as the winner unless it comes back. */
export interface ForfeitClock { seat: Seat; untilMs: number }
type StallKind = Stalled['reason'];

/**
 * What this seat has SEEN of the room, counted, so a run can show positive
 * evidence that hashes were compared rather than "nothing appeared" (N0 final
 * review I1). Read back through `stats()`; nothing here changes behaviour.
 */
export interface NetStats {
  /** `hashOk`s received: the room paired both seats' hashes and they agreed. */
  hashOk: { count: number; lastTick: number | null };
  /** Stalls by reason, each counted once from its start to the next change
   *  (a different reason, a `resume`, a `log`, or the lobby after a drop).
   *  `longestMs` includes a stall still open when read. */
  stalls: Record<StallKind, { count: number; longestMs: number }>;
  /** Drops that came back: `count` links re-established (a `log`, or the
   *  lobby before the start); `lastOutageMs` from the drop to that answer;
   *  `lastReplayMs` from the `log` to this seat having run it down to its
   *  buffer, null until it has. */
  reconnects: { count: number; lastOutageMs: number | null; lastReplayMs: number | null };
  /** The tick the room reported a desync at, else null. */
  desyncTick: number | null;
}

export class WsTransport implements MatchTransport {
  readonly local = false;
  config: MatchConfig | null = null;
  private clock = new LockstepClock(2);
  private sock: SocketLike | null = null;
  private seq = 0;
  private closed = false;
  /** Every handler reads this copy, so `setHooks` reaches all of them. */
  private readonly hooks: WsTransportHooks;
  /** Set by an `ended` of `left`, `surrender`, `forfeit` or `over`: the frames already
   *  received are still the match's, and the app needs them to reach its own
   *  outcome tick (for `over`, the result a seat that missed it can still reach). */
  private draining = false;
  private st: TransportStatus = { kind: 'waiting' };
  private stalled: Stalled | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly counts: NetStats = {
    hashOk: { count: 0, lastTick: null },
    stalls: { behind: { count: 0, longestMs: 0 }, gone: { count: 0, longestMs: 0 }, connecting: { count: 0, longestMs: 0 }, round: { count: 0, longestMs: 0 } },
    reconnects: { count: 0, lastOutageMs: null, lastReplayMs: null },
    desyncTick: null,
  };
  /** The stall being timed: its reason and when it began. */
  private openStall: { reason: StallKind; since: number } | null = null;
  /** When the link dropped, until the room answers again. */
  private droppedAt: number | null = null;
  /** When a reconnect's `log` arrived, until this seat has run it down. */
  private replayFrom: number | null = null;
  /** The room's `ended`, once it has sent one: what `setHooks` replays. */
  private ending: { reason: string; seat?: Seat } | null = null;
  /** Each seat's pauses left, from the last `paused`: what `setHooks` replays with it. */
  private pausesLeft: [number, number] | null = null;
  /** The advisors the room last named (or this seat cleared on a relink): what `setHooks` replays to a new `onAdvisors`. */
  private advisorsNow: [AdvisorScope | null, AdvisorScope | null] | null = null;
  /** The tick this seat's sim decided the match on, once reported (`over`, L-1). */
  private overTick: number | null = null;
  /** The other seat's forfeit clock while it is disconnected (`dropped`), on this machine's wall clock. */
  private forfeit: ForfeitClock | null = null;

  constructor(
    private readonly open: () => SocketLike,
    private readonly ticket: string,
    private readonly build: string,
    hooks: WsTransportHooks,
    /** Wall-clock ms, for the stall and reconnect timings only. */
    private readonly now: () => number = () => Date.now(),
    /** `advisor`: an AI advisor's socket (N4a). It runs no sim of its own to
     *  report on, so it never acks, hashes, readies, reports `over` or says
     *  `bye`; the room would ignore all five, and a leaving advisor must not
     *  read as a seat leaving. It still hellos, and it still listens. */
    private readonly role: 'seat' | 'advisor' = 'seat',
  ) {
    this.hooks = { ...hooks };
    this.connect();
  }

  /** Replaces the hooks it names and leaves the rest: a lobby hands its live
   *  transport to the battlefield, whose hooks take over from the lobby's.
   *
   *  A hook it installs also hears what is IN FORCE (M-2): an `onEnded`, the
   *  room's ending (final, so it would never fire again), and an `onPaused`,
   *  a pause the room still holds, with its time left now. An `ended` or a
   *  `paused` that lands between the lobby's handover and the battlefield's
   *  hooks reached only the lobby's, which ignore it once the match started.
   *  Only what the ROOM said is replayed: `close()`'s own `closed{left}` and
   *  `detach()` are this seat's doing, not an ending to report. */
  setHooks(hooks: Partial<WsTransportHooks>): void {
    Object.assign(this.hooks, hooks);
    if (hooks.onPaused && this.st.kind === 'paused' && this.pausesLeft !== null) {
      hooks.onPaused(this.st.seat, Math.max(0, this.st.untilMs - this.now()), [this.pausesLeft[0], this.pausesLeft[1]]);
    }
    if (hooks.onEnded && this.ending !== null) hooks.onEnded(this.ending.reason, this.ending.seat);
    // The battlefield's hook arrives after the lobby heard the badges: it must hear them too (N4a task 10).
    if (hooks.onAdvisors && this.advisorsNow !== null) hooks.onAdvisors([this.advisorsNow[0], this.advisorsNow[1]]);
  }

  private setAdvisors(present: [AdvisorScope | null, AdvisorScope | null]): void {
    this.advisorsNow = present;
    this.hooks.onAdvisors?.(present);
  }

  /** Every write of the stall goes through here, so the counters see each
   *  start and end. A change of reason ends one stall and starts another; a
   *  repeat of the same reason (another seat, the room saying it again) is
   *  the same stall. */
  private setStalled(next: Stalled | null): void {
    const at = this.now();
    const open = this.openStall;
    if (open !== null && (next === null || next.reason !== open.reason)) {
      const s = this.counts.stalls[open.reason];
      s.longestMs = Math.max(s.longestMs, at - open.since);
      this.openStall = null;
    }
    if (next !== null && this.openStall === null) {
      this.counts.stalls[next.reason].count++;
      this.openStall = { reason: next.reason, since: at };
    }
    this.stalled = next;
  }
  /** The room answered a reconnect (a `log`, or the lobby before the start). */
  private relinked(): void {
    if (this.droppedAt === null) return;
    this.counts.reconnects.count++;
    this.counts.reconnects.lastOutageMs = this.now() - this.droppedAt;
    this.droppedAt = null;
  }

  /** A snapshot of the counters: a fresh object, so a caller cannot change them. */
  stats(): NetStats {
    const c = structuredClone(this.counts);
    if (this.openStall !== null) {
      const s = c.stalls[this.openStall.reason];
      s.longestMs = Math.max(s.longestMs, this.now() - this.openStall.since);
    }
    return c;
  }

  private connect(): void {
    this.reconnectTimer = null;
    // A socket being replaced must not speak for the new one: a late close
    // from it would schedule a second reconnect.
    const prior = this.sock;
    if (prior !== null) { prior.onopen = null; prior.onmessage = null; prior.onclose = null; }
    const s = this.open();
    this.sock = s;
    // A reconnect that kept its clock asks for the log from its next tick (D6);
    // a first connect, or a reload with no clock, gets the whole log.
    s.onopen = () => this.send(this.config !== null && this.clock.newest >= 0
      ? { t: 'hello', ticket: this.ticket, build: this.build, from: this.clock.newest + 1 }
      : { t: 'hello', ticket: this.ticket, build: this.build });
    s.onmessage = (ev) => this.onMessage(typeof ev.data === 'string' ? ev.data : '');
    s.onclose = (ev) => {
      if (this.closed || this.terminal()) return;
      if (ev.code === REPLACED_CLOSE_CODE) {
        this.setStalled(null);
        this.st = { kind: 'closed', reason: 'replaced' };
        return;
      }
      this.droppedAt ??= this.now();
      const s: Stalled = { kind: 'stalled', reason: 'connecting', seat: null };
      this.setStalled(s);
      this.st = s;
      if (this.reconnectTimer === null) this.reconnectTimer = setTimeout(() => this.connect(), RECONNECT_DELAY_MS);
    };
  }
  private send(msg: ClientMsg): void {
    try { this.sock?.send(JSON.stringify(msg)); } catch { /* closing; the reconnect carries on */ }
  }
  private onMessage(raw: string): void {
    const msg = parseServerMsg(raw);
    if (msg === null) return;
    this.handle(msg);
  }
  private begin(config: MatchConfig): void {
    this.config = config;
    this.clock = new LockstepClock(config.bufferTicks);
    this.hooks.onStart(config);
  }
  /** Desync and closed are final: nothing the room says afterwards revives the transport. */
  private terminal(): boolean {
    return this.st.kind === 'desync' || this.st.kind === 'closed';
  }
  private handle(msg: ServerMsg): void {
    if (this.terminal()) return;
    switch (msg.t) {
      case 'lobby':
        // A reconnect before the start lands back in the lobby, not in a stall.
        if (this.config === null) {
          // A seat that dropped may have missed the room's `advisors` while away:
          // clear its badges so the room's next `advisors` (sent behind a hello
          // when any advisor is seated) is the whole truth, never a stale badge.
          if (this.droppedAt !== null) this.setAdvisors([null, null]);
          this.relinked(); this.setStalled(null); this.st = { kind: 'waiting' };
        }
        this.hooks.onLobby?.(msg.seats, msg.you, msg.map, msg.factions, msg.kit);
        return;
      case 'start':
        this.begin(msg.config);
        this.st = { kind: 'live', behind: 0 };
        return;
      case 'log':
        // A reconnect after a reload has no config yet; one mid-match keeps its clock,
        // which discards the head of the log it already ran.
        if (this.config === null) this.begin(msg.config);
        for (const f of msg.frames) this.clock.push(f);
        // A log in parts (#559 H-1): the seat is relinked and live only after the
        // last. Parts arrive in order on one socket; a drop part-way sends a
        // fresh log on the next socket, whose head the clock discards.
        if (msg.parts !== undefined && msg.part !== undefined && msg.part < msg.parts - 1) return;
        // Whatever this seat heard of a forfeit clock before it dropped is stale:
        // the room re-sends `dropped` behind the log while the other seat is still gone.
        this.forfeit = null;
        if (this.droppedAt !== null) { this.setAdvisors([null, null]); this.relinked(); this.replayFrom = this.now(); }
        this.setStalled(null);
        this.st = { kind: 'live', behind: this.clock.behind() };
        // A report sent while the link was down was lost with it: the room has
        // this seat back now, and keeps only a seat's first report anyway.
        if (this.overTick !== null) this.send({ t: 'over', tick: this.overTick });
        return;
      case 'frame': {
        const r = this.clock.push({ tick: msg.tick, cmds: msg.cmds });
        if (r === 'gap') { this.sock?.close(); return; }   // the reconnect fetches the log
        // A pause outlasts the frames in flight: only the room's `resume` ends it.
        if (this.stalled === null && this.st.kind !== 'paused') this.st = { kind: 'live', behind: this.clock.behind() };
        return;
      }
      case 'stall': {
        const s: Stalled = { kind: 'stalled', reason: msg.reason, seat: msg.seat };
        this.setStalled(s);
        if (this.st.kind !== 'paused') this.st = s;
        return;
      }
      case 'paused':
        this.st = { kind: 'paused', seat: msg.seat, untilMs: this.now() + msg.remainingMs };
        this.pausesLeft = [msg.pausesLeft[0], msg.pausesLeft[1]];
        this.hooks.onPaused?.(msg.seat, msg.remainingMs, msg.pausesLeft);
        return;
      case 'chat': this.hooks.onChat?.(msg.seat, msg.text); return;
      case 'dropped': this.forfeit = { seat: msg.seat, untilMs: this.now() + msg.remainingMs }; return;
      case 'back': if (this.forfeit?.seat === msg.seat) this.forfeit = null; return;
      case 'cmdRefused': this.hooks.onCmdRefused?.(); return;
      case 'advisor': this.hooks.onAdvisor?.(msg.from, msg.a); return;
      case 'advisors': this.setAdvisors(msg.present); return;
      case 'resume': this.setStalled(null); this.st = { kind: 'live', behind: this.clock.behind() }; return;
      case 'hashOk': this.counts.hashOk.count++; this.counts.hashOk.lastTick = msg.tick; return;
      case 'desync':
        this.counts.desyncTick = msg.tick;
        this.setStalled(null);
        this.forfeit = null;
        this.st = { kind: 'desync', tick: msg.tick }; this.hooks.onDesync?.(msg.tick, msg.hashes); return;
      case 'ended':
        this.setStalled(null);
        this.st = { kind: 'closed', reason: msg.reason };
        this.forfeit = null;
        this.draining = msg.reason === 'left' || msg.reason === 'surrender' || msg.reason === 'forfeit' || msg.reason === 'over';
        this.ending = msg.seat === undefined ? { reason: msg.reason } : { reason: msg.reason, seat: msg.seat };
        this.hooks.onEnded?.(msg.reason, msg.seat);
        return;
      case 'error':
        this.hooks.onError?.(msg.code);
        if (msg.code === 'bad_ticket' || msg.code === 'build_mismatch') { this.setStalled(null); this.st = { kind: 'closed', reason: msg.code }; }
        return;
    }
  }

  ready(): void { if (this.role === 'seat') this.send({ t: 'ready' }); }
  /** To this seat's pair, through the room (N4a): text, a ping, a proposal, or the human's accept/veto. */
  advisor(a: AdvisorMsg): void { this.send({ t: 'advisor', a }); }
  /** A bot seat has finished `round` of a paced room (N4a). */
  done(round: number): void { this.send({ t: 'done', round }); }
  queueCommand(cmd: Command): void { this.send({ t: 'cmd', seq: this.seq++, cmd }); }
  pause(): void { this.send({ t: 'pause' }); }
  resume(): void { this.send({ t: 'resume' }); }
  surrender(): void { this.send({ t: 'surrender' }); }
  chat(text: string): void { this.send({ t: 'chat', text }); }
  /** This seat's sim decided the match on `tick` (L-1, R-B26): tells the room
   *  once, so it can close itself `OVER_CLOSE_MS` after the result. Only the
   *  first call speaks (repeated after a reconnect's `log`); a room that has
   *  already ended, voided or been left hears nothing. */
  over(tick: number): void {
    if (this.role !== 'seat' || this.overTick !== null || this.terminal()) return;
    this.overTick = tick;
    this.send({ t: 'over', tick });
  }
  /** Runs while live AND while stalled (R31): a 'behind' stall stalls every
   *  seat, the lagging one included, and only that seat's ack ends it -- so it
   *  must keep running the frames it already holds. A stall's status is left
   *  as it is; the room's `resume` (or a `log`) is what makes it live. A pause
   *  runs them too. After an `ended` of `left`, `surrender` or `forfeit` it drains what was
   *  received, buffer included -- no further frame will arrive to clear it. */
  take(maxTicks: number): Frame[] {
    if (this.draining) return this.clock.drain(maxTicks);
    if (this.st.kind !== 'live' && this.st.kind !== 'stalled' && this.st.kind !== 'paused') return [];
    const out = this.clock.take(maxTicks, this.closedRoundEnd());
    if (this.st.kind === 'live') this.st = { kind: 'live', behind: this.clock.behind() };
    if (this.replayFrom !== null && this.clock.behind() <= this.clock.bufferTicks) {
      this.counts.reconnects.lastReplayMs = this.now() - this.replayFrom;
      this.replayFrom = null;
    }
    return out;
  }
  /** In a PACED room (N4a), the last tick of the newest round the room has
   *  closed: the room mints nothing more until the bot seats are done with it,
   *  so its frames are final and `take` releases them past the buffer --
   *  otherwise a bot could never run a round's last frames before saying
   *  `done`. -1 in a realtime room, which keeps the buffer exactly as before. */
  private closedRoundEnd(): number {
    const pace = this.config?.pace;
    if (pace?.kind !== 'paced') return -1;
    return Math.floor((this.clock.newest + 1) / pace.roundTicks) * pace.roundTicks - 1;
  }
  reportTick(tick: number, digest: number | null): void {
    if (this.role !== 'seat') return;
    if (tick % ACK_EVERY === ACK_EVERY - 1) this.send({ t: 'ack', tick });
    if (digest !== null) this.send({ t: 'hash', tick, h: digest });
  }
  status(): TransportStatus { return this.st; }
  /** The other seat's forfeit clock while it is disconnected mid-match, else
   *  null (cleared when it comes back, when the room ends, and on a desync). */
  forfeitClock(): ForfeitClock | null { return this.forfeit === null ? null : { ...this.forfeit }; }
  /** Frames received and not yet run, in EVERY status (I-1): the `live`
   *  status carries it, but a seat behind-stalled or paused still holds
   *  frames, and a reload rejoin spends most of its replay behind-stalled
   *  (the room kept its old ack), so the battlefield's catch-up cap reads
   *  the clock here rather than from the status. */
  behind(): number { return this.clock.behind(); }
  /** Stops reconnecting and closes the socket WITHOUT a `bye`: the seat is not
   *  leaving, its transport is being handed on (a reload, a new screen). */
  detach(): void {
    this.closed = true;
    if (this.reconnectTimer !== null) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.sock?.close();
    this.setStalled(null);
    this.st = { kind: 'closed', reason: 'detached' };
  }
  close(): void {
    this.closed = true;
    if (this.reconnectTimer !== null) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.role === 'seat') this.send({ t: 'bye' });
    this.sock?.close();
    this.setStalled(null);
    this.st = { kind: 'closed', reason: 'left' };
  }
}
