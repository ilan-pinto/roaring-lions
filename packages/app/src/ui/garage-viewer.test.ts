// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../i18n/t';
import { KEY_STEP_DEG, DRAG_DEG_PER_PX } from './garage-turn';
import {
  garageModel,
  type GarageModelDeps,
  type MountGarageView,
  type MountedGarageView,
} from './garage-viewer';

/** A stand-in for the door's view: counts draws, records disposal. */
function fakeView(): MountedGarageView & { drawn: number[]; disposed: number; resized: number } {
  const canvas = document.createElement('canvas');
  const v = {
    canvas,
    info: { pose: 'idle0', figures: 0 },
    drawn: [] as number[],
    disposed: 0,
    resized: 0,
    stats: () => ({ frames: v.drawn.length, calls: 0, triangles: 0 }),
    draw: (deg: number) => {
      v.drawn.push(deg);
    },
    resize: () => {
      v.resized += 1;
    },
    dispose: () => {
      v.disposed += 1;
    },
  };
  return v;
}

/** Frames and timers the test drives by hand. */
function clocks() {
  let id = 1;
  const frames = new Map<number, (t: number) => void>();
  const timers = new Map<number, () => void>();
  let now = 0;
  return {
    frame: (cb: (t: number) => void) => {
      frames.set(id, cb);
      return id++;
    },
    cancelFrame: (n: number) => {
      frames.delete(n);
    },
    setTimer: (fn: () => void) => {
      timers.set(id, fn);
      return id++;
    },
    clearTimer: (n: number) => {
      timers.delete(n);
    },
    flush: () => {
      now += 16;
      const due = [...frames.values()];
      frames.clear();
      for (const cb of due) cb(now);
    },
    pendingFrames: () => frames.size,
    pendingTimers: () => timers.size,
  };
}

const UNIT = { id: 'inf_squad', name: 'Rifle Squad' };

function plate(): HTMLElement {
  const p = document.createElement('div');
  p.className = 'rl-garage__plate';
  const img = document.createElement('img');
  img.className = 'rl-garage__plate-img';
  p.appendChild(img);
  document.body.appendChild(p);
  return p;
}

function deps(over: Partial<GarageModelDeps> = {}): GarageModelDeps {
  return {
    source: (id) => (id === 'inf_squad' ? { kind: 'rigged', url: '/meshes/meshy_soldier.glb', faction: 'kdf' } : null),
    renderer: 'three',
    dracoDecoderPath: '/draco/',
    groundTextureUrl: '/textures/desert_sand_tile.jpg',
    colors: { key: 'k', fill: 'f', sky: 's', bounce: 'b', ground: 'g' },
    webgl: () => true,
    reducedMotion: () => true,
    ...over,
  };
}

const key = (el: HTMLElement, k: string): KeyboardEvent => {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  el.dispatchEvent(ev);
  return ev;
};

/** jsdom has no PointerEvent constructor; a MouseEvent with the pointer
 *  fields stamped on is what the handlers read. */
const pointer = (el: HTMLElement, type: string, x: number): void => {
  const ev = new MouseEvent(type, { clientX: x, button: 0, bubbles: true });
  Object.defineProperty(ev, 'pointerId', { value: 1 });
  el.dispatchEvent(ev);
};

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('garageModel: the plate fallback paths', () => {
  it('keeps the plate on ?renderer=pixi, silently, and never mounts', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mount = vi.fn<MountGarageView>();
    const p = plate();
    const h = garageModel(p, UNIT, deps({ renderer: 'pixi', mount }));
    expect(await h.ready).toEqual({ shown: 'plate', reason: 'pixi' });
    expect(mount).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(p.dataset.model).toBe('plate');
    expect(p.querySelector('.rl-garage__model')).toBeNull();
    expect(p.querySelector('.rl-garage__plate-img')).not.toBeNull();
  });

  it('keeps the plate for a unit with no mesh, and says which unit', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mount = vi.fn<MountGarageView>();
    const p = plate();
    const h = garageModel(p, { id: 'ghost', name: 'Ghost' }, deps({ mount }));
    expect(await h.ready).toEqual({ shown: 'plate', reason: 'no-mesh' });
    expect(mount).not.toHaveBeenCalled();
    expect(String(warn.mock.calls[0][0])).toContain('ghost has no mesh');
    expect(p.dataset.modelReason).toBe('no-mesh');
  });

  it('keeps the plate with no WebGL2, probed before anything is imported', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mount = vi.fn<MountGarageView>();
    const p = plate();
    const h = garageModel(p, UNIT, deps({ webgl: () => false, mount }));
    expect(await h.ready).toEqual({ shown: 'plate', reason: 'no-webgl2' });
    expect(mount).not.toHaveBeenCalled();
    expect(String(warn.mock.calls[0][0])).toContain('no WebGL2');
  });

  it('the real probe answers no in jsdom, so a test browser never reaches three', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = plate();
    const h = garageModel(p, UNIT, deps({ webgl: undefined }));
    expect(await h.ready).toEqual({ shown: 'plate', reason: 'no-webgl2' });
  });

  it('keeps the plate when the GLB fails, warning with the error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const boom = new Error('404');
    const p = plate();
    const h = garageModel(p, UNIT, deps({ mount: () => Promise.reject(boom) }));
    expect(await h.ready).toEqual({ shown: 'plate', reason: 'load-failed' });
    expect(String(warn.mock.calls[0][0])).toContain("could not draw inf_squad's model");
    expect(warn.mock.calls[0][1]).toBe(boom);
    expect(p.querySelector('.rl-garage__model')).toBeNull();
  });

  it('puts the plate back when the browser takes the context away', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const view = fakeView();
    let lose: (() => void) | undefined;
    const p = plate();
    const h = garageModel(
      p,
      UNIT,
      deps({
        mount: (_host, o) => {
          lose = o.onContextLost;
          return Promise.resolve(view);
        },
      })
    );
    expect((await h.ready).shown).toBe('model');
    lose?.();
    expect(p.dataset.model).toBe('plate');
    expect(p.dataset.modelReason).toBe('context-lost');
    expect(view.disposed).toBe(1);
    expect(p.querySelector('.rl-garage__model')).toBeNull();
  });
});

describe('garageModel: live', () => {
  it('is a labelled, focusable slider once the first frame is up, and not before', async () => {
    const view = fakeView();
    let resolve: ((v: MountedGarageView) => void) | undefined;
    const p = plate();
    const h = garageModel(p, UNIT, deps({ mount: () => new Promise((r) => (resolve = r)) }));
    expect(p.dataset.model).toBe('pending');
    expect(h.el.tabIndex).toBe(-1);
    resolve?.(view);
    await h.ready;
    expect(p.dataset.model).toBe('live');
    expect(h.el.tabIndex).toBe(0);
    expect(h.el.getAttribute('role')).toBe('slider');
    expect(h.el.getAttribute('aria-label')).toBe(t('garage.model.label', { name: 'Rifle Squad' }));
    expect(h.el.getAttribute('aria-label')).toContain('Rifle Squad');
    expect(h.el.getAttribute('aria-valuenow')).toBe('0');
    // Prepended, so the kit mark and stamps drawn after it stay on top.
    expect(p.firstElementChild).toBe(h.el);
  });

  it('hands the door what it needs, the abort signal included', async () => {
    const mount = vi.fn<MountGarageView>(() => Promise.resolve(fakeView()));
    const h = garageModel(plate(), UNIT, deps({ mount }));
    await h.ready;
    const o = mount.mock.calls[0][1];
    expect(o).toMatchObject({
      typeId: 'inf_squad',
      kind: 'rigged',
      meshUrl: '/meshes/meshy_soldier.glb',
      faction: 'kdf',
      dracoDecoderPath: '/draco/',
      groundTextureUrl: '/textures/desert_sand_tile.jpg',
    });
    expect(o.signal?.aborted).toBe(false);
  });

  it('turns with Left/Right and goes home with Home, one draw per frame', async () => {
    const view = fakeView();
    const c = clocks();
    const h = garageModel(plate(), UNIT, deps({ mount: () => Promise.resolve(view), ...c }));
    await h.ready;
    expect(key(h.el, 'ArrowRight').defaultPrevented).toBe(true);
    c.flush();
    expect(view.drawn).toEqual([KEY_STEP_DEG]);
    expect(h.el.getAttribute('aria-valuenow')).toBe(String(KEY_STEP_DEG));
    key(h.el, 'ArrowLeft');
    key(h.el, 'ArrowLeft');
    c.flush();
    expect(view.drawn).toEqual([KEY_STEP_DEG, 360 - KEY_STEP_DEG]);
    key(h.el, 'Home');
    c.flush();
    expect(view.drawn.at(-1)).toBe(0);
    // Any other key is left alone.
    expect(key(h.el, 'a').defaultPrevented).toBe(false);
    c.flush();
    expect(view.drawn).toHaveLength(3);
  });

  it('turns with a drag, half a degree a pixel', async () => {
    const view = fakeView();
    const c = clocks();
    const h = garageModel(plate(), UNIT, deps({ mount: () => Promise.resolve(view), ...c }));
    await h.ready;
    pointer(h.el, 'pointerdown', 100);
    expect(h.el.dataset.dragging).toBe('1');
    pointer(h.el, 'pointermove', 130);
    pointer(h.el, 'pointermove', 160);
    c.flush();
    expect(view.drawn).toEqual([60 * DRAG_DEG_PER_PX]);
    pointer(h.el, 'pointerup', 160);
    expect(h.el.dataset.dragging).toBeUndefined();
    // A move with no button down turns nothing.
    pointer(h.el, 'pointermove', 400);
    c.flush();
    expect(view.drawn).toHaveLength(1);
  });

  it('draws nothing while idle', async () => {
    const view = fakeView();
    const c = clocks();
    const h = garageModel(plate(), UNIT, deps({ mount: () => Promise.resolve(view), ...c }));
    await h.ready;
    for (let i = 0; i < 100; i++) c.flush();
    expect(view.drawn).toEqual([]);
    expect(c.pendingFrames()).toBe(0);
  });

  it('moves into a rebuilt plate with the same view, and redraws once there', async () => {
    const view = fakeView();
    const c = clocks();
    const mount = vi.fn<MountGarageView>(() => Promise.resolve(view));
    const h = garageModel(plate(), UNIT, deps({ mount, ...c }));
    await h.ready;
    const next = plate();
    h.adopt(next);
    expect(next.firstElementChild).toBe(h.el);
    expect(next.dataset.model).toBe('live');
    c.flush();
    expect(view.drawn).toEqual([0]);
    expect(mount).toHaveBeenCalledTimes(1);
    expect(view.disposed).toBe(0);
  });
});

describe('garageModel: dispose on leave', () => {
  it('disposes a live view once, removes the control and stops its clocks', async () => {
    const view = fakeView();
    const c = clocks();
    const p = plate();
    let signal: AbortSignal | undefined;
    const h = garageModel(
      p,
      UNIT,
      deps({
        mount: (_host, o) => {
          signal = o.signal;
          return Promise.resolve(view);
        },
        reducedMotion: () => false,
        ...c,
      })
    );
    await h.ready;
    key(h.el, 'ArrowRight');
    expect(c.pendingTimers()).toBe(1);
    h.dispose();
    h.dispose();
    expect(view.disposed).toBe(1);
    expect(signal?.aborted).toBe(true);
    expect(p.querySelector('.rl-garage__model')).toBeNull();
    expect(c.pendingFrames()).toBe(0);
    expect(c.pendingTimers()).toBe(0);
  });

  it('a view that lands AFTER the leave is disposed the moment it arrives (the soft-leave rule)', async () => {
    const view = fakeView();
    let resolve: ((v: MountedGarageView) => void) | undefined;
    let signal: AbortSignal | undefined;
    const h = garageModel(
      plate(),
      UNIT,
      deps({
        mount: (_host, o) => {
          signal = o.signal;
          return new Promise((r) => (resolve = r));
        },
      })
    );
    await Promise.resolve();
    h.dispose();
    // The door was told at once, synchronously -- it never waits on the load.
    expect(signal?.aborted).toBe(true);
    resolve?.(view);
    expect(await h.ready).toEqual({ shown: 'plate' });
    expect(view.disposed).toBe(1);
  });

  it('a door that gives up because it was left is not reported as a failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let reject: ((e: unknown) => void) | undefined;
    const h = garageModel(plate(), UNIT, deps({ mount: () => new Promise((_r, j) => (reject = j)) }));
    await Promise.resolve();
    h.dispose();
    reject?.(new DOMException('left', 'AbortError'));
    expect(await h.ready).toEqual({ shown: 'plate' });
    expect(warn).not.toHaveBeenCalled();
  });
});
