// packages/app/src/ui/scene-host.test.ts
// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { menuDiorama } from '@lions/data';
import { dioramaSceneOptions } from '../front/diorama';
import { CROSSFADE_MS } from './scene-host-model';
import { sceneHost, type MountSceneHostView, type SceneHostDeps } from './scene-host';

type View = Awaited<ReturnType<MountSceneHostView>>;
type MountOpts = Parameters<MountSceneHostView>[1];

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve: (v: T) => void = () => {};
  let reject: (e: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const flush = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
function fakeMount(): { mount: MountSceneHostView; calls: { host: HTMLElement; opts: MountOpts }[]; d: ReturnType<typeof deferred<View>> } {
  const calls: { host: HTMLElement; opts: MountOpts }[] = [];
  const d = deferred<View>();
  const mount: MountSceneHostView = (into, opts) => {
    calls.push({ host: into, opts });
    return d.promise;
  };
  return { mount, calls, d };
}
function setup(): { stage: HTMLElement; column: HTMLElement } {
  const stage = document.createElement('div');
  const column = document.createElement('div');
  column.className = 'rl-menu';
  stage.appendChild(column);
  document.body.appendChild(stage);
  return { stage, column };
}
const deps = (over: Partial<SceneHostDeps> = {}): SceneHostDeps => ({
  plateUrl: '/ui/menu_host_plate.jpg',
  renderer: 'three',
  world: () => dioramaSceneOptions(menuDiorama, { colorVision: 'default', quality: 'high' }, '/'),
  reducedMotion: () => false,
  saveData: () => false,
  webgl2: () => true,
  schedule: (fn) => {
    fn();
    return () => {};
  },
  now: () => 0,
  ...over,
});
const hostEl = (stage: HTMLElement): HTMLElement => {
  const el = stage.querySelector<HTMLElement>('.rl-scene-host');
  if (el === null) throw new Error('no .rl-scene-host in the stage');
  return el;
};
const fakeView = (): View & { dispose: ReturnType<typeof vi.fn> } => ({ canvas: document.createElement('canvas'), dispose: vi.fn() });

/** Every host a test mounts is disposed after it: a live host holds a 15 s
 *  deadline timer that would otherwise fire into a later test's console spy.
 *  The disposer is idempotent, so a test that disposes its own host is fine. */
const cleanups: (() => void)[] = [];
const host = (stage: HTMLElement, column: HTMLElement, d: SceneHostDeps): (() => void) => {
  const dispose = sceneHost(stage, column, d);
  cleanups.push(dispose);
  return dispose;
};

afterEach(() => {
  for (const dispose of cleanups.splice(0)) dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('sceneHost', () => {
  it('sits under the column, hidden from assistive tech', () => {
    const { stage, column } = setup();
    host(stage, column, deps({ mount: fakeMount().mount }));
    const el = hostEl(stage);
    expect(el.nextElementSibling).toBe(column);
    expect(el.getAttribute('aria-hidden')).toBe('true');
  });

  it('is off, with no image and no mount, when the column fills the width', () => {
    const { stage, column } = setup();
    column.getBoundingClientRect = () => ({ width: window.innerWidth * 0.9 }) as DOMRect;
    const f = fakeMount();
    host(stage, column, deps({ mount: f.mount }));
    const el = hostEl(stage);
    expect(el.dataset.host).toBe('off');
    expect(el.dataset.hostReason).toBe('narrow');
    expect(el.querySelector('img')).toBeNull();
    expect(f.calls).toHaveLength(0);
  });

  it('Pixi shows the plate, never probes WebGL2, never mounts, and says so once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const probe = vi.fn(() => true);
    const f = fakeMount();
    const { stage, column } = setup();
    host(stage, column, deps({ renderer: 'pixi', webgl2: probe, mount: f.mount }));
    await flush();
    const el = hostEl(stage);
    expect(el.dataset.host).toBe('plate');
    expect(el.dataset.hostReason).toBe('pixi');
    expect(el.querySelector('img')?.getAttribute('src')).toBe('/ui/menu_host_plate.jpg');
    expect(probe).not.toHaveBeenCalled();
    expect(f.calls).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/pixi/);
  });

  it('is pending under the poster, then live; the poster leaves after the crossfade', async () => {
    vi.useFakeTimers();
    const f = fakeMount();
    const { stage, column } = setup();
    host(stage, column, deps({ mount: f.mount, now: vi.fn().mockReturnValueOnce(0).mockReturnValue(1234) }));
    const el = hostEl(stage);
    expect(el.dataset.host).toBe('pending');
    expect(el.querySelector('img')).not.toBeNull();
    await flush();
    expect(f.calls).toHaveLength(1);
    const call = f.calls[0];
    if (call === undefined) throw new Error('mount was not called');
    const view = fakeView();
    call.host.appendChild(view.canvas);
    call.opts.onCamera?.({ x: 27, y: 22, zoom: 1.6591 });
    f.d.resolve(view);
    await flush();
    expect(el.dataset.host).toBe('live');
    expect(el.dataset.hostCamera).toBe('27,22');
    expect(el.dataset.hostZoom).toBe('1.659');
    expect(el.dataset.hostMs).toBe('1234');
    expect(el.querySelector('img')).not.toBeNull();
    vi.advanceTimersByTime(CROSSFADE_MS);
    expect(el.querySelector('img')).toBeNull();
  });

  it('a door that rejects keeps the plate, named', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = fakeMount();
    const { stage, column } = setup();
    host(stage, column, deps({ mount: f.mount }));
    await flush();
    f.d.reject(new Error('GLB 404'));
    await flush();
    expect(hostEl(stage).dataset.host).toBe('plate');
    expect(hostEl(stage).dataset.hostReason).toBe('load-failed');
    expect(warn).toHaveBeenCalled();
  });

  it('the deadline keeps the plate and aborts; a late view is disposed at once', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = fakeMount();
    const { stage, column } = setup();
    host(stage, column, deps({ mount: f.mount, deadlineMs: 15000 }));
    await flush();
    vi.advanceTimersByTime(15000);
    expect(hostEl(stage).dataset.host).toBe('plate');
    expect(hostEl(stage).dataset.hostReason).toBe('deadline');
    expect(f.calls[0]?.opts.signal.aborted).toBe(true);
    const view = fakeView();
    f.d.resolve(view);
    await flush();
    expect(view.dispose).toHaveBeenCalledTimes(1);
    expect(hostEl(stage).dataset.host).toBe('plate');
  });

  it('leaving while pending aborts, removes the host, and disposes a late view', async () => {
    const f = fakeMount();
    const { stage, column } = setup();
    const dispose = host(stage, column, deps({ mount: f.mount }));
    await flush();
    dispose();
    expect(stage.querySelector('.rl-scene-host')).toBeNull();
    expect(f.calls[0]?.opts.signal.aborted).toBe(true);
    const view = fakeView();
    f.d.resolve(view);
    await flush();
    expect(view.dispose).toHaveBeenCalledTimes(1);
  });

  it('leaving while live disposes the view exactly once, however often it is called', async () => {
    const f = fakeMount();
    const { stage, column } = setup();
    const dispose = host(stage, column, deps({ mount: f.mount }));
    await flush();
    const view = fakeView();
    f.d.resolve(view);
    await flush();
    dispose();
    dispose();
    expect(view.dispose).toHaveBeenCalledTimes(1);
  });

  // The door rejects with an AbortError once the host has aborted it -- and,
  // after a leave mid-load, may reject late or never settle at all. None of
  // that is news: the host caused it, and says nothing.
  it('a rejection after its own abort says nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = fakeMount();
    const { stage, column } = setup();
    const dispose = host(stage, column, deps({ mount: f.mount }));
    await flush();
    dispose();
    f.d.reject(new DOMException('scene host left', 'AbortError'));
    await flush();
    expect(warn).not.toHaveBeenCalled();
  });

  // Ruling C14. On a live leave the door's own abort listener has already
  // released everything, so `view.dispose()` is a no-op there; it can throw
  // only when no abort came first. A throw out of a router disposer would
  // leave the stage half cleared, so the host warns and finishes leaving.
  it('a view whose dispose throws is warned about, and leaving still completes', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = fakeMount();
    const { stage, column } = setup();
    const dispose = host(stage, column, deps({ mount: f.mount }));
    await flush();
    const view = {
      canvas: document.createElement('canvas'),
      dispose: vi.fn(() => {
        throw new Error('dispose threw after releasing the context');
      }),
    };
    f.d.resolve(view);
    await flush();
    expect(() => dispose()).not.toThrow();
    expect(view.dispose).toHaveBeenCalledTimes(1);
    expect(stage.querySelector('.rl-scene-host')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/disposing its view threw/);
  });

  it('writes a hold to the DOM', async () => {
    const f = fakeMount();
    const { stage, column } = setup();
    host(stage, column, deps({ mount: f.mount }));
    await flush();
    f.d.resolve(fakeView());
    await flush();
    f.calls[0]?.opts.onMotion?.('held');
    expect(hostEl(stage).dataset.hostMotion).toBe('held');
  });

  it('a plate that fails to load is removed, never shown broken', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { stage, column } = setup();
    host(stage, column, deps({ renderer: 'pixi' }));
    const img = hostEl(stage).querySelector('img');
    img?.dispatchEvent(new Event('error'));
    expect(hostEl(stage).querySelector('img')).toBeNull();
  });

  describe('parallax', () => {
    const run = (queue: FrameRequestCallback[], ms: number): void => {
      for (let t = 0; t <= ms; t += 100) for (const cb of queue.splice(0)) cb(t);
    };
    const move = (x: number, y: number, pointerType: string): void => {
      window.dispatchEvent(Object.assign(new MouseEvent('pointermove', { clientX: x, clientY: y }), { pointerType }));
    };

    it('a mouse moves the picture against the pointer', () => {
      const queue: FrameRequestCallback[] = [];
      const { stage, column } = setup();
      host(stage, column, deps({ mount: fakeMount().mount, frame: (cb) => queue.push(cb) }));
      move(window.innerWidth, window.innerHeight / 2, 'mouse');
      run(queue, 5000);
      expect(Number(hostEl(stage).style.getPropertyValue('--host-dx'))).toBeLessThan(-0.95);
      expect(Math.abs(Number(hostEl(stage).style.getPropertyValue('--host-dy')))).toBeLessThan(0.01);
    });

    it('touch never moves it', () => {
      const queue: FrameRequestCallback[] = [];
      const { stage, column } = setup();
      host(stage, column, deps({ mount: fakeMount().mount, frame: (cb) => queue.push(cb) }));
      move(window.innerWidth, 0, 'touch');
      expect(queue).toHaveLength(0);
    });

    it('reduced motion shows the plate and never moves it', () => {
      const queue: FrameRequestCallback[] = [];
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { stage, column } = setup();
      host(stage, column, deps({ reducedMotion: () => true, frame: (cb) => queue.push(cb) }));
      expect(hostEl(stage).dataset.hostReason).toBe('reduced-motion');
      move(window.innerWidth, 0, 'mouse');
      expect(queue).toHaveLength(0);
    });

    it('leaving removes the pointer listener', () => {
      const queue: FrameRequestCallback[] = [];
      const { stage, column } = setup();
      const dispose = host(stage, column, deps({ mount: fakeMount().mount, frame: (cb) => queue.push(cb) }));
      dispose();
      move(window.innerWidth, 0, 'mouse');
      expect(queue).toHaveLength(0);
    });
  });

  // The CSS transition and the JS timer that removes the poster are one
  // duration written twice; this is what keeps them one.
  it('theme.css’s --dur-host-reveal is CROSSFADE_MS', () => {
    // `fileURLToPath` on the string, not `new URL(..., import.meta.url)`:
    // under jsdom the global `URL` is jsdom's, and it resolves that pair to an
    // `http:` URL `readFileSync` refuses.
    const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'theme.css'), 'utf8');
    expect(css).toMatch(new RegExp(`--dur-host-reveal:\\s*${CROSSFADE_MS}ms`));
  });
});
