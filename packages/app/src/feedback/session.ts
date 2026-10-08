/**
 * The browser half of feedback (GH-464): who a note is sent as, where it goes,
 * and the one `send` every entry point calls. `main.ts` builds one of these
 * per screen that offers feedback and hands the screen only functions.
 *
 * Who it is sent as (spec §7, and the lead's v1 ruling):
 * - a tester (`?tester=`, persisted): the tester label, the player id and the
 *   session id -- the `/stats` timeline joins on the session;
 * - any other player: anonymously, with the session id alone;
 * - an opt-out (`?notrack`, GPC, DNT): anonymously, with no id at all.
 * The ids come from telemetry, which is off wherever a note cannot be sent
 * (dev, tests, an opt-out), so a dry run carries none.
 */
import { telemetry } from '../telemetry';
import { readOptOut, type StorageLike } from '../telemetry/identity';
import { feedbackOpen, sendFeedback, type SendResult } from './client';
import type { FeedbackContext } from './context';
import { browserFeedbackEnv, feedbackSends, feedbackShown, testerLabel, type FeedbackEnv } from './gate';
import { buildMeta, type FeedbackCategory, type FeedbackSource, type SenderIds } from './meta';

export interface FeedbackSession {
  shown: boolean;
  sends: boolean;
  storage: StorageLike | null;
  build: string;
  who: { tester?: string; anonymous: boolean };
  ids(): SenderIds;
  /** Resolves false when the server's switch is off (asked once a session). */
  open(): Promise<boolean>;
  send(note: SessionNote, opts?: { signal?: AbortSignal; keepalive?: boolean }): Promise<SendResult>;
}

export interface SessionNote {
  source: FeedbackSource;
  category: FeedbackCategory;
  text: string;
  rating?: number;
  contact?: string;
  where: { context: FeedbackContext; mission?: string; map?: string; tick?: number };
  shot?: Blob | null;
  replay?: string | null;
}

export interface SessionDeps {
  env: FeedbackEnv;
  optedOut: boolean;
  build: string;
  commit?: string;
  url: string;
  fetch: (input: string, init: RequestInit) => Promise<Response>;
  ids: () => { player: string; session: string; tester?: string } | null;
  now: () => number;
}

export function createFeedbackSession(d: SessionDeps): FeedbackSession {
  const sends = feedbackSends(d.env);
  const tester = d.optedOut ? undefined : testerLabel(d.env);
  const ids = (): SenderIds => {
    if (d.optedOut) return {};
    const t = d.ids();
    if (t === null) return {};
    // A tester is known by name; anyone else is sent anonymously, with the
    // session alone so the note still joins its own timeline.
    return tester !== undefined ? { tester, player: t.player, session: t.session } : { session: t.session };
  };
  return {
    shown: feedbackShown(d.env),
    sends,
    storage: d.env.storage,
    build: d.build,
    who: tester !== undefined ? { tester, anonymous: false } : { anonymous: true },
    ids,
    open: () => feedbackOpen({ sends, url: d.url, fetch: d.fetch }),
    send: (n, opts) =>
      sendFeedback(
        {
          meta: buildMeta({
            source: n.source,
            category: n.category,
            text: n.text,
            rating: n.rating,
            contact: n.contact,
            ids: ids(),
            build: d.build,
            commit: d.commit,
            mission: n.where.mission,
            map: n.where.map,
            tick: n.where.tick,
            context: n.where.context,
            now: d.now(),
          }),
          shot: n.shot ?? null,
          replay: n.replay ?? null,
        },
        { sends, url: d.url, fetch: d.fetch, signal: opts?.signal, keepalive: opts?.keepalive }
      ),
  };
}

/** The live one, read off `location`, storage and telemetry. */
export function browserFeedbackSession(): FeedbackSession {
  const env = browserFeedbackEnv();
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  const optedOut = readOptOut(env.storage, env.query) || nav.globalPrivacyControl === true || nav.doNotTrack === '1';
  return createFeedbackSession({
    env,
    optedOut,
    build: __APP_BUILD__,
    commit: __APP_COMMIT__ === '' ? undefined : __APP_COMMIT__,
    url: new URL('api/feedback', location.origin + import.meta.env.BASE_URL).href,
    fetch: (input, init) => fetch(input, init),
    ids: () => telemetry().ids(),
    now: () => Date.now(),
  });
}
