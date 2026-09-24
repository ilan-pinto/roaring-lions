/**
 * Player telemetry (WP-T1). Spec: docs/superpowers/specs/2026-09-24-telemetry-design.md.
 *
 * Listens; never acts. Every entry point is wrapped so a failure is silent, and
 * nothing here is awaited by the game. When the off switch says no, callers get
 * NOOP_TELEMETRY and nothing is built, stored or sent.
 */
import type { TelemetryEnvelope, TelemetryEvent, TelemetryScreen } from '@lions/data/telemetry';
import type { MissionEvent } from '@lions/sim';
import * as ev from './events';
import type { RuntimeView } from './events';
import { resolveIdentity, readOptOut, safeStorage, type Identity } from './identity';
import { telemetryEnabled } from './enabled';
import { Sender, browserTransport } from './sender';

export type { RuntimeView } from './events';

export interface MissionTelemetry {
  onEvent(me: MissionEvent): void;
  /** The one exit: teardown and pagehide both call it; idempotent. `viaPagehide`
   *  skips this call's own flush, so the pagehide handler's `flush(true)` is
   *  what actually sends the abandoned event, over `sendBeacon` rather than a
   *  `fetch` that page unload can cut off mid-flight. */
  end(viaPagehide?: boolean): void;
}

export interface Telemetry {
  sessionStart(screen: TelemetryScreen, renderer: 'three' | 'pixi'): void;
  tutorialStep(step: number, steps: number): void;
  missionStarted(mission: string, replay: boolean, view: () => RuntimeView): MissionTelemetry;
  campaignProgress(mission: string, missionsWon: number): void;
}

const NOOP_MISSION: MissionTelemetry = { onEvent: () => undefined, end: () => undefined };
export const NOOP_TELEMETRY: Telemetry = {
  sessionStart: () => undefined,
  tutorialStep: () => undefined,
  missionStarted: () => NOOP_MISSION,
  campaignProgress: () => undefined,
};

export interface TelemetryDeps {
  identity: Identity;
  newSession: () => string;
  build: string;
  dev: boolean;
  now: () => number;
  viewport: () => [number, number];
  visible: () => boolean;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
  onPagehide: (fn: () => void) => void;
  sink: { push(e: TelemetryEvent): void; flush(useBeacon?: boolean): void };
}

const HEARTBEAT_MS = 60_000;
const FLUSH_MS = 30_000;

const safe =
  <A extends unknown[]>(f: (...a: A) => void) =>
  (...a: A): void => {
    try {
      f(...a);
    } catch {
      /* telemetry never breaks the game */
    }
  };

export function createTelemetry(d: TelemetryDeps): Telemetry {
  const session = d.newSession();
  const envelope = (): TelemetryEnvelope => ({
    v: 1,
    player: d.identity.player,
    session,
    ...(d.identity.tester === undefined ? {} : { tester: d.identity.tester }),
    build: d.build,
    t: d.now(),
    ...(d.dev ? { dev: true as const } : {}),
  });
  let current: MissionTelemetry | null = null;
  let lastStepAt: number | null = null;

  d.onPagehide(
    safe(() => {
      current?.end(true);
      d.sink.flush(true);
    })
  );

  return {
    sessionStart: safe((screen, renderer) => {
      d.sink.push(ev.sessionStart(envelope(), screen, renderer, d.viewport(), d.identity.returning));
    }),
    tutorialStep: safe((step, steps) => {
      const now = d.now();
      // A fresh tutorial run (replayed, or a second player on the same
      // document) starts back at step 0; `prevMs` must read as 0 for it too,
      // not as the time since whatever step the PREVIOUS run ended on.
      if (step === 0) lastStepAt = null;
      d.sink.push(ev.tutorialStep(envelope(), step, steps, lastStepAt === null ? 0 : now - lastStepAt));
      lastStepAt = now;
    }),
    campaignProgress: safe((mission, missionsWon) => {
      d.sink.push(ev.campaignProgress(envelope(), mission, missionsWon));
    }),
    missionStarted: (mission, replay, view) => {
      try {
        current?.end();
        let ended = false;
        d.sink.push(ev.missionStart(envelope(), mission, replay));
        const hb = d.setInterval(
          safe(() => {
            if (!ended && d.visible()) d.sink.push(ev.heartbeat(envelope(), mission, view().tick));
          }),
          HEARTBEAT_MS
        );
        const finish = (abandoned: boolean, viaPagehide = false): void => {
          if (ended) return;
          ended = true;
          d.clearInterval(hb);
          d.sink.push(ev.missionEnd(envelope(), mission, view(), abandoned));
          // On pagehide the caller's own `flush(true)` (over sendBeacon) is
          // what sends this: flushing here too would race it out over a plain
          // `fetch`, which page unload is free to cut off mid-flight.
          if (!viaPagehide) d.sink.flush();
        };
        const m: MissionTelemetry = {
          onEvent: safe((me: MissionEvent) => {
            if (me.kind === 'missionEnd') finish(false);
            else if (me.kind === 'objective' && (me.status === 'complete' || me.status === 'failed')) {
              const e = ev.objectiveEvent(envelope(), mission, view(), me.id, me.status, me.tick);
              if (e) d.sink.push(e);
            }
          }),
          end: safe((viaPagehide?: boolean) => {
            finish(true, viaPagehide);
            if (current === m) current = null;
          }),
        };
        current = m;
        return m;
      } catch {
        return NOOP_MISSION;
      }
    },
  };
}

let instance: Telemetry = NOOP_TELEMETRY;

/** The accessor every hook uses. NOOP until `initTelemetry()` runs. */
export function telemetry(): Telemetry {
  return instance;
}

/** Browser wiring, once per document, from `main()`. */
export function initTelemetry(opts: { dev: boolean }): Telemetry {
  try {
    const query = new URLSearchParams(location.search);
    const storage = safeStorage(() => window.localStorage);
    // Read the opt-out signal alone first -- it mints and stores nothing.
    // Only once `on` is true do we call resolveIdentity, which mints and
    // saves a player (and tester) id: a GPC/DNT/notrack user, or a dev/CI
    // session with telemetry off, must never get an id written to storage.
    const optedOut = readOptOut(storage, query);
    const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
    const on = telemetryEnabled({
      prod: import.meta.env.PROD,
      hostname: location.hostname,
      query,
      gpc: nav.globalPrivacyControl === true,
      dnt: nav.doNotTrack === '1',
      optedOut,
    });
    if (!on) return (instance = NOOP_TELEMETRY);
    const identity = resolveIdentity(storage, query, () => crypto.randomUUID());
    const sender = new Sender(browserTransport(new URL('api/events', location.origin + import.meta.env.BASE_URL).href));
    window.setInterval(safe(() => sender.flush()), FLUSH_MS);
    instance = createTelemetry({
      identity,
      newSession: () => crypto.randomUUID(),
      build: __APP_BUILD__,
      dev: opts.dev,
      now: () => Date.now(),
      viewport: () => [window.innerWidth, window.innerHeight],
      visible: () => document.visibilityState === 'visible',
      setInterval: (fn, ms) => window.setInterval(fn, ms),
      clearInterval: (h) => window.clearInterval(h as number),
      onPagehide: (fn) => window.addEventListener('pagehide', fn),
      sink: sender,
    });
    return instance;
  } catch {
    return (instance = NOOP_TELEMETRY);
  }
}
