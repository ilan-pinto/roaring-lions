/**
 * The watch screen's loop (GH-954 W1): poll `/arena/api/live`, and whenever the arena is on a game this page is
 * not showing, tear the old battlefield down through its disposer and boot the next one. Pure over injected
 * `fetchLive`, `boot` and `schedule`, so a spec drives it with fakes and fake timers.
 *
 * Rules, each pinned in `watch-run.test.ts`:
 * - one battlefield at a time, and the old one's disposer has RUN before the next boot starts (two renderers
 *   alive at once is two WebGL contexts and two sockets);
 * - the same game number is booted once: a poll that sees the game already on screen does nothing;
 * - a game whose boot failed is not retried until the arena is on another game (a room that has already
 *   ended answers every join the same way);
 * - the last game stays on screen between games and after the run, so the final picture is not torn away;
 * - `dispose` stops the polling at once, cancels a boot in flight (its disposer runs the moment it lands) and
 *   disposes the battlefield on screen, exactly once.
 */
import type { Disposer } from '../shell/router';
import { isRunning, WatchRefused, type Live, type RunningLive } from './watch-connect';
import type { SpectateHooks, WatchPhase } from './spectator';

export interface WatchRunDeps {
  fetchLive(): Promise<Live>;
  /** Boots a battlefield for this game. Rejects if it could not; resolves with its disposer. */
  boot(live: RunningLive, hooks: SpectateHooks): Promise<Disposer>;
  /** `setTimeout`, returning its cancel. */
  schedule(fn: () => void, ms: number): () => void;
  /** The screen's state, whenever it changes. */
  onState(s: WatchState): void;
  /** What to do with a spectated game's hooks, per game: the screen wires its strip here. */
  hooksFor(live: RunningLive): SpectateHooks;
  warn?(text: string, err?: unknown): void;
  pollMs?: number;
}

export interface WatchState {
  phase: WatchPhase;
  /** The game on screen (or last on screen), else null. */
  live: RunningLive | null;
  /** The last finished game's verdict, from the arena. */
  last: Live['last'];
}

export const POLL_MS = 1000;

export function runWatch(deps: WatchRunDeps): Disposer {
  const pollMs = deps.pollMs ?? POLL_MS;
  const warn = deps.warn ?? (() => {});
  let disposed = false;
  let cancelPoll: () => void = () => {};
  let current: { n: number; live: RunningLive; dispose: Disposer; ended: boolean } | null = null;
  let booting = false;
  let failedN = -1;
  let refused = false;
  let state: WatchState = { phase: 'connecting', live: null, last: null };
  const emit = (patch: Partial<WatchState>): void => {
    state = { ...state, ...patch };
    deps.onState(state);
  };
  const dropCurrent = (): void => {
    const c = current;
    current = null;
    c?.dispose();
  };

  const bootGame = async (live: RunningLive): Promise<void> => {
    booting = true;
    // The old one first: its disposer has returned before the next boot begins.
    dropCurrent();
    emit({ phase: 'connecting', live });
    const n = live.game.n;
    let ended = false;
    let ready = false;
    const inner = deps.hooksFor(live);
    const hooks: SpectateHooks = {
      onReady: (h) => { ready = true; inner.onReady(h); },
      onEnd: (how) => {
        ended = true;
        if (current?.n === n) { current.ended = true; emit({ phase: 'finished' }); }
        inner.onEnd(how);
      },
    };
    try {
      const dispose = await deps.boot(live, hooks);
      if (disposed) { dispose(); return; }
      current = { n, live, dispose, ended };
      if (ready || !ended) emit({ phase: ended ? 'finished' : 'playing', live });
    } catch (err) {
      failedN = n;
      if (!(err instanceof DOMException && err.name === 'AbortError')) warn(`arena watch: game ${n} could not be shown`, err);
      if (!disposed) emit({ phase: 'between', live });
    } finally {
      booting = false;
    }
  };

  const poll = async (): Promise<void> => {
    if (disposed || refused) return;
    try {
      if (!booting) {
        let live: Live | null = null;
        try {
          live = await deps.fetchLive();
        } catch (err) {
          if (disposed) return;
          if (err instanceof WatchRefused && (err.status === 403 || err.status === 421)) {
            refused = true;
            emit({ phase: 'refused' });
            return;
          }
          // No answer: the server is gone (the run ended and it closed) or not up yet. Keep what is on screen.
          if (current === null) emit({ phase: 'no-run' });
          else emit({ phase: current.ended ? 'done' : state.phase });
        }
        if (live !== null && !disposed) {
          emit({ last: live.last });
          if (isRunning(live)) {
            if (current?.n !== live.game.n && failedN !== live.game.n) await bootGame(live);
          } else if (live.state === 'finished') {
            emit({ phase: 'done' });
          } else if (current === null || current.ended) {
            // Between games (or before the first): the last picture stays, the strip says what is awaited.
            emit({ phase: 'between' });
          }
        }
      }
    } finally {
      if (!disposed && !refused) cancelPoll = deps.schedule(() => { void poll(); }, pollMs);
    }
  };

  void poll();
  return () => {
    if (disposed) return;
    disposed = true;
    cancelPoll();
    dropCurrent();
  };
}
