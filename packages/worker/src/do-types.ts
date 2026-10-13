/** The slice of the Durable Object API this Worker uses, hand-declared for
 *  the same reason `d1.ts` declares D1: `@cloudflare/workers-types` collides
 *  with the DOM lib the root typecheck runs under. */
export interface SqlRows { toArray(): Record<string, unknown>[] }
export interface DurableStorageLike {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  sql: { exec(query: string, ...bindings: unknown[]): SqlRows };
  /** The object's one alarm: `alarm()` runs at (or after) this epoch-ms time,
   *  even if the object was evicted in between. Setting replaces any earlier one. */
  setAlarm(scheduledTime: number): Promise<void>;
  getAlarm(): Promise<number | null>;
  deleteAlarm(): Promise<void>;
  /** Every key and every SQL table this object holds (#559 H-1: an ended room is wiped). */
  deleteAll(): Promise<void>;
}
export interface DurableStateLike {
  storage: DurableStorageLike;
  acceptWebSocket(ws: WebSocket, tags?: string[]): void;
  getWebSockets(tag?: string): WebSocket[];
}
/** A socket accepted through the Hibernation API: its attachment survives
 *  the object being evicted, which is where a socket's seat lives. */
export interface HibernatingSocket extends WebSocket {
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}
export type SocketPair = { 0: WebSocket; 1: WebSocket };
declare global {
  var WebSocketPair: { new (): SocketPair };
}
/** Workers' `Response` takes the client end of a pair on a 101. */
export type UpgradeInit = ResponseInit & { webSocket?: WebSocket };
