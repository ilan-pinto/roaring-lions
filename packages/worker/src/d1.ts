import type { KVLike } from './account/kv';

/** The slice of Cloudflare's D1 API this Worker uses. Declared here rather than
 *  imported from @cloudflare/workers-types: those redeclare Request/Response and
 *  collide with the DOM lib the repo's root typecheck runs under. */
export interface D1Stmt {
  bind(...values: unknown[]): D1Stmt;
  run(): Promise<unknown>;
  all<T>(): Promise<{ results: T[] }>;
  first<T>(): Promise<T | null>;
}
export interface D1Like {
  prepare(sql: string): D1Stmt;
  batch(statements: D1Stmt[]): Promise<unknown[]>;
}
export interface RateLimiter {
  limit(o: { key: string }): Promise<{ success: boolean }>;
}
export interface DurableObjectStubLike { fetch(request: Request): Promise<Response> }
export interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStubLike;
}
export interface Env {
  /** GH-954 P3: any value but empty, `0` or `false` makes /arena-results and /arena-results.json answer 404, no deploy. */
  ARENA_RESULTS_HIDDEN?: string;
  DB: D1Like;
  ASSETS: { fetch(request: Request): Promise<Response> };
  INGEST_LIMIT?: RateLimiter;
  /** Comma-separated extra origins allowed to POST (e.g. a custom domain). */
  ALLOWED_ORIGINS?: string;
  /** Rate limit on POST /stats/login, keyed on the connecting IP. */
  LOGIN_LIMIT?: RateLimiter;
  /** The /stats password, set as a Worker secret. Unset or empty fails closed:
   *  every /stats* path answers 403. */
  STATS_PASSWORD?: string;
  /** GH-464: POST /api/feedback, keyed on the connecting IP (5 a minute). */
  FEEDBACK_LIMIT?: RateLimiter;
  /** GH-464 kill switch, the deploy-free half: any non-empty value other than
   *  "0"/"false" closes feedback. Set with `npx wrangler secret put
   *  FEEDBACK_CLOSED` (a secret survives deploys; a dashboard var does not).
   *  The other half is the D1 `flags` row, flipped from /stats/feedback. */
  FEEDBACK_CLOSED?: string;
  /** N0: the MatchRoom Durable Object namespace (wrangler.jsonc `durable_objects`). */
  ROOMS?: DurableObjectNamespaceLike;
  /** N0: room creation and joins, keyed on the connecting IP (6 a minute). */
  ROOM_LIMIT?: RateLimiter;
  /** #559 M-1: socket upgrades, keyed on the connecting IP (60 a minute):
   *  its own limiter, so a reconnect once a second never trips ROOM_LIMIT. */
  WS_LIMIT?: RateLimiter;
  /** Snapshot S3, Ruling 12: POST and GET of a room's snapshot, keyed on the
   *  connecting IP (12 a minute). Its own limiter, so ROOM_LIMIT's six is not spent on it. */
  SNAP_LIMIT?: RateLimiter;
  /** N0: signs seat tickets. Its own secret, never STATS_PASSWORD. Unset fails
   *  closed: every /api/match path answers 503. */
  TICKET_SECRET?: string;
  /** GH-954 W1: "1" lets `POST /api/match/:code/watch` mint a spectator ticket. Set ONLY by the local
   *  relay (`tools/src/net/local-relay.ts`), never in `wrangler.jsonc` and never as a secret: without it the
   *  route answers 404 and the Worker cannot be watched. */
  ARENA_WATCH?: string;
  /** GH-1075 A1: the accounts database. Unbound answers 503 on every /api/account/* path. */
  ACCOUNTS?: D1Like;
  /** GH-1075: deletion tombstones (90 days). */
  ACCOUNT_TOMBSTONES?: KVLike;
  /** GH-1075: 10 a minute per IP. */
  ACCOUNT_LIMIT?: RateLimiter;
  /** GH-1075: 60 a minute per IP, for the cheap ops. */
  ACCOUNT_OP_LIMIT?: RateLimiter;
  /** GH-1075: comma-separated extra origins for WebAuthn client data and the Steam realm. A local relay needs this and ALLOWED_ORIGINS both set. */
  ACCOUNT_ORIGINS?: string;
  /** GH-1075 G3: Google OAuth client id, a Worker secret. Unset (or empty) with the secret below: `google/start` answers 503 `provider_off`. */
  GOOGLE_CLIENT_ID?: string;
  /** GH-1075 G3: Google OAuth client secret, a Worker secret. Never logged, never in a response. */
  GOOGLE_CLIENT_SECRET?: string;
}
