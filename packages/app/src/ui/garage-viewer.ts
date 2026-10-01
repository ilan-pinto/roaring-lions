// The garage bay's turnable model (GH-316): the DOM half.
//
// The bay used to show a screenshot plate (`pnpm plates:units`). It now shows
// the unit's own GLB, drawn by `@lions/render/three-garage`, turned by drag
// and by the arrow keys, and turning itself slowly after five quiet seconds.
// The plate is still built first and stays the picture until the model's
// first frame is ready, and it is what the bay keeps -- with the reason
// warned by name, as the campaign board does -- whenever the model cannot be
// drawn:
//
//   * `?renderer=pixi`. Not a failure, and not warned: the player chose the
//     escape hatch, and the campaign board's rule is that it never downloads
//     three behind their back for a menu.
//   * The unit has no mesh.
//   * No WebGL2, probed BEFORE the dynamic import (`webgl-probe.ts`), so a
//     browser that cannot draw it never fetches three.
//   * The GLB will not load, or the view throws while it builds.
//   * The browser takes the context away while it is up.
//
// ## Who owns what
//
// The door draws, and only when told. The turn -- angle, drag, keys, the
// quiet clock, which frames get drawn at all -- is `garage-turn.ts`. This
// file is the wiring between the two and the focusable element the player
// works it through: `role="slider"`, labelled with the unit's name and how
// to turn it, the theme's own `:focus-visible` ring.
//
// ## The restated door type, and what checks it
//
// eslint forbids any static import of `@lions/render/three-garage` here,
// type-only included (the standing bundle rule), so `MountGarageView` below
// restates it. `loadDoor()` assigns the real `mountGarageView` INTO that
// type, so `tsc` compares the two and a drifted restatement is a compile
// error -- the `worldmap3d.ts` pattern.
//
// ## Leaving
//
// `dispose()` is synchronous and never waits on the door: it aborts the
// door's signal (before the context exists that is the whole teardown; after,
// the door's own abort listener releases the context at once), and a view
// that resolves after a leave is disposed the moment it lands. The scene
// host's soft-leave rule, and `pnpm ui:routes` checks it.
import { t } from '../i18n/t';
import type { MeshFactionName } from '../mesh-catalogue';
import type { RendererChoice } from '../renderer-choice';
import { DRAG_DEG_PER_PX, KEY_STEP_DEG, PAGE_STEP_DEG, TurnController } from './garage-turn';
import { webgl2Available } from './webgl-probe';

/** Which GLB draws a unit, and through which path. */
export interface ModelSource {
  readonly kind: 'rigged' | 'vehicle';
  readonly url: string;
  readonly faction?: MeshFactionName;
}

/** The door's `GarageColors`, restated: hex strings the app resolved from
 *  palette keys. */
export interface GarageColors {
  readonly key: string;
  readonly fill: string;
  readonly sky: string;
  readonly bounce: string;
  readonly ground: string;
}

/** The half of the door's `GarageView` this file uses. */
export interface MountedGarageView {
  readonly canvas: HTMLCanvasElement;
  readonly info: { readonly pose: string; readonly figures: number };
  stats(): { readonly frames: number; readonly calls: number; readonly triangles: number };
  draw(yawDeg: number): void;
  resize(): void;
  dispose(): void;
}

/** The door's `mountGarageView`, restated; `loadDoor()` checks it. */
export type MountGarageView = (
  host: HTMLElement,
  opts: {
    readonly typeId: string;
    readonly kind: 'rigged' | 'vehicle';
    readonly meshUrl: string;
    readonly faction?: MeshFactionName;
    readonly dracoDecoderPath?: string;
    readonly groundTextureUrl?: string;
    readonly colors: GarageColors;
    readonly signal?: AbortSignal;
    readonly onContextLost?: () => void;
  }
) => Promise<MountedGarageView>;

async function loadDoor(): Promise<MountGarageView> {
  const mod = await import('@lions/render/three-garage');
  // This assignment is the type check. See the file header.
  const mount: MountGarageView = mod.mountGarageView;
  return mount;
}

/** Everything the bay needs to draw a model, from `main.ts`. Every member
 *  after `colors` is a test seam with a production default. */
export interface GarageModelDeps {
  /** The unit's GLB, or `null` for a unit with none. */
  readonly source: (typeId: string) => ModelSource | null;
  readonly renderer: RendererChoice;
  readonly dracoDecoderPath: string;
  readonly groundTextureUrl: string;
  readonly colors: GarageColors;
  readonly webgl?: () => boolean;
  readonly mount?: MountGarageView;
  /** How long a selection must stay before its model starts loading
   *  (`MOUNT_DELAY_MS`); a test passes 0. */
  readonly mountDelayMs?: number;
  readonly reducedMotion?: () => boolean;
  readonly frame?: (cb: (now: number) => void) => number;
  readonly cancelFrame?: (id: number) => void;
  readonly setTimer?: (fn: () => void, ms: number) => number;
  readonly clearTimer?: (id: number) => void;
}

/** Why a bay kept its plate. `pixi` is a choice, every other one a fault. */
export type PlateReason = 'pixi' | 'no-mesh' | 'no-webgl2' | 'load-failed' | 'context-lost';

export interface GarageModelHandle {
  /** The focusable control the canvas lives in. */
  readonly el: HTMLElement;
  readonly unitId: string;
  /** `model` once the first frame is up; `plate` (and why) otherwise. A
   *  handle disposed before either resolves `plate` with no reason. */
  readonly ready: Promise<{ shown: 'model' | 'plate'; reason?: PlateReason }>;
  /** Move into a rebuilt plate (a purchase redraws the bay around the same
   *  unit): the same canvas, the same context, the same angle. */
  adopt(plate: HTMLElement): void;
  dispose(): void;
}

/**
 * A unit must stay selected this long before its model starts loading.
 * Paging down the rail by keyboard selects a unit every key repeat (~30 ms);
 * without this each one would start a GLB fetch and a Draco decode for a bay
 * already left. 150 ms is under what a player reads as a delay against a
 * load that takes 140-400 ms anyway (the mock's mount cost).
 */
export const MOUNT_DELAY_MS = 150;

/** `fn`, asked once and then remembered. */
export function memoise<T>(fn: () => T): () => T {
  let known = false;
  let value: T;
  return () => {
    if (!known) {
      value = fn();
      known = true;
    }
    return value;
  };
}

/** The WebGL2 probe, once per page: whether the browser can draw it does not
 *  change between one unit and the next, and each probe is a context made
 *  and lost. */
const webgl2Once = memoise(webgl2Available);

/** The bare globals, looked up at CALL time, so a capture tool's frame-loop
 *  freeze stops this too (`scene-host.ts`'s `defaultFrame`). */
const defaultFrame = (cb: (now: number) => void): number => requestAnimationFrame(cb);
const defaultCancel = (id: number): void => cancelAnimationFrame(id);
const defaultSetTimer = (fn: () => void, ms: number): number => window.setTimeout(fn, ms);
const defaultClearTimer = (id: number): void => window.clearTimeout(id);

/**
 * Start drawing `unit`'s model into `plate`, over the plate's own picture.
 * Synchronous: the element is in the bay at once (unfocusable until the
 * model is up) and `ready` settles when the load does.
 */
export function garageModel(
  plate: HTMLElement,
  unit: { readonly id: string; readonly name: string },
  deps: GarageModelDeps
): GarageModelHandle {
  const el = document.createElement('div');
  el.className = 'rl-garage__model';
  let host: HTMLElement = plate;
  host.prepend(el);
  /** What the bay shows, mirrored onto `data-model` on whichever plate the
   *  handle currently lives in. */
  let state: 'pending' | 'live' | 'plate' = 'pending';
  let plateReason: PlateReason | null = null;
  const mark = (): void => {
    host.dataset.model = state;
    if (plateReason !== null) host.dataset.modelReason = plateReason;
  };
  mark();

  const controller = new AbortController();
  let disposed = false;
  let view: MountedGarageView | null = null;
  let turn: TurnController | null = null;
  let resizeWatch: ResizeObserver | null = null;
  const off: (() => void)[] = [];
  /** Ends the mount's debounce wait at once, so a handle disposed inside it
   *  still settles `ready`. */
  let wakeEarly: (() => void) | null = null;

  const keepPlate = (reason: PlateReason, err?: unknown): { shown: 'plate'; reason: PlateReason } => {
    if (reason === 'pixi') {
      // A choice, not a fault: said once, at `info`, never as a warning.
      console.info(`garage model: ?renderer=pixi -- showing ${unit.id}'s plate, not its three.js model`);
    } else {
      const why =
        reason === 'no-mesh'
          ? `${unit.id} has no mesh`
          : reason === 'no-webgl2'
            ? 'this browser has no WebGL2'
            : reason === 'context-lost'
              ? `the WebGL context drawing ${unit.id} was lost`
              : `could not draw ${unit.id}'s model`;
      if (err !== undefined) console.warn(`garage model: ${why} -- showing its plate`, err);
      else console.warn(`garage model: ${why} -- showing its plate`);
    }
    teardown();
    state = 'plate';
    plateReason = reason;
    mark();
    return { shown: 'plate', reason };
  };

  function teardown(): void {
    for (const f of off.splice(0)) f();
    resizeWatch?.disconnect();
    resizeWatch = null;
    turn?.dispose();
    turn = null;
    controller.abort();
    if (view) {
      const v = view;
      view = null;
      try {
        v.dispose();
      } catch (err) {
        console.warn('garage model: dispose threw', err);
      }
    }
    el.remove();
  }

  const listen = <K extends keyof HTMLElementEventMap>(
    type: K,
    fn: (ev: HTMLElementEventMap[K]) => void
  ): void => {
    el.addEventListener(type, fn);
    off.push(() => el.removeEventListener(type, fn));
  };

  /** The live control: focusable, labelled, turned by drag and keys. */
  function goLive(v: MountedGarageView): void {
    view = v;
    /** Frames the view has drawn, mirrored onto `data-frames` after each
     *  draw -- which is only ever on demand -- so a harness in a real browser
     *  can prove an idle bay draws nothing (`pnpm ui:routes`). */
    const countFrames = (): void => {
      if (view) el.dataset.frames = String(view.stats().frames);
    };
    /** The value a screen reader reads: on player input only (see
     *  `TurnDeps.onTurn`). */
    const sayAngle = (deg: number): void => {
      const n = Math.round(deg) % 360;
      el.setAttribute('aria-valuenow', String(n));
      el.setAttribute('aria-valuetext', t('garage.model.valuetext', { n }));
    };
    const tc = new TurnController({
      draw: (deg) => {
        view?.draw(deg);
        countFrames();
      },
      frame: deps.frame ?? defaultFrame,
      cancelFrame: deps.cancelFrame ?? defaultCancel,
      setTimer: deps.setTimer ?? defaultSetTimer,
      clearTimer: deps.clearTimer ?? defaultClearTimer,
      reducedMotion: deps.reducedMotion ?? (() => false),
      onTurn: sayAngle,
    });
    turn = tc;
    countFrames();
    el.tabIndex = 0;
    el.setAttribute('role', 'slider');
    el.setAttribute('aria-label', t('garage.model.label', { name: unit.name }));
    el.setAttribute('aria-valuemin', '0');
    el.setAttribute('aria-valuemax', '359');
    sayAngle(0);
    el.dataset.focusKey = 'model';
    const hint = document.createElement('span');
    hint.className = 'rl-garage__model-hint rl-plate';
    hint.setAttribute('aria-hidden', 'true');
    hint.textContent = t('garage.model.hint');
    el.appendChild(hint);

    // Drag. Pointer capture, so a drag that leaves the bay still turns.
    let dragX: number | null = null;
    let pointer = -1;
    listen('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      dragX = ev.clientX;
      pointer = ev.pointerId;
      el.setPointerCapture?.(ev.pointerId);
      el.dataset.dragging = '1';
      tc.hold();
    });
    listen('pointermove', (ev) => {
      if (dragX === null || ev.pointerId !== pointer) return;
      const dx = ev.clientX - dragX;
      dragX = ev.clientX;
      if (dx !== 0) tc.turnBy(dx * DRAG_DEG_PER_PX);
    });
    const endDrag = (ev: PointerEvent): void => {
      if (dragX === null || ev.pointerId !== pointer) return;
      dragX = null;
      pointer = -1;
      delete el.dataset.dragging;
      tc.release();
    };
    listen('pointerup', endDrag);
    listen('pointercancel', endDrag);
    listen('lostpointercapture', endDrag);

    // Keys, the ARIA slider set: Right/Up turn one step, Left/Down one step
    // back, PageUp/PageDown a bigger one, Home to the default face. A turn
    // has no maximum to go to, so End shows the far side (180). Right turns
    // the near side to the right, like a drag to the right.
    const KEY_TURN: Readonly<Record<string, number>> = {
      ArrowRight: KEY_STEP_DEG,
      ArrowUp: KEY_STEP_DEG,
      ArrowLeft: -KEY_STEP_DEG,
      ArrowDown: -KEY_STEP_DEG,
      PageUp: PAGE_STEP_DEG,
      PageDown: -PAGE_STEP_DEG,
    };
    listen('keydown', (ev) => {
      const step = KEY_TURN[ev.key];
      if (step !== undefined) tc.turnBy(step);
      else if (ev.key === 'Home') tc.turnTo(0);
      else if (ev.key === 'End') tc.turnTo(180);
      else return;
      ev.preventDefault();
      ev.stopPropagation();
    });

    // No auto-turn while the control has focus: a model that keeps moving
    // under a player's keys, or under a screen reader, is the wrong answer.
    listen('focus', () => tc.focus(true));
    listen('blur', () => tc.focus(false));

    // Reduced motion switched while the garage is open -- by the shell's own
    // setting (`data-motion` on the root) or by the OS. Off again restarts
    // the auto-turn's clock; on stops it where it is.
    const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    const onMotion = (): void => tc.motionChanged();
    if (media && typeof media.addEventListener === 'function') {
      media.addEventListener('change', onMotion);
      off.push(() => media.removeEventListener('change', onMotion));
    }
    if (typeof MutationObserver !== 'undefined') {
      const watch = new MutationObserver(onMotion);
      watch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });
      off.push(() => watch.disconnect());
    }

    if (typeof ResizeObserver !== 'undefined') {
      resizeWatch = new ResizeObserver(() => {
        view?.resize();
        turn?.redraw();
      });
      resizeWatch.observe(el);
    }
    state = 'live';
    mark();
  }

  const ready = (async (): Promise<{ shown: 'model' | 'plate'; reason?: PlateReason }> => {
    if (deps.renderer === 'pixi') return keepPlate('pixi');
    const source = deps.source(unit.id);
    if (source === null) return keepPlate('no-mesh');
    if (!(deps.webgl ?? webgl2Once)()) return keepPlate('no-webgl2');
    // The debounce: a unit paged past inside `MOUNT_DELAY_MS` never fetches.
    const delay = deps.mountDelayMs ?? MOUNT_DELAY_MS;
    if (delay > 0) {
      await new Promise<void>((resolve) => {
        const id = (deps.setTimer ?? defaultSetTimer)(resolve, delay);
        wakeEarly = () => {
          (deps.clearTimer ?? defaultClearTimer)(id);
          resolve();
        };
      });
      wakeEarly = null;
      if (disposed) return { shown: 'plate' };
    }
    try {
      const mount = deps.mount ?? (await loadDoor());
      if (disposed) return { shown: 'plate' };
      const v = await mount(el, {
        typeId: unit.id,
        kind: source.kind,
        meshUrl: source.url,
        faction: source.faction,
        dracoDecoderPath: deps.dracoDecoderPath,
        groundTextureUrl: deps.groundTextureUrl,
        colors: deps.colors,
        signal: controller.signal,
        onContextLost: () => {
          if (!disposed) keepPlate('context-lost');
        },
      });
      // Left (or paged on) while it mounted: the soft-leave rule.
      if (disposed) {
        v.dispose();
        return { shown: 'plate' };
      }
      goLive(v);
      return { shown: 'model' };
    } catch (err) {
      // The bay was left and the door gave up on purpose, with no context
      // made. Nothing to report.
      if (disposed || controller.signal.aborted) return { shown: 'plate' };
      return keepPlate('load-failed', err);
    }
  })();

  return {
    el,
    unitId: unit.id,
    ready,
    adopt(next) {
      if (disposed) return;
      host = next;
      if (state !== 'plate') next.prepend(el);
      mark();
      turn?.redraw();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      wakeEarly?.();
      teardown();
    },
  };
}
