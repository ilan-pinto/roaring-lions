/**
 * The DEV-only `/arena/watch` screen (GH-954 W1): watch a `pnpm arena --watch` run live. This module is reached
 * only by a dynamic `import()` inside `import.meta.env.DEV` in `main.ts`, so a production build has no route, API path, key header or watch module (the strip CSS and the `arena.*` strings ship, inert)
 * (`tools/src/net/arena-serve.test.ts` pins that against a real `vite build`).
 *
 * It owns the strip, the poll loop (`net/watch-run.ts`) and one stage element per game. Each game is a
 * battlefield booted through `deps.boot` (`bootBattlefield` with `spectate`) and torn down through its
 * disposer before the next is booted. Leaving the route disposes all of it: the poll, the battlefield on screen
 * (its socket and its renderer, through the battlefield's own teardown), the strip and the stage.
 */
import type { SocketLike } from '@lions/net';
import { fetchLive, connectWatch, type Live, type RunningLive } from '../net/watch-connect';
import { runWatch, type WatchState } from '../net/watch-run';
import { stripText, viewerFor, waitingOnPlayers, type SpectateHooks, type SpectatorHandle, type SpectatorReading, type ViewChoice, type WatchPhase } from '../net/spectator';
import type { Disposer } from '../shell/router';
import { mountArenaStrip } from './arena-strip';

/** What `bootBattlefield` is handed for a spectated game. */
export interface SpectateRequest {
  connect(signal: AbortSignal): ReturnType<typeof connectWatch>;
  hooks: SpectateHooks;
  capTicks: number;
}

export interface ArenaWatchDeps {
  /** The run's key from the URL fragment; null: the page was not opened from the printed link. */
  key: string | null;
  fetch: typeof fetch;
  openSocket: (url: string) => SocketLike;
  /** Boots a spectated battlefield on `stage`; resolves with its disposer. */
  boot(stage: HTMLElement, signal: AbortSignal, spectate: SpectateRequest, live: RunningLive): Promise<Disposer>;
  /** Stop watching: leave for the menu. */
  leave(): void;
  note?(text: string): void;
  /** For a spec. */
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (h: unknown) => void;
}

const STRIP_MS = 250;

export function showArenaWatch(host: HTMLElement, deps: ArenaWatchDeps): Disposer {
  const now = deps.now ?? ((): number => performance.now());
  const note = deps.note ?? ((text: string) => { console.info(`[arena] ${text}`); });
  let disposed = false;
  let view: ViewChoice = 'all';
  let handle: SpectatorHandle | null = null;
  let state: WatchState = { phase: deps.key === null ? 'refused' : 'connecting', live: null, last: null };
  let reading: SpectatorReading | null = null;
  let lastTick = -1;
  let movedAt = now();

  const paint = (): void => {
    const live = state.live;
    const shownN = live?.game.n ?? state.last?.n ?? 0;
    const labels: [string, string] = live?.labels ?? state.last?.players ?? ['', ''];
    const sides: [0 | 1, 0 | 1] = reading !== null ? [reading.config.seats[0].side, reading.config.seats[1].side] : [0, 1];
    const tick = reading?.tick ?? 0;
    const roundTicks = live?.roundTicks ?? 1;
    const phase: WatchPhase = state.phase;
    const verdict = state.last !== null && state.last.n === shownN ? { outcome: state.last.outcome, by: state.last.by } : null;
    strip.update(stripText({
      phase, n: shownN, of: live?.game.of ?? 0, labels, score: reading?.score ?? null, sides, tick, roundTicks,
      waiting: reading !== null && waitingOnPlayers({ tick, roundTicks, behind: reading.behind, sinceMovedMs: now() - movedAt, over: reading.over }),
      verdict, view,
    }));
  };
  const read = (): void => {
    reading = handle?.read() ?? null;
    if (reading !== null && reading.tick !== lastTick) { lastTick = reading.tick; movedAt = now(); }
    paint();
  };

  const strip = mountArenaStrip(document.body, {
    onView: (c) => {
      view = c;
      if (handle !== null && reading !== null) handle.setViewer(viewerFor(c, reading.config.seats));
      paint();
    },
    onStop: () => deps.leave(),
  });

  const hooksFor = (): SpectateHooks => ({
    onReady: (h) => {
      handle = h;
      lastTick = -1;
      movedAt = now();
      read();
      // The reading holds the seats; a choice made on an earlier game applies to this one at once.
      if (view !== 'all' && reading !== null) h.setViewer(viewerFor(view, reading.config.seats));
    },
    onEnd: () => { read(); },
  });

  let stopWatch: Disposer = () => {};
  if (deps.key !== null) {
    const key = deps.key;
    stopWatch = runWatch({
      fetchLive: (): Promise<Live> => fetchLive({ fetch: deps.fetch, key }),
      boot: async (live, hooks) => {
        const ac = new AbortController();
        const stage = document.createElement('div');
        stage.className = 'rl-arena-stage';
        host.appendChild(stage);
        handle = null;
        reading = null;
        const spectate: SpectateRequest = {
          connect: (signal) => connectWatch(live, { openSocket: deps.openSocket, note, signal }),
          hooks,
          capTicks: live.capTicks,
        };
        try {
          const dispose = await deps.boot(stage, ac.signal, spectate, live);
          return () => {
            ac.abort();
            handle = null;
            try { dispose(); } finally { stage.remove(); }
          };
        } catch (err) {
          ac.abort();
          stage.remove();
          throw err;
        }
      },
      schedule: (fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); },
      hooksFor,
      onState: (s) => { state = s; paint(); },
      warn: (text, err) => { console.warn(text, err); },
    });
  }
  const setIv = deps.setInterval ?? ((fn: () => void, ms: number): unknown => setInterval(fn, ms));
  const clearIv = deps.clearInterval ?? ((h: unknown): void => { clearInterval(h as ReturnType<typeof setInterval>); });
  const timer = setIv(read, STRIP_MS);
  paint();

  return () => {
    if (disposed) return;
    disposed = true;
    clearIv(timer);
    stopWatch();
    strip.dispose();
    host.replaceChildren();
  };
}
