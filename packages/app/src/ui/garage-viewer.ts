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
import { DRAG_DEG_PER_PX, KEY_STEP_DEG, TurnController } from './garage-turn';
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

  const keepPlate = (reason: PlateReason, err?: unknown): { shown: 'plate'; reason: PlateReason } => {
    if (reason !== 'pixi') {
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
    const tc = new TurnController({
      draw: (deg) => view?.draw(deg),
      frame: deps.frame ?? defaultFrame,
      cancelFrame: deps.cancelFrame ?? defaultCancel,
      setTimer: deps.setTimer ?? defaultSetTimer,
      clearTimer: deps.clearTimer ?? defaultClearTimer,
      reducedMotion: deps.reducedMotion ?? (() => false),
      onTurn: (deg) => el.setAttribute('aria-valuenow', String(Math.round(deg) % 360)),
    });
    turn = tc;
    el.tabIndex = 0;
    el.setAttribute('role', 'slider');
    el.setAttribute('aria-label', t('garage.model.label', { name: unit.name }));
    el.setAttribute('aria-valuemin', '0');
    el.setAttribute('aria-valuemax', '359');
    el.setAttribute('aria-valuenow', '0');
    el.dataset.focusKey = 'model';
    const hint = document.createElement('span');
    hint.className = 'rl-garage__model-hint';
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

    // Keys: Left/Right turn, Home goes back to the default face. Turning
    // right drags the near side to the right, like a drag to the right.
    listen('keydown', (ev) => {
      if (ev.key === 'ArrowRight') tc.turnBy(KEY_STEP_DEG);
      else if (ev.key === 'ArrowLeft') tc.turnBy(-KEY_STEP_DEG);
      else if (ev.key === 'Home') tc.turnTo(0);
      else return;
      ev.preventDefault();
      ev.stopPropagation();
    });

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
    if (!(deps.webgl ?? webgl2Available)()) return keepPlate('no-webgl2');
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
      teardown();
    },
  };
}
