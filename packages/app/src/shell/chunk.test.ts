// packages/app/src/shell/chunk.test.ts
// @vitest-environment jsdom
// A lazy route chunk that fails is retried once and then becomes the shell's error card, never a blank stage.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../i18n/t';
import { ChunkLoadError, importWithRetry } from './chunk';
import { chunkFailedCard } from './chunk-card';
import { Router, type Disposer } from './router';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('importWithRetry', () => {
  it('returns the module at once when the first try works, and does not wait', async () => {
    const load = vi.fn(() => Promise.resolve({ ok: 1 }));
    // 60 s of delay: a retry that waited when it need not would blow the test's own timeout
    await expect(importWithRetry(load, 60_000)).resolves.toEqual({ ok: 1 });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('a import that fails once and then succeeds returns the module (one retry)', async () => {
    let calls = 0;
    const load = vi.fn(() => (++calls === 1 ? Promise.reject(new Error('network blip')) : Promise.resolve({ ok: 2 })));
    await expect(importWithRetry(load, 0)).resolves.toEqual({ ok: 2 });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('an import that always fails is tried exactly twice and throws ChunkLoadError carrying the second failure', async () => {
    const second = new Error('still down');
    let calls = 0;
    const load = vi.fn(() => Promise.reject(++calls === 1 ? new Error('first') : second));
    const err = await importWithRetry(load, 0).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ChunkLoadError);
    expect((err as ChunkLoadError).reason).toBe(second);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('waits the delay between the two tries', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const load = vi.fn(() => (++calls === 1 ? Promise.reject(new Error('x')) : Promise.resolve('ok')));
    const p = importWithRetry(load, 400);
    await vi.advanceTimersByTimeAsync(399);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).resolves.toBe('ok');
    expect(load).toHaveBeenCalledTimes(2);
  });
});

/** A router with a menu, and a route "lazy" whose mount goes through `importWithRetry(load)`. */
function makeRouter(load: () => Promise<{ show: (host: HTMLElement) => Disposer }>, withCard = true) {
  const stage = document.createElement('div');
  document.body.appendChild(stage);
  window.history.replaceState(null, '', '/');
  const reload = vi.fn();
  const mountOf =
    (name: string) =>
    (host: HTMLElement): Disposer => {
      const el = document.createElement('section');
      el.dataset.screen = name;
      host.appendChild(el);
      return () => el.remove();
    };
  const router = new Router({
    base: '/',
    stage,
    transitionMs: 0,
    routes: [
      { name: 'menu', pattern: '/', mount: mountOf('menu') },
      {
        name: 'lazy',
        pattern: '/lazy',
        mount: async (host: HTMLElement) => (await importWithRetry(load, 0)).show(host),
      },
    ],
    notFound: mountOf('404'),
    ...(withCard ? { chunkFailed: chunkFailedCard('/', reload) } : {}),
  });
  return { router, stage, reload };
}
const okScreen = { show: (host: HTMLElement): Disposer => {
  const el = document.createElement('section');
  el.dataset.screen = 'lazy';
  host.appendChild(el);
  return () => el.remove();
} };

describe('a route chunk that fails (Router + chunkFailed)', () => {
  it('fails once, then loads: the screen mounts and no error card is drawn', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let calls = 0;
    const { router, stage } = makeRouter(() => (++calls === 1 ? Promise.reject(new Error('blip')) : Promise.resolve(okScreen)));
    await router.start();
    await router.navigate('/lazy');
    expect(stage.querySelector('[data-screen="lazy"]')).not.toBeNull();
    expect(stage.querySelector('.rl-boot-error')).toBeNull();
    expect(calls).toBe(2);
    expect(console.error).not.toHaveBeenCalled();
  });

  it('always fails: the stage shows the card (title, body, a reload button), never nothing; the route is current', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { router, stage, reload } = makeRouter(() => Promise.reject(new Error('gone')));
    await router.start();
    await router.navigate('/lazy');
    expect(stage.children.length).toBeGreaterThan(0);
    const card = stage.querySelector('.rl-boot-error');
    expect(card).not.toBeNull();
    expect(card?.getAttribute('role')).toBe('alert');
    expect(card?.querySelector('.rl-boot-error__title')?.textContent).toBe(t('boot.chunk.title'));
    expect(card?.querySelector('.rl-boot-error__body')?.textContent).toBe(t('boot.chunk.body'));
    expect(card?.querySelector('.rl-boot-error__title')?.textContent).toBe('This screen did not load');
    const button = card?.querySelector<HTMLButtonElement>('.rl-boot-error__reload');
    expect(button?.textContent).toBe(t('boot.failed.reload'));
    button?.click();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(router.current()?.name).toBe('lazy');
    expect(err).toHaveBeenCalledTimes(1);
  });

  it('the card obeys the disposer contract: the next navigation removes it and nothing of it is left on the page', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { router, stage } = makeRouter(() => Promise.reject(new Error('gone')));
    const bodyBefore = document.body.children.length;
    await router.start();
    await router.navigate('/lazy');
    expect(stage.querySelector('.rl-boot-error')).not.toBeNull();
    await router.navigate('/');
    expect(stage.querySelector('.rl-boot-error')).toBeNull();
    expect(stage.querySelectorAll('[data-screen]')).toHaveLength(1); // the menu, alone
    expect(document.body.children.length).toBe(bodyBefore); // the page is back to what it was before the route
  });

  it('a navigation that lands while the retry is pending wins: no card is drawn over the newer screen', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const { router, stage } = makeRouter(async () => {
      await gate;
      throw new Error('gone');
    });
    await router.start();
    const slow = router.navigate('/lazy');
    await router.navigate('/'); // the player gives up and goes back
    release();
    await slow;
    expect(stage.querySelector('.rl-boot-error')).toBeNull();
    expect(stage.querySelectorAll('[data-screen]')).toHaveLength(1);
    expect(router.current()?.name).toBe('menu');
  });

  it('the card\'s own disposer removes the card (idempotent), whatever the router does after it', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const host = document.createElement('div');
    const dispose = chunkFailedCard('/')(host, new ChunkLoadError(new Error('x')));
    expect(host.querySelectorAll('.rl-boot-error')).toHaveLength(1);
    dispose();
    expect(host.children).toHaveLength(0);
    dispose(); // a second call is harmless
    expect(host.children).toHaveLength(0);
  });

  it('without a chunkFailed option the router rethrows, as it always did', async () => {
    const { router } = makeRouter(() => Promise.reject(new Error('gone')), false);
    await router.start();
    await expect(router.navigate('/lazy')).rejects.toBeInstanceOf(ChunkLoadError);
  });

  it('any other error from a mount is still rethrown, not turned into the card', async () => {
    const stage = document.createElement('div');
    document.body.appendChild(stage);
    window.history.replaceState(null, '', '/');
    const router = new Router({
      base: '/',
      stage,
      transitionMs: 0,
      routes: [
        { name: 'menu', pattern: '/', mount: () => () => {} },
        { name: 'bug', pattern: '/bug', mount: async () => { throw new TypeError('a real bug'); } },
      ],
      notFound: () => () => {},
      chunkFailed: chunkFailedCard('/'),
    });
    await router.start();
    await expect(router.navigate('/bug')).rejects.toBeInstanceOf(TypeError);
    expect(stage.querySelector('.rl-boot-error')).toBeNull();
  });
});
