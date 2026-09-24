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
export interface Env {
  DB: D1Like;
  ASSETS: { fetch(request: Request): Promise<Response> };
  INGEST_LIMIT?: RateLimiter;
  /** Comma-separated extra origins allowed to POST (e.g. a custom domain). */
  ALLOWED_ORIGINS?: string;
}
