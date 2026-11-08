/** Test harness for the accounts routes (GH-1075). Tests only: nothing in the Worker imports this file. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { D1Like, D1Stmt, Env, RateLimiter } from '../d1';
import { openTestD1 } from '../test-d1';
import { memoryKV } from './kv';
import { handleAccount, type AccountDeps } from './routes';
import { createSession } from './session';
import { SESSION_COOKIE } from './config';
import { sha256Hex } from './crypto';

export const ACCOUNTS_MIGRATIONS = fileURLToPath(new URL('../../migrations-accounts/', import.meta.url));

/** The Worker's own origin, which `call` sends by default. */
export const TEST_ORIGIN = 'https://roaring-lions.pint12.workers.dev';

/** `Env` with the accounts bindings the harness always supplies. */
export type AccountTestEnv = Env & Required<Pick<Env, 'ACCOUNTS' | 'ACCOUNT_TOMBSTONES' | 'ACCOUNT_LIMIT' | 'ACCOUNT_OP_LIMIT'>>;

export interface CallInit {
  body?: unknown;
  /** Sent as is, instead of `body` (a malformed-JSON case). */
  rawBody?: string;
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
      body: init.rawBody ?? (hasBody ? JSON.stringify(init.body) : undefined),
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

/** Every table whose CREATE body declares a member_id column, plus `member`, read from the migration itself
 *  (an oracle that does not import MEMBER_TABLES). */
export function memberTablesInMigration(): Set<string> {
  const sql = readFileSync(ACCOUNTS_MIGRATIONS + '0001_members.sql', 'utf8');
  const out = new Set<string>(['member']);
  // A statement runs to its semicolon; comments are stripped first so a `;` in prose cannot cut one short.
  const bare = sql.replace(/--.*$/gm, '');
  for (const m of bare.matchAll(/CREATE TABLE (\w+)\s*\(([^;]*);/g)) {
    if (/(^|[(,])\s*member_id\s+\w/.test(m[2] ?? '')) out.add(m[1] ?? '');
  }
  return out;
}

export const SEED_PUBLIC_ID = 'K7Q2ABCD';
export const SEED_EARN = 'fixture-earn-string';

/** Member `m1` with a row in EVERY member table, a second member `n1`, a match shared with `n1` and one of M's alone.
 *  Returns M's session cookie (fresh at `now`). */
export async function seedFullMember(db: D1Like, now: number): Promise<{ memberId: string; idHash: string; cookie: string }> {
  const idHash = await sha256Hex(SEED_PUBLIC_ID);
  const run = (sql: string, ...v: unknown[]) => db.prepare(sql).bind(...v).run();
  await run('INSERT INTO member VALUES (?1, ?2, ?3, ?4, ?5, ?6)', 'm1', SEED_PUBLIC_ID, idHash, 'uh1', now, 0);
  await run('INSERT INTO member VALUES (?1, ?2, ?3, ?4, ?5, ?6)', 'n1', 'NNNN2222', await sha256Hex('NNNN2222'), 'uh2', now, 0);
  await run("INSERT INTO member_identity (id, member_id, provider, subject, created_at) VALUES ('i1','m1','steam','76561197960287930',?1)", now);
  await run("INSERT INTO member_identity (id, member_id, provider, subject, created_at, public_key, sign_count) VALUES ('i2','m1','passkey','cred-1',?1, x'0A0B0C0D', 3)", now);
  await run("INSERT INTO member_identity (id, member_id, provider, subject, state, created_at) VALUES ('i3','m1','recovery','code-hash','pending',?1)", now);
  await run("INSERT INTO member_identity (id, member_id, provider, subject, created_at) VALUES ('i4','n1','steam','76561197960287931',?1)", now);
  await run("INSERT INTO profile VALUES ('m1','Callsign One',1,?1)", now);
  await run("INSERT INTO profile VALUES ('n1','Callsign Two',0,?1)", now);
  await run("INSERT INTO wallet (member_id, free, earn, earn_lifetime, entitlements, updated_at) VALUES ('m1', 5, ?1, '{}', '{}', ?2)", SEED_EARN, now);
  await run("INSERT INTO coin_journal (member_id, at, kind, free_delta, detail, op_id) VALUES ('m1', ?1, 'earn', 5, '{}', 'o1')", now);
  await run("INSERT INTO coupon_use VALUES ('m1','c1',?1)", now);
  await run("INSERT INTO campaign_state (member_id, ledger, brigade, bytes, updated_at) VALUES ('m1','{}','{}',4,?1)", now);
  await run("INSERT INTO save_slot (member_id, slot_id, name, saved_at, build, body, bytes) VALUES ('m1','s1','Slot',?1,'b','{}',2)", now);
  await run("INSERT INTO device_claim VALUES ('m1','dev1',?1,'{}')", now);
  await run("INSERT INTO rate_day VALUES ('acct-ops', 'm1', 1, 3)");
  await run("INSERT INTO rate_day VALUES ('acct-ops', 'n1', 1, 3)");
  await run("INSERT INTO account_op VALUES ('m1','op1','profile.patch',?1,'{}')", now);
  await run("INSERT INTO auth_challenge VALUES ('chal1','steam-link','m1','pre1',?1)", now + 300_000);
  for (const code of ['SHARED', 'SOLO']) {
    await run("INSERT INTO match_record VALUES (?1, 1000, 2000, 'm', 'x', NULL, 'k', 'ended', 0, 10, 'b', 1)", code);
  }
  await run("INSERT INTO match_seat VALUES ('SHARED',1000,0,'m1','member','kdf',NULL)");
  await run("INSERT INTO match_seat VALUES ('SHARED',1000,1,'n1','member','sarim',NULL)");
  await run("INSERT INTO match_seat VALUES ('SOLO',1000,0,'m1','member','kdf',NULL)");
  await run("INSERT INTO match_seat VALUES ('SOLO',1000,1,NULL,'bot','sarim','easy')");
  const s = await createSession(db, 'm1', now);
  await db.batch(s.statements);
  return { memberId: 'm1', idHash, cookie: `${SESSION_COOKIE}=${s.token}` };
}
