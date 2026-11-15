/** Test harness for the admin routes (GH-695). Tests only: nothing in the Worker imports this file. */
import { sessionCookieHeader } from '../auth';
import { SESSION_COOKIE } from '../account/config';
import type { D1Like } from '../d1';
import { createSession } from '../account/session';
import { accountHarness, type CallInit } from '../account/test-kit';
import { handleStats } from '../stats';

export const PASSWORD = 'correct horse battery staple';
export const NOW = Date.UTC(2026, 10, 14, 12);
export const EMPTY_EARN = '{"welcomed":false,"campaignDone":false,"backfilled":false,"missions":{}}';

export interface MemberSeed {
  id: string;
  publicId: string;
  name: string;
  free?: number;
  walletRevision?: number;
  createdAt?: number;
  lastSeenDay?: number;
  /** A BrigadeAccount JSON object; null or absent: no campaign_state row. */
  brigade?: Record<string, unknown> | null;
  campaignRevision?: number;
  identities?: [provider: string, subject: string][];
}

export async function addMember(db: D1Like, s: MemberSeed): Promise<void> {
  const run = (sql: string, ...v: unknown[]) => db.prepare(sql).bind(...v).run();
  await run('INSERT INTO member (id, public_id, id_hash, user_handle, created_at, last_seen_day) VALUES (?1, ?2, ?3, ?4, ?5, ?6)', s.id, s.publicId, `hash-${s.id}`, `uh-${s.id}`, s.createdAt ?? NOW - 5 * 86_400_000, s.lastSeenDay ?? Math.floor(NOW / 86_400_000));
  await run('INSERT INTO profile (member_id, display_name, show_record, updated_at) VALUES (?1, ?2, 0, ?3)', s.id, s.name, NOW);
  await run(
    "INSERT INTO wallet (member_id, free, earn, earn_lifetime, entitlements, revision, updated_at) VALUES (?1, ?2, ?3, ?3, '{\"units\":{},\"upgrades\":{}}', ?4, ?5)",
    s.id, s.free ?? 0, EMPTY_EARN, s.walletRevision ?? 0, NOW - 1000,
  );
  if ((s.free ?? 0) > 0) {
    await run("INSERT INTO coin_journal (member_id, at, kind, free_delta, detail, op_id) VALUES (?1, ?2, 'claim', ?3, '{}', ?4)", s.id, NOW - 1000, s.free, `seed-${s.id}`);
  }
  if (s.brigade !== undefined && s.brigade !== null) {
    const text = JSON.stringify(s.brigade);
    await run("INSERT INTO campaign_state (member_id, ledger, brigade, bytes, revision, updated_at) VALUES (?1, '{}', ?2, ?3, ?4, ?5)", s.id, text, text.length, s.campaignRevision ?? 0, NOW - 60_000);
  }
  for (const [i, [provider, subject]] of (s.identities ?? []).entries()) {
    await run("INSERT INTO member_identity (id, member_id, provider, subject, created_at) VALUES (?1, ?2, ?3, ?4, 1)", `${s.id}-i${i}`, s.id, provider, subject);
  }
}

/** The cookie of a fresh game session for `memberId`. */
export async function gameCookie(db: D1Like, memberId: string, now: number = NOW): Promise<string> {
  const s = await createSession(db, memberId, now);
  await db.batch(s.statements);
  return `${SESSION_COOKIE}=${s.token}`;
}

export interface AdminCallInit extends CallInit {
  /** Send the /stats password session cookie (default true). */
  stats?: boolean;
  /** A game session cookie to send with it. */
  game?: string;
  /** Send `x-rl-admin: 1` (default true). */
  header?: boolean;
}

/** A harness whose handler is `handleStats` with the password set, and a `call` that composes the two cookies. */
export function adminKit(opts: { noDb?: boolean } = {}) {
  const h = accountHarness({ foreignKeys: true, now: NOW, handler: (req, env, now) => handleStats(req, { ...env, STATS_PASSWORD: PASSWORD, ...(opts.noDb === true ? { DB: undefined as never } : {}) }, now) });
  let statsCookie: string | null = null;
  const call = async (method: string, path: string, init: AdminCallInit = {}): Promise<Response> => {
    statsCookie ??= (await sessionCookieHeader(PASSWORD, NOW)).split(';')[0] ?? '';
    const parts = [init.stats === false ? '' : statsCookie, init.game ?? ''].filter((x) => x !== '');
    const headers = { ...(init.header === false ? {} : { 'x-rl-admin': '1' }), ...(init.headers ?? {}) };
    return h.call(method, path, { ...init, headers, cookie: parts.length > 0 ? parts.join('; ') : undefined });
  };
  return { h, db: h.db, env: h.env, call };
}
