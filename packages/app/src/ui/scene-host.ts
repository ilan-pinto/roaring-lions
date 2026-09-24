/**
 * The scene host: the lit diorama behind the main menu's column
 * (`docs/superpowers/specs/2026-09-24-scene-host-design.md`, §3.3-§3.6).
 *
 * This file is the thin DOM executor. What it DECIDES -- the path a visit
 * takes, what every lifecycle event does from every state, the parallax
 * arithmetic -- is `./scene-host-model.ts`, pure and tested row by row. What
 * it DRAWS is the door, `@lions/render/three-front`, reached by the one
 * dynamic import in `loadDoor()`. Everything here is wiring between the two:
 * build the element, ask the model, run the effects it names.
 *
 * ## The element
 *
 * `.rl-scene-host[aria-hidden=true]` slots in UNDER the menu column, in the
 * same stage the router clears, so the host leaves with the screen and never
 * becomes body-mounted chrome (the D-10 problem `ui:routes` exists for).
 * Inside it one `.rl-scene-host__layer`, oversized by `--host-bleed` and
 * translated for parallax, holds the plate `<img>` (the poster) and
 * `.rl-scene-host__stage`, the element the door appends its canvas to. The
 * stage stays at `opacity: 0` until `data-host="live"`: the door draws its
 * first frame into it BEFORE resolving, and that frame must not show early.
 *
 * ## What the DOM says (spec §3.6)
 *
 * `data-host` (`pending` -> `live` | `plate`; or `off`), `data-host-reason`,
 * `data-host-motion` (`animate` | `held` while live), `data-host-camera` and
 * `data-host-zoom` -- the values the door REPORTS through `onCamera`, never
 * recomputed here -- and `data-host-ms`, mount to terminal state.
 *
 * ## Teardown, and three things about it that read wrong and are not
 *
 * - **The host keeps its OWN `AbortController`** rather than taking the
 *   router's `req.signal`. The menu mounts synchronously, so the router
 *   always has this screen's disposer and always runs it; the disposer is
 *   the one place the host is taken down, deadline or leave.
 * - **It never waits on the door's promise.** After a mid-load abort the door
 *   may settle late or NEVER (a Draco decode torn down mid-flight never
 *   settles), so teardown is synchronous and the promise's handlers only
 *   ever feed the model. A late view lands on `plate`/`disposed` and the
 *   model's leak rows dispose it the moment it arrives.
 * - **A rejection after the host's own abort is silent, keyed off STATE.**
 *   The host aborts only on the way into `plate` (deadline) or `disposed`
 *   (leave), and the model ignores `failed` in both. Nothing here reads the
 *   error's abort reason: the door does not pass the caller's reason through.
 *
 * `view.dispose()` is wrapped and warns rather than throws. On a live leave
 * the door's own abort listener has already released everything, so the call
 * is a no-op there; it can throw only when no abort came first, and a throw
 * out of a router disposer would leave the stage half cleared.
 */
import type { Sim } from '@lions/sim';
import type { EmitterSpec, RendererOptions } from '@lions/render';
import type { MeshManifest } from '../mesh-catalogue';
import type { RendererChoice } from '../renderer-choice';
import type { Disposer } from '../shell/router';
import {
  CROSSFADE_MS,
  HOST_DEADLINE_MS,
  IDLE_START_TIMEOUT_MS,
  PARALLAX_SETTLE_EPS,
  PARALLAX_TAU_MS,
  easeToward,
  hostPath,
  hostStep,
  parallaxTarget,
  type HostEvent,
  type HostState,
  type PlateReason,
} from './scene-host-model';
import { webgl2Available } from './webgl-probe';

/**
 * Everything the door needs to draw the diorama, except the three things this
 * file supplies itself (`signal`, `onMotion`, `onCamera`) -- built by
 * `front/diorama.ts`'s `dioramaSceneOptions`.
 *
 * Restated from `@lions/render/three-front`'s `SceneHostOptions` rather than
 * imported: eslint forbids any static import of that door from this package,
 * type-only included, for the bundle reason in the rule's own message. The
 * restatement is checked, not trusted -- see `loadDoor()`. Every member the
 * door REQUIRES is restated, because a function's parameters are compared
 * contravariantly: a restatement missing one would fail that check.
 */
export interface SceneHostWorld {
  readonly sim: Sim;
  /** The mission's own options (`rendererOptionsFor`). */
  readonly renderer: RendererOptions;
  /** The door's `SceneHostMeshes`, field for field. */
  readonly meshes: MeshManifest;
  readonly decor: Uint8Array;
  readonly elevation: Uint8Array;
  readonly emitters: { list: EmitterSpec[]; resolve: (key: string) => string };
  readonly camera: { readonly x: number; readonly y: number };
  /** The zoom for a host layer of this CSS size (the cover law). */
  readonly zoomFor: (layerW: number, layerH: number) => number;
  /** Left at the door's default (30) in the app; see the door. */
  readonly fpsCap?: number;
}

export type SceneHostMotion = 'animate' | 'held';

export interface SceneHostCamera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

/** The half of the door's `SceneHostView` this file uses -- the
 *  `MountedView` pattern in `worldmap3d.ts`. */
export interface MountedSceneHost {
  readonly canvas: HTMLCanvasElement;
  dispose(): void;
}

/** The door's `mountSceneHost`, restated; `loadDoor()` is what checks it. */
export type MountSceneHostView = (
  host: HTMLElement,
  opts: SceneHostWorld & {
    readonly signal: AbortSignal;
    readonly onMotion?: (m: SceneHostMotion) => void;
    readonly onCamera?: (c: SceneHostCamera) => void;
  }
) => Promise<MountedSceneHost>;

/** What `sceneHost` needs. Every optional member is a test seam with a
 *  production default. */
export interface SceneHostDeps {
  /** `${BASE}${menuDiorama.plate}`: the poster, and the whole picture on a
   *  plate path. */
  readonly plateUrl: string;
  readonly renderer: RendererChoice;
  /** Built lazily, on the live path only: a Pixi or reduced-motion player
   *  never pays for a `Sim`. */
  readonly world: () => SceneHostWorld;
  readonly reducedMotion?: () => boolean;
  readonly saveData?: () => boolean;
  readonly webgl2?: () => boolean;
  /** Default: the dynamic import of the door. */
  readonly mount?: MountSceneHostView;
  /** Runs the live path's start; returns a cancel. */
  readonly schedule?: (fn: () => void) => () => void;
  /** The parallax easing loop's frame source. */
  readonly frame?: (cb: FrameRequestCallback) => number;
  readonly deadlineMs?: number;
  readonly now?: () => number;
}

/**
 * The one dynamic import of `@lions/render/three-front`. The assignment IS
 * the type check: `tsc` compares the real `mountSceneHost` against the
 * restated `MountSceneHostView` at that line, so a drifted restatement is a
 * compile error rather than a runtime surprise -- `worldmap3d.ts`'s
 * `loadView()` pattern.
 */
async function loadDoor(): Promise<MountSceneHostView> {
  const mod = await import('@lions/render/three-front');
  const mount: MountSceneHostView = mod.mountSceneHost;
  return mount;
}

/** `settings.ts` writes `data-motion` on the root; the OS preference is the
 *  media query. Either one means reduced motion. */
function defaultReducedMotion(): boolean {
  if (document.documentElement.dataset.motion === 'reduce') return true;
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** `navigator.connection.saveData`, where a browser has it (Chromium). */
function defaultSaveData(): boolean {
  try {
    const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
    return nav.connection?.saveData === true;
  } catch {
    return false;
  }
}

/** The first idle moment, but no later than `IDLE_START_TIMEOUT_MS`: the
 *  live path's work starts after the menu has painted (spec §3.3 (1)). */
function defaultSchedule(fn: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(fn, { timeout: IDLE_START_TIMEOUT_MS });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(fn, 0);
  return () => window.clearTimeout(id);
}

/** The bare global, looked up at CALL time, so the capture tools' freeze
 *  (which replaces `window.requestAnimationFrame`) stops this loop too. */
const defaultFrame = (cb: FrameRequestCallback): number => requestAnimationFrame(cb);

const div = (cls: string): HTMLDivElement => {
  const d = document.createElement('div');
  d.className = cls;
  return d;
};

/**
 * Mount the scene host under `column`, in `stage`, and return its disposer.
 * Idempotent disposer; nothing here ever throws out of it.
 */
export function sceneHost(stage: HTMLElement, column: HTMLElement, deps: SceneHostDeps): Disposer {
  const now = deps.now ?? (() => performance.now());
  const frame = deps.frame ?? defaultFrame;
  const t0 = now();

  const el = div('rl-scene-host');
  el.setAttribute('aria-hidden', 'true');
  const layer = div('rl-scene-host__layer');
  const hostStage = div('rl-scene-host__stage');
  layer.appendChild(hostStage);
  el.appendChild(layer);
  if (column.parentNode === stage) stage.insertBefore(el, column);
  else stage.prepend(el);

  // --- the decision (spec §3.4) --------------------------------------------
  // After the insert, so the column is measured where it actually stands.
  // The motion preference is read ONCE and kept: it decides the path, and it
  // also decides parallax on its own (below), because the path's order puts
  // Pixi first and a Pixi player can have asked for reduced motion too.
  const reduced = (deps.reducedMotion ?? defaultReducedMotion)();
  const decided = hostPath({
    renderer: deps.renderer,
    reducedMotion: reduced,
    saveData: (deps.saveData ?? defaultSaveData)(),
    viewportWidth: window.innerWidth,
    columnWidth: column.getBoundingClientRect().width,
    webgl2: deps.webgl2 ?? webgl2Available,
  });

  let state: HostState = decided.path === 'live' ? 'pending' : decided.path;
  let left = false;
  let view: MountedSceneHost | null = null;
  let motion: SceneHostMotion = 'animate';
  const controller = new AbortController();
  const cleanups: (() => void)[] = [];

  const stamp = (): void => {
    el.dataset.hostMs = String(Math.round(now() - t0));
  };

  // --- the poster ------------------------------------------------------------
  // Every path but `off`. A plate that fails to load is removed, never shown
  // broken -- and until Task 7 photographs it, it 404s on every visit.
  let plate: HTMLImageElement | null = null;
  if (decided.path !== 'off') {
    const img = document.createElement('img');
    img.className = 'rl-scene-host__plate';
    img.alt = '';
    img.decoding = 'async';
    img.addEventListener('error', () => {
      img.remove();
      if (plate === img) plate = null;
    });
    img.src = deps.plateUrl;
    layer.insertBefore(img, hostStage);
    plate = img;
  }

  // --- the effects the model names ------------------------------------------
  /** Once per visit: a plate path is entered once and never left but by the
   *  disposer, which says nothing. */
  const warnPlate = (reason: PlateReason, err?: unknown): void => {
    const msg = `[lions] scene host: keeping the plate (${reason})`;
    if (err === undefined) console.warn(msg);
    else console.warn(msg, err);
  };

  const disposeView = (v: MountedSceneHost | null): void => {
    if (v === null) return;
    try {
      v.dispose();
    } catch (err) {
      console.warn('[lions] scene host: disposing its view threw:', err);
    }
  };

  let deadline: ReturnType<typeof setTimeout> | null = null;
  const clearDeadline = (): void => {
    if (deadline !== null) clearTimeout(deadline);
    deadline = null;
  };
  let crossfade: ReturnType<typeof setTimeout> | null = null;

  /** Feed one event to the model and run what it says. `arriving` is the view
   *  a `ready` delivered; any other `dispose-view` is of the view held. */
  const feed = (event: HostEvent, arriving: MountedSceneHost | null = null, err?: unknown): void => {
    const step = hostStep(state, event);
    state = step.state;
    for (const effect of step.effects) {
      switch (effect) {
        case 'reveal':
          view = arriving;
          clearDeadline();
          el.dataset.host = 'live';
          el.dataset.hostMotion = motion;
          stamp();
          crossfade = setTimeout(() => {
            crossfade = null;
            plate?.remove();
            plate = null;
          }, CROSSFADE_MS);
          break;
        case 'keep-plate':
          clearDeadline();
          el.dataset.host = 'plate';
          if (step.reason !== undefined) el.dataset.hostReason = step.reason;
          stamp();
          break;
        case 'warn':
          warnPlate(step.reason ?? 'load-failed', err);
          break;
        case 'abort':
          controller.abort();
          break;
        case 'dispose-view':
          if (arriving !== null) {
            disposeView(arriving);
          } else {
            const held = view;
            view = null;
            disposeView(held);
          }
          break;
      }
    }
  };

  // --- the path --------------------------------------------------------------
  if (decided.path === 'off') {
    el.dataset.host = 'off';
    el.dataset.hostReason = decided.reason;
    stamp();
  } else if (decided.path === 'plate') {
    el.dataset.host = 'plate';
    el.dataset.hostReason = decided.reason;
    stamp();
    warnPlate(decided.reason);
  } else {
    el.dataset.host = 'pending';
    deadline = setTimeout(() => {
      deadline = null;
      feed({ type: 'deadline' });
    }, deps.deadlineMs ?? HOST_DEADLINE_MS);

    const onCamera = (c: SceneHostCamera): void => {
      if (state !== 'pending' && state !== 'live') return;
      el.dataset.hostCamera = `${c.x},${c.y}`;
      el.dataset.hostZoom = c.zoom.toFixed(3);
    };
    const onMotion = (m: SceneHostMotion): void => {
      motion = m;
      if (state === 'live') el.dataset.hostMotion = m;
    };

    const start = async (): Promise<void> => {
      if (state !== 'pending') return;
      // The import and the world build overlap: one is network, the other CPU.
      const door = deps.mount !== undefined ? Promise.resolve(deps.mount) : loadDoor();
      door.catch(() => undefined); // read below; never an unhandled rejection
      let world: SceneHostWorld;
      let mount: MountSceneHostView;
      try {
        world = deps.world();
        mount = await door;
      } catch (err) {
        feed({ type: 'failed' }, null, err);
        return;
      }
      // Left, or past the deadline, while the import was in flight.
      if (state !== 'pending') return;
      let loading: Promise<MountedSceneHost>;
      try {
        loading = mount(hostStage, { ...world, signal: controller.signal, onMotion, onCamera });
      } catch (err) {
        feed({ type: 'failed' }, null, err);
        return;
      }
      // Never awaited by teardown (header). These handlers only feed the
      // model, which disposes a view nobody wants the moment it arrives.
      loading.then(
        (v) => feed({ type: 'ready' }, v),
        (err: unknown) => feed({ type: 'failed' }, null, err)
      );
    };
    cleanups.push((deps.schedule ?? defaultSchedule)(() => void start()));
  }

  // --- parallax (spec §3.5) --------------------------------------------------
  // Every path but `off`, and never under reduced motion -- keyed off the
  // PREFERENCE, not the plate's reason: Pixi + reduced motion reads reason
  // `pixi` and must not move either. The picture moves; the camera does not.
  // Mouse only: touch and pen never move it.
  if (decided.path !== 'off' && !reduced) {
    const cur = { x: 0, y: 0 };
    let tgt = { x: 0, y: 0 };
    let running = false;
    let last: number | null = null;
    const write = (): void => {
      el.style.setProperty('--host-dx', cur.x.toFixed(4));
      el.style.setProperty('--host-dy', cur.y.toFixed(4));
    };
    const tick = (t: number): void => {
      if (left) return;
      // The first frame after a (re)start has no previous one to measure from.
      const dt = last === null ? 0 : t - last;
      last = t;
      cur.x = easeToward(cur.x, tgt.x, dt, PARALLAX_TAU_MS);
      cur.y = easeToward(cur.y, tgt.y, dt, PARALLAX_TAU_MS);
      const settled = Math.abs(cur.x - tgt.x) < PARALLAX_SETTLE_EPS && Math.abs(cur.y - tgt.y) < PARALLAX_SETTLE_EPS;
      if (settled) {
        cur.x = tgt.x;
        cur.y = tgt.y;
      }
      write();
      if (settled) {
        running = false;
        last = null;
        return;
      }
      frame(tick);
    };
    const kick = (): void => {
      if (running || left) return;
      running = true;
      last = null;
      frame(tick);
    };
    const onMove = (e: PointerEvent): void => {
      if (e.pointerType !== 'mouse') return;
      tgt = parallaxTarget(e.clientX, e.clientY, window.innerWidth, window.innerHeight);
      kick();
    };
    // The pointer leaving the window eases the picture back to centre.
    const onLeave = (): void => {
      tgt = { x: 0, y: 0 };
      kick();
    };
    const root = document.documentElement;
    window.addEventListener('pointermove', onMove);
    root.addEventListener('mouseleave', onLeave);
    cleanups.push(() => {
      window.removeEventListener('pointermove', onMove);
      root.removeEventListener('mouseleave', onLeave);
    });
  }

  return () => {
    if (left) return;
    left = true;
    for (const c of cleanups.splice(0)) c();
    clearDeadline();
    if (crossfade !== null) clearTimeout(crossfade);
    crossfade = null;
    el.remove();
    feed({ type: 'dispose' });
  };
}
