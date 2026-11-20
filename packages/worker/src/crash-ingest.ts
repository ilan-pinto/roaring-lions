/**
 * POST /api/crash (GH-1414): a crash report from the packaged desktop build.
 *
 * A PUBLIC write endpoint, built like /api/feedback (GH-464): capped, origin-checked, rate-limited, behind a kill
 * switch, strict about its body, and it stores no IP. The sender is the desktop build's MAIN process
 * (`tools/desktop/crash.mjs`, `main.mjs`), never a page, and the body is `data/schemas/crash_report.schema.json`
 * (`crash-meta.ts` is the twin). Answers:
 *   204                              stored
 *   400 {"error":"<reason>"}         not JSON, or not a crash report
 *   403 {"error":"origin"}           no Origin, or not one of: the desktop build's, this Worker's own, ALLOWED_ORIGINS
 *   405                              any method but POST
 *   410 {"error":"closed"}           the kill switch (closed unless flags.crash reads 'open'; env CRASH_CLOSED closes it)
 *   413 {"error":"too large"}        over CRASH_BODY_MAX_BYTES, declared or actual
 *   415 {"error":"not json"}         a content type other than application/json
 *   429 {"retryAfter":<seconds>}     a rate limit: per IP a minute (binding), per IP, per launch, or all reports, a day
 *   503 {"error":"storage"}          D1 failed (the migration is not applied, for one); nothing is left behind
 *
 * CLOSED BY DEFAULT, unlike feedback: a missing `crash` row means closed, so the endpoint stores nothing until the lead
 * has applied migration 0008 and opened the flag (see that file). The client drops a report on 410 and keeps it for
 * the next launch on 429 and 503.
 *
 * Order matters and each step is cheaper than the next: method, switch, origin, the per-minute IP limit, declared size,
 * content type, a size-capped read, parse and validate, the D1-counted day limits, then one batch that inserts the row
 * and deletes up to CRASH_PURGE_PER_INSERT rows past retention. The day limits count a keyed hash of the address
 * (`rate-day.ts`): the address itself is never stored, and neither is anything else of the request.
 */
import type { Env } from './d1';
import { DAY_MS, bump, ipKey, ipSecret } from './rate-day';
import { originAllowed } from './origin';
import { readCapped } from './read-capped';
import { CRASH_BODY_MAX_BYTES, crashReportProblem, type CrashReport } from './crash-meta';

/** The packaged desktop build's page origin (`tools/desktop/policy.mjs` ORIGIN; `desktop_crash.test.ts` pins the two).
 *  The main process sends it as the request's Origin. A browser page on any other site cannot claim it, which is all an
 *  Origin check is for; a script that forges it meets the limits below like anyone else. */
export const DESKTOP_ORIGIN = 'app://roaring-lions.local';

export const CRASH_IP_LIMIT_RETRY_SECONDS = 60;
/** The day limits, counted in `rate_day`. A launch is one run of the game (the client's own cap is 6, so 10 leaves room
 *  for the outbox's retries); an address covers a few machines behind one; `all` bounds what a flood can add to D1
 *  whatever ids it invents (90 days at 200 a day at 6 KB is about 100 MB at worst). */
export const CRASH_DAY_LIMITS = { launch: 10, ip: 20, all: 200 } as const;
/** How long a row is kept, and how many expired rows each insert deletes (more than one insert a day ever adds). */
export const CRASH_RETENTION_MS = 90 * DAY_MS;
export const CRASH_PURGE_PER_INSERT = 25;

const NO_STORE = { 'cache-control': 'no-store' } as const;
const reply = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...NO_STORE } });
const STORAGE = (): Response => reply(503, { error: 'storage' });
const TOO_LARGE = (): Response => reply(413, { error: 'too large' });
const untilTomorrow = (now: number): number => Math.max(1, Math.ceil((DAY_MS - (now % DAY_MS)) / 1000));

/** The kill switch. The env half is read first and needs no database; the D1 half must read exactly 'open'. */
export async function crashOpen(env: Env): Promise<boolean> {
  const v = (env.CRASH_CLOSED ?? '').trim().toLowerCase();
  if (v !== '' && v !== '0' && v !== 'false') return false;
  const row = await env.DB.prepare(`SELECT value FROM flags WHERE name = 'crash'`).first<{ value: string }>();
  return row?.value === 'open';
}

/** The strict Origin rule, with the desktop build's origin added to `origin.ts`'s. */
export function crashOriginAllowed(req: Request, env: Env): boolean {
  return req.headers.get('origin') === DESKTOP_ORIGIN || originAllowed(req, env);
}

export async function handleCrash(req: Request, env: Env, now: number): Promise<Response> {
  if (req.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST', ...NO_STORE } });
  let open: boolean;
  try {
    open = await crashOpen(env);
  } catch {
    return STORAGE();
  }
  if (!open) return reply(410, { error: 'closed' });
  if (!crashOriginAllowed(req, env)) return reply(403, { error: 'origin' });

  const ip = req.headers.get('cf-connecting-ip');
  if (env.CRASH_LIMIT && ip) {
    const { success } = await env.CRASH_LIMIT.limit({ key: ip }); // in memory in the binding, never stored
    if (!success) return reply(429, { retryAfter: CRASH_IP_LIMIT_RETRY_SECONDS });
  }

  const declared = req.headers.get('content-length');
  if (declared !== null && Number(declared) > CRASH_BODY_MAX_BYTES) return TOO_LARGE();
  if (!/^application\/json(\s*;|$)/i.test(req.headers.get('content-type') ?? '')) return reply(415, { error: 'not json' });
  const body = await readCapped(req, CRASH_BODY_MAX_BYTES);
  if (body === null) return TOO_LARGE();
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
  } catch {
    return reply(400, { error: 'not JSON' });
  }
  const problem = crashReportProblem(parsed);
  if (problem !== null) return reply(400, { error: problem });
  const r = parsed as CrashReport;

  try {
    const L = CRASH_DAY_LIMITS;
    if (!(await bump(env.DB, 'crash-launch', r.launch, now, L.launch))) return reply(429, { retryAfter: untilTomorrow(now) });
    const secret = ipSecret(env);
    if (ip && secret && !(await bump(env.DB, 'crash-ip', await ipKey(secret, ip, now), now, L.ip))) {
      return reply(429, { retryAfter: untilTomorrow(now) });
    }
    if (!(await bump(env.DB, 'crash-all', '', now, L.all))) return reply(429, { retryAfter: untilTomorrow(now) });
  } catch {
    return STORAGE();
  }

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO crash_report (received_at, t, kind, launch, uptime_s, version, "commit", electron, chrome, platform, arch, gpu,
           screen, mission, reason, exit_code, process, service, name, message, stack)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        now, r.t, r.kind, r.launch, r.uptimeS, r.version, r.commit ?? null, r.electron, r.chrome ?? null, r.platform, r.arch, r.gpu,
        r.screen ?? null, r.mission ?? null, r.reason ?? null, r.exitCode ?? null, r.process ?? null, r.service ?? null,
        r.name ?? null, r.message ?? null, r.stack === undefined ? null : JSON.stringify(r.stack)
      ),
      env.DB.prepare(
        'DELETE FROM crash_report WHERE id IN (SELECT id FROM crash_report WHERE received_at < ? ORDER BY received_at LIMIT ?)'
      ).bind(now - CRASH_RETENTION_MS, CRASH_PURGE_PER_INSERT),
    ]);
  } catch {
    return STORAGE();
  }
  return new Response(null, { status: 204, headers: NO_STORE });
}

/** What /stats shows: the newest reports, each with its stack, and a count by kind, version and GPU family. */
export const CRASH_LIST_MAX = 50;

export interface CrashRow {
  id: number;
  received_at: number;
  kind: string;
  version: string;
  commit: string | null;
  electron: string;
  platform: string;
  arch: string;
  gpu: string;
  screen: string | null;
  mission: string | null;
  reason: string | null;
  exit_code: number | null;
  process: string | null;
  service: string | null;
  name: string | null;
  message: string | null;
  stack: string[];
  uptime_s: number;
}

export async function crashSummary(env: Env, since: number) {
  const rows = await env.DB.prepare(
    `SELECT id, received_at, kind, version, "commit", electron, platform, arch, gpu, screen, mission, reason, exit_code, process, service,
            name, message, stack, uptime_s
     FROM crash_report WHERE received_at >= ? ORDER BY received_at DESC LIMIT ?`
  )
    .bind(since, CRASH_LIST_MAX)
    .all<Omit<CrashRow, 'stack'> & { stack: string | null }>();
  const groups = await env.DB.prepare(
    `SELECT kind, version, gpu, COUNT(*) AS n, COUNT(DISTINCT launch) AS launches
     FROM crash_report WHERE received_at >= ? GROUP BY kind, version, gpu ORDER BY n DESC LIMIT 30`
  )
    .bind(since)
    .all<{ kind: string; version: string; gpu: string; n: number; launches: number }>();
  const stack = (s: string | null): string[] => {
    if (s === null) return [];
    try {
      const x = JSON.parse(s) as unknown;
      return Array.isArray(x) ? x.filter((f): f is string => typeof f === 'string') : [];
    } catch {
      return [];
    }
  };
  return { latest: rows.results.map((r) => ({ ...r, stack: stack(r.stack) })), groups: groups.results };
}
