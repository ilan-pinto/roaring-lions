/**
 * In-memory stand-ins for the Durable Object runtime, so `MatchRoom` runs
 * under node (R19): a storage with a key-value half and exactly the SQL
 * `MatchRoom` issues, a state that accepts and lists hibernating sockets, and
 * a socket that logs what it was sent. Not a test file, so other specs (the
 * room-loop test) can import it; nothing the Worker ships imports it.
 *
 * Fidelity worth knowing: values are structured-cloned on the way in and out,
 * as the real storage serialises them, so a test that reads storage sees what
 * was PERSISTED rather than the room's live object. A socket the room calls
 * `close()` on stays in `getWebSockets()` (workerd holds it in CLOSING; its
 * docs promise only that DISCONNECTED sockets are removed) until a test
 * delivers its close event with `deliverClose`.
 */
import type { DurableStateLike, DurableStorageLike, HibernatingSocket, SqlRows } from '../do-types';
import { LOG_FROM_SQL, SNAP_CREATE_SQL, SNAP_GET_SQL, SNAP_PUT_SQL, SNAP_TICK_SQL } from './snapshot-sql';

const rows = (r: Record<string, unknown>[]): SqlRows => ({ toArray: () => r });
const norm = (q: string): string => q.replace(/\s+/g, ' ').trim();

export class FakeStorage implements DurableStorageLike {
  readonly kv = new Map<string, unknown>();
  /** The `batch` table: first_tick -> frames JSON. */
  readonly batches = new Map<number, string>();
  private tableExists = false;
  /** The one snapshot row (id 0), or null: frame tick, SHA, digest and the stored (cloned) bytes. */
  snapshotRow: { frame_tick: number; sha: string; digest: number; bytes: ArrayBuffer } | null = null;
  private snapshotTable = false;
  /** Test switch: when true the snapshot row write throws, as a storage refusal would. */
  failSnapshotPut = false;
  /** Whether the `snapshot` table exists. */
  get hasSnapshotTable(): boolean { return this.snapshotTable; }
  /** Rows returned by SELECTs: the Workers Free read meter, counted per row. */
  rowsRead = 0;
  /** Whether the `batch` table exists: a probe of a missing room must never create it (#559 H-1). */
  get hasTable(): boolean { return this.tableExists; }
  /** Calls to `deleteAll`. */
  wipes = 0;
  /** Rows written: each `put` and each INSERT/UPDATE/REPLACE statement counts one (the Workers Free meter). */
  rowsWritten = 0;
  /** The scheduled alarm, epoch ms, or null. Nothing fires it by itself: a test does, with `deliverAlarm`. */
  alarmAt: number | null = null;

  async get<T>(key: string): Promise<T | undefined> {
    const v = this.kv.get(key);
    return v === undefined ? undefined : (structuredClone(v) as T);
  }
  async put<T>(key: string, value: T): Promise<void> {
    this.rowsWritten++;
    this.kv.set(key, structuredClone(value));
  }
  /** Cloudflare bills each `setAlarm()` as one row written (Durable Objects
   *  pricing, SQLite backend), so it counts on the meter. */
  async setAlarm(scheduledTime: number): Promise<void> {
    this.rowsWritten++;
    this.alarmAt = scheduledTime;
  }
  async getAlarm(): Promise<number | null> {
    return this.alarmAt;
  }
  /** Counted too, conservatively: the pricing page bills deletes as rows
   *  written and does not say whether that covers `deleteAlarm()`. */
  async deleteAlarm(): Promise<void> {
    if (this.alarmAt !== null) this.rowsWritten++;
    this.alarmAt = null;
  }
  /** Deletes every key and the table, as the SQLite backend's `deleteAll` does.
   *  Each deleted row is counted as one written: Cloudflare bills deletes as
   *  rows written, so a wipe costs what the room stored. The alarm is left
   *  alone (the room deletes it itself). */
  async deleteAll(): Promise<void> {
    this.wipes++;
    this.rowsWritten += this.kv.size + this.batches.size + (this.snapshotRow ? 1 : 0);
    this.kv.clear();
    this.batches.clear();
    this.tableExists = false;
    this.snapshotRow = null;
    this.snapshotTable = false;
  }
  readonly sql = {
    exec: (query: string, ...bindings: unknown[]): SqlRows => this.exec(norm(query), bindings),
  };

  private exec(q: string, b: unknown[]): SqlRows {
    const out = this.run(q, b);
    if (q.startsWith('SELECT')) this.rowsRead += out.toArray().length;
    return out;
  }

  private run(q: string, b: unknown[]): SqlRows {
    if (q === SNAP_CREATE_SQL) {
      this.snapshotTable = true;
      return rows([]);
    }
    if (q === SNAP_PUT_SQL || q === SNAP_TICK_SQL || q === SNAP_GET_SQL) {
      if (!this.snapshotTable) throw new Error('FakeStorage: no such table: snapshot');
      if (q === SNAP_TICK_SQL) return rows(this.snapshotRow ? [{ frame_tick: this.snapshotRow.frame_tick }] : []);
      if (q === SNAP_GET_SQL) {
        const r = this.snapshotRow;
        return rows(r ? [{ frame_tick: r.frame_tick, sha: r.sha, digest: r.digest, bytes: r.bytes.slice(0) }] : []);
      }
      if (this.failSnapshotPut) throw new Error('FakeStorage: snapshot put refused');
      const [tick, sha, digest, bytes] = b;
      if (b.length !== 4 || typeof tick !== 'number' || !Number.isInteger(tick) || typeof sha !== 'string' || !/^[0-9a-f]{64}$/.test(sha)
        || typeof digest !== 'number' || !Number.isInteger(digest) || digest < 0 || digest > 0xffffffff || !(bytes instanceof ArrayBuffer)) {
        throw new Error(`FakeStorage: bad bindings for snapshot put: ${JSON.stringify(b.map((x) => (x instanceof ArrayBuffer ? 'ArrayBuffer' : x)))}`);
      }
      this.rowsWritten++;
      this.snapshotRow = { frame_tick: tick, sha, digest, bytes: bytes.slice(0) };
      return rows([]);
    }
    if (q === 'CREATE TABLE IF NOT EXISTS batch (first_tick INTEGER PRIMARY KEY, frames TEXT NOT NULL)') {
      this.tableExists = true;
      return rows([]);
    }
    if (!this.tableExists) throw new Error('FakeStorage: no such table: batch');
    if (q === 'INSERT OR REPLACE INTO batch (first_tick, frames) VALUES (?, ?)') {
      const [firstTick, frames] = b;
      if (b.length !== 2 || typeof firstTick !== 'number' || !Number.isInteger(firstTick) || typeof frames !== 'string') {
        throw new Error(`FakeStorage: bad bindings for batch insert: ${JSON.stringify(b)}`);
      }
      this.rowsWritten++;
      this.batches.set(firstTick, frames);
      return rows([]);
    }
    const ordered = (): Record<string, unknown>[] =>
      [...this.batches.entries()].sort(([a], [c]) => a - c).map(([first_tick, frames]) => ({ first_tick, frames }));
    if (q === 'SELECT first_tick, frames FROM batch ORDER BY first_tick') return rows(ordered());
    if (q === LOG_FROM_SQL) {
      const [after] = b;
      if (b.length !== 1 || typeof after !== 'number' || !Number.isInteger(after)) {
        throw new Error(`FakeStorage: bad bindings for windowed log read: ${JSON.stringify(b)}`);
      }
      return rows(ordered().filter((r) => (r.first_tick as number) > after));
    }
    if (q === 'SELECT first_tick, frames FROM batch ORDER BY first_tick DESC LIMIT 1') return rows(ordered().slice(-1));
    throw new Error(`FakeStorage: unsupported SQL: ${q}`);
  }
}

export class FakeSocket {
  readonly sent: string[] = [];
  /** Set by the first `close()`, from either end. */
  closed: { code?: number; reason?: string } | null = null;
  /** Set once the close event has been delivered: only then does the socket leave `getWebSockets()`. */
  disconnected = false;
  /** Sends the room attempted after this socket was closed (each one threw, as workerd's does). */
  sendsAfterClose = 0;
  private attachment: unknown = null;
  private readonly listeners: ((text: string) => void)[] = [];

  send(text: string): void {
    if (this.closed) {
      this.sendsAfterClose++;
      throw new Error('send on a closed socket');
    }
    this.sent.push(text);
    for (const l of this.listeners) l(text);
  }
  close(code?: number, reason?: string): void {
    if (this.closed === null) this.closed = { code, reason };
  }
  serializeAttachment(value: unknown): void {
    this.attachment = structuredClone(value);
  }
  deserializeAttachment(): unknown {
    return structuredClone(this.attachment);
  }
  /** Called with every text the room sends this socket (for wiring a client). */
  onSend(fn: (text: string) => void): void {
    this.listeners.push(fn);
  }
  /** Everything sent so far, parsed. */
  messages(): unknown[] {
    return this.sent.map((t) => JSON.parse(t) as unknown);
  }
  asSocket(): HibernatingSocket {
    return this as unknown as HibernatingSocket;
  }
}

export class FakeState implements DurableStateLike {
  readonly storage = new FakeStorage();
  private readonly sockets: FakeSocket[] = [];

  acceptWebSocket(ws: WebSocket): void {
    this.sockets.push(ws as unknown as FakeSocket);
  }
  getWebSockets(): WebSocket[] {
    return this.sockets.filter((s) => !s.disconnected) as unknown as WebSocket[];
  }
  /** test-only: a deploy or reset. These sockets are gone from the runtime and
   *  no close event is ever delivered for them (the object that would have
   *  received it is the one being replaced); unlike an eviction, which keeps
   *  hibernated sockets listed. */
  vanish(...sockets: FakeSocket[]): void {
    for (const s of sockets) s.disconnected = true;
  }
}

/** The runtime's half of a close, from either end: the socket is closed (if
 *  the client is the one closing), the room's `webSocketClose` runs, and only
 *  then does the socket leave `getWebSockets()`. */
export async function deliverClose(
  room: { webSocketClose(ws: WebSocket): Promise<void> }, ws: FakeSocket, code = 1000, reason = 'closed',
): Promise<void> {
  ws.close(code, reason);
  await room.webSocketClose(ws.asSocket() as WebSocket);
  ws.disconnected = true;
}

/** The runtime's error event for a socket. It does NOT remove the socket:
 *  workerd may follow an error with a close for the same socket, which a
 *  test delivers with `deliverClose`. */
export async function deliverError(room: { webSocketError(ws: WebSocket): Promise<void> }, ws: FakeSocket): Promise<void> {
  await room.webSocketError(ws.asSocket() as WebSocket);
}

/** test-only: the runtime's alarm event. The scheduled time is consumed as
 *  the handler runs, as workerd's is: a handler that wants another sets it again. */
export async function deliverAlarm(room: { alarm(): Promise<void> }, storage: FakeStorage): Promise<void> {
  storage.alarmAt = null;
  await room.alarm();
}

/** A fresh socket, accepted by the room exactly as `/ws` accepts one. */
export function openSocket(room: { acceptSocket(ws: HibernatingSocket): void }): FakeSocket {
  const ws = new FakeSocket();
  room.acceptSocket(ws.asSocket());
  return ws;
}
