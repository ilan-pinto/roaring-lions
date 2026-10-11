/**
 * The room's client (spec §3.3): one socket, the lockstep clock behind it,
 * acks every ACK_EVERY ticks, hashes on hash ticks, and a reconnect that
 * reopens with the same ticket and lets `LockstepClock` discard the head of
 * the log it already ran. Takes a socket FACTORY so tests pass a fake and
 * the browser passes `() => new WebSocket(url)`.
 */
import type { Command } from '@lions/sim';
import type { MatchConfig, Seat } from './config';
import type { Frame } from './frames';
import { LockstepClock } from './lockstep';
import { parseServerMsg, type ClientMsg, type SeatState, type ServerMsg } from './protocol';
import type { MatchTransport, TransportStatus } from './transport';

/** The room's `ACK_EVERY`: a seat acks the last tick of every ten it ran. */
export const ACK_EVERY = 10;
export const RECONNECT_DELAY_MS = 1000;

export interface SocketLike {
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
}

export interface WsTransportHooks {
  onLobby?(seats: SeatState[], you: Seat): void;
  onStart(config: MatchConfig): void;
  onDesync?(tick: number, hashes: [number, number]): void;
  onEnded?(reason: string): void;
  onError?(code: string): void;
}

type Stalled = Extract<TransportStatus, { kind: 'stalled' }>;

export class WsTransport implements MatchTransport {
  readonly local = false;
  config: MatchConfig | null = null;
  private clock = new LockstepClock(2);
  private sock: SocketLike | null = null;
  private seq = 0;
  private closed = false;
  private st: TransportStatus = { kind: 'waiting' };
  private stalled: Stalled | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly open: () => SocketLike,
    private readonly ticket: string,
    private readonly build: string,
    private readonly hooks: WsTransportHooks,
  ) {
    this.connect();
  }

  private connect(): void {
    this.reconnectTimer = null;
    // A socket being replaced must not speak for the new one: a late close
    // from it would schedule a second reconnect.
    const prior = this.sock;
    if (prior !== null) { prior.onopen = null; prior.onmessage = null; prior.onclose = null; }
    const s = this.open();
    this.sock = s;
    s.onopen = () => this.send({ t: 'hello', ticket: this.ticket, build: this.build });
    s.onmessage = (ev) => this.onMessage(typeof ev.data === 'string' ? ev.data : '');
    s.onclose = () => {
      if (this.closed || this.st.kind === 'desync' || this.st.kind === 'closed') return;
      this.stalled = { kind: 'stalled', reason: 'connecting', seat: null };
      this.st = this.stalled;
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
  private handle(msg: ServerMsg): void {
    switch (msg.t) {
      case 'lobby':
        // A reconnect before the start lands back in the lobby, not in a stall.
        if (this.config === null) { this.stalled = null; this.st = { kind: 'waiting' }; }
        this.hooks.onLobby?.(msg.seats, msg.you);
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
        this.stalled = null;
        this.st = { kind: 'live', behind: this.clock.behind() };
        return;
      case 'frame': {
        const r = this.clock.push({ tick: msg.tick, cmds: msg.cmds });
        if (r === 'gap') { this.sock?.close(); return; }   // the reconnect fetches the log
        if (this.stalled === null) this.st = { kind: 'live', behind: this.clock.behind() };
        return;
      }
      case 'stall': this.stalled = { kind: 'stalled', reason: msg.reason, seat: msg.seat }; this.st = this.stalled; return;
      case 'resume': this.stalled = null; this.st = { kind: 'live', behind: this.clock.behind() }; return;
      case 'hashOk': return;
      case 'desync': this.st = { kind: 'desync', tick: msg.tick }; this.hooks.onDesync?.(msg.tick, msg.hashes); return;
      case 'ended': this.st = { kind: 'closed', reason: msg.reason }; this.hooks.onEnded?.(msg.reason); return;
      case 'error':
        this.hooks.onError?.(msg.code);
        if (msg.code === 'bad_ticket' || msg.code === 'build_mismatch') this.st = { kind: 'closed', reason: msg.code };
        return;
    }
  }

  ready(): void { this.send({ t: 'ready' }); }
  queueCommand(cmd: Command): void { this.send({ t: 'cmd', seq: this.seq++, cmd }); }
  take(maxTicks: number): Frame[] {
    if (this.st.kind !== 'live') return [];
    const out = this.clock.take(maxTicks);
    this.st = { kind: 'live', behind: this.clock.behind() };
    return out;
  }
  reportTick(tick: number, digest: number | null): void {
    if (tick % ACK_EVERY === ACK_EVERY - 1) this.send({ t: 'ack', tick });
    if (digest !== null) this.send({ t: 'hash', tick, h: digest });
  }
  status(): TransportStatus { return this.st; }
  close(): void {
    this.closed = true;
    if (this.reconnectTimer !== null) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.send({ t: 'bye' });
    this.sock?.close();
    this.st = { kind: 'closed', reason: 'left' };
  }
}
