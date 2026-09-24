/**
 * The scene host door's lifecycle: what it builds when, what a leave costs at
 * each point, and the frame loop's hold -- the parts of `scene-host.ts` that
 * are control flow rather than rendering.
 *
 * Headless, so the renderer is stood in for: `ThreeRenderer` cannot construct
 * without a GPU, and nothing here is about what it draws. The stand-in records
 * its calls, every `frame()` INCLUDING one after `dispose()` -- the real one
 * returns silently there since #219, which is exactly why a loop that outlived
 * its menu would be invisible anywhere else -- and whether anything asked its
 * canvas for a context. Its mesh loads, `init()` and `groundTexturesSettled()`
 * can each be held on a gate, so a test can leave at every await the door has.
 *
 * `fetch` answers per test (`respond`). `requestAnimationFrame` is stubbed to
 * QUEUE callbacks and `cancelAnimationFrame` to do nothing, so a test can fire
 * a callback that was already scheduled when the host was left
 * (`campaign/world-view.test.ts`'s pattern). `performance.now` is pinned so the
 * loop's first due time is known.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Sim } from '@lions/sim';
import type { RendererOptions } from '../../api';
import { HOLD_SAMPLES } from './cadence';
import { mountSceneHost, type SceneHostOptions } from './scene-host';

interface FakeRenderer {
  readonly calls: string[];
  /** `dt` of every `frame()` call, in order. */
  readonly frames: number[];
  readonly camera: { x: number; y: number; zoom: number };
  readonly canvas: { removed: boolean; contextAsked: number };
}

const made = vi.hoisted(() => ({
  renderers: [] as unknown[],
  disposeThrows: false,
  /** Holds every mesh load until it settles -- a test that leaves mid-load. */
  gate: null as Promise<void> | null,
  /** Holds `init()`. */
  initGate: null as Promise<void> | null,
  /** What `groundTexturesSettled()` returns; resolved when null. */
  groundGate: null as Promise<void> | null,
}));

vi.mock('../ThreeRenderer', () => ({
  ThreeRenderer: class {
    readonly calls: string[] = [];
    readonly frames: number[] = [];
    readonly camera = { x: 0, y: 0, zoom: 1 };
    readonly canvas = {
      removed: false,
      contextAsked: 0,
      remove(): void {
        this.removed = true;
      },
      getContext(): null {
        this.contextAsked += 1;
        return null;
      },
    };
    constructor() {
      made.renderers.push(this);
    }
    async load(what: string): Promise<void> {
      if (made.gate) await made.gate;
      this.calls.push(what);
    }
    loadMeshUnit(id: string): Promise<void> {
      return this.load(`rigged:${id}`);
    }
    loadVehicleMesh(id: string): Promise<void> {
      return this.load(`vehicle:${id}`);
    }
    loadBuildingMesh(id: string): Promise<void> {
      return this.load(`building:${id}`);
    }
    loadDecorMeshes(): Promise<void> {
      return this.load('decor');
    }
    setDecor(): void {}
    setElevation(): void {}
    async init(): Promise<void> {
      if (made.initGate) await made.initGate;
      this.calls.push('init');
    }
    useEmitters(): void {}
    setDebugLayerVisible(name: string, visible: boolean): number {
      this.calls.push(`${name}=${visible}`);
      return 1;
    }
    frame(_alpha: number, dtMs: number): void {
      this.frames.push(dtMs);
    }
    groundTexturesSettled(): Promise<void> {
      return made.groundGate ?? Promise.resolve();
    }
    dispose(): void {
      this.calls.push('dispose');
      if (made.disposeThrows) throw new Error('free failed');
    }
  },
}));

/** Every URL `options()` below implies: five meshes and the two decoder files. */
const ALL_URLS = [
  '/m/inf_a.glb',
  '/m/inf_b.glb',
  '/m/lavi.glb',
  '/m/house.glb',
  '/m/bush.glb',
  '/draco/draco_wasm_wrapper.js',
  '/draco/draco_decoder.wasm',
];
const sorted = (xs: readonly string[]): string[] => [...xs].sort();

const REVEAL_AT = 1000;
let rafQueue: Array<(t: number) => void> = [];
let resize: (() => void) | null = null;
let fetched: string[] = [];
let fetchSignals = new Map<string, AbortSignal>();
/** URLs whose body was read. */
let bodiesRead: string[] = [];
let controller = new AbortController();
const host = { clientWidth: 1920, clientHeight: 1080 };

const okResponse = (url: string): unknown => ({
  ok: true,
  status: 200,
  body: null,
  arrayBuffer: async (): Promise<ArrayBuffer> => {
    bodiesRead.push(url);
    return new ArrayBuffer(0);
  },
});
/** A response that never arrives, until its request is aborted. */
const hang = (signal: AbortSignal): Promise<unknown> =>
  new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
let respond: (url: string, signal: AbortSignal) => Promise<unknown> = async (url) => okResponse(url);

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (err: unknown) => void } {
  let resolve: () => void = () => {};
  let reject: (err: unknown) => void = () => {};
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Run every queued rAF callback at time `t`, as one display frame. */
const frameAt = (t: number): void => {
  for (const cb of rafQueue.splice(0)) cb(t);
};

beforeEach(() => {
  made.renderers.length = 0;
  made.disposeThrows = false;
  made.gate = null;
  made.initGate = null;
  made.groundGate = null;
  rafQueue = [];
  resize = null;
  fetched = [];
  fetchSignals = new Map();
  bodiesRead = [];
  respond = async (url) => okResponse(url);
  controller = new AbortController();
  host.clientWidth = 1920;
  host.clientHeight = 1080;
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void): number => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
  vi.stubGlobal('cancelAnimationFrame', (): void => {});
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: () => void) {
        resize = cb;
      }
      observe(): void {}
      disconnect(): void {}
    }
  );
  vi.stubGlobal('fetch', (url: string, init: { signal: AbortSignal }): Promise<unknown> => {
    fetched.push(url);
    fetchSignals.set(url, init.signal);
    return respond(url, init.signal);
  });
  vi.spyOn(performance, 'now').mockReturnValue(REVEAL_AT);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const zoomFor = (w: number, h: number): number => 1.6 * Math.max(w / 1920, h / 1080);

const options = (over: Partial<SceneHostOptions> = {}): SceneHostOptions => ({
  sim: {} as Sim,
  renderer: { dracoDecoderPath: '/draco/' } as RendererOptions,
  meshes: {
    rigged: [{ id: 'inf_squad', urls: ['/m/inf_a.glb', '/m/inf_b.glb'], faction: 'kdf' }],
    vehicles: [{ id: 'mbt_lavi', url: '/m/lavi.glb' }],
    buildings: [{ id: 'house', url: '/m/house.glb' }],
    decor: new Map([['bush_0', '/m/bush.glb']]),
  },
  decor: new Uint8Array(0),
  elevation: new Uint8Array(0),
  emitters: { list: [], resolve: (k) => k },
  camera: { x: 27, y: 22 },
  zoomFor,
  signal: controller.signal,
  ...over,
});

const mount = (over: Partial<SceneHostOptions> = {}) =>
  mountSceneHost(host as unknown as HTMLElement, options(over));

const theRenderer = (): FakeRenderer => {
  const r = made.renderers[0] as FakeRenderer | undefined;
  if (!r) throw new Error('premise: the door built no renderer');
  return r;
};

describe('the prefetch: bytes before any context', () => {
  it('fetches every byte before it builds a renderer, so a leave then costs no context', async () => {
    respond = (_url, signal) => hang(signal);
    const pending = mount();
    await Promise.resolve();

    expect(sorted(fetched)).toEqual(sorted(ALL_URLS));
    expect(made.renderers).toHaveLength(0);

    controller.abort();
    // Every request is cancelled by the leave itself -- asserted before the
    // await, so a chain that stopped nothing fails here rather than hanging.
    for (const url of ALL_URLS) expect(fetchSignals.get(url)?.aborted, url).toBe(true);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(made.renderers).toHaveLength(0);
  });

  // An unread response is not cached, so a prefetch that skipped the body
  // would warm nothing.
  it('reads every body it fetches', async () => {
    await mount();

    expect(sorted(bodiesRead)).toEqual(sorted(ALL_URLS));
  });

  it('an abort before the mount fetches nothing', async () => {
    controller.abort();

    await expect(mount()).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetched).toEqual([]);
    expect(made.renderers).toHaveLength(0);
  });

  // The check straight after the prefetch: the last body lands, and the leave
  // lands in the same turn. The listener that releases does not exist yet.
  it('an abort as the last byte lands builds no renderer', async () => {
    respond = async (url) => ({
      ...(okResponse(url) as object),
      arrayBuffer: async (): Promise<ArrayBuffer> => {
        bodiesRead.push(url);
        if (bodiesRead.length === ALL_URLS.length) controller.abort();
        return new ArrayBuffer(0);
      },
    });

    await expect(mount()).rejects.toMatchObject({ name: 'AbortError' });
    expect(made.renderers).toHaveLength(0);
  });

  it('a fetch that answers an HTTP error rejects before any renderer exists', async () => {
    respond = async (url) =>
      url === '/m/lavi.glb' ? { ok: false, status: 404, body: null, arrayBuffer: async () => new ArrayBuffer(0) } : okResponse(url);

    await expect(mount()).rejects.toThrow('/m/lavi.glb answered HTTP 404');
    expect(made.renderers).toHaveLength(0);
  });

  it('the first failure cancels its own body and stops the other downloads', async () => {
    const cancel = vi.fn(async (): Promise<void> => {});
    respond = (url, signal) =>
      url === '/m/lavi.glb' ? Promise.resolve({ ok: false, status: 404, body: { cancel } }) : hang(signal);

    await expect(mount()).rejects.toThrow('HTTP 404');
    expect(cancel).toHaveBeenCalledTimes(1);
    for (const url of ALL_URLS) expect(fetchSignals.get(url)?.aborted, url).toBe(true);
    expect(controller.signal.aborted).toBe(false);
  });
});

describe('the reveal, and a leave at each of its awaits', () => {
  it('reveals on two frames with overlays and fog off and the camera framed', async () => {
    const cameras: unknown[] = [];
    const view = await mount({ onCamera: (c) => cameras.push(c) });
    const r = theRenderer();

    expect(r.frames).toEqual([0, 0]);
    expect(r.calls).toEqual(expect.arrayContaining(['init', 'overlays=false', 'fog=false']));
    expect(view.camera).toEqual({ x: 27, y: 22, zoom: 1.6 });
    expect(r.camera).toEqual({ x: 27, y: 22, zoom: 1.6 });
    expect(cameras).toEqual([{ x: 27, y: 22, zoom: 1.6 }]);
    expect(view.motion).toBe('animate');
  });

  it('a leave mid-load releases at once, not at the next await, and goes no further', async () => {
    const gate = deferred();
    made.gate = gate.promise;
    const pending = mount();
    await vi.waitFor(() => expect(made.renderers).toHaveLength(1));
    const r = theRenderer();

    controller.abort();
    // Before any load has resolved.
    expect(r.calls).toEqual(['dispose']);
    expect(r.canvas.removed).toBe(true);

    gate.resolve();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(r.calls).not.toContain('init');
    expect(r.frames).toEqual([]);
    expect(r.calls.filter((c) => c === 'dispose')).toHaveLength(1);
  });

  // `ThreeRenderer.dispose()` tears down the shared Draco loader, so a load in
  // flight can FAIL because of the leave. That is still a leave.
  it('a load that fails because the leave tore it down rejects as a leave', async () => {
    const gate = deferred();
    made.gate = gate.promise;
    const pending = mount();
    await vi.waitFor(() => expect(made.renderers).toHaveLength(1));

    controller.abort();
    gate.reject(new Error('decoder terminated'));

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('a leave during init() draws nothing', async () => {
    const gate = deferred();
    made.initGate = gate.promise;
    const pending = mount();
    await vi.waitFor(() => expect(made.renderers).toHaveLength(1));
    const r = theRenderer();
    await vi.waitFor(() => expect(r.calls).toContain('decor'));

    controller.abort();
    gate.resolve();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(r.frames).toEqual([]);
    expect(r.calls).not.toContain('overlays=false');
  });

  // Task 4's contract makes this check the caller's: a promise taken before
  // `dispose()` settles when the downloads do, not at the leave. Without it
  // the door would resolve after the leave and arm a loop and an observer
  // that the release, already over, could never stop.
  it('a leave while the ground textures load resolves nothing and arms nothing', async () => {
    const gate = deferred();
    made.groundGate = gate.promise;
    const pending = mount();
    await vi.waitFor(() => expect(made.renderers).toHaveLength(1));
    const r = theRenderer();
    await vi.waitFor(() => expect(r.frames).toEqual([0]));

    controller.abort();
    gate.resolve();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(r.frames).toEqual([0]);
    expect(rafQueue).toHaveLength(0);
    expect(resize).toBeNull();
    // C3 on the path every live leave takes: the abort listener's release.
    expect(r.canvas.contextAsked).toBe(0);
    expect(r.canvas.removed).toBe(true);
  });
});

describe('the frame loop', () => {
  it('keeps animating at the cadence Metal measured', async () => {
    const view = await mount();
    const r = theRenderer();

    for (let k = 1; k <= HOLD_SAMPLES + 3; k++) frameAt(REVEAL_AT + 33.4 * k);

    expect(r.frames).toHaveLength(2 + HOLD_SAMPLES + 3);
    expect(view.motion).toBe('animate');
    expect(rafQueue).toHaveLength(1);
  });

  it('holds at the cadence SwiftShader measured, and a held host still redraws on resize', async () => {
    const motions: string[] = [];
    const cameras: Array<{ zoom: number }> = [];
    const view = await mount({ onMotion: (m) => motions.push(m), onCamera: (c) => cameras.push(c) });
    const r = theRenderer();

    // The first loop draw is not an interval; HOLD_SAMPLES more are.
    for (let k = 1; k <= HOLD_SAMPLES + 1; k++) frameAt(REVEAL_AT + 920 * k);

    expect(motions).toEqual(['held']);
    expect(view.motion).toBe('held');
    expect(rafQueue).toHaveLength(0);
    const drawn = r.frames.length;

    host.clientWidth = 2560;
    host.clientHeight = 1440;
    resize?.();

    expect(r.frames).toHaveLength(drawn + 1);
    expect(r.frames[drawn]).toBe(0);
    expect(cameras.at(-1)?.zoom).toBeCloseTo(zoomFor(2560, 1440), 9);
    expect(view.camera.zoom).toBeCloseTo(zoomFor(2560, 1440), 9);
  });

  // The capture freeze replaces `window.requestAnimationFrame`; a loop holding
  // an earlier reference would draw straight through it.
  it('asks the global requestAnimationFrame for each frame at call time', async () => {
    await mount();
    const pending = rafQueue.splice(0);
    expect(pending).toHaveLength(1); // premise: the loop is armed
    const frozen = vi.fn((): number => 0);
    vi.stubGlobal('requestAnimationFrame', frozen);

    pending[0](REVEAL_AT + 1000);

    expect(frozen).toHaveBeenCalledTimes(1);
    expect(rafQueue).toHaveLength(0);
  });

  // C15: after #219 `frame()` is silent on a disposed renderer, so this is the
  // only place a loop that outlived its menu can be seen.
  it('a frame already scheduled when the host was left draws nothing and schedules nothing', async () => {
    const view = await mount();
    const r = theRenderer();
    expect(rafQueue).toHaveLength(1); // premise: the loop is armed

    view.dispose();
    frameAt(REVEAL_AT + 1000);

    expect(r.frames).toEqual([0, 0]);
    expect(rafQueue).toHaveLength(0);
  });
});

describe('release', () => {
  // C3: since #219 `ThreeRenderer.dispose()` loses its own context, and a
  // second release warns. On a CLEAN dispose, because a throwing one never
  // reaches a line after `dispose()` -- asserted there, this could not fail.
  // The abort path is pinned by the ground-texture leave above.
  it('disposes through the renderer alone and never reaches for the context', async () => {
    const view = await mount();
    const r = theRenderer();

    view.dispose();

    expect(r.calls.filter((c) => c === 'dispose')).toHaveLength(1);
    expect(r.canvas.removed).toBe(true);
    expect(r.canvas.contextAsked).toBe(0);
  });

  // C14: `dispose()` can throw after releasing the context; the canvas still
  // comes off, and a second call does not try again.
  it('removes the canvas even when dispose throws', async () => {
    const view = await mount();
    const r = theRenderer();
    made.disposeThrows = true;

    expect(() => view.dispose()).toThrow('free failed');
    expect(r.canvas.removed).toBe(true);
    expect(() => view.dispose()).not.toThrow();
    expect(r.calls.filter((c) => c === 'dispose')).toHaveLength(1);
  });

  it('a leave whose dispose throws warns rather than throwing out of the abort', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await mount();
    const r = theRenderer();
    made.disposeThrows = true;

    expect(() => controller.abort()).not.toThrow();
    expect(r.canvas.removed).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
