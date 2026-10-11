/**
 * In-memory stand-ins for the Durable Object runtime, so `MatchRoom` runs
 * under node (R19): a storage with a key-value half and exactly the SQL
 * `MatchRoom` issues, a state that accepts and lists hibernating sockets, and
 * a socket that logs what it was sent. Not a test file, so other specs (the
 * room-loop test) can import it; nothing the Worker ships imports it.
 *
 * Fidelity worth knowing: values are structured-cloned on the way in and out,
 * as the real storage serialises them, so a test that reads storage sees what
 * was PERSISTED rather than the room's live object. A closed socket drops out
 * of `getWebSockets()`; a socket the room is still holding stays in it.
 */
import type { DurableStateLike, DurableStorageLike, HibernatingSocket, SqlRows } from '../do-types';

const rows = (r: Record<string, unknown>[]): SqlRows => ({ toArray: () => r });
const norm = (q: string): string => q.replace(/\s+/g, ' ').trim();

export class FakeStorage implements DurableStorageLike {
  readonly kv = new Map<string, unknown>();
  /** The `frame` table: tick -> cmds JSON. */
  readonly frames = new Map<number, string>();
  private tableExists = false;

  async get<T>(key: string): Promise<T | undefined> {
    const v = this.kv.get(key);
    return v === undefined ? undefined : (structuredClone(v) as T);
  }
  async put<T>(key: string, value: T): Promise<void> {
    this.kv.set(key, structuredClone(value));
  }
  readonly sql = {
    exec: (query: string, ...bindings: unknown[]): SqlRows => this.exec(norm(query), bindings),
  };

  private exec(q: string, b: unknown[]): SqlRows {
    if (q === 'CREATE TABLE IF NOT EXISTS frame (tick INTEGER PRIMARY KEY, cmds TEXT NOT NULL)') {
      this.tableExists = true;
      return rows([]);
    }
    if (!this.tableExists) throw new Error('FakeStorage: no such table: frame');
    if (q === 'INSERT OR REPLACE INTO frame (tick, cmds) VALUES (?, ?)') {
      const [tick, cmds] = b;
      if (b.length !== 2 || typeof tick !== 'number' || !Number.isInteger(tick) || typeof cmds !== 'string') {
        throw new Error(`FakeStorage: bad bindings for frame insert: ${JSON.stringify(b)}`);
      }
      this.frames.set(tick, cmds);
      return rows([]);
    }
    if (q === 'SELECT tick, cmds FROM frame ORDER BY tick') {
      return rows([...this.frames.entries()].sort(([a], [c]) => a - c).map(([tick, cmds]) => ({ tick, cmds })));
    }
    throw new Error(`FakeStorage: unsupported SQL: ${q}`);
  }
}

export class FakeSocket {
  readonly sent: string[] = [];
  closed: { code?: number; reason?: string } | null = null;
  private attachment: unknown = null;
  private readonly listeners: ((text: string) => void)[] = [];

  send(text: string): void {
    if (this.closed) throw new Error('send on a closed socket');
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
    return this.sockets.filter((s) => s.closed === null) as unknown as WebSocket[];
  }
}

/** A fresh socket, accepted by the room exactly as `/ws` accepts one. */
export function openSocket(room: { acceptSocket(ws: HibernatingSocket): void }): FakeSocket {
  const ws = new FakeSocket();
  room.acceptSocket(ws.asSocket());
  return ws;
}
