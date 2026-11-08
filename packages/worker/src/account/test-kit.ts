/** Test harness for the accounts routes (GH-1075). Tests only: nothing in the Worker imports this file. */
import { fileURLToPath } from 'node:url';
import type { D1Like, D1Stmt, Env, RateLimiter } from '../d1';
import { openTestD1 } from '../test-d1';
import { memoryKV } from './kv';
import { handleAccount, type AccountDeps } from './routes';

export const ACCOUNTS_MIGRATIONS = fileURLToPath(new URL('../../migrations-accounts/', import.meta.url));

/** The Worker's own origin, which `call` sends by default. */
export const TEST_ORIGIN = 'https://roaring-lions.pint12.workers.dev';

/** `Env` with the accounts bindings the harness always supplies. */
export type AccountTestEnv = Env & Required<Pick<Env, 'ACCOUNTS' | 'ACCOUNT_TOMBSTONES' | 'ACCOUNT_LIMIT' | 'ACCOUNT_OP_LIMIT'>>;

export interface CallInit {
  body?: unknown;
  cookie?: string;
  headers?: Record<string, string>;
  /** Default: the Worker's own origin. `null` sends none. */
  origin?: string | null;
}

export interface AccountHarnessOpts {
  foreignKeys?: boolean;
  failPut?: boolean;
  /** A limiter that rejects every call, by binding name. */
  denyLimiter?: ('ACCOUNT_LIMIT' | 'ACCOUNT_OP_LIMIT')[];
  /** The dispatcher under test; default `handleAccount`. */
  handler?: (req: Request, env: AccountTestEnv, now: number) => Promise<Response>;
  now?: number;
  /** The outbound calls the handler may make; default the real fetch. */
  deps?: AccountDeps;
}

const limiter = (ok: boolean): RateLimiter => ({ limit: async () => ({ success: ok }) });

export function accountHarness(opts: AccountHarnessOpts = {}) {
  const db = openTestD1({ dir: ACCOUNTS_MIGRATIONS, foreignKeys: opts.foreignKeys });
  const kv = memoryKV({ failPut: opts.failPut });
  const deny = new Set(opts.denyLimiter ?? []);
  const env: AccountTestEnv = {
    DB: openTestD1(),
    ASSETS: { fetch: async () => new Response('not found', { status: 404 }) },
    ACCOUNTS: db,
    ACCOUNT_TOMBSTONES: kv,
    ACCOUNT_LIMIT: limiter(!deny.has('ACCOUNT_LIMIT')),
    ACCOUNT_OP_LIMIT: limiter(!deny.has('ACCOUNT_OP_LIMIT')),
  };
  const handler = opts.handler ?? ((req, e, now) => handleAccount(req, e, now, opts.deps));
  const call = (method: string, path: string, init: CallInit = {}): Promise<Response> => {
    const headers = new Headers({ 'x-rl-account': '1', 'content-type': 'application/json' });
    const origin = init.origin === undefined ? TEST_ORIGIN : init.origin;
    if (origin !== null) headers.set('origin', origin);
    if (init.cookie !== undefined) headers.set('cookie', init.cookie);
    for (const [k, v] of Object.entries(init.headers ?? {})) headers.set(k, v);
    const hasBody = init.body !== undefined && method !== 'GET' && method !== 'HEAD';
    const req = new Request(TEST_ORIGIN + path, {
      method,
      headers,
      body: hasBody ? JSON.stringify(init.body) : undefined,
    });
    return handler(req, env, opts.now ?? Date.now());
  };
  return { db, kv, env, call };
}

/** A stand-in for Steam's OpenID endpoint: records every call, answers `check_authentication`. */
export function steamStub(opts: { valid?: boolean; down?: boolean; status?: number } = {}): AccountDeps & { calls: { url: string; body: string }[] } {
  const calls: { url: string; body: string }[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, body: String(init.body ?? '') });
      if (opts.down === true) throw new Error('steam is down');
      return new Response(`ns:http://specs.openid.net/auth/2.0\nis_valid:${opts.valid === false ? 'false' : 'true'}\n`, { status: opts.status ?? 200 });
    },
  };
}


/** A D1 whose `batch()` that carries an `account_op` insert waits until `n` lookups of `account_op` have run, so `n`
 *  requests with one op id all miss the lookup before any of them writes. Tests only. */
export function racingD1<T extends D1Like>(db: T, n: number): T {
  let lookups = 0;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => { release = r; });
  const sqlOf = new WeakMap<D1Stmt, string>();
  const wrap = (s: D1Stmt, sql: string): D1Stmt => {
    const out: D1Stmt = {
      bind: (...v) => wrap(s.bind(...v), sql),
      run: () => s.run(),
      all: <R>() => s.all<R>(),
      first: async <R>() => {
        const row = await s.first<R>();
        if (/FROM account_op/.test(sql)) {
          lookups++;
          if (lookups >= n) release();
        }
        return row;
      },
    };
    sqlOf.set(out, sql);
    return out;
  };
  return {
    ...db,
    prepare: (sql: string) => wrap(db.prepare(sql), sql),
    batch: async (ss: D1Stmt[]) => {
      if (ss.some((s) => /INSERT INTO account_op/.test(sqlOf.get(s) ?? ''))) await gate;
      return db.batch(ss);
    },
  };
}
