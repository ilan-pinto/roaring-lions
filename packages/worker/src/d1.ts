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
/** The slice of Cloudflare's R2 API the feedback endpoint uses (GH-464). */
export interface R2ObjectLike {
  size: number;
  httpMetadata?: { contentType?: string };
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}
export interface R2Like {
  put(key: string, value: ArrayBuffer | Uint8Array | string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<R2ObjectLike | null>;
  head(key: string): Promise<{ size: number } | null>;
  delete(keys: string | string[]): Promise<void>;
}
export interface Env {
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
  /** GH-464: the picture and replay store (bucket `roaring-lions-feedback`). */
  FEEDBACK_BLOBS?: R2Like;
  /** GH-464: POST /api/feedback, keyed on the connecting IP (5 a minute). */
  FEEDBACK_LIMIT?: RateLimiter;
  /** GH-464 kill switch, the deploy-free half: any non-empty value other than
   *  "0"/"false" closes feedback. Set with `npx wrangler secret put
   *  FEEDBACK_CLOSED` (a secret survives deploys; a dashboard var does not).
   *  The other half is the D1 `flags` row, flipped from /stats/feedback. */
  FEEDBACK_CLOSED?: string;
}
