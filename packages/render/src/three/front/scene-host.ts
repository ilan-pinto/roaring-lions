/**
 * The scene host's door, `@lions/render/three-front`: the lit diorama behind
 * the main menu (`docs/superpowers/specs/2026-09-24-scene-host-design.md`,
 * §3.1, §3.3, §4).
 *
 * ## A thin door over a stock `ThreeRenderer`, not a second renderer
 *
 * Nothing here draws. The door constructs an UNMODIFIED `ThreeRenderer`
 * against a `Sim` the app built and never ticks, loads the slice's meshes
 * through that renderer's own public loaders, turns two debug layers off
 * (`overlays`; and `fog`, which drives `uRevealAll` rather than skipping the
 * pass, so D-1's off-map fade keeps running), frames the camera and runs a
 * capped frame loop. "The same ground as a mission" is not three shared
 * modules, it is the whole of `ThreeRenderer`'s composition -- terrain and
 * its albedo slots, scatter, the grove, decor, the textured buildings, the
 * skirt, the fog pass, GTAO, SMAA, ACES, the vignette -- so a smaller
 * renderer reassembling that list would be a second pipeline, and one that
 * drifted in a single pass would move the colour-register check by less than
 * the framing does (spec M16, M17). A menu mode threaded through
 * `ThreeRenderer` was the other option; it would make every later change to
 * that file reason about a presentation mode it otherwise does not have.
 *
 * It is a door rather than the app driving the renderer the way `main.ts`
 * does because the glue is backend-only -- loaders, debug layers, the
 * canvas, a loop keyed to render cost -- while `packages/app` holds
 * renderers by the `Renderer` interface. It imports `ThreeRenderer`
 * STATICALLY, so Rollup gives it the same three core and `ThreeRenderer`
 * chunks `@lions/render/three` uses (spec M3): the host downloads no
 * JavaScript a three mission would not, and warms that cache for it. The app
 * must reach THIS file by a dynamic `import()`; eslint's bundle rule names it
 * beside the other doors.
 *
 * ## Lifecycle
 *
 * 1. **Prefetch, with no context** (R-7): every GLB and the Draco decoder go
 *    into the HTTP cache under the host's `AbortSignal`, and each body is
 *    READ -- an unread response is not cached. A player who leaves during
 *    this phase, the long one on a slow link (~3 s of M7's 4.2-4.5), leaves
 *    nothing to release.
 * 2. **Construct.** From here an abort releases at once, from the signal's
 *    own listener, not at the next await: the router mounts the next screen
 *    right after it unmounts this one.
 * 3. **Load** (from cache), `setDecor`, `setElevation`, `init`, emitters,
 *    layers off, camera framed.
 * 4. **Reveal a complete frame**: one `frame()`, then
 *    `groundTexturesSettled()`, then a second `frame()`, then resolve. On a
 *    slow link the sand lands AFTER the first frame (M7), so resolving on the
 *    first would show flat palette ground and pop the texture in a moment
 *    later.
 * 5. **Loop** at `fpsCap` (`cadence.ts`), and HOLD -- stop the loop, keep the
 *    last frame -- if the machine cannot afford it.
 * 6. **Redraw on every resize**, held or not.
 * 7. **Release**: cancel the frame, disconnect the observer,
 *    `ThreeRenderer.dispose()` -- which gives the context back -- and remove
 *    the canvas.
 *
 * ## Three rules that read wrong and are not
 *
 * - **Never release the context a second time.** Since #219
 *   `ThreeRenderer.dispose()` loses its own context
 *   (`../context-release.ts`: dispose, then `forceContextLoss()`, skipped if
 *   already lost). The spec's M14/M15 measured `dispose()` leaving ~440 MB
 *   held and its §3.3 (6) added an explicit `loseContext()` after it; both
 *   predate #219 and are superseded. A second release is at best dead code
 *   (`getExtension` returns `null` on a lost context, so one asked for after
 *   `dispose()` does nothing) and at worst, through a handle taken before
 *   it, the `loseContext: context already lost` WebGL warning
 *   `context-release.ts` measured -- which `ui:routes` fails on, around each
 *   of its three leaves of this host. So `release()` below calls `dispose()`
 *   and nothing that touches the context.
 * - **MUST: call the global `requestAnimationFrame` at call time.** The
 *   capture tools freeze a page by REPLACING `window.requestAnimationFrame`
 *   (`FREEZE_FRAME_LOOP_STATEMENTS`, `tools/src/golden-diff/capture-
 *   protocol.ts`); a reference bound at module load, or held in a local,
 *   would keep this loop drawing through the freeze, and the plate
 *   photographed from the host (spec §3.6) would be whichever frame the
 *   compositor happened to hold.
 * - **MUST: redraw once on every resize, held or not.** `ThreeRenderer`'s
 *   own `ResizeObserver` (registered in `init()`, so it fires FIRST) calls
 *   `fitToHost`, whose `setSize` writes `canvas.width` unconditionally and so
 *   CLEARS the canvas -- including on that observer's first call, which lands
 *   after the reveal. A held host has no loop to paint it back, so without
 *   this one redraw a window resize leaves a blank rectangle behind the menu
 *   for good; an animating one would show a blank frame. The redraw also
 *   re-frames the camera: the zoom follows the layer's size (the app's cover
 *   law), and `onCamera` reports it.
 *
 * Two more about teardown, both from #219. `dispose()` can still throw after
 * it has released the context, so the canvas comes off in a `finally` -- the
 * shape `campaign/world-view.ts` uses -- and an abort, which runs `release`
 * from an event listener where a throw would surface as an uncaught error,
 * warns by name instead. And the loop's callback returns at once when
 * released, as well as being cancelled: after #219 `frame()` is silent on a
 * disposed renderer, so a loop that outlived its menu would draw nothing,
 * print nothing, and be invisible to every instrument.
 *
 * Units need no `snapshot()` and no `reseed()`: the app spawned them before
 * construction, so `init()`'s own seeding sees them.
 */
import type { Sim } from '@lions/sim';
import type { RendererOptions } from '../../api';
import type { EmitterSpec } from '../../vfx';
import { ThreeRenderer } from '../ThreeRenderer';
import type { MeshFaction } from '../units/mesh-role';
import { HOST_FPS_CAP, drawDue, motionVerdict } from './cadence';

/** Every mesh the slice draws, as served URLs -- the app's `MeshManifest`,
 *  field for field. Buildings are the STANDING state only: nothing falls on a
 *  menu, so no wreck is ever fetched. */
export interface SceneHostMeshes {
  readonly rigged: readonly { id: string; urls: readonly string[]; faction: MeshFaction }[];
  readonly vehicles: readonly { id: string; url: string }[];
  readonly buildings: readonly { id: string; url: string }[];
  readonly decor: ReadonlyMap<string, string>;
}

export interface SceneHostOptions {
  readonly sim: Sim;
  /** The mission's own options (`rendererOptionsFor`), so the host shares
   *  the mission's lighting, quality preset and team colours. */
  readonly renderer: RendererOptions;
  readonly meshes: SceneHostMeshes;
  readonly decor: Uint8Array;
  readonly elevation: Uint8Array;
  readonly emitters: { list: EmitterSpec[]; resolve: (key: string) => string };
  readonly camera: { readonly x: number; readonly y: number };
  /** The zoom for a host layer of this CSS size. Asked at the first frame and
   *  on every resize. */
  readonly zoomFor: (layerW: number, layerH: number) => number;
  /** Frames per second; default `HOST_FPS_CAP`, 30. */
  readonly fpsCap?: number;
  readonly signal: AbortSignal;
  /** Called once, if and when the loop holds. */
  readonly onMotion?: (m: SceneHostMotion) => void;
  /** Every camera the door hands the renderer -- at the first frame and on every resize. */
  readonly onCamera?: (c: { readonly x: number; readonly y: number; readonly zoom: number }) => void;
}

export type SceneHostMotion = 'animate' | 'held';

export interface SceneHostView {
  readonly canvas: HTMLCanvasElement;
  /** The camera last handed to the renderer. */
  readonly camera: { readonly x: number; readonly y: number; readonly zoom: number };
  readonly motion: SceneHostMotion;
  /** Idempotent. Stops the loop, disposes the renderer (which releases its
   *  context) and removes the canvas. Rethrows if the renderer's own
   *  `dispose()` throws -- after the canvas is gone. */
  dispose(): void;
}

/** Every URL the slice will ask for, deduplicated: the meshes and the two
 *  decoder files `assets/draco/` ships (`units/gltf-loader.ts`). */
function prefetchUrls(opts: SceneHostOptions): string[] {
  const urls = new Set<string>();
  for (const r of opts.meshes.rigged) for (const u of r.urls) urls.add(u);
  for (const v of opts.meshes.vehicles) urls.add(v.url);
  for (const b of opts.meshes.buildings) urls.add(b.url);
  for (const u of opts.meshes.decor.values()) urls.add(u);
  const draco = opts.renderer.dracoDecoderPath;
  if (draco !== undefined) {
    urls.add(`${draco}draco_wasm_wrapper.js`);
    urls.add(`${draco}draco_decoder.wasm`);
  }
  return [...urls];
}

/**
 * Mount the diorama into `host`, and resolve once a complete frame is on its
 * canvas (the lifecycle in the header).
 *
 * Rejects with the failure -- a fetch that answered an HTTP error, a loader,
 * `init` -- having released whatever it built; or with an `AbortError` once
 * `opts.signal` has aborted. The ABORT is what releases, not this promise:
 * from construction on, the signal's listener disposes the renderer and
 * removes the canvas synchronously. A caller tearing down must never wait on
 * this promise, because after an abort mid-load it may settle late or NEVER:
 * `ThreeRenderer.dispose()` disposes the shared Draco loader, and three
 * r170's `DRACOLoader.dispose()` terminates its workers without rejecting
 * the decodes still pending on them, so a GLB caught mid-decode never
 * settles its load.
 */
export async function mountSceneHost(host: HTMLElement, opts: SceneHostOptions): Promise<SceneHostView> {
  const { signal } = opts;
  const cap = opts.fpsCap ?? HOST_FPS_CAP;
  const stop = (): never => {
    throw new DOMException('scene host left', 'AbortError');
  };
  // Before any fetch: the prefetch below listens for an abort, and a signal
  // that has already fired never fires again.
  if (signal.aborted) stop();

  // 1. Bytes first, NO context (R-7). Every GLB and the Draco decoder into the
  //    HTTP cache; the loaders' own requests below then hit it. Each body must
  //    be consumed -- an unread response is not cached.
  //
  //    Under an INTERNAL controller chained to the caller's signal, so the
  //    first failure stops the rest: `Promise.all` rejects on it, and without
  //    this the other downloads would run on until the host is left.
  const prefetch = new AbortController();
  const stopPrefetch = (): void => prefetch.abort();
  signal.addEventListener('abort', stopPrefetch, { once: true });
  try {
    await Promise.all(
      prefetchUrls(opts).map(async (url) => {
        try {
          const res = await fetch(url, { signal: prefetch.signal });
          if (!res.ok) {
            // Nothing will read this body; give the connection back.
            void res.body?.cancel().catch(() => undefined);
            throw new Error(`scene host: ${url} answered HTTP ${res.status}`);
          }
          await res.arrayBuffer();
        } catch (err) {
          prefetch.abort();
          throw err;
        }
      })
    );
  } finally {
    signal.removeEventListener('abort', stopPrefetch);
  }
  if (signal.aborted) stop();

  // 2. The context. From here an abort must release it AT ONCE, not at the
  //    next await: the router mounts the next screen right after.
  const renderer = new ThreeRenderer(opts.sim, opts.renderer);
  const canvas = renderer.canvas;
  let released = false;
  let raf = 0;
  let observer: ResizeObserver | null = null;
  // No explicit context loss: `dispose()` releases the context itself since
  // #219, and a second release warns (the header's first rule).
  const release = (): void => {
    if (released) return;
    released = true;
    cancelAnimationFrame(raf);
    observer?.disconnect();
    try {
      renderer.dispose();
    } finally {
      canvas.remove();
    }
  };
  // `release` for the two callers with nobody above them to catch: the abort
  // listener, where a throw would be reported as uncaught, and the failed
  // load below, where it would replace the error that says what failed.
  const releaseSafely = (): void => {
    try {
      release();
    } catch (err) {
      console.warn('[lions] scene host: disposing its renderer threw:', err);
    }
  };
  signal.addEventListener('abort', releaseSafely, { once: true });

  let applied = { x: opts.camera.x, y: opts.camera.y, zoom: renderer.camera.zoom };
  const frameCamera = (): void => {
    applied = { x: opts.camera.x, y: opts.camera.y, zoom: opts.zoomFor(host.clientWidth, host.clientHeight) };
    renderer.camera.x = applied.x;
    renderer.camera.y = applied.y;
    renderer.camera.zoom = applied.zoom;
    opts.onCamera?.(applied);
  };

  try {
    const m = opts.meshes;
    await Promise.all([
      ...m.rigged.map((r) => renderer.loadMeshUnit(r.id, r.urls, r.faction)),
      ...m.vehicles.map((v) => renderer.loadVehicleMesh(v.id, v.url)),
      ...m.buildings.map((b) => renderer.loadBuildingMesh(b.id, b.url, null)),
      renderer.loadDecorMeshes(m.decor),
    ]);
    if (signal.aborted) stop();
    renderer.setDecor(opts.decor);
    renderer.setElevation(opts.elevation);
    await renderer.init(host);
    if (signal.aborted) stop();
    renderer.useEmitters(opts.emitters.list, opts.emitters.resolve);
    renderer.setDebugLayerVisible('overlays', false);
    renderer.setDebugLayerVisible('fog', false); // uRevealAll: D-1's off-map fade keeps running
    frameCamera();
    renderer.frame(1, 0);
    // Never rejects, and a promise taken before an abort settles only when
    // the downloads do -- hence the check after it, as after every await.
    await renderer.groundTexturesSettled();
    if (signal.aborted) stop();
    renderer.frame(1, 0);
  } catch (err) {
    signal.removeEventListener('abort', releaseSafely);
    releaseSafely();
    // A loader that failed BECAUSE the leave tore it down is a leave, not a
    // load failure; say so with the same error the checks above throw.
    if (signal.aborted) stop();
    throw err;
  }

  // 3. The loop, the hold, and the resize redraw. Everything below is
  //    synchronous up to the return, so no abort can land before the loop
  //    and the observer exist for `release` to stop.
  let motion: SceneHostMotion = 'animate';
  // The reveal's second frame was a draw: the loop's first frame is due one
  // period after it, and its `dt` is real elapsed time.
  let lastDraw = performance.now();
  let loopDraws = 0;
  let decided = false;
  const intervals: number[] = [];

  const tick = (now: number): void => {
    // Returns at once when released, as well as being cancelled (header).
    if (released) return;
    if (drawDue(now, lastDraw, cap)) {
      const dt = now - lastDraw;
      // Intervals from the SECOND loop draw on: the first one's gap spans the
      // reveal and the app's own work on it, not this loop's cadence.
      if (loopDraws > 0 && !decided) intervals.push(dt);
      loopDraws += 1;
      lastDraw = now;
      // `dt` is unclamped here; the renderer clamps its own clocks (100 ms).
      renderer.frame(1, dt);
      if (!decided) {
        const verdict = motionVerdict(intervals, cap);
        if (verdict === 'hold') {
          // Not re-arming IS cancelling: this callback's own id has fired.
          motion = 'held';
          opts.onMotion?.('held');
          return;
        }
        decided = verdict === 'animate';
      }
    }
    // MUST: the global, looked up at call time (header).
    raf = requestAnimationFrame(tick);
  };

  // MUST: redraw once on every resize, held or not (header). Registered after
  // `init()`'s own observer, so in every observation pass it runs AFTER
  // `fitToHost` -- the FIRST pass included, which lands after the reveal.
  // `fitToHost` -> `setSize` writes `canvas.width` unconditionally, clearing
  // the drawing buffer, so this redraw in the same pass is what keeps the
  // canvas the app has just revealed from painting a cleared buffer.
  observer = new ResizeObserver(() => {
    if (released) return;
    frameCamera();
    renderer.frame(1, 0);
  });
  observer.observe(host);
  raf = requestAnimationFrame(tick);

  return {
    canvas,
    get camera() {
      return applied;
    },
    get motion() {
      return motion;
    },
    dispose: () => {
      signal.removeEventListener('abort', releaseSafely);
      release();
    },
  };
}
