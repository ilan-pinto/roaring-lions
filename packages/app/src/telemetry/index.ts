/**
 * Player telemetry (WP-T1). Spec: docs/superpowers/specs/2026-09-24-telemetry-design.md.
 *
 * Listens; never acts. Every entry point is wrapped so a failure is silent, and
 * nothing here is awaited by the game. When the off switch says no, callers get
 * NOOP_TELEMETRY and nothing is built, stored or sent.
 */
import type {
  AccountReason,
  CountMap,
  TelemetryBackend,
  TelemetryEnvelope,
  TelemetryEvent,
  TelemetryOrderVerb,
  TelemetryPreset,
  TelemetryScreen,
} from '@lions/data/telemetry';
import type { MissionEvent } from '@lions/sim';
import * as ev from './events';
import type { AccountExtra, AccountLike, Loadout, RuntimeView } from './events';
import type { PlayerIntent } from '../input/intents';
import { resolveIdentity, readOptOut, safeStorage, setOptOut, storedOptOut, storedPlayerId, type Identity, type StorageLike } from './identity';
import { gpuFamily } from '@lions/data/telemetry';
import { installErrorHandlers, type DescribedError } from './errors';
import { FrameSampler } from './perf';
import { telemetryEnabled } from './enabled';
import { Sender, browserTransport } from './sender';

export type { RuntimeView } from './events';
export type { Loadout, AccountLike, AccountExtra } from './events';

export interface MissionTelemetry {
  onEvent(me: MissionEvent): void;
  /** The one exit: teardown and pagehide both call it; idempotent. `viaPagehide`
   *  skips this call's own flush, so the pagehide handler's `flush(true)` is
   *  what actually sends the abandoned event, over `sendBeacon` rather than a
   *  `fetch` that page unload can cut off mid-flight. */
  end(viaPagehide?: boolean): void;
  /** Called from `intentListeners` after `applyIntent`: counts, never acts. */
  onIntent(i: PlayerIntent): void;
  /** Called by the dock when its click-time `canBuild` pre-check passes (N2, D3). Two buys in one frame that the purse covers once are both counted (D3's known gap). */
  onBought(unitId: string): void;
  /** GH-1410: one frame's wall time in milliseconds, from the frame loop. Feeds the `perf_sample` event; a stall over a second is dropped. */
  onFrame(frameMs: number): void;
}

/** What the field-signal events say about the machine (GH-1410). `gpu` is the graphics card's RAW name here (null when the browser will not say); an event carries only its family. */
export interface Gear {
  preset: TelemetryPreset;
  backend: TelemetryBackend;
  gpu: string | null;
}

export interface Telemetry {
  /** `renderer` is always 'three' now (WP-A3.3); kept for row continuity. */
  sessionStart(screen: TelemetryScreen, renderer: 'three'): void;
  tutorialStep(step: number, steps: number, id?: string): void;
  missionStarted(mission: string, replay: boolean, view: () => RuntimeView, loadout?: Loadout): MissionTelemetry;
  campaignProgress(mission: string, missionsWon: number): void;
  account(reason: AccountReason, a: AccountLike, extra?: AccountExtra): void;
  /** GH-1410: time from navigation start to the first drawn frame. Once a page load; later calls are ignored. */
  boot(ttffMs: number): void;
  /** GH-1410: a described client error (`errors.ts`). Capped per session, and per crash, so a loop cannot flood the Worker. */
  clientError(e: DescribedError): void;
  /** Who this session is, for a feedback note (GH-464): null while telemetry
   *  is off (dev, tests, an opt-out), so a note from there carries no ids. */
  ids(): { player: string; session: string; tester?: string } | null;
  /** GH-1431: this session's player id even after an opt-out, for an account deletion that also deletes the reports. Reads memory only;
   *  sends and stores nothing. Null when telemetry never ran this page load. */
  knownPlayer(): string | null;
}

const NOOP_MISSION: MissionTelemetry = {
  onEvent: () => undefined,
  end: () => undefined,
  onIntent: () => undefined,
  onBought: () => undefined,
  onFrame: () => undefined,
};
export const NOOP_TELEMETRY: Telemetry = {
  sessionStart: () => undefined,
  tutorialStep: () => undefined,
  missionStarted: () => NOOP_MISSION,
  campaignProgress: () => undefined,
  account: () => undefined,
  boot: () => undefined,
  clientError: () => undefined,
  ids: () => null,
  knownPlayer: () => null,
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
  /** GH-1410: the machine, read when an event is built (the GPU name is asked of the browser lazily, once). */
  gear?: () => Gear;
  /** GH-1410: the live opt-out. True once the player has switched reports off this session: `ids()` then answers null, so a feedback note carries no id. */
  optedOut?: () => boolean;
  sink: { push(e: TelemetryEvent): void; flush(useBeacon?: boolean): void };
}

const HEARTBEAT_MS = 60_000;
const FLUSH_MS = 30_000;
/** GH-1410: a `perf_sample` closes every two minutes of a visible mission, and only with this many frames behind it. */
export const PERF_SAMPLE_MS = 120_000;
export const PERF_MIN_FRAMES = 300;
/** GH-1410: per session, at most this many `client_error` events, and at most this many of one crash (one hash). */
export const ERROR_CAP = 10;
export const ERROR_SAME_CAP = 3;

const safe =
  <A extends unknown[]>(f: (...a: A) => void) =>
  (...a: A): void => {
    try {
      f(...a);
    } catch {
      /* telemetry never breaks the game */
    }
  };

const DEFAULT_GEAR: Gear = { preset: 'high', backend: 'webgl2', gpu: null };

export function createTelemetry(d: TelemetryDeps): Telemetry {
  const session = d.newSession();
  // The ONE place the graphics card is named in an event, and it is the FAMILY: the raw `WEBGL_debug_renderer_info` string carries PCI device ids
  // and driver versions. Nothing past here sees the raw text, so no caller can send it by mistake.
  const gear = (): Gear => {
    const g = d.gear?.() ?? DEFAULT_GEAR;
    return { ...g, gpu: g.gpu === null ? null : gpuFamily(g.gpu) };
  };
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
  let currentMission: string | null = null;
  let lastStepAt: number | null = null;
  let booted = false;
  let errorsSent = 0;
  const errorHashes = new Map<string, number>();

  d.onPagehide(
    safe(() => {
      current?.end(true);
      d.sink.flush(true);
    })
  );

  return {
    knownPlayer: () => d.identity.player,
    ids: () =>
      d.optedOut?.() === true
        ? null
        : d.identity.tester === undefined
          ? { player: d.identity.player, session }
          : { player: d.identity.player, session, tester: d.identity.tester },
    sessionStart: safe((screen, renderer) => {
      d.sink.push(ev.sessionStart(envelope(), screen, renderer, d.viewport(), d.identity.returning));
    }),
    tutorialStep: safe((step, steps, id) => {
      const now = d.now();
      // A fresh tutorial run (replayed, or a second player on the same
      // document) starts back at step 0; `prevMs` must read as 0 for it too,
      // not as the time since whatever step the PREVIOUS run ended on.
      if (step === 0) lastStepAt = null;
      d.sink.push(ev.tutorialStep(envelope(), step, steps, lastStepAt === null ? 0 : now - lastStepAt, id));
      lastStepAt = now;
    }),
    boot: safe((ttffMs) => {
      if (booted) return;
      booted = true;
      d.sink.push(ev.bootEvent(envelope(), ttffMs, gear()));
    }),
    clientError: safe((e) => {
      const same = errorHashes.get(e.hash) ?? 0;
      if (errorsSent >= ERROR_CAP || same >= ERROR_SAME_CAP) return;
      errorsSent++;
      errorHashes.set(e.hash, same + 1);
      d.sink.push(
        ev.clientError(envelope(), e, {
          ...(currentMission === null ? {} : { screen: 'mission' as const, mission: currentMission }),
        })
      );
      // A crash may be the last thing this page does: send it now, not at the next 30 s flush.
      d.sink.flush();
    }),
    campaignProgress: safe((mission, missionsWon) => {
      d.sink.push(ev.campaignProgress(envelope(), mission, missionsWon));
    }),
    account: safe((reason, a, extra) => {
      d.sink.push(ev.accountEvent(envelope(), reason, ev.accountSnapshot(a), extra));
    }),
    missionStarted: (mission, replay, view, loadout) => {
      try {
        current?.end();
        let ended = false;
        currentMission = mission;
        const sampler = new FrameSampler();
        let sampleStart = d.now();
        const bought: CountMap = {};
        const orders: Partial<Record<TelemetryOrderVerb, number>> = {};
        d.sink.push(ev.missionStart(envelope(), mission, replay, loadout));
        const hb = d.setInterval(
          safe(() => {
            if (!ended && d.visible()) d.sink.push(ev.heartbeat(envelope(), mission, view().tick));
          }),
          HEARTBEAT_MS
        );
        const finish = (abandoned: boolean, viaPagehide = false): void => {
          // finish() has already built (and sent) the mission_end event on its first call; this guard is defence in depth against a late listener firing again after end().
          if (ended) return;
          ended = true;
          if (currentMission === mission) currentMission = null;
          d.clearInterval(hb);
          d.sink.push(ev.missionEnd(envelope(), mission, view(), abandoned, { bought, orders }));
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
          onIntent: safe((i: PlayerIntent) => {
            if (ended) return;
            const v = ev.orderVerbOf(i);
            if (v) ev.tallyVerb(orders, v);
          }),
          onBought: safe((u: string) => {
            if (!ended) ev.tallyUnit(bought, u);
          }),
          onFrame: safe((frameMs: number) => {
            if (ended || !d.visible()) return;
            sampler.add(frameMs);
            const now = d.now();
            if (now - sampleStart < PERF_SAMPLE_MS) return;
            // The window closes either way; a window with too few frames (a hidden tab, a paused mission) is not a sample.
            sampleStart = now;
            if (sampler.count < PERF_MIN_FRAMES) {
              sampler.take();
              return;
            }
            const p = sampler.take();
            if (p === null) return;
            const v = view();
            d.sink.push(ev.perfSample(envelope(), mission, v.living ?? Math.max(0, v.fielded - v.lost), gear(), p));
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

/**
 * GH-1431: the telemetry player id an account deletion should name when the player ticks "also delete my reports". `ids()` answers null after
 * an opt-out (so a feedback note carries no id), which left those rows behind until they aged out at 180 days. This reads the id instead: the
 * running session's, else the one this browser stored. It sends no event, mints no id and writes nothing.
 */
export function telemetryPlayerForDeletion(storage: StorageLike | null = safeStorage(() => window.localStorage)): string | null {
  return instance.knownPlayer() ?? storedPlayerId(storage);
}

/**
 * GH-1410: the sink the game's events go through, with the opt-out read LIVE before every push and flush. The off switch at boot
 * (`telemetryEnabled`) decides whether telemetry exists at all; this decides, event by event, whether the Settings toggle was turned to
 * "off" since. An opt-out drops what is already queued too (`clear`), so nothing waiting leaves after the player said no.
 */
export function gatedSink(
  inner: { push(e: TelemetryEvent): void; flush(useBeacon?: boolean): void; clear(): void },
  optedOut: () => boolean
): { push(e: TelemetryEvent): void; flush(useBeacon?: boolean): void } {
  return {
    push: (e) => {
      if (optedOut()) inner.clear();
      else inner.push(e);
    },
    flush: (useBeacon) => {
      if (optedOut()) inner.clear();
      else inner.flush(useBeacon);
    },
  };
}

/**
 * The opt-out the Settings switch set in THIS page load, held in memory as well as in storage. With site data blocked (or a write that throws)
 * storage cannot hold it, and a switch that only wrote storage would read ON again and the gate would never close. Memory is the floor:
 * "off" is off for the rest of the page whatever storage does, and storage carries it to the next load where it can.
 */
let sessionOptOut = false;

/** Whether the player has opted out right now: this page's switch, or the stored opt-out (`?notrack`, or the switch on an earlier visit). */
export function optedOutNow(storage: StorageLike | null): boolean {
  return sessionOptOut || storedOptOut(storage);
}

/** The Settings toggle's door (GH-1410): reads and writes the opt-out the live gate reads. Works whether or not telemetry is running. */
export const telemetryOptOut = {
  get(): boolean {
    return optedOutNow(safeStorage(() => window.localStorage));
  },
  set(on: boolean): void {
    sessionOptOut = on;
    setOptOut(safeStorage(() => window.localStorage), on);
  },
};

/** What the Settings checkbox reads and writes: ON means reports are SENT, so it is the stored opt-out inverted. */
export const reportsSwitch = {
  get: (): boolean => !telemetryOptOut.get(),
  set: (on: boolean): void => telemetryOptOut.set(!on),
};

/** Browser wiring, once per document, from `main()`. */
export function initTelemetry(opts: { dev: boolean; gear?: () => Gear }): Telemetry {
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
    const sink = gatedSink(sender, () => optedOutNow(storage));
    window.setInterval(safe(() => sink.flush()), FLUSH_MS);
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
      gear: opts.gear ?? (() => DEFAULT_GEAR),
      optedOut: () => optedOutNow(storage),
      sink,
    });
    // GH-1410: crashes. Only here, past the off switch above: with telemetry off (dev, tests, CI, GPC, DNT, an opt-out) nothing is listened to.
    installErrorHandlers(window, (e) => instance.clientError(e));
    return instance;
  } catch {
    return (instance = NOOP_TELEMETRY);
  }
}
