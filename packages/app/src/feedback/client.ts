/**
 * The client half of `POST /api/feedback` (GH-464). The contract is the spec's
 * §5.2 as the Worker builds it (`packages/worker/src/feedback-ingest.ts`,
 * `data/schemas/feedback.schema.json`):
 *
 * - `multipart/form-data` with a `meta` part (JSON, <= 24 KB), an optional
 *   `shot` part (WebP or JPEG, <= 300 KB, from the pause form only) and an
 *   optional `replay` part (JSON, <= 96 KB, a Bug from the pause form only).
 * - Answers: 201 `{ ref }`, 400, 403 origin, 410 closed, 413, 429
 *   `{ retryAfter }`, 503. The player is told which, and nothing here ever
 *   retries on its own (telemetry's rule): a failure keeps the draft and the
 *   form offers Retry.
 * - 403 and 410 both read as "feedback is closed right now" (the lead's
 *   ruling): a calm state, never an error, held for the session.
 *
 * Nothing leaves the machine unless `feedbackSends` said so (`gate.ts`): a
 * send anywhere else is a dry run, answered without a network request.
 */
import { markClosed } from './gate';
import type { FeedbackMeta } from './meta';

export interface FeedbackNote {
  meta: FeedbackMeta;
  /** The picture, already encoded. Sent only from the pause form. */
  shot?: Blob | null;
  /** The replay log as JSON. Sent only with a Bug from the pause form. */
  replay?: string | null;
}

export type SendResult =
  | { kind: 'sent'; ref: string }
  | { kind: 'dry-run' }
  | { kind: 'closed' }
  | { kind: 'busy'; retryAfter: number }
  | { kind: 'failed'; status: number | null }
  | { kind: 'aborted' };

export interface ClientDeps {
  /** `feedbackSends(...)`: false means a dry run, with no request at all. */
  sends: boolean;
  /** The endpoint, e.g. `https://<host>/api/feedback`. */
  url: string;
  fetch: (input: string, init: RequestInit) => Promise<Response>;
  signal?: AbortSignal;
  /** Let the request outlive the page (the debrief's rating on leave). */
  keepalive?: boolean;
}

/** May this note carry a picture / a replay? The Worker refuses either part
 *  outside these cases with a 400, so the client never builds one. */
export const mayAttachShot = (m: Pick<FeedbackMeta, 'source'>): boolean => m.source === 'pause';
export const mayAttachReplay = (m: Pick<FeedbackMeta, 'source' | 'category'>): boolean =>
  m.source === 'pause' && m.category === 'bug';

/** The multipart body. Exported for its test: the parts are the contract. */
export function feedbackBody(note: FeedbackNote): FormData {
  const form = new FormData();
  form.append('meta', new Blob([JSON.stringify(note.meta)], { type: 'application/json' }));
  if (note.shot && mayAttachShot(note.meta)) form.append('shot', note.shot, note.shot.type === 'image/jpeg' ? 'shot.jpg' : 'shot.webp');
  if (note.replay && mayAttachReplay(note.meta)) {
    form.append('replay', new Blob([note.replay], { type: 'application/json' }), 'replay.json');
  }
  return form;
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    const v: unknown = await res.json();
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function sendFeedback(note: FeedbackNote, d: ClientDeps): Promise<SendResult> {
  if (!d.sends) return { kind: 'dry-run' };
  let res: Response;
  try {
    res = await d.fetch(d.url, {
      method: 'POST',
      body: feedbackBody(note),
      signal: d.signal,
      keepalive: d.keepalive === true,
      credentials: 'same-origin',
    });
  } catch (err) {
    if (d.signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) return { kind: 'aborted' };
    return { kind: 'failed', status: null };
  }
  if (res.status === 201) {
    const body = await readJson(res);
    return typeof body.ref === 'string' ? { kind: 'sent', ref: body.ref } : { kind: 'sent', ref: '' };
  }
  if (res.status === 403 || res.status === 410) {
    markClosed();
    return { kind: 'closed' };
  }
  if (res.status === 429) {
    const body = await readJson(res);
    const s = typeof body.retryAfter === 'number' && body.retryAfter > 0 ? Math.ceil(body.retryAfter) : 60;
    return { kind: 'busy', retryAfter: s };
  }
  return { kind: 'failed', status: res.status };
}

/** `GET /api/feedback` answers `{ open }`, so the entry points can stand
 *  down when the switch is off without an app deploy. Asked at most once a
 *  session, and only where a send could happen at all. */
let probed: Promise<boolean> | null = null;
export function feedbackOpen(d: Pick<ClientDeps, 'sends' | 'url' | 'fetch'>): Promise<boolean> {
  if (!d.sends) return Promise.resolve(true);
  probed ??= d
    .fetch(d.url, { method: 'GET', credentials: 'same-origin' })
    .then(async (res) => {
      if (res.status === 403 || res.status === 410) return false;
      if (!res.ok) return true;
      const body = await readJson(res);
      return body.open !== false;
    })
    .catch(() => true)
    .then((open) => {
      if (!open) markClosed();
      return open;
    });
  return probed;
}
/** Tests only. */
export function resetProbeForTest(): void {
  probed = null;
}
