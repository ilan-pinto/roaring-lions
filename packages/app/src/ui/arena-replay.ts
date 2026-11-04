/**
 * The DEV-only `/arena/replay` screen (GH-954 W3): run a recorded arena game again, at 0.5x to 8x, on the spectator
 * battlefield. It is handed a file NAME (`?game=<name>`, one the results list gave out); the arena server checks the
 * name against its directory and refuses a build the file was not recorded on. This module is reached only by a
 * dynamic `import()` inside `import.meta.env.DEV` in `main.ts`, so a production build has no route, API path, key
 * header or replay module (`tools/src/net/arena-build.test.ts` builds the app and pins that).
 *
 * What it guarantees:
 * - No input-to-command path. The battlefield is booted with `spectate`, whose command sink drops every order, and
 *   the transport under it (`ReplayTransport`) has nowhere to send one. Fog opens on Both sides.
 * - The sim is stepped by the recorded frames, one tick a frame, in order. The speed buttons change only how many
 *   of them are released per animation frame (`replay-transport.ts`), never which, so the end state is the
 *   same at every speed.
 * - The speed buttons name the speed ASKED for. A machine that cannot step the sim that fast is not hidden: once a second
 *   the page measures the ticks it really ran and, when that is under 90% of the speed asked, says "Running at 2.3x".
 * - At the end it compares the page's own `sim.hash()` with the one the referee recorded and says whether the
 *   replay ended in the referee's state.
 * - The disposer contract: leaving aborts a fetch in flight, disposes the battlefield (a boot that lands after the
 *   page is gone is disposed the moment it lands), removes the strip and the stage and empties the host.
 *
 * Every string goes through `t()`; player names, the map and the numbers are data.
 */
import { denseFrames, type ReplayDigest, type ReplayFile } from '../net/replay-file';
import { fetchReplay, ResultsRefused } from '../net/arena-results-api';
import { isReplaySpeed, REPLAY_SPEEDS, ReplayTransport, type ReplaySpeed } from '../net/replay-transport';
import { stripText, viewerFor, type SpectateHooks, type SpectatorHandle, type SpectatorReading, type ViewChoice } from '../net/spectator';
import type { Connected } from '../net/connect';
import { t } from '../i18n/t';
import type { Disposer } from '../shell/router';
import { mountArenaStrip } from './arena-strip';

/** What `bootBattlefield` is handed for a replayed game: the same shape as a watched one. */
export interface ReplaySpectate {
  connect(signal: AbortSignal): Promise<Connected>;
  hooks: SpectateHooks;
  capTicks: number;
}

export interface ArenaReplayDeps {
  /** The run's key from the URL fragment; null: the page was not opened from the printed link. */
  key: string | null;
  /** The file name from the results list (`?game=`), or null. */
  game: string | null;
  fetch: typeof fetch;
  /** Boots a spectated battlefield on `stage` for `map`; resolves with its disposer. */
  boot(stage: HTMLElement, signal: AbortSignal, spectate: ReplaySpectate, map: string): Promise<Disposer>;
  /** Back to the results list. */
  back(): void;
  /** For a spec. */
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (h: unknown) => void;
}

const STRIP_MS = 250;

/** The message key for a refusal. */
export function replayErrorKey(status: number, code: string | null): string {
  if (status === 0) return 'arena.replay.err.noServer';
  if (status === 403 || status === 421) return 'arena.replay.err.refused';
  switch (code) {
    case 'build_mismatch': return 'arena.replay.err.build';
    case 'bad_name': case 'not_found': return 'arena.replay.err.notFound';
    case 'incomplete': return 'arena.replay.err.incomplete';
    default: return 'arena.replay.err.bad';
  }
}

/** The digest line at the end: whether the page's sim ended where the referee's did. */
export function digestText(replay: ReadonlyDigest, referee: ReadonlyDigest): { same: boolean; text: string } {
  const same = replay.tick === referee.tick && replay.hash === referee.hash;
  return same
    ? { same, text: t('arena.replay.digest.same', { tick: referee.tick }) }
    : { same, text: t('arena.replay.digest.differs', { tick: replay.tick, refTick: referee.tick, hash: hex(replay.hash), refHash: hex(referee.hash) }) };
}
type ReadonlyDigest = Readonly<ReplayDigest>;
const hex = (n: number): string => (n >>> 0).toString(16).padStart(8, '0');

export function showArenaReplay(host: HTMLElement, deps: ArenaReplayDeps): Disposer {
  const now = deps.now ?? ((): number => performance.now());
  const setIv = deps.setInterval ?? ((fn: () => void, ms: number): unknown => setInterval(fn, ms));
  const clearIv = deps.clearInterval ?? ((h: unknown): void => { clearInterval(h as ReturnType<typeof setInterval>); });
  const ac = new AbortController();
  let disposed = false;
  let timer: unknown = null;
  let strip: ReturnType<typeof mountArenaStrip> | null = null;
  let stage: HTMLElement | null = null;
  let disposeBattlefield: Disposer = () => {};
  let transport: ReplayTransport | null = null;

  // The notice shown when there is nothing to replay: the page's own words, never the server's.
  const root = document.createElement('section');
  root.className = 'rl-arena-setup rl-arena-replay-notice';
  const title = document.createElement('h1');
  title.className = 'rl-arena-setup__title';
  title.textContent = t('arena.replay.title');
  const message = document.createElement('p');
  message.className = 'rl-arena-setup__message';
  message.setAttribute('role', 'status');
  message.setAttribute('aria-live', 'polite');
  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'rl-arena-setup__watch';
  backBtn.textContent = t('arena.replay.back');
  backBtn.addEventListener('click', () => { if (!disposed) deps.back(); });
  root.append(title, message, backBtn);
  host.appendChild(root);
  const say = (text: string, bad = false): void => {
    message.textContent = text;
    message.classList.toggle('rl-bad', bad);
  };
  const dispose: Disposer = () => {
    if (disposed) return;
    disposed = true;
    if (timer !== null) clearIv(timer);
    ac.abort();
    strip?.dispose();
    try { disposeBattlefield(); } finally {
      stage?.remove();
      transport?.close();
      host.replaceChildren();
    }
  };

  if (deps.key === null) { say(t('arena.replay.noKey'), true); return dispose; }
  if (deps.game === null) { say(t('arena.replay.err.notFound'), true); return dispose; }
  say(t('arena.replay.loading'));

  fetchReplay({ fetch: deps.fetch, key: deps.key, signal: ac.signal }, deps.game).then(({ replay }) => {
    if (disposed) return;
    start(replay);
  }, (err: unknown) => {
    if (disposed || (err instanceof DOMException && err.name === 'AbortError')) return;
    if (err instanceof ResultsRefused) {
      say(t(replayErrorKey(err.status, err.code), { file: err.detail.fileBuild ?? t('arena.replay.err.unknownBuild'), build: err.detail.build ?? t('arena.replay.err.unknownBuild') }), true);
    } else say(t('arena.replay.err.noServer'), true);
  });

  function start(replay: ReplayFile): void {
    const frames = denseFrames(replay);
    const tr = new ReplayTransport(frames, { now });
    transport = tr;
    const config = replay.header.config;
    let view: ViewChoice = 'all';
    let handle: SpectatorHandle | null = null;
    let reading: SpectatorReading | null = null;
    let ended = false;
    let result: { same: boolean; text: string } | null = null;

    // --- the replay's own controls, inside the strip ---------------------------------------------------------------
    const controls = document.createElement('div');
    controls.className = 'rl-arena-replay';
    const pauseBtn = document.createElement('button');
    pauseBtn.type = 'button';
    pauseBtn.className = 'rl-arena-strip__view rl-arena-replay__pause';
    const speeds = document.createElement('div');
    speeds.className = 'rl-arena-strip__views rl-arena-replay__speeds';
    speeds.setAttribute('role', 'radiogroup');
    speeds.setAttribute('aria-label', t('arena.replay.speed'));
    const speedBtns = new Map<ReplaySpeed, HTMLButtonElement>();
    for (const s of REPLAY_SPEEDS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rl-arena-strip__view';
      b.dataset.speed = String(s);
      b.setAttribute('role', 'radio');
      b.textContent = t('arena.replay.speedOption', { speed: s });
      b.addEventListener('click', () => { if (!disposed && isReplaySpeed(s)) { tr.setSpeed(s); paint(); } });
      speedBtns.set(s, b);
      speeds.appendChild(b);
    }
    const progress = document.createElement('span');
    progress.className = 'rl-arena-replay__progress';
    const actual = document.createElement('span');
    actual.className = 'rl-arena-replay__actual';
    actual.hidden = true;
    const digest = document.createElement('span');
    digest.className = 'rl-arena-replay__digest';
    controls.append(pauseBtn, speeds, progress, actual, digest);
    pauseBtn.addEventListener('click', () => { if (!disposed) { tr.setPaused(!tr.paused); paint(); } });

    strip = mountArenaStrip(document.body, {
      onView: (c) => {
        view = c;
        if (handle !== null && reading !== null) handle.setViewer(viewerFor(c, reading.config.seats));
        paint();
      },
      onStop: () => deps.back(),
      stopLabel: t('arena.replay.back'),
      extra: controls,
    });

    // The measured speed: ticks run per second of wall time, in units of 20 a second. Reset whenever what is asked changes.
    let sample: { tick: number; ms: number; speed: number } | null = null;
    let achieved: number | null = null;
    const measure = (tick: number): void => {
      const at = now();
      if (tr.paused || ended) { sample = null; achieved = null; return; }
      if (sample === null || sample.speed !== tr.speed) { sample = { tick, ms: at, speed: tr.speed }; achieved = null; return; }
      if (at - sample.ms < 1000) return;
      achieved = ((tick - sample.tick) / (at - sample.ms)) * 1000 / 20;
      sample = { tick, ms: at, speed: tr.speed };
    };
    const paint = (): void => {
      if (disposed) return;
      const tick = reading?.tick ?? 0;
      const sides: [0 | 1, 0 | 1] = [config.seats[0].side, config.seats[1].side];
      strip?.update(stripText({
        phase: ended ? 'finished' : 'playing', n: replay.header.game.n, of: replay.header.game.of, labels: replay.header.labels,
        score: reading?.score ?? null, sides, tick, roundTicks: Math.max(1, replay.header.game.pace),
        // A replay waits on nobody: a paused one is paused, not "waiting on the players".
        waiting: false,
        verdict: ended ? { outcome: replay.end.outcome, by: replay.end.by } : null,
        view,
      }));
      pauseBtn.textContent = tr.paused ? t('arena.replay.play') : t('arena.replay.pause');
      pauseBtn.setAttribute('aria-pressed', String(tr.paused));
      for (const [s, b] of speedBtns) b.setAttribute('aria-checked', String(s === tr.speed));
      progress.textContent = t('arena.replay.progress', { tick, total: replay.end.ticks });
      const slow = achieved !== null && achieved < tr.speed * 0.9;
      actual.hidden = !slow;
      actual.textContent = slow && achieved !== null ? t('arena.replay.actual', { speed: Math.round(achieved * 10) / 10 }) : '';
      digest.textContent = result === null ? '' : result.text;
      digest.classList.toggle('rl-good', result?.same === true);
      digest.classList.toggle('rl-bad', result?.same === false);
      digest.hidden = result === null;
    };
    const read = (): void => {
      reading = handle?.read() ?? null;
      if (reading !== null) measure(reading.tick);
      paint();
    };

    const hooks: SpectateHooks = {
      onReady: (h) => {
        handle = h;
        read();
      },
      // The game is over on the page (the recorded result, or the last frame): its sim is where the replay ended.
      onEnd: () => {
        ended = true;
        if (handle !== null) result = digestText(handle.digest(), replay.end.referee);
        read();
      },
    };

    root.remove();
    const st = document.createElement('div');
    st.className = 'rl-arena-stage';
    host.appendChild(st);
    stage = st;
    const spectate: ReplaySpectate = {
      // The recorded frames, and the config the referee ran them under. Nothing here opens a socket.
      connect: () => Promise.resolve({ transport: tr, seat: 0, config }),
      hooks,
      // The replay stops exactly where the referee did.
      capTicks: replay.end.ticks,
    };
    paint();
    timer = setIv(read, STRIP_MS);
    deps.boot(st, ac.signal, spectate, replay.header.game.map).then((d) => {
      // The page was left while the battlefield was booting: it is disposed the moment it lands.
      if (disposed) d(); else disposeBattlefield = d;
    }, (err: unknown) => {
      if (disposed || (err instanceof DOMException && err.name === 'AbortError')) return;
      console.warn('arena replay: the battlefield could not be shown', err);
      host.appendChild(root);
      say(t('arena.replay.err.boot'), true);
    });
  }

  return dispose;
}
