/**
 * Who sees the feedback entry points, and when a note actually leaves the
 * machine (GH-464). The ONE place both are decided: the pause tab, the debrief
 * prompt and the menu link all ask `feedbackShown`, and the client asks
 * `feedbackSends` -- so turning feedback off is one constant here.
 *
 * The lead's v1 ruling (2026-10-08): **everyone** on a production build, not
 * testers only, to be removed in a later version. `FEEDBACK_FOR_EVERYONE`
 * is that ruling. Set it `false` and the spec's original gate comes back: a
 * tester label (`?tester=`, persisted by telemetry) or `?feedback` only.
 *
 * Sending is airtight on the same terms as telemetry's `telemetryEnabled`: a
 * production build on a real host, never `pnpm dev`, a test, CI or any local
 * origin (`pnpm ui:routes` fails on any console error, and a POST to a
 * missing route on the Vite server is one). Elsewhere the UI may still show
 * -- under `?feedback` -- and a send is a dry run that says so.
 *
 * The server has its own kill switch (410 `closed`; a 403 is read the same
 * way): once seen, `markClosed()` holds for the rest of the session and the
 * form shows a calm "closed right now" state rather than an error.
 */
import { TESTER_PATTERN } from '@lions/data/telemetry';
import { TESTER_KEY, safeStorage, type StorageLike } from '../telemetry/identity';

/** v1 (lead, 2026-10-08): every player on a production build. */
export const FEEDBACK_FOR_EVERYONE = true;

/** `?feedback` once, and the entry points stay on in this browser. */
export const FEEDBACK_FLAG_KEY = 'lions.feedback.on';

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\]|.*\.local|.*\.localhost|.*\.test)$/;

export interface FeedbackEnv {
  prod: boolean;
  hostname: string;
  query: URLSearchParams;
  storage: StorageLike | null;
}

/** A production build on a host that is not this machine. */
export function feedbackSends(env: Pick<FeedbackEnv, 'prod' | 'hostname'>): boolean {
  return env.prod && !LOCAL.test(env.hostname);
}

/** Reads, and persists, `?feedback`. */
function flagged(env: FeedbackEnv): boolean {
  if (env.query.has('feedback')) {
    env.storage?.setItem(FEEDBACK_FLAG_KEY, '1');
    return true;
  }
  return env.storage?.getItem(FEEDBACK_FLAG_KEY) === '1';
}

/** The tester label, read only -- never minted, never written here. */
export function testerLabel(env: Pick<FeedbackEnv, 'query' | 'storage'>): string | undefined {
  const asked = env.query.get('tester');
  if (asked !== null && TESTER_PATTERN.test(asked)) return asked;
  const stored = env.storage?.getItem(TESTER_KEY) ?? null;
  return stored !== null && TESTER_PATTERN.test(stored) ? stored : undefined;
}

/** Are the entry points (pause tab, debrief prompt, menu link) shown? */
export function feedbackShown(env: FeedbackEnv, everyone: boolean = FEEDBACK_FOR_EVERYONE): boolean {
  if (closed) return false;
  if (flagged(env)) return true;
  if (everyone) return feedbackSends(env);
  return testerLabel(env) !== undefined && feedbackSends(env);
}

let closed = false;
/** The server said no (410, or 403): feedback is closed for this session. */
export function markClosed(): void {
  closed = true;
}
export function isClosed(): boolean {
  return closed;
}
/** Tests only. */
export function resetClosedForTest(): void {
  closed = false;
}

/** The browser's own environment. */
export function browserFeedbackEnv(): FeedbackEnv {
  return {
    prod: import.meta.env.PROD,
    hostname: location.hostname,
    query: new URLSearchParams(location.search),
    storage: safeStorage(() => window.localStorage),
  };
}
